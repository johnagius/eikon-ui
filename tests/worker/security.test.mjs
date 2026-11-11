// Security audit items (2026-11-10): the retired /go/gpt-extractor redirect, the CSP's report-uri and its /csp-report
// endpoint, the CSP_ENFORCE flag (default off: report-only exactly as before), and UI_GITHUB_REF (staging: which git
// ref the /ui/ files come from; default as before).
import { test, eq, ok } from "./lib.mjs";
import { readFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";

const here = fileURLToPath(new URL(".", import.meta.url));
const UI = join(here, "..", "..", "ui");
const INDEX = readFileSync(join(UI, "index.html"), "utf8");
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Accept": "text/html,application/xhtml+xml" };

// GitHub raw answered from ui/ on disk; every URL asked for is recorded.
async function withLocalUi(fn) {
  const orig = globalThis.fetch, asked = [];
  globalThis.fetch = async (u, init) => {
    const s = String(u && u.url || u);
    const m = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(.+?)\/ui\/([^?]+)$/.exec(s);
    if (/^https:\/\/raw\.githubusercontent\.com\//.test(s)) asked.push(s);
    if (m) { const f = join(UI, m[2]); return existsSync(f) ? new Response(readFileSync(f), { status: 200 }) : new Response("404", { status: 404 }); }
    return orig(u, init);
  };
  try { return await fn(asked); } finally { globalThis.fetch = orig; }
}
function directives(csp) {
  const d = {};
  for (const part of String(csp || "").split(";")) { const t = part.trim().split(/\s+/); if (t[0]) d[t[0]] = t.slice(1); }
  return d;
}
function hashes(html) {
  return [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => "'sha256-" + createHash("sha256").update(m[1].replace(/\r\n?/g, "\n")).digest("base64") + "'");
}

test("security: /go/gpt-extractor no longer redirects anywhere: 404, no Location, signed in or not, any /go/ path", async ({ raw, bootstrap }) => {
  const { token } = await bootstrap();
  for (const [p, o] of [["/go/gpt-extractor", {}], ["/go/gpt-extractor", { headers: NAV }], ["/go/gpt-extractor", { token }], ["/go/gpt-extractor?x=1", {}], ["/go/anything", {}]]) {
    const r = await raw("GET", p, o);
    eq(r.status, 404, p + " " + JSON.stringify(Object.keys(o)) + " is 404");
    eq(r.headers.get("location"), null, p + ": no redirect");
    ok(!/chatgpt/i.test(await r.text()), p + ": nothing about the GPT");
  }
  const src = readFileSync(join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  ok(!/chatgpt\.com/i.test(src), "the worker no longer names chatgpt.com");
  // No other redirect in the worker points off-site: every Location is a path, or the app's own new origin.
  const locs = [...src.matchAll(/(?<=["{ ])Location["']?\s*:\s*(?!\$\{)([^,}\n]+)/g)].map((m) => m[1].trim());
  ok(locs.length >= 2, "found the worker's redirects (" + locs.length + ")");
  for (const l of locs) ok(/^"\/|^NEW_APP_ORIGIN\b/.test(l), "redirect target stays on Eikon: " + l);
});

test("security: the app page's CSP is report-only by default (as before) and now names report-uri /csp-report", async ({ raw, env }) => {
  await withLocalUi(async () => {
    for (const v of [undefined, "", "0", "false", "off"]) {
      if (v === undefined) delete env.CSP_ENFORCE; else env.CSP_ENFORCE = v;
      for (const [p, h] of [["/", NAV], ["/today", NAV], ["/ui/index.html", {}]]) {
        const r = await raw("GET", p, { headers: h });
        eq(r.status, 200, p);
        eq(r.headers.get("content-security-policy"), null, p + " CSP_ENFORCE=" + v + ": nothing enforced");
        const d = directives(r.headers.get("content-security-policy-report-only"));
        eq(d["report-uri"], ["/csp-report"], p + ": report-uri");
        ok(d["frame-ancestors"] && d["frame-ancestors"].includes("https://swiftdataautomation.com"), p + ": frame-ancestors still reported");
      }
    }
  });
});

test("security: CSP_ENFORCE=1 enforces the same policy (hashes, sources, report-uri) except frame-ancestors, which stays report-only", async ({ raw, env }) => {
  await withLocalUi(async () => {
    for (const v of ["1", "true", "ON"]) {
      env.CSP_ENFORCE = v;
      for (const [p, h, html] of [["/", NAV, INDEX], ["/endofday", NAV, INDEX], ["/ui/index.html", {}, INDEX], ["/ui/next.html", {}, readFileSync(join(UI, "next.html"), "utf8")]]) {
        const r = await raw("GET", p, { headers: h });
        eq(r.status, 200, p);
        const e = directives(r.headers.get("content-security-policy")), ro = directives(r.headers.get("content-security-policy-report-only"));
        ok(e["script-src"], p + " CSP_ENFORCE=" + v + ": enforced policy present");
        eq(e["script-src"].filter((t) => t.startsWith("'sha256-")), hashes(html), p + ": enforced hashes are the page's own inline scripts");
        ok(!e["script-src"].includes("'unsafe-inline'") && !e["script-src"].includes("'unsafe-eval'"), p + ": no unsafe-inline / unsafe-eval");
        eq(e["frame-ancestors"], undefined, p + ": frames are not refused (GoDaddy's frame origin is unknown)");
        eq(e["report-uri"], ["/csp-report"], p + ": enforced report-uri");
        ok(ro["frame-ancestors"].includes("'self'"), p + ": frame-ancestors in the report-only copy");
        for (const k of Object.keys(e)) eq(e[k], ro[k], p + ": " + k + " is the same in both");
        eq(r.headers.get("x-content-type-options"), "nosniff", p + ": nosniff kept");
      }
      const js = await raw("GET", "/ui/core.js?v=2026-11-03.140");
      eq(js.headers.get("content-security-policy"), null, "no CSP on a script file");
    }
  });
});

test("security: POST /csp-report takes both report shapes with no sign-in, logs origin + file:line only, stores nothing, 204", async ({ raw, DB }) => {
  const lines = [], orig = console.log;
  console.log = (...a) => { lines.push(a.join(" ")); };
  try {
    const legacy = { "csp-report": { "document-uri": "https://eikonhq.com/today?token=abc", "effective-directive": "img-src", "blocked-uri": "https://tiles.example/a/b.png?k=secret", "source-file": "https://eikonhq.com/ui/modules.dlvreg.js?v=1", "line-number": 12, "disposition": "report" } };
    const r1 = await raw("POST", "/csp-report", { body: JSON.stringify(legacy), headers: { "Content-Type": "application/csp-report" } });
    eq(r1.status, 204, "legacy report");
    const api = [{ type: "csp-violation", body: { documentURL: "https://eikonhq.com/", effectiveDirective: "script-src-elem", blockedURL: "inline", sourceFile: "https://eikonhq.com/ui/core.js", lineNumber: 5, disposition: "enforce" } }];
    const r2 = await raw("POST", "/csp-report", { body: JSON.stringify(api), headers: { "Content-Type": "application/reports+json" } });
    eq(r2.status, 204, "Reporting API report");
    const r3 = await raw("POST", "/csp-report", { body: "not json" });
    eq(r3.status, 204, "junk is ignored");
    const csp = lines.filter((l) => l.startsWith("[csp] "));
    eq(csp.length, 2, "one line per violation: " + JSON.stringify(lines));
    eq(JSON.parse(csp[0].slice(6)), { d: "img-src", blocked: "https://tiles.example", page: "today", src: "modules.dlvreg.js:12", mode: "report" });
    eq(JSON.parse(csp[1].slice(6)), { d: "script-src-elem", blocked: "inline", page: "", src: "core.js:5", mode: "enforce" });
    ok(!/secret|token=abc|\/a\/b/.test(lines.join("\n")), "no path, query or token logged");
    const big = await raw("POST", "/csp-report", { body: "x".repeat(20000) });
    eq(big.status, 413, "an oversized body is refused");
  } finally { console.log = orig; }
  const tables = DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='client_errors'").all();
  if (tables.length) eq(DB.db.prepare("SELECT COUNT(*) AS n FROM client_errors").get().n, 0, "nothing stored");
  eq((await raw("GET", "/csp-report")).status === 204, false, "only POST is the report endpoint");
});

test("security: UI_GITHUB_REF picks the git ref the /ui/ files come from; unset, UI_GITHUB_BRANCH then main as before; a bad ref is never used", async ({ raw, env }) => {
  const cases = [
    [{}, "main"],
    [{ UI_GITHUB_BRANCH: "main" }, "main"],
    [{ UI_GITHUB_BRANCH: "pilot-x" }, "pilot-x"],
    [{ UI_GITHUB_REF: "release" }, "release"],
    [{ UI_GITHUB_REF: "release", UI_GITHUB_BRANCH: "main" }, "release"],
    [{ UI_GITHUB_REF: "ui-2026.11.10-176", UI_GITHUB_BRANCH: "main" }, "ui-2026.11.10-176"],
    [{ UI_GITHUB_REF: "  ", UI_GITHUB_BRANCH: "main" }, "main"],
    [{ UI_GITHUB_REF: "../evil", UI_GITHUB_BRANCH: "main" }, "main"],
    [{ UI_GITHUB_REF: "a b" }, "main"],
    [{ UI_GITHUB_REF: "-x" }, "main"],
    [{ UI_GITHUB_REF: "release/" }, "main"],
    [{ UI_GITHUB_REF: "feature/staging" }, "feature/staging"],
  ];
  await withLocalUi(async (asked) => {
    for (const [vars, want] of cases) {
      delete env.UI_GITHUB_REF; delete env.UI_GITHUB_BRANCH; Object.assign(env, vars);
      asked.length = 0;
      const r = await raw("GET", "/ui/app.css");
      eq(r.status, 200, JSON.stringify(vars));
      eq(asked, ["https://raw.githubusercontent.com/johnagius/eikon-ui/" + want + "/ui/app.css"], JSON.stringify(vars) + " reads " + want);
    }
    // The app page (clean address) follows the same ref.
    env.UI_GITHUB_REF = "release"; asked.length = 0;
    const page = await raw("GET", "/today", { headers: NAV });
    eq(page.headers.get("x-eikon-page"), "app");
    eq(asked, ["https://raw.githubusercontent.com/johnagius/eikon-ui/release/ui/index.html"], "the app page reads release");
  });
});
