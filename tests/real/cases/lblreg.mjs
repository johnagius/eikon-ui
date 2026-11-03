// Dispensing labels (lblreg) vs classic Smart labels (from the r109 label method, agents/labels/lbl-real.mjs):
// the printed page is identical, and the saved history entry matches the classic one field for field.
const CAPTURE = `(() => { window.__printed = []; const o = window.open; window.open = function (u, ...a) { if (window.__capture && /^blob:/.test(String(u))) { fetch(u).then((r) => r.text()).then((t) => window.__printed.push(t)); return {}; } return o.call(window, u, ...a); }; })();`;
const TPL = [
  { id: "tpl_std", name: "Standard Label", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: true },
  { id: "tpl_large", name: "Large Print (Elderly)", size: "large", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: false },
  { id: "tpl_mt", name: "Maltese", size: "standard", language: "mt", fields: [], isDefault: false }];
const PH = { name: "Demo Pharmacy", address: "1 Triq il-Kbira, Mosta", phone: "21234567", licence: "PH-042" };
const INPUTS = [
  { name: "English, standard", tpl: "tpl_std", mt: false, patient: "", drug: "Amoxicillin 500mg", dose: "1 capsule", freq: "Three times daily", route: "Oral", note: "Until finished", w: ["w10", "w01"] },
  { name: "English + Maltese, large print, patient, odd characters", tpl: "tpl_large", mt: true, patient: "Zammit Carmel", drug: "Paracetamol <500mg> & co", dose: "2 tablets", freq: "Every 6 hours", route: "Oral", note: "Max 8 in 24h \"strict\"", w: ["w03", "w08"] },
  { name: "Maltese template", tpl: "tpl_mt", mt: true, patient: "Borg Ġorġ", drug: "Ċetirizina 10mg", dose: "1 pillola", freq: "Once daily", route: "Sublingual", note: "", w: ["w16", "w13", "w03"] }];
export default {
  title: "Dispensing labels",
  async run(t) {
    const p = await t.page();
    await p.addInitScript(CAPTURE);
    const r0 = await t.api("PUT", "/labels/state", { state: { labelHistory: [], templates: TPL, pharmacyDetails: PH } });
    t.ok(r0 && r0.ok !== false, "label templates and pharmacy details set");
    const setChips = async (sel, attr, want, onTest) => { for (const el of await p.locator(sel).all()) { const id = await el.getAttribute(attr); if ((await el.evaluate(onTest)) !== want.includes(id)) await el.click(); } };
    const printed = async (click) => { await p.evaluate(() => { window.__capture = true; window.__printed = []; }); await click(); await p.waitForFunction(() => window.__printed.length === 1, null, { timeout: 8000 }); return p.evaluate(() => window.__printed[0]); };
    // classic
    await t.open(p, "classic", "labels", "labels", "#lb-drug");
    const classic = [];
    for (const x of INPUTS) {
      await p.click(".lb .btn:has-text('Clear Form')");
      await p.selectOption("#lb-tpl", x.tpl); await p.selectOption("#lb-lang", x.mt ? "both" : "en");
      if (await p.isChecked("#lb-inc-patient") !== !!x.patient) await p.click("#lb-inc-patient");
      if (x.patient) await p.fill("#lb-patient", x.patient);
      await p.fill("#lb-drug", x.drug); await p.keyboard.press("Escape");
      await p.fill("#lb-dose", x.dose); await p.selectOption("#lb-route", x.route); await p.selectOption("#lb-freq", x.freq); await p.fill("#lb-custom", x.note);
      await setChips("#lb-warn-list .warn-tag", "data-wid", x.w, (e) => e.classList.contains("on"));
      classic.push(await printed(() => p.click(".lb .btn.pri:has-text('Print Label')")));
      await p.waitForTimeout(400);
    }
    for (let i = 0; i < 40 && ((await t.api("GET", "/labels/state")).state.labelHistory || []).length < 3; i++) await p.waitForTimeout(150);
    const afterClassic = (await t.api("GET", "/labels/state")).state.labelHistory;
    // new
    await t.open(p, "2", "labels", "lblreg", "#lbl-add");
    const fresh = [];
    for (const x of INPUTS) {
      await p.click("[data-act=clear]");
      await p.selectOption("[name=templateId]", x.tpl); await p.click(`[data-act=lang][data-v=${x.mt ? "both" : "en"}]`);
      if (await p.isChecked("[name=inc]") !== !!x.patient) await p.click("[name=inc]");
      if (x.patient) await p.fill("[name=patientName]", x.patient);
      await p.fill("[name=drugName]", x.drug); await p.waitForTimeout(100);
      await p.fill("[name=dose]", x.dose); await p.selectOption("[name=route]", x.route); await p.selectOption("[name=frequency]", x.freq); await p.fill("[name=customInstructions]", x.note);
      await setChips(".lbl-chips [data-act=warn]", "data-w", x.w, (e) => e.getAttribute("aria-pressed") === "true");
      fresh.push(await printed(() => p.click("#lbl-add button[type=submit]")));
      await p.waitForFunction(() => /saved to recent labels/.test((document.querySelector("#lbl-status") || {}).textContent || ""), null, { timeout: 8000 });
    }
    INPUTS.forEach((x, i) => t.ok(fresh[i] === classic[i], `labels "${x.name}": print page identical to the classic (${classic[i].length} vs ${fresh[i].length} chars)`));
    const hist = (await t.api("GET", "/labels/state")).state.labelHistory;
    const nw = hist.filter((e) => !afterClassic.some((c) => c.id === e.id));
    t.ok(afterClassic.length === 3 && nw.length === 3, `3 classic + 3 new history entries (${afterClassic.length} + ${nw.length})`);
    for (const x of INPUTS) {
      const c = afterClassic.find((e) => e.drugName === x.drug), n = nw.find((e) => e.drugName === x.drug);
      t.same(`labels "${x.name}"`, c, n, { printedAt: "the moment of printing" });
    }
  },
};
