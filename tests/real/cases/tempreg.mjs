// Temperature: the new layout logs fridge/room readings on Today (tempreg is the register view); the classic
// Temperature screen logs them for every device at once. One reading per device per day, so the classic rows are
// read, removed from the local database, and the same readings logged again from Today.
import { ymd } from "../lib.mjs";
const READ = ["3.4", "7.2"];
export default {
  title: "Temperature (Today + register)",
  async run(t) {
    const T = "temperature_entries", p = await t.page();
    await t.open(p, "classic", "temperature", "temperature", "input.eikon-slim-input[type=number]");
    let m = t.maxId(T);
    const n = (await p.locator("input.eikon-slim-input[type=number]").count()) / 2;
    for (let i = 0; i < n; i++) await t.fill(p, "", { [`input.eikon-slim-input[type=number] >> nth=${2 * i}`]: READ[0], [`input.eikon-slim-input[type=number] >> nth=${2 * i + 1}`]: READ[1] });
    await t.write(p, /\/temperature\/entries$/, () => p.locator(".eikon-btn.primary:has-text('Save')").first().click());
    for (let i = 0; i < 50 && t.since(T, m).filter((x) => x.entry_date === ymd(0)).length < n; i++) await p.waitForTimeout(100);
    // only today's rows: tempnote.mjs writes past days of the same table at the same time
    const classic = t.since(T, m).filter((x) => x.entry_date === ymd(0));
    t.ok(n >= 1 && classic.length === n, `classic stored one reading per device (${classic.length} of ${n})`);
    t.db.prepare(`DELETE FROM ${T} WHERE id > ? AND entry_date = ?`).run(m, ymd(0));
    m = t.maxId(T);
    await t.open(p, "2", "today", "today", ".tdy-row[data-kind=temperature] [data-min]");
    for (const c of classic) {
      const row = `.tdy-row[data-kind=temperature][data-device="${c.device_id}"]`;
      await t.fill(p, "", { [row + " [data-min]"]: READ[0], [row + " [data-max]"]: READ[1] });
      await t.write(p, /\/temperature\/entries/, () => p.click(row + " [data-act=temp]"), "POST");
      await p.waitForSelector(row + " .tdy-pill", { timeout: 8000 }).catch(() => {});
    }
    const fresh = t.since(T, m).filter((x) => x.entry_date === ymd(0));
    for (const c of classic) {
      const f = fresh.find((x) => x.device_id === c.device_id);
      t.has("temperature(today) device " + c.device_id, f, { entry_date: ymd(0), min_temp: 3.4, max_temp: 7.2, notes: "" });
      t.same("temperature device " + c.device_id, c, f);
    }
    // the register (tempreg) shows today's reading
    await t.open(p, "2", "temperature", "tempreg");
    await p.waitForFunction(() => /3\.4/.test(document.querySelector(".eikon-content").innerText), null, { timeout: 8000 }).catch(() => {});
    t.ok(/3\.4/.test(await p.innerText(".eikon-content")), "the Temperature register shows the reading logged on Today");
  },
};
