// DDA purchases (cdpreg) vs classic DDA Purchases: one invoice with two lines, each line one row.
import { ymd } from "../lib.mjs";
const IN = { date: ymd(0), agent: "Alfred Gera & Sons", inv: "INV-55012", lines: [["Morphine 10mg/ml ampoules", "10"], ["Fentanyl 25mcg patches", "5"]] };
export default {
  title: "DDA purchases",
  async run(t) {
    const T = "dda_purchases_entries", p = await t.page(), M = ".eikon-dda-modal ";
    await t.open(p, "classic", "dda-purchases", "dda-purchases", "button:has-text('New Entry')");
    let m = t.maxId(T);
    for (const [name, q] of IN.lines) {
      await p.click("button:has-text('New Entry')"); await p.waitForSelector(M + "input[type=date]");
      await t.fill(p, "", { [M + "input[type=date]"]: IN.date, [M + "input[type=number]"]: q, [M + "input[placeholder='DDA name & dose']"]: name, [M + "input[placeholder='Agent']"]: IN.agent, [M + "input[placeholder='Invoice number']"]: IN.inv });
      await t.write(p, /\/dda-purchases\/entries$/, () => p.click(M + "button.eikon-dda-btn:has-text('Save')"));
      await p.waitForSelector(M + "input[type=date]", { state: "hidden" }).catch(() => {});
    }
    const classic = t.since(T, m);
    await t.open(p, "2", "dda-purchases", "cdpreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#cdp-add");
    await t.fill(p, "#cdp-add", { entry_date: IN.date, agent: IN.agent, invoice_number: IN.inv, '#cdp-add [data-i="0"][data-k=dda_name_dose]': IN.lines[0][0], '#cdp-add [data-i="0"][data-k=quantity]': IN.lines[0][1] });
    await p.click("#cdp-add [data-act=line]");
    await t.fill(p, "#cdp-add", { '#cdp-add [data-i="1"][data-k=dda_name_dose]': IN.lines[1][0], '#cdp-add [data-i="1"][data-k=quantity]': IN.lines[1][1] });
    await p.click("#cdp-add button[type=submit]");
    for (let i = 0; i < 50 && t.since(T, m).length < 2; i++) await p.waitForTimeout(100);
    const fresh = t.since(T, m);
    t.ok(classic.length === 2 && fresh.length === 2, `two rows each (classic ${classic.length}, new ${fresh.length})`);
    for (let i = 0; i < 2; i++) {
      t.has("purchases(new) line " + (i + 1), fresh[i], { entry_date: IN.date, dda_name_dose: IN.lines[i][0], quantity: Number(IN.lines[i][1]), agent: IN.agent, invoice_number: IN.inv });
      t.same("purchases line " + (i + 1), classic[i], fresh[i]);
    }
  },
};
