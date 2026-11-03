// Correcting a Locum register line (locreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), time_in: "08:00", time_out: "13:00", locum_full_name: "Dr Paul Locum", registration_number: "R5566" };
const KEYS = Object.keys(L);
export default {
  title: "Correct a locum register line",
  run: (t) => correctCase(t, { label: "correct locum-register", table: "locum_register_entries", path: "/locumregister/entries", action: "LOCUM_REGISTER_ENTRY_UPDATE", hash: "locumregister", newId: "locreg", ready: ".lcr-list",
    create: L, shown: { time_out: "13:00" }, edit: { time_out: "14:30" }, edit2: { time_out: "14:00" }, want: { time_out: "14:30" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), time_out: "14:30" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), registration_number: "R5567" }) }),
};
