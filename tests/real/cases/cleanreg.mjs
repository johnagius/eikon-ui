// Cleaning (cleanreg) vs classic Cleaning. The new form signs as the person signed in; the classic types it.
import { ymd } from "../lib.mjs";
const IN = { date: ymd(-1), tin: "07:30", tout: "08:15", cleaner: "Rita Cleaner", staff: "Maria Borg", notes: "Floors and shelves" };
export default {
  title: "Cleaning",
  async run(t) {
    const T = "cleaning_entries", p = await t.page();
    await t.open(p, "classic", "cleaning", "cleaning", "#cl-cleaner");
    let m = t.maxId(T);
    await t.fill(p, "", { "#cl-date": IN.date, "#cl-in": IN.tin, "#cl-out": IN.tout, "#cl-cleaner": IN.cleaner, "#cl-staff": IN.staff, "#cl-notes": IN.notes });
    await t.write(p, /\/cleaning\/entries$/, () => p.click("#cl-save"));
    const classic = (await t.mine(T, m, { cleaner_name: IN.cleaner }))[0];
    await t.open(p, "2", "cleaning", "cleanreg", "[data-act=new]");
    m = t.maxId(T);
    await p.click("[data-act=new]"); await p.waitForSelector("#clr-form");
    await t.fill(p, "#clr-form", { entry_date: IN.date, time_in: IN.tin, time_out: IN.tout, cleaner_name: IN.cleaner, notes: IN.notes });
    await t.write(p, /\/cleaning\/entries$/, () => p.click("#clr-form button[type=submit]"));
    const fresh = (await t.mine(T, m, { cleaner_name: IN.cleaner }))[0];
    t.has("cleaning(new)", fresh, { entry_date: IN.date, time_in: IN.tin, time_out: IN.tout, cleaner_name: IN.cleaner, staff_name: IN.staff, notes: IN.notes });
    t.same("cleaning", classic, fresh);
  },
};
