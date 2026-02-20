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
    if (E.DEBUG >= 2) logBase("log", ["[dbg]"].concat(Array.prototype.slice.call(arguments)));
  };

  // Root
  E.ensureRoot = function () {
    var root = document.getElementById("eikon-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "eikon-root";
      document.body.appendChild(root);
    }
    return root;
  };

  // Simple state
  E.state = E.state || {
    token: null,
    user: null,
    module: null,
    sidebarCollapsed: false
  };

  // Token
  E.getToken = function () {
    if (E.state.token) return E.state.token;
    try {
      var t = window.localStorage.getItem("eikon_token");
      if (t) E.state.token = String(t);
    } catch (e) {}
    return E.state.token;
  };

  E.setToken = function (tok) {
    E.state.token = tok ? String(tok) : null;
    try {
      if (E.state.token) window.localStorage.setItem("eikon_token", E.state.token);
      else window.localStorage.removeItem("eikon_token");
    } catch (e) {}
  };

  E.clearToken = function () { E.setToken(null); };

  // API base
  E.API_BASE = "https://eikon-api.labrint.workers.dev";

  // Fetch helper
  E.fetchJSON = function (path, opts) {
    opts = opts || {};
    var url = E.API_BASE + path;
    var headers = opts.headers || {};
    headers["Content-Type"] = "application/json";

    var tok = E.getToken();
    if (tok) headers["Authorization"] = "Bearer " + tok;

    var fetchOpts = {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    };

    return fetch(url, fetchOpts).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) {
          var err = new Error("HTTP " + res.status);
          err.status = res.status;
          err.bodyText = txt;
          err.body = data;
          throw err;
        }
        return data;
      });
    });
  };

  // Auth
  E.logout = function () {
    E.clearToken();
    E.state.user = null;
    try { window.location.hash = ""; } catch (e) {}
    E.renderLogin();
  };

  E.boot = function () {
    var tok = E.getToken();
    if (!tok) return E.renderLogin();

    // Try boot as authed
    E.bootAuthed().catch(function (err) {
      E.error("[boot] authed boot failed:", err);
      E.clearToken();
      E.state.user = null;
      E.renderLogin(String(err && (err.message || err.bodyText || err)));
    });
  };

  E.bootAuthed = function () {
    return E.fetchJSON("/api/me", { method: "GET" }).then(function (me) {
      E.state.user = me || null;
      E.renderShell();
      E.route();
      E.startHashListener();
    });
  };

  // Login UI
  E.renderLogin = function (errMsg) {
    var root = E.ensureRoot();
    root.innerHTML =
      '<div class="eikon-login">' +
      '  <div class="eikon-login-card">' +
      '    <div class="eikon-login-title">Eikon</div>' +
      '    <div class="eikon-login-sub">Sign in</div>' +
      (errMsg ? ('<div class="eikon-login-error">' + E.escapeHtml(errMsg) + "</div>") : "") +
      '    <div class="eikon-login-row">' +
      '      <label>Email</label>' +
      '      <input id="eikon-login-email" type="email" autocomplete="username" />' +
      "    </div>" +
      '    <div class="eikon-login-row">' +
      '      <label>Password</label>' +
      '      <input id="eikon-login-pass" type="password" autocomplete="current-password" />' +
      "    </div>" +
      '    <button class="eikon-btn primary" id="eikon-login-btn">Login</button>' +
      "  </div>" +
      "</div>";

    var btn = document.getElementById("eikon-login-btn");
    var emailEl = document.getElementById("eikon-login-email");
    var passEl = document.getElementById("eikon-login-pass");

    function doLogin() {
      var email = emailEl ? String(emailEl.value || "").trim() : "";
      var pass = passEl ? String(passEl.value || "") : "";
      if (!email || !pass) {
        E.renderLogin("Email and password required");
        return;
      }

      try { btn.disabled = true; btn.textContent = "Signing in…"; } catch (e) {}

      E.fetchJSON("/api/login", {
        method: "POST",
        body: { email: email, password: pass }
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
      '        <button class="eikon-btn eikon-btn-icon" id="eikon-embed-expand-btn" type="button" title="Fullscreen" aria-label="Fullscreen">⤢</button>' +
      '        <button class="eikon-btn eikon-btn-icon" id="eikon-embed-popout-btn" type="button" title="Open in new tab" aria-label="Open in new tab">↗</button>' +
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

    // Embed controls (fullscreen + popout)
    var expandEmbedBtn = document.getElementById("eikon-embed-expand-btn");
    var popoutEmbedBtn = document.getElementById("eikon-embed-popout-btn");

    function _fsEl() {
      return document.fullscreenElement || document.webkitFullscreenElement || document.msFullscreenElement || null;
    }
    function _isFs() { return !!_fsEl(); }

    function _reqFs(el) {
      el = el || document.documentElement;
      var req = el.requestFullscreen || el.webkitRequestFullscreen || el.msRequestFullscreen;
      if (!req) return Promise.reject(new Error("fullscreen API not available"));
      try {
        var out = req.call(el);
        if (out && typeof out.then === "function") return out;
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    }

    function _exitFs() {
      var exit = document.exitFullscreen || document.webkitExitFullscreen || document.msExitFullscreen;
      if (!exit) return Promise.resolve();
      try {
        var out = exit.call(document);
        if (out && typeof out.then === "function") return out;
        return Promise.resolve();
      } catch (e) {
        return Promise.reject(e);
      }
    }

    function _updateEmbedIcons() {
      if (!expandEmbedBtn) return;
      if (_isFs()) {
        expandEmbedBtn.textContent = "⤡";
        expandEmbedBtn.title = "Exit fullscreen";
        expandEmbedBtn.setAttribute("aria-label", "Exit fullscreen");
      } else {
        expandEmbedBtn.textContent = "⤢";
        expandEmbedBtn.title = "Fullscreen";
        expandEmbedBtn.setAttribute("aria-label", "Fullscreen");
      }
    }

    function _openPopout() {
      var href = "";
      try { href = String(window.location.href || ""); } catch (e) { href = ""; }
      if (!href) return;

      try {
        window.open(href, "_blank", "noopener,noreferrer");
      } catch (e2) {
        try { window.location.href = href; } catch (e3) {}
      }
    }

    if (expandEmbedBtn) {
      expandEmbedBtn.addEventListener("click", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (e2) {}

        // Toggle fullscreen. If blocked (common in sandboxed builders), fall back to popout.
        if (_isFs()) {
          _exitFs().then(_updateEmbedIcons, _updateEmbedIcons);
        } else {
          _reqFs(document.documentElement)
            .then(_updateEmbedIcons)
            .catch(function () { _openPopout(); });
        }
      });
    }

    if (popoutEmbedBtn) {
      popoutEmbedBtn.addEventListener("click", function (e) {
        try { e.preventDefault(); e.stopPropagation(); } catch (e2) {}
        _openPopout();
      });
    }

    document.addEventListener("fullscreenchange", _updateEmbedIcons);
    document.addEventListener("webkitfullscreenchange", _updateEmbedIcons);
    document.addEventListener("msfullscreenchange", _updateEmbedIcons);
    _updateEmbedIcons();

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
    var nav = document.getElementById("eikon-nav");
    if (!nav) return;

    var active = (E.state.module || "").toLowerCase();
    var btns = nav.querySelectorAll(".eikon-nav-btn");
    for (var i = 0; i < btns.length; i++) {
      var b = btns[i];
      var mod = String(b.getAttribute("data-mod") || "").toLowerCase();
      b.classList.toggle("active", mod === active);
    }
  };

  E.route = function () {
    var hash = "";
    try { hash = String(window.location.hash || ""); } catch (e) { hash = ""; }
    hash = hash.replace(/^#/, "").trim();

    if (!hash) {
      // default module
      hash = "temperature";
      try { window.location.hash = "#" + hash; } catch (e2) {}
    }

    var mod = E.modules && E.modules[hash];
    if (!mod) {
      E.warn("[route] unknown module:", hash);
      E.renderNotFound(hash);
      return;
    }

    E.state.module = hash;

    var titleEl = document.getElementById("eikon-page-title");
    if (titleEl) titleEl.textContent = mod.title || hash;

    var userEl = document.getElementById("eikon-user-label");
    if (userEl) {
      var u = E.state.user || {};
      var label = "";
      if (u.name) label = String(u.name);
      else if (u.email) label = String(u.email);
      else label = "User";
      userEl.textContent = label;
    }

    E.highlightNav();
    E.renderModule(mod);
  };

  E.renderNotFound = function (hash) {
    var content = document.getElementById("eikon-content");
    if (!content) return;
    content.innerHTML =
      '<div class="eikon-card">' +
      '  <div class="eikon-card-title">Not found</div>' +
      '  <div class="eikon-muted">Unknown module: <b>' + E.escapeHtml(hash) + "</b></div>" +
      "</div>";
  };

  E.renderModule = function (mod) {
    var content = document.getElementById("eikon-content");
    if (!content) return;

    try {
      if (typeof mod.render === "function") mod.render(content);
      else {
        content.innerHTML =
          '<div class="eikon-card">' +
          '  <div class="eikon-card-title">' + E.escapeHtml(mod.title || mod.id) + "</div>" +
          '  <div class="eikon-muted">This module has no render() function.</div>' +
          "</div>";
      }
    } catch (e) {
      E.error("[module] render error:", e);
      content.innerHTML =
        '<div class="eikon-card">' +
        '  <div class="eikon-card-title" style="color:#ff5a7a;">Module crashed</div>' +
        '  <div class="eikon-muted">' + E.escapeHtml(String(e && (e.stack || e.message || e))) + "</div>" +
        "</div>";
    }
  };

  E.startHashListener = function () {
    if (E.__hashListenerStarted) return;
    E.__hashListenerStarted = true;

    window.addEventListener("hashchange", function () {
      E.route();
    });
  };

  // Modules registry
  E.modules = E.modules || {};

  E.registerModule = function (id, def) {
    if (!id) return;
    def = def || {};
    def.id = id;
    E.modules[id] = def;
  };

  // Helpers
  E.escapeHtml = function (s) {
    s = String(s == null ? "" : s);
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  E.fmtDate = function (d) {
    try {
      if (!d) return "";
      var dd = new Date(d);
      if (isNaN(dd.getTime())) return "";
      return dd.toISOString().slice(0, 10);
    } catch (e) {
      return "";
    }
  };

  E.fmtTime = function (d) {
    try {
      if (!d) return "";
      var dd = new Date(d);
      if (isNaN(dd.getTime())) return "";
      return dd.toISOString().slice(11, 16);
    } catch (e) {
      return "";
    }
  };

  E.fmtDT = function (d) {
    try {
      if (!d) return "";
      var dd = new Date(d);
      if (isNaN(dd.getTime())) return "";
      return dd.toISOString().replace("T", " ").slice(0, 16);
    } catch (e) {
      return "";
    }
  };

  // Boot on DOM ready
  function onReady(fn) {
    if (document.readyState === "complete" || document.readyState === "interactive") fn();
    else document.addEventListener("DOMContentLoaded", fn);
  }

  onReady(function () {
    try { E.boot(); } catch (e) { E.error("[boot] crash:", e); }
  });

})();
