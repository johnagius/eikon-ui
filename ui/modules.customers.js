/* ============================================================
   EIKON — Customers  (modules.customers.js)
   One person, one row. Built on the shared people routes:
     GET  /people?q=        people first, then people found only in history
     GET  /people/:id       the person and their story across every register
     POST /people           create, adopt from history, or update with a version
   - Search as you type; a name, an ID card or a phone number all work
   - A customer who only exists in old registers is adopted with one tap
   - Nothing says "Saved" before the server says so; a stale edit is shown, not lost
   - Registers stay one tap away, with the person carried across
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var state = { mount: null, q: "", results: null, loading: false, error: "", selected: null, detail: null, detailLoading: false, editing: false, saving: false, timer: null, seq: 0 };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
  }
  function hue(name) { var h = 0; for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360; return h; }
  function av(name, cls) { return '<span class="cus-av ' + (cls || "") + '" style="background:hsl(' + hue(name) + ' 55% 42%)">' + esc(initials(name)) + '</span>'; }
  function when(ymd) {
    if (!ymd) return "";
    var t = new Date(); var today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    if (ymd === today) return "today";
    var d = new Date(ymd + "T12:00:00"); if (!isFinite(d.getTime())) return ymd;
    var diff = Math.round((new Date(today + "T12:00:00") - d) / 86400000);
    if (diff === 1) return "yesterday";
    if (diff > 1 && diff < 7) return diff + " days ago";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) + (d.getFullYear() !== t.getFullYear() ? " " + d.getFullYear() : "");
  }
  function nextWhen(ymd) {
    var t = new Date(); var today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    if (ymd === today) return "Today";
    var d = new Date(ymd + "T12:00:00"); if (!isFinite(d.getTime())) return ymd;
    var diff = Math.round((d - new Date(today + "T12:00:00")) / 86400000);
    if (diff === 1) return "Tomorrow";
    if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function sourceWords(sources) {
    var names = { order: "order", question: "question", delivery: "delivery", dda_sale: "DDA sale", poyc: "POYC", repeat: "repeat prescription", poct: "POCT", loyalty: "loyalty card", appointment: "appointment", waitlist: "waiting list", calculator: "calculator" };
    return Object.keys(sources || {}).map(function (k) { var n = sources[k]; return n + " " + names[k] + (n === 1 || names[k].slice(-1) === "s" || k === "poyc" ? "" : "s"); }).join(", ");
  }
  function kindMeta(kind) {
    return ({ order: ["Order", "#clientorders", "blu"], question: ["Question", "#tickets", "amb"], delivery: ["Delivery", "#deliveries", "blu"], dda_sale: ["DDA sale", "#dda-sales", "red"], poyc: ["POYC", "#dda-poyc", "red"],
      repeat: ["Repeat prescription", "#repeatprescriptions", "grn"], poct: ["POCT", "#poct", "grn"], loyalty: ["Loyalty", "#loyalty", "gry"], appointment: ["Appointment", "#appointments", "blu"], waitlist: ["Waiting list", "#appointments", "gry"], calculator: ["Calculator", "#pharmacycalc", "gry"] })[kind] || [kind, "#dashboard", "gry"];
  }

  function injectCss() {
    if (document.getElementById("eikon-customers-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-customers-css";
    st.textContent =
      ".cus{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:360px minmax(0,1fr);gap:18px;align-items:start}" +
      ".cus-back{display:none}@media (max-width:900px){.cus{grid-template-columns:1fr}.cus-detail{order:-1}.cus-pick{display:none}.cus.has-sel .cus-side{display:none}.cus-back{display:inline-block;border:0;background:none;color:var(--accent);font:inherit;font-size:16px;font-weight:500;padding:4px 0 12px;cursor:pointer}}@media (max-width:600px){.cus{padding:0 16px}}" +
      ".cus-search{display:flex;align-items:center;gap:10px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:0 14px;height:48px}" +
      ".cus-search input{flex:1;border:0;outline:0;background:transparent;color:var(--text);font-size:15.5px;min-width:0}.cus-search input::placeholder{color:var(--muted)}" +
      ".cus-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 7px;display:flex;gap:8px;align-items:center}.cus-lab b{color:var(--text)}.cus-lab a{margin-left:auto;color:var(--accent);font-weight:600;text-transform:none;letter-spacing:0;font-size:12.5px;cursor:pointer}" +
      ".cus-list{display:flex;flex-direction:column;gap:8px}" +
      ".cus-item{display:flex;align-items:center;gap:12px;padding:11px 12px;border:1px solid var(--border);border-radius:12px;background:var(--panel2);cursor:pointer;text-align:left;width:100%;color:var(--text)}" +
      ".cus-item:hover{border-color:rgba(31,95,216,.45)}.cus-item.on{border-color:var(--accent);box-shadow:0 0 0 2px var(--shadow,rgba(31,95,216,.14));background:rgba(31,95,216,.05)}" +
      ".cus-av{width:38px;height:38px;border-radius:50%;flex:none;display:grid;place-items:center;font-weight:700;font-size:13px;color:#fff}.cus-av.lg{width:62px;height:62px;font-size:21px}.cus-av.ghost{background:rgba(127,127,127,.18)!important;color:var(--muted)}" +
      ".cus-t{flex:1;min-width:0}.cus-t b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cus-t span{display:block;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".cus-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}.cus-pill.blu{background:rgba(31,95,216,.14);color:var(--accent)}.cus-pill.grn{background:rgba(28,138,91,.16);color:var(--ok)}.cus-pill.amb{background:rgba(201,138,18,.16);color:#A06A0E}.cus-pill.red{background:rgba(191,59,46,.14);color:var(--danger)}" +
      ".cus-btn{font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--panel);white-space:nowrap;color:var(--text);cursor:pointer}.cus-btn:disabled{opacity:.55;cursor:default}.cus-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.cus-btn.sm{padding:6px 10px;font-size:12.5px}" +
      ".cus-quiet{border:1px dashed var(--border);border-radius:12px;padding:20px;color:var(--muted);font-size:13.5px;line-height:1.5;background:var(--panel2)}" +
      ".cus-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:18px 20px}" +
      ".cus-head{display:flex;gap:16px;align-items:flex-start}.cus-head h1{font-size:26px;letter-spacing:-.025em;margin:0 0 6px;line-height:1.1;font-weight:800}.cus-meta{display:flex;gap:8px;flex-wrap:wrap;align-items:center;font-size:14px;color:var(--muted)}.cus-meta b{color:var(--text);font-weight:600}" +
      ".cus-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:0 18px;margin:16px 0 0;padding-top:14px;border-top:1px solid var(--border)}.cus-facts div{padding:4px 0}.cus-facts small{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:3px}.cus-facts span{font-size:15px;font-weight:600;word-break:break-word}.cus-facts span.none{color:var(--muted);font-weight:500}" +
      ".cus-actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}.cus-actions .right{margin-left:auto}" +
      ".cus-grid{display:grid;grid-template-columns:minmax(0,1.4fr) minmax(0,1fr);gap:16px;margin-top:16px}@media (max-width:1100px){.cus-grid{grid-template-columns:1fr}}" +
      ".cus-story{list-style:none;margin:0;padding:0}.cus-story li{display:flex;gap:10px;padding:10px 0;border-top:1px solid var(--border);align-items:flex-start}.cus-story li:first-child{border-top:0;padding-top:4px}.cus-story i{width:9px;height:9px;border-radius:50%;flex:none;margin-top:6px;background:var(--muted)}.cus-story i.blu{background:var(--accent)}.cus-story i.grn{background:var(--ok)}.cus-story i.amb{background:#C98A12}.cus-story i.red{background:var(--danger)}" +
      ".cus-story .t{flex:1;min-width:0}.cus-story .t b{display:block;font-size:14px;font-weight:600;letter-spacing:-.01em}.cus-story .t span{font-size:12.5px;color:var(--muted)}.cus-story .d{font-size:12.5px;color:var(--muted);white-space:nowrap}" +
      ".cus-counts{display:flex;gap:6px;flex-wrap:wrap}.cus-counts a{height:30px;padding:0 11px;border-radius:8px;border:1px solid var(--border);background:var(--panel);display:inline-flex;align-items:center;font-size:12.5px;font-weight:600;color:var(--text);cursor:pointer;gap:6px}.cus-counts a b{color:var(--muted);font-weight:600}" +
      ".cus-form{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px;margin-top:14px}@media (max-width:700px){.cus-form{grid-template-columns:1fr}}.cus-form label{display:block;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin-bottom:4px}.cus-form .w{grid-column:1/-1}" +
      ".cus-form input,.cus-form textarea{width:100%;box-sizing:border-box;height:38px;border:1px solid var(--border);border-radius:9px;background:var(--bg);padding:0 10px;color:var(--text);font-size:14px}.cus-form textarea{height:70px;padding:8px 10px;resize:vertical}.cus-form input:focus,.cus-form textarea:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--shadow,rgba(31,95,216,.18))}" +
      ".cus-warn{background:rgba(201,138,18,.14);border:1px solid rgba(201,138,18,.35);color:#A06A0E;border-radius:10px;padding:8px 12px;font-size:13px;margin-top:12px}" +
      ".cus-src{font-size:12px;color:var(--muted);margin-top:6px}" +
      ".cus-regs{display:flex;gap:4px 12px;flex-wrap:wrap;align-items:center;margin-top:18px;padding-top:12px;border-top:1px solid var(--border);font-size:12.5px}.cus-regs span{color:var(--muted);font-weight:700;letter-spacing:.08em;text-transform:uppercase;font-size:11px;margin-right:4px}.cus-regs a{color:var(--accent);font-weight:600;cursor:pointer}";
    document.head.appendChild(st);
  }

  // ---------- data ----------
  async function search(q) {
    var mySeq = ++state.seq;
    state.loading = true; state.error = "";
    renderList();
    try {
      var r = await E.apiFetch("/people?q=" + encodeURIComponent(q) + "&limit=30", { method: "GET", timeoutMs: 12000 });
      if (mySeq !== state.seq) return;
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not search");
      state.results = r;
    } catch (e) {
      if (mySeq !== state.seq) return;
      state.error = (e && e.network) ? "Can't reach the server." : String(e && (e.message || e) || "Could not search");
    }
    state.loading = false;
    renderList();
  }

  async function open(id) {
    state.selected = id; state.detail = null; state.detailLoading = true; state.editing = false;
    renderList(); renderDetail();
    try {
      var r = await E.apiFetch("/people/" + id, { method: "GET", timeoutMs: 12000 });
      if (state.selected !== id) return;
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not open");
      state.detail = r;
      if (r.person && r.person.id !== id) state.selected = r.person.id; // merged record opened its survivor
    } catch (e) {
      if (state.selected !== id) return;
      state.detail = { error: (e && e.network) ? "Can't reach the server." : String(e && (e.message || e) || "Could not open") };
    }
    state.detailLoading = false;
    renderDetail();
  }

  async function adopt(h, btn) {
    if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    try {
      var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify({ name: h.name, id_card: h.id_card || "", phone: h.phone || "", alt_phone: h.alt_phone || "", email: h.email || "", address: h.address || "", doctor_name: h.doctor_name || "", source: "history" }) });
      if (!r || !r.ok || !r.person) throw new Error((r && r.error) || "Could not add");
      E.toast(r.created ? h.name + " added to Customers" : h.name + " was already a customer", "success");
      await search(state.q);
      open(r.person.id);
    } catch (e) {
      if (btn) { btn.disabled = false; btn.textContent = "Add"; }
      E.toast("Not added: " + String(e && (e.message || e) || "error"), "error");
    }
  }

  async function save(form) {
    if (state.saving || !state.detail || !state.detail.person) return;
    var p = state.detail.person;
    var body = { id: p.id, version: p.version };
    ["name", "id_card", "phone", "alt_phone", "email", "address", "doctor_name", "date_of_birth", "notes"].forEach(function (k) { var el = form.querySelector("[name=" + k + "]"); if (el) body[k] = el.value; });
    if (!String(body.name || "").trim()) return E.toast("Enter the person's name. Nothing was saved.", "warn");
    state.saving = true;
    var btn = form.querySelector("[data-act=save]"); if (btn) { btn.disabled = true; btn.textContent = "Saving…"; }
    try {
      var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok || !r.person) throw new Error((r && r.error) || "Save failed");
      state.detail.person = r.person; state.editing = false;
      E.toast("Saved " + r.person.name, "success");
      search(state.q);
      renderDetail();
    } catch (e) {
      var j = e && e.bodyJson;
      if (e && e.status === 409 && j && j.current) {
        // Someone else saved first. Show their version; the typed change stays on screen in the toast.
        state.detail.person = j.current; state.editing = true;
        state.conflict = "Someone else changed this record while you were editing. Their version is shown below; make your change again.";
        renderDetail();
      } else if (e && e.status === 409 && j && j.existing) {
        state.conflict = "Another customer already has this ID card: " + j.existing.name + ". Open them instead, or merge the two.";
        state.conflictExisting = j.existing;
        renderDetail();
      } else {
        E.toast("Not saved: " + String(e && (e.message || e) || "error"), "error");
        if (btn) { btn.disabled = false; btn.textContent = "Save"; }
      }
    } finally { state.saving = false; }
  }

  async function createNew(form) {
    var body = {};
    ["name", "id_card", "phone", "email", "address"].forEach(function (k) { var el = form.querySelector("[name=" + k + "]"); if (el) body[k] = el.value; });
    if (!String(body.name || "").trim()) return E.toast("Enter the person's name. Nothing was saved.", "warn");
    var btn = form.querySelector("[data-act=create]"); if (btn) { btn.disabled = true; btn.textContent = "Adding…"; }
    try {
      var r = await E.apiFetch("/people", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok || !r.person) throw new Error((r && r.error) || "Could not add");
      E.toast(r.created ? r.person.name + " added" : r.person.name + " already exists, opened", "success");
      state.creating = false;
      await search(state.q);
      open(r.person.id);
    } catch (e) {
      E.toast("Not added: " + String(e && (e.message || e) || "error"), "error");
      if (btn) { btn.disabled = false; btn.textContent = "Add customer"; }
    }
  }

  // Carry the person into a register so nobody types the name a fourth time.
  function carry(hash) {
    var p = state.detail && state.detail.person;
    if (p && E.carryPerson) E.carryPerson(p);
    try { sessionStorage.setItem("eikon_ui2_return", "customers"); } catch (e) {}
    E.openClassic(hash);
  }

  // ---------- render ----------
  function render() {
    var m = state.mount; if (!m) return;
    m.innerHTML = '<div class="cus"><div class="cus-side">' +
      '<div class="cus-search"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="color:rgba(60,60,67,.55);flex:none;display:block"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span><input id="cus-q" type="search" autocomplete="off" placeholder="Name, ID card or phone" value="' + esc(state.q) + '"></div>' +
      '<div id="cus-list"></div>' +
      '<div class="cus-regs"><span>Registers</span>' + [["clientorders", "Orders"], ["tickets", "Questions"], ["deliveries", "Deliveries"], ["appointments", "Appointments"], ["loyalty", "Loyalty"]].filter(function (x) { return E.modules[x[0]]; }).map(function (x) { return '<a data-reg="' + x[0] + '">' + x[1] + '</a>'; }).join("") + '</div>' +
      '</div><div class="cus-detail" id="cus-detail"></div></div>';
    m.querySelectorAll("[data-reg]").forEach(function (el) { el.addEventListener("click", function () { try { sessionStorage.setItem("eikon_ui2_return", "customers"); } catch (e) {} E.openClassic(el.getAttribute("data-reg")); }); });
    var q = m.querySelector("#cus-q");
    q.addEventListener("input", function () {
      state.q = q.value;
      if (state.timer) clearTimeout(state.timer);
      state.timer = setTimeout(function () { search(state.q.trim()); }, 220);
    });
    q.addEventListener("keydown", function (e) {
      if (e.key === "Enter") {
        if (state.timer) clearTimeout(state.timer);
        search(state.q.trim()).then(function () {
          var first = state.results && (state.results.people[0]);
          if (first) open(first.id);
        });
      }
      if (e.key === "Escape") { q.value = ""; state.q = ""; search(""); }
    });
    renderList(); renderDetail();
    search(state.q.trim());
    setTimeout(function () { try { q.focus(); } catch (e) {} }, 0);
  }

  function renderList() {
    var m = state.mount; if (!m) return;
    var box = m.querySelector("#cus-list"); if (!box) return;
    var r = state.results;
    var html = "";
    if (state.error) html += '<div class="cus-warn">' + esc(state.error) + ' <a data-act="retry" style="cursor:pointer;font-weight:600">Try again</a></div>';
    if (!r) { box.innerHTML = html + (state.loading ? '<div class="cus-lab">Searching…</div>' : ""); bindList(); return; }
    var people = r.people || [], hist = r.history || [];
    var qq = String(r.q || "").trim();
    html += '<div class="cus-lab">' + (qq ? 'Customers <b>' + people.length + '</b>' : 'Recent customers') + (state.loading ? ' · searching…' : '') + '<a data-act="new">+ New</a></div>';
    if (people.length) {
      html += '<div class="cus-list">' + people.map(function (p) {
        var sub = [p.phone, p.id_card].filter(Boolean).join(" · ") || p.email || p.address || "No details yet";
        return '<button class="cus-item' + (p.id === state.selected ? " on" : "") + '" data-person="' + p.id + '">' + av(p.name) + '<span class="cus-t"><b>' + esc(p.name) + '</b><span>' + esc(sub) + '</span></span></button>';
      }).join("") + '</div>';
    } else if (qq && !state.loading && !hist.length) {
      html += '<div class="cus-quiet">No one called “' + esc(qq) + '” yet.<br><a data-act="new" style="color:var(--accent);font-weight:600;cursor:pointer">Add them as a new customer ›</a></div>';
    } else if (!qq && !state.loading) {
      html += '<div class="cus-quiet">Type a name, an ID card or a phone number. Customers who only exist in older registers appear under <b>From history</b> and join with one tap.</div>';
    }
    if (hist.length) {
      html += '<div class="cus-lab">From history <b>' + hist.length + '</b></div><div class="cus-list">' + hist.map(function (h, i) {
        var sub = [h.phone, h.id_card].filter(Boolean).join(" · ");
        return '<div class="cus-item" data-hist="' + i + '">' + av(h.name, "ghost") + '<span class="cus-t"><b>' + esc(h.name) + '</b><span>' + esc(sub ? sub + " · " : "") + esc(sourceWords(h.sources)) + (h.last_date ? ", last " + esc(when(h.last_date)) : "") + '</span></span><button class="cus-btn sm p" data-adopt="' + i + '">Add</button></div>';
      }).join("") + '</div>';
    }
    box.innerHTML = html;
    bindList();
  }

  function bindList() {
    var m = state.mount; if (!m) return;
    m.querySelectorAll("[data-person]").forEach(function (el) { el.addEventListener("click", function () { open(Number(el.getAttribute("data-person"))); }); });
    m.querySelectorAll("[data-adopt]").forEach(function (el) { el.addEventListener("click", function (e) { e.stopPropagation(); adopt(state.results.history[Number(el.getAttribute("data-adopt"))], el); }); });
    m.querySelectorAll("[data-hist]").forEach(function (el) { el.addEventListener("click", function () { var b = el.querySelector("[data-adopt]"); if (b && !b.disabled) adopt(state.results.history[Number(el.getAttribute("data-hist"))], b); }); });
    m.querySelectorAll('[data-act="retry"]').forEach(function (el) { el.addEventListener("click", function () { search(state.q.trim()); }); });
    m.querySelectorAll('[data-act="new"]').forEach(function (el) { el.addEventListener("click", function () { state.creating = true; state.selected = null; state.detail = null; renderList(); renderDetail(); }); });
  }

  function field(label, name, value, type, wide) {
    return '<div' + (wide ? ' class="w"' : "") + '><label for="cus-f-' + name + '">' + label + '</label>' + (type === "textarea" ? '<textarea id="cus-f-' + name + '" name="' + name + '">' + esc(value) + '</textarea>' : '<input id="cus-f-' + name + '" name="' + name + '" type="' + (type || "text") + '" value="' + esc(value) + '" autocomplete="off">') + '</div>';
  }

  // On narrow screens an open customer replaces the list (iOS style), with "‹ Customers" to go back.
  function renderDetail() {
    renderDetailInner();
    var m = state.mount; if (!m) return;
    var wrap = m.querySelector(".cus"), box = m.querySelector("#cus-detail"); if (!wrap || !box) return;
    var open = !!(state.selected || state.creating), was = wrap.classList.contains("has-sel");
    wrap.classList.toggle("has-sel", open);
    if (open && !box.querySelector(".cus-back")) {
      var b = document.createElement("button"); b.type = "button"; b.className = "cus-back"; b.textContent = "‹ Customers";
      b.addEventListener("click", function () { state.selected = null; state.creating = false; state.detail = null; state.editing = false; renderList(); renderDetail(); });
      box.insertBefore(b, box.firstChild);
    }
    if (open && !was && window.matchMedia && window.matchMedia("(max-width:900px)").matches) try { window.scrollTo(0, 0); } catch (e) {}
  }
  function renderDetailInner() {
    var m = state.mount; if (!m) return;
    var box = m.querySelector("#cus-detail"); if (!box) return;
    if (state.creating) {
      box.innerHTML = '<form class="cus-card" id="cus-new"><div class="cus-lab" style="margin-top:0">New customer</div>' +
        '<div class="cus-form">' + field("Name", "name", state.q && !/\d/.test(state.q) ? state.q : "", "text", true) + field("ID card", "id_card", /^\d{1,7}\s*[a-zA-Z]$/.test(state.q.trim()) ? state.q.trim() : "") + field("Phone", "phone", /^[\d\s+]+$/.test(state.q.trim()) ? state.q.trim() : "", "tel") + field("E-mail", "email", "", "email") + field("Address", "address", "", "text", true) + '</div>' +
        '<div class="cus-actions"><button type="submit" class="cus-btn p" data-act="create">Add customer</button><button type="button" class="cus-btn" data-act="cancel">Cancel</button></div></form>';
      var f = box.querySelector("#cus-new");
      f.addEventListener("submit", function (e) { e.preventDefault(); createNew(f); });
      f.querySelector('[data-act="cancel"]').addEventListener("click", function () { state.creating = false; renderDetail(); });
      setTimeout(function () { try { f.querySelector("[name=name]").focus(); } catch (e) {} }, 0);
      return;
    }
    if (!state.selected) {
      box.innerHTML = '<div class="cus-quiet cus-pick" style="padding:34px;text-align:center">Pick a customer on the left, or search for one.<br><span style="font-size:12.5px">Everything the pharmacy has done with them, in one place.</span></div>';
      return;
    }
    if (state.detailLoading && !state.detail) { box.innerHTML = '<div class="cus-card"><div class="cus-lab" style="margin:0">Opening…</div></div>'; return; }
    var d = state.detail || {};
    if (d.error) { box.innerHTML = '<div class="cus-card"><div class="cus-warn">' + esc(d.error) + '</div><div class="cus-actions"><button class="cus-btn" data-act="reopen">Try again</button></div></div>'; box.querySelector('[data-act="reopen"]').addEventListener("click", function () { open(state.selected); }); return; }
    var p = d.person || {}, act = d.activity || [], counts = d.counts || {};
    var html = '<div class="cus-card">';
    html += '<div class="cus-head">' + av(p.name, "lg") + '<div style="flex:1;min-width:0"><h1>' + esc(p.name) + '</h1><div class="cus-meta">' +
      (p.phone ? '<b>' + esc(p.phone) + '</b>' : '<span>No phone</span>') + (p.id_card ? '<span class="cus-pill">' + esc(p.id_card) + '</span>' : "") + (d.loyalty ? '<span class="cus-pill">Loyalty · ' + esc(Number(d.loyalty.points || 0).toLocaleString("en-GB")) + ' pts</span>' : counts.loyalty ? '<span class="cus-pill">Loyalty card</span>' : "") + (counts.repeat ? '<span class="cus-pill grn">Repeat prescription</span>' : "") + (p.merged_from ? '<span class="cus-pill amb">Merged record opened</span>' : "") +
      '</div></div>' + (state.editing ? "" : '<button class="cus-btn" data-act="edit">Edit</button>') + '</div>';
    if (state.conflict) { html += '<div class="cus-warn">' + esc(state.conflict) + (state.conflictExisting ? ' <a data-person="' + state.conflictExisting.id + '" style="cursor:pointer;font-weight:600">Open ' + esc(state.conflictExisting.name) + ' ›</a>' : "") + '</div>'; }
    if (state.editing) {
      html += '<form id="cus-edit"><div class="cus-form">' + field("Name", "name", p.name, "text", true) + field("ID card", "id_card", p.id_card) + field("Date of birth", "date_of_birth", p.date_of_birth, "date") + field("Phone", "phone", p.phone, "tel") + field("Other phone", "alt_phone", p.alt_phone, "tel") + field("E-mail", "email", p.email, "email") + field("Doctor", "doctor_name", p.doctor_name) + field("Address", "address", p.address, "text", true) + field("Notes", "notes", p.notes, "textarea", true) + '</div>' +
        '<div class="cus-actions"><button type="submit" class="cus-btn p" data-act="save">Save</button><button type="button" class="cus-btn" data-act="cancel">Cancel</button></div></form>';
    } else {
      var fact = function (l, v) { return '<div><small>' + l + '</small><span' + (v ? "" : ' class="none"') + '>' + (v ? esc(v) : "–") + '</span></div>'; };
      var last = act[0];
      var na = d.next_appointment;
      html += '<div class="cus-facts">' + fact("Last visit", last ? when(last.date) + " · " + kindMeta(last.kind)[0] : "") + (na ? fact("Next appointment", nextWhen(na.date) + (na.time ? " " + na.time : "") + (na.doctor ? " · " + na.doctor : "")) : "") + fact("Address", p.address) + fact("Doctor", p.doctor_name) + fact("E-mail", p.email) + (p.notes ? fact("Notes", p.notes) : "") + '</div>';
      html += '<div class="cus-actions"><button class="cus-btn p" data-carry="#clientorders">New order</button><button class="cus-btn" data-carry="#tickets">Question</button><button class="cus-btn" data-carry="#deliveries">Delivery</button>' + (E.modules.bookings && E.isUi2 && E.isUi2() ? '<button class="cus-btn" data-act="book">Booking</button>' : '<button class="cus-btn" data-carry="#appointments">Appointment</button>') + '</div>';
    }
    html += '</div>';

    html += '<div class="cus-grid"><div class="cus-card"><div class="cus-lab" style="margin-top:0">Story' + (act.length ? ' <b>' + act.length + '</b>' : "") + '</div>';
    if (act.length) {
      html += '<ul class="cus-story">' + act.slice(0, 40).map(function (a) {
        var km = kindMeta(a.kind);
        return '<li><i class="' + km[2] + '"></i><div class="t"><b>' + esc(km[0]) + (a.title ? ' · ' + esc(a.title) : "") + '</b><span>' + esc([a.ref, a.doctor ? "Dr " + String(a.doctor).replace(/^dr\.?\s*/i, "") : ""].filter(Boolean).join(" · ")) + '</span></div><span class="d">' + esc(when(a.date)) + '</span></li>';
      }).join("") + '</ul>';
    } else {
      html += '<div class="cus-quiet">Nothing recorded yet. Orders, questions, deliveries, DDA sales, repeat prescriptions and appointments for ' + esc(p.name) + ' will show here.</div>';
    }
    html += '</div><div class="cus-card"><div class="cus-lab" style="margin-top:0">In the registers</div>';
    var ck = Object.keys(counts).filter(function (k) { return counts[k]; });
    html += ck.length ? '<div class="cus-counts">' + ck.map(function (k) { var km = kindMeta(k); return '<a data-carry="' + km[1] + '">' + esc(km[0]) + ' <b>' + counts[k] + '</b></a>'; }).join("") + '</div>' : '<div class="cus-src">Not in any register yet.</div>';
    html += '<div class="cus-src">' + (p.source && p.source.indexOf("history") === 0 ? "Added from the registers" : "Added by hand") + (p.updated_at ? ", last changed " + esc(when(String(p.updated_at).slice(0, 10))) : "") + '.</div>';
    html += '</div></div>';
    box.innerHTML = html;

    var eb = box.querySelector('[data-act="edit"]'); if (eb) eb.addEventListener("click", function () { state.editing = true; state.conflict = ""; state.conflictExisting = null; renderDetail(); setTimeout(function () { try { box.querySelector("[name=name]").focus(); } catch (e) {} }, 0); });
    var f = box.querySelector("#cus-edit");
    if (f) {
      f.addEventListener("submit", function (e) { e.preventDefault(); save(f); });
      f.querySelector('[data-act="cancel"]').addEventListener("click", function () { state.editing = false; state.conflict = ""; state.conflictExisting = null; renderDetail(); });
    }
    box.querySelectorAll("[data-carry]").forEach(function (el) { el.addEventListener("click", function () { carry(el.getAttribute("data-carry")); }); });
    box.querySelectorAll('[data-act="book"]').forEach(function (el) { el.addEventListener("click", function () {
      var p = (state.detail && state.detail.person) || {};
      try { sessionStorage.setItem("eikon_bk_carry", JSON.stringify({ name: p.name || "", phone: p.phone || "", email: p.email || "" })); } catch (e) {}
      location.hash = "#bookings";
    }); });
    box.querySelectorAll("[data-person]").forEach(function (el) { el.addEventListener("click", function () { state.conflict = ""; state.conflictExisting = null; open(Number(el.getAttribute("data-person"))); }); });
  }

  async function render0(ctx) {
    state.mount = ctx && ctx.mount;
    state.creating = false; state.conflict = ""; state.conflictExisting = null;
    try { var carried = sessionStorage.getItem("eikon_customers_q"); if (carried) { state.q = carried; sessionStorage.removeItem("eikon_customers_q"); } } catch (e) {}
    injectCss();
    render();
  }
  function destroy() { if (state.timer) { clearTimeout(state.timer); state.timer = null; } state.seq++; }

  E.registerModule({ id: "customers", title: "Customers", order: 1, icon: "◯", ui2Only: true, render: render0, destroy: destroy });
})();
