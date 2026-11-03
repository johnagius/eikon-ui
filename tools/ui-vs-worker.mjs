// Drives the UI served by tools/serve.mjs (scratchpad) on localhost:<port> against whichever worker that stack runs,
// to see what a pharmacy meets while the UI and the worker are at different versions (the minutes between a UI push
// and a worker deploy, or the other way round). Localhost only: every other address is refused.
//   node --no-warnings tools/ui-vs-worker.mjs <port> <label>
import { createRequire } from "node:module";
const { chromium } = createRequire(import.meta.url)("playwright");
const [port, label] = [Number(process.argv[2]), process.argv[3] || ""];
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
const b = await chromium.launch();
const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();
const calls = []; const pageErrs = [];
await page.route("**/*", (r) => (new URL(r.request().url()).hostname === "localhost" ? r.continue() : r.abort()));
page.on("response", (res) => { const u = new URL(res.url()); if (!u.pathname.startsWith("/ui/")) calls.push({ t: Date.now(), m: res.request().method(), p: u.pathname, s: res.status(), body: res.request().postData() || "" }); });
page.on("pageerror", (e) => pageErrs.push(e.message));
const base = `http://localhost:${port}`;
await page.goto(base + "/ui/index.html?ui=2"); await page.waitForSelector("input[type=email]", { timeout: 20000 });
await page.fill("input[type=email]", "maria@demo.mt"); await page.fill("input[type=password]", "Demo-Pass-2026"); await page.keyboard.press("Enter");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId, null, { timeout: 20000 });
await page.waitForTimeout(2500);
const build = await page.evaluate(() => window.EIKON.BUILD || "");
const health = await page.evaluate(async () => (await (await fetch("/health")).json()).version);
console.log(`${label}: UI ${build}, worker ${health}`);
ok(pageErrs.length === 0, "signs in and opens " + (await page.evaluate(() => window.EIKON.state.activeModuleId)) + " with no page error " + pageErrs.join(" | "));
// toasts and overlays from here on
await page.evaluate(() => { window.__toasts = []; const t = window.EIKON.toast; window.EIKON.toast = window.EIKON.showToast = function () { window.__toasts.push([].slice.call(arguments).join(" | ")); return t.apply(this, arguments); }; });

// ---------------------------------------------------------------- 1. error reports
const t0 = Date.now();
await page.evaluate(async () => {
  for (let i = 1; i <= 7; i++) setTimeout(() => { throw new Error("Probe error " + i); }, i * 20);
  for (let i = 0; i < 3; i++) setTimeout(() => { throw new Error("Probe error 1"); }, 200 + i * 20);
  setTimeout(() => { Promise.reject(new Error("Probe rejection")); }, 300);
});
await page.waitForTimeout(1500);
// a screen that crashes while drawing
await page.evaluate(() => { location.hash = "#dda-sales"; });
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg", null, { timeout: 15000 });
await page.evaluate(() => { location.hash = "#today"; }); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 15000 });
const patched = await page.evaluate(() => { const m = window.EIKON.modules.cdsreg; if (!m) return false; m.__r = m.render; m.render = async () => { throw new Error("Probe render crash"); }; location.hash = "#dda-sales"; return true; });
await page.waitForTimeout(2000);
const fatal = await page.evaluate(() => { const o = document.getElementById("eikon-fatal-overlay"); return o && getComputedStyle(o).display !== "none" ? o.textContent.slice(0, 80) : ""; });
const crashed = await page.evaluate(() => /Module crashed/.test(document.body.textContent));
await page.waitForTimeout(10000); // a loop would show here
const cl = calls.filter((c) => c.p === "/client-log" && c.t >= t0);
const bodies = cl.map((c) => c.body);
ok(cl.length >= 1 && cl.length <= 5, `client-log: ${cl.length} requests for 9 distinct faults (at most 5 per page load); answers ${[...new Set(cl.map((c) => c.s))].join(",")}`);
ok(new Set(bodies).size === bodies.length, "no report sent twice (no retry)");
const after = calls.filter((c) => c.t >= t0 + 6000 && c.p === "/client-log").length;
ok(after === 0, "no client-log request in the 10 s after the faults (no loop): " + after);
const toasts = await page.evaluate(() => window.__toasts);
ok(!toasts.some((t) => /client-log|not found|404|report/i.test(t)), "no message about the report shown to the user; toasts: " + JSON.stringify(toasts));
console.log("       render crash patched: " + patched + "; (what the faults themselves show, same with either worker: fatal overlay " + JSON.stringify(fatal) + ", 'Module crashed' card " + crashed + ")");
await page.evaluate(() => { const m = window.EIKON.modules.cdsreg; if (m && m.__r) m.render = m.__r; const o = document.getElementById("eikon-fatal-overlay"); if (o) o.remove(); });

// ---------------------------------------------------------------- 2. ID card questions on DDA sales (new in UI .139)
const api = (u, o) => page.evaluate(([u, o]) => window.EIKON.apiFetch(u, o).catch((e) => ({ err: String(e && e.message || e), status: e && e.status })), [u, o]);
await api("/people", { method: "POST", body: JSON.stringify({ name: "Laura Borg", id_card: "", phone: "", address: "5 Triq il-Wied, Qormi", source: "manual" }) });
await api("/people", { method: "POST", body: JSON.stringify({ name: "Carmel Zammit", id_card: "0012345M", phone: "", address: "1 Triq il-Knisja", source: "manual" }) });
await page.evaluate(() => { location.hash = "#today"; }); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 15000 });
await page.evaluate(() => { location.hash = "#dda-sales"; });
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
const dlg = () => page.evaluate(() => { const d = document.querySelector(".epc"); return d ? { title: (d.querySelector("h2") || {}).textContent, text: d.textContent.replace(/\s+/g, " ").slice(0, 400), btns: [...d.querySelectorAll("[data-epc]")].map((x) => x.textContent) } : null; });
const waitDlg = (re) => page.waitForFunction((s) => { const h = document.querySelector(".epc h2"); return h && new RegExp(s).test(h.textContent); }, re, { timeout: 8000 }).then(() => true, () => false);
const press = (id) => page.click(`.epc [data-epc=${id}]`);
const salesPosts = () => calls.filter((c) => c.m === "POST" && c.p === "/dda-sales/entries");
async function form(card, serial) {
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.type("[name=client_name]", "laura", { delay: 20 });
  const listed = await page.waitForSelector(".epp-list:not([hidden]) .epp-opt", { timeout: 6000 }).then(() => true, () => false);
  if (listed) { await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(300); } else { await page.fill("[name=client_name]", "Laura Borg"); }
  if (!(await page.inputValue("[name=client_address]").catch(() => ""))) await page.fill("[name=client_address]", "5 Triq il-Wied, Qormi").catch(() => {});
  await page.fill("[name=client_id_card]", card); await page.fill("[name=doctor_name]", "Dr Abela"); await page.fill("[name=doctor_reg_no]", "R1201"); await page.fill("[name=prescription_serial_no]", serial);
  await page.fill('[data-i="0"][data-k=medicine_name_dose]', "Morphine 10mg"); await page.fill('[data-i="0"][data-k=quantity]', "2");
  return listed;
}
// A: Laura has no card; 34567l typed
const n0 = salesPosts().length;
const listedA = await form("34567l", "PD-A-" + Date.now() % 100000);
await page.click("#cds-add button[type=submit]");
const gotA = await waitDlg("^Add ID card"); const dA = await dlg();
if (gotA) await press("yes");
await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
const toastsA = await page.evaluate(() => window.__toasts.slice());
const sA = salesPosts().slice(n0);
ok(gotA && sA.length === 1 && sA[0].s < 300, `A (no card on the person): asked "${dA && dA.title}"; Yes → sale saved ${sA.map((c) => c.s).join(",")}; toasts ${JSON.stringify(toastsA.slice(-2))}` + (listedA ? "" : " (picked by typing)"));
// B: Carmel's card on a record named Laura
await page.waitForTimeout(500);
const n1 = salesPosts().length;
await form("12345m", "PD-B-" + Date.now() % 100000);
await page.click("#cds-add button[type=submit]");
const gotB = await waitDlg("belongs to"); const dB = await dlg();
if (gotB) await press("back");
await page.waitForTimeout(800);
ok(gotB && salesPosts().length === n1, `B (someone else's card): "${dB && dB.title}"; nothing saved`);
await page.click("[data-act=add-cancel]").catch(() => {});
// C: Laura now has 0034567L (from A); 45678l typed
await page.waitForTimeout(500);
const n2 = salesPosts().length; const pre = calls.length;
await form("45678l", "PD-C-" + Date.now() % 100000);
await page.click("#cds-add button[type=submit]");
const gotC = await waitDlg("^Change"); const dC = await dlg();
const errC = await page.evaluate(() => { const e = document.querySelector(".epc .epc-err, .epc [role=alert]"); return e ? e.textContent : ""; });
console.log("       C dialog: " + JSON.stringify({ title: dC && dC.title, btns: dC && dC.btns, error: errC }));
let changeTry = null;
if (gotC && dC.btns.some((x) => /Change everywhere/.test(x))) { await press("change"); await page.waitForTimeout(1500); changeTry = await dlg(); changeTry.err = await page.evaluate(() => { const e = document.querySelector(".epc .epc-err, .epc [role=alert]"); return e ? e.textContent : ""; }); console.log("       after Change everywhere: " + JSON.stringify(changeTry).slice(0, 300)); }
if (await dlg()) { const d = await dlg(); if (d.btns.some((x) => /^Only this/.test(x))) await press("only"); else if (d.btns.some((x) => /^Save the/.test(x))) await press("go"); }
await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 8000 }).catch(() => {});
await page.waitForTimeout(1500);
const sC = salesPosts().slice(n2);
const idc = calls.slice(pre).filter((c) => /change-id-card/.test(c.p)).map((c) => c.m + " " + c.s);
ok(gotC && sC.length === 1 && sC[0].s < 300, `C (another card): asked; change endpoint answered ${JSON.stringify(idc)}; "Only this DDA sale" / save → sale saved ${sC.map((c) => c.s).join(",")}`);
ok(pageErrs.filter((e) => !/^Probe/.test(e)).length === 0, "no page errors apart from the probes: " + pageErrs.filter((e) => !/^Probe/.test(e)).join(" | "));
const bad = calls.filter((c) => c.s >= 400 && c.p !== "/client-log").map((c) => c.m + " " + c.p + " " + c.s);
console.log("       non-2xx answers apart from client-log: " + JSON.stringify([...new Set(bad)]));
await b.close();
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
