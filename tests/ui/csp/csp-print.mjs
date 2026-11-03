// CSP print-tab check. Local stack only (http://localhost:8859); every other host is aborted.
// For each print path: run it on the OLD ui (base files, no CSP) to record the printed DOM, then on the NEW ui
// under an ENFORCING Content-Security-Policy (script-src 'self' 'wasm-unsafe-eval' + the hashes of index.html's own
// inline scripts, as the coming header) and assert: no CSP violation in the print tab, window.print called
// (stubbed), its Print button (if any) prints, and the printed DOM equals the old one minus script tags / on*= handlers.
// Needs the local stack on :8859 (node <tools>/serve.mjs <repo> 8859), seeded once with tests/ui/csp/seed.mjs, and the
// ui/ of the commit to compare against:  git archive <base> ui | tar -x -C /tmp/base
// Usage: node tests/ui/csp/csp-print.mjs /tmp/base/ui [onlyName,...]   (CSP_OLD=1 also runs the old files under the
// CSP, which shows the violations being fixed; NEW_UI=<dir> tests another ui/ than this repo's)
import { createRequire } from "node:module"; import fs from "node:fs"; import path from "node:path"; import crypto from "node:crypto";
const { chromium } = createRequire(import.meta.url)("playwright");
// No Playwright routing: Chromium stalls the sub-resources (bwip-js) of a document.write() popup when its opener is
// routed. Instead this script is a small proxy on :8858 in front of the local stack on :8859: it serves ui/ files
// (old = base copy, new = current copy) with the CSP header on HTML, and passes the API through. The browser
// resolves no host but localhost (--host-resolver-rules), so nothing can reach the internet.
const STACK = 8859, PORT = 8858, ORIGIN = "http://localhost:" + PORT;
const newUi = process.env.NEW_UI || path.join(path.dirname(new URL(import.meta.url).pathname), "..", "..", "..", "ui");
const baseUi = process.argv[2]; const only = (process.argv[3] || "").split(",").filter(Boolean);
const { SCENARIOS } = await import("./scenarios.mjs");
const mime = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", svg: "image/svg+xml", json: "application/json", gif: "image/gif" };

function cspFor(indexHtml) {
  const hashes = [...indexHtml.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + crypto.createHash("sha256").update(m[1]).digest("base64") + "'");
  return "script-src 'self' 'wasm-unsafe-eval' " + hashes.join(" ");
}

async function run(variant, scen) {
  // variant: "old" (base files, no CSP), "oldcsp" (base files + CSP), "new" (current files + CSP)
  const ctx = await BROWSER.newContext({ viewport: { width: 1400, height: 900 } });
  ctx.setDefaultTimeout(10000);
  const b = { close: () => ctx.close() };
  await ctx.clock.setFixedTime(new Date("2026-11-03T10:15:00"));
  await ctx.addInitScript(() => {
    window.print = function () { console.log("__PRINT__ " + location.href.slice(0, 40)); };
  });
  MODE.variant = variant;
  const log = []; // {page, text, type}
  ctx.on("console", (m) => log.push({ page: m.page(), type: m.type(), text: m.text() }));
  const main = await ctx.newPage();
  main.on("pageerror", (e) => log.push({ page: main, type: "pageerror", text: e.message }));
  const popups = [];
  ctx.on("page", (pg) => { if (pg !== main) { popups.push(pg); pg.on("pageerror", (e) => log.push({ page: pg, type: "pageerror", text: e.message })); } });
  await main.goto(`${ORIGIN}/ui/index.html?ui=${scen.ui === "classic" ? "classic" : "2"}`);
  await main.waitForSelector("input[type=email]", { timeout: 15000 });
  await main.fill("input[type=email]", "maria@demo.mt"); await main.fill("input[type=password]", "Demo-Pass-2026"); await main.keyboard.press("Enter");
  if (scen.ui === "classic") { await main.getByText("Dispensing, inspections").click({ timeout: 15000 }); }
  await main.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId, null, { timeout: 15000 });
  await main.waitForTimeout(800);
  await main.evaluate((h) => { location.hash = "#" + h; }, scen.hash);
  await main.waitForFunction((m) => window.EIKON.state.activeModuleId === m, scen.mod || scen.hash, { timeout: 15000 });
  await main.waitForTimeout(1200);
  if (scen.setup) await scen.setup(main);
  if (scen.mainCheck) { // a handler on the main page (no print tab): run it, report its result and any CSP refusal
    const ok = await scen.mainCheck(main); await main.waitForTimeout(300);
    const r = { variant, name: scen.name, mainOk: ok, mainCsp: log.filter((l) => l.page === main && /Content Security Policy|Refused to/i.test(l.text)).map((l) => l.text.slice(0, 160)) };
    await b.close(); return r;
  }
  const before = popups.length;
  await scen.act(main);
  const t0 = Date.now();
  while (popups.length === before && Date.now() - t0 < 8000) await main.waitForTimeout(100);
  const pop = popups[popups.length - 1];
  const res = { variant, name: scen.name, opened: !!pop && popups.length > before };
  if (!res.opened) { res.mainErrors = log.filter((l) => l.page === main && /error/.test(l.type)).map((l) => l.text).slice(0, 3); await b.close(); return res; }
  // Wait for the print (or up to scen.wait ms), then let the page settle.
  const printed = () => log.filter((l) => l.page === pop && l.text.startsWith("__PRINT__")).length;
  const t1 = Date.now(); const want = scen.autoPrint === false ? 0 : 1;
  while (Date.now() - t1 < (scen.wait || 6000) && (want === 0 || printed() < want)) await main.waitForTimeout(100);
  if (want === 0) await main.waitForTimeout(1200); else await main.waitForTimeout(500);
  res.autoPrinted = printed();
  res.dom = pop.isClosed() ? null : await pop.evaluate(() => {
    const c = document.documentElement.cloneNode(true);
    c.querySelectorAll("script:not([src])").forEach((s) => s.remove());
    c.querySelectorAll("*").forEach((el) => { [...el.attributes].forEach((a) => { if (/^on/i.test(a.name) || a.name === "data-eikon-print") el.removeAttribute(a.name); }); });
    // Canvas pixels are not in the DOM; record their drawn state so barcodes count.
    const cvs = [...document.querySelectorAll("canvas")].map((x) => { try { return x.width + "x" + x.height + ":" + x.toDataURL().length; } catch (e) { return "?"; } });
    return { html: "<!doctype>" + c.outerHTML, canvases: cvs.join(","), url: location.protocol };
  });
  // Press the tab's own Print button, if it has one.
  const btnSel = scen.printBtn || "[data-eikon-print=print], button[onclick*='print']";
  res.hasPrintBtn = !pop.isClosed() && (await pop.$(btnSel)) !== null;
  if (res.hasPrintBtn) { const n = printed(); await pop.click(btnSel); await main.waitForTimeout(400); res.btnPrinted = printed() > n; }
  if (variant === "new" && scen.closeBtn && !pop.isClosed()) { await pop.click(scen.closeBtn); await main.waitForTimeout(400); res.closedByBtn = pop.isClosed(); }
  res.csp = log.filter((l) => l.page === pop && /Content Security Policy|Refused to/i.test(l.text)).map((l) => l.text.slice(0, 160));
  res.mainCsp = log.filter((l) => l.page === main && /Content Security Policy|Refused to/i.test(l.text)).map((l) => l.text.slice(0, 160));
  res.popErrors = log.filter((l) => l.page === pop && l.type === "pageerror").map((l) => l.text.slice(0, 160));
  await b.close();
  return res;
}

const MODE = { variant: "new" };
const http = await import("node:http");
const proxy = http.createServer((req, res) => {
  const u = new URL(req.url, ORIGIN);
  if (u.pathname.startsWith("/ui/")) {
    const dir = MODE.variant === "new" ? newUi : baseUi;
    const f = path.join(dir, decodeURIComponent(u.pathname.slice(4)));
    if (!f.startsWith(dir) || !fs.existsSync(f) || !fs.statSync(f).isFile()) { res.writeHead(404); return res.end(""); }
    const type = mime[f.split(".").pop()] || "application/octet-stream"; const body = fs.readFileSync(f);
    const headers = { "content-type": type, "cache-control": "no-store" };
    if (MODE.variant !== "old" && type === "text/html") headers["content-security-policy"] = cspFor(body.toString());
    res.writeHead(200, headers); return res.end(body);
  }
  const h = { ...req.headers, host: "localhost:" + STACK }; if (h.origin) h.origin = "http://localhost:" + STACK; if (h.referer) h.referer = h.referer.replace(ORIGIN, "http://localhost:" + STACK);
  const up = http.request({ host: "localhost", port: STACK, path: req.url, method: req.method, headers: h }, (r2) => { res.writeHead(r2.statusCode, r2.headers); r2.pipe(res); });
  up.on("error", (e) => { res.writeHead(502); res.end(String(e)); }); req.pipe(up);
});
await new Promise((r) => proxy.listen(PORT, r));
const BROWSER = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] });
let pass = 0, fail = 0; const rows = [];
for (const scen of SCENARIOS) {
  if (only.length && !only.includes(scen.name)) continue;
  let old, nw, oc;
  if (scen.mainCheck) {
    try { const o = await run("oldcsp", scen), n = await run("new", scen);
      const ok = n.mainOk === true && n.mainCsp.length === 0; ok ? pass++ : fail++;
      console.log((ok ? "  ok   " : "  FAIL ") + scen.name + ` [new: works=${n.mainOk} csp=${n.mainCsp.length}] (old under CSP: works=${o.mainOk} csp=${o.mainCsp.length})` + (ok ? "" : "\n         " + n.mainCsp.join(" | ")));
    } catch (e) { fail++; console.log("FAIL", scen.name, "ran:", String(e).split("\n")[0].slice(0, 200)); }
    continue;
  }
  try { old = await run("old", scen).catch(async (e) => { throw e; }); nw = await run("new", scen); if (process.env.CSP_OLD) oc = await run("oldcsp", scen); }
  catch (e) { fail++; console.log("FAIL", scen.name, "ran:", String(e).split("\n")[0].slice(0, 200)); continue; }
  const why = [];
  if (!old.opened) why.push("old: no print tab " + JSON.stringify(old.mainErrors || []));
  if (!nw.opened) why.push("new: no print tab " + JSON.stringify(nw.mainErrors || []));
  if (old.opened && nw.opened) {
    if (nw.csp.length) why.push("CSP in tab: " + nw.csp.join(" | "));
    if (nw.popErrors.length) why.push("errors in tab: " + nw.popErrors.join(" | "));
    if (scen.autoPrint !== false && !nw.autoPrinted) why.push("window.print not called");
    if (scen.autoPrint !== false && nw.autoPrinted !== old.autoPrinted) why.push("print count " + old.autoPrinted + " -> " + nw.autoPrinted);
    if (scen.autoPrint === false && nw.autoPrinted !== old.autoPrinted) why.push("auto print changed " + old.autoPrinted + " -> " + nw.autoPrinted);
    if (!old.dom || !nw.dom) why.push("tab closed before snapshot");
    else {
      // Server data that changes between the two runs (each run signs in: audit rows, times) is masked per scenario.
      // The build stamp (?v=) differs between the two copies by design.
      old.dom.html = old.dom.html.replace(/\?v=[^"'&]+/g, "?v="); nw.dom.html = nw.dom.html.replace(/\?v=[^"'&]+/g, "?v=");
      if (scen.normalize) { old.dom.html = scen.normalize(old.dom.html); nw.dom.html = scen.normalize(nw.dom.html); }
      if (old.dom.html !== nw.dom.html) { let i = 0; while (old.dom.html[i] === nw.dom.html[i]) i++; why.push("DOM differs at " + i + ": OLD …" + old.dom.html.slice(Math.max(0, i - 60), i + 80) + "… NEW …" + nw.dom.html.slice(Math.max(0, i - 60), i + 80)); }
      if (old.dom.canvases !== nw.dom.canvases) why.push("canvases " + old.dom.canvases + " -> " + nw.dom.canvases);
      if (old.dom.url !== nw.dom.url) why.push("tab kind " + old.dom.url + " -> " + nw.dom.url);
    }
    if (old.hasPrintBtn !== nw.hasPrintBtn) why.push("print button presence changed");
    if (nw.hasPrintBtn && !nw.btnPrinted) why.push("Print button did not print");
    if (scen.closeBtn && !nw.closedByBtn) why.push("Close button did not close");
  }
  const ok = why.length === 0; ok ? pass++ : fail++;
  const extra = nw && nw.opened ? ` [${nw.dom && nw.dom.url} auto=${nw.autoPrinted} btn=${nw.hasPrintBtn ? (nw.btnPrinted ? "prints" : "NO") : "-"} len=${nw.dom ? nw.dom.html.length : 0}${nw.dom && nw.dom.canvases ? " canvas=" + nw.dom.canvases : ""}]` : "";
  const sanity = oc ? ` (old under CSP: ${oc.opened ? (oc.csp.length + " violations, auto=" + oc.autoPrinted) : "no tab"})` : "";
  console.log((ok ? "  ok   " : "  FAIL ") + scen.name + extra + sanity + (ok ? "" : "\n         " + why.join("\n         ")));
}
console.log(`\n${pass} passed, ${fail} failed`);
await BROWSER.close(); proxy.close();
