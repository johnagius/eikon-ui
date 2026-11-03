// Correcting a Daily register line (drreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), client_name: "Borg Mario", client_id: "456123M", medicine_name_dose: "Augmentin 1g", posology: "1 bd x 7 days", prescriber_name: "Dr Kevin Zammit", prescriber_reg_no: "5521" };
const KEYS = Object.keys(L);
export default {
  title: "Correct a daily register line",
  run: (t) => correctCase(t, { label: "correct daily-register", table: "daily_register_entries", path: "/daily-register/entries", action: "DAILY_REGISTER_ENTRY_UPDATE", hash: "dailyregister", newId: "drreg", ready: ".drr-tbl, .drr-list",
    create: L, shown: { posology: "1 bd x 7 days" }, edit: { posology: "1 tds x 7 days", prescriber_reg_no: "5512" }, edit2: { posology: "1 tds x 5 days" }, want: { posology: "1 tds x 7 days", prescriber_reg_no: "5512" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), posology: "1 tds x 7 days", prescriber_reg_no: "5512" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), client_name: "Borg Mario Jr" }) }),
};
