// Stock & Customers round 2, merge check (Director): the customer record's ⋯ "Export or erase…" (customers) opens the
// privacy window (gdpr, ui/eikon.privacy.js) for that same person, for an admin. Nothing is written: the window is closed
// with Escape and focus comes back to the ⋯ button.
export default {
  title: "Customers ⋯ Export or erase… opens the privacy window for that person (merge of customers + gdpr)",
  async run(t) {
    const tag = String(Date.now() % 100000).padStart(5, "0"), name = "Rita Bonnici " + tag, card = tag + "2M";
    const pid = (await t.api("POST", "/people", { name, id_card: card, phone: "798" + tag })).person.id;
    const p = await t.page();
    const writes = []; p.on("request", (r) => { if (r.method() !== "GET" && /\/(erase|export)$/.test(new URL(r.url()).pathname)) writes.push(r.method() + " " + r.url()); });
    await t.open(p, "2", "customers", "customers", "#cus-q");
    if (await p.locator(".cus-back").isVisible().catch(() => false)) await p.click(".cus-back");
    await p.fill("#cus-q", card); await p.waitForSelector(`[data-person="${pid}"]`); await p.click(`[data-person="${pid}"]`);
    await p.waitForSelector('[data-act="more"]', { timeout: 10000 });
    t.ok(await p.evaluate(() => !!(window.EIKON.privacy && window.EIKON.privacy.open)), "E.privacy is loaded in the merged build");
    await p.click('[data-act="more"]');
    await p.waitForSelector('[data-act="privacy"]');
    t.ok((await p.innerText('[data-act="privacy"]')).trim() === "Export or erase…", "the ⋯ item reads Export or erase…");
    await p.click('[data-act="privacy"]');
    await p.waitForSelector(".prv [data-act=download]", { timeout: 15000 });
    const hold = await p.innerText(".prv");
    t.ok(hold.indexOf(name) >= 0, "the privacy window is about this person: " + hold.replace(/\n+/g, " | ").slice(0, 160));
    await p.keyboard.press("Escape");
    await p.waitForFunction(() => !document.querySelector(".prv [data-act=download]"), null, { timeout: 5000 });
    t.ok(await p.evaluate(() => { const a = document.activeElement; return !!a && a.getAttribute("data-act") === "more"; }), "Escape closes it and focus returns to ⋯");
    t.ok(writes.length === 0, "nothing exported or erased: " + writes.join(" | "));
  },
};
