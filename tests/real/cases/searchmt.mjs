// Search and suggestions find what a pharmacist types (q5-7, BACKLOG5 item 7), on the real worker:
//  - ċ ġ ħ ż left out or typed: "xerri censu" finds Xerri Ċensu and Xerri Censu (Customers, the search, an Orders
//    name field), "mallia cettina" finds Mallia Ċettina, "tabone ganni" Tabone Ġanni, "xuereb gorg" Xuereb Ġorġ. No worker
//    change: the longest stretch without c/g/h/z is asked as well, and the browser compares with them folded.
//  - Ctrl+Enter in the prescriber field of the Daily register saves with the known reg no. filled (as Tab would), and
//    the row is byte-identical to the one saved after a Tab.
//  - "log fridge" lands on the fridge's line (not the room's, the first one); its reading is stored on the fridge.
import { ymd } from "../lib.mjs";
const CARDS = [["Xerri Ċensu", "0771101M", "79771101"], ["Xerri Censu", "0771102M", "79771102"], ["Mallia Ċettina", "0771103M", "79771103"], ["Tabone Ġanni", "0771104M", "79771104"], ["Xuereb Ġorġ", "0771105M", "79771105"]];
async function dialog(p, q) {
  await p.evaluate(() => { location.hash = "#registers"; });
  await p.waitForFunction(() => window.EIKON.state.activeModuleId === "registers");
  await p.keyboard.press("Control+k"); await p.waitForSelector("#esr-q"); await p.fill("#esr-q", ""); await p.keyboard.type(q, { delay: 20 });
  await p.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 8000 });
  const opts = await p.evaluate(() => [...document.querySelectorAll(".esr-opt")].map((o) => o.innerText.replace(/\s+/g, " ")));
  return opts;
}
export default {
  title: "Search with Maltese letters, Ctrl+Enter lookups, log fridge",
  async run(t) {
    for (const [name, id_card, phone] of CARDS) { const r = await t.api("POST", "/people", { name, id_card, phone }); t.ok(r && r.ok, "card accepted: " + name); }
    const p = await t.page();

    // Customers
    await t.open(p, "2", "customers", "customers", "#cus-q");
    for (const [q, want] of [["xerri censu", ["Xerri Ċensu", "Xerri Censu"]], ["mallia cettina", ["Mallia Ċettina"]], ["tabone ganni", ["Tabone Ġanni"]], ["xuereb gorg", ["Xuereb Ġorġ"]], ["xerri ċensu", ["Xerri Ċensu", "Xerri Censu"]]]) {
      await p.fill("#cus-q", ""); await p.locator("#cus-q").pressSequentially(q, { delay: 15 });
      await p.waitForFunction((w) => w.every((n) => document.querySelector("#cus-list") && document.querySelector("#cus-list").innerText.includes(n)), want, { timeout: 6000 }).catch(() => {});
      const txt = await p.evaluate(() => document.querySelector("#cus-list").innerText);
      t.ok(want.every((n) => txt.includes(n)), `customers: "${q}" lists ${want.join(" and ")}: ${txt.replace(/\s+/g, " ").slice(0, 200)}`);
    }

    // The search dialog
    for (const [q, want] of [["mallia cettina", "Mallia Ċettina"], ["xerri censu", "Xerri Ċensu"], ["tabone ganni", "Tabone Ġanni"]]) {
      const opts = await dialog(p, q);
      t.ok(opts.some((o) => o.startsWith(want) && /Customers/.test(o)), `search: "${q}" offers the card ${want}: ${JSON.stringify(opts.slice(0, 4))}`);
      await p.keyboard.press("Escape");
    }

    // People suggestions under a register field (Orders), both ways; the letters typed come first
    await t.open(p, "2", "clientorders", "ordreg", "[data-act=add]");
    await p.click("[data-act=add]"); await p.waitForSelector("#ord-add");
    const box = p.locator("#ord-add [name=client_name]");
    for (const [q, want, first] of [["xerri censu", ["Xerri Ċensu", "Xerri Censu"], "Xerri Censu"], ["xerri ċensu", ["Xerri Ċensu", "Xerri Censu"], "Xerri Ċensu"], ["mallia cettina", ["Mallia Ċettina"], "Mallia Ċettina"]]) {
      await box.fill(""); await box.pressSequentially(q, { delay: 15 });
      await p.waitForTimeout(500); // the list of the query before is gone
      await p.waitForFunction(([w, f]) => { const b = [...document.querySelectorAll("#ord-add .epp-opt b")].map((x) => x.textContent); return b[0] === f && w.every((n) => b.includes(n)); }, [want, first], { timeout: 6000 }).catch(() => {});
      const got = await p.evaluate(() => [...document.querySelectorAll("#ord-add .epp-opt b")].map((b) => b.textContent));
      t.ok(want.every((n) => got.includes(n)) && got[0] === first, `orders name field: "${q}" offers ${want.join(" and ")}, ${first} first: ${JSON.stringify(got)}`);
    }

    // Ctrl+Enter from the prescriber field: the reg no. is filled first, as Tab does; the rows are the same
    const T = "daily_register_entries", DOC = "Dr Qormi Testa", REG = "R7731";
    const seed = await t.api("POST", "/daily-register/entries", { entry_date: ymd(0), client_name: "Spiteri Ninu", client_id: "0771199M", medicine_name_dose: "Amoxil 250mg", posology: "1 tds", prescriber_name: DOC, prescriber_reg_no: REG });
    t.ok(seed && seed.ok !== false, "daily register: a line with the prescriber and reg no. seeded");
    const line = (id) => ({ entry_date: ymd(0), client_id: id, client_name: "Vella Toni", medicine_name_dose: "Clarithromycin 500mg", posology: "1 bd x 7 days" });
    const rows = {};
    for (const how of ["tab", "ctrl"]) {
      await t.open(p, "2", "dailyregister", "drreg", "[data-act=new]");
      const m = t.maxId(T);
      await p.click("[data-act=new]"); await p.waitForSelector("#drr-form");
      await t.fill(p, "#drr-form", line(how === "tab" ? "0771198M" : "0771197M"));
      await p.click("#drr-form [name=prescriber_name]"); await p.keyboard.type(DOC, { delay: 10 });
      if (how === "tab") { await p.keyboard.press("Tab"); await p.waitForTimeout(100); }
      await t.write(p, /\/daily-register\/entries$/, () => p.keyboard.press("Control+Enter"));
      rows[how] = (await t.mine(T, m, { client_id: how === "tab" ? "0771198M" : "0771197M" }))[0];
    }
    t.has("daily (Ctrl+Enter)", rows.ctrl, { prescriber_name: DOC, prescriber_reg_no: REG });
    t.same("daily (Tab vs Ctrl+Enter)", rows.tab, rows.ctrl, { client_id: "two lines, two ID cards (the same line twice would be a duplicate)" });

    // "log fridge": the fridge's line, whichever comes first on Today
    const today = await t.api("GET", "/today");
    const temps = ((today && today.before_opening) || []).filter((r) => r.kind === "temperature");
    const isFridge = (r) => r.limits && r.limits.max != null && r.limits.max <= 10;
    const fridge = temps.find((r) => isFridge(r) && r.status !== "done"), room = temps.find((r) => !isFridge(r));
    await t.open(p, "2", "today", "today", ".tdy-head h1");
    await p.keyboard.press("Control+k"); await p.waitForSelector("#esr-q"); await p.keyboard.type("log fridge", { delay: 20 });
    await p.waitForFunction(() => !document.querySelector(".esr-wait"), null, { timeout: 8000 });
    await p.keyboard.press("Enter"); await p.waitForTimeout(1200);
    const at = await p.evaluate(() => { const a = document.activeElement, r = a && a.closest && a.closest("[data-device]"); return { dev: r ? Number(r.getAttribute("data-device")) : 0, min: !!(a && a.hasAttribute && a.hasAttribute("data-min")) }; });
    if (fridge) {
      t.ok(at.dev === Number(fridge.device_id) && at.min, `log fridge: the cursor is in the fridge's line (device ${fridge.device_id}${room ? ", not the room's " + room.device_id : ""}): ${JSON.stringify(at)}`);
      // the save is answered here, not stored: tempreg.mjs and focus.mjs log today's readings at the same time and count their rows
      let sent = null;
      await p.route("**/temperature/entries", (r) => r.request().method() === "POST" ? (sent = r.request().postDataJSON(), r.fulfill({ contentType: "application/json", body: JSON.stringify({ ok: true, entry_id: 0 }) })) : r.continue());
      await p.keyboard.type("3.6"); await p.keyboard.press("Tab"); await p.keyboard.type("6.2"); await p.keyboard.press("Enter");
      for (let i = 0; i < 40 && !sent; i++) await p.waitForTimeout(100);
      await p.unroute("**/temperature/entries");
      t.ok(sent && Number(sent.device_id) === Number(fridge.device_id) && Number(sent.min_temp) === 3.6 && Number(sent.max_temp) === 6.2 && sent.entry_date === ymd(0), "log fridge: the reading is sent for the fridge, today: " + JSON.stringify(sent));
    } else {
      t.ok(!room || at.dev !== Number(room.device_id), "log fridge (the fridge is logged already): the cursor is not put in the room's line: " + JSON.stringify(at));
      t.note("log fridge: today's fridge reading was in already (another case); only 'not the room' checked");
    }
  },
};
