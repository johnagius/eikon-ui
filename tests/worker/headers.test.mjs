// Security headers on the app page and the /ui/ files (backlog 2, item 9): nosniff, Referrer-Policy same-origin, and a
// Content-Security-Policy-Report-Only whose script-src hashes are the page's own inline scripts. The hashes are
// recomputed here from ui/index.html, independently of the worker, so a BUILD bump can never silently break the policy.
import { test, eq, ok } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const UI = join(here, "..", "..", "ui");
const INDEX = readFileSync(join(UI, "index.html"), "utf8");

async function withLocalUi(fn, { indexHtml } = {}) {
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => {
    const s = String(u && u.url || u);
    const m = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^/]+\/ui\/([^?]+)/.exec(s);
    if (m) {
      if (m[1] === "index.html" && indexHtml !== undefined) return new Response(indexHtml, { status: 200 });
      const f = join(UI, m[1]);
      return existsSync(f) ? new Response(readFileSync(f), { status: 200 }) : new Response("404", { status: 404 });
    }
    return orig(u, init);
  };
  try { return await fn(); } finally { globalThis.fetch = orig; }
}

// Independent of the worker: split on the literal tags, keep the ones with no src, normalise newlines as the HTML parser does.
function expectedHashes(html) {
  const out = [];
  let i = 0;
  for (;;) {
    const a = html.toLowerCase().indexOf("<script", i); if (a < 0) break;
    const gt = html.indexOf(">", a); const end = html.toLowerCase().indexOf("</script>", gt);
    const attrs = html.slice(a + 7, gt); const body = html.slice(gt + 1, end);
    if (!/src=/i.test(attrs)) out.push("'sha256-" + createHash("sha256").update(body.replace(/\r\n?/g, "\n"), "utf8").digest("base64") + "'");
    i = end + 9;
  }
  return out;
}
function directives(csp) {
  const d = {};
  for (const part of String(csp || "").split(";")) { const t = part.trim().split(/\s+/); if (t[0]) d[t[0]] = t.slice(1); }
  return d;
}
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Accept": "text/html,application/xhtml+xml" };

function checkPageHeaders(r, html, label) {
  eq(r.headers.get("x-content-type-options"), "nosniff", label + ": nosniff");
  eq(r.headers.get("referrer-policy"), "same-origin", label + ": Referrer-Policy");
  eq(r.headers.get("x-frame-options"), null, label + ": no X-Frame-Options (swiftdataautomation.com frames the app)");
  eq(r.headers.get("content-security-policy"), null, label + ": nothing enforced yet");
  const csp = r.headers.get("content-security-policy-report-only");
  ok(csp, label + ": report-only policy present");
  const d = directives(csp);
  const want = expectedHashes(html);
  ok(want.length >= 2, "index.html has its inline scripts (" + want.length + ")");
  const got = d["script-src"].filter((t) => t.startsWith("'sha256-"));
  eq(got, want, label + ": script-src hashes are exactly the page's inline scripts");
  ok(d["script-src"].includes("'self'"), label + ": script-src 'self'");
  ok(!d["script-src"].includes("'unsafe-inline'") && !d["script-src"].includes("'unsafe-eval'"), label + ": no unsafe-inline / unsafe-eval for scripts");
  eq(d["default-src"], ["'self'"], label + ": default-src");
  eq(d["object-src"], ["'none'"], label + ": object-src");
  for (const a of ["'self'", "https://swiftdataautomation.com", "https://*.swiftdataautomation.com", "https://eikon-api.labrint.workers.dev", "https://eikonhq.com"]) ok(d["frame-ancestors"].includes(a), label + ": frame-ancestors allows " + a);
  ok(d["img-src"].includes("https://*.tile.openstreetmap.org"), label + ": map tiles");
  ok(d["connect-src"].includes("https://geocode.arcgis.com") && d["connect-src"].includes("https://nominatim.openstreetmap.org"), label + ": geocoding");
  return d;
}

test("headers: the app page at / and /<screen> carries nosniff, Referrer-Policy and the report-only CSP with index.html's hashes", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const p of ["/", "/today", "/endofday?ui=1"]) {
      const r = await raw("GET", p, { headers: NAV });
      eq(r.headers.get("x-eikon-page"), "app", p + " is the app page");
      checkPageHeaders(r, INDEX, p);
    }
    const h = await raw("HEAD", "/today", { headers: NAV });
    checkPageHeaders(h, INDEX, "HEAD /today");
  });
});

test("headers: /ui/index.html (the old address, tablets, the swiftdataautomation.com frame) and next.html get the page headers", async ({ raw }) => {
  await withLocalUi(async () => {
    checkPageHeaders(await raw("GET", "/ui/index.html"), INDEX, "/ui/index.html");
    const next = readFileSync(join(UI, "next.html"), "utf8");
    const r = await raw("GET", "/ui/next.html");
    eq(directives(r.headers.get("content-security-policy-report-only"))["script-src"].filter((t) => t.startsWith("'sha256-")), expectedHashes(next), "next.html: its own hash");
  });
});

test("headers: a stamped .js, the stylesheet and a vendored library get nosniff + Referrer-Policy only (no CSP on files)", async ({ raw }) => {
  await withLocalUi(async () => {
    for (const p of ["/ui/core.js?v=2026-11-03.140", "/ui/app.css?v=2026-11-03.140", "/ui/vendor/leaflet-1.9.4/leaflet.js?v=2026-11-03.140"]) {
      const r = await raw("GET", p);
      eq(r.status, 200, p);
      eq(r.headers.get("x-content-type-options"), "nosniff", p + ": nosniff");
      eq(r.headers.get("referrer-policy"), "same-origin", p + ": Referrer-Policy");
      eq(r.headers.get("content-security-policy-report-only"), null, p + ": no CSP on a file");
      eq(r.headers.get("access-control-allow-origin"), "*", p + ": existing headers kept");
      ok(/public, max-age=86400/.test(r.headers.get("cache-control") || ""), p + ": stamped caching kept");
    }
    eq((await raw("GET", "/ui/no-such-file.js")).status, 404, "a missing file is still a 404");
  });
});

test("headers: a BUILD bump (or CRLF line ends) changes the hashes with it: the policy always matches the page it comes with", async ({ raw }) => {
  const bumped = INDEX.replace(/var BUILD = "[^"]+";/, 'var BUILD = "2099-01-01.999";');
  ok(bumped !== INDEX, "BUILD found in index.html");
  const oldHashes = expectedHashes(INDEX), newHashes = expectedHashes(bumped);
  ok(oldHashes.some((h) => !newHashes.includes(h)), "the bump changes an inline script's hash");
  await withLocalUi(async () => {
    checkPageHeaders(await raw("GET", "/", { headers: NAV }), bumped, "/ after a BUILD bump");
    checkPageHeaders(await raw("GET", "/ui/index.html"), bumped, "/ui/index.html after a BUILD bump");
  }, { indexHtml: bumped });
  await withLocalUi(async () => {
    checkPageHeaders(await raw("GET", "/ui/index.html"), INDEX, "/ui/index.html with CRLF line ends");
  }, { indexHtml: INDEX.replace(/\n/g, "\r\n") });
});

test("headers: a file served from the edge cache gets the headers too", async ({ raw }) => {
  const orig = globalThis.caches.default.match;
  globalThis.caches.default.match = async () => new Response("console.log(1)", { status: 200, headers: { "Content-Type": "application/javascript; charset=utf-8", "Cache-Control": "public, max-age=86400" } });
  try {
    const r = await raw("GET", "/ui/core.js?v=2026-11-03.140");
    eq(await r.text(), "console.log(1)", "the cached body");
    eq(r.headers.get("x-content-type-options"), "nosniff");
    eq(r.headers.get("referrer-policy"), "same-origin");
    eq(r.headers.get("cache-control"), "public, max-age=86400", "cached headers kept");
  } finally { globalThis.caches.default.match = orig; }
});

test("headers: API JSON gets nosniff only; the public booking page keeps exactly its own headers", async ({ raw, api, bootstrap }) => {
  const h = await raw("GET", "/health");
  eq(h.headers.get("x-content-type-options"), "nosniff", "/health nosniff");
  eq(h.headers.get("referrer-policy"), null, "/health no Referrer-Policy");
  eq(h.headers.get("content-security-policy-report-only"), null, "/health no CSP");
  const { token } = await bootstrap();
  const me = await raw("GET", "/auth/me", { token });
  eq(me.headers.get("x-content-type-options"), "nosniff", "/auth/me nosniff");
  eq(me.headers.get("content-security-policy-report-only"), null, "/auth/me no CSP");
  // Public booking page (its own headers, set at the booking handlers): unchanged.
  const { makeApp } = await import("./harness.mjs");
  const app = await makeApp({ env: { BOOKINGS_KEY: "test-bookings-secret-0123456789", PUBLIC_BASE_URL: "https://eikon.test" } });
  const t = (await app.bootstrap()).token;
  await app.api("POST", "/bookings/providers", { token: t, body: { name: "Maria", hours: { 1: [["09:00", "12:00"]] } } });
  await app.api("PUT", "/bookings/settings", { token: t, body: { provider: "on", fromEmail: "b@demo.mt" } });
  await app.api("POST", "/bookings/senders", { token: t, body: { kind: "brevo", apiKey: "xkeysib-1" } });
  const on = await app.api("PUT", "/bookings/settings", { token: t, body: { publicEnabled: true } });
  const page = await app.raw("GET", "/book/" + on.json.settings.publicSlug);
  eq(page.status, 200, "booking page");
  eq(page.headers.get("x-frame-options"), "DENY", "booking page: X-Frame-Options DENY as before");
  eq(page.headers.get("referrer-policy"), "no-referrer", "booking page: Referrer-Policy as before");
  eq(page.headers.get("content-security-policy-report-only"), null, "booking page: no app CSP");
  eq(page.headers.get("x-content-type-options"), null, "booking page: untouched");
});

test("headers: core.js's frame check (FRAME_OK) allows exactly the worker's frame-ancestors, and /client-log takes kind csp", async ({ api, bootstrap, DB }) => {
  const WORKER = readFileSync(join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  const CORE = readFileSync(join(UI, "core.js"), "utf8");
  const list = JSON.parse(/const APP_FRAME_ANCESTORS = (\[[^\]]+\])/.exec(WORKER)[1].replace(/\s+/g, " "));
  const m = /var FRAME_OK = \/(.+)\/i;/.exec(CORE);
  ok(m, "FRAME_OK in core.js");
  const re = new RegExp(m[1], "i");
  for (const a of list.filter((x) => x !== "'self'")) ok(re.test(a.replace("*.", "app.")), "FRAME_OK allows " + a);
  for (const bad of ["https://evil.example", "http://swiftdataautomation.com", "https://swiftdataautomation.com.evil.example", "https://img1.wsimg.com", "null"]) ok(!re.test(bad), "FRAME_OK refuses " + bad);
  const { token } = await bootstrap();
  const r = await api("POST", "/client-log", { token, body: { kind: "csp", screen: "deliveries", build: "2026-11-03.141", message: "CSP img-src would block https://a.example (modules.deliveries.js:1374)" } });
  eq(r.status, 200, r.text);
  const row = DB.db.prepare("SELECT kind, message FROM client_errors").get();
  eq(row && row.kind, "csp", "stored as kind csp");
  ok(/^CSP img-src would block https:\/\/a\.example/.test(row.message), row && row.message);
});
