// Questions (tktreg, b4-5): one question prints on the classic screen's one-question page (the same HTML), and a
// customer with an email can be written to from the card. Nothing is stored by either.
import { ymd } from "../lib.mjs";
export default {
  title: "Questions: print one, email",
  async run(t) {
    const T = "client_tickets_entries", m = t.maxId(T);
    await t.api("POST", "/client-tickets/entries", { ticket_id: "TKT-07001", open_date: ymd(0), client_name: "Borġ Ċensina", phone: "79111222", email: "censina@example.mt", issue: "Is the Ħ-brand syrup back?", category: "General Enquiry", priority: 1, status: "Open", assigned_to: "", followup_date: ymd(1), notes_log: JSON.stringify([{ ts: "2026-11-02T08:00:00.000Z", author: "Maria Borg", text: "Called, no answer" }]) });
    const id = t.since(T, m)[0].id, row0 = JSON.stringify(t.row(T, id));
    const p = await t.page();
    // the print tab is kept from printing (window.print is a no-op) so its HTML can be read
    await p.context().addInitScript(() => { window.print = () => {}; });
    const grab = async (click) => { const [w] = await Promise.all([p.waitForEvent("popup"), click()]); await w.waitForLoadState(); await w.waitForTimeout(400); const h = await w.evaluate(() => document.documentElement.outerHTML); await w.close(); return h; };
    await t.open(p, "classic", "tickets", "tickets", "#tk-new");
    await p.click(`tbody tr[data-id='${id}']`);
    const classic = await grab(() => p.click("#tk-sel-print"));
    await t.open(p, "2", "tickets", "tktreg", `[data-act=open][data-id="${id}"]`);
    await p.click(`[data-act=open][data-id="${id}"]`);
    const fresh = await grab(() => p.click(`#tkt-edit [data-act=print]`));
    t.ok(classic.length > 500 && classic === fresh, "print: the new screen's page is the classic one, byte for byte" + (classic === fresh ? "" : ` (classic ${classic.length} chars, new ${fresh.length})`));
    t.ok(/Borġ Ċensina/.test(fresh) && /Called, no answer/.test(fresh) && /1 — High/.test(fresh), "print: name with Maltese letters, the note and the priority are on it");
    const href = await p.getAttribute(`.tkt-card a[href^="mailto:"]`, "href");
    t.ok(href === "mailto:censina@example.mt?subject=Your%20question%20(TKT-07001)", "email: the card links to the customer's address: " + href);
    t.ok(JSON.stringify(t.row(T, id)) === row0, "print and email store nothing");
  },
};
