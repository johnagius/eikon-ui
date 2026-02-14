/* ui/modules.clientorders.js
   Eikon - Client Orders module (UI)

   NOTE (for later Worker work):
   Intended endpoints (same shape as Daily Register):
     GET    /client-orders/entries
     POST   /client-orders/entries
     PUT    /client-orders/entries/:id
     DELETE /client-orders/entries/:id

   For now this module will AUTO-FALLBACK to localStorage if the API is missing (e.g. 404 / offline).
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.clientorders.js)");

  function dbg() {
    try {
      if (E && typeof E.dbg === "function") E.dbg.apply(null, arguments);
      else console.log.apply(console, arguments);
    } catch (e) {}
  }
  function err() {
    try {
      if (E && typeof E.error === "function") E.error.apply(null, arguments);
      else console.error.apply(console, arguments);
    } catch (e) {}
  }

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
  function todayYmd() {
    return toYmd(new Date());
  }
  function addDaysYmd(days) {
    var d = new Date();
    d.setDate(d.getDate() + (Number(days) || 0));
    return toYmd(d);
  }
  function isYmd(s) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim());
  }
  function fmtDmyFromYmd(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }
  function norm(s) {
    return String(s == null ? "" : s).toLowerCase().trim();
  }
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
    // allow comma input, normalize
    v = v.replace(/,/g, "");
    var n = Number(v);
    if (!isFinite(n)) return null;
    if (n < 0) return null;
    // 2 decimals
    return (Math.round(n * 100) / 100).toFixed(2);
  }

  function rowSearchBlob(r) {
    return (
      norm(r.order_date) +
      " | " +
      norm(r.client_name) +
      " | " +
      norm(r.address) +
      " | " +
      norm(r.contact) +
      " | " +
      norm(r.alternate) +
      " | " +
      norm(r.email) +
      " | " +
      norm(r.items) +
      " | " +
      norm(r.priority) +
      " | " +
      norm(r.needed_by) +
      " | " +
      norm(r.pick_up_date) +
      " | " +
      norm(r.deposit) +
      " | " +
      norm(r.notes) +
      " | " +
      norm(r.fulfilled ? "fulfilled" : "active")
    );
  }

  // ------------------------------------------------------------
  // Module-scoped CSS (harmonious with Daily Register)
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
      ".co-table{width:100%;border-collapse:collapse;table-layout:fixed;color:var(--text,#e9eef7);}" +
      ".co-table th,.co-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:8px 8px;font-size:12px;vertical-align:top;overflow-wrap:anywhere;word-break:break-word;}" +
      ".co-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;text-align:left;cursor:pointer;user-select:none;}" +
      ".co-table th.noclick{cursor:default;}" +
      ".co-table tbody tr:hover{background:rgba(255,255,255,.04);}" +

      ".co-sort{display:inline-flex;gap:6px;align-items:center;}" +
      ".co-sort .car{opacity:.55;font-size:11px;}" +
      ".co-sort.on .car{opacity:1;}" +

      ".co-pr{display:inline-flex;align-items:center;gap:8px;font-weight:900;}" +
      ".co-dot{width:10px;height:10px;border-radius:999px;display:inline-block;border:1px solid rgba(255,255,255,.18);}" +
      ".co-dot.p1{background:rgba(255,90,122,.95);}" + // red
      ".co-dot.p2{background:rgba(67,209,122,.95);}" +  // green
      ".co-dot.p3{background:rgba(58,160,255,.95);}" +  // blue

      ".co-clamp{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;}" +
      ".co-idline{opacity:.75;font-size:11px;color:var(--muted,rgba(233,238,247,.68));}" +

      ".co-check{transform:scale(1.05);accent-color:rgba(58,160,255,.95);}" +

      ".co-mode{display:inline-flex;align-items:center;gap:8px;font-size:12px;font-weight:900;color:rgba(233,238,247,.78);}" +
      ".co-badge{font-size:11px;font-weight:1000;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(10,16,24,.35);}" +
      ".co-badge.local{border-color:rgba(255,200,90,.28);}" +

      // Modal inputs (module-specific ids)
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
  // Local fallback storage (until Worker endpoints exist)
  // ------------------------------------------------------------
  var LS_KEY = "eikon_clientorders_v1";

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
    try {
      window.localStorage.setItem(LS_KEY, JSON.stringify(obj || { seq: 0, entries: [] }));
    } catch (e) {}
  }

  function localList() {
    var db = lsRead();
    return db.entries.slice();
  }

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
    db.entries = db.entries.filter(function (r) {
      return String(r.id) !== sid;
    });
    lsWrite(db);
    return { ok: true };
  }

  function shouldFallback(e) {
    // Do NOT fallback on auth problems; DO fallback on missing endpoints/offline/server errors
    var st = e && typeof e.status === "number" ? e.status : null;
    if (st === 401 || st === 403) return false;
    if (st === 404) return true;
    if (st && st >= 500) return true;
    // network / unknown
    if (!st) return true;
    return false;
  }

async function apiList() {
  // 3-year window: previous year, current year, next year
  function buildMonths3y() {
    var y = new Date().getFullYear();
    var out = [];
    for (var yy = y - 1; yy <= y + 1; yy++) {
      for (var mm = 1; mm <= 12; mm++) {
        out.push(String(yy) + "-" + pad2(mm));
      }
    }
    return out;
  }

  function mergeById(intoMap, entries) {
    if (!Array.isArray(entries)) return;
    for (var i = 0; i < entries.length; i++) {
      var r = entries[i];
      if (!r || r.id == null) continue;
      intoMap[String(r.id)] = r; // last one wins (fine if ids are unique)
    }
  }

  try {
    var months = buildMonths3y();
    var byId = Object.create(null);

    // batch to avoid spamming 36 parallel requests at once
    var BATCH = 6;

    var anyOk = false;
    var firstErr = null;

    for (var i = 0; i < months.length; i += BATCH) {
      var batch = months.slice(i, i + BATCH);

      // each request MUST include ?month=YYYY-MM
      var settled = await Promise.allSettled(
        batch.map(function (m) {
          return E.apiFetch("/client-orders/entries?month=" + encodeURIComponent(m), { method: "GET" });
        })
      );

      for (var k = 0; k < settled.length; k++) {
        var it = settled[k];

        if (it.status === "fulfilled") {
          anyOk = true;
          var resp = it.value;
          // E.apiFetch returns parsed JSON on 2xx; expected shape: { ok:true, entries:[...] }
          mergeById(byId, resp && resp.entries);
        } else {
          var e = it.reason;
          if (!firstErr) firstErr = e;

          // auth errors should still hard-fail
          if (e && (e.status === 401 || e.status === 403)) throw e;

          // otherwise: tolerate partial failure (network hiccup on one month, etc)
          dbg("[clientorders] month fetch failed (skipped)", e);
        }
      }
    }

    // If literally none succeeded, fall back / or throw
    if (!anyOk) {
      if (shouldFallback(firstErr)) return { mode: "local", entries: localList() };
      throw firstErr || new Error("Failed to load client orders");
    }

    return { mode: "api", entries: Object.keys(byId).map(function (id) { return byId[id]; }) };
  } catch (e) {
    if (!shouldFallback(e)) throw e;
    return { mode: "local", entries: localList() };
  }
}

  async function apiCreate(payload) {
    try {
      var resp = await E.apiFetch("/client-orders/entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Create failed");
      return { mode: "api", resp: resp };
    } catch (e) {
      if (!shouldFallback(e)) throw e;
      return { mode: "local", resp: localCreate(payload) };
    }
  }

  async function apiUpdate(id, payload) {
    try {
      var resp = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload || {}),
      });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Update failed");
      return { mode: "api", resp: resp };
    } catch (e) {
      if (!shouldFallback(e)) throw e;
      return { mode: "local", resp: localUpdate(id, payload) };
    }
  }

  async function apiDelete(id) {
    try {
      var resp = await E.apiFetch("/client-orders/entries/" + encodeURIComponent(String(id)), { method: "DELETE" });
      if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Delete failed");
      return { mode: "api", resp: resp };
    } catch (e) {
      if (!shouldFallback(e)) throw e;
      return { mode: "local", resp: localDelete(id) };
    }
  }

  // ------------------------------------------------------------
  // Validation
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

    // Deposit optional
    if (out.deposit) {
      var money = parseMoney2(out.deposit);
      if (money === null) throw new Error("Deposit must be a valid amount (e.g. 20.00)");
      out.deposit = money;
    } else {
      out.deposit = "";
    }

    // limits (keep generous but safe)
    if (out.client_name.length > 200) throw new Error("Client name too long");
    if (out.address.length > 300) throw new Error("Address too long");
    if (out.contact.length > 80) throw new Error("Contact too long");
    if (out.alternate.length > 80) throw new Error("Alternate too long");
    if (out.email.length > 200) throw new Error("Email too long");
    if (out.items.length > 1200) throw new Error("Item/s too long");
    if (out.notes.length > 2000) throw new Error("Additional Notes too long");

    // fulfilled_at: set if fulfilled and missing
    if (out.fulfilled && !out.fulfilled_at) out.fulfilled_at = new Date().toISOString();
    if (!out.fulfilled) out.fulfilled_at = "";

    return out;
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
              var prSel = E.q("#co-priority");
              if (prSel) prSel.value = String(prSel.value || "2"); // ensure value present

              // set select initial value
              try {
                E.q("#co-priority").value = String(initial.priority);
              } catch (e0) {}

              var payload = validatePayload({
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

              if (isEdit) await apiUpdate(row.id, payload);
              else await apiCreate(payload);

              E.modal.hide();
              if (state && typeof state.refresh === "function") state.refresh();
            } catch (e) {
              modalError("Save failed", e);
            }
          })();
        },
      },
    ]);

    // After modal shows: set priority select correctly (in case DOM not ready before show)
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
  // Print (same model as Daily Register)
  // ------------------------------------------------------------
  function openPrintWindow(entries, title, queryText) {
    var list = Array.isArray(entries) ? entries.slice() : [];
    var t = String(title || "Client Orders").trim();
    var q = String(queryText || "").trim();

    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show(
        "Print",
        "<div style='white-space:pre-wrap'>Popup blocked. Allow popups and try again.</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
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
  // Sorting helpers
  // ------------------------------------------------------------
  function cmp(a, b) {
    if (a < b) return -1;
    if (a > b) return 1;
    return 0;
  }

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
      // dates: compare string YYYY-MM-DD is safe lexicographically
      if (key === "order_date" || key === "needed_by" || key === "pick_up_date") c = cmp(String(a || ""), String(b || ""));
      else if (key === "priority" || key === "deposit" || key === "fulfilled") c = cmp(Number(a || 0), Number(b || 0));
      else c = cmp(String(a || ""), String(b || ""));

      if (c !== 0) return c * mul;

      // tie-breaker: newer first by id (best-effort)
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
      el.textContent = text;
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
    chk.addEventListener("click", function (ev) {
      ev.stopPropagation();
    });
    chk.addEventListener("change", function () {
      (async function () {
        try {
          var next = !!chk.checked;
          var payload = {
            fulfilled: next,
            fulfilled_at: next ? new Date().toISOString() : "",
          };
          await apiUpdate(entry.id, payload);
          if (opts && typeof opts.onChanged === "function") opts.onChanged();
        } catch (e) {
          // revert UI if failed
          chk.checked = !chk.checked;
          modalError("Update failed", e);
        }
      })();
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
    btnEdit.addEventListener("click", function () {
      opts && opts.onEdit && opts.onEdit(entry);
    });

    var btnDel = document.createElement("button");
    btnDel.className = "eikon-btn";
    btnDel.type = "button";
    btnDel.textContent = "Delete";
    btnDel.addEventListener("click", function () {
      opts && opts.onDelete && opts.onDelete(entry);
    });

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
    mode: "api", // api | local
    queryActive: "",
    queryDone: "",
    sortActive: { key: "priority", dir: "asc" },
    sortDone: { key: "pick_up_date", dir: "desc" },
    filteredActive: [],
    filteredDone: [],
    refresh: null,
    mounted: false,
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
    { key: "fulfilled", label: "Fulfilled" }, // checkbox column
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

    if (qa) {
      active = active.filter(function (r) {
        return rowSearchBlob(r).indexOf(qa) >= 0;
      });
    }
    if (qd) {
      done = done.filter(function (r) {
        return rowSearchBlob(r).indexOf(qd) >= 0;
      });
    }

    // Default secondary sort for active: needed_by ascending after priority
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
          onEdit: function (e) {
            openOrderModal({ mode: "edit", entry: e });
          },
          onDelete: function (e) {
            openConfirmDelete(e);
          },
          onChanged: function () {
            if (state && typeof state.refresh === "function") state.refresh();
          },
        });
        tbodyEl.appendChild(tr);
      })(list[i]);
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
        else {
          s.key = key;
          s.dir = "asc";
        }

        applyFilterSplitSort();
        // rerender both, simpler + consistent
        var tbodyA = E.q("#co-tbody-active");
        var tbodyD = E.q("#co-tbody-done");
        if (tbodyA) renderTable(tbodyA, state.filteredActive);
        if (tbodyD) renderTable(tbodyD, state.filteredDone);

        if (which === "done") setSort(ths, state.sortDone);
        else setSort(ths, state.sortActive);

        // keep other table indicators updated too
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
    // for checkbox column, still sortable
    return (
      "<span class='co-sort'><span>" +
      esc(col.label) +
      "</span><span class='car'></span></span>"
    );
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

    if (
      !badge || !btnNew || !btnRefresh ||
      !searchA || !searchD || !btnPrintA || !btnPrintD ||
      !tbodyA || !tbodyD || !countA || !countD || !tableA || !tableD
    ) {
      err("[clientorders] DOM missing", {
        badge: !!badge, btnNew: !!btnNew, btnRefresh: !!btnRefresh,
        searchA: !!searchA, searchD: !!searchD, btnPrintA: !!btnPrintA, btnPrintD: !!btnPrintD,
        tbodyA: !!tbodyA, tbodyD: !!tbodyD, countA: !!countA, countD: !!countD,
        tableA: !!tableA, tableD: !!tableD,
      });
      throw new Error("Client Orders DOM incomplete (see console)");
    }

    function updateBadge() {
      if (!badge) return;
      if (state.mode === "local") {
        badge.textContent = "Local mode (no API yet)";
        badge.className = "co-badge local";
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
      try {
        countA.textContent = "Loading…";
        countD.textContent = "Loading…";

        var res = await apiList();
        state.mode = res.mode || "api";

        // normalize rows
        var entries = Array.isArray(res.entries) ? res.entries : [];
        for (var i = 0; i < entries.length; i++) {
          var r = entries[i] || {};
          r.id = r.id;
          r.order_date = String(r.order_date || "").trim();
          r.client_name = String(r.client_name || "").trim();
          r.address = String(r.address || "").trim();
          r.contact = String(r.contact || "").trim();
          r.alternate = String(r.alternate || "").trim();
          r.email = String(r.email || "").trim();
          r.items = String(r.items || "").trim();
          r.priority = Number(r.priority || 2);
          r.needed_by = String(r.needed_by || "").trim();
          r.pick_up_date = String(r.pick_up_date || "").trim();
          r.deposit = String(r.deposit || "").trim();
          r.notes = String(r.notes || "").trim();
          r.fulfilled = !!r.fulfilled;
          r.fulfilled_at = String(r.fulfilled_at || "").trim();

          // safe defaults
          if (!isYmd(r.order_date)) r.order_date = todayYmd();
          if (!isYmd(r.needed_by)) r.needed_by = addDaysYmd(2);
          if (!isYmd(r.pick_up_date)) r.pick_up_date = addDaysYmd(2);
          if (!(r.priority === 1 || r.priority === 2 || r.priority === 3)) r.priority = 2;
          if (r.deposit) {
            var m = parseMoney2(r.deposit);
            r.deposit = (m === null ? String(r.deposit || "") : m);
          }
        }

        state.entries = entries;

        // compute totals before search
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

        // sort indicators
        setSort(E.qa("th[data-key]", tableA), state.sortActive);
        setSort(E.qa("th[data-key]", tableD), state.sortDone);
      } catch (e) {
        err("[clientorders] refresh failed", e);
        countA.textContent = "Failed to load";
        countD.textContent = "Failed to load";
        modalError("Client Orders", e);
      }
    }

    state.refresh = refresh;

    btnNew.addEventListener("click", function () {
      openOrderModal({
        mode: "new",
        entry: {
          order_date: todayYmd(),
          priority: 2,
          needed_by: addDaysYmd(2),
          pick_up_date: addDaysYmd(2),
          fulfilled: false,
        },
      });
    });

    btnRefresh.addEventListener("click", function () {
      refresh();
    });

    searchA.addEventListener("input", function () {
      state.queryActive = String(searchA.value || "");
      applyFilterSplitSort();
      renderTable(tbodyA, state.filteredActive);

      // update counts with same totals (best-effort)
      var totalActive = 0;
      for (var i = 0; i < state.entries.length; i++) if (!(state.entries[i] && state.entries[i].fulfilled)) totalActive++;
      countA.textContent = "Showing " + String(state.filteredActive.length) + " / " + String(totalActive);
    });

    searchD.addEventListener("input", function () {
      state.queryDone = String(searchD.value || "");
      applyFilterSplitSort();
      renderTable(tbodyD, state.filteredDone);

      var totalDone = 0;
      for (var i = 0; i < state.entries.length; i++) if (state.entries[i] && state.entries[i].fulfilled) totalDone++;
      countD.textContent = "Showing " + String(state.filteredDone.length) + " / " + String(totalDone);
    });

    btnPrintA.addEventListener("click", function () {
      try {
        openPrintWindow(state.filteredActive || [], "Client Orders — Active", state.queryActive || "");
      } catch (e) {
        modalError("Print", e);
      }
    });

    btnPrintD.addEventListener("click", function () {
      try {
        openPrintWindow(state.filteredDone || [], "Client Orders — Fulfilled", state.queryDone || "");
      } catch (e) {
        modalError("Print", e);
      }
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
    render: render,
  });
})();
