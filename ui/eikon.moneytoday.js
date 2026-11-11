/* ============================================================
   EIKON — Today's money  (eikon.moneytoday.js, money-hub)
   The first thing on Money: what is left to close (today's end of day, an earlier day never closed or never locked),
   what the till has taken so far today once it is recorded, what was paid out, what the emergency till sold (and any
   sale still waiting on this device), and what customers hold on credit notes. One calm list, one tap into the right
   screen; the same answer puts a short status under the hub's own cards where something needs a look ("Closed today",
   "Sat 7 Nov not closed", "2 notes end within 30 days"); figures are not repeated there.
   Cost: ONE read, GET /money/today (five small statements on the server, each bounded by the pharmacy and a date, a
   two-week range or a LIMIT), when the hub opens; within a minute of the last answer, for the same pharmacy and with
   nothing saved since, nothing is asked. No timer. Today is not touched (it is re-read every minute).
   Rights are the server's: a part this person cannot read on its own screen comes back empty and is not shown.
   The owner's "How we're doing" stays a card under this list (the pharmacist in charge only).
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var FRESH_MS = 60000;
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var S = { data: null, at: 0, loc: "", job: null, error: "", slot: null, list: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayText(s) { var a = String(s || "").split("-"); return a.length === 3 ? Number(a[2]) + " " + SHORT[+a[1] - 1] : String(s || ""); }
  function dayName(s, today) { // "Yesterday", or "Saturday 7 Nov"
    if (today && s === addDays(today, -1)) return "Yesterday";
    return WDAY[new Date(s + "T12:00:00Z").getUTCDay()] + " " + dayText(s);
  }
  // Euro: € before the number, two decimals, thousands grouped; a minus as a real minus sign.
  function eur(n) {
    var v = Math.round((Number(n) || 0) * 100) / 100, a = Math.abs(v).toFixed(2).split(".");
    return (v < 0 ? "−€" : "€") + a[0].replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + a[1];
  }
  // Sales taken on this device while offline and not yet on the server (the emergency till's own queue).
  function waiting() {
    try { var v = JSON.parse(localStorage.getItem("eikon_epos_pending") || "[]"); if (!Array.isArray(v)) return { n: 0, total: 0 }; return { n: v.length, total: v.reduce(function (t, s) { return t + (Number(s && s.total) || 0); }, 0) }; } catch (e) { return { n: 0, total: 0 }; }
  }

  // ---------- the list (pure: the same data always gives the same list) ----------
  // Each item: { key, title, status: overdue | todo | done | info, text, hot?, act, go: { mod, day? } }
  function items(D, local) {
    if (!D) return [];
    var today = D.date, now = String(D.time || ""), out = [];
    var add = function (o) { out.push(o); };
    local = local || { n: 0, total: 0 };

    var e = D.end_of_day;
    if (e) {
      var closes = e.closes_at || "19:30", late = now >= closes, t = e.today, ego = { mod: "endofday" };
      if (t && t.locked) add({ key: "eod", title: "End of day", status: "done", text: "Closed" + (t.staff ? " by " + t.staff : "") + ". Takings " + eur(t.takings) + (t.counted ? ", " + overUnder(t.over_under) : "") + ".", act: "Open", go: ego });
      else if (t) add({ key: "eod", days: 1, title: "End of day", status: late ? "todo" : "info", text: "Started" + (t.staff ? " by " + t.staff : "") + ", not locked yet. Takings so far " + eur(t.takings) + "." + (late ? "" : " Lock it once the till is closed."), act: late ? "Finish" : "Open", go: ego });
      else if (e.open_today === false) add({ key: "eod", title: "End of day", status: "info", text: "The pharmacy is closed today.", act: "Open", go: ego });
      else if (late) add({ key: "eod", days: 1, title: "End of day", status: "todo", text: "Not closed yet. Count the till and lock the day.", act: "Close the day", go: ego });
      else add({ key: "eod", title: "End of day", status: "info", text: "Not started. Takings show here once the X readings are in. The day closes at " + closes + ".", act: "Open", go: ego });

      // Visual QA round 2: one row for the days saved but not locked (one button, the oldest first), one for a day never
      // saved. The button opens End of day on that day; locking stays there, after a look at the figures.
      var unl = (e.earlier || []).filter(function (x) { return x.state === "unlocked"; }).map(function (x) { return x.date; }).sort();
      var mis = (e.earlier || []).filter(function (x) { return x.state === "missing"; });
      var shortDay = function (d) { return WDAY[new Date(d + "T12:00:00Z").getUTCDay()].slice(0, 3) + " " + dayText(d); };
      if (unl.length === 1) add({ key: "eod:" + unl[0], days: 1, title: "End of day · " + dayName(unl[0], today), status: "overdue", text: "Saved but not locked. Open it, check the figures and lock it.", hot: "not locked", act: "Open", aria: "Open " + dayName(unl[0]) + " to lock it", go: { mod: "endofday", day: unl[0] } });
      else if (unl.length > 1) {
        var names = unl.slice(0, 4).map(shortDay), list = names.length > 1 ? names.slice(0, -1).join(", ") + " and " + names[names.length - 1] : names[0];
        add({ key: "eod:unlocked", days: unl.length, title: "End of day · " + plural(unl.length, "day") + " not locked", status: "overdue", text: list + (unl.length > 4 ? " and " + plural(unl.length - 4, "more") : "") + " were saved but not locked. Open the first, lock it, then the next.", hot: "not locked", act: "Open", aria: "Open " + dayName(unl[0]) + ", the first not locked", go: { mod: "endofday", day: unl[0] } });
      }
      mis.forEach(function (x) { add({ key: "eod:" + x.date, days: 1, title: "End of day · " + dayName(x.date, today), status: "todo", text: "No end of day was saved. If the pharmacy was open, close it now.", hot: "No end of day was saved", act: "Open", aria: "Open " + dayName(x.date) + " to close it", go: { mod: "endofday", day: x.date } }); });
    }

    if (D.paid_out) {
      var p = D.paid_out, pgo = { mod: "paidout" };
      if (p.count) add({ key: "po", title: "Paid out", status: "info", text: eur(p.total) + " paid from the till today, " + plural(p.count, "payment") + ".", act: "Open", go: pgo });
      else add({ key: "po", title: "Paid out", status: "info", text: "Nothing paid from the till today.", act: "Add", go: pgo });
    }

    var x = D.emergency, ego2 = { mod: "emergency-pos" };
    if (local.n) add({ key: "epos", title: "Emergency till", status: "todo", text: plural(local.n, "sale is", "sales are") + " waiting on this device, not yet sent (" + eur(local.total) + ")." + (x && x.count ? " " + eur(x.total) + " already sent today." : ""), hot: "not yet sent", act: "Send", go: ego2 });
    else if (x && x.count) add({ key: "epos", title: "Emergency till", status: "info", text: eur(x.total) + " taken on the emergency till today, " + plural(x.count, "sale") + ".", act: "Open", go: ego2 });

    if (D.credit_notes) {
      var c = D.credit_notes, cgo = { mod: "creditnotes" };
      if (!c.open) add({ key: "cn", title: "Credit notes", status: "info", text: "No customer has money left on a credit note.", act: "Open", go: cgo });
      else {
        var soon = c.soon ? " " + plural(c.soon, "note expires", "notes expire") + " within " + (c.soon_days || 30) + " days (" + eur(c.soon_total) + "), the first on " + dayText(c.soon_first) + "." : "";
        add({ key: "cn", title: "Credit notes", status: "info", text: eur(c.held) + " held by customers on " + plural(c.open, "credit note") + "." + soon, hot: c.soon ? plural(c.soon, "note expires", "notes expire") + " within " + (c.soon_days || 30) + " days" : "", hotCls: "todo", act: "Open", go: cgo });
      }
    }
    return out;
  }
  function overUnder(v) { v = Math.round((Number(v) || 0) * 100) / 100; return v === 0 ? "the till balanced" : eur(Math.abs(v)) + (v > 0 ? " over" : " under"); }
  var RANK = { overdue: 0, todo: 1, info: 2, done: 3 };
  function sorted(list) { return list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return RANK[a.x.status] - RANK[b.x.status] || a.i - b.i; }).map(function (o) { return o.x; }); }
  function summary(list, D) {
    var od = list.filter(function (x) { return x.status === "overdue"; }).length, td = list.filter(function (x) { return x.status === "todo"; }).length;
    var e = D && D.end_of_day, closed = !!(e && e.today && e.today.locked);
    var eodOpen = list.filter(function (x) { return (x.status === "overdue" || x.status === "todo") && x.days; });
    return { overdue: od, todo: td, open: od + td, days: eodOpen.length, dayCount: eodOpen.reduce(function (t, x) { return t + x.days; }, 0), closed: closed, allDone: od + td === 0 && closed };
  }
  function headText(sm, D) {
    if (sm.open && sm.days === sm.open) return plural(sm.dayCount, "day") + " to close."; // only end of day is left: say it in days (Visual QA round 2)
    if (sm.open) return plural(sm.open, "thing") + " to do" + (sm.overdue ? ", " + sm.overdue + " overdue" : "") + ".";
    if (sm.closed) return "Today is closed. Nothing left to do.";
    var e = D && D.end_of_day;
    return e && e.open_today !== false ? "Nothing to do yet. The day closes at " + (e.closes_at || "19:30") + "." : "Nothing to do.";
  }

  // ---------- reading (one request at most, shared by everyone who asks at once) ----------
  function locId() { return String((E.state && E.state.user && E.state.user.location_id) || ""); }
  function cached() { // this pharmacy's answer, under a minute old, with nothing saved since (memory only)
    return S.data && S.loc === locId() && Date.now() - S.at < FRESH_MS && S.at > (E.lastWriteAt || 0) ? S.data : null;
  }
  function load(force) {
    if (!force) { var c = cached(); if (c) return Promise.resolve(c); }
    if (S.job) return S.job;
    var asked = Date.now(), loc = locId();
    S.job = E.apiFetch("/money/today", { method: "GET", timeoutMs: 12000 }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not check today's money");
      S.data = clipStart(r); S.at = asked; S.loc = loc; S.error = "";
      return r;
    }).catch(function (e) {
      S.error = e && e.network ? "No connection, so today's money could not be checked." : "Today's money could not be checked.";
      throw e;
    }).finally(function () { S.job = null; });
    return S.job;
  }

  // ---------- opening the right screen (the rebuilt one when it is in the build, else the classic) ----------
  function go(g) {
    if (!g || !g.mod) return;
    var nat = (E.UI2_NATIVE || {})[g.mod];
    if (g.day) { try { sessionStorage.setItem("eikon_eodreg_day", g.day); } catch (e) {} } // End of day opens on that day (read once by the End of day screen)
    if (nat && E.modules && E.modules[nat]) { window.location.hash = "#" + nat; return; }
    try { sessionStorage.setItem("eikon_ui2_return", "money"); } catch (e) {}
    if (E.openClassic) E.openClassic(g.mod); else window.location.hash = "#" + g.mod;
  }

  // ---------- drawing ----------
  function css() {
    if (document.getElementById("eikon-mny-css")) return;
    var st = document.createElement("style"); st.id = "eikon-mny-css";
    st.textContent =
      ".mny{margin:18px 0 4px}.mny-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px}" +
      ".mny-head h2{font-size:19px;font-weight:700;letter-spacing:-.015em;margin:0}.mny-head small{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".mny-sum{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--border);border-radius:12px 12px 0 0;background:var(--panel2);font-size:15px;font-weight:600;border-bottom:0}" +
      ".mny-sum .mny-ic{flex:none}.mny-sum.all .mny-ic{background:rgba(10,143,106,.14);color:var(--ok,#0A8F6A)}" +
      ".mny-list{margin:0;padding:0;list-style:none;background:var(--panel2);border:1px solid var(--border);border-radius:0 0 12px 12px;overflow:hidden}.mny-list.solo{border-radius:12px}" +
      ".mny-row{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-top:.5px solid var(--border);min-height:56px}.mny-row:first-child{border-top:0}" +
      ".mny-ic{width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center}.mny-ic svg{display:block}" +
      ".mny-row.done .mny-ic{background:rgba(10,143,106,.14);color:var(--ok,#0A8F6A)}.mny-row.todo .mny-ic{border:2px solid #C98A12}.mny-row.overdue .mny-ic{background:var(--danger);color:#fff}.mny-row.info .mny-ic{visibility:hidden}" +
      ".mny-t{flex:1 1 auto;min-width:0}.mny-t b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em}.mny-t>span{display:block;font-size:13.5px;color:var(--muted);line-height:1.4;margin-top:1px}" +
      ".mny-n{color:var(--text);font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".mny-hot{font-style:normal;font-weight:600}.mny-hot.overdue{color:var(--danger)}.mny-hot.todo{color:var(--warn,#8A5A08)}" +
      ".mny-btn{font:inherit;font-size:14px;font-weight:600;min-height:40px;min-width:72px;padding:0 14px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;flex:none;-webkit-tap-highlight-color:transparent}" +
      ".mny-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.mny-btn.q{border-color:transparent;background:none;color:var(--accent);min-width:0;padding:0 8px}" +
      ".mny-btn:hover{filter:brightness(.97)}.mny-btn:active{filter:brightness(.9)}.mny :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".mny-sk{height:56px;border-top:.5px solid var(--border);background:linear-gradient(90deg,transparent,rgba(127,127,127,.08),transparent);background-size:200% 100%;animation:mnySk 1.2s linear infinite}.mny-sk:first-child{border-top:0}" +
      "@keyframes mnySk{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.mny-sk{animation:none}}" +
      ".mny-err{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);font-size:14px}" +
      ".hub h2.mny-all,html[data-ui2] .hub h2.mny-all{font-size:19px;font-weight:700;letter-spacing:-.015em;text-transform:none;color:var(--text);margin:30px 2px 0}" +
      ".mny-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.mny-foot{font-size:12.5px;color:var(--muted);margin:8px 2px 0;line-height:1.5}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .mny-btn.p{color:#00160E}html[data-ui2]:not([data-ui2-visit]) .mny-hot.todo{color:#E8B04A}}" +
      "@media (max-width:600px){.mny-row{gap:10px}.mny-btn{min-height:44px;min-width:64px;padding:0 12px}.mny-btn.q{min-width:44px;padding:0 6px}.mny-head h2{font-size:20px}}" +
      // the status under a hub card: words first, a dot of colour for meaning (never colour alone)
      ".mny-chip{display:flex;align-items:center;gap:6px;font-style:normal;font-size:12.5px;font-weight:600;margin-top:6px;color:var(--muted);font-variant-numeric:tabular-nums}.mny-chip::before{content:'';width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok,#0A8F6A)}" +
      ".mny-chip.info::before{background:var(--muted)}.mny-chip.todo::before{background:#C98A12}.mny-chip.overdue{color:var(--danger)}.mny-chip.overdue::before{background:var(--danger)}";
    document.head.appendChild(st);
  }
  var ICON = {
    done: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    overdue: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5"/></svg>',
    todo: "", info: ""
  };
  var WORD = { overdue: "Overdue", todo: "To do", done: "Done", info: "" };
  var AMT = /−?€[\d,]+\.\d\d/g;

  function textHtml(x) { // amounts in tabular figures, only the key words coloured
    var t = String(x.text || ""), k = x.hot ? t.indexOf(x.hot) : -1;
    var part = function (s) { return esc(s).replace(AMT, function (m) { return '<span class="mny-n">' + m + "</span>"; }); };
    return k < 0 ? part(t) : part(t.slice(0, k)) + '<em class="mny-hot ' + (x.hotCls || x.status) + '">' + esc(x.hot) + "</em>" + part(t.slice(k + x.hot.length));
  }
  function rowHtml(x, i) {
    var primary = x.status === "overdue" || x.status === "todo";
    var word = WORD[x.status] ? '<span class="mny-sr">, ' + esc(WORD[x.status]) + "</span>" : "";
    return '<li class="mny-row ' + x.status + '" data-mny="' + esc(x.key) + '"><span class="mny-ic">' + ICON[x.status] + '</span><div class="mny-t"><b>' + esc(x.title) + word + "</b><span>" + textHtml(x) + "</span></div>" +
      '<button type="button" class="mny-btn' + (primary ? " p" : " q") + '" data-mny-go="' + i + '" aria-label="' + esc(x.aria || x.act + ": " + x.title) + '">' + esc(x.act) + (primary ? "" : " ›") + "</button></li>";
  }

  function paint(slot) {
    if (!slot || !slot.isConnected) return;
    css();
    var D = S.data, h = '<section class="mny" aria-labelledby="mny-h"><div class="mny-head"><h2 id="mny-h">Today\'s money</h2>' + (D ? "<small>Checked " + esc(D.time || "") + "</small>" : "") + "</div>";
    S.list = null;
    if (!D && S.error) {
      h += '<div class="mny-err" role="alert"><span>' + esc(S.error) + '</span><button type="button" class="mny-btn" data-mny-retry>Try again</button></div>';
    } else if (!D) {
      h += '<ul class="mny-list solo" aria-busy="true" aria-label="Checking today\'s money"><li class="mny-sk"></li><li class="mny-sk"></li><li class="mny-sk"></li></ul>';
    } else {
      var list = sorted(items(D, waiting())), sm = summary(list, D);
      h += '<div aria-live="polite"><div class="mny-sum' + (sm.allDone ? " all" : "") + '"' + (sm.allDone ? ' role="status"' : "") + ">" + (sm.allDone ? '<span class="mny-ic">' + ICON.done + "</span>" : "") + esc(headText(sm, D)) + "</div></div>";
      h += list.length ? '<ul class="mny-list">' + list.map(rowHtml).join("") + "</ul>" : "";
      if (S.error) h += '<p class="mny-foot" role="status">' + esc(S.error) + " Showing what was checked at " + esc(D.time || "") + ".</p>";
      S.list = list;
    }
    paintChips(D);
    h += "</section>";
    var ae = document.activeElement, keep = ae && slot.contains(ae) ? (ae.getAttribute("data-mny-go") != null ? '[data-mny-go="' + ae.getAttribute("data-mny-go") + '"]' : ae.hasAttribute("data-mny-retry") ? "[data-mny-retry]" : "") : "";
    slot.innerHTML = h;
    if (keep) { var k = slot.querySelector(keep); if (k) k.focus({ preventScroll: true }); }
    slot.querySelectorAll("[data-mny-go]").forEach(function (b) {
      b.addEventListener("click", function () { var x = S.list && S.list[Number(b.getAttribute("data-mny-go"))]; if (x) go(x.go); });
    });
    var rt = slot.querySelector("[data-mny-retry]");
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
  // How we're doing, Paid out and Locum receipts get none.
  function chips(D, local) {
    var out = {}; if (!D) return out;
    local = local || { n: 0, total: 0 };
    var e = D.end_of_day;
    if (e) {
      var t = e.today, ear = e.earlier || [], late = String(D.time || "") >= (e.closes_at || "19:30");
      var unl = ear.filter(function (x) { return x.state === "unlocked"; }), mis = ear.filter(function (x) { return x.state === "missing"; });
      if (unl.length) out.endofday = { status: "overdue", text: unl.length === 1 ? dayName(unl[0].date, D.date) + " not locked" : plural(unl.length, "day") + " not locked" };
      else if (mis.length) out.endofday = { status: "todo", text: dayName(mis[0].date, D.date) + " not closed" };
      else if (t && t.locked) out.endofday = { status: "done", text: "Closed today" };
      else if (t) out.endofday = { status: late ? "todo" : "info", text: "Started, not locked" };
      else if (e.open_today !== false) out.endofday = { status: late ? "todo" : "info", text: "Not closed yet" };
    }
    // Visual QA round 2: no figure repeated under a card (paid out, sales, money held are in the list above); only
    // what needs a look: a sale not sent, credit notes ending soon.
    if (local.n) out["emergency-pos"] = { status: "todo", text: plural(local.n, "sale", "sales") + " not sent" };
    var c = D.credit_notes;
    if (c && c.soon) out.creditnotes = { status: "todo", text: plural(c.soon, "note ends", "notes end") + " within " + (c.soon_days || 30) + " days" };
    return out;
  }
  function paintChips(D) {
    var hub = document.querySelector('.hub[data-hub="money"]'); if (!hub) return;
    var ch = D ? chips(D, waiting()) : {};
    hub.querySelectorAll(".hub-card[data-open]").forEach(function (card) {
      var mid = card.getAttribute("data-open"), x = ch[mid], el = card.querySelector(".mny-chip");
      if (!x) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("em"); card.appendChild(el); }
      el.className = "mny-chip " + x.status; el.textContent = x.text;
    });
  }

  // FIN-dayzero: a day before the pharmacy started was never open: no "Yesterday not closed" for it. Only the "missing"
  // days go (a day saved but not locked is a real record and stays). The answer is otherwise used as sent.
  function clipStart(r) {
    if (E.noteStart && r && r.since) E.noteStart(r.since);
    var start = r && /^\d{4}-\d{2}-\d{2}$/.test(String(r.since || "")) ? r.since : (E.startYmd ? E.startYmd() : "");
    var e = r && r.end_of_day;
    if (start && e && Array.isArray(e.earlier)) {
      e.earlier = e.earlier.filter(function (x) { return !(x && x.state === "missing" && String(x.date) < start); });
      if (e.last_open_day && String(e.last_open_day) < start) e.last_open_day = null;
    }
    return r;
  }

  E.moneyToday = { items: items, sorted: sorted, summary: summary, headText: headText, chips: chips, eur: eur, load: load, render: render, state: S };
  // A slot already on screen (the hub drew before this file arrived): fill it now.
  try { var pre = document.getElementById("mny-slot"); if (pre && E.state.activeModuleId === "money") render(pre); } catch (e) {}
})();
