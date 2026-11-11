// FIN-dayzero (W10, W18): Settings › Pharmacy details. A new pharmacy's owner types the address, phone and registration
// no. and presses Save: the label screens' own stored values change (label_settings.pharmacyDetails, templates kept);
// a label printed from Labels (and from the classic Smart labels, the same page) has the address and phone under the
// name and plain directions; Today's "Getting ready" line for the details goes. Staff see the details, cannot change them.
import fs from "node:fs";
const AXE = process.env.AXE || "/tmp/claude-0/-home-user-eikon-ui/a14b1a07-7863-5333-b96b-a89485eb56dd/scratchpad/axe/node_modules/axe-core/axe.min.js";
const CAPTURE = `(() => { window.__printed = []; window.__blobOf = {}; const mk = URL.createObjectURL; URL.createObjectURL = function (b) { const u = mk.call(URL, b); window.__blobOf[u] = b; return u; }; const o = window.open; window.open = function (u, ...a) { if (window.__capture && /^blob:/.test(String(u))) { (window.__blobOf && window.__blobOf[u] ? window.__blobOf[u].text() : fetch(u).then((r) => r.text())).then((t) => window.__printed.push(t)); return {}; } return o.call(window, u, ...a); }; })();`;
export default {
  title: "Pharmacy details: saved once, printed on every label",
  async run(t) {
    const db = t.db;
    const org = Number(db.prepare("INSERT INTO orgs (name) VALUES ('Details Org')").run().lastInsertRowid);
    const loc = Number(db.prepare("INSERT INTO locations (org_id, name) VALUES (?, 'Ħamrun Pharmacy')").run(org).lastInsertRowid);
    const u = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "owner.det@fresh.mt", role: "admin", name: "Joseph Camilleri" });
    const staff = await t.stack.app.addUser({ orgId: org, locationId: loc, email: "staff.det@fresh.mt", role: "staff", name: "Rita Grech" });
    // the classic labels screen saved a template of its own here earlier: it must survive the details save
    const TPL = [{ id: "tpl_std", name: "Standard Label", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: true },
      { id: "tpl_mine", name: "Ours", size: "large", fields: ["drugName"], isDefault: false }];
    await t.stack.app.api("PUT", "/labels/state", { token: u.token, body: { state: { labelHistory: [], templates: TPL, pharmacyDetails: { name: "", address: "", phone: "", licence: "" } } } });
    const pageAs = async (tok) => { const p = await t.page(); await p.context().addInitScript((x) => { try { localStorage.setItem("eikon_token", x); } catch (e) {} }, tok); await p.addInitScript(CAPTURE); return p; };
    const p = await pageAs(u.token);
    await t.open(p, "2", "today", "today", ".tdy-setup");
    t.ok(await p.evaluate(() => !!document.querySelector('.tdy-setup [data-setup="details"]')), "Today: Getting ready asks for the pharmacy's address and phone");
    await p.click('.tdy-setup [data-setup="details"] button');
    await p.waitForFunction(() => window.EIKON.state.activeModuleId === "phdreg" && document.querySelector("#phd-form"), null, { timeout: 10000 });
    t.ok(await p.inputValue("#phd-name") === "Ħamrun Pharmacy", "the name starts as the pharmacy's own");
    // a name left empty: said next to the field, nothing sent
    await p.fill("#phd-name", "");
    let puts = 0; p.on("request", (r) => { if (r.method() === "PUT" && /\/pharmacy\/details$/.test(r.url())) puts++; });
    await p.click("#phd-form button[type=submit]");
    t.ok(await p.evaluate(() => document.querySelector("#phd-name").getAttribute("aria-invalid") === "true" && /name/.test(document.querySelector("#phd-e-name").textContent)) && puts === 0, "an empty name is refused at the field, nothing sent");
    const D = { name: "Ħamrun Pharmacy", address: "12, Triq il-Kbira San Ġużepp, Ħamrun HMR 1011", phone: "2123 4567", licence: "PH 123" };
    await t.fill(p, "#phd-form", { name: D.name, address: D.address, phone: D.phone, licence: D.licence });
    t.ok(/Triq il-Kbira/.test(await p.textContent(".phd-label")), "the example label follows the typing");
    const w = await t.write(p, /\/pharmacy\/details$/, () => p.click("#phd-form button[type=submit]"), "PUT");
    t.ok(w.status === 200 && JSON.stringify(w.body) === JSON.stringify(D), "one PUT with what was typed: " + JSON.stringify(w.body));
    const row = JSON.parse(db.prepare("SELECT settings_json FROM label_settings WHERE org_id = ? AND location_id = ?").get(org, loc).settings_json);
    t.ok(JSON.stringify(row.pharmacyDetails) === JSON.stringify(D) && JSON.stringify(row.templates) === JSON.stringify(TPL), "stored where the label screens keep it; the templates unchanged");
    await p.waitForFunction(() => /Saved/.test((document.querySelector("#phd-msg") || {}).textContent || ""), null, { timeout: 5000 });
    // axe (WCAG 2.1 A/AA) on the new screen, 1280 light and dark, 390 light and dark; no sideways scroll on a phone
    const axeSrc = fs.existsSync(AXE) ? fs.readFileSync(AXE, "utf8") : "";
    const axe = async (pg, label) => { if (!axeSrc) { t.note("axe not found"); return; } await pg.evaluate(axeSrc);
      const v = await pg.evaluate(async () => (await window.axe.run(document.querySelector("#eikon-root") || document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa"] } })).violations.map((x) => x.id + " " + x.nodes[0].target.join(" ")));
      t.ok(!v.length, "axe Pharmacy details, " + label + ": " + v.join(" | ")); };
    await axe(p, "1280 light"); await p.emulateMedia({ colorScheme: "dark" }); await axe(p, "1280 dark"); await p.emulateMedia({ colorScheme: "light" });
    const ph = await t.page({ phone: true }); await ph.context().addInitScript((x) => { try { localStorage.setItem("eikon_token", x); } catch (e) {} }, u.token);
    await t.open(ph, "2", "phdreg", "phdreg", "#phd-form");
    await axe(ph, "390 light"); await ph.emulateMedia({ colorScheme: "dark" }); await axe(ph, "390 dark");
    const sz = await ph.evaluate(() => ({ w: document.documentElement.scrollWidth, small: [...document.querySelectorAll(".phd button, .phd input, .phd textarea")].filter((e) => e.getBoundingClientRect().height < 44).map((e) => e.id || e.className) }));
    t.ok(sz.w <= 390 && !sz.small.length, "phone: no sideways scroll, every control at least 44 px: " + JSON.stringify(sz));
    // ---- a label from the new screen and the same from the classic screen
    const printed = async (click) => { await p.evaluate(() => { window.__capture = true; window.__printed = []; }); await click(); await p.waitForFunction(() => window.__printed.length === 1, null, { timeout: 8000 }); return p.evaluate(() => window.__printed[0]); };
    await t.open(p, "2", "labels", "lblreg", "#lbl-add");
    await p.fill("[name=drugName]", "Amoxicillin 500mg"); await p.waitForTimeout(100); await p.fill("[name=dose]", "1 capsule");
    await p.selectOption("[name=route]", "Oral"); await p.selectOption("[name=frequency]", "Three times daily");
    const fresh = await printed(() => p.click("#lbl-add button[type=submit]"));
    t.ok(fresh.includes("12, Triq il-Kbira San Ġużepp, Ħamrun HMR 1011") && fresh.includes("Tel 2123 4567") && fresh.includes("Reg. no. PH 123"), "the printed label has the address, phone and registration no.");
    t.ok(!/Rx:|Dose\/Freq|\| Three/.test(fresh) && /1 capsule, Three times daily \(oral\)/.test(fresh), "plain directions on the label (no Rx:, no Dose/Freq: … | …)");
    t.ok(/Pharmacy details/.test(await p.textContent(".lbl-note")), "Labels says where the details are changed");
    await p.waitForFunction(() => /saved to recent labels/.test((document.querySelector("#lbl-status") || {}).textContent || ""), null, { timeout: 8000 });
    await t.open(p, "classic", "labels", "labels", "#lb-drug");
    await p.fill("#lb-drug", "Amoxicillin 500mg"); await p.keyboard.press("Escape");
    await p.fill("#lb-dose", "1 capsule"); await p.selectOption("#lb-route", "Oral"); await p.selectOption("#lb-freq", "Three times daily"); await p.fill("#lb-custom", "");
    const classic = await printed(() => p.click(".lb .btn.pri:has-text('Print Label')"));
    t.ok(classic === fresh, "the classic Smart labels prints the same label (" + classic.length + " vs " + fresh.length + " chars)");
    // ---- Today: the line went; staff see the details and cannot change them
    await t.open(p, "2", "today", "today", ".tdy-head h1");
    t.ok(await p.evaluate(() => !document.querySelector('.tdy-setup [data-setup="details"]')), "Today: the details line went once they were saved");
    const sp = await pageAs(staff.token);
    await t.open(sp, "2", "phdreg", "phdreg", ".phd-ro");
    t.ok(/Triq il-Kbira/.test(await sp.textContent(".phd-ro")) && !(await sp.$("#phd-form")) && /admin changes these/.test(await sp.textContent(".phd")), "staff: the details are shown, the admin changes them");
    t.ok(await sp.evaluate(() => { location.hash = "#settings"; return true; }) && (await sp.waitForSelector('.hub-card[data-open="phdreg"]', { timeout: 8000 }).then(() => true)) && await sp.evaluate(() => !document.querySelector('.hub-card[data-open="audit"]')), "staff: no Audit trail card in Settings (it would answer 403)");
  }
};
