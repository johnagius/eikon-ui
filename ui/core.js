(function () {
  "use strict";

  // Global singleton
  var E = window.EIKON || {};
  window.EIKON = E;

  // Basic identity
  E.APP_NAME = "Eikon";
  E.VERSION = "2026-02-20-05";

  // Splash / loading assets (static files under /ui/assets/)
  // Put these two files in: ui/assets/
  //   - eikon-logo.png
  //   - eikon-intro.gif
  E.SPLASH = {
    logoUrl: "./assets/eikon-logo.png?v=" + encodeURIComponent(E.VERSION),
    introGifUrl: "./assets/eikon-intro.gif?v=" + encodeURIComponent(E.VERSION),
    introMs: 4930
  };

  // Intro can be disabled by adding ?intro=0 to the iframe URL
  E.isIntroEnabled = function () {
    try {
      var u = new URL(window.location.href);
      var v = String(u.searchParams.get("intro") || "").trim().toLowerCase();
      if (v === "0" || v === "false" || v === "off" || v === "no") return false;
      return true;
    } catch (e) {
      return true;
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
      var payload = { type: "EIKON_LOG", level: level, time: ts(), msg: args.map(safeToString).join(" ") };
      window.parent.postMessage(payload, "*");
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

    var reqInfo = { method: method, headers: {}, hasToken: !!token };
    try { headers.forEach(function (v, k) { reqInfo.headers[k] = v; }); } catch (e) {}

    if (E.DEBUG >= 2) {
      E.dbg("[api] ->", url, reqInfo);
      if (opts.body) E.dbg("[api] body ->", opts.body);
    } else {
      E.log("[api] ->", method, url);
    }

    var res, text, json;
    try {
      res = await fetch(url, { method: method, headers: headers, body: opts.body || undefined });
    } catch (e2) {
      E.error("[api] network error:", e2);
      throw e2;
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

  // Module registry
  E.modules = E.modules || {};
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

  // Sidebar categories for Company Admin section (empty for now)
  E.COMPANY_ADMIN_CATEGORIES = [];

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
  E.renderLogin = function (errorText) {
    var root = E.ensureRoot();
    root.innerHTML =
      '<div class="eikon-login">' +
      '  <div class="eikon-login-card">' +
      '    <div class="eikon-login-title">Eikon</div>' +
      '    <div class="eikon-login-sub">Sign in to continue</div>' +
      '    <div class="eikon-row">' +
      '      <div class="eikon-field" style="flex:1;min-width:220px;">' +
      '        <div class="eikon-label">Email</div>' +
      '        <input class="eikon-input" id="eikon-login-email" type="email" autocomplete="username" />' +
      "      </div>" +
      '      <div class="eikon-field" style="flex:1;min-width:220px;">' +
      '        <div class="eikon-label">Password</div>' +
      '        <input class="eikon-input" id="eikon-login-pass" type="password" autocomplete="current-password" />' +
      "      </div>" +
      "    </div>" +
      '    <div style="margin-top:12px;display:flex;justify-content:flex-end;gap:10px;">' +
      '      <button class="eikon-btn primary" id="eikon-login-btn">Login</button>' +
      "    </div>" +
      (errorText ? ('<div class="eikon-alert">' + E.escapeHtml(errorText) + "</div>") : "") +
      '<div class="eikon-help" style="margin-top:10px;">Tip: add dbg=2 to see verbose logs.</div>' +
      "  </div>" +
      "</div>";

    var emailEl = document.getElementById("eikon-login-email");
    var passEl = document.getElementById("eikon-login-pass");
    var btn = document.getElementById("eikon-login-btn");

    if (emailEl) emailEl.focus();

    function doLogin() {
      var email = (emailEl ? emailEl.value : "").trim().toLowerCase();
      var pass = (passEl ? passEl.value : "").trim();

      E.dbg("[auth] login attempt:", email);
      if (!email || !pass) {
        E.renderLogin("Missing email or password");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Logging in…";

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
          return E.renderRoleSelection(roles);
        })
        .catch(function (err) {
          E.error("[auth] login error:", err);
          E.clearToken();
          E.state.user = null;
          E.renderLogin(String(err && (err.message || err.bodyText || err)));
        })
        .finally(function () {
          try {
            btn.disabled = false;
            btn.textContent = "Login";
          } catch (e) {}
        });
    }

    if (btn) btn.addEventListener("click", doLogin);
    if (passEl) passEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    if (emailEl) emailEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });

    // Login is a "screen done" condition for the intro
    E.markIntroScreenDone();
  };

  // Role Selection Screen
  E.renderRoleSelection = function (accessibleRoles) {
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
      E._sectionDashboardId = "dashboard";
      return E.bootAuthed();
    } else if (role === E.ROLE_SUPPLIER) {
      return E.bootSection("supplier");
    } else if (role === E.ROLE_COMPANY_ADMIN) {
      return E.bootSection("company_admin");
    }
  };

  // Boot a non-pharmacy section
  E.bootSection = async function (section) {
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

    window.location.hash = "#" + E._sectionDashboardId;
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
      '        <img id="eikon-topbar-logo" alt="Eikon" style="height:26px;width:auto;display:block;filter:drop-shadow(0 1px 2px rgba(0,0,0,.35));" />' +
      '        <div class="eikon-page-title" id="eikon-page-title"><span id="eikon-page-title-text">Loading…</span></div>' +
      "      </div>" +
      '      <div class="eikon-user">' +
      '        <span id="eikon-user-label"></span>' +
      '        <button class="eikon-btn" id="eikon-switch-portal-btn" style="display:none;">Switch Portal</button>' +
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
          var h = window.location.hash || "";
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
          return (m.title || m.id).toLowerCase().indexOf(q) !== -1;
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

  E.highlightNav = function () {
    var active = E.state.activeModuleId || "";
    var btns = E.qa(".eikon-nav-btn", document);
    btns.forEach(function (b) {
      var id = b.getAttribute("data-mod") || "";
      b.classList.toggle("active", id === active);
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
    E._supplierPollInterval = setInterval(poll, 30000);
  };

  E.logout = function () {
    E.dbg("[auth] logout");
    if (E._supplierPollInterval) { clearInterval(E._supplierPollInterval); E._supplierPollInterval = null; }
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
    var h = String(window.location.hash || "").replace(/^#/, "").trim();
    var fallback = E._sectionDashboardId || "dashboard";
    if (!h) return fallback;
    return h;
  };

  E.renderActiveModule = async function () {
    var content = document.getElementById("eikon-content");
    if (!content) throw new Error("Missing #eikon-content mount");

    var fallbackDash = E._sectionDashboardId || "dashboard";
    var id = E.getHashModuleId();
    if (!E.modules[id]) {
      E.warn("[router] unknown module:", id, "falling back to", fallbackDash);
      id = fallbackDash;
      window.location.hash = "#" + fallbackDash;
    }

    E.state.activeModuleId = id;
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
    window.location.hash = "#" + (E._sectionDashboardId || "dashboard");
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
    if (!window.location.hash) window.location.hash = "#dashboard";

    // Router
    window.addEventListener("hashchange", function () {
      E.dbg("[router] hashchange:", window.location.hash);
      if (!E.state.user) return;
      E.renderActiveModule();
    });

    // Try authed boot
    var token = E.getToken();
    if (!token) {
      E.dbg("[auth] no token -> login screen");
      E.renderLogin();
      return;
    }

    E.dbg("[auth] token present, checking /auth/me …");
    try {
      var me = await E.apiFetch("/auth/me", { method: "GET" });
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

})();
