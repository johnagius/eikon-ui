// Polish batch-21 (UI .183), on the real worker. A pharmacy of its own for what writes (a vaccination with a "1st" dose
// due today, a person on the rota, the opening hours, an end of day that is never saved); the busy demo pharmacy only
// read. Checks: Doses due picks the next dose and its "due today" is a pill; Over the counter hides the data's score and
// import words, caps "Goes well with" at 5 different products with Show all, and shows cautions where the data has them;
// Fill… has one Cancel; a title the app focuses never has a ring, also after a key; Today's team words an overlapping
// hand-over with "with"; End of day asks for the bag number before the lock question; the classic footers are gone from
// Labels, Credit notes, Paid out and Sent orders; the opening hours are typed in 24-hour time; Stock hub "Add an item"
// and Loyalty "Record" have 44 px boxes on a phone.
const malta = (n = 0) => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(Date.now() + n * 864e5));

export default {
  title: "Polish batch-21",
  async run(t) {
    const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const lid = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
    db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, 'Polish Pharmacy')").run(lid, org);
    const A = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "polish21@demo.mt", role: "admin", name: "Rita Grech" });
    const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: A.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    const pageA = async (opts) => { const p = await t.page(opts); await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, A.token); return p; };

    // ---- 1 + 2. Doses due: a "1st" dose (the worker's demo seed writes that) due today
    await api("GET", "/vaccines/stock/rows");
    await api("POST", "/vaccines/given", { given_on: malta(-30), client_first: "Doris", client_last: "Polishtest", phone: "79000221", email: "", id_card: "", vaccine_name: "Havrix 1440", dose: "1st", batch: "AHAV1", expiry_date: malta(200), site: "Left upper arm", consent_by: "Patient", next_due: malta(0), notes: "" });
    for (const phone of [false, true]) {
      const p = await pageA({ phone });
      await t.open(p, "2", "vaxreg", "vaxreg", ".vxg-due .vxg-row");
      const r = await p.evaluate(() => { const row = [...document.querySelectorAll(".vxg-due .vxg-row")].find((x) => /Polishtest/.test(x.textContent)); if (!row) return null; const pill = row.querySelector(".vxg-pill"), cs = getComputedStyle(pill);
        return { pill: pill.textContent, cls: pill.className, disp: cs.display, w: Math.round(pill.getBoundingClientRect().width), rowW: Math.round(row.getBoundingClientRect().width), btn: row.querySelector("[data-act=due-give]").textContent }; });
      t.ok(r && r.pill === "Dose 2 due today" && r.disp === "inline-block" && r.w < 200 && r.w < r.rowW / 2 && r.btn === "Record dose 2", (phone ? "phone" : "desktop") + ": a dose due today is a small pill like the others, and the button names the dose: " + JSON.stringify(r));
      if (!phone) {
        await p.locator(".vxg-due .vxg-row", { hasText: "Polishtest" }).locator("[data-act=due-give]").click(); await p.waitForSelector("#vxg-add");
        const sel = await p.evaluate(() => [...document.querySelectorAll("#vxg-add [data-act=gdose]")].filter((b) => b.getAttribute("aria-checked") === "true").map((b) => b.dataset.v));
        t.ok(sel.join() === "Dose 2", "Record dose 2 opens the form with Dose 2 chosen: " + JSON.stringify(sel));
      }
    }

    // ---- 3. Over the counter (the static OTC guide, read only)
    {
      const p = await t.page();
      await t.open(p, "2", "otcreg", "otcreg", ".otc-chip");
      await p.locator(".otc-chip", { hasText: /^Sore throat/ }).first().click(); await p.waitForSelector(".otc-detail .otc-row");
      const subs = await p.evaluate(() => [...document.querySelectorAll(".otc-detail .otc-row .s")].map((x) => x.textContent));
      t.ok(subs.length > 5 && !subs.some((s) => /score|imported|tags/i.test(s)) && subs.every((s) => /^(Main use|Also used for)|use case|bundle/i.test(s) || s.length < 80), "the symptom's products: no score, no import words: " + JSON.stringify(subs.slice(0, 4)));
      await p.locator(".otc-detail .otc-row", { hasText: /CETILSAN/ }).first().click(); await p.waitForSelector('[data-sec=complement]');
      const gw = await p.evaluate(() => { const L = document.querySelector("[data-sec=complement]"), rows = [...L.querySelectorAll(".otc-row b")].map((b) => b.textContent);
        return { rows, brands: new Set(rows.map((x) => x.split(/\s+/)[0].toLowerCase())).size, more: (L.querySelector(".otc-more") || {}).textContent, count: L.previousElementSibling.querySelector("b").textContent, subs: [...document.querySelectorAll(".otc-detail .otc-row .s")].map((x) => x.textContent).join("|"), caution: !!document.querySelector(".otc-caution") }; });
      t.ok(gw.rows.length === 5 && gw.brands === 5 && gw.more === "Show all 121" && gw.count === "121" && !/score/i.test(gw.subs), "Goes well with: 5 different products first, then Show all 121: " + JSON.stringify(gw));
      t.ok(!gw.caution, "CETILSAN has no caution in the OTC data (a data gap, reported): nothing invented");
      await p.click('[data-more=complement]');
      t.ok(await p.evaluate(() => document.querySelectorAll("[data-sec=complement] .otc-row").length) === 121, "Show all lists all 121");
      await p.click("[data-act=close]"); await p.waitForSelector(".otc-detail .otc-row");
      await p.locator(".otc-detail .otc-row", { hasText: /Septolete total Cola/ }).first().click(); await p.waitForSelector(".otc-card h2");
      const ca = await p.evaluate(() => ({ h: (document.querySelector(".otc-caution h3") || {}).textContent || "", n: document.querySelectorAll(".otc-caution .otc-row").length }));
      t.ok(/Caution: 4 products/.test(ca.h) && ca.n === 4, "a lozenge with duplicates in the data shows its cautions first: " + JSON.stringify(ca));
    }

    // ---- 4 + 8b + 5. Plan shifts' Fill… (one Cancel), the opening hours in 24-hour time, no ring on a focused title
    const sid = (await api("POST", "/shifts/staff", { full_name: "Karl Vella", designation: "assistant", employment_type: "fulltime", contracted_hours: 40, phone: "" })).staff_id;
    {
      const p = await pageA();
      await t.open(p, "2", "shfreg", "shfreg", "[data-act=fill-open]");
      await p.click("[data-act=fill-open]"); await p.click("[data-act=dlg-step][data-v=rota]"); await p.waitForSelector("#shf-rsid");
      const cancels = () => p.evaluate(() => [...document.querySelectorAll(".shf-dlg button")].filter((b) => b.textContent.trim() === "Cancel" && b.getClientRects().length).length);
      const c0 = await cancels();
      await p.selectOption("#shf-rsid", String(sid)); await p.waitForSelector("#shf-rp-ed .rp-acts");
      const c1 = await cancels();
      t.ok(c0 === 1 && c1 === 1, "Fill… › A usual week: one Cancel before and after choosing the person: " + JSON.stringify({ c0, c1 }));
      await p.locator("#shf-rp-ed [data-act=cancel]").click(); await p.waitForTimeout(200);
      t.ok(await p.evaluate(() => !document.querySelector(".shf-dlg")), "that Cancel closes Fill…");

      // the opening hours, opened after a key: the sheet's title holds focus with no ring; Tab goes on to a control with one
      await p.keyboard.press("Shift");
      await p.evaluate(() => window.EIKON.openHours()); await p.waitForSelector('.rps [data-f=week] [name=from1]');
      await p.waitForFunction(() => document.activeElement && document.activeElement.id === "rps-h", null, { timeout: 5000 }).catch(() => {});
      const ring = await p.evaluate(() => { const a = document.activeElement; return { id: a.id, fv: a.matches(":focus-visible"), o: getComputedStyle(a).outlineStyle }; });
      await p.keyboard.press("Tab");
      const next = await p.evaluate(() => { const a = document.activeElement; return { tag: a.tagName, o: getComputedStyle(a).outlineStyle }; });
      t.ok(ring.id === "rps-h" && ring.o === "none" && next.tag !== "BODY" && next.o !== "none", "a title the app focuses after a key has no ring; the next control keeps its ring: " + JSON.stringify({ ring, next }));
      const f = ".rps [data-f=week]";
      const shown = await p.evaluate((f) => [...document.querySelectorAll(f + " input.rps-t")].map((x) => x.type + ":" + x.value), f);
      t.ok(shown.length === 14 && shown.every((x) => /^text:\d\d:\d\d$/.test(x)), "the weekly hours show as 24-hour times (no AM/PM box): " + shown.slice(0, 2));
      await p.fill(f + " [name=from1]", "830"); await p.locator(f + " [name=from1]").evaluate((e) => e.blur());
      t.ok(await p.inputValue(f + " [name=from1]") === "08:30", "830 becomes 08:30 on leaving the box");
      let puts = 0; p.on("request", (r) => { if (r.method() === "PUT" && /opening-hours/.test(r.url())) puts++; });
      await p.fill(f + " [name=to1]", "25:00"); await p.click(f + " [type=submit]"); await p.waitForTimeout(300);
      const bad = await p.evaluate((f) => ({ msg: document.querySelector(f + " .rps-msg").textContent, inv: document.querySelector(f + " [name=to1]").getAttribute("aria-invalid") }), f);
      t.ok(/24-hour/.test(bad.msg) && bad.inv === "true" && puts === 0, "25:00 is said before saving, nothing sent: " + JSON.stringify(bad));
      await p.fill(f + " [name=to1]", "19"); await t.write(p, /\/shifts\/opening-hours$/, () => p.click(f + " [type=submit]"), "PUT");
      const hrs = (await api("GET", "/shifts/opening-hours")).hours.weekly;
      t.ok(hrs[1] && hrs[1].open === "08:30" && hrs[1].close === "19:00", "stored as 08:30–19:00: " + JSON.stringify(hrs[1]));
    }

    // ---- 6. Today's team: an overlapping hand-over is "with", one after the other is "then"
    {
      const p = await pageA();
      await t.open(p, "2", "team", "team", ".tmt-sum, .tmt-err, .hub h2.tmt-all[hidden]");
      const w = await p.evaluate(() => { const T = window.EIKON.teamToday, D = (b) => ({ date: "2026-11-11", now: "09:00", holiday: null, hours: { open: "08:00", close: "19:30", closed: false, override: false }, settings: { pharmacistRequired: true, minPharmacists: 1 },
        shifts: [{ staff_id: 1, full_name: "Maria Borg", designation: "pharmacist", role_override: "", start_time: "08:00", end_time: "14:00" }, { staff_id: 2, full_name: "Kurt Zahra", designation: "pharmacist", role_override: "", start_time: b, end_time: "19:30" }], leave: [], locum_today: [], handover: null, board: null });
        return [T.headText(D("13:00"), "09:00"), T.headText(D("14:00"), "09:00")]; });
      t.ok(/Pharmacist: Maria Borg until 14:00, with Kurt Zahra from 13:00\.$/.test(w[0]) && /Pharmacist: Maria Borg until 14:00, then Kurt Zahra from 14:00\.$/.test(w[1]), "overlap: with; in turn: then: " + JSON.stringify(w));
    }

    // ---- 7. End of day: a deposit with no bag number is said before the lock question (nothing saved)
    {
      const p = await pageA();
      await t.open(p, "2", "eodreg", "eodreg", '#eod-form [name="dep:n50"]');
      let puts = 0; p.on("request", (r) => { if (r.method() === "PUT" && /endofday/.test(r.url())) puts++; });
      await p.fill('#eod-form [name="cash:n50"]', "2"); await p.fill('#eod-form [name="dep:n50"]', "1"); await p.fill("#eod-form [name=bag_number]", "");
      await p.click("[data-act=lock]"); await p.waitForTimeout(250);
      const e = await p.evaluate(() => ({ ask: !!document.querySelector("[role=alertdialog]"), err: (document.querySelector("#eod-err") || {}).textContent || "", inv: document.querySelector("#eod-form [name=bag_number]").getAttribute("aria-invalid"), focus: document.activeElement && document.activeElement.name }));
      t.ok(!e.ask && /bag number/i.test(e.err) && e.inv === "true" && e.focus === "bag_number" && puts === 0, "Save and lock with no bag number: said first, cursor in the box, no lock question, nothing sent: " + JSON.stringify(e));
      await p.fill("#eod-form [name=bag_number]", "B-77"); await p.click("[data-act=lock]"); await p.waitForTimeout(250);
      t.ok(await p.evaluate(() => !!document.querySelector("[role=alertdialog][aria-label^='Lock']")) && puts === 0, "with the bag number, the lock question comes (nothing sent until it is answered)");
    }

    // ---- 8a. Footers in the new words (the busy pharmacy, read only)
    {
      const p = await t.page();
      const foot = async (hash, mod, sel) => { await t.open(p, "2", hash, mod, sel); return p.evaluate(() => [...document.querySelectorAll(".ecr-foot, .lbl-note, .sin-foot")].map((x) => x.textContent).join(" | ") + " || classic links: " + document.querySelectorAll('#eikon-content [data-act=classic]').length); };
      const cn = await foot("cnreg", "cnreg", ".ecr-foot"), po = await foot("poreg", "poreg", ".ecr-foot"), lb = await foot("lblreg", "lblreg", ".lbl-note");
      await t.open(p, "2", "sinreg", "sinreg", "[data-act=view][data-v=orders]"); await p.click("[data-act=view][data-v=orders]"); await p.waitForTimeout(300);
      const sn = await p.evaluate(() => ({ foot: !!document.querySelector(".sin-foot"), classic: /classic screen/.test(document.querySelector("#eikon-content").innerText) }));
      t.ok(/Made a mistake\? Press Correct on the line — what it said before stays on record\./.test(cn) && !/classic|audit/.test(cn.split(" || ")[0]) && /classic links: 0/.test(cn), "Credit notes: the new footer: " + cn);
      t.ok(/Made a mistake\? Press Correct on the line/.test(po) && !/classic|audit/.test(po.split(" || ")[0]) && /classic links: 0/.test(po), "Paid out: the new footer: " + po);
      t.ok(/come from Pharmacy details\.$/.test(lb.split(" || ")[0]) && /classic links: 0/.test(lb), "Labels: one plain line, no classic screen: " + lb);
      t.ok(!sn.foot && !sn.classic, "Sent orders: no classic footer: " + JSON.stringify(sn));
    }

    // ---- 8c. 44 px boxes on a phone: Stock hub "Add an item", Loyalty "Record"
    {
      await api("POST", "/loyalty/campaigns", { id: "ly_polish21", name: "Stamp card", type: "points", active: true, open_ended: true, points_per_unit: 1, redeem_threshold: 50, reward: "€2 off" });
      const p = await pageA({ phone: true });
      await t.open(p, "2", "stock", "stock", "[data-act=add]");
      await p.click("[data-act=add]"); await p.waitForSelector("#stk-add");
      const sh = await p.evaluate(() => [...document.querySelectorAll("#stk-add input, #stk-add select")].filter((x) => x.getClientRects().length).map((x) => Math.round(x.getBoundingClientRect().height)));
      await t.open(p, "2", "loyreg", "loyreg", "#lyr-rec");
      const lh = await p.evaluate(() => [...document.querySelectorAll("#lyr-rec input:not([type=checkbox]):not([type=radio]), #lyr-rec select")].filter((x) => x.getClientRects().length).map((x) => Math.round(x.getBoundingClientRect().height)));
      t.ok(sh.length >= 2 && Math.min(...sh) >= 44 && lh.length >= 2 && Math.min(...lh) >= 44, "phone: Add an item and Loyalty Record boxes are at least 44 px: " + JSON.stringify({ sh, lh }));
    }
  }
};
