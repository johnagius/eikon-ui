// Bookings › Change time (BACKLOG6 item 2, F4; decision D2). Staff move a booking through the screen; the server's own
// PATCH /bookings/:id does the free-time check, the version guard and the "changed" e-mail. Read back from the database:
//   1. the PATCH body is exactly { version, date, start } (no providerId: the same practitioner is free then);
//   2. the stored row equals the row the customer's own link (/b/<token>/move) stores for the same new time, every
//      column but the row's own id, reference, private link and clock stamps; the audit line names the same new time
//      (its action and its "from/to" shape are the worker's own: BK_UPDATE for staff, BK_MOVE_ONLINE for the link);
//   3. the move sends exactly one e-mail, to the booking's own (made-up, example.test) address, and records one
//      'change' message; nothing reaches a real address (tests/real/stack.mjs stubs the e-mail services);
//   4. a time taken by someone else meanwhile answers 409: the sheet says so and offers the next free times; nothing
//      is stored and no e-mail goes.
import { ymd } from "../lib.mjs";
export default {
  title: "Bookings: Change time stores what the customer's own move stores, with one e-mail",
  async run(t) {
    // What the e-mail service is asked to send, with its body (the stack's stub keeps the address only).
    const sent = [], orig = globalThis.fetch;
    globalThis.fetch = async (u, init) => { if (/api\.brevo\.com|api\.resend\.com/.test(String(u))) sent.push({ url: String(u), body: String((init && init.body) || "") }); return orig(u, init); };
    try { await steps(t, sent); } finally { globalThis.fetch = orig; }
  },
};

async function steps(t, sent) {
  // A practitioner and a service of this case's own (no other case books), e-mails on through one sender.
  const hrs = {}; for (let d = 0; d < 7; d++) hrs[d] = [["08:00", "20:00"]];
  const pr = await t.api("POST", "/bookings/providers", { name: "Helena Move", kind: "pharmacist", hours: hrs });
  const sv = await t.api("POST", "/bookings/services", { name: "Move check", durationMin: 15, priceCents: 500, providerIds: [pr.provider.id] });
  const sid = sv.service.id, pid = pr.provider.id;
  await t.api("POST", "/bookings/senders", { kind: "brevo", apiKey: "test-key-not-real-0123456789", fromEmail: "bookings@demo.test", dailyCap: 0 });
  const st = await t.api("PUT", "/bookings/settings", { provider: "on", fromEmail: "bookings@demo.test", fromName: "Demo Pharmacy" });
  t.ok(st && st.ok, "e-mails switched on for the case: " + JSON.stringify(st).slice(0, 160));
  const D = ymd(3), person = { personName: "Mifsud Ġorġ", personPhone: "79001122", personEmail: "gorg.move@example.test" };
  const book = async (start, extra = {}) => (await t.api("POST", "/bookings", { serviceId: sid, providerId: pid, date: D, start, ...person, ...extra })).booking;
  const row = (id) => t.db.prepare("SELECT * FROM bk_bookings WHERE id = ?").get(id);
  const audit = (id) => t.db.prepare("SELECT * FROM audit_log WHERE entity_type = 'bk_bookings' AND entity_id = ? ORDER BY id DESC LIMIT 1").get(String(id));
  const msgs = (id) => t.db.prepare("SELECT kind, status FROM bk_messages WHERE booking_id = ? ORDER BY id").all(id);

  // 1. Staff: open the booking (the search's hand-over), Change time, 11:00 on the same day, Move.
  const A = await book("10:00");
  t.ok(A && A.id, "booking A made");
  const p = await t.page();
  await p.goto(t.base + "?ui=2#today");
  await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "today", null, { timeout: 20000 });
  await p.evaluate((o) => { sessionStorage.setItem("eikon_bk_open", JSON.stringify(o)); location.hash = "#bookings"; }, { id: A.id, date: D, at: Date.now() });
  await p.waitForSelector('.bkx-sheet [data-act="move"]', { timeout: 15000 });
  await p.click('.bkx-sheet [data-act="move"]');
  await p.waitForSelector(".bkx-sheet .bkx-slot", { timeout: 10000 });
  t.ok(await p.locator('.bkx-sheet #bkx-tell:checked').count() === 1, "the sheet shows the ticked 'Tell the customer by e-mail' (e-mails are set up, the booking has an address)");
  await p.locator(".bkx-sheet .bkx-slot", { hasText: /^11:00$/ }).first().click();
  t.ok(/^Move to .* at 11:00$/.test((await p.innerText('[data-act="mv-go"]')).trim()), "the button says where to: " + await p.innerText('[data-act="mv-go"]'));
  const sentBefore = sent.length, before = row(A.id);
  const w = await t.write(p, new RegExp("^/bookings/" + A.id + "$"), () => p.click('[data-act="mv-go"]'), "PATCH");
  t.ok(JSON.stringify(Object.keys(w.body || {})) === JSON.stringify(["version", "date", "start"]), "the PATCH body is exactly {version,date,start}: " + JSON.stringify(w.body));
  t.ok(w.body && w.body.version === before.version && w.body.date === D && w.body.start === "11:00", "with the version read and the new time: " + JSON.stringify(w.body));
  await p.waitForFunction(() => [...document.querySelectorAll(".eikon-toast")].some((e) => /Moved to .* at 11:00 · Mifsud Ġorġ is told by e-mail/.test(e.textContent)), null, { timeout: 8000 }).catch(() => {});
  t.ok(await p.evaluate(() => [...document.querySelectorAll(".eikon-toast")].some((e) => /Moved to .* at 11:00 · Mifsud Ġorġ is told by e-mail/.test(e.textContent))), "the toast says the move and that the customer is told");
  const staffRow = row(A.id), staffAudit = audit(A.id);
  t.has("staff move", staffRow, { date: D, start_time: "11:00", end_time: "11:15", provider_id: pid, status: "booked", version: before.version + 1 });
  const staffMail = sent.slice(sentBefore);
  t.ok(staffMail.length === 1, "the move sends exactly one e-mail (sent " + staffMail.length + ")");
  t.ok(staffMail.every((m) => /gorg\.move@example\.test/.test(m.body) && /Moved: Move check/.test(m.body)), "to the booking's own made-up address, as the server's 'Moved' message");
  t.ok(JSON.stringify(msgs(A.id).filter((m) => m.kind === "change")) === JSON.stringify([{ kind: "change", status: "sent" }]), "one 'change' message recorded: " + JSON.stringify(msgs(A.id)));
  t.ok(staffAudit && staffAudit.action === "BK_UPDATE" && /"date":"[^"]*"/.test(staffAudit.details_json) && staffAudit.details_json.includes(D) && staffAudit.details_json.includes("11:00"), "the audit line names the new time: " + (staffAudit && staffAudit.details_json));

  // 2. The customer's own link moves a twin booking (same person, same old time) to the same new time.
  await t.api("PATCH", "/bookings/" + A.id, { version: staffRow.version, status: "cancelled", cancelReason: "Case: free the time for the twin" });
  const B = await book("10:00");
  const confirm = sent.filter((m) => /Booked: Move check/.test(m.body)).pop();
  const tok = confirm && (/\/b\/([0-9a-f]{32}\.[0-9a-z]+\.[A-Za-z0-9_-]{43})/.exec(confirm.body) || [])[1];
  if (!t.ok(tok, "the twin's confirmation carries its private link")) return;
  const sentB = sent.length;
  const mv = await t.stack.app.api("POST", "/b/" + tok + "/move", { body: { date: D, start: "11:00" } });
  t.ok(mv.status === 200 && mv.json && mv.json.ok, "the customer's link moves the twin: " + mv.status + " " + (mv.text || "").slice(0, 120));
  const linkRow = row(B.id), linkAudit = audit(B.id);
  // staffRow was read before A was cancelled to free the time: every column is compared as each move stored it
  t.same("staff Change time vs the customer's own move", linkRow, staffRow, { ref: "each booking's own reference", link_id: "each booking's own private link" });
  t.ok(sent.length - sentB === 1, "the customer's move also sends one e-mail (sent " + (sent.length - sentB) + ")");
  t.ok(linkAudit && linkAudit.action === "BK_MOVE_ONLINE" && linkAudit.details_json.includes(D + " 11:00"), "the link's audit line names the same new time: " + (linkAudit && linkAudit.details_json));
  t.note("audit: staff " + staffAudit.action + " " + staffAudit.details_json + " · link " + linkAudit.action + " " + linkAudit.details_json);

  // 3. 409: the chosen time is taken at another counter before Move is pressed.
  const C = await book("12:00");
  await p.evaluate((o) => { sessionStorage.setItem("eikon_bk_open", JSON.stringify(o)); }, { id: C.id, date: D, at: Date.now() });
  await p.evaluate(() => { location.hash = "#today"; });
  await p.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 10000 });
  await p.evaluate(() => { location.hash = "#bookings"; });
  await p.waitForSelector('.bkx-sheet [data-act="move"]', { timeout: 15000 });
  await p.click('.bkx-sheet [data-act="move"]');
  await p.waitForSelector(".bkx-sheet .bkx-slot", { timeout: 10000 });
  await p.locator(".bkx-sheet .bkx-slot", { hasText: /^13:00$/ }).first().click();
  await t.api("POST", "/bookings", { serviceId: sid, providerId: pid, date: D, start: "13:00", personName: "Vella Rita", personPhone: "79009988" });
  const cBefore = row(C.id), sentC = sent.length;
  let r409 = null;
  try { [r409] = await Promise.all([p.waitForResponse((r) => r.request().method() === "PATCH" && new URL(r.url()).pathname === "/bookings/" + C.id, { timeout: 10000 }), p.click('[data-act="mv-go"]')]); } catch (e) { t.fail("no PATCH after Move: " + e.message.split("\n")[0]); }
  t.ok(r409 && r409.status() === 409, "a taken time answers 409 (" + (r409 && r409.status()) + ")");
  await p.waitForFunction(() => /Someone just took that time/.test((document.querySelector(".bkx-sheet") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  const after409 = await p.evaluate(() => ({ err: (document.querySelector(".bkx-sheet .bkx-err") || {}).textContent || "", slots: [...document.querySelectorAll(".bkx-sheet .bkx-slot")].map((b) => b.textContent), btn: (document.querySelector('[data-act="mv-go"]') || {}).textContent || "" }));
  t.ok(/Someone just took that time\. Here are the next free ones\./.test(after409.err) && after409.slots.length > 0 && !after409.slots.some((s) => /^13:00$/.test(s)) && /^Move to /.test(after409.btn), "the sheet says so and offers the next free times: " + JSON.stringify(after409));
  t.same("the booking after a refused move", cBefore, row(C.id));
  t.ok(sent.length === sentC, "a refused move sends no e-mail");
}
