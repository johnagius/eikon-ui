// Roster planner (RP round): the shared busy-pharmacy seed for every rp-* case. Each case gets ITS OWN pharmacy
// (a new location in Maria's org, an admin and a staff sign-in), so cases running in parallel never share opening hours,
// settings, people or shifts, and the main Demo Pharmacy (rota, swaps, team, team6c…) is untouched.
//
//   import { rpSeed } from "./_rpseed.mjs";
//   const S = await rpSeed(t, { tag: "patterns", weeks: 2 });
//   S.api(method, path, body[, token])   S.page({ phone, staff })   S.ids.{maria,joe,lara,karl,rita,ċensina,ħelena,locum}
//   S.mon (see below), S.d(i) = S.mon + i days, S.hol = { date, name } (first Malta holiday on or after S.mon,
//   within 13 months), S.closedDay / S.openDay (overrides), S.leave.{whole,part,pending} ids, S.people (the 8 rows)
//
// The pharmacy: 8 people — 2 pharmacists (one with a Maltese name), 1 locum, a manager, 3 assistants (one part-time
// 20 h), a cashier; Maria (pharmacist) has a classic weekly pattern "Usual" Mon–Fri 08:00–14:00, Sat 08:00–13:00 as
// provisional; opening hours Mon–Fri 07:30–19:30, Sat 08:00–13:00, Sun closed; one override closing a weekday ("Staff
// training") and one opening the first public holiday ("Duty roster"); settings pharmacistRequired true, minPharmacists 1,
// calendarToken set. Leave: Rita (assistant) approved whole-day annual on S.d(3); Karl approved part-day 08:00–12:00 on
// S.d(8); Lara pending annual S.d(9). Shifts in the first week (S.mon … S.mon+6, 23 rows): a realistic week with ONE
// pharmacist gap (Tue S.d(1) 14:00–19:30), one shift Rita has on her leave day (S.d(3)), a locum, a role_override row.
// S.mon = the first Monday ≥ `weeks` ahead with no public holiday in its two weeks. Nothing before S.mon is touched.
import { maltaYmd, ymdAdd } from "../../clock.mjs";

const HOL = (ymd) => { // the same list as E.maltaHoliday (ui/core.js) — copied, so the seed does not need a page
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd); const y = +m[1];
  const fixed = { "01-01": "New Year's Day", "02-10": "St Paul's Shipwreck", "03-19": "St Joseph", "03-31": "Freedom Day", "05-01": "Worker's Day", "06-07": "Sette Giugno", "06-29": "St Peter and St Paul", "08-15": "Santa Marija", "09-08": "Victory Day", "09-21": "Independence Day", "12-08": "Immaculate Conception", "12-13": "Republic Day", "12-25": "Christmas Day" };
  if (fixed[m[2] + "-" + m[3]]) return fixed[m[2] + "-" + m[3]];
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451), mo = Math.floor((h + l - 7 * mm + 114) / 31), dy = ((h + l - 7 * mm + 114) % 31) + 1;
  return new Date(Date.UTC(y, mo - 1, dy - 2)).toISOString().slice(0, 10) === ymd ? "Good Friday" : "";
};
export const monday = (n = 1) => { const t = maltaYmd(0); return ymdAdd(t, n * 7 - ((new Date(t + "T12:00:00Z").getUTCDay() + 6) % 7)); };
export const maltaHoliday = HOL;

let seq = 0;
export async function rpSeed(t, { tag = "rp", weeks = 1 } = {}) {
  const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
  const lid = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(lid, org, "RP " + tag + " Pharmacy");
  const u = tag.replace(/[^a-z0-9]/gi, "").toLowerCase() + (++seq);
  // The admin's name is a person on the rota written differently (Mine's name match: case, accents, spaces folded).
  const admin = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "rp-" + u + "@demo.mt", role: "admin", name: "marija  cassar" });
  const staffU = await t.stack.app.addUser({ orgId: org, locationId: lid, email: "rp-" + u + "-staff@demo.mt", role: "staff", name: "Joe Vella" });
  const api = async (m, p, body, token) => { const r = await t.stack.app.api(m, p, { token: token || admin.token, body }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error("rpSeed " + m + " " + p + " " + r.status + " " + String(r.text).slice(0, 160)); return r.json; };
  await api("GET", "/shifts/staff?include_inactive=1"); // the tables

  // the first Monday on or after `weeks` ahead whose two weeks have no public holiday (so week 1–2 facts hold every year)
  let mon = monday(weeks); while ([...Array(14).keys()].some((i) => HOL(ymdAdd(mon, i)))) mon = ymdAdd(mon, 7);
  const d = (i) => ymdAdd(mon, i);
  const usual = { patterns: [{ id: "p" + u, name: "Usual", week: [0, 1, 2, 3, 4].map(() => ({ off: false, start: "08:00", end: "14:00" })).concat([{ off: false, start: "08:00", end: "13:00" }, { off: true }]), createdAt: new Date().toISOString() }], provisionalId: "p" + u };
  const P = [
    ["maria", "Marija Ċassar", "pharmacist", "fulltime", 40, JSON.stringify(usual)],
    ["joe", "Joe Vella", "pharmacist", "fulltime", 40, "{}"],
    ["helena", "Ħelena Farrugia", "locum", "external", 40, "{}"],
    ["karl", "Karl Zammit", "manager", "fulltime", 40, "{}"],
    ["rita", "Rita Camilleri", "assistant", "fulltime", 40, "{}"],
    ["censina", "Ċensina Żammit", "assistant", "fulltime", 40, "{}"],
    ["lara", "Lara Grech", "assistant", "parttime", 20, "{}"],
    ["gorg", "Ġorġ Borg", "cashier", "fulltime", 40, "{}"]
  ];
  const ids = {};
  for (const [k, full_name, designation, employment_type, contracted_hours, patterns_json] of P) {
    const r = await api("POST", "/shifts/staff", { full_name, designation, employment_type, contracted_hours, email: "", phone: "", registration_number: designation === "pharmacist" ? "PH" + (100 + Object.keys(ids).length) : "", is_active: 1, patterns_json });
    ids[k] = r.staff_id || r.id;
  }
  // first Malta public holiday on or after mon (within ~13 months)
  let hol = null; for (let i = 0; i < 400 && !hol; i++) { const n = HOL(d(i)); if (n) hol = { date: d(i), name: n }; }
  const closedDay = d(10), openDay = hol ? hol.date : null; // d(10) = Thursday of week 2
  const overrides = { [closedDay]: { open: "07:30", close: "19:30", closed: true, note: "Staff training" } };
  if (openDay) overrides[openDay] = { open: "08:00", close: "12:00", closed: false, note: "Duty roster" };
  const hours = { default: { open: "07:30", close: "19:30", closed: false }, weekly: { 0: { open: "07:30", close: "19:30", closed: true }, 1: { open: "07:30", close: "19:30", closed: false }, 2: { open: "07:30", close: "19:30", closed: false }, 3: { open: "07:30", close: "19:30", closed: false }, 4: { open: "07:30", close: "19:30", closed: false }, 5: { open: "07:30", close: "19:30", closed: false }, 6: { open: "08:00", close: "13:00", closed: false } }, openSaturday: true, openSunday: false, overrides };
  await api("PUT", "/shifts/opening-hours", hours);
  const settings = { pharmacistRequired: true, minPharmacists: 1, calendarToken: "rp" + u + "tok" + Math.random().toString(36).slice(2, 10) };
  await api("PUT", "/shifts/settings", settings);

  const lv = async (sid, type, from, to, st, et, hrs, approve) => { const r = await api("POST", "/shifts/leaves", { staff_id: sid, leave_type: type, start_date: from, start_time: st, end_date: to, end_time: et, hours_requested: hrs, reason: "", status: "pending" }); if (approve) await api("POST", "/shifts/leaves/" + r.leave_id + "/approve"); return r.leave_id; };
  const leave = { whole: await lv(ids.rita, "annual", d(3), d(3), null, null, 8, true), part: await lv(ids.karl, "annual", d(8), d(8), "08:00", "12:00", 4, true), pending: await lv(ids.lara, "annual", d(9), d(9), null, null, 8, false) };

  const add = async (sid, day, s, e, notes = "", role) => (await api("POST", "/shifts/assignments", role ? { staff_id: sid, shift_date: day, start_time: s, end_time: e, notes, role_override: role } : { staff_id: sid, shift_date: day, start_time: s, end_time: e, notes })).shift_id;
  const shifts = [];
  for (let i = 0; i < 5; i++) {
    shifts.push(await add(ids.maria, d(i), "07:30", "14:00"));
    if (i !== 1) shifts.push(await add(ids.joe, d(i), "13:30", "19:30")); // Tuesday afternoon: no pharmacist (the gap)
    shifts.push(await add(ids.karl, d(i), "07:30", "15:30"));
    shifts.push(await add(i === 3 ? ids.rita : ids.censina, d(i), "11:30", "19:30", i === 3 ? "on her leave day" : ""));
  }
  shifts.push(await add(ids.maria, d(5), "08:00", "13:00"), await add(ids.lara, d(5), "08:00", "13:00"), await add(ids.helena, d(2), "17:00", "19:30", "Locum cover"));
  shifts.push(await add(ids.gorg, d(4), "09:00", "17:00", "Inventory", "pharmacist")); // a role_override row (round-trip)

  const people = (await api("GET", "/shifts/staff?include_inactive=1")).staff;
  // A signed-in page for this pharmacy (admin by default; { staff: true } = the staff user)
  const page = async ({ phone = false, staff = false } = {}) => {
    const p = await t.page({ phone });
    await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} }, staff ? staffU.token : admin.token);
    return p;
  };
  const rows = (from, to, sid) => db.prepare("SELECT id, staff_id, shift_date, start_time, end_time, role_override, notes FROM shift_assignments WHERE org_id = ? AND location_id = ? AND shift_date BETWEEN ? AND ?" + (sid ? " AND staff_id = ?" : "") + " ORDER BY staff_id, shift_date, start_time").all(...[org, lid, from, to].concat(sid ? [sid] : []));
  return { org, loc: lid, admin, staffUser: staffU, token: admin.token, api, page, ids, people, mon, d, hol, closedDay, openDay, hours, settings, leave, shifts, rows };
}
