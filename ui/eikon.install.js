// "Add Eikon to your desktop / home screen" (2026-11-03, owner: "also ask them if they want to save it to desktop or
// home on phone"). On eikonhq.com, in the new layout, once after sign-in, and any time from Settings.
//  - Chrome, Edge, Android: the browser's own install prompt (beforeinstallprompt, kept by index.html) behind our card.
//  - iPhone and iPad: two short steps (Share, then Add to Home Screen). Safari on a Mac (17+): File, then Add to Dock.
//    Firefox on Android: its menu. Elsewhere (Firefox on a computer) nothing is offered: it cannot be done there.
//  - Never in an installed app, inside a frame, in the classic layout or on another address.
// Remembered on this device only (localStorage): "Not now" for 30 days, "Don't ask again" for good (Settings still
// opens the card), and an install the browser reported.
(function () {
  "use strict";
  var E = window.EIKON; if (!E) return;

  var K_SNOOZE = "eikon_install_snooze_until", K_NEVER = "eikon_install_never", K_DONE = "eikon_install_done", K_SHOWN = "eikon_install_offered";
  var SNOOZE_MS = 30 * 864e5;
  function lsGet(k) { try { return window.localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { window.localStorage.setItem(k, v); } catch (e) {} }

  function installed() {
    try { if (window.navigator.standalone === true) return true; } catch (e) {}
    try { return !!(window.matchMedia && window.matchMedia("(display-mode: standalone), (display-mode: fullscreen), (display-mode: minimal-ui), (display-mode: window-controls-overlay)").matches); } catch (e) { return false; }
  }
  function framed() { try { return window.top !== window; } catch (e) { return true; } }
  function onNewAddress() { return !!E.CLEAN_URLS && /^(www\.)?eikonhq\.com$/i.test(window.location.hostname); }
  function newLayout() { try { return E.isUi2() && !E.isUi2Paused() && E._sectionDashboardId === "today"; } catch (e) { return false; } }
  function phoneSized() { try { return window.matchMedia("(max-width: 760px)").matches; } catch (e) { return false; } }

  // What this browser can do. Only the browser's own words are named.
  function kind() {
    var ua = String(navigator.userAgent || ""), touchMac = /Macintosh/.test(ua) && (navigator.maxTouchPoints || 0) > 1;
    if (window.EIKON_BIP) return "prompt";
    if (/iPhone|iPad|iPod/.test(ua) || touchMac) return "ios";
    if (/Android/.test(ua) && /Firefox\//.test(ua)) return "android-firefox";
    if (/Macintosh/.test(ua) && /Version\/(\d+)[.\d]* Safari\//.test(ua) && !/Chrome|Chromium|Edg\/|Firefox/.test(ua) && Number(/Version\/(\d+)/.exec(ua)[1]) >= 17) return "mac-safari";
    if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return /Android/.test(ua) ? "chromium-android" : "chromium-desktop"; // no prompt (yet): only from Settings
    return "none";
  }

  var SHARE_ICON = '<svg viewBox="0 0 20 20" width="18" height="18" aria-hidden="true" focusable="false" style="vertical-align:-3px"><path d="M10 2.5v10M6.5 6 10 2.5 13.5 6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M6.5 9H5.2a1.2 1.2 0 0 0-1.2 1.2v6.1a1.2 1.2 0 0 0 1.2 1.2h9.6a1.2 1.2 0 0 0 1.2-1.2v-6.1A1.2 1.2 0 0 0 14.8 9h-1.3" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';

  function content(k, fromSettings) {
    var phone = k === "ios" || k === "android-firefox" || k === "chromium-android" || (k === "prompt" && (/Android|iPhone|iPad/.test(navigator.userAgent) || phoneSized()));
    var where = phone ? "home screen" : "desktop";
    var c = { title: "Add Eikon to your " + where, text: "Open it with one tap, in its own window, like an app.", steps: "", add: false, ask: true };
    if (installed()) return { title: "Eikon is installed", text: "You are using the Eikon app on this device.", steps: "", add: false, ask: false };
    if (framed()) return { title: "Add Eikon to your " + where, text: "Open eikonhq.com in its own tab first, then add it from there.", steps: "", add: false, ask: false };
    if (k === "prompt") { c.add = true; return c; }
    if (k === "ios") { c.title = "Add Eikon to your home screen"; c.steps = "<ol><li>Tap Share " + SHARE_ICON + " in the toolbar.</li><li>Choose <b>Add to Home Screen</b>, then <b>Add</b>.</li></ol>"; return c; }
    if (k === "mac-safari") { c.steps = "<ol><li>In the menu bar, choose <b>File</b>.</li><li>Choose <b>Add to Dock</b>, then <b>Add</b>.</li></ol>"; return c; }
    if (k === "android-firefox") { c.steps = "<ol><li>Open the browser menu <b>⋮</b>.</li><li>Choose <b>Install</b> or <b>Add to Home screen</b>.</li></ol>"; return c; }
    if (!fromSettings) return null;
    if (lsGet(K_DONE) === "1") return { title: "Eikon is installed", text: "Open it from your " + where + ". To add it again, remove it there first.", steps: "", add: false, ask: false };
    if (k === "chromium-android") return { title: c.title, text: c.text, steps: "<ol><li>Open the browser menu <b>⋮</b>.</li><li>Choose <b>Add to Home screen</b> or <b>Install app</b>.</li></ol>", add: false, ask: false };
    if (k === "chromium-desktop") return { title: c.title, text: c.text, steps: "<ol><li>Click the install icon at the right of the address bar,</li><li>or open the browser menu and choose <b>Install Eikon</b>.</li></ol>", add: false, ask: false };
    return { title: "Add Eikon to your " + where, text: "This browser cannot add Eikon as an app. Chrome, Edge and Safari can.", steps: "", add: false, ask: false };
  }

  function injectCss() {
    if (document.getElementById("eikon-install-css")) return;
    var st = document.createElement("style"); st.id = "eikon-install-css";
    st.textContent =
      ".eik-inst{position:fixed;z-index:9000;right:24px;bottom:24px;width:360px;max-width:calc(100vw - 32px);box-sizing:border-box;background:var(--panel,#fff);color:var(--text,#000);" +
      "border:.5px solid var(--border,rgba(60,60,67,.15));border-radius:18px;padding:18px 18px 14px;box-shadow:0 1px 2px rgba(0,0,0,.05),0 14px 44px rgba(0,0,0,.14);" +
      "font-family:-apple-system,BlinkMacSystemFont,\"SF Pro Text\",\"Inter\",system-ui,sans-serif;animation:eikInstIn .22s ease-out}" +
      "@keyframes eikInstIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}@media (prefers-reduced-motion:reduce){.eik-inst{animation:none}}" +
      ".eik-inst-top{display:flex;gap:14px;align-items:flex-start}.eik-inst img{width:52px;height:52px;border-radius:12px;flex:none;box-shadow:0 0 0 .5px rgba(0,0,0,.12)}" +
      ".eik-inst h2{margin:2px 0 4px;font-size:17px;line-height:1.25;font-weight:600;letter-spacing:-.01em}.eik-inst p{margin:0;font-size:14px;line-height:1.45;color:var(--muted,#6A6A70)}" +
      ".eik-inst ol{margin:10px 0 0;padding:0 0 0 20px;font-size:14px;line-height:1.5}.eik-inst li{margin:2px 0}" +
      ".eik-inst-act{display:flex;flex-wrap:wrap;gap:8px;margin-top:16px;align-items:center}" +
      ".eik-inst-act button{font:inherit;font-size:15px;font-weight:600;min-height:44px;padding:0 18px;border-radius:12px;border:0;cursor:pointer;-webkit-tap-highlight-color:transparent}" +
      ".eik-inst-act .p{background:var(--accent,#066B4F);color:#fff}.eik-inst-act .s{background:rgba(118,118,128,.12);color:var(--text,#000)}" +
      ".eik-inst-act .t{background:transparent;color:var(--muted,#6A6A70);font-weight:500;padding:0 8px;margin-left:auto}" +
      ".eik-inst-act button:focus-visible{outline:2px solid var(--accent,#066B4F);outline-offset:2px}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .eik-inst{box-shadow:0 0 0 .5px rgba(255,255,255,.08),0 14px 44px rgba(0,0,0,.6)}html[data-ui2]:not([data-ui2-visit]) .eik-inst-act .p{color:#00160E}html[data-ui2]:not([data-ui2-visit]) .eik-inst-act .s{background:rgba(118,118,128,.24)}}" +
      "@media (max-width:760px){.eik-inst{left:16px;right:16px;width:auto;max-width:none;bottom:calc(92px + env(safe-area-inset-bottom,0px))}.eik-inst-act .p,.eik-inst-act .s{flex:1 1 0}.eik-inst-act .t{flex:1 0 100%;margin:0}}";
    document.head.appendChild(st);
  }

  var card = null, lastFocus = null, cardAuto = false;
  function close(remember) {
    if (!card) return;
    if (remember === "later") lsSet(K_SNOOZE, String(Date.now() + SNOOZE_MS));
    if (remember === "never") lsSet(K_NEVER, "1");
    var hadFocus = card.contains(document.activeElement);
    try { card.remove(); } catch (e) {}
    card = null; document.removeEventListener("keydown", onKey, true);
    if (hadFocus && lastFocus && lastFocus.focus) try { lastFocus.focus(); } catch (e) {}
  }
  function onKey(ev) { if (card && ev.key === "Escape") { ev.stopPropagation(); close(cardAuto ? "later" : ""); } }

  function show(fromSettings) {
    var k = kind(), c = content(k, fromSettings);
    if (!c) return false;
    close("");
    injectCss();
    cardAuto = !fromSettings;
    lastFocus = document.activeElement;
    var esc = E.escapeHtml || function (s) { return String(s); };
    var el = document.createElement("div");
    el.className = "eik-inst"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "false");
    el.setAttribute("aria-labelledby", "eik-inst-t"); el.setAttribute("aria-describedby", "eik-inst-d");
    var acts = c.add
      ? '<button type="button" class="p" data-act="add">Add</button><button type="button" class="s" data-act="later">Not now</button>'
      : '<button type="button" class="' + (c.ask ? "s" : "p") + '" data-act="later">' + (c.ask ? "Not now" : "Done") + '</button>';
    if (c.ask) acts += '<button type="button" class="t" data-act="never">Don’t ask again</button>';
    el.innerHTML =
      '<div class="eik-inst-top"><img src="' + esc(E.uiUrl("assets/icon-192.png")) + '" alt="" width="52" height="52" />' +
      '<div><h2 id="eik-inst-t">' + esc(c.title) + '</h2><p id="eik-inst-d">' + esc(c.text) + '</p>' + c.steps + '</div></div>' +
      '<div class="eik-inst-act">' + acts + '</div>';
    el.addEventListener("click", function (ev) {
      var b = ev.target && ev.target.closest && ev.target.closest("button[data-act]"); if (!b) return;
      var act = b.getAttribute("data-act");
      if (act === "never") return close("never");
      if (act === "later") return close(c.ask ? "later" : ""); // "Not now" waits 30 days; "Done" only closes
      if (act === "add") {
        var bip = window.EIKON_BIP; window.EIKON_BIP = null; // the browser lets it be used once
        close("");
        if (!bip || !bip.prompt) return;
        try {
          Promise.resolve(bip.prompt()).then(function () { return bip.userChoice; }).then(function (r) {
            if (r && r.outcome === "accepted") lsSet(K_DONE, "1"); else lsSet(K_SNOOZE, String(Date.now() + SNOOZE_MS));
          }).catch(function () {});
        } catch (e) {}
      }
    });
    document.body.appendChild(el);
    card = el;
    document.addEventListener("keydown", onKey, true);
    if (fromSettings) { var f = el.querySelector("button"); if (f) try { f.focus(); } catch (e) {} }
    return true;
  }

  // May the card come up by itself now?
  function mayOffer() {
    if (!onNewAddress() || !newLayout() || installed() || framed() || !E.state || !E.state.user) return false;
    if (lsGet(K_NEVER) === "1" || lsGet(K_DONE) === "1") return false;
    var until = Number(lsGet(K_SNOOZE) || 0); if (until && Date.now() < until) return false;
    try { if (window.sessionStorage.getItem(K_SHOWN) === "1") return false; } catch (e) {}
    if (card) return false;
    var ov = document.querySelectorAll(".eikon-modal-overlay");
    for (var i = 0; i < ov.length; i++) if (getComputedStyle(ov[i]).display !== "none") return false; // a dialog is open: not now
    return true;
  }
  function offer() {
    if (!mayOffer()) return;
    var k = kind();
    if (k !== "prompt" && k !== "ios" && k !== "mac-safari" && k !== "android-firefox") return;
    if (show(false)) try { window.sessionStorage.setItem(K_SHOWN, "1"); } catch (e) {}
  }

  var armed = false;
  E.install = {
    // Called by bootAuthed after the first screen is drawn. Once per page; the browser's prompt may come later.
    afterSignIn: function () {
      if (armed || !onNewAddress()) return; armed = true;
      setTimeout(offer, 1200);
      window.addEventListener("eikon:installable", function () { setTimeout(offer, 300); });
      window.addEventListener("appinstalled", function () { lsSet(K_DONE, "1"); close(""); });
    },
    // Settings: open the card whatever was remembered before.
    open: function () { return show(true); },
    close: function () { close(""); },
    _kind: kind
  };
})();
