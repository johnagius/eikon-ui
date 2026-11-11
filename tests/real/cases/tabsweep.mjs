// Tab sweep (BACKLOG3 item 1): every new-layout form is typed the way a person types it, 60 ms a key with Tab
// between fields, while the lookups that fill a field (ID card -> patient, prescriber -> reg no., locum -> reg no.,
// item -> supplier) fire. A lookup used to redraw the form while focus was moving to the next field; focus fell to
// <body> and the next value typed (a DDA serial no.) was lost. Checked for each screen:
//   - after every Tab, focus is on the next field in the form, never on BODY;
//   - the lookups still work: the reg no. / supplier is filled when Tab reaches it;
//   - every typed value is still in its field before saving (a lookup filled only empty fields);
//   - after saving, every typed value is in what the server stored, and focus is not on BODY (BACKLOG4 item 2).
// Dates and times that start empty are set before the sweep (typing a date is the browser's own control).
//   TABSWEEP=cdsreg,repreg  only those screens
import { ymd } from "../lib.mjs";

const KNOWN = { id: "0456789M", name: "Grech Joseph", doc: "Dr Galea", reg: "R1202" }; // from the stack's seed (a DDA sale)
const LOCUM = { name: "Pharm. Sweep Locum", reg: "PH 4321" }, ITEM = { name: "Sweep gauze 10cm", supplier: "Sweep Supplies" };
const ADDR = "5 Triq il-Mosta, Rabat"; // not the known address: a lookup that overwrote it would show

// screen, the button that opens the form, the form, and values for fields the generic guess would get wrong.
// save: false for forms whose save is not a plain stored row (labels print; calculators save nothing).
const SCREENS = [
  { id: "cdsreg", open: "New prescription", form: "#cds-add", values: { client_address: ADDR }, filled: { doctor_reg_no: KNOWN.reg } },
  { id: "poyreg", open: "New prescription", form: "#cds-add", values: { client_address: ADDR } },
  { id: "repreg", open: "New prescription", form: "#rep-add", values: { collect_every_days: "28" }, filled: { prescriber_reg_no: KNOWN.reg } }, // collect_every_days: a number of days (repeats coming due)
  { id: "drreg", open: "New entry", form: "#drr-form" },
  { id: "cdpreg", open: "New invoice", form: "#cdp-add", values: { agent: "Sweep Pharma Ltd" } },
  { id: "lrcreg", open: "New receipt", form: "#lrc-add", values: { locum_full_name: LOCUM.name, registration_number: LOCUM.reg, hours: "7.5", fee_per_hour: "18" }, filled: { registration_number: LOCUM.reg } },
  { id: "locreg", open: "New locum", form: "#lcr-form", values: { locum_full_name: LOCUM.name, registration_number: LOCUM.reg } },
  { id: "odreg", open: "Add an item", form: "#odr-add", values: { item_name: ITEM.name, supplier: "Other Supplier Ltd", qty: "3" }, filled: { supplier: ITEM.supplier } },
  { id: "cleanreg", open: "New cleaning", form: "#clr-form" },
  { id: "nexreg", open: "Add an item", form: "#nex-add" },
  { id: "alertreg", open: "New alert", form: "#alr-add" },
  { id: "ordreg", open: "New order", form: "#ord-add", values: { client_name: "Sweep Order Client", id_card: "0333333M" } },
  { id: "tktreg", open: "New question", form: "#tkt-add", values: { client_name: "Sweep Question Client" } },
  { id: "dlvreg", open: "New delivery", form: "#dlv-add", values: { client_name: "Sweep Delivery Client", delivery_address: ADDR, scheduled_time_slot: "10:00-12:00" } },
  { id: "poreg", open: "New payment", form: "#por-add", values: { fee: "12.50" } },
  { id: "cnreg", open: "New credit note", form: "#cnr-add", values: { amount: "12.50" } },
  { id: "qtreg", open: "New quote", form: "#qtr-add", values: { cost_excl_vat: "4.20", discount_euro: "0.20", retail_price: "6.50", qty_purchased: "3", qty_free: "1", barcode: "5012345678900" } },
  { id: "ssreg", open: "Ask for something", form: "#ssr-add" },
  { id: "scsreg", open: "Share stock", form: "#scs-add" },
  { id: "conreg", open: "Add a contact", form: "#con-form" },
  { id: "pocreg", open: "New test", form: "#poc-add", values: { patientId: "0444444M", name: "Sweep Test Patient", age: "61", sys: "128", dia: "82", pulse: "71" } },
  { id: "teamreg", open: "Add a person", form: "#tmr-add", values: { "tmr-name": "Sweep Person", "tmr-email": "sweep.person@example.com" } },
  { id: "lblreg", open: null, form: "#lbl-add", save: false },
];

const lc = (s) => String(s || "").toLowerCase();
function guess(name, type, tag) {
  const n = lc(name);
  if (type === "email" || /email/.test(n)) return "sweep@example.com";
  if (type === "tel" || /phone|telephone|contact/.test(n)) return "79123456";
  if (/id_card|^client_id$|patientid|idcard/.test(n)) return KNOWN.id;
  if (/doctor_name|prescriber_name/.test(n)) return KNOWN.doc;
  if (/doctor_reg_no|prescriber_reg_no/.test(n)) return KNOWN.reg;
  if (/serial/.test(n)) return "SW9087";
  if (/address/.test(n)) return ADDR;
  if (/^client_name$|patientname|^name$/.test(n)) return KNOWN.name;
  if (/surname/.test(n)) return "Sweepson";
  if (/medicine|dda_name|drugname|product_name|item_name|item_description|^items$/.test(n)) return "Sweepazole 5mg tablets";
  if (/posology|^dose$/.test(n)) return "1 twice daily";
  if (/qty|quantity|hours|amount|fee|price|cost|deposit|age|target/.test(n)) return "2";
  if (/cleaner/.test(n)) return "Karla Sweep";
  if (/invoice|receipt_number|batch/.test(n)) return "INV-77" + n.length;
  if (tag === "TEXTAREA") return "Sweep note typed with Tab";
  return "Sweep " + n.replace(/[^a-z]/g, " ").trim();
}

export default {
  title: "Tab sweep: typing at human speed with Tab keeps every value",
  async run(t) {
    // the lookups this sweep makes fire, seeded once
    const seeds = [
      ["POST", "/repeat-prescriptions/entries", { entry_date: ymd(-20), client_id: KNOWN.id, client_name: KNOWN.name, medicine_name_dose: "Atorvastatin 20mg", posology: "1 at night", prescriber_name: KNOWN.doc, prescriber_reg_no: KNOWN.reg, expires_date: "" }],
      ["POST", "/locumreceipts/receipts", { receipt_date: ymd(-3), hours: 8, locum_full_name: LOCUM.name, registration_number: LOCUM.reg, fee_per_hour: 18, day_type: "normal" }],
      ["POST", "/order-diary/entries", { order_date: ymd(-2), item_name: ITEM.name, qty: 1, supplier: ITEM.supplier, notes: "" }],
    ];
    for (const [m, path, body] of seeds) { const r = await t.stack.app.api(m, path, { token: t.token, body }); if (r.status >= 400) t.note(`seed ${path} answered ${r.status}`); }
    const only = (process.env.TABSWEEP || "").split(",").filter(Boolean);
    const p = await t.page();
    const lost = [];
    for (const sc of SCREENS.filter((s) => !only.length || only.includes(s.id))) {
      const tag = sc.id;
      try { await t.open(p, "2", sc.id, sc.id, sc.open ? null : sc.form); }
      catch (e) { t.fail(`${tag}: did not open: ${e.message.slice(0, 160)}`); continue; }
      if (sc.open) {
        const b = p.getByRole("button", { name: sc.open, exact: true }).first();
        try { await b.waitFor({ timeout: 10000 }); await b.click(); await p.waitForSelector(sc.form, { timeout: 5000 }); }
        catch (e) { t.fail(`${tag}: the form did not open (${sc.open}): ${e.message.split("\n")[0]}`); continue; }
      }
      await p.waitForTimeout(500); // the form's own first focus and its lists
      // dates and times that start empty: set them as a picker would, before the sweep
      const dt = await p.$$eval(sc.form + " input[type=date], " + sc.form + " input[type=time]", (els) => els.filter((e) => e.offsetParent && !e.disabled && e.name).map((e) => ({ name: e.name, type: e.type, empty: !e.value })));
      let tm = 8; const anyTimeEmpty = dt.some((e) => e.type === "time" && e.empty);
      for (const e of dt) { // empty dates get a day; times, if one is empty, all get an earlier-to-later order
        if (e.type === "date" && e.empty) await p.locator(`${sc.form} [name="${e.name}"]`).first().fill(/expir|until|needed|sched|follow|pick/.test(e.name) ? ymd(14) : ymd(0));
        if (e.type === "time" && anyTimeEmpty) await p.locator(`${sc.form} [name="${e.name}"]`).first().fill(`${String(tm++).padStart(2, "0")}:15`);
      }
      const rowsBefore = dump(t.db);
      // start in the first field
      const first = p.locator(`${sc.form} input:not([type=hidden]):not([disabled]), ${sc.form} textarea:not([disabled]), ${sc.form} select:not([disabled])`).first();
      await first.focus();
      const typed = [];
      for (let step = 0; step < 90; step++) {
        const cur = await p.evaluate((form) => {
          const a = document.activeElement, f = document.querySelector(form);
          const key = (e) => !e || e === document.body ? "BODY" : (e.getAttribute("name") || e.getAttribute("data-k") && e.getAttribute("data-k") + "#" + e.getAttribute("data-i") || e.id || e.tagName + ":" + (e.innerText || "").trim().slice(0, 20));
          const order = f ? [...f.querySelectorAll("input,select,textarea,button,a[href],summary,[tabindex]")].filter((e) => e.offsetParent !== null && !e.disabled && e.tabIndex >= 0 && e.type !== "hidden") : [];
          const i = order.indexOf(a);
          return { key: key(a), inForm: !!(f && f.contains(a)), tag: a ? a.tagName : "", type: a && a.type || "", name: a && (a.getAttribute("name") || a.getAttribute("data-k") || a.id) || "", next: i >= 0 && order[i + 1] ? key(order[i + 1]) : null, value: a && "value" in a ? a.value : null, ph: a && a.placeholder || "" };
        }, sc.form);
        if (cur.key === "BODY") { lost.push(`${tag}: focus on BODY before step ${step}`); t.fail(`${tag}: focus is on BODY (the page) before field ${step + 1}`); break; }
        if (!cur.inForm || (cur.tag === "BUTTON" && cur.type === "submit")) break; // reached Record: every field is done
        const textual = cur.tag === "TEXTAREA" || (cur.tag === "INPUT" && /^(text|search|tel|email|url|number|)$/.test(cur.type));
        if (sc.filled && cur.name in sc.filled) t.ok(cur.value === sc.filled[cur.name] || (cur.value === "" && cur.ph === sc.filled[cur.name]), `${tag}: the lookup should have filled ${cur.name} with ${JSON.stringify(sc.filled[cur.name])} by the time Tab reached it (or, W44 finish round, shown it as the hint of the field Tab lands in, taken if left empty); it holds ${JSON.stringify(cur.value)}, hint ${JSON.stringify(cur.ph)}`);
        if (textual && cur.name) {
          const v = (sc.values && sc.values[cur.name]) || guess(cur.name, cur.type, cur.tag);
          await p.keyboard.press("ControlOrMeta+A"); // what a lookup put in a field still to be typed is replaced, as a person would
          await p.keyboard.type(v, { delay: 60 });
          typed.push({ name: cur.name, key: cur.key, v });
          await p.waitForTimeout(250);
        }
        await p.keyboard.press("Tab");
        await p.waitForTimeout(400); // the lookup for the field just left answers now
        const now = await p.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? "BODY" : (a.getAttribute("name") || a.getAttribute("data-k") && a.getAttribute("data-k") + "#" + a.getAttribute("data-i") || a.id || a.tagName + ":" + (a.innerText || "").trim().slice(0, 20)); });
        if (now === "BODY") { lost.push(`${tag}: ${cur.key}`); t.fail(`${tag}: Tab from ${cur.key} put focus on BODY (expected ${cur.next}); what is typed next is lost`); break; }
        if (now === cur.key && /^(date|time|datetime-local|month)$/.test(cur.type)) continue; // Tab moves between the day, month and year of a date
        if (cur.next && now !== cur.next && !/^(OPTION|LI|DIV)/.test(now)) t.fail(`${tag}: Tab from ${cur.key} went to ${now}, expected ${cur.next}`);
      }
      // every typed value is still in its field (a lookup filled only empty fields, nothing was overwritten)
      for (const x of typed) {
        const v = await p.evaluate(([form, k]) => { const f = document.querySelector(form); const e = f && [...f.querySelectorAll("input,textarea")].find((el) => (el.getAttribute("name") || (el.getAttribute("data-k") && el.getAttribute("data-k") + "#" + el.getAttribute("data-i")) || el.id) === k); return e ? e.value : null; }, [sc.form, x.key]);
        t.ok(norm(v) === norm(x.v), `${tag}: ${x.key} typed ${JSON.stringify(x.v)}, the field holds ${JSON.stringify(v)}`);
      }
      t.ok(typed.length >= (sc.min || 2), `${tag}: only ${typed.length} field(s) were reached with Tab`);
      if (sc.save === false) continue;
      await p.locator(sc.form + " button[type=submit]").first().click();
      await p.waitForTimeout(1500);
      const after = await p.evaluate(() => { const a = document.activeElement; return !a || a === document.body ? "BODY" : a.tagName + ":" + (a.getAttribute("data-act") || a.getAttribute("name") || a.textContent || "").trim().slice(0, 30); });
      t.ok(after !== "BODY", `${tag}: after the save focus fell to the page (BODY); it should be on the new row, the button that opened the form, or the heading`);
      const changed = changedRows(t.db, rowsBefore);
      if (!changed.length) { const err = await p.evaluate((form) => { const f = document.querySelector(form); return f ? f.innerText.replace(/\s+/g, " ").slice(-220) : "(form closed)"; }, sc.form); t.fail(`${tag}: nothing was stored after Record · form: ${err}`); continue; }
      const blob = norm(changed.join("\n"));
      for (const x of typed) {
        const want = [norm(x.v), norm(x.v).replace(/^0+/, "")].concat(/^\d+(\.\d+)?$/.test(x.v) ? [String(Number(x.v))] : []);
        t.ok(want.some((w) => blob.includes(w)), `${tag}: typed ${x.key}=${JSON.stringify(x.v)} is not in the stored row`);
      }
    }
    if (lost.length) t.note("focus lost: " + lost.join("; "));
  },
};

const norm = (s) => String(s == null ? "" : s).toLowerCase().replace(/\\"/g, '"').replace(/\s+/g, " ").trim();
function dump(db) {
  const out = new Set();
  for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all()) {
    for (const r of db.prepare(`SELECT * FROM "${name}"`).all()) out.add(name + ":" + JSON.stringify(r));
  }
  return out;
}
function changedRows(db, before) { return [...dump(db)].filter((x) => !before.has(x) && !/^(sessions|audit|rate|login)/i.test(x)); }
