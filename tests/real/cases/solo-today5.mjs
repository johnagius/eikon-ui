// q5-5 (BACKLOG5 item 5): Today's Open lands on the exact order / question / delivery, and the row it lands on writes
// exactly what the list writes. Today itself still reads only GET /today.
// A "solo-" case: it runs alone after every other case (it reads Today, which lists every waiting order of the stack).
import { ymd } from "../lib.mjs";
const NOW = Date.now().toString(36).slice(-4);
const order = (name, phone) => ({ order_date: ymd(0), client_name: name, contact: phone, client_phone: phone, items: "Ensure vanilla x24", items_text: "Ensure vanilla x24", needed_by: ymd(-1), pick_up_date: ymd(-1), pickup_date: ymd(-1), deposit: "", deposit_amount: "", priority: 1, notes: "q55" });
const ticket = (name, n) => ({ ticket_id: "TKT-9" + n + NOW.replace(/\D/g, "0").slice(0, 3), open_date: ymd(-1), client_name: name, phone: "79550000", email: "", issue: "Asked if Clexane in stock", category: "Stock Check", priority: 1, status: "Open", assigned_to: "", followup_date: ymd(-1), notes_log: "[]" });
export default {
  title: "Today opens the exact record",
  async run(t) {
    const O = "client_orders_entries", Q = "client_tickets_entries", D = "client_deliveries";
    const a = await t.api("POST", "/client-orders/entries", order("Ellul Paul Q" + NOW, "79551111"));
    const b = await t.api("POST", "/client-orders/entries", order("Ellul Pawlu Q" + NOW, "79551111"));
    const qa = await t.api("POST", "/client-tickets/entries", ticket("Abela Rita Q" + NOW, 1));
    const qb = await t.api("POST", "/client-tickets/entries", ticket("Abela Rina Q" + NOW, 2));
    const dl = await t.api("POST", "/client-deliveries/entries", { delivery_id: "DEL-9" + NOW.replace(/\D/g, "0").slice(0, 4), order_date: ymd(-1), scheduled_date: ymd(-1), scheduled_time_slot: "Morning", client_name: "Zammit Ġorġ Q" + NOW, phone: "79552222", email: "", delivery_address: "1, Triq il-Kbira, Żebbuġ", address_notes: "", delivery_method: "In-house Driver", priority: 1, status: "Scheduled", signature_required: 0, signature_obtained: 0, delivery_attempts: 0, contains_controlled: 0, cold_chain_required: 0, items: "[]", delivery_log: "[]", internal_notes: "" });
    const ids = { a: a && (a.id || a.entry_id), b: b && (b.id || b.entry_id), qa: qa && (qa.id || qa.entry_id), qb: qb && (qb.id || qb.entry_id), dl: dl && (dl.id || dl.entry_id) };
    if (!t.ok(Object.values(ids).every(Boolean), "seed: " + JSON.stringify(ids))) return;

    const p = await t.page({ phone: true });
    const api = []; p.on("request", (r) => { const u = new URL(r.url()); if ((r.resourceType() === "fetch" || r.resourceType() === "xhr") && !u.pathname.startsWith("/ui/")) api.push(r.method() + " " + u.pathname); });
    const today = async () => { await t.open(p, "2", "today", "today", ".tdy-head h1"); };
    await today();
    // as before q5-5: GET /today, plus the month of a reading outside its limits when there is one (its note, modules.today.js loadNotes)
    const reads = api.filter((x) => x !== "GET /auth/me" && x !== "GET /temperature/entries");
    t.ok(reads.join() === "GET /today", "Today reads only GET /today: " + api.join());
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    t.note("Today phone height " + h);
    // the order, if not among the five shown, is on Orders through "and N more"; here it is urgent and overdue: shown
    const shown = async (id, to) => p.locator(`[data-hand="${to}"][data-hand-id="${id}"]`).count();
    // Open from Today; when other cases' urgent rows fill the five, the same hand-over note is written as Today writes it
    const go = async (id, to, hash, name) => {
      if (await shown(id, to)) return p.click(`[data-hand="${to}"][data-hand-id="${id}"]`);
      t.note(to + " " + id + " not among the five on Today (other cases' urgent rows): handed over as Today does");
      await p.evaluate(([to, id, hash, name]) => { window.EIKON.customerHandoff(to, "open", { name }, "", id); location.hash = hash; }, [to, id, hash, name]);
    };
    t.ok(await shown(ids.a, "ordreg"), "Ellul Paul's order is among the five on Today");

    // Open → Orders on that row, focus on Ready; Enter there
    await p.click(`[data-hand="ordreg"][data-hand-id="${ids.a}"]`);
    await p.waitForFunction((id) => window.EIKON.state.activeModuleId === "ordreg" && document.activeElement && document.activeElement.matches(`[data-act=ready][data-id="${id}"]`), ids.a, { timeout: 15000 });
    t.ok(await p.evaluate(() => document.activeElement.closest(".ord-row").classList.contains("q55-hit")), "the landed order row is marked");
    await t.write(p, new RegExp("/client-orders/entries/" + ids.a + "$"), () => p.keyboard.press("Enter"), "PUT");
    // the twin, Ready from the list as before
    await t.open(p, "2", "clientorders", "ordreg", `[data-act=ready][data-id="${ids.b}"]`);
    await t.write(p, new RegExp("/client-orders/entries/" + ids.b + "$"), () => p.click(`[data-act=ready][data-id="${ids.b}"]`), "PUT");
    await p.waitForTimeout(300);
    t.same("ready (landed vs list)", t.row(O, ids.b), t.row(O, ids.a), { client_name: "two customers", fulfilled_at: "the moment each was made ready" });
    t.has("ready (landed)", t.row(O, ids.a), { fulfilled: 1 });

    // Reply → Questions on that card, focus on Resolved; Enter there; the twin resolved from the list
    await today();
    {
      await go(ids.qa, "tktreg", "#tickets", "Abela Rita Q" + NOW);
      await p.waitForFunction((id) => window.EIKON.state.activeModuleId === "tktreg" && document.activeElement && document.activeElement.matches(`[data-act=resolve][data-id="${id}"]`), ids.qa, { timeout: 15000 });
      await t.write(p, new RegExp("/client-tickets/entries/" + ids.qa + "$"), () => p.keyboard.press("Enter"), "PUT");
      await t.open(p, "2", "tickets", "tktreg", `[data-act=resolve][data-id="${ids.qb}"]`);
      await t.write(p, new RegExp("/client-tickets/entries/" + ids.qb + "$"), () => p.click(`[data-act=resolve][data-id="${ids.qb}"]`), "PUT");
      await p.waitForTimeout(300);
      t.same("resolved (landed vs list)", t.row(Q, ids.qb), t.row(Q, ids.qa), { client_name: "two customers", ticket_id: "two numbers", resolved_at: "the moment each was resolved" });
    }

    // Open on the delivery → Deliveries on that card, focus on Delivered; nothing written by landing
    await today();
    const before = JSON.stringify(t.row(D, ids.dl));
    {
      api.length = 0;
      await go(ids.dl, "dlvreg", "#deliveries", "Zammit Ġorġ Q" + NOW);
      await p.waitForFunction((id) => window.EIKON.state.activeModuleId === "dlvreg" && document.activeElement && document.activeElement.matches(`[data-act=done][data-id="${id}"]`), ids.dl, { timeout: 15000 });
      await t.idle(p);
      t.ok(!api.some((x) => !x.startsWith("GET ")), "landing writes nothing: " + api.join());
      t.ok(JSON.stringify(t.row(D, ids.dl)) === before, "the delivery row is untouched by landing");
    }
  },
};
