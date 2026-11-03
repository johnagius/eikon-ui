// Customers + New (new layout only; there is no classic screen): a person added through "+ New" stores what the
// same body sent straight to POST /people stores (the reference row is read, then removed from the local database,
// since one ID card is one person). Then an edit through the screen changes only what was edited.
const IN = { name: "Spiteri Karen", id_card: "0891234M", phone: "79888777", email: "karen@example.com", address: "7 Triq il-Ħażna, Qormi" };
export default {
  title: "Customers + New",
  async run(t) {
    const T = "people";
    // other cases add people at the same time (orders, registers): rows are found by this ID card only
    const mine = () => t.db.prepare(`SELECT * FROM ${T} WHERE id_card = ? ORDER BY id`).all(IN.id_card);
    const r = await t.api("POST", "/people", IN);
    t.ok(r && r.ok && r.created, "reference person accepted by POST /people");
    const ref = mine()[0];
    if (ref) t.db.prepare(`DELETE FROM ${T} WHERE id = ?`).run(ref.id);
    const p = await t.page();
    await t.open(p, "2", "customers", "customers", '[data-act="new"]');
    await p.locator('[data-act="new"]').first().click(); await p.waitForSelector("#cus-new");
    await t.fill(p, "#cus-new", IN);
    await t.write(p, /^\/people$/, () => p.click("#cus-new [data-act=create]"));
    const fresh = mine()[0];
    t.has("customer(new)", fresh, { ...IN, version: 1, merged_into: null });
    t.same("customer", ref, fresh);
    // edit: phone and notes only
    await p.waitForSelector('[data-act="edit"]'); await p.click('[data-act="edit"]'); await p.waitForSelector("#cus-edit");
    await t.fill(p, "#cus-edit", { phone: "79888000", notes: "Prefers SMS" });
    await t.write(p, /^\/people$/, () => p.click("#cus-edit [data-act=save]"));
    const after = t.row(T, fresh.id);
    const changed = Object.keys(after).filter((k) => JSON.stringify(after[k]) !== JSON.stringify(fresh[k]) && !["updated_at", "updated_by"].includes(k)).sort().join();
    t.ok(changed === "notes,phone,version" && after.version === 2 && after.phone === "79888000", "edit changed only phone, notes and the version: " + changed);
  },
};
