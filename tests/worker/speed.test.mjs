import { test, eq, ok } from "./lib.mjs";

function countDdl(DB) {
  const counter = { ddl: 0, all: 0 };
  const orig = DB.prepare.bind(DB);
  DB.prepare = function (sql) {
    counter.all++;
    if (/^\s*(CREATE|ALTER|PRAGMA)\b/i.test(String(sql))) counter.ddl++;
    return orig(sql);
  };
  return counter;
}

test("schema DDL runs once per database, not on every request", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const c = countDdl(DB);
  const r1 = await api("GET", "/cleaning/entries?month=2026-10", { token });
  eq(r1.status, 200);
  const firstDdl = c.ddl;
  c.ddl = 0; c.all = 0;
  const r2 = await api("GET", "/cleaning/entries?month=2026-10", { token });
  eq(r2.status, 200);
  eq(c.ddl, 0, "second request ran DDL again");
  ok(firstDdl >= 0, "first request may run DDL");
  // A heavier module: supplier products ran ~29 DDL statements per request before
  c.ddl = 0;
  await api("GET", "/supplier-products/entries", { token });
  const heavyFirst = c.ddl;
  c.ddl = 0;
  await api("GET", "/supplier-products/entries", { token });
  eq(c.ddl, 0, "supplier schema re-ran: " + heavyFirst + " statements the first time");
});

test("a failed schema run is retried on the next request", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const orig = DB.prepare.bind(DB);
  let failOnce = true;
  DB.prepare = function (sql) {
    if (failOnce && /CREATE TABLE IF NOT EXISTS alerts_entries/i.test(String(sql))) { failOnce = false; throw new Error("transient D1 error"); }
    return orig(sql);
  };
  const r1 = await api("GET", "/alerts/entries", { token });
  eq(r1.status, 500);
  const r2 = await api("GET", "/alerts/entries", { token });
  eq(r2.status, 200, r2.text);
});
