// Hotfix .179 (fresh-eyes walkthrough: "End of day can lose a day's figures"): PUT /endofday/record refuses an all-zero
// body over a day that has counted figures (any reading, EPOS, cheque, paid out, or cash in the till), with 409
// code "would_clear_figures" and nothing changed and no audit row, unless the body says confirm_zero: true. Every other
// save is stored as before: a new day with nothing counted, zeros over zeros, figures over figures, a float change
// with the figures sent, a lock, an unlock, and a locked day still answers 409 "Locked".
import { test, eq, ok } from "./lib.mjs";
const D = "2026-10-01";
const fig = (extra = {}) => ({ record: { date: D, eod_date: D, time_of_day: "PM", staff: "Ġorġ Zammit", staff_name: "Ġorġ Zammit", float_amount: "150.00", x: [{ amount: "845.30", remark: "Main till" }], epos: [{ amount: "310.20", remark: "" }], cheques: [], paid_outs: [], cash: { n50: "4", n20: "10", coins_total: "12.60" }, deposit: { n50: 4, n20: 10 }, bag_number: "B-1", notes: "", action: "SAVE", ...extra } });
const zero = (extra = {}) => fig({ x: [{ amount: "0.00", remark: "" }], epos: [{ amount: "0", remark: "" }], cash: { n500: "0", n50: "0", coins_total: "0.00" }, deposit: {}, bag_number: "", ...extra });

test("eod: zeros never replace saved figures unless the save says confirm_zero", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const put = (b) => api("PUT", "/endofday/record", { token, body: b });
  const row = () => DB.db.prepare("SELECT * FROM end_of_day WHERE eod_date = ?").get(D);
  const audits = () => DB.db.prepare("SELECT COUNT(*) AS n FROM audit_log WHERE entity_type = 'end_of_day'").get().n;
  eq((await put(zero())).status, 200, "a new day with nothing counted is saved as before");
  eq((await put(zero({ float_amount: "120.00" }))).status, 200, "zeros over zeros: saved as before");
  eq(Number(row().float_amount), 120, "float changed on an empty day");
  eq((await put(fig())).status, 200, "figures over zeros: saved");
  const before = row(), a0 = audits();
  for (const b of [zero(), zero({ x: [], epos: [], cheques: [], paid_outs: [], cash: {} }), { record: { date: D, staff: "X", float_amount: "150" } }, zero({ locked_at: new Date().toISOString(), action: "LOCK" }), zero({ confirm_zero: "true" })]) {
    const r = await put(b);
    eq(r.status, 409, "zeros over figures refused: " + JSON.stringify(b.record).slice(0, 80));
    eq(r.json && r.json.code, "would_clear_figures", "the refusal says why");
  }
  eq(JSON.stringify(row()), JSON.stringify(before), "nothing changed in the row");
  eq(audits(), a0, "no audit row for a refused save");
  eq((await put(fig({ float_amount: "160.00" }))).status, 200, "a float change with the figures sent: saved");
  eq(Number(row().float_amount), 160, "float stored");
  eq((await put(fig({ x: [{ amount: "0", remark: "" }], epos: [], cash: { coins_total: "0.05" } }))).status, 200, "five cents of coins still counts as a figure: saved");
  eq((await put(fig())).status, 200, "back to the figures");
  const c = await put(zero({ confirm_zero: true }));
  eq(c.status, 200, "confirm_zero: true clears them");
  ok(JSON.parse(row().x_json)[0].amount === "0.00", "stored as sent");
  eq((await put(fig())).status, 200, "figures again");
  eq((await put(fig({ locked_at: new Date().toISOString(), action: "LOCK" }))).status, 200, "a lock with the figures: as before");
  eq((await put(zero())).status, 409, "a locked day: 409 as before");
  eq((await put(zero())).json.error, "Locked - cannot update", "the locked answer is unchanged");
});
