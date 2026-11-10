// Team group (new layout): Plan shifts, Handover, Chat board, People who sign in. Each write is driven through the
// screen and the stored row is compared with the row the classic body makes through the API (the classic Shifts,
// Instructions and Message board screens send these same bodies), every column. Also: a group message never
// reaches another group, and the screens' keyboard paths (Escape closes a shift, focus goes back to the day).
import { maltaYmd, ymdAdd } from "../../clock.mjs";
// Malta's calendar (the screens' "this week" and "today"), whatever zone the test machine is on
const weekDay = (i) => { const t = maltaYmd(0); return ymdAdd(t, i - ((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7)); };

export default {
  title: "Team: shifts, handover, board, sign-ins",
  async run(t) {
    // ---------- Plan shifts ----------
    const st = await t.api("POST", "/shifts/staff", { full_name: "Ċensina Żammit", designation: "assistant", employment_type: "fulltime", contracted_hours: 40 });
    const sid = st.staff_id || st.id;
    t.ok(sid, "a person on the rota: " + JSON.stringify(st).slice(0, 120));
    const A = "shift_assignments";
    let m0 = t.maxId(A);
    const cl = await t.api("POST", "/shifts/assignments", { staff_id: sid, shift_date: weekDay(0), start_time: "08:30", end_time: "14:00", notes: "Ħal Qormi run" });
    t.ok(cl && cl.ok, "classic shift body accepted");
    const classicShift = t.since(A, m0)[0];

    const p = await t.page();
    await t.open(p, "2", "shfreg", "shfreg", '.shf-add[data-date="' + weekDay(1) + '"]');
    m0 = t.maxId(A);
    await p.click('.shf-add[data-date="' + weekDay(1) + '"]'); await p.waitForSelector("#shf-form");
    await p.selectOption("#shf-form [name=staff_id]", String(sid));
    await t.fill(p, "#shf-form", { start_time: "08:30", end_time: "14:00", notes: "Ħal Qormi run" });
    await t.write(p, /\/shifts\/assignments$/, () => p.click("#shf-form button[type=submit]"));
    await p.waitForFunction(() => !document.querySelector("#shf-form"));
    const freshShift = t.since(A, m0)[0];
    t.same("shift (add)", classicShift, freshShift, { shift_date: "a different day of the same week" });
    const D = { shiftAdd: freshShift };
    await p.waitForFunction((d) => document.activeElement && document.activeElement.getAttribute("data-date") === d, weekDay(1), { timeout: 5000 }).catch(() => {});
    { const fa = await p.evaluate(() => document.activeElement.outerHTML.slice(0, 120)); t.ok(fa.includes('data-date="' + weekDay(1)), "after Add shift, focus is back on that day's + Add shift: " + fa); }

    // The next + Add shift starts from what was just added (same person, same hours) when that person is free.
    await p.click('.shf-add[data-date="' + weekDay(2) + '"]'); await p.waitForSelector("#shf-form");
    const def = await p.evaluate(() => { const f = document.querySelector("#shf-form"); return { who: f.querySelector("[name=staff_id]").value, s: f.querySelector("[name=start_time]").value, e: f.querySelector("[name=end_time]").value, focus: document.activeElement && document.activeElement.name }; });
    t.ok(def.who === String(sid) && def.s === "08:30" && def.e === "14:00", "next new shift starts from the last one added: " + JSON.stringify(def));
    await p.keyboard.press("Escape"); await p.waitForTimeout(80);
    t.ok(await p.evaluate((d) => !document.querySelector("#shf-form") && document.activeElement.getAttribute("data-date") === d, weekDay(2)), "Escape closes the new shift and focus returns to + Add shift");

    // Change: the whole record is sent; then compare with the classic PUT of the same values on the classic row.
    await p.click('.shf-p[data-act=edit][data-id="' + freshShift.id + '"]'); await p.waitForSelector("#shf-form");
    await t.fill(p, "#shf-form", { start_time: "09:00", end_time: "15:30", notes: "Ċirkewwa" });
    await t.write(p, /\/shifts\/assignments\/\d+$/, () => p.click("#shf-form button[type=submit]"), "PUT");
    await t.api("PUT", "/shifts/assignments/" + classicShift.id, { id: classicShift.id, staff_id: sid, shift_date: classicShift.shift_date, start_time: "09:00", end_time: "15:30", role_override: "", notes: "Ċirkewwa" });
    t.same("shift (change)", t.row(A, classicShift.id), t.row(A, freshShift.id), { shift_date: "a different day of the same week" });
    D.shiftChange = t.row(A, freshShift.id);

    // Remove after the confirm.
    await p.click('.shf-p[data-act=edit][data-id="' + freshShift.id + '"]'); await p.waitForSelector("#shf-form");
    await p.click("#shf-form [data-act=del]"); await p.waitForSelector("#shf-form [data-act=del-yes]");
    await t.write(p, /\/shifts\/assignments\/\d+$/, () => p.click("#shf-form [data-act=del-yes]"), "DELETE");
    await p.waitForTimeout(300);
    t.ok(!t.row(A, freshShift.id), "the removed shift is gone from the table");

    // Leave: approve one request (assistant: no cover question).
    const lv = await t.api("POST", "/shifts/leaves", { staff_id: sid, leave_type: "annual", start_date: weekDay(4), end_date: weekDay(4), reason: "Festa f'Għargħur" });
    const lv2 = await t.api("POST", "/shifts/leaves", { staff_id: sid, leave_type: "annual", start_date: weekDay(5), end_date: weekDay(5), reason: "" });
    await p.evaluate(() => { location.hash = "#team"; }); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "team");
    await p.evaluate(() => { location.hash = "#shfreg"; }); await p.waitForSelector('[data-act=lv-approve][data-id="' + lv.leave_id + '"]');
    await t.write(p, /\/shifts\/leaves\/\d+\/approve$/, () => p.click('[data-act=lv-approve][data-id="' + lv.leave_id + '"]'));
    await t.api("POST", "/shifts/leaves/" + lv2.leave_id + "/approve");
    t.same("leave (approve)", t.row("shift_leaves", lv2.leave_id), t.row("shift_leaves", lv.leave_id), { start_date: "another day", end_date: "another day", reason: "the request's own reason", reviewed_at: "clock" });

    // ---------- Handover ----------
    const today = maltaYmd(0);
    await t.api("PUT", "/instructions/daily", { ymd: today, notes: "Inspector may visit", handover_out: [] });
    await t.open(p, "2", "instructions", "hndreg", "#hnd-new"); await t.idle(p); // the day is read (and redrawn) before typing
    await p.fill("#hnd-new", "Ċempel lil Mrs Borg dwar l-insulina"); await p.click('.hnd-seg [data-sev="r"]');
    t.ok(await p.evaluate(() => document.querySelector('.hnd-seg [data-sev="r"]').getAttribute("aria-pressed") === "true"), "the chosen urgency is announced (aria-pressed)");
    const put = await t.write(p, /\/instructions\/daily$/, () => p.click("#hnd-add button[type=submit]"), "PUT");
    const sent = put.body || {};
    t.ok(sent.ymd === today && sent.notes === "Inspector may visit" && Array.isArray(sent.handover_out) && sent.handover_out.length === 1 && sent.handover_out[0].sev === "r" && sent.handover_out[0].text === "Ċempel lil Mrs Borg dwar l-insulina" && /^b_\d+_\d+$/.test(sent.handover_out[0].id) && !isNaN(Date.parse(sent.handover_out[0].created_at)) && Object.keys(sent).sort().join() === "handover_out,notes,ymd" && Object.keys(sent.handover_out[0]).sort().join() === "created_at,id,sev,text",
      "handover PUT is the classic body {ymd, notes, handover_out:[{id, sev, text, created_at}]}: " + JSON.stringify(sent).slice(0, 220));
    const row = t.db.prepare("SELECT * FROM instructions_daily WHERE ymd = ?").get(today);
    await t.api("PUT", "/instructions/daily", sent); // the classic screen sends this same body: the stored row must not change
    const row2 = t.db.prepare("SELECT * FROM instructions_daily WHERE ymd = ?").get(today);
    t.same("handover day", row2, row);
    // Notes typed and left unsaved are still there on coming back the same day.
    if (!process.env.TEAM_BASE) { // (TEAM_BASE=1: run on the code before this pass, to compare the stored rows only)
    await p.fill("#hnd-notes", "Inspector may visit at 10");
    await p.evaluate(() => { location.hash = "#team"; }); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "team");
    await p.evaluate(() => { location.hash = "#hndreg"; }); await p.waitForSelector("#hnd-notes"); await t.idle(p); // re-read done: no redraw under Ctrl+Enter
    const back = await p.evaluate(() => ({ v: document.querySelector("#hnd-notes").value, hint: document.querySelector("#hnd-dirty").textContent, dis: document.querySelector('[data-act="notes"]').disabled }));
    t.ok(back.v === "Inspector may visit at 10" && back.hint === "Not saved yet" && !back.dis, "unsaved notes survive leaving and coming back: " + JSON.stringify(back));
    await p.focus("#hnd-notes");
    await t.write(p, /\/instructions\/daily$/, () => p.keyboard.press("Control+Enter"), "PUT");
    await p.waitForTimeout(300);
    t.ok(JSON.parse(JSON.stringify(t.db.prepare("SELECT notes FROM instructions_daily WHERE ymd = ?").get(today))).notes === "Inspector may visit at 10", "Ctrl+Enter saves the notes");
    }

    // ---------- Chat board: group message stays in the group ----------
    const B = "board_messages";
    let b0 = t.maxId(B);
    await t.api("POST", "/board/messages", { body: "Għandkom Ozempic 1mg?", scope: "org" });
    const classicMsg = t.since(B, b0)[0];
    await t.open(p, "2", "messageboard", "brdreg", "#brd-ta");
    b0 = t.maxId(B);
    await p.fill("#brd-ta", "Għandkom Ozempic 1mg?");
    await t.write(p, /\/board\/messages$/, () => p.click("#brd-new button[type=submit]"));
    const freshMsg = t.since(B, b0)[0];
    t.same("board message (our group)", classicMsg, freshMsg);
    t.ok(freshMsg && freshMsg.scope === "org", "a new message starts on our group");
    b0 = t.maxId(B);
    await p.click('[data-to="all"]'); await p.fill("#brd-ta", "Courier late today");
    await t.write(p, /\/board\/messages$/, () => p.click("#brd-new button[type=submit]"));
    t.ok((t.since(B, b0)[0] || {}).scope === "all", "Every pharmacy is stored as scope all");
    try {
      t.db.prepare("INSERT OR IGNORE INTO orgs (id, name) VALUES (77, 'Other Group')").run(); t.db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (770, 77, 'Other Pharmacy')").run();
      await t.stack.app.addUser({ orgId: 77, locationId: 770, email: "other77@demo.mt", password: "Demo-Pass-2026", name: "Other" });
      const L = await t.stack.app.api("POST", "/auth/login", { body: { email: "other77@demo.mt", password: "Demo-Pass-2026" } });
      const seen = (await t.stack.app.api("GET", "/board/messages?scope=all&limit=200", { token: L.json.token })).json.messages || [];
      t.ok(!seen.some((x) => x.id === freshMsg.id || x.id === classicMsg.id) && seen.some((x) => x.body === "Courier late today"), "another group never sees our group's message, and does see the one for every pharmacy");
    } catch (e) { t.fail("privacy check could not run: " + e.message); }

    // ---------- People who sign in ----------
    const U = "users";
    let u0 = t.maxId(U);
    await t.api("POST", "/team/users", { email: "karmenu@demo.mt", full_name: "Karmenu Ħili", role: "staff" });
    const classicUser = (await t.mine(U, u0, { email: "karmenu@demo.mt" }))[0];
    await t.open(p, "2", "teamreg", "teamreg", "[data-act=add]");
    await p.click("[data-act=add]"); await p.waitForSelector("#tmr-add");
    await p.click("#tmr-add button[type=submit]"); await p.waitForTimeout(100);
    const errs = await p.evaluate(() => ({ n: document.querySelectorAll(".tmr-ferr").length, inv: [...document.querySelectorAll("#tmr-add [aria-invalid=true]")].map((x) => x.id).join(), focus: document.activeElement.id }));
    t.ok(errs.n === 2 && errs.inv === "tmr-name,tmr-email" && errs.focus === "tmr-name", "an empty Add shows both problems at once, under their fields, focus on the first: " + JSON.stringify(errs));
    u0 = t.maxId(U);
    await p.fill("#tmr-name", "Ġorġ Ħili"); await p.fill("#tmr-email", "gorg@demo.mt");
    await t.write(p, /\/team\/users$/, () => p.press("#tmr-email", "Enter"));
    await p.waitForSelector("#tmr-temp");
    const freshUser = (await t.mine(U, u0, { email: "gorg@demo.mt" }))[0];
    t.same("sign-in (add)", classicUser, freshUser, { email: "another person", full_name: "another person", pass_salt_b64: "random", pass_hash_b64: "from the random temporary password", last_sign_in_at: "clock" });
    t.has("sign-in(new)", freshUser, { email: "gorg@demo.mt", full_name: "Ġorġ Ħili", role: "staff" });
    if (process.env.TEAM_DUMP) { // the stored rows, without ids, clocks and random parts, to compare two versions of the screens
      const drop = (r, ks) => { const o = { ...r }; for (const k of ["id", "created_at", "updated_at", "reviewed_at", ...ks]) delete o[k]; return o; };
      const hand = JSON.parse(row.handover_json || "[]").map((x) => ({ sev: x.sev, text: x.text, keys: Object.keys(x).sort().join() }));
      (await import("node:fs")).writeFileSync(process.env.TEAM_DUMP, JSON.stringify({ shiftAdd: drop(D.shiftAdd, []), shiftChange: drop(D.shiftChange, []), leave: drop(t.row("shift_leaves", lv.leave_id), []), handover: { ...drop(row, ["handover_json"]), hand }, board: drop(freshMsg, []), user: drop(freshUser, ["pass_salt_b64", "pass_hash_b64", "last_sign_in_at"]) }, null, 1));
    }
    await p.click("[data-act=done]");
    t.ok(await p.evaluate(() => !document.querySelector("#tmr-temp") && document.activeElement.getAttribute("data-act") === "add"), "Done hides the password and puts focus back on Add a person");
  },
};
