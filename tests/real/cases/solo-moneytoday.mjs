// Today's money (money-hub): the top of the Money hub, on the real worker.
// Two pharmacies of their own (other cases write to the suite's pharmacy at the same time): one with an earlier day
// saved but not locked, the last open day never closed, today started, money paid out, emergency-till sales and
// credit notes (one expiring soon); one with today closed. Checks the words, the order (overdue, to do, the rest),
// amounts as €1,234.56, the one tap into the right screen (and the day, for End of day), the status under the hub's
// cards, staff rights (a staff account sees what its screens show, and no How we're doing), and the cost: opening
// Money asks the server once (and not again within a minute), never once per screen. Read only.
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const add = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function pharmacy(t, name, email) {
  const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
  // an id below 600: locations 600-900 are company-admin accounts (ui/core.js), and team.mjs adds location 770, after which
  // a plain INSERT would be numbered 771+ and this pharmacy's admin would land on the Company Dashboard (full-suite only)
  const id = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 600").get().n);
  const loc = Number(db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(id, org, name).lastInsertRowid);
  const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email, role: "admin", name: "Rita Camilleri" });
  const s = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "staff-" + email, role: "staff", name: "Karl Vella" });
  const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
  return { org, loc, token: u.token, staff: s.token, api };
}
const eod = (date, x, staff) => ({ record: { date, eod_date: date, time_of_day: "PM", staff, staff_name: staff, float_amount: "100.00", x: [{ amount: x, remark: "" }], epos: [{ amount: "200", remark: "" }], cheques: [], paid_outs: [], cash: { n500: "0", n200: "0", n100: "0", n50: "0", n20: "0", n10: "0", n5: "0", coins_total: "0" }, deposit: {}, bov_bag_number: "", notes: "" } });

export default {
  title: "Today's money",
  async run(t) {
    const today = maltaToday();
    const busy = await pharmacy(t, "Money Today Busy", "moneytoday-busy@demo.mt"), calm = await pharmacy(t, "Money Today Closed", "moneytoday-closed@demo.mt");
    const first = (await t.stack.app.api("GET", "/money/today", { token: busy.token })).json; // the last open day by the default hours
    const lastOpen = first.end_of_day.last_open_day, older = add(today, -10);
    await busy.api("PUT", "/endofday/record", eod(today, "1234.56", "Ċensina Zammit"));
    await busy.api("PUT", "/endofday/record", eod(older, "800", "Ċensina Zammit"));
    await busy.api("POST", "/paid-out/entries", { entry_date: today, entry_time: "10:15", payee_name: "Ħobża Bakery", fee: "12.50", payment_method: "cash", invoice_no: "", cheque_no: "", reason: "Milk" });
    await busy.api("POST", "/paid-out/entries", { entry_date: today, entry_time: "11:15", payee_name: "Courier Ltd", fee: "7.25", payment_method: "cash", invoice_no: "", cheque_no: "", reason: "Delivery" });
    t.db.prepare("INSERT INTO pos_sales (org_id, location_id, sale_date, receipt_no, items_json, subtotal, vat_total, total, payment_method, voided, created_by) VALUES (?, ?, ?, 'E1', '[]', 10, 0, 10, 'cash', 0, 1), (?, ?, ?, 'E2', '[]', 5.5, 0, 5.5, 'card', 0, 1)").run(busy.org, busy.loc, today, busy.org, busy.loc, today);
    const cn = (b) => busy.api("POST", "/creditnotes/entries", Object.assign({ issue_date: add(today, -20), client_name: "Ġorġ", client_surname: "Borg", telephone: "79000000", email: "", receipt_number: "" }, b));
    await cn({ amount: 1000, no_expiry: 1 });
    await cn({ amount: 25, expiry_date: add(today, 5), no_expiry: 0 });
    await calm.api("PUT", "/endofday/record", eod(today, "950", "Rita Camilleri"));
    await calm.api("POST", "/eod/lock", { eod_date: today });

    const look = async (token, { phone = false } = {}) => {
      const p = await t.page({ phone }), reqs = [];
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, token);
      p.on("request", (r) => { const u = new URL(r.url()); if (u.port === new URL(t.base).port && !u.pathname.startsWith("/ui/") && r.method() === "GET") reqs.push(u.pathname); });
      await t.open(p, "2", "money", "money", ".mny-sum, .mny-err");
      const rows = await p.evaluate(() => [...document.querySelectorAll(".mny-row")].map((r) => ({ key: r.dataset.mny, cls: r.classList[1], title: r.querySelector(".mny-t b").childNodes[0].textContent.trim(), text: r.querySelector(".mny-t > span").textContent, btn: r.querySelector("button").textContent.trim() })));
      const chips = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".hub-card[data-open]")].map((c) => [c.dataset.open, (c.querySelector(".mny-chip") || {}).textContent || ""])));
      return { p, reqs, rows, chips, head: await p.textContent(".mny-sum") };
    };

    // ---- busy pharmacy, desktop
    const B = await look(busy.token);
    t.ok(B.reqs.filter((x) => x === "/money/today").length === 1, "Money asked /money/today once: " + JSON.stringify(B.reqs));
    t.ok(!B.reqs.some((x) => /\/(entries|list|sales|record|dates)$/.test(x)), "no read per screen on opening: " + JSON.stringify(B.reqs));
    const by = (k) => B.rows.find((r) => r.key === k) || {};
    const o = by("eod:" + older);
    t.ok(o.cls === "overdue" && /^Saved but not locked\./.test(o.text) && o.btn === "Open", "an earlier day saved, not locked: " + JSON.stringify(o));
    const m = by("eod:" + lastOpen);
    t.ok(m.cls === "todo" && /^No end of day was saved/.test(m.text) && m.btn === "Open", "the last open day never closed: " + JSON.stringify(m));
    const td = by("eod");
    t.ok(/^Started by Ċensina Zammit, not locked yet\. Takings so far €1,234\.56\./.test(td.text), "today started, takings so far: " + JSON.stringify(td));
    t.ok(by("po").text === "€19.75 paid from the till today, 2 payments.", "paid out: " + JSON.stringify(by("po")));
    t.ok(by("epos").text === "€15.50 taken on the emergency till today, 2 sales.", "emergency till: " + JSON.stringify(by("epos")));
    t.ok(/^€1,025\.00 held by customers on 2 credit notes\. 1 note expires within 30 days \(€25\.00\)/.test(by("cn").text), "credit notes held, one expiring: " + JSON.stringify(by("cn")));
    const rank = { overdue: 0, todo: 1, info: 2, done: 3 }, order = B.rows.map((r) => rank[r.cls]);
    t.ok(order.every((v, i) => !i || order[i - 1] <= v), "overdue first, then to do, then the rest: " + B.rows.map((r) => r.cls).join(","));
    t.ok(/^\d+ things to do, 1 overdue\.$/.test(B.head.trim()) || /^\d+ days to close\.$/.test(B.head.trim()), "headline: " + B.head);
    t.ok(B.chips.endofday === "1 day not locked" || /not locked$/.test(B.chips.endofday), "status under End of day: " + JSON.stringify(B.chips));
    t.ok(!B.chips.paidout && !B.chips["emergency-pos"] && B.chips.creditnotes === "1 note ends within 30 days" && !B.chips.ownreg && !B.chips.locumreceipts, "status under the cards only where something needs a look, no figure repeated: " + JSON.stringify(B.chips));
    const labs = await B.p.evaluate(() => [...document.querySelectorAll(".hub-lab")].map((x) => x.textContent).join("|"));
    t.ok(labs === "Till|Customers and locums" && await B.p.$('.hub-card[data-open="ownreg"]'), "How we're doing stays a card, its label no longer repeats it: " + labs);
    // one tap: the earlier day opens End of day with that day handed over
    await B.p.click('[data-mny="eod:' + older + '"] button, [data-mny="eod:unlocked"] button');
    await B.p.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg", null, { timeout: 10000 });
    // the hand-off on the merged build: End of day opens on that earlier day (its register row is the open one), and the key is read once
    await B.p.waitForSelector(".eod-dr[aria-current]", { timeout: 10000 });
    const landed = await B.p.evaluate(() => ({ cur: document.querySelector(".eod-dr[aria-current]").getAttribute("data-d"), key: sessionStorage.getItem("eikon_eodreg_day") }));
    t.ok(landed.key === null && landed.cur === older, "End of day opened on " + older + ": " + JSON.stringify(landed));
    // back on Money within the minute: nothing asked again
    await t.idle(B.p); B.reqs.length = 0;
    await B.p.evaluate(() => { window.location.hash = "#money"; });
    await B.p.waitForSelector(".mny-sum", { timeout: 10000 }); await t.idle(B.p);
    t.ok(!B.reqs.includes("/money/today"), "Money again within a minute asked nothing: " + JSON.stringify(B.reqs));

    // ---- staff of the busy pharmacy, phone: the same day facts as their screens, no How we're doing
    const St = await look(busy.staff, { phone: true });
    t.ok(St.rows.some((r) => r.key === "eod") && St.rows.some((r) => r.key === "cn") && !(await St.p.$('.hub-card[data-open="ownreg"]')), "staff: end of day and credit notes as on their screens, no How we're doing: " + St.rows.map((r) => r.key).join(","));
    t.ok(await St.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll on a phone");
    const small = await St.p.evaluate(() => [...document.querySelectorAll(".mny button")].filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((b) => b.textContent));
    t.ok(!small.length, "44 px targets on a phone: " + JSON.stringify(small));

    // ---- closed pharmacy: today closed, with its takings
    const C = await look(calm.token, { phone: true });
    const ct = C.rows.find((r) => r.key === "eod") || {};
    t.ok(ct.cls === "done" && /^Closed by Rita Camilleri\. Takings €950\.00/.test(ct.text) && ct.btn === "Open ›", "today closed: " + JSON.stringify(ct) + " " + JSON.stringify(C.chips));
    t.ok(!C.rows.some((r) => r.key === "epos"), "no emergency-till line when it sold nothing");
    const td2 = await t.stack.app.api("GET", "/today", { token: calm.token });
    t.ok(td2.json && td2.json.money === undefined, "/today carries nothing new");
  }
};
