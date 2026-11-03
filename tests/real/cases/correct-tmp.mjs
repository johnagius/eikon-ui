// Correcting a temperature reading (tempreg) in the new layout: two new fridges get today's reading; see _correct.mjs.
// The update is the classic's upsert (POST /temperature/entries for the device and day): the same row, never a new one.
import { correctCase, ymd } from "./_correct.mjs";
const devs = [];
const R = (i) => ({ device_id: devs[i], entry_date: ymd(0), min_temp: 3.4, max_temp: 7.2, notes: "" });
const KEYS = ["device_id", "entry_date", "min_temp", "max_temp", "notes"];
export default {
  title: "Correct a temperature reading",
  run: (t) => correctCase(t, { label: "correct temperature", table: "temperature_entries", path: "/temperature/entries", action: "TEMP_ENTRY_UPSERT", method: "POST", hash: "temperature", newId: "tempreg", ready: ".trg-grid", footSel: ".trg-note", allow: { device_id: "the twin reading is on the other test fridge" },
    setup: async (call) => { for (const n of ["Test fridge A", "Test fridge B"]) { const r = await call("POST", "/temperature/devices", { name: n, device_type: "fridge", min_limit: 2, max_limit: 8 }); devs.push(r.device_id || r.id || (r.device && r.device.id)); } },
    // Correct is in the day's panel: the day is opened first (the day panel, tempnote.mjs)
    reveal: async (p, row) => { await p.click(`button.trg-d[data-day="${row.entry_date}"][data-dev="${row.device_id}"]`); await p.waitForSelector(`[data-ecr=open][data-ecr-id="${row.id}"]`, { timeout: 8000 }); },
    create: (i) => R(i), putPath: () => "/temperature/entries", shown: { max_temp: "7.2" }, edit: { max_temp: "8.4", notes: "Door left open, checked stock" }, edit2: { notes: "Door open" },
    want: { max_temp: 8.4, notes: "Door left open, checked stock" }, bodyKeys: KEYS,
    classic: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), max_temp: 8.4, notes: "Door left open, checked stock" }),
    stale: (r) => ({ ...Object.fromEntries(KEYS.map((k) => [k, r[k]])), min_temp: 3.1 }) }),
};
