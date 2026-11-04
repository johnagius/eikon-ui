// Typing survives "Reload this screen" and a session that ends (BACKLOG6 item 1, q6-1, core.js E.draft / E.showErrorBar /
// E.handleSessionExpired / E.renderLogin). For an order, a controlled drug sale, a paid out and a daily register line:
// the same values typed straight through and saved, then typed, the session ended ON THE SERVER (its token signed out)
// and Save pressed (a real 401), signed in again as the same person: the form is back and its Save stores the same
// row and sends the same body. Nothing is sent by itself. Signing in as someone else shows none of it. "Reload this
// screen" brings the order back. Solo: it adds rows to tables other cases read "the newest row" from.
import { ymd } from "../lib.mjs";
const KEY = "eikon_draft_v1|", PASS = "Demo-Pass-2026";
const FORMS = [
  { id: "ordreg", btn: ".ord-top [data-act=add]", form: "#ord-add", table: "client_orders_entries", path: /\/client-orders\/entries$/, gen: ["order_code"], noun: "order",
    fill: { client_name: "Keep Ċensina Borg", contact: "79001133", items: "Augmentin 625 x14 ċġħż", notes: "Ring first", needed_by: ymd(2) } },
  { id: "cdsreg", btn: "[data-act=add]", form: "#cds-add", table: "dda_sales_entries", path: /\/dda-sales\/entries$/, gen: [], noun: "controlled drug sale",
    fill: { entry_date: ymd(0), client_id_card: "0778811M", client_name: "Keep Ġorġ Żammit", client_address: "9 Triq il-Ħġejjeġ, Żebbuġ", doctor_name: "Dr Ħabela", doctor_reg_no: "R7711", prescription_serial_no: "RX-KEEP-1", '#cds-add [data-i="0"][data-k=medicine_name_dose]': "Morphine 10mg tablets", '#cds-add [data-i="0"][data-k=quantity]': "12" } },
  { id: "poreg", btn: "[data-act=add]", form: "#por-add", table: "paid_out_entries", path: /\/paid-out\/entries$/, gen: [], noun: "payment",
    fill: { payee_name: "Għawdex Couriers Ltd", fee: "12.50", invoice_no: "GC-KEEP-1", reason: "Delivery to Żebbuġ", entry_date: ymd(-1), entry_time: "10:45" } },
  { id: "drreg", btn: "[data-act=new]", form: "#drr-form", table: "daily_register_entries", path: /\/daily-register\/entries$/, gen: [], noun: "register line",
    fill: { entry_date: ymd(0), client_id: "0234511M", client_name: "Keep Farrugia Pawlu", medicine_name_dose: "Amoxil 500mg", posology: "1-1-1 x 7 days", prescriber_name: "Dr Kevin Borg", prescriber_reg_no: "R4311" } },
];
const drafts = (p) => p.evaluate((k) => Object.keys(sessionStorage).filter((x) => x.indexOf(k) === 0), KEY);
const values = (p, f) => p.evaluate((f) => { const x = document.querySelector(f); return x ? [...x.querySelectorAll("input,select,textarea")].filter((e) => e.type !== "hidden").map((e) => e.type === "checkbox" ? e.checked : e.value) : null; }, f);
const strip = (o, gen) => { const c = { ...(o || {}) }; for (const k of gen) delete c[k]; return JSON.stringify(c); };
async function save(t, p, F) {
  const sub = F.form + " button[type=submit]";
  return t.write(p, F.path, async () => {
    await p.click(sub);
    if (F.id === "cdsreg") { const dup = await p.waitForSelector(".cds-dup", { timeout: 1500 }).catch(() => null); if (dup) await p.click(sub); }
  });
}
async function signIn(p, email) {
  await p.waitForSelector("#eikon-login-form");
  await p.fill("#eikon-login-email", email); await p.fill("#eikon-login-pass", PASS); await p.keyboard.press("Enter");
  await p.waitForFunction(() => window.EIKON && EIKON.state && EIKON.state.user && EIKON.state.activeModuleId && document.getElementById("eikon-content"), null, { timeout: 15000 });
}
export default {
  title: "Typing survives Reload this screen and a session that ends; never shown to another person",
  async run(t) {
    const app = t.stack.app;
    try { await app.addUser({ orgId: 1, locationId: 1, email: "q61staff@demo.mt", password: PASS, name: "Karl Vella", role: "staff" }); } catch (e) { t.note("staff: " + e.message); }
    const p = await t.page({ phone: true });
    // a session of its own, so ending it touches no other case
    const L = await app.api("POST", "/auth/login", { body: { email: "maria@demo.mt", password: PASS } });
    await p.goto(t.base + "?ui=2#today"); await p.evaluate((tok) => { localStorage.setItem("eikon_token", tok); localStorage.setItem("eikon_active_role", "pharmacy"); }, L.json.token);
    let token = L.json.token;
    const writes = []; p.on("request", (r) => { if (r.method() !== "GET" && !/\/auth\//.test(new URL(r.url()).pathname)) writes.push(r.method() + " " + new URL(r.url()).pathname); });
    const openScreen = async (F) => { await p.evaluate((h) => { location.hash = "#" + h; }, F.id); await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, F.id); await t.idle(p); };
    await t.open(p, "2", "today", "today");
    let kept = 0;
    for (const F of FORMS) {
      await openScreen(F);
      // 1. typed straight through
      let m = t.maxId(F.table);
      await p.click(F.btn); await p.waitForSelector(F.form);
      await t.fill(p, F.form, F.fill);
      const a = await save(t, p, F); await t.idle(p);
      const rowA = t.since(F.table, m).pop();
      // 2. typed, the session ends on the server, Save gets a 401
      await p.click(F.btn); await p.waitForSelector(F.form);
      await t.fill(p, F.form, F.fill);
      const typed = await values(p, F.form);
      await app.api("POST", "/auth/logout", { token }); // as Team › New password / Switch off / Sign out elsewhere end it
      const w0 = writes.length; m = t.maxId(F.table);
      await p.click(F.form + " button[type=submit]");
      await p.waitForSelector("#eikon-login-form", { timeout: 10000 }); await t.idle(p); // the press's own requests (a lookup, then its POST) are all answered
      const card = await p.evaluate(() => document.getElementById("eikon-login-form").innerText.replace(/\s+/g, " "));
      t.ok(/Your session has ended\. What you were typing is kept for when you sign in again\./.test(card), `${F.id}: the sign-in card says the typing is kept: "${card}"`);
      t.ok((await drafts(p)).some((k) => k.endsWith("|" + F.id)), `${F.id}: the form was kept before the sign-in card`);
      t.ok(await p.evaluate(() => document.getElementById("eikon-login-email").value === "maria@demo.mt" && document.activeElement && document.activeElement.id === "eikon-login-pass"), `${F.id}: the e-mail is filled in and the cursor is in Password`);
      t.ok(t.since(F.table, m).length === 0, `${F.id}: the refused Save stored nothing`);
      // 3. same person signs in again: back on the screen, the form as typed, nothing sent
      const w1 = writes.length;
      await signIn(p, "maria@demo.mt");
      token = await p.evaluate(() => localStorage.getItem("eikon_token"));
      await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m, F.id, { timeout: 10000 }).catch(() => {});
      await p.waitForSelector(".eikon-draft", { timeout: 6000 }).catch(() => {});
      await t.idle(p);
      const line = await p.evaluate(() => (document.querySelector(".eikon-draft") || {}).innerText || "");
      const now = await values(p, F.form);
      const ok = JSON.stringify(now) === JSON.stringify(typed);
      if (ok) kept++;
      t.ok(await p.evaluate(() => EIKON.state.activeModuleId) === F.id, `${F.id}: signing in again returns to the screen`);
      t.ok(new RegExp("^Your unsaved " + F.noun + " is back").test(line.trim()) && /Clear/.test(line), `${F.id}: "Your unsaved ${F.noun} is back · Clear": "${line}"`);
      t.ok(ok, `${F.id}: the form came back exactly as typed: ${JSON.stringify(now)} vs ${JSON.stringify(typed)}`);
      t.ok(writes.length === w1, `${F.id}: nothing was sent by itself after signing in (${writes.slice(w1).join(", ")})`);
      t.ok(writes.slice(w0).filter((w) => F.path.test(w.split(" ")[1])).length === 1, `${F.id}: only the refused press reached the server: ${writes.slice(w0).join(", ")}`);
      // 4. its Save stores what typing straight through stored
      m = t.maxId(F.table);
      const b = await save(t, p, F); await t.idle(p);
      const rowB = t.since(F.table, m).pop();
      t.ok(strip(a.body, F.gen) === strip(b.body, F.gen), `${F.id}: the restored form sent the same body as typing it: ${strip(a.body, F.gen)} vs ${strip(b.body, F.gen)}`);
      t.same(`${F.id} (typed vs kept through a sign-in)`, rowA, rowB, Object.fromEntries(F.gen.map((g) => [g, "a new code for each one"])));
      t.ok(!(await drafts(p)).length, `${F.id}: no draft is left after the save`);
    }
    t.note(`kept through a 401 and a sign-in: ${kept}/${FORMS.length}`);
    // 5. another person signs in after the session ended: none of it is shown, and it is gone from the tab
    {
      const F = FORMS[0];
      await openScreen(F);
      await p.click(F.btn); await p.waitForSelector(F.form); await t.fill(p, F.form, F.fill);
      await app.api("POST", "/auth/logout", { token });
      await p.click(F.form + " button[type=submit]"); await p.waitForSelector("#eikon-login-form"); await t.idle(p);
      t.ok((await drafts(p)).length === 1, "staff: maria's order was kept when her session ended");
      const w1 = writes.length;
      await signIn(p, "q61staff@demo.mt");
      await t.idle(p); await p.waitForTimeout(1200);
      const st = await p.evaluate(() => ({ line: !!document.querySelector(".eikon-draft"), form: !!document.querySelector("#ord-add"), vals: [...document.querySelectorAll("#eikon-content input,#eikon-content textarea")].map((e) => e.value).filter((v) => /Keep|Augmentin/.test(v)), keys: Object.keys(sessionStorage).filter((k) => k.indexOf("eikon_draft_v1|") === 0), user: EIKON.state.user && EIKON.state.user.email }));
      t.ok(st.user === "q61staff@demo.mt" && !st.line && !st.form && !st.vals.length, `staff: another person sees none of maria's typing: ${JSON.stringify(st)}`);
      t.ok(!st.keys.length, `staff: maria's draft is gone from the tab once someone else signs in: ${JSON.stringify(st.keys)}`);
      t.ok(writes.length === w1, `staff: nothing was sent by itself (${writes.slice(w1).join(", ")})`);
      // and maria signing back in after staff finds nothing either: it was dropped, not hidden
      await p.evaluate(() => EIKON.logout()); await signIn(p, "maria@demo.mt"); await t.idle(p); await p.waitForTimeout(800);
      t.ok(!(await p.$(".eikon-draft")) && !(await drafts(p)).length, "staff: maria signing in after staff finds no old draft");
      token = await p.evaluate(() => localStorage.getItem("eikon_token"));
    }
    // 6. "Reload this screen" (the error bar) brings the half-typed order back; nothing is sent
    {
      const F = FORMS[0];
      await openScreen(F);
      await p.click(F.btn); await p.waitForSelector(F.form); await t.fill(p, F.form, F.fill);
      const typed = await values(p, F.form);
      await p.evaluate(() => EIKON.showErrorBar("q6-1 test"));
      await p.waitForSelector("#eikon-error-bar");
      const w1 = writes.length;
      await Promise.all([p.waitForEvent("load"), p.click("#eikon-error-bar [data-act=reload]")]);
      await p.waitForFunction(() => window.EIKON && EIKON.state && EIKON.state.activeModuleId === "ordreg", null, { timeout: 15000 });
      await p.waitForSelector(".eikon-draft", { timeout: 6000 }).catch(() => {});
      await t.idle(p);
      const now = await values(p, F.form), line = await p.evaluate(() => (document.querySelector(".eikon-draft") || {}).innerText || "");
      t.ok(JSON.stringify(now) === JSON.stringify(typed) && /^Your unsaved order is back/.test(line.trim()), `reload: the order came back after Reload this screen: ${JSON.stringify(now)} "${line}"`);
      t.ok(writes.length === w1, `reload: nothing was sent by itself (${writes.slice(w1).join(", ")})`);
      await p.click(F.form + " [data-act$=cancel]");
    }
    await app.api("POST", "/auth/logout", { token });
  },
};
