// FIN-dayzero: the first day of a new pharmacy (W9, W10, W11, W12, W13, W29, W31). A pharmacy created today, with nothing
// in it, signed in as its owner (admin), on the real worker:
//  - Team, Registers, Money and Today blame nothing from before it existed: no red "Needs you now", no sign-off or
//    stock take for last month, no "Yesterday not closed"; a calm "getting ready" list instead (opening hours, the rota,
//    the pharmacist in charge "not recorded", with one tap into the locum register);
//  - Today's "Getting ready" list: Set hours opens the opening hours sheet (not the rota), and the sheet closes when the
//    screen changes (W12); the pharmacy's details line goes once they are saved;
//  - Settings: no "What's new … and 37 more" on a pharmacy started today; no green box round the focused title;
//  - the busy demo pharmacy still says when it started (months ago) and keeps its own list.
// axe (WCAG 2.1 A/AA) on the hubs at 1280 and 390, light and dark (AXE=path to axe.min.js).
import fs from "node:fs";
const AXE = process.env.AXE || "/tmp/claude-0/-home-user-eikon-ui/a14b1a07-7863-5333-b96b-a89485eb56dd/scratchpad/axe/node_modules/axe-core/axe.min.js";
export default {
  title: "Day 0 of a new pharmacy: no blame before it existed, a calm getting-ready list",
  async run(t) {
    const db = t.db;
    const org = Number(db.prepare("INSERT INTO orgs (name) VALUES ('Fresh Org')").run().lastInsertRowid);
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, 'Ħamrun Pharmacy')").run(org).lastInsertRowid);
    const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "owner.dz@fresh.mt", role: "admin", name: "Joseph Camilleri" });
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    t.ok(u.user.location_since === today, "the sign-in says the pharmacy started today: " + u.user.location_since);
    const axeOn = fs.existsSync(AXE), axeSrc = axeOn ? fs.readFileSync(AXE, "utf8") : "";
    const axe = async (p, label) => {
      if (!axeOn) { t.note("axe not found at " + AXE); return; }
      await p.evaluate(axeSrc);
      const v = await p.evaluate(async () => (await window.axe.run(document.querySelector("#eikon-root") || document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((x) => x.id + " " + x.nodes[0].target.join(" ")));
      t.ok(!v.length, "axe " + label + ": " + v.join(" | "));
    };
    const pageAs = async (opts) => {
      const p = await t.page(opts);
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token); // after the default one: this pharmacy's owner
      return p;
    };
    const p = await pageAs();
    const text = (sel) => p.evaluate((s) => (document.querySelector(s) || {}).innerText || "", sel);

    // ---- Team
    await t.open(p, "2", "team", "team", ".tmt-sum");
    await p.waitForFunction(() => document.querySelector(".tmt-list .tmt-row") || /Getting ready/.test((document.querySelector(".tmt-sum") || {}).textContent || ""), null, { timeout: 10000 });
    const team = await p.evaluate(() => ({ rows: [...document.querySelectorAll(".tmt-row")].map((r) => r.className + "|" + r.querySelector("b").textContent), sum: document.querySelector(".tmt-sum").textContent,
      chips: [...document.querySelectorAll(".tmt-chip")].map((c) => c.className + "|" + c.textContent), all: document.querySelector(".tmt").innerText }));
    t.ok(!team.rows.some((r) => /problem/.test(r)) && !/Needs you now|Right now/.test(team.all) && !team.chips.some((c) => /problem/.test(c)), "Team: nothing red on day 0 " + JSON.stringify(team.rows));
    // the pharmacist-in-charge line shows while the pharmacy is open (the default hours, 07:30–19:30 Malta time)
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date()), open = hm >= "07:31" && hm < "19:29";
    t.ok(team.rows.some((r) => /Plan who works here/.test(r)) && team.rows.some((r) => /Set your opening hours/.test(r)) && (!open || team.rows.some((r) => /todo\|Pharmacist in charge not recorded/.test(r))), "Team: a calm getting-ready list (hours, the rota" + (open ? ", the pharmacist in charge not recorded" : "; closed now: no pharmacist line") + ") " + JSON.stringify(team.rows));
    t.ok(/Getting ready/.test(team.sum), "Team: the line at the top says getting ready: " + team.sum);
    // W13: one tap into the locum register
    if (open) { await p.click('.tmt-row[data-tmt="pic"] button'); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "locreg", null, { timeout: 8000 }); t.ok(true, "Team: Record opens the locum register"); }
    else t.note("closed now (" + hm + "): the Record tap is checked during opening hours");
    // ---- Registers
    await t.open(p, "2", "registers", "registers", ".rgt-sum");
    const reg = await text(".rgt");
    t.ok(!/Sign-off for|signed off/.test(reg) && !/stock take/i.test(reg.replace(/Controlled drug stock takes?\n[^\n]*\n/g, "")), "Registers: no sign-off or stock take asked for a month before the pharmacy existed");
    // ---- Money
    await t.open(p, "2", "money", "money", ".mny-sum");
    const mon = await text(".mny"), chip = await p.evaluate(() => [...document.querySelectorAll(".mny-chip")].map((c) => c.textContent).join("|"));
    t.ok(!/Yesterday|not closed|No end of day was saved/.test(mon) && !/not closed/.test(chip), "Money: no day before the pharmacy existed to close: " + mon.split("\n").slice(0, 3).join(" / ") + " · " + chip);
    // ---- End of day (integrator, batch-20): no "Nothing was saved for yesterday", no day before the start counted "not closed"
    await t.open(p, "2", "endofday", "eodreg", "#eod-form");
    await p.waitForSelector(".eod-dr");
    const eod = await p.evaluate(() => ({ prev: (document.querySelector(".eod-prev") || {}).textContent || "", sum: (document.querySelector("[data-b=mdays]") || {}).textContent || "",
      chips: [...document.querySelectorAll(".eod-dr")].map((b) => b.dataset.d + "=" + b.querySelector(".eod-chip").textContent) }));
    t.ok(!eod.prev && !/not closed/.test(eod.sum) && !eod.chips.some((c) => /Not closed$/.test(c)) && eod.chips.some((c) => /=Before the start$/.test(c)) === (today.slice(8) !== "01"),
      "End of day: days before the pharmacy started are not \"not closed\": " + JSON.stringify(eod));
    // ---- Settings: no old What's new, no ring round the title
    await t.open(p, "2", "settings", "settings", '.hub-card[data-open="phdreg"]');
    await p.waitForTimeout(800);
    const st = await p.evaluate(() => ({ wn: (document.querySelector("#hub-wn-slot") || {}).innerText || "", card: !!document.querySelector('.hub-card[data-open="phdreg"]'),
      h1: (() => { const h = document.querySelector(".hub h1"); return h ? getComputedStyle(h).outlineStyle + "/" + (document.activeElement === h) : ""; })() }));
    t.ok(!/37 more|and \d+ more/.test(st.wn), "Settings: no What's new from before the pharmacy started: " + st.wn.slice(0, 80));
    t.ok(st.card, "Settings › This pharmacy: Pharmacy details");
    t.ok(!/solid|auto/.test(st.h1.split("/")[0]), "Settings: the focused title has no ring (" + st.h1 + ")");
    await axe(p, "Settings, 1280 light");
    // ---- Today: Getting ready; Set hours opens the hours sheet; it closes on a route change
    await t.open(p, "2", "today", "today", ".tdy-setup");
    const setup = await p.evaluate(() => [...document.querySelectorAll(".tdy-setup li")].map((li) => li.getAttribute("data-setup")));
    t.ok(setup.indexOf("hours") >= 0 && setup.indexOf("details") >= 0, "Today: Getting ready lists the opening hours and the pharmacy's details: " + setup.join());
    const sub = await p.evaluate(() => [...document.querySelectorAll('.tdy-row[data-kind="temperature"] .tdy-t span')].map((s) => s.textContent).join("|"));
    t.ok(!/No reading yesterday/.test(sub), "Today: no 'No reading yesterday' for a pharmacy that did not exist yesterday: " + sub);
    const tile = await p.evaluate(() => [...document.querySelectorAll(".tdy-tile")].map((x) => x.innerText).join("|"));
    t.ok(!/€0\.00/.test(tile) && /Nothing paid out/.test(tile), "Today: Money today says nothing was paid out, not €0.00");
    await p.click('.tdy-setup [data-setup="hours"] button');
    await p.waitForSelector('.rps-ov[data-rotaset="hours"]', { timeout: 10000 });
    const hrs = await p.waitForSelector('.rps-ov[data-rotaset="hours"] [name=open1]', { timeout: 10000 }).then(() => true, () => false);
    t.ok(hrs && await p.evaluate(() => window.EIKON.state.activeModuleId === "today"), "Today: Set hours opens the opening hours (not the rota)");
    await p.evaluate(() => { location.hash = "#money"; }); await p.waitForFunction(() => window.EIKON.state.activeModuleId === "money", null, { timeout: 8000 });
    await p.waitForTimeout(300);
    t.ok(await p.evaluate(() => !document.querySelector(".rps-ov")), "W12: the sheet closes when the screen changes (nothing left over the next screen)");
    await p.click('.hub-card[data-open="paidout"]', { timeout: 5000 }).catch((e) => t.note("click: " + e.message.split("\n")[0]));
    t.ok(await p.waitForFunction(() => window.EIKON.state.activeModuleId !== "money", null, { timeout: 8000 }).then(() => true, () => false), "W12: the next screen takes clicks (Paid out opens)");
    // ---- axe on the hubs, phone and dark
    for (const [hash, mod, sel] of [["team", "team", ".tmt-sum"], ["registers", "registers", ".rgt-sum"], ["money", "money", ".mny-sum"]]) {
      await t.open(p, "2", hash, mod, sel); await axe(p, hash + ", 1280 light");
    }
    const ph = await pageAs({ phone: true });
    await ph.emulateMedia({ colorScheme: "dark" });
    for (const [hash, mod, sel] of [["team", "team", ".tmt-sum"], ["today", "today", ".tdy-setup"]]) {
      await t.open(ph, "2", hash, mod, sel); await axe(ph, hash + ", 390 dark");
      const w = await ph.evaluate(() => document.documentElement.scrollWidth); t.ok(w <= 390, hash + ": no sideways scroll at 390 (" + w + ")");
    }
    // ---- the busy demo pharmacy: started long ago, unchanged rules
    const me = await t.api("GET", "/auth/me");
    t.ok(me && me.user && me.user.location_since && me.user.location_since < today, "the busy pharmacy started before today: " + (me && me.user && me.user.location_since));
  }
};
