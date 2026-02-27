/* ui/modules.scarcestock.js
   Eikon - Scarce Stock module (UI)

   Endpoints (Cloudflare Worker):
   GET    /scarce-stock/offers
   POST   /scarce-stock/offers
   PUT    /scarce-stock/offers/:id
   DELETE /scarce-stock/offers/:id

   POST   /scarce-stock/offers/:id/requests
   PUT    /scarce-stock/offer-requests/:id
   DELETE /scarce-stock/offer-requests/:id

   GET    /scarce-stock/needs
   POST   /scarce-stock/needs
   PUT    /scarce-stock/needs/:id
   DELETE /scarce-stock/needs/:id

   POST   /scarce-stock/needs/:id/offers
   PUT    /scarce-stock/need-offers/:id
   DELETE /scarce-stock/need-offers/:id

   Privacy rule:
   - Request/offer note + pharmacy identity are visible only to the two locations involved.
   - Everyone else sees only the quantity requested/offered.
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ------------------------------------------------------------
  // Utilities
  // ------------------------------------------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }

  function pad2(n) { n = String(n); return n.length === 1 ? "0" + n : n; }
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }

  function fmtDmy(ymd) {
    var s = String(ymd || "").trim();
    if (!isYmd(s)) return s || "";
    return s.slice(8, 10) + "/" + s.slice(5, 7) + "/" + s.slice(0, 4);
  }

  function intOrZero(v) {
    var n = Number(v);
    if (!Number.isFinite(n)) return 0;
    n = Math.floor(n);
    return n < 0 ? 0 : n;
  }

  function trimMax(v, max) {
    var s = String(v == null ? "" : v).trim();
    if (max && s.length > max) s = s.slice(0, max);
    return s;
  }

  function el(doc, tag, attrs, children) {
    var node = doc.createElement(tag);
    attrs = attrs || {};
    for (var k in attrs) {
      if (!Object.prototype.hasOwnProperty.call(attrs, k)) continue;
      var v = attrs[k];
      if (k === "class") node.className = v;
      else if (k === "text") node.textContent = v;
      else if (k === "html") node.innerHTML = v;
      else if (k === "value") node.value = v;
      else if (k === "checked") node.checked = !!v;
      else if (k.startsWith("on") && typeof v === "function") node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v);
    }
    (children || []).forEach(function (c) {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? doc.createTextNode(c) : c);
    });
    return node;
  }

  // ------------------------------------------------------------
  // Toast (same style as alerts module)
  // ------------------------------------------------------------
  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return;
    toastInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.textContent =
      ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".eikon-toast{border:1px solid var(--border);background:rgba(10,16,24,.95);color:var(--text);border-radius:14px;padding:10px 12px;box-shadow:0 14px 40px rgba(0,0,0,.35);}" +
      ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".eikon-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".eikon-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".eikon-toast.warn{border-color:rgba(255,200,90,.35);}";
    document.head.appendChild(st);
  }
  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("eikon-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "eikon-toast-wrap";
      wrap.className = "eikon-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = document.createElement("div");
    t.className = "eikon-toast " + (kind || "");
    var tt = document.createElement("div");
    tt.className = "t-title";
    tt.textContent = title || "Info";
    var tm = document.createElement("div");
    tm.className = "t-msg";
    tm.textContent = message || "";
    t.appendChild(tt);
    t.appendChild(tm);
    wrap.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, (typeof ms === "number" ? ms : 2600));
  }

  // ------------------------------------------------------------
  // Module CSS (small additions only)
  // ------------------------------------------------------------
  var cssInstalled = false;
  function ensureCss() {
    if (cssInstalled) return;
    cssInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.textContent =
      ".ss-head{display:flex;gap:12px;align-items:flex-end;justify-content:space-between;flex-wrap:wrap;margin-bottom:10px;}" +
      ".ss-sub{color:var(--muted);font-size:12px;max-width:980px;line-height:1.35;margin-top:4px;}" +
      ".ss-tabs{display:flex;gap:10px;align-items:center;flex-wrap:wrap;}" +
      ".ss-tab{border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);border-radius:999px;padding:8px 12px;font-weight:900;font-size:12px;cursor:pointer;}" +
      ".ss-tab.active{border-color:rgba(90,162,255,.45);box-shadow:0 0 0 3px rgba(90,162,255,.18);background:rgba(90,162,255,.12);}" +
      ".ss-actions{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;justify-content:flex-end;}" +
      ".ss-mini{padding:7px 10px;border-radius:12px;font-size:12px;font-weight:800;}" +
      ".ss-note{white-space:pre-wrap;}" +
      ".ss-subpanel{border:1px solid var(--border);border-radius:14px;background:rgba(255,255,255,.03);padding:10px;margin-top:10px;}" +
      ".ss-subhead{display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:8px;}" +
      ".ss-subtitle{font-weight:900;font-size:12px;}" +
      ".ss-kpi{display:flex;gap:8px;flex-wrap:wrap;}" +
      ".ss-badge{display:inline-flex;gap:8px;align-items:center;padding:6px 10px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.03);font-size:12px;font-weight:800;color:var(--muted);}" +
      ".ss-badge.good{border-color:rgba(67,209,122,.35);color:rgba(214,255,228,.95);background:rgba(67,209,122,.10);}" +
      ".ss-badge.bad{border-color:rgba(255,90,122,.35);color:rgba(255,220,228,.95);background:rgba(255,90,122,.10);}" +
      ".ss-badge.warn{border-color:rgba(255,200,90,.35);color:rgba(255,240,210,.95);background:rgba(255,200,90,.10);}" +
      ".ss-row-actions{white-space:nowrap;}" +
      ".ss-inline{display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;}" +
      "@media (max-width:860px){.ss-actions{justify-content:flex-start;width:100%;}}";
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // API helpers
  // ------------------------------------------------------------
  async function api(path, opts) {
    return await E.apiFetch(path, opts || {});
  }

  // ------------------------------------------------------------
  // Print helpers (similar to other modules)
  // ------------------------------------------------------------
  function openPrintWindow(title, metaLines, tableHtml) {
    var w = window.open("", "_blank");
    if (!w) {
      E.modal.show("Print", "<div>Popup blocked. Allow popups and try again.</div>", [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }
    var safeTitle = String(title || "Print").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var meta = (metaLines || []).map(function (l) { return String(l || ""); }).join("\n")
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    var html =
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<title>" + safeTitle + "</title>" +
      "<style>" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:22px;}" +
      "h1{margin:0 0 6px 0;font-size:18px;}" +
      ".meta{font-size:12px;color:#333;margin-top:6px;white-space:pre-wrap;}" +
      "table{width:100%;border-collapse:collapse;font-size:12px;margin-top:12px;}" +
      "th,td{border:1px solid #ddd;padding:6px 8px;vertical-align:top;text-align:left;}" +
      "th{background:#f5f5f5;text-transform:uppercase;letter-spacing:.2px;font-size:11px;}" +
      "@media print{button{display:none!important;}}" +
      "</style></head><body>" +
      "<button onclick='window.print()'>Print</button>" +
      "<h1>" + safeTitle + "</h1>" +
      "<div class='meta'>" + meta + "</div>" +
      tableHtml +
      "</body></html>";
    w.document.open();
    w.document.write(html);
    w.document.close();
  }

  // ------------------------------------------------------------
  // State
  // ------------------------------------------------------------
  var state = {
    tab: "offers", // offers | needs
    q: "",
    showClosed: false,
    offers: [],
    needs: [],
    expandOffers: {},
    expandNeeds: {}
  };

  function offerBlob(o) {
    return (
      norm(o.entry_date) + " | " +
      norm(o.item_name) + " | " +
      norm(o.description) + " | " +
      norm(o.batch) + " | " +
      norm(o.expiry_date) + " | " +
      norm(o.org_name) + " | " +
      norm(o.location_name)
    );
  }

  function needBlob(n) {
    return (
      norm(n.entry_date) + " | " +
      norm(n.item_name) + " | " +
      norm(n.description) + " | " +
      norm(n.needed_by) + " | " +
      norm(n.org_name) + " | " +
      norm(n.location_name)
    );
  }

  function filteredOffers() {
    var q = norm(state.q);
    var out = [];
    for (var i = 0; i < state.offers.length; i++) {
      var o = state.offers[i];
      if (!state.showClosed && (o.is_closed === 1 || o.is_closed === true)) continue;
      if (q && offerBlob(o).indexOf(q) < 0) continue;
      out.push(o);
    }
    return out;
  }

  function filteredNeeds() {
    var q = norm(state.q);
    var out = [];
    for (var i = 0; i < state.needs.length; i++) {
      var n = state.needs[i];
      if (!state.showClosed && (n.is_closed === 1 || n.is_closed === true)) continue;
      if (q && needBlob(n).indexOf(q) < 0) continue;
      out.push(n);
    }
    return out;
  }

  // ------------------------------------------------------------
  // Data load
  // ------------------------------------------------------------
  async function refreshAll() {
    var btn = document.getElementById("ss-refresh");
    try {
      if (btn) { btn.disabled = true; btn.textContent = "Loading…"; }

      var o = await api("/scarce-stock/offers?ts=" + Date.now(), { method: "GET" });
      state.offers = Array.isArray(o && o.offers) ? o.offers : [];

      var n = await api("/scarce-stock/needs?ts=" + Date.now(), { method: "GET" });
      state.needs = Array.isArray(n && n.needs) ? n.needs : [];

      renderTables();
    } catch (e) {
      showError("Scarce Stock", e);
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = "Refresh"; }
    }
  }

  // ------------------------------------------------------------
  // Modals: Offer / Need
  // ------------------------------------------------------------
  function showError(title, e) {
    var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : "Error");
    E.modal.show(title || "Error", "<pre style='white-space:pre-wrap;margin:0'>" + esc(msg) + "</pre>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
  }

  function confirmYesNo(title, body, yesLabel) {
    return new Promise(function (resolve) {
      E.modal.show(title || "Confirm", "<div style='white-space:pre-wrap'>" + esc(body || "") + "</div>", [
        { label: "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
        { label: yesLabel || "OK", primary: true, onClick: function () { E.modal.hide(); resolve(true); } }
      ]);
    });
  }

  function modalOffer(mode, row) {
    var isEdit = mode === "edit";
    var o = row || {};
    var html = ""
      + "<div class='eikon-field'>"
      + "  <div class='eikon-label'>Date</div>"
      + "  <input id='ss-offer-date' class='eikon-input' type='date' value='" + esc(isYmd(o.entry_date) ? o.entry_date : todayYmd()) + "'/>"
      + "</div>"
      + "<div class='eikon-field' style='margin-top:10px'>"
      + "  <div class='eikon-label'>Item name</div>"
      + "  <input id='ss-offer-item' class='eikon-input' type='text' placeholder='e.g. Shingrix vaccine' value='" + esc(o.item_name || "") + "'/>"
      + "</div>"
      + "<div class='eikon-field' style='margin-top:10px'>"
      + "  <div class='eikon-label'>Public description (optional)</div>"
      + "  <textarea id='ss-offer-desc' class='eikon-textarea' placeholder='Public info only (pack size, storage, etc.)'>" + esc(o.description || "") + "</textarea>"
      + "</div>"
      + "<div class='eikon-row' style='margin-top:10px'>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Batch / Lot (optional)</div>"
      + "    <input id='ss-offer-batch' class='eikon-input' type='text' placeholder='Optional' value='" + esc(o.batch || "") + "'/>"
      + "  </div>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Expiry date (optional)</div>"
      + "    <input id='ss-offer-expiry' class='eikon-input' type='date' value='" + esc(isYmd(o.expiry_date) ? o.expiry_date : "") + "'/>"
      + "  </div>"
      + "</div>"
      + "<div class='eikon-row' style='margin-top:10px'>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Quantity available</div>"
      + "    <input id='ss-offer-qty' class='eikon-input' type='number' min='0' step='1' value='" + esc(String(o.quantity_available == null ? 0 : o.quantity_available)) + "'/>"
      + "  </div>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Status</div>"
      + "    <select id='ss-offer-closed' class='eikon-select'>"
      + "      <option value='0'" + ((o.is_closed === 1 || o.is_closed === true) ? "" : " selected") + ">Open</option>"
      + "      <option value='1'" + ((o.is_closed === 1 || o.is_closed === true) ? " selected" : "") + ">Closed</option>"
      + "    </select>"
      + "  </div>"
      + "</div>";

    E.modal.show(isEdit ? "Edit scarce stock" : "Share scarce stock", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save" : "Create",
        primary: true,
        onClick: async function () {
          try {
            var entry_date = trimMax(document.getElementById("ss-offer-date").value, 40);
            var item_name = trimMax(document.getElementById("ss-offer-item").value, 220);
            var description = trimMax(document.getElementById("ss-offer-desc").value, 2000);
            var batch = trimMax(document.getElementById("ss-offer-batch").value, 120);
            var expiry_date = trimMax(document.getElementById("ss-offer-expiry").value, 40);
            var qty = intOrZero(document.getElementById("ss-offer-qty").value);
            var is_closed = intOrZero(document.getElementById("ss-offer-closed").value) ? 1 : 0;

            if (!isYmd(entry_date)) throw new Error("Invalid date");
            if (!item_name) throw new Error("Item name is required");
            if (expiry_date && !isYmd(expiry_date)) throw new Error("Invalid expiry date");

            var payload = {
              entry_date: entry_date,
              item_name: item_name,
              description: description,
              batch: batch,
              expiry_date: expiry_date || null,
              quantity_available: qty,
              is_closed: is_closed
            };

            if (isEdit) {
              await api("/scarce-stock/offers/" + encodeURIComponent(String(o.id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
              toast("Saved", "Scarce stock updated.", "good");
            } else {
              await api("/scarce-stock/offers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
              toast("Shared", "Scarce stock posted for all pharmacies.", "good");
            }

            E.modal.hide();
            await refreshAll();
          } catch (e) {
            showError("Scarce stock", e);
          }
        }
      }
    ]);
  }

  function modalNeed(mode, row) {
    var isEdit = mode === "edit";
    var n = row || {};
    var html = ""
      + "<div class='eikon-field'>"
      + "  <div class='eikon-label'>Date</div>"
      + "  <input id='ss-need-date' class='eikon-input' type='date' value='" + esc(isYmd(n.entry_date) ? n.entry_date : todayYmd()) + "'/>"
      + "</div>"
      + "<div class='eikon-field' style='margin-top:10px'>"
      + "  <div class='eikon-label'>Item name</div>"
      + "  <input id='ss-need-item' class='eikon-input' type='text' placeholder='e.g. Shingrix vaccine' value='" + esc(n.item_name || "") + "'/>"
      + "</div>"
      + "<div class='eikon-field' style='margin-top:10px'>"
      + "  <div class='eikon-label'>Public description (optional)</div>"
      + "  <textarea id='ss-need-desc' class='eikon-textarea' placeholder='Public info only (dose, age group, etc.)'>" + esc(n.description || "") + "</textarea>"
      + "</div>"
      + "<div class='eikon-row' style='margin-top:10px'>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Needed by (optional)</div>"
      + "    <input id='ss-need-neededby' class='eikon-input' type='date' value='" + esc(isYmd(n.needed_by) ? n.needed_by : "") + "'/>"
      + "  </div>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Quantity needed</div>"
      + "    <input id='ss-need-qty' class='eikon-input' type='number' min='0' step='1' value='" + esc(String(n.quantity_needed == null ? 0 : n.quantity_needed)) + "'/>"
      + "  </div>"
      + "</div>"
      + "<div class='eikon-row' style='margin-top:10px'>"
      + "  <div class='eikon-field'>"
      + "    <div class='eikon-label'>Status</div>"
      + "    <select id='ss-need-closed' class='eikon-select'>"
      + "      <option value='0'" + ((n.is_closed === 1 || n.is_closed === true) ? "" : " selected") + ">Open</option>"
      + "      <option value='1'" + ((n.is_closed === 1 || n.is_closed === true) ? " selected" : "") + ">Closed</option>"
      + "    </select>"
      + "  </div>"
      + "</div>"
      + "<div style='margin-top:10px;color:var(--muted);font-size:12px'>Notes are private between the two locations involved.</div>";

    E.modal.show(isEdit ? "Edit request" : "Request stock", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save" : "Create",
        primary: true,
        onClick: async function () {
          try {
            var entry_date = trimMax(document.getElementById("ss-need-date").value, 40);
            var item_name = trimMax(document.getElementById("ss-need-item").value, 220);
            var description = trimMax(document.getElementById("ss-need-desc").value, 2000);
            var needed_by = trimMax(document.getElementById("ss-need-neededby").value, 40);
            var qty = intOrZero(document.getElementById("ss-need-qty").value);
            var is_closed = intOrZero(document.getElementById("ss-need-closed").value) ? 1 : 0;

            if (!isYmd(entry_date)) throw new Error("Invalid date");
            if (!item_name) throw new Error("Item name is required");
            if (needed_by && !isYmd(needed_by)) throw new Error("Invalid needed-by date");

            var payload = {
              entry_date: entry_date,
              item_name: item_name,
              description: description,
              needed_by: needed_by || null,
              quantity_needed: qty,
              is_closed: is_closed
            };

            if (isEdit) {
              await api("/scarce-stock/needs/" + encodeURIComponent(String(n.id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
              toast("Saved", "Request updated.", "good");
            } else {
              await api("/scarce-stock/needs", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(payload)
              });
              toast("Posted", "Request posted for all pharmacies.", "good");
            }

            E.modal.hide();
            await refreshAll();
          } catch (e) {
            showError("Request stock", e);
          }
        }
      }
    ]);
  }

  // ------------------------------------------------------------
  // Modals: Request against offer / Offer against need
  // ------------------------------------------------------------
  function modalOfferRequest(mode, offerRow, reqRow) {
    var isEdit = mode === "edit";
    var o = offerRow || {};
    var r = reqRow || {};
    var html = ""
      + "<div class='eikon-field'>"
      + "  <div class='eikon-label'>Quantity requested</div>"
      + "  <input id='ss-req-qty' class='eikon-input' type='number' min='1' step='1' value='" + esc(String(isEdit ? (r.quantity_requested || 1) : 1)) + "'/>"
      + "</div>"
      + "<div class='eikon-field' style='margin-top:10px'>"
      + "  <div class='eikon-label'>Private note (only you + the offering pharmacy)</div>"
      + "  <textarea id='ss-req-note' class='eikon-textarea' placeholder='Client name + phone, when they can collect, etc.'>" + esc(isEdit ? (r.note || "") : "") + "</textarea>"
      + "</div>"
      + "<div style='margin-top:10px;color:var(--muted);font-size:12px'>Other pharmacies only see the quantity requested.</div>";

    E.modal.show(isEdit ? "Edit request" : "Request this stock", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save" : "Submit",
        primary: true,
        onClick: async function () {
          try {
            var qty = intOrZero(document.getElementById("ss-req-qty").value);
            var note = trimMax(document.getElementById("ss-req-note").value, 4000);
            if (qty <= 0) throw new Error("Quantity must be at least 1");

            if (isEdit) {
              await api("/scarce-stock/offer-requests/" + encodeURIComponent(String(r.id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity_requested: qty, note: note })
              });
              toast("Saved", "Request updated.", "good");
            } else {
              await api("/scarce-stock/offers/" + encodeURIComponent(String(o.id)) + "/requests", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity_requested: qty, note: note })
              });
              toast("Sent", "Request submitted.", "good");
            }

            E.modal.hide();
            await refreshAll();
          } catch (e) {
            showError("Request", e);
          }
        }
      }
    ]);
  }

  function modalNeedOffer(mode, needRow, offerRow) {
    var isEdit = mode === "edit";
    var n = needRow || {};
    var o = offerRow || {};
    var html = ""
      + "<div class='eikon-field'>"
      + "  <div class='eikon-label'>Quantity offered</div>"
      + "  <input id='ss-offer-qty' class='eikon-input' type='number' min='1' step='1' value='" + esc(String(isEdit ? (o.quantity_offered || 1) : 1)) + "'/>"
      + "</div>"
      + "<div class='eikon-field' style='margin-top:10px'>"
      + "  <div class='eikon-label'>Private note (only you + the requesting pharmacy)</div>"
      + "  <textarea id='ss-offer-note' class='eikon-textarea' placeholder='Call us on..., best pickup time, etc.'>" + esc(isEdit ? (o.note || "") : "") + "</textarea>"
      + "</div>"
      + "<div style='margin-top:10px;color:var(--muted);font-size:12px'>Other pharmacies only see the quantity offered.</div>";

    E.modal.show(isEdit ? "Edit offer" : "Offer stock", html, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save" : "Submit",
        primary: true,
        onClick: async function () {
          try {
            var qty = intOrZero(document.getElementById("ss-offer-qty").value);
            var note = trimMax(document.getElementById("ss-offer-note").value, 4000);
            if (qty <= 0) throw new Error("Quantity must be at least 1");

            if (isEdit) {
              await api("/scarce-stock/need-offers/" + encodeURIComponent(String(o.id)), {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity_offered: qty, note: note })
              });
              toast("Saved", "Offer updated.", "good");
            } else {
              await api("/scarce-stock/needs/" + encodeURIComponent(String(n.id)) + "/offers", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ quantity_offered: qty, note: note })
              });
              toast("Sent", "Offer submitted.", "good");
            }

            E.modal.hide();
            await refreshAll();
          } catch (e) {
            showError("Offer stock", e);
          }
        }
      }
    ]);
  }

  // ------------------------------------------------------------
  // Rendering helpers
  // ------------------------------------------------------------
  function badge(text, cls) {
    return '<span class="ss-badge ' + (cls || "") + '">' + esc(text) + "</span>";
  }

  function renderOffersTable(doc) {
    var tbody = doc.getElementById("ss-offers-body");
    var count = doc.getElementById("ss-offers-count");
    if (!tbody || !count) return;

    var list = filteredOffers();
    count.textContent = "Showing " + list.length + " / " + state.offers.length;

    tbody.innerHTML = "";
    if (!list.length) {
      tbody.appendChild(el(doc, "tr", {}, [
        el(doc, "td", { class: "eikon-muted", colspan: "8", text: "No scarce stock posts found." }, [])
      ]));
      return;
    }

    var today = todayYmd();

    list.forEach(function (o) {
      var pharmacy = (o.org_name ? (o.org_name + " — ") : "") + (o.location_name || "");
      var isClosed = (o.is_closed === 1 || o.is_closed === true);
      var isExpired = !!(o.expiry_date && isYmd(o.expiry_date) && String(o.expiry_date) < today);

      var tr = el(doc, "tr", {}, []);
      tr.appendChild(el(doc, "td", { text: fmtDmy(o.entry_date) }, []));
      tr.appendChild(el(doc, "td", { html: "<b>" + esc(pharmacy) + "</b>" + (isClosed ? ("<div style='margin-top:6px'>" + badge("Closed", "warn") + "</div>") : "") }, []));
      tr.appendChild(el(doc, "td", {
        html:
          "<b>" + esc(o.item_name || "") + "</b>" +
          (o.batch ? (" <span class='eikon-muted'>(Batch: " + esc(o.batch) + ")</span>") : "") +
          (o.description ? ("<div class='ss-note eikon-muted' style='margin-top:6px'>" + esc(o.description) + "</div>") : "")
      }, []));
      tr.appendChild(el(doc, "td", { html: o.expiry_date ? (esc(fmtDmy(o.expiry_date)) + (isExpired ? ("<div style='margin-top:6px'>" + badge("Expired", "bad") + "</div>") : "")) : "<span class='eikon-muted'>—</span>" }, []));
      tr.appendChild(el(doc, "td", { text: String(o.quantity_available == null ? 0 : o.quantity_available) }, []));
      tr.appendChild(el(doc, "td", { text: String(o.total_requested == null ? 0 : o.total_requested) }, []));
      tr.appendChild(el(doc, "td", { html: "<b>" + esc(String(o.remaining_quantity == null ? "" : o.remaining_quantity)) + "</b>" }, []));

      // Actions
      var tdAct = el(doc, "td", { class: "ss-row-actions" }, []);
      var expanded = !!state.expandOffers[String(o.id)];

      var btnToggle = el(doc, "button", {
        class: "eikon-btn ss-mini",
        text: expanded ? ("Hide (" + (Array.isArray(o.requests) ? o.requests.length : 0) + ")") : ("Requests (" + (Array.isArray(o.requests) ? o.requests.length : 0) + ")"),
        onclick: function () {
          state.expandOffers[String(o.id)] = !state.expandOffers[String(o.id)];
          renderTables();
        }
      }, []);

      var btnReq = el(doc, "button", {
        class: "eikon-btn primary ss-mini",
        text: "Request",
        onclick: function () { modalOfferRequest("new", o, null); }
      }, []);

      tdAct.appendChild(btnToggle);
      tdAct.appendChild(btnReq);

      if (o.mine_owner) {
        tdAct.appendChild(el(doc, "button", {
          class: "eikon-btn ss-mini",
          text: "Edit",
          onclick: function () { modalOffer("edit", o); }
        }, []));
        tdAct.appendChild(el(doc, "button", {
          class: "eikon-btn danger ss-mini",
          text: "Delete",
          onclick: async function () {
            var ok = await confirmYesNo("Delete", "Delete this scarce stock post? This also deletes its requests.", "Delete");
            if (!ok) return;
            try {
              await api("/scarce-stock/offers/" + encodeURIComponent(String(o.id)), { method: "DELETE" });
              toast("Deleted", "Post deleted.", "good");
              await refreshAll();
            } catch (e) {
              showError("Delete", e);
            }
          }
        }, []));
      }

      tr.appendChild(tdAct);
      tbody.appendChild(tr);

      if (expanded) {
        var subTr = el(doc, "tr", {}, []);
        var subTd = el(doc, "td", { colspan: "8" }, []);
        var panel = el(doc, "div", { class: "ss-subpanel" }, []);

        var reqs = Array.isArray(o.requests) ? o.requests : [];
        panel.appendChild(el(doc, "div", { class: "ss-subhead" }, [
          el(doc, "div", { class: "ss-subtitle", text: "Requests" }, []),
          el(doc, "div", { class: "eikon-muted", text: reqs.length + " request(s)" }, [])
        ]));

        if (!reqs.length) {
          panel.appendChild(el(doc, "div", { class: "eikon-muted", text: "No requests yet." }, []));
        } else {
          var tw = el(doc, "div", { class: "eikon-table-wrap" }, []);
          var t = el(doc, "table", { class: "eikon-table", style: "min-width:760px" }, []);
          t.appendChild(el(doc, "thead", {}, [
            el(doc, "tr", {}, [
              el(doc, "th", { text: "Qty" }, []),
              el(doc, "th", { text: "Pharmacy" }, []),
              el(doc, "th", { text: "Note" }, []),
              el(doc, "th", { text: "Actions" }, [])
            ])
          ]));
          var tb = el(doc, "tbody", {}, []);
          reqs.forEach(function (r) {
            var trr = el(doc, "tr", {}, []);
            trr.appendChild(el(doc, "td", { text: String(r.quantity_requested == null ? 0 : r.quantity_requested) }, []));
            trr.appendChild(el(doc, "td", { text: r.is_private ? "Private" : (r.requester_display || "") }, []));
            trr.appendChild(el(doc, "td", { class: "ss-note", text: r.is_private ? "Private" : (r.note || "") }, []));

            var td = el(doc, "td", {}, []);
            if (r.mine) {
              td.appendChild(el(doc, "button", { class: "eikon-btn ss-mini", text: "Edit", onclick: function () { modalOfferRequest("edit", o, r); } }, []));
              td.appendChild(el(doc, "button", {
                class: "eikon-btn danger ss-mini",
                text: "Delete",
                onclick: async function () {
                  var ok = await confirmYesNo("Delete request", "Delete this request?", "Delete");
                  if (!ok) return;
                  try {
                    await api("/scarce-stock/offer-requests/" + encodeURIComponent(String(r.id)), { method: "DELETE" });
                    toast("Deleted", "Request deleted.", "good");
                    await refreshAll();
                  } catch (e) {
                    showError("Delete request", e);
                  }
                }
              }, []));
            } else {
              td.appendChild(el(doc, "span", { class: "eikon-muted", text: "—" }, []));
            }
            trr.appendChild(td);
            tb.appendChild(trr);
          });
          t.appendChild(tb);
          tw.appendChild(t);
          panel.appendChild(tw);
        }

        subTd.appendChild(panel);
        subTr.appendChild(subTd);
        tbody.appendChild(subTr);
      }
    });
  }

  function renderNeedsTable(doc) {
    var tbody = doc.getElementById("ss-needs-body");
    var count = doc.getElementById("ss-needs-count");
    if (!tbody || !count) return;

    var list = filteredNeeds();
    count.textContent = "Showing " + list.length + " / " + state.needs.length;

    tbody.innerHTML = "";
    if (!list.length) {
      tbody.appendChild(el(doc, "tr", {}, [
        el(doc, "td", { class: "eikon-muted", colspan: "8", text: "No stock requests found." }, [])
      ]));
      return;
    }

    list.forEach(function (n) {
      var pharmacy = (n.org_name ? (n.org_name + " — ") : "") + (n.location_name || "");
      var isClosed = (n.is_closed === 1 || n.is_closed === true);

      var tr = el(doc, "tr", {}, []);
      tr.appendChild(el(doc, "td", { text: fmtDmy(n.entry_date) }, []));
      tr.appendChild(el(doc, "td", { html: "<b>" + esc(pharmacy) + "</b>" + (isClosed ? ("<div style='margin-top:6px'>" + badge("Closed", "warn") + "</div>") : "") }, []));
      tr.appendChild(el(doc, "td", {
        html:
          "<b>" + esc(n.item_name || "") + "</b>" +
          (n.description ? ("<div class='ss-note eikon-muted' style='margin-top:6px'>" + esc(n.description) + "</div>") : "")
      }, []));
      tr.appendChild(el(doc, "td", { html: n.needed_by ? esc(fmtDmy(n.needed_by)) : "<span class='eikon-muted'>—</span>" }, []));
      tr.appendChild(el(doc, "td", { text: String(n.quantity_needed == null ? 0 : n.quantity_needed) }, []));
      tr.appendChild(el(doc, "td", { text: String(n.total_offered == null ? 0 : n.total_offered) }, []));
      tr.appendChild(el(doc, "td", { html: "<b>" + esc(String(n.remaining_quantity == null ? "" : n.remaining_quantity)) + "</b>" }, []));

      var tdAct = el(doc, "td", { class: "ss-row-actions" }, []);
      var expanded = !!state.expandNeeds[String(n.id)];

      tdAct.appendChild(el(doc, "button", {
        class: "eikon-btn ss-mini",
        text: expanded ? ("Hide (" + (Array.isArray(n.offers) ? n.offers.length : 0) + ")") : ("Offers (" + (Array.isArray(n.offers) ? n.offers.length : 0) + ")"),
        onclick: function () {
          state.expandNeeds[String(n.id)] = !state.expandNeeds[String(n.id)];
          renderTables();
        }
      }, []));

      tdAct.appendChild(el(doc, "button", {
        class: "eikon-btn primary ss-mini",
        text: "Offer stock",
        onclick: function () { modalNeedOffer("new", n, null); }
      }, []));

      if (n.mine_owner) {
        tdAct.appendChild(el(doc, "button", { class: "eikon-btn ss-mini", text: "Edit", onclick: function () { modalNeed("edit", n); } }, []));
        tdAct.appendChild(el(doc, "button", {
          class: "eikon-btn danger ss-mini",
          text: "Delete",
          onclick: async function () {
            var ok = await confirmYesNo("Delete", "Delete this request? This also deletes its offers.", "Delete");
            if (!ok) return;
            try {
              await api("/scarce-stock/needs/" + encodeURIComponent(String(n.id)), { method: "DELETE" });
              toast("Deleted", "Request deleted.", "good");
              await refreshAll();
            } catch (e) {
              showError("Delete", e);
            }
          }
        }, []));
      }

      tr.appendChild(tdAct);
      tbody.appendChild(tr);

      if (expanded) {
        var subTr = el(doc, "tr", {}, []);
        var subTd = el(doc, "td", { colspan: "8" }, []);
        var panel = el(doc, "div", { class: "ss-subpanel" }, []);

        var offs = Array.isArray(n.offers) ? n.offers : [];
        panel.appendChild(el(doc, "div", { class: "ss-subhead" }, [
          el(doc, "div", { class: "ss-subtitle", text: "Offers" }, []),
          el(doc, "div", { class: "eikon-muted", text: offs.length + " offer(s)" }, [])
        ]));

        if (!offs.length) {
          panel.appendChild(el(doc, "div", { class: "eikon-muted", text: "No offers yet." }, []));
        } else {
          var tw = el(doc, "div", { class: "eikon-table-wrap" }, []);
          var t = el(doc, "table", { class: "eikon-table", style: "min-width:760px" }, []);
          t.appendChild(el(doc, "thead", {}, [
            el(doc, "tr", {}, [
              el(doc, "th", { text: "Qty" }, []),
              el(doc, "th", { text: "Pharmacy" }, []),
              el(doc, "th", { text: "Note" }, []),
              el(doc, "th", { text: "Actions" }, [])
            ])
          ]));
          var tb = el(doc, "tbody", {}, []);
          offs.forEach(function (o) {
            var trr = el(doc, "tr", {}, []);
            trr.appendChild(el(doc, "td", { text: String(o.quantity_offered == null ? 0 : o.quantity_offered) }, []));
            trr.appendChild(el(doc, "td", { text: o.is_private ? "Private" : (o.offerer_display || "") }, []));
            trr.appendChild(el(doc, "td", { class: "ss-note", text: o.is_private ? "Private" : (o.note || "") }, []));

            var td = el(doc, "td", {}, []);
            if (o.mine) {
              td.appendChild(el(doc, "button", { class: "eikon-btn ss-mini", text: "Edit", onclick: function () { modalNeedOffer("edit", n, o); } }, []));
              td.appendChild(el(doc, "button", {
                class: "eikon-btn danger ss-mini",
                text: "Delete",
                onclick: async function () {
                  var ok = await confirmYesNo("Delete offer", "Delete this offer?", "Delete");
                  if (!ok) return;
                  try {
                    await api("/scarce-stock/need-offers/" + encodeURIComponent(String(o.id)), { method: "DELETE" });
                    toast("Deleted", "Offer deleted.", "good");
                    await refreshAll();
                  } catch (e) {
                    showError("Delete offer", e);
                  }
                }
              }, []));
            } else {
              td.appendChild(el(doc, "span", { class: "eikon-muted", text: "—" }, []));
            }
            trr.appendChild(td);
            tb.appendChild(trr);
          });
          t.appendChild(tb);
          tw.appendChild(t);
          panel.appendChild(tw);
        }

        subTd.appendChild(panel);
        subTr.appendChild(subTd);
        tbody.appendChild(subTr);
      }
    });
  }

  function renderTables() {
    var doc = document;
    var offersPane = doc.getElementById("ss-pane-offers");
    var needsPane = doc.getElementById("ss-pane-needs");
    if (offersPane && needsPane) {
      offersPane.style.display = (state.tab === "offers") ? "" : "none";
      needsPane.style.display = (state.tab === "needs") ? "" : "none";
    }
    renderOffersTable(doc);
    renderNeedsTable(doc);
  }

  function doPrintCurrent() {
    var now = new Date().toLocaleString();
    var q = String(state.q || "").trim();

    if (state.tab === "offers") {
      var rows = filteredOffers();
      var html = "<table><tr>" +
        "<th>Date</th><th>Pharmacy</th><th>Item</th><th>Expiry</th><th>Qty</th><th>Requested</th><th>Remaining</th>" +
        "</tr>";
      rows.forEach(function (o) {
        var pharmacy = (o.org_name ? (o.org_name + " — ") : "") + (o.location_name || "");
        html += "<tr>" +
          "<td>" + esc(fmtDmy(o.entry_date)) + "</td>" +
          "<td>" + esc(pharmacy) + "</td>" +
          "<td><b>" + esc(o.item_name || "") + "</b>" +
            (o.batch ? ("<div style='opacity:.75'>Batch: " + esc(o.batch) + "</div>") : "") +
            (o.description ? ("<div style='opacity:.85;white-space:pre-wrap'>" + esc(o.description) + "</div>") : "") +
          "</td>" +
          "<td>" + esc(o.expiry_date ? fmtDmy(o.expiry_date) : "") + "</td>" +
          "<td>" + esc(String(o.quantity_available == null ? 0 : o.quantity_available)) + "</td>" +
          "<td>" + esc(String(o.total_requested == null ? 0 : o.total_requested)) + "</td>" +
          "<td><b>" + esc(String(o.remaining_quantity == null ? "" : o.remaining_quantity)) + "</b></td>" +
          "</tr>";

        var reqs = Array.isArray(o.requests) ? o.requests : [];
        if (reqs.length) {
          html += "<tr><td colspan='7'><div style='margin:6px 0 4px 0;font-weight:800'>Requests</div>" +
            "<table style='width:100%;border-collapse:collapse'><tr>" +
            "<th style='border:1px solid #ddd;padding:6px'>Qty</th>" +
            "<th style='border:1px solid #ddd;padding:6px'>Pharmacy</th>" +
            "<th style='border:1px solid #ddd;padding:6px'>Note</th>" +
            "</tr>";
          reqs.forEach(function (r) {
            html += "<tr>" +
              "<td style='border:1px solid #ddd;padding:6px'>" + esc(String(r.quantity_requested == null ? 0 : r.quantity_requested)) + "</td>" +
              "<td style='border:1px solid #ddd;padding:6px'>" + esc(r.is_private ? "Private" : (r.requester_display || "")) + "</td>" +
              "<td style='border:1px solid #ddd;padding:6px;white-space:pre-wrap'>" + esc(r.is_private ? "Private" : (r.note || "")) + "</td>" +
              "</tr>";
          });
          html += "</table></td></tr>";
        }
      });
      html += "</table>";

      openPrintWindow(
        "Scarce Stock — Available",
        ["Rows: " + rows.length, "Search: " + (q || "-"), "Printed: " + now],
        html
      );
    } else {
      var rows2 = filteredNeeds();
      var html2 = "<table><tr>" +
        "<th>Date</th><th>Pharmacy</th><th>Item</th><th>Needed by</th><th>Qty</th><th>Offered</th><th>Remaining</th>" +
        "</tr>";
      rows2.forEach(function (n) {
        var pharmacy2 = (n.org_name ? (n.org_name + " — ") : "") + (n.location_name || "");
        html2 += "<tr>" +
          "<td>" + esc(fmtDmy(n.entry_date)) + "</td>" +
          "<td>" + esc(pharmacy2) + "</td>" +
          "<td><b>" + esc(n.item_name || "") + "</b>" +
            (n.description ? ("<div style='opacity:.85;white-space:pre-wrap'>" + esc(n.description) + "</div>") : "") +
          "</td>" +
          "<td>" + esc(n.needed_by ? fmtDmy(n.needed_by) : "") + "</td>" +
          "<td>" + esc(String(n.quantity_needed == null ? 0 : n.quantity_needed)) + "</td>" +
          "<td>" + esc(String(n.total_offered == null ? 0 : n.total_offered)) + "</td>" +
          "<td><b>" + esc(String(n.remaining_quantity == null ? "" : n.remaining_quantity)) + "</b></td>" +
          "</tr>";

        var offs = Array.isArray(n.offers) ? n.offers : [];
        if (offs.length) {
          html2 += "<tr><td colspan='7'><div style='margin:6px 0 4px 0;font-weight:800'>Offers</div>" +
            "<table style='width:100%;border-collapse:collapse'><tr>" +
            "<th style='border:1px solid #ddd;padding:6px'>Qty</th>" +
            "<th style='border:1px solid #ddd;padding:6px'>Pharmacy</th>" +
            "<th style='border:1px solid #ddd;padding:6px'>Note</th>" +
            "</tr>";
          offs.forEach(function (o) {
            html2 += "<tr>" +
              "<td style='border:1px solid #ddd;padding:6px'>" + esc(String(o.quantity_offered == null ? 0 : o.quantity_offered)) + "</td>" +
              "<td style='border:1px solid #ddd;padding:6px'>" + esc(o.is_private ? "Private" : (o.offerer_display || "")) + "</td>" +
              "<td style='border:1px solid #ddd;padding:6px;white-space:pre-wrap'>" + esc(o.is_private ? "Private" : (o.note || "")) + "</td>" +
              "</tr>";
          });
          html2 += "</table></td></tr>";
        }
      });
      html2 += "</table>";

      openPrintWindow(
        "Scarce Stock — Requests",
        ["Rows: " + rows2.length, "Search: " + (q || "-"), "Printed: " + now],
        html2
      );
    }
  }

  // ------------------------------------------------------------
  // Render entry
  // ------------------------------------------------------------
  async function render(ctx) {
    ensureCss();
    ensureToastStyles();

    var doc = ctx.doc || document;
    var mount = ctx.mount;

    mount.innerHTML = "";

    var head = el(doc, "div", { class: "ss-head" }, [
      el(doc, "div", {}, [
        el(doc, "div", { class: "eikon-page-title", text: "Scarce Stock" }, []),
        el(doc, "div", {
          class: "ss-sub",
          html:
            "Share scarce items across all pharmacies and request stock when needed. " +
            "<b>Notes are private</b> between the two locations involved; everyone else sees only requested/offered quantities."
        }, [])
      ]),
      el(doc, "div", { class: "ss-tabs" }, [
        el(doc, "button", { id: "ss-tab-offers", class: "ss-tab active", text: "Available stock" }, []),
        el(doc, "button", { id: "ss-tab-needs", class: "ss-tab", text: "Request stock" }, [])
      ])
    ]);

    var toolbar = el(doc, "div", { class: "eikon-card" }, [
      el(doc, "div", { class: "ss-inline" }, [
        el(doc, "div", { class: "eikon-row", style: "align-items:flex-end" }, [
          el(doc, "div", { class: "eikon-field" }, [
            el(doc, "div", { class: "eikon-label", text: "Search (while typing)" }, []),
            el(doc, "input", { id: "ss-q", class: "eikon-input", type: "text", placeholder: "Search pharmacy, item, description, batch…" }, [])
          ]),
          el(doc, "div", { class: "eikon-field" }, [
            el(doc, "div", { class: "eikon-label", text: "View" }, []),
            el(doc, "select", { id: "ss-show-closed", class: "eikon-select" }, [
              el(doc, "option", { value: "0", text: "Open only" }, []),
              el(doc, "option", { value: "1", text: "Include closed" }, [])
            ])
          ])
        ]),
        el(doc, "div", { class: "ss-actions" }, [
          el(doc, "button", { id: "ss-new", class: "eikon-btn primary", text: "New offer" }, []),
          el(doc, "button", { id: "ss-print", class: "eikon-btn", text: "Print" }, []),
          el(doc, "button", { id: "ss-refresh", class: "eikon-btn", text: "Refresh" }, [])
        ])
      ])
    ]);

    var paneOffers = el(doc, "div", { id: "ss-pane-offers", class: "eikon-card", style: "margin-top:12px" }, [
      el(doc, "div", { class: "eikon-row", style: "justify-content:space-between;align-items:center" }, [
        el(doc, "div", { html: "<b>Available scarce stock</b>" }, []),
        el(doc, "div", { id: "ss-offers-count", class: "eikon-muted", text: "Loading…" }, [])
      ]),
      el(doc, "div", { class: "eikon-table-wrap", style: "margin-top:10px" }, [
        el(doc, "table", { class: "eikon-table", style: "min-width:1040px" }, [
          el(doc, "thead", {}, [
            el(doc, "tr", {}, [
              el(doc, "th", { text: "Date", style: "width:110px" }, []),
              el(doc, "th", { text: "Pharmacy", style: "width:240px" }, []),
              el(doc, "th", { text: "Item" }, []),
              el(doc, "th", { text: "Expiry", style: "width:130px" }, []),
              el(doc, "th", { text: "Qty", style: "width:90px" }, []),
              el(doc, "th", { text: "Requested", style: "width:110px" }, []),
              el(doc, "th", { text: "Remaining", style: "width:110px" }, []),
              el(doc, "th", { text: "Actions", style: "width:280px" }, [])
            ])
          ]),
          el(doc, "tbody", { id: "ss-offers-body" }, [
            el(doc, "tr", {}, [el(doc, "td", { colspan: "8", class: "eikon-muted", text: "Loading…" }, [])])
          ])
        ])
      ])
    ]);

    var paneNeeds = el(doc, "div", { id: "ss-pane-needs", class: "eikon-card", style: "display:none;margin-top:12px" }, [
      el(doc, "div", { class: "eikon-row", style: "justify-content:space-between;align-items:center" }, [
        el(doc, "div", { html: "<b>Requested stock</b>" }, []),
        el(doc, "div", { id: "ss-needs-count", class: "eikon-muted", text: "Loading…" }, [])
      ]),
      el(doc, "div", { class: "eikon-table-wrap", style: "margin-top:10px" }, [
        el(doc, "table", { class: "eikon-table", style: "min-width:1040px" }, [
          el(doc, "thead", {}, [
            el(doc, "tr", {}, [
              el(doc, "th", { text: "Date", style: "width:110px" }, []),
              el(doc, "th", { text: "Pharmacy", style: "width:240px" }, []),
              el(doc, "th", { text: "Item" }, []),
              el(doc, "th", { text: "Needed by", style: "width:130px" }, []),
              el(doc, "th", { text: "Qty", style: "width:90px" }, []),
              el(doc, "th", { text: "Offered", style: "width:110px" }, []),
              el(doc, "th", { text: "Remaining", style: "width:110px" }, []),
              el(doc, "th", { text: "Actions", style: "width:280px" }, [])
            ])
          ]),
          el(doc, "tbody", { id: "ss-needs-body" }, [
            el(doc, "tr", {}, [el(doc, "td", { colspan: "8", class: "eikon-muted", text: "Loading…" }, [])])
          ])
        ])
      ])
    ]);

    mount.appendChild(head);
    mount.appendChild(toolbar);
    mount.appendChild(paneOffers);
    mount.appendChild(paneNeeds);

    // Events
    var tabOffers = doc.getElementById("ss-tab-offers");
    var tabNeeds = doc.getElementById("ss-tab-needs");

    function setTab(t) {
      state.tab = (t === "needs") ? "needs" : "offers";
      if (tabOffers) tabOffers.classList.toggle("active", state.tab === "offers");
      if (tabNeeds) tabNeeds.classList.toggle("active", state.tab === "needs");
      var btnNew = doc.getElementById("ss-new");
      if (btnNew) btnNew.textContent = (state.tab === "offers") ? "New offer" : "New request";
      renderTables();
    }

    if (tabOffers) tabOffers.addEventListener("click", function () { setTab("offers"); });
    if (tabNeeds) tabNeeds.addEventListener("click", function () { setTab("needs"); });

    var qEl = doc.getElementById("ss-q");
    if (qEl) qEl.addEventListener("input", function () {
      state.q = String(qEl.value || "");
      renderTables();
    });

    var scEl = doc.getElementById("ss-show-closed");
    if (scEl) scEl.addEventListener("change", function () {
      state.showClosed = String(scEl.value || "0") === "1";
      renderTables();
    });

    var btnNew = doc.getElementById("ss-new");
    if (btnNew) btnNew.addEventListener("click", function () {
      if (state.tab === "offers") modalOffer("new", { entry_date: todayYmd() });
      else modalNeed("new", { entry_date: todayYmd() });
    });

    var btnPrint = doc.getElementById("ss-print");
    if (btnPrint) btnPrint.addEventListener("click", function () {
      try { doPrintCurrent(); } catch (e) { showError("Print", e); }
    });

    var btnRefresh = doc.getElementById("ss-refresh");
    if (btnRefresh) btnRefresh.addEventListener("click", function () {
      refreshAll().catch(function (e) { showError("Refresh", e); });
    });

    setTab("offers");
    await refreshAll();
  }

  E.registerModule({
    id: "scarcestock",
    title: "Scarce Stock",
    icon: "📦",
    order: 280,
    render: render
  });
})();
