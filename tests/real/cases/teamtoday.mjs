// Today's team (team-hub): the top of the Team hub, on the real worker. A pharmacy of its own with today's rota (a
// pharmacist on all day, one away on approved leave, an assistant later), opening hours for today, yesterday's
// handover with a critical point, two leave requests waiting, and @mentions: one for everyone and one a pharmacy in
// ANOTHER group kept to its group (never shown here, not counted). Checks the words, the order (red first), the one tap,
// the status under the cards, staff vs pharmacist, and the cost: opening Team asks the server once (and not again within
// a minute). Gap words come from E.teamCover (rota, T-C2): checked against the classic rule when it is in the build;
// without it, no gap line is drawn. Read only.
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const add = (s, n) => { const d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

export default {
  title: "Today's team",
  async run(t) {
    const today = maltaToday(), db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const lid = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
    db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, 'Team Today Pharmacy')").run(lid, org);
    const A = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "teamtoday@demo.mt", role: "admin", name: "Rita Camilleri" });
    const St = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "teamtoday-staff@demo.mt", role: "staff", name: "Karl Vella" });
    const api = async (m, p, body, token) => { const r = await t.stack.app.api(m, p, { token: token || A.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    await api("GET", "/team/today"); await api("GET", "/board/messages"); // the tables
    const mk = async (full_name, designation, phone) => { const r = await api("POST", "/shifts/staff", { full_name, designation, employment_type: "fulltime", contracted_hours: 40, phone: phone || "" }); return r.staff_id || r.id; };
    const ph = await mk("Dr Ħelena Farrugia", "pharmacist", "79 123 456"), as = await mk("Ċensina Żammit", "assistant", ""), off = await mk("Marija Pace", "pharmacist", "");
    await api("POST", "/shifts/assignments", { staff_id: ph, shift_date: today, start_time: "00:00", end_time: "23:59", notes: "" });
    await api("POST", "/shifts/assignments", { staff_id: as, shift_date: today, start_time: "23:58", end_time: "23:59", notes: "" });
    await api("POST", "/shifts/assignments", { staff_id: off, shift_date: today, start_time: "00:00", end_time: "23:59", notes: "" });
    const lv = await api("POST", "/shifts/leaves", { staff_id: off, leave_type: "sick", start_date: add(today, -1), end_date: add(today, 1), reason: "" });
    await api("POST", "/shifts/leaves/" + lv.leave_id + "/approve", {});
    await api("POST", "/shifts/leaves", { staff_id: as, leave_type: "annual", start_date: add(today, 9), end_date: add(today, 10), reason: "Festa" });
    await api("POST", "/shifts/leaves", { staff_id: ph, leave_type: "annual", start_date: add(today, 20), end_date: add(today, 20), reason: "" });
    const ov = {}; ov[today] = { open: "00:00", close: "23:59", closed: false, note: "" };
    await api("PUT", "/shifts/opening-hours", { default: { open: "07:30", close: "19:30", closed: false }, weekly: {}, overrides: ov });
    await api("PUT", "/instructions/daily", { ymd: add(today, -1), notes: "", handover_out: [{ id: "tt_1", sev: "r", text: "Fridge 2 door does not close" }, { id: "tt_2", sev: "g", text: "Cotton wool low" }] });
    // mentions of Rita: one public, one from another group kept to that group (a leaked row must still not show)
    const oo = Number(db.prepare("INSERT INTO orgs (name) VALUES ('Other Group Team')").run().lastInsertRowid); // a fresh id: other cases make their own groups
    const ol = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
    db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, 'Ħamrun Other')").run(ol, oo);
    const msg = db.prepare("INSERT INTO board_messages (org_id, location_id, user_id, user_name, location_name, body, scope) VALUES (?, ?, 9, ?, ?, ?, ?)");
    const men = db.prepare("INSERT INTO board_mentions (message_id, mentioned_user_id, is_read) VALUES (?, ?, 0)");
    const rita = db.prepare("SELECT id FROM users WHERE email = 'teamtoday@demo.mt'").get().id;
    men.run(Number(msg.run(oo, ol, "Sara Vella", "Ħamrun Other", "SECRET group rota @Rita", "org").lastInsertRowid), rita);
    men.run(Number(msg.run(oo, ol, "Sara Vella", "Ħamrun Other", "Anyone has Ozempic 1mg? @Rita", "all").lastInsertRowid), rita);

    const look = async (token, { phone = false, before } = {}) => {
      const p = await t.page({ phone }), reqs = [];
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, token);
      if (before) await p.context().addInitScript(before);
      p.on("request", (r) => { const u = new URL(r.url()); if (u.port === new URL(t.base).port && !u.pathname.startsWith("/ui/") && r.method() === "GET") reqs.push(u.pathname); });
      await t.open(p, "2", "team", "team", ".tmt-sum, .tmt-err, .hub h2.tmt-all[hidden]");
      const read = () => p.evaluate(() => ({
        head: (document.querySelector(".tmt-sum") || {}).textContent || "",
        rows: [...document.querySelectorAll(".tmt-row[data-tmt]")].map((r) => ({ key: r.dataset.tmt, cls: r.classList[1], title: r.querySelector(".tmt-t b").childNodes[0].textContent.trim(), text: r.querySelector(".tmt-t > span").textContent, btn: r.querySelector("button").textContent.trim() })),
        who: [...document.querySelectorAll(".tmt-who h3")].map((h) => h.textContent + ": " + [...h.nextElementSibling.querySelectorAll(".tmt-p b")].map((b) => b.textContent).join(", ")),
        tel: [...document.querySelectorAll(".tmt-who a[href^='tel:']")].map((a) => a.getAttribute("href")),
        chips: Object.fromEntries([...document.querySelectorAll(".hub-card[data-open]")].map((c) => [c.dataset.open, (c.querySelector(".tmt-chip") || {}).textContent || ""])),
        page: document.body.innerText, cover: typeof window.EIKON.teamCover === "function" }));
      return { p, reqs, read };
    };

    // ---- the pharmacist, nobody in the locum register yet
    const B = await look(A.token), r1 = await B.read();
    t.ok(B.reqs.filter((x) => x === "/team/today").length === 1, "Team asked /team/today once: " + JSON.stringify(B.reqs));
    t.ok(!B.reqs.some((x) => /^\/(shifts|instructions|board|locumregister)\//.test(x)), "no screen's own read on opening: " + JSON.stringify(B.reqs));
    const by = (r, k) => r.rows.find((x) => x.key === k) || {};
    t.ok(r1.rows[0] && r1.rows[0].key === "pic" && r1.rows[0].cls === "problem" && r1.rows[0].title === "No pharmacist signed in" && r1.rows[0].btn === "Sign in", "no pharmacist signed in: red, first, Sign in: " + JSON.stringify(r1.rows[0]));
    t.ok(/^Open 00:00–23:59 · 2 people on today · Pharmacist: Dr Ħelena Farrugia until 23:59\.$/.test(r1.head), "the headline in words: " + r1.head);
    t.ok(by(r1, "hnd").cls === "todo" && by(r1, "hnd").title === "Handover from yesterday" && by(r1, "hnd").text === "1 critical point and 1 other. Not read by you yet." && by(r1, "hnd").btn === "Read ›", "handover not read (a quiet button: only the first thing to do is solid): " + JSON.stringify(by(r1, "hnd")));
    t.ok(by(r1, "men").cls === "todo" && by(r1, "men").title === "Mentioned you: Ħamrun Other" && /Ozempic 1mg/.test(by(r1, "men").text) && !/And \d/.test(by(r1, "men").text), "one mention of you (the public one): " + JSON.stringify(by(r1, "men")));
    t.ok(B.p && (await B.p.evaluate(() => document.querySelectorAll(".tmt-list .tmt-btn.p").length)) === 1, "one solid button on the list (the first thing to do)");
    t.ok(!/SECRET/.test(r1.page), "another group's private message is nowhere on the page");
    t.ok(by(r1, "lv").cls === "todo" && by(r1, "lv").text === "2 requests waiting for your answer." && by(r1, "lv").btn === "Answer ›", "leave requests for the pharmacist: " + JSON.stringify(by(r1, "lv")));
    t.ok(r1.who.join(" | ") === "On now: Dr Ħelena Farrugia | Later today: Ċensina Żammit | Away today: Marija Pace" && r1.tel.join() === "tel:79123456", "who is on, later and away, Call by phone: " + JSON.stringify([r1.who, r1.tel]));
    t.ok(r1.chips.locumregister === "No pharmacist signed in" && r1.chips.instructions === "1 critical · not read" && /1 mention of you/.test(r1.chips.messageboard) && r1.chips.shifts === "2 leave requests" && /2 people today/.test(r1.chips.rotreg), "status under the cards: " + JSON.stringify(r1.chips));
    if (r1.cover) {
      t.ok(!r1.rows.some((x) => /^gap:/.test(x.key)), "E.teamCover in the build: covered all day, no gap line");
      // the hub's gap words are E.teamCover's on the same day: a weekly-hours day, a public holiday, a holiday the hours open
      const same = await B.p.evaluate(() => {
        const T = window.EIKON.teamToday, base = (date, hours, holiday) => ({ date, now: "00:01", holiday, hours, settings: { pharmacistRequired: true, minPharmacists: 1 },
          shifts: [{ staff_id: 1, full_name: "Ċensina", designation: "pharmacist", role_override: "", start_time: "08:00", end_time: "12:00" }, { staff_id: 2, full_name: "Ġorġ", designation: "locum", role_override: "", start_time: "15:00", end_time: "19:30" }], leave: [], locum_today: [], handover: null, board: null });
        const days = [base("2026-11-11", { open: "08:00", close: "19:30", closed: false, override: false }, null), base("2026-12-25", { open: "07:30", close: "19:30", closed: false, override: false }, "Christmas Day"), base("2026-12-08", { open: "09:00", close: "13:00", closed: false, override: true }, "Immaculate Conception")];
        return days.map((D) => ({ hub: T.items(D, { now: "00:01", admin: true }).filter((x) => /^gap:/.test(x.key)).map((x) => x.title).join(), cover: (T.cover(D).gaps || []).map((g) => "No pharmacist " + g.from + "\u2013" + g.to).join(), head: T.headText(D, "00:01") }));
      });
      t.ok(same[0].hub === "No pharmacist 12:00\u201315:00" && same[0].hub === same[0].cover, "weekly day: the hub's gap = E.teamCover's: " + JSON.stringify(same[0]));
      t.ok(same[1].hub === "" && /^Closed \u00B7 Public holiday \(Christmas Day\)\.$/.test(same[1].head), "public holiday: closed in E.teamCover's words, no gap: " + JSON.stringify(same[1]));
      t.ok(same[2].hub === "No pharmacist 12:00\u201313:00" && same[2].hub === same[2].cover && /^Open 09:00\u201313:00/.test(same[2].head), "a holiday the opening hours open: open, and its gap = E.teamCover's: " + JSON.stringify(same[2]));
    } else t.ok(!r1.rows.some((x) => /^gap:/.test(x.key)), "no E.teamCover in this build: no gap line drawn (T-C2 guard)");

    // one tap: Sign in opens the locum register
    await B.p.click('[data-tmt="pic"] button');
    await B.p.waitForFunction(() => ["locreg", "locumregister"].indexOf(window.EIKON.state.activeModuleId) >= 0, null, { timeout: 10000 });
    t.ok(true, "Sign in opened the locum register");
    // back within a minute: nothing asked again
    await t.idle(B.p); B.reqs.length = 0;
    await B.p.evaluate(() => { window.location.hash = "#team"; });
    await B.p.waitForSelector(".tmt-sum", { timeout: 10000 }); await t.idle(B.p);
    t.ok(!B.reqs.includes("/team/today"), "Team again within a minute asked nothing: " + JSON.stringify(B.reqs));

    // ---- signed in, the handover read on this device ("Got it", the Handover screen's key): both done
    await api("POST", "/locumregister/entries", { entry_date: today, time_in: "00:00", time_out: "23:59", locum_full_name: "Dr Ħelena Farrugia", registration_number: "P-1201" });
    const C = await look(A.token, { before: `try { localStorage.setItem("eikon_hnd_read_${rita}", JSON.stringify({ from: "${add(today, -1)}", ids: "tt_1,tt_2", at: new Date().toISOString() })); } catch (e) {}` }), r2 = await C.read();
    t.ok(by(r2, "pic").cls === "done" && /^Dr Ħelena Farrugia \(reg no P-1201\), since 00:00, until 23:59\.$/.test(by(r2, "pic").text) && r2.chips.locumregister === "In charge: Dr Ħelena Farrugia", "pharmacist in charge: " + JSON.stringify(by(r2, "pic")));
    t.ok(by(r2, "hnd").cls === "done" && r2.chips.instructions === "Read", "handover read on this device: " + JSON.stringify(by(r2, "hnd")));
    t.ok(r2.rows[0].cls === "todo", "nothing red left; to do first: " + r2.rows.map((x) => x.key + ":" + x.cls).join());

    // ---- staff: the same day, no leave requests (the pharmacist's), on a phone
    const D = await look(St.token, { phone: true }), r3 = await D.read();
    t.ok(!r3.rows.some((x) => x.key === "lv") && !r3.chips.shifts, "staff see no leave requests: " + JSON.stringify(r3.rows.map((x) => x.key)));
    t.ok(r3.who.length === 3 && by(r3, "hnd").cls === "todo", "staff see who is on and the handover (not read by them)");
    const wide = await D.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    t.ok(wide, "no sideways scroll on a phone");

    // ---- a real gap: the pharmacist goes home at 12:00 and comes back at 15:00 (the only pharmacist not on leave)
    if (r1.cover) {
      db.prepare("UPDATE shift_assignments SET end_time = '12:00' WHERE staff_id = ? AND shift_date = ?").run(ph, today);
      await api("POST", "/shifts/assignments", { staff_id: ph, shift_date: today, start_time: "15:00", end_time: "23:59", notes: "" });
      const G = await look(A.token);
      // the hub's clock at 09:00 Malta time, so the gap is still to come whenever the suite runs (Team draws again from what it read)
      await G.p.evaluate(() => { window.EIKON.maltaHm = () => "09:00"; window.location.hash = "#home"; });
      await G.p.waitForFunction(() => window.EIKON.state.activeModuleId !== "team", null, { timeout: 10000 });
      await G.p.evaluate(() => { window.location.hash = "#team"; });
      await G.p.waitForSelector('.tmt-row[data-tmt="gap:12:00"]', { timeout: 10000 });
      const g = (await G.read()).rows.find((x) => x.key === "gap:12:00") || {};
      t.ok(g.cls === "problem" && g.title === "No pharmacist 12:00\u201315:00" && /^Fill the gap/.test(g.btn), "a real gap on the rota: " + JSON.stringify(g));
      await G.p.click('[data-tmt="gap:12:00"] button');
      await G.p.waitForSelector("#shf-form", { timeout: 10000 });
      const f = await G.p.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, s: document.querySelector("#shf-form [name=start_time]").value, e: document.querySelector("#shf-form [name=end_time]").value, head: (document.querySelector(".shf-fillh") || {}).textContent || "" }));
      t.ok(f.mod === "shfreg" && f.s === "12:00" && f.e === "15:00" && /^Fill the gap 12:00\u201315:00/.test(f.head), "Fill the gap opens Plan shifts' fill form with the gap's hours: " + JSON.stringify(f));
    }
  }
};
