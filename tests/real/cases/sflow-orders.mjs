// Orders (ordreg, Stock flows round 2): after deleting an order, its lines in the order diary come off too, as the
// classic screen's "Remove from Order Diary?" does: the same diary lines matched (each order line once, by name), the
// same DELETE calls with no body, and the same ORDER_DIARY audit entries. "Keep them" takes nothing off.
import { ymd } from "../lib.mjs";
import { audit, strip, writes } from "./_sfdel.mjs";
const D = "order_diary_entries", O = "client_orders_entries";
const order = (name, items) => ({ order_date: ymd(0), client_name: name, contact: "79111222", client_phone: "79111222", items, items_text: items, needed_by: ymd(3), pick_up_date: ymd(3), deposit: "", priority: 2, notes: "" });
const A = (rows) => rows.map((r) => ({ action: r.action, details: strip(JSON.parse(r.details_json || "null")) }));
export default {
  title: "Orders: a deleted order's lines come off the order diary, as classic",
  async run(t) {
    const p = await t.page();
    const seed = async (tag) => {
      const items = `SF ${tag} Ħ syrup 200ml\nSF ${tag} Panadol x24`;
      const om = t.maxId(O); const r = await t.api("POST", "/client-orders/entries", order("Twin Ġorġ " + tag, items));
      const o = { id: (r && r.id) || (t.since(O, om)[0] || {}).id };
      const m = t.maxId(D);
      for (const it of [`SF ${tag} Ħ syrup 200ml`, `sf ${tag} panadol x24 `, `SF ${tag} Panadol x24`, `SF ${tag} Not ordered`]) await t.api("POST", "/order-diary/entries", { order_date: ymd(0), item_name: it, qty: 1, supplier: "PharmaCo", notes: "" });
      return { id: o.id, diary: t.since(D, m).map((r) => r.id) };
    };
    const ca = await seed("Classic"), na = await seed("New"), au = t.maxId("audit_log");

    // classic: select the order, Delete, then "Yes, remove"
    await t.open(p, "classic", "clientorders", "clientorders", `tr[data-id='${ca.id}']`);
    await p.click(`tr[data-id='${ca.id}']`); await p.click("#co-sel-del");
    await t.write(p, new RegExp("^/client-orders/entries/" + ca.id + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "DELETE");
    await p.waitForFunction(() => /Remove from Order Diary/.test(document.body.innerText), null, { timeout: 8000 });
    const cReq = await writes(p, /order-diary/, async () => { await p.click("#eikon-modal-actions .eikon-btn.primary"); await p.waitForTimeout(400); await t.idle(p); });
    const cGone = ca.diary.filter((id) => !t.row(D, id));

    // new: open the order, Delete…, a reason, Delete order, then "Take off the diary"
    await t.open(p, "2", "clientorders", "ordreg", `[data-act=open][data-id="${na.id}"]`);
    await p.click(`[data-act=open][data-id="${na.id}"]`); await p.waitForSelector("#ord-edit");
    await p.click("#ord-edit [data-act=del]"); await p.fill("#ord-edit [name=del_reason]", "Entered twice");
    await t.write(p, new RegExp("^/client-orders/entries/" + na.id + "$"), () => p.click("#ord-edit [data-act=del-go]"), "DELETE");
    await p.waitForSelector("#ord-undiary");
    const q = await p.textContent("#ord-undiary");
    t.ok(/2 of its items are in the order diary for today\. Take them off the order diary too\?/.test(q) && /SF New Ħ syrup 200ml/.test(q), "the question names the lines found: " + q.replace(/\s+/g, " ").slice(0, 200));
    await p.waitForFunction(() => document.activeElement && document.activeElement.closest && document.activeElement.closest("#ord-undiary"), null, { timeout: 3000 }).then(() => t.ok(1), () => t.fail("focus is not on the question"));
    const nReq = await writes(p, /order-diary/, async () => { await p.click("#ord-undiary [type=submit]"); await p.waitForSelector("#ord-undiary", { state: "detached" }); await t.idle(p); });
    const nGone = na.diary.filter((id) => !t.row(D, id));

    const shape = (r) => JSON.stringify(r.filter((x) => x.m !== "GET").map((x) => x.m + " " + x.path.replace(/\d+/g, "#") + " " + (x.body == null ? "" : x.body)));
    t.ok(shape(cReq) === shape(nReq), "the same calls: classic " + shape(cReq) + " new " + shape(nReq));
    // the same lines by position: the first seeded line, and the first of the two Panadol spellings (each order line once)
    const pos = (s, gone) => gone.map((id) => s.diary.indexOf(id)).sort().join();
    t.ok(cGone.length === 2 && pos(ca, cGone) === pos(na, nGone), "the same lines off the diary: classic " + pos(ca, cGone) + " new " + pos(na, nGone));
    t.ok(t.row(D, na.diary[3]) && t.row(D, ca.diary[3]), "a line the order did not have stays");
    const norm = (x) => JSON.stringify(x).replace(/SF (Classic|New)/gi, "SF ·");
    const cA = cGone.flatMap((id) => A(audit(t, D, id, au))), nA = nGone.flatMap((id) => A(audit(t, D, id, au)));
    t.ok(cA.length === 2 && norm(cA) === norm(nA), "the same audit entries:\n classic " + norm(cA).slice(0, 300) + "\n new     " + norm(nA).slice(0, 300));
    t.ok(/taken off the order diary/.test(await p.evaluate(() => document.body.innerText)), "a quiet message");

    // Keep them: nothing comes off.
    const kp = await seed("Keep");
    await p.goto("about:blank"); await t.open(p, "2", "clientorders", "ordreg", `[data-act=open][data-id="${kp.id}"]`);
    await p.click(`[data-act=open][data-id="${kp.id}"]`); await p.waitForSelector("#ord-edit");
    await p.click("#ord-edit [data-act=del]"); await p.fill("#ord-edit [name=del_reason]", "Customer cancelled");
    await t.write(p, new RegExp("^/client-orders/entries/" + kp.id + "$"), () => p.click("#ord-edit [data-act=del-go]"), "DELETE");
    await p.waitForSelector("#ord-undiary"); await p.click("[data-act=undiary-no]"); await p.waitForTimeout(200);
    t.ok(kp.diary.every((id) => t.row(D, id)) && !(await p.$("#ord-undiary")), "Keep them: every diary line stays and the question closes");
    t.ok(!(await p.evaluate(() => !!document.querySelector(".ord [data-act=classic]"))), "the screen no longer sends this to the classic screen");
    t.ok(!t.row(O, ca.id) && !t.row(O, na.id), "both orders deleted");
  },
};
