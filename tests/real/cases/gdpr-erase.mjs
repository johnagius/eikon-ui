// Privacy, erase (gdpr): on the real worker, the confirmation's numbers are what the erase does. A customer with an order,
// a question, a delivery, a controlled-drug delivery, a DDA line and a repeat prescription, plus a same-name order nobody
// ticks and another person's order with their phone. Erase is sent only after the name is typed; afterwards exactly the
// rows the confirmation counted changed (and only name/ID/contact columns), every kept row is byte-for-byte as it was,
// nobody else's row moved, the audit line holds counts only. Undo puts every row back byte for byte.
import { maltaYmd } from "../../clock.mjs";
export default {
  title: "Privacy: erase one person — preview == effect, kept rows unchanged, others untouched, 24-hour undo",
  async run(t) {
    const tag = String(Date.now() % 100000).padStart(5, "0"), name = "Rita Spiteri " + tag, card = tag + "2M", phone = "798" + tag;
    const d = (n) => maltaYmd(-n);
    const pid = (await t.api("POST", "/people", { name, id_card: card, phone, email: "rita" + tag + "@demo.mt", address: "3 Triq il-Kbira, Mosta", notes: "Prefers mornings" })).person.id;
    await t.api("POST", "/client-orders/entries", { order_date: d(1), client_name: name, client_phone: phone, items_text: "Vitamin D " + tag, needed_by: d(0), priority: 2, notes: "ring first" });
    await t.api("POST", "/client-orders/entries", { order_date: d(2), client_name: name, items_text: "Plasters " + tag, needed_by: d(0), priority: 2 });
    await t.api("POST", "/client-orders/entries", { order_date: d(1), client_name: "Mark Vella " + tag, client_phone: phone, items_text: "Soap " + tag, needed_by: d(0), priority: 2 });
    await t.api("POST", "/client-tickets/entries", { open_date: d(1), client_name: name, phone, issue: "Question " + tag, category: "General Enquiry", priority: 2, status: "Open", ticket_id: "TKT-" + tag });
    await t.api("POST", "/client-deliveries/entries", { order_date: d(1), scheduled_date: d(-1), client_name: name, phone, delivery_address: "3 Triq il-Kbira, Mosta", items: "Box " + tag, status: "Scheduled", delivery_id: "DEL-" + tag });
    await t.api("POST", "/client-deliveries/entries", { order_date: d(1), scheduled_date: d(-1), client_name: name, phone, delivery_address: "3 Triq il-Kbira, Mosta", items: "CD box " + tag, status: "Scheduled", delivery_id: "DEC-" + tag, contains_controlled: 1 });
    await t.api("POST", "/dda-sales/entries", { entry_date: d(0), client_name: name, client_id_card: card, client_address: "3 Triq il-Kbira, Mosta", medicine_name_dose: "Oxycodone 5mg", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "E" + tag });
    await t.api("POST", "/repeat-prescriptions/entries", { entry_date: d(3), client_name: name, client_id: card, medicine_name_dose: "Ramipril " + tag, posology: "1 od", prescriber_name: "Dr Galea", prescriber_reg_no: "R2", collect_every_days: 28 });
    const TABLES = ["people", "client_orders_entries", "client_tickets_entries", "client_deliveries", "dda_sales_entries", "repeat_prescription_entries"];
    let keys = null; // the rows that carried the tag before the erase, read again by id afterwards (an erased row no longer carries it)
    const mine = () => { const o = {}; if (!keys) { for (const tb of TABLES) for (const r of t.db.prepare("SELECT * FROM " + tb).all()) if (JSON.stringify(r).includes(tag)) o[tb + ":" + r.id] = r; keys = Object.keys(o); return o; }
      for (const k of keys) { const [tb, id] = k.split(":"); o[k] = t.db.prepare("SELECT * FROM " + tb + " WHERE id = ?").get(Number(id)); } return o; };
    const diff = (a, b) => { const out = {}; for (const k of Object.keys(a)) { const c = Object.keys(a[k]).filter((x) => JSON.stringify(a[k][x]) !== JSON.stringify((b[k] || {})[x])); if (c.length) out[k] = c.sort(); } return out; };
    const before = mine();
    t.ok(Object.keys(before).length === 9, "seeded 9 rows that carry the tag: " + Object.keys(before).join(","));

    const p = await t.page({ phone: true });
    await t.open(p, "2", "expreg", "expreg", ".exp [data-act=download]");
    await p.fill("#exp-who", name); await p.waitForSelector(`[data-person="${pid}"]`, { timeout: 10000 });
    await p.click(`[data-person="${pid}"]`);
    await p.waitForSelector(".prv [data-act=erase]", { timeout: 15000 });
    const prevResp = p.waitForResponse((r) => /\/people\/\d+\/privacy$/.test(new URL(r.url()).pathname), { timeout: 15000 });
    await p.click(".prv [data-act=erase]");
    const preview = await (await prevResp).json();
    await p.waitForSelector("#prv-typed");
    const conf = await p.innerText(".prv");
    t.ok(/You can undo this for 24 hours\. After that it cannot be undone\./.test(conf) && /Kept for now, the law may need them/.test(conf) && /Deliveries\s+2/.test(conf) && new RegExp("Erase " + name).test(conf),
      "the confirmation names what is kept (DDA, repeat, both deliveries) and the 24-hour line: " + conf.replace(/\n+/g, " | ").slice(0, 600));
    let erases = 0; p.on("request", (r) => { if (/\/erase$/.test(new URL(r.url()).pathname) && /"confirm":true/.test(r.postData() || "")) erases++; });
    await p.click(".prv [data-act=go]", { force: true }); await p.waitForTimeout(200);
    t.ok(erases === 0, "nothing is sent before the name is typed");
    await p.fill("#prv-typed", name);
    const w = await t.write(p, /\/people\/\d+\/erase$/, () => p.keyboard.press("Enter"));
    await p.waitForSelector(".prv [data-act=undo2]");
    t.ok(w.body && w.body.confirm === true && w.body.plan === preview.plan && w.body.rows.length === 0, "the erase sends the plan it showed, no unticked row: " + JSON.stringify(w.body));
    const after = mine(), d1 = diff(before, after);
    const changedRows = Object.keys(d1);
    t.ok(changedRows.length === preview.total_change && w.json.changed === preview.total_change, "rows changed == the confirmation's number (" + preview.total_change + "): " + JSON.stringify(d1));
    const allowed = /^(name|id_card|phone|alt_phone|email|address|notes|source|version|updated_at|updated_by|client_name|client_phone|client_alt_phone|client_email|client_address|notes_log|delivery_address|address_notes|recipient_name|internal_notes|id_doc_ref|proof_of_delivery)$/;
    t.ok(changedRows.every((k) => d1[k].every((c) => allowed.test(c))), "only name, ID card and contact columns changed");
    const kept = Object.keys(before).filter((k) => /^(dda_sales_entries|repeat_prescription_entries):/.test(k) || (k.startsWith("client_deliveries:") && Number(before[k].contains_controlled) === 1) || JSON.stringify(before[k]).includes("Mark Vella") || JSON.stringify(before[k]).includes("Plasters"));
    t.ok(kept.length === 5 && kept.every((k) => !d1[k]), "DDA, repeat, the controlled-drug delivery, the unticked same-name order and another person's order are byte-for-byte unchanged: " + kept.join(","));
    t.ok(after["people:" + pid].name === "Erased person #" + pid && after["people:" + pid].id_card === "" && after["people:" + pid].phone === "", "the customer record is now Erased person #" + pid);
    const a = t.db.prepare("SELECT * FROM audit_log WHERE action = 'PERSON_ERASE' AND entity_id = ? ORDER BY id DESC").get(String(pid));
    t.ok(a && !a.details_json.includes(tag) && !a.details_json.includes(phone), "the audit line holds counts only");
    await t.write(p, /\/people\/erasures\/gdpr_[0-9a-f-]+\/undo$/, () => p.click(".prv [data-act=undo2]"));
    await p.waitForFunction(() => /Put back/.test((document.querySelector("#prv-h") || {}).textContent || ""));
    const back = mine(), d2 = diff(before, back);
    const left = Object.entries(d2).filter(([k, c]) => !(k === "people:" + pid && c.every((x) => /^(version|updated_at|updated_by)$/.test(x))));
    t.ok(left.length === 0, "Undo: every row back byte for byte (the person's version and stamp moved, as any edit): " + JSON.stringify(left));
    t.ok(t.db.prepare("SELECT COUNT(*) AS c FROM gdpr_erasure_rows WHERE erasure_id = ?").get(w.json.erasure_id).c === 0, "Undo: the copies of the old values are gone");
  }
};
