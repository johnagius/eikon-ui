// Team sign-ins (backlog 2 item 4): a pharmacy admin manages the sign-ins of their own pharmacy, nobody else's.
// A = org 1 / location 1 (bootstrap admin). Branch = org 1 / location 2 (same group). Stranger = org 2 / location 50.
import { test, eq, ok } from "./lib.mjs";

async function world(app, opts = {}) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B (same group)')").run();
  app.DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Stranger Pharmacy')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const stranger = await app.addUser({ orgId: 2, locationId: 50, email: "stranger@example.com", name: "Stranger Admin" });
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff One", role: "staff" });
  if (opts.manageAdmins) app.env.TEAM_ADMINS_MANAGE_ADMINS = "1";
  return { A, branch, stranger, staff };
}
const usersRow = (app, id) => JSON.stringify(app.DB.db.prepare("SELECT * FROM users WHERE id = ?").get(id));
const sessionsOf = (app, id) => app.DB.db.prepare("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?").get(id).c;

test("team: an admin lists only their own pharmacy's sign-ins; staff cannot list", async (app) => {
  const w = await world(app);
  const r = await app.api("GET", "/team/users", { token: w.A.token });
  eq(r.status, 200);
  eq(r.json.users.map((u) => u.email).sort(), ["admin@example.com", "staff@example.com"]);
  ok(r.json.users.every((u) => !("pass_hash_b64" in u) && !("pass_salt_b64" in u)), "no hashes in the list");
  ok(r.json.users.find((u) => u.email === "staff@example.com").signed_in_devices === 1, "open sessions counted");
  eq((await app.api("GET", "/team/users", { token: w.staff.token })).status, 403);
  eq((await app.api("POST", "/team/users", { token: w.staff.token, body: { email: "x@example.com", full_name: "X" } })).status, 403);
});

test("team: add a person: temporary password once, must change at first sign-in, nothing else works until then", async (app) => {
  const w = await world(app);
  const c = await app.api("POST", "/team/users", { token: w.A.token, body: { email: "New.Person@Example.com", full_name: "New Person", role: "staff" } });
  eq(c.status, 200, c.text);
  const temp = c.json.temporary_password;
  ok(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/.test(temp), "readable temporary password: " + temp);
  eq(c.json.user.email, "new.person@example.com");
  const row = app.DB.db.prepare("SELECT * FROM users WHERE email = 'new.person@example.com'").get();
  eq([row.org_id, row.default_location_id, row.role, row.is_active, row.must_change_password], [1, 1, "staff", 1, 1]);
  ok(!JSON.stringify(row).includes(temp), "the password is not stored in clear");
  // Listing again never shows it.
  ok(!(await app.api("GET", "/team/users", { token: w.A.token })).text.includes(temp), "list never shows the temporary password");
  const L = await app.api("POST", "/auth/login", { body: { email: "new.person@example.com", password: temp } });
  eq(L.status, 200); eq(L.json.must_change, true); eq(L.json.user.must_change, true);
  const t = L.json.token;
  eq((await app.api("GET", "/auth/me", { token: t })).json.user.must_change, true);
  const blocked = await app.api("GET", "/today", { token: t });
  eq(blocked.status, 403); eq(blocked.json.must_change, true);
  eq((await app.api("GET", "/temperature/devices", { token: t })).status, 403);
  const ch = await app.api("POST", "/auth/change-password", { token: t, body: { current_password: temp, new_password: "My-own-pass-2026" } });
  eq(ch.status, 200, ch.text);
  eq(app.DB.db.prepare("SELECT must_change_password FROM users WHERE id = ?").get(row.id).must_change_password, 0);
  const me = await app.api("GET", "/auth/me", { token: t });
  ok(!("must_change" in me.json.user), "flag gone after the change");
  eq((await app.api("GET", "/today", { token: t })).status, 200);
});

test("team: create refusals: bad role, admin role (default), superuser e-mail, duplicate e-mail, bad e-mail, no name", async (app) => {
  app.env.SUPERUSER_EMAILS = "john@eikon.mt";
  const w = await world(app);
  const n0 = app.DB.db.prepare("SELECT COUNT(*) AS c FROM users").get().c;
  const tries = [
    [{ email: "a@example.com", full_name: "A", role: "superuser" }, 400],
    [{ email: "a@example.com", full_name: "A", role: "user" }, 400],
    [{ email: "a@example.com", full_name: "A", role: "admin" }, 403],
    [{ email: "JOHN@eikon.mt", full_name: "John", role: "staff" }, 403],
    [{ email: "staff@example.com", full_name: "Dup", role: "staff" }, 409],
    [{ email: "stranger@example.com", full_name: "Dup other group", role: "staff" }, 409],
    [{ email: "not-an-email", full_name: "A" }, 400],
    [{ email: "b@example.com", full_name: "  " }, 400]
  ];
  for (const [body, st] of tries) eq((await app.api("POST", "/team/users", { token: w.A.token, body })).status, st, JSON.stringify(body));
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM users").get().c, n0, "no user created by a refused call");
  // The body cannot choose the pharmacy.
  const c = await app.api("POST", "/team/users", { token: w.A.token, body: { email: "c@example.com", full_name: "C", org_id: 2, location_id: 50, default_location_id: 50 } });
  eq(c.status, 200);
  const row = app.DB.db.prepare("SELECT org_id, default_location_id, role FROM users WHERE email = 'c@example.com'").get();
  eq([row.org_id, row.default_location_id, row.role], [1, 1, "staff"]);
});

test("team: another pharmacy in the group and another group cannot list, create into, reset or switch off A's people", async (app) => {
  const w = await world(app);
  const sid = w.staff.user.id;
  await app.api("GET", "/team/users", { token: w.A.token }); // the column exists before the snapshot
  const before = usersRow(app, sid);
  for (const who of [w.branch, w.stranger]) {
    const l = await app.api("GET", "/team/users", { token: who.token });
    eq(l.status, 200);
    ok(!l.json.users.some((u) => u.id === sid || u.email === "admin@example.com"), "A's people not listed");
    eq((await app.api("POST", "/team/users/" + sid + "/password", { token: who.token })).status, 404);
    eq((await app.api("POST", "/team/users/" + sid + "/active", { token: who.token, body: { active: false } })).status, 404);
    eq((await app.api("POST", "/team/users/" + sid + "/role", { token: who.token, body: { role: "staff" } })).status, 404);
    eq((await app.api("POST", "/team/users/" + w.A.user.id + "/active", { token: who.token, body: { active: false } })).status, 404);
  }
  // A person created by the branch lands in the branch, not in A.
  const c = await app.api("POST", "/team/users", { token: w.branch.token, body: { email: "b1@example.com", full_name: "B One", location_id: 1 } });
  eq(c.status, 200);
  eq(app.DB.db.prepare("SELECT default_location_id FROM users WHERE email = 'b1@example.com'").get().default_location_id, 2);
  eq(usersRow(app, sid), before, "A's staff row unchanged");
  eq(sessionsOf(app, sid), 1, "A's staff still signed in");
  // And A cannot touch the branch's people either.
  eq((await app.api("POST", "/team/users/" + c.json.user.id + "/password", { token: w.A.token })).status, 404);
});

test("team: switch off ends every session at once (next call 401), sign-in refused; switch on lets them in again", async (app) => {
  const w = await world(app);
  const sid = w.staff.user.id;
  const second = await app.api("POST", "/auth/login", { body: { email: "staff@example.com", password: "Passw0rd!" } });
  eq(sessionsOf(app, sid), 2);
  eq((await app.api("POST", "/team/users/" + sid + "/active", { token: w.A.token, body: { active: false } })).status, 200);
  eq(sessionsOf(app, sid), 0);
  eq((await app.api("GET", "/auth/me", { token: w.staff.token })).status, 401);
  eq((await app.api("GET", "/today", { token: second.json.token })).status, 401);
  eq((await app.api("POST", "/auth/login", { body: { email: "staff@example.com", password: "Passw0rd!" } })).status, 401);
  eq((await app.api("POST", "/team/users/" + sid + "/active", { token: w.A.token, body: { active: true } })).status, 200);
  eq((await app.api("POST", "/auth/login", { body: { email: "staff@example.com", password: "Passw0rd!" } })).status, 200);
  eq((await app.api("POST", "/team/users/" + sid + "/active", { token: w.A.token, body: { active: "no" } })).status, 400);
});

test("team: reset gives a new temporary password once, ends their sessions, old password stops working, must change", async (app) => {
  const w = await world(app);
  const sid = w.staff.user.id;
  const r = await app.api("POST", "/team/users/" + sid + "/password", { token: w.A.token });
  eq(r.status, 200);
  eq((await app.api("GET", "/auth/me", { token: w.staff.token })).status, 401);
  eq((await app.api("POST", "/auth/login", { body: { email: "staff@example.com", password: "Passw0rd!" } })).status, 401);
  const L = await app.api("POST", "/auth/login", { body: { email: "staff@example.com", password: r.json.temporary_password } });
  eq(L.status, 200); eq(L.json.must_change, true);
});

test("team: an admin cannot change their own sign-in, another admin (default), or a superuser's", async (app) => {
  app.env.SUPERUSER_EMAILS = "john@eikon.mt";
  const w = await world(app);
  const other = await app.addUser({ orgId: 1, locationId: 1, email: "admin2@example.com", name: "Second Admin", role: "admin" });
  const su = await app.addUser({ orgId: 1, locationId: 1, email: "john@eikon.mt", name: "John", role: "admin" });
  const me = w.A.user.id;
  for (const [p, b] of [["password", undefined], ["active", { active: false }], ["role", { role: "staff" }]]) {
    eq((await app.api("POST", "/team/users/" + me + "/" + p, { token: w.A.token, body: b })).status, 403, "self " + p);
    eq((await app.api("POST", "/team/users/" + other.user.id + "/" + p, { token: w.A.token, body: b })).status, 403, "other admin " + p);
    eq((await app.api("POST", "/team/users/" + su.user.id + "/" + p, { token: w.A.token, body: b })).status, 403, "superuser " + p);
  }
  eq((await app.api("POST", "/team/users/" + w.staff.user.id + "/role", { token: w.A.token, body: { role: "admin" } })).status, 403, "no promotion by default");
  const l = await app.api("GET", "/team/users", { token: w.A.token });
  ok(l.json.users.find((u) => u.email === "john@eikon.mt").protected === true, "superuser shown as protected");
  eq((await app.api("GET", "/auth/me", { token: other.token })).status, 200);
  eq((await app.api("GET", "/auth/me", { token: su.token })).status, 200);
});

test("team: with TEAM_ADMINS_MANAGE_ADMINS=1: add an admin, promote, demote; never the last active admin, never a superuser", async (app) => {
  app.env.SUPERUSER_EMAILS = "john@eikon.mt";
  const w = await world(app, { manageAdmins: true });
  const c = await app.api("POST", "/team/users", { token: w.A.token, body: { email: "adm@example.com", full_name: "Adm", role: "admin" } });
  eq(c.status, 200);
  eq((await app.api("POST", "/team/users/" + w.staff.user.id + "/role", { token: w.A.token, body: { role: "admin" } })).status, 200);
  eq((await app.api("POST", "/team/users/" + w.staff.user.id + "/role", { token: w.A.token, body: { role: "staff" } })).status, 200);
  eq((await app.api("POST", "/team/users", { token: w.A.token, body: { email: "john@eikon.mt", full_name: "J", role: "admin" } })).status, 403);
  // Second admin switches the first admin off: allowed (A remains). Then the last one cannot be removed by anyone here.
  const adm = await app.api("POST", "/auth/login", { body: { email: "adm@example.com", password: c.json.temporary_password } });
  await app.api("POST", "/auth/change-password", { token: adm.json.token, body: { current_password: c.json.temporary_password, new_password: "Adm-own-pass-2026" } });
  eq((await app.api("POST", "/team/users/" + w.A.user.id + "/active", { token: adm.json.token, body: { active: false } })).status, 200);
  eq((await app.api("POST", "/team/users/" + adm.json.user.id + "/active", { token: adm.json.token, body: { active: false } })).status, 403, "own");
  eq((await app.api("POST", "/team/users/" + adm.json.user.id + "/role", { token: adm.json.token, body: { role: "staff" } })).status, 403, "own role");
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM users WHERE default_location_id = 1 AND role = 'admin' AND is_active = 1").get().c, 1);
});

test("team: creates and resets are limited to 10 an hour per admin", async (app) => {
  const w = await world(app);
  let last;
  for (let i = 0; i < 10; i++) { last = await app.api("POST", "/team/users", { token: w.A.token, body: { email: "p" + i + "@example.com", full_name: "P " + i } }); eq(last.status, 200, "create " + i); }
  eq((await app.api("POST", "/team/users", { token: w.A.token, body: { email: "p10@example.com", full_name: "P 10" } })).status, 429);
  eq((await app.api("POST", "/team/users/" + w.staff.user.id + "/password", { token: w.A.token })).status, 429);
  // Another admin's allowance is their own; sign-in throttling is not affected.
  eq((await app.api("POST", "/team/users", { token: w.branch.token, body: { email: "q@example.com", full_name: "Q" } })).status, 200);
  eq((await app.api("POST", "/auth/login", { body: { email: "admin@example.com", password: "Passw0rd!" } })).status, 200);
});

test("team: every action audited in the admin's pharmacy, never with a password or hash", async (app) => {
  const w = await world(app);
  const c = await app.api("POST", "/team/users", { token: w.A.token, body: { email: "aud@example.com", full_name: "Aud" } });
  const id = c.json.user.id;
  const r = await app.api("POST", "/team/users/" + id + "/password", { token: w.A.token });
  await app.api("POST", "/team/users/" + id + "/active", { token: w.A.token, body: { active: false } });
  await app.api("POST", "/team/users/" + id + "/active", { token: w.A.token, body: { active: true } });
  await app.api("POST", "/team/users/" + w.staff.user.id + "/role", { token: w.A.token, body: { role: "staff" } });
  const rows = app.DB.db.prepare("SELECT * FROM audit_log WHERE action LIKE 'TEAM_%' ORDER BY id").all();
  eq(rows.map((x) => x.action), ["TEAM_USER_CREATE", "TEAM_PASSWORD_RESET", "TEAM_USER_OFF", "TEAM_USER_ON", "TEAM_USER_ROLE"]);
  ok(rows.every((x) => x.org_id === 1 && x.location_id === 1 && x.user_id === w.A.user.id), "scoped to the admin");
  const all = JSON.stringify(app.DB.db.prepare("SELECT * FROM audit_log").all());
  const hashes = app.DB.db.prepare("SELECT pass_hash_b64, pass_salt_b64 FROM users WHERE id = ?").get(id);
  for (const secret of [c.json.temporary_password, r.json.temporary_password, hashes.pass_hash_b64, hashes.pass_salt_b64]) ok(!all.includes(secret), "audit holds no secret");
  ok(!/pass_hash|pass_salt|temporary_password/.test(all), "no password keys in audit");
});

test("team: existing sign-ins are untouched: no must_change, same session length, same /auth/me and login answers", async (app) => {
  const w = await world(app);
  // Every account that existed before /team was first used keeps working exactly.
  await app.api("GET", "/team/users", { token: w.A.token }); // adds the column
  const rows = app.DB.db.prepare("SELECT email, must_change_password FROM users").all();
  ok(rows.every((r) => r.must_change_password === 0), "existing rows read 0");
  for (const u of [w.A, w.staff, w.branch, w.stranger]) {
    const me = await app.api("GET", "/auth/me", { token: u.token });
    eq(me.status, 200); ok(!("must_change" in me.json.user), "no flag on " + u.email);
    const L = await app.api("POST", "/auth/login", { body: { email: u.email, password: "Passw0rd!" } });
    eq(L.status, 200); ok(!("must_change" in L.json) && !("must_change" in L.json.user), "login answer unchanged for " + u.email);
    const s = app.DB.db.prepare("SELECT expires_at, created_at FROM sessions WHERE user_id = ? ORDER BY id DESC").get(L.json.user.id);
    const secs = (new Date(s.expires_at) - Date.now()) / 1000;
    ok(secs > 3590 && secs <= 3600, "session length is still SESSION_TTL_SECONDS: " + secs);
  }
  eq((await app.api("GET", "/today", { token: w.staff.token })).status, 200);
});

test("team: /auth/unlock checks the session's own password, no new session; wrong password is 403 and throttled", async (app) => {
  const w = await world(app);
  const n = app.DB.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c;
  eq((await app.api("POST", "/auth/unlock", { token: w.staff.token, body: { password: "Passw0rd!" } })).status, 200);
  eq(app.DB.db.prepare("SELECT COUNT(*) AS c FROM sessions").get().c, n, "no new session");
  eq((await app.api("POST", "/auth/unlock", { token: w.staff.token, body: { password: "wrong" } })).status, 403);
  eq((await app.api("GET", "/auth/me", { token: w.staff.token })).status, 200, "a wrong unlock does not end the session");
  for (let i = 0; i < 10; i++) await app.api("POST", "/auth/unlock", { token: w.staff.token, body: { password: "wrong" } });
  eq((await app.api("POST", "/auth/unlock", { token: w.staff.token, body: { password: "Passw0rd!" } })).status, 429);
  eq((await app.api("POST", "/auth/unlock", { body: { password: "Passw0rd!" } })).status, 401, "needs a session");
});

test("team: Today tells the admin (only) how many people sign in here and whether opening hours were saved", async (app) => {
  const w = await world(app);
  const a = await app.api("GET", "/today", { token: w.A.token });
  eq(a.status, 200); eq(a.json.setup, { sign_ins: 2, opening_hours_saved: false });
  ok(!("setup" in (await app.api("GET", "/today", { token: w.staff.token })).json), "staff get no setup block");
  eq((await app.api("PUT", "/shifts/opening-hours", { token: w.A.token, body: { default: { open: "08:00", close: "19:00", closed: false }, openSaturday: true, openSunday: false, overrides: {} } })).status, 200);
  eq((await app.api("GET", "/today", { token: w.A.token })).json.setup, { sign_ins: 2, opening_hours_saved: true });
  eq((await app.api("GET", "/today", { token: w.branch.token })).json.setup, { sign_ins: 1, opening_hours_saved: false });
});
