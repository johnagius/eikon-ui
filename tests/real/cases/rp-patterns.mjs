// Roster planner — patterns (SPEC §13 A1–A5, A7), on the real worker and the real screen code, own pharmacy (rp seed):
//  A1 a 2-week rotation's expansion over 12 months: holidays closed (E.maltaHoliday), the override that opens one,
//     the override that closes a day, weekly-closed Sundays, whole-day leave skipped, part-day leave trimmed, pending asked;
//  pattern editor: Joe's alternate Saturdays set in ≤ 10 interactions; the PUT is the classic whole record from the
//     person read fresh, only patterns_json changes in the row;
//  A2 Keep through the apply dialog: rows after = rows before ∪ the preview's adds; the worker's count = the preview's;
//     "until changed" = 12 months and rota.plans written read-fresh-merge (classic keys intact);
//  A3 Replace: the rows removed are exactly the preview's "removes"; rows on days the pattern leaves off keep their id;
//  A4 Undo from Recent changes = the snapshot; an undo after someone else's change names it and waits for "Undo anyway";
//  A5 a 500, a lost answer that landed, a half-done write on a server without W1 put back, and a put-back that fails too;
//  A7 Extend shows 8 weeks before the end (clock shim) and starts the day after; a classic settings save keeps rota.*.
import { rpSeed } from "./_rpseed.mjs";

export default {
  title: "Roster planner: patterns, apply (Keep/Replace), undo, failure put back, until changed",
  async run(t) {
    const S = await rpSeed(t, { tag: "patterns", weeks: 3 });
    const p = await S.page();
    await t.open(p, "2", "shfreg", "shfreg");
    await p.evaluate(() => { const d = document.createElement("div"); d.id = "rp-host"; d.style.cssText = "position:relative;z-index:5;background:var(--bg,#fff);padding:16px;max-width:820px"; document.body.prepend(d); });
    const host = "#rp-host";
    const rowsOf = (sid, from = S.mon, to = S.d(400)) => S.rows(from, to, sid);
    const fields = (r) => [r.staff_id, r.shift_date, r.start_time, r.end_time, r.role_override, r.notes].join("|");
    const calls = []; p.on("request", (r) => { const u = new URL(r.url()); if (u.hostname === "localhost" && /^\/shifts\//.test(u.pathname)) calls.push(r.method() + " " + u.pathname); });

    // ---- A1: expansion with the real hours, settings and leave
    const a1 = await p.evaluate(async ({ S }) => {
      const E = window.EIKON, P = E.rotaPlan, rules = await E.rotaRules(true);
      const yrs = [...new Set([S.mon.slice(0, 4), P.dates.add(S.mon, 400).slice(0, 4)])];
      let leaves = []; for (const y of yrs) leaves = leaves.concat((await E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" })).leaves);
      const existing = (await E.apiFetch("/shifts/assignments-range?from=" + S.mon + "&to=" + P.dates.add(S.mon, 400), { method: "GET" })).shifts;
      const B = (s, e) => ({ start: s, end: e });
      const rot = { n: 2, anchor: S.mon, weeks: [[B("07:30", "15:30"), B("07:30", "15:30"), B("07:30", "15:30"), B("07:30", "15:30"), B("07:30", "15:30"), B("08:00", "13:00"), null], [B("07:30", "15:30"), B("07:30", "15:30"), B("07:30", "15:30"), B("07:30", "15:30"), B("07:30", "15:30"), null, null]] };
      const to = P.untilChangedEnd(S.mon), out = {};
      for (const k of ["rita", "karl", "lara"]) {
        const x = P.expand({ person: S.people.find((q) => q.id === S.ids[k]), rotation: rot, from: S.mon, to, hours: rules.hours, settings: rules.settings, leaves, existing });
        out[k] = { add: x.add.map((r) => r.date + " " + r.start_time + "-" + r.end_time + (r.asked ? " asked" : "") + (r.week ? " " + r.week : "")), keep: x.keep.length, skip: x.skip.map((s) => s.date + " " + s.why), asked: x.asked.map((a) => a.words), trim: x.trim.map((q) => q.words) };
      }
      const hol = []; for (let d = S.mon; d <= to; d = P.dates.add(d, 1)) if (E.maltaHoliday(d)) hol.push(d);
      return { out, to, hol, pv: P.preview([], P.expand({ person: S.people.find((q) => q.id === S.ids.karl), rotation: rot, from: S.mon, to, hours: rules.hours, settings: rules.settings, leaves, existing }), "keep").words };
    }, { S: { mon: S.mon, ids: S.ids, people: S.people } });
    {
      const k = a1.out.karl, wd = (d) => new Date(d + "T12:00:00Z").getUTCDay(), wkA = (d) => Math.floor((Date.parse(d) - Date.parse(S.mon)) / 864e5 / 7) % 2 === 0;
      t.ok(k.add.every((x) => { const d = x.slice(0, 10); return wd(d) >= 1 && wd(d) <= 5 || (wd(d) === 6 && wkA(d)); }), "A1: only Mon–Fri and week-A Saturdays");
      t.ok(!k.add.some((x) => wd(x.slice(0, 10)) === 0), "A1: never a Sunday (weekly closed)");
      t.ok(k.skip.includes(S.closedDay + " closed"), "A1: the override closing " + S.closedDay + " (Staff training) skips it");
      const patDay = (d) => (wd(d) >= 1 && wd(d) <= 5) || (wd(d) === 6 && wkA(d));
      const wantHol = a1.hol.filter((d) => patDay(d) && d !== S.openDay);
      t.ok(JSON.stringify(k.skip.filter((s) => s.endsWith(" holiday")).map((s) => s.slice(0, 10))) === JSON.stringify(wantHol), "A1: every Malta holiday on a pattern day is skipped as a public holiday: " + JSON.stringify({ got: k.skip.filter((s) => s.endsWith("holiday")), wantHol }));
      if (S.openDay && patDay(S.openDay)) t.ok(k.add.some((x) => x.startsWith(S.openDay)), "A1: the override that opens " + S.openDay + " (Duty roster) gets the shift");
      t.ok(k.add.some((x) => x.startsWith(S.d(8) + " 12:00-15:30")) && k.trim.length === 1 && /annual leave 08:00–12:00/.test(k.trim[0]), "A1: Karl's part-day leave on " + S.d(8) + " trims 07:30–15:30 to 12:00–15:30: " + JSON.stringify(k.trim));
      t.ok(k.keep === 5 && !k.add.some((x) => x.slice(0, 10) <= S.d(4)), "A1: Keep — Karl's 5 seeded days are kept, nothing added on them");
      t.ok(a1.out.rita.skip.includes(S.d(3) + " leave"), "A1: Rita's whole-day annual leave on " + S.d(3) + " is skipped");
      t.ok(a1.out.lara.add.some((x) => x.startsWith(S.d(9)) && /asked/.test(x)) && /Lara asked for annual leave/.test(a1.out.lara.asked[0] || ""), "A1: Lara's pending leave day is added and listed as asked");
      t.ok(new RegExp("^Adds " + k.add.length + " shifts · keeps 5 shifts already planned · removes nothing$").test(a1.pv.line) && /^Skips: \d+ public holidays? · 1 day the pharmacy is closed/.test(a1.pv.skips), "A1: preview words " + JSON.stringify(a1.pv));
    }

    // ---- the pattern editor: Joe's alternate Saturdays in ≤ 10 interactions
    const joeBefore = t.row("shift_staff", S.ids.joe);
    await p.evaluate((id) => { const E = window.EIKON; return E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }).then((r) => { window.__ed = E.rotaPlan.ui.editor(document.getElementById("rp-host"), r.staff.find((x) => x.id === id), { onSaved: (np) => { window.__saved = np; } }); }); }, S.ids.joe);
    let n = 0; const act = async (f) => { n++; await f(); };
    await act(() => p.click(host + ' [data-act="work"][data-d="0"]'));
    await act(() => p.fill(host + ' [data-f="s0-0"]', "13:30")); await act(() => p.fill(host + ' [data-f="e0-0"]', "19:30"));
    await act(() => p.click(host + ' [data-act="mf"]'));
    await act(() => p.click(host + ' [data-act="work"][data-d="5"]'));
    await act(() => p.fill(host + ' [data-f="e5-0"]', "13:00"));
    await p.fill(host + ' [data-f="s5-0"]', "08:00"); n++;
    await act(() => p.click(host + ' [data-act="addwk"]'));
    await act(() => p.click(host + ' [data-act="off"][data-d="5"]'));
    const sumBefore = await p.textContent(host + " .rp-sum");
    const put = await t.write(p, /^\/shifts\/staff\/\d+$/, () => p.click(host + ' [data-act="save"]'), "PUT");
    n++;
    const joeAfter = t.row("shift_staff", S.ids.joe), pj = JSON.parse(joeAfter.patterns_json);
    t.ok(n <= 11, "editor: Joe's alternate-Saturday rotation in " + n + " interactions");
    t.ok(/^Mon–Fri 13:30–19:30 · Saturdays 08:00–13:00 every other week \(next on /.test(sumBefore), "editor: the plain summary " + sumBefore);
    t.ok(pj.patterns.length === 2 && /^rot\.[a-z0-9]+\.1of2\.\d{4}-\d{2}-\d{2}$/.test(pj.patterns[0].id) && pj.patterns[1].id === pj.patterns[0].id.replace("1of2", "2of2") && pj.provisionalId === pj.patterns[0].id && pj.patterns.map((x) => x.name).join() === "Usual · week A of 2,Usual · week B of 2", "editor: stored as two classic weekly patterns " + JSON.stringify(pj.patterns.map((x) => [x.id, x.name])));
    t.ok(JSON.stringify(pj.patterns[0].week[6]) === JSON.stringify({ off: false, start: "08:00", end: "13:00", role_override: "" }) && JSON.stringify(pj.patterns[1].week[6]) === '{"off":true}' && pj.patterns[0].week[0].off === true, "editor: classic week entries (Sun = 0)");
    const body = put.body || {};
    t.ok(["full_name", "designation", "employment_type", "contracted_hours", "email", "phone", "registration_number"].every((k) => body[k] === joeBefore[k]) && body.is_active === 1, "editor: the PUT is the whole classic record from the person read fresh " + JSON.stringify(body).slice(0, 200));
    t.ok(Object.keys(joeBefore).filter((k) => !["patterns_json", "updated_at"].includes(k) && joeBefore[k] !== joeAfter[k]).length === 0, "editor: only patterns_json (and updated_at) changed in the row");

    // ---- A2 Keep through the apply dialog ("Put it on the rota…"), until changed
    const setBefore = JSON.parse(t.db.prepare("SELECT settings_json FROM shift_settings WHERE location_id = ?").get(S.loc).settings_json);
    const joeRowsBefore = rowsOf(S.ids.joe, "2000-01-01", "2100-01-01");
    calls.length = 0;
    await p.click(host + ' [data-act="apply"]');
    await p.waitForFunction(() => { const b = document.querySelector('#rp-host [data-act="go"]'); return b && !b.disabled; }, null, { timeout: 15000 });
    const pvA2 = await p.evaluate(() => [...document.querySelectorAll("#rp-host .rp-pv p, #rp-host .rp-pv b")].map((x) => x.textContent));
    const btn = await p.textContent(host + ' [data-act="go"]');
    const added = Number((btn.match(/Add (\d+) shifts/) || [])[1]);
    const w2 = await t.write(p, /^\/shifts\/apply-plan$/, () => p.click(host + ' [data-act="go"]'));
    await p.waitForSelector("#rp-toast", { timeout: 15000 });
    await t.idle(p);
    const joeRowsAfter = rowsOf(S.ids.joe, "2000-01-01", "2100-01-01");
    const startMon = await p.evaluate(() => window.EIKON.rotaPlan.dates.monday(window.EIKON.rotaPlan.dates.today()));
    const through = await p.evaluate((m) => window.EIKON.rotaPlan.untilChangedEnd(m), startMon);
    t.ok(added > 200 && w2.json && w2.json.added === added, "A2: the worker added exactly the preview's count (" + added + "): " + JSON.stringify(w2.json));
    t.ok(joeRowsBefore.every((r) => joeRowsAfter.some((x) => x.id === r.id && fields(x) === fields(r))), "A2: every row Joe had is unchanged (Keep)");
    t.ok(joeRowsAfter.length === joeRowsBefore.length + added && joeRowsAfter.every((r) => r.shift_date >= startMon && r.shift_date <= through || joeRowsBefore.some((b) => b.id === r.id)), "A2: rows after = before ∪ the adds, all inside " + startMon + "…" + through);
    t.ok(/^Joe Vella, /.test(pvA2[0]) && /keeps 4 shifts already planned · removes nothing/.test(pvA2[1]), "A2: preview " + JSON.stringify(pvA2.slice(0, 3)));
    const setAfter = JSON.parse(t.db.prepare("SELECT settings_json FROM shift_settings WHERE location_id = ?").get(S.loc).settings_json);
    const plan = setAfter.rota && setAfter.rota.plans && setAfter.rota.plans[String(S.ids.joe)];
    t.ok(plan && plan.from === startMon && plan.through === through && plan.keep === true && /^[a-z0-9]+$/.test(plan.rid) && pj.patterns[0].id.split(".")[1] === plan.rid, "A7: until changed = 12 months, remembered in rota.plans: " + JSON.stringify(plan));
    t.ok(setAfter.calendarToken === setBefore.calendarToken && setAfter.pharmacistRequired === true && setAfter.minPharmacists === 1, "A7: the classic settings keys are untouched by the merge");
    const apCalls = calls.filter((c) => /apply-plan|apply-pattern|assignments-range|settings/.test(c));
    t.ok(apCalls.filter((c) => c === "POST /shifts/apply-plan").length === 1 && !apCalls.includes("POST /shifts/apply-pattern"), "A2 cost: one POST /shifts/apply-plan for 12 months: " + calls.join(", "));
    t.note("A2 requests: " + calls.join(", "));

    // ---- A3 Replace for Karl over the seeded week (rotation passed in): removes exactly the preview's list
    const karlSat = await S.api("POST", "/shifts/assignments", { staff_id: S.ids.karl, shift_date: S.d(5), start_time: "08:00", end_time: "12:00", notes: "keep me — Sat", role_override: "pharmacist" });
    const kBefore = rowsOf(S.ids.karl, S.mon, S.d(6));
    await p.evaluate(({ id, mon, to }) => {
      const E = window.EIKON, B = (s, e) => ({ start: s, end: e });
      return E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }).then((r) => { E.rotaPlan.ui.applyDialog(document.getElementById("rp-host"), { kind: "pattern", person: r.staff.find((x) => x.id === id), rotation: { n: 1, weeks: [[B("08:00", "16:00"), B("08:00", "16:00"), B("08:00", "16:00"), B("08:00", "16:00"), B("08:00", "16:00"), null, null]] }, from: mon, to, onDone: (x) => { window.__done = x; } }); });
    }, { id: S.ids.karl, mon: S.mon, to: S.d(6) });
    await p.check(host + ' [data-f="mode"][value="replace"]');
    await p.waitForFunction(() => { const b = document.querySelector('#rp-host [data-act="go"]'); return b && !b.disabled && /remove/.test(b.textContent); }, null, { timeout: 15000 });
    const removesW = await p.evaluate(() => (document.querySelector("#rp-host .rp-pv p.bad") || {}).textContent || "");
    const w3 = await t.write(p, /^\/shifts\/apply-plan$/, () => p.click(host + ' [data-act="go"]'));
    await t.idle(p);
    const kAfter = rowsOf(S.ids.karl, S.mon, S.d(6));
    const removedIds = (w3.body && w3.body.items && w3.body.items[0].remove) || [];
    t.ok(JSON.stringify(removedIds.slice().sort()) === JSON.stringify(kBefore.filter((r) => r.shift_date <= S.d(4)).map((r) => r.id).sort()), "A3: the removed set is exactly Karl's 5 weekday shifts: " + JSON.stringify(removedIds));
    t.ok(/^Removes 5 shifts: /.test(removesW) && kBefore.filter((r) => r.shift_date <= S.d(4)).every((r) => removesW.includes(r.start_time + "–" + r.end_time)), "A3: the preview named every shift it removes: " + removesW);
    const sat = kAfter.find((r) => r.id === karlSat.shift_id);
    t.ok(sat && fields(sat) === fields(kBefore.find((r) => r.id === karlSat.shift_id)), "A3: the Saturday shift (pattern off that day) survives with its id, role and note");
    t.ok(kAfter.length === 6 && kAfter.filter((r) => r.shift_date <= S.d(4)).every((r) => r.start_time === "08:00" && r.end_time === "16:00"), "A3: Mon–Fri are now 08:00–16:00");

    // ---- A4 Undo from Recent changes = the snapshot; after someone else's change it names it first
    await p.evaluate(() => { window.__rc = window.EIKON.rotaPlan.ui.recent(document.getElementById("rp-host"), {}); });
    const recentText = await p.textContent(host + " .rp-rec");
    await t.write(p, /^\/shifts\/apply-plan$/, () => p.click(host + ' .rp-rec li:first-child [data-act="undo"]'));
    await p.waitForFunction(() => /Undone/.test(document.querySelector("#rp-host").textContent), null, { timeout: 15000 });
    const kUndo = rowsOf(S.ids.karl, S.mon, S.d(6));
    t.ok(/Added 5 shifts and removed 5 for Karl/.test(recentText), "A4: Recent changes lists the operation in words: " + recentText.slice(0, 120));
    t.ok(JSON.stringify(kUndo.map(fields).sort()) === JSON.stringify(kBefore.map(fields).sort()) && kUndo.some((r) => r.id === karlSat.shift_id), "A4: Undo restores the snapshot exactly (and the untouched Saturday keeps its id)");
    // again, then someone else adds a shift in the range: Undo names it and waits
    const again = await p.evaluate(async ({ id, mon, to }) => {
      const E = window.EIKON, P = E.rotaPlan, staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff, B = (s, e) => ({ start: s, end: e });
      const existing = (await E.apiFetch("/shifts/assignments-range?from=" + mon + "&to=" + to + "&staff_id=" + id, { method: "GET" })).shifts, rules = await E.rotaRules();
      const x = P.expand({ person: staff.find((s) => s.id === id), rotation: { n: 1, weeks: [[B("09:00", "17:00"), null, null, null, null, null, null]] }, from: mon, to, hours: rules.hours, settings: rules.settings, existing, mode: "replace" });
      return P.apply([x], { label: "test" });
    }, { id: S.ids.karl, mon: S.mon, to: S.d(6) });
    await S.api("POST", "/shifts/assignments", { staff_id: S.ids.karl, shift_date: S.d(6), start_time: "10:00", end_time: "12:00", notes: "Mark's change" });
    const u1 = await p.evaluate((id) => window.EIKON.rotaPlan.undo(id), again.undoId);
    t.ok(again.done && !u1.done && u1.changedSince.length === 1 && /Karl Sun \d+ \w+ 10:00–12:00 was added since/.test(u1.words) && /Undo anyway\?/.test(u1.words) && rowsOf(S.ids.karl, S.mon, S.d(6)).some((r) => r.notes === "Mark's change"), "A4: an undo after someone else's change names it and does nothing yet: " + u1.words);
    const u2 = await p.evaluate((id) => window.EIKON.rotaPlan.undo(id, { anyway: true }), again.undoId);
    t.ok(u2.done && JSON.stringify(rowsOf(S.ids.karl, S.mon, S.d(6)).map(fields).sort()) === JSON.stringify(kBefore.map(fields).sort()), "A4: Undo anyway puts the snapshot back: " + u2.words);

    // ---- A5 failures, on Ċensina's seeded week
    const cid = S.ids.censina, cBefore = () => rowsOf(cid, S.mon, S.d(6));
    const snapC = cBefore().map(fields).sort().join("\n");
    const run = (mode) => p.evaluate(async ({ id, mon, to, mode }) => {
      const E = window.EIKON, P = E.rotaPlan, staff = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff, B = (s, e) => ({ start: s, end: e });
      const existing = (await E.apiFetch("/shifts/assignments-range?from=" + mon + "&to=" + to + "&staff_id=" + id, { method: "GET" })).shifts, rules = await E.rotaRules();
      const x = P.expand({ person: staff.find((s) => s.id === id), rotation: { n: 1, weeks: [[B("12:00", "19:30"), B("12:00", "19:30"), B("12:00", "19:30"), B("12:00", "19:30"), B("12:00", "19:30"), B("08:00", "13:00"), null]] }, from: mon, to, hours: rules.hours, settings: rules.settings, existing, mode });
      return P.apply([x], { label: "A5" });
    }, { id: cid, mon: S.mon, to: S.d(6), mode });
    // a 500
    await p.route("**/shifts/apply-plan", (r) => r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"Internal error"}' }));
    const f1 = await run("replace");
    await p.unroute("**/shifts/apply-plan");
    t.ok(!f1.done && /^Nothing was changed — /.test(f1.words) && cBefore().map(fields).sort().join("\n") === snapC, "A5: a 500 → rows as before, 'Nothing was changed — …': " + f1.words);
    // a lost answer that landed
    await p.route("**/shifts/apply-plan", async (r) => { await r.fetch(); await r.abort("connectionreset"); });
    const f2 = await run("replace");
    await p.unroute("**/shifts/apply-plan");
    t.ok(f2.done && f2.recovered && cBefore().length === 6, "A5: the answer was lost but it landed: counted as done, Undo offered: " + f2.words);
    const u5 = await p.evaluate((id) => window.EIKON.rotaPlan.undo(id), f2.undoId);
    t.ok(u5.done && cBefore().map(fields).sort().join("\n") === snapC, "A5: …and its Undo puts the week back");
    // a server without W1: the overwrite lands half (DELETE then the first rows), then 500 → put back
    await p.evaluate(() => window.EIKON.rotaPlan._server(null));
    await p.route("**/shifts/apply-plan", (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"ok":false,"error":"Not found"}' }));
    let first = true;
    await p.route("**/shifts/apply-pattern", async (r) => {
      if (!first) return r.continue();
      first = false; const b = r.request().postDataJSON(); b.dates = b.dates.slice(0, 2);
      await r.fetch({ postData: JSON.stringify(b) }); await r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"Internal error"}' });
    });
    const f3 = await run("replace");
    t.ok(!f3.done && /^Nothing was changed — /.test(f3.words) && cBefore().map(fields).sort().join("\n") === snapC, "A5: older server, half-done overwrite then a 500 → put back from the snapshot: " + f3.words + " · rows " + cBefore().length);
    // …and the put-back fails too
    await p.unroute("**/shifts/apply-pattern"); first = true;
    await p.route("**/shifts/apply-pattern", async (r) => {
      if (!first) return r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"Internal error"}' });
      first = false; const b = r.request().postDataJSON(); b.dates = []; await r.fetch({ postData: JSON.stringify(b) }); await r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"Internal error"}' });
    });
    const f4 = await run("replace");
    t.ok(!f4.done && f4.undoId && /^Ċensina's shifts from .+ could not be put back; 0 of the 4 earlier shifts are on the rota now\. Try Undo again in a minute/.test(f4.words), "A5: the put-back fails too → exact words: " + f4.words);
    const rc4 = await p.evaluate(() => window.EIKON.rotaPlan.recent()[0]);
    t.ok(rc4.restoreFailed && rc4.undoId === f4.undoId, "A5: the snapshot stays in Recent changes");
    await p.unroute("**/shifts/apply-pattern"); await p.unroute("**/shifts/apply-plan");
    await p.evaluate(() => window.EIKON.rotaPlan._server(null));
    const u6 = await p.evaluate((id) => window.EIKON.rotaPlan.undo(id), f4.undoId);
    t.ok(u6.done && cBefore().map(fields).sort().join("\n") === snapC, "A5: Undo from Recent changes, once the server answers, puts the week back: " + u6.words);

    // ---- A7 Extend: 8 weeks before the end (clock shim), starts the day after; a classic settings save keeps rota.*
    const ext = await p.evaluate(async ({ joe, through }) => {
      const P = window.EIKON.rotaPlan, plans = await P.plans(true), staff = (await window.EIKON.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff;
      return { early: P.extendDue(P.dates.add(through, -57), plans, staff).filter((x) => x.staff_id === joe), due: P.extendDue(P.dates.add(through, -55), plans, staff).filter((x) => x.staff_id === joe) };
    }, { joe: S.ids.joe, through });
    t.ok(!ext.early.length && ext.due.length === 1 && ext.due[0].from === (await p.evaluate((d) => window.EIKON.rotaPlan.dates.add(d, 1), through)) && /^Joe's usual week is on the rota until /.test(ext.due[0].words), "A7: Extend shows under 8 weeks before the end and starts the day after (never re-fills inside the old horizon): " + JSON.stringify(ext));
    const cls = await S.page(); await t.open(cls, "classic", "shifts", "shifts");
    await cls.evaluate(async () => { const E = window.EIKON, s = (await E.apiFetch("/shifts/settings", { method: "GET" })).settings; await E.apiFetch("/shifts/settings", { method: "PUT", body: JSON.stringify(Object.assign({}, s, { minPharmacists: 1 })) }); }); // the classic Rules save: the whole loaded object
    const setC = JSON.parse(t.db.prepare("SELECT settings_json FROM shift_settings WHERE location_id = ?").get(S.loc).settings_json);
    t.ok(setC.rota && setC.rota.plans && setC.rota.plans[String(S.ids.joe)] && setC.rota.plans[String(S.ids.joe)].through === through, "A7: a classic settings save afterwards keeps rota.plans");
  }
};
