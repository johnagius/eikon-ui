// Correcting a DDA sale (cdsreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), client_name: "Camilleri Rita", client_id_card: "0234567M", client_address: "3 Triq San Pawl, Rabat", medicine_name_dose: "Fentanyl 25mcg patch", quantity: 10, doctor_name: "Dr Tonio Abela", doctor_reg_no: "R3301", prescription_serial_no: "RX-8801", urgent: 0 };
const KEYS = ["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no", "urgent"];
export default {
  title: "Correct a DDA sale",
  run: (t) => correctCase(t, { label: "correct dda-sales", table: "dda_sales_entries", path: "/dda-sales/entries", action: "DDA_SALES_ENTRY_UPDATE", hash: "dda-sales", newId: "cdsreg", ready: ".cds-list",
    create: L, shown: { quantity: "10", client_id_card: "0234567M" }, edit: { quantity: "5", doctor_reg_no: "R3310", urgent: true }, edit2: { quantity: "6" }, want: { quantity: 5, doctor_reg_no: "R3310", urgent: 1 }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), quantity: 5, doctor_reg_no: "R3310", urgent: 1 }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), client_address: "5 Triq San Pawl, Rabat" }) }),
};
