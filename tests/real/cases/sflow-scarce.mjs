// Shortages (ssreg, Stock flows round 2): your request's Change, Close request and Delete, and withdrawing your offer,
// closed out of the classic screen. Twin rows; the classic Request stock tab acts on one, the new screen on the other:
// the same PUT body (key order and values) or DELETE with no body, the same rows after, the same audit entries.
import { ymd } from "../lib.mjs";
import { twinDelete, audit, strip } from "./_sfdel.mjs";
const N = "scarce_stock_needs", NO = "scarce_stock_need_offers";
const A = (rows) => JSON.stringify(rows.map((r) => ({ action: r.action, details: strip(JSON.parse(r.details_json || "null")) })));
const need = (item) => ({ entry_date: ymd(-2), item_name: item, quantity_needed: 6, needed_by: ymd(5), description: "For a regular, Ħal Qormi" });
export default {
  title: "Shortages: change, close, delete a request and withdraw an offer, as classic",
  async run(t) {
    const p = await t.page();
    const twins = async (item, token) => { const m = t.maxId(N); for (let i = 0; i < 2; i++) await t.stack.app.api("POST", "/scarce-stock/needs", { token: token || t.token, body: need(item) }); return t.since(N, m, { item_name: item }).map((r) => r.id); };
    const classicNeeds = async (item) => {
      await p.goto("about:blank"); await t.open(p, "classic", "scarcestock", "scarcestock", "#ss-tab-needs");
      await p.click("#ss-tab-needs"); await p.waitForSelector(`#ss-needs-body tr:has-text("${item}")`); await t.idle(p);
    };
    const openNew = async (sel) => { await p.goto("about:blank"); await t.open(p, "2", "ssreg", "ssreg", sel); };
    // the twin the classic changed is the one whose row moved; the new screen then takes the other
    const changedOf = (ids, was) => ids.filter((id) => JSON.stringify(t.row(N, id)) !== was[id]);

    // 1. Change: how many, needed by, note.
    let ids = await twins("Twin Need Change Ozempic 1mg");
    let was = Object.fromEntries(ids.map((id) => [id, JSON.stringify(t.row(N, id))])), au = t.maxId("audit_log");
    await classicNeeds("Twin Need Change Ozempic 1mg");
    await p.locator(`#ss-needs-body tr:has-text("Twin Need Change Ozempic 1mg") button:has-text("Edit")`).first().click(); await p.waitForSelector("#ss-need-qty");
    await p.fill("#ss-need-qty", "3"); await p.fill("#ss-need-neededby", ymd(9)); await p.fill("#ss-need-desc", "Two pens are enough, Żebbuġ");
    const cw = await t.write(p, /^\/scarce-stock\/needs\/\d+$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    let [a] = changedOf(ids, was), b = ids.find((id) => id !== a);
    const ca = audit(t, N, a, au); au = t.maxId("audit_log");
    if (t.ok(a && b, "change: the classic changed one twin")) {
      await openNew(`[data-act=edit][data-id="${b}"]`);
      await p.click(`[data-act=edit][data-id="${b}"]`); await p.waitForSelector("#ssr-edit");
      await t.fill(p, "#ssr-edit", { quantity_needed: "3", needed_by: ymd(9), description: "Two pens are enough, Żebbuġ" });
      const nw = await t.write(p, new RegExp("^/scarce-stock/needs/" + b + "$"), () => p.click("#ssr-edit button[type=submit]"), "PUT");
      t.ok(JSON.stringify(nw.body) === JSON.stringify(cw.body), "change: the classic Edit request body:\n classic " + JSON.stringify(cw.body) + "\n new     " + JSON.stringify(nw.body));
      t.has("change(new)", t.row(N, b), { quantity_needed: 3, needed_by: ymd(9), description: "Two pens are enough, Żebbuġ", is_closed: 0 });
      t.same("change", t.row(N, a), t.row(N, b));
      t.ok(A(ca) === A(audit(t, N, b, au)) && ca.length === 1, "change: the same audit entry");
      await p.waitForFunction((id) => document.activeElement && document.activeElement.getAttribute("data-act") === "edit" && document.activeElement.getAttribute("data-id") === String(id), b, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("change: focus is not back on Change"));
    }

    // 2. Close request (classic: Edit, Status Closed, Save).
    ids = await twins("Twin Need Close Shingrix");
    was = Object.fromEntries(ids.map((id) => [id, JSON.stringify(t.row(N, id))])); au = t.maxId("audit_log");
    await classicNeeds("Twin Need Close Shingrix");
    await p.locator(`#ss-needs-body tr:has-text("Twin Need Close Shingrix") button:has-text("Edit")`).first().click(); await p.waitForSelector("#ss-need-closed");
    await p.selectOption("#ss-need-closed", "1");
    const cc = await t.write(p, /^\/scarce-stock\/needs\/\d+$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    [a] = changedOf(ids, was); b = ids.find((id) => id !== a);
    const cca = audit(t, N, a, au); au = t.maxId("audit_log");
    if (t.ok(a && b, "close: the classic closed one twin")) {
      await openNew(`[data-act=close][data-id="${b}"]`);
      await p.click(`[data-act=close][data-id="${b}"]`);
      t.ok(/Close your request for Twin Need Close Shingrix\? It comes off every pharmacy's list\./.test(await p.evaluate(() => document.body.innerText)), "close: one plain question");
      t.ok(t.row(N, b).is_closed === 0, "close: nothing saved before the answer");
      const nc = await t.write(p, new RegExp("^/scarce-stock/needs/" + b + "$"), () => p.click(`[data-act=close-go][data-id="${b}"]`), "PUT");
      t.ok(JSON.stringify(nc.body) === JSON.stringify(cc.body), "close: the classic body:\n classic " + JSON.stringify(cc.body) + "\n new     " + JSON.stringify(nc.body));
      t.same("close", t.row(N, a), t.row(N, b));
      t.ok(A(cca) === A(audit(t, N, b, au)), "close: the same audit entry");
      await t.idle(p);
      t.ok(!(await p.locator(`[data-act=edit][data-id="${b}"]`).count()), "close: the request leaves the list");
    }

    // 3. Delete.
    ids = await twins("Twin Need Delete Ventolin");
    // the classic deletes the first row it shows; which twin that is is known only after (pick)
    await twinDelete(t, p, {
      label: "delete request", table: N, entity: N, action: "SCARCE_NEED_DELETE", a: ids[0], b: ids[1], path: () => /^\/scarce-stock\/needs\/\d+$/,
      classic: async (p) => { await classicNeeds("Twin Need Delete Ventolin"); await p.locator(`#ss-needs-body tr:has-text("Twin Need Delete Ventolin") button:has-text("Delete")`).first().click(); await p.click("#eikon-modal-actions .eikon-btn.primary"); },
      fresh: async (p) => {
        const left = ids.find((id) => t.row(N, id));
        await openNew(`[data-act=del][data-id="${left}"]`);
        await p.click(`[data-act=del][data-id="${left}"]`);
        t.ok(/Delete your request for Twin Need Delete Ventolin\? Its offers are deleted too\. This cannot be undone\./.test(await p.evaluate(() => document.body.innerText)), "delete request: the question names it");
        await p.click(`[data-act=del-go][data-id="${left}"]`);
      },
      pick: true,
    });

    // 4. Withdraw an offer on another pharmacy's request.
    t.db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (77, 1, 'Ħamrun Branch')").run();
    const br = t.stack.branch || (t.stack.branch = await t.stack.app.addUser({ email: "branch-sflow@demo.mt", role: "admin", name: "Bea Branch", locationId: 77 }).catch(() => null));
    if (t.ok(br, "a branch pharmacy that asks")) {
      const [x, y] = await twins("Twin Need Withdraw Ħ Insulin", br.token);
      const om = t.maxId(NO);
      for (const id of [x, y]) await t.api("POST", "/scarce-stock/needs/" + id + "/offers", { quantity_offered: 2, note: "Twin" });
      const [oa, ob] = [x, y].map((id) => t.since(NO, om, { need_id: id })[0]?.id);
      if (t.ok(oa && ob, "two twin offers")) await twinDelete(t, p, {
        label: "withdraw offer", table: NO, entity: NO, a: oa, b: ob, path: () => /^\/scarce-stock\/need-offers\/\d+$/, pick: true,
        norm: (j) => j.replace(/"need_id":\d+/, '"need_id":"(its own request)"'),
        classic: async (p, id) => {
          await classicNeeds("Twin Need Withdraw Ħ Insulin");
          // open the offers under the row of this offer's request (the rows carry no id: try each)
          const rows = p.locator(`#ss-needs-body tr:has-text("Twin Need Withdraw Ħ Insulin")`);
          const n = await rows.count();
          for (let i = 0; i < n; i++) {
            await rows.nth(i).locator('button:has-text("Offers")').click();
            const del = p.locator('.ss-subpanel button:has-text("Delete")');
            if (await del.count()) { await del.first().click(); await p.click("#eikon-modal-actions .eikon-btn.primary"); return; }
          }
          t.fail("classic: no offer to delete");
        },
        fresh: async (p) => {
          const id = [oa, ob].find((o) => t.row(NO, o));
          await openNew(`[data-act=wd][data-id="${id}"]`);
          await p.click(`[data-act=wd][data-id="${id}"]`);
          t.ok(/Withdraw your offer of 2\?/.test(await p.evaluate(() => document.body.innerText)), "withdraw offer: one plain question");
          await p.click(`[data-act=wd-go][data-id="${id}"]`);
        },
      });
    }
    t.ok(!/changing or closing a request/.test(await p.evaluate(() => document.body.innerText)), "the footnote no longer sends changing or closing a request to the classic screen");
  },
};
