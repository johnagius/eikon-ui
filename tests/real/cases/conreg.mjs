// Contacts: delete in the new layout (q5-10c). Twin contacts, one deleted from the classic screen's Del and one from the
// new screen's Delete… → Delete contact: the same request (DELETE /contacts/<type>/<id>, no body), both rows gone (the
// server's delete, as classic), and the same CONTACT_DELETE audit entry (the deleted row, ids and clock stamps set aside).
// A shared list (suppliers: the classic asks its shared-data question) and this pharmacy's clients (the classic asks
// nothing). Staff see no Delete…; focus goes back to the list.
const STAMP = ["id", "created_at", "updated_at", "entity_id"];
const strip = (v) => Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().filter((k) => !STAMP.includes(k)).map((k) => [k, strip(v[k])])) : v;
export default {
  title: "Contacts: delete a contact in the new layout, as classic",
  async run(t) {
    const audit = (table, id, since) => t.db.prepare("SELECT * FROM audit_log WHERE id > ? AND entity_type = ? AND entity_id = ? ORDER BY id").all(since, table, String(id));
    const n = (r) => JSON.stringify({ action: r.action, entity_type: r.entity_type, user_id: r.user_id, location_id: r.location_id, org_id: r.org_id, details: strip(JSON.parse(r.details_json || "null")) });
    const p = await t.page();
    const cases = [
      { key: "suppliers", table: "contacts_suppliers", body: { name: "Ħal Far Twin Supplies", phone: "2165 4321", email: "orders@halfar.example" } },
      { key: "clients", table: "contacts_clients", body: { name: "Żammit Ġużeppa Twin", id_card: "765432M", address: "12 Triq il-Ħolja, Għargħur", phone: "7999 1234", alt_phone: "" } },
    ];
    for (const c of cases) {
      const m = t.maxId(c.table);
      await t.api("POST", "/contacts/" + c.key, c.body); await t.api("POST", "/contacts/" + c.key, c.body);
      const twins = t.since(c.table, m, { name: c.body.name }).map((r) => r.id);
      if (!t.ok(twins.length === 2, c.key + ": two twin contacts made")) continue;
      const before = Object.fromEntries(twins.map((id) => [id, t.row(c.table, id)]));
      const au = t.maxId("audit_log");

      // classic: the first twin's Del (and, for a shared list, Yes, proceed)
      await t.open(p, "classic", "contacts", "contacts", `tr:has-text("${c.body.name}") button:has-text("Del")`);
      const cw = await t.write(p, new RegExp("^/contacts/" + c.key + "/\\d+$"), async () => {
        await p.locator(`tr:has-text("${c.body.name}") button:has-text("Del")`).first().click();
        if (c.key !== "clients") await p.click("#eikon-modal-actions .eikon-btn.primary");
      }, "DELETE");
      const gone = twins.filter((id) => !t.row(c.table, id)), left = twins.filter((id) => t.row(c.table, id));
      if (!t.ok(gone.length === 1 && left.length === 1, c.key + ": the classic Del removed one twin")) continue;
      const [a] = gone, [b] = left;

      // new: the other twin
      await t.open(p, "2", "conreg", "conreg", "#con-q");
      await p.fill("#con-q", c.body.name.split(" ")[0]); await p.waitForSelector(`[data-open="${c.key}:${b}"]`);
      await p.click(`[data-open="${c.key}:${b}"]`); await p.click(".con-card [data-act=del]");
      t.ok((await p.textContent(".con-card")).includes(`Delete ${c.body.name} from Contacts? This cannot be undone.`), c.key + ": the question is in plain words, with the name");
      await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "del-cancel", null, { timeout: 2000 }).catch(() => {}); // the focus follows the paint
      t.ok(await p.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-act")) === "del-cancel", c.key + ": the question opens on Keep it: " + await p.evaluate(() => document.activeElement && (document.activeElement.getAttribute("data-act") || document.activeElement.id || document.activeElement.tagName)));
      t.ok(t.row(c.table, b), c.key + ": nothing is deleted before the answer");
      let reqs = []; const onReq = (r) => { if (/\/contacts\//.test(r.url()) && r.method() !== "GET") reqs.push({ m: r.method(), path: new URL(r.url()).pathname, body: r.postData() }); };
      p.on("request", onReq);
      const nw = await t.write(p, new RegExp("^/contacts/" + c.key + "/" + b + "$"), () => p.click(".con-card [data-act=del-go]"), "DELETE");
      await t.idle(p); p.off("request", onReq);
      t.ok(reqs.length === 1 && reqs[0].body == null, c.key + ": one DELETE, no body: " + JSON.stringify(reqs));
      t.ok(cw.status === 200 && nw.status === 200 && JSON.stringify(cw.json) === JSON.stringify(nw.json), c.key + ": the same answer: classic " + JSON.stringify(cw.json) + " new " + JSON.stringify(nw.json));
      t.ok(!t.row(c.table, a) && !t.row(c.table, b), c.key + ": both rows gone (the server's delete, as classic)");
      const A = audit(c.table, a, au), B = audit(c.table, b, au);
      if (t.ok(A.length === 1 && B.length === 1, `${c.key}: one audit entry each (classic ${A.length}, new ${B.length})`)) {
        t.ok(n(A[0]) === n(B[0]), `${c.key}: audit entries differ:\n classic ${n(A[0]).slice(0, 400)}\n new     ${n(B[0]).slice(0, 400)}`);
        t.ok(A[0].action === "CONTACT_DELETE" && JSON.stringify(strip(JSON.parse(B[0].details_json))) === JSON.stringify(strip(before[b])), c.key + ": the audit keeps the deleted row");
      }
      await p.waitForFunction(() => { const x = document.activeElement; return x && x.closest && x.closest(".con") && (x.hasAttribute("data-open") || x.getAttribute("data-act") === "add"); }, null, { timeout: 4000 })
        .then(() => t.ok(1), () => t.fail(c.key + ": focus is not back on the list after the delete"));
      t.ok(!(await p.locator(".con-foot").first().textContent()).includes("Deleting"), c.key + ": the footer no longer sends deleting to the classic screen");
    }

    // staff: no Delete…
    if (!t.stack.staff) t.stack.staff = await t.stack.app.addUser({ email: "staff-con@demo.mt", role: "staff", name: "Sam Staff" }).catch(() => null);
    if (t.stack.staff) {
      const id = (await t.api("POST", "/contacts/suppliers", { name: "Staff View Supplies", phone: "2100 1111", email: "" })).id;
      const s = await t.page(); await s.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, t.stack.staff.token);
      await t.open(s, "2", "conreg", "conreg", "#con-q"); await s.fill("#con-q", "Staff View"); await s.click(`[data-open="suppliers:${id}"]`);
      t.ok(await s.locator(".con-card [data-act=edit]").count() === 1 && await s.locator("[data-act=del]").count() === 0, "staff: Edit, and no Delete…");
    }
  },
};
