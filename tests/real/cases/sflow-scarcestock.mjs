// Scarce stock (scsreg, Stock flows round 2): your shared line's Delete, Send to Returns and Offer in Transfers, closed
// out of the classic screen. Twin lines; the classic Available stock tab acts on one, the new screen on the other: the
// same call (no body), the same rows after (the line, and the return / transfer it makes), the same audit entries.
import { ymd } from "../lib.mjs";
import { twinDelete, writes, audit, strip } from "./_sfdel.mjs";
const SO = "scarce_stock_offers";
const A = (rows) => JSON.stringify(rows.map((r) => ({ action: r.action, details: strip(JSON.parse(r.details_json || "null")) })));
const line = (item) => ({ entry_date: ymd(0), item_name: item, description: "Fridge, pack of 1", batch: "SB-Ħ1", expiry_date: ymd(150), quantity_available: 4, is_closed: 0 });
export default {
  title: "Scarce stock: delete, to Returns, to Transfers, as classic",
  async run(t) {
    const p = await t.page();
    await t.api("GET", "/returns/entries?open=1"); await t.api("GET", "/stock-transfers/items?open=1"); // the tables a pharmacy that used them has (see sflow-transfers)
    const twins = async (item) => { const m = t.maxId(SO); for (let i = 0; i < 2; i++) await t.api("POST", "/scarce-stock/offers", line(item)); return t.since(SO, m, { item_name: item }).map((r) => r.id); };
    const classicRow = async (item) => { await p.goto("about:blank"); await t.open(p, "classic", "scarcestock", "scarcestock", `tr:has-text("${item}")`); return p.locator(`tr:has-text("${item}")`); };
    const openNew = async (sel) => { await p.goto("about:blank"); await t.open(p, "2", "scsreg", "scsreg", sel); };
    const shape = (r) => JSON.stringify(r.filter((x) => x.m !== "GET").map((x) => x.m + " " + x.path.replace(/\d+/g, "#") + " " + (x.body == null ? "" : x.body)));

    // 1. Delete.
    let ids = await twins("Twin Scarce Delete Shingrix");
    await twinDelete(t, p, {
      label: "delete line", table: SO, entity: SO, action: "SCARCE_OFFER_DELETE", a: ids[0], b: ids[1], path: () => /^\/scarce-stock\/offers\/\d+$/, pick: true,
      classic: async () => { const r = await classicRow("Twin Scarce Delete Shingrix"); await r.first().locator('button:has-text("Delete")').click(); await p.click("#eikon-modal-actions .eikon-btn.primary"); },
      fresh: async () => {
        const id = ids.find((x) => t.row(SO, x));
        await openNew(`[data-act=del][data-id="${id}"]`); await p.click(`[data-act=del][data-id="${id}"]`);
        t.ok(/Delete Twin Scarce Delete Shingrix from Scarce stock\? Requests for it are deleted too\. This cannot be undone\./.test(await p.evaluate(() => document.body.innerText)), "delete line: the question names it");
        await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "del-cancel", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("delete line: the question opens on Keep it"));
        await p.click(`[data-act=del-go][data-id="${id}"]`);
      },
    });

    // 2. Place on Returns (classic asks first; the new screen does it in one tap) and 3. Place on Transfer.
    for (const [what, btn, act, path, table, key] of [["returns", "Place on Returns", "to-returns", "place-on-returns", "returns_entries", "description"], ["transfer", "Place on Transfer", "to-transfer", "place-on-transfer", "stock_transfer_items", "item_description"]]) {
      const item = "Twin Scarce " + what + " Ozempic";
      ids = await twins(item);
      let m = t.maxId(table), au = t.maxId("audit_log");
      const r = await classicRow(item);
      const cReq = await writes(p, /scarce-stock/, async () => { await r.first().locator(`button:has-text("${btn}")`).click(); await t.write(p, new RegExp("/" + path + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary")); await t.idle(p); });
      const a = ids.find((id) => what === "returns" ? t.row(SO, id).placed_on_returns : t.row(SO, id).transfer_item_id), b = ids.find((id) => id !== a);
      if (!t.ok(a && b, what + ": the classic placed one twin")) continue;
      const cMade = t.since(table, m, { [key]: item }), ca = audit(t, SO, a, au);
      m = t.maxId(table); au = t.maxId("audit_log");
      await openNew(`[data-act=${act}][data-id="${b}"]`);
      const nReq = await writes(p, /scarce-stock/, async () => { await t.write(p, new RegExp("^/scarce-stock/offers/" + b + "/" + path + "$"), () => p.click(`[data-act=${act}][data-id="${b}"]`)); await t.idle(p); });
      const nMade = t.since(table, m, { [key]: item });
      t.ok(shape(cReq) === shape(nReq), what + ": the same call: classic " + shape(cReq) + " new " + shape(nReq));
      t.ok(cMade.length === 1 && nMade.length === 1, what + ": one " + table + " row each (" + cMade.length + "/" + nMade.length + ")");
      const drop = (o) => { const x = { ...o }; for (const k of ["source_id", "scarce_stock_offer_id", "placed_on_scarce_stock_id"]) delete x[k]; return x; };
      t.same(what + " (made)", drop(cMade[0] || {}), drop(nMade[0] || {}));
      const la = { ...t.row(SO, a) }, lb = { ...t.row(SO, b) }; delete la.placed_on_returns_id; delete lb.placed_on_returns_id; delete la.transfer_item_id; delete lb.transfer_item_id;
      t.same(what + " (line)", la, lb);
      const na = audit(t, SO, b, au);
      t.ok(A(ca).replace(/\d{2,}/g, "#") === A(na).replace(/\d{2,}/g, "#") || A(ca).replace(/"(returns_id|transfer_item_id|transfer_id)":\d+/g, "") === A(na).replace(/"(returns_id|transfer_item_id|transfer_id)":\d+/g, ""), what + ": the same audit entry: " + A(ca).slice(0, 160) + " vs " + A(na).slice(0, 160));
      await p.waitForSelector(`[data-act=edit][data-id="${b}"]`);
      t.ok(!(await p.locator(`[data-act=${act}][data-id="${b}"]`).count()), what + ": the button goes once it is done");
    }
    t.ok(!/Deleting a line, placing it on Transfers or Returns/.test(await p.evaluate(() => document.body.innerText)), "the footnote no longer sends these to the classic screen");
  },
};
