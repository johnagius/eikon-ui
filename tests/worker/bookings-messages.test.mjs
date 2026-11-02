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

test("public booking: off by default, needs emails, offers only online services, books after the emailed code", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token } = await app.bootstrap();
    const all = {}; for (let d = 0; d <= 6; d++) all[d] = [["08:00", "20:00"]];
    const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: all } });
    const flu = (await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, providerIds: [p.json.provider.id], online: true } })).json.service;
    await app.api("POST", "/bookings/services", { token, body: { name: "Staff only", durationMin: 10, providerIds: [p.json.provider.id] } });
    eq((await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } })).status, 400, "needs emails first");
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "resend", fromEmail: "b@demo.mt", apiKey: "k" } });
    const on = await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } });
    eq(on.status, 200, on.text); const slug = on.json.settings.publicSlug; ok(/^demo-pharmacy-[0-9a-f]{6}$/.test(slug), slug);
    eq((await app.api("GET", "/book/" + slug, {})).status, 200);
    const sv = await app.api("GET", `/book/${slug}/services`, {});
    eq(sv.json.services.map((s) => s.name), ["Flu vaccine"], "only online services");
    const nx = (await app.api("GET", `/book/${slug}/next?service_id=${flu.id}`, {})).json.slots;
    ok(nx.length > 0);
    const s0 = nx[0];
    const hold = await app.api("POST", `/book/${slug}/hold`, { body: { serviceId: flu.id, providerId: s0.providerId, date: s0.date, start: s0.time, name: "Online Olga", email: "olga@example.com" } });
    eq(hold.status, 200, hold.text);
    const codeMail = cap.sent.find((m) => /Your code/.test(m.body.subject)); ok(codeMail, "code emailed");
    const code = /Your code: (\d{6})/.exec(codeMail.body.subject)[1];
    eq((await app.api("POST", `/book/${slug}/confirm`, { body: { holdId: hold.json.holdId, code: "000000" === code ? "111111" : "000000" } })).status, 400);
    const conf = await app.api("POST", `/book/${slug}/confirm`, { body: { holdId: hold.json.holdId, code } });
    eq(conf.status, 200, conf.text); ok(/^\/b\//.test(conf.json.link), "private link returned");
    eq(app.DB.q("SELECT person_name, notes FROM bk_bookings")[0].notes, "Booked online");
    ok(cap.sent.some((m) => /Booked: Flu vaccine/.test(m.body.subject)), "confirmation email");
    eq((await app.api("POST", `/book/${slug}/confirm`, { body: { holdId: hold.json.holdId, code } })).status, 410, "a code works once");
    // Taken between hold and confirm
    const s1 = (await app.api("GET", `/book/${slug}/next?service_id=${flu.id}`, {})).json.slots[0];
    const h2 = await app.api("POST", `/book/${slug}/hold`, { body: { serviceId: flu.id, providerId: s1.providerId, date: s1.date, start: s1.time, name: "Late Larry", email: "larry@example.com" } });
    const code2 = /Your code: (\d{6})/.exec(cap.sent.filter((m) => /Your code/.test(m.body.subject)).pop().body.subject)[1];
    await app.api("POST", "/bookings", { token, body: { serviceId: flu.id, providerId: s1.providerId, date: s1.date, start: s1.time, personName: "At the counter" } });
    eq((await app.api("POST", `/book/${slug}/confirm`, { body: { holdId: h2.json.holdId, code: code2 } })).status, 409, "taken meanwhile");
    // Switched off: nothing is revealed
    await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: false } });
    eq((await app.api("GET", `/book/${slug}/services`, {})).status, 404);
  } finally { cap.restore(); }
});

test("public booking: five wrong codes end the attempt", async () => {
  const app = await makeApp({ env: KEY }); const cap = captureFetch();
  try {
    const { token } = await app.bootstrap();
    const all = {}; for (let d = 0; d <= 6; d++) all[d] = [["08:00", "20:00"]];
    const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: all } });
    const flu = (await app.api("POST", "/bookings/services", { token, body: { name: "Flu", durationMin: 10, providerIds: [p.json.provider.id], online: true } })).json.service;
    await app.api("PUT", "/bookings/settings", { token, body: { provider: "resend", fromEmail: "b@demo.mt", apiKey: "k" } });
    const slug = (await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } })).json.settings.publicSlug;
    const s0 = (await app.api("GET", `/book/${slug}/next?service_id=${flu.id}`, {})).json.slots[0];
    const h = await app.api("POST", `/book/${slug}/hold`, { body: { serviceId: flu.id, providerId: s0.providerId, date: s0.date, start: s0.time, name: "G", email: "g@example.com" } });
    const code = /Your code: (\d{6})/.exec(cap.sent.pop().body.subject)[1];
    for (let i = 0; i < 5; i++) await app.api("POST", `/book/${slug}/confirm`, { body: { holdId: h.json.holdId, code: "12345" + i } });
    eq((await app.api("POST", `/book/${slug}/confirm`, { body: { holdId: h.json.holdId, code } })).status, 429, "even the right code is refused after 5 wrong ones");
    eq(app.DB.q("SELECT COUNT(*) AS c FROM bk_bookings")[0].c, 0);
  } finally { cap.restore(); }
});

// A scripted SMTP server: replies like a real one and records what the client sent.
function fakeSmtp({ password = "secret", starttls = false } = {}) {
  const log = { lines: [], data: "", tls: false, connectedTo: null };
  const factory = async (host, port, secure) => {
    log.connectedTo = { host, port, secure };
    const out = ["220 mail.test ESMTP"]; let inData = false, user = "", secured = false; // per connection, like a real server
    const ehlo = () => ["250-mail.test", ...(starttls && !secured ? ["250-STARTTLS"] : []), "250 AUTH LOGIN"];
    const b64d = (x) => Buffer.from(x, "base64").toString();
    return {
      async read() { if (!out.length) throw new Error("server has nothing to say"); return out.shift(); },
      async write(s) {
        if (inData) { log.data += s; if (s.endsWith("\r\n.\r\n")) { inData = false; out.push("250 OK queued"); } return; }
        for (const line of s.split("\r\n").filter(Boolean)) {
          log.lines.push(line);
          if (/^EHLO/.test(line)) out.push(...ehlo());
          else if (line === "STARTTLS") out.push("220 go ahead");
          else if (line === "AUTH LOGIN") out.push("334 VXNlcm5hbWU6");
          else if (!user && log.lines[log.lines.length - 2] === "AUTH LOGIN") { user = b64d(line); out.push("334 UGFzc3dvcmQ6"); }
          else if (user && log.lines[log.lines.length - 3] === "AUTH LOGIN") out.push(b64d(line) === password ? "235 ok" : "535 5.7.8 Authentication failed");
          else if (/^MAIL FROM/.test(line) || /^RCPT TO/.test(line)) out.push("250 ok");
          else if (line === "DATA") { out.push("354 end with ."); inData = true; }
          else if (line === "QUIT") out.push("221 bye");
        }
      },
      async startTls() { secured = true; log.tls = true; },
      async close() {}
    };
  };
  return { factory, log };
}

test("booking messages over SMTP: 465 TLS with login, MIME message with the calendar file", async () => {
  const smtp = fakeSmtp();
  const app = await makeApp({ env: { ...KEY, __SMTP_TRANSPORT: smtp.factory } });
  const { token } = await app.bootstrap();
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: { 1: [["08:00", "20:00"]] } } });
  const sv = (await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, providerIds: [p.json.provider.id] } })).json.service;
  eq((await app.api("PUT", "/bookings/settings", { token, body: { provider: "smtp", smtpHost: "smtp.example.com", smtpPort: 25, fromEmail: "b@demo.mt" } })).status, 400, "port 25 refused");
  eq((await app.api("PUT", "/bookings/settings", { token, body: { provider: "smtp", smtpHost: "not a host", fromEmail: "b@demo.mt" } })).status, 400);
  const st = await app.api("PUT", "/bookings/settings", { token, body: { provider: "smtp", smtpHost: "smtp.example.com", smtpPort: 465, smtpUser: "bookings@demo.mt", smtpSecure: "tls", apiKey: "secret", fromName: "Demo Pharmacy", fromEmail: "bookings@demo.mt" } });
  eq(st.status, 200, st.text); ok(!/secret/.test(st.text), "password never returned");
  const b = await app.api("POST", "/bookings", { token, body: { serviceId: sv.id, date: MON, start: "10:00", personName: "Carmen Grech", personEmail: "carmen@example.com" } });
  eq(b.json.message, "sent", b.text);
  eq(smtp.log.connectedTo, { host: "smtp.example.com", port: 465, secure: "tls" });
  ok(smtp.log.lines.includes("MAIL FROM:<bookings@demo.mt>") && smtp.log.lines.includes("RCPT TO:<carmen@example.com>"));
  ok(/Content-Type: multipart\/mixed/.test(smtp.log.data) && /filename="booking.ics"/.test(smtp.log.data), "MIME with calendar attachment");
  const subj = /Subject: =\?UTF-8\?B\?([^?]+)\?=/.exec(smtp.log.data);
  ok(subj && /^Booked: Flu vaccine · /.test(Buffer.from(subj[1], "base64").toString()), "non-ASCII subject is RFC 2047 encoded");
  const htmlB64 = /charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n([\s\S]*?)--eikon/.exec(smtp.log.data)[1].replace(/\r\n/g, "");
  ok(/Hi Carmen/.test(Buffer.from(htmlB64, "base64").toString()), "the HTML body decodes");
});

test("booking messages over SMTP: STARTTLS on 587; a wrong password fails the email, never the booking", async () => {
  const smtp = fakeSmtp({ starttls: true, password: "right" });
  const app = await makeApp({ env: { ...KEY, __SMTP_TRANSPORT: smtp.factory } });
  const { token } = await app.bootstrap();
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours: { 1: [["08:00", "20:00"]] } } });
  const sv = (await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 10, providerIds: [p.json.provider.id] } })).json.service;
  await app.api("PUT", "/bookings/settings", { token, body: { provider: "smtp", smtpHost: "smtp.example.com", smtpPort: 587, smtpUser: "u", smtpSecure: "starttls", apiKey: "right", fromEmail: "b@demo.mt" } });
  eq((await app.api("POST", "/bookings", { token, body: { serviceId: sv.id, date: MON, start: "10:00", personName: "A", personEmail: "a@example.com" } })).json.message, "sent");
  ok(smtp.log.tls && smtp.log.lines.indexOf("STARTTLS") < smtp.log.lines.indexOf("AUTH LOGIN"), "TLS before login");
  await app.api("PUT", "/bookings/settings", { token, body: { apiKey: "wrong" } });
  const b2 = await app.api("POST", "/bookings", { token, body: { serviceId: sv.id, date: MON, start: "10:30", personName: "B", personEmail: "b@example.com" } });
  eq(b2.status, 201); eq(b2.json.message, "failed");
  const err = app.DB.q("SELECT error FROM bk_messages ORDER BY id DESC LIMIT 1")[0].error;
  ok(/login \(check user and password\)/.test(err), "a clear reason is recorded: " + err);
});
