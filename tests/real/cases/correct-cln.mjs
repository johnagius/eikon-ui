// Correcting a Cleaning line (cleanreg) in the new layout: see _correct.mjs.
import { correctCase, ymd } from "./_correct.mjs";
const L = { entry_date: ymd(0), time_in: "07:30", time_out: "08:10", cleaner_name: "Rita", staff_name: "Maria", notes: "Dispensary and fridge" };
const KEYS = Object.keys(L);
export default {
  title: "Correct a cleaning line",
  run: (t) => correctCase(t, { label: "correct cleaning", table: "cleaning_entries", path: "/cleaning/entries", action: "CLEANING_ENTRY_UPDATE", hash: "cleaning", newId: "cleanreg", ready: ".clr-list",
    create: L, shown: { cleaner_name: "Rita" }, edit: { cleaner_name: "Rita Borg", notes: "Dispensary only" }, edit2: { notes: "Fridge only" }, want: { cleaner_name: "Rita Borg", notes: "Dispensary only" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), cleaner_name: "Rita Borg", notes: "Dispensary only" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), time_out: "08:20" }) }),
};
