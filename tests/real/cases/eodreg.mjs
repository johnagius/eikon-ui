// End of day (eodreg) vs classic End of Day: one record per day, so the classic's row is read, removed from the
// local database, and the same day entered on the new screen. (r107: the classic once dropped edits; .eodreg keeps
// both field names the server reads.)
import { ymd } from "../lib.mjs";
const DAY = { staff: "Maria", float: "150", x: ["1250.40", "Main till"], epos: ["520.10", ""], chq: ["50", "Dr Abela"], po: ["12.50", "Courier"], cash: { n100: "2", n50: "6", n20: "10", n10: "7", n5: "3" }, coins: "59.15", bag: "B-123" };
export default {
  title: "End of day",
  async run(t) {
    const T = "end_of_day", p = await t.page(), K = (k) => `[data-focus-key="${k}"]`;
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
