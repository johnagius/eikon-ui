import { test, eq, ok } from "./lib.mjs";

// Team T-C3: "Got it" on the handover. One row per person per day, this pharmacy only; the pharmacist sees who read it,
// staff only their own line; the day's handover record itself is never touched.
test("handover seen: once per person per day, pharmacy only, pharmacist sees everyone, the handover row untouched", async ({ api, bootstrap, addUser, DB }) => {
  const { token } = await bootstrap();
  const staff = await addUser({ orgId: 1, locationId: 1, email: "karl@example.com", name: "Karl Vella", role: "staff" });
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch Admin" });
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta" }).format(new Date(Date.now() - 864e5));
  eq((await api("PUT", "/instructions/daily", { token, body: { ymd, notes: "n", handover_out: [{ id: "b_1", sev: "r", text: "Insulin", created_at: "2026-11-01T08:00:00.000Z" }] } })).status, 200);
  const dayRow = () => JSON.stringify(DB.db.prepare("SELECT * FROM instructions_daily").all());
  const before = dayRow();

  eq((await api("GET", "/instructions/daily/seen?ymd=" + ymd, { token })).json.seen.length, 0, "nobody yet");
  const a = await api("POST", "/instructions/daily/seen", { token, body: { ymd } });
  eq(a.status, 200, a.text); eq(a.json.seen.user_name, "Maria Borg"); ok(!a.json.already);
  const a2 = await api("POST", "/instructions/daily/seen", { token, body: { ymd } });
  ok(a2.json.already && a2.json.seen.seen_at === a.json.seen.seen_at, "a second press keeps the first time");
  eq((await api("POST", "/instructions/daily/seen", { token: staff.token, body: { ymd } })).status, 200);
  eq(DB.db.prepare("SELECT COUNT(*) c FROM handover_seen").get().c, 2, "one row per person");

  const adminView = (await api("GET", "/instructions/daily/seen?ymd=" + ymd, { token })).json.seen;
  ok(adminView.length === 2 && adminView[0].user_name === "Maria Borg" && adminView[0].me && adminView[1].user_name === "Karl Vella" && !adminView[1].me, "the pharmacist sees both: " + JSON.stringify(adminView));
  const staffView = (await api("GET", "/instructions/daily/seen?ymd=" + ymd, { token: staff.token })).json.seen;
  ok(staffView.length === 1 && staffView[0].user_name === "Karl Vella" && staffView[0].me, "staff see only their own line: " + JSON.stringify(staffView));
  eq((await api("GET", "/instructions/daily/seen?ymd=" + ymd, { token: branch.token })).json.seen.length, 0, "another pharmacy of the same group sees nothing of ours");

  eq((await api("POST", "/instructions/daily/seen", { token, body: { ymd: "2099-01-01" } })).status, 400, "not a day to come");
  eq((await api("POST", "/instructions/daily/seen", { token, body: { ymd: "yesterday" } })).status, 400);
  eq((await api("GET", "/instructions/daily/seen", { token })).status, 400);
  eq((await api("GET", "/instructions/daily/seen?ymd=" + ymd)).status, 401, "signed out: refused");
  eq(dayRow(), before, "the day's handover row is byte-identical");
  // the day's own GET answers as before
  eq((await api("GET", "/instructions/daily?ymd=" + ymd, { token })).json.record.handover_out[0].text, "Insulin");
});
