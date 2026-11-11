// Upgrade rehearsal for the one-click demo. The worker as it is live (base commit, or OLD_WORKER=path) fills a database
// the way live is: a live pharmacy group, a second live group with a head office, a live supplier with products and an
// order from a live pharmacy, and the demo group 2 with its real sign-in and some old rows of its own. This copy's
// worker takes over with the demo switched on (DEMO_* as in wrangler.toml): the reset-now route runs to the end, a
// visitor comes in, writes, and leaves. Then the old worker again (rollback), then this one with the demo switched off.
// Proves: every row of every other group, location, supplier and head office is byte-for-byte unchanged throughout;
// every live list answers the same before, during and after; the only schema change is two new tables (demo_state,
// demo_signins); the real sign-in of the demo pharmacy keeps working on both workers; with the switch off nothing shows.
// Run: node --no-warnings tests/rehearsal/demo-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "demo-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const DEMO = { DEMO_ORG_ID: "2", DEMO_LOCATION_ID: "2", DEMO_PHARMACY2_LOCATION_ID: "399", DEMO_SUPPLIER_LOCATION_ID: "599", DEMO_HQ_LOCATION_ID: "899" };
const env = { DB, BOOTSTRAP_TOKEN: "t", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000", SUPERUSER_EMAILS: "maria@live.mt" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
async function api(method, path, { body, token, form, headers } = {}) {
  const h = new Headers(headers || {}); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + path, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; console.log((c ? "  ok   " : "  FAIL ") + m); };
const malta = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
const day = (n) => malta(new Date(Date.now() - n * 864e5)), month = day(0).slice(0, 7);
const q = (sql, ...a) => DB.db.prepare(sql).run(...a);

// ---- 1. the live worker, live data everywhere
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Borg Group", location_name: "Borg Pharmacy", admin_email: "maria@live.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const login = async (email) => (await api("POST", "/auth/login", { body: { email, password: "Demo-Pass-2026" } })).json.token;
const addUser = async (org, loc, email, name) => {
  const salt = crypto.getRandomValues(new Uint8Array(16)), enc = new TextEncoder();
  const key = await crypto.subtle.importKey("raw", enc.encode("Demo-Pass-2026"), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, key, 256);
  q("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,100000,1,?)", org, email, name, "admin", Buffer.from(salt).toString("base64"), Buffer.from(new Uint8Array(bits)).toString("base64"), loc);
  return login(email);
};
q("INSERT INTO orgs (id, name) VALUES (2, 'Demo Pharmacy')"); q("INSERT INTO locations (id, org_id, name) VALUES (2, 2, 'Demo Pharmacy')");
q("INSERT INTO orgs (id, name) VALUES (3, 'Zammit Group')"); q("INSERT INTO locations (id, org_id, name) VALUES (3, 3, 'Zammit Pharmacy')"); q("INSERT INTO locations (id, org_id, name) VALUES (650, 3, 'Zammit Head Office')");
q("INSERT INTO orgs (id, name) VALUES (400, 'Test Supplier')"); q("INSERT INTO locations (id, org_id, name) VALUES (400, 400, 'Test Supplier')");
const L1 = await login("maria@live.mt"), L3 = await addUser(3, 3, "rita@live.mt", "Rita Zammit"), HO = await addUser(3, 650, "ho@live.mt", "Head Office"), SUP = await addUser(400, 400, "sales@supplier.mt", "Sales");
const JOHN = await addUser(2, 2, "john@demo-owner.mt", "John Agius");
for (const T of [L1, L3, JOHN]) {
  const devs = (await api("GET", "/temperature/devices", { token: T })).json?.devices || [];
  for (let n = 1; n <= 6; n++) for (const dv of devs) await api("POST", "/temperature/entries", { token: T, body: { device_id: dv.id, entry_date: day(n), min_temp: 3.1, max_temp: 6.4, notes: "" } });
  await api("POST", "/cleaning/entries", { token: T, body: { entry_date: day(2), time_in: "08:00", time_out: "08:40", cleaner_name: "Doris", staff_name: "Maria", notes: "" } });
  await api("POST", "/daily-register/entries", { token: T, body: { entry_date: day(1), client_id: "0012345M", client_name: "Zammit Carmel", medicine_name_dose: "Amoxil 500mg", posology: "1-1-1", prescriber_name: "Dr Abela", prescriber_reg_no: "R1" } });
  await api("PUT", "/endofday/record", { token: T, body: { record: { date: day(1), eod_date: day(1), time_of_day: "PM", staff: "M", staff_name: "M", float_amount: "150", x: [{ amount: "900" }], epos: [], cheques: [], paid_outs: [], cash: {}, deposit: {}, notes: "", action: "SAVE" } } });
  await api("GET", "/board/messages", { token: T });
  await api("POST", "/board/messages", { token: T, body: { body: "Message from " + T.slice(0, 4), scope: "all" } });
  await api("POST", "/scarce-stock/needs", { token: T, body: { entry_date: day(0), item_name: "Mounjaro", quantity_needed: 1 } });
  await api("POST", "/shifts/staff", { token: T, body: { full_name: "Karl Vella", designation: "pharmacist" } });
}
await api("POST", "/supplier-products/entries", { token: SUP, body: { description: "Paracetamol 500mg x24", cost_excl_vat: 1, retail_price: 2.4 } });
const ord = await api("POST", "/supplier-orders", { token: L1, body: { supplier_location_id: 400, supplier_name: "Test Supplier", items: [{ description: "Paracetamol 500mg x24", qty_requested: 6 }] } });
ok(ord.status === 200, "a live order to the live supplier");

const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
// every row that is not the demo group's (a row is the demo's when an owner column names group 2 or a demo place)
const isDemo = (r, cols) => cols.some((c) => (/org_id$/.test(c) ? Number(r[c]) === 2 : [2, 399, 599, 899].includes(Number(r[c]))));
const live = () => {
  const o = {};
  for (const t of tables()) {
    if (["sessions", "eikon_schema", "login_attempts", "demo_state", "demo_signins", "board_user_state"].includes(t)) continue;
    const cols = DB.db.prepare(`PRAGMA table_info("${t}")`).all().map((c) => c.name).filter((c) => /^(org_id|location_id)$/.test(c) || /_(org_id|location_id)$/.test(c));
    let rows = DB.db.prepare(`SELECT * FROM "${t}" ORDER BY rowid`).all();
    if (t === "users") rows = rows.filter((r) => !/@demo\.eikon\.invalid$/.test(r.email));
    if (t === "locations") rows = rows.filter((r) => ![399, 599, 899].includes(r.id));
    else if (cols.length) rows = rows.filter((r) => !isDemo(r, cols));
    if (t === "supplier_order_items") rows = rows.filter((r) => DB.db.prepare("SELECT 1 FROM supplier_orders WHERE id = ? AND pharmacy_location_id NOT IN (2,399) AND supplier_location_id NOT IN (599)").get(r.order_id));
    if (t === "board_mentions") rows = rows.filter((r) => DB.db.prepare("SELECT 1 FROM board_messages WHERE id = ? AND org_id != 2").get(r.message_id));
    o[t] = JSON.stringify(rows);
  }
  return o;
};
const LISTS = [[L1, "/temperature/entries?month=" + month], [L1, "/daily-register/entries?month=" + month], [L1, "/board/messages"], [L1, "/scarce-stock/needs"], [L1, "/supplier-products/inventory"], [L1, "/supplier-orders/sent"],
  [L3, "/board/messages"], [L3, "/scarce-stock/needs"], [L3, "/today"], [HO, "/owner/summary"], [HO, "/admin/pharmacy-overview"], [SUP, "/supplier-orders/received"], [SUP, "/supplier-products/entries"], [L1, "/board/suggestions"]];
// The demo group's own rows (old ones John wrote at location 2 with "everyone" scope) are not live data: left out of
// every comparison, as the reset takes them away by design.
const strip = (j) => JSON.stringify(j, (k, v) => (["generated_at", "server_time", "now", "serverNow", "time"].includes(k)) ? undefined
  : Array.isArray(v) ? v.filter((x) => !(x && typeof x === "object" && (Number(x.org_id) === 2 || [2, 399, 599, 899].includes(Number(x.location_id))))) : v);
const lists = async () => { const o = {}; for (const [T, p] of LISTS) { const r = await api("GET", p, { token: T }); o[p + "@" + T.slice(0, 4)] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), before = live(); // lists first: a first read can make a pharmacy's default rows (certificates)
const johnOld = await api("GET", "/daily-register/entries?month=" + month, { token: JOHN });

// ---- 2. this worker, demo on: reset now, a visitor, then the nightly path
worker = NEW; Object.assign(env, DEMO);
let r, n = 0;
do { r = await api("POST", "/su/api/demo/reset", { token: L1, body: {} }); n++; } while (r.json && r.json.ok && !r.json.done && n < 30);
ok(r.json && r.json.done && r.json.problems.length === 0, "reset-now ran to the end in " + n + " calls with no problem: " + JSON.stringify(r.json && r.json.problems));
const added = tables().filter((t) => !tablesOld.includes(t));
ok(JSON.stringify(added.filter((t) => !/^demo_/.test(t))) === JSON.stringify(tables().filter((t) => !tablesOld.includes(t) && !/^demo_/.test(t))) && added.filter((t) => /^demo_/.test(t)).join() === "demo_signins,demo_state",
  "new tables: demo_state and demo_signins (plus module tables the seed's screens make on first use): " + added.join(", "));
const after = live();
let same = true; for (const t of Object.keys(before)) if (after[t] !== before[t]) { same = false; console.log("    changed: " + t); if (process.env.DIFF) { const a = JSON.parse(before[t]), b = JSON.parse(after[t]); console.log(JSON.stringify(a.filter((x) => !b.some((y) => JSON.stringify(y) === JSON.stringify(x)))).slice(0, 600), "\n  vs  ", JSON.stringify(b.filter((x) => !a.some((y) => JSON.stringify(y) === JSON.stringify(x)))).slice(0, 600)); } }
ok(same, "every live row unchanged after the reset (" + Object.keys(before).length + " tables)");
const listsNew = await lists(); let lsame = true;
for (const k of Object.keys(listsOld)) if (listsOld[k] !== listsNew[k]) { lsame = false; console.log("    differs: " + k + "\n      old " + listsOld[k].slice(0, 300) + "\n      new " + listsNew[k].slice(0, 300)); }
ok(lsame, "every live list answers the same with the demo on");
ok((await api("GET", "/auth/me", { token: JOHN })).status === 200, "the demo pharmacy's real sign-in still works (its session survived the reset)");
const V = await api("POST", "/auth/demo", { body: { door: "pharmacy" }, headers: { "CF-Connecting-IP": "203.0.113.9" } });
ok(V.status === 200 && V.json.user.location_id === 2, "a visitor comes in");
await api("POST", "/people", { token: V.json.token, body: { name: "Visitor Test", id_card: "0000009M", phone: "79000009" } });
await api("POST", "/board/messages", { token: V.json.token, body: { body: "Visitor to everyone", scope: "all" } });
const listsVisit = await lists(); let vsame = true;
for (const k of Object.keys(listsOld)) if (listsOld[k] !== listsVisit[k]) { vsame = false; console.log("    differs after a visit: " + k); }
ok(vsame, "a visitor's writes never reach a live list");
let p; await NEW.scheduled({}, { ...env, DEMO_TEST_NOW: day(-1) + " 03:05" }, { waitUntil(x) { p = x; } }); await p;
for (let i = 0; i < 10; i++) { const st = JSON.parse(DB.db.prepare("SELECT v FROM demo_state WHERE k='reset'").get().v); if (!st.running) break; await NEW.scheduled({}, { ...env, DEMO_TEST_NOW: day(-1) + " 03:15" }, { waitUntil(x) { p = x; } }); await p; }
ok(DB.db.prepare("SELECT COUNT(*) AS c FROM people WHERE id_card = '0000009M'").get().c === 0, "the nightly reset took the visitor's row away");
const after2 = live(); let same2 = true; for (const t of Object.keys(before)) if (after2[t] !== before[t]) { same2 = false; console.log("    changed after nightly: " + t); }
ok(same2, "every live row unchanged after the nightly reset");

// ---- 3. rollback: empty the demo group first (DEMO.md), then the old worker on the same database
let w, m = 0; do { w = await api("POST", "/su/api/demo/wipe", { token: L1, body: {} }); m++; } while (w.json && w.json.ok && !w.json.done && m < 10);
ok(w.json && w.json.done && w.json.phase === "wiped", "wipe before switching off: " + (w.json && w.json.phase));
const demoLeft = DB.db.prepare("SELECT (SELECT COUNT(*) FROM supplier_products WHERE org_id = 2) + (SELECT COUNT(*) FROM scarce_stock_needs WHERE org_id = 2) + (SELECT COUNT(*) FROM board_messages WHERE org_id = 2) + (SELECT COUNT(*) FROM people WHERE location_id = 2) AS c").get().c;
ok(demoLeft === 0, "nothing of the demo is left in the lists that read across groups: " + demoLeft);
worker = OLD; for (const k of Object.keys(DEMO)) delete env[k];
const rawBack = (await Promise.all([[L1, "/supplier-products/inventory"], [L3, "/scarce-stock/needs"], [L1, "/board/messages"], [L1, "/board/suggestions"]].map(([T, p]) => api("GET", p, { token: T })))).map((x) => x.text).join(" ");
ok(!/Demo Distributor|Demo Pharmacy Sliema|Ozempic|Mounjaro 5mg|Welcome to the demo/.test(rawBack), "rollback: no live list shows anything of the demo (raw answers)");
const listsBack = await lists(); let bsame = true;
for (const k of Object.keys(listsOld)) if (listsOld[k] !== listsBack[k]) { bsame = false; console.log("    differs on rollback: " + k + "\n      old " + listsOld[k].slice(0, 200) + "\n      now " + listsBack[k].slice(0, 200)); }
ok(bsame, "rollback: the old worker answers every live list as before");
ok((await api("GET", "/daily-register/entries?month=" + month, { token: JOHN })).status === johnOld.status, "rollback: the demo pharmacy's real sign-in works on the old worker");
ok((await api("POST", "/auth/demo", { body: { door: "pharmacy" } })).status === 401, "rollback: the old worker has no demo door (401 as for any unknown signed-out path)");

// ---- 4. this worker, demo switched off
worker = NEW;
ok((await api("GET", "/auth/demo")).status === 404 && !(await api("GET", "/health")).json.demo, "switched off: 404 and /health says nothing");
const listsOff = await lists(); let osame = true;
for (const k of Object.keys(listsOld)) if (listsOld[k] !== listsOff[k]) { osame = false; console.log("    differs switched off: " + k); }
ok(osame, "switched off: every live list as before");
const off = live(); let same3 = true; for (const t of Object.keys(before)) if (off[t] !== before[t]) same3 = false;
ok(same3, "switched off: every live row still unchanged");
console.log(`\ndemo rehearsal: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
