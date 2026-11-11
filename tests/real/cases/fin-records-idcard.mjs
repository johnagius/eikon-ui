// W44 (live, found by Visual): Controlled drugs supplied with a typed ID card and an existing customer whose card is
// different. Proves: the question is on screen and answerable (an alertdialog in the viewport, the safe answer focused);
// the preview never changes a card (read the DB after); "Only this DDA sale" saves the line and the card stays; Escape
// and a question that leaves the page end the save (no "Saving…" for ever); Tab from Prescriber into Reg no. and typing
// gives what was typed, not the known reg no. in front of it.
const maltaToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
export default {
  title: "W44: ID card question on Controlled drugs supplied",
  async run(t) {
    const today = maltaToday(), db = t.db;
    const per = await t.api("POST", "/people", { name: "Zammit Maria", id_card: "0378229L", phone: "", address: "3 Triq il-Kbira, Żebbuġ", source: "manual" });
    const pid = per.person.id, cardNow = () => db.prepare("SELECT id_card FROM people WHERE id = ?").get(pid).id_card;
    await t.api("POST", "/dda-sales/entries", { entry_date: today, client_name: "Borg Joseph", client_id_card: "0555111M", client_address: "1 Triq il-Mitħna, Rabat", medicine_name_dose: "Diazepam 5mg", quantity: 1, doctor_name: "Dr Helen Abela", doctor_reg_no: "R7701", prescription_serial_no: "W44-SEED" });
    const p = await t.page();
    const posts = []; p.on("request", (r) => { if (r.method() === "POST") posts.push(new URL(r.url()).pathname + " " + (r.postData() || "")); });
    await t.open(p, "2", "cdsreg", "cdsreg", "[data-act=add]");
    const start = async (serial, card, byClick) => {
      await p.click("[data-act=add]"); await p.waitForSelector("#cds-add");
      await t.fill(p, "#cds-add", { entry_date: today, client_id_card: card || "0661234M", client_name: "Zammit Maria", client_address: "3 Triq il-Kbira, Żebbuġ" });
      // Tab from Prescriber into Reg no. and type: the known reg no. must not end up in front of what is typed
      await p.click("#cds-add [name=doctor_name]"); await p.keyboard.type("Dr Helen Abela"); // typed, as a person does (no blur before the next field)
      if (byClick) await p.click("#cds-add [name=doctor_reg_no]"); else await p.keyboard.press("Tab"); // a tap/click puts the caret after any number already there
      await p.keyboard.type("1234"); await p.waitForTimeout(400);
      const reg = await p.inputValue("#cds-add [name=doctor_reg_no]");
      await t.fill(p, "#cds-add", { prescription_serial_no: serial, '#cds-add [data-i="0"][data-k=medicine_name_dose]': "Diazepam 5mg", '#cds-add [data-i="0"][data-k=quantity]': "10" });
      return reg;
    };
    // Save; a controlled-drug balance question first (records build, not on base) is answered "Yes, save it"
    const save = async () => { await p.click("#cds-add button[type=submit]"); await p.waitForSelector(".epc-ov, .cds-dup[role=status]", { timeout: 8000 }).catch(() => {});
      if (await p.locator(".cds-dup[role=status]").count() && !(await p.locator(".epc-ov").count())) { await p.click("#cds-add button[type=submit]"); } await p.waitForSelector(".epc-ov", { timeout: 8000 }).catch(() => {}); };
    const reg = await start("W44-1", "", true);
    t.ok(reg === "1234", "clicking into Reg no. after the prescriber and typing keeps what was typed: " + reg);
    posts.length = 0;
    await save();
    const dlg = await p.evaluate(() => { const b = document.querySelector(".epc"); if (!b) return null; const r = b.getBoundingClientRect(); return { inView: r.top >= 0 && r.bottom <= innerHeight && r.width > 0, title: b.querySelector("h2").textContent, focus: document.activeElement && document.activeElement.textContent }; });
    t.ok(dlg && dlg.inView && /Change Zammit Maria’s ID card from 0378229L to 0661234M/.test(dlg.title) && dlg.focus === "Keep 0378229L", "the question is on screen and the safe answer is focused: " + JSON.stringify(dlg));
    t.ok(posts.every((x) => !/"confirm":true/.test(x)) && posts.some((x) => /change-id-card/.test(x)) && cardNow() === "0378229L", "only the count (no confirm) was asked; the card is unchanged: " + cardNow());
    const m = t.maxId("dda_sales_entries");
    await t.write(p, /\/dda-sales\/entries$/, () => p.click(".epc-b:has-text('Only this DDA sale')"));
    const row = (await t.mine("dda_sales_entries", m, { prescription_serial_no: "W44-1" }))[0];
    t.ok(row && row.client_id_card === "0661234M" && row.doctor_reg_no === "1234" && cardNow() === "0378229L" && !(await p.locator(".epc-ov").count()), "Only this DDA sale: the line is saved as typed, the customer's card is untouched");
    // Escape: back to the form, the save ends
    const reg2 = await start("W44-2", "0661235M"); t.ok(reg2 === "1234", "Tab into Reg no. too: " + reg2); await save();
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector(".epc-ov") && /Save prescription/.test((document.querySelector("#cds-add button[type=submit]") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    t.ok(!(await p.locator(".epc-ov").count()) && /Save prescription/.test(await p.textContent("#cds-add button[type=submit]")) && cardNow() === "0378229L", "Escape: back to the form, Save prescription again, nothing changed");
    // the question leaves the page (an overlay sweep): the save ends as Go back
    await p.click("[data-act=add-cancel]").catch(() => {}); await start("W44-3", "0661236M"); await save();
    await p.evaluate(() => { const o = document.querySelector(".epc-ov"); if (o) o.remove(); });
    await p.waitForFunction(() => /Save prescription/.test((document.querySelector("#cds-add button[type=submit]") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    t.ok(/Save prescription/.test(await p.textContent("#cds-add button[type=submit]")) && !(await p.locator("[inert]").count()), "a question that leaves the page ends the save (no Saving… for ever, nothing left inert)");
    t.ok(cardNow() === "0378229L" && t.since("dda_sales_entries", m, { prescription_serial_no: "W44-2" }).length === 0 && t.since("dda_sales_entries", m, { prescription_serial_no: "W44-3" }).length === 0, "and nothing was saved or changed");
  },
};
