import { test, eq, ok } from "./lib.mjs";
import { makeApp } from "./harness.mjs";

test("the bare address, /ui and /ui/ open the app; API calls are never redirected", async () => {
  const app = await makeApp();
  for (const p of ["/", "/ui", "/ui/", "/index.html", "/?ui=1"]) {
    const r = await app.raw("GET", p);
    eq(r.status, 302, p + " redirects");
    eq(r.headers.get("location"), "/ui/index.html" + (p.includes("?") ? p.slice(p.indexOf("?")) : ""), p + " goes to the app");
  }
  eq((await app.raw("POST", "/")).status === 302, false, "a POST to / is not redirected");
  eq((await app.raw("GET", "/auth/me")).status, 401, "API paths answer as before");
  const h = await app.raw("GET", "/health"); ok(h.status === 200, "health still answers");
});
