(function(){
  "use strict";

  const EIKON = window.EIKON = window.EIKON || {};
  EIKON.version = "0.1.1";
  EIKON.modules = EIKON.modules || {};

  const apiBase = (window.EIKON_API_BASE || "").trim() || "https://eikon-api.labrint.workers.dev";
  EIKON.apiBase = apiBase;

  const STORAGE_TOKEN = "eikon_token_v1";
  const STORAGE_LAST_MODULE = "eikon_last_module_v1";
  const STORAGE_SIDEBAR = "eikon_sidebar_collapsed_v1";

  function el(tag, attrs, children){
    const node = document.createElement(tag);
    if (attrs){
      Object.keys(attrs).forEach(k=>{
        const v = attrs[k];
        if (k === "class") node.className = v;
        else if (k === "style") node.setAttribute("style", v);
        else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
        else if (v === false || v === null || v === undefined) {}
        else node.setAttribute(k, String(v));
      });
    }
    if (children !== undefined && children !== null){
      if (Array.isArray(children)){
        children.forEach(ch=>{
          if (ch === null || ch === undefined) return;
          if (typeof ch === "string") node.appendChild(document.createTextNode(ch));
          else node.appendChild(ch);
        });
      } else if (typeof children === "string"){
        node.textContent = children;
      } else {
        node.appendChild(children);
      }
    }
    return node;
  }

  function qs(sel, root){ return (root || document).querySelector(sel); }

  function safeText(s){
    return String(s == null ? "" : s);
  }

  function pad2(n){
    const x = String(n);
    return x.length === 1 ? "0" + x : x;
  }

  function toYmd(d){
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1) + "-" + pad2(dt.getDate());
  }

  function toYm(d){
    const dt = d instanceof Date ? d : new Date(d);
    return dt.getFullYear() + "-" + pad2(dt.getMonth() + 1);
  }

  function addMonths(ym, delta){
    const m = String(ym || "");
    if (!/^\d{4}-\d{2}$/.test(m)) return toYm(new Date());
    const y = parseInt(m.slice(0, 4), 10);
    const mo = parseInt(m.slice(5, 7), 10);
    const dt = new Date(Date.UTC(y, mo - 1 + delta, 1));
    return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1);
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

  function setToken(t){
    try {
      if (!t) localStorage.removeItem(STORAGE_TOKEN);
      else localStorage.setItem(STORAGE_TOKEN, String(t));
    } catch {}
  }

  function storageGet(k){
    try { return localStorage.getItem(k) || ""; } catch { return ""; }
  }

  function storageSet(k, v){
    try { localStorage.setItem(k, String(v)); } catch {}
  }

  function storageDel(k){
    try { localStorage.removeItem(k); } catch {}
  }

  EIKON.el = el;
  EIKON.$ = qs;
  EIKON.utils = { el, qs, safeText, toYmd, toYm, addMonths };

  // ---------- Modal ----------
  let modalOverlay = null;

  function ensureModal(){
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

  function showModal(opts){
    const ov = ensureModal();
    ov._titleEl.textContent = safeText(opts.title || "Confirm");
    ov._textEl.textContent = safeText(opts.message || "");
    ov._actionsEl.innerHTML = "";

    const buttons = Array.isArray(opts.buttons) ? opts.buttons : [];
    for (const b of buttons){
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

  function hideModal(){
    const ov = ensureModal();
    ov.style.display = "none";
  }

  EIKON.showModal = function (title, message, buttons){
    showModal({ title, message, buttons });
  };

  EIKON.confirmDialog = function (title, message){
    return new Promise((resolve)=>{
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

  EIKON.modal = {
    alert(title, message){
      showModal({
        title,
        message,
        buttons: [{ label: "OK", kind: "primary" }]
      });
    }
  };

  // ---------- UI helpers ----------
  EIKON.toast = function (message, kind){
    const msg = safeText(message || "");
    if (!msg) return;
    const t = el("div", { class: "toast " + (kind || "") });
    t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => {
      if (t && t.parentNode) t.parentNode.removeChild(t);
    }, 3000);
  };

  EIKON.escapeHtml = function (s){
    return safeText(s).replace(/[&<>"']/g, (c) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[c]));
  };

  EIKON.todayYmd = function (){
    return toYmd(new Date());
  };

  EIKON.ymdToDmy = function (ymd){
    const v = safeText(ymd || "").trim();
    const parts = v.split("-");
    if (parts.length !== 3) return v;
    return parts[2] + "/" + parts[1] + "/" + parts[0];
  };

  EIKON.nowHmRound = function (){
    const d = new Date();
    const mins = d.getMinutes();
    const rounded = Math.round(mins / 5) * 5;
    d.setMinutes(rounded);
    d.setSeconds(0);
    return pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  };

  EIKON.monthAdd = function (ym, delta){
    return addMonths(ym, delta);
  };

  EIKON.tryPrintHtml = function (html, title){
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

  // ---------- Auth / API ----------
  EIKON.apiFetch = async function (path, opts){
    const o = opts || {};
    const method = (o.method || "GET").toUpperCase();
    const url = (path.startsWith("http://") || path.startsWith("https://"))
      ? path
      : (apiBase.replace(/\/+$/g, "") + "/" + path.replace(/^\/+/, ""));

    const headers = new Headers(o.headers || {});
    if (!headers.has("Content-Type") && o.json !== undefined) headers.set("Content-Type", "application/json");

    const token = getToken();
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
      setToken("");
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

  EIKON.login = async function (email, password){
    const data = await EIKON.apiFetch("/auth/login", {
      method: "POST",
      json: { email, password }
    });
    if (!data || !data.token) throw new Error("Login failed");
    setToken(data.token);
    return data;
  };

  EIKON.ensureMe = async function (){
    const token = getToken();
    if (!token) return null;
    try {
      const me = await EIKON.apiFetch("/auth/me", { method: "GET" });
      if (me && me.user) return me.user;
    } catch (e) {
      setToken("");
    }
    return null;
  };

  EIKON.logout = function (){
    setToken("");
    storageDel(STORAGE_LAST_MODULE);
  };

  EIKON.sidebarGetCollapsed = function (){
    return storageGet(STORAGE_SIDEBAR) === "1";
  };

  EIKON.sidebarSetCollapsed = function (collapsed){
    storageSet(STORAGE_SIDEBAR, collapsed ? "1" : "0");
  };

  // ---------- Modules registry ----------
  EIKON.registerModule = function (key, moduleObj){
    const k = safeText(key || "").trim();
    if (!k) return;
    EIKON.modules = EIKON.modules || {};
    EIKON.modules[k] = moduleObj || {};
  };

})();
