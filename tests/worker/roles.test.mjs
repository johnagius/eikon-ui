// Roles (finish round, W3/W4/W15/W30): admin, pharmacist (staff + is_pharmacist), staff; the rota right (plans_rota:
// NULL for accounts made before the release = today's access, 0 for sign-ins added after it); rota people linked to
// sign-ins (shift_staff.user_id). One test per action and per role. A = org 1 / location 1; Branch = org 1 / location 2.
import { test, eq, ok } from "./lib.mjs";

const PW = "Passw0rd!";
async function addViaTeam(app, adminTok, email, role, name) {
  const c = await app.api("POST", "/team/users", { token: adminTok, body: { email, full_name: name || email.split("@")[0], role } });
  eq(c.status, 200, c.text);
  const L = await app.api("POST", "/auth/login", { body: { email, password: c.json.temporary_password } });
  await app.api("POST", "/auth/change-password", { token: L.json.token, body: { current_password: c.json.temporary_password, new_password: "Own-pass-2026!" } });
  return { token: L.json.token, user: L.json.user };
}
async function world(app) {
  const A = await app.bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  app.DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  // "old" = made before this release (direct insert, plans_rota NULL); "new" = added on People who sign in after it.
  const oldStaff = await app.addUser({ orgId: 1, locationId: 1, email: "karl@example.com", name: "Karl Borg", role: "staff" });
  const legacy = await app.addUser({ orgId: 1, locationId: 1, email: "legacy@example.com", name: "Legacy User", role: "user" });
  const newStaff = await addViaTeam(app, A.token, "rita@example.com", "staff", "Rita Grech");
  const pharm = await addViaTeam(app, A.token, "daniel@example.com", "pharmacist", "Daniel Saliba");
  const st = async (full_name, email) => (await app.api("POST", "/shifts/staff", { token: A.token, body: { full_name, designation: "assistant", employment_type: "fulltime", contracted_hours: 40, email: email || "", phone: "", registration_number: "", patterns_json: "[]" } })).json.staff_id;
  const s = { rita: await st("Rita Grech"), karl: await st("Karl Borg", "karl@example.com"), daniel: await st("Daniel Saliba"), maria: await st("Maria Borg") };
  const link = (sid, uid) => app.api("POST", "/shifts/staff/" + sid + "/link", { token: A.token, body: { user_id: uid } });
  eq((await link(s.rita, newStaff.user.id)).status, 200);
  eq((await link(s.daniel, pharm.user.id)).status, 200);
  return { A, branch, oldStaff, legacy, newStaff, pharm, s };
}
const shift = (app, tok, staff_id, d) => app.api("POST", "/shifts/assignments", { token: tok, body: { staff_id, shift_date: d || "2026-12-02", start_time: "08:00", end_time: "14:00", notes: "" } });
const leave = (app, tok, staff_id) => app.api("POST", "/shifts/leaves", { token: tok, body: { staff_id, leave_type: "annual", start_date: "2026-12-07", end_date: "2026-12-08", hours_requested: 16, reason: "" } });
const answer = (app, tok, id, what) => app.api("POST", "/shifts/leaves/" + id + "/" + (what || "approve"), { token: tok });
const row = (app, sql, ...a) => app.DB.db.prepare(sql).get(...a);

test("roles: Add a person offers staff, pharmacist and admin; stored role stays staff/admin; new sign-ins do not plan the rota", async (app) => {
  const w = await world(app);
  const r = row(app, "SELECT role, is_pharmacist, plans_rota FROM users WHERE email = 'daniel@example.com'");
  eq([r.role, r.is_pharmacist, r.plans_rota], ["staff", 1, 0]);
  const s = row(app, "SELECT role, is_pharmacist, plans_rota FROM users WHERE email = 'rita@example.com'");
  eq([s.role, s.is_pharmacist, s.plans_rota], ["staff", 0, 0]);
  const old = row(app, "SELECT role, is_pharmacist, plans_rota FROM users WHERE email = 'karl@example.com'");
  eq([old.role, old.is_pharmacist, old.plans_rota], ["staff", 0, null], "an existing account is not rewritten");
  const l = await app.api("GET", "/team/users", { token: w.A.token });
  const by = Object.fromEntries(l.json.users.map((u) => [u.email, u]));
  eq([by["daniel@example.com"].role_word, by["rita@example.com"].role_word, by["admin@example.com"].role_word, by["karl@example.com"].role_word, by["legacy@example.com"].role_word], ["Pharmacist", "Staff", "Admin", "Staff", "Limited"]);
  eq([by["karl@example.com"].plans_rota, by["rita@example.com"].plans_rota, by["admin@example.com"].plans_rota], [true, false, true]);
  eq((await app.api("GET", "/team/me", { token: w.pharm.token })).json.role_word, "Pharmacist");
  eq((await app.api("GET", "/team/me", { token: w.A.token })).json.pic, true);
  eq((await app.api("GET", "/team/me", { token: w.newStaff.token })).json.plans_rota, false);
  eq((await app.api("GET", "/team/me", { token: w.oldStaff.token })).json.plans_rota, true);
  eq((await app.api("GET", "/team/me", { token: w.newStaff.token })).json.admins, ["Maria Borg"], "who to ask: the pharmacy's admins by name");
});

test("roles: a second admin can be added, signs in and does admin things; cannot change the first admin; the last admin stays", async (app) => {
  const w = await world(app);
  const B = await addViaTeam(app, w.A.token, "second@example.com", "admin", "Second Admin");
  eq(row(app, "SELECT role FROM users WHERE email = 'second@example.com'").role, "admin");
  eq((await app.api("GET", "/team/users", { token: B.token })).status, 200);
  eq((await app.api("POST", "/team/users", { token: B.token, body: { email: "x@example.com", full_name: "X Person", role: "staff" } })).status, 200);
  eq((await app.api("GET", "/audit/log?limit=5", { token: B.token })).status, 200);
  for (const [p, b] of [["password", undefined], ["active", { active: false }], ["role", { role: "staff" }], ["rights", { is_pharmacist: true }]])
    eq((await app.api("POST", "/team/users/" + w.A.user.id + "/" + p, { token: B.token, body: b })).status, 403, "second admin cannot change the first: " + p);
  // A staff sign-in (pharmacist or not) can never reach People who sign in.
  for (const t of [w.pharm.token, w.newStaff.token, w.oldStaff.token]) eq((await app.api("POST", "/team/users", { token: t, body: { email: "y@example.com", full_name: "Y", role: "admin" } })).status, 403);
  // With the support flag: still never the last active admin.
  app.env.TEAM_ADMINS_MANAGE_ADMINS = "1";
  eq((await app.api("POST", "/team/users/" + B.user.id + "/active", { token: w.A.token, body: { active: false } })).status, 200);
  eq((await app.api("POST", "/team/users/" + w.A.user.id + "/role", { token: B.token, body: { role: "staff" } })).status, 401, "B is signed out");
  eq(row(app, "SELECT COUNT(*) AS c FROM users WHERE default_location_id = 1 AND role = 'admin' AND is_active = 1").c, 1);
});

test("roles: role and rights changes: pharmacist ⇄ staff, plans the rota on/off, audited; admins always plan", async (app) => {
  const w = await world(app);
  const id = w.newStaff.user.id;
  eq((await app.api("POST", "/team/users/" + id + "/role", { token: w.A.token, body: { role: "pharmacist" } })).status, 200);
  eq(row(app, "SELECT role, is_pharmacist FROM users WHERE id = ?", id), { role: "staff", is_pharmacist: 1 });
  eq((await app.api("POST", "/team/users/" + id + "/role", { token: w.A.token, body: { role: "staff", is_pharmacist: false } })).status, 200);
  eq(row(app, "SELECT role, is_pharmacist FROM users WHERE id = ?", id), { role: "staff", is_pharmacist: 0 });
  eq((await app.api("POST", "/team/users/" + id + "/rights", { token: w.A.token, body: { plans_rota: true } })).status, 200);
  eq(row(app, "SELECT plans_rota FROM users WHERE id = ?", id).plans_rota, 1);
  eq((await app.api("POST", "/team/users/" + id + "/rights", { token: w.A.token, body: { plans_rota: "yes" } })).status, 400);
  eq((await app.api("POST", "/team/users/" + id + "/rights", { token: w.A.token, body: {} })).status, 400);
  const B = await addViaTeam(app, w.A.token, "second@example.com", "admin");
  app.env.TEAM_ADMINS_MANAGE_ADMINS = "1";
  eq((await app.api("POST", "/team/users/" + B.user.id + "/rights", { token: w.A.token, body: { plans_rota: false } })).status, 400, "an admin always plans");
  const a = app.DB.db.prepare("SELECT details_json FROM audit_log WHERE action = 'TEAM_USER_RIGHTS'").all();
  ok(a.length === 1 && JSON.parse(a[0].details_json).after.plans_rota === 1, "rights change audited with before/after");
  // Session survives a role change (nothing about the session is touched).
  eq((await app.api("GET", "/auth/me", { token: w.newStaff.token })).status, 200);
});

test("roles: pharmacist = staff rights + month sign-off + who read the handover; staff cannot sign off", async (app) => {
  const w = await world(app);
  for (const p of ["/today", "/temperature/devices", "/team/today", "/registers/last-inspection"]) {
    const a = (await app.api("GET", p, { token: w.newStaff.token })).status, b = (await app.api("GET", p, { token: w.pharm.token })).status;
    eq(b, a, "pharmacist answers like staff on " + p);
  }
  const prev = (() => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
  const so = (t) => app.api("POST", "/registers/signoffs", { token: t, body: { register: "temperature", month: prev } });
  eq((await so(w.newStaff.token)).status, 403, "staff cannot sign off");
  eq((await so(w.oldStaff.token)).status, 403, "existing staff cannot sign off (as today)");
  const ph = await so(w.pharm.token);
  eq(ph.status, 200, ph.text);
  eq(row(app, "SELECT signed_by, location_id FROM register_signoffs WHERE month = ?", prev), { signed_by: w.pharm.user.id, location_id: 1 }, "signed in the pharmacist's own name and pharmacy");
  const ymd = new Date().toISOString().slice(0, 10);
  for (const t of [w.A.token, w.newStaff.token]) await app.api("POST", "/instructions/daily/seen", { token: t, body: { ymd } });
  eq((await app.api("GET", "/instructions/daily/seen?ymd=" + ymd, { token: w.pharm.token })).json.seen.length, 2, "pharmacist sees who read it");
  eq((await app.api("GET", "/instructions/daily/seen?ymd=" + ymd, { token: w.newStaff.token })).json.seen.length, 1, "staff see only their own line");
});

test("roles: leave — anyone asks; nobody but an admin answers their own; new staff and pharmacists cannot answer; existing staff answer others' (Q1-A)", async (app) => {
  const w = await world(app);
  const mk = async (tok, sid) => { const r = await leave(app, tok, sid); eq(r.status, 200, r.text); return r.json.leave_id; };
  // Rita (new staff, linked) asks for her own leave: she cannot answer it; neither can Daniel (pharmacist, no rota right).
  const ritas = await mk(w.newStaff.token, w.s.rita);
  eq((await answer(app, w.newStaff.token, ritas)).status, 403);
  eq((await answer(app, w.newStaff.token, ritas, "reject")).status, 403);
  eq((await answer(app, w.pharm.token, ritas)).status, 403);
  eq(row(app, "SELECT status FROM shift_leaves WHERE id = ?", ritas).status, "pending", "nothing changed by a refusal");
  // Karl (existing staff: plans the rota, as today) answers Rita's — but not his own: by link, by e-mail, by having asked.
  eq((await answer(app, w.oldStaff.token, ritas)).status, 200);
  const karlsByEmail = await mk(w.A.token, w.s.karl); // his rota row carries his e-mail, not linked
  eq((await answer(app, w.oldStaff.token, karlsByEmail)).status, 403, "own by e-mail");
  const askedForMaria = await mk(w.oldStaff.token, w.s.maria); // he asked for someone else: he still cannot answer it
  eq((await answer(app, w.oldStaff.token, askedForMaria)).status, 403, "own by created_by");
  eq((await app.api("POST", "/shifts/staff/" + w.s.karl + "/link", { token: w.A.token, body: { user_id: w.oldStaff.user.id } })).status, 200);
  const karlsLinked = await mk(w.A.token, w.s.karl);
  eq((await answer(app, w.oldStaff.token, karlsLinked, "reject")).status, 403, "own by link");
  // The admin answers anyone's, their own included (Q2-A).
  const marias = await mk(w.A.token, w.s.maria);
  eq((await app.api("POST", "/shifts/staff/" + w.s.maria + "/link", { token: w.A.token, body: { user_id: w.A.user.id } })).status, 200);
  eq((await answer(app, w.A.token, marias)).status, 200);
  for (const id of [karlsByEmail, askedForMaria, karlsLinked]) eq((await answer(app, w.A.token, id)).status, 200);
});

test("roles: shifts — without the rota right: no shift writes at all (own included), no fills, rota people or rules; own details and the calendar link yes; with it: as today", async (app) => {
  const w = await world(app);
  const T = w.newStaff.token, s = w.s;
  const n0 = row(app, "SELECT COUNT(*) AS c FROM shift_assignments").c;
  eq((await shift(app, T, s.rita)).status, 403, "not even their own: they ask");
  eq((await shift(app, T, s.maria)).status, 403);
  const mine = await shift(app, w.A.token, s.rita), other = await shift(app, w.A.token, s.maria);
  const snap = () => JSON.stringify(app.DB.db.prepare("SELECT * FROM shift_assignments ORDER BY id").all());
  const before = snap();
  for (const id of [mine.json.shift_id, other.json.shift_id]) {
    eq((await app.api("PUT", "/shifts/assignments/" + id, { token: T, body: { start_time: "06:00", end_time: "07:00", role_override: "", notes: "" } })).status, 403);
    eq((await app.api("DELETE", "/shifts/assignments/" + id, { token: T })).status, 403);
  }
  eq((await app.api("POST", "/shifts/apply-plan", { token: T, body: { items: [{ staff_id: s.rita, from: "2026-12-01", to: "2026-12-07" }] } })).status, 403);
  eq((await app.api("POST", "/shifts/apply-pattern", { token: T, body: { staff_id: s.rita, start_date: "2026-12-01", end_date: "2026-12-07" } })).status, 403);
  eq(snap(), before, "every shift row unchanged");
  eq(row(app, "SELECT COUNT(*) AS c FROM shift_assignments").c, n0 + 2);
  eq((await app.api("POST", "/shifts/staff", { token: T, body: { full_name: "New Person" } })).status, 403);
  eq((await app.api("DELETE", "/shifts/staff/" + s.maria, { token: T })).status, 403);
  eq((await app.api("PUT", "/shifts/staff/" + s.maria, { token: T, body: { full_name: "Maria Changed" } })).status, 403);
  eq((await app.api("PUT", "/shifts/staff/" + s.rita, { token: T, body: { full_name: "Rita Grech", designation: "assistant", employment_type: "fulltime", contracted_hours: 30, email: "", phone: "", registration_number: "", patterns_json: "[]" } })).status, 200, "own details (usual week, availability)");
  eq((await leave(app, T, s.rita)).status, 200, "asking for leave is open to everyone");
  // rules: refused; turning the calendar link on (only calendarToken differs): allowed
  const cur = (await app.api("GET", "/shifts/settings", { token: T })).json.settings;
  eq((await app.api("PUT", "/shifts/settings", { token: T, body: Object.assign({}, cur, { minPharmacists: 3 }) })).status, 403);
  eq((await app.api("PUT", "/shifts/settings", { token: T, body: Object.assign({}, cur, { calendarToken: "abcdefghijklmnop2345" }) })).status, 200);
  // Pharmacist without the rota right: the same refusals. Existing staff, the legacy account, the admin: today's access.
  eq((await shift(app, w.pharm.token, s.daniel)).status, 403);
  for (const t of [w.oldStaff.token, w.legacy.token, w.A.token]) {
    const r = await shift(app, t, s.maria, "2026-12-09"); eq(r.status, 200, r.text);
    eq((await app.api("PUT", "/shifts/assignments/" + r.json.shift_id, { token: t, body: { start_time: "09:00", end_time: "13:00", role_override: "", notes: "" } })).status, 200);
    eq((await app.api("DELETE", "/shifts/assignments/" + r.json.shift_id, { token: t })).status, 200);
  }
  eq((await app.api("PUT", "/shifts/settings", { token: w.oldStaff.token, body: Object.assign({}, cur, { minPharmacists: 2 }) })).status, 200);
  eq((await app.api("POST", "/shifts/staff", { token: w.oldStaff.token, body: { full_name: "Added By Karl" } })).status, 200);
  // Given the rota right, Rita plans the rota.
  await app.api("POST", "/team/users/" + w.newStaff.user.id + "/rights", { token: w.A.token, body: { plans_rota: true } });
  eq((await shift(app, T, s.maria, "2026-12-10")).status, 200);
});

test("roles: a pharmacist gets 403 on every admin-only route family (only sign-off and handover readers are added)", async (app) => {
  const w = await world(app);
  const P = w.pharm.token;
  const tries = [["GET", "/team/users"], ["POST", "/team/users", { email: "z@example.com", full_name: "Z", role: "staff" }], ["POST", "/team/users/" + w.newStaff.user.id + "/password"],
    ["GET", "/audit/log?limit=5"], ["GET", "/owner/summary"], ["POST", "/temperature/devices", { name: "X", device_type: "fridge" }], ["POST", "/bookings/settings", {}],
    ["POST", "/appointments/doctors", { name: "Dr X" }], ["POST", "/shifts/staff/" + w.s.maria + "/link", { user_id: w.pharm.user.id }], ["POST", "/shifts/leaves/1/approve"]];
  for (const [m, p, b] of tries) {
    const r = await app.api(m, p, { token: P, body: b });
    ok(r.status === 403 || r.status === 404, m + " " + p + " → " + r.status);
    const st = (await app.api(m, p, { token: w.newStaff.token, body: b })).status;
    eq(r.status, st, "pharmacist answers like staff on " + m + " " + p);
  }
});

test("roles: rota people linked to sign-ins — admin only, same pharmacy only, one row per sign-in, list shows the link and me", async (app) => {
  const w = await world(app);
  const L = (tok, sid, uid) => app.api("POST", "/shifts/staff/" + sid + "/link", { token: tok, body: { user_id: uid } });
  eq((await L(w.oldStaff.token, w.s.maria, w.oldStaff.user.id)).status, 403, "staff cannot link");
  eq((await L(w.A.token, w.s.maria, w.branch.user.id)).status, 404, "a sign-in at another pharmacy");
  eq((await L(w.branch.token, w.s.maria, w.branch.user.id)).status, 404, "another pharmacy's admin cannot reach A's rota");
  eq((await L(w.A.token, w.s.maria, "x")).status, 400);
  // Linking Rita's sign-in to Maria's row moves it (Rita's old row is unlinked); nothing else on the rows changes.
  const before = JSON.stringify(app.DB.db.prepare("SELECT id, full_name, email, designation FROM shift_staff ORDER BY id").all());
  eq((await L(w.A.token, w.s.maria, w.newStaff.user.id)).status, 200);
  eq(row(app, "SELECT user_id FROM shift_staff WHERE id = ?", w.s.rita).user_id, null);
  eq(JSON.stringify(app.DB.db.prepare("SELECT id, full_name, email, designation FROM shift_staff ORDER BY id").all()), before, "link only: names, e-mails, roles untouched");
  eq((await L(w.A.token, w.s.maria, null)).status, 200);
  eq((await L(w.A.token, w.s.rita, w.newStaff.user.id)).status, 200);
  const g = await app.api("GET", "/shifts/staff?include_inactive=1", { token: w.newStaff.token });
  eq(g.json.me_staff_id, w.s.rita); eq(g.json.can_plan, false);
  eq(g.json.staff.find((p) => p.id === w.s.rita).user_id, w.newStaff.user.id);
  const k = await app.api("GET", "/shifts/staff", { token: w.oldStaff.token });
  eq([k.json.me_staff_id, k.json.can_plan], [w.s.karl, true], "matched by e-mail when not linked");
  ok(app.DB.db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'SHIFT_STAFF_LINK'").get().c >= 5);
});
