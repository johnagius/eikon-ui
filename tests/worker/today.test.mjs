import { test, eq, ok } from "./lib.mjs";

function maltaToday() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function daysAgo(n) {
  const d = new Date(Date.now() - n * 86400000);
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

test("today: one call answers what needs the pharmacy now", async ({ api, bootstrap, DB }) => {
  const { token } = await bootstrap();
  const today = maltaToday();

  // Seed through the real endpoints: a cleaning 20 days ago, an open order, an open question,
  // an alert with unticked boxes, a near-expiry item already expired, a paid-out today.
  eq((await api("POST", "/cleaning/entries", { token, body: { entry_date: daysAgo(20), time_in: "08:00", time_out: "", cleaner_name: "Karl", staff_name: "Maria", notes: "" } })).status, 200);
  eq((await api("POST", "/client-orders/entries", { token, body: { order_date: today, client_name: "Grech Carmen", client_phone: "79123456", items_text: "Augmentin 625 x14", priority: 1, needed_by: today, pick_up_date: today, deposit: 0 } })).status, 200);
  eq((await api("POST", "/client-tickets/entries", { token, body: { ticket_id: "TKT-00001", open_date: daysAgo(3), client_name: "Vella Joseph", phone: "79000000", category: "General Enquiry", priority: 2, status: "Open", issue: "Omron M3?" } })).status, 200);
  eq((await api("POST", "/alerts/entries", { token, body: { entry_date: today, alert_type: "recall", status: "open", item_name: "Batch X", storage_location: "room" } })).status, 200);
  eq((await api("POST", "/near-expiry/entries", { token, body: { product_name: "Old syrup", expiry_date: daysAgo(2), location: "Shelf 3", notes: "" } })).status, 200);
  const po = await api("POST", "/paid-out/entries", { token, body: { entry_date: today, entry_time: "09:00", payee_name: "Courier", fee: 12.5, payment_method: "cash", reason: "Delivery" } });
  eq(po.status, 200, po.text);

  const r = await api("GET", "/today", { token });
  eq(r.status, 200, r.text);
  const t = r.json;
  eq(t.ok, true);
  eq(t.date, today);
  ok(t.pharmacy && t.pharmacy.name === "Demo Pharmacy", "pharmacy named");

  // Registers before opening: temperature (default device, nothing logged), daily register, cleaning overdue
  const kinds = t.before_opening.map((x) => x.kind);
  ok(kinds.includes("temperature"), "temperature row: " + JSON.stringify(kinds));
  ok(kinds.includes("daily_register"), "daily register row");
  ok(kinds.includes("cleaning"), "cleaning row");
  const temp = t.before_opening.find((x) => x.kind === "temperature");
  eq(temp.status, "todo");
  ok(temp.device_id, "device id carried");
  ok(temp.action && temp.action.method === "POST" && temp.action.path === "/temperature/entries", "inline action described");
  const cleaning = t.before_opening.find((x) => x.kind === "cleaning");
  eq(cleaning.status, "overdue");
  eq(cleaning.days_since, 20);
  const dr = t.before_opening.find((x) => x.kind === "daily_register");
  eq(dr.status, "todo");

  // Customers waiting: the open order and the open question, order first (priority 1, needed today)
  eq(t.customers_waiting.length, 2);
  eq(t.customers_waiting[0].kind, "order");
  eq(t.customers_waiting[0].name, "Grech Carmen");
  eq(t.customers_waiting[1].kind, "question");
  eq(t.customers_waiting[1].waiting_days, 3);

  // Attention: the recall with unticked steps and the expired item
  ok(t.attention.some((a) => a.kind === "alert"), "alert surfaced");
  ok(t.attention.some((a) => a.kind === "near_expiry" && a.expired_count === 1), "expired item surfaced: " + JSON.stringify(t.attention));

  // Takings: no end of day yet, paid out total today
  eq(t.takings.end_of_day_saved, false);
  eq(t.takings.paid_out_today, 12.5);

  // Headline numbers the screen uses (one temperature row per default device, plus daily register and cleaning)
  const tempRows = t.before_opening.filter((x) => x.kind === "temperature");
  ok(tempRows.length >= 1);
  eq(t.counts.before_opening, tempRows.length + 2);
  eq(t.counts.customers_waiting, 2);
  ok(r.headers.get("Cache-Control") && /max-age=10/.test(r.headers.get("Cache-Control")), "short private cache");

  // Logging every device and signing the register moves them to done
  for (const row of tempRows) {
    eq((await api("POST", "/temperature/entries", { token, body: { device_id: row.device_id, entry_date: today, min_temp: 3.9, max_temp: 6.1, notes: "" } })).status, 200);
  }
  eq((await api("POST", "/daily-register/entries", { token, body: { entry_date: today, client_name: "A B", client_id: "0001234M", medicine_name_dose: "Amoxicillin 500", posology: "1 tds", prescriber_name: "Dr Galea", prescriber_reg_no: "1234" } })).status, 200);
  const r2 = await api("GET", "/today", { token });
  const t2 = r2.json;
  eq(t2.before_opening.find((x) => x.kind === "temperature").status, "done");
  eq(t2.before_opening.find((x) => x.kind === "temperature").today.min, 3.9);
  eq(t2.before_opening.find((x) => x.kind === "daily_register").status, "done");
  eq(t2.counts.before_opening, 1, "only cleaning left");
});

test("today: an empty pharmacy gets a quiet morning, not an error", async ({ api, bootstrap }) => {
  const { token } = await bootstrap();
  const r = await api("GET", "/today", { token });
  eq(r.status, 200, r.text);
  ok(Array.isArray(r.json.before_opening));
  eq(r.json.customers_waiting.length, 0);
  ok(typeof r.json.counts.before_opening === "number");
});
