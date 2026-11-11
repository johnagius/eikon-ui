// Today's services (svc-hub): the top of the Services hub, on the real worker.
// Two pharmacies of their own: one busy (reaction reports not sent, one serious; a screening campaign running with a
// follow-up overdue and one due today; tests today; a vaccine batch expired and one expiring; bookings today) and one
// with nothing. Checks the words, the order (to do first), the one tap into the right screen with the person handed over
// (sessionStorage eikon_svc_open, V-C2) or the booking (eikon_bk_open), the status under the hub's cards, staff rights,
// isolation, and the cost: opening Services asks the server once (and not again within a minute). Read only.
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const add = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

async function pharmacy(t, name, email) {
  const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
  const id = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 600").get().n); // below the company-admin range (see solo-moneytoday)
  const loc = Number(db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(id, org, name).lastInsertRowid);
  const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email, role: "admin", name: "Rita Camilleri" });
  const s = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "staff-" + email, role: "staff", name: "Karl Vella" });
  const api = async (m, p, body) => { const r = await t.stack.app.api(m, p, { token: u.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
  return { org, loc, token: u.token, staff: s.token, api };
}

export default {
  title: "Today's services",
  async run(t) {
    const today = maltaToday();
    const busy = await pharmacy(t, "Services Today Busy", "svctoday-busy@demo.mt"), calm = await pharmacy(t, "Services Today Calm", "svctoday-calm@demo.mt");
    await busy.api("GET", "/services/today"); await calm.api("GET", "/services/today"); // the tables
    const pv = (id, status, date, sev, meddra, drug) => ({ id, status, report_type: "Initial", report_date: date, created_at: date + "T09:00:00.000Z", pt_initials: "Ġ.B.", reaction_meddra: meddra, reaction_seriousness: sev, drugs: [{ name: drug }] });
    await busy.api("PUT", "/pharmacovigilance/state", { state: { reports: [pv("pv_s1", "Draft", add(today, -5), "Non-serious", "Rash", "Amoxicillin 500mg"), pv("pv_s2", "Draft", add(today, -1), "Serious – Hospitalisation", "Angioedema", "Ramipril 5mg"), pv("pv_s3", "Submitted to MPA", add(today, -9), "Non-serious", "Nausea", "Metformin")], deleted_ids: [] } });
    const per = (id, name, date, fus) => ({ id, idCard: "", name, phone: "", email: "", dob: "", type: "Walk-in", date, resultNotes: "", resultCategory: "Normal", referral: "No referral needed", referralNotes: "", poctResults: {}, followUps: fus || [] });
    await busy.api("PUT", "/screening/state", { state: { campaigns: [{ id: "cmp_svt", name: "Blood pressure week", type: "Blood Pressure Check", startDate: add(today, -2), endDate: add(today, 3), status: "Active", location: "Pharmacy Floor", targetScreenings: "40", participants: [
      per("ps1", "Ċensu Borg", add(today, -2), [{ id: "fs1", scheduledDate: add(today, -3), reason: "Recheck blood pressure", status: "Pending", notes: "" }]),
      per("ps2", "Marija Zammit", today, [{ id: "fs2", scheduledDate: today, reason: "Bring home readings", status: "Scheduled", notes: "" }]),
      per("ps3", "Helena Vella", today)] }], deleted_ids: [] } });
    const nowIso = new Date().toISOString();
    t.db.prepare("INSERT INTO poct_records (org_id, location_id, record_id, test_type, performed_at_iso, performed_at_local, record_json) VALUES (?, ?, 'svt1', 'bp', ?, ?, '{}'), (?, ?, 'svt2', 'bg', ?, ?, '{}')").run(busy.org, busy.loc, nowIso, today + "T09:30", busy.org, busy.loc, nowIso, today + "T10:30");
    await busy.api("POST", "/vaccines/stock/rows", { vaccine_name: "Vaxigrip Tetra", qty: 4, batch: "VX1", expiry_date: add(today, -2) });
    await busy.api("POST", "/vaccines/stock/rows", { vaccine_name: "Boostrix", qty: 2, batch: "BX9", expiry_date: add(today, 10) });
    // six vaccine doses due (vax's record): five overdue (5..1 days), one due today; the hub shows five and "1 more"
    const doses = [];
    for (const [k, first, last] of [[5, "Anna", "Spiteri"], [4, "Ġorġ", "Farrugia"], [3, "Ivan", "Micallef"], [2, "Lara", "Azzopardi"], [1, "Noel", "Cassar"], [0, "Pia", "Debono"]]) {
      const r = await busy.api("POST", "/vaccines/given", { given_on: add(today, -30 - k), client_first: first, client_last: last, phone: "", email: "", id_card: "", vaccine_name: "Havrix 1440", dose: "Dose 1", batch: "AH1", expiry_date: add(today, 200), site: "Left upper arm", consent_by: "Patient", next_due: add(today, -k), order_id: 0, notes: "" });
      doses.push(Number(r.id || (r.given && r.given.id) || (r.row && r.row.id)));
    }
    t.ok(doses.every((x) => x > 0), "six vaccinations recorded: " + JSON.stringify(doses));
    const sv = Number(t.db.prepare("INSERT INTO bk_services (org_id, location_id, name) VALUES (?, ?, 'Flu vaccine')").run(busy.org, busy.loc).lastInsertRowid);
    const bk = t.db.prepare("INSERT INTO bk_bookings (org_id, location_id, service_id, provider_id, person_name, date, start_time, end_time, status) VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)");
    bk.run(busy.org, busy.loc, sv, "Rita Grech", today, "00:00", "00:10", "booked");
    const nextId = Number(bk.run(busy.org, busy.loc, sv, "Kurt Zahra", today, "23:58", "23:59", "confirmed").lastInsertRowid);

    const look = async (token, { phone = false } = {}) => {
      const p = await t.page({ phone }), reqs = [];
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, token);
      p.on("request", (r) => { const u = new URL(r.url()); if (u.port === new URL(t.base).port && !u.pathname.startsWith("/ui/") && r.method() === "GET") reqs.push(u.pathname); });
      await t.open(p, "2", "services", "services", ".svt-sum, .svt-err, .hub h2.svt-all[hidden]");
      const rows = await p.evaluate(() => [...document.querySelectorAll(".svt-row")].map((r) => ({ key: r.dataset.svt, cls: r.classList[1], title: r.querySelector(".svt-t b").childNodes[0].textContent.trim(), text: r.querySelector(".svt-t > span").textContent, btn: r.querySelector("button").textContent.trim() })));
      const chips = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".hub-card[data-open]")].map((c) => [c.dataset.open, (c.querySelector(".svt-chip") || {}).textContent || ""])));
      const head = await p.evaluate(() => (document.querySelector(".svt-sum") || {}).textContent || "");
      return { p, reqs, rows, chips, head };
    };

    // ---- busy pharmacy, desktop
    const B = await look(busy.token);
    t.ok(B.reqs.filter((x) => x === "/services/today").length === 1, "Services asked /services/today once: " + JSON.stringify(B.reqs));
    t.ok(!B.reqs.some((x) => /\/(state|orders|rows|bookings)$/.test(x)), "no screen's own read on opening: " + JSON.stringify(B.reqs));
    const by = (k) => B.rows.find((r) => r.key === k) || {};
    const f1 = by("fu:cmp_svt:ps1:" + add(today, -3)), f2 = by("fu:cmp_svt:ps2:" + today);
    t.ok(f1.cls === "todo" && /^Overdue · 3 days\. Recheck blood pressure, Blood pressure week\.$/.test(f1.text) && f1.title === "Ċensu Borg · follow-up", "follow-up overdue: " + JSON.stringify(f1));
    t.ok(f2.cls === "todo" && /^Due today\./.test(f2.text), "follow-up due today: " + JSON.stringify(f2));
    // John (2026-11-09): a SERIOUS report not sent is red and first; the one not serious stays amber
    t.ok(by("pv:s").cls === "problem" && /^Serious, not sent yet: 1 report from \w{3} \d+ \w{3} \(1 day\)\. Angioedema after Ramipril 5mg\.$/.test(by("pv:s").text) && B.rows[0].key === "pv:s", "serious report not sent: red, first: " + JSON.stringify(by("pv:s")) + " first " + (B.rows[0] || {}).key);
    t.ok(by("pv").cls === "todo" && /^Not sent yet: 1 report from \w{3} \d+ \w{3} \(5 days\)\. Rash after Amoxicillin 500mg\.$/.test(by("pv").text), "report not sent, not serious: amber: " + JSON.stringify(by("pv")));
    const red = await B.p.evaluate(() => { const r = document.querySelector('[data-svt="pv:s"]'), a = document.querySelector('[data-svt="pv"]'); const c = (el) => el && getComputedStyle(el).color, bg = (el) => el && getComputedStyle(el).backgroundColor;
      return { hot: c(r.querySelector(".svt-hot.problem")), ic: bg(r.querySelector(".svt-ic")), amber: c(a.querySelector(".svt-hot.todo")), word: r.querySelector(".svt-sr") && r.querySelector(".svt-sr").textContent, chip: (document.querySelector('.hub-card[data-open="pharmacovigilance"] .svt-chip') || {}).className }; });
    const reddish = (c) => { const m = /rgba?\((\d+), (\d+), (\d+)/.exec(c || ""); return !!m && +m[1] > 150 && +m[2] < 110 && +m[3] < 130; };
    t.ok(reddish(red.hot) && reddish(red.ic) && !reddish(red.amber) && red.word === ", Serious" && /\bproblem\b/.test(red.chip || ""), "serious in red (words, icon, chip), the other amber: " + JSON.stringify(red));
    // the same rules on the data alone: only a not-serious report -> one amber row; only a serious one (Fatal) -> one red row
    const pure = await B.p.evaluate((today) => { const T = window.EIKON.svcToday, base = { date: today, time: "10:00" };
      const one = (pv) => { const D = Object.assign({}, base, { pv }); return { rows: T.sorted(T.items(D)).map((x) => x.key + ":" + x.status), chip: T.chips(D).pharmacovigilance, head: T.headText(T.summary(D)) }; };
      return { calm: one({ drafts: 1, serious: 0, oldest_draft_date: today, reports: [{ id: "a", date: today, serious: false, reaction: "Rash", medicine: "X" }] }),
        fatal: one({ drafts: 1, serious: 1, oldest_draft_date: today, reports: [{ id: "b", date: today, serious: true, reaction: "Death", medicine: "Y" }] }),
        many: one({ drafts: 3, serious: 2, oldest_draft_date: today, reports: [{ id: "c", date: today, serious: true }, { id: "d", date: today, serious: true }, { id: "e", date: today, serious: false }] }) }; }, today);
    t.ok(pure.calm.rows.join() === "pv:todo" && pure.calm.chip.status === "todo" && pure.calm.chip.text === "1 not sent yet" &&
      pure.fatal.rows.join() === "pv:s:problem" && pure.fatal.chip.status === "problem" && pure.fatal.chip.text === "1 serious report not sent" && pure.fatal.head === "1 thing waiting." &&
      pure.many.rows.join() === "pv:s:problem,pv:todo" && pure.many.chip.text === "2 serious reports not sent" && pure.many.head === "2 things waiting.", "serious red / others amber on the data: " + JSON.stringify(pure));
    // vaccine doses due: five rows (overdue first) and "1 more"
    const d1 = by("vd:" + doses[0]), nd = await B.p.evaluate(() => ["Dose 1", "Dose 2", "Dose 3", "Booster", "Only dose", "1st", "2nd"].map(window.EIKON.svcToday.nextDose).join());
    t.ok(nd === "Dose 2,Dose 3,Booster,Booster,Next dose,Dose 2,Dose 3", "the next dose in Vaccines' own words: " + nd);
    t.ok(d1.cls === "todo" && d1.title === "Anna Spiteri · Havrix 1440" && /^Overdue · 5 days\. Dose 2 was due on /.test(d1.text) && by("vd:more").text === "And 1 more dose due." && !by("vd:" + doses[5]).key, "doses due: " + JSON.stringify([d1, by("vd:more")]));
    t.ok(/^Vaxigrip Tetra \(batch VX1\) expired on .* and is still in stock\.$/.test(by("vs:x").text), "expired batch: " + JSON.stringify(by("vs:x")));
    t.ok(/^Boostrix \(batch BX9\) expires on /.test(by("vs:s").text) && by("vs:s").cls === "info", "batch expiring: " + JSON.stringify(by("vs:s")));
    t.ok(/^Running until .*\. 3 screened of 40, 2 today\.$/.test(by("sc:cmp_svt").text), "campaign running: " + JSON.stringify(by("sc:cmp_svt")));
    t.ok(by("done").text === "2 tests." && by("done").cls === "done", "done today: " + JSON.stringify(by("done")));
    const late = B.rows.find((r) => /Rita Grech/.test(r.title)) || {}, next = B.rows.find((r) => /Kurt Zahra/.test(r.title)) || {};
    t.ok(late.cls === "todo" && /^Not marked yet\. Flu vaccine\.$/.test(late.text) && next.cls === "info" && next.text === "Flu vaccine" && next.title === "23:58 · Kurt Zahra", "bookings: " + JSON.stringify([late, next]));
    const rank = { problem: 0, todo: 1, info: 2, done: 3 }, order = B.rows.map((r) => rank[r.cls]);
    t.ok(order.every((v, i) => !i || order[i - 1] <= v), "the serious report first, then to do, then the rest: " + B.rows.map((r) => r.cls).join(","));
    t.ok(/^12 things waiting, 6 overdue\. 1 booking still to come today\.$/.test(B.head.trim()), "headline: " + B.head);
    t.ok(B.chips.poct === "2 tests today" && B.chips.screening === "2 follow-ups due" && B.chips.pharmacovigilance === "1 serious report not sent" && B.chips.vaccines === "6 doses due" && !B.chips.ocps && !B.chips.labels, "status under the cards: " + JSON.stringify(B.chips));
    // one tap: the follow-up opens Screening with that person handed over
    await B.p.evaluate(() => { const o = sessionStorage.setItem.bind(sessionStorage); window.__svt = {}; sessionStorage.setItem = (k, v) => { window.__svt[k] = v; return o(k, v); }; });
    await B.p.click('[data-svt="fu:cmp_svt:ps1:' + add(today, -3) + '"] button');
    await B.p.waitForFunction(() => window.EIKON.state.activeModuleId === "scrreg", null, { timeout: 10000 });
    const handed = await B.p.evaluate(() => JSON.parse(window.__svt.eikon_svc_open || "{}"));
    t.ok(handed.to === "scrreg" && handed.c === "cmp_svt" && handed.p === "ps1" && Date.now() - handed.at < 60000, "Screening opened on that person: " + JSON.stringify(handed));
    // back on Services within the minute: nothing asked again; the booking opens Bookings on that booking
    await t.idle(B.p); B.reqs.length = 0;
    await B.p.evaluate(() => { window.location.hash = "#services"; });
    await B.p.waitForSelector(".svt-sum", { timeout: 10000 }); await t.idle(B.p);
    t.ok(!B.reqs.includes("/services/today"), "Services again within a minute asked nothing: " + JSON.stringify(B.reqs));
    await B.p.evaluate(() => { const o = sessionStorage.setItem.bind(sessionStorage); window.__svt = {}; sessionStorage.setItem = (k, v) => { window.__svt[k] = v; return o(k, v); }; });
    await B.p.click('[data-svt="bk:' + nextId + '"] button');
    await B.p.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings", null, { timeout: 10000 });
    const bkh = await B.p.evaluate(() => JSON.parse(window.__svt.eikon_bk_open || "{}"));
    t.ok(bkh.id === nextId && bkh.date === today, "Bookings opened on that booking: " + JSON.stringify(bkh));

    // Each Open lands where it says (the merged build): Vaccines takes eikon_svc_open once, like POCT, Screening and Adverse reactions
    const tap = async (key, mod, ready) => {
      await B.p.evaluate(() => { window.location.hash = "#services"; });
      await B.p.waitForSelector('[data-svt="' + key + '"] button', { timeout: 10000 });
      await B.p.evaluate(() => { const o = sessionStorage.setItem.bind(sessionStorage); window.__svt = {}; sessionStorage.setItem = (k, v) => { window.__svt[k] = v; return o(k, v); }; });
      await B.p.click('[data-svt="' + key + '"] button');
      await B.p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, mod, { timeout: 10000 });
      if (ready) await B.p.waitForFunction(ready, null, { timeout: 10000 }).catch(() => {});
      await t.idle(B.p);
      return B.p.evaluate(() => ({ set: JSON.parse((window.__svt && window.__svt.eikon_svc_open) || "{}"), left: sessionStorage.getItem("eikon_svc_open"), focus: document.activeElement && (document.activeElement.getAttribute("data-gid") + "|" + document.activeElement.getAttribute("data-act") + "|" + document.activeElement.textContent.trim()) }));
    };
    // a dose due: Vaccines on that person's dose (highlighted and focused), the note taken
    const v3 = await tap("vd:" + doses[2], "vaxreg", () => !!document.querySelector(".vxg-row.new"));
    const v3row = await B.p.evaluate(() => [...document.querySelectorAll(".vxg-due .vxg-row.new b")].map((b) => b.textContent));
    t.ok(v3.set.to === "vaxreg" && v3.set.f === "due" && v3.set.p === doses[2] && v3.left === null && v3row.join() === "Ivan Micallef" && v3.focus === doses[2] + "|due-give|Record dose 2", "a dose due opens Vaccines on that person: " + JSON.stringify([v3, v3row]));
    // "1 more dose due": every dose due shown (the sixth too), focus on the first
    const vm = await tap("vd:more", "vaxreg", () => document.querySelectorAll(".vxg-due .vxg-row").length === 6);
    const vmn = await B.p.evaluate(() => ({ n: document.querySelectorAll(".vxg-due .vxg-row").length, more: (document.querySelector("[data-act=due-all]") || {}).textContent }));
    t.ok(vm.set.f === "due" && !vm.set.p && vm.left === null && vmn.n === 6 && vmn.more === "Show fewer" && vm.focus === doses[0] + "|due-give|Record dose 2", "every dose due: " + JSON.stringify([vm, vmn]));
    // an expired batch: Vaccines says where stock is kept, with the way there focused
    const vs = await tap("vs:x", "vaxreg", () => !!document.querySelector("#vxr-stock"));
    const vst = await B.p.evaluate(() => (document.querySelector("#vxr-stock") || {}).textContent || "");
    t.ok(vs.set.f === "stock" && vs.left === null && /kept in the classic screen/.test(vst) && /\|classic\|Open vaccine stock$/.test(vs.focus || ""), "expired batch opens Vaccines' way to stock: " + JSON.stringify([vs, vst]));
    // a stale note (over a minute old) is dropped, and Vaccines opens as usual
    await B.p.evaluate(() => { sessionStorage.setItem("eikon_svc_open", JSON.stringify({ to: "vaxreg", f: "stock", at: Date.now() - 61000 })); window.location.hash = "#services"; });
    await B.p.waitForSelector(".svt-sum", { timeout: 10000 });
    await B.p.evaluate(() => { window.location.hash = "#vaxreg"; }); await B.p.waitForFunction(() => window.EIKON.state.activeModuleId === "vaxreg", null, { timeout: 10000 }); await t.idle(B.p);
    t.ok(await B.p.evaluate(() => !document.querySelector("#vxr-stock") && sessionStorage.getItem("eikon_svc_open") === null), "a stale note is dropped");
    // the others: the serious reports open Adverse reactions on Not sent yet; POCT; a campaign opens Screening on it
    const pvo = await tap("pv:s", "pvreg");
    t.ok(pvo.set.to === "pvreg" && pvo.set.f === "draft" && pvo.left === null, "serious reports open Adverse reactions, not sent yet: " + JSON.stringify(pvo));
    const po = await tap("done", "pocreg");
    t.ok(po.set.to === "pocreg" && po.left === null, "Done today opens POCT: " + JSON.stringify(po));
    const sco = await tap("sc:cmp_svt", "scrreg");
    t.ok(sco.set.to === "scrreg" && sco.set.c === "cmp_svt" && sco.left === null, "the campaign opens Screening on it: " + JSON.stringify(sco));

    // ---- staff of the busy pharmacy, phone: the same list; 44 px targets; no sideways scroll
    const St = await look(busy.staff, { phone: true });
    t.ok(St.rows.some((r) => r.key === "pv:s") && St.rows.length === B.rows.length, "staff see the same list: " + St.rows.map((r) => r.key).join(","));
    t.ok(await St.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "no sideways scroll on a phone");
    const small = await St.p.evaluate(() => [...document.querySelectorAll(".svt button")].filter((b) => { const r = b.getBoundingClientRect(); return r.height < 44 || r.width < 44; }).map((b) => b.textContent));
    t.ok(!small.length, "44 px targets on a phone: " + JSON.stringify(small));

    // ---- the calm pharmacy: nothing of the busy one's
    const C = await look(calm.token, { phone: true });
    t.ok(/^Nothing waiting\./.test(C.head.trim()) && !C.rows.some((r) => /^(fu|pv|vs|sc)/.test(r.key)) && !Object.values(C.chips).some(Boolean), "another pharmacy sees nothing of the first: " + C.head + " " + JSON.stringify(C.rows.map((r) => r.key)));
    const td = await t.stack.app.api("GET", "/today", { token: calm.token });
    t.ok(td.json && td.json.services_today === undefined, "/today carries nothing new");
  }
};
