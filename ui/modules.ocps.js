/* ui/modules.ocps.js
   Eikon – Oral Contraceptive Pills (OCP) Finder Module

   Allows the user to filter OCPs by:
   - Estrogen type + dose (optional)
   - Progesterone type + dose (optional)
   Supports mcg and mg entry for both hormones.
   Displays matching pills and supports printing.
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ─── OCP Data ──────────────────────────────────────────────────────────────
  // All doses stored in mg internally
  var OCP_DATA = [
    { trade: "Adele",        estrogen: "Ethinylestradiol",  estrogenDose: 0.03,    progestogen: "Desogestrel",          progestogenDose: 0.15  },
    { trade: "Cilest",       estrogen: "Ethinylestradiol",  estrogenDose: 0.035,   progestogen: "Norgestimate",          progestogenDose: 0.25  },
    { trade: "Clairette",    estrogen: "Ethinylestradiol",  estrogenDose: 0.035,   progestogen: "Cyproterone acetate",   progestogenDose: 2     },
    { trade: "Desogestrel (generic)",    estrogen: null,   estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Desogestrel Biogaran",     estrogen: null,   estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Desogestrel Rowex",        estrogen: null,   estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Drovelis",     estrogen: "Estetrol",          estrogenDose: 14.2,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Freedonel",    estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Katya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.03,    progestogen: "Gestodene",             progestogenDose: 0.075 },
    { trade: "Lamya",        estrogen: null,                estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Levonorgestrel/EE 0.10/0.02 mg",  estrogen: "Ethinylestradiol", estrogenDose: 0.02,  progestogen: "Levonorgestrel", progestogenDose: 0.1  },
    { trade: "Levonorgestrel/EE 0.15/0.03 mg",  estrogen: "Ethinylestradiol", estrogenDose: 0.03,  progestogen: "Levonorgestrel", progestogenDose: 0.15 },
    { trade: "Mercilon",     estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Desogestrel",          progestogenDose: 0.15  },
    { trade: "Nelya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.015,   progestogen: "Gestodene",             progestogenDose: 0.06  },
    { trade: "Qlaira",       estrogen: "Estradiol valerate",estrogenDose: "1–3",   progestogen: "Dienogest",             progestogenDose: "2–3", multiphasic: true },
    { trade: "Sunya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Gestodene",             progestogenDose: 0.075 },
    { trade: "Vreya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.035,   progestogen: "Cyproterone acetate",   progestogenDose: 2     },
    { trade: "Yasmin",       estrogen: "Ethinylestradiol",  estrogenDose: 0.03,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Yasminelle",   estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Yaz",          estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Zoely",        estrogen: "Estradiol",         estrogenDose: 1.5,     progestogen: "Nomegestrol acetate",   progestogenDose: 2.5   }
  ];

  // Unique sorted lists
  var ESTROGENS    = [...new Set(OCP_DATA.filter(function(d){ return d.estrogen; }).map(function(d){ return d.estrogen; }))].sort();
  var PROGESTOGENS = [...new Set(OCP_DATA.filter(function(d){ return d.progestogen; }).map(function(d){ return d.progestogen; }))].sort();

  // ─── Helpers ───────────────────────────────────────────────────────────────
  function el(tag, attrs, kids) {
    var n = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === "class") n.className = attrs[k];
        else if (k === "text") n.textContent = attrs[k];
        else if (k === "html") n.innerHTML = attrs[k];
        else if (k === "style") n.setAttribute("style", attrs[k]);
        else n.setAttribute(k, attrs[k]);
      });
    }
    if (kids) kids.forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  // Parse a dose string like "0.03", "30" (if unit=mcg), returns mg value or null
  function parseDoseMg(raw, unit) {
    var s = String(raw || "").trim().replace(",", ".");
    if (!s) return null;
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return null;
    return unit === "mcg" ? n / 1000 : n;
  }

  // Compare with tolerance for floating point (±1%)
  function approxEqual(a, b) {
    if (a == null || b == null) return false;
    if (typeof a !== "number" || typeof b !== "number") return false;
    var tol = Math.max(a, b) * 0.015;
    return Math.abs(a - b) <= tol;
  }

  function dosageLabel(dose, unit) {
    if (dose == null) return "—";
    if (typeof dose === "string") return dose + " mg"; // multiphasic
    var mg = Number(dose);
    if (unit === "mcg") return (mg * 1000).toFixed(mg * 1000 < 1 ? 3 : mg * 1000 < 10 ? 2 : 1) + " mcg";
    return mg >= 0.1 ? mg + " mg" : (mg * 1000) + " mcg";
  }

  // Smart auto-display: if dose < 0.1 mg, suggest showing in mcg
  function autoDisplayDose(mg) {
    if (mg == null || typeof mg !== "number") return "—";
    if (mg < 0.1) return (mg * 1000).toFixed(mg * 1000 < 10 ? 2 : 1) + " mcg";
    return mg + " mg";
  }

  // ─── State ─────────────────────────────────────────────────────────────────
  var state = {
    estrogen: "",
    estrogenDose: "",
    estrogenUnit: "mg",
    progestogen: "",
    progestogenDose: "",
    progestogenUnit: "mg",
    results: null   // null=no search yet, []= no matches, [...]= matches
  };

  var refs = {};

  // ─── Search Logic ──────────────────────────────────────────────────────────
  function doSearch() {
    var eType  = state.estrogen;
    var eDoseMg = parseDoseMg(state.estrogenDose, state.estrogenUnit);
    var pType  = state.progestogen;
    var pDoseMg = parseDoseMg(state.progestogenDose, state.progestogenUnit);

    // Must have at least one filter
    if (!eType && !pType && !eDoseMg && !pDoseMg) {
      state.results = null;
      renderResults();
      return;
    }

    state.results = OCP_DATA.filter(function (pill) {
      // ── Estrogen filter ──
      if (eType) {
        if (!pill.estrogen) return false;
        if (pill.estrogen.toLowerCase() !== eType.toLowerCase()) return false;
      }
      if (eDoseMg != null) {
        if (pill.multiphasic) {
          // keep multiphasic if dose is in range (1–3 for estradiol valerate)
          // we just allow it through if type matches
        } else {
          if (!approxEqual(pill.estrogenDose, eDoseMg)) return false;
        }
      }
      // ── Progestogen filter ──
      if (pType) {
        if (!pill.progestogen) return false;
        if (pill.progestogen.toLowerCase() !== pType.toLowerCase()) return false;
      }
      if (pDoseMg != null) {
        if (pill.multiphasic) {
          // allow through
        } else {
          if (!approxEqual(pill.progestogenDose, pDoseMg)) return false;
        }
      }
      return true;
    });

    renderResults();
  }

  // ─── Results Render ────────────────────────────────────────────────────────
  function renderResults() {
    var wrap = refs.resultWrap;
    if (!wrap) return;
    wrap.innerHTML = "";

    if (state.results === null) {
      wrap.appendChild(el("div", {
        class: "ocp-empty-state",
        html: "<span class='ocp-empty-icon'>💊</span><p>Select at least one filter above and click <strong>Search</strong> to find matching OCPs.</p>"
      }));
      return;
    }

    if (state.results.length === 0) {
      wrap.appendChild(el("div", {
        class: "ocp-empty-state ocp-no-match",
        html: "<span class='ocp-empty-icon'>🔍</span><p>No OCPs found matching the selected criteria.<br>Try adjusting the filters or check the dose.</p>"
      }));
      return;
    }

    var count = el("div", { class: "ocp-result-count",
      html: "<span class='ocp-count-num'>" + state.results.length + "</span> matching OCP" + (state.results.length === 1 ? "" : "s") + " found"
    });
    wrap.appendChild(count);

    var grid = el("div", { class: "ocp-result-grid" });

    state.results.forEach(function (pill) {
      var card = el("div", { class: "ocp-pill-card" + (pill.multiphasic ? " ocp-multiphasic" : "") });

      // Trade name header
      var header = el("div", { class: "ocp-pill-header" });
      header.appendChild(el("span", { class: "ocp-pill-name", text: pill.trade }));
      if (pill.multiphasic) {
        header.appendChild(el("span", { class: "ocp-badge ocp-badge-multi", text: "Multiphasic" }));
      }
      card.appendChild(header);

      var body = el("div", { class: "ocp-pill-body" });

      // Estrogen section
      var eSection = el("div", { class: "ocp-hormone-section" + (pill.estrogen ? "" : " ocp-hormone-none") });
      var eBadge = el("div", { class: "ocp-hormone-label" });
      eBadge.appendChild(el("span", { class: "ocp-hormone-icon ocp-e-icon", text: "E" }));
      eBadge.appendChild(el("span", { class: "ocp-hormone-type-label", text: "Estrogen" }));
      eSection.appendChild(eBadge);
      if (pill.estrogen) {
        eSection.appendChild(el("div", { class: "ocp-hormone-name", text: pill.estrogen }));
        eSection.appendChild(el("div", { class: "ocp-hormone-dose", text: typeof pill.estrogenDose === "string" ? pill.estrogenDose + " mg" : autoDisplayDose(pill.estrogenDose) }));
      } else {
        eSection.appendChild(el("div", { class: "ocp-hormone-name ocp-none-text", text: "None (Progestogen-only)" }));
      }
      body.appendChild(eSection);

      // Divider
      body.appendChild(el("div", { class: "ocp-divider-v" }));

      // Progestogen section
      var pSection = el("div", { class: "ocp-hormone-section" });
      var pBadge = el("div", { class: "ocp-hormone-label" });
      pBadge.appendChild(el("span", { class: "ocp-hormone-icon ocp-p-icon", text: "P" }));
      pBadge.appendChild(el("span", { class: "ocp-hormone-type-label", text: "Progestogen" }));
      pSection.appendChild(pBadge);
      pSection.appendChild(el("div", { class: "ocp-hormone-name", text: pill.progestogen }));
      pSection.appendChild(el("div", { class: "ocp-hormone-dose", text: typeof pill.progestogenDose === "string" ? pill.progestogenDose + " mg" : autoDisplayDose(pill.progestogenDose) }));
      body.appendChild(pSection);

      card.appendChild(body);
      grid.appendChild(card);
    });

    wrap.appendChild(grid);

    // Print button at bottom
    var printWrap = el("div", { class: "ocp-print-row" });
    var printBtn = el("button", { type: "button", class: "eikon-btn primary ocp-print-btn" });
    printBtn.innerHTML = "<svg width='15' height='15' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2' stroke-linecap='round' stroke-linejoin='round' style='margin-right:6px;vertical-align:-2px'><polyline points='6 9 6 2 18 2 18 9'/><path d='M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2'/><rect x='6' y='14' width='12' height='8'/></svg>Print Results";
    printBtn.addEventListener("click", doPrint);
    printWrap.appendChild(printBtn);
    wrap.appendChild(printWrap);
  }

  // ─── Print ─────────────────────────────────────────────────────────────────
  var _lastPrint = 0;
  function doPrint() {
    var now = Date.now();
    if (now - _lastPrint < 900) return;
    _lastPrint = now;

    if (!state.results || state.results.length === 0) return;

    var rows = state.results.map(function (p) {
      return "<tr>" +
        "<td style='padding:9px 12px;font-weight:700;border-bottom:1px solid #e5e7eb;'>" + esc(p.trade) + (p.multiphasic ? " <span style='font-size:10px;color:#7c3aed;font-weight:600;'>(Multiphasic)</span>" : "") + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;color:" + (p.estrogen ? "#0e4a8a" : "#999") + "'>" + (p.estrogen ? esc(p.estrogen) : "—") + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#0e4a8a;'>" + (p.estrogenDose != null ? (typeof p.estrogenDose === "string" ? p.estrogenDose + " mg" : autoDisplayDose(p.estrogenDose)) : "—") + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;color:#7c3aed;'>" + esc(p.progestogen) + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#7c3aed;'>" + (p.progestogenDose != null ? (typeof p.progestogenDose === "string" ? p.progestogenDose + " mg" : autoDisplayDose(p.progestogenDose)) : "—") + "</td>" +
      "</tr>";
    }).join("");

    var criteriaHtml = "";
    if (state.estrogen || state.estrogenDose) {
      criteriaHtml += "<span style='display:inline-block;background:#e0ecff;color:#1a4d9a;border-radius:6px;padding:2px 8px;margin:2px;font-size:11px;'>";
      if (state.estrogen) criteriaHtml += "Estrogen: " + esc(state.estrogen);
      if (state.estrogenDose) criteriaHtml += (state.estrogen ? " · " : "Estrogen dose: ") + esc(state.estrogenDose) + " " + esc(state.estrogenUnit);
      criteriaHtml += "</span>";
    }
    if (state.progestogen || state.progestogenDose) {
      criteriaHtml += "<span style='display:inline-block;background:#f3e8ff;color:#6b21a8;border-radius:6px;padding:2px 8px;margin:2px;font-size:11px;'>";
      if (state.progestogen) criteriaHtml += "Progestogen: " + esc(state.progestogen);
      if (state.progestogenDose) criteriaHtml += (state.progestogen ? " · " : "Progestogen dose: ") + esc(state.progestogenDose) + " " + esc(state.progestogenUnit);
      criteriaHtml += "</span>";
    }

    var html = "<!DOCTYPE html><html><head><meta charset='utf-8'>" +
      "<title>OCP Finder – Results</title>" +
      "<style>" +
        "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;padding:28px 32px;color:#111;}" +
        "h1{font-size:20px;font-weight:900;color:#0b0f14;margin:0 0 4px 0;}" +
        ".subtitle{font-size:12px;color:#666;margin:0 0 16px 0;}" +
        ".criteria{margin-bottom:18px;padding:10px 14px;background:#f7f8fa;border-radius:8px;border:1px solid #e5e7eb;}" +
        ".criteria-label{font-size:11px;font-weight:700;color:#666;text-transform:uppercase;letter-spacing:.05em;margin-bottom:6px;}" +
        "table{width:100%;border-collapse:collapse;font-size:13px;}" +
        "thead th{background:#0b0f14;color:#fff;padding:10px 12px;text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.07em;}" +
        "thead th:nth-child(3),thead th:nth-child(5){text-align:center;}" +
        "tbody tr:nth-child(even){background:#f9fafb;}" +
        ".footer{margin-top:24px;font-size:10px;color:#999;text-align:center;border-top:1px solid #e5e7eb;padding-top:10px;}" +
        "@media print{body{padding:16px 20px;} .no-print{display:none;}}" +
      "</style></head><body>" +
      "<h1>OCP Finder – Results</h1>" +
      "<p class='subtitle'>Generated on " + new Date().toLocaleString() + " · " + state.results.length + " result" + (state.results.length===1?"":"s") + " found</p>" +
      "<div class='criteria'><div class='criteria-label'>Search Criteria</div>" + (criteriaHtml || "<em style='font-size:12px;color:#999;'>No specific criteria (all OCPs)</em>") + "</div>" +
      "<table><thead><tr><th>Trade Name</th><th>Estrogen</th><th>Estrogen Dose</th><th>Progestogen</th><th>Progestogen Dose</th></tr></thead><tbody>" +
      rows + "</tbody></table>" +
      "<div class='footer'>Eikon Pharmacy System – OCP Finder · For professional use only</div>" +
      "<script>window.onload=function(){window.print()}<\/script>" +
      "</body></html>";

    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    try {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener"; a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e) { try { window.open(url, "_blank"); } catch (e2) {} }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }

  // ─── Render Module ─────────────────────────────────────────────────────────
  function buildSelect(options, placeholder, onChange) {
    var s = el("select", { class: "eikon-select" });
    s.appendChild(el("option", { value: "", text: placeholder }));
    options.forEach(function (opt) {
      s.appendChild(el("option", { value: opt, text: opt }));
    });
    s.addEventListener("change", function () { onChange(s.value); });
    return s;
  }

  function buildUnitToggle(initUnit, onChange) {
    var wrap = el("div", { class: "ocp-unit-toggle" });
    ["mg", "mcg"].forEach(function (u) {
      var btn = el("button", { type: "button", class: "ocp-unit-btn" + (u === initUnit ? " active" : ""), text: u });
      btn.addEventListener("click", function () {
        wrap.querySelectorAll(".ocp-unit-btn").forEach(function (b) { b.classList.remove("active"); });
        btn.classList.add("active");
        onChange(u);
      });
      wrap.appendChild(btn);
    });
    return wrap;
  }

  async function render(ctx) {
    var mount = ctx.mount;
    mount.innerHTML = "";

    // ── Inject styles ──
    if (!document.getElementById("ocp-styles")) {
      var styleEl = document.createElement("style");
      styleEl.id = "ocp-styles";
      styleEl.textContent = [
        /* Layout */
        ".ocp-wrap{padding:18px;max-width:1100px;}",
        ".ocp-hero{display:flex;align-items:flex-start;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:22px;}",
        ".ocp-hero-text h2{margin:0 0 4px 0;font-size:20px;font-weight:900;letter-spacing:-.3px;}",
        ".ocp-hero-text p{margin:0;font-size:13px;color:var(--muted);}",
        ".ocp-hero-pill{display:flex;align-items:center;gap:8px;background:rgba(90,162,255,.1);border:1px solid rgba(90,162,255,.25);border-radius:12px;padding:8px 14px;font-size:12px;color:var(--accent);}",

        /* Filter card */
        ".ocp-filter-card{background:var(--panel);border:1px solid var(--border);border-radius:18px;padding:20px;margin-bottom:20px;}",
        ".ocp-filter-title{font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.1em;color:var(--muted);margin-bottom:16px;}",
        ".ocp-filter-grid{display:grid;grid-template-columns:1fr 1fr;gap:20px;}",
        "@media(max-width:640px){.ocp-filter-grid{grid-template-columns:1fr;}}",
        ".ocp-hormone-block{background:rgba(0,0,0,.18);border:1px solid var(--border);border-radius:14px;padding:16px;}",
        ".ocp-hormone-block.estrogen{border-left:3px solid #5aa2ff;}",
        ".ocp-hormone-block.progestogen{border-left:3px solid #b07aff;}",
        ".ocp-block-header{display:flex;align-items:center;gap:8px;margin-bottom:14px;}",
        ".ocp-block-icon{width:26px;height:26px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:900;}",
        ".ocp-block-icon.e{background:rgba(90,162,255,.2);color:#5aa2ff;}",
        ".ocp-block-icon.p{background:rgba(176,122,255,.2);color:#b07aff;}",
        ".ocp-block-title{font-size:13px;font-weight:800;}",
        ".ocp-block-subtitle{font-size:11px;color:var(--muted);}",
        ".ocp-field-row{display:flex;gap:10px;align-items:flex-end;}",
        ".ocp-field-row .eikon-field{flex:1;}",
        ".ocp-dose-wrap{display:flex;gap:8px;align-items:center;}",
        ".ocp-dose-wrap input{flex:1;background:rgba(0,0,0,.20);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:12px;font-size:13px;outline:none;width:100%;box-sizing:border-box;}",
        ".ocp-dose-wrap input:focus{border-color:rgba(90,162,255,.55);}",

        /* Unit toggle */
        ".ocp-unit-toggle{display:flex;border:1px solid var(--border);border-radius:10px;overflow:hidden;flex-shrink:0;}",
        ".ocp-unit-btn{background:transparent;border:none;color:var(--muted);padding:8px 11px;cursor:pointer;font-size:12px;font-weight:700;transition:background .15s,color .15s;}",
        ".ocp-unit-btn:hover{background:rgba(255,255,255,.05);}",
        ".ocp-unit-btn.active{background:rgba(90,162,255,.18);color:var(--accent);}",

        /* Search / Reset buttons */
        ".ocp-actions{display:flex;gap:10px;justify-content:flex-end;margin-top:18px;flex-wrap:wrap;}",

        /* Results */
        ".ocp-result-section{margin-top:4px;}",
        ".ocp-result-count{font-size:13px;color:var(--muted);margin-bottom:14px;display:flex;align-items:center;gap:6px;}",
        ".ocp-count-num{font-size:20px;font-weight:900;color:var(--accent);}",
        ".ocp-result-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px;}",

        /* Pill card */
        ".ocp-pill-card{background:var(--panel);border:1px solid var(--border);border-radius:16px;overflow:hidden;transition:border-color .15s,transform .12s,box-shadow .12s;}",
        ".ocp-pill-card:hover{border-color:rgba(90,162,255,.4);transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.3);}",
        ".ocp-pill-card.ocp-multiphasic{border-color:rgba(176,122,255,.35);}",
        ".ocp-pill-header{padding:12px 14px 10px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:8px;background:rgba(255,255,255,.02);}",
        ".ocp-pill-name{font-size:14px;font-weight:800;letter-spacing:-.2px;}",
        ".ocp-badge{font-size:10px;font-weight:700;padding:2px 8px;border-radius:20px;flex-shrink:0;}",
        ".ocp-badge-multi{background:rgba(176,122,255,.15);color:#b07aff;border:1px solid rgba(176,122,255,.3);}",
        ".ocp-pill-body{display:flex;align-items:stretch;}",
        ".ocp-hormone-section{flex:1;padding:12px 14px;display:flex;flex-direction:column;gap:4px;}",
        ".ocp-hormone-section.ocp-hormone-none{opacity:.6;}",
        ".ocp-divider-v{width:1px;background:var(--border);margin:10px 0;}",
        ".ocp-hormone-label{display:flex;align-items:center;gap:6px;margin-bottom:4px;}",
        ".ocp-hormone-icon{width:20px;height:20px;border-radius:6px;display:inline-flex;align-items:center;justify-content:center;font-size:10px;font-weight:900;flex-shrink:0;}",
        ".ocp-e-icon{background:rgba(90,162,255,.2);color:#5aa2ff;}",
        ".ocp-p-icon{background:rgba(176,122,255,.2);color:#b07aff;}",
        ".ocp-hormone-type-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);}",
        ".ocp-hormone-name{font-size:12px;font-weight:600;color:var(--text);line-height:1.3;}",
        ".ocp-none-text{color:var(--muted);font-style:italic;font-weight:400;}",
        ".ocp-hormone-dose{font-size:13px;font-weight:800;color:var(--accent);}",
        ".ocp-hormone-section:nth-child(3) .ocp-hormone-dose{color:#b07aff;}",

        /* Empty states */
        ".ocp-empty-state{text-align:center;padding:48px 20px;color:var(--muted);}",
        ".ocp-empty-state.ocp-no-match .ocp-empty-icon{opacity:.4;}",
        ".ocp-empty-icon{font-size:44px;display:block;margin-bottom:12px;opacity:.35;}",
        ".ocp-empty-state p{font-size:14px;margin:0;line-height:1.6;}",

        /* Print row */
        ".ocp-print-row{display:flex;justify-content:flex-end;margin-top:20px;}",
        ".ocp-print-btn{font-size:13px;}",
      ].join("");
      document.head.appendChild(styleEl);
    }

    var wrap = el("div", { class: "ocp-wrap eikon-content" });

    // Hero
    var hero = el("div", { class: "ocp-hero" });
    var heroText = el("div", { class: "ocp-hero-text" });
    heroText.appendChild(el("h2", { text: "OCP Finder" }));
    heroText.appendChild(el("p", { text: "Search oral contraceptive pills by hormone type and dose. Leave any field empty to broaden results." }));
    hero.appendChild(heroText);
    var heroPill = el("div", { class: "ocp-hero-pill" });
    heroPill.innerHTML = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round'><ellipse cx='11' cy='11' rx='8' ry='4' transform='rotate(-45 11 11)'/></svg> " + OCP_DATA.length + " OCPs in database";
    hero.appendChild(heroPill);
    wrap.appendChild(hero);

    // Filter card
    var filterCard = el("div", { class: "ocp-filter-card" });
    filterCard.appendChild(el("div", { class: "ocp-filter-title", text: "Filter Criteria" }));

    var grid = el("div", { class: "ocp-filter-grid" });

    // ── Estrogen block ──
    var eBlock = el("div", { class: "ocp-hormone-block estrogen" });
    var eHeader = el("div", { class: "ocp-block-header" });
    var eIcon = el("div", { class: "ocp-block-icon e", text: "E" });
    var eInfo = el("div");
    eInfo.appendChild(el("div", { class: "ocp-block-title", text: "Estrogen" }));
    eInfo.appendChild(el("div", { class: "ocp-block-subtitle", text: "Optional – leave empty to ignore" }));
    eHeader.appendChild(eIcon); eHeader.appendChild(eInfo);
    eBlock.appendChild(eHeader);

    var eTypeField = el("div", { class: "eikon-field" });
    eTypeField.appendChild(el("label", { class: "eikon-label", text: "Type" }));
    refs.estrogenSelect = buildSelect(ESTROGENS, "Any estrogen", function (v) { state.estrogen = v; });
    eTypeField.appendChild(refs.estrogenSelect);
    eBlock.appendChild(eTypeField);

    var eDoseField = el("div", { class: "eikon-field", style: "margin-top:10px;" });
    eDoseField.appendChild(el("label", { class: "eikon-label", text: "Dose" }));
    var eDoseRow = el("div", { class: "ocp-dose-wrap" });
    refs.estrogenDoseInput = el("input", { type: "number", min: "0", step: "any", placeholder: "e.g. 30" });
    refs.estrogenDoseInput.style.cssText = "flex:1;background:rgba(0,0,0,.20);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:12px;font-size:13px;outline:none;box-sizing:border-box;";
    refs.estrogenDoseInput.addEventListener("input", function () { state.estrogenDose = refs.estrogenDoseInput.value; });
    refs.estrogenDoseInput.addEventListener("focus", function () { this.style.borderColor = "rgba(90,162,255,.55)"; });
    refs.estrogenDoseInput.addEventListener("blur", function () { this.style.borderColor = "var(--border)"; });
    eDoseRow.appendChild(refs.estrogenDoseInput);
    refs.estrogenUnitToggle = buildUnitToggle("mg", function (u) { state.estrogenUnit = u; });
    eDoseRow.appendChild(refs.estrogenUnitToggle);
    eDoseField.appendChild(eDoseRow);
    eBlock.appendChild(eDoseField);
    grid.appendChild(eBlock);

    // ── Progestogen block ──
    var pBlock = el("div", { class: "ocp-hormone-block progestogen" });
    var pHeader = el("div", { class: "ocp-block-header" });
    var pIcon = el("div", { class: "ocp-block-icon p", text: "P" });
    var pInfo = el("div");
    pInfo.appendChild(el("div", { class: "ocp-block-title", text: "Progestogen" }));
    pInfo.appendChild(el("div", { class: "ocp-block-subtitle", text: "Optional – leave empty to ignore" }));
    pHeader.appendChild(pIcon); pHeader.appendChild(pInfo);
    pBlock.appendChild(pHeader);

    var pTypeField = el("div", { class: "eikon-field" });
    pTypeField.appendChild(el("label", { class: "eikon-label", text: "Type" }));
    refs.progestogenSelect = buildSelect(PROGESTOGENS, "Any progestogen", function (v) { state.progestogen = v; });
    pTypeField.appendChild(refs.progestogenSelect);
    pBlock.appendChild(pTypeField);

    var pDoseField = el("div", { class: "eikon-field", style: "margin-top:10px;" });
    pDoseField.appendChild(el("label", { class: "eikon-label", text: "Dose" }));
    var pDoseRow = el("div", { class: "ocp-dose-wrap" });
    refs.progestogenDoseInput = el("input", { type: "number", min: "0", step: "any", placeholder: "e.g. 0.15" });
    refs.progestogenDoseInput.style.cssText = "flex:1;background:rgba(0,0,0,.20);border:1px solid var(--border);color:var(--text);padding:10px 12px;border-radius:12px;font-size:13px;outline:none;box-sizing:border-box;";
    refs.progestogenDoseInput.addEventListener("input", function () { state.progestogenDose = refs.progestogenDoseInput.value; });
    refs.progestogenDoseInput.addEventListener("focus", function () { this.style.borderColor = "rgba(176,122,255,.55)"; });
    refs.progestogenDoseInput.addEventListener("blur", function () { this.style.borderColor = "var(--border)"; });
    pDoseRow.appendChild(refs.progestogenDoseInput);
    refs.progestogenUnitToggle = buildUnitToggle("mg", function (u) { state.progestogenUnit = u; });
    pDoseRow.appendChild(refs.progestogenUnitToggle);
    pDoseField.appendChild(pDoseRow);
    pBlock.appendChild(pDoseField);
    grid.appendChild(pBlock);

    filterCard.appendChild(grid);

    // Actions
    var actions = el("div", { class: "ocp-actions" });

    var resetBtn = el("button", { type: "button", class: "eikon-btn", text: "Reset" });
    resetBtn.addEventListener("click", function () {
      state.estrogen = ""; state.estrogenDose = ""; state.estrogenUnit = "mg";
      state.progestogen = ""; state.progestogenDose = ""; state.progestogenUnit = "mg";
      state.results = null;
      refs.estrogenSelect.value = "";
      refs.progestogenSelect.value = "";
      refs.estrogenDoseInput.value = "";
      refs.progestogenDoseInput.value = "";
      // Reset unit toggles
      [refs.estrogenUnitToggle, refs.progestogenUnitToggle].forEach(function (tog) {
        tog.querySelectorAll(".ocp-unit-btn").forEach(function (b) {
          b.classList.toggle("active", b.textContent === "mg");
        });
      });
      renderResults();
    });
    actions.appendChild(resetBtn);

    var searchBtn = el("button", { type: "button", class: "eikon-btn primary" });
    searchBtn.innerHTML = "<svg width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='currentColor' stroke-width='2.2' stroke-linecap='round' stroke-linejoin='round' style='margin-right:6px;vertical-align:-2px'><circle cx='11' cy='11' r='8'/><line x1='21' y1='21' x2='16.65' y2='16.65'/></svg>Search";
    searchBtn.addEventListener("click", doSearch);
    actions.appendChild(searchBtn);

    filterCard.appendChild(actions);
    wrap.appendChild(filterCard);

    // Results area
    var resultSection = el("div", { class: "ocp-result-section" });
    refs.resultWrap = el("div", { class: "ocp-result-wrap" });
    resultSection.appendChild(refs.resultWrap);
    wrap.appendChild(resultSection);

    mount.appendChild(wrap);

    // Initial empty state
    renderResults();
  }

  // ─── Register ──────────────────────────────────────────────────────────────
  E.registerModule({
    id: "ocps",
    title: "OCP Finder",
    order: 390,
    icon: "💊",
    render: render
  });

})();
