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

const here = fileURLToPath(new URL(".", import.meta.url));
const root = path.join(here, "..", "..", "ui");
const PORT = 8781;
const mime = { html: "text/html", js: "application/javascript", css: "text/css", png: "image/png", gif: "image/gif", json: "application/json", svg: "image/svg+xml" };

const calls = []; // every non-asset request the UI makes
const todayYmd = new Date().toISOString().slice(0, 10);
const genericList = {
  ok: true, entries: [], items: [], rows: [], data: [], results: [], devices: [], staff: [], assignments: [], leaves: [], settings: {}, state: {},
  appointments: [], slots: [], doctors: [], clinics: [], schedules: [], waitlist: [], campaigns: [], clients: [], transactions: [], records: [], patients: [],
  orders: [], products: [], offers: [], needs: [], messages: [], pinned: [], suggestions: [], contacts: [], dates: [], notes: [], report: { entries: [] },
  catalog: [], sales: [], feedback: [], changes: [], global: {}, daily: null, locations: [], receipts: [], stocktakes: [], certificates: [],
  unread_mentions: 0, unread_messages: 0
};

let todayState = { tempDone: false, cleanDone: false };
function todayPayload() {
  const t = todayYmd;
  return {
    ok: true, date: t, time: "09:12", timezone: "Europe/Malta", pharmacy: { name: "Demo Pharmacy", location_id: 12, org: "Test" },
    before_opening: [
      { kind: "temperature", device_id: 7, title: "Fridge 1 · reading", sub: "Yesterday 3.8 to 6.4 · limits 2 to 8", status: todayState.tempDone ? "done" : "todo", out_of_range: false, limits: { min: 2, max: 8 }, yesterday: todayState.yOut ? { min: 3.8, max: 9.1 } : { min: 3.8, max: 6.4 }, today: todayState.tempDone ? { min: 3.9, max: 6.1 } : null, action: { method: "POST", path: "/temperature/entries", body: { device_id: 7, entry_date: t }, fields: ["min_temp", "max_temp", "notes"], label: "Log" } },
      { kind: "daily_register", title: "Daily register", sub: "No entry yet today", status: "todo", count_today: 0, action: { type: "open", path: "#dailyregister", label: "Open" } },
      { kind: "cleaning", title: "Cleaning", sub: "Last done 14 days ago by Karl", status: todayState.cleanDone ? "done" : "overdue", days_since: 14, last_date: "2026-10-17", action: { method: "POST", path: "/cleaning/entries", body: { entry_date: t }, fields: ["time_in", "cleaner_name", "staff_name"], label: "Done now" } }
    ].filter((x) => !(todayState.noFridge && x.kind === "temperature")),
    customers_waiting: [
      { kind: "order", id: 1, name: "Grech Carmen", phone: "79123456", detail: "Augmentin 625 ×14", code: "A1B2C3", needed_by: t, pickup_date: t, priority: 1, waiting_days: 0, due_today: true, action: { type: "open", path: "#clientorders", label: "Open" } },
      { kind: "question", id: 2, ref: "TKT-00001", name: "Vella Joseph", phone: "79000000", detail: "do you stock the Omron M3 monitor?", status: "Open", priority: 2, waiting_days: 3, followup_date: null, action: { type: "open", path: "#tickets", label: "Reply" } }
    ].concat(todayState.delivery ? [{ kind: "delivery", id: 7, ref: "DEL-00004", name: "Camilleri Rita", phone: "79222333", detail: "12 Triq il-Kbira, Mosta", slot: "Afternoon", status: "Scheduled", due_date: "2026-11-01", late_days: 1, cold: true, controlled: false, action: { type: "open", path: "#deliveries", label: "Open" } }] : []).concat([
    ]),
    attention: [
      { kind: "near_expiry", expired_count: 0, due30_count: 1, first: "Enalapril 20mg", first_expiry: t, title: "1 expiring within 30 days", action: { type: "open", path: "#nearexpiry", label: "Open" } },
      { kind: "certificate", title: "Fire extinguisher", status: "due_soon", due: t, days: 12, action: { type: "open", path: "#certificates", label: "Open" } }
    ],
    takings: { end_of_day_saved: false, end_of_day_locked: false, paid_out_today: 12.5, paid_out_count: 1, action: { type: "open", path: "#endofday", label: "Close the day" } },
    stock: { supplier_orders_pending: 1, supplier_orders_shipped: 0 },
    team: { on_today: [{ name: "Maria", role: "pharmacist", from: "09:00", to: "19:00" }, { name: "Karl", role: "assistant", from: "13:00", to: "19:00" }], handover_incoming: [{ text: "Courier at 16:00, box for Dr Galea", sev: "g" }, { text: "Methadone for Mr Vella at 9", sev: "r" }], notes_today: "" },
    counts: { before_opening: (todayState.tempDone ? 0 : 1) + 1 + (todayState.cleanDone ? 0 : 1), customers_waiting: 2, attention: 2 },
    ...(teamState.setup && teamState.me.role === "admin" ? { setup: teamState.setup } : {}) // as the worker: admins only, absent on an older server
  };
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
let peopleState = { adopted: false, carmel: { id: 1, name: "Zammit Carmel", id_card: "0012345M", phone: "79123456", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", date_of_birth: "", notes: "", source: "history", version: 1, updated_at: "2026-10-31 09:00:00" } };
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
function mockApi(req, res, body) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  calls.push({ method: req.method, path: p, query: url.search, body });
  if (p === "/__test401") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Unauthorized" })); }
  if (teamMock(req, res, p, body)) return;
  if (p === "/people" && req.method === "POST") {
    if (body && body.id) { res.writeHead(409, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Changed elsewhere", current: Object.assign({}, peopleState.carmel, { notes: "Call after 5", version: 2 }) })); }
    peopleState.adopted = true;
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, created: true, person: peopleState.carmel }));
  }
  if (/^\/dda-stocktakes\/stocktakes\/\d+\/report\/html$/.test(p)) { // the printable page is HTML, as the worker's
    const sid = Number(p.split("/")[3]), its = ddstState.items.filter((i) => i.stocktake_id === sid);
    res.writeHead(200, { "content-type": "text/html" }); return res.end("<!doctype html><title>DDA Stock Take</title><h1>Demo - DDA Stock Take</h1><table>" + its.map((i) => "<tr><td>" + i.item_name + "</td><td>" + i.qty_tablets + "</td></tr>").join("") + "</table>");
  }
  if (globalThis.__dupLinks === "404" && p.indexOf("/people/links") === 0) { res.writeHead(404, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Not found" })); } // as the live worker without the routes
  res.writeHead(200, { "content-type": "application/json" });
  if (p === "/people") return res.end(JSON.stringify({ ok: true, q: url.searchParams.get("q") || "", people: (peopleState.adopted ? [peopleState.carmel] : []).concat([{ id: 2, name: "Zammit Paul", phone: "79000001", id_card: "", version: 1 }]), history: peopleState.adopted ? [] : [{ key: "id:0012345M", name: "Zammit Carmel", id_card: "0012345M", phone: "", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", sources: { dda_sale: 1, loyalty: 1 }, last_date: "2026-10-05" }] }));
  if (p === "/people/1") return res.end(JSON.stringify({ ok: true, person: peopleState.carmel, loyalty: { points: 1120, stamps: 3, visits: 2, last_date: "2026-10-20" }, next_appointment: { id: 9, ref: "A-2", date: "2026-11-04", time: "09:30", status: "Scheduled", doctor: "Dr Galea" }, activity: [{ kind: "dda_sale", label: "DDA sale", date: "2026-10-05", title: "Morphine 10mg", ref: "S-1", doctor: "Dr Abela" }, { kind: "loyalty", label: "Loyalty", date: "2026-09-01", title: "", ref: "" }], counts: { dda_sale: 1, loyalty: 1 } }));
  if (p === "/today") return res.end(JSON.stringify(todayPayload()));
  if (p === "/auth/me") return res.end(JSON.stringify({ ok: true, user: { id: 1, user_id: 1, email: "p@x.com", full_name: "Maria Borg", org_id: 1, location_id: 12, location_name: "Demo Pharmacy", role: "admin" } }));
  if (p === "/temperature/devices") return res.end(JSON.stringify({ ok: true, devices: [{ id: 7, name: "Fridge 1", device_type: "fridge", min_limit: 2, max_limit: 8, active: 1 }] }));
  if (p === "/temperature/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [] }));
  if (p === "/dda-purchases/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [{ id: 5, entry_date: todayYmd, dda_name_dose: "Morphine 10mg", quantity: 2, agent: "Supplier", invoice_number: "INV-1" }] }));
  if (p === "/temperature/entries" && req.method === "POST") { todayState.tempDone = true; return res.end(JSON.stringify({ ok: true, entry_id: 1 })); }
  if (p === "/client-orders/entries" && req.method === "GET") {
    const q = new URL(req.url, "http://x").searchParams, d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    if (q.get("from")) return res.end(JSON.stringify({ ok: false, error: "Missing/invalid month (YYYY-MM)" })); // like the live server today (no ranges)
    const thisMonth = new Date().toISOString().slice(0, 7);
    return res.end(JSON.stringify({ ok: true, entries: q.get("month") !== thisMonth ? [] : [
      { id: 51, order_date: d(-3), client_name: "Grech Carmen", client_phone: "79123456", items_text: "Augmentin 625 x14", priority: 2, needed_by: d(-1), deposit_amount: 0, fulfilled: 0, notes: "" },
      { id: 52, order_date: d(-1), client_name: "Vella Joseph", client_phone: "79000111", items_text: "Nexium 20mg", priority: 1, needed_by: d(3), deposit_amount: 5, fulfilled: 0, notes: "", order_code: "KX7P2Q" }] }));
  }
  if (p.startsWith("/client-orders/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/client-tickets/entries" && req.method === "GET") {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 61, ticket_id: "TKT-00007", open_date: d(-4), client_name: "Camilleri Rita", phone: "79222333", email: "rita@x.com", category: "Prescription", priority: 2, status: "Open", issue: "Is her repeat ready?", assigned_to: "John", followup_date: d(-1), notes_log: JSON.stringify([{ ts: "2026-10-30T09:00:00Z", author: "Maria", text: "Called, no answer" }]), resolved: 0 },
      { id: 62, ticket_id: "TKT-00008", open_date: d(-1), client_name: "Farrugia Tony", phone: "", category: "Billing", priority: 1, status: "In Progress", issue: "Charged twice", assigned_to: "", followup_date: null, notes_log: "[]", resolved: 0 }] }));
  }
  if (p.startsWith("/client-tickets/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/client-tickets/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry_id: 63 }));
  if (p === "/client-deliveries/entries" && req.method === "GET") {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
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
  if (p === "/instructions/daily" && req.method === "GET" && hndGap) { const y = url.searchParams.get("ymd"), ago = (n) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10); return res.end(JSON.stringify({ ok: true, record: { ymd: y, notes: "", handover_out: y === ago(2) ? [{ id: "s1", sev: "y", text: "Saturday: fridge engineer Monday" }] : [] } })); } // nothing yesterday (a closed Sunday)
  if (p === "/instructions/daily" && req.method === "GET") { const y = url.searchParams.get("ymd"); return res.end(JSON.stringify({ ok: true, record: y === todayYmd ? { ymd: y, notes: "Inspector may visit", handover_out: [{ id: "t1", sev: "g", text: "Already for tomorrow" }] } : { ymd: y, notes: "", handover_out: [{ id: "y1", sev: "g", text: "Restock gloves" }, { id: "y2", sev: "r", text: "Methadone at 9" }] } })); }
  if (p === "/instructions/daily" && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/instructions/global" && req.method === "GET") return res.end(JSON.stringify({ ok: true, global: { permanent_handover: { text: "Count the CD cupboard every evening" } } }));
  if (p === "/shifts/staff" && req.method === "GET") return res.end(JSON.stringify({ ok: true, staff: [{ id: 1, full_name: "Maria Borg", designation: "Pharmacist" }, { id: 2, full_name: "Karl Vella", designation: "Assistant" }] }));
  if (p === "/shifts/assignments-range") return res.end(JSON.stringify({ ok: true, shifts: [{ id: 1, staff_id: 1, shift_date: todayYmd, start_time: "08:00", end_time: "14:00" }] }));
  if (p === "/shifts/leaves" && req.method === "GET") return res.end(JSON.stringify({ ok: true, leaves: [{ id: 1, staff_id: 2, leave_type: "sick", start_date: todayYmd, end_date: todayYmd, status: "approved" }, { id: 2, staff_id: 1, leave_type: "annual", start_date: todayYmd, end_date: todayYmd, status: "rejected" }] }));
  if (p === "/repeat-prescriptions/entries" && req.method === "GET") { const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return res.end(JSON.stringify({ ok: true, entries: [{ id: 81, entry_date: d(-170), expires_date: d(12), client_name: "Zammit Carmel", client_id: "123456M", medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: "Dr Abela", prescriber_reg_no: "R1201" }] })); }
  if (p === "/repeat-prescriptions/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry_id: 82 }));
  if (p === "/creditnotes/list") return res.end(JSON.stringify({ ok: true, entries: [{ id: 91, issue_date: "2026-10-01", client_name: "Rita", client_surname: "Camilleri", telephone: "79222333", amount: 30, expiry_date: "", no_expiry: false, purchase_entries: [{ id: 1, amount: 12.5 }], notes: [] }] }));
  if (/^\/creditnotes\/entries\/\d+\/purchases$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 2 }));
  if (p === "/locumreceipts/receipts" && req.method === "GET") return res.end(JSON.stringify({ ok: true, receipts: url.searchParams.get("month") === todayYmd.slice(0, 7) ? [{ id: 5, receipt_date: todayYmd.slice(0, 7) + "-01", hours: 6, locum_full_name: "Paul Vella", registration_number: "PH1234", day_type: "normal", fee_per_hour: 15, total_fee: 90 }] : [] }));
  if (p === "/locumreceipts/receipts" && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 6 }));
  if (p === "/order-diary/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: url.searchParams.get("date") === todayYmd ? [{ id: 101, order_date: todayYmd, item_name: "Augmentin 625", qty: 2, supplier: "Actavis", status: "pending", notes: "For Mrs Borg" }] : [] }));
  if (p.startsWith("/order-diary/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/order-diary/items") return res.end(JSON.stringify({ ok: true, items: [] }));
  if (p === "/quotations/entries" && req.method === "GET") return res.end(JSON.stringify({ ok: true, entries: [
    { id: 1, quote_date: "2026-10-29", item_description: "Panadol 500mg x24", supplier: "GSK", vat_rate: 18, cost_excl_vat: 2.4, discount_euro: 0, qty_purchased: 10, qty_free: 0, retail_price: 4.5 },
    { id: 2, quote_date: "2026-11-01", item_description: "Panadol 500mg x24", supplier: "Actavis", vat_rate: 18, cost_excl_vat: 2.6, discount_euro: 0, qty_purchased: 10, qty_free: 2, retail_price: 4.5 }] }));
  if (p === "/quotations/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, id: 3 }));
  if (p === "/scarce-stock/needs" && req.method === "GET") return res.end(JSON.stringify({ ok: true, needs: [
    { id: 7, org_name: "Demo Org", location_name: "Demo Pharmacy", entry_date: todayYmd, item_name: "Ozempic 1mg pen", quantity_needed: 3, remaining_quantity: 1, mine_owner: 1, offers: [{ id: 70, quantity_offered: 2, offerer_display: "Sliema Group — Sliema Pharmacy", note: "", mine: 0, accepted: 0, confirmed: 0 }] },
    { id: 8, org_name: "Gozo Group", location_name: "Victoria Pharmacy", entry_date: todayYmd, item_name: "Insulin pen needles", quantity_needed: 5, remaining_quantity: 5, mine_owner: 0, offers: [] }] }));
  if (/^\/scarce-stock\/need-offers\/\d+\/(accept|confirm)$/.test(p) && req.method === "POST") return res.end(JSON.stringify({ ok: true }));
  // Bookings: one service, one practitioner working weekdays 09:00–13:00, one booking late today.
  if (p === "/bookings/setup") return res.end(JSON.stringify({ ok: true, services: [{ id: 1, name: "Blood pressure", durationMin: 15, priceCents: 0, active: true, online: true, providerIds: [1] }],
    providers: [{ id: 1, name: "Maria Borg", title: "Pharm.", speciality: "", active: true, serviceIds: [1], hours: { "1": [["09:00", "13:00"]], "2": [["09:00", "13:00"]], "3": [["09:00", "13:00"]], "4": [["09:00", "13:00"]], "5": [["09:00", "13:00"]] } }] }));
  if (p === "/bookings" && req.method === "GET") return res.end(JSON.stringify({ ok: true, bookings: [{ id: 501, serviceId: 1, providerId: 1, date: todayYmd, start: "23:50", end: "23:59", personName: "Anna Vella", personPhone: "79000000", status: "booked" }] }));
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
  if (p === "/endofday/record" && req.method === "GET") return res.end(JSON.stringify({ ok: true, record: url.searchParams.get("date") === todayYmd ? eodState.rec : null }));
  if (p === "/endofday/record" && req.method === "PUT") { const r = (body && body.record) || {}; eodState.rec = Object.assign({}, r, { id: 1, updated_at: "2026-11-03 18:0" + (++eodState.n) + ":00", locked_at: r.locked_at ? "2026-11-03 18:30:00" : "" }); return res.end(JSON.stringify({ ok: true, record: eodState.rec })); }
  if (p === "/endofday/dates") return res.end(JSON.stringify({ ok: true, dates: eodState.rec ? [todayYmd] : [] }));
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
    const ym = new Date().toISOString().slice(0, 7);
    if (p === "/dda-sales/entries") return res.end(JSON.stringify({ ok: true, entries: url.searchParams.get("month") === ym ? [{ id: 502, entry_date: todayYmd, client_name: "Zammit Carmel", client_id_card: "12345 m", medicine_name_dose: "Morphine 10mg", prescription_serial_no: "S1" }] : [] }));
    if (p === "/appointments/entries") return res.end(JSON.stringify({ ok: true, appointments: [{ id: 503, patientName: "C Zammit", patientIdCard: "0012345M", patientPhone: "+356 79123456", date: todayYmd, time: "10:00", apptRef: "APT-1" }] }));
    if (p === "/loyalty/clients") return res.end(JSON.stringify({ ok: true, clients: [{ id: 504, name: "Carmel Zammit", id_card: "0099999M", created_at: todayYmd }] }));
  }
  if (p === "/alerts/entries" && req.method === "GET") {
    const d = new Date().toISOString().slice(0, 10);
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
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 11, entry_date: d(-5), description: "Amoxil 500mg", expiry: d(20), batch: "LOT77", quantity: "3", supplier: "GSK", invoice_number: "INV-9", remarks: "Expiring soon", location_stored: "Back room",
        return_arranged: 1, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 },
      { id: 12, entry_date: d(-3), description: "Ventolin", expiry: d(-1), batch: null, quantity: "1", supplier: "GSK", invoice_number: null, remarks: null, location_stored: null,
        return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 }] }));
  }
  if (p.startsWith("/returns/entries/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/near-expiry/entries" && req.method === "GET") {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return res.end(JSON.stringify({ ok: true, entries: [
      { id: 1, product_name: "Amoxil 500mg", expiry_date: d(10), location: "Shelf A3", notes: "", return_id: null, return_status: "" },
      { id: 2, product_name: "Ventolin", expiry_date: d(-2), location: "Fridge", notes: "", return_id: null, return_status: "" },
      { id: 3, product_name: "Augmentin", expiry_date: d(200), location: "", notes: "", return_id: 7, return_status: "pending" }] }));
  }
  if (p === "/near-expiry/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry: { id: 9 } }));
  if (p === "/near-expiry/entries/create-return" && req.method === "POST") return res.end(JSON.stringify({ ok: true, return_id: 8 }));
  if (p === "/certificates/items" && req.method === "GET") {
    const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
    return res.end(JSON.stringify({ ok: true, items: [
      { id: 1, title: "Thermometer Calibration", subtitle: "Yearly calibration", interval_months: 12, last_date: d(-380), next_due: d(-15), requires_person: 0, certified_person: "" },
      { id: 2, title: "AC Maintenance", subtitle: "Yearly service", interval_months: 12, last_date: d(-100), next_due: d(265), requires_person: 0, certified_person: "" },
      { id: 3, title: "First Aid Certificate", subtitle: "3 year renewal", interval_months: 36, last_date: null, next_due: null, requires_person: 1, certified_person: "" }] }));
  }
  if (p.startsWith("/certificates/items/") && req.method === "PUT") return res.end(JSON.stringify({ ok: true }));
  if (p === "/locumregister/entries" && req.method === "GET") {
    const mo = new URL(req.url, "http://x").searchParams.get("month") || "", cur = new Date().toISOString().slice(0, 7);
    const old = { id: 5, entry_date: "2026-10-05", time_in: "08:00", time_out: "14:00", locum_full_name: "Pharm. Anna Grech", registration_number: "P1234" };
    return res.end(JSON.stringify({ ok: true, entries: mo !== cur ? [old] : [] }));
  }
  if (p === "/locumregister/entries" && req.method === "POST") return res.end(JSON.stringify({ ok: true, entry: { id: 6 } }));
  if (p === "/daily-register/entries" && req.method === "GET") {
    const mo = new URL(req.url, "http://x").searchParams.get("month") || "", cur = new Date().toISOString().slice(0, 7);
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
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
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
report("today: opens first under the flag, light shell, no intro, headline and rows render", today1.hash === "#today" && today1.light && !today1.intro && /3 things before the doors open/.test(today1.h1) && today1.rows === 5 && today1.oldLink, JSON.stringify(today1));
report("today: the screen is one request", todayCalls >= 1 && otherGets === 0, `today=${todayCalls} otherGets=${otherGets} ${JSON.stringify(callsBoot.map((c) => c.path))}`);

// blank fridge fields are refused, nothing posted
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('.tdy-row[data-kind="temperature"] [data-act="temp"]');
await page.waitForTimeout(300);
let posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST");
const toastBlank = await page.evaluate(() => Array.from(document.querySelectorAll(".eikon-toast")).map((t) => t.textContent).join(" | "));
report("today: blank fridge fields post nothing and say so", posts.length === 0 && /Nothing was saved/.test(toastBlank), `posts=${posts.length} toast=${toastBlank}`);

// typing min, max and pressing Enter logs the fridge with the right body and the row turns done
await page.fill('.tdy-row[data-kind="temperature"] [data-min]', "3,9"); // a comma, as some keyboards type it
await page.fill('.tdy-row[data-kind="temperature"] [data-max]', "6.1");
await page.press('.tdy-row[data-kind="temperature"] [data-max]', "Enter");
await page.waitForTimeout(900);
posts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/temperature/entries");
const afterLog = await page.evaluate(() => ({ h1: document.querySelector(".tdy-head h1").textContent, pill: (document.querySelector('.tdy-row[data-kind="temperature"] .tdy-pill') || {}).textContent, inputs: document.querySelectorAll('.tdy-row[data-kind="temperature"] input').length }));
report("today: min (typed with a comma), max, Enter logs the fridge in one request and the row turns done", posts.length === 1 && posts[0].body && posts[0].body.device_id === 7 && posts[0].body.min_temp === 3.9 && posts[0].body.max_temp === 6.1 && /Logged 3.9 to 6.1/.test(afterLog.pill || "") && afterLog.inputs === 0 && /2 things/.test(afterLog.h1), JSON.stringify({ posts, afterLog }));

// cleaning: Done now asks for one name, then records
await fetch(`http://localhost:${PORT}/__reset`);
await page.click('.tdy-row[data-kind="cleaning"] [data-act="clean"]');
await page.waitForTimeout(200);
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
report("shell: the rail is Today, Customers, Bookings, Stock, Registers, Services, Money, Team, Settings and nothing else", JSON.stringify(shell.rail) === JSON.stringify(["Today", "Customers", "Bookings", "Stock", "Registers", "Services", "Money", "Team", "Settings"]) && shell.cats === 0 && !shell.help && !shell.search && shell.topbar === "none" && shell.mark && shell.pharmacy === "Demo Pharmacy" && shell.who === "Maria Borg" && /^\d+$/.test(shell.badgeToday || ""), JSON.stringify(shell));
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
await page.fill("#tdy-q", "zammit");
await page.press("#tdy-q", "Enter");
await page.waitForFunction(() => location.hash === "#customers" && document.querySelector("#cus-q") && document.querySelector("[data-hist]"), null, { timeout: 8000 });
await page.waitForTimeout(300);
const cus1 = await page.evaluate(() => ({ q: document.querySelector("#cus-q").value, people: document.querySelectorAll("[data-person]").length, hist: document.querySelectorAll("[data-hist]").length, rail: !!document.querySelector('.eikon-nav-btn[data-mod="customers"]'), histText: document.querySelector("[data-hist] .cus-t span").textContent }));
const peopleGets = (await callsNow()).filter((c) => c.path === "/people" && c.method === "GET");
// Enter opens the first result (eikon.search.js): Zammit Carmel, known only from the registers, so Customers opens on her ID card.
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

// Step 1: the hand-over. One tap opens the register's own form, filled; nothing is posted until Save.
const outDirShots = () => { const d = process.env.SHOTS_DIR || path.join(here, "shots"); fs.mkdirSync(d, { recursive: true }); return d; };
const closeModal = async () => { await page.evaluate(() => { const ov = document.querySelector(".eikon-modal-overlay"); if (!ov) return; const b = Array.from(ov.querySelectorAll("button")).find((x) => /^(Cancel|Close)$/i.test(x.textContent.trim())); if (b) b.click(); else ov.remove(); }); await page.waitForTimeout(200); };
const carryTo = async (hash, selector) => {
  await page.goto(base + "&ui=2#customers");
  await page.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector("#cus-q"), null, { timeout: 15000 });
  await page.fill("#cus-q", "zammit");
  await page.waitForFunction(() => document.querySelector('[data-person="1"]'), null, { timeout: 8000 });
  await page.click('[data-person="1"]');
  await page.waitForFunction((h) => document.querySelector('[data-carry="' + h + '"]'), hash, { timeout: 8000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click('[data-carry="' + hash + '"]');
  await page.waitForFunction((sel) => location.hash && document.querySelector(sel) && document.querySelector(sel).value, selector, { timeout: 20000 });
  await page.waitForTimeout(200);
};
await carryTo("#clientorders", "#co-client");
const ord = await page.evaluate(() => ({ hash: location.hash, classic: !document.documentElement.hasAttribute("data-ui2"), name: document.querySelector("#co-client").value, phone: document.querySelector("#co-contact").value, addr: document.querySelector("#co-address").value, email: document.querySelector("#co-email").value, carry: sessionStorage.getItem("eikon_carry_person"), back: document.getElementById("eikon-back-btn").textContent, backShown: document.getElementById("eikon-back-btn").style.display !== "none" }));
let carryPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path !== "/auth/login");
report("step 1: New order opens the classic order form with the person filled, nothing posted, hand-over used up, one button back", ord.hash === "#clientorders" && ord.classic && ord.name === "Zammit Carmel" && ord.phone === "79123456" && ord.addr === "1 Triq il-Knisja" && ord.carry === null && carryPosts.length === 0 && /New Eikon/.test(ord.back) && ord.backShown, JSON.stringify({ ord, carryPosts }));
await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(outDirShots(), "06 Customer to order (classic form).png") });
await closeModal();

await carryTo("#tickets", "#tk-client");
const tk = await page.evaluate(() => ({ name: document.querySelector("#tk-client").value, phone: document.querySelector("#tk-phone").value }));
await closeModal();
await carryTo("#deliveries", "#dv-client");
const dv = await page.evaluate(() => ({ name: document.querySelector("#dv-client").value, phone: document.querySelector("#dv-phone").value, addr: document.querySelector("#dv-address").value }));
await closeModal();
// A pharmacy that has not set up Bookings keeps the Appointment button (classic Appointments); one that has gets Booking.
await page.evaluate(() => { localStorage.setItem("eikon_bk_ready_1_12", "1"); });
await page.goto(base + "&ui=2#customers"); await page.waitForFunction(() => document.querySelector("#cus-q"), null, { timeout: 15000 });
await page.fill("#cus-q", "zammit"); await page.waitForFunction(() => document.querySelector('[data-person="1"]'), null, { timeout: 8000 }); await page.click('[data-person="1"]');
await page.waitForFunction(() => document.querySelector(".cus-actions"), null, { timeout: 8000 });
const bkBtn = await page.evaluate(() => ({ booking: !!document.querySelector('.cus-actions [data-act="book"]'), appt: !!document.querySelector('.cus-actions [data-carry="#appointments"]') }));
await page.evaluate(() => { Object.keys(localStorage).filter((k) => k.indexOf("eikon_bk_ready_") === 0).forEach((k) => localStorage.removeItem(k)); });
await carryTo("#appointments", "#ap-mod-patient");
const ap = await page.evaluate(() => ({ name: document.querySelector("#ap-mod-patient").value, card: document.querySelector("#ap-mod-idcard").value, phone: document.querySelector("#ap-mod-phone").value }));
await closeModal();
carryPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path !== "/auth/login");
report("customers: Booking replaces Appointment only once this pharmacy has set up Bookings", bkBtn.booking && !bkBtn.appt, JSON.stringify(bkBtn));
report("step 1: Question, Delivery and Appointment open filled the same way", tk.name === "Zammit Carmel" && tk.phone === "79123456" && dv.name === "Zammit Carmel" && dv.addr === "1 Triq il-Knisja" && ap.name === "Zammit Carmel" && ap.card === "0012345M" && ap.phone === "79123456" && carryPosts.length === 0, JSON.stringify({ tk, dv, ap, carryPosts }));

// an old hand-over is ignored
await page.evaluate(() => { sessionStorage.setItem("eikon_carry_person", JSON.stringify({ id: 1, name: "Zammit Carmel", phone: "79123456", at: Date.now() - 6 * 60 * 1000 })); location.hash = "#tickets"; });
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
report("temperature register: opens in the new layout from Registers, rail stays on Registers, month summary shown", trg.hash === "#tempreg" && !trg.classic && trg.rail.join() === "registers" && trg.cards === 1 && /^0 of \d+ days logged/.test(trg.sum) && trg.next === true && trg.cells >= 28, JSON.stringify(trg));

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
report("cleaning register: opens in the new layout, overdue status from last month, needs a name, then records once with who checked", clr1.hash === "#cleanreg" && clr1.rail.join() === "registers" && /Overdue · last cleaned \d+ days ago by Karl/.test(clr1.status) && clr1.weeks >= 1 && clrPosts.length === 0 && /who cleaned/.test(clrErr) && clrPosts2.length === 1 && b0.cleaner_name === "Karl" && b0.staff_name === "Maria Borg" && /^\d{4}-\d{2}-\d{2}$/.test(b0.entry_date) && b0.time_out === "23:59", JSON.stringify({ clr1, clrErr, clrPosts2 }));

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
await page.fill("#crt-form [name=last_date]", new Date().toISOString().slice(0, 10));
await page.click("#crt-form button[type=submit]"); await page.waitForTimeout(300);
const crtPuts0 = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
const crtErr = await page.evaluate(() => (document.querySelector(".crt-err") || {}).textContent || "");
await page.fill("#crt-form [name=certified_person]", "Maria Borg");
await page.click("#crt-form button[type=submit]"); await page.waitForTimeout(700);
const crtPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
report("certificates: open in the new layout, overdue first, the person required where needed, one PUT", crt1.hash === "#certreg" && crt1.rail.join() === "registers" && crt1.labs[0] === "Needs attention" && crt1.first === "Thermometer Calibration" && /Overdue 15 days/.test(crt1.pill) && crtPuts0.length === 0 && /who is certified/.test(crtErr) && crtPuts.length === 1 && crtPuts[0].path === "/certificates/items/3" && crtPuts[0].body.certified_person === "Maria Borg" && crtPuts[0].body.interval_months === 36, JSON.stringify({ crt1, crtErr, crtPuts }));

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

// Orders, changing one (new layout): the order is read again and sent whole, as the classic screen sends it (its names
// and the server's: client_phone, items_text, pickup_date, deposit_amount), with only what was edited different; a field
// changed elsewhere since the screen opened is kept. Staff do not see Delete; the pharmacist's delete writes the reason
// on the order, then deletes it. Done lists ready orders through the server's fulfilled=1 range.
try {
  const dT = new Date(), dd = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.getFullYear() + "-" + String(x.getMonth() + 1).padStart(2, "0") + "-" + String(x.getDate()).padStart(2, "0"); };
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
report("controlled drugs supplied: ID card and prescriber fill in; a repeated serial shows and waits for 'Yes, record'; then one entry",
  cds1.name === "Zammit Carmel" && cds1.reg === "R1201" && cds1.dup && cds1.btn === "Yes, record" && cdsBefore === 0 && cdsPosts.length === 1 && cdsPosts[0].client_id_card === "0012345M" && cdsPosts[0].client_address === "1 Triq il-Knisja" && cdsPosts[0].quantity === 10 && cdsPosts[0].prescription_serial_no === "RX-1",
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
    /whole number/.test(dsErr) && dsFocusAfterAdd === "add-name" && dsFocus.fk === "cnt-3" && dsFocus.mode === "decimal" &&
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
  const wd = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(Date.now() - 2 * 864e5).getDay()];
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
const xmas = (new Date().getFullYear() - 1) + "-12-25";
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
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "bookings" && document.querySelector(".bkx-r[data-act=open]"), null, { timeout: 15000 });
const bk1 = await page.evaluate(() => document.querySelector(".bkx-r[data-act=open]").textContent);
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
const bkBack = await page.evaluate(() => ({ closed: !document.querySelector(".bkx-sheet"), on: document.activeElement.getAttribute("data-act") }));
await fetch(`http://localhost:${PORT}/__reset`);
await page.click("[data-act=new]"); await page.waitForFunction(() => document.querySelector(".bkx-slot.on") && document.getElementById("bkx-name"), null, { timeout: 5000 });
await page.fill("#bkx-name", "Paul Grech"); await page.click("[data-act=book]");
await page.waitForFunction(() => !document.querySelector(".bkx-sheet"), null, { timeout: 5000 });
const bkPosts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "POST" && c.path === "/bookings").map((c) => c.body);
report("bookings: today's list; settings is a dialog that holds focus, Escape returns to the gear; 2nd hours 16:00–19:00; one POST per booking",
  /23:50.*Anna Vella.*Blood pressure/.test(bk1) && bkSheet.dialog && bkSheet.inside && /settings/i.test(bkSheet.label || "") && bkWin === "16:00-19:00" && bkEsc === 0 && bkBack.closed && bkBack.on === "settings" &&
  bkPosts.length === 1 && bkPosts[0].serviceId === 1 && bkPosts[0].providerId === 1 && bkPosts[0].start === "23:30" && bkPosts[0].personName === "Paul Grech",
  JSON.stringify({ bk1, bkSheet, bkWin, bkEsc, bkBack, bkPosts }));
} catch (e) { report("bookings: keyboard, hours and booking flow ran to the end", false, String(e).slice(0, 300)); }

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
  report("offline save: says the connection dropped, keeps what was typed and the list on screen", /connection dropped/i.test(off.err) && off.name === "Offline Ltd" && off.fee === "7" && !off.gone && off.sum, JSON.stringify(off));
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

// Vaccines: the old link opens the new screen; Kenya brings its recommendations; a tapped vaccine and the client go in one POST shaped like the classic one.
try {
  await page.goto(base + "&ui=2#vaccines");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "vaxreg" && document.querySelector(".vxr-row"), null, { timeout: 15000 });
  const vx1 = await page.textContent(".vxr-row");
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("[data-act=add]");
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
  await page.fill("[name=staff]", "Maria"); await page.fill("[name=float_amount]", "100");
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
    eodOu === "Short by €0.70" && eodDep === "5" && eodPuts.length === 1 && e0.staff === "Maria" && e0.staff_name === "Maria" && e0.float_amount === "100.00" && e0.x[0].amount === "500.40" && e0.paid_outs[0].amount === "12.50" &&
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
  await page.evaluate(() => { window.__lblPrinted = []; window.open = (u) => { fetch(u).then((r) => r.text()).then((t) => window.__lblPrinted.push(t)); return {}; }; });
  await fetch(`http://localhost:${PORT}/__reset`);
  await page.click("#lbl-add button[type=submit]");
  await page.waitForFunction(() => window.__lblPrinted.length === 1 && /saved to recent labels/.test(document.querySelector("#lbl-status").textContent), null, { timeout: 8000 });
  const lblHtml = await page.evaluate(() => window.__lblPrinted[0]);
  const lblPuts = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" && c.path === "/labels/state").map((c) => c.body.state);
  const e0 = ((lblPuts[0] || {}).labelHistory || [])[0] || {};
  report("dispensing labels: #labels opens it under Services; a known medicine fills its dose; Print opens the classic print page; one PUT with only the new entry and the settings unchanged",
    lblRail === "services" && lblDose === "1 capsule" && /Rx: Amoxicillin 500mg/.test(lblPrev) && /Dose\/Freq: 1 capsule \| Three times daily/.test(lblPrev) &&
    /<b>Rx:<\/b> Amoxicillin 500mg/.test(lblHtml) && /@page\{margin:0;\}/.test(lblHtml) && /T:21234567/.test(lblHtml) && !/<script|\son[a-z]+=/i.test(lblHtml) &&
    lblPuts.length === 1 && lblPuts[0].labelHistory.length === 1 && e0.drugName === "Amoxicillin 500mg" && e0.dose === "1 capsule" && e0.templateId === "tpl_std" && /^lb_\d+_/.test(e0.id) &&
    JSON.stringify(Object.keys(e0)) === JSON.stringify(["patientName", "drugName", "dose", "frequency", "route", "customInstructions", "selectedWarnings", "templateId", "id", "printedAt", "printedBy"]) &&
    lblPuts[0].templates.length === 1 && lblPuts[0].templates[0].id === "tpl_std" && lblPuts[0].pharmacyDetails.phone === "21234567",
    JSON.stringify({ lblRail, lblDose, lblPrev, lblPuts }).slice(0, 600));
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
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "otcreg" && document.querySelectorAll(".otc-side .otc-row").length === 88, null, { timeout: 15000 });
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
  report("over the counter: #otcmindmap opens it under Services; 88 symptoms; acid reflux lists its 29 products, best score first; a product's cautions come first, in words; Escape steps back; fits 360 px; reads only the classic's files",
    otcRail === "services" && otcSym.title === "acid reflux" && otcSym.n === "29" && otcSym.first === "Acidex Oral Suspension" && /^Primary · Imported symptom tags · Score 92$/.test(otcSym.sub) && otcSym.focus === "otc-title" &&
    otcRes.join("|") === "Actifed 60mg/2.5mg Tablets|ACTIFED 30mg/1.25mg per 5ml Syrup" && /Caution: 2 guardrails/.test(otcCaut) && /Do not cross-sell together by default; show as alternative options instead\./.test(otcCaut) && /Medofed/.test(otcCaut) &&
    /otc-caution/.test(otcFirst) && otcBack === "ACTIFED 30mg/1.25mg per 5ml Syrup" && otcW && otcApi.length === 0,
    JSON.stringify({ otcRail, otcSym, otcRes: otcRes.slice(0, 3), otcCaut: otcCaut.slice(0, 200), otcFirst, otcBack, otcW, otcApi }).slice(0, 700));
} catch (e) { report("over the counter: ran to the end", false, String(e).slice(0, 300)); }
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
    /^poct,vaccines,screening,pharmacovigilance,ocps/.test(navSvc) && /otcmindmap/.test(navSvc) && /labels/.test(navSvc) && navSvcLit === "services" && /^endofday,paidout,emergency-pos/.test(navMon) && /creditnotes/.test(navMon) && /locumreceipts/.test(navMon) && navMonLit === "money" &&
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
  const dNo = new Date().toISOString().slice(0, 10);
  await page.route("**/client-orders/entries?*", (r) => r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entries: [{ id: 53, order_date: dNo, client_name: "Borg Olga", client_phone: "", items_text: "Augmentin 625 x14", priority: 2, needed_by: dNo, deposit_amount: 0, fulfilled: 0, notes: "" }] }) }));
  await page.goto(base + "&ui=2#clientorders");
  await page.waitForFunction(() => window.EIKON.state.activeModuleId === "ordreg" && document.querySelector('[data-act=ready][data-id="53"]'), null, { timeout: 15000 });
  await fetch(`http://localhost:${PORT}/__reset`);
  const asked = [];
  page.once("dialog", (d) => { asked.push(d.type()); d.dismiss(); });
  await page.click('[data-act=ready][data-id="53"]'); await page.waitForTimeout(500);
  const putsNone = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT").length;
  page.once("dialog", (d) => { asked.push(d.type()); d.accept("79112233"); });
  await page.click('[data-act=ready][data-id="53"]'); await page.waitForTimeout(700);
  const ordNoPh = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT");
  await page.unroute("**/client-orders/entries?*");
  report("orders: Ready on an order with no phone asks for it and sends it as client_phone (the server needs one); cancelling sends nothing",
    asked.join() === "prompt,prompt" && putsNone === 0 && ordNoPh.length === 1 && ordNoPh[0].path === "/client-orders/entries/53" &&
    JSON.stringify(ordNoPh[0].body) === JSON.stringify({ fulfilled: true, client_phone: "79112233", contact: "79112233" }), JSON.stringify({ asked, putsNone, ordNoPh }));
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
  const expected = {}; const TITLES = { "/temperature/entries": "Temperature", "/cleaning/entries": "Cleaning", "/daily-register/entries": "Daily register", "/locumregister/entries": "Locum register", "/dda-purchases/entries": "DDA purchases", "/dda-sales/entries": "DDA sales", "/dda-poyc/entries": "DDA POYC", "/repeat-prescriptions/entries": "Repeat prescriptions", "/paid-out/entries": "Paid out", "/locumreceipts/receipts": "Locum receipts", "/client-orders/entries": "Orders" };
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
  await page.evaluate(() => { window.XLSX = {}; window.EIKON.expLast = null; });
  await page.click('[data-act="download"]');
  await page.waitForFunction(() => window.EIKON.expLast && window.EIKON.expLast.file, null, { timeout: 30000 });
  const zb = Buffer.from(await page.evaluate(async () => { const b = new Uint8Array(await window.EIKON.expLast.file.blob.arrayBuffer()); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64");
  const files = {}; let off = 0;
  while (zb.readUInt32LE(off) === 0x04034b50) { const size = zb.readUInt32LE(off + 18), nl = zb.readUInt16LE(off + 26), name = zb.slice(off + 30, off + 30 + nl).toString(); files[name] = zb.slice(off + 30 + nl, off + 30 + nl + size).toString("utf8"); off += 30 + nl + size; }
  const csvRows = (t) => { let n = 0, q = false; for (let i = 0; i < t.length; i++) { const c = t[i]; if (c === '"') q = !q; else if (c === "\n" && !q) n++; } return n - 1; };
  const zc = {}; for (const [n, t] of Object.entries(files)) zc[n] = csvRows(t);
  const zipOk = /\.zip$/.test(await page.evaluate(() => window.EIKON.expLast.file.name)) && files["Summary.csv"] && Object.entries(expected).every(([k, v]) => zc[k.replace(/ /g, "-") + ".csv"] === v) && files["Paid-out.csv"].charCodeAt(0) === 0xfeff && /,12\.50,/.test(files["Paid-out.csv"]) && files["Orders.csv"].includes('"Zammit, ""Carmel"""') && zb.readUInt32LE(zb.length - 22) === 0x06054b50;
  report("export: without the spreadsheet library the same year is a zip of CSV files (BOM, quoted commas, 2-decimal money), same row counts", zipOk, JSON.stringify({ zc, names: Object.keys(files) }));
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
// People's names in Title Case (ui/eikon.people.js): the UI's function is the worker's (read from cloudflare-worker/code and run
// side by side); in the new layout a name field is cased when it is left, a mixed-case name and other fields are kept as typed.
try {
  const wsrc2 = fs.readFileSync(path.join(here, "..", "..", "cloudflare-worker", "code"), "utf8");
  const fnOf = (src, name) => { const i = src.indexOf("function " + name + "("); let d = 0, j = src.indexOf("{", i); for (; j < src.length; j++) { if (src[j] === "{") d++; else if (src[j] === "}" && --d === 0) break; } return src.slice(i, j + 1); };
  const WN = new Function(fnOf(wsrc2, "eikonNameCase") + "\nreturn eikonNameCase;")();
  const samples = ["carmel zammit", "CARMEL ZAMMIT", "ĠUŻEPPI ĦILI", "il-ħamrun", "anne-marie d'amato", "O'BRIEN", "mcdonald", "de Gabriele", "john Agius", "McDonald", "JD", "0123456M", "rita@x.mt", "j.p. borg", "JOHN SMITH III"];
  await page.goto(base + "&ui=2#tickets");
  await page.waitForFunction(() => window.EIKON && window.EIKON.people && window.EIKON.people.nameCase && window.EIKON.state.activeModuleId === "tktreg", null, { timeout: 15000 });
  const uiOut = await page.evaluate((x) => x.map((v) => window.EIKON.people.nameCase(v)), samples);
  await page.click("[data-act=add]");
  await page.fill("#tkt-add [name=client_name]", "carmel zammit"); await page.press("#tkt-add [name=client_name]", "Tab");
  await page.fill("#tkt-add [name=issue]", "omron m3 in stock?"); await page.press("#tkt-add [name=issue]", "Tab");
  const v1 = await page.inputValue("#tkt-add [name=client_name]"), v2 = await page.inputValue("#tkt-add [name=issue]");
  await page.fill("#tkt-add [name=client_name]", "de Gabriele Maria"); await page.press("#tkt-add [name=client_name]", "Tab");
  const v3 = await page.inputValue("#tkt-add [name=client_name]");
  await page.fill("#tkt-add [name=client_name]", "ĠORĠ ĦILI"); await page.press("#tkt-add [name=client_name]", "Tab");
  const v4 = await page.inputValue("#tkt-add [name=client_name]");
  report("names: a name field is put in Title Case when it is left (Maltese letters too); a mixed-case name and the other fields stay as typed; the UI's function gives the worker's answers",
    JSON.stringify(uiOut) === JSON.stringify(samples.map(WN)) && uiOut[0] === "Carmel Zammit" && uiOut[7] === "De Gabriele" && uiOut[8] === "John Agius" &&
    v1 === "Carmel Zammit" && v2 === "omron m3 in stock?" && v3 === "De Gabriele Maria" && v4 === "Ġorġ Ħili",
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
  const overlay = await page.evaluate(() => { const o = document.getElementById("eikon-fatal-overlay"); const had = !!o; if (o) o.remove(); return had; });
  // a screen that throws while drawing
  await page.evaluate(async () => { const E = window.EIKON; E._t_render = E.modules.tktreg.render; E.modules.tktreg.render = function () { throw new Error("render broke"); }; await E.renderActiveModule(); });
  await page.waitForTimeout(600);
  const L2 = (await logs()).filter((c) => c.body && c.body.kind === "render");
  await page.evaluate(() => { const E = window.EIKON; E.modules.tktreg.render = E._t_render; });
  // ten more distinct errors: the page stops at 5 in all
  await page.evaluate(() => { for (let i = 0; i < 10; i++) setTimeout(() => { throw new Error("Burst " + i); }, 0); });
  await page.waitForTimeout(700);
  const L3 = await logs();
  await page.evaluate(() => { const o = document.getElementById("eikon-fatal-overlay"); if (o) o.remove(); });
  report("error reports: a thrown error is one POST /client-log (screen tktreg, kind error, build, scrubbed message and stack, nothing typed in the form), the overlay adds none; a drawing crash is one render report; at most 5 per page load",
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
  await page.evaluate(() => { const o = document.getElementById("eikon-fatal-overlay"); if (o) o.remove(); });
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
  // the hub card for a classic screen still hands over to the classic layout
  await np.evaluate(() => { location.hash = "#customers"; }); await np.waitForSelector('[data-reg="loyalty"]', { timeout: 10000 });
  await np.click('[data-reg="loyalty"]'); await np.waitForFunction(() => /ui=classic/.test(location.search) && window.EIKON && window.EIKON.state.activeModuleId === "loyalty" && document.getElementById("eikon-content") && document.getElementById("eikon-content").children.length > 0, null, { timeout: 20000 }).catch(() => {});
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
    sc1.h1 === "Zammit Carmel" && sc1.scan && sc1.scan.where === "today" && sc1b.h1 === "Zammit Carmel" && sc1b.scan.code === "0012345M" && sc2.card === "999999M" && sc2.name === "" && JSON.stringify(sc3.rows) === JSON.stringify(["Vella Joseph"]) && sc3.q === "KX7P2Q" && scWrites.length === 0,
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
  const yMonth = await page.evaluate(() => { const t = new Date(); t.setDate(t.getDate() - 1); return t.toISOString().slice(0, 7); });
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
    const r = await page.evaluate(() => ({ table: !!document.querySelector(".drr-tbl"), list: !!document.querySelector(".drr-list"), john: /John Borg/.test(document.querySelector(".drr").textContent), cols: [...document.querySelectorAll(".drr-tbl th")].map((t) => t.textContent) }));
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
    t1.karl.join() === "New password,Switch off" && t1.leaver.join() === "Switch on" && t1.offLab && /Team/.test(t1.back), JSON.stringify(t1));
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
  const sCalls = await teamCalls((c) => c.path.startsWith("/team/"));
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

// First-run list on Today (admin only, only while something is missing; the counts come with GET /today)
try {
  const todayFresh = async () => { await page.goto(base + "&ui=2#today"); await page.reload(); await page.waitForFunction(() => document.querySelector(".tdy-head h1") && !/Loading/.test(document.querySelector(".tdy-head h1").textContent), null, { timeout: 15000 }); await page.waitForTimeout(300); };
  teamState = teamFresh(); teamState.setup = { sign_ins: 1, opening_hours_saved: false }; todayState.noFridge = true;
  await fetch(`http://localhost:${PORT}/__reset`);
  await todayFresh();
  const f1 = await page.evaluate(() => [...document.querySelectorAll(".tdy-setup li")].map((li) => li.getAttribute("data-setup") + ">" + li.querySelector("button").getAttribute("data-open")));
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
    f1.join() === "fridge>#temperature,people>#teamreg,hours>#shifts" && fGets.filter((x) => x !== "/auth/me" && x !== "/today").length === 0 && fOpen === "#teamreg" && f2.join() === "hours" && !f3 && !f4 && !f5, JSON.stringify({ f1, fGets, fOpen, f2, f3, f4, f5 }));
} catch (e) { report("today first run: ran to the end", false, String(e).slice(0, 400)); }
todayState.noFridge = false; teamState = teamFresh();

// Forced change at first sign-in, and the idle lock with a fake clock (own browser contexts)
async function teamPage(clock) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
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
      return r.fulfill({ response: await r.fetch({ url: `http://localhost:${PORT}` + u.pathname + u.search }) });
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

await browser.close();
server.close();

// Source-level check for the escape fix (no DOM needed)
for (const f of ["modules.ddasales.js", "modules.ddapoyc.js"]) {
  const src = fs.readFileSync(path.join(root, f), "utf8");
  const bad = src.includes(`"&": "&", "<": "<"`);
  const good = src.includes(`"&": "&amp;", "<": "&lt;"`);
  report("source: " + f + " escapeHtml produces entities", !bad && good);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
