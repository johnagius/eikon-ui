// Screening (scrreg, clinic round) vs the classic Screening screen, on two identical campaigns:
// 1. a person screened with a follow-up date in the new form is stored exactly as the classic Add Participant, then
//    Follow-up › Save Follow-up leaves them (every key and value but the two ids);
// 2. Mark done on a follow-up stores exactly what the classic Edit follow-up › Status Completed › Save Follow-up stores;
// 3. the rest of each campaign is untouched, and another pharmacy never sees either campaign.
import { ymd } from "../lib.mjs";
const T = "screening_campaigns";
const stamp = Date.now(), A = "sc_rcA_" + stamp, B = "sc_rcB_" + stamp, P0 = "sc_rp0_" + stamp, F0 = "sc_rf0_" + stamp;
const camp = (id, name) => ({ id, name, type: "Blood Pressure Check", startDate: ymd(-3), endDate: ymd(10), notes: "", status: "Active", location: "Pharmacy Floor", targetScreenings: "40", extra: "kept",
  participants: [{ id: P0, idCard: "0333111M", name: "Vella Ġużeppa", phone: "79333111", email: "", dob: "", type: "Walk-in", date: ymd(-2), resultNotes: "", resultCategory: "Borderline", referral: "No referral needed", referralNotes: "",
    poctResults: { sys: 142, dia: 88, pulse: 70, arm: "Left", position: "Sitting" }, followUps: [{ id: F0, scheduledDate: ymd(-1), reason: " Re-test blood pressure ", status: "Pending", notes: "" }] }] });
const IN = { idCard: "0444222M", name: "Żammit Ċensa", phone: "79444222", date: ymd(0), sys: "158", dia: "96", pulse: "77", cat: "Abnormal", ref: "Referred to GP", res: "High twice", refNotes: "Letter given", fuDate: ymd(14), fuReason: "Re-test blood pressure" };
const stored = (t, id) => { const r = t.db.prepare(`SELECT campaign_json FROM ${T} WHERE campaign_id = ?`).get(id); return r ? JSON.parse(r.campaign_json) : null; };
export default {
  title: "Screening: record with a follow-up, Mark done",
  async run(t) {
    const put = await t.api("PUT", "/screening/state", { state: { campaigns: [camp(A, "Real check A " + stamp), camp(B, "Real check B " + stamp)], deleted_ids: [] } });
    t.ok(put && put.ok, "seed: two identical campaigns " + JSON.stringify(put).slice(0, 120));
    const p = await t.page();

    // ---- classic: Add Participant, then Follow-up › Save; then Edit the earlier follow-up › Completed › Save
    await t.open(p, "classic", "screening", "screening", ".camp-card");
    await p.locator(".camp-card", { hasText: "Real check A " + stamp }).first().click();
    await p.locator("button", { hasText: "+ Add Participant" }).click(); await p.waitForSelector("#sc-p-idcard");
    await t.fill(p, "", { "#sc-p-idcard": IN.idCard, "#sc-p-name": IN.name, "#sc-p-phone": IN.phone, "#sc-p-date": IN.date, "#sc-poct-sys": IN.sys, "#sc-poct-dia": IN.dia, "#sc-poct-pulse": IN.pulse, "#sc-p-result": IN.res, "#sc-p-refnotes": IN.refNotes });
    await p.selectOption("#sc-poct-arm", "Left"); await p.selectOption("#sc-poct-position", "Sitting"); await p.selectOption("#sc-p-cat", IN.cat); await p.selectOption("#sc-p-ref", IN.ref);
    await t.write(p, /\/screening\/state$/, () => p.click("#sc-p-save"), "PUT"); await t.idle(p);
    await p.locator("tr", { hasText: IN.name }).locator("button", { hasText: "Follow-up" }).click(); await p.waitForSelector("#sc-f-date");
    await t.fill(p, "", { "#sc-f-date": IN.fuDate, "#sc-f-reason": IN.fuReason });
    await t.write(p, /\/screening\/state$/, () => p.click("#sc-f-save"), "PUT"); await t.idle(p);
    await p.locator("tr", { hasText: "Re-test blood pressure" }).filter({ hasText: "Vella" }).locator("button", { hasText: "Edit" }).click(); await p.waitForSelector("#sc-f-status");
    await p.selectOption("#sc-f-status", "Completed");
    await t.write(p, /\/screening\/state$/, () => p.click("#sc-f-save"), "PUT"); await t.idle(p);
    const ca = stored(t, A);

    // ---- new: New screening with a follow-up date (In 2 weeks), then Follow-ups › Mark done on the earlier one
    await p.goto("about:blank"); await t.open(p, "2", "screening", "scrreg", ".scr-row");
    await p.click(`.scr-row[data-id="${B}"]`); await p.click(".scr-acts-top [data-act=add]"); await p.waitForSelector("#scr-add");
    await t.fill(p, "#scr-add", { idCard: IN.idCard, name: IN.name, phone: IN.phone, date: IN.date, r_sys: IN.sys, r_dia: IN.dia, r_pulse: IN.pulse, resultNotes: IN.res, referralNotes: IN.refNotes });
    await p.selectOption("#scr-add [name=r_arm]", "Left"); await p.selectOption("#scr-add [name=r_position]", "Sitting"); await p.selectOption("#scr-add [name=resultCategory]", IN.cat); await p.selectOption("#scr-add [name=referral]", IN.ref);
    const live = await p.textContent("#scr-live");
    await p.click('[data-act=fu-in][data-d="14"]'); await t.fill(p, "#scr-add", { fuReason: IN.fuReason });
    const fuDay = await p.inputValue("#scr-add [name=fuDate]");
    const w1 = await t.write(p, /\/screening\/state$/, () => p.click("#scr-add button[type=submit]"), "PUT"); await t.idle(p);
    t.ok(w1.body && w1.body.state && w1.body.state.campaigns.length === 1 && w1.body.state.campaigns[0].id === B && w1.body.state.deleted_ids.length === 0, "record(new): one campaign sent, nothing deleted");
    await p.click(".scr-back[data-act=list]"); await p.click('[data-act=tab][data-tab="fu"]');
    await p.waitForSelector(`[data-act=fu-done][data-c="${B}"][data-f="${F0}"]`);
    const fuText = await p.textContent(".scr");
    const w2 = await t.write(p, /\/screening\/state$/, () => p.click(`[data-act=fu-done][data-c="${B}"][data-f="${F0}"]`), "PUT"); await t.idle(p);
    t.ok(w2.body && w2.body.state.campaigns.length === 1 && w2.body.state.campaigns[0].id === B && w2.body.state.deleted_ids.length === 0, "mark done(new): one campaign sent, nothing deleted");
    const cb = stored(t, B);

    // ---- compare
    t.ok(/High/.test(live) && /140\/90/.test(live), "record(new): the reading is marked against the guide as it is typed: " + live);
    t.ok(fuDay === IN.fuDate, "record(new): In 2 weeks sets the follow-up date " + fuDay);
    t.ok(/Overdue · 1 day/.test(fuText) && /Vella Ġużeppa/.test(fuText), "follow-ups(new): the earlier one shows Overdue · 1 day with the person");
    const pa = ca.participants.find((x) => x.name === IN.name), pb = cb.participants.find((x) => x.name === IN.name);
    const strip = (x) => { const c = JSON.parse(JSON.stringify(x)); delete c.id; (c.followUps || []).forEach((f) => delete f.id); return c; };
    t.ok(pa && pb && JSON.stringify(strip(pa)) === JSON.stringify(strip(pb)), "record: the new person is stored as classic Add Participant + Follow-up (all keys, same order, same values but ids):\n classic " + JSON.stringify(pa) + "\n new     " + JSON.stringify(pb));
    t.ok(pb && /^sc_\d+_[a-z0-9]+$/.test(pb.id) && /^sc_\d+_[a-z0-9]+$/.test(pb.followUps[0].id), "record: the ids have the classic shape");
    const fa = ca.participants.find((x) => x.id === P0).followUps[0], fb = cb.participants.find((x) => x.id === P0).followUps[0];
    t.ok(JSON.stringify(fa) === JSON.stringify(fb), "mark done: the follow-up is stored as the classic Edit › Completed › Save leaves it:\n classic " + JSON.stringify(fa) + "\n new     " + JSON.stringify(fb));
    t.ok(fb.status === "Completed" && fb.reason === "Re-test blood pressure", "mark done: Completed, reason trimmed as the classic does");
    const rest = (c) => { const x = JSON.parse(JSON.stringify(c)); delete x.id; delete x.name; x.participants = x.participants.map(strip); return x; };
    t.ok(JSON.stringify(rest(ca)) === JSON.stringify(rest(cb)), "campaign: everything else identical (the unknown field kept, the earlier person untouched)");

    // ---- reads: opening each screen asks for its one state, as before (0 new requests)
    const reqs = []; p.on("request", (r) => { if (/\/(poct|screening)\/state$/.test(new URL(r.url()).pathname)) reqs.push(r.method() + " " + new URL(r.url()).pathname); });
    await p.goto("about:blank"); await t.open(p, "2", "poct", "pocreg", ".poc-list, .poc-quiet"); const nP = reqs.length;
    await p.goto("about:blank"); await t.open(p, "2", "screening", "scrreg", ".scr-row"); await p.click('[data-act=tab][data-tab="fu"]'); await p.click(`.scr-row[data-id="${B}"]`).catch(() => {}); await t.idle(p);
    t.ok(nP === 1 && reqs.length === 2 && reqs.every((x) => x.startsWith("GET")), "reads: POCT opens with one GET /poct/state, Screening with one GET /screening/state; the Follow-ups view reads nothing more: " + reqs.join(", "));

    // ---- another pharmacy never sees them
    let seen = null;
    try {
      t.db.prepare("INSERT OR IGNORE INTO orgs (id, name) VALUES (77, 'Other Group')").run(); t.db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (770, 77, 'Other Pharmacy')").run();
      await t.stack.app.addUser({ orgId: 77, locationId: 770, email: "scr" + stamp + "@demo.mt", password: "Demo-Pass-2026", name: "Other Place" });
      const lg = await t.stack.app.api("POST", "/auth/login", { body: { email: "scr" + stamp + "@demo.mt", password: "Demo-Pass-2026" } });
      const st = await t.stack.app.api("GET", "/screening/state", { token: lg.json && lg.json.token });
      seen = st.json && st.json.ok !== false ? JSON.stringify(st.json).includes(String(stamp)) : null;
      if (seen === null) t.note("isolation: " + JSON.stringify(st.json).slice(0, 120));
    } catch (e) { t.note("isolation not run: " + e.message); }
    t.ok(seen === false, "isolation: another pharmacy's GET /screening/state answers and shows neither campaign");
  },
};
