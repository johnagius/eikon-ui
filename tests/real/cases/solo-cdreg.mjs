// Named solo-: it adds stock-take lines and register lines the ddstreg/cdpreg/cdsreg cases would take for "the newest row", so it runs last, alone.
// Controlled drugs by medicine (cdreg): the running balance from a stock-take count, the quick buttons opening the
// registers' own forms with the medicine written in (rows byte-identical to the classic screens' for the same input),
// the balance check at entry, the way back, a shortage flagged with its next step, the print, and the reads it makes.
import { ymd } from "../lib.mjs";
const MED = "Tapentadol 50mg tablets", P = { date: ymd(-1), agent: "Ċensu Pharma Ltd", inv: "CDR-INV-1", qty: "20" };
const RX = { date: ymd(-1), id: "456123M", name: "Farrugia Ġużeppi", addr: "9 Triq il-Kbira, Żebbuġ", doc: "Dr Helena Farrugia", reg: "R1310", serial: "CDR-RX-1", qty: "5" };
export default {
  title: "Controlled drugs by medicine",
  async run(t) {
    const p = await t.page(), M = ".eikon-dda-modal ";
    // a count of 40, ten days ago
    const st = (await t.api("POST", "/dda-stocktakes/stocktakes", {})).stocktake_id;
    await t.api("POST", `/dda-stocktakes/stocktakes/${st}/items`, { item_name: "Tapentadol", dosage: "50mg tablets", qty_tablets: 40 });
    const ten = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10) + " 07:00:00";
    t.db.prepare("UPDATE dda_stocktakes SET created_at = ? WHERE id = ?").run(ten, st);
    t.db.prepare("UPDATE dda_stocktake_items SET created_at = ?, updated_at = ? WHERE stocktake_id = ?").run(ten, ten, st);

    // 1. classic: a delivery and a prescription of it
    await t.open(p, "classic", "dda-purchases", "dda-purchases", "button:has-text('New Entry')");
    let m = t.maxId("dda_purchases_entries");
    await p.click("button:has-text('New Entry')"); await p.waitForSelector(M + "input[type=date]");
    await t.fill(p, "", { [M + "input[type=date]"]: P.date, [M + "input[type=number]"]: P.qty, [M + "input[placeholder='DDA name & dose']"]: MED, [M + "input[placeholder='Agent']"]: P.agent, [M + "input[placeholder='Invoice number']"]: P.inv });
    await t.write(p, /\/dda-purchases\/entries$/, () => p.click(M + "button.eikon-dda-btn:has-text('Save')"));
    const classicP = (await t.mine("dda_purchases_entries", m, { invoice_number: P.inv }))[0];
    const q = await t.page(); // the classic sales screen in its own tab
    await t.open(q, "classic", "dda-sales", "dda-sales", "button:has-text('New Entry')");
    m = t.maxId("dda_sales_entries");
    await q.click("button:has-text('New Entry')"); await q.waitForSelector(M + "input[type=date]");
    await t.fill(q, "", { [M + "input[type=date]"]: RX.date, [M + "input[type=number]"]: RX.qty, [M + 'input[placeholder="Client name"]']: RX.name, [M + 'input[placeholder="ID card no."]']: RX.id, [M + 'input[placeholder="Client address"]']: RX.addr,
      [M + 'input[placeholder="Medicine name & dose"]']: MED, [M + 'input[placeholder="Doctor name"]']: RX.doc, [M + 'input[placeholder="Doctor reg no."]']: RX.reg, [M + 'input[placeholder="Prescription serial no."]']: RX.serial });
    await t.write(q, /\/dda-sales\/entries$/, () => q.click(M + "button.eikon-dda-btn:has-text('Save')"));
    const classicS = (await t.mine("dda_sales_entries", m, { prescription_serial_no: RX.serial }))[0];
    const PY = { ...RX, serial: "CDR-PY-1", qty: "3" };
    const w = await t.page(); // classic POYC in a third tab
    await t.open(w, "classic", "dda-poyc", "dda-poyc", "button:has-text('New Entry')");
    m = t.maxId("dda_poyc_entries");
    await w.click("button:has-text('New Entry')"); await w.waitForSelector(M + "input[type=date]");
    await t.fill(w, "", { [M + "input[type=date]"]: PY.date, [M + "input[type=number]"]: PY.qty, [M + 'input[placeholder="Client name"]']: PY.name, [M + 'input[placeholder="ID card"]']: PY.id, [M + 'input[placeholder="Address"]']: PY.addr,
      [M + 'input[placeholder="e.g. Diazepam 5mg"]']: MED, [M + 'input[placeholder="Doctor name"]']: PY.doc, [M + 'input[placeholder="Registration no."]']: PY.reg, [M + 'input[placeholder="Serial no."]']: PY.serial });
    await t.write(w, /\/dda-poyc\/entries$/, () => w.click(M + "button.eikon-dda-btn:has-text('Save')"));
    const classicY = (await t.mine("dda_poyc_entries", m, { prescription_serial_no: PY.serial }))[0];
    // a spelling of another strength that the server's word search also finds: never in the balance unless ticked
    await t.api("POST", "/dda-purchases/entries", { entry_date: ymd(-2), dda_name_dose: "Tapentadol 100mg tablets", quantity: 500, agent: "Other", invoice_number: "CDR-OTHER" });

    // C9 (round 2): supplied, never received or counted
    for (const [d, q2, ser] of [[-4, 2, "C9-1"], [-2, 1, "C9-2"]]) await t.api("POST", "/dda-sales/entries", { entry_date: ymd(d), client_name: RX.name, client_id_card: RX.id, client_address: RX.addr, medicine_name_dose: "Buprenorphine 8mg tablets", quantity: q2, doctor_name: RX.doc, doctor_reg_no: RX.reg, prescription_serial_no: ser });
    // 2. the new screen: find it (part of the name), its balance, and only the two bounded reads
    const reads = []; p.on("request", (r) => { if (["fetch", "xhr"].includes(r.resourceType()) && /\/dda-/.test(r.url())) reads.push(new URL(r.url()).pathname); });
    await t.open(p, "2", "cdreg", "cdreg", ".cdr-find input");
    t.ok(reads.length && reads.every((x) => x === "/dda-register/medicines"), "opening the list reads only the medicines list: " + reads.join(", "));
    await p.fill(".cdr-find input", "tapentadol 50"); await p.waitForSelector(".cdr-med");
    t.ok((await p.locator(".cdr-med").count()) === 1 && /Tapentadol 50mg tablets/.test(await p.textContent(".cdr-med")), "the search finds the medicine");
    // C9: the list row says it from the list already read (no extra read), and so does the medicine's banner
    await p.fill(".cdr-find input", "bupren"); await p.waitForSelector(".cdr-med.over");
    t.ok(/Check: 3 more supplied than received — count it now/.test(await p.textContent(".cdr-med.over")), "C9 list row: " + await p.textContent(".cdr-med"));
    t.ok(reads.every((x) => x === "/dda-register/medicines"), "C9 costs no read: " + reads.join(", "));
    await p.click(".cdr-med.over"); await p.waitForSelector(".cdr-sum"); await t.idle(p);
    const c9 = await p.textContent(".cdr-note.warn");
    t.ok(/^Buprenorphine 8mg tablets: 3 more supplied than received — count it now\./.test(c9) && await p.locator(".cdr-note.warn").first().getAttribute("role") === "status" && await p.locator(".cdr-note").count() === 1, "C9 banner, amber, one note: " + c9);
    await p.click("[data-act=list]"); await p.waitForSelector(".cdr-find input");
    await p.fill(".cdr-find input", "tapentadol 50"); await p.waitForSelector(".cdr-med");
    t.ok(!(await p.locator(".cdr-med.over").count()), "a counted medicine has no C9 flag");
    reads.length = 0;
    await p.keyboard.press("Enter"); await p.waitForSelector(".cdr-sum [data-bal]"); await t.idle(p);
    t.ok(reads.join() === "/dda-register/ledger", "opening a medicine is one read: " + reads.join(", "));
    const bal = async () => (await p.textContent(".cdr-sum [data-bal]")).trim();
    t.ok(await bal() === "52", "balance: counted 40, +20 received, -5 supplied, -3 POYC; the 100mg line not in it: " + await p.textContent(".cdr-sum"));
    t.ok(/Tapentadol 100mg tablets · 1 line/.test(await p.textContent(".cdr-vars")) && !(await p.isChecked("[data-inc]")), "the other strength is shown under Also found, not ticked");
    await p.check("[data-inc]"); await p.waitForFunction(() => document.querySelector(".cdr-sum [data-bal]").textContent.trim() === "552", null, { timeout: 3000 }).catch(() => {});
    t.ok(await bal() === "552", "ticked, its lines join the balance (and are marked with their spelling)");
    await p.uncheck("[data-inc]"); await p.waitForFunction(() => document.querySelector(".cdr-sum [data-bal]").textContent.trim() === "52", null, { timeout: 3000 }).catch(() => {});
    t.ok(await bal() === "52", "unticked, they leave it");
    t.ok(/Counted 40 on/.test(await p.textContent(".cdr-sum")), "and how it was reached");

    // 3. Received: the register's own form, the medicine written in, the balance check, back here after Save
    await p.click("[data-go=cdpreg]");
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "cdpreg" && document.querySelector("#cdp-add"));
    t.ok(await p.inputValue('#cdp-add [data-i="0"][data-k=dda_name_dose]') === MED, "Received opens the delivery form with the medicine in its first line");
    m = t.maxId("dda_purchases_entries");
    await t.fill(p, "#cdp-add", { entry_date: P.date, agent: P.agent, invoice_number: P.inv, '#cdp-add [data-i="0"][data-k=quantity]': P.qty });
    await p.waitForFunction(() => /after this delivery: 72/.test((document.querySelector("#cdp-add .cd-balhint") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    t.ok(/In the register: 52 · after this delivery: 72/.test(await p.textContent("#cdp-add .cd-balhint").catch(() => "")), "the balance check at entry: " + await p.textContent("#cdp-add .cd-balhint").catch(() => "(none)"));
    await t.write(p, /\/dda-purchases\/entries$/, () => p.click("#cdp-add button[type=submit]"));
    const freshP = (await t.mine("dda_purchases_entries", m, { invoice_number: P.inv }))[0];
    t.has("received(cdreg)", freshP, { entry_date: P.date, dda_name_dose: MED, quantity: 20, agent: P.agent, invoice_number: P.inv });
    t.same("received via the running register", classicP, freshP);
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "cdreg" && document.querySelector(".cdr-sum [data-bal]"), null, { timeout: 10000 });
    await p.waitForFunction(() => document.querySelector(".cdr-sum [data-bal]").textContent.trim() === "72", null, { timeout: 5000 }).catch(() => {});
    t.ok(await bal() === "72", "back on the running register after Save, the delivery counted: " + await bal());

    // 4. Supplied: the prescription form, a supply that would go below zero is said plainly; then the real one
    await p.click("[data-go=cdsreg]");
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && document.querySelector("#cds-add"));
    t.ok(await p.inputValue('#cds-add [data-i="0"][data-k=medicine_name_dose]') === MED, "Supplied opens the prescription form with the medicine in its first line");
    await p.fill('#cds-add [data-i="0"][data-k=quantity]', "90");
    await p.waitForFunction(() => /below zero/.test((document.querySelector("#cds-add .cd-balhint") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    const hint = await p.textContent("#cds-add .cd-balhint").catch(() => "");
    t.ok(/after this line: -18\. Check: that is below zero\./.test(hint) && await p.locator("#cds-add .cd-balhint").evaluate((e) => getComputedStyle(e).color === getComputedStyle(e.closest("form").querySelector(".hd") || e).color), "more than the registers give: said quietly, in muted words: " + hint);
    m = t.maxId("dda_sales_entries");
    await t.fill(p, "#cds-add", { entry_date: RX.date, client_id_card: RX.id, client_name: RX.name, client_address: RX.addr, doctor_name: RX.doc, doctor_reg_no: RX.reg, prescription_serial_no: RX.serial, '#cds-add [data-i="0"][data-k=quantity]': RX.qty });
    await p.click("#cds-add button[type=submit]"); await p.waitForSelector(".cds-dup"); // the classic line has the same serial: second press
    await t.write(p, /\/dda-sales\/entries$/, () => p.click("#cds-add button[type=submit]"));
    const freshS = (await t.mine("dda_sales_entries", m, { prescription_serial_no: RX.serial }))[0];
    t.has("supplied(cdreg)", freshS, { entry_date: RX.date, client_id_card: "0456123M", client_name: RX.name, medicine_name_dose: MED, quantity: 5, doctor_name: RX.doc, prescription_serial_no: RX.serial, urgent: 0 });
    t.same("supplied via the running register", classicS, freshS);
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "cdreg" && document.querySelector(".cdr-sum [data-bal]"), null, { timeout: 10000 });
    await p.waitForFunction(() => document.querySelector(".cdr-sum [data-bal]").textContent.trim() === "67", null, { timeout: 5000 }).catch(() => {});
    t.ok(await bal() === "67", "back on the running register after Save: " + await bal());

    // 4b. POYC the same way
    await p.click("[data-go=poyreg]");
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "poyreg" && document.querySelector("#cds-add"));
    t.ok(await p.inputValue('#cds-add [data-i="0"][data-k=medicine_name_dose]') === MED, "POYC opens the prescription form with the medicine in its first line");
    m = t.maxId("dda_poyc_entries");
    await t.fill(p, "#cds-add", { entry_date: PY.date, client_id_card: PY.id, client_name: PY.name, client_address: PY.addr, doctor_name: PY.doc, doctor_reg_no: PY.reg, prescription_serial_no: PY.serial, '#cds-add [data-i="0"][data-k=quantity]': PY.qty });
    await p.click("#cds-add button[type=submit]"); await p.waitForSelector(".cds-dup");
    await t.write(p, /\/dda-poyc\/entries$/, () => p.click("#cds-add button[type=submit]"));
    const freshY = (await t.mine("dda_poyc_entries", m, { prescription_serial_no: PY.serial }))[0];
    t.same("POYC via the running register", classicY, freshY);
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "cdreg" && document.querySelector(".cdr-sum [data-bal]"), null, { timeout: 10000 });
    await p.waitForFunction(() => document.querySelector(".cdr-sum [data-bal]").textContent.trim() === "64", null, { timeout: 5000 }).catch(() => {});
    t.ok(await bal() === "64", "back after the POYC save: " + await bal());

    // 5. a count two short: flagged with what to do next, and the line marked
    const st2 = (await t.api("POST", "/dda-stocktakes/stocktakes", {})).stocktake_id;
    await t.api("POST", `/dda-stocktakes/stocktakes/${st2}/items`, { item_name: "Tapentadol", dosage: "50mg tablets", qty_tablets: 62 });
    const written2 = ["dda_purchases_entries", "dda_sales_entries", "dda_poyc_entries", "dda_stocktake_items"].map((x) => t.maxId(x)).join();
    await p.evaluate(() => { location.hash = "#today"; }); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "today");
    await p.evaluate(() => { location.hash = "#cdreg"; }); await p.waitForSelector(".cdr-sum [data-bal]"); await t.idle(p);
    t.ok(await bal() === "62", "the new count is the balance");
    const note = await p.textContent(".cdr-note.warn").catch(() => "");
    t.ok(/Check: counted 62 on .*, the registers give 64 \(2 fewer\)\./.test(note) && /Count it again/.test(note) && /same units \(tablets\)/.test(note), "the difference is an amber Check with the next step and the units sentence: " + note);
    t.ok(await p.locator(".cdr-note[role=alert], .cdr-note.bad").count() === 0, "never red, never an alert");
    t.ok(await p.locator(".cdr-tbl tr.cnt.chk").count() === 1, "and the count's line is marked Check");

    // 6. print: a working sheet for the one medicine (the monthly registers' prints are unchanged)
    await p.click(".cdr-lab2 [data-act=print]");
    const html = await p.evaluate(() => (window.EIKON.months.lastPrint || {}).html || "");
    t.ok(/Controlled drugs by medicine — taken from the registers/.test(html) && /Tapentadol 50mg tablets/.test(html) && /CDR-RX-1/.test(html) && /Page /.test(html), "the print lists the medicine's lines as written");
    t.ok(!/fewer|short|Balance|registers give|Check/.test(html.replace(/<style[\s\S]*?<\/style>/, "")), "and no balance or difference in the print");

    t.ok(["dda_purchases_entries", "dda_sales_entries", "dda_poyc_entries", "dda_stocktake_items"].map((x) => t.maxId(x)).join() === written2, "opening, ticking and printing wrote nothing");
    // 7. this month by medicine on Received (from the month already loaded), one tap to its running register
    await p.evaluate((ym) => { window.EIKON.months.openAt("cdpreg", ym); location.hash = "#cdpreg"; }, P.date.slice(0, 7));
    await p.waitForSelector('.cd-msum [data-cdmed="' + MED + '"]'); await t.idle(p);
    t.ok(/40 received/.test(await p.textContent('.cd-msum [data-cdmed="' + MED + '"]')), "Received shows this month by medicine: " + await p.textContent(".cd-msum"));
    await p.click('.cd-msum [data-cdmed="' + MED + '"]');
    await p.waitForFunction((m) => window.EIKON.state.activeModuleId === "cdreg" && document.querySelector(".cdr h1") && document.querySelector(".cdr h1").textContent === m, MED, { timeout: 8000 }).catch(() => {});
    t.ok(await p.textContent(".cdr h1") === MED, "a tap opens that medicine's running register");

    // 8. the open stock take lists what was received or supplied and is not counted yet; a tap fills Add an item only
    // (other cases close stock takes today: "since the stock take before" may be today, so the 100mg also comes in today)
    await t.api("POST", "/dda-purchases/entries", { entry_date: ymd(0), dda_name_dose: "Tapentadol 100mg tablets", quantity: 1, agent: "Other", invoice_number: "CDR-OTHER-2" });
    const written3 = ["dda_purchases_entries", "dda_sales_entries", "dda_poyc_entries", "dda_stocktake_items"].map((x) => t.maxId(x)).join();
    await p.evaluate(() => { location.hash = "#ddstreg"; }); await p.waitForSelector(".dst-st"); await t.idle(p);
    await p.click(".dst-st"); await p.waitForSelector("#dst-add"); await p.waitForSelector("[data-ny]", { timeout: 8000 }).catch(() => {});
    const ny = await p.locator("[data-ny]").allTextContents();
    t.ok(ny.includes("Tapentadol 100mg tablets") && !ny.includes("Tapentadol 50mg tablets"), "Not counted yet: the 100mg (received, no line) is there, the 50mg (counted) is not: " + ny.slice(0, 6).join(" | "));
    await p.click('[data-ny]:has-text("Tapentadol 100mg tablets")');
    t.ok(await p.inputValue("#dst-add [name=item_name]") === "Tapentadol" && await p.inputValue("#dst-add [name=dosage]") === "100mg tablets" && await p.evaluate(() => document.activeElement && document.activeElement.name) === "qty_tablets", "a tap fills the name and dosage and puts the cursor in Tablets: " + JSON.stringify([await p.inputValue("#dst-add [name=item_name]"), await p.inputValue("#dst-add [name=dosage]"), await p.evaluate(() => document.activeElement && (document.activeElement.name || document.activeElement.className))]));
    t.ok(["dda_purchases_entries", "dda_sales_entries", "dda_poyc_entries", "dda_stocktake_items"].map((x) => t.maxId(x)).join() === written3, "and nothing was added until Add item");
  },
};
