// Nothing typed is lost when you leave a form (BACKLOG5 item 2, q5-2, core.js E.draft). For a new order, a controlled
// drug sale, a question and an order-diary item: the same values typed straight through and saved, then typed, left
// (Back, the tab bar, a hub, the address bar), given back on return and saved, send byte-identical bodies and store
// the same row. No draft survives a save or a Cancel. Typing during the restore stays where it was typed. Nothing is
// sent while a draft is kept or given back. A new one begun while the screen opens is never merged with the draft.
import { ymd } from "../lib.mjs";
const KEY = "eikon_draft_v1|";
const drafts = (p) => p.evaluate((k) => Object.keys(sessionStorage).filter((x) => x.indexOf(k) === 0), KEY);
const FORMS = [
  { id: "ordreg", btn: ".ord-top [data-act=add]", form: "#ord-add", table: "client_orders_entries", path: /\/client-orders\/entries$/, gen: ["order_code"],
    fill: { client_name: "Draft Ċensina Borg", contact: "79001122", items: "Augmentin 625 x14 ċġħż", notes: "Ring first", needed_by: ymd(2) }, sel: { priority: "1" }, leave: "back" },
  { id: "cdsreg", btn: "[data-act=add]", form: "#cds-add", table: "dda_sales_entries", path: /\/dda-sales\/entries$/, gen: [],
    fill: { entry_date: ymd(0), client_id_card: "778899M", client_name: "Draft Ġorġ Zammit", client_address: "9 Triq il-Ġnien, Żebbuġ", doctor_name: "Dr Scicluna", doctor_reg_no: "R7788", prescription_serial_no: "RX-DRAFT-1", '#cds-add [data-i="0"][data-k=medicine_name_dose]': "Morphine 10mg tablets", '#cds-add [data-i="0"][data-k=quantity]': "12" }, leave: "tab" },
  { id: "tktreg", btn: "[data-act=add]", form: "#tkt-add", table: "client_tickets_entries", path: /\/client-tickets\/entries$/, gen: ["ticket_id"],
    fill: { client_name: "Draft Abela Rita", phone: "79003344", issue: "Is the Żebbuġ order in? ċġħż" }, sel: { priority: "1" }, leave: "hub" },
  { id: "odreg", btn: "[data-act=add]", form: "#odr-add", table: "order_diary_entries", path: /\/order-diary\/entries$/, gen: [],
    fill: { item_name: "Draft Panadol 500 ċġħż", qty: "3", supplier: "Hili Pharma", notes: "For Mrs Zammit" }, leave: "hash" },
];
async function leave(p, how) {
  if (how === "back") { await p.goBack(); }
  else if (how === "tab") { await p.locator(".eikon-rail-btn[data-mod=today]:visible").first().click(); }
  else if (how === "hub") { await p.evaluate(() => { location.hash = "#registers"; }); }
  else { await p.evaluate(() => { location.hash = "#today"; }); }
  await p.waitForFunction(() => ["today", "registers"].includes(window.EIKON.state.activeModuleId) || window.EIKON.state.activeModuleId === "customers", null, { timeout: 10000 }).catch(() => {});
  await p.waitForTimeout(500);
}
async function back(t, p, F, how) {
  if (how === "back") await p.goForward(); else await p.evaluate((h) => { location.hash = "#" + h; }, F.id);
  await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, F.id);
  await t.idle(p);
}
async function save(t, p, F) {
  const sub = F.form + " button[type=submit]";
  return t.write(p, F.path, async () => {
    await p.click(sub);
    if (F.id === "cdsreg") { // the same prescription twice: the screen asks first; Save again sends it
      const dup = await p.waitForSelector(".cds-dup", { timeout: 1500 }).catch(() => null);
      if (dup) await p.click(sub);
    }
  });
}
async function type(t, p, F) { await t.fill(p, F.form, F.fill); for (const [k, v] of Object.entries(F.sel || {})) await p.selectOption(F.form + " [name=" + k + "]", v); }
// balance_warning (finish round, records): sent when the line takes the medicine below zero — it says what the stock was
// at that moment (the second save of the same line goes further down), not what the form held.
const strip = (o, gen) => { const c = { ...(o || {}) }; for (const k of gen) delete c[k]; delete c.balance_warning; return JSON.stringify(c); };
export default {
  title: "Drafts: a half-typed form comes back, saves the same, and never outlives a save or Cancel",
  async run(t) {
    const p = await t.page({ phone: true });
    const writes = []; p.on("request", (r) => { if (r.method() !== "GET" && /\/(client-|dda-|order-diary)/.test(new URL(r.url()).pathname)) writes.push(r.method() + " " + new URL(r.url()).pathname); });
    for (const F of FORMS) {
      await t.open(p, "2", "today", "today");
      await p.evaluate((h) => { location.hash = "#" + h; }, F.id); await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, F.id); await t.idle(p);
      // 1. straight through
      let m = t.maxId(F.table);
      await p.click(F.btn); await p.waitForSelector(F.form);
      await type(t, p, F);
      const a = await save(t, p, F); await t.idle(p);
      const rowA = t.since(F.table, m).pop();
      // 2. typed, left, given back, saved
      await p.click(F.btn); await p.waitForSelector(F.form);
      await type(t, p, F);
      const typed = await p.evaluate((f) => [...document.querySelector(f).querySelectorAll("input,select,textarea")].map((e) => e.type === "checkbox" ? e.checked : e.value), F.form);
      const w0 = writes.length;
      await leave(p, F.leave);
      t.ok((await drafts(p)).some((k) => k.endsWith("|" + F.id)), `${F.id}: leaving by ${F.leave} kept a draft`);
      await back(t, p, F, F.leave);
      await p.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
      const line = await p.evaluate(() => (document.querySelector(".eikon-draft") || {}).innerText || "");
      t.ok(/^Your unsaved .+ is back/.test(line.trim()) && /Clear/.test(line), `${F.id}: the quiet line says it is back, with Clear: "${line}"`);
      const now = await p.evaluate((f) => { const x = document.querySelector(f); return x ? [...x.querySelectorAll("input,select,textarea")].map((e) => e.type === "checkbox" ? e.checked : e.value) : null; }, F.form);
      t.ok(JSON.stringify(now) === JSON.stringify(typed), `${F.id}: the form came back exactly as typed: ${JSON.stringify(now)} vs ${JSON.stringify(typed)}`);
      t.ok(writes.length === w0, `${F.id}: nothing was sent while the draft was kept and given back (${writes.slice(w0).join(", ")})`);
      t.ok(!(await drafts(p)).some((k) => k.endsWith("|" + F.id)), `${F.id}: the draft is taken out of storage once it is back`);
      m = t.maxId(F.table);
      const b = await save(t, p, F); await t.idle(p);
      const rowB = t.since(F.table, m).pop();
      t.ok(strip(a.body, F.gen) === strip(b.body, F.gen), `${F.id}: the restored form sent the same body as typing it: ${strip(a.body, F.gen)} vs ${strip(b.body, F.gen)}`);
      t.same(`${F.id} (typed vs restored)`, rowA, rowB, Object.fromEntries(F.gen.map((g) => [g, "a new code for each one"])));
      // 3. after the save, nothing comes back
      await leave(p, "hash"); await back(t, p, F, "hash"); await p.waitForTimeout(600);
      t.ok(!(await p.$(F.form)) && !(await p.$(".eikon-draft")) && !(await drafts(p)).length, `${F.id}: after a save nothing comes back`);
      // 4. Cancel drops it too
      await p.click(F.btn); await p.waitForSelector(F.form);
      await type(t, p, F);
      await leave(p, "hash"); await back(t, p, F, "hash");
      await p.waitForSelector(".eikon-draft", { timeout: 5000 }).catch(() => {});
      await p.click(F.form + " [data-act$=cancel]");
      await leave(p, "hash"); await back(t, p, F, "hash"); await p.waitForTimeout(600);
      t.ok(!(await p.$(F.form)) && !(await drafts(p)).length, `${F.id}: after Cancel nothing comes back`);
    }
    // 5. Clear gives the form as it opened (a default of 1 stays 1), and drops the draft
    {
      const F = FORMS[3];
      await p.click(F.btn); await p.waitForSelector(F.form);
      const fresh = await p.evaluate((f) => [...document.querySelector(f).querySelectorAll("input")].map((e) => e.value), F.form);
      await type(t, p, F);
      await leave(p, "hash"); await back(t, p, F, "hash");
      await p.waitForSelector(".eikon-draft button");
      await p.click(".eikon-draft button");
      const after = await p.evaluate((f) => [...document.querySelector(f).querySelectorAll("input")].map((e) => e.value), F.form);
      t.ok(JSON.stringify(after) === JSON.stringify(fresh) && !(await p.$(".eikon-draft")) && !(await drafts(p)).length, `odreg: Clear gives the form as it opened: ${JSON.stringify(after)} vs ${JSON.stringify(fresh)}`);
      await p.click(F.form + " [data-act$=cancel]");
    }
    // 6. Typing during the restore stays where it was typed: the list is slow, the person opens New and types first
    {
      const F = FORMS[2];
      await p.evaluate((h) => { location.hash = "#" + h; }, F.id); await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, F.id); await t.idle(p);
      await p.click(F.btn); await p.waitForSelector(F.form);
      await type(t, p, F);
      await leave(p, "hash");
      await p.route(/\/client-tickets\/entries(\?|$)/, async (r) => { if (r.request().method() === "GET") await new Promise((ok) => setTimeout(ok, 1500)); await r.continue(); });
      await p.evaluate((h) => { location.hash = "#" + h; }, F.id); await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, F.id);
      await p.waitForSelector(F.btn); await p.click(F.btn); await p.waitForSelector(F.form);
      await p.click(F.form + " [name=issue]"); await p.keyboard.type("Typed while it opened");
      await t.idle(p); await p.waitForTimeout(400);
      const st = await p.evaluate((f) => ({ issue: document.querySelector(f + " [name=issue]").value, name: document.querySelector(f + " [name=client_name]").value, focus: document.activeElement && document.activeElement.name }), F.form);
      t.ok(st.issue === "Typed while it opened" && st.focus === "issue", `tktreg: what was typed during the restore stays, with the cursor: ${JSON.stringify(st)}`);
      const offer = await p.evaluate(() => (document.querySelector(".eikon-draft") || {}).innerText || "");
      t.ok(st.name === "" && /Bring back what you were typing/.test(offer), `tktreg: a new one begun meanwhile is not merged with the draft, which is offered: ${JSON.stringify(st)} "${offer}"`);
      await p.click(".eikon-draft button"); // Bring back: the draft whole, in place of what was begun
      const st2 = await p.evaluate((f) => ({ issue: document.querySelector(f + " [name=issue]").value, name: document.querySelector(f + " [name=client_name]").value, line: (document.querySelector(".eikon-draft") || {}).innerText || "" }), F.form);
      t.ok(st2.issue === F.fill.issue && st2.name === F.fill.client_name && /is back/.test(st2.line) && !(await drafts(p)).length, `tktreg: Bring back puts the whole draft in its place: ${JSON.stringify(st2)}`);
      await p.unroute(/\/client-tickets\/entries(\?|$)/);
      await p.click(F.form + " [data-act$=cancel]");
    }
  },
};
