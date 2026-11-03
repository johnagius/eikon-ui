// Correcting a POYC controlled-drug line (poyreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), client_name: "Farrugia Paul", client_id_card: "345M", client_address: "9 Triq il-Mitħna, Qormi", medicine_name_dose: "Methadone 1mg/ml", quantity: 100, doctor_name: "Dr Ruth Galea", doctor_reg_no: "R4401", prescription_serial_no: "PY-201" };
const KEYS = ["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no"];
export default {
  title: "Correct a POYC line",
  run: (t) => correctCase(t, { label: "correct dda-poyc", table: "dda_poyc_entries", path: "/dda-poyc/entries", action: "DDA_POYC_ENTRY_UPDATE", hash: "dda-poyc", newId: "poyreg", ready: ".cds-list",
    create: L, shown: { client_id_card: "345M" }, edit: { medicine_name_dose: "Methadone 10mg/ml", prescription_serial_no: "PY-210" }, edit2: { prescription_serial_no: "PY-211" }, want: { medicine_name_dose: "Methadone 10mg/ml", prescription_serial_no: "PY-210" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), medicine_name_dose: "Methadone 10mg/ml", prescription_serial_no: "PY-210" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), quantity: 90 }) }),
};
