// People (Team & shifts, 2026-11-10): Contacts and People who sign in, presentation only.
//  - Contacts: our team from the rota (role words, one-tap tel:/mailto:, nothing to change here), Starred and Called
//    recently kept on this device only (E.picks keys end in :<location>; nothing is sent), Maltese letters optional in
//    search; the rota is read once and kept for 5 minutes (a second open asks nothing more of it).
//  - People who sign in: today's sign-ins first with the Malta time; Add a person sends exactly the body it sent before.
import { maltaYmd } from "../../clock.mjs";
export default {
  title: "People: contacts (our team, starred, called recently) and sign-ins today first",
  async run(t) {
    const tag = Date.now() % 100000;
    const st = await t.api("POST", "/shifts/staff", { full_name: "Ċensina Zammit " + tag, designation: "assistant", employment_type: "fulltime", contracted_hours: 40, phone: "7900 2222", email: "censina" + tag + "@demo.mt" });
    const sid = st.staff_id || st.id;
    t.ok(sid, "a person on the rota");
    const sup = await t.api("POST", "/contacts/suppliers", { name: "Hili Pharma " + tag, phone: "2133 0000", email: "orders@hili.example" });
    const supK = "suppliers:" + sup.id;

    const p = await t.page();
    const reqs = []; p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/ui/") || u.pathname.startsWith("/vendor/")) return; reqs.push(r.method() + " " + u.pathname + u.search); });
    await t.open(p, "2", "conreg", "conreg", "#con-q");
    await p.waitForSelector(`[data-open="team:${sid}"]`);
    const staffGets = () => reqs.filter((x) => x.startsWith("GET /shifts/staff")).length;
    t.ok(staffGets() === 1, "the rota is read once on opening Contacts: " + staffGets());
    const row = await p.evaluate((k) => { const b = document.querySelector(`[data-open="${k}"]`), r = b.closest(".con-row"), a = r.querySelector(".con-call"); return { sub: b.querySelector("span").textContent, href: a && a.getAttribute("href") }; }, "team:" + sid);
    t.ok(/Pharmacy assistant/.test(row.sub) && row.href === "tel:79002222", "our team: the role in words and a one-tap Call: " + JSON.stringify(row));
    await p.click(`[data-open="team:${sid}"]`); await p.waitForSelector(".con-card");
    const card = await p.evaluate(() => ({ call: (document.querySelector(".con-quick a[href^='tel:']") || {}).textContent, mail: (document.querySelector(".con-quick a[href^='mailto:']") || {}).textContent, edit: !!document.querySelector(".con-card [data-act=edit]"), del: !!document.querySelector(".con-card [data-act=del]"), link: !!document.querySelector('.con-card a[href="#shfreg"]') }));
    t.ok(card.call === "Call 7900 2222" && card.mail === "Email" && !card.edit && !card.del && card.link, "our team: Call and Email in one tap, nothing to change here, Plan shifts linked: " + JSON.stringify(card));

    // Maltese letters optional
    await p.click(".con-card ~ * [data-act=close], .con-dback[data-act=close]").catch(() => {});
    await p.fill("#con-q", "hili pharma " + tag); await p.waitForTimeout(150);
    t.ok(await p.locator(`.con-open[data-open="${supK}"]`).count() >= 1, "“hili” finds Hili");

    // Starred: this device only, per location, nothing sent
    const writes0 = reqs.filter((x) => !x.startsWith("GET ")).length;
    await p.click(`.con-open[data-open="${supK}"]`); await p.click(".con-card [data-act=star]");
    await p.fill("#con-q", ""); await p.dispatchEvent("#con-q", "input"); await p.waitForTimeout(150);
    const lab = await p.evaluate(() => [...document.querySelectorAll(".con-lab")].map((x) => x.textContent));
    t.ok(/^Starred/.test(lab[0] || ""), "Starred comes first: " + lab.slice(0, 3).join(" | "));
    const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => /eikon_picks_v1\|.*\|conreg\|/.test(k)));
    const loc = await p.evaluate(() => window.EIKON.state.user.location_id);
    t.ok(keys.length >= 1 && keys.every((k) => k.endsWith(":" + loc)), "kept on this device under :<location>: " + keys.join());

    // Called recently: a tap on Call is remembered (the dialler itself is not opened here)
    await p.evaluate(() => document.addEventListener("click", (e) => { if (e.target.closest && e.target.closest("a[href^='tel:'],a[href^='mailto:']")) e.preventDefault(); }, true));
    await p.click(`.con-row:has(.con-open[data-open="team:${sid}"]) .con-call >> nth=0`);
    await p.evaluate(() => { const q = document.querySelector("#con-q"); q.value = "x"; q.dispatchEvent(new Event("input")); q.value = ""; q.dispatchEvent(new Event("input")); });
    const lab2 = await p.evaluate(() => [...document.querySelectorAll(".con-lab")].map((x) => x.textContent.trim()));
    t.ok(lab2[0].startsWith("Starred") && lab2[1] === "Called recently", "Called recently under Starred: " + lab2.slice(0, 3).join(" | "));
    t.ok(reqs.filter((x) => !x.startsWith("GET ")).length === writes0, "starring and calling send nothing");

    // a second open within 5 minutes reads the rota from memory
    await t.open(p, "2", "today", "today");
    await t.open(p, "2", "conreg", "conreg", `[data-open="team:${sid}"]`);
    t.ok(staffGets() === 1, "a second open asks nothing more of the rota: " + staffGets());

    // ---------- People who sign in: today first, Malta time; Add a person's body unchanged ----------
    const env = t.stack.app.env, hadMA = env && env.TEAM_ADMINS_MANAGE_ADMINS;
    if (env) env.TEAM_ADMINS_MANAGE_ADMINS = "1"; // so Make admin, the fifth write, is on the screen too (put back at the end)
    await t.open(p, "2", "teamreg", "teamreg", ".tmr-row[data-user]");
    const tm = await p.evaluate(() => ({ first: (document.querySelector(".tmr-list .tmr-row .tmr-who > span") || {}).textContent || "", lab: document.querySelector(".tmr-lab").textContent }));
    const meRow = t.db.prepare("SELECT MAX(s.created_at) AS at FROM sessions s JOIN users u ON u.id = s.user_id").get();
    t.ok(/Signed in today at \d{2}:\d{2}/.test(tm.first) && /signed in today/.test(tm.lab), "today's sign-ins first, with the time: " + JSON.stringify(tm) + " (latest session " + (meRow && meRow.at) + ", Malta " + maltaYmd(0) + ")");
    const posts = []; p.on("request", (r) => { if (r.method() === "POST" && /\/team\/users/.test(r.url())) posts.push(r.postData()); });
    await p.click("[data-act=add]"); await p.fill("#tmr-name", "Ġużi Hili " + tag); await p.fill("#tmr-email", "Guzi" + tag + "@Demo.mt");
    await t.write(p, /\/team\/users$/, () => p.click("#tmr-add button[type=submit]"));
    t.ok(posts.length >= 1 && posts[0] === JSON.stringify({ email: "guzi" + tag + "@demo.mt", full_name: "Ġużi Hili " + tag, role: "staff" }), "Add a person sends the same body as before: " + posts.join());
    await p.click("[data-act=done]");
    // the other writes of the screen, on the person just added: the same bodies the base screen (124158a) sends
    const uid = (t.db.prepare("SELECT id FROM users WHERE email = ?").get("guzi" + tag + "@demo.mt") || {}).id;
    const modal = (label) => p.evaluate((l) => { const b = [...document.querySelectorAll("#eikon-modal-actions button")].find((x) => x.textContent.trim() === l); if (b) b.click(); return !!b; }, label);
    await p.waitForSelector(`[data-act="reset"][data-id="${uid}"]`);
    await t.write(p, new RegExp("/team/users/" + uid + "/password$"), async () => { await p.click(`[data-act="reset"][data-id="${uid}"]`); await modal("New password"); });
    await p.waitForSelector("[data-act=done]"); await p.click("[data-act=done]");
    await t.write(p, new RegExp("/team/users/" + uid + "/active$"), async () => { await p.click(`[data-act="off"][data-id="${uid}"]`); await modal("Switch off"); });
    await p.waitForSelector(`[data-act="on"][data-id="${uid}"]`);
    await t.write(p, new RegExp("/team/users/" + uid + "/active$"), () => p.click(`[data-act="on"][data-id="${uid}"]`));
    const want = [{ email: "guzi" + tag + "@demo.mt", full_name: "Ġużi Hili " + tag, role: "staff" }, {}, { active: false }, { active: true }].map((x) => JSON.stringify(x));
    if (await p.waitForSelector(`[data-act="role"][data-id="${uid}"]`, { timeout: 4000 }).then(() => true, () => false)) { // Role… (roles round: Staff / Pharmacist / Admin; the pharmacy admin may make an admin)
      await p.waitForSelector(`[data-act="role"][data-id="${uid}"]`);
      await t.write(p, new RegExp("/team/users/" + uid + "/role$"), async () => { await p.click(`[data-act="role"][data-id="${uid}"]`); await p.check('input[name="tmr-role-pick"][value="admin"]'); await modal("Save"); });
      want.push(JSON.stringify({ role: "admin" }));
    } else t.note("Make admin is off on this server (TEAM_ADMINS_MANAGE_ADMINS): four of the five bodies compared");
    t.ok(want.length === 5, "all five sign-in writes driven: " + want.length);
    t.ok(JSON.stringify(posts) === JSON.stringify(want), "every sign-in write sends the base screen's body:\n got  " + posts.join(" ") + "\n want " + want.join(" "));
    if (env) { if (hadMA === undefined) delete env.TEAM_ADMINS_MANAGE_ADMINS; else env.TEAM_ADMINS_MANAGE_ADMINS = hadMA; }
    const u = t.db.prepare("SELECT is_active, role FROM users WHERE id = ?").get(uid);
    t.ok(u && Number(u.is_active) === 1, "the person is switched on again at the end: " + JSON.stringify(u));
  },
};
