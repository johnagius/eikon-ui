// solo-: runs last, alone — it adds a location in the distributor range (400-599), and a case that adds a pharmacy
// without an id afterwards would otherwise get an id above 400. Polish batch-22, fault 2: the distributor's Today,
// Problems and the answer card, and the pharmacy's Sent orders, show a reported problem's type in plain English — the
// worker's demo seed writes the code "short_dated", the pickers write "Wrong Pick" and the like.
// Its own world: group 22 with a pharmacy (92) and a distributor (492).
export default {
  title: "Polish batch-22: problem types on the distributor's screens",
  async run(t) {
    const { app } = t.stack, db = t.db;
    db.prepare("INSERT OR IGNORE INTO orgs (id, name) VALUES (22, 'Polish Group 22')").run();
    db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (92, 22, 'Rabat Pharmacy')").run();
    db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (492, 22, 'Island Pharma 22')").run();
    const ph = (await app.addUser({ orgId: 22, locationId: 92, email: "ph@polish22.mt", password: "Polish-Pass-2026", name: "Anna Borg" })).token;
    const sup = (await app.addUser({ orgId: 22, locationId: 492, email: "sup@polish22.mt", password: "Polish-Pass-2026", name: "Ramona Ellul" })).token;
    const api = async (tok, m, p, body) => { const r = await app.api(m, p, { token: tok, body }); if (r.status >= 300) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 200)); return r.json; };
    const prod = (stock_code, description) => ({ stock_code, barcode: "", description, cost_excl_vat: 1, vat_rate: 0, retail_price: 2, qty_purchased: 1, qty_free: 0, batch: "", expiry_date: "" });
    const list = [prod("P22-1", "Paracetamol 500mg tablets x24"), prod("P22-2", "Accu-Chek Instant strips x50")], ids = [];
    for (const x of list) ids.push((await api(sup, "POST", "/supplier-products/entries", x)).id);
    const o = await api(ph, "POST", "/supplier-orders", { supplier_location_id: 492, supplier_name: "Island Pharma 22", notes: "", items: list.map((x, k) => ({ product_id: ids[k], description: x.description, barcode: "", stock_code: x.stock_code, qty_requested: 2, cost_excl_vat: 1, vat_rate: 0, retail_price: 2 })) });
    const items = ((await api(sup, "GET", "/supplier-orders/" + o.id)).items) || [];
    await api(sup, "PUT", "/supplier-orders/" + o.id + "/confirm", { status: "shipped", supplier_notes: "", scheduled_delivery_date: "", items: items.map((i) => ({ id: i.id, unavailable: 0, qty_confirmed: i.qty_requested, notes: "" })) });
    await api(ph, "POST", "/supplier-orders/items/" + items[1].id + "/feedback", { problem_type: "short_dated", notes: "Expiry in 3 months" });
    await api(ph, "POST", "/supplier-orders/items/" + items[0].id + "/feedback", { problem_type: "Wrong Pick", notes: "" });

    const as = async (tok, role, opts) => { const p = await t.page(opts); await p.addInitScript(([k, r]) => { try { localStorage.setItem("eikon_token", k); localStorage.setItem("eikon_active_role", r); localStorage.removeItem("eikon_ui2"); } catch (e) {} }, [tok, role]); return p; };
    for (const phone of [false, true]) {
      const p = await as(sup, "supplier", { phone });
      await t.open(p, "2", "suphome", "suphome", "[data-fb]");
      const rows = await p.evaluate(() => [...document.querySelectorAll("[data-fb] b")].map((b) => b.textContent).sort());
      t.ok(rows.join("|") === "Short expiry date · Accu-Chek Instant strips x50|Wrong pick · Paracetamol 500mg tablets x24", (phone ? "phone" : "desktop") + ": Today's Problems reported in plain English, no 'short_dated': " + JSON.stringify(rows));
      if (!phone) {
        await t.open(p, "2", "supproblems", "supproblems", "[data-fbcard]");
        const cards = await p.evaluate(() => [...document.querySelectorAll("[data-fbcard] .ptl-line b")].map((b) => b.textContent).sort()), pr = await p.evaluate(() => document.querySelector("#eikon-content").innerText);
        t.ok(!/short_dated/.test(pr) && cards.join("|") === "Short expiry date · Accu-Chek Instant strips x50|Wrong pick · Paracetamol 500mg tablets x24", "Problems: each answer card in plain English: " + JSON.stringify(cards));
      }
    }
    {
      const p = await as(ph, "pharmacy");
      await t.open(p, "2", "sinreg", "sinreg", "[data-act=view][data-v=orders]");
      await p.click("[data-act=view][data-v=orders]"); await p.waitForTimeout(300);
      const row = p.locator("[data-act=open], .sin-order, button", { hasText: "Island Pharma 22" }).first(); if (await row.count()) await row.click().catch(() => {});
      await p.waitForTimeout(400);
      const pills = await p.evaluate(() => [...document.querySelectorAll(".sin-pill.bad")].map((x) => x.textContent).sort());
      t.ok(pills.length === 2 && pills.join("|") === "Reported: Short expiry date|Reported: Wrong pick", "the pharmacy's Sent orders: Reported: in plain English: " + JSON.stringify(pills));
    }
  }
};
