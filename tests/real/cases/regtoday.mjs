// Today's registers (regs-hub): the top of the Registers hub, on the real worker.
// Two pharmacies of their own (the other cases write to the suite's pharmacy at the same time): one with today's gaps
// and problems, one with everything done. Checks the words, the order (overdue, to do, done), the one-tap way into the
// right register and day, "All done for today", the status under the hub's cards, and the cost: opening Registers
// asks the server once (and not again within a minute), never once per register; Today only links here. Read only, except the one save that proves a save refreshes it.
const pad = (n) => (n < 10 ? "0" : "") + n;
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const add = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shiftYm = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); };
const MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

async function pharmacy(t, name, email) {
  const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
  const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, name).lastInsertRowid);
  const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email, role: "admin", name: "Rita Camilleri" });
  const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
  return { loc, token: u.token, api };
}

export default {
  title: "Today's registers",
  async run(t) {
    const today = maltaToday(), lastYm = shiftYm(today.slice(0, 7), -1), lastName = MON[+lastYm.slice(5) - 1];
    const bad = await pharmacy(t, "Registers Today Gaps", "regtoday-bad@demo.mt"), good = await pharmacy(t, "Registers Today Done", "regtoday-good@demo.mt");

    // ---- the pharmacy with gaps: the fridge outside its limits with no note, the room not logged, cleaning 9 days
    // ago, no pharmacist today, a controlled drug supplied last month with no stock-take, a certificate expired.
    const devB = (await bad.api("GET", "/temperature/devices")).devices, fridgeB = devB.find((d) => d.device_type === "fridge") || devB[0];
    await bad.api("POST", "/temperature/entries", { device_id: fridgeB.id, entry_date: today, min_temp: 3, max_temp: 9.5, notes: "" });
    await bad.api("POST", "/cleaning/entries", { entry_date: add(today, -9), time_in: "08:00", time_out: "08:30", cleaner_name: "Ġanni Żammit", staff_name: "Rita", notes: "" });
    await bad.api("POST", "/dda-sales/entries", { entry_date: lastYm + "-10", client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg/ml", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1201", prescription_serial_no: "S9001" });
    const certsB = (await bad.api("GET", "/certificates/items")).items, certB = certsB.find((c) => c.item_key === "thermometer_calibration") || certsB[0];
    await bad.api("PUT", "/certificates/items/" + certB.id, { last_date: add(today, -400), interval_months: 12, certified_person: certB.requires_person ? "Rita Camilleri" : undefined });

    // ---- the complete pharmacy: everything done today, every certificate in date, last month counted
    const devG = (await good.api("GET", "/temperature/devices")).devices;
    for (const dv of devG) await good.api("POST", "/temperature/entries", { device_id: dv.id, entry_date: today, min_temp: dv.device_type === "fridge" ? 3 : 19, max_temp: dv.device_type === "fridge" ? 6 : 23, notes: "" });
    await good.api("POST", "/cleaning/entries", { entry_date: today, time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Rita", notes: "" });
    await good.api("POST", "/locumregister/entries", { entry_date: today, time_in: "08:00", time_out: "19:00", locum_full_name: "Pharm. Daniela Spiteri", registration_number: "PH 1234" });
    await good.api("POST", "/daily-register/entries", { entry_date: today, client_name: "Borg John", client_id: "123456M", medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Abela", prescriber_reg_no: "4321" });
    for (const c of (await good.api("GET", "/certificates/items")).items) await good.api("PUT", "/certificates/items/" + c.id, { last_date: add(today, -40), interval_months: c.interval_months || 12, certified_person: c.requires_person ? "Rita Camilleri" : undefined });
    await good.api("POST", "/dda-sales/entries", { entry_date: lastYm + "-10", client_name: "Vella Anna", client_id_card: "0987654M", client_address: "2 Triq il-Wied", medicine_name_dose: "Alprazolam 0.5mg", quantity: 1, doctor_name: "Dr Galea", doctor_reg_no: "R1202", prescription_serial_no: "S9002" });
    await good.api("POST", "/dda-stocktakes/stocktakes", {});
    const sid = t.db.prepare("SELECT MAX(id) AS m FROM dda_stocktakes WHERE location_id = ?").get(good.loc).m;
    t.db.prepare("UPDATE dda_stocktakes SET created_at = ?, closed_at = ? WHERE id = ?").run(lastYm + "-20 09:00:00", lastYm + "-20 10:00:00", sid);
    // last month signed off for every register (the gaps pharmacy has signed nothing)
    for (const register of ["temperature", "cleaning", "daily", "locum", "receipts"]) await good.api("POST", "/registers/signoffs", { register, month: lastYm, note: "" });

    const look = async (P, { phone = false } = {}) => {
      const p = await t.page({ phone }), reqs = [];
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, P.token);
      p.on("request", (r) => { const u = new URL(r.url()); if (u.port === new URL(t.base).port && !u.pathname.startsWith("/ui/") && r.method() === "GET") reqs.push(u.pathname); });
      await t.open(p, "2", "registers", "registers", ".rgt-sum, .rgt-err");
      const rows = await p.evaluate(() => [...document.querySelectorAll(".rgt-row")].map((r) => ({ key: r.dataset.rgt, cls: r.classList[1], title: r.querySelector(".rgt-t b").childNodes[0].textContent.trim(), text: r.querySelector(".rgt-t > span").textContent, btn: r.querySelector("button").textContent.trim() })));
      const head = await p.textContent(".rgt-sum");
      return { p, reqs, rows, head };
    };

    // ---- gaps
    const B = await look(bad);
    t.ok(B.reqs.filter((x) => x === "/registers/today").length === 1, "Registers asked /registers/today once: " + JSON.stringify(B.reqs));
    t.ok(!B.reqs.some((x) => /\/(entries|devices|items|stocktakes)$/.test(x)), "no read per register on opening: " + JSON.stringify(B.reqs));
    const by = (k) => B.rows.find((r) => r.key === k) || {};
    const fr = by("temp:" + fridgeB.id), room = B.rows.find((r) => /^temp:/.test(r.key) && r.key !== "temp:" + fridgeB.id) || {};
    t.ok(fr.cls === "overdue" && /9\.5 °C is outside/.test(fr.text) && fr.btn === "Add note", "fridge outside its limits, no note: " + JSON.stringify(fr));
    const roomDev = devB.find((d) => "temp:" + d.id === room.key) || {};
    const seededRoom = /^pharmacy$/i.test(roomDev.name) || roomDev.name.toLowerCase() === "registers today gaps";
    t.ok(room.cls === "todo" && room.title === "Temperature · " + (seededRoom ? "Room" : roomDev.name) && room.text === "Not logged yet today." && room.btn === "Log", "seeded room sensor reads Room, never 'Room · Room' (D9, H6): " + JSON.stringify(room));
    t.ok(fr.title === "Temperature · " + fridgeB.name, "fridge keeps its stored name: " + fr.title);
    t.ok(!/fridge/i.test(fridgeB.name) || fr.text.indexOf("Fridge · ") !== 0, "no 'Fridge · ' under a name that says it: " + fr.text);
    const marks = await B.p.evaluate(() => [...document.querySelectorAll(".rgt-row")].map((r) => r.querySelectorAll(".rgt-pill").length));
    t.ok(marks.every((n) => n === 0), "one status marker per row, no chip beside it (H5)");
    const red = await B.p.evaluate(() => { const r = document.querySelector('[data-rgt="cd"] .rgt-t > span'); return { all: getComputedStyle(r).color, hot: (r.querySelector(".rgt-hot") || {}).textContent || "" }; });
    t.ok(red.hot === "was not counted" && !/^rgb\(2[01]\d, 3\d, 2\d\)$/.test(red.all), "only the key words coloured (H6): " + JSON.stringify(red));
    t.ok(by("clean").cls === "overdue" && /last done 9 days ago/.test(by("clean").text) && /Ġanni Żammit/.test(by("clean").text), "cleaning overdue, with the name as typed: " + JSON.stringify(by("clean")));
    t.ok(by("locum").cls === "todo" && by("locum").btn === "Sign in", "no pharmacist in charge: " + JSON.stringify(by("locum")));
    const early = Number(today.slice(8)) <= 7;
    t.ok(by("cd").cls === (early ? "todo" : "overdue") && by("cd").text.indexOf(lastName) === 0, "stock take for " + lastName + ": " + JSON.stringify(by("cd")));
    t.ok(by("cert").cls === "overdue" && by("cert").text.indexOf(certB.title + " expired") === 0, "expired certificate: " + JSON.stringify(by("cert")));
    t.ok(by("sign").cls === "todo" && /^0 registers of 5 signed off\./.test(by("sign").text) && by("sign").btn === "Sign", "last month not signed off: shown whatever the date (owner, 9 Nov): " + JSON.stringify(by("sign")));
    // nothing expired but dates missing: never a tick (Visual QA H1) — the hub says what is not on file
    await bad.api("PUT", "/certificates/items/" + certB.id, { last_date: add(today, -40), interval_months: 12, certified_person: certB.requires_person ? "Rita Camilleri" : undefined });
    const B2 = await look(bad), c2 = B2.rows.find((r) => r.key === "cert") || {};
    t.ok(c2.cls === "todo" && /certificates? ha(s|ve) no date on file/.test(c2.text) && c2.btn === "Add dates", "certificates with no date are not 'All in date': " + JSON.stringify(c2));
    t.ok(by("daily").cls === "info" || by("daily").cls === "todo", "daily register: for information until closing: " + JSON.stringify(by("daily")));
    const rank = { overdue: 0, todo: 1, info: 2, done: 3 }, order = B.rows.map((r) => rank[r.cls]);
    t.ok(order.every((v, i) => !i || order[i - 1] <= v), "overdue first, then to do, then done: " + B.rows.map((r) => r.cls).join(","));
    t.ok(/things to do today, \d+ overdue\./.test(B.head), "headline: " + B.head);
    // the room's reading typed right here: errors at once next to the fields, then Today's own save and body
    const rs = '[data-rgt="' + room.key + '"]';
    await B.p.fill(rs + ' [name="min"]', "19,4"); await B.p.click(rs + " button");
    t.ok(/Write both the lowest and the highest reading/.test(await B.p.textContent(rs + " .rgt-msg")) && await B.p.getAttribute(rs + ' [name="max"]', "aria-invalid") === "true", "missing max: said next to the fields, nothing saved");
    await B.p.fill(rs + ' [name="max"]', "23.1");
    const before = t.maxId("temperature_entries");
    const w = await t.write(B.p, /^\/temperature\/entries$/, () => B.p.press(rs + ' [name="max"]', "Enter"));
    t.ok(JSON.stringify(w.body) === JSON.stringify({ device_id: roomDev.id, entry_date: today, min_temp: 19.4, max_temp: 23.1, notes: "" }), "the body Today sends: " + JSON.stringify(w.body));
    const saved = await t.mine("temperature_entries", before, { device_id: roomDev.id, entry_date: today });
    t.ok(saved.length === 1 && saved[0].min_temp === 19.4 && saved[0].max_temp === 23.1 && saved[0].notes === "", "stored: " + JSON.stringify(saved[0] || null));
    await B.p.waitForFunction((k) => { const r = document.querySelector('[data-rgt="' + k + '"]'); return r && r.classList.contains("done"); }, room.key, { timeout: 10000 });
    t.ok(/Logged 19\.4 to 23\.1 °C/.test(await B.p.textContent(rs)), "the row turns done without a reload");
    // a save anywhere makes the list stale: back on Registers it asks again and shows the cleaning done
    await B.p.evaluate(() => { window.location.hash = "#cleanreg"; });
    await B.p.waitForFunction(() => window.EIKON.state.activeModuleId === "cleanreg", null, { timeout: 10000 }); await t.idle(B.p);
    B.reqs.length = 0;
    await B.p.evaluate((d) => window.EIKON.apiFetch("/cleaning/entries", { method: "POST", body: JSON.stringify({ entry_date: d, time_in: "09:00", time_out: "09:20", cleaner_name: "Karl", staff_name: "Rita", notes: "" }) }), today);
    await B.p.evaluate(() => { window.location.hash = "#registers"; });
    await B.p.waitForFunction(() => { const r = document.querySelector('[data-rgt="clean"]'); return r && r.classList.contains("done"); }, null, { timeout: 10000 });
    t.ok(B.reqs.filter((x) => x === "/registers/today").length === 1, "asked again after the save: " + JSON.stringify(B.reqs));
    t.ok(/Done today by Karl/.test(await B.p.textContent('[data-rgt="clean"]')), "cleaning now done today");

    // ---- complete pharmacy, on a phone: all done, with the status under the hub's cards
    const G = await look(good, { phone: true });
    t.ok(/^All done for today\.$/.test(G.head.trim()), "all done: " + G.head + " " + JSON.stringify(G.rows.filter((r) => r.cls !== "done")));
    t.ok(G.rows.length >= 6 && G.rows.every((r) => r.cls === "done" || (r.key === "daily" && r.cls === "info")) && G.rows.find((r) => r.key === "daily").text === "1 line today.", "every line done; the daily register for information, no tick (H7): " + G.rows.map((r) => r.key + ":" + r.cls).join(","));
    const gs = G.rows.find((r) => r.key === "sign");
    t.ok(Number(today.slice(8)) <= 7 ? gs && gs.cls === "done" : !gs, "last month signed off: a done line in the first week only: " + JSON.stringify(gs || null));
    t.ok(G.rows.find((r) => r.key === "cd").text === lastName + " counted on 20 " + ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][+lastYm.slice(5) - 1] + ".", "stock take counted: " + JSON.stringify(G.rows.find((r) => r.key === "cd")));
    const chips = await G.p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".hub-card[data-open]")].map((c) => [c.dataset.open, (c.querySelector(".rgt-chip") || {}).textContent || ""])));
    t.ok(chips.temperature === "Done today" && chips.cleaning === "Done today" && chips.dailyregister === "1 line today" && chips.locumregister === "In charge: Pharm. Daniela Spiteri" && chips.certificates === "All in date", "status under the cards: " + JSON.stringify(chips));
    t.ok(!chips["dda-sales"] && !chips["dda-purchases"] && !chips.dda_stocktakes, "no status on controlled-drug cards");
    // back on Registers within the minute: nothing asked again
    await G.p.evaluate(() => { window.location.hash = "#today"; });
    await G.p.waitForSelector('.tdy-lab a[data-open="#registers"]', { timeout: 15000 });
    await t.idle(G.p);
    G.reqs.length = 0;
    await G.p.click('.tdy-lab a[data-open="#registers"]');
    await G.p.waitForFunction(() => window.EIKON.state.activeModuleId === "registers" && document.querySelector(".rgt-sum"), null, { timeout: 10000 });
    await t.idle(G.p);
    t.ok(!G.reqs.includes("/registers/today"), "Registers again within a minute asked nothing: " + JSON.stringify(G.reqs));
    // Today is untouched: no registers block, no extra request for Registers
    const td = await t.stack.app.api("GET", "/today", { token: good.token });
    t.ok(td.json && td.json.registers === undefined, "/today carries nothing new");
    const wide = await G.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    t.ok(wide, "no sideways scroll on a phone");
    const small = await G.p.evaluate(() => [...document.querySelectorAll(".rgt button")].filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((b) => b.textContent));
    t.ok(!small.length, "44 px targets on a phone: " + JSON.stringify(small));
  }
};
