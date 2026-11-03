// Stock screens on the real worker: near expiry (a shelf check adds two items in a row, then one goes back to the
// supplier), alerts (record a quarantine, tick a step), order diary (add an item) and transfers (offer stock). Each
// stored row is read back and checked column by column against what was typed; the bodies are the same as before the
// stock-group pass (2026-11), which only changed how the screens are used, never what they send.
import { ymd } from "../lib.mjs";
export default {
  title: "Stock screens (new layout)",
  async run(t) {
    const p = await t.page();
    // Near expiry: Add, then Add another with Where kept from the first.
    await t.open(p, "2", "nexreg", "nexreg", "[data-act=add]");
    let m = t.maxId("near_expiry_entries");
    await p.click("[data-act=add]"); await p.waitForSelector("#nex-add");
    await t.fill(p, "#nex-add", { product_name: "Ċiprofloxacin 500mg", expiry_date: ymd(10), location: "Shelf Ħ2", notes: "3 boxes" });
    await t.write(p, /\/near-expiry\/entries$/, () => p.click("#nex-add button[type=submit]"));
    await p.waitForFunction(() => { const f = document.querySelector("#nex-add [name=product_name]"); return f && !f.value && document.activeElement === f; });
    t.ok(await p.inputValue("#nex-add [name=location]") === "Shelf Ħ2", "near expiry: Where is kept for the next item");
    await t.fill(p, "#nex-add", { product_name: "Żinc oxide cream", expiry_date: ymd(40) });
    await t.write(p, /\/near-expiry\/entries$/, () => p.press("#nex-add [name=expiry_date]", "Enter"));
    const ne = t.since("near_expiry_entries", m);
    t.ok(ne.length === 2, "near expiry: two rows stored, one per item: " + ne.length);
    t.has("near_expiry(1)", ne[0], { product_name: "Ċiprofloxacin 500mg", expiry_date: ymd(10), location: "Shelf Ħ2", notes: "3 boxes" });
    t.has("near_expiry(2)", ne[1], { product_name: "Żinc oxide cream", expiry_date: ymd(40), location: "Shelf Ħ2", notes: "" });
    await p.focus("#nex-add [name=product_name]"); await p.keyboard.press("Escape"); await p.waitForSelector("#nex-add", { state: "detached" });
    // Send the first one back.
    const mr = t.maxId("returns_entries");
    await p.click(`[data-act=ret][data-id="${ne[0].id}"]`); await p.waitForSelector("#nex-ret");
    await t.fill(p, "#nex-ret", { supplier: "Ħili Pharma", quantity: "3" });
    await t.write(p, /create-return$/, () => p.click("#nex-ret button[type=submit]"));
    const rt = t.since("returns_entries", mr)[0];
    t.has("returns(from near expiry)", rt, { description: "Ċiprofloxacin 500mg", supplier: "Ħili Pharma", quantity: "3", expiry: ymd(10) });

    // Alerts: record a quarantine, then tick "Supplier told"; every other field stays as it was.
    await t.open(p, "2", "alertreg", "alertreg", "[data-act=add]");
    m = t.maxId("alerts_entries");
    await p.click("[data-act=add]"); await p.waitForSelector("#alr-add");
    await p.selectOption("#alr-add [name=alert_type]", "quarantine"); await p.selectOption("#alr-add [name=storage_location]", "fridge");
    await t.fill(p, "#alr-add", { item_name: "Valsartan 80mg", batch: "VX1", expiry: ymd(300), quantity: "4", reason: "Recall notice", supplier: "Żebbuġ Ltd" });
    await t.write(p, /\/alerts\/entries$/, () => p.click("#alr-add button[type=submit]"));
    const al = t.since("alerts_entries", m)[0];
    t.has("alert", al, { entry_date: ymd(0), alert_type: "quarantine", status: "open", item_name: "Valsartan 80mg", batch: "VX1", expiry: ymd(300), quantity: "4", reason: "Recall notice", storage_location: "fridge", supplier: "Żebbuġ Ltd", supplier_informed: 0 });
    await t.write(p, new RegExp("/alerts/entries/" + al.id + "$"), () => p.click(`[data-act=tick][data-id="${al.id}"][data-k=supplier_informed]`), "PUT");
    const al2 = t.row("alerts_entries", al.id);
    t.has("alert(ticked)", al2, { supplier_informed: 1, team_informed: 0, item_name: "Valsartan 80mg", batch: "VX1", reason: "Recall notice", storage_location: "fridge", supplier: "Żebbuġ Ltd", status: "open" });

    // Order diary: add an item (a supplier offered from the ones used).
    await t.open(p, "2", "odreg", "odreg", "[data-act=add]");
    m = t.maxId("order_diary_entries");
    await p.click("[data-act=add]"); await p.waitForSelector("#odr-add");
    t.ok(await p.getAttribute("#odr-add [name=supplier]", "list") === "odr-sups", "order diary: Supplier offers the suppliers used");
    await t.fill(p, "#odr-add", { item_name: "Augmentin 625 x14", qty: "2", supplier: "GSK", notes: "for Mrs Borg" });
    await t.write(p, /\/order-diary\/entries$/, () => p.click("#odr-add button[type=submit]"));
    t.has("order diary", t.since("order_diary_entries", m)[0], { order_date: ymd(0), item_name: "Augmentin 625 x14", qty: 2, supplier: "GSK", notes: "for Mrs Borg", status: "pending" });

    // Transfers: offer stock to the group.
    await t.open(p, "2", "trfreg", "trfreg", "[data-act=offer]");
    m = t.maxId("stock_transfer_items");
    await p.click("[data-act=offer]"); await p.waitForSelector("#trf-offer");
    t.ok(await p.waitForFunction((v) => document.activeElement && document.activeElement.name === v, "item_description", { timeout: 3000 }).then(() => true, () => false), "transfers: the offer form opens on Item");
    await t.fill(p, "#trf-offer", { item_description: "Ozempic 1mg pen", quantity_available: "3", batch: "OZ", expiry_date: ymd(60) });
    await t.write(p, /\/stock-transfers\/items$/, () => p.click("#trf-offer button[type=submit]"));
    t.has("transfer offer", t.since("stock_transfer_items", m)[0], { entry_date: ymd(0), item_description: "Ozempic 1mg pen", quantity_available: 3, batch: "OZ", expiry_date: ymd(60) });
  },
};
