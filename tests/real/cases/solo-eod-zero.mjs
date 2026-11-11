// Hotfix .179 (fresh-eyes walkthrough, "End of day can lose a day's figures and lock €0"): a day's saved figures are
// never replaced by zeros unless the person cleared them; a float change alone changes only the float; figures typed and
// not saved survive a reload, and leaving with them asks first; a day with nothing counted is locked only after
// "Nothing was counted for <day> — lock it as €0.00?" (Cancel focused); the server refuses an all-zero body over saved
// figures unless the save says confirm_zero. Solo: it writes days 20-23 days back and removes them again.
import { ymd } from "../lib.mjs";
const T = "end_of_day";
const FIG = (date) => ({ date, eod_date: date, time_of_day: "PM", staff: "Ġorġ Zammit", staff_name: "Ġorġ Zammit", float_amount: "150.00", x: [{ amount: "845.30", remark: "Main till" }], epos: [{ amount: "310.20", remark: "" }],
  cheques: [], paid_outs: [{ amount: "12.50", remark: "Milk" }], cash: { n500: "0", n200: "0", n100: "2", n50: "4", n20: "10", n10: "5", n5: "2", coins_total: "12.60" }, deposit: { n100: 2, n50: 4, n20: 10, n10: 5 }, bag_number: "B-1", notes: "", action: "SAVE" });
const J = (s) => { try { return JSON.parse(s); } catch (e) { return null; } };
const xOf = (row) => (J(row && row.x_json) || []).reduce((a, r) => a + Number(r.amount || 0), 0);
export default {
  title: "End of day: figures never replaced by zeros, drafts survive a reload, a €0 day is locked only when said",
  async run(t) {
    const D = [ymd(-20), ymd(-21), ymd(-22), ymd(-23)], del = (d) => t.db.prepare(`DELETE FROM ${T} WHERE eod_date = ?`).run(d), row = (d) => t.db.prepare(`SELECT * FROM ${T} WHERE eod_date = ?`).get(d);
    await t.api("GET", "/endofday/overview?month=" + D[0].slice(0, 7) + "&date=" + D[0]); // makes the tables on a fresh stack
    D.forEach(del);
    const openDay = async (p, d) => { // the new screen, on day d (as Money's "Close …" opens it)
      await t.open(p, "2", "today", "today");
      await p.evaluate((x) => { sessionStorage.setItem("eikon_eodreg_day", x); location.hash = "#eodreg"; }, d);
      await p.waitForFunction(() => window.EIKON.state.activeModuleId === "eodreg"); await p.waitForSelector("#eod-form"); await t.idle(p);
    };

    // 1. A float change alone on a day another till filled meanwhile: only the float changes (live: a conflict, and
    //    "Save mine over theirs" stored the screen's zeros over the figures).
    {
      const p = await t.page(); await openDay(p, D[0]);
      await t.api("PUT", "/endofday/record", { record: FIG(D[0]) });
      await p.click("[data-act=who]"); await t.fill(p, "#eod-form", { float_amount: "160" });
      await p.click("[data-act=save]"); await t.idle(p);
      const asked = await p.locator("[data-act=mine]").count();
      if (asked) { await p.click("[data-act=mine]"); await t.idle(p); }
      t.ok(!asked, "float only: saved straight away, no 'saved on another till' question");
      const r = row(D[0]);
      t.ok(r && Math.abs(xOf(r) - 845.3) < 0.005 && J(r.cash_json)?.n20 == 10, "float only: the other till's figures are kept: " + (r && r.x_json + " " + r.cash_json));
      t.ok(r && Number(r.float_amount) === 160, "float only: the float is the one typed here (160): " + (r && r.float_amount));
    }
    // 2. The classic screen: opened on an empty day, the day filled on another till, the float changed and saved.
    {
      const p = await t.page(), K = (k) => `[data-focus-key="${k}"]`;
      await t.open(p, "classic", "endofday", "endofday", K("meta_staff"));
      await p.fill(K("meta_date"), D[1]); await p.dispatchEvent(K("meta_date"), "change"); await t.idle(p);
      await t.api("PUT", "/endofday/record", { record: FIG(D[1]) });
      await t.fill(p, "", { [K("meta_staff")]: "Maria", [K("float_amount")]: "170" });
      await p.locator("button.eikon-btn.primary:has-text('Save')").first().click(); await t.idle(p, 500);
      const r = row(D[1]);
      t.ok(r && Math.abs(xOf(r) - 845.3) < 0.005, "classic float only: the other till's figures are kept: " + (r && r.x_json));
      t.ok(r && Number(r.float_amount) === 170, "classic float only: the float typed is saved (170): " + (r && r.float_amount));
    }
    // 3. Figures typed and not saved: a reload brings them back; leaving the page asks first.
    {
      const p = await t.page({ dialogs: null }); await openDay(p, D[2]);
      await t.fill(p, "#eod-form", { '[name="row:x:0:amount"]': "999.99", '[name="cash:n50"]': "3" });
      await p.reload(); await p.waitForFunction(() => window.EIKON && window.EIKON.state.activeModuleId === "eodreg"); await p.waitForSelector("#eod-form"); await t.idle(p, 500);
      const back = await p.evaluate(() => ({ d: window.EIKON.state && document.querySelector("#eod-day") ? document.querySelector("#eod-day").value : (document.querySelector(".eod-who span") || {}).textContent, x: (document.querySelector('[name="row:x:0:amount"]') || {}).value, n50: (document.querySelector('[name="cash:n50"]') || {}).value, dirty: /Not saved/.test((document.querySelector(".eod-st") || {}).textContent || "") }));
      t.ok(back.x === "999.99" && back.n50 === "3" && back.dirty, "reload: the typed figures are back and marked not saved: " + JSON.stringify(back));
      let asked = null; p.on("dialog", (dg) => { asked = dg.type(); dg.dismiss().catch(() => {}); });
      await p.close({ runBeforeUnload: true }); await new Promise((r) => setTimeout(r, 700));
      t.ok(asked === "beforeunload", "closing the tab with figures not saved asks first: " + asked);
      t.ok(!row(D[2]), "nothing was sent for the typed day");
    }
    // 4. A day saved with nothing counted: Save and lock asks "Nothing was counted … lock it as €0.00?", Cancel focused.
    {
      await t.api("PUT", "/endofday/record", { record: { ...FIG(D[3]), x: [], epos: [], paid_outs: [], cash: { coins_total: "0" }, deposit: {}, bag_number: "" } });
      const p = await t.page(); await openDay(p, D[3]);
      await p.click("[data-act=lock]"); await p.waitForTimeout(150);
      const ask = await p.evaluate(() => ({ t: (document.querySelector("[role=alertdialog]") || {}).textContent || "", f: document.activeElement && document.activeElement.textContent }));
      const lbl = await p.evaluate((d) => { const p = d.split("-"); return ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][new Date(+p[0], +p[1] - 1, +p[2]).getDay()]; }, D[3]);
      t.ok(/Nothing was counted for /.test(ask.t) && ask.t.indexOf(lbl) >= 0 && /lock it as €0\.00\?/.test(ask.t), "€0 lock: says nothing was counted for the day: " + ask.t);
      t.ok(ask.f === "Cancel", "€0 lock: Cancel has the focus: " + ask.f);
      await p.click("[role=alertdialog] [data-act=ask-no]"); await t.idle(p);
      t.ok(!row(D[3]).locked_at, "€0 lock: Cancel locks nothing");
      await p.click("[data-act=lock]"); await p.waitForTimeout(150);
      await t.write(p, /\/endofday\/record$/, () => p.click("[role=alertdialog] [data-act=lock-yes]"), "PUT"); await t.idle(p);
      t.ok(!!row(D[3]).locked_at, "€0 lock: said yes, the day is locked");
    }
    // 5. The server: an all-zero body over saved figures is refused (nothing changes) unless it says confirm_zero.
    {
      del(D[0]); await t.api("PUT", "/endofday/record", { record: FIG(D[0]) });
      const zero = { ...FIG(D[0]), x: [{ amount: "0.00", remark: "" }], epos: [], paid_outs: [], cash: { n100: "0", coins_total: "0.00" }, deposit: {}, bag_number: "" };
      const r1 = await t.stack.app.api("PUT", "/endofday/record", { token: t.token, body: { record: zero } });
      t.ok(r1.status === 409 && r1.json?.code === "would_clear_figures" && Math.abs(xOf(row(D[0])) - 845.3) < 0.005, "server: zeros over saved figures refused, figures kept: " + r1.status + " " + r1.text.slice(0, 160));
      const r2 = await t.stack.app.api("PUT", "/endofday/record", { token: t.token, body: { record: { ...zero, confirm_zero: true } } });
      t.ok(r2.status === 200 && xOf(row(D[0])) === 0, "server: confirm_zero clears them: " + r2.status);
      const r3 = await t.stack.app.api("PUT", "/endofday/record", { token: t.token, body: { record: { ...zero, float_amount: "120.00" } } });
      t.ok(r3.status === 200 && Number(row(D[0]).float_amount) === 120, "server: zeros over zeros saves as before: " + r3.status);
    }
    // 6. Figures cleared here on purpose: Save asks "Clear the figures saved for …?"; Cancel sends nothing, Clear stores €0.
    {
      del(D[1]); await t.api("PUT", "/endofday/record", { record: FIG(D[1]) });
      const p = await t.page(); await openDay(p, D[1]);
      const sent = []; p.on("request", (r) => { if (r.method() === "PUT" && /\/endofday\/record$/.test(new URL(r.url()).pathname)) sent.push(r.postData()); });
      await t.fill(p, "#eod-form", { '[name="row:x:0:amount"]': "", '[name="row:epos:0:amount"]': "", '[name="row:paid_outs:0:amount"]': "", ...Object.fromEntries(["n100", "n50", "n20", "n10", "n5"].map((k) => [`[name="cash:${k}"]`, ""])), ...Object.fromEntries(["n100", "n50", "n20", "n10"].map((k) => [`[name="dep:${k}"]`, ""])), '[name="cash:coins_total"]': "", bag_number: "" });
      await p.click("[data-act=save]"); await t.idle(p);
      const ask = await p.evaluate(() => ({ t: (document.querySelector("[role=alertdialog]") || {}).textContent || "", f: document.activeElement && document.activeElement.textContent }));
      t.ok(/Clear the figures saved for /.test(ask.t) && ask.f === "Cancel" && !sent.length, "cleared here: asked first, Cancel focused, nothing sent: " + JSON.stringify(ask) + " " + await p.evaluate(() => (document.querySelector("#eod-err") || {}).textContent) + " " + sent.length);
      await p.click("[role=alertdialog] [data-act=ask-no]"); await t.idle(p);
      t.ok(!sent.length && Math.abs(xOf(row(D[1])) - 845.3) < 0.005, "cleared here, Cancel: nothing sent, figures kept");
      await p.click("[data-act=save]"); await t.idle(p);
      await t.write(p, /\/endofday\/record$/, () => p.click("[role=alertdialog] [data-act=clear-yes]"), "PUT"); await t.idle(p);
      t.ok(xOf(row(D[1])) === 0 && /"confirm_zero":true/.test(sent[0] || ""), "cleared here, said yes: stored as €0 with confirm_zero: " + (sent[0] || "").slice(0, 80));
    }
    D.forEach(del);
  },
};
