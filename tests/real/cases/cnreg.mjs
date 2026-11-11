// Credit notes (cnreg) vs classic Credit Notes: a new credit note with an expiry date.
import { ymd } from "../lib.mjs";
const IN = { name: "Rita", surname: "Camilleri", phone: "79222333", amount: "25.40", receipt: "R-7781", issued: ymd(-2), expires: ymd(180) };
export default {
  title: "Credit notes",
  async run(t) {
    const T = "credit_notes", p = await t.page();
    await t.open(p, "classic", "creditnotes", "creditnotes", "#cn-new");
    let m = t.maxId(T);
    await p.click("#cn-new"); await p.waitForSelector("#cn-client-name:visible");
    if (await p.isChecked("#cn-no-expiry")) await p.uncheck("#cn-no-expiry");
    await t.fill(p, "", { "#cn-client-name": IN.name, "#cn-client-surname": IN.surname, "#cn-telephone": IN.phone, "#cn-amount": IN.amount, "#cn-receipt-number": IN.receipt, "#cn-issue-date": IN.issued, "#cn-expiry-date": IN.expires });
    await t.write(p, /\/creditnotes\/entries$/, () => p.click("#cn-save"));
    const classic = (await t.mine(T, m, { receipt_number: IN.receipt }))[0];
    await t.open(p, "2", "creditnotes", "cnreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#cnr-add");
    await t.fill(p, "#cnr-add", { client_name: IN.name, client_surname: IN.surname, telephone: IN.phone, amount: IN.amount, receipt_number: IN.receipt, issue_date: IN.issued, expiry_date: IN.expires });
    await t.write(p, /\/creditnotes\/entries$/, () => p.click("#cnr-add button[type=submit]"));
    const fresh = (await t.mine(T, m, { receipt_number: IN.receipt }))[0];
    t.has("creditnote(new)", fresh, { client_name: IN.name, client_surname: IN.surname, telephone: IN.phone, receipt_number: IN.receipt, issue_date: IN.issued, expiry_date: IN.expires });
    t.ok(fresh && Number(fresh.amount) === 25.4, "creditnote(new): amount 25.40 stored: " + (fresh && fresh.amount));
    t.same("creditnote", classic, fresh, { cn_no: "the pharmacy's own credit-note number (W6): the next one, as the row id was" });
  },
};
