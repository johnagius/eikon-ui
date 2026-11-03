// Correcting a DDA purchase line (cdpreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), dda_name_dose: "Oxycodone 10mg tablets", quantity: 56, agent: "Medicare Ltd", invoice_number: "INV-55012" };
const KEYS = ["entry_date", "dda_name_dose", "quantity", "agent", "invoice_number"];
export default {
  title: "Correct a DDA purchase",
  run: (t) => correctCase(t, { label: "correct dda-purchases", table: "dda_purchases_entries", path: "/dda-purchases/entries", action: "DDA_PURCHASES_ENTRY_UPDATE", hash: "dda-purchases", newId: "cdpreg", ready: ".cdp-inv",
    create: L, shown: { quantity: "56" }, edit: { quantity: "28", invoice_number: "INV-55021" }, edit2: { quantity: "27" }, want: { quantity: 28, invoice_number: "INV-55021" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), quantity: 28, invoice_number: "INV-55021" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), agent: "Medicare Malta Ltd" }) }),
};
