// Nothing freezes the app (BACKLOG5 item 1, q5-1), on the real stack, desktop, keyboard only:
//   - every rebuilt screen whose main form opens with N: Escape with the cursor in each of its fields closes the
//     form (or, as designed, goes to Cancel) and throws nothing: no page error, no error bar, no blocking overlay.
//     The diary and the locum receipts have history first, so their "fill from history" blur handlers run (they
//     threw "Cannot read properties of null" once Escape had closed the form);
//   - the classic look never sticks: Loyalty > ⋯ > the classic Loyalty screen, Back, then five screens: all new layout.
// "solo-": it adds a diary line and a locum receipt, so it runs last, on its own.
import { ymd } from "../lib.mjs";

const SCREENS = ["tempreg", "cleanreg", "drreg", "locreg", "certreg", "nexreg", "retreg", "trfreg", "alertreg", "ordreg", "tktreg", "dlvreg", "cdpreg", "cdsreg", "poyreg", "poreg", "hndreg", "repreg", "cnreg", "lrcreg", "odreg", "qtreg", "brdreg", "conreg", "vaxreg", "shfreg", "pocreg", "scsreg", "pvreg", "scrreg", "ocpreg", "sinreg", "ddstreg", "ssreg", "teamreg"];
const stuck = () => ({ bar: !!document.getElementById("eikon-error-bar"), overlay: !!document.getElementById("eikon-fatal-overlay") });
const formOf = () => { const a = document.activeElement, f = a && a.closest && a.closest("#eikon-content form"); return f ? (f.id ? "#" + f.id : "") : null; };

export default {
  title: "Escape never throws; the classic look never sticks",
  async run(t) {
    await t.api("POST", "/order-diary/entries", { item_name: "Amoxil 500mg caps", qty: 2, supplier: "Medicare", order_date: ymd(-1), status: "pending", notes: "" });
    await t.api("POST", "/locumreceipts/receipts", { receipt_date: ymd(-1), hours: 4, locum_full_name: "Pharm. Anna Borg", registration_number: "PH 1201", day_type: "normal", fee_per_hour: 20, total_fee: 80 });
    const p = await t.page();
    await t.open(p, "2", "today", "today", ".tdy-head h1");
    let screens = 0, fields = 0; const bad = [];
    for (const id of SCREENS) {
      await p.evaluate((h) => { location.hash = "#" + h; }, id);
      try { await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content h1"), id, { timeout: 10000 }); } catch (e) { t.fail(`${id}: did not open`); continue; }
      await t.idle(p);
      const openForm = async () => {
        await p.evaluate(() => { const h = document.querySelector("#eikon-content h1"); if (h) { if (!h.hasAttribute("tabindex")) h.setAttribute("tabindex", "-1"); h.focus(); } });
        await p.keyboard.press("n"); await p.waitForTimeout(450);
        return p.evaluate(formOf);
      };
      const sel = await openForm();
      if (sel === null) continue; // no form opened by N here (a list screen, or a form that starts elsewhere)
      if (!sel) { t.note(`${id}: form without an id`); continue; }
      screens++;
      const names = await p.evaluate((s) => [...document.querySelectorAll(s + " input, " + s + " select, " + s + " textarea")].filter((e) => e.name && e.type !== "hidden" && e.type !== "file" && e.offsetParent).map((e) => e.name), sel);
      for (const nm of [...new Set(names)]) {
        if (!(await p.$(sel))) { if ((await openForm()) !== sel) { bad.push(`${id}: the form did not open again`); break; } }
        const el = p.locator(sel + " [name=\"" + nm + "\"]").first();
        if (!(await el.isVisible().catch(() => false))) continue;
        await el.focus(); await p.keyboard.press("Escape"); await p.waitForTimeout(250); fields++;
        if (await p.$(sel)) { // Escape went to Cancel (something was typed or filled in): Enter there closes it
          if (await p.evaluate(() => /cancel|close/i.test((document.activeElement && (document.activeElement.getAttribute("data-act") || document.activeElement.textContent)) || ""))) { await p.keyboard.press("Enter"); await p.waitForTimeout(250); }
        }
        const s = await p.evaluate(stuck);
        if (s.bar || s.overlay) { bad.push(`${id} ${nm}: ${JSON.stringify(s)}`); await p.evaluate(() => { for (const i of ["eikon-error-bar", "eikon-fatal-overlay"]) { const o = document.getElementById(i); if (o) o.remove(); } }); }
      }
      if (await p.$(sel)) { const c = p.locator(sel + ' [data-act$="cancel"]').first(); if (await c.isVisible().catch(() => false)) await c.click(); }
    }
    t.ok(screens >= 20 && fields >= 100, `Escape tried in ${fields} fields of ${screens} forms`);
    t.ok(!bad.length, "Escape from every field: no error bar, no overlay: " + bad.join(" | "));
    // the classic look never sticks (page errors are failed by the harness)
    // as a pharmacy opens it: no ?ui= in the address (?ui=2 itself ends a classic visit, which hid the fault)
    await p.goto(t.base + "#loyalty"); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "loyreg", null, { timeout: 20000 });
    await t.idle(p);
    // Loyalty is rebuilt (round 2, loyreg); its classic screen is under ⋯ › Classic Loyalty screen
    await p.click(".lyr [data-act=menu]"); await p.click(".lyr [data-act=classic]");
    await p.waitForFunction(() => /ui=classic/.test(location.search) && window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "loyalty", null, { timeout: 20000 });
    await t.idle(p);
    await p.goBack(); await p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "loyreg", null, { timeout: 20000 });
    const seen = [];
    for (const [h, m] of [["temperature", "tempreg"], ["endofday", "eodreg"], ["registers", "registers"], ["tickets", "tktreg"], ["today", "today"]]) {
      await p.evaluate((x) => { location.hash = "#" + x; }, h);
      await p.waitForFunction((x) => window.EIKON.state.activeModuleId === x || /ui=classic/.test(location.search), m, { timeout: 15000 }).catch(() => {});
      seen.push(await p.evaluate(() => window.EIKON.state.activeModuleId + (document.documentElement.hasAttribute("data-ui2") ? "/new" : "/classic")));
    }
    t.ok(seen.join() === "tempreg/new,eodreg/new,registers/new,tktreg/new,today/new", "after Back from a classic-look screen, five screens open in the new layout: " + seen.join());
  },
};
