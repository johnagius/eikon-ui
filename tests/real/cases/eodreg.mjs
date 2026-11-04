// End of day (eodreg) vs classic End of Day: one record per day, so the classic's row is read, removed from the
// local database, and the same day entered on the new screen. (r107: the classic once dropped edits; .eodreg keeps
// both field names the server reads.)
import { ymd } from "../lib.mjs";
const DAY = { staff: "Maria", float: "150", x: ["1250.40", "Main till"], epos: ["520.10", ""], chq: ["50", "Dr Abela"], po: ["12.50", "Courier"], cash: { n100: "2", n50: "6", n20: "10", n10: "7", n5: "3" }, coins: "59.15", bag: "B-123" };
export default {
  title: "End of day",
  async run(t) {
    const T = "end_of_day", K = (k) => `[data-focus-key="${k}"]`;
    await startsRight(t, T, K); // q5-6: a new day's float and shift, untouched, against the classic with the same visible values
    const p = await t.page();
    await t.open(p, "classic", "endofday", "endofday", K("meta_staff"));
    let m = t.maxId(T);
    await t.fill(p, "", { [K("meta_staff")]: DAY.staff, [K("float_amount")]: DAY.float, [K("x_amt_0")]: DAY.x[0], [K("x_rem_0")]: DAY.x[1], [K("epos_amt_0")]: DAY.epos[0],
      [K("chq_amt_0")]: DAY.chq[0], [K("chq_rem_0")]: DAY.chq[1], [K("po_amt_0")]: DAY.po[0], [K("po_rem_0")]: DAY.po[1],
      ...Object.fromEntries(Object.entries(DAY.cash).map(([k, v]) => [K("cash_" + k), v])), [K("cash_coins_total")]: DAY.coins, [K("bag_number")]: DAY.bag });
    await t.write(p, /\/endofday\/record$/, () => p.locator("button.eikon-btn.primary:has-text('Save')").first().click(), "PUT");
    const classic = t.since(T, m)[0];
    t.db.prepare(`DELETE FROM ${T} WHERE id > ?`).run(m);
    m = t.maxId(T);
    await t.open(p, "2", "endofday", "eodreg", "#eod-form");
    await p.click("[data-act=who]"); // b4-4: day, staff, shift and float sit behind the summary line's Change
    await p.selectOption("#eod-form [name=time_of_day]", "AM"); // q5-6: a new day's shift follows Malta time; the classic above kept AM
    await t.fill(p, "#eod-form", { staff: DAY.staff, float_amount: DAY.float, '[name="row:x:0:amount"]': DAY.x[0], '[name="row:x:0:remark"]': DAY.x[1], '[name="row:epos:0:amount"]': DAY.epos[0],
      '[name="row:cheques:0:amount"]': DAY.chq[0], '[name="row:cheques:0:remark"]': DAY.chq[1], '[name="row:paid_outs:0:amount"]': DAY.po[0], '[name="row:paid_outs:0:remark"]': DAY.po[1],
      ...Object.fromEntries(Object.entries(DAY.cash).map(([k, v]) => [`[name="cash:${k}"]`, v])), '[name="cash:coins_total"]': DAY.coins, bag_number: DAY.bag });
    await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=save]"), "PUT");
    const fresh = t.since(T, m)[0];
    t.has("eod(new)", fresh, { eod_date: ymd(0), staff_name: DAY.staff, float_amount: 150, bov_bag_number: DAY.bag });
    const J = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };
    if (fresh) {
      t.ok(J(fresh.x_json)[0]?.amount == 1250.4 && J(fresh.x_json)[0]?.remark === DAY.x[1], "eod(new): X reading and remark stored: " + fresh.x_json);
      t.ok(J(fresh.cash_json).n20 == 10 && J(fresh.cash_json).coins_total == 59.15, "eod(new): the cash count stored: " + fresh.cash_json);
      t.ok(J(fresh.bov_deposit_json).n20 == 9, "eod(new): the bank bag filled from the count (9 x €20): " + fresh.bov_deposit_json);
    }
    // bov_deposit_json was a KNOWN difference (the new screen stored the bag counts as text); the fix pack (3fa1d30,
    // ui/modules.eodreg.js) sends them as numbers like the classic screen, so the column must now match exactly.
    t.same("eod", classic, fresh, { saved_at: "the moment of saving" });
  },
};

// q5-6: End of day starts right. The new screen's new day shows a float and a shift it chose (the last saved day's float,
// else €1000.00; the shift by Malta time); saved untouched, its row must equal the classic's row for the same visible
// staff, shift, float and figures. (c) no saved day; (a) a saved day 6 days ago with a €150 float. The rows written here
// are removed again, so the case below runs as before.
// Found here, present before q5-6 and left as it is (saved bodies unchanged): a list left untouched is stored as "0" by the
// classic and "0.00" by the new screen. Both read as zero everywhere; listed as KNOWN, not failed.
const ZERO = "an untouched list line: classic \"0\", new screen \"0.00\" (before q5-6 too; both read as zero)";
const KNOWN0 = { cheques_json: ZERO, epos_json: ZERO, paid_outs_json: ZERO };
const FIG = { x: "980.20", cash: { n100: "3", n50: "6", n20: "9", n10: "4" }, coins: "33.10", bag: "B-77" };
async function newUntouched(t, T) {
  const p = await t.page();
  await t.open(p, "2", "endofday", "eodreg", "#eod-form");
  const shown = await p.evaluate(() => { const n = document.querySelector("[data-b=floatnote]"); return { line: (document.querySelector(".eod-who span") || {}).textContent || "", note: n && !n.hidden ? n.textContent : "", who: (window.EIKON.state.user || {}).full_name }; });
  await t.fill(p, "#eod-form", { '[name="row:x:0:amount"]': FIG.x, ...Object.fromEntries(Object.entries(FIG.cash).map(([k, v]) => [`[name="cash:${k}"]`, v])), '[name="cash:coins_total"]': FIG.coins, bag_number: FIG.bag });
  await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=save]"), "PUT");
  const m = /^Today · (.+) · (AM|PM) · float €([\d.]+)$/.exec(shown.line) || [];
  return { ...shown, staff: m[1], tod: m[2], float: m[3], row: t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(ymd(0)) };
}
async function classicSame(t, T, K, v) {
  const p = await t.page();
  await t.open(p, "classic", "endofday", "endofday", K("meta_staff"));
  if (v.tod !== "AM") await p.selectOption(K("meta_time_of_day"), v.tod);
  const fl = await p.inputValue(K("float_amount"));
  await t.fill(p, "", { [K("meta_staff")]: v.staff, ...(v.typeFloat ? { [K("float_amount")]: v.float } : {}), [K("x_amt_0")]: FIG.x, ...Object.fromEntries(Object.entries(FIG.cash).map(([k, x]) => [K("cash_" + k), x])), [K("cash_coins_total")]: FIG.coins, [K("bag_number")]: FIG.bag });
  await t.write(p, /\/endofday\/record$/, () => p.locator("button.eikon-btn.primary:has-text('Save')").first().click(), "PUT");
  return { fl, row: t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(ymd(0)) };
}
async function startsRight(t, T, K) {
  const del = (d) => t.db.prepare(`DELETE FROM ${T} WHERE eod_date = ?`).run(d);
  // (c) no saved day: €1000.00, said why (the table is made by the first read)
  const c = await newUntouched(t, T); del(ymd(0));
  const prior = t.db.prepare(`SELECT COUNT(*) AS n FROM ${T} WHERE eod_date < ?`).get(ymd(0)).n;
  if (prior) t.note(`startsRight: ${prior} earlier day(s) already saved; case (c) is not "no saved day"`);
  t.ok(prior || (c.float === "1000.00" && /^No earlier day saved/.test(c.note)), "startsRight(c): a pharmacy with no saved day shows €1000.00 and says why: " + JSON.stringify([c.line, c.note]));
  const cc = await classicSame(t, T, K, { staff: c.staff, tod: c.tod, float: c.float, typeFloat: false }); del(ymd(0));
  t.ok(cc.fl === "1000.00", "startsRight(c): the classic starts at 1000.00 too: " + cc.fl);
  t.same("eod(c) untouched, no saved day", cc.row, c.row, { saved_at: "the moment of saving" }, KNOWN0);
  // (a) a saved day 6 days ago with a €150 float and PM: the new day shows €150.00
  const D = ymd(-6);
  await t.api("PUT", "/endofday/record", { record: { date: D, eod_date: D, time_of_day: "PM", staff: "Karl", staff_name: "Karl", float_amount: "150.00", x: [{ amount: "700", remark: "" }], epos: [], cheques: [], paid_outs: [], cash: { n50: "4", coins_total: "0" }, deposit: { n50: 4 }, bag_number: "B-1", notes: "", action: "SAVE" } });
  const a = await newUntouched(t, T); del(ymd(0));
  t.ok(a.float === "150.00" && /^Float as on /.test(a.note), "startsRight(a): the new day takes the last saved day's float (€150.00) and says so: " + JSON.stringify([a.line, a.note]));
  t.has("eod(a) new", a.row, { float_amount: 150, staff_name: a.who, time_of_day: a.tod });
  const ac = await classicSame(t, T, K, { staff: a.staff, tod: a.tod, float: a.float, typeFloat: true }); del(ymd(0));
  t.same("eod(a) untouched, last day €150", ac.row, a.row, { saved_at: "the moment of saving" }, KNOWN0);
  del(D);
}
