/* Chat board, new layout: messages between pharmacies. Write a message for your own group or for every pharmacy
   (it starts on your group; Send says who will read it), @ to mention a pharmacy, read the board newest first by day,
   pinned messages on top, pin or unpin, delete your own. Same endpoints as the classic board; the server decides who
   sees what (a group's own messages never reach another group). Pinning is a toggle on the server, so it first reads
   the pinned list again and changes nothing when the message is already the way asked. A message whose answer was
   lost is never posted twice (E.postOnce). The suggestions list (priorities, status, comments, export) stays in the
   classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, view: "all", to: "org", msgs: null, pinned: [], hasOlder: false, loading: false, error: "", draft: "", sending: false, err: "",
    busy: 0, confirmDel: 0, pinAll: false, ment: [], mentQ: null, mentT: 0, poll: 0, older: false };
  var MON = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  var PAGE = 50;

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function me() { return E.state.user || {}; }
  function myId() { var u = me(); return u.user_id || u.id; }
  function when(s) { var t = String(s || ""); if (!t) return null; if (!/[zZ]|[+-]\d\d:?\d\d$/.test(t)) t = t.replace(" ", "T") + "Z"; var d = new Date(t); return isNaN(d.getTime()) ? null : d; } // the server stores UTC without a Z
  function ymdOf(d) { return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function dayLabel(d) {
    if (!d) return "Earlier";
    var t = new Date(), y = new Date(); y.setDate(y.getDate() - 1);
    if (ymdOf(d) === ymdOf(t)) return "Today";
    if (ymdOf(d) === ymdOf(y)) return "Yesterday";
    return d.getDate() + " " + MON[d.getMonth()] + (d.getFullYear() !== t.getFullYear() ? " " + d.getFullYear() : "");
  }
  function hm(d) { return d ? pad(d.getHours()) + ":" + pad(d.getMinutes()) : ""; }
  function cleanName(n) { var s = String(n || "").trim(); if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) s = s.split("@")[0].replace(/[._\-]+/g, " ").replace(/\b\w/g, function (c) { return c.toUpperCase(); }); return s; }
  function netText(e, what) { return e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || what); }
  // Body with @mentions and #suggestion picked out; everything else escaped.
  function rich(body) {
    var raw = String(body || "").replace(/@([^\s@]+@[^\s@]+\.[^\s@]+)/g, function (m0, em) { return "@" + cleanName(em); });
    var re = /(@[A-Za-z][\w'.&-]*(?: [A-Z][\w'.&-]*)*)|(#[sS][uU][gG][gG][eE][sS][tT][iI][oO][nN])/g, out = "", last = 0, m;
    while ((m = re.exec(raw))) {
      if (m[1] && m.index > 0 && !/\s/.test(raw.charAt(m.index - 1))) continue; // an @ inside a word is not a mention
      out += esc(raw.slice(last, m.index)) + '<span class="' + (m[1] ? "brd-at" : "brd-tag") + '">' + esc(m[0]) + "</span>"; last = m.index + m[0].length;
    }
    return out + esc(raw.slice(last));
  }
  function mentionsMe(msg) { var loc = String(me().location_name || "").trim().toLowerCase(); return !!loc && Number(msg.user_id) !== Number(myId()) && String(msg.body || "").toLowerCase().indexOf("@" + loc) >= 0; }

  function css() {
    if (document.getElementById("eikon-brdreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-brdreg-css";
    st.textContent =
      ".brd{max-width:880px;margin:0 auto}" +
      ".brd-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".brd h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.brd-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".brd-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".brd-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.brd-btn:disabled{opacity:.55;cursor:default}" +
      ".brd-btn.x{border:0;background:none;color:var(--muted);height:30px;padding:0 8px;font-size:13px;font-weight:600;border-radius:8px}.brd-btn.x.d{color:var(--danger)}" +
      ".brd-new{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:12px 14px;margin-top:16px}" +
      ".brd-ta{display:block;width:100%;box-sizing:border-box;min-height:76px;max-height:240px;border:1px solid var(--border);border-radius:12px;background:transparent;color:var(--text);font:inherit;font-size:16px;line-height:1.4;padding:10px 12px;outline:0;resize:vertical}" +
      ".brd-ment{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}.brd-ment:empty{display:none}.brd-ment small{width:100%;font-size:12px;color:var(--muted)}" +
      ".brd-chip{font:inherit;font-size:13.5px;font-weight:600;min-height:32px;padding:0 12px;border-radius:16px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}" +
      ".brd-chip.on{background:rgba(10,143,106,.12);border-color:var(--accent);color:var(--accent)}" +
      ".brd-to{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}.brd-to>span{font-size:13.5px;color:var(--muted);margin-right:2px}.brd-to .sp{flex:1}" +
      ".brd-hint{font-size:12.5px;color:var(--muted);margin:8px 0 0;line-height:1.4}.brd-hint b{color:var(--text);font-weight:600}" +
      ".brd-err{color:var(--danger);font-size:13px;margin-top:8px}" +
      ".brd-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 7px;display:flex;gap:8px;align-items:center}.brd-lab b{color:var(--text)}" +
      ".brd-bar{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap;margin-top:22px}.brd-bar h2{margin:0}" +
      ".brd-list{list-style:none;margin:0;padding:0;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".brd-m{padding:11px 14px 8px;border-top:.5px solid var(--border)}.brd-m:first-child{border-top:0}" +
      ".brd-m .h{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;font-size:13px;color:var(--muted)}.brd-m .h b{font-size:14.5px;font-weight:600;color:var(--text)}" +
      ".brd-m .t{font-size:15px;line-height:1.42;white-space:pre-wrap;overflow-wrap:anywhere;margin-top:3px}" +
      ".brd-m .a{display:flex;gap:2px;justify-content:flex-end;margin-top:2px;flex-wrap:wrap;align-items:center}.brd-m .a span{font-size:13px;margin-right:auto;padding-left:0}" +
      ".brd-m.mine{background:rgba(10,143,106,.045)}" +
      ".brd-pill{font-size:11px;font-weight:700;letter-spacing:.02em;padding:1px 7px;border-radius:7px;border:1px solid var(--border);color:var(--muted)}.brd-pill.me{border-color:var(--accent);color:var(--accent)}" +
      ".brd-at{font-weight:600;color:var(--accent)}.brd-tag{font-weight:600}" +
      ".brd-pin .brd-m{border-left:3px solid var(--accent)}" +
      ".brd-more{display:block;margin:10px auto 0}" +
      ".brd-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:16px;color:var(--muted)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .brd-chip.on{background:rgba(43,196,138,.16)}html[data-ui2]:not([data-ui2-visit]) .brd-m.mine{background:rgba(43,196,138,.07)}html[data-ui2]:not([data-ui2-visit]) .brd-btn.x.d{color:#FF7A72}}" +
      "@media (max-width:600px){.brd{padding:4px 16px 0}.brd h1{font-size:32px}.brd-to .lbl{flex-basis:100%}.brd-to .sp{flex-basis:100%;height:0}.brd-to .brd-btn.p{margin-left:auto}}";
    document.head.appendChild(st);
  }

  function byIdDesc(a, b) { return Number(b.id) - Number(a.id); }
  async function fetchMsgs(q) {
    var r = await E.apiFetch("/board/messages?" + q, { method: "GET" });
    if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the board");
    return r.messages || [];
  }
  function pinnedList() { return fetchMsgs("pinned=1&limit=30"); }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var res = await Promise.all([fetchMsgs("scope=" + S.view + "&limit=" + PAGE), pinnedList()]);
      S.msgs = res[0].slice().sort(byIdDesc); S.hasOlder = res[0].length >= PAGE; S.pinned = res[1].slice().sort(byIdDesc);
    } catch (e) { if (!keepView) S.error = netText(e, "Could not load the board"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  async function older() {
    if (S.older || !S.msgs || !S.msgs.length) return;
    S.older = true; paint();
    try {
      var min = S.msgs[S.msgs.length - 1].id, got = await fetchMsgs("scope=" + S.view + "&limit=" + PAGE + "&before=" + encodeURIComponent(min));
      var have = {}; S.msgs.forEach(function (x) { have[x.id] = 1; });
      S.msgs = S.msgs.concat(got.filter(function (x) { return !have[x.id]; })).sort(byIdDesc); S.hasOlder = got.length >= PAGE;
    } catch (e) { E.toast(netText(e, "Could not load older messages"), "error"); }
    S.older = false; E.whenFormIdle(S.mount, paint);
  }
  // Every 30 s while the board is open and the tab is visible: new messages and the pinned list.
  async function tick() {
    if (E.state.activeModuleId !== "brdreg" || !S.mount || !document.body.contains(S.mount)) return stopPoll();
    if (document.hidden || S.loading || S.sending || S.busy || !S.msgs) return;
    try {
      var max = S.msgs.length ? S.msgs[0].id : 0;
      var res = await Promise.all([max ? fetchMsgs("scope=" + S.view + "&limit=" + PAGE + "&after=" + encodeURIComponent(max)) : fetchMsgs("scope=" + S.view + "&limit=" + PAGE), pinnedList()]);
      if (E.state.activeModuleId !== "brdreg") return;
      var have = {}; S.msgs.forEach(function (x) { have[x.id] = 1; });
      var fresh = res[0].filter(function (x) { return !have[x.id]; });
      var pinIds = function (l) { return l.map(function (x) { return x.id + ":" + x.is_pinned; }).join(); };
      if (!fresh.length && pinIds(res[1]) === pinIds(S.pinned)) return;
      if (max && res[0].length >= PAGE) return load(); // a lot came in: start again from the newest
      S.msgs = fresh.concat(S.msgs).sort(byIdDesc); S.pinned = res[1].slice().sort(byIdDesc);
      var pinned = {}; S.pinned.forEach(function (x) { pinned[x.id] = 1; }); S.msgs.forEach(function (x) { x.is_pinned = pinned[x.id] ? 1 : 0; });
      E.whenFormIdle(S.mount, paint);
    } catch (e) { /* a missed poll is retried in 30 s */ }
  }
  function startPoll() { stopPoll(); S.poll = setInterval(tick, 30000); }
  function stopPoll() { if (S.poll) clearInterval(S.poll); S.poll = 0; }

  function row(x, inPinned) {
    var d = when(x.created_at), own = Number(x.user_id) === Number(myId()), id = Number(x.id);
    var who = cleanName(x.user_name), loc = String(x.location_name || "") || "A pharmacy";
    var h = '<li class="brd-m' + (own ? " mine" : "") + '" data-id="' + id + '"><div class="h"><b>' + esc(own ? "You" : loc) + "</b>" +
      (who && !own ? "<span>" + esc(who) + "</span>" : "") + "<span>· " + esc(inPinned ? dayLabel(d) + " " + hm(d) : hm(d)) + "</span>" +
      (x.scope === "org" ? '<span class="brd-pill">Our group</span>' : "") +
      (mentionsMe(x) ? '<span class="brd-pill me">Mentions you</span>' : "") +
      (!inPinned && Number(x.is_pinned) ? '<span class="brd-pill">Pinned</span>' : "") + "</div>" +
      '<div class="t">' + rich(x.body) + "</div><div class=\"a\">";
    if (!inPinned && S.confirmDel === id) {
      h += '<span>Delete this message for everyone?</span><button class="brd-btn x" data-act="del-no">Keep</button><button class="brd-btn x d" data-act="del-yes" data-id="' + id + '"' + (S.busy ? " disabled" : "") + ">Delete</button>";
    } else {
      var pinned = Number(x.is_pinned) === 1, label = S.busy === id ? (pinned ? "Unpinning…" : "Pinning…") : pinned ? "Unpin" : "Pin";
      h += '<button class="brd-btn x" data-act="pin" data-id="' + id + '" data-want="' + (pinned ? 0 : 1) + '"' + (S.busy ? " disabled" : "") + ' aria-label="' + esc(label + " message from " + (own ? "you" : loc)) + '">' + esc(label) + "</button>";
      if (own && !inPinned) h += '<button class="brd-btn x d" data-act="del" data-id="' + id + '"' + (S.busy ? " disabled" : "") + ">Delete</button>";
    }
    return h + "</div></li>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "brdreg") return; // left before a reply came back: do not draw over the next screen
    var ta = m.querySelector("#brd-ta"), hadFocus = ta && document.activeElement === ta, sel = ta ? [ta.selectionStart, ta.selectionEnd] : null;
    if (ta && !fromState) keep(); // a reply landing while someone types must not wipe the message
    var u = me(), org = String(u.org_name || "").trim();
    var h = '<div class="brd"><button class="brd-back" data-act="back">‹ Team</button><h1>Chat board</h1><p class="brd-sub">Messages between pharmacies. Kept for six months unless pinned.</p>';
    h += '<form class="brd-new" id="brd-new" autocomplete="off"><label for="brd-ta" class="brd-lab" style="margin:0 0 7px">New message</label>' +
      '<textarea class="brd-ta" id="brd-ta" maxlength="2000" aria-describedby="brd-hint" placeholder="Write a message. Type @ to mention a pharmacy.">' + esc(S.draft) + "</textarea>" +
      '<div class="brd-ment" id="brd-ment" role="group" aria-label="Pharmacies to mention">' + mentHtml() + "</div>" +
      '<div class="brd-to" role="group" aria-label="Who can read it"><span class="lbl">Who can read it</span>' +
      '<button type="button" class="brd-chip' + (S.to === "org" ? " on" : "") + '" data-to="org" aria-pressed="' + (S.to === "org") + '">Our group</button>' +
      '<button type="button" class="brd-chip' + (S.to === "all" ? " on" : "") + '" data-to="all" aria-pressed="' + (S.to === "all") + '">Every pharmacy</button>' +
      '<span class="sp"></span><button type="submit" class="brd-btn p"' + (S.sending ? " disabled" : "") + ">" + (S.sending ? "Sending…" : S.to === "all" ? "Send to every pharmacy" : "Send to our group") + "</button></div>" +
      '<p class="brd-hint" id="brd-hint">' + (S.to === "all" ? "<b>Every pharmacy on Eikon</b>, in every group, can read this." : "Only pharmacies in <b>" + esc(org || "your group") + "</b> can read this.") + " Add #suggestion to save it to the suggestions list.</p>" +
      (S.err ? '<div class="brd-err" role="alert">' + esc(S.err) + "</div>" : "") + "</form>";
    if (S.error) h += '<div class="brd-quiet" style="margin-top:16px">' + esc(S.error) + "</div>";
    else if (!S.msgs) h += '<div class="brd-quiet" style="margin-top:16px">Opening the board…</div>';
    else {
      if (S.pinned.length) {
        var shown = S.pinAll ? S.pinned : S.pinned.slice(0, 3);
        h += '<h2 class="brd-lab">Pinned <b>' + S.pinned.length + '</b></h2><ul class="brd-list brd-pin">' + shown.map(function (x) { return row(x, true); }).join("") + "</ul>" +
          (S.pinned.length > 3 ? '<button class="brd-btn brd-more" data-act="pin-all">' + (S.pinAll ? "Show fewer" : "Show all " + S.pinned.length + " pinned") + "</button>" : "");
      }
      h += '<div class="brd-bar"><h2 class="brd-lab" style="margin:0">Messages</h2><div class="brd-to" style="margin:0" role="group" aria-label="Show">' +
        '<button type="button" class="brd-chip' + (S.view === "all" ? " on" : "") + '" data-view="all" aria-pressed="' + (S.view === "all") + '">Everything</button>' +
        '<button type="button" class="brd-chip' + (S.view === "org" ? " on" : "") + '" data-view="org" aria-pressed="' + (S.view === "org") + '">Our group only</button></div></div>';
      if (S.loading && !S.msgs.length) h += '<div class="brd-quiet" style="margin-top:10px">Opening the board…</div>';
      else if (!S.msgs.length) h += '<div class="brd-quiet" style="margin-top:10px">' + (S.view === "org" ? "No messages for our group yet." : "No messages yet. Write the first one above.") + "</div>";
      else {
        var days = [], by = {};
        S.msgs.forEach(function (x) { var k = dayLabel(when(x.created_at)); if (!by[k]) { by[k] = []; days.push(k); } by[k].push(x); });
        days.forEach(function (k) { h += '<h3 class="brd-lab">' + esc(k) + '</h3><ul class="brd-list">' + by[k].map(function (x) { return row(x, false); }).join("") + "</ul>"; });
        if (S.hasOlder) h += '<button class="brd-btn brd-more" data-act="older"' + (S.older ? " disabled" : "") + ">" + (S.older ? "Loading…" : "Show older messages") + "</button>";
      }
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:14px">The suggestions list (priority, status, comments, export) is in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    m.innerHTML = h;
    bind(m);
    if (hadFocus) { var again = m.querySelector("#brd-ta"); if (again) { again.focus(); try { again.setSelectionRange(sel[0], sel[1]); } catch (x) {} } }
  }

  function bind(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (act === "back") window.location.hash = "#team";
        else if (act === "pin") setPin(id, Number(b.getAttribute("data-want")) === 1);
        else if (act === "del") { S.confirmDel = id; paint(); var y = m.querySelector('[data-act="del-no"]'); if (y) y.focus(); }
        else if (act === "del-no") { var was = S.confirmDel; S.confirmDel = 0; paint(); var d = m.querySelector('[data-act="del"][data-id="' + was + '"]'); if (d) d.focus(); }
        else if (act === "del-yes") del(id);
        else if (act === "pin-all") { S.pinAll = !S.pinAll; paint(); var pa = m.querySelector('[data-act="pin-all"]'); if (pa) pa.focus(); }
        else if (act === "older") older();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "brdreg"); } catch (x) {} E.openClassic("messageboard"); }
      });
    });
    m.querySelectorAll("[data-to]").forEach(function (b) { b.addEventListener("click", function () { keep(); S.to = b.getAttribute("data-to") === "all" ? "all" : "org"; S.err = ""; paint(true); var a = m.querySelector('[data-to="' + S.to + '"]'); if (a) a.focus(); }); });
    m.querySelectorAll("[data-view]").forEach(function (b) { b.addEventListener("click", function () { var v = b.getAttribute("data-view") === "org" ? "org" : "all"; if (v === S.view) return; keep(); S.view = v; S.msgs = []; S.confirmDel = 0; load().then(function () { var a = S.mount && S.mount.querySelector('[data-view="' + v + '"]'); if (a) a.focus(); }); }); });
    var f = m.querySelector("#brd-new"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); send(); });
    var ta = m.querySelector("#brd-ta");
    if (ta) {
      ta.addEventListener("input", function () { S.draft = ta.value; mentionInput(ta); });
      ta.addEventListener("keydown", function (ev) {
        if (ev.key === "Escape" && S.ment.length) { ev.preventDefault(); S.ment = []; S.mentQ = null; drawMent(); return; }
        if (ev.key === "ArrowDown" && S.ment.length) { var c = m.querySelector("#brd-ment [data-loc]"); if (c) { ev.preventDefault(); c.focus(); } return; }
        if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) {
          if (S.ment.length) { ev.preventDefault(); pickMention(S.ment[0]); return; }
          var touch = false; try { touch = window.matchMedia("(pointer:coarse)").matches; } catch (x) {}
          if (!touch || ev.ctrlKey || ev.metaKey) { ev.preventDefault(); send(); } // like the classic board: Enter sends, Shift+Enter starts a new line; a phone keyboard's return is a new line
        }
      });
    }
    bindMent(m);
  }

  function keep() { var ta = S.mount && S.mount.querySelector("#brd-ta"); if (ta) S.draft = ta.value; }

  // ── @mention: the pharmacies the server finds for what follows the @ (same search as the classic board) ──
  function mentionCtx(ta) {
    var pos = ta.selectionStart, before = ta.value.slice(0, pos), at = before.lastIndexOf("@");
    if (at < 0 || (at > 0 && !/\s/.test(before.charAt(at - 1)))) return null;
    var q = before.slice(at + 1);
    if (q.length > 50 || q.indexOf("​") >= 0 || /\n/.test(q)) return null; // a finished mention carries an invisible marker
    return { at: at, q: q };
  }
  function mentionInput(ta) {
    var c = mentionCtx(ta);
    clearTimeout(S.mentT);
    if (!c) { if (S.ment.length || S.mentQ != null) { S.ment = []; S.mentQ = null; drawMent(); } return; }
    var to = S.to;
    S.mentT = setTimeout(async function () {
      var list = [];
      try { var r = await E.apiFetch("/board/users/search?q=" + encodeURIComponent(c.q) + "&scope=" + to, { method: "GET" }); list = (r && r.ok && r.users) || []; } catch (e) { list = []; }
      var t2 = S.mount && S.mount.querySelector("#brd-ta"), c2 = t2 && mentionCtx(t2);
      if (!c2 || c2.q !== c.q) return;
      var seen = {}, locs = [];
      list.forEach(function (x) { var n = String(x.location_name || "").trim(); if (n && !seen[n.toLowerCase()]) { seen[n.toLowerCase()] = 1; locs.push(n); } });
      S.ment = locs.slice(0, 8); S.mentQ = c.q; drawMent();
    }, 300);
  }
  function mentHtml() {
    if (S.mentQ == null) return "";
    if (!S.ment.length) return '<small role="status">No pharmacy matches “' + esc(S.mentQ) + "”.</small>";
    return '<small role="status">' + S.ment.length + " match" + (S.ment.length === 1 ? "" : "es") + ". Enter picks the first.</small>" +
      S.ment.map(function (n, i) { return '<button type="button" class="brd-chip" data-loc="' + i + '">@' + esc(n) + "</button>"; }).join("");
  }
  function drawMent() { var box = S.mount && S.mount.querySelector("#brd-ment"); if (box) { box.innerHTML = mentHtml(); bindMent(S.mount); } }
  function bindMent(m) {
    m.querySelectorAll("#brd-ment [data-loc]").forEach(function (b, i, all) {
      b.addEventListener("click", function () { pickMention(S.ment[Number(b.getAttribute("data-loc"))]); });
      b.addEventListener("keydown", function (ev) {
        if (ev.key === "ArrowRight" || ev.key === "ArrowDown") { ev.preventDefault(); (all[i + 1] || all[0]).focus(); }
        else if (ev.key === "ArrowLeft" || ev.key === "ArrowUp") { ev.preventDefault(); if (i === 0) { var t = m.querySelector("#brd-ta"); if (t) t.focus(); } else all[i - 1].focus(); }
        else if (ev.key === "Escape") { ev.preventDefault(); S.ment = []; S.mentQ = null; drawMent(); var t2 = m.querySelector("#brd-ta"); if (t2) t2.focus(); }
      });
    });
  }
  function pickMention(name) {
    var ta = S.mount && S.mount.querySelector("#brd-ta"); if (!ta || !name) return;
    var c = mentionCtx(ta); if (!c) return;
    var after = ta.value.slice(ta.selectionStart), ins = "@" + name + "​ ";
    ta.value = ta.value.slice(0, c.at) + ins + after; S.draft = ta.value;
    S.ment = []; S.mentQ = null; drawMent();
    ta.focus(); var p = c.at + ins.length; try { ta.setSelectionRange(p, p); } catch (x) {}
  }

  // ── Send: one POST, never two (a lost answer is checked against the board before it can be sent again) ──
  async function send() {
    if (S.sending) return;
    keep();
    var body = String(S.draft || "").replace(/​/g, "").trim(), to = S.to === "all" ? "all" : "org"; // the marker is taken out, as the classic board does
    S.err = "";
    if (!body) { S.err = "Write the message first. Nothing was sent."; paint(true); var t0 = S.mount && S.mount.querySelector("#brd-ta"); if (t0) t0.focus(); return; }
    if (body.length > 2000) { S.err = "That is longer than 2000 characters. Shorten it; nothing was sent."; return paint(true); }
    S.sending = true; S.ment = []; S.mentQ = null; paint(true);
    var uid = myId();
    try {
      var r = await E.postOnce("/board/messages", { body: body, scope: to }, {
        list: function () { return fetchMsgs("scope=all&limit=" + PAGE); },
        same: function (x) { return Number(x.user_id) === Number(uid) && String(x.body) === body && String(x.scope) === to; }
      });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not sent");
      S.draft = ""; var ta = S.mount && S.mount.querySelector("#brd-ta"); if (ta) ta.value = "";
      E.toast((to === "all" ? "Sent to every pharmacy" : "Sent to our group") + (/#suggestion/i.test(body) ? " · saved as a suggestion" : ""), "success");
      if (to === "org" || S.view === "all") { if (r.message && S.msgs && !S.msgs.some(function (x) { return x.id === r.message.id; })) S.msgs = [r.message].concat(S.msgs).sort(byIdDesc); }
      S.sending = false; paint(true);
      if (!r.message) load(); // recovered after a lost answer: read the board again
      return;
    } catch (x) { S.err = E.saveFailText(x).replace(/^Not saved/, "Not sent"); }
    S.sending = false; return load();
  }

  // ── Pin / unpin: the server flips whatever is there, so read first and only flip when it is not already so ──
  async function setPin(id, want) {
    if (S.busy || !id) return;
    S.busy = id; S.confirmDel = 0; paint();
    var isPinned = function (l) { return l.some(function (x) { return Number(x.id) === id; }); };
    try {
      if (isPinned(await pinnedList()) === want) { E.toast(want ? "It was already pinned" : "It was already unpinned", "info"); }
      else {
        try {
          var r = await E.apiFetch("/board/messages/" + id + "/pin", { method: "PUT", body: "{}" });
          if (!r || !r.ok) throw new Error((r && r.error) || "Not changed");
        } catch (x0) { // the answer was lost: did it happen? Never flip it twice.
          if (!(x0 && x0.network)) throw x0;
          var now; try { now = isPinned(await pinnedList()); } catch (e1) { throw x0; }
          if (now !== want) throw x0;
        }
        E.toast(want ? "Pinned" : "Unpinned", "success");
      }
    } catch (x) { E.toast(String(E.saveFailText(x)).replace(/^Not saved: /, want ? "Not pinned: " : "Not unpinned: "), "error"); }
    S.busy = 0; await load();
    var b = S.mount && S.mount.querySelector('.brd-list:not(.brd-pin) [data-act="pin"][data-id="' + id + '"]'); if (b) b.focus();
  }

  // ── Delete: your own messages only (the server checks too), after Delete is pressed twice ──
  async function del(id) {
    if (S.busy || !id) return;
    var x = (S.msgs || []).filter(function (m0) { return Number(m0.id) === id; })[0];
    if (!x || Number(x.user_id) !== Number(myId())) { S.confirmDel = 0; return paint(); }
    S.busy = id; paint();
    try {
      var r = await E.apiFetch("/board/messages/" + id, { method: "DELETE" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Not deleted");
      E.toast("Message deleted", "success");
    } catch (e) { E.toast(e && e.network ? "The connection dropped. Check the board: if the message is still there, try again." : "Not deleted: " + String((e && (e.message || e)) || "error"), "error"); }
    S.busy = 0; S.confirmDel = 0; return load();
  }

  E.registerModule({
    id: "brdreg", title: "Chat board", order: 3, icon: "✉", ui2Only: true,
    render: function (ctx) {
      S.mount = ctx && ctx.mount; S.msgs = null; S.pinned = []; S.err = ""; S.error = ""; S.to = "org"; S.confirmDel = 0; S.busy = 0; S.ment = []; S.mentQ = null; S.pinAll = false;
      css(); paint(); startPoll(); // no focus on the box on open: the board would wait for it to be left before showing (E.whenFormIdle)
      return load();
    },
    destroy: function () { stopPoll(); clearTimeout(S.mentT); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("brdreg") < 0) E.UI2_DESTINATIONS.push("brdreg");
  if (E.UI2_PARENT) E.UI2_PARENT.brdreg = "team";
})();
