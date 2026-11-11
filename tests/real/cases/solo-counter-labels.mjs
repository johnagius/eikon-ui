// Counter tools (Services): Dispensing labels' one-tap "Print again" and "Usual labels".
// Print again on a recent label prints the same page and saves the same history entry as "Use again" then "Print
// label" (only the entry's id and print time differ); starring a usual label sends nothing to the server, and the
// chip fills the form; on a phone Print label is on screen without scrolling.
const CAPTURE = `(() => { window.__printed = []; window.__blobOf = {}; const mk = URL.createObjectURL; URL.createObjectURL = function (b) { const u = mk.call(URL, b); window.__blobOf[u] = b; return u; }; const o = window.open; window.open = function (u, ...a) { if (window.__capture && /^blob:/.test(String(u))) { (window.__blobOf && window.__blobOf[u] ? window.__blobOf[u].text() : fetch(u).then((r) => r.text())).then((t) => window.__printed.push(t)); return {}; } return o.call(window, u, ...a); }; })();`;
const TPL = [
  { id: "tpl_std", name: "Standard Label", size: "standard", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: true },
  { id: "tpl_large", name: "Large Print (Elderly)", size: "large", fields: ["patientName", "drugName", "dose", "frequency", "route", "warnings", "pharmacyDetails", "date"], isDefault: false },
  { id: "tpl_mt", name: "Maltese", size: "standard", language: "mt", fields: [], isDefault: false }];
const PH = { name: "Demo Pharmacy", address: "1 Triq il-Kbira, Mosta", phone: "21234567", licence: "PH-042" };
const SEED = { id: "lb_counter_seed_1", patientName: "Hili Ġorġ", drugName: "Counterxin 250mg", dose: "1 tablet", frequency: "Twice daily", route: "Oral", customInstructions: "After meals", selectedWarnings: ["w01", "w08"], templateId: "tpl_large", printedAt: "2026-11-01 10:00", printedBy: "Maria Borg" };
export default {
  title: "Counter: labels print again and usual labels",
  async run(t) {
    const r0 = await t.api("PUT", "/labels/state", { state: { labelHistory: [SEED], templates: TPL, pharmacyDetails: PH } });
    t.ok(r0 && r0.ok !== false, "seed label saved");
    const p = await t.page();
    await p.addInitScript(CAPTURE);
    const printed = async (click) => { await p.evaluate(() => { window.__capture = true; window.__printed = []; }); await click(); await p.waitForFunction(() => window.__printed.length === 1, null, { timeout: 8000 }); return p.evaluate(() => window.__printed[0]); };
    const ours = async () => ((await t.api("GET", "/labels/state")).state.labelHistory || []).filter((e) => e.drugName === SEED.drugName);
    await t.open(p, "2", "labels", "lblreg", "#lbl-add");
    t.ok(await p.locator("#lbl-find").count() === 1, "the search for a recent label is on the screen");
    await p.fill("#lbl-find", "hili ġorġ"); // Maltese letters typed or not, the label is found
    await p.waitForSelector("#lbl-recent [data-act=reprint]");
    t.ok(await p.locator("#lbl-recent .lbl-row").count() === 1, "search 'hili ġorġ' finds the one label");
    await p.fill("#lbl-find", "hili");
    t.ok(await p.locator("#lbl-recent .lbl-row").count() === 1, "search 'hili' (no Maltese letters) finds it too");
    const a = await printed(() => p.click("#lbl-recent [data-act=reprint]"));
    for (let i = 0; i < 40 && (await ours()).length < 2; i++) await p.waitForTimeout(150);
    const after1 = await ours();
    t.ok(after1.length === 2, `Print again saved one new history entry (${after1.length - 1})`);
    const n1 = after1.find((e) => e.id !== SEED.id);
    // the same label through Use again + Print label
    await p.waitForSelector("#lbl-find"); await p.fill("#lbl-find", "counterxin");
    await p.waitForSelector("#lbl-recent [data-act=again]");
    await p.click("#lbl-recent [data-act=again] >> nth=-1");
    const b = await printed(() => p.click("#lbl-add button[type=submit]"));
    for (let i = 0; i < 40 && (await ours()).length < 3; i++) await p.waitForTimeout(150);
    const after2 = await ours();
    const n2 = after2.find((e) => e.id !== SEED.id && e.id !== (n1 || {}).id);
    t.ok(!!n1 && !!n2, "both new entries saved");
    t.ok(a === b, `Print again prints the same page as Use again + Print label (${a.length} vs ${b.length} chars)`);
    t.ok(/Hili Ġorġ/.test(a) && /Counterxin 250mg/.test(a) && /Avoid alcohol/.test(a), "the printed label has the patient, medicine and warnings");
    if (n1 && n2) t.same("Print again entry vs Use again + Print label", n2, n1, { printedAt: "the moment of printing" });
    // Usual labels: kept in the browser only
    let puts = 0; p.on("request", (r) => { if (r.method() !== "GET" && /\/labels\//.test(r.url())) puts++; });
    await p.click("[data-act=clear]");
    await p.fill("[name=drugName]", "Usualin 5mg"); await p.fill("[name=dose]", "2 drops"); await p.selectOption("[name=route]", "Ophthalmic");
    await p.click("[data-act=star]");
    t.ok(await p.getAttribute("[data-act=star]", "aria-pressed") === "true", "the star shows the label is a usual label");
    await p.waitForTimeout(300);
    t.ok(puts === 0, `starring sends nothing to the server (${puts} writes)`);
    await t.open(p, "2", "labels", "lblreg", "#lbl-add");
    t.ok(await p.locator("[data-act=usual]").count() === 1, "the usual label is on the screen after a reload");
    await p.click("[data-act=usual]");
    t.ok(await p.inputValue("[name=drugName]") === "Usualin 5mg" && await p.inputValue("[name=dose]") === "2 drops" && await p.inputValue("[name=route]") === "Ophthalmic", "one tap fills the medicine, dose and route");
    await p.click("[data-act=unusual]");
    t.ok(await p.locator("[data-act=usual]").count() === 0, "× takes it off the usual labels");
    // Phone: the primary action is in reach
    const ph = await t.page({ phone: true });
    await t.open(ph, "2", "labels", "lblreg", "#lbl-add");
    const box = await ph.locator("#lbl-add button[type=submit]").boundingBox();
    // tidy: this case's labels out of the history (the explicit correction the server honours)
    const mine = (await ours()).map((e) => e.id);
    await t.api("PUT", "/labels/state", { state: { labelHistory: [], templates: TPL, pharmacyDetails: PH, deleted_ids: mine } });
    t.ok(box && box.y + box.height <= 844 && box.height >= 44, `phone: Print label on screen without scrolling (${box && Math.round(box.y)}px, ${box && Math.round(box.height)}px tall)`);
  },
};
