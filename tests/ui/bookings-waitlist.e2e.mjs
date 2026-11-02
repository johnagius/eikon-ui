import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
const [port, out, w, h] = [process.argv[2], process.argv[3], Number(process.argv[4] || 402), Number(process.argv[5] || 874)];
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: w < 500 ? 2 : 1 });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
await p.route("**/*", (r) => { const u = r.request().url(); if (u.includes("xlsx.full.min.js")) return r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }); return new URL(u).hostname === "localhost" ? r.continue() : r.abort(); });
await p.goto(`http://localhost:${port}/ui/next.html`); await p.waitForTimeout(1500);
await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
const pb = p.getByText("Pharmacy", { exact: true }); if (await pb.count()) { await pb.first().click(); await p.waitForTimeout(2000); }
await p.evaluate(async () => { const E = window.EIKON; const all = {}; for (let x = 0; x <= 6; x++) all[x] = [["08:00", "21:00"]];
  const pr = await E.apiFetch("/bookings/providers", { method: "POST", body: JSON.stringify({ name: "Maria Borg", hours: all }) });
  await E.apiFetch("/bookings/services", { method: "POST", body: JSON.stringify({ name: "Flu vaccine", durationMin: 10, providerIds: [pr.provider.id] }) }); });
await p.evaluate(() => { location.hash = "#bookings"; }); await p.waitForTimeout(1500);
// Rita joins the waiting list from the booking sheet
await p.click(".bkx-add"); await p.waitForTimeout(1200);
await p.fill("#bkx-name", "Rita Camilleri"); await p.fill("#bkx-phone", "79111111"); await p.click("[data-act=wl-add]"); await p.waitForTimeout(1200);
ok(await p.locator("[data-act=wl-book]").count() === 1, "Rita is on the waiting list");
// Carmen is booked, then cancels
await p.click(".bkx-add"); await p.waitForTimeout(1200); await p.fill("#bkx-name", "Carmen Grech");
const when = await p.locator(".bkx-slot.on").innerText(); await p.click("[data-act=book]"); await p.waitForTimeout(1500);
await p.locator("[data-act=open]").filter({ hasText: "Carmen Grech" }).click(); await p.waitForTimeout(400);
await p.click("[data-act=cancel]"); await p.fill("#bkx-reason", "Called to cancel"); await p.click("[data-act=docancel]"); await p.waitForTimeout(1500);
ok(await p.getByText("A time just freed up").count() === 1, "cancelling offers the freed time (" + when.replace(/\s+/g, " ") + ") to the person waiting");
await p.screenshot({ path: `${out}/wait-offer-${w}.png` });
await p.click("[data-act=offer-book]"); await p.waitForTimeout(1500);
ok(await p.locator("[data-act=open]").filter({ hasText: "Rita Camilleri" }).count() === 1, "Rita is booked into the freed time");
ok(await p.locator("[data-act=wl-book]").count() === 0, "and is off the waiting list");
await p.screenshot({ path: `${out}/wait-after-${w}.png` });
ok(errs.length === 0, "no page errors" + (errs.length ? ": " + errs.join(" | ") : "")); await b.close();
