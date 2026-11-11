/* Roster planner, "mine & out" (B4): who am I on the rota, the calendar link, and the rota on paper.
   - E.rotaMe(staff) -> the signed-in person's row on the rota, or null. The row the admin linked to this sign-in
     (People who sign in › On the rota; shift_staff.user_id) first; else a name match (case, spaces, word order and the
     Maltese letters ċ ġ ħ ż folded) picks the one person with that name; otherwise the person chosen once on this device
     (E.rotaMeSet, localStorage eikon_rota_me:<location>:<user>). Nothing is sent and nothing is stored on the server.
   - E.rotaCal: the live calendar feed (GET /shifts/ical?token=…, the classic Integration tab's link) for one person or
     the team, turning the link on (the classic body: the whole settings object, read fresh, with calendarToken set),
     a new link, and the classic one-month .ics file. E.rotaCal.ui.panel(mount, ctx) draws the panel.
   - E.rotaPrint({kind:"week"|"month"|"list"}) prints the rota: a week or a month as a wall grid (A4 landscape, black on
     white, pharmacy name, page numbers, printed in Malta time), or the classic list by day (shifts on approved leave
     struck "(on leave)"). E.rotaPrint.csv(...) downloads the classic spreadsheet columns. E.rotaPrint.ui.panel(mount, ctx)
     draws the "Print" chooser. Printing is CSP-safe: the printed page carries no script (E.openPrintUrlOrLink drives it).
   Reads only what is not handed in: a screen that has the week or the month loaded prints it with no request. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  var CLASSIC_DESIG = { pharmacist: "Pharmacist", locum: "Locum Pharmacist", assistant: "Pharmacy Assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  var ORDER = ["pharmacist", "locum", "manager", "assistant", "dispenser", "cashier", "cleaner", "other"];
  var DAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var MONTH = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function parse(s) { var p = String(s || "").split("-"); return new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2] || 1)); }
  function plus(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function mondayOf(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); return plus(x, -((x.getDay() + 6) % 7)); }
  function hm(t) { return String(t || "").slice(0, 5); }
  function mins(t) { var p = hm(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function desig(d) { var k = low(d); return DESIG[k] || String(d || ""); }
  function isPh(p) { var d = low(p && p.designation); return d === "pharmacist" || d === "locum"; }
  function leaveLabel(t) { var x = String(t || "leave").replace(/_/g, " ").trim(); x = x.charAt(0).toUpperCase() + x.slice(1); return /\s|leave/i.test(x) ? x : x + " leave"; }
  function shiftMins(x) { var a = mins(x.start_time), z = mins(x.end_time); return isFinite(a) && isFinite(z) && z > a ? z - a : 0; }
  function hrs(m) { var r = Math.round((m || 0) / 6) / 10; return Math.abs(r - Math.round(r)) < 1e-9 ? String(Math.round(r)) : r.toFixed(1); }
  function dmy(s) { var d = parse(s); return d.getDate() + " " + MON[d.getMonth()] + " " + d.getFullYear(); }
  function today() { return E.maltaYmd ? E.maltaYmd(new Date()) : ymd(new Date()); }
  function staffMap(st) { var m = {}; (Array.isArray(st) ? st : Object.keys(st || {}).map(function (k) { return st[k]; })).forEach(function (p) { if (p) m[String(p.id)] = p; }); return m; }
  function byRole(map) { return function (a, b) { var x = map[String(a)] || {}, y = map[String(b)] || {}, i = ORDER.indexOf(low(x.designation)), j = ORDER.indexOf(low(y.designation)); return (i < 0 ? 99 : i) - (j < 0 ? 99 : j) || String(x.full_name || "").localeCompare(String(y.full_name || "")); }; }
  function userOf() { return (E.state && E.state.user) || {}; }
  function loc() { var u = userOf(); return u.location_id == null ? "" : String(u.location_id); }

  // ---------------------------------------------------------------- who am I on the rota
  // Folded for matching: lower case, accents off (ċ ġ ż decompose; ħ does not, so it is mapped), punctuation and extra
  // spaces gone, words sorted ("Borg Maria" is "Maria Borg").
  E.rotaFold = function (s) {
    var x = String(s == null ? "" : s).toLowerCase().replace(/ħ/g, "h");
    try { x = x.normalize("NFD").replace(/[\u0300-\u036f]/g, ""); } catch (e) {}
    return x.replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean).sort().join(" ");
  };
  function meKey() { var u = userOf(); return "eikon_rota_me:" + loc() + ":" + String(u.id || u.user_id || u.email || ""); }
  function active(list) { return (Array.isArray(list) ? list : Object.keys(list || {}).map(function (k) { return list[k]; })).filter(function (p) { return p && Number(p.is_active) !== 0; }); }
  // The active people whose name is the signed-in user's name.
  E.rotaMeMatches = function (list) {
    var u = userOf(), f = E.rotaFold(u.full_name || u.display_name || "");
    if (!f) return [];
    return active(list).filter(function (p) { return E.rotaFold(p.full_name) === f; });
  };
  // What this device remembers: a staff id, "none" (not on the rota), or "" (never asked).
  E.rotaMeChoice = function () { try { return String(localStorage.getItem(meKey()) || ""); } catch (e) { return ""; } };
  E.rotaMeSet = function (id) {
    try { if (id == null || id === "") localStorage.removeItem(meKey()); else localStorage.setItem(meKey(), String(id)); } catch (e) {}
    return id;
  };
  // The row the pharmacy's admin linked to this sign-in (roles round: shift_staff.user_id) wins over a guess.
  E.rotaMeLinked = function (list) {
    var u = userOf(), id = String(u.user_id || u.id || ""); if (!id) return null;
    return active(list).filter(function (p) { return p.user_id != null && String(p.user_id) === id; })[0] || null;
  };
  E.rotaMe = function (list) {
    var ch = E.rotaMeChoice(), act = active(list), lk = E.rotaMeLinked(list);
    if (lk) return lk;
    if (ch === "none") return null;
    if (ch) { var p = act.filter(function (x) { return String(x.id) === ch; })[0]; if (p) return p; }
    var m = E.rotaMeMatches(act);
    return m.length === 1 ? m[0] : null;
  };
  // For a screen: { me, how: "name" | "chosen" | "none" | "ask", options } (options: the people to choose from, the
  // name matches first when the name fits several).
  E.rotaMeState = function (list) {
    var ch = E.rotaMeChoice(), act = active(list), me = E.rotaMe(list);
    if (me) return { me: me, how: ch && String(me.id) === ch && !E.rotaMeLinked(list) ? "chosen" : "name", options: act }; // linked: as sure as a name match
    if (ch === "none") return { me: null, how: "none", options: act };
    var m = E.rotaMeMatches(act);
    return { me: null, how: "ask", options: m.concat(act.filter(function (p) { return m.indexOf(p) < 0; })), matches: m };
  };

  // ---------------------------------------------------------------- the calendar link
  function genToken(len) { // the classic generator (a–z, 2–7), 32 characters: the worker accepts [a-z0-9]{12,128}
    len = len || 32; var alpha = "abcdefghijklmnopqrstuvwxyz234567", out = "";
    try { var a = new Uint8Array(len); (window.crypto || window.msCrypto).getRandomValues(a); for (var i = 0; i < len; i++) out += alpha[a[i] % alpha.length]; return out; }
    catch (e) { while (out.length < len) out += Math.random().toString(36).slice(2); return out.slice(0, len).replace(/[^a-z0-9]/g, "a"); }
  }
  function icalEsc(s) { return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\n/g, "\\n"); }
  E.rotaCal = {
    // Approved leave is in the live feed as all-day events (John 5a; the worker's W3, B1 4f5e31f).
    leaveInFeed: true,
    tokenOf: function (settings) { return String((settings && settings.calendarToken) || "").trim(); },
    // The feed's address: origin + /shifts/ical?token=…[&staff_id=…]&past=…&future=… (the classic urlFor).
    url: function (token, o) {
      o = o || {}; if (!token) return "";
      var origin = (window.location && window.location.origin) || "";
      var u = origin + "/shifts/ical?token=" + encodeURIComponent(token);
      if (o.staffId) u += "&staff_id=" + encodeURIComponent(o.staffId);
      u += "&past=" + encodeURIComponent(o.past == null ? 30 : o.past) + "&future=" + encodeURIComponent(o.future == null ? 180 : o.future);
      return u;
    },
    webcal: function (u) { return String(u || "").replace(/^https?:\/\//, "webcal://"); },
    // The contract name (Phase 0): the webcal:// address of the feed for one person (or the team without staffId).
    feedUrl: function (token, staffId, o) { o = o || {}; return E.rotaCal.webcal(E.rotaCal.url(token, { staffId: staffId, past: o.past, future: o.future })); },
    // One-tap live subscriptions (the calendar fetches the feed again by itself; nothing is copied once):
    google: function (u) { return "https://calendar.google.com/calendar/r?cid=" + encodeURIComponent(E.rotaCal.webcal(u)); },
    outlook: function (u, name) { return "https://outlook.live.com/calendar/0/addfromweb?url=" + encodeURIComponent(u) + "&name=" + encodeURIComponent(name || "Rota"); },
    // Turn the link on (or make a new one): the settings are read fresh and PUT whole with the new calendarToken, as the
    // classic Generate/Regenerate does, so a rule changed on another device meanwhile is kept. -> the token.
    turnOn: async function (fresh) {
      if (E.rotaMeta && typeof E.rotaMeta.settings === "function" && !E.rotaMeta.stub) { // B3's queue: one settings save at a time on this page
        var tok = "";
        if (!fresh) { var g = await E.apiFetch("/shifts/settings", { method: "GET" }); if (!g || !g.ok) throw new Error((g && g.error) || "Could not read the rota settings"); tok = E.rotaCal.tokenOf(g.settings); if (tok) return tok; }
        await E.rotaMeta.settings(function (s) { tok = fresh ? "" : E.rotaCal.tokenOf(s); if (!tok) s.calendarToken = tok = genToken(32); return s; });
        return tok;
      }
      var r = await E.apiFetch("/shifts/settings", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the rota settings");
      var s = r.settings && typeof r.settings === "object" ? r.settings : {};
      if (!fresh && E.rotaCal.tokenOf(s)) return E.rotaCal.tokenOf(s); // turned on elsewhere meanwhile: use that one
      s.calendarToken = genToken(32);
      var w = await E.apiFetch("/shifts/settings", { method: "PUT", body: JSON.stringify(s) });
      if (!w || !w.ok) throw new Error((w && w.error) || "Could not save the calendar link");
      if (E.rotaRules) { try { E.rotaRules(true); } catch (e) {} }
      return s.calendarToken;
    },
    // The classic one-month .ics (buildICal), line for line (its own role words: the file matches what classic downloads): the month's shifts (one person or all) and approved leave as all-day events.
    ics: function (o) {
      o = o || {}; var y = o.year, mo = o.month, sm = staffMap(o.staff), only = o.staffId ? Number(o.staffId) : null;
      var first = y + "-" + pad(mo + 1) + "-01", last = ymd(new Date(y, mo + 1, 0)), stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
      var lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Eikon Pharmacy//ShiftMgmt//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Eikon Pharmacy Shifts", "X-WR-TIMEZONE:Europe/Malta"];
      (o.shifts || []).forEach(function (s) {
        var dt = String(s.shift_date || ""), p = dt.split("-"); if (p.length !== 3 || dt < first || dt > last) return;
        if (only && Number(s.staff_id) !== only) return;
        var e2 = sm[String(s.staff_id)], nm = e2 ? e2.full_name : "Staff";
        lines.push("BEGIN:VEVENT", "UID:eikon-sh-" + s.id + "@pharmacy.mt", "DTSTAMP:" + stamp,
          "DTSTART;TZID=Europe/Malta:" + p[0] + p[1] + p[2] + "T" + hm(s.start_time || "09:00").replace(":", "") + "00",
          "DTEND;TZID=Europe/Malta:" + p[0] + p[1] + p[2] + "T" + hm(s.end_time || "18:00").replace(":", "") + "00",
          "SUMMARY:" + icalEsc(nm + (e2 ? " (" + (CLASSIC_DESIG[e2.designation] || e2.designation || "Other") + ")" : "")),
          "DESCRIPTION:" + icalEsc((s.start_time || "") + "–" + (s.end_time || "") + (s.notes ? " | " + s.notes : "")), "END:VEVENT");
      });
      (o.leaves || []).forEach(function (l) {
        if (low(l.status) !== "approved" || l.end_date < first || l.start_date > last) return; // the month's leave, and only that person's when filtered (classic sent the whole year's, everyone's)
        if (only && Number(l.staff_id) !== only) return;
        var e2 = sm[String(l.staff_id)], nm = e2 ? e2.full_name : "Staff";
        lines.push("BEGIN:VEVENT", "UID:eikon-lv-" + l.id + "@pharmacy.mt", "DTSTAMP:" + stamp,
          "DTSTART;VALUE=DATE:" + String(l.start_date).replace(/-/g, ""), "DTEND;VALUE=DATE:" + ymd(plus(parse(l.end_date), 1)).replace(/-/g, ""),
          "SUMMARY:" + icalEsc(nm + " — " + l.leave_type + " leave"), "DESCRIPTION:" + icalEsc((l.reason || l.leave_type) + " | " + l.hours_requested + "h"),
          "TRANSP:TRANSPARENT", "END:VEVENT");
      });
      lines.push("END:VCALENDAR");
      return lines.join("\r\n");
    },
    ui: {}
  };
  function download(name, text, type) {
    var url = URL.createObjectURL(new Blob([text], { type: type || "text/plain" })), a = document.createElement("a");
    a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a); a.click();
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} a.remove(); }, 400);
    E.rotaPrint.lastFile = { name: name, text: text, type: type };
  }
  async function copyText(text, input) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) {}
    try { if (input) { input.focus(); input.select(); } return document.execCommand && document.execCommand("copy"); } catch (e) { return false; }
  }
  function yearsOf(from, to) { var a = Number(String(from).slice(0, 4)), z = Number(String(to).slice(0, 4)), out = []; if (String(from).slice(5, 7) === "01") a--; for (var y = a; y <= z; y++) out.push(y); return out; } // a leave asked in December that runs into January is read with the year it starts in
  async function getLeaves(from, to) {
    var rs = await Promise.all(yearsOf(from, to).map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }).catch(function () { return null; }); }));
    var seen = {}; return [].concat.apply([], rs.map(function (r) { return (r && r.ok && r.leaves) || []; })).filter(function (l) { if (seen[l.id]) return false; seen[l.id] = 1; return true; });
  }
  async function getRange(from, to, staffId) {
    var r = await E.apiFetch("/shifts/assignments-range?from=" + from + "&to=" + to + (staffId ? "&staff_id=" + encodeURIComponent(staffId) : ""), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the rota");
    return r.shifts || [];
  }
  function failWords(e) { return e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Something went wrong"); }

  // ---------------------------------------------------------------- shared panel styles
  function css() {
    if (document.getElementById("eikon-rotaprint-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-rotaprint-css";
    st.textContent =
      ".rpo-panel{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 16px 16px;margin-top:10px}" +
      ".rpo-panel h2{font-size:17px;font-weight:700;margin:0 0 4px}.rpo-panel p{margin:6px 0;font-size:14px;line-height:1.45}.rpo-panel .m{color:var(--muted);font-size:13px}" +
      ".rpo-btn{font:inherit;font-size:14px;font-weight:600;min-height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;text-decoration:none;box-sizing:border-box}" +
      ".rpo-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rpo-btn:active{transform:translateY(1px)}.rpo-btn[disabled]{opacity:.6;cursor:default}" +
      ".rpo-acts{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}" +
      ".rpo-f{display:flex;flex-direction:column;gap:4px;margin-top:10px;font-size:13px;font-weight:600;color:var(--muted)}.rpo-f select,.rpo-f input{font:inherit;font-size:16px;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:10px;min-height:44px;padding:0 10px;box-sizing:border-box;width:100%;max-width:420px}" +
      ".rpo-row{display:flex;flex-wrap:wrap;gap:10px}.rpo-row .rpo-f{flex:1 1 150px}" +
      ".rpo-link{font:inherit;font-size:14px;width:100%;box-sizing:border-box;color:var(--text);background:rgba(118,118,128,.08);border:1px solid var(--border);border-radius:10px;min-height:44px;padding:0 10px;margin-top:10px;font-variant-numeric:tabular-nums}" +
      ".rpo-panel details{margin-top:12px;font-size:14px}.rpo-panel summary{cursor:pointer;color:var(--accent);font-weight:600;min-height:32px;display:flex;align-items:center}.rpo-panel details ul{margin:6px 0 0;padding-left:20px;line-height:1.55}" +
      ".rpo-live{background:var(--ok-soft,rgba(28,138,91,.1));border-radius:10px;padding:8px 12px}.rpo-subs{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px}.rpo-subs .rpo-btn{flex:1 1 180px;min-height:44px}" +
      ".rpo-ok{color:var(--ok);font-weight:600;font-size:13.5px;min-height:1.2em}.rpo-err{color:var(--danger,#C4221A);font-weight:600;font-size:13.5px}" +
      ".rpo-ch{display:flex;flex-direction:column;gap:6px;margin-top:8px;border:0;padding:0}.rpo-ch legend{font-size:13px;font-weight:600;color:var(--muted);padding:0;margin-bottom:2px}" +
      ".rpo-ch label{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 12px;border:1px solid var(--border);border-radius:10px;cursor:pointer;font-size:14.5px}.rpo-ch label:has(input:checked){border-color:var(--accent);box-shadow:0 0 0 1px var(--accent)}.rpo-ch input{width:18px;height:18px;margin:0;accent-color:var(--accent)}.rpo-ch small{color:var(--muted);font-size:12.5px;margin-left:auto;text-align:right}" +
      ".rpo-sk{height:60px;border-radius:10px;background:rgba(118,118,128,.1);margin-top:8px}" +
      "@media (max-width:600px){.rpo-btn{min-height:44px;border-radius:22px;flex:1 1 auto}.rpo-panel{padding:14px}}";
    document.head.appendChild(st);
  }

  // ---------------------------------------------------------------- the calendar link panel
  // ctx: { staff (array or map), me (a staff row or null), leaves (optional, for the month file), manage (true: offer
  // "Make a new link"), onClose (optional) }. Reads nothing new to show the link: the token is in the rota settings
  // E.rotaRules already holds.
  E.rotaCal.ui.panel = function (mount, ctx) {
    ctx = ctx || {}; css();
    var P = { busy: true, err: "", token: "", who: ctx.me ? String(ctx.me.id) : "", past: 30, future: 180, sure: false, saving: false, msg: "", fileBusy: false };
    var sm = staffMap(ctx.staff), people = active(ctx.staff).sort(function (a, b) { return byRole(sm)(a.id, b.id); });
    function calName() { var u = userOf(), p = P.who && sm[P.who]; return (p ? p.full_name + " · " : "") + "Rota · " + (u.location_name || "Pharmacy"); }
    function link() { return E.rotaCal.url(P.token, { staffId: P.who, past: P.past, future: P.future }); }
    function draw() {
      if (!mount || !document.body.contains(mount)) return;
      var h = '<section class="rpo-panel rpo-cal" aria-labelledby="rpo-cal-h"><h2 id="rpo-cal-h">' + (ctx.me ? "Add your shifts to your calendar" : "Calendar link") + "</h2>";
      if (P.busy) h += '<div class="rpo-sk" role="status" aria-label="Reading the calendar link"></div>';
      else if (!P.token) {
        h += "<p>Shifts can show in the calendar on your phone, and stay up to date by themselves.</p>" +
          (P.err ? '<p class="rpo-err" role="alert">' + esc(P.err) + "</p>" : "") +
          '<div class="rpo-acts"><button class="rpo-btn p" data-x="on"' + (P.saving ? " disabled" : "") + ">" + (P.saving ? "Turning it on…" : "Turn on the calendar link") + "</button>" + (ctx.onClose ? '<button class="rpo-btn" data-x="close">Not now</button>' : "") + "</div>" +
          '<p class="m">One link for the whole pharmacy. Anyone who has it can see the rota\'s times, so share it only with your team.</p>';
      } else {
        var u = link();
        h += '<label class="rpo-f">Whose shifts<select data-x="who">' + (ctx.me ? '<option value="' + esc(ctx.me.id) + '"' + (P.who === String(ctx.me.id) ? " selected" : "") + ">Mine (" + esc(ctx.me.full_name) + ")</option>" : "") +
          '<option value=""' + (P.who === "" ? " selected" : "") + ">Everyone</option>" +
          people.filter(function (p) { return !ctx.me || String(p.id) !== String(ctx.me.id); }).map(function (p) { return '<option value="' + esc(p.id) + '"' + (P.who === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + " · " + esc(desig(p.designation)) + "</option>"; }).join("") + "</select></label>" +
          '<input class="rpo-link" readonly aria-label="Calendar link" value="' + esc(u) + '" data-x="url">' +
          '<p class="rpo-live"><b>Updates by itself</b> — changes appear in your calendar within a few hours (Google Calendar can take 8 to 24 hours). ' + (E.rotaCal.leaveInFeed ? "Approved leave shows as all-day events." : "") + "</p>" +
          '<div class="rpo-subs" role="group" aria-label="Add to a calendar">' +
          '<a class="rpo-btn p" data-x="sub" href="' + esc(E.rotaCal.webcal(u)) + '">iPhone, Mac or Outlook app</a>' +
          '<a class="rpo-btn p" data-x="gcal" target="_blank" rel="noopener" href="' + esc(E.rotaCal.google(u)) + '">Google Calendar</a>' +
          '<a class="rpo-btn p" data-x="ocal" target="_blank" rel="noopener" href="' + esc(E.rotaCal.outlook(u, calName())) + '">Outlook.com</a></div>' +
          '<div class="rpo-acts"><button class="rpo-btn" data-x="copy">Copy link</button>' + (ctx.onClose ? '<button class="rpo-btn" data-x="close">Done</button>' : "") + "</div>" +
          '<p class="rpo-ok" role="status" aria-live="polite">' + esc(P.msg) + "</p>" +
          (P.err ? '<p class="rpo-err" role="alert">' + esc(P.err) + "</p>" : "") +
          "<details><summary>If a button does not work</summary><ul>" +
          "<li><b>iPhone or Mac:</b> after the button, choose Subscribe.</li>" +
          "<li><b>Google Calendar:</b> copy the link, then on a computer open Google Calendar, Other calendars, +, From URL, and paste it. It then shows on your Android phone too.</li>" +
          "<li><b>Outlook.com:</b> copy the link, then Add calendar, Subscribe from web, and paste it.</li></ul></details>" +
          '<details><summary>A one-time copy instead</summary><p>A file with this month\'s shifts and approved leave. It does not update.</p><div class="rpo-acts"><button class="rpo-btn" data-x="ics"' + (P.fileBusy ? " disabled" : "") + ">" + (P.fileBusy ? "Making the file…" : "Download this month") + "</button></div></details>" +
          '<details><summary>Days shown</summary><div class="rpo-row"><label class="rpo-f">Days back<input type="number" inputmode="numeric" min="0" max="365" value="' + P.past + '" data-x="past"></label><label class="rpo-f">Days ahead<input type="number" inputmode="numeric" min="1" max="730" value="' + P.future + '" data-x="future"></label></div></details>' +
          (ctx.manage ? '<details><summary>Make a new link</summary><p>The old link stops working on every phone and calendar that has it. Everyone then needs the new one.</p><div class="rpo-acts"><button class="rpo-btn" data-x="new"' + (P.saving ? " disabled" : "") + ">" + (P.saving ? "Making a new link…" : P.sure ? "Yes, stop the old link" : "Make a new link") + "</button></div></details>" : "") +
          '<p class="m">Anyone who has this link can see these shifts. Share it only with your team.</p>';
      }
      mount.innerHTML = h + "</section>";
      wire();
    }
    function wire() {
      mount.querySelectorAll("[data-x]").forEach(function (el) {
        var x = el.getAttribute("data-x");
        if (x === "who") el.addEventListener("change", function () { P.who = el.value; P.msg = ""; draw(); var s = mount.querySelector('[data-x="who"]'); if (s) s.focus(); });
        else if (x === "past" || x === "future") el.addEventListener("change", function () { var v = parseInt(el.value, 10), lo = x === "past" ? 0 : 1, hi = x === "past" ? 365 : 730; P[x] = isFinite(v) ? Math.max(lo, Math.min(hi, v)) : (x === "past" ? 30 : 180); var url = mount.querySelector('[data-x="url"]'), sub = mount.querySelector('[data-x="sub"]'), g = mount.querySelector('[data-x="gcal"]'), o = mount.querySelector('[data-x="ocal"]'); if (url) url.value = link(); if (sub) sub.setAttribute("href", E.rotaCal.webcal(link())); if (g) g.setAttribute("href", E.rotaCal.google(link())); if (o) o.setAttribute("href", E.rotaCal.outlook(link(), calName())); });
        else if (x === "url") { el.addEventListener("focus", function () { try { el.select(); } catch (e) {} }); }
        else el.addEventListener("click", function (ev) {
          if (x === "sub" || x === "gcal" || x === "ocal") return; // the links open the calendar itself (a subscription, kept up to date by it)
          ev.preventDefault();
          if (x === "close") { if (ctx.onClose) ctx.onClose(); }
          else if (x === "on") turnOn(false);
          else if (x === "new") { if (!P.sure) { P.sure = true; draw(); var b = mount.querySelector('[data-x="new"]'); if (b) { b.closest("details").open = true; b.focus(); } } else turnOn(true); }
          else if (x === "copy") copyText(link(), mount.querySelector('[data-x="url"]')).then(function (ok) { P.msg = ok ? "Link copied. Paste it into your calendar." : "Select the link above and copy it."; var m = mount.querySelector(".rpo-ok"); if (m) m.textContent = P.msg; });
          else if (x === "ics") monthFile();
        });
      });
    }
    async function turnOn(fresh) {
      P.saving = true; P.err = ""; draw();
      try { P.token = await E.rotaCal.turnOn(fresh); P.sure = false; P.msg = fresh ? "New link made. The old one no longer works." : "The calendar link is on."; }
      catch (e) { P.err = (E.saveFailText ? E.saveFailText(e) : failWords(e)); }
      P.saving = false; draw();
      var f = mount.querySelector(P.token ? '[data-x="copy"]' : '[data-x="on"]'); if (f) f.focus();
    }
    async function monthFile() {
      var t = parse(ctx.monthOf || today()), y = t.getFullYear(), mo = t.getMonth(), from = y + "-" + pad(mo + 1) + "-01", to = ymd(new Date(y, mo + 1, 0));
      P.fileBusy = true; P.err = ""; draw();
      try {
        var res = await Promise.all([getRange(from, to, P.who), ctx.leaves ? Promise.resolve(ctx.leaves) : getLeaves(from, to)]);
        var ics = E.rotaCal.ics({ year: y, month: mo, staffId: P.who, staff: ctx.staff, shifts: res[0], leaves: res[1] });
        var who = P.who && sm[P.who] ? "-" + E.rotaFold(sm[P.who].full_name).replace(/\s+/g, "-") : "";
        download("rota-" + y + "-" + pad(mo + 1) + who + ".ics", ics, "text/calendar;charset=utf-8");
        var n = ics.split("BEGIN:VEVENT").length - 1;
        P.msg = n ? "Downloaded " + MONTH[mo] + " (" + n + (n === 1 ? " entry" : " entries") + "). Open the file to add it." : "Nothing on the rota in " + MONTH[mo] + " yet.";
      } catch (e) { P.err = failWords(e); }
      P.fileBusy = false; draw();
      var b = mount.querySelector('[data-x="ics"]'); if (b) b.focus();
    }
    draw();
    var closed = false;
    var rules = E.rotaRules ? E.rotaRules() : Promise.resolve({});
    Promise.resolve(rules).then(function (r) {
      if (r && r.settings === null) P.err = "Could not read the calendar link. Try again in a moment.";
      P.token = E.rotaCal.tokenOf(r && r.settings); P.busy = false; if (closed) return; draw();
      if (ctx.focus) { var f = mount.querySelector('[data-x="who"], [data-x="on"]'); if (f) f.focus(); }
    }, function (e) { P.busy = false; P.err = failWords(e); if (!closed) draw(); });
    return { redraw: function () { if (!closed) draw(); }, close: function () { closed = true; if (mount) mount.innerHTML = ""; } };
  };

  // ---------------------------------------------------------------- printing
  // Shifts that fall in an approved leave (the classic leaveHit: a part-day leave's own hours on its first and last day).
  function leaveHit(s, leaves) {
    var ds = s.shift_date, st = mins(s.start_time), et = mins(s.end_time); if (!isFinite(st)) st = 0; if (!isFinite(et)) et = 0;
    for (var i = 0; i < leaves.length; i++) {
      var l = leaves[i];
      if (!l || low(l.status) !== "approved" || Number(l.staff_id) !== Number(s.staff_id) || l.start_date > ds || l.end_date < ds) continue;
      var ls = 0, le = 1440;
      if (l.start_date === ds && l.start_time) ls = mins(l.start_time);
      if (l.end_date === ds && l.end_time) le = mins(l.end_time);
      if (!isFinite(ls)) ls = 0; if (!isFinite(le)) le = 1440; if (le <= ls) { ls = 0; le = 1440; }
      if (et > ls && st < le) return l;
    }
    return null;
  }
  function leaveOn(sid, ds, leaves) { return leaves.filter(function (l) { return low(l.status) === "approved" && Number(l.staff_id) === Number(sid) && l.start_date <= ds && l.end_date >= ds; })[0] || null; }
  function leaveWords(l, ds) {
    var part = (l.start_date === ds && l.start_time) || (l.end_date === ds && l.end_time);
    if (!part) return leaveLabel(l.leave_type);
    var a = l.start_date === ds && l.start_time ? hm(l.start_time) : "", z = l.end_date === ds && l.end_time ? hm(l.end_time) : "";
    return leaveLabel(l.leave_type) + (a && z ? " " + a + "–" + z : a ? " from " + a : " until " + z);
  }
  function stamp() {
    var t = new Date(), y = E.maltaYmd ? E.maltaYmd(t) : ymd(t), h = E.maltaHm ? E.maltaHm(t) : pad(t.getHours()) + ":" + pad(t.getMinutes());
    return "Printed " + dmy(y) + " " + h + " (Malta)";
  }
  function pageHtml(title, sub, body, landscape) {
    var u = userOf(), ph = u.location_name || u.org_name || "Pharmacy", st = stamp();
    var foot = (ph + " · " + title + " · " + st).replace(/["\\]/g, "'");
    return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(title) + "</title><style>" +
      "@page{size:A4 " + (landscape ? "landscape" : "portrait") + ";margin:10mm 8mm 13mm;@bottom-left{content:\"" + foot + "\";font:8.5px system-ui,sans-serif;color:#000}@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);font:8.5px system-ui,sans-serif;color:#000}}" +
      "*{box-sizing:border-box}html{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;margin:16px;color:#000;background:#fff;font-size:11px;font-variant-numeric:tabular-nums}" +
      ".ph{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid #000;padding-bottom:6px;margin-bottom:10px}.ph b{font-size:15px;display:block}.ph span{font-size:11px;display:block}.ph div:last-child{text-align:right}h1{font-size:18px;margin:0;font-weight:800}" +
      "table{width:100%;border-collapse:collapse;table-layout:fixed;margin:0 0 10px}th,td{border:1px solid #000;padding:3px 4px;text-align:left;vertical-align:top;overflow-wrap:anywhere}thead th{background:#eee;font-weight:700}thead{display:table-header-group}tr{break-inside:avoid;page-break-inside:avoid}" +
      "th.who{width:150px}th.who b,td b{display:block}th small,td small{display:block;font-size:9.5px;font-weight:400}td.shut{background:#f2f2f2}td .t{display:block;font-weight:700;white-space:nowrap}td .n{display:block;font-size:9.5px}td .lv{display:block;font-style:italic}td .x{text-decoration:line-through}td .ol{font-weight:700}" +
      "tr.duty td,tr.duty th{border-top:2px solid #000}tr.duty td span{display:block}tr.duty .gap{font-weight:700}" +
      ".m31 th,.m31 td{padding:2px 2px;font-size:9px}.m31 th.who{width:110px}.m31 td .t{font-size:9px}.m31 td .n{display:none}" +
      ".list h2{font-size:13px;margin:12px 0 4px;break-after:avoid;page-break-after:avoid}.list td,.list th{font-size:10.5px;padding:4px 6px}" +
      ".pb{break-before:page;page-break-before:always}.none{font-style:italic}.pf{margin-top:8px;font-size:9.5px}@media print{body{margin:0}.pf{display:none}}" +
      "</style></head><body><header class='ph'><div><b>" + esc(ph) + "</b>" + (u.org_name && u.org_name !== ph ? "<span>" + esc(u.org_name) + "</span>" : "") + "</div><div><h1>" + esc(title) + "</h1>" + (sub ? "<span>" + esc(sub) + "</span>" : "") + "</div></header>" +
      body + "<p class='pf'>" + esc(st) + "</p></body></html>";
  }
  // The grid for a run of days: people as rows (pharmacists first, the Who's in order), days as columns, each day's hours
  // or "Closed · Public holiday (…)" in its heading, and a last row naming the pharmacist on duty (or the gap).
  function gridTable(keys, D, compact) {
    var sm = D.sm, ids = {};
    D.shifts.forEach(function (x) { if (keys.indexOf(x.shift_date) >= 0) ids[x.staff_id] = 1; });
    D.leaves.forEach(function (l) { if (low(l.status) === "approved" && l.start_date <= keys[keys.length - 1] && l.end_date >= keys[0]) ids[l.staff_id] = 1; });
    var rows = Object.keys(ids).sort(byRole(sm)), cov = keys.map(function (k) { return E.teamCover ? E.teamCover(k, { hours: D.hours, settings: D.settings, shifts: D.shifts, staff: sm, leaves: D.leaves }) : { gaps: [], open: "", close: "" }; });
    var h = '<table class="' + (compact ? "m31" : "wk") + '"><thead><tr><th class="who" scope="col">' + (compact ? "Who" : "Who · hours this week") + "</th>";
    keys.forEach(function (k, i) {
      var d = parse(k), c = cov[i], wd = (d.getDay() + 6) % 7;
      h += '<th scope="col"><b>' + DAY[wd].slice(0, 3) + " " + d.getDate() + (compact ? "" : " " + MON[d.getMonth()]) + "</b><small>" + esc(c.closed ? (c.holiday ? (compact ? "Closed" : "Closed · Public holiday (" + c.holiday + ")") : "Closed") : (compact ? c.open.replace(/:00$/, "") + "–" + c.close.replace(/:00$/, "") : c.open + "–" + c.close) + (c.holiday && !c.closed && !compact ? " · " + c.holiday : "")) + "</small>" + (compact && c.holiday ? "<small>" + esc(c.holiday) + "</small>" : "") + "</th>";
    });
    h += "</tr></thead><tbody>";
    rows.forEach(function (id) {
      var p = sm[id] || { full_name: "Staff #" + id }, m = 0;
      D.shifts.forEach(function (x) { if (String(x.staff_id) === id && keys.indexOf(x.shift_date) >= 0 && !leaveHit(x, D.leaves)) m += shiftMins(x); });
      var con = Number(p.contracted_hours) || 0, locum = low(p.designation) === "locum" || low(p.employment_type) === "external";
      h += '<tr><th scope="row" class="who"><b>' + esc(p.full_name) + "</b><small>" + esc(desig(p.designation)) + (m ? " · " + hrs(m) + " h" + (!compact && con && !locum ? " of " + hrs(con * 60) + " h" : "") : "") + "</small></th>";
      keys.forEach(function (k, i) {
        var sh = D.shifts.filter(function (x) { return x.shift_date === k && String(x.staff_id) === id; }).sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
        var lv = leaveOn(id, k, D.leaves);
        h += "<td" + (cov[i].closed ? ' class="shut"' : "") + ">" + sh.map(function (x) {
          var on = leaveHit(x, D.leaves), cover = x.role_override === "pharmacist" && !isPh(p);
          var t = compact ? hm(x.start_time).replace(/^0/, "").replace(/:00$/, "") + "–" + hm(x.end_time).replace(/^0/, "").replace(/:00$/, "") : hm(x.start_time) + "–" + hm(x.end_time);
          return '<span class="t' + (on ? " x" : "") + '">' + esc(t) + "</span>" + (cover ? '<span class="n">(acts as pharmacist)</span>' : "") + (on ? '<span class="n ol">(on leave)</span>' : "") + (x.notes ? '<span class="n">' + esc(x.notes) + "</span>" : "");
        }).join("") + (lv ? '<span class="lv">' + esc(compact ? "Leave" : leaveWords(lv, k)) + "</span>" : "") + "</td>";
      });
      h += "</tr>";
    });
    if (!rows.length) h += '<tr><td class="none" colspan="' + (keys.length + 1) + '">Nothing planned.</td></tr>';
    h += '<tr class="duty"><th scope="row" class="who"><b>Pharmacist on duty</b></th>';
    keys.forEach(function (k, i) {
      var c = cov[i];
      if (c.closed) { h += '<td class="shut">' + (compact ? "" : "Closed") + "</td>"; return; }
      var on = D.shifts.filter(function (x) { var p = sm[String(x.staff_id)]; return x.shift_date === k && (isPh(p) || x.role_override === "pharmacist") && !leaveHit(x, D.leaves); }).sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); });
      h += "<td>" + on.map(function (x) {
        var n = (sm[String(x.staff_id)] || {}).full_name || "Staff #" + x.staff_id;
        if (compact) { var w = String(n).trim().split(/\s+/).filter(function (x, j, all) { return !(j < all.length - 1 && /^(dr|pharm|mr|mrs|ms|miss|prof)\.?$/i.test(x)); }); n = w[0] + (w[1] ? " " + w[1].charAt(0) + "." : ""); }
        return "<span>" + esc(n) + (compact ? "" : " " + hm(x.start_time) + "–" + hm(x.end_time)) + "</span>";
      }).join("") + (c.gaps || []).map(function (g) { return '<span class="gap">' + esc("No pharmacist " + g.from + "–" + g.to) + "</span>"; }).join("") + "</td>";
    });
    return h + "</tr></tbody></table>";
  }
  // The classic list by day: a day to a heading, then time, who, role and note; a shift on approved leave struck "(on leave)".
  function listHtml(D, from, to, staffId) {
    var by = {}; D.shifts.forEach(function (s) { if (s.shift_date < from || s.shift_date > to || (staffId && Number(s.staff_id) !== Number(staffId))) return; (by[s.shift_date] = by[s.shift_date] || []).push(s); });
    var days = Object.keys(by).sort(), h = '<div class="list">';
    days.forEach(function (d) {
      var dt = parse(d), c = E.teamCover ? E.teamCover(d, { hours: D.hours, settings: D.settings, shifts: D.shifts, staff: D.sm, leaves: D.leaves }) : null;
      h += "<h2>" + DAY[(dt.getDay() + 6) % 7] + " " + dmy(d) + (c && c.closed ? " · " + esc(c.words) : c && c.holiday ? " · Public holiday (" + esc(c.holiday) + ")" : "") + "</h2>";
      h += '<table><thead><tr><th style="width:16%">Time</th><th style="width:30%">Who</th><th style="width:22%">Role</th><th>Notes</th></tr></thead><tbody>';
      by[d].sort(function (a, b) { return String(a.start_time).localeCompare(String(b.start_time)); }).forEach(function (s) {
        var p = D.sm[String(s.staff_id)], lv = leaveHit(s, D.leaves), a = lv ? '<span class="x">' : "", b = lv ? "</span>" : "";
        var role = p ? desig(p.designation) + (s.role_override === "pharmacist" && !isPh(p) ? " (acts as pharmacist)" : "") : (s.role_override || "");
        h += "<tr><td>" + a + esc(hm(s.start_time) + "–" + hm(s.end_time)) + b + "</td><td>" + a + esc(p ? p.full_name : "Staff #" + s.staff_id) + b + (lv ? ' <b style="display:inline">(on leave)</b>' : "") + "</td><td>" + a + esc(role) + b + "</td><td>" + a + esc(s.notes || "") + b + "</td></tr>";
      });
      h += "</tbody></table>";
    });
    if (!days.length) h += '<p class="none">No shifts from ' + esc(dmy(from)) + " to " + esc(dmy(to)) + ".</p>";
    return h + "</div>";
  }
  // The range a print covers: a week (from its Monday), a month (from its first), or a list's from–to.
  function rangeOf(o) {
    var k = o.kind || "week", f = o.from || today();
    if (k === "week") { var m = mondayOf(parse(f)); return { from: ymd(m), to: ymd(plus(m, 6)) }; }
    if (k === "month") { var d = parse(f); return { from: ymd(new Date(d.getFullYear(), d.getMonth(), 1)), to: ymd(new Date(d.getFullYear(), d.getMonth() + 1, 0)) }; }
    var a = o.from || today(), z = o.to || a; if (a > z) { var t = a; a = z; z = t; } return { from: a, to: z };
  }
  function titleOf(o, r) {
    var a = parse(r.from);
    if (o.kind === "week") return "Rota — week of " + dmy(r.from);
    if (o.kind === "month") return "Rota — " + MONTH[a.getMonth()] + " " + a.getFullYear();
    if (r.from === r.to) return "Shifts — " + DAY[(a.getDay() + 6) % 7] + " " + dmy(r.from);
    if (r.from.slice(5) === "01-01" && r.to.slice(5) === "12-31" && r.from.slice(0, 4) === r.to.slice(0, 4)) return "Shifts — " + a.getFullYear();
    if (r.from.slice(8) === "01" && r.to === ymd(new Date(a.getFullYear(), a.getMonth() + 1, 0))) return "Shifts — " + MONTH[a.getMonth()] + " " + a.getFullYear();
    return "Shifts — " + dmy(r.from) + " to " + dmy(r.to);
  }
  // Gathers what is not handed in (o.data: staff, shifts, leaves, hours, settings): at most one read each.
  async function gather(o, r) {
    var d = o.data || {}, n = 0;
    var parts = await Promise.all([
      d.staff ? d.staff : (n++, E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }).then(function (x) { if (!x || !x.ok) throw new Error((x && x.error) || "Could not read the staff"); return x.staff || []; })),
      d.shifts ? d.shifts : (n++, getRange(r.from, r.to, o.kind === "list" ? o.staffId : null)),
      d.leaves ? d.leaves : (n++, getLeaves(r.from, r.to)),
      d.hours !== undefined && d.settings !== undefined ? { hours: d.hours, settings: d.settings } : (E.rotaRules ? E.rotaRules() : {})
    ]);
    var sm = staffMap(parts[0]);
    return { sm: sm, staff: parts[0], shifts: (parts[1] || []).filter(function (x) { return x.shift_date >= r.from && x.shift_date <= r.to; }), leaves: parts[2] || [], hours: (parts[3] && parts[3].hours) || {}, settings: (parts[3] && parts[3].settings) || {}, reads: n };
  }
  // The printable page for o = { kind, from, to, staffId } and the gathered data D.
  function buildHtml(o, r, D) {
    var title = titleOf(o, r), body;
    if (o.kind === "week") {
      var keys = []; for (var i = 0; i < 7; i++) keys.push(ymd(plus(parse(r.from), i)));
      return pageHtml(title, dmy(r.from) + " to " + dmy(r.to), gridTable(keys, D, false), true);
    }
    if (o.kind === "month") {
      var all = [], d = parse(r.from); while (ymd(d) <= r.to) { all.push(ymd(d)); d = plus(d, 1); }
      body = gridTable(all.slice(0, 15), D, true) + '<div class="pb"></div>' + gridTable(all.slice(15), D, true);
      return pageHtml(title, "Two pages: 1–15 and 16–" + all.length, body, true);
    }
    var who = o.staffId && D.sm[String(o.staffId)] ? D.sm[String(o.staffId)].full_name : "Everyone";
    return pageHtml(title, who + " · " + dmy(r.from) + (r.to !== r.from ? " to " + dmy(r.to) : ""), listHtml(D, r.from, r.to, o.staffId), false);
  }
  function openHtml(html) {
    var url = URL.createObjectURL(new Blob([html], { type: "text/html" }));
    if (E.openPrintUrlOrLink) E.openPrintUrlOrLink(url, { delay: 150, focus: true });
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  // E.rotaPrint({ kind: "week"|"month"|"list", from, to, staffId, data, open }) -> Promise of { html, from, to, reads }.
  // The Phase 0 contract's flat form works too: { kind, from, to, staff, shifts, leaves, hours, settings, person, csv:true }.
  function norm(o) {
    o = o || {}; var n = {}, k; for (k in o) if (Object.prototype.hasOwnProperty.call(o, k)) n[k] = o[k];
    if (["week", "month", "list"].indexOf(n.kind) < 0) n.kind = "week";
    if (n.person != null && n.staffId == null) n.staffId = n.person;
    if (!n.data && (n.staff || n.shifts || n.leaves || n.hours !== undefined)) n.data = { staff: n.staff, shifts: n.shifts, leaves: n.leaves, hours: n.hours, settings: n.settings };
    return n;
  }
  E.rotaPrint = async function (o) {
    o = norm(o);
    if (o.csv) { var c = await E.rotaPrint.csv(o); return { ok: true, csv: c.text, name: c.name, rows: c.rows, reads: c.reads }; }
    var r = rangeOf(o), D = await gather(o, r), html = buildHtml(o, r, D);
    E.rotaPrint.last = { ok: true, kind: o.kind, from: r.from, to: r.to, html: html, reads: D.reads };
    if (o.open !== false) openHtml(html);
    return E.rotaPrint.last;
  };
  E.rotaPrint.range = rangeOf;
  E.rotaPrint.title = function (o) { return titleOf(o, rangeOf(o)); };
  // The classic shiftsToCsv columns (Date, Start, End, Employee, Role, Notes), roles in the same words as the screens.
  // A byte-order mark first, so a spreadsheet opens ċ ġ ħ ż correctly.
  E.rotaPrint.csvText = function (shifts, staff) {
    var sm = staffMap(staff), ce = function (v) { var s = String(v == null ? "" : v); return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
    var rows = [["Date", "Start", "End", "Employee", "Role", "Notes"].map(ce).join(",")];
    (shifts || []).slice().sort(function (a, b) { return String(a.shift_date).localeCompare(String(b.shift_date)) || String(a.start_time).localeCompare(String(b.start_time)); }).forEach(function (s) {
      var e = sm[String(s.staff_id)];
      rows.push([s.shift_date || "", hm(s.start_time), hm(s.end_time), e && e.full_name ? e.full_name : "#" + s.staff_id, e && e.designation ? desig(e.designation) : (s.role_override || ""), s.notes || ""].map(ce).join(","));
    });
    return rows.join("\r\n");
  };
  E.rotaPrint.csv = async function (o) {
    o = norm(o);
    var r = rangeOf(o), D = await gather(o, r);
    var shifts = D.shifts.filter(function (s) { return !(o.kind === "list" && o.staffId) || Number(s.staff_id) === Number(o.staffId); });
    var text = "\ufeff" + E.rotaPrint.csvText(shifts, D.staff), who = o.kind === "list" && o.staffId && D.sm[String(o.staffId)] ? "-" + E.rotaFold(D.sm[String(o.staffId)].full_name).replace(/\s+/g, "-") : "";
    var name = "rota-" + r.from + (r.to !== r.from ? "-to-" + r.to : "") + who + ".csv";
    if (o.open !== false) download(name, text, "text/csv;charset=utf-8");
    return { name: name, text: text, rows: shifts.length, reads: D.reads };
  };

  // The "Print" chooser. ctx: { monday (ymd), month (any ymd in the month shown), staff, data: { week: {...}, month:
  // {...} } (what the screen already has, so printing it reads nothing), onClose }.
  E.rotaPrint.ui = {};
  E.rotaPrint.ui.panel = function (mount, ctx) {
    ctx = ctx || {}; css();
    var t = today(), wk = ctx.monday || ymd(mondayOf(parse(t))), mo = ctx.month || ymd(plus(parse(wk), 3));
    var P = { kind: "week", scope: "month", day: t, mon: mo.slice(0, 7), year: mo.slice(0, 4), from: wk, to: ymd(plus(parse(wk), 6)), who: "", busy: "", err: "", msg: "" };
    var sm = staffMap(ctx.staff), people = active(ctx.staff).sort(function (a, b) { return byRole(sm)(a.id, b.id); });
    var wkTo = ymd(plus(parse(wk), 6)), m0 = parse(mo);
    function req() {
      if (P.kind === "week") return { kind: "week", from: wk, data: ctx.data && ctx.data.week };
      if (P.kind === "month") return { kind: "month", from: mo, data: ctx.data && ctx.data.month };
      var a, z;
      if (P.scope === "day") { a = z = P.day; }
      else if (P.scope === "month") { var p = String(P.mon).split("-"), y = Number(p[0]), m = Number(p[1]) - 1; a = y + "-" + pad(m + 1) + "-01"; z = ymd(new Date(y, m + 1, 0)); }
      else if (P.scope === "year") { a = P.year + "-01-01"; z = P.year + "-12-31"; }
      else { a = P.from; z = P.to; }
      return { kind: "list", from: a, to: z, staffId: P.who || null, data: ctx.data && ctx.data.list };
    }
    function valid() {
      if (P.kind !== "list") return "";
      if (P.scope === "day" && !/^\d{4}-\d{2}-\d{2}$/.test(P.day)) return "Choose the day to print.";
      if (P.scope === "month" && !/^\d{4}-\d{2}$/.test(P.mon)) return "Choose the month to print.";
      if (P.scope === "year" && !/^\d{4}$/.test(String(P.year))) return "Write the year, for example " + t.slice(0, 4) + ".";
      if (P.scope === "range" && (!/^\d{4}-\d{2}-\d{2}$/.test(P.from) || !/^\d{4}-\d{2}-\d{2}$/.test(P.to))) return "Choose the first and the last day.";
      return "";
    }
    function draw() {
      if (!mount || !document.body.contains(mount)) return;
      var opt = function (v, label, small) { return "<label><input type=\"radio\" name=\"rpo-kind\" value=\"" + v + "\"" + (P.kind === v ? " checked" : "") + "> <span>" + label + "</span>" + (small ? "<small>" + esc(small) + "</small>" : "") + "</label>"; };
      var h = '<section class="rpo-panel rpo-print" aria-labelledby="rpo-pr-h"><h2 id="rpo-pr-h">Print the rota</h2>' +
        '<fieldset class="rpo-ch"><legend>What to print</legend>' +
        opt("week", "This week, as a wall rota", parse(wk).getDate() + " " + MON[parse(wk).getMonth()] + " – " + parse(wkTo).getDate() + " " + MON[parse(wkTo).getMonth()]) +
        opt("month", "This month, as a grid", MONTH[m0.getMonth()] + " " + m0.getFullYear()) +
        opt("list", "A list by day", "Any day, month, year or dates") + "</fieldset>";
      if (P.kind === "list") {
        h += '<div class="rpo-row"><label class="rpo-f">Which days<select data-x="scope">' + [["day", "One day"], ["month", "A month"], ["year", "A year"], ["range", "From – to"]].map(function (s) { return '<option value="' + s[0] + '"' + (P.scope === s[0] ? " selected" : "") + ">" + s[1] + "</option>"; }).join("") + "</select></label>";
        if (P.scope === "day") h += '<label class="rpo-f">Day<input type="date" data-x="day" value="' + esc(P.day) + '"></label>';
        else if (P.scope === "month") h += '<label class="rpo-f">Month<input type="month" data-x="mon" value="' + esc(P.mon) + '"></label>';
        else if (P.scope === "year") h += '<label class="rpo-f">Year<input type="number" inputmode="numeric" min="2000" max="2100" data-x="year" value="' + esc(P.year) + '"></label>';
        else h += '<label class="rpo-f">From<input type="date" data-x="from" value="' + esc(P.from) + '"></label><label class="rpo-f">To<input type="date" data-x="to" value="' + esc(P.to) + '"></label>';
        h += '<label class="rpo-f">Who<select data-x="who"><option value="">Everyone</option>' + people.map(function (p) { return '<option value="' + esc(p.id) + '"' + (P.who === String(p.id) ? " selected" : "") + ">" + esc(p.full_name) + "</option>"; }).join("") + "</select></label></div>";
      }
      h += (P.err ? '<p class="rpo-err" role="alert">' + esc(P.err) + "</p>" : "") +
        '<div class="rpo-acts"><button class="rpo-btn p" data-x="print"' + (P.busy ? " disabled" : "") + ">" + (P.busy === "print" ? "Getting it ready…" : "Print") + '</button><button class="rpo-btn" data-x="csv"' + (P.busy ? " disabled" : "") + ">" + (P.busy === "csv" ? "Making the file…" : "Download as a spreadsheet") + "</button>" + (ctx.onClose ? '<button class="rpo-btn" data-x="close">Cancel</button>' : "") + "</div>" +
        '<p class="rpo-ok" role="status" aria-live="polite">' + esc(P.msg) + "</p>" +
        '<p class="m">Opens in a new tab ready to print. To keep a PDF, choose Save as PDF as the printer.</p></section>';
      mount.innerHTML = h; wire();
    }
    function keep() { var a = document.activeElement; return a && mount.contains(a) ? (a.getAttribute("data-x") || (a.name === "rpo-kind" ? "kind:" + a.value : "")) : ""; }
    function refocus(k) { if (!k) return; var el = k.indexOf("kind:") === 0 ? mount.querySelector('input[name="rpo-kind"][value="' + k.slice(5) + '"]') : mount.querySelector('[data-x="' + k + '"]'); if (el) el.focus(); }
    function wire() {
      mount.querySelectorAll('input[name="rpo-kind"]').forEach(function (r) { r.addEventListener("change", function () { P.kind = r.value; P.err = ""; P.msg = ""; var k = keep(); draw(); refocus(k); }); });
      mount.querySelectorAll("[data-x]").forEach(function (el) {
        var x = el.getAttribute("data-x");
        if (el.tagName === "SELECT" || el.tagName === "INPUT") el.addEventListener("change", function () { P[x] = el.value; P.err = ""; if (x === "scope") { draw(); refocus("scope"); } });
        else el.addEventListener("click", function () {
          if (x === "close") { if (ctx.onClose) ctx.onClose(); return; }
          var bad = valid(); if (bad) { P.err = bad; draw(); return; }
          go(x);
        });
      });
    }
    async function go(x) {
      P.busy = x; P.err = ""; P.msg = ""; draw();
      try {
        var o = req();
        if (x === "print") { await E.rotaPrint(o); P.msg = "Opened in a new tab. If nothing opened, allow pop-ups for this site and press Print again."; }
        else { var f = await E.rotaPrint.csv(o); P.msg = f.rows ? "Downloaded " + f.name + " (" + f.rows + (f.rows === 1 ? " shift" : " shifts") + ")." : "Downloaded " + f.name + ". There are no shifts in it yet."; }
      } catch (e) { P.err = failWords(e); }
      P.busy = ""; draw(); refocus(x);
    }
    draw();
    var first = mount.querySelector('input[name="rpo-kind"]:checked'); if (first && ctx.focus !== false) first.focus();
    return { redraw: draw, close: function () { if (mount) mount.innerHTML = ""; } };
  };
})();
