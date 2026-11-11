// Transfers (trfreg, Stock flows round 2): the owner's offer actions and withdrawing a request, closed out of the
// classic screen. Twin offers / twin requests; the classic detail panel acts on one, the new screen on the other: the
// same call (no body), the same rows after and the same audit entries.
import { ymd } from "../lib.mjs";
import { twinDelete, writes, audit, strip } from "./_sfdel.mjs";
const IT = "stock_transfer_items", RQ = "stock_transfer_requests";
const A = (rows) => JSON.stringify(rows.map((r) => ({ action: r.action, details: strip(JSON.parse(r.details_json || "null")) })));
const offerBody = (desc) => ({ entry_date: ymd(0), item_description: desc, quantity_available: 5, batch: "TB-Ż1", expiry_date: ymd(120) });
export default {
  title: "Transfers: remove, to Returns, to Scarce stock, withdraw a request, as classic",
  async run(t) {
    const p = await t.page();
    // The worker's place-on-returns / place-on-scarce-stock write those tables without creating them first (a fresh
    // database only: a pharmacy that has opened Returns or Scarce stock has them). Open them once, as a pharmacy would.
    await t.api("GET", "/returns/entries?open=1"); await t.api("GET", "/scarce-stock/needs");
    const twins = async (desc, token) => { const m = t.maxId(IT); for (let i = 0; i < 2; i++) await t.stack.app.api("POST", "/stock-transfers/items", { token: token || t.token, body: offerBody(desc) }); return t.since(IT, m, { item_description: desc }).map((r) => r.id); };
    // classic: open the row whose detail panel carries this id's buttons
    const classicPick = async (desc, id, sel) => {
      await p.goto("about:blank"); await t.open(p, "classic", "stocktransfers", "stocktransfers", `#st-tbody tr:has-text("${desc}")`);
      const rows = p.locator(`#st-tbody tr:has-text("${desc}")`);
      for (let i = 0; i < await rows.count(); i++) { await rows.nth(i).click(); await p.waitForTimeout(60); if (await p.locator(sel).count()) return true; if (await p.locator("[data-action]").count()) await rows.nth(i).click(); }
      t.fail("classic: " + sel + " not found"); return false;
    };
    const openMore = async (id) => {
      await p.goto("about:blank"); await t.open(p, "2", "trfreg", "trfreg", `[data-act=more][data-id="${id}"]`);
      await p.click(`[data-act=more][data-id="${id}"]`); await p.waitForSelector(".trf-more");
    };

    // 1. Remove from Transfer.
    let [a, b] = await twins("Twin Transfer Remove Ħ Omeprazole");
    await twinDelete(t, p, {
      label: "remove offer", table: IT, entity: IT, action: "STOCK_TRANSFER_DELETE", a, b, path: (id) => new RegExp("^/stock-transfers/items/" + id + "$"),
      classic: async (p, id) => { await classicPick("Twin Transfer Remove Ħ Omeprazole", id, `[data-action=st-delete-item][data-id="${id}"]`); await p.click(`[data-action=st-delete-item][data-id="${id}"]`); await p.click("#eikon-modal-actions .eikon-btn.primary"); },
      fresh: async (p, id) => {
        await openMore(id);
        t.ok(await p.getAttribute(`[data-act=more][data-id="${id}"]`, "aria-expanded") === "true", "remove offer: the item says it is open");
        await p.click(".trf-more [data-act=remove]");
        t.ok(/Remove Twin Transfer Remove Ħ Omeprazole from transfers\? Requests still waiting are cancelled/.test(await p.textContent(".trf-more")), "remove offer: one plain question");
        await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "ask-cancel", null, { timeout: 2000 }).then(() => t.ok(1), () => t.fail("remove offer: the question opens on Keep it"));
        await p.click(".trf-more [data-act=remove-go]");
      },
    });

    // 2. Place on Returns: the classic POST (no body); the same transfer row and the same new return.
    [a, b] = await twins("Twin Transfer Returns Ċetirizine");
    const RT = "returns_entries";
    let rm = t.maxId(RT), au = t.maxId("audit_log");
    await classicPick("Twin Transfer Returns Ċetirizine", a, `[data-action=st-place-returns][data-id="${a}"]`);
    const cReq = await writes(p, /stock-transfers/, async () => { await t.write(p, new RegExp("^/stock-transfers/items/" + a + "/place-on-returns$"), () => p.click(`[data-action=st-place-returns][data-id="${a}"]`)); });
    const cRet = t.since(RT, rm, { description: "Twin Transfer Returns Ċetirizine" }); const ca = audit(t, IT, a, au);
    rm = t.maxId(RT); au = t.maxId("audit_log");
    await openMore(b);
    const nReq = await writes(p, /stock-transfers/, async () => { await t.write(p, new RegExp("^/stock-transfers/items/" + b + "/place-on-returns$"), () => p.click(`.trf-more [data-act=to-returns][data-id="${b}"]`)); await t.idle(p); });
    const nRet = t.since(RT, rm, { description: "Twin Transfer Returns Ċetirizine" });
    const shape = (r) => JSON.stringify(r.map((x) => x.m + " " + x.path.replace(/\d+/g, "#") + " " + (x.body == null ? "" : x.body)));
    t.ok(shape(cReq) === shape(nReq), "to Returns: the same call: classic " + shape(cReq) + " new " + shape(nReq));
    t.ok(cRet.length === 1 && nRet.length === 1, "to Returns: one return each (" + cRet.length + "/" + nRet.length + ")");
    t.same("to Returns (return)", cRet[0], nRet[0], { created_by: "", updated_by: "" });
    const ia = { ...t.row(IT, a) }, ib = { ...t.row(IT, b) }; delete ia.placed_on_returns_id; delete ib.placed_on_returns_id;
    t.same("to Returns (offer)", ia, ib);
    t.ok(A(ca) === A(audit(t, IT, b, au)) || A(ca).replace(/"returns_id":\d+/g, "") === A(audit(t, IT, b, au)).replace(/"returns_id":\d+/g, ""), "to Returns: the same audit entry");
    await p.waitForSelector(`[data-act=more][data-id="${b}"]`);
    t.ok(/On Returns/.test(await p.evaluate((id) => document.querySelector(`[data-act=more][data-id="${id}"]`).closest(".trf-row").textContent, b)), "to Returns: the offer says it is on Returns");
    t.ok(await p.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act")) === "more", "to Returns: focus stays on the offer");

    // 3. Place on Scarce Stock.
    [a, b] = await twins("Twin Transfer Scarce Żinc cream");
    const SO = "scarce_stock_offers";
    let sm = t.maxId(SO);
    await classicPick("Twin Transfer Scarce Żinc cream", a, `[data-action=st-place-scarce][data-id="${a}"]`);
    await t.write(p, new RegExp("^/stock-transfers/items/" + a + "/place-on-scarce-stock$"), () => p.click(`[data-action=st-place-scarce][data-id="${a}"]`));
    const cS = t.since(SO, sm, { item_name: "Twin Transfer Scarce Żinc cream" }); sm = t.maxId(SO);
    await openMore(b);
    const w3 = await t.write(p, new RegExp("^/stock-transfers/items/" + b + "/place-on-scarce-stock$"), () => p.click(`.trf-more [data-act=to-scarce][data-id="${b}"]`));
    const nS = t.since(SO, sm, { item_name: "Twin Transfer Scarce Żinc cream" });
    t.ok(w3.body == null, "to Scarce stock: no body, as classic");
    t.ok(cS.length === 1 && nS.length === 1, "to Scarce stock: one offer each");
    const sa = { ...cS[0] }, sb = { ...nS[0] }; delete sa.transfer_item_id; delete sb.transfer_item_id;
    t.same("to Scarce stock (offer)", sa, sb);
    const ja = { ...t.row(IT, a) }, jb = { ...t.row(IT, b) }; delete ja.placed_on_scarce_stock_id; delete jb.placed_on_scarce_stock_id;
    t.same("to Scarce stock (transfer)", ja, jb);

    // 4. Withdraw a request on another pharmacy's offer (a branch in the same group).
    t.db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (77, 1, 'Ħamrun Branch')").run();
    const br = t.stack.branch || (t.stack.branch = await t.stack.app.addUser({ email: "branch-sflow@demo.mt", role: "admin", name: "Bea Branch", locationId: 77 }).catch((e) => { t.note("branch: " + e.message); return null; }));
    if (t.ok(br, "a branch pharmacy to ask")) {
      const [x, y] = await twins("Twin Transfer Ask Ventolin", br.token);
      const rqm = t.maxId(RQ);
      for (const id of [x, y]) await t.api("POST", "/stock-transfers/items/" + id + "/requests", { quantity_requested: 2, note: "Twin" });
      const [ra, rb] = [x, y].map((id) => t.since(RQ, rqm, { item_id: id })[0]?.id);
      if (t.ok(ra && rb, "two twin requests")) await twinDelete(t, p, {
        label: "withdraw", table: RQ, entity: RQ, action: "STOCK_TRANSFER_REQUEST_DELETE", a: ra, b: rb, path: (id) => new RegExp("^/stock-transfers/requests/" + id + "$"),
        classic: async (p, id) => { await classicPick("Twin Transfer Ask Ventolin", id, `[data-action=st-cancel-req][data-id="${id}"]`); await p.click(`[data-action=st-cancel-req][data-id="${id}"]`); await p.click("#eikon-modal-actions .eikon-btn.primary"); },
        fresh: async (p, id) => {
          await p.goto("about:blank"); await t.open(p, "2", "trfreg", "trfreg", `[data-act=wd][data-rq="${id}"]`);
          await p.click(`[data-act=wd][data-rq="${id}"]`);
          t.ok(/Withdraw your request for 2 Twin Transfer Ask Ventolin\?/.test(await p.evaluate(() => document.body.innerText)), "withdraw: one plain question");
          await p.click(`[data-act=wd-go][data-rq="${id}"]`);
        },
        also: async (t, a, b) => t.ok(t.row(IT, x) && t.row(IT, y), "withdraw: the branch's offers stay"),
        norm: (j) => j.replace(/"item_id":\d+/, '"item_id":"(its own offer)"'),
      });
    }
    await p.waitForFunction(() => document.activeElement && document.activeElement.closest && document.activeElement.closest(".trf"), null, { timeout: 4000 }).then(() => t.ok(1), () => t.fail("withdraw: focus is lost"));
  },
};
