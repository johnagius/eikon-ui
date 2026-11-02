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
    team: { on_today: [{ name: "Maria", role: "pharmacist", from: "09:00", to: "19:00" }, { name: "Karl", role: "assistant", from: "13:00", to: "19:00" }], handover_incoming: [{ text: "Courier at 16:00, box for Dr Galea", sev: "medium" }], notes_today: "" },
    counts: { before_opening: (todayState.tempDone ? 0 : 1) + 1 + (todayState.cleanDone ? 0 : 1), customers_waiting: 2, attention: 2 }
  };
}
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
report("shell: the rail is Today, Customers, Stock, Registers, Team, Settings and nothing else", JSON.stringify(shell.rail) === JSON.stringify(["Today", "Customers", "Stock", "Registers", "Team", "Settings"]) && shell.cats === 0 && !shell.help && !shell.search && shell.topbar === "none" && shell.mark && shell.pharmacy === "Demo Pharmacy" && shell.who === "Maria Borg" && /^\d+$/.test(shell.badgeToday || ""), JSON.stringify(shell));
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
report("shell: Registers lists every book; an old one opens in classic Eikon, whole, with one button back; the preference is kept", hub.h1 === "Registers" && hub.cards >= 20 && hub.temp && hub.topbar === "none" && !legacy.light && legacy.cats > 0 && /New Eikon/.test(legacy.back) && legacy.backShown && legacy.pref === "1", JSON.stringify({ hub, legacy }));

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
await page.waitForTimeout(700);
const savePosts = (await callsNow()).filter((c) => c.method === "POST" && c.path === "/people");
const cus3 = await page.evaluate(() => ({ warn: (document.querySelector(".cus-warn") || {}).textContent || "", editing: !!document.querySelector("#cus-edit"), notes: (document.querySelector("[name=notes]") || {}).value, saved: Array.from(document.querySelectorAll(".eikon-toast")).map((t) => t.textContent).join("|") }));
report("customers: a stale edit is refused, the other version is shown, nothing is claimed saved", savePosts.length === 1 && savePosts[0].body.id === 1 && savePosts[0].body.version === 1 && savePosts[0].body.notes === "Prefers SMS" && /changed this record/.test(cus3.warn) && cus3.editing && cus3.notes === "Call after 5" && !/Saved/.test(cus3.saved), JSON.stringify({ savePosts, cus3 }));

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
await carryTo("#appointments", "#ap-mod-patient");
const ap = await page.evaluate(() => ({ name: document.querySelector("#ap-mod-patient").value, card: document.querySelector("#ap-mod-idcard").value, phone: document.querySelector("#ap-mod-phone").value }));
await closeModal();
carryPosts = (await callsNow()).filter((c) => c.method === "POST" && c.path !== "/auth/login");
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
await page.click("#lcr-form button[type=submit]"); await page.waitForTimeout(700);
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
await page.click("#cdp-add button[type=submit]"); await page.waitForTimeout(800);
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
await page.click("#cds-add button[type=submit]"); await page.waitForTimeout(700);
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
