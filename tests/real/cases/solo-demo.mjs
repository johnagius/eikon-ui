// One-click demo, end to end on its own real stack (its own port and database, so the demo switch never touches the
// other cases): the demo is switched on (DEMO_* as in wrangler.toml), reset through the superuser route until done, then
// a fresh browser with no sign-in presses "Try the demo pharmacy" and visits every hub and every screen in them, then
// "Try as a distributor" and "Try as head office" visit their portals. Zero page errors, zero console errors, zero CSP
// violations; the seeded people, fridges and rota appear on their screens. Screenshots go to REAL_SHOTS when set.
import { startStack } from "../stack.mjs";
import { watchCsp } from "../../csp.mjs";
import { prepareContext, contextTz } from "../../clock.mjs";
import { boardSchema } from "../../worker/boardequiv.test.mjs"; // the board keeps a per-isolate "schema ready" flag, already set by the suite's own stack

const HUB_TABS = ["today", "customers", "bookings", "stock", "registers", "services", "money", "team", "settings"];
const HUB_SCREENS = ["alerts", "nearexpiry", "ssreg", "scarcestock", "order-diary", "supplier-inventory", "returns", "stocktransfers", "quotations", "creditnotes",
  "temperature", "cleaning", "dailyregister", "locumregister", "dda-purchases", "dda-sales", "dda-poyc", "dda_stocktakes", "repeatprescriptions", "insreg", "certificates", "audit",
  "poct", "vaccines", "screening", "pharmacovigilance", "ocps", "pharmacycalc", "otcmindmap", "labels", "ownreg", "endofday", "paidout", "emergency-pos", "locumreceipts",
  "rotreg", "instructions", "messageboard", "shifts", "contacts", "teamreg", "expreg", "clientorders", "tickets", "deliveries"];
const PORTALS = { supplier: ["supplier-dashboard", "supplier-products", "supplier-received-orders", "supplier-order-feedback"], hq: ["company-dashboard", "ownreg", "admin-overview"] };

export default {
  title: "One-click demo",
  async run(t) {
    const port = Number(process.env.REAL_PORT || 8895) + 37;
    const st = await startStack(port);
    try {
      const app = st.app, db = app.DB.db;
      boardSchema(db);
      // Modules that keep a per-isolate "schema ready" flag (board, contacts) were set up by the suite's own stack in this
      // process: give this database every table the suite's database has, as a live database has them.
      for (const p of ["/contacts/clients", "/board/messages"]) await t.api("GET", p);
      for (const r of t.db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all())
        if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(r.name)) db.exec(r.sql);
      db.exec(`CREATE TABLE IF NOT EXISTS board_suggestions (id INTEGER PRIMARY KEY AUTOINCREMENT, org_id INTEGER NOT NULL, message_id INTEGER, title TEXT NOT NULL, priority TEXT NOT NULL DEFAULT 'medium',
        created_by INTEGER, created_by_name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'open', created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')));
        CREATE TABLE IF NOT EXISTS board_suggestion_comments (id INTEGER PRIMARY KEY AUTOINCREMENT, suggestion_id INTEGER NOT NULL, user_id INTEGER NOT NULL, user_name TEXT NOT NULL DEFAULT '', body TEXT NOT NULL,
        created_at TEXT NOT NULL DEFAULT (datetime('now')));`);
      db.prepare("INSERT INTO orgs (id, name) VALUES (2, 'Demo Pharmacy')").run();
      db.prepare("INSERT INTO locations (id, org_id, name) VALUES (2, 2, 'Demo Pharmacy')").run();
      Object.assign(app.env, { DEMO_ORG_ID: "2", DEMO_LOCATION_ID: "2", DEMO_PHARMACY2_LOCATION_ID: "399", DEMO_SUPPLIER_LOCATION_ID: "599", DEMO_HQ_LOCATION_ID: "899", SUPERUSER_EMAILS: "maria@demo.mt" });
      let r, n = 0;
      do { r = await app.api("POST", "/su/api/demo/reset", { token: st.token, body: {} }); n++; } while (r.json && r.json.ok && !r.json.done && n < 20);
      t.ok(r.json && r.json.done, "reset finished: " + r.text.slice(0, 300));
      t.ok(r.json && r.json.problems && r.json.problems.length === 0, "every seed call answered 2xx: " + JSON.stringify(r.json && r.json.problems));

      const errs = [], csp = [];
      const browser = (await t.page()).context().browser(); // the suite's browser
      const open = async (label, phone) => {
        const ctx = await prepareContext(await browser.newContext({ ...(phone ? { viewport: { width: 390, height: 844 }, isMobile: true, deviceScaleFactor: 2 } : { viewport: { width: 1280, height: 900 } }), ...contextTz() }));
        await watchCsp(ctx, (txt, u) => csp.push(label + ": " + txt + " (" + u + ")"));
        await ctx.route("**/*", (q) => { const u = q.request().url(); return /^(about|blob|data):/.test(u) || new URL(u).hostname === "localhost" ? q.continue() : q.abort(); });
        const p = await ctx.newPage(); p.setDefaultTimeout(15000);
        p.on("pageerror", (e) => errs.push(label + " pageerror: " + e.message.slice(0, 200)));
        p.on("console", (m) => { if (m.type() === "error") errs.push(label + " console: " + m.text().slice(0, 200)); });
        p.on("response", (x) => { if (x.status() >= 500) errs.push(label + " " + x.status() + " " + x.request().method() + " " + new URL(x.url()).pathname); });
        return { ctx, p };
      };
      const shot = async (p, name) => { if (process.env.REAL_SHOTS) await p.screenshot({ path: process.env.REAL_SHOTS + "/demo-" + name + ".png", fullPage: false }).catch(() => {}); };
      const settle = async (p) => { await p.waitForFunction(() => { const c = document.getElementById("eikon-content"); return c && c.children.length > 0 && !/Loading…$/.test(c.innerText.trim()); }, null, { timeout: 15000 }).catch(() => {}); await p.waitForTimeout(500); };
      const enter = async (p, door) => {
        await p.goto(st.base + "/ui/index.html?ui=2&intro=0");
        await p.waitForSelector("[data-demo-door=" + door + "]");
        await p.click("[data-demo-door=" + door + "]");
        return p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.user && window.EIKON.state.user.demo && document.getElementById("eikon-content"), null, { timeout: 20000 }).then(() => true, () => false);
      };

      // ---- the pharmacy
      const A = await open("pharmacy", false);
      await A.p.goto(st.base + "/ui/index.html?ui=2&intro=0");
      await A.p.waitForSelector("#eikon-demo-doors [data-demo-door]");
      await shot(A.p, "signin");
      t.ok(await enter(A.p, "pharmacy"), "Try the demo pharmacy signs in");
      const seen = {};
      for (const h of [...HUB_TABS, ...HUB_SCREENS]) {
        await A.p.goto(st.base + "/ui/index.html?ui=2&intro=0#" + h);
        await settle(A.p);
        seen[h] = await A.p.evaluate(() => (document.getElementById("eikon-content") || document.body).innerText.slice(0, 4000));
        if (HUB_TABS.includes(h) || ["temperature", "dailyregister", "shifts", "endofday", "poct"].includes(h)) await shot(A.p, h);
        t.ok(!/Eikon could not start|Something went wrong/.test(seen[h]), h + ": the screen opened");
      }
      t.ok(/Camilleri Joseph|Farrugia Carmel|Grech Paul/.test(seen.dailyregister), "daily register shows the seeded prescriptions");
      t.ok(/Vaccine Fridge|Pharmacy Fridge/.test(seen.temperature), "temperatures show the fridges");
      t.ok(/Kurt Zahra|Sarah Vella/.test(seen.shifts + seen.rotreg), "the rota shows the seeded team");
      t.ok(/Ozempic|Mounjaro/.test(seen.scarcestock + seen.ssreg), "scarce stock shows the seeded offer and need");
      t.ok(/Valsartan/.test(seen.alerts), "the recall alert is there");
      t.ok(seen.today && seen.today.length > 50, "Today has content");
      await A.ctx.close();

      // ---- distributor and head office portals
      for (const door of ["supplier", "hq"]) {
        const B = await open(door, false);
        t.ok(await enter(B.p, door), "Try as " + door + " signs in");
        await settle(B.p);
        await shot(B.p, door + "-home");
        for (const m of PORTALS[door]) {
          await B.p.evaluate((id) => { window.location.hash = "#" + id; }, m);
          await settle(B.p);
          const txt = await B.p.evaluate(() => (document.getElementById("eikon-content") || document.body).innerText.slice(0, 4000));
          seen[door + ":" + m] = txt;
          await shot(B.p, door + "-" + m);
        }
        await B.ctx.close();
      }
      t.ok(/Paracetamol|Ibuprofen|Accu-Chek|Sudocrem/.test(seen["supplier:supplier-products"]), "the distributor's products are there");
      t.ok(/Demo Pharmacy/.test(seen["supplier:supplier-received-orders"]), "the distributor sees orders from the demo pharmacies");
      t.ok(/Demo Pharmacy Sliema/.test(seen["hq:admin-overview"] + seen["hq:ownreg"] + seen["hq:company-dashboard"]), "head office shows both demo pharmacies");
      t.ok(!/Borg Pharmacy|Demo Org/.test(Object.keys(seen).filter((k) => k.startsWith("hq:")).map((k) => seen[k]).join(" ")), "head office never shows a pharmacy outside the demo group");

      // ---- a phone: the doors fit, no sideways scroll
      const C = await open("phone", true);
      await C.p.goto(st.base + "/ui/index.html?ui=2&intro=0");
      await C.p.waitForSelector("[data-demo-door=pharmacy]");
      const fit = await C.p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
      await shot(C.p, "signin-phone");
      t.ok(fit, "the sign-in screen with the doors has no sideways scroll on a phone");
      await C.ctx.close();

      for (const e of errs) t.fail(e);
      for (const v of [...new Set(csp)]) t.fail("CSP violation: " + v.slice(0, 240));
      t.note("screens visited: " + Object.keys(seen).length);
    } finally { await st.close(); }
  }
};
