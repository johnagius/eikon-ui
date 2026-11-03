// Locum receipts (lrcreg) vs classic Locum Receipts. The classic sets the rate (normal / holiday) from the day;
// the new form offers it with the same default, so the classic's choice is used on both.
import { ymd } from "../lib.mjs";
const weekday = (() => { for (let n = -2; ; n--) { const d = new Date(); d.setDate(d.getDate() + n); if ([2, 3, 4].includes(d.getDay())) return ymd(n); } })();
const IN = { name: "Pharm. Joseph Cassar", reg: "PH 2002", date: weekday, hours: "7.5", fee: "18.00" };
export default {
  title: "Locum receipts",
  async run(t) {
    const T = "locum_receipts", p = await t.page();
    await t.open(p, "classic", "locumreceipts", "locumreceipts", "#lrc-save");
    let m = t.maxId(T);
    await t.fill(p, "", { "#lrc-name": IN.name, "#lrc-reg": IN.reg, "#lrc-date": IN.date, "#lrc-hours": IN.hours, "#lrc-fee": IN.fee });
    await p.locator("#lrc-date").dispatchEvent("change");
    await t.write(p, /\/locumreceipts\/receipts$/, () => p.click("#lrc-save"));
    const classic = t.since(T, m)[0];
    await t.open(p, "2", "locumreceipts", "lrcreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#lrc-add");
    await t.fill(p, "#lrc-add", { locum_full_name: IN.name, registration_number: IN.reg, receipt_date: IN.date, hours: IN.hours, fee_per_hour: IN.fee });
    if (classic) await p.selectOption("#lrc-add [name=day_type]", classic.day_type);
    await t.write(p, /\/locumreceipts\/receipts$/, () => p.click("#lrc-add button[type=submit]"));
    const fresh = t.since(T, m)[0];
    t.has("receipts(new)", fresh, { locum_full_name: IN.name, registration_number: IN.reg, receipt_date: IN.date, hours: 7.5, fee_per_hour: 18 });
    t.same("receipts", classic, fresh);
    // The next thing asked for, right there: the receipt just recorded, offered for printing (that receipt, not another).
    const done = await p.waitForSelector(".lrc-done [data-act=print]", { timeout: 8000 }).then(() => p.evaluate(() => { const b = document.querySelector(".lrc-done [data-act=print]"); return { id: Number(b.getAttribute("data-id")), text: document.querySelector(".lrc-done").textContent }; })).catch(() => null);
    t.ok(done && fresh && done.id === fresh.id && /€135\.00/.test(done.text), "after recording, 'Print the receipt' is offered for that receipt " + JSON.stringify(done));
  },
};
