/* ui/modules.quotations.js
   Eikon - Quotations module (UI) — flat table model

   Endpoints (Worker):
     GET    /quotations/entries?q=...&all_org=1   → flat list
     POST   /quotations/entries                   → create entry
     PUT    /quotations/entries/:id               → update entry
     DELETE /quotations/entries/:id               → delete entry
*/
(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.quotations.js)");

  // ─── Debug helpers ────────────────────────────────────────────────────────
  var LP = "[EIKON][quotations]";
  function log() { try { console.log.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }
  function warn() { try { console.warn.apply(console, [LP].concat([].slice.call(arguments))); } catch (e) {} }

  // ─── Tiny utilities ───────────────────────────────────────────────────────
  function esc(s) {
    try { return E.escapeHtml(String(s == null ? "" : s)); }
    catch (e) {
      return String(s == null ? "" : s)
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
    }
  }
  function pad2(n) { var v = String(n); return v.length === 1 ? "0" + v : v; }
  function toYmd(d) { return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()); }
  function todayYmd() { return toYmd(new Date()); }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "").trim()); }
  function fmtDate(s) {
    var v = String(s || "").trim();
    return isYmd(v) ? v.slice(8, 10) + "/" + v.slice(5, 7) + "/" + v.slice(0, 4) : v;
  }
  function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
  function fmt2(n) { return round2(n).toFixed(2); }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function getEl(id) { try { return E.q(id); } catch (e) { return document.querySelector(id); } }

  // ─── Calculations ─────────────────────────────────────────────────────────
  function recalcItem(f) {
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

    // Reverse calc: user typed Total Incl VAT → derive cost_excl / cost_incl
    if (le === "total_incl") {
      var tiv = Math.max(0, Number(f.total_incl_vat) || 0);
      var effInclUnit = qty > 0 ? tiv / qty : 0;
      var effExclUnit = vat === 0 ? effInclUnit : (mult > 0 ? round2(effInclUnit / mult) : 0);
      excl = round2(effExclUnit + discEuro);
      incl = vat === 0 ? excl : round2(excl * mult);
      discPct = excl > 0 ? round2(discEuro / excl * 100) : 0;
    } else if (vat === 0) {
      // VAT cross-calc
      if (le === "cost_excl" || le === "vat") incl = excl;
      else excl = incl;
    } else {
      if (le === "cost_excl" || le === "vat") incl = round2(excl * mult);
      else excl = round2(incl / mult);
    }

    // Discount cross-calc (based on cost_excl_vat)
    if (le === "discount_pct") {
      discEuro = excl > 0 ? round2(excl * discPct / 100) : 0;
    } else if (le === "discount_euro") {
      discPct = excl > 0 ? round2(discEuro / excl * 100) : 0;
    }
    if (discEuro > excl) { discEuro = excl; discPct = 100; }
    if (discPct > 100) { discPct = 100; discEuro = excl; }

    var effExcl = Math.max(0, excl - discEuro);
    var effIncl = vat === 0 ? effExcl : round2(effExcl * mult);
    var totalInclVat = round2(effIncl * qty);
    var totalRetail = round2(retail * (qty + free));
    // Profit uses cost EXCL VAT — input VAT is reclaimed by the business
    var profit = round2(totalRetail - effExcl * qty);
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
    return "hsl(" + Math.round((p - 20) / 15 * 120) + ",88%,52%)";
  }
  function profitMarginLabel(pct) {
    var p = Number(pct) || 0;
    return p >= 35 ? "Good" : p >= 20 ? "OK" : "Poor";
  }

  // ─── Similarity (trigram + Jaccard + Levenshtein) ─────────────────────────
  var SIMILARITY_THRESHOLD = 0.60;

  function tokenize(s) {
    return String(s || "").toLowerCase()
      .replace(/([a-z])(\d)/g, "$1 $2")
      .replace(/(\d)([a-z])/g, "$1 $2")
      .replace(/[^a-z0-9]/g, " ")
      .split(/\s+/).filter(Boolean);
  }

  function trigramSet(s) {
    var set = Object.create(null);
    var p = "  " + s + " ";
    for (var i = 0; i < p.length - 2; i++) {
      var t = p.slice(i, i + 3);
      set[t] = (set[t] || 0) + 1;
    }
    return set;
  }

  function trigramSimilarity(a, b) {
    var sa = trigramSet(a), sb = trigramSet(b);
    var inter = 0, totalA = 0, totalB = 0;
    var k;
    for (k in sa) { totalA += sa[k]; if (sb[k]) inter += Math.min(sa[k], sb[k]); }
    for (k in sb) { totalB += sb[k]; }
    var total = totalA + totalB;
    return total > 0 ? (2 * inter) / total : 0;
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
    var dp = [], i, j;
    for (i = 0; i <= m; i++) { dp[i] = [i]; }
    for (j = 0; j <= n; j++) { dp[0][j] = j; }
    for (i = 1; i <= m; i++) {
      for (j = 1; j <= n; j++) {
        dp[i][j] = a[i - 1] === b[j - 1]
          ? dp[i - 1][j - 1]
          : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
    return dp[m][n];
  }

  function descSimilarity(a, b) {
    var na = norm(a), nb = norm(b);
    if (na === nb) return 1.0;
    if (!na || !nb) return 0;
    var trig = trigramSimilarity(na, nb);
    var jac = jaccardSimilarity(na, nb);
    var edit = 0;
    if (Math.max(na.length, nb.length) <= 60) {
      var maxLen = Math.max(na.length, nb.length);
      edit = maxLen > 0 ? 1 - levenshtein(na, nb) / maxLen : 1;
    }
    return Math.max(trig, jac, edit);
  }

  function collectAllDescriptions() {
    var descCount = Object.create(null);
    (state.quotations || []).forEach(function (row) {
      var d = String(row.item_description || "").trim();
      if (d) descCount[d] = (descCount[d] || 0) + 1;
    });
    return descCount;
  }

  function findSimilarDescriptions(typed) {
    var descCount = collectAllDescriptions();
    var results = [];
    var normTyped = norm(typed);
    Object.keys(descCount).forEach(function (d) {
      if (norm(d) === normTyped) return; // exact match — no warning
      var sim = descSimilarity(typed, d);
      if (sim >= SIMILARITY_THRESHOLD) results.push({ desc: d, count: descCount[d], sim: sim });
    });
    results.sort(function (a, b) { return b.sim - a.sim; });
    return results.slice(0, 5);
  }

  function clusterDescriptions() {
    var descCount = collectAllDescriptions();
    var descs = Object.keys(descCount);
    var parent = Object.create(null);
    descs.forEach(function (d) { parent[d] = d; });
    function find(x) {
      while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; }
      return x;
    }
    function union(a, b) { parent[find(a)] = find(b); }
    for (var i = 0; i < descs.length; i++) {
      for (var j = i + 1; j < descs.length; j++) {
        if (descSimilarity(descs[i], descs[j]) >= SIMILARITY_THRESHOLD) union(descs[i], descs[j]);
      }
    }
    var groups = Object.create(null);
    descs.forEach(function (d) {
      var root = find(d);
      if (!groups[root]) groups[root] = [];
      groups[root].push(d);
    });
    return Object.keys(groups)
      .map(function (k) { return groups[k]; })
      .filter(function (g) { return g.length >= 2; })
      .map(function (g) {
        g.sort(function (a, b) { return (descCount[b] || 0) - (descCount[a] || 0); });
        return { variants: g, counts: g.map(function (d) { return descCount[d] || 0; }), canonical: g[0] };
      });
  }

  // ─── Column definitions ───────────────────────────────────────────────────
  var COLUMNS = [
    { key: "date",        label: "Date",        def: true  },
    { key: "supplier",    label: "Supplier",    def: true  },
    { key: "barcode",     label: "Barcode",     def: false },
    { key: "stock_code",  label: "Stock Code",  def: false },
    { key: "description", label: "Description", def: true  },
    { key: "qty",         label: "Qty",         def: true  },
    { key: "qty_free",    label: "Free",        def: true  },
    { key: "vat",         label: "VAT",         def: true  },
    { key: "cost_excl",   label: "Cost Excl",   def: true  },
    { key: "cost_incl",   label: "Cost Incl",   def: false },
    { key: "disc_pct",    label: "Disc%",       def: true  },
    { key: "disc_euro",   label: "Disc€",       def: false },
    { key: "total",       label: "Total Incl",  def: true  },
    { key: "retail",      label: "Retail",      def: true  },
    { key: "profit",      label: "Profit",      def: true  },
    { key: "margin",      label: "Margin%",     def: true  },
    { key: "notes",       label: "Notes",       def: true  }
  ];

  function defaultColVis() {
    var v = {};
    COLUMNS.forEach(function (c) { v[c.key] = c.def; });
    return v;
  }

  // ─── State ────────────────────────────────────────────────────────────────
  var state = {
    quotations: [],
    filtered: [],
    query: "",
    showAllOrg: false,
    loading: false,
    colVis: defaultColVis(),
    showColPanel: false,
    refresh: null
  };

  // ─── Styles ───────────────────────────────────────────────────────────────
  var qtStyleInstalled = false;
  function ensureQuotationsStyles() {
    if (qtStyleInstalled) return;
    qtStyleInstalled = true;
    var st = document.createElement("style");
    st.id = "eikon-quotations-style";
    st.textContent =
      ".qt-wrap{max-width:1600px;margin:0 auto;padding:16px;}" +
      ".qt-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:10px;}" +
      ".qt-title{margin:0;font-size:18px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".qt-sub{margin:4px 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.68));}" +
      ".qt-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;}" +

      ".qt-field{display:flex;flex-direction:column;gap:4px;}" +
      ".qt-field label{font-size:12px;font-weight:800;color:var(--muted,rgba(233,238,247,.68));letter-spacing:.2px;}" +
      ".qt-field input,.qt-field select,.qt-field textarea{" +
        "padding:9px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
        "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;font-size:13px;" +
        "transition:border-color 120ms,box-shadow 120ms;" +
      "}" +
      ".qt-field input:focus,.qt-field select:focus,.qt-field textarea:focus{" +
        "border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.22);" +
      "}" +
      ".qt-field input::placeholder,.qt-field textarea::placeholder{color:rgba(233,238,247,.40);}" +
      ".qt-field select,.qt-field input[type=date]{color-scheme:dark;}" +

      ".qt-toggle{padding:9px 14px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
        "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);cursor:pointer;font-size:13px;font-weight:800;}" +
      ".qt-toggle.active{background:rgba(58,160,255,.18);border-color:rgba(58,160,255,.45);color:#5aa2ff;}" +

      ".qt-col-panel{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;margin-bottom:10px;" +
        "border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.35);}" +
      ".qt-col-item{display:flex;align-items:center;gap:5px;font-size:12px;font-weight:800;color:var(--text,#e9eef7);cursor:pointer;user-select:none;}" +
      ".qt-col-item input[type=checkbox]{accent-color:rgba(58,160,255,.95);width:14px;height:14px;cursor:pointer;}" +

      ".qt-table-wrap{overflow:auto;max-height:220px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.18);}" +
      ".qt-table{border-collapse:collapse;min-width:100%;color:var(--text,#e9eef7);font-size:12px;}" +
      ".qt-table th,.qt-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:7px 10px;vertical-align:middle;white-space:nowrap;}" +
      ".qt-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;" +
        "color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:1000;font-size:11px;text-align:left;}" +
      ".qt-table tbody tr:hover{background:rgba(255,255,255,.04);}" +
      ".qt-table .num{text-align:right;font-variant-numeric:tabular-nums;}" +
      ".qt-table .act{text-align:center;white-space:nowrap;}" +
      ".qt-table .desc-cell{max-width:220px;white-space:normal;word-break:break-word;}" +

      ".qt-margin-cell{display:inline-flex;align-items:center;gap:4px;font-weight:900;border-radius:7px;padding:2px 7px;font-size:11px;}" +
      ".qt-empty{text-align:center;padding:40px 16px;color:var(--muted,rgba(233,238,247,.68));font-size:13px;}" +
      ".qt-loading{text-align:center;padding:30px;color:var(--muted,rgba(233,238,247,.68));font-size:13px;}" +

      // modal field grid
      ".qt-form-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:10px;}" +
      ".qt-form-grid-2{display:grid;grid-template-columns:repeat(2,1fr);gap:10px;margin-bottom:10px;}" +
      ".qt-form-full{margin-bottom:10px;}" +
      ".qt-ro{opacity:.62;cursor:default!important;}" +
      ".qt-margin-display{padding:9px 12px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;" +
        "background:rgba(10,16,24,.64);font-size:13px;font-weight:900;min-height:38px;display:flex;align-items:center;}" +

      // suggestions
      ".qt-suggestions{margin-top:5px;border:1px solid rgba(255,200,90,.25);border-radius:10px;" +
        "background:rgba(255,200,90,.06);padding:8px 10px;}" +
      ".qt-sug-title{font-size:11px;font-weight:900;color:rgba(255,200,90,.85);text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px;}" +
      ".qt-sug-item{display:flex;align-items:center;gap:8px;padding:3px 0;border-bottom:1px solid rgba(255,255,255,.06);}" +
      ".qt-sug-item:last-child{border-bottom:none;}" +
      ".qt-sug-desc{font-size:12px;color:var(--text,#e9eef7);flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;}" +
      ".qt-sug-use{font-size:11px;font-weight:900;padding:2px 8px;border-radius:7px;" +
        "border:1px solid rgba(58,160,255,.35);background:rgba(58,160,255,.12);color:#5aa2ff;cursor:pointer;}" +

      // merge modal
      ".qt-merge-group{border:1px solid rgba(255,255,255,.10);border-radius:12px;padding:12px;margin-bottom:10px;}" +
      ".qt-merge-group-title{font-size:11px;font-weight:900;color:var(--muted,rgba(233,238,247,.68));margin-bottom:6px;text-transform:uppercase;letter-spacing:.5px;}" +
      ".qt-merge-variant{font-size:12px;color:var(--text,#e9eef7);padding:2px 0;display:flex;justify-content:space-between;}" +
      ".qt-merge-count{font-size:11px;color:var(--muted,rgba(233,238,247,.55));}" +
      ".qt-merge-input{width:100%;box-sizing:border-box;margin-top:7px;padding:8px 10px;border:1px solid rgba(255,255,255,.12);border-radius:8px;" +
        "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);font-size:13px;outline:none;}" +
      ".qt-merge-input:focus{border-color:rgba(58,160,255,.55);}" +
      ".qt-merge-btn{margin-top:7px;padding:5px 12px;border-radius:8px;border:none;cursor:pointer;" +
        "background:rgba(58,160,255,.22);color:#5aa2ff;font-size:12px;font-weight:900;}" +

      "@media(max-width:900px){.qt-wrap{padding:10px;}.qt-form-grid{grid-template-columns:1fr 1fr;}.qt-controls{width:100%;}}" +

      // bulk import section
      ".qt-bulk-section{margin-top:24px;padding:20px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:14px;background:rgba(10,16,24,.22);}" +
      ".qt-bulk-title{margin:0 0 12px;font-size:15px;font-weight:900;color:var(--text,#e9eef7);letter-spacing:-.2px;}" +
      ".qt-bulk-instr{margin-bottom:14px;font-size:13px;color:rgba(233,238,247,.78);line-height:1.7;}" +
      ".qt-bulk-instr p{margin:3px 0;}" +
      ".qt-bulk-link{color:#5aa2ff;text-decoration:underline;background:none;border:none;padding:0;cursor:pointer;font-size:inherit;font-family:inherit;}" +
      ".qt-bulk-copy-ok{color:#4caf50;font-size:12px;font-weight:600;margin-left:8px;display:none;}" +
      ".qt-bulk-url{display:block;width:100%;margin-top:6px;font-size:11px;background:rgba(0,0,0,.3);border:1px solid rgba(255,255,255,.15);border-radius:6px;color:rgba(233,238,247,.6);padding:4px 8px;box-sizing:border-box;cursor:text;}" +
      ".qt-bulk-note{font-size:11.5px;color:rgba(233,238,247,.50)!important;margin-top:6px!important;}" +
      "#qt-bulk-input{width:100%;box-sizing:border-box;font-family:monospace;font-size:11.5px;resize:vertical;min-height:140px;}" +
      ".qt-bulk-status{font-size:13px;margin:10px 0;line-height:1.5;}" +
      ".qt-bulk-ok{color:#43d17a;}" +
      ".qt-bulk-err{color:#ff5a7a;}" +
      ".qt-bulk-info{color:rgba(233,238,247,.68);}" +
      ".qt-bulk-progress{margin-top:10px;max-height:280px;overflow-y:auto;border:1px solid rgba(255,255,255,.08);border-radius:10px;background:rgba(0,0,0,.22);padding:8px 10px;}" +
      ".qt-bulk-row{padding:3px 0;font-size:12px;border-bottom:1px solid rgba(255,255,255,.05);font-family:monospace;white-space:pre-wrap;word-break:break-word;}" +
      ".qt-bulk-row:last-child{border-bottom:none;}" +
      ".qt-bulk-row-ok{color:#43d17a;}" +
      ".qt-bulk-row-err{color:#ff5a7a;}";

    document.head.appendChild(st);
  }

  // ─── API ──────────────────────────────────────────────────────────────────
  async function apiList() {
    var qs = [];
    if (state.query) qs.push("q=" + encodeURIComponent(state.query));
    if (state.showAllOrg) qs.push("all_org=1");
    return E.apiFetch("/quotations/entries" + (qs.length ? "?" + qs.join("&") : ""), { method: "GET" });
  }
  async function apiCreate(p) {
    return E.apiFetch("/quotations/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  }
  async function apiUpdate(id, p) {
    return E.apiFetch("/quotations/entries/" + id, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p) });
  }
  async function apiDelete(id) {
    return E.apiFetch("/quotations/entries/" + id, { method: "DELETE" });
  }

  // ─── Error modal ──────────────────────────────────────────────────────────
  function showError(title, e) {
    var msg = String(e && (e.message || e.bodyText || e) || "Unknown error");
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg) + "</div>",
      [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]);
  }

  // ─── Column visibility ────────────────────────────────────────────────────
  function applyColVisibility() {
    COLUMNS.forEach(function (c) {
      var els = document.querySelectorAll("[data-col='" + c.key + "']");
      var show = !!state.colVis[c.key];
      els.forEach(function (el) { el.style.display = show ? "" : "none"; });
    });
  }

  function renderColPanel(panelEl) {
    if (!state.showColPanel) { panelEl.style.display = "none"; return; }
    panelEl.style.display = "";
    var html = "";
    COLUMNS.forEach(function (c) {
      html += "<label class='qt-col-item'>" +
        "<input type='checkbox' data-col-key='" + c.key + "'" + (state.colVis[c.key] ? " checked" : "") + ">" +
        esc(c.label) + "</label>";
    });
    panelEl.innerHTML = html;
    panelEl.querySelectorAll("[data-col-key]").forEach(function (cb) {
      cb.addEventListener("change", function () {
        state.colVis[cb.getAttribute("data-col-key")] = cb.checked;
        applyColVisibility();
      });
    });
  }

  // ─── Entry modal (Add / Edit) ─────────────────────────────────────────────
  var suggestTimer = null;

  function openEntryModal(opts) {
    var isEdit = opts && opts.mode === "edit";
    var row = (opts && opts.row) || {};

    var iv = {
      supplier: String(row.supplier || "").trim(),
      barcode: String(row.barcode || "").trim(),
      stock_code: String(row.stock_code || "").trim(),
      item_description: String(row.item_description || "").trim(),
      qty_purchased: String(row.qty_purchased || "1"),
      qty_free: String(row.qty_free || "0"),
      vat_rate: String(row.vat_rate !== undefined ? row.vat_rate : "0"),
      cost_excl_vat: row.cost_excl_vat ? fmt2(row.cost_excl_vat) : "",
      cost_incl_vat: row.cost_incl_vat ? fmt2(row.cost_incl_vat) : "",
      discount_pct: row.discount_pct ? fmt2(row.discount_pct) : "",
      discount_euro: row.discount_euro ? fmt2(row.discount_euro) : "",
      total_incl_vat: row.total_incl_vat ? fmt2(row.total_incl_vat) : "",
      retail_price: row.retail_price ? fmt2(row.retail_price) : "",
      profit: row.profit !== undefined ? fmt2(row.profit) : "",
      profit_margin: row.profit_margin !== undefined ? fmt2(row.profit_margin) : "",
      quote_date: isYmd(row.quote_date) ? row.quote_date : todayYmd(),
      notes: String(row.notes || "").trim()
    };

    function vatOpt(v) {
      return "<option value='" + v + "'" + (String(iv.vat_rate) === String(v) ? " selected" : "") + ">" + v + "%</option>";
    }

    var body =
      // Row 1: supplier + date
      "<div class='qt-form-grid-2'>" +
        "<div class='qt-field'><label>Supplier (Optional)</label>" +
          "<input id='qt-i-supplier' type='text' value='" + esc(iv.supplier) + "' placeholder='e.g. ABC Pharma'></div>" +
        "<div class='qt-field'><label>Date *</label>" +
          "<input id='qt-i-date' type='date' value='" + esc(iv.quote_date) + "'></div>" +
      "</div>" +
      // Row 2: barcode + stock code + description
      "<div class='qt-form-grid'>" +
        "<div class='qt-field'><label>Barcode</label>" +
          "<input id='qt-i-barcode' type='text' value='" + esc(iv.barcode) + "' placeholder='Optional'></div>" +
        "<div class='qt-field'><label>Stock Code</label>" +
          "<input id='qt-i-scode' type='text' value='" + esc(iv.stock_code) + "' placeholder='Optional'></div>" +
        "<div class='qt-field'><label>Item Description *</label>" +
          "<input id='qt-i-desc' type='text' value='" + esc(iv.item_description) + "' placeholder='e.g. Amoxicillin 500mg'></div>" +
      "</div>" +
      "<div id='qt-i-suggestions'></div>" +
      // Row 3: qty + free + vat
      "<div class='qt-form-grid'>" +
        "<div class='qt-field'><label>Qty Purchased</label>" +
          "<input id='qt-i-qty' type='number' min='1' step='1' value='" + esc(iv.qty_purchased) + "'></div>" +
        "<div class='qt-field'><label>Qty Free</label>" +
          "<input id='qt-i-free' type='number' min='0' step='1' value='" + esc(iv.qty_free) + "'></div>" +
        "<div class='qt-field'><label>VAT Rate</label>" +
          "<select id='qt-i-vat'>" + vatOpt(0) + vatOpt(5) + vatOpt(18) + "</select></div>" +
      "</div>" +
      // Row 4: cost fields
      "<div class='qt-form-grid-2'>" +
        "<div class='qt-field'><label>Cost Excl. VAT (€)</label>" +
          "<input id='qt-i-excl' type='number' min='0' step='0.01' value='" + esc(iv.cost_excl_vat) + "' placeholder='0.00'></div>" +
        "<div class='qt-field'><label>Cost Incl. VAT (€)</label>" +
          "<input id='qt-i-incl' type='number' min='0' step='0.01' value='" + esc(iv.cost_incl_vat) + "' placeholder='0.00'></div>" +
      "</div>" +
      // Row 5: discount
      "<div class='qt-form-grid-2'>" +
        "<div class='qt-field'><label>Discount %</label>" +
          "<input id='qt-i-dpct' type='number' min='0' max='100' step='0.01' value='" + esc(iv.discount_pct) + "' placeholder='0'></div>" +
        "<div class='qt-field'><label>Discount € (2 dec)</label>" +
          "<input id='qt-i-deuro' type='number' min='0' step='0.01' value='" + esc(iv.discount_euro) + "' placeholder='0.00'></div>" +
      "</div>" +
      // Row 6: total (auto) + retail
      "<div class='qt-form-grid-2'>" +
        "<div class='qt-field'><label>Total Incl. VAT (€)</label>" +
          "<input id='qt-i-total' type='number' min='0' step='0.01' value='" + esc(iv.total_incl_vat) + "' placeholder='0.00'></div>" +
        "<div class='qt-field'><label>Retail Price (€)</label>" +
          "<input id='qt-i-retail' type='number' min='0' step='0.01' value='" + esc(iv.retail_price) + "' placeholder='0.00'></div>" +
      "</div>" +
      // Row 7: profit (auto) + margin (auto)
      "<div class='qt-form-grid-2' style='margin-bottom:10px;'>" +
        "<div class='qt-field'><label>Profit (€) — auto</label>" +
          "<input id='qt-i-profit' class='qt-ro' type='text' readonly value='" + esc(iv.profit) + "' placeholder='Auto'></div>" +
        "<div class='qt-field'><label>Profit Margin % — auto</label>" +
          "<div id='qt-i-margin-wrap' class='qt-margin-display'>" +
            (iv.profit_margin ? fmt2(iv.profit_margin) + "% (" + profitMarginLabel(Number(iv.profit_margin)) + ")" : "—") +
          "</div></div>" +
      "</div>" +
      // Notes
      "<div class='qt-field'><label>Notes (Optional)</label>" +
        "<textarea id='qt-i-notes' rows='2' placeholder='Optional...'>" + esc(iv.notes) + "</textarea></div>";

    E.modal.show(isEdit ? "Edit Entry" : "Add Entry", body, [
      { label: "Cancel", onClick: function () { E.modal.hide(); } },
      {
        label: isEdit ? "Save" : "Add",
        primary: true,
        onClick: function () {
          (async function () {
            try {
              log("Save clicked — isEdit:", isEdit);

              var desc = (getEl("#qt-i-desc").value || "").trim();
              if (!desc) { log("Validation fail: no description"); throw new Error("Item Description is required"); }
              var date = (getEl("#qt-i-date").value || "").trim();
              if (!isYmd(date)) { log("Validation fail: bad date:", date); throw new Error("Valid date is required"); }

              var qty = Math.max(1, parseInt(getEl("#qt-i-qty").value, 10) || 1);
              var free = Math.max(0, parseInt(getEl("#qt-i-free").value, 10) || 0);
              // parseFloat to avoid Number("0")||default silently promoting 0% → 18%
              var vatRate = parseFloat(getEl("#qt-i-vat").value);
              if (isNaN(vatRate)) vatRate = 0;
              var exclVal  = Number(getEl("#qt-i-excl").value)  || 0;
              var inclVal  = Number(getEl("#qt-i-incl").value)  || 0;
              var totalVal = Number(getEl("#qt-i-total").value) || 0;
              var dpct  = Number(getEl("#qt-i-dpct").value)  || 0;
              var deuro = Number(getEl("#qt-i-deuro").value) || 0;
              var retail = Math.max(0, Number(getEl("#qt-i-retail").value) || 0);

              log("Raw fields: vat=" + vatRate + " excl=" + exclVal + " incl=" + inclVal + " total=" + totalVal + " disc%=" + dpct + " disc€=" + deuro + " qty=" + qty + " free=" + free + " retail=" + retail);

              // Determine which cost field was the source of truth
              var lastEdited = exclVal ? "cost_excl" : inclVal ? "cost_incl" : totalVal ? "total_incl" : "cost_excl";
              log("lastEdited:", lastEdited);

              var calcInput = {
                vat_rate: vatRate,
                cost_excl_vat: exclVal,
                cost_incl_vat: inclVal,
                discount_pct: dpct,
                discount_euro: deuro,
                qty_purchased: qty,
                qty_free: free,
                retail_price: retail,
                total_incl_vat: totalVal,
                _lastEdited: lastEdited
              };
              log("calcInput:", JSON.stringify(calcInput));
              var calc = recalcItem(calcInput);
              log("recalcItem result:", JSON.stringify(calc));

              var payload = {
                supplier: (getEl("#qt-i-supplier").value || "").trim(),
                barcode: (getEl("#qt-i-barcode").value || "").trim(),
                stock_code: (getEl("#qt-i-scode").value || "").trim(),
                item_description: desc,
                qty_purchased: qty,
                qty_free: free,
                vat_rate: vatRate,
                cost_excl_vat: calc.cost_excl_vat,
                cost_incl_vat: calc.cost_incl_vat,
                discount_pct: calc.discount_pct,
                discount_euro: calc.discount_euro,
                total_incl_vat: calc.total_incl_vat,
                retail_price: retail,
                profit: calc.profit,
                profit_margin: calc.profit_margin,
                quote_date: date,
                notes: (getEl("#qt-i-notes").value || "").trim()
              };
              log("Payload to send:", JSON.stringify(payload));
              log("Calling API:", isEdit ? "PUT /quotations/entries/" + row.id : "POST /quotations/entries");

              var resp = isEdit ? await apiUpdate(row.id, payload) : await apiCreate(payload);
              log("API response:", JSON.stringify(resp));

              if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Save failed — see console for details");
              E.modal.hide();
              log("Save success, refreshing table…");
              if (state.refresh) state.refresh();
            } catch (e) {
              warn("Save error:", e && (e.message || e));
              showError("Save failed", e);
            }
          })();
        }
      }
    ]);

    setTimeout(function () { wireModalCalc(); }, 30);
  }

  function wireModalCalc() {
    // setVal: only updates target field if it is NOT currently focused
    function setVal(id, n) {
      var el = getEl(id);
      if (!el || el === document.activeElement) return;
      if (n !== 0) el.value = fmt2(n); else el.value = "";
    }

    function updateMarginDisplay(margin) {
      var wrap = getEl("#qt-i-margin-wrap");
      if (!wrap) return;
      var color = profitMarginColor(margin);
      wrap.style.color = color;
      wrap.style.borderColor = color + "55";
      wrap.textContent = fmt2(margin) + "% (" + profitMarginLabel(margin) + ")";
    }

    function gatherFields() {
      // NOTE: use parseFloat for vat_rate — Number("0")||18 would give 18 when VAT is 0%
      var vatEl = getEl("#qt-i-vat");
      return {
        vat_rate: vatEl ? parseFloat(vatEl.value) : 0,
        cost_excl_vat: Number((getEl("#qt-i-excl") || {}).value) || 0,
        cost_incl_vat: Number((getEl("#qt-i-incl") || {}).value) || 0,
        discount_pct: Number((getEl("#qt-i-dpct") || {}).value) || 0,
        discount_euro: Number((getEl("#qt-i-deuro") || {}).value) || 0,
        qty_purchased: Math.max(1, parseInt((getEl("#qt-i-qty") || {}).value, 10) || 1),
        qty_free: Math.max(0, parseInt((getEl("#qt-i-free") || {}).value, 10) || 0),
        retail_price: Number((getEl("#qt-i-retail") || {}).value) || 0,
        total_incl_vat: Number((getEl("#qt-i-total") || {}).value) || 0
      };
    }

    function calc(lastEdited) {
      var f = gatherFields();
      f._lastEdited = lastEdited;
      var r = recalcItem(f);
      log("calc:", lastEdited, "→ excl=" + r.cost_excl_vat + " incl=" + r.cost_incl_vat + " total=" + r.total_incl_vat + " profit=" + r.profit + " margin=" + r.profit_margin + "%");

      // Update ONLY the opposite cross-fill field, never the active field
      if (lastEdited === "cost_excl")     setVal("#qt-i-incl",  r.cost_incl_vat);
      if (lastEdited === "cost_incl")     setVal("#qt-i-excl",  r.cost_excl_vat);
      if (lastEdited === "discount_pct")  setVal("#qt-i-deuro", r.discount_euro);
      if (lastEdited === "discount_euro") setVal("#qt-i-dpct",  r.discount_pct);
      if (lastEdited === "vat") {
        if (f.cost_excl_vat) setVal("#qt-i-incl", r.cost_incl_vat);
        else if (f.cost_incl_vat) setVal("#qt-i-excl", r.cost_excl_vat);
      }
      // Reverse calc from total: update cost fields (setVal guards against active element)
      if (lastEdited === "total_incl") {
        setVal("#qt-i-excl", r.cost_excl_vat);
        setVal("#qt-i-incl", r.cost_incl_vat);
        setVal("#qt-i-dpct", r.discount_pct);
      }

      // Always update outputs (setVal guards against overwriting the active/focused field)
      setVal("#qt-i-total",  r.total_incl_vat);
      setVal("#qt-i-profit", r.profit);
      updateMarginDisplay(r.profit_margin);
    }

    function on(id, ev, le) {
      var el = getEl(id);
      if (el) el.addEventListener(ev, function () { calc(le); });
    }
    on("#qt-i-excl",  "input",  "cost_excl");
    on("#qt-i-incl",  "input",  "cost_incl");
    on("#qt-i-dpct",  "input",  "discount_pct");
    on("#qt-i-deuro", "input",  "discount_euro");
    on("#qt-i-vat",   "change", "vat");
    on("#qt-i-qty",   "input",  "qty");
    on("#qt-i-free",  "input",  "qty");
    on("#qt-i-retail","input",  "retail");
    on("#qt-i-total", "input",  "total_incl");

    // Initial calculation (populate outputs on open)
    var f0 = gatherFields();
    if (f0.cost_excl_vat) calc("cost_excl");
    else if (f0.cost_incl_vat) calc("cost_incl");
    else calc("qty");

    // Description similarity suggestions
    var descEl = getEl("#qt-i-desc");
    var sugEl = getEl("#qt-i-suggestions");
    if (descEl && sugEl) {
      descEl.addEventListener("input", function () {
        clearTimeout(suggestTimer);
        suggestTimer = setTimeout(function () {
          var typed = (descEl.value || "").trim();
          if (typed.length < 2) { sugEl.innerHTML = ""; return; }
          var sims = findSimilarDescriptions(typed);
          if (!sims.length) { sugEl.innerHTML = ""; return; }
          var html = "<div class='qt-suggestions'>" +
            "<div class='qt-sug-title'>Similar descriptions found</div>";
          sims.forEach(function (s) {
            html += "<div class='qt-sug-item'>" +
              "<span class='qt-sug-desc' title='" + esc(s.desc) + "'>" + esc(s.desc) +
                " <span style='opacity:.5'>(" + s.count + "x)</span></span>" +
              "<button class='qt-sug-use' data-d='" + esc(s.desc) + "'>Use this</button>" +
              "</div>";
          });
          html += "</div>";
          sugEl.innerHTML = html;
          sugEl.querySelectorAll(".qt-sug-use").forEach(function (btn) {
            btn.addEventListener("click", function () {
              descEl.value = btn.getAttribute("data-d");
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
        "<div class='qt-empty' style='padding:16px;'><div style='font-size:24px;margin-bottom:8px;'>✓</div>" +
          "<div>No similar descriptions found.</div></div>",
        [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
      );
      return;
    }

    var html = "<div style='margin-bottom:10px;font-size:13px;color:var(--muted,rgba(233,238,247,.68));'>" +
      "Found " + clusters.length + " group" + (clusters.length !== 1 ? "s" : "") + " of similar descriptions.</div>";

    clusters.forEach(function (grp, gi) {
      var total = grp.counts.reduce(function (s, c) { return s + c; }, 0);
      html += "<div class='qt-merge-group' id='qt-mg-" + gi + "'>" +
        "<div class='qt-merge-group-title'>Group " + (gi + 1) + " — " + grp.variants.length + " variants, " + total + " entries</div>";
      grp.variants.forEach(function (v, vi) {
        html += "<div class='qt-merge-variant'><span>" + esc(v) + "</span>" +
          "<span class='qt-merge-count'>" + grp.counts[vi] + "x</span></div>";
      });
      html += "<input class='qt-merge-input' id='qt-mc-" + gi + "' type='text' value='" + esc(grp.canonical) + "'>" +
        "<button class='qt-merge-btn' id='qt-mb-" + gi + "'>Merge this group</button></div>";
    });
    html += "<div id='qt-merge-status' style='font-size:12px;color:var(--muted,rgba(233,238,247,.68));margin-top:6px;'></div>";

    E.modal.show("Find & Merge Duplicates", html, [
      { label: "Close", onClick: function () { E.modal.hide(); } },
      {
        label: "Merge All",
        primary: true,
        onClick: function () {
          (async function () {
            var total = 0;
            for (var gi = 0; gi < clusters.length; gi++) {
              var canonEl = getEl("#qt-mc-" + gi);
              var canon = (canonEl ? canonEl.value : "").trim();
              if (!canon) continue;
              total += await mergeCluster(clusters[gi], canon);
            }
            E.modal.hide();
            if (state.refresh) await state.refresh();
            E.modal.show("Merge Complete",
              "<div style='padding:12px;'>Updated " + total + " entr" + (total !== 1 ? "ies" : "y") + ".</div>",
              [{ label: "OK", primary: true, onClick: function () { E.modal.hide(); } }]
            );
          })();
        }
      }
    ]);

    setTimeout(function () {
      clusters.forEach(function (grp, gi) {
        var btn = getEl("#qt-mb-" + gi);
        if (!btn) return;
        btn.addEventListener("click", function () {
          (async function () {
            var canonEl = getEl("#qt-mc-" + gi);
            var canon = (canonEl ? canonEl.value : "").trim();
            if (!canon) { alert("Please enter a canonical description"); return; }
            var statusEl = getEl("#qt-merge-status");
            var n = await mergeCluster(grp, canon);
            if (state.refresh) await state.refresh();
            var groupEl = getEl("#qt-mg-" + gi);
            if (groupEl) groupEl.style.opacity = "0.4";
            if (statusEl) statusEl.textContent = "Group " + (gi + 1) + ": merged " + n + " entr" + (n !== 1 ? "ies" : "y") + ".";
          })();
        });
      });
    }, 30);
  }

  async function mergeCluster(grp, canon) {
    var total = 0;
    var all = state.quotations || [];
    for (var i = 0; i < all.length; i++) {
      var row = all[i];
      if (grp.variants.indexOf(row.item_description) >= 0 && row.item_description !== canon) {
        try {
          await apiUpdate(row.id, { item_description: canon });
          total++;
        } catch (e) {
          warn("Merge failed for entry " + row.id, e);
        }
      }
    }
    return total;
  }

  // ─── Bulk import ──────────────────────────────────────────────────────────
  // Column order expected from the Invoice Extractor GPT output
  var BULK_COLS = [
    "quote_date", "supplier", "barcode", "stock_code", "item_description",
    "qty_purchased", "qty_free", "vat_rate", "cost_excl_vat", "cost_incl_vat",
    "discount_pct", "discount_euro", "total_incl_vat", "retail_price"
  ];

  function parseBulkTsv(text) {
    var lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n")
      .filter(function (l) { return l.trim(); });
    if (!lines.length) return { rows: [], errors: ["No data found in the pasted text."] };

    // Skip header row if first cell looks like a label rather than a date
    var firstCell = lines[0].split("\t")[0].trim();
    var looksLikeHeader = !/^\d{4}-\d{2}-\d{2}$/.test(firstCell) &&
      /date|supplier|barcode|stock|desc|qty|vat|cost|disc|retail|item/i.test(lines[0]);
    var dataLines = looksLikeHeader ? lines.slice(1) : lines;
    if (!dataLines.length) return { rows: [], errors: ["No data rows found (only a header)."] };

    var parseErrors = [];
    var rows = [];

    dataLines.forEach(function (line, idx) {
      var lineNum = (looksLikeHeader ? idx + 2 : idx + 1); // 1-based, accounting for header
      if (!line.trim()) return;
      var cells = line.split("\t");
      var raw = {};
      BULK_COLS.forEach(function (col, ci) {
        raw[col] = (cells[ci] !== undefined ? cells[ci] : "").trim();
      });

      // ── Critical field validation ──────────────────────────────────────────
      var rowErrors = [];
      var quoteDate = raw.quote_date;
      if (!quoteDate) {
        rowErrors.push("Date is missing");
      } else if (!/^\d{4}-\d{2}-\d{2}$/.test(quoteDate)) {
        rowErrors.push("Date must be YYYY-MM-DD (got \"" + quoteDate + "\")");
      }
      var desc = raw.item_description;
      if (!desc) rowErrors.push("Description is missing");

      if (rowErrors.length) {
        parseErrors.push("Row " + lineNum + ": " + rowErrors.join("; "));
        return;
      }

      // ── Parse numeric fields, fall back to 0 if empty ─────────────────────
      var vatRate = Number(raw.vat_rate) || 0;
      if (vatRate !== 0 && vatRate !== 5 && vatRate !== 18) vatRate = 18;
      var costExcl = Number(raw.cost_excl_vat) || 0;
      var costIncl = Number(raw.cost_incl_vat) || 0;
      // Prefer excl as the authoritative input; fall back to incl if excl absent
      var lastEdited = (costExcl > 0 || costIncl === 0) ? "cost_excl" : "cost_incl";

      var f = {
        vat_rate: vatRate,
        cost_excl_vat: costExcl,
        cost_incl_vat: costIncl,
        discount_pct: Number(raw.discount_pct) || 0,
        discount_euro: Number(raw.discount_euro) || 0,
        qty_purchased: Math.max(1, Math.round(Number(raw.qty_purchased) || 1)),
        qty_free: Math.max(0, Math.round(Number(raw.qty_free) || 0)),
        retail_price: Number(raw.retail_price) || 0,
        _lastEdited: lastEdited
      };
      var calc = recalcItem(f);

      rows.push({
        supplier: raw.supplier || "",
        barcode: raw.barcode || "",
        stock_code: raw.stock_code || "",
        item_description: desc,
        quote_date: quoteDate,
        notes: "",
        qty_purchased: f.qty_purchased,
        qty_free: f.qty_free,
        vat_rate: vatRate,
        cost_excl_vat: calc.cost_excl_vat,
        cost_incl_vat: calc.cost_incl_vat,
        discount_pct: calc.discount_pct,
        discount_euro: calc.discount_euro,
        total_incl_vat: calc.total_incl_vat,
        retail_price: f.retail_price,
        profit: calc.profit,
        profit_margin: calc.profit_margin
      });
    });

    return { rows: rows, errors: parseErrors };
  }

  async function runBulkImport(rows, statusEl) {
    var total = rows.length;
    var ok = 0, fail = 0;
    var resultLines = [];

    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      statusEl.className = "qt-bulk-status qt-bulk-info";
      statusEl.textContent = "Uploading " + (i + 1) + " / " + total + "…";
      try {
        var resp = await apiCreate(row);
        if (!resp || !resp.ok) throw new Error((resp && resp.error) || "Server error");
        ok++;
        resultLines.push("<div class='qt-bulk-row qt-bulk-row-ok'>✓ Row " + (i + 1) +
          ": " + esc(row.item_description) +
          (row.supplier ? " (" + esc(row.supplier) + ")" : "") + "</div>");
      } catch (e) {
        fail++;
        resultLines.push("<div class='qt-bulk-row qt-bulk-row-err'>✗ Row " + (i + 1) +
          ": " + esc(row.item_description) +
          " — " + esc(String(e && (e.message || e))) + "</div>");
      }
    }

    var summary = ok + " of " + total + " entr" + (total !== 1 ? "ies" : "y") + " imported" +
      (fail > 0 ? " (" + fail + " failed)" : " successfully") + ".";
    statusEl.className = "qt-bulk-status " + (ok > 0 ? "qt-bulk-ok" : "qt-bulk-err");
    statusEl.innerHTML = summary +
      "<div class='qt-bulk-progress'>" + resultLines.join("") + "</div>";

    if (ok > 0 && state.refresh) {
      await state.refresh();
      // Scroll the table into view so the user sees the new entries
      var tableEl = document.querySelector("#qt-table-container");
      if (tableEl) tableEl.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }

  // ─── Table rendering ──────────────────────────────────────────────────────
  function applyFilter() {
    var all = state.quotations || [];
    if (!state.query) { state.filtered = all.slice(); return; }
    var q = norm(state.query);
    state.filtered = all.filter(function (row) {
      return norm(row.supplier).indexOf(q) >= 0 ||
        norm(row.item_description).indexOf(q) >= 0 ||
        norm(row.barcode).indexOf(q) >= 0 ||
        norm(row.stock_code).indexOf(q) >= 0 ||
        norm(row.quote_date).indexOf(q) >= 0 ||
        norm(row.notes).indexOf(q) >= 0;
    });
  }

  function renderTable(tableWrap) {
    if (state.loading) {
      tableWrap.innerHTML = "<div class='qt-loading'>Loading…</div>";
      return;
    }
    var list = state.filtered || [];
    if (!list.length) {
      tableWrap.innerHTML = "<div class='qt-empty'>No entries found." +
        (state.query ? " Try clearing the search." : " Click \"Add Entry\" to get started.") + "</div>";
      return;
    }

    var html =
      "<div class='qt-table-wrap'><table class='qt-table'>" +
      "<thead><tr>" +
        "<th data-col='date'>Date</th>" +
        "<th data-col='supplier'>Supplier</th>" +
        "<th data-col='barcode'>Barcode</th>" +
        "<th data-col='stock_code'>Stock Code</th>" +
        "<th data-col='description'>Description</th>" +
        "<th data-col='qty' class='num'>Qty</th>" +
        "<th data-col='qty_free' class='num'>Free</th>" +
        "<th data-col='vat' class='num'>VAT</th>" +
        "<th data-col='cost_excl' class='num'>Cost Excl</th>" +
        "<th data-col='cost_incl' class='num'>Cost Incl</th>" +
        "<th data-col='disc_pct' class='num'>Disc%</th>" +
        "<th data-col='disc_euro' class='num'>Disc€</th>" +
        "<th data-col='total' class='num'>Total Incl</th>" +
        "<th data-col='retail' class='num'>Retail</th>" +
        "<th data-col='profit' class='num'>Profit</th>" +
        "<th data-col='margin' class='num'>Margin%</th>" +
        "<th data-col='notes'>Notes</th>" +
        "<th class='act'>Actions</th>" +
      "</tr></thead><tbody>";

    list.forEach(function (row) {
      var mc = profitMarginColor(row.profit_margin);
      var locBadge = (state.showAllOrg && row.location_name)
        ? " <span style='font-size:10px;opacity:.55;'>(" + esc(row.location_name) + ")</span>" : "";
      html +=
        "<tr data-id='" + row.id + "'>" +
          "<td data-col='date'>" + esc(fmtDate(row.quote_date)) + "</td>" +
          "<td data-col='supplier'>" + esc(row.supplier || "—") + locBadge + "</td>" +
          "<td data-col='barcode'>" + esc(row.barcode || "—") + "</td>" +
          "<td data-col='stock_code'>" + esc(row.stock_code || "—") + "</td>" +
          "<td data-col='description' class='desc-cell'>" + esc(row.item_description) + "</td>" +
          "<td data-col='qty' class='num'>" + esc(row.qty_purchased) + "</td>" +
          "<td data-col='qty_free' class='num'>" + esc(row.qty_free) + "</td>" +
          "<td data-col='vat' class='num'>" + esc(row.vat_rate) + "%</td>" +
          "<td data-col='cost_excl' class='num'>€" + fmt2(row.cost_excl_vat) + "</td>" +
          "<td data-col='cost_incl' class='num'>€" + fmt2(row.cost_incl_vat) + "</td>" +
          "<td data-col='disc_pct' class='num'>" + fmt2(row.discount_pct) + "%</td>" +
          "<td data-col='disc_euro' class='num'>€" + fmt2(row.discount_euro) + "</td>" +
          "<td data-col='total' class='num'>€" + fmt2(row.total_incl_vat) + "</td>" +
          "<td data-col='retail' class='num'>€" + fmt2(row.retail_price) + "</td>" +
          "<td data-col='profit' class='num'>€" + fmt2(row.profit) + "</td>" +
          "<td data-col='margin' class='num'>" +
            "<span class='qt-margin-cell' style='background:" + mc + "22;color:" + mc + ";'>" +
              fmt2(row.profit_margin) + "% <span style='font-size:10px;opacity:.8;'>(" + profitMarginLabel(row.profit_margin) + ")</span>" +
            "</span>" +
          "</td>" +
          "<td data-col='notes' style='max-width:160px;white-space:normal;word-break:break-word;font-size:11px;'>" + esc(row.notes || "") + "</td>" +
          "<td class='act'>" +
            "<button class='eikon-btn' style='padding:4px 8px;font-size:11px;' data-edit='" + row.id + "'>✎</button>" +
            " <button class='eikon-btn' style='padding:4px 8px;font-size:11px;' data-del='" + row.id + "'>✕</button>" +
          "</td>" +
        "</tr>";
    });

    html += "</tbody></table></div>";
    tableWrap.innerHTML = html;

    // Wire edit/delete buttons
    tableWrap.querySelectorAll("[data-edit]").forEach(function (btn) {
      var id = String(btn.getAttribute("data-edit"));
      btn.addEventListener("click", function () {
        var entry = (state.filtered || []).find(function (r) { return String(r.id) === id; });
        if (entry) openEntryModal({ mode: "edit", row: entry });
      });
    });

    tableWrap.querySelectorAll("[data-del]").forEach(function (btn) {
      var id = String(btn.getAttribute("data-del"));
      btn.addEventListener("click", function () {
        var entry = (state.filtered || []).find(function (r) { return String(r.id) === id; });
        if (!entry) return;
        E.modal.show("Delete Entry?",
          "<div style='white-space:pre-wrap;'>Delete: " + esc(entry.item_description) +
            "\nSupplier: " + esc(entry.supplier || "(none)") +
            "\nDate: " + esc(fmtDate(entry.quote_date)) + "</div>",
          [
            { label: "Cancel", onClick: function () { E.modal.hide(); } },
            {
              label: "Delete",
              primary: true,
              onClick: function () {
                (async function () {
                  try {
                    var r = await apiDelete(entry.id);
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

    applyColVisibility();
  }

  function renderAll(mount) {
    applyFilter();
    log("renderAll: loading=" + state.loading + " quotations=" + (state.quotations || []).length + " filtered=" + (state.filtered || []).length + " mountOk=" + !!mount + " tableWrapOk=" + !!(mount && mount.querySelector("#qt-table-container")));
    var tableWrap = mount.querySelector("#qt-table-container");
    var colPanel = mount.querySelector("#qt-col-panel");
    var countEl = mount.querySelector("#qt-count");

    if (tableWrap) renderTable(tableWrap);
    if (colPanel) renderColPanel(colPanel);
    if (countEl) {
      var total = (state.quotations || []).length;
      var shown = (state.filtered || []).length;
      countEl.textContent = shown === total
        ? total + " entr" + (total !== 1 ? "ies" : "y")
        : shown + " / " + total + " entries";
    }
  }

  // ─── Main render ──────────────────────────────────────────────────────────
  async function render(ctx) {
    ensureQuotationsStyles();
    var mount = ctx.mount;

    mount.innerHTML =
      "<div class='qt-wrap'>" +
        "<div class='qt-head'>" +
          "<div><h2 class='qt-title'>Quotations</h2><div class='qt-sub' id='qt-count'>Loading…</div></div>" +
          "<div class='qt-controls'>" +
            "<div class='qt-field'><label>Search</label>" +
              "<input id='qt-search' type='text' placeholder='Supplier, description, barcode…' style='min-width:220px;'></div>" +
            "<div style='display:flex;align-items:flex-end;gap:8px;flex-wrap:wrap;'>" +
              "<button class='qt-toggle' id='qt-org-toggle'>My Location</button>" +
              "<button class='eikon-btn' id='qt-col-btn'>Columns ▾</button>" +
              "<button class='eikon-btn' id='qt-dup-btn'>Find Duplicates</button>" +
              "<button class='eikon-btn' id='qt-add-btn'>Add Entry</button>" +
              "<button class='eikon-btn' id='qt-refresh-btn'>Refresh</button>" +
            "</div>" +
          "</div>" +
        "</div>" +
        "<div id='qt-col-panel' class='qt-col-panel' style='display:none;'></div>" +
        "<div id='qt-table-container'><div class='qt-loading'>Loading…</div></div>" +

        // ── Bulk import section ────────────────────────────────────────────
        "<div class='qt-bulk-section'>" +
          "<h3 class='qt-bulk-title'>Bulk Import via AI Invoice Extractor</h3>" +
          "<div class='qt-bulk-instr'>" +
            "<p>1. Open the " +
              "<button class='qt-bulk-link' id='qt-gpt-link'>Invoice Extractor GPT ↗</button>" +
              "<span id='qt-gpt-copy-ok' class='qt-bulk-copy-ok'>⚠ Popup blocked — link copied! Open a new tab (Ctrl+T) and paste (Ctrl+V)</span>" +
            "</p>" +
            "<input type='text' id='qt-gpt-url' class='qt-bulk-url' readonly " +
              "value='https://chatgpt.com/g/g-69a717442e348191950843c857f4801e-invoice-extractor'>" +
            "<p>2. Upload your supplier invoice to the GPT and copy the table it produces</p>" +
            "<p>3. Paste it in the box below and click <b>Submit Bulk Import</b></p>" +
            "<p class='qt-bulk-note'>" +
              "Each row becomes a separate quotation entry. Missing calculated fields (Cost Incl VAT, " +
              "Total, Profit) are auto-filled using the same formula as the single-entry form. " +
              "A missing <b>Date</b> (YYYY-MM-DD) or <b>Description</b> will flag that row as an error." +
            "</p>" +
          "</div>" +
          "<div class='qt-field' style='margin-bottom:10px;'>" +
            "<label>Paste GPT Output Here</label>" +
            "<textarea id='qt-bulk-input' rows='8' " +
              "placeholder='Paste the tab-separated table from the Invoice Extractor GPT here…'></textarea>" +
          "</div>" +
          "<div id='qt-bulk-status' class='qt-bulk-status'></div>" +
          "<div style='display:flex;gap:8px;align-items:center;flex-wrap:wrap;'>" +
            "<button class='eikon-btn' id='qt-bulk-submit'>Submit Bulk Import</button>" +
            "<button class='eikon-btn' id='qt-bulk-clear'>Clear</button>" +
          "</div>" +
        "</div>" +
      "</div>";

    var searchEl = mount.querySelector("#qt-search");
    var toggleEl = mount.querySelector("#qt-org-toggle");
    var colBtn = mount.querySelector("#qt-col-btn");
    var dupBtn = mount.querySelector("#qt-dup-btn");
    var addBtn = mount.querySelector("#qt-add-btn");
    var refreshBtn = mount.querySelector("#qt-refresh-btn");

    // Live search
    var searchTimer = null;
    searchEl.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        state.query = (searchEl.value || "").trim();
        renderAll(mount);
      }, 200);
    });

    // Org toggle
    toggleEl.addEventListener("click", function () {
      state.showAllOrg = !state.showAllOrg;
      toggleEl.textContent = state.showAllOrg ? "All Org Locations" : "My Location";
      toggleEl.classList.toggle("active", state.showAllOrg);
      if (state.refresh) state.refresh();
    });

    // Columns panel
    colBtn.addEventListener("click", function () {
      state.showColPanel = !state.showColPanel;
      colBtn.classList.toggle("active", state.showColPanel);
      renderAll(mount);
    });

    // Find duplicates
    dupBtn.addEventListener("click", function () { openMergeModal(); });

    // Add entry
    addBtn.addEventListener("click", function () { openEntryModal({ mode: "new" }); });

    // Refresh
    state.refresh = async function () {
      log("refresh: start, showAllOrg=" + state.showAllOrg + " query=" + JSON.stringify(state.query));
      state.loading = true;
      renderAll(mount);
      try {
        var resp = await apiList();
        log("refresh: raw resp keys=" + (resp ? Object.keys(resp).join(",") : "null"));
        log("refresh: resp.ok=" + (resp && resp.ok) + " entries=" + (resp && resp.entries ? resp.entries.length : "undefined"));
        if (resp && resp.entries) log("refresh: first entry=" + JSON.stringify((resp.entries[0] || null)));
        state.quotations = (resp && resp.entries) || [];
        log("refresh: state.quotations.length=" + state.quotations.length);
        state.loading = false;
        renderAll(mount);
      } catch (e) {
        state.loading = false;
        warn("refresh load failed:", e && (e.message || e));
        renderAll(mount);
        showError("Failed to load quotations", e);
      }
    };

    refreshBtn.addEventListener("click", function () { if (state.refresh) state.refresh(); });

    // ── Bulk import handlers ──────────────────────────────────────────────────
    // GPT link — opens about:blank with noopener first (truly severs opener at
    // window-creation time), then navigates it to ChatGPT. Different from a
    // plain target="_blank" anchor: the browser has no "opened by" context to
    // enforce COOP against. Falls back to clipboard copy if popup is blocked.
    var gptLinkEl = mount.querySelector("#qt-gpt-link");
    if (gptLinkEl) {
      gptLinkEl.addEventListener("click", function (ev) {
        try { ev.preventDefault(); } catch (e) {}
        var url = "https://chatgpt.com/g/g-69a717442e348191950843c857f4801e-invoice-extractor";
        var okEl = mount.querySelector("#qt-gpt-copy-ok");

        // Primary: open about:blank with noopener (no opener at creation time),
        // then navigate it — avoids Firefox COOP interstitial.
        try {
          var w = window.open("about:blank", "_blank", "noopener,noreferrer");
          if (w) {
            try { w.opener = null; } catch (e0) {}
            try { w.location.replace(url); } catch (e1) { w.location.href = url; }
            return;
          }
        } catch (e2) {}

        // Fallback (popup blocked): copy URL to clipboard and prompt user.
        function showCopyOk() {
          if (okEl) {
            okEl.style.display = "inline";
            setTimeout(function () { okEl.style.display = "none"; }, 6000);
          }
        }
        function clipFallback() {
          var ta = document.createElement("textarea");
          ta.value = url;
          ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
          document.body.appendChild(ta);
          ta.focus(); ta.select();
          try { document.execCommand("copy"); showCopyOk(); } catch (e3) {}
          document.body.removeChild(ta);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(showCopyOk).catch(clipFallback);
        } else {
          clipFallback();
        }
      });
    }

    var bulkInputEl  = mount.querySelector("#qt-bulk-input");
    var bulkStatusEl = mount.querySelector("#qt-bulk-status");
    var bulkSubmitEl = mount.querySelector("#qt-bulk-submit");
    var bulkClearEl  = mount.querySelector("#qt-bulk-clear");

    bulkClearEl.addEventListener("click", function () {
      bulkInputEl.value = "";
      bulkStatusEl.className = "qt-bulk-status";
      bulkStatusEl.innerHTML = "";
    });

    bulkSubmitEl.addEventListener("click", function () {
      var text = (bulkInputEl.value || "").trim();
      if (!text) {
        bulkStatusEl.className = "qt-bulk-status qt-bulk-err";
        bulkStatusEl.textContent = "Please paste the GPT output into the box first.";
        return;
      }

      var parsed = parseBulkTsv(text);

      // Show parse errors (but still submit valid rows if any exist)
      if (parsed.errors.length) {
        bulkStatusEl.className = "qt-bulk-status qt-bulk-err";
        bulkStatusEl.innerHTML =
          "<b>" + parsed.errors.length + " row" + (parsed.errors.length !== 1 ? "s" : "") +
          " could not be parsed:</b>" +
          "<div class='qt-bulk-progress'>" +
          parsed.errors.map(function (e) {
            return "<div class='qt-bulk-row qt-bulk-row-err'>" + esc(e) + "</div>";
          }).join("") +
          "</div>" +
          (parsed.rows.length
            ? "<div style='margin-top:8px;font-size:12px;color:rgba(233,238,247,.68);'>" +
              parsed.rows.length + " valid row" + (parsed.rows.length !== 1 ? "s" : "") +
              " will still be imported.</div>"
            : "");
        if (!parsed.rows.length) return; // nothing valid to submit
      }

      bulkSubmitEl.disabled = true;
      bulkSubmitEl.textContent = "Uploading…";
      runBulkImport(parsed.rows, bulkStatusEl)
        .catch(function (e) { warn("Bulk import unexpected error", e); })
        .then(function () {
          bulkSubmitEl.disabled = false;
          bulkSubmitEl.textContent = "Submit Bulk Import";
        });
    });

    state.refresh();
  }

  // ─── Register ─────────────────────────────────────────────────────────────
  E.registerModule({
    id: "quotations",
    title: "Quotations",
    order: 205,
    icon: "📋",
    render: render
  });
})();
