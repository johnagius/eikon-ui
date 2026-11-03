import { test, eq, ok } from "./lib.mjs";

// The controlled-drug registers never change older lines as a side effect. A lookup, a new line or an edit of one
// line leaves every other line exactly as it was written, whatever spelling of the ID card it has; every reader
// still finds the patient under any spelling; and the one way to change a card on all of a person's lines is the
// explicit, audited, undoable POST /people/:id/change-id-card.
const today = new Date().toISOString().slice(0, 10);
const month = today.slice(0, 7);
const snap = (DB, t) => JSON.stringify(DB.q(`SELECT * FROM ${t} ORDER BY id`));

async function seed(app) {
  const s = await app.bootstrap();
  const { api, DB } = app;
  const token = s.token;
  // create the tables the way the screens do
  eq((await api("GET", `/dda-sales/entries?month=${month}`, { token })).status, 200);
  eq((await api("GET", `/dda-poyc/entries?month=${month}`, { token })).status, 200);
  const me = (await api("GET", "/auth/me", { token })).json.user;
  // older lines, written before cards were tidied: one patient, three spellings; and someone else
  const ins = (t, name, card, serial) => DB.db.prepare(`INSERT INTO ${t} (org_id, location_id, entry_date, client_name, client_id_card, client_address, medicine_name_dose, quantity, doctor_name, doctor_reg_no, prescription_serial_no, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?, '2026-01-02 09:00:00', '2026-01-02 09:00:00')`)
    .run(me.org_id, me.location_id, today, name, card, "1 Triq il-Knisja", "Morphine 10mg", 1, "Dr Abela", "R1", serial);
  ins("dda_sales_entries", "Carmel Zammit", "123M", "S-1");
  ins("dda_sales_entries", "Carmel Zammit", "0000123M", "S-2");
  ins("dda_sales_entries", "Carmel Zammit", "123 m", "S-3");
  ins("dda_sales_entries", "Peter Vella", "456K", "S-4");
  ins("dda_poyc_entries", "Carmel Zammit", "123M", "P-1");
  ins("dda_poyc_entries", "Carmel Zammit", "123 m", "P-2");
  return { token, me };
}

const line = (card, serial) => ({ entry_date: today, client_name: "Carmel Zammit", client_id_card: card, client_address: "1 Triq il-Knisja", medicine_name_dose: "Oxycodone 5mg", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: serial });

test("dda history: lookup, a new line, an edit and check-serial leave older lines byte-identical; every reader finds the patient under any spelling", async (app) => {
  const { api, DB } = app;
  const { token } = await seed(app);
  const sales0 = snap(DB, "dda_sales_entries"), poyc0 = snap(DB, "dda_poyc_entries");

  // the lookup, under every spelling
  for (const card of ["123M", "0000123M", "123 m", "00123M"]) {
    const r = await api("GET", "/dda-sales/client?client_id_card=" + encodeURIComponent(card), { token });
    eq(r.status, 200, r.text);
    ok(r.json.found, "lookup finds " + card);
    eq(r.json.client_name, "Carmel Zammit");
  }
  eq(snap(DB, "dda_sales_entries"), sales0, "a lookup changes no line");

  // a new line with a fourth spelling: saved tidy, nothing else touched
  const c = await api("POST", "/dda-sales/entries", { token, body: line("00123M", "S-5") });
  eq(c.status, 200, c.text);
  const added = DB.q("SELECT client_id_card FROM dda_sales_entries WHERE id = ?", c.json.entry_id)[0];
  eq(added.client_id_card, "0000123M", "the new line is saved with the tidy spelling");
  eq(JSON.stringify(DB.q("SELECT * FROM dda_sales_entries WHERE id <> ? ORDER BY id", c.json.entry_id)), sales0, "a new line changes no older line");
  const sales1 = snap(DB, "dda_sales_entries");

  // an edit of that one line: only that line changes
  const u = await api("PUT", "/dda-sales/entries/" + c.json.entry_id, { token, body: Object.assign(line("123 m", "S-5"), { quantity: 3 }) });
  eq(u.status, 200, u.text);
  eq(JSON.stringify(DB.q("SELECT * FROM dda_sales_entries WHERE id <> ? ORDER BY id", c.json.entry_id)), sales0, "editing one line changes no other line");
  eq(DB.q("SELECT quantity FROM dda_sales_entries WHERE id = ?", c.json.entry_id)[0].quantity, 3);
  ok(snap(DB, "dda_sales_entries") !== sales1, "the edited line itself did change");

  // POYC: a new line with another spelling leaves older POYC lines alone
  const pc = await api("POST", "/dda-poyc/entries", { token, body: line("0000123M", "P-3") });
  eq(pc.status, 200, pc.text);
  eq(JSON.stringify(DB.q("SELECT * FROM dda_poyc_entries WHERE id <> ? ORDER BY id", pc.json.entry_id)), poyc0, "a new POYC line changes no older line");

  // check-serial reads only
  const salesNow = snap(DB, "dda_sales_entries");
  const cs = await api("GET", "/dda-sales/check-serial?serial=S-1", { token });
  eq(cs.status, 200, cs.text); ok(cs.json.found, "check-serial finds the older line");
  eq(cs.json.entries[0].client_id_card, "123M", "and shows the card as it was written");
  eq((await api("GET", "/dda-poyc/check-serial?serial=P-2", { token })).json.entries[0].client_id_card, "123 m");
  eq(snap(DB, "dda_sales_entries"), salesNow, "check-serial changes nothing");

  // every reader finds the patient's lines under any spelling
  for (const q of ["0000123M", "123M", "123 m"]) {
    const list = await api("GET", `/dda-sales/entries?month=${month}&q=` + encodeURIComponent(q), { token });
    eq(list.json.entries.filter((e) => e.client_name === "Carmel Zammit").length, 4, "DDA sales month search " + q);
    eq(list.json.entries.filter((e) => e.client_name === "Peter Vella").length, 0);
    const pl = await api("GET", `/dda-poyc/entries?month=${month}&q=` + encodeURIComponent(q), { token });
    eq(pl.json.entries.length, 3, "POYC month search " + q + " " + pl.text.slice(0, 200));
    const cl = await api("GET", "/dda-sales/clients?q=" + encodeURIComponent(q), { token });
    eq(cl.json.clients.map((x) => x.client_name + "|" + x.client_id_card), ["Carmel Zammit|0000123M"], "one suggestion per person, " + q);
    const pp = await api("GET", "/people?q=" + encodeURIComponent(q), { token });
    const h = (pp.json.history || []).filter((x) => x.name === "Carmel Zammit");
    eq(h.length, 1, "people search finds her once in history, " + q + " " + pp.text.slice(0, 300));
    eq((h[0].sources.dda_sale || 0) + (h[0].sources.poyc || 0), 7, "with every DDA and POYC line, " + q);
  }
  const agg = await api("GET", "/contacts/clients/aggregated", { token });
  eq(agg.json.rows.filter((x) => x.name === "Carmel Zammit").length, 1, "client contacts list her once");

  // the person's story finds every line
  const person = (await api("POST", "/people", { token, body: { name: "Carmel Zammit", id_card: "123m" } })).json.person;
  const story = await api("GET", "/people/" + person.id + "?limit=200", { token });
  eq(story.json.activity.filter((a) => a.kind === "dda_sale").length, 4);
  eq(story.json.activity.filter((a) => a.kind === "poyc").length, 3);

  eq(DB.q("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'DDA_SALES_ID_CARD_REWRITE'")[0].n, 0, "no silent rewrite was made");
  eq(snap(DB, "dda_sales_entries"), salesNow, "reading changes nothing");
});

test("dda history: the only way a card changes on older DDA lines is the explicit change, and undo puts every spelling back as written", async (app) => {
  const { api, DB } = app;
  const { token } = await seed(app);
  const person = (await api("POST", "/people", { token, body: { name: "Carmel Zammit", id_card: "123M" } })).json.person;
  const sales0 = snap(DB, "dda_sales_entries"), poyc0 = snap(DB, "dda_poyc_entries");

  const pv = await api("POST", `/people/${person.id}/change-id-card`, { token, body: { from: "0000123M", to: "999999M" } });
  eq(pv.status, 200, pv.text);
  eq(snap(DB, "dda_sales_entries"), sales0, "a preview writes nothing");
  const ap = await api("POST", `/people/${person.id}/change-id-card`, { token, body: { from: "0000123M", to: "999999M", confirm: true, plan: pv.json.plan } });
  eq(ap.status, 200, ap.text);
  eq(DB.q("SELECT client_id_card AS c FROM dda_sales_entries WHERE client_name = 'Carmel Zammit' ORDER BY id").map((r) => r.c), ["0999999M", "0999999M", "0999999M"]);
  eq(DB.q("SELECT client_id_card AS c FROM dda_sales_entries WHERE client_name = 'Peter Vella'")[0].c, "456K", "someone else's line untouched");
  eq(DB.q("SELECT client_id_card AS c FROM dda_poyc_entries ORDER BY id").map((r) => r.c), ["0999999M", "0999999M"]);
  ok(DB.q("SELECT COUNT(*) AS n FROM audit_log WHERE action = 'PERSON_ID_CARD_CHANGE'")[0].n === 1, "the change is audited");

  const un = await api("POST", "/people/id-card-changes/" + encodeURIComponent(ap.json.change_id) + "/undo", { token, body: {} });
  eq(un.status, 200, un.text);
  const strip = (j) => JSON.stringify(JSON.parse(j).map((r) => Object.assign({}, r, { updated_at: undefined })));
  eq(DB.q("SELECT client_id_card AS c FROM dda_sales_entries ORDER BY id").map((r) => r.c), ["123M", "0000123M", "123 m", "456K"], "undo puts back each spelling as written");
  eq(strip(snap(DB, "dda_sales_entries")), strip(sales0));
  eq(strip(snap(DB, "dda_poyc_entries")), strip(poyc0));
});
