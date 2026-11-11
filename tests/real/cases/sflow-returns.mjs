// Returns (retreg, Stock flows round 2): change, supplier refused and delete, closed out of the classic screen.
// Twin returns; the classic Details panel does it to one, the new screen's Change panel to the other: the same PUT body
// (or DELETE with no body), the same row column by column and the same audit entries.
import { ymd } from "../lib.mjs";
import { twinDelete, staffPage, audit, strip } from "./_sfdel.mjs";
const T = "returns_entries";
const base = { entry_date: ymd(0), description: "", expiry: ymd(40), batch: "RB-Ġ1", quantity: "4", supplier: "Hili Pharma", invoice_number: "INV-9", remarks: "Expiring soon", location_stored: "Back room",
  return_arranged: 1, handed_over: 0, collection_note_received: 0, credit_note_received: 0, supplier_refused: 0, damaged: 0 };
const A = (rows) => JSON.stringify(rows.map((r) => ({ action: r.action, details: strip(JSON.parse(r.details_json || "null")) })));
export default {
  title: "Returns: change, refused and delete in the new layout, as classic",
  async run(t) {
    const twins = async (desc) => { const m = t.maxId(T); const b = { ...base, description: desc }; await t.api("POST", "/returns/entries", b); await t.api("POST", "/returns/entries", b); return t.since(T, m, { description: desc }).map((r) => r.id); };
    const p = await t.page();
    // classic: pick the twin by its id (the rows carry none: the Details panel says "Selected ID: n")
    const classicPick = async (desc, id) => {
      await p.goto("about:blank"); await t.open(p, "classic", "returns", "returns", `#re-tbody tr:has-text("${desc}")`);
      const rows = p.locator(`#re-tbody tr:has-text("${desc}")`);
      for (let i = 0; i < await rows.count(); i++) { await rows.nth(i).click(); if (new RegExp("ID: " + id + "\\b").test(await p.textContent("#re-sel-meta"))) return true; }
      t.fail("classic: twin " + id + " not found"); return false;
    };
    const openNew = async (id) => {
      await p.goto("about:blank"); await t.open(p, "2", "retreg", "retreg", `[data-act=open][data-id="${id}"]`);
      await p.click(`[data-act=open][data-id="${id}"]`); await p.waitForSelector("#rtn-edit");
    };

    // 1. A change: how many, supplier, why, kept in, handed over ticked, damaged ticked.
    let [a, b] = await twins("Twin Return Ċiprofloxacin 500mg");
    let au = t.maxId("audit_log");
    await classicPick("Twin Return Ċiprofloxacin 500mg", a);
    await p.fill("#re-qty", "6"); await p.fill("#re-supplier", "Hili Pharma Ltd"); await p.fill("#re-remarks", "Damaged"); await p.fill("#re-location", "Ħal Far store");
    await p.check("#re-handed-over"); await p.check("#re-damaged");
    const cw = await t.write(p, new RegExp("^/returns/entries/" + a + "$"), () => p.click("#re-save"), "PUT");
    const ca = audit(t, T, a, au); au = t.maxId("audit_log");
    await openNew(b);
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === "description", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("change(new): the panel opens on the item"));
    t.ok(await p.getAttribute(`[data-act=open][data-id="${b}"]`, "aria-expanded") === "true", "change(new): the item says it is open");
    await t.fill(p, "#rtn-edit", { quantity: "6", supplier: "Hili Pharma Ltd", remarks: "Damaged", location_stored: "Ħal Far store" });
    await p.check("#rtn-edit [name=handed_over]"); await p.check("#rtn-edit [name=damaged]");
    const nw = await t.write(p, new RegExp("^/returns/entries/" + b + "$"), () => p.click("#rtn-edit button[type=submit]"), "PUT");
    t.ok(JSON.stringify(nw.body) === JSON.stringify(cw.body), "change: the classic Save body:\n classic " + JSON.stringify(cw.body) + "\n new     " + JSON.stringify(nw.body));
    t.has("change(new)", t.row(T, b), { quantity: "6", supplier: "Hili Pharma Ltd", remarks: "Damaged", location_stored: "Ħal Far store", handed_over: 1, damaged: 1, return_arranged: 1, supplier_refused: 0 });
    t.same("change", t.row(T, a), t.row(T, b));
    t.ok(A(ca) === A(audit(t, T, b, au)) && ca.length === 1, "change: the same audit entry: " + A(ca).slice(0, 200));
    await p.waitForFunction((id) => !document.querySelector("#rtn-edit") && document.activeElement && document.activeElement.getAttribute("data-id") === String(id), b, { timeout: 4000 })
      .then(() => t.ok(1), () => t.fail("change(new): after saving, the panel does not close back onto the item"));
    t.ok(/Saved · Twin Return/.test(await p.evaluate(() => document.body.innerText)), "change(new): a quiet Saved");

    // 2. An empty item: nothing is sent, it says what to do, focus on the field.
    await p.click(`[data-act=open][data-id="${b}"]`); await p.waitForSelector("#rtn-edit");
    await p.fill("#rtn-edit [name=description]", ""); const before = JSON.stringify(t.row(T, b));
    await p.click("#rtn-edit button[type=submit]"); await p.waitForSelector("#rtn-edit-err");
    t.ok(/Write the item going back/.test(await p.textContent("#rtn-edit-err")) && await p.evaluate(() => document.activeElement && document.activeElement.name) === "description" && JSON.stringify(t.row(T, b)) === before, "change(new): an empty item is refused before sending");
    await p.keyboard.press("Escape"); await p.waitForTimeout(120);
    t.ok(await p.evaluate((id) => !document.querySelector("#rtn-edit") && document.activeElement && document.activeElement.getAttribute("data-id") === String(id), b), "change(new): Escape closes it, focus back on the item");

    // 3. Supplier refused: the classic Mark as Refused against the new Supplier refused… → Mark refused.
    [a, b] = await twins("Twin Return Refused Ventolin");
    au = t.maxId("audit_log");
    await classicPick("Twin Return Refused Ventolin", a);
    await p.click("#re-refuse-btn");
    const cr = await t.write(p, new RegExp("^/returns/entries/" + a + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    const cra = audit(t, T, a, au); au = t.maxId("audit_log");
    await openNew(b);
    await p.click("#rtn-edit [data-act=refuse]");
    t.ok(/refused Twin Return Refused Ventolin\? This closes the return/.test(await p.textContent("#rtn-edit")), "refuse(new): one plain question");
    t.ok(t.row(T, b).supplier_refused === 0, "refuse(new): nothing is saved before the answer");
    const nr = await t.write(p, new RegExp("^/returns/entries/" + b + "$"), () => p.click("#rtn-edit [data-act=refuse-go]"), "PUT");
    t.ok(JSON.stringify(nr.body) === JSON.stringify(cr.body), "refuse: the classic body:\n classic " + JSON.stringify(cr.body) + "\n new     " + JSON.stringify(nr.body));
    t.has("refuse(new)", t.row(T, b), { supplier_refused: 1 });
    t.same("refuse", t.row(T, a), t.row(T, b));
    t.ok(A(cra) === A(audit(t, T, b, au)), "refuse: the same audit entry");
    await p.waitForSelector(`[data-act=open][data-id="${b}"]`);
    t.ok(await p.evaluate((id) => { const r = document.querySelector(`[data-act=open][data-id="${id}"]`).closest(".rtn-row"); return /Supplier refused/.test(r.textContent) && !r.querySelector("[data-act=step]"); }, b), "refuse(new): the row shows Supplier refused and no next step");

    // 4. Delete.
    [a, b] = await twins("Twin Return Delete Augmentin");
    await twinDelete(t, p, {
      label: "return delete", table: T, entity: T, action: "RETURNS_DELETE", a, b, path: (id) => new RegExp("^/returns/entries/" + id + "$"),
      classic: async (p, id) => { await classicPick("Twin Return Delete Augmentin", id); await p.click("#re-delete"); await p.click("#eikon-modal-actions .eikon-btn.primary"); },
      fresh: async (p, id) => {
        await openNew(id); await p.click("#rtn-edit [data-act=del]");
        t.ok((await p.textContent("#rtn-edit")).includes("Delete the return of Twin Return Delete Augmentin? This cannot be undone."), "return delete: the question names the item");
        await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "ask-cancel", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("return delete: the question opens on Keep it"));
        await p.click("#rtn-edit [data-act=del-go]");
      },
    });
    await p.waitForFunction(() => { const x = document.activeElement; return x && x.closest && x.closest(".rtn") && x !== document.body; }, null, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("return delete: focus is lost after the delete"));
    t.ok(!(await p.evaluate(() => !!document.querySelector(".rtn [data-act=classic]"))), "returns: the screen no longer sends anything to the classic screen");

    // 5. Staff: Change, Supplier refused… and Delete…, as classic shows them to every user.
    const s = await staffPage(t);
    if (s) {
      const [id] = await twins("Staff View Return");
      await t.open(s, "2", "retreg", "retreg", `[data-act=open][data-id="${id}"]`); await s.click(`[data-act=open][data-id="${id}"]`); await s.waitForSelector("#rtn-edit");
      t.ok(await s.locator("#rtn-edit [data-act=refuse]").count() === 1 && await s.locator("#rtn-edit [data-act=del]").count() === 1, "staff: Supplier refused… and Delete…, as classic");
    }
  },
};
