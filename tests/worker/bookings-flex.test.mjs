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
