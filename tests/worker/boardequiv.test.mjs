// Board cost (Team round 2). The board list, its minute refresh, the pinned list and /board/dashboard used to read every
// visible message per call (a MULTI-INDEX OR over the scope indexes, then a sort of all of them: ~10–13k rows on a 20k
// board to show 50). Now each half of the visibility clause walks its own index in id order and stops at the LIMIT, and
// the dashboard's unread count reads at most 100 unread rows (exact to 99, then 100 = "99+", John 2026-11-10). This test seeds a large board (20,000 messages, five groups,
// head office and supplier accounts, gaps, neighbours with the same time, 40+ pins, mentions, read marks) and asks the
// OLD worker (the live one: BOARD_OLD_WORKER=<file>, else git c2e0a40, else this repo's first commit) and this worker the
// same questions as every kind of user. Every answer must be byte-for-byte the same (the dashboard too, up to 99 unread;
// above, only unread_messages differs: 100), and the read
// mark (board_user_state) must move exactly as before. Then rows visited per call, old vs new, and the plans.
// (Named boardequiv, not board-equiv: it must load after board.test.mjs, which relies on the worker making the board
// tables in its own fresh database — the board's DDL runs once per worker.)
import { test, eq, ok } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const NEW_SRC = join(ROOT, "cloudflare-worker", "code");

let oldWorker = null;
export async function loadOldWorker() {
  if (oldWorker) return oldWorker;
  let code = null;
  if (process.env.BOARD_OLD_WORKER && existsSync(process.env.BOARD_OLD_WORKER)) code = readFileSync(process.env.BOARD_OLD_WORKER);
  for (const ref of ["c2e0a40", null]) {
    if (code) break;
    try {
      const r = ref || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim().split("\n")[0];
      code = execFileSync("git", ["-C", ROOT, "show", r + ":cloudflare-worker/code"], { maxBuffer: 64 << 20, stdio: ["ignore", "pipe", "ignore"] });
    } catch (e) { code = null; }
  }
  if (!code) throw new Error("no old worker: set BOARD_OLD_WORKER=<file with the live worker's code>");
  if (Buffer.compare(Buffer.from(code), readFileSync(NEW_SRC)) === 0) throw new Error("the old worker is this worker: set BOARD_OLD_WORKER");
  const dir = mkdtempSync(join(tmpdir(), "board-old-"));
  writeFileSync(join(dir, "old.mjs"), code);
  oldWorker = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
  return oldWorker;
}

// The board's tables and indexes as the live worker made them (its DDL runs once per worker and each test gets a fresh
// database); newBoardIndexes adds this worker's own CREATE INDEX lines for the board, read from its code
// (tests/rehearsal/board-upgrade.mjs proves the worker itself adds them on the live database).
export function boardSchema(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS board_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', org_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'all',
    is_pinned INTEGER NOT NULL DEFAULT 0, pinned_at TEXT, pinned_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, mentioned_user_id INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_user_state (user_id INTEGER PRIMARY KEY, last_read_id INTEGER NOT NULL DEFAULT 0);
    CREATE INDEX IF NOT EXISTS idx_board_msg_scope_created ON board_messages(scope, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_msg_org_created ON board_messages(org_id, scope, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_msg_pinned ON board_messages(is_pinned, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_board_mention_user ON board_mentions(mentioned_user_id, is_read);
    CREATE INDEX IF NOT EXISTS idx_board_mention_msg ON board_mentions(message_id);`);
}
export function newBoardIndexes(db) {
  const src = readFileSync(NEW_SRC, "utf8");
  const a = src.indexOf("async function ensureBoardSchema__impl"), b = src.indexOf("_boardSchemaReady = true;", a);
  const ddl = [...src.slice(a, b).matchAll(/`(CREATE INDEX IF NOT EXISTS idx_board_msg_[^`]+)`/g)].map((m) => m[1]);
  for (const s of ddl) db.exec(s);
  return ddl;
}

// Users of every kind. Visibility on the board is by group (org): pharmacies < 400, suppliers 400–599, head office 600–900.
// mark: the read mark (board_user_state) — none, 0, early, half way, near the top, at the top.
export const KINDS = [
  { key: "pharmacy admin, group A", org: 1, loc: 1, role: "admin", email: "admin@example.com", mark: null },
  { key: "staff, group A", org: 1, loc: 1, role: "staff", email: "staff1@example.com", mark: 0 },
  { key: "group member, second pharmacy of group A", org: 1, loc: 2, role: "admin", email: "branch1@example.com", mark: "mid" },
  { key: "head office (700) of group A", org: 1, loc: 700, role: "admin", email: "ho1@example.com", mark: "top" },
  { key: "other group B admin", org: 2, loc: 50, role: "admin", email: "other2@example.com", mark: "near" },
  { key: "other group B staff", org: 2, loc: 51, role: "staff", email: "staff2@example.com", mark: 50 },
  { key: "small group C (few own messages)", org: 3, loc: 60, role: "admin", email: "small3@example.com", mark: null },
  { key: "head office alone (650)", org: 6, loc: 650, role: "admin", email: "ho6@example.com", mark: "near" },
  { key: "supplier (450)", org: 4, loc: 450, role: "admin", email: "sup4@example.com", mark: 0 },
  { key: "group with no group messages", org: 5, loc: 80, role: "admin", email: "none5@example.com", mark: "mid" }
];

// n messages within the last six months (so the board's own clean-up removes nothing) after a few pinned ones older than
// that; ~65% for everyone, the rest group-only; group C posts almost nothing and group 5 only for everyone (no group
// messages), so "walk the newest rows until enough are visible" would read far for them. Neighbours share a timestamp;
// some ids are deleted (gaps). 40+ pinned across groups. Deterministic.
export async function seedBoard({ DB, bootstrap, addUser }, n = 20000) {
  const admin = await bootstrap();
  boardSchema(DB.db);
  const db = DB.db;
  for (const [id, name] of [[2, "Other Group"], [3, "Small Group"], [4, "Supplier Ltd"], [5, "Quiet Group"], [6, "Head Office Co"]]) db.prepare("INSERT INTO orgs (id, name) VALUES (?, ?)").run(id, name);
  for (const [id, org, name] of [[2, 1, "Same group branch"], [700, 1, "Head Office"], [50, 2, "Sliema"], [51, 2, "Gżira"], [60, 3, "Żebbuġ"], [650, 6, "HO Six"], [450, 4, "Supplier Depot"], [80, 5, "Quiet"]])
    db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(id, org, name);
  const users = { [KINDS[0].key]: { ...KINDS[0], token: admin.token } };
  for (const k of KINDS.slice(1)) users[k.key] = { ...k, token: (await addUser({ orgId: k.org, locationId: k.loc, email: k.email, role: k.role, name: k.key })).token };
  for (const u of Object.values(users)) u.id = db.prepare("SELECT id FROM users WHERE email = ?").get(u.email).id;
  let seed = 20261110; const rnd = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
  const orgs = [1, 1, 2, 2, 2, 4, 6, 5, 3];
  const ins = db.prepare(`INSERT INTO board_messages (org_id, location_id, user_id, user_name, location_name, org_name, body, scope, is_pinned, pinned_at, pinned_by, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, NULL, NULL, ?, ?)`);
  const start = Date.now() - 170 * 86400000;
  db.exec("BEGIN");
  for (let i = 0; i < 6; i++) { // old pinned ones (the clean-up keeps pinned messages)
    const t = new Date(Date.now() - (300 - i) * 86400000).toISOString().slice(0, 19).replace("T", " ");
    ins.run(i % 2 ? 1 : 2, 1, 1, "Old Pinner", "Demo Pharmacy", "Test Org", "Old pinned " + i + " ċ ġ ħ ż", i % 3 ? "org" : "all", t, t);
  }
  for (let i = 0; i < n; i++) {
    let org = orgs[Math.floor(rnd() * orgs.length)];
    if (org === 3 && rnd() < 0.97) org = 2; // group C says almost nothing
    const scope = org === 5 || rnd() < 0.65 ? "all" : "org";
    const t = new Date(start + Math.floor(Math.floor(i / 3) * 3 * (165 * 86400000) / n)).toISOString().slice(0, 19).replace("T", " "); // threes share a time
    const loc = org === 1 ? [1, 2, 700][i % 3] : org * 10, uid = 900 + Math.floor(rnd() * 40);
    ins.run(org, loc, uid, "Person " + uid, "Pharmacy " + loc, "Org " + org, (scope === "org" ? "Group " + org + " only: " : "Everyone from " + org + ": ") + "message " + i + (i % 97 === 0 ? " \"quoted\" <b>x</b> ċ ġ ħ ż" : ""), scope, t, t);
  }
  db.exec("COMMIT");
  db.exec("DELETE FROM board_messages WHERE id % 487 = 0 OR id BETWEEN 9000 AND 9010"); // gaps
  // 40+ pins across groups (seeded directly, as the old cap allowed only 30 in all)
  const pin = db.prepare("UPDATE board_messages SET is_pinned = 1, pinned_at = '2026-11-01T08:00:00.000Z', pinned_by = 1 WHERE id = ?");
  for (const id of [1, 2, 3, 4, 5, 6]) pin.run(id);
  const pickPins = (org, scope, k) => db.prepare("SELECT id FROM board_messages WHERE org_id = ? AND scope = ? AND id > 6 ORDER BY (id * 7919) % 1009 LIMIT ?").all(org, scope, k).forEach((r) => pin.run(r.id));
  pickPins(1, "org", 9); pickPins(2, "org", 9); pickPins(2, "all", 7); pickPins(4, "all", 5); pickPins(3, "org", 2); pickPins(6, "all", 4);
  // Mentions: some read, some unread, some on another group's private message (recorded before the fix: never shown)
  const men = db.prepare("INSERT INTO board_mentions (message_id, mentioned_user_id, is_read, created_at) VALUES (?, ?, ?, ?)");
  let j = 0;
  for (const m of db.prepare("SELECT id, created_at FROM board_messages WHERE id % 211 = 0").all())
    for (const k of KINDS) { if ((m.id + j++) % 4) continue; men.run(m.id, users[k.key].id, j % 3 === 0 ? 1 : 0, m.created_at); }
  const max = db.prepare("SELECT MAX(id) AS m FROM board_messages").get().m;
  const mark = db.prepare("INSERT INTO board_user_state (user_id, last_read_id) VALUES (?, ?)");
  for (const u of Object.values(users)) if (u.mark != null) mark.run(u.id, u.mark === "mid" ? Math.floor(max / 2) : u.mark === "top" ? max : u.mark === "near" ? max - 40 : u.mark);
  const gap = db.prepare("SELECT id + 1 AS g FROM board_messages a WHERE id > 100 AND NOT EXISTS (SELECT 1 FROM board_messages b WHERE b.id = a.id + 1) LIMIT 1").get().g;
  return { users, max, gap, n: db.prepare("SELECT COUNT(*) AS c FROM board_messages").get().c, pinned: db.prepare("SELECT COUNT(*) AS c FROM board_messages WHERE is_pinned = 1").get().c };
}

// Every question the screens ask (classic board, new board, its minute refresh, Handover's pinned list, the dashboard),
// with the limits and cursors around every edge.
export function questions(max, gap) {
  const q = ["/board/messages", "/board/messages?scope=all", "/board/messages?scope=org", "/board/messages?scope=weird", "/board/messages?pinned=1",
    "/board/messages?pinned=1&limit=30", "/board/messages?pinned=1&scope=org&limit=30", "/board/messages?pinned=1&limit=3&before=" + Math.floor(max / 2), "/board/messages?pinned=1&after=" + Math.floor(max / 3)];
  for (const l of ["1", "49", "50", "100", "101", "0", "abc", "-1"]) q.push("/board/messages?scope=all&limit=" + l, "/board/messages?scope=org&limit=" + l);
  const cur = [1, 2, 7, gap, 400, Math.floor(max / 3), Math.floor(max / 2), max - 60, max, max + 1];
  for (const c of cur) q.push("/board/messages?scope=all&limit=50&before=" + c, "/board/messages?scope=org&limit=50&before=" + c);
  for (const c of [0, 1, gap, 400, Math.floor(max / 2), max - 300, max - 60, max - 30, max - 1, max]) q.push("/board/messages?scope=all&limit=50&after=" + c, "/board/messages?scope=org&limit=50&after=" + c);
  q.push("/board/messages?scope=all&limit=50&after=" + (Math.floor(max / 2) - 400) + "&before=" + Math.floor(max / 2), "/board/mentions", "/board/mentions?unread=1");
  return q;
}

async function call(worker, env, path, token) {
  const res = await worker.fetch(new Request("https://eikon.test" + path, { headers: { Authorization: "Bearer " + token } }), env, { waitUntil() {}, passThroughOnException() {} });
  return { status: res.status, text: await res.text() };
}
// The board's own reads as they run (auth and schema steps left out): the statements, their parameters, rows returned.
function capture(DB) {
  const c = { stmts: 0, rows: 0, sql: [] };
  const orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    const st = orig(sql), s = String(sql);
    if (!/board_messages/.test(s) || /^\s*(CREATE|ALTER|PRAGMA|INSERT|UPDATE|DELETE)\b/i.test(s)) return st;
    const wrap = (o, params) => {
      const all = o.all && o.all.bind(o), first = o.first && o.first.bind(o), bind = o.bind && o.bind.bind(o);
      if (all) o.all = async (...a) => { c.stmts++; c.sql.push({ sql: s, params }); const r = await all(...a); c.rows += (r.results || []).length; return r; };
      if (first) o.first = async (...a) => { c.stmts++; c.sql.push({ sql: s, params }); const r = await first(...a); if (r) c.rows++; return r; };
      if (bind) o.bind = (...a) => wrap(bind(...a), a);
      return o;
    };
    return wrap(st, []);
  };
  return { c, stop() { DB.prepare = orig; } };
}
// Rows visited, test-only: every reference to board_messages (and the mentions join) gets a counting function in its
// residual WHERE (__seen(x.id), always 1, not deterministic, so SQLite calls it once for each row the loop visits). The
// id cursors and the scope/org conditions are consumed by the index, so this counts the rows each loop walks.
let seenN = 0;
export function rowsVisited(db, stmts) {
  if (!db.__seenFn) { db.function("__seen", { deterministic: false, varargs: true }, () => { seenN++; return 1; }); db.__seenFn = true; }
  seenN = 0;
  for (const { sql, params } of stmts) {
    const s = sql.replace(/FROM board_messages m\s+WHERE /g, "FROM board_messages m WHERE __seen(m.id) AND ")
      .replace(/FROM board_messages\s+WHERE /g, "FROM board_messages WHERE __seen(id) AND ")
      .replace(/JOIN board_messages m ON m\.id = bm\.message_id\s+WHERE /g, "JOIN board_messages m ON m.id = bm.message_id WHERE __seen(m.id) AND __seen(bm.id) AND ");
    if (!/__seen/.test(s)) throw new Error("rowsVisited: no place for the counter in " + sql.slice(0, 120));
    db.prepare(s).all(...params);
  }
  return seenN;
}
const stateRows = (db) => JSON.stringify(db.prepare("SELECT * FROM board_user_state ORDER BY user_id").all());
function restoreState(db, json) { db.exec("DELETE FROM board_user_state"); const ins = db.prepare("INSERT INTO board_user_state (user_id, last_read_id) VALUES (?, ?)"); for (const r of JSON.parse(json)) ins.run(r.user_id, r.last_read_id); }
// Old vs new for one question: same status, same bytes, the read mark moved the same way.
async function same(OLD, NEW, env, DB, path, u, label, expectNew) {
  const before = stateRows(DB.db);
  const a = await call(OLD, env, path, u.token);
  if (expectNew) a.text = expectNew(a.text);
  const afterOld = stateRows(DB.db);
  restoreState(DB.db, before);
  const b = await call(NEW, env, path, u.token);
  eq(b.status, a.status, label + " status");
  if (b.text !== a.text) throw new Error(label + " differs:\n old " + a.text.slice(0, 300) + "\n new " + b.text.slice(0, 300));
  eq(stateRows(DB.db), afterOld, label + ": the read mark moves exactly as before");
  return a.text;
}

test("board equivalence: old and new board answer byte-for-byte the same for every kind of user on a 20,000-message board", async (app) => {
  const OLD = await loadOldWorker();
  const { DB, env, worker } = app;
  const { users, max, gap, n, pinned } = await seedBoard(app);
  ok(n >= 19900 && pinned >= 40, "seeded " + n + " messages, " + pinned + " pinned");
  newBoardIndexes(DB.db);
  const Q = questions(max, gap);
  let compared = 0, pages = 0, over100 = 0, exact = 0;
  for (const u of Object.values(users)) {
    // the dashboard first (it reads the read mark that a fresh list open moves), then every question, then full paging
    // Owner decision (2026-11-10): unread messages exact up to 99, then 100 ("99+"). Up to 99 the answer is byte-identical
    // to the old worker's; above, the only difference is unread_messages = 100.
    let oldUnread = null;
    const d = JSON.parse(await same(OLD, worker, env, DB, "/board/dashboard", u, u.key + " /board/dashboard",
      (t) => { const o = JSON.parse(t); oldUnread = o.unread_messages; if (o.unread_messages >= 100) o.unread_messages = 100; return JSON.stringify(o); })); compared++;
    ok(d.ok === true, u.key + " dashboard answers");
    if (oldUnread > 100) { over100++; eq(d.unread_messages, 100, u.key + " dashboard caps " + oldUnread + " unread at 100 (\"99+\")"); }
    else { ok(oldUnread <= 99 ? d.unread_messages === oldUnread : d.unread_messages === 100, u.key + " dashboard unread exact: " + oldUnread); if (oldUnread <= 99) exact++; }
    for (const q of Q) { await same(OLD, worker, env, DB, q, u, u.key + " " + q); compared++; }
    for (const scope of ["all", "org"]) { // older pages until empty, as "Show older" does
      let before = 0, seen = 0;
      for (;;) {
        const msgs = JSON.parse(await same(OLD, worker, env, DB, "/board/messages?scope=" + scope + "&limit=100" + (before ? "&before=" + before : ""), u, u.key + " paging " + scope + " before=" + before)).messages;
        compared++; pages++;
        if (!msgs.length) break;
        seen += msgs.length; before = msgs[msgs.length - 1].id;
      }
      const expect = DB.db.prepare("SELECT COUNT(*) AS c FROM board_messages WHERE " + (scope === "org" ? "scope = 'org' AND org_id = ?" : "(scope = 'all' OR (scope = 'org' AND org_id = ?))")).get(u.org).c;
      eq(seen, expect, u.key + " paged through every visible message (" + scope + ")");
    }
    // and on the raw answer: never another group's private message or pin
    const all = JSON.parse((await call(worker, env, "/board/messages?scope=all&limit=100", u.token)).text).messages;
    ok(all.length === 100 && all.every((m) => m.scope === "all" || (m.scope === "org" && m.org_id === u.org)), u.key + ": only everyone's and own group's");
    const pins = JSON.parse((await call(worker, env, "/board/messages?pinned=1&limit=30", u.token)).text).messages;
    ok(pins.length && pins.every((m) => m.is_pinned === 1 && (m.scope === "all" || m.org_id === u.org)), u.key + ": pins stay in the group");
  }
  ok(over100 >= 3, "dashboards with over 100 unread capped at 100: " + over100);
  ok(exact >= 3, "dashboards with 99 or fewer unread byte-identical: " + exact);
  console.log("       compared " + compared + " answers (" + pages + " paging calls) over " + Object.keys(users).length + " kinds of user: all byte-identical (dashboards over 99 unread: unread_messages 100); " + exact + " dashboards ≤99 exact, " + over100 + " over 100 capped");
});

// Rows visited per call, old vs new, on the same 20k board (old: the live schema; new: with the added indexes), and the
// plans: no MULTI-INDEX OR and no sort of the board for the list, refresh and pinned list; the old SQL fails those checks.
test("board equivalence: rows visited per call, old vs new, and the plans (no MULTI-INDEX OR, no sort of the board)", async (app) => {
  const OLD = await loadOldWorker();
  const { DB, env, worker } = app;
  const { users, max } = await seedBoard(app);
  const CALLS = { list: "/board/messages?scope=all&limit=50", group: "/board/messages?scope=org&limit=50", refresh: "/board/messages?scope=all&limit=50&after=" + (max - 30),
    older: "/board/messages?scope=all&limit=50&before=" + Math.floor(max / 2), pinned: "/board/messages?pinned=1&limit=30", dashboard: "/board/dashboard" };
  const run = async (w, path, u) => { const st = stateRows(DB.db); const c = capture(DB); await call(w, env, path, u.token); c.stop(); restoreState(DB.db, st); return c.c.sql; };
  const oldStmts = {};
  for (const u of Object.values(users)) for (const [k, p] of Object.entries(CALLS)) oldStmts[u.key + "|" + k] = await run(OLD, p, u);
  const oldRows = {}; for (const [key, s] of Object.entries(oldStmts)) oldRows[key] = rowsVisited(DB.db, s);
  const oldPlans = Object.entries(oldStmts).filter(([k]) => /\|(list|group|older)$/.test(k)).flatMap(([, s]) => s).map((x) => DB.db.prepare("EXPLAIN QUERY PLAN " + x.sql).all(...x.params).map((r) => r.detail).join(" | "));
  newBoardIndexes(DB.db);
  const out = {}, tot = {};
  for (const u of Object.values(users)) {
    const unread = DB.db.prepare(`SELECT COUNT(*) AS c FROM board_messages WHERE id > COALESCE((SELECT last_read_id FROM board_user_state WHERE user_id = ?), 0) AND (scope = 'all' OR (scope = 'org' AND org_id = ?))`).get(u.id, u.org).c;
    const mentions = DB.db.prepare("SELECT COUNT(*) AS c FROM board_mentions WHERE mentioned_user_id = ? AND is_read = 0").get(u.id).c;
    for (const [k, p] of Object.entries(CALLS)) {
      const s = await run(worker, p, u), nw = rowsVisited(DB.db, s), od = oldRows[u.key + "|" + k];
      out[u.key + " " + k] = od + " → " + nw;
      tot[k] = tot[k] || { o: 0, n: 0, mo: 0, mn: 0, c: 0 }; Object.assign(tot[k], { o: tot[k].o + od, n: tot[k].n + nw, mo: Math.max(tot[k].mo, od), mn: Math.max(tot[k].mn, nw), c: tot[k].c + 1 });
      // targets: list/refresh/older/group ≤ 2 × limit (each half of the clause stops at the limit); pinned ≤ the pinned
      // rows; dashboard ≤ ~60 + this person's unread messages up to 100 (the cap) + their unread mentions
      if (k === "pinned") ok(nw <= 60, u.key + " pinned: " + nw);
      else if (k === "dashboard") ok(nw <= 60 + Math.min(unread, 100) + 2 * mentions, u.key + " dashboard: " + nw + " (unread " + unread + ", counted to 100; mentions " + mentions + ")");
      else ok(nw <= 100, u.key + " " + k + ": " + nw);
      for (const x of s) {
        const plan = DB.db.prepare("EXPLAIN QUERY PLAN " + x.sql).all(...x.params).map((r) => r.detail).join(" | ");
        ok(!/MULTI-INDEX OR/.test(plan), "no MULTI-INDEX OR: " + plan);
        ok(!/SCAN (m|board_messages)\b/.test(plan), "no scan of the board: " + x.sql.replace(/\s+/g, " ").slice(0, 100) + " → " + plan);
        ok(!/idx_board_msg_(scope|org)_created/.test(plan), "not on the created_at indexes (they cannot give id order): " + plan);
        // a sort is only ever of what one limited index walk returned (≤ limit rows from each half), never of the board
        if (/limit=/.test(p) && k !== "pinned") ok((plan.split("USE TEMP B-TREE").length - 1) <= 2 && (/MERGE \(UNION ALL\)/.test(plan) || !/TEMP B-TREE/.test(plan)), "temp b-tree only to merge the two limited halves: " + plan);
        if (k === "pinned") ok(/SEARCH m USING INDEX idx_board_msg_pinned \(is_pinned=\?\)/.test(plan), "pinned list reads only the pinned rows (idx_board_msg_pinned), then sorts those: " + plan);
      }
    }
  }
  ok(oldPlans.length && oldPlans.every((p) => /MULTI-INDEX OR|TEMP B-TREE FOR ORDER BY/.test(p) && !/idx_board_msg_scope_id/.test(p)), "the old SQL fails these checks: " + oldPlans[0]);
  for (const [k, t] of Object.entries(tot)) console.log(`       ${k}: rows visited per call, average ${Math.round(t.o / t.c)} → ${Math.round(t.n / t.c)}; worst ${t.mo} → ${t.mn}`);
  if (process.env.BOARD_ROWS) for (const [k, v] of Object.entries(out)) console.log("         " + k + ": " + v);
});

// The 30-pinned cap is per group now: what counts is what the pinner's group sees pinned (everyone's pinned messages plus
// its own group-only ones). Same error text and status as before.
test("board pins: the 30 cap is per group; group-only pins never block another group; unpin always allowed", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  boardSchema(DB.db); newBoardIndexes(DB.db);
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Sliema')").run();
  const other = await addUser({ orgId: 2, locationId: 50, email: "other@example.com", name: "Other Admin" });
  const post = async (tk, body, scope) => { const r = await api("POST", "/board/messages", { token: tk, body: { body, scope } }); eq(r.status, 200, r.text); return r.json.id; };
  const pin = (tk, id) => api("PUT", "/board/messages/" + id + "/pin", { token: tk, body: {} });
  // group A pins 30 of its own
  for (let i = 0; i < 30; i++) eq((await pin(token, await post(token, "A private " + i, "org"))).json.is_pinned, 1, "A pin " + i);
  // A's 31st is refused with the same message and status as before
  const over = await pin(token, await post(token, "A private 31st", "org"));
  eq(over.status, 400); eq(over.json.error, "Maximum 30 pinned messages reached. Unpin another message first.");
  // group B can still pin (before: 30 pinned anywhere blocked everyone)
  for (let i = 0; i < 5; i++) { const r = await pin(other.token, await post(other.token, "B private " + i, "org")); eq(r.status, 200, "B pin " + i + ": " + r.text); }
  // a message for everyone counts for everyone: B pins one; A (30 own) cannot pin another for everyone
  const pubB = await post(other.token, "B for everyone", "all");
  eq((await pin(other.token, pubB)).json.is_pinned, 1, "B: 6 in its list");
  eq((await pin(token, await post(token, "A for everyone", "all"))).status, 400, "A sees 31 now (30 own + B's for everyone): refused");
  // what each group sees: A 31 (its 30 + B's shared one: a shared pin can take another group past 30), B 6
  const l1 = (await api("GET", "/board/messages?pinned=1", { token })).json.messages, l2 = (await api("GET", "/board/messages?pinned=1", { token: other.token })).json.messages;
  eq(l1.length, 31); eq(l2.length, 6);
  ok(!l2.some((m) => /A private/.test(m.body)) && !l1.some((m) => /B private/.test(m.body)), "no group sees another's group-only pins");
  // unpinning is never blocked, and the space is used again
  const a0 = l1.find((m) => /A private 0$/.test(m.body)).id, a1 = l1.find((m) => /A private 1$/.test(m.body)).id;
  eq((await pin(token, a0)).json.is_pinned, 0); eq((await pin(token, a1)).json.is_pinned, 0);
  eq((await pin(token, DB.db.prepare("SELECT id FROM board_messages WHERE body = 'A private 31st'").get().id)).json.is_pinned, 1, "after unpinning two, A has room for one");
  eq((await pin(other.token, a0)).status, 404, "another group's private message still cannot be pinned by id");
});
