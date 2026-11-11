// Roster planner B5: "Tell me when my shifts change" — Web Push on the real stack. The browser's push service is the only
// stand-in: PushManager.subscribe is stubbed in the page (headless Chromium has no push service) to hand back an
// fcm.googleapis.com address, and the worker's request to that address is caught here (nothing leaves the machine).
// Everything else is real: the worker's /sw.js registered in Chromium, the toggle in Who's in › Mine, permission on the
// tap, the subscribe row, a shift change through the page's own engine (E.rotaPlan → W1 /shifts/apply-plan) and through
// the classic edit body, exactly one push each, the push delivered to the real service worker (CDP), which reads its words
// from /rota/notices and shows the notification; and with the service worker registered every page and file still comes
// from the network (an old and a new build of index.html, classic too). axe on the toggle (AXE=path to axe.min.js).
import fs from "node:fs";
import { generateKeyPairSync } from "node:crypto";
import { rpSeed } from "./_rpseed.mjs";
export const title = "Rota notices: Web Push toggle, one push per save, notification words, fresh loads with /sw.js";

const AXE = process.env.AXE || "/tmp/claude-0/-home-user-eikon-ui/a14b1a07-7863-5333-b96b-a89485eb56dd/scratchpad/axe/node_modules/axe-core/axe.min.js";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"], MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayWords = (ymd) => { const d = new Date(ymd + "T12:00:00Z"); return DAYS[d.getUTCDay()] + " " + d.getUTCDate() + " " + MON[d.getUTCMonth()]; };

// The page side of the stand-in push service: a subscription that lives in localStorage (so it survives reloads).
function fakePush(tag) {
  const KEY = "rpp_fake_sub_" + tag;
  const mk = (o) => o && { endpoint: o.endpoint, expirationTime: null, options: { userVisibleOnly: true, applicationServerKey: new Uint8Array(o.key).buffer },
    toJSON() { return { endpoint: o.endpoint, expirationTime: null, keys: { p256dh: "BPfake" + o.n, auth: "authfake" + o.n } }; },
    unsubscribe: async () => { localStorage.removeItem(KEY); return true; } };
  PushManager.prototype.getSubscription = async function () { try { return mk(JSON.parse(localStorage.getItem(KEY))); } catch (e) { return null; } };
  PushManager.prototype.subscribe = async function (opt) {
    const n = Math.random().toString(36).slice(2, 10), o = { endpoint: "https://fcm.googleapis.com/fcm/send/rp-push-" + n, key: [...new Uint8Array(opt.applicationServerKey)], n };
    localStorage.setItem(KEY, JSON.stringify(o)); window.__rppSubscribes = (window.__rppSubscribes || 0) + 1; return mk(o);
  };
}

export async function run(t) {
  const S = await rpSeed(t, { tag: "push", weeks: 3 });
  const app = t.stack.app, hadKey = app.env.VAPID_PRIVATE_KEY;
  app.env.VAPID_PRIVATE_KEY = generateKeyPairSync("ec", { namedCurve: "P-256" }).privateKey.export({ type: "pkcs8", format: "der" }).toString("base64");
  // The push services: caught before the stack's "no outbound request" guard. Only this case's devices are counted.
  const pushes = [], prev = globalThis.fetch;
  globalThis.fetch = async (u, init) => { const s = String(u && u.url || u); if (s.startsWith("https://fcm.googleapis.com/fcm/send/rp-push-")) { pushes.push({ url: s, auth: new Headers(init && init.headers).get("authorization") }); return new Response("", { status: 201 }); } return prev(u, init); };
  const settle = async (n, ms = 4000) => { const t0 = Date.now(); while (Date.now() - t0 < ms && pushes.length < n) await new Promise((r) => setTimeout(r, 50)); await new Promise((r) => setTimeout(r, 400)); return pushes.length; };
  const axeOn = fs.existsSync(AXE), axeSrc = axeOn ? fs.readFileSync(AXE, "utf8") : "";
  const axe = async (p, label) => {
    if (process.env.B5_SHOTS) await p.locator(".rot-mine").screenshot({ path: process.env.B5_SHOTS + "/" + label.replace(/[^a-z0-9]+/gi, "-") + ".png" }).catch(() => {});
    if (!axeOn) return;
    await p.evaluate(axeSrc);
    const v = await p.evaluate(async () => (await window.axe.run(document.querySelector(".rot-mine") || document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((x) => x.id + " " + x.nodes[0].target.join(" ")));
    t.ok(!v.length, "axe " + label + ": " + v.join(" | "));
  };
  try {
    // ---- 1. the toggle in Mine, permission only on the tap, subscribe
    const p = await S.page();
    const ctx = p.context();
    await ctx.addInitScript(fakePush, "a");
    await ctx.grantPermissions(["notifications"], { origin: t.stack.base });
    const swReq = [];
    p.on("request", (r) => { if (new URL(r.url()).pathname === "/sw.js") swReq.push(r.url()); });
    await t.open(p, "2", "rotreg", "rotreg", ".rot-mine");
    const sw = p.locator(".rpp-sw");
    await sw.waitFor({ timeout: 8000 });
    t.ok(await p.locator("#rpp-l").innerText() === "Tell me when my shifts change", "the row's words");
    t.ok(await sw.getAttribute("role") === "switch" && await sw.getAttribute("aria-checked") === "false", "a switch, off");
    t.ok(await p.evaluate(() => navigator.serviceWorker.getRegistration("/").then((r) => !r)), "nothing registered before the tap (the app loads as before)");
    t.ok(!swReq.length, "no /sw.js request on screen open");
    const box = await sw.boundingBox();
    t.ok(box && box.height >= 44 && box.width >= 44, "44 px target: " + JSON.stringify(box));
    await axe(p, "toggle off, 1280 light");
    const subRes = await t.write(p, /^\/rota\/push\/subscribe$/, () => sw.click());
    t.ok(subRes.json && subRes.json.ok && subRes.json.push === true && subRes.json.id, "subscribed: " + JSON.stringify(subRes.json && { ok: subRes.json.ok, push: subRes.json.push }));
    t.ok(subRes.body && Number(subRes.body.staff_id) === Number(S.ids.maria) && /^https:\/\/fcm\.googleapis\.com\//.test(subRes.body.subscription.endpoint), "for the person Mine shows (Marija), with the push address");
    await p.waitForFunction(() => document.querySelector(".rpp-sw") && document.querySelector(".rpp-sw").getAttribute("aria-checked") === "true", null, { timeout: 8000 }).catch(async (e) => { throw new Error("not on: " + (await p.locator(".rpp").innerText()) + " " + JSON.stringify(await p.evaluate(() => window.EIKON.rotaPush.state()))); });
    t.ok(/On\. You will get a notification/.test(await p.locator(".rpp").innerText()), "says it is on");
    const reg = await p.evaluate(async () => { const r = await navigator.serviceWorker.getRegistration("/"); return r && { scope: r.scope, script: (r.active || r.waiting || r.installing || {}).scriptURL }; });
    t.ok(reg && reg.scope === t.stack.base + "/" && reg.script === t.stack.base + "/sw.js", "the worker's /sw.js, scope / (covers the clean addresses and /ui/): " + JSON.stringify(reg));
    const row = t.db.prepare("SELECT staff_id, location_id, secret_hash, endpoint FROM push_subscriptions WHERE location_id = ?").all(S.loc);
    t.ok(row.length === 1 && row[0].staff_id === S.ids.maria && row[0].secret_hash.length === 64, "one device row, Marija's, secret hashed");
    await axe(p, "toggle on, 1280 light");
    await p.emulateMedia({ colorScheme: "dark" }); await axe(p, "toggle on, 1280 dark"); await p.emulateMedia({ colorScheme: "light" });

    // ---- 2. a shift change through the page's own engine (W1 one step): exactly one push, the right words
    pushes.length = 0;
    const from = S.d(14), to = S.d(18);
    const res = await p.evaluate(async ({ sid, from, to }) => {
      const E = window.EIKON, staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff, me = staff.find((x) => Number(x.id) === sid);
      const hours = (await E.apiFetch("/shifts/opening-hours", { method: "GET" })), settings = (await E.apiFetch("/shifts/settings", { method: "GET" })).settings;
      const x = E.rotaPlan.weekdays({ people: [me], from, to, weekdays: [1, 2, 3, 4, 5], every: 1, block: { start: "08:00", end: "14:00" }, data: { staff, shifts: [], leaves: [], hours: hours.hours || hours, settings }, mode: "keep" });
      const r = await E.rotaPlan.apply(x); return { done: r.done, words: r.words, adds: x[0].add.length };
    }, { sid: S.ids.maria, from, to });
    t.ok(res.done && res.adds === 5, "the engine applied Mon–Fri week 3: " + JSON.stringify(res));
    t.ok(await settle(1) === 1, "exactly one push for that save (5 shifts): " + pushes.length);
    t.ok(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]{87}$/.test(pushes[0] && pushes[0].auth || ""), "VAPID-signed");
    const want1 = "Your shifts changed on 5 days, " + dayWords(from) + " – " + dayWords(to);
    t.ok(t.db.prepare("SELECT text FROM rota_notices WHERE location_id = ? ORDER BY id DESC").get(S.loc).text === want1, "notice: " + want1);

    // ---- 3. the push reaches the real service worker: it reads the words and shows the notification; tap → Who's in
    const cdp = await ctx.newCDPSession(p);
    const regs = []; cdp.on("ServiceWorker.workerRegistrationUpdated", (e) => regs.push(...e.registrations));
    await cdp.send("ServiceWorker.enable");
    for (let i = 0; i < 40 && !regs.some((r) => r.scopeURL === t.stack.base + "/"); i++) await p.waitForTimeout(50);
    const rid = (regs.find((r) => r.scopeURL === t.stack.base + "/") || {}).registrationId;
    t.ok(rid, "the service worker is known to the browser");
    // Headless Chromium refuses to put notifications on screen, so the service worker's showNotification call itself is
    // recorded (inside the real worker, via Playwright's handle on it) and then passed on.
    const swh = ctx.serviceWorkers().find((w) => w.url() === t.stack.base + "/sw.js");
    t.ok(swh, "Playwright sees the running /sw.js");
    if (rid && swh) {
      await swh.evaluate(() => { self.__shown = []; const reg = self.registration, orig = reg.showNotification.bind(reg); reg.showNotification = (title, o) => { self.__shown.push({ title, body: o.body, tag: o.tag, url: o.data && o.data.url }); return orig(title, o).catch((e) => { self.__shownErr = String(e); }); }; });
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: t.stack.base, registrationId: rid, data: "" });
      let n = [];
      for (let i = 0; i < 60 && !n.length; i++) { n = await swh.evaluate(() => self.__shown || []); if (!n.length) await p.waitForTimeout(100); }
      t.ok(n.length === 1 && n[0].title === "Your shifts" && n[0].body === want1 && n[0].tag === "eikon-rota" && n[0].url === "/ui/index.html#rotreg", "the service worker shows the words it read: " + JSON.stringify(n));
      t.ok(t.db.prepare("SELECT seen_notice_id FROM push_subscriptions WHERE location_id = ?").get(S.loc).seen_notice_id > 0, "what it showed is marked seen");
      const err = await swh.evaluate(() => self.__shownErr || ""); if (err) t.note("headless showNotification: " + err);
      // a second push with nothing new still shows something (a push must always show a notification)
      await cdp.send("ServiceWorker.deliverPushMessage", { origin: t.stack.base, registrationId: rid, data: "" });
      for (let i = 0; i < 60 && n.length < 2; i++) { n = await swh.evaluate(() => self.__shown || []); if (n.length < 2) await p.waitForTimeout(100); }
      t.ok(n.length === 2 && n[1].body === "Open Eikon to see your shifts.", "nothing new: a plain line, never silence: " + JSON.stringify(n[1]));
    }

    // ---- 4. the classic edit body (PUT whole record) changes one shift: one push, its own words
    pushes.length = 0;
    const one = S.rows(S.d(15), S.d(15), S.ids.maria)[0];
    await S.api("PUT", "/shifts/assignments/" + one.id, { staff_id: S.ids.maria, shift_date: one.shift_date, start_time: "13:30", end_time: "19:30", role_override: "", notes: "" });
    t.ok(await settle(1) === 1, "classic edit: exactly one push: " + pushes.length);
    const want2 = "Your " + dayWords(S.d(15)) + " shift changed to 13:30–19:30";
    t.ok(t.db.prepare("SELECT text FROM rota_notices WHERE location_id = ? ORDER BY id DESC").get(S.loc).text === want2, "notice: " + want2);
    // someone else's shift: nobody's phone here
    pushes.length = 0;
    await S.api("POST", "/shifts/assignments", { staff_id: S.ids.joe, shift_date: S.d(16), start_time: "13:30", end_time: "19:30", notes: "" });
    t.ok(await settle(1, 800) === 0, "Joe has no device: no push");

    // ---- 5. with the service worker registered, every load still comes from the network (old build → new build)
    let build = "old"; const seen = [];
    await p.route("**/ui/index.html*", async (r) => { const resp = await r.fetch(); const body = (await resp.text()).replace("<head>", '<head><meta name="b5-build" content="' + build + '">'); seen.push(build); await r.fulfill({ response: resp, body }); });
    const fromSw = [];
    p.on("response", (r) => { if (/\/ui\//.test(r.url()) && r.fromServiceWorker()) fromSw.push(r.url()); });
    await p.reload(); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "rotreg", null, { timeout: 20000 });
    t.ok(await p.evaluate(() => document.querySelector('meta[name="b5-build"]').content) === "old", "reload 1: the old build");
    build = "new";
    await p.reload(); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "rotreg", null, { timeout: 20000 });
    t.ok(await p.evaluate(() => document.querySelector('meta[name="b5-build"]').content) === "new", "reload 2: the new build, straight away");
    t.ok(seen.join(",") === "old,new", "each load reached the network: " + seen.join(","));
    t.ok(!fromSw.length, "no file answered by the service worker: " + fromSw.slice(0, 3).join(", "));
    t.ok(await p.evaluate(() => !!navigator.serviceWorker.controller), "(the page is controlled — and still loads from the network: there is no fetch handler)");
    await p.unroute("**/ui/index.html*");
    await p.goto(t.stack.base + "/ui/index.html?ui=classic#rotreg");
    await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId, null, { timeout: 20000 });
    t.ok(true, "classic loads with it registered");
    await t.open(p, "2", "rotreg", "rotreg", ".rot-mine");
    await p.locator(".rpp-sw[aria-checked=true]").waitFor({ timeout: 8000 });
    t.ok(true, "after reloads the switch still reads on (per device)");

    // ---- 6. off: unsubscribes, the row goes
    const offRes = await t.write(p, /^\/rota\/push\/unsubscribe$/, () => p.locator(".rpp-sw").click());
    t.ok(offRes.json && offRes.json.ok && offRes.json.removed === 1, "unsubscribed: " + JSON.stringify(offRes.json));
    await p.waitForFunction(() => document.querySelector(".rpp-sw") && document.querySelector(".rpp-sw").getAttribute("aria-checked") === "false", null, { timeout: 8000 });
    t.ok(t.db.prepare("SELECT COUNT(*) AS n FROM push_subscriptions WHERE location_id = ?").get(S.loc).n === 0, "no device row left");
    pushes.length = 0;
    await S.api("PUT", "/shifts/assignments/" + one.id, { staff_id: S.ids.maria, shift_date: one.shift_date, start_time: "14:00", end_time: "19:30", role_override: "", notes: "" });
    t.ok(await settle(1, 800) === 0, "off → no push");

    // ---- 7. phone: iPhone without Home Screen says how; the pharmacy without the secret says so on the tap
    const ph = await S.page({ phone: true });
    await ph.context().addInitScript(() => { try { Object.defineProperty(navigator, "userAgent", { get: () => "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1" }); delete window.PushManager; } catch (e) {} });
    await t.open(ph, "2", "rotreg", "rotreg", ".rot-mine");
    await ph.locator(".rpp").waitFor({ timeout: 8000 });
    t.ok(/added to the Home Screen \(iOS 16\.4\+\)/.test(await ph.locator(".rpp").innerText()) && !(await ph.locator(".rpp-sw").count()), "iPhone in Safari: the Home Screen words, no switch");
    t.ok(await ph.evaluate(() => document.documentElement.scrollWidth <= 390), "no sideways scroll at 390");
    await axe(ph, "iPhone words, 390 light"); await ph.emulateMedia({ colorScheme: "dark" }); await axe(ph, "iPhone words, 390 dark");
    app.env.VAPID_PRIVATE_KEY = "";
    const p3 = await S.page({ phone: true });
    await p3.context().addInitScript(fakePush, "b");
    await p3.context().grantPermissions(["notifications"], { origin: t.stack.base });
    await t.open(p3, "2", "rotreg", "rotreg", ".rot-mine");
    await p3.locator(".rpp-sw").click();
    await p3.locator(".rpp [role=status]").filter({ hasText: "not set up" }).waitFor({ timeout: 8000 });
    t.ok(await p3.locator(".rpp [role=status]").innerText() === "Notifications are not set up for this pharmacy yet." && await p3.locator(".rpp-sw").getAttribute("aria-checked") === "false", "no secret: the tap says so (announced, not as an error), switch stays off");
    t.ok(await p3.evaluate(() => !window.__rppSubscribes) && await p3.evaluate(() => navigator.serviceWorker.getRegistration("/").then((r) => !r)), "no secret: nothing subscribed or registered");
    await axe(p3, "not set up, 390 light"); await p3.emulateMedia({ colorScheme: "dark" }); await axe(p3, "not set up, 390 dark");
    const p4 = await S.page(); await p4.emulateMedia({ colorScheme: "dark" }); await p4.setViewportSize({ width: 1440, height: 900 });
    await t.open(p4, "2", "rotreg", "rotreg", ".rot-mine"); await p4.locator(".rpp-sw").waitFor(); await axe(p4, "toggle off, 1440 dark");
  } finally {
    globalThis.fetch = prev;
    app.env.VAPID_PRIVATE_KEY = hadKey;
  }
}
export default { title, run };
