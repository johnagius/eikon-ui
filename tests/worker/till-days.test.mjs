// Emergency POS month at a glance (till): GET /emergency-pos/days?month= answers a row per day with sales in ONE
// grouped read, the money of each day equal to what the day list adds (voided sales left out), this pharmacy only.
import { test, eq, ok } from "./lib.mjs";

function counter(DB) {
  const c = { stmts: 0, rows: 0, sql: [] }, orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    const st = orig(sql), s = String(sql);
    if (/^\s*(CREATE|ALTER|PRAGMA|INSERT|UPDATE|DELETE)\b/i.test(s)) return st;
    c.stmts++; c.sql.push(s.replace(/\s+/g, " "));
    const wrap = (o) => { const all = o.all && o.all.bind(o), first = o.first && o.first.bind(o), bind = o.bind && o.bind.bind(o);
      if (all) o.all = async (...a) => { const r = await all(...a); c.rows += (r.results || []).length; return r; };
      if (first) o.first = async (...a) => { const r = await first(...a); if (r) c.rows++; return r; };
      if (bind) o.bind = (...a) => wrap(bind(...a)); return o; };
    return wrap(st);
  };
  return c;
}
const sale = (id, date, price, qty, method, vat = 0) => { const lt = Math.round(price * qty * 100) / 100;
  return { offline_id: id, sale_date: date, receipt_no: "R-" + id, items: [{ barcode: "B" + id, name: "Item " + id, qty, price, vat_rate: vat, line_total: lt, fmd: null }],
    subtotal: lt, vat_total: 0, discount_pct: 0, discount_amt: 0, total: lt, payment_method: method, amount_tendered: method === "cash" ? 50 : null, change_given: method === "cash" ? 50 - lt : null, notes: "" }; };

test("till: emergency POS days of a month in one grouped read, equal to the day lists", async (app) => {
  const { api, bootstrap, DB } = app;
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const other = (await app.addUser({ orgId: 1, locationId: 2, email: "branch-till@example.com", name: "Branch" })).token;
  const L = [["a1", "2026-10-02", 3.49, 2, "cash"], ["a2", "2026-10-02", 1.85, 1, "card", 18], ["a3", "2026-10-02", 7.4, 3, "other", 18], ["a4", "2026-10-17", 0.1, 3, "cash"], ["a5", "2026-10-31", 12.35, 1, "card"], ["x1", "2026-09-30", 9, 1, "cash"], ["x2", "2026-11-01", 9, 1, "cash"]];
  for (const [id, d, p, q, m, v] of L) { const w = await api("POST", "/emergency-pos/sales", { token, body: sale(id, d, p, q, m, v) }); eq(w.status, 200, id + " " + w.text); }
  eq((await api("POST", "/emergency-pos/sales", { token: other, body: sale("b1", "2026-10-02", 49, 1, "cash") })).status, 200);
  const day2 = (await api("GET", "/emergency-pos/sales?date=2026-10-02", { token })).json.sales;
  const voidId = day2.find((s) => s.offline_id === "a3").id;
  eq((await api("DELETE", "/emergency-pos/sales/" + voidId, { token, body: { reason: "rung up twice" } })).status, 200);

  const n = counter(DB);
  const r = await api("GET", "/emergency-pos/days?month=2026-10", { token });
  eq(r.status, 200, r.text);
  const own = n.sql.filter((q) => /FROM pos_sales/.test(q));
  eq(own.length, 1, "one read of the sales: " + JSON.stringify(own));
  const days = r.json.days;
  eq(days.map((d) => d.sale_date), ["2026-10-31", "2026-10-17", "2026-10-02"], "days with sales, newest first, this month only");
  ok(n.rows <= 12, "a row per day, plus the sign-in: " + n.rows);
  for (const d of days) { // the same sums the screen makes from the day's list
    const list = (await api("GET", "/emergency-pos/sales?date=" + d.sale_date, { token })).json.sales, live = list.filter((s) => s.voided !== 1);
    const sum = (l, k) => l.reduce((t, s) => t + (Number(s[k]) || 0), 0), f = (x) => (Math.round(x * 100) / 100).toFixed(2);
    eq([d.sales, d.voided], [live.length, list.length - live.length], d.sale_date + " counts");
    eq([f(d.total), f(d.cash), f(d.card), f(d.other), f(d.vat)], [f(sum(live, "total")), f(sum(live.filter((s) => s.payment_method === "cash"), "total")), f(sum(live.filter((s) => s.payment_method === "card"), "total")), f(sum(live.filter((s) => s.payment_method === "other"), "total")), f(sum(live, "vat_total"))], d.sale_date + " money");
  }
  const d2 = days.find((d) => d.sale_date === "2026-10-02");
  eq([d2.sales, d2.voided, d2.total, d2.cash, d2.card], [2, 1, 8.83, 6.98, 1.85], "the voided sale is out of the money, the other pharmacy's sale is not there");
  eq((await api("GET", "/emergency-pos/days?month=2026-1", { token })).status, 400, "a bad month is refused");
  eq((await api("GET", "/emergency-pos/days?month=2026-10")).status, 401, "signed out");
});
