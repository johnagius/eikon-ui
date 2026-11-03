// Correcting a paid-out payment (poreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), entry_time: "11:20", payee_name: "Grech Couriers", fee: 25, invoice_no: "C-77", payment_method: "cheque", cheque_no: "000123", reason: "Delivery to Gozo" };
const KEYS = Object.keys(L);
export default {
  title: "Correct a paid out",
  run: (t) => correctCase(t, { label: "correct paid-out", table: "paid_out_entries", path: "/paid-out/entries", action: "PAID_OUT_ENTRY_UPDATE", hash: "paidout", newId: "poreg", ready: ".por-list",
    create: L, shown: { fee: "25", cheque_no: "000123" }, edit: { fee: "20.50", payment_method: "cash" }, edit2: { fee: "21" }, want: { fee: 20.5, payment_method: "cash", cheque_no: "" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), fee: 20.5, payment_method: "cash", cheque_no: "" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), invoice_no: "C-78" }) }),
};
