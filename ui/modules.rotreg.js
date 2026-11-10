/* Who's in, new layout: the week's rota at a glance: who works and when, who is on leave, each day's opening hours
   (a Malta public holiday is closed unless a one-day override opens it) and any gap in pharmacist cover (E.teamCover,
   the classic coverage rule). On a wide screen the week is one table, a person to a row; on a phone, today comes first.
   Below it, hours per person for the month, read only when opened. Read only: shifts are planned, gaps filled and leave
   asked for in Plan shifts; patterns and the calendar link stay in the classic Shifts screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, monday: null, staff: {}, shifts: [], leaves: [], allLeaves: [], hours: null, rules: null, loading: false, error: "", past: false, month: null };
  var ORDER = ["pharmacist", "locum", "manager", "assistant", "dispenser", "cashier", "cleaner", "other"];
  var DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // The same words as Plan shifts, so a role reads the same on both screens ("Pharmacy assistant", not "assistant").
  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  function desig(d) { var k = String(d || "").toLowerCase().trim(); return DESIG[k] || String(d || ""); }

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function plus(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return plus(x, -((x.getDay() + 6) % 7)); }
  function leaveLabel(t) { var x = String(t || "leave").replace(/_/g, " ").trim(); x = x.charAt(0).toUpperCase() + x.slice(1); return /\s|leave/i.test(x) ? x : x + " leave"; } // annual → Annual leave
  function hm(t) { return String(t || "").slice(0, 5); }
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "")[0] || "?").toUpperCase() + ((p[1] || "")[0] || "").toUpperCase(); }
  function hue(n) { var h = 0; String(n || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }

  function css() {
    if (document.getElementById("eikon-rotreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-rotreg-css";
    st.textContent =
      ".rot{max-width:880px;margin:0 auto}" +
      ".rot-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".rot h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.rot-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".rot-nav{display:flex;align-items:center;gap:8px;margin-top:16px}.rot-nav b{flex:1;text-align:center;font-size:15px;font-weight:600}" +
      ".rot-nav button{font:inherit;font-size:20px;line-height:1;width:36px;height:36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".rot-nav .now{font-size:13px;font-weight:600;width:auto;padding:0 12px}" +
      ".rot-day{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-top:10px;overflow:hidden}.rot-day.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}" +
      ".rot-day .h{display:flex;justify-content:space-between;align-items:baseline;padding:10px 14px 6px}.rot-day .h b{font-size:15px;font-weight:700}.rot-day .h span{font-size:12.5px;color:var(--muted);text-align:right;line-height:1.4;padding-left:8px}.rot-day.today .h b{color:var(--accent)}" +
      ".rot-p{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:.5px solid var(--border)}" +
      ".rot-av{flex:0 0 30px;height:30px;border-radius:15px;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}" +
      ".rot-p .t{flex:1;min-width:0}.rot-p .t b{font-size:14.5px;font-weight:600}.rot-p .t span{display:block;font-size:12px;color:var(--muted)}.rot-p em{font-style:normal;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}" +
      ".rot-p.off .t b{color:var(--muted)}.rot-p.off em{font-weight:500;color:var(--warn,#8A5A08)}" +
      ".rot-empty{padding:22px 18px;display:flex;flex-direction:column;align-items:flex-start;gap:6px}.rot-empty b{font-size:17px}.rot-empty span{color:var(--muted);font-size:14px}" +
      ".rot-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 16px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;margin-top:8px}.rot-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".rot-day.none .h{padding:11px 14px}.rot-day.none:not(.today) .h b{font-weight:600;color:var(--muted)}" +
      ".rot-none{padding:8px 14px 12px;color:var(--muted);font-size:13.5px}" +
      ".rot-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}.rot-quiet .rot-btn{display:block;margin-top:12px}" +
      ".rot-sk{height:150px;margin-top:10px;border-radius:12px;background:rgba(118,118,128,.1)}.rot-sk+.rot-sk{height:110px}" +
      ".rot-foot{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.6}.rot-foot a{color:var(--accent)}" +
      ".rot-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;font-style:normal}" +
      ".rot-gap{display:flex;align-items:center;gap:8px;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:14px;min-height:44px;padding:8px 14px;border:0;border-top:.5px solid var(--border);background:var(--warn-soft,rgba(201,138,18,.16));color:var(--warn,#8A5A08);cursor:pointer}.rot-gap b{flex:1;min-width:0;font-weight:700}.rot-gap span{font-weight:600;white-space:nowrap;text-decoration:underline;text-underline-offset:2px}" +
      ".rot-day.today .rot-gap,.rot-grid tr.cov td.today .rot-gap{background:#FBEAE9;color:#C4221A}" + // solid, not a tint over today's tint (axe 4.4:1): 5:1, the rail badge's red
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) :is(.rot-day.today,.rot-grid tr.cov td.today) .rot-gap{background:#4A1C1A;color:#FF7A72}}" +
      ".rot-p .t .tag{font-style:normal;color:var(--warn,#8A5A08);font-weight:600}" +
      ".rot-p em .on{font-style:normal;font-size:11.5px;font-weight:700;color:var(--ok);margin-right:8px;text-transform:none}.rot-p.now{background:var(--ok-soft,rgba(28,138,91,.1))}" +
      ".rot-past{display:block;width:100%;margin-top:10px;font:inherit;font-size:14px;font-weight:600;color:var(--accent);background:var(--panel2);border:1px dashed var(--border);border-radius:12px;min-height:44px;cursor:pointer}" +
      // The week as one table on a wide screen (a person to a row); the day cards are for narrower screens.
      ".rot-grid-wrap{display:none}" +
      ".rot-grid{width:100%;border-collapse:separate;border-spacing:0;table-layout:fixed;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;font-variant-numeric:tabular-nums}" +
      ".rot-grid th,.rot-grid td{padding:8px 8px;border-top:.5px solid var(--border);vertical-align:top;text-align:left;font-size:13.5px}.rot-grid thead tr:first-child th{border-top:0}" +
      ".rot-grid thead th{font-weight:600}.rot-grid thead th b{display:block;font-size:14px;font-weight:700}.rot-grid thead th span{display:block;font-size:12px;color:var(--muted);font-weight:500}.rot-grid thead th span.hol{color:var(--text)}" +
      ".rot-grid .rot-who{width:200px}.rot-grid tbody .rot-who b{display:block;font-size:14px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.rot-grid tbody .rot-who span{display:block;font-size:12px;color:var(--muted);font-weight:400}" +
      ".rot-grid tr.cov th{font-size:12.5px;color:var(--muted);font-weight:600}.rot-grid tr.cov td{padding:6px}.rot-grid tr.cov .ok{font-size:12.5px;color:var(--ok);font-weight:600}" +
      ".rot-grid tr.cov .rot-gap{border:0;border-radius:8px;padding:6px 8px;min-height:0;flex-direction:column;align-items:flex-start;gap:2px;font-size:12.5px;line-height:1.3}.rot-grid tr.cov .rot-gap+.rot-gap{margin-top:4px}.rot-grid tr.cov .rot-gap span{font-size:12px}" +
      ".rot-grid td .t{display:block;font-weight:600;white-space:nowrap}.rot-grid td .t.now::before{content:'';display:inline-block;width:7px;height:7px;border-radius:4px;background:var(--ok);margin-right:5px;vertical-align:1px}.rot-grid td .lv,.rot-grid tr.cov .lv{display:block;font-size:12.5px;color:var(--warn,#8A5A08);font-weight:600}" +
      ".rot-grid .today{background:var(--accent-soft,rgba(31,95,216,.06))}.rot-grid thead th.today b{color:var(--accent)}.rot-grid .shut:not(.today){background:rgba(118,118,128,.07)}" +
      ".rot-month{margin-top:16px}.rot-month h2{margin:0;font-size:inherit}.rot-mh{display:flex;align-items:center;justify-content:space-between;width:100%;font:inherit;font-size:16px;font-weight:700;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:12px;min-height:48px;padding:0 14px;cursor:pointer;text-align:left}" +
      ".rot-mh .chev{width:7px;height:7px;border-right:2px solid var(--muted);border-bottom:2px solid var(--muted);transform:rotate(45deg);margin:-4px 4px 0}.rot-mh[aria-expanded=true]{border-radius:12px 12px 0 0}.rot-mh[aria-expanded=true] .chev{transform:rotate(-135deg);margin-top:4px}" +
      "#rot-month-b{background:var(--panel2);border:1px solid var(--border);border-top:0;border-radius:0 0 12px 12px;padding:4px 0 6px}.rot-msub{margin:6px 14px 8px;font-size:12.5px;color:var(--muted)}.rot-msk{height:120px;margin:10px 14px;border-radius:8px;background:rgba(118,118,128,.1)}" +
      ".rot-mt{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums}.rot-mt th,.rot-mt td{text-align:left;padding:8px 14px;border-top:.5px solid var(--border);font-size:14px;vertical-align:top}.rot-mt thead th{font-size:12.5px;color:var(--muted);font-weight:600}.rot-mt .n{text-align:right;white-space:nowrap}" +
      ".rot-mt tbody th b{display:block;font-weight:600}.rot-mt tbody th span{display:block;font-size:12px;color:var(--muted);font-weight:400}.rot-mt .m{color:var(--muted)}.rot-mt td:last-child{white-space:nowrap}.rot-mt .over{display:block;font-size:12px;color:var(--warn,#8A5A08);font-weight:600}" +
      "@media (min-width:1100px){.rot{max-width:1180px}.rot-grid-wrap{display:block;margin-top:12px}.rot-week{display:none}}" +
      "@media (max-width:600px){.rot-mt thead th:nth-child(4),.rot-mt td:nth-child(4){display:none}.rot-mt th,.rot-mt td{padding:8px 10px}}" +
      "@media (max-width:600px){.rot{padding:4px 16px 0}.rot h1{font-size:32px}.rot-nav button{width:44px;height:44px;border-radius:22px;flex:0 0 44px}.rot-nav .now{flex:0 0 auto}.rot-btn{height:44px;border-radius:22px}.rot-foot a{display:inline-block;padding:12px 0;margin:-12px 0}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var from = ymd(S.monday), to = ymd(plus(S.monday, 6)), years = [S.monday.getFullYear(), plus(S.monday, 6).getFullYear()].filter(function (y, i, a) { return a.indexOf(y) === i; });
    try {
      var rules = E.rotaRules ? E.rotaRules() : Promise.resolve({});
      var res = await Promise.all([E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }), E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to, { method: "GET" }), rules]
        .concat(years.map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }).catch(function () { return null; }); })));
      if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) throw new Error((res[1] && res[1].error) || (res[0] && res[0].error) || "Could not load the rota");
      if (from !== ymd(S.monday)) return; // the week changed while this was loading: the newer load paints
      S.staff = {}; (res[0].staff || []).forEach(function (p) { S.staff[p.id] = p; });
      S.shifts = (res[1].shifts || []).slice().sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
      S.hours = res[2] && res[2].hours; S.rules = res[2] && res[2].settings;
      S.allLeaves = [].concat.apply([], res.slice(3).map(function (r) { return (r && r.ok && r.leaves) || []; }));
      S.leaves = S.allLeaves.filter(function (l) { var st = String(l.status || "").toLowerCase(); return (st === "approved" || st === "pending") && l.end_date >= from && l.start_date <= to; }); // approved and still-asked leave; refused leave is not shown
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the rota"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function weekHas() {
    var a = ymd(S.monday), z = ymd(plus(S.monday, 6));
    return S.shifts.some(function (x) { return x.shift_date >= a && x.shift_date <= z; }) || S.leaves.some(function (l) { return l.start_date <= z && l.end_date >= a; });
  }
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function mins(t) { var p = hm(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function person(id) { return S.staff[id] || { id: id, full_name: "Staff #" + id }; }
  function dayCover(key) { return E.teamCover ? E.teamCover(key, { hours: S.hours, settings: S.rules, shifts: S.shifts, staff: S.staff, leaves: S.leaves }) : { gaps: [], words: "" }; }
  function awayOn(key) { return S.leaves.filter(function (l) { return l.start_date <= key && l.end_date >= key; }); }
  // On now: today's shift that has started and not yet ended, by Malta's clock.
  function onNow(x) { var t = E.maltaYmd ? E.maltaYmd(new Date()) : ymd(new Date()), n = E.maltaHm ? E.maltaHm(new Date()) : ""; return x.shift_date === t && n && hm(x.start_time) <= n && hm(x.end_time) > n; }
  // Hours: the classic Shifts screen's rule (shiftMinutes): end minus start, nothing when the end is not after the start.
  function shiftMins(x) { var a = mins(x.start_time), z = mins(x.end_time); return isFinite(a) && isFinite(z) && z > a ? z - a : 0; }
  function hrs(m) { var r = Math.round((m || 0) / 6) / 10; return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toFixed(1); } // the classic fmtHoursFromMinutes, without its "h"
  function gapLink(key, g) { return '<button class="rot-gap" data-act="gap" data-date="' + key + '" data-s="' + g.from + '" data-e="' + g.to + '" aria-label="No pharmacist ' + esc(g.from) + " to " + esc(g.to) + ', fill the gap in Plan shifts"><b>No pharmacist ' + esc(g.from + "–" + g.to) + '</b><span>Fill the gap</span></button>'; }

  // The week as one table: a person to a row, a day to a column; the first row says each day's hours and cover.
  function gridHtml(today) {
    var keys = [], i; for (i = 0; i < 7; i++) keys.push(ymd(plus(S.monday, i)));
    var ids = {}; S.shifts.forEach(function (x) { ids[x.staff_id] = 1; }); S.leaves.forEach(function (l) { ids[l.staff_id] = 1; });
    var rows = Object.keys(ids).map(person).sort(function (a, b) { var x = ORDER.indexOf(low(a.designation)), y = ORDER.indexOf(low(b.designation)); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || String(a.full_name).localeCompare(String(b.full_name)); });
    var cov = keys.map(dayCover);
    var h = '<div class="rot-grid-wrap"><table class="rot-grid"><caption class="rot-sr">The week from ' + esc(keys[0]) + " to " + esc(keys[6]) + ": who works when, each day's opening hours and pharmacist cover</caption><thead><tr><th scope=\"col\" class=\"rot-who\">Who</th>";
    keys.forEach(function (k, n) { var d = plus(S.monday, n), c = cov[n]; h += '<th scope="col" class="' + (k === today ? "today" : "") + (c.closed ? " shut" : "") + '"><b>' + (k === today ? "Today" : DAY[n].slice(0, 3)) + " " + d.getDate() + "</b><span>" + esc(c.closed ? (c.holiday ? "Closed · " + c.holiday : "Closed") : c.open + "–" + c.close) + "</span>" + (c.holiday && !c.closed ? '<span class="hol">' + esc(c.holiday) + "</span>" : "") + "</th>"; });
    h += '</tr><tr class="cov"><th scope="row" class="rot-who">Pharmacist</th>';
    keys.forEach(function (k, n) { var c = cov[n]; h += '<td class="' + (k === today ? "today" : "") + (c.closed ? " shut" : "") + '">' + (c.closed ? (S.shifts.some(function (x) { return x.shift_date === k; }) ? '<span class="lv">Shifts planned on a closed day</span>' : "") : c.gaps.length ? c.gaps.map(function (g) { return gapLink(k, g); }).join("") : '<span class="ok">Covered</span>') + "</td>"; });
    h += "</tr></thead><tbody>";
    rows.forEach(function (p) {
      var wk = 0; S.shifts.forEach(function (x) { if (Number(x.staff_id) === Number(p.id)) wk += shiftMins(x); });
      h += '<tr><th scope="row" class="rot-who"><b>' + esc(p.full_name) + "</b><span>" + esc(desig(p.designation)) + (wk ? " · " + hrs(wk) + " h" : "") + "</span></th>";
      keys.forEach(function (k, n) {
        var sh = S.shifts.filter(function (x) { return x.shift_date === k && Number(x.staff_id) === Number(p.id); });
        var lv = awayOn(k).filter(function (l) { return Number(l.staff_id) === Number(p.id); })[0];
        h += '<td class="' + (k === today ? "today" : "") + (cov[n].closed ? " shut" : "") + '">' + sh.map(function (x) { var now = onNow(x); return '<span class="t' + (now ? " now" : "") + '">' + esc(hm(x.start_time)) + "–" + esc(hm(x.end_time)) + (now ? '<i class="rot-sr"> (on now)</i>' : "") + "</span>"; }).join("") +
          (lv ? '<span class="lv">' + (low(lv.status) === "pending" ? "Asked for leave" : esc(leaveLabel(lv.leave_type))) + "</span>" : "") + "</td>";
      });
      h += "</tr>";
    });
    return h + "</tbody></table></div>";
  }

  // Hours per person for the month (the month of the week's Thursday), from that month's shifts: one bounded read,
  // made when the section is opened. Contracted hours are the weekly contracted hours × 52 ÷ 12; locums show hours worked.
  function monthOf() { var t = plus(S.monday, 3); return { y: t.getFullYear(), m: t.getMonth() }; }
  function wdIn(a, z) { var n = 0, d = parse(a), e = parse(z); while (d <= e) { var w = d.getDay(); if (w !== 0 && w !== 6) n++; d.setDate(d.getDate() + 1); } return n; } // the classic weekday count
  function parse(s) { var p = String(s || "").split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  async function loadMonth() {
    var mo = monthOf(), key = mo.y + "-" + pad(mo.m + 1), from = key + "-01", to = ymd(new Date(mo.y, mo.m + 1, 0));
    if (S.month && S.month.key === key && (S.month.rows || S.month.busy)) return;
    S.month = { key: key, open: true, busy: true, rows: null, err: "" }; paint();
    try {
      var r = await E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to, { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the month");
      if (!S.month || S.month.key !== key) return;
      var per = {};
      (r.shifts || []).forEach(function (x) { var q = per[x.staff_id] || (per[x.staff_id] = { id: x.staff_id, mins: 0, shifts: 0, days: 0, lvh: 0 }); q.mins += shiftMins(x); q.shifts++; });
      S.allLeaves.forEach(function (l) {
        if (low(l.status) !== "approved" || l.end_date < from || l.start_date > to) return;
        var q = per[l.staff_id] || (per[l.staff_id] = { id: l.staff_id, mins: 0, shifts: 0, days: 0, lvh: 0 });
        if (l.start_time && l.end_time) q.lvh += Number(l.hours_requested) || 0; else q.days += wdIn(l.start_date < from ? from : l.start_date, l.end_date > to ? to : l.end_date);
      });
      Object.keys(S.staff).forEach(function (k) { var p = S.staff[k]; if (Number(p.is_active) !== 0 && !per[k]) per[k] = { id: p.id, mins: 0, shifts: 0, days: 0, lvh: 0 }; });
      S.month.rows = Object.keys(per).map(function (k) { return per[k]; }).sort(function (a, b) { var x = person(a.id), y = person(b.id), i = ORDER.indexOf(low(x.designation)), j = ORDER.indexOf(low(y.designation)); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || String(x.full_name).localeCompare(String(y.full_name)); });
    } catch (e) { if (S.month && S.month.key === key) S.month.err = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && e.message) || e); }
    if (S.month && S.month.key === key) S.month.busy = false;
    E.whenFormIdle(S.mount, paint);
  }
  function monthHtml() {
    var mo = monthOf(), full = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][mo.m];
    var key = mo.y + "-" + pad(mo.m + 1), M = S.month && S.month.key === key ? S.month : null, open = !!(M && M.open);
    var h = '<section class="rot-month"><h2><button class="rot-mh" data-act="month" aria-expanded="' + open + '" aria-controls="rot-month-b"><span>Hours in ' + esc(full) + "</span><span class=\"chev\" aria-hidden=\"true\"></span></button></h2>";
    if (!open) return h + "</section>";
    h += '<div id="rot-month-b">';
    if (M.busy) h += '<div class="rot-msk" role="status" aria-label="Adding up the hours"></div>';
    else if (M.err) h += '<div class="rot-quiet" role="alert">' + esc(M.err) + '<button class="rot-btn" data-act="month-retry">Try again</button></div>';
    else if (!M.rows.length) h += '<p class="rot-none">No one on the rota.</p>';
    else {
      h += '<p class="rot-msub">Planned on the rota for the whole month. Contracted: the weekly hours × 52 ÷ 12.</p><table class="rot-mt"><thead><tr><th scope="col">Who</th><th scope="col" class="n">Shifts</th><th scope="col" class="n">Hours</th><th scope="col" class="n">Contracted</th><th scope="col">Leave</th></tr></thead><tbody>';
      M.rows.forEach(function (q) {
        var p = person(q.id), loc = low(p.designation) === "locum" || low(p.employment_type) === "external", con = Number(p.contracted_hours) || 0, cm = Math.round(con * 52 / 12);
        var lv = [q.days ? q.days + (q.days === 1 ? " day" : " days") : "", q.lvh ? hrs(q.lvh * 60) + " h" : ""].filter(Boolean).join(", ");
        var over = !loc && cm && q.mins / 60 > cm;
        h += '<tr><th scope="row"><b>' + esc(p.full_name) + "</b><span>" + esc(desig(p.designation)) + "</span></th><td class=\"n\">" + q.shifts + '</td><td class="n"><b>' + hrs(q.mins) + " h</b>" + (over ? '<span class="over">Over contract</span>' : "") + '</td><td class="n">' + (loc ? "Locum" : cm ? cm + " h" : "–") + "</td><td>" + (lv ? esc(lv) : '<span class="m">None</span>') + "</td></tr>";
      });
      h += "</tbody></table>";
    }
    return h + "</div></section>";
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "rotreg") return; // left before a reply came back: do not draw over the next screen
    var ae = document.activeElement, keepAct = ae && m.contains(ae) ? ae.getAttribute("data-act") : null; // the week arrows keep focus across the redraw
    var sun = plus(S.monday, 6), thisWeek = ymd(mondayOf(new Date())) === ymd(S.monday);
    var label = S.monday.getDate() + " " + MON[S.monday.getMonth()] + " – " + sun.getDate() + " " + MON[sun.getMonth()];
    var h = '<div class="rot"><button class="rot-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("rotreg") : "‹ Team") + '</button><h1>Who\'s in</h1><p class="rot-sub">The week\'s rota: who works, when, and who is away.</p>' +
      '<div class="rot-nav"><button data-act="prev" aria-label="Previous week" title="Previous week (←)">‹</button><b>' + esc(label) + "</b>" + (thisWeek ? "" : '<button class="now" data-act="now">This week</button>') + '<button data-act="next" aria-label="Next week" title="Next week (→)">›</button></div>';
    if (S.loading && !S.shifts.length) h += '<div role="status" aria-label="Opening the rota"><div class="rot-sk"></div><div class="rot-sk"></div></div>'; // the shape of the week, not a spinner
    else if (S.error) h += '<div class="rot-quiet" role="alert">' + esc(S.error) + '<button class="rot-btn" data-act="retry">Try again</button></div>';
    else if (!weekHas()) {
      // An empty week reads as one quiet card, not seven "No one on the rota" boxes.
      h += '<div class="rot-day rot-empty"><b>Nothing planned this week</b><span>No shifts and no leave from ' + esc(label.replace(" – ", " to ")) + '.</span>' +
        '<button class="rot-btn p" data-act="plan">Plan shifts</button></div>';
    }
    else {
      var today = ymd(new Date()), ti = thisWeek ? (new Date().getDay() + 6) % 7 : 0;
      h += gridHtml(today);
      // Phone and narrow screens: day by day, today first (the days already gone this week one tap away).
      h += '<div class="rot-week">';
      if (ti > 0) h += '<button class="rot-past" data-act="past" aria-expanded="' + S.past + '">' + (S.past ? "Hide " : "Show ") + (ti === 1 ? "Monday" : "Monday to " + DAY[ti - 1]) + "</button>";
      for (var i = 0; i < 7; i++) {
        if (i < ti && !S.past) continue;
        var d = plus(S.monday, i), key = ymd(d), c = dayCover(key);
        var day = S.shifts.filter(function (x) { return x.shift_date === key; });
        var away = awayOn(key);
        var empty = !day.length && !away.length; // a day with nobody is one slim line, so the working days stand out
        h += '<div class="rot-day' + (key === today ? " today" : "") + (empty ? " none" : "") + (c.gaps && c.gaps.length ? " gap" : "") + '"><div class="h"><b>' + (key === today ? "Today" : DAY[i]) + "</b><span>" + d.getDate() + " " + MON[d.getMonth()] + (c.words ? " · " + esc(c.closed ? c.words : c.open + "–" + c.close + (c.holiday ? " · Public holiday (" + c.holiday + ")" : "")) : "") + (day.length ? " · " + day.length + (day.length === 1 ? " shift" : " shifts") : "") + (empty && !c.closed ? " · Nobody on" : "") + "</span></div>";
        var gapRows = (c.gaps || []).map(function (g) { return { at: g.from, h: gapLink(key, g) }; }), gq = gapRows.slice(), out = [];
        day.forEach(function (x) {
          while (gq.length && gq[0].at <= hm(x.start_time)) out.push(gq.shift().h);
          var p = person(x.staff_id), now = onNow(x), asked = S.leaves.some(function (l) { return low(l.status) === "pending" && Number(l.staff_id) === Number(x.staff_id) && l.start_date <= key && l.end_date >= key; });
          out.push('<div class="rot-p' + (now ? " now" : "") + '"><span class="rot-av" style="background:hsl(' + hue(p.full_name) + ',45%,32%)">' + esc(initials(p.full_name)) + '</span><div class="t"><b>' + esc(p.full_name) + "</b><span>" + (asked ? '<i class="tag">Asked for leave this day</i> · ' : "") + esc(desig(x.role_override || p.designation || "")) + (x.notes ? " · " + esc(x.notes) : "") + "</span></div><em>" + (now ? '<i class="on">On now</i>' : "") + esc(hm(x.start_time)) + "–" + esc(hm(x.end_time)) + "</em></div>");
        });
        h += out.concat(gq.map(function (r) { return r.h; })).join("");
        h += away.map(function (l) {
          var p = person(l.staff_id);
          return '<div class="rot-p off"><span class="rot-av" style="background:hsl(' + hue(p.full_name) + ',20%,40%)">' + esc(initials(p.full_name)) + '</span><div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(leaveLabel(l.leave_type)) + "</span></div><em>" + (String(l.status).toLowerCase() === "pending" ? "Asked for leave" : "Away") + (l.start_time && l.start_date === key ? " from " + esc(hm(l.start_time)) : "") + "</em></div>";
        }).join("");
        h += "</div>";
      }
      h += "</div>";
      h += monthHtml();
    }
    h += '<p class="rot-foot">Plan the week in <a href="#" data-act="plan">Plan shifts</a>, or <a href="#" data-act="leave">ask for leave</a>. Patterns and the calendar link are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    m.innerHTML = h;
    if (keepAct) { var back = m.querySelector('[data-act="' + keepAct + '"]') || (keepAct === "now" ? m.querySelector('[data-act="next"]') : null); if (back) back.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("rotreg") : "#team";
        else if (a === "retry") load();
        else if (a === "prev") { S.monday = plus(S.monday, -7); S.shifts = []; load(); }
        else if (a === "next") { S.monday = plus(S.monday, 7); S.shifts = []; load(); }
        else if (a === "now") { S.monday = mondayOf(new Date()); S.shifts = []; load(); }
        else if (a === "past") { S.past = !S.past; paint(); }
        else if (a === "month") { if (S.month && S.month.key === monthOf().y + "-" + pad(monthOf().m + 1) && S.month.open) { S.month.open = false; paint(); } else if (S.month && S.month.rows && S.month.key === monthOf().y + "-" + pad(monthOf().m + 1)) { S.month.open = true; paint(); } else loadMonth(); }
        else if (a === "month-retry") { S.month = null; loadMonth(); }
        else if (a === "gap") { E._shfWeek = ymd(S.monday); E._shfGap = { date: b.getAttribute("data-date"), from: b.getAttribute("data-s"), to: b.getAttribute("data-e") }; location.hash = "#shfreg"; } // Plan shifts opens on that day with the gap's shift ready
        else if (a === "plan") { ev.preventDefault(); E._shfWeek = ymd(S.monday); location.hash = "#shfreg"; }
        else if (a === "leave") { ev.preventDefault(); E._shfLeaveNew = true; location.hash = "#shfreg"; } // Plan shifts opens with a new leave request
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "rotreg"); } catch (x) {} E.openClassic("shifts"); }
      });
    });
  }

  // ← and → move a week, as the arrows do, whenever the keys are not typing somewhere.
  function onKey(ev) {
    if (E.state.activeModuleId !== "rotreg" || !S.mount || !document.body.contains(S.mount) || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.defaultPrevented) return;
    if (ev.key !== "ArrowLeft" && ev.key !== "ArrowRight") return;
    var a = document.activeElement; if (a && a !== document.body && !S.mount.contains(a)) return;
    if (a && /^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName)) return;
    if (document.querySelector(".eikon-modal-overlay[style*='flex'], .eks")) return;
    ev.preventDefault(); S.monday = plus(S.monday, ev.key === "ArrowLeft" ? -7 : 7); S.shifts = []; load();
  }
  E.registerModule({
    id: "rotreg", title: "Who's in", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) { var wk = E._rotWeek; E._rotWeek = null; S.mount = ctx && ctx.mount; S.monday = wk ? mondayOf(parse(wk)) : mondayOf(new Date()); S.month = null; S.past = false; S.shifts = []; css(); paint(); document.removeEventListener("keydown", onKey); document.addEventListener("keydown", onKey); return load(); },
    destroy: function () { document.removeEventListener("keydown", onKey); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("rotreg") < 0) E.UI2_DESTINATIONS.push("rotreg");
  if (E.UI2_PARENT) E.UI2_PARENT.rotreg = "team";
})();
