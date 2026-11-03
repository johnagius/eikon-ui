// Deliveries (dlvreg) vs classic Deliveries.
import { ymd } from "../lib.mjs";
const IN = { name: "Vella Joe", phone: "79333444", addr: "3 Triq San Pawl, Naxxar", notes: "Blue door", items: ["Panadol", "Augmentin 625"], day: ymd(1), slot: "Afternoon" };
export default {
  title: "Deliveries",
  async run(t) {
    const T = "client_deliveries", p = await t.page();
    await t.open(p, "classic", "deliveries", "deliveries", "#dv-btn-new");
    let m = t.maxId(T);
    await p.click("#dv-btn-new"); await p.waitForSelector("#dv-client");
    await p.fill("#dv-client", IN.name); await p.fill("#dv-phone", IN.phone); await p.fill("#dv-address", IN.addr); await p.fill("#dv-addr-notes", IN.notes);
    await p.fill("#dv-sched-date", IN.day); await p.fill("#dv-sched-time", IN.slot); await p.check("#dv-cold-chain"); await p.check("#dv-sig-req");
    for (let i = 0; i < IN.items.length; i++) {
      if (await p.locator(".dv-item-edit-row input[placeholder='Item name']").count() <= i) await p.click(".dv-item-add-btn");
      await p.locator(".dv-item-edit-row input[placeholder='Item name']").nth(i).fill(IN.items[i]);
    }
    await t.write(p, /\/client-deliveries\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = t.since(T, m)[0];
    await t.open(p, "2", "deliveries", "dlvreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#dlv-add");
    const f = (n, v) => p.fill("#dlv-add [name=" + n + "]", v);
    await f("client_name", IN.name); await f("phone", IN.phone); await f("delivery_address", IN.addr); await f("address_notes", IN.notes);
    await f("items", IN.items.join(", ")); await f("scheduled_date", IN.day); await f("scheduled_time_slot", IN.slot);
    await p.check("#dlv-add [name=cold_chain_required]"); if (!(await p.isChecked("#dlv-add [name=signature_required]"))) await p.check("#dlv-add [name=signature_required]");
    await t.write(p, /\/client-deliveries\/entries$/, () => p.click("#dlv-add button[type=submit]"));
    const fresh = t.since(T, m)[0];
    t.has("deliveries(new)", fresh, { client_name: IN.name, phone: IN.phone, delivery_address: IN.addr, address_notes: IN.notes, scheduled_date: IN.day, scheduled_time_slot: IN.slot, cold_chain_required: 1, signature_required: 1, status: "Scheduled" });
    t.ok(fresh && JSON.parse(fresh.items).map((x) => x.name).join() === IN.items.join(), "deliveries(new): both items stored");
    t.same("deliveries", classic, fresh, {
      delivery_id: "the next number in the sequence (each screen takes the next one)",
      delivery_log: "the new screen starts the log with a dated 'Delivery recorded.' line; the classic starts it empty",
    });
  },
};
