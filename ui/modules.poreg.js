/* Paid out, new layout: what left the till today and this month, by day, with the day's total; one form to record a
   payment (who, how much, cash or cheque, invoice, why). Same endpoint as the classic register. Other months and the
   report use eikon.months.js. Correct (the pharmacist only, eikon.correct.js): read again, the classic edit's fields and
   body (its normaliser: a cheque number only for a cheque), a required reason, the whole payment sent (the update
   replaces every field). A payment is never deleted here. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: "", entries: [], names: [], loading: false, error: "", adding: null, saving: false, err: "" };
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  var FIX = { reasonPh: "e.g. Amount typed as 25, the invoice says 20", entity: "paid_out_entries", action: "PAID_OUT_ENTRY_UPDATE",
    fields: [{ k: "payee_name", label: "Paid to", req: true, what: "who was paid" }, { k: "fee", label: "Amount €", type: "num", req: true, what: "the amount" },
      { k: "payment_method", label: "How", type: "select", opts: [["cash", "Cash"], ["cheque", "Cheque"]] }, { k: "cheque_no", label: "Cheque no.", hint: "Cheques only" },
      { k: "invoice_no", label: "Invoice no." }, { k: "reason", label: "What for" },
      { k: "entry_date", label: "Date", type: "date", req: true, what: "the date" }, { k: "entry_time", label: "Time", type: "time", req: true, what: "the time" }],
    rows: function () { return S.entries; },
    reread: async function (row) {
      var months = [String(row.entry_date || "").slice(0, 7), S.month].filter(function (x, i, a) { return /^\d{4}-\d{2}$/.test(x) && a.indexOf(x) === i; });
      for (var i = 0; i < months.length; i++) {
        var r = await E.apiFetch("/paid-out/entries?month=" + encodeURIComponent(months[i]), { method: "GET" });
        var hit = ((r && r.entries) || []).filter(function (e) { return String(e.id) === String(row.id); })[0];
        if (hit) return hit;
      }
      return null;
    },
    put: function (row) { return "/paid-out/entries/" + encodeURIComponent(String(row.id)); },
    body: function (r) { // the classic normalizeEntryPayload: its keys, its order, its rules
      var method = String(r.payment_method || "").trim().toLowerCase() === "cheque" ? "cheque" : "cash";
      return { entry_date: String(r.entry_date || "").trim(), entry_time: String(r.entry_time || "").trim().slice(0, 5), payee_name: String(r.payee_name || "").trim(), fee: Number(r.fee),
        invoice_no: String(r.invoice_no || "").trim(), payment_method: method, cheque_no: method === "cash" ? "" : String(r.cheque_no || "").trim(), reason: String(r.reason || "").trim() };
    },
    check: function (r) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(String(r.entry_date)) || String(r.entry_date) > today()) return "Choose the date (not a day ahead).";
      if (!/^\d{2}:\d{2}$/.test(String(r.entry_time).slice(0, 5))) return "Write the time, e.g. 10:30.";
      if (!(Number(r.fee) > 0)) return "The amount should be more than 0, e.g. 12.50.";
      return "";
    },
    paint: function () { paint(); }, idle: function () { E.whenFormIdle(S.mount, function () { paint(); }); }, done: function () { return load(); } };
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function nowHm() { var d = new Date(); return pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function dayLabel(s) { if (s === today()) return "Today"; var p = String(s).split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1]; }
  function eur(n) { return "€" + (Number(n) || 0).toFixed(2); }
  function money(raw) { var s = String(raw || "").replace(/[€\s]/g, "").replace(",", "."); return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 ? Number(s) : null; } // a comma, as some keyboards type it

  function css() {
    if (document.getElementById("eikon-poreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-poreg-css";
    st.textContent =
      ".por{max-width:880px;margin:0 auto}" +
      ".por-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 12px 0 0;min-height:44px;margin:-8px 0 2px;cursor:pointer}" +
      ".por-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".por h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.por-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".por-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".por-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.por-btn:disabled{opacity:.55;cursor:default}" +
      ".por-sum{display:flex;gap:10px;margin-top:16px}.por-sum div{flex:1;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px}" +
      ".por-sum small{display:block;font-size:12px;color:var(--muted)}.por-sum b{font-size:22px;font-weight:700;font-variant-numeric:tabular-nums;letter-spacing:-.01em}" +
      ".por-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;justify-content:space-between}.por-lab b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".por-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".por-row{display:flex;gap:12px;align-items:center;padding:10px 16px;border-top:.5px solid var(--border)}.por-row:first-child{border-top:0}" +
      ".por-row .t{flex:1;min-width:0}.por-row b{font-size:15px;font-weight:600}.por-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px}.por-row em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums;font-size:15px}" +
      ".por-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".por-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.por-form label:first-child{border-top:0}" +
      ".por-form label>span{flex:0 0 96px;font-size:15px}.por-form input,.por-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".por-seg{display:flex;gap:6px;flex:1}.por-seg button{flex:1;font:inherit;font-size:14px;font-weight:600;height:32px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}.por-seg button.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".por-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".por-err{color:var(--danger);font-size:13.5px;padding:4px 14px}.por [aria-invalid=true]{box-shadow:inset 0 -2px 0 var(--danger)}" +
      ".por-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.por{padding:4px 16px 0}.por h1{font-size:32px}.por-btn{height:44px;border-radius:22px;padding:0 18px}.por-seg button{height:40px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/paid-out/entries?month=" + encodeURIComponent(S.month), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load paid outs");
      S.entries = (r.entries || []).slice().sort(function (a, b) { return String(b.entry_date + b.entry_time).localeCompare(String(a.entry_date + a.entry_time)) || b.id - a.id; });
      E.correct.loadMarks("poreg", FIX, S.month + "-01"); // which payments were corrected, by whom and why
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load paid outs"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  async function loadNames() {
    try { var r = await E.apiFetch("/paid-out/names", { method: "GET" }); S.names = (r && r.ok && r.names) || []; } catch (e) { S.names = []; }
    // only the suggestion list changes: redrawing the form here could swallow a tap on Record that lands at the same moment
    var dl = S.mount && S.mount.querySelector("#por-names"); if (dl) dl.innerHTML = S.names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("");
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "poreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var mn = MON[Number(S.month.slice(5)) - 1];
    var h = '<div class="por"><button class="por-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("poreg")) + '</button>' +
      '<div class="por-top"><div><h1>Paid out</h1><p class="por-sub">Money paid from the till: couriers, cleaners, small suppliers.</p></div>' + (S.adding ? "" : '<button class="por-btn p" data-act="add">New payment</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="por-form" id="por-add" autocomplete="off">' +
        '<label><span>Paid to</span><input name="payee_name" list="por-names" value="' + esc(a.payee_name) + '" placeholder="Who"></label>' +
        '<label><span>Amount €</span><input name="fee" inputmode="decimal" value="' + esc(a.fee) + '" placeholder="0.00"></label>' +
        '<label><span>How</span><div class="por-seg"><button type="button" data-m="cash" aria-pressed="' + (a.payment_method !== "cheque") + '" class="' + (a.payment_method !== "cheque" ? "on" : "") + '">Cash</button><button type="button" data-m="cheque" aria-pressed="' + (a.payment_method === "cheque") + '" class="' + (a.payment_method === "cheque" ? "on" : "") + '">Cheque</button></div></label>' +
        (a.payment_method === "cheque" ? '<label><span>Cheque no.</span><input name="cheque_no" value="' + esc(a.cheque_no) + '"></label>' : "") +
        '<label><span>Invoice no.</span><input name="invoice_no" value="' + esc(a.invoice_no) + '" placeholder="Optional"></label>' +
        '<label><span>What for</span><input name="reason" value="' + esc(a.reason) + '" placeholder="Optional, e.g. Delivery to Gozo"></label>' +
        '<label><span>When</span><input name="entry_date" type="date" max="' + esc(today()) + '" value="' + esc(a.entry_date) + '"><input name="entry_time" type="time" value="' + esc(a.entry_time) + '" style="flex:0 0 96px"></label>' +
        (S.err ? '<div class="por-err" id="por-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="por-btn" data-act="add-cancel">Cancel</button><button type="submit" class="por-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save payment") + "</button></div>" +
        '<datalist id="por-names">' + S.names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    }
    h += E.months.bar(S.month, { label: "Paid out" });
    if (S.loading && !S.entries.length) h += '<div class="por-quiet">Opening paid outs…</div>';
    else if (S.error) h += '<div class="por-quiet">' + esc(S.error) + "</div>";
    else {
      var tdy = S.entries.filter(function (e) { return e.entry_date === today(); }), sum = function (l) { return l.reduce(function (t, e) { return t + (Number(e.fee) || 0); }, 0); };
      h += '<div class="por-sum">' + (E.months.isNow(S.month) ? "<div><small>Today</small><b>" + eur(sum(tdy)) + "</b></div>" : "") + "<div><small>" + esc(mn) + "</small><b>" + eur(sum(S.entries)) + "</b></div></div>";
      if (!S.entries.length) h += '<div class="por-quiet" data-empty>' + esc(E.months.empty(S.month, "Nothing paid out this month.")) + "</div>";
      var days = []; S.entries.forEach(function (e) { if (days.indexOf(e.entry_date) < 0) days.push(e.entry_date); });
      days.forEach(function (d) {
        var list = S.entries.filter(function (e) { return e.entry_date === d; });
        h += '<div class="por-lab"><span>' + esc(dayLabel(d)) + "</span><b>" + eur(sum(list)) + '</b></div><div class="por-list">' + list.map(function (e) {
          var sub = [e.entry_time, e.payment_method === "cheque" ? "Cheque" + (e.cheque_no ? " " + e.cheque_no : "") : "Cash"]; if (e.invoice_no) sub.push("Invoice " + e.invoice_no); if (e.reason) sub.push(e.reason);
          return '<div class="por-row"><div class="t"><b>' + esc(e.payee_name) + "</b><span>" + esc(sub.join(" · ")) + "</span>" + E.correct.mark("poreg", e) + "</div><em>" + eur(e.fee) + "</em>" +
            E.correct.button("poreg", e, eur(e.fee) + " to " + e.payee_name + ", " + dayLabel(e.entry_date)) + "</div>" + E.correct.panel("poreg", e, FIX);
        }).join("") + "</div>";
      });
    }
    h += E.correct.foot() + "</div>";
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("poreg");
        else if (act === "add") { S.adding = { payee_name: "", fee: "", payment_method: "cash", cheque_no: "", invoice_no: "", reason: "", entry_date: today(), entry_time: nowHm() }; S.err = ""; paint(true); if (!S.names.length) loadNames(); var f = m.querySelector("[name=payee_name]"); if (f) f.focus(); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "poreg"); } catch (x) {} E.openClassic("paidout"); }
      });
    });
    m.querySelectorAll(".por-seg [data-m]").forEach(function (b) { b.addEventListener("click", function () { keep(); S.adding.payment_method = b.getAttribute("data-m"); paint(true); }); });
    var f = m.querySelector("#por-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
    E.correct.wire(m, "poreg", FIX);
    E.months.wire(m, { month: function () { return S.month; }, go: function (ym) { S.month = ym; S.entries = []; E.correct.reset("poreg"); load(); }, paint: function () { paint(); }, print: printMonth });
  }

  // The classic month report: by who was paid (A to Z), each with its payments (oldest first) and subtotal, and the total.
  function printMonth() {
    var MB = E.months, groups = {}, names = [], tot = 0, f2 = function (v) { var n = Number(v); return (isFinite(n) ? n : 0).toFixed(2); };
    S.entries.forEach(function (e) { var n = String(e.payee_name || "").trim() || "(No name)"; if (!groups[n]) { groups[n] = []; names.push(n); } groups[n].push(e); tot += Number(e.fee) || 0; });
    names.sort(function (a, b) { return a.localeCompare(b); });
    var cols = ["Date", "Time", { h: "Amount", num: true }, "Method", "Invoice", "Cheque", "Reason"];
    MB.print({ register: "Paid Out — Month Report", month: S.month,
      intro: '<p class="sub"><b>Total: ' + f2(tot) + "</b> · Items: " + S.entries.length + "</p>",
      sections: names.length ? names.map(function (n) {
        var g = groups[n].slice().sort(function (a, b) { return String(a.entry_date).localeCompare(String(b.entry_date)) || String(a.entry_time || "").localeCompare(String(b.entry_time || "")) || Number(a.id) - Number(b.id); });
        var sub = g.reduce(function (t, e) { return t + (Number(e.fee) || 0); }, 0);
        return { heading: n, sub: "Items: " + g.length + " · Subtotal: " + f2(sub), cols: cols,
          rows: g.map(function (e) { return [MB.dmy(e.entry_date), e.entry_time || "", f2(e.fee), String(e.payment_method || "").toLowerCase() === "cheque" ? "Cheque" : "Cash", e.invoice_no || "", e.cheque_no || "", e.reason || ""]; }),
          foot: ["Subtotal", "", f2(sub), "", "", "", ""] };
      }) : [{ cols: cols, rows: [] }] });
  }

  function keep() {
    var f = S.mount && S.mount.querySelector("#por-add"); if (!f || !S.adding) return;
    ["payee_name", "fee", "cheque_no", "invoice_no", "reason", "entry_date", "entry_time"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  // The box with the problem: marked, tied to the message, and the cursor in it (until something is typed there).
  function markBad(sel, errId) {
    var el = S.mount && S.mount.querySelector(sel); if (!el) return;
    el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", errId); el.focus();
    el.addEventListener("input", function () { el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); }, { once: true });
  }
  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding, fee = money(a.fee), bad = ""; S.err = "";
    if (!a.payee_name) { S.err = "Write who was paid. Nothing was saved."; bad = "payee_name"; }
    else if (fee == null) { S.err = "Write the amount, e.g. 12.50. Nothing was saved."; bad = "fee"; }
    else if (a.payment_method === "cheque" && !a.cheque_no) { S.err = "Write the cheque number. Nothing was saved."; bad = "cheque_no"; }
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(a.entry_date) || a.entry_date > today()) { S.err = "Choose the day it was paid. Nothing was saved."; bad = "entry_date"; }
    else if (!/^\d{2}:\d{2}$/.test(a.entry_time)) { S.err = "Choose the time it was paid. Nothing was saved."; bad = "entry_time"; }
    if (S.err) { paint(true); return markBad("#por-add [name=" + bad + "]", "por-err"); }
    S.saving = true; paint(true);
    try {
      var monthList = async function () { var r0 = await E.apiFetch("/paid-out/entries?month=" + encodeURIComponent(a.entry_date.slice(0, 7)), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; };
      var same = function (e) { return e.entry_date === a.entry_date && String(e.entry_time).slice(0, 5) === a.entry_time && String(e.payee_name).trim().toLowerCase() === a.payee_name.toLowerCase() && Math.abs((Number(e.fee) || 0) - fee) < 0.005; };
      var had = null; try { had = (await monthList()).filter(same).length; } catch (e0) { had = null; }
      try {
        var r = await E.apiFetch("/paid-out/entries", { method: "POST", body: JSON.stringify({ entry_date: a.entry_date, entry_time: a.entry_time, payee_name: a.payee_name, fee: fee, payment_method: a.payment_method === "cheque" ? "cheque" : "cash", invoice_no: a.invoice_no, cheque_no: a.payment_method === "cheque" ? a.cheque_no : "", reason: a.reason }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      } catch (x0) { // the answer was lost: did it arrive? Never record it twice.
        if (!(x0 && x0.network) || had == null) throw x0;
        var now = null; try { now = (await monthList()).filter(same).length; } catch (e1) { throw x0; }
        if (now <= had) throw x0;
      }
      S.adding = null; E.toast("Saved · " + eur(fee) + " paid out to " + a.payee_name, "success");
      if (a.entry_date.slice(0, 7) !== S.month) S.month = a.entry_date.slice(0, 7);
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "poreg", title: "Paid out", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.month = today().slice(0, 7); S.entries = []; E.months.reset(); E.correct.reset("poreg"); S.adding = null; S.err = ""; css(); paint(); return E.takeOpenForm("poreg", S.mount, load(), { btn: "[data-act=add]", form: "#por-add" }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("poreg") < 0) E.UI2_DESTINATIONS.push("poreg");
  if (E.UI2_PARENT) E.UI2_PARENT.poreg = "money";
})();
