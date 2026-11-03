// Emergency POS (eposreg) vs classic Emergency POS: the same basket (Panadol + Plasters, card) sold on both.
// The catalogue goes in through the classic import endpoint (from agents/epos/epos-real.mjs).
const PRODUCTS = [
  { barcode: "5012345678900", name: "Panadol 500mg x24", price: 3.49, vat_rate: 0, category: "Pain", unit: "" },
  { barcode: "4000000000001", name: "Plasters x20", price: 1.85, vat_rate: 18, category: "First aid", unit: "" },
  { barcode: "5011111111111", name: "Vitamin C 1000mg x30", price: 7.4, vat_rate: 18, category: "Vitamins", unit: "" }];
export default {
  title: "Emergency POS",
  async run(t) {
    const T = "pos_sales";
    const imp = await t.api("POST", "/emergency-pos/catalog", { products: PRODUCTS, wipe: true, file_name: "test.xlsx", total_rows: PRODUCTS.length, chunk_index: 1 });
    t.ok(imp && imp.ok, "catalogue imported through the classic import endpoint");
    const p = await t.page();
    await t.open(p, "classic", "emergency-pos", "emergency-pos", "#epos-search-input");
    let m = t.maxId(T);
    for (const name of ["Panadol", "Plasters"]) {
      await p.fill("#epos-search-input", name); await p.waitForTimeout(250);
      await p.click(`.epos-product-card:has-text("${name}")`); await p.waitForTimeout(150);
    }
    await p.click(".epos-pay-btn[data-pay=card]");
    await p.click("#epos-complete-btn"); await p.waitForSelector("#eikon-modal-actions button:has-text('Confirm Sale')");
    await t.write(p, /\/emergency-pos\/sales(\/sync)?$/, () => p.click("#eikon-modal-actions button:has-text('Confirm Sale')"));
    for (let i = 0; i < 30 && !t.since(T, m).length; i++) await p.waitForTimeout(100);
    const classic = t.since(T, m)[0];
    await t.open(p, "2", "emergency-pos", "eposreg", "#epr-q");
    m = t.maxId(T);
    for (const name of ["panadol", "plasters"]) { await p.fill("#epr-q", name); await p.waitForTimeout(200); await p.press("#epr-q", "Enter"); await p.waitForTimeout(150); }
    await p.click("[data-act=method][data-m=card]");
    await t.write(p, /\/emergency-pos\/sales(\/sync)?$/, () => p.click("[data-k=take]"));
    for (let i = 0; i < 30 && !t.since(T, m).length; i++) await p.waitForTimeout(100);
    const fresh = t.since(T, m)[0];
    t.has("epos(new)", fresh, { payment_method: "card", total: 5.34, voided: 0 });
    const I = (r) => t.jsonCol(r, "items_json");
    t.same("epos", I(classic), I(fresh), { receipt_no: "R-<date and time of the sale>", offline_id: "each sale's own retry key" });
  },
};
