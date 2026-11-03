// DDA sales (cdsreg) vs classic DDA Sales.
import { ymd } from "../lib.mjs"; import { rxCase } from "./_rx.mjs";
const IN = { date: ymd(0), id: "345678M", name: "Mifsud Rose", addr: "4 Triq il-Wied, Zebbug", doc: "Dr Mark Abela", reg: "R2201", serial: "RX-7001", med: "Oxycodone 5mg capsules", qty: "20", urgent: true };
export default {
  title: "DDA sales",
  run: (t) => rxCase(t, { label: "dda-sales", input: IN, hash: "dda-sales", classicId: "dda-sales", newId: "cdsreg", table: "dda_sales_entries", path: "/dda-sales/entries", urgent: true,
    classicPh: { name: "Client name", id: "ID card no.", addr: "Client address", med: "Medicine name & dose", doc: "Doctor name", reg: "Doctor reg no.", serial: "Prescription serial no." },
    want: { entry_date: IN.date, client_id_card: "0345678M", client_name: IN.name, client_address: IN.addr, medicine_name_dose: IN.med, quantity: 20, doctor_name: IN.doc, doctor_reg_no: IN.reg, prescription_serial_no: IN.serial, urgent: 1 } }),
};
