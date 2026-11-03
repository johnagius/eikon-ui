// Correcting a locum receipt (lrcreg) in the new layout, with the classic's edit password: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { receipt_date: ymd(0), hours: 8, locum_full_name: "Dr Anne Locum", registration_number: "R7788", day_type: "normal", fee_per_hour: 30 };
const KEYS = Object.keys(L);
export default {
  title: "Correct a locum receipt",
  run: (t) => correctCase(t, { label: "correct locum-receipt", table: "locum_receipts", path: "/locumreceipts/receipts", action: "LOCUM_RECEIPT_UPDATE", hash: "locumreceipts", newId: "lrcreg", ready: ".lrc-list",
    headers: { "X-Eikon-Edit-Pass": "!4321" }, pass: "!4321",
    create: { ...L, day_type: undefined }, shown: { hours: "8" }, edit: { hours: "7" }, edit2: { hours: "6" }, want: { hours: 7, total_fee: 210 }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), hours: 7 }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), registration_number: "R7789" }) }),
};
