// Flexible bookings: the customer moves their own booking from the private link, within the pharmacy's cut-off.
import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

const KEY = { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };
const MON = "2027-03-01", TUE = "2027-03-02";

function capture() {
  const sent = []; const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    if (/api\.brevo\.com|api\.resend\.com/.test(String(u))) { sent.push(JSON.parse(init.body)); return new Response('{"id":"x"}'); }
    return orig(u, init);
  };
  return { sent, restore: () => { globalThis.fetch = orig; } };
}
async function setup(app) {
  const { token } = await app.bootstrap();
  const all = {}; for (let d = 0; d <= 6; d++) all[d] = [["09:00", "12:00"]];
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: all } });
  const s = await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 30, providerIds: [p.json.provider.id] } });
  await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "b@demo.mt", cancelCutoffMin: 120 } });
  await app.api("POST", "/bookings/senders", { token, body: { kind: "brevo", apiKey: "xkeysib-1" } });
  return { token, sid: s.json.service.id, pid: p.json.provider.id };
}
const html = (m) => m.htmlContent || m.html || "";
const linkOf = (m) => /https:\/\/eikon\.test(\/b\/[^"]+)/.exec(html(m))[1];

test("customer moves their booking: free times exclude their own, the move is saved and confirmed by email", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: "2027-02-27 08:00" } }); const cap = capture();
  try {
    const { token, sid } = await setup(app);
    const b = await app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "10:00", personName: "Carmen Grech", personEmail: "carmen@example.com" } });
    eq(b.status, 201, b.text);
    await app.api("POST", "/bookings", { token, body: { serviceId: sid, date: TUE, start: "09:00", personName: "Other", personEmail: "o@example.com" } });
    const link = linkOf(cap.sent[0]);
    eq((await app.api("GET", link + "/move", {})).status, 200, "the change-time page opens");
    const t = await app.api("GET", link + "/times?date=" + TUE, {});
    eq(t.status, 200, t.text);
    ok(!t.json.slots.some((x) => x.time === "09:00"), "a taken time is not offered"); ok(t.json.slots.some((x) => x.time === "11:00"));
    const mv = await app.api("POST", link + "/move", { body: { date: TUE, start: "11:00" } });
    eq(mv.status, 200, mv.text);
    const row = app.DB.q("SELECT date, start_time, end_time, status, version FROM bk_bookings WHERE id=" + b.json.booking.id)[0];
    eq([row.date, row.start_time, row.end_time, row.status, row.version], [TUE, "11:00", "11:30", "booked", 2]);
    const last = cap.sent[cap.sent.length - 1];
    ok(/Moved/.test(last.subject) && /11:00/.test(html(last)), "a 'moved' email with the new time");
    eq((await app.api("POST", link + "/move", { body: { date: TUE, start: "09:00" } })).status, 409, "someone else's time is refused");
    eq((await app.api("POST", link + "/move", { body: { date: "2020-01-01", start: "09:00" } })).status, 400, "no days in the past");
    eq((await app.api("GET", link + "/times?date=nonsense", {})).status, 400);
  } finally { cap.restore(); }
});

test("customer moves their booking: not inside the cut-off, not once cancelled", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: MON + " 09:30" } }); const cap = capture();
  try {
    const { token, sid } = await setup(app);
    await app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "10:00", personName: "Carmen Grech", personEmail: "carmen@example.com" } });
    const link = linkOf(cap.sent[0]);
    const late = await app.api("POST", link + "/move", { body: { date: TUE, start: "11:00" } });
    eq(late.status, 409, "starts in 30 minutes, the cut-off is 2 hours"); ok(/call/i.test(late.json.error), late.text);
    const b2 = await app.api("POST", "/bookings", { token, body: { serviceId: sid, date: TUE, start: "10:00", personName: "Joseph Vella", personEmail: "joseph@example.com" } });
    const link2 = linkOf(cap.sent[cap.sent.length - 1]);
    await app.api("PATCH", "/bookings/" + b2.json.booking.id, { token, body: { version: 1, status: "cancelled", cancelReason: "Asked by phone" } });
    eq((await app.api("POST", link2 + "/move", { body: { date: TUE, start: "11:00" } })).status, 409, "a cancelled booking cannot be moved");
  } finally { cap.restore(); }
});

test("practitioner away: their bookings that day are cancelled with the reason, customers emailed a way to rebook", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: "2027-02-27 08:00" } }); const cap = capture();
  try {
    const { token, sid, pid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } });
    const mk = (date, start, name, email) => app.api("POST", "/bookings", { token, body: { serviceId: sid, date, start, personName: name, personEmail: email } });
    await mk(MON, "09:00", "Carmen Grech", "carmen@example.com");
    await mk(MON, "10:00", "No Email Person", "");
    await mk(TUE, "09:00", "Joseph Vella", "joseph@example.com"); // another day: untouched
    const before = cap.sent.length;
    const staff = await app.addUser({ email: "staff@example.com", role: "staff" });
    eq((await app.api("POST", `/bookings/providers/${pid}/away`, { token: staff.token, body: { from: MON, reason: "Ill" } })).status, 403, "admins only");
    eq((await app.api("POST", `/bookings/providers/${pid}/away`, { token, body: { from: MON, to: "2027-05-01", reason: "x" } })).status, 400, "at most 31 days at once");
    const r = await app.api("POST", `/bookings/providers/${pid}/away`, { token, body: { from: MON, reason: "Maria is unwell" } });
    eq(r.status, 200, r.text);
    eq(r.json.cancelled, 2); eq(r.json.emailed, 1);
    eq(r.json.toCall.map((x) => x.personName), ["No Email Person"], "the pharmacy is told whom to call");
    const rows = app.DB.q(`SELECT date, status, cancel_reason FROM bk_bookings ORDER BY id`);
    eq(rows.map((x) => x.status), ["cancelled", "cancelled", "booked"]);
    eq(rows[0].cancel_reason, "Maria is unwell");
    const mail = cap.sent.slice(before).find((m) => /Cancelled/.test(m.subject));
    ok(mail && /Maria is unwell/.test(html(mail)) && /\/book\/demo-pharmacy/.test(html(mail)), "the email says why and links to book again");
    const day = await app.api("GET", `/bookings/next?service_id=${sid}&from=${MON}&count=3`, { token });
    ok(!(day.json.slots || []).some((x) => x.date === MON), "no free times that day any more");
  } finally { cap.restore(); }
});

test("practitioner away for part of a day: only bookings in those hours are cancelled", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: "2027-02-27 08:00" } }); const cap = capture();
  try {
    const { token, sid, pid } = await setup(app);
    await app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "09:00", personName: "A", personEmail: "a@example.com" } });
    await app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "11:00", personName: "B", personEmail: "b@example.com" } });
    const r = await app.api("POST", `/bookings/providers/${pid}/away`, { token, body: { from: MON, start: "10:30", end: "12:00", reason: "Training" } });
    eq(r.status, 200, r.text); eq(r.json.cancelled, 1);
    eq(app.DB.q(`SELECT status FROM bk_bookings ORDER BY id`).map((x) => x.status), ["booked", "cancelled"]);
  } finally { cap.restore(); }
});

test("practitioners: title and speciality are kept; the booking page lists who does each service and can show one person's times", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: "2027-02-27 08:00" } });
  const { token } = await app.bootstrap();
  const h = (a, b) => { const o = {}; for (let d = 0; d <= 6; d++) o[d] = [[a, b]]; return o; };
  const borg = (await app.api("POST", "/bookings/providers", { token, body: { name: "Anna Borg", title: "Dr", speciality: "Physiotherapy", kind: "doctor", hours: h("09:00", "10:00") } })).json.provider;
  const vella = (await app.api("POST", "/bookings/providers", { token, body: { name: "Paul Vella", title: "Dr", speciality: "Physiotherapy", kind: "doctor", hours: h("14:00", "15:00") } })).json.provider;
  eq([borg.title, borg.speciality], ["Dr", "Physiotherapy"]);
  const up = await app.api("PUT", `/bookings/providers/${borg.id}`, { token, body: { name: "Anna Borg", title: "Dr", speciality: "Sports physiotherapy", kind: "doctor", hours: h("09:00", "10:00") } });
  eq(up.json.provider.speciality, "Sports physiotherapy");
  const svc = (await app.api("POST", "/bookings/services", { token, body: { name: "Physio session", durationMin: 30, providerIds: [borg.id, vella.id], online: true } })).json.service;
  await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "b@demo.mt" } });
  await app.api("POST", "/bookings/senders", { token, body: { kind: "brevo", apiKey: "xkeysib-1" } });
  const slug = (await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } })).json.settings.publicSlug;
  const sv = (await app.api("GET", `/book/${slug}/services`, {})).json.services[0];
  eq(sv.people.map((p) => p.name + " · " + p.speciality), ["Dr Anna Borg · Sports physiotherapy", "Dr Paul Vella · Physiotherapy"]);
  const any = (await app.api("GET", `/book/${slug}/day?service_id=${svc.id}&date=2027-03-01`, {})).json.slots.map((x) => x.time);
  eq(any, ["09:00", "09:30", "14:00", "14:30"], "anyone: both practitioners' times");
  const one = (await app.api("GET", `/book/${slug}/day?service_id=${svc.id}&date=2027-03-01&provider_id=${vella.id}`, {})).json.slots.map((x) => x.time);
  eq(one, ["14:00", "14:30"], "one practitioner: only their times");
  const days = (await app.api("GET", `/book/${slug}/days?service_id=${svc.id}&provider_id=${vella.id}`, {})).json.days;
  eq(days.length, 14);
});

test("clinic rooms: set up internally, a session can be in a room, two people cannot hold one room at the same time, bookings show it", async () => {
  const app = await makeApp({ env: { ...KEY, BK_TEST_NOW: "2027-02-27 08:00" } }); const cap = capture();
  try {
    const { token } = await app.bootstrap();
    const staff = await app.addUser({ email: "staff@example.com", role: "staff" });
    eq((await app.api("POST", "/bookings/rooms", { token: staff.token, body: { name: "Room 1" } })).status, 403, "admins set up rooms");
    eq((await app.api("POST", "/bookings/rooms", { token, body: { name: "" } })).status, 400);
    const r1 = (await app.api("POST", "/bookings/rooms", { token, body: { name: "Room 1" } })).json.room;
    const r2 = (await app.api("POST", "/bookings/rooms", { token, body: { name: "Physio room" } })).json.room;
    eq((await app.api("GET", "/bookings/rooms", { token })).json.rooms.map((r) => r.name), ["Physio room", "Room 1"]);
    // Monday (1): Dr Borg in Room 1 09:00–12:00
    const borg = await app.api("POST", "/bookings/providers", { token, body: { name: "Anna Borg", title: "Dr", hours: { 1: [["09:00", "12:00", r1.id]] } } });
    eq(borg.status, 201, borg.text); eq(borg.json.provider.hours[1][0][2], r1.id, "the room is kept on the session");
    const clash = await app.api("POST", "/bookings/providers", { token, body: { name: "Paul Vella", hours: { 1: [["11:00", "13:00", r1.id]] } } });
    eq(clash.status, 409, "Room 1 is Dr Borg's until 12:00"); ok(/Room 1/.test(clash.json.error) && /Borg/.test(clash.json.error), clash.text);
    const vella = await app.api("POST", "/bookings/providers", { token, body: { name: "Paul Vella", hours: { 1: [["11:00", "13:00", r2.id]] } } });
    eq(vella.status, 201, "another room is fine");
    eq((await app.api("POST", "/bookings/providers", { token, body: { name: "X", hours: { 1: [["09:00", "10:00", 9999]] } } })).status, 400, "unknown room");
    const svc = (await app.api("POST", "/bookings/services", { token, body: { name: "Consultation", durationMin: 30, providerIds: [borg.json.provider.id] } })).json.service;
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "b@demo.mt" } });
    await app.api("POST", "/bookings/senders", { token, body: { kind: "brevo", apiKey: "xkeysib-1" } });
    const bk = await app.api("POST", "/bookings", { token, body: { serviceId: svc.id, date: "2027-03-01", start: "10:00", personName: "Carmen", personEmail: "c@example.com" } });
    eq(bk.status, 201, bk.text);
    const list = await app.api("GET", "/bookings?from=2027-03-01&to=2027-03-01", { token });
    eq(list.json.bookings[0].roomName, "Room 1", "the day view knows the room");
    ok(/Room 1/.test(html(cap.sent[cap.sent.length - 1])), "the confirmation says the room");
  } finally { cap.restore(); }
});
