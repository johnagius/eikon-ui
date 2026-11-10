/* Contraceptive pills (OCP finder), new layout: a fast lookup, not a register. The classic screen stores nothing and
   calls no endpoint: it filters a fixed list of 21 pills by estrogen type and dose and progestogen type and dose (mg or
   mcg, a dose matching within 1.5%, a multiphasic pill passing any dose), and prints the results. This screen keeps
   that list word for word and the same matching, filters as you type, adds a name search and "progestogen only", and
   one tap on a pill shows the pills with the same hormones and doses. Printing stays in the classic finder.
   No request is made, so nothing here can change any data. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // The classic finder's list (modules.ocps.js OCP_DATA), copied exactly. Doses in mg; a multiphasic pill has text ranges.
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
  var ESTROGENS = uniq(OCP_DATA.map(function (d) { return d.estrogen; }));
  var PROGESTOGENS = uniq(OCP_DATA.map(function (d) { return d.progestogen; }));
  var NONE = "__none"; // estrogen "none": the progestogen-only pills

  var S = { mount: null, q: "", e: "", ed: "", eu: "mg", p: "", pd: "", pu: "mg", like: "" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s == null ? "" : s).toLowerCase(); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } }); return out.sort(); }

  // The classic finder's rules, unchanged: a typed dose in the chosen unit, compared within 1.5%.
  function parseDoseMg(raw, unit) {
    var s = String(raw || "").trim().replace(",", ".");
    if (!s) return null;
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return null;
    return unit === "mcg" ? n / 1000 : n;
  }
  function approxEqual(a, b) {
    if (a == null || b == null || typeof a !== "number" || typeof b !== "number") return false;
    return Math.abs(a - b) <= Math.max(a, b) * 0.015;
  }
  // As the classic shows a dose (under 0.1 mg in mcg), without a trailing ".0": 30 mcg, 0.15 mg, 14.2 mg; ranges as typed.
  function dose(mg) {
    if (mg == null) return "";
    if (typeof mg === "string") return mg + " mg";
    if (mg < 0.1) return String(parseFloat((mg * 1000).toFixed(mg * 1000 < 10 ? 2 : 1))) + " mcg";
    return mg + " mg";
  }

  // The OCP Finder's printout, built from the pills and the filters only (the classic doPrint's own code, moved
  // here unchanged so the new Contraceptive pills screen prints the same page). crit: estrogen, estrogenDose,
  // estrogenUnit, progestogen, progestogenDose, progestogenUnit, as the classic finder keeps them.
  // The classic finder's dose display for the printout (modules.ocps.js autoDisplayDose), copied exactly
  function autoDisplayDose(mg) {
    if (mg == null || typeof mg !== "number") return "—";
    if (mg < 0.1) return (mg * 1000).toFixed(mg * 1000 < 10 ? 2 : 1) + " mcg";
    return mg + " mg";
  }
  E.ocpPrintHtml = function (results, crit) {
    crit = crit || {};
    var rows = results.map(function (p) {
      return "<tr>" +
        "<td style='padding:9px 12px;font-weight:700;border-bottom:1px solid #e5e7eb;'>" + esc(p.trade) + (p.multiphasic ? " <span style='font-size:10px;color:#7c3aed;font-weight:600;'>(Multiphasic)</span>" : "") + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;color:" + (p.estrogen ? "#0e4a8a" : "#999") + "'>" + (p.estrogen ? esc(p.estrogen) : "—") + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#0e4a8a;'>" + (p.estrogenDose != null ? (typeof p.estrogenDose === "string" ? p.estrogenDose + " mg" : autoDisplayDose(p.estrogenDose)) : "—") + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;color:#7c3aed;'>" + esc(p.progestogen) + "</td>" +
        "<td style='padding:9px 12px;border-bottom:1px solid #e5e7eb;text-align:center;color:#7c3aed;'>" + (p.progestogenDose != null ? (typeof p.progestogenDose === "string" ? p.progestogenDose + " mg" : autoDisplayDose(p.progestogenDose)) : "—") + "</td>" +
      "</tr>";
    }).join("");

    var criteriaHtml = "";
    if (crit.estrogen || crit.estrogenDose) {
      criteriaHtml += "<span style='display:inline-block;background:#e0ecff;color:#1a4d9a;border-radius:6px;padding:2px 8px;margin:2px;font-size:11px;'>";
      if (crit.estrogen) criteriaHtml += "Estrogen: " + esc(crit.estrogen);
      if (crit.estrogenDose) criteriaHtml += (crit.estrogen ? " · " : "Estrogen dose: ") + esc(crit.estrogenDose) + " " + esc(crit.estrogenUnit);
      criteriaHtml += "</span>";
    }
    if (crit.progestogen || crit.progestogenDose) {
      criteriaHtml += "<span style='display:inline-block;background:#f3e8ff;color:#6b21a8;border-radius:6px;padding:2px 8px;margin:2px;font-size:11px;'>";
      if (crit.progestogen) criteriaHtml += "Progestogen: " + esc(crit.progestogen);
      if (crit.progestogenDose) criteriaHtml += (crit.progestogen ? " · " : "Progestogen dose: ") + esc(crit.progestogenDose) + " " + esc(crit.progestogenUnit);
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
      "<p class='subtitle'>Generated on " + new Date().toLocaleString() + " · " + results.length + " result" + (results.length===1?"":"s") + " found</p>" +
      "<div class='criteria'><div class='criteria-label'>Search Criteria</div>" + (criteriaHtml || "<em style='font-size:12px;color:#999;'>No specific criteria (all OCPs)</em>") + "</div>" +
      "<table><thead><tr><th>Trade Name</th><th>Estrogen</th><th>Estrogen Dose</th><th>Progestogen</th><th>Progestogen Dose</th></tr></thead><tbody>" +
      rows + "</tbody></table>" +
      "<div class='footer'>Eikon Pharmacy System – OCP Finder · For professional use only</div>" +
      "</body></html>";

    return html;
  };

  function matches(pill, f) {
    var eDose = parseDoseMg(f.ed, f.eu), pDose = parseDoseMg(f.pd, f.pu);
    if (f.e === NONE) { if (pill.estrogen) return false; }
    else if (f.e) { if (!pill.estrogen || low(pill.estrogen) !== low(f.e)) return false; }
    if (eDose != null && !pill.multiphasic && !approxEqual(pill.estrogenDose, eDose)) return false;
    if (f.p) { if (!pill.progestogen || low(pill.progestogen) !== low(f.p)) return false; }
    if (pDose != null && !pill.multiphasic && !approxEqual(pill.progestogenDose, pDose)) return false;
    var q = low(f.q).trim();
    if (q && [pill.trade, pill.estrogen || "progestogen only", pill.progestogen].join(" ").toLowerCase().indexOf(q) < 0) return false;
    return true;
  }
  function filtersOf(pill) { // this pill's own hormones and doses, as the filters
    var num = function (v) { return typeof v === "number" ? String(v) : ""; };
    return { q: "", e: pill.estrogen || NONE, ed: num(pill.estrogenDose), eu: "mg", p: pill.progestogen || "", pd: num(pill.progestogenDose), pu: "mg" };
  }
  function sameAs(pill) { var f = filtersOf(pill); return OCP_DATA.filter(function (x) { return x !== pill && matches(x, f); }); }
  function active() { return !!(S.q.trim() || S.e || S.ed.trim() || S.p || S.pd.trim()); }

  function css() {
    if (document.getElementById("eikon-ocpreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ocpreg-css";
    st.textContent =
      ".ocp{max-width:880px;margin:0 auto}" +
      ".ocp-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".ocp-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".ocp h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.ocp-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".ocp-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".ocp-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".ocp-find{display:flex;align-items:center;gap:8px;margin-top:16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:0 12px}" +
      ".ocp-find input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:11px 0}" +
      ".ocp-find:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}" +
      ".ocp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}" +
      ".ocp-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:4px 0;min-width:0}" +
      ".ocp-form .hd{font-size:13px;font-weight:600;color:var(--muted);padding:10px 14px 4px}" +
      ".ocp-form label,.ocp-form .row{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border);min-width:0}" +
      ".ocp-form label:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      ".ocp-form label>span,.ocp-form .row>span{flex:0 0 52px;font-size:15px}" +
      ".ocp-form input,.ocp-form select{flex:1;min-width:0;width:100%;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0;text-overflow:ellipsis}" +
      ".ocp-form select option{color:#111;background:#fff}" +
      ".ocp-unit{display:flex;flex:0 0 auto;border:1px solid var(--border);border-radius:9px;overflow:hidden}" +
      ".ocp-unit button{font:inherit;font-size:13.5px;font-weight:600;min-width:44px;min-height:32px;border:0;background:transparent;color:var(--text);cursor:pointer;padding:0 8px}" +
      ".ocp-unit button.on{background:var(--accent);color:#fff}" +
      ".ocp-unit button:focus-visible{outline-offset:-3px}" +
      ".ocp-lab{font-size:13px;font-weight:600;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ocp-lab b{color:var(--text)}" +
      ".ocp-lab .ocp-clear{margin-left:auto;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;border:0;background:none;color:var(--accent);cursor:pointer;padding:4px 2px}" +
      ".ocp-like{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-top:14px;font-size:14px;overflow-wrap:anywhere}.ocp-like b{font-weight:600}" +
      ".ocp-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".ocp-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-top:.5px solid var(--border);padding:10px 16px;min-height:52px;cursor:pointer}" +
      ".ocp-list>.ocp-row:first-child{border-top:0}.ocp-row:hover{background:rgba(118,118,128,.06)}.ocp-row:focus-visible{outline-offset:-3px}" +
      ".ocp-row .t{flex:1;min-width:0}.ocp-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}" +
      ".ocp-row span{display:block;font-size:13px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ocp-row .f{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:0 1 auto;max-width:42%}" +
      ".ocp-flag{font-style:normal;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".ocp-flag.m{background:rgba(127,127,127,.14);color:var(--text)}" +
      ".ocp-row i{font-style:normal;font-size:12.5px;color:var(--accent);font-weight:600;white-space:nowrap}" +
      ".ocp-lab .ocp-print{margin-left:8px;height:34px}.ocp-lab .ocp-print.solo{margin-left:auto}" +
      ".ocp-row .ocp-chev{flex:none;color:var(--muted);font-size:18px;margin:0;overflow:visible}" +
      ".ocp-recent{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:10px}.ocp-rl{font-size:13px;font-weight:600;color:var(--muted);margin-right:4px}" +
      ".ocp-chip{font:inherit;font-size:14px;font-weight:500;min-height:36px;padding:4px 12px;border-radius:999px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}.ocp-chip:hover{background:rgba(127,127,127,.07)}" +
      ".ocp :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".ocp-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted)}" +
      ".ocp-note{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}.ocp-note a{color:var(--accent)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .ocp-unit button.on,html[data-ui2]:not([data-ui2-visit]) .ocp-btn.p{color:#00160E}}" +
      "@media (max-width:600px){.ocp-back{display:inline-flex;align-items:center;min-height:44px;padding:0}.ocp-find input{padding:13px 0}.ocp-unit button{min-height:40px}.ocp-lab .ocp-clear{min-height:44px;padding:0 4px}.ocp{padding:4px 16px 0}.ocp h1{font-size:32px}.ocp-grid{grid-template-columns:minmax(0,1fr)}.ocp-row{padding:10px 14px}.ocp-chip{min-height:44px}.ocp-lab .ocp-print{height:44px;border-radius:22px}}";
    document.head.appendChild(st);
  }

  function rowHtml(pill) {
    var n = sameAs(pill).length;
    // counter: progestogen-only and multiphasic as chips; "N others the same" says what a tap shows; a chevron says it opens
    return '<button type="button" class="ocp-row" data-trade="' + esc(pill.trade) + '"><div class="t"><b>' + esc(pill.trade) + "</b>" +
      (pill.estrogen ? "<span>" + esc(pill.estrogen + " " + dose(pill.estrogenDose)) + "</span>" : "") + "<span>" + esc(pill.progestogen + " " + dose(pill.progestogenDose)) + "</span></div>" +
      '<div class="f">' + (!pill.estrogen ? '<em class="ocp-flag m">Progestogen only</em>' : "") + (pill.multiphasic ? '<em class="ocp-flag m">Multiphasic</em>' : "") +
      (n ? "<i>" + n + (n === 1 ? " other the same" : " others the same") + "</i>" : "") + '</div><span class="ocp-chev" aria-hidden="true">›</span></button>';
  }
  function picks() { return E.picks ? E.picks("ocpreg") : null; }
  function recentHtml() {
    var pk = picks(), list = pk ? pk.recent().filter(function (x) { return OCP_DATA.some(function (d) { return d.trade === x.id; }); }) : [];
    if (!list.length) return "";
    return '<div class="ocp-recent" role="group" aria-labelledby="ocp-rec-lab"><span class="ocp-rl" id="ocp-rec-lab">Looked up recently</span>' + list.map(function (x) { return '<button type="button" class="ocp-chip" data-recent="' + esc(x.id) + '">' + esc(x.id) + "</button>"; }).join("") + "</div>";
  }

  function opts(list, cur, anyLabel, extra) {
    return '<option value="">' + esc(anyLabel) + "</option>" + (extra || "") + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
  }
  function unitHtml(k, cur, label) {
    return '<div class="ocp-unit" role="group" aria-label="' + esc(label) + '">' + ["mg", "mcg"].map(function (u) {
      return '<button type="button" data-unit="' + k + '" data-u="' + u + '" aria-pressed="' + (u === cur) + '"' + (u === cur ? ' class="on"' : "") + ">" + u + "</button>";
    }).join("") + "</div>";
  }

  // The page is drawn once; typing only redraws the results, so the field being typed in is never replaced.
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "ocpreg") return; // left already: do not draw over the next screen
    var h = '<div class="ocp"><button class="ocp-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("ocpreg")) + '</button>' +
      '<div class="ocp-top"><div><h1>Contraceptive pills</h1><p class="ocp-sub">Find a pill by its hormones and doses. ' + OCP_DATA.length + " pills listed.</p></div></div>" +
      '<div class="ocp-find"><input id="ocp-q" type="search" placeholder="Search a brand or hormone" aria-label="Search a brand or hormone" autocomplete="off" spellcheck="false" enterkeyhint="search" value="' + esc(S.q) + '"></div>' +
      '<div id="ocp-rec">' + recentHtml() + "</div>" +
      '<div class="ocp-grid">' +
      '<div class="ocp-form" role="group" aria-labelledby="ocp-hd-e"><div class="hd" id="ocp-hd-e">Estrogen</div>' +
      '<label><span>Type</span><select id="ocp-e" aria-label="Estrogen type">' + opts(ESTROGENS, S.e, "Any estrogen", '<option value="' + NONE + '"' + (S.e === NONE ? " selected" : "") + ">None (progestogen only)</option>") + "</select></label>" +
      '<label><span>Dose</span><input id="ocp-ed" inputmode="decimal" aria-label="Estrogen dose" placeholder="Any dose" autocomplete="off" value="' + esc(S.ed) + '">' + unitHtml("e", S.eu, "Estrogen dose unit") + "</label></div>" +
      '<div class="ocp-form" role="group" aria-labelledby="ocp-hd-p"><div class="hd" id="ocp-hd-p">Progestogen</div>' +
      '<label><span>Type</span><select id="ocp-p" aria-label="Progestogen type">' + opts(PROGESTOGENS, S.p, "Any progestogen") + "</select></label>" +
      '<label><span>Dose</span><input id="ocp-pd" inputmode="decimal" aria-label="Progestogen dose" placeholder="Any dose" autocomplete="off" value="' + esc(S.pd) + '">' + unitHtml("p", S.pu, "Progestogen dose unit") + "</label></div>" +
      "</div>" +
      '<div id="ocp-res" aria-live="polite"></div>' +
      '<p class="ocp-note">A dose matches within 1.5%; a multiphasic pill matches any dose of its hormones. The <a href="#" data-act="classic">classic screen</a> is the old finder.</p></div>';
    m.innerHTML = h;
    m.querySelector("[data-act=back]").addEventListener("click", function () { window.location.hash = E.ui2BackHash("ocpreg"); });
    m.querySelector("[data-act=classic]").addEventListener("click", function (ev) { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "ocpreg"); } catch (x) {} E.openClassic("ocps"); });
    var bind = function (sel, key, evn) { var el = m.querySelector(sel); el.addEventListener(evn, function () { S[key] = el.value; S.like = ""; results(); }); };
    bind("#ocp-q", "q", "input"); bind("#ocp-ed", "ed", "input"); bind("#ocp-pd", "pd", "input"); bind("#ocp-e", "e", "change"); bind("#ocp-p", "p", "change");
    m.querySelectorAll("[data-unit]").forEach(function (b) {
      b.addEventListener("click", function () {
        S[b.getAttribute("data-unit") + "u"] = b.getAttribute("data-u"); S.like = "";
        b.parentNode.querySelectorAll("button").forEach(function (x) { var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
        results();
      });
    });
    m.querySelector("#ocp-rec").addEventListener("click", function (ev) {
      var b = ev.target.closest && ev.target.closest("[data-recent]"); if (!b) return;
      var pill = OCP_DATA.filter(function (x) { return x.trade === b.getAttribute("data-recent"); })[0]; if (!pill) return;
      like(pill); var nb = m.querySelector('#ocp-rec [data-recent="' + pill.trade.replace(/"/g, '\\"') + '"]'); if (nb) nb.focus();
    });
    var qi = m.querySelector("#ocp-q");
    qi.addEventListener("keydown", function (e) { if (e.key === "ArrowDown" || e.key === "Enter") { var f0 = m.querySelector("#ocp-res .ocp-row"); if (f0) { e.preventDefault(); f0.focus(); } } });
    var res = m.querySelector("#ocp-res");
    res.addEventListener("click", function (ev) {
      var pr = ev.target.closest && ev.target.closest("[data-act=print]"); if (pr) { print(); return; }
      var r = ev.target.closest && ev.target.closest(".ocp-row"), c = ev.target.closest && ev.target.closest("[data-act=clear]");
      if (c) { setFilters({ q: "", e: "", ed: "", eu: "mg", p: "", pd: "", pu: "mg" }, ""); var q = m.querySelector("#ocp-q"); if (q) q.focus(); return; }
      if (!r) return;
      var pill = OCP_DATA.filter(function (x) { return x.trade === r.getAttribute("data-trade"); })[0]; if (!pill) return;
      like(pill);
      var lk = m.querySelector(".ocp-like"); if (lk) { try { lk.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (x) {} }
    });
    results();
  }
  function like(pill) { // a pill opened: its hormones and doses become the filters; remembered as looked up recently
    setFilters(filtersOf(pill), pill.trade);
    var pk = picks(); if (pk) { pk.push({ id: pill.trade, label: pill.trade }); var rb = S.mount && S.mount.querySelector("#ocp-rec"); if (rb) rb.innerHTML = recentHtml(); }
  }
  // Print: the classic finder's printout (E.ocpPrintHtml, the same page) for the pills shown, with the hormones and doses
  // chosen as its search criteria. "None (progestogen only)" and the name search are not classic criteria, so the
  // printout lists the pills they leave and says no estrogen criterion. Opened as a tab this page drives (no script in it).
  function print() {
    var list = S.list || []; if (!list.length) return;
    var html = E.ocpPrintHtml(list, { estrogen: S.e === NONE ? "" : S.e, estrogenDose: S.ed, estrogenUnit: S.eu, progestogen: S.p, progestogenDose: S.pd, progestogenUnit: S.pu });
    var w = E.openPrint ? E.openPrint(html, { delay: 80 }) : null;
    if (!w && E.toast) E.toast("The browser blocked the print window. Allow pop-ups for Eikon and press Print again.", "warn");
  }
  function setFilters(f, like) {
    Object.keys(f).forEach(function (k) { S[k] = f[k]; }); S.like = like || "";
    var m = S.mount; if (!m) return;
    m.querySelector("#ocp-q").value = S.q; m.querySelector("#ocp-e").value = S.e; m.querySelector("#ocp-ed").value = S.ed;
    m.querySelector("#ocp-p").value = S.p; m.querySelector("#ocp-pd").value = S.pd;
    m.querySelectorAll("[data-unit]").forEach(function (b) { var on = S[b.getAttribute("data-unit") + "u"] === b.getAttribute("data-u"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    results();
  }
  function results() {
    var m = S.mount, box = m && m.querySelector("#ocp-res"); if (!box) return;
    var f = { q: S.q, e: S.e, ed: S.ed, eu: S.eu, p: S.p, pd: S.pd, pu: S.pu };
    var list = OCP_DATA.filter(function (x) { return matches(x, f); }), h = "";
    if (S.like) {
      var others = list.filter(function (x) { return x.trade !== S.like; });
      h += '<div class="ocp-like">' + (others.length ? "Same hormones and doses as <b>" + esc(S.like) + "</b>: " + others.length + (others.length === 1 ? " other pill." : " other pills.") : "No other pill listed has the same hormones and doses as <b>" + esc(S.like) + "</b>.") + "</div>";
    }
    var badDose = (S.ed.trim() && parseDoseMg(S.ed, S.eu) == null) || (S.pd.trim() && parseDoseMg(S.pd, S.pu) == null);
    S.list = list;
    h += '<div class="ocp-lab">' + (active() ? "Matching" : "All pills") + " <b>" + list.length + "</b>" + (active() ? '<button type="button" class="ocp-clear" data-act="clear">Clear</button>' : "") +
      (list.length ? '<button type="button" class="ocp-btn ocp-print' + (active() ? "" : " solo") + '" data-act="print">Print ' + (list.length === 1 ? "this pill" : "these " + list.length) + "</button>" : "") + "</div>";
    if (badDose) h += '<div class="ocp-quiet" style="margin-bottom:10px">A dose is a number, such as 0.03 mg or 30 mcg. The dose typed is left out.</div>';
    h += list.length ? '<div class="ocp-list">' + list.map(rowHtml).join("") + "</div>" : '<div class="ocp-quiet">No pill listed matches. Try another dose or unit (30 mcg is 0.03 mg), or clear a filter.</div>';
    box.innerHTML = h;
  }

  // Escape: clear the search box, else clear the filters, else back to Services (as the other counter tools)
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented || !S.mount || E.state.activeModuleId !== "ocpreg" || !document.body.contains(S.mount)) return;
    if (document.querySelector(".eikon-modal-backdrop, .eikon-modal-overlay, [role=dialog][aria-modal=true]")) return;
    var a = document.activeElement; e.preventDefault();
    if (a && a.id === "ocp-q" && a.value) { a.value = ""; S.q = ""; S.like = ""; results(); return; }
    if (active()) { setFilters({ q: "", e: "", ed: "", eu: "mg", p: "", pd: "", pu: "mg" }, ""); var q = S.mount.querySelector("#ocp-q"); if (q) q.focus(); return; }
    window.location.hash = E.ui2BackHash("ocpreg");
  });

  E.registerModule({
    id: "ocpreg", title: "Contraceptive pills", order: 3, icon: "💊", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.q = ""; S.e = ""; S.ed = ""; S.eu = "mg"; S.p = ""; S.pd = ""; S.pu = "mg"; S.like = ""; css(); paint(); var phone = false; try { phone = window.matchMedia("(max-width:600px)").matches; } catch (e) {} if (!phone && E.focusIfIdle) E.focusIfIdle(S.mount && S.mount.querySelector("#ocp-q")); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("ocpreg") < 0) E.UI2_DESTINATIONS.push("ocpreg");
  if (E.UI2_PARENT) E.UI2_PARENT.ocpreg = "services";
})();
