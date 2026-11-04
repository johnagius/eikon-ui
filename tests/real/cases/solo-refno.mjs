// q5-4: reference numbers never repeat. Two fresh browsers (two devices: empty localStorage) with the screen open,
// plus rows already stored (a resolved TKT-00071, a delivered DEL-00051), each save a question and a delivery in the
// new layout, then a third fresh browser and a second visit save in the classic screens. Every number is new to the
// table, above the stored ones, in the unchanged format; and the two new-layout rows for the same input differ only
// in that number. Runs solo: it checks numbers against the whole table.
import { ymd } from "../lib.mjs"; import fs from "node:fs";
// REFNO_DUMP=<file>: write each saved body (number and clock masked) there, to diff the bodies of two versions.
const dump = (w) => { if (process.env.REFNO_DUMP && w.body) fs.appendFileSync(process.env.REFNO_DUMP, JSON.stringify(w.body, (k, v) => k === "ticket_id" || k === "delivery_id" ? "#" : k === "ts" || k === "open_date" || k === "order_date" || k === "scheduled_date" ? "-" : v) + "\n"); return w; };
const Q = { phone: "79555123", issue: "Refno check: is the cream back?", cat: "General Enquiry" };
const D = { phone: "79555124", addr: "9 Triq il-Kbira, Ħamrun", items: "Panadol", day: ymd(1), slot: "Morning" };
export default {
  title: "Reference numbers never repeat (two devices, both layouts)",
  async run(t) {
    const TQ = "client_tickets_entries", TD = "client_deliveries";
    // Rows already there: the highest is resolved / delivered, so it is not in the open lists.
    const s1 = await t.api("POST", "/client-tickets/entries", { ticket_id: "TKT-00070", open_date: ymd(-3), client_name: "Refno Seed Open", phone: "", email: "", category: Q.cat, priority: 2, status: "Open", issue: "seed", notes_log: "[]" });
    const s2 = await t.api("POST", "/client-tickets/entries", { ticket_id: "TKT-00071", open_date: ymd(-2), client_name: "Refno Seed Done", phone: "", email: "", category: Q.cat, priority: 2, status: "Resolved", issue: "seed", notes_log: "[]" });
    const s3 = await t.api("POST", "/client-deliveries/entries", { delivery_id: "DEL-00051", order_date: ymd(-2), client_name: "Refno Seed Del", delivery_address: "1 Triq", status: "Delivered", items: "[]", delivery_log: "[]" });
    t.ok(s1 && s1.ok && s2 && s2.ok && s3 && s3.ok, "seed rows stored");

    const a = await t.page(), b = await t.page(); // two devices
    // Questions: both screens open first, then each saves (B's list is older than A's save).
    await t.open(a, "2", "tickets", "tktreg", "[data-act=add]"); await t.open(b, "2", "tickets", "tktreg", "[data-act=add]");
    const addQ = async (p, name) => {
      await p.click("[data-act=add]"); await p.waitForSelector("#tkt-add");
      await p.fill("#tkt-add [name=client_name]", name); await p.fill("#tkt-add [name=phone]", Q.phone); await p.fill("#tkt-add [name=issue]", Q.issue);
      await p.selectOption("#tkt-add [name=category]", Q.cat);
      const w = dump(await t.write(p, /\/client-tickets\/entries$/, () => p.click("#tkt-add button[type=submit]")));
      return w.body && w.body.ticket_id;
    };
    const qa = await addQ(a, "Refno Anna"), qb = await addQ(b, "Refno Bernard");
    // Classic: a third fresh device, then device A again (its counter is behind the table now).
    const c = await t.page();
    const addQc = async (p, name) => {
      await t.open(p, "classic", "tickets", "tickets", "#tk-new");
      await p.click("#tk-new"); await p.waitForSelector("#tk-client");
      await p.fill("#tk-client", name); await p.fill("#tk-phone", Q.phone); await p.selectOption("#tk-category", Q.cat); await p.fill("#tk-issue", Q.issue);
      const w = dump(await t.write(p, /\/client-tickets\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary")));
      return w.body && w.body.ticket_id;
    };
    const qc = await addQc(c, "Refno Carmen"), qa2 = await addQc(a, "Refno Anna Two");
    const mineQ = [qa, qb, qc, qa2];
    t.note("questions: " + mineQ.join(", "));
    t.ok(mineQ.every((x) => /^TKT-\d{5}$/.test(String(x))), "questions: every number is TKT-nnnnn: " + mineQ.join(", "));
    t.ok(new Set(mineQ).size === 4, "questions: four different numbers: " + mineQ.join(", "));
    t.ok(mineQ.every((x) => Number(String(x).slice(4)) > 71), "questions: every number is above the stored TKT-00071: " + mineQ.join(", "));
    for (const x of mineQ) { const n = t.db.prepare(`SELECT COUNT(*) AS n FROM ${TQ} WHERE ticket_id = ?`).get(x).n; t.ok(n === 1, `questions: ${x} is stored once (found ${n})`); }
    const rowQ = (name) => t.db.prepare(`SELECT * FROM ${TQ} WHERE client_name = ? ORDER BY id DESC LIMIT 1`).get(name);
    t.same("questions(two devices)", { ...rowQ("Refno Anna"), client_name: "-" }, { ...rowQ("Refno Bernard"), client_name: "-" }, { ticket_id: "the number this check is about" });

    // Deliveries: the same, both devices with the screen open first.
    await t.open(a, "2", "deliveries", "dlvreg", "[data-act=add]"); await t.open(b, "2", "deliveries", "dlvreg", "[data-act=add]");
    const addD = async (p, name) => {
      await p.click("[data-act=add]"); await p.waitForSelector("#dlv-add");
      const f = (n, v) => p.fill("#dlv-add [name=" + n + "]", v);
      await f("client_name", name); await f("phone", D.phone); await f("delivery_address", D.addr); await f("items", D.items); await f("scheduled_time_slot", D.slot);
      const w = dump(await t.write(p, /\/client-deliveries\/entries$/, () => p.click("#dlv-add button[type=submit]")));
      return w.body && w.body.delivery_id;
    };
    const da = await addD(a, "Refno Dora"), db = await addD(b, "Refno Emanuel");
    const addDc = async (p, name) => {
      await t.open(p, "classic", "deliveries", "deliveries", "#dv-btn-new");
      await p.click("#dv-btn-new"); await p.waitForSelector("#dv-client");
      await p.fill("#dv-client", name); await p.fill("#dv-phone", D.phone); await p.fill("#dv-address", D.addr);
      const w = dump(await t.write(p, /\/client-deliveries\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary")));
      return w.body && w.body.delivery_id;
    };
    const dc = await addDc(c, "Refno Frans"), da2 = await addDc(a, "Refno Dora Two");
    const mineD = [da, db, dc, da2];
    t.note("deliveries: " + mineD.join(", "));
    t.ok(mineD.every((x) => /^DEL-\d{5}$/.test(String(x))), "deliveries: every number is DEL-nnnnn: " + mineD.join(", "));
    t.ok(new Set(mineD).size === 4, "deliveries: four different numbers: " + mineD.join(", "));
    t.ok(mineD.every((x) => Number(String(x).slice(4)) > 51), "deliveries: every number is above the stored DEL-00051: " + mineD.join(", "));
    for (const x of mineD) { const n = t.db.prepare(`SELECT COUNT(*) AS n FROM ${TD} WHERE delivery_id = ?`).get(x).n; t.ok(n === 1, `deliveries: ${x} is stored once (found ${n})`); }
    const rowD = (name) => t.db.prepare(`SELECT * FROM ${TD} WHERE client_name = ? ORDER BY id DESC LIMIT 1`).get(name);
    const rd = (name) => { const r = rowD(name); if (!r) return r; const log = JSON.parse(r.delivery_log || "[]").map((e) => ({ ...e, ts: "-" })); return { ...r, client_name: "-", delivery_log: JSON.stringify(log) }; };
    t.same("deliveries(two devices)", rd("Refno Dora"), rd("Refno Emanuel"), { delivery_id: "the number this check is about" });
  },
};
