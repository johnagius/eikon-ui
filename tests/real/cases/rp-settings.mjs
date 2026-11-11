// Roster planner, rules and settings (SPEC §13 A13 + classic round-trip): every settings edit done once in the CLASSIC
// Shifts screen and once in the planner's sheets (E.rotaSet, ui/eikon.rotaset.js), from the same stored state; the
// stored row must be byte-identical (key order too):
//  - weekly opening hours (Monday changed, copied to Tue–Fri, Sunday opened), a closed day, a duty Sunday, removing a day;
//  - cover rules (pharmacist required, minimum pharmacists) and the Malta reference, on settings that already hold a
//    calendar token and the planner's own rota.* keys: classic keeps those keys, the planner's body equals classic's;
//  - the planner's rota.* keys (minimum people, warnings off, availability) written read-fresh-merge, then a classic
//    Rules save keeps them;
//  - a person's details, deactivate and activate: the shift_staff row equals the classic Edit Employee / Deactivate row;
//  - delete names how many shifts go, offers Deactivate instead, and the classic cascade removes shifts and leave.
// A pharmacy of its own (its own settings row), so the other cases' cover is untouched.
import { maltaYmd, ymdAdd } from "../../clock.mjs";

export default {
  title: "Roster planner: opening hours, rules, Malta reference, availability, person details = classic",
  async run(t) {
    const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const lid = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
    db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, 'Rota Settings Pharmacy')").run(lid, org);
    const A = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "rp-settings@demo.mt", role: "admin", name: "Ġanni Rota" });
    const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: A.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    await api("GET", "/shifts/settings"); // the tables
    const H = () => (db.prepare("SELECT hours_json FROM shift_opening_hours WHERE org_id = ? AND location_id = ?").get(org, lid) || {}).hours_json;
    const SET = () => (db.prepare("SELECT settings_json FROM shift_settings WHERE org_id = ? AND location_id = ?").get(org, lid) || {}).settings_json;
    const today = maltaYmd(0), sunday = ymdAdd(today, 14 - new Date(today + "T12:00:00Z").getUTCDay()), d1 = ymdAdd(today, 20), d2 = ymdAdd(today, 30);
    const hoursSeed = { default: { open: "07:30", close: "19:30", closed: false }, openSaturday: true, openSunday: false, overrides: { [d2]: { open: "08:00", close: "13:00", closed: false, note: "Half day" } } };
    const setSeed = { pharmacistRequired: true, minPharmacists: 1, calendarToken: "rpsettingstoken0123", rota: { plans: { 7: { rid: "k3f9", from: today, through: ymdAdd(today, 364), keep: true } }, minStaff: 3 } };

    const page = async () => {
      const p = await t.page();
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, A.token);
      return p;
    };
    const p = await page();
    const classic = async (tab, ready) => { await t.open(p, "classic", "shifts", "shifts", "#sh-tabbar"); await p.click(`[data-tab=${tab}]`); await p.waitForSelector(ready); await t.idle(p); };
    const planner = async (kind, arg) => {
      await p.goto("about:blank"); await t.open(p, "2", "shfreg", "shfreg"); // a fresh page each time (the same address would keep the last sheet)
      await p.evaluate(([k, a]) => window.EIKON.rotaSet.open(k, a), [kind, arg]);
      await p.waitForSelector(`.rps-ov[data-rotaset=${kind}] .rps form, .rps-ov[data-rotaset=${kind}] .rps-bal, .rps-ov[data-rotaset=${kind}] .rps h3`); await t.idle(p);
    };
    const both = async (label, read, seed, doClassic, doNew) => {
      await seed(); await doClassic(); await p.waitForTimeout(150); const c = read();
      await seed(); await doNew(); await p.waitForTimeout(150); const n = read();
      t.ok(c && n && c === n, label + ": stored JSON byte-identical to the classic screen's: classic " + c + " · planner " + n);
      return n;
    };
    const putHours = () => api("PUT", "/shifts/opening-hours", hoursSeed), putSet = () => api("PUT", "/shifts/settings", setSeed);
    await putSet();

    // ---- weekly hours: Monday 08:00–18:00, copied to Tue–Fri, Sunday open 09:00–12:00 ----
    await both("weekly hours", H, putHours,
      async () => { await classic("settings", "#ss-savehours"); await p.fill("#ss-w1-open", "08:00"); await p.fill("#ss-w1-close", "18:00"); await p.click("#ss-copy-weekdays"); await p.uncheck("#ss-w0-closed"); await p.fill("#ss-w0-open", "09:00"); await p.fill("#ss-w0-close", "12:00");
        await t.write(p, /\/shifts\/opening-hours$/, () => p.click("#ss-savehours"), "PUT"); },
      async () => { await planner("hours"); const f = ".rps [data-f=week]"; await p.fill(f + " [name=from1]", "08:00"); await p.fill(f + " [name=to1]", "18:00"); await p.click(f + " [data-act=copy5]"); await p.check(f + " [name=open0]"); await p.fill(f + " [name=from0]", "09:00"); await p.fill(f + " [name=to0]", "12:00");
        await t.write(p, /\/shifts\/opening-hours$/, () => p.click(f + " [type=submit]"), "PUT");
        await p.waitForSelector(f + " .rps-msg.ok"); });
    const wk = JSON.parse(H()).weekly;
    t.ok(wk[1].open === "08:00" && wk[5].close === "18:00" && wk[0].closed === false && wk[0].open === "09:00" && wk[6].open === "07:30", "the hours are what was typed: " + JSON.stringify(wk));
    // a bad time is said in words next to the field, nothing sent
    { let sent = 0; const on = (r) => { if (r.method() === "PUT") sent++; }; p.on("request", on);
      await p.fill(".rps [data-f=week] [name=to3]", "07:00"); await p.click(".rps [data-f=week] [type=submit]"); await p.waitForTimeout(200);
      const e = await p.evaluate(() => ({ msg: document.querySelector(".rps [data-f=week] .rps-msg").textContent, role: document.querySelector(".rps [data-f=week] .rps-msg").getAttribute("role"), inv: document.activeElement.getAttribute("name") }));
      p.off("request", on); t.ok(sent === 0 && /^Wednesday: the closing time must be after the opening time\.$/.test(e.msg) && e.role === "alert" && e.inv === "to3", "closing before opening: words, focus on the field, nothing sent: " + JSON.stringify(e)); }

    // ---- a day closed (with a note), a duty Sunday, removing a day ----
    await both("a closed day", H, putHours,
      async () => { await classic("settings", "#ss-addov"); await p.fill("#ss-ovd", d1); await p.selectOption("#ss-ovt", "closed"); await p.fill("#ss-ovn", "Festa Ħal Qormi"); await t.write(p, /\/shifts\/opening-hours$/, () => p.click("#ss-addov"), "PUT"); },
      async () => { await planner("hours"); const f = ".rps [data-f=ov]"; await p.fill(f + " [name=date]", d1); await p.check(f + " [name=kind][value=closed]"); await p.fill(f + " [name=note]", "Festa Ħal Qormi"); await t.write(p, /\/shifts\/opening-hours$/, () => p.click(f + " [type=submit]"), "PUT"); });
    await both("a duty Sunday", H, putHours,
      async () => { await classic("settings", "#ss-addov"); await p.fill("#ss-ovd", sunday); await p.fill("#ss-ovo", "07:30"); await p.fill("#ss-ovc", "19:30"); await p.fill("#ss-ovn", "Duty roster"); await t.write(p, /\/shifts\/opening-hours$/, () => p.click("#ss-addov"), "PUT"); },
      async () => { await planner("hours"); const f = ".rps [data-f=ov]"; await p.click(f + " [data-act=duty]");
        const pre = await p.evaluate((f) => ({ d: document.querySelector(f + " [name=date]").value, n: document.querySelector(f + " [name=note]").value, a: document.querySelector(f + " [name=from]").value, z: document.querySelector(f + " [name=to]").value }), f);
        t.ok(pre.n === "Duty roster" && new Date(pre.d + "T12:00:00Z").getUTCDay() === 0 && pre.a === "07:30" && pre.z === "19:30", "Duty Sunday fills the next Sunday, the hours and the note: " + JSON.stringify(pre));
        await p.fill(f + " [name=date]", sunday); await t.write(p, /\/shifts\/opening-hours$/, () => p.click(f + " [type=submit]"), "PUT"); await p.waitForSelector(".rps [data-list=ov] [data-d='" + sunday + "']"); });
    await both("removing a day", H, putHours,
      async () => { await classic("settings", "#ss-addov"); await t.write(p, /\/shifts\/opening-hours$/, () => p.click(`.sh-rm-ov[data-d="${d2}"]`), "PUT"); },
      async () => { await planner("hours"); await t.write(p, /\/shifts\/opening-hours$/, () => p.click(`.rps [data-act=ov-rm][data-d="${d2}"]`), "PUT"); });
    // the grid's "Open this day…": a public holiday opened by an override
    const hol = (() => { for (let d = today, i = 0; i < 400; i++, d = ymdAdd(d, 1)) if (/-(12-25|12-08|01-01)$/.test(d)) return d; })();
    await both("open a public holiday", H, putHours,
      async () => { await classic("settings", "#ss-addov"); await p.fill("#ss-ovd", hol); await p.fill("#ss-ovo", "09:00"); await p.fill("#ss-ovc", "12:00"); await p.fill("#ss-ovn", ""); await t.write(p, /\/shifts\/opening-hours$/, () => p.click("#ss-addov"), "PUT"); },
      async () => { await planner("day", hol); const f = ".rps [data-f=day]";
        const pre = await p.evaluate((f) => ({ kind: document.querySelector(f + " [name=kind]:checked").value, btn: document.querySelector(f + " [type=submit]").textContent, head: document.querySelector(".rps p.sub").textContent }), f);
        t.ok(pre.kind === "open" && pre.btn === "Open this day" && /Closed · Public holiday/.test(pre.head), "a holiday from the grid: Open this day, open chosen: " + JSON.stringify(pre));
        await p.fill(f + " [name=from]", "09:00"); await p.fill(f + " [name=to]", "12:00");
        await t.write(p, /\/shifts\/opening-hours$/, () => p.click(f + " [type=submit]"), "PUT"); await p.waitForSelector(".rps-ov", { state: "detached" }); });
    // What the other screens read from it: E.teamCover on the stored JSON says the holiday is open 09:00–12:00.
    const cov = await p.evaluate(([d, h]) => window.EIKON.teamCover(d, { hours: JSON.parse(h), settings: {}, shifts: [], staff: [] }), [hol, H()]);
    t.ok(!cov.closed && cov.open === "09:00" && cov.close === "12:00", "the opened holiday reads as open 09:00–12:00 everywhere (E.teamCover): " + JSON.stringify(cov));

    // ---- rules and the Malta reference: classic keeps the planner's keys, the planner's body equals classic's ----
    await both("cover rules", SET, putSet,
      async () => { await classic("settings", "#ss-saverules"); await p.selectOption("#ss-rph", "0"); await p.fill("#ss-mph", "2"); await t.write(p, /\/shifts\/settings$/, () => p.click("#ss-saverules"), "PUT"); },
      async () => { await planner("rules"); const f = ".rps [data-f=rules]"; await p.selectOption(f + " [name=req]", "0"); await p.fill(f + " [name=minph]", "2"); await t.write(p, /\/shifts\/settings$/, () => p.click(f + " [type=submit]"), "PUT"); });
    const s1 = JSON.parse(SET());
    t.ok(s1.pharmacistRequired === false && s1.minPharmacists === 2 && s1.calendarToken === setSeed.calendarToken && JSON.stringify(s1.rota) === JSON.stringify(setSeed.rota), "classic's Rules save kept the calendar token and rota.* as they were: " + SET());
    await both("Malta reference", SET, putSet,
      async () => { await classic("settings", "#ss-editmalta"); await p.click("#ss-editmalta"); await p.waitForSelector("#ml-al"); await p.fill("#ml-al", "224"); await p.fill("#ml-sp", "96"); await p.fill("#ml-cola", "5.12"); await p.fill("#ml-mx", "48");
        await t.write(p, /\/shifts\/settings$/, () => p.click(".eikon-modal-actions button:has-text('Save')"), "PUT"); },
      async () => { await planner("rules"); await p.click(".rps [data-act=ml-edit]"); const f = ".rps [data-f=ml]"; await p.fill(f + " [name=al]", "224"); await p.fill(f + " [name=sp]", "96"); await p.fill(f + " [name=cola]", "5.12"); await p.fill(f + " [name=mx]", "48");
        await t.write(p, /\/shifts\/settings$/, () => p.click(f + " [type=submit]"), "PUT"); await p.waitForSelector(".rps [data-f=rules] .rps-msg.ok"); });
    const ref = await p.evaluate(() => [...document.querySelectorAll(".rps [data-list=ref] .rps-row")].map((r) => r.innerText.replace(/\s+/g, " ")).join(" | "));
    t.ok(new RegExp("Annual leave, full time " + today.slice(0, 4) + " 224 h").test(ref) && /Sick leave paid 96 h/.test(ref), "the reference shows the saved figures: " + ref);

    // ---- the planner's own keys, read-fresh-merge; then a classic Rules save keeps them ----
    await putSet();
    await planner("rules"); { const f = ".rps [data-f=rules]"; await p.fill(f + " [name=minstaff]", "2"); await p.uncheck(f + " [name=w_twoph]"); await p.uncheck(f + " [name=w_rest]");
      // meanwhile another device changes the calendar token: the planner's save must keep it (read fresh, then merge)
      await api("PUT", "/shifts/settings", { ...setSeed, calendarToken: "otherdevicetoken999" });
      await t.write(p, /\/shifts\/settings$/, () => p.click(f + " [type=submit]"), "PUT"); }
    const s2 = JSON.parse(SET());
    t.ok(s2.calendarToken === "otherdevicetoken999" && s2.rota.minStaff === 2 && s2.rota.warn.twoph === false && s2.rota.warn.rest === false && s2.rota.plans[7].rid === "k3f9", "rules saved read-fresh-merge: another device's change kept, rota.plans kept: " + SET());
    const [P1] = await Promise.all([api("POST", "/shifts/staff", { full_name: "Lara Ħili", designation: "assistant", employment_type: "parttime", contracted_hours: 20, email: "lara@demo.mt", phone: "79 000 111", registration_number: "", is_active: 1, patterns_json: JSON.stringify({ patterns: [], provisionalId: null }) })]);
    const lara = P1.staff_id || P1.id, laraRow = () => db.prepare("SELECT * FROM shift_staff WHERE id = ?").get(lara);
    await planner("avail", laraRow());
    { const f = ".rps [data-f=avail]"; await p.selectOption(f + " [name=w4]", "no"); await p.selectOption(f + " [name=w0]", "only"); await p.fill(f + " [name=w0f]", "12:00"); await p.fill(f + " [name=w0t]", "19:30");
      await p.fill(f + " [name=nd]", d1); await p.click(f + " [data-act=d-add]"); await p.waitForSelector(`.rps [data-list=d] [data-d="${d1}"]`);
      await t.write(p, /\/shifts\/settings$/, () => p.click(".rps [data-f=avail] [type=submit]"), "PUT"); await p.waitForSelector(".rps [data-f=avail] .rps-msg.ok"); }
    const said = await p.evaluate(() => document.querySelector(".rps [data-f=avail] .rps-msg").textContent);
    const av = JSON.parse(SET()).rota.avail[String(lara)];
    t.ok(JSON.stringify(av) === JSON.stringify({ w: { 0: { from: "12:00", to: "19:30" }, 4: "no" }, d: { [d1]: "no" } }) && /Lara: never on Thursdays, Sundays only 12:00–19:30, 1 particular day/.test(said), "availability stored in rota.avail and said in words: " + JSON.stringify(av) + " · " + said);
    const words = await p.evaluate(([s, l, d]) => window.EIKON.rotaCheck.availWords(s, l, d, "08:00", "14:00"), [JSON.parse(SET()), laraRow(), d1]);
    t.ok(/^Lara can't work on .+$/.test(words), "the warnings read it back: " + words);
    const before = JSON.parse(SET()).rota;
    await classic("settings", "#ss-saverules"); await p.fill("#ss-mph", "1"); await t.write(p, /\/shifts\/settings$/, () => p.click("#ss-saverules"), "PUT");
    t.ok(JSON.stringify(JSON.parse(SET()).rota) === JSON.stringify(before), "a classic Rules save afterwards keeps every rota.* key: " + JSON.stringify(JSON.parse(SET()).rota));

    // ---- a person's details, deactivate, activate: the row the classic Edit Employee / Deactivate stores ----
    const seedP = { full_name: "Lara Ħili", designation: "assistant", employment_type: "parttime", contracted_hours: 20, email: "lara@demo.mt", phone: "79 000 111", registration_number: "", is_active: 1, patterns_json: JSON.stringify({ patterns: [], provisionalId: null }) };
    const rowOf = () => { const r = laraRow(); delete r.updated_at; return JSON.stringify(r); };
    const putP = () => api("PUT", "/shifts/staff/" + lara, seedP);
    await both("edit details", rowOf, putP,
      async () => { await classic("staff", "#sh-add-emp"); await p.click(`tr:has-text("Lara Ħili") button:has-text("Edit")`); await p.waitForSelector("#se-name"); await p.fill("#se-name", "Lara Ħili Żammit"); await p.selectOption("#se-type", "fulltime"); await p.fill("#se-hrs", "40"); await p.fill("#se-reg", "PA-778");
        await t.write(p, /\/shifts\/staff\/\d+$/, () => p.click(".eikon-modal-actions button:has-text('Save')"), "PUT"); },
      async () => { await planner("person", laraRow()); const f = ".rps [data-f=person]"; await p.fill(f + " [name=full_name]", "Lara Ħili Żammit"); await p.selectOption(f + " [name=employment_type]", "fulltime"); await p.fill(f + " [name=contracted_hours]", "40"); await p.fill(f + " [name=registration_number]", "PA-778");
        await t.write(p, /\/shifts\/staff\/\d+$/, () => p.click(f + " [type=submit]"), "PUT"); await p.waitForSelector(f + " .rps-msg.ok"); });
    await both("deactivate", rowOf, putP,
      async () => { await classic("staff", "#sh-add-emp"); await t.write(p, /\/shifts\/staff\/\d+$/, () => p.click(`tr:has-text("Lara Ħili") button:has-text("Deactivate")`), "PUT"); },
      async () => { await planner("person", laraRow()); await t.write(p, /\/shifts\/staff\/\d+$/, () => p.click(".rps [data-act=active]"), "PUT"); await p.waitForSelector(".rps [data-k=amsg].ok"); });
    t.ok(laraRow().is_active === 0, "deactivated: is_active 0");
    const offWords = await p.evaluate(() => document.querySelector(".rps [data-k=amsg]").textContent + " / " + document.querySelector(".rps [data-act=active]").textContent);
    t.ok(/Lara is off the planner\. Shifts and leave are kept\. \/ Put back on the rota/.test(offWords), "deactivate says what it kept, and offers putting her back: " + offWords);
    await t.write(p, /\/shifts\/staff\/\d+$/, () => p.click(".rps [data-act=active]"), "PUT");
    t.ok(laraRow().is_active === 1, "put back on the rota: is_active 1");
    // a bad value is said next to the field and nothing is sent
    await planner("person", laraRow());
    { let sent = 0; const on = (r) => { if (r.method() === "PUT") sent++; }; p.on("request", on); const f = ".rps [data-f=person]";
      await p.fill(f + " [name=full_name]", ""); await p.fill(f + " [name=contracted_hours]", "60"); await p.click(f + " [type=submit]"); await p.waitForTimeout(200);
      const e = await p.evaluate(() => ({ msg: document.querySelector(".rps [data-f=person] .rps-msg").textContent, focus: document.activeElement.name, bad: [...document.querySelectorAll(".rps [aria-invalid=true]")].map((x) => x.name).join() }));
      p.off("request", on); t.ok(sent === 0 && e.msg === "Write the person's name. Contracted hours: 1 to 48 a week." && e.focus === "full_name" && e.bad === "full_name,contracted_hours", "errors all at once, next to their fields: " + JSON.stringify(e)); }
    // Escape keeps what was typed: opening the sheet again brings it back
    await p.fill(".rps [data-f=person] [name=phone]", "79 999 888"); await p.keyboard.press("Escape"); await p.waitForSelector(".rps-ov", { state: "detached" });
    await p.evaluate((x) => window.EIKON.rotaSet.open("person", x), laraRow()); await p.waitForSelector(".rps [data-f=person]");
    t.ok(await p.evaluate(() => document.querySelector(".rps [data-f=person] [name=phone]").value) === "79 999 888", "Escape closed the sheet and kept what was typed");
    await p.keyboard.press("Escape");

    // ---- delete: names what goes, Deactivate instead first; the classic cascade ----
    await api("POST", "/shifts/assignments", { staff_id: lara, shift_date: d1, start_time: "08:00", end_time: "14:00", notes: "" });
    await api("POST", "/shifts/assignments", { staff_id: lara, shift_date: d2, start_time: "08:00", end_time: "14:00", notes: "" });
    await api("POST", "/shifts/leaves", { staff_id: lara, leave_type: "annual", start_date: ymdAdd(today, 40), end_date: ymdAdd(today, 40), hours_requested: 8, reason: "", status: "pending" });
    await planner("person", laraRow()); await p.click(".rps [data-act=del]"); await p.waitForSelector(".rps [data-act=del-yes]");
    const conf = await p.evaluate(() => ({ text: document.querySelector(".rps-warn").textContent, btns: [...document.querySelectorAll(".rps [data-k=del] button")].map((b) => b.textContent), focus: document.activeElement.textContent }));
    t.ok(/^Delete Lara Ħili\? This removes them, their 2 shifts and all their leave records\. This cannot be undone\. Deactivate keeps the history\.$/.test(conf.text) && conf.btns.join("|") === "Keep Lara|Deactivate instead|Delete for good" && conf.focus === "Keep Lara", "delete confirm names the shifts, offers Deactivate instead, focus on Keep: " + JSON.stringify(conf));
    await t.write(p, /\/shifts\/staff\/\d+$/, () => p.click(".rps [data-act=del-yes]"), "DELETE");
    const left = { staff: db.prepare("SELECT COUNT(*) n FROM shift_staff WHERE id = ?").get(lara).n, shifts: db.prepare("SELECT COUNT(*) n FROM shift_assignments WHERE staff_id = ?").get(lara).n, leave: db.prepare("SELECT COUNT(*) n FROM shift_leaves WHERE staff_id = ?").get(lara).n };
    t.ok(left.staff === 0 && left.shifts === 0 && left.leave === 0, "deleted with the classic cascade: " + JSON.stringify(left));
  }
};
