// People suggestions (ui/eikon.personpick.js) with ċ ġ ħ ż on the real worker: the server's LOWER()/LIKE know only
// A to Z, so the name is sent as its longest stretch without them and every word is checked in the browser.
// "ġużeppa" and "Ġużeppa" typed in a register form (Orders, new layout) both offer "Abela Ġużeppa". Reads only.
const P = { name: "Abela Ġużeppa", id_card: "0771234M", phone: "79771234" };
export default {
  title: "People suggestions with Maltese letters",
  async run(t) {
    const r = await t.api("POST", "/people", P);
    t.ok(r && r.ok, "person accepted by POST /people");
    const p = await t.page();
    await t.open(p, "2", "clientorders", "ordreg", "[data-act=add]");
    await p.click("[data-act=add]"); await p.waitForSelector("#ord-add");
    const box = p.locator("#ord-add [name=client_name]");
    for (const typed of ["ġużeppa", "Ġużeppa", "abela ġuż", "ĠUŻEPPA"]) {
      await box.fill(""); await box.pressSequentially(typed, { delay: 15 });
      await p.waitForFunction((n) => [...document.querySelectorAll("#ord-add .epp-opt b")].some((b) => b.textContent === n), P.name, { timeout: 6000 }).catch(() => {});
      const got = await p.evaluate(() => [...document.querySelectorAll("#ord-add .epp-opt b")].map((b) => b.textContent));
      t.ok(got.includes(P.name), `"${typed}" in the Orders name field offers ${P.name} (offered: ${JSON.stringify(got)})`);
    }
    // the right one is kept: "ġużeppa" does not offer someone without "ġużeppa" in the name
    await box.fill(""); await box.pressSequentially("ġużeppax", { delay: 15 }); await p.waitForTimeout(700);
    const none = await p.evaluate(() => [...document.querySelectorAll("#ord-add .epp-opt b")].map((b) => b.textContent));
    t.ok(!none.includes(P.name), `"ġużeppax" does not offer ${P.name}: ${JSON.stringify(none)}`);
  },
};
