import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

const KEY = { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };
const MON = "2027-03-01";
function captureFetch(status = 200) {
  const sent = []; const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    if (/api\.resend\.com|api\.brevo\.com/.test(url)) { sent.push({ url, headers: init.headers, body: JSON.parse(init.body) }); return new Response(JSON.stringify({ id: "x" }), { status }); }
    return orig(u, init);
  };
  return { sent, restore: () => { globalThis.fetch = orig; } };
}
async function setup(app, { provider = "resend" } = {}) {
  const { token } = await app.bootstrap();
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: { 0: [["08:00", "20:00"]], 1: [["08:00", "20:00"]], 2: [["08:00", "20:00"]], 3: [["08:00", "20:00"]], 4: [["08:00", "20:00"]], 5: [["08:00", "20:00"]], 6: [["08:00", "20:00"]] } } });
  const s = await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, priceCents: 1500, providerIds: [p.json.provider.id] } });
  const st = await app.api("PUT", "/bookings/settings", { token, body: { provider, fromName: "Demo Pharmacy", fromEmail: "bookings@demo.mt", apiKey: "re_secret_key_123", phone: "2123 4567", address: "1 Triq il-Knisja, Valletta" } });
  eq(st.status, 200, st.text);
  return { token, sid: s.json.service.id };
}
const book = (app, token, sid, extra = {}) => app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start: "10:00", personName: "Carmen Grech", personEmail: "carmen@example.com", personPhone: "79123456", personIdCard: "0012345M", notes: "STAFF ONLY note", ...extra } });
const linkFrom = (mail) => /https:\/\/eikon\.test(\/b\/[^"]+)/.exec(mail.body.html || mail.body.htmlContent)[1];

test("booking messages: settings never return the key; only admins; no key without the server secret", async () => {
  const app = await makeApp({ env: KEY });
  const { token } = await setup(app);
  const g = await app.api("GET", "/bookings/settings", { token });
  eq(g.json.settings.hasKey, true); ok(!/re_secret_key_123/.test(g.text), "key not returned");
  const staff = await app.addUser({ email: "staff@example.com", role: "staff" });
  eq((await app.api("GET", "/bookings/settings", { token: staff.token })).status, 403);
  const app2 = await makeApp();
  const t2 = (await app2.bootstrap()).token;
  eq((await app2.api("PUT", "/bookings/settings", { token: t2, body: { provider: "resend", fromEmail: "a@b.mt", apiKey: "k" } })).status, 400, "no BOOKINGS_KEY, no stored keys");
  ok(!/re_secret_key_123/.test(JSON.stringify(app.DB.q("SELECT api_key_enc FROM bk_settings"))), "stored encrypted, not plain");
});

test("booking messages: a booking with an email gets a confirmation with a calendar file and a private link", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app);
    const b = await book(app, token, sid);
    eq(b.status, 201, b.text); eq(b.json.message, "sent");
    eq(cap.sent.length, 1);
    const m = cap.sent[0];
    eq(m.body.to, ["carmen@example.com"]); ok(/Booked: Flu vaccine/.test(m.body.subject));
    ok(m.body.attachments && m.body.attachments[0].filename === "booking.ics", "calendar file attached");
    ok(/\/b\/[0-9a-f]{32}\./.test(m.body.html), "private link in the email");
    ok(!/STAFF ONLY|0012345M/.test(m.body.html), "no notes or ID card in the email");
    eq((await book(app, token, sid, { start: "10:30", personEmail: "" })).json.message, "no-email");
  } finally { cap.restore(); }
});

test("booking link: shows only that booking, refuses tampering, cancels within the cut-off, then emails", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app);
    await book(app, token, sid);
    await book(app, token, sid, { start: "11:00", personName: "Joseph Vella", personEmail: "joseph@example.com" });
    const link = linkFrom(cap.sent[0]);
    const page = await app.api("GET", link, {});
    eq(page.status, 200); ok(/Carmen, you're booked/.test(page.text)); ok(/Flu vaccine/.test(page.text));
    ok(!/Grech|79123456|0012345M|STAFF ONLY|Joseph/.test(page.text), "no surname, phone, ID card, notes or other people");
    eq(page.headers.get("x-robots-tag"), "noindex");
    const parts = link.split("/b/")[1].split(".");
    const otherLinkId = app.DB.q("SELECT link_id FROM bk_bookings WHERE person_name='Joseph Vella'")[0].link_id;
    eq((await app.api("GET", `/b/${otherLinkId}.${parts[1]}.${parts[2]}`, {})).status, 404, "another booking's id with this signature");
    eq((await app.api("GET", `/b/${parts[0]}.${(parseInt(parts[1], 36) + 30).toString(36)}.${parts[2]}`, {})).status, 404, "extended expiry");
    eq((await app.api("GET", "/b/nonsense", {})).status, 404);
    const ics = await app.api("GET", link + ".ics", {}); ok(/BEGIN:VCALENDAR/.test(ics.text) && /DTSTART;TZID=Europe\/Malta:20270301T100000/.test(ics.text), "calendar file");
    const c = await app.api("POST", link + "/cancel", {});
    eq(c.status, 200, c.text);
    eq(app.DB.q("SELECT status FROM bk_bookings WHERE person_name='Carmen Grech'")[0].status, "cancelled");
    ok(cap.sent.some((m) => /Cancelled: Flu vaccine/.test(m.body.subject)), "cancellation email");
    eq((await app.api("POST", link + "/cancel", {})).status, 409, "a second cancel does nothing");
  } finally { cap.restore(); }
});

test("booking link: inside the cut-off, the customer is asked to call instead", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { cancelCutoffMin: 2880 * 400 } });
    const tok = (await app.api("GET", "/bookings/settings", { token })).json; // cut-off is capped at 2 days
    eq(tok.settings.cancelCutoffMin, 2880);
    const n = await app.api("GET", `/bookings/next?service_id=${sid}&count=1`, { token });
    const s = n.json.slots[0];
    await app.api("POST", "/bookings", { token, body: { serviceId: sid, providerId: s.providerId, date: s.date, start: s.time, personName: "Soon Person", personEmail: "soon@example.com" } });
    const link = linkFrom(cap.sent[cap.sent.length - 1]);
    ok(!/Cancel booking/.test((await app.api("GET", link, {})).text), "no cancel button inside the cut-off");
    eq((await app.api("POST", link + "/cancel", {})).status, 409);
  } finally { cap.restore(); }
});

test("booking messages: one-click opt-out stops further emails", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app);
    await book(app, token, sid);
    const link = linkFrom(cap.sent[0]);
    eq((await app.api("POST", link + "/stop", {})).status, 200);
    eq((await book(app, token, sid, { start: "12:00" })).json.message, "opted-out");
    eq(cap.sent.length, 1);
  } finally { cap.restore(); }
});

test("booking reminders: the evening before, sent once even if the job runs twice", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token, sid } = await setup(app);
    await book(app, token, sid);
    await book(app, token, sid, { start: "11:00", personName: "No Email", personEmail: "" });
    const mod = await (await import("./harness.mjs")).loadWorker();
    const run = async (when) => { const before = cap.sent.length; let p; await mod.scheduled({}, { ...app.env, BK_TEST_NOW: when }, { waitUntil(x) { p = x; } }); await p; return cap.sent.slice(before); };
    eq((await run("2027-02-28 17:00")).length, 0, "not before 18:00");
    const first = await run("2027-02-28 18:30");
    eq(first.length, 1); ok(/Tomorrow: Flu vaccine/.test(first[0].body.subject)); ok(/at 10:00/.test(first[0].body.html));
    eq((await run("2027-02-28 18:40")).length, 0, "claimed once, never sent twice");
    eq((await run("2027-02-27 18:30")).length, 0, "only for tomorrow's bookings");
  } finally { cap.restore(); }
});

test("booking messages: a failing provider never fails the booking; the failure is recorded", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch(500);
  try {
    const { token, sid } = await setup(app, { provider: "brevo" });
    const b = await book(app, token, sid);
    eq(b.status, 201); eq(b.json.message, "failed");
    eq(cap.sent[0].headers["api-key"], "re_secret_key_123"); eq(cap.sent[0].body.to[0].email, "carmen@example.com");
    const row = app.DB.q("SELECT status, error FROM bk_messages")[0];
    eq(row.status, "failed"); ok(/Brevo 500/.test(row.error));
  } finally { cap.restore(); }
});

test("booking link: rate-limited per network", async () => {
  const app = await makeApp({ env: KEY });
  await app.bootstrap();
  const ip = { "CF-Connecting-IP": "198.51.100.9" };
  for (let i = 0; i < 60; i++) await app.api("GET", "/b/x", { headers: ip });
  eq((await app.api("GET", "/b/x", { headers: ip })).status, 429);
  eq((await app.api("GET", "/b/x", { headers: { "CF-Connecting-IP": "203.0.113.1" } })).status, 404);
});
