// Order diary (odreg, Stock flows round 2): Print this day opens the classic screen's printout of the day, the same
// page byte for byte, built from the same list (suppliers, statuses, carried lines and notes). Nothing is stored.
import { ymd } from "../lib.mjs";
export default {
  title: "Order diary: print the day, as classic",
  async run(t) {
    const D = "order_diary_entries", day = ymd(6); // a day of its own, so no other case's lines are on it
    for (const [item, qty, sup, notes] of [["Augmentin 625 x14", 2, "PharmaCo", "For Mrs Borg"], ["Ħ-brand syrup 200ml", 1, "", ""], ["Ventolin inhaler", 3, "Hili Pharma", ""], ["Żinc cream", 1, "PharmaCo", ""]])
      await t.api("POST", "/order-diary/entries", { order_date: day, item_name: item, qty, supplier: sup, notes });
    const ids = t.db.prepare(`SELECT id FROM ${D} WHERE order_date = ? ORDER BY id`).all(day).map((r) => r.id);
    await t.api("PUT", "/order-diary/entries/" + ids[0], { status: "received" }); await t.api("PUT", "/order-diary/entries/" + ids[2], { status: "wrong_pick" });
    const before = JSON.stringify(t.db.prepare(`SELECT * FROM ${D} WHERE order_date = ? ORDER BY id`).all(day));
    const p = await t.page();
    await p.context().addInitScript(() => { window.print = () => {}; });
    const grab = async (click) => { const [w] = await Promise.all([p.waitForEvent("popup"), click()]); await w.waitForLoadState(); await w.waitForTimeout(500); const h = await w.evaluate(() => document.documentElement.outerHTML); await w.close(); return h; };
    await t.open(p, "classic", "order-diary", "order-diary", "#od-print-btn");
    // the classic screen opens on today: move it to the day
    for (let i = 0; i < 6; i++) { await p.click("[data-nav='1']"); await t.idle(p, 150); }
    await p.waitForFunction(() => /Augmentin 625 x14/.test(document.body.innerText), null, { timeout: 8000 }).catch(() => t.note("classic: the day's list did not show"));
    await t.idle(p);
    const classic = await grab(() => p.click("#od-print-btn"));
    await t.open(p, "2", "odreg", "odreg", "[data-act=add]");
    for (let i = 0; i < 6; i++) { await p.click("[data-act=next]"); await t.idle(p, 150); }
    await p.waitForSelector("[data-act=print]");
    const fresh = await grab(() => p.click("[data-act=print]"));
    t.ok(classic.length > 800 && classic === fresh, "print: the new screen's page is the classic one, byte for byte" + (classic === fresh ? "" : ` (classic ${classic.length} chars, new ${fresh.length})\n classic ${classic.slice(0, 600)}\n new     ${fresh.slice(0, 600)}`));
    t.ok(/Ħ-brand syrup 200ml/.test(fresh) && /Unassigned/.test(fresh) && /Wrong Pick/.test(fresh) && /For Mrs Borg/.test(fresh), "print: Maltese letters, no supplier, statuses and notes are on it");
    t.ok(JSON.stringify(t.db.prepare(`SELECT * FROM ${D} WHERE order_date = ? ORDER BY id`).all(day)) === before, "print stores nothing");
    t.ok(!(await p.evaluate(() => !!document.querySelector(".odr [data-act=classic]"))), "the screen no longer sends printing to the classic screen");
  },
};
