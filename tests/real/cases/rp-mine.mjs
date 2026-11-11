// Roster planner A11 — Mine on Who's in: who am I on the rota, my next shifts, the calendar link.
//  - the admin "marija  cassar" is Marija Cassar on the rota (case, accents, spaces folded): "Your next shifts" lists her
//    shifts of the next two weeks only (with who works with her), her leave, and no one else's shifts;
//  - the week read is still ONE assignments-range GET (it reaches two weeks ahead on this week): no extra request;
//  - the staff user "Joe Vella" matches two active people → "Which one is you?" → the choice is kept on the device only
//    (nothing written to the server);
//  - the calendar link panel: webcal link with staff_id = me, past/future as classic; the feed returns only that
//    person's shifts; "Make a new link" PUTs the settings read fresh, whole, with only calendarToken changed.
import { rpSeed } from "./_rpseed.mjs";
import { maltaYmd, ymdAdd } from "../../clock.mjs";

export default {
  title: "Mine: who am I, my next shifts, my calendar link",
  async run(t) {
    const S = await rpSeed(t, { tag: "mine", weeks: 3 });
    const T = maltaYmd(0), D = (n) => ymdAdd(T, n);
    const add = async (sid, day, s, e, notes = "") => (await S.api("POST", "/shifts/assignments", { staff_id: sid, shift_date: day, start_time: s, end_time: e, notes })).shift_id;
    // Marija: tomorrow, in 5 days, in 12 days (in) and in 15 days (out of the two weeks); Joe with her tomorrow; Rita on another day.
    await add(S.ids.maria, D(1), "08:00", "14:00", "Ċentru"); await add(S.ids.joe, D(1), "13:00", "19:30"); await add(S.ids.censina, D(1), "15:00", "19:00");
    await add(S.ids.maria, D(5), "09:00", "13:00"); await add(S.ids.maria, D(12), "07:30", "12:30"); await add(S.ids.maria, D(15), "07:30", "12:30");
    await add(S.ids.rita, D(2), "08:00", "12:00");
    const lv = await S.api("POST", "/shifts/leaves", { staff_id: S.ids.maria, leave_type: "annual", start_date: D(8), start_time: null, end_date: D(9), end_time: null, hours_requested: 16, reason: "", status: "pending" });
    // a second active "Joe Vella" (the staff user's name now fits two people)
    await S.api("POST", "/shifts/staff", { full_name: "JOE  VELLA", designation: "assistant", employment_type: "parttime", contracted_hours: 20, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: "{}" });

    // ---- the admin: name match, her next shifts, one GET
    const p = await S.page();
    const gets = []; p.on("request", (r) => { if (r.method() === "GET" && /\/shifts\//.test(r.url())) gets.push(new URL(r.url()).pathname + new URL(r.url()).search); });
    await t.open(p, "2", "rotreg", "rotreg", ".rot-mine");
    const mine = await p.evaluate(() => ({ h: (document.querySelector("#rot-mine-h") || {}).textContent, rows: [...document.querySelectorAll(".rot-mine li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()), who: (document.querySelector(".rot-mine .who") || {}).textContent || "" }));
    t.ok(mine.h === "Your next shifts", "Mine heading: " + mine.h);
    t.ok(/Marija Cassar/.test(mine.who), "shown for Marija Cassar (the folded name match): " + mine.who);
    const shiftRows = mine.rows.filter((r) => /\d\d:\d\d–\d\d:\d\d/.test(r));
    t.ok(shiftRows.length === 3, "three of her shifts in the next two weeks (not the one in 15 days): " + JSON.stringify(mine.rows));
    t.ok(/^Tomorrow 08:00–14:00 with Joe · Ċentru$/.test(shiftRows[0] || ""), "tomorrow's row: time, who overlaps (Joe, not Ċensina who starts after), the note: " + shiftRows[0]);
    t.ok(!mine.rows.some((r) => /12:00$/.test(r) && /08:00–12:00/.test(r)), "no one else's shift in Mine");
    t.ok(mine.rows.some((r) => /Asked for annual leave/.test(r)), "her pending leave is listed: " + JSON.stringify(mine.rows));
    const ranges = gets.filter((g) => g.startsWith("/shifts/assignments-range"));
    { const m = ranges[0] && ranges[0].match(/from=([\d-]+)&to=([\d-]+)/), wk = m && ymdAdd(m[1], 13), two = D(13); // the week's own two weeks, or two weeks from today if later (Mine promises the next two weeks)
      t.ok(ranges.length === 1 && m && m[2] === (two > wk ? two : wk), "one range GET, reaching two weeks from today: " + JSON.stringify(ranges)); }

    // ---- the calendar link from Mine: link for her, the feed has only her shifts
    await p.click('.rot-mine [data-act="cal"]');
    await p.waitForSelector(".rpo-cal .rpo-link");
    const cal = await p.evaluate(() => ({ url: document.querySelector(".rpo-cal .rpo-link").value, sub: document.querySelector('.rpo-cal [data-x="sub"]').getAttribute("href"), focus: document.activeElement && document.activeElement.getAttribute("data-x") }));
    t.ok(cal.url.includes("/shifts/ical?token=" + S.settings.calendarToken) && cal.url.includes("&staff_id=" + S.ids.maria) && /&past=30&future=180$/.test(cal.url), "link: token, staff_id = me, past 30 / future 180: " + cal.url);
    t.ok(cal.sub === cal.url.replace(/^http:\/\//, "webcal://"), "Add to calendar is the webcal: address");
    const subs = await p.evaluate(() => ({ g: document.querySelector('.rpo-cal [data-x="gcal"]').getAttribute("href"), o: document.querySelector('.rpo-cal [data-x="ocal"]').getAttribute("href"), live: document.querySelector(".rpo-cal .rpo-live").textContent, ics: !!document.querySelector('.rpo-cal details [data-x="ics"]') }));
    t.ok(subs.g === "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(cal.sub), "Google Calendar: one-tap add-by-URL with her webcal feed: " + subs.g);
    t.ok(subs.o.startsWith("https://outlook.live.com/calendar/0/addfromweb?url=" + encodeURIComponent(cal.url) + "&name="), "Outlook.com: add-from-web with her feed");
    t.ok(/Updates by itself/.test(subs.live) && /8 to 24 hours/.test(subs.live) && subs.ics, "says it updates by itself (Google 8–24 h); the month file is the secondary option");
    t.ok(cal.focus === "who", "focus moves into the panel");
    const feed = await t.stack.app.api("GET", new URL(cal.url).pathname + new URL(cal.url).search, {});
    const uids = [...feed.text.matchAll(/UID:shift-(\d+)@/g)].map((m) => Number(m[1]));
    const herRows = t.db.prepare("SELECT id FROM shift_assignments WHERE location_id = ? AND staff_id = ?").all(S.loc, S.ids.maria).map((r) => r.id);
    t.ok(feed.status === 200 && uids.length >= 4 && uids.every((id) => herRows.includes(id)), "the feed answers with her shifts only: " + uids.length + " events, all hers");
    // the team link
    await p.selectOption('.rpo-cal [data-x="who"]', "");
    const team = await p.inputValue(".rpo-cal .rpo-link");
    t.ok(!/staff_id=/.test(team), "Everyone: the team link has no staff_id: " + team);

    // ---- make a new link: settings read fresh and PUT whole (a rule changed meanwhile survives), only the token differs
    await S.api("PUT", "/shifts/settings", { ...S.settings, minPharmacists: 2, rota: { minStaff: 2 } }); // another device, after this page read the rules
    const before = JSON.parse(t.db.prepare("SELECT settings_json FROM shift_settings WHERE location_id = ?").get(S.loc).settings_json);
    await p.click('.rpo-cal summary:has-text("Make a new link")');
    await p.click('.rpo-cal [data-x="new"]'); // first press asks
    const ask = await p.textContent('.rpo-cal [data-x="new"]');
    t.ok(/stop the old link/.test(ask), "the first press asks: " + ask);
    const w = await t.write(p, /\/shifts\/settings$/, () => p.click('.rpo-cal [data-x="new"]'), "PUT");
    const after = JSON.parse(t.db.prepare("SELECT settings_json FROM shift_settings WHERE location_id = ?").get(S.loc).settings_json);
    const strip = (o) => { const c = { ...o }; delete c.calendarToken; return JSON.stringify(c); };
    t.ok(strip(after) === strip(before) && after.calendarToken !== before.calendarToken && /^[a-z2-7]{32}$/.test(after.calendarToken), "new link: same settings (minPharmacists 2, rota kept), new 32-letter token");
    t.ok(JSON.stringify(Object.keys(w.body || {}).sort()) === JSON.stringify(Object.keys(before).sort()), "PUT body = the whole settings object (classic body)");
    const tok = t.db.prepare("SELECT token FROM shift_calendar_tokens WHERE location_id = ?").get(S.loc);
    t.ok(tok && tok.token === after.calendarToken, "the public token table follows");
    await p.waitForFunction((tk) => document.querySelector(".rpo-cal .rpo-link") && document.querySelector(".rpo-cal .rpo-link").value.includes(tk), after.calendarToken);

    // ---- the staff user: "Joe Vella" fits two people → chooser; the choice stays on this device
    const q = await S.page({ phone: true, staff: true });
    await t.open(q, "2", "rotreg", "rotreg", ".rot-mine");
    const asked = await q.evaluate(() => ({ h: document.querySelector("#rot-mine-h").textContent, opts: [...document.querySelectorAll('[data-x="me-pick"] option')].map((o) => o.textContent) }));
    t.ok(asked.h === "See your own shifts first" && /Joe Vella/.test(asked.opts[0]) && /joe\s+vella/i.test(asked.opts[1]), "two people called Joe Vella: asked which one, the name matches first: " + JSON.stringify(asked));
    const writes = []; q.on("request", (r) => { if (r.method() !== "GET" && /\/shifts\//.test(r.url())) writes.push(r.url()); });
    await q.selectOption('[data-x="me-pick"]', String(S.ids.joe));
    await q.click('[data-act="me-set"]');
    await q.waitForFunction(() => document.querySelector("#rot-mine-h") && document.querySelector("#rot-mine-h").textContent === "Your next shifts");
    const joe = await q.evaluate(() => ({ who: document.querySelector(".rot-mine .who").textContent, rows: [...document.querySelectorAll(".rot-mine li")].map((li) => li.innerText.replace(/\s+/g, " ").trim()), ls: Object.keys(localStorage).filter((k) => k.startsWith("eikon_rota_me:")) }));
    t.ok(/Joe Vella/.test(joe.who) && joe.rows.length === 1 && /13:00–19:30 with Marija/.test(joe.rows[0]), "Joe's shift, with Marija: " + JSON.stringify(joe.rows));
    t.ok(joe.ls.length === 1 && writes.length === 0, "kept on the device only (" + joe.ls[0] + "), nothing written: " + writes.length);
    await q.reload(); await q.waitForSelector(".rot-mine .who");
    t.ok(/Joe Vella/.test(await q.textContent(".rot-mine .who")), "still Joe after a reload");
    // the phone: no sideways scroll, Mine first under the week arrows
    const lay = await q.evaluate(() => ({ sw: document.documentElement.scrollWidth, order: [...document.querySelectorAll(".rot-nav, .rot-mine, .rot-week")].map((e) => e.className.split(" ")[0]) }));
    t.ok(lay.sw <= 390 && /^rot-nav,rot-mine(,rot-week)?$/.test(lay.order.join()), "phone: no sideways scroll, Mine right under the week arrows: " + JSON.stringify(lay));
    void lv;
  }
};
