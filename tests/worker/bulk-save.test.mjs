// Whole-state saves (POCT, pharmacovigilance, screening) write only new or changed rows, many rows per
// statement, so a big pharmacy stays far below D1's per-request query limit. Before, every item in the body
// cost one statement on every save (2,000 POCT records = 2,500 statements per save).
import { test, eq, ok } from "./lib.mjs";

// Counts the D1 statements a request runs (each statement inside env.DB.batch counts once).
function countStatements(DB) {
  const st = { n: 0, inBatch: false };
  const proto = Object.getPrototypeOf(DB.prepare("SELECT 1"));
  const saved = {};
  for (const m of ["first", "all", "run", "raw"]) {
    saved[m] = proto[m];
    proto[m] = function (...a) { if (!st.inBatch) st.n++; return saved[m].apply(this, a); };
  }
  const batch = DB.batch;
  DB.batch = async function (s) { st.n += s.length; st.inBatch = true; try { return await batch.call(this, s); } finally { st.inBatch = false; } };
  st.restore = () => { Object.assign(proto, saved); DB.batch = batch; };
  return st;
}
async function measured(DB, fn) {
  const c = countStatements(DB);
  try { const r = await fn(); return { r, n: c.n }; } finally { c.restore(); }
}

const pid = (i) => String(1000000 + i) + "M";
const TYPES = ["bp", "urine", "hba1c", "bg", "chol", "bmi"];
const rec = (i, v = "") => ({ id: "r" + i, testType: TYPES[i % 6], testLabel: TYPES[i % 6], performedAtIso: "2026-10-01T09:00:00.000Z", updatedAtIso: "2026-10-01T09:00:00.000Z",
  patient: { patientId: pid(i % 500), name: "Pat " + (i % 500), phone: "79" + i, age: 50 }, feeDue: 5, notes: v, results: { sys: 120, dia: 80, pct: 5.6, glucose: 6.1, tc: 5.2, weight: 80.5, leu: "neg" } });
const pat = (i, v = "") => ({ patientId: pid(i), name: "Pat " + i + v, phone: "79" + i, age: 50, address: "", createdAtIso: "2026-01-01T00:00:00.000Z", updatedAtIso: "2026-10-01T00:00:00.000Z", lastSeenIso: "", conflicts: [] });
const range = (n) => Array.from({ length: n }, (_, i) => i);

test("whole-state saves: POCT with 2,000 records re-saves in a handful of statements and rewrites only what changed", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const recs = range(2000).map((i) => rec(i)), pats = range(500).map((i) => pat(i));
  const first = await measured(DB, () => api("PUT", "/poct/state", { token, body: { state: { records: recs, patients: pats } } }));
  eq(first.r.status, 200, first.r.text);
  ok(first.n < 700, "first save of 2,000 new records: " + first.n + " statements (was 2,500+)");
  eq(first.r.json.records_upserted, 2000);
  eq(first.r.json.records_written, 2000);
  eq(DB.one("SELECT COUNT(*) AS c FROM poct_records").c, 2000);

  const b = await addUser({ email: "b@example.com", role: "staff" });
  const again = await measured(DB, () => api("PUT", "/poct/state", { token: b.token, body: { state: { records: recs, patients: pats } } }));
  eq(again.r.status, 200, again.r.text);
  eq([again.r.json.records_upserted, again.r.json.patients_upserted], [2000, 500], "counts as before");
  eq([again.r.json.records_written, again.r.json.patients_written], [0, 0]);
  ok(again.n <= 12, "an unchanged re-save ran " + again.n + " statements (was 2,507)");
  eq(DB.one("SELECT COUNT(*) AS c FROM poct_records WHERE updated_by = ?", b.user.id).c, 0, "untouched rows keep updated_by");

  const edited = recs.slice(); edited[7] = rec(7, "changed"); const pats2 = pats.slice(); pats2[3] = pat(3, " Jr");
  const edit = await measured(DB, () => api("PUT", "/poct/state", { token: b.token, body: { state: { records: edited, patients: pats2 } } }));
  eq([edit.r.json.records_written, edit.r.json.patients_written], [1, 1]);
  ok(edit.n <= 12, "a one-record edit ran " + edit.n + " statements");
  eq(DB.one("SELECT notes, updated_by FROM poct_records WHERE record_id = 'r7'"), { notes: "changed", updated_by: b.user.id });
  eq(DB.one("SELECT name, updated_by, created_at_iso FROM poct_patients WHERE patient_id = ?", pid(3)), { name: "Pat 3 Jr", updated_by: b.user.id, created_at_iso: "2026-01-01T00:00:00.000Z" });
  eq(DB.one("SELECT COUNT(*) AS c FROM poct_records WHERE updated_by = ?", b.user.id).c, 1);
});

test("whole-state saves: POCT duplicates, explicit deletes over 100 ids and the created_at_iso rule are unchanged", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const recs = range(300).map((i) => rec(i));
  recs.push(rec(5, "second copy")); // the same id twice: the last copy wins, as with the old row-by-row upserts
  const pats = range(10).map((i) => pat(i)); pats.push(Object.assign(pat(2, " B"), { createdAtIso: "2020-01-01T00:00:00.000Z" }));
  eq((await api("PUT", "/poct/state", { token, body: { state: { records: recs, patients: pats } } })).status, 200);
  eq(DB.one("SELECT notes FROM poct_records WHERE record_id = 'r5'").notes, "second copy");
  eq(DB.one("SELECT name, created_at_iso FROM poct_patients WHERE patient_id = ?", pid(2)), { name: "Pat 2 B", created_at_iso: "2026-01-01T00:00:00.000Z" });
  // a stored '' created_at_iso is filled from the save, as the old CASE did
  DB.db.prepare("UPDATE poct_patients SET created_at_iso = '' WHERE patient_id = ?").run(pid(4));
  eq((await api("PUT", "/poct/state", { token, body: { state: { records: [], patients: [pat(4)] } } })).json.patients_written, 1);
  eq(DB.one("SELECT created_at_iso FROM poct_patients WHERE patient_id = ?", pid(4)).created_at_iso, "2026-01-01T00:00:00.000Z");
  // 150 explicit deletes in one save (the old 800-id chunk was over D1's 100-parameter limit)
  const del = await measured(DB, () => api("PUT", "/poct/state", { token, body: { state: { records: [], patients: [], deleted_record_ids: range(150).map((i) => "r" + i).concat(["nope", " r1 "]) } } }));
  eq(del.r.json.records_deleted, 150);
  ok(del.n <= 10, "150 deletes ran " + del.n + " statements");
  eq(DB.one("SELECT COUNT(*) AS c FROM poct_records").c, 150);
});

for (const [name, path, key, table, make] of [
  ["pharmacovigilance", "/pharmacovigilance/state", "reports", "pv_reports", (i, v = "") => ({ id: "pv" + i, reporter_name: "Joe Borg", drug: "Drug " + i + v, report_date: "2026-10-01" })],
  ["screening", "/screening/state", "campaigns", "screening_campaigns", (i, v = "") => ({ id: "c" + i, name: "Campaign " + i + v, startDate: "2026-09-01", participants: range(10).map((k) => ({ id: "p" + k, name: "Rita Borg", idCard: k + "M", poctResults: { sys: 120 + k } })) })]
]) {
  const N = name === "screening" ? 300 : 1000;
  test(`whole-state saves: ${name} with ${N} items re-saves in a handful of statements; first copy of a duplicate wins; deletes batch`, async ({ api, bootstrap, addUser, DB }) => {
    const { token } = await bootstrap();
    const items = range(N).map((i) => make(i));
    items.push(make(3, " duplicate")); // first copy wins, as before
    const first = await measured(DB, () => api("PUT", path, { token, body: { state: { [key]: items } } }));
    eq(first.r.status, 200, first.r.text);
    ok(first.n < N / 8, "first save ran " + first.n + " statements (was " + (N + 8) + ")");
    eq([first.r.json.saved, first.r.json.written], [N, N]);
    const b = await addUser({ email: "b@example.com", role: "staff" });
    const again = await measured(DB, () => api("PUT", path, { token: b.token, body: { state: { [key]: items } } }));
    eq([again.r.json.saved, again.r.json.written], [N, 0]);
    ok(again.n <= 12, "an unchanged re-save ran " + again.n + " statements (was " + (N + 8) + ")");
    const edited = items.slice(); edited[10] = make(10, " edited");
    const edit = await measured(DB, () => api("PUT", path, { token: b.token, body: { state: { [key]: edited } } }));
    eq(edit.r.json.written, 1);
    ok(edit.n <= 12, "a one-item edit ran " + edit.n + " statements");
    eq(DB.one(`SELECT COUNT(*) AS c FROM ${table} WHERE updated_by = ?`, b.user.id).c, 1, "only the edited row gets the new updated_by");
    const g = await api("GET", path, { token });
    const byId = Object.fromEntries(g.json[key].map((x) => [x.id, x]));
    eq(g.json[key].length, N);
    eq(JSON.stringify(byId[make(3).id]), JSON.stringify(make(3)), "first copy of a duplicate id is the one stored");
    eq(JSON.stringify(byId[make(10).id]), JSON.stringify(make(10, " edited")));
    const del = await measured(DB, () => api("PUT", path, { token, body: { state: { [key]: [], deleted_ids: range(120).map((i) => make(i).id).concat(["missing"]) } } }));
    eq(del.r.status, 200, del.r.text);
    ok(del.n <= 10, "120 deletes ran " + del.n + " statements (was 128)");
    eq(DB.one(`SELECT COUNT(*) AS c FROM ${table}`).c, N - 120);
    ok(DB.one("SELECT details_json FROM audit_log WHERE action = ? ORDER BY id DESC LIMIT 1", name === "screening" ? "SCREENING_STATE_PUT" : "PV_STATE_PUT").details_json.includes('"deleted":120'));
  });
}
