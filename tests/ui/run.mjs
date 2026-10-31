// UI harness: serves ui/ with a mock API and drives it with Playwright.
// Run: node tests/ui/run.mjs            (needs the pre-installed Playwright + Chromium)
// Checks: every pharmacy module renders without a page error or console error,
// plus targeted regressions for the defects fixed on the current code.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Playwright is installed globally in the cloud container; ESM import does not see NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");

const here = fileURLToPath(new URL(".", import.meta.url));
const root = path.join(here, "..", "..", "ui");
const PORT = 8781;
const mime = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", gif: "image/gif", json: "application/json", svg: "image/svg+xml" };

const calls = []; // every non-asset request the UI makes
const todayYmd = new Date().toISOString().slice(0, 10);
const genericList = {
  ok: true, entries: [], items: [], rows: [], data: [], results: [], devices: [], staff: [], assignments: [], leaves: [], settings: {}, state: {},
  appointments: [], slots: [], doctors: [], clinics: [], schedules: [], waitlist: [], campaigns: [], clients: [], transactions: [], records: [], patients: [],
  orders: [], products: [], offers: [], needs: [], messages: [], pinned: [], suggestions: [], contacts: [], dates: [], notes: [], report: { entries: [] },
  catalog: [], sales: [], feedback: [], changes: [], global: {}, daily: null, locations: [], receipts: [], stocktakes: [], certificates: [],
  unread_mentions: 0, unread_messages: 0
};

let todayState = { tempDone: false, cleanDone: false };
function todayPayload() {
  const t = todayYmd;
  return {
    ok: true, date: t, time: "09:12", timezone: "Europe/Malta", pharmacy: { name: "Demo Pharmacy", location_id: 12, org: "Test" },
    before_opening: [
      { kind: "temperature", device_id: 7, title: "Fridge 1 · reading", sub: "Yesterday 3.8 to 6.4 · limits 2 to 8", status: todayState.tempDone ? "done" : "todo", out_of_range: false, limits: { min: 2, max: 8 }, yesterday: { min: 3.8, max: 6.4 }, today: todayState.tempDone ? { min: 3.9, max: 6.1 } : null, action: { method: "POST", path: "/temperature/entries", body: { device_id: 7, entry_date: t }, fields: ["min_temp", "max_temp", "notes"], label: "Log" } },
      { kind: "daily_register", title: "Daily register", sub: "No entry yet today", status: "todo", count_today: 0, action: { type: "open", path: "#dailyregister", label: "Open" } },
      { kind: "cleaning", title: "Cleaning", sub: "Last done 14 days ago by Karl", status: todayState.cleanDone ? "done" : "overdue", days_since: 14, last_date: "2026-10-17", action: { method: "POST", path: "/cleaning/entries", body: { entry_date: t }, fields: ["time_in", "cleaner_name", "staff_name"], label: "Done now" } }
    ],
    customers_waiting: [
      { kind: "order", id: 1, name: "Grech Carmen", phone: "79123456", detail: "Augmentin 625 ×14", code: "A1B2C3", needed_by: t, pickup_date: t, priority: 1, waiting_days: 0, due_today: true, action: { type: "open", path: "#clientorders", label: "Open" } },
      { kind: "question", id: 2, ref: "TKT-00001", name: "Vella Joseph", phone: "79000000", detail: "do you stock the Omron M3 monitor?", status: "Open", priority: 2, waiting_days: 3, followup_date: null, action: { type: "open", path: "#tickets", label: "Reply" } }
    ],
    attention: [
      { kind: "near_expiry", expired_count: 0, due30_count: 1, first: "Enalapril 20mg", first_expiry: t, title: "1 expiring within 30 days", action: { type: "open", path: "#nearexpiry", label: "Open" } },
      { kind: "certificate", title: "Fire extinguisher", status: "due_soon", due: t, days: 12, action: { type: "open", path: "#certificates", label: "Open" } }
    ],
    takings: { end_of_day_saved: false, end_of_day_locked: false, paid_out_today: 12.5, paid_out_count: 1, action: { type: "open", path: "#endofday", label: "Close the day" } },
    stock: { supplier_orders_pending: 1, supplier_orders_shipped: 0 },
    team: { on_today: [{ name: "Maria", role: "pharmacist", from: "09:00", to: "19:00" }, { name: "Karl", role: "assistant", from: "13:00", to: "19:00" }], handover_incoming: [{ text: "Courier at 16:00, box for Dr Galea", sev: "medium" }], notes_today: "" },
    counts: { before_opening: (todayState.tempDone ? 0 : 1) + 1 + (todayState.cleanDone ? 0 : 1), customers_waiting: 2, attention: 2 }
  };
}
let peopleState = { adopted: false, carmel: { id: 1, name: "Zammit Carmel", id_card: "0012345M", phone: "79123456", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", date_of_birth: "", notes: "", source: "history", version: 1, updated_at: "2026-10-31 09:00:00" } };
function mockApi(req, res, body) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  calls.push({ method: req.method, path: p, query: url.search, body });
  if (p === "/__test401") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Unauthorized" })); }
  if (p === "/people" && req.method === "POST") {
    if (body && body.id) { res.writeHead(409, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Changed elsewhere", current: Object.assign({}, peopleState.carmel, { notes: "Call after 5", version: 2 }) })); }
    peopleState.adopted = true;
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, created: true, person: peopleState.carmel }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  if (p === "/people") return res.end(JSON.stringify({ ok: true, q: url.searchParams.get("q") || "", people: (peopleState.adopted ? [peopleState.carmel] : []).concat([{ id: 2, name: "Zammit Paul", phone: "79000001", id_card: "", version: 1 }]), history: peopleState.adopted ? [] : [{ key: "id:0012345M", name: "Zammit Carmel", id_card: "0012345M", phone: "", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", sources: { dda_sale: 1, loyalty: 1 }, last_date: "2026-10-05" }] }));
  if (p === "/people/1") return res.end(JSON.stringify({ ok: true, person: peopleState.carmel, loyalty: { points: 1120, stamps: 3, visits: 2, last_date: "2026-10-20" }, next_appointment: { id: 9, ref: "A-2", date: "2026-11-04", time: "09:30", status: "Scheduled", doctor: "Dr Galea" }, activity: [{ kind: "dda_sale", label: "DDA sale", date: "2026-10-05", title: "Morphine 10mg", ref: "S-1", doctor: "Dr Abela" }, { kind: "loyalty", label: "Loyalty", date: "2026-09-01", title: "", ref: "" }], counts: { dda_sale: 1, loyalty: 1 } }));
  if (p === "/today") return res.end(JSON.stringify(todayPayload()));
  if (p === "/auth/me") return res.end(JSON.stringify({ ok: true, user: { id: 1, user_id: 1, email: "p@x.com", full_name: "Maria Borg", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: "admin" } }));
  if (p === "/temperature/devices") return res.end(JSON.stringify({ ok: true, devices: [{ id: 7, name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, active: 1 }] }));
  if (p === "/temperature/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [] }));
  if (p === "/dda-purchases/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [{ id: 5, entry_date: todayYmd, dda_name_dose: "Morphine 10mg", quantity: 2, agent: "Supplier", invoice_number: "INV-1" }] }));
  if (p === "/temperature/entries" && req.method === "POST") { todayState.tempDone = true; return res.end(JSON.stringify({ ok: true, entry_id: 1 })); }
  if (p === "/cleaning/entries" && req.method === "POST") { todayState.cleanDone = true; return res.end(JSON.stringify({ ok: true, entry: { id: 1 } })); }
  if (req.method === "GET") return res.end(JSON.stringify(genericList));
  return res.end(JSON.stringify({ ok: true, id: 1 }));
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/__calls") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(calls)); }
  if (p === "/__reset") { calls.length = 0; res.writeHead(200); return res.end("ok"); }
  if (p.startsWith("/ui/")) p = p.slice(3);
  const f = path.join(root, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    res.writeHead(200, { "content-type": mime[f.split(".").pop()] || "application/octet-stream" });
    return fs.createReadStream(f).pipe(res);
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => { let j = null; try { j = JSON.parse(body); } catch {} mockApi(req, res, j); });
});

let pass = 0, fail = 0;
function report(name, okv, detail) {
  if (okv) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (detail ? "\n       " + detail : "")); }
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
await page.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

const base = `http://localhost:${PORT}/ui/index.html?intro=0`;
await page.goto(base + "#dashboard");
await page.waitForTimeout(500);
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
await page.reload();
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
await page.waitForTimeout(1500);

// 1. One toast for the whole app
const toastOk = await page.evaluate(() => {
  const E = window.EIKON;
  if (typeof E.toast !== "function" || typeof E.showToast !== "function") return "missing";
  E.toast("Hello from the test", "success");
  E.showToast("Plain message");
  E.toast("Title", "With a title", "warn", 2000);
  const n = document.querySelectorAll(".eikon-toast").length;
  return n >= 3 ? "ok" : "rendered " + n;
});
report("core: E.toast and E.showToast exist and render", toastOk === "ok", toastOk);

// 1b. The sign-in screen is a real form (so the browser offers to save the password) and the account can change it
const formInfo = await page.evaluate(async () => {
  const E = window.EIKON;
  const saved = { token: localStorage.getItem("eikon_token"), role: localStorage.getItem("eikon_active_role") };
  E.renderLogin("", "p@x.com");
  const f = document.getElementById("eikon-login-form");
  const email = document.getElementById("eikon-login-email"), pass = document.getElementById("eikon-login-pass"), btn = document.getElementById("eikon-login-btn");
  const out = { isForm: !!f && f.tagName === "FORM", emailAuto: email && email.getAttribute("autocomplete"), passAuto: pass && pass.getAttribute("autocomplete"), submit: btn && btn.type, keptEmail: email && email.value, tip: /dbg=2/.test(document.body.textContent) };
  return out;
});
report("login: a real form with username/current-password autocomplete and a submit button, no debug tip", formInfo.isForm && formInfo.emailAuto === "username" && formInfo.passAuto === "current-password" && formInfo.submit === "submit" && formInfo.keptEmail === "p@x.com" && !formInfo.tip, JSON.stringify(formInfo));
await page.reload();
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
await page.waitForTimeout(800);
const pwModal = await page.evaluate(() => {
  const b = document.getElementById("eikon-password-btn"); if (!b) return { btn: false };
  b.click();
  const o = document.querySelector(".eikon-modal-overlay");
  return { btn: true, shown: !!o && getComputedStyle(o).display !== "none", fields: document.querySelectorAll("#eikon-pw-form input[type=password]").length, newAuto: (document.getElementById("eikon-pw-new") || {}).getAttribute && document.getElementById("eikon-pw-new").getAttribute("autocomplete") };
});
await page.evaluate(() => window.EIKON.modal.hide());
report("account: a Password button opens the change-password dialog with current, new and repeat fields", pwModal.btn && pwModal.shown && pwModal.fields === 3 && pwModal.newAuto === "new-password", JSON.stringify(pwModal));

// 2. No Authorization header in debug request logs
const redacted = await page.evaluate(async () => {
  const E = window.EIKON; const seen = [];
  const orig = console.log; console.log = function () { seen.push(Array.from(arguments).map((a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); } }).join(" ")); orig.apply(console, arguments); };
  const old = E.DEBUG; E.DEBUG = 2;
  try { await E.apiFetch("/auth/me", { method: "GET" }); } catch {}
  E.DEBUG = old; console.log = orig;
  const joined = seen.join("\n");
  return { hasBearerX: /Bearer x\b/.test(joined), hasRedacted: /redacted/.test(joined) };
});
report("core: debug logs redact the bearer token", !redacted.hasBearerX && redacted.hasRedacted, JSON.stringify(redacted));

// 3. Every pharmacy module renders without errors
const moduleIds = await page.evaluate(() => Object.keys(window.EIKON.modules));
const skipHeavy = new Set(["vaccines"]); // loads a 3.5 MB map; covered separately
const perModule = {};
for (const id of moduleIds) {
  if (skipHeavy.has(id)) continue;
  errors.length = 0;
  await page.evaluate((mid) => { window.location.hash = "#" + mid; }, id);
  await page.waitForTimeout(900);
  const crashed = await page.evaluate(() => !!document.querySelector("#eikon-content") && /Module crashed/.test(document.querySelector("#eikon-content").textContent));
  const errs = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|xlsx|productmap|404/.test(e));
  perModule[id] = { crashed, errs };
  report("render: " + id, !crashed && errs.length === 0, (crashed ? "Module crashed card shown. " : "") + errs.slice(0, 2).join(" | "));
}

// 4. Dashboard quick temperature: blank fields save nothing
await page.evaluate(() => { window.location.hash = "#dashboard"; });
await page.waitForTimeout(2500);
await fetch(`http://localhost:${PORT}/__reset`);
const quickBtn = await page.$('button[data-action="dash-temp-quick"]');
if (!quickBtn) report("dashboard: quick temperature entry button present", false, "no Quick enter button for the missing device");
else {
  await quickBtn.click();
  await page.waitForTimeout(400);
  const saveBtn = (await page.$$(".eikon-modal button")).at(-1);
  await saveBtn.click();
  await page.waitForTimeout(600);
  const postCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/temperature/entries");
  const modalText = await page.evaluate(() => Array.from(document.querySelectorAll(".eikon-modal")).map((m) => m.textContent).join(" "));
  report("dashboard: blank temperature fields are refused and nothing is posted", postCalls.length === 0 && /nothing was saved/i.test(modalText), `posts=${postCalls.length} text=${modalText.slice(0, 160)}`);
  await page.evaluate(() => window.EIKON.modal.hide());
  await page.evaluate(() => window.EIKON.modal.hide());
}

// 5. DDA POYC: New Entry defaults to today
await page.evaluate(() => { window.location.hash = "#dda-poyc"; });
await page.waitForTimeout(1500);
const newBtn = await page.$("text=New Entry");
if (!newBtn) report("dda-poyc: New Entry button present", false, "button not found");
else {
  await newBtn.click();
  await page.waitForTimeout(400);
  const dateVal = await page.evaluate(() => { const bd = Array.from(document.querySelectorAll(".eikon-dda-modal-backdrop")).find((b) => getComputedStyle(b).display !== "none"); const i = bd && bd.querySelector('input[type="date"]'); return i ? i.value : "no modal date input"; });
  const localToday = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  report("dda-poyc: new entry date defaults to today, not the 1st", dateVal === localToday, `got ${dateVal} expected ${localToday}`);
  await page.evaluate(() => { document.querySelectorAll(".eikon-dda-modal-backdrop").forEach((b) => { b.style.display = "none"; }); });
}

// 6. DDA Purchases: delete asks through the in-app modal, Cancel deletes nothing
await page.evaluate(() => { window.location.hash = "#dda-purchases"; });
await page.waitForTimeout(1500);
await fetch(`http://localhost:${PORT}/__reset`);
const delSpan = await page.$("#eikon-content >> text=Delete");
if (!delSpan) report("dda-purchases: a Delete control exists on the row", false, "not found");
else {
  await delSpan.click();
  await page.waitForTimeout(400);
  const modalShown = await page.evaluate(() => { const o = document.querySelector(".eikon-modal-overlay"); return !!o && getComputedStyle(o).display !== "none" && /Delete DDA purchase/.test(o.textContent); });
  const cancel = await page.$(".eikon-modal button:has-text('Cancel')");
  if (cancel) await cancel.click();
  await page.waitForTimeout(300);
  const dels = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "DELETE");
  report("dda-purchases: delete confirms in-app and Cancel sends no DELETE", modalShown && dels.length === 0, `modal=${modalShown} deletes=${dels.length}`);
}

// 7. DDA escaping: the sales and POYC report builders escape markup (checked through the module's own print HTML builder is not exposed, so test the pattern directly)
const escOk = await page.evaluate(() => {
  const src = Array.from(document.scripts).map((s) => s.src).filter((s) => /modules\.dda(sales|poyc)\.js/.test(s));
  return src.length === 2;
});
report("dda: sales and poyc modules loaded (escape fix covered by source test below)", escOk);

// 8. Boot: one build stamp for every file, so caches work; SheetJS is not in the failure chain
const boot = await page.evaluate(() => {
  const srcs = Array.from(document.scripts).map((s) => s.src).filter((s) => /\/ui\//.test(s));
  const vs = new Set(srcs.map((s) => (s.match(/[?&]v=([^&]+)/) || [])[1]));
  return { files: srcs.length, stamps: Array.from(vs), timestampLike: Array.from(vs).some((v) => /^\d{13}$/.test(v || "")) };
});
report("boot: all module files share one fixed build stamp", boot.files > 50 && boot.stamps.length === 1 && !boot.timestampLike, JSON.stringify(boot));

// 9. Session expiry: a 401 on any call shows sign-in once and keeps the place
await page.evaluate(() => { window.location.hash = "#temperature"; });
await page.waitForTimeout(800);
const expired = await page.evaluate(async () => {
  const E = window.EIKON;
  let threw = null;
  try { await E.apiFetch("/__test401", { method: "GET" }); } catch (e) { threw = e; }
  await new Promise((r) => setTimeout(r, 200));
  const login = document.querySelector(".eikon-login");
  return { threw: !!threw, status: threw && threw.status, loginShown: !!login, text: login ? login.textContent : "", token: localStorage.getItem("eikon_token"), returnHash: E._returnHash };
});
report("core: a 401 shows the sign-in screen, clears the token and remembers the screen", expired.threw && expired.status === 401 && expired.loginShown && /session has ended/i.test(expired.text) && !expired.token && expired.returnHash === "#temperature", JSON.stringify(expired).slice(0, 300));

// 10. Today screen behind the flag
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_ui2", "1"); });
await fetch(`http://localhost:${PORT}/__reset`);
await page.goto(base + "&ui=2");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1"), null, { timeout: 15000 });
await page.waitForTimeout(600);
const today1 = await page.evaluate(() => ({
  hash: location.hash, light: document.documentElement.hasAttribute("data-ui2"), intro: !!document.getElementById("eikon-intro-overlay"),
  h1: document.querySelector(".tdy-head h1").textContent, rows: document.querySelectorAll(".tdy-row").length,
  oldLink: !!document.querySelector('[data-open="#dashboard"]'), calls: null
}));
const callsBoot = await (await fetch(`http://localhost:${PORT}/__calls`)).json();
const todayCalls = callsBoot.filter((c) => c.path === "/today").length;
const otherGets = callsBoot.filter((c) => c.method === "GET" && c.path !== "/today" && c.path !== "/auth/me").length;
report("today: opens first under the flag, light shell, no intro, headline and rows render", today1.hash === "#today" && today1.light && !today1.intro && /3 things before the doors open/.test(today1.h1) && today1.rows === 5 && today1.oldLink, JSON.stringify(today1));
report("today: the screen is one request", todayCalls >= 1 && otherGets === 0, `today=${todayCalls} otherGets=${otherGets} ${JSON.stringify(callsBoot.map((c) => c.path))}`);

// blank fridge fields are refused, nothing posted
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('.tdy-row[data-kind="temperature"] [data-act="temp"]');
await page.waitForTimeout(300);
let posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
const toastBlank = await page.evaluate(() => Array.from(document.querySelectorAll(".eikon-toast")).map((t) => t.textContent).join(" | "));
report("today: blank fridge fields post nothing and say so", posts.length === 0 && /Nothing was saved/.test(toastBlank), `posts=${posts.length} toast=${toastBlank}`);

// typing min, max and pressing Enter logs the fridge with the right body and the row turns done
await page.fill('.tdy-row[data-kind="temperature"] [data-min]', "3.9");
await page.fill('.tdy-row[data-kind="temperature"] [data-max]', "6.1");
await page.press('.tdy-row[data-kind="temperature"] [data-max]', "Enter");
await page.waitForTimeout(900);
posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/temperature/entries");
const afterLog = await page.evaluate(() => ({ h1: document.querySelector(".tdy-head h1").textContent, pill: (document.querySelector('.tdy-row[data-kind="temperature"] .tdy-pill') || {}).textContent, inputs: document.querySelectorAll('.tdy-row[data-kind="temperature"] input').length }));
report("today: min, max, Enter logs the fridge in one request and the row turns done", posts.length === 1 && posts[0].body && posts[0].body.device_id === 7 && posts[0].body.min_temp === 3.9 && posts[0].body.max_temp === 6.1 && /Logged 3.9 to 6.1/.test(afterLog.pill || "") && afterLog.inputs === 0 && /2 things/.test(afterLog.h1), JSON.stringify({ posts, afterLog }));

// cleaning: Done now asks for one name, then records
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('.tdy-row[data-kind="cleaning"] [data-act="clean"]');
await page.waitForTimeout(200);
await page.fill('.tdy-row[data-kind="cleaning"] [data-cleaner]', "Karl");
await page.click('.tdy-row[data-kind="cleaning"] [data-act="clean"]');
await page.waitForTimeout(900);
posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries");
const afterClean = await page.evaluate(() => (document.querySelector('.tdy-row[data-kind="cleaning"] .tdy-pill') || {}).textContent);
report("today: cleaning Done now records who and when", posts.length === 1 && posts[0].body.cleaner_name === "Karl" && posts[0].body.staff_name === "Maria Borg" && /Done today/.test(afterClean || ""), JSON.stringify({ posts, afterClean }));

// search: a customer's name opens their screen; Enter on a register name opens it
await page.fill("#tdy-q", "grech");
await page.press("#tdy-q", "Enter");
await page.waitForTimeout(300);
const openedCustomer = await page.evaluate(() => location.hash);
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForTimeout(800);
await page.fill("#tdy-q", "temperature");
await page.press("#tdy-q", "Enter");
await page.waitForTimeout(300);
const openedModule = await page.evaluate(() => location.hash);
report("today: search opens a customer or a register on Enter", openedCustomer === "#clientorders" && openedModule === "#temperature", `${openedCustomer} ${openedModule}`);

// 10b. The reimagined shell: six words in the rail, nothing else; top bar only over an old module
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForFunction(() => location.hash === "#today" && document.querySelector(".tdy-head h1"), null, { timeout: 8000 });
await page.waitForTimeout(400);
const shell = await page.evaluate(() => ({
  rail: Array.from(document.querySelectorAll(".eikon-rail-btn .eikon-nav-label")).map((e) => e.textContent),
  cats: document.querySelectorAll(".eikon-nav-cat").length, help: !!document.querySelector(".eikon-help-btn"), search: !!document.querySelector(".eikon-nav-search-input"),
  topbar: getComputedStyle(document.querySelector(".eikon-topbar")).display, mark: !!document.querySelector(".eikon-rail-mark"),
  pharmacy: (document.querySelector(".eikon-rail-brand span") || {}).textContent, who: (document.querySelector(".eikon-rail-who b") || {}).textContent,
  badgeToday: (document.querySelector('.eikon-rail-badge[data-badge="today"]') || {}).textContent
}));
report("shell: the rail is Today, Customers, Stock, Registers, Team, Settings and nothing else", JSON.stringify(shell.rail) === JSON.stringify(["Today", "Customers", "Stock", "Registers", "Team", "Settings"]) && shell.cats === 0 && !shell.help && !shell.search && shell.topbar === "none" && shell.mark && shell.pharmacy === "Demo Pharmacy" && shell.who === "Maria Borg" && /^\d+$/.test(shell.badgeToday || ""), JSON.stringify(shell));
await page.evaluate(() => { location.hash = "#registers"; });
await page.waitForFunction(() => document.querySelector(".hub-card"), null, { timeout: 8000 });
const hub = await page.evaluate(() => ({ h1: document.querySelector(".hub h1").textContent, cards: document.querySelectorAll(".hub-card").length, temp: !!document.querySelector('.hub-card[data-open="temperature"]'), topbar: getComputedStyle(document.querySelector(".eikon-topbar")).display }));
await page.click('.hub-card[data-open="temperature"]');
await page.waitForFunction(() => location.hash === "#temperature" && document.documentElement.hasAttribute("data-ui2-legacy"), null, { timeout: 8000 });
await page.waitForTimeout(300);
const legacy = await page.evaluate(() => ({ topbar: getComputedStyle(document.querySelector(".eikon-topbar")).display, back: document.getElementById("eikon-back-btn").textContent, backShown: document.getElementById("eikon-back-btn").style.display !== "none", logout: getComputedStyle(document.getElementById("eikon-logout-btn")).display }));
await page.click("#eikon-back-btn");
await page.waitForFunction(() => location.hash === "#registers", null, { timeout: 8000 });
report("shell: Registers lists every book, an old module opens with only a way back, Back returns", hub.h1 === "Registers" && hub.cards >= 20 && hub.temp && hub.topbar === "none" && legacy.topbar !== "none" && legacy.back === "‹ Registers" && legacy.backShown && legacy.logout === "none", JSON.stringify({ hub, legacy }));

// 11. Customers: Today's search hands over, the list shows people and history, Add adopts, edits are versioned
const callsNow = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
await fetch(`http://localhost:${PORT}/__reset`);
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForTimeout(800);
await page.fill("#tdy-q", "zammit");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => location.hash === "#customers" && document.querySelector("#cus-q") && document.querySelector("[data-hist]"), null, { timeout: 8000 });
await page.waitForTimeout(300);
const cus1 = await page.evaluate(() => ({ q: document.querySelector("#cus-q").value, people: document.querySelectorAll("[data-person]").length, hist: document.querySelectorAll("[data-hist]").length, rail: !!document.querySelector('.eikon-nav-btn[data-mod="customers"]'), histText: document.querySelector("[data-hist] .cus-t span").textContent }));
const peopleGets = (await callsNow()).filter((c) => c.path === "/people" && c.method === "GET");
report("customers: Today's search hands the term over; people, history and the rail entry render", cus1.q === "zammit" && cus1.people === 1 && cus1.hist === 1 && cus1.rail && /1 DDA sale, 1 loyalty card/.test(cus1.histText) && peopleGets.length >= 1 && /q=zammit/.test(peopleGets[peopleGets.length - 1].query), JSON.stringify({ cus1, peopleGets }));

await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-adopt]");
await page.waitForFunction(() => document.querySelector(".cus-head h1"), null, { timeout: 8000 });
await page.waitForTimeout(300);
const adoptPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path === "/people");
const cus2 = await page.evaluate(() => ({ h1: document.querySelector(".cus-head h1").textContent, story: document.querySelectorAll(".cus-story li").length, hist: document.querySelectorAll("[data-hist]").length, first: document.querySelector(".cus-story li .t b").textContent, counts: document.querySelectorAll(".cus-counts a").length }));
report("customers: Add adopts a person from history in one request and opens them with their story", adoptPosts.length === 1 && adoptPosts[0].body.name === "Zammit Carmel" && adoptPosts[0].body.id_card === "0012345M" && adoptPosts[0].body.source === "history" && cus2.h1 === "Zammit Carmel" && cus2.story === 2 && cus2.hist === 0 && /DDA sale · Morphine 10mg/.test(cus2.first) && cus2.counts === 2, JSON.stringify({ adoptPosts, cus2 }));

await page.click('[data-act="edit"]');
await page.fill("[name=notes]", "Prefers SMS");
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act="save"]');
await page.waitForTimeout(700);
const savePosts = (await callsNow()).filter((c) => c.method === "POST" && c.path === "/people");
const cus3 = await page.evaluate(() => ({ warn: (document.querySelector(".cus-warn") || {}).textContent || "", editing: !!document.querySelector("#cus-edit"), notes: (document.querySelector("[name=notes]") || {}).value, saved: Array.from(document.querySelectorAll(".eikon-toast")).map((t) => t.textContent).join("|") }));
report("customers: a stale edit is refused, the other version is shown, nothing is claimed saved", savePosts.length === 1 && savePosts[0].body.id === 1 && savePosts[0].body.version === 1 && savePosts[0].body.notes === "Prefers SMS" && /changed this record/.test(cus3.warn) && cus3.editing && cus3.notes === "Call after 5" && !/Saved/.test(cus3.saved), JSON.stringify({ savePosts, cus3 }));

await page.click('[data-act="cancel"]');
const facts = await page.evaluate(() => ({ pills: Array.from(document.querySelectorAll(".cus-head .cus-pill")).map((e) => e.textContent), facts: Array.from(document.querySelectorAll(".cus-facts small")).map((e) => e.textContent), next: (Array.from(document.querySelectorAll(".cus-facts div")).find((d) => /Next appointment/.test(d.textContent)) || {}).textContent }));
report("customers: loyalty points and the next appointment are on the page", facts.pills.some((t) => /Loyalty · 1,120 pts/.test(t)) && /09:30 · Dr Galea/.test(facts.next || ""), JSON.stringify(facts));

// Step 1: the hand-over. One tap opens the register's own form, filled; nothing is posted until Save.
const closeModal = async () => { await page.evaluate(() => { const ov = document.querySelector(".eikon-modal-overlay"); if (!ov) return; const b = Array.from(ov.querySelectorAll("button")).find((x) => /^(Cancel|Close)$/i.test(x.textContent.trim())); if (b) b.click(); else ov.remove(); }); await page.waitForTimeout(200); };
const carryTo = async (hash, selector) => {
  await page.evaluate(() => { location.hash = "#customers"; });
  await page.waitForFunction(() => document.querySelector("#cus-q"), null, { timeout: 8000 });
  await page.fill("#cus-q", "zammit");
  await page.waitForFunction(() => document.querySelector('[data-person="1"]'), null, { timeout: 8000 });
  await page.click('[data-person="1"]');
  await page.waitForFunction((h) => document.querySelector('[data-carry="' + h + '"]'), hash, { timeout: 8000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-carry="' + hash + '"]');
  await page.waitForFunction((sel) => location.hash && document.querySelector(sel) && document.querySelector(sel).value, selector, { timeout: 10000 });
  await page.waitForTimeout(200);
};
await carryTo("#clientorders", "#co-client");
const ord = await page.evaluate(() => ({ hash: location.hash, name: document.querySelector("#co-client").value, phone: document.querySelector("#co-contact").value, addr: document.querySelector("#co-address").value, email: document.querySelector("#co-email").value, carry: sessionStorage.getItem("eikon_carry_person"), back: document.getElementById("eikon-back-btn").textContent }));
let carryPosts = (await callsNow()).filter((c) => c.method === "POST");
report("step 1: New order opens the order form with the person filled, nothing posted, hand-over used up", ord.hash === "#clientorders" && ord.name === "Zammit Carmel" && ord.phone === "79123456" && ord.addr === "1 Triq il-Knisja" && ord.carry === null && carryPosts.length === 0 && ord.back === "‹ Customers", JSON.stringify({ ord, carryPosts }));
await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(here, "..", "..", "design", "eikon-reimagined", "prototype", "06 Customer to order.png") });
await closeModal();

await carryTo("#tickets", "#tk-client");
const tk = await page.evaluate(() => ({ name: document.querySelector("#tk-client").value, phone: document.querySelector("#tk-phone").value }));
await closeModal();
await carryTo("#deliveries", "#dv-client");
const dv = await page.evaluate(() => ({ name: document.querySelector("#dv-client").value, phone: document.querySelector("#dv-phone").value, addr: document.querySelector("#dv-address").value }));
await closeModal();
await carryTo("#appointments", "#ap-mod-patient");
const ap = await page.evaluate(() => ({ name: document.querySelector("#ap-mod-patient").value, card: document.querySelector("#ap-mod-idcard").value, phone: document.querySelector("#ap-mod-phone").value }));
await closeModal();
carryPosts = (await callsNow()).filter((c) => c.method === "POST");
report("step 1: Question, Delivery and Appointment open filled the same way", tk.name === "Zammit Carmel" && tk.phone === "79123456" && dv.name === "Zammit Carmel" && dv.addr === "1 Triq il-Knisja" && ap.name === "Zammit Carmel" && ap.card === "0012345M" && ap.phone === "79123456" && carryPosts.length === 0, JSON.stringify({ tk, dv, ap, carryPosts }));

// an old hand-over is ignored
await page.evaluate(() => { sessionStorage.setItem("eikon_carry_person", JSON.stringify({ id: 1, name: "Zammit Carmel", phone: "79123456", at: Date.now() - 6 * 60 * 1000 })); location.hash = "#tickets"; });
await page.waitForFunction(() => document.querySelector("#tk-new"), null, { timeout: 8000 });
await page.waitForTimeout(500);
const stale = await page.evaluate(() => ({ modal: !!document.querySelector("#tk-client"), carry: sessionStorage.getItem("eikon_carry_person") }));
report("step 1: a hand-over older than five minutes opens nothing and is discarded", !stale.modal && stale.carry === null, JSON.stringify(stale));
// screenshot of the person for the review
await page.setViewportSize({ width: 1440, height: 900 });
await page.evaluate(() => { location.hash = "#customers"; });
await page.waitForFunction(() => document.querySelector("#cus-q"), null, { timeout: 8000 });
await page.fill("#cus-q", "zammit");
await page.waitForFunction(() => document.querySelector("[data-person]"), null, { timeout: 8000 });
await page.click('[data-person="1"]');
await page.waitForFunction(() => document.querySelector(".cus-story li"), null, { timeout: 8000 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(here, "..", "..", "design", "eikon-reimagined", "prototype", "05 Customers, built.png") });
peopleState.adopted = false;

// screenshot for the review (reset the mock so the screen shows a morning with work to do)
todayState = { tempDone: false, cleanDone: false };
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForTimeout(1200);
await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(here, "..", "..", "design", "eikon-reimagined", "prototype", "04 Today, built.png") });
// leave the flag off for the next run
await page.evaluate(() => { localStorage.removeItem("eikon_ui2"); });

await browser.close();
server.close();

// Source-level check for the escape fix (no DOM needed)
for (const f of ["modules.ddasales.js", "modules.ddapoyc.js"]) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const bad = src.includes(`"&": "&", "<": "<"`);
  const good = src.includes(`"&": "&amp;", "<": "&lt;"`);
  report("source: " + f + " escapeHtml produces entities", !bad && good);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
