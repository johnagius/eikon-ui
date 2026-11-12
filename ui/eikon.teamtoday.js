/* ============================================================
   EIKON — Today's team  (eikon.teamtoday.js, team-hub)
   The first thing on Team: open it and know in three seconds who is in, whether a pharmacist covers every open hour,
   and what you must read, then act in one tap. One calm list, what needs doing first: no pharmacist signed in (red),
   a gap in today's pharmacist cover (E.teamCover, the Shifts screen's rule, from rota; no gap line without it), the
   handover not read by you, @mentions on the chat board, leave requests waiting (the pharmacist only); then who is on
   now, later and finished, and who is away. The same answer puts a short status under the hub's own cards.
   Cost: ONE read, GET /team/today (contract T-C1: bounded statements on the server, each by the pharmacy and a date, a
   short range or a LIMIT), when the hub opens; within a minute of the last answer, for the same pharmacy and with
   nothing saved since, nothing is asked. No timer. Today is not touched (it is re-read every minute).
   Rights are the server's: admin and staff. Anyone else (403), or a server without the route (404), sees the cards as
   before, with no list and no status. Board messages a group keeps to itself are counted by the server's own rule only.
   E.teamToday.data / .at (T-C4): the last answer, for any other screen to read without asking.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var FRESH_MS = 60000;
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WDAY = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // The rota's words for a role (modules.rotreg.js / shfreg.js DESIG): the same word on every screen
  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  var S = { data: null, at: 0, loc: "", job: null, error: "", hidden: false, slot: null, list: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function mins(t) { var m = /^(\d{1,2}):(\d{2})/.exec(String(t || "")); return m ? (+m[1]) * 60 + (+m[2]) : NaN; }
  function role(p) { var o = low(p.role_override), d = low(p.designation); return DESIG[o] || DESIG[d] || p.role_override || p.designation || ""; }
  function isPharm(p) { var d = low(p.designation); return d === "pharmacist" || d === "locum" || low(p.role_override) === "pharmacist"; }
  function leaveLabel(t) { var x = String(t || "leave").replace(/_/g, " ").trim(); x = x.charAt(0).toUpperCase() + x.slice(1); return /\s|leave/i.test(x) ? x : x + " leave"; } // shfreg's words: "Annual leave", "Sick leave"
  function dayWord(ymd, today) { // "yesterday", or the weekday ("Saturday") of an older day
    if (!ymd) return "";
    var a = Date.parse(ymd + "T12:00:00Z"), b = Date.parse(today + "T12:00:00Z"), n = Math.round((b - a) / 86400000);
    return n === 1 ? "yesterday" : WDAY[new Date(ymd + "T12:00:00Z").getUTCDay()];
  }
  function shortDay(ymd) { var p = String(ymd || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + SHORT[+p[1] - 1] : String(ymd || ""); }
  function nowHm(D) { var t = E.maltaHm ? E.maltaHm() : ""; return D && D.date === (E.maltaYmd ? E.maltaYmd() : D.date) && t ? t : (D && D.now) || ""; }

  // ---------- the day (pure: the same data at the same minute always gives the same answer) ----------
  // Opening hours and cover: E.teamCover (rota, T-C2) when it is in the build; without it the day's hours as the server
  // read them, a public holiday closed unless a one-day override opens it (D1), and no gap line.
  function cover(D) {
    var h = D.hours || {}, dow = new Date(D.date + "T12:00:00Z").getUTCDay();
    var fallback = { closed: !!h.closed || !!(D.holiday && !h.override), holiday: D.holiday && !h.override ? D.holiday : null, open: h.open || "", close: h.close || "", gaps: null };
    if (typeof E.teamCover !== "function") return fallback;
    try {
      var day = { open: h.open, close: h.close, closed: !!h.closed }, hours = {};
      if (h.override) { hours.overrides = {}; hours.overrides[D.date] = day; } else { hours.weekly = {}; hours.weekly[dow] = day; }
      var staff = {}; (D.shifts || []).forEach(function (s) { staff[s.staff_id] = { id: s.staff_id, full_name: s.full_name, designation: s.designation }; });
      (D.leave || []).forEach(function (l) { if (!staff[l.staff_id]) staff[l.staff_id] = { id: l.staff_id, full_name: l.full_name, designation: "" }; });
      var c = E.teamCover(D.date, {
        hours: hours, settings: D.settings || {},
        shifts: (D.shifts || []).map(function (s) { return { staff_id: s.staff_id, shift_date: D.date, start_time: s.start_time, end_time: s.end_time, role_override: s.role_override }; }),
        staff: Object.keys(staff).map(function (k) { return staff[k]; }),
        leaves: (D.leave || []).map(function (l) { return { staff_id: l.staff_id, status: "approved", start_date: l.start_date || D.date, end_date: l.end_date || D.date, leave_type: l.leave_type }; })
      }) || {};
      return { closed: !!c.closed, holiday: c.holiday || null, open: c.open || h.open || "", close: c.close || h.close || "", gaps: Array.isArray(c.gaps) ? c.gaps : [], words: c.words || "" };
    } catch (e) { return fallback; }
  }
  function people(D, now) { // on now, later today, finished, away (approved leave covering today)
    var away = {}, out = { now: [], later: [], done: [], away: [] }, n = mins(now);
    (D.leave || []).forEach(function (l) { away[l.staff_id] = l; });
    (D.shifts || []).forEach(function (s) {
      var p = { id: s.staff_id, name: s.full_name || "Someone on the rota", role: role(s), pharm: isPharm(s), from: s.start_time, to: s.end_time, phone: s.phone || "" };
      if (away[s.staff_id]) { p.leave = away[s.staff_id]; out.away.push(p); return; }
      var a = mins(s.start_time), z = mins(s.end_time);
      (n >= z ? out.done : n < a ? out.later : out.now).push(p);
    });
    var seen = {}; out.away.forEach(function (p) { seen[p.id] = 1; });
    (D.leave || []).forEach(function (l) { if (!seen[l.staff_id]) { seen[l.staff_id] = 1; out.away.push({ id: l.staff_id, name: l.full_name || "Someone on the rota", role: "", leave: l }); } });
    return out;
  }
  // The pharmacist in charge now, from the locum register: signed in at or before now, and not yet out
  function inCharge(D, now) {
    var n = mins(now), es = D.locum_today || [];
    var on = es.filter(function (e) { var a = mins(e.time_in), z = mins(e.time_out); return !(a > n) && (!isFinite(z) || z > n || z <= a); });
    return { on: on, all: es, last: es[es.length - 1] || null };
  }
  // This person's "Got it" on the handover, on this device (Handover screen: localStorage eikon_hnd_read_<userId>),
  // when the server cannot say (seen_by_me null: the handover's own table is not in yet)
  function readHere(H) {
    if (!H || !H.from_ymd) return null;
    try {
      if (typeof E.handoverRead === "function") { var r = E.handoverRead(H.from_ymd, (H.ids || []).join(",")); if (r) return r; }
      var uid = E.state && E.state.user && (E.state.user.id || E.state.user.user_id);
      var v = JSON.parse(localStorage.getItem("eikon_hnd_read_" + uid) || "null");
      if (!v || v.from !== H.from_ymd) return null;
      var had = String(v.ids || "").split(","), ids = H.ids || [];
      return ids.length && ids.every(function (id) { return had.indexOf(id) >= 0; }) ? { at: v.at } : null;
    } catch (e) { return null; }
  }
  function handoverRead(H) { return H.seen_by_me === true || !!readHere(H); } // the server's "I've read it" (T-C3), else this device's "Got it"

  // FIN-dayzero: a pharmacy in its first two days (started today or yesterday, E.startYmd / the server's `since`) with
  // nobody on the rota yet is getting ready, not failing: no red "Needs you now", one calm "to do" per step instead.
  function addDay(ymd, k) { var d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + k); return d.toISOString().slice(0, 10); }
  function startOf(D) { var s = D && /^\d{4}-\d{2}-\d{2}$/.test(String(D.since || "")) ? D.since : (E.startYmd ? E.startYmd() : ""); return s || ""; }
  function gettingReady(D) { var s = startOf(D); return !!(s && D && D.date && s >= addDay(D.date, -1) && !(D.shifts || []).length); }

  // Each item: { key, title, status: problem | todo | info | done, text, hot?, act, aria?, go: "#screen" | { tel } }
  function items(D, opts) {
    if (!D) return [];
    opts = opts || {};
    var out = [], add = function (o) { out.push(o); }, now = opts.now || nowHm(D), n = mins(now), c = cover(D), ready = gettingReady(D);
    var open = !c.closed && isFinite(mins(c.open)) && isFinite(mins(c.close)), openNow = open && n >= mins(c.open) && n < mins(c.close), before = open && n < mins(c.open);

    // A new pharmacy getting ready: what to set up, in order (FIN-dayzero)
    if (ready && opts.admin) { // the admin's to set up; staff are not asked for what they cannot do
      if (D.hours_saved === false) add({ key: "setup:hours", title: "Set your opening hours", status: "todo", text: "Then the rota and the registers know when you are open.", act: "Set hours", aria: "Set your opening hours", go: { sheet: "hours" } });
      add({ key: "setup:rota", title: "Plan who works here", status: "todo", text: "Add the people on the rota and their shifts. Until then nobody is on today.", act: "Plan shifts", aria: "Plan shifts", go: "#shfreg" });
    }

    // The pharmacist in charge (the locum register): nobody recorded while open is the one red row (W13: say what to do)
    if (D.locum_today) {
      var P = inCharge(D, now), e0 = P.on[0], was = P.last ? P.last.locum_full_name + " signed out at " + P.last.time_out + ". " : "";
      if (e0) add({ key: "pic", title: "Pharmacist in charge", status: "done", text: e0.locum_full_name + (e0.registration_number ? " (reg no " + e0.registration_number + ")" : "") + ", since " + e0.time_in + (e0.time_out && mins(e0.time_out) > mins(e0.time_in) ? ", until " + e0.time_out : "") + (P.on.length > 1 ? ", and " + plural(P.on.length - 1, "more") : "") + ".", act: "Open", aria: "Open the locum register", go: "#locreg" });
      else if (openNow && ready) add({ key: "pic", title: "Pharmacist in charge not recorded", status: "todo", text: "When the pharmacist is in, record them in the locum register: one tap.", act: opts.admin ? "Record" : "Open", quiet: !opts.admin, aria: "Record the pharmacist in charge in the locum register", go: "#locreg" });
      else if (openNow) add(opts.admin ? { key: "pic", title: "Pharmacist in charge not recorded", status: "problem", text: was + "Record who is in charge now in the locum register.", act: "Record", aria: "Record the pharmacist in charge in the locum register", go: "#locreg" }
        : { key: "pic", title: "Pharmacist in charge not recorded", status: "problem", text: was + "Ask the pharmacist in charge to record themselves.", act: "Open", quiet: true, aria: "Open the locum register", go: "#locreg" }); // staff: not theirs to sign (VISUAL TH3)
      else if (before) add({ key: "pic", title: "Pharmacist in charge", status: "info", text: "Nobody signed in yet. We open at " + c.open + ".", act: opts.admin ? "Sign in" : "Open", aria: "Sign in as the pharmacist in charge in the locum register", go: "#locreg" });
      else if (P.all.length) add({ key: "pic", title: "Pharmacist in charge", status: "done", text: P.all.map(function (e) { return e.locum_full_name + " " + e.time_in + "–" + e.time_out; }).join(", ") + ".", act: "Open", aria: "Open the locum register", go: "#locreg" });
    }

    // Gaps in today's pharmacist cover still to come (E.teamCover): "No pharmacist 13:00–16:00", one row each.
    // Not while getting ready: "Plan who works here" says it once, calmly.
    (ready ? [] : (c.gaps || [])).forEach(function (g) {
      var a = g.from || g.start, z = g.to || g.end; if (!(mins(z) > n)) return; // a gap already over is past
      var nowIn = mins(a) <= n;
      add({ key: "gap:" + a, title: "No pharmacist " + a + "\u2013" + z, status: "problem", text: nowIn ? "Right now, until " + z + ". Ask a pharmacist to come in, then add the shift." : "Today: nobody on the rota covers it yet.", hot: nowIn ? "Right now" : "", act: "Fill the gap", aria: "Fill the gap " + a + " to " + z + " in Plan shifts", go: "#shfreg", gap: { date: D.date, from: a, to: z } });
    });

    // The handover left for today
    var H = D.handover;
    if (H && H.total) {
      var read = handoverRead(H), from = dayWord(H.from_ymd, D.date), what = H.critical ? plural(H.critical, "critical point") + (H.total > H.critical ? " and " + plural(H.total - H.critical, "other") : "") : plural(H.total, "point");
      if (read) add({ key: "hnd", title: "Handover", status: "done", text: "You read what " + (from === "yesterday" ? "yesterday" : from) + " left: " + what + ".", act: "Open", aria: "Open the handover", go: "#hndreg" });
      else add({ key: "hnd", title: "Handover from " + from, status: "todo", text: what.charAt(0).toUpperCase() + what.slice(1) + ". Not read by you yet.", hot: "Not read by you yet", act: "Read", aria: "Read the handover from " + from, go: "#hndreg" });
    }

    // The chat board: mentions of you first, then new messages (the server counts only what this person may see)
    var B = D.board;
    if (B && B.unread_mentions) {
      var m0 = (B.mentions || [])[0], more = B.unread_mentions - 1;
      add({ key: "men", title: "Mentioned you" + (m0 ? ": " + (m0.location_name || m0.user_name) : ""), status: "todo",
        text: (m0 ? (m0.group_only ? "Only your group sees this. " : "") + "“" + String(m0.body || "").replace(/\s+/g, " ").slice(0, 120) + "”" + (m0.user_name && m0.location_name ? " — " + m0.user_name : "") : "") + (more > 0 ? " And " + plural(more, "more mention") + "." : ""),
        act: "Open", aria: "Open the chat board", go: "#brdreg" });
    }
    if (B && B.unread_messages > (B.unread_mentions || 0)) {
      var nm = B.unread_messages - (B.unread_mentions || 0);
      add({ key: "brd", title: "Chat board", status: "info", text: (B.unread_messages >= 100 ? "Over 99 new messages" : plural(nm, "new message")) + " since you last looked.", /* the server counts up to 100 */ act: "Open", aria: "Open the chat board", go: "#brdreg" });
    }

    // Leave requests waiting for an answer (the pharmacist only; the server sends null to anyone else)
    if (D.leave_pending) add({ key: "lv", title: "Leave requests", status: "todo", text: plural(D.leave_pending, "request") + " waiting for your answer.", hot: "waiting for your answer", act: "Answer", aria: "Answer leave requests in Plan shifts", go: "#shfreg" });
    return out;
  }
  var RANK = { problem: 0, todo: 1, info: 2, done: 3 };
  function sorted(list) { return list.map(function (x, i) { return { x: x, i: i }; }).sort(function (a, b) { return RANK[a.x.status] - RANK[b.x.status] || a.i - b.i; }).map(function (o) { return o.x; }); }

  // The line at the top, in words: "Open 08:00–20:00 · 4 on today · Pharmacist: Maria Borg until 13:00, then Joe Vella from 13:00"
  function headText(D, now) {
    var c = cover(D);
    if (c.closed) return (c.words || ("Closed" + (c.holiday ? " · Public holiday (" + c.holiday + ")" : ""))) + "."; // E.teamCover's words (Director X3)
    var bits = [];
    if (c.open && c.close) bits.push("Open " + c.open + "–" + c.close);
    var on = (D.shifts || []).length - (people(D, now).away.filter(function (p) { return p.from; }).length);
    bits.push(on ? plural(on, "person", "people") + " on today" : gettingReady(D) ? "Getting ready: no rota yet" : "Nobody on the rota today");
    var n = mins(now), ph = (D.shifts || []).filter(function (s) { return isPharm(s) && !(D.leave || []).some(function (l) { return l.staff_id === s.staff_id; }) && mins(s.end_time) > n && !(mins(s.start_time) >= mins(c.close)); }) // not a shift after closing
      .sort(function (a, b) { return mins(a.start_time) - mins(b.start_time); });
    // Two shifts in turn: "Maria Borg until 13:00, then Joe Vella from 13:00". When they overlap (the second starts before
    // the first ends) "then" would be wrong: "Maria Borg until 14:00, with Kurt Zahra from 13:00".
    if (ph.length) bits.push("Pharmacist: " + ph.slice(0, 2).map(function (s, i) { return (i ? (mins(s.start_time) < mins(ph[0].end_time) ? "with " : "then ") : "") + s.full_name + (mins(s.start_time) > n ? " from " + s.start_time : " until " + s.end_time); }).join(", "));
    return bits.join(" · ") + ".";
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
    S.job = E.apiFetch("/team/today", { method: "GET", timeoutMs: 12000 }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not check today's team");
      S.data = r; S.at = asked; S.loc = loc; S.error = ""; S.hidden = false;
      if (E.noteStart && r.since) E.noteStart(r.since); // FIN-dayzero
      API.data = r; API.at = asked; // T-C4
      return r;
    }).catch(function (e) {
      var st = e && e.status;
      if (st === 403 || st === 404) { S.hidden = true; S.data = null; S.at = asked; S.loc = loc; S.error = ""; API.data = null; return "hidden"; } // not this person's screens, or an older server: the cards as before
      S.error = e && e.network ? "No connection, so today's team could not be checked." : "Today's team could not be checked.";
      throw e;
    }).finally(function () { S.job = null; });
    return S.job;
  }

  function isAdmin() { return !!(E.state && E.state.user && E.state.user.role === "admin"); }
  function go(g) {
    if (!g) return;
    if (g.sheet && E.openHours) { E.openHours(); return; } // FIN-dayzero: the opening hours sheet, not the rota
    var id = String(g).replace(/^#/, "");
    if (E.modules && E.modules[id]) { window.location.hash = "#" + id; return; }
    var classic = { locreg: "locumregister", shfreg: "shifts", hndreg: "instructions", brdreg: "messageboard" }[id]; // not in this build: the classic screen
    try { sessionStorage.setItem("eikon_ui2_return", "team"); } catch (e) {}
    if (classic && E.openClassic) E.openClassic(classic); else window.location.hash = "#" + id;
  }

  // ---------- drawing ----------
  function css() {
    if (document.getElementById("eikon-tmt-css")) return;
    var st = document.createElement("style"); st.id = "eikon-tmt-css";
    st.textContent =
      ".tmt{margin:18px 0 4px}.tmt-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin:0 2px 8px}" +
      ".tmt-head h2{font-size:19px;font-weight:700;letter-spacing:-.015em;margin:0}.tmt-head small{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}" +
      ".tmt-sum{display:flex;align-items:center;gap:10px;padding:12px 16px;border:1px solid var(--border);border-radius:12px 12px 0 0;background:var(--panel2);font-size:15px;font-weight:600;border-bottom:0;font-variant-numeric:tabular-nums;line-height:1.4}" +
      ".tmt-sum.solo{border-radius:12px;border-bottom:1px solid var(--border)}" +
      ".tmt-list{margin:0;padding:0;list-style:none;background:var(--panel2);border:1px solid var(--border);border-radius:0 0 12px 12px;overflow:hidden}.tmt-list.solo{border-radius:12px}" +
      ".tmt-row{display:flex;align-items:center;gap:12px;padding:10px 12px 10px 16px;border-top:.5px solid var(--border);min-height:56px}.tmt-row:first-child{border-top:0}" +
      ".tmt-ic{width:22px;height:22px;border-radius:50%;flex:none;display:inline-flex;align-items:center;justify-content:center}.tmt-ic svg{display:block}" +
      ".tmt-row.done .tmt-ic{background:rgba(10,143,106,.14);color:var(--ok,#0A8F6A)}.tmt-row.todo .tmt-ic{border:2px solid #C98A12}.tmt-row.problem .tmt-ic{background:var(--danger,#C0392B);color:#fff}.tmt-row.info .tmt-ic{visibility:hidden}" +
      ".tmt-t{flex:1 1 auto;min-width:0}.tmt-t b{display:block;font-size:15px;font-weight:600;letter-spacing:-.01em;overflow-wrap:anywhere}.tmt-t>span{display:block;font-size:13.5px;color:var(--muted);line-height:1.4;margin-top:1px;overflow-wrap:anywhere;font-variant-numeric:tabular-nums}" +
      ".tmt-row[data-tmt^='gap:'] .tmt-t b{white-space:nowrap}" + // "No pharmacist 13:00–16:00" never splits its times
      ".tmt-hot{font-style:normal;font-weight:600}.tmt-hot.todo{color:var(--warn,#8A5A08)}.tmt-hot.problem{color:var(--danger,#B42318)}" +
      ".tmt-btn{font:inherit;font-size:14px;font-weight:600;min-height:40px;min-width:72px;padding:0 14px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;flex:none;-webkit-tap-highlight-color:transparent;text-decoration:none;display:inline-flex;align-items:center;justify-content:center;box-sizing:border-box}" +
      ".tmt-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.tmt-btn.q{border-color:transparent;background:none;color:var(--accent);min-width:0;padding:0 8px}" +
      ".tmt-btn:hover{filter:brightness(.97)}.tmt-btn:active{filter:brightness(.9)}.tmt :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      // who is on today: one quiet list under the things to do
      ".tmt-who{margin-top:16px}.tmt-who h3{font-size:13px;font-weight:600;color:var(--muted);margin:14px 2px 6px}.tmt-who h3:first-child{margin-top:0}" +
      ".tmt-p{display:flex;align-items:center;gap:12px;padding:8px 12px 8px 16px;border-top:.5px solid var(--border);min-height:52px}.tmt-p:first-child{border-top:0}" +
      ".tmt-p .tmt-t b{font-size:15px}.tmt-p em{font-style:normal;font-size:14px;font-weight:600;font-variant-numeric:tabular-nums;white-space:nowrap;color:var(--text)}.tmt-p.off .tmt-t b,.tmt-p.off em{color:var(--muted);font-weight:500}" +
      ".tmt-call{flex:0 0 56px;width:56px;text-align:center}" +
      ".tmt-av{flex:0 0 30px;height:30px;border-radius:15px;font-size:12px;font-weight:700;display:flex;align-items:center;justify-content:center;color:#fff}" +
      ".tmt-sk{height:56px;border-top:.5px solid var(--border);background:linear-gradient(90deg,transparent,rgba(127,127,127,.08),transparent);background-size:200% 100%;animation:tmtSk 1.2s linear infinite}.tmt-sk:first-child{border-top:0}" +
      "@keyframes tmtSk{from{background-position:200% 0}to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.tmt-sk{animation:none}}" +
      ".tmt-err{display:flex;align-items:center;gap:12px;justify-content:space-between;padding:12px 16px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);font-size:14px}" +
      ".hub h2.tmt-all,html[data-ui2] .hub h2.tmt-all{font-size:19px;font-weight:700;letter-spacing:-.015em;text-transform:none;color:var(--text);margin:30px 2px 0}" +
      ".tmt-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.tmt-foot{font-size:12.5px;color:var(--muted);margin:8px 2px 0;line-height:1.5}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .tmt-btn.phtml[data-ui2]:not([data-ui2-visit]) .tmt-hot.todo{color:#E8B04A}}" +
      "@media (max-width:600px){.tmt-row,.tmt-p{gap:10px}.tmt-btn{min-height:44px;min-width:64px;padding:0 12px}.tmt-btn.q{min-width:44px;padding:0 6px}.tmt-head h2{font-size:20px}}" +
      // the status under a hub card: words first, a dot of colour for meaning (never colour alone)
      ".tmt-chip{display:flex;align-items:center;gap:6px;font-style:normal;font-size:12.5px;font-weight:600;margin-top:6px;color:var(--muted);font-variant-numeric:tabular-nums}.tmt-chip::before{content:'';width:7px;height:7px;border-radius:50%;flex:none;background:var(--ok,#0A8F6A)}" +
      ".tmt-chip.info::before{display:none}.tmt-chip.todo::before{background:#C98A12}.tmt-chip.problem{color:var(--danger,#B42318)}.tmt-chip.problem::before{background:var(--danger,#B42318)}";
    document.head.appendChild(st);
  }
  var ICON = {
    done: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    problem: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" aria-hidden="true"><path d="M12 6v7M12 17.5v.5"/></svg>',
    todo: "", info: ""
  };
  var WORD = { problem: "Needs you now", todo: "To do", done: "Done", info: "" };

  function textHtml(x) { // only the key words coloured
    var t = String(x.text || ""), k = x.hot ? t.indexOf(x.hot) : -1;
    return k < 0 ? esc(t) : esc(t.slice(0, k)) + '<em class="tmt-hot ' + x.status + '">' + esc(x.hot) + "</em>" + esc(t.slice(k + x.hot.length));
  }
  function rowHtml(x, i, lead) { // one solid button on the list: the first thing to do; the rest quiet (VISUAL TH2)
    var primary = i === lead;
    var word = WORD[x.status] ? '<span class="tmt-sr">, ' + esc(WORD[x.status]) + "</span>" : "";
    return '<li class="tmt-row ' + x.status + '" data-tmt="' + esc(x.key) + '"><span class="tmt-ic">' + ICON[x.status] + '</span><div class="tmt-t"><b>' + esc(x.title) + word + "</b><span>" + textHtml(x) + "</span></div>" +
      '<button type="button" class="tmt-btn' + (primary ? " p" : " q") + '" data-tmt-go="' + i + '" aria-label="' + esc(x.aria || x.act + ": " + x.title) + '">' + esc(x.act) + (primary ? "" : " ›") + "</button></li>";
  }
  // the rota's avatar (modules.rotreg.js / shfreg.js): the same initials and colour per person on every Team screen (VISUAL X5)
  function initials(n) { var p = String(n || "?").trim().split(/\s+/); return ((p[0] || "")[0] || "?").toUpperCase() + ((p[1] || "")[0] || "").toUpperCase(); }
  function hue(n) { var h = 0; String(n || "").split("").forEach(function (c) { h = (h * 31 + c.charCodeAt(0)) % 360; }); return h; }
  function personHtml(p, kind) {
    var when = kind === "away" ? leaveLabel(p.leave && p.leave.leave_type) + (p.leave && p.leave.end_date && p.leave.end_date !== S.data.date ? ", back after " + shortDay(p.leave.end_date) : "")
      : kind === "now" ? "until " + p.to : kind === "later" ? p.from + "–" + p.to : p.from + "–" + p.to;
    var tel = p.phone && kind !== "away" ? String(p.phone).replace(/[^\d+]/g, "") : "";
    return '<li class="tmt-p' + (kind === "done" || kind === "away" ? " off" : "") + '"><span class="tmt-av" aria-hidden="true" style="background:hsl(' + hue(p.name) + "," + (kind === "done" || kind === "away" ? "20%,40%" : "45%,32%") + ')">' + esc(initials(p.name)) + '</span><div class="tmt-t"><b>' + esc(p.name) + "</b><span>" + esc(kind === "away" ? (p.role ? p.role + " \u00B7 " : "") + when : p.role) + "</span></div>" +
      (kind === "away" ? "" : "<em>" + esc(when) + "</em>") + (tel ? '<a class="tmt-btn q tmt-call" href="tel:' + esc(tel) + '" aria-label="' + esc("Call " + p.name + ", " + p.phone) + '">Call</a>' : '<span class="tmt-call" aria-hidden="true"></span>') + "</li>";
  }
  function whoHtml(D, now) {
    var P = people(D, now), h = "";
    var group = function (label, list, kind) { if (list.length) h += "<h3>" + esc(label) + '</h3><ul class="tmt-list solo">' + list.map(function (p) { return personHtml(p, kind); }).join("") + "</ul>"; };
    group("On now", P.now, "now"); group("Later today", P.later, "later"); group("Finished", P.done, "done"); group("Away today", P.away, "away");
    if (!h && gettingReady(D)) return "";
    if (!h) return '<div class="tmt-who"><ul class="tmt-list solo"><li class="tmt-row info"><span class="tmt-ic"></span><div class="tmt-t"><b>Nobody on the rota today</b><span>Add today\'s shifts in Plan shifts.</span></div><button type="button" class="tmt-btn q" data-tmt-plan aria-label="Plan shifts">Plan shifts ›</button></li></ul></div>';
    return '<div class="tmt-who" aria-label="Who is on today">' + h + "</div>";
  }

  function paint(slot) {
    if (!slot || !slot.isConnected) return;
    css();
    S.list = null;
    var D = S.data;
    if (S.hidden && !D) { slot.innerHTML = ""; paintChips(null); var all0 = document.querySelector(".hub h2.tmt-all"); if (all0) all0.hidden = true; return; }
    var now = D ? nowHm(D) : "";
    var h = '<section class="tmt" aria-labelledby="tmt-h"><div class="tmt-head"><h2 id="tmt-h">Today\'s team</h2>' + (D ? "<small>Checked " + esc(D.now || D.time || "") + "</small>" : "") + "</div>";
    if (!D && S.error) {
      h += '<div class="tmt-err" role="alert"><span>' + esc(S.error) + '</span><button type="button" class="tmt-btn" data-tmt-retry>Try again</button></div>';
    } else if (!D) {
      h += '<ul class="tmt-list solo" aria-busy="true" aria-label="Checking today\'s team"><li class="tmt-sk"></li><li class="tmt-sk"></li><li class="tmt-sk"></li></ul>';
    } else {
      var list = sorted(items(D, { now: now, admin: isAdmin() || !!(E.isPic && E.isPic()) })); // roles round: a pharmacist is told to sign in as the pharmacist in charge too
      h += '<div aria-live="polite"><div class="tmt-sum' + (list.length ? "" : " solo") + '">' + esc(headText(D, now)) + "</div></div>";
      var lead = -1; list.some(function (x, i) { if ((x.status === "problem" || x.status === "todo") && !x.quiet) { lead = i; return true; } return false; });
      h += list.length ? '<ul class="tmt-list">' + list.map(function (x, i) { return rowHtml(x, i, lead); }).join("") + "</ul>" : "";
      h += whoHtml(D, now);
      if (S.error) h += '<p class="tmt-foot" role="status">' + esc(S.error) + " Showing what was checked at " + esc(D.now || "") + ".</p>";
      S.list = list;
    }
    paintChips(D);
    var all = document.querySelector(".hub h2.tmt-all"); if (all) all.hidden = false;
    h += "</section>";
    var ae = document.activeElement, keep = ae && slot.contains(ae) ? (ae.getAttribute("data-tmt-go") != null ? '[data-tmt-go="' + ae.getAttribute("data-tmt-go") + '"]' : ae.hasAttribute("data-tmt-retry") ? "[data-tmt-retry]" : "") : "";
    slot.innerHTML = h;
    if (keep) { var k = slot.querySelector(keep); if (k) k.focus({ preventScroll: true }); }
    slot.querySelectorAll("[data-tmt-go]").forEach(function (b) {
      b.addEventListener("click", function () { var x = S.list && S.list[Number(b.getAttribute("data-tmt-go"))]; if (!x) return; if (x.gap && E.modules && E.modules.shfreg) E._shfGap = x.gap; go(x.go); }); // Plan shifts opens with the gap's shift ready (as from Who's in)
    });
    var pl = slot.querySelector("[data-tmt-plan]"); if (pl) pl.addEventListener("click", function () { go("#shfreg"); });
    var rt = slot.querySelector("[data-tmt-retry]");
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
  function chips(D, now) {
    var out = {}; if (!D) return out;
    now = now || nowHm(D);
    var c = cover(D), P = people(D, now), on = P.now.length + P.later.length + P.done.length;
    out.rotreg = c.closed ? { status: "info", text: c.words || "Closed" } : on ? { status: "info", text: (P.now.length ? P.now.length + " on now · " : "") + plural(on, "person", "people") + " today" } : { status: "info", text: "Nobody on the rota today" };
    var ready = gettingReady(D), gaps = ready ? [] : (c.gaps || []).filter(function (g) { return mins(g.to || g.end) > mins(now); });
    if (ready) out.rotreg = { status: "info", text: "No rota yet" };
    if (ready) out.shifts = { status: "todo", text: "Plan who works here" };
    else if (gaps.length) out.shifts = { status: mins(gaps[0].from || gaps[0].start) <= mins(now) ? "problem" : "todo", text: "No pharmacist " + (gaps[0].from || gaps[0].start) + "–" + (gaps[0].to || gaps[0].end) + (gaps.length > 1 ? " and " + (gaps.length - 1) + " more" : "") };
    else if (D.leave_pending) out.shifts = { status: "todo", text: plural(D.leave_pending, "leave request") };
    var H = D.handover;
    if (H && H.total) out.instructions = handoverRead(H) ? { status: "done", text: "Read" } : { status: "todo", text: H.critical ? H.critical + " critical · not read" : plural(H.total, "point") + " · not read" };
    var B = D.board;
    if (B && (B.unread_messages || B.unread_mentions)) out.messageboard = { status: B.unread_mentions ? "todo" : "info", text: [B.unread_messages ? (B.unread_messages >= 100 ? "99+" : B.unread_messages) + " new" : "", B.unread_mentions ? plural(B.unread_mentions, "mention") + " of you" : ""].filter(Boolean).join(" · ") };
    if (D.locum_today) {
      var I = inCharge(D, now), open = !c.closed && mins(now) >= mins(c.open) && mins(now) < mins(c.close);
      if (I.on[0]) out.locumregister = { status: "done", text: "In charge: " + I.on[0].locum_full_name };
      else if (open) out.locumregister = ready ? { status: "todo", text: "Record who is in charge" } : { status: "problem", text: "Pharmacist in charge not recorded" };
    }
    return out;
  }
  function paintChips(D) {
    var hub = document.querySelector('.hub[data-hub="team"]'); if (!hub) return;
    var ch = D ? chips(D) : {};
    hub.querySelectorAll(".hub-card[data-open]").forEach(function (card) {
      var mid = card.getAttribute("data-open"), x = ch[mid], el = card.querySelector(".tmt-chip");
      if (!x) { if (el) el.remove(); return; }
      if (!el) { el = document.createElement("em"); card.appendChild(el); }
      el.className = "tmt-chip " + x.status; el.textContent = x.text;
    });
  }

  var API = E.teamToday = { data: null, at: 0, items: items, sorted: sorted, headText: headText, chips: chips, cover: cover, people: people, inCharge: inCharge, load: load, render: render, go: go, state: S };
  // A slot already on screen (the hub drew before this file arrived): fill it now.
  try { var pre = document.getElementById("tmt-slot"); if (pre && E.state.activeModuleId === "team") render(pre); } catch (e) {}
})();
