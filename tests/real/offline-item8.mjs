// BACKLOG4 item 8 on the real stack (its own, on REAL_PORT): the offline banner, saves while offline, an answer dropped
// after the server saved (stubbed), dropped before it, a late save, E.postOnce, Emergency POS untouched, the refresh on
// return. Rows are counted through the API: no path makes a duplicate.
//   REAL_PORT=8990 node --no-warnings tests/real/offline-item8.mjs        (SHOTS=<prefix> to keep screenshots)
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
import { startStack } from "./stack.mjs";
const PORT = Number(process.env.REAL_PORT || 8895), B = "http://localhost:" + PORT, SH = process.env.SHOTS || "";
const stack = await startStack(PORT);
const out = {}; const ok = (k, v, info) => { out[k] = !!v; console.log((v ? "PASS " : "FAIL ") + k + (info ? "  " + info : "")); };
const tok = (await (await fetch(B + "/auth/login", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: JSON.stringify({ email: "maria@demo.mt", password: "Demo-Pass-2026" }) })).json()).token;
const api = async (p) => (await fetch(B + p, { headers: { authorization: "Bearer " + tok, origin: B } })).json();
const month = new Date().toISOString().slice(0, 7);
const ordersNamed = async (n) => ((await api("/client-orders/entries?month=" + month)).entries || []).filter((e) => e.client_name === n).length;
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: process.env.DARK ? "dark" : "light" }); const p = await ctx.newPage();
await p.route("**/*", (r) => new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort());
await p.goto(B + "/"); await p.waitForSelector("input[type=email]");
await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter"); await p.waitForTimeout(3000);
const bar = () => p.evaluate(() => { const el = document.getElementById("eikon-net"); return el ? { t: el.innerText.trim(), role: el.getAttribute("role"), live: el.getAttribute("aria-live") } : null; });
const err = () => p.evaluate(() => (document.querySelector("#ord-add .ord-ferr, #ord-add [role=alert], #ord-add .err") || {}).innerText || [...document.querySelectorAll("#ord-add *")].map((e) => e.childElementCount ? "" : e.innerText).filter((t) => /saved|connection/i.test(t || "")).join(" | "));
await p.evaluate(() => location.hash = "#ordreg"); await p.waitForTimeout(1500);
const y0 = await p.evaluate(() => document.querySelector("#eikon-content h1").getBoundingClientRect().top);
// 1. offline: banner within 1 s, nothing moves
await ctx.setOffline(true); const t0 = Date.now(); await p.waitForFunction(() => /No connection/.test((document.getElementById("eikon-net") || {}).innerText || ""), null, { timeout: 1000 }).catch(() => {});
const b1 = await bar(); ok("banner within 1 s, polite status", /No connection — what you type is kept/.test(b1.t) && b1.role === "status" && b1.live === "polite" && Date.now() - t0 < 1000, JSON.stringify(b1) + " " + (Date.now() - t0) + "ms");
{ const r = await p.evaluate(() => ({ bar: document.getElementById("eikon-net").getBoundingClientRect().bottom, h1: document.querySelector("#eikon-content h1").getBoundingClientRect().top })); ok("phone: the strip sits above the screen, which makes room for it", r.bar <= r.h1 && r.h1 - y0 <= 32, JSON.stringify({ ...r, y0 })); }
if (SH) await p.screenshot({ path: SH + "off-1-orders.png" });
// 2. save while offline: certain "not saved", typed kept, no request left
const fill = async (n) => { if (!(await p.locator("#ord-add").count())) await p.getByRole("button", { name: "New order" }).tap(); await p.getByLabel("Customer").fill(n); await p.getByLabel("Phone").fill("79000000"); await p.getByLabel("Items").fill("Panadol"); await p.locator("#ord-add [name=needed_by]").fill(new Date(Date.now() + 2 * 864e5).toISOString().slice(0, 10)); };
const save = async () => { await p.getByRole("button", { name: "Save order" }).tap(); await p.waitForFunction(() => !/Saving/.test((document.querySelector("#ord-add [type=submit]") || {}).innerText || ""), null, { timeout: 15000 }); await p.waitForTimeout(400); };
await fill("Test Offline"); await save();
const m2 = await p.locator("#ord-add").innerText();
ok("offline save says not saved, no connection", /Not saved: there is no connection/.test(m2), m2.split("\n").filter((l) => /saved/i.test(l)).join(" "));
ok("offline save keeps typed values", (await p.getByLabel("Items").inputValue()) === "Panadol" && (await p.getByLabel("Customer").inputValue()) === "Test Offline");
// The banner never covers the form's buttons (Cancel, Save order), wherever they are scrolled to
const clearOf = (pg, sel) => pg.evaluate((sel) => { const bar = document.getElementById("eikon-net").getBoundingClientRect(), hit = [];
  for (const el of document.querySelectorAll(sel)) for (const block of ["start", "center", "end"]) { el.scrollIntoView({ block }); const r = el.getBoundingClientRect(); if (r.bottom > bar.top && r.top < bar.bottom && r.right > bar.left && r.left < bar.right) hit.push(el.textContent.trim() + "@" + block); }
  return { n: document.querySelectorAll(sel).length, bar: [bar.top, bar.bottom, bar.left, bar.right].map(Math.round), hit }; }, sel);
{ const c = await clearOf(p, "#ord-add .acts button"); ok("phone: the banner covers neither Cancel nor Save order, at the top, middle or bottom of the window", c.n === 2 && !c.hit.length, JSON.stringify(c)); }
{ const dctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const dp = await dctx.newPage();
  await dp.route("**/*", (r) => new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort());
  await dp.goto(B + "/"); await dp.waitForSelector("input[type=email]"); await dp.fill("input[type=email]", "maria@demo.mt"); await dp.fill("input[type=password]", "Demo-Pass-2026"); await dp.keyboard.press("Enter"); await dp.waitForTimeout(3000);
  await dp.evaluate(() => location.hash = "#ordreg"); await dp.waitForTimeout(1500); await dp.getByRole("button", { name: "New order" }).click(); await dp.waitForTimeout(300);
  const h0 = await dp.evaluate(() => document.querySelector("#eikon-content h1").getBoundingClientRect().top);
  await dctx.setOffline(true); await dp.waitForTimeout(300);
  const h1 = await dp.evaluate(() => document.querySelector("#eikon-content h1").getBoundingClientRect().top), c = await clearOf(dp, "#ord-add .acts button");
  if (SH) await dp.screenshot({ path: SH + "desktop-offline-form.png" });
  ok("desktop: the banner is in the rail, the heading does not move, Cancel and Save order are never under it", h1 === h0 && c.n === 2 && !c.hit.length && c.bar[3] <= 236, JSON.stringify({ h0, h1, c }));
  await dctx.close(); }
if (SH) await p.screenshot({ path: SH + "off-2-save.png", fullPage: true });
// 3. back online: "Back online", one refresh of the list
let gets = 0; p.on("request", (r) => { if (r.method() === "GET" && /\/client-orders\/entries\?from=/.test(r.url())) gets++; });
await ctx.setOffline(false); await p.waitForTimeout(1500);
const b3 = await bar(); ok("Back online shown", /Back online/.test(b3.t), b3.t);
if (SH) await p.screenshot({ path: SH + "off-3-back.png", fullPage: false });
await p.waitForTimeout(3000); ok("list read once on return (the screen's own load)", gets === 1, "loads " + gets); ok("banner goes after", !(await bar()).t);
ok("typed values kept through the refresh", (await p.getByLabel("Items").inputValue()) === "Panadol");
await save(); ok("then saved once", (await ordersNamed("Test Offline")) === 1, "rows " + (await ordersNamed("Test Offline")));
// 4. answer dropped AFTER the server saved it (Orders uses E.landedOk: the form closes as saved)
await fill("Dropped After"); await p.waitForTimeout(300);
await p.route("**/client-orders/entries", async (r) => { if (r.request().method() !== "POST") return r.continue(); await r.fetch(); await r.abort("connectionreset"); }, { times: 1 });
const toasts = []; await p.exposeFunction("__toast", (t) => toasts.push(t)).catch(() => {});
await p.evaluate(() => new MutationObserver((ms) => ms.forEach((m) => m.addedNodes.forEach((n) => n.classList && n.classList.contains("eikon-toast") && window.__toast(n.innerText)))).observe(document.body, { childList: true, subtree: true }));
await p.getByRole("button", { name: "Save order" }).tap(); await p.waitForTimeout(2500);
ok("dropped after commit: counted as saved, form closed, one row", !(await p.locator("#ord-add").count()) && (await ordersNamed("Dropped After")) === 1 && toasts.some((t) => /Saved · order for Dropped After/.test(t)), "rows " + (await ordersNamed("Dropped After")) + " · " + toasts.join(" / "));
if (SH) await p.screenshot({ path: SH + "drop-1-saved.png", fullPage: false });
await p.getByRole("button", { name: "Not now" }).tap().catch(() => {});
await p.getByRole("button", { name: "New order" }).tap().catch(() => {});
// 5. connection dropped BEFORE the server got it (online)
await fill("Dropped Before"); await p.waitForTimeout(300);
await p.route("**/client-orders/entries", (r) => r.request().method() === "POST" ? r.abort("connectionreset") : r.continue(), { times: 1 });
await save(); const m5 = await p.locator("#ord-add").innerText();
ok("dropped before the server: says not saved, try again", /Not saved: the connection dropped\. Try again/.test(m5) && (await ordersNamed("Dropped Before")) === 0, m5.split("\n").filter((l) => /saved/i.test(l)).join(" "));
if (SH) await p.screenshot({ path: SH + "drop-2-notsaved.png", fullPage: true });
await save(); ok("try again saves it once", (await ordersNamed("Dropped Before")) === 1, "rows " + (await ordersNamed("Dropped Before")));
// 6. timeout-like: no list to compare (unknown) → plain "could not tell"
await fill("Unknown One"); await p.waitForTimeout(300);
await p.route("**/client-orders/entries**", (r) => r.abort("connectionreset"), { times: 2 }); // the POST and the check both drop
await save(); const m6 = await p.locator("#ord-add").innerText();
ok("cannot check: says so plainly", /We could not tell if it was saved\. Check the list before trying again/.test(m6), m6.split("\n").filter((l) => /saved|tell/i.test(l)).join(" "));
if (SH) await p.screenshot({ path: SH + "drop-3-unknown.png", fullPage: true });
await save(); ok("retry after unknown: one row", (await ordersNamed("Unknown One")) === 1, "rows " + (await ordersNamed("Unknown One")));
// 7. late commit: the first check says not there, the server saves a moment later, the retry finds it
await p.getByRole("button", { name: "New order" }).tap().catch(() => {});
await fill("Late Commit"); await p.waitForTimeout(300);
let release; const late = new Promise((r) => release = r);
await p.route("**/client-orders/entries", async (r) => { if (r.request().method() !== "POST") return r.continue(); const req = r.request(); await r.abort("connectionreset"); await late; await fetch(B + "/client-orders/entries", { method: "POST", headers: { authorization: req.headers()["authorization"], "content-type": "application/json", origin: B }, body: req.postData() }); }, { times: 1 });
await save(); const m7 = await p.locator("#ord-add").innerText();
release(); await p.waitForTimeout(500);
await p.getByRole("button", { name: "Save order" }).tap(); await p.waitForTimeout(2500); const m7b = (await p.locator("#ord-add").count()) ? await p.locator("#ord-add").innerText() : "(form closed as saved) " + toasts.slice(-1);
ok("late commit: retry finds it, one row", (await ordersNamed("Late Commit")) === 1 && /form closed as saved/.test(m7b), "rows " + (await ordersNamed("Late Commit")) + " · first: " + m7.split("\n").filter((l) => /saved/i.test(l)).join(" ") + " · then: " + m7b.split("\n").filter((l) => /saved/i.test(l)).join(" "));
// 7b. the shared path without E.landedOk (any rebuilt create): Cleaning, through E.apiFetch on the screen
await p.getByRole("button", { name: "Not now" }).tap().catch(() => {});
await p.evaluate(() => location.hash = "#cleanreg"); await p.waitForTimeout(2000);
const cbody = { entry_date: new Date().toISOString().slice(0, 10), time_in: "09:00", time_out: "09:30", cleaner_name: "Ċensu Zammit", staff_name: "Maria", notes: "" };
const cleans = async () => ((await api("/cleaning/entries?month=" + month)).entries || []).filter((e) => e.cleaner_name === "Ċensu Zammit").length;
await p.route("**/cleaning/entries", async (r) => { if (r.request().method() !== "POST") return r.continue(); await r.fetch(); await r.abort("connectionreset"); }, { times: 1 });
const g1 = await p.evaluate(async (bd) => { const E = window.EIKON; try { await E.apiFetch("/cleaning/entries", { method: "POST", body: JSON.stringify(bd) }); return "ok"; } catch (x) { return E.saveFailText(x); } }, cbody);
const g2 = await p.evaluate(async (bd) => { const E = window.EIKON; try { await E.apiFetch("/cleaning/entries", { method: "POST", body: JSON.stringify(bd) }); return "ok"; } catch (x) { return E.saveFailText(x); } }, cbody);
ok("shared path, dropped after commit: 'It was saved', then 'saved already', one row", /^It was saved:/.test(g1) && /saved already/.test(g2) && (await cleans()) === 1, g1 + " · " + g2 + " · rows " + (await cleans()));
// 8. a postOnce screen (order diary): dropped after commit → saved; offline → not saved; late commit → retry finds it
const diary = async (n) => ((await api("/order-diary/entries?date=" + new Date().toISOString().slice(0, 10))).entries || []).filter((e) => e.item_name === n).length;
await p.evaluate(() => location.hash = "#odreg"); await p.waitForTimeout(1500);
const dfill = async (n) => { if (!(await p.locator("#odr-add").count())) await p.getByRole("button", { name: "Add an item" }).tap(); await p.locator("#odr-add [name=item_name]").fill(n); await p.locator("#odr-add [name=qty]").fill("2"); };
const dsave = async () => { await p.locator("#odr-add [type=submit]").tap(); await p.waitForFunction(() => !/Saving/.test((document.querySelector("#odr-add [type=submit]") || {}).innerText || ""), null, { timeout: 15000 }); await p.waitForTimeout(400); };
const dmsg = () => p.evaluate(() => (document.querySelector("#odr-add .odr-err") || {}).innerText || (document.querySelector("#odr-add") ? "(no message)" : "(form closed)"));
await dfill("Diary Drop After"); await p.route("**/order-diary/entries", async (r) => { if (r.request().method() !== "POST") return r.continue(); await r.fetch(); await r.abort("connectionreset"); }, { times: 1 });
await dsave(); ok("postOnce, dropped after commit: counted as saved, one row", (await diary("Diary Drop After")) === 1 && (await dmsg()) === "(form closed)", await dmsg());
await dfill("Diary Offline"); await ctx.setOffline(true); await dsave(); const d2 = await dmsg(); if (SH) await p.screenshot({ path: SH + "drop-4-diary-offline.png", fullPage: true });
ok("postOnce, offline: not saved, no connection", /Not saved: there is no connection/.test(d2), d2); await ctx.setOffline(false); await p.waitForTimeout(1500);
await dsave(); ok("postOnce, offline then save: one row", (await diary("Diary Offline")) === 1, "rows " + (await diary("Diary Offline")));
await dfill("Diary Late"); let rel2; const late2 = new Promise((r) => rel2 = r);
await p.route("**/order-diary/entries", async (r) => { if (r.request().method() !== "POST") return r.continue(); const req = r.request(); await r.abort("connectionreset"); await late2; await fetch(B + "/order-diary/entries", { method: "POST", headers: { authorization: req.headers()["authorization"], "content-type": "application/json", origin: B }, body: req.postData() }); }, { times: 1 });
await dsave(); const d3 = await dmsg(); rel2(); await p.waitForTimeout(500); await dsave();
ok("postOnce, late commit: first says not saved, retry adds nothing more", /Not saved: the connection dropped/.test(d3) && (await diary("Diary Late")) === 1, d3 + " · rows " + (await diary("Diary Late")));
// 8b. Emergency POS keeps its own queue: its POST is passed through untouched (no check, no extra read, no verdict)
let eposGets = 0; p.on("request", (r) => { if (r.method() === "GET" && /emergency-pos\/sales/.test(r.url())) eposGets++; });
await p.route("**/emergency-pos/sales", (r) => r.request().method() === "POST" ? r.abort("connectionreset") : r.continue(), { times: 1 });
const ep = await p.evaluate(async () => { const E = window.EIKON; try { await E.apiFetch("/emergency-pos/sales", { method: "POST", body: JSON.stringify({ offline_id: "q48-test", lines: [] }) }); return "ok"; } catch (x) { return JSON.stringify({ network: !!x.network, landed: x.landed, notSent: !!x.notSent }); } });
await p.waitForTimeout(1000); ok("Emergency POS POST untouched by the check", ep === '{"network":true,"notSent":false}' && eposGets === 0, ep + " · extra reads " + eposGets);
// 9. a screen opened while offline, untouched, reads itself again on return (no hook)
await ctx.setOffline(true); await p.evaluate(() => location.hash = "#cnreg"); await p.waitForTimeout(1500);
const c1 = await p.evaluate(() => document.getElementById("eikon-content").innerText);
await ctx.setOffline(false); await p.waitForTimeout(3000);
const c2 = await p.evaluate(() => document.getElementById("eikon-content").innerText);
ok("a screen opened offline reads itself again on return", /reach the server/i.test(c1) && !/reach the server/i.test(c2), JSON.stringify([c1.replace(/\n+/g," | ").slice(0,300), c2.replace(/\n+/g," | ").slice(0,300)]));
const f = Object.values(out).filter((v) => !v).length; console.log(Object.keys(out).length - f + " passed, " + f + " failed");
await b.close(); await stack.close();
process.exit(f ? 1 : 0);
