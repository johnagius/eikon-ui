// Rota notices (B5, John 2026-11-10): Web Push "your shift changed" — /sw.js, device subscribe/unsubscribe per pharmacy,
// VAPID ES256 JWT, one empty push per person per save (shift routes, apply-pattern, W1 apply-plan, leave approve/reject),
// 404/410 cleanup, the notice feed the service worker reads, and nothing at all without the VAPID secret.
// The push services are stubbed (globalThis.fetch); the key pair is generated here, for these tests only.
import { generateKeyPairSync } from "node:crypto";
import { test, eq, ok } from "./lib.mjs";

const testKey = () => generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
const EP = (n) => "https://fcm.googleapis.com/fcm/send/test-device-" + n;

// Stubbed push services: records every push, answers `status(endpoint)` (default 201).
function pushStub(status) {
  const sent = [], orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const s = String(u && u.url || u);
    if (/^https:\/\/(fcm\.googleapis\.com|web\.push\.apple\.com|updates\.push\.services\.mozilla\.com)\//.test(s)) {
      sent.push({ url: s, headers: Object.fromEntries(new Headers(init && init.headers || {})), body: init && init.body });
      return new Response("", { status: status ? status(s) : 201 });
    }
    return orig(u, init);
  };
  sent.restore = () => { globalThis.fetch = orig; };
  return sent;
}
// The pushes run in ctx.waitUntil after the reply: wait until they are all out (quiet for 80 ms).
async function settle(sent, n) {
  let last = -1, calm = 0;
  for (let i = 0; i < 100; i++) { await new Promise((r) => setTimeout(r, 20)); if (sent.length === last && (n === undefined || sent.length >= n)) { calm += 20; if (calm >= 80) return; } else { calm = 0; last = sent.length; } }
}

async function world(app, { key = true } = {}) {
  if (key) app.env.VAPID_PRIVATE_KEY = testKey();
  const A = await app.bootstrap();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const staffU = await app.addUser({ email: "staff@example.com", name: "Staff One", role: "staff" });
  const mk = async (token, full_name, designation) => (await app.api("POST", "/shifts/staff", { token, body: { full_name, designation } })).json.staff_id;
  return { A, branch, staffU, maria: await mk(A.token, "Maria Borg", "pharmacist"), joe: await mk(A.token, "Joe Vella", "assistant"), far: await mk(branch.token, "Branch Person", "assistant") };
}
const sub = (app, token, staff_id, endpoint) => app.api("POST", "/rota/push/subscribe", { token, body: { staff_id, subscription: { endpoint, keys: { p256dh: "BPk-test-p256dh", auth: "test-auth" } } } });
const shift = (app, token, staff_id, shift_date, start_time, end_time) => app.api("POST", "/shifts/assignments", { token, body: { staff_id, shift_date, start_time, end_time, notes: "" } });
const feed = (app, s) => app.api("GET", "/rota/notices?sub=" + s.id + "&k=" + s.k);
const notices = (app) => app.DB.q("SELECT staff_id, kind, text FROM rota_notices ORDER BY id");

test("push: /sw.js is served at the root as JavaScript with only push + notificationclick (no fetch listener, no caching)", async (app) => {
  const r = await app.api("GET", "/sw.js");
  eq(r.status, 200);
  ok(/^application\/javascript/.test(r.headers.get("content-type")), r.headers.get("content-type"));
  eq(r.headers.get("cache-control"), "no-cache");
  const src = r.text;
  const listeners = [...src.matchAll(/addEventListener\(\s*["'](\w+)["']/g)].map((m) => m[1]).sort();
  eq(listeners, ["install", "notificationclick", "push"], "only these listeners");
  ok(!/["']fetch["']|onfetch|respondWith|caches\b|importScripts/.test(src), "no fetch handler, no Cache API, no imported code");
  eq((await app.api("GET", "/sw.js", { headers: { "Sec-Fetch-Mode": "same-origin", "Sec-Fetch-Dest": "serviceworker" } })).status, 200);
});

test("push: no VAPID secret → key says off, subscribe refused, shift writes read nothing extra and push nothing", async (app) => {
  const w = await world(app, { key: false });
  const sent = pushStub();
  try {
    const k = await app.api("GET", "/rota/push/key", { token: w.A.token });
    eq([k.status, k.json.push, k.json.publicKey], [200, false, null]);
    const sr = await sub(app, w.A.token, w.maria, EP(1));
    eq([sr.status, sr.json], [200, { ok: true, push: false }], "subscribe: ok, but push is not set up (nothing stored)");
    // Even a device row put there by hand is never used without the secret.
    await app.api("GET", "/rota/push/key", { token: w.A.token });
    app.DB.db.exec(`CREATE TABLE IF NOT EXISTS push_subscriptions (id INTEGER PRIMARY KEY, org_id INTEGER, location_id INTEGER, staff_id INTEGER, user_id INTEGER, endpoint TEXT, p256dh TEXT, auth TEXT, secret_hash TEXT, seen_notice_id INTEGER DEFAULT 0, created_at TEXT, last_push_at TEXT)`);
    app.DB.db.prepare("INSERT INTO push_subscriptions (org_id, location_id, staff_id, endpoint, secret_hash) VALUES (1, 1, ?, ?, 'x')").run(w.maria, EP(9));
    let reads = 0; const proto = Object.getPrototypeOf(app.DB.prepare("SELECT 1")); const saved = {};
    for (const m of ["first", "all", "run", "raw"]) { saved[m] = proto[m]; proto[m] = function (...a) { if (/push_subscriptions|rota_notices/.test(this.sql || this.query || "")) reads++; return saved[m].apply(this, a); }; }
    try {
      eq((await shift(app, w.A.token, w.maria, "2026-11-17", "08:00", "14:00")).status, 200);
      const id = app.DB.q("SELECT id FROM shift_assignments")[0].id;
      eq((await app.api("PUT", "/shifts/assignments/" + id, { token: w.A.token, body: { staff_id: w.maria, shift_date: "2026-11-17", start_time: "09:00", end_time: "14:00", notes: "" } })).status, 200);
      eq((await app.api("DELETE", "/shifts/assignments/" + id, { token: w.A.token })).status, 200);
    } finally { Object.assign(proto, saved); }
    await settle(sent);
    eq([reads, sent.length], [0, 0], "no read of the push tables and no push");
  } finally { sent.restore(); }
});

test("push: subscribe is per pharmacy — own location's people only, no push or notice crosses locations, unsubscribe only own", async (app) => {
  const w = await world(app);
  const sent = pushStub();
  try {
    eq((await sub(app, w.branch.token, w.maria, EP(1))).status, 404, "the branch cannot sign a device up for the main pharmacy's person");
    eq((await sub(app, w.A.token, w.far, EP(1))).status, 404);
    eq((await sub(app, w.A.token, w.maria, "https://evil.example.com/push")).status, 400, "only browsers' push services");
    eq((await sub(app, w.A.token, w.maria, "http://fcm.googleapis.com/fcm/send/x")).status, 400);
    const s1 = (await sub(app, w.staffU.token, w.maria, EP(1))).json; // a staff sign-in may too (rights unchanged)
    ok(s1.ok && s1.id && /^[A-Za-z0-9_-]{43}$/.test(s1.k), JSON.stringify(s1));
    const s2 = (await sub(app, w.branch.token, w.far, EP(2))).json;
    eq(app.DB.q("SELECT secret_hash FROM push_subscriptions WHERE id=?", s1.id)[0].secret_hash.length, 64, "only the secret's hash is kept");
    ok(!JSON.stringify(app.DB.q("SELECT * FROM push_subscriptions")).includes(s1.k), "the secret itself is not stored");
    eq((await shift(app, w.branch.token, w.far, "2026-11-17", "08:00", "14:00")).status, 200);
    await settle(sent, 1);
    eq(sent.map((x) => x.url), [EP(2)], "the branch change reaches only the branch device");
    eq((await feed(app, s1)).json.count, 0, "the main pharmacy's device has nothing to show");
    eq((await feed(app, s2)).json.body, "New shift: Tue 17 Nov 08:00–14:00");
    eq((await app.api("GET", "/rota/notices?sub=" + s2.id + "&k=" + s1.k)).status, 404, "another device's secret opens nothing");
    // Unsubscribe from the other pharmacy removes nothing; from its own it does.
    eq((await app.api("POST", "/rota/push/unsubscribe", { token: w.branch.token, body: { endpoint: EP(1) } })).json.removed, 0);
    eq((await app.api("POST", "/rota/push/unsubscribe", { token: w.A.token, body: { endpoint: EP(1) } })).json.removed, 1);
    eq((await feed(app, s1)).status, 404);
    // The same browser signing up again replaces its row (one row per device).
    const a = (await sub(app, w.A.token, w.maria, EP(3))).json, b = (await sub(app, w.A.token, w.joe, EP(3))).json;
    eq(app.DB.q("SELECT staff_id FROM push_subscriptions WHERE endpoint=?", EP(3)).map((r) => r.staff_id), [w.joe]);
    eq((await feed(app, a)).status, 404); eq((await feed(app, b)).status, 200);
  } finally { sent.restore(); }
});

test("push: the VAPID JWT is ES256 for the push service's origin, verifiable with the public key the key route gives", async (app) => {
  const w = await world(app);
  const sent = pushStub();
  try {
    const pk = (await app.api("GET", "/rota/push/key", { token: w.A.token })).json;
    eq(pk.push, true); ok(/^[A-Za-z0-9_-]{87}$/.test(pk.publicKey), pk.publicKey);
    await sub(app, w.A.token, w.maria, EP(1));
    await shift(app, w.A.token, w.maria, "2026-11-18", "13:30", "19:30");
    await settle(sent, 1);
    eq(sent.length, 1);
    const h = sent[0].headers, m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h.authorization || "");
    ok(m, h.authorization);
    eq(m[4], pk.publicKey, "k = the public key");
    const dec = (s) => Buffer.from(s, "base64url");
    eq(JSON.parse(dec(m[1])), { typ: "JWT", alg: "ES256" });
    const claims = JSON.parse(dec(m[2])), now = Math.floor(Date.now() / 1000);
    eq(claims.aud, "https://fcm.googleapis.com");
    ok(claims.exp > now && claims.exp <= now + 24 * 3600, "exp within 24 h");
    ok(/^(mailto:|https:\/\/)/.test(claims.sub), claims.sub);
    const pub = await crypto.subtle.importKey("raw", dec(pk.publicKey), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
    ok(await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, pub, dec(m[3]), new TextEncoder().encode(m[1] + "." + m[2])), "signature verifies");
    eq([h.ttl, h.urgency, h.topic, sent[0].body], ["172800", "normal", "eikon-rota", undefined], "empty push, kept 2 days, one topic (a newer push replaces an undelivered one)");
  } finally { sent.restore(); }
});

test("push: one push per device per save — W1 apply-plan for two people, Replace that puts back the same shifts says nothing", async (app) => {
  const w = await world(app);
  const sent = pushStub();
  try {
    const sm1 = (await sub(app, w.A.token, w.maria, EP(1))).json; await sub(app, w.A.token, w.maria, EP(2)); // Maria: phone + tablet
    const sj = (await sub(app, w.A.token, w.joe, EP(3))).json;
    const days = ["2026-11-16", "2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"];
    const add = days.map((date) => ({ date, start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }));
    const r = await app.api("POST", "/shifts/apply-plan", { token: w.A.token, body: { items: [{ staff_id: w.maria, from: days[0], to: "2026-11-22", add, remove: [] }, { staff_id: w.joe, from: days[0], to: "2026-11-22", add: add.slice(0, 1), remove: [] }] } });
    eq(r.status, 200, r.text);
    await settle(sent, 3);
    eq(sent.map((x) => x.url).sort(), [EP(1), EP(2), EP(3)], "one push per device, not one per shift");
    eq(notices(app).map((n) => [n.staff_id, n.text]), [[w.maria, "Your shifts changed on 5 days, Mon 16 Nov – Fri 20 Nov"], [w.joe, "New shift: Mon 16 Nov 08:00–14:00"]]);
    eq((await feed(app, sm1)).json.body, "Your shifts changed on 5 days, Mon 16 Nov – Fri 20 Nov");
    eq((await feed(app, sj)).json.title, "Your shifts");
    // Replace with exactly the same rows (new ids): nothing a person would notice → no notice, no push.
    const ids = app.DB.q("SELECT id FROM shift_assignments WHERE staff_id=?", w.maria).map((x) => x.id);
    sent.length = 0;
    eq((await app.api("POST", "/shifts/apply-plan", { token: w.A.token, body: { items: [{ staff_id: w.maria, from: days[0], to: "2026-11-22", add, remove: ids, seen: ids }] } })).status, 200);
    await settle(sent);
    eq([sent.length, notices(app).length], [0, 2]);
    // classic apply-pattern (overwrite) for one person: one push to each of her two devices
    const pattern = { week: [{ off: false, start: "09:00", end: "13:00" }, { off: true }, { off: true }, { off: true }, { off: true }, { off: true }, { off: true }] }; // Sunday-first in classic
    const ap = await app.api("POST", "/shifts/apply-pattern", { token: w.A.token, body: { staff_id: w.joe, mode: "overwrite", start_date: "2026-11-23", end_date: "2026-11-29", pattern } });
    eq(ap.status, 200, ap.text);
    await settle(sent);
    ok(app.DB.q("SELECT COUNT(*) AS n FROM shift_assignments WHERE staff_id=? AND shift_date>='2026-11-23'", w.joe)[0].n > 0, "the pattern added shifts");
    eq(sent.map((x) => x.url), [EP(3)], "apply-pattern: one push, to Joe's device");
  } finally { sent.restore(); }
});

test("push: the words — new, changed, updated, moved, removed, leave asked / approved / not approved; the feed marks what it showed", async (app) => {
  const w = await world(app);
  const sent = pushStub();
  try {
    const s = (await sub(app, w.A.token, w.maria, EP(1))).json;
    const last = async () => { await settle(sent); return (await feed(app, s)).json; };
    eq((await shift(app, w.A.token, w.maria, "2026-11-17", "08:00", "14:00")).status, 200);
    eq((await last()).body, "New shift: Tue 17 Nov 08:00–14:00");
    eq((await feed(app, s)).json.count, 0, "shown once");
    const id = app.DB.q("SELECT id FROM shift_assignments WHERE staff_id=?", w.maria)[0].id;
    const put = (b) => app.api("PUT", "/shifts/assignments/" + id, { token: w.A.token, body: Object.assign({ staff_id: w.maria, shift_date: "2026-11-17", start_time: "08:00", end_time: "14:00", notes: "", role_override: "" }, b) });
    eq((await put({ start_time: "13:30", end_time: "19:30" })).status, 200);
    eq((await last()).body, "Your Tue 17 Nov shift changed to 13:30–19:30");
    eq((await put({ start_time: "13:30", end_time: "19:30", notes: "Cover at Sliema" })).status, 200);
    eq((await last()).body, "Your Tue 17 Nov shift 13:30–19:30 was updated");
    sent.length = 0;
    eq((await put({ start_time: "13:30", end_time: "19:30", notes: "Cover at Sliema" })).status, 200);
    await settle(sent); eq(sent.length, 0, "saved unchanged → nothing sent");
    // Moved to Thursday in one step (W1: remove + add): "moved".
    const mv = await app.api("POST", "/shifts/apply-plan", { token: w.A.token, body: { items: [{ staff_id: w.maria, from: "2026-11-17", to: "2026-11-19", add: [{ date: "2026-11-19", start_time: "13:30", end_time: "19:30", role_override: "", notes: "Cover at Sliema" }], remove: [id] }] } });
    eq(mv.status, 200, mv.text);
    eq((await last()).body, "Your Tue 17 Nov shift moved to Thu 19 Nov 13:30–19:30");
    const id3 = app.DB.q("SELECT id FROM shift_assignments WHERE staff_id=?", w.maria)[0].id;
    eq((await app.api("DELETE", "/shifts/assignments/" + id3, { token: w.A.token })).status, 200);
    eq((await last()).body, "Your Thu 19 Nov shift (13:30–19:30) was removed");
    eq((await shift(app, w.A.token, w.maria, "2026-11-20", "07:30", "14:00")).status, 200); await last();
    const id2 = app.DB.q("SELECT id FROM shift_assignments WHERE staff_id=?", w.maria)[0].id;
    eq((await app.api("DELETE", "/shifts/assignments/" + id2, { token: w.A.token })).status, 200);
    eq((await last()).body, "Your Fri 20 Nov shift (07:30–14:00) was removed");
    // Leave: asked (no notice), approved, then a second request not approved; part-day says its hours.
    const lv = async (b) => (await app.api("POST", "/shifts/leaves", { token: w.A.token, body: Object.assign({ staff_id: w.maria, leave_type: "sick", hours_requested: 8, reason: "private" }, b) })).json.leave_id;
    const l1 = await lv({ start_date: "2026-12-20", end_date: "2026-12-24" });
    eq((await last()).body, "Your leave request for 20–24 Dec is waiting for approval");
    eq((await app.api("POST", "/shifts/leaves/" + l1 + "/approve", { token: w.A.token })).status, 200);
    const n1 = await last();
    eq(n1.body, "Your leave 20–24 Dec was approved", "the kind (sick) and the reason are not on the lock screen");
    sent.length = 0;
    eq((await app.api("POST", "/shifts/leaves/" + l1 + "/approve", { token: w.A.token })).status, 200);
    await settle(sent); eq(sent.length, 0, "approving again sends nothing");
    const l2 = await lv({ start_date: "2026-12-30", end_date: "2027-01-02" }); await last();
    eq((await app.api("POST", "/shifts/leaves/" + l2 + "/reject", { token: w.A.token })).status, 200);
    eq((await last()).body, "Your leave request for 30 Dec – 2 Jan was not approved");
    const l3 = await lv({ start_date: "2026-11-24", end_date: "2026-11-24", start_time: "08:00", end_time: "12:00", hours_requested: 4 }); await last();
    eq((await app.api("POST", "/shifts/leaves/" + l3 + "/approve", { token: w.A.token })).status, 200);
    eq((await last()).body, "Your leave on Tue 24 Nov 08:00–12:00 was approved");
    // Several changes before the phone asked: one notification with the newest first.
    await shift(app, w.A.token, w.maria, "2026-11-25", "08:00", "14:00"); await settle(sent);
    await shift(app, w.A.token, w.maria, "2026-11-26", "08:00", "14:00"); await settle(sent);
    const many = (await feed(app, s)).json;
    eq([many.count, many.title, many.body], [2, "2 changes to your shifts", "New shift: Thu 26 Nov 08:00–14:00\nNew shift: Wed 25 Nov 08:00–14:00"]);
    eq(many.url, "/ui/index.html#rotreg");
    // A failed save sends nothing.
    sent.length = 0;
    eq((await app.api("PUT", "/shifts/assignments/" + id2, { token: w.A.token, body: { start_time: "08:00", end_time: "14:00" } })).status, 404, "a deleted shift");
    eq((await app.api("POST", "/shifts/apply-plan", { token: w.A.token, body: { items: [{ staff_id: w.maria, from: "2026-11-30", to: "2026-11-30", add: [{ date: "2026-12-01", start_time: "08:00", end_time: "14:00" }], remove: [] }] } })).status, 400);
    await settle(sent); eq(sent.length, 0, "a refused save sends nothing");
  } finally { sent.restore(); }
});

test("push: a push service answering 410 or 404 drops that device; 500 keeps it; others still get theirs", async (app) => {
  const w = await world(app);
  const sent = pushStub((u) => /dev-gone/.test(u) ? 410 : /dev-404/.test(u) ? 404 : /dev-500/.test(u) ? 500 : 201);
  try {
    for (const e of ["dev-gone", "dev-404", "dev-500", "dev-ok"]) eq((await sub(app, w.A.token, w.maria, EP(e))).status, 200);
    await shift(app, w.A.token, w.maria, "2026-11-17", "08:00", "14:00");
    await settle(sent, 4);
    eq(sent.length, 4);
    eq(app.DB.q("SELECT endpoint FROM push_subscriptions ORDER BY id").map((r) => r.endpoint.split("-").slice(-2).join("-")), ["dev-500", "dev-ok"]);
    sent.length = 0;
    await shift(app, w.A.token, w.maria, "2026-11-18", "08:00", "14:00");
    await settle(sent, 2);
    eq(sent.length, 2, "only the kept devices");
  } finally { sent.restore(); }
});

test("push: people with no device and pharmacies with no device cost one small read and send nothing", async (app) => {
  const w = await world(app);
  const sent = pushStub();
  try {
    await sub(app, w.A.token, w.maria, EP(1));
    let reads = 0; const proto = Object.getPrototypeOf(app.DB.prepare("SELECT 1")); const saved = {};
    for (const m of ["first", "all", "run", "raw"]) { saved[m] = proto[m]; proto[m] = function (...a) { reads++; return saved[m].apply(this, a); }; }
    let withPush, without;
    try {
      reads = 0; await shift(app, w.A.token, w.joe, "2026-11-17", "08:00", "14:00"); await settle(sent); without = reads;
    } finally { Object.assign(proto, saved); }
    app.DB.db.prepare("DELETE FROM push_subscriptions").run();
    for (const m of ["first", "all", "run", "raw"]) { saved[m] = proto[m]; proto[m] = function (...a) { reads++; return saved[m].apply(this, a); }; }
    try { reads = 0; await shift(app, w.A.token, w.joe, "2026-11-18", "08:00", "14:00"); await settle(sent); withPush = reads; } finally { Object.assign(proto, saved); }
    eq([sent.length, notices(app).length], [0, 0]);
    eq(without, withPush, "Joe has no device: the same statements as a pharmacy with none (the subscriber check only)");
  } finally { sent.restore(); }
});

test("push: every shift and leave route answers byte-for-byte the same and stores the same rows with push on (device subscribed) as off", async () => {
  const { makeApp } = await import("./harness.mjs");
  const run = async (on) => {
    const app = await makeApp();
    const w = await world(app, { key: on });
    if (on) await sub(app, w.A.token, w.maria, EP(1));
    const T = w.A.token, out = [];
    const call = async (m, p, body) => { const r = await app.api(m, p, { token: T, body }); out.push(m + " " + p + " " + r.status + " " + r.text + " " + r.headers.get("content-type")); return r.json; };
    const c = await call("POST", "/shifts/assignments", { staff_id: w.maria, shift_date: "2026-11-17", start_time: "08:00", end_time: "14:00", notes: "Ħ" });
    await call("PUT", "/shifts/assignments/" + c.shift_id, { staff_id: w.maria, shift_date: "2026-11-17", start_time: "09:00", end_time: "14:00", notes: "" });
    await call("POST", "/shifts/apply-pattern", { staff_id: w.maria, start_date: "2026-11-23", end_date: "2026-11-29", mode: "fill", dates: [{ date: "2026-11-24", start_time: "08:00", end_time: "14:00" }] });
    await call("POST", "/shifts/apply-plan", { items: [{ staff_id: w.maria, from: "2026-11-30", to: "2026-12-06", add: [{ date: "2026-12-01", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }], remove: [] }] });
    await call("DELETE", "/shifts/assignments/" + c.shift_id);
    const l = await call("POST", "/shifts/leaves", { staff_id: w.maria, leave_type: "annual", start_date: "2026-12-20", end_date: "2026-12-24", hours_requested: 40, reason: "" });
    await call("POST", "/shifts/leaves/" + l.leave_id + "/approve", {});
    await call("POST", "/shifts/leaves/" + l.leave_id + "/reject", {});
    await new Promise((r) => setTimeout(r, 150));
    const rows = JSON.stringify([app.DB.q("SELECT id, org_id, location_id, staff_id, shift_date, start_time, end_time, role_override, notes, created_by FROM shift_assignments ORDER BY id"), app.DB.q("SELECT id, staff_id, leave_type, start_date, end_date, status, reviewed_by FROM shift_leaves ORDER BY id")]);
    return { out, rows };
  };
  const sent = pushStub();
  try {
    const off = await run(false), on = await run(true);
    eq(on.out, off.out, "responses identical");
    eq(on.rows, off.rows, "rows identical");
    ok(sent.length >= 7, "and push on did send: " + sent.length);
  } finally { sent.restore(); }
});
