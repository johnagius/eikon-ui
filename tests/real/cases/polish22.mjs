// Polish batch-22, on the real worker. A pharmacy of its own for what writes; the distributor's "Problems reported" is in
// solo-polish22-portal.mjs (it needs a location in the distributor range, so it runs last, alone). Checks, one per fault:
//   1. the stamp that fills a loyalty card says so (toast "Card complete — … due", "Reward due" on the card, then the
//      count of completed cards once the next stamp starts a new one); the Loyalty screen's saved line says so too
//   2. supplier problem types in plain English (E.problemLabel, as every problem list draws them)
//   3. the header chip and the card's title show stamps for a stamp card, points for points
//   4. End of day: the Over / under bar sits flush with the bottom of the window, desktop and phone, light and dark
//   5. "tal-Ħamrun" inside a name stays small when saved, and a stored "Tal-" shows small (the stored name unchanged)
//   6. Put it on the rota…: the preview comes after one wait (the rows and next year's leave together), not three
//   7. an answered question in Waiting now says the customer has not been told yet
const malta = (n = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 864e5));

export default {
  title: "Polish batch-22",
  async run(t) {
    const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const lid = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
    db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, 'Polish Pharmacy 22')").run(lid, org);
    const A = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "polish22@demo.mt", role: "admin", name: "Rita Grech" });
    const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: A.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    const pageA = async (opts) => { const p = await t.page(opts); await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, A.token); return p; };
    const openPerson = async (p, card) => {
      await t.open(p, "2", "customers", "customers", "#cus-q");
      await p.fill("#cus-q", card); await p.waitForSelector(".cus-item"); await p.click(".cus-item");
      await p.waitForSelector("#cus-now-h"); await p.waitForTimeout(300);
    };

    // ---- 1 + 3 + 7. Miriam: a 3-stamp card with 2 stamps, a points card elsewhere, a question answered today
    const M = { name: "Cachia Miriam", id_card: "0217455M", phone: "79318820" };
    await api("POST", "/people", { name: M.name, id_card: M.id_card, phone: M.phone, alt_phone: "", email: "", address: "7, Triq San Pawl, Naxxar", doctor_name: "", source: "manual" });
    await api("POST", "/loyalty/campaigns", { id: "p22-vit", name: "Vitamins card", type: "stamp_card", active: 1, open_ended: 1, stamp_target: 3, reward: "Free vitamins" });
    for (let k = 0; k < 2; k++) await api("POST", "/loyalty/transactions", { client_id: M.id_card, client_name: M.name, campaign_id: "p22-vit", items: [{ desc: "Omega-3 x60", qty: 1 }], total: 8.95, stamps_awarded: 1, points_awarded: 0, action_label: "Awarded 1 stamp", date: malta(-20 + k), receipt_no: "" });
    await api("POST", "/client-tickets/entries", { ticket_id: "TKT-22001", open_date: malta(-3), client_name: M.name, phone: M.phone, email: "", issue: "Asked if Vitamin D3 1000IU is in stock", category: "Stock Check", priority: 2, status: "Resolved", assigned_to: "", followup_date: null, notes_log: "[]" });
    {
      const p = await pageA();
      await openPerson(p, M.id_card); await p.waitForSelector("#cus-loy-box [data-act=loy-add]");
      const head = () => p.evaluate(() => ({ chip: [...document.querySelectorAll(".cus-head .cus-pill")].map((x) => x.textContent).find((x) => /^Loyalty/.test(x)) || "", title: ((document.querySelector("#cus-loy-sum") || {}).textContent) || "", card: document.querySelector("#cus-loy-box").innerText }));
      const h0 = await head();
      t.ok(h0.chip === "Loyalty · 2 of 3 stamps" && h0.title === "2 of 3 stamps" && /2 of 3 stamps · next one completes the card/.test(h0.card), "3. a stamp card shows stamps in the header chip and the card title, not '0 pts': " + JSON.stringify(h0));
      const w = await p.evaluate(() => [...document.querySelectorAll(".cus-now .cus-w")].map((li) => li.querySelector(".t").innerText.replace(/\s+/g, " ") + " [" + [...li.querySelectorAll("button")].map((b) => b.textContent).join("/") + "]"));
      t.ok(w.length === 1 && /^Answered · Asked if Vitamin D3 1000IU is in stock Resolved today · Miriam has not been told yet \[Tell Miriam\/Open\]$/.test(w[0]), "7. an answered question waits only to be told, and says so: " + JSON.stringify(w));
      const stamp = async () => {
        await p.click("#cus-loy-box [data-act=loy-add]"); await p.waitForSelector("#cus-loy");
        await p.selectOption("#cus-ly-c", "p22-vit"); await p.fill("#cus-ly-d", "Omega-3 x60"); await p.fill("#cus-ly-t", "8.95");
        await p.evaluate(() => document.querySelectorAll(".eikon-toast").forEach((x) => x.remove()));
        await t.write(p, /\/loyalty\/transactions$/, () => p.click("[data-act=loy-save]"));
        await p.waitForSelector("#cus-loy-box [data-act=loy-add]"); await p.waitForTimeout(250);
        return p.evaluate(() => [...document.querySelectorAll(".eikon-toast")].map((x) => x.textContent).join(" | "));
      };
      const toast1 = await stamp(), h1 = await head();
      t.ok(/Card complete — Free vitamins due/.test(toast1), "1. the stamp that fills the card says the card is complete and the reward is due: " + toast1);
      t.ok(/Reward due/.test(h1.card) && /Card complete · Free vitamins due/.test(h1.card) && !/0 of 3 stamps/.test(h1.card) && h1.chip === "Loyalty · reward due", "1. the card shows Reward due (not a silent 0 of 3): " + JSON.stringify(h1));
      const stored = db.prepare("SELECT action_label, stamps_awarded FROM loyalty_transactions WHERE location_id = ? ORDER BY id DESC LIMIT 1").get(lid);
      t.ok(stored.action_label === "Awarded 1 stamp" && stored.stamps_awarded === 1, "1. what is stored is the classic body, unchanged: " + JSON.stringify(stored));
      const toast2 = await stamp(), h2 = await head();
      t.ok(/^Awarded 1 stamp/.test(toast2) && /1 of 3 stamps/.test(h2.card) && /1 card completed so far/.test(h2.card) && !/Reward due/.test(h2.card) && h2.chip === "Loyalty · 1 of 3 stamps", "1. the next stamp starts a new card and the completed one is counted: " + JSON.stringify({ toast2, h2 }));
    }
    // 3 (points) + 1 (Loyalty screen): a points card still shows points; the Loyalty screen's saved line on a full card
    {
      const P = { name: "Vella Joseph", id_card: "0333444M" };
      await api("POST", "/people", { name: P.name, id_card: P.id_card, phone: "79000222", alt_phone: "", email: "", address: "", doctor_name: "", source: "manual" });
      await api("POST", "/loyalty/campaigns", { id: "p22-pts", name: "Points", type: "points", active: 1, open_ended: 1, points_per_unit: 1, redeem_threshold: 100, reward: "€5 off" });
      await api("POST", "/loyalty/transactions", { client_id: P.id_card, client_name: P.name, campaign_id: "p22-pts", items: [{ desc: "Cream", qty: 1 }], total: 42, stamps_awarded: 0, points_awarded: 42, action_label: "Awarded 42 points", date: malta(-2), receipt_no: "" });
      const p = await pageA();
      await openPerson(p, P.id_card); await p.waitForSelector("#cus-loy-box [data-act=loy-add]");
      const chip = await p.evaluate(() => [...document.querySelectorAll(".cus-head .cus-pill")].map((x) => x.textContent).find((x) => /^Loyalty/.test(x)));
      t.ok(chip === "Loyalty · 42 pts", "3. a points card still shows its points: " + chip);
      // Loyalty › Record: the third stamp on a new 3-stamp card for someone else
      for (let k = 0; k < 2; k++) await api("POST", "/loyalty/transactions", { client_id: P.id_card, client_name: P.name, campaign_id: "p22-vit", items: [{ desc: "Omega-3 x60", qty: 1 }], total: 8.95, stamps_awarded: 1, points_awarded: 0, action_label: "Awarded 1 stamp", date: malta(-1), receipt_no: "" });
      await t.open(p, "2", "loyreg", "loyreg", "#lyr-rec");
      await p.fill("#lyr-rec [name=client_id]", P.id_card); await p.locator("#lyr-rec [name=client_id]").dispatchEvent("change"); await p.waitForSelector(".lyr-snap .lyr-prog", { timeout: 8000 });
      await p.selectOption("#lyr-rec [name=campaign_id]", "p22-vit"); await p.fill("#lyr-rec [name=item_desc]", "Omega-3 x60"); await p.fill("#lyr-rec [name=total]", "8.95");
      await t.write(p, /\/loyalty\/transactions$/, () => p.click("#lyr-rec [type=submit], #lyr-rec [data-act=save]"));
      await p.waitForSelector(".lyr-done"); const done = await p.textContent(".lyr-done");
      t.ok(/Card complete — reward due: Free vitamins\./.test(done), "1. Loyalty's saved line says the card is complete: " + done);
      await p.fill("#lyr-rec [name=client_id]", P.id_card); await p.locator("#lyr-rec [name=client_id]").dispatchEvent("change"); await p.waitForSelector(".lyr-snap .lyr-prog", { timeout: 8000 }); await p.waitForTimeout(200);
      const prog = await p.evaluate(() => document.querySelector(".lyr-snap .lyr-prog").innerText);
      t.ok(/Card complete/.test(prog) && /Reward due: Free vitamins/.test(prog), "1. Loyalty's card look-up shows the reward due: " + JSON.stringify(prog));
    }

    // ---- 2. problem types in plain English
    {
      const p = await pageA();
      await t.open(p, "2", "customers", "customers", "#cus-q");
      const L = await p.evaluate(() => { const f = window.EIKON.problemLabel; return f ? ["short_dated", "Not Received", "Wrong Pick", "Damaged", "Short Quantity", "Other", "expired", "", "price_too_high"].map(f) : null; });
      t.ok(L && L.join("|") === "Short expiry date|Not received|Wrong pick|Damaged|Short quantity|Other|Expired|Problem|Price too high", "2. every problem type reads in plain English: " + JSON.stringify(L));
    }

    // ---- 4. End of day: the bar flush with the bottom, desktop and phone, light and dark
    for (const phone of [false, true]) for (const dark of [false, true]) {
      const p = await pageA({ phone }); await p.emulateMedia({ colorScheme: dark ? "dark" : "light" });
      await t.open(p, "2", "eodreg", "eodreg", '#eod-form [name="cash:n50"]');
      await p.evaluate(() => document.querySelector('#eod-form [name="cash:n50"]').scrollIntoView({ block: "center" })); await p.waitForTimeout(300);
      const m = await p.evaluate(() => { const a = document.querySelector(".eod-acts"), r = a.getBoundingClientRect(), bg = getComputedStyle(a).backgroundColor;
        const under = document.elementFromPoint(Math.round(r.left + 4), innerHeight - 2);
        return { bottom: Math.round(r.bottom), vh: innerHeight, pinned: r.top < innerHeight - 40, bg, underIsBar: !!(under && (a === under || a.contains(under) || under.closest(".eikon-tabbar, nav, [class*=tab]"))) }; });
      t.ok(m.pinned && Math.abs(m.bottom - m.vh) <= 1 && m.underIsBar && !/rgba\(0, 0, 0, 0\)|transparent/.test(m.bg), "4. " + (phone ? "phone" : "desktop") + (dark ? " dark" : " light") + ": the Over / under bar reaches the bottom of the window, nothing of the form below it: " + JSON.stringify(m));
    }

    // ---- 5. names: tal-Ħamrun
    {
      const r = await api("POST", "/people", { name: "borg maria assunta tal-ħamrun", id_card: "0555123M", phone: "79555123", alt_phone: "", email: "", address: "", doctor_name: "", source: "manual" });
      const pid = r.person ? r.person.id : r.id;
      const saved = db.prepare("SELECT name FROM people WHERE location_id = ? AND id_card = '0555123M'").get(lid);
      t.ok(saved && saved.name === "Borg Maria Assunta tal-Ħamrun", "5. a name typed in lower case is stored with 'tal-' small: " + JSON.stringify(saved));
      await api("POST", "/people", { name: "Abela Pietru", id_card: "0555124M", phone: "79555124", alt_phone: "", email: "", address: "", doctor_name: "", source: "manual" });
      db.prepare("UPDATE people SET name = 'Abela Pietru Maria Assunta Tal-Ħamrun' WHERE location_id = ? AND id_card = '0555124M'").run(lid); // as an older casing stored it
      const p = await pageA();
      await t.open(p, "2", "customers", "customers", "#cus-q");
      await p.fill("#cus-q", "Assunta"); await p.waitForFunction(() => { const x = [...document.querySelectorAll(".cus-item")]; return x.length >= 2 && x.every((e) => /Assunta/.test(e.textContent)); });
      const shown = await p.evaluate(() => [...document.querySelectorAll(".cus-item .cus-t b")].map((b) => b.textContent).sort());
      await p.locator(".cus-item", { hasText: "Abela" }).click(); await p.waitForSelector(".cus-head h1");
      const h1 = await p.textContent(".cus-head h1");
      const still = db.prepare("SELECT name FROM people WHERE location_id = ? AND id_card = '0555124M'").get(lid).name;
      t.ok(shown.join("|") === "Abela Pietru Maria Assunta tal-Ħamrun|Borg Maria Assunta tal-Ħamrun" && h1 === "Abela Pietru Maria Assunta tal-Ħamrun" && still === "Abela Pietru Maria Assunta Tal-Ħamrun", "5. the list and the record show 'tal-' small; the stored name is not changed: " + JSON.stringify({ shown, h1, still, pid }));
      const nc = await p.evaluate(() => ["joseph de gabriele", "Joseph De Gabriele", "zammit ta' xbiex", "tal-pietà"].map(window.EIKON.people.nameCase));
      t.ok(nc.join("|") === "Joseph de Gabriele|Joseph De Gabriele|Zammit ta' Xbiex|Tal-Pietà", "5. de/ta' small inside a name, kept when typed with a capital, a first word always capitalised: " + JSON.stringify(nc));
    }

    // ---- 6. Put it on the rota…: one wait, not three
    {
      const sid = (await api("POST", "/shifts/staff", { full_name: "Ryan Mifsud", designation: "assistant", employment_type: "parttime", contracted_hours: 24, phone: "" })).staff_id;
      const wk = [{ off: true }, { off: false, start: "13:30", end: "19:00", role_override: "" }, { off: true }, { off: false, start: "13:30", end: "19:00", role_override: "" }, { off: true }, { off: false, start: "13:30", end: "19:00", role_override: "" }, { off: false, start: "08:00", end: "13:00", role_override: "" }];
      db.prepare("UPDATE shift_staff SET patterns_json = ? WHERE id = ?").run(JSON.stringify({ patterns: [{ id: "p22-ryan", name: "Usual week", week: wk, createdAt: Date.now() }], provisionalId: "p22-ryan" }), sid);
      const p = await pageA();
      await t.open(p, "2", "shfreg", "shfreg", "[data-act=fill-open]");
      await p.click("[data-act=fill-open]"); await p.click("[data-act=dlg-step][data-v=rota]"); await p.waitForSelector("#shf-rsid");
      await p.selectOption("#shf-rsid", String(sid)); await p.waitForSelector("#shf-rp-ed .rp-acts");
      // change the usual week (Saturday 08:00–12:00) and save it: the preview must use what was just saved
      const sat = p.locator('#shf-rp-ed input[data-f^="e"][aria-label^="Sat"]').first(); await sat.fill("12:00"); await sat.dispatchEvent("change");
      await t.write(p, /\/shifts\/staff\/\d+$/, () => p.locator("#shf-rp-ed [data-act=save]").click(), "PUT");
      await p.waitForSelector("#shf-rp-ed [data-act=apply]"); await p.waitForTimeout(400);
      const DL = 300, reqs = []; let t0 = 0;
      await p.route(/\/shifts\//, async (r) => { reqs.push({ u: new URL(r.request().url()).pathname + new URL(r.request().url()).search, at: Date.now() - t0 }); await new Promise((ok) => setTimeout(ok, DL)); r.continue(); });
      t0 = Date.now(); await p.click("#shf-rp-ed [data-act=apply]");
      await p.waitForFunction(() => [...document.querySelectorAll(".shf-dlg button")].some((b) => /^Add \d+ shifts/.test(b.textContent.trim())), null, { timeout: 15000 });
      const ms = Date.now() - t0;
      const pv = await p.evaluate(() => ({ btn: [...document.querySelectorAll(".shf-dlg button")].map((b) => b.textContent.trim()).find((x) => /^Add \d+ shifts/.test(x)), txt: document.querySelector(".shf-dlg").innerText.replace(/\s+/g, " ").slice(0, 200) }));
      t.ok(ms < 2.2 * DL && !reqs.some((r) => /\/shifts\/staff/.test(r.u)), "6. Put it on the rota…: the preview after one wait (" + ms + " ms at " + DL + " ms a request), no second read of everyone: " + JSON.stringify(reqs));
      await p.unroute(/\/shifts\//);
      await t.write(p, /\/shifts\/apply-plan$/, () => p.locator(".shf-dlg button", { hasText: /^Add \d+ shifts/ }).click());
      const satRow = db.prepare("SELECT start_time, end_time FROM shift_assignments WHERE staff_id = ? AND strftime('%w', shift_date) = '6' ORDER BY shift_date LIMIT 1").get(sid);
      t.ok(pv.btn && satRow && satRow.end_time === "12:00", "6. what goes on the rota is the usual week just saved (Saturday until 12:00): " + JSON.stringify({ pv, satRow }));
    }
  }
};
