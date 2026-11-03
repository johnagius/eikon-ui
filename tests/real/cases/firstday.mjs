// A first day that never dead-ends (backlog 4 item 7): the three set-up jobs a new pharmacy used to be sent to the
// classic screens for, done in both layouts with the same input; every column of the stored rows must match.
//  - Fridges and rooms: add a fridge, then rename it with new limits (classic Devices tab vs tempreg's Fridges and rooms)
//  - Plan shifts: add a person to the rota (classic "Add Employee" vs shfreg's "Add a person to the rota")
//  - Emergency POS: import the product list (classic Catalog tab vs eposreg's "Import the product list")
// Each classic row is read, removed from the local database, and the same input given to the new layout.
const CSV = "Barcode,Description,Retail Price,VAT,Category,Unit\n5012345678900,First-day Paracetamol 500mg x24,2.35,0,Pain,pack\n,First-day cough syrup,4.10,18,Cough,bottle\n";
const file = { name: "first-day.csv", mimeType: "text/csv", buffer: Buffer.from(CSV) };
export default {
  title: "First day (devices, rota people, product import)",
  async run(t) {
    const p = await t.page();
    // ---- Fridges and rooms ----
    const D = "temperature_devices";
    // Only this pharmacy's rows: other cases running at the same time open pharmacies of their own (inspect), and a
    // new pharmacy is given its first fridge and room, which must not be taken for the row added here.
    const LOC = t.db.prepare("SELECT default_location_id AS l FROM users WHERE email = 'maria@demo.mt'").get().l;
    const sinceL = (tb, id) => t.since(tb, id).filter((r) => r.location_id === LOC);
    await t.open(p, "classic", "temperature", "temperature");
    await p.getByRole("button", { name: "Devices", exact: true }).click();
    await p.waitForSelector("input[placeholder^='Device name']");
    let m = t.maxId(D);
    await p.fill("input[placeholder^='Device name']", "Vaccine fridġ ħ");
    await p.locator(".eikon-card select.eikon-select").first().selectOption("fridge");
    await p.fill("input[placeholder='Min limit (optional)']", "2"); await p.fill("input[placeholder='Max limit (optional)']", "8");
    await t.write(p, /\/temperature\/devices$/, () => p.getByRole("button", { name: "Add device" }).click());
    for (let i = 0; i < 50 && !sinceL(D, m).length; i++) await p.waitForTimeout(100);
    const cAdd = sinceL(D, m)[0];
    await p.waitForTimeout(600);
    const idx = await p.evaluate(() => [...document.querySelectorAll("tbody tr")].findIndex((tr) => (tr.querySelector("input") || {}).value === "Vaccine fridġ ħ"));
    const row = p.locator("tbody tr").nth(idx);
    await row.locator("input").nth(0).fill("Vaccine fridġ ż"); await row.locator("input").nth(1).fill("2.5"); await row.locator("input").nth(2).fill("7.5");
    await t.write(p, /\/temperature\/devices\/\d+$/, () => row.getByRole("button", { name: "Save" }).click(), "PUT");
    const classicDev = cAdd && t.row(D, cAdd.id);
    t.ok(cAdd && cAdd.min_limit === 2 && cAdd.max_limit === 8, "classic: device added with 2 to 8");
    if (cAdd) t.db.prepare(`DELETE FROM ${D} WHERE id > ? AND location_id = ?`).run(m, LOC);
    m = t.maxId(D);
    await t.open(p, "2", "temperature", "tempreg", "[data-k=devices]");
    await p.click("[data-k=devices]"); await p.waitForSelector("#trg-add [name=name]");
    await p.fill("#trg-add [name=name]", "Vaccine fridġ ħ"); // a fridge is chosen, 2 to 8 filled in
    t.ok(await p.inputValue("#trg-add [name=min_limit]") === "2" && await p.inputValue("#trg-add [name=max_limit]") === "8", "new: a fridge starts at 2 to 8");
    await t.write(p, /\/temperature\/devices$/, () => p.click("[data-k=dv-add]"));
    for (let i = 0; i < 50 && !sinceL(D, m).length; i++) await p.waitForTimeout(100);
    const nAdd = sinceL(D, m)[0];
    t.same("device (add)", cAdd, nAdd);
    if (nAdd) {
      const f = `form.trg-dv[data-dv="${nAdd.id}"]`; await p.waitForSelector(f);
      await t.fill(p, "", { [f + " [name=name]"]: "Vaccine fridġ ż", [f + " [name=min_limit]"]: "2,5", [f + " [name=max_limit]"]: "7.5" });
      await t.write(p, /\/temperature\/devices\/\d+$/, () => p.click(`[data-k="dv-save:${nAdd.id}"]`), "PUT");
      t.same("device (rename and limits)", classicDev, t.row(D, nAdd.id));
      t.db.prepare(`DELETE FROM ${D} WHERE id = ?`).run(nAdd.id);
    }

    // ---- A person on the rota ----
    const ST = "shift_staff";
    await t.open(p, "classic", "shifts", "shifts");
    await p.getByRole("button", { name: /Staff/ }).first().click(); await p.waitForSelector("#sh-add-emp");
    m = t.maxId(ST);
    await p.click("#sh-add-emp"); await p.fill("#se-name", "Ġużeppa Żammit"); await p.selectOption("#se-desig", "dispenser");
    await t.write(p, /\/shifts\/staff$/, () => p.getByRole("button", { name: "Add Employee" }).last().click());
    for (let i = 0; i < 50 && !t.since(ST, m).length; i++) await p.waitForTimeout(100);
    const cSt = t.since(ST, m)[0];
    if (cSt) t.db.prepare(`DELETE FROM ${ST} WHERE id > ?`).run(m);
    m = t.maxId(ST);
    await t.open(p, "2", "shifts", "shfreg", "[data-k=who], #shf-who");
    if (await p.$("[data-k=who]")) await p.click("[data-k=who]");
    await p.fill("#shf-who [name=full_name]", "Ġużeppa Żammit"); await p.selectOption("#shf-who [name=designation]", "dispenser");
    await t.write(p, /\/shifts\/staff$/, () => p.click("#shf-who [data-k=who-add]"));
    for (let i = 0; i < 50 && !t.since(ST, m).length; i++) await p.waitForTimeout(100);
    t.same("rota person", cSt, t.since(ST, m)[0]);

    // ---- The product list ----
    const PP = "pos_products";
    await t.open(p, "classic", "emergency-pos", "emergency-pos");
    await p.getByRole("button", { name: "Catalog", exact: true }).click(); await p.waitForSelector("#epos-import-btn");
    const before = t.db.prepare(`SELECT COUNT(*) AS c FROM ${PP}`).get().c;
    let fc = p.waitForEvent("filechooser"); await p.click("#epos-import-btn"); await (await fc).setFiles(file);
    for (let i = 0; i < 80 && t.db.prepare(`SELECT COUNT(*) AS c FROM ${PP} WHERE name LIKE 'First-day%'`).get().c < 2; i++) await p.waitForTimeout(100);
    const cP = t.db.prepare(`SELECT * FROM ${PP} WHERE name LIKE 'First-day%' ORDER BY name`).all();
    const cMeta = t.db.prepare("SELECT file_name, total_rows FROM pos_catalog_meta").all();
    t.ok(cP.length === 2, `classic imported the two products (${cP.length}; ${before} before, the list is replaced)`);
    t.db.prepare(`DELETE FROM ${PP}`).run(); t.db.prepare("DELETE FROM pos_catalog_meta").run();
    await t.open(p, "2", "emergency-pos", "eposreg", "[data-k=import]");
    fc = p.waitForEvent("filechooser"); await p.click("[data-k=import]"); await (await fc).setFiles(file);
    for (let i = 0; i < 80 && t.db.prepare(`SELECT COUNT(*) AS c FROM ${PP} WHERE name LIKE 'First-day%'`).get().c < 2; i++) await p.waitForTimeout(100);
    const nP = t.db.prepare(`SELECT * FROM ${PP} WHERE name LIKE 'First-day%' ORDER BY name`).all();
    t.ok(nP.length === 2, `new layout imported the two products (${nP.length})`);
    for (let i = 0; i < 2; i++) t.same("product " + (i + 1), cP[i], nP[i]);
    t.ok(JSON.stringify(cMeta) === JSON.stringify(t.db.prepare("SELECT file_name, total_rows FROM pos_catalog_meta").all()), "the import's file name and row count are stored the same");
  },
};
