// typing (Team round 2): on a fresh page load the new layout draws the first screen, then loads the other screens in the
// background (index.html LATER, E._lateIn, the "eikon:modules" event). Their arrival used to draw the open hub again
// (modules.hubs.js), which could drop what someone had started typing, move the keyboard to the heading, and (when
// focus was in a form) leave the late cards out for the whole visit. Here the last background file (registry.js) is
// held back until the person is already typing or has the keyboard on a button, on Stock, Customers, Team and
// Registers (today's temperature readings), then let through while they keep typing: every letter stays, focus stays
// where it was, nothing is sent, and the late cards (and the Registers status chips) still appear.
const LATE = /\/registry\.js(\?|$)/;
async function fresh(t, hub, token) {
  const p = await t.page();
  if (token) await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, token);
  let release; const held = new Promise((r) => { release = r; });
  await p.route(LATE, async (r) => { await held; await r.continue(); });
  const writes = []; p.on("request", (r) => { if (r.method() !== "GET") writes.push(r.method() + " " + new URL(r.url()).pathname); });
  await p.goto(t.base + "?ui=2#" + hub, { waitUntil: "domcontentloaded" });
  await p.waitForFunction((m) => window.EIKON && EIKON.state && EIKON.state.user && EIKON.state.activeModuleId === m, hub, { timeout: 20000 });
  return { p, writes, release };
}
const lateNow = (p) => p.evaluate(() => !!window.EIKON._lateIn);
async function arrive(p, release, more) { // let the late screens in while the person goes on typing
  release();
  if (more) await p.keyboard.type(more, { delay: 40 });
  await p.waitForFunction(() => window.EIKON._lateIn, null, { timeout: 20000 });
  await p.waitForTimeout(600);
}
const shot = (p, n) => process.env.REAL_SHOTS ? p.screenshot({ path: process.env.REAL_SHOTS + "/typing-late-" + n + ".png" }).catch(() => {}) : null;
const focusDesc = (p) => p.evaluate(() => { const a = document.activeElement; return a ? (a.tagName + (a.name ? "[name=" + a.name + "]" : "") + (a.id ? "#" + a.id : "") + " " + (a.closest("form[id]") ? "in #" + a.closest("form[id]").id : "") + " " + a.textContent.trim().slice(0, 30)).trim() : "none"; });

// Registers runs in a pharmacy of its own: its rows need a device not logged today, and tempreg, tempnote and focus log
// today's readings in the suite's pharmacy at the same time (in the full suite typing-late found them all logged).
async function ownPharmacy(t) {
  const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
  // a pharmacy's id is under 400 (E.getRolesForUser: 400 and up are supplier and company portals, which other cases add)
  const loc = Number(db.prepare("SELECT COALESCE(MAX(id), 0) + 1 AS n FROM locations WHERE id < 400").get().n);
  db.prepare("INSERT INTO locations (id, org_id, name) VALUES (?, ?, ?)").run(loc, org, "Typing Late Pharmacy");
  const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "typing-late@demo.mt", role: "admin", name: "Rita Camilleri" });
  const r = await t.stack.app.api("GET", "/temperature/devices", { token: u.token }); // its devices, as on a first visit
  if (!(r.json && (r.json.devices || []).length)) throw new Error("typing-late: no temperature devices in its pharmacy: " + String(r.text).slice(0, 160));
  return u.token;
}

export default {
  title: "Typing and focus survive the late screens arriving after a fresh load (Stock, Customers, Team, Registers)",
  async run(t) {
    // ---- Stock: Add an item, typed while the late screens arrive
    {
      const { p, writes, release } = await fresh(t, "stock");
      await p.waitForSelector(".stk-head [data-act=add]"); await t.idle(p);
      const before = await p.evaluate(() => document.querySelectorAll(".hub-card[data-open=returns]").length);
      await p.click(".stk-head [data-act=add]"); await p.waitForSelector("#stk-add [name=item_name]");
      await p.click("#stk-add [name=item_name]");
      await p.keyboard.type("Ħ-late Panadol");
      const early = !(await lateNow(p));
      await arrive(p, release, " 500mg");
      await p.keyboard.type(" x2");
      await shot(p, "stock");
      const v = await p.inputValue("#stk-add [name=item_name]"), f = await focusDesc(p);
      const after = await p.evaluate(() => ({ returns: document.querySelectorAll(".hub-card[data-open=returns]").length, cards: document.querySelectorAll(".hub-card[data-open]").length, form: !!document.querySelector("#stk-add") }));
      t.ok(early && before === 0, `stock: the late screens were still loading while typing started (late in: ${!early}, Returns card before: ${before})`);
      t.ok(v === "Ħ-late Panadol 500mg x2", `stock: Add an item kept every letter typed while the late screens arrived: "${v}"`);
      t.ok(/item_name.*in #stk-add/.test(f), `stock: the keyboard stayed in the item field: ${f}`);
      t.ok(after.form && after.returns === 1 && after.cards >= 8, `stock: the late cards appeared under the open form: ${JSON.stringify(after)}`);
      t.ok(!writes.length, `stock: nothing was sent: ${writes.join(", ")}`);
    }
    // ---- Customers: the search, typed while the late screens arrive
    {
      const { p, writes, release } = await fresh(t, "customers");
      await p.waitForSelector("#cus-q"); await t.idle(p);
      await p.click("#cus-q"); await p.keyboard.type("Bor");
      const early = !(await lateNow(p));
      await arrive(p, release, "g Ma");
      await p.keyboard.type("ria");
      const v = await p.inputValue("#cus-q"), f = await focusDesc(p), late = await p.evaluate(() => !!(window.EIKON._lateIn && window.EIKON.modules.ordreg));
      t.ok(early, "customers: the late screens were still loading while typing started");
      t.ok(v === "Borg Maria" && /#cus-q/.test(f), `customers: the search kept every letter and the keyboard: "${v}", ${f}`);
      t.ok(late, "customers: the late screens are in");
      t.ok(!writes.length, `customers: nothing was sent: ${writes.join(", ")}`);
    }
    // ---- Team: the keyboard on today's "Plan shifts" while the late screens arrive
    {
      const { p, writes, release } = await fresh(t, "team");
      const btn = p.locator("#tmt-slot button", { hasText: "Plan shifts" }).first();
      await btn.waitFor(); await t.idle(p);
      await btn.focus();
      const before = await p.evaluate(() => document.querySelectorAll(".hub[data-hub=team] .hub-card[data-open]").length);
      const early = !(await lateNow(p));
      await arrive(p, release);
      await shot(p, "team");
      const f = await focusDesc(p), after = await p.evaluate(() => ({ cards: document.querySelectorAll(".hub[data-hub=team] .hub-card[data-open]").length, shifts: !!document.querySelector(".hub-card[data-open=shifts]") }));
      t.ok(early, "team: the late screens were still loading while the keyboard was on Plan shifts");
      t.ok(/^BUTTON.*Plan shifts/.test(f), `team: the keyboard stayed on Plan shifts (not moved to the heading): ${f}`);
      t.ok(after.cards > before && after.shifts, `team: the late cards appeared (${before} before, ${after.cards} after, Plan shifts card: ${after.shifts})`);
      t.ok(!writes.length, `team: nothing was sent: ${writes.join(", ")}`);
    }
    // ---- Registers: today's temperature reading typed while the late screens arrive
    const regTok = await ownPharmacy(t);
    {
      const { p, writes, release } = await fresh(t, "registers", regTok);
      const form = "#rgt-slot form[data-rgt-log]";
      await p.waitForSelector(form + " [name=min]"); await t.idle(p);
      await p.locator(form + " [name=min]").first().click(); await p.keyboard.type("3.5");
      await p.locator(form + " [name=max]").first().click(); await p.keyboard.type("7");
      const early = !(await lateNow(p));
      await arrive(p, release, ".2");
      await p.keyboard.type("5");
      const r1 = await p.evaluate((s) => { const f = document.querySelector(s); return { min: f.querySelector("[name=min]").value, max: f.querySelector("[name=max]").value, focus: document.activeElement === f.querySelector("[name=max]") }; }, form);
      const cards = await p.evaluate(() => ({ n: document.querySelectorAll(".hub[data-hub=registers] .hub-card[data-open]").length, temp: !!document.querySelector(".hub-card[data-open=temperature]") }));
      t.ok(early, "registers: the late screens were still loading while the reading was typed");
      t.ok(r1.min === "3.5" && r1.max === "7.25" && r1.focus, `registers: the reading kept every digit and the keyboard: ${JSON.stringify(r1)}`);
      t.ok(cards.temp && cards.n >= 5, `registers: the late cards appeared: ${JSON.stringify(cards)}`);
      t.ok(!writes.length, `registers: nothing was sent: ${writes.join(", ")}`);
      // the status chips on the late cards come once nothing typed is held there (cleared here; Log would save it)
      await p.locator(form + " [name=min]").first().fill(""); await p.locator(form + " [name=max]").first().fill("");
      await p.locator("#rgt-slot button:not(form button)").first().focus(); await p.waitForTimeout(800);
      const chip = await p.evaluate(() => !!document.querySelector(".hub-card[data-open=temperature] .rgt-chip"));
      t.ok(chip, "registers: the status chip on the late Temperature card appears once nothing typed is held");
    }
    // ---- Registers again: an unsaved reading, the keyboard on a button outside its form as the late screens arrive
    {
      const { p, writes, release } = await fresh(t, "registers", regTok);
      const form = "#rgt-slot form[data-rgt-log]";
      await p.waitForSelector(form + " [name=min]"); await t.idle(p);
      await p.locator(form + " [name=min]").first().click(); await p.keyboard.type("4.1");
      await p.locator(form + " [name=max]").first().click(); await p.keyboard.type("6.8");
      const out = p.locator("#rgt-slot button:not(form button)").first(); const label = (await out.textContent()).trim();
      await out.focus();
      const early = !(await lateNow(p));
      await arrive(p, release);
      await shot(p, "registers");
      const r = await p.evaluate((s) => { const f = document.querySelector(s); return { min: f.querySelector("[name=min]").value, max: f.querySelector("[name=max]").value }; }, form), f = await focusDesc(p);
      const temp = await p.evaluate(() => !!document.querySelector(".hub-card[data-open=temperature]"));
      t.ok(early, "registers (unsaved): the late screens were still loading");
      t.ok(r.min === "4.1" && r.max === "6.8", `registers (unsaved): the typed reading stayed: ${JSON.stringify(r)}`);
      t.ok(f.startsWith("BUTTON") && f.includes(label), `registers (unsaved): the keyboard stayed on "${label}": ${f}`);
      t.ok(temp, "registers (unsaved): the late cards appeared");
      t.ok(!writes.length, `registers (unsaved): nothing was sent: ${writes.join(", ")}`);
    }
  },
};
