// Money, part 2 (b4-6b): the actions brought from the classic screens, proved against the classic on the real worker.
//  1. End of day, unlock: two identical locked days; one is unlocked in the classic screen (Unlock, its confirmation),
//     the other on the new screen (Correct this day, with a reason). The stored days are equal in every column but the
//     date and the clock; the EOD_UNLOCK audit rows are equal but for the reason the new screen adds; both screens
//     leave the same note in the classic's audit in this browser.
//  2. End of day, print on A4: the same locked day printed from the classic and from the new screen gives the same
//     sheet (every row, label and figure); the new one adds the page numbers and the time printed in the page margin.
//  3. Credit notes, undo a use: two identical notes with the same uses; one use is removed as the classic sends it,
//     the twin on the new screen (Undo, one question). Notes, remaining uses and audit rows are equal. Staff see no Undo.
// A "solo-" case: it runs alone after every other case (it adds rows to tables the others read as "the newest").
import { ymd } from "../lib.mjs";

const DAY = (d) => ({ record: { date: d, eod_date: d, time_of_day: "PM", staff: "Ġorġ Żammit", staff_name: "Ġorġ Żammit", float_amount: "150.00",
  x: [{ amount: "1250.40", remark: "Main till" }, { amount: "80.00", remark: "" }, { amount: "1.00", remark: "" }, { amount: "2.00", remark: "" }, { amount: "3.00", remark: "fifth, past the sheet" }],
  epos: [{ amount: "520.10", remark: "" }], cheques: [{ amount: "45.00", remark: "Ħal Qormi clinic" }], paid_outs: [{ amount: "12.50", remark: "Milk" }, { amount: "3.20", remark: "Stamps" }],
  cash: { n500: "0", n200: "0", n100: "2", n50: "6", n20: "10", n10: "7", n5: "3", coins_total: "59.15" }, deposit: { n500: 0, n200: 0, n100: 2, n50: 6, n20: 10, n10: 7, n5: 1 },
  bag_number: "B-321", notes: "", action: "LOCK", locked_at: new Date().toISOString() } });
const J = (s) => { try { return JSON.parse(s); } catch (e) { return s; } };
// A copy without the keys that name the row itself or its clock (at any depth).
const strip = (v, drop) => Array.isArray(v) ? v.map((x) => strip(x, drop)) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !drop.includes(k)).map((k) => [k, strip(v[k], drop)])) : v;

export default {
  title: "Money part 2: unlock, print on A4, undo a use",
  async run(t) {
    const app = t.stack.app, call = async (m, p, body) => { const r = await app.api(m, p, { token: t.token, body }); if (r.status >= 400) t.fail(`${m} ${p} answered ${r.status}: ${r.text.slice(0, 160)}`); return r.json; };
    const D1 = ymd(-20), D2 = ymd(-21), D3 = ymd(-22);
    for (const d of [D1, D2, D3]) await call("PUT", "/endofday/record", DAY(d));
    const day = (d) => t.db.prepare("SELECT * FROM end_of_day WHERE eod_date = ?").get(d);
    t.ok(day(D1)?.locked_at && day(D2)?.locked_at && day(D3)?.locked_at, "eod: the seed days were not stored locked");
    const localAudit = (p) => p.evaluate(() => { try { return JSON.parse(localStorage.getItem("eikon_eod_audit_v1") || "[]"); } catch (e) { return []; } });

    // ---- 1. unlock: classic
    const c = await t.page(), K = (k) => `[data-focus-key="${k}"]`;
    await t.open(c, "classic", "endofday", "endofday", K("meta_date"));
    const classicDay = async (d) => { await c.fill(K("meta_date"), d); await c.dispatchEvent(K("meta_date"), "change"); await c.waitForFunction((d) => { const i = document.querySelector('[data-focus-key="meta_date"]'); return i && i.value === d; }, d); await c.waitForTimeout(900); };
    await classicDay(D1);
    await c.locator("button.eikon-btn:text-is('Unlock')").first().click();
    await c.waitForSelector(".eikon-modal-overlay button.primary");
    const ask = (await c.textContent(".eikon-modal-overlay")).replace(/\s+/g, " ");
    const cu = await t.write(c, /\/endofday\/record$/, () => c.click(".eikon-modal-overlay button.primary"), "PUT");
    await c.waitForTimeout(400);
    const cLocal = (await localAudit(c)).filter((a) => a.action === "UNLOCK").pop();

    // ---- 1. unlock: new screen
    const p = await t.page();
    await t.open(p, "2", "endofday", "eodreg", "#eod-form");
    const newDay = async (d) => { if (!(await p.$("#eod-day"))) await p.click("[data-act=who]"); /* b4-4: the day sits behind Change */ await p.fill("#eod-day", d); await p.dispatchEvent("#eod-day", "change"); await p.waitForFunction((d) => document.querySelector("#eod-day")?.value === d && !/Opening/.test(document.querySelector(".eod").textContent) && document.querySelector(".eod-st"), d); await p.waitForTimeout(300); };
    await newDay(D2);
    await p.click("[data-act=fix]"); await p.waitForSelector("[name=fix_reason]");
    const askNew = (await p.textContent("[aria-label='Unlock this day to correct it']")).replace(/\s+/g, " ");
    await p.fill("[name=fix_reason]", "Cheque typed twice");
    const nu = await t.write(p, /\/endofday\/record$/, () => p.click("[data-act=fix-go]"), "PUT");
    await p.waitForSelector("#eod-fixnote", { timeout: 8000 });
    const focusNote = await p.evaluate(() => document.activeElement && document.activeElement.id);
    const nLocal = (await localAudit(p)).filter((a) => a.action === "UNLOCK").pop();
    t.ok(/Unlock this End Of Day\?/.test(ask) && /Unlock .* to correct it\?/.test(askNew) && /can be changed again/.test(askNew), "unlock: the confirmations: classic «" + ask.slice(0, 90) + "», new «" + askNew.slice(0, 120) + "»");
    t.ok(cu.body?.record?.unlock === true && cu.body.record.action === "UNLOCK" && nu.body?.record?.unlock === true && nu.body.record.action === "UNLOCK" && nu.body.record.correction_reason === "Cheque typed twice", "unlock: both send the classic's unlock (unlock:true, action UNLOCK); the new one with the reason");
    t.ok(focusNote === "eod-fixnote", "unlock: focus goes to the note saying the day is unlocked (" + focusNote + ")");
    const r1 = day(D1), r2 = day(D2);
    t.ok(!r1.locked_at && !r2.locked_at, "unlock: a day is still locked");
    t.same("eod unlock classic vs new", r1, r2, { eod_date: "the two days", saved_at: "the moment each seed was saved" });
    const au = (row) => t.db.prepare("SELECT * FROM audit_log WHERE action = 'EOD_UNLOCK' AND entity_type = 'end_of_day' AND entity_id = ? ORDER BY id DESC").get(String(row.id));
    const a1 = au(r1), a2 = au(r2);
    if (t.ok(a1 && a2, "unlock: an EOD_UNLOCK audit row is missing")) {
      const d1 = J(a1.details_json), d2 = J(a2.details_json);
      t.ok(d2.correction_reason === "Cheque typed twice" && !("correction_reason" in d1), "unlock: only the new screen's audit has the reason");
      delete d2.correction_reason;
      const drop = ["id", "eod_date", "saved_at", "updated_at", "created_at", "locked_at"];
      t.ok(JSON.stringify(strip(d1, drop)) === JSON.stringify(strip(d2, drop)), "unlock: the audit details differ beyond the reason: " + JSON.stringify(strip(d1, drop)).slice(0, 200) + " vs " + JSON.stringify(strip(d2, drop)).slice(0, 200));
      for (const k of Object.keys(a1)) if (!["id", "entity_id", "details_json", "created_at"].includes(k)) t.ok(JSON.stringify(a1[k]) === JSON.stringify(a2[k]), `unlock: audit column ${k}: classic ${a1[k]}, new ${a2[k]}`);
    }
    t.ok(cLocal && nLocal && JSON.stringify(strip(cLocal, ["ts", "date"])) === JSON.stringify(strip(nLocal, ["ts", "date"])) && nLocal.date === D2, "unlock: the classic's own audit note in this browser differs: " + JSON.stringify(cLocal) + " vs " + JSON.stringify(nLocal));

    // ---- 2. print on A4, the same locked day from both
    const grab = (pg) => pg.evaluate(() => { window.__blobs = []; const o = URL.createObjectURL; URL.createObjectURL = function (b) { if (b && b.text) b.text().then((x) => window.__blobs.push(x)); return o.call(URL, b); }; window.open = function () { return null; }; });
    await classicDay(D3); await grab(c);
    await c.locator("button.eikon-btn:text-is('Print End of Day on A4')").click();
    await c.waitForFunction(() => window.__blobs.length > 0, null, { timeout: 5000 });
    const cA4 = (await c.evaluate(() => window.__blobs[0]));
    await newDay(D3); await grab(p);
    await p.click("[data-act=print-a4]");
    await p.waitForFunction(() => window.__blobs.length > 0, null, { timeout: 5000 });
    const nA4 = await p.evaluate(() => window.__blobs[0]);
    const body = (h) => h.replace(/[\s\S]*<div class='page'>/, "").replace(/<p class='pf'>[\s\S]*?<\/p>/, "");
    t.ok(cA4 && nA4 && body(cA4) === body(nA4), "print: the A4 sheet differs from the classic's:\n" + body(cA4).slice(0, 300) + "\nvs\n" + body(nA4).slice(0, 300));
    t.ok(/counter\(page\)/.test(nA4) && /printed \d\d\/\d\d\/\d{4} \d\d:\d\d \(Malta\)/.test(nA4) && /Demo Pharmacy/.test(nA4) && /color:#000/.test(nA4) && !/<script/i.test(nA4), "print: no page numbers, Malta print time, pharmacy, black on white, or a script in the sheet");
    t.ok((await localAudit(p)).some((a) => a.action === "PRINT_A4" && a.date === D3) && (await localAudit(c)).some((a) => a.action === "PRINT_A4" && a.date === D3), "print: the classic's PRINT_A4 note is not kept in this browser by both");
    t.stack.eodA4 = nA4;

    // ---- 3. credit notes: undo a use
    const mk = async () => { const id = (await call("POST", "/creditnotes/entries", { issue_date: ymd(-4), client_name: "Ċensina", client_surname: "Undo-Test", telephone: "79000111", email: "", receipt_number: "R-9", amount: 30, expiry_date: "", no_expiry: 1 })).id;
      await call("POST", `/creditnotes/entries/${id}/purchases`, { amount: 12.5, receipt_number: "R-10" }); await call("POST", `/creditnotes/entries/${id}/purchases`, { amount: 17.5, receipt_number: "R-11" }); return id; };
    const A = await mk(), B = await mk();
    const uses = (id) => t.db.prepare("SELECT * FROM credit_note_purchases WHERE credit_note_id = ? ORDER BY id").all(id);
    const [uA] = uses(A), [uB] = uses(B);
    await call("DELETE", `/creditnotes/entries/${B}/purchases/${uB.id}`); // as the classic sends it: DELETE, no body
    await t.open(p, "2", "creditnotes", "cnreg", "#cnr-q");
    await p.fill("#cnr-q", "Undo-Test"); await p.click(`[data-act=open][data-id="${A}"]`); await p.waitForSelector(`.cnr-card[data-cn="${A}"] [data-act=undo]`); // m1: the note opens in place
    let sent = 0; const onR = (r) => { if (r.method() === "DELETE") sent++; }; p.on("request", onR);
    await p.click(`[data-act=undo][data-pid="${uA.id}"]`); await p.waitForSelector(".cnr-ask");
    const q = (await p.textContent(".cnr-ask")).replace(/\s+/g, " "), qFocus = await p.evaluate(() => document.activeElement?.getAttribute("data-act"));
    await p.keyboard.press("Escape"); await p.waitForTimeout(150);
    const escBack = await p.evaluate(() => !document.querySelector(".cnr-ask") && document.activeElement?.getAttribute("data-act") === "undo");
    t.ok(sent === 0 && escBack, "undo: Escape sent something or did not give focus back to Undo");
    p.off("request", onR);
    await p.click(`[data-act=undo][data-pid="${uA.id}"]`); await p.waitForSelector("[data-act=undo-yes]");
    let delPath = ""; p.on("request", (r) => { if (r.method() === "DELETE") delPath = new URL(r.url()).pathname; });
    const del = await t.write(p, /\/creditnotes\/entries\/\d+\/purchases\/\d+$/, () => p.click("[data-act=undo-yes]"), "DELETE"); del.path = delPath;
    await p.waitForFunction((pid) => !document.querySelector(`[data-act=undo][data-pid="${pid}"]`), uA.id, { timeout: 8000 });
    await p.waitForTimeout(200);
    const after = await p.evaluate(() => ({ act: document.activeElement?.getAttribute("data-act"), card: document.activeElement?.closest(".cnr-card")?.getAttribute("data-cn"), text: document.querySelector("#cnr-list").textContent }));
    t.ok(/Undo the use of €12\.50/.test(q) && /leaving €12\.50/.test(q) && qFocus === "undo-yes", "undo: the question: " + q + " focus " + qFocus);
    t.ok(del.status === 200 && del.body == null && del.path === `/creditnotes/entries/${A}/purchases/${uA.id}`, "undo: not the classic's DELETE without a body: " + JSON.stringify(del));
    t.ok(after.card === String(A) && after.act === "use", "undo: focus did not return to the note's Use button: " + JSON.stringify({ act: after.act, card: after.card }));
    t.same("credit note after undo", t.row("credit_notes", B), t.row("credit_notes", A), {});
    const nr = (id) => uses(id).map((r) => strip(r, ["id", "credit_note_id", "timestamp"]));
    t.ok(uses(A).length === 1 && JSON.stringify(nr(A)) === JSON.stringify(nr(B)), "undo: the uses left differ: " + JSON.stringify(nr(A)) + " vs " + JSON.stringify(nr(B)));
    const ad = (pid) => t.db.prepare("SELECT * FROM audit_log WHERE action = 'CREDITNOTE_PURCHASE_DELETE' AND entity_id = ?").get(String(pid));
    const x1 = ad(uB.id), x2 = ad(uA.id);
    if (t.ok(x1 && x2, "undo: a CREDITNOTE_PURCHASE_DELETE audit row is missing")) {
      const drop = ["id", "credit_note_id", "timestamp"];
      t.ok(JSON.stringify(strip(J(x1.details_json), drop)) === JSON.stringify(strip(J(x2.details_json), drop)), "undo: audit details differ: " + x1.details_json + " vs " + x2.details_json);
      for (const k of Object.keys(x1)) if (!["id", "entity_id", "details_json", "created_at"].includes(k)) t.ok(JSON.stringify(x1[k]) === JSON.stringify(x2[k]), `undo: audit column ${k}: classic ${x1[k]}, new ${x2[k]}`);
    }
    // a note used up is found by a search, with its uses
    await call("POST", `/creditnotes/entries/${A}/purchases`, { amount: 12.5, receipt_number: "R-12" });
    await p.reload(); await p.waitForSelector("#cnr-q"); await p.fill("#cnr-q", "Undo-Test"); await p.waitForTimeout(300); await p.click(`[data-act=open][data-id="${A}"]`); await p.waitForTimeout(150);
    const usedUp = await p.evaluate((a) => ({ lab: /Used up/.test(document.querySelector("#cnr-list").textContent), undo: !!document.querySelector(`.cnr-card[data-cn="${a}"] [data-act=undo]`), use: !!document.querySelector(`.cnr-card[data-cn="${a}"] [data-act=use]`) }), A);
    t.ok(usedUp.lab && usedUp.undo && !usedUp.use, "undo: a used-up note is not found by a search with its uses: " + JSON.stringify(usedUp));
    // staff: the uses are listed, no Undo
    if (!t.stack.staff) t.stack.staff = await app.addUser({ email: "staff-6b@demo.mt", role: "staff", name: "Sam Staff" }).catch(() => null);
    if (t.stack.staff) {
      const s = await t.page(); await s.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, t.stack.staff.token);
      await t.open(s, "2", "creditnotes", "cnreg", "#cnr-q"); await s.fill("#cnr-q", "Undo-Test"); await s.waitForTimeout(400); await s.click(".cnr-card [data-act=open]"); await s.waitForTimeout(150);
      t.ok(await s.locator(".cnr-uses li").count() > 0 && await s.locator("[data-act=undo]").count() === 0, "undo: staff see Undo, or no uses");
    }
  },
};
