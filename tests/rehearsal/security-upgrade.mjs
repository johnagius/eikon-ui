// Upgrade rehearsal for the security batch (2026-11-10): /go/gpt-extractor retired, CSP report-uri + /csp-report +
// CSP_ENFORCE (default off), UI_GITHUB_REF (default as before). The worker as it was (base commit, or OLD_WORKER=path)
// builds a database with accounts, sessions and data; this copy's worker takes over the same database; then the old
// one again (rollback). Proves: sign-ins, sessions, roles and every probed read answer exactly the same; the schema
// does not change; the page headers differ only by the added report-uri; the UI is read from the same GitHub ref.
// Run: node --no-warnings tests/rehearsal/security-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "security-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
// The live worker's variables as wrangler.toml sets them (no CSP_ENFORCE, no UI_GITHUB_REF).
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "john@eikon.mt", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000", UI_GITHUB_BRANCH: "main", UI_CACHE_SECONDS: "300" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
const UI = join(ROOT, "ui"), asked = [];
const origFetch = globalThis.fetch;
globalThis.fetch = async (u, init) => {
  const s = String(u && u.url || u), m = /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/(.+?)\/ui\/([^?]+)$/.exec(s);
  if (m) { asked.push(s); const f = join(UI, m[2]); return existsSync(f) ? new Response(readFileSync(f), { status: 200 }) : new Response("404", { status: 404 }); }
  return origFetch(u, init);
};
let worker = OLD;
async function api(method, path, { body, token, form, headers } = {}) {
  const h = new Headers(headers || {}); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text, headers: res.headers };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), month = day(0).slice(0, 7);

// ---- 1. the live worker: accounts, sessions, data
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T0 = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const add = await api("POST", "/team/users", { token: T0, body: { email: "staff@demo.mt", full_name: "Karl Staff", role: "staff" } });
const tmp = add.json && add.json.temporary_password;
const PEOPLE = [["maria@demo.mt", "Demo-Pass-2026"], ...(tmp ? [["staff@demo.mt", tmp]] : [])];
const tok = {};
for (const [e, pw] of PEOPLE) { const L = await api("POST", "/auth/login", { body: { email: e, password: pw } }); if (L.json && L.json.token) tok[e] = L.json.token; }
ok(Object.keys(tok).length === PEOPLE.length && PEOPLE.length === 2, "old worker: admin and staff sign in (" + Object.keys(tok).join(", ") + ")");
const T = tok["maria@demo.mt"];
const devs = (await api("GET", "/temperature/devices", { token: T })).json?.devices || [];
for (const dv of devs.slice(0, 2)) await api("POST", "/temperature/entries", { token: T, body: { device_id: dv.id, entry_date: day(1), min_temp: 3.2, max_temp: 6.1 } });
await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(1), time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Maria", notes: "" } });
await api("POST", "/dda-sales/entries", { token: T, body: { entry_date: day(0), client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg/ml", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S1" } });

const PROBES = ["/auth/me", "/today", "/temperature/devices", "/temperature/entries?month=" + month, "/cleaning/entries?month=" + month, "/dda-sales/entries?month=" + month, "/audit?limit=5", "/team/users", "/su/api/overview", "/health"];
const strip = (t) => String(t).replace(/"(token|generated_at|server_time|now|time|version)":"[^"]*"/g, '"$1":"-"');
const probe = async () => { const o = {}; for (const e of Object.keys(tok)) for (const p of PROBES) { const r = await api("GET", p, { token: tok[e] }); o[e + " " + p] = r.status + " " + strip(r.text).slice(0, 4000); } return o; };
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, sql FROM sqlite_master ORDER BY name").all());
const rows = () => JSON.stringify(["users", "sessions", "temperature_entries", "cleaning_entries"].map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY id").all()));
const NAV = { "Sec-Fetch-Mode": "navigate", "Sec-Fetch-Dest": "document", "Accept": "text/html" };
const pageHeaders = async () => {
  asked.length = 0; const o = {};
  for (const p of ["/ui/index.html", "/today"]) { const r = await api("GET", p, { headers: p === "/today" ? NAV : {} }); o[p] = { status: r.status, ro: r.headers.get("content-security-policy-report-only"), enf: r.headers.get("content-security-policy"), body: r.text.length }; }
  o.asked = asked.slice(); return o;
};
await probe(); // first reads create their schema (as on live, where the tables already exist)
const probesOld = await probe(), schemaOld = schema(), rowsOld = rows(), pagesOld = await pageHeaders();
const goOld = await api("GET", "/go/gpt-extractor");

// ---- 2. this worker takes over
worker = NEW;
const probesNew = await probe();
const diff = Object.keys(probesOld).filter((k) => probesOld[k] !== probesNew[k]);
ok(diff.length === 0, "new worker: every probed read answers byte-for-byte the same for admin and staff" + (diff.length ? " — differs: " + diff.slice(0, 3).map((k) => k + "\n   old " + probesOld[k].slice(0, 200) + "\n   new " + probesNew[k].slice(0, 200)).join("; ") : ""));
ok(schema() === schemaOld, "new worker: the schema is unchanged (no table, column or index added)");
ok(rows() === rowsOld, "new worker: users, sessions and register rows untouched");
for (const [e, pw] of PEOPLE) { const L = await api("POST", "/auth/login", { body: { email: e, password: pw } }); ok(L.json && L.json.ok && L.json.user.role === (e === "maria@demo.mt" ? "admin" : "staff"), "new worker: " + e + " signs in with the same password and role"); }
const pagesNew = await pageHeaders();
ok(JSON.stringify(pagesNew.asked) === JSON.stringify(pagesOld.asked) && pagesNew.asked.every((u) => u.includes("/eikon-ui/main/ui/")), "new worker: the UI is read from the same GitHub ref (main) as before: " + pagesNew.asked.join(", "));
for (const p of ["/ui/index.html", "/today"]) {
  const a = pagesOld[p], b = pagesNew[p];
  ok(a.status === 200 && b.status === 200 && a.body === b.body, p + ": same page");
  ok(b.enf === null && a.enf === null, p + ": nothing enforced (CSP_ENFORCE unset)");
  ok(b.ro === a.ro + "; report-uri /csp-report", p + ": the report-only policy is the old one plus report-uri, nothing else");
}
ok(goOld.status === 302, "old worker: /go/gpt-extractor redirected (" + goOld.status + ")");
const goNew = await api("GET", "/go/gpt-extractor");
ok(goNew.status === 404 && !goNew.headers.get("location"), "new worker: /go/gpt-extractor is 404, no redirect");
const rep = await api("POST", "/csp-report", { body: { "csp-report": { "effective-directive": "img-src", "blocked-uri": "https://x.example/a" } } });
ok(rep.status === 204 && schema() === schemaOld, "new worker: /csp-report answers 204 and stores nothing");
// With the flag on, the same page is enforced; with it off again, exactly as before.
env.CSP_ENFORCE = "1"; const on = await pageHeaders(); delete env.CSP_ENFORCE;
ok(on["/ui/index.html"].enf && !/frame-ancestors/.test(on["/ui/index.html"].enf) && on["/ui/index.html"].ro === pagesNew["/ui/index.html"].ro, "new worker, CSP_ENFORCE=1: enforced policy (frames left report-only), report-only copy unchanged");
const off = await pageHeaders();
ok(JSON.stringify(off) === JSON.stringify(pagesNew), "new worker: flag off again is exactly the default");

// ---- 3. rollback to the old worker (compared on the same state: the sign-ins above moved the device counts)
const probesLast = await probe();
worker = OLD;
const probesBack = await probe();
const diff2 = Object.keys(probesLast).filter((k) => probesLast[k] !== probesBack[k]);
ok(diff2.length === 0, "rollback: the old worker answers every probe exactly as the new one did on the same data" + (diff2.length ? " — " + diff2.slice(0, 3).join(", ") : ""));
ok(schema() === schemaOld, "rollback: schema unchanged");
for (const [e, pw] of PEOPLE) { const L = await api("POST", "/auth/login", { body: { email: e, password: pw } }); ok(L.json && L.json.ok, "rollback: " + e + " signs in"); }

globalThis.fetch = origFetch;
console.log(`\nsecurity rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
