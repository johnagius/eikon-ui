// solo-: runs last, alone — it adds locations with ids in the distributor/head-office ranges (450-685), and a case that
// adds a pharmacy without an id afterwards (owner.mjs) would otherwise get an id above 400 (a supplier or head office).
// Portals (FIN): the distributor (supplier portal, 400-599) and the head office (600-900) in the new layout, on the
// real worker. Its own world, so nothing another case reads is touched: group 9 with two pharmacies (70, 71), two
// distributors (470, 471) and its head office (670); the Cherubino group (12) with a pharmacy (85) and head office (685).
//   - the distributor on a phone and a desktop: the bottom bar / rail, no sideways scroll, only its own orders;
//   - an order marked sent in the new Orders screen stores exactly what the classic Received Orders stores for the same
//     input (order row and every line), problems answered with the classic body, products added / marked out of
//     stock / deleted with the classic bodies (product row compared with one added in the classic screen);
//   - the head office: its own pharmacies only (no Demo Pharmacy), stock alerts, registers; staff without the figures;
//     the Cherubino screens hidden from group 9, there for group 12 (and its classic screen opens);
//   - the help guides match these screens; axe (WCAG 2.1 A/AA) on every portal screen, phone and desktop, light and dark.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGuides, compare, readScreenInPage } from "../../helpmatch.mjs";
import { ymd } from "../lib.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ui");
const AXE = process.env.AXE || "/tmp/claude-0/-home-user-eikon-ui/a14b1a07-7863-5333-b96b-a89485eb56dd/scratchpad/axe/node_modules/axe-core/axe.min.js";

async function world(t) {
  const { app } = t.stack, db = t.db;
  const loc = (id, org, name) => db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(id, org, name);
  db.prepare("INSERT OR IGNORE INTO orgs (id, name) VALUES (9, 'Portal Test Group')").run();
  db.prepare("INSERT OR IGNORE INTO orgs (id, name) VALUES (12, 'Cherubino Group')").run();
  loc(70, 9, "Mosta Pharmacy"); loc(71, 9, "Żebbuġ Pharmacy"); loc(470, 9, "Island Pharma Distributors"); loc(471, 9, "Other Distributors"); loc(670, 9, "Portal Group Head Office");
  loc(85, 12, "Cherubino Pharmacy"); loc(685, 12, "Cherubino Head Office");
  const u = async (o) => (await app.addUser({ password: "Portal-Pass-2026", ...o })).token;
  return {
    ph: await u({ orgId: 9, locationId: 70, email: "ph@portal.mt", name: "Anna Borg" }),
    ph2: await u({ orgId: 9, locationId: 71, email: "ph2@portal.mt", name: "Paul Vella" }),
    sup: await u({ orgId: 9, locationId: 470, email: "sup@portal.mt", name: "Ramona Ellul" }),
    sup2: await u({ orgId: 9, locationId: 471, email: "sup2@portal.mt", name: "Mark Galea" }),
    ho: await u({ orgId: 9, locationId: 670, email: "ho@portal.mt", name: "Kurt Muscat" }),
    hoStaff: await u({ orgId: 9, locationId: 670, email: "hostaff@portal.mt", role: "staff", name: "Rita Pace" }),
    ho12: await u({ orgId: 12, locationId: 685, email: "ho@cherubino.mt", name: "Joe Cassar" })
  };
}
const api = async (t, token, m, p, body) => { const r = await t.stack.app.api(m, p, { token, body }); if (r.status >= 300) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 200)); return r.json; };

// A page signed in as `token` in `role` ("supplier" / "company_admin"), on the new layout or a classic visit.
async function as(t, token, role, opts) {
  const p = await t.page(opts);
  await p.addInitScript(([tok, r]) => { try { localStorage.setItem("eikon_token", tok); localStorage.setItem("eikon_active_role", r); localStorage.removeItem("eikon_ui2"); } catch (e) {} }, [token, role]);
  return p;
}
const visible = (p) => p.evaluate(() => {
  const vis = (e) => !!(e.offsetWidth || e.offsetHeight || e.getClientRects().length);
  const c = document.getElementById("eikon-content").getBoundingClientRect(), bar = document.querySelector(".eikon-sidebar").getBoundingClientRect();
  return { ui2: document.documentElement.hasAttribute("data-ui2"), rail: [...document.querySelectorAll(".eikon-rail-btn")].filter(vis).map((b) => b.querySelector(".eikon-nav-label").textContent),
    sx: document.documentElement.scrollWidth, vw: window.innerWidth, cw: c.width, barTop: bar.top, barH: bar.height, text: document.getElementById("eikon-content").innerText };
});

export default {
  title: "Distributor and head-office portals",
  async run(t) {
    const T = await world(t);
    const axeOn = fs.existsSync(AXE), axeSrc = axeOn ? fs.readFileSync(AXE, "utf8") : "";
    if (!axeOn) t.note("axe not found at " + AXE + ": accessibility not checked");
    const axe = async (p, label) => {
      if (!axeOn) return;
      await p.evaluate(axeSrc);
      const v = await p.evaluate(async () => (await window.axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((x) => x.id + " " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(", ")));
      t.ok(!v.length, "axe " + label + ": " + v.join(" | "));
    };
    const G = loadGuides(root);
    const help = async (p, id) => { const r = await p.evaluate(readScreenInPage); const pr = compare(id, G[id], r.footer, r.labels); t.ok(!pr.length, pr.join(" | ")); t.ok(!!G[id], id + ": has a help guide"); };

    // ---- the distributor's products and two orders from Mosta, one from Żebbuġ to the other distributor
    const P = [["Augmentin 625mg x14", "AUG625", 8.2, 12.5, ymd(20)], ["Amoxil 500mg x21", "AMX500", 3.1, 5.4, ""], ["Ventolin inhaler 100mcg", "VEN100", 3.5, 6.2, ""], ["Ozempic 1mg pen", "OZE1", 92, 118, ""]];
    const prods = [];
    for (const [d, c, cost, rrp, exp] of P) prods.push({ id: (await api(t, T.sup, "POST", "/supplier-products/entries", { description: d, stock_code: c, barcode: "", cost_excl_vat: cost, cost_incl_vat: 0, vat_rate: 0, discount_pct: 0, discount_euro: 0, qty_purchased: 1, qty_free: 0, batch: exp ? "B1" : "", expiry_date: exp, retail_price: rrp })).id, d, c, cost, rrp });
    const order = (pi, from) => api(t, from || T.ph, "POST", "/supplier-orders", { supplier_location_id: 470, supplier_name: "Island Pharma Distributors", notes: "Before Friday please", items: pi.map((i) => ({ product_id: prods[i].id, description: prods[i].d, stock_code: prods[i].c, qty_requested: 2 + i, cost_excl_vat: prods[i].cost, retail_price: prods[i].rrp, vat_rate: 0 })) });
    const oNew = (await order([0, 1, 2])).id, oOld = (await order([0, 1, 2])).id;
    await api(t, T.ph2, "POST", "/supplier-orders", { supplier_location_id: 471, supplier_name: "Other Distributors", notes: "", items: [{ description: "Secret line", qty_requested: 1, cost_excl_vat: 1, retail_price: 2, vat_rate: 0 }] });

    // ---- phone: Today, the bottom bar, nothing cut off
    const ph = await as(t, T.sup, "supplier", { phone: true });
    await t.open(ph, "2", "suphome", "suphome", ".ptl-tile");
    let v = await visible(ph);
    t.ok(v.ui2 && v.rail.join() === "Today,Orders,Problems,Products,Account", "distributor: the new layout with its own tabs, got " + JSON.stringify(v.rail));
    t.ok(v.sx <= v.vw && v.cw >= 380 && v.barTop > 700, "distributor phone: no sideways scroll, the screen full width, the tabs at the bottom: " + JSON.stringify({ sx: v.sx, cw: v.cw, barTop: v.barTop }));
    t.ok(/To send\s*2/.test(v.text) && /Mosta Pharmacy/.test(v.text) && !/Secret line|Żebbuġ/.test(v.text), "distributor Today: its 2 orders to send, only its own: " + v.text.slice(0, 200));
    t.ok(/Augmentin[\s\S]*Expires in 20 days/.test(v.text), "short expiry shows Augmentin, 20 days");
    for (const id of ["suphome", "suporders", "supproblems", "supproducts", "ptlacct"]) {
      await ph.evaluate((h) => { location.hash = "#" + h; }, id); await ph.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content h1"), id); await t.idle(ph);
      v = await visible(ph); t.ok(v.sx <= v.vw, id + " phone: no sideways scroll (" + v.sx + ")");
      await help(ph, id); await axe(ph, id + " phone light");
    }
    // a pharmacy screen asked for in the portal opens the portal's Today; another client's never
    for (const h of ["tempreg", "cherubino-oos", "hqhome"]) { await ph.evaluate((x) => { location.hash = "#" + x; }, h); await ph.waitForTimeout(600); t.ok(await ph.evaluate(() => window.EIKON.state.activeModuleId) === "suphome" && /ui=2|^[^?]*$/.test(ph.url()), "#" + h + " opens the distributor's Today, got " + await ph.evaluate(() => window.EIKON.state.activeModuleId + " " + location.href)); }

    // (18:05) a portal user never lands in the classic layout by an address: an old one-visit link, the old screen names
    for (const [h0, want] of [["?ui=classic#supplier-received-orders", "suporders"], ["?ui=classic#today", "suphome"], ["#supplier-products", "supproducts"], ["#supplier-dashboard", "suphome"]]) {
      await ph.goto(t.base + (h0[0] === "?" ? h0.replace("?", "?intro=0&") : "?ui=2" + h0));
      await ph.waitForFunction((m) => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === m && document.documentElement.hasAttribute("data-ui2"), want, { timeout: 15000 }).catch(() => {});
      const at = await ph.evaluate(() => ({ m: window.EIKON.state.activeModuleId, ui2: document.documentElement.hasAttribute("data-ui2"), cls: !!document.querySelector(".eikon-nav-cat") }));
      t.ok(at.m === want && at.ui2 && !at.cls, h0 + " lands on the new " + want + ", got " + JSON.stringify(at));
    }
    t.ok(!(await visible(ph)).text.includes("Classic screen"), "no Classic screen link on the portal's screens");

    // ---- desktop: send an order in the new screen
    const p = await as(t, T.sup, "supplier");
    await t.open(p, "2", "suphome", "suphome", ".ptl-tile");
    await p.click('[data-order="' + oNew + '"]');
    await p.waitForSelector("#ptl-ship");
    const amoxNew = await p.evaluate((d) => [...document.querySelectorAll("[data-item]")].find((b) => b.getAttribute("aria-label").includes(d)).getAttribute("data-item"), "Amoxil");
    const un = await t.write(p, /\/supplier-orders\/items\/\d+\/unavailable$/, () => p.click('[data-item="' + amoxNew + '"]'), "PUT");
    t.ok(JSON.stringify(un.body) === JSON.stringify({ unavailable: true, notes: "" }), "not available: the classic body, got " + JSON.stringify(un.body));
    await p.waitForSelector('[data-act="oos-no"]');
    t.ok(await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "oos-yes", null, { timeout: 2000 }).then(() => true, () => false), "the out-of-stock question takes the focus");
    await p.click('[data-act="oos-no"]');
    await p.fill("#ptl-ship [name=scheduled_delivery_date]", ymd(2)); await p.fill("#ptl-ship [name=supplier_notes]", "Van on Thursday, Triq il-Kbira");
    await p.click("#ptl-ship button[type=submit]");
    await p.waitForSelector('#ptl-ship .ptl-ask');
    t.ok(/1 line shows to them as not available/.test(await p.textContent("#ptl-ship .ptl-ask")), "the confirmation says what the pharmacy will see");
    const sh = await t.write(p, new RegExp("/supplier-orders/" + oNew + "/confirm$"), () => p.click("#ptl-ship button[type=submit]"), "PUT");
    await p.waitForSelector('.ptl-seg [data-filter="pending"]');
    await help(p, "suporders"); await axe(p, "suporders desktop light");

    // the classic Received Orders, same input, on the other order
    const c = await as(t, T.sup, "supplier");
    await t.open(c, "1", "supplier-received-orders", "supplier-received-orders", '[data-expand-id="' + oOld + '"]');
    await c.click('[data-expand-id="' + oOld + '"]');
    await c.waitForSelector(".sro-unavail-btn");
    await c.click('.sro-unavail-btn[data-item-desc="Amoxil 500mg x21"]');
    await c.waitForSelector(".eikon-modal button:has-text('No, just this order')"); await c.click(".eikon-modal button:has-text('No, just this order')");
    await c.fill(".sro-delivery-date", ymd(2)); await c.fill(".sro-supplier-notes", "Van on Thursday, Triq il-Kbira");
    await c.click(".sro-ship-btn"); await c.waitForSelector(".eikon-modal button:has-text('Ship Order')");
    const cs = await t.write(c, new RegExp("/supplier-orders/" + oOld + "/confirm$"), () => c.click(".eikon-modal button:has-text('Ship Order')"), "PUT");
    const strip = (b) => ({ ...b, items: (b.items || []).map((i, k) => ({ ...i, id: k })) });
    t.ok(JSON.stringify(strip(sh.body)) === JSON.stringify(strip(cs.body)), "mark as sent: the same body as the classic Order Shipped (line ids aside): new " + JSON.stringify(sh.body) + " classic " + JSON.stringify(cs.body));
    await t.idle(c);
    for (const x of ["today", "tempreg", "cherubino-oos"]) { await c.evaluate((y) => { location.hash = "#" + y; }, x); await c.waitForTimeout(500); t.ok(await c.evaluate(() => window.EIKON.state.activeModuleId) === "supplier-dashboard", "classic visit as the distributor: #" + x + " opens its own dashboard, not a pharmacy's or another client's screen"); }
    t.same("supplier order", t.row("supplier_orders", oOld), t.row("supplier_orders", oNew), { updated_at: "the moment it was saved" });
    const lines = (id) => t.db.prepare("SELECT * FROM supplier_order_items WHERE order_id = ? ORDER BY id").all(id);
    const ln = lines(oNew), lo = lines(oOld);
    t.ok(ln.length === 3 && lo.length === 3, "three lines each");
    for (let k = 0; k < 3; k++) t.same("order line " + (k + 1), { ...lo[k], order_id: 0 }, { ...ln[k], order_id: 0 });
    t.has("sent order", t.row("supplier_orders", oNew), { status: "shipped", supplier_notes: "Van on Thursday, Triq il-Kbira", scheduled_delivery_date: ymd(2) });
    t.ok(ln[1].unavailable === 1 && ln[1].qty_confirmed === 0 && ln[0].qty_confirmed === 2, "Amoxil not available, the others confirmed");

    // ---- W22: a line sent short (2 asked, 1 sent): the pharmacy sees "1 confirmed"; W40 the delivery day in words;
    // W23: the pharmacy reports a problem on that line in Supplier stock and adds it to Returns, with the classic bodies.
    const oShort = (await order([0, 2])).id;
    await p.evaluate(() => { location.hash = "#suphome"; }); await p.waitForSelector('[data-order="' + oShort + '"]');
    await p.click('[data-order="' + oShort + '"]'); await p.waitForSelector("#ptl-ship");
    const aug = await p.evaluate(() => [...document.querySelectorAll("[data-qty]")].find((x) => /Augmentin/.test(x.getAttribute("aria-label"))).getAttribute("data-qty"));
    await p.fill('[data-qty="' + aug + '"]', "5"); await p.click("#ptl-ship button[type=submit]");
    const qf = await p.waitForFunction((a) => document.activeElement && document.activeElement.getAttribute("data-qty") === a, aug, { timeout: 2000 }).then(() => true, () => false);
    t.ok(/write a number from 1 to 2/.test(await p.textContent("#ptl-ship")) && qf, "more than asked is refused, and the focus goes to that line: " + qf + " " + (await p.textContent("#ptl-ship")).slice(0, 160));
    await p.fill('[data-qty="' + aug + '"]', "1"); await p.fill("#ptl-ship [name=scheduled_delivery_date]", ymd(1));
    await p.click("#ptl-ship button[type=submit]"); await p.waitForSelector("#ptl-ship .ptl-ask");
    t.ok(/go out short/.test(await p.textContent("#ptl-ship .ptl-ask")), "the confirmation says a line goes out short");
    const shs = await t.write(p, new RegExp("/supplier-orders/" + oShort + "/confirm$"), () => p.click("#ptl-ship button[type=submit]"), "PUT");
    t.ok(shs.body.items.map((i) => i.qty_confirmed).join() === "1,4" && shs.body.items.every((i) => Object.keys(i).join() === "id,unavailable,qty_confirmed,notes"), "short line: qty_confirmed 1, the same body shape: " + JSON.stringify(shs.body));
    const sl = lines(oShort);
    const php = await t.page(); // Mosta's pharmacist, the new layout
    await php.addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} }, T.ph);
    await t.open(php, "2", "sinreg", "sinreg", '[data-act="view"][data-v="orders"]');
    await php.click('[data-act="view"][data-v="orders"]'); await php.waitForSelector('[data-act="open"][data-id="' + oShort + '"]');
    await php.click('[data-act="open"][data-id="' + oShort + '"]'); await php.waitForSelector('[data-act="rp"]');
    const det = await php.evaluate(() => document.querySelector(".sin-det").innerText);
    const wd = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][new Date(ymd(1) + "T12:00:00Z").getUTCDay()];
    t.ok(new RegExp("Expected delivery: " + wd + " \\d+ [A-Z][a-z]{2}").test(det) && /1 confirmed/.test(det), "pharmacy: the delivery day in words and the line sent short: " + det.slice(0, 200));
    await php.click('[data-act="rp"][data-id="' + sl[0].id + '"]'); await php.waitForSelector("#sin-rp");
    await php.click("#sin-rp button[type=submit]");
    t.ok(/Choose what is wrong/.test(await php.textContent("#sin-rp")), "a problem needs its kind");
    await php.selectOption("#sin-rp select", "Short Quantity"); await php.fill("#sin-rp [name=notes]", "Only 1 came");
    const fbp = await t.write(php, new RegExp("/supplier-orders/items/" + sl[0].id + "/feedback$"), () => php.click("#sin-rp button[type=submit]"));
    t.ok(JSON.stringify(fbp.body) === JSON.stringify({ problem_type: "Short Quantity", notes: "Only 1 came" }), "report: the classic Supplier Inventory body, got " + JSON.stringify(fbp.body));
    await php.waitForSelector('[data-act="ret-yes"]');
    const rtw = await t.write(php, /\/returns\/entries$/, () => php.click('[data-act="ret-yes"]'));
    t.ok(JSON.stringify(rtw.body) === JSON.stringify({ entry_date: ymd(0), description: "Augmentin 625mg x14", supplier: "Island Pharma Distributors", batch: "", expiry: "", quantity: "2", remarks: "Short Quantity - Only 1 came", damaged: 0 }), "Add to Returns: the classic body, got " + JSON.stringify(rtw.body));
    await axe(php, "sinreg sent order with a report desktop light");

    // ---- a problem reported, answered in Problems
    await api(t, T.ph, "POST", "/supplier-orders/items/" + ln[0].id + "/feedback", { problem_type: "Damaged", notes: "Box crushed" });
    await p.evaluate(() => { location.hash = "#supproblems"; }); await p.waitForSelector("form[data-fbform]");
    await p.click("form[data-fbform] button[type=submit]"); // no answer chosen: said next to the field, nothing sent
    t.ok(/Choose your answer/.test(await p.textContent("form[data-fbform]")) && await p.evaluate(() => document.activeElement.name) === "resolution_status", "an answer is needed, said at the field");
    await p.selectOption("form[data-fbform] select", "Credit Issued"); await p.fill("form[data-fbform] [name=supplier_notes]", "Credit note CN-12 sent");
    const fbw = await t.write(p, /\/supplier-orders\/feedback\/\d+\/resolve$/, () => p.click("form[data-fbform] button[type=submit]"), "PUT");
    t.ok(JSON.stringify(fbw.body) === JSON.stringify({ resolution_status: "Credit Issued", supplier_notes: "Credit note CN-12 sent" }), "answer: the classic body, got " + JSON.stringify(fbw.body));
    t.has("answer", t.db.prepare("SELECT * FROM supplier_order_item_feedback ORDER BY id DESC").get(), { resolution_status: "Credit Issued", supplier_notes: "Credit note CN-12 sent" });
    await help(p, "supproblems");

    // ---- products: add (compared with the classic Add Product), out of stock, delete
    await p.evaluate(() => { location.hash = "#supproducts"; }); await p.waitForSelector('[data-act="add"]');
    await p.click('[data-act="add"]');
    await t.fill(p, "#ptl-pf", { description: "Brufen Syrup 100ml", stock_code: "BRU100", barcode: "5012345", cost_excl_vat: "3", qty_purchased: "10", qty_free: "2", batch: "LOT9", expiry_date: ymd(15), retail_price: "5.50" });
    await p.selectOption("#ptl-pf [name=vat_rate]", "18");
    const add = await t.write(p, /\/supplier-products\/entries$/, () => p.click("#ptl-pf button[type=submit]"));
    await p.waitForSelector('[data-edit="' + add.json.id + '"]');
    const cp = await as(t, T.sup, "supplier");
    await t.open(cp, "1", "supplier-products", "supplier-products", "#sp-btn-add");
    await cp.click("#sp-btn-add"); await cp.waitForSelector("#sp-m-description");
    for (const [k, val] of Object.entries({ description: "Brufen Syrup 100ml", stock_code: "BRU100", barcode: "5012345", cost_excl_vat: "3", qty_purchased: "10", qty_free: "2", batch: "LOT9", expiry_date: ymd(15), retail_price: "5.50" })) await cp.fill("#sp-m-" + k, val);
    await cp.selectOption("#sp-m-vat_rate", "18");
    const cadd = await t.write(cp, /\/supplier-products\/entries$/, () => cp.click(".eikon-modal button:has-text('Add')"));
    t.ok(JSON.stringify(add.body) === JSON.stringify(cadd.body), "add product: the classic body, new " + JSON.stringify(add.body) + " classic " + JSON.stringify(cadd.body));
    t.same("product", t.row("supplier_products", cadd.json.id), t.row("supplier_products", add.json.id));
    const oz = prods[3].id;
    const oos = await t.write(p, new RegExp("/supplier-products/entries/" + oz + "/stock-status$"), () => p.click('[data-stock="' + oz + '"]'), "PUT");
    t.ok(JSON.stringify(oos.body) === JSON.stringify({ out_of_stock: 1 }) && t.row("supplier_products", oz).out_of_stock === 1, "out of stock: the classic body and row");
    await t.idle(p);
    await p.click('[data-edit="' + cadd.json.id + '"]'); await p.click('#ptl-pf [data-act="del"]'); await p.waitForSelector('[data-act="del-yes"]');
    await t.write(p, new RegExp("/supplier-products/entries/" + cadd.json.id + "$"), () => p.click('[data-act="del-yes"]'), "DELETE");
    t.ok(!t.row("supplier_products", cadd.json.id) && !!t.row("supplier_products", add.json.id), "delete removes that product only");
    await t.idle(p);
    await help(p, "supproducts"); await axe(p, "supproducts desktop light");
    // the second distributor sees none of it
    const p2 = await as(t, T.sup2, "supplier");
    await t.open(p2, "2", "suporders", "suporders", ".ptl-seg");
    const t2 = await p2.evaluate(() => document.getElementById("eikon-content").innerText);
    t.ok(/Żebbuġ Pharmacy/.test(t2) && !/Mosta/.test(t2), "the other distributor sees only the order sent to it");

    // ---- head office (group 9)
    await api(t, T.ph, "POST", "/alerts/entries", { entry_date: ymd(-1), alert_type: "recall", status: "open", item_name: "Valsartan 80mg", batch: "VX1", storage_location: "room" });
    await api(t, T.ph2, "POST", "/near-expiry/entries", { product_name: "Clexane 40mg", expiry_date: ymd(12), location: "Fridge", notes: "" });
    const h = await as(t, T.ho, "company_admin");
    await t.open(h, "2", "hqhome", "hqhome", ".ptl-card");
    v = await visible(h);
    t.ok(v.rail.join() === "Today,How we're doing,Registers,Account", "head office tabs (no Cherubino for group 9): " + v.rail);
    t.ok(/Mosta Pharmacy/.test(v.text) && /Żebbuġ Pharmacy/.test(v.text) && !/Demo Pharmacy|Cherubino/.test(v.text), "head office: its own pharmacies only");
    t.ok(/Mosta Pharmacy: 1 recall is still open \(Valsartan 80mg\)/.test(v.text) && /1 item expires within 30 days/.test(v.text), "head office: the recall and the near expiry");
    // (18:05) nothing before a pharmacy's start day is blamed (FIN-dayzero's start day, sent per pharmacy by /hq/stock):
    // both test pharmacies were created today, so no "days not closed", no missing fridge days, nothing red on Registers.
    const hs0 = await api(t, T.ho, "GET", "/hq/stock");
    if (hs0.pharmacies.every((x) => x.since)) {
      t.ok(hs0.pharmacies.every((x) => x.since === ymd(0)), "start days: today for both new pharmacies " + JSON.stringify(hs0.pharmacies.map((x) => x.since)));
      t.ok(!/not closed|without a reading|No cleaning|never been counted/.test(v.text) && /Started today/.test(v.text), "head office Today: nothing blamed before the pharmacies started: " + v.text.slice(0, 400));
    } else t.note("no start day in /hq/stock (FIN-dayzero's locationSince not in this build): start-day checks skipped");
    await help(h, "hqhome"); await axe(h, "hqhome desktop light");
    // a "Needs someone" row opens How we're doing on that pharmacy, with no error in the console (18:05: a TypeError in
    // ownreg's paint when it drew a moment later); twice, the second time with the previous figures in hand.
    const cerr = []; h.on("console", (m) => { if (m.type() === "error") cerr.push(m.text().slice(0, 200)); });
    for (let k = 0; k < 2; k++) {
      await h.evaluate(() => { location.hash = "#hqhome"; }); await h.waitForSelector("button.ptl-row[data-own]");
      await h.click("button.ptl-row[data-own]"); await h.waitForFunction(() => window.EIKON.state.activeModuleId === "ownreg" && document.querySelector(".own h1")); await t.idle(h);
    }
    t.ok(!cerr.length && !/Module crashed/.test(await h.evaluate(() => document.body.innerText)), "Needs someone → How we're doing: no console error: " + cerr.join(" | "));
    await h.evaluate(() => { location.hash = "#hqhome"; }); await h.waitForSelector('[data-own="70"]');
    await h.click('.ptl-card [data-own="70"]'); await h.waitForFunction(() => window.EIKON.state.activeModuleId === "ownreg"); await t.idle(h);
    t.ok(await h.evaluate(() => (document.querySelector("#own-loc") || {}).value) === "70", "See the figures opens How we're doing on that pharmacy");
    await h.evaluate(() => { location.hash = "#hqregs"; }); await h.waitForSelector(".ptl-grid"); await t.idle(h);
    const g = await h.evaluate(() => document.querySelector(".ptl-grid").innerText);
    t.ok(/Temperature/.test(g) && /Controlled drugs supplied/.test(g) && !/\d+\/\d+ days/.test(g), "registers in words, no '10/9 days'");
    if (hs0.pharmacies.every((x) => x.since)) t.ok(await h.evaluate(() => !document.querySelector(".ptl-grid td .bad")), "Registers: nothing red for pharmacies that started today: " + g.slice(0, 300));
    await help(h, "hqregs"); await axe(h, "hqregs desktop light");
    for (const x of ["cherubino-oos", "hqclient", "cherubino-admin"]) { await h.evaluate((y) => { location.hash = "#" + y; }, x); await h.waitForTimeout(700); t.ok(await h.evaluate(() => window.EIKON.state.activeModuleId) === "hqhome" && !/ui=classic/.test(h.url()), "group 9: #" + x + " never opens"); }
    const hp = await as(t, T.ho, "company_admin", { phone: true });
    await t.open(hp, "2", "hqhome", "hqhome", ".ptl-card");
    for (const id of ["hqhome", "hqregs", "ptlacct"]) {
      await hp.evaluate((x) => { location.hash = "#" + x; }, id); await hp.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content h1"), id); await t.idle(hp);
      v = await visible(hp); t.ok(v.sx <= v.vw && v.barTop > 700, id + " head office phone: no sideways scroll, tabs at the bottom");
      await axe(hp, id + " phone light");
    }
    // head-office staff: no figures tab, stock still shown
    const hs = await as(t, T.hoStaff, "company_admin");
    await t.open(hs, "2", "hqhome", "hqhome", ".ptl-card");
    v = await visible(hs);
    t.ok(v.rail.join() === "Today,Registers,Account" && /admin accounts/.test(v.text) && /1 alert open/.test(v.text), "head-office staff: no How we're doing, the stock alerts: " + v.rail + " " + v.text.slice(0, 160));

    // ---- the Cherubino group keeps its screens
    const k = await as(t, T.ho12, "company_admin");
    await t.open(k, "2", "hqhome", "hqhome", ".ptl-card, .ptl-quiet");
    v = await visible(k);
    t.ok(v.rail.includes("Cherubino"), "group 12: the Cherubino tab");
    await k.evaluate(() => { location.hash = "#hqclient"; }); await k.waitForSelector('[data-open="cherubino-oos"]'); await help(k, "hqclient"); await axe(k, "hqclient desktop light");
    await Promise.all([k.waitForURL(/ui=classic.*#cherubino-oos/), k.click('[data-open="cherubino-oos"]')]);
    await k.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "cherubino-oos" && document.querySelector("#eikon-content").innerText.length > 20, null, { timeout: 20000 });
    t.ok(!/Module crashed/.test(await k.evaluate(() => document.body.innerText)) && /‹ New Eikon/.test(await k.evaluate(() => document.body.innerText)), "group 12: the OOS list opens in the classic screen, with the way back");

    // ---- dark
    for (const [id, tok, role] of [["suphome", T.sup, "supplier"], ["suporders", T.sup, "supplier"], ["supproducts", T.sup, "supplier"], ["supproblems", T.sup, "supplier"], ["hqhome", T.ho, "company_admin"], ["hqregs", T.ho, "company_admin"], ["ptlacct", T.ho, "company_admin"]]) {
      for (const phone of [false, true]) {
        const d = await as(t, tok, role, { phone });
        await d.emulateMedia({ colorScheme: "dark" });
        await t.open(d, "2", id, id, "#eikon-content h1");
        await axe(d, id + (phone ? " phone" : " desktop") + " dark");
        await d.context().close();
      }
    }
  },
};
