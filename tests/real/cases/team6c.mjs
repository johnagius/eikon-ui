// BACKLOG4 6c, Team: the two daily actions brought from the classic screens, each done once in the CLASSIC screen
// (driven through its own page) and once in the new layout, from the same starting state; the stored rows and the
// audit rows must be the same, column by column (only ids, clock stamps and the client's own "now" may differ).
//  - Handover › Always: the standing instructions (classic Instructions › Permanent Handover Instructions › Edit/Save)
//  - Plan shifts › New leave request (classic Shifts › Leave › Submit Leave Request), a whole-days and a part-day one
const pad = (n) => (n < 10 ? "0" : "") + n;
const ymdOf = (d) => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const day = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return ymdOf(d); };
const CLOCK = /\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(\.\d+)?Z?/g;
const unclock = (s) => String(s == null ? "" : s).replace(CLOCK, "<clock>");

export default {
  title: "Team 6c: standing instructions and new leave requests, classic vs new",
  async run(t) {
    const p = await t.page();
    // ---------- Standing instructions ----------
    // A pharmacy whose global set has other sections written (and one the classic screen does not know): both screens
    // must keep them, and add the sections they lack in the same way.
    const seed = { opening: { text: "Open the shutters", updated_at: "2026-10-01T08:00:00.000Z" }, hiv: { enabled: true, text: "HIV PrEP: check the card", updated_at: "" }, extra_note: { text: "kept as it is" }, permanent_handover: { text: "Old rule", updated_at: "2026-10-01T08:00:00.000Z" } };
    const TEXT = "Count the CD cupboard every evening.\nĦal Qormi: iċ-ċavetta tal-friġġ fil-kexxun ta' fuq.";
    const G = () => t.db.prepare("SELECT * FROM instructions_global").get();
    const auditOf = (since) => t.db.prepare("SELECT * FROM audit_log WHERE id > ? AND action = 'INSTRUCTIONS_GLOBAL_PUT' ORDER BY id").all(since);
    const norm = (row) => { if (!row) return row; const g = JSON.parse(row.data_json); g.permanent_handover.updated_at = "<now>"; return { ...row, data_json: JSON.stringify(g) }; };

    await t.api("PUT", "/instructions/global", { global: seed });
    let a0 = t.maxId("audit_log");
    await t.open(p, "classic", "instructions", "instructions", ".eikon-ins-card");
    const card = p.locator(".eikon-ins-card", { has: p.locator("h3", { hasText: "Permanent Handover Instructions" }) });
    await card.locator("button", { hasText: /^Edit$/ }).click();
    await card.locator("textarea").fill(TEXT);
    await t.write(p, /\/instructions\/global$/, () => card.locator("button", { hasText: /^Save$/ }).click(), "PUT");
    await p.waitForTimeout(200);
    const classicRow = G(), classicAud = auditOf(a0);

    await t.api("PUT", "/instructions/global", { global: seed });
    a0 = t.maxId("audit_log");
    await t.open(p, "2", "hndreg", "hndreg", "[data-act=std]");
    await p.click("[data-act=std]"); await p.waitForSelector("#hnd-std");
    t.ok(await p.evaluate(() => document.querySelector("#hnd-std").value) === "Old rule", "Change opens with the standing instructions as they are");
    await p.fill("#hnd-std", TEXT);
    await t.write(p, /\/instructions\/global$/, () => p.click("#hnd-stdf button[type=submit]"), "PUT");
    await p.waitForFunction(() => !document.querySelector("#hnd-std")); await p.waitForTimeout(200);
    const freshRow = G(), freshAud = auditOf(a0);

    t.ok(JSON.parse(classicRow.data_json).permanent_handover.text === TEXT, "classic stored the text as typed");
    t.same("standing instructions (row)", norm(classicRow), norm(freshRow), { updated_by: "same person", created_by: "same person" });
    t.ok(norm(classicRow).data_json === norm(freshRow).data_json, "data_json byte-identical (key order too) apart from permanent_handover.updated_at, the client's clock: " + norm(freshRow).data_json.slice(0, 200));
    t.ok(classicAud.length === 1 && freshAud.length === 1, "one audit row each: " + classicAud.length + "/" + freshAud.length);
    if (classicAud[0] && freshAud[0]) {
      const ca = JSON.parse(classicAud[0].details_json), fa = JSON.parse(freshAud[0].details_json);
      const strip = (d) => ({ before: d.before && { ...d.before, updated_at: "<c>", created_at: "<c>" }, after: d.after && { ...d.after, updated_at: "<c>", created_at: "<c>", data_json: norm(d.after).data_json } });
      t.ok(JSON.stringify(strip(ca).after) === JSON.stringify(strip(fa).after), "audit 'after' identical: " + JSON.stringify(strip(fa).after).slice(0, 160));
      t.ok(JSON.stringify(strip(ca).before) === JSON.stringify(strip(fa).before), "audit 'before' identical (the same seed)");
      t.same("standing instructions (audit row)", { ...classicAud[0], details_json: "" }, { ...freshAud[0], details_json: "" });
    }
    // Escape on an open change closes it and puts focus back on Change.
    await p.click("[data-act=std]"); await p.waitForSelector("#hnd-std"); await p.keyboard.press("Escape"); await p.waitForTimeout(80);
    t.ok(await p.evaluate(() => !document.querySelector("#hnd-std") && document.activeElement.getAttribute("data-act") === "std"), "Escape closes the change and focus goes back to Change");

    // ---------- New leave requests ----------
    const st = await t.api("POST", "/shifts/staff", { full_name: "Ċensina Zammit 6c", designation: "assistant", employment_type: "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: JSON.stringify({ patterns: [], provisionalId: null }) });
    const sid = st.staff_id || st.id;
    t.ok(sid, "a person on the rota");
    const mine = (since) => t.db.prepare("SELECT * FROM shift_leaves WHERE id > ? AND staff_id = ? ORDER BY id").all(since, sid);
    const lvAud = (id) => t.db.prepare("SELECT * FROM audit_log WHERE action = 'SHIFT_LEAVE_CREATE' AND entity_id = ?").get(String(id));
    const cases = [
      { label: "whole days", type: "urgent_family", sd: day(10), ed: day(14), st: "", et: "", reason: "Festa f'Għargħur" },
      { label: "part day", type: "annual", sd: day(20), ed: day(20), st: "13:00", et: "17:30", reason: "" },
    ];
    for (const c of cases) {
      // Classic: Shifts › Leave › Submit Leave Request.
      let l0 = t.maxId("shift_leaves");
      await t.open(p, "classic", "shifts", "shifts", "[data-tab=leave]");
      await p.click("[data-tab=leave]"); await p.waitForSelector("#sl-emp");
      await p.selectOption("#sl-emp", String(sid)); await p.selectOption("#sl-type", c.type);
      await p.fill("#sl-sd", c.sd); await p.fill("#sl-ed", c.ed);
      if (c.st) { await p.fill("#sl-st", c.st); await p.fill("#sl-et", c.et); }
      await p.fill("#sl-rsn", c.reason);
      const cw = await t.write(p, /\/shifts\/leaves$/, () => p.click("#sl-submit"));
      const classic = mine(l0)[0];
      // New layout: Plan shifts › + New leave request.
      l0 = t.maxId("shift_leaves");
      await t.open(p, "2", "shfreg", "shfreg", "[data-act=lv-new]");
      await p.click("[data-act=lv-new]"); await p.waitForSelector("#shf-lvf");
      await p.selectOption("#shf-lvf [name=staff_id]", String(sid)); await p.selectOption("#shf-lvf [name=leave_type]", c.type);
      await p.fill("#shf-lvf [name=start_date]", c.sd); await p.locator("#shf-lvf [name=start_date]").dispatchEvent("change");
      await p.fill("#shf-lvf [name=end_date]", c.ed); await p.locator("#shf-lvf [name=end_date]").dispatchEvent("change");
      if (c.st) { await p.fill("#shf-lvf [name=start_time]", c.st); await p.fill("#shf-lvf [name=end_time]", c.et); }
      await p.fill("#shf-lvf [name=reason]", c.reason);
      const nw = await t.write(p, /\/shifts\/leaves$/, () => p.click("#shf-lvf button[type=submit]"));
      await p.waitForFunction(() => !document.querySelector("#shf-lvf"));
      const fresh = mine(l0)[0];
      const { id: _cid, ...cBody } = cw.body || {};
      t.ok(JSON.stringify(cBody) === JSON.stringify(nw.body), `leave (${c.label}): the same body as classic, key for key (classic's local counter "id" aside): classic ${JSON.stringify(cw.body)} new ${JSON.stringify(nw.body)}`);
      t.same(`leave (${c.label})`, classic, fresh);
      const ca = lvAud(classic && classic.id), fa = lvAud(fresh && fresh.id);
      t.same(`leave (${c.label}) audit`, ca, fa, { entity_id: "the row's own id" });
      await p.waitForFunction(() => document.activeElement && document.activeElement.getAttribute("data-act") === "lv-new", null, { timeout: 3000 }).catch(() => {});
      const after = await p.evaluate(() => ({ listed: [...document.querySelectorAll(".shf-lv")].filter((x) => /Ċensina Zammit 6c/.test(x.textContent)).length, focus: (document.activeElement.outerHTML || "").slice(0, 80) }));
      t.ok(after.listed >= 1 && /data-act="lv-new"/.test(after.focus), `leave (${c.label}): the request is listed to approve, focus back on + New leave request: ` + JSON.stringify(after));
    }
  },
};
