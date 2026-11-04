// Customers & messaging (d-cust) on the real worker:
//  - Orders: Ready sends exactly what it always sent ({"fulfilled":true}), focus lands on "Tell <name>", WhatsApp opens
//    with the message written (the wa.me link is aborted: nothing leaves), one message row + one audit line, the order
//    row is unchanged by the telling; the customer's record shows the order as told, and the message in the story.
//  - E-mail from the record goes through the pharmacy's own sender (stubbed): one e-mail, row "sent".
//  - A "no" to SMS on the record makes SMS unchoosable in the window.
//  - Loyalty from the record stores the same row as the classic screen's body for the same purchase.
import { ymd } from "../lib.mjs";
const P = { name: "Żammit Ċensina", id_card: "0884455M", phone: "79884455", email: "censina@example.com" };
export default {
  title: "Customers: tell the customer (WhatsApp, e-mail), preferences, loyalty in the record",
  async run(t) {
    const made = await t.api("POST", "/people", P);
    if (!t.ok(made && made.ok, "person")) return;
    const pid = made.person.id;
    const o = await t.api("POST", "/client-orders/entries", { order_date: ymd(0), client_name: P.name, contact: P.phone, client_phone: P.phone, items: "Ventolin inhaler", items_text: "Ventolin inhaler", needed_by: ymd(1), pickup_date: ymd(1), priority: 2 });
    const oid = o && (o.entry_id || o.id || (o.entry && o.entry.id));
    if (!t.ok(oid, "order made: " + JSON.stringify(o))) return;
    const p = await t.page();
    const opened = []; p.context().on("page", (pg) => opened.push(pg.url()));
    await t.open(p, "2", "clientorders", "ordreg", `[data-act=ready][data-id="${oid}"]`);
    const puts = []; p.on("request", (r) => { if (r.method() === "PUT") puts.push(new URL(r.url()).pathname + " " + r.postData()); });
    await p.click(`[data-act=ready][data-id="${oid}"]`);
    await p.waitForFunction((id) => document.activeElement && document.activeElement.matches(`[data-act=tell][data-id="${id}"]`), oid, { timeout: 15000 }).catch(() => {});
    t.ok(puts.length === 1 && puts[0] === `/client-orders/entries/${oid} {"fulfilled":true}`, "Ready sends what it always sent: " + JSON.stringify(puts));
    t.ok(await p.evaluate((id) => document.activeElement && document.activeElement.matches(`[data-act=tell][data-id="${id}"]`), oid), "focus on Tell after Ready");
    const orderRow = JSON.stringify(t.row("client_orders_entries", oid));
    const m0 = t.maxId("cust_messages");
    await p.click(`[data-act=tell][data-id="${oid}"]`);
    await p.waitForSelector(".tl-ov [data-act=open]:not([aria-disabled=true])", { timeout: 15000 });
    const d = await p.evaluate(() => ({ text: document.querySelector("#tl-text").value, href: document.querySelector(".tl-ov [data-act=open]").getAttribute("href"), ch: document.querySelector("input[name=tl-ch]:checked").value }));
    t.ok(d.ch === "whatsapp" && /^Hi Ċensina, your order \(Ventolin inhaler\) is ready to collect/.test(d.text) && d.href.indexOf("https://wa.me/35679884455?text=Hi%20%C4%8Aensina") === 0, "the window: WhatsApp, the words, the link: " + JSON.stringify(d));
    await p.click(".tl-ov [data-act=open]");
    const rows = await t.mine("cust_messages", m0, { person_id: pid }, 1);
    const mr = rows[0] || {};
    t.ok(rows.length === 1 && mr.channel === "whatsapp" && mr.status === "device" && mr.person_id === pid && mr.ref_kind === "order" && mr.ref_id === oid && mr.purpose === "ready" && mr.to_addr === "79884455" && mr.body === d.text, "one message row: " + JSON.stringify(mr));
    t.ok(t.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action='CUST_MESSAGE' AND entity_id=?").get(String(mr.id)).c === 1, "in the audit");
    t.ok(JSON.stringify(t.row("client_orders_entries", oid)) === orderRow, "telling changes nothing on the order");
    await p.waitForTimeout(300);
    t.ok(opened.length >= 1, "WhatsApp opened in a new tab (aborted here; its address is the link checked above)");

    // The record
    await t.api("POST", "/bookings/senders", { kind: "resend", apiKey: "re_test", fromEmail: "hello@demo.mt", fromName: "Demo Pharmacy" });
    await t.open(p, "2", "customers", "customers", "#cus-q");
    if (await p.locator(".cus-back").isVisible().catch(() => false)) await p.click(".cus-back");
    await p.fill("#cus-q", P.id_card); await p.waitForSelector(`[data-person="${pid}"]`); await p.click(`[data-person="${pid}"]`);
    await p.waitForSelector(".cus-now", { timeout: 15000 });
    const rec = await p.evaluate(() => ({ now: document.querySelector(".cus-now").innerText, story: document.querySelector(".cus-story li").innerText }));
    t.ok(/Ready to collect · Ventolin inhaler/.test(rec.now) && /Told by WhatsApp today/.test(rec.now) && /WhatsApp · Order ready/.test(rec.story), "record: told, and in the story: " + JSON.stringify(rec));
    // e-mail from the record
    const sent0 = (globalThis.__sentEmails || []).length, m1 = t.maxId("cust_messages");
    await p.click('[data-act="tell-any"]'); await p.waitForSelector(".tl-ov input[name=tl-ch][value=email]");
    await p.click(".tl-ov label:has(input[value=email])"); await p.waitForSelector(".tl-ov [data-act=send]");
    await p.fill("#tl-text", "Hi Ċensina, the Omron M3 is back in stock.");
    await p.click(".tl-ov [data-act=send]");
    await t.mine("cust_messages", m1, { person_id: pid }, 1);
    let er = {}; for (let i = 0; i < 50; i++) { er = t.since("cust_messages", m1, { person_id: pid })[0] || {}; if (er.status && er.status !== "sending") break; await p.waitForTimeout(100); } // written, then sent
    t.ok(er.channel === "email" && er.status === "sent" && er.to_addr === P.email && (globalThis.__sentEmails || []).length === sent0 + 1, "one e-mail through the pharmacy's sender: " + JSON.stringify({ er, n: (globalThis.__sentEmails || []).length - sent0 }));
    // said no to SMS
    await p.waitForFunction(() => !document.querySelector(".tl-ov"), null, { timeout: 8000 }).catch(() => {});
    await p.click("label.cus-chip:has(input[name=sms_ok])"); await p.click("[data-act=pref-save]");
    await p.waitForFunction(() => { const i = document.querySelector("input[name=sms_ok]"); return i && i.checked && document.querySelector("[data-act=pref-save]").disabled; }, null, { timeout: 8000 }).catch(() => {});
    const prof = t.db.prepare("SELECT * FROM cust_profile WHERE person_id = ?").get(pid) || {};
    t.ok(prof.sms_ok === 0 && prof.whatsapp_ok === null && prof.email_ok === null, "only the 'no' that was ticked is stored: " + JSON.stringify(prof));
    await p.click('[data-act="tell-any"]'); await p.waitForSelector(".tl-ov input[name=tl-ch][value=sms]");
    const smsOff = await p.evaluate(() => document.querySelector(".tl-ov input[value=sms]").getAttribute("aria-disabled"));
    await p.click(".tl-ov label:has(input[value=sms])", { force: true }).catch(() => {});
    const still = await p.evaluate(() => document.querySelector("input[name=tl-ch]:checked").value);
    t.ok(smsOff === "true" && still !== "sms", "SMS cannot be chosen: " + JSON.stringify({ smsOff, still }));
    await p.keyboard.press("Escape");

    // Loyalty: the record's purchase and the classic body give the same row
    const camp = { id: "camp_dcust_1", name: "Stamps for Ċensina", type: "stamp_card", active: true, open_ended: true, stamp_target: 10, reward: "Free vitamins" };
    await t.api("POST", "/loyalty/campaigns", camp);
    const l0 = t.maxId("loyalty_transactions");
    await t.api("POST", "/loyalty/transactions", { id: "x1", client_id: "0884455M", client_name: P.name, campaign_id: camp.id, receipt_no: "R-1", items: [{ desc: "Vitamin C", qty: 2 }], total: 7.5, notes: "", stamps_awarded: 2, points_awarded: 0, action: "record", action_label: "Awarded 2 stamps", date: ymd(0), created_at: new Date().toISOString() });
    await t.open(p, "2", "customers", "customers", "#cus-q");
    if (await p.locator(".cus-back").isVisible().catch(() => false)) await p.click(".cus-back");
    await p.fill("#cus-q", P.id_card); await p.waitForSelector(`[data-person="${pid}"]`); await p.click(`[data-person="${pid}"]`);
    await p.waitForSelector("#cus-loy-box [data-act=loy-add]", { timeout: 15000 });
    const shows = await p.evaluate(() => document.querySelector("#cus-loy-box").innerText);
    t.ok(/2 of 10 stamps/.test(shows), "the stamps so far: " + shows.replace(/\n/g, " | "));
    await p.click("#cus-loy-box [data-act=loy-add]"); await p.waitForSelector("#cus-loy");
    await p.selectOption("#cus-ly-c", camp.id); await p.fill("#cus-ly-d", "Vitamin C"); await p.fill("#cus-ly-q", "2"); await p.fill("#cus-ly-t", "7.50"); await p.fill("#cus-ly-r", "R-1");
    await p.click("#cus-loy [data-act=loy-save]");
    const lr = await t.mine("loyalty_transactions", l0, { client_id_card: "0884455M" }, 2);
    t.same("loyalty", lr[0], lr[1], { created_at: "the time it was written" });
    await p.waitForFunction(() => /4 of 10 stamps/.test((document.querySelector("#cus-loy-box") || {}).innerText || ""), null, { timeout: 8000 }).catch(() => {});
    t.ok(/4 of 10 stamps/.test(await p.evaluate(() => document.querySelector("#cus-loy-box").innerText)), "the record shows the new total");
    // leave the shared lists as they were (other cases count the orders): this case's order goes
    await t.api("DELETE", "/client-orders/entries/" + oid);
    t.ok(!t.row("client_orders_entries", oid), "this case's order removed again");
  },
};
