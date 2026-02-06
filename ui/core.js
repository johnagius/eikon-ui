/* ui/core.js
   - Global EIKON namespace (no ES modules)
   - Stores auth token in localStorage
   - Sidebar + topbar app shell
   - Safe confirm/alert/print: delegates to top window when embedded in sandboxed iframe
*/

(function () {
  function tryTop(fnName, args) {
    try {
      if (window.top && window.top !== window && typeof window.top[fnName] === "function") {
        return window.top[fnName].apply(window.top, args);
      }
    } catch (e) {}
    return null;
  }

  // Workaround for GoDaddy sandbox blocking confirm()/print()/alert().
  // If embedded, try calling top.confirm / top.print / top.alert.
  try {
    const originalConfirm = window.confirm;
    const originalAlert = window.alert;
    const originalPrint = window.print;

    window.confirm = function () {
      const r = tryTop("confirm", arguments);
      if (typeof r === "boolean") return r;
      return originalConfirm.apply(window, arguments);
    };

    window.alert = function () {
      const r = tryTop("alert", arguments);
      if (r !== null) return r;
      return originalAlert.apply(window, arguments);
    };

    window.print = function () {
      const r = tryTop("print", arguments);
      if (r !== null) return r;
      return originalPrint.apply(window, arguments);
    };
  } catch (e) {}

  function qs(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === "class") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k === "html") node.innerHTML = props[k];
        else if (k === "style") Object.assign(node.style, props[k]);
        else if (k.startsWith("on") && typeof props[k] === "function") node.addEventListener(k.slice(2), props[k]);
        else node.setAttribute(k, props[k]);
      }
    }
    if (children && children.length) {
      for (const c of children) {
        if (c === null || c === undefined) continue;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      }
    }
    return node;
  }

  function nowLocalYmd() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${y}-${m}-${day}`;
  }

  function nowLocalYm() {
    const d = new Date();
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    return `${y}-${m}`;
  }

  function addMonths(ym, delta) {
    const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
    const dt = new Date(y, m - 1, 1);
    dt.setMonth(dt.getMonth() + delta);
    const ny = dt.getFullYear();
    const nm = String(dt.getMonth() + 1).padStart(2, "0");
    return `${ny}-${nm}`;
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    }[c]));
  }

  function formatYmLabel(ym) {
    const [y, m] = ym.split("-").map((n) => parseInt(n, 10));
    const dt = new Date(y, m - 1, 1);
    return dt.toLocaleString(undefined, { month: "long", year: "numeric" });
  }

  const LS_TOKEN = "eikon_token_v1";
  const LS_LAST_MODULE = "eikon_last_module_v1";
  const LS_SIDEBAR = "eikon_sidebar_collapsed_v1";

  const EIKON = {
    config: {
      apiBase: "",
    },
    state: {
      token: "",
      user: null,
      modules: {},
      activeModuleId: "",
      activeModuleInstance: null,
      ui: {
        root: null,
        sidebar: null,
        nav: null,
        main: null,
        content: null,
        title: null,
        subtitle: null,
        pill: null,
        toast: null,
      },
    },

    registerModule: function (id, mod) {
      if (!id || !mod) return;
      this.state.modules[id] = mod;
      // If app already booted, rebuild nav.
      if (this.state.ui.nav) this._renderNav();
    },

    boot: async function (opts) {
      this.config.apiBase = String(opts && opts.apiBase ? opts.apiBase : "").replace(/\/+$/, "");
      if (!this.config.apiBase) throw new Error("Missing apiBase");

      this.state.token = localStorage.getItem(LS_TOKEN) || "";
      const collapsed = (localStorage.getItem(LS_SIDEBAR) || "0") === "1";
      document.body.classList.toggle("eikon-sidebar-collapsed", collapsed);

      this._mountShell();

      if (this.state.token) {
        const ok = await this._loadMe();
        if (ok) {
          this._renderNav();
          const last = localStorage.getItem(LS_LAST_MODULE) || "";
          const first = last && this.state.modules[last] ? last : (Object.keys(this.state.modules)[0] || "");
          if (first) this.openModule(first);
          else this._setTitle("Eikon", "No modules loaded");
          return;
        }
        // token invalid
        this.logout();
      }

      this._showLogin();
    },

    apiFetch: async function (path, options) {
      const url = this.config.apiBase + (path.startsWith("/") ? path : ("/" + path));
      const headers = Object.assign({}, (options && options.headers) ? options.headers : {});
      headers["Accept"] = "application/json";
      if (this.state.token) headers["Authorization"] = "Bearer " + this.state.token;

      const init = Object.assign({}, options || {});
      init.headers = headers;

      const res = await fetch(url, init);
      let data = null;
      try { data = await res.json(); } catch (e) {}

      if (res.status === 401) {
        // Kick to login
        this.logout();
        throw new Error("Unauthorized");
      }

      if (!res.ok) {
        const msg = data && data.error ? data.error : ("HTTP " + res.status);
        throw new Error(msg);
      }

      return data;
    },

    login: async function (email, password) {
      const data = await this.apiFetch("/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email, password: password }),
      });

      if (!data || !data.ok || !data.token) throw new Error("Login failed");
      this.state.token = data.token;
      localStorage.setItem(LS_TOKEN, this.state.token);

      const ok = await this._loadMe();
      if (!ok) throw new Error("Login ok but /auth/me failed");

      this._renderNav();
      const last = localStorage.getItem(LS_LAST_MODULE) || "";
      const first = last && this.state.modules[last] ? last : (Object.keys(this.state.modules)[0] || "");
      if (first) this.openModule(first);
      else this._setTitle("Eikon", "No modules loaded");
    },

    logout: function () {
      this.state.token = "";
      this.state.user = null;
      localStorage.removeItem(LS_TOKEN);
      this._unmountActiveModule();
      this._showLogin();
    },

    openModule: function (id) {
      if (!id || !this.state.modules[id]) return;

      this._unmountActiveModule();

      const mod = this.state.modules[id];
      this.state.activeModuleId = id;
      localStorage.setItem(LS_LAST_MODULE, id);

      // Update nav button active
      const buttons = this.state.ui.nav ? this.state.ui.nav.querySelectorAll(".eikon-nav-btn") : [];
      for (const b of buttons) {
        b.classList.toggle("active", b.getAttribute("data-mid") === id);
      }

      this._setTitle(mod.title || "Module", this._subtitleForUser());

      const container = this.state.ui.content;
      container.innerHTML = "";

      const ctx = {
        apiFetch: this.apiFetch.bind(this),
        user: this.state.user,
        setTitle: (t, sub) => this._setTitle(t, sub),
        toast: (msg) => this.toast(msg),
        escapeHtml: escapeHtml,
        nowLocalYmd: nowLocalYmd,
        nowLocalYm: nowLocalYm,
        addMonths: addMonths,
        formatYmLabel: formatYmLabel,
      };

      try {
        const inst = mod.mount(container, ctx);
        this.state.activeModuleInstance = inst || null;
      } catch (e) {
        container.appendChild(el("div", { class: "eikon-card" }, [
          el("div", { class: "eikon-error", text: "Module crashed: " + (e && e.message ? e.message : String(e)) }, [])
        ]));
      }
    },

    toast: function (msg) {
      // Remove existing
      if (this.state.ui.toast) {
        try { this.state.ui.toast.remove(); } catch (e) {}
        this.state.ui.toast = null;
      }
      const node = el("div", { class: "eikon-toast", text: String(msg || "") }, []);
      document.body.appendChild(node);
      this.state.ui.toast = node;
      setTimeout(() => {
        try { node.remove(); } catch (e) {}
        if (this.state.ui.toast === node) this.state.ui.toast = null;
      }, 2600);
    },

    toggleSidebar: function () {
      const newVal = !document.body.classList.contains("eikon-sidebar-collapsed");
      document.body.classList.toggle("eikon-sidebar-collapsed", newVal);
      localStorage.setItem(LS_SIDEBAR, newVal ? "1" : "0");
    },

    _subtitleForUser: function () {
      const u = this.state.user;
      if (!u) return "";
      const org = u.org_name ? u.org_name : "";
      const loc = u.location_name ? u.location_name : "";
      const who = u.email ? u.email : "";
      const bits = [];
      if (org) bits.push(org);
      if (loc) bits.push(loc);
      if (who) bits.push(who);
      return bits.join(" • ");
    },

    _setTitle: function (title, subtitle) {
      if (this.state.ui.title) this.state.ui.title.textContent = title || "";
      if (this.state.ui.subtitle) this.state.ui.subtitle.textContent = subtitle || "";
      if (this.state.ui.pill) {
        const role = (this.state.user && this.state.user.role) ? this.state.user.role : "";
        this.state.ui.pill.textContent = role ? ("Role: " + role) : "";
      }
    },

    _mountShell: function () {
      const root = qs("#eikonRoot") || qs("#eikon-root") || document.body;
      const host = el("div", { class: "eikon-root" }, []);
      const app = el("div", { class: "eikon-app" }, []);

      // Sidebar
      const sidebar = el("div", { class: "eikon-sidebar" }, []);
      const brand = el("div", { class: "eikon-brand" }, [
        el("div", { class: "eikon-brand-badge", text: "E" }, []),
        el("div", { class: "eikon-brand-text" }, [
          el("div", { class: "eikon-brand-title", text: "EIKON" }, []),
          el("div", { class: "eikon-brand-sub", text: "Pharmacy Registers" }, []),
        ]),
      ]);

      const nav = el("div", { class: "eikon-nav" }, []);

      const spacer = el("div", { class: "eikon-spacer" }, []);

      const usercard = el("div", { class: "eikon-usercard" }, []);
      const logoutBtn = el("button", {
        class: "eikon-logout",
        onClick: () => this.logout(),
        text: "Logout",
        type: "button",
      }, []);

      usercard.appendChild(el("div", { class: "eikon-userrow" }, [
        el("div", { class: "eikon-userdot" }, []),
        el("div", { class: "eikon-usertext" }, [
          el("div", { class: "eikon-username", text: "Not logged in" }, []),
          el("div", { class: "eikon-userorg", text: "" }, []),
        ]),
      ]));
      usercard.appendChild(logoutBtn);

      sidebar.appendChild(brand);
      sidebar.appendChild(nav);
      sidebar.appendChild(spacer);
      sidebar.appendChild(usercard);

      // Main
      const main = el("div", { class: "eikon-main" }, []);
      const topbar = el("div", { class: "eikon-topbar" }, []);
      const topLeft = el("div", { class: "eikon-top-left" }, []);
      const hamburger = el("button", {
        class: "eikon-hamburger",
        type: "button",
        title: "Collapse/expand sidebar",
        onClick: () => this.toggleSidebar(),
        text: "☰",
      }, []);

      const titleWrap = el("div", { class: "eikon-titlewrap" }, []);
      const title = el("div", { class: "eikon-title", text: "Eikon" }, []);
      const subtitle = el("div", { class: "eikon-subtitle", text: "" }, []);
      titleWrap.appendChild(title);
      titleWrap.appendChild(subtitle);

      topLeft.appendChild(hamburger);
      topLeft.appendChild(titleWrap);

      const topRight = el("div", { class: "eikon-top-right" }, []);
      const pill = el("div", { class: "eikon-pill", text: "" }, []);
      topRight.appendChild(pill);

      topbar.appendChild(topLeft);
      topbar.appendChild(topRight);

      const content = el("div", { class: "eikon-content" }, []);

      main.appendChild(topbar);
      main.appendChild(content);

      app.appendChild(sidebar);
      app.appendChild(main);
      host.appendChild(app);

      // Replace root contents
      if (root === document.body) {
        document.body.innerHTML = "";
        document.body.appendChild(host);
      } else {
        root.innerHTML = "";
        root.appendChild(host);
      }

      this.state.ui.root = host;
      this.state.ui.sidebar = sidebar;
      this.state.ui.nav = nav;
      this.state.ui.main = main;
      this.state.ui.content = content;
      this.state.ui.title = title;
      this.state.ui.subtitle = subtitle;
      this.state.ui.pill = pill;
    },

    _renderNav: function () {
      const nav = this.state.ui.nav;
      if (!nav) return;
      nav.innerHTML = "";

      const ids = Object.keys(this.state.modules);
      ids.sort((a, b) => a.localeCompare(b));

      for (const id of ids) {
        const mod = this.state.modules[id];
        const ico = mod.icon ? mod.icon : "📄";
        const btn = el("button", {
          class: "eikon-nav-btn",
          type: "button",
          "data-mid": id,
          onClick: () => this.openModule(id),
        }, [
          el("div", { class: "eikon-nav-ico", text: ico }, []),
          el("div", { class: "eikon-nav-label", text: mod.navLabel || mod.title || id }, []),
        ]);

        if (id === this.state.activeModuleId) btn.classList.add("active");
        nav.appendChild(btn);
      }

      // Update user card text
      const u = this.state.user;
      const userName = (u && u.email) ? u.email : "Not logged in";
      const orgLoc = u ? this._subtitleForUser() : "";

      const nameNode = qs(".eikon-username", this.state.ui.sidebar);
      const orgNode = qs(".eikon-userorg", this.state.ui.sidebar);
      if (nameNode) nameNode.textContent = userName;
      if (orgNode) orgNode.textContent = orgLoc;
    },

    _unmountActiveModule: function () {
      if (this.state.activeModuleInstance && typeof this.state.activeModuleInstance.unmount === "function") {
        try { this.state.activeModuleInstance.unmount(); } catch (e) {}
      }
      this.state.activeModuleInstance = null;
      this.state.activeModuleId = "";
      if (this.state.ui.content) this.state.ui.content.innerHTML = "";
    },

    _showLogin: function () {
      // Shell already mounted. Replace content area with login card.
      this._setTitle("Eikon", "Login");
      if (!this.state.ui.content) return;
      this.state.ui.content.innerHTML = "";

      const wrap = el("div", { class: "eikon-login-wrap" }, []);
      const card = el("div", { class: "eikon-card" }, []);
      const title = el("div", { class: "eikon-login-title", text: "Sign in" }, []);
      const sub = el("div", { class: "eikon-login-sub", text: "Use your email and password." }, []);

      const emailField = el("div", { class: "eikon-field" }, [
        el("label", { text: "Email" }, []),
        el("input", { type: "email", autocomplete: "username", placeholder: "you@pharmacy.com" }, []),
      ]);

      const passField = el("div", { class: "eikon-field" }, [
        el("label", { text: "Password" }, []),
        el("input", { type: "password", autocomplete: "current-password", placeholder: "••••••••" }, []),
      ]);

      const btn = el("button", { class: "eikon-btn primary", type: "button", text: "Login" }, []);
      const err = el("div", { class: "eikon-error", style: { display: "none" } }, []);

      const onSubmit = async () => {
        err.style.display = "none";
        btn.disabled = true;
        btn.textContent = "Logging in…";
        try {
          const email = qs("input", emailField).value.trim();
          const password = qs("input", passField).value;
          await this.login(email, password);
          this.toast("Logged in");
        } catch (e) {
          err.textContent = (e && e.message) ? e.message : String(e);
          err.style.display = "block";
        } finally {
          btn.disabled = false;
          btn.textContent = "Login";
        }
      };

      btn.addEventListener("click", onSubmit);
      qs("input", passField).addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") onSubmit();
      });

      card.appendChild(title);
      card.appendChild(sub);
      card.appendChild(emailField);
      card.appendChild(passField);
      card.appendChild(btn);
      card.appendChild(err);

      wrap.appendChild(card);
      this.state.ui.content.appendChild(wrap);

      // update sidebar user card
      const nameNode = qs(".eikon-username", this.state.ui.sidebar);
      const orgNode = qs(".eikon-userorg", this.state.ui.sidebar);
      if (nameNode) nameNode.textContent = "Not logged in";
      if (orgNode) orgNode.textContent = "";
    },

    _loadMe: async function () {
      try {
        const data = await this.apiFetch("/auth/me", { method: "GET" });
        if (!data || !data.ok || !data.user) return false;
        this.state.user = data.user;
        this._setTitle("Eikon", this._subtitleForUser());
        return true;
      } catch (e) {
        return false;
      }
    },
  };

  window.EIKON = EIKON;
})();
