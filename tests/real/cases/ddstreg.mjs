// DDA stock-takes (ddstreg) vs classic DDA Stock Takes (from agents/bl11/ddst-real.mjs): a stock take with four items
// (odd characters kept; the server trims spaces on both), one count corrected, then closed. Stock-take and item rows compared.
const ITEMS = [[" Morphine sulphate ", "10mg", "30"], ["Alprazolam", " 0.5mg ", "56"], ["Méthadone 1mg/ml «oral»", "", "0"], ["Diazepam", "5mg", "12"]];
const COUNT = ["Alprazolam", "29"];
export default {
  title: "DDA stock-takes",
  async run(t) {
    const S = "dda_stocktakes", I = "dda_stocktake_items", p = await t.page();
    const btn = (x) => p.locator("button", { hasText: new RegExp("^" + x + "$") }).first();
    await t.open(p, "classic", "dda_stocktakes", "dda_stocktakes", "button:has-text('New Stock Take')");
    let ms = t.maxId(S), mi = t.maxId(I);
    await t.write(p, /\/dda-stocktakes\/stocktakes$/, () => btn("New Stock Take").click());
    await p.waitForSelector('input[placeholder="Name"]');
    for (const [n, d, q] of ITEMS) {
      await p.fill('input[placeholder="Name"]', n); await p.fill('input[placeholder="Dosage (e.g. 10mg)"]', d); await p.fill('input[placeholder="Qty tablets"]', q);
      await t.write(p, /\/items$/, () => btn("Add Item").click()); await p.waitForTimeout(250);
    }
    await p.locator("tr", { hasText: COUNT[0] }).locator("button", { hasText: "Edit" }).click();
    await p.locator("input.eikon-grid-input").nth(2).fill(COUNT[1]);
    await t.write(p, /\/items\/\d+$/, () => btn("Save").click(), "PUT"); await p.waitForTimeout(250);
    await t.write(p, /\/stocktakes\/\d+/, () => btn("Save & Close").click(), "PUT").catch(async () => {});
    for (let i = 0; i < 30 && !(t.since(S, ms)[0] || {}).closed_at; i++) await p.waitForTimeout(100);
    const cS = t.since(S, ms)[0], cI = t.since(I, mi);
    await t.open(p, "2", "dda_stocktakes", "ddstreg", "[data-act=new]");
    ms = t.maxId(S); mi = t.maxId(I);
    await p.click("[data-act=new]"); await p.waitForSelector("#dst-add [name=item_name]");
    for (const [n, d, q] of ITEMS) {
      await p.fill("#dst-add [name=item_name]", n); await p.fill("#dst-add [name=dosage]", d); await p.fill("#dst-add [name=qty_tablets]", q);
      await t.write(p, /\/items$/, () => p.click("#dst-add button[type=submit]")); await p.waitForTimeout(250);
    }
    const cnt = p.locator(".dst-items .row", { hasText: COUNT[0] }).locator("input.dst-cnt");
    await cnt.fill(COUNT[1]); await t.write(p, /\/items\/\d+$/, () => cnt.press("Enter"), "PUT"); await p.waitForTimeout(250);
    await p.click("[data-act=close]");
    for (let i = 0; i < 30 && !(t.since(S, ms)[0] || {}).closed_at; i++) await p.waitForTimeout(100);
    const nS = t.since(S, ms)[0], nI = t.since(I, mi);
    t.ok(cS && cS.closed_at && nS && nS.closed_at, "both stock takes closed");
    t.same("stocktake", cS, nS, { closed_at: "the moment of closing" });
    t.ok(cI.length === 4 && nI.length === 4, `four item rows each (classic ${cI.length}, new ${nI.length})`);
    for (let i = 0; i < Math.min(cI.length, nI.length); i++) t.same("stocktake item " + (i + 1), cI[i], nI[i], { stocktake_id: "the row's own stock take" });
    t.has("stocktake(new) item 1", nI[0], { item_name: ITEMS[0][0].trim(), dosage: ITEMS[0][1] });
    t.has("stocktake(new) corrected count", nI[1], { qty_tablets: 29 });
  },
};
