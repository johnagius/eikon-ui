/* Credit notes, new layout: money customers have with the pharmacy. Find a customer (name, phone or receipt), see what
   is left on each note, use some or all of it, record a new note. Using a note first reads it again from the server and
   never takes more than is left (the server itself does not check). Expired notes with money left are listed apart.
   Corrections, deleting notes or uses, notes and printing stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, entries: [], loading: false, error: "", q: "", using: null, draft: {}, adding: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // The year is left out when it is this year (3 Nov), kept otherwise (4 Mar 2027): rows stay on fewer lines on a phone.
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === new Date().getFullYear() ? "" : " " + p[0]) : ""; }
  function eur(n) { return "€" + (Math.round((Number(n) || 0) * 100) / 100).toFixed(2); }
  function money(raw) { var s = String(raw || "").replace(/[€\s]/g, "").replace(",", "."); return /^\d+(\.\d{1,2})?$/.test(s) && Number(s) > 0 ? Number(s) : null; }
  function left(cn) { var used = (cn.purchase_entries || []).reduce(function (t, p) { return t + (Number(p.amount) || 0); }, 0); return Math.round(((Number(cn.amount) || 0) - used) * 100) / 100; }
  function expired(cn) { return !cn.no_expiry && cn.expiry_date && cn.expiry_date < today(); }
  function low(s) { return String(s || "").toLowerCase(); }

  function css() {
    if (document.getElementById("eikon-cnreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-cnreg-css";
    st.textContent =
      ".cnr{max-width:880px;margin:0 auto}" +
      ".cnr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".cnr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".cnr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.cnr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".cnr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".cnr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cnr-btn:disabled{opacity:.55;cursor:default}" +
      ".cnr-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".cnr-sum{font-size:13.5px;color:var(--muted);margin:10px 2px 0}.cnr-sum b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".cnr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.cnr-lab b{color:var(--text)}" +
      ".cnr-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:10px}" +
      ".cnr-card .h{display:flex;justify-content:space-between;align-items:baseline;gap:10px}.cnr-card .h b{font-size:15.5px;font-weight:600}.cnr-card .h em{font-style:normal;font-size:19px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--ok)}" +
      ".cnr-card.old .h em{color:var(--muted)}.cnr-card .s{font-size:12.5px;color:var(--muted);margin-top:3px}.cnr-card .s a{color:var(--accent);text-decoration:none}" +
      ".cnr-card .a{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}" +
      ".cnr-in{margin-top:10px;border-radius:10px;background:rgba(118,118,128,.07)}" +
      ".cnr-in label,.cnr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.cnr-in label:first-child,.cnr-form label:first-child{border-top:0}" +
      ".cnr-in label>span,.cnr-form label>span{flex:0 0 96px;font-size:15px}.cnr-in input,.cnr-form input:not([type=checkbox]){flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".cnr-in .acts,.cnr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end;align-items:center}.cnr-in .acts .all{margin-right:auto;border:0;background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;cursor:pointer;padding:0}" +
      ".cnr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".cnr-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".cnr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.cnr{padding:4px 16px 0}.cnr h1{font-size:32px}}";
    document.head.appendChild(st);
  }

  async function fetchAll() {
    var r = await E.apiFetch("/creditnotes/list", { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load credit notes");
    return r.entries || [];
  }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { S.entries = await fetchAll(); }
    catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load credit notes"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function card(cn) {
    var rem = left(cn), old = expired(cn);
    var sub = [];
    if (cn.telephone) sub.push('<a href="tel:' + esc(String(cn.telephone).replace(/\s+/g, "")) + '">' + esc(cn.telephone) + "</a>");
    sub.push(eur(cn.amount) + " from " + esc(dm(cn.issue_date))); if (cn.receipt_number) sub.push("Receipt " + esc(cn.receipt_number));
    sub.push(cn.no_expiry || !cn.expiry_date ? "No end date" : (old ? "Expired " : "Until ") + esc(dm(cn.expiry_date)));
    var h = '<div class="cnr-card' + (old ? " old" : "") + '"><div class="h"><b>' + esc(cn.client_name) + " " + esc(cn.client_surname) + "</b><em>" + eur(rem) + ' left</em></div><div class="s">' + sub.join(" · ") + "</div>";
    if (S.using === cn.id) {
      h += '<form class="cnr-in" id="cnr-use" autocomplete="off"><label><span>Using €</span><input name="amount" inputmode="decimal" value="' + esc(S.draft.amount || "") + '" placeholder="0.00"></label>' +
        '<label><span>Receipt no.</span><input name="receipt_number" value="' + esc(S.draft.receipt_number || "") + '" placeholder="Optional"></label>' + (S.err ? '<div class="cnr-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><button type="button" class="all" data-act="all">Use all ' + eur(rem) + '</button><button type="button" class="cnr-btn" data-act="cancel">Cancel</button><button type="submit" class="cnr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Use") + "</button></div></form>";
    } else if (rem > 0 && !old) h += '<div class="a"><button class="cnr-btn p" data-act="use" data-id="' + cn.id + '">Use</button></div>';
    return h + "</div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "cnreg") return; // left before a reply came back: do not draw over the next screen
    var qi = m.querySelector("#cnr-q"); if (qi) S.q = qi.value;
    if (!fromState) keep();
    var h = '<div class="cnr"><button class="cnr-back" data-act="back">‹ Stock</button>' +
      '<div class="cnr-top"><div><h1>Credit notes</h1><p class="cnr-sub">Money customers have with you, and what is left of it.</p></div>' + (S.adding ? "" : '<button class="cnr-btn p" data-act="add">New credit note</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, fld = function (k, label, extra) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + "></label>"; };
      h += '<form class="cnr-form" id="cnr-add" autocomplete="off">' + fld("client_name", "Name") + fld("client_surname", "Surname") + fld("telephone", "Phone", ' type="tel"') + fld("amount", "Amount €", ' inputmode="decimal" placeholder="0.00"') +
        fld("receipt_number", "Receipt no.", ' placeholder="Optional"') + fld("issue_date", "Issued", ' type="date" max="' + esc(today()) + '"') + fld("expiry_date", "Expires", ' type="date" min="' + esc(a.issue_date || today()) + '"') +
        (S.err && !S.using ? '<div class="cnr-err">' + esc(S.err) + "</div>" : "") +
        '<div class="acts"><span style="margin-right:auto;font-size:12.5px;color:var(--muted)">Leave Expires empty for no end date.</span><button type="button" class="cnr-btn" data-act="add-cancel">Cancel</button><button type="submit" class="cnr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Record") + "</button></div></form>";
    }
    if (S.loading && !S.entries.length) h += '<div class="cnr-quiet">Opening credit notes…</div>';
    else if (S.error) h += '<div class="cnr-quiet">' + esc(S.error) + "</div>";
    else {
      h += '<input class="cnr-q" id="cnr-q" type="search" placeholder="Customer name, phone or receipt" value="' + esc(S.q) + '">';
      var q = low(S.q).trim(), match = function (cn) { return !q || [cn.client_name + " " + cn.client_surname, cn.client_surname + " " + cn.client_name, cn.telephone, cn.receipt_number].some(function (v) { return low(v).indexOf(q) >= 0; }); };
      var withMoney = S.entries.filter(function (cn) { return left(cn) > 0; });
      var open = withMoney.filter(function (cn) { return !expired(cn) && match(cn); }), old = withMoney.filter(function (cn) { return expired(cn) && match(cn); });
      if (!q) h += '<p class="cnr-sum"><b>' + withMoney.filter(function (cn) { return !expired(cn); }).length + "</b> open, <b>" + eur(withMoney.filter(function (cn) { return !expired(cn); }).reduce(function (t, cn) { return t + left(cn); }, 0)) + "</b> owed to customers.</p>";
      h += '<div class="cnr-lab">Open <b>' + open.length + "</b></div>" + (open.length ? open.map(card).join("") : '<div class="cnr-quiet">' + (q ? "No open credit note for “" + esc(S.q) + "”." : "No open credit notes.") + "</div>");
      if (old.length) h += '<div class="cnr-lab">Expired with money left <b>' + old.length + "</b></div>" + old.map(card).join("");
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Changing a note, undoing a use, notes and printing are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) ? (ae.id === "cnr-q" ? "#cnr-q" : ae.name ? "[name=" + ae.name + "]" : "") : "";
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = "#stock";
        else if (act === "add") { S.adding = { issue_date: today() }; S.using = null; S.err = ""; paint(true); setTimeout(function () { var f = m.querySelector("[name=client_name]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); }
        else if (act === "use") { S.using = Number(b.getAttribute("data-id")); S.draft = {}; S.err = ""; S.adding = null; paint(true); setTimeout(function () { var f = m.querySelector("#cnr-use [name=amount]"); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) f.focus(); }, 30); }
        else if (act === "all") { var cn = S.entries.find(function (x) { return x.id === S.using; }); keep(); S.draft.amount = cn ? left(cn).toFixed(2) : ""; paint(true); }
        else if (act === "cancel") { S.using = null; S.err = ""; paint(true); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "cnreg"); } catch (x) {} E.openClassic("creditnotes"); }
      });
    });
    var qn = m.querySelector("#cnr-q"); if (qn) qn.addEventListener("input", function () { paint(); });
    var fu = m.querySelector("#cnr-use"); if (fu) fu.addEventListener("submit", function (ev) { ev.preventDefault(); use(); });
    var fa = m.querySelector("#cnr-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
  }

  function keep() {
    var m = S.mount; if (!m) return;
    var fu = m.querySelector("#cnr-use"); if (fu) ["amount", "receipt_number"].forEach(function (k) { var el = fu.querySelector("[name=" + k + "]"); if (el) S.draft[k] = el.value; });
    var fa = m.querySelector("#cnr-add"); if (fa && S.adding) ["client_name", "client_surname", "telephone", "amount", "receipt_number", "issue_date", "expiry_date"].forEach(function (k) { var el = fa.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
  }

  async function use() {
    if (S.saving) return;
    keep();
    var amt = money(S.draft.amount); S.err = "";
    if (amt == null) { S.err = "Write the amount used, e.g. 12.50. Nothing was saved."; return paint(true); }
    S.saving = true; paint(true);
    try {
      var fresh = await fetchAll(); S.entries = fresh; // what is left right now, not when the screen opened
      var cn = fresh.find(function (x) { return x.id === S.using; });
      if (!cn) throw new Error("this credit note is no longer there");
      var rem = left(cn);
      if (expired(cn)) throw new Error("this credit note expired on " + dm(cn.expiry_date));
      if (amt > rem + 0.004) throw new Error("only " + eur(rem) + " is left on it");
      var rec = String(S.draft.receipt_number || "").trim();
      var sameUse = function (pe) { return Math.abs((Number(pe.amount) || 0) - amt) < 0.005 && String(pe.receipt_number || "") === rec; };
      var had = (cn.purchase_entries || []).filter(sameUse).length;
      try {
        var r = await E.apiFetch("/creditnotes/entries/" + encodeURIComponent(String(cn.id)) + "/purchases", { method: "POST", body: JSON.stringify({ amount: amt, receipt_number: rec }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      } catch (x0) { // the answer was lost: did the use arrive? Never use the note twice.
        if (!(x0 && x0.network)) throw x0;
        var again = (await fetchAll()).find(function (x) { return x.id === cn.id; });
        if (!again || (again.purchase_entries || []).filter(sameUse).length <= had) throw x0;
      }
      E.toast(eur(amt) + " used · " + eur(rem - amt) + " left for " + cn.client_name, "success");
      S.using = null; S.draft = {};
    } catch (x) { S.err = E.saveFailText(x) + "."; }
    S.saving = false; return load();
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding, amt = money(a.amount); S.err = "";
    if (!a.client_name) S.err = "Write the customer's name. Nothing was saved.";
    else if (!a.client_surname) S.err = "Write the customer's surname. Nothing was saved.";
    else if (!a.telephone) S.err = "Write a phone number. Nothing was saved.";
    else if (amt == null) S.err = "Write the amount, e.g. 15.00. Nothing was saved.";
    else if (!/^\d{4}-\d{2}-\d{2}$/.test(a.issue_date || "")) S.err = "Choose the day it was issued. Nothing was saved.";
    else if (a.expiry_date && a.expiry_date < a.issue_date) S.err = "The end date is before the day it was issued. Nothing was saved.";
    if (S.err) return paint(true);
    S.saving = true; paint(true);
    try {
      var r = await E.apiFetch("/creditnotes/entries", { method: "POST", body: JSON.stringify({ issue_date: a.issue_date, client_name: a.client_name, client_surname: a.client_surname, telephone: a.telephone, email: "", receipt_number: a.receipt_number || "", amount: amt, expiry_date: a.expiry_date || "", no_expiry: 0 }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Credit note of " + eur(amt) + " for " + a.client_name, "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "cnreg", title: "Credit notes", order: 3, icon: "€", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.using = null; S.adding = null; S.err = ""; S.q = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("cnreg") < 0) E.UI2_DESTINATIONS.push("cnreg");
  if (E.UI2_PARENT) E.UI2_PARENT.cnreg = "stock";
})();
