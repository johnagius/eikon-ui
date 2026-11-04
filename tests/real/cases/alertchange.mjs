// Alerts (alertreg, BACKLOG5 item 10b) vs the classic Edit Alert: the same change to two identical alerts leaves
// identical rows, column by column, and identical audit rows (the server replaces the whole record on every change).
// Then closing: the new screen's Close alert against the classic Edit with Status set to Closed.
import { ymd } from "../lib.mjs";
const T = "alerts_entries";
const seed = (over = {}) => Object.assign({ entry_date: ymd(-3), alert_type: "recall", status: "open", item_name: "Losartan Ħ 50mg", batch: "L9", expiry: ymd(200), quantity: "6", reason: "Manufacturer recall",
  storage_location: "room", supplier: "Actavis", notes: "Shelf C", team_informed: 1, supplier_informed: 0, authorities_informed: 0, return_arranged: 1, handed_over: 0, collection_note_received: 0, credit_note_received: 0 }, over);
// the audit row of one update, its own ids and clock stamps left out (at any depth)
const audit = (t, since, id) => { const r = t.db.prepare("SELECT org_id, user_id, action, entity_type, location_id, details_json FROM audit_log WHERE id > ? AND entity_type = 'alerts_entries' AND entity_id = ? ORDER BY id").all(since, String(id)); return r.map((x) => t.jsonCol(x, "details_json", ["id", "created_at", "updated_at"])); };
export default {
  title: "Alerts: change, close",
  async run(t) {
    const two = async (over) => { const m = t.maxId(T); await t.api("POST", "/alerts/entries", seed(over)); await t.api("POST", "/alerts/entries", seed(over)); const r = t.since(T, m, { item_name: seed(over).item_name }); return [r[0].id, r[1].id]; };
    const p = await t.page();
    const classicEdit = async (id, edit) => {
      await p.goto("about:blank"); await t.open(p, "classic", "alerts", "alerts", "#al-add");
      await p.click(`tr[data-id='${id}'] button:has-text("Edit")`); await p.waitForSelector("#al-item:visible");
      await edit();
      const a0 = t.maxId("audit_log");
      await t.write(p, new RegExp("/alerts/entries/" + id + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
      return a0;
    };
    const openNew = async (id) => { await p.goto("about:blank"); await t.open(p, "2", "alerts", "alertreg", `[data-act=edit][data-id="${id}"]`); };

    // 1. The same change (status, quantity, supplier, notes, expiry) in both screens.
    let [a, b] = await two();
    const ca0 = await classicEdit(a, async () => {
      await p.selectOption("#al-status", "in_progress"); await p.fill("#al-qty", "4"); await p.fill("#al-supplier", "Actavis Ltd"); await p.fill("#al-notes", "Moved to the fridge, Żebbuġ"); await p.fill("#al-expiry", ymd(150));
    });
    await openNew(b);
    await p.click(`[data-act=edit][data-id="${b}"]`); await p.waitForSelector("#alr-edit"); await t.idle(p);
    t.ok(await p.evaluate(() => document.activeElement && document.activeElement.name) === "item_name", "change(new): the form opens on the item");
    await p.selectOption("#alr-edit [name=status]", "in_progress");
    await t.fill(p, "#alr-edit", { quantity: "4", supplier: "Actavis Ltd", notes: "Moved to the fridge, Żebbuġ", expiry: ymd(150) });
    const na0 = t.maxId("audit_log");
    const w = await t.write(p, new RegExp("/alerts/entries/" + b + "$"), () => p.click("#alr-edit button[type=submit]"), "PUT");
    t.ok(JSON.stringify(Object.keys(w.body || {})) === JSON.stringify(["entry_date", "alert_type", "status", "item_name", "batch", "expiry", "quantity", "reason", "storage_location", "supplier", "notes", "team_informed", "supplier_informed", "authorities_informed", "return_arranged", "handed_over", "collection_note_received", "credit_note_received"]), "change(new): the body has the classic fields, in its order: " + JSON.stringify(w.body));
    const ra = t.row(T, a), rb = t.row(T, b);
    t.has("change(new)", rb, { status: "in_progress", quantity: "4", supplier: "Actavis Ltd", notes: "Moved to the fridge, Żebbuġ", expiry: ymd(150), batch: "L9", reason: "Manufacturer recall", team_informed: 1, return_arranged: 1, supplier_informed: 0 });
    t.same("change", ra, rb);
    const aa = audit(t, ca0, a), ab = audit(t, na0, b);
    t.ok(aa.length === 1 && ab.length === 1 && aa[0].action === "ALERT_UPDATE", "change: one ALERT_UPDATE audit row each: " + aa.length + "/" + ab.length);
    t.ok(JSON.stringify(aa) === JSON.stringify(ab), "change: the audit rows are the same (before and after): " + JSON.stringify(aa).slice(0, 200) + " vs " + JSON.stringify(ab).slice(0, 200));
    await p.waitForSelector(`[data-act=edit][data-id="${b}"]`);
    t.ok(await p.evaluate(() => /Saved/.test(document.body.innerText) && !document.querySelector("#alr-edit")), "change(new): the form closes and says Saved");

    // 2. A missing item: nothing is sent, the field is marked and the message says what to do.
    await p.click(`[data-act=edit][data-id="${b}"]`); await p.waitForSelector("#alr-edit");
    await p.fill("#alr-edit [name=item_name]", ""); const before = JSON.stringify(t.row(T, b));
    await p.click("#alr-edit button[type=submit]"); await p.waitForTimeout(250);
    const err = await p.evaluate(() => ({ msg: (document.querySelector("#alr-edit-err") || {}).textContent || "", inv: [...document.querySelectorAll("#alr-edit [aria-invalid=true]")].map((e) => e.name).join(), focus: document.activeElement && document.activeElement.name }));
    t.ok(err.msg === "Write the item. Nothing was saved." && err.inv === "item_name" && err.focus === "item_name" && JSON.stringify(t.row(T, b)) === before, "change(new): an empty item is refused before sending: " + JSON.stringify(err));
    await p.keyboard.press("Escape"); await p.waitForTimeout(100);
    t.ok(await p.evaluate((id) => !document.querySelector("#alr-edit") && document.activeElement && document.activeElement.getAttribute("data-act") === "edit" && document.activeElement.getAttribute("data-id") === String(id), b), "change(new): Escape closes it and focus returns to Change");

    // 3. Closing: the new Close alert against the classic Edit with Status Closed.
    [a, b] = await two({ item_name: "Ventolin Ċ inhaler", status: "in_progress", handed_over: 1 });
    const cc0 = await classicEdit(a, async () => { await p.selectOption("#al-status", "closed"); });
    await openNew(b);
    const nc0 = t.maxId("audit_log");
    await t.write(p, new RegExp("/alerts/entries/" + b + "$"), () => p.click(`[data-act=close][data-id="${b}"]`), "PUT"); // the confirmation is accepted
    const rc = t.row(T, a), rn = t.row(T, b);
    t.has("close(new)", rn, { status: "closed", handed_over: 1, notes: "Shelf C" });
    t.same("close", rc, rn);
    t.ok(JSON.stringify(audit(t, cc0, a)) === JSON.stringify(audit(t, nc0, b)), "close: the audit rows are the same");
  },
};
