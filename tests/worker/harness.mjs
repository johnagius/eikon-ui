// Loads the real worker (cloudflare-worker/code) under Node with an in-memory
// SQLite standing in for D1, and gives tests a tiny HTTP-like client.
//
// The eleven core tables are created out-of-band in production (no migration in
// the repo); their definitions below are reconstructed from the columns the
// worker reads and writes.
import { mkdtempSync, copyFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
import { D1Shim } from "./d1shim.mjs";

const here = fileURLToPath(new URL(".", import.meta.url));
const WORKER_SRC = join(here, "..", "..", "cloudflare-worker", "code");

export const CORE_SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS locations (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, email TEXT NOT NULL UNIQUE, full_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'admin', pass_salt_b64 TEXT NOT NULL, pass_hash_b64 TEXT NOT NULL, pass_iters INTEGER NOT NULL,
  is_active INTEGER NOT NULL DEFAULT 1, default_location_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS sessions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, token_hash_b64 TEXT NOT NULL,
  expires_at TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(token_hash_b64);
CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER, user_id INTEGER, action TEXT NOT NULL,
  entity_type TEXT NOT NULL DEFAULT '', entity_id TEXT NOT NULL DEFAULT '', details_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS temperature_devices (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL,
  name TEXT NOT NULL, device_type TEXT NOT NULL DEFAULT 'fridge', min_limit REAL, max_limit REAL, active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS temperature_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL,
  device_id INTEGER NOT NULL, entry_date TEXT NOT NULL, min_temp REAL, max_temp REAL, notes TEXT NOT NULL DEFAULT '', created_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(org_id, location_id, device_id, entry_date));
CREATE TABLE IF NOT EXISTS sync_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER, module TEXT, op TEXT, payload_json TEXT,
  status TEXT, attempts INTEGER, next_run_at TEXT, created_at TEXT, updated_at TEXT);
CREATE TABLE IF NOT EXISTS cleaning_entries (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL,
  entry_date TEXT NOT NULL, time_in TEXT NOT NULL, time_out TEXT NOT NULL DEFAULT '', cleaner_name TEXT NOT NULL, staff_name TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '', created_by INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
CREATE TABLE IF NOT EXISTS instructions_global (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL,
  data_json TEXT NOT NULL DEFAULT '{}', created_at TEXT, created_by INTEGER, updated_at TEXT, updated_by INTEGER, UNIQUE(org_id, location_id));
CREATE TABLE IF NOT EXISTS instructions_daily (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, location_id INTEGER NOT NULL,
  ymd TEXT NOT NULL, notes TEXT NOT NULL DEFAULT '', handover_json TEXT NOT NULL DEFAULT '[]', created_at TEXT, created_by INTEGER,
  updated_at TEXT, updated_by INTEGER, UNIQUE(org_id, location_id, ymd));
`;

let workerModule = null;
export async function loadWorker() {
  if (workerModule) return workerModule;
  // The worker file has no extension; copy it to a .mjs so Node treats it as ESM.
  const dir = mkdtempSync(join(tmpdir(), "eikon-worker-"));
  const dst = join(dir, "worker.mjs");
  copyFileSync(WORKER_SRC, dst);
  // Stubs for Cloudflare-only globals the worker touches outside /ui/*.
  if (!globalThis.caches) {
    globalThis.caches = { default: { match: async () => undefined, put: async () => {} } };
  }
  workerModule = (await import(pathToFileURL(dst).href)).default;
  return workerModule;
}

export async function makeApp(opts = {}) {
  const worker = await loadWorker();
  const DB = new D1Shim();
  await DB.exec(CORE_SCHEMA);
  const env = {
    DB,
    BOOTSTRAP_TOKEN: "test-bootstrap-token",
    SUPERUSER_EMAILS: opts.superuserEmails || "",
    ALLOWED_ORIGINS: opts.allowedOrigins || "",
    SESSION_TTL_SECONDS: String(opts.sessionTtl || 3600),
    ...(opts.env || {})
  };
  const ctx = { waitUntil() {}, passThroughOnException() {} };
  const origin = "https://eikon.test";

  async function raw(method, path, { body, token, headers, form } = {}) {
    const h = new Headers(headers || {});
    let payload;
    if (form) {
      h.set("Content-Type", "application/x-www-form-urlencoded");
      payload = new URLSearchParams(form).toString();
    } else if (body !== undefined) {
      h.set("Content-Type", "application/json");
      payload = typeof body === "string" ? body : JSON.stringify(body);
    }
    if (token) h.set("Authorization", "Bearer " + token);
    const req = new Request(origin + path, { method, headers: h, body: payload });
    return worker.fetch(req, env, ctx);
  }

  async function api(method, path, o = {}) {
    const res = await raw(method, path, o);
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, headers: res.headers, json, text };
  }

  // Create the first org, location and admin, then sign in.
  async function bootstrap({ org = "Test Org", location = "Demo Pharmacy", email = "admin@example.com", password = "Passw0rd!", name = "Maria Borg" } = {}) {
    const r = await raw("POST", "/bootstrap", {
      form: { bootstrap_token: env.BOOTSTRAP_TOKEN, org_name: org, location_name: location, admin_email: email, admin_full_name: name, admin_password: password }
    });
    const html = await r.text();
    if (!/created|success|ok/i.test(html) && /error/i.test(html)) throw new Error("bootstrap failed: " + html.slice(0, 300));
    const login = await api("POST", "/auth/login", { body: { email, password } });
    if (!login.json || !login.json.ok) throw new Error("login failed: " + login.text.slice(0, 300));
    return { token: login.json.token, user: login.json.user, email, password };
  }

  // Add another user at the same or another location (direct DB insert, like the SU page would).
  async function addUser({ orgId = 1, locationId = 1, email, password = "Passw0rd!", role = "admin", name = "Second User" }) {
    // Reuse the worker's own hashing by going through /admin-recover? Simpler: insert via SU-like path is not exposed; hash here with Web Crypto using the same params.
    const enc = new TextEncoder();
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
    const b64 = (u8) => Buffer.from(u8).toString("base64");
    DB.db.prepare(`INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,1,?)`)
      .run(orgId, email, name, role, b64(salt), b64(new Uint8Array(bits)), 100000, locationId);
    const login = await api("POST", "/auth/login", { body: { email, password } });
    if (!login.json || !login.json.ok) throw new Error("second login failed: " + login.text.slice(0, 300));
    return { token: login.json.token, user: login.json.user, email, password };
  }

  return { worker, env, DB, api, raw, bootstrap, addUser };
}
