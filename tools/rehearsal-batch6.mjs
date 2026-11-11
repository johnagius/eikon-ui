// Upgrade rehearsal for batch 6 (W2 Maltese search, W3 server numbers, W4 scarce stock by group, midnight dates).
// The OLD worker (the live code) creates realistic data in a local database; the NEW worker then takes over the same
// database. Every row that existed must be byte-for-byte unchanged, sessions made on the old worker must still work,
// and the new behaviour must hold. Local only: an in-memory SQLite (tests/worker/d1shim.mjs), nothing reaches Cloudflare.
//
//   git show <live commit>:cloudflare-worker/code > old-worker.js
//   node --no-warnings tools/rehearsal-batch6.mjs old-worker.js [new-worker-file, default cloudflare-worker/code]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const { D1Shim } = await import(pathToFileURL(path.join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(path.join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
globalThis.fetch = async () => { throw new Error("rehearsal: no network"); };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "eikon-b6-"));
const load = async (file, name) => { const dst = path.join(tmp, name + ".mjs"); fs.copyFileSync(file, dst); return (await import(pathToFileURL(dst).href)).default; };
const oldFile = process.argv[2], newFile = process.argv[3] || path.join(ROOT, "cloudflare-worker/code");
if (!oldFile) { console.error("usage: node tools/rehearsal-batch6.mjs <old worker file> [new worker file]"); process.exit(2); }
const out = console.log.bind(console); const quiet = () => {}; console.log = quiet; console.info = quiet; console.warn = quiet; console.error = quiet;
const OLD = await load(oldFile, "old"), NEW = await load(newFile, "new");

const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "86400" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
async function api(method, p, { body, token, form } = {}) {
  const h = new Headers(); let payload;
  if (form) { h.set("Content-Type", "application/x-www-form-urlencoded"); payload = new URLSearchParams(form).toString(); }
  else if (body !== undefined) { h.set("Content-Type", "application/json"); payload = JSON.stringify(body); }
  if (token) h.set("Authorization", "Bearer " + token);
  const res = await worker.fetch(new Request("https://eikon.test" + p, { method, headers: h, body: payload }), env, ctx);
  const text = await res.text(); let json = null; try { json = JSON.parse(text); } catch {}
  return { status: res.status, json, text };
}
let pass = 0, fail = 0; const ok = (c, m) => { c ? pass++ : fail++; out((c ? "  ok   " : "  FAIL ") + m); };
const D = "2026-11-04";

// ---- 1. the OLD worker: two chains and a lone pharmacy, as the SU page sets them up (org = group)
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Chain One", location_name: "Chain One A", admin_email: "a@one.mt", admin_full_name: "Maria Borg", admin_password: "Pass-2026-a" } });
const sql = (s, ...a) => DB.db.prepare(s).run(...a);
sql("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Chain One B')");
sql("INSERT INTO locations (id, org_id, name) VALUES (601, 1, 'Chain One Head Office')");
sql("INSERT INTO orgs (id, name) VALUES (2, 'Chain Two')");
sql("INSERT INTO locations (id, org_id, name) VALUES (50, 2, 'Chain Two X')");
sql("INSERT INTO locations (id, org_id, name) VALUES (51, 2, 'Chain Two Y')");
sql("INSERT INTO orgs (id, name) VALUES (3, 'Lone Ltd')");
sql("INSERT INTO locations (id, org_id, name) VALUES (70, 3, 'Lone Pharmacy')");
const users = [["b@one.mt", 1, 2], ["ho@one.mt", 1, 601], ["x@two.mt", 2, 50], ["y@two.mt", 2, 51], ["l@lone.mt", 3, 70]];
const salt = crypto.getRandomValues(new Uint8Array(16));
const hash = async (pw) => { const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(pw), "PBKDF2", false, ["deriveBits"]); return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 100000 }, k, 256)); };
const b64 = (u) => Buffer.from(u).toString("base64"); const hb = b64(await hash("Pass-2026-u"));
for (const [e, o, l] of users) sql("INSERT INTO users (org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id) VALUES (?,?,?,?,?,?,?,1,?)", o, e, e, "admin", b64(salt), hb, 100000, l);
const T = {};
T.A = (await api("POST", "/auth/login", { body: { email: "a@one.mt", password: "Pass-2026-a" } })).json.token;
for (const [e] of users) T[e[0].toUpperCase() === "H" ? "HO" : e[0].toUpperCase()] = (await api("POST", "/auth/login", { body: { email: e, password: "Pass-2026-u" } })).json.token;
ok(Object.values(T).every(Boolean) && Object.keys(T).length === 6, "old worker: six pharmacies signed in (A, B, HO of Chain One; X, Y of Chain Two; L alone)");

const seed = async (tok, m, p, body) => { const r = await api(m, p, { token: tok, body }); if (r.status >= 400) out("     seed refused: " + m + " " + p + " " + r.status + " " + r.text.slice(0, 120)); return r; };
for (const n of ["Cachia Ċettina", "Zammit Ġorġ", "Agius Żaren", "Buhagiar Rita (Ħamrun)", "Borg Anna", "Vella Joseph", "Grech Ċensina"]) await seed(T.A, "POST", "/people", { name: n, phone: "79" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0") });
await api("GET", "/people?q=x", { token: T.A });
sql("INSERT INTO people (org_id, location_id, name) VALUES (1, 1, 'caruana ġużeppa')"); // an older row never re-cased
// Questions and deliveries as older devices left them: TKT-00001 twice (two devices), DEL-00001 twice
for (const [tok, id, who] of [[T.A, "TKT-00001", "Cachia Ġużeppi"], [T.A, "TKT-00001", "Zammit Ġorġ"], [T.A, "TKT-00003", "Borg Anna"], [T.B, "TKT-00001", "Vella Joseph"]])
  await seed(tok, "POST", "/client-tickets/entries", { ticket_id: id, open_date: D, client_name: who, phone: "79111222", issue: "Asked about stock", category: "Stock" });
for (const [tok, id, who] of [[T.A, "DEL-00001", "Agius Żaren"], [T.A, "DEL-00001", "Grech Ċensina"], [T.X, "DEL-00004", "Abela Ġanni"]])
  await seed(tok, "POST", "/client-deliveries/entries", { delivery_id: id, order_date: D, client_name: who, phone: "79333444", delivery_address: "Triq il-Kbira, Żebbuġ" });
await seed(T.A, "POST", "/dda-sales/entries", { entry_date: D, client_name: "Cachia Ċettina", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "S1" });
// Scarce stock across two groups and the lone pharmacy; under the old worker anyone could ask for anything
const offer = async (tok, item) => (await seed(tok, "POST", "/scarce-stock/offers", { entry_date: D, item_name: item, quantity_available: 10, expiry_date: "2027-06-30" })).json.id;
const oA = await offer(T.A, "Ozempic 1mg (A)"), oX = await offer(T.X, "Mounjaro 5mg (X)"), oL = await offer(T.L, "Insulin glargine (L)");
await seed(T.B, "POST", `/scarce-stock/offers/${oA}/requests`, { quantity_requested: 2, note: "for Mrs Borg" });
await seed(T.X, "POST", `/scarce-stock/offers/${oA}/requests`, { quantity_requested: 1, note: "cross-group, old worker" });
await seed(T.L, "POST", `/scarce-stock/offers/${oX}/requests`, { quantity_requested: 1, note: "lone asks chain two" });
await seed(T.A, "POST", "/scarce-stock/needs", { entry_date: D, item_name: "Wegovy", quantity_needed: 1 });
const oldSaw = {}; for (const k of Object.keys(T)) oldSaw[k] = ((await api("GET", "/scarce-stock/offers", { token: T[k] })).json.offers || []).map((o) => o.item_name).sort();
ok(oldSaw.L.length === 3 && oldSaw.X.length === 3, "old worker: every pharmacy sees all three offers (" + oldSaw.L.join(", ") + ")");
const oldCachia = (await api("GET", "/people?q=cettina", { token: T.A })).json;
ok((oldCachia.people || []).length === 0, "old worker: 'cettina' finds nobody (" + JSON.stringify((oldCachia.people || []).map((p) => p.name)) + ")");

// ---- snapshot every row (by table and rowid), the schema, and the lists the screens read
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const dump = () => { const o = {}; for (const t of tables()) { o[t] = new Map(DB.db.prepare("SELECT rowid AS __rid, * FROM " + t).all().map((r) => [r.__rid, JSON.stringify(r)])); } return o; };
const schema = () => new Map(DB.db.prepare("SELECT type, name, sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'").all().map((r) => [r.type + ":" + r.name, r.sql]));
const before = dump(), schemaBefore = schema();
const rows = [...Object.values(before)].reduce((n, m) => n + m.size, 0);
const READS = ["/client-tickets/entries", "/client-deliveries/entries", "/people?q=borg", "/people?q=vella", "/dda-sales/entries?month=2026-11", "/scarce-stock/needs", "/auth/me"];
const shape = (j) => JSON.stringify(j, (k, v) => (k === "updated_at" || k === "now" ? undefined : v));
const readsBefore = {}; for (const p of READS) readsBefore[p] = shape((await api("GET", p, { token: T.A })).json);
out("     snapshot: " + Object.keys(before).length + " tables, " + rows + " rows");

// ---- 2. the NEW worker takes over the same database
worker = NEW;
const h = await api("GET", "/health"); ok(h.json && h.json.version === "2026-11-04-batch-6", "new worker answers /health with 2026-11-04-batch-6 (" + (h.json && h.json.version) + ")");
let sessOk = 0; for (const k of Object.keys(T)) { const me = await api("GET", "/auth/me", { token: T[k] }); if (me.status === 200 && me.json && me.json.ok) sessOk++; }
ok(sessOk === 6, "all six sessions made on the old worker still work on the new one (" + sessOk + "/6)");
const L2 = await api("POST", "/auth/login", { body: { email: "x@two.mt", password: "Pass-2026-u" } }); ok(L2.json && L2.json.ok, "signing in with the same password works");
let same = 0; for (const p of READS) { const now = shape((await api("GET", p, { token: T.A })).json); if (now === readsBefore[p]) same++; else out("     differs: " + p + "\n       " + readsBefore[p].slice(0, 200) + "\n       " + now.slice(0, 200)); }
ok(same === READS.length, `lists without Maltese letters in the query return the same as before (${same}/${READS.length})`);

// W2
const nm = async (q) => ((await api("GET", "/people?q=" + encodeURIComponent(q), { token: T.A })).json.people || []).map((p) => p.name);
const hs = async (q) => ((await api("GET", "/people?q=" + encodeURIComponent(q), { token: T.A })).json.history || []).map((p) => p.name);
ok(JSON.stringify(await nm("cettina")) === JSON.stringify(["Cachia Ċettina"]), "W2: 'cettina' finds Cachia Ċettina");
ok(JSON.stringify(await nm("gorg")) === JSON.stringify(["Zammit Ġorġ"]), "W2: 'gorg' finds Zammit Ġorġ");
ok(JSON.stringify(await nm("guzeppa")) === JSON.stringify(["caruana ġużeppa"]), "W2: 'guzeppa' finds the older lowercase 'caruana ġużeppa'");
ok((await hs("guzeppi")).includes("Cachia Ġużeppi"), "W2: history finds Cachia Ġużeppi from 'guzeppi'");
ok(((await api("GET", "/client-tickets/entries?q=gorg", { token: T.A })).json.entries || []).some((e) => e.client_name === "Zammit Ġorġ"), "W2: the Questions list search folds too");

// W3
const tk = await api("POST", "/client-tickets/entries", { token: T.A, body: { ticket_id: "TKT-00001", open_date: D, client_name: "New One", issue: "Q", category: "Stock" } });
ok(tk.json && tk.json.ticket_id === "TKT-00004", "W3: a device sending TKT-00001 again gets TKT-00004 (above the highest, TKT-00003): " + (tk.json && tk.json.ticket_id));
const tk2 = await api("POST", "/client-tickets/entries", { token: T.A, body: { ticket_id: "TKT-00002", open_date: D, client_name: "New Two", issue: "Q", category: "Stock" } });
ok(tk2.json && tk2.json.ticket_id === "TKT-00002", "W3: an unused number is kept (TKT-00002)");
const tkOld = await api("POST", "/client-tickets/entries", { token: T.B, body: { ticket_id: "TKT-00002", open_date: D, client_name: "Branch", issue: "Q", category: "Stock" } });
ok(tkOld.json && tkOld.json.ticket_id === "TKT-00002" && tkOld.json.entry_id, "W3: numbers are per pharmacy (B keeps TKT-00002); entry_id still in the reply for older screens");
const dv = await api("POST", "/client-deliveries/entries", { token: T.A, body: { delivery_id: "DEL-00001", order_date: D, client_name: "New", delivery_address: "x" } });
ok(dv.json && dv.json.delivery_id === "DEL-00002" && dv.json.id, "W3: DEL-00001 again gets DEL-00002: " + (dv.json && dv.json.delivery_id));
const dupT = DB.db.prepare("SELECT COUNT(*) AS c FROM client_tickets_entries WHERE org_id = 1 AND location_id = 1 AND ticket_id = 'TKT-00001'").get().c;
ok(dupT === 2, "W3: the two old TKT-00001 rows are still there, never renumbered (" + dupT + ")");

// W4
const sees = async (k) => ((await api("GET", "/scarce-stock/offers", { token: T[k] })).json.offers || []).map((o) => o.item_name).sort();
const nowSaw = {}; for (const k of Object.keys(T)) nowSaw[k] = await sees(k);
ok(JSON.stringify([nowSaw.A, nowSaw.B, nowSaw.HO]) === JSON.stringify([["Ozempic 1mg (A)"], ["Ozempic 1mg (A)"], ["Ozempic 1mg (A)"]]), "W4: Chain One (A, B, head office 601) sees only Chain One's offer");
ok(JSON.stringify([nowSaw.X, nowSaw.Y]) === JSON.stringify([["Mounjaro 5mg (X)"], ["Mounjaro 5mg (X)"]]), "W4: Chain Two (X, Y) sees only Chain Two's offer");
ok(JSON.stringify(nowSaw.L) === JSON.stringify(["Insulin glargine (L)"]), "W4: the lone pharmacy sees only its own");
const ownA = ((await api("GET", "/scarce-stock/offers", { token: T.A })).json.offers || [])[0] || {};
ok(ownA.total_requested === 3 && (ownA.requests || []).length === 2, "W4: A's offer still counts both earlier requests, the other group's included (" + ownA.total_requested + ")");
ok((await api("POST", `/scarce-stock/offers/${oA}/requests`, { token: T.Y, body: { quantity_requested: 1 } })).status === 404, "W4: another group cannot ask for A's offer (404)");
ok((await api("POST", `/scarce-stock/offers/${oX}/requests`, { token: T.L, body: { quantity_requested: 1 } })).status === 404, "W4: the lone pharmacy cannot ask Chain Two's offer");
const bAsk = await api("POST", `/scarce-stock/offers/${oA}/requests`, { token: T.HO, body: { quantity_requested: 1 } });
ok(bAsk.status === 200, "W4: the same group can still ask (head office): " + bAsk.status);
ok((await api("GET", "/scarce-stock/needs", { token: T.L })).text.includes("Wegovy"), "needs are unchanged: still seen by every pharmacy");

// ---- every row that existed is byte-for-byte unchanged; only the expected tables gained rows; schema additions listed
const after = dump(), schemaAfter = schema();
const changed = [], grew = {};
for (const t of Object.keys(before)) {
  for (const [rid, row] of before[t]) { const a = after[t] && after[t].get(rid); if (a !== row) changed.push(t + "#" + rid); }
  const n = (after[t] ? after[t].size : 0) - before[t].size; if (n) grew[t] = n;
}
// eikon_schema is the worker's own note of which schema steps ran (name -> fingerprint of the step's code): a step
// whose code changed (here the two that add the W3 indexes) is re-run once and its note rewritten. Listed, not data.
const bookkeeping = changed.filter((x) => x.startsWith("eikon_schema#")).map((x) => DB.db.prepare("SELECT k FROM eikon_schema WHERE rowid = ?").get(Number(x.split("#")[1])).k);
out("     eikon_schema notes rewritten (schema steps re-run once): " + (bookkeeping.length ? bookkeeping.join(", ") : "none"));
ok(bookkeeping.every((k) => /Tickets|Deliveries/.test(k)), "only the Questions and Deliveries schema steps re-ran");
const volatile = ["sessions", "audit_log", "rate_limits", "login_attempts", "eikon_schema"];
const realChanged = changed.filter((x) => !volatile.includes(x.split("#")[0]));
ok(realChanged.length === 0, "every row that existed before the upgrade is byte-for-byte unchanged (" + rows + " rows compared)" + (realChanged.length ? ": " + realChanged.slice(0, 10).join(", ") : ""));
const volChanged = changed.filter((x) => volatile.includes(x.split("#")[0]));
out("     sessions/audit rows changed by ordinary use (would change under the old worker too): " + (volChanged.length ? volChanged.join(", ") : "none"));
const expectGrow = ["client_tickets_entries", "client_deliveries", "scarce_stock_offer_requests", "sessions", "audit_log", "rate_limits", "login_attempts"];
const unexpected = Object.keys(grew).filter((t) => !expectGrow.includes(t));
ok(unexpected.length === 0, "rows were added only where this rehearsal saved something: " + JSON.stringify(grew));
const added = [...schemaAfter.keys()].filter((k) => !schemaBefore.has(k)), altered = [...schemaBefore.keys()].filter((k) => schemaAfter.get(k) !== schemaBefore.get(k));
ok(altered.length === 0, "no existing table or index definition changed or dropped");
out("     schema objects added by the new worker: " + (added.length ? added.join(", ") : "none"));
ok(added.every((k) => k.startsWith("index:")), "the only schema additions are indexes");
// rollback: the old worker on the upgraded database
worker = OLD;
ok((await api("GET", "/client-tickets/entries", { token: T.A })).json.entries.length === 5, "rollback: the old worker reads the upgraded database (5 questions at A)");
ok((await api("GET", "/scarce-stock/offers", { token: T.L })).json.offers.length === 3, "rollback: the old worker shows every offer again (nothing was moved or hidden in the data)");
out(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
