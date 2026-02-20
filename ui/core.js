(function () {
  "use strict";

  // Global singleton
  var E = window.EIKON || {};
  window.EIKON = E;

  // Basic identity
  E.APP_NAME = "Eikon";
  E.VERSION = "2026-02-06-01";

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
    try {
      var d = new Date();
      return d.toISOString();
    } catch (e) {
      return "";
    }
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
      var payload = {
        type: "EIKON_LOG",
        level: level,
        time: ts(),
        msg: args.map(safeToString).join(" ")
      };
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

  E.dbg = function () {
    if (E.DEBUG >= 2) logBase("log", ["[DBG]"].concat(Array.prototype.slice.call(arguments)));
  };

  // Crash logging
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

  E.getToken = function () {
    try { return String(window.localStorage.getItem(E.TOKEN_KEY) || ""); } catch (e) { return ""; }
  };
  E.setToken = function (t) {
    try { window.localStorage.setItem(E.TOKEN_KEY, String(t || "")); } catch (e) {}
  };
  E.clearToken = function () {
    try { window.localStorage.removeItem(E.TOKEN_KEY); } catch (e) {}
  };

  // API base (same-origin, because UI is served by the Worker)
  E.apiBase = "";

  // Fetch wrapper with heavy debugging
  E.apiFetch = async function (path, options) {
    var opts = options || {};
    var method = (opts.method || "GET").toUpperCase();
    var headers = new Headers(opts.headers || {});
    var token = E.getToken();

    if (!headers.has("Content-Type") && opts.body && typeof opts.body === "string") {
      // Caller may already have JSON string
      headers.set("Content-Type", "application/json");
    }

    if (token) headers.set("Authorization", "Bearer " + token);

    var url = path;
    if (!/^https?:\/\//i.test(path)) url = (E.apiBase || "") + path;

    var reqInfo = {
      method: method,
      headers: {},
      hasToken: !!token
    };
    try {
      headers.forEach(function (v, k) { reqInfo.headers[k] = v; });
    } catch (e) {}

    if (E.DEBUG >= 2) {
      E.dbg("[api] ->", url, reqInfo);
      if (opts.body) E.dbg("[api] body ->", opts.body);
    } else {
      E.log("[api] ->", method, url);
    }

    var res, text, json;
    try {
      res = await fetch(url, {
        method: method,
        headers: headers,
        body: opts.body || undefined
      });
    } catch (e2) {
      E.error("[api] network error:", e2);
      throw e2;
    }

    var ct = "";
    try { ct = String(res.headers.get("Content-Type") || ""); } catch (e3) {}

    try {
      text = await res.text();
    } catch (e4) {
      text = "";
    }

    // Try parse JSON
    json = null;
    if (ct.toLowerCase().indexOf("application/json") >= 0) {
      try { json = JSON.parse(text || "null"); } catch (e5) { json = null; }
    } else {
      // Sometimes your API may still return JSON without correct CT
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

  // UI mounts
  E.state = {
    user: null,
    activeModuleId: "",
    sidebarCollapsed: false,
    started: false
  };

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
        '<div style="width:min(920px,100%);background:#111b2a;border:1px solid #263246;border-radius:18px;padding:14px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#e9eef7;">' +
        '<div style="font-weight:900;font-size:18px;margin-bottom:8px;">' + E.escapeHtml(title || "Eikon crashed") + "</div>" +
        '<div style="opacity:.85;margin-bottom:10px;">Open DevTools Console for details. dbg=2 is recommended.</div>' +
        '<pre style="white-space:pre-wrap;background:rgba(0,0,0,.25);padding:12px;border-radius:14px;border:1px solid #263246;margin:0;">' + E.escapeHtml(String(details || "")) + "</pre>" +
        "</div>";
    } catch (e) {}
  };

  // Modal helper
  E.modal = (function () {
    var overlay = null;

    function ensure() {
      if (overlay) return overlay;
      overlay = document.createElement("div");
      overlay.className = "eikon-modal-overlay";
      overlay.innerHTML =
        '<div class="eikon-modal">' +
        '  <div class="eikon-modal-title" id="eikon-modal-title"></div>' +
        '  <div id="eikon-modal-body"></div>' +
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
      overlay.style.display = "none";
    }

    return { show: show, hide: hide };
  })();

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
      '    <div class="eikon-row" style="margin-top:12px;justify-content:flex-end;">' +
      '      <button class="eikon-btn primary" id="eikon-login-btn">Login</button>' +
      "    </div>" +
      (errorText ? ('<div class="eikon-alert">' + E.escapeHtml(errorText) + "</div>") : "") +
      '    <div class="eikon-help" style="margin-top:10px;">Tip: add <span class="eikon-pill">dbg=2</span> to see verbose logs.</div>' +
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
          return E.bootAuthed();
        })
        .catch(function (err) {
          E.error("[auth] login error:", err);
          E.clearToken();
          E.state.user = null;
          E.renderLogin(String(err && (err.message || err.bodyText || err)));
        })
        .finally(function () {
          try { btn.disabled = false; btn.textContent = "Login"; } catch (e) {}
        });
    }

    if (btn) btn.addEventListener("click", doLogin);
    if (passEl) passEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
    if (emailEl) emailEl.addEventListener("keydown", function (e) { if (e.key === "Enter") doLogin(); });
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
      '        <div class="eikon-page-title" id="eikon-page-title">Loading…</div>' +
      "      </div>" +
      '      <div class="eikon-user">' +
      '        <span id="eikon-user-label"></span>' +
      '        <button class="eikon-btn" id="eikon-logout-btn">Logout</button>' +
      "      </div>" +
      "    </div>" +
      '    <div class="eikon-content" id="eikon-content"></div>' +
      "  </main>" +
      "</div>";

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

    // Logout
    var logoutBtn = document.getElementById("eikon-logout-btn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        E.logout();
      });
    }

    // Nav
    E.renderNav();
  };

  E.renderNav = function () {
    var nav = document.getElementById("eikon-nav");
    if (!nav) return;

    var mods = Object.keys(E.modules || {}).map(function (k) { return E.modules[k]; });
    mods.sort(function (a, b) { return (a.order || 999) - (b.order || 999); });

    nav.innerHTML = "";

    mods.forEach(function (m) {
      var btn = document.createElement("button");
      btn.className = "eikon-nav-btn";
      btn.setAttribute("data-mod", m.id);

      var ico = document.createElement("span");
      ico.className = "eikon-nav-ico";
      ico.textContent = (m.icon || "•");

      var label = document.createElement("span");
      label.className = "eikon-nav-label";
      label.textContent = (m.title || m.id);

      btn.appendChild(ico);
      btn.appendChild(label);

      btn.addEventListener("click", function () {
        window.location.hash = "#" + m.id;
      });

      nav.appendChild(btn);
    });

    E.highlightNav();
  };

  E.highlightNav = function () {
    var active = E.state.activeModuleId || "";
    var btns = E.qa(".eikon-nav-btn", document);
    btns.forEach(function (b) {
      var id = b.getAttribute("data-mod") || "";
      b.classList.toggle("active", id === active);
    });
  };

  E.logout = function () {
    E.dbg("[auth] logout");
    E.clearToken();
    E.state.user = null;
    E.state.activeModuleId = "";
    E.renderLogin();
  };

  E.getHashModuleId = function () {
    var h = String(window.location.hash || "").replace(/^#/, "").trim();
    if (!h) return "temperature";
    return h;
  };

  E.renderActiveModule = async function () {
    var content = document.getElementById("eikon-content");
    if (!content) throw new Error("Missing #eikon-content mount");

    var id = E.getHashModuleId();
    if (!E.modules[id]) {
      E.warn("[router] unknown module:", id, "falling back to temperature");
      id = "temperature";
      window.location.hash = "#temperature";
    }

    E.state.activeModuleId = id;
    E.highlightNav();

    var pageTitle = document.getElementById("eikon-page-title");
    if (pageTitle) pageTitle.textContent = (E.modules[id].title || id);

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
      await E.modules[id].render({
        E: E,
        mount: content,
        user: E.state.user
      });
    } catch (err) {
      E.error("[router] module render error:", err);
      var msg = String(err && (err.stack || err.message || err));
      content.innerHTML =
        '<div class="eikon-card">' +
        '  <div style="font-weight:900;font-size:16px;color:var(--danger);margin-bottom:8px;">Module crashed: ' + E.escapeHtml(id) + "</div>" +
        '  <pre style="white-space:pre-wrap;margin:0;background:rgba(0,0,0,.25);padding:12px;border-radius:14px;border:1px solid var(--border);">' +
        E.escapeHtml(msg) +
        "</pre>" +
        "</div>";
    }
  };

  E.bootAuthed = async function () {
    E.renderShell();
    await E.renderActiveModule();
  };

  E.start = async function () {
    if (E.state.started) return;
    E.state.started = true;

    E.dbg("[core] start()");

    // If hash missing, default
    if (!window.location.hash) window.location.hash = "#temperature";

    // Router
    window.addEventListener("hashchange", function () {
      E.dbg("[router] hashchange:", window.location.hash);
      if (!E.state.user) return; // if not logged, ignore
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
      await E.bootAuthed();
    } catch (err) {
      E.error("[auth] /auth/me failed:", err);
      E.clearToken();
      E.state.user = null;
      E.renderLogin("Session invalid. Please login again.\n" + String(err && (err.message || err.bodyText || err)));
    }
  };

})();
