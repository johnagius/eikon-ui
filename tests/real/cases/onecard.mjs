// One person, one card (BACKLOG5 item 3). Mifsud Rosanne has a customer card; a credit note knows her as "Rosanne
// Mifsud" (credit notes store Name + Surname) with the same phone. Customers shows that credit note on her card, not as
// someone to Add; an order opened from the search for her ("rosanne order") and a credit note saved for her are linked
// to her card: no second card. The order row is the one the Orders button stores for the same values.
import { ymd } from "../lib.mjs";
const PHONE = "79123987", CARD = "0765432M", ITEMS = "Ventolin inhaler ċġħż", NEED = ymd(1);
export default {
  title: "One person, one card",
  async run(t) {
    const cards = () => t.db.prepare("SELECT id, name, phone, id_card, version FROM people WHERE merged_into IS NULL AND (replace(phone, ' ', '') = ? OR LOWER(name) LIKE '%rosanne%') ORDER BY id").all(PHONE);
    const r0 = await t.api("POST", "/people", { name: "Mifsud Rosanne", id_card: CARD, phone: PHONE });
    t.ok(r0 && r0.ok && r0.person, "her card is there");
    const c0 = await t.api("POST", "/creditnotes/entries", { issue_date: ymd(-3), client_name: "Rosanne", client_surname: "Mifsud", telephone: PHONE, email: "", receipt_number: "R-ONE1", amount: 12, expiry_date: "", no_expiry: 1 });
    t.ok(c0 && c0.ok !== false, "a credit note in her name the other way round");
    const before = JSON.stringify(cards());

    // Customers: the credit note is on her card, with a word for it; nothing to Add; never "undefined"
    const p = await t.page();
    await t.open(p, "2", "customers", "customers", "#cus-q");
    await p.fill("#cus-q", "rosanne"); await p.waitForFunction(() => /Mifsud Rosanne/.test((document.querySelector("#cus-list") || {}).innerText || ""), null, { timeout: 8000 });
    await p.waitForTimeout(400);
    const list = await p.evaluate(() => ({ text: document.querySelector("#cus-list").innerText, hist: [...document.querySelectorAll("[data-hist]")].map((e) => e.innerText.replace(/\s+/g, " ")) }));
    t.ok(/Also in the registers as Rosanne Mifsud/.test(list.text) && !list.hist.some((h) => /Rosanne/.test(h)) && !/undefined/.test(list.text), "Customers: the credit note shows on her card, not as Add: " + JSON.stringify(list));
    await p.click("[data-person]"); await p.waitForSelector("[data-cus-also]", { timeout: 8000 });
    const also = await p.evaluate(() => document.querySelector("[data-cus-also]").innerText);
    t.ok(/Rosanne Mifsud: 1 credit note, last /.test(also), "her page says where else she is: " + also);

    // Orders: the button with the values the search fills, then the search
    const TO = "client_orders_entries";
    await t.open(p, "2", "ordreg", "ordreg", ".ord-top [data-act=add]");
    let m = t.maxId(TO);
    await p.click(".ord-top [data-act=add]"); await p.waitForSelector("#ord-add");
    await t.fill(p, "#ord-add", { client_name: "Rosanne Mifsud", contact: PHONE, items: ITEMS, needed_by: NEED });
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    await p.evaluate(() => window.EIKON._lastPersonLink);
    const byButton = t.since(TO, m, { client_name: "Rosanne Mifsud" })[0];
    m = t.maxId(TO);
    await p.evaluate(() => { location.hash = "#registers"; });
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "registers");
    await p.keyboard.press("Control+k"); await p.waitForSelector("#esr-q"); await p.keyboard.type("rosanne order", { delay: 20 });
    await p.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 8000 });
    const opts = await p.evaluate(() => [...document.querySelectorAll(".esr-opt")].map((e) => e.innerText.replace(/\s+/g, " ")));
    const i = opts.findIndex((o) => /^New order for Rosanne Mifsud/.test(o));
    t.ok(i >= 0, "the search offers the order for Rosanne Mifsud: " + JSON.stringify(opts.slice(0, 4)));
    for (let k = 0; k < i; k++) await p.keyboard.press("ArrowDown");
    await p.keyboard.press("Enter"); await p.waitForSelector("#ord-add"); await p.waitForTimeout(400);
    const filled = await p.evaluate(() => ({ name: document.querySelector("#ord-add [name=client_name]").value, contact: document.querySelector("#ord-add [name=contact]").value }));
    t.ok(filled.name === "Rosanne Mifsud" && filled.contact === PHONE, "the search filled her as the registers have her: " + JSON.stringify(filled));
    await t.fill(p, "#ord-add", { items: ITEMS, needed_by: NEED });
    await t.write(p, /\/client-orders\/entries$/, () => p.click("#ord-add button[type=submit]"));
    await p.evaluate(() => window.EIKON._lastPersonLink);
    t.same("orders (search vs button)", byButton, t.since(TO, m, { client_name: "Rosanne Mifsud" })[0], { order_code: "a new code for each order" });

    // Credit notes: Name + Surname saved for her, linked to the same card
    const TC = "credit_notes";
    await t.open(p, "2", "creditnotes", "cnreg", "[data-act=add]");
    m = t.maxId(TC);
    await p.click("[data-act=add]"); await p.waitForSelector("#cnr-add");
    await t.fill(p, "#cnr-add", { client_name: "Rosanne", client_surname: "Mifsud", telephone: PHONE, amount: "8.00", receipt_number: "R-ONE2", issue_date: ymd(0) });
    await t.write(p, /\/creditnotes\/entries$/, () => p.click("#cnr-add button[type=submit]"));
    await p.evaluate(() => window.EIKON._lastPersonLink);
    await p.waitForTimeout(300);
    const after = JSON.stringify(cards());
    t.ok(after === before && cards().length === 1, "no new card: an order and a credit note later, she is still one person, unchanged: " + before + " → " + after);
  },
};
