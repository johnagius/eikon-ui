/* ============================================================
   EIKON — Distributor and head-office portals, new layout  (modules.portals.js)
   The supplier portal (locations 400-599) and the head office (600-900) in the same calm design as the pharmacy:
   the same rail (a bottom bar on a phone), a Today that says what needs doing, one job per screen.
   Rights and saved bodies are the classic screens' own: the same endpoints, the same request bodies (each save is
   commented with the classic function it copies). The classic screens stay one tap away ("⋯ Classic screen").
   core.js (E.PORTALS) decides which screens a portal has; this file draws them.
     Distributor: suphome (Today), suporders (Orders), supproblems (Problems), supproducts (Products), ptlacct (Account)
     Head office: hqhome (Today), ownreg (How we're doing, modules.ownreg.js), hqregs (Registers), hqclient (org 12 only)
   Reads: what the classic screens read, at most once a minute while the tab is visible (the classic ones every 30 s).
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  // The classic Order Feedback screen's answers, stored as they are; shown in sentence case.
  var ANSWERS = ["Acknowledged", "Replacement Sent", "Credit Issued", "Disputed", "Resolved"];
  var REFRESH = 60000;

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function sentence(s) { s = String(s || ""); return s ? s.charAt(0) + s.slice(1).toLowerCase() : ""; }
  function today() { return E.maltaYmd(); }
  function addDays(ymd, n) { var d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5); }
  function nice(ymd, wk) { var p = String(ymd || "").split("-"); if (p.length !== 3) return String(ymd || ""); var s = Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0]; return wk ? WD[new Date(ymd + "T12:00:00Z").getUTCDay()] + " " + s : s; }
  // A server stamp ("2026-11-11 17:02:57", UTC) as Malta's day and clock.
  function stamp(s) { if (!s) return null; var d = new Date(String(s).replace(" ", "T") + (/[zZ]|[+-]\d\d:?\d\d$/.test(s) ? "" : "Z")); return isFinite(d.getTime()) ? d : null; }
  function when(s) {
    var d = stamp(s); if (!d) return "";
    var day = E.maltaYmd(d), t = today(), n = diffDays(day, t), hm = E.maltaHm(d);
    if (n === 0) return "today " + hm; if (n === 1) return "yesterday " + hm;
    return nice(day, true) + ", " + hm;
  }
  // A product's expiry as a day: the classic list holds ISO days and typed ones ("31/01/2027", "01/2027").
  function expDay(v) {
    v = String(v || "").trim(); var m;
    if ((m = v.match(/^(\d{4})-(\d{2})-(\d{2})/))) return m[1] + "-" + m[2] + "-" + m[3];
    if ((m = v.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/))) return m[3] + "-" + ("0" + m[2]).slice(-2) + "-" + ("0" + m[1]).slice(-2);
    if ((m = v.match(/^(\d{1,2})[\/.-](\d{4})$/))) { var y = Number(m[2]), mo = Number(m[1]); return new Date(Date.UTC(y, mo, 0)).toISOString().slice(0, 10); }
    if ((m = v.match(/^(\d{4})-(\d{2})$/))) return new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).toISOString().slice(0, 10);
    return "";
  }
  function expiryChip(p) {
    var d = expDay(p.expiry_date); if (!d) return "";
    var n = diffDays(today(), d);
    if (n < 0) return '<em class="ptl-chip bad">Expired ' + esc(nice(d)) + "</em>";
    if (n <= 30) return '<em class="ptl-chip bad">Expires in ' + n + (n === 1 ? " day" : " days") + "</em>";
    if (n <= 90) return '<em class="ptl-chip warn">Expires ' + esc(nice(d)) + "</em>";
    return "";
  }
  function eur(n) { return E.eur ? E.eur(n) : "€" + (Number(n) || 0).toFixed(2); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }
  function errText(e) { return e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e.error)) || "Something did not load. Try again."); }
  function user() { return E.state.user || {}; }

  function css() {
    if (document.getElementById("eikon-portals-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-portals-css";
    st.textContent =
      ".ptl{max-width:980px;margin:0 auto}" +
      ".ptl-back{display:inline-flex;align-items:center;min-height:44px;border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 8px 0 0;margin:-8px 0 -2px;cursor:pointer}" +
      ".ptl-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".ptl h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.ptl-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;line-height:1.45;max-width:640px}" +
      ".ptl-btn{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".ptl-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.ptl-btn.bad{color:var(--danger)}.ptl-btn:disabled{opacity:.55;cursor:default}.ptl-btn:active:not(:disabled){filter:brightness(.9)}" +
      ".ptl-lab{font-size:13px;font-weight:600;color:var(--muted);margin:22px 2px 8px;display:flex;gap:8px;align-items:baseline}.ptl-lab b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".ptl-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".ptl-row{display:flex;align-items:center;gap:12px;width:100%;text-align:left;font:inherit;color:var(--text);background:transparent;border:0;border-top:.5px solid var(--border);padding:12px 16px;min-height:56px;cursor:default}" +
      ".ptl-row:first-child{border-top:0}button.ptl-row{cursor:pointer}button.ptl-row:hover{background:rgba(118,118,128,.06)}button.ptl-row:active{background:rgba(118,118,128,.12)}" +
      ".ptl-row .w{flex:1;min-width:0}.ptl-row b{display:block;font-size:15px;font-weight:600}.ptl-row .s{display:block;font-size:13px;color:var(--muted);margin-top:2px;line-height:1.4}" +
      ".ptl-row .n{font-variant-numeric:tabular-nums;white-space:nowrap;font-size:14px}.ptl-row .acts{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}" +
      "button.ptl-row::after{content:'';flex:none;width:7px;height:7px;border-right:2px solid rgba(118,118,128,.5);border-top:2px solid rgba(118,118,128,.5);transform:rotate(45deg)}" +
      ".ptl-chip{display:inline-block;font-style:normal;font-size:12px;font-weight:600;border-radius:8px;padding:2px 8px;margin:4px 6px 0 0;background:rgba(118,118,128,.12);color:var(--muted)}" +
      ".ptl-chip.bad{background:rgba(196,34,26,.10);color:var(--danger)}.ptl-chip.warn{background:rgba(201,138,18,.16);color:var(--warn,#8A5A08)}.ptl-chip.ok{background:rgba(10,143,106,.12);color:var(--ok,#066B4F)}" +
      ".ptl-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:18px;color:var(--muted);font-size:14px;line-height:1.5}" +
      ".ptl-quiet .ptl-btn{margin-top:10px;display:block}" +
      ".ptl-seg{display:flex;gap:6px;flex-wrap:wrap;margin:16px 0 0}.ptl-seg button{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}" +
      ".ptl-seg button[aria-pressed=true]{background:var(--text);color:var(--bg,#fff);border-color:var(--text)}" +
      ".ptl-tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-top:16px}" +
      ".ptl-tile{display:block;text-align:left;font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer;min-height:44px}" +
      ".ptl-tile small{display:block;font-size:12.5px;color:var(--muted)}.ptl-tile b{display:block;font-size:24px;font-weight:700;font-variant-numeric:tabular-nums;margin-top:2px}.ptl-tile span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}" +
      ".ptl-tile.bad b{color:var(--danger)}" +
      ".ptl-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:14px}" +
      ".ptl-form label{display:flex;align-items:center;gap:12px;min-height:48px;padding:0 16px;border-top:.5px solid var(--border)}.ptl-form label:first-of-type{border-top:0}" +
      ".ptl-form label>span{flex:0 0 150px;font-size:15px}.ptl-form input,.ptl-form select,.ptl-form textarea{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".ptl-form input:focus-visible,.ptl-form select:focus-visible,.ptl-form textarea:focus-visible{box-shadow:0 2px 0 var(--accent)}" +
      ".ptl-form textarea{min-height:56px;resize:vertical}.ptl-form .acts{display:flex;gap:8px;padding:10px 16px;justify-content:flex-end;flex-wrap:wrap}" +
      ".ptl-form h2{font-size:17px;margin:10px 16px 4px}.ptl-form .hint{font-size:13px;color:var(--muted);padding:0 16px 6px}" +
      ".ptl-err,.ptl-form .eikon-ferr{color:var(--danger);font-size:13.5px;padding:6px 16px}" +
      ".ptl-ask{margin:8px 16px 12px;padding:12px 14px;border-radius:12px;background:rgba(201,138,18,.10);font-size:14px;line-height:1.45}.ptl-ask .acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}" +
      ".ptl-line{display:flex;gap:12px;align-items:flex-start;padding:12px 16px;border-top:.5px solid var(--border)}.ptl-line:first-child{border-top:0}.ptl-line .w{flex:1;min-width:0}" +
      ".ptl-line b{display:block;font-size:15px;font-weight:600}.ptl-line .s{display:block;font-size:13px;color:var(--muted);margin-top:2px;font-variant-numeric:tabular-nums}" +
      ".ptl-line.off b{text-decoration:line-through;color:var(--muted)}" +
      "@media (max-width:480px){.ptl-line{flex-wrap:wrap}.ptl-line .w{flex:1 1 100%}.ptl-line .ptl-qty,.ptl-line>.ptl-btn{margin-top:4px}}" + // Visual: the controls under the name on a phone
      ".ptl-qty{display:flex;align-items:center;gap:6px;font-size:13px;color:var(--muted);white-space:nowrap}.ptl-qty input{width:56px;min-height:36px;font:inherit;font-size:16px;text-align:center;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--text)}" +
      ".ptl-sum{display:flex;flex-wrap:wrap;gap:6px 18px;padding:12px 16px;border-top:.5px solid var(--border);font-size:14px;font-variant-numeric:tabular-nums}.ptl-sum b{font-weight:600}" +
      ".ptl-note{font-size:14px;line-height:1.5;padding:10px 16px;border-top:.5px solid var(--border)}.ptl-note:first-child{border-top:0}" +
      ".ptl-foot{font-size:12.5px;color:var(--muted);margin:16px 2px 0;line-height:1.5}.ptl-foot button{font:inherit;font-size:13px;border:0;background:none;color:var(--accent);padding:0;min-height:44px;cursor:pointer}" +
      ".ptl-q{display:flex;gap:8px;margin-top:14px}.ptl-q input{flex:1;min-width:0;font:inherit;font-size:16px;min-height:44px;padding:0 14px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text)}" +
      ".ptl-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}" +
      ".ptl-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}.ptl-card h3{font-size:16px;margin:0;padding:12px 16px 4px}" +
      ".ptl-kv{display:flex;gap:12px;padding:8px 16px;border-top:.5px solid var(--border);font-size:14px;line-height:1.4}.ptl-kv:first-of-type{border-top:0}.ptl-kv>span{flex:0 0 120px;color:var(--muted)}.ptl-kv>div{flex:1;min-width:0;font-variant-numeric:tabular-nums}" +
      ".ptl-kv .bad{color:var(--danger);font-weight:600}.ptl-kv .warn{color:var(--warn,#8A5A08);font-weight:600}.ptl-kv .ok{color:var(--ok,#066B4F)}" +
      ".ptl-card .acts{padding:8px 16px 12px}" +
      ".ptl-grid{width:100%;border-collapse:collapse;font-size:14px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".ptl-grid th,.ptl-grid td{text-align:left;padding:10px 12px;border-top:.5px solid var(--border);vertical-align:top}.ptl-grid thead th{border-top:0;font-size:13px;color:var(--muted);font-weight:600}" +
      ".ptl-grid td small{display:block;color:var(--muted);font-size:12.5px;margin-top:2px}.ptl-grid .bad{color:var(--danger);font-weight:600}.ptl-grid .warn{color:var(--warn,#8A5A08);font-weight:600}.ptl-grid .ok{color:var(--ok,#066B4F)}" +
      ".ptl-wide{overflow-x:auto}.ptl-mon{display:flex;align-items:center;gap:8px;margin-top:14px;flex-wrap:wrap}.ptl-mon b{font-size:16px;min-width:130px;text-align:center}" +
      ".ptl-hub{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}" +
      ".ptl-hub button{display:block;text-align:left;font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 16px;min-height:72px;cursor:pointer}" +
      ".ptl-hub button b{display:block;font-size:15px;font-weight:600;margin-bottom:3px}.ptl-hub button span{display:block;font-size:13px;color:var(--muted);line-height:1.45}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .ptl-seg button[aria-pressed=true]{background:#fff;color:#000;border-color:#fff}}" +
      "@media (max-width:600px){.ptl{padding:4px 16px 0}.ptl h1{font-size:32px}.ptl-btn,.ptl-seg button{min-height:44px;border-radius:22px}" +
      ".ptl-form label{flex-wrap:wrap;gap:0;padding-top:6px}.ptl-form label>span{flex:0 0 100%;font-size:13px;color:var(--muted)}" +
      ".ptl-row{flex-wrap:wrap}.ptl-row .acts{width:100%;justify-content:flex-start}.ptl-kv>span{flex-basis:96px}.ptl-cards{grid-template-columns:1fr}.ptl-hub{grid-template-columns:1fr}}" +
      "@media print{.ptl-noprint{display:none!important}}";
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------------------------------------------------------
  // Data: the classic screens' own reads, kept for a minute and shared by the portal's screens.
  var PATH = { products: "/supplier-products/entries", orders: "/supplier-orders/received", feedback: "/supplier-orders/feedback",
    summary: "/owner/summary?loc=all", stock: "/hq/stock" };
  var D = { at: {}, err: {}, p: {} };
  function get(k, force) {
    if (!force && D[k] && Date.now() - (D.at[k] || 0) < REFRESH - 5000) return Promise.resolve(D[k]);
    if (D.p[k]) return D.p[k];
    D.p[k] = E.apiFetch(PATH[k], { method: "GET" }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load");
      D[k] = k === "summary" || k === "stock" ? r : (r.entries || []); D.at[k] = Date.now(); D.err[k] = ""; return D[k];
    }, function (e) { D.err[k] = e && e.status === 403 ? "forbidden" : errText(e); throw e; });
    D.p[k].then(done, done);
    function done() { D.p[k] = null; }
    return D.p[k];
  }
  function forget(k) { D.at[k] = 0; }
  function settle(keys, force) { return Promise.all(keys.map(function (k) { return get(k, force).catch(function () { return null; }); })); }
  function pending() { return (D.orders || []).filter(function (o) { return o.status === "pending"; }); }
  function waiting() { return (D.feedback || []).filter(function (f) { return !f.resolution_status; }); }
  function badges() {
    if (D.orders) E.setRailBadge("suporders", pending().length);
    if (D.feedback) E.setRailBadge("supproblems", waiting().length);
  }

  // One minute refresh while a portal screen is open and the tab is visible; nothing redraws under someone typing.
  var timer = null;
  function tick() {
    if (document.hidden || !E.portalNow || !E.portalNow()) return;
    var mod = E.modules[E.state.activeModuleId];
    if (mod && mod.ptlRefresh) mod.ptlRefresh();
  }
  function startTimer() { if (!timer) timer = setInterval(tick, REFRESH); }
  document.addEventListener("visibilitychange", function () { if (!document.hidden && timer) tick(); });

  function classicLink(hash, ret) { try { sessionStorage.setItem("eikon_ui2_return", ret); } catch (e) {} E.openClassic(hash); }
  // (18:05) no way into the classic screens from the portal's screens (classic is Account › Classic layout, as for a
  // pharmacy); where something is still only there, one plain sentence says so.
  function footHtml(text) { return text ? '<p class="ptl-foot ptl-noprint">' + esc(text) + "</p>" : ""; }
  function focusSoon(m, sel) { E.focusSoon(function () { return m && m.querySelector(sel); }, 30); }

  // A screen: render(ctx) draws it, paint() draws it again from what is in hand; ptlRefresh() reads again (the minute).
  function screen(id, title, def) {
    var S = { mount: null };
    function paint() { if (!S.mount || E.state.activeModuleId !== id) return; css(); def.paint(S); }
    S.paint = function () { E.whenFormIdle(S.mount, paint); };
    S.paintNow = paint;
    E.registerModule({ id: id, title: title, order: 3, icon: "◯", ui2Only: true,
      render: function (ctx) {
        S.mount = ctx && ctx.mount; css(); startTimer();
        if (def.open) def.open(S);
        paint();
        return Promise.resolve(def.load(S, true)).then(function () { paint(); badges(); }); // what is in hand is drawn at once, then read again
      } });
    E.modules[id].ptlRefresh = function () { if (def.busy && def.busy(S)) return; Promise.resolve(def.load(S, true)).then(function () { badges(); S.paint(); }); };
    return S;
  }
  // Another screen of the same portal opens on one thing (an order, a product, a problem).
  var hand = {};
  function go(id, what) { hand[id] = what; window.location.hash = "#" + id; }
  function take(id) { var w = hand[id]; delete hand[id]; return w; }

  // ===============================================================================================================
  // DISTRIBUTOR
  // ===============================================================================================================

  // ---- Today ----------------------------------------------------------------------------------------------------
  var SH = screen("suphome", "Today", {
    load: function (S, force) { return settle(["orders", "feedback", "products"], force); },
    paint: function (S) {
      var m = S.mount, u = user(), t = today();
      var h = '<div class="ptl" data-ptl="suphome"><div class="ptl-top"><div><h1>Today</h1><p class="ptl-sub">' + esc(u.location_name || "") + " · " + esc(nice(t, true)) + "</p></div></div>";
      var loading = !D.orders && !D.err.orders;
      if (loading) h += E.skeleton ? E.skeleton(4, "today") : '<div class="ptl-quiet">Opening…</div>';
      else if (D.err.orders && !D.orders) h += '<div class="ptl-quiet" role="alert">' + esc(D.err.orders) + '<button type="button" class="ptl-btn" data-act="retry">Try again</button></div>';
      else {
        var pend = pending().sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? -1 : 1; });
        var wk = addDays(t, -6), sentWeek = (D.orders || []).filter(function (o) { return o.status !== "pending" && stamp(o.updated_at) && E.maltaYmd(stamp(o.updated_at)) >= wk; }).length;
        var prods = D.products || [], oos = prods.filter(function (p) { return Number(p.out_of_stock) === 1; });
        var short = prods.map(function (p) { return { p: p, d: expDay(p.expiry_date) }; }).filter(function (x) { return x.d && diffDays(t, x.d) <= 90; }).sort(function (a, b) { return a.d < b.d ? -1 : 1; });
        var fb = waiting();
        h += '<div class="ptl-tiles">' +
          '<button type="button" class="ptl-tile' + (pend.length ? " bad" : "") + '" data-go="suporders"><small>To send</small><b>' + pend.length + "</b><span>" + (pend.length ? "orders waiting" : "nothing waiting") + "</span></button>" +
          '<button type="button" class="ptl-tile' + (fb.length ? " bad" : "") + '" data-go="supproblems"><small>Problems</small><b>' + fb.length + "</b><span>to answer</span></button>" +
          '<button type="button" class="ptl-tile" data-go="supproducts" data-filter="short"><small>Short expiry</small><b>' + short.length + "</b><span>within 90 days</span></button>" +
          '<button type="button" class="ptl-tile" data-go="supproducts" data-filter="oos"><small>Out of stock</small><b>' + oos.length + "</b><span>of " + plural(prods.length, "product", "products") + "</span></button></div>";
        h += '<h2 class="ptl-lab">Orders to send <b>' + pend.length + "</b></h2>";
        h += pend.length ? '<div class="ptl-list">' + pend.slice(0, 8).map(function (o) {
          return '<button type="button" class="ptl-row" data-order="' + o.id + '"><span class="w"><b>' + esc(o.pharmacy_name || "A pharmacy") + '</b><span class="s">Order ' + o.id + " · " + plural(Number(o.item_count) || 0, "line", "lines") + " · " + esc(when(o.created_at)) + (o.notes ? " · “" + esc(o.notes) + "”" : "") + "</span></span></button>";
        }).join("") + (pend.length > 8 ? '<button type="button" class="ptl-row" data-go="suporders"><span class="w"><b>See all ' + pend.length + "</b></span></button>" : "") + "</div>"
          : '<div class="ptl-quiet">Nothing to send. New orders from pharmacies appear here' + (sentWeek ? "; " + plural(sentWeek, "order", "orders") + " sent this week." : ".") + "</div>";
        if (fb.length) {
          h += '<h2 class="ptl-lab">Problems reported <b>' + fb.length + "</b></h2><div class=\"ptl-list\">" + fb.slice(0, 5).map(function (f) {
            return '<button type="button" class="ptl-row" data-fb="' + f.id + '"><span class="w"><b>' + esc(E.problemLabel(f.problem_type)) + " · " + esc(f.item_description) + '</b><span class="s">' + esc(f.pharmacy_name) + " · order " + f.order_id + " · " + esc(when(f.created_at)) + "</span></span></button>";
          }).join("") + "</div>";
        }
        if (short.length) {
          h += '<h2 class="ptl-lab">Short expiry <b>' + short.length + "</b></h2><div class=\"ptl-list\">" + short.slice(0, 6).map(function (x) {
            return '<button type="button" class="ptl-row" data-prod="' + x.p.id + '"><span class="w"><b>' + esc(x.p.description) + '</b><span class="s">' + (x.p.batch ? "Batch " + esc(x.p.batch) + " · " : "") + "expires " + esc(nice(x.d)) + "</span>" + expiryChip(x.p) + "</span></button>";
          }).join("") + "</div>";
        }
        if (oos.length) {
          h += '<h2 class="ptl-lab">Out of stock <b>' + oos.length + "</b></h2><div class=\"ptl-list\">" + oos.slice(0, 6).map(function (p) {
            return '<div class="ptl-row"><span class="w"><b>' + esc(p.description) + '</b><span class="s">' + esc([p.stock_code, p.barcode].filter(Boolean).join(" · ") || "Pharmacies see it as out of stock") + '</span></span><span class="acts"><button type="button" class="ptl-btn" data-instock="' + p.id + '"' + (S.busy === p.id ? " disabled" : "") + ">" + (S.busy === p.id ? "Saving…" : "Back in stock") + "</button></span></div>";
          }).join("") + "</div>";
        }
      }
      h += footHtml("") + "</div>";
      m.innerHTML = h;
      m.querySelectorAll("[data-go]").forEach(function (b) { b.addEventListener("click", function () { go(b.getAttribute("data-go"), b.getAttribute("data-filter") ? { filter: b.getAttribute("data-filter") } : null); }); });
      m.querySelectorAll("[data-order]").forEach(function (b) { b.addEventListener("click", function () { go("suporders", { order: Number(b.getAttribute("data-order")) }); }); });
      m.querySelectorAll("[data-fb]").forEach(function (b) { b.addEventListener("click", function () { go("supproblems", { fb: Number(b.getAttribute("data-fb")) }); }); });
      m.querySelectorAll("[data-prod]").forEach(function (b) { b.addEventListener("click", function () { go("supproducts", { edit: Number(b.getAttribute("data-prod")) }); }); });
      m.querySelectorAll("[data-instock]").forEach(function (b) { b.addEventListener("click", function () { stockStatus(S, Number(b.getAttribute("data-instock")), false, '[data-instock]'); }); });
      var r = m.querySelector('[data-act="retry"]'); if (r) r.addEventListener("click", function () { forget("orders"); SH_load(); });
    }
  });
  function SH_load() { E.modules.suphome.ptlRefresh(); }

  // In or out of stock: the classic Product List's toggle (PUT …/stock-status { out_of_stock: 0|1 }).
  async function stockStatus(S, id, out, refocusSel) {
    if (S.busy) return;
    var p = (D.products || []).find(function (x) { return x.id === id; }); if (!p) return;
    S.busy = id; S.paintNow();
    try {
      var r = await E.apiFetch("/supplier-products/entries/" + id + "/stock-status", { method: "PUT", body: JSON.stringify({ out_of_stock: out ? 1 : 0 }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast((out ? "Out of stock · " : "Back in stock · ") + p.description, "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy = null; forget("products"); await settle(["products"], true); S.paintNow();
    var f = S.mount && (S.mount.querySelector(refocusSel) || S.mount.querySelector("h1")); if (f && document.activeElement === document.body) f.focus();
  }

  // ---- Orders ---------------------------------------------------------------------------------------------------
  var STATUS = { pending: "To send", confirmed: "Confirmed", shipped: "Sent", received: "Received" };
  var SO = screen("suporders", "Orders", {
    open: function (S) { var w = take("suporders"); S.filter = S.filter || "pending"; if (w && w.order) openOrder(S, w.order); else if (!w) { S.open = null; } },
    busy: function (S) { return !!S.open; }, // an open order is not redrawn by the minute (notes and the day would be lost)
    load: function (S, force) { return settle(["orders"], force); },
    paint: function (S) { return S.open ? paintOrder(S) : paintOrders(S); }
  });
  function paintOrders(S) {
    var m = S.mount, all = D.orders || [];
    var count = function (f) { return all.filter(function (o) { return f === "all" || o.status === f || (f === "shipped" && o.status === "confirmed"); }).length; };
    var h = '<div class="ptl" data-ptl="suporders"><div class="ptl-top"><div><h1>Orders</h1><p class="ptl-sub">What pharmacies ordered from you. Open an order, mark what you cannot supply, then mark it sent.</p></div></div>';
    h += '<div class="ptl-seg" role="group" aria-label="Show">' + [["pending", "To send"], ["shipped", "Sent"], ["received", "Received"], ["all", "All"]].map(function (f) {
      return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + (D.orders ? " " + count(f[0]) : "") + "</button>";
    }).join("") + "</div>";
    if (!D.orders && !D.err.orders) h += E.skeleton ? E.skeleton(4, "orders") : '<div class="ptl-quiet">Opening orders…</div>';
    else if (!D.orders) h += '<div class="ptl-quiet" role="alert">' + esc(D.err.orders) + '<button type="button" class="ptl-btn" data-act="retry">Try again</button></div>';
    else {
      var rows = all.filter(function (o) { return S.filter === "all" || o.status === S.filter || (S.filter === "shipped" && o.status === "confirmed"); })
        .sort(function (a, b) { return S.filter === "pending" ? (String(a.created_at) < String(b.created_at) ? -1 : 1) : (String(a.created_at) < String(b.created_at) ? 1 : -1); });
      var pg = E.listPage.take("ptl:orders:" + S.filter, rows);
      h += '<h2 class="ptl-lab">' + esc({ pending: "To send", shipped: "Sent", received: "Received by the pharmacy", all: "Every order" }[S.filter]) + " <b>" + rows.length + "</b></h2>";
      h += rows.length ? '<div class="ptl-list">' + pg.rows.map(function (o) {
        return '<button type="button" class="ptl-row" data-order="' + o.id + '"><span class="w"><b>' + esc(o.pharmacy_name || "A pharmacy") + '</b><span class="s">Order ' + o.id + " · " + plural(Number(o.item_count) || 0, "line", "lines") + " · ordered " + esc(when(o.created_at)) +
          (o.scheduled_delivery_date && o.status !== "pending" ? " · delivery " + esc(nice(o.scheduled_delivery_date, true)) : "") + '</span><em class="ptl-chip' + (o.status === "pending" ? " warn" : o.status === "received" ? " ok" : "") + '">' + esc(STATUS[o.status] || sentence(o.status)) + "</em></span></button>";
      }).join("") + "</div>" + E.listPage.moreHtml("ptl:orders:" + S.filter, pg, "ptl-btn")
        : '<div class="ptl-quiet">' + (S.filter === "pending" ? "Nothing to send. New orders from pharmacies appear here." : "No orders here yet.") + "</div>";
    }
    h += footHtml("") + "</div>";
    m.innerHTML = h;
    m.querySelectorAll("[data-filter]").forEach(function (b) { b.addEventListener("click", function () { S.filter = b.getAttribute("data-filter"); S.paintNow(); focusSoon(m, '[data-filter="' + S.filter + '"]'); }); });
    m.querySelectorAll("[data-order]").forEach(function (b) { b.addEventListener("click", function () { openOrder(S, Number(b.getAttribute("data-order"))); }); });
    m.querySelectorAll('[data-act="q58-more"]').forEach(function (b) { b.addEventListener("click", function () { var id = E.listPage.more(b.getAttribute("data-key")); S.paintNow(); if (id) focusSoon(m, '[data-order="' + id + '"]'); }); });
    var r = m.querySelector('[data-act="retry"]'); if (r) r.addEventListener("click", function () { E.modules.suporders.ptlRefresh(); });
  }
  async function openOrder(S, id) {
    S.open = { id: id, loading: true, err: "", items: [], ask: null, confirm: false, saving: false, busy: null, qty: {} };
    S.paintNow();
    try {
      var r = await E.apiFetch("/supplier-orders/" + id, { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not open the order");
      if (!S.open || S.open.id !== id) return;
      S.open.order = r.order; S.open.items = r.items || []; S.open.feedbacks = r.feedbacks || [];
      S.open.notes = r.order.supplier_notes || ""; S.open.day = r.order.scheduled_delivery_date || today(); // the classic screen's defaults
    } catch (e) { if (S.open) S.open.err = errText(e); }
    if (S.open) S.open.loading = false;
    S.paintNow(); focusSoon(S.mount, "h1");
  }
  function orderTotals(items, O) {
    var t = { lines: 0, coming: 0, qty: 0, free: 0, excl: 0, incl: 0 };
    items.forEach(function (i) {
      t.lines++; if (Number(i.unavailable)) return;
      var q = O && O.order && O.order.status === "pending" ? sending(O, i) : Number(i.qty_requested) || 0, c = Number(i.cost_excl_vat) || 0, v = Number(i.vat_rate) || 0;
      t.coming++; t.qty += q; t.free += Number(i.qty_free) || 0; t.excl += q * c; t.incl += q * c * (1 + v / 100);
    });
    return t;
  }
  function paintOrder(S) {
    var m = S.mount, O = S.open, o = O.order || {}, isPending = o.status === "pending";
    var h = '<div class="ptl" data-ptl="suporders"><button type="button" class="ptl-back" data-act="back">‹ Orders</button>';
    if (O.loading) { m.innerHTML = h + '<h1>Order ' + O.id + '</h1>' + (E.skeleton ? E.skeleton(3, "the order") : '<div class="ptl-quiet">Opening…</div>') + "</div>"; wireBack(); return; }
    if (O.err) { m.innerHTML = h + '<h1>Order ' + O.id + '</h1><div class="ptl-quiet" role="alert">' + esc(O.err) + '<button type="button" class="ptl-btn" data-act="reopen">Try again</button></div></div>'; wireBack(); m.querySelector('[data-act="reopen"]').addEventListener("click", function () { openOrder(S, O.id); }); return; }
    var t = orderTotals(O.items, O);
    h += '<div class="ptl-top"><div><h1 tabindex="-1">Order ' + o.id + " · " + esc(o.pharmacy_name || "") + '</h1><p class="ptl-sub">Ordered ' + esc(when(o.created_at)) + ' · <em class="ptl-chip' + (isPending ? " warn" : o.status === "received" ? " ok" : "") + '" style="margin:0">' + esc(STATUS[o.status] || sentence(o.status)) + "</em></p></div></div>";
    if (o.notes) h += '<h2 class="ptl-lab">The pharmacy\'s note</h2><div class="ptl-list"><div class="ptl-note">“' + esc(o.notes) + "”</div></div>";
    h += '<h2 class="ptl-lab">Lines <b>' + (t.coming === t.lines ? t.lines : t.coming + " of " + t.lines + " coming") + "</b></h2><div class=\"ptl-list\">";
    O.items.forEach(function (i) {
      var off = Number(i.unavailable) === 1, q = Number(i.qty_requested) || 0, c = Number(i.cost_excl_vat) || 0;
      h += '<div class="ptl-line' + (off ? " off" : "") + '"><div class="w"><b>' + esc(i.description) + '</b><span class="s">' + esc([i.stock_code, i.barcode].filter(Boolean).join(" · ")) + (i.stock_code || i.barcode ? " · " : "") +
        "Qty " + q + (Number(i.qty_free) > 0 ? " + " + Number(i.qty_free) + " free" : "") + " · " + eur(c) + " each" + (Number(i.discount_pct) > 0 ? " · " + Number(i.discount_pct) + "% off" : "") + " · " + eur(q * c) + "</span>" +
        (off ? '<em class="ptl-chip bad">Not available</em>' : "") + (i.notes && !off ? '<span class="s">' + esc(i.notes) + "</span>" : "") + "</div>" +
        (isPending && !off ? '<label class="ptl-qty">Sending <input inputmode="numeric" data-qty="' + i.id + '" value="' + esc(O.qty[i.id] != null ? O.qty[i.id] : q) + '" aria-label="' + esc("How many you are sending of " + i.description + ", of " + q) + '"></label>' : "") +
        (isPending ? '<button type="button" class="ptl-btn" data-item="' + i.id + '" data-off="' + (off ? 0 : 1) + '" aria-label="' + esc((off ? "Available again: " : "Not available: ") + i.description) + '"' + (O.busy ? " disabled" : "") + ">" + (O.busy === i.id ? "Saving…" : off ? "Available again" : "Not available") + "</button>" : "") + "</div>";
      if (O.ask && O.ask.item === i.id) h += '<div class="ptl-ask" role="group" aria-label="Out of stock?">Also mark <b>' + esc(i.description) + "</b> out of stock on your product list? Pharmacies then see it as out of stock." +
        '<div class="acts"><button type="button" class="ptl-btn p" data-act="oos-yes">Mark out of stock</button><button type="button" class="ptl-btn" data-act="oos-no">Only this order</button></div></div>';
    });
    h += '<div class="ptl-sum"><span>' + t.qty + (t.free ? " + " + t.free + " free" : "") + " items</span><span><b>" + eur(t.excl) + "</b> before VAT</span><span>" + eur(t.incl) + " with VAT</span></div></div>";
    if ((O.feedbacks || []).length) h += '<h2 class="ptl-lab">Problems reported <b>' + O.feedbacks.length + '</b></h2><div class="ptl-list">' + O.feedbacks.map(function (f) {
      return '<button type="button" class="ptl-row" data-fb="' + f.id + '"><span class="w"><b>' + esc(E.problemLabel(f.problem_type)) + " · " + esc(f.item_description) + '</b><span class="s">' + (f.resolution_status ? "Answered: " + esc(sentence(f.resolution_status)) : "Waiting for your answer") + "</span></span></button>";
    }).join("") + "</div>";
    if (isPending) {
      h += '<form class="ptl-form" id="ptl-ship" novalidate><h2>Send it</h2>' +
        '<label><span>Delivery day</span><input type="date" name="scheduled_delivery_date" value="' + esc(O.day) + '"></label>' +
        '<label><span>Note for the pharmacy</span><textarea name="supplier_notes" placeholder="Optional, e.g. the van comes on Thursday">' + esc(O.notes) + "</textarea></label>" +
        (O.err2 ? '<div class="ptl-err" role="alert">' + esc(O.err2) + "</div>" : "") +
        (O.confirm ? '<div class="ptl-ask" role="alert">Mark order ' + o.id + " sent to " + esc(o.pharmacy_name || "the pharmacy") + "? " + (t.coming < t.lines ? plural(t.lines - t.coming, "line shows", "lines show") + " to them as not available." : "Every line is coming.") + (O.items.some(function (i) { return !Number(i.unavailable) && sending(O, i) < Number(i.qty_requested); }) ? " Some lines go out short: they see how many you sent." : "") +
          '<div class="acts"><button type="submit" class="ptl-btn p"' + (O.saving ? " disabled" : "") + ">" + (O.saving ? "Saving…" : "Yes, mark it sent") + '</button><button type="button" class="ptl-btn" data-act="ship-no">Not yet</button></div></div>'
          : '<div class="acts"><button type="submit" class="ptl-btn p"' + (t.coming ? "" : " disabled") + ">Mark as sent</button></div>") + "</form>";
      if (!t.coming) h += '<p class="ptl-foot">Every line is marked not available: make at least one available to send it.</p>';
    } else {
      h += '<h2 class="ptl-lab">Sent</h2><div class="ptl-list"><div class="ptl-note">Delivery ' + esc(o.scheduled_delivery_date ? nice(o.scheduled_delivery_date, true) : "day not given") + (o.supplier_notes ? " · “" + esc(o.supplier_notes) + "”" : "") + "</div></div>";
    }
    h += footHtml("") + "</div>";
    m.innerHTML = h;
    wireBack();
    m.querySelectorAll("[data-qty]").forEach(function (inp) { inp.addEventListener("input", function () { O.qty[inp.getAttribute("data-qty")] = inp.value; O.confirm = false; }); inp.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); inp.blur(); } }); });
    m.querySelectorAll("[data-item]").forEach(function (b) { b.addEventListener("click", function () { lineAvailable(S, Number(b.getAttribute("data-item")), b.getAttribute("data-off") === "1"); }); });
    m.querySelectorAll("[data-fb]").forEach(function (b) { b.addEventListener("click", function () { go("supproblems", { fb: Number(b.getAttribute("data-fb")) }); }); });
    var y = m.querySelector('[data-act="oos-yes"]'); if (y) y.addEventListener("click", function () { askOos(S, true); });
    var n = m.querySelector('[data-act="oos-no"]'); if (n) n.addEventListener("click", function () { askOos(S, false); });
    var f = m.querySelector("#ptl-ship");
    if (f) {
      f.addEventListener("input", function () { O.day = f.scheduled_delivery_date.value; O.notes = f.supplier_notes.value; });
      f.addEventListener("submit", function (ev) { ev.preventDefault(); O.day = f.scheduled_delivery_date.value; O.notes = f.supplier_notes.value;
        var qp = qtyProblem(O); if (qp) { O.err2 = qp.msg; O.confirm = false; S.paintNow(); focusSoon(m, '[data-qty="' + qp.id + '"]'); return; } O.err2 = "";
        if (!O.confirm) { O.confirm = true; S.paintNow(); focusSoon(m, '#ptl-ship button[type=submit]'); } else ship(S); });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && O.confirm) { ev.preventDefault(); O.confirm = false; S.paintNow(); focusSoon(m, '#ptl-ship button[type=submit]'); } });
      var no = m.querySelector('[data-act="ship-no"]'); if (no) no.addEventListener("click", function () { O.confirm = false; S.paintNow(); focusSoon(m, '#ptl-ship button[type=submit]'); });
    }
    function wireBack() { var b = m.querySelector('[data-act="back"]'); if (b) b.addEventListener("click", function () { var was = O.id; S.open = null; S.paintNow(); focusSoon(m, '[data-order="' + was + '"]'); }); }
  }
  // A line not available, or available again: the classic Received Orders' own call (PUT …/items/:id/unavailable).
  async function lineAvailable(S, itemId, off) {
    var O = S.open; if (!O || O.busy) return;
    var item = O.items.find(function (i) { return i.id === itemId; }); if (!item) return;
    O.busy = itemId; O.ask = null; S.paintNow();
    try {
      var r = await E.apiFetch("/supplier-orders/items/" + itemId + "/unavailable", { method: "PUT", body: JSON.stringify({ unavailable: off, notes: "" }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      var d = await E.apiFetch("/supplier-orders/" + O.id, { method: "GET" });
      if (d && d.ok) O.items = d.items || O.items;
      if (off && item.product_id) O.ask = { item: itemId, product: item.product_id, desc: item.description }; // classic: "also mark Out of Stock?"
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    O.busy = null; S.paintNow();
    focusSoon(S.mount, O.ask ? '[data-act="oos-yes"]' : '[data-item="' + itemId + '"]');
  }
  async function askOos(S, yes) {
    var O = S.open, a = O && O.ask; if (!a) return;
    O.ask = null;
    if (yes) {
      try {
        var r = await E.apiFetch("/supplier-products/entries/" + a.product + "/stock-status", { method: "PUT", body: JSON.stringify({ out_of_stock: 1 }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
        E.toast("Out of stock on your product list · " + a.desc, "success"); forget("products");
      } catch (x) { E.toast(E.saveFailText(x), "error"); }
    }
    S.paintNow(); focusSoon(S.mount, '[data-item="' + a.item + '"]');
  }
  // Mark as sent: the classic "Order Shipped" body, as it builds it (every line: unavailable as read, qty_confirmed
  // 0 or the quantity asked, its notes), with the note and the delivery day from the form.
  // How many of a line go out: what was asked unless the supplier typed fewer (W22: a part of a line; the pharmacy sees
  // "N confirmed"). Untouched, the body is the classic one (qty_confirmed = qty_requested).
  function sending(O, i) { var v = O.qty[i.id]; if (v == null || v === "") return i.qty_requested; var n = parseInt(v, 10); return isFinite(n) ? Math.max(0, Math.min(Number(i.qty_requested) || 0, n)) : i.qty_requested; }
  function qtyProblem(O) {
    for (var k = 0; k < O.items.length; k++) { var i = O.items[k], v = O.qty[i.id]; if (Number(i.unavailable) || v == null || v === "") continue;
      if (!/^\d+$/.test(String(v).trim()) || Number(v) < 1 || Number(v) > Number(i.qty_requested)) return { id: i.id, msg: "Sending for " + i.description + ": write a number from 1 to " + i.qty_requested + ", or press Not available." }; }
    return null;
  }
  async function ship(S) {
    var O = S.open; if (!O || O.saving) return;
    var body = { status: "shipped",
      items: O.items.map(function (i) { return { id: i.id, unavailable: i.unavailable, qty_confirmed: i.unavailable ? 0 : sending(O, i), notes: i.notes || "" }; }),
      supplier_notes: String(O.notes || "").trim(), scheduled_delivery_date: String(O.day || "").trim() };
    O.saving = true; O.err2 = ""; S.paintNow();
    try {
      var r = await E.apiFetch("/supplier-orders/" + O.id + "/confirm", { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast("Sent · order " + O.id + " to " + (O.order.pharmacy_name || "the pharmacy"), "success");
      var was = O.id; S.open = null; forget("orders"); await settle(["orders"], true); badges(); S.paintNow();
      focusSoon(S.mount, '[data-order="' + was + '"]') ; if (!S.mount.querySelector('[data-order="' + was + '"]')) focusSoon(S.mount, "h1");
      return;
    } catch (x) { O.err2 = E.saveFailText(x); }
    O.saving = false; O.confirm = false; S.paintNow();
  }

  // ---- Problems (order feedback) ----------------------------------------------------------------------------------
  var SP = screen("supproblems", "Problems", {
    open: function (S) { var w = take("supproblems"); S.filter = S.filter || "waiting"; S.want = w && w.fb || null; if (S.want) S.filter = "all"; S.forms = S.forms || {}; },
    busy: function (S) { return Object.keys(S.forms).some(function (k) { return S.forms[k] && (S.forms[k].answer || S.forms[k].note); }); },
    load: function (S, force) { return settle(["feedback"], force); },
    paint: function (S) {
      var m = S.mount, all = D.feedback || [];
      var n = function (f) { return all.filter(function (x) { return f === "all" || (f === "waiting" ? !x.resolution_status : !!x.resolution_status); }).length; };
      var h = '<div class="ptl" data-ptl="supproblems"><div class="ptl-top"><div><h1>Problems</h1><p class="ptl-sub">What pharmacies reported about a delivery: damaged, wrong item, short. Answer each one; the pharmacy sees your answer.</p></div></div>';
      h += '<div class="ptl-seg" role="group" aria-label="Show">' + [["waiting", "Waiting"], ["answered", "Answered"], ["all", "All"]].map(function (f) {
        return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + (D.feedback ? " " + n(f[0]) : "") + "</button>";
      }).join("") + "</div>";
      if (!D.feedback && !D.err.feedback) h += E.skeleton ? E.skeleton(3, "problems") : '<div class="ptl-quiet">Opening…</div>';
      else if (!D.feedback) h += '<div class="ptl-quiet" role="alert">' + esc(D.err.feedback) + '<button type="button" class="ptl-btn" data-act="retry">Try again</button></div>';
      else {
        var rows = all.filter(function (x) { return S.filter === "all" || (S.filter === "waiting" ? !x.resolution_status : !!x.resolution_status); })
          .sort(function (a, b) { return String(a.created_at) < String(b.created_at) ? 1 : -1; });
        var pg = E.listPage.take("ptl:fb:" + S.filter, rows, { keep: S.want });
        h += rows.length ? pg.rows.map(function (f) { return fbCard(S, f); }).join("") + E.listPage.moreHtml("ptl:fb:" + S.filter, pg, "ptl-btn")
          : '<div class="ptl-quiet" style="margin-top:16px">' + (S.filter === "waiting" ? "No problem is waiting for an answer." : "Nothing here yet.") + "</div>";
      }
      h += footHtml("") + "</div>";
      m.innerHTML = h;
      m.querySelectorAll("[data-filter]").forEach(function (b) { b.addEventListener("click", function () { S.filter = b.getAttribute("data-filter"); S.want = null; S.paintNow(); focusSoon(m, '[data-filter="' + S.filter + '"]'); }); });
      m.querySelectorAll("form[data-fbform]").forEach(function (f) {
        var id = Number(f.getAttribute("data-fbform"));
        f.addEventListener("input", function () { S.forms[id] = { answer: f.resolution_status.value, note: f.supplier_notes.value }; });
        f.addEventListener("change", function () { S.forms[id] = { answer: f.resolution_status.value, note: f.supplier_notes.value }; });
        f.addEventListener("submit", function (ev) { ev.preventDefault(); answer(S, id, f); });
      });
      m.querySelectorAll("[data-openorder]").forEach(function (b) { b.addEventListener("click", function () { go("suporders", { order: Number(b.getAttribute("data-openorder")) }); }); });
      m.querySelectorAll('[data-act="q58-more"]').forEach(function (b) { b.addEventListener("click", function () { E.listPage.more(b.getAttribute("data-key")); S.paintNow(); }); });
      var r = m.querySelector('[data-act="retry"]'); if (r) r.addEventListener("click", function () { E.modules.supproblems.ptlRefresh(); });
      if (S.want) { var w = m.querySelector('[data-fbcard="' + S.want + '"]'); S.want = null; if (w) { try { w.scrollIntoView({ block: "center" }); } catch (e) {} var fld = w.querySelector("select") || w; focusSoon(m, '[data-fbcard="' + w.getAttribute("data-fbcard") + '"] ' + (fld.tagName === "SELECT" ? "select" : "b")); } }
    }
  });
  function fbCard(S, f) {
    var d = S.forms[f.id] || {}, det = [f.item_qty ? "Qty " + f.item_qty : "", f.item_batch ? "Batch " + f.item_batch : "", f.item_expiry_date ? "Expiry " + f.item_expiry_date : ""].filter(Boolean).join(" · ");
    var h = '<div class="ptl-list" style="margin-top:14px" data-fbcard="' + f.id + '"><div class="ptl-line"><div class="w"><b>' + esc(E.problemLabel(f.problem_type)) + " · " + esc(f.item_description) + '</b><span class="s">' + esc(f.pharmacy_name) + " · reported " + esc(when(f.created_at)) + (det ? " · " + esc(det) : "") + "</span>" +
      (f.notes ? '<span class="s">“' + esc(f.notes) + "”</span>" : "") + '</div><button type="button" class="ptl-btn" data-openorder="' + f.order_id + '">Order ' + f.order_id + "</button></div>";
    if (f.resolution_status) h += '<div class="ptl-note"><em class="ptl-chip ok" style="margin:0 6px 0 0">' + esc(sentence(f.resolution_status)) + "</em>" + (f.supplier_notes ? "“" + esc(f.supplier_notes) + "” · " : "") + "answered " + esc(when(f.resolved_at)) + "</div>";
    else h += '<form class="ptl-form" style="margin:0;border:0;border-top:.5px solid var(--border);border-radius:0" data-fbform="' + f.id + '" novalidate>' +
      '<label><span>Your answer</span><select name="resolution_status"><option value="">Choose…</option>' + ANSWERS.map(function (a) { return '<option value="' + esc(a) + '"' + (d.answer === a ? " selected" : "") + ">" + esc(sentence(a)) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>Note for the pharmacy</span><input name="supplier_notes" value="' + esc(d.note || "") + '" placeholder="Optional, e.g. credit note CN-12 sent"></label>' +
      (S.ferr && S.ferr[f.id] ? '<div class="ptl-err" role="alert">' + esc(S.ferr[f.id]) + "</div>" : "") +
      '<div class="acts"><button type="submit" class="ptl-btn p"' + (S.saving === f.id ? " disabled" : "") + ">" + (S.saving === f.id ? "Sending…" : "Send answer") + "</button></div></form>";
    return h + "</div>";
  }
  // The classic Order Feedback's resolve: PUT …/feedback/:id/resolve { resolution_status, supplier_notes }.
  async function answer(S, id, f) {
    if (S.saving) return;
    var a = f.resolution_status.value, note = String(f.supplier_notes.value || "").trim();
    S.ferr = S.ferr || {}; S.ferr[id] = "";
    if (!a) { E.formErrors(f, [{ field: "resolution_status", msg: "Choose your answer. Nothing was sent." }]); return; }
    S.saving = id; S.paintNow();
    try {
      var r = await E.apiFetch("/supplier-orders/feedback/" + id + "/resolve", { method: "PUT", body: JSON.stringify({ resolution_status: a, supplier_notes: note }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      delete S.forms[id]; E.toast("Answer sent · " + sentence(a), "success");
    } catch (x) { S.ferr[id] = E.saveFailText(x); }
    S.saving = null; forget("feedback"); await settle(["feedback"], true); badges(); S.paintNow();
    focusSoon(S.mount, S.ferr[id] ? '[data-fbform="' + id + '"] select' : "h1");
  }

  // ---- Products -------------------------------------------------------------------------------------------------
  // The classic Add/Edit Product form's fields and body (showAddEditModal), in its order.
  var PF = [["description", "Product", "text"], ["stock_code", "Stock code", "text"], ["barcode", "Barcode", "text"], ["cost_excl_vat", "Cost before VAT (€)", "num"], ["cost_incl_vat", "Cost with VAT (€)", "num"],
    ["vat_rate", "VAT", "vat"], ["discount_pct", "Discount (%)", "num"], ["discount_euro", "Discount (€)", "num"], ["qty_purchased", "Quantity", "int"], ["qty_free", "Free", "int"],
    ["batch", "Batch", "text"], ["expiry_date", "Expiry", "date"], ["retail_price", "Recommended retail price (€)", "num"]];
  var SPR = screen("supproducts", "Products", {
    open: function (S) { var w = take("supproducts"); S.q = S.q || ""; S.filter = (w && w.filter) || S.filter || "all"; S.form = null; S.err = []; if (w && w.edit) S.wantEdit = w.edit; },
    busy: function (S) { return !!S.form; },
    load: function (S, force) { return settle(["products"], force).then(function () { if (S.wantEdit) { var p = (D.products || []).find(function (x) { return x.id === S.wantEdit; }); S.wantEdit = null; if (p) { S.form = { id: p.id, v: Object.assign({}, p) }; S.focusForm = true; } } }); },
    paint: function (S) {
      var m = S.mount, all = D.products || [], t = today(), q = String(S.q || "").trim().toLowerCase();
      var isShort = function (p) { var d = expDay(p.expiry_date); return d && diffDays(t, d) <= 90; };
      var counts = { all: all.length, short: all.filter(isShort).length, oos: all.filter(function (p) { return Number(p.out_of_stock) === 1; }).length };
      var h = '<div class="ptl" data-ptl="supproducts"><div class="ptl-top"><div><h1>Products</h1><p class="ptl-sub">Your price list, as pharmacies see it when they order from you.</p></div>' +
        '<button type="button" class="ptl-btn p" data-act="add">Add product</button></div>';
      if (S.form && !S.form.id) h += formHtml(S);
      h += '<div class="ptl-q"><label class="nxh-sr" for="ptl-pq">Search products</label><input id="ptl-pq" type="search" autocomplete="off" placeholder="Search by name, stock code or barcode" value="' + esc(S.q) + '"></div>';
      h += '<div class="ptl-seg" role="group" aria-label="Show">' + [["all", "All"], ["short", "Short expiry"], ["oos", "Out of stock"]].map(function (f) {
        return '<button type="button" data-filter="' + f[0] + '" aria-pressed="' + (S.filter === f[0]) + '">' + f[1] + (D.products ? " " + counts[f[0]] : "") + "</button>"; }).join("") + "</div>";
      if (!D.products && !D.err.products) h += E.skeleton ? E.skeleton(5, "products") : '<div class="ptl-quiet">Opening…</div>';
      else if (!D.products) h += '<div class="ptl-quiet" role="alert">' + esc(D.err.products) + '<button type="button" class="ptl-btn" data-act="retry">Try again</button></div>';
      else {
        var rows = all.filter(function (p) {
          if (S.filter === "short" && !isShort(p)) return false;
          if (S.filter === "oos" && Number(p.out_of_stock) !== 1) return false;
          return !q || [p.description, p.stock_code, p.barcode].join(" ").toLowerCase().indexOf(q) >= 0;
        }).sort(function (a, b) {
          if (S.filter === "short") return expDay(a.expiry_date) < expDay(b.expiry_date) ? -1 : 1;
          return String(a.description).localeCompare(String(b.description), undefined, { sensitivity: "base" });
        });
        var pg = E.listPage.take("ptl:prod:" + S.filter, rows, { q: q, keep: S.form && S.form.id });
        h += '<h2 class="ptl-lab" aria-live="polite">' + (q ? "Found" : { all: "Every product", short: "Expiring within 90 days", oos: "Out of stock" }[S.filter]) + " <b>" + rows.length + "</b></h2>";
        h += rows.length ? '<div class="ptl-list">' + pg.rows.map(function (p) {
          if (S.form && S.form.id === p.id) return '<div class="ptl-note" style="padding:0">' + formHtml(S) + "</div>";
          var out = Number(p.out_of_stock) === 1;
          return '<div class="ptl-row" data-prow="' + p.id + '"><span class="w"><b>' + esc(p.description) + '</b><span class="s">' + esc([p.stock_code, p.barcode].filter(Boolean).join(" · ")) + ([p.stock_code, p.barcode].filter(Boolean).length ? " · " : "") +
            eur(p.cost_excl_vat) + " before VAT · VAT " + (Number(p.vat_rate) || 0) + "%" + (Number(p.qty_free) > 0 ? " · " + Number(p.qty_purchased) + " + " + Number(p.qty_free) + " free" : "") + (p.batch ? " · batch " + esc(p.batch) : "") + (expDay(p.expiry_date) ? " · expires " + esc(nice(expDay(p.expiry_date))) : (p.expiry_date ? " · expiry " + esc(p.expiry_date) : "")) + "</span>" +
            (out ? '<em class="ptl-chip bad">Out of stock</em>' : "") + expiryChip(p) + '</span><span class="acts">' +
            '<button type="button" class="ptl-btn" data-stock="' + p.id + '" data-out="' + (out ? 0 : 1) + '" aria-label="' + esc((out ? "Back in stock: " : "Out of stock: ") + p.description) + '"' + (S.busy ? " disabled" : "") + ">" + (S.busy === p.id ? "Saving…" : out ? "Back in stock" : "Out of stock") + "</button>" +
            '<button type="button" class="ptl-btn" data-edit="' + p.id + '" aria-label="' + esc("Change " + p.description) + '">Change</button></span></div>';
        }).join("") + "</div>" + E.listPage.moreHtml("ptl:prod:" + S.filter, pg, "ptl-btn")
          : '<div class="ptl-quiet">' + (q ? "No product matches “" + esc(S.q) + "”." : S.filter === "all" ? "No products yet. Press Add product, or import your price list in the classic screen." : "None.") + "</div>";
      }
      h += footHtml("Importing a price list from a spreadsheet, and deleting several products at once, are in the classic layout (Account › Classic layout).") + "</div>";
      var keepQ = document.activeElement && document.activeElement.id === "ptl-pq", caret = keepQ ? document.activeElement.selectionStart : 0;
      m.innerHTML = h;
      if (keepQ) { var qi = m.querySelector("#ptl-pq"); qi.focus(); try { qi.setSelectionRange(caret, caret); } catch (e) {} }
      var qEl = m.querySelector("#ptl-pq"), qt = null;
      qEl.addEventListener("input", function () { clearTimeout(qt); qt = setTimeout(function () { S.q = qEl.value; S.paintNow(); }, 120); });
      m.querySelectorAll("[data-filter]").forEach(function (b) { b.addEventListener("click", function () { S.filter = b.getAttribute("data-filter"); S.paintNow(); focusSoon(m, '[data-filter="' + S.filter + '"]'); }); });
      m.querySelector('[data-act="add"]').addEventListener("click", function () { S.form = { id: null, v: { vat_rate: 18, qty_purchased: 1, qty_free: 0 } }; S.err = []; S.paintNow(); focusSoon(m, "#ptl-pf [name=description]"); });
      m.querySelectorAll("[data-edit]").forEach(function (b) { b.addEventListener("click", function () { var p = all.find(function (x) { return x.id === Number(b.getAttribute("data-edit")); }); S.form = { id: p.id, v: Object.assign({}, p) }; S.err = []; S.paintNow(); focusSoon(m, "#ptl-pf [name=description]"); }); });
      m.querySelectorAll("[data-stock]").forEach(function (b) { b.addEventListener("click", function () { var id = Number(b.getAttribute("data-stock")); stockStatus(S, id, b.getAttribute("data-out") === "1", '[data-stock="' + id + '"]'); }); });
      m.querySelectorAll('[data-act="q58-more"]').forEach(function (b) { b.addEventListener("click", function () { var id = E.listPage.more(b.getAttribute("data-key")); S.paintNow(); if (id) focusSoon(m, '[data-edit="' + id + '"]'); }); });
      var r = m.querySelector('[data-act="retry"]'); if (r) r.addEventListener("click", function () { E.modules.supproducts.ptlRefresh(); });
      wireForm(S);
      if (S.focusForm) { S.focusForm = false; var fp = m.querySelector("#ptl-pf"); if (fp) { try { fp.scrollIntoView({ block: "center" }); } catch (e) {} focusSoon(m, "#ptl-pf [name=description]"); } }
    }
  });
  function fmt2(n) { return (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function formHtml(S) {
    var v = S.form.v, isEdit = !!S.form.id, miss = S.miss || [];
    var h = '<form class="ptl-form" id="ptl-pf" novalidate' + (isEdit ? ' style="margin:0;border:0;border-radius:0;border-left:3px solid var(--accent)"' : "") + "><h2>" + (isEdit ? "Change " + esc(S.form.v.description || "") : "Add a product") + "</h2>";
    PF.forEach(function (f) {
      var k = f[0], val = v[k] == null ? "" : v[k], inv = miss.indexOf(k) >= 0 ? ' aria-invalid="true"' : "";
      if (f[2] === "vat") { h += '<label><span>' + f[1] + '</span><select name="vat_rate">' + [0, 5, 18].map(function (r) { return '<option value="' + r + '"' + (Number(val) === r ? " selected" : "") + ">" + r + "%</option>"; }).join("") + "</select></label>"; return; }
      if (f[2] === "date") { var dd = expDay(val); h += '<label><span>' + f[1] + '</span><input name="expiry_date" type="date" value="' + esc(dd) + '"></label>' + (val && !dd ? '<div class="hint">Saved as “' + esc(val) + '”: choose the day to replace it, or leave it as it is.</div>' : ""); return; }
      var num = f[2] === "num" || f[2] === "int", shown = num && val !== "" ? (f[2] === "int" ? String(Math.round(Number(val) || 0)) : fmt2(val)) : val;
      if (num && !isEdit && val === "" ) shown = "";
      if (k === "cost_incl_vat" && !(Number(val) > 0)) shown = ""; // never "0.00" as a price: empty sends 0, as the classic form's untouched field
      h += '<label><span>' + f[1] + (k === "description" || k === "cost_excl_vat" || k === "retail_price" ? "" : "") + '</span><input name="' + k + '"' + (num ? ' inputmode="decimal"' : "") + ' value="' + esc(shown) + '"' + inv +
        (k === "description" ? ' placeholder="e.g. Augmentin 625mg x14" autocomplete="off"' : k === "cost_incl_vat" ? ' placeholder="Optional"' : num ? ' placeholder="0"' : ' placeholder="Optional"') + "></label>";
    });
    h += (S.err && S.err.length ? '<div class="ptl-err" role="alert">' + esc(S.err.join(" ")) + "</div>" : "") +
      '<div class="acts">' + (isEdit ? '<button type="button" class="ptl-btn bad" data-act="del"' + (S.saving ? " disabled" : "") + ">Delete product</button>" : "") +
      '<button type="button" class="ptl-btn" data-act="cancel">Cancel</button><button type="submit" class="ptl-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : isEdit ? "Save changes" : "Add product") + "</button></div>";
    if (S.askDel) h += '<div class="ptl-ask" role="alert">Delete ' + esc(v.description) + ' from your product list? Pharmacies will no longer see it.<div class="acts"><button type="button" class="ptl-btn bad" data-act="del-yes">Yes, delete it</button><button type="button" class="ptl-btn" data-act="del-no">Keep it</button></div></div>';
    return h + "</form>";
  }
  function readForm(f, v) { PF.forEach(function (p) { var el = f.querySelector("[name=" + p[0] + "]"); if (!el) return; if (p[0] === "expiry_date" && !el.value && v.expiry_date && !expDay(v.expiry_date)) return; v[p[0]] = el.value; }); return v; }
  function wireForm(S) {
    var m = S.mount, f = m.querySelector("#ptl-pf"); if (!f) return;
    var close = function () { var was = S.form && S.form.id; S.form = null; S.err = []; S.miss = []; S.askDel = false; S.paintNow(); focusSoon(m, was ? '[data-edit="' + was + '"]' : '[data-act="add"]'); };
    f.addEventListener("submit", function (ev) { ev.preventDefault(); saveProduct(S, f); });
    f.addEventListener("input", function () { readForm(f, S.form.v); });
    f.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); if (S.askDel) { S.askDel = false; S.paintNow(); focusSoon(m, '[data-act="del"]'); } else close(); } });
    f.querySelector('[data-act="cancel"]').addEventListener("click", close);
    var d = f.querySelector('[data-act="del"]'); if (d) d.addEventListener("click", function () { readForm(f, S.form.v); S.askDel = true; S.paintNow(); focusSoon(m, '[data-act="del-no"]'); });
    var dy = f.querySelector('[data-act="del-yes"]'); if (dy) dy.addEventListener("click", function () { delProduct(S); });
    var dn = f.querySelector('[data-act="del-no"]'); if (dn) dn.addEventListener("click", function () { S.askDel = false; S.paintNow(); focusSoon(m, '[data-act="del"]'); });
  }
  // Add / Save: the classic Add/Edit Product body, field for field (showAddEditModal's payload). One difference, on
  // purpose: 0% VAT is sent as 0 (the classic form's "Number(…) || 18" turned a chosen 0% into 18%).
  async function saveProduct(S, f) {
    if (S.saving) return;
    var v = readForm(f, S.form.v), isEdit = !!S.form.id, num = function (k) { return Number(String(v[k] == null ? "" : v[k]).replace(",", ".")) || 0; };
    var body = { description: String(v.description || ""), stock_code: String(v.stock_code || ""), barcode: String(v.barcode || ""),
      cost_excl_vat: num("cost_excl_vat"), cost_incl_vat: num("cost_incl_vat"), vat_rate: [0, 5, 18].indexOf(Number(v.vat_rate)) >= 0 ? Number(v.vat_rate) : 18,
      discount_pct: num("discount_pct"), discount_euro: num("discount_euro"), qty_purchased: parseInt(v.qty_purchased, 10) || 1, qty_free: parseInt(v.qty_free, 10) || 0,
      batch: String(v.batch || ""), expiry_date: String(v.expiry_date || ""), retail_price: num("retail_price") };
    var probs = [];
    if (!body.description.trim()) probs.push({ field: "description", msg: "Write the product's name." });
    if (body.cost_excl_vat <= 0) probs.push({ field: "cost_excl_vat", msg: "Write the cost before VAT." });
    if (body.retail_price <= 0) probs.push({ field: "retail_price", msg: "Write the recommended retail price." });
    if (probs.length) { S.miss = probs.map(function (p) { return p.field; }); S.err = probs.map(function (p) { return p.msg; }).concat(["Nothing was saved."]); S.paintNow(); var bad = S.mount.querySelector("#ptl-pf [aria-invalid=true]"); if (bad) bad.focus(); return; }
    S.saving = true; S.err = []; S.miss = []; S.paintNow();
    var id = S.form.id;
    try {
      var r = isEdit ? await E.apiFetch("/supplier-products/entries/" + id, { method: "PUT", body: JSON.stringify(body) })
        : await E.postOnce("/supplier-products/entries", body, { list: function () { return E.apiFetch(PATH.products, { method: "GET" }).then(function (x) { return (x && x.entries) || []; }); }, same: function (p) { return p.description === body.description.trim() && Number(p.cost_excl_vat) === body.cost_excl_vat; } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.form = null; E.toast((isEdit ? "Saved · " : "Added · ") + body.description, "success");
      if (!isEdit && r.id) { id = r.id; E.listPage.reveal("ptl", id); }
    } catch (x) { S.err = [E.saveFailText(x)]; }
    S.saving = false; forget("products"); await settle(["products"], true); S.paintNow();
    focusSoon(S.mount, S.form ? "#ptl-pf [type=submit]" : '[data-edit="' + id + '"]');
  }
  // Delete: the classic row's ✕ (DELETE …/entries/:id).
  async function delProduct(S) {
    if (S.saving || !S.form || !S.form.id) return;
    var id = S.form.id, name = S.form.v.description;
    S.saving = true; S.paintNow();
    try {
      var r = await E.apiFetch("/supplier-products/entries/" + id, { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Delete failed");
      S.form = null; S.askDel = false; E.toast("Deleted · " + name, "success");
    } catch (x) { S.err = [E.saveFailText(x)]; S.askDel = false; }
    S.saving = false; forget("products"); await settle(["products"], true); S.paintNow(); focusSoon(S.mount, S.form ? '[data-act="del"]' : '[data-act="add"]');
  }

  // ===============================================================================================================
  // HEAD OFFICE
  // ===============================================================================================================
  // (18:05, after FIN-dayzero) each pharmacy's start day (/hq/stock `since`, the worker's locationSince): nothing before
  // it is blamed. Its figures from How we're doing are clipped to it before they are read for "Needs someone" and cards.
  var sinceOf = {};
  function clipStart(p, since) {
    if (!since || !p) return p;
    var g = Object.assign({}, p.registers || {}), on = function (d) { return String(d || "").slice(0, 10) >= since; };
    g.temperature_gaps = (g.temperature_gaps || []).map(function (x) { var ds = (x.days || []).filter(on); return Object.assign({}, x, { days: ds, missing: ds.length, first: ds[0] || x.first }); }).filter(function (x) { return x.days.length; });
    g.eod_not_closed = (g.eod_not_closed || []).filter(on); g.eod_not_locked = (g.eod_not_locked || []).filter(on);
    g.cleaning_empty_weeks = (g.cleaning_empty_weeks || []).filter(function (w) { return addDays(String(w).slice(0, 10), 6) >= since; });
    return Object.assign({}, p, { registers: g });
  }
  function youngNeeds(lines, since) { // the first week: no "no cleaning yet"; the first month: no "never counted"
    if (!since) return lines; var age = diffDays(since, today());
    return lines.filter(function (n) { return !(age < 7 && /No cleaning recorded yet/.test(n.text)) && !(age < 31 && /never been counted/.test(n.text)); });
  }
  function startedText(since) { if (!since) return ""; var n = diffDays(since, today()); return n <= 0 ? "Started today" : n < 31 ? "Started " + nice(since) : ""; }
  // Working days (Monday to Saturday, as the classic overview counts them) from `from` to `to`, both included.
  function workDays(from, to) { var n = 0; for (var d = from; d <= to; d = addDays(d, 1)) if (new Date(d + "T12:00:00Z").getUTCDay() !== 0) n++; return n; }
  function ownOpen(loc) { // How we're doing, on one pharmacy (its own remembered choice, as its own select does)
    try { var o = JSON.parse(localStorage.getItem("eikon_own_view") || "null") || {}; o.loc = String(loc); localStorage.setItem("eikon_own_view", JSON.stringify(o)); } catch (e) {}
    try { if (E.owner && E.owner.state) E.owner.state.loc = String(loc); } catch (e) {}
    window.location.hash = "#ownreg";
  }
  var HQ = screen("hqhome", "Today", {
    load: function (S, force) { return settle(["summary", "stock"], force); },
    open: function (S) { S.all = false; },
    paint: function (S) {
      var m = S.mount, u = user(), t = today(), sum = D.summary, st = D.stock;
      var phs = (st && st.pharmacies) || (sum && sum.pharmacies) || [];
      var h = '<div class="ptl" data-ptl="hqhome"><div class="ptl-top"><div><h1>Today</h1><p class="ptl-sub">' + esc(u.org_name || u.location_name || "") + (phs.length ? " · " + plural(phs.length, "pharmacy", "pharmacies") : "") + " · " + esc(nice(t, true)) + "</p></div>" +
        (sum ? '<button type="button" class="ptl-btn" data-act="own">How we\'re doing ›</button>' : "") + "</div>";
      var loading = (!sum && !D.err.summary) || (!st && !D.err.stock);
      if (loading) { m.innerHTML = h + (E.skeleton ? E.skeleton(4, "the pharmacies") : '<div class="ptl-quiet">Opening…</div>') + "</div>"; return; }
      if (!sum && !st) { m.innerHTML = h + '<div class="ptl-quiet" role="alert">' + esc(D.err.summary === "forbidden" ? D.err.stock : D.err.summary) + '<button type="button" class="ptl-btn" data-act="retry">Try again</button></div></div>'; wire(); return; }
      var byId = {}; ((sum && sum.pharmacies) || []).forEach(function (p) { byId[p.id] = p; });
      var stock = {}; ((st && st.pharmacies) || []).forEach(function (p) { stock[p.id] = p; });
      if (!phs.length) { m.innerHTML = h + '<div class="ptl-quiet">No pharmacies are in your group yet.</div>' + footHtml("") + "</div>"; wire(); return; }
      // What needs someone: the same lines as How we're doing (E.owner.needs), worst first; then the stock alerts.
      var needs = [];
      phs.forEach(function (p) { if (stock[p.id] && stock[p.id].since) sinceOf[p.id] = stock[p.id].since; if (byId[p.id]) byId[p.id] = clipStart(byId[p.id], sinceOf[p.id]); });
      if (sum && E.owner && E.owner.needs) phs.forEach(function (p) { if (byId[p.id]) needs = needs.concat(youngNeeds(E.owner.needs(byId[p.id], t, phs.length > 1 ? p.name : ""), sinceOf[p.id])); });
      phs.forEach(function (p) { var s = stock[p.id]; if (!s) return; var pre = phs.length > 1 ? p.name + ": " : "";
        if (s.alerts.recalls) needs.push({ loc: p.id, level: "missing", text: pre + plural(s.alerts.recalls, "recall is", "recalls are") + " still open (" + s.alerts.items.filter(function (x) { return x.type === "recall"; }).map(function (x) { return x.item; }).slice(0, 3).join(", ") + ")." });
        if (s.alerts.quarantines) needs.push({ loc: p.id, level: "look", text: pre + plural(s.alerts.quarantines, "item is", "items are") + " in quarantine." });
        if (s.near_expiry.expired) needs.push({ loc: p.id, level: "look", text: pre + plural(s.near_expiry.expired, "item on the near-expiry list has", "items on the near-expiry list have") + " expired." }); });
      needs.sort(function (a, b) { return (a.level === "missing" ? 0 : 1) - (b.level === "missing" ? 0 : 1); });
      h += '<h2 class="ptl-lab">Needs someone <b>' + needs.length + "</b></h2>";
      h += needs.length ? '<div class="ptl-list">' + (S.all ? needs : needs.slice(0, 6)).map(function (n) {
        var chip = '<em class="ptl-chip ' + (n.level === "missing" ? "bad" : "warn") + '">' + (n.level === "missing" ? "Needs doing" : "Look") + "</em>";
        return sum && u.role === "admin" && n.loc != null ? '<button type="button" class="ptl-row" data-own="' + esc(n.loc) + '"><span class="w"><b style="font-weight:500">' + esc(n.text) + "</b></span>" + chip + "</button>"
          : '<div class="ptl-row"><span class="w"><b style="font-weight:500">' + esc(n.text) + "</b></span>" + chip + "</div>";
      }).join("") + (needs.length > 6 && !S.all ? '<button type="button" class="ptl-row" data-act="all"><span class="w"><b>Show all ' + needs.length + "</b></span></button>" : "") + "</div>"
        : '<div class="ptl-quiet">Nothing needs anyone: every register is in order, no recall is open and every day is closed.</div>';
      if (!sum && D.err.summary === "forbidden") h += '<p class="ptl-foot">Takings and registers show to the head office\'s admin accounts. Stock alerts are below.</p>';
      h += '<h2 class="ptl-lab">Each pharmacy</h2><div class="ptl-cards">' + phs.map(function (p0) {
        var p = byId[p0.id], s = stock[p0.id], st0 = startedText(sinceOf[p0.id]), c = '<div class="ptl-card"><h3>' + esc(p0.name) + (st0 ? ' <em class="ptl-chip" style="vertical-align:middle">' + esc(st0) + "</em>" : "") + "</h3>";
        if (p) {
          var days = (p.days || []).slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; }), last = days[0], g = p.registers || {};
          c += '<div class="ptl-kv"><span>Takings</span><div>' + (last ? eur(last.takings) + " on " + esc(nice(last.date, true)) + "<br>" : "No day closed yet<br>") + eur((p.money || {}).takings) + " this month</div></div>";
          var notClosed = (g.eod_not_closed || []).length;
          c += '<div class="ptl-kv"><span>End of day</span><div class="' + (notClosed ? "warn" : "ok") + '">' + (notClosed ? plural(notClosed, "day", "days") + " not closed" : last ? "Every day closed" : "—") + "</div></div>";
          var reg = (g.temperature_gaps || []).length + (g.temperature_out_no_note ? 1 : 0) + (g.certificates_overdue || []).length + (g.cleaning_days_since != null && g.cleaning_days_since > 7 ? 1 : 0);
          c += '<div class="ptl-kv"><span>Registers</span><div class="' + (reg ? "bad" : "ok") + '">' + (reg ? plural(reg, "thing", "things") + " to see" : "In order") + (g.cleaning_last ? '<br><span style="color:var(--muted);font-weight:400">Cleaned ' + esc(nice(g.cleaning_last)) + "</span>" : "") + "</div></div>";
          var w = (p.orders || {}).open || 0, qn = (p.questions || {}).open || 0;
          c += '<div class="ptl-kv"><span>Customers</span><div>' + plural(w, "order", "orders") + " waiting" + ((p.orders || {}).overdue ? ' <span class="bad">(' + p.orders.overdue + " late)</span>" : "") + "<br>" + plural(qn, "question", "questions") + " open</div></div>";
        }
        if (s) c += '<div class="ptl-kv"><span>Stock</span><div class="' + (s.alerts.recalls ? "bad" : s.near_expiry.within_30 || s.alerts.open ? "warn" : "ok") + '">' + (s.alerts.open ? plural(s.alerts.open, "alert", "alerts") + " open" : "No open alert") + "<br>" + plural(s.near_expiry.within_30, "item expires", "items expire") + " within 30 days" + (s.near_expiry.expired ? "<br>" + s.near_expiry.expired + " expired" : "") + "</div></div>";
        if (p) c += '<div class="acts"><button type="button" class="ptl-btn" data-own="' + p0.id + '" aria-label="' + esc("See the figures of " + p0.name) + '">See the figures ›</button></div>';
        return c + "</div>";
      }).join("") + "</div>";
      h += footHtml("") + "</div>";
      m.innerHTML = h; wire();
      function wire() {
        var o = m.querySelector('[data-act="own"]'); if (o) o.addEventListener("click", function () { ownOpen("all"); });
        var a = m.querySelector('[data-act="all"]'); if (a) a.addEventListener("click", function () { S.all = true; S.paintNow(); });
        var r = m.querySelector('[data-act="retry"]'); if (r) r.addEventListener("click", function () { E.modules.hqhome.ptlRefresh(); });
        m.querySelectorAll("[data-own]").forEach(function (b) { b.addEventListener("click", function () { ownOpen(b.getAttribute("data-own")); }); });
      }
    }
  });

  // ---- Registers: the classic Pharmacy Overview (GET /admin/pharmacy-overview?month=) in words ---------------------
  var HR = screen("hqregs", "Registers", {
    open: function (S) { S.month = S.month || today().slice(0, 7); },
    load: function (S, force) {
      if (!force && S.data && S.data.month === S.month) return null;
      S.loading = true; S.err = "";
      return Promise.all([E.apiFetch("/admin/pharmacy-overview?month=" + S.month, { method: "GET" }).then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "Could not load"); S.data = r; }, function (e) { S.err = errText(e); }),
        settle(["stock"])]).then(function () { S.loading = false; ((D.stock && D.stock.pharmacies) || []).forEach(function (p) { if (p.since) sinceOf[p.id] = p.since; }); }); // each pharmacy's start day (cached a minute)
    },
    paint: function (S) {
      var m = S.mount, d = S.data && S.data.month === S.month ? S.data : null, cur = today().slice(0, 7);
      var label = function (ym) { var p = ym.split("-"); return MONTHS[Number(p[1]) - 1] + " " + p[0]; };
      var h = '<div class="ptl" data-ptl="hqregs"><div class="ptl-top"><div><h1>Registers</h1><p class="ptl-sub">Each pharmacy\'s registers for a month: what was filled in, and when it was last written.</p></div>' +
        '<button type="button" class="ptl-btn ptl-noprint" data-act="print"' + (d ? "" : " disabled") + ">Print</button></div>" +
        '<div class="ptl-mon ptl-noprint"><button type="button" class="ptl-btn" data-act="prev" aria-label="Month before">‹</button><b aria-live="polite">' + esc(label(S.month)) + '</b><button type="button" class="ptl-btn" data-act="next" aria-label="Month after"' + (S.month >= cur ? " disabled" : "") + ">›</button>" +
        (S.month !== cur ? '<button type="button" class="ptl-btn" data-act="now">This month</button>' : "") + "</div>";
      if (!d && S.err) h += '<div class="ptl-quiet" role="alert" style="margin-top:14px">' + esc(S.err) + '<button type="button" class="ptl-btn" data-act="retry">Try again</button></div>';
      else if (!d) h += E.skeleton ? E.skeleton(4, "the registers") : '<div class="ptl-quiet">Opening…</div>';
      else if (!(d.pharmacies || []).length) h += '<div class="ptl-quiet" style="margin-top:14px">No pharmacies are in your group yet.</div>';
      else h += regsHtml(d);
      h += footHtml("") + "</div>";
      m.innerHTML = h;
      var on = function (a, fn) { var b = m.querySelector('[data-act="' + a + '"]'); if (b) b.addEventListener("click", fn); };
      var shift = function (k) { var p = S.month.split("-"), dt = new Date(Date.UTC(Number(p[0]), Number(p[1]) - 1 + k, 1)); S.month = dt.toISOString().slice(0, 7); if (S.month > cur) S.month = cur; S.paintNow(); HR_load(S); };
      on("prev", function () { shift(-1); focusSoon(m, '[data-act="prev"]'); }); on("next", function () { shift(1); focusSoon(m, '[data-act="next"]'); }); on("now", function () { S.month = cur; S.paintNow(); HR_load(S); focusSoon(m, '[data-act="prev"]'); });
      on("retry", function () { HR_load(S, true); });
      on("print", function () { printRegs(d, label(S.month)); });
      m.querySelectorAll("[data-own]").forEach(function (b) { b.addEventListener("click", function () { ownOpen(b.getAttribute("data-own")); }); });
    }
  });
  function HR_load(S, force) {
    if (force) S.data = null;
    S.err = ""; S.paintNow();
    var want = S.month;
    return E.apiFetch("/admin/pharmacy-overview?month=" + want, { method: "GET" })
      .then(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "Could not load"); if (S.month === want) S.data = r; }, function (e) { if (S.month === want) S.err = errText(e); })
      .then(function () { S.paintNow(); });
  }
  // One cell in words, with the classic thresholds: a daily register is in order at 90% of the working days so far
  // (Monday to Saturday), to look at from 70%; a book not written for 7 days is to look at.
  function regCells(d, id) {
    var wd = d.working_days || 0, k = String(id), out = [], since = sinceOf[id] || "";
    // a pharmacy that started during this month: its working days count from its start (none before it is blamed)
    if (since && since > d.month + "-01") { var last = d.month === today().slice(0, 7) ? today() : addDays(new Date(Date.UTC(Number(d.month.slice(0, 4)), Number(d.month.slice(5, 7)), 1)).toISOString().slice(0, 10), -1); wd = since > last ? 0 : workDays(since, last); }
    var daily = function (name, sec, what, weekly) {
      var x = (d[sec] || {})[k], n = x ? x.days_with_entries || 0 : 0, r = wd ? n / wd : 1;
      var cls = !x ? "bad" : r >= 0.9 ? "ok" : r >= 0.7 ? "warn" : "bad";
      if (weekly && x) cls = n >= Math.ceil(wd / 6) ? "ok" : "warn"; // cleaning is due once a week, not every day
      if (!x && (wd <= 1 || (weekly && wd < 6))) cls = ""; // just started: nothing due yet, nothing blamed
      out.push({ name: name, cls: cls, text: !x && wd === 0 ? (since ? startedText(since) || "Not open yet" : "Not open yet") : !x ? "Nothing " + what + " yet" : (n >= wd ? "Every working day" : n + " of " + wd + " working days") + (n > wd ? " (" + n + " days in all)" : ""), sub: x && x.last_created_at ? "Last written " + when(x.last_created_at) : "" });
    };
    var book = function (name, sec) {
      var x = (d[sec] || {})[k];
      if (!x || !x.entry_count) { out.push({ name: name, cls: "", text: "No lines this month", sub: "" }); return; }
      var last = stamp(x.last_created_at), old = last && (Date.now() - last.getTime()) / 864e5 > 7;
      out.push({ name: name, cls: old ? "warn" : "ok", text: plural(x.entry_count, "line", "lines"), sub: x.last_created_at ? "Last written " + when(x.last_created_at) : "" });
    };
    daily("Temperature", "temperature", "logged"); daily("Cleaning", "cleaning", "recorded", true);
    book("Daily register", "daily_register"); book("Controlled drugs supplied", "dda_sales"); book("POYC controlled drugs", "dda_poyc"); book("Controlled drugs received", "dda_purchases");
    var stt = (d.dda_stocktakes || {})[k];
    out.push({ name: "Controlled drug count", cls: !stt ? "" : stt.is_closed ? "ok" : "warn", text: !stt ? "No count yet" : "Last " + (stt.last_stocktake_date ? nice(String(stt.last_stocktake_date).slice(0, 10)) : "count"), sub: stt ? (stt.is_closed ? "Closed" : "Still open") : "" });
    var ce = (d.certificates || {})[k];
    out.push({ name: "Certificates", cls: !ce ? "" : ce.expired_count ? "bad" : ce.missing_file_count ? "warn" : "ok", text: !ce || !ce.total_certs && !ce.expired_count ? "None on file" : ce.expired_count ? plural(ce.expired_count, "expired", "expired") + (ce.missing_file_count ? ", " + ce.missing_file_count + " without a file" : "") : ce.missing_file_count ? plural(ce.missing_file_count, "without a file", "without a file") : "All in date (" + ce.total_certs + ")", sub: "" });
    book("Locum register", "locum_register");
    var rp = (d.repeat_prescriptions || {})[k];
    out.push({ name: "Repeat prescriptions", cls: !rp || !rp.total_count ? "" : rp.expired_count ? "bad" : "ok", text: !rp || !rp.total_count ? "None on file" : plural(rp.total_count, "on file", "on file") + (rp.expired_count ? ", " + rp.expired_count + " run out" : ""), sub: "" });
    return out;
  }
  function regsHtml(d) {
    var ph = d.pharmacies, cells = ph.map(function (p) { return regCells(d, p.id); }), own = user().role === "admin";
    // W24: the days behind a cell are in How we're doing (each fridge's missing days, cleaning weeks, days not closed).
    var name = function (p) { return own ? '<button type="button" class="ptl-btn" data-own="' + p.id + '" aria-label="' + esc("Which days, at " + p.name) + '">' + esc(p.name) + " ›</button>" : esc(p.name); };
    var h = '<p class="ptl-sub" style="margin-top:12px">' + plural(d.working_days || 0, "working day", "working days") + " so far (Monday to Saturday)." + (own ? " Press a pharmacy to see which days are missing." : "") + "</p>";
    // Desktop: registers down, pharmacies across. Phone: one card per pharmacy.
    h += '<div class="ptl-wide ptl-desk" style="margin-top:10px"><table class="ptl-grid"><thead><tr><th scope="col">Register</th>' + ph.map(function (p) { return '<th scope="col">' + name(p) + "</th>"; }).join("") + "</tr></thead><tbody>";
    cells[0].forEach(function (row, i) {
      h += '<tr><th scope="row">' + esc(row.name) + "</th>" + cells.map(function (c) { var x = c[i]; return '<td><span class="' + x.cls + '">' + esc(x.text) + "</span>" + (x.sub ? "<small>" + esc(x.sub) + "</small>" : "") + "</td>"; }).join("") + "</tr>";
    });
    h += "</tbody></table></div>";
    h += '<div class="ptl-cards ptl-phone" style="margin-top:10px">' + ph.map(function (p, j) {
      return '<div class="ptl-card"><h3>' + name(p) + "</h3>" + cells[j].map(function (x) { return '<div class="ptl-kv"><span>' + esc(x.name) + '</span><div><span class="' + x.cls + '">' + esc(x.text) + "</span>" + (x.sub ? '<br><span style="color:var(--muted)">' + esc(x.sub) + "</span>" : "") + "</div></div>"; }).join("") + "</div>";
    }).join("") + "</div>";
    return h + "<style>.ptl-phone{display:none}@media (max-width:760px){.ptl-desk{display:none}.ptl-phone{display:grid}}</style>";
  }
  function printRegs(d, label) {
    if (!d) return;
    var ph = d.pharmacies, cells = ph.map(function (p) { return regCells(d, p.id); }), u = user();
    var h = "<!doctype html><html><head><meta charset=utf-8><title>Registers " + esc(label) + "</title><style>body{font:12px Arial,sans-serif;color:#000;background:#fff;margin:16mm}h1{font-size:18px;margin:0 0 4px}p{margin:0 0 10px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:5px 6px;text-align:left;vertical-align:top}th{background:#eee}small{display:block;color:#444}@page{margin:12mm}</style></head><body>" +
      "<h1>Registers · " + esc(label) + "</h1><p>" + esc(u.org_name || u.location_name || "") + " · " + plural(d.working_days || 0, "working day", "working days") + " · printed " + esc(nice(today())) + " " + esc(E.maltaHm()) + "</p><table><thead><tr><th>Register</th>" + ph.map(function (p) { return "<th>" + esc(p.name) + "</th>"; }).join("") + "</tr></thead><tbody>";
    cells[0].forEach(function (row, i) { h += "<tr><th>" + esc(row.name) + "</th>" + cells.map(function (c) { return "<td>" + esc(c[i].text) + (c[i].sub ? "<small>" + esc(c[i].sub) + "</small>" : "") + "</td>"; }).join("") + "</tr>"; });
    h += "</tbody></table></body></html>";
    if (E.openPrint) E.openPrint(h, { title: "Registers " + label }); else { var w = window.open("", "_blank"); if (w) { w.document.write(h); w.document.close(); w.print(); } }
  }

  // ---- The client's own screens (org 12 only: E.orgOnly; the worker answers /cherubino/* to org 12 only) ----------
  E.registerModule({ id: "hqclient", title: "Cherubino", order: 3, icon: "◯", ui2Only: true,
    render: function (ctx) {
      var m = ctx.mount; css();
      var cards = [["cherubino-admin", "Orders from the pharmacies", "Each pharmacy's order for a day, with out of stock, ordered and at the warehouse ticked off."],
        ["cherubino-prices", "Price changes", "Price changes sent to the pharmacies, and which pharmacy has changed its labels."],
        ["cherubino-shortexpiry", "Warehouse short expiry", "The warehouse's short-dated stock: upload the list, see what each pharmacy ordered."],
        ["cherubino-oos", "Out-of-stock list", "Items out of stock at the warehouse, and the ones the pharmacies asked to add."]];
      m.innerHTML = '<div class="ptl" data-ptl="hqclient"><div class="ptl-top"><div><h1>Cherubino</h1><p class="ptl-sub">Your group\'s own screens. They open in the classic screen.</p></div></div><div class="ptl-hub" style="margin-top:16px">' +
        cards.map(function (c) { return '<button type="button" data-open="' + c[0] + '"><b>' + esc(c[1]) + "</b><span>" + esc(c[2]) + "</span></button>"; }).join("") + "</div></div>";
      m.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { classicLink(b.getAttribute("data-open"), "hqclient"); }); });
    } });

  // ---- Account (both portals) -----------------------------------------------------------------------------------
  E.registerModule({ id: "ptlacct", title: "Account", order: 3, icon: "◯", ui2Only: true,
    render: function (ctx) {
      var m = ctx.mount, u = user(); css();
      var A = [
        ["You", [["pw", "Password", "Change the password you sign in with."], ["install", "Add to desktop or home screen", "Open Eikon with one tap, in its own window, like an app."], ["out", "Sign out", "Sign out on this device."]]],
        ["Help", [["help", "Help & guides", "A short guide to every screen. The ? beside a screen's name opens its guide."], ["classic", "Classic layout", "The previous look, with the old sidebar, on this browser. Its Use the new layout button brings you back."]]]
      ];
      if (E.getRolesForUser && E.getRolesForUser(u).length > 1) A[0][1].push(["switch", "Switch portal", "Open another of your portals."]);
      m.innerHTML = '<div class="ptl" data-ptl="ptlacct"><div class="ptl-top"><div><h1>Account</h1><p class="ptl-sub">' + esc(u.full_name || u.email || "") + " · " + esc(u.location_name || "") + "</p></div></div>" +
        A.map(function (g) { return '<h2 class="ptl-lab">' + esc(g[0]) + '</h2><div class="ptl-hub">' + g[1].map(function (c) { return '<button type="button" data-a="' + c[0] + '"><b>' + esc(c[1]) + "</b><span>" + esc(c[2]) + "</span></button>"; }).join("") + "</div>"; }).join("") + "</div>";
      m.querySelectorAll("[data-a]").forEach(function (b) { b.addEventListener("click", function () {
        var a = b.getAttribute("data-a");
        if (a === "pw") E.showChangePassword();
        else if (a === "install") { if (E.install) E.install.open(); }
        else if (a === "out") E.logout();
        else if (a === "help") { if (E.openHelpNext) E.openHelpNext(); else E.showHelpGuide(); }
        else if (a === "switch") { E.state.activeRole = ""; try { localStorage.removeItem("eikon_active_role"); } catch (e) {} E.renderRoleSelection(E.getRolesForUser(u)); }
        else if (a === "classic") { try { localStorage.setItem("eikon_ui2", "0"); } catch (e) {} var to = new URL(window.location.href); to.searchParams.set("ui", "1"); to.hash = "#" + (E.portalNow() === "supplier" ? "supplier-dashboard" : "company-dashboard"); window.location.href = to.toString(); }
      }); });
    } });
})();
