// Repeat prescriptions (repreg) vs classic Repeat Prescriptions. The expiry is left to its default on both
// (six months from the day written).
import { ymd } from "../lib.mjs";
const IN = { date: ymd(-3), id: "0678912M", name: "Attard Lucy", med: "Atorvastatin 20mg", pos: "1 at night", doc: "Dr Claire Bonello", reg: "R5501" };
export default {
  title: "Repeat prescriptions",
  async run(t) {
    const T = "repeat_prescription_entries", p = await t.page();
    await t.open(p, "classic", "repeatprescriptions", "repeatprescriptions", "#rp-new");
    let m = t.maxId(T);
    await p.click("#rp-new"); await p.waitForSelector("#rp-client-name");
    await p.waitForTimeout(100); // the classic hooks "Expires = date + 6 months" on the date in a setTimeout after the modal opens
    await t.fill(p, "", { "#rp-date": IN.date, "#rp-client-id": IN.id, "#rp-client-name": IN.name, "#rp-med": IN.med, "#rp-pos": IN.pos, "#rp-prescriber": IN.doc, "#rp-presc-reg": IN.reg });
    await t.write(p, /\/repeat-prescriptions\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = (await t.mine(T, m, { client_id: IN.id }))[0];
    await t.open(p, "2", "repeatprescriptions", "repreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#rep-add");
    await t.fill(p, "#rep-add", { entry_date: IN.date, client_id: IN.id, client_name: IN.name, medicine_name_dose: IN.med, posology: IN.pos, prescriber_name: IN.doc, prescriber_reg_no: IN.reg });
    await t.write(p, /\/repeat-prescriptions\/entries$/, () => p.click("#rep-add button[type=submit]"));
    const fresh = (await t.mine(T, m, { client_id: IN.id }))[0];
    t.has("repeat(new)", fresh, { entry_date: IN.date, client_id: IN.id, client_name: IN.name, medicine_name_dose: IN.med, posology: IN.pos, prescriber_name: IN.doc, prescriber_reg_no: IN.reg });
    t.same("repeat", classic, fresh);
  },
};
