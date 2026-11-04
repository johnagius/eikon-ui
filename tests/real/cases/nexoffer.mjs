// Near expiry (nexreg, BACKLOG5 item 10b) vs the classic "Add to Scarce Stock": offering two identical items leaves
// identical Scarce stock lines and near-expiry links, column by column, and identical audit rows. The line belongs to
// this pharmacy (org and location from the sign-in, never from the screen), as in the classic screen.
import { ymd } from "../lib.mjs";
const NE = "near_expiry_entries", SS = "scarce_stock_offers";
const audit = (t, since, neId) => t.db.prepare("SELECT org_id, user_id, action, entity_type, location_id, details_json FROM audit_log WHERE id > ? AND action = 'SCARCE_OFFER_CREATE' ORDER BY id").all(since)
  .filter((x) => JSON.parse(x.details_json).near_expiry_id === neId).map((x) => { const d = JSON.parse(x.details_json); delete d.near_expiry_id; return { ...x, details_json: JSON.stringify(d) }; });
export default {
  title: "Near expiry: offer to other pharmacies",
  async run(t) {
    const item = { product_name: "Shingrix Ż vaccine", expiry_date: ymd(45), location: "Fridge", notes: "2 boxes" };
    const m = t.maxId(NE); await t.api("POST", "/near-expiry/entries", item); await t.api("POST", "/near-expiry/entries", item);
    const [a, b] = t.since(NE, m, { product_name: item.product_name }).map((r) => r.id);
    const p = await t.page();

    // classic: Add to Scarce Stock, 3 available, batch B12
    await t.open(p, "classic", "nearexpiry", "nearexpiry", `[data-act="add-stock"][data-id="${a}"]`);
    await p.click(`[data-act="add-stock"][data-id="${a}"]`); await p.waitForSelector("#ne-stock-qty:visible");
    await p.fill("#ne-stock-qty", "3"); await p.fill("#ne-stock-batch", "B12");
    const c0 = t.maxId("audit_log"), s0 = t.maxId(SS);
    const wc = await t.write(p, /\/scarce-stock\/offers$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = t.since(SS, s0, { near_expiry_id: a })[0];

    // new: Offer, 3, B12, Offer in Scarce stock
    await p.goto("about:blank"); await t.open(p, "2", "nearexpiry", "nexreg", `[data-act=offer][data-id="${b}"]`);
    await p.click(`[data-act=offer][data-id="${b}"]`); await p.waitForSelector("#nex-offer");
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === "qty", null, { timeout: 2000 }).catch(() => {});
    t.ok(await p.evaluate(() => document.activeElement && document.activeElement.name === "qty" && document.activeElement.value === "1"), "offer(new): the form opens on How many, 1 filled in as in the classic");
    await t.fill(p, "#nex-offer", { qty: "3", batch: "B12" });
    const n0 = t.maxId("audit_log"), s1 = t.maxId(SS);
    const wn = await t.write(p, /\/scarce-stock\/offers$/, () => p.click("#nex-offer button[type=submit]"));
    const fresh = t.since(SS, s1, { near_expiry_id: b })[0];

    const strip = (x) => { const o = { ...(x || {}) }; delete o.near_expiry_id; return o; };
    t.ok(JSON.stringify(strip(wc.body)) === JSON.stringify(strip(wn.body)) && wn.body.near_expiry_id === b, "offer: the new body is the classic one, field for field: " + JSON.stringify(wc.body) + " vs " + JSON.stringify(wn.body));
    t.has("offer(new)", fresh, { item_name: item.product_name, expiry_date: item.expiry_date, batch: "B12", quantity_available: 3, is_closed: 0, near_expiry_id: b });
    t.same("offer", classic, fresh, { near_expiry_id: "each line links back to its own near-expiry item" });
    t.ok(fresh && classic && fresh.org_id === classic.org_id && fresh.location_id === classic.location_id, "offer: the line is this pharmacy's, as the classic one");
    t.same("near-expiry link", { ...t.row(NE, a), scarce_stock_offer_id: "x" }, { ...t.row(NE, b), scarce_stock_offer_id: "x" });
    t.ok(t.row(NE, a).scarce_stock_offer_id === classic.id && t.row(NE, b).scarce_stock_offer_id === fresh.id, "offer: each item is linked to its line");
    const ac = audit(t, c0, a), an = audit(t, n0, b);
    t.ok(ac.length === 1 && JSON.stringify(ac) === JSON.stringify(an), "offer: the audit rows are the same: " + JSON.stringify(ac) + " vs " + JSON.stringify(an));
    await t.idle(p);
    const after = await p.evaluate((id) => ({ btn: !!document.querySelector(`[data-act=offer][data-id="${id}"]`), txt: document.body.innerText }), b);
    t.ok(!after.btn && /In Scarce stock/.test(after.txt), "offer(new): the item now says In Scarce stock and cannot be offered twice");

    // an expired item has no Offer, as in the classic screen
    await t.api("POST", "/near-expiry/entries", { product_name: "Expired Ġ syrup", expiry_date: ymd(-1), location: "", notes: "" });
    await p.goto("about:blank"); await t.open(p, "2", "nearexpiry", "nexreg", ".nex-row");
    t.ok(await p.evaluate(() => { const r = [...document.querySelectorAll(".nex-row")].find((x) => /Expired Ġ syrup/.test(x.textContent)); return r && !r.querySelector("[data-act=offer]"); }), "offer(new): an expired item cannot be offered");
  },
};
