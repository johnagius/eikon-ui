import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
const [port, out] = process.argv.slice(2); const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 402, height: 874 }, deviceScaleFactor: 2 }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.route("**/*", (r) => { const u = r.request().url(); if (u.includes("xlsx.full.min.js")) return r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }); return new URL(u).hostname === "localhost" ? r.continue() : r.abort(); });
await p.goto(`http://localhost:${port}/ui/next.html`); await p.waitForTimeout(1500);
await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
const pb = p.getByText("Pharmacy", { exact: true }); if (await pb.count()) { await pb.first().click(); await p.waitForTimeout(2000); }
await p.evaluate(() => { location.hash = "#bookings"; }); await p.waitForTimeout(1500);
if (await p.getByText("Set up bookings").count()) { await p.click("[data-act=setup]"); await p.waitForTimeout(1500); }
await p.click("[data-act=settings]"); await p.waitForTimeout(500); await p.click("[data-act=tab][data-t=messages]"); await p.waitForTimeout(800);
await p.fill("#bkm-from", "bookings@demo.mt"); await p.selectOption("#bkm-provider", "smtp"); await p.waitForTimeout(300);
ok(await p.locator("#bkm-host").count() === 1 && (await p.inputValue("#bkm-from")) === "bookings@demo.mt", "choosing SMTP shows server fields and keeps what was typed");
await p.fill("#bkm-host", "smtp.example.com"); await p.selectOption("#bkm-sec", "starttls"); await p.fill("#bkm-user", "bookings@demo.mt"); await p.fill("#bkm-key", "pw");
await p.click("[data-act=msg-save]"); await p.waitForTimeout(900);
const st = await p.evaluate(async () => (await window.EIKON.apiFetch("/bookings/settings")).settings);
ok(st.provider === "smtp" && st.smtpHost === "smtp.example.com" && st.smtpPort === 587 && st.smtpSecure === "starttls" && st.hasKey, "SMTP settings saved (587 STARTTLS)");
await p.locator("#bkm-host").scrollIntoViewIfNeeded(); await p.screenshot({ path: `${out}/smtp-settings.png` });
ok(errs.length === 0, "no page errors"); await b.close();
