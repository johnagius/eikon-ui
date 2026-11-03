// Search that does things (eikon.search.js, BACKLOG4 item 3): a form opened from the search ("grech order",
// "ask grech", "0456789M dda") stores exactly the row the same form stores when opened from its screen's own button
// with the same values typed. The person comes from the registers (Grech Joseph, 0456789M, seeded as a DDA sale).
import { ymd } from "../lib.mjs";
const ITEMS = "Augmentin 625 x14 ċġħż", NEED = ymd(2), ISSUE = "Is Żebbuġ stock in?";
async function viaSearch(p, q, form) {
  await p.evaluate(() => { location.hash = "#registers"; });
  await p.waitForFunction(() => window.EIKON.state.activeModuleId === "registers");
  await p.keyboard.press("Control+k"); await p.waitForSelector("#esr-q"); await p.keyboard.type(q, { delay: 20 });
  await p.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 8000 });
  const first = await p.evaluate(() => (document.querySelector(".esr-opt") || {}).innerText || "");
  await p.keyboard.press("Enter");
  await p.waitForSelector(form, { timeout: 10000 }); await p.waitForTimeout(400);
  return first.replace(/\s+/g, " ");
}
export default {
  title: "Search opens forms",
  async run(t) {
    const p = await t.page();
    // Orders: the button, then the search
    const TO = "client_orders_entries";
    await t.open(p, "2", "ordreg", "ordreg", ".ord-top [data-act=add]");
    let m = t.maxId(TO);
    await p.click(".ord-top [data-act=add]"); await p.waitForSelector("#ord-add");
    await t.fill(p, "#ord-add", { client_name: "Grech Joseph", id_card: "0456789M", items: ITEMS, needed_by: NEED });
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    const byButton = t.since(TO, m)[0];
    m = t.maxId(TO);
    const f1 = await viaSearch(p, "grech order", "#ord-add");
    const filled = await p.evaluate(() => ({ name: document.querySelector("#ord-add [name=client_name]").value, id: document.querySelector("#ord-add [name=id_card]").value, focus: document.activeElement && document.activeElement.name }));
    t.ok(/^New order for Grech Joseph/.test(f1), "orders: 'grech order' offers the order for Grech Joseph first: " + f1);
    t.ok(filled.name === "Grech Joseph" && filled.id === "0456789M", "orders: the search filled the name and ID card: " + JSON.stringify(filled));
    await t.fill(p, "#ord-add", { items: ITEMS, needed_by: NEED });
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    t.same("orders (search vs button)", byButton, t.since(TO, m)[0], { order_code: "a new code for each order" });

    // Questions: the button, then "ask grech"
    const TT = "client_tickets_entries";
    await t.open(p, "2", "tktreg", "tktreg", "[data-act=add]");
    m = t.maxId(TT);
    await p.click("[data-act=add]"); await p.waitForSelector("#tkt-add");
    await t.fill(p, "#tkt-add", { client_name: "Grech Joseph", issue: ISSUE });
    await t.write(p, /\/client-tickets\/entries$/, () => p.click("#tkt-add button[type=submit]"));
    const qButton = t.since(TT, m)[0];
    m = t.maxId(TT);
    const f2 = await viaSearch(p, "ask grech", "#tkt-add");
    t.ok(/^New question for Grech Joseph/.test(f2), "questions: 'ask grech' offers the question for Grech Joseph first: " + f2);
    // the phone the first question did not have may now be known from Customers: type the same (empty) phone
    await p.fill("#tkt-add [name=phone]", qButton.phone || "");
    await t.fill(p, "#tkt-add", { issue: ISSUE });
    await t.write(p, /\/client-tickets\/entries$/, () => p.click("#tkt-add button[type=submit]"));
    t.same("questions (search vs button)", qButton, t.since(TT, m)[0], { ticket_id: "the next number in the sequence" });
  },
};
