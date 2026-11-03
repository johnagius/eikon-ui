// Several email senders per pharmacy, tried in order: a failing one or one at its free limit hands over to the next.
import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

const KEY = { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };
const MON = "2027-03-01";

// Fake Resend and Brevo. status(provider, n) decides the reply for the n-th call to that provider.
function fakeProviders(status = () => 200) {
  const calls = []; const n = { resend: 0, brevo: 0 }; const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const url = String(u);
    const p = /api\.resend\.com/.test(url) ? "resend" : /api\.brevo\.com/.test(url) ? "brevo" : null;
    if (!p) return orig(u, init);
    n[p]++; const st = status(p, n[p]);
    calls.push({ p, st, body: JSON.parse(init.body), headers: init.headers });
    const text = st === 429 ? "daily sending quota exceeded" : st >= 400 ? "error " + st : JSON.stringify({ id: "x" });
    return new Response(text, { status: st });
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

async function setup(app) {
  const { token } = await app.bootstrap();
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: Object.fromEntries([0, 1, 2, 3, 4, 5, 6].map((d) => [d, [["08:00", "20:00"]]])) } });
  const s = await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, providerIds: [p.json.provider.id] } });
  return { token, sid: s.json.service.id };
}
const addSender = (app, token, body) => app.api("POST", "/bookings/senders", { token, body });
const book = (app, token, sid, start, email = "carmen@example.com") =>
  app.api("POST", "/bookings", { token, body: { serviceId: sid, date: MON, start, personName: "Carmen Grech", personEmail: email } });

test("senders: today's single provider becomes the first sender, nothing to set up again", async () => {
  const app = await makeApp({ env: KEY }); const f = fakeProviders();
  try {
    const { token, sid } = await setup(app);
    eq((await app.api("PUT", "/bookings/settings", { token, body: { provider: "resend", fromName: "Demo", fromEmail: "bookings@demo.mt", apiKey: "re_key" } })).status, 200);
    const l = await app.api("GET", "/bookings/senders", { token });
    eq(l.status, 200, l.text); eq(l.json.senders.length, 1); eq(l.json.senders[0].kind, "resend"); eq(l.json.senders[0].hasKey, true);
    ok(!/re_key/.test(l.text), "the key is never returned");
    eq((await book(app, token, sid, "10:00")).json.message, "sent"); eq(f.calls.length, 1); eq(f.calls[0].p, "resend");
  } finally { f.restore(); }
});

test("senders: only an admin sees or changes them; keys are stored encrypted; a key is required", async () => {
  const app = await makeApp({ env: KEY });
  const { token } = await setup(app);
  const staff = await app.addUser({ email: "staff@example.com", role: "staff" });
  eq((await app.api("GET", "/bookings/senders", { token: staff.token })).status, 403);
  eq((await addSender(app, staff.token, { kind: "brevo", apiKey: "xkeysib-1" })).status, 403);
  eq((await addSender(app, token, { kind: "brevo" })).status, 400, "no key, no sender");
  eq((await addSender(app, token, { kind: "pigeon", apiKey: "x" })).status, 400, "unknown kind");
  eq((await addSender(app, token, { kind: "brevo", apiKey: "xkeysib-secret-1", fromEmail: "bookings@demo.mt" })).status, 201);
  ok(!/xkeysib-secret-1/.test(JSON.stringify(app.DB.q("SELECT * FROM bk_senders"))), "stored encrypted");
  const app2 = await makeApp(); const t2 = (await app2.bootstrap()).token;
  eq((await addSender(app2, t2, { kind: "brevo", apiKey: "k", fromEmail: "a@b.mt" })).status, 400, "no server secret, no stored keys");
});

test("senders: when the first fails, the next sends; the failing one rests for a few minutes", async () => {
  const app = await makeApp({ env: KEY }); const f = fakeProviders((p) => (p === "resend" ? 500 : 200));
  try {
    const { token, sid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromName: "Demo", fromEmail: "bookings@demo.mt" } });
    eq((await addSender(app, token, { kind: "resend", apiKey: "re_1" })).status, 201);
    eq((await addSender(app, token, { kind: "brevo", apiKey: "xkeysib-1" })).status, 201);
    eq((await book(app, token, sid, "10:00")).json.message, "sent");
    eq(f.calls.map((c) => c.p).join(), "resend,brevo", "tried Resend, then Brevo sent");
    const l = (await app.api("GET", "/bookings/senders", { token })).json.senders;
    eq(l[0].status, "resting"); ok(/500/.test(l[0].lastError)); eq(l[1].status, "ready"); eq(l[1].usedToday, 1);
    eq((await book(app, token, sid, "10:30")).json.message, "sent");
    eq(f.calls.map((c) => c.p).join(), "resend,brevo,brevo", "a resting sender is skipped");
  } finally { f.restore(); }
});

test("senders: a provider at its limit (429) is skipped until tomorrow", async () => {
  const app = await makeApp({ env: KEY }); const f = fakeProviders((p) => (p === "resend" ? 429 : 200));
  try {
    const { token, sid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "bookings@demo.mt" } });
    await addSender(app, token, { kind: "resend", apiKey: "re_1" }); await addSender(app, token, { kind: "brevo", apiKey: "xkeysib-1" });
    await book(app, token, sid, "10:00");
    const r = (await app.api("GET", "/bookings/senders", { token })).json.senders[0];
    eq(r.status, "limit"); ok(r.restingUntil > new Date().toISOString().slice(0, 10), "until a later day: " + r.restingUntil);
  } finally { f.restore(); }
});

test("senders: Eikon counts each sender's free allowance and moves on before it is used up", async () => {
  const app = await makeApp({ env: KEY }); const f = fakeProviders();
  try {
    const { token, sid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "bookings@demo.mt" } });
    const a = await addSender(app, token, { kind: "resend", apiKey: "re_1", dailyCap: 1 });
    eq(a.json.sender.dailyCap, 1);
    await addSender(app, token, { kind: "brevo", apiKey: "xkeysib-1" });
    const d = (await app.api("GET", "/bookings/senders", { token })).json.senders[1];
    ok(d.dailyCap > 0 && d.dailyCap < 300, "Brevo defaults under its free 300 a day: " + d.dailyCap);
    await book(app, token, sid, "10:00"); await book(app, token, sid, "10:30");
    eq(f.calls.map((c) => c.p).join(), "resend,brevo", "second message went to Brevo without trying Resend");
    eq((await app.api("GET", "/bookings/senders", { token })).json.senders[0].status, "limit");
  } finally { f.restore(); }
});

test("senders: if every sender fails, the booking is still made and the message is marked failed", async () => {
  const app = await makeApp({ env: KEY }); const f = fakeProviders(() => 503);
  try {
    const { token, sid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "bookings@demo.mt" } });
    await addSender(app, token, { kind: "resend", apiKey: "re_1" }); await addSender(app, token, { kind: "brevo", apiKey: "xkeysib-1" });
    const b = await book(app, token, sid, "10:00");
    eq(b.status, 201); eq(b.json.message, "failed");
    const m = app.DB.q("SELECT status, error FROM bk_messages")[0];
    eq(m.status, "failed"); ok(/Resend/.test(m.error) && /Brevo/.test(m.error), m.error);
  } finally { f.restore(); }
});

test("senders: order can be changed, a sender switched off, and tests go to the admin or (five a day) a typed address", async () => {
  const app = await makeApp({ env: KEY }); const f = fakeProviders();
  try {
    const { token, sid } = await setup(app);
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "bookings@demo.mt" } });
    const r = (await addSender(app, token, { kind: "resend", apiKey: "re_1" })).json.sender;
    const b = (await addSender(app, token, { kind: "brevo", apiKey: "xkeysib-1" })).json.sender;
    eq((await app.api("POST", "/bookings/senders/order", { token, body: { ids: [b.id, r.id] } })).status, 200);
    await book(app, token, sid, "10:00"); eq(f.calls[0].p, "brevo", "Brevo first after reordering");
    eq((await app.api("PATCH", "/bookings/senders/" + b.id, { token, body: { enabled: false } })).status, 200);
    await book(app, token, sid, "10:30"); eq(f.calls[1].p, "resend", "a switched-off sender is not used");
    // Left empty (or not an email): the sign-in email. A typed address: allowed, five a day, then refused.
    const t0 = await app.api("POST", "/bookings/senders/" + r.id + "/test", { token, body: { to: "not an email" } });
    eq(t0.status, 200, t0.text); eq(t0.json.sentTo, "admin@example.com");
    for (let i = 0; i < 5; i++) {
      const t = await app.api("POST", "/bookings/senders/" + r.id + "/test", { token, body: { to: "owner@example.com" } });
      eq(t.status, 200, t.text); eq(t.json.sentTo, "owner@example.com");
    }
    const n = f.calls.length;
    const t6 = await app.api("POST", "/bookings/senders/" + r.id + "/test", { token, body: { to: "victim@example.com" } });
    eq(t6.status, 429, "a sixth test to another address the same day is refused");
    eq(f.calls.length, n, "and nothing is sent");
    const own = await app.api("POST", "/bookings/senders/" + r.id + "/test", { token, body: {} });
    eq(own.status, 200); eq(own.json.sentTo, "admin@example.com", "the sign-in email still works after the limit");
    eq((await app.api("DELETE", "/bookings/senders/" + b.id, { token })).status, 200);
    eq((await app.api("GET", "/bookings/senders", { token })).json.senders.length, 1);
  } finally { f.restore(); }
});

test("senders: a mail server sender is checked like before (no port 25, a real host)", async () => {
  const app = await makeApp({ env: KEY });
  const { token } = await setup(app);
  eq((await addSender(app, token, { kind: "smtp", password: "pw", smtpHost: "smtp.example.com", smtpPort: 25, smtpUser: "u", fromEmail: "a@b.mt" })).status, 400);
  eq((await addSender(app, token, { kind: "smtp", password: "pw", smtpHost: "not a host", smtpPort: 465, smtpUser: "u", fromEmail: "a@b.mt" })).status, 400);
  const ok1 = await addSender(app, token, { kind: "smtp", password: "pw", smtpHost: "smtp.example.com", smtpPort: 587, smtpSecure: "starttls", smtpUser: "u", fromEmail: "a@b.mt" });
  eq(ok1.status, 201, ok1.text); eq(ok1.json.sender.smtpPort, 587); ok(!("password" in ok1.json.sender));
});
