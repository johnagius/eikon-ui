// Paid out (poreg) vs classic Paid Out, paid by cheque.
import { ymd } from "../lib.mjs";
const IN = { name: "Gozo Couriers Ltd", fee: "12.50", cheque: "000771", inv: "GC-2201", reason: "Delivery to Gozo", date: ymd(-1), time: "10:45" };
export default {
  title: "Paid out",
  async run(t) {
    const T = "paid_out_entries", p = await t.page();
    await t.open(p, "classic", "paidout", "paidout", "#po-new");
    let m = t.maxId(T);
    await p.click("#po-new"); await p.waitForSelector("#po-f-name");
    await p.selectOption("#po-f-method", "cheque");
    await t.fill(p, "", { "#po-f-name": IN.name, "#po-f-fee": IN.fee, "#po-f-cheque": IN.cheque, "#po-f-inv": IN.inv, "#po-f-reason": IN.reason, "#po-f-date": IN.date, "#po-f-time": IN.time });
    await t.write(p, /\/paid-out\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = (await t.mine(T, m, { invoice_no: IN.inv }))[0];
    await t.open(p, "2", "paidout", "poreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#por-add");
    await p.click("#por-add [data-m=cheque]"); await p.waitForSelector("#por-add [name=cheque_no]");
    await t.fill(p, "#por-add", { payee_name: IN.name, fee: IN.fee, cheque_no: IN.cheque, invoice_no: IN.inv, reason: IN.reason, entry_date: IN.date, entry_time: IN.time });
    await t.write(p, /\/paid-out\/entries$/, () => p.click("#por-add button[type=submit]"));
    const fresh = (await t.mine(T, m, { invoice_no: IN.inv }))[0];
    t.has("paidout(new)", fresh, { payee_name: IN.name, fee: 12.5, payment_method: "cheque", cheque_no: IN.cheque, invoice_no: IN.inv, reason: IN.reason, entry_date: IN.date, entry_time: IN.time });
    t.same("paidout", classic, fresh);
  },
};
