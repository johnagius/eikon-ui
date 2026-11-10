// Rota (Who's in + Plan shifts), Team round: the cover rule, filling a gap, swapping two shifts and the month's hours.
//  - E.teamCover's gaps equal the classic Shifts screen's coverage check (checkCov, ported below as it is in
//    modules.shifts.js, next-door gaps joined) on a seeded week, with a Malta public holiday (closed) and a one-day
//    override that opens one;
//  - Fill the gap sends + Add shift's body and stores the row a classic add stores;
//  - Swap leaves both rows as two classic changes (whole-record PUTs) would;
//  - Hours in <month> = the sum of that month's saved rows (end minus start), per person.
// The case works eight weeks ahead, so the other Team cases' shifts this week do not touch its cover.
import { maltaYmd, ymdAdd } from "../../clock.mjs";
const monday = (n) => { const t = maltaYmd(0); return ymdAdd(t, n * 7 - ((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7)); };

// The classic checkCov (modules.shifts.js) with its ohFor, for a day: gaps [[from,to]] in minutes, next-door ones joined.
function classicGaps(ds, S) {
  const t2m = (t) => { if (!t) return 0; const p = t.split(":"); return +p[0] * 60 + (+p[1] || 0); };
  const isPH = (d) => S.ph.indexOf(d) >= 0;
  const ohFor = (d) => { const ov = (S.openingHours.overrides || {})[d]; if (ov) return ov; if (isPH(d)) return { open: "", close: "", closed: true }; const w = new Date(d).getDay(); const b = (S.openingHours.weekly && S.openingHours.weekly[w]) || S.openingHours.default; return { open: b.open || "07:30", close: b.close || "19:30", closed: !!b.closed }; };
  const oh = ohFor(ds); if (oh.closed) return { closed: true, gaps: [] };
  const min = parseInt(S.settings.minPharmacists, 10) || 1, need = !!S.settings.pharmacistRequired;
  const onLeave = {}; S.leaves.filter((l) => l.status === "approved" && l.start_date <= ds && l.end_date >= ds).forEach((l) => { onLeave[l.staff_id] = true; });
  const openM = t2m(oh.open || "07:30"), closeM = t2m(oh.close || "19:30"); const events = [];
  S.shifts.filter((s) => s.shift_date === ds).forEach((s) => { if (onLeave[s.staff_id]) return; const e = S.staff.find((x) => x.id === s.staff_id); const isPh = (e && (e.designation === "pharmacist" || e.designation === "locum")) || s.role_override === "pharmacist"; if (!isPh) return; const st = Math.max(openM, t2m(s.start_time)), et = Math.min(closeM, t2m(s.end_time)); if (et <= st) return; events.push({ t: st, d: 1 }, { t: et, d: -1 }); });
  if (!events.length) return { closed: false, gaps: need ? [[openM, closeM]] : [] };
  events.sort((a, b) => a.t - b.t || b.d - a.d); const gaps = []; let count = 0, cur = openM, i = 0;
  while (i < events.length && events[i].t <= openM) { count += events[i].d; i++; }
  while (cur < closeM) { const nextT = i < events.length ? Math.min(events[i].t, closeM) : closeM; if (nextT > cur) { if (need && count < min) gaps.push([cur, nextT]); cur = nextT; } while (i < events.length && events[i].t === cur) { count += events[i].d; i++; } if (i >= events.length && cur >= closeM) break; if (i >= events.length && cur < closeM) { if (need && count < min) gaps.push([cur, closeM]); break; } }
  const j = []; gaps.forEach((g) => { if (j.length && j[j.length - 1][1] === g[0]) j[j.length - 1][1] = g[1]; else j.push(g.slice()); });
  return { closed: false, gaps: j };
}
const hm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");

export default {
  title: "Rota: cover rule = classic, fill a gap, swap, month hours",
  async run(t) {
    const W = monday(8), D = (i) => ymdAdd(W, i);
    const mk = async (n, d) => { const r = await t.api("POST", "/shifts/staff", { full_name: n, designation: d, employment_type: d === "locum" ? "external" : "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: "{}" }); return r.staff_id || r.id; };
    const P1 = await mk("Rota Ġużeppi Pharm", "pharmacist"), L = await mk("Rota Ħelena Locum", "locum"), A = await mk("Rota Żaren Assistant", "assistant");
    const add = (sid, d, s, e, notes = "") => t.api("POST", "/shifts/assignments", { staff_id: sid, shift_date: d, start_time: s, end_time: e, notes });
    await add(P1, D(0), "07:30", "13:30");                                  // Mon: gap 13:30–19:30 → filled on screen
    const tA = await add(P1, D(1), "07:30", "13:30", "Ċentru"), tB = await add(A, D(1), "13:30", "19:30", "Ħal Qormi"); // Tue: swapped on screen
    const cA = await add(P1, D(2), "07:30", "13:30", "Ċentru"), cB = await add(A, D(2), "13:30", "19:30", "Ħal Qormi"); // Wed: swapped by two classic PUTs
    await add(P1, D(3), "09:00", "12:00"); await add(L, D(3), "11:00", "16:00");   // Thu: gaps 07:30–09:00 and 16:00–19:30
    await add(P1, D(5), "08:00", "13:00");                                  // Sat

    // ---- cover rule: E.teamCover vs the classic checkCov, including a holiday and an override that opens it ----
    const p = await t.page();
    await t.open(p, "2", "team", "team");
    const xmas = maltaYmd(0).slice(0, 4) + "-12-25", sp = maltaYmd(0).slice(0, 4) + "-12-08";
    const staff = (await t.api("GET", "/shifts/staff?include_inactive=1")).staff;
    const shifts = (await t.api("GET", "/shifts/assignments-range?from=" + D(0) + "&to=" + D(6))).shifts.concat([{ id: -1, staff_id: P1, shift_date: xmas, start_time: "08:00", end_time: "12:00" }, { id: -2, staff_id: P1, shift_date: sp, start_time: "09:00", end_time: "11:00" }]);
    const hours = { default: { open: "07:30", close: "19:30", closed: false }, openSaturday: true, openSunday: false, overrides: { [sp]: { open: "09:00", close: "12:00", closed: false } } };
    const weekly = {}; for (let w = 0; w < 7; w++) weekly[w] = { open: "07:30", close: "19:30", closed: w === 0 }; // the classic normalizeOpeningHours of the same JSON
    const settings = { pharmacistRequired: true, minPharmacists: 1 };
    const days = [0, 1, 2, 3, 4, 5, 6].map(D).concat([xmas, sp]);
    const fresh = await p.evaluate(({ days, o }) => days.map((d) => { const c = window.EIKON.teamCover(d, o); return { d, closed: c.closed, holiday: c.holiday, gaps: c.gaps.map((g) => g.from + "–" + g.to), words: c.words }; }), { days, o: { hours, settings, shifts, staff, leaves: [] } });
    const phs = await p.evaluate((ds) => ds.filter((d) => window.EIKON.maltaHoliday(d)), days);
    const S = { openingHours: { ...hours, weekly }, settings, leaves: [], shifts, staff, ph: phs };
    for (const f of fresh) { const c = classicGaps(f.d, S); t.ok(f.closed === c.closed && f.gaps.join() === c.gaps.map((g) => hm(g[0]) + "–" + hm(g[1])).join(), "cover " + f.d + " = classic checkCov: " + JSON.stringify({ fresh: f, classic: c })); }
    const fx = fresh.find((f) => f.d === xmas), fs = fresh.find((f) => f.d === sp);
    t.ok(fx.closed && fx.words === "Closed · Public holiday (Christmas Day)", "Christmas is closed unless overridden: " + fx.words);
    t.ok(!fs.closed && /^No pharmacist 11:00–12:00$/.test(fs.words) && fs.holiday === "Immaculate Conception", "a holiday opened by an override is open on its own hours: " + fs.words);
    t.ok(fresh.find((f) => f.d === D(3)).words === "No pharmacist 07:30–09:00, 16:00–19:30", "two gaps in one day, in words");

    // ---- Fill the gap (Plan shifts on that week): + Add shift's body, the row a classic add stores ----
    await p.evaluate((w) => { window.EIKON._shfWeek = w; location.hash = "#shfreg"; }, W);
    await p.waitForSelector('.shf-gap[data-date="' + D(0) + '"]'); await t.idle(p);
    await p.click('.shf-gap[data-date="' + D(0) + '"]'); await p.waitForSelector("#shf-form");
    const pre = await p.evaluate(() => { const s = document.querySelector("#shf-form [name=staff_id]"); return { who: s.value, label: s.selectedOptions[0].textContent, group: s.selectedOptions[0].parentElement.label || "", st: document.querySelector("#shf-form [name=start_time]").value, et: document.querySelector("#shf-form [name=end_time]").value, focus: document.activeElement.textContent }; });
    t.ok(pre.st === "13:30" && pre.et === "19:30" && /^Free to cover/.test(pre.group) && /Pharmacist|Locum/.test(pre.label) && pre.focus === "Add shift", "Fill the gap: the gap's hours, a free pharmacist chosen, focus on Add shift: " + JSON.stringify(pre));
    await p.selectOption("#shf-form [name=staff_id]", String(L));
    let m0 = t.maxId("shift_assignments");
    const w1 = await t.write(p, /\/shifts\/assignments$/, () => p.click("#shf-form button[type=submit]"));
    t.ok(JSON.stringify(w1.body) === JSON.stringify({ staff_id: L, shift_date: D(0), start_time: "13:30", end_time: "19:30", notes: "" }), "fill body = + Add shift's body: " + JSON.stringify(w1.body));
    const filled = (await t.mine("shift_assignments", m0))[0];
    m0 = t.maxId("shift_assignments"); await add(L, D(4), "13:30", "19:30");
    t.same("shift (fill the gap)", t.since("shift_assignments", m0)[0], filled, { shift_date: "another day", created_by: "same user" });
    await p.waitForFunction((d) => !document.querySelector('.shf-gap[data-date="' + d + '"]'), D(0), { timeout: 5000 }).then(() => t.ok(true), () => t.fail("the gap line went away after the fill"));

    // ---- Swap (Tue) vs two classic whole-record PUTs (Wed) ----
    const ra = t.db.prepare("SELECT id FROM shift_assignments WHERE staff_id = ? AND shift_date = ?").get(P1, D(1)).id, rb = t.db.prepare("SELECT id FROM shift_assignments WHERE staff_id = ? AND shift_date = ?").get(A, D(1)).id;
    await p.click('.shf-p[data-act=edit][data-id="' + ra + '"]'); await p.waitForSelector("#shf-form [data-act=swap]");
    await p.click("#shf-form [data-act=swap]"); await p.selectOption("#shf-form [name=swap_with]", String(rb)); await p.waitForTimeout(100);
    const q = await p.evaluate(() => ({ text: document.querySelector(".shf-swq").textContent, btn: document.querySelector("[data-act=swap-yes]").textContent }));
    t.ok(/Rota Ġużeppi Pharm works 13:30–19:30 and Rota Żaren Assistant works 07:30–13:30\. This leaves no pharmacist 07:30–13:30\./.test(q.text) && q.btn === "Swap anyway", "one sentence says the swap and the gap it leaves: " + JSON.stringify(q));
    const puts = []; p.on("request", (r) => { if (r.method() === "PUT") puts.push(r.postDataJSON()); });
    await p.click("[data-act=swap-yes]"); await p.waitForFunction(() => !document.querySelector("#shf-form"), null, { timeout: 8000 });
    const ca = t.db.prepare("SELECT * FROM shift_assignments WHERE staff_id = ? AND shift_date = ?").get(P1, D(2)), cb = t.db.prepare("SELECT * FROM shift_assignments WHERE staff_id = ? AND shift_date = ?").get(A, D(2));
    await t.api("PUT", "/shifts/assignments/" + ca.id, { ...ca, start_time: cb.start_time, end_time: cb.end_time });
    await t.api("PUT", "/shifts/assignments/" + cb.id, { ...cb, start_time: ca.start_time, end_time: ca.end_time });
    t.same("swap (first shift)", t.row("shift_assignments", ca.id), t.row("shift_assignments", ra), { shift_date: "another day" });
    t.same("swap (second shift)", t.row("shift_assignments", cb.id), t.row("shift_assignments", rb), { shift_date: "another day" });
    t.ok(puts.length === 2 && Object.keys(puts[0]).join() === "id,staff_id,shift_date,start_time,end_time,role_override,notes" && puts[0].notes === "Ċentru" && puts[1].notes === "Ħal Qormi", "two whole-record PUTs, each note kept with its person: " + JSON.stringify(puts));

    // ---- Who's in on that week: the grid's cover row, and Hours in <month> = sums of the saved rows ----
    await p.evaluate((w) => { window.EIKON._rotWeek = w; location.hash = "#rotreg"; }, W);
    await p.waitForSelector(".rot-grid tr.cov"); await t.idle(p);
    const covRow = await p.evaluate(() => [...document.querySelectorAll(".rot-grid tr.cov td")].map((td) => td.innerText.replace(/\s+/g, " ").trim()));
    t.ok(/No pharmacist 07:30–13:30/.test(covRow[1]) && /No pharmacist 07:30–09:00/.test(covRow[3]) && /No pharmacist 16:00–19:30/.test(covRow[3]), "Who's in: each day's cover in words: " + JSON.stringify(covRow));
    await p.click("[data-act=month]"); await p.waitForSelector(".rot-mt");
    const thu = ymdAdd(W, 3), mfrom = thu.slice(0, 7) + "-01", mto = thu.slice(0, 7) + "-31";
    const sum = (sid) => t.db.prepare("SELECT start_time, end_time FROM shift_assignments WHERE staff_id = ? AND shift_date >= ? AND shift_date <= ?").all(sid, mfrom, mto).reduce((n, r) => { const a = r.start_time.split(":"), z = r.end_time.split(":"); const d = (+z[0] * 60 + +z[1]) - (+a[0] * 60 + +a[1]); return n + (d > 0 ? d : 0); }, 0);
    const shown = await p.evaluate(() => Object.fromEntries([...document.querySelectorAll(".rot-mt tbody tr")].map((tr) => [tr.querySelector("th b").textContent, tr.querySelectorAll("td")[1].querySelector("b").textContent])));
    for (const [sid, n] of [[P1, "Rota Ġużeppi Pharm"], [L, "Rota Ħelena Locum"], [A, "Rota Żaren Assistant"]]) { const h = Math.round(sum(sid) / 6) / 10; t.ok(shown[n] === (Number.isInteger(h) ? String(h) : h.toFixed(1)) + " h", "hours in the month for " + n + ": shown " + shown[n] + ", rows " + h); }
  }
};
