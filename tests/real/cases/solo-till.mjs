// Money & end of day, till (Paid out + Emergency POS), on the real worker:
// Solo: it adds an emergency sale on another day and products to the shared list, which the eposreg case would
// otherwise take for its own newest row.
//  1. Paid out: "Paid recently" fills who (and how / what for from their last payment); the saved row is the classic
//     body, column for column the same as a payment typed in full. The month card counts the payments.
//  2. Emergency POS: a note button fills the cash handed, "Sale saved" shows the change; the sale row is the classic
//     body; "Sales by day" (one grouped read, /emergency-pos/days) shows today's total equal to the day list's, and a
//     past day opens with its own sales. Opening the screen reads: catalogue, the day's sales, the month's days.
import { ymd } from "../lib.mjs";
const PRODUCTS = [
  { barcode: "7012345678901", name: "Tilltest Panadol 500mg x24", price: 3.49, vat_rate: 0, category: "Pain", unit: "" },
  { barcode: "7000000000002", name: "Tilltest Plasters x20", price: 1.85, vat_rate: 18, category: "First aid", unit: "" }];
export default {
  title: "Till: paid recently, notes, sales by day",
  async run(t) {
    // 1. Paid out
    const T = "paid_out_entries", p = await t.page();
    const seed = { entry_date: ymd(-2), entry_time: "09:10", payee_name: "Tilltest Ħobża Bakery", fee: 6.2, payment_method: "cheque", invoice_no: "", cheque_no: "TT1", reason: "Bread for the staff" };
    t.ok((await t.api("POST", "/paid-out/entries", seed)).ok, "a payment from two days ago");
    await t.open(p, "2", "paidout", "poreg", "[data-act=add]");
    let m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#por-add .por-chip");
    const chip = p.locator("#por-add .por-chip", { hasText: "Tilltest Ħobża Bakery" });
    t.ok(await chip.count() === 1, "the payee is under Paid recently");
    await chip.click();
    const after = await p.evaluate(() => ({ who: document.querySelector("[name=payee_name]").value, why: document.querySelector("[name=reason]").value, chq: !!document.querySelector("[name=cheque_no]"), ph: document.querySelector("[name=fee]").placeholder, focus: document.activeElement.name }));
    t.ok(after.who === "Tilltest Ħobża Bakery" && after.why === "Bread for the staff" && after.chq && /Last time €6\.20/.test(after.ph) && after.focus === "fee", "a tap fills who, how and what for; the amount is only suggested: " + JSON.stringify(after));
    await t.fill(p, "#por-add", { fee: "6.40", cheque_no: "TT2", entry_date: ymd(-1), entry_time: "10:20" });
    const w = await t.write(p, /\/paid-out\/entries$/, () => p.press("#por-add [name=fee]", "Enter"));
    const viaChip = (await t.mine(T, m, { cheque_no: "TT2" }))[0];
    t.ok(JSON.stringify(Object.keys(w.body || {})) === JSON.stringify(["entry_date", "entry_time", "payee_name", "fee", "payment_method", "invoice_no", "cheque_no", "reason"]), "the same body as before: " + JSON.stringify(w.body));
    m = t.maxId(T);
    await t.api("POST", "/paid-out/entries", w.body && { ...w.body, cheque_no: "TT3" }); // the same body, sent as it was typed in full
    const typed = (await t.mine(T, m, { cheque_no: "TT3" }))[0];
    t.same("paid recently", viaChip, typed, { cheque_no: "each its own cheque", });
    await p.waitForSelector(".por-sum");
    const sum = await p.evaluate(() => document.querySelector(".por-sum").innerText);
    t.ok(/\d+ payments?/.test(sum) && /by cheque/.test(sum), "the month card counts the payments and says what went by cheque: " + sum);

    // 2. Emergency POS
    const S = "pos_sales";
    t.ok((await t.api("POST", "/emergency-pos/catalog", { products: PRODUCTS, wipe: false, file_name: "till.xlsx", total_rows: 2, chunk_index: 1 })).ok, "catalogue in");
    const past = ymd(-3);
    t.ok((await t.api("POST", "/emergency-pos/sales", { offline_id: "till-past", sale_date: past, receipt_no: "R-till-past", items: [{ barcode: "7000000000002", name: "Tilltest Plasters x20", qty: 2, price: 1.85, vat_rate: 18, line_total: 3.7, fmd: null }], subtotal: 3.7, vat_total: 0.56, discount_pct: 0, discount_amt: 0, total: 3.7, payment_method: "card", amount_tendered: null, change_given: null, notes: "" })).ok, "a sale three days ago");
    const q = await t.page(); const gets = [];
    q.on("request", (r) => { const u = new URL(r.url()); if (r.method() === "GET" && /^\/emergency-pos\//.test(u.pathname)) gets.push(u.pathname); });
    await t.open(q, "2", "emergency-pos", "eposreg", "#epr-q");
    await q.waitForSelector(".epr-days");
    t.ok(JSON.stringify([...new Set(gets)].sort()) === JSON.stringify(["/emergency-pos/catalog", "/emergency-pos/days", "/emergency-pos/sales"]), "opening reads the catalogue, the day and the month, once each: " + JSON.stringify(gets));
    m = t.maxId(S);
    await q.fill("#epr-q", "tilltest panadol"); await q.press("#epr-q", "Enter");
    await q.waitForSelector("[data-act=note][data-n='5']");
    await q.click("[data-act=note][data-n='5']");
    t.ok(await q.inputValue("[data-k=tendered]") === "5.00" && /€1\.51/.test(await q.textContent("[data-b=change]")), "€5 fills the cash handed and the change is €1.51");
    await t.write(q, /\/emergency-pos\/sales(\/sync)?$/, () => q.click("[data-k=take]"));
    const fresh = (await t.mine(S, m, { total: 3.49 }))[0];
    t.has("epos(note)", fresh, { payment_method: "cash", total: 3.49, amount_tendered: 5, change_given: 1.51, voided: 0 });
    await q.waitForSelector("[data-done]");
    const done = await q.textContent("[data-done]");
    t.ok(/Sale saved/.test(done) && /Change €1\.51/.test(done), "Sale saved, with the change to hand back: " + done);
    await t.idle(q);
    const list = (await t.api("GET", "/emergency-pos/sales?date=" + ymd(0))).sales.filter((s) => s.voided !== 1);
    const want = "€" + (Math.round(list.reduce((a, s) => a + s.total, 0) * 100) / 100).toFixed(2);
    const todayRow = await q.textContent(`[data-act=day][data-d="${ymd(0)}"] em`), top = await q.textContent("[data-b=todaytop]");
    t.ok(todayRow === want && top === want, `today's row and Today so far equal the day list: ${todayRow} ${top} ${want}`);
    const days = (await t.api("GET", "/emergency-pos/days?month=" + ymd(0).slice(0, 7))).days;
    t.ok(past.slice(0, 7) !== ymd(0).slice(0, 7) || days.some((d) => d.sale_date === past && d.total >= 3.7), "the past day is in the month read");
    if (past.slice(0, 7) === ymd(0).slice(0, 7)) {
      await q.click(`[data-act=day][data-d="${past}"]`); await q.waitForSelector(".epr-dayin .epr-sb");
      const txt = await q.textContent(".epr-dayin");
      t.ok(/Tilltest Plasters x20/.test(txt), "a past day opens with its own sales");
    }
  },
};
