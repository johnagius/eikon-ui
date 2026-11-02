import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
const [port, out] = process.argv.slice(2); const b = await chromium.launch();
const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) process.exitCode = 1; };
for (const [w, h, d] of [[1440, 900, 1], [402, 874, 2]]) {
  const p = await b.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: d }); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.route("**/*", (r) => { const u = r.request().url(); if (u.includes("xlsx.full.min.js")) return r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }); return new URL(u).hostname === "localhost" ? r.continue() : r.abort(); });
  let calls = 0; p.on("request", (r) => { if (/\/bookings\?from=/.test(r.url())) calls++; });
  await p.goto(`http://localhost:${port}/ui/next.html`); await p.waitForTimeout(1500);
  if (await p.locator("input[type=password]").count()) { await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
    const pb = p.getByText("Pharmacy", { exact: true }); if (await pb.count()) { await pb.first().click(); await p.waitForTimeout(2000); } }
  if (w > 500) await p.evaluate(async () => {
    const E = window.EIKON; let su = await E.apiFetch("/bookings/setup");
    if (!su.services.length) { const all = {}; for (let x = 0; x <= 6; x++) all[x] = [["08:00", "21:00"]];
      const pr = await E.apiFetch("/bookings/providers", { method: "POST", body: JSON.stringify({ name: "Maria Borg", hours: all }) });
      await E.apiFetch("/bookings/services", { method: "POST", body: JSON.stringify({ name: "Flu vaccine", durationMin: 10, providerIds: [pr.provider.id] }) }); su = await E.apiFetch("/bookings/setup"); }
    const names = ["Carmen Grech", "Joseph Vella", "Rita Camilleri", "Paul Borg", "Anna Zammit", "Mark Farrugia", "Doris Attard"];
    const t = new Date(); for (let i = 1; i <= 6; i++) { const dd = new Date(t); dd.setDate(t.getDate() + i); const ymd = dd.toISOString().slice(0, 10);
      const sl = await E.apiFetch("/bookings/slots?service_id=" + su.services[0].id + "&date=" + ymd);
      for (let k = 0; k < (i % 3) + 1 && k < sl.slots.length; k++) { const s = sl.slots[k * 5]; if (!s) break; await E.apiFetch("/bookings", { method: "POST", body: JSON.stringify({ serviceId: su.services[0].id, providerId: s.providerId, date: ymd, start: s.time, personName: names[(i + k) % 7] }) }); } }
  });
  await p.evaluate(() => { location.hash = "#bookings"; }); await p.waitForTimeout(1500);
  calls = 0; await p.click("[data-act=view][data-v=week]"); await p.waitForTimeout(1200);
  ok(calls === 1, w + ": the week loads in one call (" + calls + ")");
  ok(await p.locator(".bkx-wcol").count() === 7, w + ": seven days shown");
  await p.screenshot({ path: `${out}/week-${w}.png`, fullPage: w < 500 });
  await p.locator(".bkx-wh").nth(2).click(); await p.waitForTimeout(1000);
  ok(await p.locator(".bkx-days").count() === 1 && await p.locator(".bkx-day.on").count() === 1, w + ": tapping a day opens that day");
  ok(errs.length === 0, w + ": no page errors"); await p.close(); }
await b.close();
