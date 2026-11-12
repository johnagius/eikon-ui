/* Shortages, new layout: the pharmacy network's "who has this?". Other pharmacies' open requests, where you offer a
   quantity and, once they accept, confirm it is sent; your own requests, where offers come in and you accept one; and
   one form to ask for something. Who offered is shown only as the server allows (it hides it otherwise).
   Your own request: Change (the classic Edit request body: entry_date, item_name, description, needed_by or null,
   quantity_needed, is_closed), Close request (the same body with is_closed 1, as the classic Edit with Status Closed) and
   Delete (DELETE /scarce-stock/needs/:id); your offer not yet sent: Withdraw (DELETE /scarce-stock/need-offers/:id).
   Each for whoever classic shows it to (the pharmacy that made it, any role), the closing and removing after one plain
   question. Spare stock you share with every pharmacy is Scarce stock (scsreg). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, needs: [], loading: false, error: "", busy: {}, offering: null, draft: {}, adding: null, saving: false, err: "", editing: null, edit: null, editErr: "", ask: "", askErr: "" };
  function cut(v, max) { var x = String(v == null ? "" : v).trim(); return x.length > max ? x.slice(0, max) : x; } // the classic trimMax
  function int0(v) { var n = Number(v); if (!isFinite(n)) return 0; n = Math.floor(n); return n < 0 ? 0 : n; } // the classic intOrZero
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] : ""; }

  function css() {
    if (document.getElementById("eikon-ssreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ssreg-css";
    st.textContent =
      ".ssr{max-width:880px;margin:0 auto}" +
      ".ssr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".ssr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".ssr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.ssr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".ssr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".ssr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.ssr-btn:disabled{opacity:.55;cursor:default}.ssr-btn.s{height:30px;padding:0 12px;font-size:13px;border-radius:15px}" +
      ".ssr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;gap:8px}.ssr-lab b{color:var(--text)}" +
      ".ssr-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:10px}" +
      ".ssr-card .h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.ssr-card .h b{font-size:15.5px;font-weight:600}.ssr-card .h em{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".ssr-card div.s{font-size:12.5px;color:var(--muted);margin-top:3px}.ssr-card .d{font-size:14px;margin-top:4px}" +
      ".ssr-off{display:flex;align-items:center;gap:10px;padding:8px 0 0;margin-top:8px;border-top:.5px solid var(--border);font-size:14px;flex-wrap:wrap}.ssr-off .t{flex:1;min-width:150px}.ssr-off small{display:block;color:var(--muted);font-size:12px}" +
      ".ssr-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--muted);white-space:nowrap}.ssr-pill.ok{background:rgba(28,138,91,.16);color:var(--ok)}.ssr-pill.wait{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}" +
      ".ssr-card .a{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}" +
      ".ssr-in,.ssr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:10px}.ssr-in{background:rgba(118,118,128,.07);border:0}" +
      ".ssr-in label,.ssr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.ssr-in label:first-child,.ssr-form label:first-child{border-top:0}" +
      ".ssr-in label>span,.ssr-form label>span{flex:0 0 96px;font-size:15px}.ssr-in input,.ssr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".ssr-in .acts,.ssr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}.ssr-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".ssr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:18px;color:var(--muted)}" +
      "@media (max-width:600px){.ssr{padding:4px 16px 0}.ssr h1{font-size:32px}}" +
      // Stock group: a 44 px way back, a pressed state on every button, 44 px buttons on a phone, a retry under a failed load.
      ".ssr-back{display:inline-flex;align-items:center;min-height:44px;padding:0 8px 0 0;margin:-8px 0 -2px}.ssr-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".ssr-quiet .ssr-btn{margin-top:12px;display:block}" +
      ".ssr-foot{font-size:12.5px;color:var(--muted);margin-top:12px}.ssr-foot a{color:var(--accent);display:inline-block;padding:15px 0;margin:-15px 0}" +
      "@media (max-width:600px){.ssr-btn,.ssr-btn.s{height:44px;border-radius:22px}}" +
      // round 2: change, close and delete your request; withdraw your offer.
      ".ssr-card .a.l{justify-content:space-between;flex-wrap:wrap}.ssr-card .a.l>span{display:flex;gap:8px;flex-wrap:wrap}" +
      ".ssr-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.ssr-btn.dd{background:#B42318;border-color:#B42318;color:#fff}" +
      ".ssr-ask{font-size:15px;font-weight:600;margin:10px 0 0;padding-top:10px;border-top:.5px solid var(--border)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .ssr-btn.d{color:#FF7A72;border-color:#FF7A72}}";
    document.head.appendChild(st);
  }

  async function fetchNeeds() { var r = await E.apiFetch("/scarce-stock/needs?open=1", { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load shortages"); return r.needs || []; }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { S.needs = await fetchNeeds(); } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load shortages"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function offerLine(o, ownerView) {
    var who = o.mine ? "Your offer" : (o.offerer_display || "Another pharmacy");
    var state = o.confirmed ? '<span class="ssr-pill ok">Sent</span>' : o.accepted ? '<span class="ssr-pill wait">Accepted</span>' : '<span class="ssr-pill">Offered</span>';
    var act = "";
    if (ownerView && !o.accepted) act = '<button class="ssr-btn s p" data-act="accept" data-id="' + o.id + '"' + (S.busy[o.id] ? " disabled" : "") + ">Accept</button>";
    if (!ownerView && o.mine && o.accepted && !o.confirmed) act = '<button class="ssr-btn s p" data-act="confirm" data-id="' + o.id + '"' + (S.busy[o.id] ? " disabled" : "") + ">It is sent</button>";
    var wd = !ownerView && o.mine && !o.confirmed, asking = S.ask === "wd:" + o.id;
    if (wd && !asking) act += '<button class="ssr-btn s d" data-act="wd" data-id="' + o.id + '"' + (S.busy[o.id] ? " disabled" : "") + ' aria-label="Withdraw your offer of ' + esc(o.quantity_offered) + '">Withdraw…</button>';
    var h = '<div class="ssr-off"><div class="t"><b>' + esc(o.quantity_offered) + "</b> · " + esc(who) + (o.note ? "<small>" + esc(o.note) + "</small>" : "") + "</div>" + state + act + "</div>";
    if (asking) h += '<p class="ssr-ask" id="ssr-ask-o' + o.id + '">Withdraw your offer of ' + esc(o.quantity_offered) + "?</p>" + (S.askErr ? '<div class="ssr-err" role="alert" style="padding:4px 0">' + esc(S.askErr) + "</div>" : "") +
      '<div class="a"><button class="ssr-btn" data-act="ask-cancel" data-id="' + o.id + '">Keep it</button><button class="ssr-btn dd" data-act="wd-go" data-id="' + o.id + '" aria-describedby="ssr-ask-o' + o.id + '"' + (S.busy[o.id] ? " disabled" : "") + ">" + (S.busy[o.id] ? "Withdrawing…" : "Withdraw offer") + "</button></div>";
    return h;
  }
  function needCard(n, mine) {
    // SF9: the same words on both kinds of line ("Asked 10 Nov · needed by 14 Nov · asked for 5"); another pharmacy's name on its own line
    var left = Math.max(0, Number(n.remaining_quantity) || 0), sub = ["Asked " + dm(n.entry_date)], from = mine ? "" : (n.org_name + " — " + n.location_name);
    if (n.needed_by) sub.push("needed by " + dm(n.needed_by));
    var offers = (n.offers || []).filter(function (o) { return mine || o.mine; });
    var h = '<div class="ssr-card"><div class="h"><b>' + esc(n.item_name) + "</b><em>" + (left ? left + " still needed" : "All offered") + "</em></div>" + (from ? '<div class="s">' + esc(from) + "</div>" : "") + '<div class="s">' + esc(sub.join(" · ")) + " · asked for " + esc(n.quantity_needed) + "</div>" + (n.description ? '<div class="d">' + esc(n.description) + "</div>" : "");
    h += offers.map(function (o) { return offerLine(o, mine); }).join("");
    if (mine && !offers.length) h += '<div class="s" style="margin-top:8px">No offers yet.</div>';
    if (mine) h += mineActs(n);
    if (!mine) {
      if (S.offering === n.id) h += '<form class="ssr-in sf-form" id="ssr-offer" autocomplete="off"><label><span>I can give</span><input name="quantity_offered" inputmode="numeric" value="' + esc(S.draft.quantity_offered || "") + '" placeholder="How many"></label><label><span>Note</span><input name="note" value="' + esc(S.draft.note || "") + '" placeholder="Optional, e.g. expiry 03/27"></label>' + (S.err ? '<div class="ssr-err" role="alert">' + esc(S.err) + "</div>" : "") + '<div class="acts"><button type="button" class="ssr-btn" data-act="offer-cancel">Cancel</button><button type="submit" class="ssr-btn p"' + (S.saving ? " disabled" : "") + ">Offer</button></div></form>";
      else if (!offers.length) h += '<div class="a"><button class="ssr-btn s" data-act="offer" data-id="' + n.id + '">I can help</button></div>';
    }
    return h + "</div>";
  }

  // Your request: Change opens its form in place; Close request and Delete ask first.
  function mineActs(n) {
    var busy = S.busy["n" + n.id];
    if (S.editing === n.id) {
      var d = S.edit || {}, fld = function (k, t, extra) { return "<label><span>" + t + '</span><input name="' + k + '" value="' + esc(d[k] == null ? "" : d[k]) + '"' + (extra || "") + "></label>"; };
      return '<form class="ssr-in sf-form" id="ssr-edit" data-id="' + n.id + '" autocomplete="off" aria-label="' + esc("Change your request for " + n.item_name) + '">' + fld("item_name", "Item") + fld("quantity_needed", "How many", ' inputmode="numeric"') +
        fld("needed_by", "Needed by", ' type="date"') + fld("description", "Note", ' placeholder="Optional, seen by every pharmacy"') + (S.editErr ? '<div class="ssr-err" role="alert">' + esc(S.editErr) + "</div>" : "") +
        '<div class="acts"><button type="button" class="ssr-btn" data-act="edit-cancel">Cancel</button><button type="submit" class="ssr-btn p"' + (busy ? " disabled" : "") + ">" + (busy ? "Saving…" : "Save changes") + "</button></div></form>";
    }
    if (S.ask === "close:" + n.id || S.ask === "del:" + n.id) {
      var del = S.ask === "del:" + n.id;
      return '<p class="ssr-ask" id="ssr-ask-n' + n.id + '">' + (del ? "Delete your request for " + esc(n.item_name) + "? Its offers are deleted too. This cannot be undone." : "Close your request for " + esc(n.item_name) + "? It comes off every pharmacy's list.") + "</p>" +
        (S.askErr ? '<div class="ssr-err" role="alert" style="padding:4px 0">' + esc(S.askErr) + "</div>" : "") +
        '<div class="a"><button class="ssr-btn" data-act="ask-cancel" data-id="' + n.id + '">Keep it</button><button class="ssr-btn ' + (del ? "dd" : "p") + '" data-act="' + (del ? "del-go" : "close-go") + '" data-id="' + n.id + '" aria-describedby="ssr-ask-n' + n.id + '"' + (busy ? " disabled" : "") + ">" + (busy ? (del ? "Deleting…" : "Closing…") : (del ? "Delete request" : "Close request")) + "</button></div>";
    }
    return '<div class="a l"><span><button class="ssr-btn s d" data-act="del" data-id="' + n.id + '"' + (busy ? " disabled" : "") + ' aria-label="' + esc("Delete your request for " + n.item_name) + '">Delete…</button></span>' +
      '<span><button class="ssr-btn s" data-act="edit" data-id="' + n.id + '"' + (busy ? " disabled" : "") + ' aria-label="' + esc("Change your request for " + n.item_name) + '">Change</button><button class="ssr-btn s" data-act="close" data-id="' + n.id + '"' + (busy ? " disabled" : "") + ">Close request</button></span></div>";
  }
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "ssreg") return; // left before a reply came back: do not draw over the next screen
    if (!fromState) keep();
    var h = '<div class="ssr"><button class="ssr-back" data-act="back">' + esc(E.ui2BackLabel("ssreg")) + '</button>' +
      '<div class="ssr-top"><div><h1>Shortages</h1><p class="ssr-sub">What other pharmacies are looking for, and what you asked for.</p></div>' + (S.adding ? "" : '<button class="ssr-btn p" data-act="add">Ask for something</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="ssr-form sf-form sf-new" id="ssr-add" autocomplete="off"><label><span>Item</span><input name="item_name" value="' + esc(a.item_name || "") + '" placeholder="e.g. Ozempic 1mg pen"></label><label><span>How many</span><input name="quantity_needed" inputmode="numeric" value="' + esc(a.quantity_needed || "") + '"></label>' +
        '<label><span>Needed by</span><input name="needed_by" type="date" min="' + esc(today()) + '" value="' + esc(a.needed_by || "") + '"></label><label><span>Note</span><input name="description" value="' + esc(a.description || "") + '" placeholder="Optional"></label>' +
        (S.err && !S.offering ? '<div class="ssr-err" role="alert">' + esc(S.err) + "</div>" : "") + '<div class="acts"><button type="button" class="ssr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="ssr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Ask the network") + "</button></div></form>";
    }
    if (S.loading && !S.needs.length) h += '<div class="ssr-quiet" style="margin-top:14px">Opening shortages…</div>';
    else if (S.error) h += '<div class="ssr-quiet" style="margin-top:14px" role="alert">' + esc(S.error) + '<button class="ssr-btn" data-act="retry">Try again</button></div>';
    else {
      var mine = S.needs.filter(function (n) { return n.mine_owner; }), others = S.needs.filter(function (n) { return !n.mine_owner; });
      var waiting = others.filter(function (n) { return (n.offers || []).some(function (o) { return o.mine && o.accepted && !o.confirmed; }); });
      if (waiting.length) h += '<div class="ssr-lab">To send <b>' + waiting.length + "</b></div>" + waiting.map(function (n) { return needCard(n, false); }).join("");
      h += '<div class="ssr-lab">You asked for <b>' + mine.length + "</b></div>" + (mine.length ? mine.map(function (n) { return needCard(n, true); }).join("") : '<div class="ssr-quiet">Nothing asked for right now.</div>');
      var rest = others.filter(function (n) { return waiting.indexOf(n) < 0; });
      h += '<div class="ssr-lab">Other pharmacies need <b>' + rest.length + "</b></div>" + (rest.length ? rest.map(function (n) { return needCard(n, false); }).join("") : '<div class="ssr-quiet">No other pharmacy is short of anything right now.</div>');
    }
    h += '<p class="ssr-foot">Have spare stock another pharmacy may need? Share it in <a href="#scsreg">Scarce stock</a>.</p></div>';
    var ae = document.activeElement, fm = ae && m.contains(ae) && ae.name && ae.closest ? ae.closest("form") : null, sel = fm ? (fm.id ? "#" + fm.id + " " : "") + "[name=" + ae.name + "]" : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (act === "back") window.location.hash = E.ui2BackHash("ssreg");
        else if (act === "retry") load();
        else if (act === "add") { S.adding = {}; S.offering = null; S.err = ""; paint(true); E.focusSoon(function () { return m.querySelector("[name=item_name]"); }, 30); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); setTimeout(function () { var b = m.querySelector('[data-act="add"]'); if (b) b.focus(); }, 30); }
        else if (act === "offer") { S.offering = id; S.draft = {}; S.adding = null; S.err = ""; paint(true); E.focusSoon(function () { return m.querySelector("#ssr-offer [name=quantity_offered]"); }, 30); }
        else if (act === "offer-cancel") { var was = S.offering; S.offering = null; S.err = ""; paint(true); setTimeout(function () { var b = m.querySelector('[data-act="offer"][data-id="' + was + '"]'); if (b) b.focus(); }, 30); }
        else if (act === "accept") step(id, "accept", "Accepted. They will send it.");
        else if (act === "confirm") step(id, "confirm", "Marked as sent.");
        else if (act === "edit") { var n = S.needs.find(function (x) { return x.id === id; }); if (!n) return; S.editing = id; S.edit = { item_name: n.item_name || "", quantity_needed: String(n.quantity_needed == null ? 0 : n.quantity_needed), needed_by: n.needed_by || "", description: n.description || "" }; S.editErr = ""; S.ask = ""; S.adding = null; S.offering = null; paint(true); E.focusSoon(function () { return m.querySelector("#ssr-edit [name=item_name]"); }, 30); }
        else if (act === "edit-cancel") { var w = S.editing; S.editing = null; S.edit = null; S.editErr = ""; paint(true); E.focusSoon(function () { return m.querySelector('[data-act="edit"][data-id="' + w + '"]'); }, 30); }
        else if (act === "close" || act === "del" || act === "wd") { S.ask = act + ":" + id; S.askErr = ""; S.editing = null; paint(true); E.focusSoon(function () { return m.querySelector('[data-act="ask-cancel"][data-id="' + id + '"]'); }, 30); }
        else if (act === "ask-cancel") { var was = S.ask.split(":")[0]; S.ask = ""; S.askErr = ""; paint(true); E.focusSoon(function () { return m.querySelector('[data-act="' + was + '"][data-id="' + id + '"]'); }, 30); }
        else if (act === "close-go") saveNeed(id, true);
        else if (act === "del-go") delNeed(id);
        else if (act === "wd-go") withdraw(id);
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "ssreg"); } catch (x) {} E.openClassic("scarcestock"); }
      });
    });
    // Escape closes the open form (what is typed in it is dropped, as with Cancel) and puts you back where you were.
    m.querySelectorAll("form").forEach(function (f) { f.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var c = f.querySelector('[data-act$="-cancel"]'); if (c) { ev.preventDefault(); c.click(); } }); });
    var fo = m.querySelector("#ssr-offer"); if (fo) fo.addEventListener("submit", function (ev) { ev.preventDefault(); offer(); });
    var fa = m.querySelector("#ssr-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
    var fe = m.querySelector("#ssr-edit"); if (fe) fe.addEventListener("submit", function (ev) { ev.preventDefault(); saveNeed(S.editing, false); });
    m.querySelectorAll(".ssr-card").forEach(function (c) { c.addEventListener("keydown", function (ev) { if (ev.key !== "Escape") return; var k = c.querySelector('[data-act="ask-cancel"]'); if (k) { ev.preventDefault(); k.click(); } }); });
  }
  function keep() {
    var m = S.mount; if (!m) return;
    var fo = m.querySelector("#ssr-offer"); if (fo) ["quantity_offered", "note"].forEach(function (k) { var el = fo.querySelector("[name=" + k + "]"); if (el) S.draft[k] = String(el.value || "").trim(); });
    var fe = m.querySelector("#ssr-edit"); if (fe && S.edit) ["item_name", "quantity_needed", "needed_by", "description"].forEach(function (k) { var el = fe.querySelector("[name=" + k + "]"); if (el) S.edit[k] = String(el.value || ""); });
    var fa = m.querySelector("#ssr-add"); if (fa && S.adding) ["item_name", "quantity_needed", "needed_by", "description"].forEach(function (k) { var el = fa.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  async function step(id, what, okText) { // accept (the asking pharmacy) or confirm sent (the offering one): each is a one-way action
    if (S.busy[id]) return;
    S.busy[id] = true; paint();
    try {
      var r = await E.apiFetch("/scarce-stock/need-offers/" + encodeURIComponent(String(id)) + "/" + what, { method: "POST", body: "{}" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not save");
      E.toast(okText, "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy[id] = false; return load();
  }
  // Change / Close request: the classic Edit request's PUT. Close sends the request as stored with is_closed 1.
  async function saveNeed(id, close) {
    var n = S.needs.find(function (x) { return x.id === id; }); if (!n || S.busy["n" + id]) return;
    if (!close) keep();
    var d = close ? { item_name: n.item_name, quantity_needed: n.quantity_needed, needed_by: n.needed_by || "", description: n.description || "" } : S.edit;
    var body = { entry_date: cut(/^\d{4}-\d{2}-\d{2}$/.test(String(n.entry_date || "").trim()) ? n.entry_date : today(), 40), item_name: cut(d.item_name, 220), description: cut(d.description, 2000),
      needed_by: cut(d.needed_by, 40) || null, quantity_needed: int0(d.quantity_needed), is_closed: close ? 1 : (n.is_closed === 1 || n.is_closed === true ? 1 : 0) };
    S.editErr = "";
    if (!body.item_name) S.editErr = "Write the item. Nothing was saved.";
    else if (!/^\d+$/.test(String(d.quantity_needed).trim()) || Number(d.quantity_needed) < 1) S.editErr = "Write how many you need (a whole number). Nothing was saved.";
    else if (body.needed_by && !/^\d{4}-\d{2}-\d{2}$/.test(body.needed_by)) S.editErr = "Write the date it is needed by, or leave it empty. Nothing was saved.";
    if (S.editErr && !close) { paint(true); return E.focusSoon(function () { return S.mount && S.mount.querySelector("#ssr-edit [name=" + (!body.item_name ? "item_name" : /^\d+$/.test(String(d.quantity_needed).trim()) && Number(d.quantity_needed) >= 1 ? "needed_by" : "quantity_needed") + "]"); }, 0); }
    S.editErr = "";
    S.busy["n" + id] = true; S.askErr = ""; paint(true);
    try {
      var r = await E.apiFetch("/scarce-stock/needs/" + encodeURIComponent(String(id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
    } catch (x) {
      S.busy["n" + id] = false; if (close) S.askErr = E.saveFailText(x); else S.editErr = E.saveFailText(x); paint(true);
      return E.focusSoon(function () { return S.mount && S.mount.querySelector(close ? '[data-act="close-go"]' : "#ssr-edit [type=submit]"); }, 0);
    }
    S.busy["n" + id] = false; S.editing = null; S.edit = null; S.ask = "";
    E.toast(close ? "Closed · " + body.item_name : "Saved · " + body.item_name, "success");
    await load(); E.focusSoon(function () { return S.mount && S.mount.querySelector(close ? '[data-act="add"]' : '[data-act="edit"][data-id="' + id + '"]'); }, 0);
  }
  // A DELETE; a lost answer reads the list again before saying it failed.
  async function gone(path, isGone) {
    try { var r = await E.apiFetch(path, { method: "DELETE" }); if (!r || !r.ok) throw new Error((r && r.error) || "Delete failed"); }
    catch (x) { var ok = false; if (x && x.network) { try { ok = isGone(await fetchNeeds()); } catch (y) {} } if (!ok) throw x; }
  }
  async function delNeed(id) {
    var n = S.needs.find(function (x) { return x.id === id; }); if (!n || S.busy["n" + id]) return;
    S.busy["n" + id] = true; S.askErr = ""; paint(true);
    try { await gone("/scarce-stock/needs/" + encodeURIComponent(String(id)), function (all) { return !all.some(function (x) { return x.id === id; }); }); }
    catch (x) { S.busy["n" + id] = false; S.askErr = E.saveFailText(x).replace(/^Not saved/, "Not deleted"); paint(true); return E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="del-go"]'); }, 0); }
    S.busy["n" + id] = false; S.ask = ""; E.toast("Deleted · request for " + n.item_name, "success");
    await load(); E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="add"]'); }, 0);
  }
  async function withdraw(id) {
    if (S.busy[id]) return;
    S.busy[id] = true; S.askErr = ""; paint(true);
    try { await gone("/scarce-stock/need-offers/" + encodeURIComponent(String(id)), function (all) { return !all.some(function (n) { return (n.offers || []).some(function (o) { return o.id === id; }); }); }); }
    catch (x) { S.busy[id] = false; S.askErr = E.saveFailText(x).replace(/^Not saved/, "Not withdrawn"); paint(true); return E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="wd-go"]'); }, 0); }
    S.busy[id] = false; S.ask = ""; E.toast("Offer withdrawn", "success");
    await load(); E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-act="add"]'); }, 0);
  }
  async function offer() {
    if (S.saving) return;
    keep();
    var q = S.draft.quantity_offered, n = S.needs.find(function (x) { return x.id === S.offering; }); S.err = "";
    if (!/^\d+$/.test(q || "") || Number(q) < 1) { S.err = "Write how many you can give (a whole number). Nothing was sent."; return paint(true); }
    S.saving = true; paint(true);
    var body = { quantity_offered: Number(q), note: S.draft.note || "" };
    try {
      await E.postOnce("/scarce-stock/needs/" + encodeURIComponent(String(S.offering)) + "/offers", body, { list: async function () { var all = await fetchNeeds(); var x = all.find(function (y) { return y.id === S.offering; }); return x ? x.offers || [] : []; },
        same: function (o) { return o.mine && Number(o.quantity_offered) === body.quantity_offered; } });
      E.toast("Offered " + body.quantity_offered + (n ? " to " + n.org_name : ""), "success"); S.offering = null; S.draft = {};
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }
  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    if (!a.item_name) S.err = "Write the item. Nothing was sent.";
    else if (!/^\d+$/.test(a.quantity_needed || "") || Number(a.quantity_needed) < 1) S.err = "Write how many you need (a whole number). Nothing was sent.";
    if (S.err) return paint(true);
    S.saving = true; paint(true);
    var body = { entry_date: today(), item_name: a.item_name, quantity_needed: Number(a.quantity_needed), needed_by: a.needed_by || "", description: a.description || "" };
    try {
      await E.postOnce("/scarce-stock/needs", body, { list: fetchNeeds, same: function (n) { return n.mine_owner && String(n.item_name).trim().toLowerCase() === body.item_name.toLowerCase() && Number(n.quantity_needed) === body.quantity_needed && n.entry_date === body.entry_date; } });
      S.adding = null; E.toast("Asked the network for " + body.item_name, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "ssreg", title: "Shortages", order: 3, icon: "⇄", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.offering = null; S.err = ""; S.busy = {}; S.editing = null; S.edit = null; S.ask = ""; S.askErr = ""; css(); paint(); return E.takeOpenForm("ssreg", S.mount, load(), { btn: "[data-act=add]", form: "#ssr-add" } /* q5-2: a half-typed form comes back */, null); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("ssreg") < 0) E.UI2_DESTINATIONS.push("ssreg");
  if (E.UI2_PARENT) E.UI2_PARENT.ssreg = "stock";
})();
