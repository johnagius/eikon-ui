// POCT (pocreg) vs classic POCT: a blood pressure test for a new patient, stored through /poct/state.
import { ymd } from "../lib.mjs";
const IN = { dt: ymd(-1) + "T10:30", name: "Borg Paul", pid: "0789123M", phone: "79555666", age: "58", addr: "Mosta", notes: "After a walk", inter: "Advised GP visit", sys: "152", dia: "96", pulse: "74", arm: "Right", pos: "Standing" };
export default {
  title: "POCT",
  async run(t) {
    const T = "poct_records", p = await t.page();
    await t.open(p, "classic", "poct", "poct", "#nav");
    let m = t.maxId(T);
    await p.click('[data-section="sec-bp"]'); await p.waitForSelector("#bp_name:visible");
    await t.fill(p, "", { "#bp_dt": IN.dt, "#bp_name": IN.name, "#bp_pid": IN.pid, "#bp_phone": IN.phone, "#bp_age": IN.age, "#bp_address": IN.addr, "#bp_notes": IN.notes, "#bp_intervention": IN.inter, "#bp_sys": IN.sys, "#bp_dia": IN.dia, "#bp_pulse": IN.pulse });
    await p.selectOption("#bp_arm", IN.arm); await p.selectOption("#bp_pos", IN.pos);
    await t.write(p, /\/poct\/state$/, () => p.click("#bp_save"), "PUT");
    for (let i = 0; i < 30 && !t.since(T, m).length; i++) await p.waitForTimeout(100);
    const classic = t.since(T, m)[0];
    await t.open(p, "2", "poct", "pocreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#poc-add");
    await t.fill(p, "#poc-add", { patientId: IN.pid, name: IN.name, phone: IN.phone, age: IN.age, address: IN.addr, dt: IN.dt, notes: IN.notes, intervention: IN.inter, sys: IN.sys, dia: IN.dia, pulse: IN.pulse });
    await p.selectOption("#poc-add [name=arm]", IN.arm); await p.selectOption("#poc-add [name=position]", IN.pos);
    await t.write(p, /\/poct\/state$/, () => p.click("#poc-add button[type=submit]"), "PUT");
    for (let i = 0; i < 30 && !t.since(T, m).length; i++) await p.waitForTimeout(100);
    const fresh = t.since(T, m)[0];
    t.has("poct(new)", fresh, { test_type: "bp", patient_id: IN.pid, patient_name: IN.name, patient_phone: IN.phone, patient_age: 58, patient_address: IN.addr, performed_at_local: IN.dt });
    const J = (r) => t.jsonCol(r, "record_json", ["id", "updatedAtIso"]);
    t.same("poct", J(classic), J(fresh), { record_id: "each test gets its own id (r_<time>_<random>)", updated_at_iso: "the moment of saving" });
  },
};
