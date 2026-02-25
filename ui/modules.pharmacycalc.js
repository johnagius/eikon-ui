(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  function log() { E.log.apply(E, ["[pharmacycalc]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[pharmacycalc]"].concat([].slice.call(arguments))); }
  function err() { E.error.apply(E, ["[pharmacycalc]"].concat([].slice.call(arguments))); }

  function escHtml(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  // ─── DOM helper ────────────────────────────────────────────────────────────
  function mk(tag, attrs, children) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (k === "class") node.className = String(v || "");
      else if (k === "text") node.textContent = String(v == null ? "" : v);
      else if (k === "html") node.innerHTML = String(v == null ? "" : v);
      else if (k === "style") node.setAttribute("style", String(v || ""));
      else if (k === "value") node.value = String(v == null ? "" : v);
      else if (k === "type") node.type = String(v || "");
      else if (k === "placeholder") node.placeholder = String(v || "");
      else if (k === "step") node.step = String(v || "");
      else if (k === "min") node.min = String(v || "");
      else if (k === "max") node.max = String(v || "");
      else if (k === "disabled") node.disabled = !!v;
      else if (k === "required") { if (v) node.required = true; }
      else node.setAttribute(k, String(v));
    });
    if (Array.isArray(children)) {
      children.forEach(function (c) {
        if (c == null) return;
        if (typeof c === "string") node.appendChild(document.createTextNode(c));
        else node.appendChild(c);
      });
    }
    return node;
  }

  // ─── Toast ─────────────────────────────────────────────────────────────────
  var _toastInstalled = false;
  function ensureToastStyles() {
    if (_toastInstalled) return;
    _toastInstalled = true;
    var st = document.createElement("style");
    st.textContent =
      ".pcc-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".pcc-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}" +
      ".pcc-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".pcc-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".pcc-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".pcc-toast.bad{border-color:rgba(255,90,122,.35);}" +
      ".pcc-toast.warn{border-color:rgba(255,200,90,.35);}";
    document.head.appendChild(st);
  }

  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("pcc-toast-wrap");
    if (!wrap) {
      wrap = document.createElement("div");
      wrap.id = "pcc-toast-wrap";
      wrap.className = "pcc-toast-wrap";
      document.body.appendChild(wrap);
    }
    var t = mk("div", { class: "pcc-toast " + (kind || "") });
    t.appendChild(mk("div", { class: "t-title", text: title || "Info" }));
    t.appendChild(mk("div", { class: "t-msg", text: message || "" }));
    wrap.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, typeof ms === "number" ? ms : 2800);
  }

  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function (resolve) {
      try {
        E.modal.show(title || "Confirm", "<div style='font-size:13px;'>" + escHtml(bodyText || "") + "</div>", [
          { label: cancelLabel || "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
          { label: okLabel || "OK", danger: true, onClick: function () { E.modal.hide(); resolve(true); } }
        ]);
      } catch (e) {
        resolve(window.confirm(bodyText || "Are you sure?"));
      }
    });
  }

  // ─── Print (same method as other modules) ──────────────────────────────────
  var _lastPrintAt = 0;
  function openPrintTabWithHtml(html) {
    var now = Date.now();
    if (now - _lastPrintAt < 900) return;
    _lastPrintAt = now;
    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);
    try {
      var a = document.createElement("a");
      a.href = url; a.target = "_blank"; a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a); a.click(); a.remove();
    } catch (e1) {
      try { window.open(url, "_blank"); } catch (e2) {}
    }
    setTimeout(function () { try { URL.revokeObjectURL(url); } catch (e) {} }, 60000);
  }

  // ─── Date helpers ──────────────────────────────────────────────────────────
  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }

  // ─── Maltese ID normalisation ───────────────────────────────────────────────
  // Any ID that is 0-7 digits followed by a letter → pad digits to 7 → e.g. 789M → 0000789M
  var MALTA_ID_RE = /^(\d{0,7})([A-Za-z])$/;
  function normaliseMalteseId(raw) {
    var s = String(raw || "").trim();
    var m = MALTA_ID_RE.exec(s);
    if (!m) return s; // not a Maltese ID, return as-is
    var digits = m[1].padStart(7, "0");
    var letter = m[2].toUpperCase();
    return digits + letter;
  }

  // ─── Module state ───────────────────────────────────────────────────────────
  var state = {
    view: "calc",        // "calc" | "records"
    activeTab: "lev",    // lev | pred | war | ins | mtx
    patients: [],        // loaded from D1 for autosuggest
    records: [],         // loaded from D1 for records view
    recordsLoaded: false,
    lastModels: { lev: null, pred: null, war: null, ins: null, mtx: null }
  };

  // ─── API helpers ────────────────────────────────────────────────────────────
  async function loadPatients() {
    try {
      var r = await E.apiFetch("/pharmacy-calc/patients", { method: "GET" });
      state.patients = (r && Array.isArray(r.patients)) ? r.patients : [];
    } catch (e) {
      state.patients = [];
      warn("loadPatients failed:", e && e.message);
    }
  }

  async function saveRecord(payload) {
    return await E.apiFetch("/pharmacy-calc/records", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });
  }

  async function loadRecords() {
    var r = await E.apiFetch("/pharmacy-calc/records", { method: "GET" });
    state.records = (r && Array.isArray(r.records)) ? r.records : [];
    state.recordsLoaded = true;
  }

  async function deleteRecord(id) {
    return await E.apiFetch("/pharmacy-calc/records/" + encodeURIComponent(String(id)), { method: "DELETE" });
  }

  // ─────────────────────────── CALCULATOR ENGINE ─────────────────────────────
  // (All maths ported verbatim from original; only I/O wired to module UI)

  var DOW = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

  function parseNum(v) {
    if (v == null) return NaN;
    var s = String(v).trim().replace(",", ".");
    if (s === "") return NaN;
    var n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function parseIntSafe(v, fallback) {
    var n = parseInt(String(v).trim(), 10);
    return Number.isFinite(n) ? n : fallback;
  }

  function clamp(n, lo, hi) {
    if (!Number.isFinite(n)) return lo;
    return Math.min(hi, Math.max(lo, n));
  }

  function fmtDate(d) {
    return String(d.getDate()).padStart(2,"0") + "/" + String(d.getMonth()+1).padStart(2,"0") + "/" + d.getFullYear();
  }

  function addDays(dt, days) {
    var d = new Date(dt.getTime());
    d.setDate(d.getDate() + days);
    return d;
  }

  function roundFixed(n, dp) {
    if (!Number.isFinite(n)) return "";
    var f = Math.pow(10, dp);
    return (Math.round(n * f) / f).toFixed(dp);
  }

  function formatStrength(x) {
    var n = Number(x);
    if (!Number.isFinite(n)) return "";
    return roundFixed(n, 2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
  }

  function normalizeStrengthList(str) {
    return Array.from(new Set(
      String(str || "").split(",").map(function(s){ return s.trim(); }).filter(Boolean)
        .map(function(p){ var n = parseNum(p); return Number.isFinite(n) && n > 0 ? Number(roundFixed(n,4)) : null; })
        .filter(function(x){ return x !== null; })
    )).sort(function(a,b){ return a-b; });
  }

  function plural(n, one, many) { return n === 1 ? one : many; }

  // --- combo solver ---
  // splitting: "none" | "halves" | "quarters"
  function generatePieces(strengths, splitting) {
    var pieces = [];
    var allowHalves = splitting === "halves" || splitting === "quarters";
    var allowQuarters = splitting === "quarters";
    strengths.forEach(function(s) {
      pieces.push({ strength: s, value: s, isHalf: false, isQuarter: false });
      if (allowHalves) pieces.push({ strength: s, value: s/2, isHalf: true, isQuarter: false });
      if (allowQuarters) pieces.push({ strength: s, value: s/4, isHalf: false, isQuarter: true });
    });
    pieces.sort(function(a,b){ return b.value - a.value; });
    return pieces;
  }

  function buildItemsFromCombo(combo) {
    var map = new Map();
    combo.forEach(function(p) {
      var key = Number(roundFixed(p.strength,4));
      if (!map.has(key)) map.set(key, { strength: p.strength, wholeCount: 0, halfCount: 0, quarterCount: 0 });
      var obj = map.get(key);
      if (p.isQuarter) obj.quarterCount += 1;
      else if (p.isHalf) obj.halfCount += 1;
      else obj.wholeCount += 1;
    });
    return Array.from(map.values()).sort(function(a,b){ return b.strength - a.strength; });
  }

  function scoreCombo(items) {
    var distinct = items.length;
    // phys = physical tablets handled (2 halves = 1 tablet, 4 quarters = 1 tablet)
    var phys = items.reduce(function(acc,it){
      return acc + it.wholeCount + Math.ceil(it.halfCount/2) + Math.ceil(it.quarterCount/4);
    }, 0);
    var splits = items.reduce(function(acc,it){ return acc + it.halfCount + it.quarterCount; }, 0);
    var total = items.reduce(function(acc,it){ return acc + it.wholeCount + it.halfCount + it.quarterCount; }, 0);
    // Primary: fewest physical tablets; secondary: fewest distinct strengths; tertiary: fewest splits
    var score = phys * 1000 + distinct * 100 + splits * 20 + total * 5;
    return { score: score };
  }

  function findBestComboExact(target, strengths, splitting, maxPieces) {
    var eps = 1e-6;
    var pieces = generatePieces(strengths, splitting || "none");
    if (Math.abs(target) < eps) return { ok: true, sum: 0, items: [] };
    var best = null;
    function dfs(startIndex, combo, sum) {
      if (combo.length > maxPieces) return;
      if (Math.abs(sum - target) < eps) {
        var items = buildItemsFromCombo(combo);
        var sc = scoreCombo(items);
        if (!best || sc.score < best.scoreDetails.score) {
          best = { ok: true, sum: sum, items: items, scoreDetails: sc };
        }
      }
      if (sum - target > eps) return;
      for (var i = startIndex; i < pieces.length; i++) {
        combo.push(pieces[i]);
        dfs(i, combo, sum + pieces[i].value);
        combo.pop();
      }
    }
    dfs(0, [], 0);
    if (!best) return { ok: false, reason: "No combination found", target: target };
    return best;
  }

  function describeCombo(items, unitLabel) {
    var parts = [];
    items.forEach(function(it) {
      if (it.wholeCount > 0) parts.push(it.wholeCount + " \u00d7 " + formatStrength(it.strength) + " " + unitLabel);
      if (it.halfCount > 0) {
        var hw = plural(it.halfCount, "half", "halves");
        parts.push(it.halfCount + " " + hw + " of " + formatStrength(it.strength) + " " + unitLabel);
      }
      if (it.quarterCount > 0) {
        parts.push(it.quarterCount + " " + plural(it.quarterCount, "quarter", "quarters") + " of " + formatStrength(it.strength) + " " + unitLabel);
      }
    });
    return parts.length ? parts.join(" + ") : "0";
  }

  function comboToPatientSentence(items) {
    var parts = [];
    items.forEach(function(it) {
      if (it.wholeCount > 0) parts.push((it.wholeCount === 1 ? "1 tablet" : it.wholeCount + " tablets") + " of " + formatStrength(it.strength) + " mg");
      if (it.halfCount > 0) parts.push((it.halfCount === 1 ? "1 half tablet" : it.halfCount + " halves") + " of " + formatStrength(it.strength) + " mg");
      if (it.quarterCount > 0) parts.push((it.quarterCount === 1 ? "1 quarter tablet" : it.quarterCount + " quarters") + " of " + formatStrength(it.strength) + " mg");
    });
    if (!parts.length) return "no tablets";
    if (parts.length === 1) return parts[0];
    return parts.slice(0,-1).join(", ") + " and " + parts[parts.length-1];
  }

  // ─── Print header builder ───────────────────────────────────────────────────
  function buildPrintHtml(title, meta, innerHtml) {
    var pName = meta.patientName || "____________________";
    var pId = meta.idCard || "____________________";
    var pharmName = meta.pharmacyName || "____________________";
    var note = meta.note ? "<div><b>Note:</b> " + escHtml(meta.note) + "</div>" : "";
    return "<!doctype html>\n<html>\n<head>\n<meta charset='utf-8'/>\n<meta name='viewport' content='width=device-width,initial-scale=1'/>\n<title>" + escHtml(title) + "</title>\n<style>\n@page{size:A4;margin:14mm;}\nbody{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#000;}\n.sheet{padding:12px;}\n.ph{border-bottom:3px solid #000;padding-bottom:10px;margin-bottom:14px;}\n.ph h1{font-size:18px;margin:0;}\n.pmeta{margin-top:8px;font-size:12px;line-height:1.4;}\n.pline{display:flex;gap:10px;flex-wrap:wrap;margin-top:6px;}\n.pline div{border:2px solid #000;padding:5px 8px;border-radius:8px;font-weight:800;}\ntable{width:100%;border-collapse:collapse;margin:8px 0;page-break-inside:avoid;}\nth,td{border:2px solid #000;padding:7px 8px;font-size:12px;vertical-align:top;}\nth{font-weight:900;text-align:left;}\n.bt{font-weight:900;font-size:13px;margin:14px 0 8px;text-transform:uppercase;letter-spacing:0.6px;}\n.warn{border:3px solid #000;padding:10px;border-radius:12px;font-weight:900;font-size:13px;margin:12px 0;}\n.bigwarn{border:4px solid #000;padding:10px;border-radius:12px;font-weight:900;font-size:14px;margin:12px 0;}\n</style>\n</head>\n<body>\n<div class='sheet'>\n<div class='ph'>\n<h1>" + escHtml(title) + "</h1>\n<div class='pmeta'>\n<div class='pline'><div>Pharmacy: " + escHtml(pharmName) + "</div></div>\n<div class='pline'><div>Patient: " + escHtml(pName) + "</div><div>ID: " + escHtml(pId) + "</div></div>\n" + (note ? "<div style='margin-top:8px;'>" + note + "</div>" : "") + "\n</div></div>\n" + innerHtml + "\n</div>\n<script>\nwindow.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){}try{window.print();}catch(e){}},80);});\nwindow.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});\n</scr" + "ipt>\n</body></html>";
  }

  // ─── Section: Header card ───────────────────────────────────────────────────
  function buildHeaderCard(refs) {
    // refs = { pharmacyName, patientNameIn, idCardIn, startDateIn, noteIn }
    var user = (E.state && E.state.user) ? E.state.user : null;
    var pharmName = (user && user.location_name) ? user.location_name : ((user && user.org_name) ? user.org_name : "");

    var pharmSpan = mk("span", { style: "font-weight:900;font-size:14px;", text: pharmName || "(Pharmacy name from account)" });

    var patientNameIn = mk("input", { class: "eikon-input", type: "text", placeholder: "Patient name", style: "width:100%;" });
    var idCardIn = mk("input", { class: "eikon-input", type: "text", placeholder: "e.g. 789M or 1234567A", style: "width:100%;" });
    var startDateIn = mk("input", { class: "eikon-input", type: "date", value: todayYmd(), style: "width:100%;" });
    var noteIn = mk("input", { class: "eikon-input", type: "text", placeholder: "Optional notes for printout", style: "width:100%;" });

    // Autosuggest container
    var suggestList = mk("div", { style: "position:absolute;background:var(--card-bg,#1e2535);border:1px solid var(--border);border-radius:10px;z-index:9999;max-height:200px;overflow-y:auto;width:100%;box-shadow:0 8px 24px rgba(0,0,0,.4);display:none;" });
    var patientWrap = mk("div", { style: "position:relative;width:100%;" });
    patientWrap.appendChild(patientNameIn);
    patientWrap.appendChild(suggestList);

    function showSuggestions(query) {
      suggestList.innerHTML = "";
      suggestList.style.display = "none";
      if (!query || query.length < 1) return;
      var q = query.toLowerCase();
      var matches = state.patients.filter(function(p) {
        return (p.patient_name && p.patient_name.toLowerCase().indexOf(q) >= 0) ||
               (p.id_card && p.id_card.toLowerCase().indexOf(q) >= 0);
      }).slice(0, 10);
      if (!matches.length) return;
      matches.forEach(function(p) {
        var item = mk("div", { style: "padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);",
          text: (p.patient_name || "") + " — " + (p.id_card || "") });
        item.addEventListener("mouseenter", function() { item.style.background = "rgba(255,255,255,0.07)"; });
        item.addEventListener("mouseleave", function() { item.style.background = ""; });
        item.addEventListener("mousedown", function(e) {
          e.preventDefault();
          patientNameIn.value = p.patient_name || "";
          idCardIn.value = p.id_card || "";
          suggestList.style.display = "none";
        });
        suggestList.appendChild(item);
      });
      suggestList.style.display = "block";
    }

    patientNameIn.addEventListener("input", function() { showSuggestions(patientNameIn.value); });
    patientNameIn.addEventListener("focus", function() { showSuggestions(patientNameIn.value); });
    patientNameIn.addEventListener("blur", function() { setTimeout(function() { suggestList.style.display = "none"; }, 200); });

    // ID Card normalisation on blur
    idCardIn.addEventListener("blur", function() {
      var normed = normaliseMalteseId(idCardIn.value);
      if (normed !== idCardIn.value.trim()) {
        idCardIn.value = normed;
      }
    });

    // Also autosuggest by id card
    idCardIn.addEventListener("input", function() {
      var q = idCardIn.value.toLowerCase();
      if (!q || q.length < 1) { suggestList.style.display = "none"; return; }
      var matches = state.patients.filter(function(p) {
        return p.id_card && p.id_card.toLowerCase().indexOf(q) >= 0;
      }).slice(0, 10);
      if (!matches.length) { suggestList.style.display = "none"; return; }
      suggestList.innerHTML = "";
      matches.forEach(function(p) {
        var item = mk("div", { style: "padding:8px 12px;cursor:pointer;font-size:13px;border-bottom:1px solid var(--border);",
          text: (p.patient_name || "") + " — " + (p.id_card || "") });
        item.addEventListener("mouseenter", function() { item.style.background = "rgba(255,255,255,0.07)"; });
        item.addEventListener("mouseleave", function() { item.style.background = ""; });
        item.addEventListener("mousedown", function(e) {
          e.preventDefault();
          patientNameIn.value = p.patient_name || "";
          idCardIn.value = p.id_card || "";
          suggestList.style.display = "none";
        });
        suggestList.appendChild(item);
      });
      suggestList.style.display = "block";
    });
    idCardIn.addEventListener("blur", function() { setTimeout(function() { suggestList.style.display = "none"; }, 200); });

    refs.pharmacyName = function() { return pharmName; };
    refs.patientName = function() { return patientNameIn.value.trim(); };
    refs.idCard = function() {
      var raw = idCardIn.value.trim();
      return normaliseMalteseId(raw);
    };
    refs.startDate = function() { return startDateIn.value; };
    refs.note = function() { return noteIn.value.trim(); };

    var card = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:10px;", text: "Patient Details" }),
      mk("div", { class: "eikon-row", style: "flex-wrap:wrap;align-items:flex-start;gap:10px;" }, [
        mk("div", { class: "eikon-field" }, [
          mk("div", { class: "eikon-label", text: "Pharmacy" }),
          pharmSpan
        ]),
        mk("div", { class: "eikon-field" }, [
          mk("div", { class: "eikon-label", text: "Start Date" }),
          startDateIn
        ])
      ]),
      mk("div", { style: "height:8px;" }),
      mk("div", { class: "eikon-row", style: "flex-wrap:wrap;align-items:flex-start;gap:10px;" }, [
        mk("div", { class: "eikon-field" }, [
          mk("div", { class: "eikon-label", text: "Patient Name" }),
          patientWrap
        ]),
        mk("div", { class: "eikon-field" }, [
          mk("div", { class: "eikon-label", text: "ID Card" }),
          idCardIn,
          mk("div", { class: "eikon-help", text: "Maltese IDs auto-padded (e.g. 789M → 0000789M)" })
        ]),
        mk("div", { class: "eikon-field" }, [
          mk("div", { class: "eikon-label", text: "Notes (printout)" }),
          noteIn
        ])
      ])
    ]);
    return card;
  }

  // ─── Results area helper ───────────────────────────────────────────────────
  function makeResultBox(id) {
    var box = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:10px;", text: "Results" }),
      mk("div", { id: id, html: "<div class='eikon-help'>Click <b>Calculate</b> to see results.</div>" })
    ]);
    return box;
  }

  function setResultHtml(id, html) {
    var el = document.getElementById(id);
    if (el) el.innerHTML = html;
  }

  function setResultError(id, msg) {
    setResultHtml(id, "<div style='color:var(--danger,#e05);font-weight:800;padding:8px;border:2px solid var(--danger,#e05);border-radius:10px;'>" + escHtml(msg) + "</div>");
  }

  // ─── Save-and-print action ─────────────────────────────────────────────────
  async function doSaveAndPrint(refs, calcType, model, printFn, calcFn) {
    if (!model) model = calcFn();
    if (!model) return;

    var patientName = refs.patientName();
    var idCard = refs.idCard();
    var startDate = refs.startDate();

    if (!patientName) { toast("Missing", "Please enter a patient name.", "warn"); return; }
    if (!idCard) { toast("Missing", "Please enter an ID card number.", "warn"); return; }

    // Save to D1
    try {
      var payload = {
        patient_name: patientName,
        id_card: idCard,
        start_date: startDate,
        calc_type: calcType,
        calc_data_json: JSON.stringify(model)
      };
      await saveRecord(payload);
      state.recordsLoaded = false; // invalidate cache
      toast("Saved", "Record saved to database.", "good");
    } catch (e) {
      toast("Save failed", (e && e.message) ? e.message : "Could not save record.", "bad", 4000);
    }

    // Print
    printFn(model, refs);
  }

  // ─────────────────────────── LEVOTHYROXINE ─────────────────────────────────
  var LEV_DAYS = [
    {dow:1,name:"Mon"},{dow:2,name:"Tue"},{dow:3,name:"Wed"},
    {dow:4,name:"Thu"},{dow:5,name:"Fri"},{dow:6,name:"Sat"},{dow:0,name:"Sun"}
  ];

  // Available market strengths for levothyroxine
  var LEV_MARKET = [25, 50, 75, 100]; // mcg

  function buildLevTab(refs) {
    var wrap = mk("div");

    // Pattern mode selector
    var patternModeSel = mk("select", { class: "eikon-select" });
    [["single","Single dose (every day the same)"],["alt2","Alternating 2 doses"],["alt3","Alternating 3 doses"]].forEach(function(p){
      var o = document.createElement("option"); o.value = p[0]; o.text = p[1]; patternModeSel.appendChild(o);
    });
    patternModeSel.value = "alt2";

    // Prescribed doses
    var weeksIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "12" });
    var d1In = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "100" });
    var d2In = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "125" });
    var d3In = mk("input", { class: "eikon-input", type: "number", min: "0", step: "1", placeholder: "Dose 3 (mcg)" });
    var splitSel = mk("select", { class: "eikon-select" });
    [["none","Whole tablets only"],["halves","Allow halves (½)"],["quarters","Allow halves & quarters (¼)"]].forEach(function(p){
      var o=document.createElement("option"); o.value=p[0]; o.text=p[1]; splitSel.appendChild(o);
    });
    splitSel.value = "none";

    // Wrapping divs so we can show/hide d2, d3, day grid
    var d2Field = mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Dose 2 (mcg)" }), d2In]);
    var d3Field = mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Dose 3 (mcg)" }), d3In]);
    var doseRow = mk("div", { class: "eikon-row" });
    doseRow.appendChild(mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Dose 1 (mcg)" }), d1In]));
    doseRow.appendChild(d2Field);
    doseRow.appendChild(d3Field);

    // Build day grid — each day picks prescribed Dose 1/2/3
    // Split into two rows: Mon–Thu (row 1) and Fri–Sun (row 2) to avoid horizontal scroll
    var daySelects = {};
    var dayGridWrap = mk("div");
    var dayRowTop = mk("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;" });
    var dayRowBottom = mk("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:8px;" });
    LEV_DAYS.forEach(function(d, idx) {
      var box = mk("div", { style: "border:1px solid var(--border);border-radius:10px;padding:8px;" });
      var dn = mk("div", { style: "font-weight:900;font-size:11px;text-transform:uppercase;margin-bottom:6px;", text: d.name });
      var sel = mk("select", { class: "eikon-select" });
      ["1","2","3"].forEach(function(v) {
        var opt = document.createElement("option");
        opt.value = v; opt.text = "Dose " + v;
        sel.appendChild(opt);
      });
      sel.value = (d.dow >= 1 && d.dow <= 5) ? "1" : "2";
      daySelects[d.dow] = sel;
      box.appendChild(dn); box.appendChild(sel);
      if (idx < 4) dayRowTop.appendChild(box); else dayRowBottom.appendChild(box);
    });
    dayGridWrap.appendChild(dayRowTop);
    dayGridWrap.appendChild(dayRowBottom);

    // Show/hide day grid section
    var dayGridSection = mk("div");
    dayGridSection.appendChild(mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Weekly Pattern — assign a dose to each day" }));
    dayGridSection.appendChild(dayGridWrap);
    dayGridSection.appendChild(mk("div", { class: "eikon-help", style: "margin-top:4px;", text: "For alternating patterns the day grid lets you assign which dose goes on which day." }));

    // Default day-dose assignments per mode
    var ALT2_DEFAULTS = {1:"1",2:"2",3:"1",4:"2",5:"1",6:"2",0:"1"}; // Mon–Sun alternating
    var ALT3_DEFAULTS = {1:"1",2:"2",3:"3",4:"1",5:"2",6:"3",0:"1"}; // Mon–Sun cycling 1-2-3

    var _prevMode = patternModeSel.value;
    function updatePatternUi() {
      var mode = patternModeSel.value;
      var modeChanged = mode !== _prevMode;
      _prevMode = mode;

      if (mode === "single") {
        d2Field.style.display = "none"; d3Field.style.display = "none"; dayGridSection.style.display = "none";
        LEV_DAYS.forEach(function(d) { if (daySelects[d.dow]) daySelects[d.dow].value = "1"; });
      } else if (mode === "alt2") {
        d2Field.style.display = ""; d3Field.style.display = "none"; dayGridSection.style.display = "";
        // Disable Dose 3 option in each select
        LEV_DAYS.forEach(function(d) {
          var sel = daySelects[d.dow]; if (!sel) return;
          sel.options[2].disabled = true;
          // Apply default pattern when switching to this mode, or fix invalid values
          if (modeChanged || sel.value === "3") sel.value = ALT2_DEFAULTS[d.dow];
        });
      } else { // alt3
        d2Field.style.display = ""; d3Field.style.display = ""; dayGridSection.style.display = "";
        LEV_DAYS.forEach(function(d) {
          var sel = daySelects[d.dow]; if (!sel) return;
          sel.options[2].disabled = false;
          if (modeChanged) sel.value = ALT3_DEFAULTS[d.dow];
        });
      }
    }
    patternModeSel.addEventListener("change", updatePatternUi);
    updatePatternUi();

    // Market box sizes per strength — correct defaults: 75mcg=90, others=28
    var LEV_BOX_DEFAULTS = {25:28, 50:28, 75:90, 100:28};
    var boxDefIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "28" });
    var marketBoxInputs = {}; // mcg → input element
    var marketBoxRow = mk("div", { class: "eikon-row" });
    LEV_MARKET.forEach(function(s) {
      var def = LEV_BOX_DEFAULTS[s] || 28;
      var inp = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: String(def) });
      marketBoxInputs[s] = inp;
      marketBoxRow.appendChild(mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: s + " mcg/box" }), inp]));
    });

    var calcBtn = mk("button", { class: "eikon-btn primary", text: "Calculate", type: "button" });
    var saveAndPrintBtn = mk("button", { class: "eikon-btn", text: "Save & Print", type: "button" });
    var clearBtn = mk("button", { class: "eikon-btn danger", text: "Clear", type: "button" });

    var resultBox = makeResultBox("lev-results");

    var inputCard = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;", text: "Levothyroxine Dosing" }),
      mk("div", { class: "eikon-help", text: "Market strengths: 25, 50, 75, 100 mcg. Enter the prescribed dose; the calculator works out the tablet combination." }),
      mk("div", { style: "height:10px;" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Duration (weeks)" }), weeksIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Pattern Mode" }), patternModeSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Allow splitting?" }), splitSel])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Prescribed Doses (mcg/day)" }),
      doseRow,
      dayGridSection,
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Market Pack Sizes (tablets/box)" }),
      mk("div", { style: "margin-bottom:4px;" }, [
        mk("div", { class: "eikon-row" }, [
          mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Default box size" }), boxDefIn]),
          mk("div", { class: "eikon-help", style: "align-self:flex-end;margin-bottom:6px;", text: "75 mcg boxes are 90 tabs; 25/50/100 mcg are 28 tabs by default." })
        ])
      ]),
      marketBoxRow,
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;" }, [calcBtn, saveAndPrintBtn, clearBtn])
    ]);

    wrap.appendChild(mk("div", { style: "display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;" }, [inputCard, resultBox]));

    function getStartDate() {
      var sd = refs.startDate();
      if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) return null;
      return new Date(sd + "T00:00:00");
    }

    function doCalc() {
      var weeks = parseIntSafe(weeksIn.value, 0);
      if (weeks <= 0) { setResultError("lev-results", "Enter a valid number of weeks."); return null; }
      var mode = patternModeSel.value;
      var d1 = parseNum(d1In.value);
      if (!Number.isFinite(d1) || d1 <= 0) { setResultError("lev-results", "Enter a valid Dose 1 value."); return null; }

      var prescribedDoses = [{ idx: 1, mcg: d1 }];

      if (mode !== "single") {
        var d2 = parseNum(d2In.value);
        if (!Number.isFinite(d2) || d2 <= 0) { setResultError("lev-results", "Enter a valid Dose 2 value."); return null; }
        prescribedDoses.push({ idx: 2, mcg: d2 });
      }
      if (mode === "alt3") {
        var d3raw = d3In.value.trim(), d3 = d3raw ? parseNum(d3raw) : NaN;
        if (!Number.isFinite(d3) || d3 <= 0) { setResultError("lev-results", "Enter a valid Dose 3 value for alternating 3-dose mode."); return null; }
        prescribedDoses.push({ idx: 3, mcg: d3 });
      }

      var startDate = getStartDate();
      if (!startDate) { setResultError("lev-results", "Enter a valid start date."); return null; }

      var splitting = splitSel.value;

      // Resolve each prescribed dose into market tablet combo
      var doseResolutions = {};
      for (var pi = 0; pi < prescribedDoses.length; pi++) {
        var pd = prescribedDoses[pi];
        var combo = findBestComboExact(pd.mcg, LEV_MARKET, splitting, 16);
        if (!combo.ok) {
          setResultError("lev-results", "Cannot represent " + pd.mcg + " mcg/day with available market strengths (25, 50, 75, 100 mcg)" + (splitting === "none" ? ". Try allowing halves or quarters." : "."));
          return null;
        }
        doseResolutions[pd.idx] = { mcg: pd.mcg, combo: combo };
      }

      var daysTotal = weeks * 7;
      var schedule = [];
      // Totals per market strength (mcg → {wholeCount, halfCount, quarterCount})
      var marketTotals = {};
      LEV_MARKET.forEach(function(s) { marketTotals[s] = { strength: s, wholeCount: 0, halfCount: 0, quarterCount: 0 }; });

      for (var i = 0; i < daysTotal; i++) {
        var date = addDays(startDate, i);
        var dow = date.getDay();
        var which;
        if (mode === "single") {
          which = 1;
        } else {
          which = parseIntSafe((daySelects[dow] && daySelects[dow].value) || "1", 1);
          // Clamp to available doses
          if (which > prescribedDoses.length) which = 1;
        }
        var res = doseResolutions[which] || doseResolutions[1];
        res.combo.items.forEach(function(it) {
          marketTotals[it.strength].wholeCount += it.wholeCount;
          marketTotals[it.strength].halfCount += it.halfCount;
          marketTotals[it.strength].quarterCount += (it.quarterCount || 0);
        });
        schedule.push({ date: date, dow: dow, doseIdx: which, mcg: res.mcg, comboItems: res.combo.items });
      }

      // Dispensing per market strength
      var dispensing = LEV_MARKET.map(function(s) {
        var mt = marketTotals[s];
        var wholes = mt.wholeCount;
        var halves = mt.halfCount; // each half = 0.5 tablet → ceil(halves/2) physical tablets
        var quarters = mt.quarterCount; // each quarter = 0.25 tablet → ceil(quarters/4) physical tablets
        var physicalTablets = wholes + Math.ceil(halves/2) + Math.ceil(quarters/4);
        if (physicalTablets === 0) return null;
        var boxSize = clamp(parseIntSafe(marketBoxInputs[s].value, parseIntSafe(boxDefIn.value, 30)), 1, 999999);
        var boxes = Math.ceil(physicalTablets / boxSize);
        return { strength: s, wholes: wholes, halves: halves, quarters: quarters, physicalTablets: physicalTablets, boxSize: boxSize, boxes: boxes, extra: boxes*boxSize - physicalTablets };
      }).filter(function(x){ return x !== null; });

      var model = { startDate: startDate, weeks: weeks, prescribedDoses: prescribedDoses, doseResolutions: doseResolutions, schedule: schedule, dispensing: dispensing };
      state.lastModels.lev = model;

      // Render prescribed-dose resolution summary
      var resHtml = prescribedDoses.map(function(pd) {
        var res = doseResolutions[pd.idx];
        var comboDesc = res.combo.items.length ? describeCombo(res.combo.items, "mcg") : "0 mcg";
        return "<tr><td><b>Dose " + pd.idx + ": " + formatStrength(pd.mcg) + " mcg</b></td><td>" + escHtml(comboDesc) + "</td></tr>";
      }).join("");

      var dispRows = dispensing.map(function(d) {
        var splitInfo = "";
        if (d.halves) splitInfo += " + " + d.halves + " halves";
        if (d.quarters) splitInfo += " + " + d.quarters + " quarters";
        return "<tr><td><b>" + formatStrength(d.strength) + " mcg</b></td><td>" + d.wholes + splitInfo + "</td><td>" + d.physicalTablets + "</td><td>" + d.boxSize + "</td><td>" + d.boxes + "</td><td>" + d.extra + "</td></tr>";
      }).join("");

      var preview = schedule.slice(0, 21).map(function(x) {
        var instParts = x.comboItems.map(function(it) {
          var s = "";
          if (it.wholeCount) s += it.wholeCount + "× " + formatStrength(it.strength) + " mcg";
          if (it.halfCount) s += (s?", ":"") + it.halfCount + "× ½ of " + formatStrength(it.strength) + " mcg";
          if (it.quarterCount) s += (s?", ":"") + it.quarterCount + "× ¼ of " + formatStrength(it.strength) + " mcg";
          return s;
        }).join(" + ") || "0 mcg";
        return "<tr><td>" + fmtDate(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.mcg) + " mcg</b></td><td>" + escHtml(instParts) + "</td></tr>";
      }).join("");
      var moreNote = schedule.length > 21 ? "<div class='eikon-help'><b>Preview:</b> first 21 days. Full plan on printout.</div>" : "";

      setResultHtml("lev-results",
        "<div style='font-weight:900;margin-bottom:6px;'>Prescription → Tablet Combination</div>" +
        "<table class='eikon-table'><thead><tr><th>Prescribed Dose</th><th>Tablet combination</th></tr></thead><tbody>" + resHtml + "</tbody></table>" +
        "<div style='font-weight:900;margin-top:10px;margin-bottom:6px;'>Market Strength Dispensing</div>" +
        "<table class='eikon-table'><thead><tr><th>Strength</th><th>Pieces needed</th><th>Physical tabs</th><th>Tabs/box</th><th>Boxes</th><th>Extra</th></tr></thead><tbody>" + dispRows + "</tbody></table>" +
        "<div style='font-weight:900;margin-top:10px;margin-bottom:6px;'>Plan Preview (first 21 days)</div>" +
        "<table class='eikon-table'><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets</th></tr></thead><tbody>" + preview + "</tbody></table>" + moreNote
      );
      return model;
    }

    function doPrint(model, refs2) {
      var m = model || state.lastModels.lev;
      if (!m) return;
      var rf = refs2 || refs;
      var resHtml = m.prescribedDoses.map(function(pd) {
        var res = m.doseResolutions[pd.idx];
        return "<tr><td><b>Dose " + pd.idx + ": " + formatStrength(pd.mcg) + " mcg</b></td><td>" + escHtml(describeCombo(res.combo.items, "mcg")) + "</td></tr>";
      }).join("");
      var dispRows = m.dispensing.map(function(d) {
        var splitInfo = "";
        if (d.halves) splitInfo += " + " + d.halves + " halves";
        if (d.quarters) splitInfo += " + " + d.quarters + " quarters";
        return "<tr><td><b>" + formatStrength(d.strength) + " mcg</b></td><td>" + d.wholes + splitInfo + "</td><td>" + d.physicalTablets + "</td><td>" + d.boxSize + "</td><td>" + d.boxes + "</td></tr>";
      }).join("");
      var schedRows = m.schedule.map(function(x) {
        var instParts = x.comboItems.map(function(it) {
          var s = "";
          if (it.wholeCount) s += it.wholeCount + "× " + formatStrength(it.strength) + " mcg";
          if (it.halfCount) s += (s?", ":"") + it.halfCount + "× ½ of " + formatStrength(it.strength) + " mcg";
          if (it.quarterCount) s += (s?", ":"") + it.quarterCount + "× ¼ of " + formatStrength(it.strength) + " mcg";
          return s;
        }).join(" + ") || "0 mcg";
        return "<tr><td>" + fmtDate(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.mcg) + " mcg</b></td><td>" + escHtml(instParts) + "</td></tr>";
      }).join("");
      var inner = "<div class='bt'>Prescription → Combination</div>" +
        "<table><thead><tr><th>Prescribed Dose</th><th>Tablets to use</th></tr></thead><tbody>" + resHtml + "</tbody></table>" +
        "<div class='bt'>Market Strength Dispensing</div>" +
        "<table><thead><tr><th>Strength</th><th>Pieces needed</th><th>Physical tabs</th><th>Tabs/box</th><th>Boxes</th></tr></thead><tbody>" + dispRows + "</tbody></table>" +
        "<div class='bt'>Daily Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Prescribed</th><th>Tablets to take</th></tr></thead><tbody>" + schedRows + "</tbody></table>";
      openPrintTabWithHtml(buildPrintHtml("Levothyroxine Dosing Plan", { pharmacyName: rf.pharmacyName(), patientName: rf.patientName(), idCard: rf.idCard(), note: rf.note() }, inner));
    }

    calcBtn.addEventListener("click", doCalc);
    saveAndPrintBtn.addEventListener("click", async function() { await doSaveAndPrint(refs, "lev", state.lastModels.lev, doPrint, doCalc); });
    clearBtn.addEventListener("click", function() {
      weeksIn.value = "12"; d1In.value = "100"; d2In.value = "125"; d3In.value = "";
      patternModeSel.value = "alt2"; splitSel.value = "none"; boxDefIn.value = "28";
      LEV_MARKET.forEach(function(s) { if (marketBoxInputs[s]) marketBoxInputs[s].value = String(LEV_BOX_DEFAULTS[s] || 28); });
      LEV_DAYS.forEach(function(d) { if (daySelects[d.dow]) daySelects[d.dow].value = (d.dow >= 1 && d.dow <= 5) ? "1" : "2"; });
      updatePatternUi();
      setResultHtml("lev-results", "<div class='eikon-help'>Click <b>Calculate</b> to see results.</div>");
      state.lastModels.lev = null;
    });

    return wrap;
  }

  // ─────────────────────────── PREDNISOLONE ──────────────────────────────────
  function createPredStepRow(doseMg, days) {
    var row = mk("div", { style: "display:grid;grid-template-columns:1.2fr 1fr 1.2fr 44px;gap:8px;align-items:end;margin-bottom:8px;" });
    var dIn = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.5", value: String(doseMg) });
    var dayIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: String(days) });
    var noteIn = mk("input", { class: "eikon-input", type: "text", placeholder: "Step note (optional)" });
    var delBtn = mk("button", { class: "eikon-btn danger", text: "×", type: "button", style: "width:44px;height:40px;" });
    delBtn.addEventListener("click", function() { row.remove(); });
    row.appendChild(mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Dose/day (mg)" }), dIn]));
    row.appendChild(mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Days" }), dayIn]));
    row.appendChild(mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Note" }), noteIn]));
    row.appendChild(mk("div", { style: "padding-top:20px;" }, [delBtn]));
    row._doseInput = dIn; row._daysInput = dayIn; row._noteInput = noteIn;
    return row;
  }

  function buildPredTab(refs) {
    var wrap = mk("div");
    var stepsContainer = mk("div");
    function setExampleSteps() {
      stepsContainer.innerHTML = "";
      [[30,5],[20,5],[10,5],[5,5]].forEach(function(s) { stepsContainer.appendChild(createPredStepRow(s[0],s[1])); });
    }
    setExampleSteps();

    var drugSel = mk("select", { class: "eikon-select" });
    ["Prednisolone","Prednisone"].forEach(function(n) { var o = document.createElement("option"); o.value = n; o.text = n; drugSel.appendChild(o); });
    var strengthsIn = mk("input", { class: "eikon-input", type: "text", value: "5,10,20" });
    var splitSel = mk("select", { class: "eikon-select" });
    [["none","Whole tablets only"],["halves","Allow halves (½)"],["quarters","Allow halves & quarters (¼)"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];splitSel.appendChild(o);});
    splitSel.value = "halves";
    var policySel = mk("select", { class: "eikon-select" });
    [["optimize","Optimize (use available strengths)"],["only5","Use 5mg only (20mg out of stock)"],["only20_5","Use 20mg + 5mg only (other strengths unavailable)"]].forEach(function(p) { var o = document.createElement("option"); o.value=p[0]; o.text=p[1]; policySel.appendChild(o); });
    var maxTabsIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "12" });
    var tabsPerBoxIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "30" });
    var roundBoxesSel = mk("select", { class: "eikon-select" });
    [["yes","Yes (whole boxes)"],["no","No (exact)"]].forEach(function(p) { var o = document.createElement("option"); o.value=p[0]; o.text=p[1]; roundBoxesSel.appendChild(o); });

    var addStepBtn = mk("button", { class: "eikon-btn", text: "Add Step", type: "button" });
    var resetBtn = mk("button", { class: "eikon-btn danger", text: "Reset to Example", type: "button" });
    var calcBtn = mk("button", { class: "eikon-btn primary", text: "Calculate", type: "button" });
    var saveAndPrintBtn = mk("button", { class: "eikon-btn", text: "Save & Print", type: "button" });
    var clearBtn = mk("button", { class: "eikon-btn danger", text: "Clear", type: "button" });

    addStepBtn.addEventListener("click", function() { stepsContainer.appendChild(createPredStepRow(5,5)); });
    resetBtn.addEventListener("click", setExampleSteps);

    var resultBox = makeResultBox("pred-results");
    var inputCard = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;", text: "Prednisolone / Prednisone Taper" }),
      mk("div", { style: "height:8px;" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Drug name" }), drugSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Max tablets/day" }), maxTabsIn])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Taper Steps" }),
      stepsContainer,
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px;" }, [addStepBtn, resetBtn]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Tablet Options" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Strengths (mg, comma-separated)" }), strengthsIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Allow splitting?" }), splitSel])
      ]),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Stock availability" }), policySel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Tabs per box" }), tabsPerBoxIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Round to boxes?" }), roundBoxesSel])
      ]),
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;" }, [calcBtn, saveAndPrintBtn, clearBtn])
    ]);

    wrap.appendChild(mk("div", { style: "display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;" }, [inputCard, resultBox]));

    function getStartDate() {
      var sd = refs.startDate();
      if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) return null;
      return new Date(sd + "T00:00:00");
    }

    function doCalc() {
      var startDate = getStartDate();
      if (!startDate) { setResultError("pred-results", "Enter a valid start date."); return null; }
      var drug = drugSel.value || "Prednisolone";
      var steps = Array.from(stepsContainer.children).map(function(node) {
        return { doseMg: parseNum(node._doseInput.value), days: parseIntSafe(node._daysInput.value,0), note: node._noteInput.value.trim() };
      });
      if (!steps.length) { setResultError("pred-results", "Add at least one taper step."); return null; }
      for (var i = 0; i < steps.length; i++) {
        if (!Number.isFinite(steps[i].doseMg) || steps[i].doseMg < 0) { setResultError("pred-results", "Step " + (i+1) + " dose is invalid."); return null; }
        if (!Number.isFinite(steps[i].days) || steps[i].days <= 0) { setResultError("pred-results", "Step " + (i+1) + " days must be positive."); return null; }
      }
      var allowHalves = splitSel.value === "halves" || splitSel.value === "quarters";
      var splitting = splitSel.value;
      var policy = policySel.value;
      var maxTabs = clamp(parseIntSafe(maxTabsIn.value,12),1,50);
      var strengths = normalizeStrengthList(strengthsIn.value);
      if (policy === "only5") strengths = [5];
      if (policy === "only20_5") strengths = [5, 20];
      if (!strengths.length) { setResultError("pred-results", "Enter at least one tablet strength."); return null; }

      var stepPlans = [], totals = {};
      strengths.forEach(function(s) { totals[Number(roundFixed(s,4))] = { strength:s, wholePieces:0, halfPieces:0, quarterPieces:0 }; });
      var cursor = new Date(startDate.getTime());

      for (var si = 0; si < steps.length; si++) {
        var st = steps[si];
        var combo = (st.doseMg === 0) ? { ok:true, sum:0, items:[] } : findBestComboExact(st.doseMg, strengths, splitting, maxTabs);
        if (!combo.ok) { setResultError("pred-results", "Cannot represent " + st.doseMg + " mg/day with given strengths. Try allowing halves/quarters or adjusting strengths."); return null; }
        combo.items.forEach(function(it) {
          var key = Number(roundFixed(it.strength,4));
          if (!totals[key]) totals[key] = { strength:it.strength, wholePieces:0, halfPieces:0, quarterPieces:0 };
          totals[key].wholePieces += it.wholeCount * st.days;
          totals[key].halfPieces += it.halfCount * st.days;
          totals[key].quarterPieces += (it.quarterCount || 0) * st.days;
        });
        var stepStart = new Date(cursor.getTime());
        var stepEnd = addDays(stepStart, st.days-1);
        cursor = addDays(stepEnd, 1);
        stepPlans.push({ stepNumber:si+1, doseMg:st.doseMg, days:st.days, note:st.note, start:stepStart, end:stepEnd, comboItems:combo.items });
      }

      var totalRows = Object.values(totals).filter(function(x){ return x.wholePieces+x.halfPieces+x.quarterPieces > 0; })
        .sort(function(a,b){ return b.strength-a.strength; })
        .map(function(x) {
          return { strength:x.strength, wholePieces:x.wholePieces, halfPieces:x.halfPieces, quarterPieces:x.quarterPieces, tabletsToDispense:x.wholePieces+Math.ceil(x.halfPieces/2)+Math.ceil(x.quarterPieces/4) };
        });
      var tabsPerBox = clamp(parseIntSafe(tabsPerBoxIn.value,30),1,999999);
      var roundBoxes = roundBoxesSel.value === "yes";
      var totalAll = totalRows.reduce(function(a,r){ return a+r.tabletsToDispense; }, 0);
      var boxes = roundBoxes ? Math.ceil(totalAll/tabsPerBox) : null;

      var model = { drug:drug, startDate:startDate, strengths:strengths, splitting:splitting, stepPlans:stepPlans, totalRows:totalRows, tabsPerBox:tabsPerBox, roundBoxes:roundBoxes, totalDispensedTabsAll:totalAll, boxes:boxes };
      state.lastModels.pred = model;

      var stepRowsHtml = stepPlans.map(function(sp) {
        var comboText = sp.comboItems.length === 0 ? "Stop (0 mg)" : "Take " + describeCombo(sp.comboItems, "mg") + " once daily";
        var noteHtml = sp.note ? "<div class='eikon-help'><b>Note:</b> " + escHtml(sp.note) + "</div>" : "";
        return "<tr><td><b>Step " + sp.stepNumber + "</b></td><td>" + fmtDate(sp.start) + " → " + fmtDate(sp.end) + "<br><small>(" + sp.days + " days)</small></td><td><b>" + formatStrength(sp.doseMg) + " mg/day</b><br>" + escHtml(comboText) + noteHtml + "</td></tr>";
      }).join("");
      var totHtml = totalRows.length ? totalRows.map(function(r) {
        var qInfo = r.quarterPieces ? " + " + r.quarterPieces + "q" : "";
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + qInfo + "</td><td><b>" + r.tabletsToDispense + "</b></td></tr>";
      }).join("") : "<tr><td colspan='4'>No tablets required.</td></tr>";
      var boxLine = roundBoxes ? "<div class='eikon-help'><b>Boxes:</b> " + totalAll + " total tablets → <b>" + boxes + "</b> " + plural(boxes,"box","boxes") + " (" + tabsPerBox + " per box)</div>" : "";

      setResultHtml("pred-results",
        "<div style='font-weight:900;margin-bottom:6px;'>Taper Schedule</div>" +
        "<table class='eikon-table'><thead><tr><th>Step</th><th>Date range</th><th>Daily instruction</th></tr></thead><tbody>" + stepRowsHtml + "</tbody></table>" +
        "<div style='font-weight:900;margin-top:10px;margin-bottom:6px;'>Tablets to Dispense</div>" +
        "<table class='eikon-table'><thead><tr><th>Strength</th><th>Whole tabs</th><th>Half pieces</th><th>Tablets to dispense</th></tr></thead><tbody>" + totHtml + "</tbody></table>" + boxLine
      );
      return model;
    }

    function doPrint(model, refs2) {
      var m = model || state.lastModels.pred;
      if (!m) return;
      var rf = refs2 || refs;
      var stepRowsHtml = m.stepPlans.map(function(sp) {
        var comboText = sp.comboItems.length === 0 ? "<b>Stop (0 mg)</b>" : "<b>Take once daily:</b> " + describeCombo(sp.comboItems, "mg");
        var noteHtml = sp.note ? "<div><b>Note:</b> " + escHtml(sp.note) + "</div>" : "";
        return "<tr><td><b>Step " + sp.stepNumber + "</b></td><td>" + fmtDate(sp.start) + " → " + fmtDate(sp.end) + " (" + sp.days + " days)</td><td><b>" + formatStrength(sp.doseMg) + " mg/day</b><br>" + comboText + noteHtml + "</td></tr>";
      }).join("");
      var totHtml = m.totalRows.map(function(r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + "</td><td><b>" + r.tabletsToDispense + "</b></td></tr>";
      }).join("") || "<tr><td colspan='4'>No tablets required.</td></tr>";
      var boxLine = m.roundBoxes ? "<div><b>Box rounding:</b> " + m.totalDispensedTabsAll + " total → " + m.boxes + " " + plural(m.boxes,"box","boxes") + " (" + m.tabsPerBox + " per box)</div>" : "";
      var inner = "<div class='bt'>Taper Schedule</div>" +
        "<table><thead><tr><th>Step</th><th>Date range</th><th>Daily instruction</th></tr></thead><tbody>" + stepRowsHtml + "</tbody></table>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Strength</th><th>Whole tablets</th><th>Half pieces</th><th>To dispense</th></tr></thead><tbody>" + totHtml + "</tbody></table>" + boxLine;
      openPrintTabWithHtml(buildPrintHtml(m.drug + " Taper Plan", { pharmacyName: rf.pharmacyName(), patientName: rf.patientName(), idCard: rf.idCard(), note: rf.note() }, inner));
    }

    calcBtn.addEventListener("click", doCalc);
    saveAndPrintBtn.addEventListener("click", async function() { await doSaveAndPrint(refs, "pred", state.lastModels.pred, doPrint, doCalc); });
    clearBtn.addEventListener("click", function() {
      setExampleSteps();
      strengthsIn.value = "5,10,20"; splitSel.value = "halves"; policySel.value = "optimize";
      maxTabsIn.value = "12"; tabsPerBoxIn.value = "30"; roundBoxesSel.value = "yes";
      setResultHtml("pred-results", "<div class='eikon-help'>Click <b>Calculate</b> to see results.</div>");
      state.lastModels.pred = null;
    });

    return wrap;
  }

  // ─────────────────────────── WARFARIN ──────────────────────────────────────
  function buildWarTab(refs) {
    var wrap = mk("div");

    var weeksIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "4" });
    var modeSel = mk("select", { class: "eikon-select" });
    [["weekly","Weekly pattern (Mon–Sun)"],["cycle","Cycle pattern (repeating list)"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];modeSel.appendChild(o);});
    var halvesAllowSel = mk("select", { class: "eikon-select" });
    [["none","Whole tablets only"],["halves","Allow halves (½)"],["quarters","Allow halves & quarters (¼)"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];halvesAllowSel.appendChild(o);});
    halvesAllowSel.value = "halves";

    // Weekly day grid — split into 2 rows to avoid horizontal scrolling
    var warDaySelects = {};
    var weeklyWrap = mk("div");
    var warDays = [{dow:1,name:"Mon"},{dow:2,name:"Tue"},{dow:3,name:"Wed"},{dow:4,name:"Thu"},{dow:5,name:"Fri"},{dow:6,name:"Sat"},{dow:0,name:"Sun"}];
    var dayGridRow1 = mk("div", { style: "display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:8px;" });
    var dayGridRow2 = mk("div", { style: "display:grid;grid-template-columns:repeat(3,1fr);gap:8px;" });
    var defaults = {1:"5",2:"2.5",3:"5",4:"2.5",5:"5",6:"2.5",0:"5"};
    warDays.forEach(function(d,i){
      var box = mk("div", { style: "border:1px solid var(--border);border-radius:10px;padding:8px;" });
      var dn = mk("div", { style: "font-weight:900;font-size:11px;text-transform:uppercase;margin-bottom:4px;", text: d.name });
      var inp = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.25", value: defaults[d.dow] || "0" });
      warDaySelects[d.dow] = inp;
      box.appendChild(dn); box.appendChild(inp);
      if (i < 4) dayGridRow1.appendChild(box); else dayGridRow2.appendChild(box);
    });
    weeklyWrap.appendChild(mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin:8px 0 6px;", text: "Weekly Doses (mg per day)" }));
    weeklyWrap.appendChild(dayGridRow1);
    weeklyWrap.appendChild(dayGridRow2);

    var cycleWrap = mk("div", { style: "display:none;" });
    var cycleIn = mk("input", { class: "eikon-input", type: "text", value: "5,2.5" });
    cycleWrap.appendChild(mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;margin:8px 0 6px;", text: "Cycle (comma-separated doses)" }));
    cycleWrap.appendChild(cycleIn);
    cycleWrap.appendChild(mk("div", { class: "eikon-help", text: "e.g. 5,2.5 (alternating) or 5,5,2.5 (3-day cycle)" }));

    modeSel.addEventListener("change", function() {
      var m = modeSel.value;
      weeklyWrap.style.display = m === "weekly" ? "" : "none";
      cycleWrap.style.display = m === "cycle" ? "" : "none";
    });

    var strengthsIn = mk("input", { class: "eikon-input", type: "text", value: "1,3,5" });
    var maxTabsIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "8" });

    // Packaging table
    var packTableDiv = mk("div");
    var packData = {}; // strength -> { tabsPerSheet, sheetsPerBox }

    function buildPackTable() {
      packTableDiv.innerHTML = "";
      var strengths = normalizeStrengthList(strengthsIn.value);
      if (!strengths.length) return;
      strengths.forEach(function(s) {
        var key = String(roundFixed(s,4));
        if (!packData[key]) packData[key] = { tabsPerSheet: 14, sheetsPerBox: 2 };
      });
      var rows = strengths.map(function(s) {
        var key = String(roundFixed(s,4));
        var d = packData[key];
        var tpsIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: String(d.tabsPerSheet) });
        var spbIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: String(d.sheetsPerBox) });
        tpsIn.addEventListener("change", function() { packData[key].tabsPerSheet = clamp(parseIntSafe(tpsIn.value,14),1,9999); });
        spbIn.addEventListener("change", function() { packData[key].sheetsPerBox = clamp(parseIntSafe(spbIn.value,2),1,9999); });
        var tr = mk("tr");
        tr.appendChild(mk("td", { html: "<b>" + formatStrength(s) + " mg</b>" }));
        tr.appendChild(mk("td", {}, [tpsIn]));
        tr.appendChild(mk("td", {}, [spbIn]));
        return tr;
      });
      var table = mk("table", { class: "eikon-table" });
      table.appendChild(mk("thead", {}, [mk("tr", {}, [mk("th",{text:"Strength"}),mk("th",{text:"Tabs/sheet"}),mk("th",{text:"Sheets/box"})])]));
      var tbody = mk("tbody");
      rows.forEach(function(r){ tbody.appendChild(r); });
      table.appendChild(tbody);
      packTableDiv.appendChild(table);
    }
    buildPackTable();

    var refreshPackBtn = mk("button", { class: "eikon-btn", text: "Refresh Pack Table", type: "button" });
    refreshPackBtn.addEventListener("click", buildPackTable);

    var calcBtn = mk("button", { class: "eikon-btn primary", text: "Calculate", type: "button" });
    var saveAndPrintBtn = mk("button", { class: "eikon-btn", text: "Save & Print", type: "button" });
    var clearBtn = mk("button", { class: "eikon-btn danger", text: "Clear", type: "button" });

    var resultBox = makeResultBox("war-results");
    var inputCard = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;", text: "Warfarin Variable Dosing" }),
      mk("div", { style: "height:8px;" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Duration (weeks)" }), weeksIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Pattern Mode" }), modeSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Allow splitting?" }), halvesAllowSel])
      ]),
      weeklyWrap,
      cycleWrap,
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Tablet Strengths" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Strengths (mg, comma-separated)" }), strengthsIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Max tablets/dose" }), maxTabsIn])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Packaging (blister packs)" }),
      packTableDiv,
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin:8px 0;" }, [refreshPackBtn]),
      mk("div", { style: "border:2px solid var(--border);border-radius:10px;padding:8px;font-weight:800;font-size:12px;", text: "WARFARIN SAFETY: This is a variable dosing schedule. If INR clinic updates the dose, this plan must be updated." }),
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;" }, [calcBtn, saveAndPrintBtn, clearBtn])
    ]);

    wrap.appendChild(mk("div", { style: "display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;" }, [inputCard, resultBox]));

    function getStartDate() {
      var sd = refs.startDate();
      if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) return null;
      return new Date(sd + "T00:00:00");
    }

    function doCalc() {
      var startDate = getStartDate();
      if (!startDate) { setResultError("war-results", "Enter a valid start date."); return null; }
      var weeks = parseIntSafe(weeksIn.value, 0);
      if (weeks <= 0) { setResultError("war-results", "Enter a valid number of weeks."); return null; }
      var strengths = normalizeStrengthList(strengthsIn.value);
      if (!strengths.length) { setResultError("war-results", "Enter at least one tablet strength."); return null; }
      var splitting = halvesAllowSel.value;
      var maxTabs = clamp(parseIntSafe(maxTabsIn.value,8),1,30);
      var daysTotal = weeks * 7;

      // Get dose pattern
      var getDayDose;
      var mode = modeSel.value;
      if (mode === "weekly") {
        var dosesByDow = {};
        [0,1,2,3,4,5,6].forEach(function(d) { dosesByDow[d] = parseNum(warDaySelects[d].value); });
        getDayDose = function(i) { var dt = addDays(startDate,i); return { date:dt, dow:dt.getDay(), doseMg:dosesByDow[dt.getDay()] }; };
      } else {
        var cycle = String(cycleIn.value||"").split(",").map(function(s){ return s.trim(); }).filter(Boolean)
          .map(function(p){ var n = parseNum(p); return Number.isFinite(n)&&n>=0?n:null; }).filter(function(x){ return x!==null; });
        if (!cycle.length) { setResultError("war-results", "Cycle pattern is empty. Enter doses like 5,2.5."); return null; }
        getDayDose = function(i) { var dt = addDays(startDate,i); return { date:dt, dow:dt.getDay(), doseMg:cycle[i%cycle.length] }; };
      }

      var schedule = [];
      var totals = {};
      strengths.forEach(function(s){ totals[Number(roundFixed(s,4))] = { strength:s, wholePieces:0, halfPieces:0, quarterPieces:0 }; });

      for (var i = 0; i < daysTotal; i++) {
        var day = getDayDose(i);
        if (!Number.isFinite(day.doseMg) || day.doseMg < 0) { setResultError("war-results", "Invalid dose on " + fmtDate(day.date)); return null; }
        var combo = day.doseMg === 0 ? { ok:true, sum:0, items:[] } : findBestComboExact(day.doseMg, strengths, splitting, maxTabs);
        if (!combo.ok) { setResultError("war-results", "Cannot represent " + day.doseMg + " mg on " + fmtDate(day.date) + " with given strengths."); return null; }
        combo.items.forEach(function(it) {
          var key = Number(roundFixed(it.strength,4));
          if (!totals[key]) totals[key] = { strength:it.strength, wholePieces:0, halfPieces:0, quarterPieces:0 };
          totals[key].wholePieces += it.wholeCount;
          totals[key].halfPieces += it.halfCount;
          totals[key].quarterPieces += (it.quarterCount || 0);
        });
        schedule.push({ date:day.date, dow:day.dow, doseMg:day.doseMg, items:combo.items });
      }

      var dispByStrength = Object.values(totals).filter(function(x){ return x.wholePieces+x.halfPieces+x.quarterPieces>0; })
        .sort(function(a,b){ return b.strength-a.strength; })
        .map(function(x) {
          var tabletsDispense = x.wholePieces + Math.ceil(x.halfPieces/2) + Math.ceil(x.quarterPieces/4);
          var key = String(roundFixed(x.strength,4));
          var pack = packData[key] || { tabsPerSheet:14, sheetsPerBox:2 };
          var tps = clamp(parseIntSafe(pack.tabsPerSheet,14),1,999999);
          var spb = clamp(parseIntSafe(pack.sheetsPerBox,2),1,999999);
          var sheets = Math.ceil(tabletsDispense/tps);
          var boxes = Math.ceil(sheets/spb);
          return { strength:x.strength, wholePieces:x.wholePieces, halfPieces:x.halfPieces, quarterPieces:x.quarterPieces, tabletsDispense:tabletsDispense, tabsPerSheet:tps, sheetsPerBox:spb, sheetsNeeded:sheets, boxesNeeded:boxes };
        });

      var model = { startDate:startDate, weeks:weeks, daysTotal:daysTotal, schedule:schedule, dispByStrength:dispByStrength };
      state.lastModels.war = model;

      var dispRows = dispByStrength.length ? dispByStrength.map(function(r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + "</td><td><b>" + r.tabletsDispense + "</b></td><td>" + r.tabsPerSheet + "</td><td>" + r.sheetsNeeded + "</td><td>" + r.sheetsPerBox + "</td><td><b>" + r.boxesNeeded + "</b></td></tr>";
      }).join("") : "<tr><td colspan='8'>No tablets required (all doses are 0).</td></tr>";
      var preview = schedule.slice(0,14).map(function(x) {
        var inst = x.items.length === 0 ? "<b>0 mg</b>" : comboToPatientSentence(x.items);
        return "<tr><td>" + fmtDate(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.doseMg) + " mg</b></td><td>" + inst + "</td></tr>";
      }).join("");
      var more = schedule.length > 14 ? "<div class='eikon-help'>Preview: first 14 days. Full plan on printout.</div>" : "";

      setResultHtml("war-results",
        "<div style='font-weight:900;margin-bottom:6px;'>Dispensing Summary</div>" +
        "<div class='eikon-table-wrap'><table class='eikon-table'><thead><tr><th>Strength</th><th>Whole tabs</th><th>Half pieces</th><th>Tabs to dispense</th><th>Tabs/sheet</th><th>Sheets needed</th><th>Sheets/box</th><th>Boxes</th></tr></thead><tbody>" + dispRows + "</tbody></table></div>" +
        "<div style='font-weight:900;margin-top:10px;margin-bottom:6px;'>Plan Preview</div>" +
        "<div class='eikon-table-wrap'><table class='eikon-table'><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets</th></tr></thead><tbody>" + preview + "</tbody></table></div>" + more
      );
      return model;
    }

    function doPrint(model, refs2) {
      var m = model || state.lastModels.war;
      if (!m) return;
      var rf = refs2 || refs;
      var dispRows = m.dispByStrength.map(function(r) {
        return "<tr><td><b>" + formatStrength(r.strength) + " mg</b></td><td>" + r.wholePieces + "</td><td>" + r.halfPieces + "</td><td><b>" + r.tabletsDispense + "</b></td><td>" + r.tabsPerSheet + "</td><td>" + r.sheetsNeeded + "</td><td>" + r.sheetsPerBox + "</td><td><b>" + r.boxesNeeded + "</b></td></tr>";
      }).join("") || "<tr><td colspan='8'>No tablets required.</td></tr>";
      var schedRows = m.schedule.map(function(x) {
        var inst = x.items.length === 0 ? "<b>0 mg — no tablets</b>" : "<b>" + comboToPatientSentence(x.items) + "</b>";
        return "<tr><td>" + fmtDate(x.date) + "</td><td>" + DOW[x.dow] + "</td><td><b>" + formatStrength(x.doseMg) + " mg</b></td><td>" + inst + "</td></tr>";
      }).join("");
      var inner = "<div class='warn'>WARFARIN SAFETY NOTE: Follow this schedule exactly unless prescriber/INR clinic changes it. If dose changes, update this plan.</div>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Strength</th><th>Whole tabs</th><th>Half pieces</th><th>To dispense</th><th>Tabs/sheet</th><th>Sheets needed</th><th>Sheets/box</th><th>Boxes</th></tr></thead><tbody>" + dispRows + "</tbody></table>" +
        "<div class='bt'>Patient Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets to take</th></tr></thead><tbody>" + schedRows + "</tbody></table>";
      openPrintTabWithHtml(buildPrintHtml("Warfarin Dosing Plan (Variable Schedule)", { pharmacyName: rf.pharmacyName(), patientName: rf.patientName(), idCard: rf.idCard(), note: rf.note() }, inner));
    }

    calcBtn.addEventListener("click", doCalc);
    saveAndPrintBtn.addEventListener("click", async function() { await doSaveAndPrint(refs, "war", state.lastModels.war, doPrint, doCalc); });
    clearBtn.addEventListener("click", function() {
      weeksIn.value = "4"; modeSel.value = "weekly"; halvesAllowSel.value = "halves";
      cycleIn.value = "5,2.5"; strengthsIn.value = "1,3,5"; maxTabsIn.value = "8"; preferSel.value = "simple";
      [{dow:1,v:"5"},{dow:2,v:"2.5"},{dow:3,v:"5"},{dow:4,v:"2.5"},{dow:5,v:"5"},{dow:6,v:"2.5"},{dow:0,v:"5"}].forEach(function(d){ if(warDaySelects[d.dow]) warDaySelects[d.dow].value=d.v; });
      weeklyWrap.style.display = ""; cycleWrap.style.display = "none";
      buildPackTable();
      setResultHtml("war-results", "<div class='eikon-help'>Click <b>Calculate</b> to see results.</div>");
      state.lastModels.war = null;
    });

    return wrap;
  }

  // ─────────────────────────── INSULIN ───────────────────────────────────────
  function buildInsTab(refs) {
    var wrap = mk("div");

    var weeksIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "4" });
    var morningIn = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.5", value: "0" });
    var afternoonIn = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.5", value: "0" });
    var eveningIn = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.5", value: "0" });
    var nightIn = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.5", value: "0" });
    var containerTypeSel = mk("select", { class: "eikon-select" });
    [["pen","Cartridge/Pen (e.g. 300u)"],["vial","Vial (e.g. 1000u)"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];containerTypeSel.appendChild(o);});
    var unitsPerContIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "300" });
    var contsPerBoxIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "5" });
    var roundBoxesSel = mk("select", { class: "eikon-select" });
    [["yes","Yes (whole boxes)"],["no","No (exact)"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];roundBoxesSel.appendChild(o);});
    var includePrimingSel = mk("select", { class: "eikon-select" });
    [["yes","Yes"],["no","No"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];includePrimingSel.appendChild(o);});
    var primeUnitsIn = mk("input", { class: "eikon-input", type: "number", min: "0", step: "0.5", value: "2" });
    var includeDiscardSel = mk("select", { class: "eikon-select" });
    [["yes","Yes"],["no","No"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];includeDiscardSel.appendChild(o);});
    var discardDaysIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "28" });

    containerTypeSel.addEventListener("change", function() {
      if (containerTypeSel.value === "pen") { unitsPerContIn.value = "300"; contsPerBoxIn.value = "5"; }
      else { unitsPerContIn.value = "1000"; contsPerBoxIn.value = "1"; }
    });

    var calcBtn = mk("button", { class: "eikon-btn primary", text: "Calculate", type: "button" });
    var saveAndPrintBtn = mk("button", { class: "eikon-btn", text: "Save & Print", type: "button" });
    var clearBtn = mk("button", { class: "eikon-btn danger", text: "Clear", type: "button" });

    var resultBox = makeResultBox("ins-results");
    var inputCard = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;", text: "Insulin Supply Calculator" }),
      mk("div", { style: "height:8px;" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Duration (weeks)" }), weeksIn])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Daily Dose (units)" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Morning" }), morningIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Afternoon" }), afternoonIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Evening" }), eveningIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Night" }), nightIn])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Device / Container" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Container type" }), containerTypeSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Units per container" }), unitsPerContIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Containers per box" }), contsPerBoxIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Round to boxes?" }), roundBoxesSel])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Wastage Rules" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Include priming?" }), includePrimingSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Priming units/injection" }), primeUnitsIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Include discard rule?" }), includeDiscardSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Discard after (days)" }), discardDaysIn])
      ]),
      mk("div", { style: "border:2px solid var(--border);border-radius:10px;padding:8px;font-weight:800;font-size:12px;", text: "INSULIN NOTE: This is a supply estimator. Always apply the product's storage and discard instructions." }),
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;" }, [calcBtn, saveAndPrintBtn, clearBtn])
    ]);

    wrap.appendChild(mk("div", { style: "display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;" }, [inputCard, resultBox]));

    function getStartDate() {
      var sd = refs.startDate();
      if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) return null;
      return new Date(sd + "T00:00:00");
    }

    function doCalc() {
      var startDate = getStartDate();
      if (!startDate) { setResultError("ins-results", "Enter a valid start date."); return null; }
      var weeks = parseIntSafe(weeksIn.value, 0);
      if (weeks <= 0) { setResultError("ins-results", "Enter a valid number of weeks."); return null; }
      var daysTotal = weeks * 7;
      var doses = { morning: parseNum(morningIn.value), afternoon: parseNum(afternoonIn.value), evening: parseNum(eveningIn.value), night: parseNum(nightIn.value) };
      for (var k in doses) { if (!Number.isFinite(doses[k]) || doses[k] < 0) { setResultError("ins-results", "All dose fields must be valid non-negative numbers."); return null; } }
      var dailyUnits = doses.morning + doses.afternoon + doses.evening + doses.night;
      var injectionsPerDay = [doses.morning, doses.afternoon, doses.evening, doses.night].filter(function(x){ return x > 0; }).length;
      var type = containerTypeSel.value;
      var unitsPerContainer = parseIntSafe(unitsPerContIn.value, 0);
      if (unitsPerContainer <= 0) { setResultError("ins-results", "Units per container must be positive."); return null; }
      var containersPerBox = parseIntSafe(contsPerBoxIn.value, 0);
      if (containersPerBox <= 0) { setResultError("ins-results", "Containers per box must be positive."); return null; }
      var includePriming = includePrimingSel.value === "yes";
      var primeUnits = parseNum(primeUnitsIn.value);
      var includeDiscard = includeDiscardSel.value === "yes";
      var discardDays = parseIntSafe(discardDaysIn.value, 0);
      var roundToBoxes = roundBoxesSel.value === "yes";
      var dailyPriming = includePriming ? primeUnits * injectionsPerDay : 0;
      var dailyTotalUsed = dailyUnits + dailyPriming;
      var totalUnitsNeededNoWaste = dailyUnits * daysTotal;
      var totalPrimingUnits = dailyPriming * daysTotal;

      var containersUsed = 0, wastedFromDiscard = 0, remaining = 0, openedDayIndex = 0;
      function openNew(dayIdx) { containersUsed++; remaining = unitsPerContainer; openedDayIndex = dayIdx; }
      if (dailyTotalUsed > 0) openNew(0);

      for (var day = 0; day < daysTotal && dailyTotalUsed > 0; day++) {
        if (includeDiscard && (day - openedDayIndex) >= discardDays) { wastedFromDiscard += remaining; openNew(day); }
        var need = dailyTotalUsed;
        while (need > 0) {
          if (need <= remaining) { remaining -= need; need = 0; }
          else { need -= remaining; remaining = 0; openNew(day); }
        }
      }
      // Post-loop: if discard rule applies and the last open container has been in use
      // for >= discardDays, its remaining units are waste (would be discarded on use day daysTotal)
      if (includeDiscard && dailyTotalUsed > 0 && (daysTotal - openedDayIndex) >= discardDays) {
        wastedFromDiscard += remaining;
        remaining = 0;
      }

      var boxesNeeded = roundToBoxes ? Math.ceil(containersUsed / containersPerBox) : null;
      var model = { startDate:startDate, weeks:weeks, daysTotal:daysTotal, doses:doses, dailyUnits:dailyUnits, injectionsPerDay:injectionsPerDay, type:type, unitsPerContainer:unitsPerContainer, containersPerBox:containersPerBox, includePriming:includePriming, primeUnits:primeUnits, includeDiscard:includeDiscard, discardDays:discardDays, dailyPriming:dailyPriming, dailyTotalUsed:dailyTotalUsed, totalUnitsNeededNoWaste:totalUnitsNeededNoWaste, totalPrimingUnits:totalPrimingUnits, containersUsed:containersUsed, wastedFromDiscard:wastedFromDiscard, leftoverUnitsAtEnd:remaining, roundToBoxes:roundToBoxes, boxesNeeded:boxesNeeded };
      state.lastModels.ins = model;

      var typeLabel = type === "pen" ? "Cartridge/Pen" : "Vial";
      var primeLine = includePriming ? "<b>Priming included:</b> " + formatStrength(primeUnits) + " units/injection × " + injectionsPerDay + " injection(s)/day = " + formatStrength(dailyPriming) + " units/day" : "Priming not included.";
      var discardLine = includeDiscard ? "<b>Discard rule:</b> discard after " + discardDays + " days from first use" : "Discard rule not included.";
      var boxLine = roundToBoxes ? "<tr><td>Boxes to dispense</td><td><b>" + boxesNeeded + "</b> (" + containersPerBox + " containers/box)</td></tr>" : "";
      setResultHtml("ins-results",
        "<div class='eikon-help'><b>Date range:</b> " + fmtDate(startDate) + " → " + fmtDate(addDays(startDate, daysTotal-1)) + " (" + weeks + " weeks)</div>" +
        "<div class='eikon-help'>" + primeLine + "</div><div class='eikon-help'>" + discardLine + "</div>" +
        "<table class='eikon-table'><tbody>" +
        "<tr><td>Container type</td><td><b>" + typeLabel + "</b></td></tr>" +
        "<tr><td>Units per container</td><td><b>" + unitsPerContainer + "</b> units</td></tr>" +
        "<tr><td>Containers required</td><td><b>" + containersUsed + "</b></td></tr>" + boxLine +
        "<tr><td>Units needed (dose only)</td><td><b>" + formatStrength(totalUnitsNeededNoWaste) + "</b> units</td></tr>" +
        "<tr><td>Units for priming</td><td><b>" + formatStrength(totalPrimingUnits) + "</b> units</td></tr>" +
        "<tr><td>Units wasted (discard)</td><td><b>" + formatStrength(wastedFromDiscard) + "</b> units</td></tr>" +
        "<tr><td>Leftover at end</td><td><b>" + formatStrength(remaining) + "</b> units</td></tr>" +
        "</tbody></table>"
      );
      return model;
    }

    function doPrint(model, refs2) {
      var m = model || state.lastModels.ins;
      if (!m) return;
      var rf = refs2 || refs;
      var typeLabel = m.type === "pen" ? "Cartridge/Pen" : "Vial";
      var primingText = m.includePriming ? "Priming included: " + formatStrength(m.primeUnits) + " units/injection × " + m.injectionsPerDay + " injection(s)/day = " + formatStrength(m.dailyPriming) + " units/day." : "Priming not included.";
      var discardText = m.includeDiscard ? "Discard rule: discard after " + m.discardDays + " days from first use." : "Discard rule not included.";
      var boxLine = m.roundToBoxes ? "<tr><td>Boxes to dispense</td><td><b>" + m.boxesNeeded + "</b> (" + m.containersPerBox + " per box)</td></tr>" : "";
      var inner = "<div class='bt'>Daily Dose</div>" +
        "<table><thead><tr><th>Time</th><th>Units</th></tr></thead><tbody>" +
        "<tr><td>Morning</td><td><b>" + formatStrength(m.doses.morning) + " units</b></td></tr>" +
        "<tr><td>Afternoon</td><td><b>" + formatStrength(m.doses.afternoon) + " units</b></td></tr>" +
        "<tr><td>Evening</td><td><b>" + formatStrength(m.doses.evening) + " units</b></td></tr>" +
        "<tr><td>Night</td><td><b>" + formatStrength(m.doses.night) + " units</b></td></tr>" +
        "<tr><td><b>Total/day</b></td><td><b>" + formatStrength(m.dailyUnits) + " units</b></td></tr>" +
        "</tbody></table>" +
        "<div class='bt'>Supply Summary</div>" +
        "<div class='warn'>" + escHtml(primingText) + "<br>" + escHtml(discardText) + "</div>" +
        "<table><tbody>" +
        "<tr><td>Container type</td><td><b>" + typeLabel + "</b></td></tr>" +
        "<tr><td>Units per container</td><td><b>" + m.unitsPerContainer + " units</b></td></tr>" +
        "<tr><td>Estimated containers</td><td><b>" + m.containersUsed + "</b></td></tr>" + boxLine +
        "<tr><td>Units needed (dose only)</td><td><b>" + formatStrength(m.totalUnitsNeededNoWaste) + " units</b></td></tr>" +
        "<tr><td>Units for priming</td><td><b>" + formatStrength(m.totalPrimingUnits) + " units</b></td></tr>" +
        "<tr><td>Units wasted (discard)</td><td><b>" + formatStrength(m.wastedFromDiscard) + " units</b></td></tr>" +
        "<tr><td>Leftover at end</td><td><b>" + formatStrength(m.leftoverUnitsAtEnd) + " units</b></td></tr>" +
        "</tbody></table>";
      openPrintTabWithHtml(buildPrintHtml("Insulin Daily Dose + Supply Plan", { pharmacyName: rf.pharmacyName(), patientName: rf.patientName(), idCard: rf.idCard(), note: rf.note() }, inner));
    }

    calcBtn.addEventListener("click", doCalc);
    saveAndPrintBtn.addEventListener("click", async function() { await doSaveAndPrint(refs, "ins", state.lastModels.ins, doPrint, doCalc); });
    clearBtn.addEventListener("click", function() {
      weeksIn.value = "4"; morningIn.value = "0"; afternoonIn.value = "0"; eveningIn.value = "0"; nightIn.value = "0";
      containerTypeSel.value = "pen"; unitsPerContIn.value = "300"; contsPerBoxIn.value = "5"; roundBoxesSel.value = "yes";
      includePrimingSel.value = "yes"; primeUnitsIn.value = "2"; includeDiscardSel.value = "yes"; discardDaysIn.value = "28";
      setResultHtml("ins-results", "<div class='eikon-help'>Click <b>Calculate</b> to see results.</div>");
      state.lastModels.ins = null;
    });

    return wrap;
  }

  // ─────────────────────────── METHOTREXATE ──────────────────────────────────
  function buildMtxTab(refs) {
    var wrap = mk("div");

    var weeksIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "8" });
    var weeklyDoseIn = mk("input", { class: "eikon-input", type: "number", min: "0.5", step: "0.5", value: "10" });
    var weekdaySel = mk("select", { class: "eikon-select" });
    [{v:"1",t:"Monday"},{v:"2",t:"Tuesday"},{v:"3",t:"Wednesday"},{v:"4",t:"Thursday"},{v:"5",t:"Friday"},{v:"6",t:"Saturday"},{v:"0",t:"Sunday"}].forEach(function(d){var o=document.createElement("option");o.value=d.v;o.text=d.t;weekdaySel.appendChild(o);});
    weekdaySel.value = "0";
    var tabletStrengthIn = mk("input", { class: "eikon-input", type: "number", min: "0.5", step: "0.5", value: "2.5" });
    var halvesAllowSel = mk("select", { class: "eikon-select" });
    [["no","No (recommended - do not split MTX)"],["halves","Halves only (clinical instruction required)"],["quarters","Halves & quarters (clinical instruction required)"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];halvesAllowSel.appendChild(o);});
    var tabsPerBoxIn = mk("input", { class: "eikon-input", type: "number", min: "1", step: "1", value: "30" });
    var roundBoxesSel = mk("select", { class: "eikon-select" });
    [["yes","Yes"],["no","No"]].forEach(function(p){var o=document.createElement("option");o.value=p[0];o.text=p[1];roundBoxesSel.appendChild(o);});

    var calcBtn = mk("button", { class: "eikon-btn primary", text: "Calculate", type: "button" });
    var saveAndPrintBtn = mk("button", { class: "eikon-btn", text: "Save & Print", type: "button" });
    var clearBtn = mk("button", { class: "eikon-btn danger", text: "Clear", type: "button" });

    var resultBox = makeResultBox("mtx-results");
    var inputCard = mk("div", { class: "eikon-card" }, [
      mk("div", { style: "font-weight:900;", text: "Methotrexate Weekly Dosing" }),
      mk("div", { style: "height:8px;" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Duration (weeks)" }), weeksIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Weekly dose (mg)" }), weeklyDoseIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Day of week" }), weekdaySel])
      ]),
      mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:8px 0;", text: "Tablet Details" }),
      mk("div", { class: "eikon-row" }, [
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Tablet strength (mg)" }), tabletStrengthIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Allow halves?" }), halvesAllowSel]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Tablets per box" }), tabsPerBoxIn]),
        mk("div", { class: "eikon-field" }, [mk("div", { class: "eikon-label", text: "Round to boxes?" }), roundBoxesSel])
      ]),
      mk("div", { style: "border:2px solid var(--border);border-radius:10px;padding:8px;font-weight:900;font-size:13px;", text: "METHOTREXATE WARNING: TAKE ONCE WEEKLY ONLY — NOT DAILY. Daily dosing can cause serious harm." }),
      mk("div", { style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:10px;" }, [calcBtn, saveAndPrintBtn, clearBtn])
    ]);

    wrap.appendChild(mk("div", { style: "display:grid;grid-template-columns:1.1fr 0.9fr;gap:12px;" }, [inputCard, resultBox]));

    function getStartDate() {
      var sd = refs.startDate();
      if (!sd || !/^\d{4}-\d{2}-\d{2}$/.test(sd)) return null;
      return new Date(sd + "T00:00:00");
    }

    function nextOrSameWeekday(startDate, targetDow) {
      var d = new Date(startDate.getTime());
      var diff = (targetDow - d.getDay() + 7) % 7;
      return addDays(d, diff);
    }

    function doCalc() {
      var startDate = getStartDate();
      if (!startDate) { setResultError("mtx-results", "Enter a valid start date."); return null; }
      var weeks = parseIntSafe(weeksIn.value, 0);
      if (weeks <= 0) { setResultError("mtx-results", "Enter a valid number of weeks."); return null; }
      var weeklyDose = parseNum(weeklyDoseIn.value);
      if (!Number.isFinite(weeklyDose) || weeklyDose <= 0) { setResultError("mtx-results", "Weekly dose must be a positive number."); return null; }
      var tabletStrength = parseNum(tabletStrengthIn.value);
      if (!Number.isFinite(tabletStrength) || tabletStrength <= 0) { setResultError("mtx-results", "Tablet strength must be a positive number."); return null; }
      var allowHalves = halvesAllowSel.value !== "no";
      var allowQuarters = halvesAllowSel.value === "quarters";
      var tabsPerBox = clamp(parseIntSafe(tabsPerBoxIn.value,30),1,999999);
      var roundToBoxes = roundBoxesSel.value === "yes";
      var targetDow = parseIntSafe(weekdaySel.value, 0);
      var firstDoseDate = nextOrSameWeekday(startDate, targetDow);
      var eps = 1e-9;
      var exactTabs = weeklyDose / tabletStrength;
      var isInteger = Math.abs(exactTabs - Math.round(exactTabs)) < eps;
      var isHalfInteger = Math.abs(exactTabs*2 - Math.round(exactTabs*2)) < eps;
      var isQuarterInteger = Math.abs(exactTabs*4 - Math.round(exactTabs*4)) < eps;
      var canRepresent = isInteger || (allowHalves && isHalfInteger) || (allowQuarters && isQuarterInteger);
      if (!canRepresent) { setResultError("mtx-results", "Weekly dose " + formatStrength(weeklyDose) + " mg cannot be represented by " + formatStrength(tabletStrength) + " mg tablets (try enabling halves or quarters)."); return null; }
      var wholeTabsPerDose = Math.floor(exactTabs);
      var remainder = exactTabs - wholeTabsPerDose;
      var halfPieceNeeded = (!isInteger && allowHalves && Math.abs(remainder - 0.5) < eps) ? 1 : 0;
      var quarterPieceNeeded = (!isInteger && !halfPieceNeeded && allowQuarters && isQuarterInteger) ? Math.round(remainder * 4) : 0;
      var tabsDispensePerDose = wholeTabsPerDose + (halfPieceNeeded ? 1 : 0) + (quarterPieceNeeded >= 4 ? Math.floor(quarterPieceNeeded/4) : quarterPieceNeeded > 0 ? 1 : 0);
      var schedule = [];
      for (var i = 0; i < weeks; i++) schedule.push({ doseDate: addDays(firstDoseDate, i*7), wholeTabs: wholeTabsPerDose, halfPieces: halfPieceNeeded, quarterPieces: quarterPieceNeeded, tabsDispense: tabsDispensePerDose });
      var totalWholeTabsUsed = wholeTabsPerDose * weeks;
      var totalHalfPiecesUsed = halfPieceNeeded * weeks;
      var totalQuarterPiecesUsed = quarterPieceNeeded * weeks;
      var totalTabsToDispense = totalWholeTabsUsed + Math.ceil(totalHalfPiecesUsed/2) + Math.ceil(totalQuarterPiecesUsed/4);
      var boxes = roundToBoxes ? Math.ceil(totalTabsToDispense/tabsPerBox) : null;

      var model = { startDate:startDate, firstDoseDate:firstDoseDate, weeks:weeks, weeklyDose:weeklyDose, tabletStrength:tabletStrength, tabsPerBox:tabsPerBox, roundToBoxes:roundToBoxes, schedule:schedule, totalWholeTabsUsed:totalWholeTabsUsed, totalHalfPiecesUsed:totalHalfPiecesUsed, totalQuarterPiecesUsed:totalQuarterPiecesUsed, totalTabsToDispense:totalTabsToDispense, boxes:boxes };
      state.lastModels.mtx = model;

      var preview = schedule.slice(0, 8).map(function(s) {
        var dt = []; if(s.wholeTabs>0) dt.push(s.wholeTabs+" tablet(s)"); if(s.halfPieces>0) dt.push("+ ½ tablet"); if(s.quarterPieces>0) dt.push("+ ¼ tablet");
        return "<tr><td>" + fmtDate(s.doseDate) + "</td><td>" + DOW[s.doseDate.getDay()] + "</td><td><b>" + formatStrength(weeklyDose) + " mg</b></td><td><b>" + (dt.join(" ") || "0") + "</b> of " + formatStrength(tabletStrength) + " mg</td></tr>";
      }).join("");
      var more = schedule.length > 8 ? "<div class='eikon-help'>Preview: first 8 weeks. Full plan on printout.</div>" : "";
      var boxLine = roundToBoxes ? "<div class='eikon-help'><b>Boxes:</b> " + totalTabsToDispense + " tablets → <b>" + boxes + "</b> " + plural(boxes,"box","boxes") + " (" + tabsPerBox + " per box)</div>" : "";
      var qInfo = totalQuarterPiecesUsed ? " + " + totalQuarterPiecesUsed + " quarter(s)" : "";

      setResultHtml("mtx-results",
        "<div style='border:3px solid var(--border);border-radius:10px;padding:8px;font-weight:900;margin-bottom:10px;'>TAKE ONCE WEEKLY ONLY — NOT DAILY</div>" +
        "<table class='eikon-table'><thead><tr><th>Total whole tabs</th><th>Total halves</th><th>Total quarters</th><th>To dispense</th></tr></thead><tbody><tr><td><b>" + totalWholeTabsUsed + "</b></td><td><b>" + totalHalfPiecesUsed + "</b></td><td><b>" + totalQuarterPiecesUsed + "</b></td><td><b>" + totalTabsToDispense + "</b></td></tr></tbody></table>" +
        boxLine +
        "<div style='font-weight:900;margin-top:10px;margin-bottom:6px;'>Weekly Plan Preview</div>" +
        "<table class='eikon-table'><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets</th></tr></thead><tbody>" + preview + "</tbody></table>" + more
      );
      return model;
    }

    function doPrint(model, refs2) {
      var m = model || state.lastModels.mtx;
      if (!m) return;
      var rf = refs2 || refs;
      var rows = m.schedule.map(function(s) {
        var dt = []; if(s.wholeTabs>0) dt.push(s.wholeTabs+" tablet(s)"); if(s.halfPieces>0) dt.push("+ ½ tablet"); if(s.quarterPieces>0) dt.push("+ ¼ tablet");
        return "<tr><td>" + fmtDate(s.doseDate) + "</td><td>" + DOW[s.doseDate.getDay()] + "</td><td><b>" + formatStrength(m.weeklyDose) + " mg</b></td><td><b>" + (dt.join(" ")||"0") + "</b> of " + formatStrength(m.tabletStrength) + " mg</td></tr>";
      }).join("");
      var boxLine = m.roundToBoxes ? "<div><b>Dispense:</b> " + m.totalTabsToDispense + " tablets → " + m.boxes + " " + plural(m.boxes,"box","boxes") + " (" + m.tabsPerBox + " per box)</div>" : "<div><b>Dispense:</b> " + m.totalTabsToDispense + " tablets exact</div>";
      var inner = "<div class='bigwarn'>TAKE ONCE WEEKLY ONLY — NOT DAILY</div>" +
        "<div class='bt'>Dispensing Summary</div>" +
        "<table><thead><tr><th>Weekly dose</th><th>Tablet strength</th><th>First dose</th><th>Duration</th></tr></thead><tbody><tr><td><b>" + formatStrength(m.weeklyDose) + " mg</b></td><td><b>" + formatStrength(m.tabletStrength) + " mg</b></td><td><b>" + fmtDate(m.firstDoseDate) + " (" + DOW[m.firstDoseDate.getDay()] + ")</b></td><td><b>" + m.weeks + " week(s)</b></td></tr></tbody></table>" +
        boxLine +
        "<div class='bt'>Weekly Plan</div>" +
        "<table><thead><tr><th>Date</th><th>Day</th><th>Dose</th><th>Tablets to take</th></tr></thead><tbody>" + rows + "</tbody></table>";
      openPrintTabWithHtml(buildPrintHtml("Methotrexate Weekly Dosing Plan", { pharmacyName: rf.pharmacyName(), patientName: rf.patientName(), idCard: rf.idCard(), note: rf.note() }, inner));
    }

    calcBtn.addEventListener("click", doCalc);
    saveAndPrintBtn.addEventListener("click", async function() { await doSaveAndPrint(refs, "mtx", state.lastModels.mtx, doPrint, doCalc); });
    clearBtn.addEventListener("click", function() {
      weeksIn.value = "8"; weeklyDoseIn.value = "10"; weekdaySel.value = "0"; tabletStrengthIn.value = "2.5";
      halvesAllowSel.value = "no"; tabsPerBoxIn.value = "30"; roundBoxesSel.value = "yes";
      setResultHtml("mtx-results", "<div class='eikon-help'>Click <b>Calculate</b> to see results.</div>");
      state.lastModels.mtx = null;
    });

    return wrap;
  }

  // ─────────────────────────── RECORDS VIEW ─────────────────────────────────
  async function buildRecordsView(mount) {
    mount.innerHTML = "<div class='eikon-help'>Loading records…</div>";
    try {
      await loadRecords();
    } catch (e) {
      mount.innerHTML = "<div class='eikon-card'><div style='color:var(--danger,#e05);'>Failed to load records: " + escHtml(String(e && e.message ? e.message : e)) + "</div></div>";
      return;
    }

    mount.innerHTML = "";

    // ── Detail panel (shown above table when a row is clicked) ──────────────
    var detailPanel = mk("div", { class: "eikon-card", style: "display:none;margin-bottom:10px;" });
    var calcTypeLabel = { lev:"Levothyroxine", pred:"Prednisolone / Prednisone", war:"Warfarin", ins:"Insulin", mtx:"Methotrexate" };

    function showDetail(rec) {
      detailPanel.innerHTML = "";
      detailPanel.style.display = "";
      var header = mk("div", { style: "display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:10px;" });
      header.appendChild(mk("div", { style: "font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:.6px;", text: "Record Details" }));
      var closeBtn = mk("button", { class: "eikon-btn danger", text: "✕ Close", type: "button", style: "font-size:12px;padding:4px 10px;" });
      closeBtn.addEventListener("click", function() { detailPanel.style.display = "none"; });
      header.appendChild(closeBtn);
      detailPanel.appendChild(header);

      // Meta fields
      var metaHtml =
        "<table class='eikon-table'><tbody>" +
        "<tr><td><b>Calculator</b></td><td>" + escHtml(calcTypeLabel[rec.calc_type] || rec.calc_type || "") + "</td></tr>" +
        "<tr><td><b>Patient</b></td><td>" + escHtml(rec.patient_name || "") + "</td></tr>" +
        "<tr><td><b>ID Card</b></td><td>" + escHtml(rec.id_card || "") + "</td></tr>" +
        "<tr><td><b>Start Date</b></td><td>" + escHtml(rec.start_date || "") + "</td></tr>" +
        "<tr><td><b>Saved At</b></td><td>" + escHtml(rec.created_at || "") + "</td></tr>" +
        "</tbody></table>";
      detailPanel.appendChild(mk("div", { html: metaHtml }));

      // Calc data — human-readable rendering per calculator type
      if (rec.calc_data_json) {
        detailPanel.appendChild(mk("div", { style: "font-weight:900;font-size:12px;text-transform:uppercase;letter-spacing:.6px;border-top:1px solid var(--border);padding-top:8px;margin:10px 0 6px;", text: "Calculation Summary" }));
        try {
          var data = typeof rec.calc_data_json === "string" ? JSON.parse(rec.calc_data_json) : rec.calc_data_json;
          var summaryHtml = "";

          if (rec.calc_type === "pred") {
            // Prednisolone / Prednisone
            summaryHtml += "<div style='font-weight:800;margin-bottom:4px;'>" + escHtml(data.drug || "Prednisolone") + " Taper — " + (data.stepPlans ? data.stepPlans.length : "?") + " steps</div>";
            if (data.stepPlans && data.stepPlans.length) {
              summaryHtml += "<table class='eikon-table'><thead><tr><th>Step</th><th>Dose/day</th><th>Days</th><th>From</th><th>Note</th></tr></thead><tbody>";
              data.stepPlans.forEach(function(sp) {
                var start = sp.start ? new Date(sp.start) : null;
                summaryHtml += "<tr><td><b>" + sp.stepNumber + "</b></td><td><b>" + formatStrength(sp.doseMg) + " mg</b></td><td>" + sp.days + "</td><td>" + (start ? fmtDate(start) : "") + "</td><td>" + escHtml(sp.note || "") + "</td></tr>";
              });
              summaryHtml += "</tbody></table>";
            }
            if (data.totalRows && data.totalRows.length) {
              summaryHtml += "<div style='font-weight:800;margin:8px 0 4px;'>Tablets to dispense:</div><table class='eikon-table'><thead><tr><th>Strength</th><th>Physical tabs</th></tr></thead><tbody>";
              data.totalRows.forEach(function(r) { summaryHtml += "<tr><td>" + formatStrength(r.strength) + " mg</td><td><b>" + r.tabletsToDispense + "</b></td></tr>"; });
              summaryHtml += "</tbody></table>";
            }
            if (data.boxes) summaryHtml += "<div class='eikon-help'><b>Boxes:</b> " + data.totalDispensedTabsAll + " tabs → " + data.boxes + " box(es)</div>";

          } else if (rec.calc_type === "lev") {
            // Levothyroxine
            summaryHtml += "<div style='font-weight:800;margin-bottom:4px;'>Levothyroxine — " + (data.weeks || "?") + " weeks</div>";
            if (data.prescribedDoses && data.prescribedDoses.length) {
              summaryHtml += "<table class='eikon-table'><thead><tr><th>Dose</th><th>mcg/day</th></tr></thead><tbody>";
              data.prescribedDoses.forEach(function(pd) { summaryHtml += "<tr><td>Dose " + pd.idx + "</td><td><b>" + formatStrength(pd.mcg) + " mcg</b></td></tr>"; });
              summaryHtml += "</tbody></table>";
            }
            if (data.dispensing && data.dispensing.length) {
              summaryHtml += "<div style='font-weight:800;margin:8px 0 4px;'>Dispensing:</div><table class='eikon-table'><thead><tr><th>Strength</th><th>Physical tabs</th><th>Boxes</th></tr></thead><tbody>";
              data.dispensing.forEach(function(d) { summaryHtml += "<tr><td>" + formatStrength(d.strength) + " mcg</td><td><b>" + d.physicalTablets + "</b></td><td>" + d.boxes + "</td></tr>"; });
              summaryHtml += "</tbody></table>";
            }

          } else if (rec.calc_type === "war") {
            // Warfarin
            summaryHtml += "<div style='font-weight:800;margin-bottom:4px;'>Warfarin Variable Dosing — " + (data.weeks || "?") + " weeks</div>";
            if (data.dispByStrength && data.dispByStrength.length) {
              summaryHtml += "<table class='eikon-table'><thead><tr><th>Strength</th><th>Physical tabs</th><th>Boxes</th></tr></thead><tbody>";
              data.dispByStrength.forEach(function(r) { summaryHtml += "<tr><td>" + formatStrength(r.strength) + " mg</td><td><b>" + r.tabletsDispense + "</b></td><td>" + r.boxesNeeded + "</td></tr>"; });
              summaryHtml += "</tbody></table>";
            }

          } else if (rec.calc_type === "ins") {
            // Insulin
            var typeLabel = data.type === "pen" ? "Cartridge/Pen" : "Vial";
            summaryHtml += "<div style='font-weight:800;margin-bottom:4px;'>Insulin — " + (data.weeks || "?") + " weeks, " + typeLabel + "</div>";
            if (data.doses) {
              summaryHtml += "<table class='eikon-table'><thead><tr><th>Time</th><th>Units</th></tr></thead><tbody>";
              [["Morning", data.doses.morning],["Afternoon", data.doses.afternoon],["Evening", data.doses.evening],["Night", data.doses.night]].forEach(function(pair){
                summaryHtml += "<tr><td>" + pair[0] + "</td><td><b>" + formatStrength(pair[1]) + " u</b></td></tr>";
              });
              summaryHtml += "</tbody></table>";
            }
            summaryHtml += "<table class='eikon-table' style='margin-top:6px;'><tbody>" +
              "<tr><td>Daily dose</td><td><b>" + formatStrength(data.dailyUnits) + " units</b></td></tr>" +
              "<tr><td>Containers used</td><td><b>" + data.containersUsed + "</b> × " + data.unitsPerContainer + " u</td></tr>" +
              (data.boxesNeeded ? "<tr><td>Boxes</td><td><b>" + data.boxesNeeded + "</b></td></tr>" : "") +
              "<tr><td>Units wasted (discard)</td><td><b>" + formatStrength(data.wastedFromDiscard || 0) + " u</b></td></tr>" +
              "</tbody></table>";

          } else if (rec.calc_type === "mtx") {
            // Methotrexate
            summaryHtml += "<div style='font-weight:800;margin-bottom:4px;'>Methotrexate — " + (data.weeks || "?") + " weeks</div>";
            summaryHtml += "<table class='eikon-table'><tbody>" +
              "<tr><td>Weekly dose</td><td><b>" + formatStrength(data.weeklyDose) + " mg</b></td></tr>" +
              "<tr><td>Tablet strength</td><td><b>" + formatStrength(data.tabletStrength) + " mg</b></td></tr>" +
              "<tr><td>Total tablets to dispense</td><td><b>" + data.totalTabsToDispense + "</b></td></tr>" +
              (data.boxes ? "<tr><td>Boxes</td><td><b>" + data.boxes + "</b></td></tr>" : "") +
              "</tbody></table>";
            if (data.firstDoseDate) {
              var fd = new Date(data.firstDoseDate);
              summaryHtml += "<div class='eikon-help'>First dose: " + fmtDate(fd) + " (" + DOW[fd.getDay()] + ")</div>";
            }
          } else {
            // Fallback: compact JSON for unknown types
            var pre = mk("pre", { style: "font-family:monospace;font-size:11px;background:rgba(0,0,0,.3);border-radius:8px;padding:10px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow-y:auto;" });
            pre.textContent = JSON.stringify(data, null, 2);
            detailPanel.appendChild(pre);
          }

          if (summaryHtml) detailPanel.appendChild(mk("div", { html: summaryHtml }));
        } catch (e) {
          detailPanel.appendChild(mk("div", { class: "eikon-help", text: "(Could not parse calc data)" }));
        }
      }
    }

    // ── Table ───────────────────────────────────────────────────────────────
    var card = mk("div", { class: "eikon-card" });
    card.appendChild(mk("div", { style: "font-weight:900;font-size:13px;text-transform:uppercase;letter-spacing:.6px;border-bottom:1px solid var(--border);padding-bottom:6px;margin-bottom:10px;", text: "Saved Records" }));

    if (!state.records.length) {
      card.appendChild(mk("div", { class: "eikon-help", text: "No records found. Use Save & Print in a calculator to save a record." }));
      mount.appendChild(detailPanel);
      mount.appendChild(card);
      return;
    }

    card.appendChild(mk("div", { class: "eikon-help", style: "margin-bottom:8px;", text: "Click a row to view full details above the table." }));

    var tw = mk("div", { class: "eikon-table-wrap" });
    var table = mk("table", { class: "eikon-table" });
    var thead = mk("thead");
    var trh = mk("tr");
    ["Saved At","Patient","ID Card","Calculator","Start Date","Actions"].forEach(function(h) { trh.appendChild(mk("th", { text: h })); });
    thead.appendChild(trh);
    table.appendChild(thead);
    var tbody = mk("tbody");

    var activeRow = null;

    state.records.forEach(function(rec) {
      var tr = mk("tr", { style: "cursor:pointer;" });
      tr.appendChild(mk("td", { text: rec.created_at ? rec.created_at.replace("T"," ").replace(/\.\d+/,"") : "" }));
      tr.appendChild(mk("td", { text: rec.patient_name || "" }));
      tr.appendChild(mk("td", { text: rec.id_card || "" }));
      tr.appendChild(mk("td", { text: calcTypeLabel[rec.calc_type] || rec.calc_type || "" }));
      tr.appendChild(mk("td", { text: rec.start_date || "" }));

      var delBtn = mk("button", { class: "eikon-btn danger", text: "Delete", type: "button", style: "font-size:12px;padding:4px 8px;" });
      delBtn.addEventListener("click", async function(e) {
        e.stopPropagation();
        var ok = await modalConfirm("Delete record", "Delete this record for " + (rec.patient_name || "patient") + "?", "Delete", "Cancel");
        if (!ok) return;
        try {
          await deleteRecord(rec.id);
          state.recordsLoaded = false;
          await buildRecordsView(mount);
          toast("Deleted", "Record deleted.", "good");
        } catch (e) {
          toast("Error", (e && e.message) ? e.message : "Delete failed.", "bad");
        }
      });
      tr.appendChild(mk("td", {}, [delBtn]));

      tr.addEventListener("click", function() {
        if (activeRow) activeRow.style.background = "";
        activeRow = tr;
        tr.style.background = "rgba(255,255,255,0.06)";
        showDetail(rec);
        detailPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });

      tbody.appendChild(tr);
    });

    table.appendChild(tbody);
    tw.appendChild(table);
    card.appendChild(tw);
    mount.appendChild(detailPanel);
    mount.appendChild(card);
  }

  // ─────────────────────────── MAIN RENDER ───────────────────────────────────
  async function render(ctx) {
    var mount = ctx.mount;
    mount.innerHTML = "";
    ensureToastStyles();

    // Load patients for autosuggest (non-blocking)
    loadPatients().catch(function(e) { warn("patients load:", e && e.message); });

    var refs = {};

    // Top bar
    var bar = mk("div", { class: "eikon-card" });
    var barRow = mk("div", { class: "eikon-row", style: "align-items:center;gap:8px;flex-wrap:wrap;" });
    barRow.appendChild(mk("span", { class: "eikon-pill", style: "font-weight:900;", text: "💊 Pharmacy Calculators" }));

    var viewCalcBtn = mk("button", { class: "eikon-btn primary", text: "Calculators", type: "button" });
    var viewRecordsBtn = mk("button", { class: "eikon-btn", text: "Saved Records", type: "button" });
    barRow.appendChild(viewCalcBtn);
    barRow.appendChild(viewRecordsBtn);
    bar.appendChild(barRow);

    // Calculator tab buttons
    var tabBar = mk("div", { class: "eikon-card" });
    var tabRow = mk("div", { class: "eikon-row", style: "align-items:center;gap:8px;flex-wrap:wrap;" });
    var tabBtns = [
      { id: "lev", label: "Levothyroxine Alternate Dosing" },
      { id: "pred", label: "Prednisolone / Prednisone Taper" },
      { id: "war", label: "Warfarin Variable Dosing" },
      { id: "ins", label: "Insulin Supply" },
      { id: "mtx", label: "Methotrexate Weekly" }
    ];
    var tabButtonEls = {};
    tabBtns.forEach(function(tb) {
      var btn = mk("button", { class: "eikon-btn" + (state.activeTab === tb.id ? " primary" : ""), text: tb.label, type: "button" });
      tabButtonEls[tb.id] = btn;
      tabRow.appendChild(btn);
    });
    tabBar.appendChild(tabRow);

    // Header / patient card
    var headerCard = buildHeaderCard(refs);

    // Content area
    var calcContent = mk("div");
    var recordsContent = mk("div");
    recordsContent.style.display = "none";

    // Tab panels (lazy build)
    var tabPanels = {};
    function getTabPanel(id) {
      if (!tabPanels[id]) {
        var builders = { lev: buildLevTab, pred: buildPredTab, war: buildWarTab, ins: buildInsTab, mtx: buildMtxTab };
        tabPanels[id] = builders[id](refs);
      }
      return tabPanels[id];
    }

    var tabContentWrap = mk("div");
    calcContent.appendChild(headerCard);
    calcContent.appendChild(mk("div", { style: "height:12px;" }));
    calcContent.appendChild(tabBar);
    calcContent.appendChild(mk("div", { style: "height:12px;" }));
    calcContent.appendChild(tabContentWrap);

    function showCalcTab(id) {
      state.activeTab = id;
      Object.keys(tabButtonEls).forEach(function(k) {
        tabButtonEls[k].className = "eikon-btn" + (k === id ? " primary" : "");
      });
      tabContentWrap.innerHTML = "";
      tabContentWrap.appendChild(getTabPanel(id));
    }

    tabBtns.forEach(function(tb) {
      tabButtonEls[tb.id].addEventListener("click", function() { showCalcTab(tb.id); });
    });

    showCalcTab(state.activeTab);

    // View switching
    function showView(view) {
      state.view = view;
      viewCalcBtn.className = "eikon-btn" + (view === "calc" ? " primary" : "");
      viewRecordsBtn.className = "eikon-btn" + (view === "records" ? " primary" : "");
      calcContent.style.display = view === "calc" ? "" : "none";
      recordsContent.style.display = view === "records" ? "" : "none";
      if (view === "records" && !state.recordsLoaded) {
        buildRecordsView(recordsContent);
      }
    }

    viewCalcBtn.addEventListener("click", function() { showView("calc"); });
    viewRecordsBtn.addEventListener("click", function() { showView("records"); state.recordsLoaded = false; buildRecordsView(recordsContent); });

    mount.appendChild(bar);
    mount.appendChild(mk("div", { style: "height:12px;" }));
    mount.appendChild(calcContent);
    mount.appendChild(recordsContent);

    if (state.view === "records") showView("records");
  }

  // ─────────────────────────── REGISTER ─────────────────────────────────────
  E.registerModule({
    id: "pharmacycalc",
    title: "Pharmacy Calculators",
    order: 55,
    icon: "💊",
    render: render
  });

})();
