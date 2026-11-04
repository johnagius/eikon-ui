// Customers (d-cust): what a person needs now (GET /people/:id/now), how they like to be told (POST /people/:id/profile),
// and telling them (POST /messages; the e-mail's stop link /m/<token>/stop). Additive: new tables only; every existing
// table is byte-for-byte the same after these routes run, apart from the rows the existing routes themselves write.
import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";
import { maltaYmd } from "../clock.mjs";

const KEY = { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };
const T = () => maltaYmd(0), D = (n) => maltaYmd(n);

function fakeResend(status = () => 200) {
  const calls = []; const orig = globalThis.fetch; let n = 0;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (!/api\.resend\.com|api\.brevo\.com/.test(url)) return orig(u, init);
    n++; const st = status(n); calls.push({ url, st, body: JSON.parse(init.body) });
    return new Response(st >= 400 ? "error " + st : JSON.stringify({ id: "x" }), { status: st });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}
async function person(app, token, body) { const r = await app.api("POST", "/people", { token, body }); ok(r.json && r.json.ok, r.text); return r.json.person; }
const snapshot = (app, skip) => {
  const tabs = app.DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name).filter((n) => !skip.includes(n));
  const o = {}; for (const t of tabs) o[t] = JSON.stringify(app.DB.db.prepare("SELECT * FROM " + t).all()); return o;
};

test("customers now: an open order, a ready one, a question, a delivery, a repeat line and a booking are the person's; a namesake's are not; names in the other order count", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap();
  const p = await person(app, token, { name: "Zammit Carmel", id_card: "12345M", phone: "79123456", email: "carmel@example.com" });
  await person(app, token, { name: "Zammit Paul", phone: "79000001" });
  const o1 = await app.api("POST", "/client-orders/entries", { token, body: { order_date: T(), client_name: "Zammit Carmel", client_phone: "79123456", items: "Augmentin 625", items_text: "Augmentin 625", needed_by: D(2), priority: 2 } });
  const o2 = await app.api("POST", "/client-orders/entries", { token, body: { order_date: T(), client_name: "Carmel Zammit", client_phone: "79123456", items_text: "Panadol", needed_by: T(), priority: 2 } });
  const o3 = await app.api("POST", "/client-orders/entries", { token, body: { order_date: T(), client_name: "Zammit Paul", client_phone: "79000001", items_text: "Not hers", needed_by: T(), priority: 2 } });
  ok(o1.json.ok && o2.json.ok && o3.json.ok, o1.text + o2.text);
  const oid2 = o2.json.entry_id || o2.json.id || (o2.json.entry && o2.json.entry.id);
  eq((await app.api("PUT", "/client-orders/entries/" + oid2, { token, body: { fulfilled: true } })).status, 200);
  const q = await app.api("POST", "/client-tickets/entries", { token, body: { open_date: T(), client_name: "Zammit Carmel", phone: "79123456", issue: "Omron M3?", category: "General Enquiry", priority: 2, status: "Open", ticket_id: "TKT-00001" } });
  ok(q.json && q.json.ok, q.text);
  const d = await app.api("POST", "/client-deliveries/entries", { token, body: { order_date: T(), scheduled_date: D(1), client_name: "Zammit Carmel", phone: "79123456", delivery_address: "1 Triq", items: "Insulin", status: "Scheduled", delivery_id: "DEL-00001" } });
  ok(d.json && d.json.ok, d.text);
  const rx = await app.api("POST", "/repeat-prescriptions/entries", { token, body: { entry_date: D(-25), client_name: "Zammit Carmel", client_id: "0012345M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 nocte", prescriber_name: "Dr Galea", prescriber_reg_no: "1", collect_every_days: 28 } });
  ok(rx.json && rx.json.ok, rx.text);
  const pv = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((x) => [x, [["08:00", "20:00"]]])) } });
  const sv = await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, providerIds: [pv.json.provider.id] } });
  const bk = await app.api("POST", "/bookings", { token, body: { serviceId: sv.json.service.id, date: D(3), start: "10:00", personName: "Zammit Carmel" } });
  ok(bk.json && bk.json.ok, bk.text);
  await app.api("POST", "/bookings", { token, body: { serviceId: sv.json.service.id, date: D(3), start: "11:00", personName: "Zammit Paul" } });
  const n = await app.api("GET", "/people/" + p.id + "/now", { token });
  eq(n.status, 200, n.text);
  const w = n.json.waiting;
  eq(w.orders.map((x) => x.items), ["Augmentin 625"]);
  eq(w.ready.map((x) => x.items), ["Panadol"], "the order marked ready, written with the name the other way round");
  eq(w.questions.map((x) => [x.issue, x.done]), [["Omron M3?", false]]);
  eq(w.deliveries.map((x) => x.items), ["Insulin"]);
  eq(w.repeats.map((x) => [x.medicine_name_dose, x.collect_every_days]), [["Atorvastatin 20mg", 28]]);
  eq(w.bookings.map((x) => [x.service, x.date, x.time]), [["Flu vaccine", D(3), "10:00"]]);
  eq(n.json.profile, { prefers: "", email_ok: null, sms_ok: null, whatsapp_ok: null, lang: "", allergies: "", version: 0, updated_at: "" });
  eq(n.json.email.ready, false, "no sender set up yet");
  ok(/Bookings/.test(n.json.email.why), n.json.email.why);
  eq(n.json.pharmacy.name, "Demo Pharmacy");
  eq(n.json.messages, []);
});

test("customers profile: versioned, audited, staff may change it; a stale version gets 409 with the current one; wrong words are refused", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap();
  const staff = await app.addUser({ email: "staff@example.com", role: "staff" });
  const p = await person(app, token, { name: "Vella Ġorġ", phone: "79111222" });
  const a = await app.api("POST", "/people/" + p.id + "/profile", { token: staff.token, body: { prefers: "whatsapp", email_ok: false, lang: "mt", allergies: "Penicillin", version: 0 } });
  eq(a.status, 200, a.text);
  eq([a.json.profile.prefers, a.json.profile.email_ok, a.json.profile.sms_ok, a.json.profile.whatsapp_ok, a.json.profile.lang, a.json.profile.allergies, a.json.profile.version], ["whatsapp", false, null, null, "mt", "Penicillin", 1]);
  const stale = await app.api("POST", "/people/" + p.id + "/profile", { token, body: { prefers: "sms", version: 0 } });
  eq(stale.status, 409); eq(stale.json.current.prefers, "whatsapp");
  const b = await app.api("POST", "/people/" + p.id + "/profile", { token, body: { sms_ok: true, version: 1 } });
  eq(b.status, 200, b.text); eq([b.json.profile.prefers, b.json.profile.email_ok, b.json.profile.sms_ok, b.json.profile.version], ["whatsapp", false, true, 2], "a field left out stays");
  eq((await app.api("POST", "/people/" + p.id + "/profile", { token, body: { prefers: "pigeon" } })).status, 400);
  eq((await app.api("POST", "/people/" + p.id + "/profile", { token, body: { lang: "fr" } })).status, 400);
  eq((await app.api("POST", "/people/999/profile", { token, body: { prefers: "sms" } })).status, 404);
  const au = app.DB.q("SELECT action, entity_id, details_json FROM audit_log WHERE action='CUST_PROFILE' ORDER BY id");
  eq(au.length, 2); ok(/Penicillin/.test(au[0].details_json) && /"before"/.test(au[0].details_json), au[0].details_json);
  eq((await app.api("GET", "/people/" + p.id + "/now", { token })).json.profile.allergies, "Penicillin");
});

test("customers messages: WhatsApp and SMS are recorded (sent from the pharmacy's own phone), never sent by the server; a 'no' on that channel is refused and nothing is written", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap(); const f = fakeResend();
  try {
    const p = await person(app, token, { name: "Grech Carmen", phone: "79123456" });
    const r = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "whatsapp", purpose: "ready", ref_kind: "order", ref_id: 4, to: "+356 7912 3456", body: "Hi Carmen, your order is ready.", client_key: "k1" } });
    eq(r.status, 200, r.text);
    eq([r.json.message.channel, r.json.message.status, r.json.message.to, r.json.message.purpose, r.json.message.ref_kind, r.json.message.ref_id, r.json.message.by], ["whatsapp", "device", "+35679123456", "ready", "order", 4, "Maria Borg"]);
    eq(f.calls.length, 0, "nothing leaves the server for WhatsApp or SMS");
    const again = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "whatsapp", to: "79123456", body: "Hi Carmen, your order is ready.", client_key: "k1" } });
    eq([again.status, again.json.repeat, again.json.message.id], [200, true, r.json.message.id], "the same press again (lost answer) is the first message");
    eq(app.DB.q("SELECT COUNT(*) c FROM cust_messages")[0].c, 1);
    await app.api("POST", "/people/" + p.id + "/profile", { token, body: { sms_ok: false } });
    const no = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "sms", to: "79123456", body: "x" } });
    eq(no.status, 409); eq(no.json.refused, "consent"); ok(/asked not to get text messages/.test(no.json.error), no.json.error);
    eq(app.DB.q("SELECT COUNT(*) c FROM cust_messages")[0].c, 1, "a refused message is not written");
    eq((await app.api("POST", "/messages", { token, body: { channel: "fax", to: "1", body: "x" } })).status, 400);
    eq((await app.api("POST", "/messages", { token, body: { channel: "sms", to: "12", body: "x" } })).status, 400, "no number");
    eq((await app.api("POST", "/messages", { token, body: { channel: "sms", to: "79123456", body: "  " } })).status, 400, "no text");
    // a message from a register without a card: kept under the name, shown on the card with that name
    const free = await app.api("POST", "/messages", { token, body: { name: "Grech Carmen", channel: "sms", to: "79123456", body: "Your repeat is due", purpose: "repeat" } });
    eq(free.status, 200, free.text); eq(free.json.message.person_id, 0);
    const now = await app.api("GET", "/people/" + p.id + "/now", { token });
    eq(now.json.messages.map((m) => [m.channel, m.purpose]), [["sms", "repeat"], ["whatsapp", "ready"]]);
    eq(app.DB.q("SELECT COUNT(*) c FROM audit_log WHERE action='CUST_MESSAGE'")[0].c, 2);
  } finally { f.restore(); }
});

test("customers messages: e-mail goes through the pharmacy's own Bookings sender with a stop link; the stop page asks first; after it (or a Bookings stop) e-mail is refused; a tampered link is refused", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap(); const f = fakeResend();
  try {
    const p = await person(app, token, { name: "Borg Anna", email: "anna@example.com" });
    const off = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "email", to: "anna@example.com", body: "Hi" } });
    eq(off.status, 502); ok(/Set up e-mail first/.test(off.json.error), off.json.error); eq(f.calls.length, 0);
    eq((await app.api("POST", "/bookings/senders", { token, body: { kind: "resend", apiKey: "re_secret", fromEmail: "hello@demo.mt", fromName: "Demo Pharmacy" } })).status, 201);
    eq((await app.api("GET", "/messages/setup", { token })).json.email.ready, true);
    const s = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "email", purpose: "answer", to: "Anna@Example.com", subject: "Your question", body: "Hi Anna,\nyes, we have it.\nDemo Pharmacy", client_key: "e1" } });
    eq(s.status, 200, s.text); eq([s.json.message.status, s.json.message.sender, s.json.message.to], ["sent", "Resend", "anna@example.com"]);
    eq(f.calls.length, 1); eq(f.calls[0].body.to, ["anna@example.com"]); eq(f.calls[0].body.subject, "Your question");
    ok(/yes, we have it\./.test(f.calls[0].body.html), "the text as written");
    const link = /href="https:\/\/eikon\.test(\/m\/[^"]+\/stop)"/.exec(f.calls[0].body.html);
    ok(link, "a stop link"); ok(!/re_secret/.test(JSON.stringify(app.DB.q("SELECT * FROM cust_messages"))), "no key stored with the message");
    const again = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "email", to: "anna@example.com", body: "Hi Anna,\nyes, we have it.\nDemo Pharmacy", client_key: "e1" } });
    eq([again.status, again.json.repeat], [200, true]); eq(f.calls.length, 1, "a retry never sends a second e-mail");
    const ask = await app.raw("GET", link[1]); eq(ask.status, 200); ok(/Stop e-mails\?/.test(await ask.text()), "asks first");
    eq(app.DB.q("SELECT COUNT(*) c FROM cust_msg_optout")[0].c, 0, "a GET (a link scanner) stops nothing");
    const bad = await app.raw("GET", link[1].replace(/\.(.)/, (m, c) => "." + (c === "A" ? "B" : "A"))); eq(bad.status, 404);
    const stop = await app.raw("POST", link[1]); eq(stop.status, 200); ok(/won't e-mail you/.test(await stop.text()));
    const no = await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "email", to: "anna@example.com", body: "Hi" } });
    eq([no.status, no.json.refused], [409, "opted-out"]); eq(f.calls.length, 1);
    eq((await app.api("GET", "/people/" + p.id + "/now", { token })).json.email.opted_out, true);
    // a stop from a Bookings e-mail counts too
    app.DB.db.prepare("INSERT INTO bk_optout (email, org_id, location_id) VALUES ('bob@example.com', 1, 1)").run();
    eq((await app.api("POST", "/messages", { token, body: { name: "Bob", channel: "email", to: "bob@example.com", body: "Hi" } })).status, 409);
    // the sender failing: said plainly, kept as Not sent in the timeline
    f.restore(); const f2 = fakeResend(() => 500);
    try {
      const fl = await app.api("POST", "/messages", { token, body: { name: "Cara", channel: "email", to: "cara@example.com", body: "Hi" } });
      eq(fl.status, 502); ok(/^Not sent: /.test(fl.json.error), fl.json.error); eq(fl.json.message.status, "failed");
    } finally { f2.restore(); }
  } finally { f.restore(); }
});

test("customers messages: another pharmacy (same group or not) gets 404 for the person's now, profile and messages, and nothing is written", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  app.DB.db.prepare("INSERT INTO orgs (id, name) VALUES (9, 'Other')").run();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (90, 9, 'Stranger')").run();
  const branch = await app.addUser({ email: "b@example.com", locationId: 2 }), stranger = await app.addUser({ email: "s@example.com", orgId: 9, locationId: 90 });
  const p = await person(app, token, { name: "Grech Carmen", phone: "79123456" });
  await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "sms", to: "79123456", body: "Hi" } });
  const before = JSON.stringify([app.DB.q("SELECT * FROM cust_messages"), app.DB.q("SELECT * FROM cust_profile")]);
  for (const u of [branch, stranger]) {
    eq((await app.api("GET", "/people/" + p.id + "/now", { token: u.token })).status, 404);
    eq((await app.api("POST", "/people/" + p.id + "/profile", { token: u.token, body: { prefers: "sms" } })).status, 404);
    eq((await app.api("POST", "/messages", { token: u.token, body: { person_id: p.id, channel: "sms", to: "79123456", body: "Hi" } })).status, 404);
  }
  eq(JSON.stringify([app.DB.q("SELECT * FROM cust_messages"), app.DB.q("SELECT * FROM cust_profile")]), before);
  const own = await app.api("POST", "/messages", { token: branch.token, body: { name: "Grech Carmen", channel: "sms", to: "79123456", body: "Hi" } });
  eq(own.status, 200);
  eq((await app.api("GET", "/people/" + p.id + "/now", { token })).json.messages.length, 1, "the branch's own message is not on this pharmacy's card");
  eq((await app.api("GET", "/people/" + p.id + "/now")).status, 401, "signed out");
  eq((await app.api("POST", "/messages", { body: { channel: "sms", to: "79123456", body: "Hi" } })).status, 401);
});

test("customers messages: additive — every table that existed is byte-for-byte unchanged by the new routes (only cust_* tables, the audit and schema marks gain rows)", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap(); const f = fakeResend();
  try {
    const p = await person(app, token, { name: "Zammit Carmel", id_card: "12345M", phone: "79123456", email: "c@example.com" });
    await app.api("POST", "/client-orders/entries", { token, body: { order_date: T(), client_name: "Zammit Carmel", client_phone: "79123456", items_text: "A", needed_by: T(), priority: 2 } });
    await app.api("POST", "/bookings/senders", { token, body: { kind: "resend", apiKey: "re_k", fromEmail: "hello@demo.mt" } });
    await app.api("GET", "/people/" + p.id, { token }); await app.api("GET", "/today", { token }); await app.api("GET", "/people/" + p.id + "/now", { token }); // every table the old routes create
    const skip = ["audit_log", "schema_marks", "eikon_schema_marks", "bk_senders"]; // bk_senders: its counters move when an e-mail is sent, as a Bookings e-mail moves them
    const before = snapshot(app, skip);
    await app.api("GET", "/people/" + p.id + "/now", { token });
    await app.api("POST", "/people/" + p.id + "/profile", { token, body: { prefers: "email", allergies: "Aspirin" } });
    await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "email", to: "c@example.com", body: "Hi" } });
    await app.api("POST", "/messages", { token, body: { person_id: p.id, channel: "whatsapp", to: "79123456", body: "Hi" } });
    await app.api("GET", "/messages/setup", { token });
    const after = snapshot(app, skip);
    const changed = Object.keys(after).filter((t) => before[t] !== after[t]);
    eq(changed.sort(), ["cust_messages", "cust_profile"], "only the new tables changed");
    ok(Object.keys(before).every((t) => t in after), "no table went away");
    eq(app.DB.q("SELECT used_today FROM bk_senders")[0].used_today, 1, "the sender's daily count moved by the one e-mail, as for a booking e-mail");
  } finally { f.restore(); }
});

test("customers now: a name with a Maltese capital (Ċ Ġ Ħ Ż) finds its records — GET /people/:id does not (SQLite LOWER knows only A to Z; that route is unchanged)", async () => {
  const app = await makeApp({ env: KEY }); const { token } = await app.bootstrap();
  const p = await person(app, token, { name: "Micallef Ċettina", phone: "79680531" });
  await app.api("POST", "/client-orders/entries", { token, body: { order_date: T(), client_name: "Micallef Ċettina", client_phone: "79680531", items_text: "Ventolin", needed_by: T(), priority: 2 } });
  await app.api("POST", "/client-tickets/entries", { token, body: { open_date: T(), client_name: "micallef ċettina", phone: "79680531", issue: "Price?", category: "General Enquiry", priority: 2, status: "Open", ticket_id: "TKT-00002" } });
  const old = await app.api("GET", "/people/" + p.id, { token });
  eq([old.json.activity.length, old.json.counts.order, old.json.counts.question], [0, 0, 0], "the old route finds nothing (the live behaviour, for John)");
  const n = await app.api("GET", "/people/" + p.id + "/now", { token });
  eq(n.json.waiting.orders.map((o) => o.items), ["Ventolin"]); eq(n.json.waiting.questions.length, 1);
  eq(n.json.activity.map((a) => a.kind).sort(), ["order", "question"]); eq(n.json.counts.order, 1);
});
