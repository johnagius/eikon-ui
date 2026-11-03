// Correcting a repeat prescription (repreg, "Written by month") in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), expires_date: ymd(180), client_name: "Spiteri Lina", client_id: "778899M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: "Dr Clare Vella", prescriber_reg_no: "6610" };
const KEYS = Object.keys(L);
export default {
  title: "Correct a repeat prescription",
  run: (t) => correctCase(t, { label: "correct repeat-rx", table: "repeat_prescription_entries", path: "/repeat-prescriptions/entries", action: "REPEAT_RX_ENTRY_UPDATE", hash: "repeatprescriptions", newId: "repreg", ready: ".rep-list",
    create: L, shown: { expires_date: ymd(180) }, edit: { medicine_name_dose: "Atorvastatin 40mg", expires_date: ymd(170) }, edit2: { posology: "1 in the morning" }, want: { medicine_name_dose: "Atorvastatin 40mg", expires_date: ymd(170) }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), medicine_name_dose: "Atorvastatin 40mg", expires_date: ymd(170) }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), prescriber_reg_no: "6601" }) }),
};
