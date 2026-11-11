// Privacy, export (gdpr): Settings › Download our records › One person finds a customer; the window lists what this
// pharmacy holds on them (same-name rows apart, counted only when ticked); Download everything saves one zip whose data
// holds every row of theirs from the real worker, nothing of another person's, and the audit trail gets one PERSON_EXPORT
// line with counts only. Staff are refused by the server (403) on every privacy route. Read only: nothing is changed.
import { maltaYmd } from "../../clock.mjs";
function unzip(buf) { const out = {}; let o = 0; while (buf.readUInt32LE(o) === 0x04034b50) { const size = buf.readUInt32LE(o + 18), nl = buf.readUInt16LE(o + 26), name = buf.slice(o + 30, o + 30 + nl).toString(); out[name] = buf.slice(o + 30 + nl, o + 30 + nl + size); o += 30 + nl + size; } return out; }
export default {
  title: "Privacy: everything we hold on one person, as one file (own pharmacy, same-name rows only when ticked, audited)",
  async run(t) {
    const tag = String(Date.now() % 100000).padStart(5, "0"), name = "Doris Azzopardi " + tag, card = tag + "1M", phone = "799" + tag;
    const d = (n) => maltaYmd(-n);
    const pr = await t.api("POST", "/people", { name, id_card: card, phone, email: "doris" + tag + "@demo.mt", address: "12 Triq il-Wied, Lija" });
    const pid = pr.person.id;
    await t.api("POST", "/client-orders/entries", { order_date: d(1), client_name: name, client_phone: phone, items_text: "Vitamin D " + tag, needed_by: d(0), priority: 2 });
    await t.api("POST", "/client-orders/entries", { order_date: d(2), client_name: name, items_text: "Plasters " + tag, needed_by: d(0), priority: 2 }); // same name only
    await t.api("POST", "/client-tickets/entries", { open_date: d(1), client_name: name, phone, issue: "Question " + tag, category: "General Enquiry", priority: 2, status: "Open", ticket_id: "TKT-" + tag });
    await t.api("POST", "/dda-sales/entries", { entry_date: d(0), client_name: name, client_id_card: card, client_address: "12 Triq il-Wied, Lija", medicine_name_dose: "Morphine 10mg", quantity: 1, doctor_name: "Dr Abela", doctor_reg_no: "R1", prescription_serial_no: "G" + tag });
    await t.api("POST", "/repeat-prescriptions/entries", { entry_date: d(3), client_name: name, client_id: card, medicine_name_dose: "Ramipril " + tag, posology: "1 od", prescriber_name: "Dr Galea", prescriber_reg_no: "R2", collect_every_days: 28 });
    await t.api("POST", "/client-orders/entries", { order_date: d(1), client_name: "Mark Vella " + tag, client_phone: phone, items_text: "Someone else " + tag, needed_by: d(0), priority: 2 });

    // staff: refused by the server on every privacy route
    const app = t.stack.app;
    if (!t.stack.staff) { const s = await app.addUser({ email: "staff-" + Date.now() + "@demo.mt", role: "staff", name: "Sam Staff" }).catch(() => null); t.stack.staff = s; }
    if (t.stack.staff) {
      const st = [];
      for (const [m, p] of [["POST", "/people/" + pid + "/privacy"], ["POST", "/people/" + pid + "/export"], ["GET", "/people/" + pid + "/export"], ["POST", "/people/" + pid + "/erase"], ["GET", "/people/" + pid + "/erasures"], ["GET", "/export/records?part=customers"]])
        st.push((await app.api(m, p, { token: t.stack.staff.token, body: m === "POST" ? {} : undefined })).status);
      t.ok(st.every((s) => s === 403), "staff get 403 on every privacy route: " + st.join(","));
    } else t.note("no staff account could be made: the 403 check is in the worker tests");

    const p = await t.page();
    const reqs = []; p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/ui/") || u.pathname.startsWith("/vendor/")) return; reqs.push(r.method() + " " + u.pathname + u.search); });
    await t.open(p, "2", "expreg", "expreg", ".exp [data-act=download]");
    t.ok(!reqs.some((x) => /privacy|export|people/.test(x)), "opening Download our records asks nothing about people: " + reqs.join(" | "));
    await p.fill("#exp-who", name); await p.waitForSelector(`[data-person="${pid}"]`, { timeout: 10000 });
    await p.click(`[data-person="${pid}"]`);
    await p.waitForSelector(".prv [data-act=download]", { timeout: 15000 });
    const hold = await p.innerText(".prv");
    t.ok(new RegExp(name + ": what we hold").test(hold) && /Orders\s+1/.test(hold) && /Questions\s+1/.test(hold) && /Controlled drugs supplied \(DDA\)\s+1/.test(hold) && /Repeat prescriptions\s+1/.test(hold),
      "what we hold: one order, one question, one DDA line, one repeat (the same-name order apart): " + hold.replace(/\n+/g, " | ").slice(0, 400));
    t.ok(/Same name, not sure it is them \(1\)/.test(hold) && /Plasters/.test(hold), "the order under the same name only is listed apart");
    const audit0 = t.db.prepare("SELECT COUNT(*) AS c FROM audit_log WHERE action = 'PERSON_EXPORT' AND entity_id = ?").get(String(pid)).c;
    await p.locator(".prv [data-key^='client_orders_entries:']").check();
    await p.evaluate(() => { window.EIKON.privacy.lastFile = null; });
    const w = await t.write(p, /\/people\/\d+\/export$/, () => p.click(".prv [data-act=download]"));
    await p.waitForFunction(() => window.EIKON.privacy.lastFile, null, { timeout: 20000 });
    t.ok(w.body && Array.isArray(w.body.rows) && w.body.rows.length === 1 && /^client_orders_entries:\d+$/.test(w.body.rows[0]), "the ticked same-name order is sent with the export: " + JSON.stringify(w.body));
    const zb = Buffer.from(await p.evaluate(async () => { const b = new Uint8Array(await window.EIKON.privacy.lastFile.blob.arrayBuffer()); let s = ""; for (const x of b) s += String.fromCharCode(x); return btoa(s); }), "base64");
    const files = unzip(zb), names = Object.keys(files);
    const js = JSON.parse(files[names.find((n) => n.endsWith(".json"))].toString("utf8"));
    const tables = Object.fromEntries(js.sections.map((s) => [s.table, s.rows.length]));
    t.ok(names.some((n) => n.endsWith(".json")) && names.some((n) => n.endsWith("-summary.html")) && names.some((n) => /\.(xlsx|csv)$/.test(n)), "one zip: data, summary page, spreadsheet: " + names.join(", "));
    t.ok(tables.client_orders_entries === 2 && tables.client_tickets_entries === 1 && tables.dda_sales_entries === 1 && tables.repeat_prescription_entries === 1 && tables.cust_profile === undefined, "the file holds their rows from the real worker: " + JSON.stringify(tables));
    const all = JSON.stringify(js);
    t.ok(!all.includes("Mark Vella " + tag) && js.sections.every((s) => s.rows.every((r) => r.location_id === undefined || r.location_id === 1)), "nothing of another person or another pharmacy");
    t.ok(js.person.id === pid && js.person.id_card === "0" + card, "their customer record is in it");
    const a = t.db.prepare("SELECT * FROM audit_log WHERE action = 'PERSON_EXPORT' AND entity_id = ? ORDER BY id DESC").all(String(pid));
    t.ok(a.length === audit0 + 1 && !a[0].details_json.includes(tag), "one PERSON_EXPORT line in the audit trail, with counts only: " + (a[0] && a[0].details_json));
    t.ok(reqs.filter((x) => /\/privacy$/.test(x)).length === 1 && reqs.filter((x) => /\/export$/.test(x)).length === 1, "the window asked once for the summary and once for the file: " + reqs.filter((x) => /people\/\d+/.test(x)).join(" | "));
    await p.keyboard.press("Escape");
    t.ok(!(await p.$(".prv")) && (await p.evaluate(() => document.activeElement && document.activeElement.getAttribute("data-person"))) === String(pid), "Escape closes; focus back on the person");
  }
};
