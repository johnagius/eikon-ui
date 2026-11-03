// Vaccines (vaxreg) vs classic Vaccines. The classic order form is a selection table with a print step, so its body
// is sent through the API exactly as modules.vaccines.js builds it (renderOtherTab: section "other", no country,
// client_first/last, phone, email, items [{ name, qty }]); the new screen is driven through the UI.
const IN = { first: "Joseph", last: "Grech", phone: "79000111", email: "jg@example.com", items: [["Havrix 1440", 2], ["Boostrix", 1]] };
export default {
  title: "Vaccines",
  async run(t) {
    const O = "vaccines_orders", I = "vaccines_order_items";
    let mo = t.maxId(O), mi = t.maxId(I);
    const r = await t.api("POST", "/vaccines/orders", { section: "other", country_code: "", country_name: "", client_first: IN.first, client_last: IN.last, phone: IN.phone, email: IN.email, items: IN.items.map(([name, qty]) => ({ name, qty })) });
    t.ok(r && r.ok, "classic body accepted: " + JSON.stringify(r).slice(0, 120));
    const classic = t.since(O, mo)[0], classicItems = t.since(I, mi);
    const p = await t.page();
    await t.open(p, "2", "vaccines", "vaxreg", "[data-act=add]");
    mo = t.maxId(O); mi = t.maxId(I);
    await p.click("[data-act=add]"); await p.waitForSelector("#vxr-add");
    await p.click("[data-act=sec][data-sec=other]"); await p.waitForTimeout(150);
    await t.fill(p, "#vxr-add", { '#vxr-add [data-i="0"][data-k=name]': IN.items[0][0], '#vxr-add [data-i="0"][data-k=qty]': String(IN.items[0][1]) });
    await p.click("#vxr-add [data-act=line]");
    await t.fill(p, "#vxr-add", { '#vxr-add [data-i="1"][data-k=name]': IN.items[1][0], '#vxr-add [data-i="1"][data-k=qty]': String(IN.items[1][1]), client_first: IN.first, client_last: IN.last, phone: IN.phone, email: IN.email });
    await t.write(p, /\/vaccines\/orders$/, () => p.click("#vxr-add button[type=submit]"));
    const fresh = t.since(O, mo)[0], freshItems = t.since(I, mi);
    t.has("vaccines(new)", fresh, { section: "other", country_code: "", client_first: IN.first, client_last: IN.last, phone: IN.phone, email: IN.email });
    t.same("vaccines order", classic, fresh);
    t.ok(freshItems.length === 2 && classicItems.length === 2, `two item rows each (classic ${classicItems.length}, new ${freshItems.length})`);
    for (let i = 0; i < Math.min(2, freshItems.length); i++) t.same("vaccines item " + (i + 1), classicItems[i], freshItems[i], { order_id: "the row's own order" });
  },
};
