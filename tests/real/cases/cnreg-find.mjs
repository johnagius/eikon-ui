// Credit notes (cnreg, m1): one search finds a customer's credit by ID card (through the people the pharmacy knows),
// by name with or without ċ ġ ħ ż, and by the note's number; the only note found opens by itself, Enter opens its Use,
// and part of it is used. The stored use equals the classic's (its add-purchase body { amount, receipt_number }, sent
// on a twin note), and the screen reads the list once when it opens.
import { ymd } from "../lib.mjs";
const P = { name: "Ċensina Zammit", id_card: "7654321M", phone: "79881122" };
const N = { issue_date: ymd(-3), client_name: "Ċensina", client_surname: "Zammit", telephone: P.phone, email: "", receipt_number: "R-FND1", amount: 30, expiry_date: ymd(10), no_expiry: 0 };
export default {
  title: "Credit notes: find and use part",
  async run(t) {
    await t.api("POST", "/people", { name: P.name, id_card: P.id_card, phone: P.phone, alt_phone: "", email: "", address: "", source: "manual" });
    const T = "credit_notes", U = "credit_note_purchases", m0 = t.maxId(T);
    await t.api("POST", "/creditnotes/entries", N); await t.api("POST", "/creditnotes/entries", N);
    const [A, B] = t.since(T, m0, { receipt_number: N.receipt_number });
    t.ok(A && B, "two twin notes stored");
    const p = await t.page(), lists = [];
    p.on("request", (r) => { if (new URL(r.url()).pathname === "/creditnotes/list") lists.push(r.url()); });
    await t.open(p, "2", "creditnotes", "cnreg", "#cnr-q");
    t.ok(lists.length === 1, "opening the screen reads the credit-note list once (the month below is cut from it): " + lists.length);

    const listText = () => p.evaluate(() => document.querySelector("#cnr-list").innerText.replace(/\s+/g, " "));
    await p.fill("#cnr-q", P.id_card);
    await p.waitForFunction((c) => /ID card .* is /.test(document.querySelector("#cnr-list").innerText) || /No customer known/.test(document.querySelector("#cnr-list").innerText), P.id_card, { timeout: 8000 }).catch(() => {});
    let tx = await listText();
    t.ok(/ID card 7654321M is Ċensina Zammit/.test(tx) && /Ċensina Zammit holds €60\.00 on 2 notes/.test(tx), "the ID card finds the customer and what they hold: " + tx.slice(0, 200));

    await p.fill("#cnr-q", "censina zammit"); await p.waitForTimeout(200); tx = await listText();
    t.ok(/holds €60\.00 on 2 notes/.test(tx), "the name without ċ finds both notes: " + tx.slice(0, 160));

    await p.fill("#cnr-q", "#" + A.id); await p.waitForTimeout(200); tx = await listText();
    const open = await p.getAttribute(`[data-act=open][data-id="${A.id}"]`, "aria-expanded");
    t.ok(/Ends in 10 days/.test(tx) && open === "true" && (await p.locator(".cnr-card").count()) === 1, "the note number finds the one note, open, its end in words: " + open + " " + tx.slice(0, 160));
    await p.press("#cnr-q", "Enter");
    await p.waitForSelector("#cnr-use [name=amount]");
    await p.waitForFunction(() => document.activeElement && document.activeElement.name === "amount", null, { timeout: 2000 }).catch(() => {}); // the focus follows the paint (E.focusSoon)
    t.ok(await p.evaluate(() => document.activeElement && document.activeElement.name) === "amount", "Enter opens Use with the cursor in the amount: " + await p.evaluate(() => document.activeElement && (document.activeElement.name || document.activeElement.id || document.activeElement.tagName)));
    const mU = t.maxId(U);
    await p.fill("#cnr-use [name=amount]", "7.25"); await p.fill("#cnr-use [name=receipt_number]", "R-USE1");
    const w = await t.write(p, new RegExp("/creditnotes/entries/" + A.id + "/purchases$"), () => p.press("#cnr-use [name=amount]", "Enter"));
    t.ok(JSON.stringify(w.body) === JSON.stringify({ amount: 7.25, receipt_number: "R-USE1" }), "the use sends the classic body: " + JSON.stringify(w.body));
    await t.api("POST", "/creditnotes/entries/" + B.id + "/purchases", { amount: 7.25, receipt_number: "R-USE1" });
    const rows = await t.mine(U, mU, { receipt_number: "R-USE1" }, 2);
    const ua = rows.find((r) => r.credit_note_id === A.id), ub = rows.find((r) => r.credit_note_id === B.id);
    t.same("creditnote use", ub, ua, { credit_note_id: "a twin note", timestamp: "the moment each was saved" });
    await p.waitForFunction((id) => /€22\.75/.test((document.querySelector(`.cnr-card[data-cn="${id}"]`) || {}).innerText || ""), A.id, { timeout: 6000 }).catch(() => {});
    t.ok(/€22\.75/.test(await listText()), "the note shows €22.75 left after the use");
  },
};
