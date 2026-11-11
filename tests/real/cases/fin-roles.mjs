// Finish round, roles (W3, W4, W15, W30) on the real worker, in its own pharmacy (rpSeed):
//  - Add a person offers Staff / Pharmacist / Admin; "Pharmacist" saves role staff + is_pharmacist 1 (the same row the
//    API makes for the same body); a second admin can be added and signs in;
//  - People who sign in: "On the rota as …? Not linked yet." → Link → shift_staff.user_id set, nothing else on the row;
//    Role… → Plans the rota → users.plans_rota 1;
//  - a NEW staff sign-in (Rita, no rota right): Plan shifts shows no Fill…/Select/Add, "+ Ask for leave" with Who = her,
//    her request waits ("Waiting for an answer from the pharmacy's admin"), nobody's Approve/Refuse; the worker refuses
//    her own approval (403) and a shift write (403);
//  - an EXISTING staff sign-in (Joe, made before the release) keeps Fill… (today's access);
//  - the pharmacist's sidebar says "Pharmacist"; the admin's "Admin";
//  - Plan shifts › + Add a person to the rota lists the sign-ins not on the rota; picking one saves the classic body and
//    links the new rota person to that sign-in.
import { rpSeed } from "./_rpseed.mjs";
import fs from "node:fs";

const SHOTS = process.env.FIN_SHOTS || "";
export default {
  title: "Roles: admin, pharmacist, staff; rota right; rota linked to sign-ins",
  async run(t) {
    const S = await rpSeed(t, { tag: "roles", weeks: 2 });
    const shot = async (p, n) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await p.screenshot({ path: SHOTS + "/after-" + n + ".png", fullPage: true }).catch(() => {}); } };
    const asUser = async (email, temp, phone) => {
      const L = await t.stack.app.api("POST", "/auth/login", { body: { email, password: temp } });
      await t.stack.app.api("POST", "/auth/change-password", { token: L.json.token, body: { current_password: temp, new_password: "Own-pass-2026!" } });
      const p = await t.page({ phone });
      await p.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} }, L.json.token);
      return { p, token: L.json.token, id: L.json.user.id };
    };
    const U = "users";

    // ---- Add a person: Pharmacist (UI) vs the API's row for the same body
    let u0 = t.maxId(U);
    await S.api("POST", "/team/users", { email: "roles-api@demo.mt", full_name: "Api Pharmacist", role: "pharmacist" });
    const apiRow = (await t.mine(U, u0, { email: "roles-api@demo.mt" }))[0];
    const pa = await S.page();
    await t.open(pa, "2", "teamreg", "teamreg", "[data-act=add]");
    await pa.click("[data-act=add]"); await pa.waitForSelector("#tmr-add");
    const opts = await pa.evaluate(() => [...document.querySelectorAll("#tmr-role option")].map((o) => o.value + ":" + o.textContent));
    t.ok(opts.join("|") === "staff:Staff|pharmacist:Pharmacist|admin:Admin (adds people, changes settings)", "Role offers Staff, Pharmacist, Admin: " + opts.join("|"));
    await pa.fill("#tmr-name", "Ġanni Pace"); await pa.fill("#tmr-email", "roles-ganni@demo.mt"); await pa.selectOption("#tmr-role", "pharmacist");
    u0 = t.maxId(U);
    const w = await t.write(pa, /\/team\/users$/, () => pa.press("#tmr-email", "Enter"));
    t.ok(w.body && w.body.role === "pharmacist", "the body says role pharmacist: " + JSON.stringify(w.body));
    const gTemp = w.json && w.json.temporary_password;
    const ganni = (await t.mine(U, u0, { email: "roles-ganni@demo.mt" }))[0];
    t.same("sign-in (pharmacist)", apiRow, ganni, { email: "another person", full_name: "another person", pass_salt_b64: "random", pass_hash_b64: "random temporary password" });
    t.has("pharmacist row", ganni, { role: "staff", is_pharmacist: 1, plans_rota: 0 });
    await pa.click("[data-act=done]");
    // a second admin
    const adm = await S.api("POST", "/team/users", { email: "roles-admin2@demo.mt", full_name: "Anna Second", role: "admin" });
    t.ok(adm && adm.ok && t.db.prepare("SELECT role FROM users WHERE email = 'roles-admin2@demo.mt'").get().role === "admin", "a second admin is added by the pharmacy's admin");
    const A2 = await asUser("roles-admin2@demo.mt", adm.temporary_password);
    t.ok((await t.stack.app.api("GET", "/team/users", { token: A2.token })).status === 200, "the second admin signs in and manages sign-ins");

    // ---- a new staff sign-in with the same name as a rota row: link it from People who sign in
    const rita = await S.api("POST", "/team/users", { email: "roles-rita@demo.mt", full_name: "Rita Camilleri", role: "staff" });
    const ritaId = t.db.prepare("SELECT id FROM users WHERE email = 'roles-rita@demo.mt'").get().id;
    await pa.reload(); await t.open(pa, "2", "teamreg", "teamreg", '[data-user="' + ritaId + '"]');
    const line = await pa.evaluate((id) => (document.querySelector('[data-user="' + id + '"] .tmr-rota') || {}).textContent || "", ritaId);
    t.ok(/On the rota as Rita Camilleri\? Not linked yet\./.test(line), "People who sign in offers the rota row with her name: " + line);
    await shot(pa, "teamreg-rota-line-dk");
    const before = JSON.stringify(t.db.prepare("SELECT id, full_name, designation, email, patterns_json, is_active FROM shift_staff WHERE id = ?").get(S.ids.rita));
    await pa.click('[data-user="' + ritaId + '"] [data-act=rota]'); await pa.waitForSelector("#tmr-rota-pick");
    t.ok(await pa.evaluate((sid) => document.querySelector("#tmr-rota-pick").value === String(sid), S.ids.rita), "the dialog has her rota row chosen");
    await t.write(pa, /\/shifts\/staff\/\d+\/link$/, () => pa.click("#eikon-modal-actions .primary"));
    await pa.waitForTimeout(300);
    t.ok(t.db.prepare("SELECT user_id FROM shift_staff WHERE id = ?").get(S.ids.rita).user_id === ritaId, "the rota row is linked to her sign-in");
    t.ok(JSON.stringify(t.db.prepare("SELECT id, full_name, designation, email, patterns_json, is_active FROM shift_staff WHERE id = ?").get(S.ids.rita)) === before, "nothing else on the rota row changed");

    // ---- Rita (new staff: does not plan the rota) on Plan shifts
    const R = await asUser("roles-rita@demo.mt", rita.temporary_password, true);
    // on her phone, Plan shifts opens her own two weeks (Who's in › Your next shifts)
    await R.p.goto(t.base + "?ui=2#shfreg");
    await R.p.waitForFunction(() => window.EIKON && window.EIKON.state && window.EIKON.state.activeModuleId === "rotreg" && document.querySelector(".rot-mine"), null, { timeout: 15000 }).catch(() => {});
    const landed = await R.p.evaluate(() => ({ mod: window.EIKON.state.activeModuleId, mine: !!document.querySelector(".rot-mine") }));
    t.ok(landed.mod === "rotreg" && landed.mine, "on a phone without the rota right, Plan shifts lands on her next shifts: " + JSON.stringify(landed));
    await shot(R.p, "staff-phone-mine-ph");
    // the rest on a computer (the whole rota stays on Plan shifts there)
    const R2 = await t.page(); await R2.context().addInitScript((tok) => { try { localStorage.setItem("eikon_token", tok); localStorage.setItem("eikon_active_role", "pharmacy"); } catch (e) {} }, R.token);
    R.p = R2;
    await t.open(R.p, "2", "shfreg", "shfreg", ".shf-sub");
    const ro = await R.p.evaluate(() => ({ fill: !!document.querySelector('[data-act="fill-open"]'), pick: !!document.querySelector('[data-act="pick"]'), add: !!document.querySelector('[data-act="add"]'), who: !!document.querySelector('[data-act="who"]'),
      sub: document.querySelector(".shf-sub").textContent, ask: [...document.querySelectorAll('[data-act="lv-new"]')].map((b) => b.textContent).join(), approve: document.querySelectorAll("[data-act=lv-approve]").length }));
    t.ok(!ro.fill && !ro.pick && !ro.add && !ro.who && /Only the pharmacy's admin changes shifts/.test(ro.sub) && /Ask for leave/.test(ro.ask) && ro.approve === 0, "staff without the rota right: no Fill…, Select, Add; Ask for leave; no Approve: " + JSON.stringify(ro));
    await shot(R.p, "staff-plan-shifts-ph");
    await R.p.click('[data-act="lv-new"]'); await R.p.waitForSelector("#shf-lvf");
    t.ok(await R.p.evaluate((sid) => document.querySelector("#shf-lvf [name=staff_id]").value === String(sid), S.ids.rita), "Who is Rita by default (her linked rota row)");
    const L0 = t.maxId("shift_leaves");
    await t.write(R.p, /\/shifts\/leaves$/, () => R.p.click("#shf-lvf button[type=submit]"));
    const mine = (await t.mine("shift_leaves", L0, { staff_id: S.ids.rita }))[0];
    t.ok(mine && mine.status === "pending" && mine.created_by === R.id, "her request is saved, pending, made by her");
    await R.p.evaluate(() => { location.hash = "#team"; }); await R.p.waitForFunction(() => window.EIKON.state.activeModuleId === "team");
    await R.p.evaluate(() => { location.hash = "#shfreg"; }); await R.p.waitForSelector(".shf-lv");
    if (await R.p.$('[data-act="lv-open"]')) { await R.p.click('[data-act="lv-open"]'); await R.p.waitForTimeout(150); }
    const q = await R.p.evaluate(() => ({ wait: [...document.querySelectorAll(".shf-lv .q")].map((x) => x.textContent), approve: document.querySelectorAll("[data-act=lv-approve]").length }));
    t.ok(q.approve === 0 && q.wait.some((x) => /Waiting for an answer from the pharmacy's admin/.test(x)) && q.wait.some((x) => /The pharmacy's admin answers it/.test(x)), "her request waits; Lara's is the admin's to answer: " + JSON.stringify(q));
    await shot(R.p, "staff-leave-waiting-ph");
    const own = await t.stack.app.api("POST", "/shifts/leaves/" + mine.id + "/approve", { token: R.token });
    t.ok(own.status === 403 && t.row("shift_leaves", mine.id).status === "pending", "the worker refuses her own approval: " + own.status);
    const sh = await t.stack.app.api("POST", "/shifts/assignments", { token: R.token, body: { staff_id: S.ids.rita, shift_date: S.d(1), start_time: "08:00", end_time: "12:00", notes: "" } });
    t.ok(sh.status === 403, "the worker refuses a shift write without the rota right: " + sh.status);

    // ---- Role… → Plans the rota (admin), then Rita plans; her own leave still is not hers to answer
    await pa.click('[data-user="' + ritaId + '"] [data-act=role]'); await pa.waitForSelector("#tmr-plan");
    await pa.check("#tmr-plan");
    await t.write(pa, /\/team\/users\/\d+\/rights$/, () => pa.click("#eikon-modal-actions .primary"));
    t.ok(t.db.prepare("SELECT plans_rota FROM users WHERE id = ?").get(ritaId).plans_rota === 1, "Plans the rota saved");
    await R.p.reload(); await t.open(R.p, "2", "shfreg", "shfreg", ".shf-sub");
    if (await R.p.$('[data-act="lv-open"]')) { await R.p.click('[data-act="lv-open"]'); await R.p.waitForTimeout(150); }
    const r2 = await R.p.evaluate((id) => ({ pick: !!document.querySelector('[data-act="pick"]') || !!document.querySelector('[data-act="fill-open"]'), ownBtn: !!document.querySelector('[data-act=lv-approve][data-id="' + id + '"]'), lara: document.querySelectorAll("[data-act=lv-approve]").length }), mine.id);
    t.ok(r2.pick && !r2.ownBtn && r2.lara >= 1, "with the rota right she plans and answers Lara's leave, never her own: " + JSON.stringify(r2));

    // ---- Joe (existing staff, made before the release): today's access
    const pj = await S.page({ staff: true });
    await t.open(pj, "2", "shfreg", "shfreg", ".shf-sub");
    t.ok(await pj.evaluate(() => !!document.querySelector('[data-act="fill-open"]')), "an existing staff sign-in keeps Fill… (plans the rota as before)");

    // ---- sidebar words
    const G = await asUser("roles-ganni@demo.mt", gTemp);
    await t.open(G.p, "2", "today", "today", ".eikon-rail-who");
    await G.p.waitForFunction(() => /Pharmacist/.test((document.querySelector(".eikon-rail-who span") || {}).textContent || ""), null, { timeout: 5000 }).catch(() => {});
    const gw = await G.p.evaluate(() => (document.querySelector(".eikon-rail-who span") || {}).textContent || "");
    t.ok(/^Pharmacist · signed in/.test(gw), "the pharmacist's sidebar says Pharmacist: " + gw);
    await t.open(pa, "2", "today", "today", ".eikon-rail-who");
    const aw = await pa.evaluate(() => (document.querySelector(".eikon-rail-who span") || {}).textContent || "");
    t.ok(/^Admin · signed in/.test(aw), "the admin's sidebar says Admin (the People who sign in word): " + aw);

    // ---- Plan shifts › + Add a person to the rota: pick a sign-in; the classic body, then the link
    const c0 = t.maxId("shift_staff");
    await S.api("POST", "/shifts/staff", { full_name: "Classic Body", designation: "pharmacist", employment_type: "fulltime", contracted_hours: 40, email: "", phone: "", registration_number: "", is_active: 1, patterns_json: JSON.stringify({ patterns: [], provisionalId: null }) });
    const classic = (await t.mine("shift_staff", c0, { full_name: "Classic Body" }))[0];
    await t.open(pa, "2", "shfreg", "shfreg", '[data-act="who"]');
    await pa.click('[data-act="who"]'); await pa.waitForSelector('[data-act="who-acc"]');
    const chips = await pa.evaluate(() => [...document.querySelectorAll('[data-act="who-acc"]')].map((b) => b.textContent));
    t.ok(chips.includes("Ġanni Pace") && !chips.includes("Rita Camilleri"), "the sign-ins not on the rota are offered (Rita is linked already): " + chips.join(", "));
    await shot(pa, "who-works-here-accounts-dk");
    await pa.click('[data-act="who-acc"]:has-text("Ġanni Pace")');
    const s0 = t.maxId("shift_staff");
    await t.write(pa, /\/shifts\/staff\/\d+\/link$/, () => pa.click('[data-k="who-add"]'));
    const made = (await t.mine("shift_staff", s0, { full_name: "Ġanni Pace" }))[0];
    t.same("rota person from a sign-in", classic, made, { full_name: "another person", user_id: "linked to the sign-in picked" });
    t.ok(made && made.user_id === ganni.id && made.designation === "pharmacist", "the new rota person is linked to Ġanni's sign-in, as a pharmacist");
    // nothing lost: a rota-only person with no sign-in (a locum) is still added from the same box, with no link call
    await pa.waitForSelector('#shf-who [name="full_name"]');
    const links = []; pa.on("request", (r) => { if (/\/link$/.test(r.url())) links.push(r.url()); });
    await pa.fill('#shf-who [name="full_name"]', "Helen Locum"); await pa.selectOption('#shf-who [name="designation"]', "locum");
    const l0 = t.maxId("shift_staff");
    await t.write(pa, /\/shifts\/staff$/, () => pa.click('[data-k="who-add"]'));
    const loc = (await t.mine("shift_staff", l0, { full_name: "Helen Locum" }))[0];
    await pa.waitForTimeout(300);
    t.ok(loc && loc.designation === "locum" && loc.user_id == null && !links.length, "a locum with no sign-in is added to the rota as before (no link): " + JSON.stringify(loc && { d: loc.designation, u: loc.user_id }) + " links " + links.length);
    await shot(pa, "who-works-here-locum-dk");
  },
};
