/* Shift-change notices on this device (B5, John 2026-11-10): "Tell me when my shifts change".
   Free and instant: the browser's own push service wakes /sw.js (served by the worker at the site root, so it covers
   eikonhq.com's clean addresses, the home-screen app and /ui/index.html alike). The push carries nothing; the service
   worker reads the words from /rota/notices with this device's own secret and shows them; a tap opens Who's in.
   /sw.js has only push and notificationclick handlers — no fetch handler, no caching — so the app loads exactly as
   before. It is registered only when someone turns this on, and permission is asked only on that tap.
   E.rotaPush.supported() · state() → Promise<{supported, on, staffId, permission, iosNeedsHome}> · on(staffId) → Promise<{ok, push, words}>
   · off() → Promise<{ok}> · ui.toggle(mount, {me}) → {redraw, close}. Requests: none on screen open; turning on 1 GET
   (the public key) + 1 POST; off 1 POST. One device = one person (the one chosen in Mine, E.rotaMe). */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var DBN = "eikon-rota-notify", SW = "/sw.js";
  var IOS_WORDS = "On iPhone this works once Eikon is added to the Home Screen (iOS 16.4+): tap Share, then Add to Home Screen, and open Eikon from there.";
  var OFF_WORDS = "Notifications are not set up for this pharmacy yet.";

  // ---- the device's record {id, k, staff_id}, in IndexedDB so /sw.js can read it too
  function idb(mode, fn) {
    return new Promise(function (ok) {
      try {
        var rq = indexedDB.open(DBN, 1);
        rq.onupgradeneeded = function () { rq.result.createObjectStore("kv"); };
        rq.onerror = function () { ok(null); };
        rq.onsuccess = function () {
          try { var tx = rq.result.transaction("kv", mode), r = fn(tx.objectStore("kv")); tx.oncomplete = function () { ok(r && "result" in r ? r.result : true); }; tx.onerror = function () { ok(null); }; }
          catch (e) { ok(null); }
        };
      } catch (e) { ok(null); }
    });
  }
  var rec = { get: function () { return idb("readonly", function (s) { return s.get("sub"); }); }, put: function (v) { return idb("readwrite", function (s) { s.put(v, "sub"); }); }, del: function () { return idb("readwrite", function (s) { s.delete("sub"); }); } };

  function ios() { var ua = navigator.userAgent || ""; return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1); }
  function standalone() { try { return navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches; } catch (e) { return false; } }
  function supported() { return !!(window.isSecureContext && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window && window.indexedDB); }
  function keyBytes(b64) { var s = String(b64).replace(/-/g, "+").replace(/_/g, "/"); s += "===".slice((s.length + 3) % 4); var bin = atob(s), u = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }
  function reg() { return supported() ? navigator.serviceWorker.getRegistration("/").catch(function () { return null; }) : Promise.resolve(null); }
  function current() { return reg().then(function (r) { return r && r.pushManager ? r.pushManager.getSubscription().catch(function () { return null; }) : null; }); }

  async function state() {
    var st = { supported: supported(), on: false, staffId: null, permission: "Notification" in window ? Notification.permission : "unsupported", iosNeedsHome: ios() && !standalone() && !("PushManager" in window) };
    if (!st.supported) return st;
    var s = await current(), r = await rec.get();
    st.on = !!(s && r && r.id); // (a revoked permission ends the subscription itself)
    st.staffId = st.on ? r.staff_id : null;
    return st;
  }
  // Turn on for this person. Asks the browser's permission (call only from a tap).
  async function on(staffId) {
    if (!supported()) return { ok: false, words: ios() && !standalone() ? IOS_WORDS : "This browser can't show notifications." };
    var key = await E.apiFetch("/rota/push/key", { method: "GET" });
    if (!key || !key.ok) return { ok: false, words: (key && key.error) || "Could not reach Eikon. Try again." };
    if (!key.push || !key.publicKey) return { ok: false, push: false, words: OFF_WORDS };
    var perm = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (perm !== "granted") return { ok: false, words: perm === "denied" ? "Notifications are blocked for Eikon. Allow them in this browser's site settings, then try again." : "Notifications were not allowed." };
    var r = await navigator.serviceWorker.register(SW, { scope: "/", updateViaCache: "none" });
    await navigator.serviceWorker.ready;
    var sub = await r.pushManager.getSubscription(), want = keyBytes(key.publicKey);
    if (sub && sub.options && sub.options.applicationServerKey) { // made with another key (the key was changed): start again
      var have = new Uint8Array(sub.options.applicationServerKey);
      if (have.length !== want.length || have.some(function (b, i) { return b !== want[i]; })) { await sub.unsubscribe().catch(function () {}); sub = null; }
    }
    if (!sub) sub = await r.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: want });
    var res = await E.apiFetch("/rota/push/subscribe", { method: "POST", body: JSON.stringify({ staff_id: Number(staffId), subscription: sub.toJSON() }) });
    if (!res || !res.ok) return { ok: false, words: (res && res.error) || "Could not turn it on. Try again." };
    if (res.push === false) return { ok: false, push: false, words: OFF_WORDS };
    await rec.put({ id: res.id, k: res.k, staff_id: Number(staffId), at: Date.now() });
    return { ok: true, push: true };
  }
  async function off() {
    var s = await current();
    if (s) {
      try { await E.apiFetch("/rota/push/unsubscribe", { method: "POST", body: JSON.stringify({ endpoint: s.endpoint }) }); } catch (e) {}
      try { await s.unsubscribe(); } catch (e) {}
    }
    await rec.del();
    return { ok: true };
  }

  // A tap on a notification while Eikon is open: /sw.js focuses the tab and asks it to show Who's in.
  if (supported()) {
    try {
      navigator.serviceWorker.addEventListener("message", function (ev) {
        if (!ev.data || ev.data.eikon !== "rota-open") return;
        if (E.state && E.state.activeModuleId === "rotreg") location.reload(); // read-only screen: show the change
        else location.hash = "#rotreg";
      });
    } catch (e) {}
  }

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return "&#" + c.charCodeAt(0) + ";"; }); }
  function css() {
    if (document.getElementById("eikon-rotapush-css")) return;
    var st = document.createElement("style"); st.id = "eikon-rotapush-css";
    st.textContent =
      ".rpp{display:flex;align-items:flex-start;gap:12px;padding:10px 14px;border-top:.5px solid var(--border)}" +
      ".rpp .t{flex:1;min-width:0}.rpp b{display:block;font-size:14.5px;font-weight:600;color:var(--text)}" +
      ".rpp p{margin:2px 0 0;font-size:12.5px;color:var(--muted);line-height:1.4}.rpp p.e{color:var(--danger,#B3261E);font-weight:600}" +
      ".rpp-sw{flex:0 0 auto;position:relative;width:51px;height:44px;min-height:44px;margin:0;border:0;border-radius:22px;background:none;cursor:pointer;padding:0}" + // a 44 px target; the track is drawn inside it
      ".rpp-sw::before{content:'';position:absolute;left:0;right:0;top:6.5px;height:31px;border-radius:16px;background:var(--muted2,#8E8E93);transition:background .15s}" +
      ".rpp-sw::after{content:'';position:absolute;top:8.5px;left:2px;width:27px;height:27px;border-radius:50%;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.3);transition:transform .15s}" +
      ".rpp-sw[aria-checked=true]::before{background:var(--ok,#1C8A5B)}.rpp-sw[aria-checked=true]::after{transform:translateX(20px)}" +
      ".rpp-sw[aria-busy=true]{opacity:.6;cursor:progress}.rpp-sw:focus-visible{outline:3px solid var(--accent-ring,var(--accent));outline-offset:2px}" +
      "@media (prefers-reduced-motion:reduce){.rpp-sw::before,.rpp-sw::after{transition:none}}";
    document.head.appendChild(st);
  }

  // The row in Mine: one switch, per device. ctx.me = the person Mine shows (E.rotaMe).
  function toggle(mount, ctx) {
    ctx = ctx || {}; css();
    var S = { st: null, busy: false, err: "", note: "", alive: true };
    var host = document.createElement("div"); host.className = "rpp"; mount.appendChild(host);
    function name(id) { var p = ctx.staff && (ctx.staff[id] || (Array.isArray(ctx.staff) ? ctx.staff.filter(function (x) { return Number(x.id) === Number(id); })[0] : null)); return p && p.full_name; }
    function paint() {
      if (!S.alive) return;
      var st = S.st, me = ctx.me, focused = host.contains(document.activeElement);
      if (!st) { host.innerHTML = ""; return; }
      if (!st.supported) {
        // Nothing to switch here: say what would make it work, or nothing at all on a browser that never will.
        host.innerHTML = st.iosNeedsHome || ios() ? '<div class="t"><b>Tell me when my shifts change</b><p>' + esc(IOS_WORDS) + "</p></div>" : "";
        host.hidden = !host.innerHTML; return;
      }
      var mine = st.on && me && Number(st.staffId) === Number(me.id), other = st.on && !mine;
      var sub = S.err ? '<p class="e" role="alert">' + esc(S.err) + "</p>"
        : S.note ? '<p role="status">' + esc(S.note) + "</p>"
        : S.busy ? '<p role="status">' + (st.on ? "Turning off…" : "Turning on…") + "</p>"
        : mine ? "<p>On for this device. A notification comes the moment your shifts or leave change.</p>"
        : other ? "<p>This device tells " + esc(name(st.staffId) || "someone else") + " about their shifts. Turn on to switch it to you.</p>"
        : st.permission === "denied" ? '<p>Notifications are blocked for Eikon in this browser’s settings.</p>'
        : "<p>Get a notification on this device the moment your shifts or leave change." + (ios() ? "" : " Free, and nothing to install.") + "</p>";
      host.innerHTML = '<div class="t"><b id="rpp-l">Tell me when my shifts change</b>' + sub + "</div>" +
        '<button type="button" class="rpp-sw" role="switch" data-act="rpp" aria-labelledby="rpp-l" aria-checked="' + (mine ? "true" : "false") + '"' + (S.busy ? ' aria-busy="true"' : "") + "></button>";
      if (focused) { var b = host.querySelector(".rpp-sw"); if (b) b.focus(); }
    }
    async function load() { try { S.st = await state(); } catch (e) { S.st = { supported: false }; } paint(); }
    host.addEventListener("click", async function (ev) {
      var b = ev.target.closest && ev.target.closest(".rpp-sw");
      if (!b || S.busy || !S.st) return;
      var me = ctx.me, mine = S.st.on && me && Number(S.st.staffId) === Number(me.id);
      if (!mine && !me) { S.err = "Choose who you are first."; paint(); return; }
      S.busy = true; S.err = ""; S.note = ""; b.setAttribute("aria-busy", "true"); paint();
      var r;
      try { r = mine ? await off() : await on(me.id); } catch (e) { r = { ok: false, words: (e && e.name === "NotAllowedError") ? "Notifications were not allowed." : "Could not change it on this device. Try again." }; }
      S.busy = false;
      if (r && r.push === false) S.note = r.words; // not set up here: a plain fact, not a mistake (no red)
      else if (r && !r.ok) S.err = r.words || "Could not change it. Try again.";
      else S.note = mine ? "Off for this device." : "On. You will get a notification when your shifts change.";
      await load();
    });
    load();
    return { redraw: function (c) { if (c) ctx = Object.assign(ctx, c); paint(); }, refresh: load, close: function () { S.alive = false; if (host.parentNode) host.parentNode.removeChild(host); } };
  }

  E.rotaPush = { supported: supported, state: state, on: on, off: off, ui: { toggle: toggle }, words: { ios: IOS_WORDS, off: OFF_WORDS } };
})();
