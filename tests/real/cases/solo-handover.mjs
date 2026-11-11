// Team › Handover and Chat board, "what I need to know" pass (handover builder). Runs alone ("solo-"): it writes today's
// handover, which the team case also writes.
//  - Handover: Got it marks what the last shift left as read for this person (POST /instructions/daily/seen, once;
//    kept in the browser too); the pharmacist sees who else read it, staff only themselves;
//    Remove then Undo puts the very same point back where it was (the stored day is byte-identical to before).
//  - Chat board: a pharmacy picked after @ is stored as the classic body would be and really reaches that pharmacy
//    (a mention row); Mentions you shows it there and, once shown, it is marked read with the server's own call; a group-only message
//    naming another group's pharmacy reaches nobody there and is not shown there; New marks what came since last time.
import { maltaYmd } from "../../clock.mjs";

export default {
  title: "Handover and Chat board: read, acknowledge, mentions",
  async run(t) {
    const app = t.stack.app, db = t.db;
    // ---------- Handover: Got it ----------
    const y = maltaYmd(-1), today = maltaYmd(0);
    await t.api("PUT", "/instructions/daily", { ymd: y, notes: "", handover_out: [{ id: "b_9_1", sev: "g", text: "Window display changed", created_at: "2026-11-01T08:00:00.000Z" }, { id: "b_9_2", sev: "r", text: "Insulin for Mrs Borg in the fridge", created_at: "2026-11-01T08:00:00.000Z" }] });
    await t.api("PUT", "/instructions/daily", { ymd: today, notes: "Ħal Qormi run at 11", handover_out: [{ id: "b_9_3", sev: "y", text: "Order paracetamol syrup", created_at: "2026-11-01T08:00:00.000Z" }] });
    const p = await t.page();
    const writes = []; p.on("request", (r) => { if (r.method() !== "GET" && /\/instructions\//.test(r.url())) writes.push(r.method() + " " + new URL(r.url()).pathname); });
    await t.open(p, "2", "hndreg", "hndreg", "#hnd-ack");
    const h0 = await p.evaluate(() => ({ first: document.querySelector(".hnd-list .hnd-pt").textContent, ack: document.querySelector("#hnd-ack").textContent, isNew: document.querySelector(".hnd-list").classList.contains("new") }));
    t.ok(/^CriticalInsulin/.test(h0.first) && /2 to readGot it/.test(h0.ack) && h0.isNew, "what the last shift left: critical first, one Got it for all of it: " + JSON.stringify(h0));
    await p.click('[data-act="ack"]');
    const h1 = await p.evaluate(() => ({ ack: document.querySelector("#hnd-ack").textContent, focus: document.activeElement && document.activeElement.id, isNew: document.querySelector(".hnd-list").classList.contains("new"), key: Object.keys(localStorage).filter((k) => /^eikon_hnd_read_/.test(k)).map((k) => localStorage.getItem(k)) }));
    t.ok(/^✓ You read these at \d\d:\d\d$/.test(h1.ack) && h1.focus === "hnd-ack" && !h1.isNew && h1.key.length === 1 && JSON.parse(h1.key[0]).from === y && JSON.parse(h1.key[0]).ids === "b_9_1,b_9_2", "Got it: says when, focus stays there, kept per person: " + JSON.stringify(h1));
    await p.waitForTimeout(400);
    t.ok(writes.length === 1 && writes[0] === "POST /instructions/daily/seen", "Got it: one POST /instructions/daily/seen, nothing else written: " + writes.join());
    const seenRows = db.prepare("SELECT * FROM handover_seen WHERE ymd = ?").all(y);
    t.ok(seenRows.length === 1 && seenRows[0].user_name === "Maria Borg" && Number(seenRows[0].location_id) === 1, "one row for this person and day: " + JSON.stringify(seenRows));
    await p.click('[data-act="ack"]').catch(() => {}); // no button any more: pressing again is not possible
    t.ok(await p.evaluate((from) => !!(window.EIKON.handoverRead && window.EIKON.handoverRead(from, "b_9_1,b_9_2")), y), "E.handoverRead answers for the Team page");
    // Staff press Got it on their own till; the pharmacist then sees who read it, staff do not see others
    const st = await app.addUser({ orgId: 1, locationId: 1, email: "karl.hnd@demo.mt", password: "Demo-Pass-2026", name: "Karl Vella", role: "staff" });
    const ps = await t.page(); await ps.context().addInitScript((k) => { try { localStorage.setItem("eikon_token", k); } catch (e) {} }, st.token);
    await t.open(ps, "2", "hndreg", "hndreg", "#hnd-ack");
    t.ok(await ps.evaluate(() => !!document.querySelector('[data-act="ack"]') && !/Read by/.test(document.querySelector("#hnd-ack").textContent)), "staff: still to read for them, and no names of others");
    await t.write(ps, /\/instructions\/daily\/seen$/, () => ps.click('[data-act="ack"]'));
    await t.open(p, "2", "team", "team"); await t.open(p, "2", "hndreg", "hndreg", "#hnd-ack");
    const by = await p.textContent("#hnd-ack");
    t.ok(/Read by Karl Vella \d\d:\d\d/.test(by) && /You read these at/.test(by), "the pharmacist sees who else read it: " + by);
    // ---------- Handover: Remove, then Undo ----------
    const dayRow = () => db.prepare("SELECT notes, handover_json FROM instructions_daily WHERE ymd = ?").get(today);
    const before = JSON.stringify(dayRow());
    await t.write(p, /\/instructions\/daily$/, () => p.click('[data-act="rm"][data-id="b_9_3"]'), "PUT");
    await p.waitForSelector('[data-act="undo"]');
    t.ok(!JSON.stringify(dayRow()).includes("paracetamol"), "Remove takes the point out of the stored day");
    const u0 = await p.evaluate(() => ({ row: document.querySelector(".hnd-undo").textContent, focus: document.activeElement && document.activeElement.getAttribute("data-act") }));
    t.ok(/Removed: Order paracetamol syrupUndo/.test(u0.row) && u0.focus === "undo", "after Remove: Removed … Undo in its place, focus on Undo: " + JSON.stringify(u0));
    await t.write(p, /\/instructions\/daily$/, () => p.click('[data-act="undo"]'), "PUT");
    await p.waitForTimeout(300);
    t.ok(JSON.stringify(dayRow()) === before, "Undo puts back the very same point: the stored day is as before: " + JSON.stringify(dayRow()).slice(0, 200));

    // ---------- Handover: Carry over (same body shape as Add point, read afresh; never twice) ----------
    const put2 = await t.write(p, /\/instructions\/daily$/, () => p.click('[data-act="carry"][data-id="b_9_2"]'), "PUT");
    const out2 = (put2.body || {}).handover_out || [], last = out2[out2.length - 1] || {};
    t.ok(put2.body && Object.keys(put2.body).sort().join() === "handover_out,notes,ymd" && put2.body.notes === "Ħal Qormi run at 11" && out2.length === 2 && out2[0].id === "b_9_3" &&
      last.sev === "r" && last.text === "Insulin for Mrs Borg in the fridge" && /^b_\d+_\d+$/.test(last.id) && Object.keys(last).sort().join() === "created_at,id,sev,text", "Carry over: the classic day body, the point added with its urgency: " + JSON.stringify(put2.body).slice(0, 260));
    await p.waitForTimeout(300);
    t.ok(await p.evaluate(() => !document.querySelector('[data-act="carry"][data-id="b_9_2"]') && /For tomorrow too/.test(document.querySelector(".hnd-list").innerText)), "a carried point says so and cannot be carried twice");
    // Pinned on the chat board by our group shows in the handover; another group's pin does not
    await t.api("POST", "/board/messages", { body: "Group pin: keys are in the safe", scope: "org" });
    const gp = t.db.prepare("SELECT id FROM board_messages WHERE body = 'Group pin: keys are in the safe'").get().id;
    await t.api("PUT", "/board/messages/" + gp + "/pin", {});

    // ---------- Chat board ----------
    db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (31, 1, 'Birkirkara')").run();
    db.prepare("INSERT OR IGNORE INTO orgs (id, name) VALUES (88, 'Sliema Group')").run(); db.prepare("INSERT OR IGNORE INTO locations (id, org_id, name) VALUES (188, 88, 'Sliema Pharmacy')").run();
    const bkr = await app.addUser({ orgId: 1, locationId: 31, email: "bkr.hnd@demo.mt", password: "Demo-Pass-2026", name: "Ġorġ Hili" });
    const oth = await app.addUser({ orgId: 88, locationId: 188, email: "sliema.hnd@demo.mt", password: "Demo-Pass-2026", name: "Sara Vella" });
    const bkrId = bkr.user.id || bkr.user.user_id, othId = oth.user.id || oth.user.user_id;
    const B = "board_messages";
    let b0 = t.maxId(B);
    await t.open(p, "2", "brdreg", "brdreg", "#brd-ta");
    await p.click("#brd-ta"); await p.keyboard.type("@Birk");
    await p.waitForSelector("#brd-ment [data-loc]", { timeout: 5000 });
    await p.keyboard.press("Enter"); await p.keyboard.type("have you got Clexane 40mg?");
    await t.write(p, /\/board\/messages$/, () => p.keyboard.press("Enter"));
    const fresh = (await t.mine(B, b0, { body: "@Birkirkara, have you got Clexane 40mg?" }))[0];
    t.ok(fresh && fresh.scope === "org", "the picked pharmacy is closed with a comma and stored without the invisible marker: " + JSON.stringify(fresh && fresh.body));
    const m1 = fresh && db.prepare("SELECT * FROM board_mentions WHERE message_id = ?").all(fresh.id);
    t.ok(m1 && m1.length === 1 && Number(m1[0].mentioned_user_id) === Number(bkrId), "the mention really reaches Birkirkara (one mention row): " + JSON.stringify(m1));
    b0 = t.maxId(B);
    await t.api("POST", "/board/messages", { body: "@Birkirkara, have you got Clexane 40mg?", scope: "org" }); // the classic body for the same text
    t.same("board message (mention)", t.since(B, b0)[0], t.row(B, fresh.id));
    // A group-only message naming another group's pharmacy: no mention there, and they never see it
    b0 = t.maxId(B);
    await t.api("POST", "/board/messages", { body: "Private: @Sliema Pharmacy, prices are up", scope: "org" });
    const priv = t.since(B, b0)[0];
    t.ok(!db.prepare("SELECT COUNT(*) c FROM board_mentions WHERE message_id = ? AND mentioned_user_id = ?").get(priv.id, othId).c, "a group-only mention of another group's pharmacy records nothing for them");

    // Birkirkara opens the board: Mentions you on top; shown = seen (the server's own call, once)
    const as = async (tok) => { const q = await t.page(); await q.context().addInitScript((k) => { try { localStorage.setItem("eikon_token", k); } catch (e) {} }, tok); return q; };
    const pb = await as(bkr.token);
    const reads = []; pb.on("request", (r) => { if (/\/board\/mentions\/read$/.test(r.url())) reads.push(r.method() + " " + r.postData()); });
    await t.open(pb, "2", "brdreg", "brdreg", ".brd-you");
    const y0 = await pb.evaluate(() => ({ you: document.querySelector(".brd-you").innerText.replace(/\s+/g, " "), first: document.querySelector(".brd-you h2").textContent }));
    t.ok(/Mentions you 2/.test(y0.first) && /Demo Pharmacy Maria Borg/.test(y0.you) && /Clexane 40mg/.test(y0.you), "Mentions you is at the top with both mentions: " + JSON.stringify(y0));
    t.ok(reads.length === 1 && reads[0] === "PUT {}", "shown = seen: one PUT /board/mentions/read: " + JSON.stringify(reads));
    t.ok(!db.prepare("SELECT COUNT(*) c FROM board_mentions WHERE mentioned_user_id = ? AND is_read = 0").get(bkrId).c, "the mentions are stored as read");
    await t.open(pb, "2", "team", "team"); await t.open(pb, "2", "brdreg", "brdreg", ".brd-bar");
    t.ok(await pb.evaluate(() => !document.querySelector(".brd-you")) && reads.length === 1, "next time the panel is gone and nothing more is sent");

    // Handover shows our group's pin (maria), not to the other group
    await t.open(p, "2", "hndreg", "hndreg", ".hnd-pins");
    t.ok(/keys are in the safe/.test(await p.textContent(".hnd-pins")), "our group's pinned message is in the handover");
    // The other group: no mentions panel, never the group's message
    const po = await as(oth.token);
    await t.open(po, "2", "brdreg", "brdreg", ".brd-bar");
    const o0 = await po.evaluate(() => ({ you: !!document.querySelector(".brd-you"), text: document.querySelector("#eikon-content").innerText }));
    t.ok(!o0.you && !/prices are up|Clexane 40mg/.test(o0.text), "another group sees no mention and none of the group's messages");
    await t.open(po, "2", "hndreg", "hndreg", ".hnd-lab");
    t.ok(await po.evaluate(() => !/keys are in the safe/.test(document.querySelector("#eikon-content").innerText)), "another group's handover never shows our group's pin");

    // New since last time: Birkirkara saw up to the newest; one more arrives; reopening marks only that one
    b0 = t.maxId(B);
    await t.api("POST", "/board/messages", { body: "Courier late today, after 4pm", scope: "org" });
    await t.open(pb, "2", "team", "team"); await t.open(pb, "2", "brdreg", "brdreg", ".brd-bar");
    const n0 = await pb.evaluate(() => ({ top: [...document.querySelectorAll(".brd-m")].slice(0, 2).map((x) => x.getAttribute("data-id")), n: [...document.querySelectorAll(".brd-m.new")].map((x) => x.querySelector(".t").textContent), lab: document.querySelector(".brd-bar h2").textContent }));
    t.ok(n0.n.length === 1 && /Courier late today/.test(n0.n[0]) && /1 new/.test(n0.lab), "only what came since last time is marked New: " + JSON.stringify(n0));
    // no faster than the minute refresh
    t.ok(await pb.evaluate(() => { let ms = 0; const si = window.setInterval; window.setInterval = function (f, d) { ms = Math.max(ms, d || 0); return si.apply(this, arguments); }; window.EIKON.modules.brdreg.render({ mount: document.querySelector("#eikon-content") }); window.setInterval = si; return ms >= 60000; }), "the board refreshes once a minute, not faster");
  },
};
