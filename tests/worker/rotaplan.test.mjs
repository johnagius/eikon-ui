// Roster planner worker additions (John 2026-11-10): W1 POST /shifts/apply-plan (one step, all or nothing, rows stored as
// the per-shift routes store them) and W3 approved leave as all-day events in the public calendar feed.
import { test, eq, ok } from "./lib.mjs";

const COLS = "org_id, location_id, staff_id, shift_date, start_time, end_time, role_override, notes, created_by";
const rowsOf = (DB, staffId) => DB.q(`SELECT id, ${COLS} FROM shift_assignments WHERE staff_id = ? ORDER BY shift_date, start_time, id`, staffId);
const noId = (r) => { const o = Object.assign({}, r); delete o.id; return o; };
const all = (DB) => JSON.stringify(DB.q("SELECT * FROM shift_assignments ORDER BY id"));

async function world(app) {
  const A = await app.bootstrap();
  const staff = await app.addUser({ email: "staff@example.com", name: "Staff One", role: "staff" });
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const mk = async (token, full_name, designation) => (await app.api("POST", "/shifts/staff", { token, body: { full_name, designation } })).json.staff_id;
  const maria = await mk(A.token, "Maria Borg", "pharmacist");
  const joe = await mk(A.token, "Joe Vella", "assistant");
  const far = await mk(branch.token, "Branch Person", "assistant");
  return { A, staff, branch, maria, joe, far };
}
const post = (app, token, body) => app.api("POST", "/shifts/apply-plan", { token, body });
const one = (app, token, staff_id, date, start_time, end_time, extra) =>
  app.api("POST", "/shifts/assignments", { token, body: Object.assign({ staff_id, shift_date: date, start_time, end_time, notes: "" }, extra || {}) });

// Counts D1 statements (inside a batch each counts once), as write-bulk.test.mjs does.
function countStatements(DB) {
  const st = { n: 0, inBatch: false, maxParams: 0, batches: [] };
  const proto = Object.getPrototypeOf(DB.prepare("SELECT 1"));
  const saved = {};
  for (const m of ["first", "all", "run", "raw"]) {
    saved[m] = proto[m];
    proto[m] = function (...a) {
      if (!st.inBatch) st.n++;
      st.maxParams = Math.max(st.maxParams, this.params.length);
      if (this.params.length > 100) throw new Error("too many SQL variables (" + this.params.length + ")");
      return saved[m].apply(this, a);
    };
  }
  const batch = DB.batch;
  DB.batch = async function (s) { st.n += s.length; st.batches.push(s.length); st.inBatch = true; try { return await batch.call(this, s); } finally { st.inBatch = false; } };
  st.restore = () => { Object.assign(proto, saved); DB.batch = batch; };
  return st;
}
const dayList = (from, n) => { const [Y, M, D] = from.split("-").map(Number); return Array.from({ length: n }, (_, i) => new Date(Date.UTC(Y, M - 1, D + i)).toISOString().slice(0, 10)); };

test("rotaplan W1: a row added in one step is stored exactly as POST /shifts/assignments stores it (notes, role, Maltese text untrimmed)", async (app) => {
  const w = await world(app);
  const rowsIn = [
    { date: "2026-11-16", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" },
    { date: "2026-11-17", start_time: "13:30", end_time: "19:30", role_override: "pharmacist", notes: " Ħal Qormi, \"cover\" ċ ġ ż " }
  ];
  const r = await post(app, w.A.token, { items: [{ staff_id: w.joe, from: "2026-11-16", to: "2026-11-22", add: rowsIn, remove: [] }] });
  eq(r.status, 200, r.text);
  eq([r.json.added, r.json.removed, r.json.results], [2, 0, [{ staff_id: w.joe, added: 2, removed: 0, skipped: 0 }]]);
  const viaPlan = rowsOf(app.DB, w.joe).map(noId);
  app.DB.db.prepare("DELETE FROM shift_assignments").run();
  for (const x of rowsIn) eq((await one(app, w.A.token, w.joe, x.date, x.start_time, x.end_time, { role_override: x.role_override, notes: x.notes })).status, 200);
  eq(viaPlan, rowsOf(app.DB, w.joe).map(noId), "every column equal to the per-shift route's row");
  const aud = app.DB.q("SELECT action, entity_id, details_json FROM audit_log WHERE action = 'SHIFT_APPLY_PLAN'");
  eq(aud.length, 1);
  eq(JSON.parse(aud[0].details_json).added, 2);
});

test("rotaplan W1: remove + add in one step removes only the listed shifts; every other shift keeps its id and values", async (app) => {
  const w = await world(app);
  for (const d of ["2026-11-16", "2026-11-17", "2026-11-18"]) await one(app, w.A.token, w.maria, d, "08:00", "14:00", { notes: "n" + d });
  await one(app, w.A.token, w.maria, "2026-11-17", "15:00", "19:00", { notes: "extra block" });
  await one(app, w.A.token, w.joe, "2026-11-17", "08:00", "14:00");
  const before = rowsOf(app.DB, w.maria);
  const joeBefore = JSON.stringify(rowsOf(app.DB, w.joe));
  const goes = before.filter((r) => r.shift_date === "2026-11-17" && r.start_time === "08:00").map((r) => r.id);
  const r = await post(app, w.A.token, { items: [{ staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", seen: before.map((x) => x.id), remove: goes,
    add: [{ date: "2026-11-17", start_time: "09:00", end_time: "13:00" }, { date: "2026-11-21", start_time: "08:00", end_time: "13:00" }] }] });
  eq(r.status, 200, r.text);
  const after = rowsOf(app.DB, w.maria);
  eq(after.filter((x) => before.some((b) => b.id === x.id)), before.filter((b) => !goes.includes(b.id)), "kept rows byte-equal, same ids");
  eq(after.length, before.length - 1 + 2);
  eq(JSON.stringify(rowsOf(app.DB, w.joe)), joeBefore, "another person untouched");
});

test("rotaplan W1: someone changed the range meanwhile (seen differs, or a removed shift is gone / another person's / outside) -> 409, nothing written", async (app) => {
  const w = await world(app);
  await one(app, w.A.token, w.maria, "2026-11-16", "08:00", "14:00");
  const seen = rowsOf(app.DB, w.maria).map((r) => r.id);
  await one(app, w.A.token, w.maria, "2026-11-18", "08:00", "14:00"); // added meanwhile on another device
  await one(app, w.A.token, w.joe, "2026-11-18", "08:00", "14:00");
  const joeId = rowsOf(app.DB, w.joe)[0].id;
  await one(app, w.A.token, w.maria, "2026-12-01", "08:00", "14:00");
  const outside = rowsOf(app.DB, w.maria).find((r) => r.shift_date === "2026-12-01").id;
  const snap = all(app.DB);
  const add = [{ date: "2026-11-19", start_time: "08:00", end_time: "14:00" }];
  for (const [why, item] of [
    ["seen differs", { staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", seen, remove: [], add }],
    ["another person's shift", { staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", remove: [joeId], add }],
    ["outside the range", { staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", remove: [outside], add }],
    ["already gone", { staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", remove: [999999], add }]
  ]) {
    const r = await post(app, w.A.token, { items: [{ staff_id: w.joe, from: "2026-11-16", to: "2026-11-22", add }, item] });
    eq([r.status, r.json.code, r.json.staff_ids], [409, "changed", [w.maria]], why + ": " + r.text);
    eq(all(app.DB), snap, why + ": nothing written for anyone");
  }
});

test("rotaplan W1: all or nothing — a failure in the second person's insert leaves the first person's removal and rows as they were", async (app) => {
  const w = await world(app);
  await one(app, w.A.token, w.maria, "2026-11-16", "08:00", "14:00");
  const id = rowsOf(app.DB, w.maria)[0].id;
  const snap = all(app.DB);
  app.DB.db.exec("CREATE TRIGGER boom BEFORE INSERT ON shift_assignments WHEN NEW.notes = 'BOOM' BEGIN SELECT RAISE(ABORT, 'injected'); END;");
  let threw = null;
  try {
    const r = await post(app, w.A.token, { items: [
      { staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", remove: [id], add: [{ date: "2026-11-17", start_time: "08:00", end_time: "14:00" }] },
      { staff_id: w.joe, from: "2026-11-16", to: "2026-11-22", add: [{ date: "2026-11-17", start_time: "08:00", end_time: "14:00", notes: "BOOM" }] }] });
    threw = r.status;
  } catch (e) { threw = String(e); }
  ok(threw !== 200, "the request failed: " + threw);
  eq(all(app.DB), snap, "rota exactly as before");
});

test("rotaplan W1: bad input is refused before anything is read or written; limits say 'split'", async (app) => {
  const w = await world(app);
  await one(app, w.A.token, w.maria, "2026-11-16", "08:00", "14:00");
  const snap = all(app.DB);
  const base = { staff_id: w.maria, from: "2026-11-16", to: "2026-11-22" };
  const cases = [
    [{ items: [] }, "items[] required"],
    [{ items: [Object.assign({}, base, { add: [{ date: "2026-11-30", start_time: "08:00", end_time: "14:00" }] })] }, "Every added shift needs a date inside its range (2026-11-30)"],
    [{ items: [Object.assign({}, base, { add: [{ date: "2026-11-17", start_time: "8:00", end_time: "14:00" }] })] }, "Every added shift needs a start and end time (HH:MM) on 2026-11-17"],
    [{ items: [Object.assign({}, base, { add: [{ date: "2026-02-30", start_time: "08:00", end_time: "14:00" }], from: "2026-02-01" })] }, "Every added shift needs a date inside its range (2026-02-30)"],
    [{ items: [Object.assign({}, base, { remove: ["1; DROP TABLE x"] })] }, "remove[] must be shift ids"],
    [{ items: [base, base] }, "Each person once per request"],
    [{ items: [Object.assign({}, base, { to: "2037-01-01" })] }, "A plan can cover at most 10 years (3,660 days) at a time"]
  ];
  for (const [b, msg] of cases) {
    const r = await post(app, w.A.token, b);
    eq([r.status, r.json.error], [400, msg]);
  }
  const many = await post(app, w.A.token, { items: Array.from({ length: 13 }, (_, i) => ({ staff_id: 100 + i, from: "2026-11-16", to: "2026-11-16" })) });
  eq([many.status, many.json.code], [400, "split"]);
  const big = await post(app, w.A.token, { items: [{ staff_id: w.maria, from: "2026-01-01", to: "2026-01-01", add: Array.from({ length: 3661 }, () => ({ date: "2026-01-01", start_time: "09:00", end_time: "10:00" })) }] });
  eq([big.status, big.json.code], [400, "split"]);
  eq(all(app.DB), snap, "nothing written by a refused request");
});

test("rotaplan W1: fill adds only on days the person has no shift left (as apply-pattern fill)", async (app) => {
  const w = await world(app);
  await one(app, w.A.token, w.maria, "2026-11-17", "15:00", "19:00", { notes: "hand" });
  const r = await post(app, w.A.token, { items: [{ staff_id: w.maria, from: "2026-11-16", to: "2026-11-22", fill: true,
    add: ["2026-11-16", "2026-11-17", "2026-11-18"].map((date) => ({ date, start_time: "08:00", end_time: "14:00" })) }] });
  eq(r.status, 200, r.text);
  eq(r.json.results[0], { staff_id: w.maria, added: 2, removed: 0, skipped: 1 });
  eq(rowsOf(app.DB, w.maria).map((x) => x.shift_date + " " + x.start_time + " " + x.notes), ["2026-11-16 08:00 ", "2026-11-17 15:00 hand", "2026-11-18 08:00 "]);
});

test("rotaplan W1: 8 people x 12 months (~2,200 shifts) in one step runs a bounded number of statements, one batch", async (app) => {
  const { token } = await app.bootstrap();
  const ids = [];
  for (let i = 0; i < 8; i++) ids.push((await app.api("POST", "/shifts/staff", { token, body: { full_name: "Person " + i } })).json.staff_id);
  const days = dayList("2026-11-16", 365);
  const items = ids.map((staff_id, i) => ({ staff_id, from: days[0], to: days[364],
    add: days.filter((d, k) => (k + i) % 7 < 5).map((date, k) => ({ date, start_time: "08:00", end_time: "14:00", notes: k % 10 ? "" : "note " + k })) }));
  const total = items.reduce((n, x) => n + x.add.length, 0);
  ok(total > 1800, "shifts " + total);
  const st = countStatements(app.DB);
  let r;
  try { r = await post(app, token, { items }); } finally { st.restore(); }
  eq(r.status, 200, r.text);
  eq(r.json.added, total);
  eq(app.DB.one("SELECT COUNT(*) AS c FROM shift_assignments").c, total);
  eq(st.batches.length, 1, "one transaction");
  ok(st.batches[0] <= 30, "statements in the batch: " + st.batches[0]);
  ok(st.n < 60, "statements in all: " + st.n);
  ok(st.maxParams <= 100, "max params " + st.maxParams);
  console.log("       " + total + " shifts for 8 people: " + st.n + " statements (" + st.batches[0] + " in the one batch)");
});

test("rotaplan W1: rights as every /shifts route — staff can apply; another pharmacy's person is not found and nothing is written", async (app) => {
  const w = await world(app);
  const r = await post(app, w.staff.token, { items: [{ staff_id: w.maria, from: "2026-11-16", to: "2026-11-16", add: [{ date: "2026-11-16", start_time: "08:00", end_time: "14:00" }] }] });
  eq(r.status, 200, r.text);
  const snap = all(app.DB);
  const x = await post(app, w.A.token, { items: [{ staff_id: w.far, from: "2026-11-16", to: "2026-11-16", add: [{ date: "2026-11-16", start_time: "08:00", end_time: "14:00" }] }] });
  eq([x.status, x.json.staff_ids], [404, [w.far]]);
  const y = await post(app, w.branch.token, { items: [{ staff_id: w.maria, from: "2026-11-16", to: "2026-11-16", remove: [rowsOf(app.DB, w.maria)[0].id] }] });
  eq(y.status, 404);
  eq(all(app.DB), snap);
  eq((await app.api("POST", "/shifts/apply-plan", { body: { items: [] } })).status, 401);
});

test("rotaplan W3: the calendar feed shows approved leave as all-day events (not pending or refused; per person; no reason; only annual named)", async (app) => {
  const w = await world(app);
  const tok = "abcdef123456abcdef";
  eq((await app.api("PUT", "/shifts/settings", { token: w.A.token, body: { pharmacistRequired: true, calendarToken: tok } })).status, 200);
  const malta = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = (n) => dayList(malta, n + 1)[n];
  await one(app, w.A.token, w.maria, d(1), "08:00", "14:00");
  const leave = async (staff_id, leave_type, s, e, extra, approve) => {
    const id = (await app.api("POST", "/shifts/leaves", { token: w.A.token, body: Object.assign({ staff_id, leave_type, start_date: s, end_date: e, reason: "Private reason ħ" }, extra || {}) })).json.leave_id;
    if (approve === true) await app.api("POST", "/shifts/leaves/" + id + "/approve", { token: w.A.token });
    if (approve === false) await app.api("POST", "/shifts/leaves/" + id + "/reject", { token: w.A.token });
    return id;
  };
  const a = await leave(w.maria, "annual", d(3), d(5), null, true);
  const s = await leave(w.joe, "sick", d(2), d(2), { start_time: "10:00", end_time: "14:00" }, true);
  await leave(w.joe, "annual", d(7), d(8), null, null);
  await leave(w.maria, "annual", d(9), d(9), null, false);
  const r = await app.api("GET", "/shifts/ical?token=" + tok);
  eq(r.status, 200);
  const t = r.text;
  ok(t.includes("UID:leave-" + a + "@eikon") && t.includes("DTSTART;VALUE=DATE:" + d(3).replace(/-/g, "")) && t.includes("DTEND;VALUE=DATE:" + d(6).replace(/-/g, "")), "annual leave, all day, end exclusive");
  ok(t.includes("SUMMARY:Maria Borg — Annual leave"), "annual named");
  ok(t.includes("UID:leave-" + s + "@eikon") && t.includes("SUMMARY:Joe Vella — Leave 10:00–14:00"), "sick leave reads 'Leave', part-day hours kept");
  ok(!/Private reason|sick/i.test(t), "no reason, no kind other than annual");
  eq((t.match(/UID:leave-/g) || []).length, 2, "pending and refused leave not shown");
  ok(t.includes("UID:shift-"), "shifts still there");
  const m = await app.api("GET", "/shifts/ical?token=" + tok + "&staff_id=" + w.maria);
  eq((m.text.match(/UID:leave-/g) || []).length, 1, "per-person feed: only Maria's leave");
  ok(m.text.split("\r\n").every((l) => !/[\r\n]/.test(l)), "CRLF lines");
});

// ---- the calendar feed that staff subscribe to: polling near-free and correct (owner, 2026-11-10)
async function feedWorld(app) {
  const w = await world(app);
  const tok = "feedtoken0123456789ab";
  await app.api("PUT", "/shifts/settings", { token: w.A.token, body: { pharmacistRequired: true, calendarToken: tok } });
  const malta = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  const d = (n) => dayList(malta, n + 1)[n];
  const s1 = (await one(app, w.A.token, w.maria, d(1), "08:00", "14:00", { notes: "Maria's" })).json.shift_id;
  const s2 = (await one(app, w.A.token, w.joe, d(2), "13:00", "19:30", { notes: "Joe's" })).json.shift_id;
  const lv = (await app.api("POST", "/shifts/leaves", { token: w.A.token, body: { staff_id: w.joe, leave_type: "annual", start_date: d(4), end_date: d(4), reason: "" } })).json.leave_id;
  await app.api("POST", "/shifts/leaves/" + lv + "/approve", { token: w.A.token });
  const feed = (q = "", headers) => app.api("GET", "/shifts/ical?token=" + tok + q, { headers });
  return Object.assign(w, { tok, d, s1, s2, lv, feed });
}
function mapCache() { // a Cache API look-alike (Map keyed by URL), installed for one test
  const m = new Map(), saved = globalThis.caches;
  globalThis.caches = { default: { match: async (k) => { const v = m.get(k.url); return v ? new Response(v.body, { status: 200, headers: v.headers }) : undefined; }, put: async (k, r) => { m.set(k.url, { body: await r.text(), headers: Object.fromEntries(r.headers) }); } } };
  return { m, restore: () => { globalThis.caches = saved; } };
}
function sqlLog(DB) { const log = [], prep = DB.prepare.bind(DB); DB.prepare = (sql) => { log.push(sql); return prep(sql); }; return { log, restore: () => { DB.prepare = prep; } }; }

test("rotaplan feed: calendar headers, ETag and Last-Modified; a poll that sends them back gets 304 with no body", async (app) => {
  const w = await feedWorld(app);
  const r = await w.feed();
  eq(r.status, 200);
  eq([r.headers.get("content-type"), r.headers.get("cache-control"), r.headers.get("pragma")], ["text/calendar; charset=utf-8", "private, max-age=900", null]);
  const et = r.headers.get("etag"), lm = r.headers.get("last-modified");
  ok(/^"[0-9a-f]{32}"$/.test(et) && !isNaN(Date.parse(lm)), "etag " + et + " last-modified " + lm);
  const a = await w.feed("", { "If-None-Match": et });
  eq([a.status, a.text, a.headers.get("etag")], [304, "", et]);
  eq((await w.feed("", { "If-None-Match": 'W/' + et + ', "other"' })).status, 304, "weak / list form");
  eq((await w.feed("", { "If-Modified-Since": lm })).status, 304);
  eq((await w.feed("", { "If-None-Match": '"stale"' })).status, 200);
});

test("rotaplan feed: stable UIDs and text poll after poll; an edit keeps the UID with a newer LAST-MODIFIED; a deleted shift disappears", async (app) => {
  const w = await feedWorld(app);
  const a = await w.feed(), b = await w.feed();
  eq(a.text, b.text, "byte-identical between polls (DTSTAMP is the row's own stamp)");
  eq(a.headers.get("etag"), b.headers.get("etag"));
  ok(a.text.includes("UID:shift-" + w.s1 + "@eikon") && a.text.includes("UID:shift-" + w.s2 + "@eikon") && a.text.includes("UID:leave-" + w.lv + "@eikon"), "one UID per shift and leave");
  app.DB.db.prepare("UPDATE shift_assignments SET updated_at = '2020-01-01 00:00:00' WHERE id = ?").run(w.s1);
  const old = (await w.feed()).text;
  eq((await app.api("PUT", "/shifts/assignments/" + w.s1, { token: w.A.token, body: { start_time: "09:00", end_time: "14:00", role_override: "", notes: "moved" } })).status, 200);
  const c = await w.feed();
  const ev = (t, id) => t.split("BEGIN:VEVENT").find((x) => x.includes("UID:shift-" + id + "@eikon")) || "";
  ok(ev(old, w.s1).includes("LAST-MODIFIED:20200101T000000Z") && /LAST-MODIFIED:20\d{6}T\d{6}Z/.test(ev(c.text, w.s1)) && !ev(c.text, w.s1).includes("20200101T") && ev(c.text, w.s1).includes("T090000"), "same UID, newer stamp, new time");
  ok(c.headers.get("etag") !== a.headers.get("etag"), "the ETag changes with the content");
  await app.api("DELETE", "/shifts/assignments/" + w.s2, { token: w.A.token });
  ok(!(await w.feed()).text.includes("UID:shift-" + w.s2 + "@eikon"), "a deleted shift is gone from the feed");
});

test("rotaplan feed: a person's feed never shows another person's shifts or leave, cached or not", async (app) => {
  const c = mapCache();
  try {
    const w = await feedWorld(app);
    const joe = await w.feed("&staff_id=" + w.joe), maria = await w.feed("&staff_id=" + w.maria), joe2 = await w.feed("&staff_id=" + w.joe);
    ok(joe.text.includes("Joe's") && joe.text.includes("UID:leave-") && !joe.text.includes("Maria"), "Joe's feed: his shift and leave only");
    ok(maria.text.includes("Maria's") && !/Joe|UID:leave-/.test(maria.text), "Maria's feed (after Joe's was cached): hers only");
    eq(joe2.text, joe.text, "Joe's again, from the cache");
    ok(c.m.size === 2 && [...c.m.keys()].every((k) => k.includes(encodeURIComponent(w.tok))), "one cache entry per person, keyed by the secret token");
    const all = await w.feed();
    ok(all.text.includes("Joe's") && all.text.includes("Maria's"), "the team feed has both");
  } finally { c.restore(); }
});

test("rotaplan feed: a repeat poll inside 15 minutes reads no rota rows (only the token lookup); 304 from the cache too", async (app) => {
  const c = mapCache();
  try {
    const w = await feedWorld(app);
    const first = await w.feed("&staff_id=" + w.maria);
    const s = sqlLog(app.DB);
    let again, nm;
    try { again = await w.feed("&staff_id=" + w.maria); nm = await w.feed("&staff_id=" + w.maria, { "If-None-Match": first.headers.get("etag") }); } finally { s.restore(); }
    eq([again.status, again.text, again.headers.get("etag"), nm.status], [200, first.text, first.headers.get("etag"), 304]);
    ok(!s.log.some((q) => /shift_assignments|shift_leaves/.test(q)), "no rota read: " + s.log.map((q) => q.replace(/\s+/g, " ").slice(0, 60)).join(" | "));
    ok(s.log.filter((q) => /shift_calendar_tokens/.test(q)).length === 2, "one token lookup per poll");
  } finally { c.restore(); }
});

test("rotaplan feed: a regenerated token answers 404 at once, even with its feed in the cache; the new token works", async (app) => {
  const c = mapCache();
  try {
    const w = await feedWorld(app);
    eq((await w.feed()).status, 200);
    const nt = "regenerated987654321zz";
    await app.api("PUT", "/shifts/settings", { token: w.A.token, body: { pharmacistRequired: true, calendarToken: nt } });
    const old = await w.feed();
    eq(old.status, 404, "the old link is dead");
    ok(!/BEGIN:VCALENDAR/.test(old.text));
    const fresh = await app.api("GET", "/shifts/ical/" + nt + ".ics");
    ok(fresh.status === 200 && fresh.text.includes("Maria's"), "the new token's feed");
  } finally { c.restore(); }
});
