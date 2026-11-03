// DDA POYC (poyreg) vs classic DDA POYC.
import { ymd } from "../lib.mjs"; import { rxCase } from "./_rx.mjs";
const IN = { date: ymd(0), id: "567891M", name: "Galea Tony", addr: "9 Triq il-Mitħna, Rabat", doc: "Dr Ruth Galea", reg: "R3301", serial: "PY-8001", med: "Diazepam 5mg tablets", qty: "30" };
export default {
  title: "DDA POYC",
  run: (t) => rxCase(t, { label: "poyc", input: IN, hash: "dda-poyc", classicId: "dda-poyc", newId: "poyreg", table: "dda_poyc_entries", path: "/dda-poyc/entries",
    classicPh: { name: "Client name", id: "ID card", addr: "Address", med: "e.g. Diazepam 5mg", doc: "Doctor name", reg: "Registration no.", serial: "Serial no." },
    want: { entry_date: IN.date, client_id_card: IN.id, client_name: IN.name, client_address: IN.addr, medicine_name_dose: IN.med, quantity: 30, doctor_name: IN.doc, doctor_reg_no: IN.reg, prescription_serial_no: IN.serial } }),
};
