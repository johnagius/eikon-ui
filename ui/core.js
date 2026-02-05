(function(){
  "use strict";

  const EIKON = window.EIKON = window.EIKON || {};
  EIKON.version = "0.1.0";
  EIKON.modules = EIKON.modules || {};

  const cfg = window.EIKON_CONFIG || {};
  const apiBase = (cfg.apiBase || "").trim() || "https://eikon-api.labrint.workers.dev";
  EIKON.apiBase = apiBase;

  const STORAGE_TOKEN = "eikon_token";
  const STORAGE_QUEUE = "eikon_queue_v1";

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
  function qsa(sel, root){ return Array.from((root || document).querySelectorAll(sel)); }

  function safeJsonParse(s, fallback){
    try{ return JSON.parse(s); }catch(e){ return fallback; }
  }

  function getToken(){
    return localStorage.getItem(STORAGE_TOKEN) || "";
  }
  function setToken(t){
    if (!t) localStorage.removeItem(STORAGE_TOKEN);
    else localStorage.setItem(STORAGE_TOKEN, t);
  }

  function toast(title, message){
    let wrap = qs(".eikon-toast-wrap");
    if (!wrap){
      wrap = el("div", { class:"eikon-toast-wrap" });
      document.body.appendChild(wrap);
    }
    const card = el("div", { class:"eikon-toast" }, [
      el("div", { class:"t" }, title),
      el("div", { class:"m" }, message || "")
    ]);
    wrap.appendChild(card);
    setTimeout(()=>{ card.remove(); if (!wrap.children.length) wrap.remove(); }, 4200);
  }

  function showModal(opts){
    const title = (opts && opts.title) ? String(opts.title) : "Dialog";
    const bodyNode = (opts && opts.bodyNode) ? opts.bodyNode : el("div", {}, "");
    const buttons = (opts && opts.buttons) ? opts.buttons : [];
    const onClose = (opts && opts.onClose) ? opts.onClose : null;

    const overlay = el("div", { class:"eikon-overlay" });
    const modal = el("div", { class:"eikon-modal" });

    const header = el("div", { class:"eikon-modal-header" }, [
      el("div", { class:"title" }, title),
      el("button", { class:"eikon-x", type:"button", onclick: ()=>close(false) }, "×")
    ]);

    const body = el("div", { class:"eikon-modal-body" });
    body.appendChild(bodyNode);

    const footer = el("div", { class:"eikon-modal-footer" });
    buttons.forEach(b=>{
      const btn = el("button", {
        type:"button",
        class: "eikon-btn" + (b.kind === "secondary" ? " secondary" : "") + (b.kind === "danger" ? " danger" : ""),
        onclick: ()=> { if (b.onClick) b.onClick(close); }
      }, b.label || "OK");
      footer.appendChild(btn);
    });

    modal.appendChild(header);
    modal.appendChild(body);
    modal.appendChild(footer);
    overlay.appendChild(modal);

    function close(result){
      overlay.remove();
      if (typeof onClose === "function") onClose(result);
    }

    overlay.addEventListener("click", (e)=>{
      if (e.target === overlay) close(false);
    });

    document.body.appendChild(overlay);
    return { close };
  }

  function confirmDialog(title, message){
    return new Promise((resolve)=>{
      const body = el("div", {}, [
        el("div", { style:"color:var(--muted); line-height:1.45; font-size:14px;" }, String(message || "Are you sure?"))
      ]);
      showModal({
        title: title || "Confirm",
        bodyNode: body,
        buttons: [
          { label:"Cancel", kind:"secondary", onClick:(close)=>{ close(false); resolve(false); } },
          { label:"Yes", kind:"danger", onClick:(close)=>{ close(true); resolve(true); } }
        ],
        onClose:(r)=>resolve(!!r)
      });
    });
  }

  function setBusy(isBusy, text){
    let overlay = qs("#eikon-busy");
    if (!overlay){
      overlay = el("div", { id:"eikon-busy", class:"eikon-overlay eikon-hidden" });
      const box = el("div", { class:"eikon-modal", style:"max-width:520px" }, [
        el("div", { class:"eikon-modal-header" }, [
          el("div", { class:"title" }, "Working…"),
          el("div", { style:"width:36px;height:36px" }, "")
        ]),
        el("div", { class:"eikon-modal-body" }, [
          el("div", { id:"eikon-busy-text", style:"color:var(--muted); line-height:1.45" }, "Please wait…")
        ])
      ]);
      overlay.appendChild(box);
      document.body.appendChild(overlay);
    }
    const txt = qs("#eikon-busy-text", overlay);
    if (txt) txt.textContent = text || "Please wait…";
    if (isBusy) overlay.classList.remove("eikon-hidden");
    else overlay.classList.add("eikon-hidden");
  }

  async function apiFetch(path, options){
    const url = apiBase.replace(/\/+$/,"") + path;
    const opt = Object.assign({ method:"GET", headers:{} }, options || {});
    opt.headers = Object.assign({}, opt.headers || {});
    opt.headers["Content-Type"] = opt.headers["Content-Type"] || "application/json";

    const token = getToken();
    if (token) opt.headers["Authorization"] = "Bearer " + token;

    const controller = new AbortController();
    const timeoutMs = 20000;
    const t = setTimeout(()=>controller.abort(), timeoutMs);
    opt.signal = controller.signal;

    try{
      const r = await fetch(url, opt);
      clearTimeout(t);

      let j = null;
      try{ j = await r.json(); }catch(e){ j = null; }

      if (r.status === 401){
        // token invalid/expired
        setToken("");
      }
      return { ok: r.ok, status: r.status, json: j };
    }catch(e){
      clearTimeout(t);
      return { ok:false, status: 0, json: { ok:false, error: "Network error" }, error: e };
    }
  }

  function queueLoad(){
    const raw = localStorage.getItem(STORAGE_QUEUE) || "[]";
    const arr = safeJsonParse(raw, []);
    return Array.isArray(arr) ? arr : [];
  }

  function queueSave(arr){
    localStorage.setItem(STORAGE_QUEUE, JSON.stringify(arr || []));
  }

  function queueAdd(item){
    const q = queueLoad();
    q.push(Object.assign({ added_at: new Date().toISOString() }, item));
    queueSave(q);
  }

  async function flushQueue(){
    const q = queueLoad();
    if (!q.length) return { ok:true, sent:0, left:0 };

    // Only flush if we have a token
    const token = getToken();
    if (!token) return { ok:false, sent:0, left:q.length };

    let sent = 0;
    const remaining = [];

    for (let i=0;i<q.length;i++){
      const it = q[i];

      // Only temperature module queue in this MVP
      if (it && it.type === "temp_upsert"){
        const res = await apiFetch("/temperature/entries", {
          method:"POST",
          body: JSON.stringify(it.payload || {})
        });
        if (res.ok && res.json && res.json.ok){
          sent++;
        } else {
          // keep it (try later)
          remaining.push(it);
        }
      } else if (it && it.type === "temp_delete"){
        const entryId = it.entry_id;
        const res = await apiFetch("/temperature/entries/" + encodeURIComponent(entryId), {
          method:"DELETE"
        });
        if (res.ok && res.json && res.json.ok){
          sent++;
        } else {
          remaining.push(it);
        }
      } else {
        // unknown queue item: keep to avoid data loss
        remaining.push(it);
      }
    }

    queueSave(remaining);
    return { ok:true, sent, left: remaining.length };
  }

  let flushTimer = null;
  function startQueueFlusher(){
    if (flushTimer) return;
    flushTimer = setInterval(()=>{
      if (navigator.onLine) flushQueue().catch(()=>{});
    }, 8000);
    window.addEventListener("online", ()=>{ flushQueue().catch(()=>{}); });
  }

  async function authMe(){
    const res = await apiFetch("/auth/me", { method:"GET" });
    if (res.ok && res.json && res.json.ok) return res.json.user;
    return null;
  }

  async function login(email, password){
    const res = await apiFetch("/auth/login", {
      method:"POST",
      body: JSON.stringify({ email, password })
    });
    if (res.ok && res.json && res.json.ok && res.json.token){
      setToken(res.json.token);
      return res.json.user || null;
    }
    return null;
  }

  function logout(){
    setToken("");
    toast("Logged out", "You have been logged out.");
  }

  function renderLogin(root, onLoggedIn){
    root.innerHTML = "";
    const wrap = el("div", { class:"eikon-login-wrap" });
    const card = el("div", { class:"eikon-login" });

    const head = el("div", { class:"head" }, [
      el("div", { class:"mark" }),
      el("div", {}, [
        el("div", { class:"title" }, "Eikon"),
        el("div", { class:"sub" }, "Secure pharmacy processes (MVP)")
      ])
    ]);

    const emailIn = el("input", { class:"eikon-input", type:"email", placeholder:"Email", autocomplete:"username" });
    const passIn = el("input", { class:"eikon-input", type:"password", placeholder:"Password", autocomplete:"current-password" });

    const body = el("div", { class:"body" }, [
      el("div", { class:"eikon-label" }, "Email"),
      emailIn,
      el("div", { class:"eikon-label" }, "Password"),
      passIn
    ]);

    const btn = el("button", { class:"eikon-btn", type:"button" }, "Log in");
    const fine = el("div", { class:"fine" }, "If you forget credentials, contact your administrator.");
    const footer = el("div", { class:"footer" }, [
      btn,
      fine
    ]);

    btn.addEventListener("click", async ()=>{
      const email = (emailIn.value || "").trim().toLowerCase();
      const password = (passIn.value || "").trim();
      if (!email || !password){
        toast("Missing details", "Please enter email and password.");
        return;
      }
      setBusy(true, "Logging in…");
      const user = await login(email, password);
      setBusy(false);
      if (!user){
        toast("Login failed", "Invalid email or password.");
        return;
      }
      startQueueFlusher();
      if (typeof onLoggedIn === "function") onLoggedIn(user);
    });

    passIn.addEventListener("keydown", (e)=>{ if (e.key === "Enter") btn.click(); });

    card.appendChild(head);
    card.appendChild(body);
    card.appendChild(footer);

    wrap.appendChild(card);
    root.appendChild(wrap);
  }

  EIKON.ui = {
    el, qs, qsa, toast, showModal, confirmDialog, setBusy
  };

  EIKON.auth = {
    getToken, setToken, authMe, login, logout, renderLogin
  };

  EIKON.api = {
    fetch: apiFetch
  };

  EIKON.queue = {
    add: queueAdd,
    flush: flushQueue,
    start: startQueueFlusher,
    load: queueLoad
  };

})();
