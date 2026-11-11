// Help matches the screen (BACKLOG5 item 9), on the real worker: every new-layout screen is opened as the pharmacist,
// with whatever the other cases have stored, and its footer's "… is in the classic screen" sentences must be the
// guide's "Still in the classic screen" paragraph word for word; that paragraph must not name a button the screen has.
// Read only: nothing is written.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadGuides, newScreens, compare, readScreenInPage, staticCheck } from "../../helpmatch.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "ui");

export default {
  title: "Help matches the screen",
  async run(t) {
    const stat = staticCheck(root);
    t.ok(!stat.length, "help words: " + stat.slice(0, 4).join(" | "));
    const G = loadGuides(root), p = await t.page();
    await t.open(p, "2", "today", "today");
    let footers = 0;
    const portalOnly = /^(sup(home|orders|problems|products)|hq(home|regs|client)|ptlacct)$/; // portals (FIN): checked as their own users in portals.mjs
    for (const { id } of newScreens(root).filter((x) => !portalOnly.test(x.id))) {
      await p.evaluate((h) => { window.location.hash = "#" + h; }, id);
      try { await p.waitForFunction((m) => window.EIKON.state.activeModuleId === m && document.querySelector("#eikon-content button"), id, { timeout: 15000 }); }
      catch (e) { t.fail(id + ": did not open"); continue; }
      await t.idle(p);
      const r = await p.evaluate(readScreenInPage);
      if (r.footer.length) footers++;
      const probs = compare(id, G[id], r.footer, r.labels);
      t.ok(!probs.length, probs.join(" | "));
    }
    t.ok(footers >= 25, "only " + footers + " screens showed a classic footer");
  },
};
