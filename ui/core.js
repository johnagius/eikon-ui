(function () {
  const E = (window.EIKON = window.EIKON || {});
  E.modules = E.modules || {};

  E.cfg = {
    apiBase: "https://eikon-api.labrint.workers.dev",
    storageTokenKey: "eikon_token",
    storageUserKey: "eikon_user",
    storageQueueKey: "eikon_queue_v1",
    storageSidebarKey: "eikon_sidebar_collapsed_v1"
  };

  E.state = {
    token: null,
    user: null,
    root: null,
    currentModule: null,
    currentTab: null
  };

  function el(tag, attrs, children) {
    const n = document.createElement(tag);
    if (attrs) {
      for (const k of Object.keys(attrs)) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else if (k === "style") n.setAttribute("style", attrs[k]);
        else if (k.startsWith("on") && typeof attrs[k] === "function") n.addEventListener(k.slice(2), attrs[k]);
        else n.setAttribute(k, attrs[k]);
      }
    }
    if (children && Array.isArray(children)) {
      for (const c of children) {
        if (c === null || c === undefined) continue;
        if (typeof c === "string") n.appendChild(document.createTextNode(c));
        else n.appendChild(c);
      }
    }
    return n;
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function todayYmd() {
    const d = new Date();
    return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  }

  function monthFromYmd(ymd) {
    const s = String(ymd || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    return s.slice(0, 7);
  }

  function safeJsonParse(s, fallback) {
    try { return JSON.parse(s); } catch { return fallback; }
  }

  function loadAuth() {
    const t = localStorage.getItem(E.cfg.storageTokenKey);
    const u = localStorage.getItem(E.cfg.storageUserKey);
    E.state.token = t || null;
    E.state.user = u ? safeJsonParse(u, null) : null;
  }

  function saveAuth(token, user) {
    E.state.token = token;
    E.state.user = user;
    localStorage.setItem(E.cfg.storageTokenKey, token);
    localStorage.setItem(E.cfg.storageUserKey, JSON.stringify(user));
  }

  function clearAuth() {
    E.state.token = null;
    E.state.user = null;
    localStorage.removeItem(E.cfg.storageTokenKey);
    localStorage.removeItem(E.cfg.storageUserKey);
  }

  function ensureToastWrap() {
    let w = document.getElementById("eikon-toast-wrap");
    if (!w) {
      w = el("div", { id: "eikon-toast-wrap", class: "eikon-toast-wrap" });
      document.body.appendChild(w);
    }
    return w;
  }

  function toast(title, message, ms) {
    const wrap = ensureToastWrap();
    const t = el("div", { class: "eikon-toast" }, [
      el("div", { class: "t", text: title }),
      el("div", { class: "m", text: message || "" })
    ]);
    wrap.appendChild(t);
    setTimeout(() => {
      t.style.opacity = "0";
      t.style.transform = "translateY(6px)";
      setTimeout(() => t.remove(), 250);
    }, ms || 2600);
  }

  function modalConfirm(title, message, okText, cancelText) {
    return new Promise((resolve) => {
      const backdrop = el("div", { class: "eikon-modal-backdrop" });
      const box = el("div", { class: "eikon-modal" });
      const h = el("h3", { text: title || "Confirm" });
      const p = el("p", { text: message || "" });

      const btnCancel = el("button", {
        class: "eikon-btn",
        text: cancelText || "Cancel",
        onclick: () => { backdrop.remove(); resolve(false); }
      });

      const btnOk = el("button", {
        class: "eikon-btn danger",
        text: okText || "OK",
        onclick: () => { backdrop.remove(); resolve(true); }
      });

      const actions = el("div", { class: "actions" }, [btnCancel, btnOk]);
      box.appendChild(h);
      box.appendChild(p);
      box.appendChild(actions);
      backdrop.appendChild(box);
      document.body.appendChild(backdrop);
    });
  }

  async function apiFetch(path, opts) {
    const url = E.cfg.apiBase.replace(/\/+$/, "") + path;
    const headers = Object.assign({}, (opts && opts.headers) ? opts.headers : {});
    headers["Content-Type"] = headers["Content-Type"] || "application/json";

    if (E.state.token) headers["Authorization"] = "Bearer " + E.state.token;

    const res = await fetch(url, {
      method: (opts && opts.method) ? opts.method : "GET",
      headers,
      body: (opts && opts.body !== undefined) ? opts.body : undefined
    });

    let json = null;
    try { json = await res.json(); } catch { json = null; }

    if (!res.ok) {
      const msg = (json && json.error) ? json.error : ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.body = json;
      throw err;
    }
    return json;
  }

  function qLoad() {
    const s = localStorage.getItem(E.cfg.storageQueueKey);
    return s ? safeJsonParse(s, []) : [];
  }

  function qSave(arr) {
    localStorage.setItem(E.cfg.storageQueueKey, JSON.stringify(arr));
  }

  function qAdd(item) {
    const q = qLoad();
    q.push(item);
    qSave(q);
  }

  function qClear() {
    qSave([]);
  }

  async function qFlush() {
    const q = qLoad();
    if (!q.length) return { ok: true, sent: 0, remaining: 0 };

    let sent = 0;
    const remaining = [];

    for (const job of q) {
      try {
        await apiFetch(job.path, { method: job.method, body: JSON.stringify(job.body) });
        sent++;
      } catch (e) {
        remaining.push(job);
      }
    }

    qSave(remaining);
    return { ok: true, sent, remaining: remaining.length };
  }

  function loadSidebarCollapsed() {
    const v = localStorage.getItem(E.cfg.storageSidebarKey);
    return v === "1";
  }

  function saveSidebarCollapsed(isCollapsed) {
    localStorage.setItem(E.cfg.storageSidebarKey, isCollapsed ? "1" : "0");
  }

  function renderLogin(root, onLoggedIn) {
    const wrap = el("div", { class: "eikon-login" });
    const card = el("div", { class: "eikon-card" });

    const title = el("div", { class: "eikon-title", text: "Eikon" });
    const help = el("div", { class: "eikon-help", text: "Log in with your email and password. Your location is tied to your account automatically." });

    const email = el("input", { class: "eikon-input", type: "email", placeholder: "Email" });
    const pass = el("input", { class: "eikon-input", type: "password", placeholder: "Password" });

    const btn = el("button", { class: "eikon-btn primary", text: "Log In" });

    const msg = el("div", { class: "eikon-help", text: "" });

    btn.addEventListener("click", async () => {
      const e = (email.value || "").trim().toLowerCase();
      const p = (pass.value || "").trim();
      if (!e || !p) {
        toast("Missing", "Enter email and password.");
        return;
      }

      btn.disabled = true;
      btn.textContent = "Logging in...";
      msg.textContent = "";

      try {
        const r = await apiFetch("/auth/login", {
          method: "POST",
          body: JSON.stringify({ email: e, password: p })
        });
        if (!r || !r.ok || !r.token) throw new Error("Login failed");

        saveAuth(r.token, r.user);
        toast("Logged in", "Welcome back.");
        onLoggedIn();
      } catch (err) {
        msg.textContent = "Login failed. Check details.";
        toast("Login failed", err.message || "Error");
      } finally {
        btn.disabled = false;
        btn.textContent = "Log In";
      }
    });

    card.appendChild(title);
    card.appendChild(el("div", { style: "height:8px;" }));
    card.appendChild(help);

    card.appendChild(el("div", { style: "height:14px;" }));
    card.appendChild(el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Email" }), email]));
    card.appendChild(el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Password" }), pass]));
    card.appendChild(btn);
    card.appendChild(el("div", { style: "height:10px;" }));
    card.appendChild(msg);

    wrap.appendChild(card);
    root.innerHTML = "";
    root.appendChild(wrap);
  }

  function renderShell(root) {
    const app = el("div", { class: "eikon-app" });
    const sidebar = el("div", { class: "eikon-sidebar" });
    const main = el("div", { class: "eikon-main" });

    const isCollapsedInitial = loadSidebarCollapsed();
    if (isCollapsedInitial) sidebar.classList.add("collapsed");

    function setCollapsed(val) {
      if (val) sidebar.classList.add("collapsed");
      else sidebar.classList.remove("collapsed");
      saveSidebarCollapsed(val);
      toggleBtn.textContent = val ? "»" : "«";
      toggleBtn.title = val ? "Expand sidebar" : "Collapse sidebar";
    }

    const toggleBtn = el("button", {
      class: "eikon-sidebar-toggle",
      text: isCollapsedInitial ? "»" : "«",
      title: isCollapsedInitial ? "Expand sidebar" : "Collapse sidebar"
    });
    toggleBtn.addEventListener("click", () => {
      const nowCollapsed = sidebar.classList.contains("collapsed");
      setCollapsed(!nowCollapsed);
    });

    const brand = el("div", { class: "eikon-brand" }, [
      el("div", {
        class: "eikon-badge",
        html: "🧪",
        title: "Toggle sidebar"
      }),
      el("div", { class: "brand-text", text: "Eikon" })
    ]);

    brand.querySelector(".eikon-badge").addEventListener("click", () => {
      const nowCollapsed = sidebar.classList.contains("collapsed");
      setCollapsed(!nowCollapsed);
    });

    const user = E.state.user || {};
    const userCard = el("div", { class: "eikon-usercard" }, [
      el("div", { class: "name", text: (user.org_name || user.email || "User") }),
      el("div", { class: "sub", text: (user.location_name ? (user.location_name + " • ") : "") + (user.email || "") })
    ]);

    const nav = el("div", { class: "eikon-nav" });

    function navBtn(key, label, pill, icon) {
      const left = el("span", { class: "left" }, [
        el("span", { class: "icon", text: icon || "•" }),
        el("span", { class: "label", text: label })
      ]);

      const b = el("button", { title: label }, [
        left,
        el("span", { class: "pill", text: pill })
      ]);

      b.addEventListener("click", () => { E.routerGo(key); });
      b.dataset.key = key;
      return b;
    }

    nav.appendChild(navBtn("temperature", "Temperature Records", "LIVE", "🌡️"));
    nav.appendChild(navBtn("endofday", "End Of Day", "soon", "🧾"));
    nav.appendChild(navBtn("dda_purchases", "DDA Purchases", "soon", "📦"));
    nav.appendChild(navBtn("dda_sales", "DDA Sales", "soon", "💊"));
    nav.appendChild(navBtn("daily_register", "Daily Register", "soon", "📘"));
    nav.appendChild(navBtn("repeat_rx", "Repeat Prescriptions", "soon", "🔁"));
    nav.appendChild(navBtn("dda_stock", "DDA Stock Take", "soon", "📊"));
    nav.appendChild(navBtn("calibrations", "Calibrations", "soon", "🛠️"));
    nav.appendChild(navBtn("maintenance", "Maintenance", "soon", "🧰"));
    nav.appendChild(navBtn("cleaning", "Cleaning", "soon", "🧽"));

    const logoutBtn = el("button", { class: "eikon-logout", text: "Logout" });
    logoutBtn.addEventListener("click", async () => {
      const ok = await modalConfirm("Logout", "Are you sure you want to log out?", "Logout", "Cancel");
      if (!ok) return;
      clearAuth();
      E.start(root);
    });

    sidebar.appendChild(toggleBtn);
    sidebar.appendChild(brand);
    sidebar.appendChild(userCard);
    sidebar.appendChild(nav);
    sidebar.appendChild(logoutBtn);

    app.appendChild(sidebar);
    app.appendChild(main);

    return { app, sidebar, main, nav, setCollapsed };
  }

  async function refreshMe() {
    if (!E.state.token) return false;
    try {
      const r = await apiFetch("/auth/me", { method: "GET" });
      if (r && r.ok && r.user) {
        saveAuth(E.state.token, r.user);
        return true;
      }
      return false;
    } catch {
      return false;
    }
  }

  E.util = {
    el,
    toast,
    modalConfirm,
    todayYmd,
    monthFromYmd,
    apiFetch,
    qAdd,
    qFlush,
    qLoad,
    qClear,
    loadAuth,
    saveAuth,
    clearAuth,
    refreshMe
  };

  E.routerGo = function (key) {
    location.hash = "#" + key;
  };

  E.start = async function (root) {
    E.state.root = root;
    loadAuth();

    const authed = await refreshMe();
    if (!authed) {
      renderLogin(root, async () => {
        await refreshMe();
        E.start(root);
      });
      return;
    }

    const shell = renderShell(root);
    root.innerHTML = "";
    root.appendChild(shell.app);

    function setActiveNav(moduleKey) {
      const btns = shell.nav.querySelectorAll("button");
      btns.forEach(b => {
        if (b.dataset.key === moduleKey) b.classList.add("active");
        else b.classList.remove("active");
      });
    }

    async function renderModule(moduleKey) {
      setActiveNav(moduleKey);

      shell.main.innerHTML = "";
      const topbar = el("div", { class: "eikon-topbar" }, [
        el("div", { class: "eikon-title", text: moduleKey === "temperature" ? "Temperature Records" : "Module" }),
        el("div", { class: "eikon-top-actions" })
      ]);
      shell.main.appendChild(topbar);

      if (moduleKey === "temperature") {
        if (!E.modules.temperature || typeof E.modules.temperature.render !== "function") {
          shell.main.appendChild(el("div", { class: "eikon-card", text: "Temperature module not loaded." }));
          return;
        }
        const content = el("div");
        shell.main.appendChild(content);
        E.modules.temperature.render(content);
        return;
      }

      shell.main.appendChild(
        el("div", { class: "eikon-card" }, [
          el("div", { class: "eikon-title", text: "Coming soon" }),
          el("div", { class: "eikon-help", text: "This module will be added next, using the same login and the same Cloudflare API." })
        ])
      );
    }

    function onHash() {
      const h = (location.hash || "").replace("#", "").trim();
      const key = h || "temperature";
      renderModule(key);
    }

    window.addEventListener("hashchange", onHash);
    onHash();
  };
})();
