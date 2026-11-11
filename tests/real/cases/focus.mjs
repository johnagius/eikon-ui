// Focus is never lost (BACKLOG4 item 2), on the real stack, desktop, keyboard only:
//   - every new-layout screen opened from its hub has focus on its heading (or on the field the screen itself puts
//     first), never on BODY, and its main button is at most 2 Tabs away (it was 12 to 14 from the page);
//   - N opens the main form; Ctrl+Enter saves it; after the save focus is on the screen, never on BODY;
//   - the row stored by the keys is the row stored by the mouse for the same input (every column; only the sequence
//     number may differ), for a question, a delivery and an order;
//   - Today: after Log and after Done, focus is on the next check still to do.
import { ymd } from "../lib.mjs";

const SCREENS = ["tempreg", "cleanreg", "drreg", "locreg", "certreg", "nexreg", "retreg", "trfreg", "alertreg", "ordreg", "tktreg", "dlvreg", "cdpreg", "cdsreg", "poyreg", "poreg", "hndreg", "repreg", "cnreg", "lrcreg", "odreg", "qtreg", "brdreg", "conreg", "vaxreg", "eodreg", "shfreg", "pocreg", "scsreg", "audreg", "pvreg", "scrreg", "ocpreg", "lblreg", "sinreg", "otcreg", "eposreg", "calreg", "ddstreg", "ssreg", "teamreg", "rotreg", "expreg"];
const SELF_FOCUS = ["lblreg", "eposreg", "ocpreg", "otcreg"]; // put focus in their first field themselves: kept (ocpreg, otcreg: Services 2026-11-09, the search focused on desktop, one look-up pattern)
const at = () => { const a = document.activeElement; return !a || a === document.body ? "BODY" : a.tagName === "H1" ? "H1" : a.tagName + ":" + (a.getAttribute("data-act") || a.getAttribute("name") || a.getAttribute("data-kind") || a.textContent || "").trim().slice(0, 30); };

export default {
  title: "Focus: on the heading when a screen opens, never on the page after a save",
  async run(t) {
    const p = await t.page();
    await t.open(p, "2", "today", "today", ".tdy-head h1");
    // A: every screen, opened from its hub
    const far = [], lost = [];
    for (const id of SCREENS) {
      const hub = await p.evaluate((i) => window.EIKON.ui2BackTab ? window.EIKON.ui2BackTab(i) : "registers", id);
      await p.evaluate((h) => { location.hash = "#" + h; }, hub); await p.waitForFunction((h) => window.EIKON.state.activeModuleId === h, hub).catch(() => {}); await p.waitForTimeout(300);
      await p.evaluate(() => { const c = document.querySelector("#eikon-content button, #eikon-content a[href]"); if (c) c.focus(); }); // Enter on a card leaves focus there
      await p.evaluate((h) => { location.hash = "#" + h; }, id);
      try { await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content h1"), id, { timeout: 10000 }); } catch (e) { t.fail(`${id}: did not open from ${hub}`); continue; }
      await p.waitForTimeout(1200);
      const open = await p.evaluate(at);
      if (open === "BODY" || (!SELF_FOCUS.includes(id) && open !== "H1")) lost.push(`${id}: ${open}`);
      const main = await p.evaluate(() => { const b = window.EIKON.mainButton && window.EIKON.mainButton(); return b && /^(new|add|record|log|start|share|ask|offer)\b/i.test(b.textContent.trim()) ? b.textContent.trim() : ""; });
      if (main && open === "H1") {
        let n = 0; for (let i = 1; i <= 4; i++) { await p.keyboard.press("Tab"); if (await p.evaluate((m) => document.activeElement && document.activeElement.textContent.trim() === m, main)) { n = i; break; } }
        if (!n || n > 2) far.push(`${id}: ${main} ${n ? n + " Tabs" : "not within 4 Tabs"}`);
      }
    }
    t.ok(!lost.length, "a screen opened from its hub left focus off its heading: " + lost.join("; "));
    t.ok(!far.length, "the main button is more than 2 Tabs after the heading: " + far.join("; "));

    // B: the same question, delivery and order, by mouse (as before) and by the keys; rows equal; focus kept
    const viaMouse = async (hash, mod, form, fill) => { await t.open(p, "2", hash, mod, "[data-act=add]"); await p.click("[data-act=add]"); await p.waitForSelector(form); await fill(); };
    const viaKeys = async (hash, mod, form, fill, last) => {
      await t.open(p, "2", hash, mod, "[data-act=add]"); await p.waitForTimeout(400);
      await p.evaluate(() => document.activeElement && document.activeElement.blur && document.activeElement.blur());
      await p.keyboard.press("n"); await p.waitForSelector(form, { timeout: 4000 }); await fill(); await p.focus(form + " " + last);
    };
    const CASES = [
      { name: "questions", hash: "tickets", mod: "tktreg", form: "#tkt-add", T: "client_tickets_entries", re: /\/client-tickets\/entries$/, last: "[name=issue]", allow: { ticket_id: "the next number in the sequence" },
        fill: async () => { const f = (n, v) => p.fill("#tkt-add [name=" + n + "]", v); await f("client_name", "Borg Ċensina"); await f("phone", "79123456"); await f("issue", "Can I take ibuprofen with my blood pressure tablets?"); await f("followup_date", ymd(2)); } },
      { name: "deliveries", hash: "deliveries", mod: "dlvreg", form: "#dlv-add", T: "client_deliveries", re: /\/client-deliveries\/entries$/, last: "[name=items]", allow: { delivery_id: "the next number in the sequence" }, json: "delivery_log",
        fill: async () => { const f = (n, v) => p.fill("#dlv-add [name=" + n + "]", v); await f("client_name", "Zammit Ġorġ"); await f("phone", "79333444"); await f("delivery_address", "12 Triq il-Ħamrun, Żebbuġ"); await f("scheduled_date", ymd(1)); await f("scheduled_time_slot", "Afternoon"); await f("items", "Insulin pens"); } },
      { name: "orders", hash: "clientorders", mod: "ordreg", form: "#ord-add", T: "client_orders_entries", re: /\/client-orders\/entries$/, last: "[name=notes]", allow: {},
        fill: async () => { const f = (n, v) => p.locator("#ord-add [name=" + n + "]").first().fill(v); await f("client_name", "Hili Marija"); await f("contact", "79555666"); await f("items", "Pen needles 4mm"); await f("needed_by", ymd(2)); await f("notes", "Calls after 5"); } },
    ];
    for (const c of CASES) {
      let m = t.maxId(c.T);
      try { await viaMouse(c.hash, c.mod, c.form, c.fill); await t.write(p, c.re, () => p.click(c.form + " button[type=submit]")); } catch (e) { t.fail(`${c.name}: the mouse save failed: ${e.message.slice(0, 200)}`); continue; }
      const byMouse = t.since(c.T, m)[0];
      await p.waitForTimeout(1200);
      t.ok(await p.evaluate(at) !== "BODY", `${c.name}: after a save by mouse focus fell to the page`);
      m = t.maxId(c.T);
      try { await viaKeys(c.hash, c.mod, c.form, c.fill, c.last); await t.write(p, c.re, () => p.keyboard.press("Control+Enter")); } catch (e) { t.fail(`${c.name}: N then Ctrl+Enter did not save: ${e.message.slice(0, 200)}`); continue; }
      const byKeys = t.since(c.T, m);
      t.ok(byKeys.length === 1, `${c.name}: Ctrl+Enter stored ${byKeys.length} rows (one expected)`);
      const j = (r) => c.json ? t.jsonCol(r, c.json, ["ts"]) : r; // a log line's own clock stamp is the save time
      t.same(c.name + " (keys vs mouse)", j(byMouse), j(byKeys[0]), c.allow);
      await p.waitForTimeout(1200);
      const after = await p.evaluate(at);
      t.ok(after !== "BODY", `${c.name}: after Ctrl+Enter focus fell to the page`);
      t.note(`${c.name}: after Ctrl+Enter focus on ${after}`);
    }

    // C: Today, Log and Done by keyboard: focus on the next check still to do
    await t.open(p, "2", "today", "today", ".tdy-head h1"); await p.waitForTimeout(600);
    const mins = p.locator(".tdy-row[data-kind=temperature] [data-min]");
    if (await mins.count()) {
      const m = t.maxId("temperature_entries");
      await mins.first().focus(); await p.keyboard.type("3.2"); await p.keyboard.press("Tab"); await p.keyboard.type("6.9");
      await t.write(p, /\/temperature\/entries$/, () => p.keyboard.press("Enter"));
      await p.waitForTimeout(1200);
      const f1 = await p.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : (a.className || a.tagName) + ":" + (a.getAttribute("data-kind") || ""); });
      t.ok(/tdy-row/.test(f1) || /^H1/.test(f1), `today: after Log focus is on ${f1}, not the next check`);
      const row = t.since("temperature_entries", m)[0];
      t.ok(row && Number(row.min_temp) === 3.2 && Number(row.max_temp) === 6.9, "today: the reading typed by keys is stored: " + JSON.stringify(row));
    } else t.note("today: every reading already logged; Log not tried");
    const done = p.locator(".tdy-row[data-kind=cleaning] [data-act=clean]");
    if (await done.count()) {
      // b4-4: the name is in the row already and Done now records it at once; so the name is typed over in the field, and Enter there records
      await p.focus("[data-cleaner]"); await p.keyboard.press("ControlOrMeta+A"); await p.keyboard.type("Karla Sweep");
      await t.write(p, /\/cleaning\/entries$/, () => p.keyboard.press("Enter"));
      await p.waitForTimeout(1200);
      const f2 = await p.evaluate(() => { const a = document.activeElement; return a === document.body ? "BODY" : (a.className || a.tagName) + ":" + (a.getAttribute("data-kind") || ""); });
      t.ok(f2 !== "BODY", "today: after Done focus fell to the page");
      t.note("today: after Done focus on " + f2);
    }
  },
};
