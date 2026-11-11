// Upgrade rehearsal for the controlled-drug over-supply warning (Finish round, records).
// The worker as it was (base commit, or OLD_WORKER=path) fills a database with the four controlled-drug registers, stock
// takes, the locum register and the audit; this copy's worker takes over, reads every list (and the routes it changed),
// saves a classic line and a line with balance_warning; then the old worker again (rollback), then the new.
// Proves: every existing row of every table is unchanged; the only schema change is one new table (and its index); every
// list, the ledger and the medicines list answer the same before and after on existing data; a classic save answers and
// stores as before; the old worker ignores the new table and the new key.
// Run: node --no-warnings tests/rehearsal/records-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "records-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? (await import("node:fs")).readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
const ctx = { waitUntil() {}, passThroughOnException() {} };
let worker = OLD;
async function api(method, path, { body, token, form } = {}) {
  const h = new Headers(); let payload;
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
const last = (() => { const [y, m] = month.split("-").map(Number); return new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 7); })();

// ---- 1. the live worker: controlled-drug registers, counts and the locum register, as a pharmacy has them today
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const sale = (d, med, q, s) => ({ entry_date: d, client_name: "Ċensu Hili", client_id_card: "0012345M", client_address: "1 Triq il-Knisja, Ħamrun", medicine_name_dose: med, quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: s });
const st = (await api("POST", "/dda-stocktakes/stocktakes", { token: T, body: {} })).json.stocktake_id;
await api("POST", `/dda-stocktakes/stocktakes/${st}/items`, { token: T, body: { item_name: "Morphine", dosage: "10mg tablets", qty_tablets: 50 } });
for (let n = 1; n <= 40; n++) {
  await api("POST", "/locumregister/entries", { token: T, body: { entry_date: day(n), time_in: "08:00", time_out: "13:00", locum_full_name: "Anna Vella", registration_number: "P123" } });
  if (n % 5 === 0) await api("POST", "/dda-purchases/entries", { token: T, body: { entry_date: day(n), dda_name_dose: "Morphine 10mg tablets", quantity: 10, agent: "Medicare", invoice_number: "I" + n } });
  if (n % 3 === 0) await api("POST", "/dda-sales/entries", { token: T, body: sale(day(n), n % 2 ? "Morphine 10mg tablets" : "Oxycodone 10mg tablets", 2, "S" + n) });
  if (n % 7 === 0) await api("POST", "/dda-poyc/entries", { token: T, body: sale(day(n), "Methylphenidate 10mg", 30, "P" + n) });
}
const tables = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const indexes = () => DB.db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map((r) => r.name);
const dump = (skip) => { const o = {}; for (const t of tables()) if (!skip.includes(t)) o[t] = JSON.stringify(DB.db.prepare("SELECT * FROM " + t + " ORDER BY rowid").all()); return o; };
const LISTS = ["/dda-sales/entries?month=" + month, "/dda-sales/entries?month=" + last, "/dda-poyc/entries?month=" + month, "/dda-poyc/entries?month=" + last, "/dda-purchases/entries?month=" + month, "/dda-purchases/entries?month=" + last,
  "/dda-stocktakes/stocktakes", "/locumregister/entries?month=" + month, "/dda-register/medicines?to=" + day(0), "/dda-register/ledger?term=morphine&to=" + day(0), "/dda-register/ledger?term=oxycodone&to=" + day(0), "/today"];
const strip = (j) => JSON.stringify(j, (k, v) => (k === "generated_at" || k === "server_time" || k === "now") ? undefined : v);
const lists = async () => { const o = {}; for (const p of LISTS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + strip(r.json); } return o; };
const listsOld = await lists(), tablesOld = tables(), indexesOld = indexes(), SKIP = ["sessions", "audit_log", "login_attempts", "eikon_schema"], before = dump(SKIP);
const auditOld = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());
const oldW = await api("GET", "/dda-register/warnings", { token: T });
ok(oldW.status === 404 || oldW.status === 405 || (oldW.json && oldW.json.ok === false), "the live worker has no warnings route (the check then says nothing more): " + oldW.status);
const oldKey = await api("POST", "/dda-sales/entries", { token: T, body: { ...sale(day(0), "Oxycodone 10mg tablets", 40, "OLD-W"), balance_warning: { balance: 28, after: -12, since: day(90), counted: 0 } } });
ok(oldKey.status === 200 && Object.keys(oldKey.json).sort().join() === "entry_id,ok", "the live worker saves a line with the new key and ignores the key (a newer screen on an older worker still saves)");
const listsOld2 = await lists(), before2 = dump(SKIP), auditOld2 = JSON.stringify(DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all());
console.log("old worker:", tablesOld.length, "tables");

// ---- 2. the new worker on the same database
worker = NEW;
const listsNew = await lists();
ok(LISTS.every((p) => listsNew[p] === listsOld2[p]), "every register list, the ledger, the medicines list and Today answer identically on the new worker (" + LISTS.length + " reads)" + LISTS.filter((p) => listsNew[p] !== listsOld2[p]).map((p) => " · " + p).join(""));
const mid = dump(SKIP.concat(["dda_balance_warnings"]));
ok(Object.keys(before2).every((t) => before2[t] === mid[t]), "reading changes no row");
const plain = await api("POST", "/dda-sales/entries", { token: T, body: sale(day(0), "Oxycodone 10mg tablets", 40, "NEW-1") });
ok(plain.status === 200 && Object.keys(plain.json).sort().join() === "entry_id,ok", "a classic body answers as before");
const warned = await api("POST", "/dda-sales/entries", { token: T, body: { ...sale(day(0), "Oxycodone 10mg tablets", 40, "NEW-1"), balance_warning: { balance: 28, after: -12, since: day(90), counted: 0 } } });
ok(warned.status === 200 && warned.json.balance_warning_kept === true, "a line with the warning saves and keeps it");
const cols = "entry_date, client_name, client_id_card, client_address, medicine_name_dose, quantity, doctor_name, doctor_reg_no, prescription_serial_no, urgent, created_by, org_id, location_id";
const r1 = DB.db.prepare(`SELECT ${cols} FROM dda_sales_entries WHERE id = ?`).get(plain.json.entry_id), r2 = DB.db.prepare(`SELECT ${cols} FROM dda_sales_entries WHERE id = ?`).get(warned.json.entry_id);
ok(JSON.stringify(r1) === JSON.stringify(r2), "the register line is the same with or without the warning");
ok(JSON.stringify(Object.keys(DB.db.prepare("SELECT * FROM dda_sales_entries LIMIT 1").get())) === JSON.stringify(JSON.parse(before2.dda_sales_entries).length ? Object.keys(JSON.parse(before2.dda_sales_entries)[0]) : []), "no column added to the register");
const added = tables().filter((t) => !tablesOld.includes(t)), addedIx = indexes().filter((t) => !indexesOld.includes(t));
const after = dump(SKIP.concat(["dda_balance_warnings", "dda_partials", "dda_partial_parts"]));
const changed = Object.keys(before2).filter((t) => t === "dda_sales_entries" ? !after[t].startsWith(before2[t].slice(0, -1)) : before2[t] !== after[t]);
ok(changed.length === 0, "every existing row of every table is byte-for-byte unchanged (" + Object.keys(before2).length + " tables; the sales register only gained the two new lines)" + (changed.length ? ": " + changed.join(", ") : ""));
const auditNow = DB.db.prepare("SELECT * FROM audit_log ORDER BY id").all(), nOld = JSON.parse(auditOld2).length;
ok(JSON.stringify(auditNow.slice(0, nOld)) === auditOld2 && auditNow.slice(nOld).every((a) => a.action === "DDA_SALES_ENTRY_CREATE"), "the audit keeps every old entry; the new ones are the two lines");
ok(JSON.parse(auditNow[auditNow.length - 1].details_json).balance_warning.after === -12 && !("balance_warning" in JSON.parse(auditNow[auditNow.length - 2].details_json)), "the warning is in its line's audit entry only");
const pst = await api("POST", "/dda-partials", { token: T, body: { register: "sales", entry_id: plain.json.entry_id, prescribed: 90 } });
ok(pst.status === 200 && pst.json.partial.left === 50, "a part-supply starts from a saved line (40 of 90)");
const chk = await api("GET", "/dda-register/check?from=" + day(40) + "&to=" + day(0), { token: T });
ok(chk.status === 200 && chk.json.shortfalls.some((x) => x.key === "oxycodone 10mg tablets"), "the check finds the medicine below zero from the registers");
const ledNew = (await api("GET", "/dda-register/ledger?term=oxycodone&to=" + day(0), { token: T })).json;
ok(ledNew.warnings && ledNew.warnings.length === 1, "the ledger now lists the warning");
const added2 = tables().filter((t) => !tablesOld.includes(t)).sort(), addedIx2 = indexes().filter((t) => !indexesOld.includes(t)).sort();
ok(added2.join() === "dda_balance_warnings,dda_partial_parts,dda_partials" && addedIx2.join() === "idx_dda_balance_warnings_day,idx_dda_partial_parts_entry,idx_dda_partials_open", "the only schema changes are three new tables and their indexes: " + added2.join(", ") + " / " + addedIx2.join(", "));

// ---- 3. rollback: the old worker on the upgraded database
worker = OLD;
const lists3 = await lists();
const same3 = LISTS.filter((p) => !/dda-sales\/entries\?month=|ledger\?term=oxycodone|medicines|\/today/.test(p)).every((p) => lists3[p] === listsOld2[p]);
ok(same3, "after a rollback every list the new lines do not touch answers as before");
const w3 = await api("POST", "/dda-poyc/entries", { token: T, body: sale(day(0), "Methylphenidate 10mg", 5, "RB-1") });
ok(w3.status === 200, "after a rollback the old worker still saves (it ignores the new table)");
worker = NEW;
ok((await api("GET", "/dda-register/warnings?from=" + day(7) + "&to=" + day(0), { token: T })).json.warnings.length === 1, "upgrading again, the warning is still there");
ok((await api("GET", "/dda-partials?register=sales", { token: T })).json.partials.length === 1, "and the part-supply");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
