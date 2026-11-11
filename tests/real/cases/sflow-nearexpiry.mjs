// Near expiry (nexreg, Stock flows round 2): change and delete a line, closed out of the classic screen. Twin lines; the
// classic Edit / Delete acts on one, the new screen's tap-to-open panel on the other: the same PUT body (key order and
// values) or DELETE with no body, the same rows, the same audit entries. Staff see Delete…, as classic shows it to all.
import { ymd } from "../lib.mjs";
import { twinDelete, staffPage, audit, strip } from "./_sfdel.mjs";
const T = "near_expiry_entries";
const A = (rows) => JSON.stringify(rows.map((r) => ({ action: r.action, details: strip(JSON.parse(r.details_json || "null")) })));
export default {
  title: "Near expiry: change and delete in the new layout, as classic",
  async run(t) {
    const p = await t.page();
    const twins = async (name) => { const m = t.maxId(T); for (let i = 0; i < 2; i++) await t.api("POST", "/near-expiry/entries", { product_name: name, expiry_date: ymd(25), location: "Shelf Ħ4", notes: "3 boxes" }); return t.since(T, m, { product_name: name }).map((r) => r.id); };
    const openNew = async (id) => { await p.goto("about:blank"); await t.open(p, "2", "nexreg", "nexreg", `[data-act=open][data-id="${id}"]`); await p.click(`[data-act=open][data-id="${id}"]`); await p.waitForSelector("#nex-edit"); };

    // 1. Change: where, notes, expiry.
    let [a, b] = await twins("Twin Expiry Change Ċipro 500mg");
    let au = t.maxId("audit_log");
    await t.open(p, "classic", "nearexpiry", "nearexpiry", `[data-act=edit][data-id="${a}"]`);
    await p.click(`[data-act=edit][data-id="${a}"]`); await p.waitForSelector("#ne-edit-loc");
    await p.fill("#ne-edit-loc", "Fridge Ż"); await p.fill("#ne-edit-notes", "2 boxes left"); await p.fill("#ne-edit-exp", ymd(20));
    const cw = await t.write(p, new RegExp("^/near-expiry/entries/" + a + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    const ca = audit(t, T, a, au); au = t.maxId("audit_log");
    await openNew(b);
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === "product_name", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("change(new): the panel opens on the product"));
    await t.fill(p, "#nex-edit", { location: "Fridge Ż", notes: "2 boxes left", expiry_date: ymd(20) });
    const nw = await t.write(p, new RegExp("^/near-expiry/entries/" + b + "$"), () => p.click("#nex-edit button[type=submit]"), "PUT");
    t.ok(JSON.stringify(nw.body) === JSON.stringify(cw.body), "change: the classic Edit body:\n classic " + JSON.stringify(cw.body) + "\n new     " + JSON.stringify(nw.body));
    t.same("change", t.row(T, a), t.row(T, b));
    t.ok(A(ca) === A(audit(t, T, b, au)) && ca.length === 1, "change: the same audit entry");
    await p.waitForFunction((id) => !document.querySelector("#nex-edit") && document.activeElement && document.activeElement.getAttribute("data-id") === String(id), b, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("change(new): focus is not back on the item"));
    // no expiry: refused before sending
    await p.click(`[data-act=open][data-id="${b}"]`); await p.waitForSelector("#nex-edit"); await p.fill("#nex-edit [name=expiry_date]", "");
    const before = JSON.stringify(t.row(T, b)); await p.click("#nex-edit button[type=submit]"); await p.waitForSelector("#nex-edit .nex-err");
    t.ok(/Choose the expiry date/.test(await p.textContent("#nex-edit .nex-err")) && JSON.stringify(t.row(T, b)) === before, "change(new): no expiry, nothing saved, says what to do");
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === "expiry_date", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("change(new): focus is not on the expiry"));
    await p.keyboard.press("Escape"); await p.waitForTimeout(100);
    t.ok(!(await p.$("#nex-edit")), "change(new): Escape closes it");

    // 2. Delete.
    [a, b] = await twins("Twin Expiry Delete Zinc cream");
    await twinDelete(t, p, {
      label: "near expiry delete", table: T, entity: T, action: "NEAR_EXPIRY_DELETE", a, b, path: (id) => new RegExp("^/near-expiry/entries/" + id + "$"),
      classic: async (p, id) => { await p.goto("about:blank"); await t.open(p, "classic", "nearexpiry", "nearexpiry", `[data-act=del][data-id="${id}"]`); await p.click(`[data-act=del][data-id="${id}"]`); await p.click('#eikon-modal-actions button:has-text("Delete")'); },
      fresh: async (p, id) => {
        await openNew(id); await p.click("#nex-edit [data-act=del]");
        t.ok(/Delete Twin Expiry Delete Zinc cream \(expires .+\)\? This cannot be undone\./.test(await p.textContent("#nex-edit")), "near expiry delete: the question names it");
        await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "del-cancel", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("near expiry delete: the question opens on Keep it"));
        await p.click("#nex-edit [data-act=del-go]");
      },
    });
    t.ok(!(await p.evaluate(() => !!document.querySelector(".nex [data-act=classic]"))), "the screen no longer sends anything to the classic screen");

    const s = await staffPage(t);
    if (s) {
      const [id] = await twins("Staff View Expiry");
      await t.open(s, "2", "nexreg", "nexreg", `[data-act=open][data-id="${id}"]`); await s.click(`[data-act=open][data-id="${id}"]`); await s.waitForSelector("#nex-edit");
      t.ok(await s.locator("#nex-edit [data-act=del]").count() === 1, "staff: Delete…, as classic");
    }
  },
};
