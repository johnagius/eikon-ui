/* Repeat prescriptions, new layout: the ones still valid (soonest to expire first), the ones that ran out in the last
   month, a search, and one form to record a prescription (expiry is set by the server, six months on). Renew opens the
   form filled with the same patient, medicine and prescriber. A known ID card fills the name; a known prescriber fills
   the reg no (only empty fields). Correct (the pharmacist only, eikon.correct.js) is on the lines of "Written by
   month" (the register itself; a line shows once there): read again, the classic edit's eight fields (the expiry does
   not move by itself, as in the classic), a required reason, the whole line sent (the update replaces every column).
   A line is never deleted here. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", q: "", adding: null, saving: false, err: "", bad: {}, mo: "", moEntries: [], moLoading: false, moError: "", view: "all", undo: {} };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var FIX = { entity: "repeat_prescription_entries", action: "REPEAT_RX_ENTRY_UPDATE",
    fields: [{ k: "entry_date", label: "Written", type: "date", req: true, what: "the day it was written" }, { k: "expires_date", label: "Expires", type: "date", req: true, what: "the expiry date", hint: "Not moved by itself" },
      { k: "client_name", label: "Patient", req: true, what: "the patient's name" }, { k: "client_id", label: "ID card", req: true, what: "the ID card" },
      { k: "medicine_name_dose", label: "Medicine", req: true, what: "the medicine" }, { k: "posology", label: "Dose", req: true, what: "the dose" },
      { k: "prescriber_name", label: "Prescriber", req: true, what: "the prescriber" }, { k: "prescriber_reg_no", label: "Reg no.", req: true, what: "the prescriber's reg no." }],
    rows: function () { return S.moEntries; },
    reread: async function (row) {
      var months = [String(row.entry_date || "").slice(0, 7), S.mo].filter(function (x, i, a) { return /^\d{4}-\d{2}$/.test(x) && a.indexOf(x) === i; });
      for (var i = 0; i < months.length; i++) {
        var r = await E.apiFetch("/repeat-prescriptions/entries?month=" + encodeURIComponent(months[i]), { method: "GET" });
        var hit = ((r && r.entries) || []).filter(function (e) { return String(e.id) === String(row.id); })[0];
        if (hit) return hit;
      }
      return null;
    },
    put: function (row) { return "/repeat-prescriptions/entries/" + encodeURIComponent(String(row.id)); },
    body: function (r) { var b = {}; ["entry_date", "expires_date", "client_name", "client_id", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no"].forEach(function (k) { b[k] = String(r[k] == null ? "" : r[k]).trim(); }); return b; },
    check: function (r) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.entry_date)) || String(r.entry_date) > today()) return "Choose the day it was written (not a day ahead).";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.expires_date)) || String(r.expires_date) < String(r.entry_date)) return "The expiry should be a date after the day it was written.";
      return "";
    },
    paint: function () { paint(true); }, idle: function () { E.whenFormIdle(S.mount, function () { paint(); }); }, done: function () { return Promise.all([load(), loadMonth()]); } };
  var F = ["entry_date", "client_id", "client_name", "medicine_name_dose", "posology", "prescriber_name", "prescriber_reg_no", "collect_every_days"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function back(days) { var d = new Date(); d.setDate(d.getDate() - days); return ymd(d); }
  function daysUntil(s) { var p = String(s).split("-"), t = new Date(); return Math.round((new Date(+p[0], +p[1] - 1, +p[2]) - new Date(t.getFullYear(), t.getMonth(), t.getDate())) / 86400000); }
  // The year is left out when it is this year (3 Nov), kept otherwise (4 Mar 2027): rows stay on fewer lines on a phone.
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === new Date().getFullYear() ? "" : " " + p[0]) : ""; }
  function low(s) { return String(s || "").toLowerCase(); }
  // Wide screens get a table (the classic's columns); phones and narrow windows keep the two-line list.
  var WIDE = "(min-width:1200px)", mqWide = null;
  function wide() { try { return window.matchMedia(WIDE).matches; } catch (e) { return false; } }
  function watchWidth() {
    if (mqWide) return;
    try { mqWide = window.matchMedia(WIDE); var f = function () { if (S.mount && E.state.activeModuleId === "repreg") E.whenFormIdle(S.mount, function () { paint(); }); };
      if (mqWide.addEventListener) mqWide.addEventListener("change", f); else if (mqWide.addListener) mqWide.addListener(f); } catch (e) {}
  }

  function css() {
    if (document.getElementById("eikon-repreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-repreg-css";
    st.textContent =
      ".rep{max-width:880px;margin:0 auto}" +
      ".rep-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".rep-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".rep h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.rep-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".rep-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".rep-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.rep-btn:disabled{opacity:.55;cursor:default}" +
      ".rep-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".rep-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.rep-lab b{color:var(--text)}" +
      ".rep-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".rep-row{display:flex;gap:12px;align-items:center;padding:11px 16px;border-top:.5px solid var(--border)}.rep-row:first-child{border-top:0}" +
      ".rep-row .t{flex:1;min-width:0}.rep-row b{font-size:15px;font-weight:600}.rep-row .m{font-size:14px;margin-top:2px}.rep-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}" +
      ".rep-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}.rep-pill.soon{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.rep-pill.gone{background:rgba(215,38,28,.12);color:var(--danger)}" +
      ".rep-row .a{display:flex;flex-direction:column;align-items:flex-end;gap:6px}" +
      ".rep-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".rep-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.rep-form label:first-child{border-top:0}" +
      ".rep-form label>span{flex:0 0 104px;font-size:15px}.rep-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.rep-form label small{color:var(--accent);font-size:12px;font-weight:600}" +
      ".rep-form .note{font-size:13px;color:var(--muted);padding:8px 14px 0}.rep-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".rep-err{color:var(--danger);font-size:13px;padding:4px 14px}.rep-err:empty{padding:0}.rep-form label.miss>span{color:var(--danger)}.rep-form label.miss:focus-within>span{color:inherit}" +
      ".rep-h2{font-size:20px;font-weight:700;letter-spacing:-.01em;margin:28px 0 0}" +
      ".rep-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (min-width:1200px){.rep{max-width:1180px}}" +
      ".rep-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}.rep-tbl{width:100%;border-collapse:separate;border-spacing:0;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;font-size:13.5px}" +
      ".rep-tbl th{font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 12px;border-bottom:1px solid var(--border);white-space:nowrap}" +
      ".rep-tbl td{padding:8px 12px;border-top:.5px solid var(--border);vertical-align:middle}.rep-tbl tbody tr:first-child td{border-top:0}.rep-tbl td.n{white-space:nowrap;font-variant-numeric:tabular-nums}.rep-tbl td.b{font-weight:600}.rep-tbl td.r{text-align:right;white-space:nowrap}.rep-tbl td.r .rep-btn{margin-left:8px}" +
      ".rep-every{display:flex;flex-wrap:wrap;gap:6px;padding:0 14px 8px 130px}.rep-every button{font:inherit;font-size:13px;font-weight:600;height:30px;min-width:40px;padding:0 10px;border-radius:15px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer}.rep-every button[aria-pressed=true]{background:rgba(10,143,106,.16);border-color:var(--accent);color:var(--text);box-shadow:inset 0 0 0 1px var(--accent)}" +
      ".rep-due{color:var(--text);font-weight:600}.rep-due.late{color:var(--danger)}.rep-view{display:inline-flex;gap:4px;margin-left:auto;text-transform:none;letter-spacing:0}.rep-view button{font:inherit;font-size:12.5px;font-weight:600;height:28px;padding:0 12px;border-radius:14px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}.rep-view button[aria-pressed=true]{background:rgba(10,143,106,.16);border-color:var(--accent);color:var(--text);box-shadow:inset 0 0 0 1px var(--accent)}" +
      "@media (max-width:600px){.rep-every{padding-left:14px}}" +
      "@media (max-width:600px){.rep{padding:4px 16px 0}.rep h1{font-size:32px}.rep-form label>span{flex-basis:92px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { // a year back covers every prescription still valid (six months) and the ones just run out
      var r = await E.apiFetch("/repeat-prescriptions/entries?from=" + back(366) + "&to=" + today(), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load repeat prescriptions");
      S.entries = r.entries || [];
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load repeat prescriptions"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function key(e) { return low(e.client_id).replace(/\s+/g, "") + "|" + low(e.medicine_name_dose).replace(/\s+/g, " ").trim(); }
  function renewedBy(e) { // a later prescription for the same patient and medicine
    return S.entries.filter(function (x) { return x.id !== e.id && key(x) === key(e) && (x.entry_date > e.entry_date || (x.entry_date === e.entry_date && x.id > e.id)); })[0] || null;
  }
  // Repeats coming due (backlog 3 item 7; the rules are in eikon.repeatdue.js): "Next due 12 Nov" and "Collected today".
  function dueText(e, block) {
    var RD = E.repeatDue; if (!RD || !RD.every(e) || e.expires_date < today()) return "";
    var st = RD.status(e, RD.today(), S.entries), late = st.kind === "overdue", t = e.last_collected_date === RD.today() ? "Collected today" : "Next due " + dm(st.next) + (late ? " (overdue)" : "");
    return (block ? '<span style="display:block;margin-top:4px;font-size:12.5px" class="rep-due' : ' · <span style="display:inline" class="rep-due') + (late ? " late" : "") + '">' + esc(t) + "</span>";
  }
  function collectBtn(e) {
    if (!E.repeatDue || !E.repeatDue.every(e) || e.expires_date < today()) return "";
    if (e.last_collected_date === E.repeatDue.today()) return Object.prototype.hasOwnProperty.call(S.undo, e.id) ? '<button class="rep-btn" data-act="uncollect" data-id="' + e.id + '" aria-label="Undo collected today for ' + esc(e.client_name) + '">Undo</button>' : "";
    return '<button class="rep-btn" data-act="collected" data-id="' + e.id + '" aria-label="Collected today: ' + esc(e.client_name) + ", " + esc(e.medicine_name_dose) + '">Collected today</button>';
  }
  async function collected(id, undo) {
    var e = S.entries.find(function (x) { return x.id === id; }); if (!e) return;
    var body = undo ? { date: S.undo[id] || "" } : {};
    try {
      var r = await E.apiFetch("/repeat-prescriptions/entries/" + id + "/collected", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not save");
      if (undo) delete S.undo[id]; else S.undo[id] = r.previous || "";
      e.last_collected_date = r.last_collected_date || null;
      S.moEntries.forEach(function (x) { if (x.id === id) x.last_collected_date = e.last_collected_date; });
      E.toast(undo ? "Collection undone for " + e.client_name : "Collected today: " + e.client_name, "success");
    } catch (x) { E.toast(E.saveFailText ? E.saveFailText(x) : String(x && x.message || x), "error"); }
    paint();
    var b = S.mount && S.mount.querySelector('[data-act=' + (undo ? "collected" : "uncollect") + '][data-id="' + id + '"]'); if (b) b.focus(); // the line keeps the focus
  }
  function dueHtml(list) { // the "Due" view: due (overdue first) and running out, by the rules in eikon.repeatdue.js
    var RD = E.repeatDue; if (!RD) return '<div class="rep-quiet">Due dates are not available yet.</div>';
    var b = RD.buckets(list, RD.today()), one = function (x) { return x.s.kind === "runout" ? rowHtml(x.e) : rowHtml(x.e).replace('<div class="a">', '<div class="a"><span class="rep-pill ' + (x.s.kind === "overdue" ? "gone" : "soon") + '">' + esc(RD.words(x.s)) + "</span>"); };
    return '<div class="rep-lab">Due for collection <b>' + b.due.length + "</b></div>" + (b.due.length ? '<div class="rep-list">' + b.due.map(one).join("") + "</div>" : '<div class="rep-quiet">Nothing due in the next ' + RD.RULES.DUE_WITHIN_DAYS + ' days. Only prescriptions with "Collected every … days" have a due date.</div>') +
      (RD.RULES.SHOW_RUNNING_OUT ? '<div class="rep-lab">Running out in ' + RD.RULES.RUN_OUT_WITHIN_DAYS + " days <b>" + b.runout.length + "</b></div>" + (b.runout.length ? '<div class="rep-list">' + b.runout.map(one).join("") + "</div>" : '<div class="rep-quiet">None runs out soon.</div>') : "");
  }
  // fix: the line of "Written by month" (the register), which can be corrected
  function rowHtml(e, fix) {
    var n = daysUntil(e.expires_date), nx = renewedBy(e);
    var mark = fix ? E.correct.mark("repreg", e) : "", cor = fix ? E.correct.button("repreg", e, e.medicine_name_dose + " for " + e.client_name + ", written " + dm(e.entry_date)) : "", pan = fix ? E.correct.panel("repreg", e, FIX) : "";
    var t = '<div class="t"><b>' + esc(e.client_name) + '</b><div class="m">' + esc(e.medicine_name_dose) + " · " + esc(e.posology) + "</div><span>" + esc(e.client_id) + " · " + esc(e.prescriber_name) + " · written " + esc(dm(e.entry_date)) + "</span>" + mark + "</div>";
    if (nx) return '<div class="rep-row">' + t + '<div class="a"><span class="rep-pill">Renewed ' + esc(dm(nx.entry_date)) + "</span>" + cor + "</div></div>" + pan;
    var pill = n < 0 ? '<span class="rep-pill gone">Expired ' + esc(dm(e.expires_date)) + "</span>" : n <= 21 ? '<span class="rep-pill soon">Expires in ' + n + (n === 1 ? " day" : " days") + "</span>" : '<span class="rep-pill">Until ' + esc(dm(e.expires_date)) + "</span>";
    return '<div class="rep-row">' + t.replace("</span>" + mark, dueText(e) + "</span>" + mark) + '<div class="a">' + pill +
      (fix ? cor : '<button class="rep-btn" data-act="renew" data-id="' + e.id + '">Renew</button>') + collectBtn(e) + "</div></div>" + pan;
  }

  function pillHtml(e) {
    var n = daysUntil(e.expires_date), nx = renewedBy(e);
    if (nx) return '<span class="rep-pill">Renewed ' + esc(dm(nx.entry_date)) + "</span>";
    return n < 0 ? '<span class="rep-pill gone">Expired ' + esc(dm(e.expires_date)) + "</span>" : n <= 21 ? '<span class="rep-pill soon">Expires in ' + n + (n === 1 ? " day" : " days") + "</span>" : '<span class="rep-pill">Until ' + esc(dm(e.expires_date)) + "</span>";
  }
  function tableHtml(rows) {
    return '<table class="rep-tbl"><thead><tr><th scope="col">Patient</th><th scope="col">ID card</th><th scope="col">Medicine</th><th scope="col">Dose</th><th scope="col">Prescriber</th><th scope="col">Written</th><th scope="col"><span class="rep-sr">Status</span></th></tr></thead><tbody>' +
      rows.map(function (e) {
        return '<tr><td class="b">' + esc(e.client_name) + '</td><td class="n">' + esc(e.client_id) + "</td><td>" + esc(e.medicine_name_dose) + "</td><td>" + esc(e.posology) + "</td><td>" + esc(e.prescriber_name) + '</td><td class="n">' + esc(dm(e.entry_date)) + '</td><td class="r">' + pillHtml(e) +
          (renewedBy(e) ? "" : '<button class="rep-btn" data-act="renew" data-id="' + e.id + '">Renew</button>' + collectBtn(e)) + (renewedBy(e) ? "" : dueText(e, true)) + "</td></tr>";
      }).join("") + "</tbody></table>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "repreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var qi = m.querySelector("#rep-q"); if (qi) S.q = qi.value;
    var h = '<div class="rep"><button class="rep-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("repreg") : "‹ Registers") + "</button>" +
      '<div class="rep-top"><div><h1>Repeat prescriptions</h1><p class="rep-sub">Prescriptions on file, and when each one runs out.</p></div>' + (S.adding ? "" : '<button class="rep-btn p" data-act="add">New prescription</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, bad = S.bad || {}, fld = function (k, label, extra, hint) { return "<label" + (bad[k] ? ' class="miss"' : "") + "><span>" + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + (bad[k] ? ' aria-invalid="true"' : "") + ">" + (hint || "") + "</label>"; };
      h += '<form class="rep-form" id="rep-add" autocomplete="off">' + fld("entry_date", "Written", ' type="date" max="' + esc(today()) + '"') + fld("client_id", "ID card", ' placeholder="e.g. 123456M" autocapitalize="characters"', a.known ? "<small>Known</small>" : "") +
        fld("client_name", "Patient", ' placeholder="Name and surname"') + fld("medicine_name_dose", "Medicine", ' placeholder="e.g. Atorvastatin 20mg"') + fld("posology", "Dose", ' placeholder="e.g. 1 at night"') +
        fld("prescriber_name", "Prescriber", ' list="rep-docs" placeholder="Dr name"') + fld("prescriber_reg_no", "Reg no.", ' inputmode="numeric"') +
        (E.repeatDue ? fld("collect_every_days", "Collected every", ' inputmode="numeric" placeholder="days (leave empty if not regular)" aria-describedby="rep-every-h"') +
          '<div class="rep-every" role="group" aria-label="Collected every … days">' + E.repeatDue.RULES.INTERVAL_CHIPS.map(function (n) { return '<button type="button" data-every="' + n + '" aria-pressed="' + (String(a.collect_every_days || "") === String(n)) + '">' + n + "</button>"; }).join("") + "</div>" : "") +
        '<div class="note" id="rep-every-h">Valid for six months from the day it was written.' + (E.repeatDue ? " With “Collected every”, the line shows when it is next due." : "") + "</div>" + '<div class="rep-err" role="alert">' + esc(S.err) + "</div>" +
        '<div class="acts"><button type="button" class="rep-btn" data-act="add-cancel">Cancel</button><button type="submit" class="rep-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save prescription") + "</button></div>" +
        '<datalist id="rep-docs">' + uniq(S.entries.map(function (e) { return e.prescriber_name; })).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    }
    if (S.loading && !S.entries.length) h += '<div class="rep-quiet">Opening repeat prescriptions…</div>';
    else if (S.error) h += '<div class="rep-quiet">' + esc(S.error) + "</div>";
    else {
      h += '<input class="rep-q" id="rep-q" type="search" aria-label="Search repeat prescriptions" placeholder="Search patient, ID card or medicine" value="' + esc(S.q) + '">';
      var q = low(S.q).trim(), match = function (e) { return !q || [e.client_name, e.client_id, e.medicine_name_dose, e.prescriber_name].some(function (v) { return low(v).indexOf(q) >= 0; }); };
      var t = today(), list = S.entries.filter(match);
      var valid = list.filter(function (e) { return e.expires_date >= t; }).sort(function (x, y) { return (renewedBy(x) ? 1 : 0) - (renewedBy(y) ? 1 : 0) || String(x.expires_date).localeCompare(String(y.expires_date)); }); // already renewed: after the ones still to watch
      var gone = list.filter(function (e) { return e.expires_date < t && e.expires_date >= back(30) && !renewedBy(e); }).sort(function (x, y) { return String(y.expires_date).localeCompare(String(x.expires_date)); });
      var W = wide(), block = function (rows) { return W ? tableHtml(rows) : '<div class="rep-list">' + rows.map(rowHtml).join("") + "</div>"; };
      var tog = E.repeatDue ? '<span class="rep-view" role="group" aria-label="Show"><button type="button" data-view="all" aria-pressed="' + (S.view !== "due") + '">All</button><button type="button" data-view="due" aria-pressed="' + (S.view === "due") + '">Due</button></span>' : "";
      if (S.view === "due" && E.repeatDue) h += '<div class="rep-lab">Coming due' + tog + "</div>" + dueHtml(list);
      else {
      h += '<div class="rep-lab">Still valid <b>' + valid.length + "</b>" + tog + "</div>" + (valid.length ? block(valid) : '<div class="rep-quiet">' + (q ? "No valid prescription matches." : "No repeat prescription on file.") + "</div>");
      if (gone.length) h += '<div class="rep-lab">Ran out this month <b>' + gone.length + "</b></div>" + block(gone);
      }
    }
    // Every prescription written in a month, any month: the register as the classic screen lists and prints it.
    var mo = S.moEntries.filter(function (e) { var q2 = low(S.q).trim(); return !q2 || [e.client_name, e.client_id, e.medicine_name_dose, e.prescriber_name].some(function (v) { return low(v).indexOf(q2) >= 0; }); });
    h += '<h2 class="rep-h2" id="rep-bymonth">Written by month</h2>' + E.months.bar(S.mo, { label: "Repeat prescriptions written" }) +
      (S.moLoading && !S.moEntries.length ? '<div class="rep-quiet">Opening ' + esc(E.months.label(S.mo)) + "…</div>" : S.moError ? '<div class="rep-quiet">' + esc(S.moError) + "</div>" :
        '<div class="rep-lab">Written in ' + esc(E.months.label(S.mo)) + " <b>" + mo.length + "</b></div>" + (mo.length ? '<div class="rep-list">' + mo.map(function (e) { return rowHtml(e, true); }).join("") + "</div>" : '<div class="rep-quiet" data-empty>' + (S.moEntries.length ? "No prescription that month matches." : esc(E.months.empty(S.mo))) + "</div>"));
    h += E.correct.foot(E.correct.can() ? "Correct is on each line of Written by month." : "") + "</div>";
    var ae = document.activeElement, keepSel = ae && m.contains(ae) && ae.name ? "[name=" + ae.name + "]" : ae && ae.id === "rep-q" ? "#rep-q" : "";
    m.innerHTML = h;
    if (keepSel) { var again = m.querySelector(keepSel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } } // typing keeps its place
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("repreg") : "#registers";
        else if (act === "add") { S.adding = { entry_date: today() }; S.err = ""; S.bad = {}; paint(true); focus("client_id"); }
        else if (act === "renew") { var e = S.entries.find(function (x) { return x.id === Number(b.getAttribute("data-id")); }); if (!e) return; S.adding = { entry_date: today(), client_id: e.client_id, client_name: e.client_name, medicine_name_dose: e.medicine_name_dose, posology: e.posology, prescriber_name: e.prescriber_name, prescriber_reg_no: e.prescriber_reg_no, collect_every_days: e.collect_every_days ? String(e.collect_every_days) : "", known: true }; S.err = ""; paint(true); window.scrollTo({ top: 0, behavior: "smooth" }); focus("entry_date"); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; S.bad = {}; paint(true); var ab = m.querySelector("[data-act=add]"); if (ab) ab.focus(); }
        else if (act === "collected" || act === "uncollect") collected(Number(b.getAttribute("data-id")), act === "uncollect");
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "repreg"); } catch (x) {} E.openClassic("repeatprescriptions"); }
      });
    });
    var qn = m.querySelector("#rep-q"); if (qn) qn.addEventListener("input", function () { paint(); });
    m.querySelectorAll("[data-view]").forEach(function (b) { b.addEventListener("click", function () { S.view = b.getAttribute("data-view"); paint(); var again = S.mount.querySelector('[data-view="' + S.view + '"]'); if (again) again.focus(); }); });
    m.querySelectorAll("[data-every]").forEach(function (b) { b.addEventListener("click", function () { // sets the box only: no redraw under the person's fingers
      var inp = m.querySelector("[name=collect_every_days]"); if (!inp) return; inp.value = b.getAttribute("data-every");
      m.querySelectorAll("[data-every]").forEach(function (o) { o.setAttribute("aria-pressed", String(o === b)); }); }); });
    E.correct.wire(m, "repreg", FIX);
    E.months.wire(m, { month: function () { return S.mo; }, go: function (ym) { S.mo = ym; S.moEntries = []; E.correct.reset("repreg"); loadMonth(); }, paint: function () { paint(); }, print: printMonth });
    var f = m.querySelector("#rep-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      f.addEventListener("input", function (ev) { // a field being put right stops being red
        var el = ev.target; if (!el || el.getAttribute("aria-invalid") !== "true") return;
        el.removeAttribute("aria-invalid"); var lb = el.closest("label"); if (lb) lb.classList.remove("miss"); if (S.bad) delete S.bad[el.name];
      });
      var idIn = f.querySelector("[name=client_id]"); if (idIn) idIn.addEventListener("blur", function () { fillPatient(); });
      var dn = f.querySelector("[name=prescriber_name]"); if (dn) dn.addEventListener("blur", function () { fillPrescriber(); });
      if (E.personPick) E.personPick.attach({ key: "repreg", form: f, fields: { id: "client_id", name: "client_name" }, idValue: function (v) { return String(v || "").replace(/\s+/g, "").toUpperCase(); },
        local: function () { return S.entries.map(function (e) { return { name: e.client_name, id_card: e.client_id, date: e.entry_date, from: "prescription" }; }); },
        onFill: function () { keep(); } });
    }
  }
  async function loadMonth() {
    var want = S.mo; S.moLoading = true; S.moError = ""; paint();
    try {
      var r = await E.apiFetch("/repeat-prescriptions/entries?month=" + encodeURIComponent(want), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the month");
      if (want !== S.mo) return;
      S.moEntries = (r.entries || []).slice().sort(function (a, b) { return String(b.entry_date).localeCompare(String(a.entry_date)) || b.id - a.id; });
      E.correct.loadMarks("repreg", FIX, want + "-01"); // which lines were corrected, by whom and why
    } catch (e) { if (want === S.mo) S.moError = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the month"); }
    if (want !== S.mo) return;
    S.moLoading = false; E.whenFormIdle(S.mount, paint);
  }
  // The classic printout: Date, Expires, Client (with the ID card), Medicine Name & Dose, Posology, Prescriber Name, Reg No; oldest first.
  function printMonth() {
    var MB = E.months;
    MB.print({ register: "Repeat prescriptions", month: S.mo, landscape: true, sections: [{ cols: ["Date", "Expires", "Client", "Medicine name and dose", "Posology", "Prescriber name", "Reg no"],
      rows: S.moEntries.slice().reverse().map(function (e) { return [MB.dmy(e.entry_date), MB.dmy(e.expires_date), { html: "<b>" + esc(e.client_name || "") + "</b><br>ID: " + esc(e.client_id || "") }, e.medicine_name_dose || "", e.posology || "", e.prescriber_name || "", e.prescriber_reg_no || ""]; }) }] });
  }
  function focus(n) { E.focusSoon(function () { return S.mount && S.mount.querySelector("[name=" + n + "]"); }, 30); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[low(k)]) { seen[low(k)] = 1; out.push(k); } }); return out.sort(); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#rep-add"); if (!f || !S.adding) return;
    F.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }
  function fillPatient() { // only empty fields, from the newest earlier prescription for this ID card
    keep(); var raw = S.adding && S.adding.client_id, id = low(raw).replace(/\s+/g, ""); if (!id) return;
    var same = E.people ? function (v) { return E.people.sameIdCard(v, raw); } : function (v) { return low(v).replace(/\s+/g, "") === id; }; // 123M is 0000123M
    var hit = S.entries.filter(function (e) { return same(e.client_id); })[0];
    if (hit && !S.adding.client_name) { if (fillIn({ client_name: hit.client_name })) markKnown(); return; }
    if (hit || S.adding.client_name || !E.people) return;
    E.people.byIdCard(raw).then(function (p) { // not in this register: the pharmacy's people list may know them from another screen
      if (!p || !S.adding || S.adding.client_id !== raw) return;
      keep(); if (!S.adding.client_name && fillIn({ client_name: p.name })) markKnown();
    });
  }
  function fillPrescriber() {
    keep(); var n = low(S.adding && S.adding.prescriber_name).trim(); if (!n || S.adding.prescriber_reg_no) return;
    var regs = uniq(S.entries.filter(function (e) { return low(e.prescriber_name).trim() === n; }).map(function (e) { return e.prescriber_reg_no; }));
    if (regs.length === 1) fillIn({ prescriber_reg_no: regs[0] }); // two doctors with one name: let the person type it
  }
  // A lookup fills the form in place, only fields still empty and never the one with focus. It used to redraw the form
  // (paint(true)) as the field was left; the field focus was moving to was replaced and what was typed next was lost.
  function fillIn(vals) {
    var a = S.adding, f = S.mount && S.mount.querySelector("#rep-add"), want = {}; if (!a) return 0;
    Object.keys(vals).forEach(function (k) { if (vals[k] && !a[k]) want[k] = String(vals[k]); });
    var got = f ? E.fillEmpty(f, want) : Object.keys(want);
    got.forEach(function (k) { a[k] = want[k]; });
    return got.length;
  }
  function markKnown() {
    S.adding.known = true;
    var el = S.mount && S.mount.querySelector("#rep-add [name=client_id]"), lab = el && el.closest("label");
    if (lab && !lab.querySelector("small")) lab.insertAdjacentHTML("beforeend", "<small>Known</small>");
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    a.client_id = String(a.client_id || "").replace(/\s+/g, "").toUpperCase();
    var need = [["client_id", "the ID card"], ["client_name", "the patient's name"], ["medicine_name_dose", "the medicine"], ["posology", "the dose"], ["prescriber_name", "the prescriber"], ["prescriber_reg_no", "the prescriber's reg no."]];
    // Everything missing is said at once, each field marked; the cursor goes to the first one.
    var miss = need.filter(function (n) { return !a[n[0]]; });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.entry_date || "") || a.entry_date > today()) miss.unshift(["entry_date", "the day it was written (today or earlier)"]);
    if (a.collect_every_days && !/^([1-9]\d?|[12]\d\d|3[0-5]\d|36[0-5])$/.test(String(a.collect_every_days))) miss.push(["collect_every_days", "how often it is collected as a number of days from 1 to 365, or leave it empty"]);
    S.bad = {}; miss.forEach(function (n) { S.bad[n[0]] = 1; });
    if (miss.length) {
      var w = miss.map(function (n) { return n[1]; });
      S.err = "Write " + (w.length === 1 ? w[0] : w.slice(0, -1).join(", ") + " and " + w[w.length - 1]).replace(/\.$/, "") + ". Nothing was saved.";
      paint(true); var fx = S.mount && S.mount.querySelector("#rep-add [name=" + miss[0][0] + "]"); if (fx) fx.focus(); return;
    }
    // the ID card and the person (E.people.confirmPerson): asked before anything is saved; Go back keeps the form
    var asked = null;
    if (E.people && E.people.confirmPerson) {
      S.saving = true; paint(true);
      asked = await E.people.confirmPerson({ name: a.client_name, id_card: a.client_id }, { key: "repreg", record: "prescription" });
      S.saving = false;
      if (asked.action !== "save") { if (asked.action === "fill") { if (asked.field === "name") a.client_name = asked.value; else a.client_id = asked.value; } paint(true); focus(asked.field === "name" ? "client_name" : "client_id"); return; }
    }
    S.saving = true; paint(true);
    try {
      var body = {}; F.forEach(function (k) { body[k] = a[k]; }); body.expires_date = "";
      if (body.collect_every_days) body.collect_every_days = Number(body.collect_every_days); else delete body.collect_every_days; // empty: no due date // the server sets six months on
      var r = await E.postOnce("/repeat-prescriptions/entries", body, { list: async function () { var r0 = await E.apiFetch("/repeat-prescriptions/entries?from=" + body.entry_date + "&to=" + body.entry_date, { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; },
        same: function (e) { return e.entry_date === body.entry_date && String(e.client_id || "").trim().toLowerCase() === String(body.client_id || "").trim().toLowerCase() && String(e.medicine_name_dose || "").trim().toLowerCase() === String(body.medicine_name_dose || "").trim().toLowerCase() && String(e.prescriber_reg_no || "").trim().toLowerCase() === String(body.prescriber_reg_no || "").trim().toLowerCase(); } });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; S.bad = {}; E.toast("Saved · " + (body.medicine_name_dose ? body.medicine_name_dose + " for " : "prescription for ") + a.client_name, "success");
      if (E.linkPerson) E.linkPerson({ name: body.client_name, id_card: body.client_id }, "register:repeat", asked); // one person in Customers, found or added
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false;
    if (!S.adding && a.entry_date) { S.mo = a.entry_date.slice(0, 7); loadMonth(); } // the month it was written shows it
    return load();
  }

  E.registerModule({
    id: "repreg", title: "Repeat prescriptions", order: 3, icon: "℞", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.bad = {}; S.q = ""; S.view = "all"; S.mo = E.months.now(); S.moEntries = []; E.months.reset(); E.correct.reset("repreg");
      var ho = E.state.repregOpen; E.state.repregOpen = null; if (ho) { S.q = String(ho.q || ""); S.view = ho.view === "due" ? "due" : "all"; } // Today's Repeats card: this patient, the Due view
      // From the count on a customer's page (modules.customers.js): their repeat prescriptions, by ID card when known.
      var hand = E.takeCustomerHandoff ? E.takeCustomerHandoff("repreg") : null;
      if (hand && hand.mode === "find") S.q = String(hand.person.id_card || hand.person.name);
      css(); watchWidth(); paint(); loadMonth(); return E.takeOpenForm("repreg", S.mount, load(), { btn: "[data-act=add]", form: "#rep-add", fill: { id_card: "client_id", name: "client_name" } }, hand);
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("repreg") < 0) E.UI2_DESTINATIONS.push("repreg");
  if (E.UI2_PARENT) E.UI2_PARENT.repreg = "registers";
})();
