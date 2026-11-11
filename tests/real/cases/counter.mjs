// Counter tools (Services): shortcuts kept in this browser only, per pharmacy (keys end in :<location_id>), and nothing
// they do reaches the server.
// OTC: symptoms as chips, an opened symptom comes back under "Opened recently", a star under "Starred"; only the
// classic's static files are read. OCP: a looked-up pill comes back as a chip; Escape clears, then clears the filters.
// Calculators: the last values come back after a reload (never the patient), and a plan saved from them is stored
// exactly like the same plan typed in (same calc_data_json, same fields).
export default {
  title: "Counter: OTC, OCP and calculator shortcuts",
  async run(t) {
    const p = await t.page();
    const writes = []; p.on("request", (r) => { const u = new URL(r.url()); if (r.method() !== "GET" && !/pharmacy-calc\/records|client-log/.test(u.pathname)) writes.push(r.method() + " " + u.pathname); });
    const loc = (await t.api("GET", "/auth/me")).user?.location_id;
    // OTC
    await t.open(p, "2", "otcmindmap", "otcreg", ".otc-groups .otc-chip");
    t.ok(await p.locator(".otc-groups .otc-chip").count() === 76, "OTC: 76 symptoms with products, as chips");
    t.ok(await p.evaluate(() => document.activeElement && document.activeElement.id === "otc-q"), "OTC: the search is ready to type in (desktop)");
    await p.click('.otc-groups [data-open="symptom:S002"]'); await p.waitForSelector("#otc-title");
    t.ok((await p.textContent("#otc-title")) === "Acid reflux", "OTC: symptom shown in sentence case");
    await p.click("[data-act=star]");
    t.ok(await p.getAttribute("[data-act=star]", "aria-pressed") === "true", "OTC: Star pressed");
    await p.reload(); await p.waitForSelector(".otc-groups .otc-chip");
    const side = await p.evaluate(() => document.querySelector(".otc-side").innerText);
    t.ok(/Starred/.test(side) && /Acid reflux/.test(side), "OTC: after a reload the symptom is under Starred");
    // OCP
    await t.open(p, "2", "ocps", "ocpreg", ".ocp-row");
    t.ok(/2 others the same/.test(await p.textContent('.ocp-row[data-trade="Yasminelle"]')), "OCP: a row says how many others are the same (Yasminelle: 2)");
    await p.click('.ocp-row[data-trade="Yasmin"]');
    t.ok(await p.locator('#ocp-rec [data-recent="Yasmin"]').count() === 1, "OCP: Yasmin comes back under Looked up recently");
    await p.focus("#ocp-q"); await p.keyboard.press("Escape");
    t.ok(await p.locator(".ocp-like").count() === 0 && await p.inputValue("#ocp-e") === "", "OCP: Escape clears the filters");
    await t.open(p, "2", "ocps", "ocpreg", ".ocp-row");
    t.ok(await p.locator('#ocp-rec [data-recent="Yasmin"]').count() === 1, "OCP: still there after a reload");
    // OCP print: the new screen's printout is the classic finder's, byte for byte, for the same selection
    const pp = await t.page();
    await pp.addInitScript(() => {
      window.__blobOf = {}; const mk = URL.createObjectURL; URL.createObjectURL = function (b) { const u = mk.call(URL, b); window.__blobOf[u] = b; return u; }; // the printed page is read from its Blob (fetch() of blob: is connect-src; the app only opens it)
      window.__printed = []; Date.prototype.toLocaleString = function () { return "9/11/2026, 10:00:00"; }; // one clock for both
      const o = window.open;
      window.open = function (u, ...a) {
        if (/^blob:/.test(String(u))) { (window.__blobOf && window.__blobOf[u] ? window.__blobOf[u].text() : fetch(u).then((r) => r.text())).then((x) => window.__printed.push(x)); return { closed: false, document: {}, print() {}, close() {} }; }
        if (u === "" || u == null) { let buf = ""; return { closed: false, location: {}, print() {}, close() {}, addEventListener() {}, document: { open() {}, write(h) { buf += h; }, close() { window.__printed.push(buf); }, readyState: "loading", querySelectorAll: () => [] } }; }
        return o.call(window, u, ...a);
      };
    });
    const grab = async (click) => { await pp.evaluate(() => { window.__printed = []; }); await click(); await pp.waitForFunction(() => window.__printed.length === 1, null, { timeout: 8000 }); return pp.evaluate(() => window.__printed[0]); };
    const SEL = [
      { name: "EE 20 mcg + drospirenone 3 mg", e: "Ethinylestradiol", ed: "20", eu: "mcg", p: "Drospirenone", pd: "3" },
      { name: "desogestrel, any dose", e: "", ed: "", eu: "mg", p: "Desogestrel", pd: "" }];
    const classicP = [], newP = [];
    await t.open(pp, "classic", "ocps", "ocps", ".ocp-wrap");
    for (const x of SEL) {
      await pp.click(".ocp-actions .eikon-btn:has-text('Reset')");
      if (x.e) await pp.selectOption(".ocp-hormone-block.estrogen select", x.e);
      if (x.ed) { await pp.fill(".ocp-hormone-block.estrogen input", x.ed); await pp.click(`.ocp-hormone-block.estrogen .ocp-unit-btn:text-is("${x.eu}")`); }
      if (x.p) await pp.selectOption(".ocp-hormone-block.progestogen select", x.p);
      if (x.pd) await pp.fill(".ocp-hormone-block.progestogen input", x.pd);
      await pp.click(".ocp-actions .eikon-btn:has-text('Search')");
      await pp.waitForSelector(".ocp-print-btn");
      classicP.push(await grab(() => pp.click(".ocp-print-btn"))); await pp.waitForTimeout(950); // the classic ignores a second press within 0.9 s
    }
    await t.open(pp, "2", "ocps", "ocpreg", ".ocp-row");
    for (const x of SEL) {
      await pp.selectOption("#ocp-e", x.e); await pp.fill("#ocp-ed", x.ed); await pp.click(`[data-unit=e][data-u=${x.eu}]`);
      await pp.selectOption("#ocp-p", x.p); await pp.fill("#ocp-pd", x.pd);
      newP.push(await grab(() => pp.click("[data-act=print]")));
    }
    SEL.forEach((x, i) => t.ok(classicP[i] && classicP[i] === newP[i], `OCP print "${x.name}": the new screen's page is the classic's, byte for byte (${(classicP[i] || "").length} vs ${(newP[i] || "").length} chars)`));
    t.ok(/Freedonel/.test(newP[0]) && /Yaz/.test(newP[0]) && !/Adele/.test(newP[0]), "OCP print lists the matching pills only");
    // keys: this pharmacy only, nothing about a patient
    const keys = await p.evaluate(() => Object.keys(localStorage).filter((k) => /eikon_picks_v1|eikon_calreg_v|eikon_lblreg_/.test(k)));
    t.ok(keys.length >= 2 && keys.every((k) => k.endsWith(":" + loc)), `shortcut keys end in :<location_id> (${keys.join(", ")})`);
    // Calculators: a plan typed in, then the same plan from the remembered values
    await t.open(p, "2", "pharmacycalc", "calreg", "#cal-form");
    if (!(await p.locator('[data-calc="mtx"].on').count())) await p.click('[data-calc="mtx"]');
    await p.waitForSelector('[name="mtx.weekly"], [name^="mtx."]');
    const field = (await p.locator('#cal-form [name^="mtx."]').first().getAttribute("name"));
    const plan = { name: "Counter Ċensina", id: "0123456M" };
    await t.fill(p, "#cal-form", { '#cal-form [name="pat.name"]': plan.name, '#cal-form [name="pat.id"]': plan.id });
    const wk = await p.locator('#cal-form [name="mtx.weeks"]').count() ? "mtx.weeks" : field;
    await t.fill(p, "#cal-form", { [`#cal-form [name="${wk}"]`]: "6" });
    await p.waitForTimeout(400);
    const a = await t.write(p, /\/pharmacy-calc\/records$/, () => p.click('button[type=submit][form=cal-form]'));
    const stored = JSON.stringify(await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("eikon_calreg_v")) return localStorage.getItem(k); return ""; }));
    t.ok(stored.length > 10 && !/Ċensina|0123456M/.test(stored), "the remembered values hold no patient name or ID card");
    await p.reload(); await p.waitForFunction(() => window.EIKON && EIKON.state.activeModuleId === "calreg" && document.querySelector("#cal-form"), null, { timeout: 20000 }); await t.idle(p);
    t.ok(await p.inputValue(`#cal-form [name="${wk}"]`) === "6", "after a reload the calculator opens with the value used last (6)");
    t.ok(await p.locator(".cal-rest").count() === 1, "and says so, with Start again");
    t.ok(await p.inputValue('#cal-form [name="pat.name"]') === "", "the patient is never brought back");
    await t.fill(p, "#cal-form", { '#cal-form [name="pat.name"]': plan.name + " B", '#cal-form [name="pat.id"]': "0123457M" });
    await p.waitForTimeout(400);
    const b = await t.write(p, /\/pharmacy-calc\/records$/, () => p.click('button[type=submit][form=cal-form]'));
    t.ok(a.body && b.body && JSON.stringify(Object.keys(a.body)) === JSON.stringify(Object.keys(b.body)), "the same fields are sent");
    t.ok(a.body && b.body && a.body.calc_data_json === b.body.calc_data_json && a.body.calc_type === b.body.calc_type && a.body.start_date === b.body.start_date, "the plan saved from the remembered values is stored exactly like the one typed in");
    t.ok(writes.length === 0, `no other writes (${writes.join(", ")})`);
  },
};
