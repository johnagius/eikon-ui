// Today's team (team-hub, T-C1): GET /team/today answers, in one bounded read, who is on today, who is away, the
// pharmacist in charge from the locum register, the opening hours and rota settings (the cover rule is E.teamCover's), the handover left for today,
// this person's unread @mentions (a group's private message never reaches another group) and, for the pharmacist only,
// leave requests waiting. Nothing is added to /today. Read only, this pharmacy only, admin and staff.
import { test, eq, ok } from "./lib.mjs";

const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const plus = (ymd, n) => { const [y, m, d] = ymd.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };

function counter(DB) {
  const c = { stmts: 0, rows: 0, sql: [] };
  const orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    const st = orig(sql), s = String(sql);
    if (/^\s*(CREATE|ALTER|PRAGMA|INSERT|UPDATE|DELETE)\b/i.test(s)) return st;
    c.stmts++; c.sql.push(s.replace(/\s+/g, " ").slice(0, 90));
    const wrap = (o) => {
      const all = o.all && o.all.bind(o), first = o.first && o.first.bind(o), bind = o.bind && o.bind.bind(o);
      if (all) o.all = async (...a) => { const r = await all(...a); c.rows += (r.results || []).length; return r; };
      if (first) o.first = async (...a) => { const r = await first(...a); if (r) c.rows++; return r; };
      if (bind) o.bind = (...a) => wrap(bind(...a));
      return o;
    };
    return wrap(st);
  };
  return c;
}
// The board's tables are made once per worker (a module flag), and each test gets a fresh database: make them here
// with the board's own columns so the mentions can be read whichever test ran first.
function boardTables(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS board_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', org_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'all',
    is_pinned INTEGER NOT NULL DEFAULT 0, pinned_at TEXT, pinned_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, mentioned_user_id INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_user_state (user_id INTEGER PRIMARY KEY, last_read_id INTEGER NOT NULL DEFAULT 0);`);
}

async function seed(api, token, today) {
  const staff = async (full_name, designation) => { const r = await api("POST", "/shifts/staff", { token, body: { full_name, designation, employment_type: "fulltime", contracted_hours: 40, phone: designation === "pharmacist" ? "79123456" : "" } }); eq(r.status, 200, r.text); return r.json.staff_id || r.json.id; };
  const ph = await staff("Ċensina Żammit", "pharmacist"), as = await staff("Ġorġ Borg", "assistant"), lo = await staff("Ħelena Vella", "locum"), off = await staff("Marija Pace", "pharmacist");
  const shift = async (staff_id, shift_date, start_time, end_time) => eq((await api("POST", "/shifts/assignments", { token, body: { staff_id, shift_date, start_time, end_time, notes: "" } })).status, 200);
  await shift(ph, today, "08:00", "13:00");
  await shift(as, today, "08:00", "20:00");
  await shift(lo, today, "15:00", "20:00");
  await shift(off, today, "13:00", "15:00"); // on approved leave today: does not cover
  await shift(ph, plus(today, 1), "08:00", "20:00"); // tomorrow: not today
  const lv = await api("POST", "/shifts/leaves", { token, body: { staff_id: off, leave_type: "sick", start_date: plus(today, -1), end_date: plus(today, 1), reason: "" } });
  eq((await api("POST", "/shifts/leaves/" + lv.json.leave_id + "/approve", { token, body: {} })).status, 200);
  await api("POST", "/shifts/leaves", { token, body: { staff_id: as, leave_type: "annual", start_date: plus(today, 10), end_date: plus(today, 11), reason: "Festa" } }); // waiting
  // the opening hours for today, as the Shifts screen saves an override (today may be a holiday or a Sunday)
  eq((await api("PUT", "/shifts/opening-hours", { token, body: { default: { open: "07:30", close: "19:30", closed: false }, weekly: {}, overrides: { [today]: { open: "08:00", close: "20:00", closed: false, note: "" } } } })).status, 200);
  // the pharmacist in charge, as the locum register saves it
  eq((await api("POST", "/locumregister/entries", { token, body: { entry_date: today, time_in: "08:00", time_out: "13:00", locum_full_name: "Ċensina Żammit", registration_number: "1234" } })).status < 300, true);
  // the handover: two days ago left points (yesterday nothing); an older day is not read
  const day = async (ymd, handover_out) => eq((await api("PUT", "/instructions/daily", { token, body: { ymd, notes: "", handover_out } })).status, 200);
  await day(plus(today, -6), [{ id: "o", sev: "r", text: "Too old" }]);
  await day(plus(today, -2), [{ id: "a", sev: "g", text: "Order more cotton wool" }, { id: "b", sev: "r", text: "Fridge door does not close — call the technician" }, { id: "c", sev: "y", text: "Mrs Abela's order is in" }]);
  await day(today, [{ id: "t", sev: "r", text: "Left for tomorrow, not for today" }]);
}

test("team today: one read says who is on, who is away, the pharmacist in charge, the handover and the board", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday();
  boardTables(DB.db);
  const first = await api("GET", "/team/today", { token }); // makes the tables, nothing in them yet
  eq(first.status, 200, first.text);
  const j0 = first.json;
  eq(j0.ok, true); eq(j0.date, today); ok(/^\d\d:\d\d$/.test(j0.now), j0.now);
  eq(j0.shifts.length, 0); eq(j0.leave.length, 0); eq(j0.locum_today.length, 0);
  eq(j0.handover.total, 0); eq(j0.handover.from_ymd, null); eq(j0.handover.seen_by_me, null);
  eq(j0.board.unread_mentions, 0); eq(j0.board.unread_messages, 0); eq(j0.leave_pending, 0);
  eq(JSON.stringify(j0.settings), JSON.stringify({ pharmacistRequired: true, minPharmacists: 1 }), "nothing saved: the rota's defaults");

  await seed(api, token, today);
  // a group-only message and a public one naming this pharmacy, from a pharmacy in another group, and one read already
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Sliema')").run();
  const other = await addUser({ orgId: 2, locationId: 50, email: "other@example.com", name: "Other Admin" });
  const myId = DB.db.prepare("SELECT id FROM users WHERE email = 'admin@example.com'").get().id;
  const msg = DB.db.prepare("INSERT INTO board_messages (org_id, location_id, user_id, user_name, location_name, body, scope) VALUES (?, ?, ?, ?, ?, ?, ?)");
  const men = DB.db.prepare("INSERT INTO board_mentions (message_id, mentioned_user_id, is_read) VALUES (?, ?, ?)");
  men.run(Number(msg.run(2, 50, 9, "Other Admin", "Sliema", "Their group's private note @Demo", "org").lastInsertRowid), myId, 0); // another group's private message: never shown here
  men.run(Number(msg.run(2, 50, 9, "Other Admin", "Sliema", "Public: anyone have Ozempic 1mg? @Demo", "all").lastInsertRowid), myId, 0);
  men.run(Number(msg.run(1, 1, 9, "Maria Borg", "Demo Pharmacy", "Group only: staff meeting at 2 @Demo", "org").lastInsertRowid), myId, 0);
  men.run(Number(msg.run(1, 1, 9, "Maria Borg", "Demo Pharmacy", "Already read @Demo", "all").lastInsertRowid), myId, 1);
  ok(other.token, "another group signed in");

  const n = counter(DB);
  const r = await api("GET", "/team/today", { token });
  eq(r.status, 200, r.text);
  const own = n.sql.filter((q) => !/FROM (sessions|locations|orgs|users) |^SELECT s\.id AS session_id/.test(q));
  ok(own.length <= 8, "at most 8 statements of its own, one request: " + own.length + " " + JSON.stringify(own));
  ok(n.rows <= 20, "a handful of rows returned: " + n.rows);
  const j = r.json;
  // who is on today, in start order, with role and phone; tomorrow's shift left out
  eq(j.shifts.map((p) => p.full_name).join(), "Ċensina Żammit,Ġorġ Borg,Marija Pace,Ħelena Vella");
  eq(j.shifts[0].designation, "pharmacist"); eq(j.shifts[3].designation, "locum"); eq(j.shifts[0].start_time, "08:00"); eq(j.shifts[0].end_time, "13:00"); eq(j.shifts[0].phone, "79123456");
  // approved leave covering today (the pending one is not)
  eq(j.leave.length, 1); eq(j.leave[0].full_name, "Marija Pace"); eq(j.leave[0].leave_type, "sick"); eq(j.leave[0].end_date, plus(today, 1));
  // opening hours: today's override, flagged (a holiday stays closed only when there is none: E.teamCover)
  eq(JSON.stringify(j.hours), JSON.stringify({ open: "08:00", close: "20:00", closed: false, override: true }));
  // the pharmacist in charge
  eq(j.locum_today.length, 1); eq(j.locum_today[0].locum_full_name, "Ċensina Żammit"); eq(j.locum_today[0].registration_number, "1234"); eq(j.locum_today[0].time_in, "08:00");
  // the handover: the last day before today with points (two days ago); today's own points are for tomorrow
  eq(j.handover.ids.join(), "a,b,c", "the points' ids, as stored"); eq(j.handover.from_ymd, plus(today, -2)); eq(j.handover.total, 3); eq(j.handover.critical, 1); eq(j.handover.medium, 1);
  eq(j.handover.seen_by_me, null, "no 'I've read it' table: unknown, and nothing made here");
  ok(!DB.db.prepare("SELECT name FROM sqlite_master WHERE name = 'handover_seen'").get(), "the table was not created");
  // board: unread mentions, everyone's and this group's own; another group's private message never, counted or shown
  eq(j.board.unread_mentions, 2, JSON.stringify(j.board));
  eq(j.board.unread_messages, 3, "the messages this person can see (two for everyone, one for this group), not the other group's private one");
  ok(!JSON.stringify(j.board).includes("Their group's private"), "another group's private message is not shown");
  eq(j.board.mentions[0].body, "Group only: staff meeting at 2 @Demo"); eq(j.board.mentions[0].group_only, true);
  // the same counts as the board's own summary
  const dash = (await api("GET", "/board/dashboard", { token })).json;
  eq(dash.unread_mentions, j.board.unread_mentions); eq(dash.unread_messages, j.board.unread_messages);
  // leave waiting for an answer (the pharmacist only)
  eq(j.leave_pending, 1);

  // read only: nothing written; /today is not touched
  eq(DB.db.prepare("SELECT COUNT(*) AS c FROM board_mentions WHERE is_read = 0").get().c, 3, "mentions stay unread");
  const t = (await api("GET", "/today", { token })).json;
  eq(t.team_today, undefined, "/today carries nothing new");

  // the handover's "I've read it" table (T-C3, made by the handover's own routes): not read yet, then read
  DB.db.exec("CREATE TABLE handover_seen (org_id INTEGER NOT NULL, location_id INTEGER NOT NULL, ymd TEXT NOT NULL, user_id INTEGER NOT NULL, user_name TEXT, seen_at TEXT, PRIMARY KEY (org_id, location_id, ymd, user_id))");
  eq((await api("GET", "/team/today", { token })).json.handover.seen_by_me, false);
  DB.db.prepare("INSERT INTO handover_seen (org_id, location_id, ymd, user_id, user_name, seen_at) VALUES (1, 1, ?, ?, 'Maria Borg', datetime('now'))").run(plus(today, -2), myId);
  eq((await api("GET", "/team/today", { token })).json.handover.seen_by_me, true);

  // the rota's settings as saved; a closed override
  eq((await api("PUT", "/shifts/settings", { token, body: { pharmacistRequired: false, minPharmacists: 2 } })).status, 200);
  eq(JSON.stringify((await api("GET", "/team/today", { token })).json.settings), JSON.stringify({ pharmacistRequired: false, minPharmacists: 2 }));
  eq((await api("PUT", "/shifts/opening-hours", { token, body: { overrides: { [today]: { closed: true } } } })).status, 200);
  eq((await api("GET", "/team/today", { token })).json.hours.closed, true);
  // no override: the weekly hours for today's weekday
  const dow = new Date(today + "T12:00:00Z").getUTCDay();
  eq((await api("PUT", "/shifts/opening-hours", { token, body: { default: { open: "07:30", close: "19:30" }, weekly: { [dow]: { open: "09:00", close: "13:00", closed: false } }, overrides: {} } })).status, 200);
  eq(JSON.stringify((await api("GET", "/team/today", { token })).json.hours), JSON.stringify({ open: "09:00", close: "13:00", closed: false, override: false }));
});

test("team today: another pharmacy sees only its own; staff without leave requests; admin and staff only", async (app) => {
  const { api, bootstrap, DB } = app;
  const A = await bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  boardTables(DB.db);
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Pharmacy B')").run();
  const B = await app.addUser({ orgId: 1, locationId: 2, email: "b@example.com", name: "B Admin" });
  const S = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  const U = await app.addUser({ orgId: 1, locationId: 1, email: "user@example.com", name: "User", role: "user" });
  const today = maltaToday();
  await api("GET", "/team/today", { token: A.token });
  await seed(api, A.token, today);
  const b = (await api("GET", "/team/today", { token: B.token })).json;
  eq(b.shifts.length, 0, "B does not see A's rota"); eq(b.leave.length, 0); eq(b.locum_today.length, 0); eq(b.handover.total, 0); eq(b.leave_pending, 0);
  const s = await api("GET", "/team/today", { token: S.token });
  eq(s.status, 200, s.text); eq(s.json.shifts.length, 4, "staff see the rota"); eq(s.json.handover.total, 3, "and the handover");
  eq(s.json.leave_pending, null, "leave requests are the pharmacist's");
  eq((await api("GET", "/team/today", { token: U.token })).status, 403, "a user role opens none of these screens");
  eq((await api("GET", "/team/today", {})).status, 401);
});

// Director, Team round: the board counts must walk the primary key, not a MULTI-INDEX OR over the scope indexes (D1 keeps
// no ANALYZE statistics, and the OR plan reads every visible board row on every Team hub open). Unread messages are
// counted up to 100 (the screen says "99+"), so someone who never opened the board does not count the whole board.
test("team today: board counts walk the primary key and stop at 100", async ({ api, bootstrap, DB }) => {
  const A = await bootstrap({ org: "Chain Group", location: "Pharmacy A" });
  boardTables(DB.db);
  DB.db.exec(`CREATE INDEX IF NOT EXISTS idx_board_msg_scope_created ON board_messages(scope, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_msg_org_created ON board_messages(org_id, scope, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_mention_user ON board_mentions(mentioned_user_id, is_read);`);
  const ins = DB.db.prepare("INSERT INTO board_messages (org_id, location_id, user_id, body, scope) VALUES (?, 1, 999, 'x', ?)");
  for (let i = 0; i < 160; i++) ins.run(i % 4 === 3 ? 7 : 1, i % 2 ? "org" : "all"); // 120 visible to org 1, 40 of another group's private ones
  const seen = [];
  const orig = DB.prepare.bind(DB);
  DB.prepare = (sql) => { if (/board_messages m/.test(sql)) seen.push(String(sql)); return orig(sql); };
  const r = await api("GET", "/team/today", { token: A.token });
  DB.prepare = orig;
  eq(r.status, 200, r.text);
  eq(r.json.board.unread_messages, 100, "counted up to 100 (120 visible, never opened)");
  ok(seen.length >= 2, "the board statements ran: " + seen.length);
  for (const sql of seen) {
    const n = (sql.match(/\?/g) || []).length;
    const plan = DB.db.prepare("EXPLAIN QUERY PLAN " + sql).all(...Array(n).fill(1)).map((x) => x.detail).join(" | ");
    ok(!/MULTI-INDEX OR/.test(plan), "no MULTI-INDEX OR: " + plan);
  }
});
