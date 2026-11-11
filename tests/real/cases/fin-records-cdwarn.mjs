// Records (Finish round): a Supplied / POYC line that takes a controlled drug below what the registers show is warned at
// entry in the pharmacist's words, still saves (the register says what really happened), the saved row is the same as
// without the warning, the body is the same plus balance_warning, and the warning is kept and listed on Controlled drugs
// by medicine, the Inspection check and the inspection pack. The locum register is never "In order" on a day with
// controlled drugs and nobody in charge. A pharmacy of its own (other cases write the same registers).
const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const MED = "Oxycodone 10mg tablets";
const RX = { id: "456789M", name: "Grech Paul", addr: "4 Triq il-Wied, Żejtun", doc: "Dr Ruth Galea", reg: "R4401", serial: "CW-RX-1", qty: "40" };
export default {
  title: "Controlled drugs: the over-supply warning",
  async run(t) {
    const today = maltaToday(), db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, "Records Warn Pharmacy").lastInsertRowid);
    const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "cdwarn@demo.mt", role: "admin", name: "Rita Camilleri" });
    const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    await api("POST", "/dda-purchases/entries", { entry_date: today, dda_name_dose: MED, quantity: 28, agent: "Medicare Ltd", invoice_number: "CW-INV-1" });

    const p = await t.page();
    await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token);
    // 1. Supplied: 40 when the registers show 28 — warned under the line, in words, before Save
    await t.open(p, "2", "cdsreg", "cdsreg", "[data-act=add]");
    await p.click("[data-act=add]"); await p.waitForSelector("#cds-add");
    await t.fill(p, "#cds-add", { entry_date: today, client_id_card: RX.id, client_name: RX.name, client_address: RX.addr, doctor_name: RX.doc, doctor_reg_no: RX.reg, prescription_serial_no: RX.serial, '#cds-add [data-i="0"][data-k=medicine_name_dose]': MED, '#cds-add [data-i="0"][data-k=quantity]': RX.qty });
    await p.waitForSelector("#cds-add .cd-balhint.warn", { timeout: 8000 }).catch(() => {});
    const hint = await p.textContent("#cds-add .cd-balhint").catch(() => "");
    t.ok(/^Check: This takes Oxycodone 10mg tablets 12 below what the registers show since .* \(not counted in a stock take yet\) — check the count or a delivery not written in Received\. You can still save it as it really happened\.$/.test(hint), "the warning at entry: " + hint);
    t.ok(await p.locator("#cds-add .cd-balhint.warn").getAttribute("aria-live") === "polite", "announced politely (never an alert)");
    const m = t.maxId("dda_sales_entries");
    const w = await t.write(p, /\/dda-sales\/entries$/, () => p.click("#cds-add button[type=submit]"));
    t.ok(w.status === 200 && w.json && w.json.balance_warning_kept === true, "still saved, the warning kept: " + JSON.stringify(w.json));
    const bw = w.body && w.body.balance_warning;
    t.ok(bw && bw.balance === 28 && bw.after === -12 && bw.counted === 0 && /^\d{4}-\d{2}-\d{2}$/.test(bw.since), "the body carries what was seen: " + JSON.stringify(bw));
    const plainBody = { ...w.body }; delete plainBody.balance_warning;
    t.ok(JSON.stringify(Object.keys(plainBody)) === JSON.stringify(["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no", "urgent"]), "and otherwise the same body as without a warning: " + Object.keys(plainBody).join());
    const warned = (await t.mine("dda_sales_entries", m, { prescription_serial_no: RX.serial, location_id: loc }))[0];
    const twin = await api("POST", "/dda-sales/entries", plainBody); // the same body without the key
    t.same("supplied with the warning vs without", t.row("dda_sales_entries", twin.entry_id), warned);
    db.prepare("DELETE FROM dda_sales_entries WHERE id = ?").run(twin.entry_id); // only the screen's line stays
    const kept = db.prepare("SELECT register, entry_id, medicine, quantity, balance, after, created_name FROM dda_balance_warnings WHERE location_id = ?").all(loc);
    t.ok(kept.length === 1 && kept[0].register === "sales" && kept[0].entry_id === warned.id && kept[0].after === -12 && kept[0].created_name === "Rita Camilleri", "kept with the line and who saved it: " + JSON.stringify(kept));
    const aud = db.prepare("SELECT details_json FROM audit_log WHERE entity_type = 'dda_sales_entries' AND entity_id = ?").get(String(warned.id));
    t.ok(aud && JSON.parse(aud.details_json).balance_warning && JSON.parse(aud.details_json).balance_warning.after === -12, "and in the line's audit entry");

    // 2. POYC typed and saved at once (the warning not on screen yet): shown first, saved on the second press
    await p.evaluate(() => { location.hash = "#poyreg"; }); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "poyreg" && document.querySelector("[data-act=add]")); await t.idle(p);
    await p.click("[data-act=add]"); await p.waitForSelector("#cds-add");
    await p.evaluate((v) => { const f = document.querySelector("#cds-add"), set = (s, x) => { f.querySelector(s).value = x; };
      set("[name=entry_date]", v.today); set("[name=client_id_card]", v.id); set("[name=client_name]", v.name); set("[name=client_address]", v.addr); set("[name=doctor_name]", v.doc); set("[name=doctor_reg_no]", v.reg); set("[name=prescription_serial_no]", "CW-PY-1");
      set('[data-i="0"][data-k=medicine_name_dose]', v.med); set('[data-i="0"][data-k=quantity]', "5"); }, { ...RX, today, med: MED });
    const mp = t.maxId("dda_poyc_entries");
    await p.click("#cds-add button[type=submit]");
    await p.waitForSelector(".cds-dup[role=status]", { timeout: 8000 }).catch(() => {});
    t.ok(/Check the warning under the medicine above/.test(await p.textContent(".cds-dup").catch(() => "")) && /Yes, save it/.test(await p.textContent("#cds-add button[type=submit]")) && t.since("dda_poyc_entries", mp, { location_id: loc }).length === 0, "a warning not seen yet is shown first; nothing saved yet");
    await p.waitForSelector("#cds-add .cd-balhint.warn", { timeout: 8000 }).catch(() => {});
    t.ok(/This takes Oxycodone 10mg tablets 17 below what the registers show/.test(await p.textContent("#cds-add .cd-balhint").catch(() => "")), "and under the line: 17 below (−12 already, 5 more)");
    const w2 = await t.write(p, /\/dda-poyc\/entries$/, () => p.click("#cds-add button[type=submit]"));
    t.ok(w2.body && w2.body.balance_warning && w2.body.balance_warning.balance === -12 && w2.body.balance_warning.after === -17, "POYC saved with what was seen: " + JSON.stringify(w2.body && w2.body.balance_warning));

    // 3. Controlled drugs by medicine lists it, first, and on the medicine its lines
    await p.evaluate(() => { location.hash = "#cdreg"; }); await p.waitForSelector(".cdr-find input"); await t.idle(p);
    const row = await p.textContent(".cdr-med").catch(() => "");
    t.ok(/Oxycodone 10mg tablets/.test(row) && /2 supplies saved below what the registers showed/.test(row), "the list row says it: " + row);
    await p.click(".cdr-med"); await p.waitForSelector(".cdr-sum"); await t.idle(p);
    const notes = (await p.locator(".cdr-note.warn").allTextContents()).join(" | ");
    t.ok(/Check: 2 supplies were saved below what the registers showed\./.test(notes) && /supplied 40 when the registers showed 28 \(12 below\), saved by Rita Camilleri/.test(notes), "the medicine's note lists each: " + notes);
    t.ok(await p.locator(".cdr-tbl tr.chk .flag", { hasText: "below what the registers showed" }).count() === 2, "and marks its two lines");

    // 4. The Inspection check: listed under Controlled drugs; the locum register is not "In order"
    const check = async () => {
      await p.evaluate(() => { location.hash = "#insreg"; }); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "insreg" && document.querySelector(".ins-list"), null, { timeout: 15000 });
      await p.waitForFunction(() => { const s = window.EIKON.inspect.state; return !s.job && s.result; }, null, { timeout: 20000 });
      await p.evaluate(() => { window.__insPrev = window.EIKON.inspect.state.result; });
      await p.click('[data-range="this"]');
      await p.waitForFunction(() => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result !== window.__insPrev && s.result.range.kind === "this"; }, null, { timeout: 20000 });
      return p.evaluate(() => { const o = {}; window.EIKON.inspect.state.result.list.forEach((r) => { o[r.id] = { s: r.status, t: r.reasons.map((x) => x.text).join(" | ") }; }); return o; });
    };
    let R = await check();
    t.ok(R.dda.s === "look" && /Oxycodone 10mg tablets: the registers go below zero on \d+ \w{3} \(lowest −17\): more supplied than received, and no stock take has counted it since .*\. A warning was shown at entry to Rita Camilleri \(2 lines\)\./.test(R.dda.t), "check: the medicine below the registers is listed, with who was warned: " + R.dda.t);
    t.ok(R.locum.s === "missing" && /1 day with controlled drugs supplied or received but no pharmacist in charge/.test(R.locum.t) && /Today is included/.test(R.locum.t), "check: the locum register is not In order: " + JSON.stringify(R.locum));
    t.ok(await p.locator(".ins-reg", { hasText: "Locum register" }).locator(".ins-pill.ok").count() === 0, "and the screen does not say In order for it");
    await api("POST", "/locumregister/entries", { entry_date: today, time_in: "08:00", time_out: "19:00", locum_full_name: "Pharm. Daniela Spiteri", registration_number: "PH 1234" });
    R = await check();
    t.ok(R.locum.s === "ok" && /A pharmacist is recorded for every day with work/.test(R.locum.t), "a pharmacist recorded today: in order: " + JSON.stringify(R.locum));

    // 5. The inspection pack lists it on the supplied and POYC registers and under the stock takes
    const [tab] = await Promise.all([p.context().waitForEvent("page", { timeout: 10000 }), p.click('[data-act="pack"]')]);
    await p.waitForFunction(() => !window.EIKON.inspect.state.pack && window.EIKON.inspack.last, null, { timeout: 30000 });
    await tab.close().catch(() => {});
    const html = await p.evaluate(() => window.EIKON.inspack.last.html), C = await p.evaluate(() => window.EIKON.inspack.last.contents.map((c) => c.id + ":" + c.mark).join());
    t.ok(/ddasales:look/.test(C) && /ddapoyc:look/.test(C), "the pack's contents mark both registers: " + C);
    t.ok(html.includes("Oxycodone 10mg tablets: the registers go below zero on") && html.includes("(lowest −17)"), "the pack lists it");
    // a classic supply (no warning sent) that goes below zero is found from the registers too
    await api("POST", "/dda-purchases/entries", { entry_date: today, dda_name_dose: "Tramadol 50mg capsules", quantity: 10, agent: "Medicare Ltd", invoice_number: "CW-INV-2" });
    await api("POST", "/dda-sales/entries", { entry_date: today, client_name: RX.name, client_id_card: RX.id, client_address: RX.addr, medicine_name_dose: "Tramadol 50mg capsules", quantity: 15, doctor_name: RX.doc, doctor_reg_no: RX.reg, prescription_serial_no: "CW-CL-1" });
    R = await check();
    t.ok(/Tramadol 50mg capsules: the registers go below zero on \d+ \w{3} \(lowest −5\)/.test(R.dda.t) && !/Tramadol[^|]*warning was shown/.test(R.dda.t), "a classic line below zero (no warning) is listed too: " + R.dda.t);
    t.ok(!/<script/i.test(html), "no script in the pack");
  },
};
