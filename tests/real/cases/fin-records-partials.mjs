// Records (Finish round, John): partial dispensing on POYC and Controlled drugs supplied. Each part is an ordinary
// register line (same body and row as without parts); "Partials — still to give" remembers what is left, gives the
// next part with everything filled in, keeps the history, completes at 0 and closes with a reason.
const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const KEYS = ["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no", "urgent"];
export default {
  title: "Partial dispensing",
  async run(t) {
    const today = maltaToday(), db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, "Records Partials Pharmacy").lastInsertRowid);
    const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "partials@demo.mt", role: "admin", name: "Daniel Borg" });
    const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    await api("POST", "/dda-purchases/entries", { entry_date: today, dda_name_dose: "Methylphenidate 10mg tablets", quantity: 500, agent: "Medicare Ltd", invoice_number: "PT-INV" }); // enough on the books: no shortfall warning here
    const p = await t.page();
    await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token);
    const RX = { id: "234567M", name: "Vella Rosa", addr: "5 Triq San Pawl, Rabat", doc: "Dr Mark Galea", reg: "R2202", med: "Methylphenidate 10mg tablets" };
    for (const [hash, path, table] of [["poyreg", "/dda-poyc/entries", "dda_poyc_entries"], ["cdsreg", "/dda-sales/entries", "dda_sales_entries"]]) {
      const serial = "PT-" + hash;
      await t.open(p, "2", hash, hash, "[data-act=add]");
      await p.click("[data-act=add]"); await p.waitForSelector("#cds-add");
      await t.fill(p, "#cds-add", { entry_date: today, client_id_card: RX.id, client_name: RX.name, client_address: RX.addr, doctor_name: RX.doc, doctor_reg_no: RX.reg, prescription_serial_no: serial, '#cds-add [data-i="0"][data-k=medicine_name_dose]': RX.med, '#cds-add [data-i="0"][data-k=quantity]': "20" });
      await p.click("#cds-add [data-act=partmode]");
      t.ok(await p.getAttribute("#cds-add [data-act=partmode]", "aria-pressed") === "true" && await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("pq")), hash + ": Giving part now shows Prescribed in total, the cursor in it");
      await p.fill('#cds-add [data-i="0"][data-k=prescribed]', "15");
      await p.click("#cds-add button[type=submit]");
      t.ok(/prescribed in total \(more than 20\)/.test(await p.textContent(".cds-err")), hash + ": prescribed must be more than given now: " + await p.textContent(".cds-err"));
      await p.fill('#cds-add [data-i="0"][data-k=prescribed]', "60");
      const m = t.maxId(table);
      const [w, pw] = await Promise.all([t.write(p, new RegExp(path + "$"), () => p.click("#cds-add button[type=submit]")), p.waitForResponse((r) => new URL(r.url()).pathname === "/dda-partials" && r.request().method() === "POST", { timeout: 10000 })]);
      t.ok(JSON.stringify(Object.keys(w.body)) === JSON.stringify(KEYS), hash + ": the line's body is the register's own (no new key): " + Object.keys(w.body).join());
      const pj = await pw.json();
      t.ok(pj.ok && pj.partial.prescribed === 60 && pj.partial.left === 40, hash + ": the part-supply is kept: " + JSON.stringify(pj).slice(0, 200));
      const first = (await t.mine(table, m, { prescription_serial_no: serial, location_id: loc }))[0];
      const twin = await api("POST", path, w.body); t.same(hash + " part vs a plain line", t.row(table, twin.entry_id), first); db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(twin.entry_id);
      await p.waitForSelector(".cds-prow"); await t.idle(p);
      const row = await p.textContent(".cds-prow");
      t.ok(/Partials — still to give 1/.test(await p.textContent(".cds-part h2")) && /Methylphenidate 10mg tablets/.test(row) && /Rx PT-\w+ of \d+ \w{3} \(today\)/.test(row) && /given 20 of 60/.test(row) && /40 left/.test(row) && /Give the rest/.test(row) && /Close without giving the rest/.test(row), hash + ": still to give, with the prescription's date and days since: " + row);
      if (hash === "poyreg") { // the medicine's running register and the Inspection check list it too
        await p.evaluate(() => { window.EIKON.cdOpen("Methylphenidate 10mg tablets"); }); await p.waitForSelector(".cdr-sum"); await t.idle(p);
        t.ok(/Partials — still to give 1/.test(await p.textContent(".cdr").catch(() => "")) && /Vella Rosa: 40 left of 60 \(POYC/.test(await p.textContent(".cdr")), "Controlled drugs by medicine lists the part-supply");
        await p.evaluate(() => { location.hash = "#insreg"; }); await p.waitForFunction(() => { const s = window.EIKON.inspect.state; return window.EIKON.state.activeModuleId === "insreg" && !s.job && s.result; }, null, { timeout: 20000 });
        await p.evaluate(() => { window.__p0 = window.EIKON.inspect.state.result; }); await p.click('[data-range="this"]');
        await p.waitForFunction(() => { const s = window.EIKON.inspect.state; return !s.job && s.result && s.result !== window.__p0; }, null, { timeout: 20000 });
        const dt = await p.evaluate(() => window.EIKON.inspect.state.result.list.find((r) => r.id === "dda").reasons.map((x) => x.text).join(" | "));
        t.ok(/Still to give \(a prescription given in parts\): Methylphenidate 10mg tablets for Vella Rosa, Rx PT-poyreg: 40 left of 60, first given/.test(dt), "the Inspection check (and so the pack) lists it: " + dt);
        await p.evaluate(() => { location.hash = "#poyreg"; }); await p.waitForSelector(".cds-prow"); await t.idle(p);
      }
      // the next part: everything filled in, the quantity left; no serial question; the history grows
      await p.click("[data-pgive]"); await p.waitForSelector("#cds-add .cds-give");
      await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-k") === "quantity", null, { timeout: 3000 }).catch(() => {});
      t.ok(await p.inputValue("#cds-add [name=client_name]") === RX.name && await p.inputValue("#cds-add [name=prescription_serial_no]") === serial && await p.inputValue('#cds-add [data-i="0"][data-k=quantity]') === "40" && await p.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-k") === "quantity"), hash + ": Give the rest fills the form, 40 left, the cursor on the quantity");
      await p.fill('#cds-add [data-i="0"][data-k=quantity]', "25");
      const [w2, g2] = await Promise.all([t.write(p, new RegExp(path + "$"), () => p.click("#cds-add button[type=submit]")), p.waitForResponse((r) => /\/dda-partials\/\d+\/give$/.test(new URL(r.url()).pathname), { timeout: 10000 })]);
      t.ok(JSON.stringify(Object.keys(w2.body)) === JSON.stringify(KEYS) && w2.body.quantity === 25 && !(await p.locator(".cds-dup").count()), hash + ": the next part saved at once with the register's body");
      t.ok((await g2.json()).partial.left === 15, hash + ": 15 left");
      await p.waitForFunction(() => /15 left/.test((document.querySelector(".cds-prow") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
      await p.click(".cds-prow summary");
      t.ok(/History \(2\)/.test(await p.textContent(".cds-prow summary")) && (await p.locator(".cds-prow li").count()) === 2, hash + ": the history lists both parts");
      if (hash === "poyreg") {
        // close with a reason: none refused, then kept
        await p.click("[data-pclose]"); await p.waitForSelector("[data-pcform]");
        await p.click("[data-pcform] button[type=submit]");
        t.ok(/Write why it is closed/.test(await p.textContent("[data-pcform] .cds-err")), "close: a reason is needed");
        await p.fill("[data-pcform] [name=reason]", "Patient moved to another pharmacy");
        await t.write(p, /\/dda-partials\/\d+\/close$/, () => p.click("[data-pcform] button[type=submit]"));
        await p.waitForFunction(() => !document.querySelector(".cds-prow"), null, { timeout: 8000 }).catch(() => {});
        t.ok(!(await p.locator(".cds-part").count()), "closed: no longer still to give");
        const c = db.prepare("SELECT status, close_reason, closed_name FROM dda_partials WHERE location_id = ? AND register = 'poyc'").get(loc);
        t.ok(c.status === "closed" && c.close_reason === "Patient moved to another pharmacy" && c.closed_name === "Daniel Borg", "closed with the reason and who: " + JSON.stringify(c));
      } else {
        await p.click("[data-pgive]"); await p.waitForSelector("#cds-add .cds-give");
        await Promise.all([t.write(p, /\/dda-sales\/entries$/, () => p.click("#cds-add button[type=submit]")), p.waitForResponse((r) => /\/dda-partials\/\d+\/give$/.test(new URL(r.url()).pathname), { timeout: 10000 })]);
        await p.waitForFunction(() => !document.querySelector(".cds-prow"), null, { timeout: 8000 }).catch(() => {});
        t.ok(!(await p.locator(".cds-part").count()) && db.prepare("SELECT status FROM dda_partials WHERE location_id = ? AND register = 'sales'").get(loc).status === "done", "all given: complete, no longer listed");
      }
    }
  },
};
