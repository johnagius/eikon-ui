/* Roster planner — rules and settings (eikon.rotaset.js). Everything the classic Shifts screen's Settings, Leave and
   Employee tabs did, as pieces the planner shows in its person panel and ⋯ menu, so nothing needs the classic screen:
     E.rotaSet.ui.hours(mount)            opening hours: every week, copy Monday, days that are different (open / closed /
                                          duty Sunday), public holidays coming up with "Open this day"
     E.rotaSet.ui.day(mount, ymd)         one day from the grid: "Open this day…" / "Close this day…" / back to usual
     E.rotaSet.ui.rules(mount)            pharmacist cover, minimum people, which warnings show, the Malta reference
     E.rotaSet.ui.avail(mount, person)    "When can't they work?" (weekdays and particular days)
     E.rotaSet.ui.leave(mount, person|null) balances (only annual leave counts against annual, John 6a) and history;
                                          null = the whole pharmacy
     E.rotaSet.ui.person(mount, person)   edit details, deactivate / activate, delete (names what goes; offers deactivate)
   E.rotaSet.open(kind, arg, ctx) shows any of them as a sheet (Escape closes, focus returns, what was typed is kept).
   ctx (optional): { staff, leaves (already loaded: no extra read), onSaved(kind, value), open(kind, arg) }.
   Every save is the classic screen's body: opening hours and settings are read fresh and PUT whole (E.rotaHoursPut,
   E.rotaMeta in core.js), a person is the classic Edit Employee body built from a fresh read, delete is the classic
   DELETE. After a save, document gets an "eikon:rota-changed" event { detail: { kind } } so the planner re-reads. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var DAYN = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"], ORDER = [1, 2, 3, 4, 5, 6, 0];
  var DAYS = ["Sundays", "Mondays", "Tuesdays", "Wednesdays", "Thursdays", "Fridays", "Saturdays"];
  var DESIG = { pharmacist: "Pharmacist", locum: "Locum pharmacist", assistant: "Pharmacy assistant", dispenser: "Dispenser", cashier: "Cashier", manager: "Manager", cleaner: "Cleaner", other: "Other" };
  var LTYPES = [["annual", "Annual leave"], ["sick", "Sick leave"], ["urgent_family", "Urgent family leave"], ["maternity", "Maternity leave"], ["paternity", "Paternity leave"], ["parental", "Parental leave"], ["miscarriage", "Miscarriage leave"], ["other", "Other leave"]];
  var LT = {}; LTYPES.forEach(function (x) { LT[x[0]] = x[1]; });

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function hm(t) { return String(t || "").slice(0, 5); }
  function mn(t) { var p = hm(t).split(":"); return Number(p[0]) * 60 + Number(p[1] || 0); }
  function today() { return E.maltaYmd ? E.maltaYmd() : new Date().toISOString().slice(0, 10); }
  function addD(ymd, n) { var d = new Date(ymd + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function wd(ymd) { return new Date(ymd + "T12:00:00Z").getUTCDay(); }
  function dayW(ymd, yr) { var s = E.rotaCheck && E.rotaCheck.dayWords ? E.rotaCheck.dayWords(ymd) : ymd; return yr && ymd.slice(0, 4) !== today().slice(0, 4) ? s + " " + ymd.slice(0, 4) : s; }
  function hrs(h) { h = Math.round(Number(h || 0) * 10) / 10; return (Number.isInteger(h) ? String(h) : h.toFixed(1)) + " h"; }
  function first(n) { var w = String(n || "").trim().split(/\s+/); while (w.length > 1 && /^(dr|pharm|mr|mrs|ms|miss|fr|prof|sr)\.?$/i.test(w[0])) w.shift(); return w[0] || "They"; }
  function leaveName(t) { return LT[low(t)] || (low(t) ? low(t).charAt(0).toUpperCase() + low(t).slice(1).replace(/_/g, " ") + (/leave/.test(low(t)) ? "" : " leave") : "Leave"); }
  function changed(kind, value) {
    try { document.dispatchEvent(new CustomEvent("eikon:rota-changed", { detail: { kind: kind } })); } catch (e) {}
    return value;
  }
  function failText(x) { return E.saveFailText ? E.saveFailText(x) : "Not saved: " + String((x && x.message) || x); }

  // ---- Malta employment law reference: the classic screen's defaults and settings.maltaLaw overlay -------------------
  var MALTA_DEFAULT = {
    annualLeaveHours: { 2023: 208, 2024: 240, 2025: 224, 2026: 216, 2027: 216 },
    sickLeavePaidHours: 80, sickLeaveHalfPayHours: 80, urgentFamilyLeaveHours: 32, maxWeeklyHours: 48, fullTimeWeeklyHours: 40,
    yearData: { 2025: { publicHolidays: 14, colaWeekly: 0, minWageWeekly: 0, miscarriageLeaveDays: 0 }, 2026: { publicHolidays: 14, colaWeekly: 4.66, minWageWeekly: 226.44, miscarriageLeaveDays: 7 } }
  };
  function lastKnownYear(map, yr) {
    var keys = Object.keys(map || {}).map(function (k) { return parseInt(k, 10); }).filter(function (n) { return !isNaN(n); }).sort(function (a, b) { return a - b; });
    if (!keys.length) return yr; var best = keys[0]; keys.forEach(function (k) { if (k <= yr) best = k; }); return best;
  }
  function malta(settings) {
    var M = JSON.parse(JSON.stringify(MALTA_DEFAULT)), cfg = settings && settings.maltaLaw;
    if (!cfg || typeof cfg !== "object") return M;
    if (cfg.annualLeaveHours && typeof cfg.annualLeaveHours === "object") Object.keys(cfg.annualLeaveHours).forEach(function (y) { M.annualLeaveHours[y] = cfg.annualLeaveHours[y]; });
    ["sickLeavePaidHours", "sickLeaveHalfPayHours", "urgentFamilyLeaveHours", "maxWeeklyHours", "fullTimeWeeklyHours"].forEach(function (k) { if (cfg[k] != null && cfg[k] !== "") M[k] = cfg[k]; });
    if (cfg.yearData && typeof cfg.yearData === "object") Object.keys(cfg.yearData).forEach(function (y) { M.yearData[y] = Object.assign({}, M.yearData[y] || {}, cfg.yearData[y] || {}); });
    return M;
  }
  function maltaYear(M, yr) { var yd = M.yearData || {}; return yd[String(yr)] || yd[String(lastKnownYear(yd, yr))] || {}; }
  function annualFT(M, yr) { return M.annualLeaveHours[yr] || M.annualLeaveHours[lastKnownYear(M.annualLeaveHours, yr)] || 216; }
  // The classic calcEntitlement: full-time hours pro rata by contracted hours (never above full time); locums none.
  function entitlement(p, settings, yr) {
    if (low(p && p.designation) === "locum") return { annual: 0, sick: 0, urgentFamily: 0, na: true };
    var M = malta(settings); yr = yr || Number(today().slice(0, 4));
    var ft = parseFloat(M.fullTimeWeeklyHours) || 40, ch = parseFloat(p && p.contracted_hours); if (!isFinite(ch) || ch <= 0) ch = ft;
    var r = Math.min(ch / ft, 1);
    return { annual: Math.round(annualFT(M, yr) * r), sick: Math.round((parseFloat(M.sickLeavePaidHours) || 80) * r), urgentFamily: Math.round((parseFloat(M.urgentFamilyLeaveHours) || 32) * r) };
  }
  // A person's leave this year (requests counted by the year they start in, approved and asked-for alike, as classic).
  // Only annual leave counts against annual leave (John 6a); sick and urgent family against their own; the others are
  // listed with their hours. classic = the classic screen's figure (every type but sick counted as annual).
  function balance(p, leaves, settings, yr) {
    yr = yr || Number(today().slice(0, 4));
    var ent = entitlement(p, settings, yr), b = { year: yr, na: !!ent.na, ent: ent, annual: { approved: 0, pending: 0 }, sick: { approved: 0, pending: 0 }, uf: { approved: 0, pending: 0 }, others: {}, classic: { annualUsed: 0, sickUsed: 0 } };
    (leaves || []).forEach(function (l) {
      var st = low(l.status); if (String(l.staff_id) !== String(p && p.id) || (st !== "approved" && st !== "pending")) return;
      if (parseInt(String(l.start_date || "").split("-")[0], 10) !== yr) return;
      var h = +l.hours_requested || 0, t = low(l.leave_type), k = st === "approved" ? "approved" : "pending";
      if (t === "sick") b.classic.sickUsed += h; else b.classic.annualUsed += h;
      if (t === "annual") b.annual[k] += h; else if (t === "sick") b.sick[k] += h; else if (t === "urgent_family") b.uf[k] += h;
      else { var o = b.others[t] = b.others[t] || { type: t, label: leaveName(t), approved: 0, pending: 0 }; o[k] += h; }
    });
    [["annual", "annual"], ["sick", "sick"], ["uf", "urgentFamily"]].forEach(function (x) { var o = b[x[0]]; o.used = o.approved + o.pending; o.ent = ent[x[1]]; o.left = Math.max(0, o.ent - o.used); });
    b.others = Object.keys(b.others).map(function (k) { return b.others[k]; });
    b.annual.of = b.annual.ent; b.sick.of = b.sick.ent; b.uf.of = b.uf.ent; // the contract's names
    b.other = b.others.map(function (o) { return { type: o.type, label: o.label, hours: o.approved + o.pending, pending: o.pending }; });
    b.classic.annualLeft = Math.max(0, ent.annual - b.classic.annualUsed); b.classic.sickLeft = Math.max(0, ent.sick - b.classic.sickUsed);
    return b;
  }
  function maltaLine(settings, yr) {
    var M = malta(settings); yr = yr || Number(today().slice(0, 4));
    return "Malta " + yr + ": full time (" + (M.fullTimeWeeklyHours || 40) + " h a week) has " + annualFT(M, yr) + " h annual leave, " + (M.sickLeavePaidHours || 80) + " h sick leave paid and " + (M.sickLeaveHalfPayHours || 80) + " h at half pay, " + (M.urgentFamilyLeaveHours || 32) + " h urgent family leave. Part time: in proportion to the hours.";
  }

  // ---- look -------------------------------------------------------------------------------------------------------
  function css() {
    if (document.getElementById("eikon-rotaset-css")) return;
    var st = document.createElement("style"); st.id = "eikon-rotaset-css";
    st.textContent =
      ".rps-ov{position:fixed;inset:0;background:rgba(0,0,0,.42);z-index:9000;display:flex;align-items:flex-end;justify-content:center}@media (min-width:700px){.rps-ov{align-items:center}}" +
      ".rps-sheet{background:var(--panel,#fff);color:var(--text,#111);width:100%;max-width:640px;max-height:92vh;overflow:auto;border-radius:18px 18px 0 0;padding:16px 20px 20px;box-shadow:0 20px 60px rgba(0,0,0,.35);box-sizing:border-box}@media (min-width:700px){.rps-sheet{border-radius:18px}}" +
      ".rps-top{display:flex;align-items:center;gap:8px;margin-bottom:4px}.rps-top h2:focus{outline:0}.rps-top h2{flex:1;font-size:21px;margin:0;letter-spacing:-.02em;font-weight:800}" +
      ".rps-x{font:inherit;font-size:15px;font-weight:600;min-height:44px;padding:0 12px;border:0;background:none;color:var(--accent);cursor:pointer}" +
      ".rps h3{font-size:13px;font-weight:700;color:var(--muted);margin:18px 2px 6px}.rps h3:first-child{margin-top:4px}.rps p.sub{font-size:13.5px;color:var(--muted);margin:2px 2px 8px;line-height:1.45}" +
      ".rps-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".rps-row{display:flex;align-items:center;gap:10px;min-height:48px;padding:6px 14px;border-top:.5px solid var(--border);flex-wrap:wrap}.rps-row:first-child{border-top:0}" +
      ".rps-row>.n{flex:1 1 120px;min-width:0;font-size:15px}.rps-row>.n small{display:block;color:var(--muted);font-size:12.5px}.rps-row .v{font-variant-numeric:tabular-nums;font-weight:600;font-size:14.5px}" +
      ".rps-row input[type=time],.rps-row input[type=date],.rps-row input[type=number],.rps-row input[type=text],.rps-row input[type=email],.rps-row input[type=tel],.rps-row select{font:inherit;font-size:16px;min-height:40px;border:1px solid var(--border);border-radius:9px;background:var(--bg,#fff);color:var(--text);padding:0 8px;box-sizing:border-box}" +
      ".rps-row input[type=time]{width:136px}.rps-row input[type=number]{width:88px}.rps-row input.w,.rps-row select.w{flex:1 1 180px;min-width:0}" +
      ".rps-row .to{color:var(--muted)}.rps-row label.ck{display:flex;align-items:center;gap:8px;min-height:44px;font-size:15px;cursor:pointer}.rps-row label.ck input{width:20px;height:20px;margin:0}" +
      ".rps-row[data-shut] .tm{display:none}.rps-row .shut{display:none;color:var(--muted);font-size:14.5px}.rps-row[data-shut] .shut{display:inline}.rps [hidden]{display:none!important}" +
      ".rps-btn{font:inherit;font-size:14.5px;font-weight:600;min-height:40px;padding:0 14px;border-radius:20px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".rps-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rps-btn.d{color:var(--danger);border-color:var(--danger);background:transparent}.rps-btn.l{border:0;background:none;color:var(--accent);padding:0 6px}" +
      ".rps-btn:disabled{opacity:.55;cursor:default}" +
      ".rps-acts{display:flex;gap:8px;justify-content:flex-end;align-items:center;flex-wrap:wrap;margin-top:10px}.rps-acts .grow{flex:1}" +
      ".rps-msg{font-size:13.5px;margin:8px 2px 0;min-height:0}.rps-msg.bad{color:var(--danger);font-weight:600}.rps-msg.ok{color:var(--ok,#0A7A4E)}" +
      ".rps-warn{font-size:14px;margin:10px 0 0;padding:10px 12px;border-radius:10px;background:var(--warn-soft,rgba(201,138,18,.14));line-height:1.45}" +
      ".rps-bal{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:8px}.rps-bal div{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 12px}" +
      ".rps-bal b{display:block;font-size:20px;font-variant-numeric:tabular-nums}.rps-bal span{display:block;font-size:12.5px;color:var(--muted);line-height:1.4}.rps-bal .low b{color:var(--danger)}" +
      ".rps-note{font-size:12.5px;color:var(--muted);margin:10px 2px 0;line-height:1.5}" +
      ".rps-quiet{color:var(--muted);font-size:14px;padding:14px}.rps-sk{height:120px;border-radius:12px;background:rgba(118,118,128,.1)}" +
      ".rps [aria-invalid=true]{border-color:var(--danger)!important;box-shadow:0 0 0 1px var(--danger)}" +
      ".rps-tbl{width:100%;border-collapse:collapse;font-size:14px}.rps-tbl th{text-align:left;font-size:12px;color:var(--muted);font-weight:600;padding:8px 10px}.rps-tbl td{padding:8px 10px;border-top:.5px solid var(--border);font-variant-numeric:tabular-nums}" +
      "@media (max-width:600px){.rps-btn{min-height:44px;border-radius:22px}.rps-row input[type=time]{width:132px}.rps-row input[type=time],.rps-row input[type=date],.rps-row input[type=number],.rps-row input[type=text],.rps-row input[type=email],.rps-row input[type=tel],.rps-row select{min-height:44px}.rps-sheet{padding:12px 16px 20px}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .rps-btn.p{color:#00160E}}";
    document.head.appendChild(st);
  }
  function busy(btn, on, txt) { if (!btn) return; if (on) { btn.dataset.t = btn.textContent; btn.textContent = txt || "Saving…"; btn.disabled = true; } else { btn.textContent = btn.dataset.t || btn.textContent; btn.disabled = false; } }
  function say(el, words, bad) { if (!el) return; el.textContent = words || ""; el.className = "rps-msg" + (words ? bad ? " bad" : " ok" : ""); el.setAttribute("role", bad ? "alert" : "status"); }
  function mark(form, names) { // fields with a problem, first one focused
    Array.prototype.forEach.call(form.querySelectorAll("[aria-invalid]"), function (x) { x.removeAttribute("aria-invalid"); });
    names.forEach(function (n, i) { var f = form.querySelector('[name="' + n + '"]'); if (f) { f.setAttribute("aria-invalid", "true"); if (!i) try { f.focus(); } catch (e) {} } });
  }
  async function rules() { var r = E.rotaRules ? await E.rotaRules() : null; return { hours: E.rotaMeta.normalizeHours(JSON.parse(JSON.stringify((r && r.hours) || {}))), settings: (r && r.settings) || {} }; }
  function loading(mount) { mount.innerHTML = '<div class="rps"><div class="rps-sk" role="status" aria-busy="true"><span class="eikon-sr">Opening</span></div></div>'; }
  function cantRead(mount, again) {
    mount.innerHTML = '<div class="rps"><p class="rps-msg bad" role="alert">Can\'t reach the server. Try again in a moment.</p><div class="rps-acts"><button type="button" class="rps-btn" data-act="again">Try again</button></div></div>';
    mount.querySelector("[data-act=again]").onclick = again;
  }

  // ---- opening hours ------------------------------------------------------------------------------------------------
  function ovWords(v) { return v && (v.closed === true || v.closed === 1 || v.closed === "1" || v.closed === "true") ? "Closed" : "Open " + hm(v && v.open) + "–" + hm(v && v.close); }
  async function hoursUi(mount, arg, ctx) {
    css(); ctx = ctx || {}; loading(mount);
    var R; try { R = await rules(); if (!R.hours) throw 0; } catch (e) { return cantRead(mount, function () { hoursUi(mount, arg, ctx); }); }
    var h = R.hours, t0 = today(), ov = h.overrides || {};
    var keys = Object.keys(ov).sort(), up = keys.filter(function (d) { return d >= t0; }), past = keys.filter(function (d) { return d < t0; });
    var hol = []; for (var d = t0, i = 0; i < 366; i++, d = addD(d, 1)) { var nm = E.maltaHoliday(d); if (nm && !ov[d]) hol.push([d, nm]); }
    var row = function (dd) { var v = h.weekly[dd] || {}, shut = !!v.closed; return '<div class="rps-row"' + (shut ? " data-shut" : "") + ' role="group" aria-label="' + DAYN[dd] + '"><span class="n">' + DAYN[dd] + '</span><label class="ck"><input type="checkbox" name="open' + dd + '"' + (shut ? "" : " checked") + '> Open</label><span class="shut">Closed</span><span class="tm"><input type="time" name="from' + dd + '" value="' + esc(hm(v.open)) + '" aria-label="' + DAYN[dd] + ' opens"> <span class="to">to</span> <input type="time" name="to' + dd + '" value="' + esc(hm(v.close)) + '" aria-label="' + DAYN[dd] + ' closes"></span></div>'; };
    var ovRow = function (dd) { var v = ov[dd]; return '<div class="rps-row"><span class="n">' + esc(dayW(dd, true)) + "<small>" + esc(ovWords(v) + (v.note ? " · " + v.note : "") + (E.maltaHoliday(dd) ? " · Public holiday (" + E.maltaHoliday(dd) + ")" : "")) + '</small></span><button type="button" class="rps-btn l" data-act="ov-rm" data-d="' + dd + '" aria-label="Remove ' + esc(dayW(dd, true)) + ', back to the usual hours">Remove</button></div>'; };
    mount.innerHTML = '<div class="rps">' +
      '<form data-f="week" novalidate><h3>Every week</h3><div class="rps-card">' + ORDER.map(row).join("") + '</div>' +
      '<div class="rps-acts"><button type="button" class="rps-btn" data-act="copy5">Monday’s hours for Tue–Fri</button><button type="button" class="rps-btn" data-act="copy7">Monday’s hours for every day</button><span class="grow"></span><button type="submit" class="rps-btn p">Save hours</button></div><p class="rps-msg" role="status"></p></form>' +
      '<h3>Days that are different</h3><p class="sub">A day here beats the weekly hours and public holidays: a half day, a day closed, or a duty Sunday.</p>' +
      '<div class="rps-card" data-list="ov">' + (up.length ? up.map(ovRow).join("") : '<div class="rps-quiet">No days coming up.</div>') + "</div>" +
      (past.length ? '<details style="margin-top:6px"><summary class="rps-note" style="cursor:pointer">Earlier days (' + past.length + ")</summary><div class=\"rps-card\">" + past.slice().reverse().map(ovRow).join("") + "</div></details>" : "") +
      '<form data-f="ov" novalidate style="margin-top:10px"><div class="rps-card">' +
      '<div class="rps-row"><label class="n" for="rps-ovd">Day</label><input type="date" id="rps-ovd" name="date" min="' + t0 + '"></div>' +
      '<div class="rps-row"><span class="n" id="rps-ovk">The pharmacy is</span><span role="radiogroup" aria-labelledby="rps-ovk" style="display:flex;gap:14px"><label class="ck"><input type="radio" name="kind" value="open" checked> Open</label><label class="ck"><input type="radio" name="kind" value="closed"> Closed</label></span></div>' +
      '<div class="rps-row" data-k="times"><span class="n">Hours</span><span><input type="time" name="from" value="' + esc(hm(h["default"].open || "07:30")) + '" aria-label="Opens"> <span class="to">to</span> <input type="time" name="to" value="' + esc(hm(h["default"].close || "19:30")) + '" aria-label="Closes"></span></div>' +
      '<div class="rps-row"><label class="n" for="rps-ovn">Note</label><input type="text" class="w" id="rps-ovn" name="note" placeholder="e.g. Half day, Duty roster" autocomplete="off"></div></div>' +
      '<div class="rps-acts"><button type="button" class="rps-btn" data-act="duty">Duty Sunday</button><span class="grow"></span><button type="submit" class="rps-btn p">Save this day</button></div><p class="rps-msg" role="status"></p></form>' +
      (hol.length ? '<h3>Public holidays coming up</h3><p class="sub">Closed unless you open the day.</p><div class="rps-card">' + hol.map(function (x) { return '<div class="rps-row"><span class="n">' + esc(dayW(x[0], true)) + "<small>" + esc(x[1]) + ' · Closed</small></span><button type="button" class="rps-btn l" data-act="hol-open" data-d="' + x[0] + '" aria-label="Open ' + esc(dayW(x[0], true)) + ' (' + esc(x[1]) + ')">Open this day</button></div>'; }).join("") + "</div>" : "") +
      "</div>";
    var fw = mount.querySelector("[data-f=week]"), fo = mount.querySelector("[data-f=ov]");
    var sync = function (dd) { var on = fw.querySelector("[name=open" + dd + "]").checked, r = fw.querySelector("[name=open" + dd + "]").closest(".rps-row"); if (on) r.removeAttribute("data-shut"); else r.setAttribute("data-shut", ""); };
    ORDER.forEach(function (dd) { fw.querySelector("[name=open" + dd + "]").onchange = function () { sync(dd); }; });
    var copy = function (to) { var o = fw.querySelector("[name=open1]").checked, a = fw.querySelector("[name=from1]").value, z = fw.querySelector("[name=to1]").value; to.forEach(function (dd) { fw.querySelector("[name=open" + dd + "]").checked = o; fw.querySelector("[name=from" + dd + "]").value = a; fw.querySelector("[name=to" + dd + "]").value = z; sync(dd); }); say(fw.querySelector(".rps-msg"), "Copied Monday’s hours. Save hours to keep them."); };
    fw.querySelector("[data-act=copy5]").onclick = function () { copy([2, 3, 4, 5]); };
    fw.querySelector("[data-act=copy7]").onclick = function () { copy([2, 3, 4, 5, 6, 0]); };
    fw.onsubmit = async function (ev) {
      ev.preventDefault(); var msg = fw.querySelector(".rps-msg"), bad = [], wk2 = {};
      for (var dd = 0; dd < 7; dd++) {
        var o = fw.querySelector("[name=open" + dd + "]").checked, a = fw.querySelector("[name=from" + dd + "]").value, z = fw.querySelector("[name=to" + dd + "]").value;
        wk2[dd] = { closed: !o, open: a, close: z }; // the classic Save Hours: closed, open, close; empty times on an open day take 07:30–19:30
        if (o) { if (!wk2[dd].open) wk2[dd].open = "07:30"; if (!wk2[dd].close) wk2[dd].close = "19:30"; if (mn(wk2[dd].close) <= mn(wk2[dd].open)) bad.push(dd); }
      }
      if (bad.length) { mark(fw, bad.map(function (dd) { return "to" + dd; })); return say(msg, bad.map(function (dd) { return DAYN[dd]; }).join(", ") + ": the closing time must be after the opening time.", true); }
      mark(fw, []); var btn = fw.querySelector("[type=submit]"); busy(btn, true);
      try { await E.rotaHoursPut(function (hh) { hh.weekly = wk2; E.rotaMeta.normalizeHours(hh); }); busy(btn, false); say(msg, "Opening hours saved."); ctx.onSaved && ctx.onSaved("hours"); changed("hours"); }
      catch (x) { busy(btn, false); say(msg, failText(x), true); }
    };
    var kind = function () { var k = fo.querySelector("[name=kind]:checked"); return k ? k.value : "open"; };
    var showT = function () { fo.querySelector("[data-k=times]").hidden = kind() === "closed"; };
    Array.prototype.forEach.call(fo.querySelectorAll("[name=kind]"), function (r) { r.onchange = showT; });
    fo.querySelector("[name=date]").onchange = function () { var v = this.value; if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return; var w = h.weekly[wd(v)] || h["default"]; if (!fo.querySelector("[name=from]").dataset.typed) fo.querySelector("[name=from]").value = hm(w.open || "07:30"); if (!fo.querySelector("[name=to]").dataset.typed) fo.querySelector("[name=to]").value = hm(w.close || "19:30"); };
    ["from", "to"].forEach(function (n) { fo.querySelector("[name=" + n + "]").addEventListener("input", function () { this.dataset.typed = "1"; }); });
    fo.querySelector("[data-act=duty]").onclick = function () {
      var d0 = fo.querySelector("[name=date]").value; if (!d0 || wd(d0) !== 0) { d0 = addD(t0, (7 - wd(t0)) % 7 || 7); fo.querySelector("[name=date]").value = d0; }
      fo.querySelector("[name=kind][value=open]").checked = true; showT(); var w = h.weekly[0] && !h.weekly[0].closed ? h.weekly[0] : h["default"];
      fo.querySelector("[name=from]").value = hm(w.open || "07:30"); fo.querySelector("[name=to]").value = hm(w.close || "19:30"); fo.querySelector("[name=note]").value = "Duty roster";
      say(fo.querySelector(".rps-msg"), "Set to open on " + dayW(d0, true) + " as the duty pharmacy. Change the hours if needed, then Save this day.");
    };
    fo.onsubmit = async function (ev) {
      ev.preventDefault(); var msg = fo.querySelector(".rps-msg"), d1 = fo.querySelector("[name=date]").value, cl = kind() === "closed", a = fo.querySelector("[name=from]").value, z = fo.querySelector("[name=to]").value, note = fo.querySelector("[name=note]").value.trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d1)) { mark(fo, ["date"]); return say(msg, "Choose the day.", true); }
      if (!cl && !(a && z && mn(z) > mn(a))) { mark(fo, ["to"]); return say(msg, "The closing time must be after the opening time.", true); }
      mark(fo, []); var btn = fo.querySelector("[type=submit]"); busy(btn, true);
      try {
        await E.rotaHoursPut(function (hh) { hh.overrides[d1] = cl ? { closed: true, note: note } : { open: a, close: z, closed: false, note: note }; }); // the classic Add Override
        ctx.onSaved && ctx.onSaved("hours"); changed("hours"); await hoursUi(mount, arg, ctx);
        say(mount.querySelector("[data-f=ov] .rps-msg"), dayW(d1, true) + " saved: " + (cl ? "closed" : "open " + a + "–" + z) + ".");
      } catch (x) { busy(btn, false); say(msg, failText(x), true); }
    };
    Array.prototype.forEach.call(mount.querySelectorAll("[data-act=ov-rm]"), function (b) {
      b.onclick = async function () {
        var d1 = b.getAttribute("data-d"); busy(b, true, "Removing…");
        try { await E.rotaHoursPut(function (hh) { delete hh.overrides[d1]; }); ctx.onSaved && ctx.onSaved("hours"); changed("hours"); await hoursUi(mount, arg, ctx); say(mount.querySelector("[data-f=ov] .rps-msg"), dayW(d1, true) + " is back to the usual hours."); }
        catch (x) { busy(b, false); say(fo.querySelector(".rps-msg"), failText(x), true); }
      };
    });
    Array.prototype.forEach.call(mount.querySelectorAll("[data-act=hol-open]"), function (b) {
      b.onclick = function () { var d1 = b.getAttribute("data-d"), w = h.weekly[wd(d1)] && !h.weekly[wd(d1)].closed ? h.weekly[wd(d1)] : h["default"]; fo.querySelector("[name=date]").value = d1; fo.querySelector("[name=kind][value=open]").checked = true; showT(); fo.querySelector("[name=from]").value = hm(w.open || "07:30"); fo.querySelector("[name=to]").value = hm(w.close || "19:30"); if (!fo.querySelector("[name=note]").value) fo.querySelector("[name=note]").value = "Open on " + E.maltaHoliday(d1); try { fo.querySelector("[name=from]").focus(); } catch (e) {} say(fo.querySelector(".rps-msg"), "Opening on " + dayW(d1, true) + ": check the hours, then Save this day."); };
    });
  }

  // One day from the grid's header: open a closed day (a duty Sunday, a holiday), close an open one, or back to usual.
  async function dayUi(mount, ymd, ctx) {
    css(); ctx = ctx || {}; loading(mount);
    var R; try { R = await rules(); } catch (e) { return cantRead(mount, function () { dayUi(mount, ymd, ctx); }); }
    var h = R.hours, ov = h.overrides[ymd], c = E.teamCover(ymd, { hours: h, settings: R.settings }), w = h.weekly[wd(ymd)] && !h.weekly[wd(ymd)].closed ? h.weekly[wd(ymd)] : h["default"];
    var openIt = c.closed || !!(ov && !(ov.closed === true || ov.closed === 1 || ov.closed === "1" || ov.closed === "true")), ph = E.maltaHoliday(ymd);
    mount.innerHTML = '<div class="rps"><p class="sub" style="font-size:15px;color:var(--text)"><b>' + esc(dayW(ymd, true)) + "</b> · " + esc(c.closed ? c.words : "Open " + c.open + "–" + c.close + (ph ? " · Public holiday (" + ph + ")" : "")) + (ov && ov.note ? " · " + esc(ov.note) : "") + "</p>" +
      '<form data-f="day" novalidate><div class="rps-card">' +
      '<div class="rps-row"><span class="n" id="rps-dk">The pharmacy is</span><span role="radiogroup" aria-labelledby="rps-dk" style="display:flex;gap:14px"><label class="ck"><input type="radio" name="kind" value="open"' + (openIt ? " checked" : "") + '> Open</label><label class="ck"><input type="radio" name="kind" value="closed"' + (openIt ? "" : " checked") + '> Closed</label></span></div>' +
      '<div class="rps-row" data-k="times"><span class="n">Hours</span><span><input type="time" name="from" value="' + esc(c.closed ? hm(w.open || "07:30") : c.open) + '" aria-label="Opens"> <span class="to">to</span> <input type="time" name="to" value="' + esc(c.closed ? hm(w.close || "19:30") : c.close) + '" aria-label="Closes"></span></div>' +
      '<div class="rps-row"><label class="n" for="rps-dn">Note</label><input type="text" class="w" id="rps-dn" name="note" value="' + esc(ov ? ov.note || "" : c.closed && wd(ymd) === 0 && !ph ? "Duty roster" : "") + '" autocomplete="off"></div></div>' +
      '<div class="rps-acts">' + (ov ? '<button type="button" class="rps-btn" data-act="usual">Back to the usual hours</button>' : "") + '<span class="grow"></span><button type="submit" class="rps-btn p">' + (c.closed ? "Open this day" : "Save this day") + "</button></div><p class=\"rps-msg\" role=\"status\"></p></form></div>";
    var f = mount.querySelector("form"), kind = function () { return f.querySelector("[name=kind]:checked").value; };
    var showT = function () { f.querySelector("[data-k=times]").hidden = kind() === "closed"; f.querySelector("[type=submit]").textContent = kind() === "closed" ? (c.closed && ov ? "Save this day" : "Close this day") : c.closed ? "Open this day" : "Save this day"; };
    Array.prototype.forEach.call(f.querySelectorAll("[name=kind]"), function (r) { r.onchange = showT; }); showT();
    f.onsubmit = async function (ev) {
      ev.preventDefault(); var msg = f.querySelector(".rps-msg"), cl = kind() === "closed", a = f.querySelector("[name=from]").value, z = f.querySelector("[name=to]").value, note = f.querySelector("[name=note]").value.trim();
      if (!cl && !(a && z && mn(z) > mn(a))) { mark(f, ["to"]); return say(msg, "The closing time must be after the opening time.", true); }
      var btn = f.querySelector("[type=submit]"); busy(btn, true);
      try { await E.rotaHoursPut(function (hh) { hh.overrides[ymd] = cl ? { closed: true, note: note } : { open: a, close: z, closed: false, note: note }; }); busy(btn, false); say(msg, dayW(ymd, true) + " saved: " + (cl ? "closed" : "open " + a + "–" + z) + "."); ctx.onSaved && ctx.onSaved("hours", ymd); changed("hours"); if (ctx.close) ctx.close(); }
      catch (x) { busy(btn, false); say(msg, failText(x), true); }
    };
    var u = f.querySelector("[data-act=usual]");
    if (u) u.onclick = async function () { busy(u, true, "Saving…"); try { await E.rotaHoursPut(function (hh) { delete hh.overrides[ymd]; }); ctx.onSaved && ctx.onSaved("hours", ymd); changed("hours"); if (ctx.close) ctx.close(); else dayUi(mount, ymd, ctx); } catch (x) { busy(u, false); say(f.querySelector(".rps-msg"), failText(x), true); } };
  }

  // ---- rules: cover, minimum people, warnings, Malta reference -----------------------------------------------------
  async function rulesUi(mount, arg, ctx) {
    css(); ctx = ctx || {}; loading(mount);
    var R; try { R = await rules(); if (!R.settings) throw 0; } catch (e) { return cantRead(mount, function () { rulesUi(mount, arg, ctx); }); }
    var s = R.settings, rota = s.rota && typeof s.rota === "object" ? s.rota : {}, off = rota.warn || {}, yr = Number(today().slice(0, 4)), M = malta(s), yd = maltaYear(M, yr);
    var req = !(s.pharmacistRequired === false || s.pharmacistRequired === 0 || s.pharmacistRequired === "0" || s.pharmacistRequired === "false");
    var ref = [["Annual leave, full time " + yr, annualFT(M, yr) + " h"], ["Sick leave paid", (M.sickLeavePaidHours || 80) + " h (10 days)"], ["Sick leave at half pay", (M.sickLeaveHalfPayHours || 80) + " h (10 days)"], ["Urgent family leave", (M.urgentFamilyLeaveHours || 32) + " h a year"],
      ["Maternity leave", "18 weeks"], ["Paternity leave", "10 working days"], ["Parental leave", "4 months (2 paid)"]].concat(yd.miscarriageLeaveDays ? [["Miscarriage leave", yd.miscarriageLeaveDays + " calendar days"]] : [])
      .concat([["Most hours in a week", (M.maxWeeklyHours || 48) + " h (EU working time)"], ["Full-time week", (M.fullTimeWeeklyHours || 40) + " h"]]).concat(yd.colaWeekly ? [["COLA " + yr, "€" + Number(yd.colaWeekly).toFixed(2) + " a week"]] : []).concat(yd.minWageWeekly ? [["Minimum wage " + yr, "€" + Number(yd.minWageWeekly).toFixed(2) + " a week"]] : []).concat([["Part-time leave", "In proportion (hours ÷ " + (M.fullTimeWeeklyHours || 40) + ")"]]);
    mount.innerHTML = '<div class="rps"><form data-f="rules" novalidate><h3>Pharmacist cover</h3><div class="rps-card">' +
      '<div class="rps-row"><label class="n" for="rps-rph">A pharmacist must be on while open</label><select id="rps-rph" name="req" class="w"><option value="1"' + (req ? " selected" : "") + '>Yes: show each gap as a problem</option><option value="0"' + (req ? "" : " selected") + '>No: do not check</option></select></div>' +
      '<div class="rps-row"><label class="n" for="rps-mph">Pharmacists needed at once</label><input type="number" id="rps-mph" name="minph" min="1" max="5" inputmode="numeric" value="' + esc(s.minPharmacists || 1) + '"></div>' +
      '<div class="rps-row"><label class="n" for="rps-mst">People needed at once<small>Anyone on the rota. 0 = no check.</small></label><input type="number" id="rps-mst" name="minstaff" min="0" max="20" inputmode="numeric" value="' + esc(parseInt(rota.minStaff, 10) || 0) + '"></div></div>' +
      '<h3>Things to look at</h3><p class="sub">Shown on Plan shifts while you plan. They never stop a save.</p><div class="rps-card">' +
      E.rotaCheck.KINDS.map(function (k) { return '<div class="rps-row"><label class="ck"><input type="checkbox" name="w_' + k[0] + '"' + (off[k[0]] === false ? "" : " checked") + "> " + esc(k[1]) + "</label></div>"; }).join("") +
      '</div><div class="rps-acts"><button type="submit" class="rps-btn p">Save rules</button></div><p class="rps-msg" role="status"></p></form>' +
      '<h3>Malta employment law reference</h3><div class="rps-card" data-list="ref">' + ref.map(function (r) { return '<div class="rps-row"><span class="n">' + esc(r[0]) + '</span><span class="v">' + esc(r[1]) + "</span></div>"; }).join("") + "</div>" +
      '<p class="rps-note">A reference: change it to match this year and your own policy. Leave balances use these figures.</p>' +
      '<div class="rps-acts"><button type="button" class="rps-btn" data-act="ml-edit" aria-expanded="false" aria-controls="rps-ml">Change the reference</button></div>' +
      '<form data-f="ml" id="rps-ml" novalidate hidden><div class="rps-card">' +
      '<div class="rps-row"><label class="n" for="rps-mly">Year</label><select id="rps-mly" name="year">' + [yr - 2, yr - 1, yr, yr + 1, yr + 2].map(function (y) { return '<option value="' + y + '"' + (y === yr ? " selected" : "") + ">" + y + "</option>"; }).join("") + "</select></div>" +
      [["al", "Annual leave, full time (hours)"], ["ph", "Public holidays (number)"], ["cola", "COLA (€ a week)", "0.01"], ["mw", "Minimum wage (€ a week)", "0.01"], ["ml", "Miscarriage leave (days)"], ["sp", "Sick leave paid (hours)"], ["sh", "Sick leave at half pay (hours)"], ["uf", "Urgent family leave (hours)"], ["ft", "Full-time week (hours)"], ["mx", "Most hours in a week"]]
        .map(function (x) { return '<div class="rps-row"><label class="n" for="rps-ml-' + x[0] + '">' + x[1] + '</label><input type="number" id="rps-ml-' + x[0] + '" name="' + x[0] + '" min="0"' + (x[2] ? ' step="' + x[2] + '" inputmode="decimal"' : ' inputmode="numeric"') + "></div>"; }).join("") +
      '</div><div class="rps-acts"><button type="button" class="rps-btn" data-act="ml-cancel">Cancel</button><button type="submit" class="rps-btn p">Save the reference</button></div><p class="rps-msg" role="status"></p></form></div>';
    var fr = mount.querySelector("[data-f=rules]"), fm = mount.querySelector("[data-f=ml]");
    fr.onsubmit = async function (ev) {
      ev.preventDefault(); var msg = fr.querySelector(".rps-msg"), mph = parseInt(fr.querySelector("[name=minph]").value, 10), mst = parseInt(fr.querySelector("[name=minstaff]").value, 10);
      if (fr.querySelector("[name=minph]").value !== "" && !(mph >= 1 && mph <= 5)) { mark(fr, ["minph"]); return say(msg, "Pharmacists needed at once: 1 to 5.", true); }
      if (fr.querySelector("[name=minstaff]").value !== "" && !(mst >= 0 && mst <= 20)) { mark(fr, ["minstaff"]); return say(msg, "People needed at once: 0 to 20.", true); }
      mark(fr, []); var warn = {}; E.rotaCheck.KINDS.forEach(function (k) { if (!fr.querySelector("[name=w_" + k[0] + "]").checked) warn[k[0]] = false; });
      var btn = fr.querySelector("[type=submit]"); busy(btn, true);
      try {
        await E.rotaMeta.settings(function (s2) {
          s2.pharmacistRequired = fr.querySelector("[name=req]").value === "1"; // the classic Save Rules
          s2.minPharmacists = parseInt(fr.querySelector("[name=minph]").value, 10) || 1;
          var had = s2.rota && typeof s2.rota === "object", r2 = had ? s2.rota : {};
          if (mst > 0) r2.minStaff = mst; else delete r2.minStaff;
          if (Object.keys(warn).length) r2.warn = warn; else delete r2.warn;
          if (had || Object.keys(r2).length) s2.rota = r2; // nothing new: the classic body exactly
        });
        busy(btn, false); say(msg, "Rules saved."); ctx.onSaved && ctx.onSaved("rules"); changed("rules");
      } catch (x) { busy(btn, false); say(msg, failText(x), true); }
    };
    var fill = function (y) {
      var cfg = s.maltaLaw && typeof s.maltaLaw === "object" ? s.maltaLaw : {}, d = maltaYear(M, y), v = {
        al: cfg.annualLeaveHours && cfg.annualLeaveHours[y] != null ? cfg.annualLeaveHours[y] : annualFT(M, y), ph: d.publicHolidays || "", cola: d.colaWeekly || "", mw: d.minWageWeekly || "", ml: d.miscarriageLeaveDays || "",
        sp: M.sickLeavePaidHours || 80, sh: M.sickLeaveHalfPayHours || 80, uf: M.urgentFamilyLeaveHours || 32, ft: M.fullTimeWeeklyHours || 40, mx: M.maxWeeklyHours || 48 };
      Object.keys(v).forEach(function (k) { fm.querySelector("[name=" + k + "]").value = v[k]; });
    };
    var ed = mount.querySelector("[data-act=ml-edit]");
    ed.onclick = function () { fill(Number(fm.querySelector("[name=year]").value)); fm.hidden = false; ed.setAttribute("aria-expanded", "true"); ed.hidden = true; try { fm.querySelector("[name=al]").focus(); } catch (e) {} };
    fm.querySelector("[name=year]").onchange = function () { fill(Number(this.value)); };
    fm.querySelector("[data-act=ml-cancel]").onclick = function () { fm.hidden = true; ed.hidden = false; ed.setAttribute("aria-expanded", "false"); try { ed.focus(); } catch (e) {} };
    fm.onsubmit = async function (ev) {
      ev.preventDefault(); var msg = fm.querySelector(".rps-msg"), g = function (n) { return fm.querySelector("[name=" + n + "]").value; }, y = parseInt(g("year"), 10) || yr;
      var btn = fm.querySelector("[type=submit]"); busy(btn, true);
      try {
        await E.rotaMeta.settings(function (s2) { // the classic Malta reference Save, on the freshly read settings
          var next = s2.maltaLaw && typeof s2.maltaLaw === "object" ? JSON.parse(JSON.stringify(s2.maltaLaw)) : {};
          if (!next.annualLeaveHours) next.annualLeaveHours = {};
          if (!next.yearData) next.yearData = {};
          next.annualLeaveHours[y] = parseInt(g("al"), 10) || 0;
          next.yearData[y] = Object.assign({}, next.yearData[y] || {}, { publicHolidays: parseInt(g("ph"), 10) || 0, colaWeekly: parseFloat(g("cola")) || 0, minWageWeekly: parseFloat(g("mw")) || 0, miscarriageLeaveDays: parseInt(g("ml"), 10) || 0 });
          next.sickLeavePaidHours = parseInt(g("sp"), 10) || 0; next.sickLeaveHalfPayHours = parseInt(g("sh"), 10) || 0; next.urgentFamilyLeaveHours = parseInt(g("uf"), 10) || 0;
          next.fullTimeWeeklyHours = parseInt(g("ft"), 10) || 40; next.maxWeeklyHours = parseInt(g("mx"), 10) || 48;
          s2.maltaLaw = next;
        });
        ctx.onSaved && ctx.onSaved("rules"); changed("rules"); await rulesUi(mount, arg, ctx); say(mount.querySelector("[data-f=rules] .rps-msg"), "Malta reference saved.");
      } catch (x) { busy(btn, false); say(msg, failText(x), true); }
    };
  }

  // ---- availability -------------------------------------------------------------------------------------------------
  function availOf(rota, sid) { var a = rota && rota.avail && rota.avail[String(sid)]; return a && typeof a === "object" ? JSON.parse(JSON.stringify(a)) : {}; }
  function availSummary(a, p) {
    var n = first(p && p.full_name), w = a.w || {}, out = [];
    ORDER.forEach(function (d) { var v = w[d] != null ? w[d] : w[String(d)]; if (v === "no") out.push("never on " + DAYS[d]); else if (v && v.from) out.push(DAYS[d] + " only " + v.from + "–" + v.to); });
    var ds = Object.keys(a.d || {}).filter(function (d) { return d >= today(); }).length;
    if (ds) out.push(ds === 1 ? "1 particular day" : ds + " particular days");
    return out.length ? n + ": " + out.join(", ") : n + " can work any day.";
  }
  // Past dates go and at most 200 stay, for everyone, on every save.
  function prune(all) {
    var t0 = today(); Object.keys(all || {}).forEach(function (sid) {
      var a = all[sid]; if (!a || typeof a !== "object") { delete all[sid]; return; }
      if (a.d) { var ks = Object.keys(a.d).filter(function (d) { return d >= t0; }).sort().slice(0, 200), nd = {}; ks.forEach(function (d) { nd[d] = a.d[d]; }); if (ks.length) a.d = nd; else delete a.d; }
      if (a.w && !Object.keys(a.w).length) delete a.w;
      if (!a.w && !a.d) delete all[sid];
    });
    return all;
  }
  async function availUi(mount, p, ctx) {
    css(); ctx = ctx || {}; p = p || {};
    if (p.id == null) { mount.innerHTML = '<div class="rps"><p class="sub">Choose a person first: tap their name on the week.</p></div>'; return; }
    loading(mount);
    var rota; try { rota = await E.rotaMeta.get(); } catch (e) { return cantRead(mount, function () { availUi(mount, p, ctx); }); }
    var a = availOf(rota, p.id), w = a.w || {}, dates = a.d || {}, t0 = today(), n = first(p.full_name);
    var sel = function (name, v, label) { var k = v === "no" ? "no" : v && v.from ? "only" : "any"; return '<select name="' + name + '" aria-label="' + esc(label) + '"><option value="any"' + (k === "any" ? " selected" : "") + '>Any time</option><option value="no"' + (k === "no" ? " selected" : "") + ">Can't work</option><option value=\"only\"" + (k === "only" ? " selected" : "") + ">Only between…</option></select>"; };
    var tms = function (pre, v, label) { var on = v && v.from; return '<span class="tm" data-t="' + pre + '"' + (on ? "" : " hidden") + '><input type="time" name="' + pre + 'f" value="' + esc(on ? v.from : "") + '" aria-label="' + esc(label) + ' from"> <span class="to">to</span> <input type="time" name="' + pre + 't" value="' + esc(on ? v.to : "") + '" aria-label="' + esc(label) + ' until"></span>'; };
    var drow = function (d) { var v = dates[d]; return '<div class="rps-row" data-d="' + d + '"><span class="n">' + esc(dayW(d, true)) + "<small>" + esc(v === "no" ? "Can't work" : "Only " + v.from + "–" + v.to) + '</small></span><button type="button" class="rps-btn l" data-act="d-rm" data-d="' + d + '" aria-label="Remove ' + esc(dayW(d, true)) + '">Remove</button></div>'; };
    var paint = function () {
      var ds = Object.keys(dates).filter(function (d) { return d >= t0; }).sort();
      mount.innerHTML = '<div class="rps"><form data-f="avail" novalidate><p class="sub">Not leave: it never touches ' + esc(n) + "'s balance. Filling the rota skips these times, and a shift planned in them shows as a thing to look at.</p>" +
        "<h3>Every week</h3><div class=\"rps-card\">" + ORDER.map(function (d) { var v = w[d] != null ? w[d] : w[String(d)]; return '<div class="rps-row"><span class="n">' + DAYS[d] + "</span>" + sel("w" + d, v, DAYS[d]) + tms("w" + d, v, DAYS[d]) + "</div>"; }).join("") + "</div>" +
        '<h3>Particular days</h3><div class="rps-card" data-list="d">' + (ds.length ? ds.map(drow).join("") : '<div class="rps-quiet">No particular days.</div>') +
        '<div class="rps-row"><input type="date" name="nd" min="' + t0 + '" aria-label="Another day">' + sel("nk", "no", "That day") + tms("nk", null, "That day") + '<button type="button" class="rps-btn" data-act="d-add">Add the day</button></div></div>' +
        '<div class="rps-acts"><button type="submit" class="rps-btn p">Save</button></div><p class="rps-msg" role="status"></p></form></div>';
      var f = mount.querySelector("form");
      Array.prototype.forEach.call(f.querySelectorAll("select"), function (s) { s.onchange = function () { var t = f.querySelector('[data-t="' + s.name + '"]'); if (t) t.hidden = s.value !== "only"; }; });
      f.querySelector("[data-act=d-add]").onclick = function () {
        var d = f.querySelector("[name=nd]").value, k = f.querySelector("[name=nk]").value, a0 = f.querySelector("[name=nkf]").value, z0 = f.querySelector("[name=nkt]").value, msg = f.querySelector(".rps-msg");
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || d < t0) { mark(f, ["nd"]); return say(msg, "Choose a day from today on.", true); }
        if (k === "any") { delete dates[d]; } else if (k === "only") { if (!(a0 && z0 && mn(z0) > mn(a0))) { mark(f, ["nkt"]); return say(msg, "The end must be after the start.", true); } dates[d] = { from: a0, to: z0 }; } else dates[d] = "no";
        keepWeek(f); paint(); say(mount.querySelector(".rps-msg"), dayW(d, true) + " added. Save to keep it.");
      };
      Array.prototype.forEach.call(f.querySelectorAll("[data-act=d-rm]"), function (b) { b.onclick = function () { delete dates[b.getAttribute("data-d")]; keepWeek(f); paint(); say(mount.querySelector(".rps-msg"), "Removed. Save to keep it."); }; });
      f.onsubmit = async function (ev) {
        ev.preventDefault(); var msg = f.querySelector(".rps-msg"), bad = keepWeek(f);
        if (bad.length) { mark(f, bad.map(function (d) { return "w" + d + "t"; })); return say(msg, bad.map(function (d) { return DAYS[d]; }).join(", ") + ": the end must be after the start.", true); }
        var btn = f.querySelector("[type=submit]"); busy(btn, true);
        var mine = {}; if (Object.keys(w).length) mine.w = w; if (Object.keys(dates).length) mine.d = dates;
        try {
          await E.rotaMeta.merge("avail", function (all) { all = all && typeof all === "object" ? all : {}; if (mine.w || mine.d) all[String(p.id)] = mine; else delete all[String(p.id)]; prune(all); return Object.keys(all).length ? all : undefined; });
          busy(btn, false); say(msg, "Saved. " + availSummary(mine, p)); ctx.onSaved && ctx.onSaved("avail", p.id); changed("avail");
        } catch (x) { busy(btn, false); say(msg, failText(x), true); }
      };
    };
    function keepWeek(f) { // what is chosen for each weekday, into w; the days with a bad time come back
      var bad = []; ORDER.forEach(function (d) {
        var k = f.querySelector("[name=w" + d + "]").value, a0 = f.querySelector("[name=w" + d + "f]").value, z0 = f.querySelector("[name=w" + d + "t]").value;
        delete w[String(d)]; delete w[d];
        if (k === "no") w[String(d)] = "no"; else if (k === "only") { if (a0 && z0 && mn(z0) > mn(a0)) w[String(d)] = { from: a0, to: z0 }; else bad.push(d); }
      });
      return bad;
    }
    paint();
  }

  // ---- leave: balances and history ------------------------------------------------------------------------------------
  async function leaveData(ctx) {
    var yr = Number(today().slice(0, 4)), out = { staff: ctx.staff, leaves: ctx.leaves, settings: null };
    var jobs = [E.rotaRules ? E.rotaRules() : Promise.resolve(null)];
    if (!out.leaves) jobs.push(Promise.all([yr, yr - 1].map(function (y) { return E.apiFetch("/shifts/leaves?year=" + y, { method: "GET" }); })));
    if (!out.staff) jobs.push(E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" }));
    var r = await Promise.all(jobs), i = 1;
    out.settings = (r[0] && r[0].settings) || {};
    if (!out.leaves) { var ls = r[i++], seen = {}; if (ls.some(function (x) { return !x || !x.ok; })) throw new Error("leave"); out.leaves = [].concat.apply([], ls.map(function (x) { return x.leaves || []; })).filter(function (l) { if (seen[l.id]) return false; seen[l.id] = 1; return true; }); }
    if (!out.staff) { var st = r[i++]; if (!st || !st.ok) throw new Error("staff"); out.staff = st.staff || []; }
    if (!Array.isArray(out.staff)) out.staff = Object.keys(out.staff).map(function (k) { return out.staff[k]; });
    return out;
  }
  function when(l) {
    var a = l.start_date, z = l.end_date || a, t = a === z ? dayW(a, true) : dayW(a, true) + " – " + dayW(z, true);
    if (l.start_time || l.end_time) t += ", " + hm(l.start_time || "") + "–" + hm(l.end_time || "");
    return t;
  }
  function balHtml(p, b) {
    if (b.na) return '<p class="sub">' + esc(first(p.full_name)) + " is a locum: self-employed, so no leave entitlement.</p>";
    var card = function (o, title) { var lowL = o.ent && o.left < Math.min(24, o.ent); return '<div' + (lowL ? ' class="low"' : "") + "><span>" + esc(title) + "</span><b>" + hrs(o.left) + "</b><span>left of " + hrs(o.ent) + (o.pending ? " · " + hrs(o.pending) + " asked for, not answered yet" : "") + "</span></div>"; };
    return '<div class="rps-bal">' + card(b.annual, "Annual leave") + card(b.sick, "Sick leave") + card(b.uf, "Urgent family leave") +
      b.others.map(function (o) { return "<div><span>" + esc(o.label) + "</span><b>" + hrs(o.approved + o.pending) + "</b><span>taken " + b.year + (o.pending ? " · " + hrs(o.pending) + " asked for" : "") + " · not from annual leave</span></div>"; }).join("") + "</div>";
  }
  async function leaveUi(mount, p, ctx) {
    css(); ctx = ctx || {}; loading(mount);
    var D; try { D = await leaveData(ctx); } catch (e) { return cantRead(mount, function () { leaveUi(mount, p, ctx); }); }
    var byId = {}; D.staff.forEach(function (x) { byId[String(x.id)] = x; });
    var name = function (sid) { return (byId[String(sid)] || {}).full_name || "Staff #" + sid; };
    var mine = (D.leaves || []).filter(function (l) { return !p || String(l.staff_id) === String(p.id); });
    var pend = mine.filter(function (l) { return low(l.status) === "pending"; }), hist = mine.filter(function (l) { return low(l.status) !== "pending"; })
      .sort(function (a, b) { return a.start_date < b.start_date ? 1 : a.start_date > b.start_date ? -1 : (b.id || 0) - (a.id || 0); }).slice(0, 50);
    var row = function (l) { var st = low(l.status); return '<div class="rps-row"><span class="n">' + (p ? "" : "<b>" + esc(name(l.staff_id)) + "</b> · ") + esc(leaveName(l.leave_type)) + "<small>" + esc(when(l)) + (l.hours_requested ? " · " + hrs(l.hours_requested) : "") + (l.reason ? " · " + esc(l.reason) : "") + '</small></span><span class="v"' + (st === "rejected" ? ' style="color:var(--muted)"' : "") + ">" + (st === "approved" ? "Approved" : st === "rejected" ? "Refused" : st === "pending" ? "Waiting for an answer" : esc(l.status || "")) + "</span>" +
      (st === "pending" && ctx.open ? '<button type="button" class="rps-btn l" data-act="answer" data-id="' + l.id + '">Answer</button>' : "") + "</div>"; };
    var h = '<div class="rps">';
    if (p) h += "<h3>This year</h3>" + balHtml(p, balance(p, D.leaves, D.settings));
    else {
      var people = D.staff.filter(function (x) { return Number(x.is_active) !== 0 && low(x.designation) !== "locum"; }).sort(function (a, b) { return String(a.full_name).localeCompare(String(b.full_name)); });
      h += "<h3>Balances this year</h3>" + (people.length ? '<div class="rps-card" style="overflow-x:auto"><table class="rps-tbl"><thead><tr><th scope="col">Person</th><th scope="col">Annual leave left</th><th scope="col">Sick leave left</th><th scope="col">Other leave taken</th></tr></thead><tbody>' +
        people.map(function (x) { var b = balance(x, D.leaves, D.settings); var oth = b.others.reduce(function (n, o) { return n + o.approved + o.pending; }, 0) + b.uf.used; return '<tr><th scope="row" style="font-weight:600">' + esc(x.full_name) + "</th><td>" + hrs(b.annual.left) + " of " + hrs(b.annual.ent) + "</td><td>" + hrs(b.sick.left) + " of " + hrs(b.sick.ent) + "</td><td>" + (oth ? hrs(oth) : "—") + "</td></tr>"; }).join("") + "</tbody></table></div>" : '<p class="sub">Nobody on the rota yet.</p>');
    }
    h += '<p class="rps-note">' + esc(maltaLine(D.settings)) + " Only annual leave counts against annual leave; requests waiting for an answer count until refused." + (ctx.open ? ' <button type="button" class="rps-btn l" data-act="rules">Change the reference</button>' : "") + "</p>";
    if (pend.length) h += "<h3>Waiting for an answer (" + pend.length + ')</h3><div class="rps-card">' + pend.map(row).join("") + "</div>";
    h += "<h3>History</h3>" + (hist.length ? '<div class="rps-card">' + hist.map(row).join("") + "</div>" + (hist.length === 50 ? '<p class="rps-note">The 50 most recent.</p>' : "") : '<div class="rps-card"><div class="rps-quiet">No leave yet this year or last year.</div></div>');
    mount.innerHTML = h + "</div>";
    Array.prototype.forEach.call(mount.querySelectorAll("[data-act=answer]"), function (b) { b.onclick = function () { ctx.open("answer", Number(b.getAttribute("data-id"))); }; });
    var rb = mount.querySelector("[data-act=rules]"); if (rb) rb.onclick = function () { ctx.open("rules"); };
  }

  // ---- a person's details ------------------------------------------------------------------------------------------
  async function freshPerson(id) {
    var r = await E.apiFetch("/shifts/staff?include_inactive=1", { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the rota");
    return (r.staff || []).filter(function (x) { return String(x.id) === String(id); })[0] || null;
  }
  // The classic Edit Employee body, from the record as it is on the server now (patterns and active state as stored).
  function body(cur, v) {
    var pj = cur.patterns_json; if (typeof pj !== "string") pj = pj == null ? "" : JSON.stringify(pj);
    return { full_name: v.full_name, designation: v.designation, employment_type: v.designation === "locum" ? "external" : v.employment_type, contracted_hours: parseFloat(v.contracted_hours) || 40,
      email: v.email, phone: v.phone, registration_number: v.registration_number, is_active: v.is_active == null ? (Number(cur.is_active) === 0 ? 0 : 1) : v.is_active, patterns_json: pj };
  }
  async function putPerson(id, fn) {
    var cur = await freshPerson(id); if (!cur) { var x = new Error("This person was removed on another device."); x.alreadySaved = false; throw x; }
    var b = fn(cur), r = await E.apiFetch("/shifts/staff/" + id, { method: "PUT", body: JSON.stringify(b) });
    if (!r || !r.ok) throw new Error((r && r.error) || "Not saved");
    return b;
  }
  async function personUi(mount, p, ctx) {
    css(); ctx = ctx || {}; p = p || {};
    if (p.id == null) { mount.innerHTML = '<div class="rps"><p class="sub">Choose a person first: tap their name on the week.</p></div>'; return; }
    var act = Number(p.is_active) !== 0, loc = low(p.designation) === "locum", n = first(p.full_name);
    mount.innerHTML = '<div class="rps"><form data-f="person" novalidate autocomplete="off"><div class="rps-card">' +
      '<div class="rps-row"><label class="n" for="rps-pn">Name</label><input type="text" class="w" id="rps-pn" name="full_name" value="' + esc(p.full_name || "") + '" autocapitalize="words"></div>' +
      '<div class="rps-row"><label class="n" for="rps-pd">Role</label><select class="w" id="rps-pd" name="designation">' + Object.keys(DESIG).map(function (k) { return '<option value="' + k + '"' + (low(p.designation) === k ? " selected" : "") + ">" + DESIG[k] + "</option>"; }).join("") + "</select></div>" +
      '<div class="rps-row" data-k="type"' + (loc ? " hidden" : "") + '><label class="n" for="rps-pt">Works</label><select class="w" id="rps-pt" name="employment_type"><option value="fulltime"' + (low(p.employment_type) !== "parttime" ? " selected" : "") + '>Full time</option><option value="parttime"' + (low(p.employment_type) === "parttime" ? " selected" : "") + ">Part time</option></select></div>" +
      '<div class="rps-row" data-k="ext"' + (loc ? "" : " hidden") + '><span class="n">Works</span><span class="v">Self-employed (locum)</span></div>' +
      '<div class="rps-row"><label class="n" for="rps-ph">Contracted hours a week</label><input type="number" id="rps-ph" name="contracted_hours" min="1" max="48" step="0.5" inputmode="decimal" value="' + esc(p.contracted_hours || 40) + '"></div>' +
      '<div class="rps-row"><label class="n" for="rps-pe">E-mail</label><input type="email" class="w" id="rps-pe" name="email" value="' + esc(p.email || "") + '" inputmode="email" autocapitalize="off" spellcheck="false"></div>' +
      '<div class="rps-row"><label class="n" for="rps-pp">Phone</label><input type="tel" class="w" id="rps-pp" name="phone" value="' + esc(p.phone || "") + '" inputmode="tel"></div>' +
      '<div class="rps-row"><label class="n" for="rps-pr">Registration number<small>Pharmacists</small></label><input type="text" class="w" id="rps-pr" name="registration_number" value="' + esc(p.registration_number || "") + '" placeholder="e.g. PH-1234"></div></div>' +
      '<div class="rps-acts"><button type="submit" class="rps-btn p">Save details</button></div><p class="rps-msg" role="status"></p></form>' +
      "<h3>" + (act ? "Leaving the pharmacy" : "Not on the rota") + "</h3>" +
      '<p class="sub">' + (act ? "Deactivate keeps " + esc(n) + "'s shifts and leave in the history and takes them off the planner. Delete removes everything." : esc(n) + " is not on the planner. Their shifts and leave are kept.") + "</p>" +
      '<div class="rps-acts" style="justify-content:flex-start"><button type="button" class="rps-btn" data-act="active">' + (act ? "Deactivate" : "Put back on the rota") + '</button><button type="button" class="rps-btn d" data-act="del">Delete…</button></div><div data-k="del"></div><p class="rps-msg" data-k="amsg" role="status"></p></div>';
    var f = mount.querySelector("form"), msg = f.querySelector(".rps-msg"), amsg = mount.querySelector("[data-k=amsg]");
    var val = function () { var o = {}; ["full_name", "designation", "employment_type", "contracted_hours", "email", "phone", "registration_number"].forEach(function (k) { o[k] = String(f.querySelector("[name=" + k + "]").value || "").trim(); }); return o; };
    f.querySelector("[name=designation]").onchange = function () { var l = this.value === "locum"; f.querySelector("[data-k=type]").hidden = l; f.querySelector("[data-k=ext]").hidden = !l; };
    f.onsubmit = async function (ev) {
      ev.preventDefault(); var v = val(), bad = [], words = [], ch = parseFloat(v.contracted_hours);
      if (!v.full_name) { bad.push("full_name"); words.push("Write the person's name."); }
      if (!(ch >= 1 && ch <= 48)) { bad.push("contracted_hours"); words.push("Contracted hours: 1 to 48 a week."); }
      if (v.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v.email)) { bad.push("email"); words.push("Check the e-mail address."); }
      if (bad.length) { mark(f, bad); return say(msg, words.join(" "), true); }
      mark(f, []); var btn = f.querySelector("[type=submit]"); busy(btn, true);
      try { var b = await putPerson(p.id, function (cur) { return body(cur, v); }); Object.assign(p, b); busy(btn, false); say(msg, "Saved."); ctx.onSaved && ctx.onSaved("person", Object.assign({ id: p.id }, b)); changed("person"); }
      catch (x) { busy(btn, false); say(msg, failText(x), true); }
    };
    mount.querySelector("[data-act=active]").onclick = async function () {
      var btn = this; busy(btn, true);
      try { var b = await putPerson(p.id, function (cur) { return body(cur, { full_name: cur.full_name, designation: low(cur.designation) || "other", employment_type: cur.employment_type || "fulltime", contracted_hours: cur.contracted_hours, email: cur.email || "", phone: cur.phone || "", registration_number: cur.registration_number || "", is_active: act ? 0 : 1 }); });
        Object.assign(p, b); ctx.onSaved && ctx.onSaved("person", Object.assign({ id: p.id }, b)); changed("person"); await personUi(mount, p, ctx); say(mount.querySelector("[data-k=amsg]"), b.is_active ? n + " is back on the rota." : n + " is off the planner. Shifts and leave are kept."); }
      catch (x) { busy(btn, false); say(amsg, failText(x), true); }
    };
    mount.querySelector("[data-act=del]").onclick = async function () {
      var box = mount.querySelector("[data-k=del]"), btn = this; busy(btn, true, "Counting…");
      var cnt = null; try { var r = await E.apiFetch("/shifts/assignments-range?from=2000-01-01&to=2099-12-31&staff_id=" + encodeURIComponent(p.id), { method: "GET" }); if (r && r.ok) cnt = (r.shifts || []).length; } catch (e) {}
      busy(btn, false); btn.hidden = true;
      var nl = (ctx.leaves || []).filter(function (l) { return String(l.staff_id) === String(p.id); }).length;
      box.innerHTML = '<div class="rps-warn" role="alert"><b>Delete ' + esc(p.full_name) + "?</b> This removes them" + (cnt == null ? ", all their shifts" : cnt ? ", their " + (cnt === 1 ? "1 shift" : cnt + " shifts") : " (no shifts)") + " and all their leave records" + (nl ? " (" + nl + " loaded here)" : "") + ". This cannot be undone." + (act ? " Deactivate keeps the history." : "") + "</div>" +
        '<div class="rps-acts">' + '<button type="button" class="rps-btn" data-act="del-no">Keep ' + esc(n) + "</button>" + (act ? '<button type="button" class="rps-btn" data-act="del-off">Deactivate instead</button>' : "") + '<button type="button" class="rps-btn d" data-act="del-yes">Delete for good</button></div>';
      try { box.querySelector("[data-act=del-no]").focus(); } catch (e) {}
      box.querySelector("[data-act=del-no]").onclick = function () { box.innerHTML = ""; btn.hidden = false; try { btn.focus(); } catch (e) {} };
      var off = box.querySelector("[data-act=del-off]"); if (off) off.onclick = function () { box.innerHTML = ""; btn.hidden = false; mount.querySelector("[data-act=active]").click(); };
      box.querySelector("[data-act=del-yes]").onclick = async function () {
        var y = this; busy(y, true, "Deleting…");
        try { var r2 = await E.apiFetch("/shifts/staff/" + p.id, { method: "DELETE" }); if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Not deleted");
          mount.innerHTML = '<div class="rps"><p class="rps-msg ok" role="status">' + esc(p.full_name) + " was deleted.</p></div>"; ctx.onSaved && ctx.onSaved("deleted", p.id); changed("person"); }
        catch (x) { busy(y, false); say(amsg, failText(x).replace(/^Not saved/, "Not deleted"), true); }
      };
    };
  }

  // ---- leave meets the rota: what to read, and trimming shifts when part-day leave is approved -----------------------
  // The years of leave to read for a range: every year it touches, and the year before when it starts in January (a
  // leave is filed under the year it starts in, so 28 Dec – 3 Jan is only in the December year's list; D-7).
  function leaveYears(from, to) {
    var a = Number(String(from).slice(0, 4)), z = Number(String(to || from).slice(0, 4)), out = [];
    if (String(from).slice(5, 7) === "01") out.push(a - 1);
    for (var y = a; y <= z; y++) out.push(y);
    return out;
  }
  // Approving leave: the person's shifts it touches. Whole-day leave removes them; part-day leave trims each shift to the
  // part outside the leave when that part is at least an hour (both parts kept when the leave falls in the middle: the
  // first by changing the shift, the second as a new shift), else removes it. -> { changes: [{ shift, put, post, remove,
  // words }], words }. Nothing is sent; applyLeaveTrim(plan) sends the classic bodies (PUT whole record, POST, DELETE).
  function leaveTrim(l, shifts) {
    var p = [], n = 0, sid = String(l && l.staff_id);
    (shifts || []).forEach(function (x) {
      if (String(x.staff_id) !== sid) return;
      var ls = E.rotaCheck.leaveSpan(l, x.shift_date); if (!ls) return;
      var s0 = mn(x.start_time), e0 = mn(x.end_time); if (!(ls[0] < e0 && ls[1] > s0)) return;
      var tm = function (m) { return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
      var before = ls[0] - s0 >= 60 ? [s0, ls[0]] : null, after = e0 - ls[1] >= 60 ? [ls[1], e0] : null, was = dayW(x.shift_date) + " " + hm(x.start_time) + "–" + hm(x.end_time), c = { shift: x };
      var whole = function (r) { return { id: x.id, staff_id: x.staff_id, shift_date: x.shift_date, start_time: tm(r[0]), end_time: tm(r[1]), role_override: x.role_override || "", notes: x.notes || "" }; };
      if (!before && !after) { c.remove = true; c.words = was + " goes"; }
      else { var keep = before || after; c.put = whole(keep); c.words = was + " becomes " + tm(keep[0]) + "–" + tm(keep[1]); if (before && after) { c.post = { staff_id: x.staff_id, shift_date: x.shift_date, start_time: tm(after[0]), end_time: tm(after[1]), notes: x.notes || "" }; c.words += " and " + tm(after[0]) + "–" + tm(after[1]); } }
      p.push(c); n++;
    });
    return { changes: p, words: n ? p.map(function (c) { return c.words; }).join("; ") : "" };
  }
  async function applyLeaveTrim(plan) {
    var done = 0, failed = [];
    for (var i = 0; i < ((plan && plan.changes) || []).length; i++) {
      var c = plan.changes[i];
      try {
        if (c.remove) { var r0 = await E.apiFetch("/shifts/assignments/" + c.shift.id, { method: "DELETE" }); if (!r0 || !r0.ok) throw new Error((r0 && r0.error) || "Not saved"); }
        if (c.put) { var r1 = await E.apiFetch("/shifts/assignments/" + c.shift.id, { method: "PUT", body: JSON.stringify(c.put) }); if (!r1 || !r1.ok) throw new Error((r1 && r1.error) || "Not saved"); }
        if (c.post) { var r2 = E.postOnce ? await E.postOnce("/shifts/assignments", c.post, { list: async function () { var g = await E.apiFetch("/shifts/assignments-range?from=" + c.post.shift_date + "&to=" + c.post.shift_date, { method: "GET" }); return (g && g.shifts) || []; }, same: function (y) { return String(y.staff_id) === String(c.post.staff_id) && hm(y.start_time) === c.post.start_time && hm(y.end_time) === c.post.end_time; } }) : await E.apiFetch("/shifts/assignments", { method: "POST", body: JSON.stringify(c.post) }); if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Not saved"); }
        done++;
      } catch (x) { failed.push({ change: c, words: failText(x) }); }
    }
    if (done) changed("shifts");
    return { done: done, failed: failed };
  }

  // ---- a sheet around any of them ----------------------------------------------------------------------------------
  var TITLE = { hours: "Opening hours", day: "This day", rules: "Rules", avail: "When can't they work?", leave: "Leave", person: "Edit details" };
  var UI = { hours: hoursUi, day: dayUi, rules: rulesUi, avail: availUi, leave: leaveUi, person: personUi };
  var drafts = {}; // what was typed in a sheet closed without saving, put back when it opens again
  function draftKey(kind, arg) { return kind + "|" + (arg && typeof arg === "object" ? arg.id : arg == null ? "" : arg); }
  function open(kind, arg, ctx) {
    if (!UI[kind]) return null; css(); ctx = Object.assign({}, ctx || {});
    var back = document.activeElement, ov = document.createElement("div"); ov.className = "rps-ov"; ov.setAttribute("data-rotaset", kind);
    var t = TITLE[kind]; if (kind === "avail" && arg) t = "When can't " + first(arg.full_name) + " work?"; else if ((kind === "leave" || kind === "person") && arg) t = (kind === "leave" ? "Leave · " : "Edit details · ") + (arg.full_name || ""); else if (kind === "day" && arg) t = dayW(arg, true);
    ov.innerHTML = '<div class="rps-sheet" role="dialog" aria-modal="true" aria-labelledby="rps-h"><div class="rps-top"><h2 id="rps-h" tabindex="-1">' + esc(t) + '</h2><button type="button" class="rps-x" data-act="close">Done</button></div><div class="rps-body"></div></div>';
    document.body.appendChild(ov);
    var box = ov.querySelector(".rps-sheet"), mount = ov.querySelector(".rps-body"), dk = draftKey(kind, arg), closed = false;
    function keep() { var d = {}, any = false; Array.prototype.forEach.call(mount.querySelectorAll("input[name],select[name]"), function (el) { if (el.type === "radio" || el.type === "checkbox" ? el.checked !== el.defaultChecked : el.tagName === "SELECT" ? !el.options[el.selectedIndex] || !el.options[el.selectedIndex].defaultSelected : el.value !== el.defaultValue) any = true; d[el.name + (el.type === "radio" ? "=" + el.value : "")] = el.type === "radio" || el.type === "checkbox" ? el.checked : el.value; }); if (any) drafts[dk] = d; else delete drafts[dk]; }
    function close() { if (closed) return; closed = true; keep(); document.removeEventListener("keydown", onKey, true); ov.remove(); try { if (back && back.isConnected) back.focus(); } catch (e) {} if (ctx.onClose) try { ctx.onClose(); } catch (e) {} }
    function onKey(ev) {
      if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
      if (ev.key === "Tab") {
        var f = Array.prototype.filter.call(box.querySelectorAll("button,a[href],input,select,textarea,summary,[tabindex='0']"), function (x) { return !x.disabled && x.offsetParent !== null; });
        if (!f.length) return; var a = document.activeElement;
        if (ev.shiftKey && (a === f[0] || !box.contains(a))) { ev.preventDefault(); f[f.length - 1].focus(); } else if (!ev.shiftKey && a === f[f.length - 1]) { ev.preventDefault(); f[0].focus(); }
      }
    }
    document.addEventListener("keydown", onKey, true);
    ov.addEventListener("mousedown", function (ev) { if (ev.target === ov) close(); });
    ov.querySelector("[data-act=close]").onclick = close;
    var saved = ctx.onSaved; ctx.onSaved = function (k, v) { delete drafts[dk]; if (saved) try { saved(k, v); } catch (e) {} };
    ctx.close = close;
    if (!ctx.open) ctx.open = function (k, a) { if (k === "answer") return; close(); open(k, a, ctx); };
    Promise.resolve(UI[kind](mount, arg, ctx)).then(function () {
      var d = drafts[dk]; if (d) Object.keys(d).forEach(function (k) { var m = /^(.*)=(.*)$/.exec(k), el = m ? mount.querySelector('[name="' + m[1] + '"][value="' + m[2] + '"]') : mount.querySelector('[name="' + k + '"]'); if (!el) return; if (el.type === "radio" || el.type === "checkbox") { el.checked = d[k]; el.dispatchEvent(new Event("change")); } else { el.value = d[k]; if (el.tagName === "SELECT") el.dispatchEvent(new Event("change")); } });
    });
    E.focusSoon ? E.focusSoon(function () { return box.querySelector("#rps-h"); }) : box.querySelector("#rps-h").focus();
    return { close: close, el: ov };
  }

  // The Phase 0 contract names (BOARD): ui.availability / leave / details / hours / rules (mount, ctx) -> { close() },
  // ctx = { person, date, onSaved, onGone, staff, leaves, open }. hours with ctx.date is the one day ("Open this day…").
  var wrap = function (fn, argOf) { return function (mount, ctx) { ctx = ctx || {}; var c = Object.assign({}, ctx); if (ctx.onGone) c.onSaved = function (k, v) { if (k === "deleted") ctx.onGone(v); if (ctx.onSaved) ctx.onSaved(k, v); }; fn(mount, argOf(ctx), c); return { close: function () { if (c.close) c.close(); else mount.innerHTML = ""; } }; }; };
  var UI2 = {
    availability: wrap(availUi, function (c) { return c.person; }), leave: wrap(leaveUi, function (c) { return c.person || null; }), details: wrap(personUi, function (c) { return c.person; }),
    hours: function (mount, ctx) { return ctx && ctx.date ? wrap(dayUi, function (c) { return c.date; })(mount, ctx) : wrap(hoursUi, function () { return null; })(mount, ctx); },
    rules: wrap(rulesUi, function () { return null; })
  };
  Object.keys(UI).forEach(function (k) { if (!UI2[k]) UI2[k] = UI[k]; }); // and the (mount, arg, ctx) forms: avail, person, day
  ["availability", "details"].forEach(function (k) { TITLE[k] = TITLE[k === "availability" ? "avail" : "person"]; });
  E.rotaSet = { ui: UI2, open: function (kind, arg, ctx) { return open({ availability: "avail", details: "person" }[kind] || kind, arg, ctx); }, balance: balance, entitlement: entitlement, malta: malta, maltaLine: maltaLine, availSummary: function (rota, p) { return availSummary(availOf(rota, p && p.id), p); }, personBody: body, leaveYears: leaveYears, leaveTrim: leaveTrim, applyLeaveTrim: applyLeaveTrim };
})();
