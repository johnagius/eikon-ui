/* ============================================================
   EIKON — Help and What's new for the new layout  (eikon.help.js)
   Loaded just after the first screen (index.html's background files), so it adds nothing before Today is ready.
   - The "?" beside every new-layout screen's name (one hook for all of them), which opens that screen's guide.
   - E.openHelpNext(): loads help-next.js (the guides and the panel) the first time someone asks for help.
   - What's new: whatsnew.json is read once, a little after the first screen and never while someone is typing;
     a dot on Settings and a banner on the Settings page until the person has read it or dismissed it.
   In the classic layout nothing here runs; it keeps help-content.js.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  // What a person has read is kept per person on this device (localStorage, by user id); without storage the dot
  // still goes once they have looked, until the page is reloaded.
  function stamped(rel) { return E.uiUrl(rel) + (E.BUILD ? "?v=" + encodeURIComponent(E.BUILD) : ""); }
  var helpP = null;
  function loadHelp() {
    if (E.helpNext) return Promise.resolve();
    if (!helpP) {
      helpP = new Promise(function (res, rej) {
        var s = document.createElement("script"); s.src = stamped("./help-next.js");
        s.onload = function () { if (E.helpNext) res(); else rej(new Error("no help")); };
        s.onerror = function () { rej(new Error("no help")); };
        document.head.appendChild(s);
      });
      helpP.catch(function () { helpP = null; }); // a failed download can be tried again
    }
    return helpP;
  }
  // opts: { id } opens that screen's guide, { view: "whatsnew" }, or nothing for the list of guides.
  E.openHelpNext = function (opts) {
    var opener = document.activeElement;
    return loadHelp().then(function () { E.helpNext.open(Object.assign({ opener: opener }, opts || {})); },
      function () { E.toast("Help did not open. Check the connection and try again.", "error"); });
  };

  var WN = { list: null, p: null, failed: false, readHere: false };
  function wnKey() { var u = E.state.user || {}; return "eikon_whatsnew_seen:" + String(u.id || u.user_id || u.email || ""); }
  function wnSeen() { try { var v = JSON.parse(localStorage.getItem(wnKey()) || "null"); return v && Array.isArray(v.ids) ? v.ids : []; } catch (e) { return []; } }
  function wnValid(e) { return e && typeof e.id === "string" && /^\d{4}-\d{2}-\d{2}$/.test(String(e.date)) && e.title && e.text; }
  E.whatsNew = {
    list: function () { return WN.list; },
    failed: function () { return WN.failed; },
    load: function () {
      if (WN.list) return Promise.resolve(WN.list);
      if (!WN.p) WN.failed = false;
      if (!WN.p) WN.p = fetch(stamped("./whatsnew.json"), { credentials: "same-origin" })
        .then(function (r) { if (!r.ok) throw new Error("HTTP " + r.status); return r.json(); })
        .then(function (j) { WN.list = (j && Array.isArray(j.entries) ? j.entries : []).filter(wnValid); WN.failed = false; syncDot(); return WN.list; })
        .catch(function () { WN.p = null; WN.failed = true; return null; });
      return WN.p;
    },
    unreadIds: function () {
      if (!WN.list || WN.readHere) return [];
      var seen = wnSeen(), start = E.startYmd ? E.startYmd() : ""; // FIN-dayzero (W10): what changed before this pharmacy started is not news to it
      return WN.list.filter(function (e) { return seen.indexOf(e.id) < 0 && !(start && String(e.date) < start); }).map(function (e) { return e.id; });
    },
    unread: function () { return E.whatsNew.unreadIds().length; },
    markRead: function () {
      if (!WN.list) return;
      WN.readHere = true;
      try { localStorage.setItem(wnKey(), JSON.stringify({ at: new Date().toISOString(), ids: WN.list.map(function (e) { return e.id; }) })); } catch (e) {}
      syncDot();
    }
  };
  // Read in another tab of the same browser: the dot goes here too.
  window.addEventListener("storage", function (ev) { if (ev.key === wnKey()) syncDot(); });

  function dotCss() {
    if (document.getElementById("eikon-nxh-dot-css")) return;
    var st = document.createElement("style"); st.id = "eikon-nxh-dot-css";
    st.textContent =
      ".nxh-sr{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0}" +
      ".nxh-dot{display:inline-block;width:9px;height:9px;border-radius:50%;background:var(--danger,#C4221A);flex:none}" +
      ".nxh-dot[hidden]{display:none}.hub-card span.nxh-card-dot{display:inline-block;margin-left:8px;vertical-align:middle}.hub-card span.nxh-card-dot[hidden]{display:none}" +
      "html[data-ui2] .nxh-rail-dot{margin-left:auto}" +
      "@media (max-width:760px){html[data-ui2] .nxh-rail-dot{position:absolute;top:5px;left:calc(50% + 9px);margin:0}}" +
      ".nxh-q{display:inline-flex;align-items:center;justify-content:center;width:30px;height:30px;margin-left:8px;vertical-align:middle;border-radius:50%;border:1px solid var(--border);background:transparent;color:var(--muted);cursor:pointer;padding:0;font:inherit;position:relative;top:-2px}" +
      ".nxh-q:hover{color:var(--accent);border-color:var(--accent)}.nxh-q:focus-visible{outline:3px solid var(--accent);outline-offset:2px}" +
      ".nxh-q::after{content:'';position:absolute;inset:-7px}" + // a 44 px target around the 30 px circle
      ".nxh-row{display:flex;justify-content:flex-end;margin:0 0 6px}.nxh-row .nxh-q{top:0}" +
      "@media (max-width:600px){.nxh-q{width:44px;height:44px;margin-left:6px;top:0}.nxh-q::after{inset:0}}" + // on a phone the button itself is 44 px, as every button there
      ".hub-wn{display:flex;align-items:center;gap:10px;flex-wrap:wrap;margin:14px 0 4px;padding:12px 14px;border-radius:12px;background:var(--panel2);border:1px solid var(--border)}" +
      ".hub-wn .t{flex:1 1 220px;min-width:0;font-size:14px;line-height:1.45}.hub-wn .t b{display:block;font-size:15px}" +
      ".hub-wn button{font:inherit;font-size:14.5px;font-weight:600;border-radius:10px;padding:8px 12px;min-height:40px;cursor:pointer;border:1px solid var(--border);background:transparent;color:var(--accent)}";
    document.head.appendChild(st);
  }

  // Settings: "What's new" once, until it is read or dismissed.
  function wnBanner(m) {
    var slot = m.querySelector("#hub-wn-slot"); if (!slot) return;
    dotCss();
    var ids = E.whatsNew.unreadIds();
    if (!ids.length) { slot.innerHTML = ""; return; }
    var first = (WN.list || []).filter(function (e) { return e.id === ids[0]; })[0];
    slot.innerHTML = '<div class="hub-wn" role="region" aria-label="What\'s new"><span class="nxh-dot" aria-hidden="true"></span><div class="t"><b>What\'s new</b>' +
      esc(first ? first.title + (ids.length > 1 ? " and " + (ids.length - 1) + " more" : "") : "") + '</div>' +
      '<button type="button" data-wn="open">See what\'s new</button><button type="button" data-wn="dismiss">Dismiss</button></div>';
    slot.querySelector('[data-wn="open"]').addEventListener("click", function () { E.openHelpNext({ view: "whatsnew" }); });
    slot.querySelector('[data-wn="dismiss"]').addEventListener("click", function () {
      E.whatsNew.markRead();
      var h = m.querySelector('.hub-card[data-action]'); // keep focus on the page, not the body
      var all = m.querySelectorAll(".hub-card"); all.forEach(function (c) { if (/What's new/.test(c.textContent)) h = c; });
      if (h) h.focus();
    });
  }

  function syncDot() {
    if (!E.isUi2 || !E.isUi2() || (E.isUi2Paused && E.isUi2Paused())) return;
    dotCss();
    var n = E.whatsNew.unread();
    var b = document.querySelector('.eikon-rail-btn[data-mod="settings"]');
    if (b) {
      var d = b.querySelector(".nxh-rail-dot");
      if (n && !d) { d = document.createElement("span"); d.className = "nxh-dot nxh-rail-dot"; d.innerHTML = '<span class="nxh-sr">, something new in What\'s new</span>'; b.appendChild(d); }
      else if (!n && d) d.remove();
    }
    document.querySelectorAll("[data-wn-dot]").forEach(function (el) { el.hidden = !n; });
    var c = document.getElementById("eikon-content");
    if (c && E.state.activeModuleId === "settings") { var slot = c.querySelector("#hub-wn-slot"); if (slot && (!!n) !== !!slot.firstChild) wnBanner(c); }
  }

  // The "?" beside each new-layout screen's name: one hook for every screen. The screens draw their own headings
  // and redraw them often, so the button is put back after each change (it adds no text to the heading).
  var Q_SVG = '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9.2 9.2a2.9 2.9 0 0 1 5.6 1c0 1.9-2.8 2.4-2.8 4.1"/><path d="M12 18h.01"/></svg>';
  function helpable(id) { var m = E.modules[id]; return !!m && !m.registryStub && (m.ui2Only || id === "today"); }
  function ensureQ() {
    if (!E.isUi2 || !E.isUi2() || (E.isUi2Paused && E.isUi2Paused())) return;
    var c = document.getElementById("eikon-content"); if (!c) return;
    var id = E.state.activeModuleId;
    var have = c.querySelector(".nxh-q");
    if (!helpable(id)) { if (have) (have.closest(".nxh-row") || have).remove(); return; }
    if (have && have.getAttribute("data-help") === id) return;
    if (have) (have.closest(".nxh-row") || have).remove();
    dotCss();
    var bt = document.createElement("button");
    bt.type = "button"; bt.className = "nxh-q"; bt.setAttribute("data-help", id);
    bt.setAttribute("aria-label", "Help"); bt.title = "Help for this screen";
    bt.innerHTML = Q_SVG;
    bt.addEventListener("click", function (ev) { ev.preventDefault(); ev.stopPropagation(); E.openHelpNext({ id: E.state.activeModuleId }); });
    var h = c.querySelector("h1");
    if (h) h.appendChild(bt);
    else { var row = document.createElement("div"); row.className = "nxh-row"; row.appendChild(bt); c.insertBefore(row, c.firstChild); }
  }
  var qQueued = false;
  function queueQ() { if (qQueued) return; qQueued = true; Promise.resolve().then(function () { qQueued = false; try { ensureQ(); syncDot(); } catch (e) {} }); }
  var obs = null;
  function watchContent() {
    var c = document.getElementById("eikon-content");
    if (!c || !window.MutationObserver) return;
    if (obs && obs.__c === c) return;
    if (obs) obs.disconnect();
    obs = new MutationObserver(queueQ); obs.__c = c;
    obs.observe(c, { childList: true, subtree: true });
    queueQ();
  }
  window.addEventListener("hashchange", function () { setTimeout(function () { watchContent(); queueQ(); }, 0); });
  window.addEventListener("eikon:modules", function () { watchContent(); queueQ(); });
  // The shell is drawn after sign-in (and again after signing in once more), so this looks for it once a second.
  // What's new is read a little after the first screen, once per page, and never while someone is typing: a scanner
  // is told from typing by the gaps between keys, and even a short pause for the page could make a scan look typed.
  var wnAsked = false, lastKey = 0;
  document.addEventListener("keydown", function () { lastKey = Date.now(); }, true);
  function wnWhenQuiet() { if (Date.now() - lastKey < 1500) { setTimeout(wnWhenQuiet, 1000); return; } E.whatsNew.load(); }
  (function wait() {
    if (document.getElementById("eikon-content") && E.state && E.state.user) {
      watchContent();
      if (!wnAsked && E.isUi2 && E.isUi2() && !(E.isUi2Paused && E.isUi2Paused())) { wnAsked = true; setTimeout(wnWhenQuiet, 1500); }
    }
    setTimeout(wait, wnAsked ? 1000 : 200);
  })();
  try { if (E.isUi2 && E.isUi2()) dotCss(); } catch (e) {} // the small styles go in once, now, not while someone types

  // The Settings page calls this each time it is drawn (modules.hubs.js).
  E.helpSettings = function (m) { wnBanner(m); syncDot(); E.whatsNew.load(); };
  // A Settings page drawn before this file arrived is drawn again by modules.hubs.js on "eikon:modules".
})();
