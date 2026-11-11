// Roster planner, filling (SPEC §2.5, §13 A8–A9, the grid side of A2–A5), on the real worker, from Plan shifts' grid:
//  F1 Fill… → Same days every week: Mon–Fri 08:00–14:00 for one person for 3 months, in 8 interactions; the preview's
//     count equals the rows stored, which are exactly the weekdays the pharmacy is open in that range (public holidays
//     skipped); one apply-pattern "fill" call with the classic per-date body;
//  F2 Keep (the default): a shift already there is kept as it is (same id), the day not filled again;
//  F3 Undo puts every row back as it was (the kept shift keeps its id), and says so;
//  F4 Selection (A9): Ctrl-click two people × non-contiguous days, Set hours: only those cells are written, a shift on a
//     day in between keeps its id;
//  F5 Clear the selection (Delete): asks with names, removes only those shifts; Undo puts them back;
//  F6 Copy this week to the next week (A8): rows = the source moved 7 days, notes and roles kept, the public holiday and
//     a day of approved leave skipped (said in the preview);
//  F7 Copy / paste one person's days onto another person with Ctrl+C / Ctrl+V;
//  F8 A failure: the second person's write answers 500: the first person's fill is kept with Undo offered, the
//     second's rows are as before, and the screen says so;
//  F9 Phone (390): Select → whose days → tick days → Set hours, 44 px controls, no sideways scroll.
// Its own people, 30+ weeks ahead, so no other case's rows or cover are touched.
import { maltaYmd, ymdAdd } from "../../clock.mjs";
const monday = (n) => { const t = maltaYmd(0); return ymdAdd(t, n * 7 - ((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7)); };
const monthsOn = (k, n) => { const d = new Date(k + "T12:00:00Z"); const x = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, d.getUTCDate())); x.setUTCDate(x.getUTCDate() - 1); return x.toISOString().slice(0, 10); };
const sig = (r) => [r.staff_id, r.shift_date, r.start_time, r.end_time, r.role_override || "", r.notes || ""].join("|");

export default {
  title: "Roster planner: fill weeks and months, select, copy, paste, clear, undo (grid)",
  async run(t) {
    const mk = async (n, d) => { const r = await t.api("POST", "/shifts/staff", { full_name: n, designation: d, employment_type: d === "locum" ? "external" : "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: "{}" }); return r.staff_id || r.id; };
    const A = await mk("Fill Marija Agius", "assistant"), B = await mk("Fill Ġużi Pharm", "pharmacist"), C = await mk("Fill Ċettina Cashier", "cashier");
    const add = async (sid, d, s, e, notes = "", role) => (await t.api("POST", "/shifts/assignments", role ? { staff_id: sid, shift_date: d, start_time: s, end_time: e, notes, role_override: role } : { staff_id: sid, shift_date: d, start_time: s, end_time: e, notes })).shift_id;
    const rowsOf = (sid, from, to) => t.db.prepare("SELECT * FROM shift_assignments WHERE staff_id = ? AND shift_date >= ? AND shift_date <= ? ORDER BY shift_date, start_time").all(sid, from, to);
    const writes = []; const track = (p) => p.on("request", (r) => { if (r.method() !== "GET" && /\/shifts\//.test(r.url())) writes.push({ m: r.method(), path: new URL(r.url()).pathname, body: r.postData() ? r.postDataJSON() : null }); });
    const p = await t.page(); track(p);
    await t.open(p, "2", "team", "team");
    let wk = 30; while (await p.evaluate((m) => [0, 1, 2, 3, 4, 5, 6].some((i) => { const d = new Date(m + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return !!window.EIKON.maltaHoliday(d.toISOString().slice(0, 10)); }), monday(wk))) wk++;
    const W = monday(wk), D = (i) => ymdAdd(W, i); // a week with no public holiday
    const kept = await add(A, D(2), "10:00", "12:00", "Ħal Qormi");   // F2: Wednesday already has a shift
    const openWeek = async (w) => { await p.evaluate((x) => { window.EIKON._shfWeek = x; location.hash = "#rotreg"; }, w); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "rotreg"); await p.evaluate((x) => { window.EIKON._shfWeek = x; location.hash = "#shfreg"; }, w); await p.waitForSelector('.shf-grid td.shf-c[data-date="' + w + '"]'); await t.idle(p); };
    await openWeek(W);

    // ---- F1: the 20-second task ----
    const to = monthsOn(W, 3), hours = (await t.api("GET", "/shifts/opening-hours")).hours, settings = (await t.api("GET", "/shifts/settings")).settings;
    const want = await p.evaluate(({ from, to, hours, settings }) => { const out = []; for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) { const k = d.toISOString().slice(0, 10), wd = d.getUTCDay(); if (wd === 0 || wd === 6) continue; if (window.EIKON.teamCover(k, { hours, settings, shifts: [], staff: [], leaves: [] }).closed) continue; out.push(k); } return out; }, { from: W, to, hours, settings });
    const hols = await p.evaluate(({ from, to }) => { const out = []; for (let d = new Date(from + "T12:00:00Z"); d.toISOString().slice(0, 10) <= to; d.setUTCDate(d.getUTCDate() + 1)) { const k = d.toISOString().slice(0, 10), wd = d.getUTCDay(); if (wd && wd < 6 && window.EIKON.maltaHoliday(k)) out.push(k); } return out; }, { from: W, to });
    writes.length = 0; let n = 0; const t0 = Date.now();
    await p.click("[data-act=fill-open]"); n++;
    await p.click("[data-act=dlg-step][data-v=days]"); n++;
    await p.selectOption(".shf-dlg [name=sid]", String(A)); n++;
    await p.fill(".shf-dlg [name=start]", "08:00"); n++;
    await p.fill(".shf-dlg [name=end]", "14:00"); n++;
    await p.click('[data-act=dlg-len][data-v="3m"]'); n++;
    await p.click(".shf-dlg button[type=submit]"); n++;
    await p.waitForSelector("[data-act=dlg-apply]:not([disabled])");
    const pv = await p.evaluate(() => ({ text: document.querySelector(".shf-pv").innerText.replace(/\s+/g, " "), btn: document.querySelector("[data-act=dlg-apply]").textContent, span: document.querySelector(".shf-dlg .s").textContent }));
    await p.click("[data-act=dlg-apply]"); n++;
    await p.waitForSelector(".shf-undo [data-act=undo]", { timeout: 15000 });
    const secs = (Date.now() - t0) / 1000, undoText = await p.textContent(".shf-undo span");
    const got = rowsOf(A, W, to), addedN = want.length - 1; // Wednesday of the first week is kept
    t.ok(n <= 8 && secs < 20, "F1 Mon–Fri 08:00–14:00 for 3 months in " + n + " interactions, " + secs.toFixed(1) + " s");
    t.ok(new RegExp("Adds " + addedN + " shifts · keeps 1 shift already planned · removes nothing").test(pv.text) && pv.btn === "Add " + addedN + " shifts" && (!hols.length || /public holiday/.test(pv.text)), "F1 the preview says what it will do (adds " + addedN + ", keeps 1, holidays skipped " + hols.length + "): " + JSON.stringify(pv));
    t.ok(got.length === want.length && got.every((r) => want.includes(r.shift_date)) && got.filter((r) => r.id !== kept).every((r) => r.start_time === "08:00" && r.end_time === "14:00" && r.notes === "" && (r.role_override || "") === ""), "F1 the rows are exactly the open weekdays from " + W + " to " + to + ": " + got.length + " of " + want.length);
    const ap = writes.filter((w) => w.path === "/shifts/apply-plan"), it = ap[0] && ap[0].body.items;
    t.ok(writes.length === 1 && ap.length === 1 && it.length === 1 && it[0].staff_id === A && it[0].remove.length === 0 && it[0].add.length === addedN && Object.keys(it[0].add[0]).join() === "date,start_time,end_time,role_override,notes" && it[0].seen.join() === String(kept), "F1 one one-step write (W1 apply-plan): " + addedN + " adds with the per-date body, nothing removed, the rows it saw: " + JSON.stringify(writes.map((w) => w.m + " " + w.path)));
    // ---- F2 ----
    const k0 = t.row("shift_assignments", kept);
    t.ok(k0 && k0.start_time === "10:00" && k0.notes === "Ħal Qormi" && rowsOf(A, D(2), D(2)).length === 1, "F2 the shift already there is kept as it was, and the day is not filled again");
    t.ok(new RegExp("^Added " + addedN + " shifts for Fill$").test(undoText), "F1 the undo line says what was done: " + undoText);
    // ---- F3: Undo ----
    writes.length = 0;
    await p.click(".shf-undo [data-act=undo]"); await p.waitForFunction(() => /^Undone/.test((document.querySelector(".shf-undo span") || {}).textContent || ""), null, { timeout: 15000 });
    const back = rowsOf(A, W, to);
    t.ok(back.length === 1 && back[0].id === kept && writes.length === 1 && writes[0].path === "/shifts/apply-plan" && writes[0].body.items[0].remove.length === addedN && writes[0].body.items[0].add.length === 0, "F3 Undo takes the whole fill off (by id, in one write); the shift that was there keeps its row (id " + kept + "): " + JSON.stringify({ left: back.map((r) => r.id), writes: writes.map((w) => w.path + " " + JSON.stringify(w.body).slice(0, 120)) }));

    // ---- F4: Ctrl-click two people × non-contiguous days, Set hours ----
    const mid = await add(B, D(1), "07:30", "12:00", "B Tue");    // a shift on a day in between, not selected
    await openWeek(W);
    const cellSel = (sid, d) => 'td.shf-c[data-sid="' + sid + '"][data-date="' + d + '"]';
    for (const [sid, d] of [[A, D(0)], [A, D(3)], [B, D(0)], [B, D(2)]]) await p.click(cellSel(sid, d), { modifiers: ["Control"], position: { x: 10, y: 36 } });
    const bar = await p.textContent("#shf-bar b");
    writes.length = 0;
    await p.click("[data-act=sel-hours]"); await p.fill(".shf-dlg [name=start]", "09:00"); await p.fill(".shf-dlg [name=end]", "13:00"); await p.click(".shf-dlg button[type=submit]");
    await p.waitForSelector("[data-act=dlg-apply]:not([disabled])"); await p.click("[data-act=dlg-apply]"); await p.waitForSelector(".shf-undo [data-act=undo]");
    const ra = rowsOf(A, D(0), D(6)), rb = rowsOf(B, D(0), D(6));
    t.ok(bar === "4 days · 2 people selected", "F4 the bar says what is selected: " + bar);
    t.ok(ra.map((r) => r.shift_date + " " + r.start_time).join() === [D(0) + " 09:00", D(2) + " 10:00", D(3) + " 09:00"].join() && rb.map((r) => r.shift_date + " " + r.start_time).join() === [D(0) + " 09:00", D(1) + " 07:30", D(2) + " 09:00"].join(), "F4 only the selected cells are written: " + JSON.stringify({ ra: ra.map((r) => r.shift_date + " " + r.start_time), rb: rb.map((r) => r.shift_date + " " + r.start_time) }));
    t.ok(rb.find((r) => r.shift_date === D(1)).id === mid && ra.find((r) => r.shift_date === D(2)).id === kept, "F4 untouched cells keep their rows (ids " + mid + ", " + kept + ")");
    t.ok(writes.length === 1 && writes[0].path === "/shifts/apply-plan" && writes[0].body.items.map((x) => x.staff_id + ":" + x.add.map((a) => a.date).join("+") + ":" + x.remove.length).join() === [A + ":" + D(0) + "+" + D(3) + ":0", B + ":" + D(0) + "+" + D(2) + ":0"].join(), "F4 one write, only the selected cells added, nothing removed: " + JSON.stringify(writes.map((w) => w.body)));

    // ---- F5: Clear with the keyboard; Undo ----
    const before5 = rowsOf(B, D(0), D(6)).map(sig);
    await p.focus(cellSel(B, D(0))); await p.keyboard.press("Shift+ArrowRight"); await p.keyboard.press("Shift+ArrowRight");
    writes.length = 0; await p.keyboard.press("Delete");
    await p.waitForSelector("[data-act=dlg-apply]:not([disabled])");
    const ask = await p.evaluate(() => ({ q: document.querySelector(".shf-pv").innerText.replace(/\s+/g, " "), btn: document.querySelector("[data-act=dlg-apply]").textContent }));
    await p.click("[data-act=dlg-apply]"); await p.waitForSelector(".shf-undo [data-act=undo]");
    const after5 = rowsOf(B, D(0), D(6));
    t.ok(/Remove 3 shifts \(Fill 3\)\?/.test(ask.q) && ask.btn === "Remove 3 shifts" && after5.length === 0 && writes.length === 1 && writes[0].body.items[0].remove.length === 3 && writes[0].body.items[0].add.length === 0, "F5 Delete asks first with the count by name, then removes only those: " + JSON.stringify({ ask, left: after5.length, writes: writes.map((w) => w.body) }));
    await p.click(".shf-undo [data-act=undo]"); await p.waitForFunction(() => /^Undone/.test((document.querySelector(".shf-undo span") || {}).textContent || ""), null, { timeout: 15000 });
    t.ok(JSON.stringify(rowsOf(B, D(0), D(6)).map(sig)) === JSON.stringify(before5), "F5 Undo puts the three back exactly (times, role, note)");

    // ---- F6: copy a week onto the next week: notes and roles kept; the holiday and a leave day skipped ----
    let hw = null; for (let w = 32; w < 90 && !hw; w++) { const m0 = monday(w); for (let i = 1; i < 5; i++) if (await p.evaluate((k) => window.EIKON.maltaHoliday(k), ymdAdd(m0, i))) { hw = { w, d: ymdAdd(m0, i) }; break; } }
    const S0 = monday(hw.w - 1), T0 = monday(hw.w);
    for (let i = 0; i < 5; i++) await add(C, ymdAdd(S0, i), "08:00", "13:00", i === 1 ? "Ċentru" : "", i === 2 ? "pharmacist" : undefined);
    const leaveDay = [1, 2, 3, 4].map((i) => ymdAdd(T0, i)).find((k) => k !== hw.d);
    const lv = await t.api("POST", "/shifts/leaves", { staff_id: C, leave_type: "annual", start_date: leaveDay, start_time: null, end_date: leaveDay, end_time: null, hours_requested: 8, reason: "", status: "pending" }); await t.api("POST", "/shifts/leaves/" + lv.leave_id + "/approve");
    await openWeek(S0);
    await p.click("[data-act=fill-open]"); await p.click("[data-act=dlg-step][data-v=copy]");
    await p.click('[data-act=dlg-who][data-v=one]'); await p.selectOption(".shf-dlg [name=sid]", String(C));
    await p.fill(".shf-dlg [name=times]", "1"); writes.length = 0;
    await p.click(".shf-dlg button[type=submit]"); await p.waitForSelector("[data-act=dlg-apply]:not([disabled])").catch(async (e) => { throw new Error("F6 no preview: " + (await p.evaluate(() => (document.querySelector(".shf-dlg") || document.querySelector(".shf-msg") || {}).innerText))); });
    const pv6 = await p.evaluate(() => document.querySelector(".shf-pv").innerText.replace(/\s+/g, " "));
    await p.click("[data-act=dlg-apply]"); await p.waitForSelector(".shf-undo [data-act=undo]");
    const src = rowsOf(C, S0, ymdAdd(S0, 6)), dst = rowsOf(C, T0, ymdAdd(T0, 6));
    const exp = src.map((r) => ({ ...r, shift_date: ymdAdd(r.shift_date, 7) })).filter((r) => r.shift_date !== hw.d && r.shift_date !== leaveDay);
    t.ok(JSON.stringify(dst.map(sig)) === JSON.stringify(exp.map(sig)), "F6 the copy is the source moved 7 days, notes and roles kept, " + hw.d + " (holiday) and " + leaveDay + " (leave) skipped: " + JSON.stringify(dst.map(sig)));
    t.ok(/Adds 3 shifts/.test(pv6) && /public holiday/.test(pv6) && /1 day of leave/.test(pv6), "F6 the preview says why two days are skipped: " + pv6);

    // ---- F7: copy a person's two days, paste them onto another person a week later (keyboard) ----
    await openWeek(T0);
    await p.focus(cellSel(C, ymdAdd(T0, 0))); await p.keyboard.press("Shift+ArrowRight"); await p.keyboard.press("Control+c");
    await p.focus(cellSel(A, ymdAdd(T0, 0))); writes.length = 0; await p.keyboard.press("Control+v");
    await p.waitForSelector("[data-act=dlg-apply]:not([disabled])"); await p.click("[data-act=dlg-apply]"); await p.waitForSelector(".shf-undo [data-act=undo]");
    const pa = rowsOf(A, T0, ymdAdd(T0, 1)).map((r) => r.shift_date + " " + r.start_time + "–" + r.end_time + " " + r.notes), pc = rowsOf(C, T0, ymdAdd(T0, 1)).filter((r) => r.shift_date !== hw.d && r.shift_date !== leaveDay).map((r) => r.shift_date + " " + r.start_time + "–" + r.end_time + " " + r.notes);
    t.ok(pa.join() === pc.join() && pa.length >= 1, "F7 Ctrl+C / Ctrl+V pastes the copied days onto the other person: " + JSON.stringify({ pa, pc }));

    // ---- F8: the write fails (500): nothing is changed for anyone, said in the preview, the button there to try again ----
    const W8 = ymdAdd(W, 70), a8b = rowsOf(A, W8, monthsOn(W8, 1)).map(sig), c8b = rowsOf(C, W8, monthsOn(W8, 1)).map(sig);
    await openWeek(W8);
    let calls = 0; await p.route(/\/shifts\/apply-(plan|pattern)$/, (r) => { calls++; return r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"Server busy"}' }); });
    await p.click("[data-act=fill-open]"); await p.click("[data-act=dlg-step][data-v=days]"); await p.click('[data-act=dlg-who][data-v=some]');
    await p.check('.shf-dlg [name=sids][value="' + A + '"]'); await p.check('.shf-dlg [name=sids][value="' + C + '"]');
    await p.fill(".shf-dlg [name=start]", "08:00"); await p.fill(".shf-dlg [name=end]", "12:00"); await p.click('[data-act=dlg-len][data-v="1m"]');
    await p.click(".shf-dlg button[type=submit]"); await p.waitForSelector("[data-act=dlg-apply]:not([disabled])"); await p.click("[data-act=dlg-apply]");
    await p.waitForSelector(".shf-dlg .shf-err", { timeout: 15000 }); await p.unroute(/\/shifts\/apply-(plan|pattern)$/);
    const w8 = await p.evaluate(() => ({ err: document.querySelector(".shf-dlg .shf-err").textContent, focus: document.activeElement.getAttribute("data-act") }));
    t.ok(/^Nothing was changed — /.test(w8.err) && /Server busy/.test(w8.err) && w8.focus === "dlg-apply" && calls >= 1 && JSON.stringify(rowsOf(A, W8, monthsOn(W8, 1)).map(sig)) === JSON.stringify(a8b) && JSON.stringify(rowsOf(C, W8, monthsOn(W8, 1)).map(sig)) === JSON.stringify(c8b), "F8 a failed write changes nothing for either person, says so in the preview, focus on the button to try again: " + JSON.stringify(w8));
    await p.click("[data-act=dlg-close]");

    // ---- F10: approving part-day leave changes the shift it touches (B3's trim: the classic whole-record PUT) ----
    const W10 = ymdAdd(W, 7 * 9), d10 = ymdAdd(W10, 1), s10 = await add(A, d10, "08:00", "14:00", "Trim me");
    const l10 = await t.api("POST", "/shifts/leaves", { staff_id: A, leave_type: "annual", start_date: d10, start_time: "08:00", end_date: d10, end_time: "12:00", hours_requested: 4, reason: "", status: "pending" });
    await openWeek(W10);
    const line10 = await p.evaluate(() => { const b = document.querySelector("[data-act=lv-open]"); return b && { text: b.textContent, exp: b.getAttribute("aria-expanded") }; }); // far-off requests wait on one calm line
    await p.click("[data-act=lv-open]"); await p.waitForSelector('[data-act=lv-approve][data-id="' + l10.leave_id + '"]');
    t.ok(line10 && /leave requests?: .*Fill \(annual /.test(line10.text) && line10.exp === "false", "F10 leave requests that start later wait on one line that opens them: " + JSON.stringify(line10));
    writes.length = 0; await p.click('[data-act=lv-approve][data-id="' + l10.leave_id + '"]'); await p.waitForSelector("[data-act=lv-trim]");
    const q10 = await p.textContent(".shf-lv .q"); await p.click("[data-act=lv-trim]"); await p.waitForFunction((id) => !document.querySelector('[data-act=lv-approve][data-id="' + id + '"]'), l10.leave_id, { timeout: 8000 });
    await p.waitForTimeout(300); const r10 = t.row("shift_assignments", s10);
    t.ok(/becomes 12:00–14:00/.test(q10) && r10 && r10.start_time === "12:00" && r10.end_time === "14:00" && r10.notes === "Trim me" && writes.map((w) => w.m + " " + w.path.replace(/\d+/g, ":id")).join() === "POST /shifts/leaves/:id/approve,PUT /shifts/assignments/:id" && Object.keys(writes[1].body).join() === "id,staff_id,shift_date,start_time,end_time,role_override,notes", "F10 part-day leave approved: asked first, then the shift is shortened with the whole-record PUT: " + JSON.stringify({ q10, r10: r10 && [r10.start_time, r10.end_time], writes: writes.map((w) => w.m + " " + w.path) }));

    // ---- F11 / F12: the Steve-Jobs timings: an alternate-Saturday rotation for a year, a week copied to the next 4 ----
    const W11 = ymdAdd(W, 7 * 11); await openWeek(W11); let n11 = 0; const t11 = Date.now();
    await p.click("[data-act=fill-open]"); n11++; await p.click("[data-act=dlg-step][data-v=rota]"); n11++;
    await p.selectOption(".shf-dlg [data-k=rotasid]", String(B)); n11++;
    const ed = (x) => p.click("#shf-rp-ed " + x);
    await ed('[data-act=work][data-d="0"]'); n11++; await ed("[data-act=mf]"); n11++; await ed("[data-act=addwk]"); n11++; await ed('[data-act=work][data-d="5"]'); n11++;
    await ed("[data-act=save]"); n11++; await p.waitForSelector("#shf-rp-ed [data-act=apply]"); await ed("[data-act=apply]"); n11++;
    await p.waitForSelector("[data-act=dlg-apply]:not([disabled])"); await p.click("[data-act=dlg-apply]"); n11++; await p.waitForSelector(".shf-undo [data-act=undo]");
    const s11 = (Date.now() - t11) / 1000, sats = rowsOf(B, W11, monthsOn(W11, 12)).filter((r) => new Date(r.shift_date + "T12:00:00Z").getUTCDay() === 6).map((r) => r.shift_date);
    t.ok(n11 <= 10 && s11 < 30 && sats.length > 20 && sats.every((d, i) => i === 0 || (Date.parse(d) - Date.parse(sats[i - 1])) / 864e5 % 14 === 0), "F11 the usual week as a rotation (Mon–Fri, Saturdays every other week) set and put on the rota for a year: " + n11 + " interactions, " + s11.toFixed(1) + " s; Saturdays every other week (" + sats.length + ")");
    const W12 = ymdAdd(W, 7 * 70); for (let i = 0; i < 3; i++) await add(C, ymdAdd(W12, i), "09:00", "15:00", i ? "" : "Copy me");
    await openWeek(W12); let n12 = 0; const t12 = Date.now();
    await p.click("[data-act=fill-open]"); n12++; await p.click("[data-act=dlg-step][data-v=copy]"); n12++; await p.click(".shf-dlg button[type=submit]"); n12++;
    await p.waitForSelector("[data-act=dlg-apply]:not([disabled])"); await p.click("[data-act=dlg-apply]"); n12++; await p.waitForSelector(".shf-undo [data-act=undo]");
    const c12 = [1, 2, 3, 4].map((k) => rowsOf(C, ymdAdd(W12, 7 * k), ymdAdd(W12, 7 * k + 6)).length);
    t.ok(n12 <= 4 && c12.every((x) => x >= 2), "F12 this week copied to the next 4 weeks in " + n12 + " interactions, " + ((Date.now() - t12) / 1000).toFixed(1) + " s: " + JSON.stringify(c12));

    // ---- F13: + A new locum… in one step: the classic "Locum shift" person body (C:1855), then + Add shift's body ----
    const W13 = ymdAdd(W, 7 * 13); await openWeek(W13);
    await p.click('.shf-add[data-act=add][data-date="' + ymdAdd(W13, 2) + '"]'); await p.waitForSelector("#shf-form");
    await p.selectOption("#shf-form [name=staff_id]", "new"); await p.waitForSelector("#shf-form [name=lc_name]");
    await t.fill(p, "#shf-form", { lc_name: "Fill Ġużeppi Locum", lc_phone: "79123456", lc_reg: "P-9913", start_time: "14:00", end_time: "19:30" });
    writes.length = 0; let m13 = t.maxId("shift_staff");
    await t.write(p, /\/shifts\/assignments$/, () => p.click("#shf-form button[type=submit]")); await p.waitForFunction(() => !document.querySelector("#shf-form"), null, { timeout: 8000 });
    const lp = t.since("shift_staff", m13, { full_name: "Fill Ġużeppi Locum" })[0], body13 = writes.filter((w) => w.path === "/shifts/staff")[0];
    m13 = t.maxId("shift_staff"); await t.api("POST", "/shifts/staff", { full_name: "Fill Ġużeppi Locum 2", designation: "locum", employment_type: "external", contracted_hours: 40, email: "", phone: "79123456", registration_number: "P-9913", is_active: 1, patterns_json: "{\"patterns\":[],\"provisionalId\":null}" });
    t.same("new locum (one step) vs classic Locum shift", t.since("shift_staff", m13)[0], lp, { full_name: "another name" });
    const sh13 = lp && t.db.prepare("SELECT * FROM shift_assignments WHERE staff_id = ?").all(lp.id);
    t.ok(body13 && Object.keys(body13.body).join() === "full_name,designation,employment_type,contracted_hours,email,phone,registration_number,is_active,patterns_json" && sh13 && sh13.length === 1 && sh13[0].start_time === "14:00" && writes.map((w) => w.path).join() === "/shifts/staff,/shifts/assignments", "F13 the locum and the shift in one step, classic key order: " + JSON.stringify({ keys: body13 && Object.keys(body13.body), rows: sh13 && sh13.length, writes: writes.map((w) => w.path) }));

    // ---- F14: keyboard-only grid walk: Enter opens a cell, Escape closes it and focus is back on the cell ----
    await p.focus('td.shf-c[data-sid="' + A + '"][data-date="' + ymdAdd(W13, 0) + '"]'); await p.keyboard.press("ArrowRight"); await p.keyboard.press("ArrowDown"); await p.keyboard.press("ArrowUp");
    const at = await p.evaluate(() => document.activeElement.getAttribute("data-date")); await p.keyboard.press("Enter"); await p.waitForSelector("#shf-form");
    const inForm = await p.evaluate(() => !!document.activeElement.closest("#shf-form")); await p.keyboard.press("Escape"); await p.waitForTimeout(100);
    const back14 = await p.evaluate(() => ({ td: document.activeElement.matches("td.shf-c"), sid: document.activeElement.getAttribute("data-sid"), d: document.activeElement.getAttribute("data-date"), form: !!document.querySelector("#shf-form") }));
    t.ok(at === ymdAdd(W13, 1) && inForm && back14.td && back14.d === at && back14.sid === String(A) && !back14.form, "F14 arrows move, Enter opens the cell's form (focus in it), Escape closes it with focus back on the cell: " + JSON.stringify({ at, inForm, back14 }));

    // ---- F9: the phone ----
    const ph = await t.page({ phone: true }); writes.length = 0; track(ph);
    let w9 = 14; while (await p.evaluate((m) => [1, 3].some((i) => { const d = new Date(m + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + i); return !!window.EIKON.maltaHoliday(d.toISOString().slice(0, 10)); }), ymdAdd(W, w9 * 7))) w9++;
    const W9 = ymdAdd(W, w9 * 7);
    await t.open(ph, "2", "team", "team");
    await ph.evaluate((x) => { window.EIKON._shfWeek = x; location.hash = "#rotreg"; }, W9); await ph.waitForFunction(() => window.EIKON.state.activeModuleId === "rotreg");
    await ph.evaluate((x) => { window.EIKON._shfWeek = x; location.hash = "#shfreg"; }, W9); await ph.waitForSelector("[data-act=pick]"); await t.idle(ph);
    await ph.click("[data-act=pick]"); await ph.selectOption('[data-k=pickwho]', String(A));
    await ph.check('input[data-tick=pd][data-date="' + ymdAdd(W9, 1) + '"]'); await ph.check('input[data-tick=pd][data-date="' + ymdAdd(W9, 3) + '"]');
    const sz = await ph.evaluate(() => ({ w: document.documentElement.scrollWidth, small: [...document.querySelectorAll(".shf-bar button, .shf-bar select, .shf-tools button, .shf-tools select, .shf-nav button")].filter((b) => b.getBoundingClientRect().height < 44).map((b) => b.textContent) }));
    await ph.click("[data-act=sel-hours]"); await ph.fill(".shf-dlg [name=start]", "15:00"); await ph.fill(".shf-dlg [name=end]", "19:00");
    await ph.click(".shf-dlg button[type=submit]"); await ph.waitForSelector("[data-act=dlg-apply]:not([disabled])"); await ph.click("[data-act=dlg-apply]"); await ph.waitForSelector(".shf-undo [data-act=undo]");
    const r9 = rowsOf(A, W9, ymdAdd(W9, 6)).map((r) => r.shift_date + " " + r.start_time);
    t.ok(r9.join() === [ymdAdd(W9, 1) + " 15:00", ymdAdd(W9, 3) + " 15:00"].join() && sz.w <= 390 && !sz.small.length, "F9 phone: Select, whose days, tick two days, Set hours writes those two; controls 44 px, no sideways scroll: " + JSON.stringify({ r9, sz }));
  }
};
