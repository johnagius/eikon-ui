// Alerts (alertreg, Stock flows round 2): delete closed out of the classic screen. Twin alerts, one deleted with the
// classic Delete → Delete, one with the new card's Delete… → Delete alert: the same DELETE, the same answer, both rows
// gone and the same ALERT_DELETE audit entry. Keep it changes nothing; Undo puts back the same row; staff see Delete… as in classic; focus stays on the list.
import { ymd } from "../lib.mjs";
import { twinDelete, staffPage } from "./_sfdel.mjs";
const T = "alerts_entries";
const seed = { entry_date: ymd(-1), alert_type: "recall", status: "open", item_name: "Ħ Twin Delete Losartan 50mg", batch: "TD1", expiry: ymd(90), quantity: "3", reason: "Recall", storage_location: "room", supplier: "Actavis", notes: "",
  team_informed: 1, supplier_informed: 0, authorities_informed: 0, return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0 };
export default {
  title: "Alerts: delete in the new layout, as classic",
  async run(t) {
    const m = t.maxId(T); await t.api("POST", "/alerts/entries", seed); await t.api("POST", "/alerts/entries", seed);
    const [a, b] = t.since(T, m, { item_name: seed.item_name }).map((r) => r.id);
    const p = await t.page();
    let before = null;
    await twinDelete(t, p, {
      label: "alert", table: T, entity: T, action: "ALERT_DELETE", a, b, path: (id) => new RegExp("^/alerts/entries/" + id + "$"),
      classic: async (p, id) => {
        await t.open(p, "classic", "alerts", "alerts", `tr[data-id='${id}']`);
        await p.click(`tr[data-id='${id}'] button:has-text("Delete")`); await p.click("#eikon-modal-actions .eikon-btn.primary");
      },
      fresh: async (p, id) => {
        before = t.row(T, id);
        await t.open(p, "2", "alertreg", "alertreg", `[data-act=del][data-id="${id}"]`);
        await p.click(`[data-act=del][data-id="${id}"]`);
        t.ok((await p.textContent(".alr")).includes(`Delete the alert for ${seed.item_name}?`), "alert: the question is in plain words, with the item");
        await p.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute("data-act") === "del-cancel" && document.activeElement.getAttribute("data-id") === String(id), id, { timeout: 2000 }).catch(() => {});
        t.ok(await p.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act")) === "del-cancel", "alert: the question opens on Keep it");
        await p.click(`[data-act=del-cancel][data-id="${id}"]`); await p.waitForTimeout(100);
        t.ok(t.row(T, id) && await p.evaluate((id) => document.activeElement && document.activeElement.getAttribute("data-act") === "del" && document.activeElement.getAttribute("data-id") === String(id), id), "alert: Keep it deletes nothing and goes back to Delete…");
        await p.click(`[data-act=del][data-id="${id}"]`); await p.click(`[data-act=del-go][data-id="${id}"]`);
      },
    });
    await p.waitForFunction(() => { const x = document.activeElement; return x && x.closest && x.closest(".alr") && /^(edit|add|undo)$/.test(x.getAttribute("data-act") || ""); }, null, { timeout: 4000 })
      .then(() => t.ok(1), () => t.fail("alert: focus is not back on the list after the delete"));
    t.ok(/Deleted the alert for/.test(await p.textContent(".alr-undo")), "alert: a quiet Deleted line with Undo");
    // Undo: the classic New body with every field as it was; the row comes back equal but for its id and clock stamps.
    const orig = before;
    const m2 = t.maxId(T);
    const uw = await t.write(p, /^\/alerts\/entries$/, () => p.click(".alr-undo [data-act=undo]"));
    const back = t.since(T, m2, { item_name: seed.item_name });
    t.ok(JSON.stringify(Object.keys(uw.body || {})) === JSON.stringify(["entry_date", "alert_type", "status", "item_name", "batch", "expiry", "quantity", "reason", "storage_location", "supplier", "notes", "team_informed", "supplier_informed", "authorities_informed", "return_arranged", "handed_over", "collection_note_received", "credit_note_received"]), "undo: every field, in the classic order: " + JSON.stringify(uw.body));
    if (t.ok(back.length === 1, "undo: one alert put back (" + back.length + ")")) {
      const strip2 = (r) => { const o = { ...r }; for (const k of ["id", "created_at", "updated_at"]) delete o[k]; return o; };
      t.ok(JSON.stringify(strip2(back[0])) === JSON.stringify(strip2(orig)), "undo: the restored row equals the deleted one but for id and clock:\n was  " + JSON.stringify(strip2(orig)) + "\n back " + JSON.stringify(strip2(back[0])));
      await p.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute("data-id") === String(id), back[0].id, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("undo: focus is not on the alert put back"));
      t.ok(!(await p.locator(".alr-undo").count()), "undo: the Undo line goes");
    }
    t.ok(!(await p.evaluate(() => !!document.querySelector(".alr [data-act=classic]"))), "alert: the screen no longer sends deleting to the classic screen");

    const s = await staffPage(t);
    if (s) {
      const id = (await t.api("POST", "/alerts/entries", Object.assign({}, seed, { item_name: "Staff View Alert" }))).id;
      await t.open(s, "2", "alertreg", "alertreg", `[data-act=edit][data-id="${id}"]`);
      t.ok(await s.locator(`[data-act=edit][data-id="${id}"]`).count() === 1 && await s.locator(`[data-act=del][data-id="${id}"]`).count() === 1, "staff: Change and Delete…, as classic shows Delete to every user");
    }
  },
};
