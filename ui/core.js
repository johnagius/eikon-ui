(function () {
  "use strict";

  // Global singleton
  var E = window.EIKON || {};
  window.EIKON = E;

  // Basic identity
  E.APP_NAME = "Eikon";
  // The only page allowed to receive debug log forwarding (postMessage). Never "*".
  E.PARENT_ORIGIN = "https://swiftdataautomation.com";
  E.VERSION = "2026-02-20-05";

  // ---- Clean addresses: the address bar shows just eikonhq.com ----
  // Only on a page the worker served outside /ui/ (index.html reads its mark into EIKON_UI_BASE). The screens still
  // name each other by the old #ids: a #id set anywhere is moved into the history entry's state at once (replaceState
  // to "/", so the history keeps one entry per screen and the bar stays bare), and Back/Forward reaches the router as a
  // hashchange. A deep link (eikonhq.com/endofday, or an old /#endofday) still opens that screen, then the bar goes back
  // to "/". Refresh keeps the screen (the browser keeps history.state). Opened as /ui/index.html (other sites,
  // tablets, the home-screen app) none of this runs and the #hash works as before.
  E.CLEAN_URLS = !!window.EIKON_UI_BASE;
  E.uiUrl = function (rel) { var b = window.EIKON_UI_BASE || ""; return b ? b + String(rel).replace(/^\.\//, "") : rel; };
  var ROUTE_ID = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
  function stateRoute() { try { var s = window.history.state; return s && typeof s.eikonRoute === "string" && ROUTE_ID.test(s.eikonRoute) ? s.eikonRoute : ""; } catch (e) { return ""; } }
  function bare(id) {
    var s = {}; try { var o = window.history.state; if (o && typeof o === "object") for (var k in o) s[k] = o[k]; } catch (e) {}
    s.eikonRoute = id;
    try { window.history.replaceState(s, "", "/" + window.location.search); return true; } catch (e) { return false; }
  }
  // The screen being shown, as "#id" (or ""): the hash, or with clean addresses the history entry's state (or a deep link's path).
  E.routeHash = function () {
    var h = String(window.location.hash || "");
    if (!E.CLEAN_URLS || h) return h;
    var r = stateRoute(); if (r) return "#" + r;
    var p = String(window.location.pathname || "").replace(/^\//, "");
    return ROUTE_ID.test(p) ? "#" + p : "";
  };
  // The app's own "this is the screen now" (boot, fallbacks): the hash as before, or the state in place.
  E.setRoute = function (id) {
    if (E.CLEAN_URLS && bare(id)) return;
    window.location.hash = "#" + id;
  };
  if (E.CLEAN_URLS) {
    var hashToState = function () {
      var h = String(window.location.hash || "").replace(/^#/, "");
      if (ROUTE_ID.test(h)) bare(h);
    };
    hashToState(); // an old link: eikonhq.com/#endofday -> eikonhq.com, showing End of day
    if (!window.location.hash && !stateRoute()) { var p0 = String(window.location.pathname || "").replace(/^\//, ""); if (ROUTE_ID.test(p0)) bare(p0); } // eikonhq.com/endofday
    window.addEventListener("hashchange", hashToState); // first listener, so the router and the screens read the state
    window.addEventListener("popstate", function () {
      if (window.location.hash) return; // a #id change: its own hashchange follows
      var ev; try { ev = new HashChangeEvent("hashchange"); } catch (e) { ev = document.createEvent("Event"); ev.initEvent("hashchange", false, false); }
      window.dispatchEvent(ev);
    });
  }

  // Splash / loading assets (static files under /ui/assets/)
  // Put these two files in: ui/assets/
  //   - eikon-logo.png
  //   - eikon-intro.gif
  E.SPLASH = {
    logoUrl: E.uiUrl("./assets/eikon-logo.png") + "?v=" + encodeURIComponent(E.VERSION),
    introGifUrl: E.uiUrl("./assets/eikon-intro.gif") + "?v=" + encodeURIComponent(E.VERSION),
    introMs: 4930
  };

  // Intro can be disabled by adding ?intro=0 to the iframe URL

  // The reimagined opening screen. ?ui=2 turns it on for this browser (remembered),
  // ?ui=1 turns it off. #today works at any time; #dashboard stays one click away.
  (function initUi2() {
    try {
      var u = new URL(window.location.href);
      var v = u.searchParams.get("ui");
      if (v === "2") { window.localStorage.setItem("eikon_ui2", "1"); window.sessionStorage.removeItem("eikon_ui2_pause"); }
      else if (v === "1") window.localStorage.setItem("eikon_ui2", "0"); // the classic layout, remembered
      else if (v === "classic") window.sessionStorage.setItem("eikon_ui2_pause", "1"); // one visit to an old screen
    } catch (e) {}
  })();
  // The new shell shows only rebuilt screens. An old module opens in the classic layout
  // for this visit (sessionStorage), with one button back; the preference itself is kept.
  // The new layout is the default for pharmacies (since 2026-11-03); "Classic layout" in Settings or ?ui=1 keeps the
  // old one for this browser (eikon_ui2 = "0"). Supplier and company-admin portals always use the classic look.
  E.isUi2 = function () {
    try { if (window.sessionStorage.getItem("eikon_ui2_pause") === "1") return false; } catch (e) {}
    try { if (window.localStorage.getItem("eikon_ui2") === "0") return false; } catch (e) { return false; }
    try { var r = window.localStorage.getItem("eikon_active_role"); if (r && r !== "pharmacy") return false; } catch (e) {}
    return true;
  };
  // Light look from the very first screen (sign-in, portal picker), not only after sign-in.
  try { document.documentElement.toggleAttribute("data-ui2", E.isUi2()); } catch (e) {}
  E.isUi2Paused = function () {
    try { return window.localStorage.getItem("eikon_ui2") !== "0" && window.sessionStorage.getItem("eikon_ui2_pause") === "1"; } catch (e) { return false; }
  };
  E.openClassic = function (hash) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("ui", "classic");
      u.hash = "#" + String(hash || "dashboard").replace(/^#/, "");
      window.location.href = u.toString();
    } catch (e) { window.location.hash = "#" + hash; }
  };
  E.returnToNew = function (hash) {
    try {
      var u = new URL(window.location.href);
      u.searchParams.set("ui", "2");
      u.hash = "#" + String(hash || "today").replace(/^#/, "");
      window.location.href = u.toString();
    } catch (e) {}
  };
  E.isIntroEnabled = function () {
    if (E.isUi2()) return false; // no film before work
    return E._isIntroEnabledOriginal ? E._isIntroEnabledOriginal() : true;
  };
  E._isIntroEnabledOriginal = function () {
    try {
      var u = new URL(window.location.href);
      // The intro film made everyone wait about 5 s on every load and refresh.
      // It is off by default now; ?intro=1 still plays it.
      var v = String(u.searchParams.get("intro") || "").trim().toLowerCase();
      return v === "1" || v === "true" || v === "on" || v === "yes";
    } catch (e) {
      return false;
    }
  };

  // Play GIF then swap to static image (prevents looping forever)
  E.playGifOnceThenSwap = function (imgEl, gifUrl, swapUrl, ms) {
    try {
      if (!imgEl) return;
      var did = false;

      function schedule() {
        if (did) return;
        did = true;
        var t = Math.max(0, Number(ms) || 0);

        setTimeout(function () {
          try { if (swapUrl) imgEl.src = swapUrl; } catch (e) {}
        }, t);
      }

      if (gifUrl) {
        try { imgEl.src = gifUrl; } catch (e2) {}
      }

      try {
        if (imgEl.complete) schedule();
        else imgEl.addEventListener("load", schedule, { once: true });
      } catch (e3) {
        schedule();
      }

      // Hard fallback
      setTimeout(schedule, Math.max(0, Number(ms) || 0) + 2500);
    } catch (e4) {}
  };

  // Intro overlay: show GIF once at boot, keep it visible for introMs minimum,
  // and only remove after BOTH:
  //   - introMs elapsed
  //   - first screen (login OR first module render) completed
  E._intro = null;

  E.showIntroOverlayOnce = function () {
    try {
      if (!E.isIntroEnabled()) return;
      if (E._intro && E._intro.active) return;

      if (!document.body) {
        document.addEventListener("DOMContentLoaded", function () {
          try { E.showIntroOverlayOnce(); } catch (e) {}
        }, { once: true });
        return;
      }

      E._intro = {
        active: true,
        minDone: false,
        screenDone: false,
        overlay: null,
        hideIfReady: function () {
          try {
            if (!E._intro || !E._intro.active) return;
            if (!(E._intro.minDone && E._intro.screenDone)) return;
            if (E._intro.overlay && E._intro.overlay.parentNode) {
              E._intro.overlay.parentNode.removeChild(E._intro.overlay);
            }
            E._intro.active = false;
          } catch (e) {}
        }
      };

      var ov = document.createElement("div");
      ov.id = "eikon-intro-overlay";
      ov.style.position = "fixed";
      ov.style.inset = "0";
      ov.style.zIndex = "2147483646";
      ov.style.background = "rgba(11,15,20,0.92)";
      ov.style.display = "flex";
      ov.style.alignItems = "center";
      ov.style.justifyContent = "center";
      ov.style.padding = "18px";

      var img = document.createElement("img");
      img.id = "eikon-intro-gif";
      img.alt = "Eikon";
      img.style.width = "min(860px, 92vw)";
      img.style.height = "auto";
      img.style.display = "block";
      img.style.filter = "drop-shadow(0 10px 40px rgba(0,0,0,.55))";

      img.addEventListener("error", function () {
        try { E.warn("[splash] intro gif failed to load:", E.SPLASH.introGifUrl); } catch (e) {}
      });

      ov.appendChild(img);
      document.body.appendChild(ov);
      E._intro.overlay = ov;

      // Start GIF and ensure it can't loop forever
      E.playGifOnceThenSwap(img, E.SPLASH.introGifUrl, E.SPLASH.logoUrl, E.SPLASH.introMs);

      // Minimum display timer
      setTimeout(function () {
        if (!E._intro) return;
        E._intro.minDone = true;
        E._intro.hideIfReady();
      }, Math.max(0, Number(E.SPLASH.introMs) || 0));

    } catch (e2) {}
  };

  E.markIntroScreenDone = function () {
    try {
      if (!E._intro) return;
      E._intro.screenDone = true;
      E._intro.hideIfReady();
    } catch (e) {}
  };

  // ---- show intro as early as possible (covers the PWA's own "UI loading" text) ----
  try { E.showIntroOverlayOnce(); } catch (eEarly) {}

  // Debug level: 0 none, 1 normal, 2 verbose
  (function initDebug() {
    var url;
    try { url = new URL(window.location.href); } catch (e) { url = null; }
    var dbgParam = url ? (url.searchParams.get("dbg") || "") : "";
    var lsDbg = "";
    try { lsDbg = String(window.localStorage.getItem("eikon_dbg") || ""); } catch (e2) {}

    var dbg = 0;
    if (dbgParam) dbg = parseInt(dbgParam, 10) || 0;
    else if (lsDbg) dbg = parseInt(lsDbg, 10) || 0;

    E.DEBUG = dbg;
    if (dbgParam) {
      try { window.localStorage.setItem("eikon_dbg", String(dbg)); } catch (e3) {}
    }
  })();

  function ts() {
    try { var d = new Date(); return d.toISOString(); } catch (e) { return ""; }
  }

  function safeToString(x) {
    try {
      if (x === undefined) return "undefined";
      if (x === null) return "null";
      if (typeof x === "string") return x;
      return JSON.stringify(x);
    } catch (e) {
      try { return String(x); } catch (e2) { return "[unprintable]"; }
    }
  }

  function postToParent(level, args) {
    try {
      if (!window.parent || window.parent === window) return;
      if (E.DEBUG < 2) return;
      if (!E.PARENT_ORIGIN) return;
      var payload = { type: "EIKON_LOG", level: level, time: ts(), msg: args.map(safeToString).join(" ") };
      window.parent.postMessage(payload, E.PARENT_ORIGIN);
    } catch (e) {}
  }

  function logBase(level, args) {
    var prefix = "[EIKON]";
    var t = ts();
    var out = [prefix, t].concat(args);
    try {
      if (level === "error") console.error.apply(console, out);
      else if (level === "warn") console.warn.apply(console, out);
      else console.log.apply(console, out);
    } catch (e) {}
    postToParent(level, args);
  }

  E.log = function () { logBase("log", Array.prototype.slice.call(arguments)); };
  E.warn = function () { logBase("warn", Array.prototype.slice.call(arguments)); };
  E.error = function () { logBase("error", Array.prototype.slice.call(arguments)); };
  E.dbg = function () { if (E.DEBUG >= 2) logBase("log", ["[DBG]"].concat(Array.prototype.slice.call(arguments))); };

  // One toast for the whole app. Accepts the three call shapes modules use today:
  //   E.toast(message, kind)            kind: error|warn|success|info
  //   E.toast(title, message, kind, ms)
  //   E.showToast(message)
  (function installToast() {
    var KINDS = { error: "bad", err: "bad", bad: "bad", danger: "bad", warn: "warn", warning: "warn", success: "good", ok: "good", good: "good", info: "" };
    function ensureStyles() {
      if (document.getElementById("eikon-core-toast-style")) return;
      var st = document.createElement("style");
      st.id = "eikon-core-toast-style";
      st.textContent =
        ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
        ".eikon-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 10px 30px rgba(0,0,0,.35);}" +
        ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
        ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
        ".eikon-toast.good{border-color:rgba(67,209,122,.45);}" +
        ".eikon-toast.bad{border-color:rgba(255,90,122,.55);}" +
        ".eikon-toast.warn{border-color:rgba(255,200,90,.45);}";
      document.head.appendChild(st);
    }
    E.toast = E.showToast = function (a, b, c, d) {
      var title = "", msg = "", kind = "", ms = 3200;
      if (typeof b === "string" && Object.prototype.hasOwnProperty.call(KINDS, b) && c === undefined) { msg = a; kind = KINDS[b]; }
      else if (b !== undefined && b !== null && typeof b !== "number") { title = a; msg = b; kind = KINDS[c] || ""; if (typeof d === "number") ms = d; }
      else { msg = a; if (typeof b === "number") ms = b; }
      try {
        ensureStyles();
        var wrap = document.getElementById("eikon-toast-wrap");
        if (!wrap) { wrap = document.createElement("div"); wrap.id = "eikon-toast-wrap"; wrap.className = "eikon-toast-wrap"; document.body.appendChild(wrap); }
        var t = document.createElement("div"); t.className = "eikon-toast " + kind; t.setAttribute("role", "status");
        if (title) { var h = document.createElement("div"); h.className = "t-title"; h.textContent = String(title); t.appendChild(h); }
        var m = document.createElement("div"); m.className = "t-msg"; m.textContent = String(msg == null ? "" : msg); t.appendChild(m);
        wrap.appendChild(t);
        setTimeout(function () { try { t.remove(); } catch (e) {} }, ms);
      } catch (e) {}
    };
  })();

  // Crash logging (never silent black screen)
  (function installCrashLogging() {
    window.addEventListener("error", function (ev) {
      try {
        E.error("[GLOBAL] window.error:", ev && (ev.message || ev.error || ev));
        if (ev && ev.error && ev.error.stack) E.error("[GLOBAL] stack:", ev.error.stack);
        E.showFatalOverlay("Uncaught error", ev && (ev.message || (ev.error && ev.error.stack) || String(ev)));
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        E.error("[GLOBAL] unhandledrejection:", ev && ev.reason);
        if (ev && ev.reason && ev.reason.stack) E.error("[GLOBAL] stack:", ev.reason.stack);
        E.showFatalOverlay("Unhandled promise rejection", ev && (ev.reason && (ev.reason.stack || ev.reason.message)) || String(ev));
      } catch (e) {}
    });
    E.dbg("[GLOBAL] crash logging installed");
  })();

  // DOM helpers
  E.q = function (sel, root) { return (root || document).querySelector(sel); };
  E.qa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  E.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };

  // Token storage
  E.TOKEN_KEY = "eikon_token";
  E.getToken = function () { try { return String(window.localStorage.getItem(E.TOKEN_KEY) || ""); } catch (e) { return ""; } };
  E.setToken = function (t) { try { window.localStorage.setItem(E.TOKEN_KEY, String(t || "")); } catch (e) {} };
  E.clearToken = function () { try { window.localStorage.removeItem(E.TOKEN_KEY); } catch (e) {} };

  // API base (same-origin, because UI is served by the Worker)
  E.apiBase = "";
  // One shared GET for data several screens use (e.g. the supplier inventory): screens opened
  // within ttlMs reuse the same response or in-flight request instead of downloading it again.
  E._getCache = {};
  E.getShared = function (path, ttlMs) {
    var c = E._getCache[path], now = Date.now();
    if (c && (now - c.at) < (ttlMs || 300000)) return c.p;
    var p = E.apiFetch(path, { method: "GET" });
    E._getCache[path] = { at: now, p: p };
    p.catch(function () { if (E._getCache[path] && E._getCache[path].p === p) delete E._getCache[path]; });
    return p;
  };

  // Fetch wrapper with heavy debugging
  E.apiFetch = async function (path, options) {
    var opts = options || {};
    var method = (opts.method || "GET").toUpperCase();
    var headers = new Headers(opts.headers || {});
    var token = E.getToken();

    if (!headers.has("Content-Type") && opts.body && typeof opts.body === "string") {
      headers.set("Content-Type", "application/json");
    }
    if (token) headers.set("Authorization", "Bearer " + token);

    var url = path;
    if (!/^https?:\/\//i.test(path)) url = (E.apiBase || "") + path;
    if (String(method).toUpperCase() !== "GET") { E.lastWriteAt = Date.now(); E._getCache = {}; } // any save makes shared caches stale

    var reqInfo = { method: method, headers: {}, hasToken: !!token };
    try { headers.forEach(function (v, k) { reqInfo.headers[k] = (String(k).toLowerCase() === "authorization") ? "Bearer [redacted]" : v; }); } catch (e) {}

    if (E.DEBUG >= 2) {
      E.dbg("[api] ->", url, reqInfo);
      if (opts.body) E.dbg("[api] body ->", opts.body);
    } else {
      E.log("[api] ->", method, url);
    }

    // One client for every module: a timeout, one retry for safe reads, and session
    // expiry handled in one place instead of surfacing as "HTTP 401" on every screen.
    var timeoutMs = (typeof opts.timeoutMs === "number" && opts.timeoutMs > 0) ? opts.timeoutMs : 20000;
    var retriesLeft = (method === "GET" && opts.retry !== false) ? 1 : 0;
    var res, text, json;
    for (;;) {
      var ctrl = (typeof AbortController === "function") ? new AbortController() : null;
      var timer = ctrl ? setTimeout(function () { try { ctrl.abort(); } catch (eA) {} }, timeoutMs) : null;
      try {
        res = await fetch(url, { method: method, headers: headers, body: opts.body || undefined, signal: ctrl ? ctrl.signal : undefined });
      } catch (e2) {
        if (timer) clearTimeout(timer);
        var aborted = !!(e2 && (e2.name === "AbortError"));
        if (retriesLeft > 0) { retriesLeft--; E.warn("[api] retrying after " + (aborted ? "timeout" : "network error") + ":", method, url); continue; }
        var netErr = new Error(aborted ? ("Request timed out after " + Math.round(timeoutMs / 1000) + " s") : "Network error");
        netErr.status = 0; netErr.cause = e2; netErr.network = true;
        E.error("[api] network error:", e2);
        throw netErr;
      }
      if (timer) clearTimeout(timer);
      if (retriesLeft > 0 && (res.status === 502 || res.status === 503 || res.status === 504)) {
        retriesLeft--; E.warn("[api] retrying after HTTP " + res.status + ":", method, url);
        await new Promise(function (r) { setTimeout(r, 400); });
        continue;
      }
      break;
    }

    if (res.status === 401 && token && path !== "/auth/login") {
      E.handleSessionExpired();
    }

    var ct = "";
    try { ct = String(res.headers.get("Content-Type") || ""); } catch (e3) {}
    try { text = await res.text(); } catch (e4) { text = ""; }

    json = null;
    if (ct.toLowerCase().indexOf("application/json") >= 0) {
      try { json = JSON.parse(text || "null"); } catch (e5) { json = null; }
    } else {
      try { json = JSON.parse(text || "null"); } catch (e6) { json = null; }
    }

    if (E.DEBUG >= 2) {
      E.dbg("[api] <-", url, { status: res.status, ok: res.ok, ct: ct });
      E.dbg("[api] resp <-", (json !== null ? json : text));
    } else {
      E.log("[api] <-", method, url, "status=" + res.status);
    }

    if (!res.ok) {
      var err = new Error((json && json.error) ? json.error : ("HTTP " + res.status));
      err.status = res.status;
      err.bodyText = text;
      err.bodyJson = json;
      throw err;
    }
    return (json !== null ? json : { ok: true, text: text });
  };

  // Called once when the server says the session is gone: keep the place, show sign-in.
  E._sessionExpiredShown = false;
  E.handleSessionExpired = function () {
    if (E._sessionExpiredShown) return;
    E._sessionExpiredShown = true;
    try { E._returnHash = String(E.routeHash() || ""); } catch (e) {}
    if (E._supplierPollInterval) { try { clearInterval(E._supplierPollInterval); } catch (e) {} E._supplierPollInterval = null; }
    E.clearToken();
    E.state.user = null;
    try { E.renderLogin("Your session has ended. Sign in again to continue where you were."); } catch (e) {}
  };

  // Module registry
  E.modules = E.modules || {};
  // Resolved by start() (main.js loads last, after every module). Sign-in can show before this.
  E.modulesReady = E.modulesReady || new Promise(function (r) { E._resolveModulesReady = r; });

  E.registerModule = function (mod) {
    if (!mod || !mod.id) throw new Error("Invalid module registration (missing id)");
    E.modules[mod.id] = mod;
    E.dbg("[core] module registered:", mod.id);
  };

  // Sidebar category configuration
  E.SIDEBAR_CATEGORIES = [
    { label: "Inspections", icon: "🔍", moduleIds: [
      "temperature", "cleaning", "dda-purchases", "dda-sales", "dda_stocktakes",
      "dda-poyc", "dailyregister", "repeatprescriptions", "locumregister",
      "certificates", "audit"
    ]},
    { label: "Operations", icon: "⚙️", moduleIds: [
      "emergency-pos", "endofday", "shifts", "creditnotes", "paidout", "locumreceipts", "labels"
    ]},
    { label: "Sales & Clients", icon: "🛒", moduleIds: [
      "clientorders", "quotations", "order-diary", "deliveries",
      "appointments", "tickets", "loyalty", "supplier-inventory"
    ]},
    { label: "Inventory", icon: "📦", moduleIds: [
      "alerts", "stocktransfers", "returns", "nearexpiry", "scarcestock"
    ]},
    { label: "Communication", icon: "💬", moduleIds: [
      "messageboard", "instructions"
    ]},
    { label: "Clinical", icon: "🏥", moduleIds: [
      "poct", "vaccines", "ocps", "pharmacycalc", "pharmacovigilance", "screening", "otcmindmap"
    ]},
    { label: "Reference", icon: "📇", moduleIds: [
      "contacts"
    ]}
  ];

  // Role-based section constants
  E.ROLE_PHARMACY = "pharmacy";          // location_id 0-399
  E.ROLE_SUPPLIER = "supplier";          // location_id 400-599
  E.ROLE_COMPANY_ADMIN = "company_admin"; // location_id 600-900
  E.SUPERUSER_EMAIL = "labrint@gmail.com";

  E.getRolesForUser = function (user) {
    if (!user) return [];
    var locId = Number(user.location_id);
    var email = String(user.email || "").trim().toLowerCase();

    // Superuser gets all roles
    if (email === E.SUPERUSER_EMAIL) {
      return [E.ROLE_PHARMACY, E.ROLE_SUPPLIER, E.ROLE_COMPANY_ADMIN];
    }

    var roles = [];
    if (locId >= 0 && locId <= 399) roles.push(E.ROLE_PHARMACY);
    if (locId >= 400 && locId <= 599) roles.push(E.ROLE_SUPPLIER);
    if (locId >= 600 && locId <= 900) roles.push(E.ROLE_COMPANY_ADMIN);
    return roles;
  };

  // Sidebar categories for Supplier section
  E.SUPPLIER_CATEGORIES = [
    { label: "Products", icon: "\uD83D\uDCE6", moduleIds: ["supplier-products"] },
    { label: "Orders", icon: "\uD83D\uDCCB", moduleIds: ["supplier-received-orders", "supplier-order-feedback"] }
  ];

  // Sidebar categories for Company Admin section
  E.COMPANY_ADMIN_CATEGORIES = [
    { label: "Overview", icon: "\uD83D\uDCCA", moduleIds: ["admin-overview"] }
  ];

  // UI mounts
  E.state = { user: null, activeModuleId: "", activeRole: "", sidebarCollapsed: false, expandedCategory: null, started: false };

  E.ensureRoot = function () {
    var root = document.getElementById("eikon-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "eikon-root";
      document.body.appendChild(root);
    }
    return root;
  };

  // Fatal overlay (never silent black screen)
  E.showFatalOverlay = function (title, details) {
    try {
      var overlay = document.getElementById("eikon-fatal-overlay");
      if (!overlay) {
        overlay = document.createElement("div");
        overlay.id = "eikon-fatal-overlay";
        overlay.style.position = "fixed";
        overlay.style.inset = "0";
        overlay.style.background = "rgba(0,0,0,.78)";
        overlay.style.zIndex = "2147483647";
        overlay.style.display = "flex";
        overlay.style.alignItems = "center";
        overlay.style.justifyContent = "center";
        overlay.style.padding = "18px";
        document.body.appendChild(overlay);
      }
      overlay.innerHTML =
        '<div style="max-width:980px;width:100%;background:rgba(15,22,34,.96);border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:14px;">' +
        '<div style="font-weight:900;font-size:16px;margin-bottom:8px;">' + E.escapeHtml(title || "Eikon crashed") + "</div>" +
        '<div style="color:rgba(255,255,255,.75);font-size:12px;margin-bottom:10px;">Open DevTools Console for details. dbg=2 is recommended.</div>' +
        '<pre style="white-space:pre-wrap;word-break:break-word;margin:0;background:rgba(0,0,0,.3);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.10);font-size:12px;line-height:1.4;max-height:60vh;overflow:auto;">' +
        E.escapeHtml(String(details || "")) +
        "</pre>" +
        "</div>";
    } catch (e) {}
  };

  // Modal helper
  E.modal = (function () {
    var overlay = null;
    var stack = []; // saved modal states for nested modals

    function ensure() {
      if (overlay) return overlay;
      overlay = document.createElement("div");
      overlay.className = "eikon-modal-overlay";
      overlay.innerHTML =
        '<div class="eikon-modal">' +
        '  <div class="eikon-modal-title" id="eikon-modal-title"></div>' +
        '  <div class="eikon-modal-body" id="eikon-modal-body"></div>' +
        '  <div class="eikon-modal-actions" id="eikon-modal-actions"></div>' +
        "</div>";
      document.body.appendChild(overlay);
      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) hide();
      });
      return overlay;
    }

    function show(title, bodyHtml, actions) {
      var ov = ensure();
      // If a modal is already visible, save its state (DOM nodes) to the stack
      if (ov.style.display === "flex") {
        var titleEl = E.q("#eikon-modal-title", ov);
        var bodyEl = E.q("#eikon-modal-body", ov);
        var actEl = E.q("#eikon-modal-actions", ov);
        var savedBody = document.createDocumentFragment();
        while (bodyEl.firstChild) savedBody.appendChild(bodyEl.firstChild);
        var savedActions = document.createDocumentFragment();
        while (actEl.firstChild) savedActions.appendChild(actEl.firstChild);
        stack.push({ title: titleEl.textContent, body: savedBody, actions: savedActions });
      }
      E.q("#eikon-modal-title", ov).textContent = title || "";
      E.q("#eikon-modal-body", ov).innerHTML = bodyHtml || "";
      var act = E.q("#eikon-modal-actions", ov);
      act.innerHTML = "";
      (actions || []).forEach(function (a) {
        var btn = document.createElement("button");
        btn.className = "eikon-btn" + (a.primary ? " primary" : "") + (a.danger ? " danger" : "");
        btn.textContent = a.label || "OK";
        btn.addEventListener("click", function () { a.onClick && a.onClick(); });
        act.appendChild(btn);
      });
      ov.style.display = "flex";
    }

    function hide() {
      if (!overlay) return;
      if (stack.length > 0) {
        // Restore previous modal from stack (DOM nodes preserve input values & listeners)
        var saved = stack.pop();
        var titleEl = E.q("#eikon-modal-title", overlay);
        var bodyEl = E.q("#eikon-modal-body", overlay);
        var actEl = E.q("#eikon-modal-actions", overlay);
        titleEl.textContent = saved.title;
        bodyEl.innerHTML = "";
        bodyEl.appendChild(saved.body);
        actEl.innerHTML = "";
        actEl.appendChild(saved.actions);
      } else {
        overlay.style.display = "none";
      }
    }

    return { show: show, hide: hide };
  })();

  // ─── Help Guide ──────────────────────────────────────────────────────────
  // Content populated by help-content.js
  E.HELP_CONTENT = [];

  // Category grouping for help sidebar
  E.HELP_CATEGORIES = [
    { label: "General", ids: ["dashboard"] },
    { label: "Inspections", ids: ["temperature", "cleaning", "dda-purchases", "dda-sales", "dda_stocktakes", "dda-poyc", "dailyregister", "certificates"] },
    { label: "Operations", ids: ["emergency-pos", "endofday", "shifts", "creditnotes", "paidout", "locumreceipts", "labels"] },
    { label: "Sales & Clients", ids: ["clientorders", "quotations", "order-diary", "deliveries", "appointments", "tickets", "loyalty", "supplier-inventory"] },
    { label: "Inventory", ids: ["alerts", "stocktransfers", "returns", "nearexpiry", "scarcestock"] },
    { label: "Communication", ids: ["messageboard", "instructions"] },
    { label: "Clinical", ids: ["poct", "vaccines", "ocps", "pharmacycalc", "pharmacovigilance", "screening", "otcmindmap"] },
    { label: "Reference", ids: ["contacts"] }
  ];

  E._helpContentById = null; // lazy cache
  E._getHelpById = function (id) {
    if (!E._helpContentById) {
      E._helpContentById = {};
      E.HELP_CONTENT.forEach(function (m) { E._helpContentById[m.id] = m; });
    }
    return E._helpContentById[id] || null;
  };


  E.showHelpGuide = function (moduleId) {
    var overlay = document.getElementById("eikon-help-overlay");

    if (!overlay) {
      overlay = document.createElement("div");
      overlay.id = "eikon-help-overlay";
      overlay.className = "eikon-help-overlay";
      overlay.innerHTML =
        '<div class="eikon-help-panel">' +
        '  <button class="eikon-help-close" id="eikon-help-close" title="Close">\u00D7</button>' +
        '  <div class="eikon-help-sidebar" id="eikon-help-sidebar-list">' +
        '    <div class="eikon-help-sidebar-title">Modules</div>' +
        "  </div>" +
        '  <div class="eikon-help-content" id="eikon-help-content-area"></div>' +
        "</div>";
      document.body.appendChild(overlay);

      overlay.addEventListener("click", function (e) {
        if (e.target === overlay) { overlay.style.display = "none"; }
      });
      document.getElementById("eikon-help-close").addEventListener("click", function () {
        overlay.style.display = "none";
      });

      // Populate module list grouped by category
      var list = document.getElementById("eikon-help-sidebar-list");
      E._helpContentById = null; // reset cache
      E.HELP_CATEGORIES.forEach(function (cat) {
        var hasAny = false;
        cat.ids.forEach(function (id) { if (E._getHelpById(id)) hasAny = true; });
        if (!hasAny) return;

        var catHeader = document.createElement("div");
        catHeader.className = "eikon-help-cat-label";
        catHeader.textContent = cat.label;
        list.appendChild(catHeader);

        cat.ids.forEach(function (id) {
          var mod = E._getHelpById(id);
          if (!mod) return;
          var btn = document.createElement("button");
          btn.className = "eikon-help-module-btn";
          btn.setAttribute("data-help-mod", mod.id);
          btn.innerHTML = '<span style="width:18px;text-align:center;flex:0 0 18px">' + mod.icon + "</span> " + mod.title;
          btn.addEventListener("click", function () { E._renderHelpContent(mod.id); });
          list.appendChild(btn);
        });
      });
    }

    overlay.style.display = "flex";
    E._renderHelpContent(moduleId || (E.HELP_CONTENT[0] && E.HELP_CONTENT[0].id) || "");
  };

  E._renderHelpContent = function (modId) {
    var content = document.getElementById("eikon-help-content-area");
    if (!content) return;

    // Highlight active button
    var btns = document.querySelectorAll(".eikon-help-module-btn");
    for (var i = 0; i < btns.length; i++) {
      btns[i].classList.toggle("active", btns[i].getAttribute("data-help-mod") === modId);
    }

    // Find content
    var mod = null;
    for (var j = 0; j < E.HELP_CONTENT.length; j++) {
      if (E.HELP_CONTENT[j].id === modId) { mod = E.HELP_CONTENT[j]; break; }
    }

    if (!mod) {
      content.innerHTML = '<p style="color:var(--muted)">Select a module from the list.</p>';
      return;
    }

    var html = '<h2>' + mod.icon + " " + mod.title + "</h2>";
    if (mod.subtitle) html += '<p class="eikon-help-subtitle">' + mod.subtitle + "</p>";

    mod.sections.forEach(function (s) {
      html += "<h3>" + s.heading + "</h3>";
      html += s.body;
    });

    content.innerHTML = html;
    content.scrollTop = 0;
  };

  // Login UI
  // A real <form>: browsers only offer to save a password on a form submission,
  // which is why Chrome never remembered the Eikon password before.
  E.renderLogin = function (errorText, keepEmail) {
    var root = E.ensureRoot();
    root.innerHTML =
      '<div class="eikon-login">' +
      '  <form class="eikon-login-card" id="eikon-login-form" method="post" action="#" novalidate>' +
      '    <div class="eikon-login-title">Eikon</div>' +
      '    <div class="eikon-login-sub">Sign in to continue</div>' +
      '    <div class="eikon-row">' +
      '      <div class="eikon-field" style="flex:1;min-width:220px;">' +
      '        <label class="eikon-label" for="eikon-login-email">Email</label>' +
      '        <input class="eikon-input" id="eikon-login-email" name="username" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" value="' + E.escapeHtml(keepEmail || "") + '" />' +
      "      </div>" +
      '      <div class="eikon-field" style="flex:1;min-width:220px;">' +
      '        <label class="eikon-label" for="eikon-login-pass">Password</label>' +
      '        <input class="eikon-input" id="eikon-login-pass" name="password" type="password" autocomplete="current-password" />' +
      "      </div>" +
      "    </div>" +
      '    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;">' +
      '      <button class="eikon-btn primary" id="eikon-login-btn" type="submit">Sign in</button>' +
      "    </div>" +
      (errorText ? ('<div class="eikon-alert" role="alert">' + E.escapeHtml(errorText) + "</div>") : "") +
      "  </form>" +
      "</div>";

    var form = document.getElementById("eikon-login-form");
    var emailEl = document.getElementById("eikon-login-email");
    var passEl = document.getElementById("eikon-login-pass");
    var btn = document.getElementById("eikon-login-btn");

    if (emailEl && !emailEl.value) emailEl.focus(); else if (passEl) passEl.focus();

    function doLogin() {
      var email = (emailEl ? emailEl.value : "").trim().toLowerCase();
      var pass = (passEl ? passEl.value : "").trim();

      E.dbg("[auth] login attempt:", email);
      if (!email || !pass) {
        E.renderLogin("Enter your e-mail and password.", email);
        return;
      }

      btn.disabled = true;
      btn.textContent = "Logging in…";
      E._loginInFlight = true; // start() must not also draw the app (see start)

      E.apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: pass })
      })
        .then(function (resp) {
          if (!resp || !resp.ok || !resp.token) throw new Error("Login failed (no token)");
          E.setToken(resp.token);
          E.state.user = resp.user || null;
          E.dbg("[auth] login OK:", resp.user);
          var roles = E.getRolesForUser(resp.user);
          E.dbg("[auth] available roles:", roles);
          // The form can appear before every module has loaded; wait for them only if needed.
          return E.modulesReady.then(function () { return E.renderRoleSelection(roles); });
        })
        .catch(function (err) {
          E.error("[auth] login error:", err);
          E.clearToken();
          E.state.user = null;
          var msg = String(err && (err.message || err.bodyText || err));
          if (err && err.status === 401) msg = "That e-mail and password do not match.";
          if (err && err.status === 429) msg = "Too many attempts. Wait 15 minutes and try again.";
          E.renderLogin(msg, email);
        })
        .finally(function () {
          E._loginInFlight = false;
          try {
            btn.disabled = false;
            btn.textContent = "Sign in";
          } catch (e) {}
        });
    }

    if (form) form.addEventListener("submit", function (e) { e.preventDefault(); doLogin(); });

    // Login is a "screen done" condition for the intro
    E.markIntroScreenDone();
  };

  // Role Selection Screen
  E.renderRoleSelection = function (accessibleRoles) {
    // New layout: one portal means nothing to choose, so go straight in; portals you cannot open are not shown.
    if (E.isUi2() && accessibleRoles && accessibleRoles.length === 1 && typeof E.bootForRole === "function") {
      return E.bootForRole(accessibleRoles[0]);
    }
    var root = E.ensureRoot();
    var user = E.state.user;
    var userName = (user && user.full_name) ? user.full_name : "User";

    var allRoles = [
      {
        key: E.ROLE_PHARMACY,
        title: "Pharmacy",
        desc: "Dispensing, inspections & operations",
        icon: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<rect x="8" y="6" width="32" height="36" rx="6" fill="var(--accent)" opacity="0.15"/>' +
              '<rect x="20" y="14" width="8" height="20" rx="2" fill="var(--accent)"/>' +
              '<rect x="14" y="20" width="20" height="8" rx="2" fill="var(--accent)"/>' +
              '</svg>'
      },
      {
        key: E.ROLE_SUPPLIER,
        title: "Supplier",
        desc: "Supply chain & distribution",
        icon: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<rect x="4" y="14" width="24" height="18" rx="3" fill="var(--accent)" opacity="0.15"/>' +
              '<path d="M28 18h8l6 8v6h-6" stroke="var(--accent)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" fill="var(--accent)" opacity="0.15"/>' +
              '<circle cx="14" cy="36" r="4" fill="var(--accent)"/>' +
              '<circle cx="36" cy="36" r="4" fill="var(--accent)"/>' +
              '<line x1="18" y1="32" x2="28" y2="32" stroke="var(--accent)" stroke-width="2"/>' +
              '</svg>'
      },
      {
        key: E.ROLE_COMPANY_ADMIN,
        title: "Company Administrator",
        desc: "Organisation overview & management",
        icon: '<svg viewBox="0 0 48 48" width="48" height="48" fill="none" xmlns="http://www.w3.org/2000/svg">' +
              '<rect x="10" y="8" width="28" height="32" rx="4" fill="var(--accent)" opacity="0.15"/>' +
              '<rect x="16" y="14" width="6" height="6" rx="1" fill="var(--accent)"/>' +
              '<rect x="26" y="14" width="6" height="6" rx="1" fill="var(--accent)"/>' +
              '<rect x="16" y="24" width="6" height="6" rx="1" fill="var(--accent)"/>' +
              '<rect x="26" y="24" width="6" height="6" rx="1" fill="var(--accent)"/>' +
              '<rect x="20" y="34" width="8" height="6" rx="1" fill="var(--accent)"/>' +
              '</svg>'
      }
    ];

    if (E.isUi2()) allRoles = allRoles.filter(function (r) { return accessibleRoles.indexOf(r.key) !== -1; });
    var tilesHtml = allRoles.map(function (r) {
      var isAccessible = accessibleRoles.indexOf(r.key) !== -1;
      var cls = "eikon-role-option" + (isAccessible ? "" : " disabled");
      return '<div class="' + cls + '" data-role="' + r.key + '">' +
             '  <div class="eikon-role-icon">' + r.icon + '</div>' +
             '  <div class="eikon-role-title">' + r.title + '</div>' +
             '  <div class="eikon-role-desc">' + r.desc + '</div>' +
             '</div>';
    }).join("");

    root.innerHTML =
      '<div class="eikon-role-select">' +
      '  <div class="eikon-role-card">' +
      '    <div class="eikon-login-title">Eikon</div>' +
      '    <div class="eikon-login-sub">Welcome, ' + E.escapeHtml(userName) + '. Select your portal</div>' +
      '    <div class="eikon-role-options">' + tilesHtml + '</div>' +
      '    <div style="margin-top:18px;text-align:center;">' +
      '      <button class="eikon-btn" id="eikon-role-logout-btn">Logout</button>' +
      '    </div>' +
      '  </div>' +
      '</div>';

    // Bind accessible tile clicks
    var tiles = root.querySelectorAll(".eikon-role-option:not(.disabled)");
    for (var i = 0; i < tiles.length; i++) {
      (function (tile) {
        tile.addEventListener("click", function () {
          var role = tile.getAttribute("data-role");
          E.bootForRole(role);
        });
      })(tiles[i]);
    }

    // Logout button
    var logoutBtn = document.getElementById("eikon-role-logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", function () { E.logout(); });

    E.markIntroScreenDone();
  };

  // Boot dispatcher based on selected role
  E.bootForRole = async function (role) {
    E.state.activeRole = role;
    try { window.localStorage.setItem("eikon_active_role", role); } catch (e) {}

    if (role === E.ROLE_PHARMACY) {
      E._activeSidebarCategories = E.SIDEBAR_CATEGORIES.slice();
      if (E.state.user && Number(E.state.user.org_id) === 12) {
        E._activeSidebarCategories.push({ label: "Cherubino", icon: "\uD83C\uDFE5", moduleIds: ["cherubino-orders", "cherubino-prices", "cherubino-shortexpiry", "cherubino-oos"] });
      }
      E._sectionDashboardId = (E.isUi2() && E.modules.today) ? "today" : "dashboard";
      try { document.documentElement.toggleAttribute("data-ui2", E.isUi2()); document.documentElement.toggleAttribute("data-ui2-visit", E.isUi2Paused()); } catch (e) {}
      return E.bootAuthed();
    } else if (role === E.ROLE_SUPPLIER) {
      return E.bootSection("supplier");
    } else if (role === E.ROLE_COMPANY_ADMIN) {
      return E.bootSection("company_admin");
    }
  };

  // Boot a non-pharmacy section
  E.bootSection = async function (section) {
    try { document.documentElement.removeAttribute("data-ui2"); document.documentElement.removeAttribute("data-ui2-visit"); } catch (e) {} // portals keep the classic look
    if (section === "supplier") {
      E._activeSidebarCategories = E.SUPPLIER_CATEGORIES;
      E._sectionDashboardId = "supplier-dashboard";
      // Start polling for unresolved feedback (sidebar badge + flash)
      setTimeout(function () { E._startSupplierAlertPoll(); }, 500);
    } else if (section === "company_admin") {
      E._activeSidebarCategories = E.COMPANY_ADMIN_CATEGORIES.slice();
      if (E.state.user && Number(E.state.user.org_id) === 12) {
        E._activeSidebarCategories.push({ label: "Cherubino", icon: "\uD83C\uDFE5", moduleIds: ["cherubino-admin", "cherubino-prices", "cherubino-shortexpiry", "cherubino-oos"] });
      }
      E._sectionDashboardId = "company-dashboard";
    }

    E.setRoute(E._sectionDashboardId);
    E.renderShell();

    try {
      await E.renderActiveModule();
    } finally {
      E.markIntroScreenDone();
    }
  };

  // Shell + Router
  E.renderShell = function () {
    var root = E.ensureRoot();

    // restore sidebar state
    var collapsed = false;
    try { collapsed = String(window.localStorage.getItem("eikon_sidebar_collapsed") || "") === "1"; } catch (e) {}
    E.state.sidebarCollapsed = collapsed;

    root.innerHTML =
      '<div class="eikon-layout">' +
      '  <aside class="eikon-sidebar' + (collapsed ? " collapsed" : "") + '" id="eikon-sidebar">' +
      '    <div class="eikon-sidebar-header">' +
      '      <div class="eikon-brand">Eikon</div>' +
      '      <button class="eikon-collapse-btn" id="eikon-collapse-btn" title="Collapse/Expand">≡</button>' +
      "    </div>" +
      '    <nav class="eikon-nav" id="eikon-nav"></nav>' +
      "  </aside>" +
      '  <main class="eikon-main">' +
      '    <div class="eikon-topbar">' +
      '      <div class="eikon-top-left">' +
      '        <button class="eikon-btn primary" id="eikon-back-btn" style="display:none" title="Back to the new Eikon">‹ New Eikon</button>' +
      '        <img id="eikon-topbar-logo" alt="Eikon" style="height:26px;width:auto;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));" />' +
      '        <div class="eikon-page-title" id="eikon-page-title"><span id="eikon-page-title-text">Loading…</span></div>' +
      "      </div>" +
      '      <div class="eikon-user">' +
      '        <span id="eikon-user-label"></span>' +
      '        <button class="eikon-btn" id="eikon-switch-portal-btn" style="display:none;">Switch Portal</button>' +
      '        <button class="eikon-btn" id="eikon-password-btn" title="Change your password">Password</button>' +
      '        <button class="eikon-btn" id="eikon-logout-btn">Logout</button>' +
      '        <button class="eikon-btn" id="eikon-fullscreen-btn">Fullscreen</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="eikon-content" id="eikon-content"></div>' +
      "  </main>" +
      "</div>";

    // Set topbar logo
    try {
      var logoEl = document.getElementById("eikon-topbar-logo");
      if (logoEl) {
        logoEl.src = E.SPLASH.logoUrl;
        logoEl.addEventListener("error", function () {
          try { E.warn("[splash] logo failed to load:", E.SPLASH.logoUrl); } catch (e) {}
        });
      }
    } catch (e) {}

    // Sidebar toggle
    var collapseBtn = document.getElementById("eikon-collapse-btn");
    var sidebar = document.getElementById("eikon-sidebar");
    if (collapseBtn && sidebar) {
      collapseBtn.addEventListener("click", function () {
        var nowCollapsed = !sidebar.classList.contains("collapsed");
        sidebar.classList.toggle("collapsed", nowCollapsed);
        E.state.sidebarCollapsed = nowCollapsed;
        try { window.localStorage.setItem("eikon_sidebar_collapsed", nowCollapsed ? "1" : "0"); } catch (e) {}
      });
    }

    // Switch Portal (only visible if user has multiple roles)
    var switchBtn = document.getElementById("eikon-switch-portal-btn");
    if (switchBtn && E.state.user) {
      var userRoles = E.getRolesForUser(E.state.user);
      if (userRoles.length > 1) {
        switchBtn.style.display = "";
        switchBtn.addEventListener("click", function () {
          E.state.activeRole = "";
          try { window.localStorage.removeItem("eikon_active_role"); } catch (e) {}
          E._activeSidebarCategories = null;
          E._sectionDashboardId = null;
          E.renderRoleSelection(userRoles);
        });
      }
    }

    // Back (reimagined shell only): to the hub the open module belongs to
    var backBtn = document.getElementById("eikon-back-btn");
    if (backBtn && E.isUi2Paused()) {
      backBtn.style.display = "";
      backBtn.addEventListener("click", function () {
        var to = null;
        try { to = sessionStorage.getItem("eikon_ui2_return"); sessionStorage.removeItem("eikon_ui2_return"); } catch (e) {}
        E.returnToNew(to || "today");
      });
    }

    // Change password
    var pwBtn = document.getElementById("eikon-password-btn");
    if (pwBtn) pwBtn.addEventListener("click", function () { E.showChangePassword(); });

    // Logout
    var logoutBtn = document.getElementById("eikon-logout-btn");
    if (logoutBtn) logoutBtn.addEventListener("click", function () { E.logout(); });

    // Fullscreen / Exit Fullscreen
    var fsBtn = document.getElementById("eikon-fullscreen-btn");
    if (fsBtn) {
      var isFullscreenHost = false;
      try {
        var u = new URL(window.location.href);

        // Only treat as fullscreen host when this UI is running top-level (not embedded in an iframe)
        var isTop = false;
        try { isTop = (window.top === window); } catch (eTop) { isTop = false; }

        isFullscreenHost =
          isTop &&
          (u.hostname === "eikon-api.labrint.workers.dev") &&
          (/\/ui(\/index\.html)?\/?$/.test(u.pathname));
      } catch (e) {}

      var enterBase = "https://eikon-api.labrint.workers.dev/ui/index.html";
      var exitBase = "https://swiftdataautomation.com/eikon";

      fsBtn.textContent = isFullscreenHost ? "Exit Fullscreen" : "Fullscreen";
      fsBtn.title = fsBtn.textContent;

      fsBtn.addEventListener("click", function () {
        var base = isFullscreenHost ? exitBase : enterBase;
        try {
          var q = window.location.search || "";
          var h = E.routeHash() || "";
          var target = base + q + h;

          if (isFullscreenHost) {
            window.location.href = target;
          } else {
            var w = window.open(target, "_blank", "noopener");
            if (!w) window.location.href = target;
          }
        } catch (e2) {
          try { window.location.href = base; } catch (e3) {}
        }
      });
    }

    // Nav
    E.renderNav();
  };

  // Helper: create a module nav button
  E._createNavBtn = function (m) {
    var btn = document.createElement("button");
    btn.className = "eikon-nav-btn";
    btn.setAttribute("data-mod", m.id);

    var ico = document.createElement("span");
    ico.className = "eikon-nav-ico";
    ico.textContent = (m.icon || "•");

    var label = document.createElement("span");
    label.className = "eikon-nav-label";
    label.textContent = (m.title || m.id);

    var badge = document.createElement("span");
    badge.className = "eikon-nav-badge";
    badge.style.display = "none";

    btn.appendChild(ico);
    btn.appendChild(label);
    btn.appendChild(badge);
    btn.addEventListener("click", function () { window.location.hash = "#" + m.id; });
    return btn;
  };

  // Helper: find category for a module id
  E._categoryForModule = function (modId) {
    var cats = E._activeSidebarCategories || E.SIDEBAR_CATEGORIES;
    for (var i = 0; i < cats.length; i++) {
      if (cats[i].moduleIds.indexOf(modId) !== -1) {
        return cats[i].label;
      }
    }
    return null;
  };

  // Expand a category (accordion: collapses others)
  E._expandCategory = function (catLabel) {
    var wasExpanded = E.state.expandedCategory === catLabel;
    E.state.expandedCategory = wasExpanded ? null : catLabel;
    try { window.localStorage.setItem("eikon_sidebar_cat", E.state.expandedCategory || ""); } catch (e) {}

    var groups = E.qa(".eikon-nav-cat-group", document);
    groups.forEach(function (g) {
      var label = g.getAttribute("data-cat") || "";
      var items = g.querySelector(".eikon-nav-cat-items");
      var header = g.querySelector(".eikon-nav-cat");
      var isTarget = label === catLabel && !wasExpanded;
      if (items) items.classList.toggle("expanded", isTarget);
      if (header) header.classList.toggle("expanded", isTarget);
    });
  };

  E.renderNav = function () {
    var nav = document.getElementById("eikon-nav");
    if (!nav) return;
    nav.innerHTML = "";

    // Restore expanded category from localStorage
    try {
      var saved = window.localStorage.getItem("eikon_sidebar_cat") || "";
      if (saved) E.state.expandedCategory = saved;
    } catch (e) {}

    // All registered modules
    var allMods = Object.keys(E.modules || {}).map(function (k) { return E.modules[k]; });
    allMods.sort(function (a, b) { return (a.order || 999) - (b.order || 999); });

    // Build module lookup
    var modById = {};
    allMods.forEach(function (m) { modById[m.id] = m; });

    if (E.isUi2() && (E._sectionDashboardId === "today") && modById.today) { E.renderNavUi2(nav, modById); return; }

    // --- Search input ---
    var searchWrap = document.createElement("div");
    searchWrap.className = "eikon-nav-search";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search modules…";
    searchInput.className = "eikon-nav-search-input";
    searchWrap.appendChild(searchInput);
    nav.appendChild(searchWrap);

    // --- Categories container (hidden during search) ---
    var catsContainer = document.createElement("div");
    catsContainer.className = "eikon-nav-cats";
    nav.appendChild(catsContainer);

    // --- Search results container (hidden by default) ---
    var searchResults = document.createElement("div");
    searchResults.className = "eikon-nav-search-results";
    searchResults.style.display = "none";
    nav.appendChild(searchResults);

    // --- Dashboard (standalone, no category) ---
    var dashId = E._sectionDashboardId || "dashboard";
    var dash = modById[dashId];
    if (dash) {
      catsContainer.appendChild(E._createNavBtn(dash));
    }
    // Reimagined shell: Customers sits beside Today, above the old categories.
    if (E.isUi2() && dashId === "today" && modById.customers) {
      catsContainer.appendChild(E._createNavBtn(modById.customers));
    }

    // --- Render each category ---
    var cats = E._activeSidebarCategories || E.SIDEBAR_CATEGORIES;
    cats.forEach(function (cat) {
      var group = document.createElement("div");
      group.className = "eikon-nav-cat-group";
      group.setAttribute("data-cat", cat.label);

      // Category header
      var header = document.createElement("button");
      header.className = "eikon-nav-cat";
      var isExpanded = E.state.expandedCategory === cat.label;
      if (isExpanded) header.classList.add("expanded");

      var catIco = document.createElement("span");
      catIco.className = "eikon-nav-cat-ico";
      catIco.textContent = cat.icon;

      var catLabel = document.createElement("span");
      catLabel.className = "eikon-nav-cat-label";
      catLabel.textContent = cat.label;

      var chevron = document.createElement("span");
      chevron.className = "eikon-nav-cat-chevron";
      chevron.textContent = "›";

      header.appendChild(catIco);
      header.appendChild(catLabel);
      header.appendChild(chevron);

      header.addEventListener("click", function () {
        E._expandCategory(cat.label);
      });

      group.appendChild(header);

      // Category items
      var itemsWrap = document.createElement("div");
      itemsWrap.className = "eikon-nav-cat-items";
      if (isExpanded) itemsWrap.classList.add("expanded");

      // Sort category modules by their order
      var catMods = [];
      cat.moduleIds.forEach(function (id) {
        if (modById[id]) catMods.push(modById[id]);
      });
      catMods.sort(function (a, b) { return (a.order || 999) - (b.order || 999); });

      catMods.forEach(function (m) {
        itemsWrap.appendChild(E._createNavBtn(m));
      });

      group.appendChild(itemsWrap);
      catsContainer.appendChild(group);
    });

    // --- Search logic ---
    var searchTimer = null;
    searchInput.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        var q = (searchInput.value || "").trim().toLowerCase();
        if (!q) {
          catsContainer.style.display = "";
          searchResults.style.display = "none";
          searchResults.innerHTML = "";
          return;
        }
        catsContainer.style.display = "none";
        searchResults.style.display = "";
        searchResults.innerHTML = "";

        var matches = allMods.filter(function (m) {
          return !m.ui2Only && (m.title || m.id).toLowerCase().indexOf(q) !== -1;
        });

        if (matches.length === 0) {
          var noResult = document.createElement("div");
          noResult.className = "eikon-nav-no-results";
          noResult.textContent = "No modules found";
          searchResults.appendChild(noResult);
        } else {
          matches.forEach(function (m, idx) {
            var btn = E._createNavBtn(m);
            btn.style.animationDelay = (idx * 40) + "ms";
            btn.addEventListener("click", function () {
              searchInput.value = "";
              catsContainer.style.display = "";
              searchResults.style.display = "none";
              searchResults.innerHTML = "";
            });
            searchResults.appendChild(btn);
          });
        }
      }, 150);
    });

    // --- Help & Guides button (last item in nav) ---
    var helpSep = document.createElement("div");
    helpSep.style.cssText = "border-top:1px solid var(--border);margin:6px 0 2px;";
    catsContainer.appendChild(helpSep);

    var helpBtn = document.createElement("button");
    helpBtn.className = "eikon-nav-btn eikon-help-btn";
    helpBtn.title = "Help & Guides";
    helpBtn.innerHTML = '<span class="eikon-nav-ico" style="font-weight:900;font-size:14px">?</span>' +
      '<span class="eikon-nav-label">Help &amp; Guides</span>';
    helpBtn.addEventListener("click", function () { E.showHelpGuide(); });
    catsContainer.appendChild(helpBtn);

    E.highlightNav();
  };

  // The reimagined rail: a few words, the pharmacy's name, your name. Nothing else.
  // Services and Money (2026-11-03): clinical work and the till had been filed under Registers; the legal books stay there.
  // On phones the bottom bar keeps six words; Services, Money and Team are reached from the last tab, labelled More there.
  E.UI2_RAIL = [
    { id: "today", title: "Today" }, { id: "customers", title: "Customers" }, { id: "stock", title: "Stock" }, { id: "registers", title: "Registers" },
    { id: "services", title: "Services" }, { id: "money", title: "Money" }
  ];
  E.UI2_RAIL_FOOT = [{ id: "team", title: "Team" }, { id: "settings", title: "Settings" }];
  E.UI2_DESTINATIONS = ["today", "customers", "stock", "registers", "team", "settings", "services", "money"];
  // Screens inside a tab keep that tab lit in the rail.
  E.UI2_PARENT = { tempreg: "registers", cleanreg: "registers", drreg: "registers", locreg: "registers", certreg: "settings", nexreg: "stock", retreg: "stock", trfreg: "stock", alertreg: "stock", ordreg: "customers", tktreg: "customers", dlvreg: "customers", cdpreg: "registers", cdsreg: "registers", poyreg: "registers", poreg: "money", hndreg: "team", rotreg: "team", shfreg: "team", repreg: "registers", cnreg: "money", lrcreg: "money", odreg: "stock", qtreg: "stock", ssreg: "stock", brdreg: "team", conreg: "team", vaxreg: "services", eodreg: "money", pocreg: "services", scsreg: "stock", audreg: "settings", expreg: "settings", pvreg: "services", scrreg: "services", ocpreg: "services", lblreg: "services", sinreg: "stock", otcreg: "services", eposreg: "money", calreg: "services" };
  // Old registers rebuilt for the new layout: any way of reaching the old id (Today, search, a hub, a link) lands on the new screen.
  E.UI2_NATIVE = { temperature: "tempreg", cleaning: "cleanreg", dailyregister: "drreg", locumregister: "locreg", certificates: "certreg", nearexpiry: "nexreg", returns: "retreg", stocktransfers: "trfreg", alerts: "alertreg", clientorders: "ordreg", tickets: "tktreg", deliveries: "dlvreg", "dda-purchases": "cdpreg", "dda-sales": "cdsreg", "dda-poyc": "poyreg", paidout: "poreg", instructions: "hndreg", repeatprescriptions: "repreg", creditnotes: "cnreg", locumreceipts: "lrcreg", "order-diary": "odreg", quotations: "qtreg", messageboard: "brdreg", contacts: "conreg", vaccines: "vaxreg", endofday: "eodreg", shifts: "shfreg", poct: "pocreg", scarcestock: "scsreg", audit: "audreg", pharmacovigilance: "pvreg", screening: "scrreg", ocps: "ocpreg", labels: "lblreg", "supplier-inventory": "sinreg", otcmindmap: "otcreg", "emergency-pos": "eposreg", pharmacycalc: "calreg", dda_stocktakes: "ddstreg" };
  // The tab a rebuilt screen belongs to, for its "‹ Tab" back button: one place decides, so moving a screen moves its way back too.
  // Whatever UI2_PARENT says wins (a screen that still says "registers" goes back to Registers); an unknown or missing tab goes to Today.
  E.ui2BackTab = function (id) {
    var p = (E.UI2_PARENT || {})[id];
    return p && (E.UI2_DESTINATIONS || []).indexOf(p) >= 0 ? p : "today";
  };
  E.ui2BackHash = function (id) { return "#" + E.ui2BackTab(id); };
  E.ui2BackLabel = function (id) {
    var p = E.ui2BackTab(id), all = (E.UI2_RAIL || []).concat(E.UI2_RAIL_FOOT || []);
    for (var i = 0; i < all.length; i++) if (all[i].id === p) return "‹ " + all[i].title;
    return "‹ " + ((E.modules && E.modules[p] && E.modules[p].title) || "Today");
  };
  E.UI2_MORE = ["team", "services", "money"]; // phones: reached from the last tab ("More")
  E._railBadges = E._railBadges || {};

  // Line icons for the new layout's menu (same set as the Eikon Next design).
  (function () {
    var sv = function (d) { return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">' + d + "</svg>"; };
    E.RAIL_ICONS = {
      today: sv('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M4.6 4.6 6 6M18 18l1.4 1.4M2.5 12h2M19.5 12h2M4.6 19.4 6 18M18 6l1.4-1.4"/>'),
      customers: sv('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c.6-3.6 3.3-5.5 6.5-5.5s5.9 1.9 6.5 5.5M16 4.8a3.3 3.3 0 0 1 0 6.4M18 14.8c2 .6 3.2 2.3 3.5 5.2"/>'),
      bookings: sv('<rect x="3" y="5" width="18" height="16" rx="3"/><path d="M3 10h18M8 3v4M16 3v4M8 14h3"/>'),
      stock: sv('<path d="m12 2.8 8.5 4.6v9.2L12 21.2l-8.5-4.6V7.4z"/><path d="m3.8 7.6 8.2 4.5 8.2-4.5M12 12.1v9"/>'),
      registers: sv('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19M8 7.5h7M8 11h5"/>'),
      team: sv('<circle cx="12" cy="8" r="3.5"/><path d="M5 20c.7-3.6 3.5-5.5 7-5.5s6.3 1.9 7 5.5"/>'),
      services: sv('<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><path d="M12 8v8M8 12h8"/>'),
      money: sv('<rect x="2.5" y="6" width="19" height="12" rx="2.5"/><circle cx="12" cy="12" r="2.6"/><path d="M6 9.5v5M18 9.5v5"/>'),
      settings: sv('<circle cx="12" cy="12" r="3"/><path d="M12 2.8v2.4M12 18.8v2.4M4.9 4.9l1.7 1.7M17.4 17.4l1.7 1.7M2.8 12h2.4M18.8 12h2.4M4.9 19.1l1.7-1.7M17.4 6.6l1.7-1.7"/>'),
      _: sv('<circle cx="12" cy="12" r="8"/>')
    };
  })();

  E.renderNavUi2 = function (nav, modById) {
    var u = E.state.user || {};
    var side = nav.parentNode;
    var header = side ? side.querySelector(".eikon-sidebar-header") : null;
    if (header) {
      header.innerHTML = '<img class="eikon-rail-mark" alt="" src="' + E.uiUrl("./assets/mu-mark.png") + '?v=' + encodeURIComponent(E.VERSION) + '">' +
        '<div class="eikon-rail-brand"><b>Eikon</b><span>' + E.escapeHtml(String(u.location_name || "")) + '</span></div>';
    }
    function btn(item) {
      var m = modById[item.id];
      if (!m) return null;
      var b = document.createElement("button");
      b.className = "eikon-nav-btn eikon-rail-btn";
      b.setAttribute("data-mod", item.id);
      var n = E._railBadges[item.id];
      b.innerHTML = '<span class="eikon-rail-ico">' + (E.RAIL_ICONS[item.id] || E.RAIL_ICONS._) + '</span><span class="eikon-nav-label">' + E.escapeHtml(item.title) + '</span>' +
        (item.id === "settings" ? '<span class="eikon-rail-more">More</span>' : "") +
        '<span class="eikon-rail-badge' + (n ? "" : " empty") + '" data-badge="' + item.id + '">' + (n || "") + '</span>';
      b.addEventListener("click", function () { E._ui2Back = null; window.location.hash = "#" + item.id; });
      return b;
    }
    var top = document.createElement("div"); top.className = "eikon-rail-top";
    E.UI2_RAIL.forEach(function (it) { var b = btn(it); if (b) top.appendChild(b); });
    nav.appendChild(top);
    var foot = document.createElement("div"); foot.className = "eikon-rail-foot";
    E.UI2_RAIL_FOOT.forEach(function (it) { var b = btn(it); if (b) foot.appendChild(b); });
    var who = document.createElement("div"); who.className = "eikon-rail-who";
    var since = E.state.signedInAt || (E.state.signedInAt = new Date());
    var hm = String(since.getHours()).padStart(2, "0") + ":" + String(since.getMinutes()).padStart(2, "0");
    who.innerHTML = '<b>' + E.escapeHtml(String(u.full_name || u.email || "")) + '</b><span>' + E.escapeHtml(u.role === "admin" ? "Pharmacist" : "Staff") + ' · signed in ' + hm + '</span>';
    foot.appendChild(who);
    nav.appendChild(foot);
    // "Skip to content" (WCAG 2.4.1): the first Tab shows it, Enter jumps past the rail to the screen.
    var layout = side && side.parentNode;
    if (layout && !layout.querySelector(".eikon-skip")) {
      var sk = document.createElement("a"); sk.className = "eikon-skip"; sk.href = "#"; sk.textContent = "Skip to content";
      sk.addEventListener("click", function (ev) { ev.preventDefault(); var c = document.getElementById("eikon-content"); if (!c) return; c.setAttribute("tabindex", "-1"); c.focus(); });
      layout.insertBefore(sk, layout.firstChild);
    }
    E.highlightNav();
  };

  // Hand a person from Customers to a register so the name is never typed again.
  // Lives in sessionStorage for five minutes, in this tab only, and is taken once.
  // One wording for a save that failed. A timeout or a dropped connection on a save is uncertain: the server may
  // have stored it before the answer was lost, so the person is told to look before recording it again.
  // A screen that just failed to save keeps what is on it if the re-read that follows fails too (offline): the list and
  // what was typed stay, with the save message under the form. Used once, within 2.5 s, by the next load only.
  E.takeSaveFailed = function () { var t = E._saveFailedAt; E._saveFailedAt = 0; return !!t && Date.now() - t < 2500; };
  E.saveFailText = function (x) {
    E._saveFailedAt = Date.now();
    if (x && x.network) return /timed out/i.test(String(x.message || "")) ? "No answer from the server in time. It may have been saved: check the list before doing it again." : "The connection dropped. Check the list: if it is not there, try again.";
    return "Not saved: " + String((x && (x.message || x)) || "error");
  };
  // POST a new record at most once. When the answer is lost (timeout, dropped connection) the list is read again and
  // a record that arrived counts as saved, so pressing Save again can never add it twice.
  // check = { list: async () => rows of the period the record falls in, same: row => true when it is this record }
  E.postOnce = async function (path, body, check) {
    var count = async function () { return (await check.list()).filter(check.same).length; };
    var had = null; if (check) { try { had = await count(); } catch (e0) { had = null; } }
    try {
      var r = await E.apiFetch(path, { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      return r;
    } catch (x) {
      if (!(x && x.network) || had == null) throw x;
      var now; try { now = await count(); } catch (e1) { throw x; }
      if (now <= had) throw x;
      return { ok: true, recovered: true };
    }
  };
  // Run a redraw only when nobody is typing in a form on this screen. A list that arrives while someone is filling a
  // form used to redraw everything under their fingers, and the next keystrokes could land in another field. The
  // redraw now waits until focus leaves the form (moving between its fields does not count), then catches up.
  E.whenFormIdle = function (mount, fn) {
    var busy = function () { var a = document.activeElement; return !!(mount && a && mount.contains(a) && a.closest && a.closest("form")); };
    if (!busy()) return fn();
    var done = false, run = function () { if (done) return; done = true; mount.removeEventListener("focusout", onOut); clearInterval(t); fn(); };
    var onOut = function () { setTimeout(function () { if (!busy()) run(); }, 0); };
    mount.addEventListener("focusout", onOut);
    var t = setInterval(function () { if (!busy() || !document.body.contains(mount)) run(); }, 2000); // a safety net
  };
  E.carryPerson = function (p) {
    try { sessionStorage.setItem("eikon_carry_person", JSON.stringify({ id: p.id, name: p.name || "", id_card: p.id_card || "", phone: p.phone || "", alt_phone: p.alt_phone || "", email: p.email || "", address: p.address || "", at: Date.now() })); } catch (e) {}
  };
  E.takeCarriedPerson = function () {
    var raw = null;
    try { raw = sessionStorage.getItem("eikon_carry_person"); sessionStorage.removeItem("eikon_carry_person"); } catch (e) {}
    if (!raw) return null;
    try { var p = JSON.parse(raw); if (!p || !p.name || !p.at || (Date.now() - Number(p.at)) > 5 * 60 * 1000) return null; return p; } catch (e2) { return null; }
  };

  // Modules tell the rail how many things wait behind a word. Only the rail changes.
  E.setRailBadge = function (id, n) {
    E._railBadges[id] = n || 0;
    var el = document.querySelector('.eikon-rail-badge[data-badge="' + id + '"]');
    if (el) { el.textContent = n ? String(n) : ""; el.classList.toggle("empty", !n); }
  };

  E.highlightNav = function () {
    var active = E.state.activeModuleId || "";
    var btns = E.qa(".eikon-nav-btn", document);
    btns.forEach(function (b) {
      var id = b.getAttribute("data-mod") || "";
      b.classList.toggle("active", id === active || (E.UI2_PARENT && E.UI2_PARENT[active] === id));
      if (id === "settings" && E.UI2_MORE) b.classList.toggle("more-on", E.UI2_MORE.indexOf((E.UI2_PARENT && E.UI2_PARENT[active]) || active) >= 0);
    });

    // Auto-expand category containing active module
    if (active) {
      var cat = E._categoryForModule(active);
      if (cat && E.state.expandedCategory !== cat) {
        E._expandCategory(cat);
      }
    }
  };

  // ─── Supplier alert polling (sidebar badges + flash) ────────────────────
  E._startSupplierAlertPoll = function () {
    if (E._supplierPollInterval) clearInterval(E._supplierPollInterval);
    function updateNavBadge(modId, count) {
      var btn = document.querySelector('.eikon-nav-btn[data-mod="' + modId + '"]');
      if (!btn) return;
      var badge = btn.querySelector(".eikon-nav-badge");
      if (badge) {
        badge.textContent = count;
        badge.style.display = count > 0 ? "" : "none";
      }
      btn.classList.toggle("nav-flash", count > 0);
    }
    function poll() {
      E._supplierPolledAt = Date.now();
      E.apiFetch("/supplier-orders/feedback", { method: "GET" }).then(function (resp) {
        var entries = resp.entries || [];
        var count = 0;
        for (var i = 0; i < entries.length; i++) { if (!entries[i].resolution_status) count++; }
        E.state._unresolvedFeedbackCount = count;
        updateNavBadge("supplier-order-feedback", count);
      }).catch(function () {});
      E.apiFetch("/supplier-orders/received", { method: "GET" }).then(function (resp) {
        var entries = resp.entries || [];
        var count = 0;
        for (var i = 0; i < entries.length; i++) { if (entries[i].status === "pending") count++; }
        E.state._pendingOrdersCount = count;
        updateNavBadge("supplier-received-orders", count);
      }).catch(function () {});
    }
    poll();
    // Not while the tab is hidden (a supplier's tab can stay open all day); back on the tab, at once if it is due.
    E._supplierPollInterval = setInterval(function () { if (!document.hidden) poll(); }, 30000);
    E._supplierPoll = poll;
    if (!E._supplierVisHook) {
      E._supplierVisHook = true;
      document.addEventListener("visibilitychange", function () {
        if (!document.hidden && E._supplierPollInterval && E._supplierPoll && Date.now() - (E._supplierPolledAt || 0) > 30000) E._supplierPoll();
      });
    }
  };

  E.showChangePassword = function () {
    var body =
      '<form id="eikon-pw-form" autocomplete="on" novalidate>' +
      '<input type="text" name="username" autocomplete="username" value="' + E.escapeHtml((E.state.user && E.state.user.email) || "") + '" style="position:absolute;left:-9999px" tabindex="-1" aria-hidden="true" />' +
      '<div class="eikon-field" style="margin-bottom:10px"><label class="eikon-label" for="eikon-pw-cur">Current password</label><input class="eikon-input" id="eikon-pw-cur" type="password" autocomplete="current-password" style="width:100%"></div>' +
      '<div class="eikon-field" style="margin-bottom:10px"><label class="eikon-label" for="eikon-pw-new">New password (10 characters or more)</label><input class="eikon-input" id="eikon-pw-new" type="password" autocomplete="new-password" style="width:100%"></div>' +
      '<div class="eikon-field"><label class="eikon-label" for="eikon-pw-new2">New password again</label><input class="eikon-input" id="eikon-pw-new2" type="password" autocomplete="new-password" style="width:100%"></div>' +
      '<div class="eikon-help" style="margin-top:10px">Every other signed-in device will be signed out. Save the new password in your password manager when the browser offers.</div>' +
      '<div id="eikon-pw-msg" class="eikon-help" style="margin-top:8px;color:var(--danger)"></div>' +
      '</form>';
    var submitting = false;
    async function submit() {
      if (submitting) return;
      var cur = (document.getElementById("eikon-pw-cur") || {}).value || "";
      var n1 = (document.getElementById("eikon-pw-new") || {}).value || "";
      var n2 = (document.getElementById("eikon-pw-new2") || {}).value || "";
      var msg = document.getElementById("eikon-pw-msg");
      function say(t) { if (msg) msg.textContent = t; }
      if (!cur || !n1) return say("Enter your current password and a new one.");
      if (n1.length < 10) return say("The new password needs at least 10 characters.");
      if (n1 !== n2) return say("The two new passwords do not match.");
      submitting = true; say("");
      try {
        var r = await E.apiFetch("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: n1 }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Could not change the password");
        E.modal.hide();
        E.toast("Password changed. Other devices were signed out.", "success");
        try { var f = document.getElementById("eikon-pw-form"); if (f && typeof f.requestSubmit === "function") { /* lets the browser offer to save */ } } catch (e) {}
      } catch (e) {
        say(String(e && (e.message || e) || "Could not change the password"));
      } finally { submitting = false; }
    }
    E.modal.show("Change password", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Change password", primary: true, onClick: submit }
    ]);
    try {
      var f = document.getElementById("eikon-pw-form");
      if (f) f.addEventListener("submit", function (e) { e.preventDefault(); submit(); });
      var first = document.getElementById("eikon-pw-cur"); if (first) first.focus();
    } catch (e) {}
  };

  E.logout = function () {
    E.dbg("[auth] logout");
    if (E._supplierPollInterval) { clearInterval(E._supplierPollInterval); E._supplierPollInterval = null; }
    // Revoke the session on the server before forgetting the token locally.
    try { if (E.getToken()) { E.apiFetch("/auth/logout", { method: "POST" }).catch(function () {}); } } catch (e) {}
    E.clearToken();
    E.state.user = null;
    E.state.activeModuleId = "";
    E.state.activeRole = "";
    try { window.localStorage.removeItem("eikon_active_role"); } catch (e) {}
    E._activeSidebarCategories = null;
    E._sectionDashboardId = null;
    E.renderLogin();
  };

  E.getHashModuleId = function () {
    var h = String(E.routeHash() || "").replace(/^#/, "").trim();
    var fallback = E._sectionDashboardId || "dashboard";
    if (!h) return fallback;
    return h;
  };

  E.renderActiveModule = async function () {
    var content = document.getElementById("eikon-content");
    if (!content) throw new Error("Missing #eikon-content mount");

    var fallbackDash = E._sectionDashboardId || "dashboard";
    var id = E.getHashModuleId();
    // New layout loads most modules after the first screen: wait for them before calling an id unknown.
    if (!E.modules[id] && window.EIKON_LATE) { await window.EIKON_LATE; id = E.getHashModuleId(); }
    if (!E.modules[id]) {
      E.warn("[router] unknown module:", id, "falling back to", fallbackDash);
      id = fallbackDash;
      E.setRoute(fallbackDash);
    }

    if (E.isUi2() && E._sectionDashboardId === "today" && E.UI2_NATIVE[id] && E.modules[E.UI2_NATIVE[id]]) {
      window.location.replace("#" + E.UI2_NATIVE[id]); return; // the hashchange renders the new screen
    }
    // The new shell shows only rebuilt screens: anything else opens in the classic layout.
    if (E.isUi2() && E._sectionDashboardId === "today" && E.UI2_DESTINATIONS.indexOf(id) < 0) {
      E.openClassic(id);
      return;
    }

    // Let the module we are leaving stop its timers and listeners.
    var leaving = E.state.activeModuleId;
    if (leaving && leaving !== id && E.modules[leaving] && typeof E.modules[leaving].destroy === "function") {
      try { E.modules[leaving].destroy(); } catch (eD) { E.warn("[router] destroy failed for", leaving, eD); }
    }
    E.state.activeModuleId = id;
    E._lastRenderedHash = E.routeHash();
    E.highlightNav();


    // module title text (do NOT overwrite the topbar logo)
    var titleText = document.getElementById("eikon-page-title-text");
    if (titleText) titleText.textContent = (E.modules[id].title || id);
    else {
      var pageTitle = document.getElementById("eikon-page-title");
      if (pageTitle) pageTitle.textContent = (E.modules[id].title || id);
    }

    // user label
    var userLabel = document.getElementById("eikon-user-label");
    if (userLabel) {
      var u = E.state.user;
      userLabel.textContent = u ? (u.full_name + " • " + u.location_name) : "";
    }

    // render module
    content.innerHTML = "";
    E.dbg("[router] render module:", id);

    try {
      await E.modules[id].render({ E: E, mount: content, user: E.state.user });
    } catch (err) {
      E.error("[router] module render error:", err);
      var msg = String(err && (err.stack || err.message || err));
      content.innerHTML =
        '<div class="eikon-card">' +
        '  <div style="font-weight:900;margin-bottom:8px;">Module crashed</div>' +
        '  <pre style="white-space:pre-wrap;word-break:break-word;margin:0;background:rgba(0,0,0,.25);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.4;">' +
        E.escapeHtml(msg) +
        "</pre>" +
        "</div>";
    }
  };

  E.bootAuthed = async function () {
    E._sessionExpiredShown = false;
    var back = String(E._returnHash || "").replace(/^#/, "");
    E._returnHash = "";
    // A link that names a screen (#temperature, or the classic hand-off from the new shell)
    // opens that screen; otherwise the home screen of this layout.
    var asked = String(E.routeHash() || "").replace(/^#/, "").trim();
    var home = E._sectionDashboardId || "dashboard";
    // The screen asked for may still be loading in the background (new layout): wait rather than drop the link.
    if (window.EIKON_LATE && ((asked && !E.modules[asked]) || (back && !E.modules[back]))) await window.EIKON_LATE;
    var target = (back && E.modules[back]) ? back : (asked && E.modules[asked] && asked !== "today" && asked !== "dashboard" ? asked : home);
    if (asked === "today" || asked === "dashboard") target = (back && E.modules[back]) ? back : home;
    E.setRoute(target);
    E.renderShell();

    // Render module, then mark "screen done" so overlay can hide after introMs
    try {
      await E.renderActiveModule();
    } finally {
      E.markIntroScreenDone();
    }
  };

  E.start = async function () {
    if (E.state.started) return;
    E.state.started = true;
    E.dbg("[core] start()");

    // Ensure intro exists (safe / idempotent)
    try { E.showIntroOverlayOnce(); } catch (e) {}

    // If hash missing, default (will be updated when role is selected)
    // (Clean addresses: the bare address stays bare until a screen opens.)
    if (!E.routeHash() && !E.CLEAN_URLS) E.setRoute("dashboard");

    // Router
    window.addEventListener("hashchange", function () {
      E.dbg("[router] hashchange:", E.routeHash());
      if (!E.state.user) return;
      // Still building the shell (sign-in answered faster than this event fired): the boot renders the screen itself.
      if (!document.getElementById("eikon-content")) return;
      // The boot sets the hash itself and renders; do not render the same screen twice.
      if (E._lastRenderedHash === E.routeHash() && E.state.activeModuleId === E.getHashModuleId()) return;
      E.renderActiveModule();
    });

    // Try authed boot
    try { if (E._resolveModulesReady) E._resolveModulesReady(); } catch (e) {}
    // Someone signed in on the early form while modules were loading: that flow draws the app.
    if (E._loginInFlight || (E._earlyLoginShown && E.state.user)) return;
    var token = E.getToken();
    if (!token) {
      E.dbg("[auth] no token -> login screen");
      // Already on screen (shown early while modules loaded): do not redraw over what was typed.
      if (!E._earlyLoginShown) E.renderLogin();
      return;
    }

    E.dbg("[auth] token present, checking /auth/me …");
    // New layout opening on Today: ask for Today's data alongside /auth/me instead of after it (one round trip saved).
    // index.html may already have asked (EIKON_EARLY, started before the scripts loaded): used once, and only for the same token.
    var early = window.EIKON_EARLY; window.EIKON_EARLY = null;
    if (!(early && early.token === token && Date.now() - early.at < 20000)) early = null;
    try {
      var h0 = String(E.routeHash() || "").replace(/^#/, "");
      if (E.isUi2() && (h0 === "" || h0 === "today" || h0 === "dashboard") && window.localStorage.getItem("eikon_active_role") === E.ROLE_PHARMACY) {
        var askToday = function () { return E.apiFetch("/today", { method: "GET", timeoutMs: 12000 }).catch(function () { return null; }); };
        E._todayPrefetch = { at: Date.now(), p: early ? early.today.then(function (r) { return r && r.ok ? r : askToday(); }) : askToday() };
      }
    } catch (eP) {}
    try {
      var me = early ? await early.me : null;
      if (!me || !me.ok || !me.user) me = await E.apiFetch("/auth/me", { method: "GET" });
      if (!me || !me.ok || !me.user) throw new Error("Invalid /auth/me response");
      E.state.user = me.user;
      E.dbg("[auth] /auth/me OK:", me.user);

      // Check for saved role
      var savedRole = "";
      try { savedRole = window.localStorage.getItem("eikon_active_role") || ""; } catch (e) {}
      var roles = E.getRolesForUser(me.user);
      E.dbg("[auth] saved role:", savedRole, "available roles:", roles);

      if (savedRole && roles.indexOf(savedRole) !== -1) {
        // Restore saved role directly
        await E.bootForRole(savedRole);
      } else {
        // Show role selection
        E.renderRoleSelection(roles);
      }
    } catch (err) {
      E.error("[auth] /auth/me failed:", err);
      E.clearToken();
      E.state.user = null;
      E.renderLogin("Session invalid. Please login again.\n" + String(err && (err.message || err.bodyText || err)));
    }
  };

  // Show sign-in as soon as the core is here (about 0.3 s) instead of after all 59 scripts;
  // modules keep loading while the person types. Only when there is no saved session.
  function afterCss(fn) { var c = window.EIKON_CSS_READY; if (c && c.then) c.then(fn, fn); else setTimeout(fn, 0); }
  afterCss(function () {
    try {
      if (E.state.started || E.getToken() || !document.getElementById("eikon-root")) return;
      // Same default start() would set, but now, before anyone is signed in (setting it after
      // sign-in would fire the router while the portal picker is on screen).
      if (!E.routeHash() && !E.CLEAN_URLS) E.setRoute("dashboard");
      E._earlyLoginShown = true;
      E.renderLogin();
    } catch (e) { E._earlyLoginShown = false; }
  });
})();
