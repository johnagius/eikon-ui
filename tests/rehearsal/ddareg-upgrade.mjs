// Upgrade rehearsal for controlled drugs by medicine (cdreg): two added READ-ONLY routes, /dda-register/medicines and
// /dda-register/ledger. No table, column or index is added. The worker as it was (base commit, or OLD_WORKER=path)
// writes lines in all four controlled-drug registers, then this copy's worker takes over the same database, then the
// old one again (rollback).
// Proves: the schema is identical before and after; every existing row is byte-for-byte unchanged after the new worker
// reads with the new routes; every list the classic and new screens make answers the same before and after; the old
// worker keeps writing and the new routes read its new lines after a rollback and forward again.
// Run: node --no-warnings tests/rehearsal/ddareg-upgrade.mjs [baseCommit]
import { mkdtempSync, writeFileSync, copyFileSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";
const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
const { D1Shim } = await import(pathToFileURL(join(ROOT, "tests/worker/d1shim.mjs")).href);
const { CORE_SCHEMA } = await import(pathToFileURL(join(ROOT, "tests/worker/harness.mjs")).href);
globalThis.caches = globalThis.caches || { default: { match: async () => undefined, put: async () => {} } };
const dir = mkdtempSync(join(tmpdir(), "ddareg-rehearsal-"));
const base = process.argv[2] || execFileSync("git", ["-C", ROOT, "rev-list", "--max-parents=0", "HEAD"]).toString().trim();
writeFileSync(join(dir, "old.mjs"), process.env.OLD_WORKER ? readFileSync(process.env.OLD_WORKER) : execFileSync("git", ["-C", ROOT, "show", base + ":cloudflare-worker/code"], { maxBuffer: 64 << 20 }));
copyFileSync(join(ROOT, "cloudflare-worker/code"), join(dir, "new.mjs"));
const OLD = (await import(pathToFileURL(join(dir, "old.mjs")).href)).default;
const NEW = (await import(pathToFileURL(join(dir, "new.mjs")).href)).default;
const DB = new D1Shim(); await DB.exec(CORE_SCHEMA);
const env = { DB, BOOTSTRAP_TOKEN: "t", SUPERUSER_EMAILS: "", ALLOWED_ORIGINS: "", SESSION_TTL_SECONDS: "2592000" };
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
const malta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const day = (n) => { const [y, m, d] = malta().split("-").map(Number); return new Date(Date.UTC(y, m - 1, d - n)).toISOString().slice(0, 10); };

// ---- 1. the live worker: lines in every controlled-drug register, odd text, two pharmacies
await api("POST", "/bootstrap", { form: { bootstrap_token: "t", org_name: "Demo Org", location_name: "Demo Pharmacy", admin_email: "maria@demo.mt", admin_full_name: "Maria Borg", admin_password: "Demo-Pass-2026" } });
DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
const T = (await api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: "Demo-Pass-2026" } })).json.token;
const sale = (d, med, q, serial, extra) => Object.assign({ entry_date: day(d), client_name: "Vella Ġorġ", client_id_card: "123M", client_address: "1 Triq il-Knisja, Ħamrun", medicine_name_dose: med, quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: serial }, extra || {});
const writes = [
  ["/dda-purchases/entries", { entry_date: day(12), dda_name_dose: "Morphine 10mg tablets", quantity: 30, agent: "Alfred Gera & Sons", invoice_number: "INV-1" }],
  ["/dda-purchases/entries", { entry_date: day(300), dda_name_dose: "Morphine 10mg tablets", quantity: 60, agent: "Old Agent", invoice_number: "OLD-1" }],
  ["/dda-purchases/entries", { entry_date: day(4), dda_name_dose: "Oxycodone 5mg \"brand\" <b>x</b>", quantity: 14, agent: "O'Neill", invoice_number: "INV-2" }],
  ["/dda-sales/entries", sale(5, "Morphine 10mg tablets", 2, "S-1", { urgent: 1 })],
  ["/dda-sales/entries", sale(2, "Alprazolam 0.5mg", 1, "S-2")],
  ["/dda-poyc/entries", sale(3, "morphine  10mg tablets", 1, "P-1")],
];
let wrote = 0;
for (const [p, b] of writes) { const r = await api("POST", p, { token: T, body: b }); if (r.status === 200) wrote++; }
const st = (await api("POST", "/dda-stocktakes/stocktakes", { token: T, body: {} })).json.stocktake_id;
for (const it of [{ item_name: "Morphine", dosage: "10mg tablets", qty_tablets: 50 }, { item_name: "Fentanyl", dosage: "25mcg patches", qty_tablets: 10 }]) { const r = await api("POST", "/dda-stocktakes/stocktakes/" + st + "/items", { token: T, body: it }); if (r.status === 200) wrote++; }
await api("PUT", "/dda-stocktakes/stocktakes/" + st, { token: T, body: { closed: 1 } });
DB.db.prepare("UPDATE dda_stocktakes SET created_at = ? WHERE id = ?").run(day(20) + " 08:00:00", st); // counted 20 days ago
DB.db.prepare("INSERT INTO dda_purchases_entries (org_id, location_id, entry_date, dda_name_dose, quantity, agent, invoice_number) VALUES (1,2,?,?,?,?,?)").run(day(1), "Morphine 10mg tablets", 5, "Branch Agent", "B-1");
ok(wrote === writes.length + 2, "old worker: " + wrote + " lines in received, supplied, POYC and a stock take (+1 in the branch)");
const TABLES = ["dda_purchases_entries", "dda_sales_entries", "dda_poyc_entries", "dda_stocktakes", "dda_stocktake_items"];
const schema = () => JSON.stringify(DB.db.prepare("SELECT type, name, tbl_name, sql FROM sqlite_master ORDER BY type, name").all());
const snap = () => JSON.stringify(TABLES.map((t) => DB.db.prepare("SELECT * FROM " + t + " ORDER BY id").all()));
const m = malta().slice(0, 7), pm = (() => { const [y, mo] = m.split("-").map(Number); const d = new Date(Date.UTC(y, mo - 2, 1)); return d.toISOString().slice(0, 7); })();
const READS = ["/dda-purchases/entries?month=" + m, "/dda-purchases/entries?month=" + pm, "/dda-sales/entries?month=" + m, "/dda-sales/entries?month=" + pm, "/dda-poyc/entries?month=" + m, "/dda-poyc/entries?month=" + pm,
  "/dda-stocktakes/stocktakes", "/dda-stocktakes/stocktakes/" + st, "/dda-sales/check-serial?serial=S-1", "/dda-poyc/check-serial?serial=P-1", "/dda-sales/client?client_id_card=123M",
  "/dda-purchases/report?from=" + day(400) + "&to=" + malta(), "/dda-sales/report?from=" + day(400) + "&to=" + malta(), "/dda-poyc/report?from=" + day(400) + "&to=" + malta()];
const readAll = async () => { const o = {}; for (const p of READS) { const r = await api("GET", p, { token: T }); o[p] = r.status + " " + r.text; } return o; };
const schemaOld = schema(), rowsOld = snap(), readsOld = await readAll();
const ledOld = await api("GET", "/dda-register/ledger?term=morphine&to=" + malta(), { token: T });
ok(ledOld.status === 404 || ledOld.status === 400 || !ledOld.json || !ledOld.json.counts, "the old worker has no ledger route (" + ledOld.status + ")");

// ---- 2. the new worker on the same database
worker = NEW;
const led = await api("GET", "/dda-register/ledger?term=morphine&to=" + malta(), { token: T });
const meds = await api("GET", "/dda-register/medicines?to=" + malta(), { token: T });
ok(led.status === 200 && meds.status === 200, "new worker: the ledger and the medicines list answer");
ok(led.json.counts.length === 1 && led.json.counts[0].qty_tablets === 50, "the ledger finds the count the old worker stored");
ok(led.json.received.length === 1 && led.json.received[0].invoice_number === "INV-1" && led.json.supplied.length === 1 && led.json.poyc.length === 1, "and every line since it, in this pharmacy only");
ok(schema() === schemaOld, "the schema is identical: no table, column or index added");
ok(snap() === rowsOld, "every existing row is byte-for-byte unchanged in all five controlled-drug tables");
const readsNew = await readAll();
const diff = READS.filter((p) => readsNew[p] !== readsOld[p]);
ok(!diff.length, "every list the screens make answers the same before and after (" + READS.length + " reads)" + (diff.length ? " differs: " + diff.join(", ") : ""));
// a classic write on the new worker still lands as before
const w = await api("POST", "/dda-sales/entries", { token: T, body: sale(1, "Morphine 10mg tablets", 3, "S-3") });
ok(w.status === 200, "a classic write on the new worker is accepted");
const led2 = (await api("GET", "/dda-register/ledger?term=morphine&to=" + malta(), { token: T })).json;
ok(led2.supplied.length === 2, "and the ledger shows it");

// ---- 3. rollback: the old worker on the same database
worker = OLD;
const readsRb = await readAll();
const changed = READS.filter((p) => readsRb[p] !== readsNew[p]);
ok(changed.every((p) => /dda-sales\/(entries|report)/.test(p)), "after a rollback the old worker reads every list (only the supplied lists gained the new line)");
const w3 = await api("POST", "/dda-poyc/entries", { token: T, body: sale(1, "Morphine 10mg tablets", 1, "P-2") });
ok(w3.status === 200, "after a rollback the old worker records as before");
worker = NEW;
const led3 = (await api("GET", "/dda-register/ledger?term=morphine&to=" + malta(), { token: T })).json;
ok(led3.poyc.length === 2 && schema() === schemaOld, "forward again: the ledger reads the old worker's new line; the schema is still the same");
console.log(pass, "passed,", fail, "failed");
process.exit(fail ? 1 : 0);
