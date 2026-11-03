// Correcting a LOCKED end-of-day (eodreg, the pharmacist only): yesterday is entered and locked on the new screen, then
// "Correct this day" without a reason sends nothing; with one it unlocks the day (the classic unlock) carrying the
// reason; one figure is changed and the day is saved and locked again. The stored day differs from before only in that
// figure and the clock/lock columns; the unlock and the lock audit entries both carry the reason. Staff see no Correct.
import { ymd } from "../lib.mjs";
const DAY = { staff: "Maria", float: "150", x: ["1250.40", "Main till"], epos: ["520.10", ""], cash: { n100: "2", n50: "6", n20: "10", n10: "7", n5: "3" }, coins: "59.15", bag: "B-321" };
export default {
  title: "Correct a locked end of day",
  async run(t) {
    const T = "end_of_day", D = ymd(-1), p = await t.page();
    await t.open(p, "2", "endofday", "eodreg", "#eod-form");
    const openDay = async () => { await p.fill("#eod-day", D); await p.dispatchEvent("#eod-day", "change"); await p.waitForFunction((d) => document.querySelector("#eod-day") && document.querySelector("#eod-day").value === d && !/Opening/.test(document.querySelector(".eod").textContent), D); await p.waitForTimeout(300); };
    await openDay();
    await t.fill(p, "#eod-form", { staff: DAY.staff, float_amount: DAY.float, '[name="row:x:0:amount"]': DAY.x[0], '[name="row:x:0:remark"]': DAY.x[1], '[name="row:epos:0:amount"]': DAY.epos[0],
      ...Object.fromEntries(Object.entries(DAY.cash).map(([k, v]) => [`[name="cash:${k}"]`, v])), '[name="cash:coins_total"]': DAY.coins, bag_number: DAY.bag });
    await p.click("[data-act=lock]"); await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=lock-yes]"), "PUT");
    const before = t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D);
    t.ok(before && before.locked_at, "correct eod: yesterday was not stored locked");
    await p.waitForSelector("[data-act=fix]");
    await p.click("[data-act=fix]"); await p.waitForSelector("[name=fix_reason]");
    let puts = 0; const onR = (r) => { if (r.method() === "PUT") puts++; }; p.on("request", onR);
    await p.click("[data-act=fix-go]"); await p.waitForTimeout(400); p.off("request", onR);
    t.ok(puts === 0 && /what was wrong/i.test(await p.textContent(".eod-err").catch(() => "")), "correct eod: unlocking without a reason sent something or said nothing");
    await p.fill("[name=fix_reason]", "X reading typed wrong");
    const un = await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=fix-go]"), "PUT");
    t.ok(un.body && un.body.record && un.body.record.unlock === true && un.body.record.correction_reason === "X reading typed wrong", "correct eod: the unlock is the classic's with the reason: " + JSON.stringify(un.body && un.body.record && { unlock: un.body.record.unlock, action: un.body.record.action, r: un.body.record.correction_reason }));
    await p.waitForSelector("[data-act=save]", { timeout: 8000 });
    t.ok(/Unlocked for a correction/.test(await p.textContent(".eod").catch(() => "")), "correct eod: the day does not say it is open for a correction");
    await p.fill('[name="row:x:0:amount"]', "1205.40"); await p.locator('[name="row:x:0:amount"]').blur();
    await p.click("[data-act=lock]"); const lk = await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=lock-yes]"), "PUT");
    t.ok(lk.body && lk.body.record && lk.body.record.correction_reason === "X reading typed wrong" && lk.body.record.locked_at, "correct eod: the save and lock carries the reason");
    const after = t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D);
    t.ok(after && after.locked_at, "correct eod: the day is not locked again");
    const J = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };
    t.ok(after && J(after.x_json)[0].amount == 1205.4 && J(after.x_json)[0].remark === DAY.x[1], "correct eod: the X reading was not corrected: " + (after && after.x_json));
    for (const k of Object.keys(before)) if (!["id", "created_at", "updated_at", "updated_by", "saved_at", "locked_at", "x_json"].includes(k)) t.ok(JSON.stringify(after[k]) === JSON.stringify(before[k]), `correct eod: column ${k} changed: ${JSON.stringify(before[k])} → ${JSON.stringify(after[k])}`);
    const au = (a) => { const r = t.db.prepare("SELECT * FROM audit_log WHERE action = ? AND entity_type = 'end_of_day' AND entity_id = ? ORDER BY id DESC").get(a, String(before.id)); return r ? JSON.parse(r.details_json || "{}") : {}; };
    t.ok(au("EOD_UNLOCK").correction_reason === "X reading typed wrong", "correct eod: the unlock's audit has the reason");
    const l = au("EOD_LOCK"); t.ok(l.correction_reason === "X reading typed wrong" && l.before && l.after && J(l.before.x_json)[0].amount == 1250.4, "correct eod: the lock's audit has the reason and the day before");
    // staff: no Correct this day
    if (!t.stack.staff) t.stack.staff = await t.stack.app.addUser({ email: "staff-eod@demo.mt", role: "staff", name: "Sam Staff" }).catch(() => null);
    if (t.stack.staff) {
      const q = await t.page(); await q.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, t.stack.staff.token);
      await t.open(q, "2", "endofday", "eodreg", "#eod-form");
      await q.fill("#eod-day", D); await q.dispatchEvent("#eod-day", "change"); await q.waitForTimeout(800);
      t.ok(await q.locator("[data-act=fix]").count() === 0 && /Locked/.test(await q.textContent(".eod-st")), "correct eod: staff see Correct this day, or the day is not shown locked");
    }
  },
};
