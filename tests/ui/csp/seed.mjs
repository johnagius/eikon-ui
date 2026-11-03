// Seeds the LOCAL stack (localhost:8859) once with records the per-record print paths need (run it once per fresh stack).
import { createRequire } from "node:module"; const { chromium } = createRequire(import.meta.url)("playwright");
const b = await chromium.launch({ args: ["--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost"] }); const p = await b.newPage();
await p.goto("http://localhost:8859/ui/index.html?ui=2"); await p.waitForSelector("input[type=email]");
await p.fill("input[type=email]", "maria@demo.mt"); await p.fill("input[type=password]", "Demo-Pass-2026"); await p.keyboard.press("Enter");
await p.waitForFunction(() => window.EIKON && window.EIKON.state.user, null, { timeout: 15000 });
const out = await p.evaluate(async () => {
  const E = window.EIKON, d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const post = async (path, body) => { try { const r = await E.apiFetch(path, { method: "POST", body: JSON.stringify(body) }); return path + " ok " + JSON.stringify(r).slice(0, 80); } catch (e) { return path + " FAIL " + String(e && (e.message || e)).slice(0, 120); } };
  const r = [];
  r.push(await post("/client-tickets/entries", { ticket_id: "TKT-09001", open_date: d(-3), client_name: "Camilleri Rita", phone: "79222333", email: "rita@x.com", category: "Prescription", priority: 2, status: "In Progress", issue: "Is her repeat ready?", assigned_to: "John", followup_date: d(-1), notes_log: JSON.stringify([{ ts: "2026-10-30T09:00:00Z", author: "Maria", text: "Called, no answer" }]) }));
  r.push(await post("/client-deliveries/entries", { order_date: d(-2), scheduled_time_slot: "Afternoon", phone: "79222333", email: "rita@x.com", address_notes: "Blue door", id_doc_ref: "123456M", delivery_method: "Courier", priority: 1, assigned_driver: "Kevin Mifsud", tracking_number: "TRK9", status: "Scheduled", signature_required: 1, contains_controlled: 1, cold_chain_required: 1, ticket_ref: "TKT-00007", items: JSON.stringify([{ name: "Morphine 10mg", qty: 2, schedule: "CD", batch_ref: "B7", expiry: "2027-01-01" }]), delivery_log: JSON.stringify([{ ts: "2026-10-30T09:00:00Z", author: "Maria", text: "Packed" }]), internal_notes: "Call first", delivery_id: "DEL-09001", client_name: "Camilleri Rita", delivery_address: "12 Triq il-Kbira, Mosta", scheduled_date: d(0) }));
  r.push(await post("/client-orders/entries", { order_date: d(0), client_name: "Grech Carmen", client_phone: "79111111", contact: "79111111", items: "Augmentin 625 x14", items_text: "Augmentin 625 x14", needed_by: d(2), priority: 1 }));
  r.push(await post("/returns/entries", { entry_date: d(0), description: "Nurofen 400mg", expiry: "2026-12-31", batch: "B-991", quantity: "4", supplier: "Reckitt", invoice_number: "INV-55", remarks: "Box dented", location_stored: "Back room", return_arranged: 1 }));
  try { const a = await E.apiFetch("/creditnotes/entries", { method: "POST", body: JSON.stringify({ issue_date: d(-20), client_name: "Rita", client_surname: "Camilleri", telephone: "79222333", receipt_number: "R-55", amount: 30, expiry_date: d(100) }) });
    r.push("cn " + JSON.stringify(a).slice(0, 80)); const id = a.id || (a.entry && a.entry.id);
    r.push(await post("/creditnotes/entries/" + id + "/purchases", { amount: 12.5, receipt_number: "R-60" }));
    r.push(await post("/creditnotes/entries/" + id + "/notes", { text: "Called her" })); } catch (e) { r.push("cn FAIL " + e.message); }
  r.push(await post("/locumreceipts/receipts", { receipt_date: d(0), hours: 6, locum_full_name: "Paul Vella", registration_number: "PH1234", day_type: "normal", fee_per_hour: 15 }));
  r.push(await post("/quotations/entries", { quote_date: d(-5), item_description: "Panadol 500mg x24", supplier: "GSK", vat_rate: 18, cost_excl_vat: 2.4, qty_purchased: 10, qty_free: 0, retail_price: 4.5 }));
  r.push(await post("/paid-out/entries", { entry_date: d(0), entry_time: "09:00", payee_name: "Courier Ltd", fee: 12.5, payment_method: "cash", reason: "Gozo" }));
  return r;
});
console.log(out.join("\n"));
console.log(await p.evaluate(async () => { const d = (n) => { const x = new Date(); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
  const r = await window.EIKON.apiFetch("/vaccines/orders", { method: "POST", body: JSON.stringify({ section: "travel", country_code: "KE", country_name: "Kenya", client_first: "Rita", client_last: "Camilleri", phone: "79222333", email: "", items: [{ name: "Yellow fever", qty: 1 }] }) }); const r2 = await window.EIKON.apiFetch("/pharmacovigilance/state", { method: "PUT", body: JSON.stringify({ state: { reports: [{ id: "pv_1", pt_initials: "J.B.", pt_sex: "M", reaction: "Rash", suspect_drug: "Amoxicillin", created_at: "2026-11-01" }], deleted_ids: [] } }) }); return JSON.stringify(r).slice(0, 100) + " " + JSON.stringify(r2).slice(0, 100); }));

await b.close();
