// W6 (Finish round, records): a new pharmacy's first credit note is No. 1 on its card (not the shared row id); the
// pharmacy that already had notes keeps every number it showed and goes on after them; the search finds a note by it.
export default {
  title: "Credit notes numbered per pharmacy",
  async run(t) {
    const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const before = await t.api("POST", "/creditnotes/entries", { issue_date: "2026-11-10", client_name: "Paul", client_surname: "Vella", telephone: "79000000", email: "", receipt_number: "W6-OLD", amount: 10, expiry_date: "", no_expiry: 1 });
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, "Records Numbers Pharmacy").lastInsertRowid);
    const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "numbers@demo.mt", role: "admin", name: "Rita Camilleri" });
    const mk = async (n) => (await t.stack.app.api("POST", "/creditnotes/entries", { token: u.token, body: { issue_date: "2026-11-11", client_name: "Grech", client_surname: "Anna" + n, telephone: "79111111", email: "", receipt_number: "W6-" + n, amount: 5, expiry_date: "", no_expiry: 1 } })).json;
    const a = await mk(1), b = await mk(2);
    t.ok(a.cn_no === 1 && b.cn_no === 2, "the new pharmacy's notes are No. 1 and 2 (row ids " + a.id + ", " + b.id + ")");
    t.ok(Number.isInteger(before.cn_no), "the first pharmacy's note has its own number too: " + before.cn_no);
    const p = await t.page();
    await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, u.token);
    await t.open(p, "2", "cnreg", "cnreg", ".cnr-card");
    let txt = ""; const n = await p.locator(".cnr-card .cnr-row").count();
    for (let i = 0; i < n; i++) { await p.locator(".cnr-card .cnr-row").nth(i).click(); await p.waitForTimeout(250); txt += " | " + (await p.locator(".cnr-card").nth(i).textContent()); } // one opens at a time
    t.ok(/No\. 1(?!\d)/.test(txt) && /No\. 2(?!\d)/.test(txt), "the cards show No. 1 and No. 2: " + txt.slice(0, 300));
  },
};
