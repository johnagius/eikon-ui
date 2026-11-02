import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
const [port, out] = process.argv.slice(2); const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.route("**/*", (r) => { const u = r.request().url(); if (u.includes("xlsx.full.min.js")) return r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }); return new URL(u).hostname === "localhost" ? r.continue() : r.abort(); });
await p.goto(`http://localhost:${port}/ui/next.html`); await p.waitForTimeout(1500);
await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
const pb = p.getByText("Pharmacy", { exact: true }); if (await pb.count()) { await pb.first().click(); await p.waitForTimeout(2000); }
await p.evaluate(() => { location.hash = "#bookings"; }); await p.waitForTimeout(1500);
if (await p.getByText("Set up bookings").count()) { await p.click("[data-act=setup]"); await p.waitForTimeout(1500); }
await p.click("[data-act=settings]"); await p.waitForTimeout(600);
const box = p.locator("[data-svc]").first(); await box.locator("[data-k=online]").check(); await box.locator("[data-act=svc-save]").click(); await p.waitForTimeout(900);
ok(await p.evaluate(async () => (await window.EIKON.apiFetch("/bookings/setup")).services[0].online === true), "a service can be marked Online");
await p.click("[data-act=tab][data-t=messages]"); await p.waitForTimeout(800);
await p.check("#bkm-public"); await p.click("[data-act=msg-save]"); await p.waitForTimeout(900);
ok(await p.getByText("Switch on emails first").count() > 0, "online booking needs emails first, and says so");
await p.selectOption("#bkm-provider", "resend"); await p.fill("#bkm-key", "re_x"); await p.fill("#bkm-from", "b@demo.mt"); await p.check("#bkm-public"); await p.click("[data-act=msg-save]"); await p.waitForTimeout(900);
const link = await p.locator("a[href*='/book/']").getAttribute("href").catch(() => "");
ok(/\/book\/[a-z0-9-]+$/.test(link || ""), "the pharmacy's booking link is shown: " + link);
await p.locator("#bkm-public").scrollIntoViewIfNeeded(); await p.screenshot({ path: `${out}/pub-settings.png` });
const q = await p.request.get(link); ok(q.status() === 200, "the link opens the booking page");
ok(errs.length === 0, "no page errors"); await b.close();
