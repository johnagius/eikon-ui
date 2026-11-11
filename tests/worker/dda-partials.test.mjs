import { test, eq, ok } from "./lib.mjs";

// Partial dispensing (Finish round, records): parts are ordinary register lines saved with the classic route and body;
// /dda-partials only links them to one prescription with the quantity prescribed, until 0 is left or it is closed.
const today = new Date().toISOString().slice(0, 10);
const shift = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const line = (date, q, serial, med) => ({ entry_date: date, client_name: "Carmel Zammit", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: med || "Methylphenidate 10mg", quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: serial });

test("dda partials: start from a saved line, give the rest in parts until 0, history in order; register rows untouched", async (app) => {
  const { api, DB } = app;
  const s = await app.bootstrap(), token = s.token;
  for (const [reg, path] of [["poyc", "/dda-poyc/entries"], ["sales", "/dda-sales/entries"]]) {
    const a = (await api("POST", path, { token, body: line(shift(today, -10), 20, "PX-" + reg) })).json;
    const snap = () => JSON.stringify(DB.q(`SELECT * FROM ${reg === "poyc" ? "dda_poyc_entries" : "dda_sales_entries"} ORDER BY id`));
    const before = snap();
    eq((await api("POST", "/dda-partials", { token, body: { register: reg, entry_id: a.entry_id, prescribed: 20 } })).status, 400, "prescribed must be more than given");
    const st = await api("POST", "/dda-partials", { token, body: { register: reg, entry_id: a.entry_id, prescribed: 60 } });
    eq(st.status, 200, st.text); eq([st.json.partial.given, st.json.partial.left, st.json.partial.status], [20, 40, "open"]);
    eq(snap(), before, reg + ": starting a part-supply changes no register row");
    eq((await api("POST", "/dda-partials", { token, body: { register: reg, entry_id: a.entry_id, prescribed: 60 } })).status, 409, "a line belongs to one part-supply");
    const id = st.json.partial.id;
    const b = (await api("POST", path, { token, body: line(shift(today, -3), 25, "PX-" + reg) })).json;
    let g = await api("POST", `/dda-partials/${id}/give`, { token, body: { entry_id: b.entry_id } });
    eq([g.json.partial.given, g.json.partial.left, g.json.partial.status], [45, 15, "open"]);
    eq((await api("POST", `/dda-partials/${id}/give`, { token, body: { entry_id: b.entry_id } })).json.already, true, "the same line twice counts once");
    const other = (await api("POST", path, { token, body: line(today, 1, "PX-o", "Morphine 10mg") })).json;
    eq((await api("POST", `/dda-partials/${id}/give`, { token, body: { entry_id: other.entry_id } })).status, 400, "another medicine is refused");
    const open = (await api("GET", "/dda-partials?register=" + reg, { token })).json.partials;
    eq(open.map((x) => [x.id, x.left]), [[id, 15]], "listed as still to give");
    eq(open[0].parts.map((p) => [p.entry_date, p.quantity]), [[shift(today, -10), 20], [shift(today, -3), 25]], "its history, oldest first");
    const ck = (await api("GET", "/dda-register/check", { token })).json.partials.filter((x) => x.id === id)[0];
    eq([ck.left, ck.first, ck.last], [15, shift(today, -10), shift(today, -3)], "the Inspection check lists it as open");
    eq((await api("GET", "/dda-register/ledger?term=methylphenidate&to=" + today, { token })).json.partials.map((x) => x.id), [id], "and the medicine's register");
    const c = (await api("POST", path, { token, body: line(today, 15, "PX-" + reg, "methylphenidate  10 mg") })).json;
    g = await api("POST", `/dda-partials/${id}/give`, { token, body: { entry_id: c.entry_id } });
    eq([g.json.partial.left, g.json.partial.status], [0, "done"], "0 left: complete");
    eq((await api("GET", "/dda-partials?register=" + reg, { token })).json.partials.length, 0, "no longer still to give");
    eq((await api("GET", "/dda-partials?register=" + reg + "&status=all", { token })).json.partials.length, 1, "kept in the history");
    eq((await api("POST", `/dda-partials/${id}/give`, { token, body: { entry_id: c.entry_id } })).status, 409, "a complete one takes no more");
  }
  const acts = DB.q("SELECT action FROM audit_log WHERE entity_type = 'dda_partials' ORDER BY id").map((r) => r.action);
  eq(acts, ["DDA_PARTIAL_START", "DDA_PARTIAL_GIVE", "DDA_PARTIAL_GIVE", "DDA_PARTIAL_START", "DDA_PARTIAL_GIVE", "DDA_PARTIAL_GIVE"], "every change in the audit");
});

test("dda partials: close with a reason; another pharmacy sees and touches none; staff can; signed out refused", async (app) => {
  const { api, DB } = app;
  const s = await app.bootstrap(), token = s.token;
  const a = (await api("POST", "/dda-sales/entries", { token, body: line(today, 10, "CL-1") })).json;
  const id = (await api("POST", "/dda-partials", { token, body: { register: "sales", entry_id: a.entry_id, prescribed: 30 } })).json.partial.id;
  eq((await api("POST", `/dda-partials/${id}/close`, { token, body: { reason: "  " } })).status, 400, "a reason is needed");
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch" });
  eq((await api("GET", "/dda-partials?register=sales", { token: branch.token })).json.partials.length, 0, "another pharmacy sees none");
  eq((await api("POST", `/dda-partials/${id}/close`, { token: branch.token, body: { reason: "x" } })).status, 404, "nor closes it");
  eq((await api("POST", "/dda-partials", { token: branch.token, body: { register: "sales", entry_id: a.entry_id, prescribed: 40 } })).status, 404, "nor starts one from our line");
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Karl Vella", role: "staff" });
  const c = await api("POST", `/dda-partials/${id}/close`, { token: staff.token, body: { reason: "Patient no longer needs it" } });
  eq([c.json.partial.status, c.json.partial.close_reason, c.json.partial.closed_name, c.json.partial.left], ["closed", "Patient no longer needs it", "Karl Vella", 20]);
  eq((await api("POST", `/dda-partials/${id}/close`, { token, body: { reason: "again" } })).status, 409);
  eq((await api("GET", "/dda-partials?register=sales")).status, 401);
  eq((await api("GET", "/dda-partials?register=x", { token })).status, 400);
  const plan = DB.q("EXPLAIN QUERY PLAN SELECT * FROM dda_partials WHERE org_id = 1 AND location_id = 1 AND register = 'sales' AND status = 'open'").map((x) => x.detail).join(" | ");
  ok(/idx_dda_partials_open/.test(plan), "the open list reads through its index: " + plan);
});
