// Stock, classic-only actions brought into the new layout (b4-6a): order diary change and delete, a new return, price
// check change and delete. The same action from the classic screen and from the new one, on twin rows, leaves the same
// row column by column and the same audit entry (its before/after with ids and clock stamps set aside).
import { ymd } from "../lib.mjs";
const STAMP = ["id", "created_at", "updated_at", "entity_id"];
const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !STAMP.includes(k)).map((k) => [k, strip(v[k])])) : v;
export default {
  title: "Stock: change and delete in the new layout (order diary, returns, price check)",
  async run(t) {
    const audit = (type, id, since) => t.db.prepare("SELECT * FROM audit_log WHERE id > ? AND entity_type = ? AND entity_id = ? ORDER BY id").all(since, type, String(id));
    const sameAudit = (label, a, b) => {
      if (!t.ok(a.length === 1 && b.length === 1, `${label}: one audit entry each (classic ${a.length}, new ${b.length})`)) return;
      const n = (r) => JSON.stringify({ action: r.action, entity_type: r.entity_type, user_id: r.user_id, location_id: r.location_id, org_id: r.org_id, details: strip(JSON.parse(r.details_json || "null")) });
      t.ok(n(a[0]) === n(b[0]), `${label}: audit entries differ:\n classic ${n(a[0]).slice(0, 400)}\n new     ${n(b[0]).slice(0, 400)}`);
    };
    const p = await t.page();

    // ── Order diary: change an item ──
    const OD = "order_diary_entries", od = { order_date: ymd(0), item_name: "Augmentin 625 x14", qty: 2, supplier: "Actavis", notes: "For Mrs Borġ" };
    const twinOd = async () => { const m = t.maxId(OD); await t.api("POST", "/order-diary/entries", od); await t.api("POST", "/order-diary/entries", od); return t.since(OD, m).map((r) => r.id); };
    let [a, b] = await twinOd(), au = t.maxId("audit_log");
    const ED = { name: "Augmentin 1g x14", qty: "3", sup: "Ħili Pharma", notes: "For Ġorġ Żammit" };
    await t.open(p, "classic", "order-diary", "order-diary", `[data-eid='${a}']`);
    await p.click(`[data-eid='${a}']`); await p.waitForSelector("#od-e-name");
    await p.fill("#od-e-name", ED.name); await p.fill("#od-e-qty", ED.qty); await p.fill("#od-e-sup", ED.sup); await p.fill("#od-e-notes", ED.notes);
    const co = await t.write(p, new RegExp("/order-diary/entries/" + a + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    await t.open(p, "2", "odreg", "odreg", `[data-act=open][data-id="${b}"]`);
    await p.click(`[data-act=open][data-id="${b}"]`); await p.waitForSelector("#odr-edit");
    t.ok(await p.waitForFunction(() => document.activeElement && document.activeElement.name === "item_name", null, { timeout: 3000 }).then(() => true, () => false), "order diary: the item opens on Item");
    await t.fill(p, "#odr-edit", { item_name: ED.name, qty: ED.qty, supplier: ED.sup, notes: ED.notes });
    const w = await t.write(p, new RegExp("/order-diary/entries/" + b + "$"), () => p.click("#odr-edit button[type=submit]"), "PUT");
    t.ok(JSON.stringify(w.body) === JSON.stringify(co.body), "order diary: the classic Edit Item body: classic " + JSON.stringify(co.body) + " new " + JSON.stringify(w.body));
    t.has("od change(new)", t.row(OD, b), { item_name: ED.name, qty: 3, supplier: ED.sup, notes: ED.notes, status: "pending" });
    t.same("od change", t.row(OD, a), t.row(OD, b));
    sameAudit("od change audit", audit(OD, a, au), audit(OD, b, au));
    await p.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute("data-id") === String(id), b, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("order diary: after saving, focus is not back on the item"));

    // ── Order diary: delete (pharmacist), one plain question ──
    [a, b] = await twinOd(); au = t.maxId("audit_log");
    await t.open(p, "classic", "order-diary", "order-diary", `[data-did='${a}']`);
    await p.click(`[data-did='${a}']`);
    await t.write(p, new RegExp("/order-diary/entries/" + a + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "DELETE");
    await t.open(p, "2", "odreg", "odreg", `[data-act=open][data-id="${b}"]`);
    await p.click(`[data-act=open][data-id="${b}"]`); await p.click("#odr-edit [data-act=del]");
    t.ok(/Delete this item from the order diary\? This cannot be undone\./.test(await p.textContent("#odr-edit")), "order diary: the question is in plain words");
    t.ok(t.row(OD, b), "order diary: nothing is deleted before the answer");
    await t.write(p, new RegExp("/order-diary/entries/" + b + "$"), () => p.click("#odr-edit [data-act=del-go]"), "DELETE");
    t.ok(!t.row(OD, a) && !t.row(OD, b), "order diary: both rows gone (the server's delete, as classic)");
    sameAudit("od delete audit", audit(OD, a, au), audit(OD, b, au));
    await p.waitForFunction(() => { const a = document.activeElement; return a && a.closest && a.closest(".odr") && a !== document.body; }, null, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("order diary: focus is lost after the delete"));

    // ── Returns: a new return ──
    const RT = "returns_entries", RIN = { desc: "Ċiprofloxacin 500mg x10", qty: "3", sup: "Ħili Pharma", why: "Expiring soon", exp: ymd(20), batch: "B-ĠĦ1", inv: "INV-77", kept: "Back room" };
    let m = t.maxId(RT); au = t.maxId("audit_log");
    await t.open(p, "classic", "returns", "returns", "#re-new");
    await p.click("#re-new");
    await p.fill("#re-desc", RIN.desc); await p.fill("#re-qty", RIN.qty); await p.fill("#re-supplier", RIN.sup); await p.fill("#re-remarks", RIN.why); await p.fill("#re-expiry", RIN.exp);
    await p.fill("#re-batch", RIN.batch); await p.fill("#re-invoice", RIN.inv); await p.fill("#re-location", RIN.kept);
    const crw = await t.write(p, /\/returns\/entries$/, () => p.click("#re-save"));
    const mine = (r) => r.description === RIN.desc; // other cases add returns too: never take “the newest row” blindly
    const rc = t.since(RT, m).find(mine); m = t.maxId(RT);
    await t.open(p, "2", "retreg", "retreg", "[data-act=add]");
    await p.locator("[data-act=add]").first().click(); await p.waitForSelector("#rtn-add");
    t.ok(await p.inputValue("#rtn-add [name=entry_date]") === ymd(0), "returns: the date is today");
    await t.fill(p, "#rtn-add", { description: RIN.desc, quantity: RIN.qty, supplier: RIN.sup, remarks: RIN.why, expiry: RIN.exp, batch: RIN.batch, invoice_number: RIN.inv, location_stored: RIN.kept });
    const wr = await t.write(p, /\/returns\/entries$/, () => p.click("#rtn-add button[type=submit]"));
    const rn = t.since(RT, m).find(mine);
    t.has("return(new)", rn, { entry_date: ymd(0), description: RIN.desc, quantity: RIN.qty, supplier: RIN.sup, remarks: RIN.why, expiry: RIN.exp, batch: RIN.batch, invoice_number: RIN.inv, location_stored: RIN.kept, return_arranged: 0, handed_over: 0, collection_note_received: 0, credit_note_received: 0, damaged: 0 });
    t.same("return", rc, rn);
    sameAudit("return audit", audit(RT, rc && rc.id, au), audit(RT, rn && rn.id, au));
    t.ok(JSON.stringify(wr.body) === JSON.stringify(crw.body), "returns: the classic New + Save body:\n classic " + JSON.stringify(crw.body) + "\n new     " + JSON.stringify(wr.body));
    await p.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute("data-id") === String(id) && document.activeElement.getAttribute("data-k") === "return_arranged", rn && rn.id, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("returns: after saving, focus is not on Mark arranged"));
    // An item is needed; nothing is sent without one.
    await p.locator("[data-act=add]").first().click(); await p.waitForSelector("#rtn-add");
    m = t.maxId(RT); await p.click("#rtn-add button[type=submit]"); await p.waitForSelector("#rtn-err");
    t.ok(t.maxId(RT) === m && /Write the item/.test(await p.textContent("#rtn-err")), "returns: no item, nothing saved, and it says what to do");

    // ── Price check: change a quote (cost, discount €, VAT, free, retail, supplier) ──
    const QT = "quotation_entries", q0 = { quote_date: ymd(-3), item_description: "Panadol 500mg x24", supplier: "GSK", barcode: "5000158", stock_code: "PN24", vat_rate: 18, cost_excl_vat: 2.4, cost_incl_vat: 2.83, discount_euro: 0.2, discount_pct: 7.5, qty_purchased: 1, qty_free: 0, retail_price: 4.5, notes: "Phone order" };
    const twinQt = async (o = {}) => { const m = t.maxId(QT); await t.api("POST", "/quotations/entries", { ...q0, ...o }); await t.api("POST", "/quotations/entries", { ...q0, ...o }); return t.since(QT, m).map((r) => r.id); };
    const classicQt = async (id, edit) => {
      await t.open(p, "classic", "quotations", "quotations", `[data-edit='${id}']`);
      await p.click(`[data-edit='${id}']`); await p.waitForSelector("#qt-i-excl"); await p.waitForTimeout(80);
      await edit();
      return t.write(p, new RegExp("/quotations/entries/" + id + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    };
    const newQt = async (id, map, vat) => {
      await t.open(p, "2", "qtreg", "qtreg", `[data-act=open][data-id="${id}"]`);
      await p.click(`[data-act=open][data-id="${id}"]`); await p.waitForSelector("#qtr-edit");
      if (vat) await p.selectOption("#qtr-edit [name=vat_rate]", vat);
      await t.fill(p, "#qtr-edit", map);
      return t.write(p, new RegExp("/quotations/entries/" + id + "$"), () => p.click("#qtr-edit button[type=submit]"), "PUT");
    };
    [a, b] = await twinQt(); au = t.maxId("audit_log");
    const cq = await classicQt(a, async () => { await p.selectOption("#qt-i-vat", "5"); await p.fill("#qt-i-excl", "2.55"); await p.fill("#qt-i-deuro", "0.30"); await p.fill("#qt-i-free", "2"); await p.fill("#qt-i-retail", "4.80"); await p.fill("#qt-i-supplier", "Ħili Pharma"); });
    const wq = await newQt(b, { cost_excl_vat: "2.55", discount_euro: "0.30", qty_free: "2", retail_price: "4.80", supplier: "Ħili Pharma" }, "5");
    t.has("qt change(new)", t.row(QT, b), { supplier: "Ħili Pharma", vat_rate: 5, cost_excl_vat: 2.55, cost_incl_vat: 2.68, discount_euro: 0.3, qty_free: 2, retail_price: 4.8, stock_code: "PN24", notes: "Phone order", quote_date: ymd(-3) });
    t.same("qt change", t.row(QT, a), t.row(QT, b));
    sameAudit("qt change audit", audit(QT, a, au), audit(QT, b, au));
    t.ok(JSON.stringify(cq.body) === JSON.stringify(wq.body), "price check: the same body as the classic Edit Entry:\n classic " + JSON.stringify(cq.body) + "\n new     " + JSON.stringify(wq.body));
    // Only the retail price: the quote's own discount % is kept, as the classic form keeps it.
    [a, b] = await twinQt(); au = t.maxId("audit_log");
    const cq2 = await classicQt(a, async () => { await p.fill("#qt-i-retail", "5.10"); });
    const wq2 = await newQt(b, { retail_price: "5.10" });
    t.ok(JSON.stringify(cq2.body) === JSON.stringify(wq2.body), "price check (retail only): the same body as classic:\n classic " + JSON.stringify(cq2.body) + "\n new     " + JSON.stringify(wq2.body));
    t.has("qt retail(new)", t.row(QT, b), { retail_price: 5.1, discount_pct: 7.5, discount_euro: 0.2, cost_excl_vat: 2.4 });
    t.same("qt retail", t.row(QT, a), t.row(QT, b));
    sameAudit("qt retail audit", audit(QT, a, au), audit(QT, b, au));

    // ── Price check: delete (pharmacist) ──
    [a, b] = await twinQt({ item_description: "Ċetirizine 10mg x30" }); au = t.maxId("audit_log");
    await t.open(p, "classic", "quotations", "quotations", `[data-del='${a}']`);
    await p.click(`[data-del='${a}']`);
    await t.write(p, new RegExp("/quotations/entries/" + a + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "DELETE");
    await t.open(p, "2", "qtreg", "qtreg", `[data-act=open][data-id="${b}"]`);
    await p.click(`[data-act=open][data-id="${b}"]`); await p.click("#qtr-edit [data-act=del]");
    t.ok(/Delete the GSK quote for Ċetirizine 10mg x30\? This cannot be undone\./.test(await p.textContent("#qtr-edit")), "price check: the question is in plain words");
    await t.write(p, new RegExp("/quotations/entries/" + b + "$"), () => p.click("#qtr-edit [data-act=del-go]"), "DELETE");
    t.ok(!t.row(QT, a) && !t.row(QT, b), "price check: both quotes gone (the server's delete, as classic)");
    sameAudit("qt delete audit", audit(QT, a, au), audit(QT, b, au));
  },
};
