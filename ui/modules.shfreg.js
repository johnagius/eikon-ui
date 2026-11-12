/* Plan shifts, the roster planner (new layout): who works when, for a week or a month.
   Desktop (1100 px and wider): a grid, people down the side and days across; the first row is each day's hours and
   pharmacist cover. Click a cell to add or change a shift; drag across cells (or Shift-click, Ctrl-click, the tick
   boxes, or the keyboard) to select many, then set their hours, copy, paste or clear them from the bar at the bottom.
   Narrower: the week day by day (today's cards), a month calendar, and a Select button with tick boxes.
   One "Fill…" button offers every way to fill a range of dates: the same days every week (every week, every other week,
   every Nth), a rotation of 1–4 weeks, days picked on the grid, copy or repeat a day, week or month, fill the gaps, same
   as last week and everyone's usual pattern; for one person, several, or everyone with a role. Every fill shows what it
   will do first (adds / keeps / removes / skips and why), keeps existing shifts unless Replace is chosen, and can be
   undone in one tap. Every expansion, preview word, write, verify/put-back, Undo and Recent change is E.rotaPlan's
   (eikon.rotaplan.js: one-step POST /shifts/apply-plan, else apply-pattern); this screen gathers the answers, reads the
   rows once and shows the preview. Rules come from E.rotaCheck; opening hours, rules, a person's leave, availability and
   details from E.rotaSet; print and the calendar link from E.rotaPrint / E.rotaCal.
   The day-level writes are the classic Shifts screen's, with its bodies: + Add shift POST /shifts/assignments
   {staff_id, shift_date, start_time, end_time, notes}; a change PUT /shifts/assignments/:id with the whole record (so a
   role set elsewhere is kept; "Works as" sets role_override the same way); Remove DELETE; Move = Add there, then Remove
   (the swap's machinery); leave POST /shifts/leaves and approve/reject; a person or a new locum POST /shifts/staff.
   Rights (roles round): GET /shifts/staff says can_plan and me_staff_id. Without the rota right a person sees the whole
   rota and asks for leave (Who = them); nothing that writes a shift, a fill, a rota person or the rules is offered, and
   the worker refuses it too. Nobody but an admin is offered Approve/Refuse on their own leave. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { msg: "", mount: null, monday: null, month: null, view: "week", role: "", staff: {}, shifts: [], leaves: [], hours: null, rules: null, loading: false, error: "", leaveErr: "", form: null, saving: false, ask: null, busy: 0, lvMsg: "", last: null, who: null, lv: null, lvYears: [],
    sel: {}, selShown: {}, anchor: null, cur: null, clip: null, drag: null, pick: false, pickWho: "", dlg: null, undo: null, recent: [], menu: false, wide: null, loadSig: "" };
  var DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  // The classic Leave tab's leave types, in its order, in the words used on this screen ("Annual leave").
  var LTYPES = [["annual", "Annual leave"], ["sick", "Sick leave"], ["urgent_family", "Urgent family leave (force majeure)"], ["maternity", "Maternity leave"], ["paternity", "Paternity leave"], ["parental", "Parental leave"], ["miscarriage", "Miscarriage leave"], ["other", "Other"]];
  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  var ORDER = ["pharmacist", "locum", "manager", "assistant", "dispenser", "cashier", "cleaner", "other"]; // Who's in's order
  var ROLES = [["", "Everyone"], ["pharm", "Pharmacists and locums"], ["pharmacist", "Pharmacists"], ["locum", "Locum pharmacists"], ["assistant", "Pharmacy assistants"], ["dispenser", "Dispensers"], ["cashier", "Cashiers"], ["manager", "Managers"], ["cleaner", "Cleaners"], ["other", "Other"]];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function plus(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return plus(x, -((x.getDay() + 6) % 7)); }
  function parse(s) { var p = String(s || "").split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])); }
  function addDays(k, n) { return ymd(plus(parse(k), n)); }
  function daysBetween(a, b) { return Math.round((Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10)) - Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))) / 864e5); }
  function short(s) { var d = parse(s); return d.getDate() + " " + MON[d.getMonth()]; }
  function hm(t) { return String(t || "").slice(0, 5); }
  function mins(t) { var p = hm(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function tm(m) { return pad(Math.floor(m / 60)) + ":" + pad(m % 60); }
  function compact(t) { var m = mins(t); return String(Math.floor(m / 60)) + (m % 60 ? ":" + pad(m % 60) : ""); } // "8", "13:30"
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function dow(k) { return (parse(k).getDay() + 6) % 7; } // 0 Monday … 6 Sunday
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "")[0] || "?").toUpperCase() + ((p[1] || "")[0] || "").toUpperCase(); }
  function hue(n) { var h = 0; String(n || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function av(name, grey) { return '<span class="shf-av" aria-hidden="true" style="background:hsl(' + hue(name) + "," + (grey ? "20%,40%" : "45%,32%") + ')">' + esc(initials(name)) + "</span>"; }
  function person(id) { return S.staff[id] || { id: id, full_name: "Staff #" + id }; }
  function desig(p) { var d = low(p && p.designation); return DESIG[d] || (p && p.designation) || ""; }
  function isPharm(p) { var d = low(p && p.designation); return d === "pharmacist" || d === "locum"; }
  function first(p) { var w = String(p.full_name || "").trim().split(/\s+/); while (w.length > 1 && /^(dr|pharm|mr|mrs|ms|miss|fr|prof|sr)\.?$/i.test(w[0])) w.shift(); return w[0]; } // "Dr Ħelena Ellul" → Ħelena (Visual S10)
  function active() { return Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return Number(p.is_active) !== 0; }).sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); }); }
  function byOrder(a, b) { var x = ORDER.indexOf(low(a.designation)), y = ORDER.indexOf(low(b.designation)); return (x < 0 ? 99 : x) - (y < 0 ? 99 : y) || String(a.full_name).localeCompare(String(b.full_name)); }
  function roleOk(p, r) { r = r == null ? S.role : r; if (!r) return true; var d = low(p.designation); return r === "pharm" ? d === "pharmacist" || d === "locum" : d === r; }
  function leaveLabel(t) { var x = String(t || "leave").replace(/_/g, " ").trim(); x = x.charAt(0).toUpperCase() + x.slice(1); return /\s|leave/i.test(x) ? x : x + " leave"; }
  // ---- rights (roles round): the server's answer on GET /shifts/staff; an older server sends none: as today ----
  function canPlan() { return S.canPlan !== false; }
  function meId() { if (S.meId != null) return Number(S.meId); var me = E.rotaMe ? E.rotaMe(active()) : null; return me ? Number(me.id) : null; }
  function isAdminU() { var u = E.state.user; return !!(u && u.role === "admin"); }
  function canAnswer(l) { return canPlan() && (isAdminU() || meId() == null || Number(l.staff_id) !== meId()); }
  var RO_WORDS = "Only the pharmacy's admin changes shifts. To be away, ask for leave.";
  function roMsg() { S.msg = RO_WORDS; paint(true); var mb = S.mount && S.mount.querySelector(".shf-msg"); if (mb) mb.focus(); }
  // What a person without the rota right is not offered (the worker refuses each of these for them).
  var RO_ACTS = { add: 1, edit: 1, del: 1, "del-yes": 1, swap: 1, "swap-yes": 1, move: 1, "mv-yes": 1, "fill-open": 1, fill: 1, pick: 1, pickrow: 1, "sel-hours": 1, "sel-usual": 1, "sel-copy": 1, "sel-paste": 1, "sel-clear": 1,
    who: 1, "who-done": 1, "who-acc": 1, undo: 1, "m-rules": 1, "lv-approve": 1, "lv-keep-shifts": 1, "lv-drop-shifts": 1, "lv-trim": 1, "lv-approve-yes": 1, "lv-refuse": 1, "lv-refuse-yes": 1 };
  function roPrune(m) {
    if (canPlan()) return;
    m.querySelectorAll('[data-act="fill-open"],[data-act="pick"],[data-act="who"],[data-act="add"],[data-act="fill"],[data-act="m-rules"],[data-act="sel-hours"],#shf-barhost').forEach(function (el) { el.remove(); });
    m.querySelectorAll(".shf-grid .shf-p[draggable]").forEach(function (el) { el.removeAttribute("draggable"); });
  }
  function approvedOn(staffId, key) { return S.leaves.filter(function (l) { return low(l.status) === "approved" && Number(l.staff_id) === Number(staffId) && l.start_date <= key && l.end_date >= key; })[0] || null; }
  function pendingOn(staffId, key) { return S.leaves.filter(function (l) { return low(l.status) === "pending" && Number(l.staff_id) === Number(staffId) && l.start_date <= key && l.end_date >= key; })[0] || null; }
  function truthy(v) { return v === true || v === 1 || v === "1" || v === "true"; }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : many || one + "s"); }
  function dayWords(key) { var d = parse(key); return DAY[(d.getDay() + 6) % 7].slice(0, 3) + " " + short(key); } // "Tue 19 Nov"
  function longDay(key) { var d = parse(key); return DAY[(d.getDay() + 6) % 7] + " " + d.getDate() + " " + MON[d.getMonth()]; }
  function store(k, v) { try { if (v == null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) {} }
  function stored(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function locKey() { return (E.state && E.state.user && E.state.user.location_id) || "x"; }
  // A day's opening hours and pharmacist cover: the one shared rule (E.teamCover in core.js: a one-day override, a Malta
  // public holiday closed unless an override opens it, the weekly hours; the classic coverage check for the gaps).
  function dayCover(key, shifts) { return E.teamCover(key, { hours: S.hours, settings: S.rules, shifts: shifts || S.shifts, staff: S.staff, leaves: S.leaves }); }
  function hoursFor(key) { return dayCover(key); }
  // Who can cover a gap: pharmacists and locums on the team, not on approved leave that day and not already on then.
  // Those with no shift that day come first, then locums.
  function fillers(key, g, shifts) {
    var a = mins(g.from), z = mins(g.to), L = shifts || S.shifts;
    return active().filter(function (p) {
      if (!isPharm(p) || approvedOn(p.id, key)) return false;
      return !L.some(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(p.id) && mins(x.start_time) < z && mins(x.end_time) > a; });
    }).map(function (p) { return { p: p, k: (L.some(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(p.id); }) ? 2 : 0) + (low(p.designation) === "locum" ? 1 : 0) }; })
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

  // ---- the range on screen: a week (Monday to Sunday) or a month ----
  function rStart() { return S.view === "month" ? new Date(S.month.getFullYear(), S.month.getMonth(), 1) : S.monday; }
  function rLen() { return S.view === "month" ? new Date(S.month.getFullYear(), S.month.getMonth() + 1, 0).getDate() : 7; }
  function keys() { var a = [], s = rStart(), n = rLen(); for (var i = 0; i < n; i++) a.push(ymd(plus(s, i))); return a; }
  function rangeSig() { return S.view + ymd(rStart()); }
  function wide() { return !!(window.matchMedia && window.matchMedia("(min-width:1100px)").matches); }
  function rangeWord() { return S.view === "month" ? "this month" : "this week"; }
  function sortShifts(l) { return l.slice().sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)) || Number(a.id) - Number(b.id); }); }
  function shiftsOf(sid, key) { return S.shifts.filter(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(sid); }); }
  function shiftMins(x) { var d = mins(x.end_time) - mins(x.start_time); return d > 0 ? d : 0; }
  function hrs(m) { var h = Math.round(m / 6) / 10; return Number.isInteger(h) ? String(h) : h.toFixed(1); }
  // People on the grid, Who's in's order: everyone active, plus anyone inactive who still has a shift on screen.
  function rows() {
    var ks = keys(), lo = ks[0], hi = ks[ks.length - 1], ids = {};
    S.shifts.forEach(function (x) { if (x.shift_date >= lo && x.shift_date <= hi) ids[x.staff_id] = 1; });
    return Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return (Number(p.is_active) !== 0 || ids[p.id]) && roleOk(p); }).sort(byOrder);
  }

  function css() {
    if (document.getElementById("eikon-shfreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-shfreg-css";
    st.textContent =
      ".shf{max-width:880px;margin:0 auto}" +
      ".shf-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".shf h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.shf-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".shf-nav{display:flex;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap}.shf-nav b{flex:1;min-width:0;text-align:center;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".shf-nav button.ar{font:inherit;font-size:20px;line-height:1;width:36px;height:36px;flex:0 0 36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".shf-nav .now{font:inherit;font-size:13px;font-weight:600;height:36px;padding:0 12px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".shf-seg{display:inline-flex;border:1px solid var(--border);border-radius:18px;overflow:hidden;flex:0 0 auto}.shf-seg button{font:inherit;font-size:13.5px;font-weight:600;height:34px;padding:0 14px;border:0;background:var(--panel2);color:var(--text);cursor:pointer}.shf-seg button[aria-pressed=true]{background:var(--accent);color:#fff}" +
      ".shf-tools{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:12px}.shf-tools .sp{flex:1}.shf-tools select{font:inherit;font-size:14px;height:36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);padding:0 10px}" +
      ".shf-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.shf-lab b{color:var(--text)}" +
      ".shf-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".shf-day{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-top:10px;overflow:hidden}.shf-day.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}" +
      ".shf-day .h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:10px 14px 6px}.shf-day .h b{font-size:15px;font-weight:700}.shf-day .h span{font-size:12.5px;color:var(--muted);min-width:0;text-align:right;line-height:1.4}.shf-day.today .h b{color:var(--accent)}" +
      ".shf-day .h label.tk{display:flex;align-items:center;gap:8px;min-height:44px;margin:-10px 0 -6px}.shf-day .h label.tk input{width:22px;height:22px}" +
      ".shf-p{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:.5px solid var(--border);width:100%;box-sizing:border-box;text-align:left;font:inherit;color:var(--text);background:none;border-left:0;border-right:0;border-bottom:0}" +
      "button.shf-p{cursor:pointer;min-height:48px}button.shf-p:hover{background:rgba(118,118,128,.08)}.shf-p.picked{background:rgba(10,132,255,.14)}" +
      ".shf-av{flex:0 0 30px;height:30px;border-radius:15px;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}" +
      ".shf-p .t{flex:1;min-width:0}.shf-p .t b{display:block;font-size:14.5px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.shf-p .t span{display:block;font-size:12px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".shf-p em{font-style:normal;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600;white-space:nowrap}" +
      ".shf-p .chev{flex:0 0 8px;width:7px;height:7px;border-right:2px solid var(--muted);border-top:2px solid var(--muted);transform:rotate(45deg);opacity:.6;margin-left:2px}" +
      ".shf-p .t span.tag{display:inline}.shf-p.off .t b{color:var(--muted)}.shf-p.off em{font-weight:500;color:var(--warn,#8A5A08)}.shf-p .tag{color:var(--warn,#8A5A08);font-weight:600}" +
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
      ".shf-err{color:var(--danger);font-size:13.5px;padding:8px 14px 0}.shf-warn.shf-msg{margin:10px 0 0}" +
      ".shf-warn{font-size:13.5px;margin:8px 14px 0;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.14);line-height:1.4}" +
      ".shf-lv{padding:10px 14px;border-top:.5px solid var(--border)}.shf-lv:first-child{border-top:0}.shf-lv .top{display:flex;align-items:center;gap:10px}" +
      ".shf-lv .t{flex:1;min-width:0}.shf-lv .t b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shf-lv .t span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".shf-lv .why{font-size:13.5px;margin:6px 0 0 40px}.shf-lv .cov{font-size:12.5px;margin:4px 0 0 40px;color:var(--muted)}.shf-lv .cov.bad{color:var(--danger);font-weight:600}" +
      ".shf-lv .acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:8px}.shf-lv .acts .q{flex:1 1 100%;font-size:14px}" +
      ".shf-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".shf-note{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.6}.shf-note a{color:var(--accent)}.shf-quiet .shf-btn{display:block;margin-top:12px}" +
      ".shf-acc{display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:0 14px 10px;font-size:13.5px;color:var(--muted)}.shf-acc span{width:100%}.shf-chip{font:inherit;font-size:14px;font-weight:600;min-height:36px;padding:0 12px;border-radius:18px;border:1px solid var(--border);background:var(--bg);color:var(--text);cursor:pointer}.shf-chip[aria-pressed=true]{border-color:var(--accent);color:var(--accent)}.shf-sub .shf-mine{color:var(--accent);font-weight:600;white-space:nowrap}@media (max-width:600px){.shf-chip{min-height:44px}}.shf-who{margin-top:14px}.shf-who h2{font-size:17px;font-weight:700;margin:0;padding:12px 14px 2px}.shf-who p{margin:0;padding:0 14px 8px;font-size:13.5px;color:var(--muted)}.shf-who .ok{color:var(--ok);font-weight:600}" +
      ".shf-form .two{display:flex;gap:8px;flex:1;min-width:0;align-items:center}.shf-form .two input{flex:1}.shf-form .two i{font-style:normal;color:var(--muted)}" +
      ".shf-form .hint{font-size:12.5px;color:var(--muted);padding:0 14px 8px 98px;margin-top:-6px}.shf-form [aria-invalid=true]{box-shadow:inset 0 -2px 0 var(--danger)}" +
      ".shf-gap{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;font:inherit;font-size:14.5px;min-height:48px;padding:8px 14px;border:0;border-top:.5px solid var(--border);background:var(--warn-soft,rgba(201,138,18,.16));color:var(--text);cursor:pointer}" +
      ".shf-gap b{flex:1;min-width:0;color:var(--warn,#8A5A08);font-weight:700}.shf-gap span:not(.chev){font-weight:600;color:var(--warn,#8A5A08);white-space:nowrap}.shf-gap .chev{flex:0 0 8px;width:7px;height:7px;border-right:2px solid var(--warn,#8A5A08);border-top:2px solid var(--warn,#8A5A08);transform:rotate(45deg)}" +
      ".shf-day.today .shf-gap{background:var(--danger-soft,rgba(191,59,46,.12))}.shf-day.today .shf-gap b,.shf-day.today .shf-gap span:not(.chev){color:var(--danger)}.shf-day.today .shf-gap .chev{border-color:var(--danger)}.shf-fillh{padding:10px 14px 2px;font-size:14px;font-weight:600;color:var(--warn,#8A5A08)}" +
      ".shf-hol{border-top:.5px solid var(--border);padding:10px 14px;font-size:13.5px;background:rgba(201,138,18,.12)}.shf-day.shut:not(.today) .h b{color:var(--muted)}" +
      ".shf-sk{height:150px;margin-top:10px;border-radius:12px;background:rgba(118,118,128,.1)}.shf-sk+.shf-sk{height:110px}" +
      // the grid (desktop)
      ".shf.wide{max-width:1480px}.shf-gw{margin-top:12px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);overflow:auto;max-height:calc(100vh - 210px)}" +
      ".shf-grid{border-collapse:separate;border-spacing:0;width:100%;table-layout:fixed;font-size:13.5px;user-select:none;-webkit-user-select:none}" +
      ".shf-grid th,.shf-grid td{border-bottom:.5px solid var(--border);border-right:.5px solid var(--border);padding:0;vertical-align:top;text-align:left}" +
      ".shf-grid thead th{position:sticky;top:0;z-index:2;background:var(--panel2)}.shf-grid thead tr.shf-cov>*{top:52px}.shf-grid thead tr.shf-cov th{z-index:3}" +
      ".shf-grid th.shf-ph,.shf-grid th.shf-corner,.shf-grid tr.shf-cov th{position:sticky;left:0;z-index:1;background:var(--panel2);width:240px}.shf-grid thead th.shf-corner{z-index:4}" +
      ".shf-grid.m th.shf-ph,.shf-grid.m th.shf-corner,.shf-grid.m tr.shf-cov th{width:150px}" +
      ".shf-grid th.shf-dh{border-radius:0;margin:0;box-shadow:none;border-top:0;border-left:0;border-color:var(--border);overflow:visible}.shf-dh{height:52px}.shf-dh .in{display:flex;align-items:center;gap:6px;padding:6px 8px;height:100%;box-sizing:border-box}.shf-dh .dn{flex:1;min-width:0;line-height:1.2}.shf-dh .dn span{display:block;font-size:11.5px;color:var(--muted);font-weight:600}.shf-dh .dn b{font-size:15px}" +
      ".shf-dh.today .dn b,.shf-dh.today .dn span{color:var(--accent)}.shf-dh.we,.shf-c.we{background-image:linear-gradient(rgba(118,118,128,.07),rgba(118,118,128,.07))}" +
      ".shf-dh .shf-add{width:28px;height:28px;min-height:0;padding:0;border:1px solid var(--border);border-radius:14px;text-align:center;font-size:17px;line-height:1;flex:0 0 28px}" +
      ".shf-grid input[type=checkbox]{width:18px;height:18px;margin:0;flex:0 0 18px;accent-color:var(--accent)}" +
      ".shf-grid.m .shf-dh .in{flex-direction:column;align-items:center;gap:2px;padding:4px 0}.shf-grid.m .shf-dh .dn{text-align:center}.shf-grid.m .shf-dh .dn b{font-size:13px}.shf-grid.m .shf-dh .shf-add{display:none}" +
      ".shf-cov td{padding:4px 6px;font-size:12px;color:var(--muted);min-height:30px}.shf-cov td.shut{color:var(--muted);font-style:italic}.shf-cov td .ok{color:var(--ok,#1F7A3A);font-weight:600}" +
      ".shf-grid .shf-gap{min-height:0;padding:3px 6px;margin-top:3px;border-radius:6px;border:0;font-size:12px;gap:4px;display:block}.shf-grid .shf-gap b{display:block;font-weight:700}.shf-grid .shf-gap span{font-size:11.5px}.shf-grid .shf-gap .chev{display:none}" +
      ".shf-grid.m .shf-cov td{padding:4px 0;text-align:center}.shf-grid.m .shf-gap{width:24px;height:24px;margin:0 auto;padding:0;border-radius:12px;background:transparent;position:relative}.shf-grid.m .shf-gap::after{content:'';position:absolute;left:7px;top:7px;width:10px;height:10px;border-radius:5px;background:var(--danger)}.shf-grid.m .shf-gap b,.shf-grid.m .shf-gap span{display:none}" +
      ".shf-hrs{font:inherit;font-size:12px;color:inherit;background:none;border:0;padding:2px 0;cursor:pointer;text-decoration:underline dotted;text-underline-offset:3px;text-align:left}.shf-hrs:hover{color:var(--accent)}" +
      ".shf-dot{display:inline-block;width:8px;height:8px;border-radius:4px;background:var(--ok,#1F7A3A)}.shf-dot.shut{background:transparent;border:1px solid var(--muted)}" +
      ".shf-ph .in{display:flex;align-items:center;gap:8px;padding:6px 8px;min-height:44px;box-sizing:border-box}.shf-ph .nm{flex:1;min-width:0;text-align:left;font:inherit;border:0;background:none;color:var(--text);padding:0;cursor:pointer}" +
      ".shf-ph .nm b{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;font-weight:600;font-size:13.5px;line-height:1.25;overflow:hidden;overflow-wrap:anywhere}.shf-ph .nm span{display:block;font-size:11.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-variant-numeric:tabular-nums}.shf-ph .nm span.over{color:var(--danger);font-weight:600}" +
      ".shf-ph em{font-style:normal;font-size:12px;font-variant-numeric:tabular-nums;color:var(--muted);white-space:nowrap}.shf-ph em.over{color:var(--danger);font-weight:700}.shf-ph .shf-av{flex:0 0 26px;height:26px;font-size:11px}.shf-ph.gone .nm b{color:var(--muted)}" +
      ".shf-c{height:44px;padding:3px!important;cursor:cell;position:relative}.shf-c:focus{outline:2px solid var(--accent);outline-offset:-2px}" +
      ".shf-c.sel{background:rgba(10,132,255,.16)!important;box-shadow:inset 0 0 0 1px rgba(10,132,255,.55)}.shf-c.today{background:rgba(10,132,255,.04)}" +
      ".shf-c.bad{box-shadow:inset 0 0 0 2px var(--danger)}.shf-c.warn{box-shadow:inset 0 0 0 2px var(--warn,#8A5A08)}.shf-c.drop{background:rgba(10,132,255,.24)!important}" +
      ".shf-grid .shf-p{display:block;width:100%;min-height:0;padding:3px 6px;margin:0 0 2px;border:0;border-radius:6px;background:rgba(10,132,255,.12);font-size:12.5px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;cursor:pointer;line-height:1.3}" +
      ".shf-grid .shf-p:hover{background:rgba(10,132,255,.2)}.shf-grid .shf-p i{font-style:normal;font-weight:500;color:var(--muted);margin-left:4px}.shf-grid .shf-p.ro{box-shadow:inset 3px 0 0 var(--accent)}.shf-grid .shf-p.on-lv{text-decoration:line-through;opacity:.75}" +
      ".shf-grid.m .shf-c{padding:2px 1px!important}.shf-grid.m .shf-p{padding:1px 0;text-align:center;font-size:10px;letter-spacing:-.03em;line-height:1.15;text-overflow:clip}.shf-grid.m .shf-p span{display:block}.shf-grid.m .shf-ph .shf-av{display:none}.shf-grid.m .shf-lvt{font-size:10px;letter-spacing:-.03em;text-overflow:clip}.shf-grid.m .shf-p i{display:none}.shf-grid.m .shf-c{height:38px}" +
      ".shf-lvt{display:block;font-size:11.5px;color:var(--warn,#8A5A08);font-weight:600;padding:2px 4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.shf-grid.m .shf-lvt{text-align:center;padding:2px 0}" +
      ".shf-fr td{padding:0;background:var(--panel)}.shf-fr .w{max-width:620px;margin:8px auto;border:1px solid var(--border);border-radius:12px;overflow:hidden;background:var(--panel2)}.shf-fr .shf-form{border-top:0}" +
      ".shf-addp td{padding:0}.shf-addp .shf-add{border-top:0;position:sticky;left:0;width:auto;display:inline-block}" +
      // the strip of things to look at, the undo line, the selection bar, the dialog
      ".shf-look{margin-top:10px;font-size:13.5px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}.shf-look>b{margin-right:4px}" +
      ".shf-look button{font:inherit;font-size:13px;border:1px solid var(--border);background:var(--panel2);color:var(--text);border-radius:16px;padding:6px 12px;min-height:32px;cursor:pointer;text-align:left}.shf-look button.problem{border-color:var(--danger);color:var(--danger)}.shf-look button.warn{border-color:var(--warn,#8A5A08);color:var(--warn,#8A5A08)}" +
      ".shf-undo{display:flex;align-items:center;gap:10px;margin-top:10px;padding:8px 8px 8px 14px;border-radius:12px;background:rgba(31,122,58,.12);font-size:14px}.shf-undo span{flex:1;min-width:0}.shf-undo.bad{background:rgba(191,59,46,.12)}" +
      ".shf-bar{position:sticky;bottom:12px;z-index:20;margin:14px auto 0;max-width:980px;display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:10px 12px;border-radius:16px;background:var(--panel2);border:1px solid var(--border);box-shadow:0 8px 30px rgba(0,0,0,.18)}" +
      ".shf-bar>b{flex:1 1 auto;font-size:14px;min-width:150px}.shf-bar select{font:inherit;font-size:14px;height:36px;border-radius:18px;border:1px solid var(--border);background:var(--panel);color:var(--text);padding:0 8px}" +
      ".shf-menu{position:relative}.shf-menu .list{position:absolute;right:0;top:40px;z-index:30;min-width:240px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.18);padding:6px}" +
      ".shf-menu .list button,.shf-menu .list p{display:block;width:100%;text-align:left;font:inherit;font-size:14px;border:0;background:none;color:var(--text);padding:10px 12px;border-radius:8px;cursor:pointer;min-height:44px;margin:0}.shf-menu .list button:hover{background:rgba(118,118,128,.1)}.shf-menu .list p{color:var(--muted);cursor:default}" +
      ".shf-ov{position:fixed;inset:0;z-index:1000;background:rgba(0,0,0,.35);display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px;overflow:auto}" +
      ".shf-dlg{width:100%;max-width:560px;background:var(--panel2);color:var(--text);border-radius:16px;border:1px solid var(--border);box-shadow:0 20px 60px rgba(0,0,0,.3);padding:18px 18px 14px;box-sizing:border-box}" +
      ".shf-dlg h2{margin:0 0 4px;font-size:20px;font-weight:700}.shf-dlg>p.s{margin:0 0 12px;color:var(--muted);font-size:13.5px}" +
      ".shf-ch{display:block;width:100%;text-align:left;font:inherit;border:1px solid var(--border);background:var(--panel);color:var(--text);border-radius:12px;padding:10px 14px;margin-top:8px;cursor:pointer;min-height:52px}.shf-ch:hover{border-color:var(--accent)}.shf-ch b{display:block;font-size:15px}.shf-ch span{display:block;font-size:13px;color:var(--muted);margin-top:2px}.shf-ch kbd{float:right;font:inherit;font-size:11.5px;color:var(--muted);border:1px solid var(--border);border-radius:5px;padding:0 5px}" +
      ".shf-fs{border:0;margin:12px 0 0;padding:0}.shf-fs legend,.shf-fl{display:block;font-size:13px;font-weight:700;color:var(--muted);margin:0 0 6px;padding:0}" +
      ".shf-row{display:flex;gap:6px;flex-wrap:wrap;align-items:center}.shf-row input[type=date],.shf-row input[type=time],.shf-row input[type=number],.shf-row select,.shf-dlg select.full{font:inherit;font-size:16px;height:40px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text);padding:0 8px;min-width:0}.shf-dlg select.full{width:100%}" +
      ".shf-tg{font:inherit;font-size:14px;min-height:40px;min-width:44px;padding:0 12px;border-radius:20px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer}.shf-tg[aria-pressed=true],.shf-tg[aria-selected=true]{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".shf-ppl{max-height:180px;overflow:auto;border:1px solid var(--border);border-radius:10px;padding:4px 10px}.shf-ppl label,.shf-rad label{display:flex;align-items:center;gap:10px;min-height:40px;font-size:15px}.shf-ppl input,.shf-rad input{width:20px;height:20px;accent-color:var(--accent)}" +
      ".shf-dacts{display:flex;justify-content:flex-end;gap:8px;margin-top:16px;flex-wrap:wrap}.shf-dacts .shf-btn{height:40px}.shf-dacts .l{margin-right:auto}" +
      ".shf-pv{margin-top:10px;font-size:14px;line-height:1.5}.shf-pv .one{padding:8px 0;border-top:.5px solid var(--border)}.shf-pv .one:first-child{border-top:0}.shf-pv b.n{font-size:15px}.shf-pv .sk{color:var(--muted);font-size:13px}.shf-pv .rm{color:var(--danger)}" +
      ".shf-pv details{margin-top:6px}.shf-pv summary{cursor:pointer;color:var(--accent);font-weight:600;min-height:32px}.shf-pv ul{margin:4px 0 0;padding:0 0 0 2px;list-style:none;max-height:220px;overflow:auto;font-size:13px;font-variant-numeric:tabular-nums}.shf-pv li.a::before{content:'+ ';color:var(--ok,#1F7A3A);font-weight:700}.shf-pv li.r::before{content:'− ';color:var(--danger);font-weight:700}.shf-pv li.s::before{content:'· ';color:var(--muted)}.shf-pv li.k::before{content:'● ';color:var(--muted)}" +
      ".shf-pv .aft{margin-top:8px;padding:8px 10px;border-radius:10px;background:rgba(201,138,18,.14)}.shf-pv .aft.ok{background:rgba(31,122,58,.12)}.shf-prog{margin-top:10px;font-weight:600}" +
      ".shf-dlg .shf-err{padding:8px 0 0}.shf-dlg .shf-hint{font-size:12.5px;color:var(--muted);margin:4px 0 0}" +
      ".shf-cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px;margin-top:12px}.shf-cal .dh{font-size:11.5px;font-weight:700;color:var(--muted);text-align:center;padding:4px 0}" +
      ".shf-cal button{font:inherit;min-height:56px;border:1px solid var(--border);border-radius:10px;background:var(--panel2);color:var(--text);padding:4px 2px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:2px}.shf-cal button b{font-size:15px}.shf-cal button span{font-size:12px;color:var(--text)}.shf-cal button.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.shf-cal button.gap span.g{color:var(--warn,#8A5A08);font-weight:700}.shf-cal button.shut{opacity:.7}" +
      ".shf-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      // A wide tablet shows the week in two columns (Monday to Sunday reading across), so most of it is seen without scrolling.
      "@media (min-width:900px) and (max-width:1099px){.shf{max-width:1060px}.shf-week{display:grid;grid-template-columns:1fr 1fr;gap:10px 12px;align-items:stretch}.shf-week .shf-day{margin-top:0;display:flex;flex-direction:column}.shf-week .shf-day>.shf-add:last-child{margin-top:auto}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) :is(.shf-seg button[aria-pressed=true],.shf-tg[aria-pressed=true],.shf-tg[aria-selected=true]){color:#00160E}}" +
      "@media (max-width:600px){.shf-form .acts label.sw{flex-direction:column;align-items:stretch;gap:2px}.shf-form .acts label.sw select{width:100%;padding:8px 0}}" +
      "@media (max-width:600px){.shf{padding:4px 16px 0}.shf h1{font-size:32px}.shf-nav button.ar{width:44px;height:44px;flex-basis:44px;border-radius:22px}.shf-nav .now,.shf-seg button,.shf-tools select{height:44px}.shf-btn{height:44px;border-radius:22px}.shf-note a{display:inline-block;padding:12px 0;margin:-12px 0}" +
      ".shf-ov{padding:0;align-items:flex-end}.shf-dlg{border-radius:16px 16px 0 0;max-height:92vh;overflow:auto}.shf-bar{bottom:calc(84px + env(safe-area-inset-bottom,0px));border-radius:14px}.shf-bar select{height:44px;flex:1 1 100%}.shf-bar .shf-btn{flex:1 1 auto}.shf-look button{min-height:44px}.shf-ch{min-height:56px}.shf-tg{min-height:44px}.shf-dacts .shf-btn{height:44px}.shf-row input[type=date],.shf-row input[type=time],.shf-row input[type=number],.shf-row select,.shf-dlg select.full{height:44px}}" +
      ".shf h1[tabindex='-1']:focus{outline:none}";
    document.head.appendChild(st);
  }

  // ---- loading: people, the range (a day either side, for the rules), opening hours and rules (cached), leave by year ----
  function years() { var a = [rStart().getFullYear(), plus(rStart(), rLen() - 1).getFullYear(), new Date().getFullYear()].concat(S.lvYears).concat(rStart().getMonth() === 0 || plus(rStart(), -1).getMonth() === 11 ? [plus(rStart(), -1).getFullYear(), rStart().getFullYear() - (rStart().getMonth() === 0 ? 1 : 0)] : []); /* a leave from late December shows in January: it is filed under the year it starts */ return a.filter(function (y, i) { return a.indexOf(y) === i; }); }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var sig = rangeSig(), from = ymd(plus(rStart(), -1)), to = ymd(plus(rStart(), rLen())), ys = years();
    S.loadSig = sig;
    try {
      var res = await Promise.all([E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }), E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to, { method: "GET" }),
        E.rotaRules(), null]
        .concat(ys.map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }).catch(function () { return null; }); })));
      if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) throw new Error((res[1] && res[1].error) || (res[0] && res[0].error) || "Could not load the rota");
      if (sig !== rangeSig()) return; // the range changed while this was loading: the newer load paints
      S.staff = {}; (res[0].staff || []).forEach(function (p) { S.staff[p.id] = p; });
      S.canPlan = "can_plan" in res[0] ? !!res[0].can_plan : undefined; S.meId = res[0].me_staff_id != null ? res[0].me_staff_id : null; // roles round
      S.shifts = sortShifts(res[1].shifts || []);
      S.hours = (res[2] && res[2].hours) || S.hours; S.rules = (res[2] && res[2].settings) || S.rules; // opening hours and cover rules: E.rotaRules keeps them 5 minutes
      var lv = res.slice(4), seen = {};
      S.leaveErr = lv.some(function (r) { return !r || !r.ok; }) ? "Leave requests could not be loaded. Try again in a moment." : "";
      S.leaves = [].concat.apply([], lv.map(function (r) { return (r && r.ok && r.leaves) || []; })).filter(function (l) { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
    } catch (e) { if (sig !== rangeSig()) return; if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the rota"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  async function rangeList(from, to, sid) {
    var r = await E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to + (sid ? "&staff_id=" + sid : ""), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the rota");
    return (r.shifts || []).filter(function (x) { return x.shift_date >= from && x.shift_date <= to && (!sid || Number(x.staff_id) === Number(sid)); });
  }
  async function dayList(key) { return rangeList(key, key); }

  // After a change, only that day is read again (one bounded read), so the day's cover and any gap update at once.
  // A swap across two days reads those two days only.
  async function refreshDay(key, key2) {
    var sig = rangeSig(), ks = [key, key2 || key].sort(), lo = ks[0], hi = ks[1];
    try {
      var list = lo === hi ? await dayList(lo) : (await Promise.all([dayList(lo), dayList(hi)])).reduce(function (a, b) { return a.concat(b); }, []);
      if (sig !== rangeSig()) return; // the range moved meanwhile: its own load paints
      S.shifts = sortShifts(S.shifts.filter(function (x) { return x.shift_date !== lo && x.shift_date !== hi; }).concat(list));
      E.whenFormIdle(S.mount, function () { paint(); });
    } catch (e) { await load(); }
  }
  // After a fill, the range on screen is read once more and only the cells that changed are drawn again.
  async function refreshRange() {
    var sig = rangeSig(), from = ymd(plus(rStart(), -1)), to = ymd(plus(rStart(), rLen()));
    try {
      var list = sortShifts(await rangeList(from, to)); if (sig !== rangeSig()) return;
      var was = {}, now = {}; S.shifts.forEach(function (x) { was[x.shift_date] = (was[x.shift_date] || "") + rowSig(x) + x.id + ";"; }); list.forEach(function (x) { now[x.shift_date] = (now[x.shift_date] || "") + rowSig(x) + x.id + ";"; });
      var changed = keys().filter(function (k) { return (was[k] || "") !== (now[k] || ""); });
      S.shifts = list;
      E.whenFormIdle(S.mount, function () { if (!paintCells(changed)) paint(); });
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
    else if (a === "trim") h += '<span class="q">' + esc(p.full_name) + " is on the rota then: " + esc(S.ask.plan.words) + '. Change ' + (S.ask.plan.changes.length === 1 ? "it" : "them") + ' too?</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn" data-act="lv-keep-shifts" data-id="' + l.id + '"' + dis + '>Approve, keep shifts</button><button class="shf-btn p" data-act="lv-trim" data-id="' + l.id + '"' + dis + ">Approve and change them</button>";
    else if (a === "gap") h += '<span class="q">Approving leaves the pharmacy without a pharmacist on these days. Approve anyway?</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn p" data-act="lv-approve-yes" data-id="' + l.id + '"' + dis + ">Approve anyway</button>";
    else if (a === "locum") h += '<span class="q">Make sure a locum shift is planned for these days.</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn p" data-act="lv-approve-yes" data-id="' + l.id + '"' + dis + ">Approve</button>";
    else if (!canAnswer(l)) h += '<span class="q">' + (meId() != null && Number(l.staff_id) === meId() ? "Waiting for an answer from the pharmacy's admin." : "The pharmacy's admin answers it.") + "</span>"; // roles round: never your own
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
  function beforeStart(k) { return !!(E.beforeStart && E.beforeStart(k)); } // dayzero's E.startYmd contract; absent: as before
  function gapHtml(key, g, dayName) {
    if (beforeStart(key)) return ""; // before the pharmacy existed: no gap to fill
    var t = g.from + "–" + g.to;
    return '<button class="shf-gap" data-act="fill" data-date="' + key + '" data-s="' + g.from + '" data-e="' + g.to + '" aria-label="No pharmacist ' + esc(g.from) + " to " + esc(g.to) + " on " + esc(dayName) + ': fill the gap"><b>No pharmacist ' + esc(t) + '</b><span>Fill the gap</span><span class="chev" aria-hidden="true"></span></button>';
  }

  // ---- the shift form: add, change, note, works as (role), remove, swap, move, a new locum in one step ----
  function roleRow(f) {
    var p = f.staff_id && f.staff_id !== "new" ? person(f.staff_id) : null, own = p ? desig(p) : "";
    if (p && isPharm(p) && !f.role_override) return ""; // a pharmacist works as a pharmacist
    var opts = [["", own ? "Their own role (" + own + ")" : "Their own role"], ["pharmacist", "Pharmacist (cover)"]];
    if (f.role_override && f.role_override !== "pharmacist") opts.push([f.role_override, desig({ designation: f.role_override })]);
    return '<label><span>Works as</span><select name="role_override">' + opts.map(function (o) { return '<option value="' + esc(o[0]) + '"' + (String(f.role_override || "") === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
  }
  function formHtml(key) {
    var f = S.form, h = '<form class="shf-form" id="shf-form" autocomplete="off" aria-label="' + esc((f.mode === "add" ? "New shift on " : "Shift on ") + longDay(key)) + '">';
    if (f.mode === "add" && (S.wide || f.row != null)) { var ohd = hoursFor(key); h += '<div class="row"><span>Day</span><b>' + esc(longDay(key) + " · " + (ohd.closed ? ohd.words : "open " + ohd.open + "–" + ohd.close)) + "</b></div>"; }
    if (f.mode === "add" && hoursFor(key).closed && !f.warn) h += '<div class="shf-warn" role="status">' + esc((hoursFor(key).holiday ? "Public holiday (" + hoursFor(key).holiday + ")" : "The pharmacy is closed") + " that day. The shift can still be added.") + "</div>";
    if (f.mode === "add") {
      var free = active().filter(function (p) { return !approvedOn(p.id, key); });
      var opt = function (p) { return '<option value="' + p.id + '"' + (String(f.staff_id) === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + (desig(p) ? " · " + esc(desig(p)) : "") + "</option>"; };
      var firstOnes = f.gap ? fillers(key, f.gap) : [], ids = firstOnes.map(function (p) { return String(p.id); });
      h += (f.gap ? '<div class="shf-fillh">Fill the gap ' + esc(f.gap.from + "–" + f.gap.to) + (firstOnes.length ? "" : ": no pharmacist is free then. Choose a person, or add a locum.") + "</div>" : "") +
        '<label><span>Who</span><select name="staff_id"><option value="">Choose a person</option>' +
        (firstOnes.length ? '<optgroup label="Free to cover ' + esc(f.gap.from + "–" + f.gap.to) + '">' + firstOnes.map(opt).join("") + '</optgroup><optgroup label="Everyone else">' + free.filter(function (p) { return ids.indexOf(String(p.id)) < 0; }).map(opt).join("") + "</optgroup>" : free.map(opt).join("")) +
        '<option value="new"' + (f.staff_id === "new" ? " selected" : "") + ">+ A new locum…</option></select></label>";
      if (f.staff_id === "new") h += '<label><span>Name</span><input name="lc_name" value="' + esc(f.lc_name || "") + '" autocomplete="off" placeholder="The locum’s full name"></label>' +
        '<label><span>Phone</span><input name="lc_phone" type="tel" inputmode="tel" value="' + esc(f.lc_phone || "") + '" placeholder="Optional"></label>' +
        '<label><span>Reg. no.</span><input name="lc_reg" value="' + esc(f.lc_reg || "") + '" placeholder="Optional"></label>';
    } else {
      var p = person(f.staff_id);
      h += '<div class="row"><span>Who</span><b>' + esc(p.full_name) + "</b></div>";
    }
    var saved = f.swap && S.shifts.filter(function (x) { return Number(x.id) === Number(f.id); })[0];
    if (saved) h += '<div class="row"><span>Hours</span><b>' + esc(hm(saved.start_time) + "–" + hm(saved.end_time)) + "</b></div>" + (saved.notes ? '<div class="row"><span>Note</span><b>' + esc(saved.notes) + "</b></div>" : "");
    else if (f.move) {
      var opts = active().filter(function (q) { return true; }).map(function (q) { return '<option value="' + q.id + '"' + (String(f.move.sid) === String(q.id) ? " selected" : "") + ">" + esc(q.full_name) + "</option>"; }).join("");
      h += '<div class="row"><span>Hours</span><b>' + esc(f.start_time + "–" + f.end_time) + '</b></div><label><span>To day</span><input type="date" name="mv_date" value="' + esc(f.move.date) + '"></label><label><span>To whom</span><select name="mv_sid">' + opts + "</select></label>";
    } else h += '<label><span>Starts</span><input type="time" name="start_time" value="' + esc(f.start_time) + '"></label>' +
      '<label><span>Ends</span><input type="time" name="end_time" value="' + esc(f.end_time) + '"></label>' +
      '<label><span>Note</span><input name="notes" value="' + esc(f.notes) + '" placeholder="Optional"></label>' + roleRow(f);
    if (f.warn) h += '<div class="shf-warn" role="status">' + esc(f.warn) + "</div>";
    if (f.err) h += '<div class="shf-err" role="alert">' + esc(f.err) + "</div>";
    h += '<div class="acts">';
    if (f.swap) h += swapHtml(key);
    else if (f.move) h += '<button type="button" class="shf-btn" data-act="mv-no">Keep it here</button><button type="button" class="shf-btn p" data-act="mv-yes"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Moving…" : "Move shift") + "</button>";
    else if (f.confirmDel) h += '<span class="q">Remove this shift? It is taken off the rota.</span><button type="button" class="shf-btn" data-act="del-no">Keep it</button><button type="button" class="shf-btn d" data-act="del-yes"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Removing…" : "Remove") + "</button>";
    else {
      if (f.mode === "edit") h += '<button type="button" class="shf-btn x" data-act="del">Remove shift</button>' + (swapList(f).length ? '<button type="button" class="shf-btn" data-act="swap">Swap…</button>' : "") + '<button type="button" class="shf-btn" data-act="move">Move to…</button>';
      h += '<button type="button" class="shf-btn" data-act="cancel">Cancel</button><button type="submit" class="shf-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : f.warnSig ? "Save anyway" : f.mode === "add" ? "Add shift" : "Save") + "</button>";
    }
    return h + "</div></form>";
  }

  // ---- the header: back, title, leave requests, people, range bar, tools ----
  function headHtml() {
    var h = '<button class="shf-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("shfreg") : "‹ Team") + '</button><h1>Plan shifts</h1>' + (canPlan()
      ? '<p class="shf-sub">Who works when: add, change or remove a shift, fill weeks and months at once, and answer leave requests.</p>'
      : '<p class="shf-sub">Who works when, and your leave requests. Only the pharmacy\'s admin changes shifts. <a href="#rotreg" class="shf-mine">Your next shifts</a></p>'); // roles round
    return h;
  }
  function leaveBlock() {
    var h = "", pending = S.leaves.filter(function (l) { return low(l.status) === "pending"; }).sort(function (a, b) { return String(a.start_date).localeCompare(String(b.start_date)); });
    if (pending.length || S.lvMsg || S.lv || leavers().length) {
      var soon = addDays(todayK(), 14), open = S.lvOpen || S.lv || S.ask || S.lvMsg || S.busy || pending.some(function (l) { return l.start_date <= soon && (l.end_date || l.start_date) >= todayK(); });
      if (!open && pending.length) { // calm: one line that opens them
        var who = pending.slice(0, 3).map(function (l) { return first(person(l.staff_id)) + " (" + leaveLabel(l.leave_type).replace(/ leave$/i, "").toLowerCase() + " " + leaveWhen(l) + ")"; }).join(", ") + (pending.length > 3 ? " and " + (pending.length - 3) + " more" : "");
        return '<div class="shf-card shf-lvline"><button class="shf-add" style="border-top:0" data-act="lv-open" aria-expanded="false">' + esc(plural(pending.length, "leave request") + ": " + who) + ' ›</button>' + (leavers().length ? '<button class="shf-add" data-act="lv-new" data-k="lv-new">' + (canPlan() ? "+ New leave request" : "+ Ask for leave") + "</button>" : "") + "</div>" + (S.leaveErr ? '<p class="shf-note">' + esc(S.leaveErr) + "</p>" : "");
      }
      h += '<div class="shf-lab">Leave requests <b>' + pending.length + "</b></div>";
      if (S.lvMsg) h += '<div class="shf-err" role="alert" style="padding:0 2px 6px">' + esc(S.lvMsg) + "</div>";
      h += '<div class="shf-card">' + pending.map(leaveHtml).join("") +
        (S.lv ? lvFormHtml() : leavers().length ? '<button class="shf-add"' + (pending.length ? "" : ' style="border-top:0"') + ' data-act="lv-new" data-k="lv-new">' + (canPlan() ? "+ New leave request" : "+ Ask for leave") + "</button>" : "") + "</div>";
    }
    if (S.leaveErr) h += '<p class="shf-note">' + esc(S.leaveErr) + "</p>";
    return h;
  }
  function rangeLabel() {
    if (S.view === "month") return MONTHS[S.month.getMonth()] + " " + S.month.getFullYear();
    var sun = plus(S.monday, 6); return S.monday.getDate() + " " + MON[S.monday.getMonth()] + " – " + sun.getDate() + " " + MON[sun.getMonth()];
  }
  function isNow() { var t = new Date(); return S.view === "month" ? S.month.getFullYear() === t.getFullYear() && S.month.getMonth() === t.getMonth() : ymd(mondayOf(t)) === ymd(S.monday); }
  function navHtml() {
    var m = S.view === "month", w = m ? "month" : "week";
    var h = '<div class="shf-nav"><button class="ar" data-act="prev" aria-label="Previous ' + w + '" title="Previous ' + w + ' (←)">‹</button><b>' + esc(rangeLabel()) + "</b>" + (isNow() ? "" : '<button class="now" data-act="now">This ' + w + "</button>") + '<button class="ar" data-act="next" aria-label="Next ' + w + '" title="Next ' + w + ' (→)">›</button></div>';
    h += '<div class="shf-tools"><div class="shf-seg" role="group" aria-label="Show"><button data-act="view" data-v="week" aria-pressed="' + !m + '">Week</button><button data-act="view" data-v="month" aria-pressed="' + m + '">Month</button></div>';
    h += '<select data-k="role" aria-label="Show whom">' + ROLES.map(function (r) { return '<option value="' + r[0] + '"' + (S.role === r[0] ? " selected" : "") + ">" + esc(r[1]) + "</option>"; }).join("") + "</select>";
    if (!S.wide && active().length) h += '<button class="shf-btn" data-act="pick" aria-pressed="' + !!S.pick + '">' + (S.pick ? "Done selecting" : "Select") + "</button>";
    h += '<span class="sp"></span>' + (active().length ? '<button class="shf-btn p" data-act="fill-open" data-k="fill-open" title="Fill… (F)">Fill…</button>' : "") + (E.rotaPrint && E.rotaPrint.ui && E.rotaPrint.ui.panel ? '<button class="shf-btn" data-act="print">Print</button>' : "");
    h += '<div class="shf-menu"><button class="shf-btn" data-act="menu" aria-expanded="' + !!S.menu + '" aria-haspopup="true" aria-label="More">⋯</button>' + (S.menu ? menuHtml() : "") + "</div></div>";
    return h;
  }
  function menuHtml() {
    var r = recentList();
    var RS = E.rotaSet && typeof E.rotaSet.open === "function";
    return '<div class="list" role="menu">' + (RS ? '<button role="menuitem" data-act="m-hours">Opening hours</button><button role="menuitem" data-act="m-rules">Rules</button>' : "") +
      (E.rotaCal && E.rotaCal.ui && E.rotaCal.ui.panel ? '<button role="menuitem" data-act="m-cal">Calendar link</button>' : "") +
      (r.length ? '<p>Recent changes</p>' + r.map(function (x) { return '<button role="menuitem" data-act="undo" data-u="' + esc(x.id) + '">Undo: ' + esc(x.words) + "</button>"; }).join("") : '<p>No changes to undo yet</p>') +
      '<button role="menuitem" data-act="to-classic">Classic Shifts screen</button></div>';
  }

  // ---- the grid (desktop): people × days, the hours and cover row on top ----
  function chipHtml(x, m) {
    var p = person(x.staff_id), off = approvedOn(x.staff_id, x.shift_date), t = hm(x.start_time) + "–" + hm(x.end_time);
    var role = x.role_override ? desig({ designation: x.role_override }) : "", lab = "Change " + p.full_name + "'s shift, " + longDay(x.shift_date) + ", " + hm(x.start_time) + " to " + hm(x.end_time) + (role ? ", works as " + role : "") + (x.notes ? ", note: " + x.notes : "") + (off ? ", on leave" : "");
    return '<button class="shf-p' + (x.role_override ? " ro" : "") + (off ? " on-lv" : "") + '" data-act="edit" data-id="' + x.id + '" draggable="true" tabindex="-1" aria-label="' + esc(lab) + '" title="' + esc(t + (role ? " · works as " + role : "") + (x.notes ? " · " + x.notes : "")) + '">' +
      (m ? "<span>" + esc(compact(x.start_time)) + "</span><span>" + esc(compact(x.end_time)) + "</span>" : esc(t)) + (x.notes ? '<i aria-hidden="true">✎</i>' : "") + (role && !m ? "<i>" + esc(role === "Pharmacist" ? "as pharmacist" : role) + "</i>" : "") + "</button>";
  }
  function cellInner(p, k, m) {
    var h = shiftsOf(p.id, k).map(function (x) { return chipHtml(x, m); }).join(""), lv = approvedOn(p.id, k), pd = !lv && pendingOn(p.id, k);
    if (lv) h += '<span class="shf-lvt">' + esc(m ? "Leave" : leaveLabel(lv.leave_type)) + "</span>";
    else if (pd) h += '<span class="shf-lvt">' + (m ? "Asked" : "Asked for leave") + "</span>";
    return h;
  }
  function cellLabel(p, k) {
    var l = shiftsOf(p.id, k), lv = approvedOn(p.id, k);
    return p.full_name + ", " + longDay(k) + ": " + (l.length ? l.map(function (x) { return hm(x.start_time) + "–" + hm(x.end_time); }).join(", ") : "no shift") + (lv ? ", " + leaveLabel(lv.leave_type) : "");
  }
  var looks = {}; // cell key → "bad" | "warn", from the rules
  function cellHtml(p, k, m, today) {
    var key = p.id + "|" + k, cur = S.cur && S.cur.sid === Number(p.id) && S.cur.date === k, wd = dow(k);
    return '<td class="shf-c' + (wd > 4 ? " we" : "") + (k === today ? " today" : "") + (S.sel[key] ? " sel" : "") + (looks[key] ? " " + looks[key] : "") + '" role="gridcell" data-sid="' + p.id + '" data-date="' + k + '" tabindex="' + (cur ? 0 : -1) + '" aria-selected="' + !!S.sel[key] + '" aria-label="' + esc(cellLabel(p, k)) + '">' + cellInner(p, k, m) + "</td>";
  }
  function planned(sid) { var ks = keys(), lo = ks[0], hi = ks[ks.length - 1], n = 0; S.shifts.forEach(function (x) { if (Number(x.staff_id) === Number(sid) && x.shift_date >= lo && x.shift_date <= hi) n += shiftMins(x); }); return n; }
  function phInner(p) {
    var n = planned(p.id), c = Number(p.contracted_hours) || 0, m = S.view === "month", over = !m && c && n > c * 60;
    var hl = m ? hrs(n) + " h" : hrs(n) + (c ? "/" + hrs(c * 60) : "") + " h", sub = desig(p) + " · " + hl + (m ? " this month" : " this week");
    return '<div class="in"><input type="checkbox" data-tick="p" data-sid="' + p.id + '" aria-label="Select all of ' + esc(p.full_name) + '’s days"' + (keys().every(function (k) { return S.sel[p.id + "|" + k]; }) ? " checked" : "") + ">" + av(p.full_name, Number(p.is_active) === 0) +
      '<button class="nm" data-act="person" data-sid="' + p.id + '" aria-label="' + esc(p.full_name + ", " + sub.replace("/", " of ") + (over ? ", over contract" : "") + ": details") + '"><b>' + esc(p.full_name) + "</b><span>" + esc(desig(p)) + '</span></button><em class="' + (over ? "over" : "") + '" aria-hidden="true">' + esc(hl) + "</em></div>";
  }
  function covInner(k, m) {
    var c = dayCover(k), dn = longDay(k), any = S.shifts.some(function (x) { return x.shift_date === k; });
    if (m) return c.closed ? '<span class="shf-dot shut" role="img" aria-label="' + esc(dn + ": " + c.words) + '" title="' + esc(c.words) + '"></span>' : c.gaps.length ? c.gaps.slice(0, 1).map(function (g) { return '<button class="shf-gap" data-act="fill" data-date="' + k + '" data-s="' + g.from + '" data-e="' + g.to + '" title="' + esc(c.words) + '" aria-label="' + esc(c.words + " on " + dn + ": fill the gap") + '"><b>!</b></button>'; }).join("") : '<span class="shf-dot" role="img" aria-label="' + esc(dn + ": " + c.words + ", covered") + '" title="' + esc(c.words + " · covered") + '"></span>';
    if (c.closed) return hrsBtn(k, c.words, dn) + (any ? '<span class="shf-lvt">Shifts planned on a closed day</span>' : "");
    return hrsBtn(k, c.open + "–" + c.close, dn) + (c.holiday ? " · " + esc(c.holiday) : "") + (c.gaps.length ? c.gaps.map(function (g) { return gapHtml(k, g, dn); }).join("") : ' · <span class="ok">Covered</span>');
  }
  function hrsBtn(k, words, dn) { return E.rotaSet && E.rotaSet.open ? '<button class="shf-hrs" data-act="dayhours" data-date="' + k + '" aria-label="' + esc(dn + ": " + words + ". Change this day’s hours") + '">' + esc(words) + "</button>" : esc(words); }
  function formRow(n) { return '<tr class="shf-fr"><td colspan="' + (n + 1) + '"><div class="w">' + formHtml(S.form.date) + "</div></td></tr>"; }
  function gridHtml() {
    var ks = keys(), m = S.view === "month", today = ymd(new Date()), list = rows(), n = ks.length;
    if (!S.cur || !list.some(function (p) { return Number(p.id) === S.cur.sid; }) || ks.indexOf(S.cur.date) < 0) S.cur = list.length ? { sid: Number(list[0].id), date: ks.indexOf(today) >= 0 ? today : ks[0] } : null;
    computeLooks();
    var h = '<div class="shf-gw"><table class="shf-grid' + (m ? " m" : "") + '" role="grid" aria-multiselectable="true" aria-label="' + esc("Shifts " + rangeLabel() + ": people by day. Arrows move, Shift and arrows select, Enter opens, Delete clears") + '"><thead><tr><th class="shf-corner" scope="col"><div class="in" style="padding:6px 8px">People</div></th>';
    ks.forEach(function (k) {
      var d = parse(k), wd = dow(k);
      h += '<th scope="col" class="shf-dh shf-day' + (k === today ? " today" : "") + (wd > 4 ? " we" : "") + '" data-date="' + k + '"><div class="in"><input type="checkbox" data-tick="d" data-date="' + k + '" aria-label="Select everyone on ' + esc(longDay(k)) + '"' + (list.length && list.every(function (p) { return S.sel[p.id + "|" + k]; }) ? " checked" : "") + '><span class="dn"><span>' + (k === today ? "Today" : DAY[wd].slice(0, 3)) + "</span><b>" + d.getDate() + (m ? "" : " " + MON[d.getMonth()]) + "</b></span>" +
        '<button class="shf-add" data-act="add" data-date="' + k + '" aria-label="Add a shift on ' + esc(longDay(k)) + '" title="Add a shift"' + (m ? ' tabindex="-1"' : "") + ">+</button></div></th>";
    });
    h += '</tr><tr class="shf-cov"><th scope="row"><div class="in" style="padding:6px 8px;font-size:12.5px;font-weight:600">Hours · cover</div></th>';
    ks.forEach(function (k) { var c = dayCover(k); h += '<td class="' + (c.closed ? "shut" : "") + '" data-cov="' + k + '">' + covInner(k, m) + "</td>"; });
    h += "</tr></thead><tbody>";
    if (S.form && !S.form.row) h += formRow(n);
    list.forEach(function (p) {
      h += '<tr data-sid="' + p.id + '"><th scope="row" class="shf-ph' + (Number(p.is_active) === 0 ? " gone" : "") + '">' + phInner(p) + "</th>" + ks.map(function (k) { return cellHtml(p, k, m, today); }).join("") + "</tr>";
      if (S.form && S.form.row && Number(S.form.row) === Number(p.id)) h += formRow(n);
    });
    if (!list.length) h += '<tr><td colspan="' + (n + 1) + '" style="padding:14px;color:var(--muted)">' + (S.role ? "No one with that role. Choose Everyone above." : "No one on the rota yet.") + "</td></tr>";
    if (!S.who) h += '<tr class="shf-addp"><td colspan="' + (n + 1) + '"><button class="shf-add" data-act="who" data-k="who">+ Add a person to the rota</button></td></tr>';
    return h + "</tbody></table></div>";
  }
  // Repaint only the given days' cells (and every row's hours and the rules strip). false when the grid is not on screen.
  function paintCells(ks) {
    var m = S.mount, t = m && m.querySelector(".shf-grid"); if (!t || !S.wide || S.form || S.dlg) return false;
    var list = rows(), shown = Array.prototype.map.call(t.querySelectorAll("tbody tr[data-sid]"), function (r) { return r.getAttribute("data-sid"); });
    if (shown.join() !== list.map(function (p) { return String(p.id); }).join()) return false; // someone came or went: draw it all
    var month = S.view === "month", today = ymd(new Date()); computeLooks();
    ks.forEach(function (k) {
      var cv = t.querySelector('[data-cov="' + k + '"]'); if (cv) { cv.innerHTML = covInner(k, month); cv.className = dayCover(k).closed ? "shut" : ""; }
      list.forEach(function (p) { var td = t.querySelector('td.shf-c[data-sid="' + p.id + '"][data-date="' + k + '"]'); if (td) { td.innerHTML = cellInner(p, k, month); td.setAttribute("aria-label", cellLabel(p, k)); } });
    });
    Array.prototype.forEach.call(t.querySelectorAll("td.shf-c"), function (td) { var key = td.getAttribute("data-sid") + "|" + td.getAttribute("data-date"); td.classList.toggle("bad", looks[key] === "bad"); td.classList.toggle("warn", looks[key] === "warn"); });
    list.forEach(function (p) { var th = t.querySelector('tr[data-sid="' + p.id + '"] th.shf-ph'); if (th) th.innerHTML = phInner(p); });
    var lk = m.querySelector("#shf-look"); if (lk) lk.outerHTML = lookHtml();
    return true;
  }

  // ---- rules: E.rotaCheck when loaded (B3), else cover gaps, two shifts at once and shifts on approved leave ----
  var lookList = [];
  function computeLooks() {
    var ks = keys(), lo = ks[0], hi = ks[ks.length - 1], out = [];
    if (typeof E.rotaCheck === "function") {
      try { out = E.rotaCheck({ from: lo, to: hi }, { shifts: S.shifts, staff: S.staff, leaves: S.leaves, hours: S.hours, settings: S.rules }) || []; } catch (e) { out = []; }
    } else {
      ks.forEach(function (k) {
        var c = dayCover(k); if (c.gaps.length) out.push({ kind: "cover", level: "problem", date: k, staff_id: null, words: "No pharmacist " + dayWords(k) + " " + c.gaps.map(function (g) { return g.from + "–" + g.to; }).join(", ") });
        var day = S.shifts.filter(function (x) { return x.shift_date === k; });
        var seen = {}; day.forEach(function (x) {
          if (approvedOn(x.staff_id, k) && !seen["l" + x.staff_id]) { seen["l" + x.staff_id] = 1; var lv = approvedOn(x.staff_id, k); out.push({ kind: "leave", level: "problem", date: k, staff_id: x.staff_id, words: first(person(x.staff_id)) + " is on " + leaveLabel(lv.leave_type).toLowerCase() + " " + dayWords(k) + " but planned " + hm(x.start_time) + "–" + hm(x.end_time) }); }
          day.forEach(function (y) { if (Number(y.id) > Number(x.id) && Number(y.staff_id) === Number(x.staff_id) && mins(y.start_time) < mins(x.end_time) && mins(y.end_time) > mins(x.start_time) && !seen["d" + x.staff_id]) { seen["d" + x.staff_id] = 1; out.push({ kind: "double", level: "problem", date: k, staff_id: x.staff_id, words: first(person(x.staff_id)) + " has two shifts at once on " + dayWords(k) }); } });
        });
      });
    }
    lookList = out.filter(function (w) { return w && w.date >= lo && w.date <= hi && !beforeStart(w.date); }); // nothing is flagged before the pharmacy existed (W9, E.startYmd)
    looks = {}; lookList.forEach(function (w) { if (w.staff_id != null) { var k = w.staff_id + "|" + w.date; if (looks[k] !== "bad") looks[k] = w.level === "problem" ? "bad" : "warn"; } });
  }
  function lookHtml() {
    var l = lookList.filter(function (w) { return w.level !== "info"; });
    if (!canPlan()) return l.length ? '<p class="shf-note" id="shf-look">The pharmacy\'s admin sees the gaps in the rota and plans them.</p>' : ""; // roles round: one grey line, not the planner's red list
    if (!l.length) return '<div class="shf-look" id="shf-look" role="status">' + (S.shifts.length ? "<b>Nothing to look at " + rangeWord() + ".</b>" : "") + "</div>";
    return '<div class="shf-look" id="shf-look" role="status"><b>Things to look at ' + rangeWord() + " (" + l.length + "):</b>" + l.slice(0, 12).map(function (w) { return '<button class="' + esc(w.level || "") + '" data-act="jump" data-date="' + esc(w.date) + '" data-sid="' + esc(w.staff_id == null ? "" : w.staff_id) + '">' + esc(w.words) + " ›</button>"; }).join("") + (l.length > 12 ? "<span>and " + (l.length - 12) + " more</span>" : "") + "</div>";
  }

  // ---- the list (phone and tablet): the week day by day; a month calendar ----
  function listHtml() {
    var h = '<div class="shf-week">', today = ymd(new Date());
    keys().forEach(function (key, i) {
      var d = parse(key), oh = hoursFor(key);
      var day = S.shifts.filter(function (x) { return x.shift_date === key && roleOk(person(x.staff_id)); });
      var away = S.leaves.filter(function (l) { var st = low(l.status); return (st === "approved" || st === "pending") && l.start_date <= key && l.end_date >= key && roleOk(person(l.staff_id)); });
      var gaps = oh.gaps, nm = DAY[i] + " " + d.getDate() + " " + MON[d.getMonth()];
      var info = d.getDate() + " " + MON[d.getMonth()] + " · " + (oh.closed ? oh.words : oh.open + "–" + oh.close + (oh.holiday ? " · Public holiday (" + oh.holiday + ")" : "")) + (day.length ? " · " + day.length + (day.length === 1 ? " shift" : " shifts") : "");
      var pk = S.pick && S.pickWho, ticked = pk && S.sel[S.pickWho + "|" + key];
      h += '<section class="shf-day' + (key === today ? " today" : "") + (gaps.length ? " gap" : "") + (oh.closed ? " shut" : "") + '" id="shf-d-' + key + '" aria-label="' + esc(nm) + '"><div class="h">' +
        (pk ? '<label class="tk"><input type="checkbox" data-tick="pd" data-date="' + key + '"' + (ticked ? " checked" : "") + "><b>" + (key === today ? "Today" : DAY[i]) + "</b></label>" : "<b>" + (key === today ? "Today" : DAY[i]) + "</b>") + "<span>" + esc(info) + "</span></div>";
      var gapRows = S.form && S.form.gap && S.form.date === key ? [] : gaps.map(function (g) { return { at: g.from, h: gapHtml(key, g, nm) }; });
      h += inTime(day, gapRows, function (x) {
        if (S.form && S.form.mode === "edit" && Number(S.form.id) === Number(x.id)) return formHtml(key);
        var p = person(x.staff_id), off = approvedOn(x.staff_id, key), asked = !off && pendingOn(x.staff_id, key), picked = S.pick && S.sel[x.staff_id + "|" + key];
        var sub = [x.role_override ? desig({ designation: x.role_override }) : desig(p), x.notes].filter(Boolean).map(esc).join(" · ");
        return '<button class="shf-p' + (picked ? " picked" : "") + '" data-act="' + (S.pick ? "pickrow" : "edit") + '" data-id="' + x.id + '"' + (S.pick ? ' aria-pressed="' + !!picked + '"' : "") + ' aria-label="' + (S.pick ? "Select " : "Change ") + esc(p.full_name) + "'s shift, " + esc(hm(x.start_time)) + " to " + esc(hm(x.end_time)) + '">' + av(p.full_name) + '<span class="t"><b>' + esc(p.full_name) + "</b><span>" + (off ? '<span class="tag">On leave</span>' + (sub ? " · " : "") : asked ? '<span class="tag">Asked for leave this day</span>' + (sub ? " · " : "") : "") + sub + "</span></span><em>" + esc(hm(x.start_time)) + "–" + esc(hm(x.end_time)) + '</em><span class="chev" aria-hidden="true"></span></button>';
      });
      h += away.map(function (l) {
        var p = person(l.staff_id);
        return '<div class="shf-p off">' + av(p.full_name, true) + '<div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(leaveLabel(l.leave_type)) + "</span></div><em>" + (low(l.status) === "pending" ? "Asked for leave" : "Away") + (l.start_time && l.start_date === key ? " from " + esc(hm(l.start_time)) : "") + "</em></div>";
      }).join("");
      if (oh.closed && oh.holiday && day.length) h += '<div class="shf-hol">' + esc(oh.holiday) + " is a public holiday: the pharmacy is closed unless its opening hours say it opens.</div>";
      if (S.form && S.form.mode === "add" && S.form.date === key) h += formHtml(key);
      else if (active().length && !S.pick) h += '<button class="shf-add" data-act="add" data-date="' + key + '" aria-label="Add a shift on ' + esc(nm) + '">+ Add shift</button>';
      h += "</section>";
    });
    return h + "</div>";
  }
  function calHtml() {
    var ks = keys(), today = ymd(new Date()), h = '<div class="shf-cal" role="grid" aria-label="' + esc(rangeLabel()) + '"><div role="row" style="display:contents">' + DAY.map(function (d) { return '<div class="dh" role="columnheader">' + d.slice(0, 3) + "</div>"; }).join("") + '</div><div role="row" style="display:contents">';
    for (var i = 0; i < dow(ks[0]); i++) h += '<div role="gridcell"></div>';
    ks.forEach(function (k) {
      var c = dayCover(k), n = S.shifts.filter(function (x) { return x.shift_date === k && roleOk(person(x.staff_id)); }).length;
      var words = longDay(k) + ": " + (c.closed ? c.words : (n ? plural(n, "shift") : "no shifts") + (c.gaps.length ? ", " + c.words : ""));
      h += '<div role="gridcell"><button class="' + (k === today ? "today " : "") + (c.gaps.length ? "gap " : "") + (c.closed ? "shut" : "") + '" data-act="calday" data-date="' + k + '" aria-label="' + esc(words) + '"><b>' + parse(k).getDate() + "</b><span" + (c.gaps.length ? ' class="g"' : "") + ">" + esc(c.closed ? "Closed" : c.gaps.length ? "Gap" : n ? n + " on" : "") + "</span></button></div>";
    });
    return h + "</div></div>";
  }

  // ---- the selection: cells "staffId|date"; the bar at the bottom says what is chosen and what can be done ----
  function selKeys() { return Object.keys(S.sel).filter(function (k) { return S.sel[k]; }); }
  function selCells() { return selKeys().map(function (k) { var p = k.split("|"); return { sid: Number(p[0]), date: p[1] }; }); }
  function setSel(map) { S.sel = map; applySel(); }
  function applySel() {
    var t = S.mount && S.mount.querySelector(".shf-grid");
    if (t) {
      var all = {}; Object.keys(S.selShown).concat(selKeys()).forEach(function (k) { all[k] = 1; });
      Object.keys(all).forEach(function (k) { var p = k.split("|"), td = t.querySelector('td.shf-c[data-sid="' + p[0] + '"][data-date="' + p[1] + '"]'); if (td) { td.classList.toggle("sel", !!S.sel[k]); td.setAttribute("aria-selected", String(!!S.sel[k])); } });
      var ks = keys(), list = rows();
      Array.prototype.forEach.call(t.querySelectorAll("input[data-tick=p]"), function (c) { var sid = c.getAttribute("data-sid"); c.checked = ks.every(function (k) { return S.sel[sid + "|" + k]; }); });
      Array.prototype.forEach.call(t.querySelectorAll("input[data-tick=d]"), function (c) { var k = c.getAttribute("data-date"); c.checked = list.length > 0 && list.every(function (p) { return S.sel[p.id + "|" + k]; }); });
    } else if (S.mount && !S.wide && S.pick) {
      Array.prototype.forEach.call(S.mount.querySelectorAll("input[data-tick=pd]"), function (c) { c.checked = !!S.sel[S.pickWho + "|" + c.getAttribute("data-date")]; });
      Array.prototype.forEach.call(S.mount.querySelectorAll("button.shf-p[data-act=pickrow]"), function (b) { var x = shiftById(b.getAttribute("data-id")); var on = !!(x && S.sel[x.staff_id + "|" + x.shift_date]); b.classList.toggle("picked", on); b.setAttribute("aria-pressed", String(on)); });
    }
    S.selShown = {}; selKeys().forEach(function (k) { S.selShown[k] = 1; });
    var bar = S.mount && S.mount.querySelector("#shf-bar"); if (bar) bar.outerHTML = barHtml(); else if (S.mount && (selKeys().length || S.pick)) { var host = S.mount.querySelector("#shf-barhost"); if (host) host.innerHTML = barHtml(); }
  }
  function shiftById(id) { return S.shifts.filter(function (x) { return Number(x.id) === Number(id); })[0] || null; }
  function selShifts() { return S.shifts.filter(function (x) { return S.sel[x.staff_id + "|" + x.shift_date]; }); }
  function barHtml() {
    var c = selCells(), n = c.length;
    if (!n && !(S.pick && !S.wide)) return '<div id="shf-bar" hidden></div>';
    var ppl = {}; c.forEach(function (x) { ppl[x.sid] = 1; }); var np = Object.keys(ppl).length, sh = selShifts().length;
    var h = '<div class="shf-bar" id="shf-bar" role="region" aria-label="Selected days">';
    if (S.pick && !S.wide) h += '<select data-k="pickwho" aria-label="Whose days">' + '<option value="">Whose days?</option>' + active().map(function (p) { return '<option value="' + p.id + '"' + (String(S.pickWho) === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + "</option>"; }).join("") + "</select>";
    h += '<b role="status">' + (n ? plural(n, "day") + (np > 1 ? " · " + np + " people" : "") + " selected" : S.pickWho ? "Tick the days" : "Choose whose days, then tick them") + "</b>";
    if (n) h += '<button class="shf-btn p" data-act="sel-hours">Set hours…</button><button class="shf-btn" data-act="sel-usual">Usual pattern</button><button class="shf-btn" data-act="sel-copy" title="Copy (Ctrl+C)">Copy</button>';
    if (S.clip && (n || S.cur)) h += '<button class="shf-btn" data-act="sel-paste" title="Paste (Ctrl+V)">Paste</button>';
    if (sh) h += '<button class="shf-btn d" data-act="sel-clear" title="Clear (Delete)">Clear ' + plural(sh, "shift") + "</button>";
    return h + '<button class="shf-btn" data-act="sel-none">' + (n ? "Cancel" : "Close") + "</button></div>";
  }
  function rect(a, b) { // every cell between two corners, people by the order on screen
    var list = rows().map(function (p) { return Number(p.id); }), ks = keys();
    var r0 = list.indexOf(a.sid), r1 = list.indexOf(b.sid), c0 = ks.indexOf(a.date), c1 = ks.indexOf(b.date), m = {};
    if (r0 < 0 || r1 < 0 || c0 < 0 || c1 < 0) return m;
    for (var r = Math.min(r0, r1); r <= Math.max(r0, r1); r++) for (var c = Math.min(c0, c1); c <= Math.max(c0, c1); c++) m[list[r] + "|" + ks[c]] = true;
    return m;
  }
  function focusCell(c) {
    if (!c) return; S.cur = { sid: Number(c.sid), date: c.date };
    var t = S.mount && S.mount.querySelector(".shf-grid"); if (!t) return;
    var old = t.querySelector('td.shf-c[tabindex="0"]'); if (old) old.setAttribute("tabindex", "-1");
    var td = t.querySelector('td.shf-c[data-sid="' + c.sid + '"][data-date="' + c.date + '"]'); if (td) { td.setAttribute("tabindex", "0"); td.focus(); }
  }
  function cellOf(el) { var td = el && el.closest && el.closest("td.shf-c"); return td ? { sid: Number(td.getAttribute("data-sid")), date: td.getAttribute("data-date"), td: td } : null; }

  // ---- the screen ----
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "shfreg") return; // left before a reply came back: do not draw over the next screen
    if (S.form && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    S.wide = wide();
    var ae = document.activeElement, keepAct = ae && m.contains(ae) && !(ae.closest && ae.closest("form")) ? ae.getAttribute("data-act") : null; // the arrows keep focus across the redraw
    var keepCell = ae && m.contains(ae) ? cellOf(ae) : null, scr = m.querySelector(".shf-gw"), sx = scr ? scr.scrollLeft : 0, sy = scr ? scr.scrollTop : 0;
    var h = '<div class="shf' + (S.wide ? " wide" : "") + '">' + headHtml();
    if (S.loading && !Object.keys(S.staff).length) h += '<div role="status" aria-label="Opening the rota"><div class="shf-sk"></div><div class="shf-sk"></div></div>'; // the shape of the week, not a spinner
    else if (S.error) h += '<div class="shf-quiet" role="alert">' + esc(S.error) + '<button class="shf-btn" data-act="retry">Try again</button></div>';
    else {
      h += leaveBlock();
      if (!active().length && !S.who && !S.loading) S.who = newWho(); // an empty rota opens on the one thing to do: add the people who work here
      if (S.who) h += whoHtml();
      h += navHtml() + '<div id="shf-ext"></div>';
      if (S.undo) h += '<div class="shf-undo' + (S.undo.bad ? " bad" : "") + '" role="status"><span>' + esc(S.undo.words) + "</span>" + (S.undo.id ? '<button class="shf-btn" data-act="undo" data-u="' + esc(S.undo.id) + '">Undo</button>' : "") + '<button class="shf-btn" data-act="undo-x" aria-label="Close this message">×</button></div>';
      if (S.msg) h += '<div class="shf-warn shf-msg" role="alert" tabindex="-1">' + esc(S.msg) + "</div>";
      if (S.wide) h += gridHtml() + lookHtml();
      else if (S.view === "month") { computeLooks(); h += calHtml() + lookHtml(); }
      else { computeLooks(); h += listHtml() + lookHtml(); if (!S.who && active().length) h += '<div class="shf-card" style="margin-top:10px"><button class="shf-add" style="border-top:0" data-act="who" data-k="who">+ Add a person to the rota</button></div>'; }
      h += '<div id="shf-barhost">' + barHtml() + "</div>";
    }
    h += "</div>"; // nothing is left only in the classic screen: it stays under ⋯ (Classic Shifts screen)
    h += '<div id="shf-dlghost">' + dlgHtml() + "</div>";
    var oldDlg = S.dlg ? m.querySelector("#shf-dlghost") : null; // an open sheet (and any part mounted in it) stays as it is
    m.innerHTML = h;
    roPrune(m);
    if (oldDlg) { var nd = m.querySelector("#shf-dlghost"); if (nd) nd.replaceWith(oldDlg); }
    mountExt();
    S.selShown = {}; selKeys().forEach(function (k) { S.selShown[k] = 1; });
    var g2 = m.querySelector(".shf-gw"); if (g2 && scr) { g2.scrollLeft = sx; g2.scrollTop = sy; }
    if (keepAct && /^(prev|next|now)$/.test(keepAct)) { var kb = m.querySelector('[data-act="' + keepAct + '"]') || m.querySelector('[data-act="next"]'); if (kb) kb.focus(); }
    else if (keepCell && !S.form && !S.dlg) focusCell(keepCell);
    bindForms();
  }
  function bindForms() {
    var m = S.mount;
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
      f.addEventListener("submit", function (ev) { ev.preventDefault(); if (S.form && S.form.swap) swap(); else if (S.form && S.form.move) moveFromForm(); else save(); });
      f.addEventListener("change", function (ev) {
        var n = ev.target && ev.target.name;
        if (n === "swap_with" && S.form && S.form.swap) { keep(); S.form.swap.with = ev.target.value; paint(true); var w2 = m.querySelector("#shf-form [name=swap_with]"); if (w2) w2.focus(); }
        else if (n === "staff_id" && S.form && (ev.target.value === "new" || S.form.staff_id === "new" || roleRow(Object.assign({}, S.form, { staff_id: ev.target.value })) !== roleRow(S.form))) { keep(); paint(true); var s2 = m.querySelector("#shf-form [name=" + (S.form.staff_id === "new" ? "lc_name" : "staff_id") + "]"); if (s2) s2.focus(); }
      });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.saving) { ev.preventDefault(); ev.stopPropagation(); if (S.form && S.form.swap) { S.form.swap = null; paint(true); var sb3 = m.querySelector('#shf-form [data-act="swap"]'); if (sb3) sb3.focus(); } else if (S.form && S.form.move) { S.form.move = null; paint(true); var mb3 = m.querySelector('#shf-form [data-act="move"]'); if (mb3) mb3.focus(); } else if (S.form && S.form.confirmDel) { S.form.confirmDel = false; paint(true); var db3 = m.querySelector('#shf-form [data-act="del"]'); if (db3) db3.focus(); } else closeForm(); } }); // Escape steps back (focus stays in the form), then closes, as everywhere
    }
    var d = m.querySelector("#shf-dlgf"); if (d) d.addEventListener("submit", function (ev) { ev.preventDefault(); dlgNext(); });
  }
  // One set of listeners on the screen's mount, whatever is drawn inside it.
  // The mount is the app's content area, shared by every screen: each listener acts only while Plan shifts is on it.
  function bind(m) {
    if (m._shfBound) return; m._shfBound = true;
    var mine = function (fn) { return function (ev) { if (E.state.activeModuleId === "shfreg" && S.mount === m && m.querySelector(".shf")) return fn(ev); }; };
    m.addEventListener("click", mine(onClick));
    m.addEventListener("change", mine(onChange));
    m.addEventListener("input", mine(onInput));
    m.addEventListener("keydown", mine(onGridKey));
    m.addEventListener("mousedown", mine(onDown));
    m.addEventListener("mouseover", mine(onOver));
    m.addEventListener("dragstart", mine(onDragStart));
    m.addEventListener("dragover", mine(onDragOver));
    m.addEventListener("dragleave", mine(function (ev) { var c = cellOf(ev.target); if (c) c.td.classList.remove("drop"); }));
    m.addEventListener("drop", mine(onDrop));
    m.addEventListener("focusin", mine(function (ev) { var c = cellOf(ev.target); if (c) S.cur = { sid: c.sid, date: c.date }; })); // where Paste lands
  }
  function onClick(ev) {
    var b = ev.target && ev.target.closest && ev.target.closest("[data-act]");
    if (S.menu && !(ev.target.closest && ev.target.closest(".shf-menu"))) { S.menu = false; paint(true); if (!b) return; b = S.mount.querySelector('[data-act="' + b.getAttribute("data-act") + '"]') || b; }
    if (!b || !S.mount.contains(b) || b.closest(".rp, .rpo-panel, .rps-sheet, #shf-pp, #shf-pm, #shf-rp-ed, #shf-ext")) return; // the other parts' own buttons
    var m = S.mount, a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
    if (b.closest(".shf-grid") && (ev.shiftKey || ev.ctrlKey || ev.metaKey) && b.closest("td.shf-c")) return; // a selection click, handled on mousedown
    if (b.closest(".shf-grid") && ((S.drag && S.drag.moved) || Date.now() - (S.dragEnd || 0) < 350)) return; // the end of a drag is not a click
    if (!canPlan() && RO_ACTS[a]) { ev.preventDefault(); roMsg(); return; } // roles round: the worker refuses these too
    if (/^lv-(approve|refuse|keep-shifts|drop-shifts|trim|approve-yes|refuse-yes)$/.test(a)) { var lq = S.leaves.filter(function (l) { return Number(l.id) === id; })[0]; if (lq && !canAnswer(lq)) { S.lvMsg = "Nobody but an admin answers their own leave request."; paint(); return; } }
    if (a === "person" && !canPlan() && Number(b.getAttribute("data-sid")) !== meId()) { roMsg(); return; } // their own details only
    if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("shfreg") : "#team";
    else if (a === "retry") load();
    else if (a === "prev" || a === "next" || a === "now") { if (S.saving) return; step(a === "now" ? 0 : a === "prev" ? -1 : 1); }
    else if (a === "view") setView(b.getAttribute("data-v"));
    else if (a === "add") { S.msg = ""; var key = b.getAttribute("data-date"); S.form = addDefaults(key); paint(true); focus(S.form.staff_id ? "start_time" : "staff_id"); }
    else if (a === "edit") { S.msg = ""; var x = shiftById(id); if (!x) return; S.form = editForm(x); paint(true); focus("start_time"); }
    else if (a === "cancel") closeForm();
    else if (a === "del") { keep(); S.form.confirmDel = true; S.form.err = ""; paint(true); var y = m.querySelector('[data-act="del-no"]'); if (y) y.focus(); }
    else if (a === "del-no") { S.form.confirmDel = false; paint(true); }
    else if (a === "swap") { keep(); openSwap(); }
    else if (a === "swap-no") { S.form.swap = null; paint(true); var sb2 = m.querySelector('#shf-form [data-act="swap"]'); if (sb2) sb2.focus(); }
    else if (a === "swap-yes") swap();
    else if (a === "move") { keep(); S.form.move = { date: S.form.date, sid: S.form.staff_id }; S.form.err = ""; paint(true); var md = m.querySelector("#shf-form [name=mv_date]"); if (md) md.focus(); }
    else if (a === "mv-no") { S.form.move = null; paint(true); var mb = m.querySelector('#shf-form [data-act="move"]'); if (mb) mb.focus(); }
    else if (a === "mv-yes") moveFromForm();
    else if (a === "del-yes") remove();
    else if (a === "lv-approve") approveAsk(id);
    else if (a === "lv-keep-shifts") approveAsk(id, []);
    else if (a === "lv-drop-shifts") approveAsk(id, S.ask && S.ask.shifts || []);
    else if (a === "lv-trim") { var tp = S.ask && S.ask.plan; S.ask = Object.assign({}, S.ask, { trimPlan: tp }); approveAsk(id, [], tp); }
    else if (a === "lv-approve-yes") answer(id, "approve", S.ask && S.ask.drop, S.ask && S.ask.trim);
    else if (a === "lv-refuse") { S.ask = { id: id, kind: "refuse" }; paint(); var k = m.querySelector('[data-act="lv-keep"]'); if (k) k.focus(); }
    else if (a === "lv-refuse-yes") answer(id, "reject");
    else if (a === "lv-keep") { S.ask = null; paint(); }
    else if (a === "classic" || a === "to-classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "shfreg"); } catch (x2) {} E.openClassic("shifts"); }
    else if (a === "who") { S.who = newWho(); paint(true); var n = m.querySelector('#shf-who [name="full_name"]'); if (n) n.focus(); }
    else if (a === "who-done") closeWho();
    else if (a === "who-acc" && S.who) { var ac = (S.accounts || []).filter(function (u) { return String(u.id) === b.getAttribute("data-id"); })[0]; if (ac) { S.who.full_name = ac.full_name || ac.email; S.who.uid = ac.id; S.who.designation = ac.is_pharmacist ? "pharmacist" : (S.who.designation === "pharmacist" && active().some(isPharm) ? "assistant" : S.who.designation); paint(true); var sb = S.mount.querySelector('[data-k="who-add"]'); if (sb) sb.focus(); } }
    else if (a === "lv-new") { S.lvOpen = true; openLeave(); }
    else if (a === "lv-open") { S.lvOpen = true; paint(true); var la = S.mount.querySelector(".shf-lv [data-act=lv-approve]"); if (la) la.focus(); }
    else if (a === "fill") { if (S.saving) return; openGap(b.getAttribute("data-date"), { from: b.getAttribute("data-s"), to: b.getAttribute("data-e") }); }
    else if (a === "lv-cancel") closeLeave();
    else if (a === "menu") { S.menu = !S.menu; paint(true); var mi = m.querySelector(S.menu ? ".shf-menu .list button" : '[data-act="menu"]'); if (mi) mi.focus(); }
    else if (a === "undo") { S.menu = false; doUndo(b.getAttribute("data-u")); }
    else if (a === "m-hours" || a === "m-rules") { S.menu = false; paint(true); var mb0 = S.mount.querySelector('[data-act="menu"]'); if (mb0) mb0.focus(); E.rotaSet.open(a === "m-hours" ? "hours" : "rules", null, setCtx()); }
    else if (a === "dayhours") { if (E.rotaSet && E.rotaSet.open) E.rotaSet.open("day", b.getAttribute("data-date"), setCtx()); }
    else if (a === "print" || a === "m-cal") { S.menu = false; openPanel(a === "print" ? "print" : "cal"); }
    else if (a === "undo-x") { S.undo = null; paint(true); }
    else if (a === "jump") jump(b.getAttribute("data-date"), b.getAttribute("data-sid"));
    else if (a === "person") openPerson(Number(b.getAttribute("data-sid")));
    else if (a === "calday") { var dk = b.getAttribute("data-date"); S.view = "week"; S.monday = mondayOf(parse(dk)); store("eikon_shf_view", "week"); S.jumpTo = dk; S.shifts = []; load(); }
    else if (a === "pick") { S.pick = !S.pick; if (!S.pick) S.sel = {}; else if (!S.pickWho && active().length === 1) S.pickWho = String(active()[0].id); paint(true); var pb = m.querySelector(S.pick ? "#shf-bar select" : '[data-act="pick"]'); if (pb) pb.focus(); }
    else if (a === "pickrow") { var px = shiftById(id); if (px) { var kk = px.staff_id + "|" + px.shift_date, nm2 = Object.assign({}, S.sel); nm2[kk] = !nm2[kk]; if (!nm2[kk]) delete nm2[kk]; setSel(nm2); } }
    else if (a === "sel-none") { S.sel = {}; if (!S.wide) S.pick = false; S.anchor = null; paint(true); if (S.wide) focusCell(S.cur); }
    else if (a === "sel-hours") openFill("sel");
    else if (a === "sel-usual") openFill("selusual");
    else if (a === "sel-copy") copySel();
    else if (a === "sel-paste") openFill("paste");
    else if (a === "sel-clear") openFill("clear");
    else if (a === "fill-open") openFill("menu");
    else if (/^dlg-/.test(a)) dlgClick(a, b, ev);
  }
  function onChange(ev) {
    var t = ev.target; if (!t) return;
    var k = t.getAttribute && t.getAttribute("data-k"), tick = t.getAttribute && t.getAttribute("data-tick");
    if (k === "rotasid" && S.dlg) { S.dlg.f.sid = t.value; mountEd(); return; }
    if (k === "role") { S.role = t.value; store("eikon_shf_role", S.role || null); S.sel = {}; paint(true); var r = S.mount.querySelector('[data-k="role"]'); if (r) r.focus(); }
    else if (k === "pickwho") { var was = S.pickWho; S.pickWho = t.value; var ns = {}; selKeys().forEach(function (x) { var p = x.split("|"); if (p[0] === String(was)) ns[S.pickWho + "|" + p[1]] = true; else ns[x] = true; }); if (!S.pickWho) ns = {}; S.sel = ns; paint(true); var pw = S.mount.querySelector('[data-k="pickwho"]'); if (pw) pw.focus(); }
    else if (tick === "p" || tick === "d" || tick === "pd") {
      var ns2 = Object.assign({}, S.sel), on = t.checked, ks = keys(), list = rows();
      if (tick === "p") ks.forEach(function (d) { var kk = t.getAttribute("data-sid") + "|" + d; if (on) ns2[kk] = true; else delete ns2[kk]; });
      else if (tick === "d") list.forEach(function (p) { var kk = p.id + "|" + t.getAttribute("data-date"); if (on) ns2[kk] = true; else delete ns2[kk]; });
      else if (S.pickWho) { var kk2 = S.pickWho + "|" + t.getAttribute("data-date"); if (on) ns2[kk2] = true; else delete ns2[kk2]; }
      setSel(ns2);
    } else if (t.closest && t.closest("#shf-dlgf")) dlgChange(t);
  }
  function onInput(ev) { var t = ev.target; if (t && t.closest && t.closest("#shf-dlgf")) dlgInput(t); }

  // Mouse: press and drag across cells selects them; Shift-click extends from the last cell, Ctrl/Cmd-click adds one.
  // A plain click on a cell opens its shift (or a new one for that person and day). Dragging a shift moves it.
  function onDown(ev) {
    if (ev.button !== 0) return;
    var c = cellOf(ev.target); if (!c) return;
    if (!canPlan()) { ev.preventDefault(); roMsg(); return; } // roles round: a cell opens nothing to change
    var onChip = ev.target.closest && ev.target.closest(".shf-p");
    if (ev.shiftKey && S.anchor) { ev.preventDefault(); setSel(rect(S.anchor, c)); focusCell(c); return; }
    if (ev.ctrlKey || ev.metaKey) { ev.preventDefault(); var ns = Object.assign({}, S.sel), kk = c.sid + "|" + c.date; if (ns[kk]) delete ns[kk]; else ns[kk] = true; S.anchor = { sid: c.sid, date: c.date }; setSel(ns); focusCell(c); return; }
    if (onChip) return; // a click opens it; a drag moves it
    ev.preventDefault();
    S.drag = { a: { sid: c.sid, date: c.date }, moved: false };
    var up = function (e2) {
      document.removeEventListener("mouseup", up);
      var d = S.drag; S.drag = null; if (!d) return;
      if (d.moved) { S.dragEnd = Date.now(); return; }
      // a click: a new shift for this person on this day (when they work that day), else the cell's own shift
      S.anchor = d.a; if (selKeys().length) setSel({});
      cellClick(d.a);
    };
    document.addEventListener("mouseup", up);
  }
  function onOver(ev) {
    if (!S.drag) return; var c = cellOf(ev.target); if (!c) return;
    if (c.sid === S.drag.a.sid && c.date === S.drag.a.date && !S.drag.moved) return;
    S.drag.moved = true; S.anchor = S.drag.a; setSel(rect(S.drag.a, c)); S.cur = { sid: c.sid, date: c.date };
  }
  function cellClick(c) {
    var p = person(c.sid); S.cur = { sid: c.sid, date: c.date };
    var l = shiftsOf(c.sid, c.date);
    if (l.length === 1 && !S.form) { S.form = editForm(l[0]); paint(true); focus("start_time"); return; }
    if (Number(p.is_active) === 0) return;
    if (approvedOn(c.sid, c.date)) { S.msg = p.full_name + " is on approved leave on " + dayWords(c.date) + ". Answer or change the leave first."; paint(true); var mb = S.mount.querySelector(".shf-msg"); if (mb) mb.focus(); return; }
    S.msg = ""; S.form = addDefaults(c.date); S.form.staff_id = String(c.sid); S.form.row = c.sid;
    if (!S.last || Number(S.last.staff_id) !== Number(c.sid)) { var h0 = usualFor(p, c.date); if (h0) { S.form.start_time = h0.start; S.form.end_time = h0.end; } }
    paint(true); focus("start_time");
  }
  function onDragStart(ev) {
    var b = ev.target && ev.target.closest && ev.target.closest(".shf-grid .shf-p"); if (!b) return;
    if (!canPlan()) { ev.preventDefault(); return; }
    S.dragId = Number(b.getAttribute("data-id")); try { ev.dataTransfer.setData("text/plain", "shift:" + S.dragId); ev.dataTransfer.effectAllowed = "move"; } catch (e) {}
  }
  function onDragOver(ev) { if (S.dragId == null) return; var c = cellOf(ev.target); if (!c) return; ev.preventDefault(); c.td.classList.add("drop"); }
  function onDrop(ev) {
    var c = cellOf(ev.target), id = S.dragId; S.dragId = null; if (!c || id == null) return; ev.preventDefault(); c.td.classList.remove("drop");
    var x = shiftById(id); if (!x || (Number(x.staff_id) === c.sid && x.shift_date === c.date)) return;
    moveShift(x, c.sid, c.date);
  }
  // Keyboard in the grid: arrows move, Shift+arrows select, Space ticks a cell, Enter opens, Delete clears, Ctrl/Cmd+C/V copy
  // and paste, Escape lets go of the selection, Home/End the first/last day.
  function onGridKey(ev) {
    var t = ev.target;
    if (S.dlg && ev.key === "Escape") { ev.preventDefault(); closeDlg(); return; }
    if (S.menu && ev.key === "Escape") { ev.preventDefault(); S.menu = false; paint(true); var mb = S.mount.querySelector('[data-act="menu"]'); if (mb) mb.focus(); return; }
    var c = cellOf(t); if (!c || S.dlg) return;
    var list = rows().map(function (p) { return Number(p.id); }), ks = keys(), r = list.indexOf(c.sid), col = ks.indexOf(c.date), k = ev.key, mod = ev.ctrlKey || ev.metaKey;
    var mv = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] }[k];
    if (mv) {
      ev.preventDefault();
      var nr = Math.max(0, Math.min(list.length - 1, r + mv[0])), nc = Math.max(0, Math.min(ks.length - 1, col + mv[1])), to = { sid: list[nr], date: ks[nc] };
      if (ev.shiftKey) { if (!S.anchor) S.anchor = { sid: c.sid, date: c.date }; setSel(rect(S.anchor, to)); } else S.anchor = to;
      focusCell(to); return;
    }
    if (k === "Home" || k === "End") { ev.preventDefault(); focusCell({ sid: c.sid, date: ks[k === "Home" ? 0 : ks.length - 1] }); return; }
    if (!canPlan() && (k === " " || k === "Enter" || k === "Delete" || k === "Backspace" || (mod && /^[cva]$/i.test(k)) || (!mod && low(k) === "f"))) { ev.preventDefault(); if (k === "Enter" || k === "Delete" || k === "Backspace") roMsg(); return; } // roles round
    if (k === " ") { ev.preventDefault(); var ns = Object.assign({}, S.sel), kk = c.sid + "|" + c.date; if (ns[kk]) delete ns[kk]; else ns[kk] = true; S.anchor = { sid: c.sid, date: c.date }; setSel(ns); return; }
    if (k === "Enter") { ev.preventDefault(); if (t.classList && t.classList.contains("shf-p")) { var x = shiftById(t.getAttribute("data-id")); if (x) { S.form = editForm(x); paint(true); focus("start_time"); } } else cellClick(c); return; }
    if (k === "Escape" && selKeys().length) { ev.preventDefault(); setSel({}); return; }
    if (k === "Delete" || k === "Backspace") { ev.preventDefault(); if (!selKeys().length) { var one = {}; one[c.sid + "|" + c.date] = true; S.sel = one; } if (selShifts().length) openFill("clear"); return; }
    if (mod && low(k) === "c") { ev.preventDefault(); if (!selKeys().length) { var o2 = {}; o2[c.sid + "|" + c.date] = true; S.sel = o2; } copySel(); return; }
    if (mod && low(k) === "v") { ev.preventDefault(); if (S.clip) openFill("paste"); return; }
    if (!mod && !ev.altKey && /^[fwmt]$/i.test(k) && !(t.closest && t.closest("form"))) { ev.preventDefault(); if (low(k) === "f") openFill("menu"); else if (low(k) === "t") step(0); else setView(low(k) === "m" ? "month" : "week"); return; }
    if (mod && low(k) === "a") { ev.preventDefault(); var all = {}; list.forEach(function (sid) { ks.forEach(function (d) { all[sid + "|" + d] = true; }); }); setSel(all); return; }
  }
  // ← and → move a week (or month), as the arrows do, whenever no shift is open and the keys are not typing somewhere.
  // F opens Fill…, W and M switch between the week and the month, T goes back to today.
  function onKey(ev) {
    if (E.state.activeModuleId !== "shfreg" || !S.mount || !document.body.contains(S.mount) || S.form || S.who || S.lv || S.saving || S.dlg || ev.altKey || ev.ctrlKey || ev.metaKey || ev.shiftKey || ev.defaultPrevented) return;
    var a = document.activeElement; if (a && a !== document.body && !S.mount.contains(a)) return;
    if (a && (/^(INPUT|SELECT|TEXTAREA)$/.test(a.tagName) || (a.closest && a.closest(".shf-grid")))) return;
    if (document.querySelector(".eikon-modal-overlay[style*='flex'], .eks")) return;
    var k = ev.key;
    if (k === "ArrowLeft" || k === "ArrowRight") { ev.preventDefault(); S.ask = null; step(k === "ArrowLeft" ? -1 : 1); }
    else if (low(k) === "f" && active().length && canPlan()) { ev.preventDefault(); openFill("menu"); }
    else if (low(k) === "w" || low(k) === "m") { ev.preventDefault(); setView(low(k) === "m" ? "month" : "week"); }
    else if (low(k) === "t") { ev.preventDefault(); step(0); }
  }
  function step(n) {
    S.form = null; S.msg = ""; S.ask = null; S.sel = {}; S.anchor = null;
    if (S.view === "month") S.month = n === 0 ? new Date(new Date().getFullYear(), new Date().getMonth(), 1) : new Date(S.month.getFullYear(), S.month.getMonth() + n, 1);
    else S.monday = n === 0 ? mondayOf(new Date()) : plus(S.monday, 7 * n);
    syncRange(); S.shifts = []; load();
  }
  function syncRange() { if (S.view === "month") S.monday = mondayOf(S.month); else S.month = new Date(S.monday.getFullYear(), S.monday.getMonth(), 1); }
  function setView(v) {
    if (v === S.view) return;
    S.view = v === "month" ? "month" : "week"; store("eikon_shf_view", S.view); S.form = null; S.sel = {}; S.anchor = null;
    if (S.view === "month") { var t = new Date(), inWeek = t >= S.monday && t < plus(S.monday, 7); S.month = new Date((inWeek ? t : S.monday).getFullYear(), (inWeek ? t : S.monday).getMonth(), 1); }
    else { var t2 = new Date(); S.monday = t2.getFullYear() === S.month.getFullYear() && t2.getMonth() === S.month.getMonth() ? mondayOf(t2) : mondayOf(S.month); }
    S.shifts = []; load().then(function () { var b = S.mount && S.mount.querySelector('[data-act="view"][data-v="' + S.view + '"]'); if (b) b.focus(); });
  }
  function jump(date, sid) {
    if (S.wide && sid) { focusCell({ sid: Number(sid), date: date }); return; }
    if (S.wide) { var cv = S.mount.querySelector('[data-cov="' + date + '"] .shf-gap'); if (cv) cv.focus(); return; }
    var d = S.mount.querySelector("#shf-d-" + date); if (d) { d.setAttribute("tabindex", "-1"); d.focus(); if (d.scrollIntoView) try { d.scrollIntoView({ block: "start" }); } catch (e) {} }
  }

  // ---- parts from the other files: opening hours and rules sheets (E.rotaSet), print and calendar link (E.rotaPrint,
  // E.rotaCal), the "until changed" extend line (E.rotaPlan.ui.extendLine). Each keeps its own state across redraws. ----
  function setCtx() { return { staff: S.staff, leaves: S.leaves, canPlan: canPlan(), meId: meId(), isAdmin: isAdminU(), onSaved: function () { changed(); }, onGone: function () { changed(); } }; } // canPlan/meId/isAdmin: roles round
  function changed() { clearTimeout(S.chT); S.chT = setTimeout(function () { if (E.state.activeModuleId === "shfreg" && S.mount && document.body.contains(S.mount)) E.whenFormIdle(S.mount, load); }, 60); } // once, however many parts say so
  function mountExt() {
    var slot = S.mount.querySelector("#shf-ext"); if (!slot || !RP() || !RP().ui || !RP().ui.extendLine) return;
    if (!S.extEl) { S.extEl = document.createElement("div"); try { RP().ui.extendLine(S.extEl, { staff: Object.keys(S.staff).map(function (k) { return S.staff[k]; }), onDone: function () { refreshRange(); } }); } catch (e) {} }
    slot.appendChild(S.extEl);
  }
  function openPanel(what) {
    S.dlg = { kind: "panel", what: what, back: what === "print" ? '[data-act="print"]' : '[data-act="menu"]' }; paintDlg();
    var el = S.mount.querySelector("#shf-pm"); if (!el) return;
    var staffA = Object.keys(S.staff).map(function (k) { return S.staff[k]; }), mo = S.view === "month";
    var data = { staff: S.staff, shifts: S.shifts, leaves: S.leaves, hours: S.hours, settings: S.rules };
    try {
      if (what === "print") S.dlg.panel = E.rotaPrint.ui.panel(el, { monday: ymd(mo ? mondayOf(parse(defFrom())) : S.monday), month: ymd(mo ? S.month : plus(S.monday, 3)), staff: S.staff, data: { week: mo ? null : data, month: mo ? data : { staff: S.staff, leaves: S.leaves, hours: S.hours, settings: S.rules }, list: { staff: S.staff } }, onClose: closeDlg });
      else S.dlg.panel = E.rotaCal.ui.panel(el, { staff: staffA, me: E.rotaMe ? E.rotaMe(staffA) : null, manage: true, focus: true, monthOf: ymd(mo ? S.month : plus(S.monday, 3)), onClose: closeDlg });
    } catch (e) { el.textContent = "This could not open: " + (e && e.message || e); }
    dlgFocus();
  }

  // ---- Add a person to the rota: the classic "Add Employee" with what it sends for a name and a role ----
  // POST /shifts/staff {full_name, designation, employment_type, contracted_hours, email, phone, registration_number,
  // is_active, patterns_json}: full time 40 h (a locum is external, as the classic sets it), the rest empty.
  function newWho() { loadAccounts(); return { full_name: "", designation: active().some(isPharm) ? "assistant" : "pharmacist", err: "", saving: false, added: [], uid: null }; }
  // One list of people (W15): the admin picks the people who sign in here; the new rota person is linked to that sign-in
  // (POST /shifts/staff/:id/link) — nothing is merged or copied. Read once per visit, admins only (the route is theirs).
  function loadAccounts() {
    if (!isAdminU() || S.accounts || S.accountsP) return;
    S.accountsP = E.apiFetch("/team/users", { method: "GET" }).then(function (r) { S.accounts = (r && r.ok && r.users) || []; }, function () { S.accounts = []; })
      .then(function () { S.accountsP = null; fillAccounts(); });
  }
  // The list arrives while the name may be being typed: only its own slot is drawn (the form is not redrawn).
  function accountsHtml() {
    var w = S.who, l = freeAccounts(); if (!w || !l.length) return "";
    return '<div class="shf-acc" role="group" aria-label="People who sign in, not on the rota yet"><span>Sign in here, not on the rota yet:</span>' + l.map(function (u) { return '<button type="button" class="shf-chip" data-act="who-acc" data-id="' + u.id + '"' + (w.saving ? " disabled" : "") + ' aria-pressed="' + (String(w.uid) === String(u.id)) + '">' + esc(u.full_name || u.email) + "</button>"; }).join("") + "</div>" +
      '<datalist id="shf-acc-list">' + l.map(function (u) { return '<option value="' + esc(u.full_name) + '"></option>'; }).join("") + "</datalist>";
  }
  function fillAccounts() {
    var slot = S.mount && E.state.activeModuleId === "shfreg" ? S.mount.querySelector("#shf-acc-slot") : null; if (!slot) return;
    slot.innerHTML = accountsHtml();
    var n = S.mount.querySelector('#shf-who [name="full_name"]'); if (n) { if (freeAccounts().length) n.setAttribute("list", "shf-acc-list"); else n.removeAttribute("list"); }
  }
  function fold(n) { return E.rotaFold ? E.rotaFold(n) : low(n); }
  function freeAccounts() { // signs in here, switched on, not Eikon support, and not on the rota yet (by link or by name)
    var linked = {}, names = {}; Object.keys(S.staff).forEach(function (k) { var p = S.staff[k]; if (p.user_id != null) linked[p.user_id] = 1; names[fold(p.full_name)] = 1; });
    return (S.accounts || []).filter(function (u) { return u.is_active && !u.protected && !linked[u.id] && !names[fold(u.full_name)]; });
  }
  function accountFor(name) { var f = fold(name); if (!f) return null; var hit = freeAccounts().filter(function (u) { return fold(u.full_name) === f; }); return hit.length === 1 ? hit[0] : null; }
  function whoHtml() {
    var w = S.who, firstOne = !active().length;
    return '<div class="shf-card shf-who"><h2 id="shf-who-t">' + (firstOne ? "Who works here?" : "Add a person to the rota") + "</h2>" +
      "<p>" + (firstOne ? "Add each person once. Then plan their shifts on the week below." : "They can then be given shifts on any day.") + "</p>" +
      (w.added.length ? '<p class="ok" role="status">' + esc(w.added.join(", ")) + (w.added.length === 1 ? " is" : " are") + " on the rota. Add the next person, or press Done.</p>" : "") +
      '<div id="shf-acc-slot">' + accountsHtml() + "</div>" +
      '<form class="shf-form" id="shf-who" novalidate aria-labelledby="shf-who-t">' +
      '<label><span>Name</span><input name="full_name" value="' + esc(w.full_name) + '" autocomplete="off" enterkeyhint="done"' + (freeAccounts().length ? ' list="shf-acc-list"' : "") + (w.err ? ' aria-invalid="true" aria-describedby="shf-who-err"' : "") + (w.saving ? " disabled" : "") + "></label>" +

      '<label><span>Role</span><select name="designation"' + (w.saving ? " disabled" : "") + ">" + Object.keys(DESIG).map(function (k) { return '<option value="' + k + '"' + (w.designation === k ? " selected" : "") + ">" + DESIG[k] + "</option>"; }).join("") + "</select></label>" +
      (w.err ? '<div class="shf-err" role="alert" id="shf-who-err">' + esc(w.err) + "</div>" : "") +
      '<div class="acts">' + (w.added.length || !firstOne ? '<button type="button" class="shf-btn" data-act="who-done" data-k="who-done">Done</button>' : "") +
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
    var acc = (w.uid && (S.accounts || []).filter(function (u) { return String(u.id) === String(w.uid) && fold(u.full_name) === fold(name); })[0]) || accountFor(name); // the sign-in this person is
    w.err = ""; w.saving = true; paint(true);
    try {
      var listP = async function () { var r = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }); return (r && r.staff) || []; };
      var made = await E.postOnce("/shifts/staff", body, { list: listP,
        same: function (p) { return String(p.full_name) === name; } });
      if (acc) { // link it (the same body as before was saved; the link is its own call)
        try {
          var sid = made && made.staff_id; if (!sid) { var f0 = (await listP()).filter(function (p) { return String(p.full_name) === name && p.user_id == null; }).pop(); sid = f0 && f0.id; }
          var lk = sid ? await E.apiFetch("/shifts/staff/" + encodeURIComponent(sid) + "/link", { method: "POST", body: JSON.stringify({ user_id: acc.id }) }) : null;
          if (!lk || !lk.ok) throw new Error((lk && lk.error) || "not linked");
        } catch (eL) { E.toast(name + " is on the rota, but not linked to their sign-in. Link them in People who sign in.", "warn"); }
      }
      w.uid = null;
      w.saving = false; w.added.push(name); w.full_name = ""; w.designation = isPharm({ designation: w.designation }) ? "assistant" : w.designation;
      E.toast(name + " added to the rota", "success");
      await reloadStaff(); // just the people: the week stays as it is
      paint(true);
      var n = S.mount && S.mount.querySelector('#shf-who [name="full_name"]'); if (n) n.focus(); // ready for the next person
    } catch (e) {
      w.saving = false; w.err = E.saveFailText(e); paint(true);
      var b = S.mount && S.mount.querySelector('[data-k="who-add"]'); if (b) b.focus();
    }
  }
  async function reloadStaff() { try { var st = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }); if (st && st.ok) { S.staff = {}; (st.staff || []).forEach(function (p) { S.staff[p.id] = p; }); } } catch (e1) {} }

  // ---- A new leave request: the classic Leave tab's "Submit Leave Request" (modules.shifts.js submitLeave) ----
  // POST /shifts/leaves {staff_id, leave_type, start_date, start_time|null, end_date, end_time|null, hours_requested,
  // reason, status:"pending"}, hours worked out as there: a part day is its hours, else 8 for each weekday. Locum
  // pharmacists are self-employed and take no leave: they are left out, as the classic screen refuses them.
  function leavers() { return active().filter(function (p) { return low(p.designation) !== "locum"; }); }
  function t2m(t) { if (!t) return 0; var p = t.split(":"); return +p[0] * 60 + (+p[1] || 0); } // as the classic screen
  function wdCount(s, e) { var n = 0, dt = new Date(s), end = new Date(e); while (dt <= end) { var wd = dt.getDay(); if (wd !== 0 && wd !== 6) n++; dt.setDate(dt.getDate() + 1); } return n; } // as the classic screen
  function leaveBody(v) {
    var sid = parseInt(v.staff_id), sd = v.start_date, st = v.start_time, ed = v.end_date || sd, et = v.end_time, h0 = 0;
    if (st && et) h0 = (t2m(et) - t2m(st)) / 60; else h0 = wdCount(sd, ed) * 8;
    return { staff_id: sid, leave_type: v.leave_type, start_date: sd, start_time: st || null, end_date: ed, end_time: et || null, hours_requested: Math.max(0, +h0.toFixed(1)), reason: String(v.reason || "").trim(), status: "pending" };
  }
  function openLeave() {
    var mine = meId(), one = leavers().length === 1 ? String(leavers()[0].id) : mine != null && leavers().some(function (p) { return Number(p.id) === mine; }) ? String(mine) : ""; // Who = you (roles round)
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
    var oh = hoursFor(key), L = S.last, near = oh.closed ? [1, 2, 3, 4, 5, 6].map(function (i) { return hoursFor(addDays(key, -i)); }).filter(function (c) { return !c.closed; })[0] : null;
    var f = { mode: "add", date: key, staff_id: "", start_time: hm(oh.open || (near && near.open)) || "09:00", end_time: hm(oh.close || (near && near.close)) || "18:00", notes: "", role_override: "", err: "", warn: "", warnSig: "", row: null };
    if (L) {
      f.start_time = L.start_time; f.end_time = L.end_time;
      var p = S.staff[L.staff_id], taken = S.shifts.some(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(L.staff_id); });
      if (p && Number(p.is_active) !== 0 && !approvedOn(L.staff_id, key) && !taken) f.staff_id = String(L.staff_id);
    }
    return f;
  }
  // ---- Swap two shifts: each person takes the other's shift, on the same day or on two days of the week ----
  // The writes are the ones a person makes by hand:
  //  - same day: two changes, each the shift's whole record with start and end swapped (as Save sends it);
  //  - two days: the server keeps a shift's person and day, so each shift is moved as it is by hand: + Add shift's body
  //    for the other person ({staff_id, shift_date, start_time, end_time, notes}, then Save's whole record when they had a
  //    role of their own), and Remove shift for the old one. Both new shifts are added before either old one is removed.
  // One rule for both: each person takes the other's hours and keeps their own note and role.
  // If a write fails, what already went through is undone (each undo first reads the day, so a write whose answer was
  // lost is undone too) and the screen says so plainly.
  function swapList(f) {
    var ks = keys(), lo = ks[0], hi = ks[ks.length - 1], wk0 = ymd(mondayOf(parse(f.date))), wk1 = addDays(wk0, 6);
    return S.shifts.filter(function (x) { return Number(x.id) !== Number(f.id) && Number(x.staff_id) !== Number(f.staff_id) && x.shift_date >= lo && x.shift_date <= hi && x.shift_date >= wk0 && x.shift_date <= wk1; })
      .sort(function (a, b) { return (a.shift_date === f.date ? 0 : 1) - (b.shift_date === f.date ? 0 : 1) || String(a.shift_date).localeCompare(String(b.shift_date)) || String(a.start_time).localeCompare(String(b.start_time)); });
  }
  function swapCheck(f, other) {
    var mine = shiftById(f.id); if (!mine || !other) return { err: "Choose the shift to swap with." };
    var A = person(mine.staff_id), B = person(other.staff_id), d1 = mine.shift_date, d2 = other.shift_date, same = d1 === d2;
    if (approvedOn(mine.staff_id, d2)) return { err: A.full_name + " is on approved leave " + (same ? "that day." : "on " + dayWords(d2) + "."), why: first(A) + " is on leave then" };
    if (approvedOn(other.staff_id, d1)) return { err: B.full_name + " is on approved leave " + (same ? "that day." : "on " + dayWords(d1) + "."), why: "on leave " + (same ? "that day" : dayWords(d1)) };
    var clash = function (sid, key, st, et) { return S.shifts.filter(function (x) { return x.shift_date === key && Number(x.staff_id) === Number(sid) && Number(x.id) !== Number(mine.id) && Number(x.id) !== Number(other.id) && mins(x.start_time) < mins(et) && mins(x.end_time) > mins(st); })[0]; };
    var ca = clash(mine.staff_id, d2, other.start_time, other.end_time), cb = clash(other.staff_id, d1, mine.start_time, mine.end_time);
    if (ca) return { err: A.full_name + " already works " + hm(ca.start_time) + "–" + hm(ca.end_time) + (same ? " that day." : " on " + dayWords(d2) + "."), why: first(A) + " already works then" };
    if (cb) return { err: B.full_name + " already works " + hm(cb.start_time) + "–" + hm(cb.end_time) + (same ? " that day." : " on " + dayWords(d1) + "."), why: "already works " + (same ? "then" : dayWords(d1)) };
    // Afterwards each shift has the other person (with their role and note): the cover of both days is checked again.
    var after = S.shifts.map(function (x) {
      if (Number(x.id) === Number(mine.id)) return Object.assign({}, x, { staff_id: other.staff_id, role_override: other.role_override || "" });
      if (Number(x.id) === Number(other.id)) return Object.assign({}, x, { staff_id: mine.staff_id, role_override: mine.role_override || "" });
      return x;
    });
    var gaps = (same ? [d1] : [d1, d2].sort()).map(function (key) {
      var was = dayCover(key).gaps, now = dayCover(key, after);
      var worse = now.gaps.some(function (g) { return !was.some(function (o) { return o.from <= g.from && o.to >= g.to; }); }); // hours with no pharmacist that had one before
      return worse ? now.words.replace(/^No/, "no") + (same ? "" : " on " + dayWords(key)) : "";
    }).filter(Boolean);
    // As when a shift is added by hand: a pharmacist put on at the same time as another pharmacist is said first.
    var both = function (who, key, slot) {
      if (!(isPharm(person(who.staff_id)) || String(who.role_override || "") === "pharmacist")) return [];
      return S.shifts.filter(function (x) { return x.shift_date === key && Number(x.id) !== Number(mine.id) && Number(x.id) !== Number(other.id) && (isPharm(person(x.staff_id)) || String(x.role_override || "") === "pharmacist") && mins(x.start_time) < mins(slot.end_time) && mins(x.end_time) > mins(slot.start_time); });
    };
    var ov = both(mine, d2, other).concat(both(other, d1, mine)).map(function (x) { return person(x.staff_id).full_name + " " + (same ? "" : dayWords(x.shift_date) + " ") + hm(x.start_time) + "–" + hm(x.end_time); });
    return { mine: mine, other: other, A: A, B: B, same: same, gap: gaps.join(" and "), both: ov.join(", ") };
  }
  function swapSentence(c) {
    var w = function (x) { return (c.same ? "" : dayWords(x.shift_date) + " ") + hm(x.start_time) + "–" + hm(x.end_time); };
    return c.A.full_name + " works " + w(c.other) + " and " + c.B.full_name + " works " + w(c.mine) + ".";
  }
  function swapHtml(key) {
    var f = S.form, list = swapList(f), c = f.swap.with ? swapCheck(f, list.filter(function (x) { return String(x.id) === String(f.swap.with); })[0]) : null;
    // Each choice says its day (the group label only shows while the list is open); one that cannot happen is greyed
    // out with the reason, so the list offers only swaps that can be made.
    var opt = function (x) {
      var cc = String(f.swap.with) === String(x.id) ? {} : swapCheck(f, x), no = !!cc.err, why = no ? " · " + cc.why : "";
      return '<option value="' + x.id + '"' + (String(f.swap.with) === String(x.id) ? " selected" : "") + (no ? " disabled" : "") + ">" + esc((x.shift_date === key ? "" : dayWords(x.shift_date) + " · ") + person(x.staff_id).full_name + " " + hm(x.start_time) + "–" + hm(x.end_time) + why) + "</option>";
    };
    var days = []; list.forEach(function (x) { if (days.indexOf(x.shift_date) < 0) days.push(x.shift_date); });
    var h = '<label class="q sw"><span>Swap with</span><select name="swap_with"' + (S.saving ? " disabled" : "") + '><option value="">Choose a shift</option>' +
      days.map(function (d) { return '<optgroup label="' + esc(d === key ? "Same day" : DAY[(parse(d).getDay() + 6) % 7] + " " + short(d)) + '">' + list.filter(function (x) { return x.shift_date === d; }).map(opt).join("") + "</optgroup>"; }).join("") + "</select></label>";
    if (c && c.err) h += '<span class="q shf-swq bad" role="alert">' + esc(c.err) + "</span>";
    else if (c) h += '<span class="q shf-swq" role="status">' + esc(swapSentence(c)) + (c.gap ? ' <b>This leaves ' + esc(c.gap) + ".</b>" : "") + (c.both ? " <b>Another pharmacist is already on then: " + esc(c.both) + ".</b>" : "") + "</span>";
    h += '<button type="button" class="shf-btn" data-act="swap-no">Keep as is</button><button type="button" class="shf-btn p" data-act="swap-yes"' + (S.saving || !c || c.err ? " disabled" : "") + ">" + (S.saving ? "Swapping…" : c && (c.gap || c.both) ? "Swap anyway" : "Swap shifts") + "</button>";
    return h;
  }
  async function swap() {
    var f = S.form; if (S.saving || !f || !f.swap || !f.swap.with) return;
    var c0 = swapCheck(f, shiftById(f.swap.with)); if (!c0 || c0.err) return;
    S.saving = true; f.err = ""; paint(true);
    if (c0.same) await swapSameDay(f, c0); else await swapDays(f, c0);
    S.saving = false; await refreshDay(c0.mine.shift_date, c0.other.shift_date);
    if (S.form && !shiftById(S.form.id)) { // undone by adding it back: the same shift under its new number
      var back = S.shifts.filter(function (x) { return x.shift_date === c0.mine.shift_date && Number(x.staff_id) === Number(c0.mine.staff_id) && hm(x.start_time) === hm(c0.mine.start_time) && hm(x.end_time) === hm(c0.mine.end_time); })[0];
      if (back) { S.form.id = back.id; paint(true); } else { S.msg = S.form.err; S.form = null; paint(true); } // its shift is gone: what is left is said above the week
    }
    if (!S.form) {
      var mb = S.msg && S.mount && S.mount.querySelector(".shf-msg"), now = S.shifts.filter(function (x) { return x.shift_date === c0.mine.shift_date && Number(x.staff_id) === Number(c0.other.staff_id) && hm(x.start_time) === hm(c0.mine.start_time) && hm(x.end_time) === hm(c0.mine.end_time); })[0];
      var row = !mb && S.mount && (c0.same ? S.mount.querySelector('.shf-p[data-id="' + c0.mine.id + '"]') : now && S.mount.querySelector('.shf-p[data-id="' + now.id + '"]'));
      if (mb) mb.focus(); else if (row) row.focus(); else refocus(f);
    }
    else { var sy = S.mount && S.mount.querySelector('#shf-form [data-act="swap-yes"]'); if (sy) E.focusIfIdle(sy, E.lastAction(), null); } // not swapped: the button to try again
  }
  var whole = function (x, from) { return { id: x.id, staff_id: x.staff_id, shift_date: x.shift_date, start_time: hm(from.start_time), end_time: hm(from.end_time), role_override: x.role_override || "", notes: x.notes || "" }; }; // Save's body
  var putShift = async function (b) { var r = await E.apiFetch("/shifts/assignments/" + b.id, { method: "PUT", body: JSON.stringify(b) }); if (!r || !r.ok) throw new Error((r && r.error) || "Save failed"); };
  var delShift = async function (id) { var r = await E.apiFetch("/shifts/assignments/" + id, { method: "DELETE" }); if (!r || !r.ok) throw new Error((r && r.error) || "Not removed"); };
  // A shift as + Add shift sends it, then Save's whole record when it carries a role. undo (a list) gets a step that
  // takes it off again, even if its answer was lost. -> the new shift's id
  async function addAs(staffId, key, slot, src, before, undo) { // slot: the hours; src: the note and role
    var body = { staff_id: Number(staffId), shift_date: key, start_time: hm(slot.start_time), end_time: hm(slot.end_time), notes: src.notes || "" };
    var isIt = function (x) { return Number(x.staff_id) === body.staff_id && x.shift_date === key && hm(x.start_time) === body.start_time && hm(x.end_time) === body.end_time && before.indexOf(Number(x.id)) < 0; };
    if (undo) undo.push(async function () { var l = (await dayList(key)).filter(isIt); for (var i = 0; i < l.length; i++) await delShift(l[i].id); return l.length > 0; });
    var r = await E.postOnce("/shifts/assignments", body, { list: function () { return dayList(key); }, same: isIt });
    if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
    var id = r.shift_id;
    if (src.role_override) {
      id = id || ((await dayList(key)).filter(isIt)[0] || {}).id; if (!id) throw new Error("the new shift could not be found");
      await putShift({ id: id, staff_id: body.staff_id, shift_date: key, start_time: body.start_time, end_time: body.end_time, role_override: src.role_override, notes: body.notes });
    }
    return id;
  }
  async function swapSameDay(f, c0) {
    var key = f.date, a = null, b = null, done1 = false;
    try {
      var day = await dayList(key); // as they are now, in case another till changed them
      a = day.filter(function (x) { return Number(x.id) === Number(c0.mine.id); })[0]; b = day.filter(function (x) { return Number(x.id) === Number(c0.other.id); })[0];
      if (!a || !b) throw new Error("one of the two shifts was removed on another till");
      await putShift(whole(a, b)); done1 = true;
      await putShift(whole(b, a));
      S.form = null; E.toast("Shifts swapped: " + c0.A.full_name + " " + hm(b.start_time) + "–" + hm(b.end_time) + ", " + c0.B.full_name + " " + hm(a.start_time) + "–" + hm(a.end_time), "success");
    } catch (x) {
      var why = E.saveFailText(x).replace(/^Not saved/, "Not swapped");
      if (done1) { try { await putShift(whole(a, a)); why += " " + c0.A.full_name + "’s shift is back to " + hm(a.start_time) + "–" + hm(a.end_time) + "."; } catch (y) { why = "Only half of the swap went through: " + c0.A.full_name + " now works " + hm(b.start_time) + "–" + hm(b.end_time) + " and " + c0.B.full_name + "’s shift did not change. Change one of them by hand."; } }
      f.err = why;
    }
  }
  async function swapDays(f, c0) {
    var d1 = c0.mine.shift_date, d2 = c0.other.shift_date, undo = [], a = null, b = null;
    var removeOld = async function (x) {
      undo.push(async function () { var l = await dayList(x.shift_date); if (l.some(function (y) { return Number(y.id) === Number(x.id); })) return false; await addAs(x.staff_id, x.shift_date, x, x, l.map(function (y) { return Number(y.id); }), null); return true; }); // put back as it was
      await delShift(x.id);
    };
    try {
      var lists = await Promise.all([dayList(d1), dayList(d2)]); // as they are now, in case another till changed them
      a = lists[0].filter(function (x) { return Number(x.id) === Number(c0.mine.id); })[0]; b = lists[1].filter(function (x) { return Number(x.id) === Number(c0.other.id); })[0];
      if (!a || !b) throw new Error("one of the two shifts was removed on another till");
      var ids = function (l) { return l.map(function (x) { return Number(x.id); }); };
      await addAs(b.staff_id, d1, a, b, ids(lists[0]), undo);
      await addAs(a.staff_id, d2, b, a, ids(lists[1]), undo);
      await removeOld(a);
      await removeOld(b);
      S.form = null; E.toast("Shifts swapped: " + c0.B.full_name + " " + dayWords(d1) + " " + hm(a.start_time) + "–" + hm(a.end_time) + ", " + c0.A.full_name + " " + dayWords(d2) + " " + hm(b.start_time) + "–" + hm(b.end_time), "success");
    } catch (x) {
      var why = E.saveFailText(x).replace(/^We could not tell if it was saved\. Check the list before trying again\./, "Not saved: the connection dropped."); if (!/[.!?]$/.test(why)) why += ".";
      var stuck = false, steps = undo.splice(0);
      for (var i = steps.length - 1; i >= 0; i--) { try { await steps[i](); } catch (y) { stuck = true; } } // newest first; one that fails does not stop the rest
      f.err = stuck ? await leftWords(c0, why) : "Nothing was changed — " + why;
    }
  }
  // An undo that failed too: the two days are read once more and the screen says exactly who is on them now.
  async function leftWords(c0, why) {
    var d1 = c0.mine.shift_date, d2 = c0.other.shift_date, l;
    try { l = (await Promise.all([dayList(d1), dayList(d2)])).reduce(function (a, b) { return a.concat(b); }, []); }
    catch (e) { return "Only part of the swap went through, and it could not be put back (" + why.replace(/\.$/, "") + "). Look at " + dayWords(d1) + " and " + dayWords(d2) + " below and change them by hand."; }
    var slot = function (x) { return (x.shift_date === d1 && hm(x.start_time) === hm(c0.mine.start_time) && hm(x.end_time) === hm(c0.mine.end_time)) || (x.shift_date === d2 && hm(x.start_time) === hm(c0.other.start_time) && hm(x.end_time) === hm(c0.other.end_time)); };
    var on = function (p) { var w = l.filter(function (x) { return Number(x.staff_id) === Number(p.id) && slot(x); }).sort(function (a, b) { return a.shift_date < b.shift_date ? -1 : 1; }).map(function (x) { return dayWords(x.shift_date) + " " + hm(x.start_time) + "–" + hm(x.end_time); }); return p.full_name + (w.length ? " is now on " + w.join(" and ") : " is now on neither day"); };
    return "Only part of the swap went through, and it could not be put back: " + on(c0.A) + "; " + on(c0.B) + ". Remove or add one here so each day is right.";
  }
  // ---- Move a shift to another day or person: + Add shift's body there (and Save's for its role), then Remove for the
  // old one; undone the same way. The swap's machinery: a failure half way puts back what went through. ----
  function moveFromForm() {
    var f = S.form; if (!f || !f.move || S.saving) return;
    var fm = S.mount.querySelector("#shf-form"), d = fm && fm.querySelector("[name=mv_date]"), w = fm && fm.querySelector("[name=mv_sid]");
    f.move.date = d ? d.value : f.move.date; f.move.sid = w ? w.value : f.move.sid;
    var x = shiftById(f.id); if (!x) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(f.move.date)) { f.err = "Choose the day to move it to. Nothing was moved."; paint(true); return; }
    if (f.move.date === x.shift_date && Number(f.move.sid) === Number(x.staff_id)) { f.err = "That is where it is now. Choose another day or person."; paint(true); return; }
    moveShift(x, Number(f.move.sid), f.move.date);
  }
  async function moveShift(x, sid, date, quiet) {
    var p = person(sid), from = person(x.staff_id);
    if (approvedOn(sid, date)) { var w0 = p.full_name + " is on approved leave on " + dayWords(date) + ". Nothing was moved."; if (S.form) { S.form.err = w0; paint(true); } else { S.msg = w0; paint(true); } return false; }
    if (S.shifts.some(function (y) { return y.shift_date === date && Number(y.staff_id) === Number(sid) && Number(y.id) !== Number(x.id) && mins(y.start_time) < mins(x.end_time) && mins(y.end_time) > mins(x.start_time); })) { var w1 = p.full_name + " already works then on " + dayWords(date) + ". Nothing was moved."; if (S.form) { S.form.err = w1; paint(true); } else { S.msg = w1; paint(true); } return false; }
    S.saving = true; if (S.form) { S.form.err = ""; paint(true); }
    var undo = [], ok = false, newId = null, why = "";
    try {
      var day = await dayList(date), src = (await dayList(x.shift_date)).filter(function (y) { return Number(y.id) === Number(x.id); })[0];
      if (!src) throw new Error("this shift was removed on another till");
      newId = await addAs(sid, date, src, src, day.map(function (y) { return Number(y.id); }), undo);
      await delShift(src.id); ok = true;
    } catch (e) {
      why = E.saveFailText(e); for (var i = undo.length - 1; i >= 0; i--) { try { await undo[i](); } catch (y) { why += " The copy on " + dayWords(date) + " could not be taken off: remove it by hand."; } }
    }
    S.saving = false;
    if (ok) {
      var words = "Moved " + first(from) + "’s " + hm(x.start_time) + "–" + hm(x.end_time) + " from " + dayWords(x.shift_date) + " to " + (Number(sid) !== Number(x.staff_id) ? p.full_name + " on " : "") + dayWords(date);
      var rec = remember({ words: words, kind: "move", back: { id: newId, date: date, sid: Number(sid), to: { sid: Number(x.staff_id), date: x.shift_date } } });
      S.undo = { id: rec.id, words: words }; S.form = null;
    } else if (S.form) S.form.err = "Not moved: " + why.replace(/^Not saved: /, ""); else S.msg = "Not moved: " + why.replace(/^Not saved: /, "");
    if (ok && !quiet) { await refreshDay(x.shift_date, date); focusCell({ sid: sid, date: date }); }
    else if (!ok) paint(true);
    return ok;
  }
  function editForm(x) { return { mode: "edit", id: x.id, date: x.shift_date, staff_id: x.staff_id, start_time: hm(x.start_time), end_time: hm(x.end_time), notes: x.notes || "", role_override: x.role_override || "", err: "", warn: "", warnSig: "", row: x.staff_id }; }
  function openSwap() {
    var l = swapList(S.form); S.form.swap = { with: l.length === 1 ? String(l[0].id) : "" }; S.form.err = ""; paint(true);
    var sw = S.mount && S.mount.querySelector("#shf-form [name=swap_with]"); if (sw) { sw.focus(); if (sw.scrollIntoView) try { sw.scrollIntoView({ block: "nearest" }); } catch (e) {} }
  }
  // Fill a gap: a new shift on that day for the gap's hours, the first free pharmacist already chosen (Add shift saves it).
  function openGap(key, g) {
    S.form = addDefaults(key); var f = S.form, who = fillers(key, g)[0];
    f.gap = g; f.start_time = g.from; f.end_time = g.to; f.staff_id = who ? String(who.id) : "";
    paint(true); focus(who ? "start_time" : "staff_id");
    var el = S.mount && S.mount.querySelector("#shf-form"); if (el && el.scrollIntoView) try { el.scrollIntoView({ block: "nearest" }); } catch (e) {}
    var sb = S.mount && S.mount.querySelector('#shf-form button[type=submit]'); if (who && sb) sb.focus(); // the next tap is Add shift
  }
  // Close the form and put focus back where it was opened from: the shift's row, the cell, or the day's "+ Add shift".
  function closeForm() {
    var f = S.form; S.form = null; paint(true); refocus(f);
  }
  function refocus(f) {
    if (!f || !S.mount) return;
    var el = (f.mode === "edit" && S.mount.querySelector('.shf-p[data-act="edit"][data-id="' + f.id + '"]')) || (f.row && S.mount.querySelector('td.shf-c[data-sid="' + f.row + '"][data-date="' + f.date + '"]')) || S.mount.querySelector('[data-act="add"][data-date="' + f.date + '"]');
    if (el && el.matches && el.matches("td.shf-c")) { focusCell({ sid: f.row, date: f.date }); return; }
    if (el) { try { el.focus({ preventScroll: false }); } catch (e) { el.focus(); } }
  }
  function focus(n) { var now = S.mount && S.mount.querySelector("#shf-form [name=" + n + "]"); if (now) now.focus(); setTimeout(function () { var x = S.mount && S.mount.querySelector("#shf-form [name=" + n + "]"); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) x.focus(); }, 30); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#shf-form"); if (!f || !S.form) return;
    ["staff_id", "start_time", "end_time", "notes", "role_override", "lc_name", "lc_phone", "lc_reg"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.form[k] = String(el.value || "").trim(); });
  }

  async function save() {
    if (S.saving || !S.form) return;
    keep();
    var f = S.form, key = f.date; f.err = "";
    var newLocum = f.mode === "add" && f.staff_id === "new";
    if (!f.staff_id) f.err = "Choose who works this shift. Nothing was saved.";
    else if (newLocum && !f.lc_name) f.err = "Write the locum’s name. Nothing was saved.";
    else if (!/^\d{2}:\d{2}$/.test(f.start_time) || !/^\d{2}:\d{2}$/.test(f.end_time)) f.err = "Choose when the shift starts and ends. Nothing was saved.";
    else if (mins(f.end_time) <= mins(f.start_time)) f.err = "The shift must end after it starts. Nothing was saved.";
    else if (f.mode === "add" && !newLocum && approvedOn(f.staff_id, key)) f.err = person(f.staff_id).full_name + " is on approved leave that day. Nothing was saved.";
    if (f.err) { paint(true); var bad = /locum’s name/.test(f.err) ? "lc_name" : /Choose who|on approved leave/.test(f.err) ? "staff_id" : /end after/.test(f.err) ? "end_time" : "start_time"; var be = S.mount && S.mount.querySelector("#shf-form [name=" + bad + "]"); if (be) be.focus(); return; }
    if (newLocum || isPharm(person(f.staff_id)) || f.role_override === "pharmacist") { // two pharmacists at once is allowed, but only after a second press (as in the classic screen)
      var ov = overlaps(key, f.start_time, f.end_time, f.mode === "edit" ? f.id : null);
      var sig = ov.length ? [f.staff_id, f.start_time, f.end_time].concat(ov.map(function (x) { return x.id; })).join("|") : "";
      if (sig && f.warnSig !== sig) { f.warnSig = sig; f.warn = "Another pharmacist is already on then: " + ov.map(function (x) { return person(x.staff_id).full_name + " " + hm(x.start_time) + "–" + hm(x.end_time); }).join(", ") + ". Press Save anyway to keep both."; return paint(true); }
      if (!sig) { f.warn = ""; f.warnSig = ""; }
    }
    S.saving = true; paint(true);
    try {
      if (newLocum) { // + Locum in one step: the classic "Locum shift" body for the person, then + Add shift's
        var lname = f.lc_name, lb = { full_name: lname, designation: "locum", employment_type: "external", contracted_hours: 40, email: "", phone: f.lc_phone || "", registration_number: f.lc_reg || "", is_active: 1, patterns_json: "{\"patterns\":[],\"provisionalId\":null}" };
        var lr = await E.postOnce("/shifts/staff", lb, { list: async function () { var r0 = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }); return (r0 && r0.staff) || []; }, same: function (p) { return String(p.full_name) === lname; } });
        await reloadStaff();
        var lid = (lr && (lr.staff_id || lr.id)) || (Object.keys(S.staff).map(function (k) { return S.staff[k]; }).filter(function (p) { return String(p.full_name) === lname; }).sort(function (a, b) { return b.id - a.id; })[0] || {}).id;
        if (!lid) throw new Error("the new locum could not be found");
        f.staff_id = String(lid); f.lc_name = ""; f.lc_phone = ""; f.lc_reg = "";
      }
      var name = person(f.staff_id).full_name;
      if (f.mode === "add") {
        var body = { staff_id: Number(f.staff_id), shift_date: key, start_time: f.start_time, end_time: f.end_time, notes: f.notes };
        var isIt = function (x) { return Number(x.staff_id) === body.staff_id && x.shift_date === key && hm(x.start_time) === body.start_time && hm(x.end_time) === body.end_time; };
        var r = await E.postOnce("/shifts/assignments", body, { list: function () { return dayList(key); }, same: isIt });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
        if (f.role_override) { // Works as: Save's whole record with the role, as the classic keeps it
          var nid = r.shift_id || ((await dayList(key)).filter(isIt).sort(function (a, b) { return b.id - a.id; })[0] || {}).id;
          if (nid) await putShift({ id: nid, staff_id: body.staff_id, shift_date: key, start_time: body.start_time, end_time: body.end_time, role_override: f.role_override, notes: body.notes });
        }
        E.toast("Shift added for " + name, "success");
        S.last = { staff_id: body.staff_id, start_time: body.start_time, end_time: body.end_time };
      } else {
        // The server writes start, end, role and note together: read the shift as it is now and send it whole.
        var now = (await dayList(key)).filter(function (x) { return Number(x.id) === Number(f.id); })[0];
        if (!now) throw new Error("this shift was removed on another till");
        var full = { id: now.id, staff_id: now.staff_id, shift_date: now.shift_date, start_time: f.start_time, end_time: f.end_time, role_override: f.role_override != null ? f.role_override : now.role_override || "", notes: f.notes };
        var r2 = await E.apiFetch("/shifts/assignments/" + now.id, { method: "PUT", body: JSON.stringify(full) });
        if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Save failed");
        E.toast("Shift changed for " + name, "success");
        S.last = { staff_id: Number(now.staff_id), start_time: f.start_time, end_time: f.end_time };
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
      await delShift(f.id);
      S.form = null; E.toast("Shift removed for " + name, "success");
    } catch (x) { f.err = E.saveFailText(x).replace(/^Not saved/, "Not removed"); f.confirmDel = false; }
    S.saving = false; await refreshDay(f.date);
    if (!S.form) refocus({ mode: "add", date: f.date, row: S.wide ? f.staff_id : null });
  }
  // Approve: first, for whole days of leave, the person's shifts on those days (one bounded read): remove them too, or keep
  // them; then the classic cover question for a pharmacist; then the classic approve call (and a DELETE per removed shift).
  async function approveAsk(id, drop, trim) {
    if (S.busy) return;
    var l = S.leaves.filter(function (z) { return Number(z.id) === id; })[0]; if (!l) return;
    if (drop === undefined && !l.start_time && !l.end_time) {
      S.busy = id; paint();
      var list = [];
      try { list = await rangeList(l.start_date, l.end_date || l.start_date, l.staff_id); } catch (e) { list = []; }
      S.busy = 0;
      if (list.length) { S.ask = { id: id, kind: "shifts", shifts: list }; paint(); var k0 = S.mount.querySelector('[data-act="lv-drop-shifts"]'); if (k0) k0.focus(); return; }
      drop = [];
    }
    if (drop === undefined && (l.start_time || l.end_time) && E.rotaSet && E.rotaSet.leaveTrim) { // part of a day: the shifts it touches are shortened (B3), after a question
      S.busy = id; paint();
      var tl = []; try { tl = await rangeList(l.start_date, l.end_date || l.start_date, l.staff_id); } catch (e3) { tl = []; }
      S.busy = 0; var plan = E.rotaSet.leaveTrim(l, tl);
      if (plan && plan.changes && plan.changes.length) { S.ask = { id: id, kind: "trim", plan: plan }; paint(); var k2 = S.mount.querySelector('[data-act="lv-trim"]'); if (k2) k2.focus(); return; }
      drop = [];
    }
    var c = cover(l);
    if (c && !c.alts) { S.ask = { id: id, kind: c.locum ? "locum" : "gap", drop: drop || [], trim: S.ask && S.ask.trimPlan }; paint(); var k1 = S.mount.querySelector('[data-act="lv-approve-yes"]'); if (k1) k1.focus(); }
    else answer(id, "approve", drop, trim);
  }
  async function answer(id, what, drop, trim) {
    if (S.busy) return;
    var l = S.leaves.filter(function (z) { return Number(z.id) === id; })[0], name = l ? person(l.staff_id).full_name : "";
    S.busy = id; S.lvMsg = ""; paint();
    try {
      var r = await E.apiFetch("/shifts/leaves/" + id + "/" + what, { method: "POST" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.ask = null; E.toast((what === "approve" ? "Leave approved for " : "Leave refused for ") + name, "success");
      var gone = 0;
      for (var i = 0; drop && i < drop.length; i++) { try { await delShift(drop[i].id); gone++; } catch (e2) {} }
      if (drop && drop.length && gone < drop.length) S.lvMsg = "Leave approved, but " + (drop.length - gone) + " of " + name + "’s shifts could not be removed. Remove them on the week.";
      if (trim && trim.changes && trim.changes.length && E.rotaSet.applyLeaveTrim) { var tr = await E.rotaSet.applyLeaveTrim(trim); if (tr && tr.failed && tr.failed.length) S.lvMsg = "Leave approved, but " + tr.failed.length + " of " + name + "’s shifts could not be changed. Change them on the week."; }
    } catch (x) { S.lvMsg = E.saveFailText(x); }
    S.busy = 0; return load();
  }

  // ======================================================================================================================
  // Patterns and fills: the engine is E.rotaPlan (eikon.rotaplan.js, B1): expansion (closed days, public holidays, leave
  // whole or trimmed, availability, pending leave listed), preview words, the one-step write (W1 /shifts/apply-plan, else
  // apply-pattern per person) with verify and put-back, Undo with "changed since", Recent changes. This screen only
  // gathers the answers, reads the rows once (the snapshot), shows the preview and hands the expansions over.
  // ======================================================================================================================
  function rowSig(x) { return [x.shift_date || x.date, hm(x.start_time), hm(x.end_time), x.role_override || "", x.notes || ""].join("|"); }
  function RP() { return E.rotaPlan && E.rotaPlan.ready && !E.rotaPlan.stub ? E.rotaPlan : null; }
  var moves = []; // moves made here (the swap's machinery, not a fill): their Undo, this session
  function remember(rec) { rec.id = "m" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5); moves.unshift(rec); moves = moves.slice(0, 5); return rec; }
  function recentList() {
    var l = []; if (RP()) { try { l = (RP().recent() || []).filter(function (r) { return !r.undone; }).map(function (r) { return { id: r.undoId, words: r.words }; }); } catch (e) { l = []; } }
    return moves.map(function (m) { return { id: m.id, words: m.words }; }).concat(l).slice(0, 6);
  }
  async function doUndo(id, anyway) {
    var mv = moves.filter(function (m) { return m.id === id; })[0];
    S.undo = { words: "Undoing…" }; paint(true);
    if (mv) {
      try { var b = mv.back, x = (await dayList(b.date)).filter(function (y) { return Number(y.id) === Number(b.id); })[0]; if (!x) throw new Error("the moved shift was changed or removed meanwhile"); await refreshDay(b.date); var ok = await moveShift(x, b.to.sid, b.to.date, true); if (!ok) throw new Error(S.msg || "it could not be moved back"); moves = moves.filter(function (m) { return m.id !== id; }); S.undo = { words: "Undone: the shift is back on " + dayWords(b.to.date) + "." }; await refreshDay(b.date, b.to.date); }
      catch (e) { S.undo = { words: "Not undone — " + E.saveFailText(e).replace(/^Not saved: /, ""), bad: true, id: id }; paint(true); }
      return;
    }
    if (!RP()) { S.undo = { words: "That change can no longer be undone here.", bad: true }; paint(true); return; }
    var r = await RP().undo(id, anyway ? { anyway: true } : {});
    if (!r.done && r.changedSince && r.changedSince.length && !anyway) { S.undo = null; S.dlg = { kind: "undoask", id: id, words: r.words, back: '[data-act="menu"]' }; paint(true); dlgFocus(); return; }
    var mm = r.done && /^Undone: (added|removed) (\d+ shifts?)(?: and removed (\d+))?(?: for (.+))?$/i.exec(String(r.words || ""));
    S.undo = { words: mm ? "Undone. The " + mm[2] + " " + low(mm[1]) + (mm[3] ? " (and " + mm[3] + " removed)" : "") + (mm[4] ? " for " + mm[4] : "") + (low(mm[1]) === "added" ? " are off the rota again." : " are back on the rota.") : r.words, bad: !r.done, id: r.done ? null : id };
    await refreshRange(); paint(true);
  }
  // A person's usual week (B1's reading of patterns_json: a rotation, or the classic "provisional" pattern) and its block on a day.
  function usualOf(p) { try { return RP() && p ? RP().usualOf(p) : null; } catch (e) { return null; } }
  function usualFor(p, k) {
    var u = usualOf(p); if (!u || !u.weeks) return null;
    var wi = RP().weekIndex ? RP().weekIndex(k, u.anchor || ymd(mondayOf(parse(k))), u.n || u.weeks.length) : 0, e = (u.weeks[wi] || [])[dow(k)];
    e = Array.isArray(e) ? e[0] : e; return e && (e.start || e.start_time) ? { start: hm(e.start || e.start_time), end: hm(e.end || e.end_time), role_override: e.role_override || "" } : null;
  }

  // ======================================================================================================================
  // Fill…: one entry point, every way to fill a range of dates, each a few plain questions → preview → apply → undo.
  // ======================================================================================================================
  var CHOICES = [
    ["days", "Same days every week", "For example Mon–Fri 08:00–14:00 for Maria, for 3 months. Every week, every other week, or every 3rd or 4th.", "1"],
    ["rota", "A usual week or rotation", "Set someone's week once (different hours each day, 1 to 4 weeks in turn, for example Saturdays every other week), then put it on the rota.", "2"],
    ["pick", "Days I pick", "Choose days on the rota, then set their hours.", "3"],
    ["copy", "Copy or repeat", "Copy a day, a week or a month to another, or repeat it forward a number of times or until a date.", "4"],
    ["gaps", "Fill the gaps", "A pharmacist (or another role) in every hour the pharmacy is open with nobody in that role.", "5"],
    ["last", "Same as last week", "Last week's shifts again, on this week.", "6"],
    ["usual", "Everyone's usual pattern", "Each person's usual week, from a date until a date.", "7"]
  ];
  function todayK() { return ymd(new Date()); }
  function defFrom() { var ks = keys(), t = todayK(); return t >= ks[0] && t <= ks[ks.length - 1] ? t : ks[0]; }
  function monthsOn(k, n) { var d = parse(k), x = new Date(d.getFullYear(), d.getMonth() + n, d.getDate()); return ymd(plus(x, -1)); }
  function newFill(step) {
    var ks = keys(), one = active().length === 1 ? String(active()[0].id) : "", f = {
      step: step, who: "one", sid: S.last ? String(S.last.staff_id) : one, sids: [], role: "pharm", days: [0, 1, 2, 3, 4], every: 1, hmode: "fixed", start: S.last ? S.last.start_time : "", end: S.last ? S.last.end_time : "",
      from: defFrom(), len: "3m", to: monthsOn(defFrom(), 3), mode: "keep", n: 2, weeks: [], src: "week", srcDay: ks[0], times: 4, tmode: "times", target: addDays(ks[0], 7), until: monthsOn(defFrom(), 1), notes: "", err: ""
    };
    if (!f.start) { var oh = hoursFor(defFrom()); f.start = hm(oh.open) || "08:00"; f.end = hm(oh.close) || "14:00"; }
    for (var i = 0; i < 4; i++) f.weeks.push({ days: i === 0 ? [0, 1, 2, 3, 4, 5] : [0, 1, 2, 3, 4], start: f.start, end: f.end });
    return f;
  }
  function openFill(step) {
    S.menu = false;
    if (step === "pick") { if (selKeys().length) step = "sel"; else { S.dlg = null; if (!S.wide) { S.pick = true; if (!S.pickWho && active().length === 1) S.pickWho = String(active()[0].id); } paint(true); S.msg = ""; var hint = S.wide ? "Drag across the days on the rota (or Shift-click, or tick a person or a day), then press Set hours…" : "Choose whose days below, tick the days, then press Set hours…"; E.toast(hint, "info"); if (S.wide) focusCell(S.cur); else { var pw = S.mount.querySelector('[data-k="pickwho"]'); if (pw) pw.focus(); } return; } }
    var back = step === "menu" ? '[data-act="fill-open"]' : /^sel|^paste|^clear/.test(step) ? '[data-act="sel-hours"]' : '[data-act="fill-open"]';
    S.dlg = { kind: "fill", f: newFill(step), back: back, prog: "", pv: null, busy: false };
    if (step === "sel" || step === "selusual" || step === "clear" || step === "paste") { if (step !== "sel") return dlgNext(); }
    if (step === "last") return dlgNext();
    paintDlg(); dlgFocus();
  }
  function closeDlg() {
    if (S.dlg && S.dlg.busy) return;
    var back = S.dlg && S.dlg.back; S.dlg = null; paintDlg();
    var el = back && S.mount.querySelector(back); if (!el || el.offsetParent === null) el = S.mount.querySelector('[data-act="fill-open"]');
    if (S.wide && back === '[data-act="sel-hours"]' && !selKeys().length) { focusCell(S.cur); return; }
    if (el) el.focus();
  }
  function paintDlg() { var host = S.mount && S.mount.querySelector("#shf-dlghost"); if (!host) return; host.innerHTML = dlgHtml(); var d = host.querySelector("#shf-dlgf"); if (d) d.addEventListener("submit", function (ev) { ev.preventDefault(); dlgNext(); }); }
  function dlgFocus() { setTimeout(function () { var d = S.mount && S.mount.querySelector(".shf-dlg"); if (!d) return; var el = d.querySelector("[autofocus]") || d.querySelector("button.shf-ch, select, input, button.p, button"); if (el) el.focus(); }, 0); }
  function personOpts(sel) { return active().map(function (p) { return '<option value="' + p.id + '"' + (String(sel) === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + (desig(p) ? " · " + esc(desig(p)) : "") + "</option>"; }).join(""); }
  function whoField(f, label) {
    var h = '<fieldset class="shf-fs"><legend>' + esc(label || "Who") + '</legend><div class="shf-row" role="group" aria-label="Who">' +
      [["one", "One person"], ["some", "Several"], ["role", "Everyone with a role"]].map(function (o) { return '<button type="button" class="shf-tg" data-act="dlg-who" data-v="' + o[0] + '" aria-pressed="' + (f.who === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>";
    if (f.who === "one") h += '<div style="margin-top:8px"><select class="full" name="sid" aria-label="Person" autofocus><option value="">Choose a person</option>' + personOpts(f.sid) + "</select></div>";
    else if (f.who === "some") h += '<div class="shf-ppl" style="margin-top:8px">' + active().sort(byOrder).map(function (p) { return '<label><input type="checkbox" name="sids" value="' + p.id + '"' + (f.sids.indexOf(String(p.id)) >= 0 ? " checked" : "") + ">" + esc(p.full_name) + ' <span style="color:var(--muted);font-size:13px">' + esc(desig(p)) + "</span></label>"; }).join("") + "</div>";
    else if (f.who === "role") h += '<div style="margin-top:8px"><select class="full" name="role" aria-label="Role">' + ROLES.slice(1).filter(function (r) { return active().some(function (p) { return roleOk(p, r[0]); }); }).map(function (r) { var n = active().filter(function (p) { return roleOk(p, r[0]); }).length; return '<option value="' + r[0] + '"' + (f.role === r[0] ? " selected" : "") + ">" + esc(r[1]) + " (" + n + ")</option>"; }).join("") + "</select></div>";
    return h + "</fieldset>";
  }
  function daysField(arr, name, label) {
    var pre = [["Mon–Fri", [0, 1, 2, 3, 4]], ["Weekends", [5, 6]], ["Every day", [0, 1, 2, 3, 4, 5, 6]]];
    return '<fieldset class="shf-fs"><legend>' + esc(label || "Days") + '</legend><div class="shf-row">' + DAY.map(function (d, i) { return '<button type="button" class="shf-tg" data-act="dlg-day" data-n="' + name + '" data-i="' + i + '" aria-pressed="' + (arr.indexOf(i) >= 0) + '" aria-label="' + d + '">' + d.slice(0, 3) + "</button>"; }).join("") + "</div>" +
      '<div class="shf-row" style="margin-top:6px">' + pre.map(function (p) { var on = p[1].length === arr.length && p[1].every(function (i) { return arr.indexOf(i) >= 0; }); return '<button type="button" class="shf-tg" data-act="dlg-days" data-n="' + name + '" data-v="' + p[1].join(",") + '" aria-pressed="' + on + '">' + p[0] + "</button>"; }).join("") + "</div></fieldset>";
  }
  function hoursField(f, prefix, opts) {
    prefix = prefix || ""; var st = f[prefix + "start"] != null ? f[prefix + "start"] : f.start, en = f[prefix + "end"] != null ? f[prefix + "end"] : f.end;
    var h = '<fieldset class="shf-fs"><legend>Hours</legend>';
    if (opts && opts.modes) h += '<div class="shf-row" style="margin-bottom:6px">' + [["fixed", "These hours"], ["open", "Opening hours"], ["am", "Morning half"], ["pm", "Afternoon half"]].map(function (o) { return '<button type="button" class="shf-tg" data-act="dlg-hmode" data-v="' + o[0] + '" aria-pressed="' + (f.hmode === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>";
    if (!(opts && opts.modes) || f.hmode === "fixed") h += '<div class="shf-row"><input type="time" name="' + prefix + 'start" value="' + esc(st) + '" aria-label="Starts at"><span aria-hidden="true">–</span><input type="time" name="' + prefix + 'end" value="' + esc(en) + '" aria-label="Ends at"></div>';
    else h += '<p class="shf-hint">Each day’s own ' + (f.hmode === "open" ? "opening hours" : f.hmode === "am" ? "first half of the opening hours" : "second half of the opening hours") + ".</p>";
    return h + "</fieldset>";
  }
  function rangeField(f, label) {
    var lens = [["1m", "1 month"], ["3m", "3 months"], ["6m", "6 months"], ["12m", "Until changed"], ["date", "Until a date"]];
    return '<fieldset class="shf-fs"><legend>' + esc(label || "When") + '</legend><div class="shf-row"><label class="shf-fl" style="margin:0;font-weight:600">From <input type="date" name="from" value="' + esc(f.from) + '"></label></div>' +
      '<div class="shf-row" style="margin-top:6px">' + lens.map(function (l) { return '<button type="button" class="shf-tg" data-act="dlg-len" data-v="' + l[0] + '" aria-pressed="' + (f.len === l[0]) + '">' + l[1] + "</button>"; }).join("") + "</div>" +
      (f.len === "date" ? '<div class="shf-row" style="margin-top:6px"><label class="shf-fl" style="margin:0;font-weight:600">Until <input type="date" name="to" value="' + esc(f.to) + '"></label></div>' : '<p class="shf-hint">Until ' + esc(longDay(f.to)) + " " + parse(f.to).getFullYear() + (f.len === "12m" ? " (12 months; Plan shifts offers to extend it before it runs out)" : "") + ".</p>") + "</fieldset>";
  }
  function modeField(f) {
    return '<fieldset class="shf-fs"><legend>Days that already have a shift</legend><div class="shf-rad"><label><input type="radio" name="mode" value="keep"' + (f.mode !== "replace" ? " checked" : "") + "> Keep them, fill only empty days</label>" +
      '<label><input type="radio" name="mode" value="replace"' + (f.mode === "replace" ? " checked" : "") + "> Replace them</label></div></fieldset>";
  }
  function dlgHtml() {
    var D = S.dlg; if (!D) return "";
    if (D.kind === "person") return personHtml();
    if (D.kind === "panel") return '<div class="shf-ov"><div class="shf-dlg" role="dialog" aria-modal="true" aria-label="' + (D.what === "print" ? "Print the rota" : "Calendar link") + '"><div id="shf-pm"></div></div></div>';
    if (D.kind === "undoask") return '<div class="shf-ov"><div class="shf-dlg" role="alertdialog" aria-modal="true" aria-labelledby="shf-dlg-t" aria-describedby="shf-dlg-d"><h2 id="shf-dlg-t">Undo anyway?</h2><p class="s" id="shf-dlg-d">' + esc(D.words) + '</p><div class="shf-dacts"><button class="shf-btn" data-act="dlg-close">Keep as it is</button><button class="shf-btn d" data-act="dlg-undoyes" data-u="' + esc(D.id) + '">Undo anyway</button></div></div></div>';
    var f = D.f, t = "Fill the rota", s = "Choose how. Every fill shows what it will do before anything is saved, and can be undone.", body = "", next = "Show what it will do";
    if (f.step === "menu") body = CHOICES.map(function (c) { return '<button type="button" class="shf-ch" data-act="dlg-step" data-v="' + c[0] + '"' + (c[0] === "days" ? " autofocus" : "") + '><kbd aria-hidden="true">' + c[3] + "</kbd><b>" + esc(c[1]) + "</b><span>" + esc(c[0] === "pick" && selKeys().length ? plural(selKeys().length, "day") + " selected: set their hours." : c[0] === "gaps" ? c[2] + " (" + rangeWord() + ")" : c[2]) + "</span></button>"; }).join("");
    else if (f.step === "days") { t = "Same days every week"; s = "The same shift on the days you choose, every week or every few weeks."; body = whoField(f) + daysField(f.days, "days") + hoursField(f, "", { modes: true }) + '<fieldset class="shf-fs"><legend>How often</legend><div class="shf-row">' + [[1, "Every week"], [2, "Every other week"], [3, "Every 3rd week"], [4, "Every 4th week"]].map(function (o) { return '<button type="button" class="shf-tg" data-act="dlg-every" data-v="' + o[0] + '" aria-pressed="' + (Number(f.every) === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div></fieldset>" + rangeField(f); }
    else if (f.step === "rota") return '<div class="shf-ov"><div class="shf-dlg" role="dialog" aria-modal="true" aria-labelledby="shf-dlg-t"><h2 id="shf-dlg-t">A usual week or rotation</h2><p class="s">Set the week once: each day its own hours, or 2 to 4 weeks in turn. Then put it on the rota.</p>' +
      '<label class="shf-fl" for="shf-rsid">Whose week</label><select class="full" id="shf-rsid" data-k="rotasid" autofocus><option value="">Choose a person</option>' + personOpts(f.sid) + '</select><div id="shf-rp-ed" style="margin-top:12px"></div>' +
      // one Cancel: once a person is chosen the week editor below carries its own Cancel (it closes Fill…), so this row keeps only ‹ Other ways
      '<div class="shf-dacts"><button type="button" class="shf-btn l" data-act="dlg-menu">‹ Other ways</button>' + (f.sid && RP() && RP().ui && RP().ui.editor ? "" : '<button type="button" class="shf-btn" data-act="dlg-close">Cancel</button>') + "</div></div></div>";
    else if (f.step === "sel") { var c = selCells(); t = "Set hours"; s = plural(c.length, "day") + " selected" + (uniqP(c).length > 1 ? " for " + uniqP(c).length + " people" : " for " + person(c[0] && c[0].sid).full_name) + "."; body = hoursChips(c) + hoursField(f, "", { modes: true }) + '<fieldset class="shf-fs"><legend>Note</legend><div class="shf-row"><input name="notes" value="' + esc(f.notes) + '" placeholder="Optional" style="flex:1;font:inherit;font-size:16px;height:40px;border:1px solid var(--border);border-radius:10px;background:var(--panel);color:var(--text);padding:0 8px"></div></fieldset>'; }
    else if (f.step === "copy") {
      t = "Copy or repeat"; s = "Shifts copied keep their hours, notes and roles. Public holidays, closed days and leave are skipped.";
      body = '<fieldset class="shf-fs"><legend>Copy</legend><div class="shf-row">' + [["week", "This week"], ["day", "A day"], ["month", "This month"]].map(function (o) { return '<button type="button" class="shf-tg" data-act="dlg-src" data-v="' + o[0] + '" aria-pressed="' + (f.src === o[0]) + '">' + o[1] + "</button>"; }).join("") + "</div>" +
        (f.src === "day" ? '<div class="shf-row" style="margin-top:6px"><input type="date" name="srcDay" value="' + esc(f.srcDay) + '" aria-label="The day to copy"></div>' : '<p class="shf-hint">' + esc(srcLabel(f)) + "</p>") + "</fieldset>" +
        '<fieldset class="shf-fs"><legend>To</legend><div class="shf-row">' + [["times", f.src === "day" ? "The next days" : f.src === "month" ? "The next months" : "The next weeks"], ["until", "Every " + (f.src === "month" ? "month" : "week") + " until a date"], ["date", f.src === "day" ? "Another day" : f.src === "month" ? "Another month" : "Another week"]].map(function (o) { return '<button type="button" class="shf-tg" data-act="dlg-tmode" data-v="' + o[0] + '" aria-pressed="' + (f.tmode === o[0]) + '">' + esc(o[1]) + "</button>"; }).join("") + "</div>" +
        (f.tmode === "times" ? '<div class="shf-row" style="margin-top:6px"><label class="shf-fl" style="margin:0;font-weight:600">How many <input type="number" name="times" min="1" max="52" inputmode="numeric" value="' + esc(f.times) + '" style="width:80px"></label></div>' : f.tmode === "until" ? '<div class="shf-row" style="margin-top:6px"><label class="shf-fl" style="margin:0;font-weight:600">Until <input type="date" name="until" value="' + esc(f.until) + '"></label></div>' : '<div class="shf-row" style="margin-top:6px"><label class="shf-fl" style="margin:0;font-weight:600">' + (f.src === "day" ? "Day" : "Starting") + ' <input type="date" name="target" value="' + esc(f.target) + '"></label></div>') +
        (f.src === "day" && f.tmode === "times" ? '<p class="shf-hint">The same weekday each week (for example every Monday).</p>' : "") + "</fieldset>" + whoField(f, "Whose shifts").replace('<div class="shf-row" role="group" aria-label="Who">', '<div class="shf-row" role="group" aria-label="Who"><button type="button" class="shf-tg" data-act="dlg-who" data-v="all" aria-pressed="' + (f.who === "all") + '">Everyone</button>');
    }
    else if (f.step === "usual") { t = "Everyone's usual pattern"; s = "Each person's usual week (set under their name, Usual week), on the rota."; body = whoField(f, "Whose").replace('<div class="shf-row" role="group" aria-label="Who">', '<div class="shf-row" role="group" aria-label="Who"><button type="button" class="shf-tg" data-act="dlg-who" data-v="all" aria-pressed="' + (f.who === "all") + '">Everyone</button>') + rangeField(f) + '<p class="shf-hint">People without a usual week are listed and left as they are.</p>'; }
    else if (f.step === "gaps") { t = "Fill the gaps"; s = "Every open hour " + rangeWord() + " without the role gets a shift for someone free."; next = "Show who"; body = '<fieldset class="shf-fs"><legend>Who is needed</legend><select class="full" name="gaprole" aria-label="Who is needed">' + [["pharmacist", "A pharmacist (or locum)"]].concat(["manager", "assistant", "dispenser", "cashier", "cleaner"].filter(function (d) { return active().some(function (p) { return low(p.designation) === d; }); }).map(function (d) { return [d, "A " + DESIG[d].toLowerCase()]; })).map(function (o) { return '<option value="' + o[0] + '"' + ((f.gaprole || "pharmacist") === o[0] ? " selected" : "") + ">" + esc(o[1]) + " every open hour</option>"; }).join("") + '</select></fieldset><p class="shf-hint">' + esc(gapCount() ? plural(gapCount(), "hour range") + " with no pharmacist " + rangeWord() + "." : "Every open hour " + rangeWord() + " has a pharmacist.") + " The one with the fewest hours planned who is free and not on leave is chosen; anyone who can’t be found is listed.</p>"; }
    else if (f.step === "preview") return previewDlg(D);
    var h = '<div class="shf-ov"><form class="shf-dlg" id="shf-dlgf" role="dialog" aria-modal="true" aria-labelledby="shf-dlg-t" novalidate autocomplete="off"><h2 id="shf-dlg-t">' + esc(t) + '</h2><p class="s">' + esc(s) + "</p>" + body +
      (f.err ? '<div class="shf-err" role="alert">' + esc(f.err) + "</div>" : "") + '<div class="shf-dacts">' + (f.step !== "menu" && D.f.step !== "sel" ? '<button type="button" class="shf-btn l" data-act="dlg-menu">‹ Other ways</button>' : "") + '<button type="button" class="shf-btn" data-act="dlg-close">Cancel</button>' + (f.step !== "menu" ? '<button type="submit" class="shf-btn p">' + esc(next) + "</button>" : "") + "</div></form></div>";
    return h;
  }
  function uniqP(c) { var m = {}; c.forEach(function (x) { m[x.sid] = 1; }); return Object.keys(m); }
  function hoursChips(c) { // the person's usual times, the last used, the day's opening hours and its halves
    var ch = [], add = function (s, e, why) { if (s && e && mins(e) > mins(s) && !ch.some(function (x) { return x[0] === s && x[1] === e; })) ch.push([s, e, why]); };
    var p0 = c[0] && person(c[0].sid), u = p0 && usualFor(p0, c[0].date); if (u) add(u.start, u.end, first(p0) + "’s usual");
    if (S.last) add(S.last.start_time, S.last.end_time, "last used");
    var oh = c[0] && hoursFor(c[0].date); if (oh && !oh.closed) { var a = mins(oh.open), z = mins(oh.close), mid = Math.round((a + z) / 60) * 30; add(oh.open, oh.close, "opening hours"); add(oh.open, tm(mid), "morning half"); add(tm(mid), oh.close, "afternoon half"); }
    if (!ch.length) return "";
    return '<fieldset class="shf-fs"><legend>Quick hours</legend><div class="shf-row">' + ch.map(function (x) { return '<button type="button" class="shf-tg" data-act="dlg-chip" data-s="' + x[0] + '" data-e="' + x[1] + '" title="' + esc(x[2]) + '" aria-label="' + esc(x[0] + " to " + x[1] + ", " + x[2]) + '">' + esc(x[0] + "–" + x[1]) + "</button>"; }).join("") + "</div></fieldset>";
  }
  function gapCount() { var n = 0; keys().forEach(function (k) { n += dayCover(k).gaps.length; }); return n; }
  function srcRange(f) {
    var ks = keys();
    if (f.src === "day") return { from: f.srcDay, to: f.srcDay, len: 1 };
    if (f.src === "month") { var m0 = S.view === "month" ? ks[0] : ymd(new Date(S.monday.getFullYear(), S.monday.getMonth(), 1)); var d = parse(m0); return { from: m0, to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)), len: new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate() }; }
    var mo = S.view === "month" ? ymd(mondayOf(parse(defFrom()))) : ymd(S.monday); return { from: mo, to: addDays(mo, 6), len: 7 };
  }
  function srcLabel(f) { var r = srcRange(f); return f.src === "month" ? MONTHS[parse(r.from).getMonth()] + " " + parse(r.from).getFullYear() : dayWords(r.from) + " – " + dayWords(r.to); }
  function dlgClick(a, b) {
    var D = S.dlg; if (!D) return; var f = D.f;
    readDlg();
    if (a === "dlg-close") return closeDlg();
    if (a === "dlg-menu") { f.step = "menu"; f.err = ""; paintDlg(); return dlgFocus(); }
    if (a === "dlg-step") { var v = b.getAttribute("data-v"); if (v === "pick") return openFill("pick"); f.step = v; f.err = ""; if (v === "last") return dlgNext(); if (v === "copy" || v === "usual") f.who = "all"; paintDlg(); if (v === "rota") mountEd(); return dlgFocus(); }
    if (a === "dlg-pset") { var ps = Number(b.getAttribute("data-sid")); S.dlg = null; paintDlg(); return openPerson(ps); }
    if (a === "dlg-who") { f.who = b.getAttribute("data-v"); }
    else if (a === "dlg-day" || a === "dlg-days") { var n = b.getAttribute("data-n"), arr = n === "days" ? f.days : f.weeks[Number(n.slice(1))].days; if (a === "dlg-day") { var i = Number(b.getAttribute("data-i")), at = arr.indexOf(i); if (at >= 0) arr.splice(at, 1); else arr.push(i); } else { arr.length = 0; b.getAttribute("data-v").split(",").forEach(function (x) { arr.push(Number(x)); }); } }
    else if (a === "dlg-hmode") f.hmode = b.getAttribute("data-v");
    else if (a === "dlg-every") f.every = Number(b.getAttribute("data-v"));
    else if (a === "dlg-n") f.n = Number(b.getAttribute("data-v"));
    else if (a === "dlg-len") { f.len = b.getAttribute("data-v"); setTo(f); }
    else if (a === "dlg-src") { f.src = b.getAttribute("data-v"); var r = srcRange(f); f.target = addDays(r.from, f.src === "day" ? 1 : f.src === "month" ? r.len : 7); }
    else if (a === "dlg-tmode") f.tmode = b.getAttribute("data-v");
    else if (a === "dlg-chip") { f.hmode = "fixed"; f.start = b.getAttribute("data-s"); f.end = b.getAttribute("data-e"); }
    else if (a === "dlg-mode") { f.mode = b.getAttribute("data-v"); f.step = S.dlg.from; return dlgNext(); }
    else if (a === "dlg-apply") return dlgApply();
    else if (a === "dlg-back") { f.step = D.from || "menu"; D.pv = null; if (D.from === "paste" || D.from === "clear" || D.from === "selusual" || D.from === "last") return closeDlg(); paintDlg(); return dlgFocus(); }
    else if (a === "dlg-undoyes") { var u = b.getAttribute("data-u"); S.dlg = null; paintDlg(); return doUndo(u, true); }
    else return;
    var keepSel = b.getAttribute("data-act") + (b.getAttribute("data-v") || "") + (b.getAttribute("data-i") || "") + (b.getAttribute("data-n") || "");
    paintDlg();
    var again = Array.prototype.filter.call(S.mount.querySelectorAll(".shf-dlg [data-act]"), function (x) { return x.getAttribute("data-act") + (x.getAttribute("data-v") || "") + (x.getAttribute("data-i") || "") + (x.getAttribute("data-n") || "") === keepSel; })[0];
    if (again) again.focus();
  }
  function setTo(f) { if (f.len === "1m") f.to = monthsOn(f.from, 1); else if (f.len === "3m") f.to = monthsOn(f.from, 3); else if (f.len === "6m") f.to = monthsOn(f.from, 6); else if (f.len === "12m") f.to = monthsOn(f.from, 12); else if (!f.to || f.to < f.from) f.to = monthsOn(f.from, 1); }
  function readDlg() { // what is typed in the dialog, into its state (so a redraw never loses it)
    var D = S.dlg, d = S.mount && S.mount.querySelector("#shf-dlgf"); if (!D || !d || !D.f) return; var f = D.f;
    Array.prototype.forEach.call(d.querySelectorAll("input,select"), function (el) {
      var n = el.name; if (!n) return;
      if (n === "sids") { var v = String(el.value), at = f.sids.indexOf(v); if (el.checked && at < 0) f.sids.push(v); if (!el.checked && at >= 0) f.sids.splice(at, 1); }
      else if (n === "mode") { if (el.checked) f.mode = el.value; }
      else if (/^w\d(start|end)$/.test(n)) f.weeks[Number(n[1])][n.slice(2)] = el.value;
      else f[n] = el.value;
    });
    if (f.len !== "date") setTo(f);
  }
  function dlgChange(t) { readDlg(); if (t.name === "from" || t.name === "srcDay") { var f = S.dlg.f; if (t.name === "srcDay") f.target = addDays(f.srcDay, 1); paintDlg(); var el = S.mount.querySelector('#shf-dlgf [name="' + t.name + '"]'); if (el) el.focus(); } }
  function dlgInput(t) { if (t.type === "time" || t.name === "notes" || t.name === "times") readDlg(); }
  // The usual week / rotation editor (B1) for one person, inside Fill…; "Put on the rota" goes on to the usual pattern.
  function mountEd() {
    var D = S.dlg, el = S.mount.querySelector("#shf-rp-ed"); if (!D || !el) return; var f = D.f;
    if (!f.sid || !RP() || !RP().ui || !RP().ui.editor) { el.innerHTML = f.sid ? '<p class="shf-hint">The editor is still loading.</p>' : ""; return; }
    try { RP().ui.editor(el, person(f.sid), { onSaved: function () { reloadStaff(); }, onApply: function (pp) { var sid = String((pp && pp.id) || f.sid); reloadStaff().then(function () { if (!S.dlg) return; var g = newFill("usual"); g.who = "one"; g.sid = sid; g.len = "12m"; setTo(g); S.dlg.f = g; paintDlg(); dlgNext(); /* straight to what it will do: one person, from today, until changed */ }); }, onCancel: closeDlg }); } catch (e) { el.textContent = "The editor could not open: " + (e && e.message || e); }
  }
  function whoIds(f) {
    if (f.who === "all") return active().sort(byOrder).map(function (p) { return Number(p.id); });
    if (f.who === "one") return f.sid && f.sid !== "new" ? [Number(f.sid)] : [];
    if (f.who === "some") return f.sids.map(Number);
    return active().filter(function (p) { return roleOk(p, f.role); }).sort(byOrder).map(function (p) { return Number(p.id); });
  }
  function hoursOn(f, k, st, en) { // the hours for a day, by the chosen way
    if (f.hmode === "fixed" || !f.hmode) return { start: st, end: en };
    var oh = hoursFor(k); if (oh.closed) return null; var a = mins(oh.open), z = mins(oh.close), mid = Math.round((a + z) / 60) * 30;
    return f.hmode === "open" ? { start: oh.open, end: oh.close } : f.hmode === "am" ? { start: oh.open, end: tm(mid) } : { start: tm(mid), end: oh.close };
  }
  // The dialog's answers → a plan for the engine: { step, ids, from, to, mode, … }. Problems are said, all at once.
  function buildPlan(f) {
    var errs = [], ids = whoIds(f), plan = { step: f.step, ids: ids, from: f.from, to: f.to, mode: f.mode === "replace" ? "replace" : "keep" };
    var okT = function (st, en) { return /^\d{2}:\d{2}$/.test(st || "") && /^\d{2}:\d{2}$/.test(en || "") && mins(en) > mins(st); };
    var range = function () {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f.from || "")) errs.push("Choose the first day.");
      else if (!/^\d{4}-\d{2}-\d{2}$/.test(f.to || "") || f.to < f.from) errs.push("The last day must be on or after the first day.");
      else if (daysBetween(f.from, f.to) > 3650) errs.push("Choose at most 10 years at a time.");
    };
    if (f.step === "days" || f.step === "rota" || f.step === "usual") { if (!ids.length) errs.push(f.who === "one" ? "Choose the person." : f.who === "some" ? "Tick at least one person." : "No one has that role."); range(); plan.until = f.len === "12m"; }
    if (f.step === "days") {
      if (!f.days.length) errs.push("Choose at least one day of the week.");
      if (f.hmode === "fixed" && !okT(f.start, f.end)) errs.push("The shift must end after it starts.");
      plan.weekdays = f.days.slice().sort(); plan.every = Number(f.every) || 1; plan.hmode = f.hmode; plan.block = { start: f.start, end: f.end };
    } else if (f.step === "rota") {
      for (var w = 0; w < f.n; w++) if (f.weeks[w].days.length && !okT(f.weeks[w].start, f.weeks[w].end)) errs.push("Week " + "ABCD"[w] + ": the shift must end after it starts.");
      if (!f.weeks.slice(0, f.n).some(function (x) { return x.days.length; })) errs.push("Choose the days of at least one week.");
      plan.rotation = { n: f.n, anchor: ymd(mondayOf(parse(f.from || todayK()))), weeks: f.weeks.slice(0, f.n).map(function (x) { return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return x.days.indexOf(i) >= 0 ? { start: x.start, end: x.end } : null; }); }) };
    } else if (f.step === "sel" || f.step === "selusual" || f.step === "clear") {
      var c = f.step === "clear" ? selShifts().map(function (x) { return { sid: Number(x.staff_id), date: x.shift_date }; }) : selCells();
      if (!c.length) errs.push(f.step === "clear" ? "There are no shifts in the selection." : "Select some days first.");
      if (f.step === "sel" && f.hmode === "fixed" && !okT(f.start, f.end)) errs.push("The shift must end after it starts.");
      plan.cells = c.map(function (x) { return { staff_id: x.sid, date: x.date }; }); plan.hmode = f.hmode; plan.block = { start: f.start, end: f.end, notes: f.notes || "" };
      var all = c.map(function (x) { return x.date; }).sort(); plan.from = all[0]; plan.to = all[all.length - 1];
      if (f.step === "selusual" && !c.some(function (x) { return usualOf(person(x.sid)); })) { errs.push("No one selected has a usual week yet."); plan.set = uniqP(c).map(Number); }
    } else if (f.step === "paste") {
      var tl = topLeft(); if (!S.clip || !tl) errs.push("Copy some days first, then choose where to paste them.");
      else { plan.target = { staff_id: tl.sid, date: tl.date }; var off = daysBetween(S.clip.from, tl.date); plan.from = tl.date; plan.to = addDays(S.clip.to, off); plan.src = { from: S.clip.from, to: S.clip.to }; }
    } else if (f.step === "copy" || f.step === "last") {
      var src = f.step === "last" ? (function () { var m0 = S.view === "month" ? ymd(mondayOf(parse(defFrom()))) : ymd(S.monday); return { from: addDays(m0, -7), to: addDays(m0, -1), monday: m0 }; })() : srcRange(f);
      plan.src = src; plan.ids = f.step === "last" || f.who === "all" ? null : ids;
      if (f.step === "copy") {
        if (f.who !== "all" && !ids.length) errs.push("Choose whose shifts to copy.");
        if (f.tmode === "times") { if (!(parseInt(f.times, 10) >= 1 && parseInt(f.times, 10) <= 52)) errs.push("Write how many times (1 to 52)."); plan.times = Math.max(1, Math.min(52, parseInt(f.times, 10) || 1)); }
        else if (f.tmode === "until") { if (!/^\d{4}-\d{2}-\d{2}$/.test(f.until || "") || f.until <= src.to) errs.push("Choose a last day after " + dayWords(src.to) + "."); plan.until2 = f.until; }
        else { if (!/^\d{4}-\d{2}-\d{2}$/.test(f.target || "")) errs.push("Choose where to copy it to."); else { var t0 = f.src === "week" ? ymd(mondayOf(parse(f.target))) : f.src === "month" ? f.target.slice(0, 8) + "01" : f.target; if (t0 === src.from) errs.push("That is the same " + (f.src === "day" ? "day" : f.src) + "."); plan.toFrom = t0; } }
        var span = f.src === "month" ? 31 * ((plan.times || 1) + 1) : (src.len || 7) * ((plan.times || 1) + 1);
        plan.from = src.from; plan.to = plan.until2 || (plan.toFrom ? addDays(plan.toFrom, f.src === "month" ? 31 : src.len) : addDays(src.from, f.src === "day" ? 7 * (plan.times || 1) : span));
        if (plan.toFrom && plan.toFrom < plan.from) plan.from = plan.toFrom;
      } else { plan.from = src.from; plan.to = addDays(src.monday, 6); }
    } else if (f.step === "gaps") {
      var ks = keys(); plan.from = ks[0]; plan.to = ks[ks.length - 1]; plan.role = f.gaprole || "pharmacist";
    }
    return { errs: errs, plan: plan };
  }
  function topLeft() { var c = selCells(); if (!c.length) return S.cur; var list = rows().map(function (p) { return Number(p.id); }); c.sort(function (a, b) { return list.indexOf(a.sid) - list.indexOf(b.sid) || (a.date < b.date ? -1 : 1); }); var r = list.indexOf(c[0].sid), d = c.map(function (x) { return x.date; }).sort()[0]; return { sid: list[r], date: d }; }
  // Copy: the selected cells and their shifts, as they are (Paste hands them to the engine: same people, or one copied
  // person onto the person where it lands).
  function copySel() {
    var c = selCells(); if (!c.length) return;
    var cells = c.map(function (x) { return { staff_id: x.sid, date: x.date }; }), ds = c.map(function (x) { return x.date; }).sort();
    var rowsC = S.shifts.filter(function (x) { return S.sel[x.staff_id + "|" + x.shift_date]; }).map(function (x) { return { id: x.id, staff_id: x.staff_id, shift_date: x.shift_date, start_time: hm(x.start_time), end_time: hm(x.end_time), role_override: x.role_override || "", notes: x.notes || "" }; });
    S.clip = { cells: cells, rows: rowsC, from: ds[0], to: ds[ds.length - 1], n: c.length };
    S.sel = {}; S.anchor = null; applySel();
    E.toast("Copied " + plural(c.length, "day") + " (" + plural(rowsC.length, "shift") + "). Choose where they go, then press Paste or Ctrl+V.", "info");
    if (S.wide) focusCell(S.cur);
  }
  // The engine's call for a plan. data = { staff, shifts (the rows read for the whole span), leaves, hours, settings }.
  function runEngine(plan, data) {
    var P = RP(), people = (plan.ids || []).map(function (sid) { return person(sid); }), o = { data: data, mode: plan.mode };
    var perRows = function (rowsFor) { return people.map(function (p) { var rr = rowsFor(p); return P.expand({ person: p, from: plan.from, to: plan.to, rows: rr.rows, days: plan.mode === "replace" ? rr.days : [], hours: data.hours, settings: data.settings, leaves: data.leaves, existing: data.shifts, mode: plan.mode }); }); };
    var hoursRows = function (dates) { var out = []; dates.forEach(function (k) { var hh = hoursOn({ hmode: plan.hmode }, k, plan.block.start, plan.block.end); if (hh) out.push({ date: k, start_time: hh.start, end_time: hh.end, role_override: "", notes: plan.block.notes || "" }); }); return out; };
    switch (plan.step) {
      case "days":
        if (plan.hmode === "fixed") return P.weekdays(Object.assign(o, { people: people, from: plan.from, to: plan.to, weekdays: plan.weekdays.map(function (i) { return i + 1; }), every: plan.every, anchor: plan.from, block: plan.block }));
        return perRows(function () { var ds = [], an = ymd(mondayOf(parse(plan.from))); for (var k = plan.from; k <= plan.to; k = addDays(k, 1)) { if (plan.weekdays.indexOf(dow(k)) >= 0 && (Math.floor(daysBetween(an, ymd(mondayOf(parse(k)))) / 7) % plan.every) === 0) ds.push(k); } return { rows: hoursRows(ds), days: ds }; });
      case "rota": return people.map(function (p) { return P.expand({ person: p, from: plan.from, to: plan.to, rotation: plan.rotation, hours: data.hours, settings: data.settings, leaves: data.leaves, existing: data.shifts, mode: plan.mode }); });
      case "usual": return P.pattern(Object.assign(o, { people: people, from: plan.from, to: plan.to }));
      case "sel":
        if (plan.hmode === "fixed") return P.setHours(Object.assign(o, { cells: plan.cells, block: plan.block }));
        return groupBy(plan.cells).map(function (g) { return P.expand({ person: person(g.sid), from: g.days[0], to: g.days[g.days.length - 1], rows: hoursRows(g.days), days: plan.mode === "replace" ? g.days : [], hours: data.hours, settings: data.settings, leaves: data.leaves, existing: data.shifts, mode: plan.mode }); });
      case "selusual": return groupBy(plan.cells).map(function (g) { var p = person(g.sid), rr = []; g.days.forEach(function (k) { var b = usualFor(p, k); if (b) rr.push({ date: k, start_time: b.start, end_time: b.end, role_override: b.role_override || "", notes: "" }); }); var x = P.expand({ person: p, from: g.days[0], to: g.days[g.days.length - 1], rows: rr, days: plan.mode === "replace" ? g.days : [], hours: data.hours, settings: data.settings, leaves: data.leaves, existing: data.shifts, mode: plan.mode }); if (!usualOf(p)) x.noPattern = true; return x; });
      case "clear": return P.clear({ cells: plan.cells, data: data });
      case "paste": return P.paste(Object.assign(o, { rows: S.clip.rows, cells: S.clip.cells, target: plan.target }));
      case "last": return P.lastWeek(Object.assign(o, { monday: plan.src.monday, people: undefined }));
      case "copy": {
        var src = plan.src, srcRows = data.shifts.filter(function (r) { return r.shift_date >= src.from && r.shift_date <= src.to && (!plan.ids || plan.ids.indexOf(Number(r.staff_id)) >= 0) && Number((S.staff[r.staff_id] || {}).is_active) !== 0; });
        var q = Object.assign(o, { rows: srcRows, srcFrom: src.from, srcTo: src.to, people: plan.ids ? people : undefined });
        if (plan.toFrom) q.to = { from: plan.toFrom }; else if (plan.until2) q.until = plan.until2; else q.times = plan.times;
        if (src.len === 1 && !plan.toFrom) q.everyDays = 7; // a day repeats on the same weekday each week
        return P.repeat(q);
      }
      case "gaps": return P.gaps({ from: plan.from, to: plan.to, role: plan.role, data: data });
    }
    return [];
  }
  function groupBy(cells) { var by = {}, order = []; cells.forEach(function (c) { var k = String(c.staff_id); if (!by[k]) { by[k] = []; order.push(k); } if (by[k].indexOf(c.date) < 0) by[k].push(c.date); }); return order.map(function (k) { return { sid: Number(k), days: by[k].sort() }; }); }
  // Preview: one read of the rows for the whole span (also the snapshot for Undo; leave of another year read once too),
  // then the engine's expansion and its words.
  async function dlgNext() {
    var D = S.dlg; if (!D || D.busy) return; readDlg();
    var f = D.f;
    if (f.step === "menu") return;
    if (!RP()) { f.err = "The planner is still loading. Try again in a moment."; paintDlg(); return; }
    var b = buildPlan(f); f.err = b.errs.join(" ");
    if (b.errs.length) { if (f.step === "selusual" && b.plan.set) { D.from = "selusual"; f.step = "preview"; D.pv = { err: f.err, set: b.plan.set }; paintDlg(); dlgFocus(); return; }
      if (f.step === "clear" || f.step === "paste" || f.step === "last") { S.dlg = null; paintDlg(); S.msg = f.err; paint(true); return; } paintDlg(); var e = S.mount.querySelector(".shf-dlg .shf-err"); if (e) { e.setAttribute("tabindex", "-1"); e.focus(); } return; }
    var plan = b.plan; D.from = f.step; D.busy = true; D.prog = "Working out what changes…"; f.step = "preview"; D.pv = null; paintDlg();
    try {
      var lo = plan.from, hi = plan.to, gotRows = await rangeList(lo, hi), leaves = S.leaves.slice();
      var ys = []; for (var y = +lo.slice(0, 4); y <= +hi.slice(0, 4); y++) if (years().indexOf(y) < 0) ys.push(y);
      if (ys.length) { var more = await Promise.all(ys.map(function (yy) { return E.apiFetch("/shifts/leaves?year=" + yy, { method: "GET" }).catch(function () { return null; }); })); var seen = {}; leaves.forEach(function (l) { seen[l.id] = 1; }); more.forEach(function (r) { ((r && r.ok && r.leaves) || []).forEach(function (l) { if (!seen[l.id]) { seen[l.id] = 1; leaves.push(l); } }); }); }
      var data = { staff: S.staff, shifts: gotRows, leaves: leaves, hours: S.hours, settings: S.rules };
      var exps = (runEngine(plan, data) || []).filter(function (x) { return x && x.add; });
      var pv0 = RP().preview(exps, { after: { shifts: gotRows, staff: S.staff, leaves: leaves, hours: S.hours, settings: S.rules } });
      if (exps.length && exps.every(function (x) { return x.noPattern; })) { D.pv = { err: "No one chosen has a usual week yet.", set: exps.map(function (x) { return x.staff_id; }) }; D.busy = false; D.prog = ""; paintDlg(); dlgFocus(); return; }
      if (!exps.some(function (x) { return x.add.length || x.remove.length || x.keep.length || x.skip.length; }) && !(exps[0] && exps[0].unfilled && exps[0].unfilled.length)) throw new Error(plan.step === "last" ? "Last week has no shifts to copy." : plan.step === "copy" ? "There are no shifts to copy there." : pv0.words.nothing || "Nothing to change in these dates.");
      D.pv = { plan: plan, exps: exps, words: pv0.words, counts: pv0.counts, lo: lo, hi: hi };
    } catch (e) { D.pv = { err: e && e.network ? "Can't reach the server, so nothing can be worked out. Try again in a moment." : String((e && e.message) || e) }; }
    D.busy = false; D.prog = ""; paintDlg(); dlgFocus();
  }
  function setBtns(ids) { return ids && ids.length ? '<div class="shf-row" style="margin-top:6px">' + ids.slice(0, 6).map(function (sid) { return '<button type="button" class="shf-tg" data-act="dlg-pset" data-sid="' + esc(sid) + '">Set ' + esc(first(person(sid))) + "’s usual week</button>"; }).join("") + "</div>" : ""; }
  function previewDlg(D) {
    var pv = D.pv, h = '<div class="shf-ov"><div class="shf-dlg" role="dialog" aria-modal="true" aria-labelledby="shf-dlg-t" aria-describedby="shf-pv"><h2 id="shf-dlg-t">' + (D.from === "clear" ? "Clear shifts" : "What it will do") + "</h2>";
    if (!pv) return h + '<p class="shf-prog" role="status">' + esc(D.prog || "Working out what changes…") + "</p></div></div>";
    if (pv.err) return h + '<div class="shf-err" role="alert">' + esc(pv.err) + "</div>" + setBtns(pv.set) + '<div class="shf-dacts"><button class="shf-btn" data-act="dlg-back">‹ Back</button><button class="shf-btn" data-act="dlg-close">Close</button></div></div></div>';
    var P = RP(), c = pv.counts, people = pv.exps.filter(function (x) { return x.add.length || x.remove.length || x.keep.length || x.skip.length; });
    h += '<p class="s">' + esc(pv.words.title) + "</p>";
    if (D.from === "clear") h += '<div class="shf-pv" id="shf-pv"><p><b class="n">Remove ' + plural(c.remove, "shift") + "</b> (" + esc(people.map(function (x) { return first(person(x.staff_id)) + " " + x.remove.length; }).join(", ")) + ")?</p>" + (pv.words.removes ? '<p class="sk rm">' + esc(pv.words.removes) + "</p>" : "") + '<p class="shf-hint">You can undo it straight after.</p></div>';
    else {
      h += '<div class="shf-pv" id="shf-pv">' + people.map(function (x) {
        var w = P.preview([x]).words, line = '<div class="one"><b class="n">' + esc(person(x.staff_id).full_name) + "</b><br>" + esc(w.line);
        ["skips", "asked", "trims"].forEach(function (k) { if (w[k]) line += '<div class="sk">' + esc(w[k]) + "</div>"; });
        var hol = x.skip.filter(function (k2) { return k2.why === "holiday"; }).map(function (k2) { return String(k2.words || "").replace(/^Public holiday \((.*)\)$/, "$1"); }).filter(function (v, i, a2) { return v && a2.indexOf(v) === i; });
        if (hol.length) line += '<div class="sk">Public holidays: ' + esc(hol.join(", ")) + "</div>";
        if (x.add.length && x.add.length <= 5) line += '<div class="sk">' + esc(x.add.map(function (r) { return dayWords(r.date) + " " + hm(r.start_time) + "–" + hm(r.end_time); }).join(", ")) + "</div>";
        if (w.removes) line += '<div class="sk rm">' + esc(w.removes) + "</div>";
        var items = x.add.map(function (r) { return [r.date, "a", hm(r.start_time) + "–" + hm(r.end_time) + (r.week ? " · week " + r.week : "") + (r.trimmed ? " (shortened for leave)" : "") + (r.asked ? " (asked for leave)" : "")]; }).concat(x.remove.map(function (y) { return [y.shift_date, "r", hm(y.start_time) + "–" + hm(y.end_time) + " removed"]; }), x.keep.map(function (y) { return [y.shift_date, "k", hm(y.start_time) + "–" + hm(y.end_time) + " kept"]; }), x.skip.map(function (s2) { return [s2.date, "s", "skipped: " + (s2.words || s2.why)]; })).sort(function (a, b2) { return a[0] < b2[0] ? -1 : a[0] > b2[0] ? 1 : 0; });
        if (items.length) line += "<details><summary>Show day by day</summary><ul>" + items.slice(0, 400).map(function (it) { return '<li class="' + it[1] + '">' + esc(dayWords(it[0]) + " " + it[2]) + "</li>"; }).join("") + (items.length > 400 ? "<li>… and " + (items.length - 400) + " more</li>" : "") + "</ul></details>";
        return line + "</div>";
      }).join("");
      var none = pv.exps.filter(function (x) { return x.noPattern; }); if (none.length) h += '<div class="one sk">No usual week yet, left as they are: ' + esc(none.map(function (x) { return person(x.staff_id).full_name; }).join(", ")) + "</div>" + setBtns(none.map(function (x) { return x.staff_id; }));
      var unf = (pv.exps[0] && pv.exps[0].unfilled) || []; if (unf.length) h += '<div class="one sk">Still no pharmacist: ' + esc(unf.slice(0, 6).map(function (u) { return u.words.replace(/^Nobody free for /, ""); }).join(", ") + (unf.length > 6 ? " and " + (unf.length - 6) + " more" : "")) + ". Add a locum there.</div>";
      if (!people.length) h += '<div class="one">' + esc(pv.words.nothing || "Nothing to add: every day is skipped or already has a shift.") + "</div>";
      if (pv.words.after && pv.hi >= keys()[0] && pv.lo <= keys()[keys().length - 1]) h += '<div class="aft' + (/every open hour/.test(pv.words.after) ? " ok" : "") + '">' + esc(pv.words.after) + "</div>";
      h += "</div>";
      if (D.from !== "gaps" && D.from !== "clear") h += '<fieldset class="shf-fs"><legend>Days that already have a shift</legend><div class="shf-row"><button type="button" class="shf-tg" data-act="dlg-mode" data-v="keep" aria-pressed="' + (pv.plan.mode !== "replace") + '">Keep them</button><button type="button" class="shf-tg" data-act="dlg-mode" data-v="replace" aria-pressed="' + (pv.plan.mode === "replace") + '">Replace them</button></div></fieldset>';
    }
    var n = c.add + c.remove;
    h += (D.err ? '<div class="shf-err" role="alert">' + esc(D.err) + "</div>" : "") + (D.prog ? '<p class="shf-prog" role="status">' + esc(D.prog) + "</p>" : "") +
      '<div class="shf-dacts"><button class="shf-btn l" data-act="dlg-back"' + (D.busy ? " disabled" : "") + ">" + (D.from === "clear" ? "Keep them" : "‹ Back") + '</button><button class="shf-btn" data-act="dlg-close"' + (D.busy ? " disabled" : "") + '>Cancel</button><button class="shf-btn ' + (D.from === "clear" ? "d" : "p") + '" data-act="dlg-apply" autofocus' + (n && !D.busy ? "" : " disabled") + ">" + esc(D.busy ? "Saving…" : pv.words.button) + "</button></div></div></div>";
    return h;
  }
  async function dlgApply() {
    var D = S.dlg; if (!D || !D.pv || D.busy || !RP()) return;
    var pv = D.pv, exps = pv.exps.filter(function (x) { return x.add.length || x.remove.length; });
    if (!exps.length) return;
    D.busy = true; D.err = ""; D.prog = "Saving…"; paintDlg();
    var res = await RP().apply(exps, { label: pv.words.title, onProgress: function (i, n) { D.prog = "Saving " + (n > 1 ? i + " of " + n : "") + "…"; var pg = S.mount.querySelector(".shf-prog"); if (pg) pg.textContent = D.prog; } });
    D.busy = false; D.prog = "";
    if (!res.done && !res.undoId) { D.err = res.words; paintDlg(); var ap = S.mount.querySelector('[data-act="dlg-apply"]'); if (ap) ap.focus(); return; }
    if (res.done && pv.plan.until && pv.plan.step === "usual" && RP().setPlan) { // "until changed": remembered so Plan shifts can offer to extend it
      for (var i = 0; i < exps.length; i++) { var u = usualOf(person(exps[i].staff_id)); try { await RP().setPlan(exps[i].staff_id, { rid: u && u.rid || null, from: pv.plan.from, through: pv.plan.to, keep: pv.plan.mode !== "replace" }); } catch (e) {} }
    }
    S.undo = { id: res.undoId, words: res.words, bad: !res.done }; S.dlg = null;
    if (res.done) { S.sel = {}; S.anchor = null; if (!S.wide && D.from !== "gaps") S.pick = false; }
    paintDlg(); await refreshRange(); paint(true);
    var ub = S.mount.querySelector('.shf-undo [data-act="undo"]') || S.mount.querySelector('[data-act="fill-open"]'); if (ub) ub.focus();
  }

  // ---- the person panel: details on the left of the grid (tap a name). Tabs come from the patterns and settings parts
  // when they are loaded (E.rotaPlan.ui.editor, E.rotaSet.ui.*); until then it says what is planned and links on. ----
  function openPerson(sid) { S.dlg = { kind: "person", sid: sid, tab: "week", back: '[data-act="person"][data-sid="' + sid + '"]' }; paintDlg(); mountPerson(); dlgFocus(); }
  function personTabs() {
    var t = [["week", "Usual week", RP() && RP().ui && RP().ui.editor ? function (el, p) { RP().ui.editor(el, p, { onSaved: function () { reloadStaff().then(function () { paint(true); }); }, onApply: function (pp) { var sid = pp && pp.id || p.id; S.dlg = { kind: "fill", f: newFill("usual"), back: '[data-act="fill-open"]' }; S.dlg.f.who = "one"; S.dlg.f.sid = String(sid); S.dlg.f.len = "12m"; setTo(S.dlg.f); paintDlg(); dlgFocus(); }, onCancel: closeDlg }); } : null]];
    var RS = E.rotaSet && E.rotaSet.ui;
    [["leave", "Leave", "leave"], ["avail", "When they can't work", "availability"], ["details", "Edit details", "details"]].forEach(function (x) { if (RS && typeof RS[x[2]] === "function") t.push([x[0], x[1], function (el, p) { RS[x[2]](el, { person: p, staff: S.staff, leaves: S.leaves, onSaved: function () { reloadStaff().then(function () { changed(); }); }, onGone: function () { closeDlg(); changed(); } }); }]); });
    return t;
  }
  function personHtml() {
    var D = S.dlg, p = person(D.sid), u = usualOf(p), tabs = personTabs(), n = planned(p.id), c = Number(p.contracted_hours) || 0;
    var sum = u ? u.weeks.map(function (w, i) { return (u.n > 1 ? "Week " + "ABCD"[i] + ": " : "") + (w.map(function (e, d) { return e ? DAY[d].slice(0, 3) + " " + e.start + "–" + e.end : ""; }).filter(Boolean).join(", ") || "off"); }).join(" · ") : "No usual week yet.";
    var h = '<div class="shf-ov"><div class="shf-dlg" role="dialog" aria-modal="true" aria-labelledby="shf-dlg-t"><h2 id="shf-dlg-t">' + esc(p.full_name) + '</h2><p class="s">' + esc(desig(p) + (c ? " · " + hrs(c * 60) + " h a week" : "") + " · " + hrs(n) + " h planned " + rangeWord()) + (p.phone ? " · " + esc(p.phone) : "") + "</p>";
    if (tabs.length > 1) h += '<div class="shf-row" role="tablist">' + tabs.map(function (t) { return '<button type="button" role="tab" class="shf-tg" data-act="dlg-ptab" data-v="' + t[0] + '" aria-selected="' + (D.tab === t[0]) + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>";
    var cur = tabs.filter(function (t) { return t[0] === D.tab; })[0] || tabs[0];
    h += '<div id="shf-pp" role="tabpanel" aria-label="' + esc((cur && cur[1]) || "Usual week") + '" style="margin-top:12px">' + (cur && cur[2] ? "" : '<p><b>Usual week:</b> ' + esc(sum) + '</p><p class="shf-hint">Put it on the rota with Fill… → Everyone’s usual pattern, or for chosen days with Usual pattern on the selection bar. Patterns, contact details and leave balances can also be changed in the classic screen (⋯).</p>') + "</div>";
    return h + '<div class="shf-dacts"><button class="shf-btn" data-act="dlg-pfill" data-sid="' + p.id + '">Fill ' + esc(first(p)) + "’s shifts…</button>" + '<button class="shf-btn p" data-act="dlg-close">Done</button></div></div></div>';
  }
  function mountPerson() { var D = S.dlg; if (!D || D.kind !== "person") return; var el = S.mount.querySelector("#shf-pp"), t = personTabs().filter(function (x) { return x[0] === D.tab; })[0] || personTabs()[0]; if (el && t && t[2]) { try { t[2](el, person(D.sid)); } catch (e) { el.textContent = "This part could not open: " + (e && e.message || e); } } }
  var dlgClick0 = dlgClick;
  dlgClick = function (a, b, ev) {
    if (a === "dlg-ptab") { S.dlg.tab = b.getAttribute("data-v"); paintDlg(); mountPerson(); var t = S.mount.querySelector('[data-act="dlg-ptab"][data-v="' + S.dlg.tab + '"]'); if (t) t.focus(); return; }
    if (a === "dlg-pfill") { var sid = b.getAttribute("data-sid"); S.dlg = { kind: "fill", f: newFill("days"), back: '[data-act="fill-open"]' }; S.dlg.f.who = "one"; S.dlg.f.sid = String(sid); paintDlg(); dlgFocus(); return; }
    if (a === "dlg-close" && S.dlg && S.dlg.kind !== "fill") return closeDlg();
    return dlgClick0(a, b, ev);
  };
  // Number keys 1–7 pick a way to fill from the Fill… menu.
  document.addEventListener("keydown", function (ev) {
    if (E.state.activeModuleId !== "shfreg" || !S.dlg || S.dlg.kind !== "fill" || S.dlg.f.step !== "menu" || !/^[1-7]$/.test(ev.key) || ev.ctrlKey || ev.metaKey || ev.altKey) return;
    var b = S.mount && S.mount.querySelectorAll(".shf-ch")[Number(ev.key) - 1]; if (b) { ev.preventDefault(); b.click(); }
  });

  E.registerModule({
    id: "shfreg", title: "Plan shifts", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) {
      var wk = E._shfWeek, gap = E._shfGap, sw = E._shfSwap; E._shfWeek = null; E._shfGap = null; E._shfSwap = null; // from Who's in: its week, a gap to fill, a shift to swap
      S.mount = ctx && ctx.mount; bind(S.mount);
      var v = stored("eikon_shf_view"); S.view = (gap || sw || wk) ? "week" : v === "month" ? "month" : "week"; S.role = stored("eikon_shf_role") || "";
      if (!ROLES.some(function (r) { return r[0] === S.role; })) S.role = "";
      S.monday = gap ? mondayOf(parse(gap.date)) : sw ? mondayOf(parse(sw.date)) : wk ? mondayOf(parse(wk)) : mondayOf(new Date()); S.month = new Date(new Date().getFullYear(), new Date().getMonth(), 1); if (S.view === "week") syncRange();
      S.shifts = []; S.form = null; S.msg = ""; S.ask = null; S.lvMsg = ""; S.busy = 0; S.saving = false; S.who = null; S.lv = null; S.sel = {}; S.anchor = null; S.dlg = null; S.menu = false; S.pick = false; S.undo = null;
      var wantLeave = E._shfLeaveNew; E._shfLeaveNew = false; // "Ask for leave" on Who's in opens the new request
      S.loading = true; // the first paint is the skeleton (an empty rota is only offered "Who works here?" once it is known to be empty)
      css(); S.extEl = null; paint(); document.removeEventListener("keydown", onKey); document.addEventListener("keydown", onKey);
      if (!S.rcBound) { S.rcBound = true; document.addEventListener("eikon:rota-changed", function () { changed(); }); }
      if (window.matchMedia && !S.mq) { S.mq = window.matchMedia("(min-width:1100px)"); var onMq = function () { if (E.state.activeModuleId === "shfreg" && S.wide !== wide()) E.whenFormIdle(S.mount, function () { paint(true); }); }; if (S.mq.addEventListener) S.mq.addEventListener("change", onMq); else if (S.mq.addListener) S.mq.addListener(onMq); }
      return load().then(function () {
        if (E.state.activeModuleId !== "shfreg" || S.error) return;
        if (S.jumpTo) { var j = S.jumpTo; S.jumpTo = null; jump(j); }
        if (wantLeave && leavers().length) openLeave();
        else if ((gap || sw) && !canPlan()) roMsg(); // roles round: Who's in offered a change this person cannot make
        else if (!canPlan() && !S.wide && !wk && E.modules && E.modules.rotreg && !S.roMine) { S.roMine = true; location.replace("#rotreg"); } // a phone without the rota right lands on their own two weeks (Who's in › Your next shifts), once per visit
        else if (gap && dayCover(gap.date).gaps.some(function (g) { return g.from === gap.from && g.to === gap.to; })) openGap(gap.date, gap);
        else if (sw) { var x = shiftById(sw.id); if (x) { S.form = editForm(x); openSwap(); } } // the shift tapped on Who's in, ready to swap
      });
    },
    destroy: function () { document.removeEventListener("keydown", onKey); S.dlg = null; S.drag = null; S.menu = false; }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("shfreg") < 0) E.UI2_DESTINATIONS.push("shfreg");
  if (E.UI2_PARENT) E.UI2_PARENT.shfreg = "team";
  E._shfTest = { S: S, buildPlan: buildPlan, runEngine: runEngine, paint: paint, paintCells: paintCells, keys: keys }; // for the tests
})();
