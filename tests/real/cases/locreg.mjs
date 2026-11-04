// Locum register (locreg) vs classic Locum Register.
import { ymd } from "../lib.mjs";
const IN = { date: ymd(-1), tin: "08:30", tout: "13:15", name: "Pharm. Daniela Spiteri", reg: "PH 1234" };
export default {
  title: "Locum register",
  async run(t) {
    const T = "locum_register_entries", p = await t.page();
    await t.open(p, "classic", "locumregister", "locumregister", "#lr-save");
    let m = t.maxId(T);
    await p.fill("#lr-date", IN.date); await p.fill("#lr-in", IN.tin); await p.fill("#lr-out", IN.tout); await p.fill("#lr-name", IN.name); await p.fill("#lr-reg", IN.reg);
    await t.write(p, /\/locumregister\/entries$/, () => p.click("#lr-save"));
    const classic = (await t.mine(T, m, { locum_full_name: IN.name }))[0];
    await t.open(p, "2", "locumregister", "locreg", "[data-act=new]");
    m = t.maxId(T);
    await p.click("[data-act=new]"); await p.waitForSelector("#lcr-form");
    await t.fill(p, "#lcr-form", { entry_date: IN.date, time_in: IN.tin, time_out: IN.tout, locum_full_name: IN.name, registration_number: IN.reg });
    await t.write(p, /\/locumregister\/entries$/, () => p.click("#lcr-form button[type=submit]"));
    const fresh = (await t.mine(T, m, { locum_full_name: IN.name }))[0];
    t.has("locum(new)", fresh, { entry_date: IN.date, time_in: IN.tin, time_out: IN.tout, locum_full_name: IN.name, registration_number: IN.reg });
    t.same("locum", classic, fresh);
  },
};
