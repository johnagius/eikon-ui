/* Who's in, new layout: the week's rota, day by day: who works and when, who is on leave. Read only; planning
   shifts, patterns, leave requests and the calendar link stay in the classic Shifts screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, monday: null, staff: {}, shifts: [], leaves: [], loading: false, error: "" };
  var DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function plus(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return plus(x, -((x.getDay() + 6) % 7)); }
  function leaveLabel(t) { var x = String(t || "leave").trim(); x = x.charAt(0).toUpperCase() + x.slice(1); return /\s|leave/i.test(x) ? x : x + " leave"; } // annual → Annual leave
  function hm(t) { return String(t || "").slice(0, 5); }
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "")[0] || "?").toUpperCase() + ((p[1] || "")[0] || "").toUpperCase(); }
  function hue(n) { var h = 0; String(n || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }

  function css() {
    if (document.getElementById("eikon-rotreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-rotreg-css";
    st.textContent =
      ".rot{max-width:880px;margin:0 auto}" +
      ".rot-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".rot h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.rot-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".rot-nav{display:flex;align-items:center;gap:8px;margin-top:16px}.rot-nav b{flex:1;text-align:center;font-size:15px;font-weight:600}" +
      ".rot-nav button{font:inherit;font-size:20px;line-height:1;width:36px;height:36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".rot-nav .now{font-size:13px;font-weight:600;width:auto;padding:0 12px}" +
      ".rot-day{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-top:10px;overflow:hidden}.rot-day.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}" +
      ".rot-day .h{display:flex;justify-content:space-between;align-items:baseline;padding:10px 14px 6px}.rot-day .h b{font-size:15px;font-weight:700}.rot-day .h span{font-size:12.5px;color:var(--muted)}.rot-day.today .h b{color:var(--accent)}" +
      ".rot-p{display:flex;align-items:center;gap:10px;padding:8px 14px;border-top:.5px solid var(--border)}" +
      ".rot-av{flex:0 0 30px;height:30px;border-radius:15px;color:#fff;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center}" +
      ".rot-p .t{flex:1;min-width:0}.rot-p .t b{font-size:14.5px;font-weight:600}.rot-p .t span{display:block;font-size:12px;color:var(--muted)}.rot-p em{font-style:normal;font-variant-numeric:tabular-nums;font-size:14px;font-weight:600}" +
      ".rot-p.off{opacity:.75}.rot-p.off em{font-weight:500;color:var(--warn,#A06A0E)}" +
      ".rot-empty{padding:22px 18px;display:flex;flex-direction:column;align-items:flex-start;gap:6px}.rot-empty b{font-size:17px}.rot-empty span{color:var(--muted);font-size:14px}" +
      ".rot-btn{font:inherit;font-size:14px;font-weight:600;height:36px;padding:0 16px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;margin-top:8px}.rot-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".rot-day.none .h{padding:11px 14px}.rot-day.none:not(.today) .h b{font-weight:600;color:var(--muted)}" +
      ".rot-none{padding:8px 14px 12px;color:var(--muted);font-size:13.5px}" +
      ".rot-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.rot{padding:4px 16px 0}.rot h1{font-size:32px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var from = ymd(S.monday), to = ymd(plus(S.monday, 6)), years = [S.monday.getFullYear(), plus(S.monday, 6).getFullYear()].filter(function (y, i, a) { return a.indexOf(y) === i; });
    try {
      var res = await Promise.all([E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }), E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to, { method: "GET" })]
        .concat(years.map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }).catch(function () { return null; }); })));
      if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) throw new Error((res[1] && res[1].error) || (res[0] && res[0].error) || "Could not load the rota");
      S.staff = {}; (res[0].staff || []).forEach(function (p) { S.staff[p.id] = p; });
      S.shifts = res[1].shifts || [];
      S.leaves = [].concat.apply([], res.slice(2).map(function (r) { return (r && r.ok && r.leaves) || []; }))
        .filter(function (l) { var st = String(l.status || "").toLowerCase(); return (st === "approved" || st === "pending") && l.end_date >= from && l.start_date <= to; }); // approved and still-asked leave; refused leave is not shown
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the rota"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function weekHas() {
    var a = ymd(S.monday), z = ymd(plus(S.monday, 6));
    return S.shifts.some(function (x) { return x.shift_date >= a && x.shift_date <= z; }) || S.leaves.some(function (l) { return l.start_date <= z && l.end_date >= a; });
  }
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "rotreg") return; // left before a reply came back: do not draw over the next screen
    var sun = plus(S.monday, 6), thisWeek = ymd(mondayOf(new Date())) === ymd(S.monday);
    var label = S.monday.getDate() + " " + MON[S.monday.getMonth()] + " – " + sun.getDate() + " " + MON[sun.getMonth()];
    var h = '<div class="rot"><button class="rot-back" data-act="back">‹ Team</button><h1>Who\'s in</h1><p class="rot-sub">The week\'s rota: who works, when, and who is away.</p>' +
      '<div class="rot-nav"><button data-act="prev" aria-label="Previous week">‹</button><b>' + esc(label) + "</b>" + (thisWeek ? "" : '<button class="now" data-act="now">This week</button>') + '<button data-act="next" aria-label="Next week">›</button></div>';
    if (S.loading && !S.shifts.length) h += '<div class="rot-quiet">Opening the rota…</div>';
    else if (S.error) h += '<div class="rot-quiet">' + esc(S.error) + "</div>";
    else if (!weekHas()) {
      // An empty week reads as one quiet card, not seven "No one on the rota" boxes.
      h += '<div class="rot-day rot-empty"><b>Nothing planned this week</b><span>No shifts and no leave from ' + esc(label.replace(" – ", " to ")) + '.</span>' +
        '<button class="rot-btn p" data-act="classic">Plan shifts</button></div>';
    }
    else {
      var today = ymd(new Date());
      for (var i = 0; i < 7; i++) {
        var d = plus(S.monday, i), key = ymd(d);
        var day = S.shifts.filter(function (x) { return x.shift_date === key; });
        var away = S.leaves.filter(function (l) { return l.start_date <= key && l.end_date >= key; });
        var empty = !day.length && !away.length; // a day with nobody is one slim line, so the working days stand out
        h += '<div class="rot-day' + (key === today ? " today" : "") + (empty ? " none" : "") + '"><div class="h"><b>' + (key === today ? "Today" : DAY[i]) + "</b><span>" + d.getDate() + " " + MON[d.getMonth()] + (day.length ? " · " + day.length + (day.length === 1 ? " shift" : " shifts") : "") + (empty ? " · Nobody on" : "") + "</span></div>";
        h += day.map(function (x) {
          var p = S.staff[x.staff_id] || { full_name: "Staff #" + x.staff_id };
          return '<div class="rot-p"><span class="rot-av" style="background:hsl(' + hue(p.full_name) + ',45%,42%)">' + esc(initials(p.full_name)) + '</span><div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(x.role_override || p.designation || "") + (x.notes ? " · " + esc(x.notes) : "") + "</span></div><em>" + esc(hm(x.start_time)) + "–" + esc(hm(x.end_time)) + "</em></div>";
        }).join("");
        h += away.map(function (l) {
          var p = S.staff[l.staff_id] || { full_name: "Staff #" + l.staff_id };
          return '<div class="rot-p off"><span class="rot-av" style="background:hsl(' + hue(p.full_name) + ',20%,55%)">' + esc(initials(p.full_name)) + '</span><div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(leaveLabel(l.leave_type)) + "</span></div><em>" + (String(l.status).toLowerCase() === "pending" ? "Asked for leave" : "Away") + (l.start_time && l.start_date === key ? " from " + esc(hm(l.start_time)) : "") + "</em></div>";
        }).join("");
        h += "</div>";
      }
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Planning shifts, patterns, leave requests and the calendar link are in the <a href="#" data-act="classic" style="color:var(--accent)">classic Shifts screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = "#team";
        else if (a === "prev") { S.monday = plus(S.monday, -7); S.shifts = []; load(); }
        else if (a === "next") { S.monday = plus(S.monday, 7); S.shifts = []; load(); }
        else if (a === "now") { S.monday = mondayOf(new Date()); S.shifts = []; load(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "rotreg"); } catch (x) {} E.openClassic("shifts"); }
      });
    });
  }

  E.registerModule({
    id: "rotreg", title: "Who's in", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.monday = mondayOf(new Date()); S.shifts = []; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("rotreg") < 0) E.UI2_DESTINATIONS.push("rotreg");
  if (E.UI2_PARENT) E.UI2_PARENT.rotreg = "team";
})();
