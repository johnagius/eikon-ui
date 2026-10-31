import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

test("login: ten wrong passwords lock the e-mail for a while, success clears it", async ({ api, bootstrap, DB }) => {
  const { email, password } = await bootstrap();
  for (let i = 0; i < 10; i++) {
    const r = await api("POST", "/auth/login", { body: { email, password: "wrong" + i } });
    eq(r.status, 401, "attempt " + i + ": " + r.text);
  }
  const blocked = await api("POST", "/auth/login", { body: { email, password } });
  eq(blocked.status, 429, blocked.text);
  ok(blocked.headers.get("Retry-After"), "Retry-After header present");
  ok(DB.q("SELECT COUNT(*) AS c FROM audit_log WHERE action='LOGIN_FAILED'")[0].c >= 10, "failures audited");
  // Age the attempts and the account signs in again, which clears the counter
  DB.db.prepare("UPDATE login_attempts SET attempted_at = datetime('now', '-20 minutes')").run();
  const good = await api("POST", "/auth/login", { body: { email, password } });
  eq(good.status, 200, good.text);
  eq(DB.q("SELECT COUNT(*) AS c FROM login_attempts")[0].c, 0);
});

test("login: a wrong e-mail is counted per IP but does not reveal whether the account exists", async ({ api, bootstrap }) => {
  await bootstrap();
  const r = await api("POST", "/auth/login", { body: { email: "nobody@example.com", password: "x" }, headers: { "CF-Connecting-IP": "203.0.113.9" } });
  eq(r.status, 401);
  eq(r.json.error, "Invalid credentials");
});

test("locum receipts: the password is checked on the server and can be changed per deployment", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  // Default (unconfigured) values still work so an existing deployment keeps running
  eq((await api("POST", "/locumreceipts/verify-pass", { token, body: { kind: "edit", pass: "!4321" } })).status, 200);
  eq((await api("POST", "/locumreceipts/verify-pass", { token, body: { kind: "edit", pass: "nope" } })).status, 403);
  eq((await api("POST", "/locumreceipts/verify-pass", { token, body: { kind: "report", pass: "Report1234!" } })).status, 200);
  eq((await api("POST", "/locumreceipts/verify-pass", { token, body: { kind: "report", pass: "" } })).status, 403);
  // Create a receipt, then edit with the right and wrong header
  const c = await api("POST", "/locumreceipts/receipts", { token, body: { receipt_date: "2026-10-31", hours: 8, locum_full_name: "Dr Locum", registration_number: "R123", day_type: "normal", fee_per_hour: 30 } });
  eq(c.status, 200, c.text);
  const id = c.json.receipt ? c.json.receipt.id : c.json.id;
  const bad = await api("PUT", "/locumreceipts/receipts/" + id, { token, headers: { "X-Eikon-Edit-Pass": "wrong" }, body: { receipt_date: "2026-10-31", hours: 9, locum_full_name: "Dr Locum", registration_number: "R123", day_type: "normal", fee_per_hour: 30 } });
  eq(bad.status, 403, bad.text);
  const good = await api("PUT", "/locumreceipts/receipts/" + id, { token, headers: { "X-Eikon-Edit-Pass": "!4321" }, body: { receipt_date: "2026-10-31", hours: 9, locum_full_name: "Dr Locum", registration_number: "R123", day_type: "normal", fee_per_hour: 30 } });
  eq(good.status, 200, good.text);

  // With secrets configured, the old defaults stop working
  const app2 = await makeApp({ env: { LOCUM_RECEIPTS_EDIT_PASS: "new-edit", LOCUM_RECEIPTS_REPORT_PASS: "new-report" } });
  const s2 = await app2.bootstrap();
  eq((await app2.api("POST", "/locumreceipts/verify-pass", { token: s2.token, body: { kind: "edit", pass: "!4321" } })).status, 403);
  eq((await app2.api("POST", "/locumreceipts/verify-pass", { token: s2.token, body: { kind: "edit", pass: "new-edit" } })).status, 200);
  eq((await app2.api("GET", "/locumreceipts/report?month=2026-10", { token: s2.token, headers: { "X-Eikon-Report-Pass": "Report1234!" } })).status, 403);
  eq((await app2.api("GET", "/locumreceipts/report?month=2026-10", { token: s2.token, headers: { "X-Eikon-Report-Pass": "new-report" } })).status, 200);
});

test("change password: proves the current one, revokes other sessions, keeps this one", async ({ api, bootstrap }) => {
  const { token, email, password } = await bootstrap();
  // a second device signed in as the same user
  const other = await api("POST", "/auth/login", { body: { email, password } });
  eq(other.status, 200);
  const otherToken = other.json.token;
  eq((await api("POST", "/auth/change-password", { token, body: { current_password: "wrong", new_password: "LongEnough!2026" } })).status, 403);
  eq((await api("POST", "/auth/change-password", { token, body: { current_password: password, new_password: "short" } })).status, 400);
  eq((await api("POST", "/auth/change-password", { token, body: { current_password: password, new_password: password } })).status, 400);
  const ok1 = await api("POST", "/auth/change-password", { token, body: { current_password: password, new_password: "LongEnough!2026" } });
  eq(ok1.status, 200, ok1.text);
  eq((await api("GET", "/auth/me", { token })).status, 200, "this session stays signed in");
  eq((await api("GET", "/auth/me", { token: otherToken })).status, 401, "the other device is signed out");
  eq((await api("POST", "/auth/login", { body: { email, password } })).status, 401, "old password no longer works");
  eq((await api("POST", "/auth/login", { body: { email, password: "LongEnough!2026" } })).status, 200, "new password works");
});
