import { test, eq, ok } from "./lib.mjs";

test("health answers with the worker version", async ({ api }) => {
  const r = await api("GET", "/health");
  eq(r.status, 200);
  ok(r.json.ok && r.json.version, "version present");
});

test("bootstrap then login then /auth/me", async ({ api, bootstrap }) => {
  const { token, user } = await bootstrap();
  ok(token, "token issued");
  const me = await api("GET", "/auth/me", { token });
  eq(me.status, 200);
  eq(me.json.user.email, "admin@example.com");
  eq(me.json.user.location_id, 1);
  ok(user.org_id === 1);
});

test("requests without a token are rejected", async ({ api }) => {
  const r = await api("GET", "/auth/me");
  eq(r.status, 401);
});

test("temperature: default devices are seeded and an entry upserts", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const devs = await api("GET", "/temperature/devices?include_inactive=1", { token });
  eq(devs.status, 200);
  const list = devs.json.devices || devs.json.items || devs.json.results || devs.json;
  const arr = Array.isArray(list) ? list : (list.devices || []);
  ok(arr.length >= 1, "at least one default device: " + JSON.stringify(devs.json).slice(0, 200));
  const dev = arr[0];
  const e1 = await api("POST", "/temperature/entries", { token, body: { device_id: dev.id, entry_date: "2026-10-31", min_temp: 3.9, max_temp: 6.1, notes: "" } });
  eq(e1.status, 200, e1.text);
  const e2 = await api("POST", "/temperature/entries", { token, body: { device_id: dev.id, entry_date: "2026-10-31", min_temp: 4.0, max_temp: 6.2, notes: "" } });
  eq(e2.status, 200, e2.text);
  eq(e2.json.entry_id, e1.json.entry_id, "same row updated, not duplicated");
  const rows = DB.q("SELECT min_temp, max_temp FROM temperature_entries");
  eq(rows.length, 1);
  eq(rows[0].min_temp, 4.0);
});

test("cleaning: create, list, update, delete round trip", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const c = await api("POST", "/cleaning/entries", { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "08:30", cleaner_name: "Karl", staff_name: "Maria", notes: "" } });
  eq(c.status, 200, c.text);
  const list = await api("GET", "/cleaning/entries?month=2026-10", { token });
  eq(list.status, 200);
  const entries = list.json.entries || list.json.items || [];
  eq(entries.length, 1);
  const id = entries[0].id;
  const u = await api("PUT", "/cleaning/entries/" + id, { token, body: { entry_date: "2026-10-31", time_in: "08:00", time_out: "09:00", cleaner_name: "Karl", staff_name: "Maria", notes: "late" } });
  eq(u.status, 200, u.text);
  const d = await api("DELETE", "/cleaning/entries/" + id, { token });
  eq(d.status, 200, d.text);
});

test("end of day: save, lock, locked record refuses an ordinary update", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const rec = { eod_date: "2026-10-30", time_of_day: "PM", staff_name: "Maria", float_amount: 500, x_json: [], epos_json: [], cheques_json: [], paid_outs_json: [], cash_json: {}, bov_deposit_json: {}, bov_bag_number: "", notes: "" };
  const s = await api("PUT", "/endofday/record", { token, body: { record: rec } });
  eq(s.status, 200, s.text);
  const l = await api("PUT", "/endofday/record", { token, body: { record: { ...rec, locked_at: new Date().toISOString(), action: "LOCK" } } });
  eq(l.status, 200, l.text);
  const g = await api("GET", "/endofday/record?date=2026-10-30", { token });
  ok(g.json.record && g.json.record.locked_at, "record is locked: " + g.text.slice(0, 200));
  const upd = await api("PUT", "/endofday/record", { token, body: { record: { ...rec, notes: "changed", locked_at: "2026-10-30T19:00:00Z" } } });
  eq(upd.status, 200, "lock call is idempotent");
  const g2 = await api("GET", "/endofday/record?date=2026-10-30", { token });
  ok(g2.json.record.locked_at, "still locked");
});
