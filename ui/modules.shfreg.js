/* Plan shifts, new layout: the planning side of Who's in. The same week, day by day; add a shift for a person on a day,
   change its times or note, remove it (after a confirm); answer leave requests (approve or refuse). Same endpoints and
   the same checks as the classic Shifts screen: end after start, nobody planned on a day of approved leave, a warning
   before two pharmacists overlap, a warning before approving a pharmacist's leave with no one to cover.
   A change sends the shift's whole record (the server writes start, end, role and note together), so the role a
   pattern set is kept. A person can be added to the rota here (the classic "Add Employee" body, with its defaults), so a
   new pharmacy's empty rota is never a dead end. A new leave request is made here too (the classic Leave tab's
   "Submit Leave Request": the same body, the same hours worked out, locums left out as there). Patterns, opening
   hours, changing a person's details, leave balances and history, and the calendar link stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, monday: null, staff: {}, shifts: [], leaves: [], hours: null, rules: null, loading: false, error: "", leaveErr: "", form: null, saving: false, ask: null, busy: 0, lvMsg: "", last: null, who: null, lv: null, lvYears: [] };
  var DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // The classic Leave tab's leave types, in its order, in the words used on this screen ("Annual leave").
  var LTYPES = [["annual", "Annual leave"], ["sick", "Sick leave"], ["urgent_family", "Urgent family leave (force majeure)"], ["maternity", "Maternity leave"], ["paternity", "Paternity leave"], ["parental", "Parental leave"], ["miscarriage", "Miscarriage leave"], ["other", "Other"]];
  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function plus(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return plus(x, -((x.getDay() + 6) % 7)); }
  function parse(s) { var p = String(s || "").split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function short(s) { var d = parse(s); return d.getDate() + " " + MON[d.getMonth()]; }
  function hm(t) { return String(t || "").slice(0, 5); }
  function mins(t) { var p = hm(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "")[0] || "?").toUpperCase() + ((p[1] || "")[0] || "").toUpperCase(); }
  function hue(n) { var h = 0; String(n || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function av(name, grey) { return '<span class="shf-av" aria-hidden="true" style="background:hsl(' + hue(name) + "," + (grey ? "20%,40%" : "45%,32%") + ')">' + esc(initials(name)) + "</span>"; }
  function person(id) { return S.staff[id] || { id: id, full_name: "Staff #" + id }; }
  function desig(p) { var d = low(p && p.designation); return DESIG[d] || (p && p.designation) || ""; }
  function isPharm(p) { var d = low(p && p.designation); return d === "pharmacist" || d === "locum"; }
  function active() { return Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return Number(p.is_active) !== 0; }).sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); }); }
  function leaveLabel(t) { var x = String(t || "leave").replace(/_/g, " ").trim(); x = x.charAt(0).toUpperCase() + x.slice(1); return /\s|leave/i.test(x) ? x : x + " leave"; }
  function approvedOn(staffId, key) { return S.leaves.filter(function (l) { return low(l.status) === "approved" && Number(l.staff_id) === Number(staffId) && l.start_date <= key && l.end_date >= key; })[0] || null; }
  function truthy(v) { return v === true || v === 1 || v === "1" || v === "true"; }
  // A day's opening hours and pharmacist cover: the one shared rule (E.teamCover in core.js: a one-day override, a Malta
  // public holiday closed unless an override opens it, the weekly hours; the classic coverage check for the gaps).
  function dayCover(key) { return E.teamCover(key, { hours: S.hours, settings: S.rules, shifts: S.shifts, staff: S.staff, leaves: S.leaves }); }
  function hoursFor(key) { return dayCover(key); }
  // Who can cover a gap: pharmacists and locums on the team, not on approved leave that day and not already on then.
  // Those with no shift that day come first, then locums.
  function fillers(key, g) {
    var a = mins(g.from), z = mins(g.to);
    return active().filter(function (p) {
      if (!isPharm(p) || approvedOn(p.id, key)) return false;
      return !S.shifts.some(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(p.id) && mins(x.start_time) < z && mins(x.end_time) > a; });
    }).map(function (p) { return { p: p, k: (S.shifts.some(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(p.id); }) ? 2 : 0) + (low(p.designation) === "locum" ? 1 : 0) }; })
      .sort(function (x, y) { return x.k - y.k || String(x.p.full_name).localeCompare(String(y.p.full_name)); }).map(function (x) { return x.p; });
  }
  function overlaps(key, st, et, skipId) { // other pharmacists (or locums) already on in that time
    var a = mins(st), z = mins(et);
    return S.shifts.filter(function (x) {
      if (x.shift_date !== key || (skipId != null && Number(x.id) === Number(skipId))) return false;
      if (!(isPharm(person(x.staff_id)) || String(x.role_override || "") === "pharmacist")) return false;
      return mins(x.start_time) < z && mins(x.end_time) > a;
    });
  }

  function css() {
    if (document.getElementById("eikon-shfreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-shfreg-css";
    st.textContent =
      ".shf{max-width:880px;margin:0 auto}" +
      ".shf-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".shf h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.shf-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".shf-nav{display:flex;align-items:center;gap:8px;margin-top:16px}.shf-nav b{flex:1;min-width:0;text-align:center;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".shf-nav button{font:inherit;font-size:20px;line-height:1;width:36px;height:36px;flex:0 0 36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".shf-nav .now{font-size:13px;font-weight:600;width:auto;flex:0 0 auto;padding:0 12px}" +
      ".shf-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.shf-lab b{color:var(--text)}" +
      ".shf-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".shf-day{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-top:10px;overflow:hidden}.shf-day.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}" +
      ".shf-day .h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:10px 14px 6px}.shf-day .h b{font-size:15px;font-weight:700}.shf-day .h span{font-size:12.5px;color:var(--muted);min-width:0;text-align:right;line-height:1.4}.shf-day.today .h b{color:var(--accent)}" +
      ".shf-p{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:.5px solid var(--border);width:100%;box-sizing:border-box;text-align:left;font:inherit;color:var(--text);background:none;border-left:0;border-right:0;border-bottom:0}" +
      "button.shf-p{cursor:pointer;min-height:48px}button.shf-p:hover{background:rgba(118,118,128,.08)}" +
      ".shf-av{flex:0 0 30px;height:30px;border-radius:15px;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}" +
      ".shf-p .t{flex:1;min-width:0}.shf-p .t b{display:block;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.shf-p .t span{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".shf-p em{font-style:normal;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600;white-space:nowrap}" +
      ".shf-p .chev{flex:0 0 8px;width:7px;height:7px;border-right:2px solid var(--muted);border-top:2px solid var(--muted);transform:rotate(45deg);opacity:.6;margin-left:2px}" +
      ".shf-p.off .t b{color:var(--muted)}.shf-p.off em{font-weight:500;color:var(--warn,#8A5A08)}.shf-p .tag{color:var(--warn,#8A5A08);font-weight:600}" +
      ".shf-add{display:block;width:100%;text-align:left;font:inherit;font-size:14.5px;font-weight:600;color:var(--accent);background:none;border:0;border-top:.5px solid var(--border);padding:11px 14px;cursor:pointer;min-height:44px}" +
      ".shf-add:hover{background:rgba(118,118,128,.08)}" +
      ".shf-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 14px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".shf-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.shf-btn:disabled{opacity:.55;cursor:default}" +
      ".shf-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.shf-btn.x{border:0;background:none;color:var(--danger);padding:0 4px;margin-right:auto}" +
      ".shf-form{border-top:.5px solid var(--border);background:rgba(118,118,128,.06)}" +
      ".shf-form label,.shf-form .row{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.shf-form label:first-child,.shf-form .row:first-child{border-top:0}" +
      ".shf-form label>span,.shf-form .row>span{flex:0 0 72px;font-size:15px}.shf-form .row b{flex:1;min-width:0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".shf-form input,.shf-form select{flex:1;min-width:0;width:100%;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".shf-form select:focus-visible,.shf-form input:focus-visible{outline:0}" +
      ".shf-form .acts{display:flex;gap:8px;padding:10px 14px;justify-content:flex-end;align-items:center;flex-wrap:wrap;border-top:.5px solid var(--border)}" +
      ".shf-form .acts .q{flex:1 1 100%;font-size:14px}.shf-form .acts label.sw{display:flex;padding:0;border:0;min-height:44px}.shf-form .acts label.sw>span{flex:0 0 auto;min-width:72px;white-space:nowrap}.shf-swq.bad{color:var(--danger)}.shf-swq b{color:var(--warn,#8A5A08)}" +
      ".shf-err{color:var(--danger);font-size:13.5px;padding:8px 14px 0}" +
      ".shf-warn{font-size:13.5px;margin:8px 14px 0;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.14);line-height:1.4}" +
      ".shf-lv{padding:10px 14px;border-top:.5px solid var(--border)}.shf-lv:first-child{border-top:0}.shf-lv .top{display:flex;align-items:center;gap:10px}" +
      ".shf-lv .t{flex:1;min-width:0}.shf-lv .t b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shf-lv .t span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".shf-lv .why{font-size:13.5px;margin:6px 0 0 40px}.shf-lv .cov{font-size:12.5px;margin:4px 0 0 40px;color:var(--muted)}.shf-lv .cov.bad{color:var(--danger);font-weight:600}" +
      ".shf-lv .acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:8px}.shf-lv .acts .q{flex:1 1 100%;font-size:14px}" +
      ".shf-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".shf-note{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.6}.shf-note a{color:var(--accent)}.shf-quiet .shf-btn{display:block;margin-top:12px}" +
      ".shf-who{margin-top:14px}.shf-who h2{font-size:17px;font-weight:700;margin:0;padding:12px 14px 2px}.shf-who p{margin:0;padding:0 14px 8px;font-size:13.5px;color:var(--muted)}.shf-who .ok{color:var(--ok);font-weight:600}" +
      ".shf-form .two{display:flex;gap:8px;flex:1;min-width:0;align-items:center}.shf-form .two input{flex:1}.shf-form .two i{font-style:normal;color:var(--muted)}" +
      ".shf-form .hint{font-size:12.5px;color:var(--muted);padding:0 14px 8px 98px;margin-top:-6px}.shf-form [aria-invalid=true]{box-shadow:inset 0 -2px 0 var(--danger)}" +
      ".shf-gap{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:14.5px;min-height:48px;padding:8px 14px;border:0;border-top:.5px solid var(--border);background:var(--warn-soft,rgba(201,138,18,.16));color:var(--text);cursor:pointer}" +
      ".shf-gap b{flex:1;min-width:0;color:var(--warn,#8A5A08);font-weight:700}.shf-gap span:not(.chev){font-weight:600;color:var(--warn,#8A5A08);white-space:nowrap}.shf-gap .chev{flex:0 0 8px;width:7px;height:7px;border-right:2px solid var(--warn,#8A5A08);border-top:2px solid var(--warn,#8A5A08);transform:rotate(45deg)}" +
      ".shf-day.today .shf-gap{background:var(--danger-soft,rgba(191,59,46,.12))}.shf-day.today .shf-gap b,.shf-day.today .shf-gap span:not(.chev){color:var(--danger)}.shf-day.today .shf-gap .chev{border-color:var(--danger)}.shf-fillh{padding:10px 14px 2px;font-size:14px;font-weight:600;color:var(--warn,#8A5A08)}" +
      ".shf-hol{border-top:.5px solid var(--border);padding:10px 14px;font-size:13.5px;background:rgba(201,138,18,.12)}.shf-day.shut:not(.today) .h b{color:var(--muted)}" +
      ".shf-sk{height:150px;margin-top:10px;border-radius:12px;background:rgba(118,118,128,.1)}.shf-sk+.shf-sk{height:110px}" +
      // A wide desktop shows the week in two columns (Monday to Sunday reading across), so most of it is seen without scrolling.
      "@media (min-width:1280px){.shf{max-width:1180px}.shf-week{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;align-items:stretch}.shf-week .shf-day{margin-top:0;display:flex;flex-direction:column}.shf-week .shf-day>.shf-add:last-child{margin-top:auto}}" +
      "@media (max-width:600px){.shf{padding:4px 16px 0}.shf h1{font-size:32px}.shf-nav button{width:44px;height:44px;flex-basis:44px;border-radius:22px}.shf-nav .now{flex:0 0 auto}.shf-btn{height:44px;border-radius:22px}.shf-note a{display:inline-block;padding:12px 0;margin:-12px 0}}";
    document.head.appendChild(st);
  }

  function years() { var a = [S.monday.getFullYear(), plus(S.monday, 6).getFullYear(), new Date().getFullYear()].concat(S.lvYears); return a.filter(function (y, i) { return a.indexOf(y) === i; }); }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var from = ymd(S.monday), to = ymd(plus(S.monday, 6)), ys = years();
    try {
      var res = await Promise.all([E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }), E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to, { method: "GET" }),
        E.rotaRules(), null]
        .concat(ys.map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }).catch(function () { return null; }); })));
      if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) throw new Error((res[1] && res[1].error) || (res[0] && res[0].error) || "Could not load the rota");
      if (from !== ymd(S.monday)) return; // the week changed while this was loading: the newer load paints
      S.staff = {}; (res[0].staff || []).forEach(function (p) { S.staff[p.id] = p; });
      S.shifts = (res[1].shifts || []).slice().sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
      S.hours = (res[2] && res[2].hours) || S.hours; S.rules = (res[2] && res[2].settings) || S.rules; // opening hours and cover rules: E.rotaRules keeps them 5 minutes
      var lv = res.slice(4), seen = {};
      S.leaveErr = lv.some(function (r) { return !r || !r.ok; }) ? "Leave requests could not be loaded. Try again in a moment." : "";
      S.leaves = [].concat.apply([], lv.map(function (r) { return (r && r.ok && r.leaves) || []; })).filter(function (l) { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the rota"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  async function dayList(key) {
    var r = await E.apiFetch("/shifts/assignments-range?from=" + key + "&to=" + key, { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the day");
    return r.shifts || [];
  }

  // After a change, only that day is read again (one bounded read), so the day's cover and any gap update at once.
  async function refreshDay(key) {
    var wk = ymd(S.monday);
    try {
      var list = await dayList(key);
      if (wk !== ymd(S.monday)) return; // the week moved meanwhile: its own load paints
      S.shifts = S.shifts.filter(function (x) { return x.shift_date !== key; }).concat(list).sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
      E.whenFormIdle(S.mount, function () { paint(); });
    } catch (e) { await load(); }
  }
  function leaveWhen(l) {
    var t = l.start_date === l.end_date || !l.end_date ? short(l.start_date) : (parse(l.start_date).getMonth() === parse(l.end_date).getMonth() ? parse(l.start_date).getDate() + "–" + short(l.end_date) : short(l.start_date) + " – " + short(l.end_date));
    if (l.start_time || l.end_time) t += ", " + hm(l.start_time || "") + "–" + hm(l.end_time || "");
    return t;
  }
  function cover(l) { // same rule as the classic screen: a pharmacist's leave needs another pharmacist or a locum
    var p = person(l.staff_id); if (low(p.designation) !== "pharmacist") return null;
    var alts = active().filter(function (x) { return isPharm(x) && Number(x.id) !== Number(p.id); });
    var locum = active().some(function (x) { return low(x.designation) === "locum"; });
    return { alts: alts.length, locum: locum };
  }
  function leaveHtml(l) {
    var p = person(l.staff_id), c = cover(l), a = S.ask && S.ask.id === l.id ? S.ask.kind : "";
    var h = '<div class="shf-lv"><div class="top">' + av(p.full_name) + '<div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(leaveLabel(l.leave_type)) + " · " + esc(leaveWhen(l)) + (l.hours_requested ? " · " + esc(String(l.hours_requested)) + " h" : "") + "</span></div></div>";
    if (l.reason) h += '<div class="why">' + esc(l.reason) + "</div>";
    if (c) h += c.alts ? '<div class="cov">Another pharmacist can cover.</div>' : c.locum ? '<div class="cov">A locum is on the team: plan a locum shift for these days.</div>' : '<div class="cov bad">No other pharmacist or locum on the team: book a locum.</div>';
    h += '<div class="acts">';
    var dis = S.busy ? " disabled" : "";
    if (a === "refuse") h += '<span class="q">Refuse this request?</span><button class="shf-btn" data-act="lv-keep">Keep it</button><button class="shf-btn d" data-act="lv-refuse-yes" data-id="' + l.id + '"' + dis + ">Refuse</button>";
    else if (a === "shifts") { var L2 = S.ask.shifts.map(function (x) { return short(x.shift_date) + " " + hm(x.start_time) + "–" + hm(x.end_time); }); h += '<span class="q">' + esc(p.full_name) + " has " + (L2.length === 1 ? "a shift" : L2.length + " shifts") + " on these days (" + esc(L2.join(", ")) + "). Remove " + (L2.length === 1 ? "it" : "them") + ' too?</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn" data-act="lv-keep-shifts" data-id="' + l.id + '"' + dis + '>Approve, keep shifts</button><button class="shf-btn p" data-act="lv-drop-shifts" data-id="' + l.id + '"' + dis + ">Approve and remove</button>"; }
    else if (a === "gap") h += '<span class="q">Approving leaves the pharmacy without a pharmacist on these days. Approve anyway?</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn p" data-act="lv-approve-yes" data-id="' + l.id + '"' + dis + ">Approve anyway</button>";
    else if (a === "locum") h += '<span class="q">Make sure a locum shift is planned for these days.</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn p" data-act="lv-approve-yes" data-id="' + l.id + '"' + dis + ">Approve</button>";
    else h += '<button class="shf-btn" data-act="lv-refuse" data-id="' + l.id + '"' + dis + ' aria-label="Refuse ' + esc(p.full_name) + "'s leave\">Refuse</button>" + '<button class="shf-btn p" data-act="lv-approve" data-id="' + l.id + '"' + dis + ' aria-label="Approve ' + esc(p.full_name) + "'s leave\">Approve</button>";
    return h + "</div></div>";
  }

  // A day's shifts in time order with its gaps in their place (a gap 14:00–15:00 sits between the shift ending at 14:00
  // and the one starting at 15:00), so the hole shows without reading.
  function inTime(day, gapRows, row) {
    var out = [], g = gapRows.slice();
    day.forEach(function (x) { while (g.length && g[0].at <= hm(x.start_time)) out.push(g.shift().h); out.push(row(x)); });
    return out.concat(g.map(function (r) { return r.h; })).join("");
  }
  // A gap in pharmacist cover, in words; one tap opens a new shift for those hours with a free pharmacist chosen.
  function gapHtml(key, g, dayName) {
    var t = g.from + "–" + g.to;
    return '<button class="shf-gap" data-act="fill" data-date="' + key + '" data-s="' + g.from + '" data-e="' + g.to + '" aria-label="No pharmacist ' + esc(g.from) + " to " + esc(g.to) + " on " + esc(dayName) + ': fill the gap"><b>No pharmacist ' + esc(t) + '</b><span>Fill the gap</span><span class="chev" aria-hidden="true"></span></button>';
  }

  function formHtml(key) {
    var f = S.form, h = '<form class="shf-form" id="shf-form" autocomplete="off">';
    if (f.mode === "add") {
      var free = active().filter(function (p) { return !approvedOn(p.id, key); });
      var opt = function (p) { return '<option value="' + p.id + '"' + (String(f.staff_id) === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + (desig(p) ? " · " + esc(desig(p)) : "") + "</option>"; };
      var first = f.gap ? fillers(key, f.gap) : [], ids = first.map(function (p) { return String(p.id); });
      h += (f.gap ? '<div class="shf-fillh">Fill the gap ' + esc(f.gap.from + "–" + f.gap.to) + (first.length ? "" : ": no pharmacist is free then. Choose a person, or add a locum to the rota.") + "</div>" : "") +
        '<label><span>Who</span><select name="staff_id"><option value="">Choose a person</option>' +
        (first.length ? '<optgroup label="Free to cover ' + esc(f.gap.from + "–" + f.gap.to) + '">' + first.map(opt).join("") + '</optgroup><optgroup label="Everyone else">' + free.filter(function (p) { return ids.indexOf(String(p.id)) < 0; }).map(opt).join("") + "</optgroup>" : free.map(opt).join("")) + "</select></label>";
    } else {
      var p = person(f.staff_id);
      h += '<div class="row"><span>Who</span><b>' + esc(p.full_name) + "</b></div>";
    }
    h += '<label><span>Starts</span><input type="time" name="start_time" value="' + esc(f.start_time) + '"></label>' +
      '<label><span>Ends</span><input type="time" name="end_time" value="' + esc(f.end_time) + '"></label>' +
      '<label><span>Note</span><input name="notes" value="' + esc(f.notes) + '" placeholder="Optional"></label>';
    if (f.warn) h += '<div class="shf-warn" role="status">' + esc(f.warn) + "</div>";
    if (f.err) h += '<div class="shf-err" role="alert">' + esc(f.err) + "</div>";
    h += '<div class="acts">';
    if (f.swap) h += swapHtml(key);
    else if (f.confirmDel) h += '<span class="q">Remove this shift? It is taken off the rota.</span><button type="button" class="shf-btn" data-act="del-no">Keep it</button><button type="button" class="shf-btn d" data-act="del-yes"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Removing…" : "Remove") + "</button>";
    else {
      if (f.mode === "edit") h += '<button type="button" class="shf-btn x" data-act="del">Remove shift</button>' + (swapList(f).length ? '<button type="button" class="shf-btn" data-act="swap">Swap…</button>' : "");
      h += '<button type="button" class="shf-btn" data-act="cancel">Cancel</button><button type="submit" class="shf-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : f.warnSig ? "Save anyway" : f.mode === "add" ? "Add shift" : "Save") + "</button>";
    }
    return h + "</div></form>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "shfreg") return; // left before a reply came back: do not draw over the next screen
    if (S.form && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var sun = plus(S.monday, 6), thisWeek = ymd(mondayOf(new Date())) === ymd(S.monday);
    var label = S.monday.getDate() + " " + MON[S.monday.getMonth()] + " – " + sun.getDate() + " " + MON[sun.getMonth()];
    var ae = document.activeElement, keepAct = ae && m.contains(ae) && !(ae.closest && ae.closest("form")) ? ae.getAttribute("data-act") : null; // the week arrows keep focus across the redraw
    var h = '<div class="shf"><button class="shf-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("shfreg") : "‹ Team") + '</button><h1>Plan shifts</h1><p class="shf-sub">Who works when: add, change or remove a shift, and answer leave requests.</p>';
    if (S.loading && !Object.keys(S.staff).length) h += '<div role="status" aria-label="Opening the rota"><div class="shf-sk"></div><div class="shf-sk"></div></div>'; // the shape of the week, not a spinner
    else if (S.error) h += '<div class="shf-quiet" role="alert">' + esc(S.error) + '<button class="shf-btn" data-act="retry">Try again</button></div>';
    else {
      var pending = S.leaves.filter(function (l) { return low(l.status) === "pending"; }).sort(function (a, b) { return String(a.start_date).localeCompare(String(b.start_date)); });
      if (pending.length || S.lvMsg || S.lv || leavers().length) {
        h += '<div class="shf-lab">Leave requests <b>' + pending.length + "</b></div>";
        if (S.lvMsg) h += '<div class="shf-err" role="alert" style="padding:0 2px 6px">' + esc(S.lvMsg) + "</div>";
        h += '<div class="shf-card">' + pending.map(leaveHtml).join("") +
          (S.lv ? lvFormHtml() : leavers().length ? '<button class="shf-add"' + (pending.length ? "" : ' style="border-top:0"') + ' data-act="lv-new" data-k="lv-new">+ New leave request</button>' : "") + "</div>";
      }
      if (S.leaveErr) h += '<p class="shf-note">' + esc(S.leaveErr) + "</p>";
      if (!active().length && !S.who && !S.loading) S.who = newWho(); // an empty rota opens on the one thing to do: add the people who work here
      if (S.who) h += whoHtml();
      h += '<div class="shf-nav"><button data-act="prev" aria-label="Previous week" title="Previous week (←)">‹</button><b>' + esc(label) + "</b>" + (thisWeek ? "" : '<button class="now" data-act="now">This week</button>') + '<button data-act="next" aria-label="Next week" title="Next week (→)">›</button></div>';
      var today = ymd(new Date());
      h += '<div class="shf-week">';
      for (var i = 0; i < 7; i++) {
        var d = plus(S.monday, i), key = ymd(d), oh = hoursFor(key);
        var day = S.shifts.filter(function (x) { return x.shift_date === key; });
        var away = S.leaves.filter(function (l) { var st = low(l.status); return (st === "approved" || st === "pending") && l.start_date <= key && l.end_date >= key; });
        var gaps = oh.gaps;
        var info = d.getDate() + " " + MON[d.getMonth()] + " · " + (oh.closed ? oh.words : oh.open + "–" + oh.close + (oh.holiday ? " · Public holiday (" + oh.holiday + ")" : "")) + (day.length ? " · " + day.length + (day.length === 1 ? " shift" : " shifts") : "");
        h += '<section class="shf-day' + (key === today ? " today" : "") + (gaps.length ? " gap" : "") + (oh.closed ? " shut" : "") + '" aria-label="' + esc(DAY[i] + " " + d.getDate() + " " + MON[d.getMonth()]) + '"><div class="h"><b>' + (key === today ? "Today" : DAY[i]) + "</b><span>" + esc(info) + "</span></div>";
        var gapRows = S.form && S.form.gap && S.form.date === key ? [] : gaps.map(function (g) { return { at: g.from, h: gapHtml(key, g, DAY[i] + " " + d.getDate() + " " + MON[d.getMonth()]) }; });
        h += inTime(day, gapRows, function (x) {
          if (S.form && S.form.mode === "edit" && Number(S.form.id) === Number(x.id)) return formHtml(key);
          var p = person(x.staff_id), off = approvedOn(x.staff_id, key), asked = !off && S.leaves.some(function (l) { return low(l.status) === "pending" && Number(l.staff_id) === Number(x.staff_id) && l.start_date <= key && l.end_date >= key; });
          var sub = [x.role_override ? desig({ designation: x.role_override }) : desig(p), x.notes].filter(Boolean).map(esc).join(" · ");
          return '<button class="shf-p" data-act="edit" data-id="' + x.id + '" aria-label="Change ' + esc(p.full_name) + "'s shift, " + esc(hm(x.start_time)) + " to " + esc(hm(x.end_time)) + '">' + av(p.full_name) + '<span class="t"><b>' + esc(p.full_name) + "</b><span>" + (off ? '<span class="tag">On leave</span>' + (sub ? " · " : "") : asked ? '<span class="tag">Asked for leave this day</span>' + (sub ? " · " : "") : "") + sub + "</span></span><em>" + esc(hm(x.start_time)) + "–" + esc(hm(x.end_time)) + '</em><span class="chev" aria-hidden="true"></span></button>';
        });
        h += away.map(function (l) {
          var p = person(l.staff_id);
          return '<div class="shf-p off">' + av(p.full_name, true) + '<div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(leaveLabel(l.leave_type)) + "</span></div><em>" + (low(l.status) === "pending" ? "Asked for leave" : "Away") + (l.start_time && l.start_date === key ? " from " + esc(hm(l.start_time)) : "") + "</em></div>";
        }).join("");
        if (oh.closed && oh.holiday && day.length) h += '<div class="shf-hol">' + esc(oh.holiday) + " is a public holiday: the pharmacy is closed unless its opening hours say it opens.</div>";
        if (S.form && S.form.mode === "add" && S.form.date === key) h += formHtml(key);
        else if (active().length) h += '<button class="shf-add" data-act="add" data-date="' + key + '" aria-label="Add a shift on ' + esc(DAY[i] + " " + d.getDate() + " " + MON[d.getMonth()]) + '">+ Add shift</button>';
        h += "</section>";
      }
      h += "</div>";
      if (!S.who && active().length) h += '<div class="shf-card" style="margin-top:10px"><button class="shf-add" style="border-top:0" data-act="who" data-k="who">+ Add a person to the rota</button></div>';
    }
    h += '<p class="shf-note">Patterns, opening hours, changing a person’s details, leave balances and history, and the calendar link are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    m.innerHTML = h;
    if (keepAct && /^(prev|next|now)$/.test(keepAct)) { var kb = m.querySelector('[data-act="' + keepAct + '"]') || m.querySelector('[data-act="next"]'); if (kb) kb.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("shfreg") : "#team";
        else if (a === "retry") load();
        else if (a === "prev" || a === "next" || a === "now") { if (S.saving) return; S.form = null; S.ask = null; S.monday = a === "now" ? mondayOf(new Date()) : plus(S.monday, a === "prev" ? -7 : 7); S.shifts = []; load(); }
        else if (a === "add") { var key = b.getAttribute("data-date"); S.form = addDefaults(key); paint(true); focus(S.form.staff_id ? "start_time" : "staff_id"); }
        else if (a === "edit") { var x = S.shifts.filter(function (s) { return Number(s.id) === id; })[0]; if (!x) return; S.form = { mode: "edit", id: x.id, date: x.shift_date, staff_id: x.staff_id, start_time: hm(x.start_time), end_time: hm(x.end_time), notes: x.notes || "", err: "", warn: "", warnSig: "" }; paint(true); focus("start_time"); }
        else if (a === "cancel") closeForm();
        else if (a === "del") { keep(); S.form.confirmDel = true; S.form.err = ""; paint(true); var y = m.querySelector('[data-act="del-no"]'); if (y) y.focus(); }
        else if (a === "del-no") { S.form.confirmDel = false; paint(true); }
        else if (a === "swap") { keep(); S.form.swap = { with: swapList(S.form).length === 1 ? String(swapList(S.form)[0].id) : "" }; S.form.err = ""; paint(true); var sw = m.querySelector("#shf-form [name=swap_with]"); if (sw) sw.focus(); }
        else if (a === "swap-no") { S.form.swap = null; paint(true); var sb2 = m.querySelector('#shf-form [data-act="swap"]'); if (sb2) sb2.focus(); }
        else if (a === "swap-yes") swap();
        else if (a === "del-yes") remove();
        else if (a === "lv-approve") approveAsk(id);
        else if (a === "lv-keep-shifts") approveAsk(id, []);
        else if (a === "lv-drop-shifts") approveAsk(id, S.ask && S.ask.shifts || []);
        else if (a === "lv-approve-yes") answer(id, "approve", S.ask && S.ask.drop);
        else if (a === "lv-refuse") { S.ask = { id: id, kind: "refuse" }; paint(); var k = m.querySelector('[data-act="lv-keep"]'); if (k) k.focus(); }
        else if (a === "lv-refuse-yes") answer(id, "reject");
        else if (a === "lv-keep") { S.ask = null; paint(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "shfreg"); } catch (x2) {} E.openClassic("shifts"); }
        else if (a === "who") { S.who = newWho(); paint(true); var n = m.querySelector('#shf-who [name="full_name"]'); if (n) n.focus(); }
        else if (a === "who-done") closeWho();
        else if (a === "lv-new") openLeave();
        else if (a === "fill") { if (S.saving) return; openGap(b.getAttribute("data-date"), { from: b.getAttribute("data-s"), to: b.getAttribute("data-e") }); }
        else if (a === "lv-cancel") closeLeave();
      });
    });
    var w = m.querySelector("#shf-who"); if (w) {
      w.addEventListener("submit", function (ev) { ev.preventDefault(); addPerson(w); });
      w.addEventListener("input", function (ev) { var t = ev.target; if (t && t.name && S.who) { S.who[t.name] = t.value; t.removeAttribute("aria-invalid"); } });
      w.addEventListener("change", function (ev) { var t = ev.target; if (t && t.name && S.who) S.who[t.name] = t.value; });
      w.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && S.who && !S.who.saving && active().length) { ev.preventDefault(); ev.stopPropagation(); closeWho(); } });
    }
    var lf = m.querySelector("#shf-lvf"); if (lf) {
      lf.addEventListener("submit", function (ev) { ev.preventDefault(); saveLeave(); });
      lf.addEventListener("input", function (ev) { var t = ev.target; if (t && t.name && S.lv) { S.lv[t.name] = t.value; t.removeAttribute("aria-invalid"); } });
      lf.addEventListener("change", function (ev) {
        var t = ev.target; if (!t || !t.name || !S.lv) return; S.lv[t.name] = t.value;
        if (t.name === "end_date") S.lv.endSet = !!t.value;
        if (t.name === "start_date" && !S.lv.endSet) { var ed = lf.querySelector("[name=end_date]"); if (ed) ed.value = t.value; S.lv.end_date = t.value; } // one day unless the last day is chosen
      });
      lf.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !(S.lv && S.lv.saving)) { ev.preventDefault(); ev.stopPropagation(); closeLeave(); } });
    }
    var f = m.querySelector("#shf-form"); if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.form && S.form.swap) swap(); else save(); });
      f.addEventListener("change", function (ev) { if (ev.target && ev.target.name === "swap_with" && S.form && S.form.swap) { keep(); S.form.swap.with = ev.target.value; paint(true); var w2 = m.querySelector("#shf-form [name=swap_with]"); if (w2) w2.focus(); } });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.saving) { ev.preventDefault(); ev.stopPropagation(); if (S.form && S.form.swap) { S.form.swap = null; paint(true); } else if (S.form && S.form.confirmDel) { S.form.confirmDel = false; paint(true); } else closeForm(); } }); // Escape closes, as everywhere
    }
  }
  // ---- Add a person to the rota: the classic "Add Employee" with what it sends for a name and a role ----
  // POST /shifts/staff {full_name, designation, employment_type, contracted_hours, email, phone, registration_number,
  // is_active, patterns_json}: full time 40 h (a locum is external, as the classic sets it), the rest empty. Hours, contact
  // details and patterns are changed in the classic screen, as before.
  function newWho() { return { full_name: "", designation: active().some(isPharm) ? "assistant" : "pharmacist", err: "", saving: false, added: [] }; }
  function whoHtml() {
    var w = S.who, first = !active().length;
    return '<div class="shf-card shf-who"><h2 id="shf-who-t">' + (first ? "Who works here?" : "Add a person to the rota") + "</h2>" +
      "<p>" + (first ? "Add each person once. Then plan their shifts on the week below." : "They can then be given shifts on any day.") + "</p>" +
      (w.added.length ? '<p class="ok" role="status">' + esc(w.added.join(", ")) + (w.added.length === 1 ? " is" : " are") + " on the rota. Add the next person, or press Done.</p>" : "") +
      '<form class="shf-form" id="shf-who" novalidate aria-labelledby="shf-who-t">' +
      '<label><span>Name</span><input name="full_name" value="' + esc(w.full_name) + '" autocomplete="off" enterkeyhint="done"' + (w.err ? ' aria-invalid="true" aria-describedby="shf-who-err"' : "") + (w.saving ? " disabled" : "") + "></label>" +
      '<label><span>Role</span><select name="designation"' + (w.saving ? " disabled" : "") + ">" + Object.keys(DESIG).map(function (k) { return '<option value="' + k + '"' + (w.designation === k ? " selected" : "") + ">" + DESIG[k] + "</option>"; }).join("") + "</select></label>" +
      (w.err ? '<div class="shf-err" role="alert" id="shf-who-err">' + esc(w.err) + "</div>" : "") +
      '<div class="acts">' + (w.added.length || !first ? '<button type="button" class="shf-btn" data-act="who-done" data-k="who-done">Done</button>' : "") +
      '<button type="submit" class="shf-btn p" data-k="who-add"' + (w.saving ? " disabled" : "") + ">" + (w.saving ? "Adding…" : "Add to the rota") + "</button></div></form></div>";
  }
  function closeWho() { S.who = null; paint(true); var b = S.mount && (S.mount.querySelector('[data-act="who"]') || S.mount.querySelector('[data-act="add"]')); if (b) b.focus(); }
  async function addPerson(form) {
    var w = S.who; if (!w || w.saving) return;
    var nm = form.querySelector('[name="full_name"]'), ds = form.querySelector('[name="designation"]');
    w.full_name = String(nm.value || ""); w.designation = ds.value;
    var name = w.full_name.trim();
    if (!name) { w.err = "Write the person’s name, as it should show on the rota."; paint(true); var n0 = S.mount.querySelector('#shf-who [name="full_name"]'); if (n0) n0.focus(); return; }
    var body = { full_name: name, designation: w.designation, employment_type: w.designation === "locum" ? "external" : "fulltime", contracted_hours: 40,
      email: "", phone: "", registration_number: "", is_active: 1, patterns_json: JSON.stringify({ patterns: [], provisionalId: null }) };
    w.err = ""; w.saving = true; paint(true);
    try {
      await E.postOnce("/shifts/staff", body, { list: async function () { var r = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }); return (r && r.staff) || []; },
        same: function (p) { return String(p.full_name) === name; } });
      w.saving = false; w.added.push(name); w.full_name = ""; w.designation = isPharm({ designation: w.designation }) ? "assistant" : w.designation;
      E.toast(name + " added to the rota", "success");
      try { var st = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }); if (st && st.ok) { S.staff = {}; (st.staff || []).forEach(function (p) { S.staff[p.id] = p; }); } } catch (e1) {} // just the people: the week stays as it is
      paint(true);
      var n = S.mount && S.mount.querySelector('#shf-who [name="full_name"]'); if (n) n.focus(); // ready for the next person
    } catch (e) {
      w.saving = false; w.err = E.saveFailText(e); paint(true);
      var b = S.mount && S.mount.querySelector('[data-k="who-add"]'); if (b) b.focus();
    }
  }

  // ---- A new leave request: the classic Leave tab's "Submit Leave Request" (modules.shifts.js submitLeave) ----
  // POST /shifts/leaves {staff_id, leave_type, start_date, start_time|null, end_date, end_time|null, hours_requested,
  // reason, status:"pending"}, hours worked out as there: a part day is its hours, else 8 for each weekday. (The classic
  // also puts its own local counter in an "id" key, which the server does not read; it is not sent.) Locum pharmacists
  // are self-employed and take no leave: they are left out, as the classic screen refuses them.
  function leavers() { return active().filter(function (p) { return low(p.designation) !== "locum"; }); }
  function t2m(t) { if (!t) return 0; var p = t.split(":"); return +p[0] * 60 + (+p[1] || 0); } // as the classic screen
  function wdCount(s, e) { var n = 0, dt = new Date(s), end = new Date(e); while (dt <= end) { var wd = dt.getDay(); if (wd !== 0 && wd !== 6) n++; dt.setDate(dt.getDate() + 1); } return n; } // as the classic screen
  function leaveBody(v) {
    var sid = parseInt(v.staff_id), sd = v.start_date, st = v.start_time, ed = v.end_date || sd, et = v.end_time, hrs = 0;
    if (st && et) hrs = (t2m(et) - t2m(st)) / 60; else hrs = wdCount(sd, ed) * 8;
    return { staff_id: sid, leave_type: v.leave_type, start_date: sd, start_time: st || null, end_date: ed, end_time: et || null, hours_requested: Math.max(0, +hrs.toFixed(1)), reason: String(v.reason || "").trim(), status: "pending" };
  }
  function openLeave() {
    var one = leavers().length === 1 ? String(leavers()[0].id) : "";
    S.lv = { staff_id: one, leave_type: "annual", start_date: ymd(new Date()), end_date: ymd(new Date()), endSet: false, start_time: "", end_time: "", reason: "", err: "", bad: [], saving: false };
    S.lvMsg = ""; paint(true);
    var el = S.mount && S.mount.querySelector("#shf-lvf [name=" + (one ? "leave_type" : "staff_id") + "]"); if (el) { el.focus(); if (el.scrollIntoView) try { el.scrollIntoView({ block: "center" }); } catch (e) {} }
  }
  function closeLeave() { S.lv = null; paint(true); var b = S.mount && S.mount.querySelector('[data-act="lv-new"]'); if (b) b.focus(); }
  function lvFormHtml() {
    var v = S.lv, bad = function (n) { return v.bad.indexOf(n) >= 0 ? ' aria-invalid="true" aria-describedby="shf-lv-err"' : ""; }, dis = v.saving ? " disabled" : "";
    return '<form class="shf-form" id="shf-lvf" autocomplete="off" novalidate aria-label="New leave request"' + (S.leaves.some(function (l) { return low(l.status) === "pending"; }) ? "" : ' style="border-top:0"') + ">" +
      '<label><span>Who</span><select name="staff_id"' + bad("staff_id") + dis + '><option value="">Choose a person</option>' + leavers().map(function (p) { return '<option value="' + p.id + '"' + (String(v.staff_id) === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>Type</span><select name="leave_type"' + dis + ">" + LTYPES.map(function (t) { return '<option value="' + t[0] + '"' + (v.leave_type === t[0] ? " selected" : "") + ">" + esc(t[1]) + "</option>"; }).join("") + "</select></label>" +
      '<label><span>From</span><input type="date" name="start_date" value="' + esc(v.start_date) + '"' + bad("start_date") + dis + "></label>" +
      '<label><span>Until</span><input type="date" name="end_date" value="' + esc(v.end_date) + '"' + bad("end_date") + dis + "></label>" +
      '<div class="row"><span id="shf-lv-hrs">Hours</span><div class="two" role="group" aria-labelledby="shf-lv-hrs" aria-describedby="shf-lv-hint"><input type="time" name="start_time" aria-label="Leave starts at" value="' + esc(v.start_time) + '"' + bad("start_time") + dis + '><i aria-hidden="true">–</i><input type="time" name="end_time" aria-label="Leave ends at" value="' + esc(v.end_time) + '"' + bad("end_time") + dis + "></div></div>" +
      '<div class="hint" id="shf-lv-hint">Only for part of a day. Empty: whole days.</div>' +
      '<label><span>Reason</span><input name="reason" value="' + esc(v.reason) + '" placeholder="Optional"' + dis + "></label>" +
      (v.err ? '<div class="shf-err" role="alert" id="shf-lv-err">' + esc(v.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="shf-btn" data-act="lv-cancel">Cancel</button><button type="submit" class="shf-btn p"' + dis + ">" + (v.saving ? "Saving…" : "Save leave request") + "</button></div></form>";
  }
  async function saveLeave() {
    var v = S.lv; if (!v || v.saving) return;
    var f = S.mount && S.mount.querySelector("#shf-lvf");
    if (f) ["staff_id", "leave_type", "start_date", "end_date", "start_time", "end_time", "reason"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) v[k] = String(el.value || ""); });
    if (!v.end_date) v.end_date = v.start_date;
    var errs = [], bad = [];
    if (!v.staff_id) { errs.push("Choose who is asking for leave."); bad.push("staff_id"); }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v.start_date)) { errs.push("Choose the first day of leave."); bad.push("start_date"); }
    else if (v.end_date < v.start_date) { errs.push("The last day must be on or after the first day."); bad.push("end_date"); }
    else if (v.start_time && v.end_time && v.start_date === v.end_date && t2m(v.end_time) <= t2m(v.start_time)) { errs.push("The leave must end after it starts."); bad.push("end_time"); }
    v.bad = bad; v.err = errs.length ? errs.join(" ") + " Nothing was saved." : "";
    if (errs.length) { paint(true); var b0 = S.mount && S.mount.querySelector("#shf-lvf [name=" + bad[0] + "]"); if (b0) b0.focus(); return; }
    var body = leaveBody(v), name = person(body.staff_id).full_name, yr = Number(body.start_date.slice(0, 4));
    v.saving = true; paint(true);
    try {
      await E.postOnce("/shifts/leaves", body, { list: async function () { var r = await E.apiFetch("/shifts/leaves?year=" + yr, { method: "GET" }); return (r && r.leaves) || []; },
        same: function (l) { return Number(l.staff_id) === body.staff_id && l.start_date === body.start_date && l.end_date === body.end_date && l.leave_type === body.leave_type && low(l.status) === "pending"; } });
      if (S.lvYears.indexOf(yr) < 0) S.lvYears.push(yr); // a request for next year still shows in the list
      S.lv = null; E.toast("Leave request saved for " + name, "success");
      await load();
      var nb = S.mount && S.mount.querySelector('[data-act="lv-new"]'); if (nb) E.focusIfIdle(nb, E.lastAction(), null); // the reply came late: not from a field the person went to meanwhile
    } catch (x) {
      v.saving = false; v.err = E.saveFailText(x); paint(true);
      var sb = S.mount && S.mount.querySelector('#shf-lvf button[type=submit]'); if (sb) E.focusIfIdle(sb, E.lastAction(), null);
    }
  }

  // A new shift starts from what was last added here (the same person and hours, as a rota repeats across the week)
  // when that person is free that day; otherwise from the day's opening hours with nobody chosen.
  function addDefaults(key) {
    var oh = hoursFor(key), L = S.last, f = { mode: "add", date: key, staff_id: "", start_time: hm(oh.open) || "09:00", end_time: hm(oh.close) || "18:00", notes: "", err: "", warn: "", warnSig: "" };
    if (L) {
      f.start_time = L.start_time; f.end_time = L.end_time;
      var p = S.staff[L.staff_id], taken = S.shifts.some(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(L.staff_id); });
      if (p && Number(p.is_active) !== 0 && !approvedOn(L.staff_id, key) && !taken) f.staff_id = String(L.staff_id);
    }
    return f;
  }
  // ---- Swap two shifts on the same day: each person takes the other's hours ----
  // Two changes as Plan shifts (and the classic change) send them, each the shift's whole record with only start and end
  // swapped (role and note stay with the person). The server keeps a shift's person and day, so a swap is between two
  // shifts of the same day. If the second change fails, the first is put back.
  function swapList(f) { return S.shifts.filter(function (x) { return x.shift_date === f.date && Number(x.id) !== Number(f.id) && Number(x.staff_id) !== Number(f.staff_id); }); }
  function swapCheck(f, other) {
    var mine = S.shifts.filter(function (x) { return Number(x.id) === Number(f.id); })[0]; if (!mine || !other) return { err: "Choose the shift to swap with." };
    var A = person(mine.staff_id), B = person(other.staff_id);
    if (approvedOn(mine.staff_id, f.date)) return { err: A.full_name + " is on approved leave that day." };
    if (approvedOn(other.staff_id, f.date)) return { err: B.full_name + " is on approved leave that day." };
    var clash = function (sid, skip, st, et) { return S.shifts.filter(function (x) { return x.shift_date === f.date && Number(x.staff_id) === Number(sid) && Number(x.id) !== Number(skip) && Number(x.id) !== Number(mine.id) && Number(x.id) !== Number(other.id) && mins(x.start_time) < mins(et) && mins(x.end_time) > mins(st); })[0]; };
    var ca = clash(mine.staff_id, mine.id, other.start_time, other.end_time), cb = clash(other.staff_id, other.id, mine.start_time, mine.end_time);
    if (ca) return { err: A.full_name + " already works " + hm(ca.start_time) + "–" + hm(ca.end_time) + " that day." };
    if (cb) return { err: B.full_name + " already works " + hm(cb.start_time) + "–" + hm(cb.end_time) + " that day." };
    var after = S.shifts.map(function (x) { return Number(x.id) === Number(mine.id) ? Object.assign({}, x, { start_time: other.start_time, end_time: other.end_time }) : Number(x.id) === Number(other.id) ? Object.assign({}, x, { start_time: mine.start_time, end_time: mine.end_time }) : x; });
    var was = dayCover(f.date).gaps.map(function (g) { return g.from + g.to; }).join(), now = E.teamCover(f.date, { hours: S.hours, settings: S.rules, shifts: after, staff: S.staff, leaves: S.leaves });
    return { mine: mine, other: other, A: A, B: B, gap: now.gaps.length && now.gaps.map(function (g) { return g.from + g.to; }).join() !== was ? now.words : "" };
  }
  function swapHtml(key) {
    var f = S.form, list = swapList(f), c = f.swap.with ? swapCheck(f, list.filter(function (x) { return String(x.id) === String(f.swap.with); })[0]) : null;
    var h = '<label class="q sw"><span>Swap with</span><select name="swap_with"' + (S.saving ? " disabled" : "") + '><option value="">Choose a shift</option>' + list.map(function (x) { return '<option value="' + x.id + '"' + (String(f.swap.with) === String(x.id) ? " selected" : "") + ">" + esc(person(x.staff_id).full_name + " " + hm(x.start_time) + "–" + hm(x.end_time)) + "</option>"; }).join("") + "</select></label>";
    if (c && c.err) h += '<span class="q shf-swq bad" role="alert">' + esc(c.err) + "</span>";
    else if (c) h += '<span class="q shf-swq" role="status">' + esc(c.A.full_name) + " works " + esc(hm(c.other.start_time) + "–" + hm(c.other.end_time)) + " and " + esc(c.B.full_name) + " works " + esc(hm(c.mine.start_time) + "–" + hm(c.mine.end_time)) + "." + (c.gap ? ' <b>This leaves ' + esc(c.gap.replace(/^No/, "no")) + ".</b>" : "") + "</span>";
    h += '<button type="button" class="shf-btn" data-act="swap-no">Keep as is</button><button type="button" class="shf-btn p" data-act="swap-yes"' + (S.saving || !c || c.err ? " disabled" : "") + ">" + (S.saving ? "Swapping…" : c && c.gap ? "Swap anyway" : "Swap shifts") + "</button>";
    return h;
  }
  async function swap() {
    var f = S.form; if (S.saving || !f || !f.swap || !f.swap.with) return;
    var key = f.date, c0 = swapCheck(f, S.shifts.filter(function (x) { return String(x.id) === String(f.swap.with); })[0]); if (!c0 || c0.err) return;
    S.saving = true; f.err = ""; paint(true);
    var body = function (x, from) { return { id: x.id, staff_id: x.staff_id, shift_date: x.shift_date, start_time: hm(from.start_time), end_time: hm(from.end_time), role_override: x.role_override || "", notes: x.notes || "" }; };
    var put = async function (b) { var r = await E.apiFetch("/shifts/assignments/" + b.id, { method: "PUT", body: JSON.stringify(b) }); if (!r || !r.ok) throw new Error((r && r.error) || "Save failed"); };
    var a = null, b = null, done1 = false;
    try {
      var day = await dayList(key); // as they are now, in case another till changed them
      a = day.filter(function (x) { return Number(x.id) === Number(c0.mine.id); })[0]; b = day.filter(function (x) { return Number(x.id) === Number(c0.other.id); })[0];
      if (!a || !b) throw new Error("one of the two shifts was removed on another till");
      await put(body(a, b)); done1 = true;
      await put(body(b, a));
      S.form = null; E.toast("Shifts swapped: " + c0.A.full_name + " " + hm(b.start_time) + "–" + hm(b.end_time) + ", " + c0.B.full_name + " " + hm(a.start_time) + "–" + hm(a.end_time), "success");
    } catch (x) {
      var why = E.saveFailText(x).replace(/^Not saved/, "Not swapped");
      if (done1) { try { await put(body(a, a)); why += " " + c0.A.full_name + "’s shift is back to " + hm(a.start_time) + "–" + hm(a.end_time) + "."; } catch (y) { why = "Only half of the swap went through: " + c0.A.full_name + " now works " + hm(b.start_time) + "–" + hm(b.end_time) + " and " + c0.B.full_name + "’s shift did not change. Change one of them by hand."; } }
      f.err = why;
    }
    S.saving = false; await refreshDay(key);
    if (!S.form) refocus(f);
  }
  // Fill a gap: a new shift on that day for the gap's hours, the first free pharmacist already chosen (Add shift saves it).
  function openGap(key, g) {
    S.form = addDefaults(key); var f = S.form, who = fillers(key, g)[0];
    f.gap = g; f.start_time = g.from; f.end_time = g.to; f.staff_id = who ? String(who.id) : "";
    paint(true); focus(who ? "start_time" : "staff_id");
    var el = S.mount && S.mount.querySelector("#shf-form"); if (el && el.scrollIntoView) try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
    var sb = S.mount && S.mount.querySelector('#shf-form button[type=submit]'); if (who && sb) sb.focus(); // the next tap is Add shift
  }
  // Close the form and put focus back where it was opened from: the shift's row, or the day's "+ Add shift".
  function closeForm() {
    var f = S.form; S.form = null; paint(true); refocus(f);
  }
  function refocus(f) {
    if (!f || !S.mount) return;
    var el = (f.mode === "edit" && S.mount.querySelector('.shf-p[data-act="edit"][data-id="' + f.id + '"]')) || S.mount.querySelector('[data-act="add"][data-date="' + f.date + '"]');
    if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
  }
  function focus(n) { var now = S.mount && S.mount.querySelector("#shf-form [name=" + n + "]"); if (now) now.focus(); setTimeout(function () { var x = S.mount && S.mount.querySelector("#shf-form [name=" + n + "]"); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) x.focus(); }, 30); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#shf-form"); if (!f || !S.form) return;
    ["staff_id", "start_time", "end_time", "notes"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.form[k] = String(el.value || "").trim(); });
  }

  async function save() {
    if (S.saving || !S.form) return;
    keep();
    var f = S.form, key = f.date; f.err = "";
    if (!f.staff_id) f.err = "Choose who works this shift. Nothing was saved.";
    else if (!/^\d{2}:\d{2}$/.test(f.start_time) || !/^\d{2}:\d{2}$/.test(f.end_time)) f.err = "Choose when the shift starts and ends. Nothing was saved.";
    else if (mins(f.end_time) <= mins(f.start_time)) f.err = "The shift must end after it starts. Nothing was saved.";
    else if (f.mode === "add" && approvedOn(f.staff_id, key)) f.err = person(f.staff_id).full_name + " is on approved leave that day. Nothing was saved.";
    if (f.err) { paint(true); var bad = /Choose who|on approved leave/.test(f.err) ? "staff_id" : /end after/.test(f.err) ? "end_time" : "start_time"; var be = S.mount && S.mount.querySelector("#shf-form [name=" + bad + "]"); if (be) be.focus(); return; }
    if (isPharm(person(f.staff_id))) { // two pharmacists at once is allowed, but only after a second press (as in the classic screen)
      var ov = overlaps(key, f.start_time, f.end_time, f.mode === "edit" ? f.id : null);
      var sig = ov.length ? [f.staff_id, f.start_time, f.end_time].concat(ov.map(function (x) { return x.id; })).join("|") : "";
      if (sig && f.warnSig !== sig) { f.warnSig = sig; f.warn = "Another pharmacist is already on then: " + ov.map(function (x) { return person(x.staff_id).full_name + " " + hm(x.start_time) + "–" + hm(x.end_time); }).join(", ") + ". Press Save anyway to keep both."; return paint(true); }
      if (!sig) { f.warn = ""; f.warnSig = ""; }
    }
    S.saving = true; paint(true);
    var name = person(f.staff_id).full_name;
    try {
      if (f.mode === "add") {
        var body = { staff_id: Number(f.staff_id), shift_date: key, start_time: f.start_time, end_time: f.end_time, notes: f.notes };
        var r = await E.postOnce("/shifts/assignments", body, { list: function () { return dayList(key); },
          same: function (x) { return Number(x.staff_id) === body.staff_id && x.shift_date === key && hm(x.start_time) === body.start_time && hm(x.end_time) === body.end_time; } });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
        E.toast("Shift added for " + name, "success");
        S.last = { staff_id: body.staff_id, start_time: body.start_time, end_time: body.end_time };
      } else {
        // The server writes start, end, role and note together: read the shift as it is now and send it whole.
        var now = (await dayList(key)).filter(function (x) { return Number(x.id) === Number(f.id); })[0];
        if (!now) throw new Error("this shift was removed on another till");
        var full = { id: now.id, staff_id: now.staff_id, shift_date: now.shift_date, start_time: f.start_time, end_time: f.end_time, role_override: now.role_override || "", notes: f.notes };
        var r2 = await E.apiFetch("/shifts/assignments/" + now.id, { method: "PUT", body: JSON.stringify(full) });
        if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Save failed");
        E.toast("Shift changed for " + name, "success");
      }
      S.form = null;
    } catch (x) { f.err = E.saveFailText(x); }
    S.saving = false; await refreshDay(key);
    if (!S.form) refocus(f); // focus lands back on the day, so the next shift is one Enter away
  }
  async function remove() {
    if (S.saving || !S.form) return;
    var f = S.form, name = person(f.staff_id).full_name; f.err = "";
    S.saving = true; paint(true);
    try {
      var r = await E.apiFetch("/shifts/assignments/" + f.id, { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not removed");
      S.form = null; E.toast("Shift removed for " + name, "success");
    } catch (x) { f.err = E.saveFailText(x).replace(/^Not saved/, "Not removed"); f.confirmDel = false; }
    S.saving = false; await refreshDay(f.date);
    if (!S.form) refocus({ mode: "add", date: f.date });
  }
  // Approve: first, for whole days of leave, the person's shifts on those days (one bounded read): remove them too, or keep
  // them; then the classic cover question for a pharmacist; then the classic approve call (and a DELETE per removed shift).
  async function approveAsk(id, drop) {
    if (S.busy) return;
    var l = S.leaves.filter(function (z) { return Number(z.id) === id; })[0]; if (!l) return;
    if (drop === undefined && !l.start_time && !l.end_time) {
      S.busy = id; paint();
      var list = [];
      try { var r = await E.apiFetch("/shifts/assignments-range?from=" + l.start_date + "&to=" + (l.end_date || l.start_date) + "&staff_id=" + l.staff_id, { method: "GET" }); list = ((r && r.ok && r.shifts) || []).filter(function (x) { return Number(x.staff_id) === Number(l.staff_id) && x.shift_date >= l.start_date && x.shift_date <= (l.end_date || l.start_date); }); } catch (e) { list = []; }
      S.busy = 0;
      if (list.length) { S.ask = { id: id, kind: "shifts", shifts: list }; paint(); var k0 = S.mount.querySelector('[data-act="lv-drop-shifts"]'); if (k0) k0.focus(); return; }
      drop = [];
    }
    var c = cover(l);
    if (c && !c.alts) { S.ask = { id: id, kind: c.locum ? "locum" : "gap", drop: drop || [] }; paint(); var k1 = S.mount.querySelector('[data-act="lv-approve-yes"]'); if (k1) k1.focus(); }
    else answer(id, "approve", drop);
  }
  async function answer(id, what, drop) {
    if (S.busy) return;
    var l = S.leaves.filter(function (z) { return Number(z.id) === id; })[0], name = l ? person(l.staff_id).full_name : "";
    S.busy = id; S.lvMsg = ""; paint();
    try {
      var r = await E.apiFetch("/shifts/leaves/" + id + "/" + what, { method: "POST" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.ask = null; E.toast((what === "approve" ? "Leave approved for " : "Leave refused for ") + name, "success");
      var gone = 0;
      for (var i = 0; drop && i < drop.length; i++) { try { var d = await E.apiFetch("/shifts/assignments/" + drop[i].id, { method: "DELETE" }); if (d && d.ok) gone++; } catch (e2) {} }
      if (drop && drop.length && gone < drop.length) S.lvMsg = "Leave approved, but " + (drop.length - gone) + " of " + name + "’s shifts could not be removed. Remove them on the week.";
    } catch (x) { S.lvMsg = E.saveFailText(x); }
    S.busy = 0; return load();
  }

  // ← and → move a week, as the arrows do, whenever no shift is open and the keys are not typing somewhere.
  function onKey(ev) {
    if (E.state.activeModuleId !== "shfreg" || !S.mount || !document.body.contains(S.mount) || S.form || S.who || S.lv || S.saving || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.defaultPrevented) return;
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    var a = document.activeElement; if (a && a !== document.body && !S.mount.contains(a)) return;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    if (document.querySelector(".eikon-modal-overlay[style*='flex'], .eks")) return;
    ev.preventDefault(); S.ask = null; S.monday = plus(S.monday, ev.key === "ArrowLeft" ? -7 : 7); S.shifts = []; load();
  }
  E.registerModule({
    id: "shfreg", title: "Plan shifts", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) {
      var wk = E._shfWeek, gap = E._shfGap; E._shfWeek = null; E._shfGap = null; // from Who's in: its week, and a gap to fill
      S.mount = ctx && ctx.mount; S.monday = gap ? mondayOf(parse(gap.date)) : wk ? mondayOf(parse(wk)) : mondayOf(new Date()); S.shifts = []; S.form = null; S.ask = null; S.lvMsg = ""; S.busy = 0; S.saving = false; S.who = null; S.lv = null;
      var wantLeave = E._shfLeaveNew; E._shfLeaveNew = false; // "Ask for leave" on Who's in opens the new request
      S.loading = true; // the first paint is the skeleton (an empty rota is only offered "Who works here?" once it is known to be empty)
      css(); paint(); document.removeEventListener("keydown", onKey); document.addEventListener("keydown", onKey);
      return load().then(function () {
        if (E.state.activeModuleId !== "shfreg" || S.error) return;
        if (wantLeave && leavers().length) openLeave();
        else if (gap && dayCover(gap.date).gaps.some(function (g) { return g.from === gap.from && g.to === gap.to; })) openGap(gap.date, gap);
      });
    },
    destroy: function () { document.removeEventListener("keydown", onKey); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("shfreg") < 0) E.UI2_DESTINATIONS.push("shfreg");
  if (E.UI2_PARENT) E.UI2_PARENT.shfreg = "team";
})();
