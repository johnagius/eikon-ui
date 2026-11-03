/* Controlled drugs received (DDA purchases), new layout: this month's deliveries grouped by invoice, and one form for a
   whole invoice (date, supplier, invoice number, then each drug and quantity). Each line is one entry, as in the classic
   register, posted one at a time; a line that fails stays in the form and lines already saved are not sent again.
   Names and suppliers used in the last two months are offered as you type. Changing or deleting an entry, other months
   and the inspector's report stay in the classic register. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, month: "", entries: [], known: { names: [], agents: [] }, loading: false, error: "", adding: null, saving: false, err: "" };
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function monthOf(ymd) { return String(ymd).slice(0, 7); }
  function prevMonth(m) { var p = m.split("-"), y = Number(p[0]), n = Number(p[1]) - 1; if (n < 1) { n = 12; y--; } return y + "-" + pad(n); }
  function dmy(s) { var p = String(s).split("-"); return Number(p[2]) + " " + MON[Number(p[1]) - 1].slice(0, 3); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[k.toLowerCase()]) { seen[k.toLowerCase()] = 1; out.push(k); } }); return out.sort(function (x, y) { return x.localeCompare(y); }); }
  function blank() { return { entry_date: today(), agent: "", invoice_number: "", lines: [{ dda_name_dose: "", quantity: "" }, { dda_name_dose: "", quantity: "" }] }; }

  function css() {
    if (document.getElementById("eikon-cdpreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-cdpreg-css";
    st.textContent =
      ".cdp{max-width:880px;margin:0 auto}" +
      ".cdp-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".cdp-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".cdp h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.cdp-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".cdp-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".cdp-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cdp-btn:disabled{opacity:.55;cursor:default}.cdp-btn.t{border:0;background:none;color:var(--accent);padding:0 4px}" +
      ".cdp-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.cdp-lab b{color:var(--text)}" +
      ".cdp-inv{background:var(--panel2);border:1px solid var(--border);border-radius:12px;margin-bottom:10px;overflow:hidden}" +
      ".cdp-inv .h{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap;padding:11px 16px 6px}.cdp-inv .h b{font-size:15px;font-weight:600}.cdp-inv .h span{font-size:12.5px;color:var(--muted)}" +
      ".cdp-ln{display:flex;justify-content:space-between;gap:12px;padding:7px 16px;border-top:.5px solid var(--border);font-size:14.5px}.cdp-ln em{font-style:normal;font-weight:600;font-variant-numeric:tabular-nums}" +
      ".cdp-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".cdp-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.cdp-form label:first-child{border-top:0}" +
      ".cdp-form label>span{flex:0 0 96px;font-size:15px}.cdp-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".cdp-form .row{display:flex;align-items:center;gap:10px;padding:0 14px;border-top:.5px solid var(--border);min-height:44px}.cdp-form .row input.n{flex:1}.cdp-form .row input.q{flex:0 0 64px;text-align:right}" +
      ".cdp-form .row.ok{opacity:.55}.cdp-form .row small{color:var(--accent);font-size:12px;font-weight:600}" +
      ".cdp-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:12px 14px 4px;border-top:.5px solid var(--border);display:flex;justify-content:space-between}" +
      ".cdp-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:space-between;align-items:center}" +
      ".cdp-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".cdp-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.cdp{padding:4px 16px 0}.cdp h1{font-size:32px}}";
    document.head.appendChild(st);
  }

  async function get(month) {
    var r = await E.apiFetch("/dda-purchases/entries?month=" + encodeURIComponent(month), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the register");
    return r.entries || [];
  }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var both = await Promise.all([get(S.month), get(prevMonth(S.month)).catch(function () { return []; })]);
      S.entries = both[0];
      var all = both[0].concat(both[1]);
      S.known = { names: uniq(all.map(function (e) { return e.dda_name_dose; })), agents: uniq(all.map(function (e) { return e.agent; })) };
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function groups() { // one card per delivery note: same day, supplier and invoice
    var map = {}, order = [];
    S.entries.forEach(function (e) { var k = e.entry_date + "|" + e.agent + "|" + e.invoice_number; if (!map[k]) { map[k] = { date: e.entry_date, agent: e.agent, inv: e.invoice_number, lines: [] }; order.push(k); } map[k].lines.push(e); });
    return order.map(function (k) { map[k].lines.sort(function (x, y) { return x.id - y.id; }); return map[k]; }); // lines in the order they were typed off the invoice
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "cdpreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving) keep(); // a reply landing while someone types must not wipe the form
    var mn = MON[Number(S.month.slice(5)) - 1] + " " + S.month.slice(0, 4);
    var h = '<div class="cdp"><button class="cdp-back" data-act="back">‹ Registers</button>' +
      '<div class="cdp-top"><div><h1>Controlled drugs received</h1><p class="cdp-sub">Every delivery of a controlled drug, by invoice.</p></div>' + (S.adding ? "" : '<button class="cdp-btn p" data-act="add">Record a delivery</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="cdp-form" id="cdp-add" autocomplete="off">' +
        '<label><span>Received</span><input name="entry_date" type="date" max="' + esc(today()) + '" value="' + esc(a.entry_date) + '"></label>' +
        '<label><span>Supplier</span><input name="agent" list="cdp-agents" value="' + esc(a.agent) + '" placeholder="Agent"></label>' +
        '<label><span>Invoice no.</span><input name="invoice_number" value="' + esc(a.invoice_number) + '"></label>' +
        '<div class="hd"><span>Drug, strength and form</span><span>Qty</span></div>' +
        a.lines.map(function (l, i) {
          return '<div class="row' + (l.saved ? " ok" : "") + '"><input class="n" data-i="' + i + '" data-k="dda_name_dose" list="cdp-names" value="' + esc(l.dda_name_dose) + '" placeholder="e.g. Morphine 10mg tablets"' + (l.saved ? " disabled" : "") + ">" +
            (l.saved ? "<small>Saved</small>" : '<input class="q" data-i="' + i + '" data-k="quantity" inputmode="numeric" value="' + esc(l.quantity) + '" placeholder="0">') + "</div>";
        }).join("") +
        (S.err ? '<div class="cdp-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="cdp-btn t" data-act="line">Add a line</button><span style="display:flex;gap:8px"><button type="button" class="cdp-btn" data-act="add-cancel">' + (a.lines.some(function (l) { return l.saved; }) ? "Close" : "Cancel") + '</button><button type="submit" class="cdp-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record") + "</button></span></div>" +
        '<datalist id="cdp-names">' + S.known.names.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        '<datalist id="cdp-agents">' + S.known.agents.map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist></form>";
    }
    if (S.loading && !S.entries.length) h += '<div class="cdp-quiet">Opening the register…</div>';
    else if (S.error) h += '<div class="cdp-quiet">' + esc(S.error) + "</div>";
    else {
      var g = groups();
      h += '<div class="cdp-lab">' + esc(mn) + " <b>" + S.entries.length + "</b></div>";
      h += g.length ? g.map(function (x) {
        return '<div class="cdp-inv"><div class="h"><b>' + esc(x.agent) + "</b><span>Invoice " + esc(x.inv) + " · " + esc(dmy(x.date)) + "</span></div>" +
          x.lines.map(function (e) { return '<div class="cdp-ln"><span>' + esc(e.dda_name_dose) + "</span><em>" + esc(e.quantity) + "</em></div>"; }).join("") + "</div>";
      }).join("") : '<div class="cdp-quiet">Nothing received this month yet.</div>';
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Correcting or deleting an entry, other months and the inspector\'s report are in the <a href="#" data-act="classic" style="color:var(--accent)">classic register</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = "#registers";
        else if (act === "add") { S.adding = blank(); S.err = ""; paint(); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(); }
        else if (act === "line") { keep(); S.adding.lines.push({ dda_name_dose: "", quantity: "" }); paint(); var ins = m.querySelectorAll(".cdp-form .row input.n"); if (ins.length) ins[ins.length - 1].focus(); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "cdpreg"); } catch (x) {} E.openClassic("dda-purchases"); }
      });
    });
    var f = m.querySelector("#cdp-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
    if (f && E.ddaMedSuggest) f.querySelectorAll("input.n").forEach(function (el) { E.ddaMedSuggest(el, { path: "/dda-purchases", field: "dda_name_dose", known: function () { return S.known.names; }, back: [2] }); }); // generic or brand, and what was written before
  }

  function keep() { // what is typed survives every repaint
    var f = S.mount && S.mount.querySelector("#cdp-add"); if (!f || !S.adding) return;
    ["entry_date", "agent", "invoice_number"].forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
    f.querySelectorAll("[data-i]").forEach(function (el) { var l = S.adding.lines[Number(el.getAttribute("data-i"))]; if (l && !l.saved) l[el.getAttribute("data-k")] = String(el.value || "").trim(); });
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    var todo = a.lines.filter(function (l) { return !l.saved && (l.dda_name_dose || l.quantity); });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(a.entry_date) || a.entry_date > today()) S.err = "Choose the day it came in. Nothing was saved.";
    else if (!a.agent) S.err = "Write the supplier. Nothing was saved.";
    else if (!a.invoice_number) S.err = "Write the invoice number. Nothing was saved.";
    else if (!todo.length) S.err = "Write at least one drug and its quantity. Nothing was saved.";
    else {
      var bad = todo.filter(function (l) { return !l.dda_name_dose || !/^\d+$/.test(l.quantity) || Number(l.quantity) < 1; })[0];
      if (bad) S.err = (bad.dda_name_dose ? "Write how many of " + bad.dda_name_dose + " (a whole number)." : "Write the drug for quantity " + bad.quantity + ".") + " Nothing was saved.";
    }
    if (S.err) return paint();
    S.saving = true; paint();
    var done = 0, failed = "", lost = null;
    // count what the register already holds for these lines, so a save whose answer is lost can be checked afterwards
    var monthList = async function () { var r0 = await E.apiFetch("/dda-purchases" + "/entries?month=" + a.entry_date.slice(0, 7), { method: "GET" }); return (r0 && r0.ok && r0.entries) || []; };
    var same = function (e, l) { return e.entry_date === a.entry_date && String(e.dda_name_dose).trim().toLowerCase() === String(l.dda_name_dose).trim().toLowerCase() && Number(e.quantity) === Number(l.quantity) && String(e.invoice_number).trim() === a.invoice_number && String(e.agent).trim().toLowerCase() === a.agent.toLowerCase(); };
    var before = null; try { before = await monthList(); } catch (e0) { before = null; }
    for (var i = 0; i < todo.length; i++) {
      var l = todo[i];
      try {
        var r = await E.apiFetch("/dda-purchases/entries", { method: "POST", body: JSON.stringify({ entry_date: a.entry_date, dda_name_dose: l.dda_name_dose, quantity: Number(l.quantity), agent: a.agent, invoice_number: a.invoice_number }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
        l.saved = true; done++;
      } catch (x) { failed = x && x.network ? E.saveFailText(x) : String((x && (x.message || x)) || "error"); lost = x && x.network ? l : null; break; } // stop: the rest stay in the form
    }
    if (lost && before) { // the answer was lost: look in the register before anything is sent again
      try {
        var after = await monthList();
        if (after.filter(function (e) { return same(e, lost); }).length > before.filter(function (e) { return same(e, lost); }).length) { lost.saved = true; done++; failed = todo[done] ? "the connection dropped (the line before it did save)" : ""; }
        else failed = "the connection dropped and it is not in the register";
      } catch (e1) { failed = "the connection dropped. Check the register below before pressing Record again"; }
    }
    S.saving = false;
    if (!failed) { S.adding = null; E.toast(done === 1 ? "1 line recorded" : done + " lines recorded", "success"); if (monthOf(a.entry_date) !== S.month) S.month = monthOf(a.entry_date); }
    else S.err = (done ? done + " saved. " : "") + "Not saved from " + (todo[done] || {}).dda_name_dose + ": " + String(failed).replace(/\.$/, "") + ". Press Record to try the rest again.";
    return load();
  }

  E.registerModule({
    id: "cdpreg", title: "Controlled drugs received", order: 3, icon: "℞", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.month = today().slice(0, 7); S.adding = null; S.err = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("cdpreg") < 0) E.UI2_DESTINATIONS.push("cdpreg");
  if (E.UI2_PARENT) E.UI2_PARENT.cdpreg = "registers";
})();
