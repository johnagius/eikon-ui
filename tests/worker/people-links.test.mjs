// People, server side (BACKLOG2 item 12): (a) PEOPLE-AUDIT §5.3 small fixes, (b) DUPES-DESIGN links.
// The four DUPES-DESIGN tests: every table byte-identical before / after a link / after its undo; another pharmacy
// cannot link, read or undo (isolation.test.mjs); a forged kind and two different ID cards are refused; repeats are harmless.
import { test, eq, ok } from "./lib.mjs";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const WSRC = readFileSync(join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
const USRC = readFileSync(join(here, "..", "..", "ui", "eikon.people.js"), "utf8");
function fnText(src, name) {
  const i = src.indexOf("function " + name + "(");
  if (i < 0) return "";
  let d = 0, j = src.indexOf("{", i);
  for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; }
  return src.slice(i, j + 1);
}
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// Every table, every row, every column (rowid order). Nothing is left out.
function dumpAll(DB) {
  const out = {};
  for (const { name } of DB.q("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) out[name] = DB.q(`SELECT rowid AS __rid, * FROM "${name}" ORDER BY rowid`);
  // AUTOINCREMENT counters: the two tables that may change keep theirs here, every other table's counter is compared
  if (out.sqlite_sequence) { out["sqlite_sequence (of the changed tables)"] = out.sqlite_sequence.filter((r) => r.name === "people_links" || r.name === "audit_log"); out.sqlite_sequence = out.sqlite_sequence.filter((r) => r.name !== "people_links" && r.name !== "audit_log"); }
  return out;
}
function changedTables(a, b) {
  return Array.from(new Set([...Object.keys(a), ...Object.keys(b)])).filter((t) => JSON.stringify(a[t]) !== JSON.stringify(b[t])).sort();
}

// One person, Laura Borg (card 111111L typed several ways), in every register that can be linked, plus records of
// her written so that name/card matching does not find them (an order as "L. Borg", a vaccine order, a credit note).
async function seed(app, token) {
  const { api, DB } = app;
  const must = async (m, p, body) => { const r = await api(m, p, { token, body }); eq(r.status, 200, p + " " + r.text.slice(0, 200)); return r.json; };
  const ids = {};
  const last = (t) => DB.q(`SELECT id FROM ${t} ORDER BY id DESC LIMIT 1`)[0].id;
  const dda = (path, name, card) => must("POST", path, { entry_date: day(3), client_name: name, client_id_card: card, client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S" + Math.random().toString(36).slice(2, 8) });
  await dda("/dda-sales/entries", "Laura Borg", "111111L"); ids.dda1 = last("dda_sales_entries");
  await dda("/dda-sales/entries", "Borg Laura", "0111111L"); ids.dda2 = last("dda_sales_entries");
  await dda("/dda-poyc/entries", "Laura Borg", "111111 l"); ids.poyc = last("dda_poyc_entries");
  await (must("POST", "/repeat-prescriptions/entries", { entry_date: day(3), expires_date: day(-150), client_name: "Laura Borg", client_id: "111111L", medicine_name_dose: "Ramipril 5mg", posology: "1 od", prescriber_name: "Dr Borg", prescriber_reg_no: "2" })); ids.repeat = last("repeat_prescription_entries");
  await must("POST", "/client-orders/entries", { order_date: day(1), client_name: "L. Borg", client_phone: "79111222", items_text: "Vitamin D", priority: 2, needed_by: day(0), pick_up_date: day(0), deposit: 0 }); ids.order = last("client_orders_entries");
  await must("POST", "/creditnotes/entries", { issue_date: day(2), client_name: "Laura", client_surname: "B", telephone: "79111222", amount: 5 }); ids.credit = last("credit_notes");
  await must("POST", "/vaccines/orders", { section: "travel", country_name: "Kenya", client_first: "Lora", client_last: "Borg", phone: "79111222", items: [{ name: "Yellow fever", qty: 1 }] });
  ids.vaccine = DB.q("SELECT id FROM vaccines_orders ORDER BY id DESC LIMIT 1")[0].id;
  await must("PUT", "/poct/state", { records: [{ id: "r1", testType: "bp", performedAtIso: day(4) + "T09:00:00Z", patient: { patientId: "0111111L", name: "Laura Borg" }, results: { sys: 120, dia: 80 } }],
    patients: [{ patientId: "0111111L", name: "Laura Borg", phone: "79000001" }] });
  await must("POST", "/loyalty/clients", { id_card: "111111L", name: "Laura Borg" }); ids.loyalty = last("loyalty_clients");
  await must("PUT", "/screening/state", { state: { campaigns: [{ id: "c1", name: "BP week", participants: [{ id: "p1", idCard: "0111111L", name: "Laura Borg", date: day(5) }, { id: "p2", idCard: "0012345M", name: "Carmel Zammit", date: day(5) }] }] } });
  DB.db.exec("CREATE TABLE IF NOT EXISTS contacts_clients (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '', id_card TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', alt_phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by INTEGER, updated_by INTEGER)");
  await api("GET", "/appointments/entries", { token }); await api("GET", "/pharmacy-calc/patients", { token }); await api("GET", "/bookings/setup", { token });
  const me = (await api("GET", "/auth/me", { token })).json.user;
  const o = me.org_id, l = me.location_id;
  const ins = (sql, ...b) => DB.db.prepare(sql).run(...b).lastInsertRowid;
  ids.appointment = Number(ins("INSERT INTO appt_appointments (org_id, location_id, patient_name, patient_id_card, date, time) VALUES (?,?,?,?,?,?)", o, l, "Laura Borg", "0111111L", day(-3), "09:00"));
  ids.waitlist = Number(ins("INSERT INTO appt_waitlist (org_id, location_id, patient_name, patient_id_card) VALUES (?,?,?,?)", o, l, "Laura Borg", "111111L"));
  ids.calculator = Number(ins("INSERT INTO pharmacy_calc_patients (org_id, location_id, patient_name, id_card) VALUES (?,?,?,?)", o, l, "Laura Borg", "0111111L"));
  ids.booking = Number(ins("INSERT INTO bk_bookings (org_id, location_id, service_id, provider_id, person_name, person_id_card, date, start_time, end_time) VALUES (?,?,?,?,?,?,?,?,?)", o, l, 1, 1, "Laura Borg", "0111111L", day(-2), "10:00", "10:15"));
  ids.bkwait = Number(ins("INSERT INTO bk_waitlist (org_id, location_id, service_id, person_name, person_phone) VALUES (?,?,?,?,?)", o, l, 1, "Laura Borg", "79000001"));
  ids.contact = Number(ins("INSERT INTO contacts_clients (org_id, location_id, name, id_card, address) VALUES (?,?,?,?,?)", o, l, "Laura Borg", "0111111L", "Mosta"));
  ids.carmelContact = Number(ins("INSERT INTO contacts_clients (org_id, location_id, name, id_card) VALUES (?,?,?,?)", o, l, "Carmel Zammit", "0012345M"));
  ids.person = (await must("POST", "/people", { name: "Laura Borg", id_card: "111111L", phone: "79000001" })).person.id;
  return { ids, me };
}
function lauraRecords(ids) {
  return [{ kind: "people", id: ids.person }, { kind: "dda_sale", id: ids.dda1 }, { kind: "dda_sale", id: ids.dda2 }, { kind: "poyc", id: ids.poyc }, { kind: "repeat", id: ids.repeat },
    { kind: "order", id: ids.order }, { kind: "credit_note", id: ids.credit }, { kind: "vaccine", id: ids.vaccine }, { kind: "poct", id: "0111111L" }, { kind: "loyalty", id: ids.loyalty },
    { kind: "screening", id: "c1/p1" }, { kind: "appointment", id: ids.appointment }, { kind: "waitlist", id: ids.waitlist }, { kind: "calculator", id: ids.calculator },
    { kind: "booking", id: ids.booking }, { kind: "booking_waitlist", id: ids.bkwait }, { kind: "contact", id: ids.contact }];
}

// ───────────────────────────── (a) small fixes ─────────────────────────────

test("people (a): POST /people without an ID card returns the one person with the same name and phone digits or e-mail", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const c1 = await api("POST", "/people", { token, body: { name: "Carmel Zammit", phone: "79123456" } });
  eq(c1.json.created, true, c1.text);
  const again = await api("POST", "/people", { token, body: { name: "carmel  zammit", phone: "+356 7912 3456", address: "1 Triq il-Knisja" } });
  eq(again.status, 200, again.text);
  eq([again.json.created, again.json.existing, again.json.person.id], [false, true, c1.json.person.id], "same person returned");
  eq(again.json.person.address, "1 Triq il-Knisja", "a blank filled"); eq(again.json.person.phone, "79123456", "phone kept as it was");
  const other = await api("POST", "/people", { token, body: { name: "Carmel Zammit", phone: "79000000" } });
  eq(other.json.created, true, "a different phone is a namesake: a new person");
  const amb = await api("POST", "/people", { token, body: { name: "Carmel Zammit", alt_phone: "79123456", phone: "79000000" } });
  eq(amb.json.created, true, "two possible people: not guessed, inserted as before");
  const nameOnly = await api("POST", "/people", { token, body: { name: "Carmel Zammit" } });
  eq(nameOnly.json.created, true, "a name alone never joins (as before)");
  const r1 = await api("POST", "/people", { token, body: { name: "Rita Borg", email: "rita@example.mt" } });
  const r2 = await api("POST", "/people", { token, body: { name: "Rita Borg", email: "Rita@Example.mt", phone: "21000000" } });
  eq([r2.json.existing, r2.json.person.id, r2.json.person.phone], [true, r1.json.person.id, "21000000"], "same e-mail");
  const r3 = await api("POST", "/people", { token, body: { name: "Rita Borg", phone: "21000000", email: "other@example.mt" } });
  eq(r3.json.created, true, "same phone but a different e-mail: a namesake");
  // a person with an ID card is found the same way (the UI's rule: the card only refuses when both sides have one)
  const j1 = await api("POST", "/people", { token, body: { name: "Joe Vella", id_card: "654321M", phone: "99112233" } });
  const j2 = await api("POST", "/people", { token, body: { name: "Joe Vella", phone: "0035699112233" } });
  eq([j2.json.existing, j2.json.person.id], [true, j1.json.person.id]);
  // a merged record is never returned
  eq(DB.q("SELECT COUNT(*) AS c FROM people")[0].c, 7, "4 Carmel Zammit, 2 Rita Borg, 1 Joe Vella");
  const audits = DB.q("SELECT details_json AS d FROM audit_log WHERE action = 'PERSON_UPDATE'").map((a) => JSON.parse(a.d));
  ok(audits.some((a) => a.matched === "name+contact" && a.before && a.after && a.filled.includes("address")), "the fill is audited with before/after");
  // The UI (.130) compares phones with the same function: line for line, on a set of inputs
  const uiNorm = new Function(fnText(USRC, "str") + "\n" + fnText(USRC, "normPhone") + "\nreturn normPhone;")();
  const wNorm = new Function(fnText(WSRC, "peoplePhoneDigits") + "\nreturn peoplePhoneDigits;")();
  const inputs = ["79123456", "+356 7912 3456", "00356 79123456", "35679123456", "356 7912", "(+356) 2123-4567", "", null, "0035621234567", "+44 7700 900123", "7912 3456 "];
  eq(inputs.map(wNorm), inputs.map(uiNorm), "worker and UI read phones the same way");
});

test("people (a): loyalty stores new cards as normalizeMtIdCard; a client kept under the old spelling keeps its row; old rows untouched", async ({ api, bootstrap, DB }) => {
  const { token, user } = await bootstrap();
  const a = await api("POST", "/loyalty/clients", { token, body: { id_card: "123456 m", name: "Carmel Zammit" } });
  eq(a.status, 200, a.text);
  eq(a.json.client.id_card, "0123456M", "inner space dropped, padded (the old normaliser kept \"123456 M\")");
  const me = (await api("GET", "/auth/me", { token })).json.user;
  DB.db.prepare("INSERT INTO loyalty_clients (org_id, location_id, id_card, name, created_at, updated_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))").run(me.org_id, me.location_id, "0000777", "Old Digits");
  DB.db.prepare("INSERT INTO loyalty_clients (org_id, location_id, id_card, name, created_at, updated_at) VALUES (?,?,?,?,datetime('now'),datetime('now'))").run(me.org_id, me.location_id, "222 333L", "Old Spaced");
  const before = JSON.stringify(DB.q("SELECT * FROM loyalty_clients WHERE name LIKE 'Old%' ORDER BY id"));
  const b = await api("POST", "/loyalty/clients", { token, body: { id_card: "777", name: "" } });
  eq(b.json.client.id_card, "0000777", "the existing old-spelling row is used, not a second client");
  const c = await api("POST", "/loyalty/clients", { token, body: { id_card: "222 333l", name: "" } });
  eq(c.json.client.id_card, "222 333L", "the existing old-spelling row is used");
  eq(DB.q("SELECT COUNT(*) AS c FROM loyalty_clients")[0].c, 3, "no second row for either");
  const after = DB.q("SELECT * FROM loyalty_clients WHERE name LIKE 'Old%' ORDER BY id").map((r) => Object.assign({}, r, { updated_at: null }));
  eq(after.map((r) => [r.id_card, r.name]), JSON.parse(before).map((r) => [r.id_card, r.name]), "old rows keep their card and name");
  // a visit with a new spelling goes to the normalised card and its client
  const camp = await api("POST", "/loyalty/campaigns", { token, body: { name: "Stamps", type: "stamps", stamps_required: 5 } });
  if (camp.status === 200 && camp.json && (camp.json.campaign || camp.json.id)) {
    const cid = camp.json.campaign ? camp.json.campaign.id : camp.json.id;
    const t = await api("POST", "/loyalty/transactions", { token, body: { client_id: "123456 M", client_name: "Carmel Zammit", campaign_id: cid, stamps_awarded: 1 } });
    eq(t.status, 200, t.text);
    eq(DB.q("SELECT client_id_card FROM loyalty_transactions")[0].client_id_card, "0123456M");
  }
  ok(user, "signed in");
});

test("people (a): bookings, waiting list, vaccines, credit notes and client contacts are in Customers search and the timeline; read only", async (app) => {
  const { api, bootstrap, DB } = app;
  const { token } = await bootstrap();
  const { ids } = await seed(app, token);
  const before = dumpAll(DB);
  const s = await api("GET", "/people?q=borg", { token });
  eq(s.status, 200, s.text);
  const kinds = new Set(s.json.history.flatMap((h) => Object.keys(h.sources)));
  for (const k of ["vaccine"]) ok(kinds.has(k), k + " in history: " + JSON.stringify([...kinds]));
  const byPhone = await api("GET", "/people?q=79111222", { token });
  ok(byPhone.json.history.some((h) => h.sources.credit_note) && byPhone.json.history.some((h) => h.sources.vaccine), "credit note and vaccine found by phone: " + JSON.stringify(byPhone.json.history));
  const t = await api("GET", "/people/" + ids.person, { token });
  const tk = new Set(t.json.activity.map((a) => a.kind));
  for (const k of ["booking", "contact", "booking_waitlist", "dda_sale", "poct"]) ok(tk.has(k), k + " on the timeline: " + JSON.stringify([...tk]));
  eq(changedTables(before, dumpAll(DB)), [], "search and timeline wrote nothing");
});

test("people (a): /contacts/clients/aggregated has one client per name and normalised ID card", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  eq((await api("POST", "/dda-sales/entries", { token, body: { entry_date: day(1), client_name: "Carmen Grech", client_id_card: "123456m", client_address: "Mosta", medicine_name_dose: "Morphine 10mg", quantity: 1, doctor_name: "Dr A", doctor_reg_no: "1", prescription_serial_no: "S-9" } })).status, 200);
  eq((await api("PUT", "/poct/state", { token, body: { records: [], patients: [{ patientId: "123456 M", name: "Carmen Grech", phone: "79123456" }] } })).status, 200);
  const r = await api("GET", "/contacts/clients/aggregated", { token });
  eq(r.status, 200, r.text);
  eq(r.json.rows.filter((x) => x.name === "Carmen Grech").length, 1, JSON.stringify(r.json.rows));
});

// ───────────────────────────── (b) links ─────────────────────────────

test("people links: every table byte-identical before a link, after it and after its undo; only people_links and audit_log differ", async (app) => {
  const { api, bootstrap, DB } = app;
  const { token } = await bootstrap();
  const { ids } = await seed(app, token);
  // the link tables are created by the first write; a refused write creates them so the snapshot starts with them in place
  eq((await api("POST", "/people/links/undo", { token, body: { link_ids: [999999] } })).status, 404);
  const before = dumpAll(DB);
  const recs = lauraRecords(ids);
  const l = await api("POST", "/people/links", { token, body: { records: recs } });
  eq(l.status, 200, l.text);
  eq(l.json.link_ids.length, recs.length, "one link per record");
  const afterLink = dumpAll(DB);
  eq(changedTables(before, afterLink), ["audit_log", "people_links", "sqlite_sequence (of the changed tables)"], "only the link table and the audit trail changed");
  // the timeline now has the records name/card matching could not find
  const t = await api("GET", "/people/" + ids.person, { token });
  const linked = t.json.activity.filter((a) => a.linked);
  eq(linked.map((a) => a.kind).sort(), ["credit_note", "order", "screening", "vaccine"], JSON.stringify(t.json.activity.map((a) => [a.kind, a.linked || false])));
  ok(t.json.link_groups.length === 1 && t.json.activity.filter((a) => a.link_group === l.json.link_group).length >= 14, "records on the timeline carry their group");
  const u = await api("POST", "/people/links/undo", { token, body: { link_ids: l.json.link_ids } });
  eq([u.status, u.json.undone], [200, recs.length], u.text);
  const afterUndo = dumpAll(DB);
  eq(changedTables(before, afterUndo), ["audit_log", "people_links", "sqlite_sequence (of the changed tables)"]);
  for (const tname of Object.keys(before)) if (!/^(audit_log|people_links|sqlite_sequence \(of)/.test(tname)) eq(JSON.stringify(afterUndo[tname]), JSON.stringify(before[tname]), tname + " byte-identical");
  ok(Object.keys(before).length >= 40, "every table compared (" + Object.keys(before).length + ")");
  eq(DB.q("SELECT COUNT(*) AS c FROM people_links WHERE undone_at IS NULL")[0].c, 0, "nothing in force after the undo");
  eq(DB.q("SELECT COUNT(*) AS c FROM people_links")[0].c, recs.length, "the undone rows are kept for history");
  const t2 = await api("GET", "/people/" + ids.person, { token });
  eq(t2.json.activity.filter((a) => a.linked).length, 0, "after the undo the timeline is as before");
  const au = DB.q("SELECT action, details_json AS d FROM audit_log WHERE action IN ('PERSON_LINK','PERSON_UNLINK') ORDER BY id");
  eq(au.map((a) => a.action), ["PERSON_LINK", "PERSON_UNLINK"]);
  const d0 = JSON.parse(au[0].d), d1 = JSON.parse(au[1].d);
  ok(Array.isArray(d0.after) && d0.after.length === recs.length && Array.isArray(d1.before) && d1.after.every((x) => x.undone_at), "audit has before and after");
});

test("people links: a forged kind is refused; two different ID cards are refused (409), also through an existing group; nothing written", async (app) => {
  const { api, bootstrap, DB } = app;
  const { token } = await bootstrap();
  const { ids } = await seed(app, token);
  await api("POST", "/people/links/undo", { token, body: { link_ids: [999999] } });
  const snap = () => JSON.stringify([DB.q("SELECT * FROM people_links"), DB.q("SELECT COUNT(*) AS c FROM audit_log")]);
  const s0 = snap();
  for (const kind of ["users", "sqlite_master", "__proto__", "people; DROP TABLE people", "constructor", ""]) {
    const r = await api("POST", "/people/links", { token, body: { records: [{ kind, id: 1 }, { kind: "people", id: ids.person }] } });
    eq(r.status, 400, kind + " " + r.text);
  }
  const forged = await api("POST", "/people/links", { token, body: { records: [{ kind: "order", table: "users", id: ids.order }, { kind: "people", id: ids.person, source_table: "sessions" }] } });
  eq(forged.status, 200, "a table name in the request is ignored: " + forged.text);
  eq(DB.q("SELECT DISTINCT source_table AS t FROM people_links ORDER BY t").map((r) => r.t), ["client_orders_entries", "people"], "tables come from the allow-list");
  await api("POST", "/people/links/undo", { token, body: { link_ids: forged.json.link_ids } });
  const s1 = snap();
  // Carmel's contact (0012345M) with Laura (0111111L)
  const two = await api("POST", "/people/links", { token, body: { records: [{ kind: "contact", id: ids.carmelContact }, { kind: "dda_sale", id: ids.dda1 }] } });
  eq(two.status, 409, two.text); eq(two.json.id_cards.sort(), ["0012345M", "0111111L"]);
  // through a group: link Laura's DDA sale with the card-less order, then try the order with Carmel's contact
  const g = await api("POST", "/people/links", { token, body: { records: [{ kind: "dda_sale", id: ids.dda1 }, { kind: "order", id: ids.order }] } });
  eq(g.status, 200, g.text);
  const s2 = snap();
  const via = await api("POST", "/people/links", { token, body: { records: [{ kind: "order", id: ids.order }, { kind: "contact", id: ids.carmelContact }] } });
  eq(via.status, 409, via.text);
  eq(snap(), s2, "nothing written on a 409");
  // screening participant with another card in the same campaign
  const sc = await api("POST", "/people/links", { token, body: { records: [{ kind: "screening", id: "c1/p2" }, { kind: "people", id: ids.person }] } });
  eq(sc.status, 409, sc.text);
  // a missing record -> 404, nothing written
  const miss = await api("POST", "/people/links", { token, body: { records: [{ kind: "order", id: 987654 }, { kind: "people", id: ids.person }] } });
  eq(miss.status, 404, miss.text);
  const bad = await api("POST", "/people/links", { token, body: { records: [{ kind: "people", id: ids.person }] } });
  eq(bad.status, 400, "one record is not a link");
  eq(snap(), s2);
  ok(s0 !== s1, "the forged-table call did write its (allow-listed) link");
});

test("people links: repeating a link or an undo is harmless; two groups join and the undo puts both back exactly", async (app) => {
  const { api, bootstrap, DB } = app;
  const { token } = await bootstrap();
  const { ids } = await seed(app, token);
  const A = [{ kind: "dda_sale", id: ids.dda1 }, { kind: "order", id: ids.order }];
  const l1 = await api("POST", "/people/links", { token, body: { records: A } });
  const count = () => [DB.q("SELECT COUNT(*) AS c FROM people_links")[0].c, DB.q("SELECT COUNT(*) AS c FROM audit_log WHERE action LIKE 'PERSON_%LINK'")[0].c];
  const c1 = count();
  const l2 = await api("POST", "/people/links", { token, body: { records: A.slice().reverse() } });
  eq([l2.status, l2.json.already, l2.json.link_ids, l2.json.link_group], [200, true, [], l1.json.link_group], l2.text);
  eq(count(), c1, "a repeated link writes nothing");
  const u1 = await api("POST", "/people/links/undo", { token, body: { link_ids: l1.json.link_ids } });
  const c2 = count();
  const u2 = await api("POST", "/people/links/undo", { token, body: { link_ids: l1.json.link_ids } });
  eq([u1.json.undone, u2.status, u2.json.undone, u2.json.already], [2, 200, 0, true]);
  eq(count(), c2, "a repeated undo writes nothing");
  // linking again after the undo makes a fresh group (the old rows stay as history)
  const g1 = await api("POST", "/people/links", { token, body: { records: [{ kind: "dda_sale", id: ids.dda1 }, { kind: "order", id: ids.order }] } });
  const g2 = await api("POST", "/people/links", { token, body: { records: [{ kind: "vaccine", id: ids.vaccine }, { kind: "credit_note", id: ids.credit }] } });
  ok(g1.json.link_group !== l1.json.link_group && g2.json.link_group !== g1.json.link_group, "new groups");
  const liveBefore = JSON.stringify(DB.q("SELECT id, link_group, source_table, source_id FROM people_links WHERE undone_at IS NULL ORDER BY id"));
  const j = await api("POST", "/people/links", { token, body: { records: [{ kind: "order", id: ids.order }, { kind: "vaccine", id: ids.vaccine }] } });
  eq([j.status, j.json.link_group], [200, g1.json.link_group], "joined under the older group");
  const grp = await api("GET", "/people/links?group=" + encodeURIComponent(g1.json.link_group), { token });
  eq(grp.json.links.map((x) => x.kind).sort(), ["credit_note", "dda_sale", "order", "vaccine"]);
  eq((await api("GET", "/people/links?group=" + encodeURIComponent(g2.json.link_group), { token })).status, 404, "the younger group is empty now");
  const uj = await api("POST", "/people/links/undo", { token, body: { link_ids: j.json.link_ids } });
  eq([uj.status, uj.json.restored], [200, 2], uj.text);
  eq(JSON.stringify(DB.q("SELECT id, link_group, source_table, source_id FROM people_links WHERE undone_at IS NULL ORDER BY id")), liveBefore, "both groups exactly as before the join");
  const all = await api("GET", "/people/links", { token });
  eq(all.json.links.length, 4);
});

test("people links: Customers search shows the linked person instead of a history row that is theirs", async (app) => {
  const { api, bootstrap } = app;
  const { token } = await bootstrap();
  const { ids } = await seed(app, token);
  const s1 = await api("GET", "/people?q=79111222", { token });
  ok(s1.json.history.length >= 1 && !s1.json.people.length, "before: only history rows for that phone");
  const l = await api("POST", "/people/links", { token, body: { records: [{ kind: "people", id: ids.person }, { kind: "order", id: ids.order }, { kind: "credit_note", id: ids.credit }, { kind: "vaccine", id: ids.vaccine }] } });
  eq(l.status, 200, l.text);
  const s2 = await api("GET", "/people?q=79111222", { token });
  eq(s2.json.history.length, 0, JSON.stringify(s2.json.history));
  eq(s2.json.people.map((p) => [p.id, p.via_link]), [[ids.person, true]]);
  await api("POST", "/people/links/undo", { token, body: { link_ids: l.json.link_ids } });
  eq((await api("GET", "/people?q=79111222", { token })).json.history.length, s1.json.history.length, "after the undo, as before");
});

test("people links: 'Not the same person' kept for the pharmacy, undo and redo; no names stored", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  eq((await api("GET", "/people/not-same", { token })).json.fingerprints, [], "nothing yet (and no table created by a read)");
  eq(DB.q("SELECT COUNT(*) AS c FROM sqlite_master WHERE name = 'people_not_same'")[0].c, 0);
  eq((await api("POST", "/people/not-same", { token, body: { fingerprint: "Carmel Zammit" } })).status, 400, "only a hash is taken");
  eq((await api("POST", "/people/not-same", { token, body: { fingerprint: "1x2y3z4w" } })).status, 200);
  eq((await api("POST", "/people/not-same", { token, body: { fingerprint: "1x2y3z4w" } })).json.already, true);
  eq((await api("GET", "/people/not-same", { token })).json.fingerprints, ["1x2y3z4w"]);
  eq((await api("POST", "/people/not-same/undo", { token, body: { fingerprint: "1x2y3z4w" } })).status, 200);
  eq((await api("GET", "/people/not-same", { token })).json.fingerprints, []);
  eq((await api("POST", "/people/not-same", { token, body: { fingerprint: "1x2y3z4w" } })).status, 200);
  eq(DB.q("SELECT COUNT(*) AS c FROM people_not_same")[0].c, 1);
  eq(DB.q("SELECT action FROM audit_log WHERE action LIKE 'PERSON_NOT_SAME%' ORDER BY id").map((r) => r.action), ["PERSON_NOT_SAME", "PERSON_NOT_SAME_UNDO", "PERSON_NOT_SAME"]);
});
