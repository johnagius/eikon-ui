// Changing a delivery (dlvreg, b4-5) vs the classic Edit Delivery: the same edit to two identical deliveries leaves
// identical rows, column by column (the server replaces the whole record on every change). Then: what the classic
// edit loses and the new screen keeps, and the pharmacist's delete with a reason.
import { ymd } from "../lib.mjs";
const T = "client_deliveries";
const seed = (over = {}) => Object.assign({ delivery_id: "DEL-07001", order_date: ymd(-1), scheduled_date: ymd(0), scheduled_time_slot: "Afternoon", client_name: "Borg Ċensina", phone: "79111222", email: "censina@example.mt",
  delivery_address: "12 Triq il-Ħamrun, Żebbuġ", address_notes: "Green door", id_doc_ref: "", delivery_method: "Courier", priority: 1, assigned_driver: "", tracking_number: "TRK1", status: "Scheduled",
  signature_required: 1, signature_obtained: 0, recipient_name: "", proof_of_delivery: "", delivery_attempts: 1, failure_reason: "Not home", contains_controlled: 0, cold_chain_required: 0, ticket_ref: "TKT-00009",
  items: JSON.stringify([{ name: "Insulin pens", qty: 2, schedule: "OTC", batch_ref: "B12", expiry: "2027-01" }]), delivery_log: JSON.stringify([{ ts: "2026-11-02T08:00:00.000Z", author: "Maria Borg", text: "Delivery recorded." }]), internal_notes: "Ring twice" }, over);
export default {
  title: "Deliveries: change, delete",
  async run(t) {
    const two = async (over) => { const m = t.maxId(T); await t.api("POST", "/client-deliveries/entries", seed(over)); await t.api("POST", "/client-deliveries/entries", seed(over)); const r = t.since(T, m); return [r[0].id, r[1].id]; };
    const classicEdit = async (p, id, edit) => {
      await t.open(p, "classic", "deliveries", "deliveries", "#dv-btn-new");
      await p.click(`.dv-table tbody tr[data-id='${id}']`); await p.click("#dv-sel-edit"); await p.waitForSelector("#dv-address");
      await edit(p);
      await t.write(p, new RegExp("/client-deliveries/entries/" + id + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    };
    const newEdit = async (p, id, map, checks = {}) => {
      await t.open(p, "2", "deliveries", "dlvreg", `[data-act=open][data-id="${id}"]`);
      await p.click(`[data-act=open][data-id="${id}"]`); await p.waitForSelector("#dlv-edit"); await t.idle(p); // the record is read before typing
      await t.fill(p, "#dlv-edit", map); // field by field, each checked to have stuck
      for (const [k, v] of Object.entries(checks)) await p.setChecked("#dlv-edit [name=" + k + "]", v);
      await t.write(p, new RegExp("/client-deliveries/entries/" + id + "$"), () => p.click("#dlv-edit button[type=submit]"), "PUT");
    };
    const p = await t.page();

    // 1. The same edit (address, day, time, one item added, fridge ticked) in both screens.
    let [a, b] = await two();
    await classicEdit(p, a, async (p) => {
      await p.fill("#dv-address", "14 Triq il-Ħamrun, Żebbuġ"); await p.fill("#dv-sched-date", ymd(2)); await p.fill("#dv-sched-time", "Morning"); await p.check("#dv-cold-chain");
      await p.click(".dv-item-add-btn"); await p.locator(".dv-item-edit-row input[placeholder='Item name']").nth(1).fill("Panadol");
    });
    await newEdit(p, b, { delivery_address: "14 Triq il-Ħamrun, Żebbuġ", scheduled_date: ymd(2), scheduled_time_slot: "Morning", itemsText: "2× Insulin pens, Panadol" }, { cold_chain_required: true });
    const ca = t.row(T, a), nb = t.row(T, b);
    t.has("change(new)", nb, { delivery_address: "14 Triq il-Ħamrun, Żebbuġ", scheduled_date: ymd(2), scheduled_time_slot: "Morning", cold_chain_required: 1, email: "censina@example.mt", tracking_number: "TRK1", delivery_attempts: 1, failure_reason: "Not home", internal_notes: "Ring twice", delivery_log: seed().delivery_log });
    t.ok(nb && nb.items === JSON.stringify([{ name: "Insulin pens", qty: 2, schedule: "OTC", batch_ref: "B12", expiry: "2027-01" }, { name: "Panadol", qty: 1, schedule: "OTC", batch_ref: "", expiry: "" }]), "change(new): the item kept its batch and expiry, the new one is the classic default: " + (nb && nb.items));
    t.same("change", ca, nb, { delivery_id: "batch 6 (W3): the two rows were seeded with the same number; the server gave the second the next one" });

    // 2. A change to one field only: the new screen keeps what the classic edit has no field for.
    [a, b] = await two({ id_doc_ref: "123456M", assigned_driver: "Joe Abela", contains_controlled: 1 });
    await classicEdit(p, a, async (p) => { await p.fill("#dv-sched-time", "Evening"); });
    await newEdit(p, b, { scheduled_time_slot: "Evening" });
    const ca2 = t.row(T, a), nb2 = t.row(T, b);
    t.has("keep(new)", nb2, { scheduled_time_slot: "Evening", id_doc_ref: "123456M", assigned_driver: "Joe Abela", contains_controlled: 1 });
    t.same("keep", ca2, nb2, {
      delivery_id: "batch 6 (W3): the two rows were seeded with the same number; the server gave the second the next one",
      id_doc_ref: "the classic edit sends #dv-id-doc, a field its form does not have, so it empties the ID document; the new screen keeps it",
      assigned_driver: "the classic edit's driver list is this browser's; a driver it does not list is emptied; the new screen keeps it",
      contains_controlled: "the classic edit has no controlled-drug box and clears the flag unless an item is CD; the new screen keeps it",
    });

    // 3. Delete (pharmacist): the reason goes in the log first, so the audit's copy of the deleted delivery has it.
    [a] = await two({ client_name: "Vella Ġużeppi" });
    const before = t.maxId("audit_log"); await p.goto("about:blank"); // the same address again would not reload the list
    await t.open(p, "2", "deliveries", "dlvreg", `[data-act=open][data-id="${a}"]`);
    await p.click(`[data-act=open][data-id="${a}"]`); await p.click("#dlv-edit [data-act=del]");
    await p.click("#dlv-edit [data-act=del-go]"); await p.waitForTimeout(200);
    t.ok(t.row(T, a), "delete: nothing is deleted without a reason");
    await p.fill("#dlv-edit [name=del_reason]", "Entered twice");
    await t.write(p, new RegExp("/client-deliveries/entries/" + a + "$"), () => p.click("#dlv-edit [data-act=del-go]"), "DELETE");
    t.ok(!t.row(T, a), "delete: the row is gone");
    const aud = t.db.prepare("SELECT action, details_json FROM audit_log WHERE id > ? AND entity_type = 'client_deliveries' AND entity_id = ? ORDER BY id").all(before, String(a));
    t.ok(aud.map((x) => x.action).join() === "DELIVERY_UPDATE,DELIVERY_DELETE", "delete: audit has the reason's update then the delete: " + aud.map((x) => x.action).join());
    t.ok(aud.length && /Deleted: Entered twice/.test(aud[aud.length - 1].details_json), "delete: the deleted delivery in the audit carries the reason");
  },
};
