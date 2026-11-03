// Smart labels: PUT /labels/state receives the whole history from the classic screen.
import { test, eq, ok } from "./lib.mjs";

const lbl = (i, over = {}) => ({ id: "lb_" + i, patientName: "Patient " + i, drugName: "Drug " + (i % 50), dose: "1 tab", printedAt: "2026-10-01 10:00", ...over });

// Counts label_history write statements (each bound statement) and every round trip to D1.
function counter(DB) {
  const c = { lbWrites: 0, trips: 0 };
  const prep = DB.prepare.bind(DB);
  DB.prepare = (sql) => {
    const st = prep(sql);
    const isW = /INSERT INTO label_history/i.test(String(sql));
    const wrap = (s) => {
      const b = s.bind.bind(s);
      s.bind = (...a) => { if (a.length > 100) throw new Error("too many SQL variables"); if (isW) c.lbWrites++; return wrap(b(...a)); };
      for (const m of ["run", "first", "all", "raw"]) { const f = s[m].bind(s); s[m] = (...a) => { c.trips++; return f(...a); }; }
      return s;
    };
    return wrap(st);
  };
  const batch = DB.batch.bind(DB);
  DB.batch = (stmts) => { c.trips++; c.trips -= stmts.length; return batch(stmts); }; // a batch is one round trip
  return c;
}

test("labels: a full-history save writes only new or changed labels, in a few statements; stored rows as before", async ({ api, bootstrap, DB }) => {
  const { token, user } = await bootstrap();
  const N = 3000;
  const first = [];
  for (let i = N - 1; i >= 0; i--) first.push(lbl(i));
  first.splice(10, 0, lbl(7, { patientName: "Dup Ignored" })); // a repeated id: the first in the payload wins (as before)
  first.push({ patientName: "no id" });
  const c = counter(DB);
  const s1 = await api("PUT", "/labels/state", { token, body: { state: { labelHistory: first, templates: [{ id: "t" }], pharmacyDetails: { name: "P" } } } });
  eq(s1.status, 200, s1.text);
  eq(s1.json.saved, N);
  console.log("       first save trips", c.trips, "label write stmts", c.lbWrites); ok(c.trips < 80, "first save of " + N + " labels took " + c.trips + " round trips");

  // The second save: the whole history again, one new label on top, one edited, one left out, one deleted explicitly.
  const second = [lbl(99999), ...first.filter((l) => l.id !== "lb_10")].map((l) => l.id === "lb_5" ? { ...l, dose: "2 tabs" } : l);
  c.lbWrites = 0; c.trips = 0;
  const s2 = await api("PUT", "/labels/state", { token, body: { state: { labelHistory: second, templates: [], pharmacyDetails: {}, deleted_ids: ["lb_20"] } } });
  eq(s2.status, 200, s2.text);
  ok(c.lbWrites <= 1, "re-save wrote " + c.lbWrites + " label statements (was one per label)");
  console.log("       re-save trips", c.trips); ok(c.trips < 80, "re-save took " + c.trips + " round trips");

  // What the old one-statement-per-label code stored: every id ever sent (first JSON per save wins,
  // later saves overwrite), nothing removed by omission, explicit deletes removed.
  const expect = new Map();
  for (const save of [first, second]) {
    const seen = new Set();
    for (const l of save) { if (!l.id || seen.has(l.id)) continue; seen.add(l.id); expect.set(l.id, JSON.stringify(l)); }
  }
  expect.delete("lb_20");
  const rows = DB.q("SELECT label_id, label_json, created_by, updated_by FROM label_history WHERE org_id = 1 AND location_id = 1 ORDER BY id");
  eq(rows.length, expect.size);
  for (const r of rows) eq(r.label_json, expect.get(r.label_id), "row " + r.label_id);
  ok(rows.some((r) => r.label_id === "lb_10"), "a label left out of the payload is kept");
  eq(rows[rows.length - 1].label_id, "lb_99999", "the new label is the newest row");

  const g = await api("GET", "/labels/state", { token });
  eq(g.json.state.labelHistory.length, expect.size);
  eq(g.json.state.labelHistory[0].id === "lb_99999" || g.json.state.labelHistory[0].id === "lb_5", true, "a just-written label lists first");
  const audit = DB.q("SELECT details_json FROM audit_log WHERE action = 'LABELS_STATE_PUT' ORDER BY id");
  eq(JSON.parse(audit[1].details_json).written, 2);
  void user;
});
