(function () {
  "use strict";

  const E = (window.EIKON = window.EIKON || {});
  E.version = "2026-02-06-cleaning-1";
  E.modules = E.modules || {};
  E.state = E.state || {};
  E.cfg = E.cfg || {};

  E.cfg.debug = (localStorage.getItem("eikon_debug") === "1");

  function dlog(...args) {
    if (E.cfg.debug) console.log(...args);
  }
  function derr(...args) {
    console.error(...args);
  }

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, attrs, ...children) {
    const node = document.createElement(tag);
    if (attrs && typeof attrs === "object") {
      for (const k of Object.keys(attrs)) {
        const v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v === true) node.setAttribute(k, "");
        else if (v === false || v === null || v === undefined) {}
        else node.setAttribute(k, String(v));
      }
    }
    for (const c of children) {
      if (c === null || c === undefined) continue;
      if (Array.isArray(c)) {
        for (const cc of c) node.appendChild(typeof cc === "string" ? document.createTextNode(cc) : cc);
      } else {
        node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
      }
    }
    return node;
  }

  E.el = el;
  E.qs = qs;

  // ========= Toasts =========
  let toastWrap = null;

  function ensureToastWrap() {
    if (toastWrap) return toastWrap;
    toastWrap = el("div", { class: "eikon-toast-wrap" });
    document.body.appendChild(toastWrap);
    return toastWrap;
  }

  function toast(title, message, ms) {
    ensureToastWrap();
    const t = el("div", { class: "eikon-toast" },
      el("div", { class: "h" }, title),
      el("div", { class: "m" }, message)
    );
    toastWrap.appendChild(t);
    setTimeout(() => {
      try { t.remove(); } catch {}
    }, ms || 3200);
  }

  E.toast = toast;

  // ========= Modal (custom confirm, no browser confirm()) =========
  let modalBackdrop = null;
  let modalTitleEl = null;
  let modalBodyEl = null;
  let modalOkBtn = null;
  let modalCancelBtn = null;
  let modalResolve = null;

  function ensureModal() {
    if (modalBackdrop) return;

    modalTitleEl = el("div", { class: "t" }, "Confirm");
    modalBodyEl = el("div", { class: "eikon-help" }, "");

    modalOkBtn = el("button", { class: "eikon-btn eikon-btn-primary" }, "OK");
    modalCancelBtn = el("button", { class: "eikon-btn" }, "Cancel");

    modalOkBtn.addEventListener("click", () => {
      if (modalResolve) modalResolve(true);
      hideModal();
    });
    modalCancelBtn.addEventListener("click", () => {
      if (modalResolve) modalResolve(false);
      hideModal();
    });

    const box = el("div", { class: "eikon-modal" },
      el("div", { class: "eikon-modal-head" },
        modalTitleEl,
        el("button", { class: "eikon-btn", onclick: () => { if (modalResolve) modalResolve(false); hideModal(); } }, "×")
      ),
      modalBodyEl,
      el("div", { class: "eikon-modal-actions" }, modalCancelBtn, modalOkBtn)
    );

    modalBackdrop = el("div", { class: "eikon-modal-backdrop" }, box);
    modalBackdrop.addEventListener("click", (e) => {
      if (e.target === modalBackdrop) {
        if (modalResolve) modalResolve(false);
        hideModal();
      }
    });

    document.body.appendChild(modalBackdrop);
  }

  function showModal(title, body, okText, cancelText) {
    ensureModal();
    modalTitleEl.textContent = title || "Confirm";
    modalBodyEl.textContent = body || "";
    modalOkBtn.textContent = okText || "OK";
    modalCancelBtn.textContent = cancelText || "Cancel";
    modalBackdrop.style.display = "flex";
    return new Promise((resolve) => {
      modalResolve = resolve;
    });
  }

  function hideModal() {
    if (!modalBackdrop) return;
    modalBackdrop.style.display = "none";
    modalResolve = null;
  }

  E.confirm = function (title, body, okText, cancelText) {
    return showModal(title, body, okText, cancelText);
  };

  // ========= Auth + API =========
  const TOKEN_KEY = "eikon_token";

  function getToken() {
    return localStorage.getItem(TOKEN_KEY) || "";
  }

  function setToken(tok) {
    if (!tok) localStorage.removeItem(TOKEN_KEY);
    else localStorage.setItem(TOKEN_KEY, tok);
  }

  async function apiFetch(path, opts) {
    const method = (opts && opts.method) ? opts.method : "GET";
    const headers = Object.assign({}, (opts && opts.headers) ? opts.headers : {});
    const token = getToken();

    if (!headers["Content-Type"] && opts && opts.body && typeof opts.body === "string") {
      headers["Content-Type"] = "application/json";
    }
    if (token) headers["Authorization"] = "Bearer " + token;

    const url = path.startsWith("http") ? path : (path.startsWith("/") ? path : ("/" + path));
    dlog("[EIKON][api] ->", url, { method, headers: Object.assign({}, headers, token ? { Authorization: "Bearer <stored>" } : {}) });

    const res = await fetch(url, {
      method,
      headers,
      body: opts && opts.body ? opts.body : undefined
    });

    let data = null;
    try {
      data = await res.json();
    } catch {
      data = null;
    }

    dlog("[EIKON][api] <-", url, { status: res.status, data });

    if (!res.ok) {
      const msg = (data && data.error) ? data.error : ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  E.apiFetch = apiFetch;

  async function me() {
    return await apiFetch("/auth/me", { method: "GET" });
  }

  async function login(email, password) {
    const body = JSON.stringify({ email, password });
    const out = await apiFetch("/auth/login", { method: "POST", body });
    if (!out || !out.ok || !out.token) throw new Error("Login failed");
    setToken(out.token);
    return out.user;
  }

  function logout() {
    setToken("");
    E.state.user = null;
    E.state.shell = null;
    E.state.activeModuleKey = "";
    renderAuth();
  }

  E.logout = logout;

  // ========= Router + Rendering =========
  function parseHash() {
    const raw = (location.hash || "").trim();
    if (!raw) return "";
    const h = raw.replace(/^#/, "");
    if (!h) return "";
    if (h.startsWith("/")) return h.slice(1);
    return h;
  }

  function setHash(modKey) {
    location.hash = "#" + modKey;
  }

  function getActiveModuleKey() {
    const h = parseHash();
    if (h && E.modules[h]) return h;
    const keys = Object.keys(E.modules);
    if (keys.length > 0) return keys[0];
    return "";
  }

  function createShell(root, user) {
    const sidebar = el("div", { class: "eikon-sidebar", "data-collapsed": "0" });

    const brand = el("div", { class: "eikon-brand" },
      el("div", { class: "eikon-logo" }, "E"),
      el("div", { class: "eikon-brand-title" },
        el("div", { class: "t1" }, "EIKON"),
        el("div", { class: "t2" }, "Pharmacy Registers")
      )
    );

    const toggle = el("div", { class: "eikon-sidebar-toggle", title: "Collapse/Expand" }, "⇔");
    toggle.addEventListener("click", () => {
      const cur = sidebar.getAttribute("data-collapsed") === "1";
      sidebar.setAttribute("data-collapsed", cur ? "0" : "1");
    });

    const nav = el("div", { class: "eikon-nav" });

    const main = el("div", { class: "eikon-main" });

    const topbar = el("div", { class: "eikon-topbar" },
      el("div", { class: "eikon-top-left" },
        el("div", { class: "org" }, user.org_name || "EIKON"),
        el("div", { class: "loc" }, (user.location_name || "") + " • " + (user.full_name || user.email || ""))
      ),
      el("div", { class: "eikon-top-right" },
        el("div", { class: "eikon-chip" }, user.email || ""),
        el("button", { class: "eikon-btn", onclick: () => logout() }, "Logout")
      )
    );

    const content = el("div", { class: "eikon-content", id: "eikon-content" });

    main.appendChild(topbar);
    main.appendChild(content);

    sidebar.appendChild(toggle);
    sidebar.appendChild(brand);
    sidebar.appendChild(nav);

    root.innerHTML = "";
    root.appendChild(el("div", { class: "eikon-shell" }, sidebar, main));

    return { sidebar, nav, content };
  }

  async function renderModule(modKey) {
    const shell = E.state.shell;
    if (!shell) return;

    const mod = E.modules[modKey];
    if (!mod) return;

    E.state.__renderSeq = (E.state.__renderSeq || 0) + 1;
    const seq = E.state.__renderSeq;
    E.state.activeModuleKey = modKey;

    // highlight nav
    const items = shell.nav.querySelectorAll(".eikon-nav-item");
    items.forEach((it) => {
      it.setAttribute("data-active", it.getAttribute("data-mod") === modKey ? "1" : "0");
    });

    shell.content.innerHTML = "";
    dlog("[EIKON][core] renderModule() start", { seq, modKey });

    try {
      const ret = mod.render(shell.content, E.state.user);
      if (ret && typeof ret.then === "function") await ret;
      dlog("[EIKON][core] renderModule() done", { seq, modKey });
    } catch (err) {
      const stale = (seq !== E.state.__renderSeq) || (E.state.activeModuleKey !== modKey);
      derr("[EIKON][core] renderModule() ERROR", {
        seq, modKey, stale,
        message: err && err.message ? err.message : String(err),
        stack: err && err.stack ? err.stack : null
      });
      if (stale) return;

      shell.content.innerHTML = "";
      shell.content.appendChild(
        el("div", { class: "eikon-card" },
          el("div", { class: "eikon-title" }, "Module crashed"),
          el("div", { class: "eikon-help" }, "See console for details. The core caught the error so the app can keep running."),
          el("pre", { class: "eikon-pre" }, String(err && (err.stack || err.message || err)))
        )
      );
      toast("Module crashed", "Open console for details.", 4200);
    }
  }

  function buildNav(shell) {
    shell.nav.innerHTML = "";
    const keys = Object.keys(E.modules);

    for (const k of keys) {
      const mod = E.modules[k];
      const item = el("div", {
        class: "eikon-nav-item",
        "data-mod": k,
        "data-active": "0",
        onclick: () => setHash(k)
      },
        el("div", { class: "eikon-nav-ico" }, (mod.icon || "?").slice(0, 1)),
        el("div", { class: "eikon-nav-text" },
          el("div", { class: "t1" }, mod.title || k),
          el("div", { class: "t2" }, mod.subtitle || "")
        )
      );
      shell.nav.appendChild(item);
    }
  }

  function onHashChange() {
    const key = getActiveModuleKey();
    if (!key) return;
    renderModule(key);
  }

  async function renderAuth() {
    const root = qs("#app");
    if (!root) return;

    const emailInput = el("input", { class: "eikon-input", type: "email", autocomplete: "username", placeholder: "Email" });
    const passInput = el("input", { class: "eikon-input", type: "password", autocomplete: "current-password", placeholder: "Password" });

    const btn = el("button", { class: "eikon-btn eikon-btn-primary" }, "Login");

    btn.addEventListener("click", async () => {
      const email = (emailInput.value || "").trim().toLowerCase();
      const pass = (passInput.value || "").trim();
      if (!email || !pass) {
        toast("Missing fields", "Enter your email and password.", 3200);
        return;
      }
      btn.disabled = true;
      btn.textContent = "Logging in...";
      try {
        const u = await login(email, pass);
        E.state.user = u;
        E.state.shell = createShell(root, u);
        buildNav(E.state.shell);
        if (!location.hash) setHash(getActiveModuleKey());
        await onHashChange();
        toast("Welcome", "Logged in successfully.", 2200);
      } catch (err) {
        derr("[EIKON][auth] login error", err);
        toast("Login failed", (err && err.message) ? err.message : "Unknown error", 4200);
      } finally {
        btn.disabled = false;
        btn.textContent = "Login";
      }
    });

    passInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
    });
    emailInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") btn.click();
    });

    root.innerHTML = "";
    root.appendChild(
      el("div", { class: "eikon-auth" },
        el("div", { class: "eikon-card eikon-auth-card" },
          el("div", { class: "eikon-title" }, "EIKON Login"),
          el("div", { class: "eikon-help" }, "Enter your account credentials."),
          el("div", { style: "height:10px" }),
          el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Email"), emailInput),
          el("div", { class: "eikon-field" }, el("div", { class: "eikon-label" }, "Password"), passInput),
          el("div", { style: "height:10px" }),
          btn,
          el("div", { style: "height:10px" }),
          el("div", { class: "eikon-help" }, "Tip: run ", el("span", { class: "eikon-badge" }, "localStorage.setItem(\"eikon_debug\",\"1\")"), " for heavy debug logs.")
        )
      )
    );
  }

  async function start() {
    // capture hard errors
    window.addEventListener("unhandledrejection", (e) => {
      derr("[EIKON] unhandledrejection", e && e.reason ? e.reason : e);
      toast("Unhandled error", "Open console for details.", 4200);
    });
    window.addEventListener("error", (e) => {
      derr("[EIKON] window error", e);
    });

    const root = qs("#app");
    if (!root) return;

    const tok = getToken();
    if (!tok) {
      await renderAuth();
      return;
    }

    try {
      const out = await me();
      if (!out || !out.ok || !out.user) throw new Error("Session invalid");
      E.state.user = out.user;

      E.state.shell = createShell(root, out.user);
      buildNav(E.state.shell);

      window.addEventListener("hashchange", onHashChange);
      if (!location.hash) setHash(getActiveModuleKey());
      await onHashChange();
    } catch (err) {
      derr("[EIKON][auth] session check failed", err);
      setToken("");
      await renderAuth();
    }
  }

  E.start = start;
})();
