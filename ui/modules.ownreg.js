/* How we're doing (Money › How we're doing): one calm page for the pharmacist in charge, and for a group's head office.
   For a week or a month (Malta days): takings by day against the days before, paid outs, over/under at closing, credit
   notes still held, what customers are waiting for, what needs the pharmacist now (days not closed, fridges not logged,
   cleaning, certificates, the controlled-drug count, orders and deliveries late), hours from the rota, controlled-drug
   totals and the services given. Every figure opens the records behind it. Three reports, each printed (black on white,
   the pharmacy's name, page numbers, Malta time) and as a spreadsheet: month end for the accountant, controlled-drug
   totals for the inspector, staff hours for payroll.
   Reads only: one GET /owner/summary per period shown (the worker adds it all up), and GET /owner/records when a figure
   is opened or a report made. Admins only (the worker refuses anyone else); head office (company admin) sees its own
   group's pharmacies, each or combined, and never a patient's name or ID card. Nothing here writes anything. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "ownreg", LS = "eikon_own_view";
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var WD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var S = { mount: null, view: "month", anchor: "", loc: "all", data: null, loading: false, error: "", seq: 0, dlg: null, busy: "", note: "" };
  E.owner = { state: S };

  // ── small things
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { return (E.maltaYmd && E.maltaYmd()) || new Date().toISOString().slice(0, 10); }
  function addDays(s, n) { var d = new Date(s + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function diffDays(a, b) { return Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 864e5); }
  function wday(s) { return new Date(s + "T12:00:00Z").getUTCDay(); }
  function lastOf(ym) { var a = ym.split("-"); return ym + "-" + pad(new Date(Date.UTC(+a[0], +a[1], 0)).getUTCDate()); }
  function shiftYm(ym, n) { var a = ym.split("-"), d = new Date(Date.UTC(+a[0], +a[1] - 1 + n, 1)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1); }
  function monthName(ym) { var a = ym.split("-"); return MON[+a[1] - 1] + " " + a[0]; }
  function dayText(s, wk) { var a = String(s).split("-"); return (wk ? WD[wday(s)] + " " : "") + Number(a[2]) + " " + SHORT[+a[1] - 1]; }
  function dmy(s) { var m = String(s || "").match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(s || ""); }
  function eur(n) { var v = Math.round((Number(n) || 0) * 100) / 100; return (v < 0 ? "−€" : "€") + Math.abs(v).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function num(n) { return (Number(n) || 0).toLocaleString("en-GB", { maximumFractionDigits: 1 }); }
  function plural(n, one, many) { return num(n) + " " + (Number(n) === 1 ? one : many); }
  function listDays(days, max) { max = max || 4; var s = days.slice(0, max).map(function (d) { return dayText(d, true); }), more = days.length - s.length; return s.join(", ") + (more > 0 ? " and " + more + " more" : ""); }
  function user() { return (E.state && E.state.user) || {}; }
  function ui2() { return !!(E.isUi2 && E.isUi2()); }
  function remember() { try { localStorage.setItem(LS, JSON.stringify({ view: S.view, loc: S.loc })); } catch (e) {} }
  function recall() { try { var o = JSON.parse(localStorage.getItem(LS) || "null"); if (o && (o.view === "week" || o.view === "month")) S.view = o.view; if (o && o.loc) S.loc = String(o.loc); } catch (e) {} }

  // ── the period: a Monday-to-Sunday week or a calendar month, compared with the same days of the one before
  function period(view, anchor, t) {
    t = t || today();
    if (view === "week") {
      var mon = addDays(anchor, -((wday(anchor) + 6) % 7)), sun = addDays(mon, 6), cur = t >= mon && t <= sun, n = cur ? diffDays(mon, t) + 1 : 7;
      var a = mon.split("-"), b = sun.split("-");
      var label = Number(a[2]) + (a[1] !== b[1] ? " " + SHORT[+a[1] - 1] : "") + "–" + Number(b[2]) + " " + SHORT[+b[1] - 1] + " " + b[0];
      return { view: view, from: mon, to: sun, cur: cur, label: label, title: cur ? "This week" : "Week of " + dayText(mon), cmp: { from: addDays(mon, -7), to: addDays(mon, -7 + n - 1) },
        cmpLabel: cur ? "the same days last week" : "the week before", future: mon > t };
    }
    var ym = anchor.slice(0, 7), from = ym + "-01", to = lastOf(ym), curM = t.slice(0, 7) === ym, pm = shiftYm(ym, -1), pl = lastOf(pm);
    var cto = curM ? addDays(pm + "-01", Number(t.slice(8)) - 1) : pl; if (cto > pl) cto = pl;
    return { view: "month", from: from, to: to, cur: curM, label: monthName(ym), title: curM ? "This month" : monthName(ym), cmp: { from: pm + "-01", to: cto },
      cmpLabel: curM ? "the same days of " + MON[+pm.slice(5) - 1] : MON[+pm.slice(5) - 1], future: from > t };
  }
  function move(k) {
    var p = period(S.view, S.anchor);
    S.anchor = S.view === "week" ? addDays(p.from, 7 * k) : shiftYm(p.from.slice(0, 7), k) + "-01";
    if (S.anchor > today()) S.anchor = today();
    load();
  }

  // ── reading
  function q(p, extra) {
    var s = "?from=" + p.from + "&to=" + p.to + (extra || "");
    if (S.data && S.data.group && S.loc) s += "&loc=" + encodeURIComponent(S.loc);
    return s;
  }
  function errText(e) { return e && e.status === 403 ? "Only the pharmacist in charge can see how the pharmacy is doing." : e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e.error)) || "Could not add up the figures. Try again."); }
  async function load() {
    var my = ++S.seq, p = period(S.view, S.anchor);
    S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/owner/summary" + q(p, "&cmp_from=" + p.cmp.from + "&cmp_to=" + p.cmp.to), { method: "GET" });
      if (my !== S.seq) return;
      if (!r || r.ok === false || !Array.isArray(r.pharmacies)) throw new Error((r && r.error) || "Could not add up the figures. Try again.");
      if (r.group && S.loc !== "all" && !(r.pharmacies_allowed || []).some(function (x) { return String(x.id) === String(S.loc); })) { S.loc = "all"; S.data = r; return load(); }
      S.data = r; S.period = p;
    } catch (e) { if (my !== S.seq) return; S.error = errText(e); }
    S.loading = false; paint();
  }
  async function records(kinds, p) {
    var r = await E.apiFetch("/owner/records" + q(p, "&kinds=" + kinds.join(",")), { method: "GET" });
    if (!r || r.ok === false) throw new Error((r && r.error) || "Could not read the records. Try again.");
    return r;
  }

  // ── adding pharmacies together (head office, "All pharmacies")
  function combine(list) {
    if (list.length === 1) return list[0];
    var z = { id: "all", name: "All pharmacies", combined: true, money: {}, prev: {}, days: [], credit: {}, orders: {}, questions: {}, deliveries: {}, repeats: {}, services: {},
      registers: {}, dda: { supplied: [], poyc: [], received: [] }, staff: [], locums: [] };
    var sum = function (k) { list.forEach(function (p) { Object.keys(p[k] || {}).forEach(function (f) { var v = p[k][f]; if (typeof v === "number") z[k][f] = Math.round(((z[k][f] || 0) + v) * 100) / 100; }); }); };
    ["money", "prev", "credit", "orders", "questions", "deliveries", "repeats", "services"].forEach(sum);
    var byDay = {};
    list.forEach(function (p) { (p.days || []).forEach(function (d) { var o = byDay[d.date] || (byDay[d.date] = { date: d.date, takings: 0, epos: 0, cheques: 0, paid_outs: 0, cash: 0, over_under: null, paid_out_register: 0, closed: 0 });
      ["takings", "epos", "cheques", "paid_outs", "cash", "paid_out_register"].forEach(function (k) { o[k] = Math.round((o[k] + (Number(d[k]) || 0)) * 100) / 100; });
      if (d.over_under != null) o.over_under = Math.round(((o.over_under || 0) + d.over_under) * 100) / 100; o.closed++; }); });
    z.days = Object.keys(byDay).sort().map(function (k) { return byDay[k]; });
    ["supplied", "poyc", "received"].forEach(function (k) { var m = {}; list.forEach(function (p) { (p.dda[k] || []).forEach(function (r) { var o = m[r.name] || (m[r.name] = { name: r.name, lines: 0, qty: 0 }); o.lines += r.lines; o.qty += r.qty; }); });
      z.dda[k] = Object.keys(m).sort(function (a, b) { return a.localeCompare(b); }).map(function (n) { return m[n]; }); });
    list.forEach(function (p) { (p.staff || []).forEach(function (s) { z.staff.push(Object.assign({ pharmacy: p.name }, s)); }); (p.locums || []).forEach(function (s) { z.locums.push(Object.assign({ pharmacy: p.name }, s)); }); });
    return z;
  }
  function shown() {
    var d = S.data; if (!d || !d.pharmacies) return null;
    return combine(d.pharmacies);
  }

  // ── what needs the pharmacist: one line per thing, the worst first
  var CLEAN_DAYS = 7, COUNT_DAYS = 31;
  function needs(p, t, name) {
    var out = [], g = p.registers || {}, pre = name ? name + ": " : "";
    var add = function (level, text, go) { out.push({ level: level, text: pre + text, go: go || null, loc: p.id }); };
    (g.temperature_gaps || []).forEach(function (x) { add("missing", x.name + " has " + plural(x.missing, "day", "days") + " without a reading (" + listDays(x.days) + ").", { mod: "tempreg", ym: x.first.slice(0, 7) }); });
    if (g.temperature_out_no_note) add("missing", plural(g.temperature_out_no_note, "reading", "readings") + " outside the limits without a note.", { mod: "tempreg" });
    if (g.cleaning_days_since == null && (g.temperature_devices || 0) > 0) add("missing", "No cleaning recorded yet.", { mod: "cleanreg" });
    else if (g.cleaning_days_since != null && g.cleaning_days_since > CLEAN_DAYS) add("missing", "Cleaning last recorded " + g.cleaning_days_since + " days ago (" + dayText(g.cleaning_last) + "). It is due once a week.", { mod: "cleanreg", ym: g.cleaning_last.slice(0, 7) });
    else if ((g.cleaning_empty_weeks || []).length) add("missing", "No cleaning in " + plural(g.cleaning_empty_weeks.length, "week", "weeks") + " (week of " + dayText(g.cleaning_empty_weeks[0]) + ").", { mod: "cleanreg", ym: g.cleaning_empty_weeks[0].slice(0, 7) });
    (g.certificates_overdue || []).forEach(function (c) { add("missing", c + " is overdue.", { mod: "certreg" }); });
    if ((p.deliveries || {}).late) add("missing", plural(p.deliveries.late, "delivery is", "deliveries are") + " past the day planned.", { rec: "deliveries" });
    if ((p.orders || {}).overdue) add("missing", plural(p.orders.overdue, "order is", "orders are") + " past the day the customer needed it.", { rec: "orders" });
    if ((g.eod_not_closed || []).length) add("look", "End of day not saved on " + plural(g.eod_not_closed.length, "day", "days") + " (" + listDays(g.eod_not_closed) + ").", { mod: "eodreg" });
    if ((p.money || {}).short_days) add("look", "Short at closing on " + plural(p.money.short_days, "day", "days") + ", " + eur(-(p.money.short_total || 0)) + " in all.", { rec: "eod" });
    if ((g.eod_not_locked || []).length) add("look", plural(g.eod_not_locked.length, "day is", "days are") + " saved but not locked (" + listDays(g.eod_not_locked) + ").", { mod: "eodreg" });
    (g.certificates_due_30 || []).forEach(function (c) { add("look", c + " is due within 30 days.", { mod: "certreg" }); });
    var anyDda = ["supplied", "poyc", "received"].some(function (k) { return ((p.dda || {})[k] || []).length; });
    if (g.dda_days_since_stocktake != null && g.dda_days_since_stocktake > COUNT_DAYS) add("look", "Controlled drugs last counted " + g.dda_days_since_stocktake + " days ago (" + dayText(g.dda_last_stocktake) + ").", { mod: "ddstreg" });
    else if (g.dda_days_since_stocktake == null && anyDda) add("look", "Controlled drugs have never been counted in Eikon.", { mod: "ddstreg" });
    if ((p.questions || {}).overdue) add("look", plural(p.questions.overdue, "question is", "questions are") + " past the day to call back.", { rec: "questions" });
    if ((p.credit || {}).expiring_30) add("look", plural(p.credit.expiring_30, "credit note", "credit notes") + " (" + eur(p.credit.expiring_30_total) + ") run out within 30 days.", { rec: "credit_notes" });
    if ((p.orders || {}).waiting_30) add("look", plural(p.orders.waiting_30, "order has", "orders have") + " waited more than 30 days.", { rec: "orders" });
    return out;
  }
  function allNeeds() {
    var d = S.data, t = d.today, many = d.pharmacies.length > 1, out = [];
    d.pharmacies.forEach(function (p) { out = out.concat(needs(p, t, many ? p.name : "")); });
    return out.sort(function (a, b) { return (a.level === "missing" ? 0 : 1) - (b.level === "missing" ? 0 : 1); });
  }
  E.owner.needs = needs; E.owner.period = period; E.owner.combine = combine;

  // ── style (prefixed own-; the app's own tokens, light and dark)
  function css() {
    if (E.months && E.months.css) E.months.css();
    if (document.getElementById("eikon-ownreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ownreg-css";
    st.textContent =
      ".own{max-width:1120px;margin:0 auto;color:var(--text)}" +
      ".own-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 12px 0 0;min-height:44px;margin:-8px 0 2px;cursor:pointer}" +
      ".own h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.own-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;max-width:640px}" +
      ".own-bar{display:flex;flex-wrap:wrap;align-items:center;gap:8px 12px;margin:14px 0 4px}.own-bar .emb{margin:0}" +
      ".own-seg{display:inline-flex;background:rgba(118,118,128,.12);border-radius:10px;padding:2px}.own-seg button{font:inherit;font-size:14px;font-weight:600;min-height:40px;padding:0 16px;border:0;border-radius:8px;background:transparent;color:var(--text);cursor:pointer}" +
      ".own-seg button[aria-pressed=true]{background:var(--panel2);box-shadow:0 1px 3px rgba(0,0,0,.12)}" +
      ".own-sel{font:inherit;font-size:15px;min-height:44px;padding:0 12px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text)}" +
      ".own-lab{font-size:13px;font-weight:600;color:var(--muted);margin:24px 2px 8px;display:flex;justify-content:space-between;gap:8px;align-items:baseline}.own-lab h2{font-size:17px;font-weight:700;color:var(--text);margin:0;letter-spacing:-.01em}" +
      ".own-tiles{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px;margin-top:12px}" +
      ".own-tile{display:flex;flex-direction:column;justify-content:flex-start;align-items:stretch;text-align:left;font:inherit;color:var(--text);background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;cursor:pointer;min-height:112px}" +
      ".own-tile:hover{background:rgba(118,118,128,.06)}.own-tile small{display:block;font-size:13px;color:var(--muted);font-weight:600}" +
      ".own-tile b{display:block;font-size:26px;font-weight:750;letter-spacing:-.02em;font-variant-numeric:tabular-nums;margin:6px 0 4px;line-height:1.1}.own-tile span{display:block;font-size:12.5px;color:var(--muted);line-height:1.4}" +
      ".own-tile .bad{color:var(--danger);font-weight:600}" +
      ".own-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:14px 16px}" +
      ".own-chart{position:relative}.own-chart svg{display:block;width:100%;height:170px}.own-axis{display:flex;justify-content:space-between;font-size:11.5px;color:var(--muted);margin-top:6px;font-variant-numeric:tabular-nums}" +
      ".own-chart .bar{fill:var(--accent)}.own-chart .bar.dim{fill:var(--accent);opacity:.35}.own-chart .ref{stroke:var(--text);stroke-width:1.5;stroke-dasharray:5 4;opacity:.55}.own-chart .base{stroke:var(--border);stroke-width:1}" +
      ".own-chart .hit{fill:transparent;cursor:default}.own-tip{position:absolute;top:-6px;transform:translate(-50%,-100%);background:var(--text);color:var(--panel2);font-size:12.5px;padding:6px 9px;border-radius:8px;white-space:nowrap;pointer-events:none;font-variant-numeric:tabular-nums}" +
      ".own-key{font-size:12.5px;color:var(--muted);margin:8px 0 0;display:flex;gap:16px;flex-wrap:wrap}.own-key i{display:inline-block;width:10px;height:10px;border-radius:2px;background:var(--accent);margin-right:6px;vertical-align:-1px}.own-key i.ln{height:0;border-top:2px dashed var(--text);opacity:.55;border-radius:0;width:16px;background:none;vertical-align:3px}" +
      ".own details{margin-top:10px}.own summary{cursor:pointer;color:var(--accent);font-size:14px;font-weight:600;min-height:32px;display:inline-flex;align-items:center}" +
      ".own-tbl{width:100%;border-collapse:collapse;font-size:14px;font-variant-numeric:tabular-nums}.own-tbl th{font-size:12.5px;font-weight:600;color:var(--muted);text-align:left;padding:6px 8px;border-bottom:1px solid var(--border)}" +
      ".own-tbl td{padding:8px;border-bottom:.5px solid var(--border);vertical-align:top}.own-tbl tr:last-child td{border-bottom:0}.own-tbl .n{text-align:right;white-space:nowrap}.own-tbl tfoot td{font-weight:700;border-top:1px solid var(--border)}" +
      ".own-scroll{overflow-x:auto;-webkit-overflow-scrolling:touch}" +
      ".own-need{display:flex;align-items:center;gap:12px;width:100%;text-align:left;font:inherit;color:var(--text);background:none;border:0;border-top:.5px solid var(--border);padding:10px 4px;min-height:48px;cursor:pointer}.own-need:first-child{border-top:0}.own-need:hover{background:rgba(118,118,128,.06)}" +
      ".own-need .t{flex:1;min-width:0;font-size:14.5px;line-height:1.4}.own-need .go{color:var(--muted);font-size:18px}" +
      ".own-pill{flex:0 0 auto;font-size:12px;font-weight:700;padding:3px 9px;border-radius:999px;white-space:nowrap}.own-pill.missing{background:var(--danger-soft,rgba(191,59,46,.12));color:var(--danger)}.own-pill.look{background:var(--warn-soft,rgba(201,138,18,.16));color:var(--warn,#8A5A08)}.own-pill.ok{background:var(--ok-soft,rgba(28,138,91,.12));color:var(--ok)}" +
      ".own-fine{display:flex;gap:10px;align-items:center;font-size:14.5px}" +
      ".own-grid3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.own-grid2{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}" +
      ".own-mini h3{font-size:15px;margin:0 0 6px;font-weight:700}.own-mini .r{display:flex;justify-content:space-between;align-items:center;gap:8px;min-height:36px;border-top:.5px solid var(--border);font-size:14px}.own-mini .r:first-of-type{border-top:0}" +
      ".own-num{font:inherit;font-weight:700;font-variant-numeric:tabular-nums;color:var(--accent);background:none;border:0;padding:4px 6px;margin:-4px -6px;border-radius:8px;cursor:pointer;min-height:32px}.own-num:hover{background:rgba(118,118,128,.1)}.own-num.bad{color:var(--danger)}.own-plain{font-weight:700;font-variant-numeric:tabular-nums}" +
      ".own-row{display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap;border-top:.5px solid var(--border);padding:12px 0}.own-row:first-child{border-top:0;padding-top:2px}.own-row .t{flex:1 1 280px}.own-row b{display:block;font-size:15px}.own-row span{display:block;font-size:13px;color:var(--muted);margin-top:2px}" +
      ".own-btn{font:inherit;font-size:14px;font-weight:600;min-height:40px;padding:0 16px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}.own-btn:disabled{opacity:.55;cursor:default}.own-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".own-acts{display:flex;gap:8px;flex-wrap:wrap}" +
      ".own-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".own-note{font-size:13px;color:var(--muted);margin:10px 2px 0}" +
      ".own-ph td{vertical-align:middle}.own-ph td:first-child button{font:inherit;font-weight:600;color:var(--accent);background:none;border:0;padding:0;cursor:pointer;text-align:left;min-height:32px}" +
      ".own-dlg-bg{position:fixed;inset:0;background:rgba(0,0,0,.35);z-index:1000;display:flex;align-items:flex-start;justify-content:center;padding:6vh 16px 16px;overflow:auto}" +
      ".own-dlg{background:var(--panel2);color:var(--text);border-radius:16px;max-width:980px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,.3);padding:16px 18px 18px}" +
      ".own-dlg header{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:8px}.own-dlg h2{font-size:20px;margin:0}.own-dlg header span{display:block;color:var(--muted);font-size:13.5px;margin-top:2px}" +
      ".own-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (max-width:900px){.own-tiles{grid-template-columns:repeat(2,minmax(0,1fr))}.own-grid3{grid-template-columns:1fr}.own-grid2{grid-template-columns:1fr}}" +
      "@media (max-width:600px){.own{padding:4px 16px 0}.own h1{font-size:30px}.own-tile{min-height:104px;padding:12px}.own-tile b{font-size:21px}.own-btn{min-height:44px;border-radius:22px}.own-seg button{min-height:44px}.own-dlg-bg{padding:0}.own-dlg{border-radius:0;min-height:100%}.own-num{min-height:44px}}";
    document.head.appendChild(st);
  }

  // ── drawing
  function delta(cur, prev, label) {
    if (prev == null) return "";
    if (!prev && !cur) return "Nothing on " + label + " either";
    if (!prev) return "Nothing on " + label;
    var pc = Math.round((cur - prev) / Math.abs(prev) * 100);
    if (!pc) return "The same as " + label;
    return (pc > 0 ? "▲ " : "▼ ") + Math.abs(pc) + "% on " + label + " (" + eur(prev) + ")";
  }
  function tile(rec, label, value, line, bad) { return '<button type="button" class="own-tile" data-rec="' + rec + '"><small>' + esc(label) + '</small><b>' + esc(value) + "</b><span" + (bad ? ' class="bad"' : "") + ">" + esc(line) + "</span></button>"; }
  function chart(p, z, per) {
    var days = [], t = S.data.today; for (var d = per.from; d <= per.to; d = addDays(d, 1)) days.push(d);
    var by = {}; (z.days || []).forEach(function (x) { by[x.date] = x; });
    var vals = days.map(function (d) { return by[d] ? Number(by[d].takings) || 0 : 0; });
    var prevAvg = z.prev && z.prev.days_closed ? z.prev.takings / z.prev.days_closed : 0;
    var max = Math.max.apply(null, vals.concat([prevAvg, 1])), W = 700, H = 170, step = W / days.length, bw = Math.max(2, Math.min(28, step * 0.62));
    var y = function (v) { return H - 4 - (H - 14) * (v / max); };
    var h = '<svg viewBox="0 0 ' + W + " " + H + '" preserveAspectRatio="none" role="img" aria-label="' + esc("Takings by day, " + per.label + ": " + eur(z.money.takings) + " on " + plural(z.money.days_closed, "day closed", "days closed") + ". The table below lists every day.") + '">';
    h += '<line class="base" x1="0" x2="' + W + '" y1="' + (H - 4) + '" y2="' + (H - 4) + '" vector-effect="non-scaling-stroke"/>';
    days.forEach(function (d, i) {
      var v = vals[i], x = i * step + (step - bw) / 2;
      if (v > 0) h += '<rect class="bar' + (d > t ? " dim" : "") + '" x="' + x.toFixed(1) + '" y="' + y(v).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + (H - 4 - y(v)).toFixed(1) + '" rx="3"/>';
      h += '<rect class="hit" data-i="' + i + '" x="' + (i * step).toFixed(1) + '" y="0" width="' + step.toFixed(1) + '" height="' + H + '"/>';
    });
    if (prevAvg > 0) h += '<line class="ref" x1="0" x2="' + W + '" y1="' + y(prevAvg).toFixed(1) + '" y2="' + y(prevAvg).toFixed(1) + '" vector-effect="non-scaling-stroke"/>';
    h += "</svg>";
    var ticks = per.view === "week" ? days.map(function (d) { return WD[wday(d)]; }) : [days[0], days[Math.floor(days.length / 2)], days[days.length - 1]].map(function (d) { return dayText(d); });
    S.chart = { days: days, by: by };
    return '<div class="own-chart" aria-describedby="own-chart-key">' + h + '<div class="own-tip" hidden></div><div class="own-axis" aria-hidden="true">' + ticks.map(function (x) { return "<span>" + esc(x) + "</span>"; }).join("") + "</div></div>" +
      '<p class="own-key" id="own-chart-key"><span><i></i>Takings (X readings) each day</span>' + (prevAvg > 0 ? '<span><i class="ln"></i>Day\'s average on ' + esc(per.cmpLabel) + ": " + esc(eur(prevAvg)) + "</span>" : "") + "</p>";
  }
  function dayTable(z) {
    var rows = (z.days || []).slice().reverse();
    if (!rows.length) return '<p class="own-note">No end of day saved for these days.</p>';
    var tot = function (k) { return eur(rows.reduce(function (t, d) { return t + (Number(d[k]) || 0); }, 0)); };
    return '<div class="own-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="own-tbl"><thead><tr><th>Day</th>' + (z.combined ? '<th class="n">Pharmacies</th>' : "<th>Closed by</th>") + '<th class="n">Takings</th><th class="n">EPOS</th><th class="n">Cheques</th><th class="n">Paid out (till)</th><th class="n">Cash</th><th class="n">Over / under</th></tr></thead><tbody>' +
      rows.map(function (d) { return "<tr><td>" + esc(dayText(d.date, true)) + "</td>" + (z.combined ? '<td class="n">' + esc(d.closed) + "</td>" : "<td>" + esc(d.staff || "") + (d.locked ? "" : ' <span class="own-pill look">Not locked</span>') + "</td>") +
        '<td class="n">' + eur(d.takings) + '</td><td class="n">' + eur(d.epos) + '</td><td class="n">' + eur(d.cheques) + '</td><td class="n">' + eur(d.paid_outs) + '</td><td class="n">' + eur(d.cash) + '</td><td class="n">' + (d.over_under == null ? "Not counted" : eur(d.over_under)) + "</td></tr>"; }).join("") +
      '</tbody><tfoot><tr><td>Total</td><td></td><td class="n">' + tot("takings") + '</td><td class="n">' + tot("epos") + '</td><td class="n">' + tot("cheques") + '</td><td class="n">' + tot("paid_outs") + '</td><td class="n">' + tot("cash") + '</td><td class="n">' + tot("over_under") + "</td></tr></tfoot></table></div>";
  }
  function numBtn(v, rec, bad, label) { if (!Number(v)) return plain(0); return '<button type="button" class="own-num' + (bad && v ? " bad" : "") + '" data-rec="' + rec + '" aria-label="' + esc(label + ": " + num(v) + ", show them") + '">' + esc(num(v)) + "</button>"; }
  function mini(title, rows) { return '<div class="own-card own-mini"><h3>' + esc(title) + "</h3>" + rows.map(function (r) { return '<div class="r"><span>' + esc(r[0]) + "</span>" + r[1] + "</div>"; }).join("") + "</div>"; }
  function plain(v) { return '<span class="own-plain">' + esc(num(v)) + "</span>"; }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== ID) return;
    css();
    var per = period(S.view, S.anchor), d = S.data, h = '<div class="own">';
    if (ui2()) h += '<button class="own-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Money") + "</button>";
    h += '<h1>How we\'re doing</h1><p class="own-sub">Takings, what customers are waiting for and whether the registers are in order. Tap any figure to see the records behind it.</p>';
    h += '<div class="own-bar"><div class="own-seg" role="group" aria-label="Show a week or a month"><button type="button" data-view="week" aria-pressed="' + (S.view === "week") + '">Week</button><button type="button" data-view="month" aria-pressed="' + (S.view === "month") + '">Month</button></div>' +
      '<div class="emb" role="group" aria-label="Days shown"><div class="emb-m"><button type="button" class="emb-arrow" data-move="-1" aria-label="' + (S.view === "week" ? "Week before" : "Month before") + '">‹</button><span class="emb-lab" aria-live="polite">' + esc(per.label) + '</span><button type="button" class="emb-arrow" data-move="1" aria-label="' + (S.view === "week" ? "Next week" : "Next month") + '"' + (per.cur ? " disabled" : "") + ">›</button></div>" +
      (per.cur ? "" : '<button type="button" class="emb-pill emb-now" data-act="now">' + (S.view === "week" ? "This week" : "This month") + "</button>") + "</div>";
    if (d && d.group && (d.pharmacies_allowed || []).length) {
      h += '<label class="own-sr" for="own-loc">Pharmacy</label><select id="own-loc" class="own-sel"><option value="all"' + (S.loc === "all" ? " selected" : "") + ">All " + d.pharmacies_allowed.length + " pharmacies</option>" +
        d.pharmacies_allowed.map(function (x) { return '<option value="' + esc(x.id) + '"' + (String(S.loc) === String(x.id) ? " selected" : "") + ">" + esc(x.name) + "</option>"; }).join("") + "</select>";
    }
    h += "</div>";
    if (S.note) h += '<p class="own-note" role="status">' + esc(S.note) + "</p>";
    if (S.error) h += '<div class="own-quiet" role="alert">' + esc(S.error) + ' <button type="button" class="own-btn" data-act="retry">Try again</button></div>';
    else if (!d || (S.loading && !S.period)) h += E.skeleton ? E.skeleton(5, "Adding up the figures") : '<div class="own-quiet">Adding up the figures…</div>';
    else if (d.group && !d.pharmacies.length) h += '<div class="own-quiet">No pharmacy is in your group yet.</div>';
    else h += body(S.period || per);
    h += "</div>";
    if (E.repaintKeepingFocus) E.repaintKeepingFocus(m, function () { m.innerHTML = h; }); else m.innerHTML = h;
    if (S.loading && S.period) m.querySelector(".own").setAttribute("aria-busy", "true");
  }

  function body(per) {
    var d = S.data, z = shown(), mo = z.money, pv = z.prev || {}, cl = per.cmpLabel, h = "";
    // tiles
    h += '<div class="own-tiles">' +
      tile("eod", "Takings", eur(mo.takings), mo.days_closed ? delta(mo.takings, pv.takings, cl) : "No end of day saved yet") +
      tile("paid_outs", "Paid out", eur(mo.paid_outs), plural(mo.paid_out_lines || 0, "payment", "payments") + " in the paid-out register") +
      tile("eod", "Over / under at closing", eur(mo.over_under), mo.short_days ? "! Short on " + plural(mo.short_days, "day", "days") + (mo.over_days ? ", over on " + mo.over_days : "") : mo.over_days ? "Over on " + plural(mo.over_days, "day", "days") : mo.days_closed ? "Exact every day" : "Nothing counted yet", !!mo.short_days) +
      tile("credit_notes", "Credit notes held", eur(z.credit.open_total), plural(z.credit.open || 0, "note", "notes") + " not used up" + (z.credit.expiring_30 ? "; " + z.credit.expiring_30 + " run out within 30 days" : "")) +
      "</div>";
    if (S.loading) h += '<p class="own-note" role="status">Updating…</p>';
    // by pharmacy (head office, all)
    if (d.pharmacies.length > 1) {
      h += '<div class="own-lab"><h2>By pharmacy</h2></div><div class="own-card own-scroll"><table class="own-tbl own-ph"><thead><tr><th>Pharmacy</th><th class="n">Takings</th><th class="n">On ' + esc(cl) + '</th><th class="n">Paid out</th><th class="n">Over / under</th><th class="n">Needs you</th></tr></thead><tbody>' +
        d.pharmacies.map(function (p) { var n = needs(p, d.today, ""); return '<tr><td><button type="button" data-loc="' + esc(p.id) + '">' + esc(p.name) + '</button></td><td class="n">' + eur(p.money.takings) + '</td><td class="n">' + (p.prev ? eur(p.prev.takings) : "") + '</td><td class="n">' + eur(p.money.paid_outs) + '</td><td class="n">' + eur(p.money.over_under) + '</td><td class="n">' + (n.length ? n.length : "None") + "</td></tr>"; }).join("") +
        "</tbody></table></div>";
    }
    // chart
    h += '<div class="own-lab"><h2>Takings by day</h2><span>' + esc(per.label) + "</span></div>" +
      '<div class="own-card">' + chart(per, z, per) + "<details><summary>Show every day as a table</summary>" + dayTable(z) + "</details></div>";
    // needs you
    var nd = allNeeds();
    h += '<div class="own-lab"><h2>Needs you</h2><span>' + (nd.length ? plural(nd.length, "thing", "things") : "") + '</span></div><div class="own-card">';
    h += nd.length ? nd.map(function (n, i) { return '<button type="button" class="own-need" data-need="' + i + '"><span class="own-pill ' + n.level + '">' + (n.level === "missing" ? "Missing" : "Look at this") + '</span><span class="t">' + esc(n.text) + '</span><span class="go" aria-hidden="true">›</span></button>'; }).join("")
      : '<div class="own-fine"><span class="own-pill ok">In order</span><span>Nothing needs you: every register checked is in order, and nobody is waiting past their day.</span></div>';
    h += "</div>";
    S.needs = nd;
    // customers
    var o = z.orders, qn = z.questions, dv = z.deliveries;
    h += '<div class="own-lab"><h2>Customers</h2><span>' + esc(per.label) + '</span></div><div class="own-grid3">' +
      mini("Orders", [["New", plain(o.new)], ["Handed over", plain(o.done)], ["Waiting now", numBtn(o.open, "orders", false, "Orders waiting")], ["Past the day needed", numBtn(o.overdue, "orders", true, "Orders past the day needed")]]) +
      mini("Questions", [["New", plain(qn.new)], ["Answered", plain(qn.done)], ["Waiting now", numBtn(qn.open, "questions", false, "Questions waiting")], ["Past the call-back day", numBtn(qn.overdue, "questions", true, "Questions past the call-back day")]]) +
      mini("Deliveries", [["New", plain(dv.new)], ["Delivered", plain(dv.done)], ["Waiting now", numBtn(dv.open, "deliveries", false, "Deliveries waiting")], ["Late", numBtn(dv.late, "deliveries", true, "Late deliveries")]]) +
      "</div>" +
      '<div class="own-grid2" style="margin-top:10px">' +
      mini("Repeat prescriptions", [["Run out in the next 2 weeks", numBtn(z.repeats.running_out_14, "repeats", false, "Repeat prescriptions running out")], ["Patients", plain(z.repeats.people_14)]]) +
      mini("Services", [["Bookings", plain(z.services.bookings)], ["Cancelled", plain(z.services.bookings_cancelled)], ["Tests (point of care)", plain(z.services.tests)], ["Test fees", '<span class="own-plain">' + esc(eur(z.services.tests_fees)) + "</span>"]]) +
      "</div>";
    // team
    h += '<div class="own-lab"><h2>Team</h2><span>From the rota and the locum register</span></div><div class="own-card">' + staffTable(z) +
      '<div class="own-row"><div class="t"><b>Locums paid</b><span>' + esc(plural(mo.locum_receipts || 0, "receipt", "receipts") + ", " + num(mo.locum_hours) + " hours") + '</span></div><button type="button" class="own-num" data-rec="locum_receipts" aria-label="Locums paid: ' + esc(eur(mo.locum_cost)) + ', show the receipts">' + esc(eur(mo.locum_cost)) + "</button></div></div>";
    // controlled drugs
    h += '<div class="own-lab"><h2>Controlled drugs</h2><span>Totals for ' + esc(per.label) + '</span></div><div class="own-grid3">' +
      ddaCard("Received", z.dda.received, "dda_received") + ddaCard("Supplied", z.dda.supplied, "dda_supplied") + ddaCard("POYC", z.dda.poyc, "dda_poyc") + "</div>";
    // reports
    h += '<div class="own-lab"><h2>Reports</h2><span>For ' + esc(per.label) + (z.combined ? ", every pharmacy" : "") + '</span></div><div class="own-card">' +
      report("month", "Month end for the accountant", "Takings day by day, paid outs, credit notes issued and used, locum costs.") +
      report("cd", "Controlled drugs totals", "Each medicine received, supplied and given under POYC, with lines to sign, for the inspector.") +
      report("hours", "Staff hours", "Hours on the rota, leave and the pharmacists in charge, for payroll.") +
      "</div>";
    if (d.group) h += '<p class="own-note">Head office sees the figures and the lines behind them, never a patient\'s name, ID card, address or phone.</p>';
    if ((d.unread || []).length) h += '<p class="own-note" role="status">Some figures could not be read this time (' + esc(d.unread.join(", ")) + "). Try again in a moment.</p>";
    return h;
  }
  function staffTable(z) {
    var st = z.staff || [], lc = z.locums || [], ph = !!z.combined;
    var h = "";
    if (!st.length) h += '<p class="own-note" style="margin-top:0">No shifts planned for these days. Plan them in Team › Plan shifts.</p>';
    else h += '<div class="own-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="own-tbl"><thead><tr><th>Name</th>' + (ph ? "<th>Pharmacy</th>" : "") + '<th>Role</th><th class="n">Shifts</th><th class="n">Hours</th><th class="n">Leave</th></tr></thead><tbody>' +
      st.map(function (s) { return "<tr><td>" + esc(s.name) + "</td>" + (ph ? "<td>" + esc(s.pharmacy) + "</td>" : "") + "<td>" + esc(roleName(s.role)) + '</td><td class="n">' + esc(s.shifts) + '</td><td class="n"><button type="button" class="own-num" data-rec="shifts" aria-label="' + esc(s.name + ": " + num(s.hours) + " hours, show the shifts") + '">' + esc(num(s.hours)) + '</button></td><td class="n">' + (s.leave_days ? esc(plural(s.leave_days, "day", "days")) : "") + "</td></tr>"; }).join("") +
      '</tbody><tfoot><tr><td>Total</td>' + (ph ? "<td></td>" : "") + '<td></td><td class="n">' + st.reduce(function (t, s) { return t + s.shifts; }, 0) + '</td><td class="n">' + num(st.reduce(function (t, s) { return t + s.hours; }, 0)) + "</td><td></td></tr></tfoot></table></div>";
    if (lc.length) h += '<div class="own-scroll" tabindex="0" role="region" aria-label="Pharmacists in charge" style="margin-top:10px"><table class="own-tbl"><thead><tr><th>Pharmacist in charge (locum register)</th>' + (ph ? "<th>Pharmacy</th>" : "") + '<th class="n">Days</th><th class="n">Hours</th></tr></thead><tbody>' +
      lc.map(function (s) { return "<tr><td>" + esc(s.name) + "</td>" + (ph ? "<td>" + esc(s.pharmacy) + "</td>" : "") + '<td class="n">' + esc(s.days) + '</td><td class="n"><button type="button" class="own-num" data-rec="locum_register" aria-label="' + esc(s.name + ": " + num(s.hours) + " hours in charge, show the days") + '">' + esc(num(s.hours)) + "</button></td></tr>"; }).join("") + "</tbody></table></div>";
    return h;
  }
  function roleName(r) { var m = { pharmacist: "Pharmacist", assistant: "Pharmacy assistant", technician: "Technician", cashier: "Cashier", locum: "Locum", manager: "Manager", other: "" }; return m[String(r || "").toLowerCase()] != null ? m[String(r || "").toLowerCase()] : String(r || ""); }
  function ddaCard(title, list, rec) {
    var h = '<div class="own-card own-mini"><h3>' + esc(title) + "</h3>";
    if (!list.length) return h + '<p class="own-note" style="margin:0">None in these days.</p></div>';
    h += '<table class="own-tbl"><thead><tr><th>Medicine</th><th class="n">Lines</th><th class="n">Quantity</th></tr></thead><tbody>' +
      list.slice(0, 8).map(function (r) { return "<tr><td>" + esc(r.name) + '</td><td class="n">' + esc(r.lines) + '</td><td class="n">' + esc(num(r.qty)) + "</td></tr>"; }).join("") + "</tbody></table>" +
      (list.length > 8 ? '<p class="own-note">and ' + (list.length - 8) + " more in the printout.</p>" : "");
    return h + '<p style="margin:8px 0 0"><button type="button" class="own-btn" data-rec="' + rec + '">Show the ' + list.reduce(function (t, r) { return t + r.lines; }, 0) + " lines</button></p></div>";
  }
  function report(k, title, desc) {
    var busy = S.busy === k;
    return '<div class="own-row"><div class="t"><b>' + esc(title) + "</b><span>" + esc(desc) + '</span></div><div class="own-acts"><button type="button" class="own-btn" data-rep="' + k + '" data-how="print"' + (S.busy ? " disabled" : "") + ">" + (busy && S.busyHow === "print" ? "Preparing…" : "Print") + '</button><button type="button" class="own-btn" data-rep="' + k + '" data-how="sheet"' + (S.busy ? " disabled" : "") + ">" + (busy && S.busyHow === "sheet" ? "Preparing…" : "Spreadsheet") + "</button></div></div>";
  }

  // ── the records behind a figure
  var REC = {
    eod: { title: "End of day", reg: "eodreg", cols: [["Day", function (r) { return dayText(r.date, true); }], ["Closed by", "staff"], ["Takings", "takings", "m"], ["EPOS", "epos", "m"], ["Cheques", "cheques", "m"], ["Paid out (till)", "paid_outs", "m"], ["Cash", "cash", "m"], ["Over / under", function (r) { return r.over_under == null ? "Not counted" : eur(r.over_under); }, "r"], ["Locked", function (r) { return r.locked ? "Yes" : "No"; }]] },
    paid_outs: { title: "Paid out", reg: "poreg", cols: [["Day", function (r) { return dayText(r.entry_date, true); }], ["Time", "entry_time"], ["Paid to", "payee_name"], ["How", function (r) { return r.payment_method === "cheque" ? "Cheque " + (r.cheque_no || "") : "Cash"; }], ["Invoice", "invoice_no"], ["What for", "reason"], ["Amount", "fee", "m"]] },
    credit_notes: { title: "Credit notes held", reg: "cnreg", filter: function (r, t) { var left = Number(r.amount) - Number(r.used); return left > 0.005 && (Number(r.no_expiry) === 1 || !r.expiry_date || r.expiry_date >= t); },
      cols: [["Issued", function (r) { return dmy(r.issue_date); }], ["Customer", function (r) { return [r.client_name, r.client_surname].filter(Boolean).join(" "); }], ["Receipt", "receipt_number"], ["Amount", "amount", "m"], ["Used", "used", "m"], ["Left", function (r) { return eur(Number(r.amount) - Number(r.used)); }, "r", function (r) { return Number(r.amount) - Number(r.used); }], ["Runs out", function (r) { return Number(r.no_expiry) === 1 || !r.expiry_date ? "No end date" : dmy(r.expiry_date); }]] },
    locum_receipts: { title: "Locum receipts", reg: "lrcreg", cols: [["Day", function (r) { return dayText(r.receipt_date, true); }], ["Locum", "locum_full_name"], ["Reg no.", "registration_number"], ["Hours", "hours", "n"], ["Rate", "fee_per_hour", "m"], ["Total", "total_fee", "m"]] },
    orders: { title: "Orders waiting", reg: "ordreg", cols: [["Ordered", function (r) { return dmy(r.order_date); }], ["Customer", "client_name"], ["What", "items_text"], ["Needed by", function (r) { return r.needed_by ? dmy(r.needed_by) : ""; }]] },
    questions: { title: "Questions waiting", reg: "tktreg", cols: [["Opened", function (r) { return dmy(r.open_date); }], ["Number", "ticket_id"], ["Customer", "client_name"], ["About", "issue"], ["Call back", function (r) { return r.followup_date ? dmy(r.followup_date) : ""; }]] },
    deliveries: { title: "Deliveries waiting", reg: "dlvreg", cols: [["Ordered", function (r) { return dmy(r.order_date); }], ["Number", "delivery_id"], ["Customer", "client_name"], ["Planned for", function (r) { return r.scheduled_date ? dmy(r.scheduled_date) : ""; }], ["Status", "status"]] },
    repeats: { title: "Repeat prescriptions running out", reg: "repreg", cols: [["Runs out", function (r) { return dmy(r.expires_date); }], ["Patient", "client_name"], ["ID card", "client_id"], ["Medicine", "medicine_name_dose"]] },
    dda_supplied: { title: "Controlled drugs supplied", reg: "cdsreg", cols: [["Day", function (r) { return dmy(r.entry_date); }], ["Patient", "client_name"], ["ID card", "client_id_card"], ["Medicine", "medicine_name_dose"], ["Qty", "quantity", "n"], ["Doctor", "doctor_name"], ["Prescription serial no.", "prescription_serial_no"]] },
    dda_poyc: { title: "POYC controlled drugs", reg: "poyreg", cols: [["Day", function (r) { return dmy(r.entry_date); }], ["Patient", "client_name"], ["ID card", "client_id_card"], ["Medicine", "medicine_name_dose"], ["Qty", "quantity", "n"], ["Doctor", "doctor_name"], ["Prescription serial no.", "prescription_serial_no"]] },
    dda_received: { title: "Controlled drugs received", reg: "cdpreg", cols: [["Day", function (r) { return dmy(r.entry_date); }], ["Medicine", "dda_name_dose"], ["Qty", "quantity", "n"], ["Agent", "agent"], ["Invoice", "invoice_number"]] },
    shifts: { title: "Shifts on the rota", reg: "shfreg", cols: [["Day", function (r) { return dayText(r.shift_date, true); }], ["Name", "full_name"], ["From", "start_time"], ["To", "end_time"], ["Hours", "hours", "n"]] },
    locum_register: { title: "Pharmacists in charge", reg: "locreg", cols: [["Day", function (r) { return dayText(r.entry_date, true); }], ["Pharmacist", "locum_full_name"], ["Reg no.", "registration_number"], ["In", "time_in"], ["Out", "time_out"], ["Hours", "hours", "n"]] }
  };
  E.owner.REC = REC;
  function cellOf(c, r) { var v = typeof c[1] === "function" ? c[1](r) : r[c[1]]; if (c[2] === "m" && typeof c[1] !== "function") return eur(v); if (c[2] === "n") return num(v); return v == null ? "" : String(v); }
  function rawOf(c, r) { if (c[3]) return c[3](r); var v = typeof c[1] === "function" ? c[1](r) : r[c[1]]; if ((c[2] === "m" || c[2] === "n") && typeof c[1] !== "function") return Number(v) || 0; return v == null ? "" : String(v); }
  function rowsFor(kind, res, t) { var K = REC[kind], rows = (res.records && res.records[kind]) || []; return K.filter ? rows.filter(function (r) { return K.filter(r, t); }) : rows; }

  async function openRecords(kind, opener) {
    var K = REC[kind]; if (!K) return;
    var per = S.period || period(S.view, S.anchor), many = S.data && S.data.pharmacies.length > 1;
    var dlg = { kind: kind, opener: opener, loading: true, rows: [], error: "" }; S.dlg = dlg; drawDlg();
    try {
      if (kind === "eod") { dlg.rows = []; S.data.pharmacies.forEach(function (p) { (p.days || []).forEach(function (d) { dlg.rows.push(Object.assign({ pharmacy: p.name }, d)); }); }); dlg.rows.sort(function (a, b) { return a.date < b.date ? 1 : -1; }); }
      else { var r = await records([kind], per); if (S.dlg !== dlg) return; if ((r.unread || []).length) throw new Error("Could not read these records. Try again."); dlg.rows = rowsFor(kind, r, S.data.today); dlg.capped = r.capped && r.capped[kind]; dlg.patient = r.patient_details; }
    } catch (e) { dlg.error = errText(e); }
    dlg.loading = false; dlg.many = many; if (S.dlg === dlg) drawDlg();
  }
  function drawDlg() {
    var old = document.getElementById("own-dlg"), dlg = S.dlg;
    if (!dlg) { if (old) old.remove(); return; }
    var K = REC[dlg.kind], per = S.period || period(S.view, S.anchor), cols = (dlg.many ? [["Pharmacy", "pharmacy"]] : []).concat(K.cols);
    var own = S.data && !S.data.group, h = '<div class="own-dlg" role="dialog" aria-modal="true" aria-labelledby="own-dlg-h"><header><div><h2 id="own-dlg-h">' + esc(K.title) + "</h2><span>" +
      esc((/waiting|held|running out/i.test(K.title) ? "As of today" : per.label) + (dlg.loading ? "" : " · " + plural(dlg.rows.length, "line", "lines"))) + '</span></div><div class="own-acts">' +
      (own && K.reg && E.modules && E.modules[K.reg] ? '<button type="button" class="own-btn" data-dact="open">Open ' + esc(E.modules[K.reg].title) + "</button>" : "") + '<button type="button" class="own-btn" data-dact="close">Close</button></div></header>';
    if (dlg.loading) h += E.skeleton ? E.skeleton(4, "Opening the records") : "<p>Opening…</p>";
    else if (dlg.error) h += '<p role="alert">' + esc(dlg.error) + "</p>";
    else if (!dlg.rows.length) h += '<p class="own-note">Nothing here for these days.</p>';
    else {
      var sums = cols.map(function (c) { return c[2] === "m" || c[2] === "r" || (c[2] === "n" && c[0] !== "Rate"); });
      h += '<div class="own-scroll" tabindex="0" role="region" aria-label="Table, scrolls sideways"><table class="own-tbl"><thead><tr>' + cols.map(function (c) { return "<th" + (c[2] ? ' class="n"' : "") + ">" + esc(c[0]) + "</th>"; }).join("") + "</tr></thead><tbody>" +
        dlg.rows.slice(0, 500).map(function (r) { return "<tr>" + cols.map(function (c) { return "<td" + (c[2] ? ' class="n"' : "") + ">" + esc(cellOf(c, r)) + "</td>"; }).join("") + "</tr>"; }).join("") + "</tbody>" +
        (sums.some(Boolean) ? "<tfoot><tr>" + cols.map(function (c, i) { if (!i) return "<td>Total</td>"; if (!sums[i]) return "<td></td>"; var t = dlg.rows.reduce(function (a, r) { var v = rawOf(c, r); return a + (typeof v === "number" ? v : Number(String(v).replace(/[^0-9.\-]/g, "").replace(/^−/, "-")) || 0); }, 0); return '<td class="n">' + esc(c[2] === "n" ? num(t) : eur(t)) + "</td>"; }).join("") + "</tr></tfoot>" : "") + "</table></div>";
      if (dlg.rows.length > 500) h += '<p class="own-note">The first 500 are shown; the spreadsheet has them all.</p>';
      if (dlg.patient === false) h += '<p class="own-note">Patients\' details are left out for head office.</p>';
    }
    h += "</div>";
    var bg = old || document.createElement("div");
    bg.id = "own-dlg"; bg.className = "own-dlg-bg"; bg.innerHTML = h;
    if (!old) {
      document.body.appendChild(bg);
      bg.addEventListener("click", function (e) { if (e.target === bg) closeDlg(); var b = e.target.closest && e.target.closest("[data-dact]"); if (!b) return; if (b.dataset.dact === "close") closeDlg(); if (b.dataset.dact === "open") openReg(REC[S.dlg.kind].reg); });
      bg.addEventListener("keydown", function (e) { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); closeDlg(); } else if (e.key === "Tab") trap(e, bg); });
    }
    var f = bg.querySelector("[data-dact=close]"); if (f && (!old || !bg.contains(document.activeElement))) f.focus();
  }
  function trap(e, bg) { var f = [].slice.call(bg.querySelectorAll("button,summary,[tabindex]")); if (!f.length) return; var a = f[0], z = f[f.length - 1]; if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus(); } else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus(); } }
  function closeDlg() { var d = S.dlg; S.dlg = null; drawDlg(); if (d && d.opener && document.contains(d.opener)) d.opener.focus(); else { var x = S.mount && S.mount.querySelector("[data-rec]"); if (x) x.focus(); } }
  function openReg(mod, ym) {
    var per = S.period || period(S.view, S.anchor);
    if (S.dlg) { S.dlg = null; drawDlg(); }
    if (E.months && E.months.openAt) E.months.openAt(mod, ym || per.from.slice(0, 7));
    window.location.hash = "#" + mod;
  }

  // ── reports: printed (eikon.months.js printout) and as spreadsheets
  function forEachPharmacy() { return S.data.pharmacies; }
  async function makeReport(k, how) {
    if (S.busy) return;
    S.busy = k; S.busyHow = how; S.note = ""; paint();
    try {
      var per = S.period || period(S.view, S.anchor), out = await (k === "month" ? monthEnd(per) : k === "cd" ? cdTotals(per) : staffHours(per));
      if (how === "print") E.months.print(out.print); else await sheet(out.file, out.sheets);
      S.note = how === "print" ? out.print.register + " opened in a new tab to print." : "The spreadsheet " + out.file + " is in your downloads.";
    } catch (e) { S.note = errText(e); }
    S.busy = ""; paint();
  }
  function pharmName() { var d = S.data; return d.pharmacies.length === 1 ? d.pharmacies[0].name : (user().org_name || "All pharmacies"); }
  function fileName(what, per) { return ("Eikon " + what + " " + pharmName() + " " + per.from + " to " + per.to).replace(/[^A-Za-z0-9À-ſ]+/g, "-").replace(/^-|-$/g, "") + ".xlsx"; }
  function table(cols, rows) { return { cols: cols.map(function (c) { return c[2] ? { h: c[0], num: true } : c[0]; }), rows: rows.map(function (r) { return cols.map(function (c) { return cellOf(c, r); }); }) }; }
  function aoa(cols, rows, ph) { return [(ph ? ["Pharmacy"] : []).concat(cols.map(function (c) { return c[0]; }))].concat(rows.map(function (r) { return (ph ? [r.pharmacy] : []).concat(cols.map(function (c) { return rawOf(c, r); })); })); }

  async function monthEnd(per) {
    var r = await records(["paid_outs", "credit_notes", "credit_note_uses", "locum_receipts"], per), list = forEachPharmacy(), many = list.length > 1;
    if ((r.unread || []).length) throw new Error("Some records could not be read. Try again.");
    var t = S.data.today, sections = [], sheets = [], sumRows = [["Pharmacy", "Takings (X readings)", "EPOS", "Cheques", "Cash taken", "Paid out from the till", "Paid-out register", "Over / under", "Credit notes issued", "Credit notes used", "Credit notes held today", "Locum receipts", "Locum hours", "Locum costs"]];
    list.forEach(function (p, i) {
      var mine = function (kind) { return ((r.records || {})[kind] || []).filter(function (x) { return String(x.location_id) === String(p.id); }); };
      var po = mine("paid_outs"), cn = mine("credit_notes"), issued = cn.filter(function (c) { return c.issue_date >= per.from && c.issue_date <= per.to; }), uses = mine("credit_note_uses"), lr = mine("locum_receipts"), m = p.money;
      var head = many ? p.name + " · " : "";
      var sum = [["Takings (X readings)", eur(m.takings)], ["EPOS", eur(m.epos)], ["Cheques", eur(m.cheques)], ["Cash taken", eur(m.cash)], ["Paid out from the till (end of day)", eur(m.till_paid_outs)], ["Paid-out register", eur(m.paid_outs) + " (" + plural(m.paid_out_lines, "payment", "payments") + ")"],
        ["Over / under at closing", eur(m.over_under)], ["Days closed", String(m.days_closed)], ["Credit notes issued", plural(p.credit.issued, "note", "notes") + ", " + eur(p.credit.issued_total)], ["Credit notes used", eur(p.credit.used_total)], ["Credit notes held today", eur(p.credit.open_total)], ["Locum costs", eur(m.locum_cost) + " (" + num(m.locum_hours) + " hours)"]];
      sections.push({ heading: head + "Summary", cols: ["", { h: "Amount", num: true }], rows: sum, pageBreak: i > 0 });
      var eodCols = REC.eod.cols;
      sections.push(Object.assign({ heading: head + "End of day, day by day", empty: "No end of day saved." }, table(eodCols, p.days), { foot: ["Total", "", eur(m.takings), eur(m.epos), eur(m.cheques), eur(m.till_paid_outs), eur(m.cash), eur(m.over_under), ""] }));
      sections.push(Object.assign({ heading: head + "Paid outs", empty: "No payments." }, table(REC.paid_outs.cols, po), { foot: ["Total", "", "", "", "", "", eur(m.paid_outs)] }));
      var cnCols = [["Issued", function (x) { return dmy(x.issue_date); }], ["Customer", function (x) { return [x.client_name, x.client_surname].filter(Boolean).join(" "); }], ["Receipt", "receipt_number"], ["Amount", "amount", "m"]];
      sections.push(Object.assign({ heading: head + "Credit notes issued", empty: "None issued." }, table(cnCols, issued), { foot: ["Total", "", "", eur(p.credit.issued_total)] }));
      var useCols = [["Used on", function (x) { return dmy(String(x.timestamp || "").slice(0, 10)); }], ["Credit note receipt", "note_receipt"], ["Sale receipt", "receipt_number"], ["Amount", "amount", "m"]];
      sections.push(Object.assign({ heading: head + "Credit notes used", empty: "None used." }, table(useCols, uses), { foot: ["Total", "", "", eur(p.credit.used_total)] }));
      sections.push(Object.assign({ heading: head + "Locum receipts", empty: "No locum receipts." }, table(REC.locum_receipts.cols, lr), { foot: ["Total", "", "", num(m.locum_hours), "", eur(m.locum_cost)] }));
      sumRows.push([p.name, m.takings, m.epos, m.cheques, m.cash, m.till_paid_outs, m.paid_outs, m.over_under, p.credit.issued_total, p.credit.used_total, p.credit.open_total, m.locum_receipts, m.locum_hours, m.locum_cost]);
      var tag = function (rows) { return rows.map(function (x) { return Object.assign({ pharmacy: p.name }, x); }); };
      p._me = { eod: tag(p.days), po: tag(po), issued: tag(issued), uses: tag(uses), lr: tag(lr) };
    });
    var all = function (k) { return [].concat.apply([], list.map(function (p) { return p._me[k]; })); };
    sheets.push({ name: "Summary", rows: [["Month end for the accountant"], ["Days", per.label + " (" + dmy(per.from) + " to " + dmy(per.to) + ")"], ["Printed", stamp()], []].concat(sumRows) });
    sheets.push({ name: "End of day", rows: aoa(REC.eod.cols, all("eod"), many) });
    sheets.push({ name: "Paid outs", rows: aoa(REC.paid_outs.cols, all("po"), many) });
    sheets.push({ name: "Credit notes issued", rows: aoa([["Issued", "issue_date"], ["Customer", function (x) { return [x.client_name, x.client_surname].filter(Boolean).join(" "); }], ["Receipt", "receipt_number"], ["Amount", "amount", "m"]], all("issued"), many) });
    sheets.push({ name: "Credit notes used", rows: aoa([["Used on", function (x) { return String(x.timestamp || "").slice(0, 10); }], ["Credit note receipt", "note_receipt"], ["Sale receipt", "receipt_number"], ["Amount", "amount", "m"]], all("uses"), many) });
    sheets.push({ name: "Locum receipts", rows: aoa(REC.locum_receipts.cols, all("lr"), many) });
    return { print: { register: "Month end for the accountant", period: per.label + " (" + dmy(per.from) + " to " + dmy(per.to) + ")", pharmacy: pharmName(), sections: sections, landscape: true, sign: ["Prepared by", "Checked by the pharmacist in charge", "Date"] },
      file: fileName("month end", per), sheets: sheets };
  }
  async function cdTotals(per) {
    var list = forEachPharmacy(), many = list.length > 1, sections = [], sheets = [], kinds = [["received", "DDA Purchases — controlled drugs received", "dda_received"], ["supplied", "DDA Sales — controlled drugs supplied", "dda_supplied"], ["poyc", "DDA POYC — controlled drugs given under POYC", "dda_poyc"]];
    var totCols = [["Medicine name & dose", "name"], ["Lines", "lines", "n"], ["Total quantity", "qty", "n"]];
    list.forEach(function (p, i) {
      kinds.forEach(function (k, j) {
        var rows = p.dda[k[0]] || [];
        sections.push(Object.assign({ heading: (many ? p.name + " · " : "") + k[1], empty: "None in " + per.label + ".", pageBreak: i > 0 && j === 0 }, table(totCols, rows),
          { foot: ["Total", String(rows.reduce(function (t, r) { return t + r.lines; }, 0)), num(rows.reduce(function (t, r) { return t + r.qty; }, 0))] }));
      });
    });
    kinds.forEach(function (k) { sheets.push({ name: k[0] === "received" ? "Received" : k[0] === "supplied" ? "Supplied" : "POYC", rows: aoa(totCols, [].concat.apply([], list.map(function (p) { return (p.dda[k[0]] || []).map(function (r) { return Object.assign({ pharmacy: p.name }, r); }); })), many) }); });
    var r = await records(["dda_received", "dda_supplied", "dda_poyc"], per);
    if ((r.unread || []).length) throw new Error("Some records could not be read. Try again.");
    kinds.forEach(function (k) { sheets.push({ name: (k[0] === "received" ? "Received" : k[0] === "supplied" ? "Supplied" : "POYC") + " lines", rows: aoa(REC[k[2]].cols, r.records[k[2]] || [], many) }); });
    return { print: { register: "Controlled drugs totals", period: per.label + " (" + dmy(per.from) + " to " + dmy(per.to) + ")", pharmacy: pharmName(), sections: sections,
      intro: '<p class="sub">Totals from the registers kept in Eikon for these days. The registers themselves, line by line, print from each register screen.</p>', sign: ["Pharmacist in charge", "Signature", "Date"] },
      file: fileName("controlled drugs", per), sheets: sheets };
  }
  async function staffHours(per) {
    var list = forEachPharmacy(), many = list.length > 1, sections = [];
    var sCols = [["Name", "name"], ["Role", function (s) { return roleName(s.role); }], ["Shifts", "shifts", "n"], ["Hours on the rota", "hours", "n"], ["Contracted hours a week", "contracted_week", "n"], ["Approved leave, days", "leave_days", "n"], ["Approved leave, hours", "leave_hours", "n"]];
    var lCols = [["Pharmacist in charge", "name"], ["Days", "days", "n"], ["Hours", "hours", "n"]];
    list.forEach(function (p, i) {
      sections.push(Object.assign({ heading: (many ? p.name + " · " : "") + "Hours on the rota", empty: "No shifts planned for these days.", pageBreak: i > 0 }, table(sCols, p.staff || []),
        { foot: ["Total", "", String((p.staff || []).reduce(function (t, s) { return t + s.shifts; }, 0)), num((p.staff || []).reduce(function (t, s) { return t + s.hours; }, 0)), "", "", ""] }));
      sections.push(Object.assign({ heading: (many ? p.name + " · " : "") + "Pharmacists in charge (locum register)", empty: "Nobody signed in the locum register." }, table(lCols, p.locums || [])));
    });
    var r = await records(["shifts", "locum_register"], per);
    if ((r.unread || []).length) throw new Error("Some records could not be read. Try again.");
    var tag = function (k) { return [].concat.apply([], list.map(function (p) { return (p[k] || []).map(function (s) { return Object.assign({ pharmacy: p.name }, s); }); })); };
    return { print: { register: "Staff hours", period: per.label + " (" + dmy(per.from) + " to " + dmy(per.to) + ")", pharmacy: pharmName(), sections: sections, sign: ["Checked by", "Date"] },
      file: fileName("staff hours", per), sheets: [{ name: "Hours", rows: aoa(sCols, tag("staff"), many) }, { name: "Pharmacists in charge", rows: aoa(lCols, tag("locums"), many) },
        { name: "Shifts", rows: aoa(REC.shifts.cols.map(function (c) { return c[0] === "Day" ? ["Day", "shift_date"] : c; }), r.records.shifts || [], many) }, { name: "Locum register", rows: aoa(REC.locum_register.cols.map(function (c) { return c[0] === "Day" ? ["Day", "entry_date"] : c; }), r.records.locum_register || [], many) }] };
  }
  function stamp() { var t = new Date(); return dmy(E.maltaYmd ? E.maltaYmd(t) : t.toISOString().slice(0, 10)) + " " + (E.maltaHm ? E.maltaHm(t) : "") + " (Malta time)"; }
  async function sheet(name, sheets) {
    var X = await E.loadVendor("xlsx"), wb = X.utils.book_new(), used = {};
    sheets.forEach(function (s) {
      var ws = X.utils.aoa_to_sheet(s.rows), n = String(s.name).slice(0, 31), k = n, i = 2; while (used[k]) k = n.slice(0, 28) + " " + i++; used[k] = 1;
      ws["!cols"] = (s.rows[0] || []).map(function (h, ci) { var w = String(h || "").length; s.rows.slice(0, 200).forEach(function (r) { w = Math.max(w, Math.min(50, String(r[ci] == null ? "" : r[ci]).length)); }); return { wch: w + 2 }; });
      X.utils.book_append_sheet(wb, ws, k);
    });
    var buf = X.write(wb, { bookType: "xlsx", type: "array", compression: true }), blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    E.owner.lastSheet = { name: name, sheets: sheets, size: blob.size };
    var url = URL.createObjectURL(blob), a = document.createElement("a"); a.href = url; a.download = name; a.style.display = "none"; document.body.appendChild(a);
    try { a.click(); } catch (e) {} a.remove(); setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }
  E.owner.report = function (k) { var per = S.period || period(S.view, S.anchor); return k === "month" ? monthEnd(per) : k === "cd" ? cdTotals(per) : staffHours(per); };

  // ── wiring (one listener on the screen, kept across repaints)
  function wire(m) {
    if (m.__ownWired) return; m.__ownWired = true;
    m.addEventListener("click", function (e) {
      var b = e.target.closest && e.target.closest("button"); if (!b || !m.contains(b)) return;
      if (b.dataset.act === "back") { window.location.hash = E.ui2BackHash ? E.ui2BackHash(ID) : "#money"; return; }
      if (b.dataset.act === "retry") return load();
      if (b.dataset.act === "now") { S.anchor = today(); return load(); }
      if (b.dataset.view) { if (S.view !== b.dataset.view) { S.view = b.dataset.view; S.anchor = S.period && !S.period.cur ? S.period.from : today(); if (S.anchor > today()) S.anchor = today(); remember(); load(); } return; }
      if (b.dataset.move) return move(Number(b.dataset.move));
      if (b.dataset.loc) { S.loc = b.dataset.loc; remember(); return load(); }
      if (b.dataset.rep) return makeReport(b.dataset.rep, b.dataset.how);
      if (b.dataset.rec) return openRecords(b.dataset.rec, b);
      if (b.dataset.need != null) { var n = (S.needs || [])[Number(b.dataset.need)]; if (!n || !n.go) return; if (n.go.rec) return openRecords(n.go.rec, b);
        if (S.data.group) { S.note = "Each pharmacy fixes this in its own " + ((E.modules[n.go.mod] || {}).title || "register") + " screen."; return paint(); }
        return openReg(n.go.mod, n.go.ym); }
    });
    m.addEventListener("change", function (e) { if (e.target && e.target.id === "own-loc") { S.loc = e.target.value; remember(); load(); } });
    m.addEventListener("mousemove", function (e) {
      var r = e.target.closest && e.target.closest(".hit"), tip = m.querySelector(".own-tip"); if (!tip) return;
      if (!r || !S.chart) { tip.hidden = true; return; }
      var d = S.chart.days[Number(r.dataset.i)], x = S.chart.by[d], box = r.closest("svg").getBoundingClientRect(), rb = r.getBoundingClientRect();
      tip.textContent = dayText(d, true) + " · " + (x ? eur(x.takings) + (x.over_under != null && Math.abs(x.over_under) > 0.004 ? " · " + (x.over_under < 0 ? "short " + eur(-x.over_under) : "over " + eur(x.over_under)) : "") : "not closed");
      tip.style.left = Math.max(60, Math.min(box.width - 60, rb.left - box.left + rb.width / 2)) + "px"; tip.hidden = false;
    });
    m.addEventListener("mouseleave", function () { var tip = m.querySelector(".own-tip"); if (tip) tip.hidden = true; });
  }

  function render(ctx) {
    S.mount = ctx.mount; S.mount.__ownWired = false; S.dlg = null; drawDlg();
    if (!S.anchor) { recall(); S.anchor = today(); }
    var u = user();
    if (u.role && u.role !== "admin") {
      css(); S.mount.innerHTML = '<div class="own">' + (ui2() ? '<button class="own-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Money") + "</button>" : "") + '<h1>How we\'re doing</h1><div class="own-quiet">Only the pharmacist in charge can see how the pharmacy is doing.</div></div>';
      wire(S.mount); return;
    }
    wire(S.mount);
    S.note = ""; S.data = S.data && S.data.today === today() ? S.data : null; S.period = S.data ? S.period : null;
    return load();
  }
  function destroy() { S.seq++; if (S.dlg) { S.dlg = null; drawDlg(); } }

  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  E.registerModule({ id: ID, title: "How we're doing", order: 3, icon: "◔", ui2Only: true, adminOnly: true, render: render, destroy: destroy });
})();
