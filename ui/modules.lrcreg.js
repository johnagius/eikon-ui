/* Locum receipts, new layout: this month's receipts with a Print button (the same receipt as the classic screen), and
   one form: the day decides Normal or Sunday / public holiday (Malta's fixed holidays and Good Friday, as the classic
   screen), the hourly rate for that kind of day is remembered in this browser (the same memory as the classic screen),
   a locum used before fills the registration number, the total shows as you type. Recording only; changing or
   deleting a receipt (it needs the edit password), other months and the report stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: "", entries: [], known: [], loading: false, error: "", adding: null, saving: false, err: "" };
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var FIXED = { "01/01": 1, "10/02": 1, "19/03": 1, "31/03": 1, "01/05": 1, "07/06": 1, "29/06": 1, "15/08": 1, "08/09": 1, "21/09": 1, "08/12": 1, "13/12": 1, "25/12": 1 };
  var MEM = "eikon:locumreceipts:feeMem"; // shared with the classic screen

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function today() { return ymd(new Date()); }
  function prevMonth(m) { var p = m.split("-"), y = +p[0], n = +p[1] - 1; if (n < 1) { n = 12; y--; } return y + "-" + pad(n); }
  function eur(n) { return "€" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function num(raw) { var s = String(raw == null ? "" : raw).replace(/[€\s]/g, "").replace(",", "."); return /^\d+(\.\d+)?$/.test(s) ? Number(s) : null; }
  function dayLabel(s) { var p = String(s).split("-"); var d = new Date(+p[0], +p[1] - 1, +p[2]); return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d.getDay()] + " " + (+p[2]) + " " + MON[+p[1] - 1].slice(0, 3); }
  function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451); return new Date(y, Math.floor((h + l - 7 * m + 114) / 31) - 1, ((h + l - 7 * m + 114) % 31) + 1); }
  function dayType(s) { // the same rule as the classic screen: Sunday, a fixed Malta public holiday, or Good Friday
    var p = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || "")); if (!p) return "normal";
    var dt = new Date(+p[1], +p[2] - 1, +p[3]); if (dt.getDay() === 0 || FIXED[p[3] + "/" + p[2]]) return "holiday";
    var gf = easter(+p[1]); gf.setDate(gf.getDate() - 2); return gf.getMonth() === dt.getMonth() && gf.getDate() === dt.getDate() ? "holiday" : "normal";
  }
  function mem() { try { var o = JSON.parse(localStorage.getItem(MEM) || "null") || {}; return { normal: isFinite(+o.normal) && o.normal != null ? +o.normal : null, holiday: isFinite(+o.holiday) && o.holiday != null ? +o.holiday : null }; } catch (e) { return { normal: null, holiday: null }; } }
  function remember(type, rate) { try { var m = mem(); m[type] = rate; localStorage.setItem(MEM, JSON.stringify(m)); } catch (e) {} }

  function css() {
    if (document.getElementById("eikon-lrcreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-lrcreg-css";
    st.textContent =
      ".lrc{max-width:880px;margin:0 auto}" +
      ".lrc-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".lrc-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".lrc h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.lrc-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".lrc-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".lrc-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.lrc-btn:disabled{opacity:.55;cursor:default}" +
      ".lrc-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;justify-content:space-between}.lrc-lab b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".lrc-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".lrc-row{display:flex;gap:12px;align-items:center;padding:11px 16px;border-top:.5px solid var(--border)}.lrc-row:first-child{border-top:0}" +
      ".lrc-row .t{flex:1;min-width:0}.lrc-row b{font-size:15px;font-weight:600}.lrc-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.lrc-row em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;font-size:15px}" +
      ".lrc-hol{font-size:11.5px;font-weight:600;padding:2px 8px;border-radius:999px;background:rgba(201,138,18,.16);color:var(--warn,#A06A0E);margin-left:6px}" +
      ".lrc-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".lrc-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.lrc-form label:first-child{border-top:0}" +
      ".lrc-form label>span{flex:0 0 104px;font-size:15px}.lrc-form input,.lrc-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".lrc-total{display:flex;justify-content:space-between;align-items:baseline;padding:10px 14px;border-top:.5px solid var(--border)}.lrc-total b{font-size:20px;font-variant-numeric:tabular-nums}.lrc-total span{font-size:13px;color:var(--muted)}" +
      ".lrc-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}.lrc-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".lrc-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.lrc{padding:4px 16px 0}.lrc h1{font-size:32px}.lrc-form label>span{flex-basis:92px}}";
    document.head.appendChild(st);
  }

  async function get(month) { var r = await E.apiFetch("/locumreceipts/receipts?month=" + encodeURIComponent(month), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load locum receipts"); return r.receipts || r.entries || []; }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var both = await Promise.all([get(S.month), get(prevMonth(S.month)).catch(function () { return []; })]);
      S.entries = both[0].slice().sort(function (a, b) { return String(b.receipt_date).localeCompare(String(a.receipt_date)) || b.id - a.id; });
      var seen = {}; S.known = [];
      both[0].concat(both[1]).forEach(function (r) { var k = String(r.locum_full_name || "").trim().toLowerCase(); if (k && !seen[k]) { seen[k] = 1; S.known.push({ name: r.locum_full_name, reg: r.registration_number }); } });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load locum receipts"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "lrcreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var mn = MON[+S.month.slice(5) - 1];
    var h = '<div class="lrc"><button class="lrc-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("lrcreg")) + '</button>' +
      '<div class="lrc-top"><div><h1>Locum receipts</h1><p class="lrc-sub">What each locum was paid, ready to print and sign.</p></div>' + (S.adding ? "" : '<button class="lrc-btn p" data-act="add">New receipt</button>') + "</div>";
    if (S.adding) h += formHtml();
    h += E.months.bar(S.month, { label: "Locum receipts", printLabel: "Print the month" });
    if (S.loading && !S.entries.length) h += '<div class="lrc-quiet">Opening locum receipts…</div>';
    else if (S.error) h += '<div class="lrc-quiet">' + esc(S.error) + "</div>";
    else {
      var total = S.entries.reduce(function (t, r) { return t + (Number(r.total_fee) || 0); }, 0);
      h += '<div class="lrc-lab"><span>' + esc(mn) + " · " + S.entries.length + (S.entries.length === 1 ? " receipt" : " receipts") + "</span><b>" + eur(total) + "</b></div>";
      h += S.entries.length ? '<div class="lrc-list">' + S.entries.map(function (r) {
        return '<div class="lrc-row"><div class="t"><b>' + esc(r.locum_full_name) + "</b>" + (String(r.day_type || dayType(r.receipt_date)).toLowerCase() === "holiday" ? '<i class="lrc-hol" style="font-style:normal">Holiday rate</i>' : "") +
          "<span>" + esc(dayLabel(r.receipt_date)) + " · " + esc(r.hours) + " h × " + eur(r.fee_per_hour) + " · Reg " + esc(r.registration_number) + "</span></div><em>" + eur(r.total_fee) + '</em><button class="lrc-btn" data-act="print" data-id="' + r.id + '">Print</button></div>';
      }).join("") + "</div>" : '<div class="lrc-quiet" data-empty>' + esc(E.months.empty(S.month, "No locum receipts this month yet.")) + "</div>";
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing or deleting a receipt is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && ae.name ? "[name=" + ae.name + "]" : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) again.focus(); }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("lrcreg");
        else if (act === "add") { var t = today(), ty = dayType(t), r = mem()[ty]; S.adding = { receipt_date: t, day_type: ty, hours: "", fee_per_hour: r != null ? String(r) : "", locum_full_name: "", registration_number: "" }; S.err = ""; paint(true); setTimeout(function () { var f = m.querySelector("[name=locum_full_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); }
        else if (act === "print") { var row = S.entries.find(function (x) { return x.id === Number(b.getAttribute("data-id")); }); if (row) printReceipt(row); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "lrcreg"); } catch (x) {} E.openClassic("locumreceipts"); }
      });
    });
    E.months.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; load(); }, paint: function () { paint(); }, print: printMonth });
    var f = m.querySelector("#lrc-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      f.addEventListener("input", function (ev) { // the total follows what is typed; the day decides the rate
        var n = ev.target && ev.target.name; keep();
        if (n === "receipt_date") { var ty = dayType(S.adding.receipt_date), r = mem()[ty]; if (ty !== S.adding.day_type) { S.adding.day_type = ty; if (r != null) S.adding.fee_per_hour = String(r); } inPlace(); return; }
        if (n === "day_type") { var r2 = mem()[S.adding.day_type]; if (r2 != null) S.adding.fee_per_hour = String(r2); inPlace(); return; }
        var tot = m.querySelector("#lrc-tot"); if (tot) tot.textContent = totalText();
      });
      var nm = f.querySelector("[name=locum_full_name]"); if (nm) nm.addEventListener("blur", function () { keep(); var k = S.known.find(function (x) { return String(x.name).toLowerCase() === String(S.adding.locum_full_name).toLowerCase(); }); if (k && !S.adding.registration_number && E.fillEmpty(f, { registration_number: k.reg }).length) S.adding.registration_number = k.reg; });
    }
    // The rate and the reg no. are written into the open form in place: a redraw here, while the day was being typed
    // or as the name was left with Tab, replaced the field in use and lost what was typed next.
    function inPlace() {
      var a = S.adding; if (!f || !a) return;
      var dt = f.querySelector("[name=day_type]"); if (dt && dt.value !== a.day_type) dt.value = a.day_type;
      var fe = f.querySelector("[name=fee_per_hour]"); if (fe && fe !== document.activeElement && fe.value !== a.fee_per_hour) fe.value = a.fee_per_hour || "";
      var tot = m.querySelector("#lrc-tot"); if (tot) tot.textContent = totalText();
    }
  }
  // The classic report for the month: each locum with their days (date, day type, hours, rate, total) and totals,
  // then all locums together. Worked out here from the month's receipts, with the classic screen's labels and rounding.
  function printMonth() {
    var MB = E.months, by = {}, order = [], m2 = function (n) { var x = Number(n); return (isFinite(x) ? x : 0).toFixed(2); };
    var hf = function (n) { var x = Number(n); return (isFinite(x) ? x : 0).toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1"); };
    var dl = function (r) { return String(r.day_type || dayType(r.receipt_date)).toLowerCase() === "holiday" ? "Sunday / Public Holiday" : "Normal Day"; };
    S.entries.forEach(function (r) { var k = String(r.locum_full_name || "").trim().toLowerCase() + "|" + String(r.registration_number || "").trim(); if (!by[k]) { by[k] = { name: r.locum_full_name || "", reg: r.registration_number || "", list: [], h: 0, f: 0 }; order.push(k); } by[k].list.push(r); by[k].h += Number(r.hours) || 0; by[k].f += Number(r.total_fee) || 0; });
    order.sort(function (a, b) { return String(by[a].name).localeCompare(String(by[b].name)); });
    var cols = ["Date", "Day Type", { h: "Hours", num: true }, { h: "Fee/Hr", num: true }, { h: "Total", num: true }], H = 0, F = 0;
    var secs = order.map(function (k) {
      var L = by[k]; H += L.h; F += L.f;
      return { heading: L.name + " (" + L.reg + ")", sub: "Total Hours: " + hf(L.h) + " | Total Fees: € " + m2(L.f), cols: cols,
        rows: L.list.slice().sort(function (a, b) { return String(a.receipt_date).localeCompare(String(b.receipt_date)) || a.id - b.id; }).map(function (r) { return [MB.dmy(r.receipt_date), dl(r), hf(r.hours), "€ " + m2(r.fee_per_hour), "€ " + m2(r.total_fee)]; }) };
    });
    secs.push({ heading: "All Locums Summary", sub: "Combined Total Hours: " + hf(H) + " | Combined Total Fees: € " + m2(F), cols: ["Locum", "Reg No", { h: "Total Hours", num: true }, { h: "Total Fees", num: true }],
      rows: order.map(function (k) { return [by[k].name, by[k].reg, hf(by[k].h), "€ " + m2(by[k].f)]; }) });
    MB.print({ register: "Locum Receipts Report", month: S.month, sections: secs });
  }
  function totalText() { var a = S.adding || {}, hrs = num(a.hours), rate = num(a.fee_per_hour); return hrs != null && rate != null ? eur(hrs * rate) : "—"; }
  function formHtml() {
    var a = S.adding, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + "></label>"; };
    return '<form class="lrc-form" id="lrc-add" autocomplete="off">' + fld("locum_full_name", "Locum", ' list="lrc-names" placeholder="Name and surname"') + fld("registration_number", "Reg no.") +
      fld("receipt_date", "Day", ' type="date" max="' + esc(today()) + '"') +
      '<label><span>Rate</span><select name="day_type"><option value="normal"' + (a.day_type === "normal" ? " selected" : "") + '>Normal day</option><option value="holiday"' + (a.day_type === "holiday" ? " selected" : "") + ">Sunday / public holiday</option></select></label>" +
      fld("hours", "Hours", ' inputmode="decimal" placeholder="e.g. 8 or 7.5"') + fld("fee_per_hour", "€ per hour", ' inputmode="decimal" placeholder="0.00"') +
      '<div class="lrc-total"><span>Total</span><b id="lrc-tot">' + esc(totalText()) + "</b></div>" + (S.err ? '<div class="lrc-err">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="lrc-btn" data-act="add-cancel">Cancel</button><button type="submit" class="lrc-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record") + "</button></div>" +
      '<datalist id="lrc-names">' + S.known.map(function (k) { return '<option value="' + esc(k.name) + '">'; }).join("") + "</datalist></form>";
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#lrc-add"); if (!f || !S.adding) return;
    ["locum_full_name", "registration_number", "receipt_date", "day_type", "hours", "fee_per_hour"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding, hrs = num(a.hours), rate = num(a.fee_per_hour); S.err = "";
    if (!a.locum_full_name) S.err = "Write the locum's name. Nothing was saved.";
    else if (!a.registration_number) S.err = "Write the registration number. Nothing was saved.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(a.receipt_date || "") || a.receipt_date > today()) S.err = "Choose the day worked. Nothing was saved.";
    else if (hrs == null || hrs <= 0 || hrs > 24) S.err = "Write the hours worked (up to 24). Nothing was saved.";
    else if (rate == null) S.err = "Write the rate per hour, e.g. 15.00. Nothing was saved.";
    if (S.err) return paint(true);
    S.saving = true; paint(true);
    try {
      var monthList = async function () { var r0 = await E.apiFetch("/locumreceipts/receipts?month=" + encodeURIComponent(a.receipt_date.slice(0, 7)), { method: "GET" }); return (r0 && r0.ok && r0.receipts) || []; };
      var same = function (e) { return e.receipt_date === a.receipt_date && String(e.locum_full_name).trim().toLowerCase() === a.locum_full_name.toLowerCase() && Math.abs(Number(e.hours) - hrs) < 0.001 && Math.abs((Number(e.fee_per_hour) || 0) - rate) < 0.005; };
      var had = null; try { had = (await monthList()).filter(same).length; } catch (e0) { had = null; }
      try {
        var r = await E.apiFetch("/locumreceipts/receipts", { method: "POST", body: JSON.stringify({ receipt_date: a.receipt_date, hours: hrs, locum_full_name: a.locum_full_name, registration_number: a.registration_number, day_type: a.day_type === "holiday" ? "holiday" : "normal", fee_per_hour: rate }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      } catch (x0) { // the answer was lost: did it arrive? Never record it twice.
        if (!(x0 && x0.network) || had == null) throw x0;
        var now = null; try { now = (await monthList()).filter(same).length; } catch (e1) { throw x0; }
        if (now <= had) throw x0;
      }
      remember(a.day_type === "holiday" ? "holiday" : "normal", rate);
      S.adding = null; E.toast(eur(hrs * rate) + " for " + a.locum_full_name + " · Print it from the list", "success");
      if (a.receipt_date.slice(0, 7) !== S.month) S.month = a.receipt_date.slice(0, 7);
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  function printReceipt(row) { // the same layout as the classic screen's receipt
    var loc = (E.state.user && (E.state.user.location_name || "")) || "";
    var lbl = dayType(row.receipt_date) === "holiday" ? "Sunday / Public Holiday" : "Normal Day";
    var hrs = Number(row.hours); hrs = Math.round(hrs * 100) / 100;
    var html = '<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Locum Receipt #' + esc(row.id) + "</title><style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:26px;color:#111}h1{margin:0;font-size:22px}.meta{font-size:12px;color:#333;margin-top:4px}" +
      ".card{margin-top:16px;border:1px solid #000;border-radius:10px;padding:14px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}.k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#444}.v{font-size:14px;font-weight:700;margin-top:2px}" +
      ".sign{margin-top:22px;display:flex;gap:18px;align-items:flex-end}.line{flex:1;border-bottom:1px solid #000;height:18px}.lbl{font-size:12px;color:#333;min-width:110px}.note{font-size:11px;color:#444;margin-top:12px}@media print{body{margin:12mm}}</style></head><body>" +
      "<h1>Locum Receipt</h1><div class=\"meta\">" + esc(loc) + "</div><div class=\"meta\">Date: <b>" + esc(row.receipt_date) + "</b> &nbsp;&middot;&nbsp; Receipt #: <b>" + esc(row.id) + "</b></div>" +
      '<div class="card"><div class="grid"><div><div class="k">Name &amp; Surname</div><div class="v">' + esc(row.locum_full_name) + '</div></div><div><div class="k">Registration Number</div><div class="v">' + esc(row.registration_number) + "</div></div>" +
      '<div><div class="k">Day Type</div><div class="v">' + esc(lbl) + '</div></div><div><div class="k">Hours</div><div class="v">' + esc(hrs) + "</div></div>" +
      '<div><div class="k">Fee per Hour</div><div class="v">€ ' + esc((Number(row.fee_per_hour) || 0).toFixed(2)) + '</div></div><div><div class="k">Total Fee</div><div class="v">€ ' + esc((Number(row.total_fee) || 0).toFixed(2)) + "</div></div></div>" +
      '<div class="sign"><div class="lbl">Locum Signature</div><div class="line"></div></div><div class="note">This receipt was generated via the Eikon system.</div></div>' +
      "</body></html>";
    var w = window.open("", "_blank");
    if (!w) { E.toast("The browser blocked the print window. Allow pop-ups for Eikon and press Print again.", "warn"); return; }
    w.document.open(); w.document.write(html); w.document.close();
    E.printTab(w, { delay: 80, focus: true, closeAfter: true });
  }

  E.registerModule({
    id: "lrcreg", title: "Locum receipts", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.month = today().slice(0, 7); S.entries = []; E.months.reset(); S.adding = null; S.err = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("lrcreg") < 0) E.UI2_DESTINATIONS.push("lrcreg");
  if (E.UI2_PARENT) E.UI2_PARENT.lrcreg = "money";
})();
