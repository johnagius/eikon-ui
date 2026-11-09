/* ============================================================
   EIKON — Today's registers  (eikon.regtoday.js, regs-hub)
   The first thing on Registers: what every register needs today, in one calm list, each with one tap into the
   right register (and the right day), and a clear "All done for today". The same answer puts a short status
   under the hub's own cards ("Done today", "2 to log", "Due in 12 days", "Last check: in order, 2 days ago").
   Cost: ONE read, GET /registers/today (about ten small statements on the server, each bounded by the pharmacy and a
   date or a LIMIT), when the hub opens; within a minute of the last answer, for the same pharmacy and with nothing
   saved since, nothing is asked. No timer. Today is not touched (it is re-read every minute): it only links here.
   The rules are the Inspection check's (modules.insreg.js): a reading every day per fridge or room and a note for
   one outside its limits; a cleaning once a week; a pharmacist in charge every working day; a controlled-drug
   stock-take for every month with lines, counted in the month or its first week after; certificates in date for
   30 days. The daily register is owed only at closing (Today's decision D3: End of day started, or from 19:30).
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var FRESH_MS = 60000, SIGN_DAYS = 7, SOON_DAYS = 30, CLEAN_DAYS = 7, CLOSING = "19:30";
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // The registers a month sign-off covers (the Daily registers' sign-off card, register_signoffs.register).
  var SIGN_KEYS = [["temperature", "Temperature", "tempreg"], ["cleaning", "Cleaning", "cleanreg"], ["daily", "Daily register", "drreg"], ["locum", "Locum register", "locreg"], ["receipts", "Locum receipts", "lrcreg"]];
  var S = { data: null, at: 0, loc: "", job: null, error: "", errorKind: "", slot: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dayText(s) { var a = String(s || "").split("-"); return a.length === 3 ? Number(a[2]) + " " + SHORT[+a[1] - 1] : String(s || ""); }
  function monthName(ym) { var a = String(ym || "").split("-"); return a.length === 2 ? MON[+a[1] - 1] : String(ym || ""); }
  function weekdayOf(s) { return WDAY[new Date(s + "T12:00:00Z").getUTCDay()]; }
  function num(v) { return v == null || v === "" ? null : (isFinite(Number(v)) ? Number(v) : null); }
  function deg(v) { return String(Math.round(Number(v) * 10) / 10); }

  // ---------- the list (pure: the same data always gives the same list) ----------
  // Each item: { key, title, status: overdue | todo | done | info, text, act: label, go: { mod, day?, device? } }
  function items(D) {
    if (!D) return [];
    var today = D.date, out = [];
    var add = function (o) { out.push(o); };

    var here = String((E.state && E.state.user && E.state.user.location_name) || "").trim().toLowerCase();
    (D.temperature || []).forEach(function (t) {
      var nm = String(t.name || "").trim(), k0 = nm.toLowerCase(); // as Today (b4-9): the room sensor seeded with the pharmacy's name reads "Room"
      t = Object.assign({}, t, { name: k0 === "pharmacy" || (here && k0 === here) ? "Room" : nm });
      var lim = t.limits || {}, lo = num(lim.min), hi = num(lim.max), limText = (lo != null ? deg(lo) : "–") + " to " + (hi != null ? deg(hi) : "–") + " °C";
      var go = { mod: "tempreg", day: today, device: t.device_id };
      if (!t.today) return add({ key: "temp:" + t.device_id, title: t.name, status: "todo", text: "Temperature not logged yet today.", act: "Log", go: go });
      var reading = deg(t.today.min) + " to " + deg(t.today.max) + " °C";
      if (t.out_of_range && t.note === false) return add({ key: "temp:" + t.device_id, title: t.name, status: "overdue", text: reading + " is outside " + limText + ". Write what was done.", act: "Add note", go: go });
      if (t.out_of_range && t.note == null) return add({ key: "temp:" + t.device_id, title: t.name, status: "todo", text: reading + " is outside " + limText + ". Check there is a note saying what was done.", act: "Check", go: go });
      add({ key: "temp:" + t.device_id, title: t.name, status: "done", text: "Logged " + reading + (t.out_of_range ? ", outside the limits, with a note." : "."), act: "Open", go: go });
    });

    if (D.cleaning) {
      var c = D.cleaning, n = c.days_since, who = c.by ? " by " + c.by : "", cgo = { mod: "cleanreg" };
      if (n == null) add({ key: "clean", title: "Cleaning", status: "todo", text: "Not recorded yet. It is due once a week.", act: "Record", go: cgo });
      else if (n <= 0) add({ key: "clean", title: "Cleaning", status: "done", text: "Done today" + who + ".", act: "Open", go: cgo });
      else if (n < CLEAN_DAYS) { var next = addDays(c.last_date, CLEAN_DAYS); add({ key: "clean", title: "Cleaning", status: "done", text: "Last done " + (n === 1 ? "yesterday" : n + " days ago") + who + ". Next due " + (n === CLEAN_DAYS - 1 ? "tomorrow" : weekdayOf(next) + " " + dayText(next)) + ".", act: "Open", go: cgo }); }
      else if (n === CLEAN_DAYS) add({ key: "clean", title: "Cleaning", status: "todo", text: "Due today: last done a week ago" + who + ".", act: "Record", go: cgo });
      else add({ key: "clean", title: "Cleaning", status: "overdue", text: "Overdue: last done " + n + " days ago (" + dayText(c.last_date) + ")" + who + ". It is due once a week.", act: "Record", go: cgo });
    }

    if (D.locum) {
      var L = D.locum, e0 = (L.entries || [])[0], lgo = { mod: "locreg" };
      if (L.signed && e0) add({ key: "locum", title: "Pharmacist in charge", status: "done", text: e0.name + (e0.reg ? " (reg no " + e0.reg + ")" : "") + (e0.from ? ", from " + e0.from : "") + ((L.entries || []).length > 1 ? " and " + plural(L.entries.length - 1, "more") : "") + ".", act: "Open", go: lgo });
      else add({ key: "locum", title: "Pharmacist in charge", status: "todo", text: "No pharmacist in the locum register for today yet.", act: "Sign in", go: lgo });
    }

    if (D.daily_register) {
      var k = Number(D.daily_register.count_today) || 0, owed = !!(D.end_of_day && D.end_of_day.saved) || String(D.time || "") >= CLOSING, dgo = { mod: "drreg" };
      if (k) add({ key: "daily", title: "Daily register", status: "done", text: plural(k, "line") + " today.", act: "Open", go: dgo });
      else add({ key: "daily", title: "Daily register", status: owed ? "todo" : "info", text: owed ? "No line today. Add the prescription medicines supplied; a day with none needs no line." : "No line yet today. Add each prescription medicine as it is supplied.", act: owed ? "Add" : "Open", go: dgo });
    }

    if (D.stocktake) {
      var st = D.stocktake, sgo = { mod: "ddstreg" }, lastM = monthName(st.last_month), dueBy = st.this_month + "-" + ("0" + (st.grace_days || 7)).slice(-2);
      if (st.open) add({ key: "cd", title: "Controlled drug stock take", status: "todo", text: "The stock take started on " + dayText(st.open.day) + " is not closed yet.", act: "Finish", go: sgo });
      else if (st.last_month_counted) add({ key: "cd", title: "Controlled drug stock take", status: "done", text: lastM + " counted on " + dayText(st.last_month_counted) + ".", act: "Open", go: sgo });
      else if (st.last_month_lines === true) {
        if (today <= dueBy) add({ key: "cd", title: "Controlled drug stock take", status: "todo", text: lastM + "'s count is due by " + dayText(dueBy) + ".", act: "Count", go: sgo });
        else add({ key: "cd", title: "Controlled drug stock take", status: "overdue", text: lastM + " was not counted, and controlled drugs were supplied or received that month.", act: "Count", go: sgo });
      } else if (st.last_month_lines === false) add({ key: "cd", title: "Controlled drug stock take", status: "done", text: "Not needed for " + lastM + ": no controlled drugs supplied or received.", act: "Open", go: sgo });
    }

    if (D.certificates) {
      var ex = D.certificates.filter(function (x) { return x.status === "expired"; }), soon = D.certificates.filter(function (x) { return x.status === "due_soon"; }), cg = { mod: "certreg" };
      var more = function (l) { return l.length > 1 ? " And " + plural(l.length - 1, "more") + "." : ""; };
      if (ex.length) add({ key: "cert", title: "Certificates", status: "overdue", text: ex[0].title + " expired " + (ex[0].days > 0 ? plural(ex[0].days, "day") + " ago" : "today") + " (" + dayText(ex[0].due) + ")." + more(ex.concat(soon)), act: "Renew", go: cg });
      else if (soon.length) add({ key: "cert", title: "Certificates", status: "todo", text: soon[0].title + (soon[0].days === 0 ? " is due today." : " is due in " + plural(soon[0].days, "day") + " (" + dayText(soon[0].due) + ").") + more(soon), act: "Open", go: cg });
      else if (Number(D.certificates_not_recorded) > 0) add({ key: "cert", title: "Certificates", status: "todo", text: plural(Number(D.certificates_not_recorded), "certificate has", "certificates have") + " no date on file. An inspector will ask for these dates.", act: "Add dates", go: cg });
      else add({ key: "cert", title: "Certificates", status: "done", text: "All in date for the next " + SOON_DAYS + " days.", act: "Open", go: cg });
    }

    // Month sign-off (the Daily registers' sign-off): last month, shown until every register is signed off, whatever
    // the date (owner, 9 Nov); once all are signed, the "done" line stays for the first week only. An older server
    // sends null: no line.
    if (Array.isArray(D.signoffs) && D.stocktake && D.stocktake.last_month) {
      var lm = D.stocktake.last_month, signed = {}, byName = "";
      D.signoffs.forEach(function (s) { if (s.month === lm) { signed[s.register] = s; byName = byName || s.signed_by; } });
      var left = SIGN_KEYS.filter(function (r) { return !signed[r[0]]; });
      if (!left.length) { if (Number(String(today).slice(8)) <= SIGN_DAYS) add({ key: "sign", title: "Sign-off for " + monthName(lm), status: "done", text: "Every register signed off" + (byName ? " by " + byName : "") + ".", act: "Open", go: { mod: "tempreg" } }); }
      else add({ key: "sign", title: "Sign-off for " + monthName(lm), status: "todo", text: plural(SIGN_KEYS.length - left.length, "register") + " of " + SIGN_KEYS.length + " signed off. Still to sign: " + left.map(function (r) { return r[1]; }).join(", ") + ".", act: "Sign", go: { mod: left[0][2], ym: lm } });
    }
    return out;
  }
  var RANK = { overdue: 0, todo: 1, info: 2, done: 3 };
  function sorted(list) { return list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return RANK[a.x.status] - RANK[b.x.status] || a.i - b.i; }).map(function (o) { return o.x; }); }
  function summary(list) {
    var od = list.filter(function (x) { return x.status === "overdue"; }).length, td = list.filter(function (x) { return x.status === "todo"; }).length;
    var done = list.filter(function (x) { return x.status === "done"; }).length;
    return { overdue: od, todo: td, open: od + td, done: done, total: list.length, allDone: list.length > 0 && od + td === 0 };
  }
  function headText(sm) {
    if (sm.allDone) return "All done for today.";
    return plural(sm.open, "thing") + " to do today" + (sm.overdue ? ", " + sm.overdue + " overdue" : "") + ".";
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
    S.job = E.apiFetch("/registers/today", { method: "GET", timeoutMs: 12000 }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not check today's registers");
      S.data = r; S.at = asked; S.loc = loc; S.error = ""; S.errorKind = "";
      return r;
    }, function (e) { throw e; }).catch(function (e) {
      S.errorKind = e && e.status === 401 ? "auth" : e && e.network ? "network" : "other";
      S.error = S.errorKind === "network" ? "No connection, so today's registers could not be checked." : "Today's registers could not be checked.";
      throw e;
    }).finally(function () { S.job = null; });
    return S.job;
  }

  // ---------- opening the right register ----------
  function go(g) {
    if (!g || !g.mod) return;
    if (g.mod === "tempreg" && g.day) { try { sessionStorage.setItem("eikon_tempreg_day", JSON.stringify({ day: g.day, device: g.device })); } catch (e) {} }
    else if (g.ym && E.months && E.months.openAt) E.months.openAt(g.mod, g.ym);
    window.location.hash = "#" + g.mod;
  }

  // ---------- drawing ----------
  function css() {
    if (document.getElementById("eikon-rgt-css")) return;
    var st = document.createElement("style"); st.id = "eikon-rgt-css";
    st.textContent =
      ".rgt{margin:18px 0 4px}.rgt-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px}" +
      ".rgt-head h2{font-size:19px;font-weight:700;letter-spacing:-.015em;margin:0}.rgt-head small{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".rgt-sum{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--border);border-radius:12px 12px 0 0;background:var(--panel2);font-size:15px;font-weight:600;border-bottom:0}" +
      ".rgt-sum.all{border-radius:12px;border-bottom:1px solid var(--border)}.rgt-sum .rgt-ic{flex:none}" +
      ".rgt-list{margin:0;padding:0;list-style:none;background:var(--panel2);border:1px solid var(--border);border-radius:0 0 12px 12px;overflow:hidden}" +
      ".rgt-list.solo{border-radius:12px}" +
      ".rgt-row{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-top:.5px solid var(--border);min-height:56px}.rgt-row:first-child{border-top:0}" +
      ".rgt-ic{width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center}" +
      ".rgt-ic svg{display:block}.rgt-row.done .rgt-ic,.rgt-sum.all .rgt-ic{background:rgba(10,143,106,.14);color:var(--ok,#0A8F6A)}" +
      ".rgt-row.todo .rgt-ic{border:2px solid #C98A12}.rgt-row.overdue .rgt-ic{background:var(--danger);color:#fff}.rgt-row.info .rgt-ic{border:2px solid var(--border)}" +
      ".rgt-t{flex:1 1 auto;min-width:0}.rgt-t b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em}.rgt-t span{display:block;font-size:13.5px;color:var(--muted);line-height:1.4;margin-top:1px}" +
      ".rgt-row.overdue .rgt-t span{color:var(--danger)}" +
      ".rgt-pill.in{display:none;vertical-align:1px;margin-left:4px}.rgt-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;flex:none}" +
      ".rgt-pill.todo{background:rgba(201,138,18,.16);color:var(--warn,#8A5A08)}.rgt-pill.overdue{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".rgt-btn{font:inherit;font-size:14px;font-weight:600;min-height:40px;min-width:72px;padding:0 14px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;flex:none;-webkit-tap-highlight-color:transparent}" +
      ".rgt-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rgt-btn.q{border-color:transparent;background:none;color:var(--accent);min-width:0;padding:0 8px}" +
      ".rgt-btn:hover{filter:brightness(.97)}.rgt-btn:active{filter:brightness(.9)}.rgt :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".rgt-sk{height:56px;border-top:.5px solid var(--border);background:linear-gradient(90deg,transparent,rgba(127,127,127,.08),transparent);background-size:200% 100%;animation:rgtSk 1.2s linear infinite}.rgt-sk:first-child{border-top:0}" +
      "@keyframes rgtSk{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.rgt-sk{animation:none}}" +
      ".rgt-err{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);font-size:14px}" +
      ".hub h2.rgt-all,html[data-ui2] .hub h2.rgt-all{font-size:19px;font-weight:700;letter-spacing:-.015em;text-transform:none;color:var(--text);margin:30px 2px 0}" +
      ".rgt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.rgt-foot{font-size:12.5px;color:var(--muted);margin:8px 2px 0;line-height:1.5}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .rgt-btn.p{color:#00160E}html[data-ui2]:not([data-ui2-visit]) .rgt-pill.todo{color:#E8B04A}}" +
      "@media (max-width:600px){.rgt-row{padding:10px 12px 10px 16px;gap:10px}.rgt-pill.out{display:none}.rgt-pill.in{display:inline-block}.rgt-btn{min-height:44px;min-width:64px;padding:0 12px}.rgt-btn.q{min-width:44px;padding:0 6px}.rgt-head h2{font-size:20px}}" +
      // the status under a hub card: words first, a dot of colour for meaning (never colour alone)
      ".rgt-chip{display:flex;align-items:center;gap:6px;font-style:normal;font-size:12.5px;font-weight:600;margin-top:6px;color:var(--muted)}.rgt-chip::before{content:'';width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok,#0A8F6A)}" +
      ".rgt-chip.todo::before{background:#C98A12}.rgt-chip.overdue{color:var(--danger)}.rgt-chip.overdue::before{background:var(--danger)}";
    document.head.appendChild(st);
  }
  var ICON = {
    done: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    overdue: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5"/></svg>',
    todo: "", info: ""
  };
  var WORD = { overdue: "Overdue", todo: "To do", done: "Done", info: "" };

  function rowHtml(x, i) {
    var primary = x.status === "overdue" || x.status === "todo";
    return '<li class="rgt-row ' + x.status + '" data-rgt="' + esc(x.key) + '">' +
      '<span class="rgt-ic">' + ICON[x.status] + '</span>' +
      '<div class="rgt-t"><b>' + esc(x.title) + (WORD[x.status] && !primary ? '<span class="rgt-sr">, ' + esc(WORD[x.status]) + "</span>" : "") + (primary ? ' <span class="rgt-pill in ' + x.status + '">' + WORD[x.status] + "</span>" : "") + "</b><span>" + esc(x.text) + "</span></div>" +
      (primary ? '<span class="rgt-pill out ' + x.status + '">' + WORD[x.status] + "</span>" : "") +
      '<button type="button" class="rgt-btn' + (primary ? " p" : " q") + '" data-rgt-go="' + i + '" aria-label="' + esc(x.act + ": " + x.title) + '">' + esc(x.act) + (primary ? "" : " ›") + "</button></li>";
  }

  function paint(slot) {
    if (!slot || !slot.isConnected) return;
    css();
    var D = S.data, h = '<section class="rgt" aria-labelledby="rgt-h"><div class="rgt-head"><h2 id="rgt-h">Today\'s registers</h2>' + (D ? "<small>Checked " + esc(D.time || "") + "</small>" : "") + "</div>";
    if (!D && S.error) {
      h += '<div class="rgt-err" role="alert"><span>' + esc(S.error) + '</span><button type="button" class="rgt-btn" data-rgt-retry>Try again</button></div>';
    } else if (!D) {
      h += '<ul class="rgt-list solo" aria-busy="true" aria-label="Checking today\'s registers">' + '<li class="rgt-sk"></li><li class="rgt-sk"></li><li class="rgt-sk"></li></ul>';
    } else {
      var list = sorted(items(D)), sm = summary(list);
      h += '<div class="rgt-live" aria-live="polite">' + (sm.allDone ? '<div class="rgt-sum all" role="status"><span class="rgt-ic">' + ICON.done + "</span>" + esc(headText(sm)) + "</div>" : '<div class="rgt-sum">' + esc(headText(sm)) + "</div>") + "</div>";
      if (!sm.allDone) h += '<ul class="rgt-list">' + list.map(rowHtml).join("") + "</ul>";
      else h += '<ul class="rgt-list solo" style="margin-top:8px" aria-label="Done today">' + list.map(rowHtml).join("") + "</ul>";
      if (S.error) h += '<p class="rgt-foot" role="status">' + esc(S.error) + " Showing what was checked at " + esc(D.time || "") + ".</p>";
      S.list = list;
    }
    paintChips(D, S.list || []);
    h += "</section>";
    var ae = document.activeElement, keep = ae && slot.contains(ae) ? (ae.getAttribute("data-rgt-go") != null ? '[data-rgt-go="' + ae.getAttribute("data-rgt-go") + '"]' : ae.hasAttribute("data-rgt-retry") ? "[data-rgt-retry]" : "") : "";
    slot.innerHTML = h;
    if (keep) { var k = slot.querySelector(keep); if (k) k.focus({ preventScroll: true }); }
    slot.querySelectorAll("[data-rgt-go]").forEach(function (b) {
      b.addEventListener("click", function () { var x = S.list && S.list[Number(b.getAttribute("data-rgt-go"))]; if (x) go(x.go); });
    });
    var rt = slot.querySelector("[data-rgt-retry]");
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
  // Controlled-drug cards get none (nothing cheap and certain to say). Inspection check: its last run, as the
  // Inspection check writes it (C2: localStorage "eikon_ins_last:<location>").
  function ago(ms) { var d = Math.floor((Date.now() - ms) / 864e5); return d <= 0 ? "today" : d === 1 ? "yesterday" : d + " days ago"; }
  function chips(D, list) {
    var out = {}, by = {}; (list || []).forEach(function (x) { by[x.key] = x; });
    var temps = list.filter(function (x) { return /^temp:/.test(x.key); });
    if (temps.length) {
      var notLogged = temps.filter(function (x) { return !(D.temperature || []).some(function (t) { return "temp:" + t.device_id === x.key && t.today; }); }).length;
      var bad = temps.filter(function (x) { return x.status === "overdue"; }).length;
      out.temperature = bad ? { status: "overdue", text: plural(bad, "note") + " to write" } : notLogged ? { status: "todo", text: notLogged + " to log today" } : temps.some(function (x) { return x.status === "todo"; }) ? { status: "todo", text: "Check a note" } : { status: "done", text: "Done today" };
    }
    var c = by.clean; if (c) out.cleaning = { status: c.status, text: c.status === "overdue" ? "Overdue" : c.status === "todo" ? (D.cleaning && D.cleaning.days_since == null ? "Not recorded yet" : "Due today") : D.cleaning && D.cleaning.days_since === 0 ? "Done today" : "Done " + (D.cleaning.days_since === 1 ? "yesterday" : D.cleaning.days_since + " days ago") };
    var d = by.daily; if (d) out.dailyregister = d.status === "done" ? { status: "done", text: plural(Number(D.daily_register.count_today) || 0, "line") + " today" } : d.status === "todo" ? { status: "todo", text: "No line today" } : null;
    var l = by.locum; if (l) out.locumregister = l.status === "done" ? { status: "done", text: "In charge: " + ((D.locum.entries || [])[0] || {}).name } : { status: "todo", text: "Nobody signed in today" };
    var ce = by.cert; if (ce) {
      var ex = (D.certificates || []).filter(function (x) { return x.status === "expired"; }), sn = (D.certificates || []).filter(function (x) { return x.status === "due_soon"; });
      out.certificates = ex.length ? { status: "overdue", text: plural(ex.length, "expired", "expired") } : sn.length ? { status: "todo", text: sn[0].days === 0 ? "Due today" : "Due in " + plural(sn[0].days, "day") } : Number(D.certificates_not_recorded) > 0 ? { status: "todo", text: Number(D.certificates_not_recorded) + " not on file" } : { status: "done", text: "All in date" };
    }
    try {
      var last = JSON.parse(localStorage.getItem("eikon_ins_last:" + locId()) || "null");
      if (last && last.at) { var at = typeof last.at === "number" ? last.at : Date.parse(last.at); if (isFinite(at)) out.insreg = { status: last.level === "ok" ? "done" : "todo", text: "Last check: " + (last.level === "ok" ? "in order" : "something to fix") + ", " + ago(at) }; }
    } catch (e) {}
    return out;
  }
  function paintChips(D, list) {
    var hub = document.querySelector('.hub[data-hub="registers"]'); if (!hub) return;
    var ch = D ? chips(D, list) : {};
    hub.querySelectorAll(".hub-card[data-open]").forEach(function (card) {
      var mid = card.getAttribute("data-open"), x = ch[mid], el = card.querySelector(".rgt-chip");
      if (!x) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("em"); card.appendChild(el); }
      el.className = "rgt-chip " + x.status; el.textContent = x.text;
    });
  }

  E.regToday = { items: items, sorted: sorted, summary: summary, headText: headText, chips: chips, load: load, render: render, state: S };
  // A slot already on screen (the hub drew before this file arrived): fill it now.
  try { var pre = document.getElementById("rgt-slot"); if (pre && E.state.activeModuleId === "registers") render(pre); } catch (e) {}
})();
