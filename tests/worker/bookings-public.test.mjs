// Each pharmacy's own booking page: a clean address it can choose, days with space, and the free times of a day.
import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

const KEY = { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" };

async function setupPublic(app, opts = {}) {
  const { token } = await app.bootstrap(opts);
  const hours = {}; for (let d = 1; d <= 5; d++) hours[d] = [["09:00", "12:00"]]; // weekdays only
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours } });
  const flu = (await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 30, providerIds: [p.json.provider.id], online: true } })).json.service;
  await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "b@demo.mt" } });
  await app.api("POST", "/bookings/senders", { token, body: { kind: "brevo", apiKey: "xkeysib-1" } });
  const on = await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } });
  eq(on.status, 200, on.text);
  return { token, flu, slug: on.json.settings.publicSlug };
}

test("public page: a clean address from the pharmacy's name, no random code", async () => {
  const app = await makeApp({ env: KEY });
  const { slug } = await setupPublic(app);
  eq(slug, "demo-pharmacy");
  eq((await app.api("GET", "/book/demo-pharmacy", {})).status, 200);
});

test("public page: the pharmacy can choose its address; bad, reserved or taken ones are refused", async () => {
  const app = await makeApp({ env: KEY });
  const { token } = await setupPublic(app);
  const set = (publicSlug) => app.api("PUT", "/bookings/settings", { token, body: { publicSlug } });
  eq((await set("Borg Pharmacy!")).status, 400, "only small letters, numbers and dashes");
  eq((await set("ab")).status, 400, "too short");
  eq((await set("admin")).status, 400, "reserved");
  const r = await set("borg-pharmacy-sliema");
  eq(r.status, 200, r.text); eq(r.json.settings.publicSlug, "borg-pharmacy-sliema");
  eq((await app.api("GET", "/book/borg-pharmacy-sliema", {})).status, 200);
  eq((await app.api("GET", "/book/demo-pharmacy", {})).status, 404, "the old address is no longer this pharmacy's");
});

test("public page: two pharmacies cannot share an address", async () => {
  const app = await makeApp({ env: KEY });
  const { token } = await app.bootstrap();
  await app.api("GET", "/bookings/settings", { token }); // creates the tables
  // Another pharmacy (another group) already has "demo-pharmacy".
  app.DB.db.prepare("INSERT INTO bk_settings (org_id, location_id, provider, public_enabled, public_slug) VALUES (99, 99, 'on', 1, 'demo-pharmacy')").run();
  const hours = {}; for (let d = 1; d <= 5; d++) hours[d] = [["09:00", "12:00"]];
  const p = await app.api("POST", "/bookings/providers", { token, body: { name: "Maria", hours } });
  await app.api("POST", "/bookings/services", { token, body: { name: "Flu vaccine", durationMin: 30, providerIds: [p.json.provider.id], online: true } });
  await app.api("PUT", "/bookings/settings", { token, body: { provider: "on", fromEmail: "b@demo.mt" } });
  await app.api("POST", "/bookings/senders", { token, body: { kind: "brevo", apiKey: "xkeysib-1" } });
  const on = await app.api("PUT", "/bookings/settings", { token, body: { publicEnabled: true } });
  eq(on.json.settings.publicSlug, "demo-pharmacy-2");
  eq((await app.api("PUT", "/bookings/settings", { token, body: { publicSlug: "demo-pharmacy" } })).status, 409, "taken");
});

test("public page: days with space for the next two weeks, then the free times of a chosen day", async () => {
  const app = await makeApp({ env: KEY });
  const { slug, flu } = await setupPublic(app);
  const d = await app.api("GET", `/book/${slug}/days?service_id=${flu.id}`, {});
  eq(d.status, 200, d.text); eq(d.json.days.length, 14);
  const sat = d.json.days.find((x) => new Date(x.date + "T12:00:00Z").getUTCDay() === 6);
  const wed = d.json.days.find((x) => new Date(x.date + "T12:00:00Z").getUTCDay() === 3 && x.date > d.json.days[0].date);
  eq(sat.free, false, "closed on Saturday"); eq(wed.free, true, "open on Wednesday");
  const day = await app.api("GET", `/book/${slug}/day?service_id=${flu.id}&date=${wed.date}`, {});
  eq(day.status, 200, day.text); eq(day.json.slots[0].time, "09:00"); eq(day.json.slots.length, 6, "09:00 to 11:30 every 30 minutes");
  eq((await app.api("GET", `/book/${slug}/day?service_id=${flu.id}&date=2020-01-01`, {})).status, 400, "no days in the past");
  eq((await app.api("GET", `/book/${slug}/day?service_id=${flu.id}&date=nonsense`, {})).status, 400);
  const sv = (await app.api("GET", `/book/${slug}/services`, {})).json;
  ok(Array.isArray(sv.hours) && sv.hours.some((h) => /Mon/.test(h.days) && /09:00/.test(h.time)), "opening times for the page: " + JSON.stringify(sv.hours));
});
