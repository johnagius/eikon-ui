// Roster planner engine (ui/eikon.rotaplan.js), unit tests without a browser: storage round trip with the classic
// screen's own normalizePattern, rotation expansion (table-driven: DST weeks, year boundary, Feb 29, anchors in the past
// and future, n = 1..4), every fill option, preview words, the classic apply-pattern bodies, and apply / verify /
// put back / undo against an in-memory server that behaves as the worker does (W1 and the older apply-pattern).
// Run: node --no-warnings tests/ui/rotaplan.unit.mjs     (also run by tests/ui/run.mjs, block "rotaplan engine")
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import vm from "node:vm";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..");
export function load({ withB3 = true } = {}) {
  const core = readFileSync(join(ROOT, "ui/core.js"), "utf8");
  const a = core.indexOf("  E.maltaHoliday = function"), z = core.indexOf("  // ---- end rota ----");
  if (a < 0 || z < 0) throw new Error("core.js rota block not found");
  let block = core.slice(a, z);
  if (!withB3) { const b = block.indexOf("  // ---- rota rules and settings (roster planner, B3) ----"); if (b > 0) block = block.slice(0, b); }
  const store = {};
  const win = { EIKON: { state: { user: { location_id: 7 } } } };
  const ctx = vm.createContext({ window: win, console, Date, Math, JSON, Promise, Intl, setTimeout, clearTimeout,
    sessionStorage: { getItem: (k) => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } }, localStorage: { getItem: () => null, setItem() {} } });
  vm.runInContext("(function(){ var E = window.EIKON; E.maltaYmd = function(){ return window.__today || new Date().toISOString().slice(0,10); };\n" + block + "\n})();", ctx);
  vm.runInContext(readFileSync(join(ROOT, "ui/eikon.rotaplan.js"), "utf8"), ctx);
  return { E: win.EIKON, win, store };
}

// The classic Shifts screen's pattern normalisation (modules.shifts.js normalizePattern / isOffEntry / parseBool), verbatim logic.
function parseBool(v) { if (v === true || v === 1) return true; if (v === false || v === 0 || v == null) return false; if (typeof v === "string") { const s = v.trim().toLowerCase(); if (!s) return false; if (["true", "1", "yes", "y", "on"].includes(s)) return true; if (["false", "0", "no", "n", "off"].includes(s)) return false; } return !!v; }
function isOffEntry(e) { e = e && typeof e === "object" ? e : {}; if (parseBool(e.off)) return true; const st = String(e.start || e.start_time || "").trim(), et = String(e.end || e.end_time || "").trim(); return !st || !et; }
function classicNormalize(p) {
  p = p && typeof p === "object" ? p : {};
  const week = Array.isArray(p.week) ? p.week.slice(0, 7) : []; while (week.length < 7) week.push({ off: true });
  return { id: String(p.id || "pat_x"), name: String(p.name || "Pattern"), week: week.map((d) => { d = d && typeof d === "object" ? d : {}; const off = isOffEntry(d); const st = String(d.start || d.start_time || "").trim(), et = String(d.end || d.end_time || "").trim(), ro = String(d.role_override || "").trim(); return off ? { off: true } : { off: false, start: st, end: et, role_override: ro }; }), createdAt: p.createdAt || Date.now() };
}
const classicResave = (pj) => { const o = JSON.parse(pj); return JSON.stringify({ patterns: (o.patterns || []).map(classicNormalize), provisionalId: o.provisionalId }); };

// An in-memory server with the worker's rules for the routes the engine uses.
export function fakeServer(E, { w1 = true } = {}) {
  const S = { rows: [], next: 1, calls: [], failNext: null, failAfterDelete: false, w1 };
  const ins = (sid, d) => { const r = { id: S.next++, staff_id: sid, shift_date: d.date, start_time: d.start_time, end_time: d.end_time, role_override: d.role_override || "", notes: d.notes || "" }; S.rows.push(r); return r; };
  E.apiFetch = async (path, opts = {}) => {
    const method = (opts.method || "GET").toUpperCase(), body = opts.body ? JSON.parse(opts.body) : null;
    S.calls.push({ method, path, body });
    const u = new URL("http://x" + path);
    const fail = S.failNext && S.failNext(method, u.pathname, body); if (fail) { S.failNext = null; if (fail.before !== false) throw fail.err; }
    const err = (status, j) => { const e = new Error(j.error || "HTTP " + status); e.status = status; e.bodyJson = j; throw e; };
    let out;
    if (method === "GET" && u.pathname === "/shifts/assignments-range") {
      const f = u.searchParams.get("from"), t = u.searchParams.get("to"), sid = u.searchParams.get("staff_id");
      out = { ok: true, shifts: S.rows.filter((r) => r.shift_date >= f && r.shift_date <= t && (!sid || String(r.staff_id) === sid)).sort((a, b) => (a.shift_date + a.start_time).localeCompare(b.shift_date + b.start_time)).map((r) => ({ ...r })) };
    } else if (method === "POST" && u.pathname === "/shifts/apply-plan") {
      if (!S.w1) err(404, { ok: false, error: "Not found" });
      for (const it of body.items) {
        const mine = S.rows.filter((r) => r.staff_id === it.staff_id && r.shift_date >= it.from && r.shift_date <= it.to);
        if (!it.remove.every((id) => mine.some((r) => r.id === id)) || (it.seen && (it.seen.length !== mine.length || !mine.every((r) => it.seen.includes(r.id))))) err(409, { ok: false, code: "changed", staff_ids: [it.staff_id] });
      }
      for (const it of body.items) { S.rows = S.rows.filter((r) => !it.remove.includes(r.id)); for (const a of it.add) ins(it.staff_id, a); }
      out = { ok: true };
    } else if (method === "POST" && u.pathname === "/shifts/apply-pattern") {
      const { staff_id, start_date: s, end_date: e, mode, dates } = body;
      let taken = new Set();
      if (mode === "fill") taken = new Set(S.rows.filter((r) => r.staff_id === staff_id && r.shift_date >= s && r.shift_date <= e).map((r) => r.shift_date));
      else S.rows = S.rows.filter((r) => !(r.staff_id === staff_id && r.shift_date >= s && r.shift_date <= e));
      if (S.failAfterDelete) { S.failAfterDelete = false; const x = new Error("HTTP 500"); x.status = 500; throw x; } // not one transaction: the DELETE landed
      let n = 0; for (const d of dates) { if (d.date < s || d.date > e || taken.has(d.date)) continue; ins(staff_id, d); n++; }
      out = { ok: true, inserted: n };
    } else err(404, { ok: false, error: "Not found " + path });
    if (fail && fail.before === false) throw fail.err; // the write landed, the answer was lost
    return out;
  };
  S.add = (sid, date, s, e, extra = {}) => ins(sid, { date, start_time: s, end_time: e, ...extra });
  return S;
}

export const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const eq = (a, b, m) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((m || "not equal") + "\n   got: " + JSON.stringify(a).slice(0, 600) + "\n  want: " + JSON.stringify(b).slice(0, 600)); };
const ok = (c, m) => { if (!c) throw new Error(m || "not ok"); };

const HOURS = { default: { open: "07:30", close: "19:30", closed: false }, weekly: { 0: { open: "07:30", close: "19:30", closed: true }, 1: { open: "07:30", close: "19:30", closed: false }, 2: { open: "07:30", close: "19:30", closed: false }, 3: { open: "07:30", close: "19:30", closed: false }, 4: { open: "07:30", close: "19:30", closed: false }, 5: { open: "07:30", close: "19:30", closed: false }, 6: { open: "08:00", close: "13:00", closed: false } }, openSaturday: true, openSunday: false, overrides: {} };
const SET = { pharmacistRequired: true, minPharmacists: 1 };
const MARIA = { id: 11, full_name: "Marija Cassar", designation: "pharmacist", is_active: 1 };
const JOE = { id: 12, full_name: "Joe Vella", designation: "pharmacist", is_active: 1 };
const RITA = { id: 13, full_name: "Rita Camilleri", designation: "assistant", is_active: 1 };
const MF = (s, e) => [0, 1, 2, 3, 4].map(() => ({ start: s, end: e }));
const altSat = (anchor) => ({ rid: "k3f9", n: 2, anchor, name: "Usual", weeks: [[...MF("08:00", "14:00"), { start: "08:00", end: "13:00" }, null], [...MF("08:00", "14:00"), null, null]] });

test("parse: a classic plain pattern is the usual one, in Mon..Sun order", ({ E }) => {
  const pj = JSON.stringify({ patterns: [{ id: "pabc", name: "Usual", week: [{ off: true }, ...MF("08:00", "14:00").map((b) => ({ off: false, ...b })), { off: false, start: "08:00", end: "13:00" }], createdAt: 5 }], provisionalId: "pabc" });
  const s = E.rotaPlan.parse(pj);
  eq([s.usual, s.plain.length, s.rotations.length], ["pabc", 1, 0]);
  eq(s.plain[0].week.map((d) => d && d.start + "-" + d.end), ["08:00-14:00", "08:00-14:00", "08:00-14:00", "08:00-14:00", "08:00-14:00", "08:00-13:00", null]);
  eq(E.rotaPlan.parse("[]").plain, [], "an older row's '[]'");
  eq(E.rotaPlan.parse("not json").rotations, []);
});

test("storage: a 2-week rotation with a split day, role and note round-trips; ids/names/provisional as SPEC §2.3", ({ E }) => {
  const P = E.rotaPlan, r = altSat("2026-11-18"); // anchor moved to its Monday
  r.weeks[0][2] = [{ start: "08:00", end: "12:00", role_override: "pharmacist" }, { start: "15:00", end: "19:30", notes: "Ħal Qormi" }];
  const pj = P.toPatternsJson({ rotations: [r], plain: [{ id: "pold", name: "Old", week: [null, null, null, null, null, { start: "09:00", end: "12:00" }, null] }], usual: "k3f9" });
  const o = JSON.parse(pj);
  eq(Object.keys(o), ["patterns", "provisionalId"]);
  eq(o.patterns.map((p) => p.id), ["pold", "rot.k3f9.1of2.2026-11-16", "rot.k3f9.1of2.2026-11-16.b", "rot.k3f9.2of2.2026-11-16"]);
  eq(o.patterns.map((p) => p.name), ["Old", "Usual · week A of 2", "Usual · week A of 2 · second shift", "Usual · week B of 2"]);
  eq(o.provisionalId, "rot.k3f9.1of2.2026-11-16");
  eq(o.patterns[1].week[3], { off: false, start: "08:00", end: "12:00", role_override: "pharmacist" }, "classic index 3 = Wednesday");
  eq(o.patterns[1].week[6], { off: false, start: "08:00", end: "13:00", role_override: "" }, "Saturday week A");
  eq(o.patterns[3].week[6], { off: true }, "Saturday week B off");
  const back = P.parse(pj);
  eq([back.usual, back.rotations.length, back.rotations[0].n, back.rotations[0].anchor, back.rotations[0].name], ["k3f9", 1, 2, "2026-11-16", "Usual"]);
  eq(back.rotations[0].weeks[0][2], [{ start: "08:00", end: "12:00", role_override: "pharmacist", notes: "" }, { start: "15:00", end: "19:30", role_override: "", notes: "Ħal Qormi" }]);
  eq(P.toPatternsJson(back), pj.replace(/"createdAt":\d+/g, (m) => m), "parse → toPatternsJson is stable");
  eq(JSON.parse(P.toPatternsJson(back)).patterns.map((p) => p.id), o.patterns.map((p) => p.id));
});

test("classic round trip: the classic screen's employee save (normalizePattern) keeps ids, names, times and roles; the planner still reads the rotation", ({ E }) => {
  const P = E.rotaPlan, pj = P.toPatternsJson({ rotations: [altSat("2026-11-16")], usual: "k3f9" });
  const after = classicResave(pj), s = P.parse(after);
  eq(JSON.parse(after).patterns.map((p) => [p.id, p.name]), JSON.parse(pj).patterns.map((p) => [p.id, p.name]));
  eq([s.usual, s.rotations[0].n, P.summary(s.rotations[0], "2026-11-16")], ["k3f9", 2, "Mon–Fri 08:00–14:00 · Saturdays 08:00–13:00 every other week (next on 21 Nov)"]);
  // a classic-made plain pattern is a 1-week rotation for the planner
  const u = P.usualOf({ patterns_json: JSON.stringify({ patterns: [classicNormalize({ id: "p1", name: "Usual", week: [{ off: true }, { start: "08:00", end: "14:00" }] })], provisionalId: "p1" }) });
  eq([u.n, u.weeks[0][0]], [1, { start: "08:00", end: "14:00", role_override: "", notes: "" }]);
});

test("weekIndex: anchors in the past and future, n = 1..4, DST weeks, year boundary, Feb 29", ({ E }) => {
  const P = E.rotaPlan;
  const rows = [
    ["2026-11-16", "2026-11-16", 2, 0], ["2026-11-22", "2026-11-16", 2, 0], ["2026-11-23", "2026-11-16", 2, 1], ["2026-11-09", "2026-11-16", 2, 1], ["2026-11-02", "2026-11-16", 2, 0],
    ["2027-03-29", "2026-11-16", 2, 1], ["2027-03-28", "2026-11-16", 2, 0], ["2027-11-01", "2026-11-16", 2, 0], ["2027-10-31", "2026-11-16", 2, 1],
    ["2027-01-01", "2026-12-28", 3, 0], ["2027-01-04", "2026-12-28", 3, 1], ["2028-02-29", "2028-02-28", 4, 0], ["2028-03-06", "2028-02-28", 4, 1], ["2028-02-21", "2028-02-28", 4, 3],
    ["2030-06-12", "2026-11-16", 1, 0], ["2026-11-19", "2026-11-18", 2, 0]
  ];
  eq(rows.map(([d, a, n]) => P.weekIndex(d, a, n)), rows.map((r) => r[3]));
});

test("A1 expansion: alternate Saturdays over 12 months — holidays closed, an override opens one, Sundays closed, whole-day leave skipped, part-day trimmed, pending asked", ({ E, win }) => {
  const P = E.rotaPlan; win.__today = "2026-11-10";
  const hours = JSON.parse(JSON.stringify(HOURS)); hours.overrides["2026-12-26"] = { open: "08:00", close: "12:00", closed: false, note: "Duty roster" }; // a Saturday, St Stephen is not a Malta PH; Christmas is
  hours.overrides["2026-12-25"] = { open: "08:00", close: "12:00", closed: false, note: "Duty roster" }; // opens Christmas Day (a Friday)
  const leaves = [{ staff_id: 11, status: "approved", leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-02" },
    { staff_id: 11, status: "approved", leave_type: "annual", start_date: "2026-12-03", end_date: "2026-12-03", start_time: "08:00", end_time: "11:00" },
    { staff_id: 11, status: "approved", leave_type: "sick", start_date: "2026-12-04", end_date: "2026-12-04", start_time: "08:00", end_time: "13:30" },
    { staff_id: 11, status: "pending", leave_type: "annual", start_date: "2026-12-07", end_date: "2026-12-07" },
    { staff_id: 12, status: "approved", leave_type: "annual", start_date: "2026-11-16", end_date: "2027-11-16" }];
  const x = P.expand({ person: MARIA, rotation: altSat("2026-11-16"), from: "2026-11-16", to: "2027-11-15", hours, settings: SET, leaves, existing: [] });
  const adds = x.add.map((r) => r.date);
  ok(adds.includes("2026-11-21") && !adds.includes("2026-11-28") && adds.includes("2026-12-05") && !adds.includes("2026-12-12"), "Saturdays only in week A");
  ok(!adds.some((d) => new Date(d + "T12:00:00Z").getUTCDay() === 0), "never a Sunday");
  // every Malta holiday on a working day of the pattern (Christmas is opened by its override; 1 May 2027 is a week-B Saturday)
  eq(x.skip.filter((s) => s.why === "holiday").map((s) => s.date), ["2026-12-08", "2027-01-01", "2027-02-10", "2027-03-19", "2027-03-26", "2027-03-31", "2027-06-07", "2027-06-29", "2027-09-08", "2027-09-21"]);
  eq(x.skip.find((s) => s.date === "2027-03-26").words, "Public holiday (Good Friday)");
  ok(adds.includes("2026-12-25"), "the override opens Christmas Day");
  eq(x.add.find((r) => r.date === "2026-12-25").start_time, "08:00");
  eq(x.skip.filter((s) => s.why === "leave").map((s) => s.date), ["2026-12-01", "2026-12-02"]);
  eq(x.add.find((r) => r.date === "2026-12-03"), { date: "2026-12-03", start_time: "11:00", end_time: "14:00", role_override: "", notes: "", staff_id: 11, week: "A", trimmed: true }, "part-day leave trimmed to the free part");
  eq(x.skip.find((s) => s.date === "2026-12-04").why, "leave-part", "less than 1 h left: skipped");
  ok(x.add.find((r) => r.date === "2026-12-07").asked && x.asked.length === 1, "pending leave: added, flagged");
  ok(/Marija asked for annual leave on Mon 7 Dec/.test(x.asked[0].words));
  ok(x.add.every((r) => r.date >= "2026-11-16" && r.date <= "2027-11-15") && x.add.length > 250 && x.add.length < 275, "≈ 260 shifts in 12 months: " + x.add.length);
  ok(x.add.every((r) => r.week === "A" || r.week === "B"), "every add says its week");
});

test("expand Keep vs Replace: Keep leaves busy days; Replace removes only targeted days' other shifts and keeps an identical one (same id)", ({ E }) => {
  const P = E.rotaPlan, rot = { n: 1, weeks: [[{ start: "08:00", end: "14:00" }, { start: "08:00", end: "14:00" }, { start: "08:00", end: "14:00" }, null, null, null, null]] };
  const ex = [{ id: 1, staff_id: 11, shift_date: "2026-11-16", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" },
    { id: 2, staff_id: 11, shift_date: "2026-11-17", start_time: "13:30", end_time: "19:30", role_override: "", notes: "cover Joe" },
    { id: 3, staff_id: 11, shift_date: "2026-11-19", start_time: "09:00", end_time: "12:00", role_override: "", notes: "" },
    { id: 4, staff_id: 12, shift_date: "2026-11-18", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }];
  const base = { person: MARIA, rotation: rot, from: "2026-11-16", to: "2026-11-22", hours: HOURS, settings: SET, existing: ex };
  const k = P.expand(base);
  eq([k.add.map((r) => r.date), k.keep.map((r) => r.id), k.remove, k.snapshot.map((r) => r.id)], [["2026-11-18"], [1, 2], [], [1, 2, 3]]);
  const r = P.expand({ ...base, mode: "replace" });
  eq([r.add.map((x) => x.date), r.keep.map((x) => x.id), r.remove.map((x) => x.id)], [["2026-11-17", "2026-11-18"], [1], [2]], "Thursday (pattern off) keeps its shift");
  const pv = P.preview([], r, "replace");
  eq(pv.words.removes, "Removes 1 shift: Tue 17 Nov 13:30–19:30 (note: 'cover Joe')");
  eq(pv.words.button, "Add 2, remove 1");
});

test("availability: a weekday they can't work is skipped with B3's words unless 'add anyway'; without B3's helpers the same", () => {
  for (const withB3 of [true, false]) {
    const { E } = load({ withB3 });
    const avail = { 13: { w: { 4: "no" }, d: { "2026-11-20": { from: "12:00", to: "19:30" } } } };
    const x = E.rotaPlan.weekdays({ people: [RITA], from: "2026-11-16", to: "2026-11-22", weekdays: [1, 2, 3, 4, 5], block: { start: "08:00", end: "14:00" }, data: { hours: HOURS, settings: { ...SET, rota: { avail } } } })[0];
    eq(x.skip.map((s) => [s.date, s.why, s.words]), [["2026-11-19", "unavailable", "Rita can't work Thursdays"], ["2026-11-20", "unavailable", "Rita can only work 12:00–19:30 on Fri 20 Nov"]], "withB3=" + withB3);
    const y = E.rotaPlan.weekdays({ people: [RITA], from: "2026-11-16", to: "2026-11-22", weekdays: [4], block: { start: "08:00", end: "14:00" }, anyway: true, data: { hours: HOURS, settings: { ...SET, rota: { avail } } } })[0];
    eq(y.add.map((r) => r.date), ["2026-11-19"]);
  }
});

test("weekdays: Mon–Fri every other week from a range; weekends every week; every 3rd week", ({ E }) => {
  const P = E.rotaPlan, d = { hours: { ...HOURS, weekly: { ...HOURS.weekly, 0: { open: "08:00", close: "12:00", closed: false } } }, settings: SET };
  const a = P.weekdays({ people: [RITA], from: "2026-11-16", to: "2026-12-13", weekdays: [1, 2, 3, 4, 5], every: 2, block: { start: "08:00", end: "14:00" }, data: d })[0];
  eq(a.add.map((r) => r.date.slice(8)), ["16", "17", "18", "19", "20", "30", "01", "02", "03", "04"], "weeks 1 and 3");
  const b = P.weekdays({ people: [RITA], from: "2026-11-16", to: "2026-11-29", weekdays: [6, 7], block: { start: "08:00", end: "12:00" }, data: d })[0];
  eq(b.add.map((r) => r.date), ["2026-11-21", "2026-11-22", "2026-11-28", "2026-11-29"]);
  const c = P.weekdays({ people: [RITA], from: "2026-11-16", to: "2027-01-10", weekdays: [3], every: 3, block: { start: "09:00", end: "13:00" }, data: d })[0];
  eq(c.add.map((r) => r.date), ["2026-11-18", "2026-12-09", "2026-12-30"]);
});

test("A8 repeat/copy: a week ×4 (notes, roles, two shifts a day kept; holiday and leave skipped); until a date; a day to every day; a month keeping weekdays; copy a week elsewhere", ({ E }) => {
  const P = E.rotaPlan;
  const src = [{ id: 1, staff_id: 11, shift_date: "2026-11-16", start_time: "08:00", end_time: "12:00", role_override: "", notes: "am" }, { id: 2, staff_id: 11, shift_date: "2026-11-16", start_time: "15:00", end_time: "19:30", role_override: "", notes: "pm" },
    { id: 3, staff_id: 13, shift_date: "2026-11-17", start_time: "09:00", end_time: "17:00", role_override: "pharmacist", notes: "" }, { id: 4, staff_id: 13, shift_date: "2026-11-21", start_time: "08:00", end_time: "13:00", role_override: "", notes: "" }];
  const data = { staff: [MARIA, RITA], shifts: src, hours: HOURS, settings: SET, leaves: [{ staff_id: 13, status: "approved", leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-01" }] };
  const xs = P.repeat({ rows: src, srcFrom: "2026-11-16", srcTo: "2026-11-22", times: 4, data });
  eq(xs.map((x) => x.staff_id), [11, 13]);
  eq(xs[0].add.map((r) => r.date + " " + r.start_time + " " + r.notes), ["2026-11-23 08:00 am", "2026-11-23 15:00 pm", "2026-11-30 08:00 am", "2026-11-30 15:00 pm", "2026-12-07 08:00 am", "2026-12-07 15:00 pm", "2026-12-14 08:00 am", "2026-12-14 15:00 pm"]);
  eq(xs[1].add.map((r) => r.date + " " + r.role_override), ["2026-11-24 pharmacist", "2026-11-28 ", "2026-12-05 ", "2026-12-12 ", "2026-12-15 pharmacist", "2026-12-19 "], "Tue 1 Dec on leave, Tue 8 Dec a holiday");
  eq(xs[1].skip.map((s) => s.why), ["leave", "holiday"]);
  const u = P.repeat({ rows: src, srcFrom: "2026-11-16", srcTo: "2026-11-22", until: "2026-12-02", data, people: [MARIA] });
  eq(u[0].add.map((r) => r.date), ["2026-11-23", "2026-11-23", "2026-11-30", "2026-11-30"]);
  const day = P.repeat({ rows: src, srcFrom: "2026-11-17", srcTo: "2026-11-17", times: 3, data, people: [RITA] });
  eq(day[0].add.map((r) => r.date), ["2026-11-18", "2026-11-19", "2026-11-20"], "a day repeats on the next days");
  const wk = P.repeat({ rows: src, srcFrom: "2026-11-17", srcTo: "2026-11-17", times: 2, everyDays: 7, data, people: [RITA] });
  eq([wk[0].add.map((r) => r.date), wk[0].skip.map((s) => s.date + " " + s.why)], [["2026-11-24"], ["2026-12-01 leave"]], "every Tuesday: 1 Dec is leave");
  const mon = P.repeat({ rows: [{ id: 9, staff_id: 11, shift_date: "2026-11-02", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }], srcFrom: "2026-11-01", srcTo: "2026-11-30", times: 1, data, people: [MARIA] });
  eq(mon[0].add.map((r) => r.date), ["2026-12-07"], "a month copy keeps the weekday: the 1st Monday of November -> the 1st Monday of December");
  const md = P.repeat({ rows: [{ id: 9, staff_id: 11, shift_date: "2026-11-02", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }], srcFrom: "2026-11-01", srcTo: "2026-11-30", until: "2027-01-31", align: "date", data, people: [MARIA] });
  eq(md[0].add.map((r) => r.date), ["2026-12-02", "2027-01-02"], "by date, month by month until 31 Jan");
  const fifth = P.repeat({ rows: [{ id: 9, staff_id: 11, shift_date: "2026-12-29", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }], srcFrom: "2026-12-01", srcTo: "2026-12-31", times: 1, data, people: [MARIA] });
  eq([fifth[0].add.length, fifth[0].skip.map((s) => s.why + " " + s.words), P.preview(fifth).words.skips], [0, ["no-day No 5th Tuesday in January"], "Skips: No 5th Tuesday in January"], "a missing 5th weekday is a named skip");
  const to = P.repeat({ rows: src, srcFrom: "2026-11-16", srcTo: "2026-11-22", to: { from: "2027-01-04" }, data, people: [MARIA] });
  eq(to[0].add.map((r) => r.date), ["2027-01-04", "2027-01-04"]);
  // Replace: the target week becomes the copy (an existing shift on a day with nothing in the source goes)
  const rep = P.repeat({ rows: src, srcFrom: "2026-11-16", srcTo: "2026-11-22", times: 1, mode: "replace", data: { ...data, shifts: src.concat([{ id: 20, staff_id: 11, shift_date: "2026-11-25", start_time: "10:00", end_time: "12:00", role_override: "", notes: "" }]) }, people: [MARIA] });
  eq([rep[0].add.length, rep[0].remove.map((r) => r.id)], [2, [20]]);
});

test("A9 selection: set hours on 2 people × scattered days (Keep fills only empty cells; Replace exactly those cells), clear, paste onto another person", ({ E }) => {
  const P = E.rotaPlan;
  const shifts = [{ id: 1, staff_id: 11, shift_date: "2026-11-17", start_time: "07:30", end_time: "14:00", role_override: "", notes: "" }, { id: 2, staff_id: 12, shift_date: "2026-11-19", start_time: "13:30", end_time: "19:30", role_override: "", notes: "x" }, { id: 3, staff_id: 12, shift_date: "2026-11-18", start_time: "13:30", end_time: "19:30", role_override: "", notes: "" }];
  const data = { staff: [MARIA, JOE], shifts, hours: HOURS, settings: SET };
  const cells = [{ staff_id: 11, date: "2026-11-17" }, { staff_id: 11, date: "2026-11-20" }, { staff_id: 12, date: "2026-11-16" }, { staff_id: 12, date: "2026-11-19" }];
  const k = P.setHours({ cells, block: { start: "08:00", end: "14:00" }, data });
  eq(k.map((x) => [x.staff_id, x.add.map((r) => r.date), x.keep.map((r) => r.id)]), [["11", ["2026-11-20"], [1]], ["12", ["2026-11-16"], [2]]].map(([s, a, b]) => [+s, a, b]));
  const r = P.setHours({ cells, block: { start: "08:00", end: "14:00" }, data, mode: "replace" });
  eq(r.map((x) => [x.add.map((y) => y.date), x.remove.map((y) => y.id)]), [[["2026-11-17", "2026-11-20"], [1]], [["2026-11-16", "2026-11-19"], [2]]], "id 3 (not selected) untouched");
  const c = P.clear({ cells, data });
  eq(c.map((x) => [x.add.length, x.remove.map((y) => y.id)]), [[0, [1]], [0, [2]]]);
  eq(P.preview(c).words.button, "Remove 2 shifts");
  const p = P.paste({ rows: shifts, cells: [{ staff_id: 12, date: "2026-11-18" }, { staff_id: 12, date: "2026-11-19" }], target: { staff_id: 11, date: "2026-11-25" }, data });
  eq(p.map((x) => [x.staff_id, x.add.map((y) => y.date + " " + y.start_time + " " + y.notes)]), [[11, ["2026-11-25 13:30 ", "2026-11-26 13:30 x"]]]);
});

test("same as last week, everyone's usual pattern, scattered days", ({ E }) => {
  const P = E.rotaPlan;
  const prev = [{ id: 1, staff_id: 11, shift_date: "2026-11-09", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }, { id: 2, staff_id: 12, shift_date: "2026-11-14", start_time: "08:00", end_time: "13:00", role_override: "", notes: "" }, { id: 3, staff_id: 12, shift_date: "2026-11-17", start_time: "08:00", end_time: "13:00", role_override: "", notes: "" }];
  const lw = P.lastWeek({ monday: "2026-11-18", data: { staff: [MARIA, JOE], shifts: prev, hours: HOURS, settings: SET } });
  eq(lw.map((x) => [x.staff_id, x.add.map((r) => r.date)]), [[11, ["2026-11-16"]], [12, ["2026-11-21"]]]);
  const withPat = { ...MARIA, patterns_json: E.rotaPlan.toPatternsJson({ rotations: [altSat("2026-11-16")], usual: "k3f9" }) };
  const pt = P.pattern({ people: [withPat, JOE], from: "2026-11-16", to: "2026-11-29", data: { hours: HOURS, settings: SET } });
  eq([pt[0].add.length, pt[1].add.length, !!pt[1].noPattern], [11, 0, true]);
  const ds = P.days({ people: [RITA], dates: ["2026-11-18", "2026-12-02", "2026-12-08"], block: { start: "09:00", end: "13:00" }, data: { hours: HOURS, settings: SET } });
  eq([ds[0].add.map((r) => r.date), ds[0].skip.map((s) => s.why)], [["2026-11-18", "2026-12-02"], ["holiday"]]);
});

test("fill the gaps: a pharmacist for every open hour (fewest hours first, leave/availability respected); an assistant role too; unfilled listed", ({ E }) => {
  const P = E.rotaPlan;
  const shifts = [{ id: 1, staff_id: 11, shift_date: "2026-11-17", start_time: "07:30", end_time: "14:00", role_override: "", notes: "" }, { id: 2, staff_id: 12, shift_date: "2026-11-16", start_time: "07:30", end_time: "19:30", role_override: "", notes: "" }];
  const L = { id: 14, full_name: "Helena Farrugia", designation: "locum", is_active: 1 };
  const data = { staff: [MARIA, JOE, L, RITA], shifts, hours: HOURS, settings: SET, leaves: [{ staff_id: 14, status: "approved", leave_type: "annual", start_date: "2026-11-18", end_date: "2026-11-18" }] };
  const g = P.gaps({ from: "2026-11-17", to: "2026-11-18", data });
  const by = Object.fromEntries(g.map((x) => [x.staff_id, x.add.map((r) => r.date + " " + r.start_time + "–" + r.end_time)]));
  eq(by, { 11: ["2026-11-18 07:30–19:30"], 14: ["2026-11-17 14:00–19:30"] }, "Tue pm to the locum (0 h planned); Wed to Maria (Helena on leave; Maria 6.5 h < Joe 12 h)");
  ok(g.every((x) => x.extra && !x.keep.length), "gap shifts are extra shifts");
  const asst = P.gaps({ from: "2026-11-16", to: "2026-11-16", role: "assistant", data });
  eq(asst.map((x) => [x.staff_id, x.add.map((r) => r.start_time + "–" + r.end_time)]), [[13, ["07:30–19:30"]]]);
  const none = P.gaps({ from: "2026-11-18", to: "2026-11-18", role: "cashier", data });
  eq(none[0].unfilled.map((u) => u.words), ["Still no cashier Wed 18 Nov 07:30–19:30"]);
});

test("preview words: SPEC §2.4 wording, skips with reasons, asked and trimmed, afterwards cover", ({ E, win }) => {
  const P = E.rotaPlan; win.__today = "2026-11-10";
  const leaves = [{ staff_id: 11, status: "approved", leave_type: "annual", start_date: "2026-11-23", end_date: "2026-11-24" }, { staff_id: 11, status: "pending", leave_type: "annual", start_date: "2026-11-26", end_date: "2026-11-26" }];
  const avail = { 11: { w: {}, d: { "2026-12-03": "no" } } };
  const ex = [{ id: 5, staff_id: 11, shift_date: "2026-11-16", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }];
  const x = P.expand({ person: MARIA, rotation: altSat("2026-11-16"), from: "2026-11-16", to: "2026-12-13", hours: HOURS, settings: { ...SET, rota: { avail } }, leaves, existing: ex });
  const pv = P.preview([], x, "keep", { after: { shifts: ex, staff: [MARIA], leaves, hours: HOURS, settings: SET } });
  eq(pv.words.title, "Marija Cassar, 16 Nov – 13 Dec 2026");
  eq(pv.words.line, "Adds " + x.add.length + " shifts · keeps 1 shift already planned · removes nothing");
  eq(pv.words.skips, "Skips: 1 public holiday · 2 days of leave · 1 day Marija can't work (Thu 3 Dec)");
  ok(/Marija asked for annual leave on Thu 26 Nov \(they get the shift for now\)/.test(pv.words.asked), pv.words.asked);
  ok(/^Afterwards still no pharmacist on Mon 16 Nov 07:30–08:00, 14:00–19:30 · Tue 17 Nov 07:30–08:00, 14:00–19:30 and \d+ more days$/.test(pv.words.after), pv.words.after);
  eq(pv.words.button, "Add " + x.add.length + " shifts");
  ok(pv.days.some((d) => d.mark === "skip" && d.why === "holiday" && d.date === "2026-12-08") && pv.days.some((d) => d.mark === "keep"), "day marks");
  const none = P.preview(P.expand({ person: MARIA, rows: [], from: "2026-11-16", to: "2026-11-16" }));
  eq([none.nothing, none.words.button], [true, "Nothing to change"]);
});

test("toOps (servers without W1): Keep = 'fill' with the new rows only; Replace = 'overwrite' over the range re-sending every kept row", ({ E }) => {
  const P = E.rotaPlan, ex = [{ id: 1, staff_id: 11, shift_date: "2026-11-17", start_time: "13:30", end_time: "19:30", role_override: "", notes: "hand" }, { id: 2, staff_id: 11, shift_date: "2026-11-19", start_time: "09:00", end_time: "12:00", role_override: "pharmacist", notes: "" }];
  const rot = { n: 1, weeks: [MF("08:00", "14:00").slice(0, 3).concat([null, null, null, null])] };
  const k = P.toOps([P.expand({ person: MARIA, rotation: rot, from: "2026-11-16", to: "2026-11-22", hours: HOURS, settings: SET, existing: ex })]);
  eq(k, [{ staff_id: 11, start_date: "2026-11-16", end_date: "2026-11-18", mode: "fill", dates: [{ date: "2026-11-16", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }, { date: "2026-11-18", start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }] }]);
  const r = P.toOps([P.expand({ person: MARIA, rotation: rot, from: "2026-11-16", to: "2026-11-22", hours: HOURS, settings: SET, existing: ex, mode: "replace" })]);
  eq([r.length, r[0].mode, r[0].start_date, r[0].end_date, r[0].dates.map((d) => d.date + " " + d.start_time + " " + d.role_override)], [1, "overwrite", "2026-11-16", "2026-11-22", ["2026-11-16 08:00 ", "2026-11-17 08:00 ", "2026-11-18 08:00 ", "2026-11-19 09:00 pharmacist"]]);
  const long = P.toOps([P.expand({ person: MARIA, rotation: rot, from: "2026-01-05", to: "2031-12-28", hours: HOURS, settings: SET, existing: [{ ...ex[0], shift_date: "2026-01-06" }], mode: "replace" })]);
  ok(long.length === 2 && long.every((o) => o.dates.length <= 3660) && long[1].start_date === P.dates.add(long[0].end_date, 1), "chunked, consecutive");
});

async function applyCase(E, w1) {
  const P = E.rotaPlan, S = fakeServer(E, { w1 }); P._server(null);
  const a = S.add(11, "2026-11-17", "13:30", "19:30", { notes: "hand" }), b = S.add(11, "2026-11-19", "09:00", "12:00"), j = S.add(12, "2026-11-17", "08:00", "14:00");
  const existing = S.rows.slice();
  const rot = { n: 1, weeks: [MF("08:00", "14:00").concat([null, null])] };
  const x = P.expand({ person: MARIA, rotation: rot, from: "2026-11-16", to: "2026-11-22", hours: HOURS, settings: SET, existing, mode: "replace" });
  const before = JSON.stringify(S.rows.filter((r) => r.staff_id === 12));
  S.calls = [];
  const res = await P.apply([x], { label: "Usual week" });
  return { P, S, x, res, a, b, before };
}
test("A2/A3 apply through W1 (one request, ids of kept rows unchanged) and through apply-pattern on an older server: same rows", async ({ E }) => {
  const one = await applyCase(E, true), two = await applyCase(load().E, false);
  for (const [w, c] of [["W1", one], ["legacy", two]]) {
    ok(c.res.done && c.res.undoId, w + ": " + c.res.words);
    eq(c.res.words, "Added 5 shifts and removed 2 for Marija", w);
    eq(c.S.rows.filter((r) => r.staff_id === 11).map((r) => r.shift_date + " " + r.start_time).sort(), ["2026-11-16 08:00", "2026-11-17 08:00", "2026-11-18 08:00", "2026-11-19 08:00", "2026-11-20 08:00"], w);
    eq(JSON.stringify(c.S.rows.filter((r) => r.staff_id === 12)), c.before, w + ": Joe untouched");
  }
  eq(one.S.calls.map((c) => c.method + " " + c.path.split("?")[0]), ["POST /shifts/apply-plan", "GET /shifts/assignments-range"], "W1: 1 POST + 1 GET verify");
  eq(one.S.calls[0].body.items[0].remove, [one.a.id, one.b.id]);
  eq(two.S.calls.map((c) => c.method + " " + c.path.split("?")[0]), ["POST /shifts/apply-plan", "POST /shifts/apply-pattern", "GET /shifts/assignments-range"], "older server: the 404 then apply-pattern");
  eq(two.S.calls[1].body.mode, "overwrite");
});

test("A4 undo restores the snapshot exactly; an undo after someone else's change names it and waits for 'anyway'", async ({ E }) => {
  const c = await applyCase(E, true);
  const u = await c.P.undo(c.res.undoId);
  ok(u.done, u.words);
  eq(c.S.rows.filter((r) => r.staff_id === 11).map((r) => [r.shift_date, r.start_time, r.end_time, r.notes]).sort(), [["2026-11-17", "13:30", "19:30", "hand"], ["2026-11-19", "09:00", "12:00", ""]]);
  eq(c.P.recent()[0].undone, true);
  const c2 = await applyCase(load().E, true);
  c2.S.add(11, "2026-11-21", "08:00", "13:00", { notes: "Mark's" });
  const u1 = await c2.P.undo(c2.res.undoId);
  ok(!u1.done && u1.changedSince.length === 1 && /Marija Sat 21 Nov 08:00–13:00 was added since/.test(u1.words) && /Undo anyway\?/.test(u1.words), u1.words);
  ok(c2.S.rows.some((r) => r.notes === "Mark's"), "nothing done yet");
  const u2 = await c2.P.undo(c2.res.undoId, { anyway: true });
  ok(u2.done && !c2.S.rows.some((r) => r.notes === "Mark's") && c2.S.rows.filter((r) => r.staff_id === 11).length === 2, u2.words);
});

test("A5 failure: a 500, a lost answer that landed, a half-done older-server write put back, a stale preview, and a restore that fails too", async ({ E }) => {
  const setup = (w1) => { const L = load(), S = fakeServer(L.E, { w1 }); L.E.rotaPlan._server(null); S.add(11, "2026-11-17", "13:30", "19:30", { notes: "hand" }); S.add(11, "2026-11-18", "08:00", "12:00"); const x = L.E.rotaPlan.expand({ person: MARIA, rotation: { n: 1, weeks: [MF("08:00", "14:00").concat([null, null])] }, from: "2026-11-16", to: "2026-11-22", hours: HOURS, settings: SET, existing: S.rows.slice(), mode: "replace" }); return { P: L.E.rotaPlan, S, x, snap: JSON.stringify(S.rows) }; };
  const e500 = () => Object.assign(new Error("HTTP 500"), { status: 500 }), lost = () => Object.assign(new Error("Network error"), { status: 0, network: true });
  { const c = setup(true); c.S.failNext = (m, p) => m === "POST" && p === "/shifts/apply-plan" && { err: e500() };
    const r = await c.P.apply([c.x]); ok(!r.done && /^Nothing was changed — /.test(r.words) && JSON.stringify(c.S.rows) === c.snap, "500: " + r.words); }
  { const c = setup(true); c.S.failNext = (m, p) => m === "POST" && p === "/shifts/apply-plan" && { err: lost(), before: false };
    const r = await c.P.apply([c.x]); ok(r.done && r.recovered && r.undoId, "lost answer, it landed: done: " + r.words); }
  { const c = setup(false); c.S.failAfterDelete = true;
    const r = await c.P.apply([c.x]);
    ok(!r.done && /^Nothing was changed — /.test(r.words), "older server, DELETE landed then 500: " + r.words);
    eq(c.S.rows.map((x) => [x.shift_date, x.start_time, x.notes]), JSON.parse(c.snap).map((x) => [x.shift_date, x.start_time, x.notes]), "put back from the snapshot"); }
  { const c = setup(true); c.S.add(11, "2026-11-20", "10:00", "11:00");
    const r = await c.P.apply([c.x]); ok(!r.done && r.changed && /since the preview/.test(r.words) && c.S.rows.length === 3, "stale preview refused: " + r.words); }
  { const c = setup(false); c.S.failAfterDelete = true; let n = 0;
    const P = c.P, S = c.S; // the restore's own writes fail too
    S.failNext = (m, p) => { if (m === "POST" && p === "/shifts/apply-pattern" && ++n >= 2) return { err: e500() }; return null; };
    const r = await P.apply([c.x]);
    ok(!r.done && r.undoId && /^Marija's shifts from 16 Nov 2026 to 22 Nov 2026 could not be put back; 0 of the 2 earlier shifts are on the rota now\. Try Undo again in a minute/.test(r.words), "restore failed: " + r.words);
    ok(P.recent()[0].restoreFailed, "kept in Recent changes");
    S.failNext = null;
    const u = await P.undo(r.undoId); ok(u.done, "Undo from Recent changes puts it back: " + u.words);
    eq(S.rows.map((x) => [x.shift_date, x.start_time, x.notes]).sort(), JSON.parse(c.snap).map((x) => [x.shift_date, x.start_time, x.notes]).sort()); }
});

test("apply many people: W1 groups of 12 (one request for 8 people), progress, and a split answer falls back per person", async ({ E }) => {
  const P = E.rotaPlan, S = fakeServer(E, { w1: true }); P._server(null);
  const people = Array.from({ length: 14 }, (_, i) => ({ id: 100 + i, full_name: "P" + i }));
  const xs = people.map((p) => P.expand({ person: p, rows: [{ date: "2026-11-16", start_time: "08:00", end_time: "14:00" }], from: "2026-11-16", to: "2026-11-16", existing: [], hours: HOURS, settings: SET }));
  const prog = []; const r = await P.apply(xs, { onProgress: (a, b) => prog.push(a + "/" + b) });
  ok(r.done && r.inserted === 14 && /for 14 people/.test(r.words), r.words);
  eq(S.calls.filter((c) => c.path === "/shifts/apply-plan").map((c) => c.body.items.length), [12, 2]);
  eq(prog, ["12/14", "14/14"]);
});

test("recent changes: newest first, at most 5, survive a reload (sessionStorage per pharmacy)", async ({ E }) => {
  const L = load(), P = L.E.rotaPlan, S = fakeServer(L.E); P._server(null);
  const ds = ["16", "17", "18", "19", "20", "21", "23"];
  for (let i = 0; i < 7; i++) await P.apply([P.expand({ person: MARIA, rows: [{ date: "2026-11-" + ds[i], start_time: "08:00", end_time: "14:00" }], from: "2026-11-16", to: "2026-11-30", existing: S.rows.slice(), hours: HOURS, settings: { pharmacistRequired: false } })], { label: "Day " + i });
  const rc = P.recent();
  eq([rc.length, rc[0].label, rc[4].label], [5, "Day 6", "Day 2"]);
  ok(Object.keys(L.store).includes("eikon_rota_undo:7"), "sessionStorage key per location");
});

test("A7 until changed + Extend: 12 months; Extend shows 8 weeks before the end; extending from the day after never re-fills inside the old horizon", ({ E }) => {
  const P = E.rotaPlan;
  eq(P.untilChangedEnd("2026-11-16"), "2027-11-15");
  const plans = { 11: { rid: "k3f9", from: "2026-11-16", through: "2027-11-15", keep: true }, 12: { rid: "p1", from: "2026-01-05", through: "2026-12-20", keep: true } };
  eq(P.extendDue("2027-09-19", plans, [MARIA, JOE]).map((x) => x.staff_id), [12]);
  const due = P.extendDue("2027-09-21", plans, [MARIA, JOE]);
  eq(due.map((x) => [x.staff_id, x.from, x.to]), [[12, "2026-12-21", "2027-06-20"], [11, "2027-11-16", "2028-05-15"]]);
  eq(due[1].words, "Marija's usual week is on the rota until 15 Nov 2027");
  ok(/\(ended\)$/.test(due[0].words), due[0].words);
});

test("summary and validation in words", ({ E }) => {
  const P = E.rotaPlan;
  eq(P.summary({ n: 1, weeks: [[...MF("08:00", "14:00"), { start: "08:00", end: "13:00" }, null]] }), "Mon–Fri 08:00–14:00 · Sat 08:00–13:00");
  eq(P.summary({ n: 3, anchor: "2026-11-16", weeks: [[null, null, null, null, null, { start: "08:00", end: "13:00" }, null], [], []] }, "2026-11-16"), "Saturdays 08:00–13:00 every 3rd week (next on 21 Nov)");
  eq(P.summary({ n: 2, anchor: "2026-11-16", weeks: [[{ start: "08:00", end: "14:00" }], [{ start: "13:00", end: "19:30" }]] }), "Mondays 08:00–14:00 (week A), 13:00–19:30 (week B)");
  eq(P.validate({ n: 1, weeks: [[null, null, null, null, null, { start: "14:00", end: "08:00" }, null]] }), ["Saturday: end must be after start"]);
  eq(P.validate({ n: 2, weeks: [[[{ start: "08:00", end: "13:00" }, { start: "12:00", end: "15:00" }]], [{ start: "8", end: "" }]] }), ["Week A Monday: the two shifts overlap", "Week B Monday: write both times, like 08:00"]);
  eq(P.validate({ n: 1, weeks: [[]] }), ["Add at least one day"]);
});

export async function run(report) {
  let pass = 0, fail = 0;
  for (const t of tests) {
    const L = load();
    try { await t.fn(L); pass++; report ? report("rotaplan engine: " + t.name, true, "") : console.log("  ok   " + t.name); }
    catch (e) { fail++; report ? report("rotaplan engine: " + t.name, false, String(e.stack || e).slice(0, 900)) : console.log("  FAIL " + t.name + "\n       " + String(e.stack || e).split("\n").slice(0, 8).join("\n       ")); }
  }
  return { pass, fail };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const r = await run();
  console.log(`\n${r.pass} passed, ${r.fail} failed`);
  process.exit(r.fail ? 1 : 0);
}
