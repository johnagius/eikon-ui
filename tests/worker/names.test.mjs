// People's names in Title Case: the shared function, casing on save, and the one-off fix with its undo.
import { test, eq, ok } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const WSRC = readFileSync(join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
const USRC = readFileSync(join(here, "..", "..", "ui", "eikon.people.js"), "utf8");
function fnText(src, name) {
  const i = src.indexOf("function " + name + "(");
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
  return src.slice(i, j + 1);
}
const nameCase = new Function(fnText(WSRC, "eikonNameCase") + "\nreturn eikonNameCase;")();
const today = new Date().toISOString().slice(0, 10);

const EXAMPLES = [
  ["carmel zammit", "Carmel Zammit"], ["CARMEL ZAMMIT", "Carmel Zammit"], ["Carmel Zammit", "Carmel Zammit"],
  ["zammit carmel", "Zammit Carmel"], ["ĠUŻEPPI BORG", "Ġużeppi Borg"], ["ġużeppi borg", "Ġużeppi Borg"],
  ["żaren zammit", "Żaren Zammit"], ["ĊENSU HILI", "Ċensu Hili"], ["IL-ĦAMRUN", "Il-Ħamrun"], ["ħaż-żebbuġ", "Ħaż-Żebbuġ"],
  ["anne-marie vella", "Anne-Marie Vella"], ["ANNE-MARIE VELLA", "Anne-Marie Vella"], ["d'amato rita", "D'Amato Rita"],
  ["O'BRIEN SEAN", "O'Brien Sean"], ["l’abbate", "L’Abbate"], ["ta’ xbiex", "Ta’ Xbiex"],
  ["mcdonald john", "McDonald John"], ["MCDONALD JOHN", "McDonald John"], ["macdonald john", "Macdonald John"],
  ["de gabriele maria", "De Gabriele Maria"], ["VAN DER BERG", "Van der Berg"], ["di giorgio", "Di Giorgio"],
  ["j.p. borg", "J.P. Borg"], ["DR. ABELA", "Dr. Abela"], ["dr abela", "Dr Abela"], ["JOHN SMITH III", "John Smith III"],
  ["ÉLODIE DUPONT", "Élodie Dupont"], ["joão silva", "João Silva"], ["maria  vella ", "Maria  Vella "], ["x", "X"], ["joe", "Joe"],
  ["ann", "Ann"], ["ANN", "Ann"], ["joseph’s", "Joseph’s"],
  // particles inside a name stay small (polish-22): Maltese tal-/tad-/taż-/ta' always, de/di/von unless typed with a capital
  ["borg maria tal-ħamrun", "Borg Maria tal-Ħamrun"], ["BORG MARIA TAL-ĦAMRUN", "Borg Maria tal-Ħamrun"], ["Abela Pietru Tal-Ħamrun", "Abela Pietru tal-Ħamrun"],
  ["grech tad-dawl", "Grech tad-Dawl"], ["zammit taż-żejt", "Zammit taż-Żejt"], ["zammit ta' xbiex", "Zammit ta' Xbiex"], ["tal-pietà", "Tal-Pietà"],
  ["joseph de gabriele", "Joseph de Gabriele"], ["Joseph De Gabriele", "Joseph De Gabriele"], ["ludwig von beethoven", "Ludwig von Beethoven"], ["maria de", "Maria De"], ["talbot john", "Talbot John"],
  // left exactly as typed
  ["de Gabriele", "De Gabriele"], ["john Agius", "John Agius"], ["D'amato", "D'Amato"], ["McDonald", "McDonald"], ["Anne-marie Vella", "Anne-Marie Vella"], ["van der Berg", "Van der Berg"],
  ["DeBono", "DeBono"], ["JD", "JD"], ["MCB", "MCB"], ["Room 3", "Room 3"], ["0123456M", "0123456M"], ["rita@example.mt", "rita@example.mt"],
  ["79123456", "79123456"], ["", ""], ["   ", "   "], ["-", "-"], [null, null], [undefined, undefined], [42, 42]
];

test("names: the casing rules on 50 examples, Maltese letters included; the UI runs the very same function", async () => {
  const bad = EXAMPLES.filter(([a, b]) => nameCase(a) !== b).map(([a, b]) => [a, nameCase(a), b]);
  eq(bad, [], "examples that differ (input, got, expected)");
  ok(EXAMPLES.length >= 30, "30+ examples");
  // idempotent
  for (const [a] of EXAMPLES) eq(nameCase(nameCase(a)), nameCase(a), "twice is once: " + a);
  eq(fnText(USRC, "eikonNameCase"), fnText(WSRC, "eikonNameCase"), "ui/eikon.people.js holds the worker's function, character for character");
});

async function seedThroughApi(api, token) {
  const r = {};
  r.order = await api("POST", "/client-orders/entries", { token, body: { order_date: today, client_name: "carmel zammit", client_phone: "79123456", items_text: "panadol extra", priority: 2, needed_by: today, pick_up_date: today, deposit: 0, notes: "call after 5" } });
  r.ticket = await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00001", open_date: today, client_name: "GRECH JOSEPH", phone: "79000000", email: "JOE@EXAMPLE.MT", category: "General Enquiry", priority: 2, status: "Open", issue: "OMRON M3 in stock?" } });
  r.mixed = await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00002", open_date: today, client_name: "de Gabriele Maria", phone: "79000001", category: "General Enquiry", priority: 2, status: "Open", issue: "x" } });
  r.dda = await api("POST", "/dda-sales/entries", { token, body: { entry_date: today, client_name: "vella anna", client_id_card: "123456m", client_address: "1 triq il-knisja", medicine_name_dose: "morphine 10mg", quantity: 1, doctor_name: "DR ABELA", doctor_reg_no: "r12", prescription_serial_no: "s1" } });
  r.cn = await api("POST", "/creditnotes/entries", { token, body: { issue_date: today, client_name: "rita", client_surname: "PACE", telephone: "79111222", amount: 5, no_expiry: 1 } });
  r.vax = await api("POST", "/vaccines/orders", { token, body: { section: "travel", country_code: "KE", country_name: "Kenya", client_first: "ĠORĠ", client_last: "hili", phone: "79333333", email: "", items: [{ name: "yellow fever", qty: 1 }] } });
  r.person = await api("POST", "/people", { token, body: { name: "spiteri noel", id_card: "777m", doctor_name: "dr galea" } });
  r.appt = await api("POST", "/appointments/entries", { token, body: { patientName: "borg mark", date: today, time: "10:00", notes: "bring results" } });
  r.loy = await api("POST", "/loyalty/clients", { token, body: { id_card: "0000888M", name: "CAMILLERI LINA" } });
  return r;
}

test("names: new saves are cased in every register; mixed case, ID cards, e-mails, items and notes are kept as typed", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const r = await seedThroughApi(api, token);
  for (const [k, v] of Object.entries(r)) ok(v.status === 200 || v.status === 201, k + " " + v.status + " " + v.text.slice(0, 200));
  const one = (sql) => DB.q(sql)[0];
  eq(one("SELECT client_name, items_text, notes FROM client_orders_entries"), { client_name: "Carmel Zammit", items_text: "panadol extra", notes: "call after 5" });
  eq(DB.q("SELECT client_name, email, issue FROM client_tickets_entries ORDER BY id"), [{ client_name: "Grech Joseph", email: "JOE@EXAMPLE.MT", issue: "OMRON M3 in stock?" }, { client_name: "De Gabriele Maria", email: "", issue: "x" }]);
  eq(one("SELECT client_name, client_id_card, client_address, medicine_name_dose, doctor_name, doctor_reg_no FROM dda_sales_entries"),
    { client_name: "Vella Anna", client_id_card: "0123456M", client_address: "1 triq il-knisja", medicine_name_dose: "morphine 10mg", doctor_name: "Dr Abela", doctor_reg_no: "r12" });
  eq(one("SELECT client_name, client_surname FROM credit_notes"), { client_name: "Rita", client_surname: "Pace" });
  eq(one("SELECT client_first, client_last, country_name FROM vaccines_orders"), { client_first: "Ġorġ", client_last: "Hili", country_name: "Kenya" });
  eq(one("SELECT vaccine_name FROM vaccines_order_items").vaccine_name, "yellow fever", "a medicine name is not a person");
  eq(one("SELECT name, doctor_name, id_card FROM people"), { name: "Spiteri Noel", doctor_name: "Dr Galea", id_card: "0000777M" });
  eq(one("SELECT patient_name, notes FROM appt_appointments"), { patient_name: "Borg Mark", notes: "bring results" });
  eq(one("SELECT name FROM loyalty_clients").name, "Camilleri Lina");
  const cnAudit = DB.q("SELECT details_json FROM audit_log WHERE action = 'CREDITNOTE_CREATE'")[0];
  ok(cnAudit && JSON.parse(cnAudit.details_json).client_surname === "Pace", "the handler's own audit entry records the cased name");
  // an update in mixed case is kept; an update in capitals is cased
  const id = one("SELECT id FROM client_orders_entries").id;
  eq((await api("PUT", "/client-orders/entries/" + id, { token, body: { client_name: "carmel Zammit", client_phone: "79123456", items_text: "panadol extra", order_date: today } })).status, 200);
  eq(one("SELECT client_name FROM client_orders_entries").client_name, "Carmel Zammit");
});

test("names: whole-state screens (POCT, screening, labels) case new or edited names and leave untouched stored ones alone", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const pat = (id, name) => ({ patientId: id, name, phone: "79" + id.slice(0, 6), age: 60, address: "triq il-kbira", createdAtIso: "2026-10-01T09:00:00.000Z", updatedAtIso: "2026-10-01T09:00:00.000Z" });
  const rec = (id, p) => ({ id, testType: "bp", testLabel: "Blood pressure", performedAtIso: "2026-10-01T09:00:00.000Z", patient: { patientId: p.patientId, name: p.name }, results: { sys: 120, dia: 80 }, notes: "ok" });
  const p1 = pat("111111M", "zammit carmel");
  let s = await api("PUT", "/poct/state", { token, body: { state: { patients: [p1], records: [rec("r1", p1)] } } });
  eq(s.status, 200, s.text);
  eq(DB.q("SELECT name, json_extract(patient_json, '$.name') AS j FROM poct_patients")[0], { name: "Zammit Carmel", j: "Zammit Carmel" });
  eq(DB.q("SELECT patient_name, json_extract(record_json, '$.patient.name') AS j, notes FROM poct_records")[0], { patient_name: "Zammit Carmel", j: "Zammit Carmel", notes: "ok" });
  // an old lower-case patient already in the database stays as it is when another patient is saved alongside it
  DB.db.prepare("UPDATE poct_patients SET name = 'zammit carmel', patient_json = json_set(patient_json, '$.name', 'zammit carmel')").run();
  const p2 = pat("222222M", "VELLA ANNA");
  s = await api("PUT", "/poct/state", { token, body: { state: { patients: [Object.assign({}, p1, { name: "zammit carmel" }), p2], records: [] } } });
  eq(s.status, 200, s.text);
  eq(DB.q("SELECT patient_id, name FROM poct_patients ORDER BY patient_id"), [{ patient_id: "111111M", name: "zammit carmel" }, { patient_id: "222222M", name: "Vella Anna" }]);

  s = await api("PUT", "/screening/state", { token, body: { state: { campaigns: [{ id: "c1", name: "BP WEEK", type: "Blood pressure", participants: [{ id: "p1", name: "borg rita", idCard: "1m" }, { id: "p2", name: "McKay Ann" }] }] } } });
  eq(s.status, 200, s.text);
  const camp = JSON.parse(DB.q("SELECT campaign_json FROM screening_campaigns")[0].campaign_json);
  eq([camp.name, camp.participants[0].name, camp.participants[1].name, camp.participants[0].idCard], ["BP WEEK", "Borg Rita", "McKay Ann", "1m"], "only participants' names; the campaign's own name is kept");

  s = await api("PUT", "/labels/state", { token, body: { state: { labelHistory: [{ id: "l1", patientName: "GALEA JOE", drugName: "AMOXIL 500MG", printedBy: "maria" }] } } });
  eq(s.status, 200, s.text);
  const lab = JSON.parse(DB.q("SELECT label_json FROM label_history")[0].label_json);
  eq([lab.patientName, lab.drugName, lab.printedBy], ["Galea Joe", "AMOXIL 500MG", "maria"]);
});

// ---- the one-off fix ----
const NAME_COLS = {
  client_orders_entries: ["client_name"], client_tickets_entries: ["client_name"], credit_notes: ["client_name", "client_surname"], vaccines_orders: ["client_first", "client_last"],
  people: ["name"], appt_appointments: ["patient_name"], loyalty_clients: ["name"], poct_patients: ["name", "patient_json"], poct_records: ["patient_name", "record_json"],
  screening_campaigns: ["campaign_json"], label_history: ["label_json"]
};
const LEGAL_COLS = { dda_sales_entries: ["client_name", "doctor_name"] };
const NEW_TABLES = ["name_case_undo", "name_case_runs"];
function dump(DB) {
  const o = {};
  for (const { name } of DB.q("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")) o[name] = DB.q("SELECT * FROM " + name + " ORDER BY rowid");
  return o;
}
// Makes the seeded rows look like data typed before this change: names back to how people typed them.
function makeOld(DB) {
  const set = (sql) => DB.db.prepare(sql).run();
  set("UPDATE client_orders_entries SET client_name = 'carmel zammit'");
  set("UPDATE client_tickets_entries SET client_name = 'GRECH JOSEPH' WHERE ticket_id = 'TKT-00001'");
  set("UPDATE dda_sales_entries SET client_name = 'vella anna', doctor_name = 'DR ABELA'");
  set("UPDATE credit_notes SET client_name = 'rita', client_surname = 'PACE'");
  set("UPDATE vaccines_orders SET client_first = 'ĠORĠ', client_last = 'hili'");
  set("UPDATE people SET name = 'spiteri noel'");
  set("UPDATE appt_appointments SET patient_name = 'borg mark'");
  set("UPDATE loyalty_clients SET name = 'CAMILLERI LINA'");
  set("UPDATE poct_patients SET name = 'zammit carmel', patient_json = json_set(patient_json, '$.name', 'zammit carmel')");
  set("UPDATE poct_records SET patient_name = 'zammit carmel', record_json = json_set(record_json, '$.patient.name', 'zammit carmel')");
  set(`UPDATE screening_campaigns SET campaign_json = json_set(campaign_json, '$.participants[0].name', 'borg rita')`);
  set(`UPDATE label_history SET label_json = json_set(label_json, '$.patientName', 'GALEA JOE')`);
}
async function seedOld(api, token, DB) {
  const r = await seedThroughApi(api, token);
  for (const [k, v] of Object.entries(r)) ok(v.status === 200 || v.status === 201, "seed " + k + " " + v.text.slice(0, 120));
  const p = { patientId: "111111M", name: "zammit carmel", phone: "79111111", age: 61, address: "Triq il-Kbira, Ħal Qormi", createdAtIso: "2026-10-01T09:00:00.000Z", updatedAtIso: "2026-10-01T09:00:00.000Z", notes: "ünïcödé \"quoted\" \\ back" };
  eq((await api("PUT", "/poct/state", { token, body: { state: { patients: [p], records: [{ id: "r1", testType: "chol", patient: { patientId: p.patientId, name: p.name, age: 61 }, results: { tc: 5.2, hdl: 1.1, ratio: 4.727272727272727 }, notes: "fasting 12h", feeDue: 7.5 }] } } })).status, 200);
  eq((await api("PUT", "/screening/state", { token, body: { state: { campaigns: [{ id: "c1", name: "bp week", participants: [{ id: "p1", name: "borg rita", idCard: "1m", poctResults: { sys: 140 } }, { id: "p2", name: "de Battista Lino" }], notes: "Ħamrun" }] } } })).status, 200);
  eq((await api("PUT", "/labels/state", { token, body: { state: { labelHistory: [{ id: "l1", patientName: "GALEA JOE", drugName: "AMOXIL 500MG", dose: "1", printedBy: "maria" }] } } })).status, 200);
  makeOld(DB);
  // a second pharmacy group with the same kind of rows
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Other Pharmacy')").run();
  DB.db.prepare("INSERT INTO client_orders_entries (org_id, location_id, order_date, client_name, items_text) VALUES (2, 50, ?, 'other person', 'x')").run(today);
  DB.db.prepare("INSERT INTO people (org_id, location_id, name) VALUES (2, 50, 'OTHER PERSON')").run();
  DB.db.prepare("INSERT INTO dda_sales_entries (org_id, location_id, entry_date, client_name, client_id_card, client_address, medicine_name_dose, quantity, doctor_name, doctor_reg_no, prescription_serial_no) VALUES (2, 50, ?, 'other dda', '1M', 'a', 'm', 1, 'dr x', 'r', 's')").run(today);
  // a JSON row not written by JSON.stringify (spaces): skipped, never rewritten
  DB.db.prepare(`INSERT INTO label_history (org_id, location_id, label_id, label_json) VALUES (1, 1, 'l2', '{ "id": "l2", "patientName": "odd spacing" }')`).run();
}
function diffTables(a, b) {
  const out = [];
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) if (JSON.stringify(a[t]) !== JSON.stringify(b[t])) out.push(t);
  return out.sort();
}
// Every changed cell in every table: [table, rowid, column, before, after]
function cellChanges(a, b, skip) {
  const out = [];
  for (const t of Object.keys(a)) {
    if (skip.includes(t)) continue;
    eq((b[t] || []).length, a[t].length, "row count of " + t);
    a[t].forEach((row, i) => { for (const c of Object.keys(row)) if (row[c] !== b[t][i][c]) out.push([t, row.id, c, row[c], b[t][i][c]]); });
  }
  return out;
}

test("names fix: dry run changes nothing; the run changes only name cells; a second run nothing; undo restores every byte; other group untouched", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  await seedOld(api, token, DB);
  const d0 = dump(DB);

  const dry = await api("POST", "/admin/names/titlecase", { token });
  eq(dry.status, 200, dry.text);
  eq(dry.json.dry_run, true);
  eq(diffTables(d0, dump(DB)), [], "a dry run writes nothing at all (no table, no audit entry)");
  const find = (g, table, col) => dry.json.groups[g].find((e) => e.table === table && e.columns[0].startsWith(col));
  eq(find("customers", "client_orders_entries", "client_name").would_change, 1);
  eq(find("customers", "client_orders_entries", "client_name").samples, [{ id: 1, from: "carmel zammit", to: "Carmel Zammit" }]);
  eq(find("customers", "client_tickets_entries", "client_name").would_change, 1, "the mixed-case ticket is not counted");
  eq(find("legal", "dda_sales_entries", "client_name").would_change, 1);
  eq(find("legal", "dda_sales_entries", "client_name").selected, false, "legal registers are listed separately and not picked by default");
  eq(find("customers", "label_history", "label_json").skipped_unusual_json, 1);
  ok(find("staff", "shift_staff", "full_name").missing, "a table this pharmacy never used is reported, not created");

  const run = await api("POST", "/admin/names/titlecase", { token, body: { dry_run: 0 } });
  eq(run.status, 200, run.text);
  eq(run.json.cells_changed, 15, "13 rows, 15 cells (two POCT rows each have a name column and its JSON twin)");
  ok(run.json.run_id && run.json.changed === 13, JSON.stringify({ changed: run.json.changed, more: run.json.more }));
  const d1 = dump(DB);
  eq(diffTables(d0, d1), ["appt_appointments", "audit_log", "client_orders_entries", "client_tickets_entries", "credit_notes", "label_history", "loyalty_clients", "name_case_runs", "name_case_undo", "people", "poct_patients", "poct_records", "screening_campaigns", "vaccines_orders"],
    "only tables that hold customers' names (plus the audit log and the two new undo tables) differ; DDA untouched by default");
  const cells = cellChanges(d0, d1, ["audit_log", ...NEW_TABLES]);
  for (const [t, id, c, before, after] of cells) {
    ok((NAME_COLS[t] || []).includes(c), "only a name column changed: " + JSON.stringify([t, id, c, before, after]));
    ok(!(t === "people" || t === "client_orders_entries") || id === 1 || d1[t].find((r) => r.id === id).org_id === 1, "never another group's row");
    if (!/_json$/.test(c)) { eq(after, nameCase(before)); continue; }
    // JSON: put the old names back into the new text and get the old bytes exactly
    const B = JSON.parse(before);
    const restore = { patient_json: () => [["$.name", B.name]], record_json: () => [["$.patient.name", B.patient.name]],
      campaign_json: () => B.participants.map((p, i) => ["$.participants[" + i + "].name", p.name]), label_json: () => [["$.patientName", B.patientName]] }[c]();
    let back = JSON.parse(after);
    for (const [p, v] of restore) { const ks = p.replace(/^\$\./, "").replace(/\[(\d+)\]/g, ".$1").split("."); let o = back; for (const k of ks.slice(0, -1)) o = o[k]; o[ks.at(-1)] = v; }
    eq(JSON.stringify(back), before, "the JSON in " + t + "." + c + " differs only in the name values");
    ok(after.length === before.length, "same length: only letters changed case");
  }
  eq(cells.length, 15, JSON.stringify(cells)); // 13 rows: 11 text cells + 2 JSON twins (poct name + json, record name + json)
  eq(d1.client_orders_entries.find((r) => r.org_id === 2).client_name, "other person", "another pharmacy group is untouched");
  eq(d1.people.find((r) => r.org_id === 2).name, "OTHER PERSON");
  eq(d1.label_history.find((r) => r.label_id === "l2").label_json, '{ "id": "l2", "patientName": "odd spacing" }');
  eq(d1.client_tickets_entries.find((r) => r.ticket_id === "TKT-00002").client_name, "De Gabriele Maria");
  const audits = DB.q("SELECT action, entity_id FROM audit_log WHERE action LIKE 'NAMES_%'");
  eq(audits, [{ action: "NAMES_TITLECASE", entity_id: run.json.run_id }], "one audit entry for the run");
  eq(DB.q("SELECT COUNT(*) AS c FROM name_case_undo")[0].c, 15, "one undo row per changed cell");

  const again = await api("POST", "/admin/names/titlecase", { token, body: { dry_run: 0 } });
  eq(again.json.changed, 0, "a second run changes nothing");
  eq(cellChanges(d1, dump(DB), ["audit_log", ...NEW_TABLES]), []);

  // someone edits one name after the run: undo leaves that one as it now is
  DB.db.prepare("UPDATE people SET name = 'Noel Spiteri Jr' WHERE org_id = 1").run();
  const undo = await api("POST", "/admin/names/titlecase/undo", { token, body: { run_id: run.json.run_id } });
  eq(undo.status, 200, undo.text);
  eq([undo.json.restored, undo.json.kept_because_changed_since], [14, 1]);
  const d2 = dump(DB);
  const left = cellChanges(d0, d2, ["audit_log", ...NEW_TABLES]);
  eq(left, [["people", 1, "name", "spiteri noel", "Noel Spiteri Jr"]], "undo restores every other byte exactly");
  const undo2 = await api("POST", "/admin/names/titlecase/undo", { token, body: { run_id: run.json.run_id } });
  eq(undo2.json.restored, 0, "undo twice is undo once");
  eq(DB.q("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'NAMES_TITLECASE_UNDO'")[0].c, 2);
  const runs = await api("GET", "/admin/names/titlecase/runs", { token });
  eq(runs.json.runs.map((r) => r.kind), ["undo", "undo", "apply", "apply"]);
});

test("names fix: legal registers only when asked for, by group or by table; staff and other admins refused; superuser can do every group", async ({ api, bootstrap, addUser, DB, env }) => {
  const { token } = await bootstrap();
  await seedOld(api, token, DB);
  const staff = await addUser({ email: "staff@example.com", role: "staff", name: "Karl Staff" });
  eq((await api("POST", "/admin/names/titlecase", { token: staff.token })).status, 403, "staff cannot even look");
  eq((await api("POST", "/admin/names/titlecase/undo", { token: staff.token, body: { run_id: "x" } })).status, 403);
  eq((await api("POST", "/admin/names/titlecase", { token, body: { all_orgs: 1 } })).status, 403, "every group needs a superuser");
  eq((await api("POST", "/admin/names/titlecase", { token, body: { groups: "nonsense" } })).status, 400);

  const only = await api("POST", "/admin/names/titlecase", { token, body: { dry_run: 0, tables: "dda_sales_entries.client_name" } });
  eq(only.status, 200, only.text);
  eq(only.json.changed, 1);
  eq(DB.q("SELECT client_name, doctor_name FROM dda_sales_entries WHERE org_id = 1")[0], { client_name: "Vella Anna", doctor_name: "DR ABELA" }, "only the column asked for");
  eq(DB.q("SELECT client_name FROM client_orders_entries WHERE org_id = 1")[0].client_name, "carmel zammit", "customers not picked when a table list is given");
  const legal = await api("POST", "/admin/names/titlecase", { token, body: { dry_run: 0, groups: "legal" } });
  eq(legal.json.changed, 1);
  eq(DB.q("SELECT doctor_name FROM dda_sales_entries WHERE org_id = 1")[0].doctor_name, "Dr Abela");
  eq(DB.q("SELECT client_name FROM dda_sales_entries WHERE org_id = 2")[0].client_name, "other dda", "another group's register untouched");

  // a superuser fixes every group in one call; small limit: carries on over several calls
  env.SUPERUSER_EMAILS = "admin@example.com";
  let total = 0, calls = 0, r;
  do { r = await api("POST", "/admin/names/titlecase", { token, body: { dry_run: 0, all_orgs: 1, limit: 4 } }); eq(r.status, 200, r.text); total += r.json.changed; calls++; } while (r.json.more && calls < 20);
  eq(total, 15, "13 rows of group 1 and 2 of group 2"); ok(calls >= 4, "the limit splits the work");
  eq(DB.q("SELECT client_name FROM client_orders_entries WHERE org_id = 2")[0].client_name, "Other Person");
  eq(DB.q("SELECT name FROM people WHERE org_id = 2")[0].name, "Other Person");
});

test("names: only deploying the new worker changes no existing row (the fix runs only when called)", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await seedOld(api, token, DB);
  const d0 = dump(DB);
  for (const p of ["/client-orders/entries", "/client-tickets/entries", "/people?q=zammit", "/poct/state", "/screening/state", "/labels/state", "/creditnotes/entries", "/auth/me"]) {
    const g = await api("GET", p, { token }); ok(g.status < 500, p + " " + g.status);
  }
  eq(cellChanges(d0, dump(DB), ["audit_log", "sessions"]), [], "reading every screen rewrites nothing");
  ok(!DB.q("SELECT name FROM sqlite_master WHERE name LIKE 'name_case%'").length, "no new table until the fix is run");
});

test("names: a booking and a waiting-list entry are cased; a service name is not", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const MON = "2027-03-01";
  const p = await api("POST", "/bookings/providers", { token, body: { name: "maria", kind: "pharmacist", hours: { 1: [["09:00", "10:00"]] } } });
  eq(p.status, 201, p.text);
  const s = await api("POST", "/bookings/services", { token, body: { name: "FLU VACCINE", durationMin: 15, priceCents: 1500, providerIds: [p.json.provider.id] } });
  eq(s.status, 201, s.text);
  const b = await api("POST", "/bookings", { token, body: { serviceId: s.json.service.id, date: MON, start: "09:00", personName: "CAMILLERI ROSE", personPhone: "79123456" } });
  eq(b.status, 201, b.text);
  eq(b.json.booking.personName, "Camilleri Rose");
  const w = await api("POST", "/bookings/waitlist", { token, body: { serviceId: s.json.service.id, personName: "zammit ġorġ", personPhone: "79000000" } });
  ok(w.status < 300, w.text);
  eq(DB.q("SELECT person_name FROM bk_waitlist")[0].person_name, "Zammit Ġorġ");
  eq(DB.q("SELECT name FROM bk_services")[0].name, "FLU VACCINE");
  eq(DB.q("SELECT name FROM bk_providers")[0].name, "maria", "providers are left as typed (not in the list)");
});

test("names: the public booking form cases the name the customer typed", async ({ api, bootstrap, DB, env }) => {
  env.BOOKINGS_KEY = "local-test-bookings-key-0123456789";
  const realFetch = globalThis.fetch; const sent = [];
  globalThis.fetch = async (u, init) => { if (/api\.resend\.com/.test(String(u))) { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); } return realFetch(u, init); };
  try {
    const { token } = await bootstrap();
    const all = {}; for (let d = 0; d <= 6; d++) all[d] = [["08:00", "20:00"]];
    const p = await api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: all } });
    const flu = (await api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, providerIds: [p.json.provider.id], online: true } })).json.service;
    await api("PUT", "/bookings/settings", { token, body: { provider: "resend", fromEmail: "b@demo.mt", apiKey: "k" } });
    const slug = (await api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } })).json.settings.publicSlug;
    const s0 = (await api("GET", `/book/${slug}/next?service_id=${flu.id}`, {})).json.slots[0];
    const hold = await api("POST", `/book/${slug}/hold`, { body: { serviceId: flu.id, providerId: s0.providerId, date: s0.date, start: s0.time, name: "ĊETTINA HILI", email: "OLGA@example.com" } });
    eq(hold.status, 200, hold.text);
    const code = /Your code: (\d{6})/.exec(sent.find((m) => /Your code/.test(m.subject)).subject)[1];
    eq((await api("POST", `/book/${slug}/confirm`, { body: { holdId: hold.json.holdId, code } })).status, 200);
    eq(DB.q("SELECT person_name, person_email FROM bk_bookings")[0], { person_name: "Ċettina Hili", person_email: "olga@example.com" });
  } finally { globalThis.fetch = realFetch; }
});
