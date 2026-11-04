// q5-8 (BACKLOG5 item 8): a busy Orders list is drawn 30 rows at a time. With 40 more orders than the others, the screen
// draws 30 rows, the count is every order, "Show 30 more" adds the rest without asking the server, a search finds an
// order past the first 30, and Ready on a row of the second page changes the stored row exactly as Ready on a row of
// the first page does (the same columns, the same values). Runs solo: it adds rows the "newest order" cases would read.
import { ymd } from "../lib.mjs";
export default {
  title: "Orders drawn 30 at a time (Show 30 more, search, Ready past 30)",
  async run(t) {
    const T = "client_orders_entries";
    for (let i = 0; i < 40; i++) {
      const r = await t.api("POST", "/client-orders/entries", { order_date: ymd(0), client_name: "Q58 Pager " + String(i).padStart(2, "0"), contact: "7958" + String(i).padStart(4, "0"), client_phone: "7958" + String(i).padStart(4, "0"), items: "Panadol " + i, needed_by: ymd(-300 + i), pick_up_date: ymd(-300 + i), deposit: "", priority: 2, notes: "" });
      if (!r || !r.ok) { t.fail("seed order " + i + ": " + JSON.stringify(r).slice(0, 120)); return; }
    }
    const p = await t.page({ phone: true });
    await t.open(p, "2", "ordreg", "ordreg", ".ord-row");
    const total = Number(t.db.prepare(`SELECT COUNT(*) AS n FROM ${T} WHERE COALESCE(fulfilled,0)=0`).get().n);
    const s0 = await p.evaluate(() => ({ rows: document.querySelectorAll(".ord-row").length, lab: document.querySelector(".ord-lab").textContent, more: (document.querySelector("[data-act=q58-more]") || {}).textContent || "" }));
    t.ok(s0.rows === Math.min(30, total), `first paint draws 30 rows (got ${s0.rows} of ${total})`);
    t.ok(new RegExp("Waiting\\s*" + total).test(s0.lab), "the count is every waiting order: " + s0.lab);
    t.ok(total <= 30 || /^Show \d+ (more \(\d+ left\)|the last \d+)|^Show the last/.test(s0.more), "a Show more button under the list: " + s0.more);
    let reqs = 0; const on = (r) => { if (r.resourceType() === "fetch" || r.resourceType() === "xhr") reqs++; }; p.on("request", on);
    while (await p.locator("[data-act=q58-more][data-key='ord:open']").count()) { await p.locator("[data-act=q58-more][data-key='ord:open']").click(); await p.waitForTimeout(80); }
    p.off("request", on);
    const all = await p.evaluate(() => document.querySelectorAll(".ord-row").length);
    t.ok(all === total && reqs === 0, `Show more draws every order (${all} of ${total}) with no request (${reqs})`);
    const small = await p.evaluate(() => [...document.querySelectorAll(".ord-back, .ord-row button, .ord-row a, .ord-tabs button, #ord-q")].filter((e) => e.getClientRects().length && e.getBoundingClientRect().height < 44).length);
    t.ok(small === 0, "every Orders target on a phone is at least 44 px tall (" + small + " smaller)");
    // Ready on the 35th of ours (second page) and on the 2nd (first page): the same change to the stored row
    const idOf = (n) => t.db.prepare(`SELECT id FROM ${T} WHERE client_name = ?`).get(n).id;
    const a = idOf("Q58 Pager 35"), b = idOf("Q58 Pager 02"), a0 = t.row(T, a), b0 = t.row(T, b);
    await t.open(p, "2", "ordreg", "ordreg", ".ord-row");
    await p.fill("#ord-q", "Q58 Pager 35"); await p.waitForTimeout(200);
    t.ok(await p.locator(`.ord-row [data-act=ready][data-id="${a}"]`).count() === 1, "a search finds an order past the first 30");
    await p.fill("#ord-q", ""); await p.waitForTimeout(200);
    await p.locator("[data-act=q58-more][data-key='ord:open']").click(); await p.waitForTimeout(100);
    const wa = await t.write(p, new RegExp("/client-orders/entries/" + a + "$"), () => p.click(`.ord-row [data-act=ready][data-id="${a}"]`), "PUT");
    await t.idle(p);
    t.ok(await p.locator(`.ord-row [data-act=open][data-id="${a}"]`).count() === 1, "the order made ready stays drawn (in Ready) though it was past 30");
    const wb = await t.write(p, new RegExp("/client-orders/entries/" + b + "$"), () => p.click(`.ord-row [data-act=ready][data-id="${b}"]`), "PUT");
    t.ok(JSON.stringify(wa.body) === JSON.stringify(wb.body) && JSON.stringify(wa.body) === '{"fulfilled":true}', "both send the same body: " + JSON.stringify(wa.body) + " / " + JSON.stringify(wb.body));
    const changed = (o, n) => Object.keys(n).filter((k) => String(o[k]) !== String(n[k])).sort().join(",");
    const ca = changed(a0, t.row(T, a)), cb = changed(b0, t.row(T, b));
    t.ok(ca && ca === cb, `the same columns change on both rows (${ca} / ${cb})`);
    const ra = t.row(T, a), rb = t.row(T, b);
    t.ok(ca.split(",").filter((k) => !/_at$/.test(k)).every((k) => String(ra[k]) === String(rb[k])), "to the same values");
  },
};
