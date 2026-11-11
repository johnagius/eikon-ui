// Roles round: the FIN-roles router hook runs on every signed-in request. Proof that it costs nothing where it does not
// act: (1) for paths it does not handle, no statement touches its columns or tables and nothing is ALTERed; (2) the same
// request makes exactly as many D1 statements as on the same worker without the hook line, per role;
// (3) where it does act, the cost is bounded: one primary-key read of users, plus the rota rows' own reads.
import { test, eq, ok } from "./lib.mjs";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { D1Shim } from "./d1shim.mjs";
import { CORE_SCHEMA, loadWorker } from "./harness.mjs";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
let OLD = null, NEW = null;
async function newWorker() { // a fresh module (a fresh isolate): module-level memos from earlier tests do not leak in
  if (NEW) return NEW;
  const dir = mkdtempSync(join(tmpdir(), "roles-new-")); writeFileSync(join(dir, "new.mjs"), readFileSync(join(ROOT, "cloudflare-worker/code")));
  NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default; return NEW;
}
async function oldWorker() {
  if (OLD) return OLD;
  // The same worker with only the FIN-roles router hook taken out, so other sections' additions never count against the hook.
  const src = readFileSync(join(ROOT, "cloudflare-worker/code"), "utf8").split("\n");
  const hook = src.filter((l) => l.includes("await finRolesRoute(")).length; if (hook !== 1) throw new Error("expected one FIN-roles hook line, found " + hook);
  const dir = mkdtempSync(join(tmpdir(), "roles-old-"));
  writeFileSync(join(dir, "old.mjs"), src.filter((l) => !l.includes("await finRolesRoute(")).join("\n"));
  OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
  return OLD;
}
// A pharmacy with an admin and a staff sign-in, served by `worker`; every statement counted.
async function world(worker) {
  const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
  const seen = [];
  const counted = { prepare: (sql) => { seen.push(sql); return DB.prepare(sql); }, exec: (sql) => { seen.push(sql); return DB.exec(sql); }, batch: (l) => DB.batch(l) };
  const env = { DB: counted, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "3600" };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const call = async (method, path, token, body, form) => {
    const h = new Headers(); let payload;
    if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
    else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
    if (token) h.set("Authorization", "Bearer " + token);
    const r = await worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), env, ctx);
    const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch {}
    return { status: r.status, json };
  };
  await call("POST", "/bootstrap", null, undefined, { bootstrap_token: "t", org_name: "O", location_name: "P", admin_email: "a@x.mt", admin_full_name: "Maria Borg", admin_password: "Passw0rd!" });
  const enc = new TextEncoder(), salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await crypto.subtle.importKey("raw", enc.encode("Passw0rd!"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (1,'s@x.mt','Karl Borg','staff',?,?,100000,1,1)")
    .run(Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"));
  const tok = {};
  for (const e of ["a@x.mt", "s@x.mt"]) tok[e] = (await call("POST", "/auth/login", null, { email: e, password: "Passw0rd!" })).json.token;
  return { DB, seen, call, tok };
}
const PATHS = ["/registers/today", "/today", "/team/today", "/money/today", "/temperature/devices", "/board/messages?limit=5", "/registers/signoffs?month=2026-10"];
const FIN_SQL = /is_pharmacist|plans_rota|shift_staff[^;]*user_id|ADD COLUMN user_id|finRolesSchema/i;

test("roles reads: the hook reads nothing on paths it does not handle; the same statements as the base worker per request and role", async () => {
  const neu = await world(await newWorker());
  const old = await world(await oldWorker());
  const rows = [];
  for (const who of ["a@x.mt", "s@x.mt"]) for (const p of PATHS) {
    for (const w of [neu, old]) { await w.call("GET", p, w.tok[who]); await w.call("GET", p, w.tok[who]); } // warm: tables made, memos set
    neu.seen.length = 0; old.seen.length = 0;
    const a = await neu.call("GET", p, neu.tok[who]), b = await old.call("GET", p, old.tok[who]);
    const fin = neu.seen.filter((s) => FIN_SQL.test(s));
    rows.push(who + " " + p + ": new " + neu.seen.length + " / base " + old.seen.length + " statements, status " + a.status + "/" + b.status + (fin.length ? " FIN: " + fin.join(" ; ") : ""));
    eq(fin.length, 0, "no FIN statement on " + who + " " + p);
    eq(neu.seen.length, old.seen.length, "same number of statements on " + who + " " + p + " (" + rows[rows.length - 1] + ")");
    eq(a.status, b.status, "same answer on " + who + " " + p);
  }
  console.log("       " + rows.join("\n       "));
});

test("roles reads: where the hook acts, one primary-key read of users (plus the rota's own rows)", async (app) => {
  const w = await world(await newWorker());
  await w.call("GET", "/shifts/staff", w.tok["a@x.mt"]); await w.call("GET", "/team/me", w.tok["s@x.mt"]);
  w.seen.length = 0;
  eq((await w.call("GET", "/team/me", w.tok["s@x.mt"])).status, 200);
  const me = w.seen.filter((s) => /FROM users WHERE id = \?/.test(s) && /is_pharmacist/.test(s));
  ok(me.length === 1, "GET /team/me: one primary-key read of the rights: " + w.seen.filter((s) => /is_pharmacist/.test(s)).length);
  w.seen.length = 0;
  await w.call("GET", "/shifts/staff", w.tok["s@x.mt"]);
  const extra = w.seen.filter((s) => FIN_SQL.test(s) || /user_id IS NOT NULL/.test(s));
  ok(extra.length <= 3, "GET /shifts/staff: at most 3 added reads (links, own row, rights): " + extra.length);
});
