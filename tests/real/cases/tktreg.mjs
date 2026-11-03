// Questions (tktreg) vs classic Client Tickets.
import { ymd } from "../lib.mjs";
import printOne from "./_tktprint.mjs"; // b4-5: run after this case, in the same job, so no other case adds rows to the table between its reads
const IN = { name: "Borg Anna", phone: "79111222", issue: "Is Panadol syrup back in stock?", cat: "General Enquiry", priority: "1", follow: ymd(2) };
export default {
  title: "Questions",
  async run(t) {
    const T = "client_tickets_entries", p = await t.page();
    await t.open(p, "classic", "tickets", "tickets", "#tk-new");
    let m = t.maxId(T);
    await p.click("#tk-new"); await p.waitForSelector("#tk-client");
    await p.fill("#tk-client", IN.name); await p.fill("#tk-phone", IN.phone); await p.selectOption("#tk-category", IN.cat);
    await p.selectOption("#tk-priority", IN.priority); await p.fill("#tk-issue", IN.issue); await p.fill("#tk-followup", IN.follow);
    await t.write(p, /\/client-tickets\/entries$/, () => p.click("#eikon-modal-actions .eikon-btn.primary"));
    const classic = t.since(T, m).filter((r) => r.client_name === IN.name)[0]; // its own row: other cases write to this table at the same time
    await t.open(p, "2", "tickets", "tktreg", "[data-act=add]");
    m = t.maxId(T);
    await p.click("[data-act=add]"); await p.waitForSelector("#tkt-add");
    await p.fill("#tkt-add [name=client_name]", IN.name); await p.fill("#tkt-add [name=phone]", IN.phone); await p.fill("#tkt-add [name=issue]", IN.issue);
    await p.selectOption("#tkt-add [name=category]", IN.cat); await p.selectOption("#tkt-add [name=priority]", IN.priority); await p.fill("#tkt-add [name=followup_date]", IN.follow);
    await t.write(p, /\/client-tickets\/entries$/, () => p.click("#tkt-add button[type=submit]"));
    const fresh = t.since(T, m).filter((r) => r.client_name === IN.name)[0];
    t.has("questions(new)", fresh, { client_name: IN.name, phone: IN.phone, issue: IN.issue, category: IN.cat, priority: 1, followup_date: IN.follow, status: "Open" });
    t.ok(/^TKT-\d{5}$/.test(fresh && fresh.ticket_id), "questions(new): ticket_id is TKT-nnnnn: " + (fresh && fresh.ticket_id));
    t.same("questions", classic, fresh, { ticket_id: "the next number in the sequence (each screen takes the next one)" });
    await printOne.run(t);
  },
};
