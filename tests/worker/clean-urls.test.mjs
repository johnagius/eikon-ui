// Clean addresses (eikonhq.com/, eikonhq.com/today): the app's page is served only to a browser navigation,
// never to an API call. The UI files come from GitHub in production; here that one fetch reads ui/ from this tree.
import { test, eq, ok } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const UI = join(here, "..", "..", "ui");
const WORKER = readFileSync(join(here, "..", "..", "cloudflare-worker", "code"), "utf8");

async function withLocalUi(fn, { indexHtml } = {}) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const s = String(u && u.url || u);
    const m = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/ui\/(.+)$/.exec(s);
    if (m) {
      if (m[1] === "index.html" && indexHtml === null) return new Response("404: Not Found", { status: 404 });
      if (m[1] === "index.html" && indexHtml !== undefined) return new Response(indexHtml, { status: 200 });
      const f = join(UI, m[1]);
      return existsSync(f) ? new Response(readFileSync(f), { status: 200 }) : new Response("404", { status: 404 });
    }
    return orig(u, init);
  };
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

// What a browser sends when the person types the address, follows a link, reloads or opens a new tab.
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
const OLD_BROWSER_NAV = { "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8" };
// What the app's own calls look like (E.apiFetch, the early fetch in index.html), and other clients.
const API_STYLES = {
  "app fetch with token": (t) => ({ "Authorization": "Bearer " + t, "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", "Accept": "*/*" }),
  "same-origin fetch with token": (t) => ({ "Authorization": "Bearer " + t, "Sec-Fetch-Mode": "same-origin", "Accept": "*/*" }),
  "fetch without token": () => ({ "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "empty", "Accept": "*/*" }),
  "fetch asking for html, no token": () => ({ "Sec-Fetch-Mode": "cors", "Accept": "text/html" }),
  "script/img load": () => ({ "Sec-Fetch-Mode": "no-cors", "Sec-Fetch-Dest": "script", "Accept": "*/*" }),
  "server/curl client": () => ({ "Accept": "*/*" }),
  "server client, json": (t) => ({ "Authorization": "Bearer " + t, "Accept": "application/json" }),
  "navigation that carries a token": (t) => ({ ...NAV, "Authorization": "Bearer " + t })
};

// Every path the worker knows: the literal route strings in its source, with :id-like parts filled in.
function workerPaths() {
  const set = new Set(["/", "/today", "/endofday", "/eod", "/people", "/bookings", "/appointments", "/supplier-orders", "/health", "/bootstrap", "/admin-recover", "/su", "/b", "/book", "/go", "/api", "/auth", "/ui"]);
  for (const m of WORKER.matchAll(/["'`](\/[a-z][a-z0-9_\-\/]*)["'`]/gi)) set.add(m[1]);
  for (const m of WORKER.matchAll(/\/\^\\\/((?:[a-z0-9_-]|\\\/)+)/gi)) set.add("/" + m[1].replace(/\\\//g, "/"));
  return [...set].filter((p) => p.length < 80 && !p.startsWith("/ui/") && !p.includes("//"));
}

test("clean addresses: a browser opening /, a screen or an old-browser screen gets the app page, marked to load from /ui/", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const [p, h] of [["/", NAV], ["/today", NAV], ["/endofday", NAV], ["/registers", NAV], ["/customers", NAV], ["/cdsreg", NAV], ["/dda_stocktakes", NAV], ["/people", NAV], ["/appointments", NAV], ["/today", OLD_BROWSER_NAV], ["/?ui=1", NAV], ["/tempreg?ui=classic", NAV]]) {
      const r = await raw("GET", p, { headers: h });
      eq(r.status, 200, p + " answers the page");
      eq(r.headers.get("x-eikon-page"), "app", p + " is the app page");
      ok(/text\/html/.test(r.headers.get("content-type") || ""), p + " is html");
      eq(r.headers.get("cache-control"), "no-store", p + " is never kept by the browser");
      ok(/Authorization/.test(r.headers.get("vary") || ""), p + " varies on Authorization");
      const html = await r.text();
      ok(html.includes('<meta name="eikon-ui-base" content="/ui/" />'), p + " carries the /ui/ mark");
      ok(html.includes('var BUILD = "'), p + " is index.html");
    }
    const head = await raw("HEAD", "/registers", { headers: NAV });
    eq(head.status, 200); eq(head.headers.get("x-eikon-page"), "app");
  });
});

test("clean addresses: the worker's own pages, public booking pages, files and deep paths answer exactly as before", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const p of ["/health", "/bootstrap", "/admin-recover", "/su", "/ui", "/ui/", "/index.html", "/b/abc", "/book/demo", "/book", "/b", "/go/gpt-extractor", "/api", "/auth", "/today/", "/temperature/entries", "/a.b", "/1abc", "/" + "x".repeat(70)]) {
      const r = await raw("GET", p, { headers: NAV });
      ok(r.headers.get("x-eikon-page") !== "app", p + " is not the app page");
    }
    eq((await raw("GET", "/health", { headers: NAV })).status, 200, "health answers");
    const ui = await raw("GET", "/ui", { headers: NAV }); eq(ui.status, 302); eq(ui.headers.get("location"), "/ui/index.html");
    const idx = await raw("GET", "/ui/index.html", { headers: NAV });
    eq(idx.status, 200); const t = await idx.text();
    ok(!t.includes('<meta name="eikon-ui-base" content="/ui/" />'), "/ui/index.html is served unmarked: the #hash app, unchanged");
    eq(idx.headers.get("x-eikon-page"), null);
    const css = await raw("GET", "/ui/app.css"); eq(css.status, 200, "files under /ui/ as before");
  });
});

test("clean addresses: no API call to any worker path is ever answered with the page (all paths x methods x client kinds)", async ({ raw, bootstrap }) => {
  const { token } = await bootstrap();
  const paths = workerPaths();
  ok(paths.length > 150, "found the worker's routes (" + paths.length + ")");
  let n = 0;
  await withLocalUi(async () => {
    for (const p of paths) {
      for (const [kind, mk] of Object.entries(API_STYLES)) {
        for (const method of ["GET", "HEAD"]) {
          const r = await raw(method, p, { headers: mk(token) });
          n++;
          if (r.headers.get("x-eikon-page") === "app") throw new Error(method + " " + p + " (" + kind + ") got the app page");
        }
      }
      // Writes are never pages, even as navigations (a form post).
      for (const method of ["POST", "PUT", "DELETE"]) {
        const r = await raw(method, p, { headers: { ...NAV, "Content-Type": "application/json" }, body: "{}" });
        n++;
        if (r.headers.get("x-eikon-page") === "app") throw new Error(method + " " + p + " got the app page");
      }
    }
  });
  ok(n > 2000, n + " requests checked");
});

test("clean addresses: /today asked by the app still gets Today's JSON; typed in the address bar it gets the page", async ({ raw, bootstrap }) => {
  const { token } = await bootstrap();
  await withLocalUi(async () => {
    const api = await raw("GET", "/today", { headers: API_STYLES["app fetch with token"](token) });
    eq(api.status, 200);
    ok(/application\/json/.test(api.headers.get("content-type") || ""), "json");
    const j = await api.json(); eq(j.ok, true); ok(j.before_opening, "Today's payload");
    ok(/Authorization/.test(api.headers.get("vary") || ""), "the cached JSON is never reused for a page load (Vary: Authorization)");
    ok(/Origin/.test(api.headers.get("vary") || ""), "still varies on Origin");
    const noTok = await raw("GET", "/today", { headers: API_STYLES["fetch without token"]() });
    eq(noTok.status, 401, "without a token the API still says 401");
    const eod = await raw("GET", "/endofday?date=2026-11-03", { headers: API_STYLES["app fetch with token"](token) });
    ok(/application\/json/.test(eod.headers.get("content-type") || ""), "/endofday API answers JSON");
    const page = await raw("GET", "/today", { headers: NAV });
    eq(page.headers.get("x-eikon-page"), "app");
  });
});

test("clean addresses: a worker deployed ahead of the UI (index.html without the mark) behaves exactly as before", async ({ raw }) => {
  const oldHtml = readFileSync(join(UI, "index.html"), "utf8").split("EIKON_UI_BASE").join("X");
  await withLocalUi(async () => {
    const r = await raw("GET", "/", { headers: NAV });
    eq(r.status, 302, "/ still redirects"); eq(r.headers.get("location"), "/ui/index.html");
    const t = await raw("GET", "/today", { headers: NAV });
    eq(t.status, 401, "/today falls through to the API as before");
  }, { indexHtml: oldHtml });
  // GitHub unreachable: same.
  await withLocalUi(async () => {
    const r = await raw("GET", "/?ui=1", { headers: NAV });
    eq(r.status, 302); eq(r.headers.get("location"), "/ui/index.html?ui=1");
  }, { indexHtml: null });
});
