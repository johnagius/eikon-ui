// Typing while a screen opens or redraws (a slow tablet, a slow line): every value lands in the field it was typed in,
// and the saved body is the body stored when the same values are typed slowly. A busy machine runs the screens'
// short timers late (input events go first), so the case runs every timer of 50 ms or less 300 ms late and holds the
// screen's own GETs back; the person clicks the second field at once and types at human speed.
// Paths: Customers edit; Deliveries change; a new Order, Question and Delivery opened by their button and from a
// customer's page; DDA supplied add; Repeat prescriptions new; End of day amount; Today reading.
import { ymd } from "../lib.mjs";

const LAG = 300, KEY = 70; // about 170 words a minute: a fast typist
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function racyPage(t, slowGet) {
  const p = await t.page();
  await p.addInitScript((lag) => {
    const st = window.setTimeout; window.__lag = 0;
    window.setTimeout = function (fn, d) { const a = Array.prototype.slice.call(arguments); if (window.__lag && typeof fn === "function" && (Number(d) || 0) <= 50) a[1] = (Number(d) || 0) + window.__lag; return st.apply(window, a); };
    window.__setLag = () => { window.__lag = lag; };
  }, LAG);
  if (slowGet) await p.route(slowGet, async (r) => { if (r.request().method() === "GET" && slowNow) await sleep(700); return r.fallback(); });
  return p;
}
let slowNow = false; // the screen's GETs are held back while the timers are late
const lag = (p) => { slowNow = true; return p.evaluate(() => window.__setLag()); };
const calm = (p) => { slowNow = false; return p.evaluate(() => { window.__lag = 0; }); };
// Click a field, select what is in it, type at human speed.
async function human(p, sel, text) { await p.click(sel); await p.keyboard.press("ControlOrMeta+A"); await p.keyboard.type(text, { delay: KEY }); }
const vals = (p, form, names) => p.evaluate(([f, ns]) => Object.fromEntries(ns.map((n) => { const e = document.querySelector(f + " [name=" + n + "]"); return [n, e ? e.value : "(missing)"]; })), [form, names]);
const strip = (o, drop) => { const c = { ...(o || {}) }; drop.forEach((k) => delete c[k]); return JSON.stringify(c); };

export default {
  title: "Typing while a screen opens or redraws: every value lands in its own field",
  async run(t) {
    const p = await racyPage(t, /\/(people|client-deliveries|client-orders|client-tickets|repeat-prescriptions|dda-sales|endofday|today|alerts)[^?]*(\?|$)/);

    // 1. Customers: Edit, then at once the Notes box.
    for (const [slow, name] of [[true, "Zammit Carmel"], [false, "Zammit Carmen"]]) {
      const made = await t.api("POST", "/people", { name, phone: slow ? "79000111" : "79000112", address: "3 Triq San Pawl, Rabat" });
      if (!t.ok(made && made.person, "customers: person made")) return;
      const id = made.person.id;
      await t.open(p, "2", "customers", "customers", "#cus-q");
      await p.fill("#cus-q", name); await p.waitForSelector(`[data-person="${id}"]`); await p.click(`[data-person="${id}"]`);
      await p.waitForSelector('#cus-detail [data-act="edit"]');
      if (!slow) await lag(p);
      await p.click('#cus-detail [data-act="edit"]');
      if (slow) await p.waitForTimeout(400);
      await human(p, "#cus-edit [name=notes]", "Prefers SMS");
      await p.waitForTimeout(LAG + 100);
      const v = await vals(p, "#cus-edit", ["name", "notes"]);
      t.ok(v.name === name && v.notes === "Prefers SMS", `customers edit (${slow ? "slow" : "racy"}): name ${JSON.stringify(v.name)}, notes ${JSON.stringify(v.notes)}`);
      const w = await t.write(p, /\/people$/, () => p.click("#cus-edit [data-act=save]"));
      t.note(`body customers edit ${slow ? "slow" : "racy"}: ${strip(w.body, ["id"])}`);
      t.ok(w.body && w.body.name === name && w.body.notes === "Prefers SMS" && w.body.phone === (slow ? "79000111" : "79000112"), `customers edit (${slow ? "slow" : "racy"}): saved ${JSON.stringify(w.body)}`);
      await calm(p);
    }

    // 2. Deliveries: open a delivery, at once the Time box; the month list arrives while typing.
    const DT = "client_deliveries";
    const seed = { delivery_id: "DEL-08001", order_date: ymd(-1), scheduled_date: ymd(0), scheduled_time_slot: "Afternoon", client_name: "Borġ Ċensina", phone: "79111222", email: "", delivery_address: "12 Triq il-Ħamrun, Żebbuġ", address_notes: "", id_doc_ref: "", delivery_method: "Courier", priority: 2, assigned_driver: "", tracking_number: "", status: "Scheduled", signature_required: 0, signature_obtained: 0, recipient_name: "", proof_of_delivery: "", delivery_attempts: 0, failure_reason: "", contains_controlled: 0, cold_chain_required: 0, ticket_ref: "", items: "[]", delivery_log: "[]", internal_notes: "" };
    const m0 = t.maxId(DT); await t.api("POST", "/client-deliveries/entries", seed); await t.api("POST", "/client-deliveries/entries", seed);
    const [da, db] = t.since(DT, m0).map((r) => r.id);
    const dbodies = [];
    for (const [slow, id] of [[true, da], [false, db]]) {
      await p.goto("about:blank");
      await t.open(p, "2", "deliveries", "dlvreg", `[data-act=open][data-id="${id}"]`);
      if (!slow) await lag(p); else await p.waitForTimeout(600);
      await p.click(`[data-act=open][data-id="${id}"]`);
      if (slow) await p.waitForTimeout(400);
      await human(p, "#dlv-edit [name=scheduled_time_slot]", "Evening");
      await p.waitForTimeout(LAG + 100);
      const v = await vals(p, "#dlv-edit", ["client_name", "scheduled_time_slot"]);
      t.ok(v.client_name === "Borġ Ċensina" && v.scheduled_time_slot === "Evening", `deliveries change (${slow ? "slow" : "racy"}): name ${JSON.stringify(v.client_name)}, time ${JSON.stringify(v.scheduled_time_slot)}`);
      const w = await t.write(p, new RegExp("/client-deliveries/entries/" + id + "$"), () => p.click("#dlv-edit button[type=submit]"), "PUT");
      dbodies.push(w.body); t.note(`body deliveries change ${slow ? "slow" : "racy"}: ${strip(w.body, ["id"])}`);
      await calm(p);
    }
    // batch 6 (W3): the second seeded row got the next number from the server, so delivery_id differs by design
    t.ok(strip(dbodies[0], ["id", "delivery_id"]) === strip(dbodies[1], ["id", "delivery_id"]), "deliveries change: the racy body is the slow body: " + strip(dbodies[0], ["id", "delivery_id"]) + " vs " + strip(dbodies[1], ["id", "delivery_id"]));
    t.same("deliveries change", t.row(DT, da), t.row(DT, db), { delivery_id: "batch 6 (W3): seeded twice with DEL-08001, the server gave the second DEL-08002" });

    // 3. New order, question, delivery: by the button, and from a customer's page; the second field at once.
    const P = { name: "Ħili Ġorġa", id_card: "0771122M", phone: "79222333", address: "7 Triq il-Wied, Qormi" };
    const made = await t.api("POST", "/people", P); const pid = made && made.person && made.person.id;
    const NEW = [
      { go: "order", mod: "ordreg", form: "#ord-add", re: /\/client-orders\/entries$/, second: "contact", text: "79222333", rest: { client_name: P.name, items: "Augmentin 625 x14", needed_by: ymd(2) }, check: ["client_name", "contact", "items"], drop: [], carrySecond: "items", carryText: "Augmentin 625 x14" },
      { go: "question", mod: "tktreg", form: "#tkt-add", re: /\/client-tickets\/entries$/, second: "phone", text: "79222333", rest: { client_name: P.name, issue: "Is Panadol syrup back in stock?" }, check: ["client_name", "phone", "issue"], drop: ["ticket_id"], carrySecond: "issue", carryText: "Is Panadol syrup back in stock?" },
      { go: "delivery", mod: "dlvreg", form: "#dlv-add", re: /\/client-deliveries\/entries$/, second: "phone", text: "79222333", rest: { client_name: P.name, delivery_address: P.address, items: "Panadol" }, check: ["client_name", "phone", "delivery_address"], drop: ["delivery_id", "delivery_log"], carrySecond: "items", carryText: "Panadol" },
    ];
    for (const c of NEW) {
      const bodies = [];
      for (const slow of [true, false]) {
        await p.goto("about:blank");
        await t.open(p, "2", c.mod, c.mod, "[data-act=add]");
        await p.waitForTimeout(600);
        if (!slow) await lag(p);
        await p.click("[data-act=add]"); await p.waitForSelector(c.form);
        if (slow) await p.waitForTimeout(400);
        await human(p, c.form + " [name=" + c.second + "]", c.text);
        await p.waitForTimeout(LAG + 100);
        await calm(p);
        const v1 = await vals(p, c.form, [c.second, "client_name"]);
        t.ok(v1[c.second] === c.text && v1.client_name === "", `${c.go} new (${slow ? "slow" : "racy"}): ${c.second} ${JSON.stringify(v1[c.second])}, name ${JSON.stringify(v1.client_name)}`);
        await t.fill(p, c.form, c.rest);
        const w = await t.write(p, c.re, () => p.click(c.form + " [type=submit]"));
        bodies.push(w.body); t.note(`body ${c.go} new ${slow ? "slow" : "racy"}: ${strip(w.body, c.drop)}`);
      }
      t.ok(strip(bodies[0], c.drop) === strip(bodies[1], c.drop), `${c.go} new: the racy body is the slow body: ${strip(bodies[0], c.drop)} vs ${strip(bodies[1], c.drop)}`);
      // from the customer's page: the person is filled in; the person clicks the next empty field and types
      const cb = [];
      for (const slow of [true, false]) {
        await t.open(p, "2", "customers", "customers", "#cus-q");
        if (await p.locator(".cus-back").isVisible().catch(() => false)) await p.click(".cus-back");
        await p.fill("#cus-q", P.id_card); await p.waitForSelector(`[data-person="${pid}"]`); await p.click(`[data-person="${pid}"]`);
        await p.waitForSelector(`.cus-actions [data-go="${c.go}"]`);
        if (!slow) await lag(p);
        await p.click(`.cus-actions [data-go="${c.go}"]`);
        await p.waitForFunction((f) => { const n = document.querySelector(f + " [name=client_name]"); return n && n.value; }, c.form, { timeout: 15000 });
        if (slow) await p.waitForTimeout(500);
        await human(p, c.form + " [name=" + c.carrySecond + "]", c.carryText);
        await p.waitForTimeout(LAG + 100);
        await calm(p);
        const v2 = await vals(p, c.form, c.check.concat([c.carrySecond]));
        t.ok(v2.client_name === P.name && v2[c.carrySecond] === c.carryText, `${c.go} from a customer (${slow ? "slow" : "racy"}): ${JSON.stringify(v2)}`);
        const more = { ...c.rest }; delete more.client_name; delete more[c.carrySecond]; if (Object.keys(more).length) await t.fill(p, c.form, more);
        const w = await t.write(p, c.re, () => p.click(c.form + " [type=submit]"));
        cb.push(w.body); t.note(`body ${c.go} from a customer ${slow ? "slow" : "racy"}: ${strip(w.body, c.drop)}`);
      }
      t.ok(strip(cb[0], c.drop) === strip(cb[1], c.drop), `${c.go} from a customer: the racy body is the slow body: ${strip(cb[0], c.drop)} vs ${strip(cb[1], c.drop)}`);
    }

    // 4. DDA supplied and Repeat prescriptions: New, then at once the patient's name; the month list arrives meanwhile.
    const FORMS = [
      { name: "dda supplied", hash: "dda-sales", mod: "cdsreg", form: "#cds-add", second: "client_name", text: "Mifsud Rose" },
      { name: "repeat prescriptions", hash: "repreg", mod: "repreg", form: "#rep-add", second: "client_name", text: "Mifsud Rose" },
    ];
    for (const c of FORMS) {
      await p.goto("about:blank");
      await t.open(p, "2", c.hash, c.mod, "[data-act=add]");
      await lag(p);
      await p.click("[data-act=add]"); await p.waitForSelector(c.form);
      await human(p, c.form + " [name=" + c.second + "]", c.text);
      await p.waitForTimeout(LAG + 900);
      const v = await p.evaluate(([f, n]) => ({ all: Array.from(document.querySelectorAll(f + " input")).filter((e) => e.value && e.type !== "date" && e.type !== "checkbox" && e.type !== "hidden").map((e) => e.name + "=" + e.value), at: document.activeElement && document.activeElement.name, v: (document.querySelector(f + " [name=" + n + "]") || {}).value }), [c.form, c.second]);
      t.ok(v.v === c.text && v.all.length === 1, `${c.name}: typed into ${c.second}, the form holds ${JSON.stringify(v.all)}, focus on ${v.at}`);
      await calm(p);
    }

    // 4b. A screen opened with its form (a customer's page or the search hands over "new", E.takeOpenForm): the person
    // starts typing in the screen's search while it is still opening; the form must not open over the search and take it.
    await p.goto("about:blank");
    await t.open(p, "2", "repreg", "repreg", "#rep-q"); await p.goto("about:blank");
    await p.goto(t.base + "?ui=2#today"); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "today", null, { timeout: 20000 });
    await lag(p);
    await p.evaluate(() => { window.EIKON.customerHandoff("repreg", "new", { name: "Mifsud Rose" }, ""); location.hash = "#repreg"; });
    await p.waitForSelector("#rep-q");
    await human(p, "#rep-q", "Atorvastatin");
    await p.waitForTimeout(LAG + 1500);
    const hv = await p.evaluate(() => ({ q: document.querySelector("#rep-q") && document.querySelector("#rep-q").value, at: document.activeElement && (document.activeElement.id || document.activeElement.name || document.activeElement.tagName), cid: (document.querySelector("#rep-add [name=client_id]") || {}).value || "" }));
    t.ok(hv.q === "Atorvastatin" && hv.at === "rep-q" && !/torv/i.test(hv.cid), "repeat prescriptions opened with its form: typing in the search while it opened stays in the search: " + JSON.stringify(hv));
    await calm(p);
    // and with nobody typing, the form still opens with the person filled in and the cursor in the first empty field
    await p.goto("about:blank"); await p.goto(t.base + "?ui=2#today"); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "today", null, { timeout: 20000 });
    await p.evaluate(() => { window.EIKON.customerHandoff("repreg", "new", { name: "Mifsud Rose" }, ""); location.hash = "#repreg"; });
    await p.waitForSelector("#rep-add", { timeout: 10000 }).catch(() => {}); await p.waitForTimeout(600);
    const hn = await p.evaluate(() => ({ name: (document.querySelector("#rep-add [name=client_name]") || {}).value, at: document.activeElement && document.activeElement.name }));
    t.ok(hn.name === "Mifsud Rose" && hn.at === "client_id", "repeat prescriptions opened with its form, nobody typing: person filled in, cursor on the ID card: " + JSON.stringify(hn));

    // 4c. Alerts: New alert while the list is still arriving; the two lists (Type, Kept in) and a text field are set, then
    // the person taps outside the form (focus leaves it) and the list arrives: every field keeps what the person set.
    await p.goto("about:blank");
    await t.open(p, "2", "alertreg", "alertreg", "[data-act=add]"); await p.goto("about:blank");
    await lag(p);
    await p.goto(t.base + "?ui=2#alertreg"); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "alertreg", null, { timeout: 20000 });
    await p.click("[data-act=add]"); await p.waitForSelector("#alr-add");
    await p.selectOption("#alr-add [name=alert_type]", "quarantine"); await p.selectOption("#alr-add [name=storage_location]", "fridge");
    await human(p, "#alr-add [name=item_name]", "Valsartan 80mg");
    await p.click(".alr-sub"); // a tap on the page, outside the form
    await p.waitForTimeout(LAG + 1500);
    const av = await vals(p, "#alr-add", ["alert_type", "storage_location", "item_name"]);
    t.ok(av.alert_type === "quarantine" && av.storage_location === "fridge" && av.item_name === "Valsartan 80mg", "alerts: what was set in the new alert survives the list arriving: " + JSON.stringify(av));
    await calm(p);

    // 4d. A barcode scanner (keys a few ms apart, then Enter) into Today's box and onto the page while Today is still
    // reading its data and its timers run late: every scan is read whole and opens the person (nothing split or lost).
    const scans = [];
    for (let i = 0; i < 6; i++) {
      await p.goto("about:blank");
      await lag(p);
      await p.goto(t.base + "?ui=2#today"); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "today" && document.querySelector("#tdy-q"), null, { timeout: 20000 });
      await p.evaluate(() => { window.EIKON._lastScan = null; });
      if (i % 2) await p.click("#tdy-q"); else await p.evaluate(() => { document.activeElement && document.activeElement.blur && document.activeElement.blur(); });
      await p.keyboard.type("0012345M", { delay: 4 }); await p.keyboard.press("Enter");
      const ok = await p.waitForFunction(() => window.EIKON.state.activeModuleId === "customers", null, { timeout: 8000 }).then(() => true, () => false);
      const sc = await p.evaluate(() => window.EIKON._lastScan && window.EIKON._lastScan.code);
      scans.push((i % 2 ? "box:" : "page:") + sc + (ok ? "" : " (not opened)"));
      await calm(p);
    }
    t.ok(scans.every((x) => /:0012345M$/.test(x)), "scanner on Today while it opens: every scan read whole and opened the person: " + scans.join(", "));

    // 5. End of day: the day is still opening; the X reading is typed the moment the form shows.
    await p.goto("about:blank");
    await lag(p);
    await t.open(p, "2", "endofday", "eodreg", "#eod-form [name=\"row:x:0:amount\"]");
    await human(p, '#eod-form [name="row:x:0:amount"]', "1250.40"); await p.keyboard.press("Tab"); await p.keyboard.type("Main till", { delay: KEY });
    await p.waitForTimeout(LAG + 900);
    const ev = await vals(p, "#eod-form", ['"row:x:0:amount"', '"row:x:0:remark"', "staff"]);
    t.ok(ev['"row:x:0:amount"'] === "1250.40" && ev['"row:x:0:remark"'] === "Main till", "end of day: typed while the day opened: " + JSON.stringify(ev));
    await calm(p);

    // 6. Today: Log the first fridge, and type the second one's reading at once, while Today reloads.
    await p.goto("about:blank");
    await t.open(p, "2", "today", "today", ".tdy-head h1");
    const rows = p.locator(".tdy-row[data-kind=temperature]:has(input[data-min])");
    if (await rows.count() >= 2) {
      const d2 = await rows.nth(1).getAttribute("data-device");
      // the first reading is answered here and not stored: the other cases log today's readings in the same database
      await p.route(/\/temperature\/entries$/, (r) => r.request().method() === "POST" ? r.fulfill({ status: 200, contentType: "application/json", body: '{"ok":true}' }) : r.fallback());
      await lag(p);
      await rows.nth(0).locator("[data-min]").click(); await p.keyboard.type("3.2", { delay: KEY }); await p.keyboard.press("Tab"); await p.keyboard.type("6.9", { delay: KEY });
      await p.keyboard.press("Enter");
      const r2 = `.tdy-row[data-kind=temperature][data-device="${d2}"]`;
      await p.click(r2 + " [data-min]"); await p.keyboard.type("2.5", { delay: KEY }); await p.keyboard.press("Tab"); await p.keyboard.type("7.1", { delay: KEY });
      await p.waitForTimeout(LAG + 1200);
      const tv = await p.evaluate((s) => { const r = document.querySelector(s); return r ? { min: (r.querySelector("[data-min]") || {}).value, max: (r.querySelector("[data-max]") || {}).value, at: document.activeElement && (document.activeElement.hasAttribute("data-max") ? "max" : document.activeElement.hasAttribute("data-min") ? "min" : document.activeElement.tagName) } : null; }, r2);
      t.ok(tv && tv.min === "2.5" && tv.max === "7.1", "today: the second fridge typed while Today reloaded after the first was logged: " + JSON.stringify(tv));
      await calm(p);
    } else t.note("today: fewer than two fridges to log; not tried");
  },
};
