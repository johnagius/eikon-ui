// Customers -> a rebuilt screen (BACKLOG4 item 1): an order, a question and a delivery started on a customer's page
// (the form opens in the new layout with the person filled in) store exactly what the same screen stores when the same
// values are typed there; the person in Customers is left exactly as it was (no second person, no change).
import { ymd } from "../lib.mjs";
const P = { name: "Hili Żaren", id_card: "0889911M", phone: "79345678", address: "12 Triq il-Kbira, Ħaż-Żebbuġ" };
export default {
  title: "Customers carry a person into Orders, Questions and Deliveries",
  async run(t) {
    const made = await t.api("POST", "/people", P);
    if (!t.ok(made && made.ok && made.person, "person accepted by POST /people")) return;
    const pid = made.person.id, people = () => t.db.prepare("SELECT * FROM people WHERE id_card = ? OR name = ? ORDER BY id").all(P.id_card, P.name);
    const before = JSON.stringify(people());
    const p = await t.page();
    const fromPerson = async (go, form) => {
      await t.open(p, "2", "customers", "customers", "#cus-q");
      if (await p.locator(".cus-back").isVisible().catch(() => false)) await p.click(".cus-back");
      await p.fill("#cus-q", P.id_card); await p.waitForSelector(`[data-person="${pid}"]`); await p.click(`[data-person="${pid}"]`);
      await p.waitForSelector(`.cus-actions [data-go="${go}"]`); await p.click(`.cus-actions [data-go="${go}"]`);
      await p.waitForFunction((f) => { const n = document.querySelector(f + " [name=client_name]"); return n && n.value; }, form, { timeout: 15000 });
      t.ok(!(await p.evaluate(() => /ui=classic/.test(location.search))), go + ": opened in the new layout");
    };
    const fromScreen = async (hash, mod, form) => { await t.open(p, "2", hash, mod, "[data-act=add]"); await p.click("[data-act=add]"); await p.waitForSelector(form); };
    const cases = [
      ["order", "client_orders_entries", "ordreg", "#ord-add", /\/client-orders\/entries$/, { client_name: P.name, id_card: P.id_card, contact: P.phone }, { items: "Augmentin 625 x14", needed_by: ymd(2) }, { order_code: "none on either path" }],
      ["question", "client_tickets_entries", "tktreg", "#tkt-add", /\/client-tickets\/entries$/, { client_name: P.name, phone: P.phone }, { issue: "Is Panadol syrup back in stock?" }, { ticket_id: "the next number in the sequence" }],
      ["delivery", "client_deliveries", "dlvreg", "#dlv-add", /\/client-deliveries\/entries$/, { client_name: P.name, id_doc_ref: P.id_card, phone: P.phone, delivery_address: P.address }, { items: "Panadol, Augmentin 625" }, { delivery_id: "the next number in the sequence", delivery_log: "the time it was written" }],
    ];
    for (const [go, T, mod, form, re, carried, typed, allow] of cases) {
      let m = t.maxId(T);
      await fromScreen(mod, mod, form);
      await t.fill(p, form, { ...carried, ...typed });
      const a = await t.write(p, re, () => p.click(form + " [type=submit]"));
      const onScreen = t.since(T, m).filter((r) => r.client_name === P.name)[0]; // its own row: other cases write to these tables at the same time
      m = t.maxId(T);
      await fromPerson(go, form);
      const got = await p.evaluate(([f, ks]) => Object.fromEntries(ks.map((k) => [k, document.querySelector(f + " [name=" + k + "]").value])), [form, Object.keys(carried)]);
      t.ok(JSON.stringify(got) === JSON.stringify(carried), go + ": the person is filled in: " + JSON.stringify(got));
      await t.fill(p, form, typed);
      const b = await t.write(p, re, () => p.click(form + " [type=submit]"));
      const fromPage = t.since(T, m).filter((r) => r.client_name === P.name)[0];
      const strip = (o) => { const c = { ...(o || {}) }; Object.keys(allow).forEach((k) => delete c[k]); return JSON.stringify(c); };
      t.ok(strip(a.body) === strip(b.body), go + ": the same body is sent: " + strip(a.body) + " vs " + strip(b.body));
      t.same(go, onScreen, fromPage, allow);
    }
    t.ok(JSON.stringify(people()) === before, "the person in Customers is unchanged, and still one person");
  },
};
