// The Content-Security-Policy for the test servers (tests/ui/run.mjs, tests/real/stack.mjs), and a listener for
// violations. The headers come from the REAL worker (cloudflare-worker/code): the page is handed to its /ui/ handler as
// if GitHub raw had sent it, so the suites run under exactly the policy production sends (hashes of the page's own
// inline scripts, sources, report-uri). CSP_ENFORCE=1 in the environment runs them under the enforced policy.
import { loadWorker } from "./worker/harness.mjs";

const memo = new Map();
export async function cspHeadersFor(rel, html) {
  const key = rel + "\n" + html.length + "\n" + html;
  if (memo.has(key)) return memo.get(key);
  const worker = await loadWorker();
  const orig = globalThis.fetch;
  globalThis.fetch = async (u, init) => /^https:\/\/raw\.githubusercontent\.com\//.test(String(u && u.url || u)) ? new Response(html, { status: 200 }) : orig(u, init);
  let out = {};
  try {
    const r = await worker.fetch(new Request("https://eikon.test/ui/" + rel), { UI_CACHE_SECONDS: "0", CSP_ENFORCE: process.env.CSP_ENFORCE || "" }, { waitUntil() {}, passThroughOnException() {} });
    for (const k of ["content-security-policy", "content-security-policy-report-only"]) { const v = r.headers.get(k); if (v) out[k] = v; }
  } finally { globalThis.fetch = orig; }
  memo.set(key, out);
  return out;
}

// Every real (trusted) violation in any page or popup of the context is logged to the console as "__CSPV__ …"; Chrome's
// own "Refused to …" console lines are caught too. onViolation(text, pageUrl) is called once per line.
export async function watchCsp(ctx, onViolation) {
  await ctx.addInitScript(() => {
    addEventListener("securitypolicyviolation", (e) => {
      if (!e.isTrusted) return; // the suite's own synthetic events (the csp reporter check) are not violations
      const f = String(e.sourceFile || "").split("?")[0].split("/").pop();
      console.log("__CSPV__ " + e.disposition + " " + e.effectiveDirective + " blocked=" + String(e.blockedURI || "").slice(0, 80) + " at " + f + ":" + e.lineNumber);
    }, true);
  });
  ctx.on("console", (m) => {
    const t = m.text();
    if (t.startsWith("__CSPV__ ") || /Content Security Policy/i.test(t) && /Refused to|violates/i.test(t)) {
      let u = ""; try { u = m.page() ? m.page().url().slice(0, 80) : ""; } catch (e) {}
      onViolation(t.slice(0, 300), u);
    }
  });
}
