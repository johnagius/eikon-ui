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
  if (!p.startsWith("/team/users")) return false;
  if (teamState.me.role !== "admin") return J({ ok: false, error: "Forbidden" }, 403);
  const m = p.split("/").filter(Boolean);
  if (m.length === 2 && req.method === "GET") return J({ ok: true, users: teamState.users, me: 1, admins_manage_admins: false });
  if (m.length === 2 && req.method === "POST") {
    if (teamState.users.some((u) => u.email === body.email)) return J({ ok: false, error: "That e-mail already has a sign-in" }, 409);
    const u = { id: teamState.next++, email: body.email, full_name: body.full_name, role: body.role, is_active: true, must_change_password: true, last_sign_in_at: null, signed_in_devices: 0, protected: false };
    teamState.users.push(u); return J({ ok: true, user: u, temporary_password: "k7mp-q4xa-9rtd" });
  }
  const u = teamState.users.find((x) => x.id === Number(m[2]));
  if (!u) return J({ ok: false, error: "Not found" }, 404);
  if (m[3] === "password") { u.must_change_password = true; u.signed_in_devices = 0; return J({ ok: true, temporary_password: "w2hn-8cxe-pt3v" }); }
  if (m[3] === "active") { u.is_active = !!body.active; if (!u.is_active) u.signed_in_devices = 0; return J({ ok: true }); }
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
function mockApi(req, res, body) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  calls.push({ method: req.method, path: p, query: url.search, body });
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
// Every register is rebuilt now; a screen that is not (Loyalty) still opens in classic.
await page.fill("#tdy-q", "loyalty");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => location.search.indexOf("ui=classic") >= 0 && window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "loyalty", null, { timeout: 15000 });
const openedModule = await page.evaluate(() => location.hash + " " + (document.documentElement.hasAttribute("data-ui2") ? "new" : "classic"));
report("today: search opens a waiting customer's order in the new Orders screen, DDA stock takes in the new layout, and a screen not yet rebuilt in classic", openedCustomer === "#ordreg new" && openedStock === "#ddstreg new" && openedModule === "#loyalty classic", `${openedCustomer} | ${openedStock} | ${openedModule}`);
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
  bkBtn0.exp === null && !bkBtn0.classicBtn && bkBtn0.strip.join() === "Orders,Questions,Deliveries,Bookings,Loyalty (classic look)" && bkSet.hash === "#bookings" && !bkSet.classic && bkSet.carry && bkSet.carry.name === "Zammit Carmel" &&
  bkBtn.exp === null && bkBtn.strip.join() === "Orders,Questions,Deliveries,Bookings,Loyalty (classic look)" && bkGo.hash === "#bookings" && bkGo.carry && bkGo.carry.name === "Zammit Carmel", JSON.stringify({ bkBtn0, bkSet, bkBtn, bkGo }));
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
report("step 1: the counts and the strip open rebuilt registers in the new layout (Orders, Questions and Deliveries showing the person; Show all clears it); only Loyalty is labelled classic look, appointments go to Bookings",
  chips.join("|") === "DDA sale 1|Loyalty 1(classic look)" && strip.join() === "Orders,Questions,Deliveries,Bookings,Loyalty (classic look)" && ddaGo.hash === "#cdsreg" && !ddaGo.classic &&
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
  report("near expiry: Offer sends the classic Add to Scarce Stock body (today, item, expiry, batch, a whole number at least 1, open, the item's id); not for an expired item; the footer no longer sends offers to the classic screen",
    !nexOfferExpired && nexOf0.focus === "qty" && nexOf0.qty === "1" && /Other pharmacies see it in Scarce stock/.test(nexOf0.say) && nexOfPosts.length === 1 && nexOfPosts[0].path === "/scarce-stock/offers" &&
    JSON.stringify(Object.keys(ob)) === JSON.stringify(["entry_date", "item_name", "expiry_date", "batch", "quantity_available", "is_closed", "near_expiry_id"]) && ob.entry_date === todayYmd && ob.item_name === "Amoxil 500mg" && ob.expiry_date === maltaYmd(10) && ob.batch === "B12" && ob.quantity_available === 1 && ob.is_closed === 0 && ob.near_expiry_id === 1 &&
    /Supplier refused and damaged stock are in the/.test(nexFoot) && !/offers/.test(nexFoot), JSON.stringify({ nexOfferExpired, nexOf0, nexOfPosts, nexFoot }));
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
  report("alerts: Change opens the alert's own form on the item; Save changes sends the classic Edit body (every field in its order, trimmed, steps 0 or 1); the footer keeps only deleting",
    alE0.focus === "item_name" && alE0.item === "Losartan 50mg" && alE0.notes === "Shelf C" && alE0.status === "open" && alE0.store === "room" && alE0.date === maltaYmd(0) && alEPuts.length === 1 && alEPuts[0].path === "/alerts/entries/41" &&
    JSON.stringify(Object.keys(eb)) === JSON.stringify(["entry_date", "alert_type", "status", "item_name", "batch", "expiry", "quantity", "reason", "storage_location", "supplier", "notes", "team_informed", "supplier_informed", "authorities_informed", "return_arranged", "handed_over", "collection_note_received", "credit_note_received"]) &&
    eb.status === "in_progress" && eb.notes === "Moved to fridge" && eb.item_name === "Losartan 50mg" && eb.batch === "L9" && eb.team_informed === 1 && eb.supplier_informed === 0 &&
    /Deleting an alert is in the/.test(alFoot) && !/details|notes/.test(alFoot), JSON.stringify({ alE0, alEPuts, alFoot }));
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

// Questions, changing one: the whole classic body from a fresh read, only the edit different; staff see no Delete; the
// pharmacist's Delete adds the reason as a note first; Done reads resolved=1.

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

// Orders: after a new order, the classic screen's next question in place: its items into the order diary (the classic
// call: one line, the order's day, qty 1, the supplier typed, no notes); "Not now" and Escape add nothing.

// Questions: an open question prints on the classic one-question page; the customer's email is a mail link on the card.

// Customers' registers, quality pass (Orders, Questions, Deliveries, Vaccines, Contacts): every problem in a form at once,
// each beside its field (aria-invalid + aria-describedby) and summed up in one alert, nothing sent; typing in a field
// clears its mark; Escape closes an untouched form or line and gives focus back to what opened it (a form with typing
// stays); a search redraws only the list (the box keeps its node and focus); section headings are not in capitals; the
// back button comes from the tab the screen belongs to; on a phone the buttons are 44 px tall.
let qStep = "orders";

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
  report("returns (b4-6a): with returns listed, New return is the heading's button; the footer no longer says new returns are in classic", rtTop.top && /Changes, deleting and refused or damaged stock/.test(rtTop.foot) && !/New returns/.test(rtTop.foot), JSON.stringify(rtTop));
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

// q6-2 (BACKLOG6 item 2): Bookings does the whole job. Change time sends {version,date,start} and a 409 offers the next
// times; any day with ‹ › Today and a date box; past days read only with what happened; the phone calls; a known
// customer's name opens the card; N opens New booking; a half-typed booking comes back; Settings asks before throwing
// a change away; the list refreshes every minute but never under an open sheet.

// The calendar (2026-11): tomorrow as columns of time; free time is a button (tap books there, with Repeat); a walk-in
// starts now; blocked time shows and can be unblocked; reminders say who to call and Confirmed records the call; a move
// can skip the e-mail (notify:false) and offers the freed time to the waiting list; old Appointments come over in one tap.
bkCal.on = false; bkCal.legacy = false;

// Quality pass (Today, Customers, Bookings, search, rail): mistakes said next to the field, the cleaner remembered,
// typing never lost while free times load, Enter does what the big button says, Maltese capitals found.

// Offline save: the connection drops on Record. The message says so, what was typed stays, and the list is not
// swapped for "Can't reach the server" by the re-read that follows (it fails too).

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

// Vaccines: the old link opens the new screen; Kenya brings its recommendations; a tapped vaccine and the client go in one POST shaped like the classic one.

// End of day: Today's "Close the day" link opens the new screen; the difference follows the typing (comma decimals);
// Save sends the whole record once, under every name the server reads, with no locked_at; a save by another till
// in between is refused (no PUT) until the person chooses to save over it.

// End of day: a saved day reads the same whether its bag counts were stored as numbers (classic) or strings (older new-screen saves).

// Money screens (best-in-class pass): a new End of day names the person signed in and keeps Save and the over/under in reach on a
// phone; a missing value puts the cursor in its box, marked and announced, and sends nothing (End of day, Paid out, Credit notes);
// typing in the credit-note search redraws only the list; an empty POS basket shows no payment buttons; plain words in the export.
await page.setViewportSize({ width: 1440, height: 900 }).catch(() => {});

// b4-4 counter forms with sensible defaults. Orders / Deliveries / Questions: Today · Tomorrow · the working day after
// (Sunday skipped) under the date; a tap writes that date into the field and is what is sent; Orders has no hidden
// default (no tap, no date: still refused). Today's cleaning: the name is already there, the team is suggested, one tap
// or Enter records. End of day: one summary line for day/staff/shift/float, Tab from it lands on the first X reading,
// Enter goes on to the next amount, "Nothing counted yet" until a figure is typed; an untouched summary saves the same.



// q5-6: End of day starts right. A new day's float is the last saved day's (this month or the month before), said under the
// summary line; a different float says "Float changed from …" in amber; no saved day, or one that cannot be read, says why
// the float is €1000.00; an earlier day takes the shift of the day before it; Enter on Change opens it; Ctrl+Enter there
// sends nothing; untouched, the save sends the float shown.

// Plan shifts in the new layout: the old #shifts link lands here; a change sends the whole record (role and note kept);
// add sends one POST; Remove asks first, then DELETE; Approve sends the classic approve call.
await page.unroute(/\/shifts\/assignments-range/).catch(() => {}); await page.unroute(/\/shifts\/leaves\?/).catch(() => {});

// BACKLOG4 6c, Team: the standing instructions are changed in Handover with the classic Instructions screen's call (the
// whole global set, read afresh, only permanent_handover changed); a change made elsewhere meanwhile is never
// overwritten; Escape closes and focus goes back to Change.

// BACKLOG4 6c, Team: a new leave request in Plan shifts sends the classic Leave tab's body (hours as it works them out:
// 8 for each weekday, or a part day's hours); every problem is said at once with nothing sent; locums are not offered;
// Who's in's "ask for leave" opens the form; the footers no longer send new leave requests to classic.

// POCT in the new layout: the old #poct link lands on it; a known ID card fills the patient; a high glucose is marked in words;
// one PUT with the record and the whole patient card in the classic shape, and never a delete or a wipe.

// POCT, one test (10b): Print beside a test opens the classic one-test page; Change loads the test into the form (no test
// choice, its own time) and Save changes sends that record again under its own id, with no person check and no delete.

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
// Audit trail print: the shared register printout (pharmacy, period, page numbers, landscape), the rows on screen; back to Settings

// Adverse reactions: the old link opens the new screen under Services; a new report is one PUT with only that report
// (classic fields, empty deleted_ids); a correction sends the whole report back with only the change (unknown fields kept).

// Screening campaigns: the old link opens the new screen under Services; recording a screening is one PUT of that one
// campaign, whole (the person already in it, a field the screen does not know, kept), with the new person in the classic shape and an empty deleted_ids.

// Contraceptive pills: the old #ocps link opens the new lookup under Services; the classic list of 21; the classic
// filters (type, dose, mg/mcg) narrow as you type; a tap on a pill shows the ones with the same hormones and doses;
// nothing is sent to the server.

// Dispensing labels: the old link opens the new screen under Services; a medicine labelled before fills its dose; Print
// opens the classic print page (no inline script: Eikon prints it from the opener, CSP) and sends one PUT with only that
// entry and the settings unchanged.
// Supplier stock: the old link opens the new screen under Stock; the deal line goes in at 10 and 14 snaps back to 10;
// sending posts the classic's order body once; the draft is saved with PUT (never DELETE); Mark as received sends only the status.
// Over the counter (new layout otcreg): the old link opens it under Services; it reads the classic OTC mindmap's own
// files (no API call); a symptom shows its products in the classic's score order; a product shows its cautions first,
// in words; search ranks like the classic; Escape steps back; nothing wider than a phone.
// Services group, quality pass: a form with several problems says them all at once, marks each field (aria-invalid) and
// focuses the first; nothing is sent; typing in a marked field unmarks it. POCT opens on the last test type recorded;
// screening offers "Record the next person" after a save; a failed load says why with Try again; OTC typing never
// replaces the search box; the calculators open on the last one used; Services group names are not in capitals.
// Emergency POS in the new layout: the old link lands on it; Enter adds the first match; Exact fills the cash; a double-click on Take
// sends one POST with the classic body and sums; a refused save (500) keeps the basket and Take again resends the same offline_id.
// Controlled-drug medicine box (new layout): a brand finds the generic ("ativ" → Lorazepam — Ativan), the classic fixed
// list and the pharmacy's own earlier entries are offered, the keyboard chooses, and choosing sends nothing.
// Pharmacy calculators in the new layout: the old #pharmacycalc link lands on it under Registers; the levothyroxine default
// works out live (12 weeks of 100/125 mcg = 4 boxes); methotrexate 7,5 mg (a comma) from 5 mg halves is 12 tablets; a known
// name fills the ID card; Save and print is one POST in the classic shape and prints; a saved plan prints again; no deletes.
// Possible duplicates: Customers links to a read-only view that groups one person written differently in three sections
// (ID card typed two ways, phone typed two ways), leaves out a namesake with another ID card, hides a group on "Not the same
// person" with Undo, and never writes to the server.
// Possible duplicates with the server's people links: no Link button on a server without the routes (the live worker
// today); with them, "Same person — link" sends the group's records once, the group moves to "Linked as one person",
// Undo sends exactly the ids the link made and the group is back. No other write.
// Where things live (2026-11-03): money and clinical services left Registers. Old links land on the same screens; the rail
// lights the new tab and each screen's back button names it; on phones the six-word bar has More (Team, Services, Money).
// People known here, offered as an ID card or a name is typed (eikon.personpick.js): a part of an ID card lists the
// person, arrow + Enter fills the ID card (padded), name and address with a quiet "Filled from"; a complete ID card
// fills only empty fields (a typed name stays); a name suggests in Orders and fills the phone; only reads are sent.
// A name typed first-name-first, or in part, still finds the person ("carmel zam" -> Zammit Carmel, not Zammit Paul);
// the server is asked for the longest word, every word is checked here; choosing fills the ID card.
// ---- Clean addresses (eikonhq.com/today). Insert in tests/ui/run.mjs just before "// screenshot for the review".
// The page at a one-word path is index.html with the worker's mark (as handleAppPage serves it); /ui/index.html stays hash-based.
// Orders: Ready on an order with no phone (saved blank, or dropped by this screen before 3 Nov) asks for the phone and sends it
// as client_phone: the server refuses any change to an order without one. Cancelling the question sends nothing.
// One person across screens (ui/eikon.people.js): the shared normaliser is the worker's own (its two functions are read
// from cloudflare-worker/code and run side by side); after a register saves, the person is found in GET /people and
// reused, a blank is filled through the server's own path, two possible matches link nothing, and only an unknown
// person is added; the register's own POST body is unchanged; Customers' "+ New" opens an existing match.
// ---- Download our records (expreg): a mocked year 2025 exported as a workbook (read back with SheetJS in the page),
// the same year as CSV files in a zip when the spreadsheet library is missing, at most 2 requests in flight, a month per
// request, Cancel saves nothing, and a staff account gets a note instead of the screen (and no card in Settings).
// ---- How we're doing (ownreg): the period maths in Malta days, what needs the pharmacist, one request per period, a
// figure opens its records (Escape closes, focus back), a week and the month before, a group's head office choosing a
// pharmacy, staff kept out, and the three reports printed (pharmacy, page numbers, Malta time) and as spreadsheets.
// ---- Inspection check (insreg, backlog 3 item 9): each check's maths on fixed data with a fixed Malta day, the reads it
// makes (a month per call, 3 in flight at most, stock-take months skip the DDA reads), the screen from Registers, its links
// to the exact month, the printout with sign-off lines, and the first page of the inspection pack.
// People's names in Title Case (ui/eikon.people.js): the UI's function is the worker's (read from cloudflare-worker/code and run
// side by side); in the new layout a name field is cased when it is left, a mixed-case name and other fields are kept as typed.
// Error reports (backlog 7): a thrown error on a screen is one POST /client-log with build, screen id, kind, scrubbed
// message and stack, and nothing typed in the form; the overlay does not send it twice; a screen that crashes while
// drawing is one "render" report; never more than 5 per page load.
// CSP report-only (backlog 2-9): a violation event is one POST /client-log, kind "csp", with the directive, the blocked
// origin only (no path, no query) and file:line; csp reports have their own 5 a load, so real errors are still sent.
// ---- Registry (ui/registry.js): the new layout lists the classic screens without downloading them.
// (a) every module file registers exactly what its registry rows say; (b) the CLASSIC list in index.html is the
// "classic" rows; (c) a signed-in new-layout page downloads no classic file, and E.modules has the same ids, order,
// titles, icons and order numbers as a page with every file loaded; (d) E.loadClassic() brings the real screens in.
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

// ---- q5-7: search and suggestions find what a pharmacist types (BACKLOG5 item 7) ----
// Maltese letters folded both ways (E.people.foldMt / mtStretch), cards before names seen only in the registers, and
// the new phrases ("log fridge" on the fridge's line, "hand over", "help", "what's new", "print dda", "paid out",
// "credit note", "new leave", "standing instructions"). The mock's /people lowers only A to Z, as the worker's LIKE.
// The ID card on a record and its person (E.people.confirmPerson in ui/eikon.people.js), in DDA sales, Orders and
// Repeat prescriptions: A (the person has no card: asked to add it, then their card-less records offered to tick),
// B (the card is someone else's: stopped, never saved under the wrong name), C (the person has another card: asked to
// change it everywhere, with the count per register). GET/POST /people and the change endpoint answered here.
// Classic layout chosen for this browser: the top bar offers the way back ("Use the new layout"), which opens Today in the new layout.
// Busiest-screen polish (backlog 2 item 7)
// wide registers: a table at 1200 px and up, the two-line list on a phone
// ---- Team sign-ins (backlog 2 item 4): People who sign in, forced change at first sign-in, idle lock, first-run list
const teamCalls = async (f) => (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter(f);
const modalClick = (pg, label) => pg.evaluate((l) => { const b = [...document.querySelectorAll("#eikon-modal-actions button")].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);

// First-run list on Today (admin only, only while something is missing; the counts come with GET /today)
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
teamState = teamFresh();
teamState = teamFresh();
// Classic pharmacy calculators: Warfarin "Clear" puts every field back (it threw on an undefined preferSel half way through).

// b4-9: Today reads right at any hour (display only: the same one GET /today, nothing else)
todayState = { tempDone: false, cleanDone: false };

// b4-10: one word for one thing: New X opens, Save X saves, success says Saved · what for who; Waiting / Done; ID card on Deliveries

// batch 6 (W3): the server issues the number; the success line shows the server's (r.ticket_id / r.delivery_id), and
// the device's own when an older server sends none (the b4-10 checks above).
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

// Stock screens, best in class (near expiry, returns, transfers, alerts, order diary, price check, shortages, scarce stock,
// supplier stock): the way back is the shared one, a shelf check adds item after item, the last supplier is remembered,
// Escape closes a form and focus comes back, a failed load offers Try again, searching never redraws the box being typed
// in, a one-tap save keeps a keyboard user's place, and on a phone every button is 44 px with no sideways scroll.

// Focus is never lost (BACKLOG4 item 2): a screen opened from a link puts focus on its heading with the main button one
// Tab away; N opens the main form; Ctrl/Cmd+Enter saves from a text box; Escape cancels (and never throws away typing);
// after a save or a redraw focus is on a control or the heading, never on the page; it never jumps out of a form being
// typed in; Today goes to the next check after Log; the search dialog lists the keys. The classic layout is left alone.

// ---- Out-of-limits readings: the note is written where the reading is shown; a missed day is logged late (BACKLOG3 item 2) ----

// Correct a register line in the new layout (ui/eikon.correct.js), one screen each: the pharmacist's Correct re-reads
// the line, a reason is required (nothing is sent without one), and the PUT body is the line as the server returned it
// (every field of the classic edit body) with only the corrected field changed, plus correction_reason. The line then
// shows who corrected it and why (the audit), and a staff sign-in sees no Correct.


// ---- Help and What's new for the new layout (help-next.js, whatsnew.json; BACKLOG3 item 10).
// (a) every new-layout screen in registry.js has a guide, and each guide has a purpose and at least one task;
// (b) whatsnew.json is valid: dated entries (real dates, not in the future), newest first, unique ids, plain words;
// (c) nothing of the help is downloaded with the app; the "?" opens the screen's own guide; Escape returns focus.
// BACKLOG5 item 9: help matches the screen. (a) every "Press X" in a guide is a button the screen draws, and no guide
// uses a technical word; (b) on every new-layout screen, the footer's "… is in the classic screen" sentences are the
// guide's "Still in the classic screen" paragraph word for word, and that paragraph names no button the screen has.
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
globalThis.__b47 = false; b47 = null;

// BACKLOG4 item 8: honest when the connection drops (banner, verdict words, the retry guard, E.postOnce after a late save)

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

// Money 10a: Credit notes prints one note (the classic one-note page, through E.openPrint) and keeps its notes (add:
// the classic POST with the text trimmed; remove: the pharmacist, one question, the classic DELETE); End of day copies
// the deposit for the bank email (the classic's HTML and plain text) after the classic's check (a bag number).

// Sentence case app-wide (one rule in ui/app.css): no element of a new-layout screen is drawn in capitals, and the
// section labels share one look (13 px, semibold, no caps spacing). Typed text in fields is not touched.

// People suggestions with ċ ġ ħ ż (ui/eikon.personpick.js wire()): the server's LOWER()/LIKE know only A to Z, so a
// name with them is sent as its longest stretch without them; every typed word is still checked in the browser.

// The month bar's printout (ui/eikon.months.js) stamps "printed" in Malta time, whatever the device's clock zone.

// Shared form problems and loading rows (core.js E.formErrors / E.skeleton), and the screens switched to them.

// q5-5 (BACKLOG5 item 5): Today stays short (5 most pressing, "and N more", older than 30 days closed) and Open lands on
// the exact order, question or delivery (the one hand-over note, mode "open"): row marked, in view, focus on its main
// button; typing during the landing is never taken; Ready from the landed row sends what Ready from the list sends.
// Getting this pharmacy ready counts by evidence and has Not now (D2).
todayState = { tempDone: false, cleanDone: false }; teamState = teamFresh();
await page.setViewportSize({ width: 1440, height: 900 });

// BACKLOG5 item 11: the same word on screen and in print. The registers with Correct say where deleting is (a link to
// the classic screen, which opens it), the classic link is called "classic screen" everywhere, the buttons say what they
// do, Download our records names the controlled-drug registers as the registers do, and the temperature month print
// names the pharmacy's own room sensor "Room", as Today does (the stored name after it).

// ---- q5-2: nothing typed is lost when you leave a form (BACKLOG5 item 2, core.js E.draft) ----
// Six New forms, each left half-typed by Back, the tab bar, the search and its hub link, come back exactly as typed with
// "Your unsaved … is back · Clear"; nothing is written meanwhile. A person carried from Customers wins (the draft is
// offered, not merged). Drafts are per pharmacy and person, end with the Malta day, never hold a password, and go at sign-out.

// ---- q6-1 (BACKLOG6 item 1): typing survives "Reload this screen" and a session that ends (core.js E.showErrorBar,
// E.handleSessionExpired, E.renderLogin, E.draft). For a New order, controlled drug sale, payment and daily register
// line: Reload this screen brings the half-typed form back; a 401 (and a sign-out in another tab) keeps it before the
// sign-in card, which says so, has the e-mail filled in and the cursor in Password; the same person signing in again
// is back on that screen with the form as typed. Someone else signing in sees none of it, and it is gone from the tab.
// Nothing is sent by itself.

// q5-1 (BACKLOG5 item 1): nothing ever freezes the app.
// (a) After boot an unexpected error is a calm bar (role=alert, focus kept, what is typed kept, Reload / Close; Close
//     or Escape in it puts it away and focus back; the same error does not bring it back), reported once; the
//     full-screen notice stays for a failure while starting ("Eikon could not start", Try again, no DevTools words)
//     and for dbg=2. (b) Escape from Order diary's and Locum receipts' first field with suggestions loaded throws
//     nothing. (c) The classic look never sticks: a load without ?ui=classic ends the visit, a route from the visit to
//     a rebuilt screen opens it in the new layout, the visit's own screen and Settings > Classic layout are untouched.
// q5-8 (BACKLOG5 item 8): busy lists drawn 30 at a time, 44 px targets on a phone, no ring round a title focused after a tap,
// and the red rail badge readable on the lit Customers tab.

// d-cust: the customer record (waiting now, good to know, loyalty, messages in the story) and Tell the customer (E.tell).
// The new routes are answered here (page.route) as the worker's d-cust block answers them.

// Stock tab, one ordering flow (d-stock). On a server without the /stock-flow routes (404): the open lines still show,
// arrivals are ticked under To order, customer orders wait to be put on an order. With them: ordered per supplier,
// arrivals tell which customers are waiting, Ready sends only { fulfilled: true }, typing survives the data arriving.

// Roster planner, rules and settings (B3: E.rotaCheck, E.rotaMeta, E.rotaHoursPut in core.js; ui/eikon.rotaset.js):
// the warnings table-driven on one week (each kind on its case and not its neighbour), the read-fresh-merge saves with a
// server stand-in (another device's change kept, a failed read never saves), the classic opening-hours shape, the
// balance rule (only annual leave counts against annual, John 6a; classic's number alongside), D-7 years, and the sheets
// opening and closing with Escape (focus returns, what was typed is kept).

await browser.close();
server.close();

// ---- Roster planner (RP, B1): the patterns / fill / apply engine, ui/eikon.rotaplan.js (no browser; tests/ui/rotaplan.unit.mjs)
// ---- Roster planner (RP, B5): rota notices — /sw.js (served by the worker) and ui/eikon.rotapush.js, static checks (no browser)

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
