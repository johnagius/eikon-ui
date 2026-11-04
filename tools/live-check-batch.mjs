// Read-only check after deploying a worker batch (checks written for batch 2: isolation, full audit, names, client-log, ID cards; default version: the current batch).
// Sends only GETs, plus one POST /client-log WITHOUT a token (refused before anything is read or stored).
// It changes nothing, follows no redirect, and talks only to the base URL given.
//
//   node tools/live-check-batch.mjs <base-url> [expected-version]
//   EIKON_TOKEN=<a signed-in demo admin's token> node tools/live-check-batch.mjs <base-url>   (adds the signed-in checks)
//
// Exit code 0 = every check passed.
const base = String(process.argv[2] || "").replace(/\/+$/, "");
const expect = process.argv[3] || "2026-11-04-batch-8";
const token = process.env.EIKON_TOKEN || "";
if (!/^https?:\/\/[^/]+$/.test(base)) { console.error("usage: node tools/live-check-batch.mjs https://<host> [expected-version]"); process.exit(2); }
let fails = 0; const ok = (c, m) => { console.log((c ? "  ok   " : "  FAIL ") + m); if (!c) fails++; };
async function call(method, p, { auth, body } = {}) {
  const h = { Accept: "application/json" };
  if (auth) h.Authorization = "Bearer " + token;
  if (body !== undefined) h["Content-Type"] = "application/json";
  const ctl = new AbortController(); const tm = setTimeout(() => ctl.abort(), 20000);
  try {
    const r = await fetch(base + p, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body), redirect: "manual", signal: ctl.signal });
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json, text, ver: r.headers.get("x-eikon-worker-version") };
  } catch (e) { return { status: 0, json: null, text: String(e && e.message || e) }; } finally { clearTimeout(tm); }
}

const h = await call("GET", "/health");
ok(h.status === 200 && h.json?.version === expect, `/health ${h.status}, version ${h.json?.version} (expected ${expect})`);
const p1 = await call("GET", "/today");
ok(p1.status === 401, `/today without a token: ${p1.status} (expected 401)`);
const p2 = await call("GET", "/audit/log");
ok(p2.status === 401, `/audit/log without a token: ${p2.status} (expected 401)`);
const cl = await call("POST", "/client-log", { body: { build: "live-check", screen: "", kind: "error", message: "live check (unsigned, refused)", stack: "" } });
ok(cl.status === 401, `POST /client-log without a token: ${cl.status} (expected 401)`);

if (token) {
  const me = await call("GET", "/auth/me", { auth: true });
  const loc = me.json?.user?.location_id;
  ok(me.status === 200 && loc != null, `/auth/me ${me.status}: ${me.json?.user?.email || "?"} at location ${loc}, role ${me.json?.user?.role}`);
  const t = await call("GET", "/today", { auth: true });
  ok(t.status === 200 && t.json?.ok !== false, `/today signed in: ${t.status}`);
  const a = await call("GET", "/audit/log?limit=200", { auth: true });
  if (a.status === 403) console.log("  skip /audit/log: this account is not an admin");
  else {
    const locs = [...new Set((a.json?.entries || []).map((e) => e.location_id))];
    ok(a.status === 200 && locs.every((l) => l === null || l === loc), `/audit/log signed in: ${a.status}, ${(a.json?.entries || []).length} of ${a.json?.total} rows, pharmacies seen ${JSON.stringify(locs)} (only ${loc} or older rows without one)`);
    const runs = await call("GET", "/admin/names/titlecase/runs", { auth: true });
    ok(runs.status === 200 && Array.isArray(runs.json?.runs), `names fix routes present (GET runs, read-only): ${runs.status}, ${runs.json?.runs?.length ?? "-"} runs`);
  }
} else console.log("  (set EIKON_TOKEN to a demo admin's token for the signed-in checks)");
console.log(fails ? `${fails} FAILED` : "ALL OK");
process.exit(fails ? 1 : 0);
