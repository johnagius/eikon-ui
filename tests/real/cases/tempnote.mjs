// Temperature notes in the new layout (BACKLOG3 item 2). A reading outside its limits gets its "what was done" note on
// Today and in the Temperature register; a past day never logged is logged late with a reason. Each write is read back
// from the database: a note changes notes (and updated_at) only, every other column stays as it was; and the same
// edit made in the classic Temperature screen on a twin entry stores an identical row.
// Seed (tests/real/stack.mjs): days 1-6 back are logged at 3-6.x °C on the first two devices; "Pharmacy" is a room with
// 15-25 °C limits, so its readings are excursions. This case writes past days only (tempreg.mjs writes today).
import { ymd } from "../lib.mjs";
const T = "temperature_entries";
export default {
  title: "Temperature notes and late days (Today + register vs classic)",
  async run(t) {
    const devs = (await t.api("GET", "/temperature/devices")).devices || [];
    const room = devs.find((d) => d.name === "Pharmacy");
    if (!t.ok(room, "the seed has the Pharmacy room")) return;
    const at = (day) => t.db.prepare(`SELECT * FROM ${T} WHERE device_id = ? AND entry_date = ?`).get(room.id, day);
    const p = await t.page();

    // 1. Today: yesterday's excursion -> note in the banner -> row read back
    const y = ymd(-1), before = at(y);
    t.ok(before && before.notes === "", "yesterday's room reading is seeded with no note");
    await t.open(p, "2", "today", "today", `.tdy-warn form[data-tnote="${y}|${room.id}"] textarea`);
    const f1 = `.tdy-warn form[data-tnote="${y}|${room.id}"]`;
    await p.click(f1 + ' [data-pick="Door left open, closed, re-checked"]');
    await p.type(f1 + " textarea", " at 09:10", { delay: 10 });
    const w1 = await t.write(p, /\/temperature\/entries$/, () => p.click(f1 + " button[type=submit]"));
    await p.waitForFunction(() => /Note: Door left open/.test((document.querySelector(".tdy-warn") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const after = at(y);
    t.has("today note", after, { notes: "Door left open, closed, re-checked at 09:10" });
    t.same("today note vs the row before it", before, after, { notes: "the note written" });
    t.ok(JSON.stringify(Object.keys(w1.body || {}).sort()) === JSON.stringify(["device_id", "entry_date", "max_temp", "min_temp", "notes"]), "Today sends the classic body's keys: " + JSON.stringify(w1.body));
    t.ok(/Note: Door left open/.test(await p.innerText(".tdy-warn")), "the banner then says what was done");

    // 2. Twins: the same note on two identical readings, one from the register, one from the classic screen
    const A = ymd(-9), B = ymd(-10), vals = { min_temp: 3.4, max_temp: 6.3, notes: "" };
    for (const day of [A, B]) await t.api("POST", "/temperature/entries", { device_id: room.id, entry_date: day, ...vals });
    // the classic screen saves every device's line of a day, so the other devices get a reading on day B too
    for (const dv of devs.filter((d) => d.id !== room.id && Number(d.active) !== 0)) await t.api("POST", "/temperature/entries", { device_id: dv.id, entry_date: B, min_temp: 4, max_temp: 6, notes: "" });
    const NOTE = "Engineer called";
    const beforeA = at(A);
    await p.evaluate((o) => sessionStorage.setItem("eikon_tempreg_day", JSON.stringify(o)), { day: A, device: String(room.id) });
    await t.open(p, "2", "tempreg", "tempreg", ".trg-day h3");
    await p.click('.trg-day [data-act="addnote"]');
    await p.click(`.trg-day [data-pick="${NOTE}"]`);
    await t.write(p, /\/temperature\/entries$/, () => p.click(".trg-day form[data-tnote] button[type=submit]"));
    await p.waitForFunction(() => /Note: Engineer called/.test((document.querySelector(".trg-day") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const newA = at(A);
    t.has("register note", newA, { notes: NOTE, min_temp: 3.4, max_temp: 6.3 });
    t.same("register note vs the row before it", beforeA, newA, { notes: "the note written" });
    // classic: open the day B, write the same note on the room's line, Save (the classic saves every device's line)
    await t.open(p, "classic", "temperature", "temperature", "input.eikon-input[type=date]");
    await p.fill("input.eikon-input[type=date] >> nth=0", B); await p.locator("input.eikon-input[type=date] >> nth=0").dispatchEvent("change");
    const roomRow = p.locator("tr", { has: p.locator("td", { hasText: /^Pharmacy$/ }) }).first();
    await p.waitForFunction((v) => { const r = [...document.querySelectorAll("tr")].find((tr) => tr.firstChild && tr.firstChild.textContent === "Pharmacy"); const n = r && r.querySelectorAll("input[type=number]"); return n && n[0].value === v[0] && n[1].value === v[1]; }, ["3.4", "6.3"], { timeout: 8000 }); // day B's readings (today's may also be 3.4: tempreg.mjs)
    // the classic screen can redraw its lines once more after the date change (its first load landing late): type the
    // note when the lines have settled, and again if a redraw took it
    await p.waitForLoadState("networkidle").catch(() => {});
    for (let i = 0; i < 5; i++) { await roomRow.locator("input[type=text]").fill(NOTE); await p.waitForTimeout(400); if (await roomRow.locator("input[type=text]").inputValue() === NOTE) break; }
    const typedB = await roomRow.locator("input[type=text]").inputValue();
    const wB = await t.write(p, /\/temperature\/entries$/, () => p.locator(".eikon-btn.primary:has-text('Save')").first().click());
    for (let i = 0; i < 50 && at(B).notes !== NOTE; i++) await p.waitForTimeout(100);
    if (at(B).notes !== NOTE) t.note("classic twin: typed " + JSON.stringify(typedB) + ", first POST " + JSON.stringify(wB.body));
    t.same("register note vs classic note on a twin", at(B), newA, { entry_date: "the twins are on different days" });

    // 3. A day never logged: logged late in the register, and the same by hand in the classic screen
    const L = ymd(-12), L2 = ymd(-13);
    t.ok(!at(L) && !at(L2), "the late days have no reading yet");
    await p.evaluate((o) => sessionStorage.setItem("eikon_tempreg_day", JSON.stringify(o)), { day: L, device: String(room.id) });
    await t.open(p, "2", "tempreg", "tempreg", ".trg-day h3");
    await p.click('.trg-day [data-act="late"]');
    await p.fill(".trg-day [name=min]", "18,2"); await p.fill(".trg-day [name=max]", "23.4");
    await p.click(".trg-day form[data-tlate] button[type=submit]"); await p.waitForTimeout(300);
    t.ok(!at(L), "no reason: nothing stored");
    await p.click('.trg-day [data-pick="Reading was on paper, entered now"]');
    await t.write(p, /\/temperature\/entries$/, () => p.click(".trg-day form[data-tlate] button[type=submit]"));
    for (let i = 0; i < 50 && !at(L); i++) await p.waitForTimeout(100);
    const late = at(L);
    t.has("late day", late, { min_temp: 18.2, max_temp: 23.4, notes: "Logged late: Reading was on paper, entered now" });
    await t.api("POST", "/temperature/entries", { device_id: room.id, entry_date: L2, min_temp: 18.2, max_temp: 23.4, notes: "Logged late: Reading was on paper, entered now" });
    t.same("late day vs the same POST the classic screen sends", at(L2), late, { entry_date: "different days" });
    await p.waitForFunction(() => /Note: Logged late/.test((document.querySelector(".trg-day") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
    const txt = await p.innerText(".trg-day").catch(() => "(no panel)");
    t.ok(/Note: Logged late: Reading was on paper/.test(txt) && /18\.2/.test(txt), "the day then shows its reading and the late note: " + txt.replace(/\s+/g, " ").slice(0, 160));
  },
};
