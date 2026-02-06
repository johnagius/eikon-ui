(function () {
  const E = (window.EIKON = window.EIKON || {});
  E.modules = E.modules || {};
  E._navOrder = E._navOrder || [];

  E.config = E.config || {};
  E.config.apiBase = E.config.apiBase || (window.EIKON_API_BASE || "").trim() || "https://eikon-api.labrint.workers.dev";
  E.config.storageTokenKey = E.config.storageTokenKey || "eikon_token_v1";
  E.config.storageLastModuleKey = E.config.storageLastModuleKey || "eikon_last_module_v1";
  E.config.storageSidebarKey = E.config.storageSidebarKey || "eikon_sidebar_collapsed_v1";

  E.state = E.state || {
    token: "",
    user: null,
    activeModule: "",
    booted: false
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function el(tag, props) {
    const n = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === "class") n.className = props[k];
        else if (k === "text") n.textContent = props[k];
        else if (k === "html") n.innerHTML = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function") n.addEventListener(k.slice(2), props[k]);
        else n.setAttribute(k, props[k]);
      }
    }
    return n;
  }

  function safeText(s) {
    return String(s == null ? "" : s);
  }

  function pad2(n) {
    const x = String(n);
    return x.length === 1 ? "0" + x : x;
  }

  function toYmd(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  function toYm(d) {
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1);
  }

  function monthLabel(ym) {
    const m = String(ym || "");
    const ok = /^\d{4}-\d{2}$/.test(m);
    if (!ok) return m;
    const y = parseInt(m.slice(0, 4), 10);
    const mo = parseInt(m.slice(5, 7), 10);
    const names = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return names[mo - 1] + " " + y;
  }

  function addMonths(ym, delta) {
    const m = String(ym || "");
    if (!/^\d{4}-\d{2}$/.test(m)) return toYm(new Date());
    const y = parseInt(m.slice(0, 4), 10);
    const mo = parseInt(m.slice(5, 7), 10);
    const dt = new Date(Date.UTC(y, mo - 1 + delta, 1));
    return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1);
  }

  function storageGet(k) {
    try { return localStorage.getItem(k) || ""; } catch { return ""; }
  }
  function storageSet(k, v) {
    try { localStorage.setItem(k, String(v)); } catch {}
  }
  function storageDel(k) {
    try { localStorage.removeItem(k); } catch {}
  }

  E.$ = $;
  E.el = el;

  E.utils = {
    $, el, safeText, toYmd, toYm, addMonths, monthLabel
  };

  // ---------- Modal (no confirm()/alert()) ----------
  let modalOverlay = null;

  function ensureModal() {
    if (modalOverlay) return modalOverlay;
    modalOverlay = el("div", { class: "modal-overlay" });
    const modal = el("div", { class: "modal" });
    const h = el("h3", { text: "" });
    const p = el("p", { text: "" });
    const actions = el("div", { class: "modal-actions" });

    modal.appendChild(h);
    modal.appendChild(p);
    modal.appendChild(actions);
    modalOverlay.appendChild(modal);

    modalOverlay._titleEl = h;
    modalOverlay._textEl = p;
    modalOverlay._actionsEl = actions;

    document.body.appendChild(modalOverlay);
    return modalOverlay;
  }

  function showModal(opts) {
    const ov = ensureModal();
    ov._titleEl.textContent = safeText(opts.title || "Confirm");
    ov._textEl.textContent = safeText(opts.message || "");
    ov._actionsEl.innerHTML = "";

    const buttons = Array.isArray(opts.buttons) ? opts.buttons : [];
    for (const b of buttons) {
      const btn = el("button", {
        class: "btn " + (b.kind === "primary" ? "primary" : b.kind === "danger" ? "danger" : ""),
        text: safeText(b.text || b.label || "OK")
      });
      btn.addEventListener("click", async () => {
        if (!b.keepOpen) hideModal();
        if (typeof b.onClick === "function") await b.onClick();
      });
      ov._actionsEl.appendChild(btn);
    }

    ov.style.display = "flex";
  }

  function hideModal() {
    const ov = ensureModal();
    ov.style.display = "none";
  }

  E.showModal = function (title, message, buttons) {
    showModal({ title, message, buttons });
  };

  E.confirmDialog = function (title, message) {
    return new Promise((resolve) => {
      showModal({
        title,
        message,
        buttons: [
          { label: "Cancel", kind: "", onClick: () => resolve(false) },
          { label: "Confirm", kind: "danger", onClick: () => resolve(true) }
        ]
      });
    });
  };

  E.modal = {
    alert(title, message) {
      showModal({
        title,
        message,
        buttons: [{ label: "OK", kind: "primary" }]
      });
    }
  };

  // ---------- UI helpers ----------
  E.toast = function (message, kind) {
    const msg = safeText(message || "");
    if (!msg) return;
    const t = el("div", { class: "toast " + (kind || "") });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      if (t && t.parentNode) t.parentNode.removeChild(t);
    }, 3000);
  };

  E.escapeHtml = function (s) {
    return safeText(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  };

  E.todayYmd = function () {
    return toYmd(new Date());
  };

  E.ymdToDmy = function (ymd) {
    const v = safeText(ymd || "").trim();
    const parts = v.split("-");
    if (parts.length !== 3) return v;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  };

  E.nowHmRound = function () {
    const d = new Date();
    const mins = d.getMinutes();
    const rounded = Math.round(mins / 5) * 5;
    d.setMinutes(rounded);
    d.setSeconds(0);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  };

  E.monthAdd = function (ym, delta) {
    return addMonths(ym, delta);
  };

  E.tryPrintHtml = function (html, title) {
    try {
      const w = window.open("", "_blank");
      if (!w) return false;
      w.document.open();
      w.document.write(html);
      if (title) w.document.title = title;
      w.document.close();
      w.focus();
      w.print();
      return true;
    } catch {
      return false;
    }
  };

  E.downloadTextFile = function (filename, text) {
    const blob = new Blob([safeText(text)], { type: "text/html;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename || "download.html";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 250);
  };

  // ---------- Auth / API ----------
  E.setToken = function (t) {
    E.state.token = safeText(t || "");
    if (E.state.token) storageSet(E.config.storageTokenKey, E.state.token);
    else storageDel(E.config.storageTokenKey);
  };

  E.getToken = function () {
    return E.state.token || storageGet(E.config.storageTokenKey);
  };

  E.logout = function () {
    E.setToken("");
    E.state.user = null;
    E.state.activeModule = "";
    storageDel(E.config.storageLastModuleKey);
    renderLogin("You have been logged out.");
  };

  E.apiFetch = async function (path, opts) {
    const o = opts || {};
    const method = (o.method || "GET").toUpperCase();
    const url = (path.startsWith("http://") || path.startsWith("https://"))
      ? path
      : (E.config.apiBase.replace(/\/+$/g, "") + "/" + path.replace(/^\/+/, ""));

    const headers = new Headers(o.headers || {});
    if (!headers.has("Content-Type") && o.json !== undefined) headers.set("Content-Type", "application/json");

    const token = E.getToken();
    if (token) headers.set("Authorization", "Bearer " + token);

    const init = {
      method,
      headers,
      body: o.json !== undefined ? JSON.stringify(o.json) : o.body
    };

    const res = await fetch(url, init);
    let data = null;
    const ct = (res.headers.get("Content-Type") || "").toLowerCase();
    if (ct.includes("application/json")) {
      data = await res.json().catch(() => null);
    } else {
      data = await res.text().catch(() => "");
    }

    if (res.status === 401) {
      E.setToken("");
      E.state.user = null;
      throw new Error("Unauthorized");
    }

    if (!res.ok) {
      const msg = data && data.error ? data.error : ("HTTP " + res.status);
      const err = new Error(msg);
      err.status = res.status;
      err.data = data;
      throw err;
    }

    return data;
  };

  // ---------- Modules registry ----------
  E.registerModule = function (key, moduleObj) {
    const k = safeText(key || "").trim();
    if (!k) return;
    E.modules = E.modules || {};
    E.modules[k] = moduleObj || {};
    if (!E._navOrder.includes(k)) E._navOrder.push(k);
  };

  // ---------- Layout rendering ----------
  let rootEl = null;
  let shellEl = null;
  let sidebarEl = null;
  let mainEl = null;
  let contentEl = null;

  function applySidebarState() {
    const v = storageGet(E.config.storageSidebarKey);
    const collapsed = v === "1";
    document.body.classList.toggle("eikon-sidebar-collapsed", collapsed);
  }

  function toggleSidebar() {
    const isCollapsed = document.body.classList.contains("eikon-sidebar-collapsed");
    const next = !isCollapsed;
    document.body.classList.toggle("eikon-sidebar-collapsed", next);
    storageSet(E.config.storageSidebarKey, next ? "1" : "0");
  }

  function renderShell() {
    if (!rootEl) return;

    rootEl.innerHTML = "";
    applySidebarState();

    shellEl = el("div", { class: "eikon-shell" });
    sidebarEl = el("aside", { class: "eikon-sidebar" });
    mainEl = el("main", { class: "eikon-main" });

    // Sidebar: brand
    const brand = el("div", { class: "eikon-brand" });
    const logo = el("div", { class: "eikon-logo", text: "E" });
    const bt = el("div", { class: "eikon-brand-text" });
    bt.appendChild(el("div", { class: "eikon-brand-name", text: "EIKON" }));
    bt.appendChild(el("div", { class: "eikon-brand-sub", text: "Pharmacy Registers" }));
    brand.appendChild(logo);
    brand.appendChild(bt);
    sidebarEl.appendChild(brand);

    // Sidebar: nav
    const nav = el("div", { class: "eikon-nav" });

    const keys = E._navOrder.filter((k) => !!E.modules[k]);
    for (const k of keys) {
      const m = E.modules[k] || {};
      const item = el("div", { class: "eikon-nav-item", role: "button", tabindex: "0" });
      item.dataset.key = k;

      const ico = el("div", { class: "eikon-nav-ico", text: safeText(m.icon || "•") });
      const tx = el("div", { class: "eikon-nav-text" });
      tx.appendChild(el("div", { class: "eikon-nav-label", text: safeText(m.title || k) }));
      tx.appendChild(el("div", { class: "eikon-nav-sub", text: safeText(m.subtitle || "") }));

      item.appendChild(ico);
      item.appendChild(tx);

      item.addEventListener("click", () => {
        E.navigate(k);
      });

      nav.appendChild(item);
    }

    // If no modules registered, show placeholder
    if (keys.length === 0) {
      const item = el("div", { class: "eikon-nav-item disabled" });
      item.appendChild(el("div", { class: "eikon-nav-ico", text: "…" }));
      const tx = el("div", { class: "eikon-nav-text" });
      tx.appendChild(el("div", { class: "eikon-nav-label", text: "No modules" }));
      tx.appendChild(el("div", { class: "eikon-nav-sub", text: "Nothing loaded yet" }));
      item.appendChild(tx);
      nav.appendChild(item);
    }

    sidebarEl.appendChild(nav);

    // Sidebar: user box
    const ub = el("div", { class: "eikon-userbox" });
    const ul = el("div", { class: "eikon-userline" });
    ul.appendChild(el("div", { class: "eikon-dot" }));
    const ut = el("div", { class: "eikon-usertext" });

    const u = E.state.user || {};
    ut.appendChild(el("div", { class: "eikon-useremail", text: safeText(u.email || "") }));
    ut.appendChild(el("div", { class: "eikon-userorg", text: safeText((u.org_name || "") + " • " + (u.location_name || "")) }));

    ul.appendChild(ut);
    ub.appendChild(ul);

    const logoutBtn = el("button", { class: "eikon-logout", text: "Logout" });
    logoutBtn.addEventListener("click", () => {
      E.logout();
    });
    ub.appendChild(logoutBtn);

    sidebarEl.appendChild(ub);

    // Main: topbar
    const top = el("div", { class: "eikon-topbar" });

    const left = el("div", { class: "eikon-top-left" });
    const burger = el("button", { class: "eikon-burger", type: "button", "aria-label": "Toggle sidebar" });
    burger.innerHTML = "☰";
    burger.addEventListener("click", toggleSidebar);

    const tw = el("div", { class: "eikon-title-wrap" });
    tw.appendChild(el("h1", { class: "eikon-title", text: "Eikon" }));
    tw.appendChild(el("p", { class: "eikon-subtitle", text: "" }));

    left.appendChild(burger);
    left.appendChild(tw);

    const right = el("div", { class: "eikon-top-right" });
    right.appendChild(el("div", { class: "eikon-pill", text: "Role: " + safeText((u.role || "")) }));

    top.appendChild(left);
    top.appendChild(right);

    // Content holder
    const body = el("div", { class: "eikon-body" });
    contentEl = el("div", { class: "eikon-body-inner" });

    body.appendChild(contentEl);

    mainEl.appendChild(top);
    mainEl.appendChild(body);

    shellEl.appendChild(sidebarEl);
    shellEl.appendChild(mainEl);
    rootEl.appendChild(shellEl);

    // set topbar subtitle
    const sub = $(".eikon-subtitle", mainEl);
    sub.textContent = safeText((u.org_name || "") + " • " + (u.location_name || "") + " • " + (u.email || ""));
  }

  function highlightNav(activeKey) {
    if (!sidebarEl) return;
    const items = sidebarEl.querySelectorAll(".eikon-nav-item");
    items.forEach((it) => {
      const k = it.dataset.key || "";
      it.classList.toggle("active", k === activeKey);
    });
  }

  E.navigate = function (moduleKey) {
    const k = safeText(moduleKey || "").trim();
    if (!k) return;
    if (!E.modules[k]) return;

    E.state.activeModule = k;
    storageSet(E.config.storageLastModuleKey, k);

    // hash route
    try { location.hash = "#" + encodeURIComponent(k); } catch {}

    highlightNav(k);
    renderModule(k);
  };

  function renderModule(moduleKey) {
    if (!contentEl) return;

    const m = E.modules[moduleKey];
    if (!m || typeof m.render !== "function") {
      contentEl.innerHTML = "";
      const c = el("div", { class: "eikon-card eikon-section" });
      const ci = el("div", { class: "eikon-card-inner" });
      ci.appendChild(el("div", { class: "eikon-muted", text: "Module not available." }));
      c.appendChild(ci);
      contentEl.appendChild(c);
      return;
    }

    // Update title
    const t = $(".eikon-title", mainEl);
    if (t) t.textContent = safeText(m.title || moduleKey);

    contentEl.innerHTML = "";
    m.render(contentEl, E);
  }

  function getRouteModuleKey() {
    const h = (location.hash || "").replace(/^#/, "");
    const k = decodeURIComponent(h || "").trim();
    return k;
  }

  // ---------- Login rendering ----------
  function renderLogin(message) {
    if (!rootEl) return;
    rootEl.innerHTML = "";
    document.body.classList.remove("eikon-sidebar-collapsed");

    const wrap = el("div", { class: "eikon-login eikon-card" });
    const inner = el("div", { class: "eikon-card-inner" });

    inner.appendChild(el("h1", { text: "EIKON" }));
    inner.appendChild(el("p", { text: "Log in to continue." }));

    if (message) {
      inner.appendChild(el("div", { class: "eikon-section eikon-muted", text: safeText(message) }));
    }

    const row = el("div", { class: "eikon-row eikon-section" });

    const fEmail = el("div", { class: "eikon-field" });
    fEmail.appendChild(el("label", { text: "Email" }));
    const iEmail = el("input", { class: "eikon-input", type: "email", autocomplete: "username", value: "" });
    fEmail.appendChild(iEmail);

    const fPass = el("div", { class: "eikon-field" });
    fPass.appendChild(el("label", { text: "Password" }));
    const iPass = el("input", { class: "eikon-input", type: "password", autocomplete: "current-password", value: "" });
    fPass.appendChild(iPass);

    row.appendChild(fEmail);
    row.appendChild(fPass);

    const actions = el("div", { class: "eikon-row eikon-section" });
    const btn = el("button", { class: "btn primary", text: "Login", type: "button" });
    const status = el("div", { class: "eikon-muted", text: "" });
    status.style.alignSelf = "center";

    btn.addEventListener("click", async () => {
      status.textContent = "Logging in...";
      btn.disabled = true;
      try {
        const email = safeText(iEmail.value).trim().toLowerCase();
        const password = safeText(iPass.value).trim();
        if (!email || !password) {
          status.textContent = "Enter email and password.";
          btn.disabled = false;
          return;
        }

        const data = await E.apiFetch("/auth/login", {
          method: "POST",
          json: { email, password }
        });

        if (!data || !data.ok || !data.token) throw new Error("Login failed");
        E.setToken(data.token);

        // validate + load user (auth/me)
        const me = await E.apiFetch("/auth/me", { method: "GET" });
        if (!me || !me.ok || !me.user) throw new Error("Session validation failed");

        E.state.user = me.user;

        renderShell();

        // pick module
        const routeKey = getRouteModuleKey();
        const last = storageGet(E.config.storageLastModuleKey);
        const firstKey = E._navOrder.find((k) => !!E.modules[k]) || "";
        const pick = (routeKey && E.modules[routeKey]) ? routeKey : (last && E.modules[last] ? last : firstKey);
        if (pick) E.navigate(pick);
        else renderModule("");

      } catch (err) {
        const msg = err && err.message ? err.message : "Login failed";
        status.textContent = msg;
        btn.disabled = false;
      }
    });

    iPass.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") btn.click();
    });

    actions.appendChild(btn);
    actions.appendChild(status);

    inner.appendChild(row);
    inner.appendChild(actions);
    wrap.appendChild(inner);

    rootEl.appendChild(wrap);
  }

  // ---------- Boot ----------
  E.boot = async function (rootSelectorOrEl) {
    if (E.state.booted) return;
    E.state.booted = true;

    rootEl = typeof rootSelectorOrEl === "string"
      ? $(rootSelectorOrEl)
      : (rootSelectorOrEl || document.getElementById("eikon-root") || document.body);

    if (!rootEl) rootEl = document.body;

    // Restore sidebar state
    applySidebarState();

    // Restore token
    const token = E.getToken();
    if (token) {
      E.state.token = token;
      try {
        const me = await E.apiFetch("/auth/me", { method: "GET" });
        if (me && me.ok && me.user) {
          E.state.user = me.user;
          renderShell();

          const routeKey = getRouteModuleKey();
          const last = storageGet(E.config.storageLastModuleKey);
          const firstKey = E._navOrder.find((k) => !!E.modules[k]) || "";
          const pick = (routeKey && E.modules[routeKey]) ? routeKey : (last && E.modules[last] ? last : firstKey);
          if (pick) E.navigate(pick);
          else renderModule("");
          return;
        }
      } catch (e) {
        // fallthrough to login
        E.setToken("");
      }
    }

    renderLogin("");
  };

})();
