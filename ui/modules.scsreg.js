/* Scarce stock, new layout: hard-to-get lines that pharmacies have spare, and who asked for them. Other pharmacies'
   stock with how many are left, where you ask for some with a private note; what you asked for, which you can change or
   withdraw; and what you share, with who asked for how many (only you and the asking pharmacy see who and the note — the
   server blanks it for everyone else). Sharing a line and changing or closing it are here too. What other pharmacies are
   short of is Shortages (ssreg). Deleting a line, placing it on Transfers or Returns, closed lines and printing stay in
   the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, offers: [], loading: false, error: "", q: "", busy: {}, asking: null, changingReq: null, editing: null, draft: {}, adding: null, saving: false, err: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  // The year is left out when it is this year (3 Nov), kept otherwise (4 Mar 2027).
  function dm(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + (Number(p[0]) === new Date().getFullYear() ? "" : " " + p[0]) : ""; }
  function low(s) { return String(s || "").toLowerCase(); }
  function whole(s) { return /^\d+$/.test(String(s || "")) ? Number(s) : null; }
  function leftOf(o) { return Math.max(0, Number(o.remaining_quantity) || 0); }
  function expired(o) { return !!(o.expiry_date && isYmd(o.expiry_date) && o.expiry_date < today()); }
  function where(o) { return (o.org_name ? o.org_name + " — " : "") + (o.location_name || ""); }
  function myReqs(o) { return (o.requests || []).filter(function (r) { return r.mine; }); }

  function css() {
    if (document.getElementById("eikon-scsreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-scsreg-css";
    st.textContent =
      ".scs{max-width:880px;margin:0 auto}" +
      ".scs-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".scs-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".scs h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.scs-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".scs-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".scs-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.scs-btn:disabled{opacity:.55;cursor:default}.scs-btn.s{height:30px;padding:0 12px;font-size:13px;border-radius:15px}" +
      ".scs-btn.red{color:var(--danger)}" +
      ".scs-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".scs-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;gap:8px}.scs-lab b{color:var(--text)}" +
      ".scs-card{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin-bottom:10px;min-width:0}" +
      ".scs-card .h{display:flex;justify-content:space-between;align-items:baseline;gap:10px;min-width:0}.scs-card .h b{font-size:15.5px;font-weight:600;min-width:0;overflow-wrap:anywhere}" +
      ".scs-card .h em{font-style:normal;font-weight:700;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".scs-card .s{font-size:12.5px;color:var(--muted);margin-top:3px;overflow-wrap:anywhere}.scs-card .d{font-size:14px;margin-top:4px;white-space:pre-wrap;overflow-wrap:anywhere}" +
      ".scs-line{display:flex;align-items:center;gap:10px;padding:8px 0 0;margin-top:8px;border-top:.5px solid var(--border);font-size:14px;flex-wrap:wrap}.scs-line .t{flex:1;min-width:150px;overflow-wrap:anywhere}.scs-line small{display:block;color:var(--muted);font-size:12px;white-space:pre-wrap}" +
      ".scs-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--muted);white-space:nowrap;margin-left:6px}.scs-pill.bad{background:rgba(215,0,21,.10);color:var(--danger)}" +
      ".scs-card .a{display:flex;justify-content:flex-end;gap:8px;margin-top:8px;flex-wrap:wrap}" +
      ".scs-in,.scs-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:10px}.scs-in{background:rgba(118,118,128,.07);border:0}" +
      ".scs-in label,.scs-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.scs-in label:first-child,.scs-form label:first-child{border-top:0}" +
      ".scs-in label>span,.scs-form label>span{flex:0 0 96px;font-size:15px}.scs-in input,.scs-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".scs-in .acts,.scs-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end;align-items:center;flex-wrap:wrap}.scs-in .acts .l,.scs-form .acts .l{margin-right:auto}" +
      ".scs-hint{font-size:12.5px;color:var(--muted);padding:4px 14px}.scs-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".scs-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:18px;color:var(--muted)}" +
      ".scs-foot{font-size:12.5px;color:var(--muted);margin-top:12px}.scs-foot a{color:var(--accent)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) :is(.scs-err,.scs-btn.red,.scs-pill.bad){color:#FF7A72}}" +
      "@media (max-width:600px){.scs{padding:4px 16px 0}.scs h1{font-size:32px}.scs-in label>span,.scs-form label>span{flex-basis:84px}}";
    document.head.appendChild(st);
  }

  async function fetchOffers(all) { // open lines only, as the classic shows by default; all=1 only to check a save that lost its answer
    var r = await E.apiFetch("/scarce-stock/offers" + (all ? "" : "?open=1"), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load scarce stock");
    return r.offers || [];
  }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { S.offers = await fetchOffers(); } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load scarce stock"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function matches(o) {
    var q = low(S.q).trim(); if (!q) return true;
    return [o.item_name, o.description, o.batch, o.org_name, o.location_name].some(function (x) { return low(x).indexOf(q) >= 0; });
  }
  function errLine() { return S.err ? '<div class="scs-err" role="alert">' + esc(S.err) + "</div>" : ""; }
  function busyAttr() { return S.saving ? " disabled" : ""; }

  function facts(o, mine) {
    var bits = [];
    if (!mine) bits.push(where(o));
    bits.push((mine ? "Shared " : "") + dm(o.entry_date));
    if (o.batch) bits.push("batch " + o.batch);
    if (o.expiry_date) bits.push("expires " + dm(o.expiry_date));
    return '<div class="s">' + esc(bits.join(" · ")) + (expired(o) ? '<span class="scs-pill bad">Expired</span>' : "") + "</div>" + (o.description ? '<div class="d">' + esc(o.description) + "</div>" : "");
  }
  function reqForm(id, label) {
    return '<form class="scs-in" id="scs-req" autocomplete="off"><label><span>How many</span><input name="quantity_requested" inputmode="numeric" value="' + esc(S.draft.quantity_requested || "") + '" placeholder="' + esc(label) + '"></label>' +
      '<label><span>Note</span><input name="note" value="' + esc(S.draft.note || "") + '" placeholder="Optional, e.g. customer and phone"></label>' +
      '<div class="scs-hint">Only you and the pharmacy that has it see the note. Others see only how many.</div>' + errLine() +
      '<div class="acts"><button type="button" class="scs-btn" data-act="req-cancel">Cancel</button><button type="submit" class="scs-btn p"' + busyAttr() + ">" + (S.saving ? "Saving…" : S.changingReq ? "Save" : "Ask for it") + "</button></div></form>";
  }

  // Someone else's line: how many are left, and asking for some.
  function otherCard(o) {
    var left = leftOf(o), asked = Number(o.total_requested) || 0;
    var h = '<div class="scs-card"><div class="h"><b>' + esc(o.item_name) + "</b><em>" + (left ? left + " left" : "None left") + "</em></div>" + facts(o, false);
    if (asked) h += '<div class="s">' + esc(asked + " of " + (Number(o.quantity_available) || 0) + " already asked for") + "</div>";
    if (S.asking === o.id && !S.changingReq) h += reqForm(o.id, left + " left");
    else if (left && !expired(o)) h += '<div class="a"><button class="scs-btn s p" data-act="ask" data-id="' + o.id + '">Ask for some</button></div>';
    return h + "</div>";
  }
  // A line you asked for: your request(s), to change or withdraw.
  function askedCard(o) {
    var h = '<div class="scs-card"><div class="h"><b>' + esc(o.item_name) + "</b><em>" + leftOf(o) + " left</em></div>" + facts(o, false);
    myReqs(o).forEach(function (r) {
      if (S.changingReq === r.id) { h += reqForm(o.id, "How many"); return; }
      h += '<div class="scs-line"><div class="t">You asked for <b>' + esc(r.quantity_requested) + "</b>" + (r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</div>" +
        '<button class="scs-btn s" data-act="req-change" data-id="' + r.id + '" data-offer="' + o.id + '">Change</button>' +
        '<button class="scs-btn s red" data-act="req-withdraw" data-id="' + r.id + '"' + (S.busy["r" + r.id] ? " disabled" : "") + ">Withdraw</button></div>";
    });
    return h + "</div>";
  }
  // A line you share: who asked for how many (you see who and the note; the server shows it only to the two of you).
  function mineCard(o) {
    var left = leftOf(o), reqs = o.requests || [];
    var h = '<div class="scs-card"><div class="h"><b>' + esc(o.item_name) + "</b><em>" + left + " of " + (Number(o.quantity_available) || 0) + " left</em></div>" + facts(o, true);
    if (S.editing === o.id) {
      var d = S.draft;
      h += '<form class="scs-in" id="scs-edit" autocomplete="off"><label><span>Item</span><input name="item_name" value="' + esc(d.item_name) + '"></label>' +
        '<label><span>How many</span><input name="quantity_available" inputmode="numeric" value="' + esc(d.quantity_available) + '"></label>' +
        '<label><span>Expiry</span><input name="expiry_date" type="date" value="' + esc(d.expiry_date) + '"></label><label><span>Batch</span><input name="batch" value="' + esc(d.batch) + '" placeholder="Optional"></label>' +
        '<label><span>Details</span><input name="description" value="' + esc(d.description) + '" placeholder="Optional, seen by every pharmacy"></label>' + errLine() +
        '<div class="acts"><button type="button" class="scs-btn s red l" data-act="close-line"' + busyAttr() + '>None left</button><button type="button" class="scs-btn" data-act="edit-cancel">Cancel</button><button type="submit" class="scs-btn p"' + busyAttr() + ">" + (S.saving ? "Saving…" : "Save") + "</button></div></form>";
    } else {
      h += reqs.map(function (r) {
        return '<div class="scs-line"><div class="t"><b>' + esc(r.quantity_requested) + "</b> · " + esc(r.is_private ? "Another pharmacy" : (r.requester_display || "Another pharmacy")) + (!r.is_private && r.note ? "<small>" + esc(r.note) + "</small>" : "") + "</div></div>";
      }).join("");
      if (!reqs.length) h += '<div class="s" style="margin-top:8px">Nobody has asked for it yet.</div>';
      h += '<div class="a"><button class="scs-btn s" data-act="edit" data-id="' + o.id + '">Change</button></div>';
    }
    return h + "</div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "scsreg") return; // left before a reply came back: do not draw over the next screen
    if (!fromState) keep();
    var h = '<div class="scs"><button class="scs-back" data-act="back">‹ Stock</button>' +
      '<div class="scs-top"><div><h1>Scarce stock</h1><p class="scs-sub">Hard-to-get lines pharmacies have spare, and who asked for them.</p></div>' + (S.adding ? "" : '<button class="scs-btn p" data-act="add">Share stock</button>') + "</div>";
    if (S.adding) {
      var a = S.adding;
      h += '<form class="scs-form" id="scs-add" autocomplete="off"><label><span>Item</span><input name="item_name" value="' + esc(a.item_name || "") + '" placeholder="e.g. Shingrix vaccine"></label>' +
        '<label><span>How many</span><input name="quantity_available" inputmode="numeric" value="' + esc(a.quantity_available || "") + '"></label>' +
        '<label><span>Expiry</span><input name="expiry_date" type="date" value="' + esc(a.expiry_date || "") + '"></label><label><span>Batch</span><input name="batch" value="' + esc(a.batch || "") + '" placeholder="Optional"></label>' +
        '<label><span>Details</span><input name="description" value="' + esc(a.description || "") + '" placeholder="Optional, e.g. pack size, fridge"></label>' +
        '<div class="scs-hint">Every pharmacy on Eikon sees this line, with your pharmacy\'s name.</div>' + (S.adding && !S.asking && !S.editing && !S.changingReq ? errLine() : "") +
        '<div class="acts"><button type="button" class="scs-btn" data-act="add-cancel">Cancel</button><button type="submit" class="scs-btn p"' + busyAttr() + ">" + (S.saving ? "Saving…" : "Share it") + "</button></div></form>";
    }
    h += '<input class="scs-q" id="scs-q" type="search" aria-label="Search scarce stock" placeholder="Search item, pharmacy or batch" value="' + esc(S.q) + '">';
    if (S.loading && !S.offers.length) h += '<div class="scs-quiet" style="margin-top:14px">Opening scarce stock…</div>';
    else if (S.error) h += '<div class="scs-quiet" style="margin-top:14px">' + esc(S.error) + "</div>";
    else {
      var list = S.offers.filter(function (o) { return !(o.is_closed === 1 || o.is_closed === true) && matches(o); });
      var mine = list.filter(function (o) { return o.mine_owner; }), others = list.filter(function (o) { return !o.mine_owner; });
      var asked = others.filter(function (o) { return myReqs(o).length; }), rest = others.filter(function (o) { return !myReqs(o).length; });
      if (asked.length) h += '<div class="scs-lab">You asked for <b>' + asked.length + "</b></div>" + asked.map(askedCard).join("");
      h += '<div class="scs-lab">Other pharmacies have <b>' + rest.length + "</b></div>" + (rest.length ? rest.map(otherCard).join("") : '<div class="scs-quiet">' + (S.q ? "Nothing matches “" + esc(S.q) + "”." : "No other pharmacy is sharing scarce stock right now.") + "</div>");
      h += '<div class="scs-lab">You share <b>' + mine.length + "</b></div>" + (mine.length ? mine.map(mineCard).join("") : '<div class="scs-quiet">' + (S.q ? "None of yours match." : "You are not sharing anything right now.") + "</div>");
    }
    h += '<p class="scs-foot">Can\'t find it? <a href="#ssreg" data-act="shortages">Ask in Shortages</a>, where pharmacies list what they are short of. Deleting a line, placing it on Transfers or Returns, closed lines and printing are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    var ae = document.activeElement, sel = ae && m.contains(ae) && ae.name ? "[name=" + ae.name + "]" : (ae && ae.id === "scs-q" ? "#scs-q" : "");
    var caret = ae && ae.id === "scs-q" ? ae.selectionStart : null;
    m.innerHTML = h;
    if (sel) { var again = m.querySelector(sel); if (again) { again.focus(); if (caret != null) try { again.setSelectionRange(caret, caret); } catch (x) {} } }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (act === "back") window.location.hash = "#stock";
        else if (act === "add") { reset(); S.adding = {}; paint(true); focusSoon("#scs-add [name=item_name]"); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); }
        else if (act === "ask") { reset(); S.asking = id; paint(true); focusSoon("#scs-req [name=quantity_requested]"); }
        else if (act === "req-change") {
          var o = S.offers.find(function (x) { return x.id === Number(b.getAttribute("data-offer")); }), r = o && myReqs(o).find(function (x) { return x.id === id; });
          if (!r) return; reset(); S.asking = o.id; S.changingReq = id; S.draft = { quantity_requested: String(r.quantity_requested), note: r.note || "" }; paint(true); focusSoon("#scs-req [name=quantity_requested]");
        }
        else if (act === "req-cancel") { S.asking = null; S.changingReq = null; S.err = ""; paint(true); }
        else if (act === "req-withdraw") withdraw(id);
        else if (act === "edit") {
          var e = S.offers.find(function (x) { return x.id === id; }); if (!e) return;
          reset(); S.editing = id; S.draft = { item_name: e.item_name || "", quantity_available: String(Number(e.quantity_available) || 0), expiry_date: isYmd(e.expiry_date) ? e.expiry_date : "", batch: e.batch || "", description: e.description || "" }; paint(true); focusSoon("#scs-edit [name=quantity_available]");
        }
        else if (act === "edit-cancel") { S.editing = null; S.err = ""; paint(true); }
        else if (act === "close-line") saveLine(true);
        else if (act === "shortages") { ev.preventDefault(); window.location.hash = "#ssreg"; }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "scsreg"); } catch (x) {} E.openClassic("scarcestock"); }
      });
    });
    var q = m.querySelector("#scs-q"); if (q) q.addEventListener("input", function () { S.q = q.value; paint(); });
    var fr = m.querySelector("#scs-req"); if (fr) fr.addEventListener("submit", function (ev) { ev.preventDefault(); ask(); });
    var fe = m.querySelector("#scs-edit"); if (fe) fe.addEventListener("submit", function (ev) { ev.preventDefault(); saveLine(false); });
    var fa = m.querySelector("#scs-add"); if (fa) fa.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
  }
  function reset() { S.adding = null; S.asking = null; S.changingReq = null; S.editing = null; S.draft = {}; S.err = ""; }
  function focusSoon(sel) { var m = S.mount; setTimeout(function () { var f = m && m.querySelector(sel); if (f && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form") && document.activeElement !== f)) f.focus(); }, 30); }
  function keep() {
    var m = S.mount; if (!m) return;
    var grab = function (fsel, keys, into) { var f = m.querySelector(fsel); if (f && into) keys.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) into[k] = String(el.value || "").trim(); }); };
    grab("#scs-req", ["quantity_requested", "note"], S.draft);
    grab("#scs-edit", ["item_name", "quantity_available", "expiry_date", "batch", "description"], S.draft);
    grab("#scs-add", ["item_name", "quantity_available", "expiry_date", "batch", "description"], S.adding);
    var q = m.querySelector("#scs-q"); if (q) S.q = q.value;
  }

  // Ask for some of another pharmacy's line (POST, at most once), or change how many you asked for (PUT sends both
  // fields the server stores: quantity and note). Never more than is left: the server checks a new request, not a change.
  async function ask() {
    if (S.saving) return;
    keep();
    var o = S.offers.find(function (x) { return x.id === S.asking; }); if (!o) return;
    var q = whole(S.draft.quantity_requested), was = 0; S.err = "";
    if (S.changingReq) { var r0 = myReqs(o).find(function (x) { return x.id === S.changingReq; }); was = r0 ? Number(r0.quantity_requested) || 0 : 0; }
    var room = leftOf(o) + was;
    if (!q || q < 1) S.err = "Write how many (a whole number). Nothing was sent.";
    else if (q > room) S.err = (room ? "Only " + room + " can be asked for." : "None left.") + " Nothing was sent.";
    if (S.err) return paint(true);
    S.saving = true; paint(true);
    var body = { quantity_requested: q, note: S.draft.note || "" }, offerId = o.id, reqId = S.changingReq;
    try {
      if (reqId) {
        var r = await E.apiFetch("/scarce-stock/offer-requests/" + encodeURIComponent(String(reqId)), { method: "PUT", body: JSON.stringify(body) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Could not save");
        E.toast("Changed to " + q, "success");
      } else {
        await E.postOnce("/scarce-stock/offers/" + encodeURIComponent(String(offerId)) + "/requests", body, {
          list: async function () { var all = await fetchOffers(true); var x = all.find(function (y) { return y.id === offerId; }); return x ? x.requests || [] : []; },
          same: function (rr) { return rr.mine && Number(rr.quantity_requested) === q; } });
        E.toast("Asked " + (o.org_name || "them") + " for " + q, "success");
      }
      S.asking = null; S.changingReq = null; S.draft = {};
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }
  async function withdraw(id) {
    if (S.busy["r" + id] || !window.confirm("Withdraw this request? The pharmacy will no longer see it.")) return;
    S.busy["r" + id] = true; paint();
    try {
      var r = await E.apiFetch("/scarce-stock/offer-requests/" + encodeURIComponent(String(id)), { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not withdraw");
      E.toast("Request withdrawn", "success");
    } catch (x) { E.toast(E.saveFailText(x), "error"); }
    S.busy["r" + id] = false; return load();
  }
  // Change your own line. The server's PUT replaces the whole record, so every field goes back: what is in the form,
  // and the date it was shared and whether it is closed from the record as it is.
  async function saveLine(close) {
    if (S.saving) return;
    keep();
    var o = S.offers.find(function (x) { return x.id === S.editing; }); if (!o) return;
    var d = S.draft, q = whole(d.quantity_available), asked = Number(o.total_requested) || 0; S.err = "";
    if (!close) {
      if (!d.item_name) S.err = "Write the item. Nothing was saved.";
      else if (q == null || q < 1) S.err = "Write how many you have (a whole number), or press None left. Nothing was saved.";
      else if (q < asked) S.err = asked + " are already asked for: write at least " + asked + ", or press None left. Nothing was saved.";
      else if (d.expiry_date && !isYmd(d.expiry_date)) S.err = "Write the expiry as a date. Nothing was saved.";
      if (S.err) return paint(true);
    } else if (!window.confirm("Mark “" + o.item_name + "” as none left? It is closed and other pharmacies stop seeing it.")) return;
    S.saving = true; paint(true);
    var body = close
      ? { entry_date: o.entry_date, item_name: o.item_name, description: o.description || "", batch: o.batch || "", expiry_date: o.expiry_date || null, quantity_available: Number(o.quantity_available) || 0, is_closed: 1 }
      : { entry_date: o.entry_date, item_name: d.item_name, description: d.description || "", batch: d.batch || "", expiry_date: d.expiry_date || null, quantity_available: q, is_closed: Number(o.is_closed) ? 1 : 0 };
    try {
      var r = await E.apiFetch("/scarce-stock/offers/" + encodeURIComponent(String(o.id)), { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not save");
      E.toast(close ? "Closed: " + o.item_name : "Saved", "success"); S.editing = null; S.draft = {};
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }
  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding, q = whole(a.quantity_available); S.err = "";
    if (!a.item_name) S.err = "Write the item. Nothing was shared.";
    else if (!q || q < 1) S.err = "Write how many you can spare (a whole number). Nothing was shared.";
    else if (a.expiry_date && !isYmd(a.expiry_date)) S.err = "Write the expiry as a date. Nothing was shared.";
    else if (a.expiry_date && a.expiry_date < today()) S.err = "That expiry date has passed: expired stock cannot be shared. Nothing was shared.";
    if (S.err) return paint(true);
    S.saving = true; paint(true);
    var body = { entry_date: today(), item_name: a.item_name, description: a.description || "", batch: a.batch || "", expiry_date: a.expiry_date || null, quantity_available: q, is_closed: 0 };
    try {
      await E.postOnce("/scarce-stock/offers", body, { list: function () { return fetchOffers(); },
        same: function (o) { return o.mine_owner && low(o.item_name).trim() === low(body.item_name) && Number(o.quantity_available) === q && o.entry_date === body.entry_date; } });
      S.adding = null; E.toast("Shared " + body.item_name + " with every pharmacy", "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "scsreg", title: "Scarce stock", order: 3, icon: "🔎", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; reset(); S.busy = {}; S.saving = false; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("scsreg") < 0) E.UI2_DESTINATIONS.push("scsreg");
  if (E.UI2_PARENT) E.UI2_PARENT.scsreg = "stock";
})();
