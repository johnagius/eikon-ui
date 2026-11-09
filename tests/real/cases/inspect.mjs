// Inspection check (insreg): read only, so nothing to compare with a classic screen. Two pharmacies of their own (so the
// other cases writing at the same time cannot change what is found): one seeded through the real worker with known gaps
// and problems, one complete. The screen must report every seeded problem, with the right words, and nothing on the
// complete one. Days are Malta days.
const pad = (n) => (n < 10 ? "0" : "") + n;
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const add = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shiftYm = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); };
const lastDay = (ym) => ym + "-" + pad(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate());
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const dayText = (s) => Number(s.slice(8)) + " " + SHORT[+s.slice(5, 7) - 1];

async function pharmacy(t, name, email) {
  const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
  const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, name).lastInsertRowid);
  const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email, role: "admin", name: "Rita Camilleri" });
  const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
  return { loc, token: u.token, api };
}

export default {
  title: "Inspection check",
  async run(t) {
    const today = maltaToday(), L = shiftYm(today.slice(0, 7), -1), M2 = shiftYm(L, -1), from = M2 + "-01", to = lastDay(L);
    const days = []; for (let d = from; d <= to; d = add(d, 1)) days.push(d);
    let mon = L + "-01"; while (new Date(mon + "T12:00:00Z").getUTCDay() !== 1) mon = add(mon, 1); // first Monday of last month: that week is left without a cleaning
    const skipWeek = (d) => d >= mon && d <= add(mon, 6);
    const MISS = [L + "-05", L + "-09"], OUT = L + "-12", NOTED = L + "-14", NOPHARM = [L + "-15", L + "-16"], DDA_DAY = M2 + "-10";

    // ---- seed: the pharmacy with problems, and the complete one
    const seed = async (P, problems) => {
      const devs = (await P.api("GET", "/temperature/devices")).devices;
      t.db.prepare("UPDATE temperature_devices SET created_at = ? WHERE location_id = ?").run(add(from, -30) + " 08:00:00", P.loc); // set up long before
      for (const d of days) for (const dv of devs) {
        const fridge = dv.device_type === "fridge";
        if (problems && fridge && MISS.includes(d)) continue;
        const hi = problems && fridge && d === OUT ? 9.5 : problems && fridge && d === NOTED ? 9 : fridge ? 6 : 22;
        await P.api("POST", "/temperature/entries", { device_id: dv.id, entry_date: d, min_temp: fridge ? 3 : 19, max_temp: hi, notes: problems && fridge && d === NOTED ? "Delivery left the door open; stock checked" : "" });
      }
      for (const d of days) if (new Date(d + "T12:00:00Z").getUTCDay() === 3 && !(problems && skipWeek(d))) await P.api("POST", "/cleaning/entries", { entry_date: d, time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Rita", notes: "" });
      for (const d of days) if (!(problems && NOPHARM.includes(d))) await P.api("POST", "/locumregister/entries", { entry_date: d, time_in: "08:00", time_out: "19:00", locum_full_name: "Pharm. Daniela Spiteri", registration_number: "PH 1234" });
      for (const d of days.filter((x, i) => i % 3 === 0)) await P.api("POST", "/daily-register/entries", { entry_date: d, client_name: "Borg John", client_id: "123456M", medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Abela", prescriber_reg_no: "4321" });
      const certs = (await P.api("GET", "/certificates/items")).items;
      for (const c of certs) {
        let last = add(today, -40); // in date
        if (problems && c.item_key === "thermometer_calibration") last = add(today, -400); // 12 months: expired about a month ago
        else if (problems && c.item_key === "ac_maintenance") last = add(add(today, 10), -365); // due in about 10 days
        else if (problems) continue; // the rest not recorded (for information only)
        await P.api("PUT", "/certificates/items/" + c.id, { last_date: last, interval_months: c.interval_months, certified_person: c.requires_person ? "Rita Camilleri" : undefined });
      }
      // a stock-take for last month (on its 20th); the problem pharmacy also supplied a controlled drug the month before, with no stock-take
      for (const ym of problems ? [L] : [M2, L]) { // the complete pharmacy counted both months
        await P.api("POST", "/dda-stocktakes/stocktakes", {});
        const sid = t.db.prepare("SELECT MAX(id) AS m FROM dda_stocktakes WHERE location_id = ?").get(P.loc).m;
        t.db.prepare("UPDATE dda_stocktakes SET created_at = ?, closed_at = ? WHERE id = ?").run(ym + "-20 09:00:00", ym + "-20 10:00:00", sid);
      }
      if (problems) await P.api("POST", "/dda-sales/entries", { entry_date: DDA_DAY, client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja, Valletta", medicine_name_dose: "Morphine 10mg/ml", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1201", prescription_serial_no: "S5001" });
    };
    const bad = await pharmacy(t, "Inspect Problems Pharmacy", "inspect-bad@demo.mt"), good = await pharmacy(t, "Inspect Complete Pharmacy", "inspect-good@demo.mt");
    await seed(bad, true); await seed(good, false);

    // ---- the screen, for the two months, from each pharmacy's own sign-in
    const look = async (P) => {
      const p = await t.page(), reqs = [];
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, P.token); // this pharmacy's sign-in, not the suite's
      p.on("request", (r) => { const u = new URL(r.url()); if (u.port === new URL(t.base).port && !u.pathname.startsWith("/ui/") && r.method() === "GET" && /entries|devices|items|stocktakes/.test(u.pathname)) reqs.push(u.pathname + u.search); });
      await t.open(p, "2", "insreg", "insreg", ".ins-list");
      await p.waitForFunction(() => !window.EIKON.inspect.state.job && window.EIKON.inspect.state.result, null, { timeout: 20000 }); // this month, read on opening
      reqs.length = 0;
      await p.click('[data-range="custom"]'); await p.fill("#ins-from", from); await p.fill("#ins-to", to);
      const t0 = Date.now();
      await p.click('[data-act="check"]');
      await p.waitForFunction((r) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === r[0] && s.result.range.to === r[1]; }, [from, to], { timeout: 20000 });
      const ms = Date.now() - t0;
      const rows = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".ins-reg")].map((r) => [r.dataset.reg, { pill: r.querySelector(".ins-pill").textContent, text: r.querySelector("ul").innerText.replace(/\s+/g, " ") }])));
      const head = await p.textContent(".ins-head");
      return { p, rows, head, reqs: reqs.slice(), ms };
    };
    const B = await look(bad);
    const R = B.rows, T = (k) => (R[k] && R[k].text) || "";
    t.note(`problem pharmacy: ${B.reqs.length} requests, ${B.ms} ms; head: ${B.head}`);
    t.ok(R.temperature && R.temperature.pill === "Missing", "temperature should be Missing: " + JSON.stringify(R.temperature));
    t.ok(T("temperature").includes("Pharmacy Fridge: 2 days without a reading (" + dayText(MISS[0]) + " and " + dayText(MISS[1]) + ")"), "the two fridge days not logged are named: " + T("temperature"));
    t.ok(T("temperature").includes("Pharmacy Fridge: 1 reading outside 2 to 8 °C without a note (" + dayText(OUT) + " 3 to 9.5 °C)"), "the reading outside the limits without a note is named: " + T("temperature"));
    t.ok(T("temperature").includes("1 reading outside the limits, with a note"), "the reading with a note is for information: " + T("temperature"));
    t.ok(!/Pharmacy: \d+ days? without/.test(T("temperature")), "the room, logged every day, is not reported: " + T("temperature"));
    t.ok(R.cleaning && R.cleaning.pill === "Missing" && T("cleaning").includes("No cleaning recorded in 1 week: week of " + dayText(mon) + "."), "the week without a cleaning is named: " + JSON.stringify(R.cleaning));
    t.ok(R.locum && R.locum.pill === "Look at this" && T("locum").includes("2 days with work recorded but no pharmacist in charge in the locum register (" + dayText(NOPHARM[0]) + " and " + dayText(NOPHARM[1]) + ")"), "the two days without a pharmacist: " + JSON.stringify(R.locum));
    t.ok(R.certificates && R.certificates.pill === "Missing" && /Thermometer calibration expired on/.test(T("certificates")) && /AC maintenance is due on .* \(in (9|10|11) days\)/.test(T("certificates")) && /Not recorded yet: .*First aid certificate/.test(T("certificates")), "certificates expired, due and not recorded: " + JSON.stringify(R.certificates));
    t.ok(R.dda && R.dda.pill === "Look at this" && T("dda").includes(MON[+M2.slice(5) - 1] + " " + M2.slice(0, 4) + ": controlled drugs were supplied or received (1 line in Controlled drugs supplied)"), "the month with a controlled-drug line and no stock-take: " + JSON.stringify(R.dda));
    t.ok(R.dailyregister && R.dailyregister.pill === "For information", "daily register is for information only: " + JSON.stringify(R.dailyregister));
    t.ok(/3 registers have something missing, 2 need a look\./.test(B.head), "headline: " + B.head);
    t.ok(B.reqs.length <= 3 + 4 * 2 + 3 && B.reqs.every((q) => !/\/(cleaning|temperature|locumregister|daily-register|dda-[a-z]+)\/entries$/.test(q)), "a month per request, " + B.reqs.length + " requests: " + B.reqs.join(" "));
    // a reason opens the exact place: the cleaning week's month
    await B.p.click('.ins-reg[data-reg="cleaning"] .ins-go');
    await B.p.waitForFunction(() => window.EIKON.state.activeModuleId === "cleanreg" && document.querySelector(".emb-lab"), null, { timeout: 10000 });
    t.ok((await B.p.textContent(".emb-lab")).includes(MON[+L.slice(5) - 1]), "Open › goes to Cleaning on " + L);

    const G = await look(good);
    t.note(`complete pharmacy: ${G.reqs.length} requests, ${G.ms} ms; head: ${G.head}`);
    const pills = Object.entries(G.rows).map(([k, v]) => k + ":" + v.pill).join();
    t.ok(pills === "temperature:In order,cleaning:In order,dailyregister:For information,locum:In order,certificates:In order,dda:In order", "the complete pharmacy has nothing to report: " + pills + " · " + JSON.stringify(G.rows));
    t.ok(/Everything checked is in order/.test(G.head), "headline on the complete pharmacy: " + G.head);
    t.ok(G.reqs.length === 3 + 4 * 2, "with its stock-take no DDA lines are read: " + G.reqs.length + " requests");
    // read only: the check itself writes nothing (other cases may write at the same time, so only this pharmacy's rows are counted)
    const rowsFor = (loc) => t.db.prepare("SELECT (SELECT COUNT(*) FROM temperature_entries WHERE location_id = ?) + (SELECT COUNT(*) FROM cleaning_entries WHERE location_id = ?) + (SELECT COUNT(*) FROM locum_register_entries WHERE location_id = ?) AS c").get(loc, loc, loc).c;
    const n0 = rowsFor(good.loc); await G.p.click('[data-act="again"]'); await G.p.waitForFunction(() => !window.EIKON.inspect.state.job && window.EIKON.inspect.state.result, null, { timeout: 15000 });
    t.ok(rowsFor(good.loc) === n0, "checking again writes nothing");
  },
};
