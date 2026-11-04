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

  // ---- Third-party libraries: pinned copies in ui/vendor/ (versions, sources, sha256: ui/vendor/VERSIONS.txt) ----
  // Nothing is loaded from a CDN. Each library loads once, only when a screen asks for it, with the same build stamp
  // as the app's own files (index.html loads core.js as core.js?v=BUILD; the stamp is read from that address).
  E.BUILD = (function () { try { var m = /[?&]v=([^&#]+)/.exec((document.currentScript && document.currentScript.src) || ""); return m ? decodeURIComponent(m[1]) : ""; } catch (e) { return ""; } })();
  // rel is a path inside ui/vendor/. Absolute (a popup window or a Web Worker has no base of its own), from /ui/
  // with clean addresses too. stamp === false leaves the ?v= off (for a library that adds its own file names).
  E.vendorUrl = function (rel, stamp) {
    var u = E.uiUrl("vendor/" + String(rel));
    try { u = new URL(u, document.baseURI).href; } catch (e) {}
    return (E.BUILD && stamp !== false) ? u + "?v=" + encodeURIComponent(E.BUILD) : u;
  };
  var VENDOR = {
    xlsx: { js: ["xlsx-0.20.3/xlsx.full.min.js"], ready: function () { return window.XLSX; } },
    bwipjs: { js: ["bwip-js-4.11.4/bwip-js-min.js"], ready: function () { return window.bwipjs; } },
    zxing: { js: ["zxing-library-0.19.2/index.min.js"], ready: function () { return window.ZXing; } },
    tesseract: { js: ["tesseract.js-5.1.1/tesseract.min.js"], ready: function () { return window.Tesseract; } },
    html2canvas: { js: ["html2canvas-1.4.1/html2canvas.min.js"], ready: function () { return window.html2canvas; } },
    leaflet: { css: ["leaflet-1.9.4/leaflet.css"], js: ["leaflet-1.9.4/leaflet.js"], ready: function () { return window.L && window.L.map && window.L; } },
    qrcode: { js: ["qrcode-generator-1.4.4.js"], ready: function () { return window.qrcode; } }
  };
  E.VENDOR_FILES = VENDOR;
  var vendorLoads = {};
  // E.loadVendor("xlsx").then(function (XLSX) { ... }): resolves once the library is on window. A failed load is
  // forgotten, so the next ask tries again.
  E.loadVendor = function (name) {
    var v = VENDOR[name];
    if (!v) return Promise.reject(new Error("Unknown library: " + name));
    (v.css || []).forEach(function (c, i) {
      var id = "eikon-vendor-css-" + name + "-" + i;
      if (document.getElementById(id)) return;
      var l = document.createElement("link"); l.id = id; l.rel = "stylesheet"; l.href = E.vendorUrl(c); document.head.appendChild(l);
    });
    if (v.ready()) return Promise.resolve(v.ready());
    if (vendorLoads[name]) return vendorLoads[name];
    var p = (v.js || []).reduce(function (chain, js) {
      return chain.then(function () {
        return new Promise(function (ok, no) {
          var s = document.createElement("script"); s.src = E.vendorUrl(js);
          s.onload = function () { ok(); };
          s.onerror = function () { try { s.parentNode.removeChild(s); } catch (e) {} no(new Error("Could not load " + name + ". Check the connection and try again.")); };
          document.head.appendChild(s);
        });
      });
    }, Promise.resolve()).then(function () {
      if (!v.ready()) throw new Error("Could not start " + name + ". Reload the page and try again.");
      return v.ready();
    });
    vendorLoads[name] = p;
    p.catch(function () { delete vendorLoads[name]; });
    return p;
  };
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
      if (v !== "classic") window.sessionStorage.removeItem("eikon_ui2_pause"); // the visit is over: Back from it, a reload or a link without ?ui=classic is the new layout again
    } catch (e) {}
    // Back/Forward can bring a page back from the browser's memory without loading it: the visit belongs to its address.
    try {
      window.addEventListener("pageshow", function (ev) {
        if (!ev || !ev.persisted) return;
        try { if (new URL(window.location.href).searchParams.get("ui") === "classic") window.sessionStorage.setItem("eikon_ui2_pause", "1"); else window.sessionStorage.removeItem("eikon_ui2_pause"); } catch (e) {}
      });
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
  // Malta time for anything shown as a clock or a calendar day: the server's day and the header are Malta time,
  // so "Updated 14:22" and "signed in" must be too, whatever zone the device's clock is set to.
  var __mtFmt = null;
  function maltaParts(d) {
    d = d instanceof Date ? d : (d == null ? new Date() : new Date(d));
    if (!isFinite(d.getTime())) return null;
    try {
      if (!__mtFmt) __mtFmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Malta", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
      var o = {}; __mtFmt.formatToParts(d).forEach(function (p) { o[p.type] = p.value; });
      return { y: o.year, mo: o.month, d: o.day, h: o.hour === "24" ? "00" : o.hour, mi: o.minute };
    } catch (e) { // no time-zone data: the device clock is the best there is
      var pad = function (n) { return String(n).padStart(2, "0"); };
      return { y: String(d.getFullYear()), mo: pad(d.getMonth() + 1), d: pad(d.getDate()), h: pad(d.getHours()), mi: pad(d.getMinutes()) };
    }
  }
  E.maltaHm = function (d) { var p = maltaParts(d); return p ? p.h + ":" + p.mi : ""; };
  E.maltaYmd = function (d) { var p = maltaParts(d); return p ? p.y + "-" + p.mo + "-" + p.d : ""; };
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
        if (E.reportError) E.reportError("error", ev && (ev.message || ev.error), ev && ev.error); // backlog 7
        E._errReportBusy = true; // the overlay below must not report the same error again
        E.showFatalOverlay("Uncaught error", ev && (ev.message || (ev.error && ev.error.stack) || String(ev)));
        E._errReportBusy = false;
      } catch (e) {}
    });
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        E.error("[GLOBAL] unhandledrejection:", ev && ev.reason);
        if (ev && ev.reason && ev.reason.stack) E.error("[GLOBAL] stack:", ev.reason.stack);
        if (E.reportError) E.reportError("rejection", ev && ev.reason && (ev.reason.message || ev.reason), ev && ev.reason); // backlog 7
        E._errReportBusy = true;
        E.showFatalOverlay("Unhandled promise rejection", ev && (ev.reason && (ev.reason.stack || ev.reason.message)) || String(ev));
        E._errReportBusy = false;
      } catch (e) {}
    });
    E.dbg("[GLOBAL] crash logging installed");
  })();

  // ---- Error reports (backlog 7): uncaught errors, unhandled rejections, the fatal overlay and a screen that
  // crashes while drawing are sent to POST /client-log, so a fault in a pharmacy reaches us. Only when signed in;
  // at most 5 per page load, each message once; fire-and-forget (keepalive), never retried. Sent: build, screen id
  // (E.state.activeModuleId), kind, the error's message and stack, scrubbed below (the server scrubs again).
  // Never sent: form values, the address (the bar is bare "/" anyway; queries and #fragments are cut), names typed.
  (function installErrorReports() {
    var MAX_PER_LOAD = 5, sent = 0, seen = {}, cspSent = 0; // csp: its own 5, so it never takes a real error's place
    var build = "";
    try { var cs = document.currentScript && document.currentScript.src || ""; var mv = /[?&]v=([A-Za-z0-9._-]{1,40})/.exec(cs); if (mv) build = mv[1]; } catch (e) {}
    E._scrubReport = function (v, max) {
      var s = String(v == null ? "" : v).slice(0, 8000);
      s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ");
      s = s.replace(/[?#][^\s"'<>()]*?(?=(?::\d+:\d+)?(?:[\s"'<>()]|$))/g, "");
      s = s.replace(/\bBearer\s+[^\s"']+/gi, "Bearer [token]");
      s = s.replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]");
      s = s.replace(/\b[A-Za-z0-9_\-+\/=]{32,}\b/g, function (m) { return (/\d/.test(m) && /[A-Za-z]/.test(m)) ? "[token]" : m; });
      s = s.replace(/\b\d{1,7}\s?[A-Za-z]\b/g, "[id]");
      s = s.replace(/(?:\+|\b00)?\d(?:[ \-]?\d){6,14}\b/g, function (m) { return (/^\d{4}-\d\d-\d\d/.test(m) || m.replace(/\D/g, "").length < 8) ? m : "[phone]"; });
      return s.slice(0, max);
    };
    E.reportError = function (kind, message, err) {
      try {
        if (kind === "csp" ? cspSent >= MAX_PER_LOAD : sent >= MAX_PER_LOAD) return false;
        var token = E.getToken ? E.getToken() : "";
        if (!token || !E.state || !E.state.user) return false; // signed in only (never from a portal's sign-in screen)
        if (!/^https?:$/.test(String(window.location.protocol || ""))) return false;
        if (err && (err.network || err.status === 401)) return false; // offline / session ended: not a fault, and the POST would fail too
        var msg = String((message && message.message) || message || (err && err.message) || "").split("\n")[0];
        if (!msg || /ResizeObserver loop/.test(msg)) return false;
        var body = {
          build: build, kind: kind, screen: /^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(String(E.state.activeModuleId || "")) ? E.state.activeModuleId : "",
          message: E._scrubReport(msg, 300), stack: E._scrubReport(err && err.stack || "", 2000)
        };
        var key = body.kind + "|" + body.screen + "|" + body.message;
        if (seen[key]) return false;
        seen[key] = 1; if (kind === "csp") cspSent++; else sent++;
        fetch((E.apiBase || "") + "/client-log", { method: "POST", keepalive: true, headers: { "Content-Type": "application/json", "Authorization": "Bearer " + token }, body: JSON.stringify(body) })
          .catch(function () {});
        return true;
      } catch (e) { return false; }
    };

    // Content-Security-Policy-Report-Only (backlog 2-9, set by the worker on the app page): what the policy WOULD block
    // is sent as kind "csp", so it can be enforced only once nothing legitimate trips it. Sent: the directive, the
    // blocked thing's origin (never its path or query) and the file:line that asked. Before sign-in they wait (up to 5).
    // A frame: the frames above this page (location.ancestorOrigins, Chrome/Edge/Safari) that frame-ancestors would refuse.
    // Keep FRAME_OK in step with APP_FRAME_ANCESTORS in the worker (tests/worker/headers.test.mjs checks it).
    var FRAME_OK = /^https:\/\/((www\.)?eikonhq\.com|eikon-api\.labrint\.workers\.dev|swiftdataautomation\.com|[a-z0-9-]+\.swiftdataautomation\.com)$/i;
    var cspWaiting = [], framesDone = false;
    function cspWhere(u) {
      u = String(u || "");
      if (!u || /^(inline|eval|wasm-eval|trusted-types-[a-z-]+|data|blob)$/i.test(u)) return u || "inline";
      try { var x = new URL(u, location.href); return /^https?:$/.test(x.protocol) ? (x.origin === location.origin ? "self" : x.origin) : x.protocol.replace(/:$/, ""); }
      catch (e) { return u.split(/[?#]/)[0].slice(0, 60); }
    }
    function cspFlush() {
      try {
        if (!E.state || !E.state.user) return;
        if (!framesDone) {
          framesDone = true;
          var anc = [];
          try { if (window.top !== window && location.ancestorOrigins) for (var i = 0; i < location.ancestorOrigins.length; i++) anc.push(String(location.ancestorOrigins[i])); } catch (eA) {}
          anc.forEach(function (o) { if (o !== location.origin && !FRAME_OK.test(o)) cspWaiting.push("CSP frame-ancestors would block " + (/^https?:\/\//.test(o) ? o : "an opaque frame (" + o + ")")); });
        }
        while (cspWaiting.length) E.reportError("csp", cspWaiting.shift(), null);
      } catch (e) {}
    }
    E._cspFlush = cspFlush;
    try {
      window.addEventListener("securitypolicyviolation", function (ev) {
        try {
          var dir = String(ev.effectiveDirective || ev.violatedDirective || "").split(" ")[0];
          var file = ev.sourceFile ? String(ev.sourceFile).split(/[?#]/)[0] : "";
          if (file.indexOf(location.origin) === 0) file = file.slice(location.origin.length);
          var msg = "CSP " + dir + " would block " + cspWhere(ev.blockedURI) + (file ? " (" + file.replace(/^.*\/(?=[^\/]+$)/, "") + ":" + (ev.lineNumber || 0) + ")" : "");
          if (cspWaiting.length < MAX_PER_LOAD && cspWaiting.indexOf(msg) < 0) cspWaiting.push(msg);
          cspFlush();
        } catch (e) {}
      });
      window.addEventListener("eikon:modules", cspFlush);
      window.addEventListener("hashchange", cspFlush);
      window.addEventListener("popstate", cspFlush);
      setTimeout(cspFlush, 15000); setTimeout(cspFlush, 60000);
    } catch (e) {}
  })();

  // DOM helpers
  E.q = function (sel, root) { return (root || document).querySelector(sel); };
  E.qa = function (sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); };

  E.escapeHtml = function (s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  };

  // ---- Print tabs under a strict Content-Security-Policy (script-src 'self': no inline <script>, no on*=) ----
  // A tab opened from here (window.open("") + document.write, or a blob: url) inherits this page's policy,
  // so the printed HTML carries no code: this page drives the tab instead.
  //   E.printTab(w, opts)    drive a tab this page opened and wrote (or that is loading opts.url).
  //     opts.url         the blob: url w is navigating to: wait until that is the loaded document
  //     opts.autoPrint   default true: print once the document has loaded, opts.delay ms later (default 80)
  //     opts.focus       focus the tab just before printing
  //     opts.closeAfter  close the tab after printing (afterprint), opts.closeDelay ms later (default 250)
  //     opts.onReady(w, doc)  runs here before printing (barcodes, page size); may return a Promise
  //     Buttons in the printed HTML: data-eikon-print="print" prints, data-eikon-print="close" closes the tab.
  //   E.openPrint(html, opts)   window.open("", "_blank", opts.features), write html, then printTab.
  //   E.openPrintUrl(url, opts) open url (a blob: of the page) in a new tab, cut its opener link, then printTab.
  //   Both return the tab, or null when the browser blocked it (the caller keeps its own fallback).
  // Handlers are the print tab's own built-ins (w.print / w.close), so its buttons keep working after
  // this page reloads or closes.
  E.printTab = function (w, opts) {
    opts = opts || {};
    if (!w) return null;
    var start = Date.now(), done = false;
    function own(name) {
      try { return w.Function.prototype.bind.call(w[name], w); }
      catch (e) { return function () { try { w[name](); } catch (e2) {} }; }
    }
    function isClosed() { try { return !!w.closed; } catch (e) { return true; } }
    function atUrl() { try { return !opts.url || String(w.location.href) === String(opts.url); } catch (e) { return false; } }
    function complete() { try { return w.document.readyState === "complete"; } catch (e) { return false; } }
    function go() {
      if (done) return; done = true;
      var doc; try { doc = w.document; } catch (e) { return; }
      try {
        var els = doc.querySelectorAll("[data-eikon-print]");
        for (var i = 0; i < els.length; i++) {
          var act = els[i].getAttribute("data-eikon-print");
          if (act === "print" || act === "close") els[i].addEventListener("click", own(act));
        }
      } catch (e) {}
      if (opts.closeAfter) {
        var closeTab = own("close");
        try { w.addEventListener("afterprint", function () { setTimeout(closeTab, opts.closeDelay == null ? 250 : opts.closeDelay); }); } catch (e) {}
      }
      var ready = null;
      if (typeof opts.onReady === "function") { try { ready = opts.onReady(w, doc); } catch (e) { try { console.warn("[EIKON][print] onReady failed", e); } catch (e2) {} } }
      if (opts.autoPrint === false) return;
      function printNow() {
        if (isClosed()) return;
        if (opts.focus) { try { w.focus(); } catch (e) {} }
        try { w.print(); } catch (e) {}
      }
      function later() { setTimeout(printNow, opts.delay == null ? 80 : opts.delay); }
      if (ready && typeof ready.then === "function") ready.then(later, later); else later();
    }
    (function poll() {
      if (done || isClosed()) return;
      var here = atUrl();
      if (here && complete()) return go();
      // A page that never finishes loading (a stuck image) still prints after 15 s, as the old timers did.
      if (here && Date.now() - start > 15000) return go();
      if (Date.now() - start > 60000) return;
      setTimeout(poll, 25);
    })();
    return w;
  };
  E.openPrint = function (html, opts) {
    opts = opts || {};
    var w = null;
    try { w = window.open("", "_blank", opts.features || ""); } catch (e) { w = null; }
    if (!w) return null;
    try { w.document.open(); w.document.write(String(html == null ? "" : html)); w.document.close(); } catch (e) {}
    return E.printTab(w, opts);
  };
  E.openPrintUrl = function (url, opts) {
    var o = {}, k; opts = opts || {};
    for (k in opts) if (Object.prototype.hasOwnProperty.call(opts, k)) o[k] = opts[k];
    o.url = url;
    var w = null;
    try { w = window.open(url, "_blank", o.features || ""); } catch (e) { w = null; }
    if (!w) return null;
    try { w.opener = null; } catch (e) {}
    return E.printTab(w, o);
  };
  // 75 mm receipt printouts (vaccines): set the @page height in <style id="pageSizeStyle"> to the length of
  // #content, as the receipt's own script did at load, 80 ms and 220 ms later. Call it from onReady.
  E.fitReceiptPage = function (doc) {
    function fit() {
      try {
        var c = doc.getElementById("content");
        if (!c) return;
        var h = Math.max(c.scrollHeight || 0, c.getBoundingClientRect().height || 0);
        var mm = Math.ceil(h * 25.4 / 96 + 2);
        if (mm < 60) mm = 60;
        if (mm > 1200) mm = 1200;
        var st = doc.getElementById("pageSizeStyle");
        if (st) st.textContent = "@page{size:75mm " + mm + "mm;margin:0}";
      } catch (e) {}
    }
    fit(); setTimeout(fit, 80); setTimeout(fit, 220);
  };
  // For the screens that opened their blob tab with a link click (kept for pages framed by another site, where
  // window.open can return null although the tab opened, and a second try would open it twice): a framed
  // page still uses the link, and that tab is not driven (no auto-print); a top-level page uses openPrintUrl.
  E.openPrintUrlOrLink = function (url, opts) {
    var framed = true;
    try { framed = window.top !== window.self; } catch (e) { framed = true; }
    var w = framed ? null : E.openPrintUrl(url, opts);
    if (w) return w;
    try {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e1) {
      try { window.open(url, "_blank"); } catch (e2) {}
    }
    return null;
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

    // 401 with a token: the session ended. 401 with NO token while this page is signed in: the token was removed by
    // another tab or window of this address (signed out there, or a failed start there). Both go to sign-in, never to
    // a screen that quietly stops updating.
    if (res.status === 401 && path !== "/auth/login" && path !== "/auth/logout") {
      if (token) E.handleSessionExpired();
      else if (E.state && E.state.user) E.handleSessionExpired("You were signed out in another tab or window. Sign in again to continue where you were.");
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
  E.handleSessionExpired = function (message) {
    if (E._sessionExpiredShown) return;
    E._sessionExpiredShown = true;
    try { E._returnHash = String(E.routeHash() || ""); } catch (e) {}
    if (E._supplierPollInterval) { try { clearInterval(E._supplierPollInterval); } catch (e) {} E._supplierPollInterval = null; }
    E.clearToken();
    E.state.user = null;
    try { E.renderLogin(message || "Your session has ended. Sign in again to continue where you were."); } catch (e) {}
  };
  // Signed out in another tab or window of this address (the token is shared by all of them): show sign-in here at
  // once, instead of a screen whose every refresh is refused.
  try {
    window.addEventListener("storage", function (ev) {
      if (ev.key !== null && ev.key !== E.TOKEN_KEY) return;
      if (E.getToken() || !E.state || !E.state.user) return;
      E.handleSessionExpired("You were signed out in another tab or window. Sign in again to continue where you were.");
    });
  } catch (e) {}

  // Module registry
  E.modules = E.modules || {};
  // Resolved by start() (main.js loads last, after every module). Sign-in can show before this.
  E.modulesReady = E.modulesReady || new Promise(function (r) { E._resolveModulesReady = r; });

  E.registerModule = function (mod) {
    if (!mod || !mod.id) throw new Error("Invalid module registration (missing id)");
    E.modules[mod.id] = mod;
    E.dbg("[core] module registered:", mod.id);
  };
  // The new layout does not download the classic screens (index.html, registry.js). This fetches them when this
  // page needs one after all; with every file already loaded (the classic layout) it is done at once.
  E.loadClassic = function () {
    return window.EIKON_LOAD_CLASSIC ? window.EIKON_LOAD_CLASSIC() : Promise.resolve();
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

  // Fatal overlay (never silent black screen). It blocks only while Eikon is starting (E._booted is set when
  // E.start has finished): "Eikon could not start" with Try again. Once the app is up, an unexpected error never
  // blocks it: E.showErrorBar says so in a closable bar and leaves the screen, and what is typed in it, as it is.
  // dbg=2 (developers) keeps the full-screen notice with the error and its stack at any time. Reported once either way.
  E.showFatalOverlay = function (title, details) {
    try { if (!E._errReportBusy && E.reportError) E.reportError("fatal", String(details || title || "").split("\n")[0] || String(title || ""), { stack: String(details || "") }); } catch (eR) {} // backlog 7
    var dev = Number(E.DEBUG) >= 2;
    if (E._booted && !dev) { try { E.showErrorBar(String(details || title || "").split("\n")[0]); } catch (eB) {} return; }
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
      if (dev) {
        overlay.removeAttribute("role"); overlay.removeAttribute("aria-modal"); overlay.removeAttribute("aria-labelledby");
        overlay.innerHTML =
          '<div style="max-width:980px;width:100%;background:rgba(15,22,34,.96);color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:16px;padding:14px;">' +
          '<div style="font-weight:900;font-size:16px;margin-bottom:8px;">' + E.escapeHtml(title || "Eikon crashed") + "</div>" +
          '<div style="color:rgba(255,255,255,.75);font-size:12px;margin-bottom:10px;">Open DevTools Console for details. dbg=2 is recommended.</div>' +
          '<pre style="white-space:pre-wrap;word-break:break-word;margin:0;background:rgba(0,0,0,.3);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.10);font-size:12px;line-height:1.4;max-height:60vh;overflow:auto;">' +
          E.escapeHtml(String(details || "")) +
          "</pre>" +
          "</div>";
        return;
      }
      var first = !overlay.querySelector("#eikon-fatal-retry");
      overlay.setAttribute("role", "alertdialog"); overlay.setAttribute("aria-modal", "true"); overlay.setAttribute("aria-labelledby", "eikon-fatal-title");
      overlay.innerHTML =
        '<div style="max-width:420px;width:100%;box-sizing:border-box;background:#fff;color:#1c1c1e;border-radius:16px;padding:24px;font:16px/1.45 -apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Arial,sans-serif;box-shadow:0 20px 60px rgba(0,0,0,.4)">' +
        '<h1 id="eikon-fatal-title" style="font-size:20px;font-weight:700;margin:0 0 8px">Eikon could not start</h1>' +
        '<p style="margin:0 0 18px;color:#3a3a3c">Check the internet connection, then try again.</p>' +
        '<button type="button" id="eikon-fatal-retry" style="min-height:44px;padding:0 20px;border:0;border-radius:10px;background:#0a7a5a;color:#fff;font-family:inherit;font-size:16px;font-weight:600;line-height:1;cursor:pointer">Try again</button>' +
        '<details style="margin-top:18px;color:#3a3a3c;font-size:13px"><summary style="cursor:pointer">Details for support</summary>' +
        '<pre style="white-space:pre-wrap;word-break:break-word;margin:8px 0 0;background:#f2f2f7;color:#1c1c1e;padding:10px;border-radius:10px;font-size:12px;line-height:1.4;max-height:30vh;overflow:auto">' +
        E.escapeHtml(String(details || title || "")) + "</pre></details></div>";
      var rb = overlay.querySelector("#eikon-fatal-retry");
      rb.addEventListener("click", function () { rb.disabled = true; rb.textContent = "Trying…"; try { window.location.reload(); } catch (e) {} });
      if (first) { try { rb.focus(); } catch (eF) {} } // it covers everything: the one thing to do has the focus
    } catch (e) {}
  };

  // After boot: an unexpected error is said in a calm bar at the foot of the screen (role=alert, so it is read out;
  // it never takes the focus). The screen stays as it is, with what was typed in it. "Reload this screen" loads the
  // page again; Close (or Escape inside the bar) puts it away, and the same error does not bring it back this visit.
  (function () {
    var closed = {};
    function css() {
      if (document.getElementById("eikon-errbar-style")) return;
      var st = document.createElement("style"); st.id = "eikon-errbar-style";
      st.textContent =
        ".eikon-errbar{position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom,0px));z-index:2147483000;" +
        "display:flex;align-items:center;flex-wrap:wrap;gap:8px 12px;box-sizing:border-box;width:max-content;max-width:min(640px,calc(100vw - 32px));" +
        "padding:10px 10px 10px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.22);background:#1c1c1e;color:#fff;font:15px/1.4 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;" +
        "box-shadow:0 10px 30px rgba(0,0,0,.35)}" +
        ".eikon-errbar-t{flex:1 1 220px;min-width:0}" +
        ".eikon-errbar-b{display:flex;gap:8px;flex:none}" +
        ".eikon-errbar button{min-height:44px;padding:0 14px;border-radius:10px;font-family:inherit;font-size:15px;font-weight:600;line-height:1;cursor:pointer;border:1px solid rgba(255,255,255,.55);background:transparent;color:#fff}" +
        ".eikon-errbar button.p{background:#fff;color:#1c1c1e;border-color:#fff}" +
        ".eikon-errbar button:focus-visible{outline:3px solid #7cc4ff;outline-offset:2px}" +
        "@media (max-width:760px){.eikon-errbar{left:16px;right:16px;transform:none;width:auto;max-width:none}" +
        "html[data-ui2] .eikon-errbar{bottom:calc(92px + env(safe-area-inset-bottom,0px))}}";
      document.head.appendChild(st);
    }
    E.showErrorBar = function (key) {
      key = String(key || "");
      if (closed[key] || document.getElementById("eikon-error-bar") || !document.body) return;
      css();
      var bar = document.createElement("div");
      bar.id = "eikon-error-bar"; bar.className = "eikon-errbar"; bar.setAttribute("role", "alert");
      bar.innerHTML = '<span class="eikon-errbar-t">Something went wrong on this screen. What you typed is kept.</span>' +
        '<span class="eikon-errbar-b"><button type="button" class="p" data-act="reload">Reload this screen</button><button type="button" data-act="close">Close</button></span>';
      var back = null; // where the keyboard was before it came into the bar: Close puts it back there
      document.addEventListener("focusin", function track(ev) { if (!bar.isConnected) { document.removeEventListener("focusin", track); return; } if (!bar.contains(ev.target)) back = ev.target; });
      var close = function () {
        closed[key] = 1;
        var had = bar.contains(document.activeElement);
        try { bar.remove(); } catch (e) {}
        if (had) { var to = back && back.isConnected ? back : document.querySelector("#eikon-content h1, main h1"); if (to) { try { if (to.tagName === "H1" && !to.hasAttribute("tabindex")) to.setAttribute("tabindex", "-1"); to.focus({ preventScroll: true }); } catch (e) {} } }
      };
      bar.addEventListener("click", function (ev) {
        var b = ev.target && ev.target.closest ? ev.target.closest("button[data-act]") : null; if (!b) return;
        if (b.getAttribute("data-act") === "close") close();
        else { b.disabled = true; b.textContent = "Reloading…"; try { window.location.reload(); } catch (e) {} }
      });
      bar.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); } });
      back = document.activeElement && document.activeElement !== document.body ? document.activeElement : null;
      document.body.appendChild(bar);
    };
  })();

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
      var setTok = "";

      E.apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: pass })
      })
        .then(function (resp) {
          if (!resp || !resp.ok || !resp.token) throw new Error("Login failed (no token)");
          setTok = resp.token;
          E.setToken(resp.token);
          E.state.user = resp.user || null;
          E.dbg("[auth] login OK:", resp.user);
          var roles = E.getRolesForUser(resp.user);
          E.dbg("[auth] available roles:", roles);
          try { E.idleLock.afterSignIn(true); } catch (eI) {}
          // A sign-in made or reset by the pharmacy's admin chooses its own password first (never an existing account).
          var gate = (resp.must_change || (resp.user && resp.user.must_change)) ? E.forcePasswordChange(resp.user) : Promise.resolve();
          // The form can appear before every module has loaded; wait for them only if needed.
          return gate.then(function () { return E.modulesReady; }).then(function () { return E.renderRoleSelection(roles); });
        })
        .catch(function (err) {
          E.error("[auth] login error:", err);
          // Only forget a token this sign-in stored: another tab's session must survive a mistyped password here.
          if (setTok && E.getToken() === setTok) E.clearToken();
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
    // Portals are classic screens: a page that opened in the new layout fetches them now (once).
    try { await E.loadClassic(); } catch (eL) { E.warn("[boot] classic screens did not load:", eL); }
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
      '        <button class="eikon-btn primary" id="eikon-newlayout-btn" style="display:none" title="Switch this browser to the new Eikon layout">Use the new layout</button>' +
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

    // Classic chosen for this browser (Settings > Classic layout or ?ui=1): a way back to the new layout. Pharmacy role
    // only (supplier and company-admin portals always use the classic look); not on a one-visit classic screen (that
    // has "‹ New Eikon" above).
    var newBtn = document.getElementById("eikon-newlayout-btn");
    if (newBtn) {
      var chose = false;
      try {
        var role = window.localStorage.getItem("eikon_active_role");
        chose = window.localStorage.getItem("eikon_ui2") === "0" && (!role || role === E.ROLE_PHARMACY) && !E.isUi2Paused();
      } catch (e) {}
      if (chose) {
        newBtn.style.display = "";
        newBtn.addEventListener("click", function () {
          try { window.localStorage.setItem("eikon_ui2", "1"); window.sessionStorage.removeItem("eikon_ui2_pause"); } catch (e) {}
          E.returnToNew("today");
        });
      }
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
          // Opened from the frame on the other site, the full-screen tab stays on the old address (?stay=1: the worker
          // and index.html move other browser tabs to eikonhq.com), so "Exit Fullscreen" keeps working; stay=1 is not
          // handed back to the other site.
          var sp = new URLSearchParams(window.location.search || "");
          if (isFullscreenHost) sp.delete("stay"); else if (!isTop) sp.set("stay", "1");
          var q = sp.toString() ? "?" + sp.toString() : "";
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
    btn.addEventListener("click", function () {
      // On a classic visit (one old screen opened from the new layout), the classic menu's way to a rebuilt screen
      // ends the visit and opens that screen in the new layout. Only the menu: an address that says ?ui=classic
      // (a link, a bookmark, a rebuilt screen's "classic screen" link) always gets the classic screen it names.
      var to = E.isUi2Paused() ? ((E.UI2_NATIVE && E.UI2_NATIVE[m.id]) || ((E.UI2_PARENT && E.UI2_PARENT[m.id]) || (E.UI2_DESTINATIONS || []).indexOf(m.id) >= 0 ? m.id : "")) : "";
      if (to) { try { window.sessionStorage.removeItem("eikon_ui2_pause"); } catch (e) {} E.returnToNew(to); return; }
      window.location.hash = "#" + m.id;
    });
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
  E.UI2_PARENT = { teamreg: "team", tempreg: "registers", cleanreg: "registers", drreg: "registers", locreg: "registers", certreg: "registers", nexreg: "stock", retreg: "stock", trfreg: "stock", alertreg: "stock", ordreg: "customers", tktreg: "customers", dlvreg: "customers", cdpreg: "registers", cdsreg: "registers", poyreg: "registers", poreg: "money", hndreg: "team", rotreg: "team", shfreg: "team", repreg: "registers", cnreg: "money", lrcreg: "money", odreg: "stock", qtreg: "stock", ssreg: "stock", brdreg: "team", conreg: "team", vaxreg: "services", eodreg: "money", pocreg: "services", scsreg: "stock", audreg: "settings", expreg: "settings", pvreg: "services", scrreg: "services", ocpreg: "services", lblreg: "services", sinreg: "stock", otcreg: "services", eposreg: "money", calreg: "services" };
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
  // ---- q5-8 (BACKLOG5 item 8): busy lists drawn 30 rows at a time --------------------------------------------------
  // A screen filters and sorts its whole list as before, then draws only E.listPage.take(...).rows and, under them,
  // E.listPage.moreHtml(...): "Show 30 more (90 left)". A search counts every row; changing the search starts again at 30.
  // Keys are "<screen>:<list>" ("ord:open"). A row the screen must show (the one being changed, the one just saved, the
  // one opened by id from Today or Customers) is passed as opts.keep, or named once with E.listPage.reveal("ord", id):
  // the page then grows to include it. opts.first: rows for this list on the first page (a second list gets what the
  // first left of the 30). Display only: nothing here asks the server for anything.
  E.listPage = (function () {
    var STEP = 30, lim = {}, qs = {}, want = {}, last = {};
    function grp(k) { return String(k).split(":")[0]; }
    return {
      STEP: STEP,
      take: function (key, rows, opts) {
        opts = opts || {}; rows = rows || [];
        var q = String(opts.q == null ? "" : opts.q).trim().toLowerCase(), g = grp(key), idOf = opts.idOf || function (r) { return r && r.id; };
        if (!(key in lim) || qs[key] !== q) { lim[key] = opts.first == null ? STEP : Math.max(0, opts.first); qs[key] = q; }
        var n = lim[key], keep = [].concat(opts.keep == null ? [] : opts.keep, want[g] == null ? [] : [want[g]]).filter(function (x) { return x != null && x !== ""; }).map(String);
        if (keep.length) for (var i = n; i < rows.length; i++) if (keep.indexOf(String(idOf(rows[i]))) >= 0) n = Math.ceil((i + 1) / STEP) * STEP;
        lim[key] = n; last[key] = { rows: rows, idOf: idOf };
        return { rows: rows.slice(0, n), shown: Math.min(n, rows.length), left: Math.max(0, rows.length - n), total: rows.length };
      },
      moreHtml: function (key, page, cls) {
        if (!page || !page.left) return "";
        var k = Math.min(STEP, page.left), t = page.shown ? (page.left > STEP ? "Show " + k + " more (" + page.left + " left)" : "Show the last " + k) : (page.left > STEP ? "Show " + k + " of " + page.left : "Show all " + k);
        return '<div class="q5-8-morebox"><button type="button" class="' + (cls ? cls + " " : "") + 'q5-8-more" data-act="q58-more" data-key="' + E.escapeHtml(key) + '">' + t + "</button></div>";
      },
      // One page more. Returns the id of the first row it adds, for the screen to put the focus on after it redraws.
      more: function (key) { var n = lim[key] || 0, l = last[key]; lim[key] = n + STEP; return l && l.rows[n] ? l.idOf(l.rows[n]) : null; },
      reveal: function (g, id) { want[grp(g)] = id; },
      reset: function (g) { Object.keys(lim).forEach(function (k) { if (grp(k) === g) { delete lim[k]; delete qs[k]; delete last[k]; } }); delete want[g]; }
    };
  })();
  // How the person last moved: a tap or click marks <html data-q58-ptr>, a key that moves around (Tab, arrows, Enter,
  // Escape, Space) clears it. app.css (q5-8) then draws no ring round a screen title the app focused after a tap, and
  // keeps the ring for keyboard users. Until the first key the page counts as tapped. Focus itself is unchanged.
  (function () {
    var de = document.documentElement; if (!de || E._q58Mode) return; E._q58Mode = true;
    de.setAttribute("data-q58-ptr", "");
    document.addEventListener("pointerdown", function () { de.setAttribute("data-q58-ptr", ""); }, true);
    document.addEventListener("keydown", function (ev) { if (/^(Tab|Enter|Escape| |Arrow|Page|Home|End|F6)/.test(ev.key) && !ev.metaKey) de.removeAttribute("data-q58-ptr"); }, true);
  })();
  // ---- end q5-8 ------------------------------------------------------------------------------------------------------
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
    var hm = E.maltaHm(since); // Malta time, like the header and Today
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
  // After a lost answer Eikon has already looked in the list (item 8 below; E.postOnce): x.landed says what it found.
  E.saveFailText = function (x) {
    E._saveFailedAt = Date.now();
    if (x && x.alreadySaved) return String(x.message);
    if (x && x.network) {
      if (x.landed === true) return "It was saved: the connection dropped as it went through, and it is in the list.";
      if (x.landed === false) return x.notSent ? "Not saved: there is no connection. What you typed is kept: save again when it is back." : "Not saved: the connection dropped. Try again.";
      return "We could not tell if it was saved. Check the list before trying again.";
    }
    return "Not saved: " + String((x && (x.message || x)) || "error");
  };
  // POST a new record at most once. When the answer is lost (timeout, dropped connection) the list is read again and
  // a record that arrived counts as saved, so pressing Save again can never add it twice.
  // check = { list: async () => rows of the period the record falls in, same: row => true when it is this record }
  // Pressing Save again with the same thing after a lost answer counts against the list as it was before the first
  // try (item 8): a record that arrived late counts as saved, and is not sent a second time.
  var onceLost = {};
  E.postOnce = async function (path, body, check) {
    var count = async function () { return (await check.list()).filter(check.same).length; };
    var key = path + "\n" + JSON.stringify(body), prev = onceLost[key]; if (prev && Date.now() - prev.at > 30 * 60000) prev = null;
    var had = null; if (check) { try { had = await count(); } catch (e0) { had = null; } }
    if (prev && had != null && had > prev.had) { delete onceLost[key]; return { ok: true, recovered: true }; }
    if (prev && had != null) had = prev.had;
    var wasOff = navigator.onLine === false;
    try {
      var r = await E.apiFetch(path, { method: "POST", body: JSON.stringify(body), landCheck: false });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      delete onceLost[key];
      return r;
    } catch (x) {
      if (!(x && x.network)) throw x;
      if (wasOff) { x.notSent = true; x.landed = false; throw x; } // offline when pressed: it never left
      if (had == null) throw x;
      onceLost[key] = { had: had, at: Date.now() };
      var now; try { now = await count(); } catch (e1) { throw x; }
      if (now <= had) { if (!/timed out/i.test(String(x.message || ""))) x.landed = false; throw x; }
      delete onceLost[key];
      return { ok: true, recovered: true };
    }
  };
  // Run a redraw only when nobody is typing in a form on this screen. A list that arrives while someone is filling a
  // form used to redraw everything under their fingers, and the next keystrokes could land in another field. The
  // redraw now waits until focus leaves the form (moving between its fields does not count), then catches up.
  E.whenFormIdle = function (mount, fn0) {
    var fn = function () { return E.keepChanged ? E.keepChanged(mount, fn0) : fn0(); }; // what the person set in an open form survives the data arriving
    var busy = function () { var a = document.activeElement; return !!(mount && a && mount.contains(a) && a.closest && a.closest("form")); };
    if (!busy()) return fn();
    var done = false, run = function () { if (done) return; done = true; mount.removeEventListener("focusout", onOut); clearInterval(t); fn(); };
    var onOut = function () { setTimeout(function () { if (!busy()) run(); }, 0); };
    mount.addEventListener("focusout", onOut);
    var t = setInterval(function () { if (!busy() || !document.body.contains(mount)) run(); }, 2000); // a safety net
  };
  // Typing is never lost when a lookup fills a field (BACKLOG3 item 1). A lookup run as a field was left used to
  // redraw the whole form while focus was on its way to the next field; that field was replaced, focus fell to the
  // page, and the next thing typed (a DDA serial number) went nowhere.
  // E.fillEmpty(form, { name: value }) fills, in place and with no redraw, each [name=…] field that is still empty and
  // enabled. Nothing typed is ever overwritten: the field you are in is filled only while it is still empty, and the
  // filled text is selected, so the next key typed replaces it (as Tab into a filled field does). It returns the
  // names it filled, so the caller copies just those to its state.
  E.fillEmpty = function (form, map) {
    var done = []; if (!form || !map) return done;
    Object.keys(map).forEach(function (k) {
      var v = map[k], el = form.querySelector('[name="' + k + '"]');
      if (v == null || String(v) === "" || !el || el.disabled || el.readOnly || String(el.value || "")) return;
      el.value = String(v); done.push(k);
      if (el === document.activeElement) { try { el.setSelectionRange(0, el.value.length); } catch (e) {} }
    });
    return done;
  };
  // Focus is never taken from where the person is typing. A screen often moves focus a moment after an action (a
  // timer, a reply): on a busy tablet that moment comes after the person has already tapped the next field and is
  // typing, so the rest of the word went into the first field ("Prefers SMS" landed in front of the name). One rule:
  //   E.focusIfIdle(el, since, from) puts focus on el unless focus is in a field (input, text box, list, tick box)
  //   other than el that the person went to or typed in since `since` (focus is no longer `from`, the element that
  //   had it when the move was asked for, or a key or tap came after `since`). Returns true when focus is on el.
  //   E.focusSoon(target, ms) is the deferred form: target is an element or a function giving one, read when the
  //   timer fires; `since` and `from` are taken now.
  //   E.lastAction() is when the person last pressed a button or Enter (what starts a save): E.focusAfter uses it.
  var userAt = 0, actAt = 0, touchedAt = typeof WeakMap === "function" ? new WeakMap() : null;
  function entryField(el) { return !!el && el.isConnected !== false && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !/^(button|submit|reset|image|hidden)$/i.test(el.type || ""))); }
  ["keydown", "pointerdown", "mousedown", "touchstart", "input"].forEach(function (ty) {
    document.addEventListener(ty, function (ev) {
      if (ev.isTrusted === false) return;
      var now = Date.now(), t = ev.target; userAt = now;
      if (entryField(t)) { if (touchedAt) touchedAt.set(t, now); if (ty === "keydown" && ev.key === "Enter") actAt = now; }
      else if (ty !== "input") actAt = now;
    }, true);
  });
  document.addEventListener("change", function (ev) { var t = ev.target; if (touchedAt && t && (t.tagName === "SELECT" || /^(checkbox|radio)$/i.test(t.type || ""))) touchedAt.set(t, Date.now()); }, true);
  E.lastAction = function () { return actAt; };
  // E.keepChanged(mount, paintFn): a redraw (data arriving, a list read late) keeps every field the person changed in an
  // open form (an id'd form), not only the one with focus: a text, a list, a tick box. A field is put back only while
  // the redraw brought the same starting value it had (so what the screen itself changes wins), and not once the form
  // was sent after the change (a form cleared for the next entry stays clear).
  function startOf(el) {
    if (/^(checkbox|radio)$/i.test(el.type || "")) return el.defaultChecked;
    if (el.tagName === "SELECT") { for (var i = 0; i < el.options.length; i++) if (el.options[i].defaultSelected) return el.options[i].value; return el.options.length ? el.options[0].value : ""; }
    return el.defaultValue;
  }
  function nowOf(el) { return /^(checkbox|radio)$/i.test(el.type || "") ? el.checked : el.value; }
  E.keepChanged = function (mount, paintFn) {
    var list = [];
    if (mount && touchedAt) Array.prototype.forEach.call(mount.querySelectorAll("form[id]"), function (f) {
      Array.prototype.forEach.call(f.querySelectorAll("input,select,textarea"), function (el) {
        var t = touchedAt.get(el) || 0, k = t > (f._eikonSentAt || 0) ? E.focusKey(el) : ""; if (!k) return;
        var was = startOf(el), now = nowOf(el); if (now === was) return;
        list.push({ f: f.id, k: k, n: Array.prototype.indexOf.call(f.querySelectorAll(k), el), was: was, now: now, t: t });
      });
    });
    var r = paintFn();
    list.forEach(function (x) {
      var f = null; try { f = mount.querySelector("form#" + (window.CSS && CSS.escape ? CSS.escape(x.f) : x.f)); } catch (e) {}
      var el = f && f.querySelectorAll(x.k)[x.n]; if (!el || el.disabled || nowOf(el) === x.now) return;
      if (nowOf(el) !== x.was || startOf(el) !== x.was) return; // the screen changed it: its value stands
      if (typeof x.now === "boolean") el.checked = x.now; else el.value = x.now;
      touchedAt.set(el, x.t);
    });
    return r;
  };
  E.personSince = function (since) { return userAt >= (since || 0); }; // a key or a tap by the person since then
  E.focusIfIdle = function (el, since, from) {
    if (!el || !el.isConnected || el.disabled) return false;
    var a = document.activeElement;
    if (a && a !== el && a !== document.body && entryField(a) && (a !== from || userAt >= (since || 0) || (touchedAt && (touchedAt.get(a) || 0) >= (since || 0)))) return false; // the person is there: leave them
    try { el.focus(); } catch (e) {}
    return document.activeElement === el;
  };
  E.focusSoon = function (target, ms) {
    var since = Date.now(), from = document.activeElement;
    setTimeout(function () { var el = null; try { el = typeof target === "function" ? target() : target; } catch (e) {} if (el) E.focusIfIdle(el, since, from); }, ms || 0);
  };
  // E.keepTyped(mount, paintFn, sel, keyOf) is the same for a screen whose fields have no name (Today's readings): the
  // redraw keeps what was typed in every field matching sel, put back in the field with the same keyOf(el) while that
  // one still shows what it showed before (a row just saved is gone, so its numbers go with it), and the field you
  // were in gets focus and its cursor back.
  E.keepTyped = function (mount, paintFn, sel, keyOf) {
    var ae = document.activeElement, kept = [], fk = "", s0 = null, s1 = null;
    if (mount) Array.prototype.forEach.call(mount.querySelectorAll(sel), function (el) {
      var k = keyOf(el); if (!k) return;
      if (el === ae) { fk = k; try { s0 = el.selectionStart; s1 = el.selectionEnd; } catch (e) {} }
      if (el.value !== el.defaultValue || el === ae) kept.push({ k: k, v: el.value, was: el.defaultValue, t: touchedAt ? touchedAt.get(el) || 0 : 0 });
    });
    paintFn();
    if (!mount || !kept.length) return;
    var now = {}; Array.prototype.forEach.call(mount.querySelectorAll(sel), function (el) { var k = keyOf(el); if (k && !(k in now)) now[k] = el; });
    kept.forEach(function (x) { var el = now[x.k]; if (!el || el.disabled) return; if (el.value === "" || el.value === x.was) el.value = x.v; if (x.t && touchedAt) touchedAt.set(el, x.t); });
    var back = fk && now[fk], a = document.activeElement;
    if (back && !back.disabled && (!a || a === document.body || !a.isConnected)) { try { back.focus({ preventScroll: true }); } catch (e) { back.focus(); } if (s0 != null) { try { back.setSelectionRange(s0, s1); } catch (e) {} } }
  };
  // ==== q5-2: nothing typed is lost when you leave a form (BACKLOG5 item 2, decision D3) ========================
  // A half-typed NEW entry left by Back, a tab, a hub card, the search or the address bar is kept in this browser tab
  // (sessionStorage) for this pharmacy and this signed-in person, until the end of the Malta day. Coming back to that
  // screen opens its form again exactly as it was, with a quiet line "Your unsaved order is back · Clear". Nothing is
  // ever sent: only the screen's own Save reaches the server, and the restored form saves what typing it would save
  // (each value is put in its field with the input, change and blur events typing and leaving the field give). Taking a draft
  // back removes it from storage, so a save or Cancel leaves nothing behind; leaving again with the form still
  // changed keeps it again. A person carried from Customers wins: the draft is only offered ("Bring back what you were
  // typing"), never merged. Passwords and files are never kept. New layout only.
  //   E.draft.spec(screen, o, mount)   as the screen is drawn: o.btn opens its new-entry form, o.form is it; o.isNew()
  //                             (optional) is false while the same form edits a saved record. True when drafts apply.
  //   E.draft.keep(screen, mount)   the router calls it as a screen is left; also on pagehide.
  //   E.draft.take(screen, mount, ready)   after `ready`, reopen the form with the draft; returns `ready`.
  //   E.draft.offer(screen, mount)   a carried person's form is open: offer the draft beside it.
  //   E.draft.clear(screen)   drop it.
  E.draft = (function () {
    var PRE = "eikon_draft_v1|", specs = {}, NOUN = { ordreg: "order", tktreg: "question", dlvreg: "delivery", cdsreg: "controlled drug sale", cdpreg: "controlled drug purchase", poyreg: "POYC line", drreg: "register line", locreg: "locum line", cleanreg: "cleaning line", repreg: "repeat prescription", poreg: "payment", cnreg: "credit note", lrcreg: "locum receipt", odreg: "order diary item", qtreg: "quotation", nexreg: "near-expiry item", alertreg: "alert", pocreg: "test", pvreg: "report", conreg: "contact", vaxreg: "vaccine order", retreg: "return", ssreg: "request", scsreg: "stock to share", trfreg: "offer" };
    function on() { return !!(E.isUi2 && E.isUi2() && E._sectionDashboardId === "today"); }
    function who() { var u = E.state && E.state.user; return u ? String(u.location_id) + "|" + String(u.id != null ? u.id : (u.email || "")) : ""; }
    function key(screen) { var w = who(); return w && screen ? PRE + w + "|" + screen : ""; }
    function ss() { try { return window.sessionStorage; } catch (e) { return null; } }
    function read(screen) {
      var s = ss(), k = key(screen), d = null; if (!s || !k) return null;
      try { d = JSON.parse(s.getItem(k) || "null"); } catch (e) { d = null; }
      if (d && (d.v !== 1 || d.day !== E.maltaYmd() || !Array.isArray(d.fields))) { try { s.removeItem(k); } catch (e) {} d = null; } // another day's: gone
      return d;
    }
    function clear(screen) { var s = ss(), k = key(screen); if (s && k) try { s.removeItem(k); } catch (e) {} }
    function skip(el) { var t = String(el.type || "").toLowerCase(); return el.disabled || /^(password|file|hidden|button|submit|reset|image)$/.test(t) || /password/i.test(el.getAttribute("autocomplete") || "") || !!(el.closest && el.closest(".eikon-draft")); }
    function val(el) { return /^(checkbox|radio)$/i.test(el.type || "") ? !!el.checked : String(el.value == null ? "" : el.value); }
    function fieldsOf(f) { // [{ k, n, v, el }] in the form's own order
      var out = [], seen = {};
      Array.prototype.forEach.call(f.querySelectorAll("input,select,textarea"), function (el) {
        if (skip(el)) return; var k = E.focusKey(el); if (!k) return;
        var n = seen[k] = (seen[k] == null ? 0 : seen[k] + 1); out.push({ k: k, n: n, v: val(el), el: el });
      });
      return out;
    }
    function at(f, x) { var l; try { l = f.querySelectorAll(x.k); } catch (e) { return null; } var i = -1, el = null; Array.prototype.some.call(l, function (c) { if (skip(c)) return false; i++; if (i === x.n) { el = c; return true; } return false; }); return el; }
    function formOf(screen, mount) { var sp = specs[screen]; if (!sp || !mount) return null; var f = null; try { f = mount.querySelector(sp.form); } catch (e) {} return f; }
    function isNew(sp) { try { return !sp.isNew || !!sp.isNew(); } catch (e) { return false; } }
    // The form as it first appeared after its button was pressed: what the screen itself put there (today's date, the
    // signed-in person, a default of 1). A draft is only what differs from it.
    function snap(screen, mount) {
      var sp = specs[screen], f = formOf(screen, mount); if (!sp || !f || sp.fresh) return;
      sp.fresh = {}; fieldsOf(f).forEach(function (x) { sp.fresh[x.k + "#" + x.n] = x.v; });
    }
    function watch(screen, mount) {
      var sp = specs[screen]; if (!sp) return; sp.fresh = null; sp.shown = null; // a screen drawn afresh
      if (sp.mount === mount) return; sp.mount = mount;
      var mine = function () { return E.state && E.state.activeModuleId === screen; };
      mount.addEventListener("click", function (ev) { // the screen's own New (a tap, Enter, the N key, E.takeOpenForm)
        if (!mine()) return;
        var b = ev.target && ev.target.closest && ev.target.closest(sp.btn); if (!b || !mount.contains(b) || formOf(screen, mount)) return;
        sp.fresh = null; setTimeout(function () { snap(screen, mount); }, 0);
      }, true);
      if (window.MutationObserver) new MutationObserver(function () {
        if (!mine()) return;
        if (formOf(screen, mount)) { if (sp.shown) line(screen, mount); return; }
        sp.fresh = null; sp.shown = null; // closed (saved or cancelled): the next one opens clean
        var ln = mount.querySelector(".eikon-draft"); if (ln) ln.parentNode.removeChild(ln);
      }).observe(mount, { childList: true, subtree: true });
    }
    function changed(screen, mount) {
      var sp = specs[screen], f = formOf(screen, mount); if (!sp || !f || !sp.fresh || !isNew(sp)) return null;
      var list = fieldsOf(f).filter(function (x) { var w = sp.fresh[x.k + "#" + x.n]; return w === undefined ? (x.v !== "" && x.v !== false) : w !== x.v; });
      return list.length ? { f: f, list: list } : null;
    }
    function keep(screen, mount) {
      if (!on() || window.EIKON_NO_DRAFTS) return; // EIKON_NO_DRAFTS: set only by the UI suite's shared page, whose older checks leave forms open on purpose
      var c = changed(screen, mount), s = ss(), k = key(screen); if (!c || !s || !k) return;
      var a = document.activeElement, fx = a && c.f.contains(a) ? fieldsOf(c.f).filter(function (x) { return x.el === a; })[0] : null;
      var d = { v: 1, day: E.maltaYmd(), at: Date.now(), fields: c.list.map(function (x) { return { k: x.k, n: x.n, v: x.v }; }), focus: fx ? { k: fx.k, n: fx.n } : null };
      try { s.setItem(k, JSON.stringify(d)); } catch (e) {}
    }
    // Put values in, as typing would: each field in the form's order, the form looked up again after each (a choice
    // can redraw it). A field the person has typed in since `since` is theirs and is left alone.
    function apply(screen, mount, fields, since) {
      fields.forEach(function (x) {
        var f = formOf(screen, mount), el = f && at(f, x); if (!el || el.disabled || el.readOnly) return;
        if (touchedAt && (touchedAt.get(el) || 0) > since) return;
        if (val(el) === x.v) return;
        if (typeof x.v === "boolean") el.checked = x.v; else el.value = x.v;
        try { el.dispatchEvent(new Event("input", { bubbles: true })); el.dispatchEvent(new Event("change", { bubbles: true })); } catch (e) {}
        if (el !== document.activeElement && el.isConnected) try { el.dispatchEvent(new FocusEvent("blur")); el.dispatchEvent(new FocusEvent("focusout", { bubbles: true })); } catch (e) {} // and left, as after typing: suggestion lists close, lookups run
        var again = (formOf(screen, mount) && at(formOf(screen, mount), x)) || el; if (touchedAt) touchedAt.set(again, Date.now()); // kept across a redraw (E.keepChanged)
      });
    }
    function css() {
      if (document.getElementById("eikon-draft-css")) return;
      var st = document.createElement("style"); st.id = "eikon-draft-css";
      st.textContent = ".eikon-draft{display:flex;flex-wrap:wrap;align-items:center;gap:0 8px;margin:4px 0 4px;font-size:14px;line-height:1.4;color:var(--muted,#555)}" +
        ".eikon-draft button{min-height:44px;padding:0 6px;border:0;background:transparent;color:var(--accent,#0b6b4e);font:inherit;font-weight:600;text-decoration:underline;text-underline-offset:3px;cursor:pointer;border-radius:8px}" +
        ".eikon-draft button:focus-visible{outline:2px solid var(--accent,#0b6b4e);outline-offset:2px}";
      document.head.appendChild(st);
    }
    // The quiet line just above the form. Put back after a redraw while the form stays open.
    function line(screen, mount) {
      var sp = specs[screen], f = formOf(screen, mount); if (!sp || !sp.shown || !f) return;
      var old = mount.querySelector(".eikon-draft"); if (old && old.nextElementSibling === f && old.getAttribute("data-mode") === sp.shown.mode) return;
      if (old) old.parentNode.removeChild(old);
      css();
      var noun = NOUN[screen] || "entry", p = document.createElement("p");
      p.className = "eikon-draft"; p.setAttribute("role", "status"); p.setAttribute("data-mode", sp.shown.mode);
      p.innerHTML = sp.shown.mode === "back" ? "<span>Your unsaved " + E.escapeHtml(noun) + " is back</span><span aria-hidden=\"true\">·</span><button type=\"button\" data-draft=\"clear\">Clear</button>"
        : "<span>You were typing another " + E.escapeHtml(noun) + "</span><span aria-hidden=\"true\">·</span><button type=\"button\" data-draft=\"bring\">Bring back what you were typing</button>";
      p.querySelector("button").addEventListener("click", function () {
        var since = Date.now();
        if (sp.shown.mode === "back") { // Clear: the form as it opened, ready for a new one
          var fresh = sp.shown.fresh || {}, back = Object.keys(fresh).map(function (k) { var i = k.lastIndexOf("#"); return { k: k.slice(0, i), n: Number(k.slice(i + 1)), v: fresh[k] }; });
          apply(screen, mount, back, Infinity); sp.shown = null; clear(screen);
        } else { // the draft instead of the carried person, whole: every other field as the form opened
          var d = sp.shown.draft, fr = sp.shown.fresh || {}, have = {};
          d.fields.forEach(function (x) { have[x.k + "#" + x.n] = 1; });
          var all = Object.keys(fr).filter(function (k) { return !have[k]; }).map(function (k) { var i = k.lastIndexOf("#"); return { k: k.slice(0, i), n: Number(k.slice(i + 1)), v: fr[k] }; });
          apply(screen, mount, all.concat(d.fields), Infinity); clear(screen); sp.shown = { mode: "back", fresh: fr };
        }
        var f2 = formOf(screen, mount), ln = mount.querySelector(".eikon-draft"); if (ln) ln.parentNode.removeChild(ln);
        line(screen, mount);
        var first = f2 && fieldsOf(f2).filter(function (x) { return !x.el.readOnly && !/^(checkbox|radio)$/i.test(x.el.type || ""); })[0];
        if (first) E.focusIfIdle(first.el, since, null);
      });
      f.parentNode.insertBefore(p, f);
    }
    function spec(screen, o, mount) { // called as the screen is drawn, before its form can open
      if (!screen || !o || !o.btn || !o.form) return false;
      var sp = specs[screen] = specs[screen] || {}; sp.btn = o.btn; sp.form = o.form; sp.isNew = o.isNew || null;
      if (mount) watch(screen, mount);
      return true;
    }
    function later(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
    async function waitFor(mount, fn, ms) { var t = Date.now(); while (Date.now() - t < ms) { if (!document.body.contains(mount)) return null; var x = fn(); if (x) return x; await later(40); } return null; }
    async function reopen(screen, mount, since) { // since: when the screen began to open (typing from then on is the person's)
      var sp = specs[screen], d = read(screen); if (!sp || !d) return; since = since || Date.now();
      var here = function () { return document.body.contains(mount) && E.state.activeModuleId === screen; };
      var from = document.activeElement;
      var b = await waitFor(mount, function () { var x = formOf(screen, mount) || mount.querySelector(sp.btn); return x && !x.disabled ? x : null; }, 4000);
      if (!b || !here()) return;
      var a = document.activeElement, busy = a && mount.contains(a) && a.matches && a.matches("input,select,textarea") && E.personSince(since);
      if (busy && !(a.closest && a.closest(sp.form))) return; // typing in the screen (its search): kept for later
      if (busy) { snap(screen, mount); sp.shown = { mode: "offer", draft: d, fresh: sp.fresh ? Object.assign({}, sp.fresh) : {} }; line(screen, mount); return; } // they began a new one meanwhile: offered, never merged
      if (!b.matches(sp.form)) b.click();
      var f = await waitFor(mount, function () { return formOf(screen, mount); }, 3000); if (!f || !here()) return;
      await later(40); // after the screen's own "focus the first field" (30 ms)
      if (!here() || !formOf(screen, mount)) return;
      snap(screen, mount); var fresh = sp.fresh ? Object.assign({}, sp.fresh) : {};
      apply(screen, mount, d.fields, since);
      clear(screen); sp.shown = { mode: "back", fresh: fresh }; line(screen, mount);
      var f2 = formOf(screen, mount), el = f2 && d.focus ? at(f2, d.focus) : null;
      if (!el && f2) { var last = d.fields[d.fields.length - 1]; el = last ? at(f2, last) : null; }
      if (el) E.focusIfIdle(el, since, from);
    }
    function take(screen, mount, ready) {
      if (!on() || !specs[screen] || !mount) return ready;
      if (!read(screen)) return ready;
      var since = Date.now(), go = function () { reopen(screen, mount, since).catch(function () {}); };
      return Promise.resolve(ready).then(function (v) { go(); return v; }, function (e) { go(); throw e; });
    }
    function offer(screen, mount) {
      if (!on() || !specs[screen] || !mount) return;
      var d = read(screen), sp = specs[screen]; if (!d) return;
      snap(screen, mount); // the form as it opened, before the person is filled in (when it is already drawn)
      waitFor(mount, function () { return formOf(screen, mount); }, 3000).then(function (f) {
        if (!f) return; snap(screen, mount); sp.shown = { mode: "offer", draft: d, fresh: sp.fresh ? Object.assign({}, sp.fresh) : {} }; line(screen, mount);
      });
    }
    window.addEventListener("pagehide", function () { try { var c = document.getElementById("eikon-content"); if (E.state && E.state.activeModuleId) keep(E.state.activeModuleId, c); } catch (e) {} });
    function dropMine() { var s = ss(), w = who(); if (!s || !w) return; try { for (var i = s.length - 1; i >= 0; i--) { var k = s.key(i); if (k && k.indexOf(PRE + w + "|") === 0) s.removeItem(k); } } catch (e) {} }
    return { spec: spec, keep: keep, take: take, offer: offer, clear: clear, dropMine: dropMine };
  })();
  // ==== end q5-2 ====================================================================================================
  // Form problems, said one way on every screen. E.formErrors(form, problems, opts): problems is a list of
  // { field: a [name] or the element, msg }. Every field named is marked aria-invalid and tied (aria-describedby) to ONE
  // role=alert message saying all the problems at once; the first field gets the cursor; typing in a marked field
  // unmarks it, and the message goes when none is left. Nothing typed is touched. An empty list clears the form.
  //   opts.cls  the message's class (the screen's own red text); opts.id  its id (default: first field's id + "-err")
  //   opts.at   "field": the message sits under the first field (in its label); default: at the top of the form
  //   opts.onFix(el)  called as each marked field is typed in (a screen that keeps its own list of bad fields)
  // Returns the first field marked (or null).
  function feUnmark(form, st, el) {
    el.removeEventListener("input", el.__eikonFeIn); el.__eikonFeIn = null;
    el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby");
    var i = st.fields.indexOf(el); if (i >= 0) st.fields.splice(i, 1);
    if (!st.fields.length) { if (st.box.parentNode) st.box.parentNode.removeChild(st.box); if (form.__eikonFE === st) form.__eikonFE = null; }
  }
  E.formErrors = function (form, problems, opts) {
    if (!form) return null; opts = opts || {};
    var prev = form.__eikonFE; if (prev) { prev.fields.slice().forEach(function (el) { feUnmark(form, prev, el); }); if (prev.box.parentNode) prev.box.parentNode.removeChild(prev.box); form.__eikonFE = null; }
    var list = [];
    (problems || []).forEach(function (p) {
      var el = p && p.field && (p.field.nodeType ? p.field : form.querySelector('[name="' + p.field + '"]'));
      if (el) list.push({ el: el, msg: String(p.msg || "") });
    });
    if (!list.length) return null;
    var first = list[0].el, id = opts.id || ((first.id || form.id || "eikon-form") + "-err");
    var box = document.getElementById(id);
    if (!box) {
      box = document.createElement(opts.at === "field" ? "span" : "div"); box.id = id;
      if (opts.at === "field") first.parentNode.appendChild(box); else form.insertBefore(box, form.firstChild);
    }
    box.className = opts.cls || "eikon-ferr"; box.setAttribute("role", "alert");
    box.textContent = list.map(function (m) { return m.msg; }).filter(Boolean).join(" ");
    var st = { fields: [], box: box };
    list.forEach(function (m) {
      var el = m.el; if (st.fields.indexOf(el) >= 0) return;
      el.setAttribute("aria-invalid", "true"); el.setAttribute("aria-describedby", id); st.fields.push(el);
      el.__eikonFeIn = function () { if (form.__eikonFE !== st) return; feUnmark(form, st, el); if (opts.onFix) try { opts.onFix(el); } catch (e) {} };
      el.addEventListener("input", el.__eikonFeIn);
    });
    form.__eikonFE = st;
    try { first.focus(); } catch (e) {}
    return first;
  };
  // A loading placeholder for a list (instead of a spinner): n grey rows that shimmer (still without motion when the
  // device asks for less), announced once as "Opening …". `cls` adds the screen's own class for its row height.
  E.skeleton = function (n, what, cls) {
    var h = '<div class="eikon-skel' + (cls ? " " + cls : "") + '" role="status" aria-busy="true"><span class="eikon-sr">' + E.escapeHtml(what || "Opening") + "</span>";
    for (var i = 0; i < (n || 3); i++) h += "<i></i>";
    return h + "</div>";
  };
  // E.repaintKeepingFocus(mount, paintFn) redraws, then puts back the field you were in, the cursor, and what you had
  // typed if the redraw brought an older copy. Called while focus is moving (from a "change", "blur" or "focusout"
  // handler, or between the two halves of a Tab) it waits for focus to land, so it brings back the field you went to.
  var focusMoving = false;
  document.addEventListener("focusout", function () { focusMoving = true; setTimeout(function () { focusMoving = false; }, 0); }, true);
  document.addEventListener("focusin", function () { focusMoving = false; }, true);
  E.focusKey = function (el) {
    if (!el || !el.getAttribute || el === document.body) return "";
    var q = function (v) { return '"' + String(v).replace(/["\\]/g, "\\$&") + '"'; }, s = "";
    ["name", "data-k", "data-i", "data-id", "data-act"].forEach(function (a) { var v = el.getAttribute(a); if (v != null) s += "[" + a + "=" + q(v) + "]"; });
    if (!s && el.id) s = "#" + (window.CSS && CSS.escape ? CSS.escape(el.id) : el.id);
    return s ? el.tagName.toLowerCase() + s : "";
  };
  function typedIn(el) { return !!el && (el.tagName === "TEXTAREA" || (el.tagName === "INPUT" && /^(text|search|tel|email|url|number|password|)$/i.test(el.getAttribute("type") || ""))); }
  E.repaintKeepingFocus = function (mount, paintFn) {
    var ev = window.event;
    if ((ev && /^(blur|focusout|change)$/.test(ev.type)) || focusMoving) { setTimeout(function () { E.repaintKeepingFocus(mount, paintFn); }, 0); return; }
    var ae = document.activeElement, key = mount && ae && ae !== document.body && mount.contains(ae) ? E.focusKey(ae) : "";
    var nth = 0, val = null, s0 = null, s1 = null, fid = "", touched = 0;
    // looked up inside its own form (by id) when it has one: a form opening or closing above it does not move it to another form's field of the same name
    var inside = function () { if (!fid) return mount; var f = null; try { f = mount.querySelector("form#" + (window.CSS && CSS.escape ? CSS.escape(fid) : fid)); } catch (e) {} return f; };
    if (key) { var fo = ae.closest && ae.closest("form[id]"); fid = fo && mount.contains(fo) ? fo.id : ""; nth = Math.max(0, Array.prototype.indexOf.call(inside().querySelectorAll(key), ae)); if (typedIn(ae)) { val = ae.value; try { s0 = ae.selectionStart; s1 = ae.selectionEnd; } catch (e) {} } touched = touchedAt ? touchedAt.get(ae) || 0 : 0; }
    E.keepChanged(mount, paintFn); // the other fields the person changed in the form stay too
    if (!key) return;
    var root = inside(); if (!root) return;
    var again = root.querySelectorAll(key)[nth];
    if (!again || again.disabled) return;
    if (val != null && typedIn(again) && again.value !== val) again.value = val; // what you typed wins over an older copy
    if (again !== document.activeElement) { try { again.focus({ preventScroll: true }); } catch (e) { again.focus(); } }
    if (s0 != null) { try { again.setSelectionRange(s0, s1); } catch (e) {} }
    if (touched && touchedAt && again !== ae) touchedAt.set(again, touched); // the redrawn field is still the one the person typed in
  };
  // Focus is never lost (BACKLOG4 item 2). One place keeps the keyboard where the person is, in the new layout only:
  //  - E.focusAfter(target) puts focus on target as soon as it is on the screen: an element, a selector inside the
  //    screen, or a function (screen) => element. A heading or a row is given tabindex=-1 so it can hold focus. It
  //    never takes focus from a form being typed in (E.whenFormIdle) or from a place the person chose meanwhile.
  //  - Focus that falls to the page because the screen redrew (a save, a reload) is put back once the requests have
  //    settled (so a screen that places it itself goes first): on the same control if it is still there, else on the
  //    button that opened the form, else on the screen's heading. Nothing is left on <body>.
  //  - A screen opened from a hub, the search, Back or a link puts focus on its heading: the next Tab is its main button.
  //  - Keys: N opens the screen's main form (when not typing); in a form, Ctrl/Cmd+Enter saves and Escape cancels.
  (function () {
    var net = 0, sawNet = false, last = null, lastUser = null, opener = null, placed = null, pending = null, timer = 0, since = 0, observed = null, mo = null, typed = {};
    var raw = E.apiFetch; // count the requests on their way, so a lost focus waits for the screen's own answer first
    E.apiFetch = function () {
      net++; var done = function () { net = Math.max(0, net - 1); };
      var p; try { p = raw.apply(this, arguments); } catch (e) { done(); throw e; }
      return Promise.resolve(p).then(function (v) { done(); return v; }, function (x) { done(); throw x; });
    };
    function screen() { var c = document.getElementById("eikon-content"); return c && E._sectionDashboardId === "today" && E.isUi2() ? c : null; }
    function lostNow() { var a = document.activeElement; return !a || a === document.body || a === document.documentElement || !a.isConnected; }
    function shown(el) { return !!el && el.isConnected && !el.disabled && !(el.closest && el.closest("[hidden],[inert]")) && el.getClientRects().length > 0; }
    function inForm(el) { return !!(el && el.closest && el.closest("form")); }
    function keyOf(el, c) { var k = E.focusKey(el); return k ? { k: k, n: Math.max(0, Array.prototype.indexOf.call(c.querySelectorAll(k), el)) } : null; }
    function byKey(c, o) { if (!o) return null; var l; try { l = c.querySelectorAll(o.k); } catch (e) { return null; } return shown(l[o.n]) ? l[o.n] : null; }
    function formKey(f) { return f.id ? "#" + f.id : "form"; }
    function heading(c) { return c.querySelector("h1"); }
    function resolve(t, c) { try { return typeof t === "function" ? t(c) : typeof t === "string" ? c.querySelector(t) : t; } catch (e) { return null; } }
    function put(el, scroll) {
      if (!el) return false;
      if (!el.matches("a[href],button,input,select,textarea,[tabindex]")) el.setAttribute("tabindex", "-1");
      placed = el;
      try { el.focus({ preventScroll: !scroll }); } catch (e) { try { el.focus(); } catch (e2) {} }
      return document.activeElement === el;
    }
    E.focusAfter = function (target, opts) {
      var c = screen(); if (!c) return false;
      pending = { t: target, at: Date.now(), since: Math.min(Date.now(), actAt || Date.now()), from: document.activeElement, scroll: !(opts && opts.scroll === false) };
      return tryPending(c);
    };
    function tryPending(c) {
      var p = pending; if (!p) return false;
      if (Date.now() - p.at > 6000) { pending = null; return false; }
      var el = resolve(p.t, c); if (!shown(el)) return false; // not on the screen yet: the next redraw tries again
      var a = document.activeElement;
      pending = null;
      if (!lostNow() && a !== placed && a !== el && entryField(a) && touchedAt && (touchedAt.get(a) || 0) >= p.since) return false; // typed in since the action started (E.focusIfIdle): leave them there
      if (lostNow() || a === placed || (a === p.from && !inForm(a))) return put(el, p.scroll);
      if (c.contains(a) && inForm(a)) E.whenFormIdle(c, function () { if (lostNow()) put(resolve(p.t, c), p.scroll); }); // typing: only a focus that fell is taken
      return false; // the person went somewhere else meanwhile: leave them there
    }
    function schedule() { if (timer) return; since = Date.now(); sawNet = net > 0; timer = setTimeout(tick, 80); }
    function tick() {
      timer = 0;
      var c = screen(); if (!c) return;
      if (pending && !tryPending(c) && pending) return;
      if (!lostNow() || !last) return;
      if ((net > 0 || sawNet) && Date.now() - since < 4000) { sawNet = net > 0; timer = setTimeout(tick, 80); return; } // a save or a reload is on its way
      var l = last, el;
      if (l.el.isConnected && c.contains(l.el)) { if (!shown(l.el)) return; el = l.el; } // still there: enabled again after a failed save
      else el = byKey(c, l.key) || (l.h1 && heading(c)) || (l.form && byKey(c, opener)) || null;
      if (el) put(el, true); else put(heading(c), false);
    }
    function watch(c) {
      if (observed === c || !window.MutationObserver) return;
      if (mo) mo.disconnect();
      observed = c;
      mo = new MutationObserver(function () {
        Object.keys(typed).forEach(function (k) { var f = null; try { f = c.querySelector(k); } catch (e) {} if (k !== "form" && !f) delete typed[k]; }); // a form that closed opens clean next time
        if (pending) tryPending(c);
        if (last && lostNow()) schedule();
      });
      mo.observe(c, { childList: true, subtree: true, attributes: true, attributeFilter: ["disabled", "hidden"] });
    }
    document.addEventListener("focusin", function (ev) {
      var c = screen(), el = ev.target; if (!c) return;
      watch(c);
      if (!c.contains(el)) { if (!(el.closest && el.closest("[role=dialog],[aria-modal=true],.eikon-modal-overlay,.esr-ov"))) last = null; return; } // a dialog gives focus back here
      last = { el: el, key: keyOf(el, c), h1: el.tagName === "H1", form: inForm(el) };
      if (el === placed) return; // where Eikon put focus is not where the person went
      if (last.form && lastUser && !lastUser.form && lastUser.key) opener = lastUser.key; // the button that opened this form
      lastUser = last;
    }, true);
    document.addEventListener("focusout", function (ev) {
      var t = ev.target;
      setTimeout(function () {
        var c = screen(); if (!c || !lostNow() || !last) return;
        if (t && t === last.el && shown(t) && c.contains(t)) { last = null; return; } // put down on purpose (a click on empty space)
        schedule();
      }, 0);
    }, true);
    // The router: a screen about to be drawn. Focus moves to its heading when it was on the page or on the old screen
    // (a hub card, a result, Back, a link); a rail tab keeps it. The first screen after sign-in leaves it alone.
    E._focusScreenOpening = function (c) {
      if (!screen()) return false;
      watch(c);
      var a = document.activeElement, first = !c._eikonSeen; c._eikonSeen = true;
      last = lastUser = opener = pending = null; typed = {};
      return !first && (lostNow() || c.contains(a));
    };
    E._focusScreenOpened = function (move) { if (move && lostNow()) E.focusAfter(heading, { scroll: false }); }; // a screen that placed focus itself keeps it
    // The screen's main button: the first primary button after its heading, in the heading's own block.
    E.mainButton = function (c) {
      c = c || screen(); var h = c && heading(c); if (!h) return null;
      for (var box = h.parentElement, i = 0; box && i < 2 && c.contains(box); box = box.parentElement, i++) {
        var bs = box.querySelectorAll("button.p");
        for (var j = 0; j < bs.length; j++) if ((h.compareDocumentPosition(bs[j]) & 4) && shown(bs[j]) && !inForm(bs[j])) return bs[j];
      }
      return null;
    };
    function textish(el) { return !!el && (el.isContentEditable || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el.tagName === "INPUT" && !/^(checkbox|radio|button|submit|reset|file|range|color|image)$/i.test(el.type || ""))); }
    function overlay() { return !!document.querySelector(".esr-ov, [aria-modal=true]:not([hidden])") || Array.prototype.some.call(document.querySelectorAll(".eikon-modal-overlay"), function (o) { return o.style.display === "flex"; }); }
    document.addEventListener("submit", function (ev) { if (ev.target) ev.target._eikonSentAt = Date.now(); }, true);
    ["input", "change"].forEach(function (t) {
      document.addEventListener(t, function (ev) { var c = screen(), f = c && ev.target && ev.target.closest && ev.target.closest("form"); if (f && c.contains(f)) typed[formKey(f)] = true; }, true);
    });
    function hub(id) { return id === "today" || id === "bookings" || (E.UI2_RAIL || []).concat(E.UI2_RAIL_FOOT || []).some(function (r) { return r.id === id; }); }
    var nTimer = 0;
    document.addEventListener("keydown", function (ev) {
      if (nTimer) { clearTimeout(nTimer); nTimer = 0; } // another key straight after N: a scanner or typing, not the shortcut
      var c = screen(); if (!c || ev.defaultPrevented || ev.isComposing || ev.altKey) return;
      var a = document.activeElement, f = a && c.contains(a) && a.closest ? a.closest("form") : null, mod = ev.ctrlKey || ev.metaKey;
      // Ctrl/Cmd+Enter saves from anywhere in the form, a text box included (once: not if the browser already sent it)
      if (f && ev.key === "Enter" && mod && !ev.shiftKey) {
        var t0 = Date.now();
        // the field being left first, as Tab would (its change: a known prescriber brings the reg no.), then the save
        if (a !== f && textish(a) && a.tagName !== "SELECT") { try { a.blur(); a.focus({ preventScroll: true }); } catch (e0) {} }
        setTimeout(function () {
          if (ev.defaultPrevented || (f._eikonSentAt || 0) >= t0) return;
          var sb = f.querySelector("button[type=submit],input[type=submit],button:not([type])");
          if (sb && shown(sb)) sb.click();
        }, 0);
        return;
      }
      // Escape cancels the form. Something typed is never thrown away by one key: Escape then goes to Cancel.
      if (f && ev.key === "Escape" && !mod && !ev.shiftKey) {
        var list = a.getAttribute("aria-expanded") === "true" || !!f.querySelector("[role=listbox]:not([hidden]) [role=option], .epp-list:not([hidden])");
        if (list) return; // Escape closes the suggestions first
        setTimeout(function () {
          if (ev.defaultPrevented || !f.isConnected) return;
          var cancel = Array.prototype.filter.call(f.querySelectorAll("button"), function (b) { return b.type !== "submit" && shown(b) && (/cancel|close/i.test(b.getAttribute("data-act") || "") || /^(cancel|close)$/i.test((b.textContent || "").trim())); })[0];
          if (!cancel) return;
          if (typed[formKey(f)]) { cancel.focus(); return; }
          cancel.click();
        }, 0);
        return;
      }
      // N: the screen's main form, when not typing and no dialog is open
      if ((ev.key === "n" || ev.key === "N") && !mod && !f && !textish(a) && !overlay() && !hub(E.state.activeModuleId) && !Object.keys(typed).length) {
        nTimer = setTimeout(function () {
          nTimer = 0; if (ev.defaultPrevented || overlay()) return;
          var b = E.mainButton(c); if (b && /^(new|add|record|log|start|share|ask|offer)\b/i.test((b.textContent || "").trim())) b.click(); // a button that starts something, never Save or Download
        }, 90);
      }
    });
  })();
  // ==== Honest when the connection drops (BACKLOG4 item 8) ======================================================
  // 1. A thin banner (role=status, polite) says "No connection — what you type is kept" as soon as the browser goes
  //    offline, and "Back online" when it returns. It never covers the screen: a strip at the top with its height kept
  //    free on phones, in the rail's corner on a wider screen (see css() below).
  // 2. A new record whose answer was lost (POST, dropped connection or timeout) is looked for once: one GET of the
  //    screen's own list (the last list of that address this screen read), compared with that list as it was before
  //    the save. The error then carries x.landed = true (saved) / false (not saved) / undefined (cannot tell), and
  //    E.saveFailText words it. "Not saved" is said only when it is certain: the request never left (the browser was
  //    offline), or the list covers the record's dates and gained no new row. A row only counts as this record when
  //    every field sent that the row has is equal (a strict match). Anything less sure: "We could not tell".
  // 3. Pressing Save again with exactly the same thing, after an answer was lost, first looks in the list again (one
  //    GET): already there, it is not sent ("It was saved already"), so a retry can never make a double. Nothing is
  //    ever sent again by itself. E.postOnce screens use their own list (E.postOnce below sets x.landed).
  // 4. Back online, the screen on show reads its list once: a screen that registered E.onReconnect(load) runs it;
  //    otherwise a screen that nobody has touched since it opened is drawn again (scroll and height kept). A screen
  //    with something typed, or a save that just failed, is left as it is.
  // Emergency POS keeps its own offline queue: /emergency-pos/* is never checked, guarded or held back here.
  (function () {
    var SKIP = /^\/(emergency-pos|auth|client-log)(\/|$)/;
    var lists = {}, wrote = {}, lost = {}, hook = null, renderedAt = 0, touched = false;
    var inner = E.apiFetch;
    function base(p) { return String(p || "").split("?")[0]; }
    function on() { return !(E.isUi2 && E.isUi2()) ? false : true; }
    function rowsOf(j) {
      if (Array.isArray(j)) return j;
      if (!j || typeof j !== "object") return null;
      var ks = Object.keys(j).filter(function (k) { return Array.isArray(j[k]) && j[k].every(function (r) { return r && typeof r === "object" && !Array.isArray(r); }); });
      if (ks.length === 1) return j[ks[0]];
      var pref = ["entries", "items", "rows", "orders", "records", "list"].filter(function (k) { return ks.indexOf(k) >= 0; });
      return pref.length === 1 ? j[pref[0]] : null;
    }
    function empty(v) { return v === null || v === undefined || v === ""; }
    function num(v) { return (typeof v === "number" && isFinite(v)) || (typeof v === "string" && /^-?\d+(\.\d+)?$/.test(v.trim())); }
    function eq(a, b) {
      if (empty(a) || empty(b)) return empty(a) && (empty(b) || b === 0 || (typeof b === "string" && !b.trim())); // left empty: stored empty, or 0 for a number
      if (typeof a === "boolean") return b === a || String(b) === (a ? "1" : "0") || String(b) === String(a);
      if (num(a) && num(b)) return Number(a) === Number(b);
      return String(a).trim() === String(b).trim();
    }
    function prim(body) { return Object.keys(body).filter(function (k) { var v = body[k]; return v === null || /^(string|number|boolean)$/.test(typeof v); }); }
    function same(row, body) { // every field sent that the row has is equal, and the row has at least half of what was sent
      var keys = prim(body), have = keys.filter(function (k) { return Object.prototype.hasOwnProperty.call(row, k); });
      var filled = keys.filter(function (k) { return !empty(body[k]); }), filledHave = have.filter(function (k) { return !empty(body[k]); });
      if (!filledHave.length || filledHave.length * 2 < filled.length) return false;
      return have.every(function (k) { return eq(body[k], row[k]); });
    }
    function covers(url, body, rows) { // would a record with these dates be in this list?
      var dates = prim(body).map(function (k) { return String(body[k] == null ? "" : body[k]); }).filter(function (v) { return /^\d{4}-\d{2}-\d{2}$/.test(v); });
      var q; try { q = new URL(url, "http://x").searchParams; } catch (e) { return false; }
      var ok = true, any = false;
      q.forEach(function (v, k) {
        any = true;
        if (k === "month") ok = ok && /^\d{4}-\d{2}$/.test(v) && dates.length > 0 && dates.every(function (d) { return d.slice(0, 7) === v; });
        else if (k === "date" || k === "day") ok = ok && dates.length > 0 && dates.every(function (d) { return d === v; });
        else if (k === "from" || k === "to") ok = ok && dates.length > 0 && dates.every(function (d) { return d >= (q.get("from") || "") && (!q.get("to") || d < q.get("to")); });
        else ok = false; // a filter we cannot read (status, search, a page): not sure the record would show
      });
      if (any || !ok) return ok;
      if (!dates.length) return true;
      return dates.every(function (d) { return rows.some(function (r) { return Object.keys(r).some(function (k) { return typeof r[k] === "string" && r[k].slice(0, 7) === d.slice(0, 7); }); }); });
    }
    // The screen's own list for this record: the newest one read that would show it, else the newest one read.
    function pick(by, body) {
      var all = Object.keys(by || {}).map(function (k) { return by[k]; }).sort(function (a, b) { return b.at - a.at; });
      return all.filter(function (sn) { return covers(sn.url, body, sn.rows); })[0] || all[0] || null;
    }
    // true: it is in the list; false: certainly not; undefined: cannot tell. One GET.
    async function look(rec) {
      var snap = rec.snap; if (!snap || (wrote[rec.base] || 0) > snap.at) return undefined;
      var j; try { j = await inner(snap.url, { method: "GET", retry: false, timeoutMs: 8000 }); } catch (e) { return undefined; }
      var now = rowsOf(j), was = snap.rows; if (!now) return undefined;
      var ids = was.concat(now).every(function (r) { return r.id != null; });
      if (ids) {
        var old = {}; was.forEach(function (r) { old[String(r.id)] = 1; });
        var fresh = now.filter(function (r) { return !old[String(r.id)]; });
        if (fresh.some(function (r) { return same(r, rec.body); })) return true;
        return !fresh.length && rec.sure && covers(snap.url, rec.body, was.concat(now)) ? false : undefined;
      }
      var c0 = was.filter(function (r) { return same(r, rec.body); }).length, c1 = now.filter(function (r) { return same(r, rec.body); }).length;
      if (c1 > c0) return true;
      return c1 === c0 && now.length === was.length && rec.sure && covers(snap.url, rec.body, was.concat(now)) ? false : undefined;
    }
    E.apiFetch = async function (path, options) {
      var o = options || {}, m = String(o.method || "GET").toUpperCase(), b = base(path);
      if (!on() || SKIP.test(b) || /^https?:/i.test(String(path))) return inner.apply(this, arguments);
      if (m === "GET") {
        var mod = E.state.activeModuleId, r0 = await inner.apply(this, arguments);
        var rows = r0 && r0.ok !== false ? rowsOf(r0) : null;
        if (rows && mod === E.state.activeModuleId) { var by = lists[b] = lists[b] || {}; by[String(path)] = { url: String(path), at: Date.now(), rows: rows.slice() }; }
        return r0;
      }
      if (m !== "POST" || o.landCheck === false || typeof o.body !== "string") return inner.apply(this, arguments);
      var body = null; try { body = JSON.parse(o.body); } catch (eB) {} if (!body || typeof body !== "object" || Array.isArray(body)) return inner.apply(this, arguments);
      var key = b + "\n" + o.body, prev = lost[key];
      if (prev && Date.now() - prev.at < 30 * 60000 && await look(prev) === true) { // the same thing again after a lost answer: it is already there
        var dup = new Error("It was saved already: it is in the list."); dup.alreadySaved = true; dup.status = 409; throw dup;
      }
      var wasOff = navigator.onLine === false, snap = pick(lists[b], body);
      try {
        var r = await inner.apply(this, arguments);
        if (r && r.ok !== false) { wrote[b] = Date.now(); delete lost[key]; }
        return r;
      } catch (x) {
        if (!(x && x.network)) throw x;
        if (wasOff) { x.notSent = true; x.landed = false; delete lost[key]; throw x; } // offline when pressed: it never left
        var rec = prev || { base: b, body: body, snap: snap, at: Date.now() };
        rec.sure = !/timed out/i.test(String(x.message || "")); // a timeout may still be saved later: never "not saved"
        lost[key] = rec;
        await new Promise(function (res) { setTimeout(res, 600); }); // a moment for a save already on its way
        x.landed = await look(rec);
        throw x;
      }
    };
    // The screen on show can give its list reader: called once when the connection returns (replaced per screen).
    E.onReconnect = function (fn) { hook = { mod: E.state.activeModuleId, fn: fn }; };
    // A create whose answer was lost but which is in the list counts as saved: E.apiFetch(...).catch(E.landedOk).
    // Only for a screen that needs nothing from the answer but ok (the answer itself was lost).
    E.landedOk = function (x) { if (x && (x.landed === true || x.alreadySaved)) return { ok: true, recovered: true }; throw x; };
    function wrapRender() { // the router is defined further down this file: wrapped once it exists
      var render = E.renderActiveModule; if (!render || render._net) return;
      E.renderActiveModule = function () {
        var mod = E.state.activeModuleId; hook = null; touched = false; renderedAt = Date.now();
        if (mod !== E.getHashModuleId()) lists = {}; // another screen: its lists are not this one's
        return render.apply(this, arguments);
      };
      E.renderActiveModule._net = true;
    }
    Promise.resolve().then(wrapRender);
    ["pointerdown", "keydown", "input"].forEach(function (t) {
      document.addEventListener(t, function (ev) { var c = document.getElementById("eikon-content"); if (c && ev.target && c.contains(ev.target)) touched = true; }, true);
    });
    function dirty(c) {
      return Array.prototype.some.call(c.querySelectorAll("input,textarea,select"), function (el) {
        if (el.type === "hidden" || el.type === "search") return false;
        if (el.tagName === "SELECT") return Array.prototype.some.call(el.options, function (op) { return op.selected !== op.defaultSelected; }) && el.selectedIndex !== 0;
        if (/^(checkbox|radio)$/.test(el.type)) return el.checked !== el.defaultChecked;
        return el.value !== el.defaultValue;
      });
    }
    function refresh() {
      var c = document.getElementById("eikon-content"); if (!c || !E.state.user || !on()) return;
      if (hook && hook.mod === E.state.activeModuleId) { try { var p = hook.fn(); if (p && p.catch) p.catch(function () {}); } catch (e) {} return; }
      if (touched || (E._saveFailedAt || 0) > renderedAt || dirty(c)) return; // something of theirs is on the screen: leave it
      var y = window.scrollY, h = c.offsetHeight; c.style.minHeight = h + "px";
      Promise.resolve(E.renderActiveModule()).catch(function () {}).then(function () { c.style.minHeight = ""; try { window.scrollTo(0, y); } catch (e) {} });
    }
    // ---- the banner ----
    var bar = null, hideT = 0, off = false;
    function css() {
      if (document.getElementById("eikon-net-style")) return;
      var st = document.createElement("style"); st.id = "eikon-net-style";
      st.textContent =
        // Phones and the classic layout: a slim strip at the very top whose height the page keeps free (body padding),
        // so it never sits over a field or a button; scrolling to a field leaves it clear (scroll-padding).
        // New layout on a wider screen: in the rail's bottom corner, beside the screen, never over it (nothing moves).
        ".eikon-net{position:fixed;left:0;right:0;top:0;z-index:999998;pointer-events:none;display:flex;justify-content:center;align-items:flex-end;box-sizing:border-box;height:calc(32px + env(safe-area-inset-top,0px));padding:env(safe-area-inset-top,0px) 16px 0;background:#1b2332;color:#fff}" +
        ".eikon-net span{display:inline-flex;align-items:center;gap:8px;height:32px;font:600 14px/20px system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%}" +
        ".eikon-net span::before{content:'';width:8px;height:8px;border-radius:4px;background:#f5b94a;flex:none}" +
        ".eikon-net.back span::before{background:#43d17a}" +
        ".eikon-net:empty{display:none}" +
        "html.eikon-net-on body{padding-top:32px}" +
        "html.eikon-net-on{scroll-padding-top:44px}" +
        "@media (min-width:761px){html[data-ui2] .eikon-net{top:auto;right:auto;left:12px;bottom:12px;width:212px;height:auto;padding:0;background:none;display:block}" +
        "html[data-ui2] .eikon-net span{display:flex;align-items:flex-start;height:auto;padding:8px 12px;border-radius:12px;background:#1b2332;white-space:normal;line-height:18px;box-shadow:0 6px 20px rgba(0,0,0,.18)}" +
        "html[data-ui2] .eikon-net span::before{margin-top:5px}" +
        "html[data-ui2].eikon-net-on body{padding-top:0}html[data-ui2].eikon-net-on{scroll-padding-top:0}}" +
        "@media print{.eikon-net{display:none}}";
      document.head.appendChild(st);
    }
    function ensure() {
      if (bar && bar.isConnected) return bar;
      css(); bar = document.createElement("div"); bar.id = "eikon-net"; bar.className = "eikon-net"; bar.setAttribute("role", "status"); bar.setAttribute("aria-live", "polite");
      document.body.appendChild(bar); return bar;
    }
    function say(text, back) {
      var el = ensure(); clearTimeout(hideT);
      el.classList.toggle("back", !!back);
      el.innerHTML = text ? "<span></span>" : ""; if (text) el.firstChild.textContent = text;
      document.documentElement.classList.toggle("eikon-net-on", !!text);
    }
    function goneOff() { if (off) return; off = true; say("No connection — what you type is kept"); }
    function backOn() {
      if (!off) return; off = false; say("Back online", true);
      hideT = setTimeout(function () { say(""); }, 4000);
      setTimeout(refresh, 0); // once
    }
    E._netBanner = { off: goneOff, on: backOn };
    window.addEventListener("offline", goneOff);
    window.addEventListener("online", backOn);
    function start() { ensure(); if (navigator.onLine === false) goneOff(); }
    if (document.body) start(); else document.addEventListener("DOMContentLoaded", start);
  })();
  // ==== end of item 8 ============================================================================================
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
      var lit = id === active || (E.UI2_PARENT && E.UI2_PARENT[active] === id);
      b.classList.toggle("active", lit);
      if (b.classList.contains("eikon-rail-btn")) { if (lit) b.setAttribute("aria-current", "page"); else b.removeAttribute("aria-current"); } // a screen reader hears which tab you are on, not only sees the tint
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

  // ─── Sign-in sheets (backlog 2 item 4): forced password change and the idle lock ─────────────────────────
  // One full-screen sheet over everything: role=dialog, focus kept inside, everything behind inert and hidden
  // from screen readers, and opaque so nothing behind can be read. What was typed behind it stays in the page.
  E._signSheet = (function () {
    var el = null, held = [];
    function css() {
      if (document.getElementById("eikon-sheet-css")) return;
      var st = document.createElement("style"); st.id = "eikon-sheet-css";
      st.textContent =
        ".eks{position:fixed;inset:0;z-index:2147483000;background:var(--bg,#F2F2F7);color:var(--text,#000);display:flex;align-items:center;justify-content:center;padding:16px;overflow:auto;font-family:inherit}" +
        ".eks-card{width:100%;max-width:400px;background:var(--panel2,#fff);border:1px solid var(--border,rgba(0,0,0,.12));border-radius:16px;padding:22px 20px}" +
        ".eks h2{font-size:22px;font-weight:800;letter-spacing:-.02em;margin:0 0 6px}.eks p{margin:0 0 14px;font-size:14.5px;line-height:1.45;color:var(--muted,#555)}" +
        ".eks label{display:block;font-size:13px;font-weight:600;margin:12px 0 5px;color:var(--text,#000)}" +
        ".eks input{width:100%;box-sizing:border-box;height:44px;border:1px solid var(--border,rgba(0,0,0,.2));border-radius:10px;background:var(--panel,#fff);color:var(--text,#000);font:inherit;font-size:16px;padding:0 12px}" +
        ".eks input:focus,.eks button:focus-visible{outline:3px solid rgba(10,143,106,.55);outline-offset:1px}" +
        ".eks-acts{display:flex;gap:10px;justify-content:space-between;align-items:center;margin-top:18px;flex-wrap:wrap}" +
        ".eks button{font:inherit;font-size:15px;font-weight:600;min-height:44px;padding:0 18px;border-radius:22px;border:1px solid var(--border,rgba(0,0,0,.2));background:var(--panel2,#fff);color:var(--text,#000);cursor:pointer}" +
        ".eks button.p{background:var(--accent,#0A8F6A);border-color:var(--accent,#0A8F6A);color:#fff}.eks button.t{border:0;background:none;color:var(--accent,#0A8F6A);padding:0 4px}.eks button:disabled{opacity:.6}" +
        ".eks-err{color:var(--danger,#B42318);font-size:13.5px;margin-top:10px;min-height:1px}.eks-who{font-weight:700;color:var(--text,#000)}" +
        ".eks-caps{font-size:13px;font-weight:600;color:var(--text,#000);margin-top:8px;min-height:1px}.eks label.eks-show{display:flex;align-items:center;gap:10px;min-height:44px;margin:4px 0 0;font-weight:500;font-size:14px}.eks label.eks-show input{width:20px;height:20px;margin:0}" +
        // light accents in the dark looks need dark text (as the new layout's own buttons): the classic look is always dark
        "html:not([data-ui2]) .eks button.p{color:#06121F}@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .eks button.p{color:#00160E}}";
      document.head.appendChild(st);
    }
    function trap(e) {
      if (!el) return;
      if (e.key !== "Tab") return;
      var f = Array.prototype.filter.call(el.querySelectorAll("input,button,select,textarea,[tabindex]:not([tabindex='-1'])"), function (x) { return !x.disabled && x.offsetParent !== null; });
      if (!f.length) return;
      var first = f[0], last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }
    function keepIn(e) { if (el && !el.contains(e.target)) { try { var i = el.querySelector("input,button"); if (i) i.focus(); } catch (x) {} } }
    function open(labelledBy, html) {
      css();
      close();
      el = document.createElement("div");
      el.className = "eks"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", labelledBy);
      el.innerHTML = html;
      Array.prototype.forEach.call(document.body.children, function (c) {
        if (c === el || c.tagName === "SCRIPT" || c.tagName === "STYLE") return;
        held.push({ c: c, inert: c.inert, aria: c.getAttribute("aria-hidden") });
        c.inert = true; c.setAttribute("aria-hidden", "true");
      });
      document.body.appendChild(el);
      // A password typed with Caps Lock on is the commonest reason it is "not right": say so while it is on.
      var caps = el.querySelector(".eks-caps");
      if (caps) { var watch = function (e) { if (e.target && e.target.type === "password" && e.getModifierState) { var w = e.getModifierState("CapsLock") ? "Caps Lock is on." : ""; if (caps.textContent !== w) caps.textContent = w; } }; el.addEventListener("keydown", watch); el.addEventListener("keyup", watch); }
      document.addEventListener("keydown", trap, true);
      document.addEventListener("focusin", keepIn, true);
      return el;
    }
    function close() {
      if (!el) return;
      document.removeEventListener("keydown", trap, true);
      document.removeEventListener("focusin", keepIn, true);
      try { el.remove(); } catch (e) {}
      el = null;
      held.forEach(function (h) { h.c.inert = !!h.inert; if (h.aria == null) h.c.removeAttribute("aria-hidden"); else h.c.setAttribute("aria-hidden", h.aria); });
      held = [];
    }
    return { open: open, close: close, isOpen: function () { return !!el; }, el: function () { return el; } };
  })();

  // A sign-in the pharmacy's admin made or reset (user.must_change, from the server) sets its own password before
  // the app draws. Existing accounts never have the flag, so they never see this. Resolves when changed.
  E.forcePasswordChange = function (user) {
    return new Promise(function (resolve) {
      var name = (user && (user.full_name || user.email)) || "";
      var sh = E._signSheet.open("eks-fc-t",
        '<form class="eks-card" id="eks-fc" novalidate autocomplete="on">' +
        '<input type="text" name="username" autocomplete="username" value="' + E.escapeHtml((user && user.email) || "") + '" style="position:absolute;left:-9999px" tabindex="-1" aria-hidden="true">' +
        '<h2 id="eks-fc-t">Choose your own password</h2>' +
        '<p>Welcome, <span class="eks-who">' + E.escapeHtml(name) + '</span>. You signed in with a temporary password. Choose one only you know; it is used every time you sign in.</p>' +
        '<label for="eks-fc-cur">Temporary password</label><input id="eks-fc-cur" type="password" autocomplete="current-password">' +
        '<label for="eks-fc-n1">New password (10 characters or more)</label><input id="eks-fc-n1" type="password" autocomplete="new-password">' +
        '<label for="eks-fc-n2">New password again</label><input id="eks-fc-n2" type="password" autocomplete="new-password">' +
        '<label class="eks-show"><input type="checkbox" id="eks-fc-show"> Show the passwords</label>' +
        '<div class="eks-caps" aria-live="polite"></div><div class="eks-err" id="eks-fc-err" role="alert"></div>' +
        '<div class="eks-acts"><button type="button" class="t" id="eks-fc-out">Sign out</button><button type="submit" class="p" id="eks-fc-go">Save and continue</button></div></form>');
      var f = sh.querySelector("#eks-fc"), err = sh.querySelector("#eks-fc-err"), go = sh.querySelector("#eks-fc-go");
      function v(id) { return (sh.querySelector("#" + id) || {}).value || ""; }
      sh.querySelector("#eks-fc-out").addEventListener("click", function () { E._signSheet.close(); E.logout(); });
      sh.querySelector("#eks-fc-show").addEventListener("change", function () { var t = this.checked ? "text" : "password"; ["eks-fc-cur", "eks-fc-n1", "eks-fc-n2"].forEach(function (id) { var i = sh.querySelector("#" + id); if (i) i.type = t; }); });
      function bad(id, text) { err.textContent = text; var i = sh.querySelector("#" + id); if (i) { i.focus(); try { i.select(); } catch (e0) {} } } // say it, and put the cursor where the fix is
      f.addEventListener("submit", async function (e) {
        e.preventDefault();
        var cur = v("eks-fc-cur"), n1 = v("eks-fc-n1"), n2 = v("eks-fc-n2");
        if (!cur) return bad("eks-fc-cur", "Enter the temporary password you were given.");
        if (!n1) return bad("eks-fc-n1", "Choose a new password.");
        if (n1.length < 10) return bad("eks-fc-n1", "The new password needs at least 10 characters. It has " + n1.length + ".");
        if (n1 !== n2) return bad("eks-fc-n2", "The two new passwords do not match. Type it again.");
        go.disabled = true; go.textContent = "Saving…"; err.textContent = "";
        try {
          var r = await E.apiFetch("/auth/change-password", { method: "POST", body: JSON.stringify({ current_password: cur, new_password: n1 }) });
          if (!r || !r.ok) throw new Error((r && r.error) || "Could not change the password");
          if (user) delete user.must_change;
          E._signSheet.close();
          try { E.toast("Password saved. Use it from now on.", "success"); } catch (eT) {}
          resolve();
        } catch (x) {
          go.disabled = false; go.textContent = "Save and continue";
          if (x && x.status === 403) bad("eks-fc-cur", "The temporary password is not right. Check it with whoever gave it to you.");
          else err.textContent = x && x.network ? "Can't reach the server. Check the connection and try again." : String((x && (x.message || x)) || "Could not change the password");
        }
      });
      var first = sh.querySelector("#eks-fc-cur"); if (first) first.focus();
    });
  };

  // Idle lock (Settings › This pharmacy): per browser, off by default. After N quiet minutes a sign-in sheet covers
  // the screen; what was typed stays. The same person carries on with their password; someone else signs in as
  // themselves and the page reloads as them (the previous session is ended on the server).
  E.idleLock = (function () {
    var KEY_MIN = "eikon_idle_lock_min", KEY_AT = "eikon_idle_at", KEY_LOCKED = "eikon_locked", KEY_UID = "eikon_lock_uid";
    var started = false, timer = null, lastWrite = 0, locked = false;
    function ls(k, v) { try { if (v === undefined) return window.localStorage.getItem(k); if (v === null) window.localStorage.removeItem(k); else window.localStorage.setItem(k, String(v)); } catch (e) { return null; } }
    function minutes() { var n = parseInt(ls(KEY_MIN) || "0", 10); return [5, 15, 30].indexOf(n) >= 0 ? n : 0; }
    function now() { return Date.now(); }
    function signedIn() { return !!(E.state && E.state.user && E.getToken()); }
    function activity() {
      if (locked) return;
      var t = now();
      if (t - lastWrite > 2000) { lastWrite = t; ls(KEY_AT, t); }
    }
    function lastActive() { var a = Number(ls(KEY_AT) || 0); return Math.max(a, lastWrite); }
    function check() {
      if (locked || !signedIn()) return false;
      var m = minutes(); if (!m) return false;
      if (ls(KEY_LOCKED) === "1" || now() - lastActive() >= m * 60000) { lock(); return true; }
      return false;
    }
    function lock() {
      if (locked || !signedIn()) return;
      locked = true; ls(KEY_LOCKED, "1");
      var u = E.state.user || {};
      var sh = E._signSheet.open("eks-lk-t",
        '<form class="eks-card" id="eks-lk" novalidate autocomplete="on">' +
        '<h2 id="eks-lk-t">Locked</h2>' +
        '<p>Signed in as <span class="eks-who">' + E.escapeHtml(u.full_name || u.email || "") + '</span>. Enter the password to carry on where you were, or sign in as yourself.</p>' +
        '<label for="eks-lk-email">E-mail</label><input id="eks-lk-email" type="email" autocomplete="username" autocapitalize="none" spellcheck="false" value="' + E.escapeHtml(u.email || "") + '">' +
        '<label for="eks-lk-pass">Password</label><input id="eks-lk-pass" type="password" autocomplete="current-password">' +
        '<div class="eks-caps" aria-live="polite"></div><div class="eks-err" id="eks-lk-err" role="alert"></div>' +
        '<div class="eks-acts"><button type="button" class="t" id="eks-lk-other">Someone else</button><button type="submit" class="p" id="eks-lk-go">Unlock</button></div></form>');
      var f = sh.querySelector("#eks-lk"), err = sh.querySelector("#eks-lk-err"), go = sh.querySelector("#eks-lk-go");
      var em = sh.querySelector("#eks-lk-email"), pw = sh.querySelector("#eks-lk-pass");
      sh.querySelector("#eks-lk-other").addEventListener("click", function () { em.value = ""; pw.value = ""; err.textContent = ""; em.focus(); });
      f.addEventListener("submit", function (e) { e.preventDefault(); unlock(em.value, pw.value, err, go); });
      pw.focus();
    }
    async function unlock(emailIn, pass, err, go) {
      var u = E.state.user || {};
      var email = String(emailIn || "").trim().toLowerCase();
      var pwEl = document.getElementById("eks-lk-pass"), emEl = document.getElementById("eks-lk-email");
      if (!email || !pass) { err.textContent = !email ? "Enter the e-mail you sign in with." : "Enter the password."; var miss = !email ? emEl : pwEl; if (miss) miss.focus(); return; }
      go.disabled = true; go.textContent = "Unlocking…"; err.textContent = "";
      try {
        if (email === String(u.email || "").toLowerCase()) {
          // Same person: the password is checked against this session; nothing else changes.
          var ok = false;
          try { var r = await E.apiFetch("/auth/unlock", { method: "POST", body: JSON.stringify({ password: pass }) }); ok = !!(r && r.ok); }
          catch (x) {
            if (x && x.status === 404) { // a server without /auth/unlock: sign in again as the same person
              var L = await E.apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email: email, password: pass }) });
              if (L && L.ok && L.token) { await endSession(E.getToken()); E.setToken(L.token); ok = true; }
            } else throw x;
          }
          if (!ok) throw new Error("That password is not right.");
          done(u.user_id || u.id);
          if (!document.getElementById("eikon-content")) window.location.reload(); // the session had ended while locked
          return;
        }
        // Someone else: their own session; the previous person's is ended; the page opens as them.
        var L2 = await E.apiFetch("/auth/login", { method: "POST", body: JSON.stringify({ email: email, password: pass }) });
        if (!L2 || !L2.ok || !L2.token) throw new Error("That e-mail and password do not match.");
        var old = E.getToken();
        await endSession(old);
        E.setToken(L2.token);
        done(L2.user && (L2.user.id || L2.user.user_id));
        E._reload();
      } catch (x2) {
        err.textContent = x2 && (x2.status === 401 || x2.status === 403) ? "That e-mail and password do not match." : x2 && x2.status === 429 ? "Too many attempts. Wait 15 minutes and try again." : x2 && x2.network ? "Can't reach the server. Check the connection and try again." : String((x2 && (x2.message || x2)) || "Could not unlock");
        go.disabled = false; go.textContent = "Unlock";
        if (pwEl) { pwEl.focus(); try { pwEl.select(); } catch (e3) {} } // the password is what is usually wrong: ready to type again
      }
    }
    async function endSession(tok) {
      if (!tok) return;
      try { await fetch((E.apiBase || "") + "/auth/logout", { method: "POST", headers: { Authorization: "Bearer " + tok } }); } catch (e) {}
    }
    function done(uid) {
      locked = false; lastWrite = now(); ls(KEY_AT, lastWrite); ls(KEY_UID, uid == null ? "" : uid); ls(KEY_LOCKED, null);
      E._signSheet.close();
    }
    function start() {
      if (started) return; started = true;
      ["keydown", "pointerdown", "pointermove", "wheel", "touchstart", "scroll"].forEach(function (ev) { document.addEventListener(ev, activity, { capture: true, passive: true }); });
      document.addEventListener("visibilitychange", function () { if (!document.hidden) check(); });
      window.addEventListener("storage", function (e) {
        if (e.key === KEY_LOCKED) {
          if (e.newValue === "1") { if (signedIn() && minutes()) lock(); }
          else if (locked) { // unlocked in another tab
            var me = E.state.user || {};
            if (String(ls(KEY_UID) || "") !== String(me.user_id || me.id || "")) { E._reload(); return; }
            locked = false; lastWrite = now(); E._signSheet.close();
          }
        }
      });
      timer = setInterval(check, 15000);
    }
    // At sign-in or page open: count from now, unless the page was already locked or left idle past the limit.
    function afterSignIn(fresh) {
      start();
      if (fresh) { ls(KEY_LOCKED, null); lastWrite = now(); ls(KEY_AT, lastWrite); return; }
      if (!Number(ls(KEY_AT) || 0)) { lastWrite = now(); ls(KEY_AT, lastWrite); }
      check();
    }
    function setMinutes(n) {
      n = [5, 15, 30].indexOf(Number(n)) >= 0 ? Number(n) : 0;
      if (n) ls(KEY_MIN, n); else { ls(KEY_MIN, null); ls(KEY_LOCKED, null); }
      lastWrite = now(); ls(KEY_AT, lastWrite);
    }
    return { minutes: minutes, setMinutes: setMinutes, check: check, lock: lock, afterSignIn: afterSignIn, isLocked: function () { return locked; } };
  })();
  E._reload = function () { window.location.reload(); };

  E.showIdleLockSettings = function () {
    var cur = E.idleLock.minutes();
    var opts = [[0, "Off"], [5, "After 5 minutes"], [15, "After 15 minutes"], [30, "After 30 minutes"]];
    var body = '<fieldset style="border:0;margin:0;padding:0"><legend class="eikon-help" style="margin-bottom:8px">On this computer only. When it locks, what was typed stays on the screen; the same person carries on with their password, or someone else signs in as themselves.</legend>' +
      opts.map(function (o) { return '<label style="display:flex;align-items:center;gap:10px;min-height:40px;font-size:15px"><input type="radio" name="eikon-idle" value="' + o[0] + '"' + (o[0] === cur ? " checked" : "") + '> ' + o[1] + '</label>'; }).join("") + '</fieldset>';
    E.modal.show("Lock when idle", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      { label: "Save", primary: true, onClick: function () {
        var c = document.querySelector('input[name="eikon-idle"]:checked');
        E.idleLock.setMinutes(c ? c.value : 0);
        E.modal.hide();
        E.toast(E.idleLock.minutes() ? "This computer locks after " + E.idleLock.minutes() + " quiet minutes." : "The idle lock is off on this computer.", "success");
      } }
    ]);
  };

  E.logout = function () {
    E.dbg("[auth] logout");
    if (E._supplierPollInterval) { clearInterval(E._supplierPollInterval); E._supplierPollInterval = null; }
    // Revoke the session on the server before forgetting the token locally.
    try { if (E.getToken()) { E.apiFetch("/auth/logout", { method: "POST" }).catch(function () {}); } } catch (e) {}
    try { if (E.draft) E.draft.dropMine(); } catch (e) {} // q5-2: what this person left half-typed goes with them
    E.clearToken();
    try { window.localStorage.removeItem("eikon_locked"); } catch (e) {}
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
    if (leaving && E.draft) { try { E.draft.keep(leaving, content); } catch (eK) {} } // q5-2: a half-typed form is kept for when they come back
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

    var moveFocus = E._focusScreenOpening ? E._focusScreenOpening(content) : false; // focus to the new screen's heading (BACKLOG4 item 2)
    // render module
    content.innerHTML = "";
    E.dbg("[router] render module:", id);

    try {
      await E.modules[id].render({ E: E, mount: content, user: E.state.user });
    } catch (err) {
      E.error("[router] module render error:", err);
      if (E.reportError) E.reportError("render", err, err); // backlog 7
      var msg = String(err && (err.stack || err.message || err));
      content.innerHTML =
        '<div class="eikon-card">' +
        '  <div style="font-weight:900;margin-bottom:8px;">Module crashed</div>' +
        '  <pre style="white-space:pre-wrap;word-break:break-word;margin:0;background:rgba(0,0,0,.25);padding:12px;border-radius:12px;border:1px solid rgba(255,255,255,.08);font-size:12px;line-height:1.4;">' +
        E.escapeHtml(msg) +
        "</pre>" +
        "</div>";
    }
    if (E._focusScreenOpened) E._focusScreenOpened(moveFocus);
  };

  E.bootAuthed = async function () {
    E._sessionExpiredShown = false;
    // The classic look in a page that opened in the new layout: its screens are needed after all.
    if (!E.isUi2()) { try { await E.loadClassic(); } catch (eL) { E.warn("[boot] classic screens did not load:", eL); } }
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
    // "Add Eikon to your home screen": offered once after sign-in, on eikonhq.com in the new layout (eikon.install.js).
    try { if (E.install && E.install.afterSignIn) E.install.afterSignIn(); } catch (eI) {}
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
      if (me.user.must_change) await E.forcePasswordChange(me.user);
      try { E.idleLock.afterSignIn(false); } catch (eI) {}

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
      E.state.user = null;
      // Only the server saying "no" (401) ends the session. A network blip, a timeout or a server error keeps the
      // token: it is shared by every tab and window of this address, and clearing it signed all of them out
      // (the other tabs then showed "Unauthorized" on every refresh).
      if (err && err.status === 401) {
        if (E.getToken() === token) E.clearToken();
        if (!E._sessionExpiredShown) E.renderLogin("Your session has ended. Sign in again.");
        return;
      }
      E.renderStartFailed(err);
    }
  };

  // Could not check the saved session (offline, timeout, server error): say so, keep the session, offer both ways on.
  E.renderStartFailed = function (err) {
    var root = E.ensureRoot();
    var why = (err && err.network) ? "Eikon could not reach the server." : "Eikon could not check your session" + (err && err.status ? " (the server answered " + err.status + ")." : ".");
    root.innerHTML =
      '<div class="eikon-login"><div class="eikon-login-card" id="eikon-start-failed" role="alert">' +
      '<div class="eikon-login-title">Eikon</div>' +
      '<div class="eikon-login-sub">' + E.escapeHtml(why) + ' You are still signed in.</div>' +
      '<div class="eikon-row" style="gap:8px;margin-top:14px">' +
      '<button class="eikon-btn primary" type="button" id="eikon-start-retry">Try again</button>' +
      '<button class="eikon-btn" type="button" id="eikon-start-signin">Sign in again</button></div></div></div>';
    var r = document.getElementById("eikon-start-retry"), si = document.getElementById("eikon-start-signin");
    if (r) r.addEventListener("click", function () { r.disabled = true; r.textContent = "Trying…"; try { location.reload(); } catch (e) {} });
    if (si) si.addEventListener("click", function () { E.clearToken(); E.state.user = null; E.renderLogin(); });
  };

  // Eikon has started once E.start has finished (the first screen, the sign-in or the portal picker is up): from then
  // on an unexpected error is the closable bar, not the full-screen notice (E.showFatalOverlay). A start that fails
  // still rejects as before (main.js does not wait for it), so it reaches the unhandledrejection handler and blocks.
  (function () {
    var start = E.start;
    E.start = function () {
      var r = start.apply(E, arguments);
      return Promise.resolve(r).then(function (v) { E._booted = true; return v; });
    };
  })();

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
