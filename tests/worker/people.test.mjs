import { test, eq, ok } from "./lib.mjs";

const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());

async function seedHistory(api, token) {
  // The same person typed four different ways across four registers, plus two strangers.
  eq((await api("POST", "/client-orders/entries", { token, body: { order_date: "2026-09-01", client_name: "Carmen Grech", client_phone: "7912 3456", client_address: "12 Triq il-Kbira, Mosta", items_text: "Augmentin 625 x14", priority: 2, needed_by: "2026-09-02", pick_up_date: "2026-09-02", deposit: 0 } })).status, 200);
  eq((await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00001", open_date: "2026-09-10", client_name: "carmen grech", phone: "79123456", category: "General Enquiry", priority: 2, status: "Open", issue: "Omron M3 in stock?" } })).status, 200);
  const dda = await api("POST", "/dda-sales/entries", { token, body: { entry_date: "2026-10-05", client_name: "Carmen Grech", client_id_card: "123456m", client_address: "12 Triq il-Kbira, Mosta", medicine_name_dose: "Morphine 10mg", quantity: 10, doctor_name: "Dr Abela", doctor_reg_no: "1234", prescription_serial_no: "S-1" } });
  eq(dda.status, 200, dda.text);
  eq((await api("POST", "/loyalty/clients", { token, body: { id_card: "0123456M", name: "C. Grech" } })).status, 200);
  const rx = await api("POST", "/repeat-prescriptions/entries", { token, body: { entry_date: "2026-10-20", expires_date: "2027-04-20", client_name: "Joseph Vella", client_id: "654321M", medicine_name_dose: "Ramipril 5mg", posology: "1 od", prescriber_name: "Dr Borg", prescriber_reg_no: "2" } });
  eq(rx.status, 200, rx.text);
  eq((await api("POST", "/client-orders/entries", { token, body: { order_date: "2026-10-28", client_name: "Maria Camilleri", client_phone: "99887766", items_text: "Vitamin D", priority: 2, needed_by: today, pick_up_date: today, deposit: 0 } })).status, 200);
}

test("people: search finds a customer across every register before any person exists", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  await seedHistory(api, token);

  const byName = await api("GET", "/people?q=grech", { token });
  eq(byName.status, 200, byName.text);
  eq(byName.json.people.length, 0, "no curated people yet");
  // One ID card ties the DDA sale and the loyalty card together; the two name-only rows share a name.
  const cards = byName.json.history.filter((h) => h.id_card === "0123456M");
  eq(cards.length, 1, JSON.stringify(byName.json.history));
  ok(cards[0].sources.dda_sale === 1 && cards[0].sources.loyalty === 1, "sources merged: " + JSON.stringify(cards[0].sources));
  eq(cards[0].address, "12 Triq il-Kbira, Mosta");
  const nameOnly = byName.json.history.find((h) => !h.id_card);
  ok(nameOnly && nameOnly.sources.order === 1 && nameOnly.sources.question === 1, "order and question grouped by name");
  eq(nameOnly.phone, "7912 3456");

  const byCard = await api("GET", "/people?q=123456m", { token });
  eq(byCard.json.history.length, 1, "unpadded ID card matches the padded one");
  const byPhone = await api("GET", "/people?q=7912 3456", { token });
  ok(byPhone.json.history.some((h) => h.name === "Carmen Grech"), "digits match a phone number");
  const miss = await api("GET", "/people?q=zzzz", { token });
  eq(miss.json.history.length + miss.json.people.length, 0);
  const tooShort = await api("GET", "/people?q=g", { token });
  eq(tooShort.json.history.length, 0, "a single letter lists recent people, not history");
});

test("people: create, upsert by ID card, optimistic update, 409 on stale version and duplicate card", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const c = await api("POST", "/people", { token, body: { name: "  Carmen   Grech ", id_card: "123456 m", phone: "79123456", email: "Carmen@Example.com" } });
  eq(c.status, 200, c.text);
  eq(c.json.created, true);
  const p = c.json.person;
  eq(p.name, "Carmen Grech"); eq(p.id_card, "0123456M"); eq(p.email, "carmen@example.com"); eq(p.version, 1);

  // Same card again from another register: no duplicate, blanks filled, nothing overwritten
  const again = await api("POST", "/people", { token, body: { name: "C Grech", id_card: "0123456M", phone: "00000000", address: "12 Triq il-Kbira" } });
  eq(again.status, 200, again.text);
  eq(again.json.created, false); eq(again.json.person.id, p.id);
  eq(again.json.person.phone, "79123456", "existing phone kept"); eq(again.json.person.address, "12 Triq il-Kbira", "blank address filled");
  eq(DB.q("SELECT COUNT(*) AS c FROM people")[0].c, 1);

  // Two screens read version 2; the first save wins, the second gets the current row back
  const v = again.json.person.version;
  const u1 = await api("POST", "/people", { token, body: { id: p.id, version: v, notes: "Prefers SMS" } });
  eq(u1.status, 200, u1.text); eq(u1.json.person.version, v + 1); eq(u1.json.person.notes, "Prefers SMS");
  const u2 = await api("POST", "/people", { token, body: { id: p.id, version: v, notes: "Call after 5" } });
  eq(u2.status, 409, u2.text); eq(u2.json.current.notes, "Prefers SMS");

  // Validation
  eq((await api("POST", "/people", { token, body: { name: "X" } })).status, 400);
  eq((await api("POST", "/people", { token, body: { name: "Bad Mail", email: "nope" } })).status, 400);
  eq((await api("POST", "/people", { token, body: { name: "Bad DOB", date_of_birth: "31/12/1980" } })).status, 400);

  // A second person cannot take the first one's card
  const other = await api("POST", "/people", { token, body: { name: "Joseph Vella", id_card: "654321M" } });
  eq(other.status, 200);
  const clash = await api("POST", "/people", { token, body: { id: other.json.person.id, version: 1, id_card: "123456M" } });
  eq(clash.status, 409, clash.text); eq(clash.json.existing.id, p.id);

  // Audit has before and after
  const audits = DB.q("SELECT action, details_json AS details FROM audit_log WHERE entity_type='people' ORDER BY id");
  ok(audits.some((a) => a.action === "PERSON_CREATE"), "create audited");
  const upd = audits.find((a) => a.action === "PERSON_UPDATE" && String(a.details).includes("Prefers SMS"));
  ok(upd && String(upd.details).includes('"before"') && String(upd.details).includes('"after"'), "update audited with before/after");
});

test("people: a person's timeline gathers every register under their card or name", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  await seedHistory(api, token);
  const c = await api("POST", "/people", { token, body: { name: "Carmen Grech", id_card: "123456M" } });
  eq(c.status, 200, c.text);
  const id = c.json.person.id;

  const r = await api("GET", "/people/" + id, { token });
  eq(r.status, 200, r.text);
  eq(r.json.person.id, id);
  const kinds = r.json.activity.map((a) => a.kind).sort();
  eq(JSON.stringify(kinds), JSON.stringify(["dda_sale", "loyalty", "order", "question"]), JSON.stringify(r.json.activity));
  const dates = r.json.activity.map((a) => a.date);
  eq(JSON.stringify(dates), JSON.stringify(dates.slice().sort().reverse()), "newest first");
  const sale = r.json.activity.find((a) => a.kind === "dda_sale");
  eq(sale.title, "Morphine 10mg"); eq(sale.doctor, "Dr Abela"); eq(sale.date, "2026-10-05");
  ok(!r.json.activity.some((a) => a.title === "Vitamin D"), "another customer's order is not here");

  // Once the person exists, the search lists them once and hides their history rows
  const s = await api("GET", "/people?q=grech", { token });
  eq(s.json.people.length, 1); eq(s.json.people[0].id, id);
  eq(s.json.history.length, 0, "history rows that belong to a known person are hidden: " + JSON.stringify(s.json.history));
  eq((await api("GET", "/people/999999", { token })).status, 404);
});

test("people: backfill builds the book from history once, idempotently, without touching history", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  await seedHistory(api, token);
  const before = DB.q("SELECT (SELECT COUNT(*) FROM client_orders_entries) AS o, (SELECT COUNT(*) FROM dda_sales_entries) AS d, (SELECT COUNT(*) FROM loyalty_clients) AS l")[0];

  const r1 = await api("POST", "/people/backfill", { token });
  eq(r1.status, 200, r1.text);
  eq(r1.json.created, 3, JSON.stringify(r1.json)); // Carmen (card), Joseph (card), Maria (name only)
  eq(r1.json.remaining, 0);
  const rows = DB.q("SELECT name, id_card, phone, address, source FROM people ORDER BY name");
  const carmen = rows.find((p) => p.id_card === "0123456M");
  ok(carmen, "Carmen keyed on her card");
  eq(carmen.address, "12 Triq il-Kbira, Mosta");
  ok(!rows.some((p) => p.name.toLowerCase() === "carmen grech" && !p.id_card), "name-only rows folded into the carded person");
  ok(carmen.source.startsWith("history:"), carmen.source);

  const r2 = await api("POST", "/people/backfill", { token });
  eq(r2.json.created, 0, "second run adds nothing");
  eq(DB.q("SELECT COUNT(*) AS c FROM people")[0].c, 3);
  const after = DB.q("SELECT (SELECT COUNT(*) FROM client_orders_entries) AS o, (SELECT COUNT(*) FROM dda_sales_entries) AS d, (SELECT COUNT(*) FROM loyalty_clients) AS l")[0];
  eq(JSON.stringify(after), JSON.stringify(before), "history untouched");

  // Staff cannot run it
  const staff = await addUser({ email: "staff@example.com", role: "user" });
  eq((await api("POST", "/people/backfill", { token: staff.token })).status, 403);
  // Another pharmacy sees nothing of this one
  DB.db.prepare("INSERT INTO locations (org_id, name) VALUES (1, 'Second Pharmacy')").run();
  const otherLoc = await addUser({ email: "other@example.com", locationId: 2 });
  const s = await api("GET", "/people?q=grech", { token: otherLoc.token });
  eq(s.json.people.length + s.json.history.length, 0, "location isolation");
});

test("people: merging a duplicate keeps one survivor, fills its blanks and keeps the timeline", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  await seedHistory(api, token);
  const a = await api("POST", "/people", { token, body: { name: "Carmen Grech", phone: "79123456" } });
  const b = await api("POST", "/people", { token, body: { name: "C. Grech", id_card: "123456M", address: "12 Triq il-Kbira, Mosta" } });
  const m = await api("POST", "/people/" + b.json.person.id + "/merge", { token, body: { into_id: a.json.person.id } });
  eq(m.status, 200, m.text);
  eq(m.json.person.id_card, "0123456M", "survivor takes the card"); eq(m.json.person.phone, "79123456"); eq(m.json.person.address, "12 Triq il-Kbira, Mosta");
  const dup = DB.q("SELECT merged_into, id_card FROM people WHERE id = ?", b.json.person.id)[0];
  eq(dup.merged_into, a.json.person.id); eq(dup.id_card, "");
  // Reading the duplicate returns the survivor; the timeline still sees the loyalty row by card and the order by name
  const g = await api("GET", "/people/" + b.json.person.id, { token });
  eq(g.json.person.id, a.json.person.id);
  const kinds = g.json.activity.map((x) => x.kind).sort();
  eq(JSON.stringify(kinds), JSON.stringify(["dda_sale", "loyalty", "order", "question"]));
  eq((await api("POST", "/people", { token, body: { id: b.json.person.id, version: 2, notes: "x" } })).status, 409, "merged record refuses edits");
  const s = await api("GET", "/people?q=grech", { token });
  eq(s.json.people.length, 1, "merged duplicate no longer listed");
  eq((await api("POST", "/people/" + a.json.person.id + "/merge", { token, body: { into_id: a.json.person.id } })).status, 400);
});
