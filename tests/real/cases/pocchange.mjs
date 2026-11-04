// POCT (pocreg, BACKLOG5 item 10b) vs the classic POCT screen: changing a test (the classic Edit, then Save) leaves the
// same record row and patient card, and the same audit row; one test printed for the patient is the classic page,
// tag for tag (only the "Printed:" moment differs).
import { ymd } from "../lib.mjs";
const T = "poct_records", P = "poct_patients", PID = "0456123M";
const rec = (id) => ({ id, testType: "bp", testLabel: "Blood Pressure", performedAtIso: new Date(ymd(-2) + "T09:15").toISOString(), performedAtLocal: ymd(-2) + "T09:15",
  patient: { name: "Borġ Ċensina", patientId: PID, phone: "79111222", age: 71, address: "Żebbuġ" }, feeDue: 0, notes: "Before breakfast", intervention: "", results: { sys: 148, dia: 92, pulse: 70, arm: "Left", position: "Sitting" }, updatedAtIso: "2026-11-01T08:00:00.000Z" });
const card = { patientId: PID, name: "Borġ Ċensina", phone: "79111222", age: 71, address: "Żebbuġ", createdAtIso: "2026-11-01T08:00:00.000Z", updatedAtIso: "2026-11-01T08:00:00.000Z", lastSeenIso: "2026-11-01T08:00:00.000Z", conflicts: [] };
const rowOf = (t, rid) => t.db.prepare(`SELECT * FROM ${T} WHERE record_id = ?`).get(rid);
const patient = (t) => t.jsonCol(t.db.prepare(`SELECT * FROM ${P} WHERE patient_id = ?`).get(PID), "patient_json", ["updatedAtIso"]);
const auditPut = (t, since) => t.db.prepare("SELECT org_id, user_id, action, entity_type, entity_id, location_id, details_json FROM audit_log WHERE id > ? AND action = 'POCT_STATE_PUT' ORDER BY id").all(since);
export default {
  title: "POCT: change a test, print one",
  async run(t) {
    const A = "r_10b_a_" + Date.now(), B = "r_10b_b_" + Date.now();
    await t.api("PUT", "/poct/state", { records: [rec(A), rec(B)], patients: [card] });
    const p = await t.page();
    await p.context().addInitScript(() => { window.print = () => {}; });
    const grab = async (click) => { const [w] = await Promise.all([p.waitForEvent("popup"), click()]); await w.waitForLoadState(); await w.waitForTimeout(400); const h = await w.evaluate(() => document.documentElement.outerHTML); await w.close(); return h.replace(/Printed: [^<\n]*/, "Printed: (now)"); };

    // classic: All records › Print, then Edit › change systolic, notes and intervention › Save Blood Pressure
    await t.open(p, "classic", "poct", "poct", "#nav");
    await p.waitForTimeout(600); await t.idle(p); // the classic screen's own first save (if any) is done
    await p.click('[data-section="sec-all"]'); await p.waitForSelector(`#all_tbody [data-act=print][data-id="${A}"]`);
    const printClassic = await grab(() => p.click(`#all_tbody [data-act=print][data-id="${A}"]`));
    await p.click(`#all_tbody [data-act=edit][data-id="${A}"]`); await p.waitForSelector("#bp_sys:visible");
    await p.fill("#bp_sys", "138"); await p.fill("#bp_notes", "After the walk"); await p.fill("#bp_intervention", "Advised GP visit");
    const c0 = t.maxId("audit_log");
    await t.write(p, /\/poct\/state$/, () => p.click("#bp_save"), "PUT");
    await p.waitForTimeout(300);
    const ca = rowOf(t, A), cp = patient(t), cAud = auditPut(t, c0);

    // new: the patient › Print beside the test, then Change › same changes › Save changes
    await p.goto("about:blank"); await t.open(p, "2", "poct", "pocreg", "#poc-q");
    await p.fill("#poc-q", "Ċensina"); await p.waitForSelector(`[data-act=open][data-pid="${PID}"]`); await p.click(`[data-act=open][data-pid="${PID}"]`);
    await p.waitForSelector(`[data-act=print-test][data-rid="${B}"]`);
    const printNew = await grab(() => p.click(`[data-act=print-test][data-rid="${B}"]`));
    await p.click(`[data-act=edit-test][data-rid="${B}"]`); await p.waitForSelector("#poc-add");
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === "sys", null, { timeout: 3000 }).catch(() => {});
    const pre = await p.evaluate(() => { const f = document.querySelector("#poc-add"); const v = (n) => (f.querySelector("[name=" + n + "]") || {}).value; return { sys: v("sys"), dia: v("dia"), pulse: v("pulse"), arm: v("arm"), dt: v("dt"), name: v("name"), pid: v("patientId"), seg: !!f.querySelector(".poc-seg"), btn: f.querySelector("button[type=submit]").textContent, focus: document.activeElement && document.activeElement.name }; });
    t.ok(pre.sys === "148" && pre.dia === "92" && pre.pulse === "70" && pre.arm === "Left" && pre.dt === ymd(-2) + "T09:15" && pre.name === "Borġ Ċensina" && pre.pid === PID && !pre.seg && pre.btn === "Save changes" && pre.focus === "sys", "change(new): the form opens filled from the test, on the first result: " + JSON.stringify(pre));
    await t.fill(p, "#poc-add", { sys: "138", notes: "After the walk", intervention: "Advised GP visit" });
    const n0 = t.maxId("audit_log");
    const w = await t.write(p, /\/poct\/state$/, () => p.click("#poc-add button[type=submit]"), "PUT");
    await p.waitForTimeout(300);
    const nb = rowOf(t, B), np = patient(t), nAud = auditPut(t, n0);

    t.ok(w.body && w.body.records && w.body.records.length === 1 && w.body.records[0].id === B, "change(new): the test keeps its id (no second test)");
    t.has("change(new)", nb, { test_type: "bp", patient_id: PID, patient_name: "Borġ Ċensina", performed_at_local: ymd(-2) + "T09:15" });
    const J = (r) => t.jsonCol(r, "record_json", ["id", "updatedAtIso"]);
    t.same("change", J(ca), J(nb), { record_id: "two tests, each its own id", updated_at_iso: "the moment of saving" });
    t.ok(JSON.parse(nb.record_json).results.sys === 138 && JSON.parse(nb.record_json).notes === "After the walk", "change(new): the new values are stored");
    t.same("patient card", cp, np, { updated_at_iso: "the moment of saving"});
    // POCT audit rows name no record, and other cases (pocreg) write POCT at the same time: each save must have left the
    // one-record, one-card row, and the two screens' rows are the same row.
    const one = JSON.stringify({ patients_upserted: 1, records_upserted: 1, patients_deleted: 0, records_deleted: 0, patients_written: 1, records_written: 1 });
    const pick = (l) => l.filter((x) => x.details_json === one).map((x) => JSON.stringify(x))[0];
    t.ok(pick(cAud) && pick(cAud) === pick(nAud), "change: the audit rows are the same: " + JSON.stringify(cAud) + " vs " + JSON.stringify(nAud));
    t.ok(t.db.prepare(`SELECT COUNT(*) AS c FROM ${T} WHERE patient_id = ?`).get(PID).c === 2, "change: still two tests for the patient");

    // print: the same page (both records are identical but for the id, which the page does not show)
    t.ok(printClassic.length > 800 && printClassic === printNew, "print: the new page is the classic one, tag for tag" + (printClassic === printNew ? "" : ` (classic ${printClassic.length}, new ${printNew.length})`));
    t.ok(/Blood Pressure Result/.test(printNew) && /Borġ Ċensina/.test(printNew) && /Systolic \(mmHg\)/.test(printNew), "print: the test, the patient's name with Maltese letters, the results");
  },
};
