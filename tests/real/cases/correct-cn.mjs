// Correcting a credit note (cnreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { issue_date: ymd(0), client_name: "Rita", client_surname: "Camilleri", telephone: "79112233", email: "", receipt_number: "R-901", amount: 25.5, expiry_date: "", no_expiry: 1 };
const KEYS = Object.keys(L);
export default {
  title: "Correct a credit note",
  run: (t) => correctCase(t, { label: "correct credit-note", allow: { cn_no: "the pharmacy's own credit-note number (W6), a sequence like the row id" }, table: "credit_notes", path: "/creditnotes/entries", action: "CREDITNOTE_UPDATE", hash: "creditnotes", newId: "cnreg", ready: ".cnr-card", reveal: async (p, row) => { const b = p.locator(`[data-act=open][data-id="${row.id}"]`); if (await b.getAttribute("aria-expanded") !== "true") await b.click(); }, // m1: a note opens in place
    create: L, shown: { amount: "25.5", expiry_date: "" }, edit: { amount: "20", expiry_date: ymd(90) }, edit2: { amount: "19" }, want: { amount: 20, expiry_date: ymd(90), no_expiry: 0 }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k] == null ? "" : r[k]])), amount: "20", expiry_date: ymd(90), no_expiry: 0 }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k] == null ? "" : r[k]])), telephone: "79112234" }) }),
};
