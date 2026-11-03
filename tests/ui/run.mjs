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
      { kind: "temperature", device_id: 7, title: "Fridge 1 · reading", sub: "Yesterday 3.8 to 6.4 · limits 2 to 8", status: todayState.tempDone ? "done" : "todo", out_of_range: false, limits: { min: 2, max: 8 }, yesterday: { min: 3.8, max: 6.4 }, today: todayState.tempDone ? { min: 3.9, max: 6.1 } : null, action: { method: "POST", path: "/temperature/entries", body: { device_id: 7, entry_date: t }, fields: ["min_temp", "max_temp", "notes"], label: "Log" } },
      { kind: "daily_register", title: "Daily register", sub: "No entry yet today", status: "todo", count_today: 0, action: { type: "open", path: "#dailyregister", label: "Open" } },
      { kind: "cleaning", title: "Cleaning", sub: "Last done 14 days ago by Karl", status: todayState.cleanDone ? "done" : "overdue", days_since: 14, last_date: "2026-10-17", action: { method: "POST", path: "/cleaning/entries", body: { entry_date: t }, fields: ["time_in", "cleaner_name", "staff_name"], label: "Done now" } }
    ],
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
    counts: { before_opening: (todayState.tempDone ? 0 : 1) + 1 + (todayState.cleanDone ? 0 : 1), customers_waiting: 2, attention: 2 }
  };
}
let boardState = { msgs: [
  { id: 11, user_id: 7, user_name: "Sara Vella", location_name: "Sliema Pharmacy", body: "Who has Ozempic 1mg? @Demo Pharmacy", scope: "all", is_pinned: 1, created_at: "2026-11-02 08:00:00" },
  { id: 12, user_id: 3, user_name: "Karl Vella", location_name: "Demo Pharmacy", body: "Courier at 16:00", scope: "org", is_pinned: 0, created_at: new Date().toISOString().slice(0, 19).replace("T", " ") }] };
let eodState = { rec: null, n: 0 };
let eposSales = [];
let pvState = { reports: [{ id: "pv_1_abc", created_at: "2026-10-30T09:00:00.000Z", updated_at: "2026-10-30T09:00:00.000Z", status: "Draft", report_type: "Initial", pt_initials: "J.D.", pt_age: "65", pt_sex: "Female", pt_weight: "", pt_height: "", pt_dob_day: "5", pt_dob_month: "3", pt_id: "123456M", pt_medical_history: "",
  drugs: [{ name: "Amoxicillin 500mg", dose: "500mg", route: "Oral", frequency: "TDS", start_date: "", stop_date: "", indication: "URTI", batch_no: "AX12", mah: "" }], reaction_description: "Itchy rash", reaction_start: "", reaction_stop: "", reaction_seriousness: "Serious – Other medically important", reaction_outcome: "Recovering", reaction_causality: "Possible", reaction_meddra: "Rash",
  reporter_name: "Maria Borg", reporter_qualification: "Pharmacist", reporter_email: "", reporter_phone: "", reporter_institution: "Demo Pharmacy", reporter_address: "", report_date: "2026-10-30", notes: "", mpa_ref: "MPA-7" }] };
let lblState = { history: [{ patientName: "", drugName: "Amoxicillin 500mg", dose: "1 capsule", frequency: "Three times daily", route: "Oral", customInstructions: "", selectedWarnings: ["w10"], templateId: "tpl_std", id: "lb_1_seed", printedAt: "2026-11-01 10:00", printedBy: "Maria Borg" }], templates: [{ id: "tpl_std", name: "Standard Label", size: "standard", fields: [], isDefault: true }], pharm: { name: "Demo Pharmacy", phone: "21234567", licence: "" } };
let peopleState = { adopted: false, carmel: { id: 1, name: "Zammit Carmel", id_card: "0012345M", phone: "79123456", alt_phone: "", email: "", address: "1 Triq il-Knisja", doctor_name: "", date_of_birth: "", notes: "", source: "history", version: 1, updated_at: "2026-10-31 09:00:00" } };
function mockApi(req, res, body) {
  const url = new URL(req.url, "http://x");
  const p = url.pathname;
  calls.push({ method: req.method, path: p, query: url.search, body });
  if (p === "/__test401") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Unauthorized" })); }
  if (p === "/people" && req.method === "POST") {
    if (body && body.id) { res.writeHead(409, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: false, error: "Changed elsewhere", current: Object.assign({}, peopleState.carmel, { notes: "Call after 5", version: 2 }) })); }
    peopleState.adopted = true;
    res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify({ ok: true, created: true, person: peopleState.carmel }));
  }
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
      { id: 52, order_date: d(-1), client_name: "Vella Joseph", client_phone: "79000111", items_text: "Nexium 20mg", priority: 1, needed_by: d(3), deposit_amount: 5, fulfilled: 0, notes: "" }] }));
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
await page.waitForFunction(() => location.search.indexOf("ui=classic") >= 0 && window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "dda_stocktakes", null, { timeout: 15000 });
const openedModule = await page.evaluate(() => location.hash + " " + (document.documentElement.hasAttribute("data-ui2") ? "new" : "classic"));
report("today: search opens a waiting customer's order in the new Orders screen, and a register not yet rebuilt in classic", openedCustomer === "#ordreg new" && openedModule === "#dda_stocktakes classic", `${openedCustomer} | ${openedModule}`);
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
// an old module never renders inside the new shell: the classic layout opens for this visit
await page.waitForFunction(() => location.hash === "#dda_stocktakes" && location.search.indexOf("ui=classic") >= 0 && window.EIKON && window.EIKON.state && window.EIKON.state.user && document.querySelector(".eikon-nav-cat"), null, { timeout: 15000 });
await page.waitForTimeout(400);
const legacy = await page.evaluate(() => ({ light: document.documentElement.hasAttribute("data-ui2"), cats: document.querySelectorAll(".eikon-nav-cat").length, back: document.getElementById("eikon-back-btn").textContent, backShown: document.getElementById("eikon-back-btn").style.display !== "none", pref: localStorage.getItem("eikon_ui2") }));
await page.click("#eikon-back-btn");
await page.waitForFunction(() => location.hash === "#registers" && document.documentElement.hasAttribute("data-ui2") && document.querySelector(".hub-card"), null, { timeout: 15000 });
report("shell: Registers lists every book; an old one opens in classic Eikon, whole, with one button back; the preference is kept", hub.h1 === "Registers" && hub.cards >= 11 && hub.temp && hub.topbar === "none" && !legacy.light && legacy.cats > 0 && /New Eikon/.test(legacy.back) && legacy.backShown && legacy.pref === "1", JSON.stringify({ hub, legacy }));

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
report("customers: Today's search hands the term over; people, history and the rail entry render", cus1.q === "zammit" && cus1.people === 1 && cus1.hist === 1 && cus1.rail && /1 DDA sale, 1 loyalty card/.test(cus1.histText) && peopleGets.length >= 1 && /q=zammit/.test(peopleGets[peopleGets.length - 1].query), JSON.stringify({ cus1, peopleGets }));

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
const trg = await page.evaluate(() => ({ hash: location.hash, classic: location.search.indexOf("ui=classic") >= 0, rail: [...document.querySelectorAll(".eikon-rail-btn.active")].map((b) => b.dataset.mod), cards: document.querySelectorAll(".trg-card").length, sum: document.querySelector(".trg-sum").textContent, next: document.querySelector("[data-act=next]").disabled, cells: document.querySelectorAll(".trg-card .trg-d:not(.pad)").length }));
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
report("certificates: open in the new layout, overdue first, the person required where needed, one PUT", crt1.hash === "#certreg" && crt1.rail.join() === "settings" && crt1.labs[0] === "Needs attention" && crt1.first === "Thermometer Calibration" && /Overdue 15 days/.test(crt1.pill) && crtPuts0.length === 0 && /who is certified/.test(crtErr) && crtPuts.length === 1 && crtPuts[0].path === "/certificates/items/3" && crtPuts[0].body.certified_person === "Maria Borg" && crtPuts[0].body.interval_months === 36, JSON.stringify({ crt1, crtErr, crtPuts }));

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
const tkCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method === "PUT" || c.method === "POST");
const tkNote = tkCalls[0] || {}, tkLog = (() => { try { return JSON.parse(tkNote.body.notes_log); } catch (e) { return []; } })(), tkNew = (tkCalls[2] || {}).body || {};
report("questions: open in the new layout, high first; a note keeps the old ones; Resolved sends only status; a new one needs a name and gets a category",
  tk1.rail.join() === "customers" && tk1.names[0] === "Farrugia Tony" && /Called, no answer/.test(tk1.last) && tkCalls.length === 3 &&
  tkNote.path === "/client-tickets/entries/61" && Object.keys(tkNote.body).join() === "notes_log" && tkLog.length === 2 && tkLog[0].text === "Called, no answer" && tkLog[1].text === "Spoke to her, collecting Friday" &&
  tkCalls[1].path === "/client-tickets/entries/62" && JSON.stringify(tkCalls[1].body) === JSON.stringify({ status: "Resolved" }) &&
  /customer's name/.test(tkErr) && tkCalls[2].path === "/client-tickets/entries" && tkNew.client_name === "Borg Anna" && /^TKT-\d{5}$/.test(tkNew.ticket_id) && tkNew.category === "General Enquiry" && tkNew.status === "Open" && tkNew.notes_log === "[]",
  JSON.stringify({ tk1, tkErr, tkCalls }));

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
  /CRITICALMethadone/.test(hn1.first || "") && /CD cupboard/.test(hn1.always || "") && hn1.rail.join() === "team" && hnCalls[0].method === "GET" && hnPut.notes === "Inspector may visit" && hnPut.handover_out.length === 2 && hnPut.handover_out[0].text === "Already for tomorrow" && hnPut.handover_out[1].text === "Fridge door sticks" && hnPut.handover_out[1].sev === "r",
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

// Repeat prescriptions: soon-to-expire flagged; Renew sends the same patient, medicine and prescriber, dated today, expiry left to the server.
await page.goto(base + "&ui=2#repeatprescriptions");
await page.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector(".rep-row"), null, { timeout: 15000 });
const rep1 = await page.textContent(".rep-row");
await fetch(`http://localhost:${PORT}/__reset`);
await page.click(".rep-row [data-act=renew]"); await page.click("#rep-add button[type=submit]"); await settleSave();
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
    e0.cash.coins_total === "117.10" && e0.deposit.n50 === "5" && e0.bov_deposit.n50 === "5" && e0.bag_number === "B-7" && e0.bov_bag_number === "B-7" && !("locked_at" in e0) && e0.action === "SAVE" &&
    eodRefused && eodState.rec.staff === "Maria B", JSON.stringify({ eodOu, eodDep, n: eodPuts.length, e0, eodRefused, now: eodState.rec && eodState.rec.staff }));
} catch (e) { report("end of day: ran to the end", false, String(e).slice(0, 300)); }

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
  const ocpCalls = (await (await fetch(`http://localhost:${PORT}/__calls`)).json()).filter((c) => c.method !== "GET" || /ocp|contracep/i.test(c.path));
  report("contraceptive pills: #ocps opens the new lookup under Services; 21 classic pills; EE 20 mcg + drospirenone 3 mg finds Freedonel, Yasminelle, Yaz; a tap shows the same pills; no write",
    ocpRail === "services" && ocpAll === 21 && /Ethinylestradiol 30 mcg/.test(ocpAdele) && /Desogestrel 0\.15 mg/.test(ocpAdele) && ocpHits === "Freedonel,Yasminelle,Yaz" &&
    /as Clairette: 1 other pill\./.test(ocpLike) && ocpClair === "Clairette,Vreya" && ocpCalls.length === 0,
    JSON.stringify({ ocpRail, ocpAll, ocpAdele, ocpHits, ocpLike, ocpClair, ocpCalls }));
} catch (e) { report("contraceptive pills: ran to the end", false, String(e).slice(0, 300)); }

// Dispensing labels: the old link opens the new screen under Services; a medicine labelled before fills its dose; Print
// opens the classic print page and sends one PUT with only that entry and the settings unchanged.
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
    /<b>Rx:<\/b> Amoxicillin 500mg/.test(lblHtml) && /@page\{margin:0;\}/.test(lblHtml) && /T:21234567/.test(lblHtml) && /window\.print\(\)/.test(lblHtml) &&
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
    ppPick.id === "0012345M" && ppPick.name === "Zammit Carmel" && ppPick.addr === "1 Triq il-Knisja" && ppPick.note === "Filled from earlier records (last 5 Oct)" && !ppPick.open && ppPick.focus === "client_id_card" &&
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
// screenshot for the review (reset the mock so the screen shows a morning with work to do)
todayState = { tempDone: false, cleanDone: false };
await page.evaluate(() => { location.hash = "#today"; });
await page.waitForTimeout(1200);
await page.setViewportSize({ width: 1440, height: 900 });
await page.screenshot({ path: path.join(here, "..", "..", "design", "eikon-reimagined", "prototype", "04 Today, built.png") });
// leave the flag off for the next run
await page.evaluate(() => { localStorage.removeItem("eikon_ui2"); });

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
