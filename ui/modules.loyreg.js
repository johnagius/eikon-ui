/* Loyalty, new layout (Stock & Customers round 2, builder "customers"): the classic Loyalty & Campaigns screen
   (modules.loyalty.js) rebuilt in the new design. Same data, same routes, same saved bodies, same rights:
     - Record a purchase: POST /loyalty/transactions with exactly the classic submitTransaction body (its keys, its
       order, its sums and its "Awarded 2 stamps" words); the ID card padded as the classic normMtId pads it.
       After it: the classic receipt print (the same page, character for character).
     - Cards (the classic Clients tab): GET /loyalty/clients; one card opens with its history from
       GET /loyalty/transactions?client= (one card's rows, indexed), the classic history print, and Remove card
       (DELETE /loyalty/clients/:id, the pharmacist only, as the server allows; it removes the card's history too).
     - Campaigns: GET /loyalty/campaigns; New and Edit send the classic collectCampForm body to POST /loyalty/campaigns
       (the server's upsert); Pause / Start sends the classic toggle (PUT /loyalty/campaigns/:id with the whole campaign
       as loaded and active flipped); Delete is DELETE /loyalty/campaigns/:id (the pharmacist only, as the server allows).
   Reads, kept small: on opening the campaigns and this month's purchases only (GET ?month=, date-bounded and indexed),
   where the classic screen read every campaign, every card, 300 items and up to 5,000 purchases. The cards list, the
   item suggestions and one card's history are read when they are first needed.
   The classic screen stays one tap away under ⋯ (Classic Loyalty screen). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;
  var ID = "loyreg";

  var S = { mount: null, view: "record", camps: [], month: [], loading: false, error: "", form: null, snap: {}, saved: null, saving: false,
    clients: null, clientsErr: "", q: "", open: null, hist: {}, items: null, cq: "", edit: null, ask: null, menu: false };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var LAST = "eikon_loyreg_camp"; // the campaign used last on this device (a convenience only)

  // The six kinds of campaign: the classic values, in plain words. icon/label are the classic ones, for its prints only.
  var KINDS = [
    { v: "stamp_card", name: "Stamp card", desc: "A stamp for each item; a reward when the card is full.", icon: "⭐", label: "Stamp Card" },
    { v: "points", name: "Points", desc: "Points for each euro spent; a reward at a number of points.", icon: "💎", label: "Points" },
    { v: "discount", name: "Discount", desc: "Always so much off a brand or some items.", icon: "🏷", label: "Always-On Discount" },
    { v: "event", name: "Seasonal offer", desc: "An offer for a few days, like Black Friday.", icon: "🎉", label: "Event Campaign" },
    { v: "buy_x_get_y", name: "Buy some, get one free", desc: "Buy a number of items, get some free.", icon: "🎁", label: "Buy X Get Y" },
    { v: "tiered", name: "Spend levels", desc: "Better rewards as the customer spends more.", icon: "🏆", label: "Spend Tiers" }
  ];
  function kind(t) { return KINDS.filter(function (k) { return k.v === t; })[0] || KINDS[0]; }

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { return E.maltaYmd ? E.maltaYmd() : new Date().toISOString().slice(0, 10); }
  function dm(s) { var p = String(s || "").slice(0, 10).split("-"); return p.length === 3 && p[2] ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === Number(today().slice(0, 4)) ? "" : " " + p[0]) : ""; }
  function fold(s) { return E.people && E.people.foldMt ? E.people.foldMt(String(s || "")) : String(s || "").toLowerCase(); }
  function isAdmin() { var u = E.state && E.state.user; return !!(u && u.role === "admin"); }
  function uid() { return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8); } // the classic uid()
  // The classic normMtId: the number padded to 7 digits, the letter kept (123456M -> 0123456M).
  function normId(raw) { var s = String(raw || "").trim().toUpperCase(); if (!s) return s; var m = s.match(/^(\d+)([A-Z]?)$/); return m ? m[1].padStart(7, "0") + m[2] : s; }
  function lsGet(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  // The classic campaignStatus, and its words here.
  function status(c) {
    if (!c.active) return "inactive"; if (c.open_ended) return "open";
    var t = today(); if (c.end_date && c.end_date < t) return "ended"; if (c.start_date && c.start_date > t) return "upcoming"; return "active";
  }
  function running(c) { var s = status(c); return s === "active" || s === "open"; }
  function statusWords(c) {
    var s = status(c);
    if (s === "open") return ["Running", "ok"];
    if (s === "active") return [c.end_date ? "Running until " + dm(c.end_date) : "Running", "ok"];
    if (s === "upcoming") return ["Starts " + dm(c.start_date), "soon"];
    if (s === "ended") return ["Ended " + dm(c.end_date), ""];
    return ["Paused", ""];
  }
  // What the campaign gives, in one line.
  function gives(c) {
    if (c.type === "stamp_card") return (c.stamp_target || 10) + " stamps" + (c.reward ? " for " + c.reward : "");
    if (c.type === "points") return (c.points_per_unit || 1) + " point" + (Number(c.points_per_unit || 1) === 1 ? "" : "s") + " per €1 · " + (c.redeem_threshold || 100) + " points" + (c.reward ? " for " + c.reward : " for the reward");
    if (c.type === "discount") return (c.discount_pct || 10) + "% off " + (c.brand || "all items") + (c.discount_scope ? " · " + c.discount_scope : "");
    if (c.type === "event") return (c.event_name || c.name) + (c.event_offer ? " · " + c.event_offer : "");
    if (c.type === "buy_x_get_y") return "Buy " + (c.buy_qty || 3) + ", get " + (c.get_qty || 1) + " free" + (c.reward ? " · " + c.reward : "");
    if (c.type === "tiered") return (c.tiers || []).map(function (t) { return "€" + t.spend + "+ " + t.reward; }).join(" · ") || "Spend levels";
    return "";
  }

  function css() {
    if (document.getElementById("eikon-loyreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-loyreg-css";
    st.textContent =
      ".lyr{max-width:880px;margin:0 auto;position:relative}.lyr>.lyr-menu{position:absolute;top:-4px;right:0}" +
      ".lyr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 12px 0 0;min-height:44px;margin:-8px 0 2px;cursor:pointer}" +
      ".lyr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".lyr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.lyr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".lyr-btn{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".lyr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.lyr-btn:disabled{opacity:.55;cursor:default}.lyr-btn.d{color:var(--danger)}" +
      ".lyr-lnk{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 10px;border:0;border-radius:10px;background:none;color:var(--accent);cursor:pointer}" +
      ".lyr-lnk.d{color:var(--danger)}" +
      ".lyr-menu{position:relative}.lyr-menu .list{position:absolute;right:0;top:44px;z-index:20;min-width:230px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);padding:4px}" +
      ".lyr-menu .list button{display:block;width:100%;text-align:left;font:inherit;font-size:15px;min-height:44px;padding:0 12px;border:0;background:none;color:var(--text);border-radius:8px;cursor:pointer}" +
      ".lyr-menu .list button:hover,.lyr-menu .list button:focus-visible{background:rgba(127,127,127,.10)}" +
      ".lyr-more{width:44px;min-height:44px;padding:0;font-size:20px;line-height:1}" +
      ".lyr-sum{font-size:13.5px;color:var(--muted);margin:10px 2px 0}.lyr-sum b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".lyr-seg{display:flex;gap:4px;margin-top:16px;padding:3px;border-radius:12px;background:rgba(118,118,128,.12);width:max-content;max-width:100%}" +
      ".lyr-seg-b{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border:0;border-radius:9px;background:none;color:var(--text);cursor:pointer}.lyr-seg-b[aria-pressed=true]{background:var(--panel2);box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      ".lyr-lab{font-size:13px;font-weight:600;color:var(--muted);margin:20px 2px 7px}" +
      ".lyr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".lyr-form>label,.lyr-form .row>label,.lyr-f{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}" +
      ".lyr-form>label:first-child{border-top:0}.lyr-form label>span{flex:0 0 112px;font-size:15px}" +
      ".lyr-form input:not([type=checkbox]):not([type=radio]),.lyr-form select,.lyr-form textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".lyr-form select{appearance:auto}.lyr-form textarea{min-height:64px;resize:vertical}" +
      ".lyr-form label:focus-within{background:rgba(127,127,127,.06)}" +
      ".lyr-form h2{font-size:13px;font-weight:600;color:var(--muted);margin:14px 16px 4px;letter-spacing:0}" +
      ".lyr-acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end;align-items:center;flex-wrap:wrap;border-top:.5px solid var(--border)}" +
      ".lyr-ferr,.lyr-err{display:block;color:var(--danger);font-size:13.5px;padding:6px 16px}" +
      ".lyr [aria-invalid=true]{box-shadow:inset 0 -2px 0 var(--danger)}" +
      ".lyr-items{list-style:none;margin:0;padding:0}.lyr-items li{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 6px 0 16px;border-top:.5px solid var(--border);font-size:15px}" +
      ".lyr-items li span{flex:1;min-width:0;overflow-wrap:anywhere}.lyr-items li em{font-style:normal;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".lyr-add{display:flex;align-items:center;gap:8px;padding:0 10px 0 16px;border-top:.5px solid var(--border);min-height:48px}" +
      ".lyr-add label{display:flex;align-items:center;gap:8px;flex:1;min-width:0}.lyr-add label.q{flex:0 0 auto}.lyr-add label.q .m{font-size:13px;color:var(--muted)}.lyr-add label.q input{flex:0 0 48px!important;width:48px;text-align:center}.lyr-add label>span{flex:none!important}" +
      ".lyr-snap{margin:4px 16px 8px;padding:10px 12px;border-radius:12px;background:rgba(118,118,128,.08);font-size:14px}" +
      ".lyr-snap b{font-weight:600}.lyr-snap .m{color:var(--muted);font-size:13px}" +
      ".lyr-prog{list-style:none;margin:6px 0 0;padding:0}.lyr-prog li{padding:6px 0;border-top:.5px solid var(--border);display:flex;flex-direction:column;gap:3px}.lyr-prog li:first-child{border-top:0}" +
      ".lyr-prog li.on b{color:var(--accent)}.lyr-prog .full{color:var(--ok);font-weight:600}" +
      ".lyr-bar{display:block;height:6px;border-radius:3px;background:rgba(118,118,128,.18);overflow:hidden}.lyr-bar i{display:block;height:100%;background:var(--accent);border-radius:3px}" +
      ".lyr-done{margin-top:12px;padding:12px 16px;border-radius:12px;border:1px solid var(--ok);background:var(--panel2);display:flex;gap:10px;align-items:center;flex-wrap:wrap;font-size:14.5px}" +
      ".lyr-done span{flex:1;min-width:200px}" +
      ".lyr-list{list-style:none;margin:0;padding:0;background:var(--panel2);border:1px solid var(--border);border-radius:14px;overflow:hidden}" +
      ".lyr-list>li{border-top:.5px solid var(--border)}.lyr-list>li:first-child{border-top:0}" +
      ".lyr-row{display:flex;width:100%;align-items:center;gap:12px;min-height:56px;padding:8px 16px;border:0;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}" +
      ".lyr-row .t{flex:1;min-width:0;display:flex;flex-direction:column;gap:2px}.lyr-row .t b{font-size:15.5px;font-weight:600;overflow-wrap:anywhere}.lyr-row .t small{font-size:13px;color:var(--muted);overflow-wrap:anywhere}" +
      ".lyr-row em{font-style:normal;font-size:13px;color:var(--muted);white-space:nowrap;font-variant-numeric:tabular-nums}" +
      ".lyr-row:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}@media (hover:hover){.lyr-row:hover{background:rgba(127,127,127,.06)}}" +
      ".lyr-st{font-size:13px;font-weight:600;white-space:nowrap}.lyr-st.ok{color:var(--ok)}.lyr-st.soon{color:var(--warn)}.lyr-st.x{color:var(--muted)}" +
      ".lyr-in{padding:0 16px 12px}.lyr-in .a{display:flex;gap:4px 8px;flex-wrap:wrap;align-items:center;margin-top:6px}#lyr-camps .lyr-row{min-height:0;padding-bottom:0}#lyr-camps .lyr-in .a{margin-top:0}#lyr-camps .lyr-in .a .lyr-lnk:first-child{margin-left:-10px}.lyr-in .a .r{margin-left:auto}" +
      ".lyr-hist{width:100%;border-collapse:collapse;font-size:13.5px;margin-top:8px}.lyr-hist th{text-align:left;font-weight:600;color:var(--muted);font-size:12.5px;padding:6px 8px 6px 0;border-bottom:.5px solid var(--border)}" +
      ".lyr-hist td{padding:7px 8px 7px 0;border-bottom:.5px solid var(--border);vertical-align:top;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}" +
      ".lyr-ask{margin:8px 0 4px;padding:12px 14px;border-radius:12px;background:var(--warn-soft,rgba(201,138,18,.16));font-size:14px;line-height:1.45}.lyr-ask .acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:10px}" +
      ".lyr-q{width:100%;box-sizing:border-box;height:44px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin:14px 0 10px}" +
      ".lyr-q:focus{border-color:var(--accent)}" +
      ".lyr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".lyr-kinds{border:0;margin:0;padding:4px 16px 8px}.lyr-kinds legend{font-size:15px;padding:8px 0 4px}" +
      ".lyr-kinds .g{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:8px}" +
      ".lyr-kind{display:flex!important;gap:10px;align-items:flex-start!important;border:1px solid var(--border)!important;border-radius:12px;padding:10px 12px!important;cursor:pointer;min-height:44px}" +
      ".lyr-kind input{margin-top:3px;accent-color:var(--accent);width:18px;height:18px;flex:none}.lyr-kind>span{flex:1 1 auto!important}.lyr-kind b{display:block;font-size:15px;font-weight:600}.lyr-kind small{display:block;font-size:13px;color:var(--muted);margin-top:2px}" +
      ".lyr-kind:has(input:checked){border-color:var(--accent)!important;box-shadow:inset 0 0 0 1px var(--accent)}" +
      ".lyr-chk{display:flex;align-items:center;gap:10px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border);font-size:15px;cursor:pointer}.lyr-chk input{width:20px;height:20px;accent-color:var(--accent)}" +
      ".lyr-tier{display:flex;align-items:center;gap:8px;padding:0 10px 0 16px;border-top:.5px solid var(--border);min-height:48px}.lyr-tier label{display:flex;align-items:center;gap:8px}.lyr-tier label.s input{width:72px}.lyr-tier label.w{flex:1;min-width:0}" +
      ".lyr-foot{font-size:12.5px;color:var(--muted);margin:16px 2px 0}" +
      ".lyr button:focus-visible,.lyr a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".lyr-sr{position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
      "@media (max-width:600px){.lyr{padding:4px 16px 0}.lyr h1{font-size:32px}.lyr-btn{min-height:44px;border-radius:22px;padding:0 18px}.lyr-seg{width:100%}.lyr-seg-b{flex:1;min-height:44px;padding:0 6px}" +
      ".lyr-form label>span{flex-basis:92px}.lyr-hist th:nth-child(3),.lyr-hist td:nth-child(3){display:none}.lyr-in .a .r{margin-left:0}}";
    document.head.appendChild(st);
  }

  // ---------- reads ----------
  async function load() {
    var keep = E.takeSaveFailed && E.takeSaveFailed();
    S.loading = true; S.error = ""; paint();
    try {
      var r = await Promise.all([E.apiFetch("/loyalty/campaigns", { method: "GET" }), E.apiFetch("/loyalty/transactions?month=" + today().slice(0, 7), { method: "GET" })]);
      if (!r[0] || !r[0].ok) throw new Error((r[0] && r[0].error) || "Could not load the campaigns");
      S.camps = r[0].campaigns || []; S.month = (r[1] && r[1].transactions) || [];
    } catch (e) { if (!keep) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load loyalty"); }
    S.loading = false;
    if (!S.form) S.form = fresh();
    E.whenFormIdle(S.mount, function () { paint(); });
  }
  async function loadClients(force) {
    if (S.clients && !force) return S.clients;
    try { var r = await E.apiFetch("/loyalty/clients", { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the cards"); S.clients = r.clients || []; S.clientsErr = ""; }
    catch (e) { S.clientsErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the cards"); }
    return S.clients;
  }
  async function loadItems() {
    if (S.items) return; S.items = [];
    try { var r = await E.apiFetch("/loyalty/items", { method: "GET" }); S.items = (r && r.items) || []; } catch (e) { S.items = null; }
    var dl = S.mount && S.mount.querySelector("#lyr-itemlist"); if (dl) dl.innerHTML = itemOpts();
  }
  // One card's purchases (the classic filter, done by the server: one card's rows, indexed).
  async function loadHist(card, force) {
    var k = normId(card); if (!k) return null;
    if (S.hist[k] && !force && !S.hist[k].err) return S.hist[k];
    S.hist[k] = { loading: true, rows: [] };
    try { var r = await E.apiFetch("/loyalty/transactions?client=" + encodeURIComponent(k), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load"); S.hist[k] = { rows: r.transactions || [] }; }
    catch (e) { S.hist[k] = { err: true, rows: [] }; }
    return S.hist[k];
  }

  // ---------- record a purchase ----------
  function fresh(keepCamp) {
    var last = keepCamp || lsGet(LAST), run = S.camps.filter(running), cid = run.some(function (c) { return c.id === last; }) ? last : run.length === 1 ? run[0].id : "";
    return { client_id: "", client_name: "", campaign_id: cid, item_desc: "", item_qty: "1", total: "", receipt_no: "", notes: "", items: [] };
  }
  function readForm() {
    var f = S.mount && S.mount.querySelector("#lyr-rec"); if (!f || !S.form) return;
    ["client_id", "client_name", "campaign_id", "item_desc", "item_qty", "total", "receipt_no", "notes"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.form[k] = el.value; });
  }
  // A card's progress on each campaign: the record's own lines (modules.customers.js loyInner), the campaign chosen first.
  function progress(rows, focusId) {
    var byC = {};
    rows.forEach(function (t) { var s = byC[t.campaign_id] = byC[t.campaign_id] || { stamps: 0, points: 0, n: 0, spend: 0 }; s.stamps += Number(t.stamps_awarded) || 0; s.points += Number(t.points_awarded) || 0; s.n++; s.spend += Number(t.total) || 0; });
    var list = S.camps.filter(function (c) { return byC[c.id] || (c.id === focusId); });
    list.sort(function (a, b) { return (a.id === focusId ? -1 : 0) - (b.id === focusId ? -1 : 0); });
    if (!list.length) return "";
    return '<ul class="lyr-prog">' + list.map(function (c) {
      var s = byC[c.id] || { stamps: 0, points: 0, n: 0, spend: 0 }, line = "", pct = null, full = "";
      if (c.type === "stamp_card") { var tg = Number(c.stamp_target) || 10, e = s.stamps % tg; line = e + " of " + tg + " stamps"; if (e + 1 >= tg) full = "The next stamp completes the card"; pct = e / tg; }
      else if (c.type === "points") { var th = Number(c.redeem_threshold) || 100; line = s.points.toLocaleString("en-GB") + " points · " + (th - (s.points % th)) + " to " + (c.reward || "the reward"); var done = Math.floor(s.points / th); if (done) full = "Reached the reward " + done + (done === 1 ? " time" : " times"); pct = Math.min(1, (s.points % th) / th); }
      else if (c.type === "buy_x_get_y") { var bq = Number(c.buy_qty) || 3, ac = s.n % bq; line = ac + " of " + bq + " purchases"; if (ac + 1 >= bq) full = "The next one earns the free item"; pct = ac / bq; }
      else if (c.type === "tiered") { line = (E.eur ? E.eur(s.spend) : "€" + s.spend.toFixed(2)) + " spent"; var cur = null; (c.tiers || []).forEach(function (t) { if (s.spend >= parseFloat(t.spend || 0)) cur = t; }); if (cur) full = "Level reached: " + cur.reward; }
      else if (c.type === "discount") line = (c.discount_pct || 10) + "% off " + (c.brand || "qualifying items");
      else line = s.n + (s.n === 1 ? " purchase" : " purchases") + (c.event_offer ? " · " + c.event_offer : "");
      return '<li class="' + (c.id === focusId ? "on" : "") + '"><b>' + esc(c.name) + (running(c) ? "" : ' <span class="m">(' + esc(statusWords(c)[0].toLowerCase()) + ')</span>') + '</b><span>' + esc(line) + '</span>' +
        (pct != null ? '<span class="lyr-bar" role="img" aria-label="' + Math.round(pct * 100) + ' percent of the way"><i style="width:' + Math.round(pct * 100) + '%"></i></span>' : "") + (full ? '<span class="full">' + esc(full) + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
  }
  function snapHtml() {
    var f = S.form, k = normId(f.client_id);
    if (!k || k.length < 4) return "";
    var h = S.hist[k];
    if (!h || h.loading) return '<div class="lyr-snap" role="status">Looking up card ' + esc(k) + '…</div>';
    if (h.err) return '<div class="lyr-snap" role="status">Could not look up card ' + esc(k) + '. You can still record the purchase.</div>';
    if (!h.rows.length) return '<div class="lyr-snap" role="status"><b>New card</b> <span class="m">· no purchases yet for ' + esc(k) + '. The card is made when you record this one.</span>' + progress([], f.campaign_id) + "</div>";
    var nm = (h.rows[0] && h.rows[0].client_name) || "";
    return '<div class="lyr-snap" role="status"><b>' + esc(nm || k) + '</b> <span class="m">· ' + h.rows.length + (h.rows.length === 1 ? " purchase" : " purchases") + ", last " + esc(dm(h.rows[0].date)) + "</span>" + progress(h.rows, f.campaign_id) + "</div>";
  }
  function itemOpts() { return (S.items || []).slice(0, 300).map(function (x) { return '<option value="' + esc(x) + '">'; }).join(""); }
  function recordHtml() {
    var f = S.form, run = S.camps.filter(running);
    if (!S.camps.length) return '<div class="lyr-quiet">No campaign yet. ' + '<button type="button" class="lyr-lnk" data-act="new-camp">Start a campaign</button> — a stamp card, points or an offer — then record purchases here.</div>';
    if (!run.length) return '<div class="lyr-quiet">No campaign is running today. Start one in <button type="button" class="lyr-lnk" data-act="view" data-v="campaigns">Campaigns</button>.</div>';
    var h = "";
    if (S.saved) h += '<div class="lyr-done" role="status"><span><b>Saved for ' + esc(S.saved.txn.client_name || S.saved.txn.client_id) + '.</b> ' + esc(S.saved.txn.action_label) + " · " + esc(S.saved.camp.name) + '</span><button type="button" class="lyr-btn" data-act="print-receipt">Print receipt</button></div>';
    h += '<form class="lyr-form" id="lyr-rec" autocomplete="off" novalidate>' +
      '<label><span>ID card</span><input name="client_id" value="' + esc(f.client_id) + '" placeholder="e.g. 123456M" autocapitalize="characters" spellcheck="false"></label>' +
      '<label><span>Name</span><input name="client_name" value="' + esc(f.client_name) + '" placeholder="Name and surname" autocapitalize="words"></label>' +
      '<div id="lyr-snap">' + snapHtml() + "</div>" +
      '<label><span>Campaign</span><select name="campaign_id"><option value="">Choose…</option>' + run.map(function (c) { return '<option value="' + esc(c.id) + '"' + (c.id === f.campaign_id ? " selected" : "") + ">" + esc(c.name) + " (" + esc(kind(c.type).name) + ")</option>"; }).join("") + "</select></label>" +
      '<h2 id="lyr-ih">What they bought</h2>' +
      (f.items.length ? '<ul class="lyr-items" aria-labelledby="lyr-ih">' + f.items.map(function (it, i) { return '<li><span>' + esc(it.desc) + '</span><em>× ' + esc(it.qty) + '</em><button type="button" class="lyr-lnk" data-act="item-rm" data-i="' + i + '" aria-label="' + esc("Take off " + it.desc) + '">Take off</button></li>'; }).join("") + "</ul>" : "") +
      '<div class="lyr-add"><label><span class="lyr-sr">Item</span><input name="item_desc" list="lyr-itemlist" value="' + esc(f.item_desc) + '" placeholder="' + (f.items.length ? "Another item" : "Item, e.g. Uriage Xémose cream") + '" aria-label="Item"></label>' +
      '<label class="q"><span class="m" aria-hidden="true">How many</span><input name="item_qty" inputmode="numeric" value="' + esc(f.item_qty) + '" aria-label="How many"></label><button type="button" class="lyr-btn" data-act="item-add">Add</button></div>' +
      '<datalist id="lyr-itemlist">' + itemOpts() + "</datalist>" +
      '<label><span>Total €</span><input name="total" inputmode="decimal" value="' + esc(f.total) + '" placeholder="0.00"></label>' +
      '<label><span>Receipt no.</span><input name="receipt_no" value="' + esc(f.receipt_no) + '" placeholder="Optional"></label>' +
      '<label><span>Notes</span><input name="notes" value="' + esc(f.notes) + '" placeholder="Optional"></label>' +
      '<div class="lyr-acts">' + (f.client_id || f.client_name || f.items.length || f.item_desc || f.total ? '<button type="button" class="lyr-btn" data-act="clear" style="margin-right:auto">Clear</button>' : "") +
      '<button type="submit" class="lyr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record purchase") + "</button></div></form>";
    var recent = S.month.slice(0, 10);
    if (recent.length) {
      var cm = {}; S.camps.forEach(function (c) { cm[c.id] = c; });
      h += '<div class="lyr-lab" id="lyr-rh">Recent purchases</div><ul class="lyr-list" aria-labelledby="lyr-rh">' + recent.map(function (t) {
        return '<li><button type="button" class="lyr-row" data-act="card" data-card="' + esc(t.client_id) + '"><span class="t"><b>' + esc(t.client_name || t.client_id) + '</b><small>' + esc([(cm[t.campaign_id] || {}).name || "Campaign removed", t.action_label || "", Number(t.total) ? (E.eur ? E.eur(Number(t.total)) : "€" + Number(t.total).toFixed(2)) : ""].filter(Boolean).join(" · ")) + "</small></span><em>" + esc(dm(t.date)) + "</em></button></li>";
      }).join("") + "</ul>";
    }
    return h;
  }
  function addItem() {
    readForm(); var f = S.form, d = String(f.item_desc || "").trim();
    if (!d) { var el = S.mount.querySelector("#lyr-rec [name=item_desc]"); if (el) E.formErrors(S.mount.querySelector("#lyr-rec"), [{ field: el, msg: "Write the item first, then press Add." }], { cls: "lyr-ferr" }); return false; }
    f.items.push({ desc: d, qty: parseInt(f.item_qty, 10) || 1 }); f.item_desc = ""; f.item_qty = "1";
    paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-rec [name=item_desc]"); });
    return true;
  }
  async function lookUp() {
    readForm(); var k = normId(S.form.client_id); if (!k || k.length < 4) return;
    if (S.form.client_id !== k && /^\d{1,7}[A-Za-z]?$/.test(String(S.form.client_id).trim())) { S.form.client_id = k; var el = S.mount.querySelector("#lyr-rec [name=client_id]"); if (el && document.activeElement !== el) el.value = k; }
    var had = S.hist[k] && !S.hist[k].loading;
    if (!had) { repaintSnap(); await loadHist(k); }
    var h = S.hist[k], nm = S.mount && S.mount.querySelector("#lyr-rec [name=client_name]");
    if (h && h.rows.length && nm && !String(nm.value).trim() && h.rows[0].client_name) { nm.value = h.rows[0].client_name; S.form.client_name = nm.value; }
    repaintSnap();
  }
  function repaintSnap() { var b = S.mount && S.mount.querySelector("#lyr-snap"); if (b) b.innerHTML = snapHtml(); }

  async function record() {
    if (S.saving) return;
    readForm();
    var f = S.form, form = S.mount.querySelector("#lyr-rec"), probs = [];
    if (String(f.item_desc || "").trim()) { f.items.push({ desc: String(f.item_desc).trim(), qty: parseInt(f.item_qty, 10) || 1 }); f.item_desc = ""; f.item_qty = "1"; } // typed but not added: it counts
    var idCard = String(f.client_id || "").trim(), camp = S.camps.filter(function (c) { return c.id === f.campaign_id; })[0];
    if (!idCard) probs.push({ field: "client_id", msg: "Write the customer's ID card number." });
    if (!camp) probs.push({ field: "campaign_id", msg: "Choose the campaign." });
    if (!f.items.length) probs.push({ field: "item_desc", msg: "Write what they bought." });
    var totalRaw = String(f.total || "").trim().replace(",", ".");
    if (totalRaw && !/^\d+(\.\d{0,2})?$/.test(totalRaw)) probs.push({ field: "total", msg: "Write the total as a number, e.g. 12.50." });
    if (probs.length) { paint(); E.formErrors(S.mount.querySelector("#lyr-rec"), probs, { cls: "lyr-ferr" }); return; }
    var items = f.items.slice(), total = parseFloat(totalRaw) || 0, normIdc = normId(idCard) || idCard, name = String(f.client_name || "").trim();
    // the classic submitTransaction: its sums, its words, its body (the same keys in the same order)
    var stampsAwarded = 0, pointsAwarded = 0, actionLabel = "";
    if (camp.type === "stamp_card") { stampsAwarded = items.reduce(function (a, i) { return a + i.qty; }, 0); actionLabel = "Awarded " + stampsAwarded + " stamp" + (stampsAwarded !== 1 ? "s" : ""); }
    if (camp.type === "points") { pointsAwarded = Math.round((camp.points_per_unit || 1) * total); actionLabel = "Awarded " + pointsAwarded + " points"; }
    if (camp.type === "discount") actionLabel = "Applied " + (camp.discount_pct || 10) + "% discount";
    if (camp.type === "event") actionLabel = "Event purchase recorded";
    if (camp.type === "buy_x_get_y") actionLabel = "Purchase tracked (" + camp.buy_qty + " → " + camp.get_qty + " free)";
    if (camp.type === "tiered") actionLabel = "Spend recorded (€" + total.toFixed(2) + ")";
    var txn = { id: uid(), client_id: normIdc, client_name: name, campaign_id: camp.id, receipt_no: String(f.receipt_no || "").trim(), items: items, total: total, notes: String(f.notes || "").trim(),
      stamps_awarded: stampsAwarded, points_awarded: pointsAwarded, action: "record", action_label: actionLabel, date: today(), created_at: new Date().toISOString() };
    S.saving = true; S.err = ""; paint();
    try {
      var same = function (r) { return r.campaign_id === txn.campaign_id && String(r.receipt_no || "") === txn.receipt_no && Math.abs((Number(r.total) || 0) - total) < 0.005 && r.date === txn.date && JSON.stringify(r.items) === JSON.stringify(items); };
      var r = await E.postOnce("/loyalty/transactions", txn, { list: async function () { var x = await E.apiFetch("/loyalty/transactions?client=" + encodeURIComponent(normIdc), { method: "GET" }); return (x && x.transactions) || []; }, same: same });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
      lsSet(LAST, camp.id);
      S.saved = { txn: txn, camp: camp, items: items };
      S.form = fresh(camp.id); delete S.hist[normIdc]; S.clients = null;
      S.month.unshift({ client_id: normIdc, client_name: name, campaign_id: camp.id, action_label: actionLabel, date: txn.date, total: total, items: items });
      S.saving = false; paint();
      E.focusSoon(function () { return S.mount.querySelector("#lyr-rec [name=client_id]"); });
      // the saved line comes back from the server in the next read; this month's list is read again quietly
      E.apiFetch("/loyalty/transactions?month=" + today().slice(0, 7), { method: "GET" }).then(function (x) { if (x && x.ok) { S.month = x.transactions || []; } }).catch(function () {});
    } catch (x) {
      S.saving = false; paint();
      var fm = S.mount.querySelector("#lyr-rec"); if (fm) E.formErrors(fm, [{ field: "client_id", msg: E.saveFailText(x) }], { cls: "lyr-ferr" });
    }
  }

  // ---------- the classic prints, unchanged (modules.loyalty.js printReceipt and printClientHistory) ----------
  function cpad2(n) { return String(n).padStart(2, "0"); }
  function fmtTs(iso) { if (!iso) return ""; try { var d = new Date(iso); if (isNaN(d.getTime())) return iso; return cpad2(d.getDate()) + "/" + cpad2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + cpad2(d.getHours()) + ":" + cpad2(d.getMinutes()); } catch (e) { return iso; } }
  function safe(s) { return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
  function receiptHtml(txn, camp, items) {
    var conf = kind(camp.type);
    var itemsHtml = items.map(function (it) { return '<div class="row"><span>' + safe(it.desc) + '</span><span>&times;' + safe(it.qty) + "</span></div>"; }).join("");
    return '<!doctype html><html><head><meta charset="utf-8"><title>Loyalty Receipt</title>' +
      "<style>" +
      'body{font-family:"Courier New",monospace;margin:30px;font-size:13px;color:#111;}' +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      ".receipt{max-width:380px;margin:0 auto;border:1px dashed #aaa;border-radius:10px;padding:20px;}" +
      ".head{text-align:center;margin-bottom:14px;padding-bottom:12px;border-bottom:1px dashed #bbb;}" +
      ".head .camp{font-size:15px;font-weight:bold;}" +
      ".head .ts{font-size:11px;color:#666;}" +
      ".row{display:flex;justify-content:space-between;gap:10px;margin:3px 0;}" +
      ".divider{border-top:1px dashed #ccc;margin:8px 0;}" +
      ".foot{text-align:center;margin-top:14px;padding-top:12px;border-top:1px dashed #bbb;font-size:12px;color:#555;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      '<button data-eikon-print="print">&#128424; Print</button>' +
      '<div class="receipt">' +
      '<div class="head"><b>Loyalty Transaction</b><br><span class="camp">' + safe(camp.name) + '</span><br><span class="ts">' + safe(fmtTs(txn.created_at)) + "</span></div>" +
      '<div class="row"><span>Client:</span><b>' + safe(txn.client_name || txn.client_id) + "</b></div>" +
      '<div class="row"><span>ID Card:</span><span>' + safe(txn.client_id) + "</span></div>" +
      (txn.receipt_no ? '<div class="row"><span>Receipt No:</span><span>' + safe(txn.receipt_no) + "</span></div>" : "") +
      '<div class="divider"></div>' +
      itemsHtml +
      (txn.total ? '<div class="divider"></div><div class="row"><b>Total:</b><b>&euro;' + safe(txn.total.toFixed(2)) + "</b></div>" : "") +
      '<div class="divider"></div>' +
      '<div class="row"><span>' + safe(conf.icon + " " + conf.label) + ":</span><b>" + safe(txn.action_label) + "</b></div>" +
      (txn.notes ? '<div style="margin-top:6px;font-size:11px;color:#666;">Notes: ' + safe(txn.notes) + "</div>" : "") +
      '<div class="foot">Thank you for your loyalty! &#x1F49B;</div>' +
      "</div>" +
      "</body></html>";
  }
  function historyHtml(client, ctxns, campMap) {
    var rowsHtml = ctxns.slice().reverse().map(function (t) {
      var camp = campMap[t.campaign_id];
      var conf = camp ? kind(camp.type) : { icon: "", label: "" };
      var itemsText = (t.items || []).map(function (i) { return i.desc + " \xd7" + i.qty; }).join(", ");
      return "<tr>" +
        "<td>" + safe(fmtTs(t.created_at || t.date)) + "</td>" +
        "<td>" + (camp ? safe(conf.icon + " " + camp.name) : "&mdash;") + "</td>" +
        "<td>" + safe(itemsText) + "</td>" +
        "<td>" + safe(t.action_label || "") + "</td>" +
        "<td>" + safe(t.receipt_no || "") + "</td>" +
        "</tr>";
    }).join("");
    return '<!doctype html><html><head><meta charset="utf-8">' +
      "<title>Loyalty History &ndash; " + safe(client.name || client.id_card) + "</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;font-size:12px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;font-size:13px;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      "h1{margin:0 0 4px 0;font-size:18px;}" +
      ".meta{font-size:11px;color:#555;margin-bottom:12px;}" +
      "table{width:100%;border-collapse:collapse;}" +
      "th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;vertical-align:top;}" +
      "th{background:#f0f2f5;text-align:left;font-weight:800;}" +
      "tr:nth-child(even){background:#fafbfc;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      '<button data-eikon-print="print">&#128424; Print</button>' +
      "<h1>Loyalty History &ndash; " + safe(client.name || client.id_card) + "</h1>" +
      '<div class="meta">ID Card: ' + safe(client.id_card) + " &nbsp;&middot;&nbsp; Transactions: " + safe(String(ctxns.length)) + " &nbsp;&middot;&nbsp; Printed: " + safe(new Date().toLocaleString()) + "</div>" +
      (ctxns.length
        ? "<table><thead><tr><th>Date</th><th>Campaign</th><th>Items</th><th>Action</th><th>Receipt</th></tr></thead><tbody>" + rowsHtml + "</tbody></table>"
        : "<p>No transactions recorded for this client.</p>") +
      "</body></html>";
  }
  function printOut(html) {
    E.loyLastPrint = html;
    var w = E.openPrint ? E.openPrint(html, { delay: 250 }) : null;
    if (!w) E.toast("The print page was blocked. Allow pop-ups for this site, then press Print again.", "error");
  }

  // ---------- cards (the classic Clients tab) ----------
  function cardsHtml() {
    if (!S.clients) return S.clientsErr ? '<div class="lyr-quiet">' + esc(S.clientsErr) + ' <button type="button" class="lyr-lnk" data-act="cards-retry">Try again</button></div>' : (E.skeleton ? E.skeleton(4, "Opening the cards") : '<div class="lyr-quiet">Opening the cards…</div>');
    var cr = cardRows(), q = cr.q, rows = cr.rows;
    if (!S.clients.length) return '<div class="lyr-quiet">No loyalty cards yet. A card is made the first time you record a purchase for someone.</div>';
    return '<input class="lyr-q" id="lyr-q" type="search" aria-label="Find a card by name or ID card" aria-controls="lyr-cards" placeholder="Name or ID card" value="' + esc(S.q) + '"><div id="lyr-cbox">' + cardList(rows, q) + "</div>";
  }
  function cardList(rows, q) {
    if (!rows.length) return '<div id="lyr-cards" class="lyr-quiet">No card matches “' + esc(S.q) + '”. A card is made the first time you record a purchase for someone.</div>';
    var pg = E.listPage.take("lyr:cards", rows, { q: S.q, keep: S.open, idOf: function (c) { return c.id_card; } });
    return '<p class="lyr-sum" aria-live="polite"><b>' + rows.length + "</b> " + (rows.length === 1 ? "card" : "cards") + (q ? " found" : "") + "</p>" +
      '<ul class="lyr-list" id="lyr-cards" style="margin-top:8px">' + pg.rows.map(cardRow).join("") + "</ul>" + E.listPage.moreHtml("lyr:cards", pg, "lyr-btn");
  }
  function cardRows() {
    var q = fold(S.q).trim(), qi = String(S.q || "").replace(/\s+/g, "").toUpperCase();
    return { q: q, rows: (S.clients || []).filter(function (c) { return !q || fold(c.name).indexOf(q) >= 0 || String(c.id_card || "").toUpperCase().indexOf(qi) >= 0 || (qi && normId(qi) === c.id_card); }) };
  }
  function cardRow(c) {
    var on = S.open === c.id_card;
    var h = '<li><button type="button" class="lyr-row" data-act="open" data-card="' + esc(c.id_card) + '" aria-expanded="' + on + '"><span class="t"><b>' + esc(c.name || "No name") + "</b><small>" + esc(c.id_card) + "</small></span><em>" + (c.created_at ? "Card since " + esc(dm(c.created_at)) : "") + "</em></button>";
    if (on) h += cardInner(c);
    return h + "</li>";
  }
  function cardInner(c) {
    var hst = S.hist[normId(c.id_card)] || S.hist[c.id_card];
    var h = '<div class="lyr-in">';
    if (!hst || hst.loading) h += '<p class="lyr-sum">Opening the purchases…</p>';
    else if (hst.err) h += '<p class="lyr-sum">Could not open the purchases. <button type="button" class="lyr-lnk" data-act="open-retry" data-card="' + esc(c.id_card) + '">Try again</button></p>';
    else {
      var rows = hst.rows, cm = {}; S.camps.forEach(function (x) { cm[x.id] = x; });
      if (rows.length) {
        h += progress(rows, "");
        h += '<table class="lyr-hist"><caption class="lyr-sr">' + esc("Purchases on " + (c.name || c.id_card) + "'s card") + '</caption><thead><tr><th scope="col">Date</th><th scope="col">Campaign</th><th scope="col">Items</th><th scope="col">What it gave</th><th scope="col">Receipt</th></tr></thead><tbody>' +
          rows.map(function (t) { return "<tr><td>" + esc(dm(t.date)) + "</td><td>" + esc((cm[t.campaign_id] || {}).name || "Campaign removed") + "</td><td>" + esc((t.items || []).map(function (i) { return i.desc + " ×" + i.qty; }).join(", ")) + "</td><td>" + esc(t.action_label || "") + "</td><td>" + esc(t.receipt_no || "") + "</td></tr>"; }).join("") + "</tbody></table>";
      } else h += '<p class="lyr-sum">No purchases on this card yet.</p>';
    }
    h += '<div class="a"><button type="button" class="lyr-btn p" data-act="rec-for" data-card="' + esc(c.id_card) + '">Record a purchase</button>' +
      (hst && hst.rows && hst.rows.length ? '<button type="button" class="lyr-lnk" data-act="print-hist" data-card="' + esc(c.id_card) + '">Print history</button>' : "") +
      (isAdmin() ? '<button type="button" class="lyr-lnk d r" data-act="rm-card" data-card="' + esc(c.id_card) + '">Remove card</button>' : "") + "</div>";
    var q = S.ask;
    if (q && q.kind === "card" && q.id === c.id_card) {
      var n = hst && hst.rows ? hst.rows.length : 0;
      h += '<div class="lyr-ask" role="group" aria-label="Remove this card"><b>Remove ' + esc(c.name || c.id_card) + "’s loyalty card?</b> The card and " + (n ? "its " + n + (n === 1 ? " purchase go" : " purchases go") : "its history go") + " for good: stamps and points cannot be brought back. The audit keeps a note that it was removed." +
        (q.err ? '<div class="lyr-err" role="alert">' + esc(q.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="lyr-btn" data-act="ask-no">Keep the card</button><button type="button" class="lyr-btn p" data-act="rm-card-yes"' + (q.busy ? " disabled" : "") + ">" + (q.busy ? "Removing…" : "Remove the card") + "</button></div></div>";
    }
    return h + "</div>";
  }

  // ---------- campaigns ----------
  function campsHtml() {
    if (S.edit) return campForm();
    var h = "", list = S.camps;
    if (list.length > 6) h += '<input class="lyr-q" id="lyr-cq" type="search" aria-label="Find a campaign" aria-controls="lyr-camps" placeholder="Campaign or brand" value="' + esc(S.cq) + '">';
    var q = fold(S.cq).trim();
    if (q) list = list.filter(function (c) { return fold(c.name).indexOf(q) >= 0 || fold(c.brand).indexOf(q) >= 0 || fold(c.description).indexOf(q) >= 0; });
    if (!S.camps.length) return h + '<div class="lyr-quiet">No campaign yet. Press New campaign to start a stamp card, points or an offer.</div>';
    if (!list.length) return h + '<div class="lyr-quiet" id="lyr-camps">No campaign matches “' + esc(S.cq) + "”.</div>";
    var order = { active: 0, open: 0, upcoming: 1, inactive: 2, ended: 3 };
    list = list.slice().sort(function (a, b) { return order[status(a)] - order[status(b)]; });
    return h + '<ul class="lyr-list" id="lyr-camps" style="margin-top:16px">' + list.map(campRow).join("") + "</ul>";
  }
  function campRow(c) {
    var sw = statusWords(c), k = kind(c.type);
    var h = '<li><div class="lyr-row" style="cursor:default"><span class="t"><b>' + esc(c.name) + '</b><small>' + esc(k.name + " · " + gives(c)) + "</small>" + (c.description ? "<small>" + esc(c.description) + "</small>" : "") + '</span><span class="lyr-st ' + (sw[1] || "x") + '">' + esc(sw[0]) + "</span></div>" +
      '<div class="lyr-in" style="padding-top:0"><div class="a"><button type="button" class="lyr-lnk" data-act="edit-camp" data-id="' + esc(c.id) + '" aria-label="' + esc("Edit " + c.name) + '">Edit</button>' +
      '<button type="button" class="lyr-lnk" data-act="toggle-camp" data-id="' + esc(c.id) + '" aria-label="' + esc((c.active ? "Pause " : "Start ") + c.name) + '">' + (c.active ? "Pause" : "Start") + "</button>" +
      (isAdmin() ? '<button type="button" class="lyr-lnk d r" data-act="del-camp" data-id="' + esc(c.id) + '" aria-label="' + esc("Delete " + c.name) + '">Delete</button>' : "") + "</div>";
    var q = S.ask;
    if (q && q.kind === "camp" && q.id === c.id) h += '<div class="lyr-ask" role="group" aria-label="Delete this campaign"><b>Delete “' + esc(c.name) + '”?</b> It goes from the list for good. Purchases already recorded stay on the customers’ cards. To stop it for now, press Pause instead.' +
      (q.err ? '<div class="lyr-err" role="alert">' + esc(q.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="lyr-btn" data-act="ask-no">Keep it</button><button type="button" class="lyr-btn p" data-act="del-camp-yes"' + (q.busy ? " disabled" : "") + ">" + (q.busy ? "Deleting…" : "Delete the campaign") + "</button></div></div>";
    return h + "</div></li>";
  }
  function campForm() {
    var e = S.edit, c = e.c, t = e.type;
    var fld = function (n, label, val, extra) { return '<label><span>' + label + '</span><input name="' + n + '" value="' + esc(val) + '"' + (extra || "") + "></label>"; };
    var h = '<form class="lyr-form" id="lyr-camp" autocomplete="off" novalidate><h2 style="font-size:17px;color:var(--text);font-weight:700;margin-top:10px">' + (e.isEdit ? "Edit " + esc(c.name) : "New campaign") + "</h2>" +
      '<fieldset class="lyr-kinds"><legend>Kind of campaign</legend><div class="g">' + KINDS.map(function (k) {
        return '<label class="lyr-kind"><input type="radio" name="type" value="' + k.v + '"' + (k.v === t ? " checked" : "") + '><span><b>' + esc(k.name) + "</b><small>" + esc(k.desc) + "</small></span></label>";
      }).join("") + "</div></fieldset>" +
      fld("name", "Name", e.v.name, ' placeholder="e.g. Uriage loyalty card"') +
      fld("brand", "Brand", e.v.brand, ' placeholder="e.g. Uriage (optional)"') +
      fld("items", "Items", e.v.items, ' placeholder="Empty: all the brand’s items"') +
      '<label><span>Description</span><textarea name="description" placeholder="What the customer earns (optional)">' + esc(e.v.description) + "</textarea></label>";
    if (t === "stamp_card") h += fld("stamp_target", "Stamps needed", e.v.stamp_target, ' inputmode="numeric"') + fld("reward", "Reward", e.v.reward, ' placeholder="e.g. One free full-size product"');
    if (t === "points") h += fld("points_per_unit", "Points per €1", e.v.points_per_unit, ' inputmode="decimal"') + fld("redeem_threshold", "Points needed", e.v.redeem_threshold, ' inputmode="numeric"') + fld("pts_reward", "Reward", e.v.pts_reward, ' placeholder="e.g. €5 voucher"');
    if (t === "discount") h += fld("discount_pct", "Discount %", e.v.discount_pct, ' inputmode="decimal"') + fld("discount_scope", "On", e.v.discount_scope, ' placeholder="e.g. All the brand’s items"');
    if (t === "event") h += fld("event_name", "Offer name", e.v.event_name, ' placeholder="e.g. Black Friday 2026"') + fld("event_offer", "Offer", e.v.event_offer, ' placeholder="e.g. 20% off all purchases"');
    if (t === "buy_x_get_y") h += fld("buy_qty", "Buy", e.v.buy_qty, ' inputmode="numeric"') + fld("get_qty", "Get free", e.v.get_qty, ' inputmode="numeric"') + fld("bxgy_reward", "Free item", e.v.bxgy_reward, ' placeholder="e.g. The cheapest one free"');
    if (t === "tiered") {
      h += '<h2 id="lyr-th">Spend levels (up to 4)</h2>' + e.tiers.map(function (tr, i) {
        return '<div class="lyr-tier" role="group" aria-label="' + "Level " + (i + 1) + '"><label class="s"><span>From €</span><input name="tier_spend_' + i + '" inputmode="decimal" value="' + esc(tr.spend) + '" placeholder="50"></label><label class="w"><span class="lyr-sr">Reward</span><input name="tier_reward_' + i + '" value="' + esc(tr.reward) + '" placeholder="Reward, e.g. 5% off" aria-label="' + "Reward at level " + (i + 1) + '"></label><button type="button" class="lyr-lnk d" data-act="tier-rm" data-i="' + i + '" aria-label="' + "Take off level " + (i + 1) + '">Take off</button></div>';
      }).join("") + (e.tiers.length < 4 ? '<div class="lyr-acts" style="justify-content:flex-start;border-top:.5px solid var(--border)"><button type="button" class="lyr-btn" data-act="tier-add">Add a level</button></div>' : "");
    }
    h += '<label class="lyr-chk"><input type="checkbox" name="open_ended"' + (e.v.open_ended ? " checked" : "") + "> No end date</label>";
    if (!e.v.open_ended) h += fld("start_date", "Starts", e.v.start_date, ' type="date"') + fld("end_date", "Ends", e.v.end_date, ' type="date"');
    h += '<label class="lyr-chk"><input type="checkbox" name="active"' + (e.v.active ? " checked" : "") + "> Running (untick to pause it)</label>" +
      '<div class="lyr-acts"><button type="button" class="lyr-btn" data-act="camp-cancel">Cancel</button><button type="submit" class="lyr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save campaign") + "</button></div></form>";
    return h;
  }
  // The values the classic form shows for a campaign (its defaults when a field is empty).
  function campValues(c) {
    return { name: c.name || "", brand: c.brand || "", items: c.items || "", description: c.description || "", open_ended: !!c.open_ended, active: !!c.active,
      start_date: c.start_date || today(), end_date: c.end_date || "", stamp_target: c.stamp_target || 10, reward: c.reward || "", points_per_unit: c.points_per_unit || 1, redeem_threshold: c.redeem_threshold || 100,
      pts_reward: c.reward || "", discount_pct: c.discount_pct || 10, discount_scope: c.discount_scope || "", event_name: c.event_name || "", event_offer: c.event_offer || "",
      buy_qty: c.buy_qty || 3, get_qty: c.get_qty || 1, bxgy_reward: c.reward || "" };
  }
  function openEdit(c) {
    var isEdit = !!c; c = c || { id: uid(), active: true, type: "stamp_card", open_ended: true };
    // the classic bindTieredFields: the campaign's levels, or three to start from
    var tiers = c.tiers && c.tiers.length ? c.tiers.map(function (x) { return Object.assign({}, x); }) : [{ spend: 50, reward: "" }, { spend: 100, reward: "" }, { spend: 200, reward: "" }];
    S.edit = { isEdit: isEdit, c: c, type: c.type || "stamp_card", v: campValues(c), tiers: tiers };
  }
  function readCamp() {
    var f = S.mount && S.mount.querySelector("#lyr-camp"), e = S.edit; if (!f || !e) return;
    Array.prototype.forEach.call(f.querySelectorAll("input,textarea"), function (el) {
      var n = el.name; if (!n) return;
      var m = /^tier_(spend|reward)_(\d+)$/.exec(n);
      if (m) { var tr = e.tiers[Number(m[2])]; if (tr && String(tr[m[1]]) !== el.value) tr[m[1]] = el.value; return; } // a level typed in becomes text, as the classic change handler stores it
      if (el.type === "radio") { if (el.checked) e.type = el.value; return; }
      e.v[n] = el.type === "checkbox" ? el.checked : el.value;
    });
  }
  async function saveCamp() {
    if (S.saving) return;
    readCamp();
    var e = S.edit, v = e.v, f = S.mount.querySelector("#lyr-camp");
    var tv = function (k) { return String(v[k] == null ? "" : v[k]).trim(); };
    var probs = [];
    if (!tv("name")) probs.push({ field: "name", msg: "Write the campaign's name." });
    if (!v.open_ended && tv("start_date") && tv("end_date") && tv("end_date") < tv("start_date")) probs.push({ field: "end_date", msg: "The end date is before the start." });
    if (probs.length) { E.formErrors(f, probs, { cls: "lyr-ferr" }); return; }
    var type = e.type, openEnded = !!v.open_ended;
    // the classic collectCampForm: its keys, in its order, with its defaults
    var data = { id: e.c.id || uid(), name: tv("name"), brand: tv("brand"), items: tv("items"), description: tv("description"), type: type, active: !!v.active, open_ended: openEnded,
      start_date: openEnded ? "" : tv("start_date"), end_date: openEnded ? "" : tv("end_date"), created_at: new Date().toISOString() };
    if (type === "stamp_card") { data.stamp_target = parseInt(tv("stamp_target")) || 10; data.reward = tv("reward"); }
    if (type === "points") { data.points_per_unit = parseFloat(tv("points_per_unit")) || 1; data.redeem_threshold = parseInt(tv("redeem_threshold")) || 100; data.reward = tv("pts_reward"); }
    if (type === "discount") { data.discount_pct = parseFloat(tv("discount_pct")) || 10; data.discount_scope = tv("discount_scope"); }
    if (type === "event") { data.event_name = tv("event_name"); data.event_offer = tv("event_offer"); }
    if (type === "buy_x_get_y") { data.buy_qty = parseInt(tv("buy_qty")) || 3; data.get_qty = parseInt(tv("get_qty")) || 1; data.reward = tv("bxgy_reward"); }
    if (type === "tiered") data.tiers = e.tiers;
    S.saving = true; paint();
    try {
      var r = await E.apiFetch("/loyalty/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
      S.saving = false; S.edit = null; E.toast((e.isEdit ? "Saved · " : "Started · ") + data.name, "success");
      await load(); var b = S.mount.querySelector('[data-act=edit-camp][data-id="' + data.id + '"]'); if (b) b.focus();
    } catch (x) { S.saving = false; paint(); var f2 = S.mount.querySelector("#lyr-camp"); if (f2) E.formErrors(f2, [{ field: "name", msg: E.saveFailText(x) }], { cls: "lyr-ferr" }); }
  }
  async function toggleCamp(id) {
    var c = S.camps.filter(function (x) { return x.id === id; })[0]; if (!c || S.saving) return;
    var body = Object.assign({}, c); body.active = !c.active; // the classic toggle: the whole campaign as loaded, active flipped
    S.saving = true;
    try {
      var r = await E.apiFetch("/loyalty/campaigns/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
      E.toast(body.active ? c.name + " is running" : c.name + " is paused", "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.saving = false; await load(); var b = S.mount.querySelector('[data-act=toggle-camp][data-id="' + id + '"]'); if (b) b.focus();
  }
  async function delCamp() {
    var q = S.ask; if (!q || q.busy) return; q.busy = true; q.err = ""; paint();
    try {
      var r = await E.apiFetch("/loyalty/campaigns/" + encodeURIComponent(q.id), { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not deleted");
      var c = S.camps.filter(function (x) { return x.id === q.id; })[0]; S.ask = null; E.toast("Deleted · " + ((c && c.name) || "campaign"), "success"); await load();
      E.focusSoon(function () { return S.mount.querySelector("[data-act=new-camp]"); });
    } catch (x) { q.busy = false; q.err = String(E.saveFailText(x)).replace(/^Not saved/, "Not deleted"); paint(); }
  }
  async function rmCard() {
    var q = S.ask; if (!q || q.busy) return; q.busy = true; q.err = ""; paint();
    try {
      var r = await E.apiFetch("/loyalty/clients/" + encodeURIComponent(q.id), { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not removed");
      S.ask = null; S.open = null; delete S.hist[normId(q.id)]; E.toast("Card removed", "success");
      await loadClients(true); paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-q"); });
    } catch (x) { q.busy = false; q.err = String(E.saveFailText(x)).replace(/^Not saved/, "Not removed"); paint(); }
  }

  // ---------- the screen ----------
  function summary() {
    var run = S.camps.filter(running).length, t = today(), n = S.month.filter(function (x) { return x.date === t; }).length;
    return '<p class="lyr-sum"><b>' + run + "</b> " + (run === 1 ? "campaign" : "campaigns") + " running · <b>" + n + "</b> " + (n === 1 ? "purchase" : "purchases") + " today · <b>" + S.month.length + "</b> this month</p>";
  }
  function seg() {
    return '<div class="lyr-seg" role="group" aria-label="Show">' + [["record", "Record"], ["cards", "Cards"], ["campaigns", "Campaigns"]].map(function (x) {
      return '<button type="button" class="lyr-seg-b" data-act="view" data-v="' + x[0] + '" aria-pressed="' + (S.view === x[0]) + '">' + x[1] + "</button>";
    }).join("") + "</div>";
  }
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== ID) return; // left before a reply came back
    var top = S.view === "campaigns" && !S.edit ? '<button type="button" class="lyr-btn p" data-act="new-camp">New campaign</button>' : "";
    var h = '<div class="lyr"><button class="lyr-back" data-act="back">' + esc(E.ui2BackLabel(ID)) + "</button>" +
      '<div class="lyr-top"><div><h1 tabindex="-1">Loyalty</h1><p class="lyr-sub">Stamp cards, points and offers for regular customers.</p></div>' + top + "</div>" +
      '<div class="lyr-menu"><button type="button" class="lyr-btn lyr-more" data-act="menu" aria-haspopup="true" aria-expanded="' + !!S.menu + '" aria-label="More">⋯</button>' +
      (S.menu ? '<div class="list" role="menu"><button type="button" role="menuitem" data-act="classic">Classic Loyalty screen</button></div>' : "") + "</div>";
    if (S.loading && !S.camps.length && !S.error) h += E.skeleton ? E.skeleton(4, "Opening loyalty") : '<div class="lyr-quiet">Opening loyalty…</div>';
    else if (S.error) h += '<div class="lyr-quiet">' + esc(S.error) + ' <button type="button" class="lyr-lnk" data-act="retry">Try again</button></div>';
    else {
      h += summary() + seg();
      if (S.view === "record") h += recordHtml();
      else if (S.view === "cards") h += cardsHtml();
      else h += campsHtml();
      if (S.view === "cards" && isAdmin()) h += '<p class="lyr-foot">Removing a card deletes its stamps, points and history for good.</p>';
      else if (S.view !== "record" && !isAdmin()) h += '<p class="lyr-foot">Deleting a campaign or removing a card is for the pharmacist.</p>';
    }
    h += "</div>";
    var ae = document.activeElement, sel = ae && m.contains(ae) ? (ae.id ? "#" + ae.id : ae.name ? "[name=" + ae.name + "]" : "") : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } }
    wire(m);
  }
  function wire(m) {
    var root = m.querySelector(".lyr"); if (!root) return;
    root.addEventListener("click", onClick);
    var rec = m.querySelector("#lyr-rec");
    if (rec) {
      rec.addEventListener("submit", function (ev) { ev.preventDefault(); record(); });
      var idf = rec.querySelector("[name=client_id]"), item = rec.querySelector("[name=item_desc]"), camp = rec.querySelector("[name=campaign_id]");
      idf.addEventListener("change", lookUp);
      idf.addEventListener("input", function () { if (S.saved) { S.saved = null; var d = m.querySelector(".lyr-done"); if (d) d.parentNode.removeChild(d); } });
      camp.addEventListener("change", function () { readForm(); repaintSnap(); });
      item.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); if (String(item.value).trim()) addItem(); } });
      item.addEventListener("focus", loadItems, { once: true });
      rec.addEventListener("input", function () { readForm(); });
      if (E.personPick) try {
        E.personPick.attach({ key: ID, form: rec, fields: { id: "client_id", name: "client_name" }, idValue: normId,
          local: function () { return (S.clients || []).map(function (c) { return { name: c.name, id_card: c.id_card, from: "loyalty card", date: String(c.created_at || "").slice(0, 10) }; }); },
          onFill: function () { readForm(); lookUp(); } });
      } catch (e) {}
    }
    var cf = m.querySelector("#lyr-camp");
    if (cf) {
      cf.addEventListener("submit", function (ev) { ev.preventDefault(); saveCamp(); });
      cf.addEventListener("change", function (ev) { var n = ev.target && ev.target.name; if (n === "type" || n === "open_ended") { readCamp(); paint(); var x = m.querySelector('#lyr-camp [name="' + n + '"]' + (n === "type" ? ":checked" : "")); if (x) x.focus(); } });
      cf.addEventListener("input", function () { readCamp(); });
      cf.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); closeEdit(); } });
    }
    var q = m.querySelector("#lyr-q");
    // only the list follows the typing (the field keeps its focus and cursor)
    if (q) q.addEventListener("input", function () { S.q = q.value; S.open = null; var bx = m.querySelector("#lyr-cbox"), cr = cardRows(); if (bx) bx.innerHTML = cardList(cr.rows, cr.q); });
    if (q) q.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { var b = m.querySelectorAll("#lyr-cards [data-act=open]"); if (b.length === 1) { ev.preventDefault(); b[0].click(); } } });
    var cq = m.querySelector("#lyr-cq");
    if (cq) cq.addEventListener("input", function () { S.cq = cq.value; paint(); });
    root.addEventListener("keydown", function (ev) {
      if (ev.key !== "Escape") return;
      if (S.menu) { ev.preventDefault(); S.menu = false; paint(); var mb = m.querySelector("[data-act=menu]"); if (mb) mb.focus(); }
      else if (S.ask && !S.ask.busy && ev.target.closest && ev.target.closest(".lyr-ask")) { ev.preventDefault(); askNo(); }
    });
  }
  function closeEdit() { var id = S.edit && S.edit.isEdit ? S.edit.c.id : ""; S.edit = null; paint(); E.focusSoon(function () { return (id && S.mount.querySelector('[data-act=edit-camp][data-id="' + id + '"]')) || S.mount.querySelector("[data-act=new-camp]"); }); }
  function askNo() { var q = S.ask; S.ask = null; paint(); if (q) E.focusSoon(function () { return S.mount.querySelector(q.kind === "camp" ? '[data-act=del-camp][data-id="' + q.id + '"]' : '[data-act=rm-card][data-card="' + q.id + '"]'); }); }
  function setView(v) {
    if (S.view === "record") readForm();
    S.view = v; S.ask = null; S.menu = false; paint();
    var b = S.mount.querySelector('[data-act=view][data-v="' + v + '"]'); if (b) b.focus();
    if (v === "cards" && !S.clients) loadClients().then(function () { if (S.view === "cards") { paint(); var b2 = S.mount.querySelector('[data-act=view][data-v="cards"]'); if (b2 && document.activeElement === document.body) b2.focus(); } });
  }
  async function openCard(card) {
    S.open = S.open === card ? null : card; S.ask = null; paint();
    var b = S.mount.querySelector('[data-act=open][data-card="' + card + '"]'); if (b) b.focus();
    if (S.open) { await loadHist(card); if (S.open === card && S.view === "cards") { paint(); var b2 = S.mount.querySelector('[data-act=open][data-card="' + card + '"]'); if (b2) b2.focus(); } }
  }
  function onClick(ev) {
    var b = ev.target && ev.target.closest && ev.target.closest("[data-act]"); if (!b || !S.mount.contains(b)) return;
    var a = b.getAttribute("data-act"), card = b.getAttribute("data-card"), id = b.getAttribute("data-id");
    if (a === "back") { window.location.hash = E.ui2BackHash(ID); return; }
    if (a === "menu") { S.menu = !S.menu; paint(); var mi = S.mount.querySelector(S.menu ? ".lyr-menu .list button" : "[data-act=menu]"); if (mi) mi.focus(); return; }
    if (S.menu && a !== "classic") { S.menu = false; }
    if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", ID); } catch (x) {} E.openClassic("loyalty"); return; }
    if (a === "retry") { load(); return; }
    if (a === "view") { setView(b.getAttribute("data-v")); return; }
    if (a === "item-add") { addItem(); return; }
    if (a === "item-rm") { readForm(); S.form.items.splice(Number(b.getAttribute("data-i")), 1); paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-rec [name=item_desc]"); }); return; }
    if (a === "clear") { S.form = fresh(S.form.campaign_id); S.saved = null; paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-rec [name=client_id]"); }); return; }
    if (a === "print-receipt" && S.saved) { printOut(receiptHtml(S.saved.txn, S.saved.camp, S.saved.items)); return; }
    if (a === "card") { S.view = "cards"; S.q = card; S.open = null; loadClients().then(function () { if (S.view === "cards") openCard(card); }); paint(); return; }
    if (a === "cards-retry") { loadClients(true).then(paint); return; }
    if (a === "open") { openCard(card); return; }
    if (a === "open-retry") { delete S.hist[normId(card)]; S.open = null; openCard(card); return; }
    if (a === "rec-for") { var c = (S.clients || []).filter(function (x) { return x.id_card === card; })[0] || { id_card: card, name: "" }; S.form = fresh(); S.form.client_id = c.id_card; S.form.client_name = c.name || ""; S.saved = null; S.view = "record"; paint(); lookUp(); E.focusSoon(function () { var s = S.mount.querySelector("#lyr-rec [name=campaign_id]"); return s && !s.value ? s : S.mount.querySelector("#lyr-rec [name=item_desc]"); }); return; }
    if (a === "print-hist") { var cl = (S.clients || []).filter(function (x) { return x.id_card === card; })[0] || { id_card: card, name: "" }, hs = S.hist[normId(card)], cm = {}; S.camps.forEach(function (x) { cm[x.id] = x; });
      // the classic history lists the card's purchases oldest last (it reverses the order it loaded, oldest first)
      printOut(historyHtml(cl, hs ? hs.rows : [], cm)); return; } // newest first, as the classic loads them (its print turns them round)
    if (a === "rm-card") { if (!isAdmin()) return; S.ask = { kind: "card", id: card }; paint(); E.focusSoon(function () { return S.mount.querySelector("[data-act=rm-card-yes]"); }); return; }
    if (a === "rm-card-yes") { rmCard(); return; }
    if (a === "ask-no") { askNo(); return; }
    if (a === "new-camp") { S.view = "campaigns"; openEdit(null); paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-camp [name=name]"); }); return; }
    if (a === "edit-camp") { var cc = S.camps.filter(function (x) { return x.id === id; })[0]; if (cc) { openEdit(cc); paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-camp [name=name]"); }); } return; }
    if (a === "camp-cancel") { closeEdit(); return; }
    if (a === "toggle-camp") { toggleCamp(id); return; }
    if (a === "del-camp") { if (!isAdmin()) return; S.ask = { kind: "camp", id: id }; paint(); E.focusSoon(function () { return S.mount.querySelector("[data-act=del-camp-yes]"); }); return; }
    if (a === "del-camp-yes") { delCamp(); return; }
    if (a === "tier-add") { readCamp(); if (S.edit.tiers.length < 4) S.edit.tiers.push({ spend: "", reward: "" }); paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-camp [name=tier_spend_" + (S.edit.tiers.length - 1) + "]"); }); return; }
    if (a === "tier-rm") { readCamp(); S.edit.tiers.splice(Number(b.getAttribute("data-i")), 1); paint(); E.focusSoon(function () { return S.mount.querySelector("#lyr-camp [data-act=tier-add]") || S.mount.querySelector("#lyr-camp [name=name]"); }); return; }
    if (a === "q58-more") { E.listPage.more(b.getAttribute("data-key")); paint(); return; }
  }

  E.registerModule({
    id: ID, title: "Loyalty", order: 3, icon: "✦", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; css();
      S.view = "record"; S.ask = null; S.edit = null; S.menu = false; S.saved = null; S.open = null; S.q = ""; S.cq = ""; S.hist = {}; S.clients = null; S.items = null; S.form = null;
      E.listPage.reset("lyr");
      // A customer's page hands over its person: "new" opens Record with them filled in, "find" opens their card.
      var hand = E.takeCustomerHandoff ? E.takeCustomerHandoff(ID) : null;
      var p = load().then(function () {
        if (!hand || !hand.person) return;
        var pc = normId(hand.person.id_card || "");
        if (hand.mode === "find" && pc) { S.view = "cards"; S.q = pc; loadClients().then(function () { var hit = (S.clients || []).filter(function (c) { return c.id_card === pc; })[0]; if (hit) openCard(hit.id_card); else paint(); }); paint(); }
        else { S.form = fresh(); S.form.client_id = pc; S.form.client_name = hand.person.name || ""; paint(); if (pc) lookUp(); }
      });
      return p;
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  if (E.UI2_PARENT) E.UI2_PARENT[ID] = "customers";
  if (E.UI2_NATIVE) E.UI2_NATIVE.loyalty = ID; // the classic Loyalty opens here in the new layout; ⋯ keeps the classic one
})();
