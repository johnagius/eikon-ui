// q5-10a: Credit notes prints one note on the classic one-note page and keeps its notes (add, remove) as the classic
// does; End of day copies the deposit for the bank email with the classic's own HTML and plain text. Each against the
// classic screen on the same data: the printed page and the clipboard byte for byte, the note rows and audit rows
// column by column. Solo (last, alone): it reads today's End of day, which the eodreg case rewrites.
import { ymd } from "../lib.mjs";
const PRINTED = /Printed: [^<]*/; // the moment of printing (new Date().toLocaleString()), the only part that may differ
export default {
  title: "Money 10a: print a credit note, its notes, the deposit email",
  async run(t) {
    const p = await t.page();
    await p.context().addInitScript(() => {
      window.print = () => {}; // the print tab is kept from printing so its page can be read
      try { navigator.clipboard.write = async (items) => { const it = items[0]; window.__clip = { html: await (await it.getType("text/html")).text(), plain: await (await it.getType("text/plain")).text() }; }; } catch (e) {}
    });
    const grab = async (click) => { const [w] = await Promise.all([p.waitForEvent("popup"), click()]); await w.waitForLoadState(); await w.waitForTimeout(400); const h = await w.evaluate(() => document.documentElement.outerHTML); await w.close(); return h; };

    // ---- a credit note with a use and a note, Maltese letters
    const T = "credit_notes", m0 = t.maxId(T);
    await t.api("POST", "/creditnotes/entries", { issue_date: ymd(-3), client_name: "Ċensina", client_surname: "Zammit", telephone: "79111222", email: "censina@example.mt", receipt_number: "R-10A1", amount: "40", expiry_date: ymd(200), no_expiry: 0 });
    const id = t.since(T, m0)[0].id;
    await t.api("POST", `/creditnotes/entries/${id}/purchases`, { amount: 12.5, receipt_number: "R-10A2" });
    await t.api("POST", `/creditnotes/entries/${id}/notes`, { text: "Returned Ħ-brand syrup <unopened>" });

    // print: classic vs new
    await t.open(p, "classic", "creditnotes", "creditnotes", "#cn-new");
    await p.fill("#cn-search, input[placeholder*='Search']", "R-10A1").catch(() => {});
    await p.click(`text=Zammit`); await p.waitForSelector("#cn-print-cn");
    const classic = await grab(() => p.click("#cn-print-cn"));
    await t.open(p, "2", "creditnotes", "cnreg", "#cnr-q"); await p.fill("#cnr-q", "#" + id); await p.waitForSelector(`[data-act=print][data-id="${id}"]`); // m1: the note found by its number opens by itself
    const fresh = await grab(() => p.click(`[data-act=print][data-id="${id}"]`));
    const c1 = classic.replace(PRINTED, ""), f1 = fresh.replace(PRINTED, "");
    t.ok(classic.length > 1500 && c1 === f1, "print: the new screen's page is the classic one, byte for byte (but the time printed)" + (c1 === f1 ? "" : ` (classic ${c1.length} chars, new ${f1.length})`));
    t.ok(/Ċensina Zammit/.test(fresh) && /Returned Ħ-brand syrup &lt;unopened&gt;/.test(fresh) && /R-10A2/.test(fresh) && /€27\.50/.test(fresh), "print: name, note (escaped), use and balance are on it");

    // notes: add and remove, classic vs new: the same rows and the same audit rows
    const N = "credit_note_notes", A = "audit_log";
    const auditSince = (a0, act) => t.db.prepare(`SELECT * FROM ${A} WHERE id > ? AND action = ?`).all(a0, act);
    const aMax = () => t.maxId(A);
    // classic add
    let n0 = t.maxId(N), a0 = aMax();
    await t.open(p, "classic", "creditnotes", "creditnotes", "#cn-new");
    await p.click(`text=Zammit`); await p.waitForSelector("#cn-note-text");
    await p.fill("#cn-note-text", "  Called, will come Friday  ");
    await t.write(p, new RegExp(`/creditnotes/entries/${id}/notes$`), () => p.click("#cn-add-note"));
    const cNote = t.since(N, n0)[0], cAud = auditSince(a0, "CREDITNOTE_NOTE_ADD")[0];
    // new add
    n0 = t.maxId(N); a0 = aMax();
    await t.open(p, "2", "creditnotes", "cnreg", "#cnr-q"); await p.fill("#cnr-q", "#" + id); await p.waitForSelector(`[data-act=note][data-id="${id}"]`); // m1: the note found by its number opens by itself
    await p.click(`[data-act=note][data-id="${id}"]`); await p.waitForSelector("#cnr-note [name=note_text]");
    await p.fill("#cnr-note [name=note_text]", "  Called, will come Friday  ");
    await t.write(p, new RegExp(`/creditnotes/entries/${id}/notes$`), () => p.press("#cnr-note [name=note_text]", "Enter"));
    const nNote = t.since(N, n0)[0], nAud = auditSince(a0, "CREDITNOTE_NOTE_ADD")[0];
    await t.idle(p);
    const focusAfter = await p.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act"));
    t.has("note(new)", nNote, { credit_note_id: id, text: "Called, will come Friday" });
    t.same("note add", cNote, nNote, { timestamp: "the moment of saving" });
    const strip = (r) => r && { ...r, id: 0, entity_id: 0, created_at: 0, ts: 0, timestamp: 0, details_json: r.details_json && r.details_json.replace(/"id":\d+/g, '"id":0').replace(/"timestamp":"[^"]*"/g, '"timestamp":0').replace(/"(created_at|updated_at)":"[^"]*"/g, '"$1":0') };
    t.ok(cAud && nAud && JSON.stringify(strip(cAud)) === JSON.stringify(strip(nAud)), "note add: the same audit row (but its id, the note id and time): " + JSON.stringify([strip(cAud), strip(nAud)]).slice(0, 600));
    t.ok(focusAfter === "note", "note add: focus back on Add a note: " + focusAfter);
    // remove: classic removes the classic note, new removes the new one (the pharmacist, one question)
    a0 = aMax();
    await t.open(p, "classic", "creditnotes", "creditnotes", "#cn-new");
    await p.click(`text=Zammit`); await p.waitForSelector(`[data-cn-del-note='${cNote.id}']`);
    await t.write(p, new RegExp(`/notes/${cNote.id}$`), () => p.click(`[data-cn-del-note='${cNote.id}']`), "DELETE");
    const cDel = auditSince(a0, "CREDITNOTE_NOTE_DELETE")[0];
    a0 = aMax();
    await t.open(p, "2", "creditnotes", "cnreg", "#cnr-q"); await p.fill("#cnr-q", "#" + id); await p.waitForSelector(`[data-act=rmnote][data-nid="${nNote.id}"]`); // m1: the note found by its number opens by itself
    await p.click(`[data-act=rmnote][data-nid="${nNote.id}"]`); await p.waitForSelector("[data-act=rmnote-yes]");
    const askTxt = (await p.textContent(".cnr-ask")).replace(/\s+/g, " ");
    await t.write(p, new RegExp(`/notes/${nNote.id}$`), () => p.click("[data-act=rmnote-yes]"), "DELETE");
    const nDel = auditSince(a0, "CREDITNOTE_NOTE_DELETE")[0];
    t.ok(!t.row(N, cNote.id) && !t.row(N, nNote.id) && t.db.prepare(`SELECT COUNT(*) n FROM ${N} WHERE credit_note_id = ?`).get(id).n === 1, "note remove: both notes gone, the first note kept");
    t.ok(cDel && nDel && JSON.stringify(strip(cDel)) === JSON.stringify(strip(nDel)), "note remove: the same audit row: " + JSON.stringify([strip(cDel), strip(nDel)]).slice(0, 600));
    t.ok(/Remove this note\?/.test(askTxt) && /The audit keeps it/.test(askTxt), "note remove: asks once in plain words: " + askTxt);

    // ---- End of day: the deposit for the bank email, classic vs new, the same day as typed on each
    await t.api("PUT", "/endofday/contacts", { contacts: [{ name: "Ġużeppi at BOV", email: "guzeppi@bov.example", phone: "21000000" }] });
    const E = "end_of_day", today = ymd(0), had = t.db.prepare(`SELECT * FROM ${E} WHERE eod_date = ?`).get(today);
    if (had) t.db.prepare(`DELETE FROM ${E} WHERE eod_date = ?`).run(today);
    const K = (k) => `[data-focus-key="${k}"]`, DEP = { n100: "2", n50: "3", n20: "4", n5: "1" }, BAG = "B-10A";
    await t.open(p, "classic", "endofday", "endofday", K("bag_number"));
    const opt = await p.$eval(K("bov_contact"), (s) => [...s.options].find((o) => /Ġużeppi/.test(o.textContent))?.value || "");
    await p.selectOption(K("bov_contact"), opt);
    await t.fill(p, "", { [K("bag_number")]: BAG, ...Object.fromEntries(Object.entries(DEP).map(([k, v]) => [K("dep_" + k), v])) });
    await p.evaluate(() => { window.__clip = null; });
    await p.locator("button:has-text('Copy Deposit to Email')").click(); await p.waitForFunction(() => window.__clip, null, { timeout: 5000 });
    const cClip = await p.evaluate(() => window.__clip);
    await t.open(p, "2", "endofday", "eodreg", "[data-act=copy-dep]");
    // the classic check first: no bag number, nothing copied, the cursor in the box
    await p.evaluate(() => { window.__clip = null; });
    await p.fill("#eod-form [name=bag_number]", ""); await p.click("[data-act=copy-dep]"); await p.waitForTimeout(200);
    const noBag = await p.evaluate(() => ({ clip: window.__clip, focus: document.activeElement && document.activeElement.name, msg: (document.querySelector("#eod-err") || {}).textContent || "" }));
    await p.selectOption("#eod-form [name=contact_id]", opt);
    await t.fill(p, "#eod-form", { bag_number: BAG, ...Object.fromEntries(Object.entries(DEP).map(([k, v]) => [`[name="dep:${k}"]`, v])) });
    await p.click("[data-act=copy-dep]"); await p.waitForFunction(() => window.__clip, null, { timeout: 5000 });
    const nClip = await p.evaluate(() => window.__clip);
    t.ok(cClip && nClip && cClip.html.length > 1000 && cClip.html === nClip.html, "deposit email: the HTML is the classic's, byte for byte" + (cClip && nClip && cClip.html === nClip.html ? "" : ` (classic ${cClip && cClip.html.length}, new ${nClip && nClip.html.length})`));
    t.ok(cClip && nClip && cClip.plain === nClip.plain, "deposit email: the plain text is the classic's, byte for byte: " + JSON.stringify(nClip && nClip.plain).slice(0, 300));
    t.ok(nClip && /^guzeppi@bov\.example\n\nDear Ġużeppi at BOV,\n\n\nDate: \d\d\/\d\d\/\d{4}\nLocation: .+\n\nBOV CASH DEPOSIT\tBAG NO\.\tB-10A\n/.test(nClip.plain) && /CASH DEPOSITED\t\t€435\.00\n$/.test(nClip.plain), "deposit email: address, greeting, day, pharmacy, bag and total €435.00");
    t.ok(noBag.clip === null && noBag.focus === "bag_number" && /Write the bag number/.test(noBag.msg), "deposit email: without a bag number nothing is copied and it says so, in the box: " + JSON.stringify(noBag));
    t.ok(!t.db.prepare(`SELECT * FROM ${E} WHERE eod_date = ?`).get(today), "deposit email: copying stores nothing");
    if (had) { const cols = Object.keys(had); t.db.prepare(`INSERT INTO ${E} (${cols.join(",")}) VALUES (${cols.map(() => "?").join(",")})`).run(...cols.map((c) => had[c])); }
  },
};
