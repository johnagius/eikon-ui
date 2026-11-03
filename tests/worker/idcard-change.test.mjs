import { test, eq, ok } from "./lib.mjs";

// POST /people/:id/change-id-card: one person's card changed on their details and on every one of their records,
// in every register, and nowhere else. The checks compare a full dump of every table before and after.
const SKIP_TABLES = new Set(["audit_log", "sessions", "eikon_schema", "people_id_card_changes", "people_id_card_change_rows", "login_attempts", "sqlite_sequence"]);
function dump(DB) {
  const out = {};
  for (const { name } of DB.q("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")) {
    if (SKIP_TABLES.has(name)) continue;
    out[name] = DB.q(`SELECT rowid AS __rid, * FROM "${name}" ORDER BY rowid`);
  }
  return out;
}
function diff(a, b) {
  const d = [];
  for (const t of new Set([...Object.keys(a), ...Object.keys(b)])) {
    const x = a[t] || [], y = b[t] || [];
    if (x.length !== y.length) { d.push(t + ": row count " + x.length + " -> " + y.length); continue; }
    for (let i = 0; i < x.length; i++) for (const c of Object.keys(x[i])) if (JSON.stringify(x[i][c]) !== JSON.stringify(y[i][c])) d.push(t + ":" + x[i].__rid + ":" + c);
  }
  return d.sort();
}
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

// Every register that holds an ID card, for one pharmacy: Laura Borg (card 111111L, typed several ways), Carmel Zammit,
// a stranger written with Laura's card (a typo: never changed), and a card-less Laura row (never changed by a change).
async function seed(app, token) {
  const { api, DB } = app;
  const must = async (m, p, body) => { const r = await api(m, p, { token, body }); eq(r.status, 200, p + " " + r.text.slice(0, 200)); return r.json; };
  let n = 0;
  const dda = (path, name, card) => must("POST", path, { entry_date: day(++n % 20), client_name: name, client_id_card: card, client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S" + n + Math.random().toString(36).slice(2, 6) });
  await dda("/dda-sales/entries", "Laura Borg", "111111L");
  await dda("/dda-sales/entries", "Borg Laura", "0111111L");
  await dda("/dda-sales/entries", "Carmel Zammit", "12345M");
  await dda("/dda-sales/entries", "Peter Vella", "0111111L"); // typed with Laura's card by mistake
  await dda("/dda-poyc/entries", "LAURA  BORG", "111111 l");
  await dda("/dda-poyc/entries", "Carmel Zammit", "0012345M");
  const rx = (name, card) => must("POST", "/repeat-prescriptions/entries", { entry_date: day(3), expires_date: day(-150), client_name: name, client_id: card, medicine_name_dose: "Ramipril 5mg", posology: "1 od", prescriber_name: "Dr Borg", prescriber_reg_no: "2" });
  await rx("Laura Borg", "111111L"); await rx("Carmel Zammit", "12345M");
  const dr = (name, card) => must("POST", "/daily-register/entries", { entry_date: day(2), client_name: name, client_id: card, medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Abela", prescriber_reg_no: "4321" });
  await dr("Laura Borg", "0111111L"); await dr("Carmel Zammit", "0012345M");
  await must("PUT", "/poct/state", { records: [
    { id: "r1", testType: "bp", performedAtIso: day(4) + "T09:00:00Z", patient: { patientId: "0111111L", name: "Laura Borg" }, results: { sys: 120, dia: 80 } },
    { id: "r2", testType: "bp", performedAtIso: day(4) + "T10:00:00Z", patient: { patientId: "0012345M", name: "Carmel Zammit" }, results: { sys: 130, dia: 85 } }],
    patients: [{ patientId: "0111111L", name: "Laura Borg", phone: "79000001" }, { patientId: "0012345M", name: "Carmel Zammit" }] });
  await must("POST", "/loyalty/clients", { id_card: "111111L", name: "Laura Borg" });
  await must("POST", "/loyalty/clients", { id_card: "12345M", name: "Carmel Zammit" });
  await must("PUT", "/screening/state", { state: { campaigns: [{ id: "c1", name: "BP week", participants: [
    { id: "p1", idCard: "0111111L", name: "Laura Borg", date: day(5) }, { id: "p2", idCard: "0012345M", name: "Carmel Zammit", date: day(5) }, { id: "p3", idCard: "0111111L", name: "Peter Vella", date: day(5) }] }] } });
  await must("PUT", "/pharmacovigilance/state", { state: { reports: [{ id: "pv1", pt_id: "0111111L", pt_initials: "L.B.", reaction_description: "Rash" }, { id: "pv2", pt_id: "0012345M", pt_initials: "C.Z." }] } });
  // contacts_clients written directly: the contacts module marks its schema done once per isolate (a module-level flag),
  // so calling it here would leave a later test's fresh database without its tables
  DB.db.exec("CREATE TABLE IF NOT EXISTS contacts_clients (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL DEFAULT 0, name TEXT NOT NULL DEFAULT '', id_card TEXT NOT NULL DEFAULT '', address TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', alt_phone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')), created_by INTEGER, updated_by INTEGER)");
  // Tables without a simple save route here: created by their own module, rows written as those modules write them.
  await api("GET", "/appointments/entries", { token }); await api("GET", "/pharmacy-calc/patients", { token }); await api("GET", "/bookings/setup", { token });
  const me = (await api("GET", "/auth/me", { token })).json.user;
  const o = me.org_id, l = me.location_id;
  DB.db.prepare("INSERT INTO appt_appointments (org_id, location_id, patient_name, patient_id_card, date, time) VALUES (?,?,?,?,?,?)").run(o, l, "Laura Borg", "0111111L", day(-3), "09:00");
  DB.db.prepare("INSERT INTO appt_waitlist (org_id, location_id, patient_name, patient_id_card) VALUES (?,?,?,?)").run(o, l, "Laura Borg", "111111L");
  DB.db.prepare("INSERT INTO pharmacy_calc_patients (org_id, location_id, patient_name, id_card) VALUES (?,?,?,?)").run(o, l, "Laura Borg", "0111111L");
  DB.db.prepare("INSERT INTO pharmacy_calc_records (org_id, location_id, patient_name, id_card, calc_type) VALUES (?,?,?,?,?)").run(o, l, "Laura Borg", "0111111L", "warfarin");
  DB.db.prepare("INSERT INTO bk_bookings (org_id, location_id, service_id, provider_id, person_name, person_id_card, date, start_time, end_time) VALUES (?,?,?,?,?,?,?,?,?)").run(o, l, 1, 1, "Laura Borg", "0111111L", day(-2), "10:00", "10:15");
  DB.db.prepare("INSERT INTO loyalty_transactions (org_id, location_id, client_id_card, client_name, campaign_id, txn_date) VALUES (?,?,?,?,?,?)").run(o, l, "0111111L", "Laura Borg", "k1", day(6));
  // an older card-less entry (the server now refuses one; older rows have them)
  DB.db.prepare("INSERT INTO repeat_prescription_entries (org_id, location_id, entry_date, expires_date, client_name, client_id, medicine_name_dose, posology, prescriber_name, prescriber_reg_no) VALUES (?,?,?,?,?,?,?,?,?,?)").run(o, l, day(400), day(220), "Laura Borg", "", "Ramipril 5mg", "1 od", "Dr Borg", "2");
  DB.db.prepare("INSERT INTO contacts_clients (org_id, location_id, name, id_card, address) VALUES (?,?,?,?,?)").run(o, l, "Laura Borg", "0111111L", "Mosta");
  DB.db.prepare("INSERT INTO contacts_clients (org_id, location_id, name, id_card) VALUES (?,?,?,?)").run(o, l, "Carmel Zammit", "0012345M");
  const laura = await must("POST", "/people", { name: "Laura Borg", id_card: "111111L", phone: "79000001" });
  const carmel = await must("POST", "/people", { name: "Carmel Zammit", id_card: "12345M" });
  return { laura: laura.person, carmel: carmel.person, me };
}

// What a change from 0111111L to 0222222L must touch for one pharmacy: exactly these cells.
function expectedCells(DB, org, loc) {
  const ids = (t, where, ...b) => DB.q(`SELECT rowid AS r FROM ${t} WHERE org_id = ? AND location_id = ? AND ${where}`, org, loc, ...b).map((x) => x.r);
  const cells = [];
  const add = (t, cols, where, ...b) => ids(t, where, ...b).forEach((r) => cols.forEach((c) => cells.push(t + ":" + r + ":" + c)));
  add("dda_sales_entries", ["client_id_card"], "client_name IN ('Laura Borg', 'Borg Laura')");
  add("dda_poyc_entries", ["client_id_card"], "LOWER(REPLACE(client_name, '  ', ' ')) = 'laura borg'"); // typed "LAURA  BORG" (the worker may title-case it on save)
  add("repeat_prescription_entries", ["client_id"], "client_name = 'Laura Borg' AND client_id <> ''");
  add("daily_register_entries", ["client_id"], "client_name = 'Laura Borg'");
  add("poct_patients", ["patient_id", "patient_json"], "name = 'Laura Borg'");
  add("poct_records", ["patient_id", "record_json"], "patient_name = 'Laura Borg'");
  add("loyalty_clients", ["id_card"], "name = 'Laura Borg'");
  add("loyalty_transactions", ["client_id_card"], "client_name = 'Laura Borg'");
  add("screening_campaigns", ["campaign_json"], "1 = 1");
  add("pv_reports", ["report_json"], "report_id = 'pv1'");
  add("contacts_clients", ["id_card"], "name = 'Laura Borg'");
  add("appt_appointments", ["patient_id_card"], "patient_name = 'Laura Borg'");
  add("appt_waitlist", ["patient_id_card"], "patient_name = 'Laura Borg'");
  add("pharmacy_calc_patients", ["id_card"], "patient_name = 'Laura Borg'");
  add("pharmacy_calc_records", ["id_card"], "patient_name = 'Laura Borg'");
  add("bk_bookings", ["person_id_card"], "person_name = 'Laura Borg'");
  add("people", ["id_card", "version"], "name = 'Laura Borg'");
  return cells.sort();
}

async function world(app) {
  const s = await app.bootstrap();
  // the same group (org 1), another pharmacy (location 2); and another org (2, location 50)
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Sister Pharmacy')").run();
  app.DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Other Pharmacy')").run();
  const sister = await app.addUser({ orgId: 1, locationId: 2, email: "sister@example.com", name: "Sara Sister" });
  const other = await app.addUser({ orgId: 2, locationId: 50, email: "other@example.com", name: "Olga Other" });
  const mine = await seed(app, s.token);
  const sis = await seed(app, sister.token);
  const oth = await seed(app, other.token);
  return { s, sister, other, mine, sis, oth };
}

test("id card change: changes exactly the person's rows in every register of this pharmacy, nothing else (full dump), and undo restores it exactly", async (app) => {
  const { api, DB } = app;
  const { s, mine } = await world(app);
  const token = s.token, pid = mine.laura.id;
  eq(mine.laura.id_card, "0111111L");
  const before = dump(DB);

  const pv = await api("POST", `/people/${pid}/change-id-card`, { token, body: { from: "0111111L", to: "222222l" } });
  eq(pv.status, 200, pv.text);
  ok(pv.json.preview && pv.json.can_apply, "preview");
  eq(dump(DB), before, "a preview writes nothing");
  const byLabel = Object.fromEntries(pv.json.registers.map((r) => [r.label, r.count]));
  eq(byLabel["DDA sales"], 2); eq(byLabel["POYC"], 1); eq(byLabel["Repeat prescriptions"], 1); eq(byLabel["Daily register"], 1);
  eq(byLabel["Screening"], 1); eq(byLabel["Pharmacovigilance"], 1); eq(byLabel["Tests"], 1); eq(byLabel["Tests (patient list)"], 1);
  ok(pv.json.registers.slice(0, 4).every((r) => r.legal), "legal registers listed first: " + JSON.stringify(pv.json.registers));
  eq(pv.json.skipped.map((x) => x.name).sort(), ["Peter Vella", "Peter Vella"], "the stranger with Laura's card is not changed");

  // apply with a stale plan: refused, nothing written
  const stale = await api("POST", `/people/${pid}/change-id-card`, { token, body: { from: "0111111L", to: "222222L", confirm: true, plan: "nope" } });
  eq(stale.status, 409); eq(stale.json.code, "plan_changed"); eq(dump(DB), before);

  const r = await api("POST", `/people/${pid}/change-id-card`, { token, body: { from: "0111111L", to: "222222L", confirm: true, plan: pv.json.plan } });
  eq(r.status, 200, r.text);
  eq(r.json.person.id_card, "0222222L");
  const after = dump(DB);
  const me = mine.me;
  const noStamp = (l) => l.filter((c) => !/^people:\d+:(updated_at|updated_by)$/.test(c));
  eq(noStamp(diff(before, after)), expectedCells(DB, me.org_id, me.location_id), "only Laura's card cells changed, in this pharmacy");
  eq(r.json.changed, pv.json.total);
  // JSON registers: only the card key changed, the rest of the JSON identical
  const scr = JSON.parse(DB.q("SELECT campaign_json FROM screening_campaigns WHERE org_id = ? AND location_id = ?", me.org_id, me.location_id)[0].campaign_json);
  eq(scr.participants.map((p) => p.idCard), ["0222222L", "0012345M", "0111111L"]);
  const scrBefore = JSON.parse(before.screening_campaigns.find((x) => x.org_id === me.org_id && x.location_id === me.location_id).campaign_json);
  scrBefore.participants[0].idCard = "0222222L"; eq(scr, scrBefore);
  const pvr = JSON.parse(DB.q("SELECT report_json FROM pv_reports WHERE org_id = ? AND location_id = ? AND report_id = 'pv1'", me.org_id, me.location_id)[0].report_json);
  eq(pvr.pt_id, "0222222L"); eq(pvr.reaction_description, "Rash");
  const rec = JSON.parse(DB.q("SELECT record_json FROM poct_records WHERE org_id = ? AND location_id = ? AND record_id = 'r1'", me.org_id, me.location_id)[0].record_json);
  eq(rec.patient.patientId, "0222222L"); eq(rec.results.sys, 120);
  // the GET routes show it
  const story = await api("GET", `/people/${pid}`, { token });
  ok(story.json.activity.length >= 8, "her story still finds her records by the new card");
  // undo log: one row per changed cell, insert-only header, one audit entry
  const logRows = DB.q("SELECT * FROM people_id_card_change_rows WHERE change_id = ?", r.json.change_id);
  ok(logRows.length >= r.json.changed + 1, "every row logged: " + logRows.length);
  ok(logRows.every((l) => l.org_id === me.org_id && l.location_id === me.location_id && l.created_by === me.user_id && l.created_at), "log rows carry who and when");
  const aud = DB.q("SELECT * FROM audit_log WHERE action = 'PERSON_ID_CARD_CHANGE'");
  eq(aud.length, 1); eq(aud[0].location_id, me.location_id);
  const ad = JSON.parse(aud[0].details_json); eq(ad.before.id_card, "0111111L"); eq(ad.after.id_card, "0222222L"); eq(ad.change_id, r.json.change_id);

  // a second identical call changes nothing (the person no longer has the old card)
  const again = await api("POST", `/people/${pid}/change-id-card`, { token, body: { from: "0111111L", to: "222222L", confirm: true, plan: pv.json.plan } });
  eq(again.status, 409); eq(dump(DB), after, "second call wrote nothing");

  const list = await api("GET", `/people/${pid}/id-card-changes`, { token });
  eq(list.json.changes.length, 1); eq(list.json.changes[0].undone_by, null);
  const u = await api("POST", `/people/id-card-changes/${r.json.change_id}/undo`, { token, body: {} });
  eq(u.status, 200, u.text);
  eq(u.json.skipped, []);
  const undone = dump(DB);
  const d2 = noStamp(diff(before, undone));
  eq(d2, DB.q("SELECT rowid AS r FROM people WHERE id = ?", pid).map((x) => "people:" + x.r + ":version"), "undo restores every register cell exactly (only the person's version/updated_at move on)");
  const u2 = await api("POST", `/people/id-card-changes/${r.json.change_id}/undo`, { token, body: {} });
  eq(u2.status, 409, "undo twice refused");
  eq(diff(undone, dump(DB)), []);
  eq(DB.q("SELECT COUNT(*) AS c FROM people_id_card_changes")[0].c, 2, "header rows: change + undo, nothing updated");
});

test("id card change: refuses a card that belongs to someone else (person or a record under another name); other pharmacies of the group and other orgs untouched", async (app) => {
  const { api, DB } = app;
  const { s, sister, mine, sis } = await world(app);
  const before = dump(DB);
  const toCarmel = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "0111111L", to: "12345M" } });
  eq(toCarmel.status, 409); eq(toCarmel.json.code, "card_in_use"); eq(toCarmel.json.owner.name, "Carmel Zammit");
  ok(/12345M already belongs to Carmel Zammit/.test(toCarmel.json.error), toCarmel.json.error);
  // a card only seen on a record under another name (no person yet)
  await api("POST", "/dda-sales/entries", { token: s.token, body: { entry_date: day(1), client_name: "Rita Pace", client_id_card: "777G", client_address: "x", medicine_name_dose: "M", quantity: 1, doctor_name: "Dr A", doctor_reg_no: "1", prescription_serial_no: "Z9" } });
  const mid = dump(DB);
  const toRita = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "0111111L", to: "777G", confirm: true, plan: "x" } });
  eq(toRita.status, 409); eq(toRita.json.owner.name, "Rita Pace");
  eq(dump(DB), mid, "refusals write nothing");
  // another pharmacy's person id is not found from here (scoped to the caller's pharmacy)
  const cross = await api("POST", `/people/${sis.laura.id}/change-id-card`, { token: s.token, body: { from: "0111111L", to: "222222L" } });
  eq(cross.status, 404);
  // the change here leaves the sister pharmacy (same group) and the other org exactly as they were
  const pv = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "0111111L", to: "222222L" } });
  const r = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "0111111L", to: "222222L", confirm: true, plan: pv.json.plan } });
  eq(r.status, 200, r.text);
  const changed = diff(mid, dump(DB));
  const rows = (t) => Object.fromEntries(DB.q(`SELECT rowid AS r, org_id, location_id FROM "${t}"`).map((x) => [String(x.r), x]));
  const cache = {};
  for (const c of changed) {
    const [t, rid] = c.split(":");
    const row = (cache[t] = cache[t] || rows(t))[rid];
    ok(row && row.org_id === 1 && row.location_id === mine.me.location_id, "changed a row outside this pharmacy: " + c + " " + JSON.stringify(row));
  }
  eq(DB.q("SELECT id_card FROM people WHERE id = ?", sis.laura.id)[0].id_card, "0111111L", "sister pharmacy's Laura keeps her card");
  eq(DB.q("SELECT COUNT(*) AS c FROM dda_sales_entries WHERE location_id <> ? AND client_id_card = '0222222L'", mine.me.location_id)[0].c, 0);
  // the sister pharmacy can change its own Laura independently
  const spv = await api("POST", `/people/${sis.laura.id}/change-id-card`, { token: sister.token, body: { from: "0111111L", to: "333333L" } });
  eq(spv.status, 200, spv.text); eq(spv.json.registers.find((x) => x.label === "DDA sales").count, 2);
  ok(before && true);
});

test("id card change: staff may preview but not apply or undo; stamping adds the card only to the card-less rows ticked", async (app) => {
  const { api, DB, addUser } = app;
  const { s, mine } = await world(app);
  const staff = await addUser({ orgId: 1, locationId: mine.me.location_id, email: "staff@example.com", role: "staff", name: "Karl Staff" });
  const user = await addUser({ orgId: 1, locationId: mine.me.location_id, email: "u@example.com", role: "user", name: "U" });
  const before = dump(DB);
  const pv = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: staff.token, body: { from: "0111111L", to: "222222L" } });
  eq(pv.status, 200); eq(pv.json.can_apply, false);
  const no = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: staff.token, body: { from: "0111111L", to: "222222L", confirm: true, plan: pv.json.plan } });
  eq(no.status, 403); eq(dump(DB), before, "staff wrote nothing");
  eq((await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: user.token, body: { from: "0111111L", to: "222222L" } })).status, 403);

  // stamp: Laura's card-less repeat prescription is offered; only the ticked one gets the card
  const st = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "", to: "0111111L" } });
  eq(st.status, 200, st.text); eq(st.json.mode, "stamp");
  eq(st.json.candidates.map((c) => c.table + ":" + c.name), ["repeat_prescription_entries:Laura Borg"]);
  const c0 = st.json.candidates[0];
  const pv2 = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "", to: "0111111L", rows: [{ table: c0.table, id: c0.id }] } });
  const ap = await api("POST", `/people/${mine.laura.id}/change-id-card`, { token: s.token, body: { from: "", to: "0111111L", rows: [{ table: c0.table, id: c0.id }], confirm: true, plan: pv2.json.plan } });
  eq(ap.status, 200, ap.text); eq(ap.json.changed, 1);
  const rid = DB.q("SELECT rowid AS r FROM repeat_prescription_entries WHERE id = ?", c0.id)[0].r;
  eq(diff(before, dump(DB)), ["repeat_prescription_entries:" + rid + ":client_id"]);
  const und = await api("POST", `/people/id-card-changes/${ap.json.change_id}/undo`, { token: staff.token, body: {} });
  eq(und.status, 403);
  const und2 = await api("POST", `/people/id-card-changes/${ap.json.change_id}/undo`, { token: s.token, body: {} });
  eq(und2.status, 200, und2.text); eq(diff(before, dump(DB)), []);
});

test("id card change: names compare without case, accents or word order; one shared word is not enough", async () => {
  // the worker's function, read from its source like the UI suite does
  const fs = await import("node:fs"); const path = await import("node:path"); const { fileURLToPath } = await import("node:url");
  const src = fs.readFileSync(path.join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "cloudflare-worker", "code"), "utf8");
  const fn = (n) => { const i = src.indexOf("function " + n + "("); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; } return src.slice(i, j + 1); };
  const W = new Function(fn("personNameWords") + fn("personNamesCompatible") + "return personNamesCompatible;")();
  ok(W("Zammit Carmel", "carmel  ZAMMIT")); ok(W("Laura Borg", "Laura Maria Borg")); ok(W("Joséph Vella", "joseph vella")); ok(W("Borg, Laura", "laura borg"));
  ok(!W("Borg", "Laura Borg")); ok(!W("Laura Borg", "Carmel Zammit")); ok(!W("", "Laura Borg")); ok(!W("Laura Borg", "Laura Vella"));
});
