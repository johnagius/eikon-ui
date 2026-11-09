// The inspection pack (ui/eikon.inspack.js, from the Inspection check). A pharmacy of its own, seeded through the real
// worker for the last two months with every register an inspector asks for, known gaps included. One tap on "Print
// inspection pack" must open one tab with: a cover (pharmacy, address and phone, the pharmacist in charge), contents with
// ✓ or the gap for every register, each register's pages exactly as its own screen prints them (byte for byte: the
// controlled-drug registers' legal wording is theirs), every missed day listed, the stock take as the worker prints it,
// and a sign-off page. No script in it (CSP), every path read once, nothing written. "Since last inspection" works.
const pad = (n) => (n < 10 ? "0" : "") + n;
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const add = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const shiftYm = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); };
const lastDay = (ym) => ym + "-" + pad(new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5), 0)).getUTCDate());
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const dayText = (s) => Number(s.slice(8)) + " " + SHORT[+s.slice(5, 7) - 1];

export default {
  title: "Inspection pack",
  async run(t) {
    const today = maltaToday(), L = shiftYm(today.slice(0, 7), -1), M2 = shiftYm(L, -1), from = M2 + "-01", to = lastDay(L);
    const days = []; for (let d = from; d <= to; d = add(d, 1)) days.push(d);
    const MISS = [M2 + "-03", L + "-05", L + "-09", L + "-21"], NOPHARM = [L + "-15"];

    // ---- a pharmacy of its own
    const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, "Spiżerija Pack Pharmacy").lastInsertRowid);
    const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "inspack@demo.mt", role: "admin", name: "Rita Camilleri" });
    const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };

    const devs = (await api("GET", "/temperature/devices")).devices;
    db.prepare("UPDATE temperature_devices SET created_at = ? WHERE location_id = ?").run(add(from, -30) + " 08:00:00", loc);
    for (const d of days) for (const dv of devs) {
      const fridge = dv.device_type === "fridge";
      if (fridge && MISS.includes(d)) continue;
      await api("POST", "/temperature/entries", { device_id: dv.id, entry_date: d, min_temp: fridge ? 3 : 19, max_temp: fridge ? (d === L + "-12" ? 9.5 : 6) : 22, notes: "" });
    }
    for (const d of days) if (new Date(d + "T12:00:00Z").getUTCDay() === 3) await api("POST", "/cleaning/entries", { entry_date: d, time_in: "08:00", time_out: "08:40", cleaner_name: "Karl Ħili", staff_name: "Rita", notes: "" });
    for (const d of days) if (!NOPHARM.includes(d)) await api("POST", "/locumregister/entries", { entry_date: d, time_in: "08:00", time_out: "19:00", locum_full_name: d < L + "-10" ? "Pharm. Daniela Spiteri" : "Pharm. Ġorġ Żammit", registration_number: d < L + "-10" ? "PH 1234" : "PH 2001" });
    for (const d of days.filter((x, i) => i % 4 === 0)) await api("POST", "/daily-register/entries", { entry_date: d, client_name: "Borg John", client_id: "123456M", medicine_name_dose: "Amoxil 500mg", posology: "1 tds", prescriber_name: "Dr Abela", prescriber_reg_no: "4321" });
    for (const ym of [M2, L]) {
      await api("POST", "/dda-purchases/entries", { entry_date: ym + "-04", dda_name_dose: "Morphine 10mg/ml amp", quantity: 10, agent: "Medicare Ltd", invoice_number: "INV-" + ym });
      await api("POST", "/dda-sales/entries", { entry_date: ym + "-11", client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja, Ħamrun", medicine_name_dose: "Morphine 10mg/ml", quantity: 2, doctor_name: "Dr Abela", doctor_reg_no: "R1201", prescription_serial_no: "S" + ym.replace("-", ""), urgent: ym === L });
      await api("POST", "/dda-poyc/entries", { entry_date: ym + "-13", client_name: "Vella Rosa", client_id_card: "0099887M", client_address: "5 Triq San Pawl, Rabat", medicine_name_dose: "Methylphenidate 10mg", quantity: 30, doctor_name: "Dr Galea", doctor_reg_no: "R1202", prescription_serial_no: "P" + ym.replace("-", "") });
      await api("POST", "/repeat-prescriptions/entries", { entry_date: ym + "-08", expires_date: "", client_name: "Caruana Ines", client_id: "0753197M", medicine_name_dose: "Losartan 50mg", posology: "1 daily", prescriber_name: "Dr Abela", prescriber_reg_no: "4321" });
    }
    // one stock take, for last month (on its 20th), with two lines; the month before has lines and no stock take (a gap)
    await api("POST", "/dda-stocktakes/stocktakes", {});
    const sid = db.prepare("SELECT MAX(id) AS m FROM dda_stocktakes WHERE location_id = ?").get(loc).m;
    await api("POST", "/dda-stocktakes/stocktakes/" + sid + "/items", { item_name: "Morphine 10mg/ml amp", dosage: "10mg/ml", qty_tablets: 8 });
    await api("POST", "/dda-stocktakes/stocktakes/" + sid + "/items", { item_name: "Methylphenidate", dosage: "10mg", qty_tablets: 120 });
    db.prepare("UPDATE dda_stocktakes SET created_at = ?, closed_at = ? WHERE id = ?").run(L + "-20 09:00:00", L + "-20 10:00:00", sid);
    for (const c of (await api("GET", "/certificates/items")).items) await api("PUT", "/certificates/items/" + c.id, { last_date: add(today, -40), interval_months: c.interval_months, certified_person: c.requires_person ? "Rita Camilleri" : undefined });
    await api("GET", "/bookings/settings"); // makes the table
    db.prepare("INSERT INTO bk_settings (org_id, location_id, provider, address, phone) VALUES (?, ?, 'off', ?, ?)").run(org, loc, "12 Triq il-Merkanti, Il-Belt Valletta", "2122 3344");

    // ---- the screen, from this pharmacy's own sign-in
    const p = await t.page();
    await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token);
    const reqs = []; p.on("request", (r) => { const x = new URL(r.url()); if (x.port === new URL(t.base).port && !x.pathname.startsWith("/ui/") && r.method() === "GET") reqs.push(x.pathname + x.search); });
    const writes = []; p.on("request", (r) => { const x = new URL(r.url()); if (x.port === new URL(t.base).port && !x.pathname.startsWith("/ui/") && r.method() !== "GET" && !/client-log/.test(x.pathname)) writes.push(r.method() + " " + x.pathname); });
    await t.open(p, "2", "insreg", "insreg", ".ins-list");
    await p.waitForFunction(() => !window.EIKON.inspect.state.job && window.EIKON.inspect.state.result, null, { timeout: 20000 });
    t.ok(await p.locator('[data-act="pack"]').isVisible(), "Print inspection pack is on the screen");
    t.ok(await p.evaluate(() => { const a = document.querySelector('[data-act="pack"]'), l = document.querySelector(".ins-list"); return a && l && (a.compareDocumentPosition(l) & Node.DOCUMENT_POSITION_FOLLOWING) > 0; }), "the pack button comes before the results (the job of the page first)");
    await p.click('[data-range="custom"]'); await p.fill("#ins-from", from); await p.fill("#ins-to", to);
    await p.click('[data-act="check"]');
    await p.waitForFunction((r) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === r[0]; }, [from, to], { timeout: 20000 });
    reqs.length = 0; writes.length = 0;

    // ---- one tap: the tab opens at once, the pack is written into it
    const DB = t.stack.app.DB, prep0 = DB.prepare.bind(DB); let rowsRead = 0, stmts = 0;
    DB.prepare = (sql) => { const s = prep0(sql); const wrap = (st) => { const b = st.bind.bind(st); st.bind = (...a) => { const n = b(...a); if (a.includes(loc)) { stmts++; for (const k of ["first", "all", "raw"]) { const f = n[k].bind(n); n[k] = async (...x) => { const r = await f(...x); rowsRead += r == null ? 0 : Array.isArray(r) ? r.length : Array.isArray(r.results) ? r.results.length : 1; return r; }; } } return n; }; return st; }; return wrap(s); };
    const t0 = Date.now();
    const [tab] = await Promise.all([p.context().waitForEvent("page", { timeout: 10000 }), p.click('[data-act="pack"]')]);
    await p.waitForFunction(() => !window.EIKON.inspect.state.pack && window.EIKON.inspack.last, null, { timeout: 30000 });
    const ms = Date.now() - t0; DB.prepare = prep0;
    await tab.waitForFunction(() => document.title.indexOf("Inspection pack") === 0, null, { timeout: 10000 });
    const html = await p.evaluate(() => window.EIKON.inspack.last.html), paths = await p.evaluate(() => window.EIKON.inspack.last.paths);
    const tabHtml = await tab.content();
    if (process.env.INSPACK_OUT) { // screenshots for the review: the pack as printed (PDF) and as the tab shows it
      const fs = await import("node:fs"); fs.mkdirSync(process.env.INSPACK_OUT, { recursive: true });
      fs.writeFileSync(process.env.INSPACK_OUT + "/pack.html", html);
      await tab.emulateMedia({ media: "print" }); await tab.pdf({ path: process.env.INSPACK_OUT + "/after-pack.pdf", preferCSSPageSize: true, printBackground: true });
      await tab.emulateMedia({ media: "screen" }); await tab.setViewportSize({ width: 1280, height: 900 }); await tab.screenshot({ path: process.env.INSPACK_OUT + "/after-pack-tab.png" });
      await p.screenshot({ path: process.env.INSPACK_OUT + "/after-insreg-done-dk-light.png", fullPage: true });
    }
    t.note(`pack: ${reqs.length} requests (${paths.length} reads after the check's cache), ${stmts} statements, ${rowsRead} rows returned for this pharmacy, ${ms} ms, ${html.length} bytes`);
    t.ok(tabHtml.includes("Pharmacists in charge in these days") && tabHtml.includes("Sign-off"), "the tab shows the pack");
    t.ok(!/<script/i.test(html) && !/\son[a-z]+\s*=/i.test(html), "no script and no inline handler in the pack (CSP)");
    t.ok(new Set(paths).size === paths.length, "every path read once: " + paths.filter((x, i) => paths.indexOf(x) !== i).join(" "));
    t.ok(reqs.length <= await p.evaluate((r) => window.EIKON.inspack.estimate(r), { from, to }) && reqs.every((q) => !/\/entries$/.test(q)), "bounded: a month per request, " + reqs.length + " requests");
    t.ok(!writes.length, "making the pack writes nothing: " + writes.join(" "));
    t.ok(await p.locator(".ins-done").isVisible() && /opened in a new tab/.test(await p.textContent(".ins-done")), "the screen says the pack opened");

    // cover
    t.ok(html.includes("Spiżerija Pack Pharmacy") && html.includes("12 Triq il-Merkanti, Il-Belt Valletta") && html.includes("2122 3344"), "cover: the pharmacy, its address and phone");
    t.ok(html.includes("<td>Pharm. Daniela Spiteri</td><td>PH 1234</td>") && html.includes("<td>Pharm. Ġorġ Żammit</td><td>PH 2001</td>"), "cover: every pharmacist in charge in these days");
    t.ok(html.includes("by Rita Camilleri"), "cover: who prepared it");
    // contents: every register with ✓ or the gap
    const C = await p.evaluate(() => window.EIKON.inspack.last.contents.map((c) => c.id + ":" + c.mark).join());
    const cdShared = await p.evaluate(() => ["cdpreg", "cdsreg", "poyreg"].map((k) => !!(window.EIKON.printDocs && window.EIKON.printDocs[k])));
    const cdMark = (i) => cdShared[i] ? "ok" : "elsewhere";
    t.ok(C === `temperature:gap,cleaning:ok,dailyregister:ok,locum:look,ddapurchases:${cdMark(0)},ddasales:${cdMark(1)},ddapoyc:${cdMark(2)},stocktakes:look,repeat:ok,certificates:ok`, "contents marks: " + C);
    t.ok(/<td class='pk-m gap'>Missing<\/td>/.test(html) && /<td class='pk-m ok'>✓ In order<\/td>/.test(html) && /<td class='pk-m look'>Look at this<\/td>/.test(html) && html.includes("<td>Sign-off</td>"), "contents uses the screen's words: ✓ In order, Missing, Look at this; and the sign-off");
    t.ok(!/text-transform:uppercase/.test(html) && html.includes("<dt>Responsible pharmacist</dt><dd><span class=\"pk-blank\"></span>"), "cover: no capitals; the responsible pharmacist is a line to fill, not a guess");
    // gaps listed in full (the screen stops at five days; the pack lists every one)
    t.ok(html.includes("Pharmacy Fridge: 4 days without a reading: " + MISS.map(dayText).slice(0, 3).join(", ") + " and " + dayText(MISS[3]) + "."), "every missed fridge day is listed: " + (html.match(/Pharmacy Fridge: [^<]*/) || [""])[0]);
    t.ok(html.includes("1 day with work recorded but no pharmacist in charge in the locum register: " + dayText(NOPHARM[0]) + "."), "the day without a pharmacist is listed");
    t.ok(html.includes("controlled drugs were supplied or received") && html.includes("no stock-take was taken in the month"), "the month without a stock take is listed");
    // the stock take as the worker prints it, without its screen-only button
    t.ok(html.includes("DDA Stock Take") && html.includes("<td>Methylphenidate</td><td>10mg</td><td>120</td>") && !html.includes("window.print"), "the stock take is the worker's own printout, without its Print button");
    t.ok(html.includes("<small>Inspector</small>") || html.includes("<h2>Inspector</h2>"), "sign-off for the inspector");

    // ---- each register's pages are byte-identical to what its own screen prints for the same month
    const screens = [["cdsreg", "dda-sales"], ["poyreg", "dda-poyc"], ["cdpreg", "dda-purchases"], ["tempreg", "temperature"], ["cleanreg", "cleaning"], ["drreg", "dailyregister"], ["locreg", "locumregister"], ["repreg", "repeatprescriptions"]];
    for (const [id] of screens) {
      const shared = await p.evaluate((k) => !!(window.EIKON.printDocs && window.EIKON.printDocs[k]) || !!window.EIKON.inspack.DOCS[k], id);
      if (!shared) { // a controlled-drug register whose screen does not share its printout yet: never copied, a placeholder instead
        const title = { cdsreg: "Controlled drugs supplied", poyreg: "POYC controlled drugs", cdpreg: "Controlled drugs received" }[id];
        t.ok(html.includes("Not in this pack: print " + title + " from its own screen"), id + ": the pack says to print it from its screen (no copy of its legal wording)");
        t.ok(html.includes("<td>Print it from its own screen (" + title + " › Print), month by month, and put it here.</td>"), id + ": the contents says where its pages come from");
        continue;
      }
      await p.evaluate((h) => { window.location.hash = "#" + h; }, id);
      await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, id, { timeout: 15000 });
      await p.waitForSelector('[data-mb="prev"]', { timeout: 15000 }); await t.idle(p);
      await p.click('[data-mb="prev"]'); await t.idle(p);
      await p.waitForFunction((ym) => document.querySelector(".emb-lab") && document.querySelector(".emb-lab").textContent.indexOf(ym) >= 0, (["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"])[+L.slice(5) - 1], { timeout: 10000 });
      await t.idle(p);
      const [pop] = await Promise.all([p.context().waitForEvent("page", { timeout: 10000 }).catch(() => null), p.click('[data-mb="print"]')]);
      if (pop) await pop.close().catch(() => {});
      const body = await p.evaluate(() => window.EIKON.inspack.bodyOf(window.EIKON.months.lastPrint.html));
      t.ok(body.length > 200 && html.includes(body), id + ": the pack's page for " + L + " is the screen's own print, byte for byte" + (html.includes(body) ? "" : " · screen: " + body.slice(0, 300)));
    }
    // certificates (printed as of today)
    await p.evaluate(() => { window.location.hash = "#certreg"; });
    await p.waitForSelector('[data-act="print"]', { timeout: 15000 }); await t.idle(p);
    { const [pop] = await Promise.all([p.context().waitForEvent("page", { timeout: 10000 }).catch(() => null), p.click('[data-act="print"]')]); if (pop) await pop.close().catch(() => {}); }
    const cb = await p.evaluate(() => window.EIKON.inspack.bodyOf(window.EIKON.months.lastPrint.html));
    t.ok(cb.length > 200 && html.includes(cb), "certificates: the pack's page is the screen's own print");
    t.ok(cdShared.every(Boolean) ? html.includes("DDA Sales Report") && html.includes(">URGENT<") : !html.includes("DDA Sales Report") && !html.includes("DDA POYC Report") && !html.includes("DDA Purchases Report"), "controlled-drug wording only from the screens' own builders, never a copy");
    const c2 = await p.evaluate((l) => localStorage.getItem("eikon_ins_last:" + l), String(loc));
    t.ok(c2 && JSON.parse(c2).from === from && /to put right before an inspector comes/.test(JSON.parse(c2).text), "C2: the last check is kept for the Registers hub: " + c2);

    // ---- since last inspection: the day is remembered in this browser and the check runs from it
    const since = add(today, -20);
    await t.open(p, "2", "insreg", "insreg", ".ins-acts");
    await p.waitForFunction(() => !window.EIKON.inspect.state.job, null, { timeout: 20000 });
    await p.click('[data-range="since"]');
    await p.fill("#ins-since", since); await p.press("#ins-since", "Enter");
    await p.waitForFunction((d) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === d; }, since, { timeout: 20000 });
    t.ok(/Since the last inspection/.test(await p.textContent(".ins-days")), "the days say since the last inspection: " + await p.textContent(".ins-days"));
    const kept = await p.evaluate((l) => localStorage.getItem("eikon_inspack_last:" + l), String(loc));
    t.ok(kept === since, "the day is kept in this browser, for this pharmacy: " + kept);
    await t.open(p, "2", "insreg", "insreg", ".ins-acts");
    await p.click('[data-range="since"]');
    await p.waitForFunction((d) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === d; }, since, { timeout: 20000 });
    t.ok(true, "opening again, Since last inspection checks from the kept day at once");
    // Check again on This month: past months stay read for the session; only what can change today is read again
    await p.click('[data-range="this"]'); await p.waitForFunction(() => !window.EIKON.inspect.state.job && window.EIKON.inspect.state.result, null, { timeout: 20000 });
    reqs.length = 0; await p.click('[data-act="again"]'); await p.waitForFunction(() => !window.EIKON.inspect.state.job && window.EIKON.inspect.state.result, null, { timeout: 20000 });
    t.note("Check again, this month: " + reqs.length + " requests: " + reqs.join(" "));
    t.ok(reqs.length <= 7 && reqs.every((q) => !q.includes("month=" + L)), "Check again reads only this month and the lists that change today: " + reqs.join(" "));
    // staff: anyone signed in may print the pack (owner, 9 Nov)
    const st = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "inspack-staff@demo.mt", role: "staff", name: "Karl Vella" });
    const sp = await t.page(); await sp.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, st.token);
    await t.open(sp, "2", "insreg", "insreg", ".ins-acts");
    t.ok((await sp.locator('[data-act="pack"]').count()) === 1 && !(await sp.locator(".ins-who").count()) && !/only the pharmacist in charge/.test(await sp.textContent(".ins")), "a staff account has the Print inspection pack button and no restriction note");
    // ---- round 2: the day of the last inspection is the pharmacy's, kept on the server; another device (the staff's
    // browser, empty storage) gets it; the screen keeps working in the browser when the route is missing
    const row = db.prepare("SELECT last_date, set_name FROM register_last_inspection WHERE org_id = ? AND location_id = ?").get(org, loc);
    t.ok(row && row.last_date === since && row.set_name === "Rita Camilleri", "the day is stored on the server for this pharmacy: " + JSON.stringify(row));
    await sp.click('[data-range="since"]');
    await sp.waitForFunction((d) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === d; }, since, { timeout: 20000 });
    t.ok(/kept by Rita Camilleri/.test(await sp.textContent(".ins-days")), "another device checks from the pharmacy's day, and says who kept it: " + await sp.textContent(".ins-days"));
    const keepToday = await sp.locator('[data-act="mark"]').count(); // only after a pack; set it through the date field instead
    await sp.click('[data-act="edit-since"]'); await sp.fill("#ins-since", add(today, -3)); await sp.press("#ins-since", "Enter");
    await sp.waitForFunction((d) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === d; }, add(today, -3), { timeout: 20000 });
    for (let i = 0; i < 40 && db.prepare("SELECT last_date FROM register_last_inspection WHERE location_id = ?").get(loc).last_date !== add(today, -3); i++) await sp.waitForTimeout(100);
    t.ok(db.prepare("SELECT last_date, set_name FROM register_last_inspection WHERE location_id = ?").get(loc).last_date === add(today, -3), "staff change it for the whole pharmacy" + (keepToday ? "" : ""));
    const other = db.prepare("SELECT COUNT(*) AS c FROM register_last_inspection WHERE location_id <> ?").get(loc).c;
    t.ok(other === 0 || !db.prepare("SELECT 1 FROM register_last_inspection WHERE location_id <> ? AND last_date = ?").get(loc, add(today, -3)), "no other pharmacy got the day");
    // an older worker (no route): the day stays in this browser and the check still runs from it
    const op = await t.page(); await op.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token);
    await op.route("**/registers/last-inspection", (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"ok":false,"error":"Not found"}' }));
    await t.open(op, "2", "insreg", "insreg", ".ins-acts");
    await op.click('[data-range="since"]'); await op.fill("#ins-since", add(today, -7)); await op.press("#ins-since", "Enter");
    await op.waitForFunction((d) => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result.range.from === d; }, add(today, -7), { timeout: 20000 });
    t.ok(await op.evaluate((l) => localStorage.getItem("eikon_inspack_last:" + l), String(loc)) === add(today, -7), "without the route the day is kept in this browser and the check runs from it");
    t.ok(db.prepare("SELECT last_date FROM register_last_inspection WHERE location_id = ?").get(loc).last_date === add(today, -3), "and the server's day is untouched");
    // I8: the day chips are one row that scrolls sideways on a phone; the page itself never scrolls sideways
    const ph = await t.page({ phone: true }); await ph.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token);
    await t.open(ph, "2", "insreg", "insreg", ".ins-acts");
    const row8 = await ph.evaluate(() => { const c = document.querySelector(".ins-chips"), b = [...c.querySelectorAll("button")]; return { tops: new Set(b.map((x) => Math.round(x.getBoundingClientRect().top))).size, scrolls: c.scrollWidth > c.clientWidth, page: document.documentElement.scrollWidth, h: Math.min(...b.map((x) => x.getBoundingClientRect().height)) }; });
    t.ok(row8.tops === 1 && row8.scrolls && row8.page <= 390 && row8.h >= 44, "phone: one scrolling row of 44 px chips, no sideways page scroll: " + JSON.stringify(row8));
    await ph.click('[data-range="custom"]');
    const vis = await ph.evaluate(() => { const c = document.querySelector(".ins-chips"), b = c.querySelector('[aria-pressed="true"]').getBoundingClientRect(), r = c.getBoundingClientRect(); return b.left >= r.left - 1 && b.right <= r.right + 1; });
    t.ok(vis, "the chosen chip is scrolled into view");
    // I10: the pack's own words write days as the screen does
    t.ok(!/<dt>Days covered<\/dt><dd>[^<]*\d\d\/\d\d\/\d{4}/.test(html) && !/<dt>Prepared<\/dt><dd>\d\d\//.test(html) && /<dt>Days covered<\/dt><dd>1 [A-Z][a-z]{2}( \d{4})? to /.test(html), "cover dates are written out, not numeric: " + (html.match(/<dt>Days covered<\/dt><dd>[^<]*/) || [""])[0]);
  },
};
