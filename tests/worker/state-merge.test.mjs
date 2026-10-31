// The four "whole state" endpoints must never delete what a PC did not load.
import { test, eq, ok } from "./lib.mjs";

const rec = (id, pid) => ({ id, testType: "bp", testLabel: "Blood Pressure", patientId: pid, patientName: "Test " + pid, performedAtIso: "2026-10-31T09:00:00.000Z", results: { sys: 120, dia: 80, pulse: 70 } });
const pat = (pid) => ({ patientId: pid, name: "Test " + pid, phone: "", age: 50, address: "" });

test("POCT: a stale save from a second PC keeps the first PC's records", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const a = await api("PUT", "/poct/state", { token, body: { state: { records: [rec("r1", "0001111M")], patients: [pat("0001111M")] } } });
  eq(a.status, 200, a.text);
  // PC B loaded before r1 existed and saves its own record only
  const b = await api("PUT", "/poct/state", { token, body: { state: { records: [rec("r2", "0002222M")], patients: [pat("0002222M")] } } });
  eq(b.status, 200, b.text);
  eq(DB.q("SELECT record_id FROM poct_records ORDER BY record_id").map((r) => r.record_id), ["r1", "r2"]);
  eq(DB.q("SELECT patient_id FROM poct_patients ORDER BY patient_id").map((r) => r.patient_id), ["0001111M", "0002222M"]);
  // An empty payload deletes nothing
  eq((await api("PUT", "/poct/state", { token, body: { state: { records: [], patients: [] } } })).status, 200);
  eq(DB.q("SELECT COUNT(*) AS c FROM poct_records")[0].c, 2);
  // An explicit delete removes exactly that record and is audited
  const d = await api("PUT", "/poct/state", { token, body: { state: { records: [], patients: [], deleted_record_ids: ["r1"] } } });
  eq(d.status, 200, d.text);
  eq(d.json.records_deleted, 1);
  eq(DB.q("SELECT record_id FROM poct_records").map((r) => r.record_id), ["r2"]);
  ok(DB.one("SELECT 1 AS x FROM audit_log WHERE action='POCT_STATE_PUT'"), "POCT saves are audited now");
  // GET returns the merged state
  const g = await api("GET", "/poct/state", { token });
  eq(g.json.state.records.length, 1);
});

test("POCT: wipe_all is explicit and audited", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await api("PUT", "/poct/state", { token, body: { state: { records: [rec("r1", "0001111M")], patients: [pat("0001111M")] } } });
  const w = await api("PUT", "/poct/state", { token, body: { state: { records: [], patients: [], wipe_all: true } } });
  eq(w.status, 200, w.text);
  eq(DB.q("SELECT COUNT(*) AS c FROM poct_records")[0].c, 0);
  ok(DB.one("SELECT 1 AS x FROM audit_log WHERE action='POCT_WIPE_ALL'"));
});

for (const [name, path, key] of [["pharmacovigilance", "/pharmacovigilance/state", "reports"], ["screening", "/screening/state", "campaigns"]]) {
  test(`${name}: saves merge across PCs, empty payload deletes nothing, deleted_ids deletes`, async ({ api, bootstrap }) => {
    const { token } = await bootstrap();
    const body = (items, extra = {}) => ({ state: { [key]: items, ...extra } });
    eq((await api("PUT", path, { token, body: body([{ id: "a", name: "A" }]) })).status, 200);
    eq((await api("PUT", path, { token, body: body([{ id: "b", name: "B" }]) })).status, 200);
    let g = await api("GET", path, { token });
    eq(g.json[key].map((x) => x.id).sort(), ["a", "b"]);
    eq((await api("PUT", path, { token, body: body([]) })).status, 200);
    g = await api("GET", path, { token });
    eq(g.json[key].length, 2, "empty payload must not wipe the location");
    eq((await api("PUT", path, { token, body: body([], { deleted_ids: ["a"] }) })).status, 200);
    g = await api("GET", path, { token });
    eq(g.json[key].map((x) => x.id), ["b"]);
  });
}

test("labels: history is never deleted by omission; templates and details still save", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const put = (labelHistory, templates = [{ id: "t1", name: "Standard", size: "standard" }]) => api("PUT", "/labels/state", { token, body: { state: { labelHistory, templates, pharmacyDetails: { name: "Demo" } } } });
  eq((await put([{ id: "L1", drug: "Amoxicillin" }])).status, 200);
  eq((await put([{ id: "L2", drug: "Metformin" }])).status, 200);
  eq((await put([])).status, 200);
  const g = await api("GET", "/labels/state", { token });
  eq(g.json.state.labelHistory.map((l) => l.id).sort(), ["L1", "L2"]);
  eq(g.json.state.pharmacyDetails.name, "Demo");
  eq(g.json.state.templates[0].id, "t1");
});
