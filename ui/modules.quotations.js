/* ui/modules.quotations.js
   Eikon - Quotations module (UI)

   Endpoints (Worker):
     GET    /quotations/entries?q=...&all_org=1
     POST   /quotations/entries
     PUT    /quotations/entries/:id
     DELETE /quotations/entries/:id
     POST   /quotations/entries/:id/items
     PUT    /quotations/entries/:id/items/:itemId
     DELETE /quotations/entries/:id/items/:itemId

   Features:
   - Grouped quotations (header + line items)
   - Live search while typing
   - Toggle to view all org locations
   - Auto-calculated VAT cross-fill (excl ↔ incl)
   - Auto-calculated discount cross-fill (% ↔ €)
   - Profit & profit margin with colour gradient
   - Description similarity detection & bulk merge
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.quotations.js)");

  // ─── Debug helpers ────────────────────────────────────────────────────────
  var LOG_PREFIX = "[EIKON][quotations]";
  function log() {
    try { console.log.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }
  function warn() {
    try { console.warn.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }
  function err() {
    try { console.error.apply(console, [LOG_PREFIX].concat([].slice.call(arguments))); } catch (e) {}
  }

  // ─── Utilities ────────────────────────────────────────────────────────────
  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;")
        .replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
  }

  function pad2(n) { var v = String(n); return v.length === 1 ? "0" + v : v; }
  function toYmd(d) {
    try { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
    catch (e) { return ""; }
  }
  function todayYmd() { return toYmd(new Date()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function fmtDate(s) {
    var v = String(s || "").trim();
    if (!isYmd(v)) return v;
    return v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4);
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmt2(n) { return round2(n).toFixed(2); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }

  // ─── Calculations ─────────────────────────────────────────────────────────
  var VAT_RATES = [0, 5, 18];

  function recalcItem(f) {
    // f._lastEdited: "cost_excl" | "cost_incl" | "discount_pct" | "discount_euro" | "vat"
    var vat = Number(f.vat_rate);
    if (vat !== 0 && vat !== 5 && vat !== 18) vat = 18;
    var mult = 1 + vat / 100;

    var excl = Math.max(0, Number(f.cost_excl_vat) || 0);
    var incl = Math.max(0, Number(f.cost_incl_vat) || 0);
    var discPct = Math.max(0, Number(f.discount_pct) || 0);
    var discEuro = Math.max(0, Number(f.discount_euro) || 0);
    var qty = Math.max(1, Math.round(Number(f.qty_purchased) || 1));
    var free = Math.max(0, Math.round(Number(f.qty_free) || 0));
    var retail = Math.max(0, Number(f.retail_price) || 0);
    var le = f._lastEdited || "";

    // VAT cross-calc
    if (vat === 0) {
      if (le === "cost_excl" || le === "vat") incl = excl;
      else excl = incl;
    } else {
      if (le === "cost_excl" || le === "vat") incl = round2(excl * mult);
      else excl = round2(incl / mult);
    }

    // Discount cross-calc (on cost_excl_vat)
    if (le === "discount_pct") {
      discEuro = excl > 0 ? round2(excl * discPct / 100) : 0;
    } else if (le === "discount_euro") {
      discPct = excl > 0 ? round2(discEuro / excl * 100) : 0;
    }

    // Ensure discount doesn't exceed cost
    if (discEuro > excl) { discEuro = excl; discPct = 100; }
    if (discPct > 100) { discPct = 100; discEuro = excl; }

    // Effective cost after discount, then VAT
    var effExcl = Math.max(0, excl - discEuro);
    var effIncl = vat === 0 ? effExcl : round2(effExcl * mult);

    var totalInclVat = round2(effIncl * qty);
    var totalUnits = qty + free;
    var totalRetail = round2(retail * totalUnits);
    var profit = round2(totalRetail - totalInclVat);
    var margin = totalRetail > 0 ? round2(profit / totalRetail * 100) : 0;

    return {
      cost_excl_vat: round2(excl),
      cost_incl_vat: round2(incl),
      discount_pct: round2(discPct),
      discount_euro: round2(discEuro),
      total_incl_vat: totalInclVat,
      profit: profit,
      profit_margin: margin
    };
  }

  function profitMarginColor(pct) {
    var p = Number(pct) || 0;
    if (!isFinite(p) || p <= 0) return "#ff5a7a";
    if (p >= 35) return "#43d17a";
    if (p <= 20) return "#ff5a7a";
    var t = (p - 20) / 15; // 0=red, 1=green
    var hue = Math.round(t * 120);
    return "hsl(" + hue + ",88%,52%)";
  }

  function profitMarginLabel(pct) {
    var p = Number(pct) || 0;
    if (p <= 0) return "Poor";
    if (p < 20) return "Poor";
    if (p < 35) return "OK";
    return "Good";
  }

  // ─── Similarity Algorithm ─────────────────────────────────────────────────
  var SIMILARITY_THRESHOLD = 0.65;

  function tokenize(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]/g, " ").split(/\s+/).filter(Boolean);
  }

  function jaccardSimilarity(a, b) {
    var ta = tokenize(a), tb = tokenize(b);
    if (!ta.length && !tb.length) return 1;
    if (!ta.length || !tb.length) return 0;
    var setA = Object.create(null), inter = 0;
    for (var i = 0; i < ta.length; i++) setA[ta[i]] = 1;
    for (var j = 0; j < tb.length; j++) { if (setA[tb[j]]) inter++; }
    return inter / (ta.length + tb.length - inter);
  }

  function levenshtein(a, b) {
    var m = a.length, n = b.length;
    var dp = [];
    for (var i = 0; i <= m; i++) { dp[i] = [i]; }
    for (var j = 0; j <= n; j++) { dp[0][j] = j; }
    for (var r = 1; r <= m; r++) {
      for (var c = 1; c <= n; c++) {
        if (a[r - 1] === b[c - 1]) dp[r][c] = dp[r - 1][c - 1];
        else dp[r][c] = 1 + Math.min(dp[r - 1][c], dp[r][c - 1], dp[r - 1][c - 1]);
      }
    }
    return dp[m][n];
  }

  function descSimilarity(a, b) {
    var na = norm(a), nb = norm(b);
    if (na === nb) return 1.0;
    if (!na || !nb) return 0;
    var jac = jaccardSimilarity(na, nb);
    if (Math.max(na.length, nb.length) <= 40) {
      var maxLen = Math.max(na.length, nb.length);
      var editSim = maxLen > 0 ? 1 - levenshtein(na, nb) / maxLen : 1;
      return Math.max(jac, editSim);
    }
    return jac;
  }

  function collectAllDescriptions() {
    var descCount = Object.create(null);
    var all = state.quotations || [];
    for (var i = 0; i < all.length; i++) {
      var items = all[i].items || [];
      for (var j = 0; j < items.length; j++) {
        var d = String(items[j].item_description || "").trim();
        if (d) descCount[d] = (descCount[d] || 0) + 1;
      }
    }
    return descCount; // { description: count }
  }

  function findSimilarDescriptions(typed, excludeExact) {
    var descCount = collectAllDescriptions();
    var results = [];
    var normTyped = norm(typed);
    Object.keys(descCount).forEach(function (d) {
      if (excludeExact && norm(d) === normTyped) return;
      var sim = descSimilarity(typed, d);
      if (sim >= SIMILARITY_THRESHOLD && norm(d) !== normTyped) {
        results.push({ desc: d, count: descCount[d], sim: sim });
      }
    });
    results.sort(function (a, b) { return b.sim - a.sim; });
    return results.slice(0, 5);
  }

  function clusterDescriptions() {
    var descCount = collectAllDescriptions();
    var descs = Object.keys(descCount);
    // Union-Find
    var parent = {};
    descs.forEach(function (d) { parent[d] = d; });
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) { parent[find(a)] = find(b); }

    for (var i = 0; i < descs.length; i++) {
      for (var j = i + 1; j < descs.length; j++) {
        if (descSimilarity(descs[i], descs[j]) >= SIMILARITY_THRESHOLD) {
          union(descs[i], descs[j]);
        }
      }
    }

    // Group by root
    var groups = Object.create(null);
    descs.forEach(function (d) {
      var root = find(d);
      if (!groups[root]) groups[root] = [];
      groups[root].push(d);
    });

    // Return only groups with 2+ distinct descriptions
    return Object.values(groups).filter(function (g) { return g.length >= 2; }).map(function (g) {
      g.sort(function (a, b) { return (descCount[b] || 0) - (descCount[a] || 0); });
      return {
        variants: g,
        counts: g.map(function (d) { return descCount[d] || 0; }),
        canonical: g[0] // most-used as default
      };
    });
  }

  // ─── State ────────────────────────────────────────────────────────────────
  var state = {
    quotations: [],
    filtered: [],
    selectedId: null,
    query: "",
    showAllOrg: false,
    loading: false,
    refresh: null,
    mounted: false
  };

  // ─── Styles ───────────────────────────────────────────────────────────────
  var qtStyleInstalled = false;
  function ensureQuotationsStyles() {
    if (qtStyleInstalled) return;
    qtStyleInstalled = true;
    var st = document.createElement("style");
    st.id = "eikon-quotations-style";
    st.textContent =
      ".qt-wrap{max-width:1500px;margin:0 auto;padding:16px;}" +
      ".qt-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:14px;}" +
      ".qt-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".qt-sub{margin:4px 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".qt-controls{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end;}" +

      // search + toggle
      ".qt-field{display:flex;flex-direction:column;gap:4px;}" +
      ".qt-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +
      ".qt-field input,.qt-field select,.qt-field textarea{" +
        "padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
        "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;font-size:13px;" +
        "transition:border-color 120ms,box-shadow 120ms,background 120ms;" +
      "}" +
      ".qt-field input:focus,.qt-field select:focus,.qt-field textarea:focus{" +
        "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);background:rgba(10,16,24,.74);" +
      "}" +
      ".qt-field input::placeholder,.qt-field textarea::placeholder{color:rgba(233,238,247,.40);}" +
      ".qt-field select{color-scheme:dark;}" +
      ".qt-field input[type=date]{color-scheme:dark;}" +

      // toggle button
      ".qt-toggle{padding:9px 16px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
        "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);cursor:pointer;font-size:13px;font-weight:800;" +
        "transition:background 120ms,border-color 120ms;" +
      "}" +
      ".qt-toggle.active{background:rgba(58,160,255,.18);border-color:rgba(58,160,255,.45);color:#5aa2ff;}" +

      // cards
      ".qt-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:14px;" +
        "background:var(--panel,rgba(16,24,36,.66));margin-bottom:10px;cursor:pointer;" +
        "transition:border-color 120ms,background 120ms;box-shadow:0 4px 20px rgba(0,0,0,.25);" +
      "}" +
      ".qt-card:hover{border-color:rgba(255,255,255,.18);background:rgba(16,24,36,.80);}" +
      ".qt-card.selected{border-color:rgba(58,160,255,.5);background:rgba(58,160,255,.07);}" +
      ".qt-card-head{display:flex;flex-wrap:wrap;align-items:flex-start;justify-content:space-between;gap:10px;}" +
      ".qt-card-supplier{font-size:15px;font-weight:900;color:var(--text,#e9eef7);margin-bottom:3px;}" +
      ".qt-card-meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".qt-card-actions{display:flex;gap:8px;align-items:center;flex-shrink:0;}" +
      ".qt-chip{font-size:11px;font-weight:900;padding:3px 9px;border-radius:999px;" +
        "border:1px solid rgba(255,255,255,.12);background:rgba(10,16,24,.35);color:var(--muted,rgba(233,238,247,.78));}" +

      // detail panel
      ".qt-detail{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;" +
        "background:var(--panel,rgba(16,24,36,.66));padding:14px;margin-bottom:14px;" +
        "box-shadow:0 8px 30px rgba(0,0,0,.3);" +
      "}" +
      ".qt-detail-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:10px;margin-bottom:12px;}" +
      ".qt-detail-title{font-size:16px;font-weight:900;color:var(--text,#e9eef7);margin:0;}" +
      ".qt-detail-meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));margin-top:4px;}" +
      ".qt-detail-actions{display:flex;gap:8px;flex-wrap:wrap;}" +

      // table
      ".qt-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;" +
        "background:rgba(10,16,24,.18);margin-bottom:10px;" +
      "}" +
      ".qt-table{border-collapse:collapse;min-width:100%;color:var(--text,#e9eef7);font-size:12px;white-space:nowrap;}" +
      ".qt-table th,.qt-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:7px 10px;vertical-align:middle;}" +
      ".qt-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;" +
        "color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;" +
        "font-weight:1000;font-size:11px;text-align:left;white-space:nowrap;}" +
      ".qt-table tbody tr:hover{background:rgba(255,255,255,.04);}" +
      ".qt-table .num{text-align:right;font-variant-numeric:tabular-nums;}" +
      ".qt-table .act{text-align:center;width:64px;}" +

      // profit margin badge
      ".qt-margin-cell{display:inline-flex;align-items:center;gap:6px;font-weight:900;border-radius:8px;" +
        "padding:3px 8px;font-size:11px;" +
      "}" +

      // empty state
      ".qt-empty{text-align:center;padding:40px 16px;color:var(--muted,rgba(233,238,247,.68));font-size:13px;}" +

      // similarity suggestions
      ".qt-suggestions{margin-top:6px;border:1px solid rgba(255,200,90,.25);border-radius:10px;" +
        "background:rgba(255,200,90,.05);padding:8px 10px;" +
      "}" +
      ".qt-suggestions .qt-sug-title{font-size:11px;font-weight:900;color:rgba(255,200,90,.85);" +
        "text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px;" +
      "}" +
      ".qt-sug-item{display:flex;align-items:center;justify-content:space-between;gap:8px;" +
        "padding:4px 0;border-bottom:1px solid rgba(255,255,255,.06);" +
      "}" +
      ".qt-sug-item:last-child{border-bottom:none;}" +
      ".qt-sug-desc{font-size:12px;color:var(--text,#e9eef7);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}" +
      ".qt-sug-use{font-size:11px;font-weight:900;padding:3px 8px;border-radius:8px;" +
        "border:1px solid rgba(58,160,255,.35);background:rgba(58,160,255,.12);color:#5aa2ff;" +
        "cursor:pointer;white-space:nowrap;" +
      "}" +

      // merge modal
      ".qt-merge-group{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin-bottom:10px;}" +
      ".qt-merge-group-title{font-size:12px;font-weight:900;color:var(--muted,rgba(233,238,247,.68));margin-bottom:8px;}" +
      ".qt-merge-variant{font-size:12px;color:var(--text,#e9eef7);padding:3px 0;display:flex;justify-content:space-between;}" +
      ".qt-merge-count{font-size:11px;color:var(--muted,rgba(233,238,247,.58));}" +
      ".qt-merge-input{width:100%;margin-top:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;" +
        "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);font-size:13px;outline:none;" +
      "}" +
      ".qt-merge-input:focus{border-color:rgba(58,160,255,.55);}" +
      ".qt-merge-btn{margin-top:8px;padding:6px 14px;border-radius:8px;border:none;cursor:pointer;" +
        "background:rgba(58,160,255,.22);color:#5aa2ff;font-size:12px;font-weight:900;" +
      "}" +

      // loading spinner
      ".qt-loading{text-align:center;padding:32px;color:var(--muted,rgba(233,238,247,.68));font-size:13px;}" +

      "@media(max-width:900px){.qt-wrap{padding:12px;}.qt-controls{width:100%;}}";

    document.head.appendChild(st);
  }

  // ─── API ──────────────────────────────────────────────────────────────────
  async function apiFetch(path, opts) {
    return E.apiFetch(path, opts || {});
  }

  async function apiList() {
    var qs = [];
    if (state.query) qs.push("q=" + encodeURIComponent(state.query));
    if (state.showAllOrg) qs.push("all_org=1");
    var url = "/quotations/entries" + (qs.length ? "?" + qs.join("&") : "");
    return apiFetch(url, { method: "GET" });
  }

  async function apiCreate(payload) {
    return apiFetch("/quotations/entries", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function apiUpdate(id, payload) {
    return apiFetch("/quotations/entries/" + encodeURIComponent(id), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function apiDelete(id) {
    return apiFetch("/quotations/entries/" + encodeURIComponent(id), { method: "DELETE" });
  }

  async function apiItemAdd(quotationId, payload) {
    return apiFetch("/quotations/entries/" + encodeURIComponent(quotationId) + "/items", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function apiItemUpdate(quotationId, itemId, payload) {
    return apiFetch(
      "/quotations/entries/" + encodeURIComponent(quotationId) + "/items/" + encodeURIComponent(itemId),
      { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) }
    );
  }

  async function apiItemDelete(quotationId, itemId) {
    return apiFetch(
      "/quotations/entries/" + encodeURIComponent(quotationId) + "/items/" + encodeURIComponent(itemId),
      { method: "DELETE" }
    );
  }

  // ─── Error modal helper ───────────────────────────────────────────────────
  function showError(title, e) {
    var msg = String(e && (e.message || e.bodyText || e) ? (e.message || e.bodyText || e) : "Unknown error");
    E.modal.show(title || "Error",
      "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>",
      [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
    );
  }

  // ─── Quotation Header Modal ───────────────────────────────────────────────
  function openQuotationModal(opts) {
    var isEdit = opts && opts.mode === "edit";
    var row = (opts && opts.row) || {};

    var initial = {
      supplier_name: String(row.supplier_name || "").trim(),
      quote_ref: String(row.quote_ref || "").trim(),
      quote_date: isYmd(row.quote_date) ? row.quote_date : todayYmd(),
      notes: String(row.notes || "").trim()
    };

    var body =
      "<div class='qt-field' style='margin-bottom:10px;'><label>Supplier Name</label>" +
        "<input id='qt-h-supplier' type='text' value='" + esc(initial.supplier_name) + "' placeholder='e.g. ABC Pharma Ltd'></div>" +
      "<div class='qt-field' style='margin-bottom:10px;'><label>Quote Reference (Optional)</label>" +
        "<input id='qt-h-ref' type='text' value='" + esc(initial.quote_ref) + "' placeholder='e.g. Q-2026-001'></div>" +
      "<div class='qt-field' style='margin-bottom:10px;'><label>Date</label>" +
        "<input id='qt-h-date' type='date' value='" + esc(initial.quote_date) + "'></div>" +
      "<div class='qt-field'><label>Notes (Optional)</label>" +
        "<textarea id='qt-h-notes' rows='3' placeholder='Optional notes...'>" + esc(initial.notes) + "</textarea></div>";

    E.modal.show(isEdit ? "Edit Quotation" : "New Quotation", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save Changes" : "Create Quotation",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var supplier = (E.q("#qt-h-supplier").value || "").trim();
              var ref = (E.q("#qt-h-ref").value || "").trim();
              var date = (E.q("#qt-h-date").value || "").trim();
              var notes = (E.q("#qt-h-notes").value || "").trim();

              if (!isYmd(date)) throw new Error("Date is required (YYYY-MM-DD)");

              var payload = { supplier_name: supplier, quote_ref: ref, quote_date: date, notes: notes };

              if (isEdit) {
                var r = await apiUpdate(row.id, payload);
                if (!r || !r.ok) throw new Error((r && r.error) || "Update failed");
              } else {
                var r2 = await apiCreate(payload);
                if (!r2 || !r2.ok) throw new Error((r2 && r2.error) || "Create failed");
                // Auto-select the new quotation
                if (r2.id) state.selectedId = r2.id;
              }
              E.modal.hide();
              if (state.refresh) state.refresh();
            } catch (e) {
              showError("Save failed", e);
            }
          })();
        }
      }
    ]);
  }

  // ─── Item Modal ───────────────────────────────────────────────────────────
  var itemSuggestTimer = null;

  function openItemModal(quotationId, opts) {
    var isEdit = opts && opts.mode === "edit";
    var row = (opts && opts.row) || {};

    var iv = {
      barcode: String(row.barcode || "").trim(),
      stock_code: String(row.stock_code || "").trim(),
      item_description: String(row.item_description || "").trim(),
      qty_purchased: String(row.qty_purchased || "1"),
      qty_free: String(row.qty_free || "0"),
      vat_rate: String(row.vat_rate !== undefined ? row.vat_rate : "18"),
      cost_excl_vat: row.cost_excl_vat ? fmt2(row.cost_excl_vat) : "",
      cost_incl_vat: row.cost_incl_vat ? fmt2(row.cost_incl_vat) : "",
      discount_pct: row.discount_pct ? fmt2(row.discount_pct) : "",
      discount_euro: row.discount_euro ? fmt2(row.discount_euro) : "",
      total_incl_vat: row.total_incl_vat ? fmt2(row.total_incl_vat) : "",
      retail_price: row.retail_price ? fmt2(row.retail_price) : "",
      profit: row.profit !== undefined ? fmt2(row.profit) : "",
      profit_margin: row.profit_margin !== undefined ? fmt2(row.profit_margin) : ""
    };

    function vatOpt(v) {
      return "<option value='" + v + "'" + (String(iv.vat_rate) === String(v) ? " selected" : "") + ">" + v + "%</option>";
    }

    var body =
      // Row 1: identification
      "<div style='display:grid;grid-template-columns:1fr 1fr 2fr;gap:10px;margin-bottom:10px;'>" +
        "<div class='qt-field'><label>Barcode</label>" +
          "<input id='qt-i-barcode' type='text' value='" + esc(iv.barcode) + "' placeholder='Optional'></div>" +
        "<div class='qt-field'><label>Stock Code</label>" +
          "<input id='qt-i-scode' type='text' value='" + esc(iv.stock_code) + "' placeholder='Optional'></div>" +
        "<div class='qt-field'><label>Item Description *</label>" +
          "<input id='qt-i-desc' type='text' value='" + esc(iv.item_description) + "' placeholder='e.g. Amoxicillin 500mg'>" +
          "<div id='qt-i-suggestions'></div></div>" +
      "</div>" +
      // Row 2: quantities
      "<div style='display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-bottom:10px;'>" +
        "<div class='qt-field'><label>Qty Purchased</label>" +
          "<input id='qt-i-qty' type='number' min='1' step='1' value='" + esc(iv.qty_purchased) + "'></div>" +
        "<div class='qt-field'><label>Qty Free</label>" +
          "<input id='qt-i-free' type='number' min='0' step='1' value='" + esc(iv.qty_free) + "'></div>" +
        "<div class='qt-field'><label>VAT Rate</label>" +
          "<select id='qt-i-vat'>" + vatOpt(0) + vatOpt(5) + vatOpt(18) + "</select></div>" +
      "</div>" +
      // Row 3: costs
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;'>" +
        "<div class='qt-field'><label>Cost Excl. VAT (€)</label>" +
          "<input id='qt-i-excl' type='number' min='0' step='0.01' value='" + esc(iv.cost_excl_vat) + "' placeholder='0.00'></div>" +
        "<div class='qt-field'><label>Cost Incl. VAT (€)</label>" +
          "<input id='qt-i-incl' type='number' min='0' step='0.01' value='" + esc(iv.cost_incl_vat) + "' placeholder='0.00'></div>" +
      "</div>" +
      // Row 4: discount
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;'>" +
        "<div class='qt-field'><label>Discount %</label>" +
          "<input id='qt-i-dpct' type='number' min='0' max='100' step='0.01' value='" + esc(iv.discount_pct) + "' placeholder='0.00'></div>" +
        "<div class='qt-field'><label>Discount € (2 dec)</label>" +
          "<input id='qt-i-deuro' type='number' min='0' step='0.01' value='" + esc(iv.discount_euro) + "' placeholder='0.00'></div>" +
      "</div>" +
      // Row 5: totals + retail
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;'>" +
        "<div class='qt-field'><label>Total Incl. VAT (€) — auto</label>" +
          "<input id='qt-i-total' type='text' readonly style='opacity:.6;cursor:default;' value='" + esc(iv.total_incl_vat) + "' placeholder='Calculated'></div>" +
        "<div class='qt-field'><label>Retail Price (€)</label>" +
          "<input id='qt-i-retail' type='number' min='0' step='0.01' value='" + esc(iv.retail_price) + "' placeholder='0.00'></div>" +
      "</div>" +
      // Row 6: profit (read-only)
      "<div style='display:grid;grid-template-columns:1fr 1fr;gap:10px;'>" +
        "<div class='qt-field'><label>Profit (€) — auto</label>" +
          "<input id='qt-i-profit' type='text' readonly style='opacity:.6;cursor:default;' value='" + esc(iv.profit) + "' placeholder='Calculated'></div>" +
        "<div class='qt-field'><label>Profit Margin % — auto</label>" +
          "<div id='qt-i-margin-wrap' style='padding:10px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.64);font-size:13px;font-weight:900;'>" +
            (iv.profit_margin ? fmt2(iv.profit_margin) + "%" : "—") +
          "</div></div>" +
      "</div>";

    E.modal.show(isEdit ? "Edit Item" : "Add Item", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save Item" : "Add Item",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              var desc = (E.q("#qt-i-desc").value || "").trim();
              if (!desc) throw new Error("Item Description is required");

              var fields = gatherItemFields();
              var calc = recalcItem(Object.assign({}, fields, { _lastEdited: "" }));

              var payload = {
                barcode: (E.q("#qt-i-barcode").value || "").trim(),
                stock_code: (E.q("#qt-i-scode").value || "").trim(),
                item_description: desc,
                qty_purchased: Math.max(1, parseInt(E.q("#qt-i-qty").value, 10) || 1),
                qty_free: Math.max(0, parseInt(E.q("#qt-i-free").value, 10) || 0),
                vat_rate: Number(E.q("#qt-i-vat").value),
                cost_excl_vat: calc.cost_excl_vat,
                cost_incl_vat: calc.cost_incl_vat,
                discount_pct: calc.discount_pct,
                discount_euro: calc.discount_euro,
                total_incl_vat: calc.total_incl_vat,
                retail_price: Math.max(0, Number(E.q("#qt-i-retail").value) || 0),
                profit: calc.profit,
                profit_margin: calc.profit_margin
              };
              // Recompute with correct retail
              var final = recalcItem(Object.assign({}, payload, { _lastEdited: "" }));
              payload.total_incl_vat = final.total_incl_vat;
              payload.profit = final.profit;
              payload.profit_margin = final.profit_margin;

              var resp;
              if (isEdit) {
                resp = await apiItemUpdate(quotationId, row.id, payload);
              } else {
                resp = await apiItemAdd(quotationId, payload);
              }
              if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Save failed");

              E.modal.hide();
              if (state.refresh) state.refresh();
            } catch (e) {
              showError("Save failed", e);
            }
          })();
        }
      }
    ]);

    // Wire up live calculations
    setTimeout(function () { wireItemModalCalc(); }, 30);
  }

  function gatherItemFields() {
    return {
      vat_rate: Number(E.q("#qt-i-vat").value),
      cost_excl_vat: Number(E.q("#qt-i-excl").value) || 0,
      cost_incl_vat: Number(E.q("#qt-i-incl").value) || 0,
      discount_pct: Number(E.q("#qt-i-dpct").value) || 0,
      discount_euro: Number(E.q("#qt-i-deuro").value) || 0,
      qty_purchased: Math.max(1, parseInt(E.q("#qt-i-qty").value, 10) || 1),
      qty_free: Math.max(0, parseInt(E.q("#qt-i-free").value, 10) || 0),
      retail_price: Number(E.q("#qt-i-retail").value) || 0
    };
  }

  function updateItemModalCalcOutputs(result) {
    var exclEl = E.q("#qt-i-excl");
    var inclEl = E.q("#qt-i-incl");
    var dpctEl = E.q("#qt-i-dpct");
    var deuroEl = E.q("#qt-i-deuro");
    var totalEl = E.q("#qt-i-total");
    var profitEl = E.q("#qt-i-profit");
    var marginWrap = E.q("#qt-i-margin-wrap");

    if (exclEl) exclEl.value = result.cost_excl_vat > 0 ? fmt2(result.cost_excl_vat) : exclEl.value;
    if (inclEl) inclEl.value = result.cost_incl_vat > 0 ? fmt2(result.cost_incl_vat) : inclEl.value;
    if (dpctEl) dpctEl.value = result.discount_pct > 0 ? fmt2(result.discount_pct) : dpctEl.value;
    if (deuroEl) deuroEl.value = result.discount_euro > 0 ? fmt2(result.discount_euro) : deuroEl.value;
    if (totalEl) totalEl.value = fmt2(result.total_incl_vat);
    if (profitEl) profitEl.value = fmt2(result.profit);
    if (marginWrap) {
      var pct = result.profit_margin;
      var color = profitMarginColor(pct);
      marginWrap.style.color = color;
      marginWrap.style.borderColor = color + "55";
      marginWrap.textContent = fmt2(pct) + "% (" + profitMarginLabel(pct) + ")";
    }
  }

  function wireItemModalCalc() {
    function getEl(id) { try { return E.q(id); } catch (e) { return null; } }

    var exclEl = getEl("#qt-i-excl");
    var inclEl = getEl("#qt-i-incl");
    var dpctEl = getEl("#qt-i-dpct");
    var deuroEl = getEl("#qt-i-deuro");
    var vatEl = getEl("#qt-i-vat");
    var qtyEl = getEl("#qt-i-qty");
    var freeEl = getEl("#qt-i-free");
    var retailEl = getEl("#qt-i-retail");
    var descEl = getEl("#qt-i-desc");
    var sugEl = getEl("#qt-i-suggestions");

    function calc(lastEdited) {
      var fields = gatherItemFields();
      fields._lastEdited = lastEdited;
      var result = recalcItem(fields);

      // Update dependent fields without triggering recursion
      if (lastEdited === "cost_excl" && inclEl) {
        inclEl.value = result.cost_incl_vat > 0 || fields.cost_excl_vat > 0 ? fmt2(result.cost_incl_vat) : "";
      }
      if (lastEdited === "cost_incl" && exclEl) {
        exclEl.value = result.cost_excl_vat > 0 || fields.cost_incl_vat > 0 ? fmt2(result.cost_excl_vat) : "";
      }
      if (lastEdited === "vat") {
        if (exclEl && exclEl.value) {
          if (inclEl) inclEl.value = fmt2(result.cost_incl_vat);
        } else if (inclEl && inclEl.value) {
          if (exclEl) exclEl.value = fmt2(result.cost_excl_vat);
        }
      }
      if (lastEdited === "discount_pct" && deuroEl) {
        deuroEl.value = result.discount_euro > 0 ? fmt2(result.discount_euro) : "";
      }
      if (lastEdited === "discount_euro" && dpctEl) {
        dpctEl.value = result.discount_pct > 0 ? fmt2(result.discount_pct) : "";
      }

      updateItemModalCalcOutputs(result);
    }

    if (exclEl) exclEl.addEventListener("input", function () { calc("cost_excl"); });
    if (inclEl) inclEl.addEventListener("input", function () { calc("cost_incl"); });
    if (dpctEl) dpctEl.addEventListener("input", function () { calc("discount_pct"); });
    if (deuroEl) deuroEl.addEventListener("input", function () { calc("discount_euro"); });
    if (vatEl) vatEl.addEventListener("change", function () { calc("vat"); });
    if (qtyEl) qtyEl.addEventListener("input", function () { calc("qty"); });
    if (freeEl) freeEl.addEventListener("input", function () { calc("qty"); });
    if (retailEl) retailEl.addEventListener("input", function () { calc("retail"); });

    // Initial calc
    if (exclEl && exclEl.value) calc("cost_excl");
    else if (inclEl && inclEl.value) calc("cost_incl");

    // Description similarity
    if (descEl && sugEl) {
      descEl.addEventListener("input", function () {
        clearTimeout(itemSuggestTimer);
        itemSuggestTimer = setTimeout(function () {
          var typed = (descEl.value || "").trim();
          if (typed.length < 2) { sugEl.innerHTML = ""; return; }
          var sims = findSimilarDescriptions(typed, true);
          if (!sims.length) { sugEl.innerHTML = ""; return; }
          var html = "<div class='qt-suggestions'>" +
            "<div class='qt-sug-title'>Similar descriptions found</div>";
          sims.forEach(function (s) {
            html += "<div class='qt-sug-item'>" +
              "<span class='qt-sug-desc' title='" + esc(s.desc) + "'>" + esc(s.desc) + " <span style='opacity:.5'>(" + s.count + "x)</span></span>" +
              "<button class='qt-sug-use' data-desc='" + esc(s.desc) + "'>Use this</button>" +
              "</div>";
          });
          html += "</div>";
          sugEl.innerHTML = html;
          // Wire use buttons
          var btns = sugEl.querySelectorAll(".qt-sug-use");
          btns.forEach(function (btn) {
            btn.addEventListener("click", function () {
              descEl.value = btn.getAttribute("data-desc");
              sugEl.innerHTML = "";
            });
          });
        }, 300);
      });
    }
  }

  // ─── Merge Duplicates Modal ───────────────────────────────────────────────
  function openMergeModal() {
    var clusters = clusterDescriptions();

    if (!clusters.length) {
      E.modal.show("Find Duplicates",
        "<div class='qt-empty' style='padding:20px;'>" +
          "<div style='font-size:24px;margin-bottom:8px;'>✓</div>" +
          "<div>No similar descriptions found.</div>" +
        "</div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
      return;
    }

    var html = "<div style='margin-bottom:10px;font-size:13px;color:var(--muted,rgba(233,238,247,.68));'>" +
      "Found " + clusters.length + " group" + (clusters.length !== 1 ? "s" : "") + " of similar descriptions. " +
      "Edit the canonical description and click Merge.</div>";

    clusters.forEach(function (grp, gi) {
      html += "<div class='qt-merge-group' id='qt-merge-group-" + gi + "'>" +
        "<div class='qt-merge-group-title'>Group " + (gi + 1) + " — " + grp.variants.length + " variants, " +
          grp.counts.reduce(function (s, c) { return s + c; }, 0) + " items</div>";
      grp.variants.forEach(function (v, vi) {
        html += "<div class='qt-merge-variant'><span>" + esc(v) + "</span>" +
          "<span class='qt-merge-count'>" + grp.counts[vi] + " item" + (grp.counts[vi] !== 1 ? "s" : "") + "</span></div>";
      });
      html += "<input class='qt-merge-input' id='qt-merge-canon-" + gi + "' type='text' value='" + esc(grp.canonical) + "' placeholder='Canonical description'>" +
        "<button class='qt-merge-btn' id='qt-merge-btn-" + gi + "'>Merge this group</button>" +
        "</div>";
    });

    html += "<div id='qt-merge-status' style='font-size:12px;color:var(--muted,rgba(233,238,247,.68));margin-top:8px;'></div>";

    E.modal.show("Find & Merge Duplicates", html, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      {
        label: "Merge All",
        primary: true,
        onClick: function () {
          (async function () {
            var statusEl = E.q("#qt-merge-status");
            var totalMerged = 0;
            for (var gi = 0; gi < clusters.length; gi++) {
              var canon = (E.q("#qt-merge-canon-" + gi).value || "").trim();
              if (!canon) continue;
              totalMerged += await mergeCluster(clusters[gi], canon, statusEl);
            }
            E.modal.hide();
            if (state.refresh) await state.refresh();
            E.modal.show("Merge Complete",
              "<div style='padding:12px;'>Merged descriptions across " + totalMerged + " item(s).</div>",
              [{ label: "OK", primary: true, onClick: function () { E.modal.hide(); } }]
            );
          })();
        }
      }
    ]);

    // Wire individual merge buttons
    setTimeout(function () {
      clusters.forEach(function (grp, gi) {
        var btn = E.q("#qt-merge-btn-" + gi);
        if (!btn) return;
        btn.addEventListener("click", function () {
          (async function () {
            var canonEl = E.q("#qt-merge-canon-" + gi);
            var canon = (canonEl ? canonEl.value : "").trim();
            if (!canon) { alert("Please enter a canonical description"); return; }
            var statusEl = E.q("#qt-merge-status");
            var n = await mergeCluster(grp, canon, statusEl);
            if (state.refresh) await state.refresh();
            var groupEl = E.q("#qt-merge-group-" + gi);
            if (groupEl) groupEl.style.opacity = "0.4";
            if (statusEl) statusEl.textContent = "Merged " + n + " item(s) in group " + (gi + 1);
          })();
        });
      });
    }, 30);
  }

  async function mergeCluster(grp, canon, statusEl) {
    var total = 0;
    var all = state.quotations || [];
    for (var i = 0; i < all.length; i++) {
      var q = all[i];
      var items = q.items || [];
      for (var j = 0; j < items.length; j++) {
        var it = items[j];
        if (grp.variants.indexOf(it.item_description) >= 0 && it.item_description !== canon) {
          try {
            if (statusEl) statusEl.textContent = "Updating item " + it.id + "...";
            await apiItemUpdate(q.id, it.id, { item_description: canon });
            total++;
          } catch (e) {
            warn("Merge failed for item " + it.id, e);
          }
        }
      }
    }
    return total;
  }

  // ─── Rendering ────────────────────────────────────────────────────────────
  function applyFilter() {
    var all = state.quotations || [];
    if (!state.query) { state.filtered = all.slice(); return; }
    var q = norm(state.query);
    state.filtered = all.filter(function (row) {
      if (norm(row.supplier_name).indexOf(q) >= 0) return true;
      if (norm(row.quote_ref).indexOf(q) >= 0) return true;
      if (norm(row.quote_date).indexOf(q) >= 0) return true;
      if (norm(row.notes).indexOf(q) >= 0) return true;
      return (row.items || []).some(function (it) {
        return norm(it.item_description).indexOf(q) >= 0 ||
          norm(it.barcode).indexOf(q) >= 0 ||
          norm(it.stock_code).indexOf(q) >= 0;
      });
    });
  }

  function renderQuotationList(listEl) {
    listEl.innerHTML = "";

    if (state.loading) {
      listEl.innerHTML = "<div class='qt-loading'>Loading quotations…</div>";
      return;
    }

    var list = state.filtered || [];
    if (!list.length) {
      listEl.innerHTML = "<div class='qt-empty'>No quotations found." +
        (state.query ? " Try clearing the search." : " Click \"New Quotation\" to get started.") + "</div>";
      return;
    }

    list.forEach(function (q) {
      var card = document.createElement("div");
      card.className = "qt-card" + (String(state.selectedId) === String(q.id) ? " selected" : "");
      card.setAttribute("data-id", q.id);

      var itemCount = (q.items || []).length;
      var metaParts = [fmtDate(q.quote_date)];
      if (q.quote_ref) metaParts.push("#" + q.quote_ref);
      if (state.showAllOrg && q.location_name) metaParts.push(q.location_name);

      card.innerHTML =
        "<div class='qt-card-head'>" +
          "<div style='flex:1;min-width:0;'>" +
            "<div class='qt-card-supplier'>" + esc(q.supplier_name || "(No supplier)") + "</div>" +
            "<div class='qt-card-meta'>" + esc(metaParts.join(" · ")) + "</div>" +
          "</div>" +
          "<div class='qt-card-actions'>" +
            "<span class='qt-chip'>" + itemCount + " item" + (itemCount !== 1 ? "s" : "") + "</span>" +
          "</div>" +
        "</div>";

      card.addEventListener("click", function () {
        state.selectedId = String(q.id);
        renderAll();
      });

      listEl.appendChild(card);
    });
  }

  function renderItemsTable(quotation) {
    var items = (quotation && quotation.items) || [];

    if (!items.length) {
      return "<div class='qt-empty' style='padding:20px;'>No items yet. Click \"Add Item\" to add products.</div>";
    }

    var html =
      "<div class='qt-table-wrap'>" +
      "<table class='qt-table'><thead><tr>" +
        "<th>Barcode</th><th>Stock Code</th><th>Description</th>" +
        "<th class='num'>Qty</th><th class='num'>Free</th><th class='num'>VAT</th>" +
        "<th class='num'>Cost Excl</th><th class='num'>Cost Incl</th>" +
        "<th class='num'>Disc%</th><th class='num'>Disc€</th><th class='num'>Total Incl</th>" +
        "<th class='num'>Retail</th><th class='num'>Profit</th><th class='num'>Margin%</th>" +
        "<th class='act'>Actions</th>" +
      "</tr></thead><tbody>";

    items.forEach(function (it) {
      var marginColor = profitMarginColor(it.profit_margin);
      html +=
        "<tr data-item-id='" + it.id + "'>" +
          "<td>" + esc(it.barcode || "—") + "</td>" +
          "<td>" + esc(it.stock_code || "—") + "</td>" +
          "<td style='max-width:200px;white-space:normal;word-break:break-word;'>" + esc(it.item_description) + "</td>" +
          "<td class='num'>" + esc(it.qty_purchased) + "</td>" +
          "<td class='num'>" + esc(it.qty_free) + "</td>" +
          "<td class='num'>" + esc(it.vat_rate) + "%</td>" +
          "<td class='num'>€" + fmt2(it.cost_excl_vat) + "</td>" +
          "<td class='num'>€" + fmt2(it.cost_incl_vat) + "</td>" +
          "<td class='num'>" + fmt2(it.discount_pct) + "%</td>" +
          "<td class='num'>€" + fmt2(it.discount_euro) + "</td>" +
          "<td class='num'>€" + fmt2(it.total_incl_vat) + "</td>" +
          "<td class='num'>€" + fmt2(it.retail_price) + "</td>" +
          "<td class='num'>€" + fmt2(it.profit) + "</td>" +
          "<td class='num'><span class='qt-margin-cell' style='background:" + marginColor + "22;color:" + marginColor + ";'>" +
            fmt2(it.profit_margin) + "% <span style='font-size:10px;opacity:.8;'>(" + profitMarginLabel(it.profit_margin) + ")</span></span></td>" +
          "<td class='act'>" +
            "<button class='eikon-btn' style='padding:4px 8px;font-size:11px;' data-edit-item='" + it.id + "'>✎</button> " +
            "<button class='eikon-btn' style='padding:4px 8px;font-size:11px;' data-del-item='" + it.id + "'>✕</button>" +
          "</td>" +
        "</tr>";
    });

    html += "</tbody></table></div>";
    return html;
  }

  function renderDetailPanel(detailEl) {
    if (!state.selectedId) {
      detailEl.style.display = "none";
      return;
    }

    var q = null;
    var list = state.filtered || [];
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(state.selectedId)) { q = list[i]; break; }
    }
    // Also check unfiltered (in case it was just created)
    if (!q) {
      var all = state.quotations || [];
      for (var i2 = 0; i2 < all.length; i2++) {
        if (String(all[i2].id) === String(state.selectedId)) { q = all[i2]; break; }
      }
    }

    if (!q) {
      detailEl.style.display = "none";
      state.selectedId = null;
      return;
    }

    detailEl.style.display = "";

    var metaParts = [fmtDate(q.quote_date)];
    if (q.quote_ref) metaParts.push("Ref: " + q.quote_ref);
    if (q.created_by_name) metaParts.push("By: " + q.created_by_name);
    if (state.showAllOrg && q.location_name) metaParts.push("Location: " + q.location_name);

    var isMyLocation = !state.showAllOrg || String(q.location_id) === String(E.state && E.state.user && E.state.user.location_id);

    detailEl.innerHTML =
      "<div class='qt-detail-head'>" +
        "<div>" +
          "<h2 class='qt-detail-title'>" + esc(q.supplier_name || "(No supplier)") + "</h2>" +
          "<div class='qt-detail-meta'>" + esc(metaParts.join(" · ")) + "</div>" +
          (q.notes ? "<div style='margin-top:4px;font-size:12px;color:var(--muted,rgba(233,238,247,.68));'>" + esc(q.notes) + "</div>" : "") +
        "</div>" +
        (isMyLocation ?
          "<div class='qt-detail-actions'>" +
            "<button class='eikon-btn' id='qt-detail-edit'>Edit Header</button>" +
            "<button class='eikon-btn' id='qt-detail-add-item'>+ Add Item</button>" +
            "<button class='eikon-btn' style='border-color:var(--danger,#ff5a7a);color:var(--danger,#ff5a7a);' id='qt-detail-delete'>Delete</button>" +
          "</div>"
          : "<div style='font-size:11px;color:var(--muted,rgba(233,238,247,.58));'>View only (other location)</div>"
        ) +
      "</div>" +
      renderItemsTable(q);

    // Wire header buttons
    var editBtn = E.q("#qt-detail-edit", detailEl);
    if (editBtn) editBtn.addEventListener("click", function () { openQuotationModal({ mode: "edit", row: q }); });

    var addItemBtn = E.q("#qt-detail-add-item", detailEl);
    if (addItemBtn) addItemBtn.addEventListener("click", function () { openItemModal(q.id, { mode: "new" }); });

    var delBtn = E.q("#qt-detail-delete", detailEl);
    if (delBtn) {
      delBtn.addEventListener("click", function () {
        E.modal.show("Delete Quotation?",
          "<div style='white-space:pre-wrap;'>This will permanently delete the quotation and all its items.\n\nSupplier: " + esc(q.supplier_name || "(none)") + "\nDate: " + esc(fmtDate(q.quote_date)) + "\nItems: " + ((q.items || []).length) + "</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            {
              label: "Delete",
              primary: true,
              onClick: function () {
                (async function () {
                  try {
                    var r = await apiDelete(q.id);
                    if (!r || !r.ok) throw new Error((r && r.error) || "Delete failed");
                    state.selectedId = null;
                    E.modal.hide();
                    if (state.refresh) state.refresh();
                  } catch (e) {
                    showError("Delete failed", e);
                  }
                })();
              }
            }
          ]
        );
      });
    }

    // Wire item action buttons
    var editItemBtns = detailEl.querySelectorAll("[data-edit-item]");
    editItemBtns.forEach(function (btn) {
      var itemId = String(btn.getAttribute("data-edit-item"));
      btn.addEventListener("click", function () {
        var item = (q.items || []).find(function (it) { return String(it.id) === itemId; });
        if (item) openItemModal(q.id, { mode: "edit", row: item });
      });
    });

    var delItemBtns = detailEl.querySelectorAll("[data-del-item]");
    delItemBtns.forEach(function (btn) {
      var itemId = String(btn.getAttribute("data-del-item"));
      btn.addEventListener("click", function () {
        var item = (q.items || []).find(function (it) { return String(it.id) === itemId; });
        if (!item) return;
        E.modal.show("Delete Item?",
          "<div style='white-space:pre-wrap;'>Delete: " + esc(item.item_description) + "</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            {
              label: "Delete",
              primary: true,
              onClick: function () {
                (async function () {
                  try {
                    var r = await apiItemDelete(q.id, item.id);
                    if (!r || !r.ok) throw new Error((r && r.error) || "Delete failed");
                    E.modal.hide();
                    if (state.refresh) state.refresh();
                  } catch (e) {
                    showError("Delete failed", e);
                  }
                })();
              }
            }
          ]
        );
      });
    });
  }

  function renderAll() {
    applyFilter();
    var listEl = document.querySelector("#qt-list");
    var detailEl = document.querySelector("#qt-detail");
    var countEl = document.querySelector("#qt-count");
    if (listEl) renderQuotationList(listEl);
    if (detailEl) renderDetailPanel(detailEl);
    if (countEl) {
      var total = (state.quotations || []).length;
      var shown = (state.filtered || []).length;
      countEl.textContent = shown === total ? total + " quotation" + (total !== 1 ? "s" : "") :
        shown + " / " + total + " quotations";
    }
    // Re-highlight selected card
    var allCards = document.querySelectorAll(".qt-card");
    allCards.forEach(function (c) {
      var id = c.getAttribute("data-id");
      if (String(id) === String(state.selectedId)) c.classList.add("selected");
      else c.classList.remove("selected");
    });
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  async function render(ctx) {
    ensureQuotationsStyles();

    var mount = ctx.mount;
    mount.innerHTML =
      "<div class='qt-wrap'>" +
        "<div class='qt-head'>" +
          "<div>" +
            "<h2 class='qt-title'>Quotations</h2>" +
            "<div class='qt-sub' id='qt-count'>Loading…</div>" +
          "</div>" +
          "<div class='qt-controls'>" +
            "<div class='qt-field'><label>Search</label>" +
              "<input id='qt-search' type='text' value='' placeholder='Supplier, ref, item…' style='min-width:220px;'></div>" +
            "<div style='display:flex;align-items:flex-end;gap:8px;'>" +
              "<button class='qt-toggle' id='qt-org-toggle' type='button'>My Location</button>" +
              "<button class='eikon-btn' id='qt-merge-btn' type='button'>Find Duplicates</button>" +
              "<button class='eikon-btn' id='qt-new' type='button'>New Quotation</button>" +
              "<button class='eikon-btn' id='qt-refresh' type='button'>Refresh</button>" +
            "</div>" +
          "</div>" +
        "</div>" +

        "<div id='qt-detail' class='qt-detail' style='display:none;'></div>" +
        "<div id='qt-list'><div class='qt-loading'>Loading…</div></div>" +
      "</div>";

    var searchEl = E.q("#qt-search", mount);
    var toggleEl = E.q("#qt-org-toggle", mount);
    var newBtn = E.q("#qt-new", mount);
    var refreshBtn = E.q("#qt-refresh", mount);
    var mergeBtn = E.q("#qt-merge-btn", mount);

    // Search
    var searchTimer = null;
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = (searchEl.value || "").trim();
        renderAll();
      }, 200);
    });

    // Org toggle
    toggleEl.addEventListener("click", function () {
      state.showAllOrg = !state.showAllOrg;
      toggleEl.textContent = state.showAllOrg ? "All Org Locations" : "My Location";
      toggleEl.classList.toggle("active", state.showAllOrg);
      if (state.refresh) state.refresh();
    });

    // New quotation
    newBtn.addEventListener("click", function () { openQuotationModal({ mode: "new" }); });

    // Find duplicates
    mergeBtn.addEventListener("click", function () { openMergeModal(); });

    // Refresh
    state.refresh = async function () {
      state.loading = true;
      renderAll();
      try {
        var resp = await apiList();
        state.quotations = (resp && resp.quotations) || [];
        state.loading = false;
        // If selectedId no longer in list, clear it
        var ids = state.quotations.map(function (q) { return String(q.id); });
        if (state.selectedId && ids.indexOf(String(state.selectedId)) < 0) state.selectedId = null;
        renderAll();
      } catch (e) {
        state.loading = false;
        err("load failed", e);
        renderAll();
        showError("Failed to load quotations", e);
      }
    };

    refreshBtn.addEventListener("click", function () { if (state.refresh) state.refresh(); });

    state.mounted = true;
    state.refresh();
  }

  // ─── Register module ──────────────────────────────────────────────────────
  E.registerModule({
    id: "quotations",
    title: "Quotations",
    order: 205,
    icon: "📋",
    render: render
  });
})();
