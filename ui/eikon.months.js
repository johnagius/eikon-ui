/* ============================================================
   EIKON — the month a register shows, and its printout  (eikon.months.js)
   Shared by the new-layout registers. Nothing here reads or writes data: each screen keeps its own calls (the
   month it asks the server for, or the dated list it already has) and its own save flows. This file only draws:

   E.months.bar(month, opts)   "‹ October 2026 ›" with a month/year picker, "This month" and Print.
                               opts: { print: false } to leave Print out, { label: "Paid out" } for screen readers,
                               { min: "2015-01" } the first month offered.
   E.months.wire(root, opts)   after each paint: opts.month() is the shown month, opts.go(ym) moves to another
                               (the screen sets its month and reads it), opts.paint() redraws (the picker opening),
                               opts.print() prints. ← and → on the bar
                               move a month, Enter on the month opens the picker; focus comes back after the repaint.
   E.months.empty(ym, now)     "Nothing recorded in September 2026." (now: the screen's own words for this month)
   E.months.print(doc)         the printout in a new tab, black on white, A4: the pharmacy, the register, the month,
                               page numbers, the classic screen's columns (each screen passes them), and signature
                               lines only where the classic printout has them. doc: { register, month | period,
                               sections: [{ heading, sub, cols: [...], rows: [[...]], foot: [...], empty, wide }],
                               intro, after, sign: [...], landscape }. Cells are text (escaped here); a cell
                               given as { html } is used as is (built by the screen from escaped parts).
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymd(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function isYm(s) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(s || "")); }

  var M = E.months = {};
  M.today = function () { return ymd(new Date()); };
  M.now = function () { return M.today().slice(0, 7); };
  M.valid = isYm;
  M.shift = function (ym, k) { var p = String(ym).split("-"), d = new Date(Number(p[0]), Number(p[1]) - 1 + k, 1); return d.getFullYear() + "-" + pad(d.getMonth() + 1); };
  M.label = function (ym) { var p = String(ym).split("-"); return MON[Number(p[1]) - 1] + " " + p[0]; };
  M.days = function (ym) { var p = String(ym).split("-"); return new Date(Number(p[0]), Number(p[1]), 0).getDate(); };
  M.first = function (ym) { return ym + "-01"; };
  M.last = function (ym) { return ym + "-" + pad(M.days(ym)); };
  M.isNow = function (ym) { return ym === M.now(); };
  M.inMonth = function (v, ym) { return String(v || "").slice(0, 7) === ym; };
  // Up to the end of the month, or to today for this month (a register is not kept ahead of time).
  M.lastShown = function (ym) { var t = M.today(), l = M.last(ym); return l > t ? t : l; };
  M.dmy = function (v) { var m = String(v == null ? "" : v).match(/^(\d{4})-(\d{2})-(\d{2})/); return m ? m[3] + "/" + m[2] + "/" + m[1] : String(v == null ? "" : v); };
  M.empty = function (ym, nowText) { return M.isNow(ym) && nowText ? nowText : "Nothing recorded in " + M.label(ym) + "."; };

  // ---- the bar
  function css() {
    if (document.getElementById("eikon-months-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-months-css";
    st.textContent =
      ".emb{display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin:16px 0 6px;position:relative}" +
      ".emb-m{display:flex;align-items:center;gap:2px}" +
      ".emb button{font:inherit;color:var(--text);cursor:pointer}" +
      ".emb-arrow{width:44px;height:44px;border-radius:50%;border:0;background:transparent;font-size:24px;line-height:1;display:grid;place-items:center;padding:0}" +
      ".emb-arrow:hover:not(:disabled){background:rgba(118,118,128,.12)}.emb-arrow:disabled{opacity:.3;cursor:default}" +
      ".emb-lab{min-height:44px;min-width:168px;border:0;border-radius:12px;background:transparent;font-size:17px!important;font-weight:700;letter-spacing:-.01em;padding:0 10px;display:inline-flex;align-items:center;justify-content:center;gap:6px}" +
      ".emb-lab:hover{background:rgba(118,118,128,.12)}.emb-lab i{font-style:normal;font-size:12px;color:var(--muted);font-weight:600}" +
      ".emb-pill{min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);font-size:14px!important;font-weight:600}" +
      ".emb-now{color:var(--accent)!important}" +
      ".emb-sp{flex:1}" +
      ".emb-pop{position:absolute;z-index:40;top:50px;left:0;width:300px;max-width:calc(100vw - 32px);background:var(--panel2);color:var(--text);border:1px solid var(--border);border-radius:16px;box-shadow:0 12px 40px rgba(0,0,0,.18);padding:10px 12px 12px}" +
      ".emb-yr{display:flex;align-items:center;justify-content:space-between;margin-bottom:6px}.emb-yr b{font-size:17px}" +
      ".emb-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px}" +
      ".emb-grid button{min-height:44px;border-radius:12px;border:0;background:rgba(118,118,128,.10);font-size:15px!important;font-weight:600}" +
      ".emb-grid button:disabled{opacity:.35;cursor:default}" +
      ".emb-grid button[aria-current=true]{box-shadow:inset 0 0 0 2px var(--accent)}" +
      ".emb-grid button[aria-pressed=true]{background:var(--accent);color:#fff}" +
      ".emh{margin-top:30px}.emh-h{font-size:20px;font-weight:700;letter-spacing:-.01em;margin:0}" +
      ".emh-n{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:12px 2px 7px;display:flex;gap:8px}.emh-n b{color:var(--text)}" +
      ".emh-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".emh-row{display:flex;gap:12px;align-items:center;padding:10px 16px;border-top:.5px solid var(--border)}.emh-row:first-child{border-top:0}" +
      ".emh-row .t{flex:1;min-width:0}.emh-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.emh-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".emh-row em{font-style:normal;font-weight:600;font-size:13.5px;font-variant-numeric:tabular-nums;white-space:nowrap}" +
      ".emh-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:20px;color:var(--muted);margin-top:8px}" +
      ".emb-sr{position:absolute!important;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .emb-grid button[aria-pressed=true]{color:#00160E}}" +
      "@media (max-width:600px){.emb{gap:4px 6px}.emb-m{flex:1 1 214px;min-width:0}.emb-lab{min-width:0;flex:1;font-size:16px!important;padding:0 2px;white-space:nowrap}.emb-arrow{flex:0 0 44px}.emb-pill{padding:0 14px}.emb-sp{display:none}.emb-now{order:5}.emb-pop{left:0;right:0;width:auto}}" +
      "@media print{.emb,.emb-pop{display:none!important}}";
    document.head.appendChild(st);
  }
  M.css = css;

  var POP = { open: false, year: 0, from: null }; // the picker survives the screen's repaints
  M.bar = function (ym, o) {
    css(); o = o || {};
    var now = M.now(), min = o.min || "2010-01", atNow = ym >= now, atMin = ym <= min, lab = M.label(ym);
    var h = '<div class="emb" role="group" aria-label="' + esc((o.label ? o.label + ": " : "") + "month shown") + '" data-emb-min="' + esc(min) + '">' +
      '<div class="emb-m"><button type="button" class="emb-arrow" data-mb="prev" aria-label="Previous month, ' + esc(M.label(M.shift(ym, -1))) + '"' + (atMin ? " disabled" : "") + ">‹</button>" +
      '<button type="button" class="emb-lab" data-mb="pick" aria-haspopup="dialog" aria-expanded="' + (POP.open ? "true" : "false") + '" aria-label="' + esc(lab) + ', choose another month">' + esc(lab) + '<i aria-hidden="true">▾</i></button>' +
      '<button type="button" class="emb-arrow" data-mb="next" aria-label="' + (atNow ? "Next month (not yet)" : "Next month, " + esc(M.label(M.shift(ym, 1)))) + '"' + (atNow ? " disabled" : "") + ">›</button></div>" +
      (ym !== now ? '<button type="button" class="emb-pill emb-now" data-mb="now">This month</button>' : "") +
      '<span class="emb-sp"></span>' +
      (o.print === false ? "" : '<button type="button" class="emb-pill" data-mb="print" aria-label="Print ' + esc(lab) + '">' + esc(o.printLabel || "Print") + "</button>") +
      (POP.open ? popHtml(ym, min) : "") + "</div>";
    return h;
  };
  function popHtml(ym, min) {
    var now = M.now(), y = POP.year || Number(ym.slice(0, 4)), h = '<div class="emb-pop" role="dialog" aria-label="Choose a month">' +
      '<div class="emb-yr"><button type="button" class="emb-arrow" data-mb="yprev" aria-label="Year before, ' + (y - 1) + '"' + (String(y - 1) < min.slice(0, 4) ? " disabled" : "") + ">‹</button><b>" + y + "</b>" +
      '<button type="button" class="emb-arrow" data-mb="ynext" aria-label="Year after, ' + (y + 1) + '"' + (String(y + 1) > now.slice(0, 4) ? " disabled" : "") + ">›</button></div>" +
      '<div class="emb-grid">';
    for (var i = 1; i <= 12; i++) {
      var k = y + "-" + pad(i), off = k > now || k < min;
      h += '<button type="button" data-mb="m" data-ym="' + k + '" aria-label="' + MON[i - 1] + " " + y + '"' + (k === ym ? ' aria-pressed="true"' : "") + (k === now ? ' aria-current="true"' : "") + (off ? " disabled" : "") + ">" + SHORT[i - 1] + "</button>";
    }
    return h + "</div></div>";
  }

  var live = null;
  function say(t) {
    if (!live) { live = document.createElement("div"); live.className = "emb-sr"; live.setAttribute("aria-live", "polite"); live.setAttribute("role", "status"); live.id = "emb-live"; css(); document.body.appendChild(live); }
    live.textContent = ""; setTimeout(function () { live.textContent = t; }, 30);
  }
  M.said = function () { return live ? live.textContent : ""; };

  var refocus = null; // which control had focus when the month changed, so the repainted bar gives it back
  // The screens redraw more than once for one change (reading…, then the month). A bar control that had focus when
  // its bar was replaced gets it back in the new bar, unless focus has gone somewhere else meanwhile.
  var held = null;
  M.wire = function (root, o) {
    var bar = root && root.querySelector(".emb"); if (!bar) return;
    var cur = function () { return o.month(); };
    var min = bar.getAttribute("data-emb-min") || "2010-01";
    var go = function (ym, keep) {
      if (!isYm(ym)) return;
      if (ym > M.now()) ym = M.now(); if (ym < min) ym = min;
      POP.open = false; POP.year = 0; refocus = keep || null;
      if (ym === cur()) { o.paint(); return; }
      say("Showing " + M.label(ym));
      o.go(ym);
    };
    var close = function (back) { POP.open = false; POP.year = 0; refocus = back ? "pick" : null; o.paint(); };
    bar.addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-mb]"); if (!b || b.disabled) return;
      var a = b.getAttribute("data-mb"), ym = cur();
      if (a === "prev") go(M.shift(ym, -1), "prev");
      else if (a === "next") go(M.shift(ym, 1), M.shift(ym, 1) >= M.now() ? "pick" : "next");
      else if (a === "now") go(M.now(), "pick");
      else if (a === "print") { if (o.print) o.print(); }
      else if (a === "pick") { if (POP.open) close(true); else { POP.open = true; POP.year = Number(ym.slice(0, 4)); refocus = "grid"; o.paint(); } }
      else if (a === "yprev" || a === "ynext") { POP.year += a === "ynext" ? 1 : -1; refocus = a; o.paint(); }
      else if (a === "m") go(b.getAttribute("data-ym"), "pick");
    });
    bar.addEventListener("keydown", function (ev) {
      var t = ev.target, inGrid = t.closest && t.closest(".emb-grid");
      if (ev.key === "Escape" && POP.open) { ev.preventDefault(); close(true); return; }
      if (inGrid) {
        var list = [].slice.call(bar.querySelectorAll(".emb-grid button")), i = list.indexOf(t), step = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -3, ArrowDown: 3 }[ev.key];
        if (step) { ev.preventDefault(); for (var j = i + step; j >= 0 && j < list.length; j += step) { if (!list[j].disabled) { list[j].focus(); break; } } }
        return;
      }
      if (POP.open || !(t.closest && t.closest(".emb-m, .emb-now, [data-mb=print]"))) return;
      if (ev.key === "ArrowLeft" && !bar.querySelector("[data-mb=prev]").disabled) { ev.preventDefault(); go(M.shift(cur(), -1), t.getAttribute("data-mb") === "prev" ? "prev" : "pick"); }
      else if (ev.key === "ArrowRight" && !bar.querySelector("[data-mb=next]").disabled) { ev.preventDefault(); go(M.shift(cur(), 1), "pick"); }
    });
    if (POP.open) {
      var outside = function (ev) { if (!document.body.contains(bar)) return document.removeEventListener("mousedown", outside, true); if (!bar.contains(ev.target)) { document.removeEventListener("mousedown", outside, true); close(false); } };
      document.addEventListener("mousedown", outside, true);
    }
    bar.addEventListener("focusin", function (ev) { var t = ev.target.closest && ev.target.closest("[data-mb]"); held = t ? { mb: t.getAttribute("data-mb"), ym: t.getAttribute("data-ym"), at: Date.now() } : null; });
    bar.addEventListener("focusout", function () { setTimeout(function () { var a = document.activeElement; if (a && a !== document.body && !(a.closest && a.closest(".emb"))) held = null; }, 0); });
    if (!refocus && held && Date.now() - held.at < 8000 && (!document.activeElement || document.activeElement === document.body)) refocus = held.ym ? "grid" : held.mb;
    if (refocus) {
      var want = refocus; refocus = null;
      var el = want === "grid" ? (bar.querySelector(".emb-grid [aria-pressed=true]") || bar.querySelector(".emb-grid button:not(:disabled)")) : bar.querySelector('[data-mb="' + want + '"]');
      if (el && el.disabled) el = bar.querySelector("[data-mb=pick]");
      if (el) try { el.focus({ preventScroll: true }); } catch (e) { el.focus(); }
    }
  };
  // a screen left with the picker open does not open the next one with it
  M.reset = function () { POP.open = false; POP.year = 0; refocus = null; };

  // ---- a month's records under a screen that is about something else (what is open, what is due): its own month,
  // read when shown, one line per record, the empty month said in words, and Print. The screen gives:
  //   cfg.title, cfg.label (screen readers), cfg.fetch(ym) → Promise of the month's records, cfg.row(e) → { t, s, r }
  //   (title, second line, right; text), cfg.print(ym, rows), cfg.paint() (the screen's redraw), cfg.dep (when it
  //   changes, e.g. the screen's own list after a save, the month is read again; a function is asked at each paint
  //   and undefined means "still reading"; cfg.local: the month is cut from the screen's own list, so it is cut again
  //   once that list has arrived), cfg.active() (still on screen?).
  var H = {};
  M.history = function (key, cfg) {
    css();
    var st = H[key] || (H[key] = { month: M.now(), rows: [], loading: false, error: "", got: "", dep: undefined, seq: 0 });
    st.cfg = cfg;
    var dep = typeof cfg.dep === "function" ? cfg.dep() : cfg.dep; // undefined: no news (the screen is still reading)
    if (dep !== undefined && dep !== st.dep) { if (st.dep !== undefined || cfg.local) st.got = ""; st.dep = dep; }
    if (st.got !== st.month && !st.loading) readH(key);
    var lab = M.label(st.month), h = '<section class="emh" data-emh="' + esc(key) + '"><h2 class="emh-h">' + esc(cfg.title || "By month") + "</h2>" + M.bar(st.month, { label: cfg.label || cfg.title });
    if (st.loading && st.got !== st.month) h += '<div class="emh-quiet">Opening ' + esc(lab) + "…</div>";
    else if (st.error) h += '<div class="emh-quiet">' + esc(st.error) + "</div>";
    else if (!st.rows.length) h += '<div class="emh-quiet" data-empty>' + esc(M.empty(st.month, cfg.nowText)) + "</div>";
    else h += '<div class="emh-n">' + esc(lab) + " <b>" + st.rows.length + '</b></div><div class="emh-list">' + st.rows.map(function (e) {
      var r = cfg.row(e) || {};
      return '<div class="emh-row"><div class="t"><b>' + esc(r.t) + "</b>" + (r.s ? "<span>" + esc(r.s) + "</span>" : "") + "</div>" + (r.r ? "<em>" + esc(r.r) + "</em>" : "") + "</div>";
    }).join("") + "</div>";
    return h + "</section>";
  };
  async function readH(key) {
    var st = H[key], want = st.month, seq = ++st.seq; st.loading = true; st.error = "";
    try { var rows = await st.cfg.fetch(want); if (seq !== st.seq) return; st.rows = rows || []; st.got = want; }
    catch (e) { if (seq !== st.seq) return; st.rows = []; st.got = want; st.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not read " + M.label(want)); }
    st.loading = false;
    if (st.cfg.active && !st.cfg.active()) return;
    var root = document.querySelector('[data-emh="' + key + '"]'), mount = root && root.closest(".eikon-content");
    if (E.whenFormIdle && mount) E.whenFormIdle(mount, st.cfg.paint); else st.cfg.paint();
  }
  M.wireHistory = function (root, key) {
    var st = H[key], sec = root && root.querySelector('[data-emh="' + key + '"]'); if (!st || !sec) return;
    M.wire(sec, { month: function () { return st.month; }, go: function (ym) { st.month = ym; st.rows = []; st.got = ""; st.seq++; st.loading = false; st.cfg.paint(); },
      paint: st.cfg.paint, print: function () { st.cfg.print(st.month, st.rows.slice()); } });
  };
  M.historyMonth = function (key) { return H[key] ? H[key].month : M.now(); };
  // a screen opened afresh starts on this month and reads it again (also done for every section when the screen is left)
  M.historyReset = function (key) { if (H[key]) { H[key].month = M.now(); H[key].got = ""; H[key].rows = []; H[key].seq++; H[key].loading = false; H[key].dep = undefined; } M.reset(); };
  window.addEventListener("hashchange", function () {
    var at = String(location.hash || "").replace(/^#/, "").split(/[?&/]/)[0];
    Object.keys(H).forEach(function (k) { if (k !== at) M.historyReset(k); });
    POP.open = false;
  });

  // Two screens another change is working on (Orders, Questions) take their month section from here, so their own files
  // change by three lines each: M.history(key, M.preset(name, { paint, dep })), M.wireHistory, M.historyReset.
  var PRESETS = {
    orders: { key: "ordreg", title: "By month", label: "Orders taken", nowText: "No order taken this month yet.",
      fetch: async function (ym) { var r = await E.apiFetch("/client-orders/entries?month=" + encodeURIComponent(ym), { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load orders"); return (r.entries || []).filter(function (e) { return M.inMonth(e.order_date, ym); }).sort(function (a, b) { return String(b.order_date).localeCompare(String(a.order_date)) || b.id - a.id; }); },
      row: function (e) { return { t: (e.client_name || "") + (e.order_code ? " · " + e.order_code : ""), s: [M.dmy(e.order_date), e.items_text, e.client_phone].filter(Boolean).join(" · "), r: Number(e.fulfilled) ? "Ready" : "Waiting" }; },
      print: function (ym, rows) {
        var pr = function (p) { var n = Number(p || 2); return n === 1 ? "1 (High)" : n === 3 ? "3 (Low)" : "2 (Medium)"; };
        var fu = { called: "Called", not_wanted: "Not Wanted", not_available: "Not Available", called_no_answer: "Called (No Answer)", wrong_number: "Wrong Number" };
        var dep = function (v) { var n = Number(v); return isFinite(n) && n > 0 ? (Math.round(n * 100) / 100).toFixed(2) : ""; };
        M.print({ register: "Client Orders", month: ym, landscape: true, sections: [{ cols: ["Code", "Date", "Client", "Address", "Contact", "Alternate", "Email", "Item/s", "Priority", "Needed by", "Pick Up Date", { h: "Deposit", num: true }, "Follow-up", "Additional Notes", "Fulfilled"],
          rows: rows.slice().reverse().map(function (r) { var f = String(r.follow_up_status || "").trim(); return [r.order_code || "-", M.dmy(r.order_date), r.client_name || "", r.client_address || "", r.client_phone || "", r.client_alt_phone || "", r.client_email || "", r.items_text || "", pr(r.priority), M.dmy(r.needed_by), M.dmy(r.pickup_date), dep(r.deposit_amount), (fu[f] || f) || "-", r.notes || "", r.fulfilled ? "Yes" : "No"]; }) }] });
      } },
    questions: { key: "tktreg", title: "By month", label: "Questions opened", nowText: "No question opened this month yet.",
      fetch: async function (ym) { var r = await E.apiFetch("/client-tickets/entries", { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not load questions"); return (r.entries || []).filter(function (e) { return M.inMonth(e.open_date, ym); }).sort(function (a, b) { return String(b.open_date).localeCompare(String(a.open_date)) || b.id - a.id; }); },
      row: function (e) { var done = Number(e.resolved) || e.status === "Resolved" || e.status === "Closed"; return { t: (e.client_name || "") + (e.ticket_id ? " · " + e.ticket_id : ""), s: [M.dmy(e.open_date), e.category, e.issue].filter(Boolean).join(" · "), r: done ? "Answered" : (e.status || "Open") }; },
      print: function (ym, rows) {
        var pr = function (p) { var n = Number(p || 2); return n === 1 ? "1 — High" : n === 3 ? "3 — Low" : "2 — Medium"; };
        var p2 = function (n) { return (n < 10 ? "0" : "") + n; };
        var ts = function (iso) { if (!iso) return ""; var d = new Date(iso); return isNaN(d.getTime()) ? iso : p2(d.getDate()) + "/" + p2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + p2(d.getHours()) + ":" + p2(d.getMinutes()); };
        var notes = function (raw) { var a = raw; if (!Array.isArray(a)) { try { a = JSON.parse(String(raw || "[]")); } catch (e) { a = []; } } if (!Array.isArray(a) || !a.length) return "—"; return a.map(function (n) { return "[" + ts(n.ts) + "] " + (n.author ? n.author + ": " : "") + String(n.text || ""); }).join("\n"); };
        M.print({ register: "Client Tickets", month: ym, landscape: true, sections: [{ cols: ["Ticket #", "Date", "Client", "Phone", "Email", "Category", "Priority", "Status", "Assigned To", "Follow-up", "Issue", "Notes Log"],
          rows: rows.slice().reverse().map(function (r) { return [r.ticket_id || "", M.dmy(r.open_date), r.client_name || "", r.phone || "", r.email || "", r.category || "", pr(r.priority), r.status || "", r.assigned_to || "", r.followup_date ? M.dmy(r.followup_date) : "—", r.issue || "", { html: esc(notes(r.notes_log)).replace(/\n/g, "<br>") }]; }) }] });
      } }
  };
  M.preset = function (name, extra) {
    var b = PRESETS[name], o = {}; Object.keys(b).forEach(function (k) { o[k] = b[k]; }); Object.keys(extra || {}).forEach(function (k) { o[k] = extra[k]; });
    if (!o.active) o.active = function () { return E.state && E.state.activeModuleId === b.key; };
    return o;
  };

  // ---- the printout
  function cellHtml(v) { return v && typeof v === "object" && "html" in v ? String(v.html) : esc(v == null ? "" : v); }
  M.printHtml = function (doc) {
    var u = (E.state && E.state.user) || {}, loc = u.location_name || "", org = u.org_name || "";
    var period = doc.period || (doc.month ? M.label(doc.month) : ""), t = new Date();
    var printed = pad(t.getDate()) + "/" + pad(t.getMonth() + 1) + "/" + t.getFullYear() + " " + pad(t.getHours()) + ":" + pad(t.getMinutes());
    var head = '<header class="ph"><div><b>' + esc(loc || org || "Pharmacy") + "</b>" + (org && loc && org !== loc ? "<span>" + esc(org) + "</span>" : "") + "</div>" +
      "<div><h1>" + esc(doc.register) + "</h1><span>" + esc(period) + "</span></div></header>";
    var body = (doc.intro || "") + (doc.sections || []).map(function (s) {
      var cols = s.cols || [], h = "<section" + (s.wide ? ' class="wide"' : "") + ">";
      if (s.heading) h += "<h2>" + esc(s.heading) + "</h2>";
      if (s.sub) h += '<p class="sub">' + esc(s.sub) + "</p>";
      h += "<table><thead><tr>" + cols.map(function (c) { var n = typeof c === "string" ? c : c.h; return "<th" + (c.num ? ' class="n"' : "") + ">" + esc(n) + "</th>"; }).join("") + "</tr></thead><tbody>";
      var rows = s.rows || [];
      h += rows.length ? rows.map(function (r) { return "<tr>" + r.map(function (v, i) { return "<td" + (cols[i] && cols[i].num ? ' class="n"' : "") + ">" + cellHtml(v) + "</td>"; }).join("") + "</tr>"; }).join("")
        : '<tr><td colspan="' + Math.max(1, cols.length) + '" class="none">' + esc(s.empty || ("Nothing recorded in " + period + ".")) + "</td></tr>";
      h += "</tbody>";
      if (s.foot) h += "<tfoot><tr>" + s.foot.map(function (v, i) { return "<td" + (cols[i] && cols[i].num ? ' class="n"' : "") + ">" + cellHtml(v) + "</td>"; }).join("") + "</tr></tfoot>";
      return h + "</table></section>";
    }).join("") + (doc.after || "");
    var sign = (doc.sign || []).length ? '<div class="sign">' + doc.sign.map(function (s) { return "<div><span></span><small>" + esc(s) + "</small></div>"; }).join("") + "</div>" : "";
    var foot = esc((loc || "") + (loc ? " · " : "") + doc.register + (period ? " · " + period : ""));
    return "<!doctype html><html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'><title>" + esc(doc.register + (period ? " · " + period : "")) + "</title><style>" +
      "@page{size:A4 " + (doc.landscape ? "landscape" : "portrait") + ";margin:12mm 10mm 14mm;@bottom-left{content:\"" + foot.replace(/"/g, "'") + "\";font:9px system-ui,sans-serif;color:#000}@bottom-right{content:\"Page \" counter(page) \" of \" counter(pages);font:9px system-ui,sans-serif;color:#000}}" +
      "*{box-sizing:border-box}body{font-family:system-ui,-apple-system,'Segoe UI',Roboto,Arial,sans-serif;margin:18px;color:#000;background:#fff;font-size:12px}" +
      ".ph{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;border-bottom:2px solid #000;padding-bottom:8px;margin-bottom:12px}.ph b{font-size:15px;display:block}.ph span{font-size:12px;display:block}.ph div:last-child{text-align:right}" +
      "h1{font-size:19px;margin:0;font-weight:800}h2{font-size:14px;margin:16px 0 4px;break-after:avoid;page-break-after:avoid}.sub{margin:0 0 6px;font-size:11px}" +
      "table{width:100%;border-collapse:collapse;margin:4px 0 10px}th,td{border:1px solid #000;padding:4px 6px;font-size:10.5px;text-align:left;vertical-align:top;overflow-wrap:anywhere}" +
      "th{background:#eee;font-weight:700}td.n,th.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}td.none{font-style:italic}tfoot td{font-weight:700;background:#f4f4f4}" +
      "td.bad{font-weight:700}td.miss{font-style:italic}tr{break-inside:avoid;page-break-inside:avoid}thead{display:table-header-group}" +
      ".sign{display:flex;gap:28px;margin-top:28px;break-inside:avoid}.sign div{flex:1}.sign span{display:block;border-bottom:1px solid #000;height:30px}.sign small{font-size:10px}" +
      ".pf{margin-top:10px;font-size:10px}@media print{body{margin:0}.pf{display:none}}" +
      "</style></head><body>" + head + body + sign +
      "<p class='pf'>" + esc(foot) + " · printed " + esc(printed) + "</p>" +
      "<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){}try{window.print();}catch(e){}},150);});<\/script></body></html>";
  };
  // Opens the printout in a new tab (as the classic screens do), or the same page when a new tab is refused.
  M.print = function (doc) {
    var html = M.printHtml(doc);
    M.lastPrint = { register: doc.register, month: doc.month || "", html: html };
    var url = URL.createObjectURL(new Blob([html], { type: "text/html" })), w = null;
    try { w = window.open(url, "_blank", "noopener"); } catch (e) { w = null; }
    if (!w) { try { var a = document.createElement("a"); a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); } catch (e2) {} }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e3) {} }, 60000);
    return html;
  };
})();
