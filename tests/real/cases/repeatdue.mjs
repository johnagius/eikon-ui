// Repeats coming due (backlog 3 item 7) on the real worker: the new form records "Collected every … days"; a correction
// in the CLASSIC screen (its full-replace PUT, which knows nothing of the interval) keeps it; "Collected today" stores
// Malta's date and Undo clears it; Today's Repeats card lists a line due tomorrow and opens it.
import { ymd } from "../lib.mjs";
const IN = { date: ymd(0), id: "0864213M", name: "Azzopardi Noel", med: "Simvastatin 40mg", pos: "1 at night", doc: "Dr Claire Bonello", reg: "R5501" };
const malta = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta" }).format(new Date());
export default {
  title: "Repeats coming due",
  async run(t) {
    const T = "repeat_prescription_entries", p = await t.page();
    // 1. the new form, with an interval chip
    await t.open(p, "2", "repreg", "repreg", "[data-act=add]");
    let m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#rep-add");
    await t.fill(p, "#rep-add", { entry_date: IN.date, client_id: IN.id, client_name: IN.name, medicine_name_dose: IN.med, posology: IN.pos, prescriber_name: IN.doc, prescriber_reg_no: IN.reg });
    await p.click('#rep-add [data-every="28"]');
    await t.write(p, /\/repeat-prescriptions\/entries$/, () => p.click("#rep-add button[type=submit]"));
    const fresh = t.since(T, m).filter((r) => r.client_id === IN.id)[0]; // repreg.mjs writes to the same table in parallel;
    t.has("repeatdue(new)", fresh, { entry_date: IN.date, client_id: IN.id, client_name: IN.name, collect_every_days: 28, last_collected_date: null });
    if (!fresh) return;

    // 2. a correction in the classic screen keeps the interval
    await t.open(p, "classic", "repeatprescriptions", "repeatprescriptions", "#rp-new");
    const tr = p.locator("tr", { hasText: IN.name }).first();
    await tr.locator("button", { hasText: "Edit" }).click(); await p.waitForSelector("#rp-pos");
    await p.fill("#rp-pos", "2 at night");
    await t.write(p, new RegExp("/repeat-prescriptions/entries/" + fresh.id + "$"), () => p.click("#eikon-modal-actions .eikon-btn.primary"), "PUT");
    const edited = t.row(T, fresh.id);
    t.ok(edited.posology === "2 at night", "classic edit applied: " + edited.posology);
    t.ok(edited.collect_every_days === 28, "classic edit kept the interval: " + edited.collect_every_days);

    // 3. Collected today, then Undo
    await t.open(p, "2", "repreg", "repreg", `[data-act=collected][data-id="${fresh.id}"]`);
    await t.write(p, new RegExp("/repeat-prescriptions/entries/" + fresh.id + "/collected$"), () => p.click(`[data-act=collected][data-id="${fresh.id}"]`));
    t.ok(t.row(T, fresh.id).last_collected_date === malta(), "Collected today stored Malta's date: " + t.row(T, fresh.id).last_collected_date);
    await p.waitForSelector(`[data-act=uncollect][data-id="${fresh.id}"]`);
    t.ok(/Collected today/.test(await p.innerText(".rep")), "the line says Collected today");
    await t.write(p, new RegExp("/repeat-prescriptions/entries/" + fresh.id + "/collected$"), () => p.click(`[data-act=uncollect][data-id="${fresh.id}"]`));
    t.ok(t.row(T, fresh.id).last_collected_date === null, "Undo put the previous value (none) back");
    const audit = t.db.prepare("SELECT COUNT(*) c FROM audit_log WHERE action = 'REPEAT_RX_ENTRY_COLLECTED' AND entity_id = ?").get(String(fresh.id));
    t.ok(audit && audit.c === 2, "both collections audited: " + (audit && audit.c));

    // 4. Today: a line due tomorrow is on the Repeats card; Open goes to that patient's Due view
    const due = await t.api("POST", "/repeat-prescriptions/entries", { entry_date: ymd(-27), expires_date: "", client_name: "Caruana Ines", client_id: "0753197M", medicine_name_dose: "Losartan 50mg", posology: "1 daily", prescriber_name: IN.doc, prescriber_reg_no: IN.reg, collect_every_days: 28 });
    t.ok(due && due.ok, "seeded a line due tomorrow");
    await t.open(p, "2", "today", "today", ".tdy-head h1");
    const row = p.locator(".tdy-row[data-kind=repeat]", { hasText: "Caruana Ines" });
    await row.waitFor({ timeout: 10000 }).catch(() => {});
    const txt = (await row.count()) ? await row.innerText() : "";
    t.ok(/Due (tomorrow|today|in 2 days)/.test(txt), "Today's card shows Caruana Ines as due: " + JSON.stringify(txt));
    t.ok(!(await p.locator(".tdy-row[data-kind=repeat]", { hasText: IN.name }).count()), "a line not yet due is not on the card");
    if (txt) {
      await row.locator("[data-rep-open]").click();
      await p.waitForFunction(() => window.EIKON.state.activeModuleId === "repreg" && document.querySelector("[data-view=due][aria-pressed=true]") && /Caruana Ines/.test(document.querySelector(".rep").innerText), null, { timeout: 10000 }).catch(() => {});
      const st = await p.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, q: (document.querySelector("#rep-q") || {}).value, due: !!document.querySelector("[data-view=due][aria-pressed=true]"), text: ((document.querySelector(".rep") || {}).innerText || "").slice(0, 400) }));
      t.ok(st.q === "0753197M" && st.due && /Caruana Ines/.test(st.text), "Open shows that patient in the Due view: " + JSON.stringify(st));
    }
  },
};
