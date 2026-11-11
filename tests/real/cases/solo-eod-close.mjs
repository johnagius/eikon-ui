// End of day, the guided close (Money department, eod): one read opens the screen (the day, the contacts, the
// overview: no per-day month reads); the day before not locked is said with one tap to close it; the Paid out
// register's cash lines are pulled in by a press; the emergency till is not offered (not part of the end of day, John
// 2026-11-09); notes are saved; the register of past days shows each day's state. The rows a pull-in stores are byte-identical to the same figures typed by hand.
// Solo (last, alone): it writes today's End of day and the two days before, and removes them again.
import { ymd } from "../lib.mjs";
const T = "end_of_day";
const CASH = { n100: "2", n50: "3", n20: "5", n10: "4" }, COINS = "17.35", NOTE = "€2 short: a refund given in cash";
const dow = (d) => new Date(d + "T12:00:00Z").getUTCDay();
export default {
  title: "End of day: the guided close",
  async run(t) {
    const D0 = ymd(0), D1 = ymd(-1), D2 = ymd(-2), del = (d) => t.db.prepare(`DELETE FROM ${T} WHERE eod_date = ?`).run(d);
    await t.api("GET", "/endofday/overview?month=" + D0.slice(0, 7) + "&date=" + D0); // makes the tables on a fresh stack
    await t.api("GET", "/emergency-pos/sales?date=" + D0); // and the emergency till's (End of day no longer reads it)
    const had = [D0, D1, D2].map((d) => t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(d));
    [D0, D1, D2].forEach(del);
    // the day before yesterday saved, not locked; yesterday nothing
    await t.api("PUT", "/endofday/record", { record: { date: D2, eod_date: D2, time_of_day: "PM", staff: "Ġorġ Zammit", staff_name: "Ġorġ Zammit", float_amount: "150.00", x: [{ amount: "700.00", remark: "" }], epos: [], cheques: [], paid_outs: [], cash: { n50: "4", n100: "5", coins_total: "0" }, deposit: { n50: 4, n100: 5 }, bag_number: "B-2", notes: "", action: "SAVE" } });
    const po0 = t.maxId("paid_out_entries"), ps0 = t.maxId("pos_sales");
    // Earlier cases in the suite record paid outs and emergency sales for today too: set them aside (dated far back)
    // for this case, so the register holds only what it adds, and put them back at the end. (Director, test isolation.)
    const asidePo = t.db.prepare("SELECT id FROM paid_out_entries WHERE entry_date = ?").all(D0).map((r) => r.id);
    const asidePs = t.db.prepare("SELECT id FROM pos_sales WHERE sale_date = ?").all(D0).map((r) => r.id);
    asidePo.forEach((id) => t.db.prepare("UPDATE paid_out_entries SET entry_date = '1999-01-01' WHERE id = ?").run(id));
    asidePs.forEach((id) => t.db.prepare("UPDATE pos_sales SET sale_date = '1999-01-01' WHERE id = ?").run(id));
    await t.api("POST", "/paid-out/entries", { entry_date: D0, entry_time: "10:00", payee_name: "Courier Ltd", fee: 12.5, payment_method: "cash", reason: "Delivery" });
    await t.api("POST", "/paid-out/entries", { entry_date: D0, entry_time: "11:00", payee_name: "Hili Pharma", fee: 30, payment_method: "cheque", cheque_no: "CH1", reason: "Invoice" });
    await t.api("POST", "/emergency-pos/sales", { sale_date: D0, items: [{ name: "Panadol", qty: 1, price: 10, vat_rate: 0 }], payment_method: "cash", amount_tendered: 10 });
    await t.api("POST", "/emergency-pos/sales", { sale_date: D0, items: [{ name: "Panadol", qty: 1, price: 5.2, vat_rate: 0 }], payment_method: "card" });

    const p = await t.page(), reqs = [];
    p.on("request", (r) => { const u = new URL(r.url()); if (/^\/(endofday|eod)\//.test(u.pathname) && r.method() === "GET") reqs.push(u.pathname); });
    await t.open(p, "2", "endofday", "eodreg", "#eod-form");
    await p.waitForSelector(".eod-dr");
    t.ok(reqs.filter((x) => x === "/endofday/overview").length === 1 && !reqs.includes("/endofday/dates") && reqs.filter((x) => x === "/endofday/record").length === 1,
      "open: one overview read, one day read, no per-day month reads: " + reqs.join(","));
    const look = await p.evaluate((d1) => ({ hol1: window.EIKON.maltaHoliday(d1), prev: (document.querySelector(".eod-prev") || {}).textContent || "", rows: Object.fromEntries([...document.querySelectorAll(".eod-dr")].map((b) => [b.dataset.d, b.querySelector(".eod-chip").textContent])),
      till: !!document.querySelector("[data-b=tillhint], [data-act=add-till]") || /emergency till/i.test((document.querySelector("#eod-form") || {}).textContent || ""), po: (document.querySelector("[data-b=pohint]") || {}).textContent || "" }), D1);
    t.ok(/was saved but not locked/.test(look.prev), "the day before not locked is said: " + look.prev);
    t.ok(look.rows[D2] === "Not locked" && look.rows[D1] === (look.hol1 ? "Public holiday" : dow(D1) === 0 ? "Closed" : "Not closed") && look.rows[D0] === "Not started", "register: each day's state: " + JSON.stringify(look.rows));
    t.ok(look.till === false, "End of day says nothing of the emergency till, though it sold €15.20 today");
    t.ok(/1 paid out in cash today, €12\.50/.test(look.po) && /1 paid by cheque is left out/.test(look.po), "paid out register, cash only: " + look.po);

    // a Malta public holiday is a closed day (never "Not closed"), unless the Shifts screen's override says it opened
    const hd = await p.evaluate(() => { const E = window.EIKON; return [E.maltaHoliday("2026-04-03"), E.maltaHoliday("2027-03-26"), E.maltaHoliday("2026-04-02"), E.maltaHoliday("2026-12-13"),
      E.eodOpenOn({}, "2026-12-08"), E.eodOpenOn({ overrides: { "2026-12-08": { closed: false } } }, "2026-12-08"), E.eodOpenOn({}, "2026-12-09")]; });
    t.ok(JSON.stringify(hd) === JSON.stringify(["Good Friday", "Good Friday", "", "Republic Day", false, true, true]), "public holidays: " + JSON.stringify(hd));

    // pull the paid outs in, count the till, a note, save
    await p.click("[data-act=use-po]");
    await t.fill(p, "#eod-form", { '[name="row:x:0:amount"]': "15.20", '[name="row:x:0:remark"]': "Main till", ...Object.fromEntries(Object.entries(CASH).map(([k, v]) => [`[name="cash:${k}"]`, v])), '[name="cash:coins_total"]': COINS, bag_number: "B-9", notes: NOTE });
    const why = await p.textContent("[data-b=why]");
    t.ok(/^The till holds €[\d.]+ (more|less) cash than the readings say/.test(why), "the difference in words: " + why);
    let m = t.maxId(T);
    await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=save]"), "PUT");
    const pulled = t.since(T, m).find((r) => r.eod_date === D0) || t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D0);
    const J = (s) => JSON.parse(s || "null");
    t.ok(pulled && JSON.stringify(J(pulled.x_json)) === JSON.stringify([{ amount: "15.20", remark: "Main till" }]) && !/Emergency/i.test(pulled.x_json + pulled.epos_json), "only the typed X reading, nothing from the emergency till in the readings: " + (pulled && pulled.x_json + " " + pulled.epos_json));
    t.ok(pulled && JSON.stringify(J(pulled.paid_outs_json)) === JSON.stringify([{ amount: "12.50", remark: "Courier Ltd · Delivery" }]), "paid out line from the register: " + (pulled && pulled.paid_outs_json));
    t.ok(pulled && pulled.notes === NOTE, "notes saved: " + (pulled && pulled.notes));
    const chip = await p.evaluate((d) => (document.querySelector(`.eod-dr[data-d="${d}"] .eod-chip`) || {}).textContent, D0);
    t.ok(chip === "Not locked", "register follows the save: " + chip);

    // the words are the same as the Money page's: E.eodDiff on the stored day, and GET /money/today when it is there
    const stored = await t.api("GET", "/endofday/record?date=" + D0);
    const mine = await p.evaluate((rec) => window.EIKON.eodDiff(rec), stored.record);
    const rowWords = await p.evaluate((d) => (document.querySelector(`.eod-dr[data-d="${d}"] .o`) || {}).textContent, D0);
    t.ok(mine && mine.words === rowWords && /^(Exact|€[\d,]+\.\d\d (short|over))$/.test(mine.words), "E.eodDiff words equal the register row: " + JSON.stringify([mine, rowWords]));
    const mt = await t.stack.app.api("GET", "/money/today", { token: t.token }).catch(() => null);
    if (mt && mt.status === 200 && mt.json && mt.json.end_of_day && mt.json.end_of_day.today) t.ok(mt.json.end_of_day.today.over_under === mine.diff, "the Money page's over/under is the screen's: " + JSON.stringify([mt.json.end_of_day.today.over_under, mine.diff]));
    else t.note("GET /money/today not in this tree: the Money page comparison runs after the merge");
    // the same figures typed by hand store the same row
    del(D0);
    const p2 = await t.page();
    await t.open(p2, "2", "endofday", "eodreg", "#eod-form");
    await t.fill(p2, "#eod-form", { '[name="row:x:0:amount"]': "15.20", '[name="row:x:0:remark"]': "Main till", '[name="row:paid_outs:0:amount"]': "12.50", '[name="row:paid_outs:0:remark"]': "Courier Ltd · Delivery",
      ...Object.fromEntries(Object.entries(CASH).map(([k, v]) => [`[name="cash:${k}"]`, v])), '[name="cash:coins_total"]': COINS, bag_number: "B-9", notes: NOTE });
    await t.write(p2, /\/endofday\/record$/, () => p2.click("[data-act=save]"), "PUT");
    const typed = t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D0);
    t.same("pulled in vs typed", typed, pulled, { saved_at: "the moment of saving" });

    // one tap opens the day before at the top with a note; the lock question comes only from Save and lock, focus on Cancel
    await p2.click("[data-act=prevday]");
    await p2.waitForSelector("#eod-closing", { timeout: 8000 });
    await p2.waitForFunction(() => document.activeElement && document.activeElement.id === "eod-closing", null, { timeout: 3000 }).catch(() => {});
    const op = await p2.evaluate(() => ({ foc: document.activeElement && document.activeElement.id, ask: !!document.querySelector("[data-act=lock-yes]"), line: (document.querySelector(".eod-who span") || {}).textContent }));
    t.ok(op.foc === "eod-closing" && !op.ask && /Ġorġ Zammit/.test(op.line), "Close opens the day with a note, no lock question yet: " + JSON.stringify(op));
    const was = JSON.stringify(t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D2));
    await p2.keyboard.press("Enter"); await p2.waitForTimeout(600); await t.idle(p2);
    t.ok(JSON.stringify(t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D2)) === was && !(await p2.$("[data-act=lock-yes]")), "one Enter after Close yesterday saves and locks nothing");
    await p2.click("[data-act=lock]");
    await p2.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "ask-no", null, { timeout: 3000 }).catch(() => {});
    await p2.keyboard.press("Enter"); await p2.waitForTimeout(400); // Enter on the focused Cancel: still nothing
    t.ok(JSON.stringify(t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D2)) === was && !(await p2.$("[data-act=lock-yes]")), "Enter on the lock question is Cancel: nothing locked");
    await p2.click("[data-act=lock]");
    await p2.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "ask-no", null, { timeout: 3000 }).catch(() => {});
    const q = await p2.evaluate(() => ({ foc: document.activeElement && document.activeElement.getAttribute("data-act"), text: (document.querySelector("[role=alertdialog]") || {}).textContent || "", bar: document.querySelectorAll("[data-act=lock]").length }));
    t.ok(q.foc === "ask-no" && /— €[\d,.]+ (short|over)\?|— exact\?/.test(q.text) && q.bar === 0, "the lock question says the difference, Cancel has the focus, the bar's buttons are away: " + JSON.stringify(q));
    const before = t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D2);
    await t.write(p2, /\/endofday\/record$/, () => p2.click("[data-act=lock-yes]"), "PUT");
    const after = t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(D2);
    t.ok(after && after.locked_at, "the day before is locked");
    // the screen stores the day in its full shape (every note line, "0.00" lines), as Save and lock always has; the money is the same
    const money = (r) => { const n = (o) => Object.fromEntries(Object.entries(J(o) || {}).map(([k, v]) => [k, Number(v)]).filter(([, v]) => v).sort()); const sum = (c) => (J(c) || []).reduce((a, x) => a + Number(x.amount || 0), 0);
      return JSON.stringify([r.staff_name, r.time_of_day, r.float_amount, r.bov_bag_number, sum(r.x_json), sum(r.epos_json), sum(r.cheques_json), sum(r.paid_outs_json), n(r.cash_json), n(r.bov_deposit_json), r.notes]); };
    t.ok(before && after && money(before) === money(after), "closing the day before keeps its figures: " + (before && money(before)) + " vs " + (after && money(after)));

    // the register browses another month in one read
    reqs.length = 0;
    const p3 = await t.page(); p3.on("request", (r) => { const u = new URL(r.url()); if (/^\/endofday\//.test(u.pathname) && r.method() === "GET") reqs.push(u.pathname + u.search); });
    await t.open(p3, "2", "endofday", "eodreg", ".emb [data-mb=prev]"); reqs.length = 0;
    await p3.click(".emb [data-mb=prev]"); await t.idle(p3);
    t.ok(reqs.length === 1 && /^\/endofday\/overview\?month=\d{4}-\d{2}$/.test(reqs[0]), "another month: one read: " + reqs.join(","));

    // put things back
    [D0, D1, D2].forEach(del);
    t.db.prepare("DELETE FROM paid_out_entries WHERE id > ?").run(po0); t.db.prepare("DELETE FROM pos_sales WHERE id > ?").run(ps0);
    asidePo.forEach((id) => t.db.prepare("UPDATE paid_out_entries SET entry_date = ? WHERE id = ?").run(D0, id));
    asidePs.forEach((id) => t.db.prepare("UPDATE pos_sales SET sale_date = ? WHERE id = ?").run(D0, id));
    const cols = (r) => Object.keys(r);
    for (const r of had) if (r) t.db.prepare(`INSERT INTO ${T} (${cols(r).join(",")}) VALUES (${cols(r).map(() => "?").join(",")})`).run(...cols(r).map((k) => r[k]));
  },
};
