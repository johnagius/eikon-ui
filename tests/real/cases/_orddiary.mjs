// Orders (ordreg, b4-5): after a new order, its items go into the order diary, as the classic screen's
// "Add to Order Diary?" does: the same diary row, column by column.
import { ymd } from "../lib.mjs";
const IN = { name: "Cachia Ġorġ", phone: "79444555", items: "Ħ-brand syrup 200ml", needed: ymd(2), supplier: "PharmaCo" };
export default {
  title: "Orders: into the order diary",
  async run(t) {
    const D = "order_diary_entries", p = await t.page();
    await t.open(p, "classic", "clientorders", "clientorders", "#co-new");
    await p.click("#co-new"); await p.waitForSelector("#co-client");
    await p.fill("#co-client", IN.name); await p.fill("#co-contact", IN.phone); await p.fill("#co-items", IN.items); await p.fill("#co-needed", IN.needed);
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    await p.waitForSelector("#co-od-supplier"); await p.fill("#co-od-supplier", IN.supplier);
    let m = t.maxId(D);
    await t.write(p, /\/order-diary\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = t.since(D, m);
    await t.open(p, "2", "clientorders", "ordreg", "[data-act=add]");
    await p.click("[data-act=add]"); await p.waitForSelector("#ord-add");
    await p.fill("#ord-add [name=client_name]", IN.name); await p.fill("#ord-add [name=contact]", IN.phone); await p.fill("#ord-add [name=items]", IN.items); await p.fill("#ord-add [name=needed_by]", IN.needed);
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    await p.waitForSelector("#ord-diary"); await p.fill("#ord-diary [name=supplier]", IN.supplier);
    m = t.maxId(D);
    await t.write(p, /\/order-diary\/entries$/, () => p.click("#ord-diary button[type=submit]"));
    await p.waitForFunction(() => !document.querySelector("#ord-diary"));
    const fresh = t.since(D, m);
    t.ok(classic.length === 1 && fresh.length === 1, `one diary line each (classic ${classic.length}, new ${fresh.length})`);
    t.has("diary(new)", fresh[0], { item_name: IN.items, qty: 1, supplier: IN.supplier, order_date: classic[0] && classic[0].order_date, status: "pending", notes: "" });
    t.same("diary", classic[0], fresh[0]);
    // "Not now" adds nothing
    await p.click("[data-act=add]"); await p.waitForSelector("#ord-add");
    await p.fill("#ord-add [name=client_name]", IN.name); await p.fill("#ord-add [name=contact]", IN.phone); await p.fill("#ord-add [name=items]", "Panadol"); await p.fill("#ord-add [name=needed_by]", IN.needed);
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    m = t.maxId(D); await p.click("[data-act=diary-no]"); await p.waitForTimeout(300);
    t.ok(t.maxId(D) === m && !(await p.$("#ord-diary")), "Not now: nothing goes into the diary and the question closes");
  },
};
