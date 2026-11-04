// How we're doing (ownreg): read only, so nothing to compare with a classic screen. A pharmacy of its own (so cases
// writing at the same time cannot change its figures), seeded through the real worker for last month: end of day on
// three days, paid outs, a credit note partly used, controlled drugs, a rota. The screen, opened from that pharmacy's
// own sign-in on last month, must show the same figures the registers hold (worked out here from the stored rows),
// open the payments behind Paid out, print and download the month end, and write nothing. A staff sign-in at the
// same pharmacy sees a note, and another pharmacy's takings never appear.
const pad = (n) => (n < 10 ? "0" : "") + n;
const maltaToday = () => { const o = {}; new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date()).forEach((p) => { o[p.type] = p.value; }); return o.year + "-" + o.month + "-" + o.day; };
const shiftYm = (ym, n) => { const d = new Date(Date.UTC(+ym.slice(0, 4), +ym.slice(5) - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); };
const eur = (n) => (n < 0 ? "−€" : "€") + Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export default {
  title: "How we're doing",
  async run(t) {
    const db = t.db, org = db.prepare("SELECT org_id FROM users WHERE email = 'maria@demo.mt'").get().org_id;
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, ?)").run(org, "Owner Figures Pharmacy").lastInsertRowid);
    const admin = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "owner-admin@demo.mt", role: "admin", name: "Rita Camilleri" });
    const staff = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "owner-staff@demo.mt", role: "staff", name: "Karl Vella" });
    const api = async (m, p, body, headers) => { const r = await t.stack.app.api(m, p, { token: admin.token, body, headers }); if (r.status >= 400 || (r.json && r.json.ok === false)) throw new Error(m + " " + p + " " + r.status + " " + r.text.slice(0, 160)); return r.json; };
    const L = shiftYm(maltaToday().slice(0, 7), -1), D = (n) => L + "-" + pad(n);
    // ---- seed last month
    const eods = [[3, "1234.56", "200", "10", { n500: 1, n200: 1, n100: 1, coins_total: "4.56" }], [4, "999.99", "0", "0", { n500: 2, coins_total: "0" }], [5, "500", "100", "0", { n200: 2, n100: 1, coins_total: "0" }]];
    for (const [d, x, ep, po, cash] of eods) await api("PUT", "/endofday/record", { record: { eod_date: D(d), time_of_day: "PM", staff_name: "Rita", float_amount: 500, x: [{ amount: x, remark: "" }], epos: [{ amount: ep, remark: "" }], cheques: [], paid_outs: [{ amount: po, remark: "" }], cash, notes: "", action: "LOCK", locked_at: new Date().toISOString() } });
    for (const [d, fee] of [[3, 12.5], [4, 7.25], [20, 30]]) await api("POST", "/paid-out/entries", { entry_date: D(d), entry_time: "10:00", payee_name: "Courier Ċassar", fee, payment_method: "cash", invoice_no: "", cheque_no: "", reason: "" });
    const cn = await api("POST", "/creditnotes/entries", { issue_date: D(6), client_name: "Ġorġ", client_surname: "Żammit", telephone: "79000001", amount: 40, no_expiry: 1 });
    await api("POST", `/creditnotes/entries/${cn.id}/purchases`, { amount: 15, receipt_number: "R1" });
    for (const [d, q] of [[7, 2], [8, 3]]) await api("POST", "/dda-sales/entries", { entry_date: D(d), client_name: "Borg John", client_id_card: "123456M", client_address: "1 Triq", medicine_name_dose: "Morphine 10mg/ml", quantity: q, doctor_name: "Dr Abela", doctor_reg_no: "R1201", prescription_serial_no: "OW" + d });
    const st = await api("POST", "/shifts/staff", { full_name: "Doris Ċassar", designation: "assistant", contracted_hours: 20 });
    const sid = st.staff_id || st.id || (st.staff && st.staff.id);
    for (const d of [9, 10]) await api("POST", "/shifts/assignments", { staff_id: sid, shift_date: D(d), start_time: "09:00", end_time: "13:30" });
    // what the registers hold, worked out here from the stored rows with End of day's own sums
    const rows = db.prepare("SELECT x_json, epos_json, cheques_json, paid_outs_json, cash_json, float_amount FROM end_of_day WHERE location_id = ? AND eod_date LIKE ?").all(loc, L + "-%");
    const tot = (j) => JSON.parse(j).reduce((a, r) => a + Number(r.amount || 0), 0);
    let takings = 0, ou = 0; for (const r of rows) { const c = JSON.parse(r.cash_json), till = ["500", "200", "100", "50", "20", "10", "5"].reduce((a, k) => a + Number(k) * Number(c["n" + k] || 0), 0) + Number(c.coins_total || 0); const exp = tot(r.x_json) - tot(r.epos_json) - tot(r.cheques_json) - tot(r.paid_outs_json); takings += tot(r.x_json); ou += Math.max(0, till - Number(r.float_amount)) - exp; }
    const paid = db.prepare("SELECT SUM(fee) AS s FROM paid_out_entries WHERE location_id = ? AND entry_date LIKE ?").get(loc, L + "-%").s;
    const count = () => db.prepare("SELECT (SELECT COUNT(*) FROM end_of_day WHERE location_id = ?) + (SELECT COUNT(*) FROM paid_out_entries WHERE location_id = ?) + (SELECT COUNT(*) FROM credit_notes WHERE location_id = ?) + (SELECT COUNT(*) FROM audit_log WHERE location_id = ?) AS c").get(loc, loc, loc, loc).c; // this pharmacy's rows only: other cases write at the same time
    const before = count();

    // ---- the screen, from this pharmacy's own sign-in
    const p = await t.page(), reqs = [];
    await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); localStorage.removeItem("eikon_own_view"); } catch (e) {} }, admin.token);
    p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/owner/")) reqs.push(u.pathname + u.search); });
    await t.open(p, "2", "ownreg", "ownreg", ".own-tiles");
    await p.click('[data-move="-1"]');
    await p.waitForFunction((ym) => { const s = window.EIKON.owner.state; return !s.loading && s.period && s.period.from === ym + "-01"; }, L, { timeout: 15000 });
    const tiles = await p.evaluate(() => [...document.querySelectorAll(".own-tile b")].map((b) => b.textContent));
    t.ok(tiles[0] === eur(takings), "Takings " + tiles[0] + " = the X readings saved, " + eur(takings));
    t.ok(tiles[1] === eur(paid), "Paid out " + tiles[1] + " = the paid-out register, " + eur(paid));
    t.ok(tiles[2] === eur(Math.round(ou * 100) / 100), "Over / under " + tiles[2] + " = End of day's sums, " + eur(ou));
    t.ok(tiles[3] === "€25.00", "Credit notes held: €40 less €15 used = " + tiles[3]);
    const txt = await p.evaluate(() => document.querySelector(".own").innerText);
    t.ok(/Morphine 10mg\/ml\s+2\s+5/.test(txt), "controlled drugs supplied: 2 lines, 5 in all");
    t.ok(/Doris Ċassar[\s\S]{0,60}2\s+9/.test(txt), "Doris Ċassar: 2 shifts, 9 hours on the rota");
    t.ok(!/Demo Pharmacy/.test(txt), "no other pharmacy of the group appears");
    t.ok(reqs.length === 2 && reqs.every((q) => q.indexOf("/owner/summary?") === 0) && !/loc=/.test(reqs.join()), "one request per month shown, never naming another pharmacy: " + reqs.join(" "));
    // the payments behind Paid out
    await p.click('.own-tile[data-rec="paid_outs"]');
    await p.waitForFunction(() => document.querySelector("#own-dlg tbody"), null, { timeout: 10000 });
    const dl = await p.evaluate(() => ({ n: document.querySelectorAll("#own-dlg tbody tr").length, foot: document.querySelector("#own-dlg tfoot").innerText, names: document.querySelector("#own-dlg tbody").innerText }));
    t.ok(dl.n === 3 && dl.foot.includes(eur(paid)) && dl.names.includes("Courier Ċassar"), "the three payments and their total: " + JSON.stringify(dl));
    await p.keyboard.press("Escape");
    // month end, printed and as a workbook
    await p.evaluate(() => { window.__p = null; window.EIKON.openPrintUrlOrLink = function () { window.__p = window.EIKON.months.lastPrint; return {}; }; });
    await p.click('[data-rep="month"][data-how="print"]'); await p.waitForFunction(() => window.__p && !window.EIKON.owner.state.busy, null, { timeout: 10000 });
    const html = await p.evaluate(() => window.__p.html);
    t.ok(html.includes("<b>Owner Figures Pharmacy</b>") && html.includes(eur(takings)) && html.includes("Courier Ċassar") && /counter\(pages\)/.test(html), "month end printout: the pharmacy, the takings, the payments, page numbers");
    await p.click('[data-rep="month"][data-how="sheet"]'); await p.waitForFunction(() => window.EIKON.owner.lastSheet && !window.EIKON.owner.state.busy, null, { timeout: 15000 });
    const sh = await p.evaluate(() => window.EIKON.owner.lastSheet.sheets.map((s) => s.name + ":" + (s.rows.length - 1)).join());
    t.ok(/End of day:3,Paid outs:3,Credit notes issued:1,Credit notes used:\d,Locum receipts:0/.test(sh), "the workbook: " + sh);
    t.ok(count() === before, "reading, opening records and making reports wrote nothing");
    // staff at the same pharmacy: a note, and the server says no
    const r403 = await t.stack.app.api("GET", "/owner/summary", { token: staff.token });
    t.ok(r403.status === 403 && !r403.text.includes("1,234") && !r403.text.includes("1234.56"), "staff are refused by the server: " + r403.status);
    const ps = await t.page();
    await ps.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); } catch (e) {} }, staff.token);
    await t.open(ps, "2", "ownreg", "ownreg", ".own");
    t.ok(/Only the pharmacist in charge/.test(await ps.textContent(".own")), "staff see a note instead of the figures");
  },
};
