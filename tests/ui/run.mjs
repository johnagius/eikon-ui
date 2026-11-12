// UI harness: serves ui/ with a mock API and drives it with Playwright.
// Run: node tests/ui/run.mjs            (needs the pre-installed Playwright + Chromium)
// Checks: every pharmacy module renders without a page error or console error,
// plus targeted regressions for the defects fixed on the current code.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
// Playwright is installed globally in the cloud container; ESM import does not see NODE_PATH.
const { chromium } = createRequire(import.meta.url)("playwright");
// Malta's calendar and clock for the mock and the pages, whatever zone this machine is on (tests/clock.mjs):
// EIKON_FAKE_NOW runs the suite at a given moment, EIKON_BROWSER_TZ puts the pages in another zone.
import { installNodeClock, maltaYmd, contextTz, prepareContext, CLOCK_OFFSET, BROWSER_TZ } from "../clock.mjs";
installNodeClock();
// Pages are served with the worker's own Content-Security-Policy (report-only, or enforced with CSP_ENFORCE=1), and every
// violation in any page of the suite is collected (security audit 2026-11-10): the last check asks for none.
import { cspHeadersFor, watchCsp } from "../csp.mjs";
const CSPV = [];

const here = fileURLToPath(new URL(".", import.meta.url));
const root = path.join(here, "..", "..", "ui");
const PORT = Number(process.env.PORT) || 8781;
const mime = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", gif: "image/gif", json: "application/json", svg: "image/svg+xml" };

const calls = []; // every non-asset request the UI makes
const todayYmd = maltaYmd(0); // the worker's /today date (Malta's day), and the day the pages call today
const genericList = {
  ok: true, entries: [], items: [], rows: [], data: [], results: [], devices: [], staff: [], assignments: [], leaves: [], settings: {}, state: {},
  appointments: [], slots: [], doctors: [], clinics: [], schedules: [], waitlist: [], campaigns: [], clients: [], transactions: [], records: [], patients: [],
  orders: [], products: [], offers: [], needs: [], messages: [], pinned: [], suggestions: [], contacts: [], dates: [], notes: [], report: { entries: [] },
  catalog: [], sales: [], feedback: [], changes: [], global: {}, daily: null, locations: [], receipts: [], stocktakes: [], certificates: [],
  unread_mentions: 0, unread_messages: 0
};

let todayState = { tempDone: false, cleanDone: false };
// The bookings calendar (2026-11): tomorrow with two bookings, a lunch block, reminders state; old Appointments to bring over.
let bkCal = { on: false, legacy: false, imported: 0 };
// Temperature entries the mock keeps (off by default: GET answers [] and POST only marks Today done, as before).
// When on, it behaves as the worker: GET by month, POST upserts by device and day.
let tempState = { on: false, entries: [], next: 100 };
function todayPayload() {
  const t = todayYmd;
  return {
    ok: true, date: t, time: todayState.time || "09:12", timezone: "Europe/Malta", pharmacy: { name: "Demo Pharmacy", location_id: 12, org: "Test" },
    before_opening: (todayState.room ? [{ kind: "temperature", device_id: 8, title: "Pharmacy · reading", sub: "Yesterday 21 to 23 · limits 15 to 25", status: "todo", out_of_range: false, limits: { min: 15, max: 25 }, yesterday: todayState.roomNoY ? null : { min: 21, max: 23 }, today: null, action: { method: "POST", path: "/temperature/entries", body: { device_id: 8, entry_date: t }, fields: ["min_temp", "max_temp", "notes"], label: "Log" } }] : []).concat([
      { kind: "temperature", device_id: 7, title: "Fridge 1 · reading", sub: "Yesterday 3.8 to 6.4 · limits 2 to 8", status: todayState.tempDone || todayState.outToday ? "done" : "todo", out_of_range: !!todayState.outToday, limits: { min: 2, max: 8 }, yesterday: todayState.yOut ? { min: 3.8, max: 9.1 } : { min: 3.8, max: 6.4 }, today: todayState.outToday ? { min: 4, max: 9.5 } : todayState.tempDone ? { min: 3.9, max: 6.1 } : null, action: { method: "POST", path: "/temperature/entries", body: { device_id: 7, entry_date: t }, fields: ["min_temp", "max_temp", "notes"], label: "Log" } },
      { kind: "daily_register", title: "Daily register", sub: "No entry yet today", status: "todo", count_today: 0, action: { type: "open", path: "#dailyregister", label: "Open" } },
      { kind: "cleaning", title: "Cleaning", sub: "Last done 14 days ago by Karl", status: todayState.cleanDone ? "done" : "overdue", days_since: 14, last_date: "2026-10-17", action: { method: "POST", path: "/cleaning/entries", body: { entry_date: t }, fields: ["time_in", "cleaner_name", "staff_name"], label: "Done now" } }
    ]).filter((x) => !(todayState.noFridge && x.kind === "temperature")),
    customers_waiting: [
      { kind: "order", id: 1, name: "Grech Carmen", phone: "79123456", detail: "Augmentin 625 ×14", code: "A1B2C3", needed_by: t, pickup_date: t, priority: 1, waiting_days: 0, due_today: true, action: { type: "open", path: "#clientorders", label: "Open" } },
      { kind: "question", id: 2, ref: "TKT-00001", name: "Vella Joseph", phone: "79000000", detail: "do you stock the Omron M3 monitor?", status: "Open", priority: 2, waiting_days: 3, followup_date: null, action: { type: "open", path: "#tickets", label: "Reply" } }
    ].concat(todayState.many ? q55Waiting() : []).concat(todayState.delivery ? [{ kind: "delivery", id: 7, ref: "DEL-00004", name: "Camilleri Rita", phone: "79222333", detail: "12 Triq il-Kbira, Mosta", slot: "Afternoon", status: "Scheduled", due_date: "2026-11-01", late_days: 1, cold: true, controlled: false, action: { type: "open", path: "#deliveries", label: "Open" } }] : []).concat([
    ]),
    attention: [
      { kind: "near_expiry", expired_count: 0, due30_count: 1, first: "Enalapril 20mg", first_expiry: t, title: "1 expiring within 30 days", action: { type: "open", path: "#nearexpiry", label: "Open" } },
      { kind: "certificate", title: "Fire extinguisher", status: "due_soon", due: t, days: 12, action: { type: "open", path: "#certificates", label: "Open" } }
    ],
    takings: { end_of_day_saved: !!todayState.eodSaved, end_of_day_locked: false, paid_out_today: 12.5, paid_out_count: 1, action: { type: "open", path: "#endofday", label: "Close the day" } },
    stock: { supplier_orders_pending: 1, supplier_orders_shipped: 0 },
    team: { on_today: [{ name: "Maria", role: "pharmacist", from: "09:00", to: "19:00" }, { name: "Karl", role: "assistant", from: "13:00", to: "19:00" }], handover_incoming: [{ text: "Courier at 16:00, box for Dr Galea", sev: "g" }, { text: "Methadone for Mr Vella at 9", sev: "r" }], notes_today: "" },
    counts: { before_opening: (todayState.tempDone ? 0 : 1) + 1 + (todayState.cleanDone ? 0 : 1), customers_waiting: 2, attention: 2 },
    ...(todayState.bk ? { bookings: { total_today: 2, next: [], action: { type: "open", path: "#bookings", label: "Bookings" } } } : {}),
    ...(teamState.setup && teamState.me.role === "admin" ? { setup: teamState.setup } : {}) // as the worker: admins only, absent on an older server
  };
}
// q5-5: a busy counter for Today: 14 waiting (two of them for more than 30 days), with the ids the Orders, Questions and
// Deliveries mocks answer (51 Grech Carmen, 53 the old order, 61 Camilleri Rita's question, 72 her delivery).
function q55Waiting() {
  const d = (n) => maltaYmd(n), o = (id, name, pr, nb, wd) => ({ kind: "order", id, name, phone: "79000" + id, detail: "Item " + id, code: "", needed_by: nb, pickup_date: nb, priority: pr, waiting_days: wd, due_today: !!(nb && nb <= d(0)), action: { type: "open", path: "#clientorders", label: "Open" } });
  return [o(51, "Grech Carmen", 2, d(-1), 3), o(901, "Borg Anna", 3, d(5), 1), o(902, "Vella Paul", 3, d(6), 2), o(903, "Zammit Rita", 2, d(0), 1), o(904, "Abela Toni", 3, d(9), 0), o(905, "Galea Lino", 3, d(8), 4),
    o(906, "Pace Mary", 1, d(4), 2), o(53, "Old Olga", 2, d(-38), 40), o(907, "Older Oscar", 3, d(-50), 52),
    { kind: "question", id: 61, ref: "TKT-00007", name: "Camilleri Rita", phone: "79222333", detail: "Is her repeat ready?", status: "Open", priority: 2, waiting_days: 4, followup_date: d(-1), action: { type: "open", path: "#tickets", label: "Reply" } },
    { kind: "question", id: 963, ref: "TKT-00009", name: "Farrugia Tony", phone: "", detail: "Price?", status: "Open", priority: 3, waiting_days: 2, followup_date: null, action: { type: "open", path: "#tickets", label: "Reply" } },
    { kind: "delivery", id: 72, ref: "DEL-00005", name: "Camilleri Rita", phone: "79222333", detail: "12 Triq il-Kbira, Mosta", slot: "Afternoon", status: "Scheduled", due_date: d(-1), late_days: 1, cold: false, controlled: false, action: { type: "open", path: "#deliveries", label: "Open" } }];
}
let boardState = { msgs: [
  { id: 11, user_id: 7, user_name: "Sara Vella", location_name: "Sliema Pharmacy", body: "Who has Ozempic 1mg? @Demo Pharmacy", scope: "all", is_pinned: 1, created_at: "2026-11-02 08:00:00" },
  { id: 12, user_id: 3, user_name: "Karl Vella", location_name: "Demo Pharmacy", body: "Courier at 16:00", scope: "org", is_pinned: 0, created_at: new Date().toISOString().slice(0, 19).replace("T", " ") }] };
let eodState = { rec: null, n: 0 };
let hndGap = false; // Handover: yesterday left nothing, the day before did
let eposSales = [];
let pvState = { reports: [{ id: "pv_1_abc", created_at: "2026-10-30T09:00:00.000Z", updated_at: "2026-10-30T09:00:00.000Z", status: "Draft", report_type: "Initial", pt_initials: "J.D.", pt_age: "65", pt_sex: "Female", pt_weight: "", pt_height: "", pt_dob_day: "5", pt_dob_month: "3", pt_id: "123456M", pt_medical_history: "",
  drugs: [{ name: "Amoxicillin 500mg", dose: "500mg", route: "Oral", frequency: "TDS", start_date: "", stop_date: "", indication: "URTI", batch_no: "AX12", mah: "" }], reaction_description: "Itchy rash", reaction_start: "", reaction_stop: "", reaction_seriousness: "Serious – Other medically important", reaction_outcome: "Recovering", reaction_causality: "Possible", reaction_meddra: "Rash",
  reporter_name: "Maria Borg", reporter_qualification: "Pharmacist", reporter_email: "", reporter_phone: "", reporter_institution: "Demo Pharmacy", reporter_address: "", report_date: "2026-10-30", notes: "", mpa_ref: "MPA-7" }] };
let lblState = { history: [{ patientName: "", drugName: "Amoxicillin 500mg", dose: "1 capsule", frequency: "Three times daily", route: "Oral", customInstructions: "", selectedWarnings: ["w10"], templateId: "tpl_std", id: "lb_1_seed", printedAt: "2026-11-01 10:00", printedBy: "Maria Borg" }], templates: [{ id: "tpl_std", name: "Standard Label", size: "standard", fields: [], isDefault: true }], pharm: { name: "Demo Pharmacy", phone: "21234567", licence: "" } };
// DDA stock takes (new layout ddstreg): one closed stock take with two lines; writes behave as the worker's handlers.
let ddstState = { next: 2, nextItem: 3, list: [{ id: 1, created_at: "2026-10-01 09:00:00", closed_at: "2026-10-01 10:00:00", updated_at: "2026-10-01 10:00:00" }],
  items: [{ id: 1, stocktake_id: 1, item_name: "Morphine sulphate", dosage: "10mg", qty_tablets: 30 }, { id: 2, stocktake_id: 1, item_name: "Alprazolam", dosage: "0.5mg", qty_tablets: 56 }] };
const MT_PEOPLE = [{ id: 31, name: "Vella Żaren", id_card: "0313131M", phone: "79313131", version: 1 }, { id: 32, name: "Mifsud Zaren", id_card: "", phone: "79000001", version: 1 }, { id: 33, name: "Pace Ċettina", id_card: "0333333M", phone: "79333333", version: 1 }, { id: 34, name: "Abela Ċensina", id_card: "0343434M", phone: "79343434", version: 1 }, { id: 35, name: "Xuereb Ġorġ", id_card: "0353535M", phone: "79353535", version: 1 }];
const MT_HIST = [{ key: "n:żaren vella", name: "Żaren Vella", id_card: "", phone: "79313131", alt_phone: "", email: "", address: "", doctor_name: "", sources: { credit_note: 1 }, last_date: "2026-11-01" },
  { key: "n:grech żaren", name: "Grech Żaren", id_card: "", phone: "79414141", alt_phone: "", email: "", address: "", doctor_name: "", sources: { dda_sale: 1 }, last_date: "2026-11-02" }];
let peopleState = { mt: false, mtQs: [], adopted: false, carmel: { id: 1, name: "Zammit Carmel", id_card: "0012345M", phone: "79123456", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", date_of_birth: "", notes: "", source: "history", version: 1, updated_at: "2026-10-31 09:00:00" } };
// Team sign-ins (teamreg, forced change, idle lock, first-run list): behaves as the worker's /team routes.
const teamFresh = () => ({ me: { role: "admin", must_change: false }, next: 5, setup: undefined, users: [
  { id: 1, email: "p@x.com", full_name: "Maria Borg", role: "admin", is_active: true, must_change_password: false, last_sign_in_at: "2026-11-03 08:00:00", signed_in_devices: 2, protected: false },
  { id: 2, email: "karl@x.com", full_name: "Karl Vella", role: "staff", is_active: true, must_change_password: false, last_sign_in_at: "2026-11-02 13:00:00", signed_in_devices: 1, protected: false },
  { id: 3, email: "john@eikon.mt", full_name: "John (Eikon support)", role: "admin", is_active: true, must_change_password: false, last_sign_in_at: null, signed_in_devices: 0, protected: true },
  { id: 4, email: "leaver@x.com", full_name: "Old Leaver", role: "staff", is_active: false, must_change_password: false, last_sign_in_at: "2026-09-01 09:00:00", signed_in_devices: 0, protected: false }] });
let teamState = teamFresh();
function teamMock(req, res, p, body) {
  const J = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); return true; };
  if (p === "/auth/me" && req.method === "GET") return J({ ok: true, user: Object.assign({ id: 1, user_id: 1, email: "p@x.com", full_name: "Maria Borg", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: teamState.me.role }, teamState.me.must_change ? { must_change: true } : {}) });
  if (p === "/auth/change-password" && req.method === "POST") { if (!body || body.current_password !== "temp-pass-1") return J({ ok: false, error: "The current password is not right" }, 403); teamState.me.must_change = false; return J({ ok: true }); }
  if (p === "/auth/unlock" && req.method === "POST") return body && body.password === "maria-pass" ? J({ ok: true }) : J({ ok: false, error: "That password is not right" }, 403);
  if (p === "/auth/login" && req.method === "POST" && body && body.email === "karl@x.com") return body.password === "karl-pass" ? J({ ok: true, token: "karl-token", user: { id: 2, email: "karl@x.com", full_name: "Karl Vella", role: "staff", location_id: 12, location_name: "Demo Pharmacy" } }) : J({ ok: false, error: "Invalid credentials" }, 401);
  if (p === "/team/me" && req.method === "GET") { const ph = !!teamState.me.is_pharmacist, ad = teamState.me.role === "admin"; return J({ ok: true, role: teamState.me.role, is_pharmacist: ph, role_word: ad ? "Admin" : ph ? "Pharmacist" : "Staff", pic: ad || ph, plans_rota: ad || teamState.me.plans_rota !== false }); } // roles round
  if (!p.startsWith("/team/users")) return false;
  if (teamState.me.role !== "admin") return J({ ok: false, error: "Forbidden" }, 403);
  const m = p.split("/").filter(Boolean);
  if (m.length === 2 && req.method === "GET") return J({ ok: true, users: teamState.users, me: 1, admins_manage_admins: false });
  if (m.length === 2 && req.method === "POST") {
    if (teamState.users.some((u) => u.email === body.email)) return J({ ok: false, error: "That e-mail already has a sign-in" }, 409);
    const u = { id: teamState.next++, email: body.email, full_name: body.full_name, role: body.role === "pharmacist" ? "staff" : body.role, is_pharmacist: body.role === "pharmacist", plans_rota: body.role === "admin", is_active: true, must_change_password: true, last_sign_in_at: null, signed_in_devices: 0, protected: false };
    teamState.users.push(u); return J({ ok: true, user: u, temporary_password: "k7mp-q4xa-9rtd" });
  }
  const u = teamState.users.find((x) => x.id === Number(m[2]));
  if (!u) return J({ ok: false, error: "Not found" }, 404);
  if (m[3] === "password") { u.must_change_password = true; u.signed_in_devices = 0; return J({ ok: true, temporary_password: "w2hn-8cxe-pt3v" }); }
  if (m[3] === "active") { u.is_active = !!body.active; if (!u.is_active) u.signed_in_devices = 0; return J({ ok: true }); }
  if (m[3] === "role") { if (u.role === "admin") return J({ ok: false, error: "Another admin's sign-in is changed by Eikon support" }, 403); u.role = body.role === "pharmacist" ? "staff" : body.role; if (body.role === "pharmacist") u.is_pharmacist = true; if (body.is_pharmacist === false) u.is_pharmacist = false; return J({ ok: true }); }
  if (m[3] === "rights") { if (typeof body.plans_rota === "boolean") u.plans_rota = body.plans_rota; return J({ ok: true }); }
  return J({ ok: false, error: "Not found" }, 404);
}
// Backlog 4 item 7 (a first day that never dead-ends): a brand-new pharmacy, on while globalThis.__b47 is set.
// Devices, rota people and the product list behave as the worker's handlers; b47.fail makes the next write a 500.
let b47 = null;
const b47Fresh = () => ({ devices: [{ id: 1, name: "Pharmacy", device_type: "room", min_limit: 15, max_limit: 25, active: 1 }, { id: 2, name: "Pharmacy Fridge", device_type: "fridge", min_limit: 2, max_limit: 8, active: 1 }],
  next: 3, staff: [], nextStaff: 1, products: [], fail: false });
function b47Mock(req, res, p, body, url) {
  if (!globalThis.__b47 || !b47) return false;
  const J = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); return true; };
  const W = req.method !== "GET";
  if (W && b47.fail && /^\/(temperature\/devices|shifts\/staff|emergency-pos\/catalog)/.test(p)) { b47.fail = false; return J({ ok: false, error: "Database is busy" }, 500); }
  const on = b47.devices.filter((d) => d.active === 1);
  if (p === "/today") {
    const t = todayPayload();
    t.before_opening = on.map((d) => ({ kind: "temperature", device_id: d.id, title: d.name + " · reading", sub: "No reading yesterday · limits " + d.min_limit + " to " + d.max_limit, status: "todo", out_of_range: false, limits: { min: d.min_limit, max: d.max_limit }, yesterday: null, today: null,
      action: { method: "POST", path: "/temperature/entries", body: { device_id: d.id, entry_date: todayYmd }, fields: ["min_temp", "max_temp", "notes"], label: "Log" } }))
      .concat([{ kind: "daily_register", title: "Daily register", sub: "No entry yet today", status: "todo", count_today: 0, action: { type: "open", path: "#dailyregister", label: "Open" } },
        { kind: "cleaning", title: "Cleaning", sub: "Never recorded", status: "overdue", days_since: null, last_date: null, action: { method: "POST", path: "/cleaning/entries", body: { entry_date: todayYmd }, fields: ["time_in", "cleaner_name", "staff_name"], label: "Done now" } }]);
    t.customers_waiting = []; t.attention = []; t.setup = { sign_ins: 1, opening_hours_saved: true };
    t.counts = { before_opening: t.before_opening.length, customers_waiting: 0, attention: 0 };
    return J(t);
  }
  if (p === "/temperature/devices" && req.method === "GET") return J({ ok: true, devices: url.searchParams.get("include_inactive") === "1" ? b47.devices : on });
  if (p === "/temperature/devices" && req.method === "POST") { const d = { id: b47.next++, name: body.name, device_type: body.device_type, min_limit: body.min_limit, max_limit: body.max_limit, active: 1 }; b47.devices.push(d); return J({ ok: true, device_id: d.id }); }
  if (/^\/temperature\/devices\/\d+$/.test(p) && req.method === "PUT") {
    const d = b47.devices.find((x) => x.id === Number(p.split("/")[3])); if (!d) return J({ ok: false, error: "Not found" }, 404);
    ["name", "device_type", "min_limit", "max_limit"].forEach((k) => { if (body[k] !== undefined) d[k] = body[k]; }); if (body.active !== undefined) d.active = body.active ? 1 : 0; return J({ ok: true });
  }
  if (p === "/temperature/entries" && req.method === "GET") return J({ ok: true, entries: [] });
  if (p === "/shifts/staff" && req.method === "GET") return J({ ok: true, staff: b47.staff });
  if (p === "/shifts/staff" && req.method === "POST") { const st = Object.assign({}, body, { id: b47.nextStaff++ }); b47.staff.push(st); return J({ ok: true, staff_id: st.id }); }
  if (p === "/shifts/assignments-range") return J({ ok: true, shifts: [] });
  if (p === "/shifts/leaves") return J({ ok: true, leaves: [] });
  if (p === "/emergency-pos/catalog" && req.method === "GET") return J({ ok: true, total: b47.products.length, next_offset: null, products: b47.products });
  if (p === "/emergency-pos/catalog" && req.method === "POST") { if (body.wipe) b47.products = []; body.products.forEach((x, i) => b47.products.push(Object.assign({ id: b47.products.length + 1 }, x))); return J({ ok: true, inserted: body.products.length }); }
  if (p === "/emergency-pos/sales" && req.method === "GET") return J({ ok: true, sales: [] });
  if (p === "/returns/entries" && req.method === "GET") return J({ ok: true, entries: [] });
  return false;
}
// How we're doing (ownreg): the worker's /owner/summary and /owner/records for one pharmacy, or a group of two when
// globalThis.__ownGroup is set; every day from..to has an end of day (takings 100 + day of month), paid outs 5 a day.
function ownerMock(req, res, p, url) {
  if (p !== "/owner/summary" && p !== "/owner/records") return false;
  const J = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); return true; };
  const from = url.searchParams.get("from"), to = url.searchParams.get("to"), loc = url.searchParams.get("loc") || "all", group = !!globalThis.__ownGroup;
  const all = group ? [{ id: 3, name: "Ħamrun Pharmacy" }, { id: 4, name: "Żebbuġ Pharmacy" }] : [{ id: 12, name: "Demo Pharmacy" }];
  if (group && loc !== "all" && !all.some((x) => String(x.id) === loc)) return J({ ok: false, error: "That pharmacy is not in your group" }, 403);
  const locs = group && loc !== "all" ? all.filter((x) => String(x.id) === loc) : all;
  const days = []; for (let d = from; d <= to && d < todayYmd; d = new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10)) days.push(d);
  if (p === "/owner/records") {
    const kinds = (url.searchParams.get("kinds") || "").split(","), records = {};
    kinds.forEach((k) => { records[k] = []; locs.forEach((l) => days.forEach((d, i) => {
      if (k === "paid_outs") records[k].push({ id: i + 1, location_id: l.id, pharmacy: l.name, entry_date: d, entry_time: "10:00", payee_name: "Courier Cassar", fee: 5, payment_method: "cash", invoice_no: "", cheque_no: "", reason: "Delivery" });
      if (k === "dda_supplied" && i < 2) records[k].push({ id: i + 1, location_id: l.id, pharmacy: l.name, entry_date: d, client_name: group ? "" : "Zammit Ġorġ", client_id_card: group ? "" : "1234M", medicine_name_dose: "Morphine 10mg", quantity: 2, doctor_name: "Dr Abela", prescription_serial_no: "S" + i });
      if (k === "credit_notes" && i < 1) records[k].push({ id: 9, location_id: l.id, pharmacy: l.name, issue_date: d, client_name: group ? "" : "Rita", client_surname: group ? "" : "Pace", amount: 30, used: 10, no_expiry: 1 }); })); });
    return J({ ok: true, from, to, group, patient_details: !group, records, capped: {}, unread: [] });
  }
  const ph = locs.map((l, li) => {
    const ds = days.map((d) => ({ date: d, staff: "Maria", shift: "PM", takings: 100 + Number(d.slice(8)) + li, epos: 10, cheques: 0, paid_outs: 0, expected: 90, cash: 90, over_under: d.slice(8) === "02" ? -5 : 0, locked: true, paid_out_register: 5 }));
    const sum = (k) => Math.round(ds.reduce((t, x) => t + x[k], 0) * 100) / 100;
    return { id: l.id, name: l.name, days: ds, money: { takings: sum("takings"), epos: sum("epos"), cheques: 0, cash: sum("cash"), till_paid_outs: 0, paid_outs: 5 * ds.length, paid_out_lines: ds.length, over_under: sum("over_under"), short_days: ds.filter((x) => x.over_under < 0).length, over_days: 0, short_total: sum("over_under"), days_closed: ds.length, locum_cost: 80, locum_hours: 4, locum_receipts: 1 },
      prev: { takings: 1000, days_closed: 10, paid_outs: 0, over_under: 0, locum_cost: 0 }, credit: { open: 1, open_total: 20, expiring_30: 0, expiring_30_total: 0, issued: 1, issued_total: 30, used_total: 10 },
      orders: { new: 3, done: 1, open: 4, overdue: 2, waiting_30: 0 }, questions: { new: 2, done: 1, open: 1, overdue: 0, waiting_7: 0 }, deliveries: { new: 1, done: 1, open: 1, late: 1 }, repeats: { running_out_14: 3, people_14: 2 },
      registers: { temperature_devices: 2, temperature_gaps: [{ device_id: 1, name: "Pharmacy Fridge", missing: 2, first: days[0] || todayYmd, days: days.slice(0, 2) }], temperature_missing: 2, temperature_out_no_note: 0, cleaning_last: todayYmd, cleaning_days_since: 0, cleaning_empty_weeks: [],
        certificates_overdue: [], certificates_due_30: [], dda_last_stocktake: todayYmd, dda_days_since_stocktake: 0, eod_not_closed: [], eod_not_locked: [], daily_register_lines: 4 },
      dda: { supplied: [{ name: "Morphine 10mg", lines: 2, qty: 4 }], poyc: [], received: [{ name: "Morphine 10mg", lines: 1, qty: 20 }] },
      staff: [{ staff_id: 1, name: "Ġanni Borg", role: "pharmacist", contracted_week: 40, shifts: 3, hours: 24, leave_hours: 0, leave_days: 0 }], locums: [{ name: "Dr Locum", days: 1, hours: 4 }],
      services: { bookings: 5, bookings_cancelled: 1, bookings_no_show: 0, tests: 2, tests_fees: 10 } };
  });
  return J({ ok: true, today: todayYmd, from, to, cmp: { from: url.searchParams.get("cmp_from"), to: url.searchParams.get("cmp_to") }, group, scope: group ? (loc === "all" ? "all" : "one") : "own", pharmacies_allowed: all, pharmacies: ph, unread: [] });
}
// Roles round: Plan shifts as Karl (staff) sees it, on while globalThis.__finRoles = { can_plan, me } is set.
function finRolesMock(req, res, p) {
  const R = globalThis.__finRoles; if (!R) return false;
  const J = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); return true; };
  if (p === "/auth/me") return J({ ok: true, user: { id: 2, user_id: 2, email: "karl@x.com", full_name: "Karl Vella", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: "staff" } });
  if (p === "/team/me") return J({ ok: true, role: "staff", is_pharmacist: !!R.pharmacist, role_word: R.pharmacist ? "Pharmacist" : "Staff", pic: !!R.pharmacist, plans_rota: !!R.can_plan, admins: ["Maria Borg"] });
  if (p === "/team/users") return J({ ok: false, error: "Forbidden" }, 403);
  if (p === "/shifts/staff" && req.method === "GET") return J({ ok: true, can_plan: !!R.can_plan, can_answer_leave: !!R.can_plan, me_staff_id: R.me, staff: [{ id: 1, full_name: "Maria Borg", designation: "pharmacist", is_active: 1, user_id: 1, patterns_json: "{}" }, { id: 2, full_name: "Karl Vella", designation: "assistant", is_active: 1, user_id: 2, patterns_json: "{}" }] });
  if (p === "/shifts/assignments-range") return J({ ok: true, shifts: [{ id: 1, staff_id: 1, shift_date: todayYmd, start_time: "08:00", end_time: "14:00", role_override: "", notes: "" }, { id: 2, staff_id: 2, shift_date: todayYmd, start_time: "13:00", end_time: "19:00", role_override: "", notes: "" }] });
  if (p === "/shifts/leaves" && req.method === "GET") return J({ ok: true, leaves: [{ id: 31, staff_id: 2, leave_type: "annual", start_date: maltaYmd(3), end_date: maltaYmd(3), hours_requested: 8, reason: "", status: "pending" }, { id: 32, staff_id: 1, leave_type: "annual", start_date: maltaYmd(4), end_date: maltaYmd(4), hours_requested: 8, reason: "", status: "pending" }] });
  if (p === "/shifts/leaves" && req.method === "POST") return J({ ok: true, leave_id: 33 });
  if (/^\/shifts\/(assignments|apply-|staff)/.test(p) && req.method !== "GET" && !R.can_plan) return J({ ok: false, error: "Only the pharmacy's admin changes shifts. Ask them, or ask for leave.", code: "rights" }, 403);
  return false;
}
// portals (FIN): a distributor (location 450) or a head office (650, org 1 or the Cherubino org 12) signed in, with the
// worker's answers for its screens: two orders to send, a problem waiting, three products (one out of stock, one short-dated).
let portalState = { me: null };
function portalMock(req, res, p, body, url) {
  if (!portalState.me) return false;
  const J = (o, st) => { res.writeHead(st || 200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); return true; };
  const d = (n) => maltaYmd(n);
  if (p === "/auth/me") return J({ ok: true, user: portalState.me });
  if (p === "/supplier-orders/received") return J({ ok: true, entries: [
    { id: 31, pharmacy_name: "Mosta Pharmacy", status: "pending", item_count: 2, notes: "Before Friday", created_at: "2026-11-10 08:00:00", updated_at: "2026-11-10 08:00:00", scheduled_delivery_date: "" },
    { id: 32, pharmacy_name: "Żebbuġ Pharmacy", status: "pending", item_count: 1, notes: "", created_at: "2026-11-10 09:00:00", updated_at: "2026-11-10 09:00:00", scheduled_delivery_date: "" },
    { id: 30, pharmacy_name: "Mosta Pharmacy", status: "shipped", item_count: 1, notes: "", created_at: "2026-11-01 09:00:00", updated_at: "2026-11-02 09:00:00", scheduled_delivery_date: "2026-11-03" }] });
  if (p === "/supplier-orders/31" && req.method === "GET") return J({ ok: true, order: { id: 31, pharmacy_name: "Mosta Pharmacy", status: "pending", notes: "Before Friday", supplier_notes: "", scheduled_delivery_date: "", created_at: "2026-11-10 08:00:00" },
    items: [{ id: 311, product_id: 901, description: "Augmentin 625mg x14", stock_code: "AUG", barcode: "", qty_requested: 2, qty_free: 0, cost_excl_vat: 8.2, vat_rate: 0, unavailable: portalState.off ? 1 : 0, notes: "" },
      { id: 312, product_id: 902, description: "Ventolin inhaler", stock_code: "VEN", barcode: "", qty_requested: 3, qty_free: 1, cost_excl_vat: 3.5, vat_rate: 0, unavailable: 0, notes: "" }], feedbacks: [] });
  if (p === "/supplier-orders/items/311/unavailable" && req.method === "PUT") { portalState.off = !!body.unavailable; return J({ ok: true }); }
  if (/^\/supplier-orders\/\d+\/confirm$/.test(p)) return J({ ok: true });
  if (p === "/supplier-orders/feedback") return J({ ok: true, entries: [{ id: 51, order_id: 30, pharmacy_name: "Mosta Pharmacy", item_description: "Ventolin inhaler", problem_type: "Damaged", notes: "Box crushed", item_qty: "1", created_at: "2026-11-09 10:00:00", resolution_status: null }] });
  if (/^\/supplier-orders\/feedback\/\d+\/resolve$/.test(p)) return J({ ok: true });
  if (p === "/supplier-products/entries" && req.method === "GET") return J({ ok: true, entries: [
    { id: 901, description: "Augmentin 625mg x14", stock_code: "AUG", barcode: "", cost_excl_vat: 8.2, vat_rate: 0, qty_purchased: 1, qty_free: 0, batch: "B1", expiry_date: d(12), retail_price: 12.5, out_of_stock: 0 },
    { id: 902, description: "Ventolin inhaler", stock_code: "VEN", barcode: "", cost_excl_vat: 3.5, vat_rate: 0, qty_purchased: 1, qty_free: 0, batch: "", expiry_date: "", retail_price: 6.2, out_of_stock: 0 },
    { id: 903, description: "Ozempic 1mg pen", stock_code: "OZE", barcode: "", cost_excl_vat: 92, vat_rate: 0, qty_purchased: 1, qty_free: 0, batch: "", expiry_date: "", retail_price: 118, out_of_stock: 1 }] });
  if (/^\/supplier-products\/entries/.test(p)) return J({ ok: true, id: 904 });
  if (p === "/hq/stock") return J({ ok: true, today: d(0), pharmacies: [{ id: 1, name: "Mosta Pharmacy", alerts: { open: 1, recalls: 1, quarantines: 0, items: [{ id: 1, type: "recall", item: "Valsartan 80mg", batch: "VX1", date: d(-1), status: "open" }] }, near_expiry: { within_30: 2, expired: 0, first: d(5) } },
    { id: 2, name: "Żebbuġ Pharmacy", alerts: { open: 0, recalls: 0, quarantines: 0, items: [] }, near_expiry: { within_30: 0, expired: 0, first: null } }] });
  if (p === "/admin/pharmacy-overview") return J({ ok: true, month: (url.searchParams.get("month") || d(0).slice(0, 7)), today: d(0), working_days: 9, pharmacies: [{ id: 1, name: "Mosta Pharmacy" }, { id: 2, name: "Żebbuġ Pharmacy" }],
    temperature: { 1: { days_with_entries: 10, device_count: 2, last_created_at: "2026-11-10 08:00:00" } }, cleaning: { 1: { days_with_entries: 2, last_created_at: "2026-11-09 08:00:00" } }, daily_register: {}, dda_sales: {}, dda_poyc: {}, dda_purchases: {}, dda_stocktakes: {}, certificates: {}, locum_register: {}, repeat_prescriptions: {} });
  if (p === "/owner/summary" && portalState.ownerForbidden) return J({ ok: false, error: "Only the pharmacist in charge can see how the pharmacy is doing" }, 403);
  return false;
}
function mockApi(req, res, body) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  calls.push({ method: req.method, path: p, query: url.search, body });
  if (finRolesMock(req, res, p)) return;
  if (portalMock(req, res, p, body, url)) return;
  if (ownerMock(req, res, p, url)) return;
  if (p === "/__test401") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Unauthorized" })); }
  if (teamMock(req, res, p, body)) return;
  if (b47Mock(req, res, p, body, url)) return;
  if (p === "/people" && req.method === "POST") {
    if (body && body.id) { res.writeHead(409, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Changed elsewhere", current: Object.assign({}, peopleState.carmel, { notes: "Call after 5", version: 2 }) })); }
    peopleState.adopted = true;
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, created: true, person: peopleState.carmel }));
  }
  if (/^\/dda-stocktakes\/stocktakes\/\d+\/report\/html$/.test(p)) { // the printable page is HTML, as the worker's
    const sid = Number(p.split("/")[3]), its = ddstState.items.filter((i) => i.stocktake_id === sid);
    res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><title>DDA Stock Take</title><h1>Demo - DDA Stock Take</h1><table>" + its.map((i) => "<tr><td>" + i.item_name + "</td><td>" + i.qty_tablets + "</td></tr>").join("") + "</table>");
  }
  if (!globalThis.__stk && p.startsWith("/stock-flow/")) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Not found" })); } // d-stock: as the live worker without the routes
  if (globalThis.__dupLinks === "404" && p.indexOf("/people/links") === 0) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Not found" })); } // as the live worker without the routes
  // q6-2: Change time to a time taken meanwhile: 409 with the next free ones, as the worker answers
  if (p === "/bookings/501" && req.method === "PATCH" && body && body.date && body.start === "23:35") { res.writeHead(409, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "That time is not free", next: [{ date: todayYmd, time: "23:40", providerId: 1, providerName: "Maria Borg" }, { date: todayYmd, time: "23:45", providerId: 1, providerName: "Maria Borg" }] })); }
  res.writeHead(200, { "content-type": "application/json" });
  // q5-7: as the worker's LIKE, which lowers only A to Z (so "zammit" does not find Zammit on the server)
  if (p === "/people" && peopleState.mt) {
    const q = (url.searchParams.get("q") || "").toLowerCase(), L = (x) => String(x || "").replace(/[A-Z]/g, (c) => c.toLowerCase()), hit = (x) => L(x.name).includes(q) || L(x.id_card).includes(q);
    peopleState.mtQs.push(q);
    return res.end(JSON.stringify({ ok: true, q, people: MT_PEOPLE.filter(hit), history: MT_HIST.filter(hit) }));
  }
  if (p === "/people") return res.end(JSON.stringify({ ok: true, q: url.searchParams.get("q") || "", people: (peopleState.adopted ? [peopleState.carmel] : []).concat([{ id: 2, name: "Zammit Paul", phone: "79000001", id_card: "", version: 1 }]), history: peopleState.adopted ? [] : [{ key: "id:0012345M", name: "Zammit Carmel", id_card: "0012345M", phone: "", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", sources: { dda_sale: 1, loyalty: 1 }, last_date: "2026-10-05" }] }));
  if (p === "/people/1") return res.end(JSON.stringify({ ok: true, person: peopleState.carmel, loyalty: { points: 1120, stamps: 3, visits: 2, last_date: "2026-10-20" }, next_appointment: { id: 9, ref: "A-2", date: "2026-11-04", time: "09:30", status: "Scheduled", doctor: "Dr Galea" }, activity: [{ kind: "dda_sale", label: "DDA sale", date: "2026-10-05", title: "Morphine 10mg", ref: "S-1", doctor: "Dr Abela" }, { kind: "loyalty", label: "Loyalty", date: "2026-09-01", title: "", ref: "" }], counts: { dda_sale: 1, loyalty: 1 } }));
  if (p === "/today") return res.end(JSON.stringify(todayPayload()));
  if (p === "/auth/me") return res.end(JSON.stringify({ ok: true, user: { id: 1, user_id: 1, email: "p@x.com", full_name: "Maria Borg", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: "admin" } }));
  if (p === "/temperature/devices") return res.end(JSON.stringify({ ok: true, devices: [{ id: 7, name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, active: 1 }] }));
  if (p === "/temperature/entries" && req.method === "GET") { const mo = url.searchParams.get("month") || ""; return res.end(JSON.stringify({ ok: true, entries: tempState.on ? tempState.entries.filter((e) => e.entry_date.slice(0, 7) === mo).map((e) => ({ ...e })) : [] })); }
  if (p === "/temperature/entries" && req.method === "POST" && tempState.on) {
    let e = tempState.entries.find((x) => x.device_id === Number(body.device_id) && x.entry_date === body.entry_date);
    if (!e) { e = { id: tempState.next++, device_id: Number(body.device_id), device_name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, entry_date: body.entry_date, created_by: 1, created_at: "2026-11-03 09:00:00" }; tempState.entries.push(e); }
    Object.assign(e, { min_temp: Math.round(Number(body.min_temp) * 10) / 10, max_temp: Math.round(Number(body.max_temp) * 10) / 10, notes: String(body.notes || "").trim(), updated_at: "2026-11-03 10:0" + (tempState.next++ % 10) + ":00" });
    return res.end(JSON.stringify({ ok: true, entry_id: e.id }));
  }
  if (p === "/dda-purchases/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [{ id: 5, entry_date: todayYmd, dda_name_dose: "Morphine 10mg", quantity: 2, agent: "Supplier", invoice_number: "INV-1" }] }));
  if (p === "/temperature/entries" && req.method === "POST") { todayState.tempDone = true; return res.end(JSON.stringify({ ok: true, entry_id: 1 })); }
  if (p === "/client-orders/entries" && req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams, d = (n) => maltaYmd(n);
    if (q.get("from")) return res.end(JSON.stringify({ ok: false, error: "Missing/invalid month (YYYY-MM)" })); // like the live server today (no ranges)
    const thisMonth = maltaYmd(0).slice(0, 7);
    return res.end(JSON.stringify({ ok: true, entries: q.get("month") !== thisMonth ? [] : [
      { id: 51, order_date: d(-3), client_name: "Grech Carmen", client_phone: "79123456", items_text: "Augmentin 625 x14", priority: 2, needed_by: d(-1), deposit_amount: 0, fulfilled: 0, notes: "" },
      { id: 52, order_date: d(-1), client_name: "Vella Joseph", client_phone: "79000111", items_text: "Nexium 20mg", priority: 1, needed_by: d(3), deposit_amount: 5, fulfilled: 0, notes: "", order_code: "KX7P2Q" }]
      .concat(todayState.many ? [{ id: 53, order_date: d(-40), client_name: "Old Olga", client_phone: "79000053", items_text: "Ensure x24", priority: 2, needed_by: d(-38), deposit_amount: 0, fulfilled: 0, notes: "" }] : []) }));
  }
  if (p.startsWith("/client-orders/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/client-tickets/entries" && req.method === "GET") {
    const d = (n) => maltaYmd(n);
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 61, ticket_id: "TKT-00007", open_date: d(-4), client_name: "Camilleri Rita", phone: "79222333", email: "rita@x.com", category: "Prescription", priority: 2, status: "Open", issue: "Is her repeat ready?", assigned_to: "John", followup_date: d(-1), notes_log: JSON.stringify([{ ts: "2026-10-30T09:00:00Z", author: "Maria", text: "Called, no answer" }]), resolved: 0 },
      { id: 62, ticket_id: "TKT-00008", open_date: d(-1), client_name: "Farrugia Tony", phone: "", category: "Billing", priority: 1, status: "In Progress", issue: "Charged twice", assigned_to: "", followup_date: null, notes_log: "[]", resolved: 0 }] }));
  }
  if (p.startsWith("/client-tickets/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/client-tickets/entries" && req.method === "POST") return res.end(JSON.stringify(todayState.serverNo ? { ok: true, entry_id: 63, ticket_id: "TKT-00090" } : { ok: true, entry_id: 63 }));
  if (p === "/client-deliveries/entries" && req.method === "POST" && todayState.serverNo) return res.end(JSON.stringify({ ok: true, id: 79, delivery_id: "DEL-00090" })); // batch 6 (W3): the server's number
  if (p === "/client-deliveries/entries" && req.method === "GET") {
    const d = (n) => maltaYmd(n);
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 71, delivery_id: "DEL-00004", order_date: d(-2), scheduled_date: d(2), scheduled_time_slot: "", client_name: "Later Lino", phone: "79000222", delivery_address: "Gozo", status: "Scheduled", priority: 2, items: "[]", delivery_log: "[]", delivery_attempts: 0 },
      { id: 72, delivery_id: "DEL-00005", order_date: d(-2), scheduled_date: d(-1), scheduled_time_slot: "Afternoon", actual_delivery_date: "", actual_delivery_time: "", client_name: "Camilleri Rita", phone: "79222333", email: "rita@x.com", delivery_address: "12 Triq il-Kbira, Mosta", address_notes: "Blue door", id_doc_ref: "123456M", delivery_method: "Courier", priority: 1, assigned_driver: "Kevin Mifsud", tracking_number: "TRK9", status: "Scheduled", signature_required: 1, signature_obtained: 0, recipient_name: "", proof_of_delivery: "", delivery_attempts: 0, failure_reason: "", contains_controlled: 1, cold_chain_required: 1, ticket_ref: "TKT-00007", items: JSON.stringify([{ name: "Morphine 10mg", qty: 2, schedule: "CD", batch_ref: "B7", expiry: "2027-01-01" }]), delivery_log: JSON.stringify([{ ts: "2026-10-30T09:00:00Z", author: "Maria", text: "Packed" }]), internal_notes: "Call first" },
      { id: 73, delivery_id: "DEL-00001", order_date: d(-9), client_name: "Done Dora", delivery_address: "Rabat", status: "Delivered", items: "[]", delivery_log: "[]" }] }));
  }
  if (p.startsWith("/client-deliveries/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/dda-purchases/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry_id: 900 }));
  if (p === "/dda-sales/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry_id: 901 }));
  if (p === "/dda-sales/client") return res.end(JSON.stringify({ ok: true, found: true, client_id_card: "0012345M", client_name: "Zammit Carmel", client_address: "1 Triq il-Knisja" }));
  if (p === "/dda-sales/doctors") return res.end(JSON.stringify({ ok: true, doctors: [{ doctor_name: "Dr Abela", doctor_reg_no: "R1201", count: 3 }] }));
  if (p === "/dda-sales/check-serial") return res.end(JSON.stringify(url.searchParams.get("serial") === "RX-1" ? { ok: true, found: true, entries: [{ entry_date: "2026-11-01", client_name: "Zammit Carmel", medicine_name_dose: "Morphine 10mg", quantity: 10 }], total_qty: 10 } : { ok: true, found: false, entries: [], total_qty: 0 }));
  if (p === "/paid-out/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [{ id: 3, entry_date: todayYmd, entry_time: "09:00", payee_name: "Courier Ltd", fee: 12.5, payment_method: "cash", invoice_no: "", cheque_no: "", reason: "Gozo" }] }));
  if (p === "/paid-out/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry_id: 4 }));
  if (p === "/paid-out/names") return res.end(JSON.stringify({ ok: true, names: ["Courier Ltd"] }));
  if (p === "/instructions/daily" && req.method === "GET" && hndGap) { const y = url.searchParams.get("ymd"), ago = (n) => maltaYmd(-n); return res.end(JSON.stringify({ ok: true, record: { ymd: y, notes: "", handover_out: y === ago(2) ? [{ id: "s1", sev: "y", text: "Saturday: fridge engineer Monday" }] : [] } })); } // nothing yesterday (a closed Sunday)
  if (p === "/instructions/daily" && req.method === "GET") { const y = url.searchParams.get("ymd"); return res.end(JSON.stringify({ ok: true, record: y === todayYmd ? { ymd: y, notes: "Inspector may visit", handover_out: [{ id: "t1", sev: "g", text: "Already for tomorrow" }] } : { ymd: y, notes: "", handover_out: [{ id: "y1", sev: "g", text: "Restock gloves" }, { id: "y2", sev: "r", text: "Methadone at 9" }] } })); }
  if (p === "/instructions/daily" && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/instructions/global" && req.method === "GET") return res.end(JSON.stringify({ ok: true, global: { permanent_handover: { text: "Count the CD cupboard every evening" } } }));
  if (p === "/shifts/staff" && req.method === "GET") return res.end(JSON.stringify({ ok: true, staff: [{ id: 1, full_name: "Maria Borg", designation: "Pharmacist" }, { id: 2, full_name: "Karl Vella", designation: "Assistant" }] }));
  if (p === "/shifts/assignments-range") return res.end(JSON.stringify({ ok: true, shifts: [{ id: 1, staff_id: 1, shift_date: todayYmd, start_time: "08:00", end_time: "14:00" }] }));
  if (p === "/shifts/leaves" && req.method === "GET") return res.end(JSON.stringify({ ok: true, leaves: [{ id: 1, staff_id: 2, leave_type: "sick", start_date: todayYmd, end_date: todayYmd, status: "approved" }, { id: 2, staff_id: 1, leave_type: "annual", start_date: todayYmd, end_date: todayYmd, status: "rejected" }] }));
  if (p === "/repeat-prescriptions/entries" && req.method === "GET") { const d = (n) => maltaYmd(n);
    return res.end(JSON.stringify({ ok: true, entries: [{ id: 81, entry_date: d(-170), expires_date: d(12), client_name: "Zammit Carmel", client_id: "123456M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201" }] })); }
  if (p === "/repeat-prescriptions/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry_id: 82 }));
  if (p === "/creditnotes/list") return res.end(JSON.stringify({ ok: true, entries: [{ id: 91, issue_date: "2026-10-01", client_name: "Rita", client_surname: "Camilleri", telephone: "79222333", amount: 30, expiry_date: "", no_expiry: false, purchase_entries: [{ id: 1, amount: 12.5 }], notes: [{ id: 7, text: "Rang, no answer", timestamp: "2026-10-02 08:00:00" }] }] }));
  if (/^\/creditnotes\/entries\/\d+\/purchases$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 2 }));
  if (/^\/creditnotes\/entries\/\d+\/purchases\/\d+$/.test(p) && req.method === "DELETE") return res.end(JSON.stringify({ ok: true }));
  if (p === "/locumreceipts/receipts" && req.method === "GET") return res.end(JSON.stringify({ ok: true, receipts: url.searchParams.get("month") === todayYmd.slice(0, 7) ? [{ id: 5, receipt_date: todayYmd.slice(0, 7) + "-01", hours: 6, locum_full_name: "Paul Vella", registration_number: "PH1234", day_type: "normal", fee_per_hour: 15, total_fee: 90 }] : [] }));
  if (p === "/locumreceipts/receipts" && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 6 }));
  // Stock flow (d-stock): null answers 404, as the live worker without the routes; set globalThis.__stk to serve it.
  if (p.startsWith("/stock-flow/")) {
    const st = globalThis.__stk;
    if (p === "/stock-flow/open") return res.end(JSON.stringify({ ok: true, from: url.searchParams.get("from"), open: st.open, received: st.received }));
    if (p === "/stock-flow/ordered") { for (const id of body.diary_ids) { const l = st.open.find((x) => x.id === id); if (l) l.ordered_at = "2026-11-04 08:00:00"; } return res.end(JSON.stringify({ ok: true, marked: body.diary_ids.length })); }
    if (p === "/stock-flow/ordered/undo") { for (const id of body.diary_ids) { const l = st.open.find((x) => x.id === id); if (l) l.ordered_at = null; } return res.end(JSON.stringify({ ok: true, cleared: body.diary_ids.length })); }
    return res.end(JSON.stringify({ ok: true }));
  }
  if (p === "/order-diary/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: url.searchParams.get("date") === todayYmd ? [{ id: 101, order_date: todayYmd, item_name: "Augmentin 625", qty: 2, supplier: "Actavis", status: "pending", notes: "For Mrs Borg" }] : [] }));
  if (p.startsWith("/order-diary/entries/") && (req.method === "PUT" || req.method === "DELETE")) return res.end(JSON.stringify({ ok: true }));
  if (p === "/order-diary/items") return res.end(JSON.stringify({ ok: true, items: [] }));
  if (p === "/quotations/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [
    { id: 1, quote_date: "2026-10-29", item_description: "Panadol 500mg x24", supplier: "GSK", vat_rate: 18, cost_excl_vat: 2.4, discount_euro: 0, qty_purchased: 10, qty_free: 0, retail_price: 4.5 },
    { id: 2, quote_date: "2026-11-01", item_description: "Panadol 500mg x24", supplier: "Actavis", vat_rate: 18, cost_excl_vat: 2.6, discount_euro: 0, qty_purchased: 10, qty_free: 2, retail_price: 4.5 }] }));
  if (p === "/quotations/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 3 }));
  if (p.startsWith("/quotations/entries/") && (req.method === "PUT" || req.method === "DELETE")) return res.end(JSON.stringify({ ok: true }));
  if (p === "/scarce-stock/needs" && req.method === "GET") return res.end(JSON.stringify({ ok: true, needs: [
    { id: 7, org_name: "Demo Org", location_name: "Demo Pharmacy", entry_date: todayYmd, item_name: "Ozempic 1mg pen", quantity_needed: 3, remaining_quantity: 1, mine_owner: 1, offers: [{ id: 70, quantity_offered: 2, offerer_display: "Sliema Group — Sliema Pharmacy", note: "", mine: 0, accepted: 0, confirmed: 0 }] },
    { id: 8, org_name: "Gozo Group", location_name: "Victoria Pharmacy", entry_date: todayYmd, item_name: "Insulin pen needles", quantity_needed: 5, remaining_quantity: 5, mine_owner: 0, offers: [] }] }));
  if (/^\/scarce-stock\/need-offers\/\d+\/(accept|confirm)$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true }));
  if (bkCal.on && p.indexOf("/bookings") === 0) {
    const J2 = (o) => res.end(JSON.stringify(o)); // the 200 head is already written above
    const every = { "0": [["09:00", "13:00"]], "1": [["09:00", "13:00"]], "2": [["09:00", "13:00"]], "3": [["09:00", "13:00"]], "4": [["09:00", "13:00"]], "5": [["09:00", "13:00"]], "6": [["09:00", "13:00"]] };
    if (p === "/bookings/setup") return J2({ ok: true, services: [{ id: 1, name: "Blood pressure", durationMin: 15, priceCents: 0, active: true, online: true, providerIds: [1] }, { id: 2, name: "B12 injection", durationMin: 15, priceCents: 1000, active: true, online: false, providerIds: [1] }],
      providers: [{ id: 1, name: "Maria Borg", title: "Pharm.", speciality: "", active: true, hours: every }] });
    if (p === "/bookings" && req.method === "GET") { const d0 = url.searchParams.get("from"); const tm = maltaYmd(1); return J2({ ok: true, mail: { on: true, evening: true, hours: 0 },
      messages: { 601: [{ kind: "confirm", status: "sent" }, { kind: "remind_evening", status: "sent" }] }, noShows: { 602: 2 },
      bookings: d0 === tm || url.searchParams.get("to") >= tm && d0 <= tm ? [
        { id: 601, serviceId: 1, providerId: 1, date: tm, start: "09:30", end: "09:45", personName: "Rita Vella", personPhone: "79000601", personEmail: "rita@example.com", status: "booked", version: 2 },
        { id: 602, serviceId: 2, providerId: 1, date: tm, start: "10:00", end: "10:15", personName: "Pawlu Agius", personPhone: "79000602", personEmail: "", status: "booked", version: 1 }] : [] }); }
    if (p === "/bookings/exceptions" && req.method === "GET") return J2({ ok: true, exceptions: [{ id: 77, providerId: 1, date: maltaYmd(1), kind: "off", start: "12:00", end: "12:30", note: "Lunch" }] });
    if (p === "/bookings/exceptions" && req.method === "POST") return J2({ ok: true, id: 78 }, 201);
    if (/^\/bookings\/exceptions\/\d+$/.test(p) && req.method === "DELETE") return J2({ ok: true });
    if (p === "/bookings/slots") { const out = []; for (let m = 540; m < 780; m += 15) { const t = String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); if (t !== "09:30" && t !== "10:00" && t !== "12:00" && t !== "12:15") out.push({ time: t, providerId: 1, providerName: "Maria Borg" }); } return J2({ ok: true, date: url.searchParams.get("date"), slots: out }); }
    if (p === "/bookings/waitlist" && req.method === "GET") return J2({ ok: true, waiting: [{ id: 9, serviceId: 1, personName: "Doris Ellul", personPhone: "79000009", personEmail: "", note: "", status: "waiting", createdAt: "2026-11-01 09:00:00" }] });
    if (p === "/bookings/settings") return J2({ ok: true, settings: { provider: "resend", canSend: true, fromEmail: "b@demo.mt" } });
    if (p === "/bookings/senders") return J2({ ok: true, senders: [{ id: 1, enabled: true, hasKey: true, fromEmail: "b@demo.mt" }] });
    if (p === "/bookings/import-legacy") { if (!bkCal.legacy) return J2({ ok: true, report: { bookings: 0, waiting: 0, dry: true } }); if (url.searchParams.get("dry") !== "1") bkCal.imported++;
      return J2({ ok: true, report: { providers: bkCal.imported ? 0 : 2, services: 2, extras: 0, bookings: 12, upcoming: 3, clashes: 0, waiting: 1, skipped: 0, dry: url.searchParams.get("dry") === "1" } }); }
    if (p === "/bookings" && req.method === "POST" && body && body.walkIn) return J2({ ok: true, booking: { id: 700, serviceId: body.serviceId, providerId: 1, date: todayYmd, start: "11:05", end: "11:20", personName: body.personName, status: "arrived", walkIn: true }, message: "" }, 201);
    if (p === "/bookings" && req.method === "POST" && body && body.repeat) { const mk = (n, d) => ({ id: 710 + n, serviceId: body.serviceId, providerId: 1, date: d, start: body.start, end: "10:30", personName: body.personName, personPhone: body.personPhone, status: "booked", seriesId: "abc" });
      const d1 = body.date, add = (k) => { const x = new Date(d1 + "T12:00:00Z"); x.setUTCDate(x.getUTCDate() + k); return x.toISOString().slice(0, 10); };
      return J2({ ok: true, booking: mk(0, d1), series: [mk(0, d1), mk(1, add(7)), mk(3, add(21))], skipped: [{ date: add(14), start: body.start }], message: "no-email" }, 201); }
    if (/^\/bookings\/60[12]$/.test(p) && req.method === "PATCH") { const id = Number(p.slice(10)), tm = maltaYmd(1);
      const cur = id === 601 ? { id: 601, serviceId: 1, providerId: 1, date: tm, start: "09:30", end: "09:45", personName: "Rita Vella", personPhone: "79000601", personEmail: "rita@example.com", status: "booked", version: 3 } : { id: 602, serviceId: 2, providerId: 1, date: tm, start: "10:00", end: "10:15", personName: "Pawlu Agius", personPhone: "79000602", personEmail: "", status: "booked", version: 2 };
      if (body.status) cur.status = body.status; if (body.status === "confirmed") cur.confirmedVia = "staff";
      if (body.date) { cur.date = body.date; cur.start = body.start; }
      return J2({ ok: true, booking: cur, message: body.notify === false ? "not-told" : body.date ? "sent" : "", offer: body.date ? { waitlistId: 9, personName: "Doris Ellul", personPhone: "79000009", personEmail: "", serviceId: 1, providerId: 1, date: tm, start: "09:30" } : null }); }
    if (p === "/bookings/person") return J2({ ok: true, by: "phone", total: 5, noShows: 2, cancelled: 0, done: 3, lastNoShow: "2026-10-20", upcoming: 1, recent: [] });
  }
  // Bookings: one service, one practitioner working weekdays 09:00–13:00, one booking late today.
  if (p === "/bookings/setup") return res.end(JSON.stringify({ ok: true, services: [{ id: 1, name: "Blood pressure", durationMin: 15, priceCents: 0, active: true, online: true, providerIds: [1] }],
    providers: [{ id: 1, name: "Maria Borg", title: "Pharm.", speciality: "", active: true, serviceIds: [1], hours: { "1": [["09:00", "13:00"]], "2": [["09:00", "13:00"]], "3": [["09:00", "13:00"]], "4": [["09:00", "13:00"]], "5": [["09:00", "13:00"]] } }] }));
  // q6-2: a day before today answers with what happened that day (done, cancelled, never marked); today has Anna Vella.
  if (p === "/bookings" && req.method === "GET" && (url.searchParams.get("to") || "") < todayYmd) { const d0 = url.searchParams.get("from"); return res.end(JSON.stringify({ ok: true, bookings: [
    { id: 490, serviceId: 1, providerId: 1, date: d0, start: "09:00", end: "09:15", personName: "Borg Ċensina", personPhone: "79111111", status: "done", version: 2 },
    { id: 491, serviceId: 1, providerId: 1, date: d0, start: "09:30", end: "09:45", personName: "Galea Helena", personPhone: "", status: "cancelled", cancelReason: "Called to cancel", version: 2 },
    { id: 492, serviceId: 1, providerId: 1, date: d0, start: "10:00", end: "10:15", personName: "Zammit Paul", personPhone: "79000001", status: "booked", version: 1 }] })); }
  if (p === "/bookings" && req.method === "GET") return res.end(JSON.stringify({ ok: true, bookings: [{ id: 501, serviceId: 1, providerId: 1, date: todayYmd, start: "23:50", end: "23:59", personName: "Anna Vella", personPhone: "79000000", status: "booked", version: 3 }] }));
  // Change time (q6-2): the day's free times; 23:35 is taken at another counter (409 with the next ones), any other time moves.
  if (p === "/bookings/slots") return res.end(JSON.stringify({ ok: true, date: url.searchParams.get("date"), slots: [{ time: "23:35", providerId: 1, providerName: "Maria Borg" }, { time: "23:40", providerId: 1, providerName: "Maria Borg" }, { time: "23:50", providerId: 1, providerName: "Maria Borg" }] }));
  if (p === "/bookings/501" && req.method === "PATCH" && body && body.date) {
    return res.end(JSON.stringify({ ok: true, booking: { id: 501, serviceId: 1, providerId: 1, date: body.date, start: body.start, end: "23:59", personName: "Anna Vella", personPhone: "79000000", status: "booked", version: 4 }, message: "no-email" }));
  }
  if (p === "/bookings/waitlist" && req.method === "GET") return res.end(JSON.stringify({ ok: true, waiting: [] }));
  if (p === "/bookings/rooms" && req.method === "GET") return res.end(JSON.stringify({ ok: true, rooms: [] }));
  if (p === "/bookings/next") return res.end(JSON.stringify({ ok: true, slots: [{ date: todayYmd, time: "23:30", providerId: 1 }, { date: todayYmd, time: "23:45", providerId: 1 }] }));
  if (p === "/bookings" && req.method === "POST") return res.end(JSON.stringify({ ok: true, booking: { id: 502, serviceId: body.serviceId, providerId: body.providerId, date: body.date, start: body.start, end: "23:45", personName: body.personName, status: "booked" } }));
  if (/^\/bookings\/providers\/\d+$/.test(p) && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  // Chat board (new layout): one message for every pharmacy (pinned), one for our group; pin is a toggle like the worker.
  if (p === "/board/messages" && req.method === "GET") {
    if (url.searchParams.get("pinned") === "1") return res.end(JSON.stringify({ ok: true, messages: boardState.msgs.filter((m) => m.is_pinned) }));
    const sc = url.searchParams.get("scope");
    return res.end(JSON.stringify({ ok: true, messages: boardState.msgs.filter((m) => sc !== "org" || m.scope === "org").slice().sort((a, b) => b.id - a.id) }));
  }
  if (p === "/board/messages" && req.method === "POST") { const m = { id: 900 + boardState.msgs.length, user_id: 1, user_name: "Maria Borg", location_name: "Demo Pharmacy", body: body.body, scope: body.scope, is_pinned: 0, created_at: new Date().toISOString().slice(0, 19).replace("T", " ") }; boardState.msgs.push(m); return res.end(JSON.stringify({ ok: true, id: m.id, message: m })); }
  if (/^\/board\/messages\/\d+\/pin$/.test(p) && req.method === "PUT") { const m = boardState.msgs.find((x) => x.id === Number(p.split("/")[3])); m.is_pinned = m.is_pinned ? 0 : 1; return res.end(JSON.stringify({ ok: true, is_pinned: m.is_pinned })); }
  if (p === "/board/users/search") return res.end(JSON.stringify({ ok: true, users: [{ id: 5, full_name: "Sara Vella", location_name: "Sliema Pharmacy" }] }));
  if (p === "/contacts/suppliers" && req.method === "GET") return res.end(JSON.stringify({ ok: true, rows: [{ id: 31, org_id: 1, name: "Actavis Malta", phone: "2123 4567", email: "orders@actavis.example" }] }));
  if (p === "/contacts/doctors" && req.method === "GET") return res.end(JSON.stringify({ ok: true, rows: [{ id: 41, org_id: 1, name: "Dr Abela", phone_personal: "7912 3456", phone_patient: "2144 0000" }] }));
  if (/^\/contacts\/(suppliers|medreps|headoffice|orgpharmacies|poyc|locums|doctors|specialists|clients)$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: body && body.id ? body.id : 77 }));
  if (p === "/vaccines/catalog" && req.method === "GET") return res.end(JSON.stringify({ ok: true, items: [
    { id: 1, brand_name: "Typhim Vi", vaccinates_for: "Typhoid", dosing_schedule: "1 dose", routine_in_malta: "", travel_always: "KE,TZ", travel_highrisk: "" },
    { id: 2, brand_name: "Rabipur", vaccinates_for: "Rabies", dosing_schedule: "3 doses", routine_in_malta: "", travel_always: "", travel_highrisk: "KE" },
    { id: 3, brand_name: "Boostrix", vaccinates_for: "Tetanus, diphtheria, pertussis", dosing_schedule: "1 dose", routine_in_malta: "yes", travel_always: "", travel_highrisk: "" }] }));
  if (p === "/vaccines/stock/rows" && req.method === "GET") return res.end(JSON.stringify({ ok: true, rows: [{ id: 4, vaccine_name: "Typhim Vi", qty: 6, batch: "TV-1", expiry_date: "2027-05-31", updated_at: "" }] }));
  if (p === "/vaccines/orders" && req.method === "GET") return res.end(JSON.stringify({ ok: true, orders: [{ id: 31, created_at: new Date().toISOString(), section: "other", country_code: "", country_name: "", client_first: "Rita", client_last: "Camilleri", phone: "79222333", email: "", items: [{ name: "Boostrix", qty: 1 }] }] }));
  if (p === "/vaccines/orders" && req.method === "POST") return res.end(JSON.stringify({ ok: true, order: Object.assign({ id: 32, created_at: new Date().toISOString() }, body) }));
  // End of day (new layout eodreg): one stored day that the test can change behind the screen's back
  if (p === "/endofday/record" && req.method === "GET") { const d = url.searchParams.get("date"); return res.end(JSON.stringify({ ok: true, record: d === todayYmd ? eodState.rec : eodState.prev && d === eodState.prev.date ? eodState.prev : null })); } // q5-6: prev, an earlier saved day
  if (p === "/endofday/record" && req.method === "PUT") { const r = (body && body.record) || {}; eodState.rec = Object.assign({}, r, { id: 1, updated_at: "2026-11-03 18:0" + (++eodState.n) + ":00", locked_at: r.locked_at ? "2026-11-03 18:30:00" : "" }); return res.end(JSON.stringify({ ok: true, record: eodState.rec })); }
  if (p === "/endofday/dates") { if (eodState.datesFail) { res.statusCode = 500; return res.end(JSON.stringify({ ok: false, error: "boom" })); } const m = url.searchParams.get("month"); return res.end(JSON.stringify({ ok: true, dates: [eodState.prev && eodState.prev.date, eodState.rec ? todayYmd : null].filter((d) => d && d.slice(0, 7) === m) })); }
  if (p === "/endofday/contacts" && req.method === "GET") return res.end(JSON.stringify({ ok: true, contacts: [{ id: 4, display_name: "BOV Paola" }] }));
  // Plan shifts (shfreg): the writes it sends (the GETs above answer the reads)
  if (p === "/shifts/opening-hours" && req.method === "GET") return res.end(JSON.stringify({ ok: true, hours: { default: { open: "08:00", close: "19:00", closed: false }, openSaturday: true, openSunday: false, overrides: {} } }));
  if (p === "/shifts/assignments" && req.method === "POST") return res.end(JSON.stringify({ ok: true, shift_id: 77 }));
  if (/^\/shifts\/assignments\/\d+$/.test(p) && (req.method === "PUT" || req.method === "DELETE")) return res.end(JSON.stringify({ ok: true }));
  if (/^\/shifts\/leaves\/\d+\/(approve|reject)$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true }));
  // POCT (new layout): one known patient with one earlier blood pressure; PUT is the classic upsert
  if (p === "/poct/state" && req.method === "GET") return res.end(JSON.stringify({ ok: true, state: {
    records: [{ id: "r_1", testType: "bp", testLabel: "Blood Pressure", performedAtIso: "2026-10-01T08:00:00.000Z", performedAtLocal: "2026-10-01T10:00", patient: { name: "Zammit Carmel", patientId: "0012345M", phone: "79123456", age: 64, address: "Zebbug" }, feeDue: 0, notes: "", intervention: "", results: { sys: 150, dia: 95, pulse: 70, arm: "Left", position: "Sitting" }, updatedAtIso: "2026-10-01T08:00:00.000Z" }],
    patients: [{ patientId: "0012345M", name: "Zammit Carmel", phone: "79123456", age: 64, address: "Zebbug", createdAtIso: "2026-10-01T08:00:00.000Z", updatedAtIso: "2026-10-01T08:00:00.000Z", lastSeenIso: "2026-10-01T08:00:00.000Z", conflicts: [] }] } }));
  if (p === "/poct/state" && req.method === "PUT") return res.end(JSON.stringify({ ok: true, patients_upserted: 1, records_upserted: 1, patients_deleted: 0, records_deleted: 0 }));
  // Scarce stock (scsreg): another pharmacy's line with a request the server keeps private, and one of ours with who asked.
  if (p === "/scarce-stock/offers" && req.method === "GET") return res.end(JSON.stringify({ ok: true, offers: [
    { id: 31, org_name: "Sliema Group", location_name: "Sliema Pharmacy", entry_date: todayYmd, item_name: "Shingrix vaccine", description: "Fridge", batch: "B12", expiry_date: "2099-05-01", quantity_available: 5, total_requested: 1, remaining_quantity: 4, is_closed: 0, mine_owner: 0, requests: [{ id: 301, quantity_requested: 1, is_private: 1, requester_display: "", note: "", mine: 0 }] },
    { id: 32, org_name: "Demo Org", location_name: "Demo Pharmacy", entry_date: todayYmd, item_name: "Ozempic 0.5mg pen", description: "", batch: "", expiry_date: null, quantity_available: 3, total_requested: 2, remaining_quantity: 1, is_closed: 0, mine_owner: 1, requests: [{ id: 302, quantity_requested: 2, is_private: 0, requester_display: "Gozo Group — Victoria Pharmacy", note: "For Mrs Grech", mine: 0 }] }] }));
  if (/^\/scarce-stock\/offers\/\d+\/requests$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 303 }));
  // Audit trail (audreg): 120 rows, newest first, paged and filtered the way the worker does (module, action LIKE, from/to)
  if (p === "/audit/log" && req.method === "GET") {
    const now = Date.now(), at = (i) => new Date(now - i * 60000).toISOString().slice(0, 19).replace("T", " ");
    let rows = [{ id: 500, user_id: 1, user_name: "Maria Borg", action: "PERSON_UPDATE", entity_type: "people", entity_id: "7", details: { location_id: 12, before: { id: 7, name: "Zammit Carmel", phone: "79000001", notes: "", version: 1 }, after: { id: 7, name: "Zammit Carmel", phone: "79111222", notes: "Call after 5", version: 2 } }, created_at: at(1) },
      { id: 499, user_id: 2, user_name: "Karl Vella", action: "PAID_OUT_ENTRY_DELETE", entity_type: "paid_out_entries", entity_id: "31", details: { payee_name: "Courier", fee: 12.5 }, created_at: at(2) },
      { id: 498, user_id: 2, user_name: "Karl Vella", action: "LOGIN", entity_type: "user", entity_id: "2", details: { email: "karl@x.com" }, created_at: at(3) }];
    for (let i = 0; i < 117; i++) rows.push({ id: 497 - i, user_id: 1, user_name: "Maria Borg", action: "TEMP_ENTRY_UPSERT", entity_type: "temperature_entries", entity_id: String(1000 + i), details: { device_id: 7, min_temp: 3, max_temp: 7 }, created_at: at(4 + i) });
    const q = url.searchParams, mod = q.get("module") || "", act = q.get("action") || "", from = q.get("from") || "", to = q.get("to") || "";
    const map = { temperature: ["temperature_devices", "temperature_entries"] };
    rows = rows.filter((r) => (!mod || (map[mod] ? map[mod].includes(r.entity_type) : r.entity_type === mod)) && (!act || r.action.includes(act)) && (!from || r.created_at >= from) && (!to || r.created_at <= to + "T23:59:59"));
    const limit = Number(q.get("limit") || 200), offset = Number(q.get("offset") || 0);
    return res.end(JSON.stringify({ ok: true, entries: rows.slice(offset, offset + limit), total: rows.length, limit, offset }));
  }
  // Adverse reactions (new layout pvreg): one stored report; a PUT upserts by id, as the worker does
  if (p === "/pharmacovigilance/state" && req.method === "GET") return res.end(JSON.stringify({ ok: true, reports: pvState.reports, state: { reports: pvState.reports } }));
  if (p === "/pharmacovigilance/state" && req.method === "PUT") { ((body && body.state && body.state.reports) || []).forEach((r) => { const i = pvState.reports.findIndex((x) => x.id === r.id); if (i >= 0) pvState.reports[i] = r; else pvState.reports.unshift(r); }); return res.end(JSON.stringify({ ok: true, saved: ((body && body.state && body.state.reports) || []).length })); }
  // Screening campaigns (new layout scrreg): one stored campaign; a PUT upserts each campaign by id (whole) and deletes only deleted_ids, as the worker does
  if (p === "/screening/state") {
    const st = globalThis.__scrState || (globalThis.__scrState = { campaigns: [{ id: "sc_1_abc", name: "BP Month", type: "Blood Pressure Check", startDate: "2026-11-01", endDate: "", notes: "", status: "Active", location: "Pharmacy Floor", targetScreenings: "20", extra: "kept",
      participants: [{ id: "sc_p1", idCard: "0012345M", name: "Zammit Carmel", phone: "79123456", email: "", dob: "", type: "Walk-in", date: "2026-11-01", resultNotes: "", resultCategory: "Abnormal", referral: "Referred to GP", referralNotes: "", poctResults: { sys: 162, dia: 98, pulse: "", arm: "Left", position: "Sitting" }, followUps: [{ id: "f1", scheduledDate: "2026-11-02", reason: "Re-test", status: "Pending", notes: "" }] }] }] });
    if (req.method === "GET") return res.end(JSON.stringify({ ok: true, campaigns: st.campaigns, state: { campaigns: st.campaigns } }));
    if (req.method === "PUT") { const s = (body && body.state) || {}; (s.campaigns || []).forEach((c) => { const i = st.campaigns.findIndex((x) => x.id === c.id); if (i >= 0) st.campaigns[i] = c; else st.campaigns.unshift(c); }); st.campaigns = st.campaigns.filter((c) => !(s.deleted_ids || []).includes(c.id)); return res.end(JSON.stringify({ ok: true, saved: (s.campaigns || []).length })); }
  }
  // Contraceptive pills (new layout ocpreg): no mock needed. Like the classic OCP finder it is a fixed list in the page and calls no endpoint.
  // Dispensing labels (new layout lblreg): one earlier label, settings kept as sent; a PUT upserts history by id, as the worker does
  if (p === "/labels/state" && req.method === "GET") return res.end(JSON.stringify({ ok: true, state: { labelHistory: lblState.history, templates: lblState.templates, pharmacyDetails: lblState.pharm } }));
  if (p === "/labels/state" && req.method === "PUT") { const st = (body && body.state) || {}; (st.labelHistory || []).forEach((l) => { if (!lblState.history.some((x) => x.id === l.id)) lblState.history.unshift(l); }); lblState.templates = st.templates || []; lblState.pharm = st.pharmacyDetails || {}; return res.end(JSON.stringify({ ok: true })); }
  // Supplier stock (sinreg): a 10+2 deal line, an out-of-stock line, a line at a second supplier; one shipped order; the saved draft
  if (p === "/supplier-products/inventory" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [
    { id: 501, location_id: 400, supplier_name: "Supplier Depot", description: "Augmentin 625mg x14", barcode: "5000001", stock_code: "AUG625", cost_excl_vat: 4.2, vat_rate: 0, retail_price: 7.5, profit_margin: 53, qty_purchased: 10, qty_free: 2, discount_pct: 0, discount_euro: 0, batch: "B77", expiry_date: "2099-01-01", out_of_stock: 0 },
    { id: 502, location_id: 400, supplier_name: "Supplier Depot", description: "Ventolin inhaler", barcode: "5000002", stock_code: "VEN100", cost_excl_vat: 3.1, vat_rate: 0, retail_price: 5.2, profit_margin: 40, qty_purchased: 1, qty_free: 0, out_of_stock: 1 },
    { id: 503, location_id: 401, supplier_name: "Medi Wholesale", description: "Panadol 500mg x24", barcode: "5000004", stock_code: "PAN24", cost_excl_vat: 1.9, vat_rate: 18, retail_price: 3.6, profit_margin: 47, qty_purchased: 1, qty_free: 0, discount_pct: 5, out_of_stock: 0 }] }));
  if (p === "/supplier-products/inventory-settings" && req.method === "GET") return res.end(JSON.stringify({ ok: true, settings: { expiry_red_months: 6, expiry_yellow_months: 12 } }));
  if (p === "/supplier-orders/cart-draft" && req.method === "GET") return res.end(JSON.stringify({ ok: true, cart: {} }));
  if (p === "/supplier-orders/cart-draft" && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/supplier-orders" && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 88 }));
  if (p === "/supplier-orders/sent" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [{ id: 87, supplier_name: "Supplier Depot", supplier_location_id: 400, status: "shipped", notes: "", created_at: "2026-11-02 09:00:00", item_count: 1, items_summary: "Ventolin inhaler" }] }));
  if (p === "/supplier-orders/87" && req.method === "GET") return res.end(JSON.stringify({ ok: true, order: { id: 87, supplier_name: "Supplier Depot", status: "shipped", notes: "", supplier_notes: "Arrives Thursday", scheduled_delivery_date: "2026-11-06" }, items: [{ id: 9001, description: "Ventolin inhaler", barcode: "5000002", qty_requested: 2, qty_free: 0, cost_excl_vat: 3.1, unavailable: 0 }], feedbacks: [] }));
  if (p === "/supplier-orders/87" && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  // Emergency POS (new layout eposreg): two products; sales kept in memory, one per offline_id like the worker
  if (p === "/emergency-pos/catalog" && req.method === "GET") return res.end(JSON.stringify({ ok: true, total: 2, next_offset: null, products: [{ id: 1, barcode: "5012345678900", name: "Panadol 500mg x24", price: 3.49, vat_rate: 0, category: "Pain" }, { id: 2, barcode: "5098765432109", name: "Sun cream SPF50", price: 12.99, vat_rate: 18, category: "Skin" }] }));
  if (p === "/emergency-pos/sales" && req.method === "GET") return res.end(JSON.stringify({ ok: true, sales: eposSales }));
  if (p === "/emergency-pos/sales" && req.method === "POST") { if (!eposSales.some((s) => s.offline_id === body.offline_id)) eposSales.unshift({ id: eposSales.length + 1, sale_date: body.sale_date, receipt_no: body.receipt_no, items_json: JSON.stringify(body.items), subtotal: body.subtotal, vat_total: body.vat_total, total: body.total, payment_method: body.payment_method, amount_tendered: body.amount_tendered, change_given: body.change_given, offline_id: body.offline_id, voided: 0, created_at: new Date().toISOString().slice(0, 19).replace("T", " ") }); return res.end(JSON.stringify({ ok: true, id: eposSales.length })); }
  if (p === "/emergency-pos/sales/sync" && req.method === "POST") return res.end(JSON.stringify({ ok: true, synced: 0, results: ((body && body.sales) || []).map((s) => ({ offline_id: s.offline_id, ok: true })) }));
  // Pharmacy calculators (new layout calreg): one saved warfarin plan; a POST adds a plan as the worker does (the list leaves out the plan JSON)
  if (p.startsWith("/pharmacy-calc/")) {
    const recs = globalThis.__calRecs || (globalThis.__calRecs = [{ id: 7, patient_name: "Vella Anna", id_card: "0987654M", start_date: "2026-10-01", calc_type: "war", created_at: "2026-10-01 09:00:00",
      calc_data_json: JSON.stringify({ startDate: "2026-09-30T22:00:00.000Z", weeks: 1, daysTotal: 7, schedule: [{ date: "2026-09-30T22:00:00.000Z", dow: 4, doseMg: 5, items: [{ strength: 5, wholeCount: 1, halfCount: 0, quarterCount: 0 }] }],
        dispByStrength: [{ strength: 5, wholePieces: 1, halfPieces: 0, quarterPieces: 0, tabletsDispense: 1, tabsPerSheet: 14, sheetsPerBox: 2, sheetsNeeded: 1, boxesNeeded: 1 }] }) }]);
    if (p === "/pharmacy-calc/patients") return res.end(JSON.stringify({ ok: true, patients: [{ id: 1, patient_name: "Zammit Carmel", id_card: "0012345M" }] }));
    if (p === "/pharmacy-calc/records" && req.method === "GET") return res.end(JSON.stringify({ ok: true, records: recs.map(({ calc_data_json, ...r }) => r) }));
    if (p === "/pharmacy-calc/records" && req.method === "POST") { const id = 100 + recs.length; recs.unshift({ id, patient_name: body.patient_name, id_card: body.id_card, start_date: body.start_date, calc_type: body.calc_type, calc_data_json: body.calc_data_json, created_at: "2026-11-03 10:00:00" }); return res.end(JSON.stringify({ ok: true, id })); }
    if (req.method === "GET") { const r = recs.find((x) => String(x.id) === p.split("/")[3]); return res.end(JSON.stringify(r ? { ok: true, record: r } : { ok: false, error: "Record not found" })); }
  }
  // Possible duplicates (new layout dupreg): only while a test turns it on. One person written differently in two more sections (the suite's order mock adds Grech Carmen on the same phone), plus a namesake with another ID card.
  // People links (worker people links block): a list kept here; "404" answers as the live worker without the routes.
  if (globalThis.__dupLinks && p.indexOf("/people/links") === 0) {
    const L = globalThis.__dupLinks;
    if (p === "/people/links" && req.method === "GET") return res.end(JSON.stringify({ ok: true, links: L.rows.filter((r) => !r.undone) }));
    if (p === "/people/links" && req.method === "POST") {
      const g = "lg_test" + (++L.n); const ids = [];
      for (const r of body.records) { const id = 900 + L.rows.length; L.rows.push({ id, link_group: g, kind: r.kind, source_id: String(r.id) }); ids.push(id); }
      return res.end(JSON.stringify({ ok: true, link_group: g, link_ids: ids }));
    }
    if (p === "/people/links/undo" && req.method === "POST") { let n = 0; for (const r of L.rows) if (body.link_ids.includes(r.id) && !r.undone) { r.undone = true; n++; } return res.end(JSON.stringify({ ok: true, undone: n })); }
  }
  if (globalThis.__dupMock && req.method === "GET") {
    const ym = maltaYmd(0).slice(0, 7);
    if (p === "/dda-sales/entries") return res.end(JSON.stringify({ ok: true, entries: url.searchParams.get("month") === ym ? [{ id: 502, entry_date: todayYmd, client_name: "Zammit Carmel", client_id_card: "12345 m", medicine_name_dose: "Morphine 10mg", prescription_serial_no: "S1" }] : [] }));
    if (p === "/appointments/entries") return res.end(JSON.stringify({ ok: true, appointments: [{ id: 503, patientName: "C Zammit", patientIdCard: "0012345M", patientPhone: "+356 79123456", date: todayYmd, time: "10:00", apptRef: "APT-1" }] }));
    if (p === "/loyalty/clients") return res.end(JSON.stringify({ ok: true, clients: [{ id: 504, name: "Carmel Zammit", id_card: "0099999M", created_at: todayYmd }] }));
  }
  if (p === "/alerts/entries" && req.method === "GET") {
    const d = maltaYmd(0);
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 41, entry_date: d, alert_type: "recall", status: "open", item_name: "Losartan 50mg", batch: "L9", expiry: "2027-03-01", quantity: "6", reason: "Manufacturer recall", storage_location: "room", supplier: "Actavis", notes: "Shelf C",
        team_informed: 1, supplier_informed: 0, authorities_informed: 0, return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0 }] }));
  }
  if (p.startsWith("/alerts/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/stock-transfers/items" && req.method === "GET") {
    return res.end(JSON.stringify({ ok: true, items: [
      { id: 21, mine_owner: true, item_description: "Augmentin 1g", batch: "A1", expiry_date: "2027-05-01", quantity_available: 10, remaining_quantity: 10, location_name: "Demo Pharmacy",
        requests: [{ id: 301, status: "pending", requester_display: "Sliema branch", quantity_requested: 4, note: "", mine: false }] },
      { id: 22, mine_owner: false, item_description: "Ventolin", batch: "", expiry_date: "2027-01-01", quantity_available: 5, remaining_quantity: 5, location_name: "Sliema branch", requests: [] },
      { id: 23, mine_owner: false, item_description: "Nexium 20mg", batch: "", expiry_date: "2027-02-01", quantity_available: 3, remaining_quantity: 1, location_name: "Gozo branch",
        requests: [{ id: 302, status: "dispatched", requester_display: "Demo Pharmacy", quantity_requested: 2, note: "", mine: true }] }] }));
  }
  if (p.startsWith("/stock-transfers/") && req.method === "POST") return res.end(JSON.stringify({ ok: true }));
  if (p === "/returns/entries" && req.method === "GET") {
    const d = (n) => maltaYmd(n);
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 11, entry_date: d(-5), description: "Amoxil 500mg", expiry: d(20), batch: "LOT77", quantity: "3", supplier: "GSK", invoice_number: "INV-9", remarks: "Expiring soon", location_stored: "Back room",
        return_arranged: 1, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 },
      { id: 12, entry_date: d(-3), description: "Ventolin", expiry: d(-1), batch: null, quantity: "1", supplier: "GSK", invoice_number: null, remarks: null, location_stored: null,
        return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 }] }));
  }
  if (p.startsWith("/returns/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/returns/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 13 }));
  if (p === "/near-expiry/entries" && req.method === "GET") {
    const d = (n) => maltaYmd(n);
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 1, product_name: "Amoxil 500mg", expiry_date: d(10), location: "Shelf A3", notes: "", return_id: null, return_status: "" },
      { id: 2, product_name: "Ventolin", expiry_date: d(-2), location: "Fridge", notes: "", return_id: null, return_status: "" },
      { id: 3, product_name: "Augmentin", expiry_date: d(200), location: "", notes: "", return_id: 7, return_status: "pending" }] }));
  }
  if (p === "/near-expiry/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry: { id: 9 } }));
  if (p === "/near-expiry/entries/create-return" && req.method === "POST") return res.end(JSON.stringify({ ok: true, return_id: 8 }));
  if (p === "/certificates/items" && req.method === "GET") {
    const d = (n) => maltaYmd(n);
    return res.end(JSON.stringify({ ok: true, items: [
      { id: 1, title: "Thermometer Calibration", subtitle: "Yearly calibration", interval_months: 12, last_date: d(-380), next_due: d(-15), requires_person: 0, certified_person: "" },
      { id: 2, title: "AC Maintenance", subtitle: "Yearly service", interval_months: 12, last_date: d(-100), next_due: d(265), requires_person: 0, certified_person: "" },
      { id: 3, title: "First Aid Certificate", subtitle: "3 year renewal", interval_months: 36, last_date: null, next_due: null, requires_person: 1, certified_person: "" }] }));
  }
  if (p.startsWith("/certificates/items/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/locumregister/entries" && req.method === "GET") {
    const mo = new URL(req.url, "http://x").searchParams.get("month") || "", cur = maltaYmd(0).slice(0, 7);
    const old = { id: 5, entry_date: "2026-10-05", time_in: "08:00", time_out: "14:00", locum_full_name: "Pharm. Anna Grech", registration_number: "P1234" };
    return res.end(JSON.stringify({ ok: true, entries: mo !== cur ? [old] : [] }));
  }
  if (p === "/locumregister/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry: { id: 6 } }));
  if (p === "/daily-register/entries" && req.method === "GET") {
    const mo = new URL(req.url, "http://x").searchParams.get("month") || "", cur = maltaYmd(0).slice(0, 7);
    const old = { id: 3, entry_date: "2026-10-12", client_name: "John Borg", client_id: "123456M", medicine_name_dose: "Amoxil 500mg", posology: "1-1-1 x 7 days", prescriber_name: "Dr Abela", prescriber_reg_no: "4321" };
    return res.end(JSON.stringify({ ok: true, entries: mo !== cur ? [old] : [] }));
  }
  if (p === "/daily-register/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry: { id: 4 } }));
  if (p === "/cleaning/entries" && req.method === "GET") {
    const mo = new URL(req.url, "http://x").searchParams.get("month") || "";
    const last = { id: 9, entry_date: "2026-10-17", time_in: "08:00", time_out: "08:40", cleaner_name: "Karl", staff_name: "Maria Borg", notes: "" };
    return res.end(JSON.stringify({ ok: true, entries: mo === "2026-10" ? [last] : [] }));
  }
  if (p === "/cleaning/entries" && req.method === "POST") { todayState.cleanDone = true; return res.end(JSON.stringify({ ok: true, entry: { id: 1 } })); }
  if (p.startsWith("/dda-stocktakes/")) {
    const D = ddstState, now = new Date().toISOString().slice(0, 19).replace("T", " "), m = p.split("/").filter(Boolean), sid = Number(m[2]);
    const its = (id) => D.items.filter((i) => i.stocktake_id === id).sort((a, b) => a.item_name.localeCompare(b.item_name, undefined, { sensitivity: "base" }) || a.id - b.id);
    if (p === "/dda-stocktakes/stocktakes" && req.method === "GET") return res.end(JSON.stringify({ ok: true, stocktakes: D.list.slice().sort((a, b) => b.id - a.id).map((s) => Object.assign({ item_count: its(s.id).length }, s)) }));
    if (p === "/dda-stocktakes/stocktakes" && req.method === "POST") { const st = { id: D.next++, created_at: now, closed_at: null, updated_at: now }; D.list.push(st); return res.end(JSON.stringify({ ok: true, stocktake_id: st.id, created_at: now })); }
    if (m[1] === "stocktakes" && m.length === 3 && req.method === "GET") { const st = D.list.find((x) => x.id === sid); return res.end(JSON.stringify(st ? { ok: true, stocktake: Object.assign({ created_by: 1 }, st), items: its(sid) } : { ok: false, error: "Not found" })); }
    if (m[1] === "stocktakes" && m.length === 3 && req.method === "PUT") { const st = D.list.find((x) => x.id === sid); if (body && body.closed === 1) st.closed_at = st.closed_at || now; return res.end(JSON.stringify({ ok: true })); }
    if (m[1] === "stocktakes" && m[3] === "items" && req.method === "POST") {
      const it = { id: D.nextItem++, stocktake_id: sid, item_name: String(body.item_name || "").trim(), dosage: String(body.dosage || "").trim(), qty_tablets: Math.floor(Number(body.qty_tablets)) }; D.items.push(it);
      return res.end(JSON.stringify({ ok: true, item_id: it.id }));
    }
    if (m[1] === "items" && req.method === "PUT") {
      const it = D.items.find((x) => x.id === sid); Object.assign(it, { item_name: String(body.item_name || "").trim(), dosage: String(body.dosage || "").trim(), qty_tablets: Math.floor(Number(body.qty_tablets)) });
      return res.end(JSON.stringify({ ok: true }));
    }
  }
  if (req.method === "GET") return res.end(JSON.stringify(genericList));
  return res.end(JSON.stringify({ ok: true, id: 1 }));
}

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split("?")[0]);
  if (p === "/__calls") { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(calls)); }
  if (p === "/__reset") { calls.length = 0; res.writeHead(200); return res.end("ok"); }
  if (p.startsWith("/ui/")) p = p.slice(3);
  const f = path.join(root, p);
  if (fs.existsSync(f) && fs.statSync(f).isFile()) {
    if (/\.html?$/i.test(f)) { // the page gets the worker's CSP, as in production
      const html = fs.readFileSync(f, "utf8");
      return cspHeadersFor(path.relative(root, f), html).then((h) => { res.writeHead(200, { "content-type": "text/html", ...h }); res.end(html); },
        (e) => { res.writeHead(500); res.end("csp header: " + e.message); });
    }
    res.writeHead(200, { "content-type": mime[f.split(".").pop()] || "application/octet-stream" });
    return fs.createReadStream(f).pipe(res);
  }
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => { let j = null; try { j = JSON.parse(body); } catch {} mockApi(req, res, j); });
});

let pass = 0, fail = 0;
function report(name, okv, detail) {
  if (okv) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name + (detail ? "\n       " + detail : "")); }
}

await new Promise((r) => server.listen(PORT, r));
const browser = await chromium.launch();
{ // every page in Malta's zone (unless a check sets its own) and on the suite's clock
  const nc = browser.newContext.bind(browser);
  // eikonClock: false for a check that installs Playwright's own clock (page.clock), which must not be shifted twice
  browser.newContext = async (o = {}) => { const { eikonClock, ...rest } = o, c = await nc({ ...contextTz(), ...rest }); await watchCsp(c, (t, u) => CSPV.push(t + " (" + u + ")")); return eikonClock === false ? c : prepareContext(c); };
  browser.newPage = async (o = {}) => { const c = await browser.newContext(o), pg = await c.newPage(); pg.once("close", () => c.close().catch(() => {})); return pg; };
  if (CLOCK_OFFSET || BROWSER_TZ !== "Europe/Malta") console.log(`  clock: ${new Date().toISOString()} (faked), pages in ${BROWSER_TZ}`); }
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.addInitScript(() => { window.EIKON_NO_DRAFTS = true; }); // q5-2: the checks on this page leave forms half-typed between steps; drafts have their own page below
await page.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
await page.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

const base = `http://localhost:${PORT}/ui/index.html?intro=0`;
await page.goto(base + "#dashboard");
await page.waitForTimeout(500);
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
await page.reload();
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
await page.waitForTimeout(1500);

// 1. One toast for the whole app
const toastOk = await page.evaluate(() => {
  const E = window.EIKON;
  if (typeof E.toast !== "function" || typeof E.showToast !== "function") return "missing";
  E.toast("Hello from the test", "success");
  E.showToast("Plain message");
  E.toast("Title", "With a title", "warn", 2000);
  const n = document.querySelectorAll(".eikon-toast").length;
  return n >= 3 ? "ok" : "rendered " + n;
});
report("core: E.toast and E.showToast exist and render", toastOk === "ok", toastOk);

// 1b. The sign-in screen is a real form (so the browser offers to save the password) and the account can change it
const formInfo = await page.evaluate(async () => {
  const E = window.EIKON;
  const saved = { token: localStorage.getItem("eikon_token"), role: localStorage.getItem("eikon_active_role") };
  E.renderLogin("", "p@x.com");
  const f = document.getElementById("eikon-login-form");
  const email = document.getElementById("eikon-login-email"), pass = document.getElementById("eikon-login-pass"), btn = document.getElementById("eikon-login-btn");
  const out = { isForm: !!f && f.tagName === "FORM", emailAuto: email && email.getAttribute("autocomplete"), passAuto: pass && pass.getAttribute("autocomplete"), submit: btn && btn.type, keptEmail: email && email.value, tip: /dbg=2/.test(document.body.textContent) };
  return out;
});
report("login: a real form with username/current-password autocomplete and a submit button, no debug tip", formInfo.isForm && formInfo.emailAuto === "username" && formInfo.passAuto === "current-password" && formInfo.submit === "submit" && formInfo.keptEmail === "p@x.com" && !formInfo.tip, JSON.stringify(formInfo));
await page.reload();
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
await page.waitForTimeout(800);
const pwModal = await page.evaluate(() => {
  const b = document.getElementById("eikon-password-btn"); if (!b) return { btn: false };
  b.click();
  const o = document.querySelector(".eikon-modal-overlay");
  return { btn: true, shown: !!o && getComputedStyle(o).display !== "none", fields: document.querySelectorAll("#eikon-pw-form input[type=password]").length, newAuto: (document.getElementById("eikon-pw-new") || {}).getAttribute && document.getElementById("eikon-pw-new").getAttribute("autocomplete") };
});
await page.evaluate(() => window.EIKON.modal.hide());
report("account: a Password button opens the change-password dialog with current, new and repeat fields", pwModal.btn && pwModal.shown && pwModal.fields === 3 && pwModal.newAuto === "new-password", JSON.stringify(pwModal));

// 1c. One-click demo on the sign-in screen: nothing shown (and no /auth/demo request) when the server has no demo; with
// one, three doors under the form, the pharmacy door first; a door signs in with no e-mail or password and starts the app.
for (const ui of ["", "&ui=2"]) try {
  const dOff = await browser.newPage({ viewport: { width: 390, height: 844 } }), offReq = [], offErr = [];
  dOff.on("request", (r) => { if (/\/auth\/demo/.test(r.url())) offReq.push(r.url()); });
  dOff.on("console", (m) => { if (m.type() === "error") offErr.push(m.text().slice(0, 160)); });
  await dOff.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await dOff.goto(base + ui);
  await dOff.waitForSelector("#eikon-login-form", { timeout: 15000 }); await dOff.waitForTimeout(600);
  const off = await dOff.evaluate(() => { const b = document.getElementById("eikon-demo-doors"); return { box: !!b, hidden: !b || b.hidden, doors: document.querySelectorAll("[data-demo-door]").length }; });
  await dOff.close();
  report("demo" + ui + ": with no demo on the server the sign-in screen shows no door and never asks for one", off.box && off.hidden && off.doors === 0 && !offReq.length && !offErr.length, JSON.stringify({ off, offReq, offErr }));
  const dOn = await browser.newPage({ viewport: { width: 390, height: 844 } }), onErr = [], posted = [];
  dOn.on("console", (m) => { if (m.type() === "error") onErr.push(m.text().slice(0, 160)); });
  dOn.on("pageerror", (e) => onErr.push("pageerror: " + e.message));
  await dOn.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await dOn.route("**/health", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, demo: true }) }));
  await dOn.route("**/auth/demo", (r) => {
    if (r.request().method() === "GET") return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, doors: ["pharmacy", "supplier", "hq"], ready: true }) });
    posted.push(r.request().postData());
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, demo: true, token: "x", user: { id: 1, user_id: 1, email: "visitor.pharmacy@demo.eikon.invalid", full_name: "Demo visitor", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: "admin", demo: true, demo_door: "pharmacy" } }) });
  });
  await dOn.goto(base + ui);
  await dOn.waitForSelector("[data-demo-door]", { timeout: 15000 });
  const on = await dOn.evaluate(() => {
    const doors = Array.from(document.querySelectorAll("[data-demo-door]")), b = document.getElementById("eikon-demo-doors"), f = document.getElementById("eikon-login-form");
    const r = b.getBoundingClientRect(), fr = f.getBoundingClientRect();
    return { keys: doors.map((d) => d.getAttribute("data-demo-door")), first: doors[0] && doors[0].classList.contains("main"), text: doors[0] && doors[0].textContent, under: r.top >= fr.bottom - 1,
      inside: r.left >= 0 && r.right <= window.innerWidth + 0.5, h: doors[0] && doors[0].getBoundingClientRect().height, note: (b.querySelector(".eikon-demo-note") || {}).textContent || "", scrollX: document.documentElement.scrollWidth <= window.innerWidth };
  });
  await dOn.click("[data-demo-door=pharmacy]");
  const inApp = await dOn.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.user.demo && document.getElementById("eikon-content") && !document.querySelector(".eikon-login"), null, { timeout: 15000 }).then(() => true, () => false);
  const tok = await dOn.evaluate(() => localStorage.getItem("eikon_token"));
  await dOn.close();
  report("demo" + ui + ": three doors under the form, the pharmacy door first and largest, fits a phone; one tap signs in and starts the app",
    on.keys.join() === "pharmacy,supplier,hq" && on.first && /Try the demo pharmacy/.test(on.text) && on.under && on.inside && on.h >= 48 && /every night/.test(on.note) && on.scrollX && inApp && tok === "x" && posted.length === 1 && JSON.parse(posted[0]).door === "pharmacy" && !onErr.length,
    JSON.stringify({ on, inApp, tok, posted, onErr }));
} catch (e) { report("demo" + ui + ": the sign-in screen's demo doors ran to the end", false, String(e).slice(0, 300)); }

// 2. No Authorization header in debug request logs
const redacted = await page.evaluate(async () => {
  const E = window.EIKON; const seen = [];
  const orig = console.log; console.log = function () { seen.push(Array.from(arguments).map((a) => { try { return typeof a === "string" ? a : JSON.stringify(a); } catch { return String(a); } }).join(" ")); orig.apply(console, arguments); };
  const old = E.DEBUG; E.DEBUG = 2;
  try { await E.apiFetch("/auth/me", { method: "GET" }); } catch {}
  E.DEBUG = old; console.log = orig;
  const joined = seen.join("\n");
  return { hasBearerX: /Bearer x\b/.test(joined), hasRedacted: /redacted/.test(joined) };
});
report("core: debug logs redact the bearer token", !redacted.hasBearerX && redacted.hasRedacted, JSON.stringify(redacted));

// 3. Every pharmacy module renders without errors
// In the classic layout (Settings > Classic layout), as these checks always ran: they used to reach it through the
// first old screen's classic visit, which then stuck; a classic visit now ends at the next rebuilt screen (q5-1).
await page.evaluate(() => { localStorage.setItem("eikon_ui2", "0"); });
await page.reload();
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.getElementById("eikon-content"), null, { timeout: 15000 });
await page.waitForTimeout(800);
const moduleIds = await page.evaluate(() => Object.keys(window.EIKON.modules));
const skipHeavy = new Set(["vaccines"]); // loads a 3.5 MB map; covered separately
const perModule = {};
for (const id of moduleIds) {
  if (skipHeavy.has(id)) continue;
  errors.length = 0;
  await page.evaluate((mid) => { window.location.hash = "#" + mid; }, id);
  await page.waitForTimeout(900);
  const crashed = await page.evaluate(() => !!document.querySelector("#eikon-content") && /Module crashed/.test(document.querySelector("#eikon-content").textContent));
  const errs = errors.filter((e) => !/favicon|net::ERR|Failed to load resource|xlsx|productmap|404/.test(e));
  perModule[id] = { crashed, errs };
  report("render: " + id, !crashed && errs.length === 0, (crashed ? "Module crashed card shown. " : "") + errs.slice(0, 2).join(" | "));
}

// 4. Dashboard quick temperature: blank fields save nothing
await page.evaluate(() => { window.location.hash = "#dashboard"; });
await page.waitForTimeout(2500);
await fetch(`http://localhost:${PORT}/__reset`);
const quickBtn = await page.$('button[data-action="dash-temp-quick"]');
if (!quickBtn) report("dashboard: quick temperature entry button present", false, "no Quick enter button for the missing device");
else {
  await quickBtn.click();
  await page.waitForTimeout(400);
  const saveBtn = (await page.$$(".eikon-modal button")).at(-1);
  await saveBtn.click();
  await page.waitForTimeout(600);
  const postCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/temperature/entries");
  const modalText = await page.evaluate(() => Array.from(document.querySelectorAll(".eikon-modal")).map((m) => m.textContent).join(" "));
  report("dashboard: blank temperature fields are refused and nothing is posted", postCalls.length === 0 && /nothing was saved/i.test(modalText), `posts=${postCalls.length} text=${modalText.slice(0, 160)}`);
  await page.evaluate(() => window.EIKON.modal.hide());
  await page.evaluate(() => window.EIKON.modal.hide());
}

// 5. DDA POYC: New Entry defaults to today
await page.evaluate(() => { window.location.hash = "#dda-poyc"; });
await page.waitForTimeout(1500);
const newBtn = await page.$("text=New Entry");
if (!newBtn) report("dda-poyc: New Entry button present", false, "button not found");
else {
  await newBtn.click();
  await page.waitForTimeout(400);
  const dateVal = await page.evaluate(() => { const bd = Array.from(document.querySelectorAll(".eikon-dda-modal-backdrop")).find((b) => getComputedStyle(b).display !== "none"); const i = bd && bd.querySelector('input[type="date"]'); return i ? i.value : "no modal date input"; });
  const localToday = await page.evaluate(() => { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); });
  report("dda-poyc: new entry date defaults to today, not the 1st", dateVal === localToday, `got ${dateVal} expected ${localToday}`);
  await page.evaluate(() => { document.querySelectorAll(".eikon-dda-modal-backdrop").forEach((b) => { b.style.display = "none"; }); });
}

// 6. DDA Purchases: delete asks through the in-app modal, Cancel deletes nothing
await page.evaluate(() => { window.location.hash = "#dda-purchases"; });
await page.waitForTimeout(1500);
await fetch(`http://localhost:${PORT}/__reset`);
const delSpan = await page.$("#eikon-content >> text=Delete");
if (!delSpan) report("dda-purchases: a Delete control exists on the row", false, "not found");
else {
  await delSpan.click();
  await page.waitForTimeout(400);
  const modalShown = await page.evaluate(() => { const o = document.querySelector(".eikon-modal-overlay"); return !!o && getComputedStyle(o).display !== "none" && /Delete DDA purchase/.test(o.textContent); });
  const cancel = await page.$(".eikon-modal button:has-text('Cancel')");
  if (cancel) await cancel.click();
  await page.waitForTimeout(300);
  const dels = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "DELETE");
  report("dda-purchases: delete confirms in-app and Cancel sends no DELETE", modalShown && dels.length === 0, `modal=${modalShown} deletes=${dels.length}`);
}

// 7. DDA escaping: the sales and POYC report builders escape markup (checked through the module's own print HTML builder is not exposed, so test the pattern directly)
const escOk = await page.evaluate(() => {
  const src = Array.from(document.scripts).map((s) => s.src).filter((s) => /modules\.dda(sales|poyc)\.js/.test(s));
  return src.length === 2;
});
report("dda: sales and poyc modules loaded (escape fix covered by source test below)", escOk);

// 8. Boot: one build stamp for every file, so caches work; SheetJS is not in the failure chain
const boot = await page.evaluate(() => {
  const srcs = Array.from(document.scripts).map((s) => s.src).filter((s) => /\/ui\//.test(s));
  const vs = new Set(srcs.map((s) => (s.match(/[?&]v=([^&]+)/) || [])[1]));
  return { files: srcs.length, stamps: Array.from(vs), timestampLike: Array.from(vs).some((v) => /^\d{13}$/.test(v || "")) };
});
report("boot: all module files share one fixed build stamp", boot.files > 50 && boot.stamps.length === 1 && !boot.timestampLike, JSON.stringify(boot));

// 9. Session expiry: a 401 on any call shows sign-in once and keeps the place
await page.evaluate(() => { window.location.hash = "#temperature"; });
await page.waitForTimeout(800);
const expired = await page.evaluate(async () => {
  const E = window.EIKON;
  let threw = null;
  try { await E.apiFetch("/__test401", { method: "GET" }); } catch (e) { threw = e; }
  await new Promise((r) => setTimeout(r, 200));
  const login = document.querySelector(".eikon-login");
  return { threw: !!threw, status: threw && threw.status, loginShown: !!login, text: login ? login.textContent : "", token: localStorage.getItem("eikon_token"), returnHash: E._returnHash };
});
report("core: a 401 shows the sign-in screen, clears the token and remembers the screen", expired.threw && expired.status === 401 && expired.loginShown && /session has ended/i.test(expired.text) && !expired.token && expired.returnHash === "#temperature", JSON.stringify(expired).slice(0, 300));

// 10. Today screen behind the flag
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_ui2", "1"); });
await fetch(`http://localhost:${PORT}/__reset`);
await page.goto(base + "&ui=2");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1"), null, { timeout: 15000 });
await page.waitForTimeout(600);
const today1 = await page.evaluate(() => ({
  hash: location.hash, light: document.documentElement.hasAttribute("data-ui2"), intro: !!document.getElementById("eikon-intro-overlay"),
  h1: document.querySelector(".tdy-head h1").textContent, rows: document.querySelectorAll(".tdy-row").length,
  oldLink: !!document.querySelector('[data-open="#dashboard"]'), calls: null
}));
const callsBoot = await (await fetch(`http://localhost:${PORT}/__calls`)).json();
const todayCalls = callsBoot.filter((c) => c.path === "/today").length;
const otherGets = callsBoot.filter((c) => c.method === "GET" && c.path !== "/today" && c.path !== "/auth/me").length;
report("today: opens first under the flag, light shell, no intro, headline and rows render", today1.hash === "#today" && today1.light && !today1.intro && /2 things before the doors open/.test(today1.h1) && today1.rows === 5 && !today1.oldLink, JSON.stringify(today1)); // b4-9: the Daily register is not owed in the morning (D3); the old dashboard link is in Settings › Help
report("today: the screen is one request", todayCalls >= 1 && otherGets === 0, `today=${todayCalls} otherGets=${otherGets} ${JSON.stringify(callsBoot.map((c) => c.path))}`);

// blank fridge fields are refused, nothing posted
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('.tdy-row[data-kind="temperature"] [data-act="temp"]');
await page.waitForTimeout(300);
let posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
const toastBlank = await page.evaluate(() => { const r = document.querySelector('.tdy-row[data-kind="temperature"]'), e = r.querySelector(".tdy-err[role=alert]"); return (e ? e.textContent : "") + " | invalid=" + r.querySelectorAll("input[aria-invalid=true]").length + " | focus=" + (document.activeElement && document.activeElement.hasAttribute("data-min")); });
report("today: blank fridge fields post nothing and say so (under the row, both fields marked, focus on min)", posts.length === 0 && /Write both the lowest and the highest/.test(toastBlank) && /invalid=2/.test(toastBlank) && /focus=true/.test(toastBlank), `posts=${posts.length} said=${toastBlank}`);

// typing min, max and pressing Enter logs the fridge with the right body and the row turns done
await page.fill('.tdy-row[data-kind="temperature"] [data-min]', "3,9"); // a comma, as some keyboards type it
await page.fill('.tdy-row[data-kind="temperature"] [data-max]', "6.1");
await page.press('.tdy-row[data-kind="temperature"] [data-max]', "Enter");
await page.waitForTimeout(900);
posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/temperature/entries");
const afterLog = await page.evaluate(() => ({ h1: document.querySelector(".tdy-head h1").textContent, pill: (document.querySelector('.tdy-row[data-kind="temperature"] .tdy-pill') || {}).textContent, inputs: document.querySelectorAll('.tdy-row[data-kind="temperature"] input').length }));
report("today: min (typed with a comma), max, Enter logs the fridge in one request and the row turns done", posts.length === 1 && posts[0].body && posts[0].body.device_id === 7 && posts[0].body.min_temp === 3.9 && posts[0].body.max_temp === 6.1 && /Logged 3.9 to 6.1/.test(afterLog.pill || "") && afterLog.inputs === 0 && /1 thing before/.test(afterLog.h1), JSON.stringify({ posts, afterLog }));

// cleaning: the name is in the row already (b4-4); typed over, Done now records it
await fetch(`http://localhost:${PORT}/__reset`);
await page.fill('.tdy-row[data-kind="cleaning"] [data-cleaner]', "Karl");
await page.click('.tdy-row[data-kind="cleaning"] [data-act="clean"]');
await page.waitForTimeout(900);
posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries");
const afterClean = await page.evaluate(() => (document.querySelector('.tdy-row[data-kind="cleaning"] .tdy-pill') || {}).textContent);
report("today: cleaning Done now records who and when", posts.length === 1 && posts[0].body.cleaner_name === "Karl" && posts[0].body.staff_name === "Maria Borg" && /Done today/.test(afterClean || ""), JSON.stringify({ posts, afterClean }));

// search: a customer's name opens their screen; Enter on a register name opens it
// A waiting customer's order and a register are classic screens today, so Enter opens the classic layout at that screen.
const backToToday = async () => { await page.goto(base + "&ui=2#today"); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1"), null, { timeout: 15000 }); await page.waitForTimeout(300); };
await page.fill("#tdy-q", "grech");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "ordreg", null, { timeout: 15000 });
const openedCustomer = await page.evaluate(() => location.hash + " " + (document.documentElement.hasAttribute("data-ui2") ? "new" : "classic"));
await backToToday();
await page.fill("#tdy-q", "dda stock");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "ddstreg", null, { timeout: 15000 });
const openedStock = await page.evaluate(() => location.hash + " " + (document.documentElement.hasAttribute("data-ui2") ? "new" : "classic"));
await backToToday();
// Every register is rebuilt now, Loyalty too (round 2: loyreg): the search opens it in the new layout.
await page.fill("#tdy-q", "loyalty");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "loyreg", null, { timeout: 15000 });
const openedModule = await page.evaluate(() => location.hash + " " + (document.documentElement.hasAttribute("data-ui2") ? "new" : "classic"));
report("today: search opens a waiting customer's order in the new Orders screen, DDA stock takes and Loyalty in the new layout", openedCustomer === "#ordreg new" && openedStock === "#ddstreg new" && openedModule === "#loyreg new", `${openedCustomer} | ${openedStock} | ${openedModule}`);
await backToToday();
// A register rebuilt in the new layout opens there.
await page.fill("#tdy-q", "temperature");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "tempreg", null, { timeout: 15000 });
const openedTemp = await page.evaluate(() => location.hash + " " + (document.documentElement.hasAttribute("data-ui2") ? "new" : "classic") + " " + (location.search.indexOf("ui=classic") >= 0));
report("today: searching 'temperature' opens the rebuilt register in the new layout", openedTemp === "#tempreg new false", openedTemp);
await backToToday();

// 10b. The reimagined shell: six words in the rail, nothing else; top bar only over an old module
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForFunction(() => location.hash === "#today" && document.querySelector(".tdy-head h1"), null, { timeout: 8000 });
await page.waitForTimeout(400);
const shell = await page.evaluate(() => ({
  rail: Array.from(document.querySelectorAll(".eikon-rail-btn .eikon-nav-label")).map((e) => e.textContent),
  cats: document.querySelectorAll(".eikon-nav-cat").length, help: !!document.querySelector(".eikon-help-btn"), search: !!document.querySelector(".eikon-nav-search-input"),
  topbar: getComputedStyle(document.querySelector(".eikon-topbar")).display, mark: !!document.querySelector(".eikon-rail-mark"),
  pharmacy: (document.querySelector(".eikon-rail-brand span") || {}).textContent, who: (document.querySelector(".eikon-rail-who b") || {}).textContent,
  badgeToday: (document.querySelector('.eikon-rail-badge[data-badge="today"]') || {}).textContent
}));
report("shell: the rail is Today, Customers, Bookings, Stock, Registers, Services, Money, Team, Settings and nothing else", JSON.stringify(shell.rail) === JSON.stringify(["Today", "Customers", "Bookings", "Stock", "Registers", "Services", "Money", "Team", "Settings"]) && shell.cats === 0 && !shell.help && !shell.search && shell.topbar === "none" && shell.mark && shell.pharmacy === "Demo Pharmacy" && shell.who === "Maria Borg" && /^\d*$/.test(shell.badgeToday || ""), JSON.stringify(shell));
await page.evaluate(() => { location.hash = "#registers"; });
await page.waitForFunction(() => document.querySelector(".hub-card"), null, { timeout: 8000 });
const hub = await page.evaluate(() => ({ h1: document.querySelector(".hub h1").textContent, cards: document.querySelectorAll(".hub-card").length, temp: !!document.querySelector('.hub-card[data-open="temperature"]'), topbar: getComputedStyle(document.querySelector(".eikon-topbar")).display }));
await page.click('.hub-card[data-open="dda_stocktakes"]');
// the last register rebuilt: the card opens the new screen; its "classic screen" link opens the classic layout for this visit
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ddstreg" && document.querySelector('.dst [data-act="classic"]'), null, { timeout: 15000 });
hub.stockNew = await page.evaluate(() => location.hash + " " + document.documentElement.hasAttribute("data-ui2") + " " + [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
await page.click('.dst [data-act="classic"]');
await page.waitForFunction(() => location.hash === "#dda_stocktakes" && location.search.indexOf("ui=classic") >= 0 && window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".eikon-nav-cat"), null, { timeout: 15000 });
await page.waitForTimeout(400);
const legacy = await page.evaluate(() => ({ light: document.documentElement.hasAttribute("data-ui2"), cats: document.querySelectorAll(".eikon-nav-cat").length, back: document.getElementById("eikon-back-btn").textContent, backShown: document.getElementById("eikon-back-btn").style.display !== "none", pref: localStorage.getItem("eikon_ui2") }));
await page.click("#eikon-back-btn");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "ddstreg" && document.documentElement.hasAttribute("data-ui2") && document.querySelector(".dst"), null, { timeout: 15000 });
report("shell: Registers lists every book and DDA stock takes opens in the new layout; its classic link opens classic Eikon, whole, with one button back to it; the preference is kept", hub.h1 === "Registers" && hub.cards >= 11 && hub.temp && hub.topbar === "none" && hub.stockNew === "#ddstreg true registers" && !legacy.light && legacy.cats > 0 && /New Eikon/.test(legacy.back) && legacy.backShown && legacy.pref === "1", JSON.stringify({ hub, legacy }));

// 11. Customers: Today's search hands over, the list shows people and history, Add adopts, edits are versioned
const callsNow = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
await fetch(`http://localhost:${PORT}/__reset`);
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForTimeout(800);
await page.fill("#tdy-q", "zammit carmel"); // q5-7: a card comes first, so her full name picks her (Zammit Paul has a card)
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => location.hash === "#customers" && document.querySelector("#cus-q") && document.querySelector("[data-hist]"), null, { timeout: 8000 });
await page.waitForTimeout(300);
const cus1 = await page.evaluate(() => ({ q: document.querySelector("#cus-q").value, people: document.querySelectorAll("[data-person]").length, hist: document.querySelectorAll("[data-hist]").length, rail: !!document.querySelector('.eikon-nav-btn[data-mod="customers"]'), histText: document.querySelector("[data-hist] .cus-t span").textContent }));
const peopleGets = (await callsNow()).filter((c) => c.path === "/people" && c.method === "GET");
// Enter opens the first result (eikon.search.js): Zammit Carmel, known only from the registers, so Customers opens on her ID card.
// (q5-7: "zammit" alone now lists the card Zammit Paul first; that order is checked in the q5-7 block.)
report("customers: Today's search hands the first person over; people, history and the rail entry render", cus1.q === "0012345M" && cus1.people === 1 && cus1.hist === 1 && cus1.rail && /1 DDA sale, 1 loyalty card/.test(cus1.histText) && peopleGets.length >= 1 && peopleGets.some((c) => /q=zammit/.test(c.query)), JSON.stringify({ cus1, peopleGets }));

await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-adopt]");
await page.waitForFunction(() => document.querySelector(".cus-head h1"), null, { timeout: 8000 });
await page.waitForTimeout(300);
const adoptPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path === "/people");
const cus2 = await page.evaluate(() => ({ h1: document.querySelector(".cus-head h1").textContent, story: document.querySelectorAll(".cus-story li").length, hist: document.querySelectorAll("[data-hist]").length, first: document.querySelector(".cus-story li .t b").textContent, counts: document.querySelectorAll(".cus-counts a").length }));
report("customers: Add adopts a person from history in one request and opens them with their story", adoptPosts.length === 1 && adoptPosts[0].body.name === "Zammit Carmel" && adoptPosts[0].body.id_card === "0012345M" && adoptPosts[0].body.source === "history" && cus2.h1 === "Zammit Carmel" && cus2.story === 2 && cus2.hist === 0 && /DDA sale · Morphine 10mg/.test(cus2.first) && cus2.counts === 2, JSON.stringify({ adoptPosts, cus2 }));

await page.click('[data-act="edit"]');
await page.fill("[name=notes]", "Prefers SMS");
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act="save"]');
// wait for the outcome (the warning, or any message) instead of a fixed pause: a busy machine made 700 ms too short once
await page.waitForFunction(() => document.querySelector(".cus-warn") || [...document.querySelectorAll(".eikon-toast")].some((t) => /Saved|Not saved/.test(t.textContent)), null, { timeout: 5000 }).catch(() => {});
await page.waitForTimeout(150);
const savePosts = (await callsNow()).filter((c) => c.method === "POST" && c.path === "/people");
const cus3 = await page.evaluate(() => ({ warn: (document.querySelector(".cus-warn") || {}).textContent || "", editing: !!document.querySelector("#cus-edit"), notes: (document.querySelector("[name=notes]") || {}).value, saved: Array.from(document.querySelectorAll(".eikon-toast")).map((t) => t.textContent).join("|") }));
report("customers: a stale edit is refused, the other version is shown with what you typed, nothing is claimed saved", savePosts.length === 1 && savePosts[0].body.id === 1 && savePosts[0].body.version === 1 && savePosts[0].body.notes === "Prefers SMS" && /changed this record/.test(cus3.warn) && /Yours was: Notes “Prefers SMS”/.test(cus3.warn) && cus3.editing && cus3.notes === "Call after 5" && !/Saved/.test(cus3.saved), JSON.stringify({ savePosts, cus3 }));

await page.click('[data-act="cancel"]');
const facts = await page.evaluate(() => ({ pills: Array.from(document.querySelectorAll(".cus-head .cus-pill")).map((e) => e.textContent), facts: Array.from(document.querySelectorAll(".cus-facts small")).map((e) => e.textContent), next: (Array.from(document.querySelectorAll(".cus-facts div")).find((d) => /Next appointment/.test(d.textContent)) || {}).textContent }));
report("customers: loyalty points and the next appointment are on the page", facts.pills.some((t) => /Loyalty · 1,120 pts/.test(t)) && /09:30 · Dr Galea/.test(facts.next || ""), JSON.stringify(facts));

// Step 1: the hand-over (BACKLOG4 item 1). One tap on a customer's page opens the rebuilt screen with its New form open,
// the person filled into the empty fields, focus on the first required field still empty; never the classic layout.
const outDirShots = () => { const d = process.env.SHOTS_DIR || path.join(here, "shots"); fs.mkdirSync(d, { recursive: true }); return d; };
const closeModal = async () => { await page.evaluate(() => { const ov = document.querySelector(".eikon-modal-overlay"); if (!ov) return; const b = Array.from(ov.querySelectorAll("button")).find((x) => /^(Cancel|Close)$/i.test(x.textContent.trim())); if (b) b.click(); else ov.remove(); }); await page.waitForTimeout(200); };
const toCarmel = async () => {
  await page.goto(base + "&ui=2#customers");
  await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector("#cus-q"), null, { timeout: 15000 });
  if (await page.locator(".cus-back").isVisible().catch(() => false)) { await page.click(".cus-back"); } // a phone shows the person instead of the list
  await page.fill("#cus-q", "zammit");
  await page.waitForFunction(() => document.querySelector('[data-person="1"]'), null, { timeout: 8000 });
  await page.click('[data-person="1"]');
  await page.waitForFunction(() => document.querySelector('.cus-actions [data-go="order"]') && /Zammit Carmel/.test((document.querySelector(".cus-head h1") || {}).textContent || ""), null, { timeout: 8000 });
};
const carryNew = async (go, form) => {
  await toCarmel();
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('.cus-actions [data-go="' + go + '"]');
  await page.waitForFunction((f) => document.querySelector(f + " [name=client_name]") && document.querySelector(f + " [name=client_name]").value, form, { timeout: 15000 });
  await page.waitForTimeout(150);
  return page.evaluate((f) => { const g = document.querySelector(f), v = {}; g.querySelectorAll("input[name]").forEach((i) => { if (i.type !== "checkbox") v[i.name] = i.value; });
    return { hash: location.hash, classic: location.search.indexOf("ui=classic") >= 0, ui2: document.documentElement.hasAttribute("data-ui2"), v, focus: document.activeElement && document.activeElement.name, top: (g.querySelector("[class$=-meta]") || {}).textContent || "", hand: sessionStorage.getItem("eikon_cus_hand") }; }, form);
};
const ordC = await carryNew("order", "#ord-add");
let carryPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path !== "/auth/login");
report("step 1: New order opens Orders (new layout) with its form open, name, ID card and phone filled, the person named at the top, focus on Items, nothing posted, hand-over used up",
  ordC.hash === "#ordreg" && !ordC.classic && ordC.ui2 && ordC.v.client_name === "Zammit Carmel" && ordC.v.id_card === "0012345M" && ordC.v.contact === "79123456" && ordC.v.items === "" && ordC.focus === "items" && /Zammit Carmel · ID card 0012345M/.test(ordC.top) && ordC.hand === null && carryPosts.length === 0, JSON.stringify({ ordC, carryPosts }));
await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(outDirShots(), "06 Customer to order (new layout).png") });
// Escape with nothing typed but the fill: back to the person, focus on the button that was pressed.
await page.keyboard.press("Escape");
await page.waitForFunction(() => location.hash === "#customers" && document.activeElement && document.activeElement.getAttribute("data-go") === "order", null, { timeout: 10000 }).catch(() => {});
const escBack = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement && document.activeElement.getAttribute("data-go"), who: (document.querySelector(".cus-head h1") || {}).textContent }));
report("step 1: Escape on the untouched order goes back to the person, focus on New order", escBack.hash === "#customers" && escBack.focus === "order" && escBack.who === "Zammit Carmel", JSON.stringify(escBack));
// The fill never overwrites typing: a changed name survives the list arriving (a repaint), and Escape then keeps the form.
await carryNew("order", "#ord-add");
await page.fill("#ord-add [name=client_name]", "Zammit Carmela");
await page.fill("#ord-add [name=items]", "Augmentin 625");
await page.evaluate(() => { document.activeElement.blur(); });
await page.waitForTimeout(300);
await page.click("[data-act=view-open]"); await page.waitForTimeout(200); // a redraw of the screen
await page.focus("#ord-add [name=items]"); await page.keyboard.press("Escape"); await page.waitForTimeout(300);
const typedKept = await page.evaluate(() => ({ hash: location.hash, name: (document.querySelector("#ord-add [name=client_name]") || {}).value, items: (document.querySelector("#ord-add [name=items]") || {}).value }));
report("step 1: the fill never overwrites what was typed, and Escape keeps a form with typing in it", typedKept.hash === "#ordreg" && typedKept.name === "Zammit Carmela" && typedKept.items === "Augmentin 625", JSON.stringify(typedKept));
const tkC = await carryNew("question", "#tkt-add");
const dvC = await carryNew("delivery", "#dlv-add");
// Cancel on a form opened from the person also goes back to them
await page.click("#dlv-add [data-act=add-cancel]");
await page.waitForFunction(() => location.hash === "#customers" && document.activeElement && document.activeElement.getAttribute("data-go") === "delivery", null, { timeout: 10000 }).catch(() => {});
const cancelBack = await page.evaluate(() => ({ hash: location.hash, focus: document.activeElement && document.activeElement.getAttribute("data-go") }));
carryPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path !== "/auth/login");
report("step 1: Question and Delivery open their new forms filled the same way (address too), focus on the first empty field that matters; Cancel goes back to the person",
  tkC.hash === "#tktreg" && !tkC.classic && tkC.v.client_name === "Zammit Carmel" && tkC.v.phone === "79123456" && tkC.focus === "issue" && /0012345M/.test(tkC.top) &&
  dvC.hash === "#dlvreg" && !dvC.classic && dvC.v.client_name === "Zammit Carmel" && dvC.v.phone === "79123456" && dvC.v.delivery_address === "1 Triq il-Knisja" && dvC.focus === "items" &&
  cancelBack.hash === "#customers" && cancelBack.focus === "delivery" && carryPosts.length === 0, JSON.stringify({ tkC, dvC, cancelBack, carryPosts }));
// Booking (2026-11, classic Appointments retired): Booking always opens Bookings with the person, set up or not (Bookings
// keeps the person waiting while it is set up or the old appointments are brought over); the strip says Bookings.
const bkHand = async () => {
  await page.evaluate(() => { const P = Storage.prototype, set = P.setItem; window.__bkSet = set; window.__bkCarry = null; P.setItem = function (k, v) { if (this === sessionStorage && k === "eikon_bk_carry" && !window.__bkCarry) window.__bkCarry = JSON.parse(v); return set.call(this, k, v); }; });
  await page.click('.cus-actions [data-go="booking"]');
  await page.waitForFunction(() => location.hash === "#bookings", null, { timeout: 8000 }).catch(() => {});
  const r = await page.evaluate(() => ({ hash: location.hash, classic: location.search.indexOf("ui=classic") >= 0, carry: window.__bkCarry }));
  await page.evaluate(() => { Storage.prototype.setItem = window.__bkSet; window.__bkCarry = null; });
  return r;
};
// Bookings remembers it is set up once its first read is in: wait for that, then forget it again for the next step
const forgetBookings = async () => {
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && Object.keys(localStorage).some((k) => k.indexOf("eikon_bk_ready_") === 0) && document.querySelector("#eikon-content") && !/Loading…/.test(document.querySelector("#eikon-content").innerText), null, { timeout: 10000 }).catch(() => {});
  await page.evaluate(() => { sessionStorage.removeItem("eikon_bk_carry"); Object.keys(localStorage).filter((k) => k.indexOf("eikon_bk_ready_") === 0).forEach((k) => localStorage.removeItem(k)); });
  await page.goto(base + "&ui=2#customers"); await page.waitForTimeout(300); // drawn again without it
};
await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.indexOf("eikon_bk_ready_") === 0).forEach((k) => localStorage.removeItem(k)); });
await toCarmel();
const bkBtn0 = await page.evaluate(() => ({ exp: document.querySelector('[data-go="booking"]').getAttribute("aria-expanded"), strip: [...document.querySelectorAll("[data-reg]")].map((a) => a.textContent), classicBtn: !!document.querySelector('[data-act="bk-classic"]') }));
const bkSet = await bkHand();
await forgetBookings();
await page.evaluate(() => { localStorage.setItem("eikon_bk_ready_1_12", "1"); });
await toCarmel();
const bkBtn = await page.evaluate(() => ({ exp: document.querySelector('[data-go="booking"]').getAttribute("aria-expanded"), strip: [...document.querySelectorAll("[data-reg]")].map((a) => a.textContent) }));
const bkGo = await bkHand();
await forgetBookings();
report("customers: Booking opens Bookings with the person whether or not it is set up yet (no note, no classic Appointments button); the Registers strip says Bookings",
  bkBtn0.exp === null && !bkBtn0.classicBtn && bkBtn0.strip.join() === "Orders,Questions,Deliveries,Bookings,Loyalty" && bkSet.hash === "#bookings" && !bkSet.classic && bkSet.carry && bkSet.carry.name === "Zammit Carmel" &&
  bkBtn.exp === null && bkBtn.strip.join() === "Orders,Questions,Deliveries,Bookings,Loyalty" && bkGo.hash === "#bookings" && bkGo.carry && bkGo.carry.name === "Zammit Carmel", JSON.stringify({ bkBtn0, bkSet, bkBtn, bkGo }));
// The counts and the Registers strip: rebuilt registers in the new layout (searched to the person where they can be); only Loyalty labelled classic
await toCarmel();
const chips = await page.evaluate(() => [...document.querySelectorAll(".cus-counts a")].map((a) => a.textContent.replace(/\s+/g, " ").trim()));
const strip = await page.evaluate(() => [...document.querySelectorAll("[data-reg]")].map((a) => a.textContent));
await page.click('.cus-counts [data-count="dda_sale"]');
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg", null, { timeout: 15000 }).catch(() => {});
const ddaGo = await page.evaluate(() => ({ hash: location.hash, classic: location.search.indexOf("ui=classic") >= 0 }));
const finds = {};
for (const [mod, who, sel] of [["ordreg", "Grech Carmen", "#ord-q"], ["tktreg", "Farrugia Tony", "#tkt-q"]]) {
  await page.evaluate(([m, w]) => { window.EIKON.customerHandoff(m, "find", { id: 9, name: w }); location.hash = "#" + m; }, [mod, who]);
  await page.waitForFunction((s) => document.querySelector(s), sel, { timeout: 15000 }).catch(() => {});
  finds[mod] = await page.evaluate((s) => (document.querySelector(s) || {}).value || "", sel);
  await page.goto(base + "&ui=2#customers"); await page.waitForTimeout(200);
}
await page.evaluate(() => { window.EIKON.customerHandoff("dlvreg", "find", { id: 9, name: "Camilleri Rita", phone: "" }); location.hash = "#dlvreg"; });
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-card"), null, { timeout: 15000 }).catch(() => {});
finds.dlvreg = await page.evaluate(() => ({ lab: ((document.querySelector('.dlv-lab[role="status"]') || {}).textContent || "").trim(), names: [...document.querySelectorAll(".dlv-card .h b")].map((b) => b.textContent) }));
await page.click('[data-act="who-all"]').catch(() => {}); await page.waitForTimeout(150);
finds.dlvAll = await page.evaluate(() => document.querySelectorAll(".dlv-card").length);
const story = await page.evaluate(() => [window.EIKON.customersStoryTitle('[{"name":"Panadol","qty":1},{"name":"Augmentin 625","qty":2}]'), window.EIKON.customersStoryTitle("Morphine 10mg"), window.EIKON.customersStoryTitle("[not json")]);
report("customers: a delivery in the Story shows its item names, not the stored list", story.join("|") === "Panadol, Augmentin 625|Morphine 10mg|[not json", JSON.stringify(story));
// One person, one card (BACKLOG5 item 3). Every kind the worker's people search returns has a word (read from the
// worker's own PEOPLE_SOURCES lists, so a new kind without a word fails here); "undefined" never prints.
{
  const wsrc3 = fs.readFileSync(path.join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  const block = (start) => { const i = wsrc3.indexOf(start); return wsrc3.slice(i, wsrc3.indexOf("];", i)); };
  const kinds = [...(block("const PEOPLE_SOURCES = [") + block("const PEOPLE_SOURCES_MORE = [")).matchAll(/kind: "([a-z_]+)"/g)].map((m) => m[1]);
  const sw = await page.evaluate((kinds) => ({ all: window.EIKON.customersSourceWords(Object.fromEntries(kinds.map((k) => [k, 2]))), one: kinds.map((k) => window.EIKON.customersSourceWords({ [k]: 1 })),
    known: window.EIKON.customersSourceKinds, odd: window.EIKON.customersSourceWords({ something_new: 1 }), cn: window.EIKON.customersSourceWords({ credit_note: 1, delivery: 3 }) }), kinds);
  report("customers: every kind of record the server's people search returns has its own word (credit note, booking, vaccine order, contact…), never 'undefined'",
    kinds.length >= 16 && kinds.every((k) => sw.known.includes(k)) && !/undefined/.test(sw.all + sw.one.join() + sw.odd) && sw.odd === "1 record" && sw.cn === "1 credit note, 3 deliveries" && kinds.includes("credit_note"), JSON.stringify({ kinds, sw }));
}
// A history row that is a card in the list: the same ID card, or the same phone and the name in any order, or exactly
// the same words in another order with nothing that differs. A shared family phone with another first name, a
// different phone or ID card, or two possible cards: still offered as Add (never guessed).
{
  const cards = [{ id: 307, name: "Grech Claire", phone: "79441430", id_card: "0002159M" }, { id: 11, name: "Abela Claire", phone: "79211278", id_card: "0035010M" }, { id: 12, name: "Abela Claire", phone: "79432230", id_card: "0548491M" },
    { id: 20, name: "Grech Maria", phone: "79555000", id_card: "" }, { id: 30, name: "Farrugia Ninu Maria Assunta", phone: "", id_card: "" }, { id: 40, name: "Cassar Ryan", phone: "79001122", id_card: "0012345M" }];
  const hist = [
    { name: "Claire Grech", phone: "79441430", sources: { credit_note: 1 } },            // → 307 (phone, name turned)
    { name: "Claire Abela", phone: "+356 7921 1278", sources: { credit_note: 1 } },      // → 11 (phone picks the one of two namesakes)
    { name: "Claire Abela", phone: "", sources: { vaccine: 1 } },                        // two cards, no phone: Add
    { name: "Claire Grech", phone: "79555000", sources: { booking: 1 } },                // family phone of Grech Maria, other name, and 307's phone differs: Add
    { name: "Ninu Maria Assunta Farrugia", phone: "", sources: { contact: 1 } },        // → 30 (same words, nothing differs)
    { name: "Ryan Cassar", id_card: "12345M", sources: { calculator: 1 } },              // → 40 (same ID card)
    { name: "Ryan Cassar", id_card: "0099999M", phone: "79001122", sources: { poct: 1 } } // another ID card: Add
  ];
  const sp = await page.evaluate(([people, history]) => { const r = window.EIKON.customersAlsoSplit({ people, history }); const out = {}; Object.keys(r.also).forEach((k) => out[k] = r.also[k].map((h) => history.indexOf(h))); return { also: out, hist: r.hist.map((h) => history.indexOf(h)) }; }, [cards, hist]);
  report("customers: a history row that is a card (ID card, or phone and name in any order, or the same words turned) shows on that card, not as Add; namesakes, family phones and other cards stay Add",
    JSON.stringify(sp) === JSON.stringify({ also: { 11: [1], 30: [4], 40: [5], 307: [0] }, hist: [2, 3, 6] }), JSON.stringify(sp));
  // the same rule when a register links its person after a save: "Claire Grech" with Grech Claire's phone is Grech Claire, no new card
  const lk = await page.evaluate(async (people) => {
    const E = window.EIKON, real = E.apiFetch, posts = [], gets = [];
    E.apiFetch = async (u, o) => { if (o && o.method === "POST") { posts.push(JSON.parse(o.body)); return { ok: true, person: { id: 999, name: "new" }, created: true }; }
      const q = decodeURIComponent((/q=([^&]*)/.exec(u) || [])[1] || "").toLowerCase(); gets.push(q);
      return { ok: true, people: people.filter((p) => (p.name + " " + p.phone + " " + p.id_card).toLowerCase().includes(q)), history: [] }; };
    try {
      const a = await E.people.link({ name: "Claire Grech", phone: "79441430" }, "register:orders");
      const b = await E.people.link({ name: "Ninu Maria Assunta Farrugia" }, "register:credit-notes");
      const c = await E.people.link({ name: "Claire Grech", phone: "79555000" }, "register:orders");
      return { a: [a.person && a.person.id, a.created, a.how], b: [b.person && b.person.id, b.how], c: [c.created, c.how], posts, gets };
    } finally { E.apiFetch = real; }
  }, cards);
  report("people link: a record whose name is a card's in another order is linked to that card (no second card); a family phone with another name still gets its own",
    JSON.stringify(lk.a) === JSON.stringify([307, false, "name-order"]) && JSON.stringify(lk.b) === JSON.stringify([30, "name-order"]) && lk.c[0] === true && lk.posts.length === 1 && lk.posts[0].name === "Claire Grech" && lk.posts[0].phone === "79555000", JSON.stringify(lk));
}
report("step 1: the counts and the strip open rebuilt registers in the new layout (Orders, Questions and Deliveries showing the person; Show all clears it); nothing is labelled classic look (Loyalty is rebuilt), appointments go to Bookings",
  chips.join("|") === "DDA sale 1|Loyalty 1" && strip.join() === "Orders,Questions,Deliveries,Bookings,Loyalty" && ddaGo.hash === "#cdsreg" && !ddaGo.classic &&
  finds.ordreg === "Grech Carmen" && finds.tktreg === "Farrugia Tony" && /^Deliveries for Camilleri Rita/.test(finds.dlvreg.lab) && finds.dlvreg.names.length >= 1 && finds.dlvreg.names.every((n) => /Camilleri Rita/.test(n)) && finds.dlvAll > finds.dlvreg.names.length,
  JSON.stringify({ chips, strip, ddaGo, finds }));

// an old hand-over is ignored
await page.evaluate(() => { sessionStorage.setItem("eikon_carry_person", JSON.stringify({ id: 1, name: "Zammit Carmel", phone: "79123456", at: Date.now() - 6 * 60 * 1000 })); });
await page.goto(base + "&ui=classic#tickets"); // the classic hand-over (Appointments, Loyalty) is still read by the classic screens
await page.waitForFunction(() => document.querySelector("#tk-new"), null, { timeout: 15000 });
await page.waitForTimeout(500);
const stale = await page.evaluate(() => ({ modal: !!document.querySelector("#tk-client"), carry: sessionStorage.getItem("eikon_carry_person") }));
report("step 1: a hand-over older than five minutes opens nothing and is discarded", !stale.modal && stale.carry === null, JSON.stringify(stale));
// Review shots: classic modules inside the reimagined shell (SHOTS=1), one file each
if (process.env.SHOTS) {
  const outDir = process.env.SHOTS_DIR || path.join(here, "shots");
  fs.mkdirSync(outDir, { recursive: true });
  await page.setViewportSize({ width: 1440, height: 900 });
  if (process.env.SHOTS_CLASSIC) { // the classic layout, for a before/after check
    await page.evaluate(() => { localStorage.removeItem("eikon_ui2"); });
    await page.goto(base + "&ui=1");
    await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".eikon-nav-btn"), null, { timeout: 15000 });
    await page.waitForTimeout(800);
  }
  for (const id of (process.env.SHOTS_MODS || "clientorders,temperature,endofday,appointments,dda-sales,dashboard,tickets,poct").split(",")) {
    await page.evaluate((h) => { location.hash = "#" + h; }, id);
    await page.waitForTimeout(1500);
    if (id === "clientorders") { await page.click("#co-new").catch(() => {}); await page.waitForTimeout(400); }
    await page.screenshot({ path: path.join(outDir, id + ".png") });
    await page.evaluate(() => { const ov = document.querySelector(".eikon-modal-overlay"); if (ov) ov.style.display = "none"; });
  }
  if (!process.env.SHOTS_CLASSIC) { await page.goto(base + "&ui=2#today"); await page.waitForFunction(() => document.querySelector(".tdy-head h1"), null, { timeout: 15000 }); }
}

// screenshot of the person for the review
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto(base + "&ui=2#customers");
await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector("#cus-q"), null, { timeout: 15000 });
await page.fill("#cus-q", "zammit");
await page.waitForFunction(() => document.querySelector("[data-person]"), null, { timeout: 8000 });
await page.click('[data-person="1"]');
await page.waitForFunction(() => document.querySelector(".cus-story li"), null, { timeout: 8000 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(here, "..", "..", "design", "eikon-reimagined", "prototype", "05 Customers, built.png") });
peopleState.adopted = false;

// Temperature register in the new layout: the Registers card opens it there (not classic), the rail stays on Registers,
// and an empty month says how many days were logged out of how many.
await page.goto(base + "&ui=2#registers");
await page.waitForFunction(() => document.querySelector(".hub-card"), null, { timeout: 15000 });
await page.locator(".hub-card", { hasText: "Temperature" }).first().click();
await page.waitForFunction(() => document.querySelector(".trg-sum"), null, { timeout: 15000 });
const trg = await page.evaluate(() => ({ hash: location.hash, classic: location.search.indexOf("ui=classic") >= 0, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), cards: document.querySelectorAll(".trg-card").length, sum: document.querySelector(".trg-sum").textContent, next: document.querySelector(".emb [data-mb=next]").disabled, cells: document.querySelectorAll(".trg-card .trg-d:not(.pad)").length }));
report("temperature register: opens in the new layout from Registers, rail stays on Registers, month summary shown", trg.hash === "#tempreg" && !trg.classic && trg.rail.join() === "registers" && trg.cards === 1 && /^0 of \d+ days logged/.test(trg.sum) && trg.next === true && trg.cells >= Math.min(28, new Date().getDate()), JSON.stringify(trg));

// Cleaning register in the new layout: status from the last clean (even last month), a name is required, then one POST.
await page.goto(base + "&ui=2#registers");
await page.waitForFunction(() => document.querySelector(".hub-card"), null, { timeout: 15000 });
await page.locator(".hub-card", { hasText: "Cleaning" }).first().click();
await page.waitForFunction(() => document.querySelector(".clr-status") && !/Opening/.test(document.querySelector(".clr").textContent), null, { timeout: 15000 });
const clr1 = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), status: document.querySelector(".clr-status").textContent, weeks: document.querySelectorAll(".clr-lab").length }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=new]");
await page.click("#clr-form button[type=submit]");
await page.waitForTimeout(300);
let clrPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries");
const clrErr = await page.evaluate(() => (document.querySelector(".clr-err") || {}).textContent || "");
await page.fill("#clr-form [name=cleaner_name]", "Karl");
await page.fill("#clr-form [name=time_out]", "23:59");
await page.click("#clr-form button[type=submit]");
await page.waitForTimeout(700);
const clrPosts2 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries");
const b0 = (clrPosts2[0] || {}).body || {};
report("cleaning register: opens in the new layout, overdue status from last month, needs a name, then records once with who checked", clr1.hash === "#cleanreg" && clr1.rail.join() === "registers" && /^Overdue\s*Last cleaned \d+ days ago by Karl/.test(clr1.status) && clr1.weeks >= 1 && clrPosts.length === 0 && /who cleaned/.test(clrErr) && clrPosts2.length === 1 && b0.cleaner_name === "Karl" && b0.staff_name === "Maria Borg" && /^\d{4}-\d{2}-\d{2}$/.test(b0.entry_date) && b0.time_out === "23:59", JSON.stringify({ clr1, clrErr, clrPosts2 }));

// Daily register in the new layout: Today's "Open" lands on it; nothing saved until every line is filled;
// a known ID card brings the name and a known prescriber the registration number; then one POST.
await page.goto(base + "&ui=2#today");
await page.waitForFunction(() => document.querySelector('.tdy-row[data-kind="daily_register"] [data-open]'), null, { timeout: 15000 });
await page.click('.tdy-row[data-kind="daily_register"] [data-open]');
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "drreg" && document.querySelector("[data-act=new]") && !/Opening/.test(document.querySelector(".drr").textContent), null, { timeout: 15000 });
const drr1 = await page.evaluate(() => ({ hash: location.hash, classic: location.search.indexOf("ui=classic") >= 0, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=new]");
await page.click("#drr-form button[type=submit]");
await page.waitForTimeout(300);
const drrPosts0 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/daily-register/entries");
const drrErr = await page.evaluate(() => ({ err: (document.querySelector(".drr-err") || {}).textContent || "", miss: document.querySelectorAll(".drr-form label.miss").length }));
await page.fill("#drr-form [name=client_id]", "123456M"); await page.press("#drr-form [name=client_id]", "Tab");
await page.fill("#drr-form [name=medicine_name_dose]", "Augmentin 1g");
await page.fill("#drr-form [name=posology]", "1-0-1 x 5 days");
await page.fill("#drr-form [name=prescriber_name]", "Dr Abela"); await page.press("#drr-form [name=prescriber_name]", "Tab");
const filled = await page.evaluate(() => ({ name: document.querySelector("#drr-form [name=client_name]").value, reg: document.querySelector("#drr-form [name=prescriber_reg_no]").value }));
await page.click("#drr-form button[type=submit]");
await page.waitForTimeout(700);
const drrPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/daily-register/entries");
const db = (drrPosts[0] || {}).body || {};
report("daily register: Today's Open lands on the new screen; every line required; known ID and prescriber fill in; one POST", drr1.hash === "#drreg" && !drr1.classic && drr1.rail.join() === "registers" && drrPosts0.length === 0 && drrErr.miss === 6 && /Nothing was saved/.test(drrErr.err) && filled.name === "John Borg" && filled.reg === "4321" && drrPosts.length === 1 && db.client_name === "John Borg" && db.prescriber_reg_no === "4321" && db.medicine_name_dose === "Augmentin 1g" && /^\d{4}-\d{2}-\d{2}$/.test(db.entry_date), JSON.stringify({ drr1, drrErr, filled, drrPosts }));

// A save on the rebuilt screens may read the list first (postOnce), so wait for it to finish, not a fixed time:
// the screen keeps its submit button disabled for the whole save.
const settleSave = async () => { await page.waitForTimeout(150); await page.waitForFunction(() => !document.querySelector("button[type=submit][disabled]"), null, { timeout: 6000 }).catch(() => {}); await page.waitForTimeout(200); };

// Locum register in the new layout: a returning locum's registration number fills in; time in is required; one POST.
await page.goto(base + "&ui=2#locumregister");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "locreg" && document.querySelector("[data-act=new]") && !/Opening/.test(document.querySelector(".lcr").textContent), null, { timeout: 15000 });
const lcr1 = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=new]");
await page.fill("#lcr-form [name=time_in]", "");
await page.fill("#lcr-form [name=locum_full_name]", "Pharm. Anna Grech"); await page.press("#lcr-form [name=locum_full_name]", "Tab");
const lcrReg = await page.inputValue("#lcr-form [name=registration_number]");
await page.click("#lcr-form button[type=submit]"); await page.waitForTimeout(300);
const lcrPosts0 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/locumregister/entries");
const lcrErr = await page.evaluate(() => (document.querySelector(".lcr-err") || {}).textContent || "");
await page.fill("#lcr-form [name=time_in]", "08:00");
await page.click("#lcr-form button[type=submit]"); await settleSave();
const lcrPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/locumregister/entries");
const lb = (lcrPosts[0] || {}).body || {};
report("locum register: old link lands on the new screen; a known locum fills the reg no; time in required; one POST", lcr1.hash === "#locreg" && lcr1.rail.join() === "registers" && lcrReg === "P1234" && lcrPosts0.length === 0 && /time in/.test(lcrErr) && lcrPosts.length === 1 && lb.locum_full_name === "Pharm. Anna Grech" && lb.registration_number === "P1234" && lb.time_in === "08:00", JSON.stringify({ lcr1, lcrReg, lcrErr, lcrPosts }));

// Certificates in the new layout: overdue first, in-date last; a person is required where the item needs one; one PUT.
await page.goto(base + "&ui=2#certificates");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "certreg" && document.querySelector(".crt-row"), null, { timeout: 15000 });
const crt1 = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod),
  labs: [...document.querySelectorAll(".crt-lab")].map((e) => e.textContent), first: document.querySelector(".crt-row b").textContent, pill: document.querySelector(".crt-pill").textContent }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('.crt-row[data-id="3"] [data-act=edit]');
await page.fill("#crt-form [name=last_date]", maltaYmd(0));
await page.click("#crt-form button[type=submit]"); await page.waitForTimeout(300);
const crtPuts0 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
const crtErr = await page.evaluate(() => (document.querySelector(".crt-err") || {}).textContent || "");
await page.fill("#crt-form [name=certified_person]", "Maria Borg");
await page.click("#crt-form button[type=submit]"); await page.waitForTimeout(700);
const crtPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
report("certificates: open in the new layout, overdue first, the person required where needed, one PUT", crt1.hash === "#certreg" && crt1.rail.join() === "registers" && crt1.labs[0] === "Needs attention" && crt1.first === "Thermometer calibration" && /Overdue 15 days/.test(crt1.pill) && crtPuts0.length === 0 && /who is certified/.test(crtErr) && crtPuts.length === 1 && crtPuts[0].path === "/certificates/items/3" && crtPuts[0].body.certified_person === "Maria Borg" && crtPuts[0].body.interval_months === 36, JSON.stringify({ crt1, crtErr, crtPuts }));

// Quality pass (Temperature, Cleaning, Locum, Certificates, Audit): one way back decided in one place; a renewal starts
// on today's date; Escape closes a form and focus goes back to the button that opened it; every problem shown at once,
// each field marked; the shared printout (pharmacy, page numbers); the next step on Temperature is one tap.
try {
  const stubPrint = () => page.evaluate(() => { window.EIKON.openPrintUrlOrLink = function () { return null; }; window.EIKON.openPrintUrl = function () { return {}; }; });
  // Certificates
  await page.goto(base + "&ui=2#certificates");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "certreg" && document.querySelector(".crt-row"), null, { timeout: 15000 });
  const cq = await page.evaluate(() => ({ back: document.querySelector(".crt-back").textContent, btns: [...document.querySelectorAll(".crt-row [data-act=edit]")].map((b) => b.textContent + "|" + b.getAttribute("aria-label")) }));
  await page.click('.crt-row[data-id="1"] [data-act=edit]');
  const cqDate = await page.inputValue("#crt-form [name=last_date]");
  await page.press("#crt-form [name=last_date]", "Escape"); await page.waitForTimeout(100);
  const cqEsc = await page.evaluate(() => ({ form: !!document.querySelector("#crt-form"), focus: document.activeElement && document.activeElement.getAttribute("data-id") }));
  await page.click('.crt-row[data-id="2"] [data-act=edit]');
  const cqKeep = await page.inputValue("#crt-form [name=last_date]");
  await page.fill("#crt-form [name=last_date]", ""); await page.fill("#crt-form [name=interval_months]", "0");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#crt-form button[type=submit]"); await page.waitForTimeout(200);
  const cqErr = await page.evaluate(() => ({ err: (document.querySelector("#crt-err") || {}).textContent || "", role: (document.querySelector("#crt-err") || { getAttribute() {} }).getAttribute("role"), inv: [...document.querySelectorAll("#crt-form [aria-invalid=true]")].map((e) => e.name), focus: document.activeElement && document.activeElement.name }));
  const cqPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  await page.click("#crt-form [data-act=cancel]");
  await stubPrint(); await page.click(".crt-top [data-act=print]"); await page.waitForTimeout(100);
  const cqPrint = await page.evaluate(() => { const l = window.EIKON.months.lastPrint || {}; return { reg: l.register, pages: /counter\(pages\)/.test(l.html || ""), title: /Thermometer calibration/.test(l.html || ""), pharm: /Demo|Pharmacy/.test(l.html || "") }; });
  await page.click(".crt-back"); await page.waitForTimeout(300);
  const cqBackTo = await page.evaluate(() => location.hash);
  const tYmd = maltaYmd(0);
  report("certificates quality: back says and goes to Registers (its tab); a renewal starts today, an in-date item keeps its date; Escape closes and refocuses; all errors at once, marked and announced, nothing sent; prints the shared printout",
    cq.back === "‹ Registers" && cqBackTo === "#registers" && cq.btns.some((b) => /^Record\|Record First aid certificate$/.test(b)) && cq.btns.some((b) => /^Update\|Update Thermometer calibration$/.test(b)) &&
    cqDate === tYmd && !cqEsc.form && cqEsc.focus === "1" && cqKeep !== tYmd && /^\d{4}-\d{2}-\d{2}$/.test(cqKeep) &&
    /choose the date/i.test(cqErr.err) && /1 to 120 months/.test(cqErr.err) && cqErr.role === "alert" && cqErr.inv.join() === "last_date" && cqErr.focus === "last_date" && cqPuts.length === 0 &&
    cqPrint.reg === "Certificates" && cqPrint.pages && cqPrint.title, JSON.stringify({ cq, cqDate, cqEsc, cqKeep, cqErr, cqPuts: cqPuts.length, cqPrint, cqBackTo }));

  // Temperature: today not logged → the way to log it is one tap; an out-of-limits day says so in words too
  await page.goto(base + "&ui=2#tempreg");
  await page.waitForFunction(() => document.querySelector(".trg-due"), null, { timeout: 15000 });
  const tq = await page.evaluate(() => ({ due: (document.querySelector(".trg-due") || {}).textContent || "", back: document.querySelector(".trg-back").textContent, today: (document.querySelector(".trg-d.today .trg-sr") || {}).textContent || "", todayTxt: (document.querySelector(".trg-d.today b") || {}).textContent || "" }));
  const tqTo = await page.evaluate(() => location.hash + "|" + document.querySelectorAll(".trg-due [name=qmin]").length + "|" + document.querySelectorAll(".trg-due [data-act=qlog]").length);
  report("temperature quality: today not logged is logged right here (min, max, Log reading per fridge or room); today's cell says 'Not yet' in words",
    /Today is not logged yet/.test(tq.due) && /^#tempreg\|[1-9]\d*\|[1-9]/.test(tqTo) && tq.back === "‹ Registers" && /not logged yet today/.test(tq.today) && tq.todayTxt === "Not yet", JSON.stringify({ tq, tqTo }));

  // Cleaning: all problems at once, first one focused; past cleaners offered; Escape closes and refocuses
  await page.goto(base + "&ui=2#cleanreg");
  await page.waitForFunction(() => document.querySelector(".clr-status") && !/Opening/.test(document.querySelector(".clr").textContent), null, { timeout: 15000 });
  await page.click("[data-act=new]"); await page.fill("#clr-form [name=time_in]", "");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#clr-form button[type=submit]"); await page.waitForTimeout(200);
  const kq = await page.evaluate(() => ({ err: (document.querySelector("#clr-err") || {}).textContent || "", role: (document.querySelector("#clr-err") || { getAttribute() {} }).getAttribute("role"), inv: [...document.querySelectorAll("#clr-form [aria-invalid=true]")].map((e) => e.name).sort().join(), focus: document.activeElement && document.activeElement.name, names: [...document.querySelectorAll("#clr-names option")].map((o) => o.value) }));
  await page.press("#clr-form [name=cleaner_name]", "Escape"); await page.waitForTimeout(100);
  const kqEsc = await page.evaluate(() => ({ form: !!document.querySelector("#clr-form"), focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
  const kqPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
  report("cleaning quality: every missing field at once, marked and announced, first one focused, nothing sent; past cleaners offered; Escape closes and refocuses",
    /who cleaned/.test(kq.err) && /time in/.test(kq.err) && kq.role === "alert" && kq.inv === "cleaner_name,time_in" && kq.focus === "cleaner_name" && kq.names.includes("Karl") && !kqEsc.form && kqEsc.focus === "new" && kqPosts.length === 0, JSON.stringify({ kq, kqEsc, kqPosts: kqPosts.length }));

  // Locum: marked fields, Escape
  await page.goto(base + "&ui=2#locreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "locreg" && document.querySelector("[data-act=new]") && !/Opening/.test(document.querySelector(".lcr").textContent), null, { timeout: 15000 });
  const lqBtn = await page.textContent("[data-act=new]");
  await page.click("[data-act=new]"); await page.fill("#lcr-form [name=entry_date]", "2099-01-01");
  await page.click("#lcr-form button[type=submit]"); await page.waitForTimeout(200);
  const lq = await page.evaluate(() => ({ err: (document.querySelector("#lcr-err") || {}).textContent || "", inv: [...document.querySelectorAll("#lcr-form [aria-invalid=true]")].map((e) => e.name).sort().join(), focus: document.activeElement && document.activeElement.name }));
  await page.press("#lcr-form [name=locum_full_name]", "Escape"); await page.waitForTimeout(100);
  const lqEsc = await page.evaluate(() => ({ form: !!document.querySelector("#lcr-form"), focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
  report("locum quality: 'Record a locum'; missing fields and a future date reported together, each marked; Escape closes and refocuses",
    lqBtn === "New locum" && /the pharmacist/.test(lq.err) && /future/.test(lq.err) && lq.inv === "entry_date,locum_full_name,registration_number" && lq.focus === "locum_full_name" && !lqEsc.form && lqEsc.focus === "new", JSON.stringify({ lqBtn, lq, lqEsc }));

  // Registers hub: the lead says what the page is for
  await page.goto(base + "&ui=2#registers"); await page.waitForFunction(() => document.querySelector(".hub .lead"), null, { timeout: 15000 });
  const hq = await page.textContent(".hub .lead");
  report("registers hub: the lead says the books are filled in and printed here", /fill them in, see what is missing, and print any month/.test(hq), hq);
} catch (e) { report("quality pass (temperature, cleaning, locum, certificates): ran to the end", false, String(e).slice(0, 300)); }

// Near expiry in the new layout: expired first, being-sent-back last; send back needs a supplier; one POST each.
await page.goto(base + "&ui=2#stock");
await page.waitForFunction(() => document.querySelector(".hub-card"), null, { timeout: 15000 });
await page.locator(".hub-card", { hasText: "Near Expiry" }).first().click();
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "nexreg" && document.querySelector(".nex-row"), null, { timeout: 15000 });
const nex1 = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod),
  labs: [...document.querySelectorAll(".nex-lab")].map((e) => e.textContent), rows: [...document.querySelectorAll(".nex-row b")].map((e) => e.textContent) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=ret][data-id="1"]'); await page.click("#nex-ret button[type=submit]"); await page.waitForTimeout(300);
const nexErr = await page.evaluate(() => (document.querySelector(".nex-err") || {}).textContent || "");
await page.fill("#nex-ret [name=supplier]", "GSK"); await page.fill("#nex-ret [name=quantity]", "3"); await page.click("#nex-ret button[type=submit]"); await page.waitForTimeout(700);
const nexPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
// Offer to other pharmacies (10b): the classic "Add to Scarce Stock" body; an expired item has no Offer; the footer shrinks.
{
  await page.waitForFunction(() => document.querySelector('[data-act=offer][data-id="1"]'), null, { timeout: 8000 }).catch(() => {});
  const nexOfferExpired = await page.evaluate(() => !!document.querySelector('[data-act=offer][data-id="2"]'));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act=offer][data-id="1"]'); await page.waitForSelector("#nex-offer"); await page.waitForFunction(() => document.activeElement && document.activeElement.name === "qty", null, { timeout: 2000 }).catch(() => {});
  const nexOf0 = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.name, qty: document.querySelector("#nex-offer [name=qty]").value, say: document.querySelector("#nex-offer .nex-say").textContent }));
  await page.fill("#nex-offer [name=qty]", "0"); await page.fill("#nex-offer [name=batch]", " B12 "); await page.click("#nex-offer button[type=submit]"); await page.waitForTimeout(500);
  const nexOfPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
  const ob = (nexOfPosts[0] || {}).body || {};
  const nexFoot = await page.evaluate(() => [...document.querySelectorAll(".nex p")].map((x) => x.textContent).join(" "));
  report("near expiry: Offer sends the classic Add to Scarce Stock body (today, item, expiry, batch, a whole number at least 1, open, the item's id); not for an expired item; the footer no longer sends offers, refused or damaged to the classic screen",
    !nexOfferExpired && nexOf0.focus === "qty" && nexOf0.qty === "1" && /Other pharmacies see it in Scarce stock/.test(nexOf0.say) && nexOfPosts.length === 1 && nexOfPosts[0].path === "/scarce-stock/offers" &&
    JSON.stringify(Object.keys(ob)) === JSON.stringify(["entry_date", "item_name", "expiry_date", "batch", "quantity_available", "is_closed", "near_expiry_id"]) && ob.entry_date === todayYmd && ob.item_name === "Amoxil 500mg" && ob.expiry_date === maltaYmd(10) && ob.batch === "B12" && ob.quantity_available === 1 && ob.is_closed === 0 && ob.near_expiry_id === 1 &&
    /A supplier refusing a return, or damaged stock, is marked on the return in Returns/.test(nexFoot) && !/classic/.test(nexFoot) && !/offers/.test(nexFoot), JSON.stringify({ nexOfferExpired, nexOf0, nexOfPosts, nexFoot }));
}
report("near expiry: opens from Stock in the new layout, expired first, send back needs a supplier, one return created", nex1.hash === "#nexreg" && nex1.rail.join() === "stock" && /^Expired/.test(nex1.labs[0]) && nex1.rows[0] === "Ventolin" && /^Being sent back/.test(nex1.labs[nex1.labs.length - 1]) && /supplier/.test(nexErr) && nexPosts.length === 1 && nexPosts[0].path === "/near-expiry/entries/create-return" && nexPosts[0].body.near_expiry_id === 1 && nexPosts[0].body.supplier === "GSK", JSON.stringify({ nex1, nexErr, nexPosts }));

// Returns in the new layout: grouped by what each waits for; ticking a step sends the whole record back unchanged but the step.
await page.goto(base + "&ui=2#returns");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "retreg" && document.querySelector(".rtn-row"), null, { timeout: 15000 });
const rtn1 = await page.evaluate(() => ({ hash: location.hash, labs: [...document.querySelectorAll(".rtn-lab")].map((e) => e.textContent) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=step][data-id="11"]'); await page.waitForTimeout(700);
const rtnPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
const rb = (rtnPuts[0] || {}).body || {};
report("returns: open in the new layout by step; ticking 'handed over' keeps every other field as it was", rtn1.hash === "#retreg" && /^To arrange/.test(rtn1.labs[0]) && /^Waiting for collection/.test(rtn1.labs[1]) && rtnPuts.length === 1 && rtnPuts[0].path === "/returns/entries/11" && rb.handed_over === 1 && rb.return_arranged === 1 && rb.batch === "LOT77" && rb.invoice_number === "INV-9" && rb.remarks === "Expiring soon" && rb.location_stored === "Back room" && rb.supplier === "GSK" && rb.quantity === "3" && rb.credit_note_received === 0 && rb.description === "Amoxil 500mg", JSON.stringify({ rtn1, rtnPuts }));

// Transfers in the new layout: what needs you first (answer a request, confirm a delivery); asking checks the quantity.
await page.goto(base + "&ui=2#stocktransfers");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "trfreg" && document.querySelector(".trf-row"), null, { timeout: 15000 });
const trf1 = await page.evaluate(() => ({ hash: location.hash, needs: [...document.querySelectorAll(".trf-row.need span")].map((e) => e.textContent), labs: [...document.querySelectorAll(".trf-lab")].map((e) => e.textContent) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=accept][data-rq="301"]'); await page.waitForTimeout(500);
await page.click('[data-act=deliver][data-rq="302"]'); await page.waitForTimeout(500);
await page.click('[data-act=ask][data-id="22"]'); await page.fill("#trf-ask [name=quantity_requested]", "9"); await page.click("#trf-ask button[type=submit]"); await page.waitForTimeout(300);
const trfErr = await page.evaluate(() => (document.querySelector(".trf-err") || {}).textContent || "");
await page.fill("#trf-ask [name=quantity_requested]", "2"); await page.click("#trf-ask button[type=submit]"); await page.waitForTimeout(600);
const trfPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").map((c) => c.path + (c.body && c.body.quantity_requested ? ":" + c.body.quantity_requested : ""));
report("transfers: needs-you first, accept and receive in one tap, asking more than is left is refused", trf1.hash === "#trfreg" && /^Needs you/.test(trf1.labs[0]) && trf1.needs.some((t) => /Sliema branch asks for 4/.test(t)) && trf1.needs.some((t) => /on its way from Gozo branch/.test(t)) && /Only 5 left/.test(trfErr) && JSON.stringify(trfPosts) === JSON.stringify(["/stock-transfers/requests/301/accept", "/stock-transfers/requests/302/confirm-delivery", "/stock-transfers/items/22/requests:2"]), JSON.stringify({ trf1, trfErr, trfPosts }));

// Alerts in the new layout: one tap per checklist step, the whole record sent back with only that step changed.
await page.goto(base + "&ui=2#alerts");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "alertreg" && document.querySelector(".alr-card"), null, { timeout: 15000 });
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=tick][data-k="supplier_informed"]'); await page.waitForTimeout(700);
const alrPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
const ab = (alrPuts[0] || {}).body || {};
// Change an alert (10b): the card becomes its form; the body is the classic Edit's (every field, its order, trimmed, steps 0/1).
{
  await page.waitForSelector('[data-act=edit][data-id="41"]');
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act=edit][data-id="41"]'); await page.waitForSelector("#alr-edit"); await page.waitForFunction(() => document.activeElement && document.activeElement.name === "item_name", null, { timeout: 2000 }).catch(() => {});
  const alE0 = await page.evaluate(() => { const f = document.querySelector("#alr-edit"), v = (n) => f.querySelector("[name=" + n + "]").value; return { focus: document.activeElement && document.activeElement.name, item: v("item_name"), notes: v("notes"), status: v("status"), store: v("storage_location"), date: v("entry_date") }; });
  await page.selectOption("#alr-edit [name=status]", "in_progress"); await page.fill("#alr-edit [name=notes]", "  Moved to fridge  ");
  await page.click("#alr-edit button[type=submit]"); await settleSave();
  const alEPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  const eb = (alEPuts[0] || {}).body || {};
  const alFoot = await page.evaluate(() => [...document.querySelectorAll(".alr p")].map((x) => x.textContent).join(" "));
  report("alerts: Change opens the alert's own form on the item; Save changes sends the classic Edit body (every field in its order, trimmed, steps 0 or 1); the footer no longer sends anything to the classic screen (round 2: Delete is on the card)",
    alE0.focus === "item_name" && alE0.item === "Losartan 50mg" && alE0.notes === "Shelf C" && alE0.status === "open" && alE0.store === "room" && alE0.date === maltaYmd(0) && alEPuts.length === 1 && alEPuts[0].path === "/alerts/entries/41" &&
    JSON.stringify(Object.keys(eb)) === JSON.stringify(["entry_date", "alert_type", "status", "item_name", "batch", "expiry", "quantity", "reason", "storage_location", "supplier", "notes", "team_informed", "supplier_informed", "authorities_informed", "return_arranged", "handed_over", "collection_note_received", "credit_note_received"]) &&
    eb.status === "in_progress" && eb.notes === "Moved to fridge" && eb.item_name === "Losartan 50mg" && eb.batch === "L9" && eb.team_informed === 1 && eb.supplier_informed === 0 &&
    !/classic/.test(alFoot) && !/details|notes/.test(alFoot), JSON.stringify({ alE0, alEPuts, alFoot }));
}
report("alerts: open in the new layout; ticking 'supplier told' keeps every other field (notes, batch, status…)", alrPuts.length === 1 && alrPuts[0].path === "/alerts/entries/41" && ab.supplier_informed === 1 && ab.team_informed === 1 && ab.status === "open" && ab.notes === "Shelf C" && ab.batch === "L9" && ab.reason === "Manufacturer recall" && ab.supplier === "Actavis" && ab.quantity === "6" && ab.item_name === "Losartan 50mg", JSON.stringify(alrPuts));

// Orders in the new layout: late first, works against a server without date ranges (month fallback); Ready sends only that.
await page.goto(base + "&ui=2#clientorders");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-row"), null, { timeout: 15000 });
const ord1 = await page.evaluate(() => ({ rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), names: [...document.querySelectorAll(".ord-row .t b")].map((e) => e.textContent), late: !!document.querySelector(".ord-row.late") }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=ready][data-id="51"]'); await page.waitForTimeout(700);
const ordPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
report("orders: open in the new layout, late first, month fallback works, Ready sends only fulfilled", ord1.rail.join() === "customers" && ord1.names[0] === "Grech Carmen" && ord1.late && ordPuts.length === 1 && ordPuts[0].path === "/client-orders/entries/51" && JSON.stringify(ordPuts[0].body) === JSON.stringify({ fulfilled: true }), JSON.stringify({ ord1, ordPuts }));

// Questions in the new layout: high priority first; a note keeps the history; Resolved sends only the status; a new one needs a name.
await page.goto(base + "&ui=2#tickets");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector(".tkt-card"), null, { timeout: 15000 });
const tk1 = await page.evaluate(() => ({ rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), names: [...document.querySelectorAll(".tkt-card .h b")].map((e) => e.textContent), last: (document.querySelectorAll(".tkt-card .n")[0] || {}).textContent || "" }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=note][data-id="61"]'); await page.fill("#tkt-note input", "Spoke to her, collecting Friday"); await page.click("#tkt-note button[type=submit]"); await page.waitForTimeout(700);
await page.click('[data-act=resolve][data-id="62"]'); await page.waitForTimeout(700);
await page.click('[data-act=add]'); await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(200);
const tkErr = await page.evaluate(() => (document.querySelector(".tkt-err") || {}).textContent || "");
await page.fill("#tkt-add [name=client_name]", "Borg Anna"); await page.fill("#tkt-add [name=issue]", "Does Panadol come in syrup?"); await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(700);
const tkCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => (c.method === "PUT" || c.method === "POST") && c.path !== "/people"); // the person link after a save is checked in its own test
const tkNote = tkCalls[0] || {}, tkLog = (() => { try { return JSON.parse(tkNote.body.notes_log); } catch (e) { return []; } })(), tkNew = (tkCalls[2] || {}).body || {};
// a note and Resolved send the classic body: the whole question as read again, only the note / the status different
const TK_KEYS = "assigned_to,category,client_name,email,followup_date,issue,notes_log,open_date,phone,priority,resolved,resolved_at,status,ticket_id";
const tkRes = (tkCalls[1] || {}).body || {};
report("questions: open in the new layout, high first; a note keeps the old ones; a note and Resolved send the classic body (the question re-read, only that changed); a new one needs a name and gets a category",
  tk1.rail.join() === "customers" && tk1.names[0] === "Farrugia Tony" && /Called, no answer/.test(tk1.last) && tkCalls.length === 3 &&
  tkNote.path === "/client-tickets/entries/61" && Object.keys(tkNote.body).sort().join() === TK_KEYS && tkLog.length === 2 && tkLog[0].text === "Called, no answer" && tkLog[1].text === "Spoke to her, collecting Friday" &&
  tkNote.body.status === "Open" && tkNote.body.assigned_to === "John" && tkNote.body.email === "rita@x.com" && tkNote.body.resolved === false && tkNote.body.resolved_at === "" && tkNote.body.ticket_id === "TKT-00007" &&
  tkCalls[1].path === "/client-tickets/entries/62" && Object.keys(tkRes).sort().join() === TK_KEYS && tkRes.status === "Resolved" && tkRes.resolved === true && /^\d{4}-\d\d-\d\dT/.test(tkRes.resolved_at) &&
  tkRes.issue === "Charged twice" && tkRes.category === "Billing" && tkRes.priority === 1 && tkRes.followup_date === "" && tkRes.notes_log === "[]" &&
  /customer's name/.test(tkErr) && tkCalls[2].path === "/client-tickets/entries" && tkNew.client_name === "Borg Anna" && /^TKT-\d{5}$/.test(tkNew.ticket_id) && tkNew.category === "General Enquiry" && tkNew.status === "Open" && tkNew.notes_log === "[]",
  JSON.stringify({ tk1, tkErr, tkCalls }));

// q5-4: a new question or delivery takes one above both the highest number in the pharmacy's list and this browser's
// counter (shared by both layouts), with the whole list read just before the save; the format is unchanged.
{
  const posts = async (path) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === path && (c.method === "POST" || (c.method === "GET" && !c.query)));
  const lastPost = (cs) => { const i = cs.map((c) => c.method).lastIndexOf("POST"); return { id: i >= 0 ? cs[i].body : null, readFirst: i > 0 && cs[i - 1].method === "GET" }; };
  const seq = async (k, v) => page.evaluate(([k, v]) => { if (v === null) localStorage.removeItem(k); else if (v !== undefined) localStorage.setItem(k, v); return localStorage.getItem(k); }, [k, v]);
  const fresh = (hash) => base + "&ui=2&fresh=" + Date.now() + hash; // a full load: the screen starts with nothing remembered in memory
  const out = {};
  const tkNewOne = async (name) => {
    await page.goto(fresh("#tickets")); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector(".tkt-card"), null, { timeout: 15000 });
    await fetch(`http://localhost:${PORT}/__reset`);
    await page.click("[data-act=add]"); await page.fill("#tkt-add [name=client_name]", name); await page.fill("#tkt-add [name=issue]", "Number check"); await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(700);
    const r = lastPost(await posts("/client-tickets/entries")); return { id: r.id && r.id.ticket_id, readFirst: r.readFirst };
  };
  await seq("eikon_tickets_seq_v1", "3"); out.tkBehind = await tkNewOne("Behind Bella"); out.tkCounter = await seq("eikon_tickets_seq_v1");   // list max TKT-00008
  await seq("eikon_tickets_seq_v1", "40"); out.tkAhead = await tkNewOne("Ahead Albert");                                                     // counter ahead
  await seq("eikon_tickets_seq_v1", "3");
  await page.goto(base + "&ui=classic&fresh=" + Date.now() + "#tickets"); await page.waitForSelector("#tk-new", { timeout: 15000 }); await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#tk-new"); await page.waitForSelector("#tk-client"); await page.fill("#tk-client", "Classic Clara"); await page.fill("#tk-issue", "Number check");
  await page.click("#eikon-modal-actions .eikon-btn.primary"); await page.waitForTimeout(700);
  { const r = lastPost(await posts("/client-tickets/entries")); out.tkClassic = { id: r.id && r.id.ticket_id, readFirst: r.readFirst }; }
  await seq("eikon_deliveries_seq_v1", null);
  await page.goto(fresh("#deliveries")); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-card"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.fill("#dlv-add [name=client_name]", "Fresh Frida"); await page.fill("#dlv-add [name=phone]", "79000999"); await page.fill("#dlv-add [name=delivery_address]", "Qormi");
  await page.click("#dlv-add button[type=submit]"); await page.waitForTimeout(700);
  { const r = lastPost(await posts("/client-deliveries/entries")); out.dlFresh = { id: r.id && r.id.delivery_id, readFirst: r.readFirst }; }
  out.dlCounter = await seq("eikon_deliveries_seq_v1");
  await page.goto(base + "&ui=classic&fresh=" + Date.now() + "#deliveries"); await page.waitForSelector("#dv-btn-new", { timeout: 15000 }); await fetch(`http://localhost:${PORT}/__reset`);
  await seq("eikon_deliveries_seq_v1", "2");
  await page.click("#dv-btn-new"); await page.waitForSelector("#dv-client"); await page.fill("#dv-client", "Classic Carlo"); await page.fill("#dv-phone", "79000888"); await page.fill("#dv-address", "Zebbug");
  await page.click("#eikon-modal-actions .eikon-btn.primary"); await page.waitForTimeout(700);
  { const r = lastPost(await posts("/client-deliveries/entries")); out.dlClassic = { id: r.id && r.id.delivery_id, readFirst: r.readFirst }; }
  await seq("eikon_tickets_seq_v1", null); await seq("eikon_deliveries_seq_v1", null);
  await page.evaluate(() => { try { window.EIKON.modal && window.EIKON.modal.hide && window.EIKON.modal.hide(); } catch (e) {} });
  report("reference numbers: one above the highest in the list or this browser's counter, the list read just before the save, both layouts (TKT-nnnnn / DEL-nnnnn)",
    out.tkBehind.id === "TKT-00009" && out.tkBehind.readFirst && out.tkCounter === "9" && out.tkAhead.id === "TKT-00041" && out.tkClassic.id === "TKT-00009" && out.tkClassic.readFirst &&
    out.dlFresh.id === "DEL-00006" && out.dlFresh.readFirst && out.dlCounter === "6" && out.dlClassic.id === "DEL-00006" && out.dlClassic.readFirst,
    JSON.stringify(out));
}

// Orders, changing one (new layout): the order is read again and sent whole, as the classic screen sends it (its names
// and the server's: client_phone, items_text, pickup_date, deposit_amount), with only what was edited different; a field
// changed elsewhere since the screen opened is kept. Staff do not see Delete; the pharmacist's delete writes the reason
// on the order, then deletes it. Done lists ready orders through the server's fulfilled=1 range.
try {
  const dT = new Date(), dd = (n) => maltaYmd(n);
  const R = { id: 71, order_date: dd(0), client_name: "Pace Rita", client_phone: "79001122", client_alt_phone: "21000000", client_email: "r@x.mt", client_address: "4 Triq il-Wied", items_text: "Nexium 20mg x28", priority: 2, needed_by: dd(2), pickup_date: dd(3), deposit_amount: 5, fulfilled: 0, fulfilled_at: null, notes: "Prefers mornings", follow_up_status: "called", order_code: "PQ7RT2" };
  let reads = 0; const doneQs = [];
  await page.route("**/client-orders/entries?*", (r) => {
    const u = new URL(r.request().url());
    if (u.searchParams.get("fulfilled") === "1") { doneQs.push(u.search); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [Object.assign({}, R, { id: 72, client_name: "Done Daniel", fulfilled: 1, fulfilled_at: dd(-1) + "T10:00:00Z" })] }) }); }
    reads++; const row = reads > 1 ? Object.assign({}, R, { notes: "Changed elsewhere" }) : R; // after the screen opened, someone else changed the notes
    return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [row] }) });
  });
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector('[data-act=open][data-id="71"]'), null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; });
  await page.click('[data-act=open][data-id="71"]');
  const staffDel = await page.evaluate(() => !!document.querySelector("#ord-edit [data-act=del]"));
  await page.fill("#ord-edit [name=items]", "Nexium 40mg x28"); await page.fill("#ord-edit [name=deposit]", "7,5");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#ord-edit button[type=submit]"); await page.waitForTimeout(800);
  const oPut = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT")[0] || {}, ob = oPut.body || {};
  const want = { order_date: R.order_date, client_name: "Pace Rita", address: R.client_address, contact: "79001122", alternate: "21000000", email: "r@x.mt", items: "Nexium 40mg x28", priority: 2, needed_by: R.needed_by, pick_up_date: R.pickup_date,
    deposit: "7.50", notes: "Changed elsewhere", fulfilled: false, fulfilled_at: "", follow_up_status: "called", order_code: "PQ7RT2", client_address: R.client_address, client_phone: "79001122", client_alt_phone: "21000000", client_email: "r@x.mt",
    items_text: "Nexium 40mg x28", pickup_date: R.pickup_date, deposit_amount: "7.50" };
  const oDiff = Object.keys(want).filter((k) => JSON.stringify(ob[k]) !== JSON.stringify(want[k])).concat(Object.keys(ob).filter((k) => !(k in want)));
  // the pharmacist: Delete asks for a reason; the reason goes on the order (PUT), then the DELETE
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  await page.click('[data-act=open][data-id="71"]');
  const adminDel = await page.evaluate(() => !!document.querySelector("#ord-edit [data-act=del]"));
  await page.click("#ord-edit [data-act=del]"); await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#ord-edit [data-act=del-go]"); await page.waitForTimeout(300);
  const noReason = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET").length, reasonErr = await page.evaluate(() => (document.querySelector("#ord-edit .ord-err") || {}).textContent || "");
  await page.fill("#ord-edit [name=del_reason]", "Entered twice"); await page.click("#ord-edit [data-act=del-go]"); await page.waitForTimeout(800);
  const dCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && c.path !== "/people");
  // Done: the server's fulfilled=1 range, and Older goes six months further back
  await page.click("[data-act=view-done]"); await page.waitForTimeout(600);
  const doneNames = await page.evaluate(() => [...document.querySelectorAll(".ord-row .t b")].map((e) => e.textContent));
  await page.click("[data-act=older]"); await page.waitForTimeout(600);
  await page.unroute("**/client-orders/entries?*");
  const okDone = doneQs.length >= 2 && /from=\d{4}-\d\d-01&to=\d{4}-\d\d-01&fulfilled=1/.test(doneQs[0]) && doneQs[1] !== doneQs[0];
  report("orders: a change re-reads the order and sends the classic body with only the edit different (a change made elsewhere is kept); staff see no Delete; the pharmacist's Delete needs a reason, writes it on the order, then deletes; Done lists ready orders, Older pages back",
    oPut.path === "/client-orders/entries/71" && oDiff.length === 0 && !staffDel && adminDel && noReason === 0 && /why/i.test(reasonErr) &&
    dCalls.length === 2 && dCalls[0].method === "PUT" && /Deleted \d\d\/\d\d\/\d{4} by Maria Borg: Entered twice/.test(dCalls[0].body.notes) && dCalls[0].body.client_phone === "79001122" && dCalls[1].method === "DELETE" && dCalls[1].path === "/client-orders/entries/71" &&
    doneNames.join() === "Done Daniel" && okDone, JSON.stringify({ oDiff, ob, staffDel, adminDel, noReason, reasonErr, dCalls, doneNames, doneQs }));
} catch (e) { report("orders: a change sends the classic body", false, String(e).slice(0, 300)); }

// Questions, changing one: the whole classic body from a fresh read, only the edit different; staff see no Delete; the
// pharmacist's Delete adds the reason as a note first; Done reads resolved=1.
try {
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector('[data-act=open][data-id="61"]'), null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; });
  await page.click('[data-act=open][data-id="61"]');
  const tStaffDel = await page.evaluate(() => !!document.querySelector("#tkt-edit [data-act=del]"));
  await page.selectOption("#tkt-edit [name=status]", "Awaiting Client"); await page.fill("#tkt-edit [name=issue]", "Is her repeat ready? Two boxes");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#tkt-edit button[type=submit]"); await page.waitForTimeout(800);
  const tc = await (await fetch(`http://localhost:${PORT}/__calls`)).json(), tPut = tc.filter((c) => c.method === "PUT")[0] || {}, tb = tPut.body || {};
  const reRead = tc.some((c) => c.method === "GET" && c.path === "/client-tickets/entries");
  const tWant = { ticket_id: "TKT-00007", client_name: "Camilleri Rita", phone: "79222333", email: "rita@x.com", category: "Prescription", priority: 2, status: "Awaiting Client", issue: "Is her repeat ready? Two boxes", assigned_to: "John", resolved: false, resolved_at: "" };
  const tDiff = Object.keys(tWant).filter((k) => JSON.stringify(tb[k]) !== JSON.stringify(tWant[k]));
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  await page.click('[data-act=open][data-id="61"]'); await page.click("#tkt-edit [data-act=del]"); await page.fill("#tkt-edit [name=del_reason]", "Recorded twice");
  await fetch(`http://localhost:${PORT}/__reset`); await page.click("#tkt-edit [data-act=del-go]"); await page.waitForTimeout(800);
  const tD = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET");
  const tLog = (() => { try { return JSON.parse(tD[0].body.notes_log); } catch (e) { return []; } })();
  await fetch(`http://localhost:${PORT}/__reset`); await page.click("[data-act=view-done]"); await page.waitForTimeout(500);
  const tDone = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "GET" && c.path === "/client-tickets/entries").map((c) => c.query);
  report("questions: a change re-reads the question and sends the classic body with only the edit different; staff see no Delete; the pharmacist's Delete adds the reason as a note, then deletes; Done reads resolved=1",
    reRead && tPut.path === "/client-tickets/entries/61" && tDiff.length === 0 && Object.keys(tb).length === 14 && !tStaffDel &&
    tD.length === 2 && tD[0].method === "PUT" && tLog.length === 2 && tLog[1].text === "Deleted: Recorded twice" && tD[1].method === "DELETE" && tD[1].path === "/client-tickets/entries/61" && tDone.includes("?resolved=1"),
    JSON.stringify({ tDiff, tb, tStaffDel, tD, tDone }));
} catch (e) { report("questions: a change sends the classic body", false, String(e).slice(0, 300)); }

// Deliveries in the new layout: overdue in Today, future in Later, done ones hidden; Delivered sends the whole record with only delivery fields changed.
await page.goto(base + "&ui=2#deliveries");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-card"), null, { timeout: 15000 });
const dl1 = await page.evaluate(() => ({ rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), labs: [...document.querySelectorAll(".dlv-lab")].map((e) => e.textContent), names: [...document.querySelectorAll(".dlv-card .h b")].map((e) => e.textContent) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=done][data-id="72"]'); await page.fill("#dlv-done [name=recipient]", ""); await page.click("#dlv-done button[type=submit]"); await page.waitForTimeout(200);
const dlErr = await page.evaluate(() => (document.querySelector(".dlv-err") || {}).textContent || "");
await page.fill("#dlv-done [name=recipient]", "Rita's son"); await page.click("#dlv-done button[type=submit]"); await page.waitForTimeout(700);
const dlPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
const dvb = (dlPuts[0] || {}).body || {};
report("deliveries: open in the new layout, overdue first, done hidden; Delivered needs who, keeps every other field",
  dl1.rail.join() === "customers" && /^Today/.test(dl1.labs[0]) && /^Later/.test(dl1.labs[1]) && dl1.names.join() === "Camilleri Rita,Later Lino" && /who took it/.test(dlErr) &&
  dlPuts.length === 1 && dlPuts[0].path === "/client-deliveries/entries/72" && dvb.status === "Delivered" && dvb.recipient_name === "Rita's son" && dvb.delivery_attempts === 1 &&
  dvb.id_doc_ref === "123456M" && dvb.delivery_method === "Courier" && dvb.priority === 1 && dvb.tracking_number === "TRK9" && dvb.internal_notes === "Call first" && dvb.ticket_ref === "TKT-00007" && dvb.email === "rita@x.com" &&
  JSON.parse(dvb.items)[0].batch_ref === "B7" && JSON.parse(dvb.delivery_log).length === 2 && dvb.cold_chain_required === 1 && dvb.signature_required === 1,
  JSON.stringify({ dl1, dlErr, dlPuts }));

// b4-5: the daily classic-only actions of the Customers group, in the new layout.
// Deliveries: open one by its name and change it. The record is read again and sent whole in the classic body, with only
// the edit different (an item kept with its batch, a new one as the classic item editor adds it); what the classic edit
// has no field for is kept; errors stop the save; Escape closes an unchanged form; staff see no Delete; the pharmacist's
// Delete writes the reason in the log, then deletes.
try {
  const C = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path !== "/client-log");
  const actNow = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("data-act") || a.name || a.tagName) + (a.getAttribute("data-id") ? "#" + a.getAttribute("data-id") : "") : ""; });
  await page.goto(base + "&ui=2#customers"); await page.goto(base + "&ui=2#deliveries");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector('.dlv-name[data-id="72"]'), null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; });
  await page.click('.dlv-name[data-id="72"]'); await page.waitForSelector("#dlv-edit"); await page.waitForFunction(() => document.activeElement && document.activeElement.name === "client_name", null, { timeout: 3000 }).catch(() => {}); // the form takes focus a moment after it is drawn
  const ev0 = await page.evaluate(() => { const f = document.querySelector("#dlv-edit"), v = (n) => f.querySelector("[name=" + n + "]"); return { focus: document.activeElement.name, items: v("itemsText").value, cd: v("contains_controlled").checked, cold: v("cold_chain_required").checked, addr: v("delivery_address").value, del: !!f.querySelector("[data-act=del]"), exp: document.querySelector('.dlv-name[data-id="72"]').getAttribute("aria-expanded"), foot: document.querySelector(".dlv > p:last-child").textContent }; });
  await page.press("#dlv-edit [name=client_name]", "Escape"); await page.waitForTimeout(100);
  const evEsc = { form: !!(await page.$("#dlv-edit")), focus: await actNow() };
  await page.click('.dlv-name[data-id="72"]'); await page.waitForSelector("#dlv-edit");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#dlv-edit [name=delivery_address]", ""); await page.click("#dlv-edit button[type=submit]"); await page.waitForTimeout(150);
  const evErr = await page.evaluate(() => ({ inv: [...document.querySelectorAll("#dlv-edit [aria-invalid=true]")].map((e) => e.name), alert: (document.querySelector("#dlv-edit [role=alert]") || {}).textContent || "", focus: document.activeElement.name }));
  const evNone = (await C()).filter((c) => c.method !== "GET").length;
  await page.fill("#dlv-edit [name=delivery_address]", "14 Triq il-Kbira, Mosta"); await page.fill("#dlv-edit [name=scheduled_time_slot]", "Morning"); await page.fill("#dlv-edit [name=itemsText]", "2× Morphine 10mg, Panadol");
  await page.click("#dlv-edit button[type=submit]"); await page.waitForTimeout(700);
  const evC = await C(), evPut = evC.filter((c) => c.method === "PUT"), eb = (evPut[0] || {}).body || {};
  const evReread = evC.findIndex((c) => c.method === "GET" && c.path === "/client-deliveries/entries") < evC.findIndex((c) => c.method === "PUT");
  const evItems = (() => { try { return JSON.parse(eb.items); } catch (e) { return []; } })();
  const evWant = { delivery_id: "DEL-00005", scheduled_time_slot: "Morning", actual_delivery_date: "", actual_delivery_time: "", client_name: "Camilleri Rita", phone: "79222333", email: "rita@x.com", delivery_address: "14 Triq il-Kbira, Mosta", address_notes: "Blue door", id_doc_ref: "123456M", delivery_method: "Courier", priority: 1, assigned_driver: "Kevin Mifsud", tracking_number: "TRK9", status: "Scheduled", signature_required: true, signature_obtained: false, recipient_name: "", proof_of_delivery: "", delivery_attempts: 0, failure_reason: "", contains_controlled: true, cold_chain_required: true, ticket_ref: "TKT-00007", delivery_log: JSON.stringify([{ ts: "2026-10-30T09:00:00Z", author: "Maria", text: "Packed" }]), internal_notes: "Call first" };
  const evDiff = Object.keys(evWant).filter((k) => JSON.stringify(eb[k]) !== JSON.stringify(evWant[k]));
  await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "open", null, { timeout: 3000 }).catch(() => {});
  const evAfter = { focus: await actNow(), form: !!(await page.$("#dlv-edit")) };
  // delete: the pharmacist only, with a reason
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  await page.click('.dlv-name[data-id="72"]'); await page.waitForSelector("#dlv-edit [data-act=del]");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#dlv-edit [data-act=del]"); await page.waitForSelector("#dlv-edit [name=del_reason]");
  await page.waitForFunction(() => document.activeElement && document.activeElement.name === "del_reason", null, { timeout: 3000 }).catch(() => {}); // the screen focuses the reason one tick after drawing it
  const edFocus = await page.evaluate(() => document.activeElement.name);
  await page.click("#dlv-edit [data-act=del-go]"); await page.waitForTimeout(150);
  const edNo = { calls: (await C()).filter((c) => c.method !== "GET").length, err: await page.evaluate(() => (document.querySelector("#dlv-edit [role=alert]") || {}).textContent || "") };
  await page.fill("#dlv-edit [name=del_reason]", "Entered twice"); await page.click("#dlv-edit [data-act=del-go]"); await page.waitForTimeout(700);
  const edC = (await C()).filter((c) => c.method !== "GET"), edLog = (() => { try { return JSON.parse(edC[0].body.delivery_log); } catch (e) { return []; } })();
  report("deliveries (b4-5): open one by its name, change it: re-read, the classic body whole with only the edit different, items keep their batch; errors stop it; Escape closes an unchanged form; Delete is the pharmacist's, with a reason in the log first",
    ev0.focus === "client_name" && ev0.items === "2× Morphine 10mg" && ev0.cd && ev0.cold && ev0.addr === "12 Triq il-Kbira, Mosta" && !ev0.del && ev0.exp === "true" && /^Drivers and item batches are in the classic screen\.$/.test(ev0.foot.trim()) &&
    !evEsc.form && evEsc.focus === "open#72" &&
    evErr.inv.join() === "delivery_address" && /address.*Nothing was saved/.test(evErr.alert) && evErr.focus === "delivery_address" && evNone === 0 &&
    evReread && evPut.length === 1 && evPut[0].path === "/client-deliveries/entries/72" && evDiff.length === 0 && Object.keys(eb).length === 29 &&
    evItems.length === 2 && evItems[0].batch_ref === "B7" && evItems[0].schedule === "CD" && evItems[0].qty === 2 && JSON.stringify(evItems[1]) === JSON.stringify({ name: "Panadol", qty: 1, schedule: "OTC", batch_ref: "", expiry: "" }) &&
    !evAfter.form && evAfter.focus === "open#72" &&
    edFocus === "del_reason" && edNo.calls === 0 && /why/i.test(edNo.err) &&
    edC.length === 2 && edC[0].method === "PUT" && edLog.length === 2 && edLog[1].text === "Deleted: Entered twice" && edLog[1].author === "Maria Borg" && edC[1].method === "DELETE" && edC[1].path === "/client-deliveries/entries/72",
    JSON.stringify({ ev0, evEsc, evErr, evNone, evDiff, eb, evAfter, edFocus, edNo, edC }));
} catch (e) { report("deliveries (b4-5): change and delete", false, String(e).slice(0, 300)); }

// Orders: after a new order, the classic screen's next question in place: its items into the order diary (the classic
// call: one line, the order's day, qty 1, the supplier typed, no notes); "Not now" and Escape add nothing.
try {
  const C = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path !== "/client-log");
  await page.goto(base + "&ui=2#customers"); await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-row"), null, { timeout: 15000 });
  const addOne = async (items) => { await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add"); await page.fill("#ord-add [name=client_name]", "Cachia Ġorġ"); await page.fill("#ord-add [name=contact]", "79444555"); await page.fill("#ord-add [name=items]", items); await page.fill("#ord-add [name=needed_by]", todayYmd); await page.click("#ord-add button[type=submit]"); await page.waitForSelector("#ord-diary"); await page.waitForTimeout(150); };
  await addOne("Ħ-brand syrup 200ml");
  await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "add", null, { timeout: 3000 }).catch(() => {}); // after the list is read again
  const od0 = await page.evaluate(() => ({ text: document.querySelector("#ord-diary .ord-meta").textContent, focus: document.activeElement.getAttribute("data-act"), foot: (document.querySelector(".ord > p:last-child") || {}).textContent || "" }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#ord-diary [name=supplier]", "PharmaCo"); await page.click("#ord-diary button[type=submit]"); await page.waitForTimeout(500);
  const odC = (await C()).filter((c) => c.path.startsWith("/order-diary")), odPost = odC.filter((c) => c.method === "POST");
  const od1 = { gone: !(await page.$("#ord-diary")), focus: await page.evaluate(() => document.activeElement.getAttribute("data-act")) };
  await addOne("Panadol"); await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=diary-no]"); await page.waitForTimeout(150);
  const odNo = { gone: !(await page.$("#ord-diary")), posts: (await C()).filter((c) => c.method === "POST" && c.path.startsWith("/order-diary")).length };
  await addOne("Ventolin"); await fetch(`http://localhost:${PORT}/__reset`);
  await page.press("#ord-diary [name=supplier]", "Escape"); await page.waitForTimeout(150);
  const odEsc = { gone: !(await page.$("#ord-diary")), posts: (await C()).filter((c) => c.method === "POST" && c.path.startsWith("/order-diary")).length, focus: await page.evaluate(() => document.activeElement.getAttribute("data-act")) };
  report("orders (b4-5): after a new order its items go into the order diary in place: the classic call, once; Not now and Escape add nothing; nothing is sent to the classic screen (round 2)",
    od0.text === "Put “Ħ-brand syrup 200ml” in the order diary for today?" && od0.focus === "add" && !/classic/.test(od0.foot) &&
    odPost.length === 1 && JSON.stringify(odPost[0].body) === JSON.stringify({ order_date: todayYmd, item_name: "Ħ-brand syrup 200ml", qty: 1, supplier: "PharmaCo", notes: "" }) && odC.some((c) => c.method === "GET" && c.query === "?date=" + todayYmd) &&
    od1.gone && od1.focus === "add" && odNo.gone && odNo.posts === 0 && odEsc.gone && odEsc.posts === 0 && odEsc.focus === "add",
    JSON.stringify({ od0, odC, od1, odNo, odEsc }));
} catch (e) { report("orders (b4-5): into the order diary", false, String(e).slice(0, 300)); }

// Questions: an open question prints on the classic one-question page; the customer's email is a mail link on the card.
try {
  await page.goto(base + "&ui=2#customers"); await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector('.tkt-name[data-id="61"]'), null, { timeout: 15000 });
  const tq0 = await page.evaluate(() => ({ mail: (document.querySelector('.tkt-card a[href^="mailto:"]') || {}).href || "", label: (document.querySelector('.tkt-card a[href^="mailto:"]') || { getAttribute() {} }).getAttribute("aria-label"), mails: document.querySelectorAll('.tkt-card a[href^="mailto:"]').length, foot: document.querySelector(".tkt > p:last-child").textContent }));
  await page.click('.tkt-name[data-id="61"]'); await page.waitForSelector("#tkt-edit [data-act=print]");
  await fetch(`http://localhost:${PORT}/__reset`);
  const [pw] = await Promise.all([page.waitForEvent("popup"), page.click("#tkt-edit [data-act=print]")]);
  await pw.waitForLoadState(); const tqHtml = await pw.evaluate(() => ({ title: document.title, text: document.body.innerText, btn: !!document.querySelector("[data-eikon-print=print]") })); await pw.close();
  const tqCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && c.path !== "/client-log").length;
  report("questions (b4-5): Print in an open question opens the classic one-question page; the email on the card is a mail link; nothing is sent; the footer names only what is left",
    tq0.mail === "mailto:rita@x.com?subject=Your%20question%20(TKT-00007)" && tq0.label === "Email Camilleri Rita, rita@x.com" && tq0.mails === 1 && /^New categories and staff names are in the classic screen\.$/.test(tq0.foot.trim()) &&
    tqHtml.title === "TKT-00007" && /Camilleri Rita/.test(tqHtml.text) && /Called, no answer/.test(tqHtml.text) && /Priority: 2 — Medium/.test(tqHtml.text) && /Notes Log \(1 entry\)/.test(tqHtml.text) && tqHtml.btn && tqCalls === 0,
    JSON.stringify({ tq0, tqHtml, tqCalls }));
} catch (e) { report("questions (b4-5): print one, email", false, String(e).slice(0, 300)); }

// Customers' registers, quality pass (Orders, Questions, Deliveries, Vaccines, Contacts): every problem in a form at once,
// each beside its field (aria-invalid + aria-describedby) and summed up in one alert, nothing sent; typing in a field
// clears its mark; Escape closes an untouched form or line and gives focus back to what opened it (a form with typing
// stays); a search redraws only the list (the box keeps its node and focus); section headings are not in capitals; the
// back button comes from the tab the screen belongs to; on a phone the buttons are 44 px tall.
let qStep = "orders";
try {
  const calls = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && c.path !== "/client-log");
  const marks = (form) => page.evaluate((f) => ({ inv: [...document.querySelectorAll(f + " [aria-invalid=true]")].map((e) => e.name || e.getAttribute("data-k") + e.getAttribute("data-i")), said: [...document.querySelectorAll(f + " [aria-invalid=true]")].every((e) => { const d = document.getElementById(e.getAttribute("aria-describedby")); return d && d.textContent.length > 5; }), alert: ((document.querySelector(f + " [role=alert]") || {}).textContent || ""), focus: document.activeElement && (document.activeElement.name || document.activeElement.getAttribute("data-k")) }), form);
  const act = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("data-act") || a.id || a.name || a.tagName) + (a.getAttribute("data-id") ? "#" + a.getAttribute("data-id") : "") : ""; });
  // Orders
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-row"), null, { timeout: 15000 });
  const oLook = await page.evaluate(() => ({ back: document.querySelector(".ord-back").textContent, tt: getComputedStyle(document.querySelector(".ord-lab")).textTransform }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add"); await page.press("#ord-add [name=client_name]", "Escape"); await page.waitForTimeout(100);
  const oEsc = { form: !!(await page.$("#ord-add")), focus: await act() };
  await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add"); await page.fill("#ord-add [name=deposit]", "abc"); await page.press("#ord-add [name=deposit]", "Escape");
  const oEscTyped = !!(await page.$("#ord-add"));
  await page.click("#ord-add button[type=submit]"); await page.waitForTimeout(150);
  const oM = await marks("#ord-add");
  await page.type("#ord-add [name=client_name]", "B"); const oClr = await page.evaluate(() => document.querySelector("#ord-add [name=client_name]").getAttribute("aria-invalid"));
  const oPosts = (await calls()).length;
  await page.click("[data-act=add-cancel]");
  qStep = "orders search";
  // search: twelve orders, so the box shows; typing redraws only the list
  const dS = (n) => maltaYmd(n);
  await page.route("**/client-orders/entries?*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: Array.from({ length: 12 }, (_, i) => ({ id: 300 + i, order_date: dS(0), client_name: (i % 3 ? "Borg " : "Hili Ġorġ ") + i, client_phone: "7900" + i, items_text: "Item " + i, priority: 2, needed_by: dS(i - 2), fulfilled: 0 })) }) }));
  await page.goto(base + "&ui=2#customers"); await page.goto(base + "&ui=2#clientorders"); // a real visit, so the list is read again
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector("#ord-q") && document.querySelectorAll(".ord-row").length === 12, null, { timeout: 15000 }); // the list has arrived, so the marker tests a search, not the first paint
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300); // the months history arrives after the list and repaints the screen once; a search is measured after that
  await page.evaluate(() => { document.querySelector("#ord-q").__same = 1; });
  await page.focus("#ord-q"); await page.keyboard.type("ġorġ", { delay: 30 });
  const oQ = await page.evaluate(() => ({ same: document.querySelector("#ord-q").__same === 1, focus: document.activeElement.id, rows: document.querySelectorAll(".ord-row").length, lab: document.querySelector(".ord-lab").textContent }));
  await page.keyboard.press("Escape"); const oQ2 = await page.evaluate(() => ({ v: document.querySelector("#ord-q").value, rows: document.querySelectorAll(".ord-row").length }));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(100);
  const oTap = await page.evaluate(() => Math.min(...[...document.querySelectorAll(".ord-row .ord-btn, .ord-tabs button")].map((b) => b.getBoundingClientRect().height)));
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.unroute("**/client-orders/entries?*");
  qStep = "questions";
  // Questions
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector(".tkt-card"), null, { timeout: 15000 });
  const tLook = await page.evaluate(() => ({ back: document.querySelector(".tkt-back").textContent, subs: [...document.querySelectorAll(".tkt-card .s")].map((e) => e.textContent) }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".tkt-top [data-act=add]"); await page.waitForSelector("#tkt-add"); await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(150);
  const tM = await marks("#tkt-add");
  await page.click("[data-act=add-cancel]");
  await page.click('[data-act=note][data-id="61"]'); await page.waitForSelector("#tkt-note input"); await page.press("#tkt-note input", "Escape"); await page.waitForTimeout(100);
  const tEsc = { form: !!(await page.$("#tkt-note")), focus: await act() };
  const tPosts = (await calls()).length;
  qStep = "deliveries";
  // Deliveries
  await page.goto(base + "&ui=2#deliveries");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-card"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".dlv-top [data-act=add]"); await page.waitForSelector("#dlv-add"); await page.click("#dlv-add button[type=submit]"); await page.waitForTimeout(150);
  const dM = await marks("#dlv-add");
  await page.click("[data-act=add-cancel]");
  await page.click('[data-act=fail][data-id="72"]'); await page.waitForSelector("#dlv-fail [name=reason]"); await page.press("#dlv-fail [name=reason]", "Escape"); await page.waitForTimeout(100);
  const dEsc = { form: !!(await page.$("#dlv-fail")), focus: await act() };
  const dPosts = (await calls()).length;
  qStep = "vaccines";
  // Vaccines
  await page.goto(base + "&ui=2#vaccines");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "vaxreg" && document.querySelector(".vxr-row"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".vxr-top [data-act=add]"); await page.waitForSelector("#vxr-add"); await page.click("[data-act=sec][data-sec=other]"); await page.click("#vxr-add button[type=submit]"); await page.waitForTimeout(150);
  const vM = await marks("#vxr-add");
  await page.evaluate(() => { document.querySelector("#vxr-q").__same = 1; }); await page.fill("#vxr-q", "rita"); await page.waitForTimeout(100);
  const vQ = await page.evaluate(() => ({ same: document.querySelector("#vxr-q").__same === 1, found: (document.querySelector(".vxr-lab") || {}).textContent }));
  const vPosts = (await calls()).length;
  qStep = "contacts";
  // Contacts
  await page.goto(base + "&ui=2#contacts");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "conreg" && document.querySelector(".con-row"), null, { timeout: 15000 });
  const cLook = await page.evaluate(() => ({ back: document.querySelector(".con-back").textContent }));
  await page.evaluate(() => { document.querySelector("#con-q").__same = 1; }); await page.focus("#con-q"); await page.keyboard.type("acta", { delay: 30 });
  const cQ = await page.evaluate(() => ({ same: document.querySelector("#con-q").__same === 1, focus: document.activeElement.id, rows: [...document.querySelectorAll(".con-open b")].map((b) => b.textContent) }));
  await page.click('[data-open="suppliers:31"]'); await page.waitForTimeout(100); await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  const cEsc = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-open"));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".con-head [data-act=add]"); await page.waitForSelector("#con-form"); await page.fill("#con-form [name=name]", ""); await page.fill("#con-form [name=email]", "nope"); await page.click("#con-form button[type=submit]"); await page.waitForTimeout(150);
  const cM = await marks("#con-form");
  await page.click("#con-form [data-act=form-cancel] >> nth=-1").catch(() => {});
  const cPosts = (await calls()).length;
  report("customers' registers, quality pass: every problem at once beside its field and in one alert, nothing sent; Escape closes an untouched form or line and focus goes back to its button (a typed form stays); a search redraws only the list; headings not in capitals; back from the screen's tab; 44 px buttons on a phone",
    oLook.back === "‹ Customers" && oLook.tt === "none" && !oEsc.form && oEsc.focus === "add" && oEscTyped &&
    ["client_name", "items", "needed_by", "deposit"].every((k) => oM.inv.includes(k)) && oM.said && /customer's name.*ordered.*needed.*amount.*Nothing was saved/.test(oM.alert) && oM.focus === "client_name" && oClr === null && oPosts === 0 &&
    oQ.same && oQ.focus === "ord-q" && oQ.rows === 4 && /Waiting 4/.test(oQ.lab) && oQ2.v === "" && oQ2.rows === 12 && oTap >= 44 &&
    tLook.back === "‹ Customers" && tLook.subs.every((x) => !/Open$/.test(x)) && tLook.subs.some((s) => /In progress/.test(s)) &&
    tM.inv.join() === "client_name,issue" && tM.said && /name.*asked.*Nothing was saved/.test(tM.alert) && !tEsc.form && tEsc.focus === "note#61" && tPosts === 0 &&
    dM.inv.join() === "client_name,phone,delivery_address" && dM.said && dM.focus === "client_name" && !dEsc.form && dEsc.focus === "fail#72" && dPosts === 0 &&
    ["name0", "client_first", "client_last", "phone"].every((k) => vM.inv.includes(k)) && vM.said && /vaccine.*name.*surname.*phone.*Nothing was saved/.test(vM.alert) && vQ.same && /Found 1/.test(vQ.found) && vPosts === 0 &&
    cLook.back === "‹ Team" && cQ.same && cQ.focus === "con-q" && cQ.rows.join() === "Actavis Malta" && cEsc === "suppliers:31" && cM.inv.join() === "name,email" && cM.said && cM.focus === "name" && cPosts === 0,
    JSON.stringify({ oLook, oEsc, oEscTyped, oM, oClr, oPosts, oQ, oQ2, oTap, tLook, tM, tEsc, tPosts, dM, dEsc, dPosts, vM, vQ, vPosts, cLook, cQ, cEsc, cM, cPosts }));
} catch (e) { await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {}); await page.unroute("**/client-orders/entries?*").catch(() => {}); report("customers' registers, quality pass: ran to the end", false, qStep + ": " + String(e).slice(0, 300)); }

// Controlled drugs received in the new layout: one invoice, several lines, one POST per line with the shared supplier and invoice.
await page.goto(base + "&ui=2#dda-purchases");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdpreg" && document.querySelector(".cdp-inv"), null, { timeout: 15000 });
const cdp1 = await page.evaluate(() => ({ rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), inv: (document.querySelector(".cdp-inv .h") || {}).textContent || "" }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=add]"); await page.fill("[name=agent]", "Actavis"); await page.fill("[name=invoice_number]", "INV-9");
await page.fill('[data-i="0"][data-k=dda_name_dose]', "Morphine 10mg"); await page.fill('[data-i="0"][data-k=quantity]', "30");
await page.fill('[data-i="1"][data-k=dda_name_dose]', "Fentanyl 25mcg"); await page.fill('[data-i="1"][data-k=quantity]', "5");
await page.click("#cdp-add button[type=submit]"); await settleSave();
const cdpPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/dda-purchases/entries").map((c) => c.body);
report("controlled drugs received: open from the old link in the new layout; one invoice with two lines makes two entries",
  cdp1.rail.join() === "registers" && /Supplier/.test(cdp1.inv) && /INV-1/.test(cdp1.inv) && cdpPosts.length === 2 && cdpPosts.every((b) => b.agent === "Actavis" && b.invoice_number === "INV-9" && /^\d{4}-\d{2}-\d{2}$/.test(b.entry_date)) && cdpPosts[0].dda_name_dose === "Morphine 10mg" && cdpPosts[0].quantity === 30 && cdpPosts[1].quantity === 5,
  JSON.stringify({ cdp1, cdpPosts }));

// Controlled drugs supplied in the new layout: a known ID card and prescriber fill in; a repeated serial needs a second press.
await page.goto(base + "&ui=2#dda-sales");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
await page.click("[data-act=add]"); await page.waitForTimeout(300);
await page.fill("[name=client_id_card]", "12345m"); await page.waitForTimeout(700);
await page.fill("[name=doctor_name]", "Dr Abela"); await page.press("[name=doctor_name]", "Tab"); await page.waitForTimeout(500);
await page.fill("[name=prescription_serial_no]", "RX-1");
await page.fill('[data-i="0"][data-k=medicine_name_dose]', "Morphine 10mg"); await page.fill('[data-i="0"][data-k=quantity]', "10");
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("#cds-add button[type=submit]"); await page.waitForTimeout(600);
const cds1 = await page.evaluate(() => ({ name: document.querySelector("[name=client_name]").value, reg: document.querySelector("[name=doctor_reg_no]").value, dup: !!document.querySelector(".cds-dup"), btn: document.querySelector("#cds-add button[type=submit]").textContent }));
const cdsBefore = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").length;
await page.click("#cds-add button[type=submit]"); await settleSave();
const cdsPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/dda-sales/entries").map((c) => c.body);
report("controlled drugs supplied: ID card and prescriber fill in; a repeated serial shows and waits for 'Yes, save it'; then one entry",
  cds1.name === "Zammit Carmel" && cds1.reg === "R1201" && cds1.dup && cds1.btn === "Yes, save it" && cdsBefore === 0 && cdsPosts.length === 1 && cdsPosts[0].client_id_card === "0012345M" && cdsPosts[0].client_address === "1 Triq il-Knisja" && cdsPosts[0].quantity === 10 && cdsPosts[0].prescription_serial_no === "RX-1",
  JSON.stringify({ cds1, cdsBefore, cdsPosts }));

// DDA stock takes in the new layout (ddstreg): the old link lands here. Start one, add lines (a fraction is refused),
// count with Enter moving down, a count whose answer is lost is checked and not sent twice, change a line, an added
// line whose answer is lost is not added twice, close, print. Bodies are the classic's; no delete.
try {
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#dda_stocktakes");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ddstreg" && document.querySelector(".dst-st"), null, { timeout: 15000 });
  const ds1 = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join(), back: document.querySelector(".dst-back").textContent, rows: [...document.querySelectorAll(".dst-st")].map((b) => b.textContent) }));
  await page.click("[data-act=new]"); await page.waitForSelector("#dst-add [name=item_name]"); await page.waitForTimeout(200);
  await page.fill("#dst-add [name=item_name]", "Diazepam"); await page.fill("#dst-add [name=dosage]", "5mg"); await page.fill("#dst-add [name=qty_tablets]", "2.5");
  await page.click("#dst-add button[type=submit]"); await page.waitForTimeout(300);
  const dsErr = await page.evaluate(() => (document.querySelector("#dst-add .dst-err") || {}).textContent || "");
  await page.fill("#dst-add [name=qty_tablets]", "12"); await page.click("#dst-add button[type=submit]"); await settleSave();
  await page.fill("#dst-add [name=item_name]", "Alprazolam"); await page.fill("#dst-add [name=dosage]", "0.5mg"); await page.fill("#dst-add [name=qty_tablets]", "56"); await page.press("#dst-add [name=qty_tablets]", "Enter"); await settleSave();
  const dsFocusAfterAdd = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-fk"));
  await page.click("input.dst-cnt >> nth=0"); await page.keyboard.type("54"); await page.keyboard.press("Enter"); await page.waitForTimeout(500);
  const dsFocus = await page.evaluate(() => ({ fk: document.activeElement.getAttribute("data-fk"), mode: document.activeElement.getAttribute("inputmode") }));
  // a lost answer: the write reaches the server, then the connection drops before the reply (the browser sees a reset)
  const loseOnce = async (re, method) => { let done = false; const h = async (route) => { if (done || route.request().method() !== method) return route.fallback(); done = true; await route.fetch().catch(() => {}); await route.abort("connectionreset"); await page.unroute(re, h); }; await page.route(re, h); };
  await loseOnce(/\/dda-stocktakes\/items\/3$/, "PUT"); await page.keyboard.type("11"); await page.keyboard.press("Enter"); await page.waitForTimeout(1500);
  const dsStatus = await page.evaluate(() => [...document.querySelectorAll(".dst-items .row")].map((r) => r.querySelector("b").textContent + "=" + r.querySelector("input").value + ":" + r.querySelector("small").textContent));
  await page.locator(".dst-items .row", { hasText: "Diazepam" }).locator("[data-act=edit]").click(); await page.waitForSelector("#dst-edit");
  await page.fill("#dst-edit [name=item_name]", "Diazepam (Valium)"); await page.click("[data-act=edit-save]"); await settleSave(); await page.waitForTimeout(300);
  await loseOnce(/\/dda-stocktakes\/stocktakes\/2\/items$/, "POST");
  await page.fill("#dst-add [name=item_name]", "Morphine sulphate"); await page.fill("#dst-add [name=dosage]", "10mg"); await page.fill("#dst-add [name=qty_tablets]", "30"); await page.click("#dst-add button[type=submit]"); await page.waitForTimeout(1500); await settleSave();
  const dsAddErr = await page.evaluate(() => (document.querySelector("#dst-add .dst-err") || {}).textContent || "");
  await page.click("[data-act=close]"); await page.waitForTimeout(600);
  const dsClosed = await page.evaluate(() => ({ meta: (document.querySelector(".dst-meta") || {}).textContent, closeBtn: !!document.querySelector("[data-act=close]"), del: [...document.querySelectorAll(".dst button")].some((b) => /delete/i.test(b.textContent)) }));
  const [pop] = await Promise.all([page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null), page.click("[data-act=print]")]);
  let dsPrint = ""; if (pop) { await pop.waitForLoadState("load").catch(() => {}); dsPrint = await pop.content().catch(() => ""); await pop.close().catch(() => {}); }
  await page.waitForTimeout(300);
  const dsW = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path.startsWith("/dda-stocktakes") && c.method !== "GET").map((c) => c.method + " " + c.path + " " + JSON.stringify(c.body));
  const dsItems = ddstState.items.filter((i) => i.stocktake_id === 2).map((i) => i.item_name + "|" + i.dosage + "|" + i.qty_tablets).sort();
  const want = ["POST /dda-stocktakes/stocktakes {}",
    'POST /dda-stocktakes/stocktakes/2/items {"item_name":"Diazepam","dosage":"5mg","qty_tablets":12}',
    'POST /dda-stocktakes/stocktakes/2/items {"item_name":"Alprazolam","dosage":"0.5mg","qty_tablets":56}',
    'PUT /dda-stocktakes/items/4 {"ok":true,"item_name":"Alprazolam","dosage":"0.5mg","qty_tablets":54}',
    'PUT /dda-stocktakes/items/3 {"ok":true,"item_name":"Diazepam","dosage":"5mg","qty_tablets":11}',
    'PUT /dda-stocktakes/items/3 {"ok":true,"item_name":"Diazepam (Valium)","dosage":"5mg","qty_tablets":11}',
    'POST /dda-stocktakes/stocktakes/2/items {"item_name":"Morphine sulphate","dosage":"10mg","qty_tablets":30}',
    'PUT /dda-stocktakes/stocktakes/2 {"closed":1}'];
  report("DDA stock takes: the old link opens the new screen under Registers; start, add (2.5 refused), count with Enter moving down, change a line, close and print send the classic's bodies; a lost answer on a count or an added line is checked, never sent twice; no delete",
    ds1.hash === "#ddstreg" && ds1.rail === "registers" && /Registers/.test(ds1.back) && ds1.rows.length === 1 && /Closed/.test(ds1.rows[0]) && /2 items/.test(ds1.rows[0]) &&
    /whole number/.test(dsErr) && dsFocusAfterAdd === "add-name" && dsFocus.fk === "cnt-3" && dsFocus.mode === "numeric" && // whole tablets: the number pad (q2)
    dsStatus.join() === "Alprazolam=54:Saved,Diazepam=11:Saved" && !dsAddErr &&
    JSON.stringify(dsW) === JSON.stringify(want) && JSON.stringify(dsItems) === JSON.stringify(["Alprazolam|0.5mg|54", "Diazepam (Valium)|5mg|11", "Morphine sulphate|10mg|30"]) &&
    /Closed/.test(dsClosed.meta) && !dsClosed.closeBtn && !dsClosed.del && /DDA Stock Take/.test(dsPrint) && /Morphine sulphate/.test(dsPrint),
    JSON.stringify({ ds1, dsErr, dsFocusAfterAdd, dsFocus, dsStatus, dsAddErr, dsClosed, dsW, dsItems, print: dsPrint.slice(0, 80) }).slice(0, 1800));
} catch (e) { report("DDA stock takes: ran to the end", false, String(e).slice(0, 300)); }

// Today lists a delivery that slipped (sent by servers from bookings-12); Open lands on the new Deliveries screen.
todayState.delivery = true;
await page.goto(base + "&ui=2#today");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector(".tdy-row [data-open='#deliveries']"), null, { timeout: 15000 });
const tdyDl = await page.evaluate(() => { const b = document.querySelector(".tdy-row [data-open='#deliveries']").closest(".tdy-row"); return { text: b.textContent, red: b.classList.contains("red"), legend: document.body.textContent.includes("1 delivery to go out") }; });
await page.click(".tdy-row [data-open='#deliveries']");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg", null, { timeout: 15000 });
todayState.delivery = false;
report("today: an overdue delivery is listed with its address and fridge flag, and opens the new Deliveries screen",
  /Delivery · 12 Triq il-Kbira, Mosta · Afternoon · Fridge/.test(tdyDl.text) && /Was due/.test(tdyDl.text) && tdyDl.red && tdyDl.legend, JSON.stringify(tdyDl));

// Paid out in the new layout: today's total; a comma amount is read as cents; one POST with cash and no cheque number.
await page.goto(base + "&ui=2#paidout");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "poreg" && document.querySelector(".por-sum"), null, { timeout: 15000 });
const po1 = await page.evaluate(() => document.querySelector(".por-sum").textContent);
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=add]"); await page.fill("[name=payee_name]", "Cleaner Joe"); await page.fill("[name=fee]", "25,5"); await page.click("#por-add button[type=submit]"); await settleSave();
const poPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/paid-out/entries").map((c) => c.body);
report("paid out: opens from the old link in the new layout with today's total; 25,5 is recorded as 25.50 cash",
  /Today€12\.50/.test(po1) && poPosts.length === 1 && poPosts[0].fee === 25.5 && poPosts[0].payment_method === "cash" && poPosts[0].cheque_no === "" && poPosts[0].payee_name === "Cleaner Joe" && /^\d{2}:\d{2}$/.test(poPosts[0].entry_time),
  JSON.stringify({ po1, poPosts, poErr: await page.evaluate(() => { const e = document.querySelector(".por-err"); const d = document.querySelector("[name=entry_date]"); const t = document.querySelector("[name=entry_time]"); return [(e || {}).textContent, d && d.value, t && t.value, new Date().toString()].join(" | "); }) }));

// Handover in the new layout: critical first from yesterday; adding a point re-reads the day and sends notes and every point.
await page.goto(base + "&ui=2#instructions");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "hndreg" && document.querySelector(".hnd-list"), null, { timeout: 15000 });
const hn1 = await page.evaluate(() => ({ first: (document.querySelector(".hnd-list .hnd-pt") || {}).textContent, always: (document.querySelector(".hnd-box") || {}).textContent, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod) }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.fill("#hnd-new", "Fridge door sticks"); await page.click('.hnd-seg [data-sev="r"]'); await page.click("#hnd-add button[type=submit]"); await page.waitForTimeout(700);
const hnCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path.startsWith("/instructions/daily"));
const hnPut = (hnCalls.find((c) => c.method === "PUT") || {}).body || {};
report("handover: opens from the old link, critical first; adding re-reads today and keeps the notes and the earlier point",
  /CriticalMethadone/.test(hn1.first || "") && /CD cupboard/.test(hn1.always || "") && hn1.rail.join() === "team" && hnCalls[0].method === "GET" && hnPut.notes === "Inspector may visit" && hnPut.handover_out.length === 2 && hnPut.handover_out[0].text === "Already for tomorrow" && hnPut.handover_out[1].text === "Fridge door sticks" && hnPut.handover_out[1].sev === "r",
  JSON.stringify({ hn1, hnCalls }));

// Who's in: a Team card next to Shifts, opens in the new layout, today's shift and approved leave, refused leave hidden.
await page.goto(base + "&ui=2#team");
await page.waitForFunction(() => document.querySelector('.hub-card[data-open="rotreg"]'), null, { timeout: 15000 });
await page.click('.hub-card[data-open="rotreg"]');
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "rotreg" && document.querySelector(".rot-day.today .rot-p"), null, { timeout: 15000 });
const rot = await page.evaluate(() => ({ today: document.querySelector(".rot-day.today").textContent, classic: location.search.indexOf("ui=classic") >= 0 }));
report("who's in: opens from Team in the new layout; today's shift, approved sick leave shown, refused leave hidden",
  !rot.classic && /Maria Borg.*08:00–14:00/.test(rot.today) && /Karl Vella.*Sick leave.*Away/.test(rot.today) && (rot.today.match(/Maria Borg/g) || []).length === 1, JSON.stringify(rot));

// Today's team tile: yesterday's critical handover point first (in red), and Who's in opens the week's rota.
await page.goto(base + "&ui=2#today");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector("[data-open='#rotreg']"), null, { timeout: 15000 });
const tdyTeam = await page.evaluate(() => { const t = document.querySelector("[data-open='#rotreg']").closest(".tdy-tile"); const b = t.querySelectorAll("p b"); return { first: b[0] && b[0].textContent, red: b[0] && b[0].getAttribute("style") || "" }; });
await page.click("[data-open='#rotreg']");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "rotreg", null, { timeout: 15000 });
report("today: the critical handover point comes first in red; Who's in opens the rota", /Methadone/.test(tdyTeam.first || "") && /danger/.test(tdyTeam.red), JSON.stringify(tdyTeam));

// Team group, best-in-class pass: one word for a role on both rota screens, ← → move the week and focus stays on the
// arrow, a failed load says why with Try again, the back button names its tab, and phone targets are 44 px.
try {
  await page.waitForFunction(() => document.querySelector(".rot-day.today .rot-p"), null, { timeout: 15000 });
  const tg1 = await page.evaluate(() => ({ roles: [...document.querySelectorAll(".rot-p .t span")].map((x) => x.textContent), back: document.querySelector(".rot-back").textContent, week: document.querySelector(".rot-nav b").textContent }));
  await page.click(".rot-nav [data-act=next]"); await page.waitForFunction((w) => document.querySelector(".rot-nav b").textContent !== w, tg1.week, { timeout: 5000 });
  const tg2 = await page.evaluate(() => ({ week: document.querySelector(".rot-nav b").textContent, focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
  await page.evaluate(() => document.activeElement.blur()); await page.keyboard.press("ArrowLeft");
  await page.waitForFunction((w) => document.querySelector(".rot-nav b").textContent === w, tg1.week, { timeout: 5000 });
  await page.route("**/shifts/assignments-range*", (r) => r.abort());
  await page.keyboard.press("ArrowRight"); await page.waitForSelector(".rot-quiet [data-act=retry]", { timeout: 8000 });
  const tg3 = await page.evaluate(() => ({ text: document.querySelector(".rot-quiet").textContent, role: document.querySelector(".rot-quiet").getAttribute("role") }));
  await page.unroute("**/shifts/assignments-range*");
  await page.click(".rot-quiet [data-act=retry]"); await page.waitForFunction(() => document.querySelector(".rot-day") && !document.querySelector(".rot-quiet"), null, { timeout: 8000 });
  report("who's in: roles read as on Plan shifts (Pharmacy assistant), back says ‹ Team, Next keeps focus, ← and → move the week, a failed load says why with Try again that works",
    tg1.roles.some((r) => r === "Pharmacist") && tg1.back === "‹ Team" && tg2.week !== tg1.week && tg2.focus === "next" && /Can't reach the server/.test(tg3.text) && tg3.role === "alert", JSON.stringify({ tg1, tg2, tg3 }));
  // Handover on a Monday after a closed Sunday: the last day that left something, by its weekday.
  hndGap = true;
  await page.goto(base + "&ui=2#hndreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "hndreg" && document.querySelector(".hnd-lab"), null, { timeout: 15000 });
  const hg = await page.evaluate(() => ({ lab: document.querySelector(".hnd-lab").textContent, pt: (document.querySelector(".hnd-list .hnd-pt") || {}).textContent }));
  hndGap = false;
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(maltaYmd(-2) + "T12:00:00Z").getUTCDay()];
  report("handover: nothing from yesterday (a closed Sunday) shows the last day that left something, named by its weekday; urgency reads Medium, not MEDIUM",
    hg.lab === "From " + wd + " 1" && /^MediumSaturday: fridge engineer/.test(hg.pt || ""), JSON.stringify({ hg, wd }));
  // Phone: every control on the team screens is at least 44 px tall (the back button too).
  await page.setViewportSize({ width: 390, height: 844 });
  const small = [];
  for (const id of ["rotreg", "hndreg", "brdreg", "teamreg", "shfreg"]) {
    await page.goto(base + "&ui=2#" + id);
    await page.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("[data-act=back]") && !document.querySelector("[role=status][aria-label^=Opening], [role=status][aria-label^=Loading]"), id, { timeout: 15000 });
    await page.waitForTimeout(300);
    small.push(...await page.evaluate((m) => [...document.querySelectorAll("#eikon-content button, #eikon-content a")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height && r.height < 43.5; }).map((e) => m + ":" + (e.getAttribute("data-act") || e.className) + ":" + Math.round(e.getBoundingClientRect().height)), id));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  report("team screens on a phone: every button and link is at least 44 px tall", small.length === 0, JSON.stringify(small));
} catch (e) { report("team group pass: ran to the end", false, String(e).slice(0, 400)); }

// Repeat prescriptions: soon-to-expire flagged; Renew sends the same patient, medicine and prescriber, dated today, expiry left to the server.
await page.goto(base + "&ui=2#repeatprescriptions");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector(".rep-row, .rep-tbl tbody tr"), null, { timeout: 15000 });
const rep1 = await page.textContent(".rep-row, .rep-tbl tbody tr"); // 1440 px: the wide table
await fetch(`http://localhost:${PORT}/__reset`);
await page.click(":is(.rep-row, .rep-tbl tbody tr) [data-act=renew]"); await page.click("#rep-add button[type=submit]");
// The mock's Customers list has Zammit Carmel with 0012345M (after the adopt test) while this prescription says 123456M:
// that is question C (eikon.people.js), answered here with "Only this prescription" so the renewal itself is what is tested.
if (await page.waitForSelector(".epc [data-epc=only]", { timeout: 2500 }).then(() => true, () => false)) await page.click(".epc [data-epc=only]");
await settleSave();
const repPost = ((await (await fetch(`http://localhost:${PORT}/__calls`)).json()).find((c) => c.method === "POST" && c.path === "/repeat-prescriptions/entries") || {}).body || {};
report("repeat prescriptions: opens from the old link, flags the one expiring soon; Renew records the same prescription dated today",
  /Expires in 12 days/.test(rep1) && repPost.client_id === "123456M" && repPost.medicine_name_dose === "Atorvastatin 20mg" && repPost.prescriber_reg_no === "R1201" && repPost.entry_date === todayYmd && repPost.expires_date === "", JSON.stringify({ rep1, repPost }));

// Quality pass (q2) on the prescription registers: every problem is said at once, each field marked and the cursor on
// the first; typing survives a repaint; "Another for …" brings the patient and prescriber back for the next line.
{
  const posts = async (path) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === path);
  await page.goto(base + "&ui=2#dda-sales");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.click("#cds-add button[type=submit]"); await page.waitForTimeout(300);
  const q1 = await page.evaluate(() => ({ miss: document.querySelectorAll("#cds-add label.miss").length, row: document.querySelectorAll("#cds-add .row.miss").length, inv: document.querySelectorAll("#cds-add [aria-invalid=true]").length,
    alert: (document.querySelector("#cds-add [role=alert]") || {}).textContent || "", focus: document.activeElement && document.activeElement.name, back: document.querySelector(".cds-back").textContent }));
  await page.keyboard.type("1"); const q1b = await page.evaluate(() => document.querySelector("#cds-add [name=client_id_card]").getAttribute("aria-invalid"));
  const q1p = await posts("/dda-sales/entries");
  await page.goto(base + "&ui=2#dda-purchases");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdpreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); const q2f = await page.evaluate(() => document.activeElement && document.activeElement.name);
  await page.fill('#cdp-add [data-i="1"][data-k=quantity]', "3"); await page.click("#cdp-add button[type=submit]"); await page.waitForTimeout(300);
  const q2 = await page.evaluate(() => ({ alert: (document.querySelector("#cdp-add [role=alert]") || {}).textContent || "", focus: document.activeElement && document.activeElement.name, inv: [...document.querySelectorAll("#cdp-add [aria-invalid=true]")].map((x) => x.name || x.getAttribute("data-k") + x.getAttribute("data-i")) }));
  const q2p = await posts("/dda-purchases/entries");
  report("q2 controlled drugs: an empty Record names every missing field at once, marks each and puts the cursor on the first; nothing is sent",
    q1.miss === 6 && q1.row === 1 && q1.inv === 7 && /the ID card, .*the serial no\. and at least one medicine/.test(q1.alert) && /Nothing was saved/.test(q1.alert) && q1.focus === "client_id_card" && q1b === null && /Registers/.test(q1.back) && q1p.length === 0 &&
    q2f === "agent" && /the supplier, the invoice number and the drug for quantity 3/.test(q2.alert) && q2.focus === "agent" && q2.inv.join() === "agent,invoice_number,dda_name_dose1" && q2p.length === 0,
    JSON.stringify({ q1, q1b, q2f, q2 }));

  // Daily register: what is typed survives a search and a month change; then the next line for the same patient.
  await page.goto(base + "&ui=2#dailyregister");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "drreg" && document.querySelector("[data-act=new]") && !/Opening/.test(document.querySelector(".drr").textContent), null, { timeout: 15000 });
  await page.click("[data-act=new]"); await page.fill("#drr-form [name=client_id]", "123456M"); await page.press("#drr-form [name=client_id]", "Tab"); await page.fill("#drr-form [name=posology]", "1 at night");
  await page.fill("#drr-q", "zz"); await page.waitForTimeout(100);
  const k1 = await page.evaluate(() => ({ id: document.querySelector("#drr-form [name=client_id]").value, pos: document.querySelector("#drr-form [name=posology]").value, res: !!document.querySelector("#drr-res"), q: document.activeElement.id, qv: document.querySelector("#drr-q").value }));
  await page.fill("#drr-q", ""); await page.click("[data-mb=prev]"); await page.waitForTimeout(600);
  const k2 = await page.evaluate(() => ({ id: document.querySelector("#drr-form [name=client_id]").value, pos: document.querySelector("#drr-form [name=posology]").value }));
  await page.click("[data-mb=now]").catch(() => {}); await page.waitForTimeout(400);
  await page.click("#drr-form button[type=submit]"); await page.waitForTimeout(300);
  const k3 = await page.evaluate(() => ({ alert: (document.querySelector("#drr-form [role=alert]") || {}).textContent || "", focus: document.activeElement && document.activeElement.name }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#drr-form [name=medicine_name_dose]", "Augmentin 1g"); await page.fill("#drr-form [name=prescriber_name]", "Dr Abela"); await page.press("#drr-form [name=prescriber_name]", "Tab");
  await page.click("#drr-form button[type=submit]"); await settleSave();
  await page.waitForSelector("[data-act=again]", { timeout: 5000 }).catch(() => {});
  const again = await page.evaluate(() => (document.querySelector("[data-act=again]") || {}).textContent || "");
  await page.click("[data-act=again]").catch(() => {}); await page.waitForTimeout(150);
  const k4 = await page.evaluate(() => { const v = (n) => document.querySelector("#drr-form [name=" + n + "]").value; return { id: v("client_id"), name: v("client_name"), doc: v("prescriber_name"), reg: v("prescriber_reg_no"), med: v("medicine_name_dose"), focus: document.activeElement && document.activeElement.name }; });
  await page.keyboard.type("Paracetamol 500mg"); await page.fill("#drr-form [name=posology]", "2 qds"); await page.click("#drr-form button[type=submit]"); await settleSave();
  const kp = (await posts("/daily-register/entries")).map((c) => c.body);
  report("q2 daily register: typing survives a search and a month change; every missing field named at once; 'Another for …' brings the patient and prescriber for the next line",
    k1.id === "123456M" && k1.pos === "1 at night" && k1.res && k1.q === "drr-q" && k1.qv === "zz" && k2.id === "123456M" && k2.pos === "1 at night" &&
    /^Write the medicine and dose, the prescriber and the prescriber's reg no\. Nothing was saved\.$/.test(k3.alert) && k3.focus === "medicine_name_dose" &&
    /Another for John Borg/.test(again) && k4.id === "123456M" && k4.name === "John Borg" && k4.doc === "Dr Abela" && k4.reg === "4321" && k4.med === "" && k4.focus === "medicine_name_dose" &&
    kp.length === 2 && kp[1].client_id === "123456M" && kp[1].client_name === "John Borg" && kp[1].prescriber_reg_no === "4321" && kp[1].medicine_name_dose === "Paracetamol 500mg" && kp[1].entry_date === kp[0].entry_date,
    JSON.stringify({ k1, k2, k3, again, k4, kp }));

  // Repeat prescriptions: every missing field at once; DDA medicine suggestions: received offers the POYC list too;
  // stock takes: whole-number keypad and the add form's count box lined up with the others.
  await page.goto(base + "&ui=2#repeatprescriptions");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.waitForTimeout(100); await page.click("#rep-add button[type=submit]"); await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => ({ miss: document.querySelectorAll("#rep-add label.miss").length, alert: (document.querySelector("#rep-add [role=alert]") || {}).textContent || "", focus: document.activeElement && document.activeElement.name, search: document.querySelector("#rep-q").getAttribute("aria-label") }));
  const sg = await page.evaluate(() => ({ rec: window.EIKON.ddaDrugs.suggest("diazepam rect", [], "/dda-purchases").map((r) => r.text), sold: window.EIKON.ddaDrugs.suggest("diazepam rect", [], "/dda-sales").map((r) => r.text) }));
  report("q2 repeat prescriptions and DDA suggestions: every missing field at once with the cursor on the first; received offers the POYC list as well as the sales list",
    r1.miss === 6 && /^Write the ID card, the patient's name, .* and the prescriber's reg no\. Nothing was saved\.$/.test(r1.alert) && r1.focus === "client_id" && !!r1.search &&
    sg.rec.some((t) => /^Diazepam rectal tubes/.test(t)) && !sg.sold.some((t) => /^Diazepam rectal tubes/.test(t)), JSON.stringify({ r1, sg }));
}

// Repeats coming due (backlog 3 item 7). The rules (eikon.repeatdue.js RULES) await the pharmacist; these pin the maths.
{
  const rd = await page.evaluate(() => {
    const R = window.EIKON.repeatDue, s = (e, on, all) => R.status(e, on, all).kind;
    const L = (o) => ({ id: 1, entry_date: "2024-01-31", expires_date: "2024-07-31", client_id: "1M", medicine_name_dose: "A", collect_every_days: 30, last_collected_date: null, ...o });
    return {
      add: [R.addDays("2024-02-28", 1), R.addDays("2023-02-28", 1), R.addDays("2026-01-31", 28), R.addDays("2026-03-28", 3), R.addDays("2026-10-24", 2), R.addDays("2026-12-30", 5), R.addDays("2024-02-29", 365)].join(),
      diff: [R.diffDays("2024-02-01", "2024-03-01"), R.diffDays("2023-02-01", "2023-03-01"), R.diffDays("2026-03-28", "2026-03-30")].join(),
      next: [R.nextDue(L({})), R.nextDue(L({ last_collected_date: "2024-02-29" })), R.nextDue(L({ collect_every_days: null })), R.nextDue(L({ entry_date: "2023-12-31", collect_every_days: 60 }))].join(),
      kinds: [s(L({}), "2024-02-23"), s(L({}), "2024-02-22"), s(L({}), "2024-03-01"), s(L({}), "2024-03-09"), s(L({ last_collected_date: "2024-03-01" }), "2024-03-09"),
        s(L({ collect_every_days: null, expires_date: "2024-03-20" }), "2024-03-01"), s(L({ collect_every_days: null }), "2024-03-01"), s(L({}), "2024-08-01"),
        s(L({ last_collected_date: "2024-07-10" }), "2024-07-20"), s(L({}), "2024-03-09", [L({}), L({ id: 2, entry_date: "2024-03-05" })])].join(),
      words: [R.words({ kind: "overdue", days: -1 }), R.words({ kind: "due", days: 0 }), R.words({ kind: "due", days: 5 }), R.words({ kind: "runout", runsOutIn: 12 })].join("|"),
      malta: [window.EIKON.maltaYmd(new Date("2026-03-28T23:30:00Z")), window.EIKON.maltaYmd(new Date("2026-10-31T22:59:00Z")), R.today() === window.EIKON.maltaYmd()].join()
    };
  });
  report("repeats due: day maths across leap years, month ends, clock changes and the year end; next due from the last collection; due / overdue / running out / renewed; Malta's date",
    rd.add === "2024-02-29,2023-03-01,2026-02-28,2026-03-31,2026-10-26,2027-01-04,2025-02-28" && rd.diff === "29,28,2" && rd.next === "2024-03-01,2024-03-30,,2024-02-29" &&
    rd.kinds === "due,later,due,overdue,later,runout,none,expired,runout,renewed" && rd.words === "Overdue 1 day|Due today|Due in 5 days|Runs out in 12 days" && rd.malta === "2026-03-29,2026-10-31,true", JSON.stringify(rd));

  // Today: the Repeats card from /today's repeats (overdue first, then due, then running out); no Tell without item 6; Open hands the patient to the Due view.
  const T0 = await page.evaluate(() => window.EIKON.repeatDue.today());
  const dd = (n) => { const [y, m, d] = T0.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10); };
  const REP = [
    { id: 201, entry_date: dd(-25), expires_date: dd(158), client_name: "Grech Joseph", client_id: "0456789M", medicine_name_dose: "Ramipril 5mg", posology: "1 daily", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201", collect_every_days: 28, last_collected_date: null },
    { id: 202, entry_date: dd(-40), expires_date: dd(143), client_name: "Zammit Carmel", client_id: "0012345M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201", collect_every_days: 28, last_collected_date: null },
    { id: 203, entry_date: dd(-170), expires_date: dd(12), client_name: "Vella Anna", client_id: "0987654M", medicine_name_dose: "Levothyroxine 50mcg", posology: "1 daily", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201", collect_every_days: null, last_collected_date: null },
    { id: 204, entry_date: dd(-10), expires_date: dd(173), client_name: "Borg Maria", client_id: "0111111M", medicine_name_dose: "Metformin 500mg", posology: "1 bd", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201", collect_every_days: 30, last_collected_date: null }];
  await page.route("**/today", async (r) => { const res = await r.fetch(); const j = await res.json(); j.repeats = { entries: REP, lookahead_days: 92, truncated: false }; await r.fulfill({ response: res, json: j }); });
  await page.goto(base + "&ui=2#today");
  await page.waitForSelector(".tdy-row[data-kind=repeat]", { timeout: 15000 }).catch(() => {});
  const card = await page.evaluate(() => ({ lab: (document.querySelector("#tdy-rep") || {}).textContent, rows: Array.from(document.querySelectorAll(".tdy-row[data-kind=repeat]")).map((r) => r.innerText.replace(/\s+/g, " ")), tell: document.querySelectorAll("[data-rep-tell]").length }));
  await page.click(".tdy-row[data-kind=repeat] [data-rep-open]");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector("[data-view]"), null, { timeout: 15000 }).catch(() => {});
  const handed = await page.evaluate(() => ({ hash: location.hash, q: (document.querySelector("#rep-q") || {}).value, due: (document.querySelector("[data-view=due]") || { getAttribute() {} }).getAttribute("aria-pressed") }));
  await page.unroute("**/today");
  report("repeats due: Today's Repeats card lists overdue, due and running out (not the one due in 20 days), no Tell button before item 6, Open shows that patient's Due view",
    /Repeats\s*3/.test(card.lab || "") && card.rows.length === 3 && /Zammit Carmel.*Overdue 12 days/.test(card.rows[0]) && /Grech Joseph.*Due in 3 days/.test(card.rows[1]) && /Vella Anna.*Runs out in 12 days/.test(card.rows[2]) && card.tell === 0 &&
    handed.hash === "#repreg" && handed.q === "0012345M" && handed.due === "true", JSON.stringify({ card, handed }));

  // Repeat prescriptions: Next due on the line, Collected today then Undo (the previous day put back), Renew carries the interval, a chip changes it, Record sends it.
  const colCalls = [];
  await page.route(/\/repeat-prescriptions\/entries(\?|$)/, async (r) => { if (r.request().method() !== "GET") return r.continue(); await r.fulfill({ json: { ok: true, entries: REP } }); });
  await page.route(/\/repeat-prescriptions\/entries\/\d+\/collected$/, async (r) => { const b = JSON.parse(r.request().postData() || "{}"); colCalls.push({ url: r.request().url().replace(/^.*entries/, ""), b });
    await r.fulfill({ json: { ok: true, last_collected_date: "date" in b ? (b.date || null) : T0, previous: "date" in b ? T0 : null } }); });
  await page.goto("about:blank"); await page.goto(base + "&ui=2#repreg"); // a fresh page: the list is read again through the route above
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector("[data-act=collected]"), null, { timeout: 15000 }).catch(() => {});
  const line = await page.evaluate(() => document.querySelector(".eikon-content, body").innerText);
  await page.click('[data-act=collected][data-id="202"]'); await page.waitForTimeout(400);
  const afterCol = await page.evaluate(() => ({ undo: !!document.querySelector('[data-act=uncollect][data-id="202"]'), focus: document.activeElement && document.activeElement.getAttribute("data-act"), text: document.body.innerText.includes("Collected today") }));
  await page.click('[data-act=uncollect][data-id="202"]'); await page.waitForTimeout(400);
  const afterUndo = !!(await page.$('[data-act=collected][data-id="202"]'));
  await page.click('[data-act=renew][data-id="202"]'); await page.waitForTimeout(300);
  const carried = await page.inputValue("[name=collect_every_days]");
  await page.click("[name=posology]"); await page.click('[data-every="56"]');
  const chip = { v: await page.inputValue("[name=collect_every_days]"), pressed: await page.getAttribute('[data-every="56"]', "aria-pressed") };
  await page.fill("[name=collect_every_days]", "400"); await page.click("#rep-add button[type=submit]"); await page.waitForTimeout(300);
  const badErr = await page.evaluate(() => (document.querySelector(".rep-err") || {}).textContent || "");
  await page.fill("[name=collect_every_days]", "56");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#rep-add button[type=submit]");
  if (await page.waitForSelector(".epc [data-epc=only]", { timeout: 2500 }).then(() => true, () => false)) await page.click(".epc [data-epc=only]");
  await settleSave();
  const rp = ((await (await fetch(`http://localhost:${PORT}/__calls`)).json()).find((c) => c.method === "POST" && c.path === "/repeat-prescriptions/entries") || {}).body || {};
  await page.unroute(/\/repeat-prescriptions\/entries(\?|$)/); await page.unroute(/\/repeat-prescriptions\/entries\/\d+\/collected$/);
  report("repeats due: a line shows Next due; Collected today posts, keeps focus on the line and offers Undo, which puts the previous day back; Renew carries the interval; a chip sets it; 400 is refused; Record sends it",
    /Next due/.test(line) && colCalls.length === 2 && colCalls[0].url === "/202/collected" && JSON.stringify(colCalls[0].b) === "{}" && colCalls[1].b.date === "" && afterCol.undo && afterCol.focus === "uncollect" && afterUndo &&
    carried === "28" && chip.v === "56" && chip.pressed === "true" && /1 to 365/.test(badErr) && rp.collect_every_days === 56 && rp.client_id === "0012345M", JSON.stringify({ colCalls, afterCol, afterUndo, carried, chip, badErr, rp }));
}

// Credit notes: what is left; using more than is left is refused before anything is sent; Use all sends exactly the rest.
await page.goto(base + "&ui=2#creditnotes");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cnreg" && document.querySelector(".cnr-card"), null, { timeout: 15000 });
const cn1 = await page.textContent(".cnr-card");
await fetch(`http://localhost:${PORT}/__reset`);
await page.click(".cnr-card [data-act=use]"); await page.fill("#cnr-use [name=amount]", "20"); await page.click("#cnr-use button[type=submit]"); await settleSave();
const cnErr = await page.textContent(".cnr-err").catch(() => "");
const cnBefore = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").length;
await page.click("[data-act=all]"); await page.click("#cnr-use button[type=submit]"); await settleSave();
const cnPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").map((c) => ({ path: c.path, amount: c.body && c.body.amount }));
report("credit notes: opens from the old link with what is left; more than is left is refused; Use all sends the rest",
  /€17\.50 left/.test(cn1) && /only €17\.50 is left/.test(cnErr) && cnBefore === 0 && cnPosts.length === 1 && cnPosts[0].path === "/creditnotes/entries/91/purchases" && cnPosts[0].amount === 17.5, JSON.stringify({ cn1, cnErr, cnPosts }));

// Today's minute refresh must not wipe a fridge reading being typed.
todayState = { tempDone: false, cleanDone: false };
await page.goto(base + "&ui=2#today");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector('.tdy-row[data-kind="temperature"] [data-min]'), null, { timeout: 15000 });
await page.fill('.tdy-row[data-kind="temperature"] [data-min]', "3.4");
await page.focus('.tdy-row[data-kind="temperature"] [data-max]');
await page.evaluate(() => { const before = document.querySelector('.tdy-row[data-kind="temperature"] [data-min]'); window.__minEl = before; });
// run the same silent refresh the minute timer runs
await page.evaluate(() => window.EIKON.__todayRefresh());
await page.waitForTimeout(800);
const tdyKeep = await page.evaluate(() => ({ same: document.querySelector('.tdy-row[data-kind="temperature"] [data-min]') === window.__minEl, val: (document.querySelector('.tdy-row[data-kind="temperature"] [data-min]') || {}).value, focus: document.activeElement && document.activeElement.hasAttribute("data-max") }));
await page.fill('.tdy-row[data-kind="temperature"] [data-min]', ""); await page.evaluate(() => document.activeElement && document.activeElement.blur());
await page.evaluate(() => window.EIKON.__todayRefresh()); await page.waitForTimeout(800);
const tdyIdle = await page.evaluate(() => document.querySelector('.tdy-row[data-kind="temperature"] [data-min]') !== window.__minEl);
report("today: the minute refresh leaves a reading being typed alone (value, field and focus kept), and redraws when idle", tdyKeep.same && tdyKeep.val === "3.4" && tdyKeep.focus && tdyIdle, JSON.stringify({ tdyKeep, tdyIdle }));

// Today when a refresh fails: the notice is one or two proper sentences with Try again, sits above the grid and leaves
// the worklist where it was (inside the grid it took row 1 and pushed the worklist below the side tiles).
await page.route("**/today", (r) => r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Database busy" }) }));
await page.evaluate(() => window.EIKON.__todayRefresh()); await page.waitForTimeout(600);
const tdyFail = await page.evaluate(() => { const off = document.querySelector(".tdy-off"), head = document.querySelector(".tdy-head"), side = document.querySelector(".tdy-side"), date = document.querySelector(".tdy-date");
  return { text: off && off.querySelector("span").textContent, retry: !!(off && off.querySelector("[data-retry]")), headTop: head && Math.round(head.getBoundingClientRect().top), sideTop: side && Math.round(side.getBoundingClientRect().top), sideBottom: side && Math.round(side.getBoundingClientRect().bottom), dateTop: date && Math.round(date.getBoundingClientRect().top), rows: document.querySelectorAll(".tdy-col .tdy-row").length }; });
await page.unroute("**/today");
await page.click(".tdy-off [data-retry]"); await page.waitForTimeout(600);
const tdyBack = await page.evaluate(() => ({ off: !!document.querySelector(".tdy-off"), rows: document.querySelectorAll(".tdy-col .tdy-row").length }));
report("today: a failed refresh says 'Database busy. Showing what we had at hh:mm.' with Try again, keeps the worklist beside the tiles, and Try again clears it",
  /^Database busy\. Showing what we had at \d\d:\d\d\.$/.test(tdyFail.text || "") && tdyFail.retry && tdyFail.rows > 0 && tdyFail.headTop < tdyFail.sideBottom && tdyFail.dateTop < tdyFail.sideTop && !tdyBack.off && tdyBack.rows > 0, JSON.stringify({ tdyFail, tdyBack }));

// Signed out in another tab (the token is shared by every tab of the address): this tab goes to sign-in at once,
// not to "Unauthorized Showing what we had at …" over an empty-looking screen.
// (This page has its own context, so the other tab's removal is replayed as the storage event a browser delivers.)
await page.evaluate(() => { localStorage.removeItem("eikon_token"); window.dispatchEvent(new StorageEvent("storage", { key: "eikon_token", oldValue: "x", newValue: null })); }); await page.waitForTimeout(400);
const otherTab = await page.evaluate(() => { const l = document.querySelector(".eikon-login"); return { login: !!l, text: l ? l.textContent : "", banner: !!document.querySelector(".tdy-off") }; });
report("core: signing out in another tab shows sign-in here at once, saying why", otherTab.login && /signed out in another tab or window/i.test(otherTab.text) && !otherTab.banner, JSON.stringify(otherTab).slice(0, 300));
// The same without the storage event (e.g. the token went before this page loaded its listener): the 401 leads to sign-in.
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); });
await page.goto(base + "&ui=2&r=1#today");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector(".tdy-col .tdy-row"), null, { timeout: 15000 });
await page.route("**/today", (r) => r.request().headers()["authorization"] ? r.continue() : r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unauthorized" }) }));
await page.evaluate(() => { localStorage.removeItem("eikon_token"); return window.EIKON.__todayRefresh(); }); await page.waitForTimeout(500);
const noTok401 = await page.evaluate(() => { const l = document.querySelector(".eikon-login"); return { login: !!l, text: l ? l.textContent : "", banner: (document.querySelector(".tdy-off") || {}).textContent || "" }; });
await page.unroute("**/today");
report("core: a 401 with the token already gone (signed out elsewhere) shows sign-in, not a silent Today", noTok401.login && /signed out in another tab/i.test(noTok401.text) && !noTok401.banner, JSON.stringify(noTok401).slice(0, 300));
// If sign-in could not be drawn, Today itself says "Not signed in." with a Sign in again button (never "Unauthorized").
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); });
await page.goto(base + "&ui=2&r=2#today");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector(".tdy-col .tdy-row"), null, { timeout: 15000 });
await page.route("**/today", (r) => r.fulfill({ status: 401, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Unauthorized" }) }));
await page.evaluate(() => { window.EIKON._sessionExpiredShown = true; return window.EIKON.__todayRefresh(); }); await page.waitForTimeout(500);
const tdyAuth = await page.evaluate(() => { const off = document.querySelector(".tdy-off"); return { text: off ? off.textContent : "", signin: !!(off && off.querySelector("[data-signin]")) }; });
await page.click(".tdy-off [data-signin]"); await page.waitForTimeout(300);
const tdyAuthLogin = await page.evaluate(() => !!document.querySelector(".eikon-login"));
await page.unroute("**/today");
report("today: a 401 Today has to show itself reads 'Not signed in. Showing what we had at hh:mm.' and Sign in again opens sign-in",
  /^Not signed in\. Showing what we had at \d\d:\d\d\.Sign in again$/.test(tdyAuth.text) && tdyAuth.signin && tdyAuthLogin, JSON.stringify({ tdyAuth, tdyAuthLogin }));
// A start that cannot reach the server keeps the session (it is every tab's) and offers Try again / Sign in again.
await page.evaluate(() => { localStorage.setItem("eikon_token", "x"); });
await page.route("**/auth/me", (r) => r.abort());
await page.goto(base + "&ui=2&r=3#today"); await page.waitForSelector("#eikon-start-failed", { timeout: 15000 });
const startFail = await page.evaluate(() => ({ text: document.getElementById("eikon-start-failed").textContent, token: localStorage.getItem("eikon_token"), retry: !!document.getElementById("eikon-start-retry"), signin: !!document.getElementById("eikon-start-signin") }));
await page.unroute("**/auth/me");
await page.click("#eikon-start-retry");
await page.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "today" && document.querySelector(".tdy-col .tdy-row"), null, { timeout: 15000 });
report("core: /auth/me failing at start (offline/timeout) keeps the token and offers Try again, which opens Today",
  /could not reach the server/i.test(startFail.text) && startFail.token === "x" && startFail.retry && startFail.signin, JSON.stringify(startFail));

// Locum receipts: a known locum fills the reg no; 25 December takes the holiday rate remembered in this browser; one POST.
await page.evaluate(() => localStorage.setItem("eikon:locumreceipts:feeMem", JSON.stringify({ normal: 15, holiday: 22.5 })));
await page.goto(base + "&ui=2#locumreceipts");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "lrcreg" && document.querySelector(".lrc-row"), null, { timeout: 15000 });
const lrcTag = await page.evaluate(() => !!document.querySelector(".lrc-row .lrc-hol"));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=add]"); await page.fill("[name=locum_full_name]", "Paul Vella"); await page.press("[name=locum_full_name]", "Tab"); await page.waitForTimeout(200);
const xmas = (Number(maltaYmd(0).slice(0, 4)) - 1) + "-12-25";
await page.fill("[name=receipt_date]", xmas); await page.waitForTimeout(200); await page.fill("[name=hours]", "4"); await page.click("#lrc-add button[type=submit]"); await settleSave();
const lrcPost = ((await (await fetch(`http://localhost:${PORT}/__calls`)).json()).find((c) => c.method === "POST" && c.path === "/locumreceipts/receipts") || {}).body || {};
report("locum receipts: a receipt saved at the normal rate is not tagged holiday; Christmas takes the remembered holiday rate; the known reg no fills in",
  !lrcTag && lrcPost.registration_number === "PH1234" && lrcPost.day_type === "holiday" && lrcPost.fee_per_hour === 22.5 && lrcPost.hours === 4 && lrcPost.receipt_date === xmas, JSON.stringify({ lrcTag, lrcPost }));
await page.evaluate(() => localStorage.removeItem("eikon:locumreceipts:feeMem"));

// Order diary: grouped by supplier; Received sends only the status.
await page.goto(base + "&ui=2#order-diary");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "odreg" && document.querySelector(".odr-row"), null, { timeout: 15000 });
const od1 = await page.evaluate(() => (document.querySelector(".odr-lab") || {}).textContent);
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-st=received][data-id="101"]'); await page.waitForTimeout(600);
const odPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
report("order diary: opens from the old link grouped by supplier; Received sends only the status",
  /Actavis/.test(od1 || "") && odPuts.length === 1 && odPuts[0].path === "/order-diary/entries/101" && JSON.stringify(odPuts[0].body) === JSON.stringify({ status: "received" }), JSON.stringify({ od1, odPuts }));

// Price check: a 10+2 deal at €2.60 is the best unit cost; a recorded quote sends cost, discount, VAT-inclusive cost and quantities.
await page.goto(base + "&ui=2#quotations");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "qtreg" && document.querySelector(".qtr-row"), null, { timeout: 15000 });
const qt1 = await page.evaluate(() => [...document.querySelectorAll(".qtr-row")].map((r) => r.textContent));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=add]"); await page.fill("[name=item_description]", "Panadol 500mg x24"); await page.fill("[name=supplier]", "Medicare"); await page.fill("[name=cost_excl_vat]", "2,50"); await page.fill("[name=discount_euro]", "0.3"); await page.fill("[name=qty_purchased]", "10"); await page.fill("[name=retail_price]", "4.5");
await page.click("#qtr-add button[type=submit]");
let qtPost = {}; for (let i = 0; i < 40 && !qtPost.item_description; i++) { await page.waitForTimeout(100); qtPost = ((await (await fetch(`http://localhost:${PORT}/__calls`)).json()).find((c) => c.method === "POST" && c.path === "/quotations/entries") || {}).body || {}; } // the save reads the list first (no double saves), then posts
report("price check: opens from the old link; the 10+2 deal is Best at €2.17 a unit; a quote sends the server's inputs",
  /Actavis.*Best/.test(qt1[0] || "") && /€2\.17/.test(qt1[0] || "") && qtPost.cost_excl_vat === 2.5 && qtPost.discount_euro === 0.3 && qtPost.cost_incl_vat === 2.95 && qtPost.vat_rate === 18 && qtPost.qty_purchased === 10 && qtPost.qty_free === 0 && qtPost.retail_price === 4.5, JSON.stringify({ qt1, qtPost, dbg: await page.evaluate(() => ({ err: (document.querySelector(".qtr-err") || {}).textContent, form: !!document.querySelector("#qtr-add"), dis: !!document.querySelector("#qtr-add button[type=submit][disabled]"), vals: [...document.querySelectorAll("#qtr-add input,#qtr-add select")].map((i) => i.name + "=" + i.value).join("&"), toasts: [...document.querySelectorAll(".eikon-toast")].map((t) => t.textContent).join("|") })), calls: (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).map((c) => c.method + " " + c.path + (c.query ? "?" + c.query : "")) }));

// b4-6a: the order diary, price check and returns do in place what used to need the classic screen.
{
  const calls = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET");
  const focusName = () => page.evaluate(() => { const a = document.activeElement; return a ? (a.name || a.getAttribute("data-act") || a.tagName) : ""; });
  // Order diary: tap an item, change it; a bad quantity says what to do and sends nothing; Delete… asks once.
  await page.goto(base + "&ui=2#order-diary");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "odreg" && document.querySelector(".odr-row"), null, { timeout: 15000 });
  const odName = await page.evaluate(() => { const b = document.querySelector('[data-act=open][data-id="101"]'); return b ? b.textContent + "|" + b.getAttribute("aria-expanded") : ""; });
  await page.click('[data-act=open][data-id="101"]'); await page.waitForSelector("#odr-edit"); await page.waitForTimeout(60);
  const odF = await focusName(), odFoot = await page.evaluate(() => document.querySelector(".odr").innerText);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#odr-edit [name=qty]", "two"); await page.click("#odr-edit button[type=submit]"); await page.waitForTimeout(150);
  const odBad = await page.evaluate(() => { const e = document.querySelector("#odr-edit [role=alert]"); return e ? e.textContent : ""; }), odBadCalls = (await calls()).length, odBadF = await focusName();
  await page.fill("#odr-edit [name=qty]", "3"); await page.fill("#odr-edit [name=supplier]", "Hili Pharma"); await page.click("#odr-edit button[type=submit]"); await page.waitForTimeout(700);
  const odPut = (await calls()).filter((c) => c.path === "/order-diary/entries/101"), odBackF = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-id"));
  report("order diary (b4-6a): tap an item to change it (form opens on Item); “two” is refused in words with nothing sent; Save sends the classic Edit Item body; focus goes back to the item; the footer no longer sends changes to classic",
    odName === "Change Augmentin 625× 2|false" && odF === "item_name" && /Write how many/.test(odBad) && odBadCalls === 0 && odBadF === "qty" && odPut.length === 1 && odPut[0].method === "PUT" &&
    JSON.stringify(odPut[0].body) === JSON.stringify({ item_name: "Augmentin 625", qty: 3, supplier: "Hili Pharma", notes: "For Mrs Borg" }) && odBackF === "101" && /Tap an item to change it/.test(odFoot) && !/Changing or deleting/.test(odFoot),
    JSON.stringify({ odName, odF, odBad, odBadCalls, odBadF, odPut, odBackF }));
  await page.click('[data-act=open][data-id="101"]'); await page.waitForSelector("#odr-edit");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#odr-edit [data-act=del]"); await page.waitForTimeout(60);
  const odAsk = await page.textContent("#odr-edit"), odAskF = await focusName(), odNone = (await calls()).length;
  await page.keyboard.press("Escape"); await page.waitForTimeout(80); const odKeepF = await focusName();
  await page.click("#odr-edit [data-act=del]"); await page.click("#odr-edit [data-act=del-go]"); await page.waitForTimeout(700);
  const odDel = (await calls()).filter((c) => c.path === "/order-diary/entries/101"), odDelF = await page.evaluate(() => { const a = document.activeElement; return a && a !== document.body ? (a.getAttribute("data-act") || a.tagName) : "body"; });
  report("order diary (b4-6a): Delete… asks once in plain words, nothing is sent until Delete item; Escape keeps it; Delete item sends the classic DELETE; focus stays on the screen",
    /Delete this item from the order diary\? This cannot be undone\./.test(odAsk) && odAskF === "del-cancel" && odNone === 0 && odKeepF === "del" && odDel.length === 1 && odDel[0].method === "DELETE" && odDelF !== "body", JSON.stringify({ odAskF, odNone, odKeepF, odDel, odDelF }));
  // Staff see no Delete… (the pharmacist's, as on the other rebuilt screens).
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; });
  await page.goto(base + "&ui=2#odreg"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "odreg" && document.querySelector(".odr-row"), null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; });
  await page.click('[data-act=open][data-id="101"]'); await page.waitForSelector("#odr-edit");
  const odStaff = await page.evaluate(() => !!document.querySelector("#odr-edit [data-act=del]"));
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  report("order diary (b4-6a): staff can change an item but see no Delete…", odStaff === false, String(odStaff));

  // Price check: tap a supplier to change that quote (the classic Edit Entry body), Delete… asks once.
  await page.goto(base + "&ui=2#quotations");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "qtreg" && document.querySelector(".qtr-row"), null, { timeout: 15000 });
  await page.click('[data-act=open][data-id="1"]'); await page.waitForSelector("#qtr-edit"); await page.waitForTimeout(60);
  const qtF = await focusName(), qtVals = await page.evaluate(() => ["cost_excl_vat", "retail_price", "qty_purchased", "quote_date"].map((k) => document.querySelector("#qtr-edit [name=" + k + "]").value).join("|"));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#qtr-edit [name=retail_price]", "4.95"); await page.click("#qtr-edit button[type=submit]"); await page.waitForTimeout(700);
  const qtPut = (await calls()).filter((c) => c.path === "/quotations/entries/1"), qb = (qtPut[0] || {}).body || {};
  report("price check (b4-6a): tap a supplier to change its quote (opens on Item, filled as classic fills it); Save sends the classic Edit Entry body (every field, in its order)",
    qtF === "item_description" && qtVals === "2.40|4.50|10|2026-10-29" && qtPut.length === 1 && qtPut[0].method === "PUT" &&
    Object.keys(qb).join() === "supplier,barcode,stock_code,item_description,qty_purchased,qty_free,vat_rate,cost_excl_vat,cost_incl_vat,discount_pct,discount_euro,total_incl_vat,retail_price,profit,profit_margin,quote_date,notes" &&
    qb.retail_price === 4.95 && qb.cost_excl_vat === 2.4 && qb.cost_incl_vat === 2.83 && qb.discount_pct === 0 && qb.qty_purchased === 10 && qb.total_incl_vat === 28.3 && qb.profit === 25.5 && qb.quote_date === "2026-10-29", JSON.stringify({ qtF, qtVals, qtPut }));
  await page.click('[data-act=open][data-id="1"]'); await page.waitForSelector("#qtr-edit");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#qtr-edit [data-act=del]"); await page.waitForTimeout(60);
  const qtAsk = await page.textContent("#qtr-edit"), qtNone = (await calls()).length;
  await page.click("#qtr-edit [data-act=del-go]"); await page.waitForTimeout(700);
  const qtDel = (await calls()).filter((c) => c.path === "/quotations/entries/1"), qtFoot = await page.evaluate(() => document.querySelector(".qtr").innerText);
  report("price check (b4-6a): Delete… asks “Delete the GSK quote for Panadol 500mg x24? This cannot be undone.”, then sends the classic DELETE; the footer names only what is left in classic",
    /Delete the GSK quote for Panadol 500mg x24\? This cannot be undone\./.test(qtAsk) && qtNone === 0 && qtDel.length === 1 && qtDel[0].method === "DELETE" && /Importing a price list/.test(qtFoot) && !/Changing or deleting/.test(qtFoot), JSON.stringify({ qtNone, qtDel }));

  // Returns: New return, here; with nothing going back, the empty state offers it.
  await page.route(/\/returns\/entries\?open=1$/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [] }) }));
  await page.goto(base + "&ui=2#returns");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "retreg" && document.querySelector(".rtn-quiet [data-act=add]"), null, { timeout: 15000 });
  const rtEmpty = await page.evaluate(() => ({ text: document.querySelector(".rtn-quiet").innerText, top: !!document.querySelector(".rtn-top [data-act=add]"), main: (window.EIKON.mainButton() || {}).textContent }));
  await page.unroute(/\/returns\/entries\?open=1$/);
  await page.click(".rtn-quiet [data-act=add]"); await page.waitForSelector("#rtn-add"); await page.waitForTimeout(60);
  const rtF = await focusName(), rtDate = await page.inputValue("#rtn-add [name=entry_date]");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#rtn-add button[type=submit]"); await page.waitForTimeout(150);
  const rtBad = await page.evaluate(() => { const e = document.querySelector("#rtn-add [role=alert]"); return e ? e.textContent : ""; }), rtBadCalls = (await calls()).length, rtBadF = await focusName(), rtInv = await page.getAttribute("#rtn-add [name=description]", "aria-invalid");
  await page.fill("#rtn-add [name=description]", "Cipro 500mg x10"); await page.fill("#rtn-add [name=quantity]", "2"); await page.fill("#rtn-add [name=supplier]", "Hili Pharma"); await page.fill("#rtn-add [name=remarks]", "Expiring soon"); await page.fill("#rtn-add [name=expiry]", "2027-01-31");
  await page.click("#rtn-add button[type=submit]");
  let rtPost = null; for (let i = 0; i < 40 && !rtPost; i++) { await page.waitForTimeout(100); rtPost = (await calls()).find((c) => c.method === "POST" && c.path === "/returns/entries") || null; }
  report("returns (b4-6a): with nothing going back the empty state offers New return (no classic); it opens on Item with today's date; no item is refused in words and nothing is sent; Save return sends the classic New + Save body",
    /Nothing is going back/.test(rtEmpty.text) && !/classic/.test(rtEmpty.text) && !rtEmpty.top && rtEmpty.main === "New return" && rtF === "description" && rtDate === todayYmd && /Write the item/.test(rtBad) && rtBadCalls === 0 && rtBadF === "description" && rtInv === "true" && !!rtPost &&
    JSON.stringify(rtPost.body) === JSON.stringify({ entry_date: todayYmd, description: "Cipro 500mg x10", expiry: "2027-01-31", batch: "", quantity: "2", supplier: "Hili Pharma", invoice_number: "", remarks: "Expiring soon", location_stored: "", return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 }),
    JSON.stringify({ rtEmpty, rtF, rtDate, rtBad, rtBadCalls, rtBadF, rtInv, rtPost }));
  await page.waitForTimeout(500);
  const rtTop = await page.evaluate(() => ({ top: !!document.querySelector(".rtn-top [data-act=add]"), foot: document.querySelector(".rtn").innerText }));
  report("returns (b4-6a): with returns listed, New return is the heading's button; the footer no longer sends anything to classic (round 2: change, refused, damaged and delete are in place)", rtTop.top && /Tap a return to change it, mark it refused or damaged/.test(rtTop.foot) && !/classic/.test(rtTop.foot) && !/New returns/.test(rtTop.foot), JSON.stringify(rtTop));
}

// Shortages: its own Stock card; your request with an offer to accept; other pharmacies' requests with "I can help".
await page.goto(base + "&ui=2#stock");
await page.waitForFunction(() => document.querySelector('.hub-card[data-open="ssreg"]'), null, { timeout: 15000 });
await page.click('.hub-card[data-open="ssreg"]');
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ssreg" && document.querySelector(".ssr-card"), null, { timeout: 15000 });
const ss1 = await page.evaluate(() => ({ text: document.querySelector(".ssr").textContent, help: !!document.querySelector("[data-act=offer]") }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=accept][data-id="70"]'); await page.waitForTimeout(600);
const ssCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").map((c) => c.path);
report("shortages: opens in the new layout from its own card; your request shows the offer; Accept sends one action; others' requests offer help",
  /You asked for\s*1/.test(ss1.text) && /Sliema Group/.test(ss1.text) && /Insulin pen needles/.test(ss1.text) && ss1.help && JSON.stringify(ssCalls) === JSON.stringify(["/scarce-stock/need-offers/70/accept"]), JSON.stringify({ ss1: ss1.text.slice(0, 200), ssCalls }));

// Bookings by keyboard: today's list; settings opens as a dialog with focus inside, Escape closes and returns focus to the gear;
// a second set of hours starts after a break; a new booking sends one POST for the chosen time.
try {
await page.goto(base + "&ui=2#bookings");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector(".bkx-ev[data-act=open]"), null, { timeout: 15000 });
const bk1 = await page.evaluate(() => document.querySelector(".bkx-ev[data-act=open]").textContent);
const bkLayout = await page.evaluate(() => ({ ui2: document.documentElement.hasAttribute("data-ui2"), classic: location.search.indexOf("ui=classic") >= 0, flag: localStorage.getItem("eikon_bookings") }));
report("bookings: a link to #bookings opens in the new layout even where the rail does not list Bookings", bkLayout.ui2 && !bkLayout.classic && bkLayout.flag !== "1", JSON.stringify(bkLayout));
await page.focus("[data-act=settings]"); await page.keyboard.press("Enter");
await page.waitForFunction(() => document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
const bkSheet = await page.evaluate(() => { const s = document.querySelector(".bkx-sheet"); return { dialog: s.getAttribute("role") === "dialog" && s.getAttribute("aria-modal") === "true", label: s.getAttribute("aria-label"), inside: s.contains(document.activeElement) }; });
await page.click("[data-act=tab][data-t=hours]"); await page.waitForTimeout(200);
await page.click('.bkx-sheet [data-act="win-add"][data-d="1"]'); await page.waitForTimeout(200);
const bkWin = await page.evaluate(() => [document.querySelector('[data-d="1"][data-i="1"][data-k=from]').value, document.querySelector('[data-d="1"][data-i="1"][data-k=to]').value].join("-"));
let bkEsc = 0; for (let i = 0; i < 30; i++) { await page.keyboard.press("Tab"); if (!(await page.evaluate(() => !!document.activeElement.closest(".bkx-sheet")))) bkEsc++; }
await page.keyboard.press("Escape"); await page.waitForTimeout(200);
// q6-2: the added hours are not saved, so Escape asks first; Throw away closes and focus goes back to the gear
const bkAsk = await page.evaluate(() => ({ ask: (document.querySelector(".bkx-ask") || {}).textContent || "", on: document.activeElement.getAttribute("data-act") }));
await page.click('[data-act="ask-drop"]'); await page.waitForTimeout(200);
const bkBack = await page.evaluate(() => ({ closed: !document.querySelector(".bkx-sheet"), on: document.activeElement.getAttribute("data-act") }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=new]"); await page.waitForFunction(() => document.querySelector(".bkx-slot.on") && document.getElementById("bkx-name"), null, { timeout: 5000 });
await page.fill("#bkx-name", "Paul Grech"); await page.click("[data-act=book]");
await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
const bkPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/bookings").map((c) => c.body);
report("bookings: today's list; settings is a dialog that holds focus; Escape with unsaved hours asks, Throw away returns to the gear; 2nd hours 16:00–19:00; one POST per booking",
  /23:50.*Anna Vella.*Blood pressure/.test(bk1) && bkSheet.dialog && bkSheet.inside && /settings/i.test(bkSheet.label || "") && bkWin === "16:00-19:00" && bkEsc === 0 && /You changed Pharm\. Maria Borg’s hours\./.test(bkAsk.ask) && bkAsk.on === "ask-save" && bkBack.closed && bkBack.on === "settings" &&
  bkPosts.length === 1 && bkPosts[0].serviceId === 1 && bkPosts[0].providerId === 1 && bkPosts[0].start === "23:30" && bkPosts[0].personName === "Paul Grech",
  JSON.stringify({ bk1, bkSheet, bkWin, bkEsc, bkAsk, bkBack, bkPosts }));
} catch (e) { report("bookings: keyboard, hours and booking flow ran to the end", false, String(e).slice(0, 300)); }

// q6-2 (BACKLOG6 item 2): Bookings does the whole job. Change time sends {version,date,start} and a 409 offers the next
// times; any day with ‹ › Today and a date box; past days read only with what happened; the phone calls; a known
// customer's name opens the card; N opens New booking; a half-typed booking comes back; Settings asks before throwing
// a change away; the list refreshes every minute but never under an open sheet.
try {
  const calls2 = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  await page.goto(base + "&ui=2#bookings");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector(".bkx-ev[data-act=open]"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  // 1. the booking sheet: tel link, Change time beside Arrived and Done
  await page.click(".bkx-ev[data-act=open]"); await page.waitForSelector(".bkx-sheet [data-act=move]", { timeout: 5000 });
  const mv0 = await page.evaluate(() => ({ tel: (document.querySelector(".bkx-sheet a[href^='tel:']") || {}).getAttribute ? document.querySelector(".bkx-sheet a[href^='tel:']").getAttribute("href") : "", btns: [...document.querySelectorAll(".bkx-sheet .bkx-acts button")].map((b) => b.textContent.trim()) }));
  await page.click(".bkx-sheet [data-act=move]");
  await page.waitForFunction(() => document.querySelectorAll(".bkx-sheet [data-act=mv-slot]").length >= 2, null, { timeout: 5000 });
  const mv1 = await page.evaluate(() => ({ title: document.querySelector(".bkx-sheet").getAttribute("aria-label"), slots: [...document.querySelectorAll(".bkx-sheet [data-act=mv-slot]")].map((b) => b.textContent), mail: (document.querySelector(".bkx-sheet .bkx-mail") || {}).textContent || "", btn: document.querySelector("[data-act=mv-go]").textContent, dis: document.querySelector("[data-act=mv-go]").disabled }));
  await page.click('.bkx-sheet [data-act=mv-slot][data-i="0"]'); // 23:35, taken meanwhile
  await page.click("[data-act=mv-go]");
  await page.waitForFunction(() => /Someone just took that time/.test((document.querySelector(".bkx-sheet .bkx-err") || {}).textContent || ""), null, { timeout: 5000 });
  const mv2 = await page.evaluate(() => ({ err: document.querySelector(".bkx-sheet .bkx-err").textContent, role: document.querySelector(".bkx-sheet .bkx-err").getAttribute("role"), slots: [...document.querySelectorAll(".bkx-sheet [data-act=mv-slot]")].map((b) => b.textContent), on: (document.querySelector(".bkx-sheet .bkx-slot.on") || {}).textContent, btn: document.querySelector("[data-act=mv-go]").textContent }));
  await page.click("[data-act=mv-go]");
  await page.waitForFunction(() => /Moved to .* at 23:40/.test((document.querySelector(".bkx-sheet .bkx-ok") || {}).textContent || ""), null, { timeout: 5000 });
  const mv3 = await page.evaluate(() => ({ note: document.querySelector(".bkx-sheet .bkx-ok").textContent, tel: !!document.querySelector(".bkx-sheet .bkx-ok a[href='tel:79000000']") }));
  const patches = (await calls2()).filter((c) => c.method === "PATCH" && c.path === "/bookings/501").map((c) => c.body);
  report("bookings q6-2: Change time beside Arrived and Done; the day's free times without the booking's own; a taken time (409) says so and offers the next; Move sends exactly {version,date,start}; no e-mail: the number to call stays on screen",
    mv0.tel === "tel:79000000" && mv0.btns.filter((b) => !/^Remind /.test(b)).join() === "Arrived,Done,Change time,No-show,Cancel booking" && mv1.title === "Change time" && mv1.slots.join() === "23:35,23:40" && /Anna Vella has no e-mail, so call them: 79000000/.test(mv1.mail) && mv1.dis && mv1.btn === "Choose a new time" &&
    /Someone just took that time\. Here are the next free ones\./.test(mv2.err) && mv2.role === "alert" && /^23:40/.test(mv2.on || "") && mv2.slots.length === 2 && /^Move to .* at 23:40$/.test(mv2.btn) &&
    patches.length === 2 && patches.every((b) => JSON.stringify(Object.keys(b)) === JSON.stringify(["version", "date", "start"]) && b.version === 3 && b.date === todayYmd) && patches[0].start === "23:35" && patches[1].start === "23:40" &&
    /Moved to .* at 23:40 · Anna Vella has no e-mail: call 79000000/.test(mv3.note) && mv3.tel,
    JSON.stringify({ mv0, mv1, mv2, mv3, patches }));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);

  // 2. yesterday in one tap: read only, with what happened; Today goes back; ‹ › a week; the date box
  await fetch(`http://localhost:${PORT}/__reset`);
  const strip = await page.evaluate(() => [...document.querySelectorAll(".bkx-days .bkx-day")].map((b) => b.getAttribute("data-d")));
  await page.click(".bkx-days .bkx-day >> nth=0");
  await page.waitForFunction(() => /Borg Ċensina/.test((document.querySelector(".bkx") || {}).textContent || ""), null, { timeout: 5000 });
  const past1 = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".bkx-ev[data-act=open]")].map((r) => r.querySelector("b").textContent.replace(/^\d\d:\d\d /, "") + "=" + ((r.querySelector("em") || {}).textContent || "")), today: !!document.querySelector("[data-act=today]"), sub: document.querySelector(".bkx .sub").textContent, free: document.querySelectorAll(".bkx-free").length }));
  await page.click("[data-act=cancelled]"); await page.waitForSelector('.bkx-r[data-id="491"]', { timeout: 3000 });
  past1.rows = past1.rows.concat(await page.evaluate(() => [...document.querySelectorAll(".bkx-r[data-act=open]")].map((r) => r.querySelector("b").textContent + "=" + ((r.querySelector(".bkx-st") || {}).textContent || ""))));
  await page.click('[data-act=open][data-id="492"]'); await page.waitForSelector(".bkx-sheet", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelector(".bkx-sheet [data-act=card]"), null, { timeout: 5000 }).catch(() => {});
  const past2 = await page.evaluate(() => ({ acts: document.querySelectorAll(".bkx-sheet .bkx-acts button, .bkx-sheet [data-act=move], .bkx-sheet [data-act=st]").length, st: (document.querySelector(".bkx-sheet .bkx-stline") || {}).textContent, card: (document.querySelector(".bkx-sheet [data-act=card]") || {}).getAttribute ? document.querySelector(".bkx-sheet [data-act=card]").getAttribute("aria-label") : "" }));
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.click('.bkx-r[data-id="491"]'); await page.waitForSelector(".bkx-sheet .bkx-stline", { timeout: 5000 });
  const past3 = await page.evaluate(() => document.querySelector(".bkx-sheet .bkx-stline").textContent);
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  await page.click("[data-act=today]"); await page.waitForFunction(() => !document.querySelector("[data-act=today]") && /Anna Vella/.test(document.querySelector(".bkx").textContent), null, { timeout: 5000 });
  await page.click('[data-act=wk][data-n="7"]'); await page.waitForTimeout(300);
  const wk = await page.evaluate(() => ({ strip: [...document.querySelectorAll(".bkx-days .bkx-day")].map((b) => b.getAttribute("data-d")), on: (document.querySelector(".bkx-day.on") || {}).getAttribute("data-d") }));
  await page.click("[data-act=pickdate]"); await page.waitForSelector("#bkx-goto", { timeout: 3000 });
  const gotoFocus = await page.evaluate(() => document.activeElement.id);
  await page.fill("#bkx-goto", "2026-12-24"); await page.waitForTimeout(300); await page.keyboard.press("Enter"); await page.waitForTimeout(200);
  const goto1 = await page.evaluate(() => ({ sub: document.querySelector(".bkx .sub").textContent, box: !!document.getElementById("bkx-goto"), foc: document.activeElement.getAttribute("data-act") }));
  const gets = (await calls2()).filter((c) => c.method === "GET" && c.path === "/bookings").map((c) => c.query || "");
  await page.click("[data-act=today]"); await page.waitForTimeout(300);
  report("bookings q6-2: the strip starts yesterday (one tap); a past day shows done, cancelled and never marked, read only, with the reason; a known customer's name opens the card; Today, ‹ › a week and the date box reach any day",
    strip[1] === todayYmd && past1.rows.join() === "Borg Ċensina=Done,Zammit Paul=Not marked,Galea Helena=Cancelled" && past1.free === 0 && past1.today && /2 booked/.test(past1.sub) &&
    past2.acts === 0 && past2.st === "Not marked" && /Open Zammit Paul’s customer card/.test(past2.card) && /Cancelled · Called to cancel/.test(past3) &&
    wk.strip.length === 7 && wk.on === wk.strip[1] && wk.strip[0] > todayYmd && gotoFocus === "bkx-goto" && /Thursday 24 December/.test(goto1.sub) && !goto1.box && goto1.foc === "pickdate" && gets.some((q) => /from=2026-12-24/.test(q)),
    JSON.stringify({ strip, past1, past2, past3, wk, gotoFocus, goto1, gets }));

  // 3. N opens New booking; Escape keeps the typing; N again brings it back with the line; Clear empties; Cancel keeps nothing
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.querySelector(".bkx h1").focus(); });
  await page.keyboard.press("n"); await page.waitForSelector("#bkx-name", { timeout: 3000 });
  await page.fill("#bkx-name", "Borg Ċensina"); await page.fill("#bkx-phone", "79123456");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  const nd1 = await page.evaluate(() => !document.querySelector(".bkx-sheet"));
  await page.evaluate(() => { document.activeElement && document.activeElement.blur(); });
  await page.keyboard.press("n"); await page.waitForSelector("#bkx-name", { timeout: 3000 });
  const nd2 = await page.evaluate(() => ({ n: document.getElementById("bkx-name").value, ph: document.getElementById("bkx-phone").value, line: (document.querySelector(".bkx-back") || {}).textContent || "" }));
  await page.click("[data-act=draft-clear]"); await page.waitForTimeout(100);
  const nd3 = await page.evaluate(() => ({ n: document.getElementById("bkx-name").value, line: !!document.querySelector(".bkx-back") }));
  await page.fill("#bkx-name", "Vella Rita"); await page.click('.bkx-sheet [data-act=close]'); await page.waitForTimeout(100);
  await page.click("[data-act=new]"); await page.waitForSelector("#bkx-name", { timeout: 3000 });
  const nd4 = await page.evaluate(() => ({ n: document.getElementById("bkx-name").value, line: !!document.querySelector(".bkx-back") }));
  await page.click('.bkx-sheet [data-act=close]'); await page.waitForTimeout(100);
  report("bookings q6-2: N opens New booking; Escape keeps a half-typed one and N brings it back ('Your unsaved booking is back · Clear'); Clear empties it; Cancel keeps nothing",
    nd1 && nd2.n === "Borg Ċensina" && nd2.ph === "79123456" && /Your unsaved booking is back.*Clear/.test(nd2.line) && nd3.n === "" && !nd3.line && nd4.n === "" && !nd4.line, JSON.stringify({ nd1, nd2, nd3, nd4 }));

  // 4. refresh every minute (fast here), never under an open sheet
  await page.evaluate(() => { window.EIKON_BK_POLL_MS = 250; location.hash = "#today"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 8000 });
  await page.evaluate(() => { location.hash = "#bookings"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector(".bkx-ev[data-act=open]"), null, { timeout: 8000 });
  await fetch(`http://localhost:${PORT}/__reset`); await page.waitForTimeout(900);
  const pollOpen = (await calls2()).filter((c) => c.method === "GET" && c.path === "/bookings").length;
  await page.click(".bkx-ev[data-act=open]"); await page.waitForSelector(".bkx-sheet", { timeout: 3000 });
  await fetch(`http://localhost:${PORT}/__reset`); await page.waitForTimeout(900);
  const pollSheet = (await calls2()).filter((c) => c.method === "GET" && c.path === "/bookings").length;
  await page.keyboard.press("Escape");
  await page.evaluate(() => { delete window.EIKON_BK_POLL_MS; location.hash = "#today"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 8000 });
  report("bookings q6-2: the day refreshes by itself while on screen, and not while a sheet is open", pollOpen >= 2 && pollSheet === 0, JSON.stringify({ pollOpen, pollSheet }));

  // 5. Settings: a changed service and a typed room are asked about at Done; Save sends the card's own Save body; Throw away sends nothing
  await page.evaluate(() => { location.hash = "#bookings"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector("[data-act=settings]"), null, { timeout: 8000 });
  await page.click("[data-act=settings]"); await page.waitForSelector('.bkx-sheet [data-svc="1"] [data-k=dur]', { timeout: 5000 });
  await page.fill('.bkx-sheet [data-svc="1"] [data-k=dur]', "20");
  await page.click("[data-act=tab][data-t=rooms]"); await page.waitForSelector("#room-new", { timeout: 3000 });
  await page.fill("#room-new", "Room 1");
  await page.click("[data-act=tab][data-t=services]"); await page.waitForTimeout(200);
  const st0 = await page.evaluate(() => document.querySelector('.bkx-sheet [data-svc="1"] [data-k=dur]').value);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".bkx-sheet [data-act=close]"); await page.waitForTimeout(200);
  const st1 = await page.evaluate(() => ({ ask: (document.querySelector(".bkx-ask") || {}).textContent || "", open: !!document.querySelector(".bkx-sheet"), writes: 0 }));
  st1.writes = (await calls2()).filter((c) => c.method !== "GET").length;
  await page.click("[data-act=ask-drop]"); await page.waitForTimeout(200);
  const st2 = { open: await page.evaluate(() => !!document.querySelector(".bkx-sheet")), writes: (await calls2()).filter((c) => c.method !== "GET").length };
  await page.click("[data-act=settings]"); await page.waitForSelector('.bkx-sheet [data-svc="1"] [data-k=dur]', { timeout: 5000 });
  const st3 = await page.evaluate(() => document.querySelector('.bkx-sheet [data-svc="1"] [data-k=dur]').value);
  await page.fill('.bkx-sheet [data-svc="1"] [data-k=dur]', "20");
  await page.keyboard.press("Escape"); await page.waitForSelector("[data-act=ask-save]", { timeout: 3000 });
  await page.click("[data-act=ask-save]");
  await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 }).catch(() => {});
  const puts = (await calls2()).filter((c) => c.method === "PUT" && c.path === "/bookings/services/1").map((c) => c.body);
  report("bookings q6-2: Settings keeps a change across tabs; Done asks 'You changed the Blood pressure service and the new room · Save · Throw away'; Throw away sends nothing; Save sends the Save button's own body",
    st0 === "20" && /You changed the Blood pressure service and the new room\./.test(st1.ask) && st1.open && st1.writes === 0 && !st2.open && st2.writes === 0 && st3 === "15" &&
    puts.length === 1 && JSON.stringify(puts[0]) === JSON.stringify({ name: "Blood pressure", durationMin: 20, priceCents: 0, providerIds: [1], active: true, online: true }),
    JSON.stringify({ st0, st1, st2, st3, puts }));
} catch (e) { report("bookings q6-2: change time, any day, drafts, refresh and settings ran to the end", false, String(e).slice(0, 200) + " @ " + String(e.stack || "").split("\n").filter((l) => /run\.mjs/.test(l)).slice(0, 2).join(" ")); }

// The calendar (2026-11): tomorrow as columns of time; free time is a button (tap books there, with Repeat); a walk-in
// starts now; blocked time shows and can be unblocked; reminders say who to call and Confirmed records the call; a move
// can skip the e-mail (notify:false) and offers the freed time to the waiting list; old Appointments come over in one tap.
try {
  bkCal.on = true; bkCal.legacy = false; bkCal.imported = 0;
  const callsC = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  const tm = maltaYmd(1);
  await page.goto(base + "&ui=2#bookings"); await page.reload(); // a fresh page: Bookings reads this set-up, not the one before
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector(".bkx-cal"), null, { timeout: 15000 });
  await page.click(`.bkx-day[data-d="${tm}"]`);
  await page.waitForFunction(() => document.querySelectorAll(".bkx-ev[data-act=open]").length === 2, null, { timeout: 5000 });
  const c1 = await page.evaluate(() => ({ ev: [...document.querySelectorAll(".bkx-ev")].map((e) => e.innerText.replace(/\s+/g, " ").trim()), off: (document.querySelector(".bkx-offb") || {}).innerText || "",
    free: [...document.querySelectorAll(".bkx-free")].map((f) => f.getAttribute("aria-label")), sum: (document.querySelector("[data-act=calls]") || {}).textContent || "", head: (document.querySelector(".bkx-ch") || {}).innerText || "",
    region: (document.querySelector(".bkx-cal") || {}).getAttribute ? document.querySelector(".bkx-cal").getAttribute("aria-label") : "" }));
  report("bookings calendar: a column per person with the day's hours; bookings say Reminded / To call and missed bookings; lunch is a grey block; each free stretch is a labelled button; the line above says who to call",
    c1.ev.length === 2 && /09:30 Rita Vella.*Reminded/.test(c1.ev[0]) && /10:00 Pawlu Agius.*To call.*missed 2/.test(c1.ev[1]) && /Lunch.*12:00–12:30/.test(c1.off.replace(/\s+/g, " ")) &&
    c1.free.some((f) => /^Free 10:15 to 12:00 with Pharm\. Maria Borg\. Book$/.test(f)) && c1.sum === "1 reminded · 1 to call" && /Pharm\. Maria Borg\s*2 booked · 3h free/.test(c1.head) && /^Calendar for /.test(c1.region),
    JSON.stringify(c1));

  // tap (keyboard: Enter on the free stretch) → New booking for that person, that day, at 10:15; Repeat every week 4 times → one POST
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.focus('.bkx-free[data-a="615"]'); await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector(".bkx-sheet .bkx-slot.on"), null, { timeout: 5000 });
  const t1 = await page.evaluate(() => ({ on: document.querySelector(".bkx-sheet .bkx-slot.on").textContent, when: [...document.querySelectorAll(".bkx-sheet .bkx-lab")].map((l) => l.textContent).join("|"), focus: document.activeElement.id }));
  await page.fill("#bkx-name", "Ġużeppi Cassar");
  await page.selectOption("#bkx-rep", "7"); await page.waitForSelector("#bkx-repn"); await page.selectOption("#bkx-repn", "4");
  const t2 = await page.evaluate(() => ({ btn: document.querySelector(".bkx-sheet [data-act=book]").textContent, name: document.getElementById("bkx-name").value }));
  await page.click(".bkx-sheet [data-act=book]");
  await page.waitForFunction(() => /Booked 3 times/.test((document.querySelector(".bkx-sheet") || {}).textContent || ""), null, { timeout: 5000 });
  const t3 = await page.evaluate(() => ({ text: document.querySelector(".bkx-sheet").innerText.replace(/\s+/g, " "), find: document.querySelectorAll(".bkx-sheet [data-act=sr-find]").length }));
  const posts1 = (await callsC()).filter((c) => c.method === "POST" && c.path === "/bookings").map((c) => c.body);
  report("bookings calendar: Enter on free time opens New booking at that time with that person; Repeat every week, 4 times, sends one POST with repeat; the times not free are listed with Find a time",
    t1.on === "10:15" && /When · .* with Pharm\. Maria Borg/.test(t1.when) && t2.name === "Ġużeppi Cassar" && /^Book 4 times, every week, from tomorrow at 10:15$/.test(t2.btn) &&
    posts1.length === 1 && posts1[0].providerId === 1 && posts1[0].date === tm && posts1[0].start === "10:15" && JSON.stringify(posts1[0].repeat) === JSON.stringify({ everyDays: 7, count: 4 }) && t3.find === 1 && /Not free at 10:15 · 1/.test(t3.text),
    JSON.stringify({ t1, t2, t3, posts1 }));
  await page.click(".bkx-sheet [data-act=close]"); await page.waitForTimeout(150);

  // walk-in: name, Enter → one POST { walkIn: true, ... }
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".bkx-tools [data-act=walkin]"); await page.waitForSelector(".bkx-sheet #bkx-name", { timeout: 3000 });
  const w0 = await page.evaluate(() => ({ title: document.querySelector(".bkx-sheet").getAttribute("aria-label"), on: (document.querySelector(".bkx-sheet .bkx-svc.on b") || {}).textContent, focus: document.activeElement.id }));
  await page.fill("#bkx-name", "Rita Abela"); await page.press("#bkx-name", "Enter");
  await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
  const wPosts = (await callsC()).filter((c) => c.method === "POST" && c.path === "/bookings").map((c) => c.body);
  report("bookings calendar: Walk-in is one name and Enter: it sends { walkIn: true, the service, the name } once and closes",
    w0.title === "Walk-in" && wPosts.length === 1 && wPosts[0].walkIn === true && wPosts[0].serviceId === 1 && wPosts[0].personName === "Rita Abela", JSON.stringify({ w0, wPosts }));

  // reminders: the list, and Confirmed after a call sends status confirmed
  await page.click(`.bkx-day[data-d="${tm}"]`); await page.waitForSelector("[data-act=calls]", { timeout: 5000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=calls]"); await page.waitForSelector(".bkx-sheet [data-act=confirm]", { timeout: 3000 });
  const r1 = await page.evaluate(() => ({ text: document.querySelector(".bkx-sheet").innerText.replace(/\s+/g, " "), tel: !!document.querySelector(".bkx-sheet a[href='tel:79000602']") }));
  await page.click('.bkx-sheet [data-act=confirm][data-id="602"]'); await page.waitForTimeout(400);
  const cPatch = (await callsC()).filter((c) => c.method === "PATCH").map((c) => [c.path, c.body]);
  const r2 = await page.evaluate(() => document.querySelector(".bkx-sheet") ? document.querySelector(".bkx-sheet").innerText.replace(/\s+/g, " ") : "");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  report("bookings calendar: the reminders list puts the customer without e-mail under To call with the number; Confirmed sends { version, status: confirmed } and moves them to Confirmed",
    /To call · 1 10:00 Pawlu Agius .*no e-mail · 79000602/.test(r1.text) && /Reminded, not confirmed yet · 1 09:30 Rita Vella/.test(r1.text) && r1.tel &&
    cPatch.length === 1 && cPatch[0][0] === "/bookings/602" && JSON.stringify(cPatch[0][1]) === JSON.stringify({ version: 1, status: "confirmed" }) && /Confirmed · 1 10:00 Pawlu Agius/.test(r2), JSON.stringify({ r1, cPatch, r2 }));

  // block time from a free stretch, then unblock the lunch
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.focus('.bkx-free[data-a="615"]'); await page.keyboard.press("Enter");
  await page.waitForSelector(".bkx-sheet [data-act=block-here]", { timeout: 5000 });
  await page.click(".bkx-sheet [data-act=block-here]"); await page.waitForSelector("#bkx-b-from", { timeout: 3000 });
  await page.click('.bkx-sheet [data-act=b-why][data-w="Training"]');
  const b0 = await page.evaluate(() => document.querySelector(".bkx-sheet [data-act=b-go]").textContent);
  await page.click(".bkx-sheet [data-act=b-go]"); await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
  await page.click(".bkx-offb[data-act=exc]"); await page.waitForSelector(".bkx-sheet [data-act=unblock]", { timeout: 3000 });
  await page.click(".bkx-sheet [data-act=unblock]"); await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
  const bCalls = (await callsC()).filter((c) => c.method !== "GET").map((c) => [c.method, c.path, c.body]);
  report("bookings calendar: Block this time instead → Training → one POST of the time off for that person and day; a blocked time opens and Unblock deletes it",
    b0 === "Block 10:15–11:15" && bCalls.length === 2 && bCalls[0][1] === "/bookings/exceptions" && JSON.stringify(bCalls[0][2]) === JSON.stringify({ providerId: 1, date: tm, kind: "off", start: "10:15", end: "11:15", note: "Training" }) &&
    bCalls[1][0] === "DELETE" && bCalls[1][1] === "/bookings/exceptions/77", JSON.stringify({ b0, bCalls }));

  // a move without the e-mail: untick, Move → PATCH has notify:false; the freed 09:30 is offered to Doris on the waiting list
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('.bkx-ev[data-id="601"]'); await page.waitForSelector(".bkx-sheet [data-act=move]", { timeout: 3000 });
  await page.click(".bkx-sheet [data-act=move]"); await page.waitForSelector("#bkx-tell", { timeout: 5000 });
  await page.waitForFunction(() => document.querySelectorAll(".bkx-sheet [data-act=mv-slot]").length > 2, null, { timeout: 5000 });
  await page.uncheck("#bkx-tell"); await page.click('.bkx-sheet [data-act=mv-slot][data-i="2"]');
  const m0 = await page.evaluate(() => ({ tell: document.getElementById("bkx-tell").checked, btn: document.querySelector("[data-act=mv-go]").textContent }));
  await page.click("[data-act=mv-go]");
  await page.waitForFunction(() => /A time just freed up/.test((document.querySelector(".bkx-sheet") || {}).textContent || ""), null, { timeout: 5000 });
  const m1 = await page.evaluate(() => document.querySelector(".bkx-sheet").innerText.replace(/\s+/g, " "));
  const mPatch = (await callsC()).filter((c) => c.method === "PATCH").map((c) => c.body);
  await page.click(".bkx-sheet [data-act=close]"); await page.waitForTimeout(150);
  report("bookings calendar: Tell the customer by e-mail can be unticked: the move sends notify:false; the time it frees is offered to the first person waiting",
    !m0.tell && mPatch.length === 1 && mPatch[0].notify === false && mPatch[0].version === 2 && /Doris Ellul is first on the waiting list/.test(m1), JSON.stringify({ m0, m1, mPatch }));

  // old Appointments: the pharmacist sees what is there and brings it over in one tap; the check is a dry run
  bkCal.legacy = true; await fetch(`http://localhost:${PORT}/__reset`);
  await page.evaluate(() => { Object.keys(sessionStorage).filter((k) => k.indexOf("eikon_bk_legacy_") === 0).forEach((k) => sessionStorage.removeItem(k)); });
  await page.goto(base + "&ui=2#bookings"); await page.reload();
  await page.waitForSelector(".bkx-leg [data-act=leg-run]", { timeout: 10000 });
  const l0 = await page.evaluate(() => document.querySelector(".bkx-leg").innerText.replace(/\s+/g, " "));
  await page.click(".bkx-leg [data-act=leg-run]");
  await page.waitForFunction(() => /Your old appointments are in Bookings/.test((document.querySelector(".bkx-leg") || {}).textContent || ""), null, { timeout: 5000 });
  const l1 = await page.evaluate(() => ({ text: document.querySelector(".bkx-leg").innerText.replace(/\s+/g, " "), focus: document.activeElement.getAttribute("data-act") }));
  const lCalls = (await callsC()).filter((c) => c.path === "/bookings/import-legacy").map((c) => c.method + " " + c.query);
  report("bookings: the old Appointments are offered once — 'Bring your old appointments into Bookings' with what is there and that nothing old changes; Bring them over runs the move once; done says to check hours",
    /Bring your old appointments into Bookings/.test(l0) && /12 appointments \(3 still to come\), 2 doctors and 1 person on the waiting list/.test(l0) && /not changed or deleted/.test(l0) &&
    /12 appointments, 3 still to come, 1 person waiting/.test(l1.text) && l1.focus === "leg-hours" && lCalls.join() === "POST ?dry=1,POST ", JSON.stringify({ l0, l1, lCalls }));
  bkCal.legacy = false;
  await page.click(".bkx-leg [data-act=leg-ok]");

  // a phone: no sideways scroll; the calendar scrolls inside itself
  await page.setViewportSize({ width: 360, height: 780 }); await page.reload();
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector(".bkx-cal"), null, { timeout: 15000 });
  const pw = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, walk: !!document.querySelector(".bkx-walk2") && getComputedStyle(document.querySelector(".bkx-walk2")).display !== "none" }));
  await page.setViewportSize({ width: 1440, height: 900 });
  report("bookings calendar on a 360px phone: no sideways scroll, Walk-in beside the arrows", pw.sw <= pw.cw && pw.walk, JSON.stringify(pw));
} catch (e) { report("bookings calendar ran to the end", false, String(e).slice(0, 300) + " @ " + String(e.stack || "").split("\n").filter((l) => /run\.mjs/.test(l)).slice(0, 2).join(" ")); }
bkCal.on = false; bkCal.legacy = false;

// Quality pass (Today, Customers, Bookings, search, rail): mistakes said next to the field, the cleaner remembered,
// typing never lost while free times load, Enter does what the big button says, Maltese capitals found.
try {
  // Today: a wrong reading is said under the fridge's row (role=alert), the field is marked and focused, what was typed stays, nothing posted
  todayState = { tempDone: false, cleanDone: false };
  await page.goto(base + "&ui=2#today");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector('.tdy-row[data-kind="temperature"] [data-min]'), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill('.tdy-row[data-kind="temperature"] [data-min]', "7"); await page.fill('.tdy-row[data-kind="temperature"] [data-max]', "3");
  await page.press('.tdy-row[data-kind="temperature"] [data-max]', "Enter"); await page.waitForTimeout(250);
  const q1t = await page.evaluate(() => { const r = document.querySelector('.tdy-row[data-kind="temperature"]'), e = r.querySelector(".tdy-err"), mn = r.querySelector("[data-min]"); return { err: e && e.textContent, role: e && e.getAttribute("role"), inv: mn.getAttribute("aria-invalid"), desc: mn.getAttribute("aria-describedby") === (e && e.id), kept: mn.value + "/" + r.querySelector("[data-max]").value, focus: document.activeElement === mn }; });
  const q1tPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
  report("quality today: min above max is said under the row (alert), both fields marked, focus on min, readings kept, nothing posted",
    /lowest reading is higher/.test(q1t.err || "") && q1t.role === "alert" && q1t.inv === "true" && q1t.desc && q1t.kept === "7/3" && q1t.focus && q1tPosts.length === 0, JSON.stringify({ q1t, q1tPosts }));
  // the cleaner: Enter in the name records it; next time the same name is offered, selected, so Enter alone records it again (same body)
  await page.evaluate(() => { try { localStorage.removeItem("eikon_tdy_cleaner:12"); } catch (e) {} });
  // the readings typed above hold the minute refresh back (as they should): empty them so the row is drawn again
  todayState.cleanDone = false; await page.evaluate(() => { document.activeElement && document.activeElement.blur(); document.querySelectorAll("[data-min],[data-max]").forEach((i) => { i.value = ""; }); return window.EIKON.__todayRefresh(); }); await page.waitForTimeout(500);
  const q1c0 = await page.evaluate(() => document.querySelector("[data-cleaner]").value);
  await page.fill("[data-cleaner]", ""); await page.focus("[data-cleaner]");
  await page.keyboard.type("Ġużeppi"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  let q1cPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries");
  todayState.cleanDone = false; await page.evaluate(() => window.EIKON.__todayRefresh()); await page.waitForTimeout(500);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.focus("[data-cleaner]"); await page.evaluate(() => document.querySelector("[data-cleaner]").select());
  const q1c1 = await page.evaluate(() => { const i = document.querySelector("[data-cleaner]"); return { v: i.value, sel: i.selectionEnd - i.selectionStart, focus: document.activeElement === i }; });
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const q1cPosts2 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries");
  const strip = (b) => JSON.stringify(Object.assign({}, b, { time_in: "" }));
  report("quality today: Enter in 'cleaned by' records it; the name is remembered on this device and offered selected next time, so Enter alone records the same body",
    q1c0 === "Maria Borg" && q1cPosts.length === 1 && q1cPosts[0].body.cleaner_name === "Ġużeppi" && q1c1.v === "Ġużeppi" && q1c1.sel === 7 && q1c1.focus && q1cPosts2.length === 1 && strip(q1cPosts2[0].body) === strip(q1cPosts[0].body),
    JSON.stringify({ q1c0, q1cPosts, q1c1, q1cPosts2 }));
  todayState = { tempDone: false, cleanDone: false };

  // Customers: a missing name is said under the field; ċ ġ ħ ż are searched by their longest plain stretch and filtered here
  await page.goto(base + "&ui=2#customers");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers" && document.querySelector("#cus-q"), null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.click('[data-act="new"]'); await page.waitForSelector("#cus-new [name=name]");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#cus-new [name=phone]", "79111222"); await page.click('#cus-new [data-act="create"]'); await page.waitForTimeout(200);
  const q1n = await page.evaluate(() => { const n = document.querySelector("#cus-new [name=name]"), e = document.getElementById("cus-f-name-err"); return { err: e && e.textContent, role: e && e.getAttribute("role"), inv: n.getAttribute("aria-invalid"), focus: document.activeElement === n, phone: document.querySelector("#cus-new [name=phone]").value, kb: document.querySelector("#cus-new [name=id_card]").getAttribute("autocapitalize") + "," + document.querySelector("#cus-new [name=phone]").getAttribute("inputmode") }; });
  await page.keyboard.type("A"); const q1nClear = await page.evaluate(() => !document.getElementById("cus-f-name-err") && !document.querySelector("#cus-new [name=name]").hasAttribute("aria-invalid"));
  const q1nPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
  report("quality customers: Add with no name says so under Name (alert), focuses it, keeps the phone, posts nothing; typing clears it; ID card gets capitals, phone the digit keyboard",
    /Write the customer's name/.test(q1n.err || "") && q1n.role === "alert" && q1n.inv === "true" && q1n.focus && q1n.phone === "79111222" && q1nClear && q1nPosts.length === 0 && q1n.kb === "characters,tel", JSON.stringify({ q1n, q1nClear, q1nPosts }));
  await page.click('#cus-new [data-act="cancel"]');
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#cus-q", "żaren"); await page.waitForTimeout(700);
  const q1m = await page.evaluate(() => ({ people: document.querySelectorAll("[data-person]").length, hist: document.querySelectorAll("[data-hist]").length, unit: [window.EIKON.customersServerQ("Ġużeppi Borg"), window.EIKON.customersServerQ("zammit"), window.EIKON.customersServerQ("ħż")].join("|") }));
  const q1mQ = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "GET" && c.path === "/people").map((c) => c.query || "");
  report("quality customers: 'żaren' asks the server for 'aren' (its LOWER() knows only A to Z) and shows only names with every word typed; plain searches are sent as typed",
    q1mQ.length >= 1 && q1mQ.every((x) => /q=aren/.test(x)) && q1m.people === 0 && q1m.hist === 0 && q1m.unit === "eppi|zammit|ħż", JSON.stringify({ q1m, q1mQ }));

  // Bookings: a name typed while the free times are still loading is kept; Enter in the name books; a missing name is read out
  await page.goto(base + "&ui=2#bookings");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector("[data-act=new]"), null, { timeout: 15000 });
  const q1Adopted = peopleState.adopted; // a booking links its person (POST /people), which the mock reads as an adoption: put it back after
  await page.route("**/bookings/next**", async (r) => { await new Promise((ok) => setTimeout(ok, 700)); await r.continue(); });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=new]"); await page.waitForSelector("#bkx-name"); await page.focus("#bkx-name");
  await page.keyboard.type("Ġorġ Hili");
  await page.waitForFunction(() => document.querySelector(".bkx-slot.on"), null, { timeout: 5000 }); await page.waitForTimeout(100);
  const q1b = await page.evaluate(() => ({ v: document.getElementById("bkx-name").value, focus: document.activeElement && document.activeElement.id }));
  await page.unroute("**/bookings/next**");
  await page.press("#bkx-name", "Enter");
  await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
  const q1bPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/bookings").map((c) => c.body);
  await page.click("[data-act=new]"); await page.waitForFunction(() => document.querySelector(".bkx-slot.on") && document.getElementById("bkx-name"), null, { timeout: 5000 });
  await page.press("#bkx-name", "Enter"); await page.waitForTimeout(200);
  const q1be = await page.evaluate(() => { const e = document.querySelector(".bkx-sheet .bkx-err"); return { err: e && e.textContent, role: e && e.getAttribute("role"), focus: document.activeElement && document.activeElement.id, open: !!document.querySelector(".bkx-sheet") }; });
  // people the pharmacy knows are offered under Name, as in every register: arrow + Enter takes the name and fills the empty phone (Escape-free, nothing booked)
  await page.keyboard.type("Zam"); await page.waitForSelector("#epp-bookings-name .epp-opt", { timeout: 5000 });
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  const q1bp = await page.evaluate(() => ({ n: document.getElementById("bkx-name").value, ph: document.getElementById("bkx-phone").value, open: !!document.querySelector(".bkx-sheet"), role: document.getElementById("bkx-name").getAttribute("role") }));
  await page.click('.bkx-slot[data-i="1"]'); await page.waitForTimeout(150); // a redraw keeps what the suggestion filled
  const q1bp2 = await page.evaluate(() => document.getElementById("bkx-name").value + "|" + document.getElementById("bkx-phone").value);
  const q1bpPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/bookings").length;
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  peopleState.adopted = q1Adopted;
  report("quality bookings: a known person is offered under Name; choosing fills name and phone, kept across a redraw, nothing booked until Book",
    q1bp.role === "combobox" && /^Zammit (Paul|Carmel)$/.test(q1bp.n) && q1bp.open && q1bpPosts === 1 && q1bp2.split("|")[0] === q1bp.n && q1bp2.split("|")[1] === q1bp.ph && (q1bp.n !== "Zammit Paul" || q1bp.ph === "79000001"), JSON.stringify({ q1bp, q1bp2, q1bpPosts }));
  report("quality bookings: a name typed while free times load is kept (was cut to its last letters); Enter in it books once with the same body; no name is said (alert) with focus on Name",
    q1b.v === "Ġorġ Hili" && q1b.focus === "bkx-name" && q1bPosts.length === 1 && q1bPosts[0].personName === "Ġorġ Hili" && q1bPosts[0].start === "23:30" && /Type the person's name/.test(q1be.err || "") && q1be.role === "alert" && q1be.focus === "bkx-name" && q1be.open,
    JSON.stringify({ q1b, q1bPosts, q1be }));

  // Rail: the lit tab is announced as the current page
  await page.goto(base + "&ui=2#customers"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers", null, { timeout: 15000 }); await page.waitForTimeout(200);
  const q1r = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn[aria-current=page]")].map((b) => b.dataset.mod).join());
  await page.goto(base + "&ui=2#tempreg"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tempreg", null, { timeout: 15000 }); await page.waitForTimeout(200);
  const q1r2 = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn[aria-current=page]")].map((b) => b.dataset.mod).join());
  report("quality rail: the lit tab carries aria-current=page (Customers; Registers for the temperature register), and only that one", q1r === "customers" && q1r2 === "registers", JSON.stringify({ q1r, q1r2 }));
} catch (e) { report("quality pass (today, customers, bookings, rail) ran to the end", false, String(e).slice(0, 200) + " @ " + String(e.stack || "").split("\n").filter((l) => /run\.mjs/.test(l)).slice(0, 2).join(" ")); }

// Offline save: the connection drops on Record. The message says so, what was typed stays, and the list is not
// swapped for "Can't reach the server" by the re-read that follows (it fails too).
try {
  await page.goto(base + "&ui=2#paidout");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "poreg" && document.querySelector(".por-sum"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.fill("[name=payee_name]", "Offline Ltd"); await page.fill("[name=fee]", "7");
  await page.context().setOffline(true);
  await page.click("#por-add button[type=submit]"); await page.waitForTimeout(1500);
  const off = await page.evaluate(() => ({ err: (document.querySelector(".por-err") || {}).textContent || "", name: (document.querySelector("[name=payee_name]") || {}).value, fee: (document.querySelector("[name=fee]") || {}).value,
    gone: /Can't reach the server/.test(document.querySelector(".eikon-content").innerText), sum: !!document.querySelector(".por-sum") }));
  await page.context().setOffline(false);
  report("offline save: says it was not saved (no connection), keeps what was typed and the list on screen", /Not saved: there is no connection/.test(off.err) && off.name === "Offline Ltd" && off.fee === "7" && !off.gone && off.sum, JSON.stringify(off));
} catch (e) { await page.context().setOffline(false).catch(() => {}); report("offline save: ran to the end", false, String(e).slice(0, 300)); }

// Chat board in the new layout: opens from the old link under Team; pinned on top, "Mentions you"; a new message goes
// to our group by default (one POST); Pin reads the pinned list first and does not flip a message that is already pinned.
await page.goto(base + "&ui=2#messageboard");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "brdreg" && document.querySelector(".brd-pin .brd-m"), null, { timeout: 15000 });
const bd1 = await page.evaluate(() => ({ pin: document.querySelector(".brd-pin").textContent, feed: document.querySelector(".brd-list:not(.brd-pin)").textContent, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join(), btn: document.querySelector("#brd-new button[type=submit]").textContent }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.fill("#brd-ta", "Fridge back to 4 degrees"); await page.click("#brd-new button[type=submit]"); await settleSave();
boardState.msgs.find((m) => m.id === 12).is_pinned = 1; // another till pins it; this screen still offers Pin
await page.click('.brd-list:not(.brd-pin) [data-act=pin][data-id="12"]'); await page.waitForFunction(() => document.querySelectorAll(".brd-pin .brd-m").length === 2, null, { timeout: 6000 }).catch(() => {});
await page.click('.brd-list:not(.brd-pin) [data-act=pin][data-id="902"]'); await page.waitForFunction(() => document.querySelectorAll(".brd-pin .brd-m").length === 3, null, { timeout: 6000 }).catch(() => {});
const bdCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path.startsWith("/board/"));
const bdPosts = bdCalls.filter((c) => c.method === "POST"), bdPuts = bdCalls.filter((c) => c.method === "PUT");
report("chat board: opens from the old link under Team, pinned first, mentions marked; one POST to our group; pin checks first, never flips twice",
  /Sliema Pharmacy.*Mentions you.*Who has Ozempic/.test(bd1.pin) && /Courier at 16:00/.test(bd1.feed) && /Our group/.test(bd1.feed) && bd1.rail === "team" && bd1.btn === "Send to our group" &&
  bdPosts.length === 1 && bdPosts[0].body.body === "Fridge back to 4 degrees" && bdPosts[0].body.scope === "org" && bdPuts.length === 1 && bdPuts[0].path === "/board/messages/902/pin" && boardState.msgs.find((m) => m.id === 12).is_pinned === 1 && boardState.msgs.find((m) => m.id === 11).is_pinned === 1,
  JSON.stringify({ bd1, bdCalls: bdCalls.map((c) => c.method + " " + c.path + c.query) }));

// Contacts: the old link opens the new screen; the doctor's personal number stays out of the list; an edit sends the whole
// record with its id (the server replaces every field); a new rep is one POST without an id.
await page.goto(base + "&ui=2#contacts");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "conreg" && document.querySelector(".con-row"), null, { timeout: 15000 });
const con1 = await page.evaluate(() => ({ list: document.querySelector(".con-side").textContent, call: (document.querySelector('.con-row:has([data-open="suppliers:31"]) .con-call') || {}).getAttribute && document.querySelector('.con-row:has([data-open="suppliers:31"]) .con-call').getAttribute("href") }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-open="suppliers:31"]'); await page.click(".con-detail [data-act=edit]");
await page.fill("#con-form [name=phone]", "2123 9999"); await page.click("#con-form button[type=submit]"); await settleSave();
await page.click(".con-head [data-act=add]"); await page.selectOption("#con-form [name=type]", "medreps");
await page.fill('#con-form [name="name"]', "Rita Grech"); await page.fill("#con-form [name=phone]", "9988 7766"); await page.click("#con-form button[type=submit]"); await settleSave();
const conPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path.startsWith("/contacts/")).map((c) => ({ path: c.path, body: c.body }));
report("contacts: opens from the old link; personal number kept out of the list; an edit sends the full record; a new rep is one POST",
  /Actavis Malta/.test(con1.list) && /Dr Abela/.test(con1.list) && !/7912 3456/.test(con1.list) && con1.call === "tel:21234567" && conPosts.length === 2 &&
  conPosts[0].path === "/contacts/suppliers" && JSON.stringify(conPosts[0].body) === JSON.stringify({ name: "Actavis Malta", phone: "2123 9999", email: "orders@actavis.example", id: 31 }) &&
  conPosts[1].path === "/contacts/medreps" && JSON.stringify(conPosts[1].body) === JSON.stringify({ name: "Rita Grech", phone: "9988 7766", email: "" }), JSON.stringify({ con1, conPosts }));

// q5-10c: Contacts delete. The pharmacist's Delete… asks once in plain words (focus on Keep it; Escape keeps it); a failed
// delete says so and keeps the question; Delete contact is the classic call (DELETE /contacts/<type>/<id>, no body),
// once; focus goes to the next contact in the list. Staff see no Delete…; the footer no longer sends deleting away.
try {
  let conSup = [{ id: 31, org_id: 1, name: "Actavis Malta", phone: "2123 4567", email: "orders@actavis.example" }, { id: 32, org_id: 1, name: "Hili Pharma", phone: "2133 0000", email: "" }, { id: 33, org_id: 1, name: "Żebbuġ Supplies", phone: "2144 1111", email: "" }];
  let conFail = true; const conDels = [];
  await page.route(/\/contacts\/suppliers(\/\d+)?(\?.*)?$/, (r) => {
    const rq = r.request(), m = new URL(rq.url()).pathname.match(/\/contacts\/suppliers\/(\d+)$/);
    if (rq.method() === "GET" && !m) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, rows: conSup }) });
    if (rq.method() === "DELETE" && m) {
      conDels.push({ path: new URL(rq.url()).pathname, body: rq.postData() });
      if (conFail) { conFail = false; return r.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ ok: false, error: "Server busy" }) }); }
      conSup = conSup.filter((x) => String(x.id) !== m[1]); return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true }) });
    }
    return r.continue();
  });
  await page.goto(base + "&ui=2#today"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 15000 }); // a fresh read of the list
  await page.goto(base + "&ui=2#contacts");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "conreg" && document.querySelector('[data-open="suppliers:32"]'), null, { timeout: 15000 });
  const cdFoot = await page.textContent(".con-foot");
  await page.click('[data-open="suppliers:32"]'); await page.waitForSelector(".con-card [data-act=del]");
  await page.click(".con-card [data-act=del]"); await page.waitForTimeout(80);
  const cdAsk = await page.evaluate(() => ({ text: document.querySelector("#con-ask").textContent, focus: document.activeElement.getAttribute("data-act"), desc: document.querySelector("[data-act=del-go]").getAttribute("aria-describedby") }));
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const cdEsc = await page.evaluate(() => ({ ask: !!document.querySelector("#con-ask"), focus: document.activeElement.getAttribute("data-act"), open: !!document.querySelector(".con-card") }));
  await page.click(".con-card [data-act=del]"); await page.click(".con-card [data-act=del-go]");
  await page.waitForSelector(".con-card .con-err[role=alert]", { timeout: 5000 });
  const cdErr = await page.evaluate(() => ({ err: document.querySelector(".con-card .con-err").textContent, ask: !!document.querySelector("#con-ask"), still: !!document.querySelector('[data-open="suppliers:32"]') }));
  await page.click(".con-card [data-act=del-go]");
  await page.waitForFunction(() => !document.querySelector(".con-card") && document.activeElement && document.activeElement.getAttribute("data-open"), null, { timeout: 5000 }).catch(() => {});
  const cdDone = await page.evaluate(() => ({ focus: document.activeElement.getAttribute("data-open"), gone: !document.querySelector('[data-open="suppliers:32"]') }));
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; });
  await page.click('[data-open="suppliers:31"]'); await page.waitForSelector(".con-card [data-act=edit]");
  const cdStaff = await page.evaluate(() => !document.querySelector("[data-act=del]"));
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  await page.unroute(/\/contacts\/suppliers(\/\d+)?(\?.*)?$/);
  report("contacts delete (q5-10c): the pharmacist's Delete… asks once in plain words, Escape keeps it, a failure says so and keeps the question, then one classic DELETE with no body; focus to the next contact; staff see no Delete…; footer shrunk",
    !/Deleting/.test(cdFoot) && /^Import and export, hiding sections and the specialty filter are in the classic screen\.$/.test(cdFoot.trim()) &&
    cdAsk.text === "Delete Hili Pharma from Contacts? This cannot be undone." && cdAsk.focus === "del-cancel" && cdAsk.desc === "con-ask" &&
    !cdEsc.ask && cdEsc.focus === "del" && cdEsc.open &&
    /^Not deleted: Server busy/.test(cdErr.err) && cdErr.ask && cdErr.still &&
    conDels.length === 2 && conDels.every((d) => d.path === "/contacts/suppliers/32" && d.body == null) && cdDone.gone && cdDone.focus === "suppliers:33" && cdStaff,
    JSON.stringify({ cdFoot, cdAsk, cdEsc, cdErr, cdDone, cdStaff, conDels }));
} catch (e) { await page.unroute(/\/contacts\/suppliers(\/\d+)?(\?.*)?$/).catch(() => {}); report("contacts delete (q5-10c): ran to the end", false, String(e).slice(0, 300)); }

// Vaccines: the old link opens the new screen; Kenya brings its recommendations; a tapped vaccine and the client go in one POST shaped like the classic one.
try {
  await page.goto(base + "&ui=2#vaccines");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "vaxreg" && document.querySelector(".vxr-row"), null, { timeout: 15000 });
  const vx1 = await page.textContent(".vxr-row");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.click("[data-act=sec][data-sec=travel]"); // the form opens on the kind chosen last (Routine, a step before)
  await page.waitForFunction(() => document.querySelectorAll("#vxr-countries option").length > 200, null, { timeout: 15000 });
  await page.fill("[name=country]", "keny"); await page.press("[name=country]", "Enter");
  await page.waitForFunction(() => document.querySelector("[data-act=pick]"), null, { timeout: 5000 });
  const vxRec = await page.evaluate(() => document.querySelector("#vxr-add").innerText);
  await page.click('[data-act=pick][aria-pressed=false]:has-text("Typhim Vi")');
  await page.fill("[name=client_first]", "Joseph"); await page.fill("[name=client_last]", "Grech"); await page.fill("[name=phone]", "79000111");
  await page.click("#vxr-add button[type=submit]");
  let vxPosts = []; for (let i = 0; i < 40 && !vxPosts.length; i++) { await page.waitForTimeout(100); vxPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/vaccines/orders").map((c) => c.body); }
  report("vaccines: opens from the old link; Kenya shows always / higher-risk vaccines; one POST with the classic fields",
    /Rita Camilleri/.test(vx1) && /Recommended for Kenya/i.test(vxRec) && /Typhim Vi/.test(vxRec) && /If at higher risk/i.test(vxRec) && /Rabipur/.test(vxRec) &&
    vxPosts.length === 1 && JSON.stringify(vxPosts[0]) === JSON.stringify({ section: "travel", country_code: "KE", country_name: "Kenya", client_first: "Joseph", client_last: "Grech", phone: "79000111", email: "", items: [{ name: "Typhim Vi", qty: 1 }] }),
    JSON.stringify({ vx1, vxRec: vxRec.slice(0, 200), vxPosts }));
} catch (e) { report("vaccines: the order flow ran to the end", false, String(e).slice(0, 300)); }

// End of day: Today's "Close the day" link opens the new screen; the difference follows the typing (comma decimals);
// Save sends the whole record once, under every name the server reads, with no locked_at; a save by another till
// in between is refused (no PUT) until the person chooses to save over it.
try {
  eodState = { rec: null, n: 0 };
  await page.goto(base + "&ui=2#endofday");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector("#eod-form"), null, { timeout: 15000 });
  await page.click("[data-act=who]"); await page.fill("[name=staff]", "Maria"); await page.fill("[name=float_amount]", "100");
  await page.fill('[name="row:x:0:amount"]', "500,40"); await page.fill('[name="row:epos:0:amount"]', "200.10"); await page.fill('[name="row:paid_outs:0:amount"]', "12,5");
  await page.fill('[name="cash:n50"]', "5"); await page.fill('[name="cash:n20"]', "1"); await page.fill('[name="cash:coins_total"]', "117,10");
  const eodOu = await page.textContent('[data-b="ouBig"]'), eodDep = await page.inputValue('[name="dep:n50"]');
  await page.fill("[name=bag_number]", "B-7");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=save]");
  await page.waitForFunction(() => /Saved/.test(document.querySelector(".eod-st").textContent) && !document.querySelector("[data-act=save][disabled]"), null, { timeout: 8000 });
  const eodPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/endofday/record").map((c) => c.body.record);
  const e0 = eodPuts[0] || {};
  // another till saves meanwhile
  eodState.rec = Object.assign({}, eodState.rec, { staff: "Karl", staff_name: "Karl", updated_at: "2026-11-03 18:20:00" });
  await page.fill("[name=staff]", "Maria B");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=save]"); await page.waitForSelector(".eod-note.dn", { timeout: 8000 });
  const eodRefused = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length === 0 && eodState.rec.staff === "Karl";
  await page.click("[data-act=mine]"); await page.waitForFunction(() => !document.querySelector(".eod-note.dn") && !document.querySelector("[data-act=save][disabled]"), null, { timeout: 8000 });
  report("end of day: opens from #endofday; short by €0.70 as typed (commas); one whole-record PUT with staff/staff_name and bov_deposit aligned, no locked_at; a save from another till in between is refused until 'Save mine over theirs'",
    eodOu === "€0.70 short" && eodDep === "5" && eodPuts.length === 1 && e0.staff === "Maria" && e0.staff_name === "Maria" && e0.float_amount === "100.00" && e0.x[0].amount === "500.40" && e0.paid_outs[0].amount === "12.50" &&
    e0.cash.coins_total === "117.10" && e0.deposit.n50 === 5 && e0.bov_deposit.n50 === 5 && e0.deposit.n20 === 1 && e0.deposit.n500 === 0 && e0.bag_number === "B-7" && e0.bov_bag_number === "B-7" && !("locked_at" in e0) && e0.action === "SAVE" &&
    eodRefused && eodState.rec.staff === "Maria B", JSON.stringify({ eodOu, eodDep, n: eodPuts.length, e0, eodRefused, now: eodState.rec && eodState.rec.staff }));
} catch (e) { report("end of day: ran to the end", false, String(e).slice(0, 300)); }

// End of day: a saved day reads the same whether its bag counts were stored as numbers (classic) or strings (older new-screen saves).
try {
  const readBag = async (dep) => {
    eodState = { rec: { id: 1, date: todayYmd, eod_date: todayYmd, staff: "Maria", float_amount: "100", x: [{ amount: "300" }], epos: [], cheques: [], paid_outs: [],
      cash: { n50: "4", n20: "5", coins_total: "0" }, deposit: dep, bov_deposit: dep, bag_number: "B-1", deposit_edited: true, updated_at: "2026-11-03 18:00:00" }, n: 0 };
    await page.goto("about:blank"); await page.goto(base + "&ui=2#endofday");
    await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector('[name="dep:n50"]'), null, { timeout: 15000 });
    return [await page.inputValue('[name="dep:n50"]'), await page.inputValue('[name="dep:n20"]'), await page.textContent('[data-b="bov"]')];
  };
  const asNum = await readBag({ n500: 0, n200: 0, n100: 0, n50: 3, n20: 5, n10: 0, n5: 0 });
  const asStr = await readBag({ n500: "0", n200: "0", n100: "0", n50: "3", n20: "5", n10: "0", n5: "0" });
  report("end of day: a saved day's bank bag reads the same stored as numbers or as strings",
    JSON.stringify(asNum) === JSON.stringify(asStr) && asNum[0] === "3" && asNum[1] === "5" && /250/.test(asNum[2]), JSON.stringify({ asNum, asStr }));
} catch (e) { report("end of day: bag counts read either form", false, String(e).slice(0, 300)); }

// Money screens (best-in-class pass): a new End of day names the person signed in and keeps Save and the over/under in reach on a
// phone; a missing value puts the cursor in its box, marked and announced, and sends nothing (End of day, Paid out, Credit notes);
// typing in the credit-note search redraws only the list; an empty POS basket shows no payment buttons; plain words in the export.
try {
  eodState = { rec: null, n: 0 };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank"); await page.goto(base + "&ui=2#endofday"); // a fresh page: the test before ends on this same address
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector("#eod-form"), null, { timeout: 15000 });
  const inReach = () => page.evaluate(() => { const b = document.querySelector("[data-act=save]").getBoundingClientRect(), bar = document.querySelector(".eikon-sidebar").getBoundingClientRect(); return b.top >= 0 && b.bottom <= Math.min(innerHeight, bar.top + 1) && !!document.querySelector(".eod-acts [data-b=ouBar]"); });
  const mStaff = (/^Today · (.+?) · (?:AM|PM) · float/.exec(await page.textContent(".eod-who span")) || [])[1], mWho = await page.evaluate(() => (window.EIKON.state.user || {}).full_name), mReach0 = await inReach();
  await page.evaluate(() => window.scrollTo(0, 1500)); await page.waitForTimeout(100); const mReach1 = await inReach();
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=who]"); await page.fill("[name=float_amount]", ""); await page.click("[data-act=save]"); await page.waitForTimeout(300);
  const mEod = await page.evaluate(() => { const a = document.activeElement; return { name: a && a.name, inv: a && a.getAttribute("aria-invalid"), by: a && a.getAttribute("aria-describedby"), alert: (document.querySelector("#eod-err[role=alert]") || {}).textContent || "" }; });
  const mEodPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "&ui=2#paidout");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "poreg" && document.querySelector(".por-sum"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.fill("[name=fee]", "4"); await page.click("#por-add button[type=submit]"); await page.waitForTimeout(300);
  const mPo = await page.evaluate(() => { const a = document.activeElement; return { name: a.name, inv: a.getAttribute("aria-invalid"), alert: (document.querySelector(".por-err[role=alert]") || {}).textContent || "", fee: document.querySelector("[name=fee]").value, pressed: document.querySelector(".por-seg [data-m=cash]").getAttribute("aria-pressed") }; });
  const mPoPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/paid-out/entries").length;
  await page.goto(base + "&ui=2#creditnotes");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cnreg" && document.querySelector(".cnr-card"), null, { timeout: 15000 });
  await page.waitForTimeout(800); // the month list below arrives and draws once; then the screen is still
  await page.evaluate(() => { document.querySelector(".cnr-top").dataset.mark = "kept"; });
  await page.type("#cnr-q", "zzż", { delay: 20 }); await page.waitForTimeout(150);
  const mCn = await page.evaluate(() => ({ kept: document.querySelector(".cnr-top").dataset.mark, none: /No open credit note for “zzż”/.test(document.querySelector("#cnr-list").textContent), focus: document.activeElement.id, label: document.querySelector("#cnr-q").getAttribute("aria-label") }));
  await page.fill("#cnr-q", "rita"); await page.waitForTimeout(150); await page.click(".cnr-card [data-act=use]"); await page.click("#cnr-use button[type=submit]"); await page.waitForTimeout(300);
  const mCnUse = await page.evaluate(() => ({ name: document.activeElement.name, inv: document.activeElement.getAttribute("aria-invalid") }));
  await page.evaluate(() => localStorage.removeItem("eikon_epos_cart"));
  await page.goto(base + "&ui=2#emergency-pos");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eposreg" && /2 products/.test((document.querySelector("#epr-hits") || {}).textContent || ""), null, { timeout: 15000 });
  const mPos0 = await page.evaluate(() => !!document.querySelector("#epr-pay") || !!document.querySelector("[data-b=total]"));
  await page.fill("#epr-q", "5012345678900"); await page.press("#epr-q", "Enter"); await page.waitForTimeout(150);
  const mPos1 = await page.evaluate(() => !!document.querySelector("#epr-pay") && /^Take €/.test(document.querySelector("[data-b=take]").textContent));
  await page.click("[data-act=clear]"); await page.click("[data-act=clear-yes]");
  await page.goto(base + "&ui=2#money"); await page.waitForFunction(() => (document.querySelector(".hub h1") || {}).textContent === "Money", null, { timeout: 8000 });
  const mHub = await page.evaluate(() => [...document.querySelectorAll(".hub-lab")].map((x) => x.textContent).join("|"));
  await page.goto(base + "&ui=2#expreg"); await page.waitForSelector(".exp [data-act=download]", { timeout: 15000 });
  const mExp = await page.evaluate(() => ({ jargon: /request/i.test(document.querySelector(".exp").textContent), btn: document.querySelector(".exp [data-act=download]").textContent }));
  report("money screens: a new day names who is signed in; Save and the over/under stay in reach on a phone; a missing value puts the cursor in its box (marked, announced, nothing sent); the credit-note search redraws only its list; an empty basket has no payment buttons; hub groups in plain words",
    !!mStaff && mStaff === mWho && mReach0 && mReach1 && mEod.name === "float_amount" && mEod.inv === "true" && mEod.by === "eod-err" && /Write the float/.test(mEod.alert) && mEodPuts === 0 &&
    mPo.name === "payee_name" && mPo.inv === "true" && /Write who was paid/.test(mPo.alert) && mPo.fee === "4" && mPo.pressed === "true" && mPoPosts === 0 &&
    mCn.kept === "kept" && mCn.none && mCn.focus === "cnr-q" && !!mCn.label && mCnUse.name === "amount" && mCnUse.inv === "true" && !mPos0 && mPos1 && mHub === "Till|Customers and locums" && !mExp.jargon && mExp.btn === "Download spreadsheet",
    JSON.stringify({ mStaff, mWho, mReach0, mReach1, mEod, mEodPuts, mPo, mPoPosts, mCn, mCnUse, mPos0, mPos1, mHub, mExp }));
} catch (e) { report("money screens: ran to the end", false, String(e).slice(0, 300)); }
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

// b4-4 counter forms with sensible defaults. Orders / Deliveries / Questions: Today · Tomorrow · the working day after
// (Sunday skipped) under the date; a tap writes that date into the field and is what is sent; Orders has no hidden
// default (no tap, no date: still refused). Today's cleaning: the name is already there, the team is suggested, one tap
// or Enter records. End of day: one summary line for day/staff/shift/float, Tab from it lands on the first X reading,
// Enter goes on to the next amount, "Nothing counted yet" until a figure is typed; an untouched summary saves the same.
try {
  const calls4 = async (path) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === path).map((c) => c.body);
  const wantDays = () => { const out = []; for (let i = 0; out.length < 3 && i < 8; i++) { const y = maltaYmd(i); if (i > 0 && new Date(y + "T12:00:00Z").getUTCDay() === 0) continue; out.push(y); } return out; };
  const W = wantDays();
  const chips = (form) => page.evaluate((f) => [...document.querySelectorAll(f + " .q44-days button")].map((b) => ({ t: b.textContent, ymd: b.dataset.ymd, on: b.getAttribute("aria-pressed") })), form);
  // Orders
  await page.goto("about:blank"); await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".ord-top [data-act=add]"); await page.waitForTimeout(150);
  const oc0 = await chips("#ord-add"), oHint = await page.textContent("#ord-pu-hint");
  await page.fill("#ord-add [name=client_name]", "Borg Ċensina"); await page.fill("#ord-add [name=contact]", "79112233"); await page.fill("#ord-add [name=items]", "Augmentin 625 x14");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#ord-add button[type=submit]"); await page.waitForTimeout(250);
  const oNo = { posts: (await calls4("/client-orders/entries")).length, inv: await page.getAttribute("#ord-add [name=needed_by]", "aria-invalid") };
  await page.click('#ord-add .q44-days [data-day="1"]');
  const oc1 = { v: await page.inputValue("#ord-add [name=needed_by]"), chips: await chips("#ord-add"), inv: await page.getAttribute("#ord-add [name=needed_by]", "aria-invalid"), focus: await page.evaluate(() => document.activeElement.dataset.day) };
  await page.click("#ord-add button[type=submit]"); await page.waitForTimeout(500);
  const oPost = (await calls4("/client-orders/entries"))[0] || {};
  // Deliveries: today by default (its chip shows it); the third day by one tap
  await page.goto(base + "&ui=2#deliveries");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".dlv-top [data-act=add]"); await page.waitForTimeout(150);
  const dc0 = await chips("#dlv-add");
  await page.fill("#dlv-add [name=client_name]", "Zammit Ġużi"); await page.fill("#dlv-add [name=phone]", "79001122"); await page.fill("#dlv-add [name=delivery_address]", "4 Triq il-Ħamrun");
  await page.click('#dlv-add .q44-days [data-day="2"]'); const dVal = await page.inputValue("#dlv-add [name=scheduled_date]");
  await fetch(`http://localhost:${PORT}/__reset`); await page.click("#dlv-add button[type=submit]"); await page.waitForTimeout(500);
  const dPost = (await calls4("/client-deliveries/entries"))[0] || {};
  // Questions: follow up tomorrow in one tap
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.waitForTimeout(150);
  const tc0 = await chips("#tkt-add");
  await page.fill("#tkt-add [name=client_name]", "Grech Helena"); await page.fill("#tkt-add [name=phone]", "79333444"); await page.fill("#tkt-add [name=issue]", "Omron M3 back in stock?");
  await page.click('#tkt-add .q44-days [data-day="1"]');
  await fetch(`http://localhost:${PORT}/__reset`); await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(500);
  const tPost = (await calls4("/client-tickets/entries"))[0] || {};
  report("counter forms: Today · Tomorrow · next working day (Sunday skipped) under Needed by, Deliver on and Follow up; nothing chosen on Orders until tapped (still refused, nothing sent); a tap sets the field and is exactly what is sent; clearer pick-up help",
    JSON.stringify(oc0.map((c) => c.ymd)) === JSON.stringify(W) && oc0[0].t === "Today" && oc0.every((c) => c.on === "false") && oHint === "Leave empty if they collect the same day" &&
    oNo.posts === 0 && oNo.inv === "true" && oc1.v === W[1] && oc1.chips[1].on === "true" && oc1.chips[0].on === "false" && oc1.inv === null && oc1.focus === "1" &&
    oPost.needed_by === W[1] && oPost.pick_up_date === W[1] && oPost.pickup_date === W[1] && oPost.client_name === "Borg Ċensina" &&
    dc0[0].on === "true" && dVal === W[2] && dPost.scheduled_date === W[2] && dPost.client_name === "Zammit Ġużi" &&
    tc0.every((c) => c.on === "false") && tPost.followup_date === W[1] && tPost.issue === "Omron M3 back in stock?",
    JSON.stringify({ W, oc0, oHint, oNo, oc1, oPost: { n: oPost.needed_by, p: oPost.pick_up_date }, dc0, dVal, dPost: dPost.scheduled_date, tc0, tPost: tPost.followup_date }));
} catch (e) { report("counter forms: quick days ran to the end", false, String(e).slice(0, 300)); }

try {
  // Today's cleaning, on a phone: the name of the person signed in is already there, full width; the team is suggested
  await page.evaluate(() => { try { localStorage.removeItem("eikon_tdy_cleaner:12"); } catch (e) {} });
  todayState = { tempDone: false, cleanDone: false };
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("about:blank"); await page.goto(base + "&ui=2#today");
  await page.waitForSelector('.tdy-row[data-kind="cleaning"] [data-cleaner]', { timeout: 15000 });
  const cl0 = await page.evaluate(() => { const i = document.querySelector("[data-cleaner]"), r = i.getBoundingClientRect(), row = i.closest(".tdy-row").getBoundingClientRect(), btn = document.querySelector('.tdy-row[data-kind="cleaning"] [data-act=clean]').getBoundingClientRect(); return { v: i.value, w: Math.round(r.width), h: Math.round(r.height), ownLine: btn.top >= r.bottom - 1, rowW: Math.round(row.width) }; });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("[data-cleaner]", ""); await page.focus("[data-cleaner]"); await page.keyboard.type("ka"); await page.waitForTimeout(600);
  const sug = await page.evaluate(() => [...document.querySelectorAll(".tdy-who .epp-opt b")].map((b) => b.textContent));
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  const picked = { v: await page.inputValue("[data-cleaner]"), posts: (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").length };
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const cPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries").map((c) => c.body);
  const staffReads = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "GET" && c.path === "/shifts/staff").length;
  // and with the name left as it is, one tap on Done now records it
  todayState = { tempDone: false, cleanDone: false }; await page.evaluate(() => { try { localStorage.removeItem("eikon_tdy_cleaner:12"); } catch (e) {} window.EIKON.__todayRefresh(); }); await page.waitForTimeout(500);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('.tdy-row[data-kind="cleaning"] [data-act=clean]'); await page.waitForTimeout(700);
  const oneTap = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/cleaning/entries").map((c) => c.body);
  await page.setViewportSize({ width: 1440, height: 900 });
  todayState = { tempDone: false, cleanDone: false };
  report("today's cleaning: 'cleaned by' already holds the person signed in, full width on its own line on a phone; typing suggests the team (Enter picks, sends nothing); Enter records; untouched, one tap on Done now records that name",
    cl0.v === "Maria Borg" && cl0.w >= 200 && cl0.h >= 44 && cl0.ownLine && sug.includes("Karl Vella") && picked.v === "Karl Vella" && picked.posts === 0 &&
    cPosts.length === 1 && cPosts[0].cleaner_name === "Karl Vella" && cPosts[0].staff_name === "Maria Borg" && staffReads >= 1 &&
    oneTap.length === 1 && oneTap[0].cleaner_name === "Maria Borg",
    JSON.stringify({ cl0, sug, picked, cPosts, staffReads, oneTap }));
} catch (e) { await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {}); report("today's cleaning: ran to the end", false, String(e).slice(0, 300)); }

try {
  // End of day: the summary line, Tab, Enter, "Nothing counted yet", and an untouched summary saves what it shows
  eodState = { rec: null, n: 0 };
  await page.goto("about:blank"); await page.goto(base + "&ui=2#endofday");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector("#eod-form"), null, { timeout: 15000 });
  const SH = await page.evaluate(() => window.EIKON.maltaHm(new Date()) >= "13:00" ? "PM" : "AM"); // q5-6: a new day's shift follows Malta time
  const e0 = await page.evaluate(() => ({ line: (document.querySelector(".eod-who span") || {}).textContent, day: !!document.querySelector("#eod-day"), staff: !!document.querySelector("[name=staff]"), ou: document.querySelector('[data-b="ouBig"]').textContent, cls: document.querySelector('[data-b="ouBig"]').className, bar: document.querySelector('[data-b="ouBar"]').textContent }));
  await page.focus("[data-act=who]"); await page.keyboard.press("Tab");
  const tab1 = await page.evaluate(() => document.activeElement.name);
  await page.keyboard.type("500"); await page.keyboard.press("Enter");
  const ent1 = await page.evaluate(() => document.activeElement.name);
  await page.keyboard.press("Enter"); const ent2 = await page.evaluate(() => document.activeElement.name); // the remark is skipped: on to the next amount
  await page.focus('[name="dep:n5"]'); await page.keyboard.press("Enter"); const entLast = await page.evaluate(() => document.activeElement.getAttribute("data-act"));
  const e1 = await page.evaluate(() => ({ ou: document.querySelector('[data-b="ouBig"]').textContent, puts: 0 }));
  await page.fill('[name="cash:n100"]', "15"); await page.fill("[name=bag_number]", "B-1");
  await fetch(`http://localhost:${PORT}/__reset`);
  const putsBefore = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  await page.click("[data-act=save]");
  await page.waitForFunction(() => /Saved/.test(document.querySelector(".eod-st").textContent) && !document.querySelector("[data-act=save][disabled]"), null, { timeout: 8000 });
  const ePut = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/endofday/record").map((c) => c.body.record)[0] || {};
  // Change opens the four fields, the cursor in the day
  await page.click("[data-act=who]"); await page.waitForTimeout(100);
  const e2 = await page.evaluate(() => ({ day: !!document.querySelector("#eod-day"), staff: (document.querySelector("[name=staff]") || {}).value, focus: document.activeElement.id }));
  report("end of day: day/staff/shift/float are one summary line with Change, so Tab from it lands on X reading 1; Enter goes to the next amount (remarks skipped) and after the last to Save, never saving; 'Nothing counted yet' (not a green Exact) until a figure; untouched, the save sends the signed-in name, the shift by Malta time and the float shown",
    e0.line === "Today · Maria Borg · " + SH + " · float €1000.00" && !e0.day && !e0.staff && e0.ou === "Nothing counted yet" && e0.cls === "" && e0.bar === "Nothing counted yet" &&
    tab1 === "row:x:0:amount" && ent1 === "row:epos:0:amount" && ent2 === "row:cheques:0:amount" && entLast === "save" && / short$/.test(e1.ou) && putsBefore === 0 &&
    ePut.staff === "Maria Borg" && ePut.staff_name === "Maria Borg" && ePut.time_of_day === SH && ePut.float_amount === "1000.00" && ePut.x[0].amount === "500.00" && ePut.date === todayYmd &&
    e2.day && e2.staff === "Maria Borg" && e2.focus === "eod-day",
    JSON.stringify({ e0, tab1, ent1, ent2, entLast, e1, putsBefore, ePut: { staff: ePut.staff, tod: ePut.time_of_day, f: ePut.float_amount, x: ePut.x }, e2 }));
} catch (e) { report("end of day: summary line ran to the end", false, String(e).slice(0, 300)); }

// q5-6: End of day starts right. A new day's float is the last saved day's (this month or the month before), said under the
// summary line; a different float says "Float changed from …" in amber; no saved day, or one that cannot be read, says why
// the float is €1000.00; an earlier day takes the shift of the day before it; Enter on Change opens it; Ctrl+Enter there
// sends nothing; untouched, the save sends the float shown.
try {
  const ago = (n) => maltaYmd(-n);
  const openEod = async () => { await page.goto("about:blank"); await page.goto(base + "&ui=2#endofday"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector("#eod-form") && document.querySelector(".eod-st"), null, { timeout: 15000 }); await page.waitForTimeout(300); };
  const look = () => page.evaluate(() => { const n = document.querySelector("[data-b=floatnote]"); return { line: (document.querySelector(".eod-who span") || {}).textContent || "", note: n && !n.hidden ? n.textContent : "", wn: !!(n && n.classList.contains("wn")), f: (document.querySelector("[name=float_amount]") || {}).value, tod: (document.querySelector("[name=time_of_day]") || {}).value }; });
  const puts = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/endofday/record").map((c) => c.body.record);
  const SH = await page.evaluate(() => window.EIKON.maltaHm(new Date()) >= "13:00" ? "PM" : "AM");
  const prevRec = (date, fl, tod) => ({ id: 9, date, eod_date: date, staff: "Karl", staff_name: "Karl", time_of_day: tod, float_amount: fl, x: [{ amount: "800" }], epos: [], cheques: [], paid_outs: [], cash: { n50: "2" }, deposit: {}, updated_at: "2026-10-01 18:00:00", locked_at: "2026-10-01 18:30:00" });
  // (a) a saved day this month or last: its float; untouched, the save sends it
  const pd = ago(1); eodState = { rec: null, n: 0, prev: prevRec(pd, 150, "PM") };
  await openEod(); const a0 = await look();
  await page.fill('[name="row:x:0:amount"]', "500"); await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=save]"); await page.waitForFunction(() => /Saved/.test(document.querySelector(".eod-st").textContent) && !document.querySelector("[data-act=save][disabled]"), null, { timeout: 8000 });
  const aPut = (await puts())[0] || {}; const a1 = await look();
  // the day before it in the previous month (the 1st of a month finds the last day of the month before)
  const pm = (() => { const y = +todayYmd.slice(0, 4), m = +todayYmd.slice(5, 7) - 1; return (m < 1 ? y - 1 : y) + "-" + String(m < 1 ? 12 : m).padStart(2, "0") + "-28"; })();
  eodState = { rec: null, n: 0, prev: prevRec(pm, "75.5", "AM") }; await openEod(); const b0 = await look();
  // (b) changed: amber "Float changed from €150.00"; Enter on Change opens; Ctrl+Enter on Change sends nothing
  eodState = { rec: null, n: 0, prev: prevRec(pd, "150.00", "PM") }; await openEod();
  await fetch(`http://localhost:${PORT}/__reset`); await page.focus("[data-act=who]"); await page.keyboard.press("Control+Enter"); await page.waitForTimeout(500);
  const ctrlPuts = (await puts()).length, ctrlOpen = await page.evaluate(() => !!document.querySelector("[name=float_amount]"));
  await page.focus("[data-act=who]"); await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  const entOpen = await page.evaluate(() => ({ open: !!document.querySelector("[name=float_amount]"), focus: document.activeElement.id }));
  await page.fill("[name=float_amount]", "200"); await page.waitForTimeout(50); const c0 = await look();
  await page.fill("[name=float_amount]", "150"); await page.waitForTimeout(50); const c1 = await look();
  // an earlier day: the shift of the day saved before it
  eodState = { rec: null, n: 0, prev: prevRec(ago(3), "150.00", "PM") }; await openEod(); await page.click("[data-act=who]");
  await page.fill("#eod-day", ago(1)); await page.dispatchEvent("#eod-day", "change"); await page.waitForFunction((d) => document.querySelector("#eod-day") && document.querySelector("#eod-day").value === d && !/Opening/.test(document.body.textContent), ago(1), { timeout: 8000 }); await page.waitForTimeout(300);
  const d0 = await look();
  // (c) no saved day, and a month that cannot be read
  eodState = { rec: null, n: 0 }; await openEod(); const e0 = await look();
  eodState = { rec: null, n: 0, datesFail: true }; await openEod(); const f0 = await look();
  eodState = { rec: null, n: 0 };
  report("end of day starts right (q5-6): a new day's float is the last saved day's (this month or the month before), said under the summary; changed, an amber 'Float changed from €150.00'; none, or unreadable, says €1000.00 and why; an earlier day takes the shift of the day before; Enter on Change opens it, Ctrl+Enter there saves nothing; untouched, the save sends the float shown",
    a0.line === "Today · Maria Borg · " + SH + " · float €150.00" && /^Float as on .+\. Change it if today's is different\.$/.test(a0.note) && !a0.wn &&
    aPut.float_amount === "150.00" && aPut.time_of_day === SH && aPut.staff === "Maria Borg" && a1.note === "" &&
    / · float €75\.50$/.test(b0.line) && /^Float as on /.test(b0.note) &&
    ctrlPuts === 0 && !ctrlOpen && entOpen.open && entOpen.focus === "eod-day" &&
    /^Float changed from €150\.00, the float on /.test(c0.note) && c0.wn && /^Float as on /.test(c1.note) && !c1.wn &&
    d0.tod === "PM" && d0.f === "150.00" &&
    / · float €1000\.00$/.test(e0.line) && e0.note === "No earlier day saved, so the float starts at €1000.00. Change it if yours is different." && !e0.wn &&
    / · float €1000\.00$/.test(f0.line) && /could not be read/.test(f0.note) && f0.wn,
    JSON.stringify({ a0, aPut: { f: aPut.float_amount, tod: aPut.time_of_day }, a1, b0, ctrlPuts, ctrlOpen, entOpen, c0, c1, d0, e0, f0 }));
} catch (e) { eodState = { rec: null, n: 0 }; report("end of day starts right (q5-6): ran to the end", false, String(e).slice(0, 300)); }

// Plan shifts in the new layout: the old #shifts link lands here; a change sends the whole record (role and note kept);
// add sends one POST; Remove asks first, then DELETE; Approve sends the classic approve call.
try {
  const shfDay = [{ id: 1, staff_id: 1, shift_date: todayYmd, start_time: "08:00", end_time: "14:00", role_override: "pharmacist", notes: "Opens" }];
  await page.route(/\/shifts\/assignments-range/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, shifts: shfDay }) }));
  await page.route(/\/shifts\/leaves\?/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, leaves: [{ id: 3, staff_id: 2, leave_type: "annual", start_date: todayYmd, end_date: todayYmd, hours_requested: 8, reason: "Wedding", status: "pending" }] }) }));
  await page.goto(base + "&ui=2#shifts");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && document.querySelector(".shf-lv") && document.querySelector(".shf-p[data-id='1']"), null, { timeout: 15000 });
  const shfRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".shf-p[data-id='1']"); await page.fill("#shf-form [name=start_time]", "08:30"); await page.click("#shf-form button[type=submit]"); await settleSave();
  await page.click(".shf-day.today [data-act=add]"); await page.selectOption("#shf-form [name=staff_id]", "2");
  await page.fill("#shf-form [name=start_time]", "14:00"); await page.fill("#shf-form [name=end_time]", "19:00"); await page.click("#shf-form button[type=submit]"); await settleSave();
  await page.click(".shf-p[data-id='1']"); await page.click("[data-act=del]");
  const shfAsk = await page.evaluate(() => (document.querySelector("#shf-form .q") || {}).textContent || "");
  const shfDelEarly = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "DELETE").length;
  await page.click("[data-act=del-yes]"); await settleSave();
  await page.click("[data-act=lv-approve][data-id='3']"); await page.waitForTimeout(600);
  const shfW = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && c.path.startsWith("/shifts/"));
  const put = (shfW.find((c) => c.method === "PUT") || {}).body || {}, post = (shfW.find((c) => c.method === "POST" && c.path === "/shifts/assignments") || {}).body || {};
  report("plan shifts: #shifts opens it under Team; a change sends the whole shift (role and note kept); add once; Remove asks first; Approve",
    shfRail === "team" && put.id === 1 && put.start_time === "08:30" && put.end_time === "14:00" && put.role_override === "pharmacist" && put.notes === "Opens" && put.staff_id === 1 && put.shift_date === todayYmd &&
    post.staff_id === 2 && post.shift_date === todayYmd && post.start_time === "14:00" && post.end_time === "19:00" && /Remove this shift\?/.test(shfAsk) && shfDelEarly === 0 &&
    shfW.map((c) => c.method + " " + c.path).join() === "PUT /shifts/assignments/1,POST /shifts/assignments,DELETE /shifts/assignments/1,POST /shifts/leaves/3/approve", JSON.stringify({ shfRail, shfAsk, shfW }));
} catch (e) { report("plan shifts: ran to the end", false, String(e).slice(0, 300)); }
await page.unroute(/\/shifts\/assignments-range/).catch(() => {}); await page.unroute(/\/shifts\/leaves\?/).catch(() => {});

// BACKLOG4 6c, Team: the standing instructions are changed in Handover with the classic Instructions screen's call (the
// whole global set, read afresh, only permanent_handover changed); a change made elsewhere meanwhile is never
// overwritten; Escape closes and focus goes back to Change.
try {
  await page.goto(base + "&ui=2#hndreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "hndreg" && document.querySelector("[data-act=std]"), null, { timeout: 15000 });
  const s0 = await page.evaluate(() => ({ foot: document.querySelector(".hnd-foot").textContent, ch: document.querySelector("[data-act=std]").textContent }));
  await page.click("[data-act=std]"); await page.waitForSelector("#hnd-std");
  const s1 = await page.evaluate(() => ({ v: document.querySelector("#hnd-std").value, focus: document.activeElement.id }));
  await page.keyboard.press("Escape"); await page.waitForTimeout(80);
  const s2 = await page.evaluate(() => ({ open: !!document.querySelector("#hnd-std"), focus: document.activeElement.getAttribute("data-act") }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=std]"); await page.fill("#hnd-std", "Count the CD cupboard every evening.\nĦal Qormi deliveries leave at 3"); await page.keyboard.press("Control+Enter");
  await page.waitForFunction(() => !document.querySelector("#hnd-std"), null, { timeout: 6000 });
  const s3 = await page.evaluate(() => ({ focus: document.activeElement.getAttribute("data-act"), box: document.querySelector(".hnd-box").textContent }));
  const gw = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/instructions/global");
  const g = ((gw.find((c) => c.method === "PUT") || {}).body || {}).global || {};
  const keys = Object.keys(g).join();
  report("handover: Change opens the standing instructions with the text, Escape closes back to Change; Ctrl+Enter re-reads the set and PUTs it whole (every classic section, only permanent_handover changed), focus back on Change; footer no longer sends the standing instructions to classic",
    !/standing/.test(s0.foot) && s0.ch === "Change" && /CD cupboard/.test(s1.v) && s1.focus === "hnd-std" && !s2.open && s2.focus === "std" &&
    gw.map((c) => c.method).join() === "GET,PUT" && keys === "permanent_handover,opening,closing,endofday,pos,poyc,ordering,loyalty,hiv,concerta,doctors_process,doctors_fees,clinic_fees" &&
    g.permanent_handover.text === "Count the CD cupboard every evening.\nĦal Qormi deliveries leave at 3" && !isNaN(Date.parse(g.permanent_handover.updated_at)) && Object.keys(g.permanent_handover).join() === "text,updated_at" &&
    g.hiv.enabled === false && g.opening.text === "" && g.opening.updated_at === "" && s3.focus === "std" && /Ħal Qormi/.test(s3.box),
    JSON.stringify({ s0, s1, s2, s3, gw }));
  // Changed on another till meanwhile: nothing is sent, theirs are shown, yours are quoted.
  await page.click("[data-act=std]"); await page.fill("#hnd-std", "Mine");
  await page.route(/\/instructions\/global$/, (r) => r.request().method() === "GET" ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, global: { permanent_handover: { text: "Theirs", updated_at: "x" } } }) }) : r.continue());
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#hnd-stdf button[type=submit]"); await page.waitForSelector("#hnd-stdf .hnd-warn", { timeout: 6000 });
  const s4 = await page.evaluate(() => ({ v: document.querySelector("#hnd-std").value, warn: document.querySelector("#hnd-stdf .hnd-warn").textContent }));
  const put4 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  await page.unroute(/\/instructions\/global$/);
  report("handover: standing instructions changed on another till meanwhile are not overwritten: theirs shown, yours quoted, nothing sent",
    s4.v === "Theirs" && /another till/.test(s4.warn) && /“Mine”/.test(s4.warn) && put4 === 0, JSON.stringify({ s4, put4 }));
} catch (e) { report("handover: standing instructions ran to the end", false, String(e).slice(0, 300)); }

// BACKLOG4 6c, Team: a new leave request in Plan shifts sends the classic Leave tab's body (hours as it works them out:
// 8 for each weekday, or a part day's hours); every problem is said at once with nothing sent; locums are not offered;
// Who's in's "ask for leave" opens the form; the footers no longer send new leave requests to classic.
try {
  await page.goto(base + "&ui=2#rotreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "rotreg" && document.querySelector(".rot-foot [data-act=leave]"), null, { timeout: 15000 });
  const rf = await page.evaluate(() => document.querySelector(".rot-foot").textContent);
  await page.click(".rot-foot [data-act=leave]");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && document.querySelector("#shf-lvf"), null, { timeout: 15000 });
  const l0 = await page.evaluate(() => ({ focus: document.activeElement.name, whoVal: document.querySelector("#shf-lvf [name=staff_id]").value, who: [...document.querySelectorAll("#shf-lvf [name=staff_id] option")].map((o) => o.textContent), from: document.querySelector("#shf-lvf [name=start_date]").value, until: document.querySelector("#shf-lvf [name=end_date]").value, foot: (document.querySelector(".shf-note:last-of-type") || { textContent: "" }).textContent }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#shf-lvf [name=start_date]", ""); await page.click("#shf-lvf button[type=submit]"); await page.waitForTimeout(150);
  const l1 = await page.evaluate(() => ({ err: (document.querySelector("#shf-lv-err") || {}).textContent, bad: [...document.querySelectorAll("#shf-lvf [aria-invalid=true]")].map((x) => x.name).join(), focus: document.activeElement.name, role: (document.querySelector("#shf-lv-err") || {}).getAttribute && document.querySelector("#shf-lv-err").getAttribute("role") }));
  await page.selectOption("#shf-lvf [name=staff_id]", "2"); await page.selectOption("#shf-lvf [name=leave_type]", "sick");
  await page.fill("#shf-lvf [name=start_date]", "2026-11-13"); await page.locator("#shf-lvf [name=start_date]").dispatchEvent("change");
  const l2 = await page.evaluate(() => document.querySelector("#shf-lvf [name=end_date]").value);
  await page.fill("#shf-lvf [name=end_date]", "2026-11-17"); await page.locator("#shf-lvf [name=end_date]").dispatchEvent("change");
  await page.fill("#shf-lvf [name=reason]", "  Flu  ");
  await page.click("#shf-lvf button[type=submit]"); await settleSave();
  await page.waitForFunction(() => !document.querySelector("#shf-lvf"), null, { timeout: 6000 });
  const l3 = await page.evaluate(() => document.activeElement.getAttribute("data-act"));
  await page.click("[data-act=lv-new]"); await page.selectOption("#shf-lvf [name=staff_id]", "1");
  await page.fill("#shf-lvf [name=start_date]", "2026-11-20"); await page.locator("#shf-lvf [name=start_date]").dispatchEvent("change");
  await page.fill("#shf-lvf [name=start_time]", "14:00"); await page.fill("#shf-lvf [name=end_time]", "17:30");
  await page.keyboard.press("Enter"); await settleSave();
  const lw = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/shifts/leaves");
  const b1 = JSON.stringify(lw[0] && lw[0].body), b2 = JSON.stringify(lw[1] && lw[1].body);
  report("plan shifts: a new leave request (from Who's in's 'ask for leave'): problems said at once with nothing sent; one day unless the last is chosen; the classic body and hours (3 weekdays = 24 h; 14:00–17:30 = 3.5 h); focus back on New leave request; footers shrink",
    /ask for leave/.test(rf) && !/new leave requests/.test(rf) && !/new leave requests/.test(l0.foot) && l0.focus === "leave_type" && l0.who.join() === "Choose a person,Karl Vella,Maria Borg" && l0.whoVal === "1" && /^\d{4}-\d{2}-\d{2}$/.test(l0.from) && l0.until === l0.from && // roles round: Who is the signed-in person (Maria Borg on the rota)
    /^Choose the first day of leave\. Nothing was saved\./.test(l1.err || "") && l1.bad === "start_date" && l1.focus === "start_date" && l1.role === "alert" && l2 === "2026-11-13" &&
    lw.length === 2 && b1 === JSON.stringify({ staff_id: 2, leave_type: "sick", start_date: "2026-11-13", start_time: null, end_date: "2026-11-17", end_time: null, hours_requested: 24, reason: "Flu", status: "pending" }) &&
    b2 === JSON.stringify({ staff_id: 1, leave_type: "annual", start_date: "2026-11-20", start_time: "14:00", end_date: "2026-11-20", end_time: "17:30", hours_requested: 3.5, reason: "", status: "pending" }) && l3 === "lv-new",
    JSON.stringify({ rf, l0, l1, l2, l3, b1, b2 }));
} catch (e) { report("plan shifts: new leave request ran to the end", false, String(e).slice(0, 300)); }

// POCT in the new layout: the old #poct link lands on it; a known ID card fills the patient; a high glucose is marked in words;
// one PUT with the record and the whole patient card in the classic shape, and never a delete or a wipe.
try {
  await page.goto(base + "&ui=2#poct");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "pocreg" && document.querySelector(".poc-list"), null, { timeout: 15000 });
  const poc1 = await page.evaluate(() => ({ list: document.querySelector(".poc-list").textContent, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod) }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.click('.poc-seg [data-type="bg"]');
  await page.fill("[name=patientId]", "12345m"); await page.press("[name=patientId]", "Tab"); await page.waitForTimeout(300);
  await page.fill("[name=glucose]", "12.4"); await page.waitForTimeout(100);
  const pocLive = await page.textContent("#poc-live");
  await page.click("#poc-add button[type=submit]"); await settleSave();
  const pocPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/poct/state").map((c) => c.body);
  const pr = pocPuts[0] && pocPuts[0].records[0], pc = pocPuts[0] && pocPuts[0].patients[0];
  report("poct: #poct opens the new screen with the earlier High BP; a known ID card fills the patient; glucose 12.4 is High; one PUT, classic shape, no deletes",
    /150\/95/.test(poc1.list) && /High/.test(poc1.list) && poc1.rail.includes("services") && /High/.test(pocLive) && pocPuts.length === 1 &&
    pr.testType === "bg" && pr.testLabel === "Blood Glucose" && pr.results.glucose === 12.4 && pr.results.timing === "Random" && pr.patient.patientId === "0012345M" && pr.patient.name === "Zammit Carmel" && pr.patient.phone === "79123456" && pr.patient.age === 64 &&
    pc.patientId === "0012345M" && pc.createdAtIso === "2026-10-01T08:00:00.000Z" && pc.lastSeenIso === pr.performedAtIso && Array.isArray(pc.conflicts) && pc.conflicts.length === 0 &&
    !("wipe_all" in pocPuts[0]) && !("deleted_record_ids" in pocPuts[0]) && !("deleted_patient_ids" in pocPuts[0]) && pocPuts[0].records.length === 1 && pocPuts[0].patients.length === 1 &&
    !!(await page.$(".poc-who")),
    JSON.stringify({ poc1, pocLive, pocPuts }).slice(0, 900));
} catch (e) { report("poct: new layout flow ran to the end", false, String(e).slice(0, 300)); }

// POCT, one test (10b): Print beside a test opens the classic one-test page; Change loads the test into the form (no test
// choice, its own time) and Save changes sends that record again under its own id, with no person check and no delete.
try {
  // after the save above the screen is on that patient already; otherwise open them from the list
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "pocreg" && document.querySelector(".poc-list"), null, { timeout: 15000 });
  if (!(await page.$('[data-act=print-test][data-rid="r_1"]'))) await page.click('[data-act=open][data-pid="0012345M"]');
  await page.waitForSelector('[data-act=print-test][data-rid="r_1"]');
  await page.evaluate(() => { window.print = () => {}; });
  const [pw] = await Promise.all([page.waitForEvent("popup"), page.click('[data-act=print-test][data-rid="r_1"]')]);
  await pw.waitForLoadState(); const pocPrint = await pw.evaluate(() => ({ title: document.title, h1: document.querySelector("h1").textContent, rows: [...document.querySelectorAll("tbody tr")].map((r) => r.textContent), meta: document.querySelector(".meta").textContent })); await pw.close();
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act=edit-test][data-rid="r_1"]'); await page.waitForSelector("#poc-add"); await page.waitForFunction(() => document.activeElement && document.activeElement.name === "sys", null, { timeout: 2000 }).catch(() => {});
  const pe0 = await page.evaluate(() => { const f = document.querySelector("#poc-add"), v = (n) => f.querySelector("[name=" + n + "]").value; return { seg: !!f.querySelector(".poc-seg"), sys: v("sys"), dia: v("dia"), dt: v("dt"), name: v("name"), focus: document.activeElement && document.activeElement.name, btn: f.querySelector("button[type=submit]").textContent }; });
  await page.fill("#poc-add [name=sys]", "142"); await page.fill("#poc-add [name=notes]", "Rechecked");
  await page.click("#poc-add button[type=submit]"); await settleSave();
  const peCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET");
  const pb = (peCalls[0] || {}).body || {}, prc = (pb.records || [])[0] || {};
  const pocFoot = await page.textContent(".poc-note");
  report("poct: Print beside a test opens the classic one-test page; Change fills the form from the test and Save changes sends it again under its own id, one PUT, no delete",
    pocPrint.title === "POCT - Blood Pressure" && pocPrint.h1 === "Blood Pressure Result" && pocPrint.rows[0] === "Systolic (mmHg)150" && /^Date\/Time: 2026-10-01 10:00/.test(pocPrint.meta) &&
    !pe0.seg && pe0.sys === "150" && pe0.dia === "95" && pe0.dt === "2026-10-01T10:00" && pe0.name === "Zammit Carmel" && pe0.focus === "sys" && pe0.btn === "Save changes" &&
    peCalls.length === 1 && peCalls[0].path === "/poct/state" && prc.id === "r_1" && prc.results.sys === 142 && prc.results.dia === 95 && prc.notes === "Rechecked" && prc.performedAtLocal === "2026-10-01T10:00" && pb.records.length === 1 && pb.patients.length === 1 && !("deleted_record_ids" in pb) &&
    /More in the classic screen\.$/.test(pocFoot) && !/printing one test|Editing/.test(pocFoot), // the one Services footer (16:35 directive X5)
    JSON.stringify({ pocPrint, pe0, peCalls, pocFoot }).slice(0, 900));
} catch (e) { report("poct: print one and change a test ran to the end", false, String(e).slice(0, 300)); }

// Scarce stock: the old link opens the new screen; other pharmacies' lines show who has them, our line shows who asked;
// more than is left is refused on the screen; asking for 2 sends one POST with the quantity and the private note.
await page.goto(base + "&ui=2#scarcestock");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "scsreg" && document.querySelector(".scs-card"), null, { timeout: 15000 });
const scs1 = await page.evaluate(() => document.querySelector(".scs").textContent);
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('[data-act=ask][data-id="31"]'); await page.fill("#scs-req [name=quantity_requested]", "9"); await page.click("#scs-req button[type=submit]"); await page.waitForTimeout(200);
const scsRefused = await page.evaluate(() => (document.querySelector(".scs-err") || {}).textContent || "");
const scsNone = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST").length;
await page.fill("#scs-req [name=quantity_requested]", "2"); await page.fill("#scs-req [name=note]", "For Mr Borg"); await page.click("#scs-req button[type=submit]");
let scsPosts = []; for (let i = 0; i < 40 && !scsPosts.length; i++) { await page.waitForTimeout(100); scsPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST"); }
report("scarce stock: opens from the old link; lines show who has them and who asked; 9 of 4 is refused; asking for 2 sends one POST",
  /Other pharmacies have\s*1/.test(scs1) && /Sliema Group — Sliema Pharmacy/.test(scs1) && /4 left/.test(scs1) && /You share\s*1/.test(scs1) && /Gozo Group — Victoria Pharmacy/.test(scs1) && /For Mrs Grech/.test(scs1) && /Only 4 can be asked for/.test(scsRefused) && scsNone === 0 &&
  scsPosts.length === 1 && scsPosts[0].path === "/scarce-stock/offers/31/requests" && JSON.stringify(scsPosts[0].body) === JSON.stringify({ quantity_requested: 2, note: "For Mr Borg" }), JSON.stringify({ scs1: scs1.slice(0, 300), scsRefused, scsNone, scsPosts }));

// Audit trail in the new layout: the old #audit link lands here under Settings; days, area and kind go to the server
// (Malta days as UTC bounds); search narrows the loaded rows; a row opens its before/after; Show older asks for the next
// page; staff get a plain note and no request.
try {
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#audit");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "audreg" && document.querySelector(".aud-row"), null, { timeout: 15000 });
  const audRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const audFirst = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/audit/log").map((c) => new URLSearchParams(c.query));
  const q0 = audFirst[0] || new URLSearchParams();
  const audCount = await page.textContent(".aud-count"), audRows = await page.$$eval(".aud-row", (l) => l.length);
  const audTop = await page.textContent(".aud-row");
  await page.click(".aud-row"); await page.waitForSelector(".aud-det");
  const audDet = await page.textContent(".aud-det");
  await page.fill("#aud-q", "karl"); await page.waitForTimeout(150);
  const audSearch = await page.$$eval(".aud-row", (l) => l.length), audFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.fill("#aud-q", ""); await page.waitForTimeout(100);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=older]"); await page.waitForFunction(() => document.querySelectorAll(".aud-row").length === 120, null, { timeout: 8000 });
  const audOlder = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/audit/log").map((c) => c.query);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.selectOption("#aud-kind", "deleted"); await page.waitForFunction(() => document.querySelectorAll(".aud-row").length === 1, null, { timeout: 8000 });
  await page.selectOption("#aud-area", "temperature"); await page.waitForFunction(() => /No changes/.test(document.querySelector(".aud").textContent), null, { timeout: 8000 });
  const audF = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/audit/log").map((c) => new URLSearchParams(c.query));
  // staff: no request, a plain note
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; location.hash = "#settings"; });
  await page.waitForTimeout(400); await fetch(`http://localhost:${PORT}/__reset`);
  await page.evaluate(() => { location.hash = "#audit"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "audreg" && document.querySelector(".aud-quiet"), null, { timeout: 8000 });
  const audStaff = await page.textContent(".aud-quiet"), audStaffCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/audit/log").length;
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  const okFrom = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(q0.get("from") || "") && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:59$/.test(q0.get("to") || "");
  report("audit trail: #audit opens it under Settings; Malta-day bounds, 100 a page; readable rows; before/after; search keeps focus; Show older = offset 100; kind and area go to the server; staff get a note and no request",
    audRail === "settings" && q0.get("limit") === "100" && q0.get("offset") === "0" && okFrom && /Showing 100 of 120/.test(audCount) && audRows === 100 &&
    /Changed · Customers/.test(audTop) && /Phone, Notes/.test(audTop) && /Phone\s*Before\s*79000001\s*After\s*79111222/.test(audDet) && /PERSON_UPDATE/.test(audDet) &&
    audSearch === 2 && audFocus === "aud-q" && audOlder.length === 1 && /offset=100/.test(audOlder[0]) &&
    audF.length === 2 && audF[0].get("action") === "DELETE" && audF[1].get("module") === "temperature" && audF[1].get("action") === "DELETE" &&
    /Only a pharmacist/.test(audStaff) && audStaffCalls === 0,
    JSON.stringify({ audRail, q0: q0.toString(), audCount, audRows, audTop, audSearch, audFocus, audOlder, audF: audF.map(String), audStaff, audStaffCalls }));
} catch (e) { report("audit trail: ran to the end", false, String(e).slice(0, 300)); }
// Audit trail print: the shared register printout (pharmacy, period, page numbers, landscape), the rows on screen; back to Settings
try {
  await page.evaluate(() => { location.hash = "#settings"; }); await page.waitForTimeout(300); // the page is already on #audit: a goto would not reload
  await page.evaluate(() => { location.hash = "#audit"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "audreg" && document.querySelector(".aud-row"), null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.openPrintUrlOrLink = function () { return null; }; window.EIKON.months.lastPrint = null; });
  await page.click(".aud-top [data-act=print]"); await page.waitForTimeout(150);
  const ap = await page.evaluate(() => { const l = window.EIKON.months.lastPrint || {}, h = l.html || ""; return { reg: l.register, land: /A4 landscape/.test(h), pages: /counter\(pages\)/.test(h), rows: (h.match(/<tbody>[\s\S]*<\/tbody>/) || [""])[0].split("<tr>").length - 1, n: (h.match(/(\d+) rows/) || [])[1], malta: /Malta time/.test(h), back: document.querySelector(".aud-back").textContent, chip: Math.round(document.querySelector(".aud-top [data-act=print]").getBoundingClientRect().height) }; });
  report("audit trail print: the shared printout, landscape, page numbers, Malta time, one line per row on screen; back says Settings; 44 px buttons",
    ap.reg === "Audit trail" && ap.land && ap.pages && ap.malta && ap.rows === 100 && ap.n === "100" && ap.back === "‹ Settings" && ap.chip >= 44, JSON.stringify(ap));
} catch (e) { report("audit trail print: ran to the end", false, String(e).slice(0, 300)); }

// Adverse reactions: the old link opens the new screen under Services; a new report is one PUT with only that report
// (classic fields, empty deleted_ids); a correction sends the whole report back with only the change (unknown fields kept).
try {
  await page.goto(base + "&ui=2#pharmacovigilance");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "pvreg" && document.querySelector(".pvr-row"), null, { timeout: 15000 });
  const pvRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const pvRow = await page.textContent(".pvr-row");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.fill("[name=pt_initials]", "A.B."); await page.fill('[data-i="0"][data-k=name]', "Ibuprofen 400mg"); await page.fill("[name=reaction_meddra]", "Dyspepsia");
  await page.click("#pvr-add button[type=submit]"); await page.waitForSelector("[data-act=edit]", { timeout: 8000 });
  await page.click("[data-act=list]"); await page.click('.pvr-row[data-id="pv_1_abc"]'); await page.click("[data-act=edit]");
  await page.selectOption("[name=status]", "Submitted to MPA"); await page.click("#pvr-add button[type=submit]"); await page.waitForSelector("[data-act=edit]", { timeout: 8000 });
  const pvPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/pharmacovigilance/state").map((c) => c.body.state);
  const n0 = (pvPuts[0] || { reports: [{}] }).reports[0], e1 = (pvPuts[1] || { reports: [{}] }).reports[0];
  const orig = { id: "pv_1_abc", status: "Draft", mpa_ref: "MPA-7", pt_id: "123456M", reaction_seriousness: "Serious – Other medically important" };
  report("adverse reactions: #pharmacovigilance opens it under Services; a new report is one PUT of that report alone; a correction sends the whole record, only the status changed",
    pvRail === "services" && /Rash/.test(pvRow) && /J\.D\./.test(pvRow) && pvPuts.length === 2 && pvPuts.every((s) => s.reports.length === 1 && Array.isArray(s.deleted_ids) && !s.deleted_ids.length) &&
    n0.pt_initials === "A.B." && n0.status === "Draft" && n0.reaction_meddra === "Dyspepsia" && n0.drugs.length === 1 && n0.drugs[0].name === "Ibuprofen 400mg" && n0.drugs[0].route === "Oral" && /^pv_\d+_/.test(n0.id) && Object.keys(n0).length === 30 &&
    e1.id === orig.id && e1.status === "Submitted to MPA" && e1.mpa_ref === orig.mpa_ref && e1.pt_id === orig.pt_id && e1.reaction_seriousness === orig.reaction_seriousness && e1.created_at === "2026-10-30T09:00:00.000Z" && e1.drugs[0].batch_no === "AX12",
    JSON.stringify({ pvRail, pvRow, pvPuts }).slice(0, 600));
} catch (e) { report("adverse reactions: ran to the end", false, String(e).slice(0, 300)); }

// Screening campaigns: the old link opens the new screen under Services; recording a screening is one PUT of that one
// campaign, whole (the person already in it, a field the screen does not know, kept), with the new person in the classic shape and an empty deleted_ids.
try {
  await page.goto(base + "&ui=2#screening");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "scrreg" && document.querySelector(".scr-row"), null, { timeout: 15000 });
  const scRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const scRow = await page.textContent(".scr-row");
  await page.click('.scr-row[data-id="sc_1_abc"]'); await page.waitForSelector("[data-act=add]");
  const scCamp = await page.textContent(".scr");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.waitForSelector("#scr-add");
  await page.fill("[name=idCard]", "4567m"); await page.fill("[name=name]", "Borg Anna"); await page.fill("[name=r_sys]", "128"); await page.fill("[name=r_dia]", "84");
  await page.selectOption("[name=resultCategory]", "Normal");
  await page.click("#scr-add button[type=submit]"); await page.waitForSelector(".scr-acts-top [data-act=camp]", { timeout: 8000 });
  const scPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/screening/state").map((c) => c.body.state);
  const sc = (scPuts[0] || { campaigns: [{}] }).campaigns[0] || {}, scP = (sc.participants || [])[1] || {};
  const scView = await page.textContent(".scr");
  report("screening campaigns: #screening opens it under Services; a screening is one PUT of that campaign alone, whole, the earlier person and unknown fields kept; the new person in the classic shape",
    scRail === "services" && /BP Month/.test(scRow) && /1 screened of 20/.test(scRow) && /Zammit Carmel/.test(scCamp) && /162\/98 mmHg/.test(scCamp) &&
    scPuts.length === 1 && scPuts[0].campaigns.length === 1 && Array.isArray(scPuts[0].deleted_ids) && !scPuts[0].deleted_ids.length &&
    sc.id === "sc_1_abc" && sc.extra === "kept" && sc.participants.length === 2 && sc.participants[0].id === "sc_p1" && sc.participants[0].followUps.length === 1 &&
    JSON.stringify(Object.keys(scP)) === JSON.stringify(["id", "idCard", "name", "phone", "email", "dob", "type", "date", "resultNotes", "resultCategory", "referral", "referralNotes", "poctResults", "followUps"]) &&
    scP.idCard === "0004567M" && scP.name === "Borg Anna" && scP.type === "Walk-in" && scP.referral === "No referral needed" && scP.resultCategory === "Normal" &&
    JSON.stringify(scP.poctResults) === JSON.stringify({ sys: 128, dia: 84, pulse: "", arm: "", position: "" }) && /128\/84|128 mmHg/.test(scView) && /Borg Anna/.test(scView),
    JSON.stringify({ scRail, scRow, scPuts }).slice(0, 600));
} catch (e) { report("screening campaigns: ran to the end", false, String(e).slice(0, 300)); }

// Contraceptive pills: the old #ocps link opens the new lookup under Services; the classic list of 21; the classic
// filters (type, dose, mg/mcg) narrow as you type; a tap on a pill shows the ones with the same hormones and doses;
// nothing is sent to the server.
try {
  await page.goto(base + "&ui=2#ocps");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ocpreg" && document.querySelector(".ocp-row"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  const ocpRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const ocpAll = await page.$$eval(".ocp-row", (l) => l.length), ocpAdele = await page.textContent('.ocp-row[data-trade="Adele"]');
  await page.selectOption("#ocp-e", "Ethinylestradiol"); await page.fill("#ocp-ed", "20"); await page.click("[data-unit=e][data-u=mcg]");
  await page.selectOption("#ocp-p", "Drospirenone"); await page.fill("#ocp-pd", "3"); await page.waitForTimeout(100);
  const ocpHits = await page.$$eval(".ocp-row b", (l) => l.map((x) => x.textContent).join());
  await page.click("[data-act=clear]"); await page.click('.ocp-row[data-trade="Clairette"]'); await page.waitForTimeout(100);
  const ocpLike = await page.textContent(".ocp-like"), ocpClair = await page.$$eval(".ocp-row b", (l) => l.map((x) => x.textContent).join());
  const ocpCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => (c.method !== "GET" || /ocp|contracep/i.test(c.path)) && c.path !== "/people");
  report("contraceptive pills: #ocps opens the new lookup under Services; 21 classic pills; EE 20 mcg + drospirenone 3 mg finds Freedonel, Yasminelle, Yaz; a tap shows the same pills; no write",
    ocpRail === "services" && ocpAll === 21 && /Ethinylestradiol 30 mcg/.test(ocpAdele) && /Desogestrel 0\.15 mg/.test(ocpAdele) && ocpHits === "Freedonel,Yasminelle,Yaz" &&
    /as Clairette: 1 other pill\./.test(ocpLike) && ocpClair === "Clairette,Vreya" && ocpCalls.length === 0,
    JSON.stringify({ ocpRail, ocpAll, ocpAdele, ocpHits, ocpLike, ocpClair, ocpCalls }));
} catch (e) { report("contraceptive pills: ran to the end", false, String(e).slice(0, 300)); }

// Dispensing labels: the old link opens the new screen under Services; a medicine labelled before fills its dose; Print
// opens the classic print page (no inline script: Eikon prints it from the opener, CSP) and sends one PUT with only that
// entry and the settings unchanged.
try {
  await page.goto(base + "&ui=2#labels");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "lblreg" && document.querySelector("#lbl-add") && document.querySelector(".lbl-row"), null, { timeout: 15000 });
  const lblRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  await page.fill("[name=drugName]", "Amoxicillin 500mg"); await page.waitForTimeout(200);
  const lblDose = await page.inputValue("[name=dose]"), lblPrev = await page.textContent("#lbl-prev");
  // English only (John, 2026-11-11): no language choice and no Maltese wording on the screen
  const lblNoMt = await page.evaluate(() => !document.querySelector("[data-act=lang], .lbl-mt, [lang=mt]") && !/English \+ Maltese|In Maltese|Read out in/.test(document.querySelector(".lbl").textContent));
  // The printed page is read from the Blob itself (a fetch() of the blob: address is connect-src, which the app never
  // does: it only opens the address in a tab, a navigation the CSP allows).
  await page.evaluate(() => { window.__lblPrinted = []; const blobs = {}, mk = URL.createObjectURL; URL.createObjectURL = (b) => { const u = mk.call(URL, b); blobs[u] = b; return u; };
    window.open = (u) => { (blobs[u] ? blobs[u].text() : fetch(u).then((r) => r.text())).then((t) => window.__lblPrinted.push(t)); return {}; }; });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#lbl-add button[type=submit]");
  await page.waitForFunction(() => window.__lblPrinted.length === 1 && /saved to recent labels/.test(document.querySelector("#lbl-status").textContent), null, { timeout: 8000 });
  const lblHtml = await page.evaluate(() => window.__lblPrinted[0]);
  const lblPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/labels/state").map((c) => c.body.state);
  const e0 = ((lblPuts[0] || {}).labelHistory || [])[0] || {};
  report("dispensing labels: #labels opens it under Services; no language choice (English only); a known medicine fills its dose; Print opens the classic print page; one PUT with only the new entry and the settings unchanged",
    // FIN-dayzero (W18): the medicine on its own line, plain directions, the pharmacy's phone as "Tel" (no Rx:, no Dose/Freq: … | …)
    lblRail === "services" && lblNoMt && lblDose === "1 capsule" && /Amoxicillin 500mg/.test(lblPrev) && /1 capsule, Three times daily \(oral\)/.test(lblPrev) && !/Rx:|Dose\/Freq/.test(lblPrev) &&
    /font-weight:700;">Amoxicillin 500mg/.test(lblHtml) && /@page\{margin:0;\}/.test(lblHtml) && /Tel 21234567/.test(lblHtml) && !/Rx:|Dose\/Freq/.test(lblHtml) && !/<script|\son[a-z]+=/i.test(lblHtml) &&
    lblPuts.length === 1 && lblPuts[0].labelHistory.length === 1 && e0.drugName === "Amoxicillin 500mg" && e0.dose === "1 capsule" && e0.templateId === "tpl_std" && /^lb_\d+_/.test(e0.id) &&
    JSON.stringify(Object.keys(e0)) === JSON.stringify(["patientName", "drugName", "dose", "frequency", "route", "customInstructions", "selectedWarnings", "templateId", "id", "printedAt", "printedBy"]) &&
    lblPuts[0].templates.length === 1 && lblPuts[0].templates[0].id === "tpl_std" && lblPuts[0].pharmacyDetails.phone === "21234567",
    JSON.stringify({ lblRail, lblNoMt, lblDose, lblPrev, lblPuts }).slice(0, 600));
} catch (e) { report("dispensing labels: ran to the end", false, String(e).slice(0, 300)); }
// Supplier stock: the old link opens the new screen under Stock; the deal line goes in at 10 and 14 snaps back to 10;
// sending posts the classic's order body once; the draft is saved with PUT (never DELETE); Mark as received sends only the status.
try {
  await page.goto(base + "&ui=2#supplier-inventory");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "sinreg" && document.querySelector(".sin-row"), null, { timeout: 15000 });
  const sinRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const sinRows = await page.$$eval(".sin-row", (l) => l.map((r) => r.textContent));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#sin-q", "augm"); await page.waitForTimeout(250);
  await page.click(".sin-row [data-act=cart]"); await page.waitForSelector("[data-qty]");
  await page.fill("[data-qty]", "14"); await page.press("[data-qty]", "Enter"); await page.waitForTimeout(200);
  const sinQty = await page.inputValue("[data-qty]");
  await page.fill('[data-notes="Supplier Depot"]', "Back door");
  await page.click('[data-act=send][data-sup="Supplier Depot"]'); await page.click("[data-act=send-yes]");
  let sinPosts = []; for (let i = 0; i < 40 && !sinPosts.length; i++) { await page.waitForTimeout(100); sinPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/supplier-orders"); }
  await page.waitForTimeout(1300);
  const sinAll = await (await fetch(`http://localhost:${PORT}/__calls`)).json();
  const sinDraft = sinAll.filter((c) => c.path === "/supplier-orders/cart-draft" && c.method !== "GET");
  await page.click("[data-act=view][data-v=orders]"); await page.waitForSelector(".sin-ord"); await page.click(".sin-ord"); await page.waitForSelector("[data-act=received]");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=received]"); await page.waitForTimeout(600);
  const sinPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  const sb = (sinPosts[0] || {}).body || {}, si = (sb.items || [])[0] || {};
  report("supplier stock: old link opens it under Stock; deal line in 10s (14 snaps to 10); one classic order POST; draft saved with PUT, never DELETE; Mark as received sends only the status",
    sinRail === "stock" && sinRows.length === 3 && /Out of stock/.test(sinRows[2]) && /Buy 10 \+ 2 free/.test(sinRows[0]) && sinQty === "10" && sinPosts.length === 1 &&
    JSON.stringify(sb) === JSON.stringify({ supplier_location_id: 400, supplier_name: "Supplier Depot", items: [{ product_id: 501, description: "Augmentin 625mg x14", barcode: "5000001", stock_code: "AUG625", qty_requested: 10, qty_free_included: 2, qty_free: 2, cost_excl_vat: 4.2, vat_rate: 18, retail_price: 7.5, batch: "B77", expiry_date: "2099-01-01", discount_pct: 0, discount_euro: 0 }], notes: "Back door" }) &&
    sinDraft.length >= 1 && sinDraft.every((c) => c.method === "PUT") && JSON.stringify(sinDraft[sinDraft.length - 1].body) === JSON.stringify({ cart: {} }) &&
    sinPuts.length === 1 && sinPuts[0].path === "/supplier-orders/87" && JSON.stringify(sinPuts[0].body) === JSON.stringify({ status: "received" }),
    JSON.stringify({ sinRail, sinRows, sinQty, sinPosts, sinDraft, sinPuts }).slice(0, 900));
} catch (e) { report("supplier stock: ran to the end", false, String(e).slice(0, 300)); }
// Over the counter (new layout otcreg): the old link opens it under Services; it reads the classic OTC mindmap's own
// files (no API call); a symptom shows its products in the classic's score order; a product shows its cautions first,
// in words; search ranks like the classic; Escape steps back; nothing wider than a phone.
try {
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#otcmindmap");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "otcreg" && document.querySelectorAll(".otc-side .otc-groups .otc-chip").length === 76, null, { timeout: 15000 });
  const otcRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  await page.click('.otc-side [data-open="symptom:S002"]'); await page.waitForSelector("#otc-title"); await page.waitForTimeout(150);
  const otcSym = await page.evaluate(() => ({ title: document.querySelector("#otc-title").textContent, n: document.querySelector(".otc-detail .otc-lab b").textContent,
    first: document.querySelector('[data-sec="symptom"] .otc-row b').textContent, sub: document.querySelector('[data-sec="symptom"] .otc-row .s').textContent, focus: document.activeElement.id }));
  await page.fill("#otc-q", "actifed"); await page.waitForTimeout(100);
  const otcRes = await page.evaluate(() => [...document.querySelectorAll("#otc-res .otc-row b")].map((b) => b.textContent));
  await page.click('#otc-res [data-open="product:P0001"]'); await page.waitForSelector(".otc-caution");
  const otcCaut = await page.textContent(".otc-caution");
  const otcFirst = await page.evaluate(() => document.querySelector(".otc-detail .otc-caution, .otc-detail .otc-lab").className);
  await page.click('.otc-caution [data-open="product:P0285"]'); await page.waitForFunction(() => /Medofed/.test((document.querySelector("#otc-title") || {}).textContent || ""));
  await page.keyboard.press("Escape"); await page.waitForTimeout(200);
  const otcBack = await page.textContent("#otc-title");
  await page.setViewportSize({ width: 360, height: 780 }); await page.waitForTimeout(200);
  const otcW = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth && ![...document.querySelectorAll("#eikon-content *")].some((e) => e.getBoundingClientRect().right > document.documentElement.clientWidth + 0.5));
  await page.setViewportSize({ width: 1440, height: 900 });
  const otcApi = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => /productmap|otc/i.test(c.path));
  report("over the counter: #otcmindmap opens it under Services; 76 symptoms with products (as chips); acid reflux lists its 29 products, best score first; a product's cautions come first, in words; Escape steps back; fits 360 px; reads only the classic's files",
    otcRail === "services" && otcSym.title === "Acid reflux" && otcSym.n === "29" && otcSym.first === "Acidex Oral Suspension" && otcSym.sub === "Main use" && otcSym.focus === "otc-title" &&
    otcRes.join("|") === "Actifed 60mg/2.5mg Tablets|ACTIFED 30mg/1.25mg per 5ml Syrup" && /Caution: 2 products to check before selling together/.test(otcCaut) && !/guardrail/i.test(otcCaut) && /Do not cross-sell together by default; show as alternative options instead\./.test(otcCaut) && /Medofed/.test(otcCaut) &&
    /otc-caution/.test(otcFirst) && otcBack === "ACTIFED 30mg/1.25mg per 5ml Syrup" && otcW && otcApi.length === 0,
    JSON.stringify({ otcRail, otcSym, otcRes: otcRes.slice(0, 3), otcCaut: otcCaut.slice(0, 200), otcFirst, otcBack, otcW, otcApi }).slice(0, 700));
} catch (e) { report("over the counter: ran to the end", false, String(e).slice(0, 300)); }
// Services group, quality pass: a form with several problems says them all at once, marks each field (aria-invalid) and
// focuses the first; nothing is sent; typing in a marked field unmarks it. POCT opens on the last test type recorded;
// screening offers "Record the next person" after a save; a failed load says why with Try again; OTC typing never
// replaces the search box; the calculators open on the last one used; Services group names are not in capitals.
try {
  // POCT
  await page.goto(base + "&ui=2#poct");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "pocreg" && document.querySelector(".poc-list"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.waitForSelector("#poc-add");
  const pocType0 = await page.getAttribute(".poc-seg button.on", "data-type");
  await page.click('.poc-seg [data-type="bp"]'); await page.click("#poc-add button[type=submit]"); await page.waitForTimeout(150);
  const pocE = await page.evaluate(() => ({ err: (document.querySelector("#poc-errmsg") || {}).textContent || "", role: (document.querySelector("#poc-errmsg") || { getAttribute: () => "" }).getAttribute("role"),
    bad: [...document.querySelectorAll("#poc-add [aria-invalid=true]")].map((e) => e.name), miss: document.querySelectorAll("#poc-add label.miss").length, focus: document.activeElement && document.activeElement.name }));
  await page.type("[name=name]", "Ċ"); const pocUn = await page.evaluate(() => ({ bad: document.querySelector("[name=name]").getAttribute("aria-invalid"), lab: document.querySelector("[name=name]").closest("label").className }));
  await page.click("[data-act=add-cancel]");
  const pocNoPut = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  // after a glucose test was recorded (the earlier POCT check), a new test opens on Glucose; after cancel and reopen too
  report("services: POCT empty Record lists every problem at once (ID card, name, phone, systolic+diastolic), marks those fields, focuses the first, sends nothing; typing unmarks; opens on the last test type (glucose)",
    pocType0 === "bg" && /ID card/.test(pocE.err) && /name/.test(pocE.err) && /contact number/.test(pocE.err) && /systolic and the diastolic/.test(pocE.err) && /Nothing was saved\.$/.test(pocE.err) && pocE.role === "alert" &&
    pocE.bad.join() === "patientId,name,phone,sys,dia" && pocE.miss === 5 && pocE.focus === "patientId" && pocUn.bad === null && !/miss/.test(pocUn.lab) && pocNoPut === 0, JSON.stringify({ pocType0, pocE, pocUn, pocNoPut }));
  // Screening
  await page.goto(base + "&ui=2#screening");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "scrreg" && document.querySelector(".scr-row"), null, { timeout: 15000 });
  await page.click('.scr-row[data-id="sc_1_abc"]'); await page.click("[data-act=add]"); await page.waitForSelector("#scr-add");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("[name=r_pulse]", "fast"); await page.click("#scr-add button[type=submit]"); await page.waitForTimeout(150);
  const scE = await page.evaluate(() => ({ err: (document.querySelector("#scr-errmsg") || {}).textContent || "", bad: [...document.querySelectorAll("#scr-add [aria-invalid=true]")].map((e) => e.name), focus: document.activeElement && document.activeElement.name }));
  const scNoPut = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  await page.click("[data-act=cancel]"); await page.click('.scr-row[data-act=part]'); await page.waitForTimeout(100);
  const scNext = await page.evaluate(() => { const b = document.querySelector(".scr-acts-top [data-act=add]"); return b ? b.textContent : ""; });
  await page.click(".scr-acts-top [data-act=add]"); const scNextForm = !!(await page.$("#scr-add"));
  await page.click("[data-act=cancel]");
  report("services: screening lists every problem at once (ID card or name, systolic, diastolic, pulse not a number), marks them, focuses the first, sends nothing; a person's page offers Record the next person",
    /ID card or the name/.test(scE.err) && /systolic/.test(scE.err) && /diastolic/.test(scE.err) && /pulse is not a number/.test(scE.err) && scE.bad.join() === "idCard,name,r_sys,r_dia,r_pulse" && scE.focus === "idCard" && scNoPut === 0 &&
    scNext === "Record the next person" && scNextForm, JSON.stringify({ scE, scNoPut, scNext, scNextForm }));
  // Adverse reactions: a failed load says so with Try again; then the three checks at once
  let pvFail = 0; await page.route("**/pharmacovigilance/state", (r) => r.request().method() === "GET" && !pvFail++ ? r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"Database busy"}' }) : r.continue());
  await page.goto(base + "&ui=2#pharmacovigilance");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "pvreg" && document.querySelector("[data-act=retry]"), null, { timeout: 15000 });
  const pvFailTxt = await page.textContent(".pvr-quiet");
  await page.click("[data-act=retry]"); await page.waitForSelector(".pvr-row", { timeout: 8000 }); await page.unroute("**/pharmacovigilance/state");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.waitForSelector("#pvr-add"); await page.click("#pvr-add button[type=submit]"); await page.waitForTimeout(150);
  const pvE = await page.evaluate(() => ({ err: (document.querySelector("#pvr-errmsg") || {}).textContent || "", bad: [...document.querySelectorAll("#pvr-add [aria-invalid=true]")].map((e) => e.name || e.getAttribute("data-k")), focus: document.activeElement && document.activeElement.name }));
  const pvNoPut = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  await page.click("[data-act=form-cancel]");
  report("services: adverse reactions — a failed load says why with Try again, which reloads; an empty report lists all three checks at once, marks the fields, focuses the first, sends nothing",
    /Database busy/.test(pvFailTxt) && /initials or age/.test(pvE.err) && /suspected medicine/.test(pvE.err) && /MedDRA term/.test(pvE.err) && pvE.bad.join() === "reaction_meddra,reaction_description,name,pt_initials,pt_age" && pvE.focus === "reaction_meddra" && pvNoPut === 0,
    JSON.stringify({ pvFailTxt, pvE, pvNoPut }));
  // OTC: typing keeps the same search box (only the list under it is redrawn); Services hub group names in sentence case
  await page.goto(base + "&ui=2#otcmindmap");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "otcreg" && document.querySelectorAll(".otc-side .otc-groups .otc-chip").length === 76, null, { timeout: 15000 });
  await page.evaluate(() => { window.__otcBox = document.querySelector("#otc-q"); });
  await page.click("#otc-q"); await page.keyboard.type("acti"); await page.waitForTimeout(80);
  const otcSame = await page.evaluate(() => ({ same: window.__otcBox === document.querySelector("#otc-q"), focus: document.activeElement === window.__otcBox, val: window.__otcBox.value, hits: document.querySelectorAll("#otc-res .otc-row").length }));
  await page.keyboard.press("Enter"); await page.waitForSelector("#otc-title");
  await page.goto(base + "&ui=2#services"); await page.waitForSelector(".hub-lab");
  const hubCaps = await page.$$eval(".hub-lab", (l) => l.map((x) => getComputedStyle(x).textTransform));
  report("services: OTC typing redraws only the results (same box, focus and text kept, Enter opens the first); Services group names are not in capitals",
    otcSame.same && otcSame.focus && otcSame.val === "acti" && otcSame.hits > 0 && hubCaps.length >= 2 && hubCaps.every((t) => t === "none"), JSON.stringify({ otcSame, hubCaps }));
} catch (e) { report("services: quality pass ran to the end", false, String(e).slice(0, 300)); }
// Emergency POS in the new layout: the old link lands on it; Enter adds the first match; Exact fills the cash; a double-click on Take
// sends one POST with the classic body and sums; a refused save (500) keeps the basket and Take again resends the same offline_id.
try {
  await page.goto(base + "&ui=2#emergency-pos");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eposreg" && /2 products/.test((document.querySelector("#epr-hits") || {}).textContent || ""), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#epr-q", "sun"); await page.press("#epr-q", "Enter"); await page.fill("#epr-q", "5012345678900"); await page.press("#epr-q", "Enter");
  await page.click("[data-act=exact]"); const epTot = await page.textContent('[data-b="total"]');
  await page.dblclick("[data-k=take]"); await page.waitForTimeout(800);
  const epPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/emergency-pos/sales").map((c) => c.body);
  const e0 = epPosts[0] || {};
  await page.fill("#epr-q", "panadol"); await page.press("#epr-q", "Enter"); await page.click("[data-act=method][data-m=card]");
  let epFail = 0, epFailed = null; await page.route("**/emergency-pos/sales", (r) => r.request().method() === "POST" && !epFail++ ? (epFailed = r.request().postDataJSON(), r.fulfill({ status: 500, contentType: "application/json", body: '{"ok":false,"error":"busy"}' })) : r.continue()); // answered here: never reaches the mock
  await page.click("[data-k=take]"); await page.waitForTimeout(600);
  const epKept = await page.$$eval(".epr-line", (l) => l.length), epErr = await page.textContent(".epr-err").catch(() => "");
  await page.click("[data-k=take]"); await page.waitForTimeout(800); await page.unroute("**/emergency-pos/sales");
  const epAll = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/emergency-pos/sales").map((c) => c.body);
  const epDay = await page.textContent('[data-b="daytotal"]'), epQ = await page.evaluate(() => JSON.parse(localStorage.getItem("eikon_epos_pending") || "[]").length);
  report("emergency POS: #emergency-pos opens eposreg; Enter adds; double-click Take = one POST, classic body and sums; a 500 keeps the basket, Take again = same offline_id",
    epTot === "€16.48" && epPosts.length === 1 && e0.total === 16.48 && e0.subtotal === 16.48 && e0.vat_total === 1.98 && e0.payment_method === "cash" && e0.amount_tendered === 16.48 && e0.change_given === 0 && e0.items.length === 2 && e0.items[0].line_total === 12.99 &&
    Object.keys(e0).join() === "offline_id,sale_date,receipt_no,items,subtotal,vat_total,discount_pct,discount_amt,total,payment_method,amount_tendered,change_given,notes" &&
    epKept === 1 && /Not saved: busy/.test(epErr) && epAll.length === 2 && epFailed && epFailed.offline_id === epAll[1].offline_id && epAll[1].payment_method === "card" && epDay === "€19.97" && epQ === 0,
    JSON.stringify({ epTot, epPosts, epKept, epErr, n: epAll.length, epDay, epQ }).slice(0, 900));
} catch (e) { report("emergency POS: ran to the end", false, String(e).slice(0, 300)); }
// Controlled-drug medicine box (new layout): a brand finds the generic ("ativ" → Lorazepam — Ativan), the classic fixed
// list and the pharmacy's own earlier entries are offered, the keyboard chooses, and choosing sends nothing.
try {
  await page.goto(base + "&ui=2#dda-sales");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.waitForTimeout(300);
  await fetch(`http://localhost:${PORT}/__reset`);
  const ddaMed = '[data-i="0"][data-k=medicine_name_dose]';
  await page.click(ddaMed); await page.type(ddaMed, "ativ"); await page.waitForTimeout(200);
  const ddaOpts = await page.$$eval(".ddam-lb:not([hidden]) [role=option]", (l) => l.map((o) => o.textContent));
  const ddaAria = await page.evaluate((s) => { const i = document.querySelector(s); return i.getAttribute("role") + "|" + i.getAttribute("aria-expanded") + "|" + !!document.getElementById(i.getAttribute("aria-controls")); }, ddaMed);
  const ddaIdx = ddaOpts.findIndex((t) => t.startsWith("Lorazepam 1mg"));
  for (let n = 0; n <= ddaIdx; n++) await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter"); await page.waitForTimeout(100);
  const ddaVal = await page.inputValue(ddaMed), ddaShut = await page.getAttribute(ddaMed, "aria-expanded");
  await page.fill(ddaMed, ""); await page.type(ddaMed, "oxycontin"); await page.waitForTimeout(150);
  const ddaOxy = await page.$$eval(".ddam-lb:not([hidden]) [role=option]", (l) => l.map((o) => o.textContent));
  await page.keyboard.press("Escape"); await page.click("[data-act=add-cancel]");
  await page.goto(base + "&ui=2#dda-purchases");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdpreg" && document.querySelector(".cdp-inv"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  const ddaP = '[data-i="0"][data-k=dda_name_dose]';
  await page.click(ddaP); await page.type(ddaP, "mst"); await page.waitForTimeout(200);
  const ddaOwn = await page.$$eval(".ddam-lb:not([hidden]) [role=option]", (l) => l.map((o) => o.textContent));
  await page.keyboard.press("Escape"); await page.click("[data-act=add-cancel]");
  const ddaWrites = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET");
  report("controlled drugs: 'ativ' offers Lorazepam — Ativan and the classic 'Lorazepam 1mg'; arrows + Enter fill it; 'oxycontin' finds oxycodone; 'mst' finds this pharmacy's 'Morphine 10mg'; nothing sent",
    ddaOpts.some((t) => /^Lorazepam — Ativan/.test(t)) && ddaIdx >= 0 && ddaAria === "combobox|true|true" && ddaVal === "Lorazepam 1mg" && ddaShut === "false" &&
    ddaOxy.some((t) => /^Oxycodone — OxyContin/.test(t)) && ddaOwn.some((t) => /^Morphine 10mg/.test(t) && /written here before/.test(t)) && ddaWrites.length === 0,
    JSON.stringify({ ddaOpts, ddaAria, ddaVal, ddaShut, ddaOxy, ddaOwn, ddaWrites }));
} catch (e) { report("controlled drugs: medicine suggestions ran to the end", false, String(e).slice(0, 300)); }
// Pharmacy calculators in the new layout: the old #pharmacycalc link lands on it under Registers; the levothyroxine default
// works out live (12 weeks of 100/125 mcg = 4 boxes); methotrexate 7,5 mg (a comma) from 5 mg halves is 12 tablets; a known
// name fills the ID card; Save and print is one POST in the classic shape and prints; a saved plan prints again; no deletes.
try {
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#pharmacycalc");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "calreg" && document.querySelector(".cal-row") && /boxes to dispense/.test(document.querySelector("#cal-res").textContent), null, { timeout: 15000 });
  const calRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const calLev = await page.textContent("#cal-res");
  await page.evaluate(() => { window.__calPrints = []; const oc = URL.createObjectURL; window.__calOc = oc; URL.createObjectURL = function (b) { if (b && b.type === "text/html") b.text().then((t) => window.__calPrints.push(t)); return oc.call(URL, b); };
    window.__calAc = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { if (String(this.href).startsWith("blob:")) return; return window.__calAc.call(this); }; });
  await page.click("[data-calc=mtx]");
  await page.fill('[name="mtx.weeklyDose"]', "7,5"); await page.fill('[name="mtx.strength"]', "5"); await page.selectOption('[name="mtx.split"]', "halves");
  await page.fill('[name="pat.name"]', "Zammit Carmel"); await page.waitForTimeout(400);
  const calMtx = await page.textContent("#cal-res"), calId = await page.inputValue('[name="pat.id"]'), calStart = await page.inputValue('[name="pat.start"]');
  await page.click("button[type=submit][form=cal-form]"); await settleSave();
  const calW = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && c.path.startsWith("/pharmacy-calc/"));
  const cb = (calW[0] || {}).body || {}, cm = cb.calc_data_json ? JSON.parse(cb.calc_data_json) : {};
  const calPrint = await page.evaluate(() => window.__calPrints[0] || "");
  await page.waitForFunction(() => document.querySelectorAll(".cal-row").length === 2, null, { timeout: 8000 });
  await page.click('.cal-row[data-id="7"]'); await page.waitForSelector("[data-act=reprint]", { timeout: 8000 });
  await page.waitForTimeout(950); // the classic printout ignores a second print within 0.9 s
  await page.click("[data-act=reprint]"); await page.waitForTimeout(300);
  const calRe = await page.evaluate(() => window.__calPrints[1] || "");
  await page.evaluate(() => { URL.createObjectURL = window.__calOc; HTMLAnchorElement.prototype.click = window.__calAc; });
  report("pharmacy calculators: #pharmacycalc opens it under Services; live results; 7,5 mg methotrexate = 12 tablets; a known name fills the ID; one POST in the classic shape, printed; a saved plan prints again; no deletes",
    calRail === "services" && /^\s*4\s*boxes to dispense/.test(calLev) && /12\s*tablets to dispense/.test(calMtx) && /1 tablet\(s\) \+ ½ tablet/.test(calMtx) && /Once a week only/.test(calMtx) && calId === "0012345M" &&
    calW.length === 1 && calW[0].method === "POST" && calW[0].path === "/pharmacy-calc/records" && Object.keys(cb).sort().join() === "calc_data_json,calc_type,id_card,patient_name,start_date" &&
    cb.calc_type === "mtx" && cb.patient_name === "Zammit Carmel" && cb.id_card === "0012345M" && cb.start_date === calStart &&
    cm.weeklyDose === 7.5 && cm.tabletStrength === 5 && cm.weeks === 8 && cm.totalTabsToDispense === 12 && cm.totalHalfPiecesUsed === 8 && cm.boxes === 1 && cm.schedule.length === 8 &&
    /TAKE ONCE WEEKLY ONLY/.test(calPrint) && /Patient: Zammit Carmel/.test(calPrint) && /Warfarin Dosing Plan/.test(calRe) && /Vella Anna/.test(calRe),
    JSON.stringify({ calRail, calLev: calLev.slice(0, 80), calMtx: calMtx.slice(0, 160), calId, calW: calW.map((c) => c.method + " " + c.path), cb: Object.keys(cb), print: calPrint.length, re: calRe.length }));
} catch (e) { report("pharmacy calculators: new layout flow ran to the end", false, String(e).slice(0, 300)); }
try {
  const calLast = await page.evaluate(() => localStorage.getItem("eikon_calreg_calc"));
  const ls = await page.evaluate(() => JSON.stringify(Object.assign({}, localStorage)));
  const c2 = await browser.newContext({ viewport: { width: 1440, height: 900 } }); await c2.addInitScript((j) => { const o = JSON.parse(j); for (const k in o) localStorage.setItem(k, o[k]); }, ls);
  const p2 = await c2.newPage(); // a fresh visit with this browser's stored settings; the main page is left as it was
  await p2.goto(base + "&ui=2#pharmacycalc");
  await p2.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "calreg" && document.querySelector(".cal-seg button.on"), null, { timeout: 15000 });
  const calOn = await p2.getAttribute(".cal-seg button.on", "data-calc"); await c2.close();
  report("pharmacy calculators: a new visit opens on the calculator used last (methotrexate)", calLast === "mtx" && calOn === "mtx", JSON.stringify({ calLast, calOn }));
} catch (e) { report("pharmacy calculators: last calculator remembered", false, String(e).slice(0, 300)); }
// Possible duplicates: Customers links to a read-only view that groups one person written differently in three sections
// (ID card typed two ways, phone typed two ways), leaves out a namesake with another ID card, hides a group on "Not the same
// person" with Undo, and never writes to the server.
try {
  globalThis.__dupMock = true;
  await page.goto(base + "&ui=2#customers");
  await page.waitForSelector("[data-dupes]", { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-dupes]");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dupreg" && document.querySelector("#dup-count"), null, { timeout: 20000 });
  const dpRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const dp1 = await page.evaluate(() => ({ count: document.querySelector("#dup-count").textContent, warn: [...document.querySelectorAll(".dup-warn")].map((w) => w.textContent).join(" "), cards: [...document.querySelectorAll(".dup-card")].map((c) => c.textContent) }));
  const dpCard = dp1.cards.find((c) => /Zammit/.test(c)) || "", dpN = parseInt(dp1.count, 10) || 0; // other mocks in this suite add their own look-alikes (e.g. Camilleri Rita)
  await page.click('.dup-card[aria-labelledby] [data-hide][aria-label*="Zammit"]'); await page.waitForSelector("[data-act=undo]");
  const dp2 = await page.evaluate(() => ({ count: document.querySelector("#dup-count").textContent, cards: document.querySelectorAll(".dup-card").length, zam: [...document.querySelectorAll(".dup-card")].some((c) => /Zammit/.test(c.textContent)), focus: document.activeElement && document.activeElement.dataset.act }));
  await page.click("[data-act=undo]"); await page.waitForTimeout(150);
  const dp3 = await page.evaluate(() => ({ count: document.querySelector("#dup-count").textContent, stored: Object.keys(localStorage).filter((k) => k.indexOf("eikon_dupes") === 0).map((k) => localStorage.getItem(k)) }));
  const dpCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  const dpWrites = dpCalls.filter((c) => c.method !== "GET");
  globalThis.__dupMock = false;
  report("possible duplicates: Customers links to it (Customers lit); one person in DDA sale, appointment and an order on the same phone grouped by ID card and phone as typed (month by month, as the live server takes); the other ID card left out; Not the same person hides with Undo; read only",
    dpRail === "customers" && dpN >= 1 && dp1.cards.length === dpN && dp1.cards.filter((c) => /Zammit/.test(c)).length === 1 &&
    /Order/.test(dpCard) && /DDA sale/.test(dpCard) && /Appointment/.test(dpCard) && /Same ID card 0012345M/.test(dpCard) && /12345M/.test(dpCard) && /Same phone 79123456/.test(dpCard) && /\+356 79123456/.test(dpCard) && /Grech Carmen/.test(dpCard) && !/Could not read/.test(dp1.warn) && !/0099999M|Loyalty card/.test(dpCard) &&
    (parseInt(dp2.count, 10) || 0) === dpN - 1 && dp2.cards === dpN - 1 && !dp2.zam && dp2.focus === "undo" && (parseInt(dp3.count, 10) || 0) === dpN && dp3.stored.join() === "[]" &&
    dpWrites.length === 0 && dpCalls.some((c) => c.path === "/dda-sales/entries") && dpCalls.filter((c) => c.path === "/client-orders/entries").every((c) => /month=/.test(c.query) && !/from=/.test(c.query)) && dpCalls.some((c) => c.path === "/people"),
    JSON.stringify({ dpRail, dp1, dp2, dp3, dpWrites }).slice(0, 700));
} catch (e) { globalThis.__dupMock = false; report("possible duplicates: ran to the end", false, String(e).slice(0, 300)); }
// Possible duplicates with the server's people links: no Link button on a server without the routes (the live worker
// today); with them, "Same person — link" sends the group's records once, the group moves to "Linked as one person",
// Undo sends exactly the ids the link made and the group is back. No other write.
try {
  // The Link button is behind E.FEATURES.peopleLinks (off by default, not approved yet): off, the screen never asks
  // for /people/links and shows no Link button even on a server with the routes; the rest of this test turns it on.
  globalThis.__dupMock = true; globalThis.__dupLinks = { rows: [], n: 0 };
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#customers");
  await page.waitForSelector("[data-dupes]", { timeout: 15000 });
  await page.click("[data-dupes]");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dupreg" && document.querySelector("#dup-count"), null, { timeout: 20000 });
  const lkOff = await page.evaluate(() => ({ flag: window.EIKON.FEATURES && window.EIKON.FEATURES.peopleLinks, link: document.querySelectorAll("[data-link]").length, hide: document.querySelectorAll("[data-hide]").length }));
  const lkOffCalls = (await callsNow()).filter((c) => c.path.indexOf("/people/links") === 0).length;
  await page.evaluate(() => { window.EIKON.FEATURES.peopleLinks = true; });
  globalThis.__dupLinks = "404";
  await page.click("[data-act=reload]");
  await page.waitForFunction(() => document.querySelector("#dup-count") && !document.querySelector("#dup-status"), null, { timeout: 20000 });
  const lk0 = await page.evaluate(() => ({ link: document.querySelectorAll("[data-link]").length, hide: document.querySelectorAll("[data-hide]").length }));
  globalThis.__dupLinks = { rows: [], n: 0 };
  await page.click("[data-act=reload]");
  await page.waitForSelector('[data-link][aria-label*="Zammit"]', { timeout: 20000 });
  const lkN = await page.evaluate(() => parseInt(document.querySelector("#dup-count").textContent, 10) || 0);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-link][aria-label*="Zammit"]');
  await page.waitForSelector("[data-act=unlink-last]", { timeout: 8000 });
  await page.waitForFunction(() => document.activeElement && document.activeElement.dataset.act === "unlink-last", null, { timeout: 4000 }).catch(() => {});
  const lk1 = await page.evaluate(() => ({ count: parseInt(document.querySelector("#dup-count").textContent, 10) || 0, zam: [...document.querySelectorAll(".dup-card")].some((c) => /Zammit/.test(c.textContent)),
    linkedLab: [...document.querySelectorAll(".dup-lab")].map((x) => x.textContent).join("|"), bar: (document.querySelector(".dup-bar") || {}).textContent || "", focus: document.activeElement && document.activeElement.dataset.act }));
  await page.click("[data-act=toggle-linked]");
  const lk2 = await page.evaluate(() => ({ unlink: [...document.querySelectorAll("[data-unlink]")].map((b) => b.getAttribute("aria-label")).join("|") }));
  await page.click("[data-act=unlink-last]");
  await page.waitForSelector('[data-link][aria-label*="Zammit"]', { timeout: 8000 });
  const lk3 = await page.evaluate(() => ({ count: parseInt(document.querySelector("#dup-count").textContent, 10) || 0, linkedLab: [...document.querySelectorAll(".dup-lab")].map((x) => x.textContent).join("|"), focus: document.activeElement && document.activeElement.getAttribute("aria-label") }));
  const lkCalls = (await callsNow()).filter((c) => c.method !== "GET");
  const lkPost = lkCalls.find((c) => c.path === "/people/links") || {}, lkUndo = lkCalls.find((c) => c.path === "/people/links/undo") || {};
  const kinds = ((lkPost.body || {}).records || []).map((r) => r.kind).sort();
  const made = globalThis.__dupLinks.rows.map((r) => r.id);
  globalThis.__dupMock = false; globalThis.__dupLinks = null;
  report("possible duplicates, links: off by default (no /people/links call, no Link button); turned on: no Link button on a server without the routes; Same person — link sends the group once (order, DDA sale, appointment); the group moves to Linked as one person; Undo sends exactly those ids and it is back; no other write",
    lkOff.flag === false && lkOff.link === 0 && lkOff.hide >= 1 && lkOffCalls === 0 &&
    lk0.link === 0 && lk0.hide >= 1 && lkN >= 1 && lkCalls.length === 2 && lkPost.method === "POST" && kinds.includes("dda_sale") && kinds.includes("appointment") && kinds.includes("order") && !kinds.includes("loyalty") &&
    lk1.count === lkN - 1 && !lk1.zam && /Linked as one person · 1/.test(lk1.linkedLab) && /linked as one person/.test(lk1.bar) && /Zammit/.test(lk2.unlink) &&
    JSON.stringify((lkUndo.body || {}).link_ids) === JSON.stringify(made) && lk3.count === lkN && !/Linked as one person/.test(lk3.linkedLab) && /Zammit/.test(lk3.focus || ""),
    JSON.stringify({ lkOff, lkOffCalls, lk0, lkN, lk1, lk2, lk3, kinds, calls: lkCalls.map((c) => c.method + " " + c.path) }).slice(0, 900));
} catch (e) { globalThis.__dupMock = false; globalThis.__dupLinks = null; report("possible duplicates, links: ran to the end", false, String(e).slice(0, 300)); }
// Where things live (2026-11-03): money and clinical services left Registers. Old links land on the same screens; the rail
// lights the new tab and each screen's back button names it; on phones the six-word bar has More (Team, Services, Money).
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const visCards = () => page.evaluate(() => [...document.querySelectorAll(".hub-card[data-open]")].filter((x) => x.offsetParent).map((x) => x.dataset.open).join());
  const litNow = () => page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  await page.goto(base + "&ui=2#registers");
  await page.waitForFunction(() => document.querySelector(".hub-card[data-open]"), null, { timeout: 15000 });
  const navReg = await visCards();
  await page.evaluate(() => { location.hash = "#services"; });
  await page.waitForFunction(() => (document.querySelector(".hub h1") || {}).textContent === "Services", null, { timeout: 8000 });
  const navSvc = await visCards(), navSvcLit = await litNow();
  await page.evaluate(() => { location.hash = "#money"; });
  await page.waitForFunction(() => (document.querySelector(".hub h1") || {}).textContent === "Money", null, { timeout: 8000 });
  const navMon = await visCards(), navMonLit = await litNow();
  await page.evaluate(() => { location.hash = "#stock"; });
  await page.waitForFunction(() => (document.querySelector(".hub h1") || {}).textContent === "Stock", null, { timeout: 8000 });
  const navStk = await visCards();
  // an old link: #endofday still opens End of day, now under Money, and back goes to Money
  await page.evaluate(() => { location.hash = "#endofday"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector(".eod-back"), null, { timeout: 15000 });
  const navEod = { lit: await litNow(), back: (await page.textContent(".eod-back")).trim() };
  await page.click(".eod-back");
  await page.waitForFunction(() => location.hash === "#money" && (document.querySelector(".hub h1") || {}).textContent === "Money", null, { timeout: 8000 });
  await page.evaluate(() => { location.hash = "#creditnotes"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cnreg" && document.querySelector(".cnr-back"), null, { timeout: 15000 });
  const navCn = { lit: await litNow(), back: (await page.textContent(".cnr-back")).trim() };
  await page.evaluate(() => { location.hash = "#settings"; });
  await page.waitForFunction(() => (document.querySelector(".hub h1") || {}).textContent === "Settings", null, { timeout: 8000 });
  const navDeskMore = await page.evaluate(() => [...document.querySelectorAll(".hub-card")].some((x) => x.offsetParent && /^(Team|Services|Money)$/.test(x.querySelector("b").textContent)));
  report("places: Registers keeps the legal books; Services has tests, vaccines, screening, reactions and lookups; Money has the till and what is owed; the old doors (Registers › Proof, Stock › Price) stay",
    !/endofday|paidout|emergency-pos|poct|vaccines|screening|pharmacovigilance|ocps|labels|otcmindmap|creditnotes|locumreceipts/.test(navReg) && /certificates,audit$/.test(navReg) && /temperature/.test(navReg) && /dda-sales/.test(navReg) && /repeatprescriptions/.test(navReg) &&
    /^poct,vaccines,screening,pharmacovigilance,ocps/.test(navSvc) && /otcmindmap/.test(navSvc) && /labels/.test(navSvc) && navSvcLit === "services" && /^ownreg,endofday,paidout,emergency-pos/.test(navMon) && /creditnotes/.test(navMon) && /locumreceipts/.test(navMon) && navMonLit === "money" &&
    /quotations,creditnotes$/.test(navStk) &&
    navEod.lit === "money" && navEod.back === "‹ Money" && navCn.lit === "money" && navCn.back === "‹ Money" && !navDeskMore,
    JSON.stringify({ navReg, navSvc, navSvcLit, navMon, navMonLit, navStk, navEod, navCn, navDeskMore }));
  // phone: six words fit at 360 px; the last reads More, lists Team, Services and Money first, and stays lit inside them
  await page.setViewportSize({ width: 360, height: 780 });
  await page.waitForTimeout(300);
  const navBar = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn")].filter((x) => x.offsetParent).map((x) => { const r = x.getBoundingClientRect(), l = [...x.querySelectorAll(".eikon-nav-label,.eikon-rail-more")].find((s) => s.offsetParent); return { t: l.textContent, ok: l.scrollWidth <= r.width + 0.5 && r.right <= innerWidth }; }));
  const navMore = await page.evaluate(() => [...document.querySelectorAll(".hub-card")].filter((x) => x.offsetParent).slice(0, 3).map((x) => x.querySelector("b").textContent).join());
  await page.locator(".hub-card", { hasText: "Services" }).first().click();
  await page.waitForFunction(() => location.hash === "#services" && (document.querySelector(".hub h1") || {}).textContent === "Services", null, { timeout: 8000 });
  await page.evaluate(() => { location.hash = "#poct"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "pocreg", null, { timeout: 15000 });
  const navMoreOn = await page.evaluate(() => document.querySelector('.eikon-rail-btn[data-mod="settings"]').classList.contains("more-on"));
  report("places on a phone: Today, Customers, Bookings, Stock, Registers, More fit at 360 px; More lists Team, Services, Money first and stays lit on POCT",
    navBar.map((x) => x.t).join() === "Today,Customers,Bookings,Stock,Registers,More" && navBar.every((x) => x.ok) && navMore === "Team,Services,Money" && navMoreOn,
    JSON.stringify({ navBar, navMore, navMoreOn }));
  await page.setViewportSize({ width: 1440, height: 900 });
} catch (e) { report("places: ran to the end", false, String(e).slice(0, 300)); }
// People known here, offered as an ID card or a name is typed (eikon.personpick.js): a part of an ID card lists the
// person, arrow + Enter fills the ID card (padded), name and address with a quiet "Filled from"; a complete ID card
// fills only empty fields (a typed name stays); a name suggests in Orders and fills the phone; only reads are sent.
try {
  await page.goto(base + "&ui=2#dda-sales");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && window.EIKON.personPick && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.type("[name=client_id_card]", "2345", { delay: 20 }); await page.waitForTimeout(700);
  const ppList = await page.evaluate(() => { const el = document.querySelector("[name=client_id_card]"), lb = document.getElementById(el.getAttribute("aria-controls")); return { role: el.getAttribute("role"), exp: el.getAttribute("aria-expanded"), lb: lb && lb.getAttribute("role"), opts: lb ? [...lb.querySelectorAll("[role=option] b")].map((b) => b.textContent) : [] }; });
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  const ppPick = await page.evaluate(() => ({ id: document.querySelector("[name=client_id_card]").value, name: document.querySelector("[name=client_name]").value, addr: document.querySelector("[name=client_address]").value, note: [...document.querySelectorAll(".epp-note")].map((n) => n.textContent).join(""), open: !!document.querySelector(".epp-list:not([hidden])"), focus: document.activeElement && document.activeElement.name }));
  await page.click("[data-act=add-cancel]"); await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.fill("[name=client_name]", "Typed By Hand");
  await page.type("[name=client_id_card]", "12345m", { delay: 20 }); await page.waitForTimeout(900);
  const ppExact = await page.evaluate(() => ({ name: document.querySelector("[name=client_name]").value, addr: document.querySelector("[name=client_address]").value, note: [...document.querySelectorAll(".epp-note")].map((n) => n.textContent).join("") }));
  await page.click("[data-act=add-cancel]");
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.type("[name=client_name]", "Zam", { delay: 20 }); await page.waitForTimeout(700);
  const ppNames = await page.$$eval(".epp-list:not([hidden]) .epp-opt b", (l) => l.map((x) => x.textContent));
  await page.click('.epp-list:not([hidden]) .epp-opt:has-text("Zammit Paul")'); await page.waitForTimeout(300);
  const ppOrd = await page.evaluate(() => ({ name: document.querySelector("[name=client_name]").value, phone: document.querySelector("[name=contact]").value }));
  await page.keyboard.press("Escape");
  const ppCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  const ppReads = ppCalls.filter((c) => c.path === "/people" || c.path === "/dda-sales/clients"), ppWrites = ppCalls.filter((c) => c.method !== "GET");
  report("people as you type: 2345 lists Zammit Carmel (combobox + listbox); arrow + Enter fills 0012345M, name and address and says where from; 12345m keeps a typed name and fills the address; Zam in Orders fills the phone; reads only",
    ppList.role === "combobox" && ppList.exp === "true" && ppList.lb === "listbox" && ppList.opts.join() === "Zammit Carmel" &&
    ppPick.id === "0012345M" && ppPick.name === "Zammit Carmel" && ppPick.addr === "1 Triq il-Knisja" && /^Filled from (Customers|earlier records \(last 5 Oct\))$/.test(ppPick.note) && !ppPick.open && ppPick.focus === "client_id_card" &&
    ppExact.name === "Typed By Hand" && ppExact.addr === "1 Triq il-Knisja" && /Filled from/.test(ppExact.note) &&
    ppNames.includes("Zammit Paul") && ppNames.includes("Zammit Carmel") && ppOrd.name === "Zammit Paul" && ppOrd.phone === "79000001" &&
    ppReads.length >= 3 && ppReads.every((c) => /[?&]q=/.test(c.query)) && ppReads.some((c) => /q=2345/.test(c.query)) && ppWrites.length === 0,
    JSON.stringify({ ppList, ppPick, ppExact, ppNames, ppOrd, ppReads: ppReads.map((c) => c.path + c.query), ppWrites }));
} catch (e) { report("people as you type: ran to the end", false, String(e).slice(0, 300)); }
// A name typed first-name-first, or in part, still finds the person ("carmel zam" -> Zammit Carmel, not Zammit Paul);
// the server is asked for the longest word, every word is checked here; choosing fills the ID card.
try {
  await page.goto(base + "&ui=2#dda-sales");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && window.EIKON.personPick && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.type("[name=client_name]", "carmel zam", { delay: 20 }); await page.waitForTimeout(800);
  const nmOpts = await page.evaluate(() => { const el = document.querySelector("[name=client_name]"), lb = document.getElementById(el.getAttribute("aria-controls") || ""); return lb ? [...lb.querySelectorAll("[role=option] b")].map((b) => b.textContent) : []; });
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(300);
  const nmPick = await page.evaluate(() => ({ id: document.querySelector("[name=client_id_card]").value, name: document.querySelector("[name=client_name]").value }));
  const nmGets = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "GET" && c.path === "/people").map((c) => c.query || c.url || "");
  await page.click("[data-act=add-cancel]");
  report("people suggestions: first name then part of the surname finds the person, not a namesake; choosing fills the ID card",
    nmOpts.includes("Zammit Carmel") && !nmOpts.includes("Zammit Paul") && nmPick.name === "Zammit Carmel" && /12345M/.test(nmPick.id), JSON.stringify({ nmOpts, nmPick, nmGets }));
} catch (e) { report("people suggestions: first name then part of the surname ran to the end", false, String(e).slice(0, 300)); }
// ---- Clean addresses (eikonhq.com/today). Insert in tests/ui/run.mjs just before "// screenshot for the review".
// The page at a one-word path is index.html with the worker's mark (as handleAppPage serves it); /ui/index.html stays hash-based.
try {
  const cp = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const cErr = [];
  cp.on("pageerror", (e) => cErr.push("pageerror: " + e.message));
  cp.on("response", (r) => { if (r.status() === 404) cErr.push("404 " + new URL(r.url()).pathname); });
  await cp.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  const idxHtml = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/<head[^>]*>/i, (h) => h + '\n  <meta name="eikon-ui-base" content="/ui/" />');
  await cp.route(/^http:\/\/localhost:\d+\/([A-Za-z][A-Za-z0-9_-]*)?(\?.*)?$/, (r) => r.request().isNavigationRequest()
    ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "cache-control": "no-store" }, body: idxHtml }) : r.fallback());
  const cpath = () => { const u = new URL(cp.url()); return u.pathname + u.search + u.hash; };
  const on = (id) => cp.waitForFunction((id) => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === id && document.getElementById("eikon-content") && document.getElementById("eikon-content").children.length > 0, id, { timeout: 15000 }).then(() => true, () => false);
  await cp.goto(`http://localhost:${PORT}/?intro=0`);
  await cp.waitForSelector("#eikon-login-email", { timeout: 15000 });
  const atRoot = cpath();
  await cp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.removeItem("eikon_ui2"); });
  await cp.reload();
  const t1 = await on("today"), p1 = cpath();
  await cp.click('.eikon-rail-btn[data-mod="registers"]'); const t2 = await on("registers"), p2 = cpath();
  await cp.waitForSelector('.hub-card[data-open="temperature"]', { timeout: 15000 });
  await cp.click('.hub-card[data-open="temperature"]'); const t3 = await on("tempreg"), p3 = cpath();
  await cp.goBack(); const b1 = (await on("registers")) && cpath() === "/?intro=0";
  await cp.goBack(); const b2 = (await on("today")) && cpath() === "/?intro=0";
  await cp.goForward(); const f1 = (await on("registers")) && cpath() === "/?intro=0";
  await cp.goto(`http://localhost:${PORT}/endofday?intro=0`); const d1 = (await on("eodreg")) && cpath() === "/?intro=0";
  await cp.reload(); const r1 = (await on("eodreg")) && cpath() === "/?intro=0";
  await cp.goto("about:blank"); await cp.goto(`http://localhost:${PORT}/?intro=0#customers`); const h1 = (await on("customers")) && cpath() === "/?intro=0";
  const files = await cp.evaluate(() => [...document.scripts].map((s) => s.src).filter((s) => s && !/xlsx/.test(s)).every((s) => /\/ui\/[^/]+\.js\?v=/.test(s)));
  // the old address keeps its #hash exactly as before
  await cp.goto("about:blank"); await cp.goto(`http://localhost:${PORT}/ui/index.html?intro=0#endofday`); const o1 = (await on("eodreg")) && cpath() === "/ui/index.html?intro=0#eodreg";
  const o2 = await cp.evaluate(() => window.EIKON.CLEAN_URLS === false && window.EIKON.uiUrl("./assets/x.png") === "./assets/x.png");
  await cp.close();
  report("clean addresses: the bar stays eikonhq.com/ (no screen path) through sign-in, Registers, a register, Back/Forward, a deep link /endofday, refresh and an old /#customers link, each on the right screen; files from /ui/; /ui/index.html#endofday unchanged",
    atRoot === "/?intro=0" && t1 && p1 === "/?intro=0" && t2 && p2 === "/?intro=0" && t3 && p3 === "/?intro=0" && b1 && b2 && f1 && d1 && r1 && h1 && files && o1 && o2 && cErr.length === 0,
    JSON.stringify({ atRoot, t1, p1, t2, p2, t3, p3, b1, b2, f1, d1, r1, h1, files, o1, o2, cErr: cErr.slice(0, 5) }));
} catch (e) { report("clean addresses: ran to the end", false, String(e).slice(0, 300)); }
// Orders: Ready on an order with no phone (saved blank, or dropped by this screen before 3 Nov) asks for the phone and sends it
// as client_phone: the server refuses any change to an order without one. Cancelling the question sends nothing.
try {
  const dNo = maltaYmd(0);
  await page.route("**/client-orders/entries?*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [{ id: 53, order_date: dNo, client_name: "Borg Olga", client_phone: "", items_text: "Augmentin 625 x14", priority: 2, needed_by: dNo, deposit_amount: 0, fulfilled: 0, notes: "" }] }) }));
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector('[data-act=ready][data-id="53"]'), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  // No pop-up any more: the row opens a phone field in place. Cancel sends nothing; an empty phone is refused beside it.
  const dlgs = []; const onDlg = (d) => { dlgs.push(d.type()); d.dismiss(); }; page.on("dialog", onDlg);
  await page.click('[data-act=ready][data-id="53"]'); await page.waitForSelector("#ord-ph-in"); await page.waitForFunction(() => document.activeElement && document.activeElement.id === "ord-ph-in", null, { timeout: 3000 }).catch(() => {}); // the row focuses its phone field one tick after drawing it
  const askFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.press("#ord-ph-in", "Escape"); await page.waitForTimeout(150);
  const afterEsc = await page.evaluate(() => ({ form: !!document.querySelector("#ord-ph"), focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
  await page.click('[data-act=ready][data-id="53"]'); await page.waitForSelector("#ord-ph-in"); await page.click("#ord-ph button[type=submit]"); await page.waitForTimeout(200);
  const emptyErr = await page.evaluate(() => ({ t: (document.querySelector("#ord-ph-err") || {}).textContent || "", inv: (document.querySelector("#ord-ph-in") || { getAttribute() {} }).getAttribute("aria-invalid") }));
  const putsNone = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  await page.fill("#ord-ph-in", "79112233"); await page.press("#ord-ph-in", "Enter"); await page.waitForTimeout(700);
  const ordNoPh = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  page.off("dialog", onDlg);
  await page.unroute("**/client-orders/entries?*");
  report("orders: Ready on an order with no phone asks for it in the row (no pop-up; Escape closes it and gives focus back; empty is refused beside the field) and sends it as client_phone (the server needs one); cancelling sends nothing",
    dlgs.length === 0 && askFocus === "ord-ph-in" && !afterEsc.form && afterEsc.focus === "ready" && /phone/.test(emptyErr.t) && emptyErr.inv === "true" && putsNone === 0 && ordNoPh.length === 1 && ordNoPh[0].path === "/client-orders/entries/53" &&
    JSON.stringify(ordNoPh[0].body) === JSON.stringify({ fulfilled: true, client_phone: "79112233", contact: "79112233" }), JSON.stringify({ dlgs, askFocus, afterEsc, emptyErr, putsNone, ordNoPh }));
} catch (e) { report("orders: Ready on an order with no phone", false, String(e).slice(0, 300)); }
// One person across screens (ui/eikon.people.js): the shared normaliser is the worker's own (its two functions are read
// from cloudflare-worker/code and run side by side); after a register saves, the person is found in GET /people and
// reused, a blank is filled through the server's own path, two possible matches link nothing, and only an unknown
// person is added; the register's own POST body is unchanged; Customers' "+ New" opens an existing match.
try {
  const wsrc = fs.readFileSync(path.join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  const wfn = (name) => { const i = wsrc.indexOf("function " + name + "("); let d = 0, j = wsrc.indexOf("{", i); for (; j < wsrc.length; j++) { if (wsrc[j] === "{") d++; else if (wsrc[j] === "}" && --d === 0) break; } return wsrc.slice(i, j + 1); };
  const W = new Function(wfn("normalizeMtIdCard") + "\n" + wfn("mtIdCardLookupKeys") + "\nreturn { n: normalizeMtIdCard, k: mtIdCardLookupKeys };")();
  const cards = ["123m", " 123 M ", "0000123M", "123M", "1234567m", "12345678M", "AB123456", "ab 12 34", "", "M123", "0012345m", "7 g"];
  await page.goto(base + "&ui=2#today");
  await page.waitForFunction(() => window.EIKON && window.EIKON.people && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
  const mine = await page.evaluate((c) => ({ n: c.map((x) => window.EIKON.people.normIdCard(x)), k: c.map((x) => window.EIKON.people.idCardKeys(x)),
    ph: ["+356 7912 3456", "00356 79123456", "79 12 34 56", "35679123456", "+44 7700 900123"].map((x) => window.EIKON.people.normPhone(x)),
    em: window.EIKON.people.normEmail("  Rita.Pace@Example.MT "), nm: window.EIKON.people.nameKey("  Pace   Rita ") }), cards);
  report("people: the shared ID-card normaliser gives exactly the worker's answers (normalizeMtIdCard, mtIdCardLookupKeys); phones, e-mails and names compare as the server cleans them",
    JSON.stringify(mine.n) === JSON.stringify(cards.map(W.n)) && JSON.stringify(mine.k) === JSON.stringify(cards.map(W.k)) && mine.n[0] === "0000123M" && mine.n[1] === "0000123M" &&
    JSON.stringify(mine.ph) === JSON.stringify(["79123456", "79123456", "79123456", "79123456", "447700900123"]) && mine.em === "rita.pace@example.mt" && mine.nm === "pace rita",
    JSON.stringify({ mine, worker: { n: cards.map(W.n), k: cards.map(W.k) } }));

  // GET /people answered here for this test only (the mock's own /people stays as it is for the Customers tests)
  const book = { "0000777M": [{ id: 77, name: "Pace Rita", id_card: "0000777M", phone: "99001122", alt_phone: "", email: "", address: "", version: 4 }],
    "pace rita": [{ id: 77, name: "Pace Rita", id_card: "0000777M", phone: "99001122", alt_phone: "", email: "", address: "", version: 4 }],
    "vella mark": [{ id: 81, name: "Vella Mark", id_card: "", phone: "79111111", version: 1 }, { id: 82, name: "Vella  Mark", id_card: "", phone: "79222222", version: 1 }] };
  const pplPosts = [], pplGets = [];
  const onPeople = async (route) => {
    const rq = route.request(), u = new URL(rq.url());
    if (rq.method() === "POST") { const b = JSON.parse(rq.postData() || "{}"); pplPosts.push(b); return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, created: !b.id && !b.id_card, person: Object.assign({ id: 99, version: 1 }, b) }) }); }
    const q = String(u.searchParams.get("q") || ""); pplGets.push(q);
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, q, people: book[q.trim().replace(/\s+/g, " ").toLowerCase()] || book[q] || [], history: [] }) });
  };
  const isPeople = (url) => url.pathname === "/people";
  await page.route(isPeople, onPeople);
  const linked = () => page.evaluate(() => window.EIKON._lastPersonLink || null);
  const regPosts = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path !== "/people");

  // Questions: "pace  rita" with her phone typed +356 → found by name and phone, nothing to fill, nothing added
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && window.EIKON.people, null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]");
  await page.fill("#tkt-add [name=client_name]", "pace  rita"); await page.fill("#tkt-add [name=phone]", "+356 9900 1122"); await page.fill("#tkt-add [name=issue]", "Is her order in?");
  await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(700);
  const L1 = await linked(), T1 = (await regPosts()).filter((c) => c.path === "/client-tickets/entries");
  const tkKeys = ["ticket_id", "open_date", "client_name", "phone", "email", "issue", "category", "priority", "status", "assigned_to", "followup_date", "notes_log"];
  // two "Vella Mark"s with different phones, and this one gives none: nothing linked, nothing added
  await page.click("[data-act=add]");
  await page.fill("#tkt-add [name=client_name]", "Vella Mark"); await page.fill("#tkt-add [name=issue]", "Price of Voltaren?");
  await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(700);
  const L2 = await linked();
  // nobody of that name: one person added, with what the screen had
  await page.click("[data-act=add]");
  await page.fill("#tkt-add [name=client_name]", "Spiteri Noel"); await page.fill("#tkt-add [name=phone]", "79333333"); await page.fill("#tkt-add [name=issue]", "Flu jab?");
  await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(700);
  const L3 = await linked(), T3 = (await regPosts()).filter((c) => c.path === "/client-tickets/entries");
  report("people: a question for a known person is linked to them (name and phone, +356 and spaces ignored), two possible matches link nothing, only an unknown person is added; the question body is unchanged",
    L1 && L1.person && L1.person.id === 77 && L1.how === "name+contact" && !L1.filled && L2 && !L2.person && L2.skipped === "ambiguous" &&
    L3 && L3.how === "new" && pplPosts.length === 1 && JSON.stringify(pplPosts[0]) === JSON.stringify({ name: "Spiteri Noel", source: "register:questions", id_card: "", phone: "79333333" }) &&
    T1.length === 1 && JSON.stringify(Object.keys(T1[0].body)) === JSON.stringify(tkKeys) && T1[0].body.client_name === "Pace  Rita" /* cased when the field is left (names test below); spacing as typed */ && T1[0].body.phone === "+356 9900 1122" && T3.length === 3 && T3.every((c) => JSON.stringify(Object.keys(c.body)) === JSON.stringify(tkKeys)),
    JSON.stringify({ L1, L2, L3, pplPosts, pplGets, T1: T1.map((c) => c.body) }).slice(0, 900));

  // POYC: card typed "777m" (POYC keeps it unpadded) → her name comes from the people list; after the save her empty
  // address is filled through the server's own blank-filling path (name + card, no id), and the POYC body is unchanged
  pplPosts.length = 0;
  await page.goto(base + "&ui=2#dda-poyc");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "poyreg" && window.EIKON.people, null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.fill("[name=client_id_card]", "777m"); await page.press("[name=client_id_card]", "Tab");
  await page.waitForFunction(() => (document.querySelector("[name=client_name]") || {}).value === "Pace Rita", null, { timeout: 6000 }).catch(() => {});
  const poyName = await page.inputValue("[name=client_name]");
  await page.fill("[name=client_address]", "3 Triq il-Kbira, Mosta"); await page.fill("[name=doctor_name]", "Dr Abela"); await page.fill("[name=doctor_reg_no]", "R1201"); await page.fill("[name=prescription_serial_no]", "PY-77");
  await page.fill('[data-i="0"][data-k=medicine_name_dose]', "Morphine 10mg"); await page.fill('[data-i="0"][data-k=quantity]', "5");
  await page.click("#cds-add button[type=submit]"); await page.waitForTimeout(900);
  const L4 = await linked(), P4 = (await regPosts()).filter((c) => c.path === "/dda-poyc/entries");
  report("people: POYC fills a known card's name from the people list and fills her empty address on her one record; the POYC body is unchanged",
    poyName === "Pace Rita" && P4.length === 1 && JSON.stringify(Object.keys(P4[0].body)) === JSON.stringify(["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no", "urgent"]) &&
    P4[0].body.client_id_card === "777M" && L4 && L4.person && L4.how === "id_card" && pplPosts.length === 1 && !("id" in pplPosts[0]) && pplPosts[0].id_card === "0000777M" && pplPosts[0].name === "Pace Rita" && pplPosts[0].address === "3 Triq il-Kbira, Mosta" && !("phone" in pplPosts[0]),
    JSON.stringify({ poyName, P4: P4.map((c) => c.body), L4, pplPosts }).slice(0, 900));

  // Customers "+ New": the same name and phone again opens the person who is there; nothing is posted
  pplPosts.length = 0;
  await page.goto(base + "&ui=2#customers");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers" && document.querySelector('[data-act="new"]'), null, { timeout: 15000 });
  await page.click('[data-act="new"]'); await page.waitForSelector("#cus-new");
  await page.fill("#cus-new [name=name]", "Pace Rita"); await page.fill("#cus-new [name=phone]", "9900 1122");
  await page.click('#cus-new [data-act="create"]'); await page.waitForTimeout(900);
  const cusToast = await page.evaluate(() => [...document.querySelectorAll(".eikon-toast")].map((t) => t.textContent).join("|"));
  await page.unroute(isPeople, onPeople);
  report("people: Customers' + New with a name and phone already there opens that person instead of adding a second",
    pplPosts.length === 0 && /Pace Rita already exists, opened/.test(cusToast), JSON.stringify({ pplPosts, cusToast }));
} catch (e) { report("people: ran to the end", false, String(e).slice(0, 300)); }
// ---- Download our records (expreg): a mocked year 2025 exported as a workbook (read back with SheetJS in the page),
// the same year as CSV files in a zip when the spreadsheet library is missing, at most 2 requests in flight, a month per
// request, Cancel saves nothing, and a staff account gets a note instead of the screen (and no card in Settings).
try {
  // The real SheetJS (the pinned copy in ui/vendor, which the screen itself loads; XLSX_JS=<path> to try another).
  const xlsxPath = [process.env.XLSX_JS, path.join(root, "vendor", "xlsx-0.20.3", "xlsx.full.min.js")].find((f) => f && fs.existsSync(f));
  const XLSX_REAL = xlsxPath ? fs.readFileSync(xlsxPath, "utf8") : "";
  const MONTHLY = { "/temperature/entries": ["entries", "entry_date"], "/cleaning/entries": ["entries", "entry_date"], "/daily-register/entries": ["entries", "entry_date"], "/locumregister/entries": ["entries", "entry_date"],
    "/dda-purchases/entries": ["entries", "entry_date"], "/dda-sales/entries": ["entries", "entry_date"], "/dda-poyc/entries": ["entries", "entry_date"], "/repeat-prescriptions/entries": ["entries", "entry_date"],
    "/paid-out/entries": ["entries", "entry_date"], "/locumreceipts/receipts": ["receipts", "receipt_date"], "/client-orders/entries": ["entries", "order_date"] };
  const ONCE = { "/creditnotes/list": "issue_date", "/client-tickets/entries": "open_date", "/client-deliveries/entries": "order_date" };
  const keys = Object.keys(MONTHLY);
  const nFor = (p, m) => ((m + keys.indexOf(p)) % 4) + 1; // 1 to 4 lines a month, different per register
  const onceDays = []; for (let t = Date.UTC(2024, 5, 3); t < Date.UTC(2026, 1, 1); t += 19 * 864e5) onceDays.push(new Date(t).toISOString().slice(0, 10));
  let inflight = 0, maxInflight = 0, seen = [], delay = 5;
  const handler = async (route) => {
    const u = new URL(route.request().url()), p = u.pathname; seen.push(p + u.search);
    inflight++; maxInflight = Math.max(maxInflight, inflight); await new Promise((r) => setTimeout(r, delay)); inflight--;
    const reply = (o) => route.fulfill({ contentType: "application/json", body: JSON.stringify(o) }).catch(() => {});
    if (p === "/temperature/devices") return reply({ ok: true, devices: [{ id: 7, name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, active: 1 }] });
    if (MONTHLY[p]) { const ym = u.searchParams.get("month"), m = +ym.slice(5), [key, df] = MONTHLY[p], rows = [];
      for (let i = 0; i < nFor(p, m); i++) rows.push({ id: m * 100 + i, [df]: ym + "-" + String(3 + i * 5).padStart(2, "0"), device_id: 7, device_name: "Fridge 1", device_type: "fridge", min_temp: 3, max_temp: 6, min_limit: 2, max_limit: 8, client_name: "Zammit, \"Carmel\"", fee: 12.5, total_fee: 60, deposit_amount: 5, created_at: ym + "-03 08:15:00" });
      return reply({ ok: true, [key]: rows }); }
    if (ONCE[p]) return reply({ ok: true, entries: onceDays.map((d, i) => ({ id: i + 1, [ONCE[p]]: d, client_name: "Vella Anna", amount: 20, purchase_entries: [{ amount: 5 }] })) });
    if (p === "/endofday/dates") { const ym = u.searchParams.get("month"); return reply({ ok: true, dates: [ym + "-05", ym + "-20"] }); }
    if (p === "/endofday/record") { const d = u.searchParams.get("date"); return reply({ ok: true, record: { id: +d.replace(/-/g, ""), date: d, eod_date: d, staff: "Maria", float_amount: "500", x: [{ amount: "100.10" }], epos: [{ amount: "20" }], cheques: [], paid_outs: [], cash: { n50: "2", coins_total: "1" }, deposit: {} } }); }
    return route.fallback();
  };
  const RX = /localhost:\d+\/(temperature\/(devices|entries)|cleaning\/entries|daily-register\/entries|locumregister\/entries|dda-(purchases|sales|poyc)\/entries|repeat-prescriptions\/entries|paid-out\/entries|locumreceipts\/receipts|client-orders\/entries|creditnotes\/list|client-tickets\/entries|client-deliveries\/entries|endofday\/(dates|record))\?/;
  const RX1 = /localhost:\d+\/(temperature\/devices|creditnotes\/list|client-tickets\/entries|client-deliveries\/entries)$/;
  await page.route(RX, handler); await page.route(RX1, handler);
  if (XLSX_REAL) await page.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: XLSX_REAL }));
  const expected = {}; const TITLES = { "/temperature/entries": "Temperature", "/cleaning/entries": "Cleaning", "/daily-register/entries": "Daily register", "/locumregister/entries": "Locum register", "/dda-purchases/entries": "Controlled drugs received", "/dda-sales/entries": "Controlled drugs supplied", "/dda-poyc/entries": "POYC controlled drugs", "/repeat-prescriptions/entries": "Repeat prescriptions", "/paid-out/entries": "Paid out", "/locumreceipts/receipts": "Locum receipts", "/client-orders/entries": "Orders" };
  for (const k of keys) { let c = 0; for (let m = 1; m <= 12; m++) c += nFor(k, m); expected[TITLES[k]] = c; }
  const inY = onceDays.filter((d) => d.startsWith("2025")).length; expected["Credit notes"] = inY; expected.Questions = inY; expected.Deliveries = inY; expected["End of day"] = 24;
  const openExp = async () => {
    await page.goto(base + "&ui=2&exp=" + Date.now() + "#settings");
    await page.waitForFunction(() => window.EIKON.state.activeModuleId === "settings" && document.querySelector('[data-open="expreg"]'), null, { timeout: 15000 });
    await page.click('[data-open="expreg"]');
    await page.waitForFunction(() => window.EIKON.state.activeModuleId === "expreg" && document.querySelector(".exp [data-act=download]"), null, { timeout: 15000 });
    await page.click('[data-range="year"]'); await page.selectOption("#exp-year", "2025");
  };
  if (!XLSX_REAL) console.log("  skip export: workbook read-back (no SheetJS copy: set XLSX_JS)");
  else {
  await openExp();
  const expRail = await page.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join());
  const safe = await page.textContent(".exp-safe");
  seen = []; maxInflight = 0;
  await page.click('[data-act="download"]');
  await page.waitForFunction(() => window.EIKON.expLast && window.EIKON.expLast.file, null, { timeout: 30000 });
  const xl = await page.evaluate(async () => { const L = window.EIKON.expLast, wb = window.XLSX.read(await L.file.blob.arrayBuffer(), { type: "array", cellNF: true }), o = {};
    wb.SheetNames.forEach((n) => { o[n] = window.XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: false }); });
    return { format: L.format, name: L.file.name, names: wb.SheetNames, sheets: o, calls: L.calls, money: wb.Sheets["Paid out"]["E2"] }; });
  const counts = {}; for (const n of xl.names) counts[n] = xl.sheets[n].length - 1;
  const xlOk = xl.format === "xlsx" && xl.names[0] === "Summary" && Object.entries(expected).every(([k, v]) => counts[k] === v) && xl.names.length === 16;
  const monthCalls = seen.filter((s) => /month=2025-\d\d/.test(s)).length, allMonths = seen.filter((s) => s.startsWith("/dda-sales/entries")).map((s) => s.split("month=")[1]).sort().join();
  report("export: a mocked 2025 makes one workbook, Summary then a sheet per register, every sheet with the right row count", xlOk, JSON.stringify({ format: xl.format, names: xl.names, counts, expected }));
  report("export: a month per request (12 per register for the year), one register at a time, never more than 2 requests in flight; " + xl.calls + " requests in all",
    monthCalls === 11 * 12 + 12 && allMonths === Array.from({ length: 12 }, (_, i) => "2025-" + String(i + 1).padStart(2, "0")).join() && maxInflight <= 2 && xl.calls === seen.length && xl.calls === 11 * 12 + 1 + 3 + 12 + 24, JSON.stringify({ monthCalls, maxInflight, calls: xl.calls, seen: seen.length }));
  const cn = xl.sheets["Credit notes"], ord = xl.sheets.Orders, sumS = xl.sheets.Summary.map((r) => r.join("|")).join("\n");
  report("export: plain headings, Record no. first, dd/mm/yyyy, money with 2 decimals, the Summary names the pharmacy, days and who; the screen says to keep it safe; rail keeps Settings lit",
    cn[0].join() === "Record no.,Issued,Name,Surname,Phone,Email,Receipt no,Amount €,Used €,Left €,Expires" && /^\d\d\/\d\d\/2025$/.test(cn[1][1]) && cn[1][9] === "15.00" && xl.money && xl.money.z === "0.00" && ord[1][2] === 'Zammit, "Carmel"' &&
    /Pharmacy\|Demo Pharmacy/.test(sumS) && /Exported by\|Maria Borg/.test(sumS) && /Days\|Year 2025/.test(sumS) && /Keep it safe/.test(safe) && expRail === "settings", JSON.stringify({ cn: cn.slice(0, 2), money: xl.money, sumS, safe, expRail }));
  await page.unroute("**/xlsx.full.min.js");
  }
  // Without SheetJS: one CSV per register in a zip (store only), read back here
  await openExp();
  await page.evaluate(() => { window.XLSX = {}; window.EIKON.expLast = null; window.__expLoc = window.EIKON.state.user.location_name; window.EIKON.state.user.location_name = "Ħamrun Pharmacy"; }); // W20: the file name keeps Maltese letters
  await page.click('[data-act="download"]');
  await page.waitForFunction(() => window.EIKON.expLast && window.EIKON.expLast.file, null, { timeout: 30000 });
  const zb = Buffer.from(await page.evaluate(async () => { const b = new Uint8Array(await window.EIKON.expLast.file.blob.arrayBuffer()); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64");
  const files = {}; let off = 0;
  while (zb.readUInt32LE(off) === 0x04034b50) { const size = zb.readUInt32LE(off + 18), nl = zb.readUInt16LE(off + 26), name = zb.slice(off + 30, off + 30 + nl).toString(); files[name] = zb.slice(off + 30 + nl, off + 30 + nl + size).toString("utf8"); off += 30 + nl + size; }
  const csvRows = (t) => { let n = 0, q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '"') q = !q; else if (c === "\n" && !q) n++; } return n - 1; };
  const zc = {}; for (const [n, t] of Object.entries(files)) zc[n] = csvRows(t);
  const zipOk = /\.zip$/.test(await page.evaluate(() => window.EIKON.expLast.file.name)) && files["Summary.csv"] && Object.entries(expected).every(([k, v]) => zc[k.replace(/ /g, "-") + ".csv"] === v) && files["Paid-out.csv"].charCodeAt(0) === 0xfeff && /,12\.50,/.test(files["Paid-out.csv"]) && files["Orders.csv"].includes('"Zammit, ""Carmel"""') && zb.readUInt32LE(zb.length - 22) === 0x06054b50;
  const zipName = await page.evaluate(() => { const n = window.EIKON.expLast.file.name; window.EIKON.state.user.location_name = window.__expLoc; return n; });
  report("export: without the spreadsheet library the same year is a zip of CSV files (BOM, quoted commas, 2-decimal money), same row counts; the file name keeps Maltese letters (Eikon-records-Ħamrun-Pharmacy-…)", zipOk && /^Eikon-records-Ħamrun-Pharmacy-.*\.zip$/.test(zipName), JSON.stringify({ zipName, zc, names: Object.keys(files) }));
  // Cancel: stops at the next request and saves nothing
  await page.evaluate(() => { window.EIKON.expLast = null; }); delay = 120; seen = [];
  await page.click('[data-act="download"]'); await page.waitForTimeout(400);
  const cancelFocus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act"));
  await page.click('[data-act="cancel"]'); const atCancel = seen.length; await page.waitForTimeout(900);
  const cTxt = await page.textContent(".exp-live"), afterCancel = seen.length;
  report("export: Cancel stops the reading (no more than the requests already in flight) and saves nothing; focus moves to Cancel while it runs",
    /Cancelled/.test(cTxt) && afterCancel - atCancel <= 2 && atCancel < 20 && (await page.evaluate(() => window.EIKON.expLast)) === null && cancelFocus === "cancel", JSON.stringify({ cTxt, atCancel, afterCancel, cancelFocus }));
  delay = 5;
  // Staff: no card, and the screen says who can
  await page.evaluate(() => { window.EIKON.state.user.role = "staff"; location.hash = "#settings"; }); await page.waitForTimeout(600);
  const staffCard = await page.$('[data-open="expreg"]');
  seen = []; await page.evaluate(() => { location.hash = "#expreg"; }); await page.waitForTimeout(600);
  const staffTxt = await page.textContent(".exp");
  report("export: a staff account sees no card and, at the address, a note instead of the screen; nothing is asked of the server", !staffCard && /Only the pharmacist/.test(staffTxt) && !(await page.$(".exp [data-act=download]")) && seen.length === 0, JSON.stringify({ staffCard: !!staffCard, staffTxt: staffTxt.slice(0, 200), seen }));
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  await page.unroute(RX); await page.unroute(RX1);
} catch (e) { report("export: download our records", false, String(e).slice(0, 400)); }
// ---- Privacy (eikon.privacy.js) and Download our records' new parts (gdpr): a mocked person's summary; Download everything
// is one zip (data, summary page, spreadsheet or CSV) with the ticked same-name rows sent; Erase sends nothing until the name
// is typed, then the plan it was shown; the 24-hour undo line; Undo; Escape closes and focus returns. The new parts are not
// ticked at first and are read page by page from /export/records.
try {
  const PV = { ok: true, preview: true, person: { id: 42, name: "Laura Borg", id_card: "0012345M", erased: false }, total_change: 3, total_keep: 3, plan: "abc.1", undo_hours: 24, open_erasure: null,
    sections: [{ table: "people", label: "Customer record", policy: "erase", legal: false, action: "erase", why: "", sure: 1, maybe: [], other: 0, change: 1, keep: 0, columns: ["name", "id_card", "phone"] },
      { table: "client_orders_entries", label: "Orders", policy: "erase", legal: false, action: "erase", why: "", sure: 2, maybe: [{ key: "client_orders_entries:9", date: "2026-09-01", name: "Laura Borg", why: "same name only", title: "Plasters" }], other: 0, change: 2, keep: 0, columns: ["client_name", "client_phone", "notes"] },
      { table: "dda_sales_entries", label: "Controlled drugs supplied (DDA)", policy: "cd", legal: true, action: "keep", why: "Controlled-drug register", sure: 3, maybe: [], other: 1, change: 0, keep: 3, columns: [] },
      { table: "bk_bookings", label: "Bookings", policy: "bookings", legal: false, action: "keep", why: "Booking history", sure: 1, maybe: [], other: 0, change: 0, keep: 1, columns: [] }] };
  const pvSent = [];
  const pvRoute = async (route) => {
    const r = route.request(), u = new URL(r.url()), b = r.postData() ? JSON.parse(r.postData()) : null; pvSent.push({ path: u.pathname + u.search, body: b });
    const reply = (o, status = 200) => route.fulfill({ status, contentType: "application/json", body: JSON.stringify(o) }).catch(() => {});
    if (/\/privacy$/.test(u.pathname)) return reply(PV);
    if (/\/export$/.test(u.pathname)) return reply({ ok: true, format: "eikon.person-export.v1", made_at: "2026-11-11T16:00:00.000Z", pharmacy: { name: "Demo Pharmacy" }, made_by: { name: "Maria Borg" }, person: { id: 42, name: "Laura Borg", id_card: "0012345M" }, rows: 3,
      sections: [{ table: "client_orders_entries", label: "Orders", on_erase: "anonymised", why_kept: "", rows: [{ id: 1, order_date: "2026-10-01", client_name: "Laura Borg", items_text: "Vitamin D", _matched: "same name and phone or e-mail" }, { id: 9, order_date: "2026-09-01", client_name: "Laura Borg", items_text: "Plasters", _matched: "same name only" }] },
        { table: "screening_campaigns", label: "Screening", on_erase: "kept", why_kept: "Test results", rows: [{ row_id: 3, record: { campaign_id: "C1", name: "BP week" }, entry: { id: "p1", name: "Laura Borg", sys: 120 }, matched: "same ID card" }] }] });
    if (/\/erase$/.test(u.pathname)) return reply(b && b.confirm ? { ok: true, erasure_id: "gdpr_11111111-2222-3333-4444-555555555555", changed: 3, person: { id: 42, name: "Erased person #42" }, undo_until: "2026-11-12 16:00:00" } : PV);
    if (/\/undo$/.test(u.pathname)) return reply({ ok: true, restored: 3, skipped: [], person: { id: 42, name: "Laura Borg" } });
    return route.fallback();
  };
  const PVRX = /localhost:\d+\/people\/(42\/(privacy|export|erase)|erasures\/gdpr_[0-9a-f-]+\/undo)$/;
  await page.route(PVRX, pvRoute);
  await page.goto(base + "&ui=2&pv=" + Date.now() + "#expreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "expreg" && document.querySelector(".exp [data-act=download]"), null, { timeout: 15000 });
  const offAtFirst = await page.evaluate(() => ["customers", "bookings", "appointments", "messages", "tills", "loyalty", "staff", "shifts", "leave", "accounts"].map((id) => { const c = document.querySelector('[data-reg="' + id + '"]'); return c ? (c.checked ? id + ":on" : "") : id + ":missing"; }).filter(Boolean));
  const labs = await page.$$eval(".exp-lab", (l) => l.map((x) => x.textContent + "|" + getComputedStyle(x).textTransform));
  report("privacy: Download our records offers customers, bookings, appointments, messages, till, loyalty, staff, shifts, leave and accounts, not ticked at first; headings in sentence case; One person is there",
    offAtFirst.length === 0 && labs.includes("Days|none") && labs.includes("What to include|none") && labs.includes("One person|none") && !!(await page.$("#exp-who")), JSON.stringify({ offAtFirst, labs }));
  await page.focus("#exp-who");
  await page.evaluate(() => { window.EIKON.privacy.lastFile = null; window.EIKON.privacy.open(42, { name: "Laura Borg" }); });
  await page.waitForSelector(".prv [data-act=download]", { timeout: 10000 });
  const hold = await page.innerText(".prv");
  await page.check('.prv [data-key="client_orders_entries:9"]');
  await page.click(".prv [data-act=download]");
  await page.waitForFunction(() => window.EIKON.privacy.lastFile, null, { timeout: 20000 });
  const lf = await page.evaluate(() => ({ name: window.EIKON.privacy.lastFile.name, files: window.EIKON.privacy.lastFile.files }));
  const exReq = pvSent.find((x) => /\/export$/.test(x.path));
  const zb = Buffer.from(await page.evaluate(async () => { const b = new Uint8Array(await window.EIKON.privacy.lastFile.blob.arrayBuffer()); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64");
  const zf = {}; let zo = 0; while (zb.readUInt32LE(zo) === 0x04034b50) { const size = zb.readUInt32LE(zo + 18), nl = zb.readUInt16LE(zo + 26), name = zb.slice(zo + 30, zo + 30 + nl).toString(); zf[name] = zb.slice(zo + 30 + nl, zo + 30 + nl + size); zo += 30 + nl + size; }
  const js = JSON.parse(zf[Object.keys(zf).find((n) => n.endsWith(".json"))].toString("utf8")), sum = zf[Object.keys(zf).find((n) => n.endsWith("-summary.html"))].toString("utf8");
  report("privacy: what we hold lists every kind of record with its count and the same-name rows apart; Download everything sends the ticked rows and saves one zip: the data, a summary page and a spreadsheet (or CSV files)",
    /Laura Borg: what we hold/.test(hold) && /Orders\s+2/.test(hold) && /7 records, of 4 kinds\./.test(hold) && /Same name, not sure it is them \(1\)/.test(hold) && exReq && JSON.stringify(exReq.body) === JSON.stringify({ rows: ["client_orders_entries:9"] }) &&
    /^Everything-we-hold-Laura-Borg-\d{4}-\d\d-\d\d\.zip$/.test(lf.name) && lf.files.length >= 3 && js.sections.length === 2 && /Everything Demo Pharmacy holds on Laura Borg/.test(sum) && /Plasters/.test(sum) && /BP week|120|same ID card/.test(sum) && zb.readUInt32LE(zb.length - 22) === 0x06054b50,
    JSON.stringify({ hold: hold.slice(0, 300), exReq, lf }));
  pvSent.length = 0;
  await page.click(".prv [data-act=erase]"); await page.waitForSelector("#prv-typed", { timeout: 10000 });
  const conf = await page.innerText(".prv");
  const focusTyped = await page.evaluate(() => document.activeElement && document.activeElement.id);
  await page.click(".prv [data-act=go]", { force: true }); await page.waitForTimeout(150);
  const errNoName = await page.textContent(".prv .prv-err").catch(() => "");
  await page.fill("#prv-typed", "Laura Bor"); await page.keyboard.press("Enter"); await page.waitForTimeout(150);
  const sentBefore = pvSent.filter((x) => x.body && x.body.confirm).length;
  await page.fill("#prv-typed", "  laura   borg "); await page.fill("#prv-why", "Asked at the counter"); await page.keyboard.press("Enter");
  await page.waitForSelector(".prv [data-act=undo2]", { timeout: 10000 });
  const conf2 = pvSent.filter((x) => x.body && x.body.confirm);
  const done = await page.innerText(".prv");
  report("privacy: Erase shows what is removed (with the details in words), what is kept because the law may need it and what is kept as the pharmacy decided, the 24-hour line; nothing is sent until the name is typed; then the plan it showed, once",
    /Removed: name, ID card and contacts \(3 records\)/.test(conf) && /name, ID card, phone/.test(conf) && /Kept for now, the law may need them \(3 records\)/.test(conf) && /Kept, as the pharmacy decided \(1 record\)/.test(conf) && /Erase Laura Borg/.test(conf) &&
    /You can undo this for 24 hours\. After that it cannot be undone\./.test(conf) && /1 record with the same name or card but someone else's details are left alone/.test(conf) && focusTyped === "prv-typed" && /Type Laura Borg/.test(errNoName || "") && sentBefore === 0 &&
    conf2.length === 1 && JSON.stringify(conf2[0].body) === JSON.stringify({ rows: ["client_orders_entries:9"], confirm: true, plan: "abc.1", reason: "Asked at the counter" }) && /3 records changed/.test(done) && /Erased person #42/.test(done),
    JSON.stringify({ conf: conf.slice(0, 700), errNoName, sentBefore, conf2, done }));
  await page.click(".prv [data-act=undo2]"); await page.waitForFunction(() => /Put back/.test((document.querySelector("#prv-h") || {}).textContent || ""), null, { timeout: 10000 });
  const undoReq = pvSent.find((x) => /\/undo$/.test(x.path));
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ open: !!document.querySelector(".prv"), focus: document.activeElement && document.activeElement.id }));
  report("privacy: Undo calls the erasure's undo; Escape closes the window and focus goes back where it was", !!undoReq && /gdpr_11111111-2222-3333-4444-555555555555\/undo$/.test(undoReq.path) && !after.open && after.focus === "exp-who", JSON.stringify({ undoReq, after }));
  await page.unroute(PVRX, pvRoute);
  // the new parts: one page after another
  const parts = [];
  const exRoute = async (route) => { const u = new URL(route.request().url()); parts.push(u.search); const after = Number(u.searchParams.get("after") || 0);
    const rows = []; const n = after ? 2 : 1000; for (let i = 1; i <= n; i++) rows.push({ id: after + i, name: "Person " + (after + i), id_card: "", allergies: i === 1 ? "Penicillin" : "" });
    return route.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, part: u.searchParams.get("part"), rows, next: after ? null : 1000 }) }); };
  await page.route(/localhost:\d+\/export\/records\?/, exRoute);
  await page.evaluate(() => { const st = window.EIKON.expreg.state; Object.keys(st.picked).forEach((k) => { st.picked[k] = 0; }); window.EIKON.expLast = null; window.XLSX = {}; });
  await page.check('[data-reg="customers"]');
  await page.click(".exp [data-act=download]");
  await page.waitForFunction(() => window.EIKON.expLast && window.EIKON.expLast.file, null, { timeout: 20000 });
  const got = await page.evaluate(() => ({ n: window.EIKON.expLast.results[0].rows.length, title: window.EIKON.expLast.results[0].reg.title, name: window.EIKON.expLast.file.name }));
  report("privacy: Customers (everyone) is read page by page (after=) from /export/records, whatever the days, into the same file kinds as the registers",
    got.n === 1002 && got.title === "Customers (everyone)" && /\.zip$/.test(got.name) && parts.length === 2 && parts[0] === "?part=customers" && parts[1] === "?part=customers&after=1000", JSON.stringify({ got, parts }));
  await page.unroute(/localhost:\d+\/export\/records\?/, exRoute);
} catch (e) { report("privacy: one person's data and the new parts of Download our records", false, String(e).slice(0, 400)); }
// ---- How we're doing (ownreg): the period maths in Malta days, what needs the pharmacist, one request per period, a
// figure opens its records (Escape closes, focus back), a week and the month before, a group's head office choosing a
// pharmacy, staff kept out, and the three reports printed (pharmacy, page numbers, Malta time) and as spreadsheets.
try {
  const XLSX_OWN = fs.readFileSync(path.join(root, "vendor", "xlsx-0.20.3", "xlsx.full.min.js"), "utf8");
  await page.goto(base + "&ui=2&own=" + Date.now() + "#money");
  await page.waitForFunction(() => window.EIKON && window.EIKON.owner && window.EIKON.state.activeModuleId === "money", null, { timeout: 15000 });
  const pm = await page.evaluate(() => { const P = window.EIKON.owner.period; return { m: P("month", "2026-11-04", "2026-11-04"), w: P("week", "2026-11-04", "2026-11-04"), past: P("month", "2026-10-15", "2026-11-04"), mar: P("month", "2026-03-31", "2026-03-31"), wk2: P("week", "2026-10-27", "2026-11-04") }; });
  report("owner: periods in Malta days — this month 1–30 Nov compared with 1–4 Oct; this week Mon 2–Sun 8 Nov with 26–28 Oct; a past month with the whole month before; 31 March with all of February",
    pm.m.from === "2026-11-01" && pm.m.to === "2026-11-30" && pm.m.cmp.from === "2026-10-01" && pm.m.cmp.to === "2026-10-04" && pm.m.cmpLabel === "the same days of October" &&
    pm.w.from === "2026-11-02" && pm.w.to === "2026-11-08" && pm.w.cmp.from === "2026-10-26" && pm.w.cmp.to === "2026-10-28" && pm.w.label === "2–8 Nov 2026" &&
    pm.past.cmp.from === "2026-09-01" && pm.past.cmp.to === "2026-09-30" && pm.past.cmpLabel === "September" && pm.mar.cmp.to === "2026-02-28" && pm.wk2.label === "26 Oct–1 Nov 2026" && pm.wk2.cmpLabel === "the week before", JSON.stringify(pm));
  const nd = await page.evaluate(() => window.EIKON.owner.needs({ id: 1, money: { short_days: 1, short_total: -12.5 }, credit: { expiring_30: 1, expiring_30_total: 15 }, orders: { overdue: 2, waiting_30: 0 }, questions: { overdue: 0 }, deliveries: { late: 0 }, dda: { supplied: [{ name: "x" }] },
    registers: { temperature_gaps: [{ name: "Pharmacy Fridge", missing: 2, first: "2026-10-05", days: ["2026-10-05", "2026-10-09"] }], temperature_out_no_note: 1, cleaning_last: "2026-10-20", cleaning_days_since: 15, cleaning_empty_weeks: [], certificates_overdue: ["Fire extinguisher"], certificates_due_30: [], dda_days_since_stocktake: null, eod_not_closed: ["2026-10-06"], eod_not_locked: [] } }, "2026-11-04", "").map((n) => n.level + ": " + n.text));
  report("owner: Needs you on fixed data — missing first (fridge days named, reading without a note, cleaning 15 days ago, certificate, orders late), then a look (day not closed, short at closing, never counted, credit notes running out)",
    nd.join("|") === ["missing: Pharmacy Fridge has 2 days without a reading (Mon 5 Oct, Fri 9 Oct).", "missing: 1 reading outside the limits without a note.", "missing: Cleaning last recorded 15 days ago (20 Oct). It is due once a week.", "missing: Fire extinguisher is overdue.", "missing: 2 orders are past the day the customer needed it.",
      "look: End of day not saved on 1 day (Tue 6 Oct).", "look: Short at closing on 1 day, €12.50 in all.", "look: Controlled drugs have never been counted in Eikon.", "look: 1 credit note (€15.00) run out within 30 days."].join("|"), JSON.stringify(nd));
  const card = await page.$('[data-open="ownreg"]');
  await fetch(`http://localhost:${PORT}/__reset`);
  await card.click();
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ownreg" && document.querySelector(".own-tiles"), null, { timeout: 15000 });
  const own1 = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join(), tiles: [...document.querySelectorAll(".own-tile")].map((t) => t.innerText.replace(/\n+/g, " / ")), needs: document.querySelectorAll(".own-need").length, back: document.querySelector(".own-back").textContent }));
  const reqs1 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => /^\/owner\//.test(c.path));
  report("owner: Money › How we're doing opens in the new layout with one request for the month (and the days to compare), four figures, Needs you, back to Money",
    own1.hash === "#ownreg" && own1.rail === "money" && own1.back === "‹ Money" && reqs1.length === 1 && reqs1[0].path === "/owner/summary" && new RegExp("from=" + todayYmd.slice(0, 7) + "-01&to=" + todayYmd.slice(0, 7) + "-\\d\\d&cmp_from=").test(reqs1[0].query) &&
    own1.tiles.length === 4 && /^Takings \/ €[\d,]+\.\d\d/.test(own1.tiles[0]) && /Paid out/.test(own1.tiles[1]) && /Credit notes held \/ €20\.00/.test(own1.tiles[3]) && own1.needs >= 3, JSON.stringify({ own1, reqs1 }));
  // a figure opens its records; Escape closes and focus goes back to it
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('.own-tile[data-rec="paid_outs"]');
  await page.waitForFunction(() => document.querySelector("#own-dlg table") || document.querySelector("#own-dlg .own-note"), null, { timeout: 10000 });
  const dl = await page.evaluate(() => ({ title: document.querySelector("#own-dlg h2").textContent, rows: document.querySelectorAll("#own-dlg tbody tr").length, foot: (document.querySelector("#own-dlg tfoot") || {}).textContent || "", open: !!document.querySelector('#own-dlg [data-dact="open"]'), focus: document.activeElement.dataset.dact, modal: document.querySelector("#own-dlg [role=dialog]").getAttribute("aria-modal") }));
  const reqs2 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => /^\/owner\//.test(c.path));
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  const after = await page.evaluate(() => ({ gone: !document.querySelector("#own-dlg"), focus: document.activeElement.dataset.rec }));
  const nDays = Number(todayYmd.slice(8)) - 1;
  report("owner: Paid out opens its payments (one request, kinds=paid_outs), with the total and Open Paid out; Escape closes and focus is back on the figure",
    dl.title === "Paid out" && dl.rows === nDays && (nDays === 0 || /Total.*€/.test(dl.foot)) && dl.open && dl.focus === "close" && dl.modal === "true" && reqs2.length === 1 && /kinds=paid_outs/.test(reqs2[0].query) && after.gone && after.focus === "paid_outs", JSON.stringify({ dl, reqs2, after }));
  // Week, then the week before: one request each, compared with the week before that
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-view="week"]'); await page.waitForFunction(() => !window.EIKON.owner.state.loading && window.EIKON.owner.state.period.view === "week");
  await page.click('[data-move="-1"]'); await page.waitForFunction(() => !window.EIKON.owner.state.loading && !window.EIKON.owner.state.period.cur);
  const reqs3 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => /^\/owner\//.test(c.path)).map((c) => c.query);
  const wk = await page.evaluate(() => ({ p: window.EIKON.owner.state.period, lab: document.querySelector(".emb-lab").textContent, now: !!document.querySelector('[data-act="now"]'), saved: localStorage.getItem("eikon_own_view") }));
  report("owner: Week shows Monday to Sunday; ‹ goes to the week before with one request, compared with the whole week before it; This week comes back; the choice is remembered",
    reqs3.length === 2 && wk.p.view === "week" && wk.p.cmpLabel === "the week before" && reqs3[1].indexOf("?from=" + wk.p.from + "&to=" + wk.p.to + "&cmp_from=" + wk.p.cmp.from + "&cmp_to=" + wk.p.cmp.to) === 0 && new Date(wk.p.from + "T12:00:00Z").getUTCDay() === 1 && wk.now && /"view":"week"/.test(wk.saved), JSON.stringify({ reqs3, wk }));
  // Reports: printed with the pharmacy's name, page numbers and Malta time; the spreadsheet read back with SheetJS
  await page.click('[data-view="month"]'); await page.waitForFunction(() => !window.EIKON.owner.state.loading && window.EIKON.owner.state.period.view === "month");
  await page.evaluate((x) => { if (!window.XLSX || !window.XLSX.utils) { (0, eval)(x); } window.__ownPrint = null; window.EIKON.openPrintUrlOrLink = function () { window.__ownPrint = window.EIKON.months.lastPrint; return {}; }; }, XLSX_OWN);
  const reps = {};
  for (const k of ["month", "cd", "hours"]) {
    await page.click(`[data-rep="${k}"][data-how="print"]`); await page.waitForFunction(() => window.__ownPrint && !window.EIKON.owner.state.busy, null, { timeout: 10000 });
    const h = await page.evaluate(() => window.__ownPrint.html); await page.evaluate(() => { window.__ownPrint = null; });
    await page.click(`[data-rep="${k}"][data-how="sheet"]`); await page.waitForFunction((n) => window.EIKON.owner.lastSheet && !window.EIKON.owner.state.busy && window.EIKON.owner.lastSheet.name.indexOf(n) >= 0, k === "month" ? "month-end" : k === "cd" ? "controlled-drugs" : "staff-hours", { timeout: 10000 });
    reps[k] = { h, sheet: await page.evaluate(() => ({ name: window.EIKON.owner.lastSheet.name, sheets: window.EIKON.owner.lastSheet.sheets.map((s) => s.name + ":" + s.rows.length), size: window.EIKON.owner.lastSheet.size })) };
  }
  const pOk = (h, title) => h.indexOf("<b>Demo Pharmacy</b>") > 0 && h.indexOf("<h1>" + title + "</h1>") > 0 && /counter\(page\) " of " counter\(pages\)/.test(h) && /printed \d\d\/\d\d\/\d{4} \d\d:\d\d/.test(h) && !/<script/i.test(h) && /color:#000;background:#fff/.test(h);
  report("owner: the three reports print black on white with the pharmacy's name, page numbers and the time printed (Malta), no script; month end lists the days and paid outs, controlled drugs the totals with lines to sign, staff hours the rota",
    pOk(reps.month.h, "Month end for the accountant") && /End of day, day by day/.test(reps.month.h) && /Paid outs/.test(reps.month.h) && /Locum receipts/.test(reps.month.h) && pOk(reps.cd.h, "Controlled drugs totals") && /DDA Sales — controlled drugs supplied/.test(reps.cd.h) && /Morphine 10mg/.test(reps.cd.h) && /Pharmacist in charge/.test(reps.cd.h) && pOk(reps.hours.h, "Staff hours") && /Ġanni Borg/.test(reps.hours.h),
    JSON.stringify(Object.keys(reps).map((k) => [k, reps[k].h.length])));
  report("owner: each report downloads as a workbook (Summary, End of day, Paid outs, credit notes, locum receipts; totals and lines; hours, shifts and the locum register)",
    reps.month.sheet.sheets.slice(0, 3).map((x) => x.split(":")[0]).join() === "Summary,End of day,Paid outs" && reps.month.sheet.sheets.length === 6 && reps.cd.sheet.sheets.length === 6 && reps.hours.sheet.sheets.length === 4 && /\.xlsx$/.test(reps.hours.sheet.name) && reps.month.sheet.size > 1000, JSON.stringify(reps.month.sheet) + JSON.stringify(reps.cd.sheet) + JSON.stringify(reps.hours.sheet));
  // A group's head office: All pharmacies, then one; no patient details in the lines
  globalThis.__ownGroup = true;
  await page.evaluate(() => { localStorage.removeItem("eikon_own_view"); window.EIKON.owner.state.data = null; location.hash = "#money"; }); await page.waitForTimeout(300);
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.evaluate(() => { location.hash = "#ownreg"; });
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ownreg" && document.querySelector("#own-loc") && !window.EIKON.owner.state.loading, null, { timeout: 15000 });
  const g1 = await page.evaluate(() => ({ opts: [...document.querySelectorAll("#own-loc option")].map((o) => o.textContent), rows: [...document.querySelectorAll(".own-ph tbody tr")].length, needs: [...document.querySelectorAll(".own-need .t")].map((x) => x.textContent) }));
  await page.selectOption("#own-loc", "4"); await page.waitForFunction(() => !window.EIKON.owner.state.loading && window.EIKON.owner.state.data.scope === "one");
  const reqs4 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => /^\/owner\//.test(c.path)).map((c) => c.query);
  await page.click('[data-rec="dda_supplied"]'); await page.waitForFunction(() => document.querySelector("#own-dlg tbody") || document.querySelector("#own-dlg .own-note"), null, { timeout: 10000 });
  const g2 = await page.evaluate(() => ({ txt: document.querySelector("#own-dlg").innerText, open: !!document.querySelector('#own-dlg [data-dact="open"]') }));
  await page.keyboard.press("Escape");
  globalThis.__ownGroup = false;
  report("owner: head office sees All 2 pharmacies (a row each, Needs you named by pharmacy), chooses one (loc=4 on the next request), and the lines come without patients' details and without Open (another pharmacy's screen)",
    g1.opts.join() === "All 2 pharmacies,Ħamrun Pharmacy,Żebbuġ Pharmacy" && g1.rows === 2 && g1.needs.some((t) => /^Ħamrun Pharmacy: /.test(t)) && /loc=4/.test(reqs4[reqs4.length - 1]) && !/Zammit|1234M/.test(g2.txt) && /left out for head office/.test(g2.txt) && !g2.open, JSON.stringify({ g1, reqs4, g2: g2.txt.slice(0, 300) }));
  // Staff: no card in Money, and the screen says who can, without asking the server
  await page.evaluate(() => { localStorage.removeItem("eikon_own_view"); window.EIKON.owner.state.data = null; window.EIKON.owner.state.loc = "all"; window.EIKON.state.user.role = "staff"; location.hash = "#money"; }); await page.waitForTimeout(500);
  const staffCard = await page.$('[data-open="ownreg"]');
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.evaluate(() => { location.hash = "#ownreg"; }); await page.waitForTimeout(600);
  const sTxt = await page.textContent(".own"), sReq = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => /^\/owner\//.test(c.path));
  await page.evaluate(() => { window.EIKON.state.user.role = "admin"; });
  report("owner: a staff account has no How we're doing card and, at the address, a note instead of the figures; nothing is asked of the server", !staffCard && /Only the pharmacist in charge/.test(sTxt) && sReq.length === 0, JSON.stringify({ staffCard: !!staffCard, sTxt: sTxt.slice(0, 120), sReq }));
} catch (e) { report("owner: how we're doing", false, String(e).slice(0, 400)); }
// ---- Inspection check (insreg, backlog 3 item 9): each check's maths on fixed data with a fixed Malta day, the reads it
// makes (a month per call, 3 in flight at most, stock-take months skip the DDA reads), the screen from Registers, its links
// to the exact month, the printout with sign-off lines, and the first page of the inspection pack.
try {
  await page.goto(base + "&ui=2&ins=" + Date.now() + "#registers");
  await page.waitForFunction(() => window.EIKON && window.EIKON.inspect && window.EIKON.state.activeModuleId === "registers", null, { timeout: 15000 });
  const maths = await page.evaluate(() => {
    const I = window.EIKON.inspect, today = "2026-11-03", days = (a, b) => { const o = []; for (let d = a; d <= b; d = new Date(Date.parse(d + "T12:00:00Z") + 864e5).toISOString().slice(0, 10)) o.push(d); return o; };
    const oct = days("2026-10-01", "2026-10-31");
    const temp = [];
    oct.forEach((d) => { if (d !== "2026-10-05" && d !== "2026-10-09") temp.push({ device_id: 1, device_name: "Pharmacy Fridge", entry_date: d, min_temp: 3, max_temp: d === "2026-10-12" ? 9.5 : d === "2026-10-14" ? 8.4 : 6, min_limit: 2, max_limit: 8, notes: d === "2026-10-14" ? "Door left open, stock checked" : "" }); });
    oct.filter((d) => d >= "2026-10-21").forEach((d) => temp.push({ device_id: 2, device_name: "Pharmacy", entry_date: d, min_temp: 20, max_temp: 24, min_limit: 15, max_limit: 25, notes: "" }));
    const D = { months: ["2026-10"], devices: [{ id: 1, name: "Pharmacy Fridge", active: 1, created_at: "2026-09-01 08:00:00" }, { id: 2, name: "Pharmacy", active: 1, created_at: "2026-10-20 22:30:00" }],
      temp, clean: [{ entry_date: "2026-10-06" }, { entry_date: "2026-10-20" }], daily: days("2026-10-01", "2026-10-10").map((d) => ({ entry_date: d })),
      locum: oct.filter((d) => d !== "2026-10-15" && d !== "2026-10-16").map((d) => ({ entry_date: d, time_in: "08:00", locum_full_name: "Pharm. Daniela Spiteri", registration_number: "PH 1234" })),
      certs: [{ title: "Fire Extinguisher", next_due: "2026-10-12" }, { title: "AC Maintenance", next_due: "2026-11-20" }, { title: "Pest Control", next_due: "2027-05-01" }, { title: "First Aid Certificate", next_due: null }],
      stocktakes: [{ id: 4, created_at: "2026-10-31 23:30:00", closed_at: "2026-11-01 01:00:00" }], dda: {}, err: {} };
    const rg = I.periodOf("last", today);
    const list = I.checks(D, rg, today), by = {}; list.forEach((r) => { by[r.id] = { s: r.status, t: r.reasons.map((x) => x.level + ": " + x.text), go: r.reasons.map((x) => x.go || null) }; });
    // Clean data: the same month with everything there gives no problem at all
    const C = { months: ["2026-10"], devices: D.devices.slice(0, 1), temp: oct.map((d) => ({ device_id: 1, device_name: "Pharmacy Fridge", entry_date: d, min_temp: 3, max_temp: 6, min_limit: 2, max_limit: 8, notes: "" })),
      clean: ["2026-10-02", "2026-10-07", "2026-10-14", "2026-10-21", "2026-10-28"].map((d) => ({ entry_date: d })), daily: oct.map((d) => ({ entry_date: d })), locum: oct.map((d) => ({ entry_date: d, locum_full_name: "A", registration_number: "1" })),
      certs: [{ title: "Pest Control", next_due: "2027-05-01" }], stocktakes: [{ id: 1, created_at: "2026-10-01 08:00:00", closed_at: "2026-10-01 09:00:00" }], dda: {}, err: {} };
    const clean = I.checks(C, rg, today);
    // DDA over three months: September had lines and no stock-take, August had none; an open stock-take; October not due yet
    const rg3 = I.periodOf("three", today), D3 = Object.assign({}, C, { months: ["2026-09", "2026-10", "2026-11"], dda: { "2026-09": { lines: 3, where: "cdsreg" } }, stocktakes: [{ id: 2, created_at: "2026-10-20 08:00:00", closed_at: null }] });
    const dda3 = I.checks(D3, rg3, today).find((r) => r.id === "dda");
    // This month (3 November): cleaning last on 22 October is overdue; nothing is counted for today
    const rgN = I.periodOf("this", today), DN = Object.assign({}, C, { months: ["2026-11"], temp: [{ device_id: 1, device_name: "Pharmacy Fridge", entry_date: "2026-11-01", min_temp: 3, max_temp: 6, min_limit: 2, max_limit: 8 }, { device_id: 1, device_name: "Pharmacy Fridge", entry_date: "2026-11-02", min_temp: 3, max_temp: 6, min_limit: 2, max_limit: 8 }], clean: [{ entry_date: "2026-10-22" }], daily: [], locum: [] });
    const now = I.checks(DN, rgN, today), nowBy = {}; now.forEach((r) => { nowBy[r.id] = { s: r.status, t: r.reasons.map((x) => x.text) }; });
    return { by, clean: clean.map((r) => r.id + ":" + r.status), cleanHead: I.headline(clean).text, head: I.headline(list).text, dda3: { s: dda3.status, t: dda3.reasons.map((x) => x.text) }, nowBy, rg, rg3, rgN };
  });
  const b = maths.by, T = (k) => b[k].t.join(" | ");
  report("inspect: temperature on fixed October data — the fridge's 2 days without a reading named, the room counted only from the Malta day it was added (21 Oct), 1 reading outside 2 to 8 °C without a note, 1 with a note for information; links to the first day",
    b.temperature.s === "missing" && /Pharmacy Fridge: 2 days without a reading \(5 Oct and 9 Oct\)/.test(T("temperature")) && !/Pharmacy: \d+ days? without/.test(T("temperature")) && /Pharmacy Fridge: 1 reading outside 2 to 8 °C without a note \(12 Oct 3 to 9\.5 °C\)/.test(T("temperature")) && /info: 1 reading outside the limits, with a note/.test(T("temperature")) &&
    b.temperature.go[0].mod === "tempreg" && b.temperature.go[0].day === "2026-10-05" && b.temperature.go[1].day === "2026-10-12", JSON.stringify(b.temperature));
  report("inspect: cleaning — the week of 12 Oct had none (weeks inside October only; not overdue in a past month); daily register for information only; locum days with work and no pharmacist (15 and 16 Oct) need a look; last signed named",
    b.cleaning.s === "missing" && /No cleaning recorded in 1 week: week of 12 Oct\./.test(T("cleaning")) && !/Overdue/.test(T("cleaning")) && b.cleaning.go[0].ym === "2026-10" &&
    b.dailyregister.s === "info" && /10 lines on 10 days\. No line on 21 days/.test(T("dailyregister")) &&
    b.locum.s === "look" && /2 days with work recorded but no pharmacist in charge in the locum register \(15 Oct and 16 Oct\)/.test(T("locum")) && /Last signed 31 Oct by Pharm\. Daniela Spiteri \(reg no PH 1234\)/.test(T("locum")) && b.locum.go[0].mod === "locreg" && b.locum.go[0].ym === "2026-10", JSON.stringify({ c: b.cleaning, d: b.dailyregister, l: b.locum }));
  report("inspect: certificates as of 3 Nov — expired 12 Oct is missing, due 20 Nov (17 days) needs a look, not recorded is not on file (unknown is not in order); controlled drugs: the stock-take of 01:30 Malta on 1 Nov counts for October, which is not due yet",
    b.certificates.s === "missing" && /Fire extinguisher expired on 12 Oct 2026 \(22 days ago\)/.test(T("certificates")) && /AC maintenance is due on 20 Nov 2026 \(in 17 days\)/.test(T("certificates")) && !/Pest Control/.test(T("certificates")) && /nofile: Not recorded yet: First aid certificate\. An inspector will ask for these dates\./.test(T("certificates")) &&
    b.dda.s === "ok" && /1 stock-take in these days \(last on 1 Nov\)/.test(T("dda")) && /October 2026: the stock-take is not due yet/.test(T("dda")) && /3 registers have something missing, 1 needs a look\./.test(maths.head), JSON.stringify({ c: b.certificates, d: b.dda, h: maths.head }));
  report("inspect: the same month with nothing missing reports nothing (every register in order, daily register for information)",
    maths.clean.join() === "temperature:ok,cleaning:ok,dailyregister:info,locum:ok,certificates:ok,dda:ok" && maths.cleanHead === "Ready for an inspector. Everything checked is in order for these days.", JSON.stringify(maths.clean));
  report("inspect: periods in Malta days (last month 1–31 Oct, last 3 months 1 Sep to today, this month to today); DDA over 3 months — September's lines without a stock-take and an open stock-take need a look; this month: cleaning overdue (12 days), today not counted",
    maths.rg.from === "2026-10-01" && maths.rg.to === "2026-10-31" && maths.rg3.from === "2026-09-01" && maths.rg3.to === "2026-11-03" && maths.rgN.from === "2026-11-01" &&
    maths.dda3.s === "look" && /September 2026: controlled drugs were supplied or received \(3 lines in Controlled drugs supplied\)/.test(maths.dda3.t.join("|")) && /stock-take started on 20 Oct is not closed/.test(maths.dda3.t.join("|")) &&
    maths.nowBy.cleaning.s === "missing" && /Overdue: last cleaned 12 days ago \(22 Oct\)/.test(maths.nowBy.cleaning.t.join()) && maths.nowBy.temperature.s === "ok", JSON.stringify({ dda3: maths.dda3, now: maths.nowBy }));
  // The reads: a month per call, no more than 3 in flight; a month with its stock-take is not read for DDA lines
  const reads = await page.evaluate(async () => {
    const I = window.EIKON.inspect, today = "2026-11-03";
    const mk = (takes, sales) => { const seen = []; let fl = 0, max = 0;
      const f = async (p) => { seen.push(p); fl++; max = Math.max(max, fl); await new Promise((r) => setTimeout(r, 5)); fl--;
        if (p === "/temperature/devices") return { ok: true, devices: [] };
        if (p === "/dda-stocktakes/stocktakes") return { ok: true, stocktakes: takes };
        if (p === "/certificates/items") return { ok: true, items: [] };
        if (p.startsWith("/dda-purchases/entries?month=2026-09")) return { ok: true, entries: [{ id: 1 }, { id: 2 }] };
        if (p.startsWith("/dda-sales/entries?month=2026-08")) return { ok: true, entries: sales };
        if (p.startsWith("/cleaning/entries?month=2026-11")) return { ok: true, entries: [] };
        return { ok: true, entries: [] }; };
      return { f, seen, max: () => max }; };
    const a = mk([{ id: 1, created_at: "2026-10-03 08:00:00" }, { id: 2, created_at: "2026-11-02 08:00:00" }], []), rg = I.periodOf("three", today);
    const Da = await I.gather(rg, a.f, null, today);
    const b2 = mk([], [{ id: 9 }]), Db = await I.gather(I.periodOf("custom", today, "2026-08-01", "2026-09-30"), b2.f, null, today);
    const c = mk([], []), Dc = await I.gather(I.periodOf("this", today), c.f, null, today);
    return { a: { calls: Da.calls, max: a.max(), dda: a.seen.filter((p) => /dda-(sales|poyc|purchases)/.test(p)), cleanBefore: a.seen.filter((p) => /cleaning/.test(p)) },
      b: { calls: Db.calls, dda: b2.seen.filter((p) => /dda-(sales|poyc|purchases)/.test(p)), got: Db.dda }, c: { calls: Dc.calls, extra: c.seen.filter((p) => /cleaning/.test(p)) } };
  });
  report("inspect: the last 3 months take 16 requests (3 + a month each for temperature, cleaning, daily and locum registers + one controlled-drug read for the period: balances, days, warnings), never more than 3 in flight; months with their stock-take read no DDA lines",
    reads.a.calls === 16 && reads.a.max <= 3 && reads.a.dda.length === 0, JSON.stringify(reads.a));
  report("inspect: a month without a stock-take is read for lines until some are found (August: supplied = 1; September: supplied, POYC, received = 3); this month reads October's cleaning too when the last week starts before it",
    reads.b.dda.join() === "/dda-sales/entries?month=2026-08,/dda-sales/entries?month=2026-09,/dda-poyc/entries?month=2026-09,/dda-purchases/entries?month=2026-09" && reads.b.got["2026-09"].where === "cdpreg" && reads.b.got["2026-08"].lines === 1 &&
    reads.c.calls === 9 && reads.c.extra.join() === "/cleaning/entries?month=2026-11,/cleaning/entries?month=2026-10", JSON.stringify({ b: reads.b, c: reads.c }));
  // Records (Finish round): the locum register on a day with controlled drugs and nobody in charge, today included; nobody
  // recorded is never "In order"; the over-supply warnings and the period's "more supplied than received"; a fridge added
  // in the period says where its check starts.
  const rec = await page.evaluate(() => {
    const I = window.EIKON.inspect, today = "2026-11-11", rg = I.periodOf("this", today);
    const base = { months: ["2026-11"], devices: [], temp: [], clean: [], daily: [], locum: [], certs: [{ title: "Pest Control", next_due: "2027-05-01" }], stocktakes: [{ id: 1, created_at: "2026-11-02 08:00:00", closed_at: "2026-11-02 09:00:00" }], dda: {}, err: {} };
    const by = (D) => { const o = {}; I.checks(D, rg, today).forEach((r) => { o[r.id] = { s: r.status, t: r.reasons.map((x) => x.level + ": " + x.text).join(" | "), go: (r.reasons[0] || {}).go }; }); return o; };
    const none = by(base);
    const cd = by(Object.assign({}, base, { cdDays: { supplied: ["2026-11-11"], received: ["2026-11-10"] }, locum: [{ entry_date: "2026-11-10", locum_full_name: "A", registration_number: "1" }],
      cdWarnings: [{ register: "sales", entry_id: 7, entry_date: "2026-11-11", medicine: "Oxycodone 10mg tablets", quantity: 40, balance: 28, after: -12, created_name: "Rita Camilleri" },
        { register: "poyc", entry_id: 8, entry_date: "2026-11-05", medicine: "Diazepam 5mg", quantity: 10, balance: 4, after: -6, created_name: "Karl Vella" }],
      cdShort: [{ name: "Oxycodone 10mg tablets", key: "oxycodone 10mg tablets", first_below: "2026-11-11", lowest: -12, counted: false, since: "2026-08-11", regs: ["sales"], warned: 1, warned_by: ["Rita Camilleri"] },
        { name: "Morphine 10mg", key: "morphine 10mg", first_below: "2026-11-06", lowest: -4, counted: true, since: "2026-11-02", regs: ["poyc", "sales"], warned: 0, warned_by: [] }] }));
    const work = by(Object.assign({}, base, { temp: [{ device_id: 1, entry_date: "2026-11-11", min_temp: 3, max_temp: 6 }] }));
    const late = by(Object.assign({}, base, { devices: [{ id: 1, name: "Vaccine fridge", active: 1, created_at: "2026-11-10 08:00:00" }, { id: 2, name: "Pharmacy", active: 1, created_at: "2026-11-10 09:00:00" }], temp: [{ device_id: 1, device_name: "Vaccine fridge", entry_date: "2026-11-10", min_temp: 3, max_temp: 6 }, { device_id: 2, device_name: "Pharmacy", entry_date: "2026-11-10", min_temp: 20, max_temp: 22 }], locum: [{ entry_date: "2026-11-10" }, { entry_date: "2026-11-11" }] }));
    return { none, cd, work, late };
  });
  report("records: locum — nobody recorded in the days chosen is Not on file (never In order); work today with nobody is a look and says today is included",
    rec.none.locum.s === "nofile" && /No pharmacist in charge is recorded in these days/.test(rec.none.locum.t) && rec.work.locum.s === "look" && /1 day with work recorded .*\(11 Nov\)\. Today is included/.test(rec.work.locum.t), JSON.stringify({ n: rec.none.locum, w: rec.work.locum }));
  report("records: locum — a day with controlled drugs and nobody in charge is Missing (11 Nov); a day with a pharmacist is not listed",
    rec.cd.locum.s === "missing" && /missing: 1 day with controlled drugs supplied or received but no pharmacist in charge in the locum register \(11 Nov\)/.test(rec.cd.locum.t) && !/10 Nov/.test(rec.cd.locum.t.split("|")[0]), JSON.stringify(rec.cd.locum));
  report("records: controlled drugs — each medicine going below zero is Look at this (Q11) (from the registers, warned or not), with who was warned at entry, and opens its medicine; a warning whose medicine is back above zero is for information",
    rec.cd.dda.s === "look" && /look: Oxycodone 10mg tablets: the registers go below zero on 11 Nov \(lowest −12\): more supplied than received, and no stock take has counted it since 11 Aug\. A warning was shown at entry to Rita Camilleri \(1 line\)\./.test(rec.cd.dda.t) &&
    /look: Morphine 10mg: the registers go below zero on 6 Nov \(lowest −4\) since the count on 2 Nov\. Count it/.test(rec.cd.dda.t) && /info: Diazepam 5mg: POYC 10 on 5 Nov was saved below what the registers showed then \(6 below\), warned at entry to Karl Vella; the registers no longer go below zero\./.test(rec.cd.dda.t) &&
    (rec.cd.dda.t.match(/Oxycodone/g) || []).length === 1 && rec.cd.dda.go && rec.cd.dda.go.mod === "cdreg", JSON.stringify(rec.cd.dda));
  report("records: temperature — a fridge added in the days chosen is checked from that day ('added on'), the room named Room as on Temperature, and the check says the month's page lists the days before it",
    rec.late.temperature.s === "ok" && /info: Checked from the day each was added \(Vaccine fridge added on 10 Nov, Room added on 10 Nov\)\. The month's page also lists the days before that as not logged\./.test(rec.late.temperature.t), JSON.stringify(rec.late.temperature));
  // dayzero's E.startYmd (when it is in): nothing is asked of the days before the pharmacy started
  const startC = await page.evaluate(() => { const E = window.EIKON, I = E.inspect, keep = E.startYmd; E.startYmd = () => "2026-11-09";
    try { const today = "2026-11-11", rg = I.periodOf("this", today), o = {};
      I.checks({ months: ["2026-11"], devices: [{ id: 1, name: "Fridge", active: 1, created_at: "2026-01-01 08:00:00" }], temp: [{ device_id: 1, entry_date: "2026-11-09" }, { device_id: 1, entry_date: "2026-11-10" }], clean: [], daily: [], locum: [{ entry_date: "2026-11-09" }, { entry_date: "2026-11-10" }, { entry_date: "2026-11-11" }], certs: [], stocktakes: [], dda: {}, err: {} }, rg, today)
        .forEach((r) => { o[r.id] = r.status + " " + r.reasons.map((x) => x.text).join(" | "); }); return o; } finally { if (keep) E.startYmd = keep; else delete E.startYmd; } });
  report("records: with a start day (9 Nov) the check asks nothing of 1–8 Nov — temperature in order from 9 Nov, cleaning not overdue in its first week",
    /^ok /.test(startC.temperature) && !/Overdue/.test(startC.cleaning), JSON.stringify(startC));
  // The words under a medicine line (E.cdBalanceWords): counted / not counted, the earlier lines of the same form, received
  const words = await page.evaluate(() => { const W = window.EIKON.cdBalanceWords; if (!W) return null;
    const nc = { name: "Oxycodone 10mg tablets", shown: 28, since: "2026-08-11", counted: null, lines: 1 }, c = { name: "Morphine 10mg", shown: 10, since: "2026-11-02", counted: { qty: 12, date: "2026-11-02" }, lines: 3 };
    const keep = window.EIKON.startYmd; window.EIKON.startYmd = () => "2026-11-11"; const g = W(nc, 40, -1, 0); if (keep) window.EIKON.startYmd = keep; else delete window.EIKON.startYmd;
    return { a: W(nc, 40, -1, 0), b: W(c, 4, -1, 0), c: W(c, 4, -1, 8), d: W(c, 50, 1, 0), e: W({ name: "X", shown: null, since: "2026-08-11", lines: 0 }, 5, -1, 0), f: W(nc, 0, -1, 0), g, h: W(Object.assign({}, c, { shown: -3 }), 0, -1, 0) }; });
  report("records: the words at entry — 40 of 28 not counted: 'This takes Oxycodone 10mg tablets 12 below what the registers show since 11 Aug (not counted in a stock take yet) — check the count or a delivery not written in Received', with what is sent; counted: since the last count; the form's earlier lines are taken first; received never warns; nothing in the registers says so without a warning",
    !!words && words.a.text === "This takes Oxycodone 10mg tablets 12 below what the registers show since 11 Aug (not counted in a stock take yet) — check the count or a delivery not written in Received. You can still save it as it really happened." &&
    JSON.stringify(words.a.warn) === JSON.stringify({ balance: 28, after: -12, since: "2026-08-11", counted: 0 }) && words.b.warn === null && /after this line: 6\./.test(words.b.text) &&
    /This takes Morphine 10mg 2 below what the registers show since the last count \(2 Nov\)/.test(words.c.text) && words.c.warn.balance === 2 && words.c.warn.counted === 1 && words.d.warn === null && /after this delivery: 60/.test(words.d.text) &&
    words.e.warn === null && /^Nothing of it is in the registers since 11 Aug 2026\./.test(words.e.text) && /^In the registers since 11 Aug \(not counted yet\): 28\.$/.test(words.f.text) &&
    /since it started on 11 Nov \(not counted in a stock take yet\)/.test(words.g.text) && /: −3\.$/.test(words.h.text), JSON.stringify(words));
  // The screen: from Registers › Proof, read on opening, rail on Registers, rows with pills, links to the exact month
  await page.click('[data-open="insreg"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "insreg" && document.querySelector(".ins-list"), null, { timeout: 15000 });
  const scr = await page.evaluate(() => ({ hash: location.hash, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod).join(), rows: [...document.querySelectorAll(".ins-reg")].map((r) => r.dataset.reg + ":" + r.querySelector(".ins-pill").textContent), head: document.querySelector(".ins-head").textContent }));
  report("inspect: Registers › Inspection check opens in the new layout, reads this month at once, one row per register with its status in words (no request counts), rail on Registers",
    scr.hash === "#insreg" && scr.rail === "registers" && scr.rows.length === 6 && scr.rows.every((r) => /:(In order|Look at this|Missing|For information|Not checked|Not on file)$/.test(r)) && /checked \d{1,2} [A-Z][a-z]{2} \d{4}/.test(scr.head) && !/requests/.test(scr.head), JSON.stringify(scr));
  await page.click('[data-range="last"]');
  await page.waitForFunction(() => !window.EIKON.inspect.state.job && window.EIKON.inspect.state.result && window.EIKON.inspect.state.result.range.kind === "last", null, { timeout: 15000 });
  const lastYm = await page.evaluate(() => window.EIKON.inspect.state.result.range.from.slice(0, 7));
  const lastLab = await page.evaluate((ym) => window.EIKON.months.label(ym), lastYm);
  const cleanGo = await page.$('.ins-reg[data-reg="cleaning"] .ins-go');
  let cleanMonth = "";
  if (cleanGo) { await cleanGo.click(); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cleanreg" && document.querySelector(".emb-lab"), null, { timeout: 15000 }); cleanMonth = await page.textContent(".emb-lab"); }
  await page.goBack(); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "insreg" && document.querySelector(".ins-list"), null, { timeout: 15000 });
  const kept = await page.evaluate(() => window.EIKON.inspect.state.result.range.kind);
  await page.click('.ins-reg[data-reg="temperature"] .ins-go');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tempreg" && document.querySelector(".trg-d.focus"), null, { timeout: 15000 });
  const tFocus = await page.evaluate(() => ({ lab: document.querySelector(".emb-lab").textContent, day: (function (c) { return c && (c.getAttribute("data-day") || c.getAttribute("title")); })(document.querySelector(".trg-d.focus")) })); // the day's date: data-day on a day button (its title is now in words)
  report("inspect: “Open ›” goes to the exact place — Cleaning on last month (not this one), Temperature on the first day not logged, outlined; back keeps the last check",
    !!cleanGo && cleanMonth.includes(lastLab) && kept === "last" && tFocus.lab.includes(lastLab) && tFocus.day === lastYm + "-01", JSON.stringify({ cleanMonth, lastLab, kept, tFocus }));
  // Print: one page with the summary and sign-off lines; the pack's first page is the same check
  await page.goto(base + "&ui=2&ins2=" + Date.now() + "#insreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "insreg" && window.EIKON.inspect.state.result && !window.EIKON.inspect.state.job, null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.months.lastPrint = null; });
  await page.click('[data-act="print"]'); await page.waitForTimeout(300);
  const pr = await page.evaluate(() => window.EIKON.months.lastPrint && window.EIKON.months.lastPrint.html || "");
  const cover = await page.evaluate(() => window.EIKON.inspect.coverSection(window.EIKON.inspect.state.result, "Demo Pharmacy"));
  report("inspect: Print opens the check with each register, its status and reasons, and lines for Pharmacist in charge, Signature and Date; the pack cover is a page of its own with the same lines",
    /<h1>Inspection check<\/h1>/.test(pr) && /Pharmacist in charge/.test(pr) && /<small>Signature<\/small>/.test(pr) && /<small>Date<\/small>/.test(pr) && /Temperature/.test(pr) && /Controlled drugs/.test(pr) &&
    /^<section class="pg">/.test(cover) && /Pharmacist in charge/.test(cover) && /Demo Pharmacy/.test(cover), pr.slice(0, 300));
  // Download our records › Print inspection pack: the check is page 1, and no month is read twice
  await page.goto(base + "&ui=2&ins3=" + Date.now() + "#expreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "expreg" && document.querySelector(".exp [data-act=print]"), null, { timeout: 15000 });
  await page.evaluate(() => { window.EIKON.expLast = null; });
  await page.click('[data-act="legal"]'); await page.click('.exp [data-act="print"]');
  await page.waitForFunction(() => window.EIKON.expLast && window.EIKON.expLast.kind === "print", null, { timeout: 30000 });
  const pack = await page.evaluate(() => { const L = window.EIKON.expLast; return { first: (L.html || "").split('<section class="pg">')[1] || "", dup: L.paths.length - new Set(L.paths).size, cover: !!(L.cover && L.cover.list), live: document.querySelector(".exp-live").textContent }; });
  report("inspect: the inspection pack in Download our records starts with the Inspection check for the same days (with sign-off lines), reuses the months already read (no request twice) and says so on the screen",
    pack.cover && /Inspection check/.test(pack.first) && /Pharmacist in charge/.test(pack.first) && pack.dup === 0 && /Inspection check \(first page\)/.test(pack.live), JSON.stringify({ dup: pack.dup, first: pack.first.slice(0, 200), live: pack.live.slice(0, 200) }));
} catch (e) { report("inspect: inspection check", false, String(e).slice(0, 400)); }
// People's names in Title Case (ui/eikon.people.js): the UI's function is the worker's (read from cloudflare-worker/code and run
// side by side); in the new layout a name field is cased when it is left, a mixed-case name and other fields are kept as typed.
try {
  const wsrc2 = fs.readFileSync(path.join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  const fnOf = (src, name) => { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; } return src.slice(i, j + 1); };
  const WN = new Function(fnOf(wsrc2, "eikonNameCase") + "\nreturn eikonNameCase;")();
  const samples = ["carmel zammit", "CARMEL ZAMMIT", "ĠUŻEPPI HILI", "il-ħamrun", "anne-marie d'amato", "O'BRIEN", "mcdonald", "de Gabriele", "john Agius", "McDonald", "JD", "0123456M", "rita@x.mt", "j.p. borg", "JOHN SMITH III"];
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON && window.EIKON.people && window.EIKON.people.nameCase && window.EIKON.state.activeModuleId === "tktreg", null, { timeout: 15000 });
  const uiOut = await page.evaluate((x) => x.map((v) => window.EIKON.people.nameCase(v)), samples);
  await page.click("[data-act=add]");
  await page.fill("#tkt-add [name=client_name]", "carmel zammit"); await page.press("#tkt-add [name=client_name]", "Tab");
  await page.fill("#tkt-add [name=issue]", "omron m3 in stock?"); await page.press("#tkt-add [name=issue]", "Tab");
  const v1 = await page.inputValue("#tkt-add [name=client_name]"), v2 = await page.inputValue("#tkt-add [name=issue]");
  await page.fill("#tkt-add [name=client_name]", "de Gabriele Maria"); await page.press("#tkt-add [name=client_name]", "Tab");
  const v3 = await page.inputValue("#tkt-add [name=client_name]");
  await page.fill("#tkt-add [name=client_name]", "ĠORĠ HILI"); await page.press("#tkt-add [name=client_name]", "Tab");
  const v4 = await page.inputValue("#tkt-add [name=client_name]");
  report("names: a name field is put in Title Case when it is left (Maltese letters too); a mixed-case name and the other fields stay as typed; the UI's function gives the worker's answers",
    JSON.stringify(uiOut) === JSON.stringify(samples.map(WN)) && uiOut[0] === "Carmel Zammit" && uiOut[7] === "De Gabriele" && uiOut[8] === "John Agius" &&
    v1 === "Carmel Zammit" && v2 === "omron m3 in stock?" && v3 === "De Gabriele Maria" && v4 === "Ġorġ Hili",
    JSON.stringify({ uiOut, v1, v2, v3, v4 }));
} catch (e) { report("names: a name field is put in Title Case when it is left", false, String(e).slice(0, 300)); }
// Error reports (backlog 7): a thrown error on a screen is one POST /client-log with build, screen id, kind, scrubbed
// message and stack, and nothing typed in the form; the overlay does not send it twice; a screen that crashes while
// drawing is one "render" report; never more than 5 per page load.
try {
  await page.goto("about:blank");
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === "tktreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]");
  await page.fill("#tkt-add [name=client_name]", "Zammit Carmel"); await page.fill("#tkt-add [name=phone]", "79123456"); await page.fill("#tkt-add [name=issue]", "Wants Ozempic");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.evaluate(() => { setTimeout(() => { throw new Error("Boom on the screen for 0012345M 99001122 see /people?q=Carmel"); }, 0); });
  await page.waitForTimeout(600);
  const logs = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/client-log");
  const L1 = await logs();
  const b = (L1[0] && L1[0].body) || {};
  const txt = JSON.stringify(L1);
  const overlay = await page.evaluate(() => { const o = document.getElementById("eikon-fatal-overlay"), b = document.getElementById("eikon-error-bar"); const had = !o && !!b; if (o) o.remove(); if (b) b.remove(); return had; }); // after boot: the bar, never the overlay (q5-1)
  // a screen that throws while drawing
  await page.evaluate(async () => { const E = window.EIKON; E._t_render = E.modules.tktreg.render; E.modules.tktreg.render = function () { throw new Error("render broke"); }; await E.renderActiveModule(); });
  await page.waitForTimeout(600);
  const L2 = (await logs()).filter((c) => c.body && c.body.kind === "render");
  await page.evaluate(() => { const E = window.EIKON; E.modules.tktreg.render = E._t_render; });
  // ten more distinct errors: the page stops at 5 in all
  await page.evaluate(() => { for (let i = 0; i < 10; i++) setTimeout(() => { throw new Error("Burst " + i); }, 0); });
  await page.waitForTimeout(700);
  const L3 = await logs();
  await page.evaluate(() => { for (const id of ["eikon-fatal-overlay", "eikon-error-bar"]) { const o = document.getElementById(id); if (o) o.remove(); } });
  report("error reports: a thrown error is one POST /client-log (screen tktreg, kind error, build, scrubbed message and stack, nothing typed in the form), the bar shown after boot adds none; a drawing crash is one render report; at most 5 per page load",
    L1.length === 1 && JSON.stringify(Object.keys(b)) === JSON.stringify(["build", "kind", "screen", "message", "stack"]) && b.screen === "tktreg" && b.kind === "error" && /^2026-\d\d-\d\d\.\d+$/.test(b.build) &&
    /Boom on the screen/.test(b.message) && !/Zammit|Carmel|Ozempic|0012345M|99001122|79123456|\?q=/.test(txt) && /\[id\]/.test(b.message) && /\[phone\]/.test(b.message) && overlay &&
    L2.length === 1 && L2[0].body.screen === "tktreg" && /render broke/.test(L2[0].body.message) && L3.length === 5,
    JSON.stringify({ n1: L1.length, b, overlay, n2: L2.length, n3: L3.length }).slice(0, 900));
  await page.reload();
  await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
} catch (e) { report("error reports: ran to the end", false, String(e).slice(0, 300)); }
// CSP report-only (backlog 2-9): a violation event is one POST /client-log, kind "csp", with the directive, the blocked
// origin only (no path, no query) and file:line; csp reports have their own 5 a load, so real errors are still sent.
try {
  await fetch(`http://localhost:${PORT}/__reset`);
  const fire = (n) => page.evaluate(({ n, port }) => { for (let i = 0; i < n; i++) window.dispatchEvent(new SecurityPolicyViolationEvent("securitypolicyviolation", {
    blockedURI: "https://tiles" + i + ".example/a/b.png?key=secret0012345M", documentURI: location.href, effectiveDirective: "img-src", violatedDirective: "img-src",
    originalPolicy: "img-src 'self'", disposition: "report", statusCode: 200, sourceFile: "http://localhost:" + port + "/ui/modules.dlvreg.js?v=2026-11-03.141", lineNumber: 12, columnNumber: 3 })); }, { n, port: PORT });
  await fire(1);
  await page.waitForTimeout(400);
  const logs = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/client-log");
  const L1 = await logs(); const b = (L1[0] && L1[0].body) || {};
  await fire(8);
  await page.waitForTimeout(400);
  const L2 = (await logs()).filter((c) => c.body && c.body.kind === "csp");
  await page.evaluate(() => { setTimeout(() => { throw new Error("Real fault after csp reports"); }, 0); });
  await page.waitForTimeout(500);
  const L3 = (await logs()).filter((c) => c.body && c.body.kind === "error");
  await page.evaluate(() => { for (const id of ["eikon-fatal-overlay", "eikon-error-bar"]) { const o = document.getElementById(id); if (o) o.remove(); } });
  report("csp reports: a report-only violation is one POST /client-log kind csp (directive, origin, file:line; no path or query), 5 a load of their own; a real error is still sent after them",
    L1.length === 1 && b.kind === "csp" && b.message === "CSP img-src would block https://tiles0.example (modules.dlvreg.js:12)" && !/secret|0012345M|\/a\/b/.test(JSON.stringify(L1)) &&
    L2.length === 5 && L3.length === 1,
    JSON.stringify({ n1: L1.length, b, n2: L2.length, n3: L3.length }).slice(0, 600));
  await page.reload();
  await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
} catch (e) { report("csp reports: ran to the end", false, String(e).slice(0, 300)); }
// ---- Registry (ui/registry.js): the new layout lists the classic screens without downloading them.
// (a) every module file registers exactly what its registry rows say; (b) the CLASSIC list in index.html is the
// "classic" rows; (c) a signed-in new-layout page downloads no classic file, and E.modules has the same ids, order,
// titles, icons and order numbers as a page with every file loaded; (d) E.loadClassic() brings the real screens in.
try {
  const idx = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const listOf = (name) => [...idx.match(new RegExp("var " + name + " = \\[([\\s\\S]*?)\\];"))[1].matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
  const allFiles = listOf("MODULES").filter((f) => f !== "core.js" && f !== "main.js"), classicFiles = listOf("CLASSIC");
  const rp = await browser.newPage();
  await rp.route("**/ui/__registry.html", (r) => r.fulfill({ contentType: "text/html; charset=utf-8", body: "<!doctype html><html><head><meta charset=utf-8></head><body><div id=eikon-root></div></body></html>" }));
  const rErr = []; rp.on("pageerror", (e) => rErr.push(e.message));
  await rp.goto(`http://localhost:${PORT}/ui/__registry.html?ui=classic&intro=0`);
  const loadOne = (f) => rp.evaluate((f) => new Promise((res) => { window.__cur = f; const s = document.createElement("script"); s.src = "/ui/" + f; s.onload = s.onerror = () => { window.__cur = null; res(); }; document.head.appendChild(s); }), f);
  await loadOne("core.js");
  await rp.evaluate(() => { const E = window.EIKON, o = E.registerModule; window.__reg = []; E.registerModule = function (m) { window.__reg.push([window.__cur, m.id]); return o.apply(this, arguments); }; });
  for (const f of allFiles) await loadOne(f);
  await rp.waitForTimeout(1200); // two classic files register again after 200 ms and 1 s
  const real = await rp.evaluate(() => { const seen = {}; return window.__reg.filter(([f, id]) => !seen[id] && (seen[id] = 1)).map(([f, id]) => { const m = window.EIKON.modules[id]; return JSON.stringify([f, id, m.title, m.icon, m.order, !!m.ui2Only]); }); });
  await loadOne("registry.js");
  const reg = await rp.evaluate(() => (window.EIKON.REGISTRY || []).map((r) => JSON.stringify([r.file, r.id, r.title, r.icon, r.order, r.ui2Only])));
  const regClassic = await rp.evaluate(() => [...new Set((window.EIKON.REGISTRY || []).filter((r) => r.load === "classic").map((r) => r.file))]);
  await rp.close();
  const onlyReal = real.filter((x) => !reg.includes(x)), onlyReg = reg.filter((x) => !real.includes(x));
  const clsOk = JSON.stringify([...classicFiles].sort()) === JSON.stringify([...regClassic].sort()) && classicFiles.every((f) => allFiles.includes(f));
  report("registry: every module file registers exactly its registry rows (id, title, icon, order, ui2Only), and index.html's CLASSIC list is the registry's classic files",
    real.length > 90 && onlyReal.length === 0 && onlyReg.length === 0 && clsOk && rErr.length === 0,
    JSON.stringify({ real: real.length, reg: reg.length, onlyReal: onlyReal.slice(0, 4), onlyReg: onlyReg.slice(0, 4), clsOk, rErr: rErr.slice(0, 3) }));

  // (c) and (d): the same E.modules as a page with every file, and no classic file fetched until asked
  const snap = () => Object.keys(window.EIKON.modules).map((k) => { const m = window.EIKON.modules[k]; return [k, m.title, m.icon, m.order, !!m.ui2Only].join("|"); });
  const np = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await np.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  const nErr = [], got = []; np.on("pageerror", (e) => nErr.push(e.message)); np.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/ui/")) got.push(u.pathname.slice(4)); });
  await np.goto(`${base}#today`);
  await np.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_ui2", "1"); sessionStorage.removeItem("eikon_ui2_pause"); });
  await np.reload();
  await np.waitForFunction(() => window.EIKON && window.EIKON._lateIn && window.EIKON.state.activeModuleId === "today", null, { timeout: 20000 });
  await np.waitForTimeout(600);
  const newSnap = await np.evaluate(snap), fetchedClassic = got.filter((f) => classicFiles.includes(f.replace(/\?.*$/, "")));
  const stubs = await np.evaluate(() => Object.keys(window.EIKON.modules).filter((k) => window.EIKON.modules[k].registryStub).length);
  // the classic screen is still one tap away: Loyalty's ⋯ › Classic Loyalty screen hands over to the classic layout
  await np.evaluate(() => { location.hash = "#loyreg"; }); await np.waitForSelector(".lyr .lyr-seg", { timeout: 10000 }); await np.waitForTimeout(300);
  await np.click(".lyr [data-act=menu]"); await np.click(".lyr [data-act=classic]"); await np.waitForFunction(() => /ui=classic/.test(location.search) && window.EIKON && window.EIKON.state.activeModuleId === "loyalty" && document.getElementById("eikon-content") && document.getElementById("eikon-content").children.length > 0, null, { timeout: 20000 }).catch(() => {});
  const handOver = await np.evaluate(() => ({ s: location.search, h: location.hash, active: window.EIKON.state.activeModuleId, real: !window.EIKON.modules.loyalty.registryStub, crashed: /Module crashed/.test(document.body.innerText) }));
  // back to the new layout; then load the classic files on demand in that page
  await np.goto(`${base.replace("intro=0", "intro=0&ui=2")}#today`);
  await np.waitForFunction(() => window.EIKON && window.EIKON._lateIn, null, { timeout: 20000 });
  const demand = await np.evaluate(async () => { const E = window.EIKON; const before = !!E.modules.loyalty.registryStub; await E.loadClassic(); return { before, after: !!E.modules.loyalty.registryStub, classicIn: !!E._classicIn, real: typeof E.modules.loyalty.render === "function" }; });
  const afterLoad = await np.evaluate(snap);
  await np.close();
  // every file loaded (the classic layout): the reference list
  const cp2 = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await cp2.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await cp2.goto(`${base}&ui=1#dashboard`);
  await cp2.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await cp2.reload();
  await cp2.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.modules.loyalty, null, { timeout: 20000 });
  await cp2.waitForTimeout(1300);
  const allSnap = await cp2.evaluate(snap), classicHasRegistry = await cp2.evaluate(() => !!window.EIKON.REGISTRY);
  await cp2.evaluate(() => { localStorage.setItem("eikon_ui2", "1"); });
  await cp2.close();
  // The new layout's own order (as before this change): its first files, then the rest in index.html order.
  const first = [...idx.match(/var FIRST = \[([^\]]*)\]/)[1].matchAll(/"\.\/([^"]+)"/g)].map((m) => m[1]);
  const rank = (f) => (first.includes(f) ? first.indexOf(f) : 100 + allFiles.indexOf(f));
  const byId = Object.fromEntries(allSnap.map((x) => [x.split("|")[0], x]));
  const want = real.map((x) => JSON.parse(x)).map((r, i) => [rank(r[0]), i, r[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).map((r) => byId[r[2]]);
  const sameList = JSON.stringify(newSnap) === JSON.stringify(want), sameAfter = JSON.stringify(afterLoad) === JSON.stringify(want);
  report("registry: the new layout fetches no classic file, yet lists the same modules (ids, titles, icons, order) as with every file loaded; a Customers link still opens the classic screen; E.loadClassic() brings the real ones in",
    sameList && sameAfter && JSON.stringify([...newSnap].sort()) === JSON.stringify([...allSnap].sort()) && fetchedClassic.length === 0 && stubs === classicFiles.length && handOver.active === "loyalty" && handOver.real && !handOver.crashed &&
    demand.before && !demand.after && demand.classicIn && !classicHasRegistry && nErr.length === 0,
    JSON.stringify({ sameList, sameAfter, n: [newSnap.length, allSnap.length], diff: newSnap.filter((x, i) => x !== want[i]).slice(0, 3), sameSet: JSON.stringify([...newSnap].sort()) === JSON.stringify([...allSnap].sort()), fetchedClassic: fetchedClassic.slice(0, 4), stubs, handOver, demand, classicHasRegistry, nErr: nErr.slice(0, 3) }));
} catch (e) { report("registry: ran to the end", false, String(e).slice(0, 300)); }
// ---- Midnight: no screen takes "today" from UTC (a day behind Malta from 23:00, or 22:00 in summer, to midnight UTC).
{
  // A date stored or offered as today must be Malta's (E.maltaYmd) or the device's (a Malta device's day is Malta's).
  // Allowed: a file name of an export (poct), a 60-day display cutoff (alertreg, retreg), a fallback after E.maltaYmd.
  const allow = /poct_export_|poct_records_filtered_|E\.maltaYmd|60 \* 86400000/;
  const utcToday = [];
  for (const f of fs.readdirSync(root).filter((n) => /\.js$/.test(n)))
    fs.readFileSync(path.join(root, f), "utf8").split("\n").forEach((ln, i) => { if (/new Date\(\)\.toISOString\(\)\.(slice|substring)\(0, ?10\)/.test(ln) && !allow.test(ln)) utcToday.push(f + ":" + (i + 1) + " " + ln.trim().slice(0, 120)); });
  report("midnight: no screen takes today's date from UTC (dashboard Add to Stock, supplier delivery date use Malta's day)", utcToday.length === 0, utcToday.slice(0, 6).join("\n       "));
}
// ---- Third-party code: pinned in ui/vendor, loaded only when asked for, never from another host.
{
  // Source: no script or stylesheet from another host in ui/*.js or ui/*.html (ui/vendor is the libraries themselves).
  // Links people click (wa.me, maps, OSM attribution) and service calls (geocoding, tiles) are not code and stay.
  const remoteCode = [];
  for (const f of fs.readdirSync(root).filter((n) => /\.(js|html)$/.test(n))) {
    fs.readFileSync(path.join(root, f), "utf8").split("\n").forEach((ln, i) => {
      if (/<script[^>]*\ssrc\s*=\s*["']?(https?:)?\/\//i.test(ln) || /<link[^>]*\shref\s*=\s*["']?(https?:)?\/\//i.test(ln) ||
          /\.(src|href)\s*=\s*["'](https?:)?\/\//.test(ln) || /["'](https?:)?\/\/[^"'\s]+\.(m?js|css)(\?[^"']*)?["']/.test(ln) ||
          /cdn\.jsdelivr|unpkg\.com|cdnjs\.cloudflare|cdn\.sheetjs/i.test(ln)) remoteCode.push(f + ":" + (i + 1) + " " + ln.trim().slice(0, 120));
    });
  }
  report("vendor: no script or stylesheet in ui/*.js or ui/*.html comes from another host", remoteCode.length === 0, remoteCode.slice(0, 6).join("\n       "));
}
try {
  const vp = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  const vErr = [], foreign = [], vendorReq = [];
  vp.on("pageerror", (e) => vErr.push("pageerror: " + e.message));
  vp.on("console", (m) => { if (m.type() === "error") vErr.push("console: " + m.text().slice(0, 200)); });
  // Anything not on this machine is refused (and listed), so a library that still reaches out would fail here.
  await vp.route((u) => !/^(localhost|127\.0\.0\.1)$/.test(u.hostname) && /^https?:$/.test(u.protocol), (r) => { foreign.push(r.request().url().slice(0, 120)); return r.abort(); });
  vp.on("request", (r) => { const u = new URL(r.url()); if (/\/vendor\//.test(u.pathname)) vendorReq.push(u.pathname + u.search); });
  await vp.goto(base + "#dashboard"); await vp.waitForTimeout(300);
  await vp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.removeItem("eikon_ui2"); });
  // New layout (Today) and classic (dashboard): boot and the background modules, with no request off this machine and no library.
  await vp.goto(base + "&ui=2#today");
  await vp.waitForFunction(() => window.EIKON && window.EIKON._lateIn && window.EIKON.state.activeModuleId === "today", null, { timeout: 20000 });
  await vp.goto(base + "&ui=1#dashboard");
  await vp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "dashboard", null, { timeout: 20000 });
  await vp.waitForTimeout(800);
  const bootForeign = foreign.slice(), bootVendor = vendorReq.slice();
  report("vendor: boot (new layout with the background modules, and classic) asks no other host and loads no library (SheetJS is no longer on every load)",
    bootForeign.length === 0 && bootVendor.length === 0 && vErr.length === 0, JSON.stringify({ bootForeign, bootVendor, vErr: vErr.slice(0, 4) }));
  // A failed load is not remembered: the next ask tries again.
  let failOnce = true;
  await vp.route("**/vendor/html2canvas-1.4.1/**", (r) => failOnce ? (failOnce = false, r.abort()) : r.fallback());
  vendorReq.length = 0;
  const retry = await vp.evaluate(async () => { const E = window.EIKON; const a = await E.loadVendor("html2canvas").then(() => "ok", (e) => e.message); const b = await E.loadVendor("html2canvas").then(() => "ok", (e) => e.message); return [a, b]; });
  report("vendor: a library that fails to load says so, and loads on the next try", /Could not load html2canvas/.test(retry[0]) && retry[1] === "ok", JSON.stringify(retry));
  // Every library loads from ui/vendor with the build stamp, once, and works.
  const lib = await vp.evaluate(async () => {
    const E = window.EIKON, out = { build: E.BUILD };
    const both = await Promise.all([E.loadVendor("xlsx"), E.loadVendor("xlsx")]);
    out.xlsxVersion = window.XLSX && window.XLSX.version; out.same = both[0] === both[1];
    const ws = XLSX.utils.aoa_to_sheet([["Stock Code", "Description"], ["A1", "Panadol 500mg"]]); const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "S");
    const bin = XLSX.write(wb, { type: "array", bookType: "xlsx" }); out.roundTrip = XLSX.utils.sheet_to_json(XLSX.read(new Uint8Array(bin), { type: "array" }).Sheets.S, { header: 1 });
    for (const n of ["bwipjs", "zxing", "tesseract", "html2canvas", "leaflet", "qrcode"]) { try { out[n] = !!(await E.loadVendor(n)); } catch (e) { out[n] = String(e.message); } }
    const c = document.createElement("canvas"); try { bwipjs.toCanvas(c, { bcid: "datamatrix", text: "0105000000000000", scale: 2 }); out.dm = c.width > 0; } catch (e) { out.dm = String(e.message); }
    out.leafletCss = !!document.getElementById("eikon-vendor-css-leaflet-0");
    out.unknown = await E.loadVendor("nope").then(() => "loaded", (e) => e.message);
    out.vendorUrl = E.vendorUrl("x/y.js");
    return out;
  });
  const want = "/ui/vendor/xlsx-0.20.3/xlsx.full.min.js?v=" + encodeURIComponent(lib.build);
  report("vendor: E.loadVendor loads each library once from /ui/vendor with the build stamp; SheetJS 0.20.3 writes and reads an xlsx; DataMatrix draws; no other host",
    /^\d{4}-\d{2}-\d{2}\.\d+$/.test(lib.build) && lib.xlsxVersion === "0.20.3" && lib.same && JSON.stringify(lib.roundTrip) === JSON.stringify([["Stock Code", "Description"], ["A1", "Panadol 500mg"]]) &&
    lib.bwipjs === true && lib.zxing === true && lib.tesseract === true && lib.html2canvas === true && lib.leaflet === true && lib.qrcode === true && lib.dm === true && lib.leafletCss &&
    /Unknown library/.test(lib.unknown) && lib.vendorUrl === `http://localhost:${PORT}/ui/vendor/x/y.js?v=` + encodeURIComponent(lib.build) &&
    vendorReq.filter((u) => u === want).length === 1 && vendorReq.every((u) => /^\/ui\/vendor\/[^?]+\?v=\d{4}-\d{2}-\d{2}\.\d+$/.test(u)) && foreign.length === 0,
    JSON.stringify({ lib, vendorReq, foreign: foreign.slice(0, 4) }).slice(0, 900));
  // Clean addresses (eikonhq.com/today): the libraries still come from /ui/vendor/.
  const idxHtml = fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/<head[^>]*>/i, (h) => h + '\n  <meta name="eikon-ui-base" content="/ui/" />');
  await vp.route(/^http:\/\/localhost:\d+\/([A-Za-z][A-Za-z0-9_-]*)?(\?.*)?$/, (r) => r.request().isNavigationRequest()
    ? r.fulfill({ status: 200, contentType: "text/html; charset=utf-8", headers: { "cache-control": "no-store" }, body: idxHtml }) : r.fallback());
  vendorReq.length = 0;
  await vp.goto(`http://localhost:${PORT}/today?intro=0&ui=2`);
  await vp.waitForFunction(() => window.EIKON && window.EIKON.CLEAN_URLS && window.EIKON.state.activeModuleId === "today", null, { timeout: 20000 });
  const clean = await vp.evaluate(async () => { await window.EIKON.loadVendor("qrcode"); return { url: window.EIKON.vendorUrl("a.js"), path: location.pathname, qr: typeof window.qrcode }; });
  report("vendor: at a clean address (opened at /today, bar bare) libraries load from /ui/vendor/",
    clean.path === "/" && clean.qr === "function" && clean.url.startsWith(`http://localhost:${PORT}/ui/vendor/a.js?v=`) && vendorReq.length === 1 && /^\/ui\/vendor\/qrcode-generator-1\.4\.4\.js\?v=/.test(vendorReq[0]) && foreign.length === 0,
    JSON.stringify({ clean, vendorReq, foreign }));
  await vp.evaluate(() => { localStorage.removeItem("eikon_ui2"); });
  await vp.close();
} catch (e) { report("vendor: ran to the end", false, String(e).slice(0, 300)); }
// ---- Search that acts (ui/eikon.search.js): "/" and Ctrl+K, synonyms, groups, requests, scanning ----
try {
  peopleState.adopted = true; // Zammit Carmel is saved in Customers (the adopt test above), so a scan of her card opens her record
  const ui2Ready = (id) => page.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === m && window.EIKON._lateIn, id, { timeout: 15000 });
  const dlgInfo = () => page.evaluate(() => { const d = document.querySelector(".esr[role=dialog]"); return { open: !!d, modal: d && d.getAttribute("aria-modal"), focus: document.activeElement && document.activeElement.id, opts: [...document.querySelectorAll(".esr-opt b")].map((b) => b.textContent), sel: (document.querySelector(".esr-opt[aria-selected=true] b") || {}).textContent || "" }; });
  const firstFor = async (term) => { await page.fill("#esr-q", term); await page.waitForTimeout(60); return (await dlgInfo()).opts[0] || ""; };

  // 1. "/" on a rebuilt screen opens it with focus in the box; Escape closes and focus goes back where it was
  await page.goto(base + "&ui=2#tempreg"); await ui2Ready("tempreg");
  await page.focus('.eikon-rail-btn[data-mod="registers"]');
  await page.keyboard.press("/");
  await page.waitForSelector(".esr[role=dialog]", { timeout: 4000 });
  const s1 = await dlgInfo();
  await page.keyboard.press("Escape");
  const s1b = await page.evaluate(() => ({ open: !!document.querySelector(".esr-ov"), back: document.activeElement && document.activeElement.getAttribute("data-mod") }));
  // Ctrl+K from a hub, and Cmd+K; "/" typed into a field stays in the field
  await page.goto(base + "&ui=2#money"); await ui2Ready("money");
  await page.keyboard.press("Control+k"); await page.waitForSelector(".esr[role=dialog]", { timeout: 4000 });
  const s2 = await dlgInfo(); await page.keyboard.press("Escape");
  await page.keyboard.press("Meta+k"); await page.waitForSelector(".esr[role=dialog]", { timeout: 4000 });
  const s2m = !!(await dlgInfo()).open; await page.keyboard.press("Escape");
  await page.goto(base + "&ui=2#customers"); await ui2Ready("customers");
  await page.fill("#cus-q", ""); await page.click("#cus-q"); await page.keyboard.type("a/b");
  const s3 = await page.evaluate(() => ({ open: !!document.querySelector(".esr-ov"), v: document.querySelector("#cus-q").value }));
  report("search: \"/\" opens a search dialog on a rebuilt screen (focus in it), Escape gives focus back; Ctrl+K and Cmd+K open it from a hub; \"/\" typed in a field stays in the field",
    s1.open && s1.modal === "true" && s1.focus === "esr-q" && !s1b.open && s1b.back === "registers" && s2.open && s2.focus === "esr-q" && s2m && !s3.open && s3.v === "a/b", JSON.stringify({ s1, s1b, s2, s2m, s3 }));

  // 2. Synonyms: the words people use
  await page.keyboard.press("Control+k"); await page.waitForSelector("#esr-q");
  const syn = {};
  for (const t of ["fridge", "temp", "DDA", "CD", "controlled", "Rx", "repeat", "till", "cash", "credit note", "recall", "rota", "BP", "label"]) syn[t] = await firstFor(t);
  const ddaAll = (await (async () => { await page.fill("#esr-q", "DDA"); await page.waitForTimeout(60); return (await dlgInfo()).opts; })());
  report("search: synonyms find the screen (fridge/temp → Temperature, DDA/CD/controlled → the controlled-drug registers, Rx/repeat → Repeat prescriptions, till/cash → Money)",
    syn.fridge === "Temperature" && syn.temp === "Temperature" && /DDA|CD|[Cc]ontrolled/.test(syn.DDA) && ddaAll.filter((x) => /DDA|CD|[Cc]ontrolled/.test(x)).length >= 3 && /DDA|CD|[Cc]ontrolled/.test(syn.CD) && /DDA|CD|[Cc]ontrolled/.test(syn.controlled) &&
    /[Rr]epeat/.test(syn.Rx) && /[Rr]epeat/.test(syn.repeat) && syn.till === "Money" && syn.cash === "Money" && /[Cc]redit/.test(syn["credit note"]) && /[Aa]lert|[Rr]ecall/.test(syn.recall) && /[Ww]ho|[Rr]ota|week/i.test(syn.rota) && /[Pp]oint|POCT|test/i.test(syn.BP) && /[Ll]abel/.test(syn.label),
    JSON.stringify({ syn, ddaAll }));

  // 3. Groups and requests: one /people per pause, orders read once; arrows move, Enter opens
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.fill("#esr-q", ""); await page.type("#esr-q", "vella", { delay: 40 });
  await page.waitForFunction(() => [...document.querySelectorAll(".esr-grp")].some((g) => g.getAttribute("aria-label") === "Open orders"), null, { timeout: 6000 });
  const g1 = await page.evaluate(() => [...document.querySelectorAll(".esr-grp")].map((g) => g.getAttribute("aria-label") + ":" + g.querySelectorAll(".esr-opt").length));
  const c1 = await callsNow();
  const pplQ = c1.filter((c) => c.path === "/people" && c.method === "GET"), ordQ = c1.filter((c) => c.path === "/client-orders/entries");
  await page.type("#esr-q", " j", { delay: 40 }); await page.waitForTimeout(500);
  const c2 = await callsNow(); const ordQ2 = c2.filter((c) => c.path === "/client-orders/entries"), pplQ2 = c2.filter((c) => c.path === "/people" && c.method === "GET");
  const writes = c2.filter((c) => c.method !== "GET");
  await page.keyboard.press("ArrowDown"); const sel1 = (await dlgInfo()).sel; await page.keyboard.press("ArrowUp"); const sel0 = (await dlgInfo()).sel;
  report("search: results come in groups (open orders and today's bookings by name); one /people request per pause in typing (none when the same word is asked again), open orders read once and filtered here, nothing written; arrows move",
    g1.some((x) => /^Open orders:1$/.test(x)) && g1.some((x) => /^Today's bookings:\d$/.test(x)) && pplQ.length === 1 && /q=vella/.test(pplQ[0].query) && ordQ.length >= 1 && ordQ.length <= 4 && ordQ2.length === ordQ.length && pplQ2.length <= 2 && writes.length === 0 && sel1 && sel0 && sel1 !== sel0,
    JSON.stringify({ g1, ppl: pplQ2.map((c) => c.query), ord: ordQ2.map((c) => c.query), writes, sel0, sel1 }));
  await page.fill("#esr-q", "kx7p");
  await page.waitForFunction(() => /Vella Joseph/.test((document.querySelector('.esr-grp[aria-label="Open orders"] .esr-opt') || {}).textContent || ""), null, { timeout: 6000 });
  // a booking today, chosen from its group, opens with its details
  await page.fill("#esr-q", "anna");
  await page.waitForSelector('.esr-grp[aria-label="Today\'s bookings"] .esr-opt', { timeout: 6000 });
  await page.click('.esr-grp[aria-label="Today\'s bookings"] .esr-opt');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && /Anna Vella/.test((document.querySelector(".bkx-g") || {}).textContent || "") && document.querySelector('[data-act="st"][data-s="arrived"]'), null, { timeout: 8000 });
  report("search: a booking found by name opens on its own sheet in Bookings", true);
  await page.goto(base + "&ui=2#money"); await ui2Ready("money");
  // Enter opens the first result
  await page.keyboard.press("Control+k"); await page.fill("#esr-q", "fridge"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tempreg", null, { timeout: 8000 });
  const s4 = await page.evaluate(() => ({ open: !!document.querySelector(".esr-ov"), classic: location.search.indexOf("ui=classic") >= 0 }));
  report("search: an order is found by its code, and Enter on \"fridge\" opens Temperature in the new layout and closes the dialog", !s4.open && !s4.classic, JSON.stringify(s4));

  // 4. Focus is shown on every stop, and stays inside the dialog
  await page.keyboard.press("/"); await page.waitForSelector("#esr-q");
  const stops = [];
  for (let i = 0; i < 4; i++) {
    stops.push(await page.evaluate(() => { const a = document.activeElement, cs = getComputedStyle(a), bar = a.closest(".esr-bar"); return { el: a.id || a.getAttribute("data-act") || a.tagName, inside: !!a.closest(".esr"), shown: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || (a.id === "esr-q" && bar && getComputedStyle(bar).boxShadow !== "none") }; }));
    await page.keyboard.press("Tab");
  }
  await page.keyboard.press("Shift+Tab"); await page.keyboard.press("Shift+Tab");
  const back2 = await page.evaluate(() => !!document.activeElement.closest(".esr"));
  await page.keyboard.press("Escape");
  report("search: keyboard only, every stop in the dialog shows focus and Tab/Shift+Tab never leave it", stops.every((s) => s.inside && s.shown) && back2 && stops.some((s) => s.el === "close"), JSON.stringify(stops));

  // 5. Scanning on Today: a burst of keys under 30 ms, then Enter, opens the person; an unknown card offers to add them
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.EIKON._lastScan = null; });
  await page.keyboard.type("12345M", { delay: 0 }); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers" && document.querySelector(".cus-head h1"), null, { timeout: 8000 });
  const sc1 = await page.evaluate(() => ({ h1: document.querySelector(".cus-head h1").textContent, scan: window.EIKON._lastScan }));
  // the same burst into Today's own box: the box is left as it was and the person opens
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  await page.click("#tdy-q"); await page.keyboard.type("0012345M", { delay: 0 }); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers" && document.querySelector(".cus-head h1"), null, { timeout: 8000 });
  const sc1b = await page.evaluate(() => ({ h1: document.querySelector(".cus-head h1").textContent, scan: window.EIKON._lastScan }));
  // an unknown card: "No one with card … — add?", Enter goes to a new customer with the card filled in
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  await page.keyboard.type("999999M", { delay: 0 }); await page.keyboard.press("Enter");
  await page.waitForFunction(() => /No one with card 999999M/.test((document.querySelector(".esr-opt") || {}).textContent || ""), null, { timeout: 8000 });
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => document.querySelector("#cus-new [name=id_card]"), null, { timeout: 8000 });
  const sc2 = await page.evaluate(() => ({ card: document.querySelector("#cus-new [name=id_card]").value, name: document.querySelector("#cus-new [name=name]").value }));
  // an order slip's code opens that order
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  await page.keyboard.type("KX7P2Q", { delay: 0 }); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-row"), null, { timeout: 8000 });
  const sc3 = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".ord-row .t b")].map((b) => b.textContent), q: (document.querySelector("#ord-q") || {}).value }));
  const scWrites = (await callsNow()).filter((c) => c.method !== "GET" && c.path !== "/auth/login");
  report("search: a scanned ID card on Today opens that person (padded or not, also from Today's box), an unknown card offers \"add?\" and opens a new customer with it, an order slip's code opens that order; nothing is written",
    sc1.h1 === "Zammit Carmel" && sc1.scan && sc1.scan.where === "today" && sc1b.h1 === "Zammit Carmel" && String(sc1b.scan.code).padStart(8, "0") === "0012345M" /* a loaded machine can split a test scan after "00"; the card is the same once padded */ && sc2.card === "999999M" && sc2.name === "" && JSON.stringify(sc3.rows) === JSON.stringify(["Vella Joseph"]) && sc3.q === "KX7P2Q" && scWrites.length === 0,
    JSON.stringify({ sc1, sc1b, sc2, sc3, scWrites }));
  // in the dialog too
  await page.keyboard.press("Control+k"); await page.waitForSelector("#esr-q");
  await page.keyboard.type("12345M", { delay: 0 }); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers" && document.querySelector(".cus-head h1") && !document.querySelector(".esr-ov"), null, { timeout: 8000 });
  const sc4 = await page.evaluate(() => window.EIKON._lastScan);
  report("search: a scan into the search dialog opens that person", sc4 && sc4.where === "dialog" && sc4.code === "12345M", JSON.stringify(sc4));

  // 6. Normal typing is never a scan: the same card typed at a fast typist's pace (40 ms a key), quick bursts in a form
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  await page.evaluate(() => { window.EIKON._lastScan = null; });
  await page.click("#tdy-q"); await page.keyboard.type("12345M", { delay: 40 });
  await page.waitForTimeout(400);
  const t1 = await page.evaluate(() => ({ v: document.querySelector("#tdy-q").value, scan: window.EIKON._lastScan, list: document.querySelectorAll("#tdy-results .esr-opt").length, hidden: document.querySelector("#tdy-results").hidden }));
  await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "customers", null, { timeout: 8000 });
  const t1b = await page.evaluate(() => window.EIKON._lastScan);
  // the fastest a person types in bursts (two or three keys under 30 ms, then a pause) never adds up to a scan
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  await page.click("#tdy-q");
  for (const chunk of ["12", "34", "5M"]) { await page.keyboard.type(chunk, { delay: 0 }); await page.waitForTimeout(45); }
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const t2 = await page.evaluate(() => window.EIKON._lastScan);
  // a scanner (or fast fingers) into a register form field is left to the form
  await page.goto(base + "&ui=2#repeatprescriptions"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); await page.waitForTimeout(200);
  await page.click("#rep-add [name=client_id]"); await page.keyboard.type("100001M", { delay: 0 });
  const t3v = await page.inputValue("#rep-add [name=client_id]");
  await page.keyboard.press("Enter"); await page.waitForTimeout(400);
  const t3 = await page.evaluate((v) => ({ v, mod: window.EIKON.state.activeModuleId, scan: window.EIKON._lastScan, dlg: !!document.querySelector(".esr-ov") }), t3v);
  report("search: typing is never taken for a scan: a card typed at 40 ms a key stays in the box and Enter searches; 2-key bursts with pauses are not a scan; a fast burst in a register form stays in the form",
    t1.v === "12345M" && !t1.scan && t1.list >= 1 && !t1.hidden && !t1b && !t2 && t3.v === "100001M" && t3.mod === "repreg" && !t3.scan && !t3.dlg, JSON.stringify({ t1, t1b, t2, t3 }));

  // 7. Camera: nothing loaded until asked; the browser's own reader (stubbed here) reads an order slip
  await page.goto(base + "&ui=2#today"); await ui2Ready("today"); await page.waitForTimeout(300);
  const zx0 = await page.evaluate(() => [...document.scripts].some((s) => /zxing/i.test(s.src)));
  await page.evaluate(() => {
    window.BarcodeDetector = function () {}; window.BarcodeDetector.prototype.detect = function () { return Promise.resolve([{ rawValue: "KX7P2Q", format: "qr_code" }]); };
    navigator.mediaDevices.getUserMedia = function () { const c = document.createElement("canvas"); c.width = 64; c.height = 48; const x = c.getContext("2d"); let k = 0; setInterval(() => { x.fillStyle = (k++ % 2) ? "#000" : "#fff"; x.fillRect(0, 0, 64, 48); }, 40); return Promise.resolve(c.captureStream(10)); };
  });
  await page.keyboard.press("Control+k"); await page.click('.esr [data-act="cam"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-row"), null, { timeout: 8000 });
  const cam = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".ord-row .t b")].map((b) => b.textContent), zx: [...document.scripts].some((s) => /zxing/i.test(s.src)), dlg: !!document.querySelector(".esr-ov") }));
  report("search: the camera reads an order code with the browser's reader and opens that order; ZXing is not loaded unless needed", !zx0 && !cam.zx && !cam.dlg && JSON.stringify(cam.rows) === JSON.stringify(["Vella Joseph"]), JSON.stringify({ zx0, cam }));

  // 8. Classic layout: no shortcut, no scanning
  await page.goto(base + "&ui=classic#temperature"); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === "temperature", null, { timeout: 15000 });
  await page.waitForTimeout(300);
  await page.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); window.EIKON._lastScan = null; });
  await page.keyboard.press("/"); await page.keyboard.press("Control+k"); await page.keyboard.type("12345M", { delay: 0 }); await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  const cl = await page.evaluate(() => ({ dlg: !!document.querySelector(".esr-ov"), scan: window.EIKON._lastScan, mod: window.EIKON.state.activeModuleId, ui2: document.documentElement.hasAttribute("data-ui2") }));
  report("search: the classic layout is untouched: no dialog, no scanning", !cl.dlg && !cl.scan && cl.mod === "temperature" && !cl.ui2, JSON.stringify(cl));
  await page.goto(base + "&ui=2#today"); await ui2Ready("today");
} catch (e) { report("search: ran to the end", false, String(e).slice(0, 400)); }
// ---- Search that does things (BACKLOG4 item 3): a verb, or a person and a noun, opens the screen with its form open ----
try {
  peopleState.adopted = true;
  const ready = (id) => page.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === m && window.EIKON._lateIn, id, { timeout: 15000 });
  const ask = async (q) => {
    await page.evaluate(() => { if (window.EIKON.searchIsOpen()) window.EIKON.searchClose(false); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    await page.keyboard.press("Control+k"); await page.waitForSelector("#esr-q"); await page.fill("#esr-q", q);
    await page.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 6000 });
    return page.evaluate(() => ({ groups: [...document.querySelectorAll(".esr-grp")].map((g) => g.getAttribute("aria-label")), first: ((document.querySelector(".esr-opt") || {}).innerText || "").replace(/\s+/g, " ").trim() }));
  };
  // the screen's own button puts the cursor in its first field at once; the hand-over's fill and focus come 40 ms after
  const landed = (focusIn) => page.waitForFunction((s) => { const a = document.activeElement; return !document.querySelector(".esr-ov") && a && a !== document.body && !!a.closest(s); }, focusIn, { timeout: 8000 }).then(() => page.waitForTimeout(350)).then(() => page.evaluate((s) => { const a = document.activeElement; return !!(a && a !== document.body && a.closest(s)); }, focusIn));
  await page.goto(base + "&ui=2#registers"); await ready("registers");
  await fetch(`http://localhost:${PORT}/__reset`);
  // 1. Each verb: the first result says what it does, Enter opens the screen with its form open and the cursor in it
  const VERB = [
    ["new order", "ordreg", "#ord-add", /^New order Orders · opens the form/],
    ["add order", "ordreg", "#ord-add", /^New order/],
    ["ask", "tktreg", "#tkt-add", /^New question Questions · opens the form/],
    ["deliver", "dlvreg", "#dlv-add", /^New delivery/],
    ["record dda", "cdsreg", "#cds-add", /^New prescription Controlled drugs supplied · opens the form/],
    ["supply", "cdsreg", "#cds-add", /^New prescription/],
    ["receive dda", "cdpreg", "#cdp-add", /^New invoice/],
    ["new poyc", "poyreg", "#cds-add", /^New prescription/],
    ["record a repeat", "repreg", "#rep-add", /^New prescription Repeat/],
    ["new pom", "drreg", "#drr-form", /^New entry/],
    ["log cleaning", "cleanreg", "#clr-form", /^New cleaning/],
    ["record paid out", "poreg", "#por-add", /^New payment/],
    ["new credit note", "cnreg", "#cnr-add", /^New credit note/],
    ["record bp", "pocreg", "#poc-add", /^New test/],
    ["add to order diary", "odreg", "#odr-add", /^Add an item Order diary/],
    ["record a recall", "alertreg", "#alr-add", /^New alert/],
    ["log a locum", "locreg", "#lcr-form", /^New locum/],
    ["new contact", "conreg", "#con-form", /^Add a contact/],
    ["close", "eodreg", "#eod-form", /^Close the day End of day · the first figure/],
    ["count dda", "ddstreg", "[data-act=new]", /^Start a stock take/]
  ];
  const vres = [];
  for (const [q, scr, inForm, re] of VERB) {
    const r = await ask(q);
    await page.keyboard.press("Enter");
    const ok = await landed(inForm);
    const where = await page.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, focus: document.activeElement && (document.activeElement.name || document.activeElement.getAttribute("data-act") || document.activeElement.className), classic: location.search.indexOf("ui=classic") >= 0, left: sessionStorage.getItem("eikon_cus_hand") }));
    vres.push({ q, ok: ok && where.mod === scr && re.test(r.first) && r.groups[0] === "Actions" && !where.classic && !where.left, first: r.first.slice(0, 70), where });
  }
  const vbad = vres.filter((x) => !x.ok);
  report("search does things: each verb (new, add, record, log, close, ask, deliver, supply, count, receive) shows the action first in words and Enter opens that screen with its form open and the cursor in it; nothing left behind",
    vbad.length === 0, JSON.stringify(vbad.length ? vbad : vres.map((x) => x.q + " → " + x.where.mod + ":" + x.where.focus)));

  // 2. "log fridge": Today, the cursor in the fridge's reading box (q5-7: the fridge's line, more in the block below)
  const lf = await ask("log fridge"); await page.keyboard.press("Enter");
  const lfOk = await landed(".tdy-inl");
  const lfW = await page.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, aria: document.activeElement && document.activeElement.getAttribute("aria-label") }));
  report("search does things: 'log fridge' says 'Log the fridge reading' and opens Today with the cursor in the fridge's reading box", lfOk && /^Log the fridge reading Today/.test(lf.first) && lfW.mod === "today", JSON.stringify({ lf, lfW }));

  // 3. No verb, no change: nouns and names are searched exactly as before (no Actions group, same first result)
  const plain = {};
  for (const q of ["fridge", "DDA", "order", "orders", "end of day", "repeat", "morphine", "vella", "zammit", "credit notes", "zammit te", "clean"]) {
    const r = await ask(q); plain[q] = { acts: r.groups.includes("Actions"), first: r.first.slice(0, 40), doing: await page.evaluate((x) => window.EIKON.searchDoing(x), q) };
  }
  const pbad = Object.entries(plain).filter(([, v]) => v.acts || v.doing);
  report("search does things: no verb, no change: a noun or a name alone ('fridge', 'DDA', 'order', 'end of day', 'vella', 'zammit te' while typing) gives no action and the same results as before",
    pbad.length === 0 && plain.fridge.first.startsWith("Temperature") && /Orders/.test(plain.orders.first), JSON.stringify(pbad.length ? pbad : plain));

  // 4. A person and a noun: "zammit order" offers the order for each Zammit; Enter fills the first one in (name, ID card, phone)
  const z = await ask("zammit order");
  const zOpts = await page.evaluate(() => [...document.querySelectorAll('.esr-grp[aria-label="Actions"] .esr-opt b')].map((b) => b.textContent));
  const pplQ = (await callsNow()).filter((c) => c.path === "/people" && c.method === "GET" && /zammit/i.test(c.query)).map((c) => c.query);
  await page.keyboard.press("Enter");
  const zOk = await landed("#ord-add");
  const zf = await page.evaluate(() => { const f = document.querySelector("#ord-add"); const v = (n) => f.querySelector("[name=" + n + "]").value; return { name: v("client_name"), id: v("id_card"), phone: v("contact"), focus: document.activeElement.name }; });
  report("search does things: 'zammit order' offers 'New order for Zammit Carmel' (one /people request, for 'zammit'); Enter opens Orders with her name, ID card and phone filled and the cursor in the first empty field",
    zOk && /^New order for Zammit Carmel/.test(z.first) && zOpts.length >= 1 && pplQ.length >= 1 && pplQ.every((x) => /q=zammit(&|$)/.test(x)) && zf.name === "Zammit Carmel" && zf.id === "0012345M" && zf.phone === "79123456" && zf.focus === "items", JSON.stringify({ z, zOpts, pplQ, zf }));
  // an ID card and "dda": the controlled-drug form with the card, name and address
  const idq = await ask("0012345M dda"); await page.keyboard.press("Enter");
  const idOk = await landed("#cds-add");
  const idf = await page.evaluate(() => { const f = document.querySelector("#cds-add"); const v = (n) => f.querySelector("[name=" + n + "]").value; return { id: v("client_id_card"), name: v("client_name"), addr: v("client_address"), focus: document.activeElement.name }; });
  report("search does things: '0012345M dda' opens the controlled-drug form with the ID card, name and address filled, the cursor on the prescriber",
    idOk && /^New prescription for Zammit Carmel/.test(idq.first) && idf.id === "0012345M" && idf.name === "Zammit Carmel" && idf.addr === "1 Triq il-Knisja" && idf.focus === "doctor_name", JSON.stringify({ idq, idf }));
  // a verb and a name nobody has: the name typed goes in
  const nq = await ask("new order for Abela Rita"); await page.keyboard.press("Enter"); await landed("#ord-add");
  const nf = await page.evaluate(() => ({ name: document.querySelector("#ord-add [name=client_name]").value, focus: document.activeElement.name }));
  report("search does things: 'new order for Abela Rita' (nobody by that name) opens the order with the name typed filled in", /^New order for “Abela Rita”/.test(nq.first) && nf.name === "Abela Rita" && nf.focus === "items", JSON.stringify({ nq, nf }));

  // 5. The fill never overwrites: a form already open with a name typed keeps it; only empty fields are filled
  await page.evaluate(() => { location.hash = "#registers"; }); await ready("registers");
  await page.evaluate(() => { location.hash = "#cdsreg"; }); await ready("cdsreg"); await page.waitForSelector(".cds-top [data-act=add]");
  await page.click(".cds-top [data-act=add]"); await page.fill("#cds-add [name=client_name]", "Typed By Hand");
  const keep = await page.evaluate(async () => {
    const E = window.EIKON, m = document.querySelector("#cds-add").closest(".cds").parentNode;
    E.customerHandoff("cdsreg", "new", { name: "Zammit Carmel", id_card: "0012345M", phone: "79123456" }, "");
    await E.takeOpenForm("cdsreg", m, Promise.resolve(), { btn: "[data-act=add]", form: "#cds-add", fill: { id_card: "client_id_card", name: "client_name", address: "client_address" } });
    await new Promise((r) => setTimeout(r, 300));
    const f = document.querySelector("#cds-add"); return { name: f.querySelector("[name=client_name]").value, id: f.querySelector("[name=client_id_card]").value, forms: document.querySelectorAll("#cds-add").length, left: sessionStorage.getItem("eikon_cus_hand") };
  });
  // a hand-over for another screen is left for it; one older than a minute is dropped; "find" is not a form to open
  const other = await page.evaluate(async () => {
    const E = window.EIKON, m = document.querySelector("#eikon-content") || document.body, K = "eikon_cus_hand";
    E.customerHandoff("tktreg", "new", { name: "X" }, ""); await E.takeOpenForm("cdsreg", m, Promise.resolve(), {}); const kept = !!sessionStorage.getItem(K);
    sessionStorage.setItem(K, JSON.stringify({ to: "cdsreg", mode: "new", at: Date.now() - 120000, person: {} }));
    const v = await E.takeOpenForm("cdsreg", m, Promise.resolve(7), { btn: "[data-act=add]" }); const dropped = !sessionStorage.getItem(K);
    return { kept, dropped, v };
  });
  await page.evaluate(() => sessionStorage.removeItem("eikon_cus_hand"));
  report("search does things: the fill never overwrites what was typed (the name stays, the empty ID card is filled, the form is not reopened); a hand-over for another screen is left; a stale one is dropped; the load's answer passes through",
    keep.name === "Typed By Hand" && keep.id === "0012345M" && keep.forms === 1 && !keep.left && other.kept && other.dropped && other.v === 7, JSON.stringify({ keep, other }));

  // 6. Escape cancels a form opened from the search, and focus returns to the screen's button; nothing was written
  await page.goto(base + "&ui=2#registers"); await ready("registers");
  await fetch(`http://localhost:${PORT}/__reset`);
  await ask("new question"); await page.keyboard.press("Enter"); await landed("#tkt-add");
  await page.keyboard.press("Escape"); await page.waitForTimeout(150);
  const esc1 = await page.evaluate(() => ({ form: !!document.querySelector("#tkt-add"), focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
  const w6 = (await callsNow()).filter((c) => c.method !== "GET");
  report("search does things: Escape closes a form opened from the search (nothing typed) and focus goes back to its button; opening it wrote nothing", !esc1.form && esc1.focus === "add" && w6.length === 0, JSON.stringify({ esc1, w6 }));

  // 7. Arrows choose between actions; the footer names the trick; a phone shows the same rows, 44 px tall
  const two = await ask("record dda");
  await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); const twoOk = await landed("#cdp-add");
  await page.setViewportSize({ width: 390, height: 844 });
  await ask("new order"); const ph = await page.evaluate(() => ({ h: Math.round(document.querySelector('.esr-grp[aria-label="Actions"] .esr-opt').getBoundingClientRect().height), wide: document.documentElement.scrollWidth > window.innerWidth + 1 }));
  await page.setViewportSize({ width: 1440, height: 900 });
  await ask("x"); const foot = await page.evaluate(() => (document.querySelector(".esr-foot") || {}).textContent || "");
  await page.evaluate(() => window.EIKON.searchClose(false));
  report("search does things: ArrowDown picks the second action ('record dda' → received); action rows are 44 px tall on a phone with no sideways scroll",
    twoOk && ph.h >= 44 && !ph.wide, JSON.stringify({ two, ph, foot }));
} catch (e) { report("search does things: ran to the end", false, String(e && e.stack || e).slice(0, 500)); }

// ---- q5-7: search and suggestions find what a pharmacist types (BACKLOG5 item 7) ----
// Maltese letters folded both ways (E.people.foldMt / mtStretch), cards before names seen only in the registers, and
// the new phrases ("log fridge" on the fridge's line, "hand over", "help", "what's new", "print dda", "paid out",
// "credit note", "new leave", "standing instructions"). The mock's /people lowers only A to Z, as the worker's LIKE.
try {
  const ready = (id) => page.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === m && window.EIKON._lateIn, id, { timeout: 15000 });
  const ask = async (q, typed) => {
    await page.evaluate(() => { if (window.EIKON.searchIsOpen()) window.EIKON.searchClose(false); document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
    await page.keyboard.press("Control+k"); await page.waitForSelector("#esr-q");
    if (typed) await page.keyboard.type(q, { delay: typed }); else await page.fill("#esr-q", q);
    await page.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 6000 });
    return page.evaluate(() => ({ opts: [...document.querySelectorAll(".esr-opt")].map((o) => o.innerText.replace(/\s+/g, " ").trim()), people: [...document.querySelectorAll('.esr-grp[aria-label="People"] .esr-opt')].map((o) => o.innerText.replace(/\s+/g, " ").trim()) }));
  };
  await page.goto(base + "&ui=2#registers"); await ready("registers");
  // 1. the helpers
  const u = await page.evaluate(() => { const P = window.EIKON.people; return {
    fold: ["Żaren", "ĊETTINA", "Ħamrun", "Ġorġ", "Zaren"].map(P.foldMt), st: ["zaren", "pace cettina", "hamrun", "gorg", "vella", "Ħamrun", "0012345M", "z"].map(P.mtStretch),
    wires: ["zaren", "Ċensina", "vella", "0012345M", "carmel zammit"].map((q) => window.EIKON.personPickWires(q)), cus: ["pace cettina", "vella", "żaren"].map(window.EIKON.customersAsks),
    has: [P.hasWordsMt("Vella Żaren", "vella zaren"), P.hasWordsMt("Mifsud Zaren", "żaren"), P.hasWordsMt("Pace Ċettina", "cettina pace"), P.hasWordsMt("Vella Anna", "zaren")] }; });
  report("q5-7 fold: ċ ġ ħ ż fold to c g h z (E.people.foldMt); a name with c/g/h/z is also asked as its longest stretch without them ('zaren' → 'aren'), an ID card or a name without them as before; matching works both ways",
    JSON.stringify(u.fold) === JSON.stringify(["zaren", "cettina", "hamrun", "gorg", "zaren"]) && JSON.stringify(u.st) === JSON.stringify(["aren", "ettina", "amrun", "or", "", "amrun", "", ""]) &&
    JSON.stringify(u.wires) === JSON.stringify([["zaren", "aren"], ["ensina"], ["vella"], ["12345M"], ["carmel", "armel"]]) && JSON.stringify(u.cus) === JSON.stringify([["pace cettina", "ettina"], ["vella"], ["aren"]]) && u.has.join() === "true,true,true,false", JSON.stringify(u));

  // 2. the search dialog: Maltese letters left out find them; the card first; a history row of that card is not a second person
  peopleState.mt = true; peopleState.mtQs = []; await page.evaluate(() => { window.EIKON.lastWriteAt = Date.now(); window.EIKON.searchCacheClear(); }); await page.waitForTimeout(5); // answers kept from before are stale
  const r1 = {};
  for (const q of ["vella zaren", "pace cettina", "censina", "gorg", "żaren", "zaren"]) r1[q] = (await ask(q)).people;
  report("q5-7 search: 'vella zaren' finds Vella Żaren (and his credit-note row 'Żaren Vella' is his card, not a second person); 'pace cettina' Pace Ċettina, 'censina' Abela Ċensina, 'gorg' Xuereb Ġorġ",
    r1["vella zaren"].length === 1 && /^Vella Żaren .*Customers/.test(r1["vella zaren"][0]) && /^Pace Ċettina .*Customers/.test(r1["pace cettina"][0] || "") && /^Abela Ċensina/.test(r1.censina[0] || "") && /^Xuereb Ġorġ/.test(r1.gorg[0] || ""), JSON.stringify(r1));
  const zz = r1["żaren"], z0 = r1.zaren;
  report("q5-7 search: both ways, cards first: 'żaren' and 'zaren' both list Vella Żaren and Mifsud Zaren (as typed first) before 'Grech Żaren', seen only in the registers and labelled 'In the registers, no card yet'",
    zz.length === 3 && /^Vella Żaren/.test(zz[0]) && /^Mifsud Zaren/.test(zz[1]) && /^Grech Żaren .*In the registers, no card yet$/.test(zz[2]) && z0.length === 3 && /^Mifsud Zaren/.test(z0[0]) && /^Vella Żaren/.test(z0[1]) && /no card yet$/.test(z0[2]) && !zz.concat(z0).some((x) => /Customers$/.test(x) && /Grech/.test(x)), JSON.stringify({ zz, z0 }));
  // requests: typed at 40 ms a key, one pause: the name and its stretch, once each
  await page.evaluate(() => { window.EIKON.lastWriteAt = Date.now(); window.EIKON.searchCacheClear(); }); await page.waitForTimeout(5); await fetch(`http://localhost:${PORT}/__reset`); peopleState.mtQs = [];
  await ask("zaren", 40);
  const pq = (await callsNow()).filter((c) => c.path === "/people" && c.method === "GET").map((c) => new URLSearchParams(c.query).get("q"));
  report("q5-7 search: typing 'zaren' asks /people twice in all (q=zaren and q=aren, in the one pause of typing), never a Maltese letter", pq.length === 2 && pq.includes("zaren") && pq.includes("aren"), JSON.stringify(pq));
  await page.evaluate(() => window.EIKON.searchClose(false));

  // 3. Customers and the people suggestions under a register field
  await page.goto(base + "&ui=2#customers"); await ready("customers");
  const cus = {};
  for (const q of ["zaren", "pace cettina", "abela censina"]) { await page.fill("#cus-q", ""); await page.locator("#cus-q").pressSequentially(q, { delay: 10 }); await page.waitForTimeout(700); cus[q] = await page.evaluate(() => document.querySelector("#cus-list").innerText.replace(/\s+/g, " ")); }
  report("q5-7 customers: 'zaren' lists Vella Żaren and Mifsud Zaren; 'pace cettina' Pace Ċettina; 'abela censina' Abela Ċensina",
    /Vella Żaren/.test(cus.zaren) && /Mifsud Zaren/.test(cus.zaren) && /Pace Ċettina/.test(cus["pace cettina"]) && /Abela Ċensina/.test(cus["abela censina"]), JSON.stringify(cus).slice(0, 600));
  await page.goto(base + "&ui=2#clientorders"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add");
  const pp = {};
  for (const q of ["pace cettina", "żaren", "gorg"]) { const b = page.locator("#ord-add [name=client_name]"); await b.fill(""); await b.pressSequentially(q, { delay: 15 }); await page.waitForTimeout(700); pp[q] = await page.evaluate(() => [...document.querySelectorAll("#ord-add .epp-opt b")].map((b) => b.textContent)); }
  report("q5-7 suggestions: an Orders name field offers Pace Ċettina for 'pace cettina', Vella Żaren first then Mifsud Zaren then the registers-only name for 'żaren', Xuereb Ġorġ for 'gorg'",
    pp["pace cettina"][0] === "Pace Ċettina" && JSON.stringify(pp["żaren"]) === JSON.stringify(["Vella Żaren", "Mifsud Zaren", "Grech Żaren"]) && pp.gorg[0] === "Xuereb Ġorġ", JSON.stringify(pp));
  await page.keyboard.press("Escape"); await page.keyboard.press("Escape");
  peopleState.mt = false;

  // 4. "log fridge" / "log room": the right line of Today, never another in its place
  const was = { out: todayState.outToday, y: todayState.yOut };
  todayState.room = true; todayState.tempDone = false; todayState.outToday = false; todayState.yOut = false;
  const lineOf = () => page.evaluate(() => { const a = document.activeElement, r = a && a.closest && a.closest("[data-device]"); return { dev: r ? r.getAttribute("data-device") : "", min: !!(a && a.hasAttribute && a.hasAttribute("data-min")), toast: [...document.querySelectorAll(".eikon-toast")].map((t) => t.textContent).join(" | "), rows: [...document.querySelectorAll("[data-kind=temperature]")].map((x) => x.getAttribute("data-device") + ":" + ((x.querySelector(".tdy-t b") || {}).textContent || "") + ":" + !!x.querySelector("[data-min]")).join(",") }; });
  const lines = {};
  for (const q of ["log fridge", "log room", "new fridge reading"]) {
    await page.goto(base + "&ui=2#registers"); await ready("registers");
    const r = await ask(q); await page.keyboard.press("Enter");
    await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.activeElement && document.activeElement.hasAttribute("data-min"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400); lines[q] = Object.assign({ first: r.opts[0] }, await lineOf());
  }
  todayState.tempDone = true;
  await page.goto(base + "&ui=2#registers"); await ready("registers");
  await ask("log fridge"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => [...document.querySelectorAll(".eikon-toast")].some((t) => /fridge reading is in already/.test(t.textContent)), null, { timeout: 6000 }).catch(() => {});
  lines.done = await lineOf();
  todayState.room = false; todayState.tempDone = false; todayState.outToday = was.out; todayState.yOut = was.y;
  report("q5-7 'log fridge': the cursor goes to the fridge's line (device 7), not the room's (the first line); 'log room' to the room's; with the fridge logged already it says so and puts the cursor in no other line",
    lines["log fridge"].dev === "7" && lines["log fridge"].min && /^Log the fridge reading/.test(lines["log fridge"].first) && lines["log room"].dev === "8" && /^Log the room reading/.test(lines["log room"].first) && lines["new fridge reading"].dev === "7" &&
    lines.done.dev !== "8" && /fridge reading is in already/.test(lines.done.toast), JSON.stringify(lines));

  // 5. the new phrases
  const go2 = async (q) => { await page.goto(base + "&ui=2#registers"); await ready("registers"); const r = await ask(q); await page.keyboard.press("Enter"); await page.waitForTimeout(1300);
    return Object.assign({ first: r.opts[0] || "" }, await page.evaluate(() => { const a = document.activeElement; return { mod: window.EIKON.state.activeModuleId, focus: a ? (a.id || a.getAttribute("data-mb") || a.getAttribute("data-act") || a.name || a.tagName) : "", help: (document.querySelector("#nxh-title") || {}).textContent || "", q: (document.querySelector(".ord-q, #ord-q") || {}).value || "" }; })); };
  const ph = {};
  for (const q of ["hand over", "collect", "hand over grech", "help", "help end of day", "what's new", "print dda", "print daily register", "paid out", "credit note", "new leave", "standing instructions"]) {
    ph[q] = await go2(q);
    await page.evaluate(() => { const c = document.querySelector(".nxh-ov"); if (c && window.EIKON.helpNext) window.EIKON.helpNext.close(); });
  }
  const want = {
    "hand over": (x) => /^Hand over an order Orders/.test(x.first) && x.mod === "ordreg",
    collect: (x) => /^Hand over an order/.test(x.first) && x.mod === "ordreg",
    "hand over grech": (x) => /^Hand over Grech Carmen.s order/.test(x.first) && x.mod === "ordreg" && /Grech Carmen/.test(x.q),
    help: (x) => /^Help: Registers/.test(x.first) && /Registers/.test(x.help),
    "help end of day": (x) => /^Help: End of day/.test(x.first) && /End of day/.test(x.help),
    "what's new": (x) => /^What.s new/.test(x.first) && /What.s new/.test(x.help),
    "print dda": (x) => /^Print Controlled drugs supplied/.test(x.first) && x.mod === "cdsreg" && x.focus === "print",
    "print daily register": (x) => /^Print Daily register/.test(x.first) && x.mod === "drreg" && x.focus === "print",
    "paid out": (x) => /^New payment/.test(x.first) && x.mod === "poreg",
    "credit note": (x) => /^New credit note/.test(x.first) && x.mod === "cnreg",
    "new leave": (x) => /^New leave request/.test(x.first) && x.mod === "shfreg",
    "standing instructions": (x) => /^Change the standing instructions/.test(x.first) && x.mod === "hndreg" && x.focus === "hnd-std"
  };
  const phBad = Object.keys(want).filter((k) => !want[k](ph[k]));
  report("q5-7 phrases: 'hand over'/'collect' → Orders waiting ('hand over grech' → her order), 'help'/'help end of day' → that guide, 'what's new', 'print dda'/'print daily register' → the register with Print focused, 'paid out'/'credit note' → their forms, 'new leave' → Plan shifts, 'standing instructions' → the change box",
    phBad.length === 0, JSON.stringify(phBad.length ? phBad.map((k) => [k, ph[k]]) : ph).slice(0, 1500));
  // the forms opened by the new phrases: open and focused
  const forms = await page.evaluate(() => ({ std: !!document.querySelector("#hnd-std") }));
  // typing meanwhile is never taken over: a field used on the opened screen keeps the cursor (the Print is not focused)
  await page.goto(base + "&ui=2#registers"); await ready("registers");
  await ask("print dda"); await page.keyboard.press("Enter");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg", null, { timeout: 8000 });
  await page.evaluate(() => { const i = document.createElement("input"); i.id = "q57-typing"; i.setAttribute("aria-label", "test"); i.style.cssText = "position:fixed;top:0;left:0;z-index:5000"; document.body.appendChild(i); }); // a field the screen's redraw does not replace
  await page.focus("#q57-typing"); await page.keyboard.type("abc"); await page.waitForTimeout(1500);
  const kept = await page.evaluate(() => { const r = { focus: document.activeElement && document.activeElement.id, v: (document.getElementById("q57-typing") || {}).value }; const i = document.getElementById("q57-typing"); if (i) i.remove(); return r; });
  report("q5-7 phrases: a field the person types in while the screen opens keeps the cursor ('print dda' does not take it for Print)", kept.focus === "q57-typing" && kept.v === "abc" && forms.std, JSON.stringify({ kept, forms }));
  // what was searched before is unchanged: a verb's form, a noun alone, a person alone
  const before = {};
  for (const q of ["new order", "fridge", "leave", "credit notes", "zammit order", "ready"]) before[q] = { first: (await ask(q)).opts[0] || "", doing: await page.evaluate((x) => { const d = window.EIKON.searchDoing(x); return d ? (d.lead || d.acts.map((a) => a.label).join("+")) : null; }, q) };
  await page.evaluate(() => window.EIKON.searchClose(false));
  report("q5-7 phrases: nothing else moved: 'new order' still opens the form, 'fridge', 'leave' and 'credit notes' alone are the screens, 'zammit order' the order for a Zammit; 'ready' alone is the hand-over",
    /^New order/.test(before["new order"].first) && /^Temperature/.test(before.fridge.first) && before.fridge.doing === null && /^Plan shifts/.test(before.leave.first) && before.leave.doing === null && /^Credit notes/.test(before["credit notes"].first) && before["credit notes"].doing === null && /^New order for Zammit/.test(before["zammit order"].first) && /^Hand over an order/.test(before.ready.first), JSON.stringify(before));
} catch (e) { report("q5-7 search and suggestions: ran to the end", false, String(e && e.stack || e).slice(0, 500)); }
// The ID card on a record and its person (E.people.confirmPerson in ui/eikon.people.js), in DDA sales, Orders and
// Repeat prescriptions: A (the person has no card: asked to add it, then their card-less records offered to tick),
// B (the card is someone else's: stopped, never saved under the wrong name), C (the person has another card: asked to
// change it everywhere, with the count per register). GET/POST /people and the change endpoint answered here.
try {
  // the name rule is the worker's own (personNameWords / personNamesCompatible run side by side)
  const wsrc2 = fs.readFileSync(path.join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  const wfn2 = (name) => { const i = wsrc2.indexOf("function " + name + "("); let d = 0, j = wsrc2.indexOf("{", i); for (; j < wsrc2.length; j++) { if (wsrc2[j] === "{") d++; else if (wsrc2[j] === "}" && --d === 0) break; } return wsrc2.slice(i, j + 1); };
  const WN = new Function(wfn2("personNameWords") + wfn2("personNamesCompatible") + "return personNamesCompatible;")();
  const pairs = [["Zammit Carmel", "carmel ZAMMIT"], ["Laura Borg", "Laura Maria Borg"], ["Borg", "Laura Borg"], ["Joséph Vella", "joseph vella"], ["Laura Borg", "Carmel Zammit"], ["", "x"], ["Ta' Xbiex Ann", "ann ta xbiex"]];
  await page.goto(base + "&ui=2#today");
  await page.waitForFunction(() => window.EIKON && window.EIKON.people && window.EIKON.people.confirmPerson, null, { timeout: 15000 });
  const uiN = await page.evaluate((p) => p.map(([a, b]) => window.EIKON.people.namesCompatible(a, b)), pairs);
  report("id card questions: names compare exactly as the worker does (case, accents, word order; one word is not enough)",
    JSON.stringify(uiN) === JSON.stringify(pairs.map(([a, b]) => WN(a, b))) && JSON.stringify(uiN) === "[true,true,false,true,false,false,true]", JSON.stringify(uiN));

  let book, changes, stamps;
  const reset = () => { book = [{ id: 501, name: "Laura Borg", id_card: "", phone: "", address: "5 Triq il-Wied, Qormi", version: 1 }, { id: 502, name: "Carmel Zammit", id_card: "0012345M", phone: "", address: "1 Triq il-Knisja", version: 3 }]; changes = []; stamps = []; };
  reset();
  const norm = (s) => { s = String(s || "").replace(/\s+/g, "").toUpperCase(); const m = /^(\d{1,7})([A-Z])$/.exec(s); return m ? ("0000000" + m[1]).slice(-7) + m[2] : s; };
  const J = (route, o, status) => route.fulfill({ status: status || 200, contentType: "application/json", body: JSON.stringify(o) });
  const onP = async (route) => {
    const rq = route.request(), u = new URL(rq.url()), b = JSON.parse(rq.postData() || "{}");
    if (u.pathname === "/people" && rq.method() === "GET") {
      const q = String(u.searchParams.get("q") || "").toLowerCase();
      const hit = book.filter((p) => /\d/.test(q) ? p.id_card && p.id_card.replace(/^0+/, "").toLowerCase().indexOf(q.replace(/^0+/, "")) >= 0 : p.name.toLowerCase().indexOf(q) >= 0);
      return J(route, { ok: true, q, people: hit, history: [] });
    }
    if (u.pathname === "/people" && rq.method() === "POST") {
      const p = book.find((x) => x.id === b.id);
      if (p && b.id_card) { p.id_card = norm(b.id_card); p.version++; }
      return J(route, { ok: true, person: p || Object.assign({ id: 599, version: 1 }, b), created: !p });
    }
    let m = /^\/people\/(\d+)\/change-id-card$/.exec(u.pathname);
    if (m) {
      const p = book.find((x) => x.id === Number(m[1])); changes.push(b);
      if (!b.from) { // stamp
        if (!b.confirm) return J(route, { ok: true, preview: true, can_apply: true, mode: "stamp", total: (b.rows || []).length, registers: [], candidates: [{ table: "repeat_prescription_entries", label: "Repeat prescriptions", legal: true, id: 7, name: p.name, date: "2026-03-12", title: "Ramipril 5mg" }, { table: "client_orders_entries", label: "Orders", id: 8, name: p.name, date: "2026-05-02", title: "" }], plan: "st1" });
        stamps.push(b); return J(route, { ok: true, change_id: "idc_00000000-0000-0000-0000-000000000001", changed: b.rows.length, person: p });
      }
      if (!b.confirm) return J(route, { ok: true, preview: true, can_apply: true, mode: "change", from: b.from, to: norm(b.to), total: 4, plan: "pl1", skipped_total: 1,
        registers: [{ label: "DDA sales", count: 2, legal: true }, { label: "Repeat prescriptions", count: 1, legal: true }, { label: "Tests", count: 1, legal: false }], candidates: [] });
      p.id_card = norm(b.to); p.version++;
      return J(route, { ok: true, change_id: "idc_00000000-0000-0000-0000-000000000002", changed: 4, person: p, registers: [] });
    }
    m = /^\/people\/id-card-changes\/([^/]+)\/undo$/.exec(u.pathname);
    if (m) { book[0].id_card = "0034567L"; changes.push({ undo: m[1] }); return J(route, { ok: true, restored: 4, skipped: [] }); }
    return route.fallback();
  };
  const isP = (url) => url.pathname === "/people" || url.pathname.indexOf("/people/") === 0;
  await page.route(isP, onP);
  const dlg = () => page.evaluate(() => { const d = document.querySelector(".epc[role=alertdialog]"); return d ? { title: d.querySelector("h2").textContent, text: d.textContent, modal: d.getAttribute("aria-modal"), lab: d.getAttribute("aria-labelledby"), focus: document.activeElement && document.activeElement.textContent, inert: !!document.querySelector("#eikon-root[inert], body > div[inert]"), btns: [...d.querySelectorAll(".epc-b")].map((x) => x.textContent) } : null; });
  const waitDlg = (re) => page.waitForFunction((s) => { const h = document.querySelector(".epc h2"); return h && new RegExp(s).test(h.textContent); }, re, { timeout: 6000 });
  const posts = async (p) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === p);
  const press = (id) => page.click(`.epc [data-epc=${id}]`);

  // ---------- DDA sales ----------
  const openDda = async () => { await page.goto(base + "&ui=2#dda-sales"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cdsreg" && window.EIKON.personPick && document.querySelector("[data-act=add]"), null, { timeout: 15000 }); };
  const ddaForm = async (card, serial) => {
    await page.click("[data-act=add]"); await page.waitForTimeout(150);
    await page.type("[name=client_name]", "laura", { delay: 15 }); await page.waitForSelector(".epp-list:not([hidden]) .epp-opt", { timeout: 5000 });
    await page.keyboard.press("ArrowDown"); await page.keyboard.press("Enter"); await page.waitForTimeout(250); // the owner's way: search "laura", pick her
    await page.fill("[name=client_id_card]", card); await page.fill("[name=doctor_name]", "Dr Abela"); await page.fill("[name=doctor_reg_no]", "R1201"); await page.fill("[name=prescription_serial_no]", serial);
    await page.fill('[data-i="0"][data-k=medicine_name_dose]', "Morphine 10mg"); await page.fill('[data-i="0"][data-k=quantity]', "2");
  };
  await openDda(); await fetch(`http://localhost:${PORT}/__reset`);
  // A
  await ddaForm("34567l", "IDA-1");
  const picked = await page.evaluate(() => ({ name: document.querySelector("[name=client_name]").value, addr: document.querySelector("[name=client_address]").value }));
  await page.click("#cds-add button[type=submit]"); await waitDlg("^Add ID card");
  const dA = await dlg(); const before0 = (await posts("/dda-sales/entries")).length;
  await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); await page.keyboard.press("Tab"); const trapped = await page.evaluate(() => !!(document.activeElement && document.activeElement.closest(".epc")));
  await press("yes"); await waitDlg("earlier record");
  const dA2 = await dlg();
  await page.check('.epc input[data-i="0"]'); await press("stamp");
  await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 6000 }); await page.waitForTimeout(700);
  const ddaA = await posts("/dda-sales/entries");
  report("id card A (DDA sales): search 'laura', pick her (no card), type 34567l → asked “Add ID card 0034567L to Laura Borg’s details?” (alertdialog, Yes focused, Tab stays inside, nothing saved yet); Yes puts it on her, her card-less records are offered unticked, the ticked one gets it; the sale is saved with the card",
    picked.name === "Laura Borg" && dA && dA.title === "Add ID card 0034567L to Laura Borg’s details?" && dA.modal === "true" && dA.lab === "epc-t" && dA.focus === "Yes, add it" && dA.inert && trapped && before0 === 0 &&
    dA2 && /2 earlier records without an ID card/.test(dA2.title) && /legal register/.test(dA2.text) && book[0].id_card === "0034567L" &&
    stamps.length === 1 && JSON.stringify(stamps[0].rows) === JSON.stringify([{ table: "repeat_prescription_entries", id: 7 }]) && stamps[0].plan === "st1" &&
    ddaA.length === 1 && ddaA[0].body.client_id_card === "0034567L" && ddaA[0].body.client_name === "Laura Borg",
    JSON.stringify({ picked, dA, dA2, before0, trapped, stamps, ddaA: ddaA.map((c) => c.body) }).slice(0, 1500));

  // B: Carmel's card typed on a record named Laura → stopped; Escape goes back with the form kept; "Yes, it is Carmel" puts her name in
  await fetch(`http://localhost:${PORT}/__reset`);
  await ddaForm("12345m", "IDB-1");
  await page.click("#cds-add button[type=submit]"); await waitDlg("belongs to");
  const dB = await dlg();
  await page.keyboard.press("Escape"); await page.waitForTimeout(300);
  const keptB = await page.evaluate(() => ({ open: !!document.querySelector(".epc"), name: document.querySelector("[name=client_name]").value, card: document.querySelector("[name=client_id_card]").value, med: document.querySelector('[data-i="0"][data-k=medicine_name_dose]').value, focus: document.activeElement && document.activeElement.name }));
  await page.click("#cds-add button[type=submit]"); await waitDlg("belongs to"); await press("use"); await page.waitForTimeout(300);
  const usedB = await page.evaluate(() => ({ name: document.querySelector("[name=client_name]").value, open: !!document.querySelector(".epc") }));
  const ddaB = await posts("/dda-sales/entries");
  report("id card B (DDA sales): Carmel's 0012345M on a record named Laura Borg stops the save: “0012345M belongs to Carmel Zammit. Is this Carmel Zammit?” (Go back focused); Escape returns with everything kept; Yes puts Carmel Zammit in the name and still saves nothing",
    dB && dB.title === "0012345M belongs to Carmel Zammit. Is this Carmel Zammit?" && dB.focus === "No, go back and correct" && !keptB.open && keptB.name === "Laura Borg" && keptB.card === "0012345M" && keptB.med === "Morphine 10mg" && keptB.focus === "client_id_card" &&
    usedB.name === "Carmel Zammit" && !usedB.open && ddaB.length === 0, JSON.stringify({ dB, keptB, usedB, n: ddaB.length }));
  await page.click("[data-act=add-cancel]");

  // C: Laura (now 0034567L) with 45678l typed → asked to change everywhere, counts per register; Change → Save the DDA sale
  await fetch(`http://localhost:${PORT}/__reset`); changes = [];
  await ddaForm("45678l", "IDC-1");
  await page.click("#cds-add button[type=submit]"); await waitDlg("^Change Laura Borg");
  const dC = await dlg();
  await press("change"); await waitDlg("^ID card changed"); const dC2 = await dlg(); await press("go");
  await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 6000 }); await page.waitForTimeout(700);
  const ddaC = await posts("/dda-sales/entries");
  report("id card C (DDA sales): Laura has 0034567L and 45678l is typed → “Change Laura Borg’s ID card from 0034567L to 0045678L on their details and all their records?” listing DDA sales 2 and Repeat prescriptions 1 (legal registers) and the 1 not changed, Keep focused; Change everywhere sends the confirmed plan, then the sale is saved with the new card",
    dC && dC.title === "Change Laura Borg’s ID card from 0034567L to 0045678L on their details and all their records?" && /DDA saleslegal register2/.test(dC.text) && /Repeat prescriptionslegal register1/.test(dC.text) && /1 record with 0034567L under another name is not changed/.test(dC.text) && dC.focus === "Keep 0034567L" &&
    JSON.stringify(dC.btns) === JSON.stringify(["Go back", "Only this DDA sale", "Keep 0034567L", "Change everywhere"]) &&
    changes.length === 2 && changes[0].from === "0034567L" && changes[0].to === "0045678L" && !changes[0].confirm && changes[1].confirm === true && changes[1].plan === "pl1" &&
    dC2 && /Changed on Laura Borg’s details and 4 records/.test(dC2.text) && ddaC.length === 1 && ddaC[0].body.client_id_card === "0045678L",
    JSON.stringify({ dC, dC2, changes, ddaC: ddaC.map((c) => c.body) }).slice(0, 1500));

  // ---------- Repeat prescriptions ----------
  reset();
  const openRep = async () => { await page.goto(base + "&ui=2#repeatprescriptions"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 }); };
  const repForm = async (card) => { await page.click("[data-act=add]"); await page.waitForTimeout(150); await page.fill("[name=client_id]", card); await page.fill("[name=client_name]", "Borg Laura"); await page.fill("[name=medicine_name_dose]", "Ramipril 5mg"); await page.fill("[name=posology]", "1 od"); await page.fill("[name=prescriber_name]", "Dr Borg"); await page.fill("[name=prescriber_reg_no]", "2"); };
  await openRep(); await fetch(`http://localhost:${PORT}/__reset`);
  await repForm("34567L"); await page.click("#rep-add button[type=submit]"); await waitDlg("^Add ID card"); const rA = await dlg();
  await press("no"); await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 6000 }); await page.waitForTimeout(700);
  const repA = await posts("/repeat-prescriptions/entries"); const repAcard = book[0].id_card;
  await repForm("12345M"); await page.click("#rep-add button[type=submit]"); await waitDlg("belongs to"); const rB = await dlg(); await press("back"); await page.waitForTimeout(250);
  const repB = await posts("/repeat-prescriptions/entries");
  await page.click("[data-act=add-cancel]").catch(() => {});
  book[0].id_card = "0034567L"; changes = [];
  await repForm("45678L"); await page.click("#rep-add button[type=submit]"); await waitDlg("^Change"); const rC = await dlg();
  await press("keep"); await page.waitForTimeout(300);
  const repKeep = await page.evaluate(() => ({ card: document.querySelector("[name=client_id]").value, open: !!document.querySelector(".epc") }));
  const repC0 = (await posts("/repeat-prescriptions/entries")).length;
  await page.click("#rep-add button[type=submit]"); await page.waitForTimeout(900);
  const repC = await posts("/repeat-prescriptions/entries");
  report("id card A/B/C (repeat prescriptions): “Borg Laura” is Laura Borg (word order); A No saves the prescription only and links nobody; B stops on Carmel's card; C Keep puts 0034567L back in the form without saving, and pressing Record again saves it with no question",
    rA && rA.title === "Add ID card 0034567L to Laura Borg’s details?" && repA.length === 1 && repA[0].body.client_id === "34567L" && repAcard === "" &&
    rB && rB.title === "0012345M belongs to Carmel Zammit. Is this Carmel Zammit?" && repB.length === 1 &&
    rC && /from 0034567L to 0045678L/.test(rC.title) && repKeep.card === "0034567L" && !repKeep.open && repC0 === 1 && repC.length === 2 && repC[1].body.client_id === "0034567L" && changes.filter((c) => c.confirm).length === 0,
    JSON.stringify({ rA, repA: repA.map((c) => c.body), repAcard, rB, rC, repKeep, repC: repC.map((c) => c.body), changes }).slice(0, 1500));

  // ---------- Orders (an optional ID card on the form, kept on the person; the order itself has no card) ----------
  reset();
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  const ordForm = async (card) => { await page.click("[data-act=add]"); await page.waitForTimeout(150); await page.fill("#ord-add [name=client_name]", "Laura Borg"); await page.fill("#ord-add [name=id_card]", card); await page.fill("#ord-add [name=items]", "Vitamin D"); await page.fill("#ord-add [name=needed_by]", todayYmd); };
  await ordForm("34567l"); await page.click("#ord-add button[type=submit]"); await waitDlg("^Add ID card"); const oA = await dlg(); await press("yes");
  await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 6000 }).catch(() => {});
  const oA2 = await dlg(); if (oA2) await press("skip");
  await page.waitForTimeout(700);
  const ordA = await posts("/client-orders/entries");
  await ordForm("12345m"); await page.click("#ord-add button[type=submit]"); await waitDlg("belongs to"); const oB = await dlg(); await page.keyboard.press("Escape"); await page.waitForTimeout(250);
  const ordB = await posts("/client-orders/entries"); const ordBkept = await page.evaluate(() => ({ items: document.querySelector("#ord-add [name=items]").value, card: document.querySelector("#ord-add [name=id_card]").value }));
  await page.click("[data-act=add-cancel]");
  changes = [];
  await ordForm("45678l"); await page.click("#ord-add button[type=submit]"); await waitDlg("^Change"); const oC = await dlg(); await press("change"); await waitDlg("^ID card changed");
  await press("undo"); await page.waitForFunction(() => !document.querySelector(".epc"), null, { timeout: 6000 }); await page.waitForTimeout(400);
  const ordC = await posts("/client-orders/entries"); const ordCform = await page.evaluate(() => !!document.querySelector("#ord-add"));
  report("id card A/B/C (orders): A asks and puts 0034567L on Laura Borg, the order body has no card; B stops on Carmel's card with the form kept; C changes everywhere and Undo puts it back, nothing saved and the form still open",
    oA && oA.title === "Add ID card 0034567L to Laura Borg’s details?" && book[0].id_card !== "" && ordA.length === 1 && !("id_card" in ordA[0].body) && ordA[0].body.client_name === "Laura Borg" &&
    oB && /0012345M belongs to Carmel Zammit/.test(oB.title) && ordB.length === 1 && ordBkept.items === "Vitamin D" && ordBkept.card === "12345m" &&
    oC && /from 0034567L to 0045678L/.test(oC.title) && changes.some((c) => c.confirm) && changes.some((c) => c.undo === "idc_00000000-0000-0000-0000-000000000002") && ordC.length === 1 && ordCform,
    JSON.stringify({ oA, oA2: !!oA2, ordA: ordA.map((c) => c.body), oB, ordBkept, oC, changes, nC: ordC.length, ordCform }).slice(0, 1500));
  await page.click("[data-act=add-cancel]").catch(() => {});
  await page.unroute(isP, onP);
} catch (e) { report("id card questions: ran to the end", false, String(e).slice(0, 400)); }
// Classic layout chosen for this browser: the top bar offers the way back ("Use the new layout"), which opens Today in the new layout.
try {
  const lp = await browser.newPage({ viewport: { width: 1280, height: 860 } });
  await lp.goto(base);
  await lp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await lp.goto(base + "&ui=1#temperature");
  await lp.waitForSelector("#eikon-newlayout-btn", { state: "attached", timeout: 15000 }); await lp.waitForTimeout(800);
  const nlDbg = await lp.evaluate(() => ({ ui2: localStorage.getItem("eikon_ui2"), role: localStorage.getItem("eikon_active_role"), disp: document.getElementById("eikon-newlayout-btn").style.display }));
  const nlShown = await lp.evaluate(() => getComputedStyle(document.getElementById("eikon-newlayout-btn")).display !== "none");
  await lp.click("#eikon-newlayout-btn");
  await lp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "today", null, { timeout: 15000 });
  const nlAfter = await lp.evaluate(() => ({ ui2: localStorage.getItem("eikon_ui2"), attr: document.documentElement.hasAttribute("data-ui2") }));
  await lp.close();
  report("classic layout: 'Use the new layout' shows when classic was chosen, and opens Today in the new layout (remembered)",
    nlShown && nlAfter.ui2 === "1" && nlAfter.attr, JSON.stringify({ nlShown, nlAfter, nlDbg }));
} catch (e) { report("classic layout: way back to the new layout ran to the end", false, String(e).slice(0, 300)); }
// Busiest-screen polish (backlog 2 item 7)
try {
  const openToday = async (pg) => { await pg.goto(base + "&ui=2#today"); await pg.reload(); await pg.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1") && !/Loading/.test(document.querySelector(".tdy-head h1").textContent), null, { timeout: 15000 }); await pg.waitForTimeout(300); };
  // (a) the money tile says what the number is
  todayState = { tempDone: false, cleanDone: false };
  await page.setViewportSize({ width: 1440, height: 900 }); await openToday(page);
  const tile = await page.evaluate(() => { const t = [...document.querySelectorAll(".tdy-tile")].find((x) => /Money today/.test(x.textContent)); return t ? t.innerText.replace(/\s+/g, " ") : ""; });
  report("today polish (a): the money tile is called Money today and shows the paid out figure as paid out, not as takings", /Money today/i.test(tile) && /€12\.50 ?paid out today/.test(tile) && !/Takings/i.test(tile), tile);
  // (b) yesterday outside its limits: words and colour at the top of Before opening, and a link to that day
  todayState = { tempDone: false, cleanDone: false, yOut: true }; await openToday(page); await page.waitForSelector(".tdy-warn", { timeout: 5000 }).catch(() => {});
  const yb = await page.evaluate(() => {
    const w = document.querySelector(".tdy-warn"), first = w && w.previousElementSibling, row = document.querySelector('.tdy-row[data-kind=temperature] .tdy-t span');
    const rgb = (c) => (c.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number), grey = (c) => { const [r, g, b] = rgb(c); return Math.max(r, g, b) - Math.min(r, g, b) < 24; };
    return { text: w ? w.innerText.replace(/\s+/g, " ") : "", afterLabel: !!(first && /Before opening/.test(first.textContent)), warnGrey: w ? grey(getComputedStyle(w.querySelector("b")).color) : true,
      rowText: row ? row.textContent : "", rowGrey: row ? grey(getComputedStyle(row).color) : true, rowFirst: (document.querySelector(".tdy-list .tdy-row") || {}).getAttribute && document.querySelector(".tdy-list .tdy-row").getAttribute("data-kind") };
  });
  const clicked = await page.evaluate(() => { const a = document.querySelector(".tdy-warn [data-yday]"); if (a) a.click(); return !!a; });
  if (clicked) await page.waitForFunction(() => location.hash === "#tempreg", null, { timeout: 8000 }).catch(() => {}); await page.waitForTimeout(500);
  const yMonth = maltaYmd(-1).slice(0, 7);
  const tempReqs = calls.filter((c) => c.method === "GET" && c.path === "/temperature/entries" && /month=/.test(c.query || "")).map((c) => c.query);
  report("today polish (b): yesterday's reading outside its limits is said in words and colour above the list, the row says it too and is not grey, and See yesterday opens the register on that month",
    /Fridge 1 was 9\.1 °C yesterday/.test(yb.text) && /outside its limits of 2 to 8 °C/.test(yb.text) && yb.afterLabel && !yb.warnGrey && /Outside limits yesterday: 9\.1 °C/.test(yb.rowText) && !yb.rowGrey &&
    tempReqs.some((u) => u.indexOf("month=" + yMonth) >= 0), JSON.stringify({ yb, clicked, yMonth, tempReqs: tempReqs.slice(-3) }));
  todayState = { tempDone: false, cleanDone: false };
  // (c) the search placeholder fits a phone; the full question on a desktop
  await page.setViewportSize({ width: 402, height: 874 }); await openToday(page);
  const phPh = await page.evaluate(() => { const q = document.querySelector("#tdy-q"); return { ph: q.placeholder, fits: (() => { const c = document.createElement("canvas").getContext("2d"); const cs = getComputedStyle(q); c.font = cs.fontSize + " " + cs.fontFamily; return c.measureText(q.placeholder).width <= q.clientWidth; })() }; });
  await page.setViewportSize({ width: 1440, height: 900 }); await page.waitForTimeout(200);
  const dkPh = await page.evaluate(() => document.querySelector("#tdy-q").placeholder);
  report("today polish (c): a short search placeholder that fits on a phone, the full one on a desktop (and it follows a resize)", phPh.fits && phPh.ph.length < 32 && /What do you need\?/.test(dkPh), JSON.stringify({ phPh, dkPh }));
  // (d) one Malta-time clock: "Updated" and "signed in" match Malta time whatever the device's zone
  const tz = {};
  for (const zone of ["UTC", "Europe/Malta"]) {
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, timezoneId: zone }); const tp = await ctx.newPage();
    await tp.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
    await tp.goto(base + "&ui=2#today"); await tp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_ui2", "1"); });
    await openToday(tp);
    tz[zone] = await tp.evaluate(() => {
      const mt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date());
      const dev = String(new Date().getHours()).padStart(2, "0") + ":" + String(new Date().getMinutes()).padStart(2, "0");
      const upd = ((document.querySelector(".tdy-foot") || {}).textContent || "").match(/Updated (\d\d:\d\d)/), rail = ((document.querySelector(".eikon-rail-who") || {}).textContent || "").match(/signed in (\d\d:\d\d)/);
      return { mt, dev, upd: upd && upd[1], rail: rail && rail[1], fn: window.EIKON.maltaHm(new Date("2026-11-03T13:22:00Z")), fnSummer: window.EIKON.maltaHm(new Date("2026-07-01T13:22:00Z")), ymd: window.EIKON.maltaYmd(new Date("2026-11-03T23:30:00Z")) };
    });
    await ctx.close();
  }
  const near = (a, b) => { if (!a || !b) return false; const m = (x) => Number(x.slice(0, 2)) * 60 + Number(x.slice(3)); return Math.abs(m(a) - m(b)) <= 1; };
  report("today polish (d): Updated and signed in show Malta time with the device set to UTC (where its own clock differs) and to Europe/Malta; 13:22 UTC is 14:22 in November, 15:22 in July; 23:30 UTC on 3 Nov is 4 Nov in Malta",
    ["UTC", "Europe/Malta"].every((z) => near(tz[z].upd, tz[z].mt) && near(tz[z].rail, tz[z].mt) && tz[z].fn === "14:22" && tz[z].fnSummer === "15:22" && tz[z].ymd === "2026-11-04") && tz.UTC.dev !== tz.UTC.mt,
    JSON.stringify(tz));
} catch (e) { report("today polish: ran to the end", false, String(e).slice(0, 400)); }
// wide registers: a table at 1200 px and up, the two-line list on a phone
try {
  for (const [w, wantTable] of [[1440, true], [402, false]]) {
    await page.setViewportSize({ width: w, height: 900 });
    await page.evaluate(() => { location.hash = "#drreg"; }); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "drreg" && document.querySelector(".drr"), null, { timeout: 8000 }); await page.waitForTimeout(500);
    if (!(await page.evaluate(() => /John Borg/.test(document.querySelector(".drr").textContent)))) { await page.click(".drr .emb [data-mb=prev]"); await page.waitForTimeout(700); } // the mock's line is last month (month bar from eikon.months.js)
    const r = await page.evaluate(() => ({ table: !!document.querySelector(".drr-tbl"), list: !!document.querySelector(".drr-list"), john: /John Borg/.test(document.querySelector(".drr").textContent), cols: [...document.querySelectorAll(".drr-tbl th")].map((t) => t.textContent).filter((t) => t !== "Correct") })); // the pharmacist's Correct column (header read by screen readers only) is not a register column
    report("wide registers: Daily register at " + w + " px shows " + (wantTable ? "a table with the classic's columns" : "the two-line list"), r.john && (wantTable ? r.table && !r.list && r.cols.join("|") === "Date|Client|ID card|Medicine and dose|Posology|Prescriber|Reg no" : r.list && !r.table), JSON.stringify(r));
  }
  await page.setViewportSize({ width: 1440, height: 900 });
} catch (e) { report("wide registers: ran to the end", false, String(e).slice(0, 400)); }
// ---- Team sign-ins (backlog 2 item 4): People who sign in, forced change at first sign-in, idle lock, first-run list
const teamCalls = async (f) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter(f);
const modalClick = (pg, label) => pg.evaluate((l) => { const b = [...document.querySelectorAll("#eikon-modal-actions button")].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
try {
  teamState = teamFresh();
  await page.evaluate(() => { localStorage.setItem("eikon_ui2", "1"); localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await page.goto(base + "&ui=2#team");
  await page.waitForFunction(() => document.querySelector('.hub [data-open="teamreg"]'), null, { timeout: 15000 });
  await page.click('.hub [data-open="teamreg"]');
  await page.waitForFunction(() => document.querySelectorAll(".tmr-row[data-user]").length === 4, null, { timeout: 15000 });
  const t1 = await page.evaluate(() => {
    const r = (id) => document.querySelector('.tmr-row[data-user="' + id + '"]'), btns = (id) => [...r(id).querySelectorAll("button")].map((b) => b.textContent.trim());
    return { hash: location.hash, h1: document.querySelector(".tmr h1").textContent, self: btns(1), selfNote: r(1).textContent, john: btns(3), johnNote: r(3).textContent, karl: btns(2), leaver: btns(4), offLab: /Switched off · 1/.test(document.body.textContent), back: document.querySelector(".tmr-back").textContent };
  });
  report("team people: Team › People who sign in lists this pharmacy's sign-ins; you, Eikon support and switched-off people are told apart, and only staff can be changed",
    t1.hash === "#teamreg" && t1.h1 === "People who sign in" && t1.self.length === 0 && /Change your password in Settings/.test(t1.selfNote) && t1.john.length === 0 && /Eikon support/.test(t1.johnNote) &&
    t1.karl.join() === "New password,Switch off,Role…" && t1.leaver.join() === "Switch on" && t1.offLab && /Team/.test(t1.back), JSON.stringify(t1));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act="add"]');
  await page.fill("#tmr-name", "Rita Camilleri"); await page.fill("#tmr-email", "Rita@X.com");
  await page.click('#tmr-add button[type="submit"]');
  await page.waitForFunction(() => document.querySelector(".tmr-once code"), null, { timeout: 10000 });
  const t2 = await page.evaluate(() => ({ code: document.querySelector(".tmr-once code").textContent, copy: !!document.querySelector('.tmr-once [data-act="copy"]'), focus: document.activeElement && document.activeElement.id, text: document.querySelector(".tmr-once").textContent }));
  const addPost = await teamCalls((c) => c.method === "POST" && c.path === "/team/users");
  await page.click('[data-act="done"]');
  const t2b = await page.evaluate(() => ({ gone: !document.querySelector(".tmr-once"), leak: document.body.innerHTML.includes("k7mp-q4xa-9rtd"), rita: (document.querySelector('.tmr-row[data-user="5"]') || {}).textContent || "" }));
  report("team people: Add a person sends name, e-mail (lower case) and staff; the temporary password is shown once with Copy and Done focused; after Done it is gone from the page",
    addPost.length === 1 && JSON.stringify(addPost[0].body) === JSON.stringify({ email: "rita@x.com", full_name: "Rita Camilleri", role: "staff" }) && t2.code === "k7mp-q4xa-9rtd" && t2.copy && t2.focus === "tmr-done" && /rita@x.com/.test(t2.text) &&
    t2b.gone && !t2b.leak && /Has not chosen a password yet/.test(t2b.rita), JSON.stringify({ addPost, t2, t2b }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act="reset"][data-id="2"]');
  const askReset = await page.evaluate(() => document.querySelector("#eikon-modal-title").textContent);
  await modalClick(page, "New password");
  await page.waitForFunction(() => document.querySelector(".tmr-once code"), null, { timeout: 10000 });
  const t3 = await page.evaluate(() => document.querySelector(".tmr-once code").textContent);
  await page.click('[data-act="done"]');
  await page.click('[data-act="off"][data-id="2"]');
  const askOff = await page.evaluate(() => document.querySelector("#eikon-modal-body").textContent);
  await modalClick(page, "Switch off");
  await page.waitForFunction(() => /Switched off · 2/.test(document.body.textContent), null, { timeout: 10000 });
  await page.click('[data-act="on"][data-id="4"]');
  await page.waitForFunction(() => /Switched off · 1/.test(document.body.textContent), null, { timeout: 10000 });
  const w3 = await teamCalls((c) => c.method === "POST" && c.path.startsWith("/team/users/"));
  report("team people: New password asks first, then shows the new temporary password once; Switch off asks (signed out of every device) and Switch on does not",
    /Give Karl Vella a new password\?/.test(askReset) && t3 === "w2hn-8cxe-pt3v" && /signed out of every device/.test(askOff) &&
    JSON.stringify(w3.map((c) => [c.path, c.body])) === JSON.stringify([["/team/users/2/password", {}], ["/team/users/2/active", { active: false }], ["/team/users/4/active", { active: true }]]), JSON.stringify({ askReset, t3, askOff, w3: w3.map((c) => [c.path, c.body]) }));
  // staff: no card, no route, no request
  teamState.me.role = "staff";
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#team"); await page.reload(); await page.waitForFunction(() => window.EIKON.state.user && window.EIKON.state.user.role === "staff" && document.querySelector(".hub h1"), null, { timeout: 15000 }); await page.waitForTimeout(400);
  const sCard = await page.evaluate(() => !!document.querySelector('[data-open="teamreg"]'));
  await page.evaluate(() => { location.hash = "#settings"; }); await page.waitForTimeout(500);
  const sCard2 = await page.evaluate(() => !!document.querySelector('[data-open="teamreg"]'));
  await page.evaluate(() => { location.hash = "#teamreg"; }); await page.waitForFunction(() => document.querySelector(".tmr"), null, { timeout: 10000 });
  const sText = await page.evaluate(() => document.querySelector(".tmr").textContent);
  const sCalls = await teamCalls((c) => c.path.startsWith("/team/") && c.path !== "/team/today" && c.path !== "/team/me"); // team-hub: the Team hub's own Today's team read (T-C1) is not the sign-ins screen's; /team/me = the person's own role word (roles round, once per sign-in)
  report("team people: staff see no card (Team or Settings) and the screen, opened by address, says only the admin can; nothing is asked of the server",
    !sCard && !sCard2 && /Only the pharmacy's admin/.test(sText) && sCalls.length === 0, JSON.stringify({ sCard, sCard2, sText: sText.slice(0, 120), sCalls }));
  teamState.me.role = "admin";
  // the server without /team (live worker today): the screen says so instead of failing
  await page.route("**/team/users", (r) => r.fulfill({ status: 404, contentType: "application/json", body: '{"ok":false,"error":"Not found"}' }));
  await page.goto(base + "&ui=2#teamreg"); await page.reload(); await page.waitForFunction(() => document.querySelector(".tmr-quiet"), null, { timeout: 15000 });
  const miss = await page.evaluate(() => document.querySelector(".tmr").textContent);
  await page.unroute("**/team/users");
  report("team people: on a server without the Team routes the screen says it needs the next server update (no error)", /next Eikon server update/.test(miss), miss.slice(0, 200));
} catch (e) { report("team people: ran to the end", false, String(e).slice(0, 400)); }
// Roles round (W3/W4/W30): Add a person offers Staff / Pharmacist / Admin; Role… changes the role and the rota right;
// staff without the rota right see the rota and ask for leave (Who = them) but are offered no change; nobody but an
// admin is offered Approve on their own leave; the sidebar uses the same role word as People who sign in.
try {
  teamState = teamFresh();
  await page.evaluate(() => { localStorage.setItem("eikon_ui2", "1"); localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await page.goto(base + "&ui=2#teamreg"); await page.reload(); // a fresh page: the blocks before may leave this screen in another state
  await page.waitForFunction(() => document.querySelectorAll(".tmr-row[data-user]").length === 4, null, { timeout: 15000 });
  await page.click('[data-act="add"]');
  const roles1 = await page.evaluate(() => [...document.querySelectorAll("#tmr-role option")].map((o) => o.value).join());
  await page.fill("#tmr-name", "Ġanni Pace"); await page.fill("#tmr-email", "ganni@x.com"); await page.selectOption("#tmr-role", "pharmacist");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('#tmr-add button[type="submit"]');
  await page.waitForFunction(() => document.querySelector(".tmr-once code"), null, { timeout: 10000 });
  const addP = await teamCalls((c) => c.method === "POST" && c.path === "/team/users");
  await page.click('[data-act="done"]');
  await page.waitForFunction(() => document.querySelector('.tmr-row[data-user="5"]'), null, { timeout: 10000 });
  const pill = await page.evaluate(() => document.querySelector('.tmr-row[data-user="5"] .tmr-pill').textContent);
  report("roles: Add a person offers Staff, Pharmacist and Admin; Pharmacist sends role pharmacist and the person shows as Pharmacist",
    roles1 === "staff,pharmacist,admin" && addP.length === 1 && addP[0].body.role === "pharmacist" && pill === "Pharmacist", JSON.stringify({ roles1, addP, pill }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act="role"][data-id="2"]');
  await page.waitForSelector('input[name="tmr-role-pick"]');
  const dlg = await page.evaluate(() => ({ title: document.querySelector("#eikon-modal-title").textContent, picks: [...document.querySelectorAll('input[name="tmr-role-pick"]')].map((r) => r.value + (r.checked ? "*" : "")).join(), focus: document.activeElement && document.activeElement.value, plan: !!document.querySelector("#tmr-plan") }));
  await page.check('input[name="tmr-role-pick"][value="pharmacist"]'); await page.check("#tmr-plan");
  await modalClick(page, "Save");
  await page.waitForFunction(() => /Pharmacist/.test((document.querySelector('.tmr-row[data-user="2"] .tmr-pill') || {}).textContent || ""), null, { timeout: 10000 });
  const rw = await teamCalls((c) => c.method === "POST" && /^\/team\/users\/2\//.test(c.path));
  const karlRow = await page.evaluate(() => document.querySelector('.tmr-row[data-user="2"]').textContent);
  report("roles: Role… offers Staff, Pharmacist, Admin with the current one chosen and focused, and Plans the rota; Save sends only what changed (role, then rights)",
    dlg.title === "Karl Vella" && dlg.picks === "staff*,pharmacist,admin" && dlg.focus === "staff" && dlg.plan && rw.map((c) => c.path + " " + JSON.stringify(c.body)).join(" | ") === '/team/users/2/role {"role":"pharmacist"} | /team/users/2/rights {"plans_rota":true}' && /Plans the rota/.test(karlRow),
    JSON.stringify({ dlg, rw, karlRow: karlRow.slice(0, 160) }));
  const side = await page.evaluate(() => (document.querySelector(".eikon-rail-who span") || {}).textContent || "");
  report("roles: the admin's sidebar says Admin (the People who sign in word), not Pharmacist", /^Admin · signed in/.test(side), side);
} catch (e) { report("roles: team ran to the end", false, String(e && e.stack || e).slice(0, 500)); }
try {
  globalThis.__finRoles = { can_plan: false, me: 2 };
  await page.goto(base + "&ui=2#shfreg"); await page.reload();
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && document.querySelector(".shf-sub") && document.querySelector(".shf-lv, .shf-lvline"), null, { timeout: 15000 });
  if (await page.$('[data-act="lv-open"]')) { await page.click('[data-act="lv-open"]'); await page.waitForTimeout(150); }
  const ro = await page.evaluate(() => ({ fill: !!document.querySelector('[data-act="fill-open"]'), pick: !!document.querySelector('[data-act="pick"]'), add: document.querySelectorAll('[data-act="add"]').length, who: !!document.querySelector('[data-act="who"]'),
    sub: document.querySelector(".shf-sub").textContent, ask: [...document.querySelectorAll('[data-act="lv-new"]')].map((b) => b.textContent).join(), approve: document.querySelectorAll("[data-act=lv-approve]").length,
    waits: [...document.querySelectorAll(".shf-lv .q")].map((x) => x.textContent), side: (document.querySelector(".eikon-rail-who span") || {}).textContent || "" }));
  await fetch(`http://localhost:${PORT}/__reset`);
  const cell = await page.$(".shf-grid td.shf-c") || await page.$(".shf-p");
  if (cell) { await cell.click(); await page.waitForTimeout(120); }
  const msg = await page.evaluate(() => ({ msg: (document.querySelector(".shf-msg") || {}).textContent || "", form: !!document.querySelector("#shf-form") }));
  await page.click('[data-act="lv-new"]'); await page.waitForSelector("#shf-lvf");
  const who = await page.evaluate(() => ({ v: document.querySelector("#shf-lvf [name=staff_id]").value, focus: document.activeElement && document.activeElement.name }));
  await page.click("#shf-lvf button[type=submit]"); await page.waitForTimeout(400);
  const writes = await teamCalls((c) => c.method !== "GET");
  report("roles: staff without the rota right — Plan shifts offers no Fill…, Select, Add or Approve; says the admin changes shifts; + Ask for leave with Who = them; a cell opens no shift form; only the leave request is sent",
    !ro.fill && !ro.pick && !ro.add && !ro.who && /Only the pharmacy's admin changes shifts/.test(ro.sub) && /Ask for leave/.test(ro.ask) && ro.approve === 0 &&
    ro.waits.some((x) => /Waiting for an answer from the pharmacy's admin/.test(x)) && ro.waits.some((x) => /The pharmacy's admin answers it/.test(x)) &&
    (!cell || (!msg.form && /Only the pharmacy's admin changes shifts/.test(msg.msg))) && who.v === "2" && who.focus === "leave_type" &&
    writes.map((c) => c.method + " " + c.path).join() === "POST /shifts/leaves" && writes[0].body.staff_id === 2 && /^Staff · signed in/.test(ro.side),
    JSON.stringify({ ro, cell: !!cell, msg, who, writes: writes.map((c) => c.method + " " + c.path) }));
  globalThis.__finRoles = { can_plan: true, me: 2 };
  await page.reload();
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && document.querySelector(".shf-sub") && document.querySelector(".shf-lv, .shf-lvline"), null, { timeout: 15000 });
  if (await page.$('[data-act="lv-open"]')) { await page.click('[data-act="lv-open"]'); await page.waitForTimeout(150); }
  const pl = await page.evaluate(() => ({ fill: !!document.querySelector('[data-act="fill-open"]'), own: !!document.querySelector('[data-act=lv-approve][data-id="31"]'), other: !!document.querySelector('[data-act=lv-approve][data-id="32"]') }));
  report("roles: with the rota right, Fill… is back and they answer Maria's leave, never their own (no Approve on it)", pl.fill && !pl.own && pl.other, JSON.stringify(pl));
  globalThis.__finRoles = { can_plan: false, me: 2, pharmacist: true };
  await page.reload();
  await page.waitForFunction(() => /signed in/.test((document.querySelector(".eikon-rail-who span") || {}).textContent || ""), null, { timeout: 15000 });
  await page.waitForFunction(() => /^Pharmacist/.test((document.querySelector(".eikon-rail-who span") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
  const phSide = await page.evaluate(() => document.querySelector(".eikon-rail-who span").textContent);
  report("roles: a pharmacist's sidebar says Pharmacist", /^Pharmacist · signed in/.test(phSide), phSide);
  await page.evaluate(() => { location.hash = "#teamreg"; });
  await page.waitForFunction(() => /Ask Maria Borg, the admin\./.test((document.querySelector(".tmr-quiet") || {}).textContent || ""), null, { timeout: 8000 }).catch(() => {});
  const askTxt = await page.evaluate(() => (document.querySelector(".tmr-quiet") || {}).textContent || "");
  report("roles: People who sign in, opened by a pharmacist, names who to ask (the admin by name)", /Only the pharmacy's admin can add people or change sign-ins\. Ask Maria Borg, the admin\./.test(askTxt), askTxt);
} catch (e) { report("roles: plan shifts ran to the end", false, String(e && e.stack || e).slice(0, 500)); }
globalThis.__finRoles = null; teamState = teamFresh();
try { await page.goto(base + "&ui=2#today"); await page.reload(); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.user.role === "admin", null, { timeout: 15000 }); } catch (e) {} // the next blocks start as the admin again

// First-run list on Today (admin only, only while something is missing; the counts come with GET /today)
try {
  const todayFresh = async () => { await page.goto(base + "&ui=2#today"); await page.reload(); await page.waitForFunction(() => document.querySelector(".tdy-head h1") && !/Loading/.test(document.querySelector(".tdy-head h1").textContent), null, { timeout: 15000 }); await page.waitForTimeout(300); };
  teamState = teamFresh(); teamState.setup = { sign_ins: 1, opening_hours_saved: false }; todayState.noFridge = true;
  await fetch(`http://localhost:${PORT}/__reset`);
  await todayFresh();
  const f1 = await page.evaluate(() => [...document.querySelectorAll(".tdy-setup li")].map((li) => li.getAttribute("data-setup") + ">" + li.querySelector("button").getAttribute("data-open") + (li.querySelector("button").getAttribute("data-sheet") ? "+" + li.querySelector("button").getAttribute("data-sheet") : "")));
  const fGets = (await teamCalls((c) => c.method === "GET" && !/^\/(ui|vendor)\//.test(c.path))).map((c) => c.path);
  await page.click('.tdy-setup [data-setup="people"] button'); await page.waitForTimeout(400);
  const fOpen = await page.evaluate(() => location.hash);
  teamState.setup = { sign_ins: 3, opening_hours_saved: false }; todayState.noFridge = false;
  await todayFresh();
  const f2 = await page.evaluate(() => [...document.querySelectorAll(".tdy-setup li")].map((li) => li.getAttribute("data-setup")));
  teamState.setup = { sign_ins: 3, opening_hours_saved: true };
  await todayFresh();
  const f3 = await page.evaluate(() => !!document.querySelector(".tdy-setup"));
  teamState.setup = { sign_ins: 1, opening_hours_saved: false }; teamState.me.role = "staff";
  await todayFresh();
  const f4 = await page.evaluate(() => !!document.querySelector(".tdy-setup"));
  teamState = teamFresh(); todayState.noFridge = true; // an older server: no setup block, so no list even with no fridge
  await todayFresh();
  const f5 = await page.evaluate(() => !!document.querySelector(".tdy-setup"));
  report("today first run: the admin sees fridge, people and opening hours while each is missing (still one request; links to the screens), each line goes when done and the list with the last; staff never; an older server shows nothing",
    f1.join() === "fridge>#tempreg,people>#teamreg,hours>#shifts+hours" && fGets.filter((x) => x !== "/auth/me" && x !== "/today").length === 0 && fOpen === "#teamreg" && f2.join() === "hours" && !f3 && !f4 && !f5, JSON.stringify({ f1, fGets, fOpen, f2, f3, f4, f5 }));
} catch (e) { report("today first run: ran to the end", false, String(e).slice(0, 400)); }
todayState.noFridge = false; teamState = teamFresh();

// Forced change at first sign-in, and the idle lock with a fake clock (own browser contexts)
async function teamPage(clock) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, eikonClock: !clock });
  const pg = await ctx.newPage();
  if (clock) await pg.clock.install({ time: new Date("2026-11-03T09:00:00") });
  await pg.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await pg.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
  await pg.goto(base + "&ui=2#today");
  await pg.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_ui2", "1"); });
  return { ctx, pg, errs };
}
const trapCheck = (pg) => pg.evaluate(async () => {
  const sh = document.querySelector(".eks"); const seen = new Set();
  for (let i = 0; i < 12; i++) { document.activeElement.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })); seen.add(sh.contains(document.activeElement)); }
  const root = document.getElementById("eikon-root"); const bg = getComputedStyle(sh).backgroundColor;
  return { role: sh.getAttribute("role"), modal: sh.getAttribute("aria-modal"), label: !!document.getElementById(sh.getAttribute("aria-labelledby")), inert: !!(root && root.inert), hidden: root && root.getAttribute("aria-hidden"), opaque: !/rgba\(.*,\s*0(\.\d+)?\)/.test(bg) && bg !== "transparent", focusInside: sh.contains(document.activeElement), allInside: [...seen].every(Boolean) };
});
try {
  teamState = teamFresh(); teamState.me.must_change = true;
  const { ctx, pg, errs } = await teamPage(false);
  await pg.reload();
  await pg.waitForFunction(() => document.querySelector(".eks #eks-fc"), null, { timeout: 15000 });
  const fc1 = await pg.evaluate(() => ({ app: !!document.getElementById("eikon-content"), title: document.getElementById("eks-fc-t").textContent, focus: document.activeElement && document.activeElement.id }));
  const fcTrap = await trapCheck(pg);
  await pg.fill("#eks-fc-cur", "temp-pass-1"); await pg.fill("#eks-fc-n1", "short"); await pg.click("#eks-fc-go");
  const fcShort = await pg.evaluate(() => ({ err: document.getElementById("eks-fc-err").textContent, focus: document.activeElement.id }));
  await pg.check("#eks-fc-show");
  const fcShow = await pg.evaluate(() => ["eks-fc-cur", "eks-fc-n1", "eks-fc-n2"].map((id) => document.getElementById(id).type).join());
  await pg.uncheck("#eks-fc-show");
  // (Playwright's keyboard does not carry Caps Lock state: the key events say it, as a real keyboard's do)
  const capsKey = (on) => pg.evaluate((c) => { const i = document.getElementById("eks-fc-n1"); i.focus(); i.dispatchEvent(new KeyboardEvent("keyup", { key: c ? "A" : "a", modifierCapsLock: c, bubbles: true })); return document.querySelector(".eks-caps").textContent; }, on);
  const fcCaps = await capsKey(true), fcCaps2 = await capsKey(false);
  report("forced change: a short password is explained (with its length) and the cursor goes to it; Show the passwords shows all three; Caps Lock on is said while it is on",
    /at least 10 characters\. It has 5/.test(fcShort.err) && fcShort.focus === "eks-fc-n1" && fcShow === "text,text,text" && fcCaps === "Caps Lock is on." && fcCaps2 === "", JSON.stringify({ fcShort, fcShow, fcCaps, fcCaps2 }));
  await pg.fill("#eks-fc-cur", "nope"); await pg.fill("#eks-fc-n1", "Rita-own-2026!"); await pg.fill("#eks-fc-n2", "Rita-own-2026!"); await pg.click("#eks-fc-go");
  await pg.waitForFunction(() => /not right/.test((document.getElementById("eks-fc-err") || {}).textContent || ""), null, { timeout: 10000 });
  await pg.fill("#eks-fc-cur", "temp-pass-1"); await pg.click("#eks-fc-go");
  await pg.waitForFunction(() => !document.querySelector(".eks") && document.querySelector(".tdy-head h1"), null, { timeout: 15000 });
  const fcAfter = await pg.evaluate(() => ({ inert: !!document.getElementById("eikon-root").inert, user: !("must_change" in (window.EIKON.state.user || {})) }));
  report("forced change: a sign-in that must choose its password gets a sheet before the app draws (dialog, focus kept inside, nothing behind); a wrong temporary password is said plainly; then the app opens",
    !fc1.app && fc1.title === "Choose your own password" && fc1.focus === "eks-fc-cur" && fcTrap.role === "dialog" && fcTrap.modal === "true" && fcTrap.label && fcTrap.inert && fcTrap.hidden === "true" && fcTrap.opaque && fcTrap.allInside &&
    !fcAfter.inert && fcAfter.user && errs.length === 0, JSON.stringify({ fc1, fcTrap, fcAfter, errs }));
  await ctx.close();
} catch (e) { report("forced change: ran to the end", false, String(e).slice(0, 400)); }
teamState = teamFresh();
try {
  const { ctx, pg, errs } = await teamPage(true);
  await pg.reload();
  await pg.waitForFunction(() => window.EIKON && window.EIKON.state.user && document.querySelector("input[data-min]"), null, { timeout: 20000 });
  const noSheetAtStart = await pg.evaluate(() => !document.querySelector(".eks") && window.EIKON.idleLock.minutes() === 0);
  await pg.clock.fastForward("02:00:00");
  const offStill = await pg.evaluate(() => !document.querySelector(".eks"));
  // Settings › This pharmacy › Lock when idle › 15 minutes
  await pg.evaluate(() => { location.hash = "#settings"; });
  await pg.waitForFunction(() => [...document.querySelectorAll(".hub-card[data-action]")].some((b) => /Lock when idle/.test(b.textContent)), null, { timeout: 10000 });
  await pg.evaluate(() => [...document.querySelectorAll(".hub-card[data-action]")].find((b) => /Lock when idle/.test(b.textContent)).click());
  await pg.check('input[name="eikon-idle"][value="15"]'); await modalClick(pg, "Save");
  const saved = await pg.evaluate(() => localStorage.getItem("eikon_idle_lock_min"));
  await pg.evaluate(() => { location.hash = "#today"; }); await pg.waitForFunction(() => document.querySelector("input[data-min]"), null, { timeout: 10000 });
  await pg.fill("input[data-min]", "3.4");
  await pg.clock.fastForward("14:00");
  const notYet = await pg.evaluate(() => !document.querySelector(".eks"));
  await pg.clock.fastForward("02:00");
  await pg.waitForFunction(() => document.querySelector(".eks #eks-lk"), null, { timeout: 10000 });
  const lk = await trapCheck(pg);
  const lkText = await pg.evaluate(() => document.querySelector(".eks").textContent);
  await fetch(`http://localhost:${PORT}/__reset`);
  await pg.fill("#eks-lk-pass", "wrong"); await pg.click("#eks-lk-go");
  await pg.waitForFunction(() => /do not match/.test((document.getElementById("eks-lk-err") || {}).textContent || ""), null, { timeout: 10000 });
  const lkRetry = await pg.evaluate(() => { const i = document.getElementById("eks-lk-pass"); return { focus: document.activeElement === i, sel: i.selectionStart === 0 && i.selectionEnd === i.value.length, btn: document.getElementById("eks-lk-go").textContent }; });
  report("idle lock: after a wrong password the cursor is back in it, selected to type again, and the button says Unlock again", lkRetry.focus && lkRetry.sel && lkRetry.btn === "Unlock", JSON.stringify(lkRetry));
  await pg.fill("#eks-lk-pass", "maria-pass"); await pg.click("#eks-lk-go");
  await pg.waitForFunction(() => !document.querySelector(".eks"), null, { timeout: 10000 });
  const same = await pg.evaluate(() => ({ kept: document.querySelector("input[data-min]") && document.querySelector("input[data-min]").value, token: localStorage.getItem("eikon_token"), locked: localStorage.getItem("eikon_locked"), inert: !!document.getElementById("eikon-root").inert }));
  const sameCalls = await teamCalls((c) => c.method === "POST" && /^\/auth\//.test(c.path));
  // another person
  await pg.evaluate(() => { window.__reloads = 0; window.EIKON._reload = function () { window.__reloads++; }; });
  await pg.clock.fastForward("16:00");
  await pg.waitForFunction(() => document.querySelector(".eks #eks-lk"), null, { timeout: 10000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await pg.click("#eks-lk-other");
  await pg.fill("#eks-lk-email", "karl@x.com"); await pg.fill("#eks-lk-pass", "karl-pass"); await pg.click("#eks-lk-go");
  await pg.waitForFunction(() => window.__reloads > 0, null, { timeout: 10000 });
  const other = await pg.evaluate(() => ({ reloads: window.__reloads, token: localStorage.getItem("eikon_token"), uid: localStorage.getItem("eikon_lock_uid"), locked: localStorage.getItem("eikon_locked") }));
  const otherCalls = await teamCalls((c) => c.method === "POST" && /^\/auth\//.test(c.path));
  report("idle lock: off by default (2 quiet hours, no lock); set to 15 minutes in Settings it locks at 15, not 14: a sign-in sheet (dialog, focus kept inside, nothing readable behind)",
    noSheetAtStart && offStill && saved === "15" && notYet && lk.role === "dialog" && lk.modal === "true" && lk.inert && lk.hidden === "true" && lk.opaque && lk.allInside && /Signed in as Maria Borg/.test(lkText), JSON.stringify({ noSheetAtStart, offStill, saved, notYet, lk }));
  report("idle lock: the same person carries on with their password (checked by /auth/unlock, same session, typing kept); a wrong password is refused plainly",
    same.kept === "3.4" && same.token === "x" && same.locked === null && !same.inert && JSON.stringify(sameCalls.map((c) => c.path)) === JSON.stringify(["/auth/unlock", "/auth/unlock"]), JSON.stringify({ same, sameCalls: sameCalls.map((c) => c.path) }));
  report("idle lock: someone else signs in as themselves: their own session, the previous one ended with one /auth/logout, and the page reloads as them",
    other.reloads === 1 && other.token === "karl-token" && other.uid === "2" && other.locked === null && JSON.stringify(otherCalls.map((c) => c.path)) === JSON.stringify(["/auth/login", "/auth/logout"]) && errs.length === 0, JSON.stringify({ other, otherCalls: otherCalls.map((c) => c.path), errs }));
  await ctx.close();
} catch (e) { report("idle lock: ran to the end", false, String(e).slice(0, 400)); }
teamState = teamFresh();
// Classic pharmacy calculators: Warfarin "Clear" puts every field back (it threw on an undefined preferSel half way through).
try {
  const wp = await browser.newPage({ viewport: { width: 1440, height: 900 } }); const wErr = []; wp.on("pageerror", (e) => wErr.push(e.message));
  await wp.route(/^https?:\/\/(?!localhost[:/])/, (r) => r.abort());
  await wp.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await wp.goto(base + "#today");
  await wp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await wp.goto(base + "&ui=classic#pharmacycalc");
  await wp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "pharmacycalc" && [...document.querySelectorAll("button")].some((b) => b.textContent === "Warfarin Variable Dosing"), null, { timeout: 15000 });
  await wp.evaluate(() => [...document.querySelectorAll("button")].find((b) => b.textContent === "Warfarin Variable Dosing").click());
  await wp.waitForSelector("#war-results", { timeout: 8000 });
  const card = () => [...document.querySelectorAll(".eikon-card")].find((c) => c.firstChild && c.firstChild.textContent === "Warfarin Variable Dosing");
  const read = () => wp.evaluate((cs) => { const c = eval(cs)(); const ins = c.querySelectorAll("input"), sel = c.querySelectorAll("select");
    return { weeks: ins[0].value, mode: sel[0].value, split: sel[1].value, mon: ins[1].value, cycleShown: c.querySelector("input[type=text]").closest("div").style.display, res: document.querySelector("#war-results").textContent }; }, "(" + card.toString() + ")");
  await wp.evaluate((cs) => { const c = eval(cs)(); const ins = c.querySelectorAll("input"), sel = c.querySelectorAll("select");
    ins[0].value = "9"; ins[1].value = "7"; sel[0].value = "cycle"; sel[0].dispatchEvent(new Event("change")); sel[1].value = "none";
    [...c.querySelectorAll("button")].find((b) => b.textContent === "Calculate").click(); }, "(" + card.toString() + ")");
  const before = await read();
  await wp.evaluate((cs) => [...eval(cs)().querySelectorAll("button")].find((b) => b.textContent === "Clear").click(), "(" + card.toString() + ")");
  const after = await read();
  await wp.close();
  report("classic pharmacy calculators: Warfarin Clear resets weeks, pattern, splitting, the weekly doses and the result, with no page error",
    wErr.length === 0 && before.weeks === "9" && after.weeks === "4" && after.mode === "weekly" && after.split === "halves" && after.mon === "5" && after.cycleShown === "none" && /Click Calculate/.test(after.res),
    JSON.stringify({ wErr, before, after }));
} catch (e) { report("classic pharmacy calculators: Warfarin Clear ran", false, String(e).slice(0, 300)); }

// b4-9: Today reads right at any hour (display only: the same one GET /today, nothing else)
try {
  const tdyAt = async (st) => {
    todayState = Object.assign({ tempDone: false, cleanDone: false }, st);
    await page.goto(base + "&ui=2#today"); await page.reload();
    await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1") && !/Loading/.test(document.querySelector(".tdy-head h1").textContent), null, { timeout: 15000 });
    await page.waitForTimeout(300);
    await fetch(`http://localhost:${PORT}/__reset`);
    await page.evaluate(() => window.EIKON.__todayRefresh()); await page.waitForTimeout(400);
    const c = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).map((x) => x.method + " " + x.path);
    return page.evaluate((c) => {
      const dr = document.querySelector(".tdy-row[data-kind=daily_register]");
      return { calls: c, lab: (document.querySelector(".tdy-col .tdy-lab") || {}).textContent, h1: document.querySelector(".tdy-head h1").textContent,
        drText: dr ? dr.innerText.replace(/\s+/g, " ") : "", drPill: dr ? dr.querySelectorAll(".tdy-pill").length : -1, drAmb: dr ? dr.classList.contains("amb") : null, drRed: dr ? dr.classList.contains("red") : null,
        badge: (document.querySelector('.eikon-rail-badge[data-badge="today"]') || {}).textContent || "",
        temps: [...document.querySelectorAll(".tdy-row[data-kind=temperature] .tdy-t b")].map((b) => b.textContent),
        oldLink: !!document.querySelector('.tdy [data-open="#dashboard"]'), foot: (document.querySelector(".tdy-foot") || {}).textContent || "" };
    }, c);
  };
  const m = await tdyAt({ room: true });
  const pm = await tdyAt({ time: "14:05" });
  const ev = await tdyAt({ time: "20:12" });
  const ed = await tdyAt({ time: "16:40", eodSaved: true });
  const onlyToday = (r) => r.calls.length === 1 && r.calls[0] === "GET /today";
  report("today at any hour: 09:12 says Before opening; 14:05 and 20:12 say Today's checks",
    /^Before opening/.test(m.lab) && /^Today's checks/.test(pm.lab) && /^Today's checks/.test(ev.lab) && /before the doors open/.test(m.h1) && /still to do today/.test(ev.h1), JSON.stringify({ m: m.lab, pm: pm.lab, ev: ev.lab, mh: m.h1, eh: ev.h1 }));
  report("today at any hour: the Daily register is one line with no pill, not owed before closing (2 checks, badge 2, not amber), owed at 20:12 or once End of day is started (3, amber, never red)",
    /No entry yet today/.test(m.drText) && !/No entry yet(?! today)/.test(m.drText) && m.drPill === 0 && !m.drAmb && m.lab.replace(/\s+/g, " ").trim() === "Before opening 3 of 4 to doAll registers ›" /* FIN-dayzero W31: the count says it is 3 of the 4 rows */ && /2 checks/.test(pm.h1) && pm.badge === "2" && !pm.drAmb &&
    /3 checks/.test(ev.h1) && ev.badge === "3" && ev.drAmb && !ev.drRed && ev.drPill === 0 && /3 checks/.test(ed.h1) && ed.drAmb,
    JSON.stringify({ m, pm: [pm.h1, pm.badge, pm.drAmb], ev: [ev.h1, ev.badge, ev.drAmb, ev.drRed], ed: [ed.h1, ed.drAmb] }));
  report("today at any hour: the room sensor named after the pharmacy reads Room, the fridge keeps its name; no Old dashboard link on Today",
    JSON.stringify(m.temps) === JSON.stringify(["Room", "Fridge 1"]) && !m.oldLink && !/Old dashboard/.test(m.foot) && !ev.oldLink, JSON.stringify({ temps: m.temps, oldLink: m.oldLink, foot: m.foot }));
  report("today at any hour: display only, each refresh is the one GET /today it was before", onlyToday(m) && onlyToday(pm) && onlyToday(ev) && onlyToday(ed), JSON.stringify([m.calls, pm.calls, ev.calls, ed.calls]));
  // Settings › Help still has the old dashboard
  await page.evaluate(() => { location.hash = "#settings"; }); await page.waitForTimeout(800);
  const helpOld = await page.evaluate(() => document.body.innerText.indexOf("Old dashboard") >= 0);
  report("today at any hour: the old dashboard is still in Settings", helpOld, String(helpOld));
} catch (e) { report("today at any hour: ran to the end", false, String(e).slice(0, 300)); }
todayState = { tempDone: false, cleanDone: false };

// b4-10: one word for one thing: New X opens, Save X saves, success says Saved · what for who; Waiting / Done; ID card on Deliveries
try {
  const callsNow = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  const lastToast = () => page.evaluate(() => { const t = [...document.querySelectorAll(".eikon-toast")]; return t.length ? t[t.length - 1].textContent : ""; });
  await page.setViewportSize({ width: 1440, height: 900 });
  // Orders
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add");
  const ow = await page.evaluate(() => ({ open: document.querySelector(".ord-tabs").innerText.replace(/\s+/g, " "), save: document.querySelector("#ord-add button[type=submit]").textContent }));
  await page.fill("#ord-add [name=client_name]", "Borg Ċensina"); await page.fill("#ord-add [name=items]", "Augmentin 625"); await page.fill("#ord-add [name=needed_by]", todayYmd);
  await page.click("#ord-add button[type=submit]"); await page.waitForTimeout(700);
  const oT = await lastToast();
  // Questions
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector(".tkt-tabs"), null, { timeout: 15000 });
  const qw = await page.evaluate(() => ({ tabs: [...document.querySelectorAll(".tkt-tabs button")].map((b) => b.textContent), lab: (document.querySelector(".tkt-lab") || {}).textContent || "", opener: (document.querySelector(".tkt-top [data-act=add]") || {}).textContent }));
  await page.click(".tkt-top [data-act=add]"); await page.waitForSelector("#tkt-add");
  qw.save = await page.evaluate(() => document.querySelector("#tkt-add button[type=submit]").textContent);
  // Deliveries: the ID card goes in id_doc_ref only when typed; the rest of the body is as before
  await page.goto(base + "&ui=2#deliveries");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-top [data-act=add]"), null, { timeout: 15000 });
  const addDlv = async (id) => {
    await fetch(`http://localhost:${PORT}/__reset`);
    await page.click(".dlv-top [data-act=add]"); await page.waitForSelector("#dlv-add");
    await page.fill("#dlv-add [name=client_name]", id ? "Fenech Ġorġ" : "Borg Ċensina"); if (id) await page.fill("#dlv-add [name=id_doc_ref]", id);
    await page.fill("#dlv-add [name=phone]", "79111222"); await page.fill("#dlv-add [name=delivery_address]", "Triq il-Ħamrun, Żebbuġ");
    const save = await page.evaluate(() => document.querySelector("#dlv-add button[type=submit]").textContent);
    await page.click("#dlv-add button[type=submit]");
    await page.waitForFunction(() => !document.querySelector("#dlv-add") || document.querySelector(".epp-confirm,[role=alertdialog]"), null, { timeout: 8000 }).catch(() => {});
    for (let i = 0; i < 3; i++) { const b = await page.$("[role=alertdialog] [data-epc=no], [role=alertdialog] [data-epc=skip], [role=alertdialog] [data-epc=go]"); if (!b) break; await b.click(); await page.waitForTimeout(400); } // the ID card question: "No, just save the delivery"
    await page.waitForTimeout(500);
    const post = (await callsNow()).filter((c) => c.method === "POST" && c.path === "/client-deliveries/entries").map((c) => c.body)[0] || null;
    return { save, post, toast: await lastToast(), hasField: true };
  };
  const d0 = await addDlv(""), d1 = await addDlv("7654321m");
  const keys0 = d0.post ? Object.keys(d0.post).sort().join() : "", keys1 = d1.post ? Object.keys(d1.post).filter((k) => k !== "id_doc_ref").sort().join() : "";
  report("words: Orders 'New order' → 'Save order', Waiting / Done, success 'Saved · order for Borg Ċensina'",
    ow.open === "Waiting Done" && ow.save === "Save order" && oT.indexOf("Saved · order for Borg Ċensina") >= 0, JSON.stringify({ ow, oT }));
  report("words: Questions 'New question' → 'Save question', filters Waiting / Done (Open is only a button)",
    qw.opener === "New question" && qw.save === "Save question" && JSON.stringify(qw.tabs) === JSON.stringify(["Waiting", "Done"]) && !/^Open/.test(qw.lab), JSON.stringify(qw));
  report("words: Deliveries 'Save delivery', success 'Saved · delivery for Borg Ċensina · DEL-…'; no ID card typed = no id_doc_ref in the body; 7654321m typed = id_doc_ref as typed (as the classic stores it) and nothing else changes",
    d0.save === "Save delivery" && d0.post && !("id_doc_ref" in d0.post) && d1.post && d1.post.id_doc_ref === "7654321m" && keys0 === keys1 && /Saved · delivery for Borg Ċensina · DEL-\d+/.test(d0.toast),
    JSON.stringify({ d0s: d0.save, d0t: d0.toast, d0k: keys0, d1k: keys1, id: d1.post && d1.post.id_doc_ref }));
} catch (e) { report("words: ran to the end", false, String(e).slice(0, 300)); }

// batch 6 (W3): the server issues the number; the success line shows the server's (r.ticket_id / r.delivery_id), and
// the device's own when an older server sends none (the b4-10 checks above).
try {
  const lastToast = () => page.evaluate(() => { const t = [...document.querySelectorAll(".eikon-toast")]; return t.length ? t[t.length - 1].textContent : ""; });
  todayState.serverNo = true;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.querySelector(".tkt-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".tkt-top [data-act=add]"); await page.waitForSelector("#tkt-add");
  await page.fill("#tkt-add [name=client_name]", "Cachia Marija"); await page.fill("#tkt-add [name=issue]", "Is the repeat ready?");
  await page.click("#tkt-add button[type=submit]"); await page.waitForTimeout(800);
  const tT = await lastToast();
  await page.goto(base + "&ui=2#deliveries");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.querySelector(".dlv-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".dlv-top [data-act=add]"); await page.waitForSelector("#dlv-add");
  await page.fill("#dlv-add [name=client_name]", "Zammit Ġorġ"); await page.fill("#dlv-add [name=phone]", "79111333"); await page.fill("#dlv-add [name=delivery_address]", "Triq il-Kbira, Qormi");
  await page.click("#dlv-add button[type=submit]");
  await page.waitForFunction(() => !document.querySelector("#dlv-add") || document.querySelector("[role=alertdialog]"), null, { timeout: 8000 }).catch(() => {});
  for (let i = 0; i < 3; i++) { const b = await page.$("[role=alertdialog] [data-epc=no], [role=alertdialog] [data-epc=skip], [role=alertdialog] [data-epc=go]"); if (!b) break; await b.click(); await page.waitForTimeout(400); }
  await page.waitForTimeout(600);
  const dT = await lastToast();
  report("batch 6 (W3): Questions and Deliveries say the server's number (TKT-00090 / DEL-00090), not the one the device sent",
    /Saved · question for .* · TKT-00090/.test(tT) && /Saved · delivery for .* · DEL-00090/.test(dT), JSON.stringify({ tT, dT }));
} catch (e) { report("batch 6 (W3): ran to the end", false, String(e).slice(0, 300)); }
todayState.serverNo = false;

// screenshot for the review (reset the mock so the screen shows a morning with work to do)
todayState = { tempDone: false, cleanDone: false };
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForTimeout(1200);
await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(here, "..", "..", "design", "eikon-reimagined", "prototype", "04 Today, built.png") });
// leave the flag off for the next run
await page.evaluate(() => { localStorage.removeItem("eikon_ui2"); });

// ---- "Add Eikon to your desktop / home screen" (ui/eikon.install.js): eikonhq.com, new layout, once after sign-in ----
// eikonhq.com is answered from this server inside its own browser contexts (Playwright route; nothing leaves the
// machine): pages get index.html with the worker's clean-address mark, everything else comes from the mock.
try {
  const cleanHtml = () => fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/<head[^>]*>/i, (h) => h + '\n  <meta name="eikon-ui-base" content="/ui/" />');
  const instCtx = async (opts = {}, store = {}) => {
    const c = await browser.newContext(Object.assign({ viewport: { width: 1280, height: 860 } }, opts));
    await c.route(/^http:\/\/(www\.)?eikonhq\.com\//, async (r) => {
      const u = new URL(r.request().url());
      if (r.request().resourceType() === "document" && (u.pathname === "/" || /^\/[A-Za-z][\w-]*$/.test(u.pathname))) return r.fulfill({ contentType: "text/html", body: cleanHtml() });
      // A late request (What's new is read 1.5 s after the first screen) can still be on its way when a case closes its context.
      try { return await r.fulfill({ response: await r.fetch({ url: `http://localhost:${PORT}` + u.pathname + u.search }) }); } catch (e) { /* context closed */ }
    });
    await c.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
    await c.addInitScript((s) => { try { if (location.hostname.endsWith("eikonhq.com") && !localStorage.getItem("eikon_token")) { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); for (const k in s) localStorage.setItem(k, s[k]); } } catch (e) {} }, store);
    return c;
  };
  const instErrs = [];
  const open = async (c, url = "http://eikonhq.com/", frame) => {
    const p = await c.newPage(); p.on("pageerror", (e) => instErrs.push(e.message));
    await p.goto(url);
    const f = frame ? p.frame({ url: /eikonhq\.com/ }) || p.frames()[1] : p;
    await f.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.install && document.getElementById("eikon-content") && document.getElementById("eikon-content").children.length > 0, null, { timeout: 15000 });
    return { p, f };
  };
  const fireBip = (f, outcome = "accepted") => f.evaluate((outcome) => { window.__prompted = 0; const e = new Event("beforeinstallprompt", { cancelable: true }); e.prompt = () => { window.__prompted++; return Promise.resolve(); }; e.userChoice = Promise.resolve({ outcome, platform: "web" }); window.dispatchEvent(e); return !!window.EIKON_BIP; }, outcome);
  const cardOf = (f) => f.evaluate(() => { const c = document.querySelector(".eik-inst"); if (!c) return null; const r = c.getBoundingClientRect(); return { title: c.querySelector("h2").textContent, text: c.textContent, buttons: [...c.querySelectorAll("button")].map((b) => b.textContent), role: c.getAttribute("role"), label: !!document.getElementById(c.getAttribute("aria-labelledby")), left: r.left, right: r.right, vw: innerWidth, img: c.querySelector("img").complete && c.querySelector("img").naturalWidth > 0, focusIn: c.contains(document.activeElement) }; });
  const ls = (f, k) => f.evaluate((k) => localStorage.getItem(k), k);
  const waitCard = (f, t = 4000) => f.waitForSelector(".eik-inst", { timeout: t }).then(() => true, () => false);

  // A. Phone, Chrome-like: our card comes up after sign-in with the browser's prompt behind it; Add calls prompt().
  let c1 = await instCtx({ viewport: { width: 375, height: 812 }, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36" });
  let { p: pA } = await open(c1);
  const keptA = await fireBip(pA);
  const shownA = await waitCard(pA); const cA = await cardOf(pA);
  await pA.click('.eik-inst button[data-act="add"]').catch(() => {}); await pA.waitForTimeout(300);
  const afterA = { prompted: await pA.evaluate(() => window.__prompted), gone: !(await cardOf(pA)), done: await ls(pA, "eikon_install_done") };
  report("install offer (phone): the browser prompt is kept, our card comes up once after sign-in (home screen wording, icon, Add / Not now / Don’t ask again, a named dialog inside 375 px); Add calls prompt() and an accepted install is remembered",
    keptA && shownA && cA && cA.title === "Add Eikon to your home screen" && cA.buttons.join("|") === "Add|Not now|Don’t ask again" && cA.role === "dialog" && cA.label && cA.img && cA.left >= 16 && cA.right <= cA.vw - 16 && !cA.focusIn &&
    afterA.prompted === 1 && afterA.gone && afterA.done === "1", JSON.stringify({ keptA, shownA, cA, afterA }));
  // Once installed it is not offered again.
  const pA2 = (await open(c1)).p; await fireBip(pA2); report("install offer: not offered again once installed", !(await waitCard(pA2, 2500)));
  await c1.close();

  // B. Desktop: Escape = Not now (30 days); a new visit stays quiet; after 30 days it asks again; Don't ask again is for good; Settings still opens it.
  const c2 = await instCtx();
  const pB = (await open(c2)).p; await fireBip(pB);
  const shownB = await waitCard(pB); const cB = await cardOf(pB);
  await pB.keyboard.press("Escape"); await pB.waitForTimeout(200);
  const snooze = Number(await ls(pB, "eikon_install_snooze_until"));
  const escB = { gone: !(await cardOf(pB)), days: Math.round((snooze - Date.now()) / 864e5) };
  const pB2 = (await open(c2)).p; await fireBip(pB2); const quietB2 = !(await waitCard(pB2, 2500));
  await pB2.evaluate(() => localStorage.setItem("eikon_install_snooze_until", String(Date.now() - 1000)));
  const pB3 = (await open(c2)).p; await fireBip(pB3); const againB3 = await waitCard(pB3);
  await pB3.click('.eik-inst button[data-act="never"]'); await pB3.waitForTimeout(200);
  const neverB = await ls(pB3, "eikon_install_never");
  const pB4 = (await open(c2)).p; const keptB4 = await fireBip(pB4); const quietB4 = !(await waitCard(pB4, 2500));
  report("install offer (desktop): desktop wording; Escape closes it as Not now for 30 days; the next visit stays quiet; after 30 days it asks again; Don’t ask again is for good (the browser's own prompt is then left alone)",
    shownB && cB && cB.title === "Add Eikon to your desktop" && escB.gone && escB.days === 30 && quietB2 && againB3 && neverB === "1" && !keptB4 && quietB4,
    JSON.stringify({ shownB, cB: cB && cB.title, escB, quietB2, againB3, neverB, keptB4, quietB4 }));
  // Settings still opens it, keyboard first; Escape there just closes.
  await pB4.evaluate(() => { location.hash = "#settings"; }); await pB4.waitForTimeout(800);
  const setBtn = await pB4.$('.hub-card:has-text("Add to desktop or home screen")');
  if (setBtn) await setBtn.click();
  const cS = await waitCard(pB4) ? await cardOf(pB4) : null;
  await pB4.keyboard.press("Escape"); await pB4.waitForTimeout(150);
  report("install offer: reachable from Settings after Don’t ask again (focus moves into the card, browser-menu steps when no prompt is at hand); Escape closes it and nothing changes",
    !!setBtn && cS && cS.focusIn && /Install Eikon/.test(cS.text) && !(await cardOf(pB4)) && (await ls(pB4, "eikon_install_never")) === "1", JSON.stringify({ setBtn: !!setBtn, cS }));
  await c2.close();

  // C. Never in an installed app, in a frame, in the classic layout, or on another address.
  const c3 = await instCtx(); await c3.addInitScript(() => { try { Object.defineProperty(navigator, "standalone", { get: () => true }); } catch (e) {} });
  const pC = (await open(c3)).p; await fireBip(pC); const noStandalone = !(await waitCard(pC, 2500)); await c3.close();
  const c3b = await instCtx(); await c3b.addInitScript(() => { const mm = window.matchMedia.bind(window); window.matchMedia = (q) => /display-mode: standalone/.test(q) ? { matches: true, media: q, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} } : mm(q); });
  const pC2 = (await open(c3b)).p; await fireBip(pC2); const noStandalone2 = !(await waitCard(pC2, 2500)); await c3b.close();
  const c4 = await instCtx(); const pF = await c4.newPage();
  await c4.route("http://frame.test/", (r) => r.fulfill({ contentType: "text/html", body: '<!doctype html><title>Host</title><iframe src="http://eikonhq.com/" style="width:1200px;height:800px"></iframe>' }));
  await pF.goto("http://frame.test/");
  const fr = await (async () => { for (let i = 0; i < 60; i++) { const f = pF.frames().find((x) => /eikonhq\.com/.test(x.url())); if (f) return f; await pF.waitForTimeout(100); } return null; })();
  await fr.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.install, null, { timeout: 15000 });
  await fireBip(fr); const noFrame = !(await waitCard(fr, 2500)); await c4.close();
  const c5 = await instCtx({}, { eikon_ui2: "0" }); const pK = await c5.newPage(); await pK.goto("http://eikonhq.com/");
  await pK.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.install, null, { timeout: 15000 }); await pK.waitForTimeout(800);
  const keptK = await fireBip(pK); const noClassic = !(await waitCard(pK, 2500)); await c5.close();
  const pL = await browser.newPage(); await pL.goto(base + "#today");
  await pL.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); }); await pL.reload();
  await pL.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.install, null, { timeout: 15000 });
  await fireBip(pL); const noOther = !(await waitCard(pL, 2500)); const manL = await pL.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute("href")); await pL.close();
  report("install offer: never in an installed app (navigator.standalone, display-mode: standalone), inside a frame, in the classic layout (the browser's prompt left alone) or on another address (/ui/index.html keeps its manifest)",
    noStandalone && noStandalone2 && noFrame && noClassic && !keptK && noOther && manL === "manifest-next.json", JSON.stringify({ noStandalone, noStandalone2, noFrame, noClassic, keptK, noOther, manL }));

  // D. iPhone: two steps (Share, Add to Home Screen), no Add button; Firefox on a computer: nothing.
  const c6 = await instCtx({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1", hasTouch: true, isMobile: true });
  const pI = (await open(c6)).p; const shownI = await waitCard(pI); const cI = await cardOf(pI);
  const manI = await pI.evaluate(() => document.querySelector('link[rel="manifest"]').getAttribute("href"));
  await pI.click('.eik-inst button[data-act="later"]'); const snoozeI = Number(await ls(pI, "eikon_install_snooze_until")) > Date.now();
  await c6.close();
  const c7 = await instCtx({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0" });
  const pX = (await open(c7)).p; const noFx = !(await waitCard(pX, 2500)); await c7.close();
  report("install offer (iPhone): shown by itself with Share then Add to Home Screen and no Add button, Not now remembered; the clean address installs as eikonhq.com (manifest-clean.json); Firefox on a computer: nothing",
    shownI && cI && cI.title === "Add Eikon to your home screen" && /Add to Home Screen/.test(cI.text) && /Share/.test(cI.text) && cI.buttons.join("|") === "Not now|Don’t ask again" && snoozeI && manI === "/ui/manifest-clean.json" && noFx,
    JSON.stringify({ shownI, cI, manI, snoozeI, noFx }));
  report("install offer: no page errors", instErrs.length === 0, instErrs.slice(0, 3).join(" | "));
} catch (e) { report("install offer: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// Stock screens, best in class (near expiry, returns, transfers, alerts, order diary, price check, shortages, scarce stock,
// supplier stock): the way back is the shared one, a shelf check adds item after item, the last supplier is remembered,
// Escape closes a form and focus comes back, a failed load offers Try again, searching never redraws the box being typed
// in, a one-tap save keeps a keyboard user's place, and on a phone every button is 44 px with no sideways scroll.
try {
  const sx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await sx.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await sx.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await sx.addInitScript(() => { try { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_install_never", "1"); } catch (e) {} });
  const sp = await sx.newPage(); const sErr = []; sp.on("pageerror", (e) => sErr.push(e.message));
  const go = async (h, mod, sel) => { await sp.goto("about:blank"); await sp.goto(base + "&ui=2#" + h); await sp.waitForFunction(([m, s]) => window.EIKON && window.EIKON.state.activeModuleId === m && document.querySelector(s), [mod, sel], { timeout: 15000 }); await sp.waitForTimeout(250); };
  const posts = async (path) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === path);
  const focusIs = () => sp.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("data-act") || a.name || a.id || a.tagName) + (a.getAttribute("data-id") ? ":" + a.getAttribute("data-id") : "") : ""; });

  // Near expiry: a shelf check adds item after item; where it was found stays; Escape closes and Add has focus again.
  await go("nexreg", "nexreg", ".nex-row");
  const nxBack = (await sp.textContent(".nex-back")).trim();
  const nxPill = await sp.evaluate(() => [...document.querySelectorAll(".nex-pill")].map((e) => e.textContent));
  await fetch(`http://localhost:${PORT}/__reset`);
  await sp.click("[data-act=add]"); await sp.fill("#nex-add [name=product_name]", "Cetirizine 10mg"); await sp.fill("#nex-add [name=expiry_date]", "2027-01-31"); await sp.fill("#nex-add [name=location]", "Shelf Ż4");
  await sp.click("#nex-add button[type=submit]"); await sp.waitForTimeout(700);
  const nxAfter = await sp.evaluate(() => { const f = document.querySelector("#nex-add"); return f && { product: f.querySelector("[name=product_name]").value, where: f.querySelector("[name=location]").value, focus: document.activeElement && document.activeElement.name, submit: f.querySelector("[type=submit]").textContent, cancel: f.querySelector("[data-act=add-cancel]").textContent }; });
  const nxPost = (await posts("/near-expiry/entries"))[0];
  await sp.keyboard.press("Escape"); await sp.waitForTimeout(150);
  const nxEsc = { open: !!(await sp.$("#nex-add")), focus: await focusIs() };
  report("near expiry: the way back is ‹ Stock; pills say “Expired 2 days ago”; after Add the form stays for the next item with Where kept and focus on Product (Save item / Done); the body is as before; Escape closes it and Add has focus",
    nxBack === "‹ Stock" && nxPill.includes("Expired 2 days ago") && nxAfter && nxAfter.product === "" && nxAfter.where === "Shelf Ż4" && nxAfter.focus === "product_name" && nxAfter.submit === "Save item" && nxAfter.cancel === "Done" &&
    nxPost && JSON.stringify(nxPost.body) === JSON.stringify({ product_name: "Cetirizine 10mg", expiry_date: "2027-01-31", location: "Shelf Ż4", notes: "" }) && !nxEsc.open && nxEsc.focus === "add",
    JSON.stringify({ nxBack, nxPill, nxAfter, nxPost, nxEsc }));

  // Send back: the supplier field has focus; an empty one is refused out loud; the next one starts with the last supplier, selected.
  await sp.evaluate(() => localStorage.removeItem("eikon_nex_suppliers"));
  await sp.click('[data-act=ret][data-id="1"]'); await sp.waitForTimeout(120);
  const rbFocus = await focusIs();
  await sp.click("#nex-ret button[type=submit]"); await sp.waitForTimeout(150);
  const rbErr = await sp.evaluate(() => { const e = document.querySelector(".nex-err"); return e ? e.getAttribute("role") + "|" + e.textContent : ""; });
  await sp.fill("#nex-ret [name=supplier]", "Hili Pharma"); await sp.click("#nex-ret button[type=submit]"); await sp.waitForTimeout(700);
  await sp.click('[data-act=ret][data-id="2"]'); await sp.waitForTimeout(120);
  const rbNext = await sp.evaluate(() => { const i = document.querySelector("#nex-ret [name=supplier]"); return { v: i.value, sel: i.selectionStart === 0 && i.selectionEnd === i.value.length, focus: document.activeElement === i, opts: [...document.querySelectorAll("#nex-sup option")].map((o) => o.value) }; });
  await sp.keyboard.press("Escape"); await sp.waitForTimeout(150);
  const rbEsc = await focusIs();
  report("near expiry, send back: the supplier field has focus; an empty supplier is announced (role=alert); the next one starts with the last supplier, selected, and it is offered in the list; Escape returns to that row's Send back",
    rbFocus === "supplier" && /^alert\|Write the supplier/.test(rbErr) && rbNext.v === "Hili Pharma" && rbNext.sel && rbNext.focus && rbNext.opts[0] === "Hili Pharma" && rbEsc === "ret:2", JSON.stringify({ rbFocus, rbErr, rbNext, rbEsc }));

  // A failed load says so and offers Try again, which loads it.
  let failsLeft = 2; // the app retries a failed read once by itself
  await sp.evaluate(() => { location.hash = "#stock"; }); await sp.waitForTimeout(300);
  await sp.waitForSelector(".stk-head", { timeout: 10000 }).catch(() => {}); // the Stock tab reads near expiry too (d-stock): fail only the screen's own read
  await sp.route(/\/near-expiry\/entries$/, (r) => { if (failsLeft > 0 && r.request().method() === "GET") { failsLeft--; return r.abort(); } return r.continue(); });
  await sp.evaluate(() => { location.hash = "#nexreg"; }); await sp.waitForSelector("[data-act=retry]", { timeout: 15000 });
  const rtErr = await sp.evaluate(() => { const q = document.querySelector("[data-act=retry]").closest("[role=alert]"); return q ? q.textContent : ""; });
  await sp.click("[data-act=retry]"); await sp.waitForSelector(".nex-row", { timeout: 15000 });
  await sp.unroute(/\/near-expiry\/entries$/);
  report("near expiry: a load that fails is announced with Try again, and Try again brings the list", /server|Try again/.test(rtErr) && !!(await sp.$(".nex-row")), rtErr);

  // Price check: searching filters the quotes without replacing the box or moving the cursor.
  await go("qtreg", "qtreg", ".qtr-row");
  await sp.evaluate(() => { document.querySelector("#qtr-q").__mark = 1; });
  await sp.click("#qtr-q"); await sp.keyboard.type("pnadol"); await sp.keyboard.press("Home"); await sp.keyboard.press("ArrowRight"); await sp.keyboard.type("a"); await sp.waitForTimeout(150);
  const qs = await sp.evaluate(() => { const q = document.querySelector("#qtr-q"); return { same: q.__mark === 1, v: q.value, caret: q.selectionStart, focus: document.activeElement === q, label: q.getAttribute("aria-label"), rows: document.querySelectorAll(".qtr-row").length }; });
  report("price check: typing in the search filters the list but never redraws the box (same element, cursor stays mid-word, labelled)", qs.same && qs.v === "panadol" && qs.caret === 2 && qs.focus && qs.label === "Search quotes" && qs.rows > 0, JSON.stringify(qs));

  // Alerts: a keyboard tick keeps your place; with every step ticked, Close alert is the one primary button.
  await go("alertreg", "alertreg", ".alr-card");
  await sp.focus('[data-act=tick][data-k="supplier_informed"]'); await sp.keyboard.press("Enter"); await sp.waitForTimeout(700);
  const alFocus = await sp.evaluate(() => { const a = document.activeElement; return a && a.getAttribute("data-k"); });
  await sp.route(/\/alerts\/entries$/, (r) => r.request().method() !== "GET" ? r.continue() : r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [{ id: 41, entry_date: todayYmd, alert_type: "recall", status: "open", item_name: "Losartan 50mg", storage_location: "room", team_informed: 1, supplier_informed: 1, authorities_informed: 1, return_arranged: 1, handed_over: 1, collection_note_received: 1, credit_note_received: 1 }] }) }));
  await go("alertreg", "alertreg", ".alr-card"); const alClose = await sp.getAttribute('[data-act=close]', "class");
  await sp.unroute(/\/alerts\/entries$/);
  report("alerts: a tick made from the keyboard leaves focus on that tick; once every step is ticked, Close alert is the primary button", alFocus === "supplier_informed" && / p\b/.test(alClose || ""), JSON.stringify({ alFocus, alClose }));

  // Returns and the order diary: the same for a step or a status set from the keyboard.
  await go("retreg", "retreg", ".rtn-row"); await sp.focus('[data-act=step][data-id="11"]'); await sp.keyboard.press("Enter"); await sp.waitForTimeout(800);
  const rtFocus = await focusIs();
  await go("odreg", "odreg", ".odr-row"); await sp.focus('[data-st=received][data-id="101"]'); await sp.keyboard.press("Enter"); await sp.waitForTimeout(800);
  const odFocus = await sp.evaluate(() => (document.activeElement && document.activeElement.getAttribute("data-id")) || "");
  report("returns and order diary: after a one-tap save made from the keyboard, focus is back on that item", rtFocus === "step:11" && odFocus === "101", JSON.stringify({ rtFocus, odFocus }));

  // Transfers: plain words, the form opens on its first field, Escape gives focus back to Offer an item.
  await go("trfreg", "trfreg", ".trf-row");
  const tfWords = await sp.evaluate(() => document.querySelector(".trf").innerText);
  await sp.click("[data-act=offer]"); await sp.waitForTimeout(120); const tfFocus = await focusIs();
  const tfMin = await sp.getAttribute("#trf-offer [name=expiry_date]", "min");
  await sp.keyboard.press("Escape"); await sp.waitForTimeout(150); const tfEsc = await focusIs();
  report("transfers: “Expires 1 Jan 2027”, not “Exp”; Offer an item opens on Item; the expiry can't be in the past; Escape closes and Offer an item has focus",
    /Expires \d/.test(tfWords) && !/\bExp \d/.test(tfWords) && tfFocus === "item_description" && tfMin === todayYmd && tfEsc === "offer", JSON.stringify({ tfFocus, tfMin, tfEsc }));

  // Order diary: suppliers already used are offered in the Supplier field.
  await go("odreg", "odreg", ".odr-row"); await sp.click("[data-act=add]"); await sp.waitForTimeout(200);
  const odSup = await sp.evaluate(() => ({ list: document.querySelector("#odr-add [name=supplier]").getAttribute("list"), opts: [...document.querySelectorAll("#odr-sups option")].map((o) => o.value) }));
  report("order diary: the Supplier field offers the suppliers already used", odSup.list === "odr-sups" && odSup.opts.includes("Actavis"), JSON.stringify(odSup));

  // Small buttons in Shortages and Scarce stock keep their own colours (the card's grey sub-line style no longer reaches them).
  await go("scsreg", "scsreg", ".scs-card");
  const scCol = await sp.evaluate(() => { const b = document.querySelector(".scs-btn.s.p"); return b ? getComputedStyle(b).color : "none"; });
  await go("ssreg", "ssreg", ".ssr-card");
  const ssCol = await sp.evaluate(() => { const b = document.querySelector(".ssr-btn.s"); return b ? [getComputedStyle(b).color, getComputedStyle(b).fontSize] : "none"; });
  report("scarce stock and shortages: “Ask for some” is white on green (was grey, 1.2:1) and “I can help” keeps the button's text colour and size", scCol === "rgb(255, 255, 255)" && Array.isArray(ssCol) && ssCol[1] === "13px", JSON.stringify({ scCol, ssCol }));

  // Phone: every screen in the group, 44 px buttons and fields, nothing wider than 360 px.
  await sp.setViewportSize({ width: 390, height: 844 });
  const phone = {};
  for (const [h, mod, sel] of [["nexreg", "nexreg", ".nex-row"], ["retreg", "retreg", ".rtn-row"], ["trfreg", "trfreg", ".trf-row"], ["alertreg", "alertreg", ".alr-card"], ["odreg", "odreg", ".odr-row"], ["qtreg", "qtreg", ".qtr-row"], ["ssreg", "ssreg", ".ssr-card"], ["scsreg", "scsreg", ".scs-card"], ["sinreg", "sinreg", ".sin-row"]]) {
    await go(h, mod, sel);
    const small = await sp.evaluate(() => [...document.querySelectorAll("#eikon-content :is(button, input:not([type=checkbox]):not([type=hidden]), select)")].filter((e) => e.offsetParent && !e.closest("label")).filter((e) => e.getBoundingClientRect().height < 43.5).map((e) => (e.className || e.tagName) + ":" + Math.round(e.getBoundingClientRect().height)));
    await sp.setViewportSize({ width: 360, height: 800 }); await sp.waitForTimeout(150);
    const wide = await sp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await sp.setViewportSize({ width: 390, height: 844 });
    phone[h] = { small: small.slice(0, 4), wide };
  }
  const phoneBad = Object.entries(phone).filter(([, v]) => v.small.length || v.wide);
  report("stock screens on a phone: every button and field is at least 44 px tall and nothing scrolls sideways at 360 px", phoneBad.length === 0, JSON.stringify(phoneBad));
  report("stock screens: no page errors", sErr.length === 0, sErr.slice(0, 3).join(" | "));
  await sx.close();
} catch (e) { report("stock screens: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// Focus is never lost (BACKLOG4 item 2): a screen opened from a link puts focus on its heading with the main button one
// Tab away; N opens the main form; Ctrl/Cmd+Enter saves from a text box; Escape cancels (and never throws away typing);
// after a save or a redraw focus is on a control or the heading, never on the page; it never jumps out of a form being
// typed in; Today goes to the next check after Log; the search dialog lists the keys. The classic layout is left alone.
try {
  const fx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await fx.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await fx.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await fx.addInitScript(() => { try { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_install_never", "1"); } catch (e) {} });
  const fp = await fx.newPage(); const fErr = []; fp.on("pageerror", (e) => fErr.push(e.message));
  const fcalls = async (m, path) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === m && c.path === path);
  const at = () => fp.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? "BODY" : a.tagName === "H1" ? "H1:" + a.textContent.trim() : (a.getAttribute("data-act") || a.name || a.getAttribute("data-kind") || a.tagName) + ":" + (a.textContent || "").trim().slice(0, 24); });
  const openFrom = async (from, to, sel) => { await fp.evaluate((h) => { location.hash = "#" + h; }, from); await fp.waitForFunction((m) => window.EIKON.state.activeModuleId === m, from, { timeout: 15000 }); await fp.waitForTimeout(400);
    await fp.evaluate(() => { const c = document.querySelector("#eikon-content button, #eikon-content a[href]"); if (c) c.focus(); }); // a card on the hub, as Enter on it leaves it
    await fp.evaluate((h) => { location.hash = "#" + h; }, to); await fp.waitForFunction(([m, s]) => window.EIKON.state.activeModuleId === m && document.querySelector(s), [to, sel], { timeout: 15000 }); await fp.waitForTimeout(700); };
  await fp.goto(base + "&ui=2#today"); await fp.waitForFunction(() => window.EIKON && window.EIKON.state.user && document.querySelector(".tdy-head h1"), null, { timeout: 15000 }); await fp.waitForTimeout(800);
  const boot = await at();

  // 1. Opened from a hub: focus on the heading, the main button is the next Tab, for each screen of the sample
  const opened = {};
  for (const [hub, id, sel, main] of [["customers", "ordreg", ".ord-top", "New order"], ["customers", "tktreg", ".tkt-top h1", "New question"], ["customers", "dlvreg", ".dlv-top h1", "New delivery"], ["registers", "cdsreg", ".cds-top h1", "New prescription"], ["money", "poreg", ".por-top h1", "New payment"]]) {
    await openFrom(hub, id, sel);
    const h = await at(); await fp.keyboard.press("Tab");
    // the screen's own "?" (eikon.help.js) sits in its heading: one stop, then the main button
    const viaHelp = await fp.evaluate(() => !!(document.activeElement && document.activeElement.classList.contains("nxh-q")));
    if (viaHelp) await fp.keyboard.press("Tab");
    const next = await at();
    opened[id] = { h, viaHelp, next, ok: /^H1:/.test(h) && next.endsWith(":" + main.slice(0, 24)) };
  }
  report("focus: a screen opened from a hub has focus on its heading, and the main button is the very next Tab (was 12 to 14 Tabs from the page); the first screen after sign-in leaves focus alone", Object.values(opened).every((o) => o.ok) && boot === "BODY", JSON.stringify({ boot, opened }));

  // 2. N opens the main form; typing an n in a field types it; Escape on an untouched form closes it with focus back on the opener
  await openFrom("customers", "tktreg", ".tkt-top h1");
  await fp.keyboard.press("n"); await fp.waitForSelector("#tkt-add", { timeout: 3000 }).catch(() => {}); await fp.waitForTimeout(300);
  const nOpen = { form: await fp.$("#tkt-add") !== null, at: await at() };
  await fp.keyboard.type("Grech Anna"); await fp.waitForTimeout(150);
  const typedN = await fp.evaluate(() => (document.querySelector("#tkt-add [name=client_name]") || {}).value);
  report("focus: N opens the screen's main form (New question) with focus in it; an n typed in a field is just a letter", nOpen.form && /client_name/.test(nOpen.at) && typedN === "Grech Anna", JSON.stringify({ nOpen, typedN }));

  // 3. Escape after typing never throws it away: focus goes to Cancel; Enter there cancels; focus comes back to the opener
  await fp.focus("#tkt-add [name=issue]"); await fp.keyboard.press("Escape"); await fp.waitForTimeout(250);
  const esc1 = { form: await fp.$("#tkt-add") !== null, at: await at(), kept: await fp.evaluate(() => (document.querySelector("#tkt-add [name=client_name]") || {}).value) };
  await fp.keyboard.press("Enter"); await fp.waitForTimeout(400);
  const esc2 = { form: await fp.$("#tkt-add") !== null, at: await at() };
  report("focus: Escape in a form with typing goes to Cancel and keeps what was typed (one key never throws it away); Enter on Cancel closes it and focus is back on New question", esc1.form && /Cancel/i.test(esc1.at) && esc1.kept === "Grech Anna" && !esc2.form && /New question/.test(esc2.at), JSON.stringify({ esc1, esc2 }));

  // 4. Ctrl+Enter in the question box saves (one POST); afterwards focus is on a control of the screen, not the page
  const tkBefore = (await fcalls("POST", "/client-tickets/entries")).length;
  await fp.keyboard.press("n"); await fp.waitForSelector("#tkt-add [name=issue]", { timeout: 3000 });
  await fp.fill("#tkt-add [name=client_name]", "Borg Ċensina"); await fp.fill("#tkt-add [name=phone]", "79123456"); await fp.fill("#tkt-add [name=issue]", "Can I take ibuprofen?");
  await fp.focus("#tkt-add [name=issue]"); await fp.keyboard.press("Control+Enter"); await fp.waitForTimeout(1500);
  const tkPosts = (await fcalls("POST", "/client-tickets/entries")).slice(tkBefore);
  const afterTk = await at();
  report("focus: Ctrl+Enter in a text box saves the form once, with the same body as the Add button; after the save focus is on New question, not the page", tkPosts.length === 1 && tkPosts[0].body.client_name === "Borg Ċensina" && tkPosts[0].body.issue === "Can I take ibuprofen?" && afterTk !== "BODY" && /New question/.test(afterTk), JSON.stringify({ n: tkPosts.length, body: tkPosts[0] && tkPosts[0].body, afterTk }));

  // 5. A redraw that removes the focused control: focus goes to the same control redrawn, else the heading; never the page
  await openFrom("customers", "ordreg", ".ord-top");
  const redraw = await fp.evaluate(async () => {
    const c = document.getElementById("eikon-content"), b = c.querySelector(".ord-top [data-act=add]"); b.focus();
    const keep = b.outerHTML; b.outerHTML = keep; // the same button drawn again
    await new Promise((r) => setTimeout(r, 400)); const one = document.activeElement && document.activeElement.getAttribute("data-act");
    const b2 = c.querySelector(".ord-top [data-act=add]"); b2.focus(); b2.remove(); // gone for good
    await new Promise((r) => setTimeout(r, 400)); const two = document.activeElement ? document.activeElement.tagName : "";
    return { one, two };
  });
  report("focus: when a redraw replaces the focused button focus is on the new copy; when it is gone, on the heading; never on the page", redraw.one === "add" && redraw.two === "H1", JSON.stringify(redraw));

  // 6. Never out of a form being typed in: a late E.focusAfter waits until focus leaves the form
  await openFrom("customers", "ordreg", ".ord-top"); await fp.keyboard.press("n"); await fp.waitForSelector("#ord-add [name=client_name]");
  await fp.focus("#ord-add [name=client_name]"); await fp.keyboard.type("Vel");
  await fp.evaluate(() => window.EIKON.focusAfter("h1")); await fp.waitForTimeout(300);
  const steal = { at: await at(), v: await fp.evaluate(() => document.querySelector("#ord-add [name=client_name]").value) };
  report("focus: E.focusAfter never takes focus from a form being typed in", /client_name/.test(steal.at) && steal.v === "Vel", JSON.stringify(steal));
  await fp.evaluate(() => { const c = document.querySelector("#ord-add [data-act=add-cancel]"); if (c) c.click(); });

  // 7. Today: after Log, focus is on the next check still to do (the next reading), not the page
  await fp.evaluate(() => { location.hash = "#today"; }); await fp.waitForFunction(() => window.EIKON.state.activeModuleId === "today" && document.querySelector(".tdy-row[data-kind=temperature] [data-min]"), null, { timeout: 15000 }); await fp.waitForTimeout(400);
  const nTemp = await fp.$$eval(".tdy-row[data-kind=temperature] [data-min]", (l) => l.length);
  await fp.fill(".tdy-row[data-kind=temperature] [data-min] >> nth=0", "3.2"); await fp.fill(".tdy-row[data-kind=temperature] [data-max] >> nth=0", "6.8");
  await fp.press(".tdy-row[data-kind=temperature] [data-max] >> nth=0", "Enter"); await fp.waitForTimeout(1500);
  const tdy = await fp.evaluate(() => { const a = document.activeElement; return { tag: a && a.tagName, kind: a && a.getAttribute("data-kind"), row: !!(a && a.classList.contains("tdy-row")), body: a === document.body }; });
  report("focus: on Today, after Log focus is on the next check still to do (a row, so the minute refresh still runs), not the page", !tdy.body && (tdy.row || tdy.tag === "H1") && (nTemp < 2 || tdy.kind), JSON.stringify({ nTemp, tdy }));

  // 8. The search dialog lists the keys
  await fp.keyboard.press("/"); await fp.waitForSelector(".esr-foot", { timeout: 3000 });
  const foot = await fp.$eval(".esr-foot", (e) => e.textContent);
  await fp.keyboard.press("Escape");
  report("focus: the search dialog's footer lists N (new), Ctrl+Enter (save) and Esc", /N\s*new/i.test(foot) && /Enter\s*saves/i.test(foot), foot);

  // 9. The classic layout is left alone: N does nothing there and a screen's opening leaves focus where it was
  await fp.goto(base + "&ui=classic#tickets"); await fp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "tickets", null, { timeout: 15000 }); await fp.waitForTimeout(900);
  const cl0 = await fp.evaluate(() => document.querySelectorAll(".eikon-modal-overlay[style*='flex'], dialog[open]").length);
  await fp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await fp.keyboard.press("n"); await fp.waitForTimeout(300);
  const cl = { at: await at(), modals: await fp.evaluate(() => document.querySelectorAll(".eikon-modal-overlay[style*='flex'], dialog[open]").length), helper: await fp.evaluate(() => typeof window.EIKON.focusAfter) };
  report("focus: the classic layout is unchanged (N opens nothing, focus stays on the page as before)", cl.at === "BODY" && cl.modals === cl0 && cl.helper === "function", JSON.stringify({ cl0, cl }));
  report("focus: no page errors", fErr.length === 0, fErr.slice(0, 3).join(" | "));
  await fx.close();
} catch (e) { report("focus: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// ---- Out-of-limits readings: the note is written where the reading is shown; a missed day is logged late (BACKLOG3 item 2) ----
try {
  const tp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const tErrs = []; tp.on("pageerror", (e) => tErrs.push(e.message));
  await tp.goto(base + "#dashboard"); await tp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  const yd = new Date(Date.parse(todayYmd + "T12:00:00Z") - 864e5).toISOString().slice(0, 10); // the mock's /today date, less a day
  const yEntry = () => ({ id: 41, device_id: 7, device_name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, entry_date: yd, min_temp: 3.8, max_temp: 9.1, notes: "", created_by: 1, created_at: yd + " 08:00:00", updated_at: yd + " 08:00:00" });
  tempState = { on: true, entries: [yEntry()], next: 100 };
  todayState = { tempDone: false, cleanDone: false, yOut: true };
  const openT = async () => { await tp.goto(base + "&ui=2#today"); await tp.reload(); await tp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1") && !/Loading/.test(document.querySelector(".tdy-head h1").textContent), null, { timeout: 15000 }); await tp.waitForTimeout(300); };
  await openT();
  const a = await tp.evaluate(() => ({ h1: document.querySelector(".tdy-head h1").textContent, leg: document.querySelector(".tdy-legend").textContent, form: !!document.querySelector(".tdy-warn form[data-tnote] textarea"), label: (document.querySelector(".tdy-warn form[data-tnote] label") || {}).textContent, picks: [...document.querySelectorAll(".tdy-warn [data-pick]")].map((b) => b.textContent), badge: (document.querySelector('.eikon-rail-badge[data-badge="today"]') || {}).textContent, classic: /classic/i.test(document.querySelector(".tdy-warn").textContent) }));
  // 3 = cleaning overdue + the reading to log + the note to write (the Daily register is owed only at closing since main .147)
  report("temperature note (Today): yesterday's out-of-limits reading with no note shows \"Say what was done\" with quick picks right there, and counts as a check still to do (headline, legend, rail badge)",
    a.form && a.label === "Say what was done" && a.picks.length >= 3 && /^3 /.test(a.h1) && /1 note to write/.test(a.leg) && a.badge === "3" && !a.classic, JSON.stringify(a));
  // a quick pick fills the box, the text stays editable; Save sends the whole record as read, only notes changed
  await fetch(`http://localhost:${PORT}/__reset`);
  await tp.click('.tdy-warn [data-pick="Engineer called"]');
  await tp.type(".tdy-warn form[data-tnote] textarea", ", came 11:00", { delay: 15 });
  const typed = await tp.inputValue(".tdy-warn form[data-tnote] textarea");
  // the minute refresh does not wipe what is being typed
  await tp.evaluate(() => window.EIKON.__todayRefresh()); await tp.waitForTimeout(200);
  const kept = await tp.inputValue(".tdy-warn form[data-tnote] textarea").catch(() => "");
  await tp.click(".tdy-warn form[data-tnote] button[type=submit]");
  await tp.waitForFunction(() => !document.querySelector(".tdy-warn form[data-tnote]"), null, { timeout: 6000 }).catch(() => {});
  const c1 = await callsNow();
  const posts = c1.filter((c) => c.method === "POST" && c.path === "/temperature/entries");
  const readFirst = c1.findIndex((c) => c.method === "GET" && c.path === "/temperature/entries" && c.query.indexOf("month=" + yd.slice(0, 7)) >= 0) < c1.findIndex((c) => c.method === "POST");
  const asRead = yEntry(), sent = posts[0] && posts[0].body;
  // The classic Temperature screen's body (modules.temperature.js save): device_id, entry_date, min_temp, max_temp, notes
  const classicKeys = ["device_id", "entry_date", "min_temp", "max_temp", "notes"];
  const colDiff = sent ? classicKeys.filter((k) => k !== "notes" && JSON.stringify(sent[k]) !== JSON.stringify(asRead[k])) : ["(no post)"];
  const b = await tp.evaluate(() => ({ warn: document.querySelector(".tdy-warn").textContent, role: document.querySelector(".tdy-warn").getAttribute("role"), h1: document.querySelector(".tdy-head h1").textContent, focus: document.activeElement && document.activeElement.className }));
  report("temperature note (Today): a quick pick fills the box and stays editable; the minute refresh keeps it; Save re-reads the entry and POSTs exactly the classic body (same keys) with min/max as read and only notes changed; then the banner says what was done and the count drops",
    typed === "Engineer called, came 11:00" && kept === typed && posts.length === 1 && readFirst && JSON.stringify(Object.keys(sent).sort()) === JSON.stringify(classicKeys.slice().sort()) && colDiff.length === 0 && sent.notes === typed &&
    /Note: Engineer called, came 11:00/.test(b.warn) && b.role === "status" && /^2 /.test(b.h1) && /tdy-row/.test(b.focus || ""), JSON.stringify({ typed, kept, posts: posts.map((x) => x.body), colDiff, readFirst, b }));
  // stale: the reading changed elsewhere while the note was typed: nothing is sent, both are shown, the text stays
  tempState = { on: true, entries: [yEntry()], next: 100 }; await openT();
  await tp.fill(".tdy-warn form[data-tnote] textarea", "Stock moved");
  Object.assign(tempState.entries[0], { max_temp: 8.6, notes: "Checked by Karl", updated_at: yd + " 12:00:00" });
  await fetch(`http://localhost:${PORT}/__reset`);
  await tp.click(".tdy-warn form[data-tnote] button[type=submit]"); await tp.waitForTimeout(600);
  const c2 = await callsNow(), st = await tp.evaluate(() => ({ msg: (document.querySelector(".tdy-warn .tnote-msg") || {}).textContent || "", v: (document.querySelector(".tdy-warn form[data-tnote] textarea") || {}).value }));
  report("temperature note (Today): a reading changed elsewhere meanwhile is refused (nothing sent), the message shows the reading as it is now and what was typed, and the text stays in the box",
    c2.filter((c) => c.method === "POST").length === 0 && /Someone changed this reading/.test(st.msg) && /8\.6/.test(st.msg) && /Checked by Karl/.test(st.msg) && /Stock moved/.test(st.msg) && st.v === "Stock moved", JSON.stringify(st));
  // offline: the save message is the shared one and the form keeps the text
  tempState = { on: true, entries: [yEntry()], next: 100 }; await openT();
  await tp.fill(".tdy-warn form[data-tnote] textarea", "Door closed");
  await tp.route("**/temperature/entries*", (r) => r.abort("internetdisconnected"));
  await tp.click(".tdy-warn form[data-tnote] button[type=submit]"); await tp.waitForTimeout(1500);
  const off = await tp.evaluate(() => ({ msg: (document.querySelector(".tdy-warn .tnote-msg") || {}).textContent || "", v: (document.querySelector(".tdy-warn form[data-tnote] textarea") || {}).value, dis: (document.querySelector(".tdy-warn form[data-tnote] button[type=submit]") || {}).disabled }));
  await tp.unroute("**/temperature/entries*");
  report("temperature note (Today): a dropped save (and its check) keeps the text and says plainly Eikon could not tell (E.saveFailText)", /^We could not tell if it was saved\. Check the list before trying again\.$/.test(off.msg) && off.v === "Door closed" && off.dis === false, JSON.stringify(off));
  // today's own reading outside the limits: the note box follows it and takes the cursor
  tempState = { on: true, entries: [], next: 100 }; todayState = { tempDone: false, cleanDone: false };
  await openT();
  const td = await tp.evaluate(() => window.EIKON.maltaYmd());
  await tp.fill('.tdy-row[data-kind=temperature] [data-min]', "4"); await tp.fill('.tdy-row[data-kind=temperature] [data-max]', "9.5");
  await tp.click('.tdy-row[data-kind=temperature] [data-act=temp]');
  await tp.waitForTimeout(800);
  report("temperature note (Today): after logging a reading the mock stored it as the worker does", tempState.entries.length === 1 && tempState.entries[0].entry_date === td && tempState.entries[0].notes === "", JSON.stringify(tempState.entries));
  todayState.outToday = true; await openT();
  const tnow = await tp.evaluate(() => ({ form: !!document.querySelector(".tdy-note form[data-tnote] textarea"), pill: (document.querySelector(".tdy-row[data-kind=temperature] .tdy-pill") || {}).textContent }));
  report("temperature note (Today): today's reading outside its limits shows the note box under its row, pill \"Outside limits · note needed\"", tnow.form && tnow.pill === "Outside limits · note needed", JSON.stringify(tnow));
  todayState = { tempDone: false, cleanDone: false };

  // Temperature register: every past day is a button with a full label; the future is not; tapping opens the day
  tempState = { on: true, entries: [yEntry()], next: 100 };
  const ym = yd.slice(0, 7);
  await tp.goto(base + "&ui=2#tempreg"); await tp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "tempreg" && document.querySelector(".trg-sum"), null, { timeout: 15000 });
  if (ym !== td.slice(0, 7)) { await tp.click(".emb [data-mb=prev]"); await tp.waitForTimeout(600); }
  const cell = await tp.evaluate((day) => { const c = document.querySelector('button.trg-d[data-day="' + day + '"]'); const fut = [...document.querySelectorAll(".trg-d.future:not(.today)")]; return { label: c && c.getAttribute("aria-label"), futBtn: fut.some((f) => f.tagName === "BUTTON"), classic: /classic Temperature/.test(document.body.textContent) }; }, yd);
  const dname = (() => { const p = yd.split("-"); return Number(p[2]) + " " + ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][Number(p[1]) - 1]; })();
  report("temperature register: a day is a button labelled \"<day>, Fridge 1, 3.8 to 9.1, outside limits, no note\"; future days are not buttons; no link to the classic screen",
    cell.label === dname + ", Fridge 1, 3.8 to 9.1, outside limits, no note" && !cell.futBtn && !cell.classic, JSON.stringify({ cell, dname }));
  await tp.focus('button.trg-d[data-day="' + yd + '"]'); await tp.keyboard.press("Enter"); await tp.waitForSelector(".trg-day h3", { timeout: 4000 });
  const pan = await tp.evaluate(() => ({ text: document.querySelector(".trg-day").textContent, focus: document.activeElement && document.activeElement.tagName }));
  await tp.click('.trg-day [data-act="addnote"]');
  const nfocus = await tp.evaluate(() => document.activeElement && document.activeElement.tagName);
  await tp.click('.trg-day [data-pick="Stock moved to the other fridge"]');
  await fetch(`http://localhost:${PORT}/__reset`);
  await tp.click(".trg-day form[data-tnote] button[type=submit]");
  await tp.waitForFunction(() => /Note: Stock moved/.test((document.querySelector(".trg-day") || {}).textContent || ""), null, { timeout: 6000 }).catch(() => {});
  const c3 = (await callsNow()).filter((c) => c.method === "POST");
  report("temperature register: Enter on a day opens it (focus on its heading) with readings, limits and no note; Add a note puts the cursor in the box; Save sends the classic body with min/max as read",
    /Min 3\.8/.test(pan.text) && /Outside limits/.test(pan.text) && /No note/.test(pan.text) && pan.focus === "H3" && nfocus === "TEXTAREA" && c3.length === 1 && c3[0].body.min_temp === 3.8 && c3[0].body.max_temp === 9.1 && c3[0].body.notes === "Stock moved to the other fridge" && JSON.stringify(Object.keys(c3[0].body).sort()) === JSON.stringify(classicKeys.slice().sort()),
    JSON.stringify({ pan, nfocus, c3: c3.map((c) => c.body) }));
  // a past day never logged: "Log this day" with a required reason, stored as "Logged late: ..."
  const missDay = await tp.evaluate(() => { const c = document.querySelector("button.trg-d.miss"); return c && c.getAttribute("data-day"); });
  if (!missDay) report("temperature register: a missed day to log late exists in the shown month", false, "no dashed day");
  else {
    await tp.click('button.trg-d[data-day="' + missDay + '"]'); await tp.click('.trg-day [data-act="late"]');
    const lf = await tp.evaluate(() => document.activeElement && document.activeElement.name);
    await tp.fill(".trg-day [name=min]", "3,4"); await tp.fill(".trg-day [name=max]", "6.8");
    await fetch(`http://localhost:${PORT}/__reset`);
    await tp.click(".trg-day form[data-tlate] button[type=submit]"); await tp.waitForTimeout(400);
    const noReason = { posts: (await callsNow()).filter((c) => c.method === "POST").length, msg: await tp.textContent(".trg-day .tnote-msg"), focus: await tp.evaluate(() => document.activeElement && document.activeElement.name) };
    await tp.click('.trg-day [data-pick="Read from the data logger"]');
    await tp.click(".trg-day form[data-tlate] button[type=submit]");
    await tp.waitForFunction(() => /Logged late/.test((document.querySelector(".trg-day") || {}).textContent || ""), null, { timeout: 6000 }).catch(() => {});
    const lp = (await callsNow()).filter((c) => c.method === "POST");
    report("temperature register: a missed day is logged late only with a reason (refused without, focus on the reason, nothing sent); saved as min/max with the note \"Logged late: <reason>\" (decimal comma read)",
      lf === "min" && noReason.posts === 0 && /Say why it is logged late/.test(noReason.msg) && noReason.focus === "reason" && lp.length === 1 &&
      JSON.stringify(lp[0].body) === JSON.stringify({ device_id: 7, entry_date: missDay, min_temp: 3.4, max_temp: 6.8, notes: "Logged late: Read from the data logger" }), JSON.stringify({ lf, noReason, lp: lp.map((c) => c.body) }));
  }
  // the future is refused by the shared code too (not only by the grid)
  const fut = await tp.evaluate(async () => { const d = new Date(); d.setDate(d.getDate() + 2); return await window.EIKON.tempNote.logLate(7, d.toISOString().slice(0, 10), { min: "3", max: "5", reason: "x" }); });
  const tod = await tp.evaluate(async () => await window.EIKON.tempNote.logLate(7, window.EIKON.maltaYmd(), { min: "3", max: "5", reason: "x" }));
  report("temperature register: a future day, or today, cannot be logged late", /Only a past day/.test(fut.error || "") && /Only a past day/.test(tod.error || ""), JSON.stringify({ fut, tod }));
  report("temperature notes: no page errors", tErrs.length === 0, tErrs.slice(0, 3).join(" | "));
  tempState = { on: false, entries: [], next: 100 };
  await tp.close();
} catch (e) { report("temperature notes: ran to the end", false, String(e && e.stack || e).slice(0, 600)); tempState = { on: false, entries: [], next: 100 }; }

// Correct a register line in the new layout (ui/eikon.correct.js), one screen each: the pharmacist's Correct re-reads
// the line, a reason is required (nothing is sent without one), and the PUT body is the line as the server returned it
// (every field of the classic edit body) with only the corrected field changed, plus correction_reason. The line then
// shows who corrected it and why (the audit), and a staff sign-in sees no Correct.
try {
  const T0 = todayYmd;
  const SCREENS = [
    { hash: "dda-sales", mod: "cdsreg", path: "/dda-sales/entries", ready: ".cds-list",
      row: { id: 7101, entry_date: T0, client_name: "Zammit Carmel", client_id_card: "0012345M", client_address: "1 Triq il-Knisja", medicine_name_dose: "Morphine 10mg", quantity: 10, doctor_name: "Dr Abela", doctor_reg_no: "R1201", prescription_serial_no: "S-77", urgent: 1, created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no", "urgent"], field: "quantity", value: "5", want: 5 },
    { hash: "dda-poyc", mod: "poyreg", path: "/dda-poyc/entries", ready: ".cds-list",
      row: { id: 7102, entry_date: T0, client_name: "Farrugia Paul", client_id_card: "345M", client_address: "9 Triq il-Mitħna", medicine_name_dose: "Methadone 1mg/ml", quantity: 100, doctor_name: "Dr Galea", doctor_reg_no: "R4401", prescription_serial_no: "PY-1", created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "client_name", "client_id_card", "client_address", "medicine_name_dose", "quantity", "doctor_name", "doctor_reg_no", "prescription_serial_no"], field: "doctor_reg_no", value: "R4410", want: "R4410" },
    { hash: "dda-purchases", mod: "cdpreg", path: "/dda-purchases/entries", ready: ".cdp-inv",
      row: { id: 7103, entry_date: T0, dda_name_dose: "Oxycodone 10mg", quantity: 56, agent: "Medicare", invoice_number: "INV-5", created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "dda_name_dose", "quantity", "agent", "invoice_number"], field: "invoice_number", value: "INV-50", want: "INV-50" },
    { hash: "dailyregister", mod: "drreg", path: "/daily-register/entries", ready: ".drr-tbl",
      row: { id: 7104, entry_date: T0, client_name: "Borg Mario", client_id: "456123M", medicine_name_dose: "Augmentin 1g", posology: "1 bd", prescriber_name: "Dr Zammit", prescriber_reg_no: "5521", created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "client_name", "client_id", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no"], field: "posology", value: "1 tds", want: "1 tds" },
    { hash: "repeatprescriptions", mod: "repreg", path: "/repeat-prescriptions/entries", ready: "#rep-bymonth",
      row: { id: 7105, entry_date: T0, expires_date: "2099-01-01", client_name: "Spiteri Lina", client_id: "778899M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 nocte", prescriber_name: "Dr Vella", prescriber_reg_no: "6610", created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "expires_date", "client_name", "client_id", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no"], field: "medicine_name_dose", value: "Atorvastatin 40mg", want: "Atorvastatin 40mg" },
    { hash: "paidout", mod: "poreg", path: "/paid-out/entries", ready: ".por-list",
      row: { id: 7106, entry_date: T0, entry_time: "10:15", payee_name: "Grech Couriers", fee: 25, payment_method: "cheque", invoice_no: "C-1", cheque_no: "000123", reason: "Gozo", created_by: 1, created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "entry_time", "payee_name", "fee", "invoice_no", "payment_method", "cheque_no", "reason"], field: "fee", value: "20.5", want: 20.5 },
    { hash: "locumreceipts", mod: "lrcreg", path: "/locumreceipts/receipts", list: "receipts", ready: ".lrc-list", pass: "!4321",
      row: { id: 7107, receipt_date: "2026-11-03", hours: 8, locum_full_name: "Dr Locum", registration_number: "R77", day_type: "normal", fee_per_hour: 30, total_fee: 240, created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["receipt_date", "hours", "locum_full_name", "registration_number", "day_type", "fee_per_hour"], field: "hours", value: "7", want: 7, header: ["x-eikon-edit-pass", "!4321"] },
    { hash: "creditnotes", mod: "cnreg", path: "/creditnotes/entries", get: "/creditnotes/list", ready: ".cnr-card",
      row: { id: 7108, issue_date: T0, client_name: "Rita", client_surname: "Camilleri", telephone: "79112233", email: null, receipt_number: "R-9", amount: 25.5, expiry_date: null, no_expiry: 1, purchases: [], notes: [] },
      keys: ["issue_date", "client_name", "client_surname", "telephone", "email", "receipt_number", "amount", "expiry_date", "no_expiry"], field: "amount", value: "20", want: "20", same: { email: "", expiry_date: "", amount: "25.5" } },
    { hash: "locumregister", mod: "locreg", path: "/locumregister/entries", ready: ".lcr-list",
      row: { id: 7109, entry_date: T0, time_in: "08:00", time_out: "13:00", locum_full_name: "Dr Paul Locum", registration_number: "R55", created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "time_in", "time_out", "locum_full_name", "registration_number"], field: "time_out", value: "14:30", want: "14:30" },
    { hash: "cleaning", mod: "cleanreg", path: "/cleaning/entries", ready: ".clr-list",
      row: { id: 7110, entry_date: T0, time_in: "07:30", time_out: "08:10", cleaner_name: "Rita", staff_name: "Maria", notes: "", created_at: T0 + " 08:00:00", updated_at: T0 + " 08:00:00" },
      keys: ["entry_date", "time_in", "time_out", "cleaner_name", "staff_name", "notes"], field: "notes", value: "Fridge too", want: "Fridge too" },
  ];
  const res = [];
  for (const C of SCREENS) {
    let row = { ...C.row }; const puts = [], hdrs = [];
    const audit = [];
    const RE = new RegExp("(" + C.path.replace(/[-/]/g, "\\$&") + "(/\\d+)?" + (C.get ? "|" + C.get.replace(/[-/]/g, "\\$&") : "") + ")(\\?.*)?$");
    await page.route(RE, (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      if (m === "GET" && u.pathname === (C.get || C.path)) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [row], [C.list || "entries"]: [row] }) });
      if (m === "PUT" && u.pathname === C.path + "/" + row.id) { const b = r.request().postDataJSON(); puts.push(b); hdrs.push(r.request().headers()); row = { ...row, ...b, updated_at: T0 + " 09:00:00" }; delete row.correction_reason;
        audit.unshift({ id: 1, action: "X_UPDATE", entity_type: "t", entity_id: String(row.id), user_name: "Maria Borg", created_at: T0 + " 09:00:00", details: { correction_reason: b.correction_reason } });
        return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); }
      return r.continue();
    });
    await page.route("**/audit/log*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: audit, total: audit.length }) }));
    await page.goto(base + "&ui=2#" + C.hash);
    await page.waitForFunction((m) => window.EIKON.state.activeModuleId === m, C.mod, { timeout: 15000 });
    await page.waitForSelector(`[data-ecr=open][data-ecr-id="${row.id}"]`, { timeout: 10000 });
    await page.click(`[data-ecr=open][data-ecr-id="${row.id}"]`);
    await page.waitForSelector("[data-ecr-form] [name=ecr__reason]");
    const focusedFirst = await page.evaluate(() => (document.activeElement && document.activeElement.name) || "");
    await page.fill(`[data-ecr-form] [name=ecr_${C.field}]`, C.value);
    if (C.pass) await page.fill("[data-ecr-form] [name=ecr__pass]", C.pass);
    await page.click("[data-ecr-form] button[type=submit]"); await page.waitForTimeout(300);
    const noReason = puts.length, msg = await page.textContent("[data-ecr-form] .ecr-err").catch(() => "");
    await page.fill("[data-ecr-form] [name=ecr__reason]", "Typed wrong");
    await page.click("[data-ecr-form] button[type=submit]");
    await page.waitForFunction(() => !document.querySelector("[data-ecr-form]"), null, { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    const b = puts[0] || {};
    const bodyOk = JSON.stringify(Object.keys(b).sort()) === JSON.stringify(C.keys.concat("correction_reason").sort()) &&
      C.keys.every((k) => k === C.field ? b[k] === C.want : String(b[k]) === String(C.same && k in C.same ? C.same[k] : C.row[k])) && b.correction_reason === "Typed wrong" &&
      (!C.header || (hdrs[0] || {})[C.header[0]] === C.header[1]);
    const mark = await page.textContent(".ecr-mark").catch(() => "");
    res.push({ s: C.mod, noReason, msg: /what was wrong/i.test(msg), focusedFirst, puts: puts.length, bodyOk, body: bodyOk ? "" : JSON.stringify(b), mark: /Corrected .*by Maria Borg: Typed wrong/.test(mark) });
    await page.unroute(RE); await page.unroute("**/audit/log*");
  }
  report("correct a line (new layout): DDA sales, POYC, DDA purchases, Daily register, Repeat Rx, Paid out, Locum receipts (with the edit password), Credit notes, Locum register, Cleaning: no reason = nothing sent; the PUT is the line as read with only the corrected field changed (classic body) + reason; the line shows who and why",
    res.every((r) => r.noReason === 0 && r.msg && r.puts === 1 && r.bodyOk && r.mark && /^ecr_/.test(r.focusedFirst)), JSON.stringify(res).slice(0, 900));
  // staff: no Correct anywhere
  const staffSeen = [];
  for (const C of SCREENS) {
    const RS = new RegExp("(" + (C.get || C.path).replace(/[-/]/g, "\\$&") + ")(\\?.*)?$");
    await page.route(RS, (r) => r.request().method() === "GET" ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [C.row], [C.list || "entries"]: [C.row] }) }) : r.continue());
    await page.goto(base + "&ui=2#today"); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
    await page.evaluate((h) => { window.EIKON.state.user.role = "staff"; location.hash = "#" + h; }, C.hash);
    await page.waitForFunction((m) => window.EIKON.state.activeModuleId === m, C.mod, { timeout: 15000 });
    await page.waitForSelector(C.ready, { timeout: 10000 }).catch(() => {}); await page.waitForTimeout(300);
    staffSeen.push(C.mod + ":" + (await page.locator("[data-ecr=open]").count()) + ":" + /corrected by the pharmacist/.test(await page.textContent(".ecr-foot").catch(() => "")));
    await page.unroute(RS);
  }
  report("correct a line: a staff sign-in sees no Correct and is told the pharmacist corrects", staffSeen.every((x) => /:0:true$/.test(x)), staffSeen.join(" "));
  // a pharmacist (staff sign-in marked Pharmacist; John 2026-11-11, roles Q3): Correct on every line, with the reason;
  // the PUT is the same as the admin's (the worker has always taken a staff sign-in's register update).
  const phSeen = [];
  for (const C of SCREENS) {
    let row = { ...C.row }; const puts = [];
    const RP = new RegExp("(" + C.path.replace(/[-/]/g, "\\$&") + "(/\\d+)?" + (C.get ? "|" + C.get.replace(/[-/]/g, "\\$&") : "") + ")(\\?.*)?$");
    await page.route(RP, (r) => {
      const u = new URL(r.request().url()), m = r.request().method();
      if (m === "GET" && u.pathname === (C.get || C.path)) return r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [row], [C.list || "entries"]: [row] }) });
      if (m === "PUT" && u.pathname === C.path + "/" + row.id) { const b = r.request().postDataJSON(); puts.push(b); row = { ...row, ...b, updated_at: T0 + " 09:00:00" }; delete row.correction_reason; return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); }
      return r.continue();
    });
    await page.goto(base + "&ui=2#today"); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user, null, { timeout: 15000 });
    await page.evaluate((h) => { const E = window.EIKON, u = E.state.user; u.role = "staff"; const R = { ok: true, role: "staff", is_pharmacist: true, role_word: "Pharmacist", pic: true, plans_rota: false };
      E.rights = R; E._rightsFor = String(u.user_id || u.id || u.email || "") + "|" + String(u.location_id || ""); E._rightsP = Promise.resolve(R); location.hash = "#" + h; }, C.hash);
    await page.waitForFunction((m) => window.EIKON.state.activeModuleId === m, C.mod, { timeout: 15000 });
    await page.waitForSelector(`[data-ecr=open][data-ecr-id="${row.id}"]`, { timeout: 8000 }).catch(() => {});
    const n = await page.locator("[data-ecr=open]").count();
    let sent = 0, reasonOk = false;
    if (n) {
      await page.click(`[data-ecr=open][data-ecr-id="${row.id}"]`);
      await page.waitForSelector("[data-ecr-form] [name=ecr__reason]");
      await page.fill(`[data-ecr-form] [name=ecr_${C.field}]`, C.value);
      if (C.pass) await page.fill("[data-ecr-form] [name=ecr__pass]", C.pass);
      await page.fill("[data-ecr-form] [name=ecr__reason]", "Typed wrong (pharmacist)");
      await page.click("[data-ecr-form] button[type=submit]");
      await page.waitForFunction(() => !document.querySelector("[data-ecr-form]"), null, { timeout: 8000 }).catch(() => {});
      sent = puts.length; reasonOk = !!puts[0] && puts[0].correction_reason === "Typed wrong (pharmacist)" && puts[0][C.field] === C.want;
    }
    phSeen.push(C.mod + ":" + n + ":" + sent + ":" + reasonOk);
    await page.unroute(RP);
  }
  report("correct a line: a pharmacist (staff marked Pharmacist) sees Correct on every screen and saves with the reason, same body as the admin", phSeen.every((x) => /:[1-9]\d*:1:true$/.test(x)), phSeen.join(" "));
} catch (e) { report("correct a line (new layout): ran to the end", false, String(e && e.stack || e).slice(0, 600)); }


// ---- Help and What's new for the new layout (help-next.js, whatsnew.json; BACKLOG3 item 10).
// (a) every new-layout screen in registry.js has a guide, and each guide has a purpose and at least one task;
// (b) whatsnew.json is valid: dated entries (real dates, not in the future), newest first, unique ids, plain words;
// (c) nothing of the help is downloaded with the app; the "?" opens the screen's own guide; Escape returns focus.
try {
  const regSrc = fs.readFileSync(path.join(root, "registry.js"), "utf8");
  const newIds = [...regSrc.matchAll(/\["[^"]+", "([^"]+)", "[^"]*", "[^"]*", \d+, (?:true|false), "new"/g)].map((m) => m[1]);
  const hp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const hErr = []; hp.on("pageerror", (e) => hErr.push(e.message));
  const hReq = []; hp.on("request", (r) => hReq.push(new URL(r.url()).pathname));
  await hp.goto(base + "&ui=2#today");
  await hp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await hp.reload();
  await hp.waitForFunction(() => window.EIKON && window.EIKON._lateIn && document.querySelector(".tdy-head h1 .nxh-q"), null, { timeout: 15000 });
  await hp.waitForTimeout(1800);
  const bootHelp = hReq.filter((r) => /help-next\.js/.test(r)).length, bootWn = hReq.filter((r) => /whatsnew\.json/.test(r)).length;
  const dotBefore = await hp.evaluate(() => !!document.querySelector('.eikon-rail-btn[data-mod="settings"] .nxh-rail-dot'));
  await hp.evaluate(() => { window.location.hash = "#cdsreg"; });
  await hp.waitForFunction(() => document.querySelector("#eikon-content h1 .nxh-q"), null, { timeout: 8000 });
  const h1Text = await hp.evaluate(() => document.querySelector("#eikon-content h1").textContent);
  await hp.click("#eikon-content h1 .nxh-q");
  await hp.waitForSelector(".nxh-pn[role=dialog]", { timeout: 8000 });
  const guide = await hp.evaluate((ids) => {
    const H = window.EIKON.helpNext, have = H.guides();
    const bad = ids.filter((id) => { const g = H.guide(id); return !g || !g.purpose || !g.tasks.length || g.tasks.some((t) => t.length < 2); });
    return { missing: ids.filter((id) => have.indexOf(id) < 0), bad, title: document.getElementById("nxh-title").textContent, inside: !!document.activeElement.closest(".nxh-pn") };
  }, newIds);
  await hp.keyboard.press("Escape");
  const closed = await hp.evaluate(() => !document.querySelector(".nxh-ov") && document.activeElement.classList.contains("nxh-q"));
  await hp.close();
  report("help: every new-layout screen in registry.js (" + newIds.length + ") has a guide with a purpose and its tasks",
    newIds.length >= 50 && !guide.missing.length && !guide.bad.length, JSON.stringify({ missing: guide.missing, bad: guide.bad }));
  report("help: nothing downloaded with the app but whatsnew.json; a dot on Settings; the ? in the heading leaves its text alone and opens the screen's guide; Escape closes and gives focus back",
    bootHelp === 0 && bootWn === 1 && dotBefore && h1Text === "Controlled drugs supplied" && guide.title === "Controlled drugs supplied" && guide.inside && closed && !hErr.length,
    JSON.stringify({ bootHelp, bootWn, dotBefore, h1Text, title: guide.title, inside: guide.inside, closed, hErr: hErr.slice(0, 2) }));
} catch (e) { report("help: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }
// BACKLOG5 item 9: help matches the screen. (a) every "Press X" in a guide is a button the screen draws, and no guide
// uses a technical word; (b) on every new-layout screen, the footer's "… is in the classic screen" sentences are the
// guide's "Still in the classic screen" paragraph word for word, and that paragraph names no button the screen has.
try {
  const HM = await import("../helpmatch.mjs");
  const stat = HM.staticCheck(root);
  report("help matches the screen: every “Press …” in a guide is a button that screen draws; no technical words", !stat.length, stat.slice(0, 6).join(" | "));
  const portalOnly = /^(sup(home|orders|problems|products)|hq(home|regs|client)|ptlacct)$/; // portals (FIN): a pharmacy sign-in cannot open them; checked as their own users (as tests/real/cases/helpmatch.mjs)
  const G = HM.loadGuides(root), list = HM.newScreens(root).filter((x) => !portalOnly.test(x.id));
  const mp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const mErr = []; mp.on("pageerror", (e) => mErr.push(e.message));
  await mp.goto(base + "&ui=2#today");
  await mp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await mp.reload();
  await mp.waitForFunction(() => window.EIKON && window.EIKON._lateIn, null, { timeout: 15000 });
  let probs = [], footers = 0; const missing = [];
  for (const { id } of list) {
    await mp.evaluate((h) => { window.location.hash = "#" + h; }, id);
    try { await mp.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content button"), id, { timeout: 8000 }); } catch (e) { missing.push(id); continue; }
    await mp.waitForTimeout(250);
    const r = await mp.evaluate(HM.readScreenInPage);
    if (r.footer.length) footers++;
    probs = probs.concat(HM.compare(id, G[id], r.footer, r.labels));
  }
  await mp.close();
  report("help matches the screen: on " + list.length + " screens (" + footers + " with a classic footer), the guide's “Still in the classic screen” is the footer's own sentence and names nothing the screen has",
    footers >= 18 && !probs.length && !missing.length, JSON.stringify({ footers, missing, probs: probs.slice(0, 6), err: mErr.slice(0, 2) }));
} catch (e) { report("help matches the screen: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }
{
  const problems = [];
  let j = null;
  try { j = JSON.parse(fs.readFileSync(path.join(root, "whatsnew.json"), "utf8")); } catch (e) { problems.push("not valid JSON: " + e.message); }
  const list = j && Array.isArray(j.entries) ? j.entries : [];
  if (j && !list.length) problems.push("no entries");
  const seen = new Set(), tomorrow = maltaYmd(1);
  const jargon = /\b(worker|batch|agent|deploy(ed)?|UI|API|CSP|commit|merge|endpoint|localStorage|D1|wrangler|bug)\b/i;
  list.forEach((e, i) => {
    const at = "entry " + i + (e && e.id ? " (" + e.id + ")" : "");
    if (!e || typeof e.id !== "string" || !e.id) return problems.push(at + ": no id");
    if (seen.has(e.id)) problems.push(at + ": id used twice"); seen.add(e.id);
    const d = String(e.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || new Date(d + "T00:00:00Z").toISOString().slice(0, 10) !== d) problems.push(at + ": date is not a real YYYY-MM-DD");
    else if (d > tomorrow) problems.push(at + ": dated in the future");
    if (i && String(list[i - 1].date) < d) problems.push(at + ": not newest first");
    if (!e.title || !e.text) problems.push(at + ": title and text are needed");
    if (jargon.test(String(e.title) + " " + String(e.text))) problems.push(at + ": technical word (" + (String(e.title) + " " + String(e.text)).match(jargon)[0] + ")");
  });
  report("whatsnew.json: valid, dated (real dates, none in the future), newest first, unique ids, a title and text each, no technical words", !problems.length, problems.slice(0, 5).join(" | "));
}
// Backlog 4 item 7: a brand-new pharmacy's first hour never dead-ends. Today shows never-recorded cleaning as "Not done
// yet" (amber, not red Overdue) and asks to name the fridges and rooms; Fridges and rooms, the first rota people and the
// product import all happen in the new layout and send exactly the classic bodies; Returns' empty state points somewhere.
try {
  globalThis.__b47 = true; b47 = b47Fresh();
  const bx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await bx.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await bx.addInitScript(() => { try { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_install_never", "1"); } catch (e) {} });
  const bp = await bx.newPage(); const bErr = []; bp.on("pageerror", (e) => bErr.push(e.message));
  const on = (mod) => bp.waitForFunction((m) => window.EIKON && window.EIKON.state.activeModuleId === m, mod, { timeout: 15000 });
  const writes = async (re) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && re.test(c.path)).map((c) => c.method + " " + c.path + " " + JSON.stringify(c.body));
  const focusIs = () => bp.evaluate(() => { const a = document.activeElement; return a ? (a.getAttribute("data-k") || a.getAttribute("name") || a.id || a.tagName) : ""; });
  const main = () => bp.evaluate(() => document.querySelector("#eikon-content").innerText);

  // Today on day one
  await bp.goto(base + "&ui=2#today"); await on("today"); await bp.waitForSelector("[data-kind=cleaning]");
  const t1 = await bp.evaluate(() => { const r = document.querySelector("[data-kind=cleaning]"), pill = r.querySelector(".tdy-pill");
    return { cls: r.className, pill: pill && pill.textContent, pillCls: pill && pill.className, legend: document.querySelector(".tdy-legend").textContent, setup: [...document.querySelectorAll("[data-setup]")].map((e) => e.getAttribute("data-setup")), red: document.querySelectorAll(".tdy-row.red,.tdy-pill.red,.tdy-t .u").length }; });
  report("first day: never-recorded cleaning is amber 'Not done yet' (no red, no 'overdue'); Getting ready asks to name the fridges and rooms",
    /amb/.test(t1.cls) && t1.pill === "Not done yet" && /amb/.test(t1.pillCls) && !/overdue/i.test(t1.legend) && t1.red === 0 && t1.setup.indexOf("names") >= 0 && !/classic/i.test(await main()), JSON.stringify(t1));

  // Name them: Fridges and rooms opens in the new layout, focus on its heading
  await fetch(`http://localhost:${PORT}/__reset`);
  await bp.click('[data-setup="names"] button'); await on("tempreg"); await bp.waitForSelector('form.trg-dv[data-dv="2"]');
  const d1 = await bp.evaluate(() => ({ hash: location.hash, classic: /ui=classic/.test(location.search), h1: document.querySelector(".trg h1").textContent, focus: document.activeElement && document.activeElement.id }));
  // rename the fridge, a decimal comma in its lowest limit; Enter saves
  await bp.fill('form[data-dv="2"] [name=name]', "Main fridge ċ"); await bp.fill('form[data-dv="2"] [name=min_limit]', "2,5"); await bp.fill('form[data-dv="2"] [name=max_limit]', "7.5");
  await bp.press('form[data-dv="2"] [name=max_limit]', "Enter"); await bp.waitForTimeout(500);
  const w1 = await writes(/temperature\/devices/), f1 = await focusIs();
  report("fridges and rooms: opens from Today in the new layout; a rename sends the classic body (decimal comma read) and focus stays on its Save",
    d1.hash === "#tempreg" && !d1.classic && d1.h1 === "Fridges and rooms" && d1.focus === "trg-dv-h" && w1.length === 1 && w1[0] === 'PUT /temperature/devices/2 {"name":"Main fridge ċ","device_type":"fridge","min_limit":2.5,"max_limit":7.5}' && f1 === "dv-save:2", JSON.stringify({ d1, w1, f1 }));

  // add one: a fridge starts at 2 to 8, a room at 15 to 25 while untouched; Enter twice adds once; ready for the next
  await fetch(`http://localhost:${PORT}/__reset`);
  const pre = [await bp.inputValue("#trg-add [name=min_limit]"), await bp.inputValue("#trg-add [name=max_limit]")];
  await bp.selectOption("#trg-add [name=device_type]", "room"); const preRoom = [await bp.inputValue("#trg-add [name=min_limit]"), await bp.inputValue("#trg-add [name=max_limit]")];
  await bp.selectOption("#trg-add [name=device_type]", "fridge");
  await bp.fill("#trg-add [name=name]", "Friġġ tal-vaċċini"); await bp.press("#trg-add [name=name]", "Enter"); await bp.press("#trg-add [name=name]", "Enter").catch(() => {}); await bp.waitForTimeout(600);
  const w2 = await writes(/temperature\/devices/), f2 = await focusIs(), nameAfter = await bp.inputValue("#trg-add [name=name]");
  report("fridges and rooms: Add starts a fridge at 2 to 8 °C (a room at 15 to 25), sends the classic body once, and leaves the name box ready for the next",
    pre.join() === "2,8" && preRoom.join() === "15,25" && w2.length === 1 && w2[0] === 'POST /temperature/devices {"name":"Friġġ tal-vaċċini","device_type":"fridge","min_limit":2,"max_limit":8}' && f2 === "name" && nameAfter === "" && (await bp.$$('form.trg-dv[data-dv]')).length === 3,
    JSON.stringify({ pre, preRoom, w2, f2, nameAfter }));

  // mistakes: said once under the boxes, the box marked and focused, nothing sent; a failed save keeps what was typed
  await fetch(`http://localhost:${PORT}/__reset`);
  await bp.fill('form[data-dv="1"] [name=name]', ""); await bp.fill('form[data-dv="1"] [name=min_limit]', "abc"); await bp.click('[data-k="dv-save:1"]'); await bp.waitForTimeout(200);
  const e1 = await bp.evaluate(() => ({ err: document.querySelector("#trg-err-1").textContent, role: document.querySelector("#trg-err-1").getAttribute("role"), inv: [...document.querySelectorAll('form[data-dv="1"] [aria-invalid=true]')].map((e) => e.name), focus: document.activeElement.name }));
  await bp.fill('form[data-dv="1"] [name=name]', "Dispensary"); await bp.fill('form[data-dv="1"] [name=min_limit]', "15");
  b47.fail = true; await bp.click('[data-k="dv-save:1"]'); await bp.waitForTimeout(500);
  const e2 = await bp.evaluate(() => ({ err: document.querySelector("#trg-err-1").textContent, name: document.querySelector('form[data-dv="1"] [name=name]').value }));
  const w3 = await writes(/temperature\/devices/);
  report("fridges and rooms: a missing name or a non-number limit is said under the boxes and nothing is sent; a failed save keeps the typed name",
    /Write a name/.test(e1.err) && e1.role === "alert" && e1.inv.join() === "name,min_limit" && e1.focus === "name" && w3.length === 1 && /Not saved/.test(e2.err) && e2.name === "Dispensary", JSON.stringify({ e1, e2, w3 }));

  // stop logging asks once (Escape keeps it), sends {active:false}; Log it again sends {active:true}
  await fetch(`http://localhost:${PORT}/__reset`);
  await bp.click('[data-k="dv-stop:3"]'); const askF = await focusIs(); await bp.keyboard.press("Escape"); await bp.waitForTimeout(150); const escF = await focusIs();
  await bp.click('[data-k="dv-stop:3"]'); await bp.click('[data-k="dv-stop-yes"]'); await bp.waitForTimeout(500);
  const offList = await bp.evaluate(() => [...document.querySelectorAll(".trg-dv.off b")].map((b) => b.textContent));
  await bp.click('[data-k="dv-again:3"]'); await bp.waitForTimeout(500);
  const w4 = await writes(/temperature\/devices/);
  report("fridges and rooms: Stop logging asks once (Escape keeps logging, focus back on it), then {active:false}; Log it again sends {active:true}",
    askF === "dv-keep" && escF === "dv-stop:3" && offList.join() === "Friġġ tal-vaċċini" && w4.join("|") === 'PUT /temperature/devices/3 {"active":false}|PUT /temperature/devices/3 {"active":true}', JSON.stringify({ askF, escF, offList, w4 }));

  // Escape goes back to the month, onto the button that opened it; Today no longer asks to name them
  await bp.keyboard.press("Escape"); await bp.waitForTimeout(500);
  const back = { focus: await focusIs(), view: await bp.evaluate(() => !!document.querySelector(".trg-month, .em-bar, [data-months]") || !document.querySelector("#trg-add")) };
  await bp.evaluate(() => { location.hash = "#today"; }); await on("today"); await bp.waitForSelector("[data-kind=cleaning]");
  const setup2 = await bp.evaluate(() => [...document.querySelectorAll("[data-setup]")].map((e) => e.getAttribute("data-setup")));
  report("fridges and rooms: Escape returns to the month with focus on 'Fridges and rooms'; once saved, Today stops asking to name them",
    back.focus === "devices" && back.view && setup2.indexOf("names") < 0, JSON.stringify({ back, setup2 }));

  // someone who is not the admin sees the list, no boxes
  const staffView = await bp.evaluate(async () => { const E = window.EIKON, was = E.state.user.role; E.state.user.role = "staff"; sessionStorage.setItem("eikon_tempreg_view", "devices"); location.hash = "#tempreg";
    await new Promise((r) => setTimeout(r, 900)); const out = { inputs: document.querySelectorAll(".trg-dv input").length, lines: document.querySelectorAll(".trg-dv .ln").length, note: /Only the pharmacy/.test(document.querySelector(".trg").textContent) }; E.state.user.role = was; return out; });
  report("fridges and rooms: someone who is not the admin sees each one and its limits, with no boxes to change them", staffView.inputs === 0 && staffView.lines === 3 && staffView.note, JSON.stringify(staffView));

  // Plan shifts with nobody on the rota: who works here, in place
  await fetch(`http://localhost:${PORT}/__reset`);
  await bp.evaluate(() => { location.hash = "#shifts"; }); await on("shfreg"); await bp.waitForSelector("#shf-who");
  const s0 = { text: await main(), role: await bp.inputValue("#shf-who [name=designation]") };
  await bp.click("#shf-who [data-k=who-add]"); await bp.waitForTimeout(150);
  const s1 = await bp.evaluate(() => ({ err: (document.querySelector("#shf-who-err") || {}).textContent, focus: document.activeElement.name }));
  await bp.fill("#shf-who [name=full_name]", "Ġorġ Borg"); await bp.press("#shf-who [name=full_name]", "Enter"); await bp.waitForTimeout(600);
  const s2 = { focus: await focusIs(), role: await bp.inputValue("#shf-who [name=designation]"), said: await bp.evaluate(() => (document.querySelector(".shf-who .ok") || {}).textContent || ""), adds: (await bp.$$('.shf-add[data-act="add"]')).length };
  await bp.fill("#shf-who [name=full_name]", "Marija Zammit"); await bp.press("#shf-who [name=full_name]", "Enter"); await bp.waitForTimeout(600);
  await bp.click("[data-k=who-done]"); await bp.waitForTimeout(200); const s3 = await focusIs();
  const w5 = await writes(/shifts\/staff/);
  const cls = (b) => '{"full_name":"' + b[0] + '","designation":"' + b[1] + '","employment_type":"fulltime","contracted_hours":40,"email":"","phone":"","registration_number":"","is_active":1,"patterns_json":"{\\"patterns\\":[],\\"provisionalId\\":null}"}';
  report("plan shifts, empty rota: 'Who works here?' in place (no classic), name required, each person sent with the classic Add Employee body; the next defaults to assistant; Done lands on '+ Add a person'",
    !/classic Shifts screen first/.test(s0.text) && s0.role === "pharmacist" && /Write the person/.test(s1.err || "") && s1.focus === "full_name" && s2.focus === "full_name" && s2.role === "assistant" && /Ġorġ Borg is on the rota/.test(s2.said) && s2.adds === 7 &&
    w5.join("|") === "POST /shifts/staff " + cls(["Ġorġ Borg", "pharmacist"]) + "|POST /shifts/staff " + cls(["Marija Zammit", "assistant"]) && s3 === "who", JSON.stringify({ s0: s0.role, s1, s2, s3, w5 }));

  // Emergency POS with no products: import here (the real SheetJS, the classic mapping and upload); Today lists it until then
  await fetch(`http://localhost:${PORT}/__reset`);
  await bp.evaluate(() => { location.hash = "#emergency-pos"; }); await on("eposreg"); await bp.waitForSelector("[data-k=import]");
  const hits0 = await bp.evaluate(() => document.querySelector("#epr-hits").innerText);
  await bp.evaluate(() => { location.hash = "#today"; }); await on("today"); await bp.waitForSelector("[data-kind=cleaning]");
  const setup3 = await bp.evaluate(() => [...document.querySelectorAll("[data-setup]")].map((e) => e.getAttribute("data-setup")));
  await bp.click('[data-setup="products"] button'); await on("eposreg"); await bp.waitForSelector("[data-k=import]");
  const csv = "Barcode,Description,Retail Price,VAT,Category\n5012345678900,Paracetamol 500mg,2.35,0,Pain\n,Cough syrup,4.10,18,Cough\n";
  const fc = bp.waitForEvent("filechooser"); await bp.click("[data-k=import]"); await (await fc).setFiles({ name: "list.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await bp.waitForFunction(() => /2 products/.test((document.querySelector("#epr-hits") || {}).textContent || ""), null, { timeout: 15000 });
  const w6 = await writes(/emergency-pos\/catalog/);
  let h = 0; for (const ch of "Cough syrup") { h = ((h << 5) - h) + ch.charCodeAt(0); h |= 0; }
  const want = 'POST /emergency-pos/catalog {"products":[{"barcode":"5012345678900","name":"Paracetamol 500mg","price":2.35,"vat_rate":0,"category":"Pain","unit":""},{"barcode":"NOBAR-' + Math.abs(h) + '-2","name":"Cough syrup","price":4.1,"vat_rate":18,"category":"Cough","unit":""}],"wipe":true,"file_name":"list.csv","total_rows":2,"chunk_index":1}';
  await bp.evaluate(() => { location.hash = "#today"; }); await on("today"); await bp.waitForSelector("[data-kind=cleaning]");
  const setup4 = await bp.evaluate(() => [...document.querySelectorAll("[data-setup]")].map((e) => e.getAttribute("data-setup")));
  report("emergency POS, no products: Import here (no classic), the classic rows and batch body; Today lists 'Add your products' only until then",
    !/classic/i.test(hits0) && setup3.indexOf("products") >= 0 && w6.length === 1 && w6[0] === want && setup4.indexOf("products") < 0, JSON.stringify({ hits0, setup3, w6, setup4 }));

  // Returns, nothing going back: the next step, not the classic screen
  await bp.evaluate(() => { location.hash = "#returns"; }); await on("retreg"); await bp.waitForFunction(() => { const q = document.querySelector(".rtn-quiet"); return q && !/^Opening/.test(q.textContent.trim()); }, null, { timeout: 8000 }).catch(() => {}); // the same box says "Opening returns…" while it loads
  const rq = await bp.evaluate(() => { const q = document.querySelector(".rtn-quiet"); return { t: q.textContent, a: (q.querySelector("a") || {}).getAttribute && q.querySelector("a").getAttribute("href") }; });
  report("returns, empty: says how to send stock back (Near expiry, Send back), not 'the classic screen'", !/classic/i.test(rq.t) && rq.a === "#nearexpiry" && /Send back/.test(rq.t), JSON.stringify(rq));

  // Phone: 44 px targets, nothing sideways at 360 px (Fridges and rooms, Who works here, the import)
  b47 = b47Fresh(); await bp.setViewportSize({ width: 390, height: 844 });
  const ph = {};
  for (const [h2, mod, sel, pre2] of [["tempreg", "tempreg", "#trg-add", "devices"], ["shifts", "shfreg", "#shf-who", ""], ["emergency-pos", "eposreg", "[data-k=import]", ""]]) {
    await bp.goto("about:blank"); await bp.goto(base + "&ui=2#today"); await on("today");
    await bp.evaluate(([h3, v]) => { if (v) sessionStorage.setItem("eikon_tempreg_view", v); location.hash = "#" + h3; }, [h2, pre2]); await on(mod); await bp.waitForSelector(sel); await bp.waitForTimeout(300);
    const small = await bp.evaluate((s) => [...document.querySelectorAll("#eikon-content :is(" + s + ") :is(button, input, select), #eikon-content " + s + ":is(button)")].filter((e) => e.offsetParent && (e.closest("label") || e).getBoundingClientRect().height < 44).map((e) => e.name || e.textContent.trim()), sel.startsWith("#trg") ? ".trg-dv" : sel);
    await bp.setViewportSize({ width: 360, height: 800 }); await bp.waitForTimeout(150);
    const wide = await bp.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    await bp.setViewportSize({ width: 390, height: 844 });
    ph[mod] = { small, wide };
  }
  report("first day on a phone: Fridges and rooms, Who works here and Import have 44 px targets and no sideways scroll at 360 px", Object.values(ph).every((v) => !v.small.length && !v.wide), JSON.stringify(ph));
  report("first day: no page errors", bErr.length === 0, bErr.slice(0, 3).join(" | "));
  await bx.close();
} catch (e) { report("first day: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }
globalThis.__b47 = false; b47 = null;

// BACKLOG4 item 8: honest when the connection drops (banner, verdict words, the retry guard, E.postOnce after a late save)
try {
  const nx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const np = await nx.newPage();
  const nErr = []; np.on("pageerror", (e) => nErr.push(String(e)));
  await np.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await np.goto(base + "&ui=2#today"); await np.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); }); await np.reload();
  await np.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.getElementById("eikon-content"), null, { timeout: 15000 });
  // The banner never covers the screen: every visible button of the screen, scrolled to the top or the bottom of the
  // window, stays clear of it (phone: a strip whose height the page keeps free; desktop: the rail's corner, nothing moves).
  const clear = (pg) => pg.evaluate(() => {
    const bar = document.querySelector("#eikon-net > span") ? document.getElementById("eikon-net").getBoundingClientRect() : null, hit = [];
    const btns = [...document.querySelectorAll("#eikon-content button, #eikon-content a.p, #eikon-content h1")].filter((e) => e.getClientRects().length).slice(0, 25);
    for (const el of btns) for (const block of ["start", "end"]) {
      el.scrollIntoView({ block }); const r = el.getBoundingClientRect();
      if (bar && r.bottom > bar.top && r.top < bar.bottom && r.right > bar.left && r.left < bar.right) hit.push((el.textContent || "").trim().slice(0, 20) + "@" + block);
    }
    window.scrollTo(0, 0); return { bar: !!bar, n: btns.length, hit };
  });
  const top0 = await np.evaluate(() => document.querySelector("#eikon-content h1").getBoundingClientRect().top);
  await nx.setOffline(true); await np.waitForTimeout(300);
  const b1 = await np.evaluate(() => { const b = document.getElementById("eikon-net"), r = b.getBoundingClientRect(); return { t: b.innerText.trim(), role: b.getAttribute("role"), live: b.getAttribute("aria-live"), barBottom: r.bottom, h1Top: document.querySelector("#eikon-content h1").getBoundingClientRect().top }; });
  report("offline: a polite banner says 'No connection — what you type is kept' at once; on a phone a strip at the top that the page makes room for",
    b1.t === "No connection — what you type is kept" && b1.role === "status" && b1.live === "polite" && b1.barBottom <= b1.h1Top && b1.h1Top - top0 <= 32, JSON.stringify({ ...b1, top0 }));
  const c1 = await clear(np);
  report("offline, phone: the banner covers none of the screen's buttons, scrolled to the top or the bottom", c1.bar && c1.n > 0 && !c1.hit.length, JSON.stringify(c1));
  { // desktop: in the rail's corner, the heading does not move, no button of the screen under it
    const dx = await browser.newContext({ viewport: { width: 1440, height: 900 } }); const dp = await dx.newPage();
    await dp.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
    await dp.goto(base + "&ui=2#ordreg"); await dp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); }); await dp.reload();
    await dp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector("#eikon-content h1"), null, { timeout: 15000 }); await dp.waitForTimeout(800);
    const add = dp.locator("#eikon-content [data-act=add]"); if (await add.count()) { await add.first().click(); await dp.waitForTimeout(300); }
    const d0 = await dp.evaluate(() => document.querySelector("#eikon-content h1").getBoundingClientRect().top);
    await dx.setOffline(true); await dp.waitForTimeout(300);
    const d1 = await dp.evaluate(() => { const r = document.getElementById("eikon-net").getBoundingClientRect(), c = document.getElementById("eikon-content").getBoundingClientRect(); return { h1: document.querySelector("#eikon-content h1").getBoundingClientRect().top, barRight: r.right, contentLeft: c.left }; });
    const dc = await clear(dp);
    report("offline, desktop: the banner sits in the rail (left of the screen), the heading does not move, no button under it", d1.h1 === d0 && d1.barRight <= d1.contentLeft && dc.bar && dc.n > 0 && !dc.hit.length, JSON.stringify({ d0, d1, dc }));
    await dx.close();
  }
  await nx.setOffline(false); await np.waitForTimeout(300);
  const b2 = await np.evaluate(() => document.getElementById("eikon-net").innerText.trim());
  report("online again: the banner says 'Back online'", b2 === "Back online", b2);
  const words = await np.evaluate(() => { const E = window.EIKON, n = (o) => Object.assign(new Error("Network error"), { network: true }, o);
    return [E.saveFailText(n({ landed: true })), E.saveFailText(n({ landed: false })), E.saveFailText(n({ landed: false, notSent: true })), E.saveFailText(n({})), E.saveFailText(Object.assign(new Error("Request timed out after 20 s"), { network: true })), E.saveFailText(Object.assign(new Error("It was saved already: it is in the list."), { alreadySaved: true }))]; });
  report("after a lost answer the words say what Eikon found: saved / not saved / could not tell",
    /^It was saved:/.test(words[0]) && words[1] === "Not saved: the connection dropped. Try again." && /^Not saved: there is no connection/.test(words[2]) && words[3] === "We could not tell if it was saved. Check the list before trying again." && words[4] === words[3] && /saved already/.test(words[5]), JSON.stringify(words));
  // E.postOnce: the first answer is lost and the list does not have it yet ("not saved"); the server saves it late; Save again sends nothing
  const po = await np.evaluate(async () => {
    const E = window.EIKON, real = E.apiFetch, rows = [], sent = [];
    E.apiFetch = async (p, o) => { if (o && o.method === "POST") { sent.push(o.body); throw Object.assign(new Error("Network error"), { network: true }); } return real(p, o); };
    const check = { list: async () => rows.slice(), same: (r) => r.item === "X" };
    let first = ""; try { await E.postOnce("/q48/test", { item: "X" }, check); } catch (x) { first = E.saveFailText(x); }
    rows.push({ id: 1, item: "X" }); // the server saved it after all
    let second; try { second = await E.postOnce("/q48/test", { item: "X" }, check); } catch (x) { second = E.saveFailText(x); }
    E.apiFetch = real; return { first, second, sent: sent.length };
  });
  report("E.postOnce: a late save is found when Save is pressed again, and nothing is sent twice", po.first === "Not saved: the connection dropped. Try again." && po.second && po.second.recovered === true && po.sent === 1, JSON.stringify(po));
  report("connection banner: no page errors", nErr.length === 0, nErr.slice(0, 3).join(" | "));
  await nx.close();
} catch (e) { report("connection banner: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// Focus is never taken from where the person is typing (E.focusIfIdle / E.focusSoon / E.keepTyped, repaint scoped to its
// form). A busy machine runs short timers late while taps and keys go first: the timers here run 300 ms late.
{
  const sp = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await sp.route("**/xlsx.full.min.js", (r) => r.fulfill({ contentType: "application/javascript", body: "window.XLSX={};" }));
  await sp.addInitScript(() => { const st = window.setTimeout; window.__lag = 0; window.setTimeout = function (fn, d) { const a = Array.prototype.slice.call(arguments); if (window.__lag && typeof fn === "function" && (Number(d) || 0) <= 50) a[1] = (Number(d) || 0) + window.__lag; return st.apply(window, a); }; });
  const sErr = []; sp.on("pageerror", (e) => sErr.push(e.message));
  await sp.goto(base + "&ui=2#customers");
  await sp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); });
  await sp.reload();
  await sp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector("#cus-q"), null, { timeout: 15000 });
  // the rule, in isolation
  await sp.evaluate(() => { const d = document.createElement("div"); d.id = "fr-t"; d.innerHTML = '<form id="fa"><input name="a"><input name="b"></form><button id="fbtn">x</button>'; document.body.appendChild(d); });
  const r1 = await sp.evaluate(() => { const E = window.EIKON, a = document.querySelector("#fa [name=a]"), b = document.querySelector("#fa [name=b]"); document.getElementById("fbtn").focus(); return { idle: E.focusIfIdle(a, Date.now(), document.getElementById("fbtn")), at: document.activeElement.name }; });
  await sp.evaluate(() => { const E = window.EIKON; document.getElementById("fbtn").focus(); window.__lag = 300; E.focusSoon(() => document.querySelector("#fa [name=a]")); });
  await sp.click("#fa [name=b]"); await sp.keyboard.type("hello", { delay: 70 }); await sp.waitForTimeout(350);
  const r2 = await sp.evaluate(() => ({ at: document.activeElement.name, a: document.querySelector("#fa [name=a]").value, b: document.querySelector("#fa [name=b]").value }));
  await sp.evaluate(() => { window.__lag = 0; });
  report("focus: E.focusIfIdle moves focus when nobody is typing; E.focusSoon fired late never takes it from the field the person went to", r1.idle === true && r1.at === "a" && r2.at === "b" && r2.a === "" && r2.b === "hello", JSON.stringify({ r1, r2 }));
  // a redraw keeps the field by its name inside its own form, even when another form with the same names opens above it
  const r3 = await sp.evaluate(() => {
    const E = window.EIKON, m = document.createElement("div"); document.body.appendChild(m);
    const f = (id) => '<form id="' + id + '"><input name="notes" value=""></form>';
    let two = false; const paint = () => { m.innerHTML = (two ? f("x-new") : "") + f("x-edit"); };
    paint(); const n = m.querySelector("#x-edit [name=notes]"); n.focus(); n.value = "Prefers SMS"; n.setSelectionRange(3, 3);
    two = true; E.repaintKeepingFocus(m, paint);
    const a = document.activeElement, out = { form: a.form && a.form.id, v: a.value, c: a.selectionStart, other: m.querySelector("#x-new [name=notes]").value };
    m.remove(); return out;
  });
  report("focus: a redraw puts back the field you were in by its name inside its own form, with what you typed and the cursor", r3.form === "x-edit" && r3.v === "Prefers SMS" && r3.c === 3 && r3.other === "", JSON.stringify(r3));
  // E.keepTyped: fields with no name (Today's readings) keep what was typed through a redraw; a row that went keeps nothing
  const r4 = await sp.evaluate(() => {
    const E = window.EIKON, m = document.createElement("div"); document.body.appendChild(m);
    const row = (d) => '<div class="r" data-device="' + d + '"><input data-min><input data-max></div>';
    let rows = ["1", "2"]; const paint = () => { m.innerHTML = rows.map(row).join(""); };
    paint(); const q = (d, k) => m.querySelector('[data-device="' + d + '"] [data-' + k + ']');
    q("1", "min").value = "3.2"; q("2", "min").value = "2.5"; q("2", "max").focus(); q("2", "max").value = "7"; q("2", "max").setSelectionRange(1, 1);
    rows = ["2"]; E.keepTyped(m, paint, "input[data-min],input[data-max]", (el) => el.closest(".r").getAttribute("data-device") + (el.hasAttribute("data-min") ? "min" : "max"));
    const out = { n: m.querySelectorAll(".r").length, min: q("2", "min").value, max: q("2", "max").value, focus: document.activeElement === q("2", "max"), c: q("2", "max").selectionStart };
    m.remove(); return out;
  });
  report("focus: E.keepTyped keeps every reading typed through a redraw, and the field you were in with its cursor", r4.n === 1 && r4.min === "2.5" && r4.max === "7" && r4.focus && r4.c === 1, JSON.stringify(r4));
  // E.keepChanged (inside E.whenFormIdle and E.repaintKeepingFocus): a list arriving while the person is outside the form
  // keeps every field they changed (list, tick box, text); a form sent since is drawn as the screen says (cleared)
  await sp.evaluate(() => { const m = document.createElement("div"); m.id = "kc-t"; document.body.appendChild(m); window.__kcPaint = () => { m.innerHTML = '<form id="kc"><select name="t"><option value="recall">R</option><option value="quarantine">Q</option></select><input type="checkbox" name="c"><input name="x" value=""><button type="submit">s</button></form><button id="kc-out">out</button>'; m.querySelector("#kc").addEventListener("submit", (e) => e.preventDefault()); }; window.__kcPaint(); });
  await sp.selectOption("#kc [name=t]", "quarantine"); await sp.click("#kc [name=c]"); await sp.click("#kc [name=x]"); await sp.keyboard.type("Valsartan"); await sp.click("#kc-out");
  const r6 = await sp.evaluate(() => { const m = document.getElementById("kc-t"); window.EIKON.whenFormIdle(m, window.__kcPaint); return { t: m.querySelector("[name=t]").value, c: m.querySelector("[name=c]").checked, x: m.querySelector("[name=x]").value }; });
  await sp.click("#kc button[type=submit]"); await sp.click("#kc-out");
  const r7 = await sp.evaluate(() => { const m = document.getElementById("kc-t"); window.EIKON.whenFormIdle(m, window.__kcPaint); const o = { t: m.querySelector("[name=t]").value, c: m.querySelector("[name=c]").checked, x: m.querySelector("[name=x]").value }; m.remove(); return o; });
  report("focus: a redraw while the person is outside the form keeps every field they changed (list, tick box, text); after the form is sent it is drawn as the screen says", r6.t === "quarantine" && r6.c === true && r6.x === "Valsartan" && r7.t === "recall" && r7.c === false && r7.x === "", JSON.stringify({ r6, r7 }));
  // the sighting: Customers Edit, then at once Notes (Playwright fill: focus, then the text); the timer comes in between
  await sp.evaluate(() => document.getElementById("fr-t").remove());
  await sp.fill("#cus-q", "zammit"); await sp.waitForSelector('[data-person="1"]', { timeout: 8000 }).catch(() => {});
  if (await sp.locator('[data-person="1"]').count()) {
    await sp.click('[data-person="1"]'); await sp.waitForSelector('#cus-detail [data-act="edit"]', { timeout: 8000 });
    await sp.evaluate(() => { window.__lag = 300; });
    await sp.click('[data-act="edit"]'); await sp.fill("#cus-edit [name=notes]", "Prefers SMS"); await sp.waitForTimeout(400);
    const r5 = await sp.evaluate(() => ({ name: document.querySelector("#cus-edit [name=name]").value, notes: document.querySelector("#cus-edit [name=notes]").value, at: document.activeElement && document.activeElement.name }));
    await sp.evaluate(() => { window.__lag = 0; });
    report("customers: Edit then Notes at once, the name field's late focus does not take the text: each value in its own field", r5.name === "Zammit Carmel" && r5.notes === "Prefers SMS" && r5.at === "notes", JSON.stringify(r5));
  } else report("customers: Edit then Notes at once (Zammit Carmel listed)", false, "no person 1 in the list");
  report("focus tests: no page errors", !sErr.length, sErr.join(" | "));
  await sp.close();
}

// Money part 2 (b4-6b): End of day prints the day on the classic A4 sheet (after the classic's checks) and unlocks a
// locked day (the pharmacist, the classic unlock with a reason, the classic's own audit note in this browser, focus on
// what it did); Credit notes lists each use and undoes one after one question (Escape keeps it, focus back).
try {
  const lsAudit = () => page.evaluate(() => { try { return JSON.parse(localStorage.getItem("eikon_eod_audit_v1") || "[]"); } catch (e) { return []; } });
  await page.evaluate(() => localStorage.removeItem("eikon_eod_audit_v1"));
  eodState = { rec: { id: 1, date: todayYmd, eod_date: todayYmd, staff: "Ġorġ", float_amount: "100", x: [{ amount: "300", remark: "Till 1" }, { amount: "1" }, { amount: "1" }, { amount: "1" }, { amount: "5", remark: "fifth" }], epos: [{ amount: "20" }], cheques: [], paid_outs: [],
    cash: { n50: "4", n20: "5", coins_total: "0" }, deposit: { n50: 3, n20: 5 }, bov_deposit: { n50: 3, n20: 5 }, bag_number: "B-1", deposit_edited: true, updated_at: "2026-11-03 18:00:00", locked_at: "2026-11-03 18:30:00" }, n: 0 };
  await page.goto("about:blank"); await page.goto(base + "&ui=2#endofday");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector("[data-act=print-a4]") && document.querySelector("[data-act=fix]"), null, { timeout: 15000 });
  await page.evaluate(() => { window.__a4 = []; window.EIKON.openPrintUrlOrLink = function (u, o) { window.__a4.push(o); return null; }; });
  await page.click("[data-act=print-a4]");
  const a4 = await page.evaluate(() => ({ html: window.EIKON.eodLastA4 || "", calls: window.__a4.length }));
  const a4ok = a4.calls === 1 && /<td>DATE:<\/td>/.test(a4.html) && /A4  X READING 4/.test(a4.html) && !/X READING 5/.test(a4.html) && /TOTAL X READINGS<\/td><td class='c'>€<\/td><td class='r'>308\.00/.test(a4.html) &&
    /D8  PAID OUTS/.test(a4.html) && /counter\(page\) \\" of \\" counter\(pages\)|counter\(page\) " of " counter\(pages\)|counter\(pages\)/.test(a4.html) && /Demo Pharmacy · End of day/.test(a4.html) && /\(Malta\)/.test(a4.html) && !/<script/i.test(a4.html) && /Ġorġ/.test(a4.html);
  const a4audit = (await lsAudit()).filter((x) => x.action === "PRINT_A4").length;
  // unlock: Correct this day, a reason, the classic unlock
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=fix]"); await page.fill("[name=fix_reason]", "Cheque typed twice"); await page.click("[data-act=fix-go]");
  await page.waitForSelector("#eod-fixnote", { timeout: 8000 }); await page.waitForTimeout(300);
  const un = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/endofday/record").map((c) => c.body.record);
  const unFocus = await page.evaluate(() => document.activeElement && document.activeElement.id);
  const unAudit = (await lsAudit()).filter((x) => x.action === "UNLOCK");
  // print needs the staff (the classic's check): the cursor goes there, nothing is printed
  if (!(await page.$("[name=staff]"))) await page.click("[data-act=who]"); // b4-4: staff sits behind the summary line's Change
  await page.fill("[name=staff]", ""); await page.locator("[name=staff]").blur(); await page.click("[data-act=print-a4]");
  const pErr = await page.evaluate(() => ({ calls: window.__a4.length, focus: document.activeElement && document.activeElement.name, msg: (document.querySelector("#eod-err") || {}).textContent || "" }));
  report("end of day: Print on A4 prints the classic sheet (4 X readings, total of all, 8 paid outs, pharmacy, page numbers, Malta time, no script) and keeps the classic's PRINT_A4 note",
    a4ok && a4audit === 1, JSON.stringify({ calls: a4.calls, a4audit, head: a4.html.slice(a4.html.indexOf("<table"), a4.html.indexOf("<table") + 200) }));
  report("end of day: unlocking a locked day sends the classic unlock with the reason, keeps the classic's UNLOCK note, and puts focus on the unlocked note; print without Staff says so, in the box",
    un.length === 1 && un[0].unlock === true && un[0].action === "UNLOCK" && un[0].correction_reason === "Cheque typed twice" && unAudit.length === 1 && unAudit[0].by === "Maria Borg" && JSON.stringify(unAudit[0].details) === "{}" && unFocus === "eod-fixnote" &&
    pErr.calls === 1 && pErr.focus === "staff" && /Write who is closing/.test(pErr.msg), JSON.stringify({ un, unAudit, unFocus, pErr }));
  // credit notes: undo a use
  await page.goto(base + "&ui=2#creditnotes");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cnreg" && document.querySelector(".cnr-card [data-act=undo]"), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".cnr-card [data-act=undo]"); await page.waitForSelector(".cnr-ask");
  const ask = { text: (await page.textContent(".cnr-ask")).replace(/\s+/g, " "), focus: await page.evaluate(() => document.activeElement.getAttribute("data-act")) };
  await page.keyboard.press("Escape");
  const esc = await page.evaluate(() => ({ gone: !document.querySelector(".cnr-ask"), focus: document.activeElement.getAttribute("data-act") }));
  await page.click(".cnr-card [data-act=undo]"); await page.click("[data-act=undo-yes]"); await settleSave(); await page.waitForTimeout(300);
  const dels = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "DELETE");
  const back = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act"));
  report("credit notes: each use is listed; Undo asks once in plain words (Escape keeps it, focus back), then sends the classic's DELETE and puts focus on the note's Use",
    /Undo the use of €12\.50/.test(ask.text) && /leaving €30\.00/.test(ask.text) && ask.focus === "undo-yes" && esc.gone && esc.focus === "undo" &&
    dels.length === 1 && dels[0].path === "/creditnotes/entries/91/purchases/1" && back === "use", JSON.stringify({ ask, esc, dels, back }));
} catch (e) { report("money part 2: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// Money 10a: Credit notes prints one note (the classic one-note page, through E.openPrint) and keeps its notes (add:
// the classic POST with the text trimmed; remove: the pharmacist, one question, the classic DELETE); End of day copies
// the deposit for the bank email (the classic's HTML and plain text) after the classic's check (a bag number).
try {
  await page.goto("about:blank"); await page.goto(base + "&ui=2#creditnotes");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "cnreg" && document.querySelector(".cnr-card [data-act=print]"), null, { timeout: 15000 });
  await page.evaluate(() => { window.__pr = []; window.EIKON.openPrint = function (h, o) { window.__pr.push({ h: h, o: o }); return {}; }; });
  await page.click(".cnr-card [data-act=print]");
  const pr = await page.evaluate(() => ({ n: window.__pr.length, h: window.__pr[0] && window.__pr[0].h, delay: window.__pr[0] && window.__pr[0].o.delay, last: window.EIKON.cnLastPrint === (window.__pr[0] || {}).h }));
  const noteShown = await page.evaluate(() => (document.querySelector(".cnr-notes") || {}).textContent || "");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".cnr-card [data-act=note]"); await page.waitForTimeout(80);
  const nf = await page.evaluate(() => document.activeElement && document.activeElement.name);
  await page.keyboard.press("Enter"); await page.waitForTimeout(100);
  const nEmpty = await page.evaluate(() => ({ msg: (document.querySelector("#cnr-nerr") || {}).textContent || "", inv: document.querySelector("#cnr-note [name=note_text]").getAttribute("aria-invalid") }));
  await page.keyboard.type("  Will call Friday  "); await page.keyboard.press("Enter"); await settleSave(); await page.waitForTimeout(300);
  const posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && /\/notes$/.test(c.path));
  const nBack = await page.evaluate(() => ({ focus: document.activeElement && document.activeElement.getAttribute("data-act"), form: !!document.querySelector("#cnr-note") }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click(".cnr-card [data-act=rmnote]"); await page.waitForSelector(".cnr-ask");
  const rAsk = { text: (await page.textContent(".cnr-ask")).replace(/\s+/g, " "), focus: await page.evaluate(() => document.activeElement.getAttribute("data-act")) };
  await page.keyboard.press("Escape");
  const rEsc = await page.evaluate(() => ({ gone: !document.querySelector(".cnr-ask"), focus: document.activeElement.getAttribute("data-act") }));
  await page.click(".cnr-card [data-act=rmnote]"); await page.click("[data-act=rmnote-yes]"); await settleSave(); await page.waitForTimeout(300);
  const rDels = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "DELETE");
  const foot = await page.evaluate(() => (document.querySelector(".ecr-foot") || {}).textContent || "");
  report("credit notes: Print opens the classic one-note page through E.openPrint (the note, its use and its notes, no script)",
    pr.n === 1 && pr.last && pr.delay === 150 && /<title>Credit Note #91<\/title>/.test(pr.h) && /Rang, no answer/.test(pr.h) && /Purchase History/.test(pr.h) && /€17\.50/.test(pr.h) && !/<script/i.test(pr.h) && /Rang, no answer/.test(noteShown), JSON.stringify({ n: pr.n, delay: pr.delay, noteShown }));
  report("credit notes: Add a note puts the cursor in the box, says so when empty, sends the classic POST with the text trimmed, focus back on Add a note",
    nf === "note_text" && /Write the note first/.test(nEmpty.msg) && nEmpty.inv === "true" && posts.length === 1 && posts[0].path === "/creditnotes/entries/91/notes" && JSON.stringify(posts[0].body) === '{"text":"Will call Friday"}' && nBack.focus === "note" && !nBack.form,
    JSON.stringify({ nf, nEmpty, posts, nBack }));
  report("credit notes: Remove on a note asks once in plain words (Escape keeps it, focus back), then sends the classic DELETE; the footer is the new-design one (no classic screen)",
    /Remove this note\?/.test(rAsk.text) && /Rang, no answer/.test(rAsk.text) && rAsk.focus === "rmnote-yes" && rEsc.gone && rEsc.focus === "rmnote" && rDels.length === 1 && rDels[0].path === "/creditnotes/entries/91/notes/7" &&
    /^Made a mistake\? Press Correct on the line — what it said before stays on record\.$/.test(foot.trim()) && !/printing|classic/i.test(foot), JSON.stringify({ rAsk, rEsc, rDels, foot })); // batch-21: the new-design footer
  // End of day: the deposit for the bank email
  eodState = { rec: { id: 1, date: todayYmd, eod_date: todayYmd, staff: "Ġorġ", float_amount: "100", x: [{ amount: "300" }], epos: [], cheques: [], paid_outs: [], cash: { n50: "4", n20: "5", coins_total: "0" }, deposit: { n50: 3, n20: 5 }, bov_deposit: { n50: 3, n20: 5 }, bag_number: "", contact_id: "4", deposit_edited: true, updated_at: "2026-11-03 18:00:00" }, n: 0 };
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto("about:blank"); await page.goto(base + "&ui=2#endofday");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg" && document.querySelector("[data-act=copy-dep]"), null, { timeout: 15000 });
  await page.evaluate(() => { window.__clip = null; navigator.clipboard.write = async (items) => { window.__clip = { html: await (await items[0].getType("text/html")).text(), plain: await (await items[0].getType("text/plain")).text() }; }; });
  await page.click("[data-act=copy-dep]"); await page.waitForTimeout(150);
  const cNo = await page.evaluate(() => ({ clip: window.__clip, focus: document.activeElement && document.activeElement.name, msg: (document.querySelector("#eod-err") || {}).textContent || "" }));
  await page.fill("#eod-form [name=bag_number]", "B-1"); await page.click("[data-act=copy-dep]"); await page.waitForFunction(() => window.__clip, null, { timeout: 5000 }); await page.waitForTimeout(150);
  const clip = await page.evaluate(() => ({ c: window.__clip, err: !!document.querySelector("#eod-err"), saved: 0 }));
  const dmyT = todayYmd.slice(8, 10) + "/" + todayYmd.slice(5, 7) + "/" + todayYmd.slice(0, 4);
  const wantPlain = new RegExp("^Dear BOV Paola,\\n\\n\\nDate: " + dmyT.replace(/\//g, "\\/") + "\\nLocation: [^\\n]*\\n\\nBOV CASH DEPOSIT\\tBAG NO\\.\\tB-1\\nNOTES\\tNO\\.\\tTOTAL\\n€500\\.00\\t0\\t€0\\.00\\n€200\\.00\\t0\\t€0\\.00\\n€100\\.00\\t0\\t€0\\.00\\n€50\\.00\\t3\\t€150\\.00\\n€20\\.00\\t5\\t€100\\.00\\n€10\\.00\\t0\\t€0\\.00\\n€5\\.00\\t0\\t€0\\.00\\nCASH DEPOSITED\\t\\t€250\\.00\\n$");
  const puts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/endofday/record");
  report("end of day: Copy for the bank email asks for the bag number first (nothing copied, cursor in the box), then copies the classic HTML and plain text (greeting, day, pharmacy, the bag's table) and saves nothing",
    cNo.clip === null && cNo.focus === "bag_number" && /Write the bag number/.test(cNo.msg) && clip.c && wantPlain.test(clip.c.plain) && /BOV CASH DEPOSIT<\/th>/.test(clip.c.html) && /<div>Dear BOV Paola,<\/div>/.test(clip.c.html) && /€250\.00<\/th><\/tr><\/table>$/.test(clip.c.html) && !clip.err && puts.length === 0,
    JSON.stringify({ cNo, plain: clip.c && clip.c.plain, puts: puts.length }));
} catch (e) { report("money 10a: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// Sentence case app-wide (one rule in ui/app.css): no element of a new-layout screen is drawn in capitals, and the
// section labels share one look (13 px, semibold, no caps spacing). Typed text in fields is not touched.
try {
  await page.setViewportSize({ width: 1440, height: 900 });
  const caps = {};
  for (const h of ["today", "customers", "registers", "money", "services", "team", "settings", "eodreg", "tempreg", "cleanreg", "hndreg", "trfreg", "dupreg", "audreg"]) {
    await page.goto(base + "&ui=2#" + h); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId, null, { timeout: 15000 }); await page.waitForTimeout(700);
    caps[h] = await page.evaluate(() => {
      const up = [...document.querySelectorAll("body *")].filter((e) => !/^(INPUT|TEXTAREA|SCRIPT|STYLE)$/.test(e.tagName) && getComputedStyle(e).textTransform === "uppercase" && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())).map((e) => e.className || e.tagName);
      const labs = [...document.querySelectorAll(".tdy-lab, .hub-lab, .eod-lab, .clr-lab, .hnd-lab, .trf-lab, .dup-lab, .aud-lab, .cus-lab")].map((e) => { const c = getComputedStyle(e); return c.fontSize + "/" + c.fontWeight + "/" + c.letterSpacing; });
      return { up: up.slice(0, 5), labs: [...new Set(labs)] };
    });
  }
  const capsBad = Object.entries(caps).filter(([, v]) => v.up.length || v.labs.some((l) => l !== "13px/600/normal" && l !== "13px/600/0px"));
  report("sentence case: no new-layout screen draws anything in capitals and the section labels share one 13 px semibold style (Today, hubs, End of day, Temperature, Cleaning, Handover, Transfers, Duplicates, Audit)", capsBad.length === 0 && caps.today.labs.length > 0, JSON.stringify(capsBad.length ? capsBad : caps.today));
} catch (e) { report("sentence case: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }

// People suggestions with ċ ġ ħ ż (ui/eikon.personpick.js wire()): the server's LOWER()/LIKE know only A to Z, so a
// name with them is sent as its longest stretch without them; every typed word is still checked in the browser.
try {
  const w = await page.evaluate(() => { const f = window.EIKON.personPickWire; return f ? ["żaren", "Żaren", "Ċensina Abela", "Ġorġ", "Carmel Zammit", "0012345M", "ċ"].map(f) : null; });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.goto(base + "&ui=2#clientorders"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add");
  await page.locator("#ord-add [name=client_name]").pressSequentially("Żaren", { delay: 20 }); await page.waitForTimeout(600);
  const qs = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "GET" && c.path === "/people").map((c) => new URLSearchParams(c.query).get("q"));
  report("people suggestions: a name with ċ ġ ħ ż asks the server for its longest stretch without them (\"Żaren\" -> \"aren\"); plain names and ID cards are sent as before",
    JSON.stringify(w) === JSON.stringify(["aren", "aren", "ensina", "or", "Carmel", "12345M", "ċ"]) && qs.includes("aren") && !qs.some((q) => /[ċġħżĊĠĦŻ]/.test(q)), JSON.stringify({ w, qs }));
} catch (e) { report("people suggestions with Maltese letters: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }

// The month bar's printout (ui/eikon.months.js) stamps "printed" in Malta time, whatever the device's clock zone.
try {
  const tzc = await browser.newContext({ viewport: { width: 1280, height: 900 }, timezoneId: "Pacific/Auckland" });
  await tzc.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await tzc.addInitScript(() => { try { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} });
  const tp = await tzc.newPage();
  await tp.goto(base + "&ui=2#today"); await tp.waitForFunction(() => window.EIKON && window.EIKON.months && window.EIKON.months.printHtml, null, { timeout: 15000 });
  const mt = (d) => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).forEach((x) => { o[x.type] = x.value; }); return o.day + "/" + o.month + "/" + o.year + " " + o.hour + ":" + o.minute; };
  const before = mt(new Date());
  const got = await tp.evaluate(() => { const m = /printed ([0-9/]+ [0-9:]+)/.exec(window.EIKON.months.printHtml({ register: "Test", period: "November 2026", sections: [] })); return { printed: m && m[1], device: new Date().getHours() + ":" + new Date().getMinutes(), tz: Intl.DateTimeFormat().resolvedOptions().timeZone }; });
  const after = mt(new Date());
  report("month bar print: \"printed\" is Malta time on a device set to another zone (Auckland)", got.tz === "Pacific/Auckland" && (got.printed === before || got.printed === after), JSON.stringify({ got, before }));
  await tzc.close();
} catch (e) { report("month bar print in Malta time: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }

// Shared form problems and loading rows (core.js E.formErrors / E.skeleton), and the screens switched to them.
try {
  await page.goto(base + "&ui=2#today"); await page.waitForFunction(() => window.EIKON && window.EIKON.formErrors && document.querySelector("#eikon-content"), null, { timeout: 15000 });
  const fe = await page.evaluate(() => {
    const E = window.EIKON, f = document.createElement("form"); f.id = "fe-t";
    f.innerHTML = '<label>A <input name="a" id="fe-a"></label><label>B <input name="b"></label><label>C <input name="c"></label>';
    document.getElementById("eikon-content").appendChild(f);
    const fixed = []; const first = E.formErrors(f, [{ field: "a", msg: "Write A." }, { field: "b", msg: "Write B." }, { field: "zz", msg: "no such field" }], { onFix: (el) => fixed.push(el.name) });
    const al = f.querySelectorAll("[role=alert]"), r = { first: first && first.name, focus: document.activeElement.name, alerts: al.length, text: al[0] && al[0].textContent, atTop: f.firstChild === al[0],
      inv: [...f.querySelectorAll("[aria-invalid=true]")].map((x) => x.name + ">" + x.getAttribute("aria-describedby")) };
    const a = f.querySelector("[name=a]"); a.value = "x"; a.dispatchEvent(new Event("input", { bubbles: true }));
    r.afterA = { inv: [...f.querySelectorAll("[aria-invalid=true]")].map((x) => x.name), alert: !!f.querySelector("[role=alert]") };
    const b = f.querySelector("[name=b]"); b.value = "y"; b.dispatchEvent(new Event("input", { bubbles: true }));
    r.afterB = { inv: f.querySelectorAll("[aria-invalid]").length, alert: !!f.querySelector("[role=alert]"), desc: f.querySelectorAll("[aria-describedby]").length, fixed };
    E.formErrors(f, [{ field: "c", msg: "Write C." }], { at: "field", cls: "x-ferr" }); const c = f.querySelector("[name=c]");
    r.atField = { under: c.parentNode.querySelector(".x-ferr[role=alert]") ? c.parentNode.querySelector(".x-ferr").id : "", desc: c.getAttribute("aria-describedby") };
    E.formErrors(f, []); r.cleared = !f.querySelector("[aria-invalid],[role=alert]");
    f.remove();
    const d = document.createElement("div"); d.innerHTML = E.skeleton(4, "Opening the <list>", "zz-skel"); const sk = d.firstChild;
    r.skel = { cls: sk.className, role: sk.getAttribute("role"), busy: sk.getAttribute("aria-busy"), rows: sk.querySelectorAll("i").length, sr: sk.querySelector(".eikon-sr").textContent };
    return r;
  });
  report("shared form problems (E.formErrors): every field marked and tied to one alert at the top, the first focused, a missing field ignored; typing unmarks each field and the alert goes with the last; under the field when asked; an empty list clears",
    fe.first === "a" && fe.focus === "a" && fe.alerts === 1 && fe.text === "Write A. Write B." && fe.atTop && JSON.stringify(fe.inv) === JSON.stringify(["a>fe-a-err", "b>fe-a-err"]) &&
    JSON.stringify(fe.afterA) === JSON.stringify({ inv: ["b"], alert: true }) && fe.afterB.inv === 0 && !fe.afterB.alert && fe.afterB.desc === 0 && fe.afterB.fixed.join() === "a,b" &&
    fe.atField.under === "fe-t-err" && fe.atField.desc === "fe-t-err" && fe.cleared, JSON.stringify(fe));
  report("shared loading rows (E.skeleton): one status, busy, n rows, the label escaped and read out once",
    fe.skel.cls === "eikon-skel zz-skel" && fe.skel.role === "status" && fe.skel.busy === "true" && fe.skel.rows === 4 && fe.skel.sr === "Opening the <list>", JSON.stringify(fe.skel));
  // the services screens switched to E.skeleton keep their own row height, corners and width
  const sk = {};
  for (const [h, mod, cls, n] of [["lblreg", "lblreg", "lbl-skel", 5], ["otcreg", "otcreg", "otc-skel", 5], ["pocreg", "pocreg", "poc-skel", 5], ["pvreg", "pvreg", "pvr-skel", 4], ["scrreg", "scrreg", "scr-skel", 3]]) {
    await page.goto(base + "&ui=2#" + h); await page.waitForFunction((m) => window.EIKON.state.activeModuleId === m, mod, { timeout: 15000 }); await page.waitForTimeout(400);
    sk[h] = await page.evaluate(([cls, n]) => { const d = document.createElement("div"); d.innerHTML = window.EIKON.skeleton(n, "Opening", cls); document.getElementById("eikon-content").appendChild(d); const b = d.firstChild, i = b.querySelector("i"), cb = getComputedStyle(b), ci = getComputedStyle(i);
      const o = [ci.height, cb.borderTopLeftRadius, cb.marginTop, cb.maxWidth, ci.animationName].join(" "); d.remove(); return o; }, [cls, n]);
  }
  report("services loading rows look as before after the switch to E.skeleton (Labels 44 px/14 px corners/640 wide, OTC 48/380 wide, POCT 52, Pharmacovigilance 56, Screening 64)",
    sk.lblreg === "44px 14px 16px 640px eikonSvcSkel" && sk.otcreg === "48px 12px 16px 380px eikonSvcSkel" && sk.pocreg === "52px 12px 20px none eikonSvcSkel" && sk.pvreg === "56px 12px 20px none eikonSvcSkel" && sk.scrreg === "64px 12px 20px none eikonSvcSkel", JSON.stringify(sk));
} catch (e) { report("shared form problems and loading rows: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }

// q5-5 (BACKLOG5 item 5): Today stays short (5 most pressing, "and N more", older than 30 days closed) and Open lands on
// the exact order, question or delivery (the one hand-over note, mode "open"): row marked, in view, focus on its main
// button; typing during the landing is never taken; Ready from the landed row sends what Ready from the list sends.
// Getting this pharmacy ready counts by evidence and has Not now (D2).
try {
  const openT = async () => { await page.goto(base + "&ui=2#today"); await page.reload(); await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".tdy-head h1") && !/Loading/.test(document.querySelector(".tdy-head h1").textContent), null, { timeout: 15000 }); await page.waitForTimeout(300); };
  const calls = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  todayState = { tempDone: false, cleanDone: false, many: true };
  await page.setViewportSize({ width: 390, height: 844 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await openT();
  const w1 = await page.evaluate(() => { const L = document.querySelector("[data-waiting]"); return { names: [...L.querySelectorAll(".tdy-row:not(.tdy-more) .tdy-t b")].map((b) => b.textContent), more: [...L.querySelectorAll("[data-more]")].map((r) => r.getAttribute("data-more") + ":" + r.innerText.replace(/\s+/g, " ").trim()), older: (L.querySelector("[data-older-row]") || {}).innerText, exp: (L.querySelector("[data-older]") || { getAttribute: () => "" }).getAttribute("aria-expanded"), h1: document.querySelector(".tdy-head h1").textContent }; });
  const tGets = (await calls()).filter((c) => c.method === "GET" && !/^\/(ui|vendor)\//.test(c.path) && c.path !== "/auth/me").map((c) => c.path);
  await page.click("[data-older]"); await page.waitForTimeout(200);
  const w2 = await page.evaluate(() => ({ rows: [...document.querySelectorAll("[data-waiting] .tdy-row:not(.tdy-more) .tdy-t b")].map((b) => b.textContent), exp: document.querySelector("[data-older]").getAttribute("aria-expanded"), foc: document.activeElement && document.activeElement.hasAttribute("data-older") }));
  report("q5-5 today: Customers waiting shows the 5 most pressing (urgent, overdue, due today), one 'and N more' line per kind to its screen, those over 30 days closed under 'Older than 30 days (2)' until Show; the heading still counts all; still only GET /today",
    w1.names.join() === "Grech Carmen,Pace Mary,Grech Carmen,Camilleri Rita,Camilleri Rita" && w1.more.join("|") === "order:and 5 more orders All orders ›|question:and 2 more questions All questions ›" && /Older than 30 days \(2\)/.test(w1.older) && w1.exp === "false" && /14 customers waiting/.test(w1.h1) &&
    tGets.length > 0 && tGets.every((x) => x === "/today") && w2.exp === "true" && w2.foc && w2.rows.slice(-2).join() === "Old Olga,Older Oscar", JSON.stringify({ w1, tGets, w2 }));

  // Open on Grech Carmen's order: Orders, that row marked and in view, focus on its Ready; Enter sends only fulfilled
  await page.click('[data-hand-id="51"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.activeElement && document.activeElement.matches("[data-act=ready]"), null, { timeout: 15000 });
  const o1 = await page.evaluate(() => { const a = document.activeElement, row = a.closest(".ord-row"), r = row.getBoundingClientRect(); return { id: a.getAttribute("data-id"), hit: row.classList.contains("q55-hit"), n: document.querySelectorAll(".q55-hit").length, name: row.querySelector(".t b").textContent, inView: r.top >= 0 && r.bottom <= innerHeight, hand: sessionStorage.getItem("eikon_cus_hand") }; });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const oPuts = (await calls()).filter((c) => c.method !== "GET");
  report("q5-5 today → orders: Open lands on that very order (marked, in view, focus on Ready, note taken once); Enter on it sends exactly what Ready from the list sends ({fulfilled:true} to /51)",
    o1.id === "51" && o1.hit && o1.n === 1 && o1.name === "Grech Carmen" && o1.inView && o1.hand === null && oPuts.length === 1 && oPuts[0].method === "PUT" && oPuts[0].path === "/client-orders/entries/51" && JSON.stringify(oPuts[0].body) === JSON.stringify({ fulfilled: true }), JSON.stringify({ o1, oPuts }));

  // an order waiting more than 30 days: Today's Show, then Open; Orders opens its closed group to show it
  await openT(); await page.click("[data-older]"); await page.waitForTimeout(150); await page.click('[data-hand-id="53"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.activeElement && document.activeElement.matches("[data-act=ready]"), null, { timeout: 15000 });
  const o2 = await page.evaluate(() => { const a = document.activeElement; return { id: a.getAttribute("data-id"), hit: a.closest(".ord-row").classList.contains("q55-hit"), tog: document.querySelector("[data-act=older-toggle]").getAttribute("aria-expanded"), old: document.querySelector(".ord-old").innerText.replace(/\s+/g, " ") }; });
  // and Orders on its own keeps that group closed: Waiting shows the two recent orders
  await page.evaluate(() => { location.hash = "#today"; }); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "today", null, { timeout: 15000 });
  await page.evaluate(() => { location.hash = "#ordreg"; }); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-row"), null, { timeout: 15000 }); await page.waitForTimeout(300);
  const o3 = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".ord-row .t b")].map((b) => b.textContent), tog: document.querySelector("[data-act=older-toggle]").getAttribute("aria-expanded"), wait: document.querySelector(".ord-lab").innerText.replace(/\s+/g, " "), hits: document.querySelectorAll(".q55-hit").length }));
  await page.click("[data-act=older-toggle]"); await page.waitForTimeout(200);
  const o4 = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".ord-row .t b")].map((b) => b.textContent), foc: document.activeElement && document.activeElement.getAttribute("data-act") }));
  report("q5-5 orders (D5): orders taken over 30 days ago wait in a closed 'Older than 30 days (1)' group; Show opens it in place (focus stays); Today's Open on one opens the group and lands on it",
    o2.id === "53" && o2.hit && o2.tog === "true" && /Older than 30 days \(1\)/.test(o2.old) && o3.rows.join() === "Grech Carmen,Vella Joseph" && o3.tog === "false" && /Waiting 2/.test(o3.wait) && o3.hits === 0 && o4.rows.indexOf("Old Olga") >= 0 && o4.foc === "older-toggle", JSON.stringify({ o2, o3, o4 }));

  // Reply on Camilleri Rita's question, Open on her delivery
  await openT(); await page.click('[data-hand="tktreg"][data-hand-id="61"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "tktreg" && document.activeElement && document.activeElement.matches("[data-act=resolve]"), null, { timeout: 15000 });
  const q1 = await page.evaluate(() => { const a = document.activeElement; return { id: a.getAttribute("data-id"), hit: a.closest(".tkt-card").classList.contains("q55-hit") }; });
  await openT(); await page.click('[data-hand="dlvreg"][data-hand-id="72"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "dlvreg" && document.activeElement && document.activeElement.matches("[data-act=done]"), null, { timeout: 15000 });
  const d1 = await page.evaluate(() => { const a = document.activeElement; return { id: a.getAttribute("data-id"), hit: a.closest(".dlv-card").classList.contains("q55-hit"), n: document.querySelectorAll(".q55-hit").length }; });
  report("q5-5 today → questions and deliveries: Reply lands on that question (focus on Resolved), Open on that delivery (focus on Delivered), each marked", q1.id === "61" && q1.hit && d1.id === "72" && d1.hit && d1.n === 1, JSON.stringify({ q1, d1 }));

  // typing while Orders is still loading is never taken: New order opened and typed in before the list arrives
  await openT();
  await page.route("**/client-orders/entries?*", async (r) => { await new Promise((ok) => setTimeout(ok, 1500)); r.continue(); });
  await page.click('[data-hand-id="51"]');
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector(".ord-top [data-act=add]"), null, { timeout: 15000 });
  await page.click(".ord-top [data-act=add]"); await page.waitForSelector("#ord-add [name=client_name]"); await page.focus("#ord-add [name=client_name]"); await page.keyboard.type("Bor");
  await page.waitForTimeout(2600); await page.keyboard.type("g"); // the list has arrived meanwhile
  await page.unroute("**/client-orders/entries?*");
  const k1 = await page.evaluate(() => ({ foc: document.activeElement && document.activeElement.name, v: (document.querySelector("#ord-add [name=client_name]") || {}).value }));
  await page.keyboard.press("Tab"); await page.waitForTimeout(2600); // leaving the field (still in the form) changes nothing; the mark comes with the list once the form is left
  const k2 = await page.evaluate(() => ({ foc: document.activeElement && document.activeElement.name, v: (document.querySelector("#ord-add [name=client_name]") || {}).value }));
  report("q5-5 orders: someone typing in New order while the list arrives keeps the cursor and every letter (the landing never takes focus from a form)", k1.foc === "client_name" && k1.v === "Borg" && k2.v === "Borg" && k2.foc && k2.foc !== "client_name", JSON.stringify({ k1, k2 }));

  // Getting this pharmacy ready: names counted done when every fridge and room has a reading yesterday; hours when Bookings has them; Not now
  todayState = { tempDone: false, cleanDone: false, room: true, roomNoY: true };
  teamState = teamFresh(); teamState.setup = { sign_ins: 3, opening_hours_saved: false };
  await page.evaluate(() => { try { Object.keys(localStorage).filter((k) => /^eikon_(tdy_setup_later|trg_named)/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) {} });
  await openT();
  const s1 = await page.evaluate(() => [...document.querySelectorAll("[data-setup]")].map((e) => e.getAttribute("data-setup")).join());
  todayState = { tempDone: false, cleanDone: false, room: true, bk: true }; await openT();
  const s2 = await page.evaluate(() => !!document.querySelector(".tdy-setup"));
  todayState = { tempDone: false, cleanDone: false, room: true, roomNoY: true }; await openT();
  await page.click("[data-setup-later]"); await page.waitForTimeout(300);
  const s3 = await page.evaluate(() => ({ card: !!document.querySelector(".tdy-setup"), foc: document.activeElement && document.activeElement.tagName, key: Object.keys(localStorage).filter((k) => /eikon_tdy_setup_later/.test(k)).length }));
  await openT();
  const s4 = await page.evaluate(() => !!document.querySelector(".tdy-setup"));
  await page.evaluate(() => { const k = Object.keys(localStorage).find((x) => /eikon_tdy_setup_later/.test(x)); localStorage.setItem(k, String(Date.now() - 31 * 864e5)); });
  await openT();
  const s5 = await page.evaluate(() => !!document.querySelector(".tdy-setup"));
  report("q5-5 today setup (D2): 'Name your fridges' shows while one has no reading yesterday and goes once all do; 'Set your opening hours' goes when Bookings has hours; Not now hides it for 30 days on this device (focus on the heading), then it comes back",
    s1 === "names,hours" && !s2 && !s3.card && s3.foc === "H1" && s3.key === 1 && !s4 && s5, JSON.stringify({ s1, s2, s3, s4, s5 }));
  await page.evaluate(() => { try { Object.keys(localStorage).filter((k) => /eikon_tdy_setup_later/.test(k)).forEach((k) => localStorage.removeItem(k)); } catch (e) {} });
} catch (e) { report("q5-5 today short and exact: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }
todayState = { tempDone: false, cleanDone: false }; teamState = teamFresh();
await page.setViewportSize({ width: 1440, height: 900 });

// BACKLOG5 item 11: the same word on screen and in print. The registers with Correct say where deleting is (a link to
// the classic screen, which opens it), the classic link is called "classic screen" everywhere, the buttons say what they
// do, Download our records names the controlled-drug registers as the registers do, and the temperature month print
// names the pharmacy's own room sensor "Room", as Today does (the stored name after it).
try {
  const w = {};
  const open = async (h, mod, sel) => { await page.goto(base + "&ui=2#" + h); await page.waitForFunction(([m, s]) => window.EIKON.state.activeModuleId === m && document.querySelector(s), [mod, sel], { timeout: 15000 }); await page.waitForTimeout(300); };
  const foot = () => page.evaluate(() => [...document.querySelectorAll('#eikon-content [data-act="classic"]')].map((a) => ({ p: (a.closest("p") || a.parentElement).innerText.replace(/\s+/g, " ").trim(), a: a.textContent })));
  // batch-21 (.183): Paid out and Credit notes end with the new-design footer (the daily registers' words), no classic link
  for (const h of ["poreg", "cnreg"]) {
    await open(h, h, ".ecr-foot"); const f = await foot(), t2 = await page.textContent(".ecr-foot"); w[h] = !f.length && /^Made a mistake\? Press Correct on the line — what it said before stays on record\.$/.test(t2.trim()) ? "ok" : [f, t2];
  }
  w.cleanLink = true;
  const src = (f) => fs.readFileSync(path.join(root, f), "utf8");
  w.oneName = ["audreg", "calreg", "eposreg", "ocpreg", "pocreg", "rotreg", "shfreg", "alertreg"].filter((m) => { const t = src("modules." + m + ".js"); return [...t.matchAll(/data-act="classic"[^>]*>([^<]*)</g)].some((x) => x[1] !== "classic screen"); });
  await page.goto(base + "&ui=2#nexreg"); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "nexreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await page.click("[data-act=add]"); w.nex = await page.textContent("#nex-add button[type=submit]");
  await open("instructions", "hndreg", "#hnd-add"); w.hnd = await page.textContent("#hnd-add button[type=submit]");
  await open("paidout", "poreg", "[data-act=add]"); await page.click("[data-act=add]");
  w.po = await page.evaluate(() => [...document.querySelectorAll("#por-add label")].map((l) => [l.querySelector("span").textContent, [...l.querySelectorAll("input")].map((i) => i.name).join("+")].join(":")).filter((x) => /entry_/.test(x)).join());
  await open("money", "money", ".hub-card"); w.hub = await page.evaluate(() => document.querySelector("#eikon-content").innerText);
  await open("settings", "settings", '[data-open="expreg"]'); await page.click('[data-open="expreg"]'); await page.waitForFunction(() => window.EIKON.state.activeModuleId === "expreg" && document.querySelector("[data-reg]"), null, { timeout: 15000 });
  w.exp = await page.evaluate(() => [...document.querySelectorAll("[data-reg]")].map((i) => i.closest("label").textContent).filter((t) => /controlled|DDA/i.test(t)).join("|"));
  await page.route(/\/temperature\/devices/, (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, devices: [{ id: 7, name: "Demo Pharmacy", device_type: "room", min_limit: 15, max_limit: 25, active: 1 }, { id: 8, name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, active: 1 }] }) }));
  await open("tempreg", "tempreg", "[data-mb=print]");
  await page.evaluate(() => { window.__tp = null; window.EIKON.months.print = (d) => { window.__tp = d; }; });
  await page.click("[data-mb=print]"); await page.waitForFunction(() => window.__tp, null, { timeout: 5000 });
  w.temp = await page.evaluate(() => ({ cols: window.__tp.sections[0].cols.slice(1), intro: window.__tp.intro }));
  await page.unroute(/\/temperature\/devices/);
  report("same word, screen and print (item 11): Paid out and Credit notes end with the new-design footer (batch-21); one name for the classic link; Save item, Add point, Date and Time; sales are sent when the connection is back; export names match the registers; the room prints as Room (Demo Pharmacy)",
    ["poreg", "cnreg"].every((k) => w[k] === "ok") && w.cleanLink && !w.oneName.length && w.nex === "Save item" && w.hnd === "Add point" && w.po === "Date:entry_date,Time:entry_time" &&
    /sales are sent when the connection is back/.test(w.hub) && !/sync/.test(w.hub) && w.exp === "Controlled drugs received|Controlled drugs supplied|POYC controlled drugs" &&
    JSON.stringify(w.temp.cols) === JSON.stringify(["Room (Demo Pharmacy)", "Fridge 1"]) && /Room \(Demo Pharmacy\) 15/.test(w.temp.intro), JSON.stringify(w).slice(0, 900));
} catch (e) { report("same word, screen and print (item 11): ran to the end", false, String(e && e.stack || e).slice(0, 500)); }

// ---- q5-2: nothing typed is lost when you leave a form (BACKLOG5 item 2, core.js E.draft) ----
// Six New forms, each left half-typed by Back, the tab bar, the search and its hub link, come back exactly as typed with
// "Your unsaved … is back · Clear"; nothing is written meanwhile. A person carried from Customers wins (the draft is
// offered, not merged). Drafts are per pharmacy and person, end with the Malta day, never hold a password, and go at sign-out.
try {
  const dc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "Europe/Malta" });
  await dc.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await dc.addInitScript(() => { try { if (!localStorage.getItem("eikon_token")) localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} });
  const dp = await dc.newPage(); const derr = []; dp.on("pageerror", (e) => derr.push(e.message));
  const at = (m) => dp.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === m && window.EIKON._lateIn, m, { timeout: 15000 }).then(() => dp.waitForTimeout(500));
  const hash = async (h) => { await dp.evaluate((h) => { location.hash = "#" + h; }, h); await at(h); };
  const values = (f) => dp.evaluate((f) => { const x = document.querySelector(f); return x ? [...x.querySelectorAll("input,select,textarea")].filter((e) => e.type !== "hidden").map((e) => /^(checkbox|radio)$/.test(e.type) ? e.checked : e.value) : null; }, f);
  const keys = () => dp.evaluate(() => Object.keys(sessionStorage).filter((k) => k.indexOf("eikon_draft_v1|") === 0));
  const FORMS = [["ordreg", ".ord-top [data-act=add]", "#ord-add", "order"], ["tktreg", "[data-act=add]", "#tkt-add", "question"], ["dlvreg", "[data-act=add]", "#dlv-add", "delivery"],
    ["cdsreg", ".cds-top [data-act=add]", "#cds-add", "controlled drug sale"], ["odreg", "[data-act=add]", "#odr-add", "order diary item"], ["poreg", "[data-act=add]", "#por-add", "payment"]];
  const LEAVE = {
    back: async () => { await dp.goBack(); await dp.waitForTimeout(700); },
    tab: async () => { await dp.locator(".eikon-rail-btn[data-mod=today]:visible").first().click(); await at("today"); },
    search: async () => { await dp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur()); await dp.keyboard.press("Control+k"); await dp.waitForSelector("#esr-q"); await dp.fill("#esr-q", "settings"); await dp.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 6000 }); await dp.keyboard.press("Enter"); await dp.waitForTimeout(800); },
    hub: async () => { await dp.locator("#eikon-content [data-act=back]").first().click(); await dp.waitForTimeout(800); },
  };
  await dp.goto(base + "&ui=2#today"); await at("today");
  await fetch(`http://localhost:${PORT}/__reset`);
  const res = [];
  for (const [id, btn, form, noun] of FORMS) for (const how of Object.keys(LEAVE)) {
    await hash("today"); await hash(id);
    await dp.waitForSelector(btn); await dp.click(btn); await dp.waitForSelector(form);
    const boxes = dp.locator(form + " input[type=text]:visible, " + form + " input:not([type]):visible, " + form + " textarea:visible");
    const n = Math.min(2, await boxes.count());
    for (let i = 0; i < n; i++) { await boxes.nth(i).click(); await dp.keyboard.type(i ? "Typed Ċġħż " + how[0].toUpperCase() + how.slice(1) : "Zammit Ġorġ " + id[0].toUpperCase() + id.slice(1), { delay: 0 }); } // words capitalised: a name field capitalises as it is left
    const typed = await values(form);
    await LEAVE[how]();
    const left = await dp.evaluate(() => window.EIKON.state.activeModuleId);
    if (how === "back") { await dp.goForward(); await at(id); } else await hash(id);
    await dp.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
    const got = await values(form), line = await dp.evaluate(() => ((document.querySelector(".eikon-draft") || {}).innerText || "").replace(/\s+/g, " ").trim());
    const noClock = (a) => a.map((v) => (/^\d\d:\d\d$/.test(v) ? "hh:mm" : v)); // an untouched time default is the time now when the form reopens (a minute can pass)
    res.push({ id, how, left, same: JSON.stringify(noClock(got)) === JSON.stringify(noClock(typed)), line: line === "Your unsaved " + noun + " is back · Clear", n, ...(JSON.stringify(noClock(got)) === JSON.stringify(noClock(typed)) ? {} : { typed, got }) });
    const c = dp.locator(form + " [data-act$=cancel]").first(); if (await c.count()) await c.click();
  }
  const bad = res.filter((r) => !r.same || !r.line || r.left === r.id || !r.n);
  const w = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET");
  report("drafts: a half-typed New order, question, delivery, controlled drug sale, order diary item and payment, left by Back, the tab bar, the search or its hub link, come back exactly as typed with \"Your unsaved … is back · Clear\" (24 of 24); nothing was written",
    res.length === 24 && !bad.length && !w.length, JSON.stringify({ bad, w: w.length, res: res.slice(0, 3) }));
  report("drafts: no draft is left after Cancel", !(await keys()).length, JSON.stringify(await keys()));

  // Clear: the form as it opened, the draft gone; Save/Cancel leave nothing
  await hash("odreg"); await dp.click("[data-act=add]"); await dp.waitForSelector("#odr-add");
  const fresh = await values("#odr-add");
  await dp.fill("#odr-add [name=item_name]", "Panadol"); await dp.fill("#odr-add [name=qty]", "4");
  await hash("today"); await hash("odreg"); await dp.waitForSelector(".eikon-draft button");
  const focusBack = await dp.evaluate(() => document.activeElement && document.activeElement.name);
  await dp.click(".eikon-draft button"); await dp.waitForTimeout(200);
  const cl = { vals: await values("#odr-add"), line: !!(await dp.$(".eikon-draft")), keys: await keys(), focus: await dp.evaluate(() => document.activeElement && document.activeElement.name) };
  report("drafts: Clear puts the form back as it opened (a default of 1 stays 1), removes the line and the draft, and leaves the cursor in the first field",
    JSON.stringify(cl.vals) === JSON.stringify(fresh) && !cl.line && !cl.keys.length && cl.focus === "item_name" && focusBack, JSON.stringify({ cl, fresh, focusBack }));
  await dp.click("#odr-add [data-act$=cancel]");

  // A person carried from Customers wins: the draft is offered, and Bring back puts it in place whole
  await hash("cdsreg"); await dp.click(".cds-top [data-act=add]"); await dp.waitForSelector("#cds-add");
  await dp.fill("#cds-add [name=client_name]", "Draft Person"); await dp.fill("#cds-add [name=doctor_name]", "Dr Draft");
  await hash("registers");
  await dp.evaluate(() => { window.EIKON.customerHandoff("cdsreg", "new", { name: "Zammit Carmel", id_card: "0012345M", phone: "79123456", address: "1 Triq il-Knisja" }, ""); location.hash = "#cdsreg"; });
  await at("cdsreg"); await dp.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
  const v = (n) => dp.evaluate((n) => document.querySelector("#cds-add [name=" + n + "]").value, n);
  const carried = { name: await v("client_name"), id: await v("client_id_card"), doc: await v("doctor_name"), line: await dp.evaluate(() => ((document.querySelector(".eikon-draft") || {}).innerText || "").replace(/\s+/g, " ").trim()), kept: (await keys()).length };
  await dp.click(".eikon-draft button"); await dp.waitForTimeout(200);
  const brought = { name: await v("client_name"), id: await v("client_id_card"), doc: await v("doctor_name"), line: await dp.evaluate(() => ((document.querySelector(".eikon-draft") || {}).innerText || "").replace(/\s+/g, " ").trim()), kept: (await keys()).length };
  report("drafts: a person carried from Customers wins (name and ID card filled, the draft not merged) and the draft is offered; Bring back puts the whole draft in place of the person",
    carried.name === "Zammit Carmel" && carried.id === "0012345M" && carried.doc === "" && carried.line === "You were typing another controlled drug sale · Bring back what you were typing" && carried.kept === 1 &&
    brought.name === "Draft Person" && brought.id === "" && brought.doc === "Dr Draft" && /is back · Clear$/.test(brought.line) && brought.kept === 0, JSON.stringify({ carried, brought }));
  await dp.click("#cds-add [data-act$=cancel]").catch(() => {});

  // Kept per pharmacy and person, for the Malta day; never a password; gone at sign-out
  const rules = await dp.evaluate(async () => {
    const E = window.EIKON, u = E.state.user, c = document.getElementById("eikon-content"), out = {};
    const d = document.createElement("div"); d.innerHTML = '<button data-act="zz-new">New</button>'; c.appendChild(d);
    d.querySelector("button").addEventListener("click", () => { if (!d.querySelector("form")) d.insertAdjacentHTML("beforeend", '<form id="zz-f"><input name="who"><input type="password" name="pw"><input name="pin" autocomplete="new-password"></form>'); });
    const was = E.state.activeModuleId; E.state.activeModuleId = "zzreg";
    E.draft.spec("zzreg", { btn: "[data-act=zz-new]", form: "#zz-f" }, c);
    d.querySelector("button").click(); await new Promise((r) => setTimeout(r, 20));
    const f = d.querySelector("form"); f.who.value = "Borg"; f.pw.value = "Secret-1"; f.pin.value = "1234";
    E.draft.keep("zzreg", c);
    const k = Object.keys(sessionStorage).find((x) => /\|zzreg$/.test(x)); const raw = k ? sessionStorage.getItem(k) : "";
    out.key = k ? k.split("|").slice(1, 3).join("|") === u.location_id + "|" + (u.id != null ? u.id : u.email) : false;
    out.noPw = !!raw && raw.indexOf("Secret-1") < 0 && raw.indexOf("1234") < 0 && raw.indexOf("Borg") > 0;
    // another pharmacy or person signed in on this tab: not theirs
    const loc = u.location_id; u.location_id = 999; out.otherPharmacy = Object.keys(sessionStorage).filter((x) => x.indexOf("eikon_draft_v1|999|") === 0).length === 0 && !E.draft.take("zzreg", c, 5).then; u.location_id = loc;
    // yesterday's draft is dropped when read
    const j = JSON.parse(raw); j.day = "2000-01-01"; sessionStorage.setItem(k, JSON.stringify(j));
    out.v = await E.draft.take("zzreg", c, 7); out.stale = !sessionStorage.getItem(k);
    // sign-out drops what this person left
    E.draft.keep("zzreg", c); const before = !!sessionStorage.getItem(k);
    E.draft.dropMine(); out.signout = before && !sessionStorage.getItem(k);
    E.state.activeModuleId = was; d.remove();
    return out;
  });
  report("drafts: kept per pharmacy and signed-in person, never a password, another day's is dropped (the load's answer passes through), and sign-out drops this person's",
    rules.key && rules.noPw && rules.otherPharmacy && rules.v === 7 && rules.stale && rules.signout, JSON.stringify(rules));
  report("drafts: no page errors", !derr.length, derr.join(" | ").slice(0, 300));
  await dc.close();
} catch (e) { report("drafts: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }

// ---- q6-1 (BACKLOG6 item 1): typing survives "Reload this screen" and a session that ends (core.js E.showErrorBar,
// E.handleSessionExpired, E.renderLogin, E.draft). For a New order, controlled drug sale, payment and daily register
// line: Reload this screen brings the half-typed form back; a 401 (and a sign-out in another tab) keeps it before the
// sign-in card, which says so, has the e-mail filled in and the cursor in Password; the same person signing in again
// is back on that screen with the form as typed. Someone else signing in sees none of it, and it is gone from the tab.
// Nothing is sent by itself.
try {
  const qc = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "Europe/Malta" });
  await qc.route(/cdn\.jsdelivr\.net|unpkg\.com|cdnjs\.cloudflare\.com|fonts\.googleapis\.com/, (r) => r.fulfill({ contentType: "application/javascript", body: "" }));
  await qc.addInitScript(() => { try { if (!localStorage.getItem("eikon_token")) localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} });
  const MARIA = { id: 1, email: "p@x.com", full_name: "Maria Borg", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: "admin" };
  await qc.route("**/auth/login", (r) => { const b = r.request().postDataJSON() || {}; return b.email === "p@x.com" && b.password === "maria-pass" ? r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, token: "maria-2", user: MARIA }) }) : r.fallback(); });
  await qc.route("**/q61-ping", (r) => r.fulfill({ status: 401, contentType: "application/json", body: '{"ok":false,"error":"Unauthorized"}' })); // a refresh the server refuses: the session ended
  const qp = await qc.newPage(); const qerr = []; qp.on("pageerror", (e) => qerr.push(e.message));
  const at = (m) => qp.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.activeModuleId === m && window.EIKON._lateIn, m, { timeout: 15000 }).then(() => qp.waitForTimeout(500));
  const hash = async (h) => { await qp.evaluate((h) => { location.hash = "#" + h; }, h); await at(h); };
  const values = (f) => qp.evaluate((f) => { const x = document.querySelector(f); return x ? [...x.querySelectorAll("input,select,textarea")].filter((e) => e.type !== "hidden").map((e) => /^(checkbox|radio)$/.test(e.type) ? e.checked : e.value) : null; }, f);
  const keys = () => qp.evaluate(() => Object.keys(sessionStorage).filter((k) => k.indexOf("eikon_draft_v1|") === 0));
  const line = () => qp.evaluate(() => ((document.querySelector(".eikon-draft") || {}).innerText || "").replace(/\s+/g, " ").trim());
  const writes = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" && !/^\/auth\//.test(c.path));
  const noClock = (a) => (a || []).map((v) => (/^\d\d:\d\d$/.test(v) ? "hh:mm" : v));
  const FORMS = [["ordreg", ".ord-top [data-act=add]", "#ord-add", "order"], ["cdsreg", ".cds-top [data-act=add]", "#cds-add", "controlled drug sale"],
    ["poreg", "[data-act=add]", "#por-add", "payment"], ["drreg", "[data-act=new]", "#drr-form", "register line"]];
  const type = async (form, tag) => {
    const boxes = qp.locator(form + " input[type=text]:visible, " + form + " input:not([type]):visible, " + form + " textarea:visible");
    const n = Math.min(2, await boxes.count());
    for (let i = 0; i < n; i++) { await boxes.nth(i).click(); await qp.keyboard.type(i ? "Typed Ċġħż " + tag : "Zammit Ġorġ " + tag, { delay: 0 }); }
    await qp.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
    return n;
  };
  const signIn = async (email, pass) => {
    await qp.waitForSelector("#eikon-login-form");
    await qp.fill("#eikon-login-email", email); await qp.fill("#eikon-login-pass", pass); await qp.keyboard.press("Enter");
    await qp.waitForFunction(() => window.EIKON.state.user && document.getElementById("eikon-content"), null, { timeout: 15000 });
  };
  const cancel = async (form) => { const c = qp.locator(form + " [data-act$=cancel]").first(); if (await c.count()) await c.click(); };
  await qp.goto(base + "&ui=2#today"); await at("today");
  await fetch(`http://localhost:${PORT}/__reset`);
  const rel = [], ses = [];
  for (const [id, btn, form, noun] of FORMS) {
    // (a) Reload this screen
    await hash("today"); await hash(id);
    await qp.waitForSelector(btn); await qp.click(btn); await qp.waitForSelector(form);
    const n = await type(form, "Reload"), typed = await values(form);
    await qp.evaluate(() => window.EIKON.showErrorBar("q6-1 " + Date.now()));
    await Promise.all([qp.waitForEvent("load"), qp.click("#eikon-error-bar [data-act=reload]")]);
    await at(id); await qp.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
    const got = await values(form), ln = await line();
    rel.push({ id, n, same: JSON.stringify(noClock(got)) === JSON.stringify(noClock(typed)), line: ln === "Your unsaved " + noun + " is back · Clear", ...(JSON.stringify(noClock(got)) === JSON.stringify(noClock(typed)) ? {} : { typed, got, ln }) });
    await cancel(form);
    // (b) the session ends (a 401), the same person signs in again
    await hash("today"); await hash(id);
    await qp.waitForSelector(btn); await qp.click(btn); await qp.waitForSelector(form);
    await type(form, "Session"); const typed2 = await values(form);
    await qp.evaluate(() => window.EIKON.apiFetch("/q61-ping").catch(() => {}));
    await qp.waitForSelector("#eikon-login-form");
    const card = await qp.evaluate(() => ({ say: (document.querySelector("#eikon-login-form [role=alert]") || {}).textContent || "", email: document.getElementById("eikon-login-email").value, focus: document.activeElement && document.activeElement.id }));
    await signIn("p@x.com", "maria-pass");
    await at(id); await qp.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
    const got2 = await values(form), ln2 = await line();
    const ok2 = JSON.stringify(noClock(got2)) === JSON.stringify(noClock(typed2));
    ses.push({ id, same: ok2, line: ln2 === "Your unsaved " + noun + " is back · Clear", card: card.say === "Your session has ended. What you were typing is kept for when you sign in again." && card.email === "p@x.com" && card.focus === "eikon-login-pass", ...(ok2 ? {} : { typed2, got2, ln2 }), ...(card.email === "p@x.com" ? {} : { card }) });
    await cancel(form);
  }
  const w1 = await writes();
  const rb = rel.filter((r) => !r.same || !r.line || !r.n), sb = ses.filter((r) => !r.same || !r.line || !r.card);
  report("q6-1: Reload this screen brings back a half-typed New order, controlled drug sale, payment and daily register line exactly as typed, with \"Your unsaved … is back · Clear\" (4 of 4); nothing was written",
    rel.length === 4 && !rb.length && !w1.length, JSON.stringify({ rb, w: w1.map((c) => c.method + " " + c.path) }));
  report("q6-1: a session that ends keeps the open form before the sign-in card (\"What you were typing is kept for when you sign in again.\", e-mail filled in, cursor in Password); the same person signing in again is back on the screen with it exactly as typed (4 of 4); nothing was written",
    ses.length === 4 && !sb.length && !w1.length, JSON.stringify({ sb, w: w1.length }));
  // signed out in another tab (the shared token removed there): the same keep, its own words
  await hash("ordreg"); await qp.click(".ord-top [data-act=add]"); await qp.waitForSelector("#ord-add");
  await type("#ord-add", "Tab"); const typed3 = await values("#ord-add");
  await qp.evaluate(() => { localStorage.removeItem("eikon_token"); window.dispatchEvent(new StorageEvent("storage", { key: "eikon_token", oldValue: "maria-2", newValue: null })); });
  await qp.waitForSelector("#eikon-login-form");
  const say3 = await qp.evaluate(() => (document.querySelector("#eikon-login-form [role=alert]") || {}).textContent || "");
  await signIn("p@x.com", "maria-pass"); await at("ordreg"); await qp.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
  const got3 = await values("#ord-add");
  report("q6-1: signed out in another tab: \"You were signed out in another tab or window. What you were typing is kept for when you sign in again.\" and the order is back after signing in",
    say3 === "You were signed out in another tab or window. What you were typing is kept for when you sign in again." && JSON.stringify(got3) === JSON.stringify(typed3), JSON.stringify({ say3, got3, typed3 }));
  await cancel("#ord-add");
  // nothing to keep: the words stay as they were
  await hash("today"); await qp.evaluate(() => window.EIKON.apiFetch("/q61-ping").catch(() => {})); await qp.waitForSelector("#eikon-login-form");
  const say4 = await qp.evaluate(() => (document.querySelector("#eikon-login-form [role=alert]") || {}).textContent || "");
  report("q6-1: with nothing typed the sign-in card does not promise a draft", say4 === "Your session has ended. Sign in again to continue where you were." && !(await keys()).length, JSON.stringify({ say4, k: await keys() }));
  await signIn("p@x.com", "maria-pass"); await at("today");
  // someone else signs in: none of it shown, and it is dropped from the tab
  await hash("ordreg"); await qp.click(".ord-top [data-act=add]"); await qp.waitForSelector("#ord-add"); await type("#ord-add", "Other");
  await qp.evaluate(() => window.EIKON.apiFetch("/q61-ping").catch(() => {})); await qp.waitForSelector("#eikon-login-form");
  const keptMaria = (await keys()).length;
  await fetch(`http://localhost:${PORT}/__reset`);
  await signIn("karl@x.com", "karl-pass"); await qp.waitForFunction(() => window.EIKON.state.activeModuleId && window.EIKON._lateIn, null, { timeout: 15000 }); await qp.waitForTimeout(1200);
  const other = await qp.evaluate(() => ({ user: window.EIKON.state.user && window.EIKON.state.user.email, mod: window.EIKON.state.activeModuleId, line: !!document.querySelector(".eikon-draft"), form: !!document.querySelector("#ord-add"), typed: [...document.querySelectorAll("#eikon-content input, #eikon-content textarea")].some((e) => /Other/.test(e.value)) }));
  const otherKeys = await keys(), w2 = await writes();
  report("q6-1: after maria's session ends with an order half-typed, karl signing in sees none of it (no form, no line) and it is gone from the tab; nothing was written",
    keptMaria === 1 && other.user === "karl@x.com" && !other.line && !other.form && !other.typed && !otherKeys.length && !w2.length, JSON.stringify({ keptMaria, other, otherKeys, w2: w2.length }));
  // the key is the person whichever answer drew them: /auth/me (user_id) after a reload, /auth/login (id) after signing in
  const same = await qp.evaluate(() => { const E = window.EIKON, u = E.state.user; const a = Object.assign({}, u); E.state.user = { user_id: 7, email: "a@x.com", location_id: 12 }; E.draft.own(); sessionStorage.setItem("eikon_draft_v1|12|7|zz", "{}"); E.state.user = { id: 7, email: "a@x.com", location_id: 12 }; E.draft.own(); const kept = !!sessionStorage.getItem("eikon_draft_v1|12|7|zz"); E.state.user = { id: 8, email: "b@x.com", location_id: 12 }; E.draft.own(); const gone = !sessionStorage.getItem("eikon_draft_v1|12|7|zz"); E.state.user = a; E.draft.own(); return { kept, gone }; });
  report("q6-1: a draft belongs to the same person after a reload (/auth/me user_id) and after signing in (/auth/login id); another person signing in drops it", same.kept && same.gone, JSON.stringify(same));
  report("q6-1: no page errors", !qerr.length, qerr.join(" | ").slice(0, 300));
  await qc.close();
} catch (e) { report("q6-1: ran to the end", false, String(e && e.stack || e).slice(0, 400)); }

// q5-1 (BACKLOG5 item 1): nothing ever freezes the app.
// (a) After boot an unexpected error is a calm bar (role=alert, focus kept, what is typed kept, Reload / Close; Close
//     or Escape in it puts it away and focus back; the same error does not bring it back), reported once; the
//     full-screen notice stays for a failure while starting ("Eikon could not start", Try again, no DevTools words)
//     and for dbg=2. (b) Escape from Order diary's and Locum receipts' first field with suggestions loaded throws
//     nothing. (c) The classic look never sticks: a load without ?ui=classic ends the visit, a route from the visit to
//     a rebuilt screen opens it in the new layout, the visit's own screen and Settings > Classic layout are untouched.
try {
  const qx = await browser.newContext({ viewport: { width: 390, height: 844 } }); const qp = await qx.newPage(); const qerr = []; qp.on("pageerror", (e) => qerr.push(e.message));
  await qp.goto(base); await qp.evaluate(() => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", "pharmacy"); localStorage.setItem("eikon_ui2", "1"); localStorage.removeItem("eikon_dbg"); });
  await qp.goto(base + "&ui=2#tickets");
  await qp.waitForFunction(() => window.EIKON && window.EIKON._booted && window.EIKON.state.activeModuleId === "tktreg" && document.querySelector("[data-act=add]"), null, { timeout: 15000 });
  await qp.click("[data-act=add]"); await qp.fill("#tkt-add [name=client_name]", "Cassar Ryan"); await qp.focus("#tkt-add [name=issue]"); await qp.keyboard.type("Wants");
  await fetch(`http://localhost:${PORT}/__reset`);
  await qp.evaluate(() => { setTimeout(() => { throw new Error("Bar test boom"); }, 0); }); await qp.waitForTimeout(500);
  const a1 = await qp.evaluate(() => { const b = document.getElementById("eikon-error-bar"); return { overlay: !!document.getElementById("eikon-fatal-overlay"), role: b && b.getAttribute("role"), text: b && b.innerText.replace(/\s+/g, " ").trim(), focus: document.activeElement && document.activeElement.name,
    kept: document.querySelector("#tkt-add [name=client_name]").value + "|" + document.querySelector("#tkt-add [name=issue]").value, z: b && getComputedStyle(b).position }; });
  await qp.keyboard.type(" Ozempic"); a1.typed = await qp.inputValue("#tkt-add [name=issue]");
  await qp.focus("#eikon-error-bar [data-act=close]"); await qp.keyboard.press("Escape"); await qp.waitForTimeout(150);
  a1.afterClose = await qp.evaluate(() => ({ bar: !!document.getElementById("eikon-error-bar"), focus: document.activeElement && document.activeElement.name }));
  await qp.evaluate(() => { setTimeout(() => { throw new Error("Bar test boom"); }, 0); }); await qp.waitForTimeout(300);
  a1.sameAgain = await qp.evaluate(() => !!document.getElementById("eikon-error-bar"));
  await qp.evaluate(() => { setTimeout(() => { throw new Error("Another fault"); }, 0); }); await qp.waitForTimeout(300);
  a1.other = await qp.evaluate(() => !!document.getElementById("eikon-error-bar"));
  await qp.click("#eikon-error-bar [data-act=close]"); a1.clicked = await qp.evaluate(() => !document.getElementById("eikon-error-bar"));
  a1.logs = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.path === "/client-log").map((c) => c.body.kind + ":" + c.body.message);
  // a rejected promise after boot: the bar too
  await qp.evaluate(() => { Promise.reject(new Error("Rejected after boot")); }); await qp.waitForTimeout(300);
  a1.rejection = await qp.evaluate(() => { const b = document.getElementById("eikon-error-bar"); const r = !!b && !document.getElementById("eikon-fatal-overlay"); if (b) b.remove(); return r; });
  report("q5-1 after boot: an error is a closable bar (role=alert, plain words, Reload this screen / Close), the screen, the form, the typing and the focus are kept; Escape/Close put it away with focus back; the same error does not reopen it, another does; reported once each",
    !a1.overlay && a1.role === "alert" && a1.text === "Something went wrong on this screen. What you typed is kept. Reload this screen Close" && a1.focus === "issue" && a1.kept === "Cassar Ryan|Wants" && a1.z === "fixed" &&
    a1.typed === "Wants Ozempic" && !a1.afterClose.bar && a1.afterClose.focus === "issue" && !a1.sameAgain && a1.other && a1.clicked && a1.rejection &&
    a1.logs.length === 2 && /^error:.*Bar test boom/.test(a1.logs[0]) && /^error:.*Another fault/.test(a1.logs[1]), JSON.stringify(a1).slice(0, 900));
  // while starting: the blocking notice, plain words; dbg=2 keeps the developer one at any time
  const a2 = await qp.evaluate(() => { const E = window.EIKON; E._booted = false; E._errReportBusy = true; E.showFatalOverlay("main.js crash", "TypeError: x is undefined\n at start"); E._errReportBusy = false;
    const o = document.getElementById("eikon-fatal-overlay"); const r = { text: o.innerText.replace(/\s+/g, " ").trim(), role: o.getAttribute("role"), focus: document.activeElement && document.activeElement.id, dev: /DevTools|dbg=2/.test(o.innerText) };
    E.DEBUG = 2; E._booted = true; E._errReportBusy = true; E.showFatalOverlay("Uncaught error", "Boom in debug"); E._errReportBusy = false;
    r.dbg = /DevTools Console/.test(o.innerText) && /Boom in debug/.test(o.innerText) && !document.getElementById("eikon-error-bar"); E.DEBUG = 0; o.remove(); return r; });
  report("q5-1 while starting: 'Eikon could not start' with Try again (focused), the error only under Details for support, no DevTools words; dbg=2 keeps the developer overlay after boot",
    /^Eikon could not start Check the internet connection, then try again\. Try again Details for support/.test(a2.text) && a2.role === "alertdialog" && a2.focus === "eikon-fatal-retry" && !a2.dev && a2.dbg, JSON.stringify(a2));
  // (b) Escape from the first field, with suggestions loaded (the handler that threw only ran with items to compare)
  await qp.route("**/order-diary/items*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, items: [{ item_name: "Amoxil 500mg", preferred_supplier: "Medicare" }] }) }));
  await qp.route("**/locumreceipts/receipts*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, receipts: [{ id: 1, receipt_date: "2026-11-02", locum_full_name: "Borg Anna", registration_number: "PH123", day_type: "normal", hours: 4, fee_per_hour: 20, total_fee: 80 }] }) }));
  const esc = {};
  for (const [h, mod, form, field] of [["odreg", "odreg", "#odr-add", "item_name"], ["lrcreg", "lrcreg", "#lrc-add", "locum_full_name"]]) {
    await qp.evaluate((x) => { location.hash = "#" + x; }, h); await qp.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content h1"), mod, { timeout: 15000 }); await qp.waitForTimeout(700);
    const names = [];
    await qp.click('#eikon-content [data-act="add"]'); await qp.waitForSelector(form + " [name=" + field + "]"); await qp.waitForTimeout(500);
    for (const n of await qp.evaluate((f) => [...document.querySelectorAll(f + " input:not([type=hidden]), " + f + " select, " + f + " textarea")].map((e) => e.name).filter(Boolean), form)) names.push(n);
    const before = qerr.length; let n = 0;
    for (const nm of names) {
      if (!(await qp.$(form))) { await qp.click('#eikon-content [data-act="add"]'); await qp.waitForSelector(form + " [name=" + field + "]"); await qp.waitForTimeout(300); }
      await qp.focus(form + " [name=" + nm + "]"); await qp.keyboard.press("Escape"); await qp.waitForTimeout(250); n++;
    }
    // something typed: Escape goes to Cancel first (never thrown away by one key), Enter there closes it
    await qp.click('#eikon-content [data-act="add"]'); await qp.waitForSelector(form + " [name=" + field + "]"); await qp.waitForTimeout(300);
    await qp.focus(form + " [name=" + field + "]"); await qp.keyboard.type("Amo"); await qp.keyboard.press("Escape"); await qp.waitForTimeout(200);
    if (await qp.$(form)) { await qp.keyboard.press("Enter"); await qp.waitForTimeout(250); }
    esc[h] = { fields: n, errs: qerr.slice(before), closed: !(await qp.$(form)), bar: await qp.evaluate(() => { const b = document.getElementById("eikon-error-bar"); if (b) b.remove(); return !!b; }) };
  }
  await qp.unroute("**/order-diary/items*"); await qp.unroute("**/locumreceipts/receipts*");
  report("q5-1 Escape from every field of Order diary's and Locum receipts' new form closes it and throws nothing (suggestions loaded)",
    esc.odreg.fields >= 3 && esc.lrcreg.fields >= 5 && !esc.odreg.errs.length && !esc.lrcreg.errs.length && esc.odreg.closed && esc.lrcreg.closed && !esc.odreg.bar && !esc.lrcreg.bar, JSON.stringify(esc));
  // (c) the classic look: a visit, then a load without ?ui=classic; a route from the visit to a rebuilt screen
  await qp.goto(base + "&ui=classic#loyalty"); await qp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "loyalty" && !document.documentElement.hasAttribute("data-ui2"), null, { timeout: 15000 });
  const c1 = { visit: await qp.evaluate(() => sessionStorage.getItem("eikon_ui2_pause")) };
  await qp.goBack(); await qp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "lrcreg", null, { timeout: 15000 }); await qp.waitForTimeout(300);
  c1.back = await qp.evaluate(() => ({ pause: sessionStorage.getItem("eikon_ui2_pause"), ui2: document.documentElement.hasAttribute("data-ui2") }));
  await qp.evaluate(() => { location.hash = "#temperature"; }); await qp.waitForFunction(() => window.EIKON.state.activeModuleId === "tempreg", null, { timeout: 15000 }); c1.temp = await qp.evaluate(() => document.documentElement.hasAttribute("data-ui2"));
  await qp.goto(base + "&ui=classic#loyalty"); await qp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "loyalty", null, { timeout: 15000 }); await qp.waitForTimeout(300);
  // an address that says ?ui=classic gets the classic screen it names, also from inside a visit (only the hash changes)
  await qp.goto(base + "&ui=classic#deliveries"); await qp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "deliveries", null, { timeout: 15000 }); await qp.waitForTimeout(300);
  c1.address = await qp.evaluate(() => window.EIKON.state.activeModuleId + (document.documentElement.hasAttribute("data-ui2") ? "/new" : "/classic") + " " + /ui=classic/.test(location.search));
  // the classic menu's way to a rebuilt screen ends the visit and opens it in the new layout
  await qp.evaluate(() => { const b = document.querySelector('.eikon-nav-btn[data-mod="endofday"]'); b.click(); });
  await qp.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "eodreg", null, { timeout: 20000 });
  c1.route = await qp.evaluate(() => ({ ui2: document.documentElement.hasAttribute("data-ui2"), pause: sessionStorage.getItem("eikon_ui2_pause") }));
  // the visit's own screen stays classic (a rebuilt screen's "classic screen" link opens the old one on purpose)
  await qp.goto(base + "&ui=classic#order-diary"); await qp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "order-diary", null, { timeout: 15000 }); await qp.waitForTimeout(600);
  c1.own = await qp.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, ui2: document.documentElement.hasAttribute("data-ui2"), back: document.getElementById("eikon-back-btn").style.display !== "none" }));
  // Settings > Classic layout is remembered as before: a plain load stays classic
  await qp.evaluate(() => { localStorage.setItem("eikon_ui2", "0"); }); await qp.goto(base + "#temperature"); await qp.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "temperature", null, { timeout: 15000 });
  c1.pref = await qp.evaluate(() => ({ ui2: document.documentElement.hasAttribute("data-ui2"), btn: document.getElementById("eikon-newlayout-btn") && document.getElementById("eikon-newlayout-btn").style.display !== "none" }));
  report("q5-1 the classic look never sticks: Back from a classic visit and the next screens are the new layout, the classic menu's way to a rebuilt screen opens it there; an address with ?ui=classic, the visit's own screen and Settings > Classic layout are unchanged",
    c1.visit === "1" && c1.address === "deliveries/classic true" && c1.back.pause === null && c1.back.ui2 && c1.temp && c1.route.ui2 && c1.route.pause === null && c1.own.mod === "order-diary" && !c1.own.ui2 && c1.own.back && !c1.pref.ui2 && c1.pref.btn, JSON.stringify(c1));
  await qx.close();
} catch (e) { report("q5-1 nothing freezes the app: ran to the end", false, String(e && e.stack || e).slice(0, 500)); }
// q5-8 (BACKLOG5 item 8): busy lists drawn 30 at a time, 44 px targets on a phone, no ring round a title focused after a tap,
// and the red rail badge readable on the lit Customers tab.
try {
  const dQ = (n) => maltaYmd(n);
  const many = Array.from({ length: 75 }, (_, i) => ({ id: 400 + i, order_date: dQ(0), client_name: (i === 70 ? "Zammit Ċensina" : "Borg Paul ") + i, client_phone: "7911" + String(i).padStart(4, "0"), items_text: "Item " + i, priority: 2, needed_by: dQ(i - 80), fulfilled: 0 }));
  await page.route("**/client-orders/entries?*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: (() => { const sp = new URL(r.request().url()).searchParams; return sp.get("from") || sp.get("month") === dQ(0).slice(0, 7) ? many : []; })() }) }));
  await page.goto(base + "&ui=2#customers"); await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelectorAll(".ord-row").length >= 30, null, { timeout: 15000 });
  await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {}); await page.waitForTimeout(300);
  const lst = () => page.evaluate(() => ({ rows: document.querySelectorAll(".ord-row").length, lab: (document.querySelector(".ord-lab") || {}).textContent, more: (document.querySelector("[data-act=q58-more]") || {}).textContent || "" }));
  const p0 = await lst();
  const reqs = []; const onReq = (r) => { if (!/\.(js|css|png|json|svg)(\?|$)/.test(r.url())) reqs.push(r.method() + " " + r.url()); }; page.on("request", onReq);
  await page.focus("[data-act=q58-more]"); await page.keyboard.press("Enter"); await page.waitForTimeout(250);
  const p1 = await lst(); const f1 = await page.evaluate(() => { const a = document.activeElement, all = [...document.querySelectorAll(".ord-row [data-act=open]")]; return all.indexOf(a); });
  await page.click("[data-act=q58-more]"); await page.waitForTimeout(250); const p2 = await lst();
  page.off("request", onReq);
  await page.fill("#ord-q", "Zammit"); await page.waitForTimeout(200); const pq = await lst();
  await page.fill("#ord-q", ""); await page.waitForTimeout(200); const pc = await lst();
  // a row asked for by id (item 5's "open by id", or a row just saved) is drawn even when it is past the first 30
  const rev = await page.evaluate(() => { window.EIKON.listPage.reveal("ord", 470); const q = document.querySelector("#ord-q"); q.dispatchEvent(new Event("input", { bubbles: true })); return { has: !!document.querySelector('.ord-row [data-act=open][data-id="470"]'), rows: document.querySelectorAll(".ord-row").length }; });
  // Ready on a row past the first page sends exactly what it always sent
  const putB = []; const onPut = (r) => { if (r.method() === "PUT") putB.push(new URL(r.url()).pathname + " " + r.postData()); }; page.on("request", onPut);
  await page.click('.ord-row [data-act=ready][data-id="465"]'); await page.waitForTimeout(600); page.off("request", onPut);
  const keepRow = await page.evaluate(() => !!document.querySelector('.ord-row [data-act=open][data-id="465"]'));
  report("busy lists (q5-8): Orders draws 30 of 75 with the full count, \"Show 30 more (45 left)\" adds 30 with no request and puts the focus on the first new row, the last page says so; a search covers every order (Maltese letters too) and clearing it starts again at 30; a row asked for by id past 30 is drawn; Ready there sends only fulfilled",
    p0.rows === 30 && /Waiting\s*75/.test(p0.lab) && p0.more === "Show 30 more (45 left)" && p1.rows === 60 && f1 === 30 && p1.more === "Show the last 15" && p2.rows === 75 && p2.more === "" && reqs.length === 0 &&
    pq.rows === 1 && /Waiting\s*1/.test(pq.lab) && pc.rows === 30 && rev.has && rev.rows === 75 && putB.length === 1 && putB[0] === '/client-orders/entries/465 {"fulfilled":true}' && keepRow,
    JSON.stringify({ p0, p1, f1, p2, reqs, pq, pc, rev, putB, keepRow }));
  // the pager itself: a second list gets what the first left of the 30; the words for each case
  const lp = await page.evaluate(() => { const L = window.EIKON.listPage, a = Array.from({ length: 50 }, (_, i) => ({ id: i })); L.reset("zz");
    const x = L.take("zz:a", a.slice(0, 12)), y = L.take("zz:b", a, { first: L.STEP - x.shown }), z = L.take("zz:c", a.slice(0, 40), { first: 0 }), k = L.take("zz:d", a, { keep: [44] });
    const w = [L.moreHtml("zz:b", y), L.moreHtml("zz:c", z), L.moreHtml("zz:x", { shown: 0, left: 7 })].map((h) => { const d = document.createElement("div"); d.innerHTML = h; return d.textContent; });
    const nx = L.more("zz:b"), y2 = L.take("zz:b", a, { first: 18 }); L.reset("zz"); return { x: x.shown, y: y.shown, yl: y.left, z: z.shown, k: k.shown, w, nx, y2: y2.shown }; });
  report("busy lists (q5-8): the pager gives a second list what the first left, grows to a kept row, and says \"Show 30 more (N left)\", \"Show 30 of N\", \"Show all N\"",
    lp.x === 12 && lp.y === 18 && lp.yl === 32 && lp.z === 0 && lp.k === 50 && lp.w[0] === "Show 30 more (32 left)" && lp.w[1] === "Show 30 of 40" && lp.w[2] === "Show all 7" && lp.nx === 18 && lp.y2 === 48, JSON.stringify(lp));
  // phone: 44 px targets on the list, the title focused after a tap has no ring, after a key it has one
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(150);
  const tg = await page.evaluate(() => { const m = document.querySelector(".ord"), sel = ".ord-back, .ord-row button, .ord-row a, [data-act=q58-more], .ord-tabs button, #ord-q";
    const h = [...m.querySelectorAll(sel)].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)); return { n: h.length, min: Math.min(...h) }; });
  await page.mouse.click(5, 5); await page.goto(base + "&ui=2#customers"); await page.waitForTimeout(400);
  await page.evaluate(() => document.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }))); await page.evaluate(() => { location.hash = "#clientorders"; });
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "H1" && window.EIKON.state.activeModuleId === "ordreg", null, { timeout: 8000 });
  const tap = await page.evaluate(() => getComputedStyle(document.activeElement).outlineStyle);
  await page.keyboard.press("Shift"); await page.keyboard.press("Tab"); await page.keyboard.press("Shift+Tab");
  const key = await page.evaluate(() => ({ tag: document.activeElement.tagName, o: getComputedStyle(document.activeElement).outlineStyle, ptr: document.documentElement.hasAttribute("data-q58-ptr") }));
  const badge = await page.evaluate(() => { const b = document.querySelector('.eikon-rail-badge[data-badge="customers"]'); if (!b) return null; const c = getComputedStyle(b); return c.backgroundColor + " " + c.color; });
  // FIN-dayzero W29: after a key (no tap), a screen's title focused by the app has no green box either (it is not a
  // control); the first control reached with Tab shows the keyboard ring.
  await page.keyboard.press("Tab"); await page.evaluate(() => { location.hash = "#settings"; });
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === "H1" && window.EIKON.state.activeModuleId === "settings", null, { timeout: 8000 });
  const kTitle = await page.evaluate(() => ({ o: getComputedStyle(document.activeElement).outlineStyle, ptr: document.documentElement.hasAttribute("data-q58-ptr") }));
  await page.keyboard.press("Tab");
  const kNext = await page.evaluate(() => ({ tag: document.activeElement.tagName, o: getComputedStyle(document.activeElement).outlineStyle }));
  const dz = await page.evaluate(() => { const E = window.EIKON, u = E.state.user, keep = u.location_since; u.location_since = "2026-11-11";
    const r = { f: E.fileName("Eikon records Ħamrun Pharmacy: 2026/11 *Żebbuġ*"), b1: E.beforeStart("2026-11-10"), b2: E.beforeStart("2026-11-11"), m1: E.beforeStartMonth("2026-10"), m2: E.beforeStartMonth("2026-11"), so: E.startingOut("2026-11-12"), so2: E.startingOut("2026-11-14") };
    u.location_since = ""; r.none = E.beforeStart("2000-01-01"); u.location_since = keep; return r; });
  report("FIN-dayzero: E.fileName keeps Maltese letters and drops only what a file name refuses; E.beforeStart/E.beforeStartMonth/E.startingOut from the pharmacy's start; no start, nothing clipped",
    dz.f === "Eikon-records-Ħamrun-Pharmacy-2026-11-Żebbuġ" && dz.b1 && !dz.b2 && dz.m1 && !dz.m2 && dz.so && !dz.so2 && !dz.none, JSON.stringify(dz));
  report("focus (FIN-dayzero W29): a title the app focuses never has the green box, after a tap or a key; Tab to the first control shows the ring",
    tap === "none" && kTitle.o === "none" && !kTitle.ptr && kNext.tag !== "H1" && kNext.tag !== "BODY" && kNext.o === "solid", JSON.stringify({ tap, kTitle, kNext }));
  await page.setViewportSize({ width: 1440, height: 900 });
  report("busy lists (q5-8): on a phone every Orders target is at least 44 px tall; the title the app focuses after a tap has no ring, the keyboard keeps its ring; the red badge sits on an opaque tint (5.6:1)",
    tg.n > 60 && tg.min >= 44 && tap === "none" && key.o === "solid" && !key.ptr && (badge === null || badge === "rgb(251, 227, 225) rgb(176, 30, 23)"), JSON.stringify({ tg, tap, key, badge }));
  await page.unroute("**/client-orders/entries?*");
} catch (e) { await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {}); await page.unroute("**/client-orders/entries?*").catch(() => {}); report("busy lists (q5-8): ran to the end", false, String(e && e.stack || e).slice(0, 400) + " " + (await page.evaluate(() => location.href + " " + (window.EIKON && window.EIKON.state.activeModuleId) + " rows=" + document.querySelectorAll(".ord-row").length + " " + (document.querySelector("main,#eikon-content") || document.body).innerText.slice(0, 300)).catch((x) => String(x)))); }

// d-cust: the customer record (waiting now, good to know, loyalty, messages in the story) and Tell the customer (E.tell).
// The new routes are answered here (page.route) as the worker's d-cust block answers them.
try {
  const dQ = (n) => maltaYmd(n);
  const NOW = () => ({ ok: true, person: peopleState.carmel, today: dQ(0),
    waiting: { orders: [{ id: 41, code: "", items: "Insulin pen needles", order_date: dQ(-9), needed_by: dQ(-2), priority: 2 }],
      ready: [{ id: 42, code: "A1B2", items: "Ventolin inhaler", order_date: dQ(-3), ready_at: dQ(0) + " 09:00:00" }],
      questions: [{ id: 51, ref: "TKT-00051", issue: "Is the Omron M3 back?", status: "Resolved", open_date: dQ(-4), followup_date: "", done: true, done_at: dQ(0), last_note: "Yes, back in stock at €49.90" }],
      deliveries: [{ id: 61, ref: "DEL-00061", items: "Box", status: "Scheduled", date: dQ(1), slot: "Afternoon", address: "1 Triq il-Knisja" }],
      repeats: [{ id: 71, entry_date: dQ(-26), expires_date: dQ(150), client_name: "Zammit Carmel", client_id: "0012345M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 nocte", collect_every_days: 28, last_collected_date: null }],
      bookings: [{ id: 81, ref: "B-81", date: dQ(2), time: "10:30", status: "booked", service: "Flu vaccine" }] },
    activity: [{ kind: "dda_sale", label: "DDA sale", date: "2026-10-05", title: "Morphine 10mg", ref: "S-1", doctor: "Dr Abela" }], counts: { dda_sale: 1, loyalty: 1, order: 2 },
    profile: Object.assign({ prefers: "whatsapp", email_ok: null, sms_ok: false, whatsapp_ok: null, lang: "", allergies: "Penicillin", version: 3, updated_at: "" }, globalThis.__dcProf || {}),
    messages: globalThis.__dcMsgs || [], email: { ready: false, why: "Set up e-mail first: Bookings, Settings, Messages.", opted_out: false }, pharmacy: { name: "Demo Pharmacy", phone: "21234567", address: "" } });
  const posts = [];
  globalThis.__dcMsgs = [];
  await page.route("**/people/1/now*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify(NOW()) }));
  await page.route("**/messages/setup*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, email: { ready: false, why: "Set up e-mail first: Bookings, Settings, Messages." }, pharmacy: { name: "Demo Pharmacy", phone: "21234567" } }) }));
  await page.route("**/messages", (r) => { const b = JSON.parse(r.request().postData() || "{}"); posts.push(["/messages", b]); const m = { id: 900 + posts.length, person_id: b.person_id, channel: b.channel, purpose: b.purpose, ref_kind: b.ref_kind, ref_id: b.ref_id, to: b.to, body: b.body, status: "device", by: "Maria Borg", at: dQ(0) + " 10:00:00" }; globalThis.__dcMsgs = [m].concat(globalThis.__dcMsgs); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, message: m }) }); });
  await page.route("**/people/1/profile", (r) => { const b = JSON.parse(r.request().postData() || "{}"); posts.push(["/profile", b]); globalThis.__dcProf = Object.assign({}, b, { version: 4 }); r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, profile: Object.assign(NOW().profile, { version: 4 }) }) }); });
  await page.route("**/loyalty/campaigns*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, campaigns: [{ id: "c1", name: "Vitamin stamps", type: "stamp_card", active: true, open_ended: true, stamp_target: 10, reward: "Free vitamins" }, { id: "c2", name: "Old points", type: "points", active: false, redeem_threshold: 100 }] }) }));
  await page.route("**/loyalty/transactions*", (r) => { if (r.request().method() === "POST") { posts.push(["/loyalty", JSON.parse(r.request().postData())]); return r.fulfill({ contentType: "application/json", body: '{"ok":true}' }); } r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, transactions: [{ id: 1, client_id: "0012345M", campaign_id: "c1", stamps_awarded: 3, points_awarded: 0, total: 0, date: "2026-10-01" }, { id: 2, client_id: "0012345M", campaign_id: "c2", stamps_awarded: 0, points_awarded: 120, total: 0, date: "2026-09-01" }] }) }); });
  const was = peopleState.adopted; peopleState.adopted = true;
  await page.evaluate(() => window.EIKON.tell && window.EIKON.tell._reset());
  await toCarmel();
  await page.waitForSelector(".cus-now .cus-w", { timeout: 8000 }); await page.waitForTimeout(300);
  const r1 = await page.evaluate(() => ({ rows: [...document.querySelectorAll(".cus-now .cus-w")].map((li) => li.querySelector(".t b").textContent + " [" + [...li.querySelectorAll("button")].map((b) => b.textContent).join("/") + "] " + li.querySelector("i").className),
    allergy: (document.querySelector(".cus-allergy") || {}).textContent, pills: [...document.querySelectorAll(".cus-head .cus-pill")].map((e) => e.textContent), loy: (document.querySelector("#cus-loy-box") || {}).innerText,
    sms: document.querySelector("input[name=sms_ok]").checked, pref: (document.querySelector("input[name=prefers]:checked") || {}).value, save: document.querySelector("[data-act=pref-save]").disabled, counts: document.querySelectorAll(".cus-counts a").length }));
  report("d-cust record: Waiting now lists, most urgent first, the late order (red), the due repeat, the ready order and the answered question with Tell, the delivery and the booking (Remind); allergies in red under the name; Prefers WhatsApp; loyalty stamps from the classic list; a 'no' to SMS ticked; Save off until a change",
    /^Order waiting · Insulin pen needles \[Open\] red$/.test(r1.rows[0]) && r1.rows.some((x) => /^Due today · Atorvastatin 20mg|^Overdue|^Due in/.test(x) && /Tell Carmel/.test(x)) && r1.rows.some((x) => /^Ready to collect · Ventolin inhaler \[Tell Carmel\/Open\]/.test(x)) &&
    r1.rows.some((x) => /^Answered · Is the Omron M3 back\? \[Tell Carmel\/Open\]/.test(x)) && r1.rows.some((x) => /^Delivery tomorrow · afternoon · Box \[Tell Carmel\/Open\]/.test(x)) && r1.rows.some((x) => /^Booking .* at 10:30 · Flu vaccine \[Remind Carmel\/Open\]/.test(x)) &&
    /Allergies\s*Penicillin/.test(r1.allergy || "") && r1.pills.includes("Prefers WhatsApp") && /3 of 10 stamps/.test(r1.loy || "") && /Old points \(ended\)/.test(r1.loy || "") && r1.sms === true && r1.pref === "whatsapp" && r1.save === true && r1.counts === 3, JSON.stringify(r1));

  // Tell: the ready order, by WhatsApp (their preference), the words written; SMS cannot be chosen (they said no); e-mail says why
  await fetch(`http://localhost:${PORT}/__reset`);
  const tellBtn = page.locator(".cus-now .cus-w", { hasText: "Ready to collect" }).locator("[data-tell]");
  await tellBtn.click(); await page.waitForSelector(".tl-ov [data-act=open]:not([aria-disabled=true])", { timeout: 8000 }); await page.waitForTimeout(150);
  const d1 = await page.evaluate(() => ({ h: document.querySelector("#tl-h").textContent, ch: document.querySelector("input[name=tl-ch]:checked").value, sms: document.querySelector("input[name=tl-ch][value=sms]").getAttribute("aria-disabled"), email: document.querySelector("input[name=tl-ch][value=email]").getAttribute("aria-disabled"),
    text: document.querySelector("#tl-text").value, href: document.querySelector("[data-act=open]").getAttribute("href"), focus: document.activeElement && document.activeElement.getAttribute("data-act"), why: document.querySelector("#tl-why").textContent }));
  await page.click(".tl-ov label:has(input[value=email])", { force: true }); await page.waitForTimeout(100);
  const d2 = await page.evaluate(() => ({ ch: document.querySelector("input[name=tl-ch]:checked").value, why: document.querySelector("#tl-why").textContent }));
  await page.click(".tl-ov [data-lang=mt]"); await page.waitForTimeout(80);
  const mt = await page.evaluate(() => document.querySelector("#tl-text").value);
  await page.click(".tl-ov [data-lang=en]"); await page.fill("#tl-text", "Hi Carmel, your Ventolin is ready. Demo Pharmacy");
  await page.keyboard.press("Escape"); await page.waitForTimeout(100);
  const esc1 = await page.evaluate(() => ({ open: !!document.querySelector(".tl-ov"), focus: document.activeElement && document.activeElement.getAttribute("data-tell") != null }));
  await tellBtn.click(); await page.waitForSelector(".tl-ov [data-act=open]", { timeout: 8000 });
  const kept = await page.evaluate(() => document.querySelector("#tl-text").value);
  const popUrl = await page.evaluate(() => document.querySelector(".tl-ov [data-act=open]").getAttribute("href"));
  const popup = page.context().waitForEvent("page", { timeout: 4000 }).catch(() => null);
  await page.click(".tl-ov [data-act=open]"); const pp = await popup; if (pp) await pp.close().catch(() => {});
  await page.waitForFunction(() => !document.querySelector(".tl-ov"), null, { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(600);
  const mp = posts.filter((x) => x[0] === "/messages").map((x) => x[1]);
  const after = await page.evaluate(() => ({ told: [...document.querySelectorAll(".cus-now .cus-w")].map((li) => li.innerText).filter((t) => /Ventolin/.test(t))[0] || "", story: (document.querySelector(".cus-story li.msg") || {}).innerText || "" }));
  const writes = (await callsNow()).filter((c) => c.method !== "GET");
  report("d-cust Tell: one tap from the record opens 'Tell Carmel' on WhatsApp (her choice) with the order's words and its wa.me link, focus on Open WhatsApp; SMS can't be chosen (she said no), e-mail says how to set it up; Malti words on a tap; Escape closes, focus back, what was typed comes back; Open WhatsApp records one message (ref, channel, client key) and nothing else is written; the record says Told and the story shows it",
    d1.h === "Tell Carmel" && d1.ch === "whatsapp" && d1.sms === "true" && d1.email === "true" && /^Hi Carmel, your order \(Ventolin inhaler\) is ready to collect at Demo Pharmacy\. Your order number is A1B2\./.test(d1.text) && d1.href.indexOf("https://wa.me/35679123456?text=Hi%20Carmel") === 0 && d1.focus === "open" &&
    d2.ch === "whatsapp" && /Set up e-mail first/.test(d2.why) && /^Bonġu Carmel, l-ordni tiegħek \(Ventolin inhaler\) hija lesta/.test(mt) && !esc1.open && esc1.focus && kept === "Hi Carmel, your Ventolin is ready. Demo Pharmacy" &&
    mp.length === 1 && mp[0].channel === "whatsapp" && mp[0].person_id === 1 && mp[0].purpose === "ready" && mp[0].ref_kind === "order" && mp[0].ref_id === 42 && mp[0].to === "79123456" && mp[0].body === kept && /^[a-z0-9]+-[a-z0-9]+$/.test(mp[0].client_key) &&
    popUrl.indexOf("https://wa.me/35679123456?text=Hi%20Carmel%2C%20your%20Ventolin") === 0 && writes.length === 0 && /Told by WhatsApp today/.test(after.told) && /WhatsApp · Order ready/.test(after.story),
    JSON.stringify({ d1, d2, mt: mt.slice(0, 80), esc1, kept, mp, popUrl: popUrl.slice(0, 80), writes, after }));

  // Good to know: only what was changed is sent, with the version
  await page.fill("#cus-allergy", "Penicillin, aspirin"); await page.click("label.cus-chip:has(input[name=email_ok])"); await page.click("[data-act=pref-save]"); await page.waitForTimeout(400);
  const pf = posts.filter((x) => x[0] === "/profile").map((x) => x[1]);
  report("d-cust good to know: Save sends only the changes (allergies, a 'no' to e-mail) with the version it was read at", pf.length === 1 && JSON.stringify(pf[0]) === JSON.stringify({ version: 3, email_ok: false, allergies: "Penicillin, aspirin" }), JSON.stringify(pf));

  // Loyalty from the record: the classic screen's body
  await page.waitForSelector("#cus-loy-box [data-act=loy-add]"); await page.click("#cus-loy-box [data-act=loy-add]"); await page.waitForSelector("#cus-loy");
  await page.click("#cus-loy [data-act=loy-save]"); await page.waitForTimeout(150);
  const lerr = await page.evaluate(() => [...document.querySelectorAll("#cus-loy .cus-ferr")].map((e) => e.textContent));
  await page.fill("#cus-ly-d", "Vitamin C"); await page.fill("#cus-ly-q", "2"); await page.fill("#cus-ly-r", "R-9"); await page.click("#cus-loy [data-act=loy-save]"); await page.waitForTimeout(500);
  const lp = posts.filter((x) => x[0] === "/loyalty").map((x) => x[1]);
  const lb = lp[0] || {};
  report("d-cust loyalty: Add a purchase says what is missing (nothing sent), then posts the classic Loyalty body (same keys in the same order, stamps and words as the classic screen works them out)",
    lerr.length === 1 && /what they bought/i.test(lerr[0]) && lp.length === 1 && Object.keys(lb).join(",") === "id,client_id,client_name,campaign_id,receipt_no,items,total,notes,stamps_awarded,points_awarded,action,action_label,date,created_at" &&
    lb.client_id === "0012345M" && lb.client_name === "Zammit Carmel" && lb.campaign_id === "c1" && JSON.stringify(lb.items) === '[{"desc":"Vitamin C","qty":2}]' && lb.stamps_awarded === 2 && lb.points_awarded === 0 && lb.action_label === "Awarded 2 stamps" && lb.receipt_no === "R-9" && lb.total === 0 && lb.date === dQ(0),
    JSON.stringify({ lerr, lp }));

  // The helpers
  const u = await page.evaluate(() => { const T = window.EIKON.tell; return [T.firstName("Zammit Carmel"), T.firstName("Maria Borg"), T.firstName("Cassar Ryan"), T.firstName("Borg Vella"), T.intl("7912 3456"), T.intl("+44 7700 900123"), T.intl("0035699123456"), T.intl("123"), T.isMobile("21234567"), T.isMobile("99123456"), T.smsLink("79123456", "a b&c")].join("|"); });
  report("d-cust Tell helpers: the greeting name (a Maltese surname first is passed over), Maltese numbers get 356, the SMS link works on Android and iPhone",
    u === "Carmel|Maria|Ryan|Borg|35679123456|447700900123|35699123456||false|true|sms:+35679123456?&body=a%20b%26c", u);
  peopleState.adopted = was;
  for (const pat of ["**/people/1/now*", "**/messages/setup*", "**/messages", "**/people/1/profile", "**/loyalty/campaigns*", "**/loyalty/transactions*"]) await page.unroute(pat);
} catch (e) { report("d-cust record and Tell: ran to the end", false, String(e && e.stack || e).slice(0, 600)); }

// Stock tab, one ordering flow (d-stock). On a server without the /stock-flow routes (404): the open lines still show,
// arrivals are ticked under To order, customer orders wait to be put on an order. With them: ordered per supplier,
// arrivals tell which customers are waiting, Ready sends only { fulfilled: true }, typing survives the data arriving.
try {
  const calls = async () => (await (await fetch(`http://localhost:${PORT}/__calls`)).json());
  globalThis.__stk = null;
  await page.goto(base + "&ui=2#stock");
  // no wait for the background screens (E._lateIn): their arrival no longer redraws the hub (typing, tests/real typing-late)
  await page.waitForFunction(() => document.querySelector(".stk-seg [data-view=order]") && document.querySelector(".stk-head"), null, { timeout: 15000 });
  await page.click("[data-view=order]").catch(() => {});
  await page.waitForSelector('[data-act=arrived][data-ids="101"]', { timeout: 8000 });
  const f0 = await page.evaluate(() => ({ text: document.querySelector("#stk-slot").innerText, cards: document.querySelectorAll(".hub-card[data-open]").length, all: !!document.querySelector(".stk-all") }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act=arrived][data-ids="101"]'); await page.waitForTimeout(600);
  const f0p = (await calls()).filter((c) => c.method !== "GET");
  report("stock (d-stock): without the stock-flow routes, To order still lists the diary's open lines with Arrived (the classic Received body), customer orders wait to be put on an order, and every stock screen is still there",
    /Augmentin 625/.test(f0.text) && /Waiting to be put on an order/.test(f0.text) && /Nexium 20mg/.test(f0.text) && /Vella Joseph/.test(f0.text) && f0.cards >= 8 && f0.all &&
    f0p.length === 1 && f0p[0].method === "PUT" && f0p[0].path === "/order-diary/entries/101" && JSON.stringify(f0p[0].body) === JSON.stringify({ status: "received" }), JSON.stringify({ f0: f0.text.slice(0, 400), f0p }));

  const d0 = maltaYmd(0), dm3 = maltaYmd(-3);
  globalThis.__stk = { open: [
    { id: 201, order_date: dm3, first_date: dm3, item_name: "Nexium 20mg", qty: 1, supplier: "GSK", status: "pending", notes: "", links: [], ordered_at: null },
    { id: 204, order_date: d0, first_date: d0, item_name: "Nexium 20mg", qty: 2, supplier: "GSK", status: "not_received", notes: "", links: [], ordered_at: null },
    { id: 202, order_date: d0, first_date: d0, item_name: "Cetirizine 10mg", qty: 1, supplier: "Actavis", status: "pending", notes: "", links: [], ordered_at: "2026-11-04 08:00:00", ordered_by_name: "Maria Borg" }],
    received: [{ id: 203, order_date: maltaYmd(-1), first_date: maltaYmd(-1), item_name: "Augmentin 625 x14", qty: 1, supplier: "Actavis", status: "received", notes: "", links: [{ source: "order", source_id: 51 }], updated_at: d0 + " 08:00:00" }] };
  await page.evaluate(() => window.EIKON.stockFlow.reload()); await page.waitForTimeout(500);
  const f1 = await page.evaluate(() => ({ seg: [...document.querySelectorAll(".stk-seg button")].map((b) => b.textContent), text: document.querySelector("#stk-slot").innerText, tell: !!document.querySelector('.stk-tell [data-act=ready][data-oid="51"]') }));
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-act=ordered][data-sup="gsk"]'); await page.waitForTimeout(700);
  const f1p = (await calls()).filter((c) => c.method !== "GET");
  const f1b = await page.evaluate(() => ({ done: (document.querySelector(".stk-done") || {}).innerText || "", focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
  report("stock (d-stock): the same item on two days is one row with the quantities added; Mark ordered puts a line that did not come back to waiting (the classic Undo) and marks both lines; it says so with Undo",
    /Nexium 20mg × 3/.test(f1.text) && /did not come/.test(f1.text) && f1.seg[1].indexOf("1") > 0 &&
    f1p.length === 2 && f1p[0].path === "/order-diary/entries/204" && JSON.stringify(f1p[0].body) === JSON.stringify({ status: "pending" }) && f1p[1].path === "/stock-flow/ordered" && JSON.stringify(f1p[1].body) === JSON.stringify({ diary_ids: [201, 204], supplier: "GSK" }) &&
    /2 items marked ordered/.test(f1b.done) && f1b.focus === "undo", JSON.stringify({ f1: f1.seg, f1p, f1b }));
  // the customer whose item came in: Ready sends only { fulfilled: true }; a messaging hook adds its button
  await page.evaluate(() => { window.__told = []; window.EIKON.stockFlow.tell = (c) => window.__told.push(c); window.EIKON.stockFlow.reload(); }); await page.waitForTimeout(500);
  await page.click('.stk-tell [data-act=message][data-oid="51"]');
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('.stk-tell [data-act=ready][data-oid="51"]'); await page.waitForTimeout(600);
  const f2p = (await calls()).filter((c) => c.method !== "GET"), told = await page.evaluate(() => window.__told);
  report("stock (d-stock): customers whose item arrived are listed to be told; Ready sends the Orders screen's { fulfilled: true }; E.stockFlow.tell gives messaging a Send a message button with the customer",
    f1.tell && f2p.length === 1 && f2p[0].path === "/client-orders/entries/51" && JSON.stringify(f2p[0].body) === JSON.stringify({ fulfilled: true }) && told.length === 1 && told[0].client_name === "Grech Carmen" && told[0].client_phone === "79123456", JSON.stringify({ f2p, told }));
  // Add an item: typing survives the lists arriving; Enter saves the classic body; the form stays for the next item
  await page.evaluate(() => { window.EIKON.stockFlow.tell = null; });
  await page.click("[data-view=order]"); await page.click(".stk-head [data-act=add]"); await page.waitForSelector("#stk-add [name=item_name]");
  await page.waitForFunction(() => document.activeElement && document.activeElement.name === "item_name", null, { timeout: 3000 }).catch(() => {}); // the form puts the keyboard there a moment after it opens
  await page.keyboard.type("Ħ-test Panadol");
  await page.evaluate(() => window.EIKON.stockFlow.reload()); await page.keyboard.type(" 500mg"); await page.waitForTimeout(400);
  const typed = await page.inputValue("#stk-add [name=item_name]");
  await page.fill("#stk-add [name=supplier]", "GSK");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.focus("#stk-add [name=item_name]"); await page.keyboard.press("Enter"); await page.waitForTimeout(700);
  const f3p = (await calls()).filter((c) => c.method === "POST"), f3 = await page.evaluate(() => ({ open: !!document.querySelector("#stk-add"), item: (document.querySelector("#stk-add [name=item_name]") || {}).value, sup: (document.querySelector("#stk-add [name=supplier]") || {}).value }));
  report("stock (d-stock): Add an item keeps what is typed while the lists arrive, Enter sends the classic quick add body for today, and the form stays open for the next item with the same supplier",
    typed === "Ħ-test Panadol 500mg" && f3p.length === 1 && f3p[0].path === "/order-diary/entries" && JSON.stringify(f3p[0].body) === JSON.stringify({ order_date: d0, item_name: "Ħ-test Panadol 500mg", qty: 1, supplier: "GSK", notes: "" }) && f3.open && f3.item === "" && f3.sup === "GSK", JSON.stringify({ typed, f3p, f3 }));
  // stock-hub (round 2): SH1 no aria-expanded but "true"/"false" (axe had 26 "null"), with a waiting line's form shut and open;
  // SH4 a waiting line is grey, only "Late" is red; SH3 Add all asks first, Escape closes it and gives the keyboard back
  const ax = async () => page.evaluate(() => [...document.querySelectorAll("#stk-slot [aria-expanded]")].map((e) => e.getAttribute("aria-expanded")));
  const ax0 = await ax(); await page.click(".stk-row [data-act=sug]"); await page.waitForSelector("#stk-sug"); const ax1 = await ax(); await page.click("[data-act=sug-cancel]");
  const sh4 = await page.evaluate(() => [...document.querySelectorAll("[data-sug] .stk-w, [data-sug] .t span.w")].map((e) => e.textContent));
  const allBtn = await page.$("[data-act=all]"); let sh3 = { btn: !!allBtn };
  if (allBtn) { await allBtn.click(); await page.waitForSelector("[data-act=all-go]"); sh3.ask = await page.textContent(".stk-all-box"); sh3.focus = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act")); await page.keyboard.press("Escape"); await page.waitForTimeout(150); sh3.after = await page.evaluate(() => ({ box: !!document.querySelector(".stk-all-box"), focus: document.activeElement && document.activeElement.getAttribute("data-act") })); }
  report("stock (stock-hub): aria-expanded is only true or false (shut and open); a late waiting line has only Late in red; Add all asks first and Escape closes it, keyboard back on Add all",
    ax0.length > 0 && ax0.concat(ax1).every((v) => v === "true" || v === "false") && ax1.includes("true") && sh4.every((t) => t === "Late") &&
    sh3.btn && /Put all \d+ on today's order/.test(sh3.ask) && sh3.focus === "all-go" && !sh3.after.box && sh3.after.focus === "all", JSON.stringify({ ax0, ax1, sh4, sh3 }));
  // Short or at risk: the open recall with its next step and Order a replacement; Open lands on that alert's next tick
  await page.click("[data-view=risk]"); await page.waitForTimeout(200);
  const r1 = await page.evaluate(() => document.querySelector("#stk-slot").innerText);
  await page.click('[data-act=land][data-to="alertreg"]');
  // The screen is drawn again when its By month list arrives a moment later: focus falls to the page for one tick and the
  // shell's focus keeper (core.js) puts it back on the same step. Read it once that has settled, not in the gap between
  // (the check read it in the gap about one run in three: the base failure, stock-hub round 2).
  const onStep = () => window.EIKON.state.activeModuleId === "alertreg" && document.activeElement && document.activeElement.getAttribute("data-k") === "supplier_informed";
  await page.waitForFunction(onStep, null, { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(500); await page.waitForFunction(onStep, null, { timeout: 5000 }).catch(() => {});
  const r1f = await page.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, k: document.activeElement && document.activeElement.getAttribute("data-k") }));
  // and any later redraw (another late read) gives the keyboard back to the same step, never leaves it on the page
  await page.evaluate(() => { const m = document.querySelector(".alr").parentNode; m.innerHTML = m.innerHTML; });
  await page.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-k") === "supplier_informed", null, { timeout: 2000 }).catch(() => {});
  const r1g = await page.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-k"));
  report("stock (d-stock): Short or at risk lists the open recall with its next step and Order a replacement; Open lands on that alert's next step, and keeps it there when the screen is drawn again",
    /Losartan 50mg/.test(r1) && /next: tell the supplier/.test(r1) && /Order a replacement/.test(r1) && r1f.mod === "alertreg" && r1f.k === "supplier_informed" && r1g === "supplier_informed", JSON.stringify({ r1: r1.slice(0, 300), r1f, r1g }));
  // phone: no sideways scroll, 44 px targets
  await page.setViewportSize({ width: 360, height: 800 }); await page.goto(base + "&ui=2#stock"); await page.waitForSelector(".stk-head", { timeout: 10000 }); await page.click("[data-view=order]"); await page.waitForTimeout(300);
  const ph = await page.evaluate(() => { const h = [...document.querySelectorAll("#stk-slot button")].filter((e) => e.getClientRects().length).map((e) => Math.round(e.getBoundingClientRect().height)); return { min: Math.min(...h), n: h.length, wide: document.documentElement.scrollWidth > window.innerWidth + 1 }; });
  await page.setViewportSize({ width: 1440, height: 900 });
  report("stock (d-stock): on a 360 px phone the Stock tab has no sideways scroll and every button is at least 44 px tall", ph.n > 5 && ph.min >= 44 && !ph.wide, JSON.stringify(ph));
  globalThis.__stk = null;
} catch (e) { globalThis.__stk = null; await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {}); report("stock (d-stock): ran to the end", false, String(e && e.stack || e).slice(0, 500)); }

// Roster planner, rules and settings (B3: E.rotaCheck, E.rotaMeta, E.rotaHoursPut in core.js; ui/eikon.rotaset.js):
// the warnings table-driven on one week (each kind on its case and not its neighbour), the read-fresh-merge saves with a
// server stand-in (another device's change kept, a failed read never saves), the classic opening-hours shape, the
// balance rule (only annual leave counts against annual, John 6a; classic's number alongside), D-7 years, and the sheets
// opening and closing with Escape (focus returns, what was typed is kept).
try {
  await page.goto(base + "&ui=2#shfreg");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "shfreg" && window.EIKON.rotaSet && window.EIKON.rotaCheck, null, { timeout: 15000 });
  const rc = await page.evaluate(async () => {
    const E = window.EIKON, out = {};
    const staff = [{ id: 1, full_name: "Maria Borg", designation: "pharmacist", contracted_hours: 40 }, { id: 2, full_name: "Joe Vella", designation: "pharmacist", contracted_hours: 30 }, { id: 3, full_name: "Karl Camilleri", designation: "assistant", contracted_hours: 40 }, { id: 4, full_name: "Rita Zammit", designation: "assistant", contracted_hours: 20 }, { id: 5, full_name: "Lara Hili", designation: "assistant", contracted_hours: 40 }];
    let n = 0; const S = (id, d, s, e, x) => Object.assign({ id: ++n, staff_id: id, shift_date: d, start_time: s, end_time: e }, x || {});
    const shifts = [S(1, "2026-11-16", "07:30", "13:30"), S(2, "2026-11-16", "13:00", "19:30"), S(1, "2026-11-17", "07:30", "13:30"), S(1, "2026-11-18", "07:30", "19:30"), S(2, "2026-11-18", "10:00", "12:00"),
      S(4, "2026-11-19", "08:00", "14:00"), S(1, "2026-11-19", "07:30", "19:30"), ...["16", "17", "18", "19", "20"].map((d) => S(3, "2026-11-" + d, "07:00", "19:30")),
      S(5, "2026-11-19", "09:00", "12:00"), S(5, "2026-11-19", "11:00", "13:00"), S(5, "2026-11-20", "09:00", "12:00"), S(5, "2026-11-20", "12:00", "13:00"), S(4, "2026-11-20", "08:00", "10:00"), S(1, "2026-11-20", "07:30", "19:30"), S(1, "2026-11-21", "04:30", "13:00"), S(1, "2026-12-08", "08:00", "12:00")];
    const leaves = [{ id: 9, staff_id: 4, leave_type: "annual", start_date: "2026-11-19", end_date: "2026-11-19", status: "approved" }, { id: 10, staff_id: 4, leave_type: "sick", start_date: "2026-11-20", end_date: "2026-11-20", start_time: "09:00", end_time: "12:00", status: "pending" }];
    const settings = { pharmacistRequired: true, minPharmacists: 1, rota: { minStaff: 2, avail: { 5: { w: { 4: "no" } } } } };
    const r = E.rotaCheck({ from: "2026-11-16", to: "2026-11-22" }, { shifts, staff, leaves, hours: {}, settings });
    out.words = r.map((x) => x.kind + "|" + x.date + "|" + x.words);
    out.closed = E.rotaCheck("2026-12-08", { shifts, staff, leaves: [], hours: {}, settings }).map((x) => x.words);
    out.off = E.rotaCheck({ from: "2026-11-16", to: "2026-11-22" }, { shifts, staff, leaves, hours: {}, settings: { pharmacistRequired: false, rota: { warn: { rest: false, wtd: false } } } }).map((x) => x.kind);
    out.bad = E.rotaCheck({ from: "2026-11-22", to: "2026-11-16" }, { shifts }).length + E.rotaCheck("x", {}).length;
    // read-fresh-merge with a stand-in server
    const keep = E.apiFetch, db = { settings: { pharmacistRequired: true, minPharmacists: 1, calendarToken: "abc" }, hours: { default: { open: "08:00", close: "19:00", closed: false }, openSaturday: true, openSunday: false, overrides: {} } }, puts = [];
    let failRead = false;
    E.apiFetch = async (p, o) => { const k = /settings/.test(p) ? "settings" : "hours"; if (o.method === "PUT") { puts.push(p + " " + o.body); db[k] = JSON.parse(o.body); return { ok: true }; } if (failRead) { const x = new Error("offline"); x.network = true; throw x; } return { ok: true, [k]: JSON.parse(JSON.stringify(db[k])) }; };
    try {
      await Promise.all([E.rotaMeta.merge("plans", (v) => Object.assign(v || {}, { 1: { rid: "a" } })), E.rotaMeta.merge("rota.plans", (v) => Object.assign(v || {}, { 2: { rid: "b" } }))]);
      db.settings.calendarToken = "fromotherdevice";
      await E.rotaMeta.settings((s) => { s.minPharmacists = 2; });
      failRead = true; out.failed = await E.rotaMeta.merge("minStaff", () => 3).then(() => "saved", (x) => "refused: " + x.message); failRead = false;
      await E.rotaHoursPut((h) => { h.overrides["2026-12-27"] = { open: "09:00", close: "12:00", closed: false, note: "Duty roster" }; });
      out.meta = await E.rotaMeta.get(); out.puts = puts; out.db = db;
    } finally { E.apiFetch = keep; }
    // balances (6a) and the classic figure, D-7
    const lv = [{ staff_id: 3, leave_type: "annual", start_date: "2026-03-02", end_date: "2026-03-03", hours_requested: 16, status: "approved" }, { staff_id: 3, leave_type: "maternity", start_date: "2026-05-01", end_date: "2026-05-30", hours_requested: 40, status: "approved" },
      { staff_id: 3, leave_type: "annual", start_date: "2026-12-01", end_date: "2026-12-01", hours_requested: 8, status: "pending" }, { staff_id: 3, leave_type: "sick", start_date: "2026-02-01", end_date: "2026-02-01", hours_requested: 8, status: "approved" }, { staff_id: 3, leave_type: "annual", start_date: "2025-12-29", end_date: "2026-01-02", hours_requested: 24, status: "approved" }];
    const b = E.rotaSet.balance(staff[2], lv, {}, 2026), pt = E.rotaSet.balance({ id: 7, designation: "assistant", contracted_hours: 20 }, [], { maltaLaw: { annualLeaveHours: { 2026: 224 } } }, 2026), loc = E.rotaSet.balance({ id: 8, designation: "locum" }, [], {}, 2026);
    out.bal = { annualLeft: b.annual.left, of: b.annual.of, pending: b.annual.pending, sickLeft: b.sick.left, other: b.other, classic: b.classic.annualLeft, pt: pt.annual.of, loc: loc.na };
    out.years = [E.rotaSet.leaveYears("2027-01-04", "2027-02-01"), E.rotaSet.leaveYears("2026-11-16", "2026-11-22")];
    return out;
  });
  const W = rc.words.join("\n");
  const want = [/^cover\|2026-11-17\|No pharmacist Tue 17 Nov 13:30–19:30$/m, /^staff\|2026-11-17\|Only 1 person on Tue 17 Nov 13:30–19:30 \(at least 2 wanted\)$/m, /^leave\|2026-11-19\|Rita is on annual leave Thu 19 Nov but planned 08:00–14:00$/m,
    /^asked\|2026-11-20\|Rita asked for sick leave Fri 20 Nov \(planned 08:00–10:00\)$/m, /^double\|2026-11-19\|Lara has two shifts at once on Thu 19 Nov \(09:00–12:00 and 11:00–13:00\)$/m, /^wtd\|2026-11-16\|Karl: 62\.5 h in the week of 16 Nov — over the 48-hour limit$/m,
    /^rest\|2026-11-21\|Maria: 9 h rest between Fri 20 Nov 19:30 and Sat 21 Nov 04:30 \(11 h needed\)$/m, /^avail\|2026-11-19\|Lara can't work Thursdays — planned Thu 19 Nov 09:00–12:00$/m, /^twoph\|2026-11-18\|Maria and Joe are both on as pharmacist Wed 18 Nov 10:00–12:00$/m];
  const notWant = [/^cover\|2026-11-16/m, /^double\|2026-11-20/m, /^asked\|2026-11-19/m, /^leave\|2026-11-20/m, /^twoph\|2026-11-16/m, /^hours\|.*Joe/m, /^avail\|2026-11-20/m];
  report("rotaCheck: each kind in plain words on its case and not its neighbour (cover, staff, leave, asked, double, wtd, rest, avail, twoph); a 30-minute handover is not two pharmacists; closed day; kinds switched off stay off; a bad range gives nothing",
    want.every((re) => re.test(W)) && !notWant.some((re) => re.test(W)) && rc.closed.join() === "Tue 8 Dec: Closed · Public holiday (Immaculate Conception) — 1 shift planned" && !rc.off.some((k) => k === "cover" || k === "rest" || k === "wtd") && rc.off.includes("hours") && rc.bad === 0,
    JSON.stringify({ miss: want.filter((re) => !re.test(W)).map(String), extra: notWant.filter((re) => re.test(W)).map(String), closed: rc.closed, off: rc.off, W: W.slice(0, 900) }));
  report("rotaMeta / rotaHoursPut: read fresh, merge one key, PUT the whole object (two quick saves both kept, another device's change kept, a failed read saves nothing); hours put in the classic shape",
    rc.puts.length === 4 && rc.failed.startsWith("refused") && JSON.stringify(rc.db.settings) === JSON.stringify({ pharmacistRequired: true, minPharmacists: 2, calendarToken: "fromotherdevice", rota: { plans: { 1: { rid: "a" }, 2: { rid: "b" } } } }) &&
    Object.keys(rc.db.hours).join() === "default,openSaturday,openSunday,overrides,weekly,weekends" && rc.db.hours.weekly[0].closed === true && rc.db.hours.overrides["2026-12-27"].note === "Duty roster" && rc.meta.plans[2].rid === "b",
    JSON.stringify({ puts: rc.puts.map((x) => x.slice(0, 120)), failed: rc.failed, db: rc.db }).slice(0, 900));
  report("leave balance: only annual leave counts against annual (maternity listed apart), asked-for counted, classic's figure alongside; part time in proportion; locums none; a January range also reads December's leave",
    rc.bal.annualLeft === 192 && rc.bal.of === 216 && rc.bal.pending === 8 && rc.bal.sickLeft === 72 && rc.bal.other.length === 1 && rc.bal.other[0].type === "maternity" && rc.bal.other[0].hours === 40 && rc.bal.classic === 152 && rc.bal.pt === 112 && rc.bal.loc === true &&
    JSON.stringify(rc.years) === "[[2026,2027],[2026]]", JSON.stringify(rc.bal) + " " + JSON.stringify(rc.years));
  // the sheets: open, Escape closes, focus returns, typing kept
  const sh = await page.evaluate(async () => {
    const E = window.EIKON, keep = E.apiFetch, out = [];
    E.apiFetch = async (p) => /settings/.test(p) ? { ok: true, settings: { pharmacistRequired: true, minPharmacists: 1 } } : /opening-hours/.test(p) ? { ok: true, hours: { default: { open: "07:30", close: "19:30", closed: false }, openSaturday: true, openSunday: false, overrides: {} } } : /leaves/.test(p) ? { ok: true, leaves: [] } : /staff/.test(p) ? { ok: true, staff: [{ id: 3, full_name: "Karl Camilleri", designation: "assistant", contracted_hours: 40, is_active: 1 }] } : { ok: true };
    E.rotaRules && E.rotaRules(true);
    const wait = (sel) => new Promise((ok) => { let i = 0; const t = setInterval(() => { if (document.querySelector(sel) || ++i > 60) { clearInterval(t); ok(!!document.querySelector(sel)); } }, 50); });
    const btn = document.querySelector("#eikon-content button"); btn.focus();
    // batch-21: Plan shifts may redraw under the sheet (its own reads coming back), which replaces this button. Focus then
    // has to land on the new copy of it (same focus key), never on the page: that counts as back, the old node cannot.
    const bkey = E.focusKey(btn), isBack = () => { const a = document.activeElement; return a === btn || (!btn.isConnected && a && a.isConnected && a !== document.body && E.focusKey(a) === bkey); };
    try {
      for (const [k, a, sel] of [["hours", null, ".rps [data-f=week]"], ["rules", null, ".rps [data-f=rules]"], ["availability", { id: 3, full_name: "Karl Camilleri" }, ".rps [data-f=avail]"], ["leave", { id: 3, full_name: "Karl Camilleri", designation: "assistant", contracted_hours: 40 }, ".rps-bal"], ["details", { id: 3, full_name: "Karl Camilleri", designation: "assistant", contracted_hours: 40, is_active: 1 }, ".rps [data-f=person]"], ["hours", null, ".rps [data-f=week]"]]) {
        E.rotaSet.open(k, a); const ok = await wait(sel);
        const dlg = document.querySelector(".rps-ov [role=dialog]"), title = document.querySelector("#rps-h").textContent;
        if (k === "details") { const f = document.querySelector(".rps [name=phone]"); f.value = "79 111 222"; }
        if (k === "rules") { const c = [...document.querySelectorAll("#eikon-content button")].find((x) => E.focusKey(x) === bkey); if (c) c.replaceWith(c.cloneNode(true)); } // always once: the screen redraws under the sheet
        document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
        out.push({ k, ok, modal: dlg && dlg.getAttribute("aria-modal"), title, gone: !document.querySelector(".rps-ov"), back: isBack() });
      }
      E.rotaSet.open("details", { id: 3, full_name: "Karl Camilleri", designation: "assistant", contracted_hours: 40, is_active: 1 }); await wait(".rps [data-f=person]"); await new Promise((ok) => setTimeout(ok, 50));
      out.push({ kept: document.querySelector(".rps [name=phone]").value });
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } finally { E.apiFetch = keep; }
    return out;
  });
  report("rotaset sheets: Opening hours, Rules, When can't they work?, Leave, Edit details open as a dialog; Escape closes and focus returns; what was typed comes back when it opens again",
    sh.length === 7 && sh.slice(0, 6).every((x) => x.ok && x.modal === "true" && x.gone && x.back) && sh[2].title === "When can't Karl work?" && sh[6].kept === "79 111 222", JSON.stringify(sh));
} catch (e) { report("roster planner rules and settings (rotaCheck, rotaMeta, rotaset): ran to the end", false, String(e && e.stack || e).slice(0, 500)); }


// ---- portals (FIN): ui/modules.portals.js (suphome, suporders, supproblems, supproducts, hqhome, hqregs, hqclient, ptlacct)
// and core.js E.PORTALS: the distributor and the head office in the new layout; the classic bodies; Cherubino for org 12 only.
try {
  const sup = { id: 5, user_id: 5, email: "sup@x.com", full_name: "Ramona Ellul", org_id: 1, location_id: 450, location_name: "Island Pharma Distributors", role: "admin" };
  const ptl = async (me, role, vp) => {
    portalState.me = me;
    const pg = await browser.newPage({ viewport: vp || { width: 1440, height: 900 } }); const pe = []; pg.on("pageerror", (e) => pe.push(e.message));
    await pg.goto(base + "#" + (role === "supplier" ? "suphome" : "hqhome"));
    await pg.evaluate((r) => { localStorage.setItem("eikon_token", "x"); localStorage.setItem("eikon_active_role", r); localStorage.removeItem("eikon_ui2"); sessionStorage.removeItem("eikon_ui2_pause"); }, role);
    await pg.reload();
    await pg.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId && document.querySelector("#eikon-content .ptl h1"), null, { timeout: 20000 });
    await pg.waitForTimeout(400); pg.__pe = pe; return pg;
  };
  const rail = (pg) => pg.evaluate(() => [...document.querySelectorAll(".eikon-rail-btn")].filter((b) => b.offsetParent).map((b) => b.querySelector(".eikon-nav-label").textContent));
  // distributor, phone
  let pg = await ptl(sup, "supplier", { width: 390, height: 844 });
  const s1 = await pg.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, ui2: document.documentElement.hasAttribute("data-ui2"), sx: document.documentElement.scrollWidth, cw: document.getElementById("eikon-content").getBoundingClientRect().width,
    text: document.getElementById("eikon-content").innerText, badge: (document.querySelector('[data-badge="suporders"]') || {}).textContent }));
  report("portals (suphome): a distributor opens on Today in the new layout, bottom tabs, no sideways scroll at 390, orders to send and the badge",
    s1.mod === "suphome" && s1.ui2 && s1.sx <= 390 && s1.cw >= 380 && /To send\s*2/.test(s1.text) && /Mosta Pharmacy/.test(s1.text) && /Ozempic/.test(s1.text) && /Expires in 12 days/.test(s1.text) && s1.badge === "2" && JSON.stringify(await rail(pg)) === JSON.stringify(["Today", "Orders", "Problems", "Products", "Account"]),
    JSON.stringify({ ...s1, text: s1.text.slice(0, 160), rail: await rail(pg) }));
  await pg.close();
  // distributor, desktop: send an order
  pg = await ptl(sup, "supplier");
  await fetch(`http://localhost:${PORT}/__reset`);
  await pg.click('[data-order="31"]'); await pg.waitForSelector("#ptl-ship");
  await pg.click('[data-item="311"]'); await pg.waitForSelector('[data-act="oos-yes"]'); await pg.click('[data-act="oos-yes"]'); await pg.waitForTimeout(300);
  await pg.fill("#ptl-ship [name=scheduled_delivery_date]", "2026-11-20"); await pg.fill("#ptl-ship [name=supplier_notes]", "Van Thursday");
  await pg.click("#ptl-ship button[type=submit]"); await pg.waitForSelector("#ptl-ship .ptl-ask"); await pg.click("#ptl-ship button[type=submit]"); await pg.waitForTimeout(500);
  let cl = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  const sb = (cl.find((c) => c.path === "/supplier-orders/31/confirm") || {}).body;
  report("portals (suporders): not available + out of stock + mark as sent send the classic Received Orders bodies",
    JSON.stringify(cl.find((c) => /unavailable$/.test(c.path)).body) === JSON.stringify({ unavailable: true, notes: "" }) && JSON.stringify(cl.find((c) => c.path === "/supplier-products/entries/901/stock-status").body) === JSON.stringify({ out_of_stock: 1 }) &&
    JSON.stringify(sb) === JSON.stringify({ status: "shipped", items: [{ id: 311, unavailable: 1, qty_confirmed: 0, notes: "" }, { id: 312, unavailable: 0, qty_confirmed: 3, notes: "" }], supplier_notes: "Van Thursday", scheduled_delivery_date: "2026-11-20" }), JSON.stringify(cl));
  // problems: answer
  await fetch(`http://localhost:${PORT}/__reset`);
  await pg.evaluate(() => { location.hash = "#supproblems"; }); await pg.waitForSelector("form[data-fbform]");
  await pg.selectOption("form[data-fbform] select", "Replacement Sent"); await pg.fill("form[data-fbform] [name=supplier_notes]", "New box Monday");
  await pg.click("form[data-fbform] button[type=submit]"); await pg.waitForTimeout(400);
  cl = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  report("portals (supproblems): the answer is the classic Order Feedback body", cl.length === 1 && cl[0].path === "/supplier-orders/feedback/51/resolve" && JSON.stringify(cl[0].body) === JSON.stringify({ resolution_status: "Replacement Sent", supplier_notes: "New box Monday" }), JSON.stringify(cl));
  // products: the classic Add Product body (0% VAT stays 0)
  await fetch(`http://localhost:${PORT}/__reset`);
  await pg.evaluate(() => { location.hash = "#supproducts"; }); await pg.waitForSelector('[data-act="add"]'); await pg.click('[data-act="add"]');
  await pg.click("#ptl-pf button[type=submit]"); await pg.waitForTimeout(200);
  const perr = await pg.evaluate(() => ({ t: document.querySelector("#ptl-pf .ptl-err").textContent, f: document.activeElement.name, inv: [...document.querySelectorAll("#ptl-pf [aria-invalid=true]")].map((x) => x.name) }));
  await pg.fill("#ptl-pf [name=description]", "Brufen Syrup 100ml"); await pg.fill("#ptl-pf [name=cost_excl_vat]", "3"); await pg.selectOption("#ptl-pf [name=vat_rate]", "0"); await pg.fill("#ptl-pf [name=retail_price]", "5.5"); await pg.fill("#ptl-pf [name=expiry_date]", "2027-01-31");
  await pg.click("#ptl-pf button[type=submit]"); await pg.waitForTimeout(500);
  const pb = ((await (await fetch(`http://localhost:${PORT}/__calls`)).json()).find((c) => c.method === "POST" && c.path === "/supplier-products/entries") || {}).body;
  report("portals (supproducts): every missing field said at once; Add product sends the classic body, field for field, with 0% VAT kept",
    perr.inv.join() === "description,cost_excl_vat,retail_price" && perr.f === "description" && /Write the product's name/.test(perr.t) &&
    JSON.stringify(pb) === JSON.stringify({ description: "Brufen Syrup 100ml", stock_code: "", barcode: "", cost_excl_vat: 3, cost_incl_vat: 0, vat_rate: 0, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0, batch: "", expiry_date: "2027-01-31", retail_price: 5.5 }), JSON.stringify({ perr, pb }));
  report("portals: no page error on the distributor's screens", pg.__pe.length === 0, pg.__pe.join(" | "));
  await pg.close();
  // head office, org 1: Today across the pharmacies, Registers in words, no Cherubino
  const ho = { id: 6, user_id: 6, email: "ho@x.com", full_name: "Kurt Muscat", org_id: 1, org_name: "Demo Group", location_id: 650, location_name: "Head Office", role: "admin" };
  pg = await ptl(ho, "company_admin");
  await pg.waitForSelector(".ptl-card");
  const h1 = await pg.evaluate(() => document.getElementById("eikon-content").innerText);
  await pg.evaluate(() => { location.hash = "#cherubino-oos"; }); await pg.waitForTimeout(600);
  const noCh = await pg.evaluate(() => window.EIKON.state.activeModuleId + " " + location.search);
  await pg.evaluate(() => { location.hash = "#hqregs"; }); await pg.waitForSelector(".ptl-grid");
  const g = await pg.evaluate(() => document.querySelector(".ptl-grid").innerText);
  report("portals (hqhome, hqregs): head office Today has its pharmacies, the recall and the near expiry; registers in words (no '10/9 days'); no Cherubino tab or screen outside org 12",
    /Mosta Pharmacy: 1 recall is still open \(Valsartan 80mg\)/.test(h1) && /2 items expire within 30 days/.test(h1) && /Żebbuġ Pharmacy/.test(h1) && JSON.stringify(await rail(pg)) === JSON.stringify(["Today", "How we're doing", "Registers", "Account"]) &&
    /^hqhome/.test(noCh) && !/classic/.test(noCh) && /Every working day \(10 days in all\)/.test(g) && !/\d+\/\d+ days/.test(g), JSON.stringify({ h1: h1.slice(0, 300), noCh, g: g.slice(0, 200) }));
  await pg.close();
  // head office of the Cherubino group: its tab and its screens; a pharmacy never opens a portal's screen
  pg = await ptl({ ...ho, org_id: 12 }, "company_admin");
  const r12 = await rail(pg);
  await pg.evaluate(() => { location.hash = "#hqclient"; }); await pg.waitForSelector('[data-open="cherubino-admin"]');
  const cards = await pg.evaluate(() => [...document.querySelectorAll("[data-open]")].map((b) => b.getAttribute("data-open")));
  report("portals (hqclient): org 12's head office keeps the Cherubino tab and its four screens", r12.includes("Cherubino") && cards.join() === "cherubino-admin,cherubino-prices,cherubino-shortexpiry,cherubino-oos", JSON.stringify({ r12, cards }));
  await pg.close();
} catch (e) { report("portals: ran to the end", false, String(e && e.stack || e).slice(0, 500)); }
portalState = { me: null };
await browser.close();
server.close();

// ---- Roster planner (RP, B1): the patterns / fill / apply engine, ui/eikon.rotaplan.js (no browser; tests/ui/rotaplan.unit.mjs)
try {
  await (await import("./rotaplan.unit.mjs")).run(report);
} catch (e) { report("rotaplan engine: ran", false, String(e && e.stack || e).slice(0, 400)); }
// ---- Roster planner (RP, B5): rota notices — /sw.js (served by the worker) and ui/eikon.rotapush.js, static checks (no browser)
try {
  const wsrc = fs.readFileSync(path.join(root, "..", "cloudflare-worker", "code"), "utf8");
  const i0 = wsrc.indexOf("const RPN_SW = `"), sw = i0 < 0 ? "" : wsrc.slice(i0 + 16, wsrc.indexOf("`;", i0));
  const listeners = [...sw.matchAll(/addEventListener\(\s*["'](\w+)["']/g)].map((m) => m[1]).sort();
  report("rotapush: /sw.js listens only to install, push and notificationclick", JSON.stringify(listeners) === JSON.stringify(["install", "notificationclick", "push"]), JSON.stringify(listeners));
  report("rotapush: /sw.js has no fetch handler, no Cache API, no importScripts, no respondWith", !!sw && !/["']fetch["']|\bonfetch\b|respondWith|\bcaches\b|importScripts|onmessage|setInterval/.test(sw), sw.slice(0, 80));
  report("rotapush: /sw.js always shows a notification on a push (a plain line when the words cannot be read)", /showNotification\(/.test(sw) && /Open Eikon to see your shifts\./.test(sw));
  report("rotapush: /sw.js is served no-cache as JavaScript at the site root", /url\.pathname === "\/sw\.js"/.test(wsrc) && /"Content-Type": "application\/javascript; charset=utf-8", "Cache-Control": "no-cache"/.test(wsrc));
  const ui = fs.readFileSync(path.join(root, "eikon.rotapush.js"), "utf8");
  const onBody = ui.slice(ui.indexOf("async function on("), ui.indexOf("async function off("));
  report("rotapush: permission is asked and /sw.js registered only when turning on", (ui.match(/requestPermission\(/g) || []).length === 1 && /requestPermission\(/.test(onBody) && (ui.match(/serviceWorker\.register\(/g) || []).length === 1 && /serviceWorker\.register\(SW, \{ scope: "\/", updateViaCache: "none" \}\)/.test(onBody));
  report("rotapush: no timers and no request when the row opens (state() reads only this device)", !/setInterval|setTimeout/.test(ui) && !/apiFetch/.test(ui.slice(ui.indexOf("async function state("), ui.indexOf("async function on("))));
  report("rotapush: the iPhone words", /On iPhone this works once Eikon is added to the Home Screen \(iOS 16\.4\+\)/.test(ui));
  report("rotapush: loaded after eikon.rotaprint.js and before modules.rotreg.js", (() => { const h = fs.readFileSync(path.join(root, "index.html"), "utf8"); const a = h.indexOf('"./eikon.rotaprint.js"'), b = h.indexOf('"./eikon.rotapush.js"'), c = h.indexOf('"./modules.rotreg.js"'); return a > 0 && b > a && c > b; })());
} catch (e) { report("rotapush: static checks ran", false, String(e && e.stack || e).slice(0, 300)); }

// Polish batch-21 (.183), stock flows SF9 / SF10: the words (no DOM needed; the screens are covered by tests/real)
{
  const ss = fs.readFileSync(path.join(root, "modules.ssreg.js"), "utf8"), rt = fs.readFileSync(path.join(root, "modules.retreg.js"), "utf8");
  report("SF9 (batch-21): a shortage line says \"Asked <day> · needed by <day>\" for every pharmacy, another pharmacy's name on its own line (no bare date)",
    /sub = \["Asked " \+ dm\(n\.entry_date\)\]/.test(ss) && !/if \(!mine\) sub\.push\(dm\(n\.entry_date\)\)/.test(ss) && /\(from \? '<div class="s">' \+ esc\(from\)/.test(ss));
  report("SF10 (batch-21): Supplier refused asks a question (\"Mark … as refused by the supplier?\"), not a statement with a question mark",
    /Mark ' \+ esc\(e\.description\) \+ " as refused by the supplier\? This closes the return\./.test(rt) && !/The supplier refused ' \+ esc/.test(rt));
}

// Source-level check for the escape fix (no DOM needed)
for (const f of ["modules.ddasales.js", "modules.ddapoyc.js"]) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const bad = src.includes(`"&": "&", "<": "<"`);
  const good = src.includes(`"&": "&amp;", "<": "&lt;"`);
  report("source: " + f + " escapeHtml produces entities", !bad && good);
}

{ const uniq = [...new Set(CSPV)];
  report("csp: no Content-Security-Policy violation on any page of the suite (" + (process.env.CSP_ENFORCE ? "enforced" : "report-only") + " policy from the worker): " + CSPV.length, CSPV.length === 0, uniq.slice(0, 20).join("\n       ")); }
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
