// Roster planner A12 — the rota on paper and in files (eikon.rotaprint.js), from Who's in's Print.
//  - week grid: pharmacy name, page numbers (@page counter), Malta time, black on white, no script (CSP), people as rows with
//    role and hours, days with hours / "Closed · Public holiday (…)", leave words, a shift on approved leave struck "(on leave)",
//    "(acts as pharmacist)" for a role_override, the pharmacist-on-duty row with the cover gap; 0 requests when the screen
//    hands its week in;
//  - month grid: every day of the month on two pages;
//  - list by day == the classic list (buildPrintHtml, C:2948) for a day / month / year / range × everyone / one person:
//    the same days, times, people, notes and "(on leave)" marks;
//  - spreadsheet: the classic columns Date, Start, End, Employee, Role, Notes, one line per shift;
//  - the month .ics == the classic buildICal output for the same month (shift events line for line).
import { rpSeed } from "./_rpseed.mjs";

// The classic list (modules.shifts.js buildPrintHtml) reduced to its facts: per day, per shift: time, name, notes, on-leave.
function classicList(shifts, leaves, staff, staffId) {
  const t2m = (t) => { if (!t) return NaN; const p = String(t).split(":"); return +p[0] * 60 + (+p[1] || 0); };
  const hit = (s) => leaves.some((l) => { if (l.status !== "approved" || l.staff_id !== s.staff_id || l.start_date > s.shift_date || l.end_date < s.shift_date) return false; let ls = 0, le = 1440; if (l.start_date === s.shift_date && l.start_time) ls = t2m(l.start_time); if (l.end_date === s.shift_date && l.end_time) le = t2m(l.end_time); if (!isFinite(ls)) ls = 0; if (!isFinite(le)) le = 1440; if (le <= ls) { ls = 0; le = 1440; } let st = t2m(s.start_time), et = t2m(s.end_time); if (!isFinite(st)) st = 0; if (!isFinite(et)) et = 0; return et > ls && st < le; });
  return shifts.filter((s) => !staffId || s.staff_id === staffId).slice().sort((a, b) => a.shift_date.localeCompare(b.shift_date) || String(a.start_time).localeCompare(String(b.start_time)) || a.id - b.id)
    .map((s) => [s.shift_date, s.start_time + "–" + s.end_time, (staff.find((x) => x.id === s.staff_id) || {}).full_name, s.notes || "", hit(s) ? "on leave" : ""].join(" | "));
}
// The classic buildICal shift events for a month (one person or all).
function classicIcsShifts(shifts, staff, y, mo, emp) {
  const DESIG = { pharmacist: "Pharmacist", locum: "Locum Pharmacist", assistant: "Pharmacy Assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  const esc = (s) => String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); const out = [];
  shifts.forEach((s) => { const p = s.shift_date.split("-"); if (+p[0] !== y || +p[1] - 1 !== mo) return; if (emp && s.staff_id !== emp) return; const e = staff.find((x) => x.id === s.staff_id); const nm = e ? e.full_name : "Staff";
    out.push("BEGIN:VEVENT", "UID:eikon-sh-" + s.id + "@pharmacy.mt", "DTSTART;TZID=Europe/Malta:" + p.join("") + "T" + (s.start_time || "09:00").replace(":", "") + "00", "DTEND;TZID=Europe/Malta:" + p.join("") + "T" + (s.end_time || "18:00").replace(":", "") + "00", "SUMMARY:" + esc(nm + (e ? " (" + (DESIG[e.designation] || e.designation || "Other") + ")" : "")), "DESCRIPTION:" + esc((s.start_time || "") + "–" + (s.end_time || "") + (s.notes ? " | " + s.notes : "")), "END:VEVENT"); });
  return out;
}

export default {
  title: "Print and files: week/month grid, list = classic, spreadsheet, month .ics = classic",
  async run(t) {
    const S = await rpSeed(t, { tag: "print", weeks: 2 });
    const p = await S.page();
    await t.open(p, "2", "rotreg", "rotreg");
    // Who's in on the seeded week
    await p.evaluate((w) => { window.EIKON._rotWeek = w; location.hash = "#teamreg"; }, S.mon);
    await p.waitForFunction(() => window.EIKON.state.activeModuleId !== "rotreg");
    await p.evaluate(() => { location.hash = "#rotreg"; });
    await p.waitForSelector(".rot-grid-wrap, .rot-week"); await t.idle(p);

    // ---- the week from Who's in's Print: 0 requests, a new tab with the page
    const reqs = []; p.on("request", (r) => { if (/\/shifts\//.test(r.url())) reqs.push(r.method() + " " + new URL(r.url()).pathname); });
    await p.click('[data-act="print"]');
    await p.waitForSelector(".rpo-print");
    t.ok(await p.evaluate(() => document.activeElement && document.activeElement.value === "week"), "the chooser opens on 'This week' with focus");
    const tab = p.context().waitForEvent("page", { timeout: 8000 }).catch(() => null);
    await p.click('.rpo-print [data-x="print"]');
    const w = await tab;
    await p.waitForFunction(() => window.EIKON.rotaPrint.last && window.EIKON.rotaPrint.last.kind === "week");
    const last = await p.evaluate(() => window.EIKON.rotaPrint.last);
    t.ok(!!w, "the print opened in a new tab");
    t.ok(last.reads === 0 && reqs.length === 0, "week print: no request (the screen's week handed in): " + JSON.stringify(reqs));
    const H = last.html;
    t.ok(H.includes("RP print Pharmacy") && H.includes("Rota — week of "), "pharmacy name and title");
    t.ok(/counter\(page\)[^}]*counter\(pages\)/.test(H) && /size:A4 landscape/.test(H), "A4 landscape with 'Page n of m'");
    t.ok(/Printed \d{1,2} [A-Z][a-z]{2} \d{4} \d\d:\d\d \(Malta\)/.test(H), "printed time in Malta");
    t.ok(!/<script/i.test(H) && !/ on[a-z]+=/i.test(H), "no script, no inline handlers (CSP)");
    t.ok(/color:#000;background:#fff/.test(H) && !/#[0-9a-f]{6}/i.test(H.replace(/#000|#fff|#eee|#f2f2f2/gi, "")), "black on white, greys only");
    t.ok(H.includes("Pharmacist on duty") && H.includes("No pharmacist 14:00–19:30"), "pharmacist-on-duty row names the Tuesday gap");
    t.ok(/Rita Camilleri[\s\S]*Annual leave/.test(H) && /class="t x">11:30–19:30<\/span><span class="n ol">\(on leave\)/.test(H), "Rita: 'Annual leave' and her shift that day struck '(on leave)'");
    t.ok(/09:00–17:00<\/span><span class="n">\(acts as pharmacist\)/.test(H), "role_override: '(acts as pharmacist)'");
    t.ok(H.includes("Marija Ċassar") && /Pharmacist · \d+(\.\d)? h of 40 h/.test(H), "people with role and hours of contract");
    t.ok(/Sun \d+ [A-Z][a-z]{2}<\/b><small>Closed/.test(H), "Sunday closed in its heading");
    if (w) { await w.waitForLoadState().catch(() => {}); const body = await w.evaluate(() => document.body.innerText).catch(() => ""); t.ok(/Pharmacist on duty/.test(body), "the tab shows the printed rota"); await w.close().catch(() => {}); }

    // ---- month grid: every day, two pages; holiday words (the seeded override opens the first holiday)
    const mo = await p.evaluate(async (d) => (await window.EIKON.rotaPrint({ kind: "month", from: d, open: false })), S.mon);
    const days = new Date(+S.mon.slice(0, 4), +S.mon.slice(5, 7), 0).getDate();
    t.ok((mo.html.match(/<th scope="col"><b>/g) || []).length === days && /class="pb"/.test(mo.html) && mo.html.includes("Rota — "), "month grid: " + days + " day columns over two pages");

    // ---- list by day == classic, for day / month / year / range × all / one person
    const staff = S.people, leaves = (await S.api("GET", "/shifts/leaves?year=" + S.mon.slice(0, 4))).leaves;
    const cases = [{ from: S.d(3), to: S.d(3) }, { from: S.mon.slice(0, 8) + "01", to: S.d(13) }, { from: S.mon.slice(0, 4) + "-01-01", to: S.mon.slice(0, 4) + "-12-31" }, { from: S.d(1), to: S.d(9) }];
    for (const c of cases) for (const who of [null, S.ids.rita]) {
      const r = await p.evaluate(async (o) => window.EIKON.rotaPrint({ kind: "list", from: o.from, to: o.to, person: o.who, open: false }), { ...c, who });
      const ours = [...r.html.matchAll(/<h2>[A-Za-z]+ (\d{1,2} [A-Z][a-z]{2} \d{4})[^<]*<\/h2><table>[\s\S]*?<\/table>/g)].flatMap((m) => [...m[0].matchAll(/<tr><td>(?:<span class="x">)?([\d:]+–[\d:]+)(?:<\/span>)?<\/td><td>(?:<span class="x">)?([^<]*)(?:<\/span>)?(?: <b[^>]*>\(on leave\)<\/b>)?<\/td><td>[\s\S]*?<\/td><td>(?:<span class="x">)?([^<]*)(?:<\/span>)?<\/td><\/tr>/g)].map((x) => [new Date(m[1] + " 12:00 UTC").toISOString().slice(0, 10), x[1], x[2], x[3].replace(/&#39;/g, "'"), /\(on leave\)/.test(x[0]) ? "on leave" : ""].join(" | ")));
      const rows = (await S.api("GET", "/shifts/assignments-range?from=" + c.from + "&to=" + c.to + (who ? "&staff_id=" + who : ""))).shifts;
      const want = classicList(rows, leaves, staff, who);
      t.ok(JSON.stringify(ours) === JSON.stringify(want), `list ${c.from}–${c.to} ${who ? "Rita" : "everyone"}: ${ours.length} lines == classic ${want.length}` + (JSON.stringify(ours) === JSON.stringify(want) ? "" : " · ours " + JSON.stringify(ours.slice(0, 3)) + " classic " + JSON.stringify(want.slice(0, 3))));
      if (who && c.from === c.to) t.ok(/\(on leave\)/.test(r.html) && r.html.includes("Shifts — "), "Rita's leave day: her shift struck (on leave)");
    }

    // ---- spreadsheet from the chooser: the classic columns, every shift of the week
    await p.check('input[name="rpo-kind"][value="week"]');
    const dl = p.waitForEvent("download", { timeout: 8000 });
    await p.click('.rpo-print [data-x="csv"]');
    const file = await dl; const txt = await p.evaluate(() => window.EIKON.rotaPrint.lastFile.text);
    const lines = txt.replace(/^\ufeff/, "").split("\r\n");
    t.ok(file.suggestedFilename() === "rota-" + S.mon + "-to-" + S.d(6) + ".csv", "file name: " + file.suggestedFilename());
    t.ok(lines[0] === "Date,Start,End,Employee,Role,Notes" && lines.length - 1 === S.rows(S.mon, S.d(6)).length, "CSV: classic columns, one line per shift (" + (lines.length - 1) + ")");
    t.ok(lines.some((l) => l === S.d(3) + ",11:30,19:30,Rita Camilleri,Pharmacy assistant,on her leave day"), "a line in full, Maltese-safe (BOM first)");
    t.ok(/Downloaded rota-/.test(await p.textContent(".rpo-print .rpo-ok")), "says what was downloaded");

    // ---- month .ics == classic buildICal (shift events line for line; leave: the month's, that person's)
    const ics = await p.evaluate(async (o) => { const E = window.EIKON; const st = (await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" })).staff; const sh = (await E.apiFetch("/shifts/assignments-range?from=" + o.from + "&to=" + o.to, { method: "GET" })).shifts; const lv = (await E.apiFetch("/shifts/leaves?year=" + o.y, { method: "GET" })).leaves; return { all: E.rotaCal.ics({ year: o.y, month: o.m, staff: st, shifts: sh, leaves: lv }), rita: E.rotaCal.ics({ year: o.y, month: o.m, staffId: o.rita, staff: st, shifts: sh, leaves: lv }) }; },
      { y: +S.d(3).slice(0, 4), m: +S.d(3).slice(5, 7) - 1, from: S.d(3).slice(0, 8) + "01", to: S.d(3).slice(0, 8) + "31", rita: S.ids.rita });
    const monthRows = (await S.api("GET", "/shifts/assignments-range?from=" + S.d(3).slice(0, 8) + "01&to=" + S.d(3).slice(0, 8) + "31")).shifts;
    const ev = (x) => x.split("\r\n").filter((l) => !/^DTSTAMP/.test(l)).join("\n").match(/BEGIN:VEVENT\nUID:eikon-sh[\s\S]*?END:VEVENT/g) || [];
    const want = classicIcsShifts(monthRows, staff, +S.d(3).slice(0, 4), +S.d(3).slice(5, 7) - 1).join("\n");
    t.ok(ev(ics.all).join("\n") === want && ev(ics.all).length > 0, "month .ics shift events == classic (" + ev(ics.all).length + ")");
    t.ok(/SUMMARY:Rita Camilleri — annual leave/.test(ics.rita) && !/Karl Zammit/.test(ics.rita) && /^BEGIN:VCALENDAR\r\nVERSION:2.0/.test(ics.all), "Rita's file: her leave as an all-day event, no one else's");
    t.ok(await p.evaluate(() => !document.querySelector(".rpo-print .rpo-err")), "no error shown");
  }
};
