/* Handover, new layout: what yesterday's team left for today (most critical first), the standing instructions, today's
   notes, and what today leaves for tomorrow (add a point, mark it Low / Medium / Critical, remove one).
   The day's record is replaced whole on every save and deleted if left empty (UPDATE-AUDIT.md), so every save first
   reads the day afresh and changes only the one thing asked: a point added or removed by someone else on another
   till is kept. Notes edited elsewhere since you opened them are never overwritten: theirs are shown instead.
   The standing instructions ("Always") are changed here too, with the classic Instructions screen's call: PUT
   /instructions/global with the whole set, read afresh just before, and only permanent_handover changed.
   Other days, and the opening, closing and how-to instructions, stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, ymd: "", pins: [], howto: [], open: {}, loadedAt: 0, timer: 0, onVis: null, undo: null, undoT: 0, incoming: [], mine: null, standing: "", loading: false, error: "", sev: "g", draft: "", notes: null, notesBase: "", saving: false, err: "", warn: "", fromYmd: "", std: null, stdBusy: false, stdMsg: "" };
  var SEV = { r: ["Critical", 0], y: ["Medium", 1], g: ["Low", 2] };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  // Malta's calendar, whatever zone the device is set to (the day's record is keyed by Malta's date)
  function today() { return (E.maltaYmd && E.maltaYmd()) || ymdOf(new Date()); }
  function daysAgo(n) { var t = today().split("-"), d = new Date(Date.UTC(Number(t[0]), Number(t[1]) - 1, Number(t[2]) - n, 12)); return d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate()); }
  // "Got it": who has read what the last shift left is kept in this browser, per person (no server, no cost). The
  // Team page can ask E.handoverRead(fromYmd, ids) — or read localStorage eikon_hnd_read_<userId> itself.
  function readKey() { var u = (E.state && E.state.user) || {}; return "eikon_hnd_read_" + (u.user_id || u.id || "0"); }
  function idsOf(list) { return (list || []).map(function (x) { return String(x && x.id); }).sort().join(","); }
  function readGet(from, ids) { try { var o = JSON.parse(localStorage.getItem(readKey()) || "null"); return o && o.from === from && o.ids === ids ? o : null; } catch (e) { return null; } }
  function seenMine() { var m = (S.seenSrv || []).filter(function (x) { return x.me; })[0]; return m ? { at: m.seen_at } : readGet(S.fromYmd, idsOf(S.incoming)); }
  // Got it: kept in this browser at once, then on the server (once per person per day; pressing again changes nothing)
  async function ack() {
    var from = S.fromYmd;
    try { localStorage.setItem(readKey(), JSON.stringify({ from: from, ids: idsOf(S.incoming), at: new Date().toISOString() })); } catch (e3) {}
    paint(); var ak = S.mount && S.mount.querySelector("#hnd-ack"); if (ak) { ak.setAttribute("tabindex", "-1"); ak.focus(); }
    try {
      var r = await E.apiFetch("/instructions/daily/seen", { method: "POST", body: JSON.stringify({ ymd: from }) });
      if (r && r.ok && r.seen && from === S.fromYmd) { S.seenSrv = (S.seenSrv || []).filter(function (x) { return !x.me; }).concat([r.seen]); E.whenFormIdle(S.mount, function () { var f = document.activeElement && document.activeElement.id === "hnd-ack"; paint(); var a2 = f && S.mount.querySelector("#hnd-ack"); if (a2) { a2.setAttribute("tabindex", "-1"); a2.focus(); } }); }
    } catch (e4) { /* an older server, or offline: this browser remembers it */ }
  }
  E.handoverRead = function (from, list) { return readGet(String(from || ""), typeof list === "string" ? list : idsOf(list)); };
  function hm(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : (E.maltaHm ? E.maltaHm(d) : pad(d.getHours()) + ":" + pad(d.getMinutes())); }
  var WD = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  // "From yesterday", or the weekday of the last day that left something (a Monday after a closed Sunday shows Saturday's).
  function fromLabel() { if (!S.fromYmd || S.fromYmd === daysAgo(1)) return "From yesterday"; var p = S.fromYmd.split("-"); return "From " + WD[new Date(Number(p[0]), Number(p[1]) - 1, Number(p[2])).getDay()]; }
  // The notes row: nothing to press until something changed; then "Not saved yet" and Save notes; after, "Saved 08:41".
  function notesHint() { return dirty() ? "Not saved yet" : S.savedAt ? "Saved " + hm(S.savedAt) : ""; }
  function dirty() { return (S.notes || "") !== (S.notesBase || ""); }
  function bySev(a, b) { return (SEV[a.sev] || SEV.g)[1] - (SEV[b.sev] || SEV.g)[1]; }
  // The classic Instructions screen's normalizeState, for the global set only (modules.instructions.js): every section
  // it knows is there with a text and an updated_at (HIV and Concerta also with enabled), other keys are kept as they
  // are. The new screen sends exactly the object the classic screen would send.
  var GLOBAL_KEYS = ["opening", "closing", "endofday", "pos", "poyc", "ordering", "loyalty", "hiv", "concerta", "doctors_process", "doctors_fees", "clinic_fees", "permanent_handover"];
  function normGlobal(g) {
    var s = g && typeof g === "object" ? g : {};
    GLOBAL_KEYS.forEach(function (k) {
      if (!s[k] || typeof s[k] !== "object") s[k] = {};
      if (k === "hiv" || k === "concerta") { if (typeof s[k].enabled !== "boolean") s[k].enabled = false; }
      if (typeof s[k].text !== "string") s[k].text = "";
      if (typeof s[k].updated_at !== "string") s[k].updated_at = "";
    });
    return s;
  }
  // The opening, closing and how-to instructions (the same global set, already read): shown here to read, in plain
  // titles; written and changed in the classic screen. HIV and Concerta only when switched on there.
  var HOWTO = [["opening", "Opening the pharmacy"], ["closing", "Closing the pharmacy"], ["endofday", "End of day"], ["pos", "The till"], ["poyc", "POYC"], ["ordering", "Ordering items"],
    ["loyalty", "Loyalty schemes"], ["hiv", "Dispensing HIV medicines"], ["concerta", "Dispensing Concerta"], ["doctors_process", "Doctors and appointments"], ["doctors_fees", "Doctors' fees"], ["clinic_fees", "Clinic fees"]];
  function howtoOf(g) {
    if (!g || typeof g !== "object") return [];
    return HOWTO.filter(function (h) { var x = g[h[0]]; return x && typeof x.text === "string" && x.text.trim() && ((h[0] !== "hiv" && h[0] !== "concerta") || x.enabled === true); })
      .map(function (h) { return { k: h[0], title: h[1], text: g[h[0]].text }; });
  }
  // Team round 2 (H6): once read, the section folds to one row ("How we do things 7 ›") so today's notes and For
  // tomorrow stay in view. Read = this person opened one of them on this device before, or pressed Got it on what the
  // last shift left. Opening or closing the row is kept while the screen is open; nothing is sent.
  function howKey() { var u = (E.state && E.state.user) || {}; return "eikon_hnd_how_" + (u.user_id || u.id || "0") + ":" + (u.location_id != null ? u.location_id : ""); } // per person, per pharmacy
  function howRead() { try { return localStorage.getItem(howKey()) === "1"; } catch (e) { return false; } }
  function howFolded() { if (S.howAll != null) return !S.howAll; return howRead() || !!(S.incoming.length && seenMine()); }
  function howtoHtml() {
    if (!S.howto.length) return "";
    return '<details class="hnd-howall" id="hnd-how"' + (howFolded() ? "" : " open") + '><summary><span id="hnd-how-l">How we do things</span> <b>' + S.howto.length + '</b></summary><div class="hnd-list hnd-how" role="group" aria-labelledby="hnd-how-l">' +
      S.howto.map(function (x) { return '<details data-k="' + esc(x.k) + '"' + (S.open[x.k] ? " open" : "") + "><summary>" + esc(x.title) + '</summary><div class="hnd-howt">' + esc(x.text) + "</div></details>"; }).join("") + "</div></details>";
  }
  function clean(rec) { return { notes: String((rec && rec.notes) || ""), handover_out: Array.isArray(rec && rec.handover_out) ? rec.handover_out : [] }; }

  function css() {
    if (document.getElementById("eikon-hndreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-hndreg-css";
    st.textContent =
      ".hnd{max-width:880px;margin:0 auto}" +
      ".hnd-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".hnd h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.hnd-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".hnd-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".hnd-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.hnd-btn:disabled{opacity:.55;cursor:default}.hnd-btn.x{border:0;background:none;color:var(--muted);height:28px;padding:0 6px}" +
      ".hnd-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;gap:8px}.hnd-lab b{color:var(--text)}" +
      ".hnd-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".hnd-pt{display:flex;gap:10px;align-items:flex-start;padding:11px 14px;border-top:.5px solid var(--border);font-size:15px;line-height:1.35}.hnd-pt:first-child{border-top:0}.hnd-pt .t{flex:1;min-width:0;white-space:pre-wrap}" +
      ".hnd-dot{flex:0 0 9px;height:9px;border-radius:50%;margin-top:6px;background:var(--ok)}.hnd-dot.y{background:#E0A100}.hnd-dot.r{background:var(--danger)}" +
      ".hnd-pt small{display:block;font-size:12px;color:var(--muted);font-weight:700}.hnd-pt.r small{color:var(--danger)}" +
      ".hnd-box{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 14px;font-size:15px;white-space:pre-wrap;line-height:1.4}" +
      ".hnd-ta{width:100%;box-sizing:border-box;min-height:96px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:12px 14px;outline:0;resize:vertical}" +
      ".hnd-row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}.hnd-in{flex:1;min-width:180px;height:40px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".hnd-seg{display:flex;gap:4px}.hnd-seg button{font:inherit;font-size:13px;font-weight:600;height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;display:inline-flex;align-items:center;gap:6px}" +
      ".hnd-seg button::before{content:'';width:8px;height:8px;border-radius:50%;background:var(--ok)}.hnd-seg button[data-sev=y]::before{background:#E0A100}.hnd-seg button[data-sev=r]::before{background:var(--danger)}" +
      ".hnd-seg button.on{border:2px solid var(--text);padding:0 11px;background:rgba(118,118,128,.16);color:var(--text)}html[data-ui2]:not([data-ui2-visit]) .eikon-content .hnd .hnd-seg button.on[data-sev]{color:var(--text)}" + // chosen: ink outline, neutral (green means done elsewhere); the dot says the urgency
      ".hnd-err{color:var(--danger);font-size:13px;margin-top:6px}.hnd-warn{font-size:13.5px;margin-top:8px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12)}" +
      ".hnd-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:16px;color:var(--muted)}.hnd-quiet .hnd-btn{display:block;margin-top:12px}" +
      ".hnd-dirty{font-size:13px;color:var(--muted);margin-right:auto}" +
      ".hnd-list.new{border-color:var(--accent)}.hnd-ack{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:8px 14px;border-top:.5px solid var(--border);font-size:14px;color:var(--muted);min-height:34px}.hnd-ack:focus{outline:0}.hnd-ack{flex-wrap:wrap}.hnd-ack .ok{color:var(--ok);font-weight:600}.hnd-ack .by{order:-1;margin-right:auto;font-size:13px}" +
      ".hnd-btn.x.c{color:var(--muted);font-weight:500;height:44px;margin:-9px -6px -9px 0;padding:0 10px}.hnd-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}.hnd-car{font-size:13px;color:var(--muted);white-space:nowrap;padding-top:2px}.hnd-pins{list-style:none;margin:0;padding:0}.hnd-pt small.w{color:var(--muted)}a.hnd-ch{text-decoration:none;display:inline-flex;align-items:center}" +
      ".hnd-how details{border-top:.5px solid var(--border)}.hnd-how details:first-child{border-top:0}.hnd-how summary{cursor:pointer;padding:0 14px;min-height:44px;display:flex;align-items:center;font-size:15px;font-weight:600;list-style:none}.hnd-how summary::-webkit-details-marker{display:none}" +
      ".hnd-how summary::after{content:'›';margin-left:auto;color:var(--muted);font-size:20px;transition:transform .15s}.hnd-how details[open] summary::after{transform:rotate(90deg)}.hnd-how summary:focus-visible{outline:2px solid var(--accent);outline-offset:-2px}.hnd-howt{padding:0 14px 12px;font-size:15px;line-height:1.45;white-space:pre-wrap}" +
      ".hnd-undo{background:rgba(118,118,128,.07);color:var(--muted)}.hnd-undo .t{font-style:italic}.hnd-btn.x.u{color:var(--accent)}" +
      ".hnd-lab .hnd-ch{margin-left:auto;text-transform:none;letter-spacing:0;font-size:13px;font-weight:600;color:var(--accent);border:0;background:none;font-family:inherit;cursor:pointer;padding:0 2px;min-height:24px}" +
      ".hnd-addstd{display:block;width:100%;text-align:left;font:inherit;font-size:14.5px;font-weight:600;color:var(--accent);background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:11px 14px;cursor:pointer;min-height:44px;margin-top:22px}" +
      ".hnd-sk{height:120px;margin-top:22px;border-radius:12px;background:rgba(118,118,128,.1)}.hnd-sk+.hnd-sk{height:96px}" +
      ".hnd-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.6}.hnd-foot a{color:var(--accent)}" +
      // H6: the folded row is a list row; open, it is the section's label with the list under it
      ".hnd-howall>summary{list-style:none;cursor:pointer;display:flex;align-items:center;gap:8px;min-height:44px;box-sizing:border-box;margin-top:22px;padding:0 14px;font-size:15px;font-weight:600;background:var(--panel2);border:1px solid var(--border);border-radius:12px}.hnd-howall>summary::-webkit-details-marker{display:none}" +
      ".hnd-howall>summary b{color:var(--muted);font-weight:600;font-variant-numeric:tabular-nums}.hnd-howall>summary::after{content:'›';margin-left:auto;color:var(--muted);font-size:20px;transition:transform .15s}.hnd-howall>summary:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".hnd-howall[open]>summary{background:none;border-color:transparent;padding:0 2px;min-height:32px;margin:14px 0 2px;font-size:13px;color:var(--muted)}.hnd-howall[open]>summary b{color:var(--text)}.hnd-howall[open]>summary::after{transform:rotate(90deg);font-size:18px}" +
      "@media (max-width:600px){.hnd{padding:4px 16px 0}.hnd h1{font-size:32px}.hnd-btn{height:44px;border-radius:22px}.hnd-btn.x{height:44px;padding:0 10px}.hnd-in{height:44px}.hnd-seg button{height:44px;padding:0 12px}.hnd-foot a{display:inline-block;padding:12px 0;margin:-12px 0}.hnd-lab .hnd-ch{min-height:44px;margin:-12px 0 -12px auto;padding:0 4px}}";
    document.head.appendChild(st);
  }

  async function day(ymd) {
    var r = await E.apiFetch("/instructions/daily?ymd=" + encodeURIComponent(ymd), { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the handover");
    return clean(r.record);
  }
  async function load(opts) {
    var quiet = opts && opts.quiet && S.mine; // after a save: if the re-read fails, keep what is on screen (and what was typed)
    S.loading = true; if (!quiet) { S.error = ""; paint(); }
    try {
      var res = await Promise.all([day(daysAgo(1)), day(S.ymd), E.apiFetch("/instructions/global", { method: "GET" }).catch(function () { return null; }),
        E.apiFetch("/board/messages?pinned=1&limit=30", { method: "GET" }).catch(function () { return null; })]); // the board's own pinned list (≤ 30 rows)
      // Nothing from yesterday (a closed Sunday, a holiday): the last day that left something, up to four days back.
      var inc = res[0].handover_out, from = daysAgo(1);
      for (var back = 2; !inc.length && back <= 4; back++) { var r0 = await day(daysAgo(back)); if (r0.handover_out.length) { inc = r0.handover_out; from = daysAgo(back); } }
      S.fromYmd = from;
      // Who has read it (GET /instructions/daily/seen, one read by primary key): the pharmacist sees everyone, staff
      // only themselves. An older server without it: this browser's own record only.
      S.seenSrv = null;
      if (inc.length) { try { var sr = await E.apiFetch("/instructions/daily/seen?ymd=" + encodeURIComponent(from), { method: "GET" }); if (sr && sr.ok && Array.isArray(sr.seen)) S.seenSrv = sr.seen; } catch (e5) { /* not there yet: local only */ } }
      S.incoming = inc.slice().sort(bySev);
      S.mine = res[1];
      if (S.notes == null) { S.notes = S.mine.notes; S.notesBase = S.mine.notes; }
      var g = res[2] && res[2].ok && res[2].global; S.howto = howtoOf(g); S.standing = g && g.permanent_handover && g.permanent_handover.text ? String(g.permanent_handover.text) : "";
      S.stdRead = !!(res[2] && res[2].ok); // the standing instructions could not be read: they are not offered for change
      // Pinned on the chat board by our own group (either for the group or for everyone): what the group wants every shift to see
      var org = Number(((E.state && E.state.user) || {}).org_id);
      if (res[3] && res[3].ok) S.pins = (res[3].messages || []).filter(function (x) { return Number(x.org_id) === org; }).sort(function (a, b) { return Number(b.id) - Number(a.id); });
    } catch (e) { if (!quiet) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the handover"); }
    S.loading = false; S.loadedAt = Date.now(); E.whenFormIdle(S.mount, paint);
  }

  function carried(b) { return !!(S.mine && S.mine.handover_out.some(function (x) { return String(x.text).trim() === String(b.text).trim(); })); }
  function pt(b, removable) {
    var sev = SEV[b.sev] ? b.sev : "g";
    var act = removable ? '<button class="hnd-btn x" data-act="rm" data-id="' + esc(b.id) + '" aria-label="' + esc("Remove: " + b.text) + '">Remove</button>'
      : carried(b) ? '<span class="hnd-car">✓ For tomorrow too</span>'
      : '<button class="hnd-btn x c" data-act="carry" data-id="' + esc(b.id) + '"' + (S.saving ? " disabled" : "") + ' aria-label="' + esc("Carry over to tomorrow: " + b.text) + '">Carry over</button>';
    return '<div class="hnd-pt ' + sev + '"><span class="hnd-dot ' + sev + '"></span><div class="t">' + (sev !== "g" ? "<small>" + SEV[sev][0] + "</small>" : "") + esc(b.text) + "</div>" + act + "</div>";
  }
  // Pinned on the chat board by our group: three at most, the newest first, one tap to the board
  function pinsHtml() {
    if (!S.pins.length) return "";
    return '<h2 class="hnd-lab"><span id="hnd-pin-l">Pinned on the chat board</span> <b>' + S.pins.length + '</b><a class="hnd-ch" href="#brdreg" data-act="board">Open the chat board</a></h2><ul class="hnd-list hnd-pins" aria-labelledby="hnd-pin-l">' +
      S.pins.slice(0, 3).map(function (x) { return '<li class="hnd-pt"><div class="t"><small class="w">' + esc(String(x.location_name || "") || "Our group") + "</small>" + esc(x.body) + "</div></li>"; }).join("") + "</ul>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "hndreg") return; // left before a reply came back: do not draw over the next screen
    var ta = m.querySelector("#hnd-notes"); if (ta && !fromState) S.notes = ta.value; // typing survives every repaint
    var inp = m.querySelector("#hnd-new"); if (inp) S.draft = inp.value;
    var sta = m.querySelector("#hnd-std"); if (sta && S.std && !fromState) S.std.text = sta.value;
    var h = '<div class="hnd"><button class="hnd-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("hndreg") : "‹ Team") + '</button><h1>Handover</h1><p class="hnd-sub">What the last shift left you, and what you leave the next one.</p>';
    if (S.error) h += '<div class="hnd-quiet" style="margin-top:16px" role="alert">' + esc(S.error) + '<button class="hnd-btn" data-act="retry">Try again</button></div>';
    else if (!S.mine) h += '<div role="status" aria-label="Opening the handover"><div class="hnd-sk"></div><div class="hnd-sk"></div></div>'; // the shape of the page, not a spinner
    else {
      var seen = S.incoming.length ? seenMine() : null, others = (S.seenSrv || []).filter(function (x) { return !x.me; });
      h += '<h2 class="hnd-lab">' + esc(fromLabel()) + " <b>" + S.incoming.length + "</b></h2>" + (S.incoming.length ? '<div class="hnd-list' + (seen ? "" : " new") + '">' + S.incoming.map(function (b) { return pt(b, false); }).join("") +
        '<div class="hnd-ack" id="hnd-ack" aria-live="polite">' + (seen ? '<span class="ok">✓ You read ' + (S.incoming.length === 1 ? "this" : "these") + (hm(seen.at) ? " at " + esc(hm(seen.at)) : "") + "</span>" :
          "<span>" + (S.incoming.length === 1 ? "1 to read" : S.incoming.length + " to read") + '</span><button class="hnd-btn p" data-act="ack" aria-label="Got it: I have read what the last shift left">Got it</button>') +
          (others.length ? '<span class="by">Read by ' + others.map(function (x) { return esc(x.user_name || "someone") + (hm(x.seen_at) ? " " + esc(hm(x.seen_at)) : ""); }).join(", ") + "</span>" : "") + "</div></div>" : '<div class="hnd-quiet">Nothing was handed over in the last few days.</div>');
      h += stdHtml();
      h += howtoHtml();
      h += pinsHtml();
      h += '<h2 class="hnd-lab"><label for="hnd-notes">Today\'s notes</label></h2><textarea class="hnd-ta" id="hnd-notes" aria-describedby="hnd-dirty" placeholder="Anything for today\'s team">' + esc(S.notes || "") + "</textarea>" +
        (S.warn ? '<div class="hnd-warn" role="alert">' + esc(S.warn) + "</div>" : "") +
        '<div class="hnd-row" style="justify-content:flex-end"><span class="hnd-dirty" id="hnd-dirty" aria-live="polite">' + esc(notesHint()) + '</span><button class="hnd-btn p" data-act="notes" title="Save notes (Ctrl+Enter)"' + (S.saving ? " disabled" : "") + (dirty() ? "" : " hidden") + ">Save notes</button></div>";
      var out = S.mine.handover_out.slice().sort(bySev), un = S.undo && !out.some(function (x) { return String(x.id) === String(S.undo.item.id); }) ? S.undo : null;
      var undoRow = un ? '<div class="hnd-pt hnd-undo"><div class="t">Removed: ' + esc(un.item.text) + '</div><button class="hnd-btn x u" data-act="undo"' + (S.saving ? " disabled" : "") + ' aria-label="' + esc("Undo remove: " + un.item.text) + '">Undo</button></div>' : "";
      h += '<h2 class="hnd-lab"><label for="hnd-new">For tomorrow</label> <b>' + out.length + "</b></h2>" + (out.length || undoRow ? '<div class="hnd-list">' + out.map(function (b) { return pt(b, true); }).join("") + undoRow + "</div>" : "") +
        '<form class="hnd-row" id="hnd-add" autocomplete="off"><input class="hnd-in" id="hnd-new" enterkeyhint="done" placeholder="e.g. Call Mrs Borg about her insulin" value="' + esc(S.draft) + '">' +
        '<div class="hnd-seg" role="group" aria-label="How urgent">' + ["g", "y", "r"].map(function (k) { return '<button type="button" data-sev="' + k + '" aria-pressed="' + (S.sev === k) + '" class="' + (S.sev === k ? "on" : "") + '">' + SEV[k][0] + "</button>"; }).join("") + "</div>" +
        '<button type="submit" class="hnd-btn p"' + (S.saving ? " disabled" : "") + ">Add point</button></form>" +
        (S.err ? '<div class="hnd-err" role="alert">' + esc(S.err) + "</div>" : "");
    }
    h += '<p class="hnd-foot">Another day\'s handover, and changing the opening, closing and how-to instructions, are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    m.innerHTML = h;
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("hndreg") : "#team";
        else if (act === "retry") load();
        else if (act === "notes") saveNotes();
        else if (act === "rm") { var rid = b.getAttribute("data-id"), gone = null, at = -1;
          change(function (rec) { rec.handover_out.forEach(function (x, i) { if (String(x.id) === rid) { gone = x; at = i; } }); rec.handover_out = rec.handover_out.filter(function (x) { return String(x.id) !== rid; }); }, "", function () { if (gone) setUndo(gone, at); })
            .then(function () { var u = S.mount && S.mount.querySelector('[data-act="undo"]'), i = S.mount && S.mount.querySelector("#hnd-new"), el = u || i; if (el && !(document.activeElement && document.activeElement.closest("form, textarea"))) el.focus(); }); }
        else if (act === "undo") undoRemove();
        else if (act === "carry") carry(b.getAttribute("data-id"));
        else if (act === "board") { ev.preventDefault(); window.location.hash = "#brdreg"; }
        else if (act === "ack") ack();
        else if (act === "std") { S.std = { text: S.standing, base: S.standing, err: "", warn: "" }; S.stdMsg = ""; paint(); var ta2 = S.mount && S.mount.querySelector("#hnd-std"); if (ta2) { ta2.focus(); try { ta2.setSelectionRange(ta2.value.length, ta2.value.length); } catch (e2) {} } }
        else if (act === "std-cancel") closeStd();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "hndreg"); } catch (x) {} E.openClassic("instructions"); }
      });
    });
    m.querySelectorAll(".hnd-how details").forEach(function (d) { d.addEventListener("toggle", function () { S.open[d.getAttribute("data-k")] = d.open; if (d.open) try { localStorage.setItem(howKey(), "1"); } catch (e6) {} }); }); // stays open across redraws; read once, folded next time
    var ha = m.querySelector("#hnd-how"); if (ha) ha.addEventListener("toggle", function () { if (ha.open !== !howFolded()) S.howAll = ha.open; });
    m.querySelectorAll(".hnd-seg [data-sev]").forEach(function (b) { b.addEventListener("click", function () { S.sev = b.getAttribute("data-sev"); paint(); var again = S.mount && S.mount.querySelector('.hnd-seg [data-sev="' + S.sev + '"]'); if (again) again.focus(); }); });
    var t = m.querySelector("#hnd-notes"); if (t) {
      t.addEventListener("input", function () { S.notes = t.value; var btn = m.querySelector('[data-act="notes"]'); if (btn) { btn.disabled = S.saving; btn.hidden = !dirty(); } var d = m.querySelector("#hnd-dirty"), w = notesHint(); if (d && d.textContent !== w) d.textContent = w; });
      t.addEventListener("keydown", function (ev) { if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !S.saving && dirty()) { ev.preventDefault(); saveNotes(); } }); // Ctrl+Enter saves; Enter is a new line
    }
    var sf = m.querySelector("#hnd-stdf"); if (sf) {
      sf.addEventListener("input", function (ev) { if (S.std && ev.target && ev.target.id === "hnd-std") S.std.text = ev.target.value; }); // kept on leaving and coming back
      sf.addEventListener("submit", function (ev) { ev.preventDefault(); saveStd(); });
      sf.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && !S.stdBusy) { ev.preventDefault(); ev.stopPropagation(); closeStd(); }
        else if (ev.key === "Enter" && (ev.ctrlKey || ev.metaKey) && !S.stdBusy) { ev.preventDefault(); saveStd(); } // Ctrl+Enter saves; Enter is a new line
      });
    }
    var f = m.querySelector("#hnd-add"); if (f) f.addEventListener("submit", function (ev) {
      ev.preventDefault();
      var text = String((m.querySelector("#hnd-new") || {}).value || "").trim(); S.draft = text;
      if (!text) { S.err = "Write the point for tomorrow. Nothing was saved."; return paint(); }
      var sev = S.sev;
      change(function (rec) { rec.handover_out = rec.handover_out.concat([{ id: "b_" + Date.now() + "_" + String(Math.random()).slice(2), sev: sev, text: text, created_at: new Date().toISOString() }]); }, "Added for tomorrow", function () { S.draft = ""; S.sev = "g"; var i = S.mount && S.mount.querySelector("#hnd-new"); if (i) i.value = ""; });
    });
  }

  // ---- The standing instructions ("Always"): shown to every shift; changed in place ----
  function stdHtml() {
    var d = S.std;
    if (!d) {
      if (S.standing) return '<h2 class="hnd-lab"><span id="hnd-std-l">Always</span>' + (S.stdRead ? '<button class="hnd-ch" data-act="std" aria-label="Change the standing instructions">Change</button>' : "") + '</h2><div class="hnd-box" aria-labelledby="hnd-std-l">' + esc(S.standing) + "</div>" +
        (S.stdMsg ? '<div class="hnd-err" role="alert">' + esc(S.stdMsg) + "</div>" : "");
      return S.stdRead ? '<button class="hnd-addstd" data-act="std">+ Standing instructions for every shift</button>' : "";
    }
    return '<h2 class="hnd-lab"><label for="hnd-std">Always</label></h2><form id="hnd-stdf" autocomplete="off">' +
      '<textarea class="hnd-ta" id="hnd-std" aria-describedby="hnd-std-h" placeholder="e.g. Count the CD cupboard every evening"' + (S.stdBusy ? " disabled" : "") + ">" + esc(d.text) + "</textarea>" +
      '<p class="hnd-foot" id="hnd-std-h" style="margin-top:6px">Every shift sees these, every day, until they are changed.</p>' +
      (d.warn ? '<div class="hnd-warn" role="alert">' + esc(d.warn) + "</div>" : "") + (d.err ? '<div class="hnd-err" role="alert">' + esc(d.err) + "</div>" : "") +
      '<div class="hnd-row" style="justify-content:flex-end"><button type="button" class="hnd-btn" data-act="std-cancel">Cancel</button><button type="submit" class="hnd-btn p" title="Save (Ctrl+Enter)"' + (S.stdBusy ? " disabled" : "") + ">" + (S.stdBusy ? "Saving…" : "Save standing instructions") + "</button></div></form>";
  }
  function closeStd() { S.std = null; paint(); var b = S.mount && S.mount.querySelector('[data-act="std"]'); if (b) b.focus(); }
  // The classic screen's save (modules.instructions.js renderEditorCard → saveGlobalToServer): the whole global set,
  // with permanent_handover.text as typed and updated_at the time now. Read afresh first, so a section changed on
  // another till since is kept; standing instructions changed elsewhere since you opened them are never overwritten.
  async function saveStd() {
    var d = S.std; if (!d || S.stdBusy) return;
    var ta = S.mount && S.mount.querySelector("#hnd-std"); if (ta) d.text = ta.value;
    var mine = d.text; d.err = ""; d.warn = ""; S.stdBusy = true; paint();
    try {
      var r0 = await E.apiFetch("/instructions/global", { method: "GET" });
      if (!r0 || !r0.ok) throw new Error((r0 && r0.error) || "the standing instructions could not be read");
      var g = normGlobal(r0.global);
      if (String(g.permanent_handover.text) !== String(d.base || "")) {
        var theirs = String(g.permanent_handover.text); S.standing = theirs; d.base = theirs;
        d.warn = "Someone changed the standing instructions on another till. Theirs are in the box now; yours were: “" + mine + "”. Change them again if still needed.";
        d.text = theirs; S.stdBusy = false; paint(true); var t0 = S.mount && S.mount.querySelector("#hnd-std"); if (t0) E.focusIfIdle(t0, E.lastAction(), null); return;
      }
      g.permanent_handover.text = String(mine);
      g.permanent_handover.updated_at = new Date().toISOString();
      var r = await E.apiFetch("/instructions/global", { method: "PUT", body: JSON.stringify({ global: g }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.standing = mine; S.std = null; S.stdBusy = false; E.toast("Standing instructions saved", "success");
      paint(); var b = S.mount && S.mount.querySelector('[data-act="std"]'); if (b) E.focusIfIdle(b, E.lastAction(), null); // after the reply: not from a field the person went to meanwhile
    } catch (x) { S.stdBusy = false; d.err = E.saveFailText(x); paint(); var t1 = S.mount && S.mount.querySelector("#hnd-std"); if (t1) E.focusIfIdle(t1, E.lastAction(), null); }
  }

  // ---- Carry over: yesterday's point goes into today's "For tomorrow" as a new point (same urgency and words), with the
  // same read-afresh save as Add point. Already there (same words): nothing is added twice. ----
  function carry(id) {
    var b = S.incoming.filter(function (x) { return String(x.id) === String(id); })[0]; if (!b) return;
    change(function (rec) {
      if (rec.handover_out.some(function (x) { return String(x.text).trim() === String(b.text).trim(); })) return false;
      rec.handover_out = rec.handover_out.concat([{ id: "b_" + Date.now() + "_" + String(Math.random()).slice(2), sev: SEV[b.sev] ? b.sev : "g", text: String(b.text), created_at: new Date().toISOString() }]);
    }, "Carried over to tomorrow").then(function () { var n = S.mount && (S.mount.querySelector('[data-act="carry"]') || S.mount.querySelector("#hnd-new")); if (n && !(document.activeElement && document.activeElement.closest("form, textarea"))) n.focus(); });
  }
  // ---- Undo a Remove: the same point (same id, text, urgency and time) goes back where it was, for 10 seconds ----
  function setUndo(item, at) { clearTimeout(S.undoT); S.undo = { item: item, at: at }; S.undoT = setTimeout(function () { S.undo = null; if (S.mount && document.body.contains(S.mount)) E.whenFormIdle(S.mount, function () { var f = document.activeElement && document.activeElement.getAttribute("data-act") === "undo"; paint(); if (f) { var i = S.mount.querySelector("#hnd-new"); if (i) i.focus(); } }); }, 10000); }
  function undoRemove() {
    var u = S.undo; if (!u) return;
    clearTimeout(S.undoT); S.undo = null;
    change(function (rec) { if (rec.handover_out.some(function (x) { return String(x.id) === String(u.item.id); })) return false; var at = Math.max(0, Math.min(u.at, rec.handover_out.length)); rec.handover_out = rec.handover_out.slice(0, at).concat([u.item], rec.handover_out.slice(at)); }, "Put back")
      .then(function () { var i = S.mount && S.mount.querySelector("#hnd-new"); if (i && !(document.activeElement && document.activeElement.closest("form, textarea"))) i.focus(); });
  }
  // ---- Kept current without polling hard: read again on coming back to the tab (at most once a minute), and every
  // five minutes while the screen is open and visible. Never while someone types (E.whenFormIdle). ----
  function startRefresh() {
    stopRefresh();
    S.onVis = function () { if (!document.hidden && E.state.activeModuleId === "hndreg" && !S.saving && Date.now() - S.loadedAt > 60000) load({ quiet: true }); };
    document.addEventListener("visibilitychange", S.onVis);
    S.timer = setInterval(function () { if (E.state.activeModuleId !== "hndreg" || !S.mount || !document.body.contains(S.mount)) return stopRefresh(); if (!document.hidden && !S.saving && !S.stdBusy) load({ quiet: true }); }, 300000);
  }
  function stopRefresh() { if (S.timer) clearInterval(S.timer); S.timer = 0; if (S.onVis) document.removeEventListener("visibilitychange", S.onVis); S.onVis = null; }

  // Read the day as it is now, change one thing, write it back whole.
  async function change(fn, okText, after) {
    if (S.saving) return;
    var ta = S.mount && S.mount.querySelector("#hnd-notes"); if (ta) S.notes = ta.value;
    S.saving = true; S.err = ""; paint();
    try {
      var rec = await day(S.ymd);
      if (fn(rec) === false) { if (okText) E.toast(okText, "success"); return rec; } // already as asked (another till did it): nothing to write
      if (!rec.notes.trim() && !rec.handover_out.length && (S.mine.notes.trim() || S.mine.handover_out.length > 1)) throw new Error("that would empty the whole day; reload and try again");
      var r = await E.apiFetch("/instructions/daily", { method: "PUT", body: JSON.stringify({ ymd: S.ymd, notes: rec.notes, handover_out: rec.handover_out }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      if (after) after(); if (okText) E.toast(okText, "success");
      return rec;
    } catch (x) { S.err = E.saveFailText(x); }
    finally { S.saving = false; await load({ quiet: true }); }
  }
  async function saveNotes() {
    var ta = S.mount && S.mount.querySelector("#hnd-notes"); var mine = ta ? ta.value : (S.notes || "");
    S.warn = "";
    var base = S.notesBase, conflict = false;
    var rec = await change(function (fresh) {
      if (fresh.notes !== base) { conflict = fresh.notes; throw new Error("someone changed today's notes since you opened them"); }
      fresh.notes = mine;
    }, "Notes saved");
    if (conflict !== false) { S.warn = "Someone changed today's notes on another till. Theirs are shown now; yours were: “" + mine + "”. Add yours again if still needed."; S.notes = conflict; S.notesBase = conflict; S.err = ""; paint(true); }
    else if (rec) { S.notesBase = mine; S.notes = mine; S.savedAt = new Date().toISOString(); E.repaintKeepingFocus(S.mount, function () { paint(true); }); } // anything typed while it saved stays, and so does your place
  }

  E.registerModule({
    id: "hndreg", title: "Handover", order: 3, icon: "↻", ui2Only: true,
    render: function (ctx) {
      // Notes typed and not saved, and a point not yet added, are still there when you come back the same day.
      var keepDraft = S.ymd === today();
      S.mount = ctx && ctx.mount; S.ymd = today(); S.mine = null; S.err = ""; S.warn = ""; S.savedAt = ""; S.stdBusy = false; S.stdMsg = ""; S.howAll = null;
      if (S.std && S.std.text === S.std.base) S.std = null; // a change typed and not saved is still open on coming back
      if (!keepDraft || !dirty()) S.notes = null;
      if (!keepDraft) S.draft = "";
      css(); paint(); startRefresh(); return load();
    },
    destroy: function () { stopRefresh(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("hndreg") < 0) E.UI2_DESTINATIONS.push("hndreg");
  if (E.UI2_PARENT) E.UI2_PARENT.hndreg = "team";
})();
