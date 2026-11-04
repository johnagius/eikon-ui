import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

// The day calendar (2026-11): walk-ins, repeat bookings, blocked time read by everyone, reminders and confirmations
// at a glance, no-shows per customer, a move that need not e-mail, and the time a move frees offered to the waiting list.
const KEY = { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };
const MON = "2027-03-01";
const ALL = (from, to) => Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [[from, to]]]));
function captureFetch() {
  const sent = []; const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (/api\.resend\.com|api\.brevo\.com/.test(url)) { sent.push({ url, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "x" }), { status: 200 }); }
    return orig(u, init);
  };
  return { sent, restore: () => { globalThis.fetch = orig; } };
}
async function setup(app, { mail = false, dur = 15, two = false } = {}) {
  const { token } = await app.bootstrap();
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: ALL("09:00", "13:00") } });
  const ids = [p.json.provider.id];
  if (two) ids.push((await app.api("POST", "/bookings/providers", { token, body: { name: "Joe", hours: ALL("09:00", "13:00") } })).json.provider.id);
  const s = await app.api("POST", "/bookings/services", { token, body: { name: "Injection", durationMin: dur, priceCents: 1000, providerIds: ids } });
  if (mail) eq((await app.api("PUT", "/bookings/settings", { token, body: { provider: "resend", fromName: "Demo", fromEmail: "b@demo.mt", apiKey: "re_key_123" } })).status, 200);
  return { token, sid: s.json.service.id, pid: ids[0], pid2: ids[1] };
}
const book = (app, token, sid, extra = {}) => app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "10:00", personName: "Carmen Grech", personPhone: "+356 7912 3456", ...extra } });

test("calendar: a walk-in starts now with whoever is free, is marked Here, and sends nothing", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: MON + " 10:07" } }); const cap = captureFetch();
  try {
    const { token, sid, pid, pid2 } = await setup(app, { mail: true, two: true });
    eq((await book(app, token, sid, { start: "10:00", providerId: pid, personEmail: "c@x.mt" })).status, 409, "10:00 is past at 10:07");
    const busy = await book(app, token, sid, { start: "10:15", providerId: pid, personEmail: "c@x.mt" });
    eq(busy.status, 201, busy.text);
    const before = cap.sent.length;
    const w = await app.api("POST", "/bookings", { token, body: { walkIn: true, serviceId: sid, personName: "Ġorġ Żammit" } });
    eq(w.status, 201, w.text);
    eq([w.json.booking.date, w.json.booking.start, w.json.booking.end, w.json.booking.status, w.json.booking.walkIn], [MON, "10:05", "10:20", "arrived", true]);
    eq(w.json.booking.providerId, pid2, "Maria has 10:15 booked, so Joe takes it");
    eq(cap.sent.length, before, "no e-mail for someone already here");
    const w2 = await app.api("POST", "/bookings", { token, body: { walkIn: true, serviceId: sid, personName: "Rita Vella" } });
    eq(w2.status, 409, "both busy now"); ok(Array.isArray(w2.json.next), "the next free times come back");
    eq((await app.api("POST", "/bookings", { token, body: { walkIn: true, serviceId: sid, personName: "" } })).status, 400, "a name is still needed");
  } finally { cap.restore(); }
});

test("calendar: a blocked hour stops walk-ins and bookings; everyone can read blocks, only an admin makes them", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: MON + " 10:00" } });
  const { token, sid, pid } = await setup(app);
  const x = await app.api("POST", "/bookings/exceptions", { token, body: { providerId: pid, date: MON, kind: "off", start: "10:00", end: "11:00", note: "Training" } });
  eq(x.status, 201, x.text);
  eq((await app.api("POST", "/bookings", { token, body: { walkIn: true, serviceId: sid, personName: "A B" } })).status, 409, "blocked for training");
  eq((await book(app, token, sid, { start: "10:30" })).status, 409);
  const staff = await app.addUser({ email: "staff@example.com", role: "staff" });
  const g = await app.api("GET", `/bookings/exceptions?from=${MON}&to=${MON}`, { token: staff.token });
  eq(g.status, 200, g.text);
  eq(g.json.exceptions.map((e) => [e.providerId, e.kind, e.start, e.end, e.note]), [[pid, "off", "10:00", "11:00", "Training"]]);
  eq((await app.api("POST", "/bookings/exceptions", { token: staff.token, body: { providerId: pid, date: MON, start: "12:00", end: "12:30" } })).status, 403);
  eq((await app.api("GET", `/bookings/exceptions?from=${MON}&to=2027-06-01`, { token })).status, 400, "range limited");
});

test("calendar: repeat weekly books each free week, skips a taken one, and sends one e-mail for all", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid, pid } = await setup(app, { mail: true });
    eq((await book(app, token, sid, { date: "2027-03-15", personName: "Other Person" })).status, 201);
    const before = cap.sent.length;
    const r = await book(app, token, sid, { providerId: pid, personEmail: "carmen@example.com", repeat: { everyDays: 7, count: 4 } });
    eq(r.status, 201, r.text);
    eq(r.json.series.map((b) => b.date), [MON, "2027-03-08", "2027-03-22"]);
    eq(r.json.skipped, [{ date: "2027-03-15", start: "10:00" }]);
    ok(r.json.series.every((b) => b.seriesId && b.seriesId === r.json.series[0].seriesId), "one series id");
    eq(cap.sent.length - before, 1, "one confirmation");
    ok(/Also booked at the same time: Monday 8 March at 10:00; Monday 22 March at 10:00/.test(cap.sent[cap.sent.length - 1].body.html), "lists the others");
    eq((await book(app, token, sid, { start: "11:00", repeat: { everyDays: 5, count: 3 } })).status, 400, "only whole weeks");
    eq((await book(app, token, sid, { start: "11:00", repeat: { everyDays: 7, count: 13 } })).status, 400, "at most 12");
    const plain = await book(app, token, sid, { start: "12:00" });
    eq([plain.json.series, plain.json.booking.seriesId], [undefined, ""], "a plain booking is as before");
  } finally { cap.restore(); }
});

test("calendar: the day list says who was reminded and who confirmed; the customer confirms on their page with one button", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app, { mail: true });
    const b = await book(app, token, sid, { personEmail: "carmen@example.com" });
    await book(app, token, sid, { start: "11:00", personName: "No Mail" });
    const mod = await (await import("./harness.mjs")).loadWorker();
    let pr; await mod.scheduled({}, { ...app.env, BK_TEST_NOW: "2027-02-28 18:30" }, { waitUntil(x) { pr = x; } }); await pr;
    const rem = cap.sent[cap.sent.length - 1];
    ok(/Tomorrow/.test(rem.body.subject) && /Confirm or change/.test(rem.body.html), "the reminder asks to confirm");
    const day = await app.api("GET", `/bookings?from=${MON}&to=${MON}`, { token });
    eq(day.json.mail, { on: true, evening: true, hours: 0 });
    eq(day.json.messages[b.json.booking.id].map((x) => x.kind + ":" + x.status), ["confirm:sent", "remind_evening:sent"]);
    const link = /https:\/\/eikon\.test(\/b\/[^"]+)/.exec(rem.body.html)[1];
    const page = await app.api("GET", link);
    ok(/Yes, I&#39;ll be there|Yes, I'll be there/.test(page.text), "the page has the button");
    eq((await app.api("GET", link + "/confirm")).status, 200, "a plain open (a mail scanner) shows the page and confirms nothing");
    eq(app.DB.q("SELECT status FROM bk_bookings WHERE id=?", b.json.booking.id)[0].status, "booked");
    eq((await app.api("POST", link + "/confirm", {})).status, 200);
    const row = app.DB.q("SELECT status, confirmed_via, confirmed_at, version FROM bk_bookings WHERE id=?", b.json.booking.id)[0];
    eq([row.status, row.confirmed_via, !!row.confirmed_at, row.version], ["confirmed", "customer", true, 2]);
    eq((await app.api("POST", link + "/confirm", {})).status, 200, "twice is fine");
    const g = await app.api("GET", `/bookings?from=${MON}&to=${MON}`, { token });
    const gb = g.json.bookings.find((x) => x.id === b.json.booking.id);
    eq([gb.status, gb.confirmedVia], ["confirmed", "customer"]);
    // the pharmacy calls the one without e-mail and marks it confirmed
    const nm = g.json.bookings.find((x) => x.personName === "No Mail");
    const c = await app.api("PATCH", "/bookings/" + nm.id, { token, body: { version: nm.version, status: "confirmed" } });
    eq([c.json.booking.status, c.json.booking.confirmedVia, !!c.json.booking.confirmedAt], ["confirmed", "staff", true]);
  } finally { cap.restore(); }
});

test("calendar: no-shows are counted per customer (phone in any format, e-mail or ID card) and shown on the day and the card", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: "2027-02-20 08:00" } });
  const { token, sid } = await setup(app);
  const a = await book(app, token, sid, { date: "2027-02-22", personPhone: "79123456" });
  await app.api("PATCH", "/bookings/" + a.json.booking.id, { token, body: { version: 1, status: "no_show" } });
  const a2 = await book(app, token, sid, { date: "2027-02-23", personPhone: "7912 3456", personName: "C. Grech" });
  await app.api("PATCH", "/bookings/" + a2.json.booking.id, { token, body: { version: 1, status: "no_show" } });
  const today = await book(app, token, sid, { personPhone: "+356 79 123 456" });
  await book(app, token, sid, { start: "11:00", personName: "Somebody Else", personPhone: "99887766" });
  const day = await app.api("GET", `/bookings?from=${MON}&to=${MON}`, { token });
  eq(day.json.noShows, { [today.json.booking.id]: 2 }, "two missed before, the other customer none");
  const p = await app.api("GET", "/bookings/person?phone=" + encodeURIComponent("79123456"), { token });
  eq([p.json.by, p.json.noShows, p.json.total, p.json.lastNoShow, p.json.upcoming], ["phone", 2, 3, "2027-02-23", 1]);
  eq((await app.api("GET", "/bookings/person?name=nobody", { token })).json.total, 0);
  eq((await app.api("GET", "/bookings/person", { token })).status, 400);
});

test("calendar: a move can skip the e-mail (notify:false); the time it frees goes to the first person waiting", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app, { mail: true });
    const b = await book(app, token, sid, { personEmail: "carmen@example.com" });
    const wl = await app.api("POST", "/bookings/waitlist", { token, body: { serviceId: sid, personName: "Pawlu Ħaġġar", personPhone: "79000000" } });
    const before = cap.sent.length;
    const mv = await app.api("PATCH", "/bookings/" + b.json.booking.id, { token, body: { version: 1, date: MON, start: "11:00", notify: false } });
    eq(mv.status, 200, mv.text);
    eq([mv.json.message, cap.sent.length - before], ["not-told", 0], "nobody e-mailed");
    eq([mv.json.offer.waitlistId, mv.json.offer.date, mv.json.offer.start], [wl.json.entry.id, MON, "10:00"], "10:00 offered");
    const mv2 = await app.api("PATCH", "/bookings/" + b.json.booking.id, { token, body: { version: 2, date: MON, start: "11:30" } });
    eq([mv2.json.message, cap.sent.length - before], ["sent", 1], "without the flag the customer is told, as before");
    const c = await app.api("PATCH", "/bookings/" + b.json.booking.id, { token, body: { version: 3, status: "cancelled", cancelReason: "Phoned", notify: false } });
    eq([c.json.message, cap.sent.length - before], ["not-told", 1]);
    ok(c.json.offer, "a cancel still offers the time");
  } finally { cap.restore(); }
});

test("calendar: the import's check says how many old appointments are still to come", async () => {
  const app = await makeApp({ env: { BK_TEST_NOW: "2027-02-20 08:00" } });
  const { token } = await app.bootstrap();
  await app.api("GET", "/appointments/doctors", { token }); // the old tables exist
  const sql = (s, ...a) => app.DB.db.prepare(s).run(...a);
  sql("INSERT INTO appt_doctors (org_id, location_id, name) VALUES (1, 1, 'Dr Abela')");
  const before = JSON.stringify(app.DB.q("SELECT * FROM appt_doctors"));
  for (const [d, st] of [["2027-01-10", "Completed"], ["2027-03-01", "Scheduled"], ["2027-03-02", "Cancelled"], ["2027-03-03", "Scheduled"]])
    sql("INSERT INTO appt_appointments (org_id, location_id, doctor_id, patient_name, date, time, status) VALUES (1, 1, 1, 'Anna Borg', ?, '10:00', ?)", d, st);
  const apptsBefore = JSON.stringify(app.DB.q("SELECT * FROM appt_appointments ORDER BY id"));
  const r = await app.api("POST", "/bookings/import-legacy?dry=1", { token, body: {} });
  eq(r.status, 200, r.text);
  eq([r.json.report.bookings, r.json.report.upcoming, r.json.report.dry], [4, 2, true]);
  const run = await app.api("POST", "/bookings/import-legacy", { token, body: {} });
  eq([run.json.report.bookings, run.json.report.upcoming], [4, 2]);
  eq(JSON.stringify(app.DB.q("SELECT * FROM appt_appointments ORDER BY id")), apptsBefore, "old appointments untouched");
  eq(JSON.stringify(app.DB.q("SELECT * FROM appt_doctors")), before, "old doctors untouched");
  eq((await app.api("POST", "/bookings/import-legacy?dry=1", { token, body: {} })).json.report.upcoming, 0, "nothing left to bring");
});
