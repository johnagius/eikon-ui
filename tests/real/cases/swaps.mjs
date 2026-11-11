// Swaps (Team round 2): swap two shifts on two different days of the week in one step, from Plan shifts or Who's in.
//  S1 the rows after a swap across two days equal the same moves made by hand in Plan shifts (Remove shift, + Add shift
//     for the other person, Save for a role of their own): + Add shift's body; each person keeps their own note and
//     role (the one rule, same day or not); the bodies sent equal the hand-made ones;
//  S2 a write that fails (each of the five, one at a time) leaves both days as they were and says "Nothing was changed";
//     an undo that fails too says exactly who is on which day now;
//  S3 approved leave on the other day, or a shift that overlaps there: the choice is greyed out with the reason;
//  S4 a swap that opens a pharmacist gap says it in E.teamCover's words, nothing written until "Swap anyway";
//  S5 a swap on one day is still the two whole-record changes of round 1;
//  S6 Who's in → Plan shifts on that week with "Swap with" ready; Escape steps back, then closes, focus returns;
//  S7 on a phone (390) the same flow, 44 px buttons, no sideways scroll.
// Weeks twelve and thirteen ahead, so no other case's shifts touch its cover.
import { maltaYmd, ymdAdd } from "../../clock.mjs";
const monday = (n) => { const t = maltaYmd(0); return ymdAdd(t, n * 7 - ((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7)); };
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"], DW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const dw = (d) => { const x = new Date(d + "T12:00:00Z"); return DW[x.getUTCDay()] + " " + x.getUTCDate() + " " + MONS[x.getUTCMonth()]; };

export default {
  title: "Swaps: two shifts on two days in one step (same writes as by hand, undone on failure)",
  async run(t) {
    const W = monday(12), E = (i) => ymdAdd(W, i), W3 = monday(13), F = (i) => ymdAdd(W3, i);
    const mk = async (n, d) => { const r = await t.api("POST", "/shifts/staff", { full_name: n, designation: d, employment_type: d === "locum" ? "external" : "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: "{}" }); return r.staff_id || r.id; };
    const P = await mk("Swap Ġorġ Pharm", "pharmacist"), Q = await mk("Swap Marija Pharm", "pharmacist"), A = await mk("Swap Żaren Assistant", "assistant"), L = await mk("Swap Helena Locum", "locum");
    const add = async (sid, d, s, e, notes = "", role) => (await t.api("POST", "/shifts/assignments", role ? { staff_id: sid, shift_date: d, start_time: s, end_time: e, notes, role_override: role } : { staff_id: sid, shift_date: d, start_time: s, end_time: e, notes })).shift_id;
    const sx = await add(P, E(0), "07:30", "13:30", "Ċentru"), sy = await add(A, E(2), "13:30", "19:30", "Ħal Qormi", "manager");   // swapped on screen
    const hx = await add(P, E(1), "07:30", "13:30", "Ċentru"), hy = await add(A, E(3), "13:30", "19:30", "Ħal Qormi", "manager");   // the same, by hand
    const f1 = await add(A, E(4), "15:00", "19:00", "F1", "manager"), f2 = await add(L, E(5), "15:00", "19:00", "F2");             // failures
    const lv = await t.api("POST", "/shifts/leaves", { staff_id: L, leave_type: "annual", start_date: F(1), start_time: null, end_date: F(1), end_time: null, hours_requested: 8, reason: "", status: "pending" });
    await t.api("POST", "/shifts/leaves/" + lv.leave_id + "/approve");
    const qa = await add(Q, F(1), "08:00", "12:00"), la = await add(L, F(2), "08:00", "12:00");                                  // S3 leave
    const qb = await add(Q, F(3), "08:00", "12:00"), pb = await add(P, F(4), "10:00", "14:00"); await add(Q, F(4), "09:00", "11:00"); // S3 overlap
    const da = await add(P, F(0), "07:30", "13:30", "Ċentru"), db = await add(A, F(0), "13:30", "19:30", "Ħal Qormi");           // S5 same day
    const writes = []; const track = (p) => p.on("request", (r) => { if (r.method() !== "GET" && /\/shifts\/assignments/.test(r.url())) writes.push({ m: r.method(), path: new URL(r.url()).pathname, body: r.postData() ? r.postDataJSON() : null }); });
    const row = (sid, d) => t.db.prepare("SELECT * FROM shift_assignments WHERE staff_id = ? AND shift_date = ?").get(sid, d);
    const snap = (...ds) => ds.map((d) => t.db.prepare("SELECT staff_id, shift_date, start_time, end_time, role_override, notes FROM shift_assignments WHERE shift_date = ? ORDER BY staff_id, start_time").all(d));

    // ---- S6 + S1 + S4: from Who's in (desktop) ----
    const p = await t.page(); track(p);
    await t.open(p, "2", "team", "team");
    await p.evaluate((w) => { window.EIKON._rotWeek = w; location.hash = "#rotreg"; }, W);
    await p.waitForSelector('.rot-grid button[data-act=swap][data-id="' + sx + '"]'); await t.idle(p);
    t.ok(/Tap a shift to swap it/.test(await p.textContent(".rot-hint")), "Who's in says, under the week, that a shift can be tapped to swap it");
    const lab = await p.getAttribute('.rot-grid button[data-act=swap][data-id="' + sx + '"]', "aria-label");
    t.ok(/^Swap Swap Ġorġ Pharm’s shift, Monday \d+ \w+, 07:30 to 13:30$/.test(lab), "the shift button says what it does: " + lab);
    await p.click('.rot-grid button[data-act=swap][data-id="' + sx + '"]');
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && document.activeElement && document.activeElement.name === "swap_with", null, { timeout: 8000 }).then(() => t.ok(true), () => t.fail("S6 Who's in → Plan shifts with Swap with ready and focused"));
    const og = await p.evaluate(() => [...document.querySelectorAll("#shf-form [name=swap_with] optgroup")].map((g) => g.label + ": " + [...g.children].map((o) => o.textContent).join(", ")));
    t.ok(og.some((g) => /^Wednesday /.test(g) && g.includes(dw(E(2)) + " · Swap Żaren Assistant 13:30–19:30")) && !og.some((g) => /Swap Ġorġ Pharm/.test(g)), "the other people's shifts of the week, a group per day, each saying its day: " + JSON.stringify(og));
    // Escape: first back to the shift, then closed, focus on the shift's row
    await p.keyboard.press("Escape"); const e1 = await p.evaluate(() => !!document.querySelector("#shf-form") && !document.querySelector("#shf-form [name=swap_with]"));
    await p.keyboard.press("Escape"); await p.waitForTimeout(80);
    const e2 = await p.evaluate((id) => !document.querySelector("#shf-form") && document.activeElement && document.activeElement.getAttribute("data-id") === String(id), sx);
    t.ok(e1 && e2 && writes.length === 0, "S6 Escape steps back to the shift, then closes it with focus on its row, nothing written: " + JSON.stringify({ e1, e2, writes: writes.length }));
    await p.click('.shf-p[data-act=edit][data-id="' + sx + '"]'); await p.click("#shf-form [data-act=swap]");
    await p.selectOption("#shf-form [name=swap_with]", String(sy)); await p.waitForTimeout(100);
    const q = await p.evaluate(() => ({ text: document.querySelector(".shf-swq").textContent, btn: document.querySelector("[data-act=swap-yes]").textContent }));
    const rows0 = (await t.api("GET", "/shifts/assignments-range?from=" + E(0) + "&to=" + E(6))).shifts, staff = (await t.api("GET", "/shifts/staff?include_inactive=1")).staff;
    const words = await p.evaluate(({ rows, staff, sx, sy, A, P, d }) => window.EIKON.teamCover(d, { hours: null, settings: null, shifts: rows.map((x) => x.id === sx ? { ...x, staff_id: A, role_override: "manager" } : x.id === sy ? { ...x, staff_id: P, role_override: "" } : x), staff, leaves: [] }).words, { rows: rows0, staff, sx, sy, A, P, d: E(0) });
    t.ok(q.text === "Swap Ġorġ Pharm works " + dw(E(2)) + " 13:30–19:30 and Swap Żaren Assistant works " + dw(E(0)) + " 07:30–13:30. This leaves " + words.replace(/^No/, "no") + " on " + dw(E(0)) + "." && /07:30–19:30/.test(words) && q.btn === "Swap anyway",
      "S4 one sentence: who works when on the two days, and the gap in E.teamCover's words (" + words + "): " + JSON.stringify(q));
    t.ok(writes.length === 0, "S4 nothing written before Swap anyway");
    await p.click("[data-act=swap-yes]"); await p.waitForFunction(() => !document.querySelector("#shf-form"), null, { timeout: 8000 });
    const nA = row(A, E(0)), nP = row(P, E(2));
    await p.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute("data-id") === String(id), nA.id, { timeout: 4000 }).then(() => t.ok(true), async () => t.fail("after the swap, focus is on the shift it started from (now Żaren's): " + await p.evaluate(() => document.activeElement && document.activeElement.outerHTML.slice(0, 120))));
    t.ok(writes.map((w) => w.m).join() === "POST,PUT,POST,DELETE,DELETE" && writes[3].path.endsWith("/" + sx) && writes[4].path.endsWith("/" + sy), "S1 two adds (and Save's record for the role), then the two removes: " + JSON.stringify(writes.map((w) => w.m + " " + w.path)));
    t.ok(!t.row("shift_assignments", sx) && !t.row("shift_assignments", sy), "S1 the two old shifts are removed");
    // by hand in Plan shifts: Remove shift, + Add shift for the other person (with their note), Save for their role
    const hand = [];
    hand.push({ m: "POST", body: { staff_id: A, shift_date: E(1), start_time: "07:30", end_time: "13:30", notes: "Ħal Qormi" } }); const hA = await add(A, E(1), "07:30", "13:30", "Ħal Qormi");
    hand.push({ m: "PUT", body: { id: hA, staff_id: A, shift_date: E(1), start_time: "07:30", end_time: "13:30", role_override: "manager", notes: "Ħal Qormi" } }); await t.api("PUT", "/shifts/assignments/" + hA, hand[1].body);
    hand.push({ m: "POST", body: { staff_id: P, shift_date: E(3), start_time: "13:30", end_time: "19:30", notes: "Ċentru" } }); const hP = await add(P, E(3), "13:30", "19:30", "Ċentru");
    await t.api("DELETE", "/shifts/assignments/" + hx); await t.api("DELETE", "/shifts/assignments/" + hy);
    const strip = (b) => { const c = { ...b }; delete c.shift_date; delete c.id; return JSON.stringify(c); };
    t.ok([0, 1, 2].every((i) => strip(writes[i].body) === strip(hand[i].body)) && Object.keys(writes[0].body).join() === "staff_id,shift_date,start_time,end_time,notes" && writes[1].body.id === nA.id,
      "S1 the bodies sent = the hand-made ones (but the day): " + JSON.stringify(writes.slice(0, 3).map((w) => w.body)));
    t.same("S1 swap across days (assistant)", t.row("shift_assignments", hA), nA, { shift_date: "another day" });
    t.same("S1 swap across days (pharmacist)", t.row("shift_assignments", hP), nP, { shift_date: "another day" });
    t.ok(nA.notes === "Ħal Qormi" && nA.role_override === "manager" && nP.notes === "Ċentru" && nP.role_override === "", "S1 each person keeps their own note and role: " + JSON.stringify([nA.notes, nA.role_override, nP.notes, nP.role_override]));
    await p.waitForFunction((d) => { const g = document.querySelector('.shf-gap[data-date="' + d + '"]'); return g && /07:30–19:30/.test(g.textContent); }, E(0), { timeout: 5000 }).then(() => t.ok(true), () => t.fail("Monday's gap line shows the new gap after the swap (the two days read again)"));

    // ---- S2: each write fails in turn; then an undo that fails too ----
    const ROUTE = /\/shifts\/assignments(\/\d+)?$/;
    const attempt = async (mine, other, fail) => {
      writes.length = 0; let n = 0;
      await p.route(ROUTE, (r) => { const rq = r.request(); if (rq.method() === "GET") return r.fallback(); n++; return fail(rq, n) ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":false,"error":"Server busy"}' }) : r.fallback(); });
      const id = await p.evaluate(({ d, s }) => { const b = [...document.querySelectorAll(".shf-p[data-act=edit]")].find((x) => x.closest("section, td.shf-c").getAttribute("aria-label").includes(d) && x.textContent.includes(s)); return b && b.getAttribute("data-id"); }, mine);
      await p.click('.shf-p[data-act=edit][data-id="' + id + '"]'); await p.click("#shf-form [data-act=swap]");
      await p.selectOption("#shf-form [name=swap_with]", String(other())); await p.waitForTimeout(80);
      await p.click("[data-act=swap-yes]");
      await p.waitForSelector("#shf-form .shf-err, .shf-msg", { timeout: 8000 }).catch(async (e) => { throw new Error(e.message.split("\n")[0] + " " + JSON.stringify(writes.map((w) => w.m + " " + w.path))); });
      const out = await p.evaluate(() => { const e = document.querySelector("#shf-form .shf-err, .shf-msg"); return { err: e.textContent, top: e.classList.contains("shf-msg"), focus: document.activeElement && (document.activeElement.getAttribute("data-act") || document.activeElement.className) }; });
      await p.unroute(ROUTE);
      out.writes = writes.map((w) => w.m); if (!out.top) { await p.click("#shf-form [data-act=swap-no]"); await p.click("#shf-form [data-act=cancel]"); }
      return out;
    };
    const fDay = (d) => { const x = new Date(d + "T12:00:00Z"); return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][x.getUTCDay()] + " " + x.getUTCDate() + " " + MONS[x.getUTCMonth()]; };
    const otherF2 = () => t.db.prepare("SELECT id FROM shift_assignments WHERE staff_id = ? AND shift_date = ? AND notes = 'F2'").get(L, E(5)).id;
    const before = JSON.stringify(snap(E(4), E(5)));
    for (let k = 1; k <= 5; k++) {
      const o = await attempt({ d: fDay(E(4)), s: "15:00–19:00" }, otherF2, (rq, n) => n === k);
      const after = JSON.stringify(snap(E(4), E(5)));
      t.ok(o.err === "Nothing was changed — Not saved: Server busy." && after === before && o.focus === "swap-yes", "S2 write " + k + " of 5 fails (" + o.writes.join() + "): both days as they were, told plainly, focus on Swap: " + JSON.stringify({ err: o.err, focus: o.focus, same: after === before }));
    }
    // the last remove fails and so does putting the removed shift back
    const o2 = await attempt({ d: fDay(E(4)), s: "15:00–19:00" }, otherF2, (rq, n) => (rq.method() === "DELETE" && n === 5) || (rq.method() === "POST" && n > 5));
    t.ok(o2.err === "Only part of the swap went through, and it could not be put back: Swap Żaren Assistant is now on neither day; Swap Helena Locum is now on " + dw(E(5)) + " 15:00–19:00. Remove or add one here so each day is right.", "S2 an undo that fails too says exactly who is on which day now: " + o2.err);
    t.ok(o2.top && /shf-msg/.test(o2.focus), "S2 … above the week (that shift is gone), with focus on it: " + JSON.stringify(o2));
    t.ok(!t.db.prepare("SELECT id FROM shift_assignments WHERE staff_id = ? AND shift_date IN (?, ?)").get(A, E(4), E(5)) && row(L, E(5)) && !row(L, E(4)), "S2 … and that is what the rows say");

    // ---- S3: leave on the other day, or an overlap there: blocked, nothing written ----
    await p.evaluate((w) => { window.EIKON._shfWeek = w; location.hash = "#rotreg"; }, W3); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "rotreg");
    await p.evaluate((w) => { window.EIKON._shfWeek = w; location.hash = "#shfreg"; }, W3);
    await p.waitForSelector('.shf-p[data-act=edit][data-id="' + qa + '"]'); await t.idle(p); writes.length = 0;
    const block = async (mine, other) => {
      await p.click('.shf-p[data-act=edit][data-id="' + mine + '"]'); await p.click("#shf-form [data-act=swap]");
      const r = await p.evaluate((id) => { const o = document.querySelector('#shf-form [name=swap_with] option[value="' + id + '"]'); return { text: o.textContent, off: o.disabled, btn: document.querySelector("[data-act=swap-yes]").disabled }; }, other);
      await p.keyboard.press("Escape"); await p.keyboard.press("Escape"); return r;
    };
    const b1 = await block(qa, la), b2 = await block(qb, pb);
    t.ok(b1.text === dw(F(2)) + " · Swap Helena Locum 08:00–12:00 · on leave " + dw(F(1)) && b1.off && b1.btn, "S3 approved leave on the other day: that choice greyed out with the reason: " + JSON.stringify(b1));
    t.ok(b2.text === dw(F(4)) + " · Swap Ġorġ Pharm 10:00–14:00 · Swap already works then" && b2.off && b2.btn, "S3 an overlapping shift on the other day: greyed out with the reason: " + JSON.stringify(b2));
    t.ok(writes.length === 0, "S3 nothing written");

    // ---- S5: the same day is still round 1's two whole-record changes ----
    await p.click('.shf-p[data-act=edit][data-id="' + da + '"]'); await p.click("#shf-form [data-act=swap]"); await p.selectOption("#shf-form [name=swap_with]", String(db)); await p.waitForTimeout(80);
    const og5 = await p.evaluate(() => document.querySelector("#shf-form [name=swap_with] optgroup").label);
    await p.click("[data-act=swap-yes]"); await p.waitForFunction(() => !document.querySelector("#shf-form"), null, { timeout: 8000 });
    t.ok(og5 === "Same day" && writes.map((w) => w.m).join() === "PUT,PUT" && Object.keys(writes[0].body).join() === "id,staff_id,shift_date,start_time,end_time,role_override,notes" && writes[0].body.notes === "Ċentru" && writes[0].body.start_time === "13:30", "S5 same day: two whole-record PUTs as in round 1: " + JSON.stringify(writes.map((w) => w.body)));

    // ---- S7: the phone ----
    const ph = await t.page({ phone: true }); writes.length = 0; track(ph);
    await t.open(ph, "2", "team", "team");
    await ph.evaluate((w) => { window.EIKON._rotWeek = w; location.hash = "#rotreg"; }, W3);
    await ph.waitForSelector(".rot-week .rot-p[data-act=swap]"); await t.idle(ph);
    if (await ph.$(".rot-past[aria-expanded=false]")) await ph.click(".rot-past");
    const rp = await ph.evaluate((id) => { const b = document.querySelector('.rot-week button.rot-p[data-id="' + id + '"]'); const r = b.getBoundingClientRect(); return { h: r.height, w: document.documentElement.scrollWidth }; }, qb);
    await ph.click('.rot-week button.rot-p[data-id="' + qb + '"]');
    await ph.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && document.activeElement && document.activeElement.name === "swap_with", null, { timeout: 8000 });
    const lb = t.db.prepare("SELECT id FROM shift_assignments WHERE staff_id = ? AND shift_date = ?").get(L, F(2)).id;
    await ph.selectOption("#shf-form [name=swap_with]", String(lb)); await ph.waitForTimeout(100);
    const bt = await ph.evaluate(() => { const b = document.querySelector("[data-act=swap-yes]"); b.scrollIntoView({ block: "nearest" }); const r = b.getBoundingClientRect(); return { h: r.height, inView: r.bottom <= innerHeight && r.top >= 0, w: document.documentElement.scrollWidth }; });
    t.ok(rp.h >= 44 && bt.h >= 44 && bt.inView && rp.w <= 390 && bt.w <= 390, "S7 phone: shift rows and Swap 44 px or more, no sideways scroll: " + JSON.stringify({ rp, bt }));
    await ph.click("[data-act=swap-yes]"); await ph.waitForFunction(() => !document.querySelector("#shf-form"), null, { timeout: 8000 });
    t.ok(row(L, F(3)) && row(Q, F(2)) && row(L, F(3)).start_time === "08:00" && writes.map((w) => w.m).join() === "POST,POST,DELETE,DELETE", "S7 the phone swap is written as on the desktop: " + JSON.stringify(writes.map((w) => w.m)));
  }
};
