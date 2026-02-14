/* ui/modules.clientorders.js
   Eikon - Client Orders module (UI)

   Endpoints (Worker):
     GET    /client-orders/entries?month=YYYY-MM
     POST   /client-orders/entries
     PUT    /client-orders/entries/:id
     DELETE /client-orders/entries/:id

   Notes:
   - Cloud (API) is ALWAYS preferred.
   - LocalStorage is used only when endpoints are missing (404) or network/offline.
   - HTTP 500 does NOT fall back by default (prevents split-brain). You can opt-in via co_allow500=1.
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.clientorders.js)");

  // ------------------------------------------------------------
  // Debug helpers (in-module ring buffer + optional UI panel)
  // ------------------------------------------------------------
  var LOG_MAX = 80;
  var logBuf = [];
  var reqSeq = 0;

  function tsIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function pushLog(level, msg, obj) {
    try {
      var line = "[" + tsIso() + "] " + level + " " + msg;
      if (obj !== undefined) {
        try { line += " " + JSON.stringify(obj); } catch (e2) { line += " " + String(obj); }
      }
      logBuf.push(line);
      if (logBuf.length > LOG_MAX) logBuf.shift();
      // also send to core logger
      if (level === "ERROR") {
        if (E && typeof E.error === "function") E.error(msg, obj);
        else console.error(msg, obj);
      } else {
        if (E && typeof E.dbg === "function") E.dbg(msg, obj);
        else console.log(msg, obj);
      }
      // best-effort update panel
      try { if (state && typeof state.renderDebugPanel === "function") state.renderDebugPanel(); } catch (e3) {}
    } catch (e) {}
  }

  function dbg(msg, obj) { pushLog("DBG", msg, obj); }
  function warn(msg, obj) { pushLog("WARN", msg, obj); }
  function err(msg, obj) { pushLog("ERROR", msg, obj); }

  function esc(s) {
    try {
      return E.escapeHtml(String(s == null ? "" : s));
    } catch (e) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }
  }

  function pad2(n) {
    var v = String(n);
    return v.length === 1 ? "0" + v : v;
  }

  function toYmd(d) {
    try {
      return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
    } catch (e) {
      return "";
    }
  }

  function todayYmd() { return toYmd(new Date()); }

  function addDaysYmd(days) {
    var d = new Date();
    d.setDate(d.getDate() + (Number(days) || 0));
    return toYmd(d);
  }

  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }

  function fmtDmyFromYmd(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }

  function ymNow() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1);
  }

  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }

  function clampStr(s, max) {
    var v = String(s == null ? "" : s);
    if (v.length <= max) return v;
    return v.slice(0, max);
  }

  function validEmail(s) {
    var v = String(s || "").trim();
    if (!v) return true;
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
  }

  function parseMoney2(s) {
    var v = String(s == null ? "" : s).trim();
    if (!v) return "";
    v = v.replace(/,/g, "");
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n < 0) return null;
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function rowSearchBlob(r) {
    return (
      norm(r.order_date) +
      " | " + norm(r.client_name) +
      " | " + norm(r.address) +
      " | " + norm(r.contact) +
      " | " + norm(r.alternate) +
      " | " + norm(r.email) +
      " | " + norm(r.items) +
      " | " + norm(r.priority) +
      " | " + norm(r.needed_by) +
      " | " + norm(r.pick_up_date) +
      " | " + norm(r.deposit) +
      " | " + norm(r.notes) +
      " | " + norm(r.fulfilled ? "fulfilled" : "active")
    );
  }

  // ------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------
  var coStyleInstalled = false;
  function ensureClientOrdersStyles() {
    if (coStyleInstalled) return;
    coStyleInstalled = true;

    var st = document.createElement("style");
    st.type = "text/css";
    st.id = "eikon-clientorders-style";
    st.textContent =
      "" +
      ".co-wrap{max-width:1400px;margin:0 auto;padding:16px;}" +
      ".co-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:12px;}" +
      ".co-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".co-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +

      ".co-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +
      ".co-field{display:flex;flex-direction:column;gap:4px;}" +
      ".co-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +
      ".co-field input{" +
      "padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "transition:border-color 120ms ease, box-shadow 120ms ease, background 120ms ease;" +
      "}" +
      ".co-field input:hover{border-color:rgba(255,255,255,.18);}" +
      ".co-field input:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);}" +
      ".co-field input::placeholder{color:rgba(233,238,247,.40);}" +
      "#co-search-active,#co-search-done{color-scheme:dark;}" +

      ".co-actions{display:flex;gap:10px;align-items:flex-end;}" +

      ".co-card{" +
      "border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:12px;" +
      "background:var(--panel,rgba(16,24,36,.66));box-shadow:0 18px 50px rgba(0,0,0,.38);" +
      "backdrop-filter:blur(10px);" +
      "}" +
      ".co-card + .co-card{margin-top:12px;}" +
      ".co-card-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:10px;}" +
      ".co-card-head h3{margin:0;font-size:15px;font-weight:1000;color:var(--text,#e9eef7);}" +
      ".co-card-head .meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +
      ".co-card-head .right{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;justify-content:flex-end;}" +

      ".co-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".co-table{width:max-content;min-width:100%;border-collapse:collapse;table-layout:auto;color:var(--text,#e9eef7);}" +
      ".co-table th,.co-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:8px 8px;font-size:12px;vertical-align:top;overflow-wrap:normal;word-break:normal;}" +
      ".co-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;}" +
      ".co-table th.noclick{cursor:default;}" +
      ".co-table tbody tr:hover{background:rgba(255,255,255,.04);}" +

      ".co-sort{display:inline-flex;gap:6px;align-items:center;}" +
      ".co-sort .car{opacity:.55;font-size:11px;}" +
      ".co-sort.on .car{opacity:1;}" +

      ".co-pr{display:inline-flex;align-items:center;gap:8px;font-weight:900;}" +
      ".co-dot{width:10px;height:10px;border-radius:999px;display:inline-block;border:1px solid rgba(255,255,255,.18);}" +
      ".co-dot.p1{background:rgba(255,90,122,.95);}" +
      ".co-dot.p2{background:rgba(67,209,122,.95);}" +
      ".co-dot.p3{background:rgba(58,160,255,.95);}" +

      ".co-clamp{max-width:320px;}" +
      ".co-clamp-inner{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;white-space:normal;}" +
      ".co-check{transform:scale(1.05);accent-color:rgba(58,160,255,.95);}" +

      ".co-mode{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:900;color:rgba(233,238,247,.78);}" +
      ".co-badge{font-size:11px;font-weight:1000;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(10,16,24,.35);}" +
      ".co-badge.local{border-color:rgba(255,200,90,.28);}" +
      ".co-badge.err{border-color:rgba(255,90,122,.35);}" +

      ".co-debug{margin-top:12px;border:1px solid rgba(255,255,255,.10);border-radius:14px;background:rgba(10,16,24,.24);padding:10px;}" +
      ".co-debug h4{margin:0 0 8px 0;font-size:13px;font-weight:1000;color:rgba(233,238,247,.84);}" +
      ".co-debug pre{margin:0;white-space:pre-wrap;word-break:break-word;font-size:11px;line-height:1.35;color:rgba(233,238,247,.78);}" +

      // Modal inputs
      "#co-date,#co-client,#co-address,#co-contact,#co-alternate,#co-email,#co-needed,#co-pickup,#co-deposit{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "}" +
      "#co-items,#co-notes{" +
      "width:100%;min-height:78px;resize:vertical;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;" +
      "}" +
      "#co-priority{" +
      "width:100%;padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;color-scheme:dark;" +
      "}" +
      "#co-date:focus,#co-client:focus,#co-address:focus,#co-contact:focus,#co-alternate:focus,#co-email:focus,#co-items:focus,#co-priority:focus,#co-needed:focus,#co-pickup:focus,#co-deposit:focus,#co-notes:focus{" +
      "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);" +
      "}" +
      "#co-date,#co-needed,#co-pickup{color-scheme:dark;}" +

      "@media(max-width:920px){.co-wrap{padding:12px;}.co-controls{width:100%;}}";

    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Local fallback storage (only for missing endpoints/offline)
  // ------------------------------------------------------------
  var LS_KEY = "eikon_clientorders_v1";
  var LS_PREF_KEY = "eikon_clientorders_pref_allow500";

  function lsRead() {
    try {
      var raw = window.localStorage.getItem(LS_KEY);
      if (!raw) return { seq: 0, entries: [] };
      var obj = JSON.parse(raw);
      if (!obj || typeof obj !== "object") return { seq: 0, entries: [] };
      if (!Array.isArray(obj.entries)) obj.entries = [];
      if (typeof obj.seq !== "number") obj.seq = 0;
      return obj;
    } catch (e) {
      return { seq: 0, entries: [] };
    }
  }

  function lsWrite(obj) {
    try { window.localStorage.setItem(LS_KEY, JSON.stringify(obj || { seq: 0, entries: [] })); } catch (e) {}
  }

  function localList() { return lsRead().entries.slice(); }

  function localCreate(payload) {
    var db = lsRead();
    db.seq = (Number(db.seq) || 0) + 1;
    var id = "L" + String(Date.now()) + "_" + String(db.seq);
    var row = Object.assign({}, payload, { id: id });
    db.entries.unshift(row);
    lsWrite(db);
    return { ok: true, id: id };
  }

  function localUpdate(id, payload) {
    var db = lsRead();
    var sid = String(id);
    for (var i = 0; i < db.entries.length; i++) {
      if (String(db.entries[i].id) === sid) {
        db.entries[i] = Object.assign({}, db.entries[i], payload);
        lsWrite(db);
        return { ok: true };
      }
    }
    return { ok: false, error: "Not found" };
  }

  function localDelete(id) {
    var db = lsRead();
    var sid = String(id);
    db.entries = db.entries.filter(function (r) { return String(r.id) !== sid; });
    lsWrite(db);
    return { ok: true };
  }

  function getAllow500Fallback() {
    // query param co_allow500=1 wins, else localStorage pref
    try {
      var url = new URL(window.location.href);
      var qp = (url.searchParams.get("co_allow500") || "").trim();
      if (qp === "1" || qp.toLowerCase() === "true") return true;
      if (qp === "0" || qp.toLowerCase() === "false") return false;
    } catch (e) {}
    try {
      return String(window.localStorage.getItem(LS_PREF_KEY) || "") === "1";
    } catch (e2) {
      return false;
    }
  }

  function setAllow500Fallback(v) {
    try { window.localStorage.setItem(LS_PREF_KEY, v ? "1" : "0"); } catch (e) {}
  }

  function shouldFallback(e, allow500Fallback) {
    // Do NOT fallback on auth problems
    var st = e && typeof e.status === "number" ? e.status : null;
    if (st === 401 || st === 403) return false;

    // Missing endpoints -> yes
    if (st === 404) return true;

    // Network / unknown -> yes
    if (!st) return true;

    // Server errors -> NO by default (prevents split brain)
    if (st >= 500) return !!allow500Fallback;

    return false;
  }

  // ------------------------------------------------------------
  // API + debugging wrapper
  // ------------------------------------------------------------
  async function apiFetchDbg(path, options, tag) {
    reqSeq++;
    var reqId = "CO#" + String(reqSeq) + "-" + String(Date.now());
    var method = (options && options.method) ? String(options.method).toUpperCase() : "GET";
    var full = path;
    try {
      // replicate core.js path resolution best-effort
      if (!/^https?:\/\//i.test(path)) full = (E.apiBase || "") + path;
    } catch (e) {}

    dbg("[clientorders] " + reqId + " " + (tag || "") + " -> " + method + " " + path + " (full: " + full + ")");
    try {
      if (options && options.headers) dbg("[clientorders] " + reqId + " headers:", options.headers);
      if (options && options.body) dbg("[clientorders] " + reqId + " body:", options.body);
    } catch (e2) {}

    var t0 = Date.now();
    try {
      var out = await E.apiFetch(path, options || {});
      dbg("[clientorders] " + reqId + " <- OK " + String(Date.now() - t0) + "ms", out && (out.ok !== undefined ? { ok: out.ok } : { type: typeof out }));
      return out;
    } catch (e) {
      var dur = Date.now() - t0;
      var bodyTextHead = "";
      try { bodyTextHead = String(e && e.bodyText ? e.bodyText : "").slice(0, 320); } catch (e3) {}
      err("[clientorders] " + reqId + " <- FAIL " + String(dur) + "ms", { status: e && e.status, message: e && e.message, bodyJson: e && e.bodyJson || null, bodyTextHead: bodyTextHead });
      throw e;
    }
  }

  function apiMonthList(month, q, fulfilled) {
    var qs = [];
    qs.push("month=" + encodeURIComponent(month));
    if (q) qs.push("q=" + encodeURIComponent(q));
    if (fulfilled === 0 || fulfilled === 1) qs.push("fulfilled=" + String(fulfilled));
    return apiFetchDbg("/client-orders/entries?" + qs.join("&"), { method: "GET" }, "month");
  }

  // 3-year window: previous year, current year, next year
  function buildMonths3y() {
    var y = new Date().getFullYear();
    var out = [];
    for (var yy = y - 1; yy <= y + 1; yy++) {
      for (var mm = 1; mm <= 12; mm++) out.push(String(yy) + "-" + pad2(mm));
    }
    return out;
  }

  function mergeById(intoMap, entries) {
    if (!Array.isArray(entries)) return;
    for (var i = 0; i < entries.length; i++) {
      var r = entries[i];
      if (!r || r.id == null) continue;
      intoMap[String(r.id)] = r;
    }
  }

  function mapApiRowToUi(r) {
    // Accept both "UI-shaped" and "DB-shaped" rows.
    var o = Object.assign({}, r || {});
    if (o.address == null && o.client_address != null) o.address = o.client_address;
    if (o.contact == null && o.client_phone != null) o.contact = o.client_phone;
    if (o.alternate == null && (o.client_alt_phone != null || o.client_alternate != null)) o.alternate = (o.client_alt_phone != null ? o.client_alt_phone : o.client_alternate);
    if (o.email == null && o.client_email != null) o.email = o.client_email;
    if (o.items == null && o.items_text != null) o.items = o.items_text;
    if (o.pick_up_date == null && o.pickup_date != null) o.pick_up_date = o.pickup_date;
    if (o.deposit == null && o.deposit_amount != null) {
      var n = Number(o.deposit_amount);
      if (isFinite(n) && n > 0) o.deposit = (Math.round(n * 100) / 100).toFixed(2);
      else o.deposit = "";
    }
    return o;
  }

  async function apiList() {
    var allow500Fallback = getAllow500Fallback();

    // Probe current month first to detect missing endpoint (404) quickly + reduce noise.
    var probeMonth = ymNow();
    dbg("[clientorders] apiList probe month: " + probeMonth);

    try {
      await apiFetchDbg("/client-orders/entries?month=" + encodeURIComponent(probeMonth), { method: "GET" }, "probe");
    } catch (eProbe) {
      if (!shouldFallback(eProbe, allow500Fallback)) throw eProbe;
      warn("[clientorders] apiList probe -> fallback to local", { status: eProbe && eProbe.status, message: eProbe && eProbe.message });
      return { mode: "local", entries: localList(), lastError: eProbe || null, allow500Fallback: allow500Fallback };
    }

    // If probe succeeded, load 3y window (batched).
    var months = buildMonths3y();
    var byId = Object.create(null);
    var BATCH = 6;
    var anyOk = false;
    var firstErr = null;

    for (var i = 0; i < months.length; i += BATCH) {
      var batch = months.slice(i, i + BATCH);
      var settled = await Promise.allSettled(
        batch.map(function (m) {
          return apiMonthList(m, "", null);
        })
      );

      for (var k = 0; k < settled.length; k++) {
        var it = settled[k];
        if (it.status === "fulfilled") {
          anyOk = true;
          var resp = it.value;
          mergeById(byId, resp && resp.entries);
        } else {
          var e = it.reason;
          if (!firstErr) firstErr = e;
          // auth errors should hard-fail
          if (e && (e.status === 401 || e.status === 403)) throw e;
          // tolerate partial
          dbg("[clientorders] month fetch failed (skipped)", { status: e && e.status, message: e && e.message });
        }
      }
    }

    if (!anyOk) {
      if (shouldFallback(firstErr, allow500Fallback)) {
        warn("[clientorders] apiList all failed -> fallback local", { status: firstErr && firstErr.status, message: firstErr && firstErr.message });
        return { mode: "local", entries: localList(), lastError: firstErr || null, allow500Fallback: allow500Fallback };
      }
      throw firstErr || new Error("Failed to load client orders");
    }

    return { mode: "api", entries: Object.keys(byId).map(function (id) { return byId[id]; }), lastError: null, allow500Fallback: allow500Fallback };
  }

  async function apiCreate(payload) {
    var allow500Fallback = getAllow500Fallback();
    try {
      var resp = await apiFetchDbg("/client-orders/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      }, "create");
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Create failed");
      return { mode: "api", resp: resp, lastError: null, allow500Fallback: allow500Fallback };
    } catch (e) {
      if (!shouldFallback(e, allow500Fallback)) throw e;
      warn("[clientorders] create -> local fallback", { status: e && e.status, message: e && e.message });
      return { mode: "local", resp: localCreate(payload), lastError: e || null, allow500Fallback: allow500Fallback };
    }
  }

  async function apiUpdate(id, payload) {
    var allow500Fallback = getAllow500Fallback();
    try {
      var resp = await apiFetchDbg("/client-orders/entries/" + encodeURIComponent(String(id)), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      }, "update");
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Update failed");
      return { mode: "api", resp: resp, lastError: null, allow500Fallback: allow500Fallback };
    } catch (e) {
      if (!shouldFallback(e, allow500Fallback)) throw e;
      warn("[clientorders] update -> local fallback", { status: e && e.status, message: e && e.message });
      return { mode: "local", resp: localUpdate(id, payload), lastError: e || null, allow500Fallback: allow500Fallback };
    }
  }

  async function apiDelete(id) {
    var allow500Fallback = getAllow500Fallback();
    try {
      var resp = await apiFetchDbg("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "DELETE" }, "delete");
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Delete failed");
      return { mode: "api", resp: resp, lastError: null, allow500Fallback: allow500Fallback };
    } catch (e) {
      if (!shouldFallback(e, allow500Fallback)) throw e;
      warn("[clientorders] delete -> local fallback", { status: e && e.status, message: e && e.message });
      return { mode: "local", resp: localDelete(id), lastError: e || null, allow500Fallback: allow500Fallback };
    }
  }

  // ------------------------------------------------------------
  // Validation (UI payload)
  // ------------------------------------------------------------
  function validatePayload(p) {
    var out = {
      order_date: String(p.order_date || "").trim(),
      client_name: String(p.client_name || "").trim(),
      address: String(p.address || "").trim(),
      contact: String(p.contact || "").trim(),
      alternate: String(p.alternate || "").trim(),
      email: String(p.email || "").trim(),
      items: String(p.items || "").trim(),
      priority: Number(p.priority || 2),
      needed_by: String(p.needed_by || "").trim(),
      pick_up_date: String(p.pick_up_date || "").trim(),
      deposit: String(p.deposit || "").trim(),
      notes: String(p.notes || "").trim(),
      fulfilled: !!p.fulfilled,
      fulfilled_at: String(p.fulfilled_at || "").trim(),
    };

    if (!out.order_date || !isYmd(out.order_date)) throw new Error("Date is required (YYYY-MM-DD)");
    if (!out.client_name) throw new Error("Client (Name and Surname) is required");
    if (!out.items) throw new Error("Item/s is required");
    if (!out.needed_by || !isYmd(out.needed_by)) throw new Error("Needed by is required (YYYY-MM-DD)");
    if (!out.pick_up_date || !isYmd(out.pick_up_date)) throw new Error("Pick Up Date is required (YYYY-MM-DD)");

    if (!(out.priority === 1 || out.priority === 2 || out.priority === 3)) out.priority = 2;
    if (out.email && !validEmail(out.email)) throw new Error("Email is invalid");

    if (out.deposit) {
      var money = parseMoney2(out.deposit);
      if (money === null) throw new Error("Deposit must be a valid amount (e.g. 20.00)");
      out.deposit = money;
    } else {
      out.deposit = "";
    }

    if (out.client_name.length > 200) throw new Error("Client name too long");
    if (out.address.length > 300) throw new Error("Address too long");
    if (out.contact.length > 80) throw new Error("Contact too long");
    if (out.alternate.length > 80) throw new Error("Alternate too long");
    if (out.email.length > 200) throw new Error("Email too long");
    if (out.items.length > 1200) throw new Error("Item/s too long");
    if (out.notes.length > 2000) throw new Error("Additional Notes too long");

    if (out.fulfilled && !out.fulfilled_at) out.fulfilled_at = new Date().toISOString();
    if (!out.fulfilled) out.fulfilled_at = "";

    return out;
  }

  function toApiPayload(ui) {
    // Send BOTH UI keys and DB-ish keys for compatibility.
    var p = ui || {};
    return {
      // UI keys
      order_date: p.order_date,
      client_name: p.client_name,
      address: p.address,
      contact: p.contact,
      alternate: p.alternate,
      email: p.email,
      items: p.items,
      priority: p.priority,
      needed_by: p.needed_by,
      pick_up_date: p.pick_up_date,
      deposit: p.deposit,
      notes: p.notes,
      fulfilled: p.fulfilled,
      fulfilled_at: p.fulfilled_at,

      // DB-ish aliases
      client_address: p.address,
      client_phone: p.contact,
      client_alt_phone: p.alternate,
      client_email: p.email,
      items_text: p.items,
      pickup_date: p.pick_up_date,
      deposit_amount: p.deposit,
    };
  }

  function modalError(title, e) {
    try {
      var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : "Error");
      E.modal.show(
        title || "Error",
        "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
    } catch (e2) {
      alert(String(e && (e.message || e) ? (e.message || e) : "Error"));
    }
  }

  // ------------------------------------------------------------
  // Modal: New / Edit
  // ------------------------------------------------------------
  function openOrderModal(opts) {
    var mode = opts && opts.mode ? String(opts.mode) : "new";
    var row = (opts && opts.entry) ? opts.entry : {};
    var isEdit = mode === "edit";

    var initial = {
      order_date: String(row.order_date || todayYmd()).trim(),
      client_name: String(row.client_name || "").trim(),
      address: String(row.address || "").trim(),
      contact: String(row.contact || "").trim(),
      alternate: String(row.alternate || "").trim(),
      email: String(row.email || "").trim(),
      items: String(row.items || "").trim(),
      priority: Number(row.priority || 2),
      needed_by: String(row.needed_by || addDaysYmd(2)).trim(),
      pick_up_date: String(row.pick_up_date || addDaysYmd(2)).trim(),
      deposit: String(row.deposit || "").trim(),
      notes: String(row.notes || "").trim(),
      fulfilled: !!row.fulfilled,
      fulfilled_at: String(row.fulfilled_at || "").trim(),
    };

    if (!isYmd(initial.order_date)) initial.order_date = todayYmd();
    if (!isYmd(initial.needed_by)) initial.needed_by = addDaysYmd(2);
    if (!isYmd(initial.pick_up_date)) initial.pick_up_date = addDaysYmd(2);
    if (!(initial.priority === 1 || initial.priority === 2 || initial.priority === 3)) initial.priority = 2;

    var title = isEdit ? "Edit Client Order" : "New Client Order";

    var body =
      "" +
      "<div class='eikon-field'><div class='eikon-label'>Date</div><input id='co-date' type='date' value='" + esc(initial.order_date) + "'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Client (Name and Surname)</div><input id='co-client' type='text' value='" + esc(initial.client_name) + "' placeholder='e.g. Maria Camilleri'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Address (Optional)</div><input id='co-address' type='text' value='" + esc(initial.address) + "' placeholder='e.g. 12, Triq il-Kbira, Birkirkara'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Contact</div><input id='co-contact' type='text' value='" + esc(initial.contact) + "' placeholder='e.g. 7900 0000'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Alternate (Optional)</div><input id='co-alternate' type='text' value='" + esc(initial.alternate) + "' placeholder='e.g. 9988 7766'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Email (Optional)</div><input id='co-email' type='email' value='" + esc(initial.email) + "' placeholder='e.g. client@email.com'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Item/s</div><textarea id='co-items' placeholder='e.g. Otrivin Nasal Spray'>" + esc(initial.items) + "</textarea></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Priority</div>" +
      "  <select id='co-priority'>" +
      "    <option value='1'>1 - High (Red)</option>" +
      "    <option value='2'>2 - Medium (Green)</option>" +
      "    <option value='3'>3 - Low (Blue)</option>" +
      "  </select>" +
      "</div>" +
      "<div class='eikon-field'><div class='eikon-label'>Needed by</div><input id='co-needed' type='date' value='" + esc(initial.needed_by) + "'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Pick Up Date</div><input id='co-pickup' type='date' value='" + esc(initial.pick_up_date) + "'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Deposit (2 decimals)</div><input id='co-deposit' type='number' step='0.01' value='" + esc(initial.deposit) + "' placeholder='e.g. 20.00'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Additional Notes</div><textarea id='co-notes' placeholder='Optional…'>" + esc(initial.notes) + "</textarea></div>" +
      "<div class='eikon-field' style='display:flex;flex-direction:row;align-items:center;gap:10px;margin-top:6px;'>" +
      "  <input id='co-fulfilled' type='checkbox' class='co-check' " + (initial.fulfilled ? "checked" : "") + ">" +
      "  <div class='eikon-label' style='margin:0;'>Mark as fulfilled</div>" +
      "</div>";

    E.modal.show(title, body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Save",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var payloadUi = validatePayload({
                order_date: (E.q("#co-date").value || "").trim(),
                client_name: (E.q("#co-client").value || "").trim(),
                address: (E.q("#co-address").value || "").trim(),
                contact: (E.q("#co-contact").value || "").trim(),
                alternate: (E.q("#co-alternate").value || "").trim(),
                email: (E.q("#co-email").value || "").trim(),
                items: (E.q("#co-items").value || "").trim(),
                priority: Number((E.q("#co-priority").value || "2").trim()),
                needed_by: (E.q("#co-needed").value || "").trim(),
                pick_up_date: (E.q("#co-pickup").value || "").trim(),
                deposit: (E.q("#co-deposit").value || "").trim(),
                notes: (E.q("#co-notes").value || "").trim(),
                fulfilled: !!(E.q("#co-fulfilled").checked),
                fulfilled_at: String(row.fulfilled_at || "").trim(),
              });

              dbg("[clientorders] modal save UI payload", payloadUi);

              var apiPayload = toApiPayload(payloadUi);
              dbg("[clientorders] modal save API payload", apiPayload);

              if (isEdit) await apiUpdate(row.id, apiPayload);
              else await apiCreate(apiPayload);

              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Save failed", e);
            }
          })();
        },
      },
    ]);

    try {
      var pr = E.q("#co-priority");
      if (pr) pr.value = String(initial.priority);
    } catch (e1) {}
  }

  function openConfirmDelete(entry) {
    if (!entry || !entry.id) return;

    var body =
      "<div style='white-space:pre-wrap'>" +
      "This will permanently delete the order.\n\n" +
      "Date: " + esc(fmtDmyFromYmd(entry.order_date)) + "\n" +
      "Client: " + esc(entry.client_name || "") + "\n" +
      "Items: " + esc(clampStr(entry.items || "", 220)) + (String(entry.items || "").length > 220 ? "…" : "") + "\n" +
      "</div>";

    E.modal.show("Delete order?", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: "Delete",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              await apiDelete(entry.id);
              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Delete failed", e);
            }
          })();
        },
      },
    ]);
  }

  // ------------------------------------------------------------
  // Print
  // ------------------------------------------------------------
  function openPrintWindow(entries, title, queryText) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var t = String(title || "Client Orders").trim();
    var q = String(queryText || "").trim();

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", "<div style='white-space:pre-wrap'>Popup blocked. Allow popups and try again.</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]);
      return;
    }

    function safe(s) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
    }

    function prText(p) {
      var n = Number(p || 2);
      if (n === 1) return "1 (High)";
      if (n === 3) return "3 (Low)";
      return "2 (Medium)";
    }

    var rowsHtml = "";
    for (var i = 0; i < list.length; i++) {
      var r = list[i] || {};
      rowsHtml +=
        "<tr>" +
        "<td>" + safe(fmtDmyFromYmd(r.order_date || "")) + "</td>" +
        "<td>" + safe(r.client_name || "") + "</td>" +
        "<td>" + safe(r.address || "") + "</td>" +
        "<td>" + safe(r.contact || "") + "</td>" +
        "<td>" + safe(r.alternate || "") + "</td>" +
        "<td>" + safe(r.email || "") + "</td>" +
        "<td>" + safe(r.items || "") + "</td>" +
        "<td>" + safe(prText(r.priority)) + "</td>" +
        "<td>" + safe(fmtDmyFromYmd(r.needed_by || "")) + "</td>" +
        "<td>" + safe(fmtDmyFromYmd(r.pick_up_date || "")) + "</td>" +
        "<td style='text-align:right;white-space:nowrap;'>" + safe(r.deposit || "") + "</td>" +
        "<td>" + safe(r.notes || "") + "</td>" +
        "<td>" + safe(r.fulfilled ? "Yes" : "No") + "</td>" +
        "</tr>";
    }

    var html =
      "<!doctype html><html><head><meta charset='utf-8'>" +
      "<meta name='viewport' content='width=device-width,initial-scale=1'>" +
      "<title>" + safe(t) + "</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:18px;color:#111;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 10px;font-weight:800;}" +
      "table{width:100%;border-collapse:collapse;margin-top:10px;}" +
      "th,td{border:1px solid #ddd;padding:6px 8px;font-size:11px;vertical-align:top;}" +
      "th{background:#f5f5f5;text-align:left;}" +
      ".meta{font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>Print</button>" +
      "<h1 style='margin:0 0 4px 0;font-size:18px;'>" + safe(t) + "</h1>" +
      "<div class='meta'>Rows: " + safe(String(list.length)) + "\nSearch: " + safe(q || "-") + "\nPrinted: " + safe(new Date().toLocaleString()) + "</div>" +
      "<table><thead><tr>" +
      "<th>Date</th><th>Client</th><th>Address</th><th>Contact</th><th>Alternate</th><th>Email</th><th>Item/s</th><th>Priority</th><th>Needed by</th><th>Pick Up Date</th><th>Deposit</th><th>Additional Notes</th><th>Fulfilled</th>" +
      "</tr></thead><tbody>" +
      rowsHtml +
      "</tbody></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);</script>" +
      "</body></html>";

    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ------------------------------------------------------------
  // Sorting
  // ------------------------------------------------------------
  function cmp(a, b) { if (a < b) return -1; if (a > b) return 1; return 0; }

  function getSortVal(r, key) {
    var v = r ? r[key] : "";
    if (key === "priority") return Number(v || 2);
    if (key === "deposit") return Number(String(v || "0").replace(/,/g, "")) || 0;
    if (key === "fulfilled") return r && r.fulfilled ? 1 : 0;
    if (key === "order_date" || key === "needed_by" || key === "pick_up_date") return String(v || "");
    return norm(v);
  }

  function sortList(list, sortState) {
    var key = sortState && sortState.key ? String(sortState.key) : "priority";
    var dir = sortState && sortState.dir ? String(sortState.dir) : "asc";
    var mul = dir === "desc" ? -1 : 1;

    list.sort(function (ra, rb) {
      var a = getSortVal(ra, key);
      var b = getSortVal(rb, key);
      var c = 0;
      if (key === "order_date" || key === "needed_by" || key === "pick_up_date") c = cmp(String(a || ""), String(b || ""));
      else if (key === "priority" || key === "deposit" || key === "fulfilled") c = cmp(Number(a || 0), Number(b || 0));
      else c = cmp(String(a || ""), String(b || ""));
      if (c !== 0) return c * mul;

      var ia = String((ra && ra.id) || "");
      var ib = String((rb && rb.id) || "");
      if (ia < ib) return 1;
      if (ia > ib) return -1;
      return 0;
    });

    return list;
  }

  // ------------------------------------------------------------
  // Row builder
  // ------------------------------------------------------------
  function prBadge(priority) {
    var p = Number(priority || 2);
    if (p !== 1 && p !== 2 && p !== 3) p = 2;
    var wrap = document.createElement("span");
    wrap.className = "co-pr";
    var dot = document.createElement("span");
    dot.className = "co-dot " + (p === 1 ? "p1" : p === 3 ? "p3" : "p2");
    var txt = document.createElement("span");
    txt.textContent = (p === 1 ? "1" : p === 3 ? "3" : "2");
    wrap.appendChild(dot);
    wrap.appendChild(txt);
    return wrap;
  }

  function buildTableRow(entry, opts) {
    var tr = document.createElement("tr");

function td(text, cls, title) {
  var el = document.createElement("td");
  if (cls) el.className = cls;
  if (title) el.title = title;

  if (cls && String(cls).indexOf("co-clamp") >= 0) {
    var inner = document.createElement("div");
    inner.className = "co-clamp-inner";
    inner.textContent = text;
    el.appendChild(inner);
  } else {
    el.textContent = text;
  }
  return el;
}

    tr.appendChild(td(fmtDmyFromYmd(entry.order_date || ""), "", entry.order_date || ""));
    tr.appendChild(td(entry.client_name || "", "", entry.client_name || ""));
    tr.appendChild(td(entry.address || "", "co-clamp", entry.address || ""));
    tr.appendChild(td(entry.contact || "", "", entry.contact || ""));
    tr.appendChild(td(entry.alternate || "", "", entry.alternate || ""));
    tr.appendChild(td(entry.email || "", "co-clamp", entry.email || ""));
    tr.appendChild(td(entry.items || "", "co-clamp", entry.items || ""));

    var tdPr = document.createElement("td");
    tdPr.appendChild(prBadge(entry.priority));
    tr.appendChild(tdPr);

    tr.appendChild(td(fmtDmyFromYmd(entry.needed_by || ""), "", entry.needed_by || ""));
    tr.appendChild(td(fmtDmyFromYmd(entry.pick_up_date || ""), "", entry.pick_up_date || ""));

    var tdDep = document.createElement("td");
    tdDep.style.textAlign = "right";
    tdDep.style.whiteSpace = "nowrap";
    tdDep.textContent = entry.deposit || "";
    tr.appendChild(tdDep);

    tr.appendChild(td(entry.notes || "", "co-clamp", entry.notes || ""));

    // Fulfilled checkbox
    var tdChk = document.createElement("td");
    tdChk.style.textAlign = "center";
    tdChk.style.whiteSpace = "nowrap";

    var chk = document.createElement("input");
    chk.type = "checkbox";
    chk.className = "co-check";
    chk.checked = !!entry.fulfilled;
    chk.addEventListener("click", function (ev) { ev.stopPropagation(); });
chk.addEventListener("change", async function () {
  var next = chk.checked;
  var ts = next ? new Date().toISOString() : "";

  // Build a full API payload from the row (API expects full update)
  var depositAmount = null;
  if (entry && entry.deposit != null && String(entry.deposit).trim() !== "") {
    var dn = Number(String(entry.deposit).replace(/,/g, "").trim());
    if (isFinite(dn)) depositAmount = dn;
  } else if (entry && entry.deposit_amount != null && String(entry.deposit_amount).trim() !== "") {
    var dn2 = Number(String(entry.deposit_amount).replace(/,/g, "").trim());
    if (isFinite(dn2)) depositAmount = dn2;
  }

if (depositAmount == null) depositAmount = 0;
   
  var payload = {
    order_date: entry.order_date || "",
    client_name: entry.client_name || "",
    client_phone: entry.client_phone || entry.contact || "",
    client_alt_phone: entry.client_alt_phone || entry.client_alternate || entry.alternate || "",
    client_email: entry.client_email || entry.email || "",
    client_address: entry.client_address || entry.address || "",
    items_text: entry.items_text || entry.items || "",
    priority: entry.priority != null && String(entry.priority).trim() !== "" ? entry.priority : 2,
    needed_by: entry.needed_by || "",
    pickup_date: entry.pick_up_date || "",
    deposit_amount: depositAmount,
    notes: entry.notes || "",
    fulfilled: next,
    fulfilled_at: ts
  };

  try {
    await apiUpdate(entry.id, payload);

    entry.fulfilled = next;
    entry.fulfilled_at = ts;
    entry._done = !!next;

    rerender();
  } catch (e) {
    chk.checked = !!entry.fulfilled;
    alert("Update failed: " + (e && e.message ? e.message : e));
  }
});

    tdChk.appendChild(chk);
    tr.appendChild(tdChk);

    // Actions
    var tdActions = document.createElement("td");
    tdActions.style.whiteSpace = "nowrap";

    var btnEdit = document.createElement("button");
    btnEdit.className = "eikon-btn";
    btnEdit.type = "button";
    btnEdit.textContent = "Edit";
    btnEdit.style.marginRight = "8px";
    btnEdit.addEventListener("click", function () { opts && opts.onEdit && opts.onEdit(entry); });

    var btnDel = document.createElement("button");
    btnDel.className = "eikon-btn";
    btnDel.type = "button";
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", function () { opts && opts.onDelete && opts.onDelete(entry); });

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDel);
    tr.appendChild(tdActions);

    return tr;
  }

  // ------------------------------------------------------------
  // State + Rendering
  // ------------------------------------------------------------
  var state = {
    entries: [],
    mode: "api", // api | local | api_error
    lastError: null,
    allow500Fallback: false,
    queryActive: "",
    queryDone: "",
    sortActive: { key: "priority", dir: "asc" },
    sortDone: { key: "pick_up_date", dir: "desc" },
    filteredActive: [],
    filteredDone: [],
    refresh: null,
    mounted: false,
    renderDebugPanel: null
  };

  var COLS = [
    { key: "order_date", label: "Date" },
    { key: "client_name", label: "Client" },
    { key: "address", label: "Address" },
    { key: "contact", label: "Contact" },
    { key: "alternate", label: "Alternate" },
    { key: "email", label: "Email" },
    { key: "items", label: "Item/s" },
    { key: "priority", label: "Priority" },
    { key: "needed_by", label: "Needed by" },
    { key: "pick_up_date", label: "Pick Up Date" },
    { key: "deposit", label: "Deposit" },
    { key: "notes", label: "Additional Notes" },
    { key: "fulfilled", label: "Fulfilled" }
  ];

  function applyFilterSplitSort() {
    var all = Array.isArray(state.entries) ? state.entries.slice() : [];
    var active = [];
    var done = [];

    for (var i = 0; i < all.length; i++) {
      var r = all[i] || {};
      if (r.fulfilled) done.push(r);
      else active.push(r);
    }

    var qa = norm(state.queryActive);
    var qd = norm(state.queryDone);

    if (qa) active = active.filter(function (r) { return rowSearchBlob(r).indexOf(qa) >= 0; });
    if (qd) done = done.filter(function (r) { return rowSearchBlob(r).indexOf(qd) >= 0; });

    sortList(active, state.sortActive);
    sortList(done, state.sortDone);

    state.filteredActive = active;
    state.filteredDone = done;
  }

  function renderTable(tbodyEl, list) {
    tbodyEl.innerHTML = "";
    for (var i = 0; i < list.length; i++) {
      (function (entry) {
        var tr = buildTableRow(entry, {
          onEdit: function (e) { openOrderModal({ mode: "edit", entry: e }); },
          onDelete: function (e) { openConfirmDelete(e); },
          onChanged: function () { if (state && typeof state.refresh === "function") state.refresh(); }
        });
        tbodyEl.appendChild(tr);
      })(list[i]);
    }
  }

   function rerender() {
  try {
    applyFilterSplitSort();

    var tbodyA = null, tbodyD = null, countA = null, countD = null;

    try { tbodyA = E.q("#co-tbody-active"); } catch (e1) { tbodyA = document.querySelector("#co-tbody-active"); }
    try { tbodyD = E.q("#co-tbody-done"); } catch (e2) { tbodyD = document.querySelector("#co-tbody-done"); }
    try { countA = E.q("#co-count-active"); } catch (e3) { countA = document.querySelector("#co-count-active"); }
    try { countD = E.q("#co-count-done"); } catch (e4) { countD = document.querySelector("#co-count-done"); }

    if (tbodyA) renderTable(tbodyA, state.filteredActive || []);
    if (tbodyD) renderTable(tbodyD, state.filteredDone || []);

    var totalActive = 0, totalDone = 0;
    var all = Array.isArray(state.entries) ? state.entries : [];
    for (var i = 0; i < all.length; i++) {
      if (all[i] && all[i].fulfilled) totalDone++;
      else totalActive++;
    }

    if (countA) countA.textContent = "Showing " + String((state.filteredActive || []).length) + " / " + String(totalActive);
    if (countD) countD.textContent = "Showing " + String((state.filteredDone || []).length) + " / " + String(totalDone);

    try { if (typeof state.renderDebugPanel === "function") state.renderDebugPanel(); } catch (e5) {}
  } catch (e) {
    try { err("[clientorders] rerender failed", { message: e && e.message ? e.message : String(e) }); } catch (e6) {}
  }
}

  function setSort(thEls, sortState) {
    for (var i = 0; i < thEls.length; i++) {
      var th = thEls[i];
      var key = th.getAttribute("data-key") || "";
      if (!key) continue;
      var wrap = th.querySelector(".co-sort");
      if (!wrap) continue;

      if (sortState.key === key) {
        wrap.classList.add("on");
        var car = wrap.querySelector(".car");
        if (car) car.textContent = sortState.dir === "desc" ? "▼" : "▲";
      } else {
        wrap.classList.remove("on");
        var car2 = wrap.querySelector(".car");
        if (car2) car2.textContent = "";
      }
    }
  }

  function wireSortableHeaders(tableEl, which) {
    var ths = E.qa("th[data-key]", tableEl);
    ths.forEach(function (th) {
      var key = th.getAttribute("data-key");
      if (!key) return;
      th.addEventListener("click", function () {
        if (key === "actions") return;
        var s = which === "done" ? state.sortDone : state.sortActive;
        if (s.key === key) s.dir = (s.dir === "asc" ? "desc" : "asc");
        else { s.key = key; s.dir = "asc"; }

        applyFilterSplitSort();
        var tbodyA = E.q("#co-tbody-active");
        var tbodyD = E.q("#co-tbody-done");
        if (tbodyA) renderTable(tbodyA, state.filteredActive);
        if (tbodyD) renderTable(tbodyD, state.filteredDone);

        if (which === "done") setSort(ths, state.sortDone);
        else setSort(ths, state.sortActive);

        try {
          var other = which === "done" ? E.q("#co-table-active") : E.q("#co-table-done");
          if (other) {
            var othThs = E.qa("th[data-key]", other);
            setSort(othThs, which === "done" ? state.sortActive : state.sortDone);
          }
        } catch (e) {}
      });
    });
  }

  function thHtml(col) {
    return "<span class='co-sort'><span>" + esc(col.label) + "</span><span class='car'></span></span>";
  }

  function debugEnabled() {
    // dbg=2 is typical; also allow co_debug=1
    try {
      var url = new URL(window.location.href);
      var qp = (url.searchParams.get("co_debug") || "").trim();
      if (qp === "1" || qp.toLowerCase() === "true") return true;
    } catch (e) {}
    return !!(E && typeof E.DEBUG === "number" && E.DEBUG >= 2);
  }

  async function render(ctx) {
    ensureClientOrdersStyles();

    var mount = ctx.mount;
    mount.innerHTML =
      "" +
      "<div class='co-wrap'>" +
      "  <div class='co-head'>" +
      "    <div>" +
      "      <h2 class='co-title'>Client Orders</h2>" +
      "      <div class='co-sub'>Active orders stay clean. Tick Fulfilled to move between tables. Click any column header to sort.</div>" +
      "    </div>" +
      "    <div class='co-controls'>" +
      "      <div class='co-mode' id='co-mode'>" +
      "        <span class='co-badge' id='co-mode-badge'>Loading…</span>" +
      "      </div>" +
      "      <div class='co-actions'>" +
      "        <button id='co-new' class='eikon-btn' type='button'>New Order</button>" +
      "        <button id='co-refresh' class='eikon-btn' type='button'>Refresh</button>" +
      "      </div>" +
      "    </div>" +
      "  </div>" +

      "  <div class='co-card' id='co-card-active'>" +
      "    <div class='co-card-head'>" +
      "      <div>" +
      "        <h3>Active Orders</h3>" +
      "        <div class='meta' id='co-count-active'>Loading…</div>" +
      "      </div>" +
      "      <div class='right'>" +
      "        <div class='co-field' style='min-width:320px;max-width:420px;flex:1;'>" +
      "          <label>Search (active)</label>" +
      "          <input id='co-search-active' type='text' value='" + esc(state.queryActive || "") + "' placeholder='Type to filter…'>" +
      "        </div>" +
      "        <button id='co-print-active' class='eikon-btn' type='button'>Print</button>" +
      "      </div>" +
      "    </div>" +
      "    <div class='co-table-wrap'>" +
      "      <table class='co-table' id='co-table-active'>" +
      "        <thead><tr>" +
      COLS.map(function (c) { return "<th data-key='" + esc(c.key) + "'>" + thHtml(c) + "</th>"; }).join("") +
      "          <th class='noclick' data-key='actions'>Actions</th>" +
      "        </tr></thead>" +
      "        <tbody id='co-tbody-active'></tbody>" +
      "      </table>" +
      "    </div>" +
      "  </div>" +

      "  <div class='co-card' id='co-card-done'>" +
      "    <div class='co-card-head'>" +
      "      <div>" +
      "        <h3>Fulfilled Orders</h3>" +
      "        <div class='meta' id='co-count-done'>Loading…</div>" +
      "      </div>" +
      "      <div class='right'>" +
      "        <div class='co-field' style='min-width:320px;max-width:420px;flex:1;'>" +
      "          <label>Search (fulfilled)</label>" +
      "          <input id='co-search-done' type='text' value='" + esc(state.queryDone || "") + "' placeholder='Type to filter…'>" +
      "        </div>" +
      "        <button id='co-print-done' class='eikon-btn' type='button'>Print</button>" +
      "      </div>" +
      "    </div>" +
      "    <div class='co-table-wrap'>" +
      "      <table class='co-table' id='co-table-done'>" +
      "        <thead><tr>" +
      COLS.map(function (c) { return "<th data-key='" + esc(c.key) + "'>" + thHtml(c) + "</th>"; }).join("") +
      "          <th class='noclick' data-key='actions'>Actions</th>" +
      "        </tr></thead>" +
      "        <tbody id='co-tbody-done'></tbody>" +
      "      </table>" +
      "    </div>" +
      "  </div>" +

      (debugEnabled() ? ("<div class='co-debug' id='co-debug'><h4>Client Orders Debug</h4><pre id='co-debug-pre'>Loading…</pre></div>") : "") +

      "</div>";

    var badge = E.q("#co-mode-badge", mount);
    var btnNew = E.q("#co-new", mount);
    var btnRefresh = E.q("#co-refresh", mount);

    var searchA = E.q("#co-search-active", mount);
    var searchD = E.q("#co-search-done", mount);

    var btnPrintA = E.q("#co-print-active", mount);
    var btnPrintD = E.q("#co-print-done", mount);

    var tbodyA = E.q("#co-tbody-active", mount);
    var tbodyD = E.q("#co-tbody-done", mount);

    var countA = E.q("#co-count-active", mount);
    var countD = E.q("#co-count-done", mount);

    var tableA = E.q("#co-table-active", mount);
    var tableD = E.q("#co-table-done", mount);

    var debugPre = E.q("#co-debug-pre", mount);

    if (!badge || !btnNew || !btnRefresh || !searchA || !searchD || !btnPrintA || !btnPrintD || !tbodyA || !tbodyD || !countA || !countD || !tableA || !tableD) {
      err("[clientorders] DOM missing", {
        badge: !!badge, btnNew: !!btnNew, btnRefresh: !!btnRefresh,
        searchA: !!searchA, searchD: !!searchD, btnPrintA: !!btnPrintA, btnPrintD: !!btnPrintD,
        tbodyA: !!tbodyA, tbodyD: !!tbodyD, countA: !!countA, countD: !!countD,
        tableA: !!tableA, tableD: !!tableD
      });
      throw new Error("Client Orders DOM incomplete (see console)");
    }

    state.renderDebugPanel = function () {
      if (!debugPre) return;
      var snap = {
        mode: state.mode,
        lastError: state.lastError ? { status: state.lastError.status, message: state.lastError.message || String(state.lastError) } : null,
        entries: (state.entries || []).length,
        active: (state.filteredActive || []).length,
        done: (state.filteredDone || []).length,
        allow500Fallback: !!state.allow500Fallback
      };
      var txt =
        "SNAPSHOT:\n" + JSON.stringify(snap, null, 2) +
        "\n\nLAST LOGS:\n" + (logBuf.join("\n") || "(none)");
      debugPre.textContent = txt;
    };

    function updateBadge() {
      if (!badge) return;

      if (state.mode === "local") {
        badge.textContent = "Local mode (no API yet)";
        badge.className = "co-badge local";
      } else if (state.mode === "api_error") {
        var st = state.lastError && state.lastError.status ? String(state.lastError.status) : "";
        badge.textContent = "Online (API error: " + (state.lastError && state.lastError.message ? state.lastError.message : ("HTTP " + st)) + ")";
        badge.className = "co-badge err";
      } else {
        badge.textContent = "Online";
        badge.className = "co-badge";
      }
    }

    function updateCounts(totalActive, totalDone) {
      countA.textContent = "Showing " + String(state.filteredActive.length) + " / " + String(totalActive);
      countD.textContent = "Showing " + String(state.filteredDone.length) + " / " + String(totalDone);
    }

    async function refresh() {
      var allow500Fallback = getAllow500Fallback();
      state.allow500Fallback = allow500Fallback;
      dbg("[clientorders] refresh start; allow500Fallback=" + String(allow500Fallback));

      try {
        countA.textContent = "Loading…";
        countD.textContent = "Loading…";

        var res = await apiList();
        state.mode = res.mode || "api";
        state.lastError = res.lastError || null;
        state.allow500Fallback = !!res.allow500Fallback;

        var entriesRaw = Array.isArray(res.entries) ? res.entries : [];
        var entries = [];
        for (var i = 0; i < entriesRaw.length; i++) {
          var raw = mapApiRowToUi(entriesRaw[i] || {});
          // normalize
          var r = {
            id: raw.id,
            order_date: String(raw.order_date || "").trim(),
            client_name: String(raw.client_name || "").trim(),
            address: String(raw.address || "").trim(),
            contact: String(raw.contact || "").trim(),
            alternate: String(raw.alternate || "").trim(),
            email: String(raw.email || "").trim(),
            items: String(raw.items || "").trim(),
            priority: Number(raw.priority || 2),
            needed_by: String(raw.needed_by || "").trim(),
            pick_up_date: String(raw.pick_up_date || "").trim(),
            deposit: String(raw.deposit || "").trim(),
            notes: String(raw.notes || "").trim(),
            fulfilled: !!raw.fulfilled,
            fulfilled_at: String(raw.fulfilled_at || "").trim()
          };

          if (!isYmd(r.order_date)) r.order_date = todayYmd();
          if (!isYmd(r.needed_by)) r.needed_by = addDaysYmd(2);
          if (!isYmd(r.pick_up_date)) r.pick_up_date = addDaysYmd(2);
          if (!(r.priority === 1 || r.priority === 2 || r.priority === 3)) r.priority = 2;
          if (r.deposit) {
            var m = parseMoney2(r.deposit);
            r.deposit = (m === null ? String(r.deposit || "") : m);
          }
          entries.push(r);
        }

        state.entries = entries;

        var totalActive = 0, totalDone = 0;
        for (var j = 0; j < entries.length; j++) {
          if (entries[j] && entries[j].fulfilled) totalDone++;
          else totalActive++;
        }

        applyFilterSplitSort();
        renderTable(tbodyA, state.filteredActive);
        renderTable(tbodyD, state.filteredDone);

        updateCounts(totalActive, totalDone);
        updateBadge();

        setSort(E.qa("th[data-key]", tableA), state.sortActive);
        setSort(E.qa("th[data-key]", tableD), state.sortDone);

        try { if (typeof state.renderDebugPanel === "function") state.renderDebugPanel(); } catch (e1) {}
      } catch (e) {
        err("[clientorders] refresh failed", { status: e && e.status, bodyText: e && e.bodyText ? String(e.bodyText).slice(0, 900) : "" });
        state.mode = "api_error";
        state.lastError = e || null;
        updateBadge();
        countA.textContent = "Failed to load";
        countD.textContent = "Failed to load";
        try { if (typeof state.renderDebugPanel === "function") state.renderDebugPanel(); } catch (e2) {}
        modalError("Client Orders", e);
      }
    }

    state.refresh = refresh;

    btnNew.addEventListener("click", function () {
      openOrderModal({
        mode: "new",
        entry: { order_date: todayYmd(), priority: 2, needed_by: addDaysYmd(2), pick_up_date: addDaysYmd(2), fulfilled: false }
      });
    });

    btnRefresh.addEventListener("click", function () { refresh(); });

    searchA.addEventListener("input", function () {
      state.queryActive = String(searchA.value || "");
      applyFilterSplitSort();
      renderTable(tbodyA, state.filteredActive);
      var totalActive = 0;
      for (var i = 0; i < state.entries.length; i++) if (!(state.entries[i] && state.entries[i].fulfilled)) totalActive++;
      countA.textContent = "Showing " + String(state.filteredActive.length) + " / " + String(totalActive);
      try { if (typeof state.renderDebugPanel === "function") state.renderDebugPanel(); } catch (e) {}
    });

    searchD.addEventListener("input", function () {
      state.queryDone = String(searchD.value || "");
      applyFilterSplitSort();
      renderTable(tbodyD, state.filteredDone);
      var totalDone = 0;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i] && state.entries[i].fulfilled) totalDone++;
      countD.textContent = "Showing " + String(state.filteredDone.length) + " / " + String(totalDone);
      try { if (typeof state.renderDebugPanel === "function") state.renderDebugPanel(); } catch (e) {}
    });

    btnPrintA.addEventListener("click", function () {
      try { openPrintWindow(state.filteredActive || [], "Client Orders — Active", state.queryActive || ""); }
      catch (e) { modalError("Print", e); }
    });

    btnPrintD.addEventListener("click", function () {
      try { openPrintWindow(state.filteredDone || [], "Client Orders — Fulfilled", state.queryDone || ""); }
      catch (e) { modalError("Print", e); }
    });

    wireSortableHeaders(tableA, "active");
    wireSortableHeaders(tableD, "done");

    await refresh();
    state.mounted = true;
  }

  E.registerModule({
    id: "clientorders",
    title: "Client Orders",
    order: 17,
    icon: "📦",
    render: render
  });
})();
