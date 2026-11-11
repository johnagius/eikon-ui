import { test, eq, ok } from "./lib.mjs";

// Controlled drugs: the over-supply warning seen at entry (Finish round, records). A Supplied or POYC line that takes a
// medicine below what the registers show still saves, exactly as before; the body's extra key balance_warning is kept
// in dda_balance_warnings and in the line's audit entry, and is listed by /dda-register/warnings, the ledger and the
// medicines list. Classic bodies (no key) save, audit and answer exactly as before.
const today = new Date().toISOString().slice(0, 10);
const shift = (ymd, n) => { const d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const sale = (date, med, q, serial) => ({ entry_date: date, client_name: "Carmel Zammit", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: med, quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: serial });
const COLS = "entry_date, client_name, client_id_card, client_address, medicine_name_dose, quantity, doctor_name, doctor_reg_no, prescription_serial_no, created_by";

test("dda warnings: a line with balance_warning saves the same row as without, and the warning is kept and listed", async (app) => {
  const { api, DB } = app;
  const s = await app.bootstrap(), token = s.token;
  await api("POST", "/dda-purchases/entries", { token, body: { entry_date: shift(today, -1), dda_name_dose: "Oxycodone 10mg tablets", quantity: 28, agent: "Agent", invoice_number: "I-1" } });
  for (const [path, table, reg] of [["/dda-sales/entries", "dda_sales_entries", "sales"], ["/dda-poyc/entries", "dda_poyc_entries", "poyc"]]) {
    const plain = await api("POST", path, { token, body: sale(today, "Oxycodone 10mg tablets", 40, "A-" + reg) });
    eq(plain.status, 200, plain.text); eq(Object.keys(plain.json).sort(), ["entry_id", "ok"], "a classic body answers as before");
    const warned = await api("POST", path, { token, body: { ...sale(today, "Oxycodone 10mg tablets", 40, "A-" + reg), balance_warning: { balance: 28, after: -12, since: shift(today, -92), counted: 0 } } });
    eq(warned.status, 200, warned.text); eq(warned.json.balance_warning_kept, true);
    const rows = DB.q(`SELECT ${COLS}${table === "dda_sales_entries" ? ", urgent" : ""} FROM ${table} WHERE id IN (?, ?) ORDER BY id`, plain.json.entry_id, warned.json.entry_id);
    eq(JSON.stringify(rows[0]), JSON.stringify(rows[1]), reg + ": the register line is the same with or without the warning");
    const audits = DB.q("SELECT details_json FROM audit_log WHERE entity_type = ? AND entity_id IN (?, ?) ORDER BY id", table, String(plain.json.entry_id), String(warned.json.entry_id)).map((a) => JSON.parse(a.details_json));
    ok(!("balance_warning" in audits[0]), "the classic line's audit has no warning");
    eq(audits[1].balance_warning, { balance: 28, after: -12, since: shift(today, -92), counted: 0 }, reg + ": the warning seen is in the line's audit entry");
    const w = DB.q("SELECT register, entry_id, medicine, quantity, balance, after FROM dda_balance_warnings WHERE entry_id = ? AND register = ?", warned.json.entry_id, reg)[0];
    eq(w, { register: reg, entry_id: warned.json.entry_id, medicine: "Oxycodone 10mg tablets", quantity: 40, balance: 28, after: -12 });
  }
  const l = (await api("GET", "/dda-register/warnings?from=" + shift(today, -7) + "&to=" + today, { token })).json;
  eq(l.warnings.map((x) => x.register + ":" + x.after), ["sales:-12", "poyc:-12"], "the period's warnings, oldest first");
  ok(l.warnings[0].created_name, "with who saved it");
  const led = (await api("GET", "/dda-register/ledger?term=oxycodone&to=" + today, { token })).json;
  eq(led.warnings.length, 2, "the medicine's ledger carries its warnings");
  const meds = (await api("GET", "/dda-register/medicines?to=" + today, { token })).json;
  eq(meds.warned, [{ name: "Oxycodone 10mg tablets", n: 2, last: today }], "and the medicines list how many");
});

test("dda warnings: not a warning is ignored; another pharmacy sees none; answers without warnings are as before", async (app) => {
  const { api, DB } = app;
  const s = await app.bootstrap(), token = s.token;
  for (const bw of [{ balance: 5, after: 2 }, "yes", [1], { balance: "x", after: -1 }, null]) {
    const r = await api("POST", "/dda-sales/entries", { token, body: { ...sale(today, "Morphine 10mg", 1, "N-" + JSON.stringify(bw)), balance_warning: bw } });
    eq(r.status, 200); eq(Object.keys(r.json).sort(), ["entry_id", "ok"], "ignored: " + JSON.stringify(bw));
  }
  const led = (await api("GET", "/dda-register/ledger?term=morphine&to=" + today, { token })).json;
  ok(!("warnings" in led), "no warnings: the ledger answer has no new key");
  ok(!("warned" in (await api("GET", "/dda-register/medicines?to=" + today, { token })).json), "nor the medicines list");
  await api("POST", "/dda-sales/entries", { token, body: { ...sale(today, "Morphine 10mg", 9, "W-1"), balance_warning: { balance: 0, after: -9, since: today, counted: 1 } } });
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch" });
  eq((await api("GET", "/dda-register/warnings", { token: branch.token })).json.warnings.length, 0, "another pharmacy of the group sees none");
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  eq((await api("GET", "/dda-register/warnings", { token: staff.token })).json.warnings.length, 1, "staff read them, as the registers");
  eq((await api("GET", "/dda-register/warnings")).status, 401);
  eq((await api("GET", "/dda-register/warnings?from=2026-13-01", { token })).status, 400);
  const plan = DB.q("EXPLAIN QUERY PLAN SELECT id FROM dda_balance_warnings WHERE org_id = 1 AND location_id = 1 AND entry_date >= '2026-01-01' AND entry_date <= '2026-02-01'").map((x) => x.detail).join(" | ");
  ok(/idx_dda_balance_warnings_day/.test(plan), "read through its date index: " + plan);
});

test("dda check: an over-supply is found from the registers themselves, with or without a warning sent (classic lines included)", async (app) => {
  const { api, DB } = app;
  const s = await app.bootstrap(), token = s.token;
  const post = async (p, b) => { const r = await api("POST", p, { token, body: b }); eq(r.status, 200, p + " " + r.text); return r.json; };
  // Oxycodone: 28 received, 40 supplied by a classic body (no warning): below zero by 12, never counted
  await post("/dda-purchases/entries", { entry_date: shift(today, -3), dda_name_dose: "Oxycodone 10mg tablets", quantity: 28, agent: "A", invoice_number: "I-1" });
  await post("/dda-sales/entries", sale(shift(today, -2), "Oxycodone 10 mg tablets", 40, "X-1"));
  // Morphine: counted 10 (5 days ago), 12 POYC in the period with a warning seen; then a count of 3 puts it right
  const st = await post("/dda-stocktakes/stocktakes", {});
  await post(`/dda-stocktakes/stocktakes/${st.stocktake_id}/items`, { item_name: "Morphine", dosage: "10mg", qty_tablets: 10 });
  DB.db.prepare("UPDATE dda_stocktakes SET created_at = ? WHERE id = ?").run(shift(today, -5) + " 08:00:00", st.stocktake_id);
  await post("/dda-poyc/entries", { ...sale(shift(today, -1), "morphine 10mg", 12, "P-1"), balance_warning: { balance: 10, after: -2, since: shift(today, -5), counted: 1 } });
  // Fentanyl: fine (counted 10, 4 supplied)
  await post(`/dda-stocktakes/stocktakes/${st.stocktake_id}/items`, { item_name: "Fentanyl", dosage: "25mcg", qty_tablets: 10 });
  await post("/dda-sales/entries", sale(shift(today, -1), "Fentanyl 25mcg", 4, "F-1"));
  await post("/dda-purchases/entries", { entry_date: shift(today, -3), dda_name_dose: "Oxycodone 10mg caps", quantity: 5, agent: "A", invoice_number: "I-2" }); // the same medicine written another way?
  const before = JSON.stringify(["dda_sales_entries", "dda_poyc_entries", "dda_purchases_entries"].map((t) => DB.q(`SELECT * FROM ${t} ORDER BY id`)));
  const j = (await api("GET", `/dda-register/check?from=${shift(today, -7)}&to=${today}`, { token })).json;
  eq(j.shortfalls.map((x) => [x.name, x.first_below, x.lowest, x.counted, x.regs.join(), x.warned]), [
    ["Oxycodone 10 mg tablets", shift(today, -2), -12, false, "sales", 0],
    ["morphine 10mg", shift(today, -1), -2, true, "poyc", 1]], JSON.stringify(j.shortfalls));
  eq(j.shortfalls[1].since, shift(today, -5), "the balance starts at its count");
  eq(j.shortfalls[0].also, ["Oxycodone 10mg caps"], "another spelling with the same first word and strength is named (Q11)");
  ok(!("also" in j.shortfalls[1]), "none for morphine");
  eq(j.shortfalls[1].warned_by.length, 1, "who saw the warning");
  eq(j.days, { supplied: [shift(today, -2), shift(today, -1)], received: [shift(today, -3)] }, "the days with lines, for the locum register");
  eq(j.warnings.length, 1);
  const dOnly = (await api("GET", `/dda-register/check?days_only=1&from=${shift(today, -7)}&to=${today}`, { token })).json;
  eq(Object.keys(dOnly).sort(), ["days", "from", "ok", "to"], "days_only (the locum register's month): only the days");
  eq(dOnly.days, j.days);
  eq(JSON.stringify(["dda_sales_entries", "dda_poyc_entries", "dda_purchases_entries"].map((t) => DB.q(`SELECT * FROM ${t} ORDER BY id`))), before, "reading changes nothing");
  // a period after a day below zero but put right by a count: nothing in that period
  const st2 = await post("/dda-stocktakes/stocktakes", {});
  await post(`/dda-stocktakes/stocktakes/${st2.stocktake_id}/items`, { item_name: "Morphine", dosage: "10 mg", qty_tablets: 3 });
  const later = (await api("GET", `/dda-register/check?from=${today}&to=${today}`, { token })).json;
  ok(!later.shortfalls.some((x) => x.key === "morphine 10mg"), "counted again: not below zero in that period: " + JSON.stringify(later.shortfalls));
  // another pharmacy sees nothing; staff read it; signed out refused
  DB.db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 1, 'Branch')").run();
  const branch = await app.addUser({ orgId: 1, locationId: 2, email: "branch@example.com", name: "Branch" });
  eq((await api("GET", "/dda-register/check", { token: branch.token })).json.shortfalls.length, 0);
  const staff = await app.addUser({ orgId: 1, locationId: 1, email: "staff@example.com", name: "Staff", role: "staff" });
  eq((await api("GET", "/dda-register/check", { token: staff.token })).status, 200);
  eq((await api("GET", "/dda-register/check")).status, 401);
});

// Cost (Finish round brief: prove rows read per screen open): each new read is one statement on a date index, and the
// rows it visits are the period's warnings (or the period's controlled-drug lines for days=1), never a table scan.
test("dda warnings: cost — one extra indexed statement per ledger / medicines read; the warnings and days reads search by date index", async (app) => {
  const { api, DB } = app;
  const s = await app.bootstrap(), token = s.token;
  for (let i = 0; i < 30; i++) await api("POST", "/dda-sales/entries", { token, body: sale(shift(today, -i), "Morphine 10mg", 1, "C-" + i) });
  await api("POST", "/dda-sales/entries", { token, body: { ...sale(today, "Morphine 10mg", 50, "C-W"), balance_warning: { balance: 20, after: -30, since: today, counted: 0 } } });
  const count = async (p) => { const prep = DB.prepare.bind(DB); let stmts = 0, rows = 0;
    DB.prepare = (sql) => { const st = prep(sql); if (/^\s*(SELECT|WITH)/i.test(sql) && !/sqlite_master|eikon_schema|PRAGMA/i.test(sql) && !/FROM (sessions|users|locations|orgs)\b/i.test(sql)) { stmts++; for (const k of ["first", "all"]) { const f = st[k].bind(st); st[k] = async (...a) => { const r = await f(...a); rows += k === "all" ? (r.results || []).length : r ? 1 : 0; return r; }; } const b = st.bind.bind(st); st.bind = (...a) => { const n = b(...a); for (const k of ["first", "all"]) { const f = n[k].bind(n); n[k] = async (...x) => { const r = await f(...x); rows += k === "all" ? (r.results || []).length : r ? 1 : 0; return r; }; } return n; }; } return st; };
    try { await api("GET", p, { token }); } finally { DB.prepare = prep; } return { stmts, rows }; };
  const led = await count("/dda-register/ledger?term=morphine&to=" + today), med = await count("/dda-register/medicines?to=" + today), w = await count("/dda-register/warnings?to=" + today), d = await count("/dda-register/check?to=" + today);
  console.log(`       ledger ${led.stmts} statements / ${led.rows} rows; medicines ${med.stmts} / ${med.rows}; warnings ${w.stmts} / ${w.rows}; check ${d.stmts} / ${d.rows}`);
  ok(led.stmts <= 6 && med.stmts <= 6 && w.stmts <= 2 && d.stmts <= 9, "bounded statement counts: " + JSON.stringify({ led, med, w, d }));
  const plan = (sql) => DB.q("EXPLAIN QUERY PLAN " + sql).map((x) => x.detail).join(" | ");
  for (const t of ["dda_sales_entries", "dda_poyc_entries", "dda_purchases_entries"]) {
    const p = plan(`SELECT entry_date, quantity FROM ${t} WHERE org_id = 1 AND location_id = 1 AND entry_date >= '2026-01-01' AND entry_date <= '2026-02-01'`);
    ok(/USING (COVERING )?INDEX idx_dda_\w+_org_loc_date/.test(p), t + " check: through its date index: " + p);
  }
  const pw = plan("SELECT medicine AS name, COUNT(*) FROM dda_balance_warnings WHERE org_id = 1 AND location_id = 1 AND entry_date >= '2026-01-01' AND entry_date <= '2026-02-01' GROUP BY medicine");
  ok(/idx_dda_balance_warnings_day/.test(pw), "warned per medicine through its date index: " + pw);
});
