// The daily registers' "today first" one-tap saves (eikon.dailyreg.js) store exactly what the classic screens store:
// Cleaning "Record cleaning", Locum register "Sign in now" / "Sign out", Temperature "Log reading" and "Same as
// yesterday". Each new-layout row is compared column by column with the classic screen's row for the same values.
// Also: the month's gaps are listed (a day with work and no pharmacist opens the form on that day), and the
// pharmacist's sign-off of last month is stored once and shown. Solo: it writes today's rows that tempreg/tempnote
// and the locum/cleaning cases also write.
import { ymd } from "../lib.mjs";
export default {
  title: "Daily registers: today first (one-tap saves) and sign-off",
  async run(t) {
    const p = await t.page();
    // ---- Cleaning: Record cleaning (today, now, the last cleaner, the signed-in person as checker)
    {
      const T = "cleaning_entries", who = "Ċensina Żammit";
      await t.open(p, "2", "cleaning", "cleanreg", ".clr-status [name=quick_cleaner]");
      let m = t.maxId(T);
      await p.fill(".clr-status [name=quick_cleaner]", who);
      const w = await t.write(p, /\/cleaning\/entries$/, () => p.click(".clr-status [data-act=quick]"));
      const fresh = (await t.mine(T, m, { cleaner_name: who }))[0];
      t.has("cleaning(today)", fresh, { entry_date: ymd(0), time_out: "", cleaner_name: who, staff_name: "Maria Borg", notes: "" });
      t.ok(w.body && Object.keys(w.body).sort().join() === "cleaner_name,entry_date,notes,staff_name,time_in,time_out", "cleaning(today): the classic body's six fields: " + JSON.stringify(w.body));
      await t.open(p, "classic", "cleaning", "cleaning", "#cl-cleaner");
      m = t.maxId(T);
      await t.fill(p, "", { "#cl-date": fresh.entry_date, "#cl-in": fresh.time_in, "#cl-out": "", "#cl-cleaner": who, "#cl-staff": "Maria Borg", "#cl-notes": "" });
      await t.write(p, /\/cleaning\/entries$/, () => p.click("#cl-save"));
      const classic = (await t.mine(T, m, { cleaner_name: who }))[0];
      t.same("cleaning(today)", classic, fresh);
    }
    // ---- Locum register: Sign in now, then Sign out (the classic edit body, only the time out changed)
    {
      const T = "locum_register_entries", name = "Pharm. Ġużeppi Buħagiar", reg = "PH 7788";
      await t.api("GET", "/locumregister/entries?month=" + ymd(0).slice(0, 7)); // the worker makes the table on first use
      t.db.prepare(`DELETE FROM ${T} WHERE entry_date = ? AND (time_out IS NULL OR time_out = '')`).run(ymd(0)); // nobody in charge now
      await t.open(p, "2", "locumregister", "locreg", ".dly-today [name=quick_name]");
      let m = t.maxId(T);
      await p.fill(".dly-today [name=quick_name]", name); await p.fill(".dly-today [name=quick_reg]", reg);
      await t.write(p, /\/locumregister\/entries$/, () => p.click(".dly-today [data-act=signin]"));
      const fresh = (await t.mine(T, m, { locum_full_name: name }))[0];
      t.has("locum sign in", fresh, { entry_date: ymd(0), time_out: "", locum_full_name: name, registration_number: reg });
      await p.waitForSelector(".dly-today [data-act=signout]", { timeout: 8000 });
      t.ok(/In charge/.test(await p.innerText(".dly-today")) && (await p.innerText(".dly-today")).includes(name), "locum: Today now says who is in charge");
      const out = await t.write(p, /\/locumregister\/entries\/\d+$/, () => p.click(".dly-today [data-act=signout]"), "PUT");
      const after = t.row(T, fresh.id);
      t.ok(out.body && JSON.stringify(Object.keys(out.body).sort()) === JSON.stringify(["entry_date", "locum_full_name", "registration_number", "time_in", "time_out"]), "locum sign out: the classic edit body's five fields: " + JSON.stringify(out.body));
      t.ok(after && /^\d\d:\d\d$/.test(after.time_out) && after.time_in === fresh.time_in && after.locum_full_name === name && after.registration_number === reg && after.entry_date === fresh.entry_date, "locum sign out: only the time out changed: " + JSON.stringify(after));
      // never a previous person (Director D7): signed in as Maria, the last line is someone else -> the form shows Maria or nothing
      await p.goto(t.base + "?ui=2#registers");
      await t.open(p, "2", "locumregister", "locreg", ".dly-today [name=quick_name]");
      const shownName = await p.inputValue(".dly-today [name=quick_name]"), shownReg = await p.inputValue(".dly-today [name=quick_reg]");
      t.ok(shownName !== name && shownReg !== reg && (shownName === "" || /Maria Borg/.test(shownName)), "locum: Sign in is never filled with the previous pharmacist (shows \"" + shownName + "\" / \"" + shownReg + "\")");
      t.ok(/Pharmacist/.test(await p.innerText(".dly-today label[for=lcr-qn]")) && /Reg no/.test(await p.innerText(".dly-today label[for=lcr-qr]")), "locum: the two fields have visible labels");
      // the classic create with the same values stores the same row as Sign in
      await t.open(p, "classic", "locumregister", "locumregister", "#lr-save");
      m = t.maxId(T);
      await p.fill("#lr-date", fresh.entry_date); await p.fill("#lr-in", fresh.time_in); await p.fill("#lr-out", ""); await p.fill("#lr-name", name); await p.fill("#lr-reg", reg);
      await t.write(p, /\/locumregister\/entries$/, () => p.click("#lr-save"));
      const classic = (await t.mine(T, m, { locum_full_name: name }))[0];
      t.same("locum sign in", classic, fresh);
      // a day with work (a reading) but no pharmacist is listed and opens the form on that day
      const devs = (await t.api("GET", "/temperature/devices")).devices || [], gapDay = ymd(-2);
      if (gapDay.slice(0, 7) === ymd(0).slice(0, 7) && devs.length) {
        t.db.prepare(`DELETE FROM ${T} WHERE entry_date = ?`).run(gapDay);
        await t.api("POST", "/temperature/entries", { device_id: devs[0].id, entry_date: gapDay, min_temp: 3, max_temp: 6, notes: "" });
        await t.open(p, "2", "locumregister", "locreg", ".dly-cal");
        await p.waitForSelector(`[data-dly-day="${gapDay}"]`, { timeout: 8000 }).catch(() => {});
        t.ok(/No pharmacist:/.test(await p.innerText(".dly-gaps")), "locum: the days with work and no pharmacist are listed");
        await p.click(`[data-dly-day="${gapDay}"]`); await p.waitForSelector("#lcr-form");
        t.ok(await p.inputValue("#lcr-form [name=entry_date]") === gapDay, "locum: tapping a missed day opens the form on that day");
      } else t.note("locum gap check skipped: two days ago is last month");
    }
    // ---- Temperature: Log reading (typed) and Same as yesterday, against the classic screen's row
    {
      const T = "temperature_entries";
      t.db.prepare(`DELETE FROM ${T} WHERE entry_date = ?`).run(ymd(0));
      // the classic screen in a browser of its own: it keeps an offline queue that a later page load could send again
      const pc = await t.page();
      await t.open(pc, "classic", "temperature", "temperature", "input.eikon-slim-input[type=number]");
      let m = t.maxId(T);
      const n = (await pc.locator("input.eikon-slim-input[type=number]").count()) / 2;
      for (let i = 0; i < n; i++) await t.fill(pc, "", { [`input.eikon-slim-input[type=number] >> nth=${2 * i}`]: "3.4", [`input.eikon-slim-input[type=number] >> nth=${2 * i + 1}`]: "7.2" });
      await t.write(pc, /\/temperature\/entries$/, () => pc.locator(".eikon-btn.primary:has-text('Save')").first().click());
      const classic = (await t.mine(T, m, { entry_date: ymd(0) }))[0];
      await pc.close();
      t.ok(classic, "temperature: the classic screen stored today's reading");
      const dev = classic && classic.device_id;
      t.db.prepare(`DELETE FROM ${T} WHERE entry_date = ?`).run(ymd(0));
      m = t.maxId(T);
      await t.open(p, "2", "temperature", "tempreg", `.trg-due [data-qdev="${dev}"] [name=qmin]`);
      await p.fill(`.trg-due [data-qdev="${dev}"] [name=qmin]`, "3.4"); await p.fill(`.trg-due [data-qdev="${dev}"] [name=qmax]`, "7.2");
      await t.write(p, /\/temperature\/entries$/, () => p.click(`.trg-due [data-act=qlog][data-dev="${dev}"]`));
      const fresh = (await t.mine(T, m, { entry_date: ymd(0), device_id: dev }))[0];
      t.has("temperature(today)", fresh, { entry_date: ymd(0), min_temp: 3.4, max_temp: 7.2, notes: "" });
      t.same("temperature(today)", classic, fresh);
      // Same as yesterday: yesterday within the limits, one tap logs those numbers for today
      const y = ymd(-1);
      if (y.slice(0, 7) === ymd(0).slice(0, 7)) {
        const dv = ((await t.api("GET", "/temperature/devices")).devices || []).find((d) => Number(d.id) === Number(dev)) || {};
        const lo = dv.min_limit != null ? Number(dv.min_limit) : 2, hi = dv.max_limit != null ? Number(dv.max_limit) : 8, ymin = Math.round((lo + 0.5) * 10) / 10, ymax = Math.round((hi - 0.5) * 10) / 10;
        const yr = await t.api("POST", "/temperature/entries", { device_id: dev, entry_date: y, min_temp: ymin, max_temp: ymax, notes: "" });
        t.ok(yr && yr.ok, "seeded yesterday: " + JSON.stringify(yr) + " " + JSON.stringify(dv));
        t.db.prepare(`DELETE FROM ${T} WHERE entry_date = ? AND device_id = ?`).run(ymd(0), dev);
        m = t.maxId(T);
        await p.goto(t.base + "?ui=2#registers"); // a real reload (the same address with the same hash would keep the old screen)
        await t.open(p, "2", "temperature", "tempreg", `.trg-due [data-act=qsame][data-dev="${dev}"]`);
        await t.write(p, /\/temperature\/entries$/, () => p.click(`.trg-due [data-act=qsame][data-dev="${dev}"]`));
        const same = (await t.mine(T, m, { entry_date: ymd(0), device_id: dev }))[0];
        t.has("temperature(same as yesterday)", same, { entry_date: ymd(0), min_temp: ymin, max_temp: ymax, notes: "" });
        t.same("temperature(same as yesterday)", { ...classic, min_temp: ymin, max_temp: ymax }, same);
      } else t.note("same-as-yesterday skipped: yesterday is last month");
    }
    // ---- Sign-off: the pharmacist signs off last month's cleaning once; the card then says who and when
    {
      const last = (() => { const [yy, mm] = ymd(0).split("-").map(Number); return new Date(Date.UTC(yy, mm - 2, 1)).toISOString().slice(0, 7); })();
      try { t.db.prepare("DELETE FROM register_signoffs WHERE register = 'cleaning' AND month = ?").run(last); } catch (e) { /* the table is made by the worker on first use */ }
      await p.goto(t.base + "?ui=2#registers"); await p.waitForFunction(() => window.EIKON && window.EIKON.months, null, { timeout: 20000 });
      await p.evaluate((ym) => window.EIKON.months.openAt("cleanreg", ym), last);
      await t.open(p, "2", "cleaning", "cleanreg", 'form[data-sign="cleaning"]');
      const needNote = await p.getAttribute('form[data-sign="cleaning"] textarea', "aria-required");
      if (needNote === "true") {
        await p.click('form[data-sign="cleaning"] button[type=submit]');
        await p.waitForSelector('form[data-sign="cleaning"] .err:not(:empty)');
        t.ok(t.db.prepare("SELECT COUNT(*) AS c FROM register_signoffs WHERE register='cleaning' AND month=?").get(last).c === 0, "sign-off: with weeks missing, a reason is required first");
      }
      await p.fill('form[data-sign="cleaning"] textarea', "Closed for works one week");
      await t.write(p, /\/registers\/signoffs$/, () => p.click('form[data-sign="cleaning"] button[type=submit]'));
      await p.waitForSelector('[data-signed="cleaning"]', { timeout: 8000 });
      const row = t.db.prepare("SELECT * FROM register_signoffs WHERE register='cleaning' AND month=?").get(last);
      t.ok(row && row.signed_name === "Maria Borg" && row.note === "Closed for works one week", "sign-off: stored once, by the pharmacist, with the note: " + JSON.stringify(row));
      t.ok(/Signed off by Maria Borg/.test(await p.innerText('[data-signed="cleaning"]')), "sign-off: the card says who signed");
    }
  },
};
