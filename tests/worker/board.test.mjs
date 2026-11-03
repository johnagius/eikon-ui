import { test, eq, ok } from "./lib.mjs";

// The board is shared between pharmacy groups: a message is for everyone or for one group only.
// A group's own messages must never reach another group, pinned or not, and another group cannot pin them.
test("board: a group's private pinned messages stay inside the group; others cannot see or pin them", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Sliema')").run();
  const other = await addUser({ orgId: 2, locationId: 50, email: "other@example.com", name: "Other Admin" });

  const priv = await api("POST", "/board/messages", { token, body: { body: "Group only: staff bonus list", scope: "org" } });
  eq(priv.status, 200, priv.text);
  const pub = await api("POST", "/board/messages", { token, body: { body: "Everyone: Panadol shortage", scope: "all" } });
  eq(pub.status, 200, pub.text);
  const privId = (priv.json.message || priv.json).id, pubId = (pub.json.message || pub.json).id;
  ok(privId && pubId, "ids: " + priv.text);
  eq((await api("PUT", "/board/messages/" + privId + "/pin", { token, body: {} })).json.is_pinned, 1);
  eq((await api("PUT", "/board/messages/" + pubId + "/pin", { token, body: {} })).json.is_pinned, 1);

  // own group sees both pinned
  const mine = (await api("GET", "/board/messages?pinned=1", { token })).json.messages || [];
  ok(mine.some((m) => m.id === privId) && mine.some((m) => m.id === pubId), "own group sees both: " + JSON.stringify(mine.map((m) => m.id)));
  // another pharmacy in the SAME group sees both too (group messages are shared by the group on purpose; item 3)
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Same group branch')").run();
  const branch = await addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const br = (await api("GET", "/board/messages?pinned=1", { token: branch.token })).json.messages || [];
  ok(br.some((m) => m.id === privId) && br.some((m) => m.id === pubId), "same-group branch sees both: " + JSON.stringify(br.map((m) => m.id)));
  const brAll = await api("GET", "/board/messages?scope=org", { token: branch.token });
  ok(brAll.text.includes("Group only: staff bonus list"), "branch's group view lists it");
  // the other group sees only the public one
  const theirs = (await api("GET", "/board/messages?pinned=1", { token: other.token })).json.messages || [];
  ok(theirs.some((m) => m.id === pubId), "other group sees the public pin");
  ok(!theirs.some((m) => m.id === privId), "other group does not see the private pin: " + JSON.stringify(theirs.map((m) => m.body)));
  // and cannot unpin it by id
  eq((await api("PUT", "/board/messages/" + privId + "/pin", { token: other.token, body: {} })).status, 404);
  eq(DB.db.prepare("SELECT is_pinned FROM board_messages WHERE id = ?").get(privId).is_pinned, 1, "still pinned");
  // the public one can still be pinned/unpinned by anyone, as before
  eq((await api("PUT", "/board/messages/" + pubId + "/pin", { token: other.token, body: {} })).json.is_pinned, 0);

  // Mentions: a group-only message that names another group's pharmacy does not reach that group
  // (one test, because the board's tables are made once per worker and each test gets a fresh database)
  { const r0 = await api("POST", "/board/messages", { token, body: { body: "Private note about @Sliema", scope: "org" } }); eq(r0.status, 200, r0.text); }
  eq((await api("POST", "/board/messages", { token, body: { body: "Public hello @Sliema", scope: "all" } })).status, 200);
  const m = (await api("GET", "/board/mentions", { token: other.token })).json.mentions || [];
  ok(m.some((x) => /Public hello/.test(x.body)), "public mention still arrives: " + JSON.stringify(m));
  ok(!m.some((x) => /Private note/.test(x.body)), "private one does not: " + JSON.stringify(m.map((x) => x.body)));
  // a mention recorded before the fix (row exists) is still not shown
  const privNoteId = DB.db.prepare("SELECT id FROM board_messages WHERE body LIKE 'Private%'").get().id;
  DB.db.prepare("INSERT INTO board_mentions (message_id, mentioned_user_id, created_at) VALUES (?, ?, datetime('now'))").run(privNoteId, other.user.id || other.user.user_id);
  const m2 = (await api("GET", "/board/mentions", { token: other.token })).json.mentions || [];
  ok(!m2.some((x) => /Private note/.test(x.body)), "old leaked mention hidden");
  const d = (await api("GET", "/board/dashboard", { token: other.token })).json;
  ok(!JSON.stringify(d).includes("Private note"), "dashboard does not leak it either");
});
