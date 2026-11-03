// The old address (eikon-api.labrint.workers.dev) moves a browser TAB to eikonhq.com, keeping path and query.
// Frames, API calls, servers, installed apps (their start_url /ui/index.html), booking links and files never move.
import { test, eq, ok } from "./lib.mjs";
import { withLocalUi, NAV, API_STYLES, workerPaths } from "./clean-urls.test.mjs";

const OLD = "https://eikon-api.labrint.workers.dev";
const NEW = "https://eikonhq.com";
const PAGES = ["/", "/ui", "/ui/", "/today", "/endofday", "/registers", "/eodreg", "/customers", "/?ui=1", "/tempreg?ui=classic&x=a%20b"];
const movedTo = (r) => (r.status === 302 && String(r.headers.get("location") || "").startsWith(NEW)) ? r.headers.get("location") : null;

test("old address: a browser tab opening a page moves to eikonhq.com with the same path and query, never stored", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const p of PAGES) for (const method of ["GET", "HEAD"]) {
      const r = await raw(method, OLD + p, { headers: NAV });
      eq(r.status, 302, method + " " + p + " redirects");
      eq(r.headers.get("location"), NEW + p, method + " " + p + " keeps path and query");
      eq(r.headers.get("cache-control"), "no-store", p + " is never kept");
      ok(/Sec-Fetch-Dest/.test(r.headers.get("vary") || ""), p + " varies on Sec-Fetch-Dest");
    }
    // ?stay=0 (or any other value) is not the opt-out
    eq(movedTo(await raw("GET", OLD + "/today?stay=0", { headers: NAV })), NEW + "/today?stay=0");
  });
});

test("old address: ?stay=1, /ui/index.html (installed apps' start_url), files, booking links and the worker's own pages stay", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const p of ["/?stay=1", "/today?stay=1", "/ui/?stay=1", "/ui?stay=1&ui=1", "/ui/index.html", "/ui/index.html?ui=1", "/ui/next.html", "/ui/app.css", "/ui/core.js",
      "/ui/manifest.json", "/ui/manifest-next.json", "/ui/assets/icon-192.png", "/index.html", "/b/abc", "/b", "/book/demo", "/book", "/health", "/su", "/bootstrap",
      "/admin-recover", "/go/gpt-extractor", "/api", "/auth", "/auth/me", "/today/", "/temperature/entries", "/a.b", "/1abc"]) {
      const r = await raw("GET", OLD + p, { headers: NAV });
      eq(movedTo(r), null, p + " is not moved (" + r.status + " " + r.headers.get("location") + ")");
    }
    const idx = await raw("GET", OLD + "/ui/index.html", { headers: NAV }); eq(idx.status, 200, "/ui/index.html answers the page");
    const st = await raw("GET", OLD + "/?stay=1", { headers: NAV }); eq(st.status, 200); eq(st.headers.get("x-eikon-page"), "app", "/?stay=1 gets the app page on the old address");
    const st2 = await raw("GET", OLD + "/ui/?stay=1", { headers: NAV }); eq(st2.status, 302); eq(st2.headers.get("location"), "/ui/index.html?stay=1", "/ui/?stay=1 opens the app here, keeping stay=1");
    eq((await raw("GET", OLD + "/health", { headers: NAV })).status, 200);
  });
});

test("old address: frames, scripts, old browsers and navigations with a token are never moved", async ({ raw, bootstrap }) => {
  const { token } = await bootstrap();
  const kinds = {
    "iframe": { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "iframe", "Sec-Fetch-Site": "cross-site", "Accept": "text/html" },
    "frame": { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "frame", "Accept": "text/html" },
    "embed/object": { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "embed", "Accept": "text/html" },
    "fetch asking for a document": { "Sec-Fetch-Mode": "cors", "Sec-Fetch-Dest": "document", "Accept": "text/html" },
    "navigate without Dest": { "Sec-Fetch-Mode": "navigate", "Accept": "text/html" },
    "old browser (no Sec-Fetch)": { "Accept": "text/html,application/xhtml+xml" },
    "tab with a token": { ...NAV, "Authorization": "Bearer " + token }
  };
  await withLocalUi(async () => {
    for (const [k, h] of Object.entries(kinds)) for (const p of PAGES) {
      const r = await raw("GET", OLD + p, { headers: h });
      eq(movedTo(r), null, k + " " + p + " is not moved");
    }
    // The frame on swiftdataautomation.com still gets the app.
    const fr = await raw("GET", OLD + "/ui/index.html", { headers: kinds.iframe }); eq(fr.status, 200);
  });
});

test("old address: no API call to any worker path is moved (all paths x client kinds x methods), and /today still answers JSON", async ({ raw, bootstrap }) => {
  const { token } = await bootstrap();
  const paths = workerPaths();
  ok(paths.length > 150, "found the worker's routes (" + paths.length + ")");
  let n = 0;
  await withLocalUi(async () => {
    for (const p of paths) {
      for (const [kind, mk] of Object.entries(API_STYLES)) for (const method of ["GET", "HEAD"]) {
        const r = await raw(method, OLD + p, { headers: mk(token) }); n++;
        if (movedTo(r)) throw new Error(method + " " + p + " (" + kind + ") was moved");
      }
      for (const method of ["POST", "PUT", "DELETE", "PATCH", "OPTIONS"]) {
        const r = await raw(method, OLD + p, { headers: { ...NAV, "Content-Type": "application/json" }, body: method === "OPTIONS" ? undefined : "{}" }); n++;
        if (movedTo(r)) throw new Error(method + " " + p + " was moved");
      }
    }
    const api = await raw("GET", OLD + "/today", { headers: API_STYLES["app fetch with token"](token) });
    eq(api.status, 200); ok(/application\/json/.test(api.headers.get("content-type") || ""), "json");
    eq((await api.json()).ok, true);
  });
  ok(n > 2000, n + " requests checked");
});

test("old address: eikonhq.com and every other host are never moved", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const host of ["https://eikonhq.com", "https://www.eikonhq.com", "https://eikon.test", "https://other.labrint.workers.dev", "https://eikon-api.labrint.workers.dev.example.com", "http://localhost:8787"]) {
      for (const p of PAGES) {
        const r = await raw("GET", host + p, { headers: NAV });
        eq(movedTo(r), null, host + p + " is not moved");
      }
    }
    const r = await raw("GET", NEW + "/today", { headers: NAV }); eq(r.status, 200); eq(r.headers.get("x-eikon-page"), "app", "eikonhq.com/today is the app page");
  });
});
