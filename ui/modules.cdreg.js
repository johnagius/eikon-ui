/* Controlled drugs by medicine (new layout, cdreg). One running register per medicine, built from the four
   controlled-drug registers as they are: received (DDA purchases), supplied (DDA sales), POYC and stock takes.
   Nothing is saved from here and no register's saved lines change: the quick buttons open the register's own form
   (Controlled drugs received / supplied / POYC, which save exactly as before) with the medicine already written in.
   Reads (read only, bounded by date on the registers' date indexes; see the worker's /dda-register routes):
     GET /dda-register/medicines?to=        the medicines written or counted in the last 92 days: the list to pick from
     GET /dda-register/ledger?term&from&to  every line of one medicine and its counts. Without from, the server starts
                                            at the count before the latest, so the latest count is checked.
   Both are kept here for 60 s (and dropped after any save made in this tab).
   The balance: it starts at a stock-take count; received adds, supplied and POYC take away; the next count is compared
   with what the register says, and a difference is shown plainly with what to do next. Lines written with another
   spelling of the same medicine are named, not guessed into the balance. Same-day lines are placed before or after a
   count by the time each was written.
   Also used by the forms: E.cdBalance(name) answers what the register holds now for a medicine (for "after this").
   No legal print is changed: Print here is a new working sheet, the monthly registers print as before. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "cdreg", TTL = 60000;
  // every key ends in the pharmacy (location): nothing kept here is ever read in another pharmacy
  function loc() { var u = E.state && E.state.user; return u && u.location_id != null ? String(u.location_id) : "0"; }
  function KEEP() { return "eikon_cdreg_med:" + loc(); }
  function HAND() { return "eikon_cd_hand:" + loc(); }
  function INC() { return "eikon_cdreg_inc:" + loc(); }
  // the other spellings ticked for a medicine ("count these lines in its balance"), remembered in this browser
  function incOf(k) { try { var o = JSON.parse(localStorage.getItem(INC()) || "{}"); return Array.isArray(o[k]) ? o[k].filter(function (x) { return typeof x === "string"; }) : []; } catch (e) { return []; } }
  function setInc(k, list) { try { var o = JSON.parse(localStorage.getItem(INC()) || "{}"); if (list.length) o[k] = list; else delete o[k]; localStorage.setItem(INC(), JSON.stringify(o)); } catch (e) {} }
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var S = { mount: null, q: "", meds: null, medsErr: "", medsLoading: false, key: "", name: "", term: "", led: null, ledErr: "", ledLoading: false, from: "" };
  var cache = { meds: null, led: {} };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { return E.maltaYmd ? E.maltaYmd(new Date()) : new Date().toISOString().slice(0, 10); }
  function shift(ymd, n) { var d = new Date(ymd + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); }
  function dm(ymd) { var p = String(ymd || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] : String(ymd || ""); }
  function dmy(ymd) { var p = String(ymd || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : String(ymd || ""); }
  function utc(s) { var t = String(s || "").replace(" ", "T"); return t ? new Date(/Z|[+-]\d\d:?\d\d$/.test(t) ? t : t + "Z") : null; }
  function maltaDay(s) { var d = utc(s); return d && isFinite(d.getTime()) && E.maltaYmd ? E.maltaYmd(d) : String(s || "").slice(0, 10); }
  function n(v) { var x = Number(v); return isFinite(x) ? x : 0; }
  function plural(k, one, many) { return k + " " + (k === 1 ? one : many); }

  // One medicine, however it was typed: case, spaces, and "10 mg" / "10mg" do not make another medicine.
  function key(s) { return String(s || "").toLowerCase().replace(/\s+/g, " ").trim().replace(/(\d)\s+(mg|mcg|µg|g|ml|%)(?=\b|$|\s|\/)/g, "$1$2"); }
  function termOf(k) { var w = String(k).split(" ").filter(function (x) { return /[a-zà-ž]{2,}/i.test(x); })[0]; return (w || String(k)).slice(0, 80); }
  function countName(c) { return String(c.item_name || "").trim() + (String(c.dosage || "").trim() ? " " + String(c.dosage).trim() : ""); }

  // ---- reads ----
  async function getMeds(force) {
    if (!force && cache.meds && cache.meds.loc === loc() && Date.now() - cache.meds.at < TTL && cache.meds.w === E.lastWriteAt) return cache.meds.v;
    var r = await E.apiFetch("/dda-register/medicines?to=" + today(), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the medicines");
    var map = {};
    var add = function (name, kind, cnt, last, qty) {
      var k = key(name); if (!k) return;
      var m = map[k] || (map[k] = { key: k, names: {}, received: 0, supplied: 0, poyc: 0, counted: 0, qIn: 0, qOut: 0, lastMove: "", lastCount: "" });
      m.names[String(name).trim()] = (m.names[String(name).trim()] || 0) + n(cnt);
      m[kind] += n(cnt);
      if (kind === "received") m.qIn += n(qty); else if (kind !== "counted") m.qOut += n(qty);
      if (kind === "counted") { if (last > m.lastCount) m.lastCount = last; } else if (last > m.lastMove) m.lastMove = last;
    };
    (r.received || []).forEach(function (x) { add(x.name, "received", x.n, x.last, x.qty); });
    (r.supplied || []).forEach(function (x) { add(x.name, "supplied", x.n, x.last, x.qty); });
    (r.poyc || []).forEach(function (x) { add(x.name, "poyc", x.n, x.last, x.qty); });
    (r.counted || []).forEach(function (x) { add(countName(x), "counted", x.n, maltaDay(x.last)); });
    var list = Object.keys(map).map(function (k) { var m = map[k]; m.name = best(m.names); return m; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    cache.meds = { at: Date.now(), w: E.lastWriteAt, loc: loc(), v: list, from: String(r.from || "") };
    return list;
  }
  function best(names) { var top = "", c = -1; Object.keys(names).forEach(function (x) { if (names[x] > c || (names[x] === c && x < top)) { top = x; c = names[x]; } }); return top; }
  async function getLedger(term, from, force) {
    var ck = loc() + "|" + term + "|" + (from || "");
    var hit = cache.led[ck];
    if (!force && hit && Date.now() - hit.at < TTL && hit.w === E.lastWriteAt) return hit.v;
    var r = await E.apiFetch("/dda-register/ledger?term=" + encodeURIComponent(term) + "&to=" + today() + (from ? "&from=" + from : ""), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the register");
    cache.led[ck] = { at: Date.now(), w: E.lastWriteAt, v: r };
    return r;
  }

  // ---- the running register (pure: tests call E.cdLedger.build) ----
  // led: the ledger answer; k: the medicine's key; inc: other spellings the pharmacist ticked (their keys). Only lines
  // whose spelling is k or a ticked key are used: the server's answer is a superset ("morphine" also finds
  // "Morphine 100mg"), and a balance that mixed strengths would be the worst mistake this screen could make.
  // Returns { name, rows (oldest first, each with its balance), balance, counted (the latest count), issues
  // [{ tone, what, next, act }], variants [{ key, name, lines, on }] (every other spelling found), from, to }.
  // A line dated on a count's own day: the count's time is known, the line's is not, so the count is compared with the
  // lines of the days before it only; that day's lines come after it, each marked to be checked.
  function build(led, k, inc) {
    inc = inc || [];
    var useKey = function (kk) { return kk === k || inc.indexOf(kk) >= 0; };
    var rows = [], names = {}, others = {};
    var other = function (kk, nm) { var o = others[kk] || (others[kk] = { key: kk, names: {}, lines: 0 }); o.names[nm] = (o.names[nm] || 0) + 1; o.lines++; };
    var take = function (list, kind, field) {
      (list || []).forEach(function (e) {
        var nm = String(e[field] || "").trim(), kk = key(nm);
        if (kk !== k) other(kk, nm);
        if (!useKey(kk)) return;
        if (kk === k) names[nm] = (names[nm] || 0) + 1;
        var q = n(e.quantity);
        rows.push({ kind: kind, id: e.id, date: String(e.entry_date || ""), spelling: nm, qty: q, inQ: kind === "received" ? q : 0, outQ: kind === "received" ? 0 : q, e: e });
      });
    };
    take(led.received, "received", "dda_name_dose"); take(led.supplied, "supplied", "medicine_name_dose"); take(led.poyc, "poyc", "medicine_name_dose");
    var from = String(led.from || "");
    (led.counts || []).forEach(function (c) {
      var nm = countName(c), kk = key(nm), day = maltaDay(c.stocktake_at);
      if (day < from) return; // older counts: outside the period read
      if (kk !== k) other(kk, nm);
      if (!useKey(kk)) return;
      if (kk === k) names[nm] = (names[nm] || 0) + 1;
      rows.push({ kind: "count", id: c.id, stocktake: c.stocktake_id, date: day, spelling: nm, qty: n(c.qty_tablets), inQ: 0, outQ: 0, e: c });
    });
    // date order; on a count's day the count comes first (two spellings counted the same day are added together)
    var KO = { count: 0, received: 1, supplied: 1, poyc: 1 };
    rows.sort(function (a, b) { return a.date.localeCompare(b.date) || KO[a.kind] - KO[b.kind] || n(a.id) - n(b.id); });
    var merged = [];
    rows.forEach(function (r) { var last = merged[merged.length - 1]; if (r.kind === "count" && last && last.kind === "count" && last.date === r.date) { last.qty += r.qty; last.parts = (last.parts || 1) + 1; } else merged.push(r); });
    rows = merged;
    var bal = null, counted = null, issues = [], since = { inQ: 0, outQ: 0 }, moved = { inQ: 0, outQ: 0 }, countDays = {};
    rows.forEach(function (r) {
      if (r.kind === "count") {
        countDays[r.date] = 1;
        if (bal === null) r.opening = true;
        else { r.expected = bal; r.diff = r.qty - bal; }
        bal = r.qty; counted = r; since = { inQ: 0, outQ: 0 };
      } else {
        if (countDays[r.date]) r.sameDay = true;
        moved.inQ += r.inQ; moved.outQ += r.outQ;
        if (bal !== null) { bal += r.inQ - r.outQ; since.inQ += r.inQ; since.outQ += r.outQ; }
      }
      r.balance = bal;
    });
    var UNITS = "This assumes the invoices and the count use the same units (tablets).";
    // what to check, in plain words, each with the next step. Amber "Check", never red: the units are not proven.
    rows.forEach(function (r, i) {
      if (r.kind !== "count" || r.diff == null || r.diff === 0) return;
      var prev = null; for (var j = i - 1; j >= 0; j--) if (rows[j].kind === "count") { prev = rows[j]; break; }
      var span = prev ? dm(prev.date) + " to " + dm(r.date) : "up to " + dm(r.date);
      issues.push({ tone: "warn", row: r, what: "Check: counted " + r.qty + " on " + dm(r.date) + ", the registers give " + r.expected + " (" + Math.abs(r.diff) + (r.diff < 0 ? " fewer)." : " more)."),
        next: (r.diff < 0 ? "Count it again. Then look for a supply not written in: the prescriptions from " + span + ". If it still does not match, tell the pharmacist in charge."
          : "Count it again. Then look for a delivery not written in: the invoices from " + span + ". If it still does not match, tell the pharmacist in charge.") + " " + UNITS,
        act: r.diff < 0 ? "supplied" : "received" });
    });
    var lowAt = null; rows.forEach(function (r) { if (r.kind !== "count" && r.balance != null && r.balance < 0 && !lowAt) lowAt = r; });
    if (lowAt) issues.push({ tone: "warn", row: lowAt, what: "Check: the registers go below zero on " + dm(lowAt.date) + " (" + lowAt.balance + ").", next: "A delivery may not be written in. Check the invoices before " + dm(lowAt.date) + " and add it in Controlled drugs received. " + UNITS, act: "received" });
    var same = rows.filter(function (r) { return r.sameDay; });
    if (same.length) issues.push({ tone: "warn", what: "Check: " + plural(same.length, "line is", "lines are") + " dated on the same day as a count.", next: "The count is compared with the days before it. Check whether " + (same.length === 1 ? "it was" : "they were") + " written before or after the count; the balance after the count includes " + (same.length === 1 ? "it" : "them") + "." });
    // C9: never counted and more has gone out than came in: say it first, in one amber note (from the lines already read)
    var over = !counted ? moved.outQ - moved.inQ : 0;
    if (over > 0) issues.unshift({ tone: "warn", over: over, what: (best(names) || "This medicine") + ": " + over + " more supplied than received — count it now.", next: "No stock take has counted it since " + dm(from) + ", and more has gone out than came in. Count it now, and look for a delivery not written in Controlled drugs received.", act: "count" });
    else if (!counted) issues.push({ tone: "warn", what: "No stock take has counted it since " + dm(from) + ", so there is no balance to check against.", next: "Count it in the next stock take: the balance starts from that count.", act: "count" });
    var variants = Object.keys(others).filter(function (x) { return x; }).map(function (x) { return { key: x, name: best(others[x].names), lines: others[x].lines, on: inc.indexOf(x) >= 0 }; })
      .sort(function (a, b) { return (termOf(a.key) === termOf(k) ? 0 : 1) - (termOf(b.key) === termOf(k) ? 0 : 1) || b.lines - a.lines || a.name.localeCompare(b.name); });
    return { name: best(names) || "", key: k, inc: inc.slice(), rows: rows, balance: bal, counted: counted, since: since, moved: moved, issues: issues, variants: variants, from: from, to: String(led.to || ""), auto: !!led.auto_from };
  }
  E.cdLedger = { key: key, term: termOf, build: build };

  // What the register holds now for a medicine typed in a form (null: never counted, or not known). Cached with the ledger.
  E.cdBalance = async function (name) {
    var k = key(name); if (k.length < 3) return null;
    try { var b = build(await getLedger(termOf(k), ""), k, incOf(k)); return { key: k, name: b.name || String(name).trim(), balance: b.balance, counted: b.counted ? { qty: b.counted.qty, date: b.counted.date } : null, lines: b.rows.length }; }
    catch (e) { return null; }
  };
  // The balance check at entry, for the registers' own forms: under each medicine line, what the register holds and
  // what it will hold after this line. Only words: it never blocks a save and nothing is sent but the ledger read.
  // form: the form; dir: -1 supplied / POYC, +1 received. Call after each paint of the form.
  E.cdBalanceWire = function (form, dir) {
    if (!form) return;
    if (!document.getElementById("eikon-cdbal-css")) { var st = document.createElement("style"); st.id = "eikon-cdbal-css";
      st.textContent = ".cd-balhint{font-size:13px;color:var(--muted);padding:0 14px 8px;font-variant-numeric:tabular-nums}.cd-balhint:empty{display:none}"; document.head.appendChild(st); }
    form.querySelectorAll(".row").forEach(function (row) {
      var nm = row.querySelector("input.n"), qt = row.querySelector("input.q"); if (!nm || nm.disabled || !qt) return;
      var hint = row.nextElementSibling && row.nextElementSibling.classList.contains("cd-balhint") ? row.nextElementSibling : null;
      if (!hint) { hint = document.createElement("div"); hint.className = "cd-balhint"; hint.setAttribute("aria-live", "polite"); row.parentNode.insertBefore(hint, row.nextSibling); }
      var t = 0, seq = 0;
      var upd = async function () {
        var my = ++seq, name = String(nm.value || "").trim(), q = /^\d+$/.test(String(qt.value || "").trim()) ? Number(qt.value) : 0;
        if (key(name).length < 3) { hint.textContent = ""; return; }
        var b = await E.cdBalance(name); if (my !== seq || !hint.isConnected) return;
        var txt = "", warn = false;
        if (!b || (!b.counted && !b.lines)) txt = "";
        else if (b.balance == null) txt = "Not counted in a stock take yet, so there is no balance to check.";
        else if (!q) txt = "In the register: " + b.balance + ".";
        else { var after = b.balance + dir * q; warn = after < 0;
          txt = "In the register: " + b.balance + " · after this " + (dir > 0 ? "delivery" : "line") + ": " + after + "." + (warn ? " Check: that is below zero." : ""); }
        hint.textContent = txt;
      };
      var soon = function () { clearTimeout(t); t = setTimeout(upd, 350); };
      nm.addEventListener("change", upd); nm.addEventListener("blur", soon); qt.addEventListener("input", soon);
      if (String(nm.value || "").trim()) upd();
    });
  };
  // "Received" / "Supplied" / "POYC" from here: the register's own form opens with the medicine in its first line;
  // after Save (or Cancel) it comes back here. Taken once, within two minutes.
  E.cdHand = {
    give: function (to, name) { try { sessionStorage.setItem(HAND(), JSON.stringify({ to: to, name: name, at: Date.now() })); } catch (e) {} },
    take: function (to) {
      var h = null; try { h = JSON.parse(sessionStorage.getItem(HAND()) || "null"); } catch (e) {}
      if (!h || h.to !== to) return null;
      try { sessionStorage.removeItem(HAND()); } catch (e) {}
      return Date.now() - n(h.at) < 120000 ? h : null;
    },
    back: function () { window.location.hash = "#" + ID; }
  };
  // "This month by medicine" for Received / Supplied / POYC: from the month the screen already holds (no read).
  // entries: the month's lines; field: the medicine column; word: "in" or "out". Tap one: its running register.
  E.cdMonthSummary = function (entries, field, word) {
    var map = {};
    (entries || []).forEach(function (e) { var nm = String(e[field] || "").trim(), k = key(nm); if (!k) return; var m = map[k] || (map[k] = { names: {}, q: 0 }); m.names[nm] = (m.names[nm] || 0) + 1; m.q += n(e.quantity); });
    var list = Object.keys(map).map(function (k) { return { name: best(map[k].names), q: map[k].q }; }).sort(function (a, b) { return b.q - a.q || a.name.localeCompare(b.name); });
    if (!list.length) return "";
    if (!document.getElementById("eikon-cdsum-css")) { var st = document.createElement("style"); st.id = "eikon-cdsum-css";
      st.textContent = ".cd-msum{display:flex;flex-wrap:wrap;gap:6px;margin:4px 0 12px}.cd-msum button{font:inherit;font-size:13.5px;min-height:44px;padding:0 12px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
        "@media (max-width:600px){.cd-msum{flex-wrap:nowrap;overflow-x:auto;margin-left:-16px;margin-right:-16px;padding:0 16px 4px;scrollbar-width:none}.cd-msum button{flex:0 0 auto;white-space:nowrap}}" +
        ".cd-msum button b{font-weight:700;font-variant-numeric:tabular-nums;margin-left:4px}.cd-msum a{align-self:center;color:var(--accent);font-weight:600;font-size:13.5px;padding:0 6px;min-height:44px;display:inline-flex;align-items:center}"; document.head.appendChild(st); }
    return '<div class="cd-msum" role="group" aria-label="This month by medicine">' + list.slice(0, 8).map(function (x) {
      return '<button type="button" data-cdmed="' + esc(x.name) + '" aria-label="' + esc(x.name + ", " + x.q + " " + word + " this month: open its running register") + '">' + esc(x.name) + " <b>" + esc(x.q + " " + word) + "</b></button>"; }).join("") +
      (list.length > 8 ? '<a href="#cdreg">All ' + list.length + " medicines</a>" : "") + "</div>";
  };
  E.cdMonthWire = function (root) { if (root) root.querySelectorAll("[data-cdmed]").forEach(function (b) { b.addEventListener("click", function () { E.cdOpen(b.getAttribute("data-cdmed")); }); }); };
  // Open this screen on one medicine (the registers' "By medicine" links).
  E.cdOpen = function (name) { try { sessionStorage.setItem(KEEP(), String(name || "")); } catch (e) {} window.location.hash = "#" + ID; };

  // ---- drawing ----
  function css() {
    if (document.getElementById("eikon-cdreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-cdreg-css";
    st.textContent =
      ".cdr{max-width:1160px;margin:0 auto}" +
      ".cdr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 8px 0 0;margin-bottom:2px;cursor:pointer;min-height:44px}" +
      ".cdr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".cdr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800;overflow-wrap:anywhere}.cdr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".cdr-btn{font:inherit;font-size:14px;font-weight:600;min-height:44px;padding:0 16px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".cdr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cdr-btn:disabled{opacity:.55;cursor:default}.cdr-btn.t{border:0;background:none;color:var(--accent);padding:0 6px}" +
      ".cdr-find{display:flex;align-items:center;gap:10px;margin:18px 0 6px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:0 14px;min-height:48px}" +
      ".cdr-find:focus-within{outline:3px solid rgba(10,143,106,.45);outline-offset:1px}" +
      ".cdr-find input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:12px 0}" +
      ".cdr-lab2{align-items:center;justify-content:space-between}.cdr-lab2 .cdr-btn{text-transform:none;letter-spacing:0;font-size:14px;min-height:36px}" +
      ".cdr-lab{font-size:12px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.cdr-lab b{color:var(--text)}" +
      ".cdr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".cdr-med{display:flex;width:100%;align-items:center;justify-content:space-between;gap:12px;min-height:56px;padding:8px 16px;border:0;border-top:.5px solid var(--border);background:none;color:inherit;font:inherit;text-align:left;cursor:pointer}" +
      ".cdr-med:first-child{border-top:0}.cdr-med b{display:block;font-size:15.5px;font-weight:600;overflow-wrap:anywhere}.cdr-med span{display:block;font-size:13px;color:var(--muted);margin-top:2px}" +
      ".cdr-med .cdr-over{color:var(--text);font-weight:600}.cdr-med .cdr-over b{display:inline;font-size:13px;color:var(--warn,#9a6700)}.cdr-med.over{box-shadow:inset 3px 0 0 var(--warn,#c98a12)}" +
      ".cdr-med i{font-style:normal;font-size:13px;font-weight:600;color:var(--warn,#9a6700);white-space:nowrap}.cdr-med em{font-style:normal;color:var(--accent);font-size:20px}" +
      ".cdr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".cdr-sum{display:grid;grid-template-columns:auto 1fr;gap:4px 20px;align-items:end;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:16px 18px;margin-top:16px}" +
      ".cdr-sum .big{font-size:44px;font-weight:800;line-height:1;font-variant-numeric:tabular-nums;letter-spacing:-.02em}" +
      ".cdr-sum .big.nc{font-size:26px;letter-spacing:-.01em;line-height:1.2}.cdr-sum .lbl{font-size:13px;color:var(--muted)}.cdr-sum .how{font-size:14px;color:var(--text);align-self:center}" +
      ".cdr-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}" +
      ".cdr-note{border-radius:12px;padding:12px 14px;margin-top:12px;font-size:14.5px;border:1px solid var(--border)}" +
      ".cdr-note b{display:block;font-weight:700;margin-bottom:3px}.cdr-note p{margin:2px 0 0;color:var(--text)}.cdr-note .cdr-btn{margin-top:8px}" +
      
      ".cdr-note.warn{background:rgba(201,138,18,.10);border-color:rgba(201,138,18,.4)}" +
      ".cdr-note.ok{background:rgba(10,143,106,.08);border-color:rgba(10,143,106,.3)}" +
      ".cdr-tbl{width:100%;border-collapse:collapse;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;font-size:14.5px}" +
      ".cdr-tbl th{font-size:12px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);text-align:left;padding:10px 12px 6px;border-bottom:.5px solid var(--border)}" +
      ".cdr-tbl td{padding:9px 12px;border-top:.5px solid var(--border);vertical-align:top}.cdr-tbl tr:first-child td{border-top:0}" +
      ".cdr-tbl .n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}.cdr-tbl td.n{font-weight:600}.cdr-tbl .d{white-space:nowrap;color:var(--muted)}" +
      ".cdr-tbl .w b{font-weight:600}.cdr-tbl .w span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".cdr-tbl tr.cnt td{background:var(--bg)}.cdr-tbl tr.cnt.chk td{background:rgba(201,138,18,.10)}.cdr-tbl .flag{display:block;font-size:12.5px;font-weight:700;color:var(--text);margin-top:2px}" +
      ".cdr-vars label{display:flex;align-items:center;gap:10px;min-height:44px;font-size:14.5px;cursor:pointer}.cdr-vars input{width:20px;height:20px;accent-color:var(--accent);flex:0 0 auto}" +
      ".cdr-pill{display:inline-block;font-size:11.5px;font-weight:700;padding:1px 7px;border-radius:9px;background:rgba(215,38,28,.12);color:var(--danger);margin-left:6px;vertical-align:1px}" +
      ".cdr-more{display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap;color:var(--muted);font-size:13.5px;margin:10px 2px 0}" +
      ".cdr-vars{margin-top:12px;font-size:14px}.cdr-vars button{margin:6px 6px 0 0}" +
      "@media (max-width:600px){.cdr{padding:4px 16px 0}.cdr h1{font-size:28px}.cdr-sum{grid-template-columns:1fr}.cdr-sum .big{font-size:40px}" +
      ".cdr-tbl{font-size:14px}.cdr-tbl th,.cdr-tbl td{padding:8px 8px}.cdr-tbl th:first-child,.cdr-tbl td:first-child{padding-left:12px}.cdr-acts .cdr-btn{flex:1 1 calc(50% - 8px)}}";
    document.head.appendChild(st);
  }

  function here() { return E.state && E.state.activeModuleId === ID; }
  function paint() {
    var m = S.mount; if (!m || !here()) return;
    var ae = document.activeElement, focusKey = ae && m.contains(ae) ? ae.getAttribute("data-fk") : "";
    m.innerHTML = '<div class="cdr">' + (S.key ? oneHtml() : listHtml()) + "</div>";
    wire(m);
    if (focusKey) { var again = m.querySelector('[data-fk="' + focusKey + '"]'); if (again) { again.focus(); if (focusKey === "q" && again.setSelectionRange) { var L = again.value.length; again.setSelectionRange(L, L); } } }
  }

  function listHtml() {
    var h = '<button class="cdr-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Registers") + "</button>" +
      '<div class="cdr-top"><div><h1>Controlled drugs by medicine</h1><p class="cdr-sub">One running register for each medicine: what came in, what went out, and every count.</p></div></div>' +
      '<label class="cdr-find"><span class="vh" style="position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)">Find a medicine</span><span aria-hidden="true">⌕</span>' +
      '<input type="search" data-fk="q" data-act-input="q" value="' + esc(S.q) + '" placeholder="Find a medicine (generic or brand)" autocomplete="off" enterkeyhint="go"></label>';
    if (S.medsLoading && !S.meds) return h + '<div class="cdr-quiet">Opening the registers…</div>';
    if (S.medsErr && !S.meds) return h + '<div class="cdr-quiet" role="alert">' + esc(S.medsErr) + ' <button class="cdr-btn t" data-act="retry">Try again</button></div>';
    var all = S.meds || [], q = key(S.q), gens = [];
    if (q.length >= 2 && E.ddaDrugs && E.ddaDrugs.suggest) try { // a brand finds its generic: "xanax" finds alprazolam
      E.ddaDrugs.suggest(q, [], "/dda-sales").forEach(function (r) { (r.ds || []).forEach(function (d) { var g = key(d.g); if (gens.indexOf(g) < 0) gens.push(g); }); });
    } catch (e) {}
    var list = q ? all.filter(function (x) { return x.key.indexOf(q) >= 0 || gens.some(function (g) { return x.key.indexOf(g) >= 0; }) || Object.keys(x.names).some(function (y) { return key(y).indexOf(q) >= 0; }); }) : all;
    h += '<div class="cdr-lab">' + (q ? "Found" : "Written or counted in the last 3 months") + " <b>" + list.length + "</b></div>";
    if (!list.length) {
      h += '<div class="cdr-quiet" data-empty>' + (q ? "No medicine like “" + esc(S.q) + "” in the last 3 months. " + (q.length >= 2 ? '<button class="cdr-btn t" data-act="further">Look back a year for “' + esc(S.q) + "”</button>" : "")
        : "No controlled drug was received, supplied or counted in the last 3 months.") + "</div>";
      return h;
    }
    var none = list.every(function (x) { return !x.lastCount; }); // one sentence for all, not a warning on every row
    if (none) h += '<div class="cdr-note warn" role="status"><b>None of these has been counted in a stock take yet.</b><p>The balance of each starts at its first count.</p><button class="cdr-btn" data-nav="ddstreg">Open stock takes</button></div>';
    h += '<div class="cdr-list">' + list.map(function (x) {
      var bits = [];
      if (x.received) bits.push(x.qIn + " received");
      if (x.supplied + x.poyc) bits.push(x.qOut + " supplied");
      var cnt = x.lastCount ? "Counted " + dm(x.lastCount) : "", over = !x.lastCount ? x.qOut - x.qIn : 0; // C9: from the list already read
      var flag = over > 0 ? '<span class="cdr-over"><b>Check:</b> ' + esc(over + " more supplied than received — count it now") + "</span>" : "";
      return '<button class="cdr-med' + (over > 0 ? " over" : "") + '" data-open="' + esc(x.key) + '"><span style="min-width:0"><b>' + esc(x.name) + "</b><span>" + esc(bits.join(" · ") || "Counted only") + (cnt ? " · " + esc(cnt) : "") + "</span>" + flag + "</span>" +
        (x.lastCount || none ? '<em aria-hidden="true">›</em>' : '<i>Not counted</i>') + "</button>";
    }).join("") + "</div>";
    return h;
  }

  function who(e) { return [e.client_name, e.client_id_card].filter(Boolean).join(", "); }
  function rowWhat(r) {
    var e = r.e;
    var also = r.spelling && key(r.spelling) !== S.key ? '<span>Written “' + esc(r.spelling) + "”</span>" : "", same = r.sameDay ? '<span class="flag">Same day as the count: check whether before or after</span>' : "";
    if (r.kind === "received") return "<b>Received</b>" + also + same + "<span>" + esc([e.agent, e.invoice_number ? "invoice " + e.invoice_number : ""].filter(Boolean).join(" · ")) + "</span>";
    if (r.kind === "supplied" || r.kind === "poyc") return "<b>" + (r.kind === "poyc" ? "POYC" : "Supplied") + "</b>" + (Number(e.urgent) ? '<i class="cdr-pill" style="font-style:normal">Urgent</i>' : "") + also + same +
      "<span>" + esc([who(e), e.doctor_name, e.prescription_serial_no ? "Prescription " + e.prescription_serial_no : ""].filter(Boolean).join(" · ")) + "</span>";
    var t = "<b>Stock take</b><span>" + (r.opening ? "Counted " + r.qty + ": the balance starts here" : r.diff ? "Counted " + r.qty + ", the registers give " + r.expected : "Counted " + r.qty + ": the same as the registers") + "</span>";
    if (r.diff) t += '<span class="flag">Check: ' + Math.abs(r.diff) + (r.diff < 0 ? " fewer" : " more") + "</span>";
    return t;
  }

  function oneHtml() {
    var h = '<button class="cdr-back" data-act="list">‹ All medicines</button>';
    var L = S.led ? build(S.led, S.key, incOf(S.key)) : null, name = (L && L.name) || S.name;
    h += '<div class="cdr-top"><div><h1>' + esc(name) + '</h1><p class="cdr-sub">Controlled drug · running register' + (L && L.from ? " since " + esc(dmy(L.from)) : "") + "</p></div></div>";
    if (S.ledLoading && !S.led) return h + '<div class="cdr-quiet">Reading every register for ' + esc(name) + "…</div>";
    if (S.ledErr && !S.led) return h + '<div class="cdr-quiet" role="alert">' + esc(S.ledErr) + ' <button class="cdr-btn t" data-act="retry">Try again</button></div>';
    if (!L) return h;
    // the balance, and how it was reached
    var how = "";
    if (L.counted) {
      how = "Counted " + L.counted.qty + " on " + dm(L.counted.date);
      if (L.since.inQ || L.since.outQ) how += ", then " + [L.since.inQ ? "+" + L.since.inQ + " in" : "", L.since.outQ ? "−" + L.since.outQ + " out" : ""].filter(Boolean).join(", ");
    }
    h += '<div class="cdr-sum" aria-live="polite">';
    if (L.balance != null) h += '<div><div class="lbl">The registers give now</div><div class="big" data-bal>' + esc(L.balance) + "</div></div><div class=\"how\">" + esc(how) + ".</div>";
    else h += '<div><div class="lbl">No stock take has counted it</div><div class="big nc" data-bal>Not counted yet</div></div><div class="how">' + esc((L.moved.inQ ? L.moved.inQ + " received" : "Nothing received") + ", " + (L.moved.outQ ? L.moved.outQ + " supplied" : "nothing supplied") + " since " + dm(L.from)) + ".</div>";
    h += "</div>";
    h += '<div class="cdr-acts" role="group" aria-label="Record for this medicine"><button class="cdr-btn p" data-go="cdsreg">Supply</button><button class="cdr-btn" data-go="cdpreg">Receive</button><button class="cdr-btn" data-go="poyreg">POYC</button><button class="cdr-btn" data-go="ddstreg">Count</button></div>';
    // what is wrong, and what to do
    var ACT = { supplied: ["cdsreg", "Open Controlled drugs supplied"], received: ["cdpreg", "Open Controlled drugs received"], count: ["ddstreg", "Open stock takes"] };
    if (L.issues.length) h += L.issues.map(function (x) {
      var a = ACT[x.act];
      return '<div class="cdr-note ' + x.tone + '" role="status"><b>' + esc(x.what) + "</b><p>" + esc(x.next) + "</p>" + (a ? '<button class="cdr-btn" data-nav="' + a[0] + '">' + esc(a[1]) + "</button>" : "") + "</div>";
    }).join("");
    else if (L.rows.some(function (r) { return r.kind === "count" && !r.opening; })) h += '<div class="cdr-note ok" role="status"><b>The counts are the same as the registers.</b><p>Nothing to check.</p></div>';
    if (L.variants.length) h += '<div class="cdr-note"><b>Also found</b><p>Other spellings that contain “' + esc(S.term) + '”. They are not in this balance unless you tick them; tick only the same medicine and strength.</p><div class="cdr-vars">' +
      L.variants.slice(0, 12).map(function (v) { return '<label><input type="checkbox" data-inc="' + esc(v.key) + '"' + (v.on ? " checked" : "") + "><span>" + esc(v.name) + " · " + esc(plural(v.lines, "line", "lines")) + "</span></label>"; }).join("") + "</div></div>";
    // every movement, oldest first
    h += '<div class="cdr-lab cdr-lab2"><span>Every line, oldest first <b>' + L.rows.length + '</b></span>' + (L.rows.length ? '<button class="cdr-btn t" data-act="print">Print</button>' : "") + "</div>";
    if (!L.rows.length) h += '<div class="cdr-quiet" data-empty>Nothing received, supplied or counted since ' + esc(dmy(L.from)) + ".</div>";
    else h += '<table class="cdr-tbl"><thead><tr><th scope="col">Date</th><th scope="col">What</th><th scope="col" class="n">In / out</th>' + (L.counted ? '<th scope="col" class="n">Balance</th>' : "") + "</tr></thead><tbody>" +
      L.rows.map(function (r) {
        var qty = r.kind === "count" ? "=" + r.qty : r.inQ ? "+" + r.inQ : "−" + r.outQ;
        return '<tr class="' + (r.kind === "count" ? "cnt" + (r.diff ? " chk" : "") : r.sameDay ? "chk" : "") + '"><td class="d">' + esc(dm(r.date)) + '</td><td class="w">' + rowWhat(r) + '</td><td class="n">' + esc(qty) + '</td>' + (L.counted ? '<td class="n">' + (r.balance == null ? '<span aria-label="no balance yet">–</span>' : esc(r.balance)) + "</td>" : "") + "</tr>";
      }).join("") + "</tbody></table>";
    h += '<div class="cdr-more"><span>From ' + esc(dmy(L.from)) + " to " + esc(dmy(L.to)) + ".</span>" + (L.from > shift(L.to, -395) ? '<button class="cdr-btn t" data-act="earlier">Show 3 months earlier</button>' : "") + "</div>";
    return h;
  }

  function wire(m) {
    var q = m.querySelector('[data-act-input="q"]');
    if (q) {
      q.addEventListener("input", function () { S.q = q.value; E.repaintKeepingFocus ? E.repaintKeepingFocus(S.mount, paint) : paint(); });
      q.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); var first = m.querySelector("[data-open]"), fur = m.querySelector("[data-act=further]"); if (first) first.click(); else if (fur) fur.click(); } });
    }
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function () {
        var a = b.getAttribute("data-act");
        if (a === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash(ID) : "#registers";
        else if (a === "list") { S.key = ""; S.led = null; S.from = ""; keepMed(""); paint(); loadMeds(); E.focusSoon(function () { return m.querySelector('[data-fk="q"]'); }, 30); }
        else if (a === "retry") { if (S.key) loadLedger(true); else loadMeds(true); }
        else if (a === "further") openMed(key(S.q), S.q.trim());
        else if (a === "earlier") { S.from = shift((S.led && S.led.from) || today(), -92); loadLedger(); }
        else if (a === "print") printOne();
      });
    });
    m.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { var k = b.getAttribute("data-open"), x = (S.meds || []).filter(function (y) { return y.key === k; })[0]; openMed(k, b.getAttribute("data-name") || (x && x.name) || k, x && !x.lastCount ? (S.medsFrom || "") : ""); }); }); // not counted in the list's 3 months: the same 3 months (its C9 figure is the list's)
    m.querySelectorAll("[data-go]").forEach(function (b) { b.addEventListener("click", function () { var to = b.getAttribute("data-go"), L = S.led ? build(S.led, S.key, incOf(S.key)) : null; if (to !== "ddstreg" && E.cdHand) E.cdHand.give(to, (L && L.name) || S.name); window.location.hash = "#" + to; }); });
    m.querySelectorAll("[data-inc]").forEach(function (c) { c.addEventListener("change", function () { // tick: those lines join this balance (remembered here)
      var list = incOf(S.key).filter(function (x) { return x !== c.getAttribute("data-inc"); }); if (c.checked) list.push(c.getAttribute("data-inc"));
      setInc(S.key, list); var fk = c.getAttribute("data-inc"); paint(); var again = S.mount.querySelector('[data-inc="' + fk.replace(/"/g, '\\"') + '"]'); if (again) again.focus(); }); });
    m.querySelectorAll("[data-nav]").forEach(function (b) { b.addEventListener("click", function () { window.location.hash = "#" + b.getAttribute("data-nav"); }); });
  }

  function keepMed(name) { try { if (name) sessionStorage.setItem(KEEP(), name); else sessionStorage.removeItem(KEEP()); } catch (e) {} }
  function openMed(k, name, from) {
    k = key(k); if (k.length < 2) return;
    S.key = k; S.name = name || k; S.term = termOf(k); S.led = null; S.ledErr = ""; S.from = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : ""; keepMed(S.name);
    paint(); loadLedger(true);
    E.focusSoon(function () { return S.mount && S.mount.querySelector(".cdr h1"); }, 30);
  }
  async function loadMeds(force) {
    S.medsLoading = true; S.medsErr = ""; if (!S.meds) paint();
    try { S.meds = await getMeds(force); S.medsFrom = (cache.meds && cache.meds.from) || ""; }
    catch (e) { S.medsErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the medicines"); }
    S.medsLoading = false; if (!S.key) E.whenFormIdle(S.mount, paint);
  }
  async function loadLedger(force) {
    var k = S.key; S.ledLoading = true; S.ledErr = ""; paint();
    try { var r = await getLedger(S.term, S.from, force); if (S.key !== k) return; S.led = r; }
    catch (e) { if (S.key !== k) return; S.ledErr = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the register"); }
    S.ledLoading = false; paint();
    var h1 = S.mount && S.mount.querySelector(".cdr h1"); if (h1 && !h1.hasAttribute("tabindex")) h1.setAttribute("tabindex", "-1");
  }

  // A plain list of the register lines for one medicine, as written, with its counts (new; the monthly legal registers
  // print as before, from their own screens). No balance, no difference: those are on screen only (Director C4).
  function printOne() {
    var L = S.led ? build(S.led, S.key, incOf(S.key)) : null; if (!L || !E.months || !E.months.print) return;
    var rows = L.rows.map(function (r) {
      var e = r.e, what, whom = "", ref = "";
      if (r.kind === "received") { what = "Received"; whom = e.agent || ""; ref = e.invoice_number ? "Invoice " + e.invoice_number : ""; }
      else if (r.kind === "count") { what = "Stock take count"; }
      else { what = r.kind === "poyc" ? "POYC" : "Supplied"; whom = [who(e), e.doctor_name, e.doctor_reg_no ? "Reg no. " + e.doctor_reg_no : ""].filter(Boolean).join(" · "); ref = (e.prescription_serial_no ? "Serial " + e.prescription_serial_no : "") + (Number(e.urgent) ? " · Urgent" : ""); }
      return [dmy(r.date), r.spelling || "", what, whom, ref, r.inQ ? String(r.inQ) : "", r.outQ ? String(r.outQ) : "", r.kind === "count" ? String(r.qty) : ""];
    });
    E.months.print({ register: "Controlled drugs by medicine — taken from the registers", period: dmy(L.from) + " to " + dmy(L.to), landscape: true, sections: [{ heading: L.name,
      cols: ["Date", "As written", "Entry", "Who", "Invoice / prescription", { h: "In", num: true }, { h: "Out", num: true }, { h: "Counted", num: true }], rows: rows,
      empty: "Nothing received, supplied or counted in these days." }] });
  }

  E.registerModule({
    id: ID, title: "Controlled drugs by medicine", order: 3, icon: "℞", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; css();
      var want = ""; try { want = sessionStorage.getItem(KEEP()) || ""; } catch (e) {}
      if (want) { S.key = key(want); S.name = want; S.term = termOf(S.key); S.led = null; S.from = ""; } else { S.key = ""; }
      paint();
      if (S.key) { loadLedger(true); return loadMeds(); } // a medicine opened afresh is read afresh (a count made on another device shows)
      E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-fk="q"]'); }, 30);
      return loadMeds();
    }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  if (E.UI2_PARENT) E.UI2_PARENT[ID] = "registers";
})();
