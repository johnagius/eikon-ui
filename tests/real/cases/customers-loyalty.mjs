// Loyalty in the new design (modules.loyreg.js) against the classic Loyalty & Campaigns screen (modules.loyalty.js), on the
// real worker. For the same input each action sends the same body (same keys, same order, same values; only the
// classic's own random id and clock stamps differ) and stores the same row:
//   - New campaign (stamp card) and New campaign (spend levels, one level typed in: the classic stores it as text)
//     -> POST /loyalty/campaigns
//   - Pause (the classic Deactivate) -> PUT /loyalty/campaigns/:id with the whole campaign as loaded, active flipped
//   - Record a purchase (two items, total, receipt, notes, unpadded ID card) -> POST /loyalty/transactions, and the row
//   - Delete campaign -> DELETE /loyalty/campaigns/:id ; Remove card -> DELETE /loyalty/clients/:id (card + history)
//   - The classic screen still opens on the rows the new one wrote (same numbers, no page error).
//   - Rights: a staff sign-in sees no Delete / Remove card (the server answers 403 to staff for both).
import { ymd } from "../lib.mjs";
const strip = (b, drop) => { const o = {}; for (const k of Object.keys(b || {})) if (!drop.includes(k)) o[k] = b[k]; return o; };
const same = (t, label, a, b, drop) => {
  const A = strip(a, drop), B = strip(b, drop);
  t.ok(JSON.stringify(Object.keys(A)) === JSON.stringify(Object.keys(B)), label + ": same keys in the same order: classic " + Object.keys(A).join(",") + " / new " + Object.keys(B).join(","));
  t.ok(JSON.stringify(A) === JSON.stringify(B), label + ": same values: classic " + JSON.stringify(A).slice(0, 400) + " / new " + JSON.stringify(B).slice(0, 400));
};
async function body(p, method, re, action) {
  const [req] = await Promise.all([p.waitForRequest((r) => r.method() === method && re.test(new URL(r.url()).pathname), { timeout: 15000 }), action()]);
  await p.waitForResponse((r) => r.request() === req, { timeout: 15000 }).catch(() => {});
  return { path: new URL(req.url()).pathname, body: req.postData() ? JSON.parse(req.postData()) : null };
}
export default {
  title: "Loyalty: the new screen sends the classic bodies (campaigns, pause, purchase, delete), rights as the server",
  async run(t) {
    const cp = await t.page(), np = await t.page();
    // ---- New campaign: stamp card ----
    await t.open(cp, "classic", "loyalty", "loyalty", ".ly-tab[data-tab=campaigns]");
    await cp.click(".ly-tab[data-tab=campaigns]"); await cp.click("#ly-camp-new");
    await cp.click('.ly-type-card[data-type="stamp_card"]');
    await cp.fill("#ly-camp-f-name", "Ċensina's stamps"); await cp.fill("#ly-camp-f-brand", "Uriage"); await cp.fill("#ly-camp-f-desc", "Ten buys");
    await cp.fill("#ly-camp-f-stamp-target", "8"); await cp.fill("#ly-camp-f-reward", "Free cream");
    const c1 = await body(cp, "POST", /^\/loyalty\/campaigns$/, () => cp.click("#ly-camp-save"));
    await t.open(np, "2", "loyreg", "loyreg", "[data-act=view][data-v=campaigns]");
    await np.click("[data-act=view][data-v=campaigns]"); await np.click("[data-act=new-camp]");
    await np.check('#lyr-camp input[name=type][value="stamp_card"]');
    await np.fill("#lyr-camp [name=name]", "Ċensina's stamps"); await np.fill("#lyr-camp [name=brand]", "Uriage"); await np.fill("#lyr-camp [name=description]", "Ten buys");
    await np.fill("#lyr-camp [name=stamp_target]", "8"); await np.fill("#lyr-camp [name=reward]", "Free cream");
    const n1 = await body(np, "POST", /^\/loyalty\/campaigns$/, () => np.click("#lyr-camp [type=submit]"));
    same(t, "new stamp card", c1.body, n1.body, ["id", "created_at"]);
    const r1 = t.db.prepare("SELECT * FROM loyalty_campaigns WHERE id = ?").get(c1.body.id), r2 = t.db.prepare("SELECT * FROM loyalty_campaigns WHERE id = ?").get(n1.body.id);
    t.same("stamp card row", r1, r2, { id: "each screen makes its own id" });

    // ---- New campaign: spend levels, open-ended off, one level changed ----
    await cp.click("#ly-camp-new"); await cp.click('.ly-type-card[data-type="tiered"]');
    await cp.fill("#ly-camp-f-name", "Spend more"); await cp.uncheck("#ly-camp-f-open");
    await cp.fill("#ly-camp-f-start", ymd(0)); await cp.fill("#ly-camp-f-end", ymd(30));
    await cp.fill(".tier-reward[data-ti='0']", "5% off"); await cp.locator(".tier-reward[data-ti='0']").dispatchEvent("change");
    await cp.fill(".tier-spend[data-ti='1']", "120"); await cp.locator(".tier-spend[data-ti='1']").dispatchEvent("change");
    const c2 = await body(cp, "POST", /^\/loyalty\/campaigns$/, () => cp.click("#ly-camp-save"));
    await np.waitForSelector("[data-act=new-camp]"); await np.click("[data-act=new-camp]");
    await np.check('#lyr-camp input[name=type][value="tiered"]');
    await np.fill("#lyr-camp [name=name]", "Spend more"); await np.uncheck("#lyr-camp [name=open_ended]");
    await np.fill("#lyr-camp [name=start_date]", ymd(0)); await np.fill("#lyr-camp [name=end_date]", ymd(30));
    await np.fill("#lyr-camp [name=tier_reward_0]", "5% off"); await np.fill("#lyr-camp [name=tier_spend_1]", "120");
    const n2 = await body(np, "POST", /^\/loyalty\/campaigns$/, () => np.click("#lyr-camp [type=submit]"));
    same(t, "new spend levels", c2.body, n2.body, ["id", "created_at"]);

    // ---- Pause: the classic Deactivate ----
    const P = { id: "ly_case_pause", name: "Pause me", type: "points", active: true, open_ended: true, points_per_unit: 2, redeem_threshold: 50, reward: "€2 off" };
    await t.api("POST", "/loyalty/campaigns", P);
    await cp.goto("about:blank"); await t.open(cp, "classic", "loyalty", "loyalty", ".ly-tab[data-tab=campaigns]"); await cp.click(".ly-tab[data-tab=campaigns]");
    const c3 = await body(cp, "PUT", /^\/loyalty\/campaigns\//, () => cp.click(`#ly-tab-campaigns [data-camp-toggle="${P.id}"]`));
    await t.api("POST", "/loyalty/campaigns", P); // running again, for the new screen to pause
    await np.goto("about:blank"); await t.open(np, "2", "loyreg", "loyreg", "[data-act=view][data-v=campaigns]"); await np.click("[data-act=view][data-v=campaigns]");
    const n3 = await body(np, "PUT", /^\/loyalty\/campaigns\//, () => np.click(`[data-act=toggle-camp][data-id="${P.id}"]`));
    t.ok(c3.path === n3.path, "Pause: same address " + c3.path + " / " + n3.path);
    same(t, "Pause", c3.body, n3.body, ["updated_at"]);

    // ---- Record a purchase ----
    const camp = n1.body; // the stamp card both screens made (the new one's)
    const card = "884456m", padded = "0884456M";
    await cp.goto("about:blank"); await t.open(cp, "classic", "loyalty", "loyalty", ".ly-tab[data-tab=record]"); await cp.click(".ly-tab[data-tab=record]");
    await cp.fill("#ly-txn-id", card); await cp.locator("#ly-txn-id").blur(); await cp.fill("#ly-txn-name", "Zammit Ċensina");
    await cp.fill("#ly-txn-receipt", "R-77"); await cp.selectOption("#ly-txn-camp", camp.id);
    await cp.fill("#ly-item-input", "Uriage Xémose"); await cp.fill("#ly-item-qty", "2"); await cp.click("#ly-add-item");
    await cp.fill("#ly-item-input", "Bariéderm"); await cp.fill("#ly-item-qty", "1"); await cp.click("#ly-add-item");
    await cp.fill("#ly-txn-total", "31.5"); await cp.fill("#ly-txn-notes", "Paid by card");
    const l0 = t.maxId("loyalty_transactions");
    const c4 = await body(cp, "POST", /^\/loyalty\/transactions$/, () => cp.click("#ly-txn-submit"));
    const rowC = (await t.mine("loyalty_transactions", l0, { receipt_no: "R-77" }, 1))[0];
    await np.goto("about:blank"); await t.open(np, "2", "loyreg", "loyreg", "#lyr-rec [name=client_id]");
    await np.fill("#lyr-rec [name=client_id]", card); await np.fill("#lyr-rec [name=client_name]", "Zammit Ċensina");
    await np.selectOption("#lyr-rec [name=campaign_id]", camp.id);
    await np.fill("#lyr-rec [name=item_desc]", "Uriage Xémose"); await np.fill("#lyr-rec [name=item_qty]", "2"); await np.click("[data-act=item-add]");
    await np.fill("#lyr-rec [name=item_desc]", "Bariéderm"); await np.fill("#lyr-rec [name=item_qty]", "1"); await np.press("#lyr-rec [name=item_desc]", "Enter");
    await np.fill("#lyr-rec [name=total]", "31.5"); await np.fill("#lyr-rec [name=receipt_no]", "R-78"); await np.fill("#lyr-rec [name=notes]", "Paid by card");
    const l1 = t.maxId("loyalty_transactions");
    const n4 = await body(np, "POST", /^\/loyalty\/transactions$/, () => np.click("#lyr-rec [type=submit]"));
    const rowN = (await t.mine("loyalty_transactions", l1, { receipt_no: "R-78" }, 1))[0];
    t.ok(c4.body && c4.body.receipt_no === "R-77" && n4.body && n4.body.receipt_no === "R-78", "both purchases sent");
    same(t, "purchase", c4.body, { ...n4.body, receipt_no: "R-77" }, ["id", "created_at"]);
    t.same("purchase row", rowC, rowN && { ...rowN, receipt_no: "R-77" });
    t.ok(n4.body.client_id === padded && n4.body.stamps_awarded === 3 && n4.body.action_label === "Awarded 3 stamps", "padded ID card, 3 stamps: " + JSON.stringify(n4.body).slice(0, 200));
    await np.waitForSelector(".lyr-done", { timeout: 8000 });
    t.ok(/Saved for Zammit Ċensina/.test(await np.textContent(".lyr-done")), "quiet success line with the name");
    t.ok(await np.evaluate(() => document.activeElement && document.activeElement.name === "client_id"), "ready for the next customer (focus in ID card)");
    // the receipt print is the classic page (same function body): the new one prints, its HTML has the classic's lines
    await np.click("[data-act=print-receipt]");
    const html = await np.evaluate(() => window.EIKON.loyLastPrint || "");
    t.ok(/<title>Loyalty Receipt<\/title>/.test(html) && /Awarded 3 stamps/.test(html) && /ID Card:<\/span><span>0884456M/.test(html), "the classic receipt page");

    // ---- errors all at once, nothing sent ----
    await np.click("[data-act=clear]").catch(() => {});
    let posted = 0; const onReq = (r) => { if (r.method() === "POST" && /\/loyalty\/transactions$/.test(r.url())) posted++; }; np.on("request", onReq);
    await np.selectOption("#lyr-rec [name=campaign_id]", "");
    await np.click("#lyr-rec [type=submit]"); await np.waitForTimeout(400);
    const errs = await np.evaluate(() => ({ alert: (document.querySelector("#lyr-rec [role=alert]") || {}).textContent || "", bad: [...document.querySelectorAll("#lyr-rec [aria-invalid=true]")].map((e) => e.name) }));
    np.off("request", onReq);
    t.ok(posted === 0 && /ID card/.test(errs.alert) && /campaign/.test(errs.alert) && /bought/.test(errs.alert) && errs.bad.length === 3, "all errors at once, nothing sent: " + JSON.stringify(errs));

    // ---- the classic screen opens on what the new one wrote ----
    await cp.goto("about:blank"); await t.open(cp, "classic", "loyalty", "loyalty", ".ly-tab[data-tab=clients]"); await cp.click(".ly-tab[data-tab=clients]");
    await cp.waitForSelector(`[data-cl="${padded}"]`, { timeout: 10000 });
    t.ok(/2 transactions/.test(await cp.textContent(`[data-cl="${padded}"]`)), "classic Clients shows the card with both purchases");

    // ---- Delete campaign and Remove card: the classic addresses ----
    const D = { id: "ly_case_del", name: "Delete me", type: "event", active: true, open_ended: true };
    await t.api("POST", "/loyalty/campaigns", D);
    await np.goto("about:blank"); await t.open(np, "2", "loyreg", "loyreg", "[data-act=view][data-v=campaigns]"); await np.click("[data-act=view][data-v=campaigns]");
    await np.click(`[data-act=del-camp][data-id="${D.id}"]`);
    t.ok(/Delete “Delete me”\?/.test(await np.textContent(".lyr-ask")), "the question names the campaign");
    const n5 = await body(np, "DELETE", /^\/loyalty\/campaigns\//, () => np.click("[data-act=del-camp-yes]"));
    t.ok(n5.path === "/loyalty/campaigns/" + D.id && !t.db.prepare("SELECT id FROM loyalty_campaigns WHERE id = ?").get(D.id), "campaign deleted: " + n5.path);
    await np.click("[data-act=view][data-v=cards]"); await np.waitForSelector("#lyr-q");
    await np.fill("#lyr-q", padded); await np.click(`[data-act=open][data-card="${padded}"]`);
    await np.waitForSelector(`[data-act=rm-card][data-card="${padded}"]`); await np.click(`[data-act=rm-card][data-card="${padded}"]`);
    const n6 = await body(np, "DELETE", /^\/loyalty\/clients\//, () => np.click("[data-act=rm-card-yes]"));
    t.ok(n6.path === "/loyalty/clients/" + padded && !t.db.prepare("SELECT COUNT(*) c FROM loyalty_transactions WHERE client_id_card = ?").get(padded).c, "card and its history removed: " + n6.path);

    // ---- rights: staff ----
    const app = t.stack.app;
    if (!t.stack.lyStaff) t.stack.lyStaff = await app.addUser({ email: "lystaff-" + Date.now() + "@demo.mt", role: "staff", name: "Karl Vella" }).catch(() => null);
    if (t.ok(t.stack.lyStaff, "a staff sign-in")) {
      const q = await t.page();
      await q.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, t.stack.lyStaff.token);
      await t.open(q, "2", "loyreg", "loyreg", "[data-act=view][data-v=campaigns]"); await q.click("[data-act=view][data-v=campaigns]");
      await q.waitForSelector("[data-act=toggle-camp]");
      t.ok(await q.locator("[data-act=del-camp]").count() === 0 && await q.locator("[data-act=edit-camp]").count() > 0, "staff: Edit and Pause, no Delete");
      t.ok(/for the pharmacist/.test(await q.textContent(".lyr-foot")), "staff footer says who deletes");
      const forb = await app.api("DELETE", "/loyalty/campaigns/" + P.id, { token: t.stack.lyStaff.token });
      t.ok(forb.status === 403, "the server refuses staff a delete (" + forb.status + ")");
    }
  }
};
