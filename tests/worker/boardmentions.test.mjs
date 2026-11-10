import { test, eq, ok } from "./lib.mjs";

// @mentions (Team round, John 2026-11-10): "@Birkirkara can you check" reaches Birkirkara's people (before, the whole
// run after "@" had to equal the pharmacy's name, so a mention followed by more words reached nobody). The longest
// name wins; a group-only message still never reaches another group; the message body is stored as typed.
function boardTables(db) { // the board's tables are made once per worker; each test gets a fresh database
  db.exec(`CREATE TABLE IF NOT EXISTS board_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL, user_id INTEGER NOT NULL,
    user_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', org_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'all',
    is_pinned INTEGER NOT NULL DEFAULT 0, pinned_at TEXT, pinned_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_mentions (id INTEGER PRIMARY KEY AUTOINCREMENT, message_id INTEGER NOT NULL, mentioned_user_id INTEGER NOT NULL, is_read INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT (datetime('now')));
    CREATE TABLE IF NOT EXISTS board_user_state (user_id INTEGER PRIMARY KEY, last_read_id INTEGER NOT NULL DEFAULT 0);`);
}

test("board mentions: a name followed by more words reaches the pharmacy; longest name wins; groups stay private", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  boardTables(DB.db);
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Birkirkara')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (3, 1, 'Birkirkara Pharmacy')").run();
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Sliema')").run();
  const bkr = await addUser({ orgId: 1, locationId: 2, email: "bkr@example.com", name: "Bkr Admin" });
  const bkr2 = await addUser({ orgId: 1, locationId: 2, email: "bkr2@example.com", name: "Bkr Staff", role: "staff" });
  const bkp = await addUser({ orgId: 1, locationId: 3, email: "bkp@example.com", name: "Bkp Admin" });
  const sli = await addUser({ orgId: 2, locationId: 50, email: "sli@example.com", name: "Sliema Admin" });
  const mentions = async (u) => ((await api("GET", "/board/mentions", { token: u.token })).json.mentions || []).map((m) => m.body);
  const post = async (body, scope) => { const r = await api("POST", "/board/messages", { token, body: { body, scope } }); eq(r.status, 200, r.text); return r; };

  await post("@Birkirkara can you check the Ventolin?", "all");
  ok((await mentions(bkr)).includes("@Birkirkara can you check the Ventolin?"), "reaches Birkirkara's admin");
  ok((await mentions(bkr2)).includes("@Birkirkara can you check the Ventolin?"), "and its staff");
  ok(!(await mentions(bkp)).length, "not Birkirkara Pharmacy");

  await post("@Birkirkara Pharmacy please send 2 boxes", "all");
  ok((await mentions(bkp)).includes("@Birkirkara Pharmacy please send 2 boxes"), "the longer name wins");
  ok(!(await mentions(bkr)).includes("@Birkirkara Pharmacy please send 2 boxes"), "not the shorter one too");

  await post("Thanks @Birkirkara.", "all");
  ok((await mentions(bkr)).includes("Thanks @Birkirkara."), "trailing full stop trimmed");

  await post("@Birkirkara, @Birkirkara can you", "all");
  const id = DB.db.prepare("SELECT id FROM board_messages ORDER BY id DESC LIMIT 1").get().id;
  eq(DB.db.prepare("SELECT COUNT(*) AS c FROM board_mentions WHERE message_id = ?").get(id).c, 2, "one mention per person (2 people at Birkirkara)");

  await post("@Sliema can you lend us some", "org");
  ok(!(await mentions(sli)).length, "a group-only message never reaches another group");
  await post("@Sliema can you lend us some", "all");
  ok((await mentions(sli)).includes("@Sliema can you lend us some"), "an everyone message does");

  eq(DB.db.prepare("SELECT body FROM board_messages WHERE id = ?").get(id).body, "@Birkirkara, @Birkirkara can you", "body stored as typed");
  await post("@Nowhere at all", "all");
  eq(DB.db.prepare("SELECT COUNT(*) AS c FROM board_mentions m JOIN board_messages b ON b.id = m.message_id WHERE b.body = '@Nowhere at all'").get().c, 0, "an unknown name reaches nobody");
});
