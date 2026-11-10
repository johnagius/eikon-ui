/* ============================================================
   EIKON — Today's services  (eikon.svctoday.js, svc-hub)
   The first thing on Services: who is waiting for care today and what is unfinished. One calm list, what needs doing
   first: a booking that started and is not marked, screening follow-ups due or overdue, vaccine doses due, reaction
   reports not sent yet (a serious one red and first, John 2026-11-09), a vaccine batch past its expiry still in stock; then today's bookings still to come, the
   campaign running, batches expiring soon, and what was done today (tests, vaccine orders). One tap into the right
   screen, on the right person where the screen can take it (sessionStorage eikon_svc_open, contract V-C2; a booking
   through Bookings' own eikon_bk_open). The same answer puts a short status under the hub's own cards.
   Cost: ONE read, GET /services/today (bounded statements on the server, each by the pharmacy and a date, a short
   range or a LIMIT), when the hub opens; within a minute of the last answer, for the same pharmacy and with nothing
   saved since, nothing is asked. No timer. Today is not touched (it is re-read every minute).
   Rights are the server's: admin and staff, as the screens behind it. Anyone else (403), or a server without the
   route (404), sees the cards as before, with no list and no status.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var FRESH_MS = 60000, PER_GROUP = 5;
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDAY = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var S = { data: null, at: 0, loc: "", job: null, error: "", hidden: false, slot: null, list: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function diff(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86400000); }
  function day(s) { // "Mon 9 Nov"
    var a = String(s || "").split("-"); if (a.length !== 3) return String(s || "");
    return WDAY[new Date(s + "T12:00:00Z").getUTCDay()] + " " + Number(a[2]) + " " + SHORT[+a[1] - 1];
  }
  function dueWords(date, today, todayWord) { // V-W: "Due today" / "Overdue · 3 days"
    var n = diff(date, today);
    return n <= 0 ? (todayWord || "Due today") : "Overdue · " + plural(n, "day");
  }

  // The dose GIVEN is stored; the one due is the next. Vaccines' own words first (modules.vaxreg.js DOSES: "Dose 1" ->
  // "Dose 2", "Dose 2" -> "Dose 3", "Dose 3"/"Booster" -> "Booster"), then the "1st"/"2nd" style the first contract named.
  var VAX_DOSES = ["Dose 1", "Dose 2", "Dose 3", "Booster", "Only dose"];
  function nextDose(given) {
    var g = String(given || "").trim(), i = VAX_DOSES.indexOf(g);
    if (i >= 0) return i <= 1 ? VAX_DOSES[i + 1] : i <= 3 ? "Booster" : "Next dose";
    var m = /^(\d+)/.exec(g);
    if (m) return "Dose " + (Number(m[1]) + 1);
    return /^booster$/i.test(g) ? "Booster" : "Next dose";
  }

  // ---------- the list (pure: the same data always gives the same list) ----------
  // Each item: { key, title, status: problem | todo | info | done, text, hot?, act, aria?, go: { to, ... } }
  function items(D, opts) {
    if (!D) return [];
    opts = opts || {};
    var today = D.date, out = [], add = function (o) { out.push(o); };
    var hasBookings = opts.bookings !== false;

    // Bookings: started and not marked first (to do), then the ones still to come (one row each, at most five)
    var bs = D.bookings_summary, bl = D.bookings || [], now = String(D.time || "");
    if (bs && hasBookings) {
      var open = bl.filter(function (b) { return b.status === "booked" || b.status === "confirmed"; });
      var late = open.filter(function (b) { return String(b.start_time) < now; }), next = open.filter(function (b) { return String(b.start_time) >= now; });
      late.slice(0, PER_GROUP).forEach(function (b) {
        add({ key: "bk:" + b.id, title: b.start_time + " · " + b.person_name, status: "todo", text: "Not marked yet. " + (b.service ? b.service + "." : ""), hot: "Not marked yet", act: "Open", aria: "Open the " + b.start_time + " booking for " + b.person_name, go: { to: "bookings", id: b.id, date: today } });
      });
      next.slice(0, PER_GROUP).forEach(function (b) {
        add({ key: "bk:" + b.id, title: b.start_time + " · " + b.person_name, status: "info", text: b.service || "Booking", act: "Open", aria: "Open the " + b.start_time + " booking for " + b.person_name, go: { to: "bookings", id: b.id, date: today } });
      });
      var shown = Math.min(late.length, PER_GROUP) + Math.min(next.length, PER_GROUP), restOpen = (bs.late + bs.to_come) - shown;
      var doneBits = [];
      if (bs.arrived) doneBits.push(plural(bs.arrived, "here now", "here now"));
      if (bs.done) doneBits.push(bs.done + " done");
      if (bs.no_show) doneBits.push(plural(bs.no_show, "no-show"));
      if (!bs.total) add({ key: "bk", title: "Bookings", status: "info", text: "No bookings today.", act: "Book", go: { to: "bookings" } });
      else if (restOpen > 0 || doneBits.length || !open.length) {
        add({ key: "bk", title: "Bookings", status: "info", text: (restOpen > 0 ? "And " + plural(restOpen, "more booking") + " today. " : !open.length ? "Nobody else booked today. " : "") + (doneBits.length ? doneBits.join(", ") + "." : ""), act: "Open", aria: "Open today in Bookings", go: { to: "bookings", date: today } });
      }
    }

    // Screening follow-ups due or overdue (to do), at most five, then "and N more"
    var fu = D.followups;
    if (fu && fu.count) {
      (fu.due || []).slice(0, PER_GROUP).forEach(function (f) {
        var w = dueWords(f.date, today);
        add({ key: "fu:" + f.campaign_id + ":" + f.participant_id + ":" + f.date, title: f.name + " · follow-up", status: "todo", text: w + ". " + (f.reason ? f.reason + ", " : "") + f.campaign + ".", hot: w, act: "Open", aria: "Open " + f.name + "'s screening", go: { to: "scrreg", c: f.campaign_id, p: f.participant_id } });
      });
      if (fu.count > PER_GROUP) add({ key: "fu:more", title: "Screening follow-ups", status: "todo", text: "And " + plural(fu.count - PER_GROUP, "more follow-up") + " due.", act: "Open", aria: "Open every follow-up due", go: { to: "scrreg", f: "followups" } });
    }

    // Vaccine doses due (vax's record, once it is in): at most five
    var vx = D.vaccines, vd = vx && vx.due;
    if (vd && vd.count) {
      (vd.first || []).slice(0, PER_GROUP).forEach(function (x) {
        var n = diff(x.next_due, today), nx = nextDose(x.dose), w = n <= 0 ? nx + " due today" : "Overdue · " + plural(n, "day");
        add({ key: "vd:" + x.id, title: x.name + " · " + x.vaccine, status: "todo", text: w + "." + (n > 0 ? " " + nx + " was due on " + day(x.next_due) + "." : ""), hot: w, act: "Open", aria: "Open " + x.name + "'s dose due in Vaccines", go: { to: "vaxreg", f: "due", p: x.id } });
      });
      if (vd.count > PER_GROUP) add({ key: "vd:more", title: "Vaccine doses", status: "todo", text: "And " + plural(vd.count - PER_GROUP, "more dose") + " due.", act: "Open", go: { to: "vaxreg", f: "due" } });
    }

    // Reaction reports not sent yet. John (2026-11-09): a SERIOUS one not sent is a problem (red, first); the others stay
    // to do (amber). One row for the serious ones, one for the rest; both open the reports not sent yet.
    var pv = D.pv;
    if (pv && pv.drafts) {
      var reps = pv.reports || [], nSer = Math.min(pv.serious || 0, pv.drafts), nOk = pv.drafts - nSer;
      var ser = reps.filter(function (r) { return r.serious; }), oks = reps.filter(function (r) { return !r.serious; });
      var from = function (r, many) { var a = r && r.date ? diff(r.date, today) : 0; return r && r.date ? (many ? ", the oldest" : "") + " from " + day(r.date) + (a > 0 ? " (" + plural(a, "day") + ")" : "") : ""; };
      var what = function (r) { return r && r.reaction ? " " + r.reaction + (r.medicine ? " after " + r.medicine : "") + "." : ""; };
      if (nSer) add({ key: "pv:s", title: "Adverse reactions · serious", status: "problem",
        text: "Serious, not sent yet: " + plural(nSer, "report") + from(ser[0], nSer > 1) + "." + what(ser[0]),
        hot: "Serious, not sent yet", act: "Open", aria: "Open the serious reports not sent yet", go: { to: "pvreg", f: "draft" } });
      // the oldest not serious: the server sends the five oldest reports, so when none of them is one, no date
      if (nOk) add({ key: "pv", title: "Adverse reactions", status: "todo",
        text: "Not sent yet: " + plural(nOk, "report") + (nSer ? (oks[0] ? from(oks[0], nOk > 1) : "") : pv.oldest_draft_date ? from({ date: pv.oldest_draft_date }, nOk > 1) : "") + "." + (nOk === 1 ? what(oks[0]) : ""),
        hot: "Not sent yet", act: "Open", aria: "Open the reports not sent yet", go: { to: "pvreg", f: "draft" } });
    }

    // Vaccine stock: a batch past its expiry still held (to do); batches expiring within 30 days (status line only)
    if (vx && (vx.expired || vx.expiring30)) {
      var bt = vx.batches || [], ex = bt.filter(function (b) { return b.expiry < today; }), so = bt.filter(function (b) { return b.expiry >= today; });
      var name = function (b) { return b.name + (b.batch ? " (batch " + b.batch + ")" : ""); };
      if (vx.expired) add({ key: "vs:x", title: "Vaccine stock", status: "todo", text: (vx.expired === 1 && ex[0] ? name(ex[0]) + " expired on " + day(ex[0].expiry) + " and is still in stock." : plural(vx.expired, "batch", "batches") + " past their expiry are still in stock" + (ex[0] ? ", the first " + name(ex[0]) : "") + "."), hot: "expired", act: "Open", aria: "Open vaccine stock", go: { to: "vaxreg", f: "stock" } });
      if (vx.expiring30) add({ key: "vs:s", title: "Vaccine stock", status: "info", text: (vx.expiring30 === 1 && so[0] ? name(so[0]) + " expires on " + day(so[0].expiry) + "." : plural(vx.expiring30, "batch expires", "batches expire") + " within " + (vx.soon_days || 30) + " days" + (so[0] ? ", the first " + name(so[0]) + " on " + day(so[0].expiry) : "") + "."), hot: vx.expiring30 === 1 ? "expires on " + day((so[0] || {}).expiry) : "within " + (vx.soon_days || 30) + " days", hotCls: "todo", act: "Open", aria: "Open vaccine stock", go: { to: "vaxreg", f: "stock" } });
    }

    // A screening campaign running today (one row each, at most two)
    var sc = D.screening;
    ((sc && sc.running) || []).slice(0, 2).forEach(function (c) {
      add({ key: "sc:" + c.id, title: c.name || "Screening campaign", status: "info", text: "Running" + (c.end ? " until " + day(c.end) : "") + ". " + c.screened + " screened" + (c.target ? " of " + c.target : "") + (c.today ? ", " + c.today + " today" : "") + ".", act: "Open", aria: "Open " + (c.name || "the campaign"), go: { to: "scrreg", c: c.id } });
    });

    // Done today: tests and vaccine orders, quietly
    var bits = [];
    if (D.poct && D.poct.today) bits.push(plural(D.poct.today, "test"));
    if (vx && vx.orders_today) bits.push(plural(vx.orders_today, "vaccine order"));
    if (D.poct) add({ key: "done", title: "Done today", status: bits.length ? "done" : "info", text: bits.length ? bits.join(" · ") + "." : "No tests recorded yet today.", act: bits.length ? "Open" : "Record a test", aria: bits.length ? "Open point-of-care tests" : "Record a point-of-care test", go: { to: "pocreg" } });
    return out;
  }
  var RANK = { problem: 0, todo: 1, info: 2, done: 3 };
  function sorted(list) { return list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return RANK[a.x.status] - RANK[b.x.status] || a.i - b.i; }).map(function (o) { return o.x; }); }
  // What is waiting, counted as things (a follow-up, a dose, a booking not marked, the reports not sent, an expired batch)
  function summary(D) {
    if (!D) return { waiting: 0, overdue: 0, toCome: 0 };
    var today = D.date, bs = D.bookings_summary || {}, fu = D.followups || {}, vd = (D.vaccines && D.vaccines.due) || {};
    var waiting = (bs.late || 0) + (fu.count || 0) + (vd.count || 0) + (D.pv && D.pv.drafts ? (D.pv.serious ? 1 : 0) + (D.pv.drafts > (D.pv.serious || 0) ? 1 : 0) : 0) + (D.vaccines && D.vaccines.expired ? 1 : 0);
    return { waiting: waiting, overdue: (fu.overdue || 0) + (vd.overdue || 0), toCome: bs.to_come || 0, today: today };
  }
  function headText(sm, opts) {
    var come = opts && opts.bookings === false ? "" : sm.toCome ? " " + plural(sm.toCome, "booking") + " still to come today." : "";
    if (sm.waiting) return plural(sm.waiting, "thing") + " waiting" + (sm.overdue ? ", " + sm.overdue + " overdue" : "") + "." + come;
    return "Nothing waiting." + come;
  }

  // ---------- reading (one request at most, shared by everyone who asks at once) ----------
  function locId() { return String((E.state && E.state.user && E.state.user.location_id) || ""); }
  function cached() { // this pharmacy's answer, under a minute old, with nothing saved since (memory only)
    return S.loc === locId() && Date.now() - S.at < FRESH_MS && S.at > (E.lastWriteAt || 0) && (S.data || S.hidden) ? (S.data || "hidden") : null;
  }
  function load(force) {
    if (!force) { var c = cached(); if (c) return Promise.resolve(c); }
    if (S.job) return S.job;
    var asked = Date.now(), loc = locId();
    S.job = E.apiFetch("/services/today", { method: "GET", timeoutMs: 12000 }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not check today's services");
      S.data = r; S.at = asked; S.loc = loc; S.error = ""; S.hidden = false;
      return r;
    }).catch(function (e) {
      var st = e && e.status;
      if (st === 403 || st === 404) { S.hidden = true; S.data = null; S.at = asked; S.loc = loc; S.error = ""; return "hidden"; } // not this person's screens, or an older server: the cards as before
      S.error = e && e.network ? "No connection, so today's services could not be checked." : "Today's services could not be checked.";
      throw e;
    }).finally(function () { S.job = null; });
    return S.job;
  }

  // ---------- opening the right screen ----------
  function go(g) {
    if (!g || !g.to) return;
    if (g.to === "bookings") {
      if (g.id || g.date) { try { sessionStorage.setItem("eikon_bk_open", JSON.stringify({ id: g.id || 0, date: g.date || "", at: Date.now() })); } catch (e) {} }
      window.location.hash = "#bookings"; return;
    }
    // V-C2: the screen takes this once on render (to = itself, under 60 s old) and opens that person or filter
    var o = { to: g.to, at: Date.now() }; ["c", "p", "f"].forEach(function (k) { if (g[k]) o[k] = g[k]; });
    try { sessionStorage.setItem("eikon_svc_open", JSON.stringify(o)); } catch (e) {}
    if (E.modules && E.modules[g.to]) { window.location.hash = "#" + g.to; return; }
    var classic = { pocreg: "poct", vaxreg: "vaccines", scrreg: "screening", pvreg: "pharmacovigilance" }[g.to]; // not in this build: the classic screen
    try { sessionStorage.setItem("eikon_ui2_return", "services"); } catch (e) {}
    if (classic && E.openClassic) E.openClassic(classic); else window.location.hash = "#" + g.to;
  }

  // ---------- drawing ----------
  function css() {
    if (document.getElementById("eikon-svt-css")) return;
    var st = document.createElement("style"); st.id = "eikon-svt-css";
    st.textContent =
      ".svt{margin:18px 0 4px}.svt-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px}" +
      ".svt-head h2{font-size:19px;font-weight:700;letter-spacing:-.015em;margin:0}.svt-head small{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".svt-sum{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--border);border-radius:12px 12px 0 0;background:var(--panel2);font-size:15px;font-weight:600;border-bottom:0}" +
      ".svt-sum .svt-ic{flex:none}.svt-sum.all .svt-ic{background:rgba(10,143,106,.14);color:var(--ok,#0A8F6A)}" +
      ".svt-list{margin:0;padding:0;list-style:none;background:var(--panel2);border:1px solid var(--border);border-radius:0 0 12px 12px;overflow:hidden}.svt-list.solo{border-radius:12px}" +
      ".svt-row{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-top:.5px solid var(--border);min-height:56px}.svt-row:first-child{border-top:0}" +
      ".svt-ic{width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center}.svt-ic svg{display:block}" +
      ".svt-row.done .svt-ic{background:rgba(10,143,106,.14);color:var(--ok,#0A8F6A)}.svt-row.todo .svt-ic{border:2px solid #C98A12}.svt-row.problem .svt-ic{background:var(--danger,#C0392B);color:#fff}.svt-row.info .svt-ic{visibility:hidden}" +
      ".svt-t{flex:1 1 auto;min-width:0}.svt-t b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}.svt-t>span{display:block;font-size:13.5px;color:var(--muted);line-height:1.4;margin-top:1px}" +
      ".svt-hot{font-style:normal;font-weight:600}.svt-hot.todo{color:var(--warn,#8A5A08)}.svt-hot.problem{color:var(--danger,#B42318)}" +
      ".svt-btn{font:inherit;font-size:14px;font-weight:600;min-height:40px;min-width:72px;padding:0 14px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;flex:none;-webkit-tap-highlight-color:transparent}" +
      ".svt-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.svt-btn.q{border-color:transparent;background:none;color:var(--accent);min-width:0;padding:0 8px}" +
      ".svt-btn:hover{filter:brightness(.97)}.svt-btn:active{filter:brightness(.9)}.svt :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".svt-sk{height:56px;border-top:.5px solid var(--border);background:linear-gradient(90deg,transparent,rgba(127,127,127,.08),transparent);background-size:200% 100%;animation:svtSk 1.2s linear infinite}.svt-sk:first-child{border-top:0}" +
      "@keyframes svtSk{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.svt-sk{animation:none}}" +
      ".svt-err{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);font-size:14px}" +
      ".hub h2.svt-all,html[data-ui2] .hub h2.svt-all{font-size:19px;font-weight:700;letter-spacing:-.015em;text-transform:none;color:var(--text);margin:30px 2px 0}" +
      ".svt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.svt-foot{font-size:12.5px;color:var(--muted);margin:8px 2px 0;line-height:1.5}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .svt-btn.p{color:#00160E}html[data-ui2]:not([data-ui2-visit]) .svt-hot.todo{color:#E8B04A}}" +
      "@media (max-width:600px){.svt-row{gap:10px}.svt-btn{min-height:44px;min-width:64px;padding:0 12px}.svt-btn.q{min-width:44px;padding:0 6px}.svt-head h2{font-size:20px}}" +
      // the status under a hub card: words first, a dot of colour for meaning (never colour alone)
      ".svt-chip{display:flex;align-items:center;gap:6px;font-style:normal;font-size:12.5px;font-weight:600;margin-top:6px;color:var(--muted);font-variant-numeric:tabular-nums}.svt-chip::before{content:'';width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok,#0A8F6A)}" +
      ".svt-chip.info::before{background:var(--muted)}.svt-chip.todo::before{background:#C98A12}.svt-chip.problem{color:var(--danger,#B42318)}.svt-chip.problem::before{background:var(--danger,#B42318)}";
    document.head.appendChild(st);
  }
  var ICON = {
    done: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    problem: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5"/></svg>',
    todo: "", info: ""
  };
  var WORD = { problem: "Serious", todo: "To do", done: "Done", info: "" };

  function textHtml(x) { // only the key words coloured
    var t = String(x.text || ""), k = x.hot ? t.indexOf(x.hot) : -1;
    return k < 0 ? esc(t) : esc(t.slice(0, k)) + '<em class="svt-hot ' + (x.hotCls || x.status) + '">' + esc(x.hot) + "</em>" + esc(t.slice(k + x.hot.length));
  }
  function rowHtml(x, i) {
    var primary = x.status === "todo" || x.status === "problem";
    var word = WORD[x.status] ? '<span class="svt-sr">, ' + esc(WORD[x.status]) + "</span>" : "";
    return '<li class="svt-row ' + x.status + '" data-svt="' + esc(x.key) + '"><span class="svt-ic">' + ICON[x.status] + '</span><div class="svt-t"><b>' + esc(x.title) + word + "</b><span>" + textHtml(x) + "</span></div>" +
      '<button type="button" class="svt-btn' + (primary ? " p" : " q") + '" data-svt-go="' + i + '" aria-label="' + esc(x.aria || x.act + ": " + x.title) + '">' + esc(x.act) + (primary ? "" : " ›") + "</button></li>";
  }
  function opts() { return { bookings: !!(E.modules && E.modules.bookings) }; } // Bookings switched off on this device: no booking rows

  function paint(slot) {
    if (!slot || !slot.isConnected) return;
    css();
    S.list = null;
    var D = S.data;
    if (S.hidden && !D) { slot.innerHTML = ""; paintChips(null); var all0 = document.querySelector(".hub h2.svt-all"); if (all0) all0.hidden = true; return; }
    var h = '<section class="svt" aria-labelledby="svt-h"><div class="svt-head"><h2 id="svt-h">Today\'s services</h2>' + (D ? "<small>Checked " + esc(D.time || "") + "</small>" : "") + "</div>";
    if (!D && S.error) {
      h += '<div class="svt-err" role="alert"><span>' + esc(S.error) + '</span><button type="button" class="svt-btn" data-svt-retry>Try again</button></div>';
    } else if (!D) {
      h += '<ul class="svt-list solo" aria-busy="true" aria-label="Checking today\'s services"><li class="svt-sk"></li><li class="svt-sk"></li><li class="svt-sk"></li></ul>';
    } else {
      var o = opts(), list = sorted(items(D, o)), sm = summary(D), calm = !sm.waiting;
      h += '<div aria-live="polite"><div class="svt-sum' + (calm ? " all" : "") + '"' + (calm ? ' role="status"' : "") + ">" + (calm ? '<span class="svt-ic">' + ICON.done + "</span>" : "") + esc(headText(sm, o)) + "</div></div>";
      h += list.length ? '<ul class="svt-list">' + list.map(rowHtml).join("") + "</ul>" : "";
      if (S.error) h += '<p class="svt-foot" role="status">' + esc(S.error) + " Showing what was checked at " + esc(D.time || "") + ".</p>";
      S.list = list;
    }
    paintChips(D);
    var all = document.querySelector(".hub h2.svt-all"); if (all) all.hidden = false;
    h += "</section>";
    var ae = document.activeElement, keep = ae && slot.contains(ae) ? (ae.getAttribute("data-svt-go") != null ? '[data-svt-go="' + ae.getAttribute("data-svt-go") + '"]' : ae.hasAttribute("data-svt-retry") ? "[data-svt-retry]" : "") : "";
    slot.innerHTML = h;
    if (keep) { var k = slot.querySelector(keep); if (k) k.focus({ preventScroll: true }); }
    slot.querySelectorAll("[data-svt-go]").forEach(function (b) {
      b.addEventListener("click", function () { var x = S.list && S.list[Number(b.getAttribute("data-svt-go"))]; if (x) go(x.go); });
    });
    var rt = slot.querySelector("[data-svt-retry]");
    if (rt) rt.addEventListener("click", function () { rt.disabled = true; rt.textContent = "Checking…"; render(slot, true); });
  }

  // The hub calls this every time it draws (it redraws when late screens arrive): reads at most once a minute,
  // and again after anything was saved.
  function render(slot, force) {
    S.slot = slot;
    if (!force && cached()) { S.error = ""; return paint(slot); }
    paint(slot);
    return load(force).then(function () { if (S.slot === slot) paint(slot); }, function () { if (S.slot === slot) paint(slot); });
  }

  // ---------- a short status under the hub's own cards (same answer, nothing more asked) ----------
  // Only where something needs a look, or the day's count of tests; the look-up cards get none.
  function chips(D) {
    var out = {}; if (!D) return out;
    var fu = D.followups, pv = D.pv, vx = D.vaccines, sc = D.screening;
    if (D.poct && D.poct.today) out.poct = { status: "info", text: plural(D.poct.today, "test") + " today" };
    if (fu && fu.count) out.screening = { status: "todo", text: plural(fu.count, "follow-up") + " due" };
    else if (sc && sc.running && sc.running.length) out.screening = { status: "info", text: sc.running.length === 1 ? (sc.running[0].name || "A campaign") + " running" : sc.running.length + " campaigns running" };
    if (pv && pv.drafts) out.pharmacovigilance = pv.serious ? { status: "problem", text: plural(pv.serious, "serious report") + " not sent" } : { status: "todo", text: pv.drafts + " not sent yet" };
    if (vx) {
      if (vx.due && vx.due.count) out.vaccines = { status: "todo", text: plural(vx.due.count, "dose") + " due" };
      else if (vx.expired) out.vaccines = { status: "todo", text: plural(vx.expired, "batch", "batches") + " expired, still in stock" };
      else if (vx.expiring30) out.vaccines = { status: "todo", text: plural(vx.expiring30, "batch expires", "batches expire") + " within " + (vx.soon_days || 30) + " days" };
    }
    return out;
  }
  function paintChips(D) {
    var hub = document.querySelector('.hub[data-hub="services"]'); if (!hub) return;
    var ch = D ? chips(D) : {};
    hub.querySelectorAll(".hub-card[data-open]").forEach(function (card) {
      var mid = card.getAttribute("data-open"), x = ch[mid], el = card.querySelector(".svt-chip");
      if (!x) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("em"); card.appendChild(el); }
      el.className = "svt-chip " + x.status; el.textContent = x.text;
    });
  }

  E.svcToday = { nextDose: nextDose, items: items, sorted: sorted, summary: summary, headText: headText, chips: chips, load: load, render: render, go: go, state: S };
  // A slot already on screen (the hub drew before this file arrived): fill it now.
  try { var pre = document.getElementById("svt-slot"); if (pre && E.state.activeModuleId === "services") render(pre); } catch (e) {}
})();
