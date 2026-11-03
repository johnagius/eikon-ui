/* Plan shifts, new layout: the planning side of Who's in. The same week, day by day; add a shift for a person on a day,
   change its times or note, remove it (after a confirm); answer leave requests (approve or refuse). Same endpoints and
   the same checks as the classic Shifts screen: end after start, nobody planned on a day of approved leave, a warning
   before two pharmacists overlap, a warning before approving a pharmacist's leave with no one to cover.
   A change sends the shift's whole record (the server writes start, end, role and note together), so the role a
   pattern set is kept. Patterns, opening hours, new leave requests, staff, balances and the calendar link stay in the
   classic Shifts screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, monday: null, staff: {}, shifts: [], leaves: [], hours: null, loading: false, error: "", leaveErr: "", form: null, saving: false, ask: null, busy: 0, lvMsg: "" };
  var DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
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
  // Opening hours for a day, read the way the classic screen reads them: a one-day override, the weekly hours, then the old default.
  function hoursFor(key) {
    var oh = S.hours || {}, ov = (oh.overrides || {})[key], dw = parse(key).getDay();
    if (ov) return { open: ov.open || "", close: ov.close || "", closed: truthy(ov.closed) };
    var wk = oh.weekly && (oh.weekly[dw] || oh.weekly[String(dw)]);
    var def = oh["default"] || {};
    if (wk) return { open: wk.open || def.open || "07:30", close: wk.close || def.close || "19:30", closed: truthy(wk.closed) };
    var sat = oh.openSaturday, sun = oh.openSunday;
    if (typeof oh.weekends === "boolean") { if (sat == null) sat = oh.weekends; if (sun == null) sun = oh.weekends; }
    if (sat == null) sat = true; if (sun == null) sun = false;
    return { open: def.open || "07:30", close: def.close || "19:30", closed: truthy(def.closed) || (dw === 6 && !sat) || (dw === 0 && !sun) };
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
      ".shf-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".shf h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.shf-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".shf-nav{display:flex;align-items:center;gap:8px;margin-top:16px}.shf-nav b{flex:1;min-width:0;text-align:center;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".shf-nav button{font:inherit;font-size:20px;line-height:1;width:36px;height:36px;flex:0 0 36px;border-radius:18px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".shf-nav .now{font-size:13px;font-weight:600;width:auto;flex:0 0 auto;padding:0 12px}" +
      ".shf-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.shf-lab b{color:var(--text)}" +
      ".shf-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".shf-day{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-top:10px;overflow:hidden}.shf-day.today{border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}" +
      ".shf-day .h{display:flex;justify-content:space-between;align-items:baseline;gap:8px;padding:10px 14px 6px}.shf-day .h b{font-size:15px;font-weight:700}.shf-day .h span{font-size:12.5px;color:var(--muted);min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shf-day.today .h b{color:var(--accent)}" +
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
      ".shf-form .acts .q{flex:1 1 100%;font-size:14px}" +
      ".shf-err{color:var(--danger);font-size:13.5px;padding:8px 14px 0}" +
      ".shf-warn{font-size:13.5px;margin:8px 14px 0;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.14);line-height:1.4}" +
      ".shf-lv{padding:10px 14px;border-top:.5px solid var(--border)}.shf-lv:first-child{border-top:0}.shf-lv .top{display:flex;align-items:center;gap:10px}" +
      ".shf-lv .t{flex:1;min-width:0}.shf-lv .t b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.shf-lv .t span{display:block;font-size:12.5px;color:var(--muted)}" +
      ".shf-lv .why{font-size:13.5px;margin:6px 0 0 40px}.shf-lv .cov{font-size:12.5px;margin:4px 0 0 40px;color:var(--muted)}.shf-lv .cov.bad{color:var(--danger);font-weight:600}" +
      ".shf-lv .acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:8px}.shf-lv .acts .q{flex:1 1 100%;font-size:14px}" +
      ".shf-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".shf-note{font-size:12.5px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.shf{padding:4px 16px 0}.shf h1{font-size:32px}}";
    document.head.appendChild(st);
  }

  function years() { var a = [S.monday.getFullYear(), plus(S.monday, 6).getFullYear(), new Date().getFullYear()]; return a.filter(function (y, i) { return a.indexOf(y) === i; }); }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var from = ymd(S.monday), to = ymd(plus(S.monday, 6)), ys = years();
    try {
      var res = await Promise.all([E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }), E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to, { method: "GET" }),
        E.apiFetch("/shifts/opening-hours", { method: "GET" }).catch(function () { return null; })]
        .concat(ys.map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }).catch(function () { return null; }); })));
      if (!res[0] || !res[0].ok || !res[1] || !res[1].ok) throw new Error((res[1] && res[1].error) || (res[0] && res[0].error) || "Could not load the rota");
      if (from !== ymd(S.monday)) return; // the week changed while this was loading: the newer load paints
      S.staff = {}; (res[0].staff || []).forEach(function (p) { S.staff[p.id] = p; });
      S.shifts = (res[1].shifts || []).slice().sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
      S.hours = res[2] && res[2].ok ? res[2].hours : S.hours;
      var lv = res.slice(3), seen = {};
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
    else if (a === "gap") h += '<span class="q">Approving leaves the pharmacy without a pharmacist on these days. Approve anyway?</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn p" data-act="lv-approve-yes" data-id="' + l.id + '"' + dis + ">Approve anyway</button>";
    else if (a === "locum") h += '<span class="q">Make sure a locum shift is planned for these days.</span><button class="shf-btn" data-act="lv-keep">Not yet</button><button class="shf-btn p" data-act="lv-approve-yes" data-id="' + l.id + '"' + dis + ">Approve</button>";
    else h += '<button class="shf-btn" data-act="lv-refuse" data-id="' + l.id + '"' + dis + ' aria-label="Refuse ' + esc(p.full_name) + "'s leave\">Refuse</button>" + '<button class="shf-btn p" data-act="lv-approve" data-id="' + l.id + '"' + dis + ' aria-label="Approve ' + esc(p.full_name) + "'s leave\">Approve</button>";
    return h + "</div></div>";
  }

  function formHtml(key) {
    var f = S.form, h = '<form class="shf-form" id="shf-form" autocomplete="off">';
    if (f.mode === "add") {
      var free = active().filter(function (p) { return !approvedOn(p.id, key); });
      h += '<label><span>Who</span><select name="staff_id"><option value="">Choose a person</option>' + free.map(function (p) { return '<option value="' + p.id + '"' + (String(f.staff_id) === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + (desig(p) ? " · " + esc(desig(p)) : "") + "</option>"; }).join("") + "</select></label>";
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
    if (f.confirmDel) h += '<span class="q">Remove this shift? It is taken off the rota.</span><button type="button" class="shf-btn" data-act="del-no">Keep it</button><button type="button" class="shf-btn d" data-act="del-yes"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Removing…" : "Remove") + "</button>";
    else {
      if (f.mode === "edit") h += '<button type="button" class="shf-btn x" data-act="del">Remove shift</button>';
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
    var h = '<div class="shf"><button class="shf-back" data-act="back">‹ Team</button><h1>Plan shifts</h1><p class="shf-sub">Who works when: add, change or remove a shift, and answer leave requests.</p>';
    if (S.loading && !Object.keys(S.staff).length) h += '<div class="shf-quiet">Opening the rota…</div>';
    else if (S.error) h += '<div class="shf-quiet">' + esc(S.error) + "</div>";
    else {
      var pending = S.leaves.filter(function (l) { return low(l.status) === "pending"; }).sort(function (a, b) { return String(a.start_date).localeCompare(String(b.start_date)); });
      if (pending.length || S.lvMsg) {
        h += '<div class="shf-lab">Leave requests <b>' + pending.length + "</b></div>";
        if (S.lvMsg) h += '<div class="shf-err" role="alert" style="padding:0 2px 6px">' + esc(S.lvMsg) + "</div>";
        if (pending.length) h += '<div class="shf-card">' + pending.map(leaveHtml).join("") + "</div>";
      }
      if (S.leaveErr) h += '<p class="shf-note">' + esc(S.leaveErr) + "</p>";
      if (!active().length) h += '<div class="shf-quiet">No staff on the rota yet. Add the team in the <a href="#" data-act="classic" style="color:var(--accent)">classic Shifts screen</a> first.</div>';
      h += '<div class="shf-nav"><button data-act="prev" aria-label="Previous week">‹</button><b>' + esc(label) + "</b>" + (thisWeek ? "" : '<button class="now" data-act="now">This week</button>') + '<button data-act="next" aria-label="Next week">›</button></div>';
      var today = ymd(new Date());
      for (var i = 0; i < 7; i++) {
        var d = plus(S.monday, i), key = ymd(d), oh = hoursFor(key);
        var day = S.shifts.filter(function (x) { return x.shift_date === key; });
        var away = S.leaves.filter(function (l) { var st = low(l.status); return (st === "approved" || st === "pending") && l.start_date <= key && l.end_date >= key; });
        var info = d.getDate() + " " + MON[d.getMonth()] + (day.length ? " · " + day.length + (day.length === 1 ? " shift" : " shifts") : "") + (oh.closed ? " · Closed" : oh.open && oh.close && !day.length ? " · Open " + hm(oh.open) + "–" + hm(oh.close) : "");
        h += '<section class="shf-day' + (key === today ? " today" : "") + '" aria-label="' + esc(DAY[i] + " " + d.getDate() + " " + MON[d.getMonth()]) + '"><div class="h"><b>' + (key === today ? "Today" : DAY[i]) + "</b><span>" + esc(info) + "</span></div>";
        h += day.map(function (x) {
          if (S.form && S.form.mode === "edit" && Number(S.form.id) === Number(x.id)) return formHtml(key);
          var p = person(x.staff_id), off = approvedOn(x.staff_id, key);
          var sub = [x.role_override ? desig({ designation: x.role_override }) : desig(p), x.notes].filter(Boolean).map(esc).join(" · ");
          return '<button class="shf-p" data-act="edit" data-id="' + x.id + '" aria-label="Change ' + esc(p.full_name) + "'s shift, " + esc(hm(x.start_time)) + " to " + esc(hm(x.end_time)) + '">' + av(p.full_name) + '<span class="t"><b>' + esc(p.full_name) + "</b><span>" + (off ? '<span class="tag">On leave</span>' + (sub ? " · " : "") : "") + sub + "</span></span><em>" + esc(hm(x.start_time)) + "–" + esc(hm(x.end_time)) + '</em><span class="chev" aria-hidden="true"></span></button>';
        }).join("");
        h += away.map(function (l) {
          var p = person(l.staff_id);
          return '<div class="shf-p off">' + av(p.full_name, true) + '<div class="t"><b>' + esc(p.full_name) + "</b><span>" + esc(leaveLabel(l.leave_type)) + "</span></div><em>" + (low(l.status) === "pending" ? "Asked for leave" : "Away") + (l.start_time && l.start_date === key ? " from " + esc(hm(l.start_time)) : "") + "</em></div>";
        }).join("");
        if (S.form && S.form.mode === "add" && S.form.date === key) h += formHtml(key);
        else if (active().length) h += '<button class="shf-add" data-act="add" data-date="' + key + '" aria-label="Add a shift on ' + esc(DAY[i] + " " + d.getDate() + " " + MON[d.getMonth()]) + '">+ Add shift</button>';
        h += "</section>";
      }
    }
    h += '<p class="shf-note">Patterns, opening hours, new leave requests, staff, leave balances and the calendar link are in the <a href="#" data-act="classic" style="color:var(--accent)">classic Shifts screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var a = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (a === "back") window.location.hash = "#team";
        else if (a === "prev" || a === "next" || a === "now") { if (S.saving) return; S.form = null; S.ask = null; S.monday = a === "now" ? mondayOf(new Date()) : plus(S.monday, a === "prev" ? -7 : 7); S.shifts = []; load(); }
        else if (a === "add") { var key = b.getAttribute("data-date"), oh = hoursFor(key); S.form = { mode: "add", date: key, staff_id: "", start_time: hm(oh.open) || "09:00", end_time: hm(oh.close) || "18:00", notes: "", err: "", warn: "", warnSig: "" }; paint(true); focus("staff_id"); }
        else if (a === "edit") { var x = S.shifts.filter(function (s) { return Number(s.id) === id; })[0]; if (!x) return; S.form = { mode: "edit", id: x.id, date: x.shift_date, staff_id: x.staff_id, start_time: hm(x.start_time), end_time: hm(x.end_time), notes: x.notes || "", err: "", warn: "", warnSig: "" }; paint(true); focus("start_time"); }
        else if (a === "cancel") { S.form = null; paint(true); }
        else if (a === "del") { keep(); S.form.confirmDel = true; S.form.err = ""; paint(true); var y = m.querySelector('[data-act="del-no"]'); if (y) y.focus(); }
        else if (a === "del-no") { S.form.confirmDel = false; paint(true); }
        else if (a === "del-yes") remove();
        else if (a === "lv-approve") { var l = S.leaves.filter(function (z) { return Number(z.id) === id; })[0], c = l && cover(l); if (c && !c.alts) { S.ask = { id: id, kind: c.locum ? "locum" : "gap" }; paint(); } else answer(id, "approve"); }
        else if (a === "lv-approve-yes") answer(id, "approve");
        else if (a === "lv-refuse") { S.ask = { id: id, kind: "refuse" }; paint(); var k = m.querySelector('[data-act="lv-keep"]'); if (k) k.focus(); }
        else if (a === "lv-refuse-yes") answer(id, "reject");
        else if (a === "lv-keep") { S.ask = null; paint(); }
        else if (a === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "shfreg"); } catch (x2) {} E.openClassic("shifts"); }
      });
    });
    var f = m.querySelector("#shf-form"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); save(); });
  }
  function focus(n) { setTimeout(function () { var x = S.mount && S.mount.querySelector("#shf-form [name=" + n + "]"); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) x.focus(); }, 30); }

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
    if (f.err) return paint(true);
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
    S.saving = false; return load();
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
    S.saving = false; return load();
  }
  async function answer(id, what) {
    if (S.busy) return;
    var l = S.leaves.filter(function (z) { return Number(z.id) === id; })[0], name = l ? person(l.staff_id).full_name : "";
    S.busy = id; S.lvMsg = ""; paint();
    try {
      var r = await E.apiFetch("/shifts/leaves/" + id + "/" + what, { method: "POST" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.ask = null; E.toast((what === "approve" ? "Leave approved for " : "Leave refused for ") + name, "success");
    } catch (x) { S.lvMsg = E.saveFailText(x); }
    S.busy = 0; return load();
  }

  E.registerModule({
    id: "shfreg", title: "Plan shifts", order: 3, icon: "◷", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.monday = mondayOf(new Date()); S.shifts = []; S.form = null; S.ask = null; S.lvMsg = ""; S.busy = 0; S.saving = false; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("shfreg") < 0) E.UI2_DESTINATIONS.push("shfreg");
  if (E.UI2_PARENT) E.UI2_PARENT.shfreg = "team";
})();
