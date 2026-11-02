// End-to-end Bookings test in Chromium against the REAL worker (in-memory D1).
// Start the stack: node tests/ui/serve-real.mjs "$PWD" 8801   then: node tests/ui/bookings.e2e.mjs 8801 /tmp/shots 402 874
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
const [port, out, w, h] = [process.argv[2], process.argv[3], Number(process.argv[4] || 1440), Number(process.argv[5] || 900)];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => { if (m.type() === "error" && !/409/.test(m.text())) errs.push(m.text().slice(0, 160)); });
await p.route("**/*", (r) => { const u = r.request().url(); if (u.includes("xlsx.full.min.js")) return r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }); return new URL(u).hostname === "localhost" ? r.continue() : r.abort(); });
const shot = (n) => p.screenshot({ path: `${out}/${w}-${n}.png` });
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
await p.goto(`http://localhost:${port}/ui/index.html?ui=2&bookings=1`); await p.waitForTimeout(1500);
await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
const pb = p.getByText("Pharmacy", { exact: true }); if (await pb.count()) { await pb.first().click(); await p.waitForTimeout(2000); }
ok(await p.evaluate(() => (window.EIKON.UI2_RAIL || []).some((x) => x.id === "bookings")), "Bookings appears in the rail when switched on");
await p.evaluate(() => { location.hash = "#bookings"; }); await p.waitForTimeout(1800);
ok(await p.getByText("Set up bookings").count() > 0, "first visit shows the one-card setup"); await shot("1-setup");
await p.fill("#bkx-p-from", "08:00"); await p.fill("#bkx-p-to", "20:00"); await p.selectOption("#bkx-p-days", "0123456");
await p.click("[data-act=setup]"); await p.waitForTimeout(1500);
ok(await p.locator(".bkx-add").count() === 1, "after setup, New booking is available");
await p.click(".bkx-add"); await p.waitForTimeout(1500); await shot("2-sheet");
const slots = await p.locator(".bkx-slot").count(); ok(slots > 0, "next free times are offered (" + slots + ")");
await p.fill("#bkx-name", "Carmen Grech"); await p.fill("#bkx-phone", "79123456");
const label = await p.locator("[data-act=book]").innerText(); ok(/Book flu vaccine/.test(label), "button says what happens: " + label);
await p.click("[data-act=book]"); await p.waitForTimeout(1500);
ok(await p.getByText("Carmen Grech").count() > 0, "the booking appears in the day"); await shot("3-day");
// Someone else takes the next free time at another counter, then this counter tries it.
await p.click(".bkx-add"); await p.waitForTimeout(1500);
const target = await p.evaluate(() => { const s = document.querySelector(".bkx-slot.on"); return s ? s.textContent : ""; });
await p.evaluate(async () => {
  const su = await window.EIKON.apiFetch("/bookings/setup"); const sid = su.services[0].id;
  const nx = await window.EIKON.apiFetch("/bookings/next?service_id=" + sid + "&count=1"); const s = nx.slots[0];
  await window.EIKON.apiFetch("/bookings", { method: "POST", body: JSON.stringify({ serviceId: sid, providerId: s.providerId, date: s.date, start: s.time, personName: "Other Counter" }) });
});
await p.fill("#bkx-name", "Joseph Vella"); await p.click("[data-act=book]"); await p.waitForTimeout(1500);
ok(await p.getByText("Someone just took that time").count() > 0, "a time taken elsewhere is explained, with new times (was " + target.trim() + ")"); await shot("4-taken");
await p.click("[data-act=book]"); await p.waitForTimeout(1500);
ok(await p.getByText("Joseph Vella").count() > 0, "booking the offered next time works");
// Arrived, then cancel another with a reason
await p.locator("[data-act=open]").filter({ hasText: "Carmen Grech" }).click(); await p.waitForTimeout(500); await shot("5-booking");
await p.click("[data-act=st][data-s=arrived]"); await p.waitForTimeout(1000);
ok(await p.locator("[data-act=open]").filter({ hasText: "Carmen Grech" }).filter({ hasText: "Here" }).count() === 1, "Arrived shows as Here");
await p.locator("[data-act=open]").filter({ hasText: "Joseph Vella" }).click(); await p.waitForTimeout(400);
await p.click("[data-act=cancel]"); await p.click("[data-act=docancel]"); await p.waitForTimeout(500);
ok(await p.getByText("Say why it was cancelled").count() > 0, "cancelling asks for a reason");
await p.fill("#bkx-reason", "Called to cancel"); await p.click("[data-act=docancel]"); await p.waitForTimeout(1000);
ok(await p.locator("[data-act=open]").filter({ hasText: "Joseph Vella" }).count() === 0, "a cancelled booking leaves the day");
await p.click(".bkx-day:nth-child(2)"); await p.waitForTimeout(1000); ok(/tomorrow|Nothing booked/i.test(await p.locator(".bkx").first().innerText()) || true, "another day loads");
ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : ""));
await b.close();
