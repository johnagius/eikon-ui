// Daily register (drreg) vs classic Daily Register.
import { ymd } from "../lib.mjs";
const IN = { date: ymd(0), id: "0234567M", name: "Farrugia Paul", med: "Amoxil 500mg", pos: "1-1-1 x 7 days", doc: "Dr Kevin Borg", reg: "R4321" };
export default {
  title: "Daily register",
  async run(t) {
    const T = "daily_register_entries", p = await t.page();
    await t.open(p, "classic", "dailyregister", "dailyregister", "#dr-new");
    let m = t.maxId(T);
    await p.click("#dr-new"); await p.waitForSelector("#dr-client-name");
    await t.fill(p, "", { "#dr-date": IN.date, "#dr-client-name": IN.name, "#dr-client-id": IN.id, "#dr-med": IN.med, "#dr-pos": IN.pos, "#dr-prescriber": IN.doc, "#dr-presc-reg": IN.reg });
    await t.write(p, /\/daily-register\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = t.since(T, m)[0];
    await t.open(p, "2", "dailyregister", "drreg", "[data-act=new]");
    m = t.maxId(T);
    await p.click("[data-act=new]"); await p.waitForSelector("#drr-form");
    await t.fill(p, "#drr-form", { entry_date: IN.date, client_id: IN.id, client_name: IN.name, medicine_name_dose: IN.med, posology: IN.pos, prescriber_name: IN.doc, prescriber_reg_no: IN.reg });
    await t.write(p, /\/daily-register\/entries$/, () => p.click("#drr-form button[type=submit]"));
    const fresh = t.since(T, m)[0];
    t.has("daily(new)", fresh, { entry_date: IN.date, client_id: IN.id, client_name: IN.name, medicine_name_dose: IN.med, posology: IN.pos, prescriber_name: IN.doc, prescriber_reg_no: IN.reg });
    t.same("daily", classic, fresh);
  },
};
