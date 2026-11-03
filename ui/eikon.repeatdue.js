/* EIKON — repeats coming due (E.repeatDue). Backlog 3 item 7.
   Used by Today's "Repeats" card and by Repeat prescriptions (repreg): "Next due", the "Due" view, "Collected today".

   ┌──────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
   │ NEEDS PHARMACIST SIGN-OFF. Every rule that decides what "due" and "running out" mean is in RULES below and     │
   │ nowhere else (the worker only sends a superset of lines; see REPEATS_LOOKAHEAD_DAYS there). Change a number     │
   │ or a switch here, bump BUILD in index.html, and both screens follow. The values are the agent's assumptions,   │
   │ not a pharmacist's decision.                                                                                   │
   └──────────────────────────────────────────────────────────────────────────────────────────────────────────────┘ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var RULES = {
    // ASSUMED: the interval choices offered on the form ("Collected every … days"); any whole number 1–365 may be typed.
    INTERVAL_CHIPS: [7, 14, 28, 30, 56, 90],
    // ASSUMED: "next due" counts from the last collection ("Collected today"); before the first one, from the day
    // the prescription was written. A renewal starts again from its own written date (the old line's collections
    // are not carried over).
    BASE: "last_collected_else_written",
    // ASSUMED: "due" = next due within this many days from today (today included). Overdue ones always count.
    DUE_WITHIN_DAYS: 7,
    // ASSUMED: an overdue repeat stays on the list until the prescription runs out (null = no other limit; a number
    // N drops it N days after it was due, e.g. a patient who stopped coming).
    OVERDUE_DROP_AFTER_DAYS: null,
    // ASSUMED: also list prescriptions that run out soon, and how soon. Must not exceed the worker's
    // REPEATS_LOOKAHEAD_DAYS (92) or Today will miss some. Set SHOW_RUNNING_OUT to false to list only collections.
    SHOW_RUNNING_OUT: true,
    RUN_OUT_WITHIN_DAYS: 30,
    // ASSUMED: "running out" lists every valid prescription, with or without an interval. true = only the ones the
    // pharmacy marked as collected regularly (a shorter list).
    RUN_OUT_NEEDS_INTERVAL: false,
    // ASSUMED: when the next collection would fall after the prescription runs out, the line is "running out"
    // (ask the doctor), not "due".
    DUE_AFTER_EXPIRY_IS_RUNNING_OUT: true,
    // ASSUMED: a later prescription for the same ID card and the same medicine replaces the earlier one (the earlier
    // one is never due nor running out). Same key as repreg's "Renewed".
    LATER_LINE_REPLACES: true
    // NOT HANDLED (no data link yet): POYC entitlements, and supplies recorded in the daily register. Neither counts
    // as a collection; only "Collected today" does.
  };

  function low(s) { return String(s || "").toLowerCase(); }
  function parse(ymd) { var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd || "")); return m ? Date.UTC(+m[1], +m[2] - 1, +m[3]) : NaN; }
  // Calendar-day arithmetic on YYYY-MM-DD in UTC: no clock change, month end or leap day can shift it by one.
  function addDays(ymd, n) { var t = parse(ymd); return isNaN(t) ? "" : new Date(t + Number(n) * 86400000).toISOString().slice(0, 10); }
  function diffDays(from, to) { var a = parse(from), b = parse(to); return isNaN(a) || isNaN(b) ? null : Math.round((b - a) / 86400000); }
  function today() { return (E.maltaYmd && E.maltaYmd()) || new Date().toISOString().slice(0, 10); } // Malta's date, as the header shows
  function every(e) { var n = Number(e && e.collect_every_days); return Number.isInteger(n) && n >= 1 && n <= 365 ? n : null; }
  function key(e) { return low(e.client_id).replace(/\s+/g, "") + "|" + low(e.medicine_name_dose).replace(/\s+/g, " ").trim(); }
  function laterOf(e, all) { // a later prescription for the same patient and medicine, if any
    if (!RULES.LATER_LINE_REPLACES || !all) return null;
    var k = key(e);
    return all.filter(function (x) { return x !== e && x.id !== e.id && key(x) === k && (x.entry_date > e.entry_date || (x.entry_date === e.entry_date && x.id > e.id)); })[0] || null;
  }
  function nextDue(e) {
    var n = every(e); if (!n) return "";
    var base = (RULES.BASE === "last_collected_else_written" && e.last_collected_date) ? e.last_collected_date : e.entry_date;
    return addDays(base, n);
  }
  // One line's state on a given day: { kind, next, days, runsOutIn }.
  // kind: "renewed" | "expired" | "overdue" | "due" | "runout" | "later" | "none" (no interval, not running out).
  function status(e, on, all) {
    on = on || today();
    var out = { kind: "none", next: nextDue(e), days: null, runsOutIn: diffDays(on, e.expires_date) };
    if (laterOf(e, all)) { out.kind = "renewed"; return out; }
    if (e.expires_date && e.expires_date < on) { out.kind = "expired"; return out; }
    var soon = RULES.SHOW_RUNNING_OUT && out.runsOutIn != null && out.runsOutIn <= RULES.RUN_OUT_WITHIN_DAYS && (!RULES.RUN_OUT_NEEDS_INTERVAL || !!every(e));
    if (out.next) {
      out.days = diffDays(on, out.next);
      var pastExpiry = RULES.DUE_AFTER_EXPIRY_IS_RUNNING_OUT && e.expires_date && out.next > e.expires_date;
      if (!pastExpiry && out.days < 0 && (RULES.OVERDUE_DROP_AFTER_DAYS == null || -out.days <= RULES.OVERDUE_DROP_AFTER_DAYS)) { out.kind = "overdue"; return out; }
      if (!pastExpiry && out.days >= 0 && out.days <= RULES.DUE_WITHIN_DAYS) { out.kind = "due"; return out; }
      if (pastExpiry && RULES.SHOW_RUNNING_OUT && (soon || out.days <= RULES.DUE_WITHIN_DAYS)) { out.kind = "runout"; return out; }
    }
    if (soon) { out.kind = "runout"; return out; }
    out.kind = out.next ? "later" : "none";
    return out;
  }
  // The two lists Today and the Due view show: due (overdue first, then soonest) and running out (soonest first).
  function buckets(entries, on) {
    on = on || today();
    var due = [], runout = [];
    (entries || []).forEach(function (e) {
      var s = status(e, on, entries);
      if (s.kind === "overdue" || s.kind === "due") due.push({ e: e, s: s });
      else if (s.kind === "runout") runout.push({ e: e, s: s });
    });
    due.sort(function (a, b) { return a.s.days - b.s.days || String(a.e.client_name).localeCompare(String(b.e.client_name)); });
    runout.sort(function (a, b) { return String(a.e.expires_date).localeCompare(String(b.e.expires_date)) || String(a.e.client_name).localeCompare(String(b.e.client_name)); });
    return { due: due, runout: runout };
  }
  // Words for a line, shared by both screens ("Due today", "Overdue 3 days", "Due in 5 days", "Runs out in 12 days").
  function words(s) {
    if (!s) return "";
    if (s.kind === "overdue") return "Overdue " + (-s.days) + (s.days === -1 ? " day" : " days");
    if (s.kind === "due") return s.days === 0 ? "Due today" : s.days === 1 ? "Due tomorrow" : "Due in " + s.days + " days";
    if (s.kind === "runout") return s.runsOutIn === 0 ? "Runs out today" : "Runs out in " + s.runsOutIn + (s.runsOutIn === 1 ? " day" : " days");
    return "";
  }

  E.repeatDue = { RULES: RULES, addDays: addDays, diffDays: diffDays, today: today, every: every, nextDue: nextDue, status: status, buckets: buckets, words: words, key: key };
})();
