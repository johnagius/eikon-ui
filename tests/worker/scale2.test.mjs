// SCALE-2 (design/eikon-next/SCALE-2.md): the read-narrowing changes keep the same answers.
import { test, eq, ok } from "./lib.mjs";

test("poct/state?part=patients: the patient list only, same shape, records empty; without it both as before", async ({ api, bootstrap }) => {
  const a = await bootstrap();
  const put = await api("PUT", "/poct/state", { token: a.token, body: { records: [{ id: "r1", testType: "bp", performedAtIso: "2026-11-01T09:00:00.000Z", patient: { name: "Borg Maria", patientId: "p1", phone: "79123456" }, results: { sys: 120, dia: 80 } }], patients: [{ patientId: "p1", name: "Borg Maria", phone: "79123456" }] } });
  eq(put.status, 200, put.text);
  const full = await api("GET", "/poct/state", { token: a.token });
  eq([full.json.records.length, full.json.patients.length, full.json.state.records.length], [1, 1, 1]);
  const only = await api("GET", "/poct/state?part=patients", { token: a.token });
  eq(only.status, 200, only.text);
  eq([only.json.records.length, only.json.state.records.length], [0, 0]);
  eq(JSON.stringify(only.json.patients), JSON.stringify(full.json.patients));
  eq(JSON.stringify(only.json.state.patients), JSON.stringify(full.json.state.patients));
});

test("people: a merged-in record still adds its name to the kept person's timeline (indexed alias read)", async ({ api, bootstrap }) => {
  const a = await bootstrap();
  const p1 = await api("POST", "/people", { token: a.token, body: { name: "Zammit Carmel", id_card: "123456M" } });
  const p2 = await api("POST", "/people", { token: a.token, body: { name: "Zammit Karmenu" } });
  eq([p1.status, p2.status], [200, 200], p1.text + p2.text);
  const o = await api("POST", "/client-orders/entries", { token: a.token, body: { order_date: "2026-11-01", client_name: "Zammit Karmenu", client_phone: "79123456", items_text: "Panadol x2", priority: 2 } });
  eq(o.status, 200, o.text);
  const m = await api("POST", "/people/" + p2.json.person.id + "/merge", { token: a.token, body: { into_id: p1.json.person.id } });
  eq(m.status, 200, m.text);
  const t = await api("GET", "/people/" + p1.json.person.id, { token: a.token });
  eq(t.status, 200, t.text);
  ok(t.json.activity.some((x) => x.kind === "order"), "the merged name's order is missing: " + t.text.slice(0, 300));
  const again = await api("POST", "/people", { token: a.token, body: { name: "Someone Else", id_card: "123456M" } });
  ok(again.status === 200 || again.status === 409, again.text);
});
