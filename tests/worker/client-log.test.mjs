// Client error reports (backlog 7): POST /client-log stores scrubbed browser errors; only superusers read them.
import { test, eq, ok } from "./lib.mjs";

const SU = "admin@example.com";
const rows = (DB) => DB.db.prepare("SELECT * FROM client_errors ORDER BY id").all();
const post = (api, token, body) => api("POST", "/client-log", { token, body });

test("client-log: ID cards, e-mails, phones, tokens and URL queries are scrubbed before storing; stack line:col kept", async ({ api, bootstrap, DB, env }) => {
  env.SUPERUSER_EMAILS = SU;
  const a = await bootstrap();
  const r = await post(api, a.token, {
    build: "2026-11-03.131", screen: "ddsreg", kind: "error",
    message: "Bad row for 123456M maria.borg@example.com +356 7912 3456 / 79123456 at https://eikonhq.com/?q=Borg#x id 0012345 M",
    stack: "TypeError: x\n    at render (https://eikonhq.com/ui/modules.ddasales.js?v=2026-11-03.131:120:15)\n    at /people?q=Zammit%20Carmel&id=777M\n    Bearer abcDEF123456789012345678901234567890"
  });
  eq(r.status, 200, r.text);
  const [row] = rows(DB);
  const all = row.message + "\n" + row.stack;
  for (const bad of ["123456M", "0012345 M", "maria.borg", "example.com", "7912 3456", "79123456", "q=Borg", "#x", "Zammit", "777M", "v=2026", "abcDEF123"]) ok(!all.includes(bad), "still has " + bad + ": " + all);
  ok(row.message.includes("[id]") && row.message.includes("[email]") && row.message.includes("[phone]"), row.message);
  ok(row.stack.includes("modules.ddasales.js:120:15"), "line:col lost: " + row.stack);
  eq([row.org_id, row.location_id, row.screen, row.kind, row.build, row.count], [1, 1, "ddsreg", "error", "2026-11-03.131", 1]);
});

test("client-log: message capped at 300, stack at 2000; bad screen/kind/build values are dropped", async ({ api, bootstrap, DB }) => {
  const a = await bootstrap();
  const r = await post(api, a.token, { build: "<script>", screen: "../../x?y", kind: "nonsense", message: "m".repeat(5000), stack: "s".repeat(9000) });
  eq(r.status, 200, r.text);
  const [row] = rows(DB);
  eq([row.message.length, row.stack.length, row.screen, row.kind, row.build], [300, 2000, "", "error", ""]);
  eq((await post(api, a.token, { message: "" })).status, 400);
  eq((await api("POST", "/client-log", { token: a.token, body: "x".repeat(20000) })).status, 413);
});

test("client-log: the same message on the same screen the same day is one row with a count", async ({ api, bootstrap, DB }) => {
  const a = await bootstrap();
  for (let i = 0; i < 3; i++) eq((await post(api, a.token, { screen: "today", kind: "error", message: "boom", build: "b" + i })).status, 200);
  await post(api, a.token, { screen: "tempreg", kind: "error", message: "boom" });
  const r = rows(DB);
  eq(r.map((x) => [x.screen, x.message, x.count]), [["today", "boom", 3], ["tempreg", "boom", 1]]);
  eq(r[0].build, "b2", "build follows the latest report");
});

test("client-log: at most 20 reports a minute per session, then 429; another session has its own allowance", async ({ api, bootstrap, addUser, DB }) => {
  const a = await bootstrap();
  const st = [];
  for (let i = 0; i < 21; i++) st.push((await post(api, a.token, { screen: "today", message: "e" + i })).status);
  eq(st.slice(0, 20).every((s) => s === 200), true, st.join(","));
  eq(st[20], 429);
  eq(rows(DB).length, 20);
  const b = await addUser({ email: "b@example.com" });
  eq((await post(api, b.token, { screen: "today", message: "from b" })).status, 200);
  // the bucket never counts toward sign-in throttling (that counts by IP)
  eq(DB.db.prepare("SELECT COUNT(*) AS c FROM login_attempts WHERE ip <> '-'").get().c, 0);
});

test("client-log: signed-in only; the list is superuser only; another pharmacy cannot read the reports", async ({ api, raw, bootstrap, addUser, env }) => {
  env.SUPERUSER_EMAILS = SU;
  eq((await api("POST", "/client-log", { body: { message: "anon" } })).status, 401);
  const a = await bootstrap();
  eq((await post(api, a.token, { screen: "eodreg", kind: "fatal", message: "secret-ish failure A" })).status, 200);
  // a pharmacy in another group, and another pharmacy of the same group
  const DB = env.DB.db;
  DB.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Other Pharmacy')").run();
  DB.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const stranger = await addUser({ orgId: 2, locationId: 50, email: "other@example.com" });
  const branch = await addUser({ orgId: 1, locationId: 2, email: "branch@example.com" });
  eq((await post(api, stranger.token, { screen: "eodreg", kind: "fatal", message: "secret-ish failure A" })).status, 200);
  for (const t of [stranger.token, branch.token]) {
    const r = await api("GET", "/su/api/client-errors?days=7", { token: t });
    eq(r.status, 403, r.text);
    ok(!r.text.includes("failure A"));
    const g = await api("GET", "/client-log", { token: t });
    ok(g.status !== 200 && !g.text.includes("failure A"), "GET /client-log answered " + g.status);
  }
  eq((await api("GET", "/su/api/client-errors", {})).status, 401);
  // the superuser sees one group, from two pharmacies, each under its own org and location
  const su = await api("GET", "/su/api/client-errors?days=7", { token: a.token });
  eq(su.status, 200, su.text);
  eq(su.json.groups.length, 1);
  const g = su.json.groups[0];
  eq([g.screen, g.kind, g.message, g.count, g.pharmacies], ["eodreg", "fatal", "secret-ish failure A", 2, 2]);
  eq(g.where.map((w) => [w.org_id, w.location_id]).sort(), [[1, 1], [2, 50]]);
  const rowsNow = DB.prepare("SELECT org_id, location_id FROM client_errors ORDER BY org_id").all().map((x) => [x.org_id, x.location_id]);
  eq(rowsNow, [[1, 1], [2, 50]]);
});

test("client-log: the su list covers the last N days only and caps days at 30", async ({ api, bootstrap, env, DB }) => {
  env.SUPERUSER_EMAILS = SU;
  const a = await bootstrap();
  await post(api, a.token, { screen: "today", message: "recent" });
  const old = new Date(Date.now() - 10 * 86400000).toISOString().slice(0, 10);
  DB.db.prepare("INSERT INTO client_errors (org_id, location_id, day, screen, kind, message) VALUES (1, 1, ?, 'today', 'error', 'old one')").run(old);
  const r7 = await api("GET", "/su/api/client-errors?days=7", { token: a.token });
  eq(r7.json.groups.map((g) => g.message), ["recent"]);
  const r30 = await api("GET", "/su/api/client-errors?days=999", { token: a.token });
  eq([r30.json.days, r30.json.groups.length], [30, 2]);
});
