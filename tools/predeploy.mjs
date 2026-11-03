// Pre-deploy check for a worker release: one command, exits non-zero on any failure. Local only:
// every outbound fetch is refused, the databases are files under --work, nothing reaches Cloudflare.
//
//   node --no-warnings tools/predeploy.mjs --old <file with the LIVE worker's code> [--rows 250000] [--work .predeploy-work] [--ui]
//   (old code: git show <live commit>:cloudflare-worker/code > old-worker.js)
//
// Steps
//   1 worker tests (tests/worker/run.mjs)
//   2 isolation matrix (the "isolation" tests)
//   3 upgrade rehearsal at scale: the OLD worker creates its tables and records; the database is filled to --rows rows
//     over 20 pharmacies of one group (+ a second group); then the NEW worker takes over the same file. Every row that
//     existed is compared column by column (row hashes); added tables / columns / indexes / rows are listed.
//   4 the list reads the screens make return the same records before and after, and after a rollback to the old code
//   5 /today in a fresh isolate: statements run, old vs new (must stay within +3)
//   6 names fix: dry run report, real run, undo; every table byte-identical to before the real run
//   7 (--ui) the UI suite (tests/ui/run.mjs, mocked API)
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const arg = (k, d) => { const i = process.argv.indexOf("--" + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes("--" + k);
const OLD_FILE = arg("old");
const ROWS = Number(arg("rows", "260000"));
const WORK = path.resolve(arg("work", path.join(ROOT, ".predeploy-work")));
if (!OLD_FILE || !fs.existsSync(OLD_FILE)) { console.error("--old <file with the live worker code> is required"); process.exit(2); }
fs.mkdirSync(WORK, { recursive: true });

const results = []; let failed = 0;
// The workers log a lot; only this script's lines are shown (worker output goes to <work>/worker-console.log).
const out = console.log.bind(console);
fs.writeFileSync(path.join(WORK, "worker-console.log"), "");
const wlog = (...a) => { try { fs.appendFileSync(path.join(WORK, "worker-console.log"), a.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).join(" ").slice(0, 2000) + "\n"); } catch (e) {} };
console.log = wlog; console.info = wlog; console.warn = wlog; console.error = wlog; console.debug = wlog;
const step = (name, ok, detail) => { results.push({ name, ok, detail }); if (!ok) failed++; out((ok ? "PASS " : "FAIL ") + name + (detail ? "  " + detail : "")); };
const info = (...a) => out("     ", ...a);

// Nothing leaves this process.
globalThis.fetch = async (u) => { throw new Error("predeploy: network refused (" + String(u).slice(0, 60) + ")"); };
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };

// ---------------------------------------------------------------- 1, 2: the test suites
function runNode(args, label) {
  const r = spawnSync(process.execPath, ["--no-warnings", ...args], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 << 20 });
  const out = (r.stdout || "") + (r.stderr || "");
  fs.writeFileSync(path.join(WORK, label + ".out"), out);
  const m = /(\d+) passed, (\d+) failed/.exec(out.split("\n").slice(-6).join("\n"));
  return { code: r.status, pass: m ? Number(m[1]) : 0, fail: m ? Number(m[2]) : -1, out };
}
if (!flag("skip-tests")) {
  const w = runNode(["tests/worker/run.mjs"], "worker-tests");
  step("1 worker tests", w.code === 0 && w.fail === 0 && w.pass > 0, `${w.pass} passed, ${w.fail} failed`);
  const iso = runNode(["tests/worker/run.mjs", "isolation"], "isolation");
  const checks = (iso.out.match(/route checks?:? *(\d+)/i) || [])[1];
  step("2 isolation matrix", iso.code === 0 && iso.fail === 0 && iso.pass > 0, `${iso.pass} tests passed, ${iso.fail} failed` + (checks ? `, ${checks} route checks` : ""));
}

// ---------------------------------------------------------------- the two workers on one database
const { D1Shim } = await import(pathToFileURL(path.join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(path.join(ROOT, "tests/worker/harness.mjs")).href);
const NEW_FILE = path.join(ROOT, "cloudflare-worker/code");
let isolateN = 0;
async function isolate(file, tag) { // a fresh module instance = a fresh Cloudflare isolate (module-level memos empty)
  const dst = path.join(WORK, `isolate-${tag}-${++isolateN}.mjs`);
  fs.copyFileSync(file, dst);
  const mod = (await import(pathToFileURL(dst).href)).default;
  fs.unlinkSync(dst);
  return mod;
}
const version = (file) => (/const WORKER_VERSION = "([^"]+)"/.exec(fs.readFileSync(file, "utf8")) || [])[1];
step("0 the new worker names a new version", !!version(NEW_FILE) && version(NEW_FILE) !== version(OLD_FILE), `old ${version(OLD_FILE)}, new ${version(NEW_FILE)} (the live check reads it from /health)`);

const DBFILE = path.join(WORK, "rehearsal.db");
for (const f of [DBFILE, DBFILE + "-wal", DBFILE + "-shm"]) try { fs.unlinkSync(f); } catch {}
const DB = new D1Shim(DBFILE);
DB.db.exec("PRAGMA journal_mode=WAL; PRAGMA synchronous=OFF;");
await DB.exec(CORE_SCHEMA);
let counter = { stmts: 0, trips: 0 };
const countedDB = {
  prepare(sql) { return wrap(DB.prepare(sql)); },
  async exec(sql) { counter.stmts++; counter.trips++; return DB.exec(sql); },
  async batch(list) { counter.stmts += list.length; counter.trips++; return DB.batch(list.map((s) => s._s || s)); }
};
function wrap(s) {
  const o = { _s: s, sql: s.sql };
  o.bind = (...p) => wrap(s.bind(...p));
  for (const m of ["first", "all", "raw", "run"]) o[m] = (...a) => { counter.stmts++; counter.trips++; return s[m](...a); };
  return o;
}
const env = { DB: countedDB, BOOTSTRAP_TOKEN: "predeploy-bootstrap", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "86400" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = await isolate(OLD_FILE, "old");
async function api(method, p, { body, token, form } = {}) {
  const h = new Headers(); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + p, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
const login = async (email) => { const r = await api("POST", "/auth/login", { body: { email, password: "Demo-Pass-2026" } }); if (!r.json?.ok) throw new Error("login " + email + ": " + r.text.slice(0, 200)); return r.json.token; };
async function addUser(org, loc, email, name) {
  const salt = crypto.getRandomValues(new Uint8Array(16)), enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("Demo-Pass-2026"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  DB.db.prepare("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,1,?)")
    .run(org, email, name, "admin", Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"), 100000, loc);
}

// ---------------------------------------------------------------- 3a: the old worker sets up a group of 20 pharmacies
const day = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10), month = day(0).slice(0, 7);
await api("POST", "/bootstrap", { form: { bootstrap_token: env.BOOTSTRAP_TOKEN, org_name: "Demo Group", location_name: "Pharmacy 01", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
for (let i = 2; i <= 20; i++) DB.db.prepare("INSERT INTO locations (org_id, name) VALUES (1, ?)").run("Pharmacy " + String(i).padStart(2, "0"));
DB.db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Other Group')").run();
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Other Pharmacy')").run();
DB.db.prepare("UPDATE users SET default_location_id = 7 WHERE email = 'maria@demo.mt'").run();
await addUser(1, 3, "branch@demo.mt", "Paul Branch");
await addUser(2, 50, "other@demo.mt", "Sara Vella");
const T = await login("maria@demo.mt"), TB = await login("branch@demo.mt"), TO = await login("other@demo.mt");

// every GET route of the old worker once, so it creates its own tables
const oldSrc = fs.readFileSync(OLD_FILE, "utf8");
const getRoutes = [...new Set([...oldSrc.matchAll(/pathname === "(\/[a-z0-9/_-]+)" && request\.method === "GET"/g)].map((m) => m[1]))]
  .filter((p) => !/^\/(admin-recover|bootstrap|su|go\/)/.test(p))
  .concat(["/bookings/setup", "/bookings/services", "/appointments/entries", "/endofday/dates", "/contacts/doctors", "/contacts/specialists", "/contacts/locums", "/vaccines/stock", "/dda-stocktakes", "/creditnotes/list"]);
const q = `?month=${month}&date=${day(0)}&ymd=${day(0)}&from=${day(30)}&to=${day(0)}`;
for (const tk of [T, TB, TO]) for (const p of getRoutes) { try { await api("GET", p + q, { token: tk }); } catch (e) { /* a route that throws on an empty DB is not part of the check */ } }

// records through the old worker's API (real shapes, Maria's pharmacy)
const seeded = [], refused = [];
async function seed(m, p, body, tk = T) { const r = await api(m, p, { token: tk, body }); (r.status < 400 ? seeded : refused).push(m + " " + p + (r.status < 400 ? "" : " " + r.status + " " + r.text.slice(0, 90))); return r; }
for (const [tk, tag] of [[T, "maria"], [TB, "branch"], [TO, "other"]]) {
  const devs = (await api("GET", "/temperature/devices", { token: tk })).json?.devices || [];
  for (let i = 1; i <= 3; i++) for (const dv of devs.slice(0, 2)) await seed("POST", "/temperature/entries", { device_id: dv.id, entry_date: day(i), min_temp: 3.2, max_temp: 6.1 }, tk);
  await seed("POST", "/cleaning/entries", { entry_date: day(2), time_in: "08:00", time_out: "08:40", cleaner_name: "karl spiteri", staff_name: "Maria", notes: "" }, tk);
  await seed("POST", "/dda-sales/entries", { entry_date: day(1), client_name: "zammit carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 2, doctor_name: "DR ABELA", doctor_reg_no: "R1", prescription_serial_no: "S1-" + tag }, tk);
  await seed("POST", "/paid-out/entries", { entry_date: day(0), entry_time: "09:00", payee_name: "Courier Ltd", fee: 12.5, payment_method: "cash", reason: "Gozo" }, tk);
  await seed("POST", "/client-tickets/entries", { client_name: "borg anna", client_phone: "79111222", issue: "Panadol syrup?", category: "General Enquiry", open_date: day(0) }, tk);
  await seed("POST", "/client-deliveries/entries", { client_name: "BORG ANNA", client_phone: "79111222", delivery_address: "5 Triq il-Mithna", order_date: day(0), delivery_date: day(0), items: "Panadol", status: "Pending" }, tk);
  await seed("PUT", "/instructions/daily", { ymd: day(0), notes: "Inspector came", handover_out: [{ id: "b1", sev: "r", text: "Methadone at 9", created_at: new Date().toISOString() }] }, tk);
  await seed("POST", "/creditnotes/entries", { issue_date: day(0), entry_date: day(0), client_name: "anna borg", client_surname: "borg", client_first_name: "anna", telephone: "79111222", amount: 15.5, reason: "Return" }, tk);
  await seed("POST", "/repeat-prescriptions/entries", { entry_date: day(30), client_name: "de Gabriele Maria", client_id: "123456M", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", expires_date: day(-150) }, tk);
  await seed("POST", "/quotations/entries", { quote_date: day(0), item_description: "Panadol 500mg x24", supplier: "GSK", vat_rate: 18, cost_excl_vat: 2.4, qty_purchased: 10, retail_price: 4.5 }, tk);
  await seed("POST", "/order-diary/entries", { entry_date: day(0), order_date: day(0), supplier: "Actavis", item_name: "Augmentin 625", quantity: 2, client_name: "mrs borg" }, tk);
  await seed("POST", "/alerts/entries", { entry_date: day(0), alert_type: "recall", status: "open", item_name: "Losartan 50mg", batch: "L9", expiry: "2027-03-01", quantity: "6", reason: "Recall", storage_location: "room" }, tk);
  await seed("POST", "/near-expiry/entries", { product_name: "Ventolin", batch: "V1", expiry_date: day(-40), quantity: 3 }, tk);
  await seed("POST", "/daily-register/entries", { entry_date: day(0), client_name: "GRECH JOSEPH", client_id: "654321M", medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Galea", prescriber_reg_no: "R1300", quantity: "21" }, tk);
  await seed("POST", "/client-orders/entries", { order_date: day(4), client_name: "galea doris", contact: "79445566", items: "Panadol", needed_by: day(-2), pick_up_date: day(-2), deposit: "", priority: 2, notes: "" }, tk);
  await seed("POST", "/people", { name: "McDonald John", id_card: "0221133M", phone: "79112233", address: "9 Triq il-Mitħna, Qormi", source: "manual" }, tk);
}
info(`old worker API: ${seeded.length} records saved, ${refused.length} refused (field guesses, not part of the check)`);
refused.slice(0, 8).forEach((r) => info("  refused: " + r));

// ---------------------------------------------------------------- 3b: fill to scale, straight into the old worker's tables
const NAME_SRC = (() => { const s = fs.readFileSync(NEW_FILE, "utf8"); const i = s.indexOf("const NAME_COLUMNS = ["); const j = s.indexOf("];", i); return s.slice(i + "const NAME_COLUMNS = ".length, j + 1); })();
const NAME_COLUMNS = new Function("return " + NAME_SRC)();
const nameCols = {}; for (const t of NAME_COLUMNS) for (const c of t.cols) (nameCols[t.table] = nameCols[t.table] || {})[c.c] = c.json || true;
let seedN = 42; const rnd = () => ((seedN = (seedN * 1103515245 + 12345) % 2147483648) / 2147483648);
const pick = (a) => a[Math.floor(rnd() * a.length)];
const SURN = ["Zammit", "Grech", "Vella", "Borg", "Camilleri", "Farrugia", "Micallef", "Galea", "Attard", "Spiteri", "Azzopardi", "Mifsud", "Abela", "Debono", "Cassar"];
const FIRST = ["Carmel", "Joseph", "Anna", "Maria", "Paul", "Rita", "John", "Doris", "Mark", "Lisa", "Tony", "Claire"];
const MIXED = ["de Gabriele Maria", "McDonald John", "O'Brien Ann", "Ta' Xbiex Paul", "Vella-Borg Rita", "MacKenzie Rose", "D'Amato Luca", "von Brockdorff Ian"];
const personName = () => { const r = rnd(), n = pick(SURN) + " " + pick(FIRST); if (r < 0.3) return n.toLowerCase(); if (r < 0.5) return n.toUpperCase(); if (r < 0.65) return pick(MIXED); return n; };
const setAt = (o, segs) => { const [k, ...rest] = segs; if (k.endsWith("[]")) { o[k.slice(0, -2)] = [0, 1, 2].map(() => (rest.length ? setAt({}, rest) : personName())); return o; } if (!rest.length) o[k] = personName(); else o[k] = setAt(o[k] && typeof o[k] === "object" ? o[k] : {}, rest); return o; };
const START = Date.UTC(2021, 10, 3), SPAN = 5 * 365;
const dateOf = () => new Date(START + Math.floor(rnd() * SPAN) * 864e5).toISOString().slice(0, 10);
const LOCS = Array.from({ length: 20 }, (_, i) => i + 1).concat([50]);
function gen(table, c, type, d, loc, i) {
  const lc = c.toLowerCase(), nc = nameCols[table] && nameCols[table][c];
  if (nc && nc !== true) { const o = {}; for (const p of nc) setAt(o, p.split(".")); o.note = "x"; return rnd() < 0.05 ? JSON.stringify(o, null, 1) : JSON.stringify(o); }
  if (nc) return personName();
  if (lc === "org_id" || lc.endsWith("_org_id")) return loc === 50 ? 2 : 1;
  if (lc === "location_id" || lc.endsWith("_location_id")) return loc;
  if (lc.endsWith("_iso")) return d + "T10:00:00.000Z";
  if (lc === "created_at" || lc === "updated_at" || lc.endsWith("_at")) return d + " 10:" + String(i % 60).padStart(2, "0") + ":00";
  if (lc.endsWith("_date") || ["date", "ymd", "timestamp", "day"].includes(lc)) return d;
  if (lc.endsWith("_time") || ["time", "time_in", "time_out"].includes(lc)) return "09:30";
  if (lc.endsWith("_json")) return /handover|items|log|list|rows|history/.test(lc) ? "[]" : "{}";
  if (["created_by", "updated_by", "user_id"].includes(lc)) return 1;
  if (lc.startsWith("is_") || ["active", "fulfilled", "resolved", "voided", "cancelled", "urgent"].includes(lc)) return rnd() < 0.9 ? 1 : 0;
  if (lc.includes("name")) return pick(SURN) + " " + pick(FIRST);
  if (["id_card", "client_id", "client_id_card", "patient_id_card"].includes(lc)) return String(Math.floor(rnd() * 999999)).padStart(7, "0") + "M";
  if (lc.includes("phone") || lc === "telephone") return "79" + String(100000 + Math.floor(rnd() * 899999));
  if (lc.includes("email")) return "client" + (i % 9999) + "@mail.mt";
  if (lc.includes("address")) return (1 + (i % 200)) + " Triq il-Knisja, Valletta";
  if (/fee|price|amount|total|cost|vat|discount|margin|tendered/.test(lc)) return Math.round(rnd() * 12000) / 100;
  if (/^(quantity|qty)/.test(lc)) return 1 + Math.floor(rnd() * 30);
  if (/^id$|_id$/.test(lc) && /INT/i.test(type)) return 1 + Math.floor(rnd() * 3);
  if (/INT/i.test(type)) return Math.floor(rnd() * 3);
  if (/REAL/i.test(type)) return Math.round(rnd() * 5000) / 100;
  return pick(["panadol", "nurofen", "voltaren", "amoxil", "zyrtec", "gaviscon"]) + " " + (i % 97);
}
const NOFILL = new Set(["orgs", "locations", "users", "sessions", "eikon_schema", "sqlite_sequence", "login_attempts", "rate_limits", "temperature_devices", "sqlite_stat1"]);
const tablesNow = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const fillTables = tablesNow().filter((t) => !NOFILL.has(t) && !/^bk_(settings|senders)$/.test(t));
const already = () => tablesNow().reduce((n, t) => n + DB.db.prepare(`SELECT count(*) n FROM "${t}"`).get().n, 0);
// temperature: 2 devices x 21 pharmacies x a year of days
{
  const devs = DB.db.prepare("SELECT id, org_id, location_id FROM temperature_devices").all();
  const ins = DB.db.prepare("INSERT OR IGNORE INTO temperature_entries (org_id, location_id, device_id, entry_date, min_temp, max_temp, notes, created_by) VALUES (?,?,?,?,?,?,?,1)");
  DB.db.exec("BEGIN"); for (const dv of devs) for (let k = 5; k < 370; k++) ins.run(dv.org_id, dv.location_id, dv.id, day(k), 3 + rnd(), 6 + rnd(), ""); DB.db.exec("COMMIT");
}
const budget = Math.max(0, ROWS - already());
const weight = (t) => (t === "audit_log" ? 25 : /dda_|daily_register|client_orders|people|repeat_prescription|cleaning|paid_out/.test(t) ? 4 : 1);
const wsum = fillTables.reduce((n, t) => n + weight(t), 0);
let filled = 0; const fillErr = [];
for (const t of fillTables) {
  const n = Math.round(budget * weight(t) / wsum);
  const info2 = DB.db.prepare(`PRAGMA table_info("${t}")`).all().filter((c) => !(c.pk && /INT/i.test(c.type)));
  if (!info2.length || !n) continue;
  const ins = DB.db.prepare(`INSERT OR IGNORE INTO "${t}" (${info2.map((c) => '"' + c.name + '"').join(",")}) VALUES (${info2.map(() => "?").join(",")})`);
  DB.db.exec("BEGIN");
  try { for (let i = 0; i < n; i++) { const loc = LOCS[i % LOCS.length]; const d = dateOf(); ins.run(...info2.map((c) => gen(t, c.name, c.type, d, loc, i))); filled++; } DB.db.exec("COMMIT"); }
  catch (e) { DB.db.exec("ROLLBACK"); fillErr.push(t + ": " + e.message.slice(0, 80)); }
}
const totalRows = already();
info(`filled ${fillTables.length} tables, ${totalRows} rows in all over 21 pharmacies (20 in one group)` + (fillErr.length ? `; not filled: ${fillErr.join("; ")}` : ""));

// ---------------------------------------------------------------- snapshot
const hash = (o) => createHash("sha1").update(JSON.stringify(o)).digest("base64");
function snapshot() {
  const s = { tables: {}, master: {} };
  for (const r of DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()) s.master[r.type + ":" + r.name] = r.sql;
  for (const t of tablesNow()) {
    const cols = DB.db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    const rows = new Map(); let max = 0;
    for (const r of DB.db.prepare(`SELECT rowid AS __r, * FROM "${t}" ORDER BY rowid`).iterate()) { const id = r.__r; delete r.__r; rows.set(id, hash(cols.map((c) => r[c]))); max = id; }
    s.tables[t] = { cols, rows, max };
  }
  return s;
}
function compare(before, label) {
  const out = { changedRows: {}, newRows: {}, addedTables: [], addedCols: {}, addedIdx: [], changedSql: [], goneRows: {} };
  for (const t of tablesNow()) {
    const b = before.tables[t];
    if (!b) { out.addedTables.push(t + " (" + DB.db.prepare(`SELECT count(*) n FROM "${t}"`).get().n + " rows)"); continue; }
    const cols = DB.db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name);
    const add = cols.filter((c) => !b.cols.includes(c)); if (add.length) out.addedCols[t] = add;
    let ch = 0, seen = 0, nw = 0; const ex = [];
    for (const r of DB.db.prepare(`SELECT rowid AS __r, ${b.cols.map((c) => '"' + c + '"').join(",")} FROM "${t}" ORDER BY rowid`).iterate()) {
      if (r.__r > b.max) { nw++; continue; }
      const h0 = b.rows.get(r.__r); if (h0 === undefined) { nw++; continue; }
      seen++; if (hash(b.cols.map((c) => r[c])) !== h0) { ch++; if (ex.length < 3) ex.push(r.__r); }
    }
    if (ch) out.changedRows[t] = ch + " (rowid " + ex.join(", ") + ")";
    if (seen !== b.rows.size) out.goneRows[t] = b.rows.size - seen;
    if (nw) out.newRows[t] = nw;
  }
  const master = {}; for (const r of DB.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all()) master[r.type + ":" + r.name] = r.sql;
  for (const k of Object.keys(master)) { if (!(k in before.master)) { if (k.startsWith("index:")) out.addedIdx.push(k.slice(6)); } else if (master[k] !== before.master[k] && k.startsWith("index:")) out.changedSql.push(k); }
  return out;
}

// ---------------------------------------------------------------- the reads the screens make
const READS = ["/temperature/entries?month=" + month, "/cleaning/entries?month=" + month, "/dda-sales/entries?month=" + month, "/paid-out/entries?month=" + month,
  "/client-tickets/entries", "/client-deliveries/entries", "/instructions/daily?ymd=" + day(0), "/appointments/entries", "/creditnotes/list", "/repeat-prescriptions/entries",
  "/quotations/entries", "/order-diary/entries?date=" + day(0), "/alerts/entries", "/near-expiry/entries", "/daily-register/entries?month=" + month, "/auth/me",
  "/client-orders/entries", "/people?q=borg&limit=50"];
const idsOf = (j) => { if (!j) return null; const arr = j.entries || j.items || j.tickets || j.deliveries || j.notes || j.people || j.orders || j.credit_notes || j.creditnotes || (j.record ? [j.record] : null) || (j.user ? [j.user] : null); return Array.isArray(arr) ? arr.map((r) => JSON.stringify([r.id, r.client_name || r.payee_name || r.item_name || r.item_description || r.email || r.name || r.notes || r.device_id])).sort() : null; };
async function readAll(who) { const o = {}; for (const [tk, tag] of who) for (const p of READS) { const r = await api("GET", p, { token: tk }); o[tag + " " + p] = { status: r.status, ids: idsOf(r.json) }; } return o; }
const WHO = [[T, "maria"], [TB, "branch"], [TO, "other"]];
function sameReads(a, b) { const diff = []; let same = 0; for (const k of Object.keys(a)) { if (a[k].status === b[k].status && JSON.stringify(a[k].ids) === JSON.stringify(b[k].ids)) same++; else diff.push(`${k}: ${a[k].status} ${a[k].ids ? a[k].ids.length : "-"} -> ${b[k].status} ${b[k].ids ? b[k].ids.length : "-"}`); } return { same, n: Object.keys(a).length, diff }; }

// Control: the old worker's own housekeeping on a second pass (expired offers closed, old messages purged, ...).
// It happens whichever code runs, so it is taken out before the snapshot and reported separately.
const sweep = async () => { for (const tk of [T, TB, TO]) for (const p of getRoutes) { try { await api("GET", p + q, { token: tk }); } catch (e) {} } };
const s0 = snapshot(); worker = await isolate(OLD_FILE, "old"); await sweep(); const control = compare(s0); // a fresh isolate, so its per-isolate timers start again
info("control (old code, second pass): changed " + JSON.stringify(control.changedRows) + "; gone " + JSON.stringify(control.goneRows) + "; new " + JSON.stringify(control.newRows));
// warm the old worker's schema marks, then measure its fresh-isolate /today
await api("GET", "/today", { token: T });
worker = await isolate(OLD_FILE, "old"); counter = { stmts: 0, trips: 0 };
const todayOld = await api("GET", "/today", { token: T }); const coldOld = { ...counter };
const readsOld = await readAll(WHO);
const auditOld = await api("GET", "/audit/log?limit=200", { token: T });
const before = snapshot();
info(`snapshot: ${Object.keys(before.tables).length} tables, ${Object.values(before.tables).reduce((n, t) => n + t.rows.size, 0)} rows; /today old ${todayOld.status}`);

// ---------------------------------------------------------------- 3c: the new worker takes over
worker = await isolate(NEW_FILE, "new"); counter = { stmts: 0, trips: 0 };
const todayUp = await api("GET", "/today", { token: T }); const coldUpgrade = { ...counter };
const me = await api("GET", "/auth/me", { token: T });
const relog = await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } });
const readsNew = await readAll(WHO);
for (const tk of [T, TB, TO]) for (const p of getRoutes) { try { await api("GET", p + q, { token: tk }); } catch (e) {} } // every new schema step runs
await api("GET", "/bookings/setup", { token: T });
const auditNew = await api("GET", "/audit/log?limit=200", { token: T });
const cmp = compare(before);
const volatileNew = ["audit_log", "sessions", "login_attempts", "rate_limits", "eikon_schema", "client_errors"];
const unexpectedNew = Object.keys(cmp.newRows).filter((t) => !volatileNew.includes(t) && !/^(name_case_|people_id_card_change)/.test(t));
const changedNotMarks = Object.keys(cmp.changedRows).filter((t) => t !== "eikon_schema");
step("3 upgrade rehearsal: every existing row unchanged", changedNotMarks.length === 0 && Object.keys(cmp.goneRows).length === 0 && unexpectedNew.length === 0 && me.status === 200 && relog.json?.ok === true,
  `${Object.values(before.tables).reduce((n, t) => n + t.rows.size, 0)} rows in ${Object.keys(before.tables).length} tables compared; changed: ${JSON.stringify(cmp.changedRows)}; gone: ${JSON.stringify(cmp.goneRows)}; session kept ${me.status}; same password ${relog.json?.ok}`);
info("added tables:", cmp.addedTables.join(", ") || "none");
info("added columns:", JSON.stringify(cmp.addedCols));
info("added indexes:", cmp.addedIdx.join(", ") || "none");
info("new rows (expected only in audit_log, sessions, marks):", JSON.stringify(cmp.newRows));
if (unexpectedNew.length) info("UNEXPECTED new rows in:", unexpectedNew.join(", "));
const rd = sameReads(readsOld, readsNew);
step("4a list reads: same records before and after", rd.same === rd.n, `${rd.same}/${rd.n} (3 users x ${READS.length} lists)` + (rd.diff.length ? " differs: " + rd.diff.join(" | ") : ""));
info(`/audit/log maria: old ${auditOld.status} ${(auditOld.json?.entries || []).length} rows (total ${auditOld.json?.total}), new ${auditNew.status} ${(auditNew.json?.entries || []).length} rows (total ${auditNew.json?.total})`);

// 5: /today fresh isolate
worker = await isolate(NEW_FILE, "new"); counter = { stmts: 0, trips: 0 };
const todayNew = await api("GET", "/today", { token: T }); const coldNew = { ...counter };
const sameToday = JSON.stringify(Object.keys(todayOld.json || {}).sort()) === JSON.stringify(Object.keys(todayNew.json || {}).sort());
step("5 /today cold start", todayNew.status === 200 && coldNew.stmts <= coldOld.stmts + 3,
  `old ${coldOld.stmts} statements / ${coldOld.trips} round trips; new ${coldNew.stmts} / ${coldNew.trips}; first /today right after the swap ${coldUpgrade.stmts} / ${coldUpgrade.trips} (one-off schema steps); same top-level keys ${sameToday}; status old ${todayOld.status} new ${todayNew.status} upgrade ${todayUp.status}`);

// 4b: rollback to the old code on the upgraded database
worker = await isolate(OLD_FILE, "old");
const meRb = await api("GET", "/auth/me", { token: T });
const readsRb = await readAll(WHO);
const rb = sameReads(readsOld, readsRb);
step("4b rollback: old code on the upgraded database", meRb.status === 200 && rb.same === rb.n, `session ${meRb.status}; ${rb.same}/${rb.n} lists same` + (rb.diff.length ? " differs: " + rb.diff.join(" | ") : ""));

// ---------------------------------------------------------------- 6: names fix
worker = await isolate(NEW_FILE, "new");
const groups = ["customers", "legal", "staff"];
const dry = await api("POST", "/admin/names/titlecase", { token: T, body: { dry_run: 1, groups, limit: 5000 } });
const perGroup = {}; const samples = [];
for (const g of groups) { perGroup[g] = { tables: 0, rows_checked: 0, would_change: 0, skipped_unusual_json: 0 }; for (const e of dry.json?.groups?.[g] || []) { if (e.missing) continue; perGroup[g].tables++; perGroup[g].rows_checked += e.rows_checked; perGroup[g].would_change += e.would_change; perGroup[g].skipped_unusual_json += e.skipped_unusual_json; for (const s of e.samples) samples.push({ table: e.table, col: e.columns.join("+"), ...s }); } }
const isMixed = (v) => typeof v === "string" && v !== v.toLowerCase() && v !== v.toUpperCase();
// Names are capitalised word by word since batch-2 (eikonNameCase): in a mixed-case name only the words typed all in
// lower or all in upper case change ("de Gabriele Maria" -> "De Gabriele Maria"); inner capitals (McDonald) stay.
// The one-off fix looks only at values all in lower or all in upper case (its SQL sift), except in an entry with a
// JSON column (POCT), where a mixed-case name changes word by word. The expectation uses the new worker's own
// eikonNameCase, read from its code.
const NAME_CASE = (() => { const m = fs.readFileSync(NEW_FILE, "utf8").match(/\nfunction eikonNameCase\(value\) \{[\s\S]*?\n\}\n/); return m ? new Function("return (" + m[0] + ")")() : null; })();
const caseOf = (v) => (NAME_CASE ? NAME_CASE(v) : v);
const mixedTouched = samples.filter((s) => { const a = String(s.from).split(", "), b = String(s.to).split(", "); return a.some((v, i) => MIXED.includes(v) && b[i] !== caseOf(v)); });
const nameDataBefore = snapshot();
const wouldTotal = dry.json?.would_change || 0;
// mixed-case and org-2 values before the real run
// [table, column, unsifted]: the fix's SQL sift (column all lower or all upper, A-Z only) is skipped for an entry with a JSON column.
const plainCols = NAME_COLUMNS.flatMap((t) => t.cols.filter((c) => !c.json).map((c) => [t.table, c.c, t.cols.some((x) => x.json)])).filter(([t]) => tablesNow().includes(t));
const sqlLower = (v) => v.replace(/[A-Z]/g, (ch) => ch.toLowerCase()), sqlUpper = (v) => v.replace(/[a-z]/g, (ch) => ch.toUpperCase());
const keepBefore = new Map();
// What the run should leave: org 1 values the fix looks at (past its sift) as eikonNameCase gives them; the rest unchanged.
for (const [t, c, unsifted] of plainCols) for (const r of DB.db.prepare(`SELECT id, org_id, "${c}" v FROM "${t}"`).iterate()) if (isMixed(r.v) || r.org_id !== 1) keepBefore.set(t + "." + c + "." + r.id, { v: r.v, want: r.org_id === 1 && typeof r.v === "string" && r.v && (unsifted || r.v === sqlLower(r.v) || r.v === sqlUpper(r.v)) ? caseOf(r.v) : r.v });
const runs = []; let changed = 0, cells = 0;
for (let k = 0; k < 200; k++) { const r = await api("POST", "/admin/names/titlecase", { token: T, body: { dry_run: 0, groups, limit: 5000 } }); if (!r.json?.ok) { runs.push({ err: r.text.slice(0, 200) }); break; } runs.push(r.json.run_id); changed += r.json.changed; cells += r.json.cells_changed; if (!r.json.more) break; }
let keptMixed = 0, perWordMixed = 0, brokeMixed = 0; const brokeEx = [];
for (const [t, c] of plainCols) for (const r of DB.db.prepare(`SELECT id, "${c}" v FROM "${t}"`).iterate()) { const k = t + "." + c + "." + r.id; if (keepBefore.has(k)) { const e = keepBefore.get(k); if (e.want !== r.v) { brokeMixed++; if (brokeEx.length < 6) brokeEx.push(`${t}.${c}#${r.id} "${e.v}" -> "${r.v}" (expected "${e.want}")`); } else if (e.v === r.v) keptMixed++; else perWordMixed++; } }
const leftLowerUpper = plainCols.reduce((n, [t, c]) => n + DB.db.prepare(`SELECT count(*) n FROM "${t}" WHERE org_id = 1 AND "${c}" GLOB '*[A-Za-z][A-Za-z]*' AND ("${c}" = lower("${c}") OR "${c}" = upper("${c}"))`).get().n, 0);
const again = await api("POST", "/admin/names/titlecase", { token: T, body: { dry_run: 1, groups, limit: 5000 } });
for (const id of runs.filter((x) => typeof x === "string").reverse()) await api("POST", "/admin/names/titlecase/undo", { token: T, body: { run_id: id } });
const afterUndo = compare(nameDataBefore);
const undoChanged = Object.keys(afterUndo.changedRows);
const undoNew = Object.keys(afterUndo.newRows).filter((t) => !["audit_log", "eikon_schema", "sessions"].includes(t) && !/^name_case_/.test(t));
step("6 names fix: dry run, real run, undo", dry.status === 200 && !!NAME_CASE && changed === wouldTotal && brokeMixed === 0 && mixedTouched.length === 0 && (again.json?.would_change || 0) === 0 && undoChanged.length === 0 && undoNew.length === 0,
  `dry run would change ${wouldTotal} rows; real run changed ${changed} rows / ${cells} cells in ${runs.length} calls; mixed-case and other-group values kept ${keptMixed}, word-by-word as eikonNameCase ${perWordMixed}, otherwise changed ${brokeMixed}${brokeEx.length ? " e.g. " + brokeEx.join(" | ") : ""}; dry run after: ${again.json?.would_change}; after undo changed rows: ${JSON.stringify(afterUndo.changedRows)}; added: ${afterUndo.addedTables.join(", ")}; new rows ${JSON.stringify(afterUndo.newRows)}`);
info("names dry run per group:", JSON.stringify(perGroup));
info("lower/upper names left after the run (org 1, plain columns, not in the selected list or single words):", leftLowerUpper);
fs.writeFileSync(path.join(WORK, "names-dryrun.json"), JSON.stringify({ perGroup, samples, dry: dry.json }, null, 1));
info("30 sample pairs:"); for (const s of samples.filter((_, i) => i % Math.max(1, Math.floor(samples.length / 30)) === 0).slice(0, 30)) info(`  ${s.table}.${s.col.split(" ")[0]} #${s.id}: "${s.from}" -> "${s.to}"`);

// ---------------------------------------------------------------- 4c: audit trail scoped to the pharmacy for new rows
worker = await isolate(NEW_FILE, "new");
await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(0), time_in: "07:00", time_out: "07:30", cleaner_name: "Audit Probe Maria", staff_name: "Maria", notes: "" } });
await api("POST", "/cleaning/entries", { token: TB, body: { entry_date: day(0), time_in: "07:00", time_out: "07:30", cleaner_name: "Audit Probe Branch", staff_name: "Paul", notes: "" } });
const au = await api("GET", "/audit/log?limit=500", { token: T }), aub = await api("GET", "/audit/log?limit=500", { token: TB });
const locsOf = (r) => [...new Set((r.json?.entries || []).map((e) => e.location_id))];
const sees = (r, who) => (r.json?.entries || []).some((e) => JSON.stringify(e.details || {}).includes("Audit Probe " + who));
step("4c audit trail: new rows stay with their pharmacy", au.status === 200 && locsOf(au).every((l) => l === null || l === 7) && locsOf(aub).every((l) => l === null || l === 3) && !sees(au, "Branch") && !sees(aub, "Maria"),
  `maria sees location ids ${JSON.stringify(locsOf(au))}, branch ${JSON.stringify(locsOf(aub))}; maria sees the branch's new row: ${sees(au, "Branch")}; her own: ${sees(au, "Maria")}`);

// ---------------------------------------------------------------- 4d: error reports
const clSigned = await api("POST", "/client-log", { token: T, body: { build: "2026-11-03.139", screen: "today", kind: "error", message: "predeploy probe 0012345M", stack: "" } });
const clUnsigned = await api("POST", "/client-log", { body: { build: "x", screen: "today", kind: "error", message: "probe", stack: "" } });
const clRow = DB.db.prepare("SELECT message FROM client_errors ORDER BY id DESC LIMIT 1").get();
worker = await isolate(OLD_FILE, "old");
const clOld = await api("POST", "/client-log", { token: T, body: { build: "x", screen: "today", kind: "error", message: "probe", stack: "" } });
step("4d error reports", clSigned.status === 200 && clUnsigned.status === 401 && clOld.status === 200 && clRow && !/0012345M/.test(clRow.message),
  `new: signed ${clSigned.status}, unsigned ${clUnsigned.status}, stored "${clRow && clRow.message}"; old (live) worker answers ${clOld.status} (POST /client-log is live since batch-3)`);

// everything the new code added to the database by the end (some tables appear only when first used)
{
  const m = DB.db.prepare("SELECT type, name FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all();
  info("added by the end, tables:", m.filter((r) => r.type === "table" && !before.tables[r.name]).map((r) => r.name).join(", ") || "none");
  info("added by the end, indexes:", m.filter((r) => r.type === "index" && !(("index:" + r.name) in before.master)).map((r) => r.name).join(", ") || "none");
  const cols = {}; for (const t of Object.keys(before.tables)) { const now = DB.db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name).filter((c) => !before.tables[t].cols.includes(c)); if (now.length) cols[t] = now; }
  info("added by the end, columns:", JSON.stringify(cols));
  info("schema marks (eikon_schema) rows:", DB.db.prepare("SELECT count(*) n FROM eikon_schema").get().n, "(was " + before.tables.eikon_schema.rows.size + ")");
}

// ---------------------------------------------------------------- 7: UI suite (mocked API)
if (flag("ui")) { const u = runNode(["tests/ui/run.mjs"], "ui-suite"); step("7 UI suite", u.code === 0 && u.fail === 0 && u.pass > 0, `${u.pass} passed, ${u.fail} failed`); }

out("\n" + (failed ? `${failed} step(s) FAILED` : "ALL STEPS PASSED") + ` (${results.length} steps)`);
process.exit(failed ? 1 : 0);
