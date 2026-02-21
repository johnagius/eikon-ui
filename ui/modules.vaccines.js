/* ui/modules.vaccines.js
   Eikon - Vaccines module (UI)

   Fixes in this version:
   - Uses local puzzle world map from /ui/world_hi_res_v4_palette.html (no external fetch/CORS)
   - Map countries pop-out + recolor on selection (is-active)
   - Recommended vaccines section spans full width (no more squashed)
*/

(function () {
  "use strict";

  var E = window.EIKON;
  var VAX_MODULE_VERSION = "2026-02-21-4";

  try {
    if (E && E.dbg) E.dbg("[vaccines] loaded v", VAX_MODULE_VERSION);
  } catch (e) {}

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function el(tag, attrs) {
    var n = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      if (k === "class") n.className = attrs[k];
      else if (k === "text") n.textContent = attrs[k];
      else if (k === "html") n.innerHTML = attrs[k];
      else if (k === "style") n.setAttribute("style", attrs[k]);
      else if (k === "type") n.setAttribute("type", attrs[k]);
      else if (k === "value") n.value = attrs[k];
      else if (k === "placeholder") n.setAttribute("placeholder", attrs[k]);
      else if (k === "title") n.setAttribute("title", attrs[k]);
      else if (k === "disabled") n.disabled = !!attrs[k];
      else if (k === "checked") n.checked = !!attrs[k];
      else if (k === "for") n.setAttribute("for", attrs[k]);
      else if (k.indexOf("data-") === 0) n.setAttribute(k, attrs[k]);
      else n[k] = attrs[k];
    });
    return n;
  }

  function clamp(n, a, b) {
    return n < a ? a : (n > b ? b : n);
  }

  function toInt(v, dflt) {
    var n = parseInt(v, 10);
    return Number.isFinite(n) ? n : dflt;
  }

  function fmtDateTime(ts) {
    try {
      var d = ts ? new Date(ts) : new Date();
      return d.toISOString().replace("T", " ").slice(0, 19);
    } catch (e) {
      return "";
    }
  }

  function safe(s) {
    return String(s == null ? "" : s);
  }

  function slug(s) {
    return safe(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function debounce(fn, ms) {
    var t = null;
    return function () {
      var args = arguments;
      if (t) clearTimeout(t);
      t = setTimeout(function () { fn.apply(null, args); }, ms);
    };
  }

  function uniq(arr) {
    var seen = new Set();
    var out = [];
    arr.forEach(function (x) {
      if (seen.has(x)) return;
      seen.add(x);
      out.push(x);
    });
    return out;
  }

  function iso2Valid(cc) {
    cc = safe(cc).trim().toUpperCase();
    return /^[A-Z]{2}$/.test(cc) ? cc : "";
  }

  function toast(msg) {
    try {
      var t = el("div", { class: "vax-toast", text: msg });
      document.body.appendChild(t);
      setTimeout(function () { t.classList.add("show"); }, 10);
      setTimeout(function () { t.classList.remove("show"); }, 2400);
      setTimeout(function () { try { t.remove(); } catch (e) {} }, 3000);
    } catch (e) {}
  }

  // ------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------
  var STYLES_DONE = false;
  function ensureStyles() {
    if (STYLES_DONE) return;
    STYLES_DONE = true;
    var css = "" +
      ".vax-root{--vax-accent:rgba(90,168,255,.85);--vax-pink:rgba(255,92,165,.85);--vax-green:rgba(44,210,152,.8);--vax-selected:#f2c94c}" +
      ".vax-root .vax-titleRow{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".vax-root .vax-titleRow h2{margin:0;font-size:18px;letter-spacing:.2px}" +
      ".vax-root .vax-sub{margin:2px 0 0 0;font-size:12px;opacity:.75}" +
      ".vax-root .vax-tabs{display:flex;gap:10px;flex-wrap:wrap}" +
      ".vax-root .vax-tabBtn{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);color:rgba(255,255,255,.9);border-radius:14px;padding:8px 12px;cursor:pointer;user-select:none}" +
      ".vax-root .vax-tabBtn.active{border-color:rgba(90,168,255,.55);background:rgba(90,168,255,.10);box-shadow:0 10px 22px rgba(0,0,0,.18)}" +
      ".vax-root .vax-tabBtn .ico{width:14px;height:14px;display:inline-block;opacity:.9}" +
      ".vax-root .vax-card{border:1px solid rgba(255,255,255,.10);background:linear-gradient(180deg,rgba(255,255,255,.04),rgba(255,255,255,.02));border-radius:18px;box-shadow:0 18px 40px rgba(0,0,0,.25);padding:14px}" +
      ".vax-root .vax-hero{border-radius:20px;overflow:hidden;background:radial-gradient(1200px 560px at 28% 10%, rgba(90,168,255,.16) 0%, rgba(255,92,165,.12) 40%, rgba(0,0,0,.08) 100%)}" +
      ".vax-root .vax-heroInner{display:grid;grid-template-columns:1.12fr .88fr;gap:14px;align-items:stretch;padding:14px}" +
      "@media(max-width:980px){.vax-root .vax-heroInner{grid-template-columns:1fr;}}" +
      ".vax-root .vax-kpis{display:flex;gap:10px;flex-wrap:wrap;margin-top:10px}" +
      ".vax-root .vax-pill{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.18);padding:6px 10px;border-radius:999px;font-size:12px}" +
      ".vax-root .vax-pill b{font-weight:700}" +

      ".vax-root .vax-row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}" +
      ".vax-root .vax-input{flex:1 1 240px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.20);color:rgba(255,255,255,.90);border-radius:12px;padding:10px 12px;outline:none}" +
      ".vax-root .vax-input:focus{border-color:rgba(90,168,255,.55);box-shadow:0 0 0 4px rgba(90,168,255,.12)}" +
      ".vax-root .vax-btn{border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:rgba(255,255,255,.90);border-radius:12px;padding:10px 12px;cursor:pointer}" +
      ".vax-root .vax-btn.primary{border-color:rgba(90,168,255,.55);background:rgba(90,168,255,.12)}" +
      ".vax-root .vax-btn.danger{border-color:rgba(255,92,165,.45);background:rgba(255,92,165,.12)}" +
      ".vax-root .vax-btn:disabled{opacity:.45;cursor:not-allowed}" +

      // Map wrapper
      ".vax-root .mapShell{position:relative;border-radius:18px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(180deg,rgba(0,0,0,.18),rgba(255,255,255,.02));overflow:hidden;min-height:260px}" +
      ".vax-root .mapPad{padding:12px}" +
      ".vax-root .mapInner{border-radius:16px;overflow:hidden;display:flex;align-items:center;justify-content:center;min-height:236px;background:radial-gradient(540px 320px at 50% 20%, rgba(44,210,152,.18), rgba(90,168,255,.10) 50%, rgba(0,0,0,.08) 100%)}" +
      ".vax-root .mapInner svg{width:100%;height:auto;max-height:340px;display:block}" +
      ".vax-root .mapHud{position:absolute;left:12px;right:12px;bottom:12px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.30);backdrop-filter:blur(8px);-webkit-backdrop-filter:blur(8px);padding:10px 12px;border-radius:14px;font-size:12px;display:flex;gap:10px;align-items:center;justify-content:space-between}" +
      ".vax-root .mapLoading{padding:18px;text-align:center;font-size:12px;opacity:.85}" +
      ".vax-root .mapHint{margin-top:6px;opacity:.8}" +

      // Old SVG-country styling (kept)
      ".vax-root .vax-country{transition:transform 220ms ease, filter 220ms ease, opacity 220ms ease;cursor:pointer;outline:none}" +
      ".vax-root .vax-country:hover{filter:drop-shadow(0 10px 14px rgba(0,0,0,.30)) brightness(1.08) saturate(1.1)}" +
      ".vax-root .vax-country.selected{filter:drop-shadow(0 10px 12px rgba(0,0,0,.35)) brightness(1.15) saturate(1.22);transform-box:fill-box;transform-origin:center;transform:translateY(-3px) scale(1.06)}" +
      ".vax-root .vax-country.selected{stroke:rgba(255,255,255,.65);stroke-width:1.1}" +

      // Puzzle map styling (local HTML)
      ".vax-root .vaxPuzzle .country{cursor:pointer;transform-box:fill-box;transform-origin:center;filter:drop-shadow(0 10px 12px rgba(0,0,0,.22));transition:transform 220ms ease,filter 220ms ease;outline:none}" +
      ".vax-root .vaxPuzzle .country .fill{fill:var(--base,#6aa7ff)}" +
      ".vax-root .vaxPuzzle .country .grid{fill:url(#tilePattern);opacity:.65}" +
      ".vax-root .vaxPuzzle .country .border{fill:none;stroke:rgba(0,0,0,.24);stroke-width:.78;vector-effect:non-scaling-stroke;opacity:.26}" +
      ".vax-root .vaxPuzzle .country:hover{filter:drop-shadow(0 14px 16px rgba(0,0,0,.26))}" +
      ".vax-root .vaxPuzzle .country.is-active{transform:translate(-10px,-10px) scale(1.06);filter:drop-shadow(0 20px 26px rgba(0,0,0,.30))}" +
      ".vax-root .vaxPuzzle .country.is-active .fill{fill:var(--vax-selected,#f2c94c)!important}" +
      ".vax-root .vaxPuzzle .country.is-dim{opacity:.22;filter:saturate(.7) brightness(.92)}" +
      ".vax-root .vaxPuzzle .country:focus-visible .border{stroke:rgba(255,255,255,.62);opacity:.55;stroke-width:.90}" +

      // Toast
      ".vax-toast{position:fixed;left:50%;bottom:18px;transform:translate(-50%,12px);opacity:0;z-index:99999;background:rgba(0,0,0,.72);border:1px solid rgba(255,255,255,.16);padding:10px 14px;border-radius:14px;color:rgba(255,255,255,.92);font-size:12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);transition:opacity 220ms ease, transform 220ms ease}" +
      ".vax-toast.show{opacity:1;transform:translate(-50%,0)}" +

      // Layout below hero
      ".vax-root .grid2{display:grid;grid-template-columns:1.1fr .9fr;gap:14px;margin-top:14px}" +
      "@media(max-width:980px){.vax-root .grid2{grid-template-columns:1fr}}" +

      ".vax-root .recCard{padding:14px}" +
      ".vax-root .recHead{display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap}" +
      ".vax-root .recHead h3{margin:0;font-size:14px}" +
      ".vax-root .recCols{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px}" +
      "@media(max-width:680px){.vax-root .recCols{grid-template-columns:1fr}}" +
      ".vax-root .recCol{border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.16);border-radius:16px;padding:12px}" +
      ".vax-root .recCol h4{margin:0 0 8px 0;font-size:13px}" +
      ".vax-root .vaxItem{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:8px 8px;border-radius:14px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.02);margin-top:8px}" +
      ".vax-root .vaxItem .nm{font-weight:700}" +
      ".vax-root .vaxItem .sub{font-size:11px;opacity:.78;margin-top:2px;line-height:1.3}" +
      ".vax-root .qty{display:flex;align-items:center;gap:8px}" +
      ".vax-root input[type=number].vaxQty{width:72px;border:1px solid rgba(255,255,255,.14);background:rgba(0,0,0,.16);color:rgba(255,255,255,.9);border-radius:10px;padding:8px 10px;outline:none}" +
      ".vax-root .tag{display:inline-flex;align-items:center;gap:6px;border-radius:999px;padding:4px 9px;font-size:11px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.16);margin-top:6px}" +
      ".vax-root .tag.ok{border-color:rgba(44,210,152,.38);background:rgba(44,210,152,.10)}" +
      ".vax-root .tag.warn{border-color:rgba(255,92,165,.32);background:rgba(255,92,165,.09)}" +

      ".vax-root .orderCard h3{margin:0;font-size:14px}" +
      ".vax-root .orderBlock{margin-top:12px;border:1px solid rgba(255,255,255,.10);background:rgba(0,0,0,.16);border-radius:16px;padding:12px}" +
      ".vax-root .orderBlock h4{margin:0 0 10px 0;font-size:13px}" +
      ".vax-root .hint{font-size:12px;opacity:.75;margin-top:8px;line-height:1.35}" +
      ".vax-root .row2{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "@media(max-width:680px){.vax-root .row2{grid-template-columns:1fr}}" +

      // Table
      ".vax-root .tblTools{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-bottom:10px}" +
      ".vax-root .tbl{width:100%;border-collapse:separate;border-spacing:0;border:1px solid rgba(255,255,255,.10);border-radius:16px;overflow:hidden;background:rgba(0,0,0,.14)}" +
      ".vax-root .tbl th,.vax-root .tbl td{padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.08);font-size:12px;vertical-align:top}" +
      ".vax-root .tbl th{font-size:11px;letter-spacing:.3px;text-transform:uppercase;opacity:.85;background:rgba(255,255,255,.03)}" +
      ".vax-root .tbl tr:last-child td{border-bottom:none}" +
      ".vax-root .tbl td .muted{opacity:.75;font-size:11px;margin-top:2px;line-height:1.3}" +

      // Small badge
      ".vax-root .badge{display:inline-flex;align-items:center;gap:6px;border-radius:999px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.14);padding:4px 9px;font-size:11px;opacity:.9}";

    var st = document.createElement("style");
    st.type = "text/css";
    st.appendChild(document.createTextNode(css));
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // World map (puzzle-style) – loaded from local HTML (no external fetch/CORS)
  // ------------------------------------------------------------
  // Put this file in your repo at: ui/world_hi_res_v4_palette.html
  // The module will fetch it at runtime: /ui/world_hi_res_v4_palette.html
  var PUZZLE_WORLD_PATH = "./world_hi_res_v4_palette.html";

  function sanitizeHtmlDoc(doc) {
    try {
      Array.prototype.slice.call(doc.querySelectorAll("script, foreignObject")).forEach(function (n) { n.remove(); });
      Array.prototype.slice.call(doc.querySelectorAll("*")).forEach(function (n) {
        Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
          if (!a || !a.name) return;
          if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        });
      });
    } catch (e) {}
    return doc;
  }

  async function loadPuzzleWorldSvg() {
    try {
      var res = await fetch(PUZZLE_WORLD_PATH, { method: "GET", cache: "force-cache" });
      if (!res || !res.ok) return null;
      var html = await res.text();
      if (!html || html.length < 2000) return null;

      var dp = new DOMParser();
      var doc = dp.parseFromString(html, "text/html");
      sanitizeHtmlDoc(doc);

      // Grab the first SVG on the page (the map)
      var svg = doc.querySelector("svg");
      if (!svg) return null;

      // Import into this document
      return document.importNode(svg, true);
    } catch (e) {
      return null;
    }
  }

  // Fallback globe if the local map file is missing
  function buildFallbackGlobe() {
    var ns = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(ns, "svg");
    svg.setAttribute("viewBox", "0 0 320 320");
    svg.innerHTML =
      '<defs>' +
      '  <linearGradient id="ocean" x1="0" y1="0" x2="1" y2="1">' +
      '    <stop offset="0" stop-color="rgba(90,168,255,.35)"/>' +
      '    <stop offset="1" stop-color="rgba(0,0,0,.10)"/>' +
      '  </linearGradient>' +
      '</defs>' +
      '<rect x="0" y="0" width="320" height="320" fill="url(#ocean)" />' +
      '<g stroke="rgba(255,255,255,.22)" stroke-width="1">' +
      '  <path d="M0 160 H320" />' +
      '  <path d="M160 0 V320" />' +
      '  <circle cx="160" cy="160" r="130" fill="none" />' +
      '  <circle cx="160" cy="160" r="90" fill="none" />' +
      '</g>' +
      '<g fill="rgba(44,210,152,.25)">' +
      '  <path d="M50,120 C70,80 120,70 140,95 C155,115 140,145 120,160 C90,180 55,155 50,120 Z"/>' +
      '  <path d="M170,90 C200,70 250,85 260,120 C268,150 240,175 210,168 C180,160 155,120 170,90 Z"/>' +
      '  <path d="M160,185 C190,170 230,185 240,215 C250,250 205,270 175,250 C150,235 140,200 160,185 Z"/>' +
      '</g>';
    return svg;
  }

  // --- Continent-based palette (copied from your world_hi_res_v4_palette.html, simplified) ---
  var SOUTH_AMERICA = new Set(["AR","BO","BR","CL","CO","EC","GY","PY","PE","SR","UY","VE","FK","GF"]);
  var OCEANIA = new Set([
    "AU","NZ","PG","FJ","SB","VU","WS","TO","TV","KI","NR","PW","MH","FM",
    "GU","MP","NC","PF","PN","CK","NU","TK","WF","AS","UM"
  ]);

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function clamp2(n, a, b) { return n < a ? a : (n > b ? b : n); }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = clamp2(s, 0, 100) / 100;
    l = clamp2(l, 0, 100) / 100;

    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r1 = 0, g1 = 0, b1 = 0;

    if (hp >= 0 && hp < 1) { r1 = c; g1 = x; b1 = 0; }
    else if (hp >= 1 && hp < 2) { r1 = x; g1 = c; b1 = 0; }
    else if (hp >= 2 && hp < 3) { r1 = 0; g1 = c; b1 = x; }
    else if (hp >= 3 && hp < 4) { r1 = 0; g1 = x; b1 = c; }
    else if (hp >= 4 && hp < 5) { r1 = x; g1 = 0; b1 = c; }
    else { r1 = c; g1 = 0; b1 = x; }

    var m = l - c / 2;
    var r = Math.round((r1 + m) * 255);
    var g = Math.round((g1 + m) * 255);
    var b = Math.round((b1 + m) * 255);

    var toHex = function (v) {
      var hh = v.toString(16);
      return hh.length === 1 ? ("0" + hh) : hh;
    };
    return "#" + toHex(r) + toHex(g) + toHex(b);
  }

  function continentFromPoint(cx, cy, iso) {
    if (iso === "AQ") return "AN";
    if (SOUTH_AMERICA.has(iso)) return "SA";
    if (OCEANIA.has(iso)) return "OC";

    // ViewBox: 0..1100 (x), 0..520 (y)
    if (cy >= 415) return "AN";

    // Americas
    if (cx <= 455) {
      if (cy <= 285) return "NA";
      return "SA";
    }

    // Europe / Africa
    if (cx <= 720) {
      if (cy <= 225) return "EU";
      return "AF";
    }

    // Asia default
    return "AS";
  }

  function colorFor(iso, continent) {
    var h = fnv1a(iso);
    var H0 = 210;
    if (continent === "NA") H0 = 250;
    else if (continent === "SA") H0 = 352;
    else if (continent === "EU") H0 = 220;
    else if (continent === "AF") H0 = 305;
    else if (continent === "AS") H0 = 195;
    else if (continent === "OC") H0 = 165;

    var jitterMax = (continent === "SA") ? 7 : 10;
    var jitter = (((h % 1000) / 1000) - 0.5) * (jitterMax * 2);
    var hue = H0 + jitter;

    var alt = (h & 1) ? 10 : -6;
    var l = 54 + alt + (((h >>> 6) & 7) - 3) * 1.2;
    var s = 62 + (((h >>> 11) & 7) - 3) * 2.5;

    var hh = ((hue % 360) + 360) % 360;
    if (hh >= 45 && hh <= 75) hue = hh + 40;

    return hslToHex(hue, s, l);
  }

  function applyPuzzlePalette(svgEl) {
    try {
      var nodes = svgEl.querySelectorAll('#countries .country');
      for (var i = 0; i < nodes.length; i++) {
        var elc = nodes[i];
        var iso = String(elc.getAttribute("data-iso") || "").toUpperCase();
        var nm = String(elc.getAttribute("data-name") || "");
        if (!iso) continue;

        if (iso === "AQ" || nm === "Antarctica") {
          elc.style.setProperty("--base", "#ffffff");
          elc.style.setProperty("--selected", "#ffffff");
          var g = elc.querySelector(".grid");
          if (g) g.style.opacity = "0.20";
          continue;
        }

        var bbox = null;
        try { bbox = elc.getBBox(); } catch (e) { bbox = null; }
        var cx = bbox ? (bbox.x + bbox.width / 2) : 550;
        var cy = bbox ? (bbox.y + bbox.height / 2) : 260;

        var cont = continentFromPoint(cx, cy, iso);
        elc.setAttribute("data-continent", cont);
        elc.style.setProperty("--base", colorFor(iso, cont));
      }
    } catch (e2) {}
  }

  function createWorldMapWidget(onPickCountry) {
    var onPick = onPickCountry;
    ensureStyles();

    var shell = el("div", { class: "mapShell vaxPuzzle" });
    var pad = el("div", { class: "mapPad" });
    var inner = el("div", { class: "mapInner" });

    var hud = el("div", { class: "mapHud", text: "Loading world map…" });
    var loading = el("div", {
      class: "mapLoading",
      html: "<b>Loading map…</b><div class='mapHint'>Using local /ui/world_hi_res_v4_palette.html</div>"
    });

    inner.appendChild(loading);
    pad.appendChild(inner);
    shell.appendChild(pad);
    shell.appendChild(hud);

    var state = {
      svgEl: null,
      selected: "",
      activeEl: null
    };

    function setHud(text) { hud.textContent = text || ""; }

    function clearSelected() {
      if (!state.svgEl) return;
      var prev = state.svgEl.querySelectorAll(".country.is-active, .country.is-dim");
      Array.prototype.forEach.call(prev, function (n) {
        n.classList.remove("is-active");
        n.classList.remove("is-dim");
      });
      state.selected = "";
      state.activeEl = null;
    }

    function findCountryEl(code) {
      if (!state.svgEl) return null;
      var cc = String(code || "").trim().toUpperCase();
      if (!cc) return null;
      return state.svgEl.querySelector('.country[data-iso="' + cc.replace(/"/g, "") + '"]');
    }

    function selectCountry(code, dimOthers) {
      code = String(code || "").trim().toUpperCase();
      state.selected = code;

      if (!state.svgEl) return;

      clearSelected();
      if (!code) return;

      var elc = findCountryEl(code);
      if (!elc) {
        setHud("Selected: " + code + " (not found on map)");
        return;
      }

      if (dimOthers) {
        var all = state.svgEl.querySelectorAll(".country");
        Array.prototype.forEach.call(all, function (n) { n.classList.add("is-dim"); });
        elc.classList.remove("is-dim");
      }

      elc.classList.add("is-active");
      try { elc.parentNode.appendChild(elc); } catch (e) {}
      state.activeEl = elc;

      var name = String(elc.getAttribute("data-name") || "") || code;
      setHud(name + " (" + code + ") — click another country to change");
    }

    function bindClick(svgEl) {
      svgEl.addEventListener("click", function (ev) {
        var t = ev.target;
        var g = null;
        while (t && t !== svgEl) {
          if (t.classList && t.classList.contains("country")) { g = t; break; }
          t = t.parentNode;
        }
        if (!g) return;
        var iso = String(g.getAttribute("data-iso") || "").toUpperCase();
        if (!iso) return;
        onPick && onPick(iso, String(g.getAttribute("data-name") || ""));
      });

      svgEl.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter" && ev.key !== " ") return;
        var t = ev.target;
        if (!t || !t.classList || !t.classList.contains("country")) return;
        ev.preventDefault();
        var iso = String(t.getAttribute("data-iso") || "").toUpperCase();
        if (!iso) return;
        onPick && onPick(iso, String(t.getAttribute("data-name") || ""));
      });
    }

    (async function boot() {
      try {
        var svgEl = await loadPuzzleWorldSvg();
        if (!svgEl) throw new Error("Local map missing");

        svgEl.setAttribute("preserveAspectRatio", "xMidYMid meet");

        inner.innerHTML = "";
        inner.appendChild(svgEl);
        state.svgEl = svgEl;

        applyPuzzlePalette(svgEl);
        bindClick(svgEl);

        setHud("Click a country on the map, or search by name above.");
      } catch (e) {
        inner.innerHTML = "";
        inner.appendChild(buildFallbackGlobe());
        setHud("Map failed to load. Put /ui/world_hi_res_v4_palette.html in the repo.");
      }
    })();

    return {
      el: shell,
      setHud: setHud,
      select: selectCountry,
      clear: clearSelected,
      setOnPick: function (fn) { onPick = fn; }
    };
  }

  // ------------------------------------------------------------
  // Module state
  // ------------------------------------------------------------
  function makeState() {
    return {
      tab: "travel",
      catalog: [],
      catalogLoaded: false,
      catalogErr: "",
      stock: [],
      stockLoaded: false,
      stockErr: "",
      orders: [],
      ordersLoaded: false,
      ordersErr: "",
      selectedCountryCode: "",
      selectedCountryName: "",
      selected: {}, // key => {qty, item}
      extra: [], // {name, qty}
      client: { first: "", last: "", phone: "", email: "" },
      mapWidget: null,
      countryIndex: [],
      tableSearch: "",
      routineSearch: "",
      stockSearch: "",
      dbSearch: ""
    };
  }

  // ------------------------------------------------------------
  // API calls
  // ------------------------------------------------------------
  async function apiGet(path) {
    return E.api(path, { method: "GET" });
  }

  async function apiPost(path, data) {
    return E.api(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data || {})
    });
  }

  async function loadCatalog(S) {
    S.catalogErr = "";
    try {
      var r = await apiGet("/vaccines/catalog");
      if (!r || !r.ok) throw new Error("Failed to load catalog");
      S.catalog = (r.items || []).slice();
      S.catalogLoaded = true;
    } catch (e) {
      S.catalogErr = safe(e && e.message ? e.message : e);
      S.catalogLoaded = true;
    }
  }

  async function loadStock(S) {
    S.stockErr = "";
    try {
      var r = await apiGet("/vaccines/stock");
      if (!r || !r.ok) throw new Error("Failed to load stock");
      S.stock = (r.items || []).slice();
      S.stockLoaded = true;
    } catch (e) {
      S.stockErr = safe(e && e.message ? e.message : e);
      S.stockLoaded = true;
    }
  }

  async function loadOrders(S) {
    S.ordersErr = "";
    try {
      var r = await apiGet("/vaccines/orders?limit=200");
      if (!r || !r.ok) throw new Error("Failed to load orders");
      S.orders = (r.items || []).slice();
      S.ordersLoaded = true;
    } catch (e) {
      S.ordersErr = safe(e && e.message ? e.message : e);
      S.ordersLoaded = true;
    }
  }

  // ------------------------------------------------------------
  // Country index for search (ISO2 -> name)
  // ------------------------------------------------------------
  function buildCountryIndex() {
    var codes = [];
    try {
      var seen = new Set();

      // Use Intl supported regions if possible
      if (window.Intl && typeof Intl.DisplayNames === "function" && Intl.supportedValuesOf) {
        var regs = Intl.supportedValuesOf("region") || [];
        regs.forEach(function (cc) {
          cc = iso2Valid(cc);
          if (!cc || seen.has(cc)) return;
          seen.add(cc);
          codes.push(cc);
        });
      }
    } catch (e) {}

    // Fallback: just common travel ones
    if (!codes.length) {
      codes = ["US", "CA", "MX", "BR", "AR", "GB", "IE", "FR", "DE", "ES", "IT", "GR", "TR", "EG", "ZA", "NG", "KE", "IN", "CN", "JP", "KR", "TH", "VN", "ID", "AU", "NZ"];
    }

    var dn = null;
    try {
      if (window.Intl && typeof Intl.DisplayNames === "function") {
        dn = new Intl.DisplayNames(["en"], { type: "region" });
      }
    } catch (e2) { dn = null; }

    var out = codes.map(function (cc) {
      var name = cc;
      try { if (dn) name = dn.of(cc) || cc; } catch (e3) {}
      return { code: cc, name: name };
    });

    out.sort(function (a, b) {
      return a.name.localeCompare(b.name);
    });

    return out;
  }

  // ------------------------------------------------------------
  // Selection logic
  // ------------------------------------------------------------
  function clearSelection(S) {
    S.selected = {};
    S.extra = [];
  }

  function addExtra(S, name, qty) {
    name = safe(name).trim();
    if (!name) return;
    qty = toInt(qty, 1);
    if (qty < 1) qty = 1;

    S.extra.push({ name: name, qty: qty });
  }

  function selectedItemsList(S) {
    var items = [];
    Object.keys(S.selected || {}).forEach(function (k) {
      var it = S.selected[k];
      if (!it || !it.item) return;
      var qty = toInt(it.qty, 1);
      if (qty < 1) qty = 1;
      items.push({
        name: it.item.brand_name,
        qty: qty,
        catalog_id: it.item.id,
        vaccinates_for: it.item.vaccinates_for || "",
        dosing_schedule: it.item.dosing_schedule || ""
      });
    });

    (S.extra || []).forEach(function (x) {
      if (!x || !x.name) return;
      items.push({
        name: x.name,
        qty: toInt(x.qty, 1) || 1,
        catalog_id: null,
        vaccinates_for: "",
        dosing_schedule: ""
      });
    });

    return items;
  }

  function computeTravelRecommendations(S, countryCode) {
    var cc = iso2Valid(countryCode);
    if (!cc) return { always: [], high: [] };

    var always = [];
    var high = [];
    var cat = S.catalog || [];

    cat.forEach(function (it) {
      if (!it) return;
      var a = safe(it.travel_always).toUpperCase();
      var h = safe(it.travel_highrisk).toUpperCase();
      var incA = a.split(",").map(function (x) { return safe(x).trim(); }).filter(Boolean);
      var incH = h.split(",").map(function (x) { return safe(x).trim(); }).filter(Boolean);

      if (incA.indexOf(cc) !== -1) always.push(it);
      if (incH.indexOf(cc) !== -1) high.push(it);
    });

    // stable ordering
    always.sort(function (x, y) { return safe(x.brand_name).localeCompare(safe(y.brand_name)); });
    high.sort(function (x, y) { return safe(x.brand_name).localeCompare(safe(y.brand_name)); });

    return { always: always, high: high };
  }

  function computeRoutineList(S) {
    // Anything not travel-specific; show everything, but routine in Malta first
    var out = (S.catalog || []).slice();
    out.sort(function (a, b) {
      var ra = safe(a.routine_in_malta).toLowerCase() === "yes" ? 0 : 1;
      var rb = safe(b.routine_in_malta).toLowerCase() === "yes" ? 0 : 1;
      if (ra !== rb) return ra - rb;
      return safe(a.brand_name).localeCompare(safe(b.brand_name));
    });
    return out;
  }

  // ------------------------------------------------------------
  // Printing helpers (reuse core printing if available)
  // ------------------------------------------------------------
  function printHtml(title, html, pageSize) {
    try {
      // If core has a print helper, use it
      if (E && E.printHtml) {
        return E.printHtml(title, html, pageSize);
      }
    } catch (e) {}

    // Fallback: new window
    var w = window.open("", "_blank");
    if (!w) return;

    w.document.open();
    w.document.write("<!doctype html><html><head><meta charset='utf-8'/>");
    w.document.write("<title>" + safe(title) + "</title>");
    w.document.write("<style>body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;margin:0;padding:12px}h1{font-size:16px;margin:0 0 10px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #ddd;padding:6px;font-size:12px}th{background:#f6f6f6} .muted{opacity:.75}</style>");
    if (pageSize === "receipt") {
      w.document.write("<style>@page{size:75mm auto;margin:6mm} body{padding:0 6mm}</style>");
    } else if (pageSize === "a4") {
      w.document.write("<style>@page{size:A4;margin:12mm}</style>");
    }
    w.document.write("</head><body>");
    w.document.write(html);
    w.document.write("</body></html>");
    w.document.close();
    setTimeout(function () { w.focus(); w.print(); }, 200);
  }

  function askPrintSizeAndPrint(title, html) {
    // Simple prompt: A4 or Receipt
    var choice = "a4";
    try {
      choice = window.prompt("Print size? Type A4 or R (receipt)", "A4") || "A4";
    } catch (e) {}
    choice = safe(choice).trim().toLowerCase();
    var ps = (choice === "r" || choice.indexOf("rec") === 0) ? "receipt" : "a4";
    printHtml(title, html, ps);
  }

  function buildOrderPrintHtml(S, order) {
    var items = (order && order.items) ? order.items : selectedItemsList(S);
    var dt = (order && order.created_at) ? order.created_at : new Date().toISOString();
    var c = (order && order.client) ? order.client : S.client;

    var rows = items.map(function (x) {
      return "<tr><td><b>" + safe(x.name) + "</b><div class='muted'>" + safe(x.vaccinates_for || "") + "</div><div class='muted'>" + safe(x.dosing_schedule || "") + "</div></td><td style='width:70px;text-align:right'>" + toInt(x.qty, 1) + "</td></tr>";
    }).join("");

    return "" +
      "<h1>Vaccine Order</h1>" +
      "<div class='muted'>Date/time: " + safe(dt).replace("T", " ").slice(0, 19) + "</div>" +
      "<div style='margin-top:10px'><b>Client:</b> " + safe(c.first) + " " + safe(c.last) + "</div>" +
      "<div><b>Phone:</b> " + safe(c.phone) + "</div>" +
      (c.email ? "<div><b>Email:</b> " + safe(c.email) + "</div>" : "") +
      "<div style='margin-top:12px'><table><thead><tr><th>Vaccine</th><th>Qty</th></tr></thead><tbody>" +
      rows +
      "</tbody></table></div>";
  }

  function buildTablePrintHtml(title, headers, rows) {
    var th = headers.map(function (h) { return "<th>" + safe(h) + "</th>"; }).join("");
    var trs = rows.map(function (r) {
      return "<tr>" + r.map(function (c) { return "<td>" + safe(c) + "</td>"; }).join("") + "</tr>";
    }).join("");
    return "<h1>" + safe(title) + "</h1>" +
      "<div style='margin-top:10px'><table><thead><tr>" + th + "</tr></thead><tbody>" + trs + "</tbody></table></div>";
  }

  // ------------------------------------------------------------
  // Stock helpers
  // ------------------------------------------------------------
  function stockKey(item) {
    return item && item.catalog_id ? ("c:" + item.catalog_id) : ("n:" + slug(item.name || ""));
  }

  function indexStock(S) {
    var idx = {};
    (S.stock || []).forEach(function (r) {
      var k = r && r.catalog_id ? ("c:" + r.catalog_id) : ("n:" + slug(r.name || ""));
      if (!k) return;
      idx[k] = r;
    });
    return idx;
  }

  // ------------------------------------------------------------
  // UI: Travel Tab
  // ------------------------------------------------------------
  function renderTravelTab(S, root, paint) {
    var hero = el("div", { class: "vax-card vax-hero" });
    var inner = el("div", { class: "vax-heroInner" });

    // Left: controls
    var left = el("div", {});
    var hTitle = el("div", { html: "<h3 style='margin:0;font-size:16px'>Travel vaccines</h3><div class='vax-sub'>Pick a country to instantly see recommended vaccines, build an order, print, and save.</div>" });
    left.appendChild(hTitle);

    // Search input
    var search = el("input", { class: "vax-input", placeholder: "Search country (e.g. Italy, Kenya, Japan)..." });
    var btnUse = el("button", { class: "vax-btn primary", text: "Use country" });

    // datalist suggestions
    var dlId = "vax-country-" + Math.random().toString(16).slice(2);
    var dl = el("datalist", { id: dlId });
    search.setAttribute("list", dlId);

    function fillDatalist(q) {
      dl.innerHTML = "";
      q = safe(q).trim().toLowerCase();
      var items = (S.countryIndex || []).filter(function (c) {
        if (!q) return true;
        return c.name.toLowerCase().indexOf(q) !== -1 || c.code.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 18);
      items.forEach(function (c) {
        var o = document.createElement("option");
        o.value = c.name;
        o.setAttribute("data-code", c.code);
        dl.appendChild(o);
      });
    }

    fillDatalist("");

    search.addEventListener("input", debounce(function () {
      fillDatalist(search.value);
    }, 80));

    // Choose country helper
    function parseCountryFromInput(v) {
      v = safe(v).trim();
      if (!v) return null;
      // if user typed "IT" (two-letter)
      var iso = iso2Valid(v);
      if (iso) {
        var found = null;
        (S.countryIndex || []).some(function (c) { if (c.code === iso) { found = c; return true; } return false; });
        return found || { code: iso, name: iso };
      }
      // match by name
      var q = v.toLowerCase();
      var hit = null;
      (S.countryIndex || []).some(function (c) {
        if (c.name.toLowerCase() === q) { hit = c; return true; }
        return false;
      });
      if (hit) return hit;

      // partial match
      (S.countryIndex || []).some(function (c) {
        if (c.name.toLowerCase().indexOf(q) !== -1) { hit = c; return true; }
        return false;
      });
      return hit || null;
    }

    function selectCountry(code, name) {
      code = iso2Valid(code);
      if (!code) return;
      S.selectedCountryCode = code;
      S.selectedCountryName = name || code;

      // map select
      if (S.mapWidget && S.mapWidget.select) {
        S.mapWidget.select(code, true);
      }

      paint();
    }

    btnUse.addEventListener("click", function () {
      var c = parseCountryFromInput(search.value);
      if (!c) return toast("Country not found");
      selectCountry(c.code, c.name);
    });

    search.addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") {
        ev.preventDefault();
        btnUse.click();
      }
    });

    left.appendChild(el("div", { style: "height:10px" }));
    left.appendChild(search);
    left.appendChild(dl);
    left.appendChild(el("div", { style: "height:10px" }));
    left.appendChild(btnUse);

    var kpis = el("div", { class: "vax-kpis" });
    kpis.appendChild(el("div", { class: "vax-pill", html: "<b>Catalog</b> " + (S.catalog || []).length + " vaccines" }));
    kpis.appendChild(el("div", { class: "vax-pill", html: "<b>Stock</b> " + (S.stock || []).length + " rows" }));
    kpis.appendChild(el("div", { class: "vax-pill", html: "<b>Selected</b> " + (S.selectedCountryName || "None") + (S.selectedCountryCode ? " (" + S.selectedCountryCode + ")" : "") }));
    left.appendChild(kpis);

    // Right: map
    var mapWrap = el("div", {});
      var mapPickFn = function (cc, mapName) {
        // click on map selects
        cc = String(cc || "").toUpperCase();
        var name = String(mapName || "").trim();

        if (!name) {
          try {
            if (window.Intl && typeof Intl.DisplayNames === "function") {
              var dn = new Intl.DisplayNames(["en"], { type: "region" });
              name = dn.of(cc) || cc;
            } else {
              var found = null;
              (S.countryIndex || []).some(function (c) { if (c.code === cc) { found = c; return true; } return false; });
              if (found) name = found.name;
              else name = cc;
            }
          } catch (e) { name = cc; }
        }

        selectCountry(cc, name);
      };

      if (!S.mapWidget) S.mapWidget = createWorldMapWidget(mapPickFn);
      else if (S.mapWidget.setOnPick) S.mapWidget.setOnPick(mapPickFn);

      mapWrap.appendChild(S.mapWidget.el);

    inner.appendChild(left);
    inner.appendChild(mapWrap);
    hero.appendChild(inner);
    root.appendChild(hero);

    // Recommendations + order pane (full width left; order on right)
    var grid2 = el("div", { class: "grid2" });

    // Recommended card
    var recCard = el("div", { class: "vax-card recCard" });
    var head = el("div", { class: "recHead" });
    head.appendChild(el("div", { html: "<h3>Recommended vaccines</h3><div class='vax-sub'>Filtered by country • Select vaccines & quantities</div>" }));

    var btnClear = el("button", { class: "vax-btn", text: "Clear selection" });
    btnClear.addEventListener("click", function () {
      clearSelection(S);
      paint();
    });
    head.appendChild(btnClear);
    recCard.appendChild(head);

    var recs = computeTravelRecommendations(S, S.selectedCountryCode);

    var cols = el("div", { class: "recCols" });

    function buildVaxItem(it) {
      var key = "c:" + it.id;
      var wrap = el("div", { class: "vaxItem" });

      var left = el("div", {});
      left.appendChild(el("div", { class: "nm", text: it.brand_name }));
      left.appendChild(el("div", { class: "sub", text: (it.vaccinates_for || "") }));
      if (it.dosing_schedule) left.appendChild(el("div", { class: "sub", text: it.dosing_schedule }));

      // routine tag
      if (safe(it.routine_in_malta).toLowerCase() === "yes") {
        left.appendChild(el("div", { class: "tag ok", html: "✓ Routine in Malta" }));
      } else {
        left.appendChild(el("div", { class: "tag", html: "• Not routine" }));
      }

      var right = el("div", { class: "qty" });
      var chk = el("input", { type: "checkbox" });
      chk.checked = !!S.selected[key];
      chk.addEventListener("change", function () {
        if (chk.checked) {
          S.selected[key] = { qty: 1, item: it };
        } else {
          delete S.selected[key];
        }
        paint();
      });

      var qty = el("input", { type: "number", class: "vaxQty", value: (S.selected[key] ? S.selected[key].qty : 1) });
      qty.min = "1";
      qty.addEventListener("change", function () {
        var n = clamp(toInt(qty.value, 1), 1, 999);
        qty.value = n;
        if (!S.selected[key]) {
          S.selected[key] = { qty: n, item: it };
        } else {
          S.selected[key].qty = n;
        }
        paint();
      });

      right.appendChild(chk);
      right.appendChild(qty);

      wrap.appendChild(left);
      wrap.appendChild(right);
      return wrap;
    }

    var colA = el("div", { class: "recCol" });
    colA.appendChild(el("h4", { text: "Always recommended" }));
    if (!S.selectedCountryCode) {
      colA.appendChild(el("div", { class: "hint", text: "Select a country above to see recommendations." }));
    } else if (!recs.always.length) {
      colA.appendChild(el("div", { class: "hint", text: "No “always” recommendations found for " + S.selectedCountryName + "." }));
    } else {
      recs.always.forEach(function (it) { colA.appendChild(buildVaxItem(it)); });
    }

    var colH = el("div", { class: "recCol" });
    colH.appendChild(el("h4", { text: "High-risk areas" }));
    if (!S.selectedCountryCode) {
      colH.appendChild(el("div", { class: "hint", text: "Select a country above to see recommendations." }));
    } else if (!recs.high.length) {
      colH.appendChild(el("div", { class: "hint", text: "No “high-risk” recommendations found for " + S.selectedCountryName + "." }));
    } else {
      recs.high.forEach(function (it) { colH.appendChild(buildVaxItem(it)); });
    }

    cols.appendChild(colA);
    cols.appendChild(colH);
    recCard.appendChild(cols);

    grid2.appendChild(recCard);

    // Order card
    var orderCard = el("div", { class: "vax-card orderCard" });
    orderCard.appendChild(el("div", { html: "<h3>Create order</h3><div class='vax-sub'>Enter client details, add extra vaccines, print & save</div>" }));

    // Extra vaccines block
    var bExtra = el("div", { class: "orderBlock" });
    bExtra.appendChild(el("h4", { text: "Extra vaccines" }));

    var extraName = el("input", { class: "vax-input", placeholder: "Type vaccine name (suggestions)..." });
    var extraQty = el("input", { type: "number", class: "vaxQty", value: 1 });
    extraQty.min = "1";
    var btnAddExtra = el("button", { class: "vax-btn primary", text: "Add" });

    // suggestions datalist
    var dlxId = "vax-extra-" + Math.random().toString(16).slice(2);
    var dlx = el("datalist", { id: dlxId });
    extraName.setAttribute("list", dlxId);

    function fillExtraList(q) {
      dlx.innerHTML = "";
      q = safe(q).trim().toLowerCase();
      var cands = (S.catalog || []).map(function (it) { return it.brand_name; });
      cands = uniq(cands);
      cands = cands.filter(function (nm) {
        if (!q) return true;
        return nm.toLowerCase().indexOf(q) !== -1;
      }).slice(0, 18);
      cands.forEach(function (nm) {
        var o = document.createElement("option");
        o.value = nm;
        dlx.appendChild(o);
      });
    }
    fillExtraList("");

    extraName.addEventListener("input", debounce(function () {
      fillExtraList(extraName.value);
    }, 60));

    btnAddExtra.addEventListener("click", function () {
      addExtra(S, extraName.value, toInt(extraQty.value, 1));
      extraName.value = "";
      extraQty.value = "1";
      paint();
    });

    var rowE = el("div", { class: "vax-row" });
    rowE.appendChild(extraName);
    rowE.appendChild(extraQty);
    rowE.appendChild(btnAddExtra);
    bExtra.appendChild(rowE);
    bExtra.appendChild(dlx);
    bExtra.appendChild(el("div", { class: "hint", text: "Optional: add extra vaccines not listed above." }));

    // show extras
    if ((S.extra || []).length) {
      var exList = el("div", { style: "margin-top:10px" });
      (S.extra || []).forEach(function (x, idx) {
        var r = el("div", { class: "vaxItem" });
        r.appendChild(el("div", { class: "nm", text: x.name + " × " + x.qty }));
        var del = el("button", { class: "vax-btn danger", text: "Remove" });
        del.addEventListener("click", function () {
          S.extra.splice(idx, 1);
          paint();
        });
        r.appendChild(del);
        exList.appendChild(r);
      });
      bExtra.appendChild(exList);
    }

    orderCard.appendChild(bExtra);

    // Client block
    var bClient = el("div", { class: "orderBlock" });
    bClient.appendChild(el("h4", { text: "Client details" }));

    var inFirst = el("input", { class: "vax-input", placeholder: "Name", value: S.client.first });
    var inLast = el("input", { class: "vax-input", placeholder: "Surname", value: S.client.last });
    var inPhone = el("input", { class: "vax-input", placeholder: "Phone number", value: S.client.phone });
    var inEmail = el("input", { class: "vax-input", placeholder: "Email (optional)", value: S.client.email });

    inFirst.addEventListener("input", function () { S.client.first = inFirst.value; });
    inLast.addEventListener("input", function () { S.client.last = inLast.value; });
    inPhone.addEventListener("input", function () { S.client.phone = inPhone.value; });
    inEmail.addEventListener("input", function () { S.client.email = inEmail.value; });

    var rowC1 = el("div", { class: "row2" });
    rowC1.appendChild(inFirst);
    rowC1.appendChild(inLast);
    var rowC2 = el("div", { class: "row2" });
    rowC2.appendChild(inPhone);
    rowC2.appendChild(inEmail);

    bClient.appendChild(rowC1);
    bClient.appendChild(el("div", { style: "height:10px" }));
    bClient.appendChild(rowC2);

    orderCard.appendChild(bClient);

    // Action buttons
    var bAct = el("div", { class: "orderBlock" });
    bAct.appendChild(el("h4", { text: "Actions" }));

    var btnPrint = el("button", { class: "vax-btn", text: "Print order" });
    var btnSave = el("button", { class: "vax-btn primary", text: "Save order" });

    function validateOrder() {
      var items = selectedItemsList(S);
      if (!items.length) { toast("Select at least one vaccine"); return null; }
      if (!safe(S.client.first).trim() || !safe(S.client.last).trim()) { toast("Client name + surname required"); return null; }
      if (!safe(S.client.phone).trim()) { toast("Phone number required"); return null; }
      return items;
    }

    btnPrint.addEventListener("click", function () {
      var items = validateOrder();
      if (!items) return;
      var html = buildOrderPrintHtml(S, null);
      askPrintSizeAndPrint("Vaccine Order", html);
    });

    btnSave.addEventListener("click", async function () {
      var items = validateOrder();
      if (!items) return;

      var payload = {
        type: (S.tab === "travel") ? "travel" : "routine",
        country_code: S.selectedCountryCode || "",
        country_name: S.selectedCountryName || "",
        client_first: safe(S.client.first).trim(),
        client_last: safe(S.client.last).trim(),
        client_phone: safe(S.client.phone).trim(),
        client_email: safe(S.client.email).trim(),
        items: items.map(function (x) { return { name: x.name, qty: x.qty, catalog_id: x.catalog_id }; })
      };

      try {
        btnSave.disabled = true;
        var r = await apiPost("/vaccines/orders", payload);
        if (!r || !r.ok) throw new Error((r && r.error) ? r.error : "Failed to save order");
        toast("Order saved");
        await loadOrders(S);
        // subtract stock server-side already, reload stock
        await loadStock(S);
        clearSelection(S);
        paint();
      } catch (e) {
        toast("Save failed: " + safe(e && e.message ? e.message : e));
      } finally {
        btnSave.disabled = false;
      }
    });

    var actRow = el("div", { class: "vax-row" });
    actRow.appendChild(btnPrint);
    actRow.appendChild(btnSave);
    bAct.appendChild(actRow);
    bAct.appendChild(el("div", { class: "hint", text: "Saving also updates stock (if stock rows exist). Stock can go negative; you can correct it in Stock tab." }));

    orderCard.appendChild(bAct);

    grid2.appendChild(orderCard);
    root.appendChild(grid2);
  }

  // ------------------------------------------------------------
  // UI: Routine & Other Tab
  // ------------------------------------------------------------
  function renderRoutineTab(S, root, paint) {
    var card = el("div", { class: "vax-card" });
    card.appendChild(el("div", { html: "<h3 style='margin:0;font-size:16px'>Routine & Other vaccines</h3><div class='vax-sub'>Search/filter, print the table, and create orders (same as Travel).</div>" }));
    root.appendChild(card);

    // Table + search
    var tools = el("div", { class: "tblTools" });
    var search = el("input", { class: "vax-input", placeholder: "Search vaccines…", value: S.routineSearch || "" });
    var btnPrint = el("button", { class: "vax-btn", text: "Print table" });
    tools.appendChild(search);
    tools.appendChild(btnPrint);

    search.addEventListener("input", debounce(function () {
      S.routineSearch = search.value;
      paint();
    }, 80));

    var list = computeRoutineList(S);
    var q = safe(S.routineSearch).trim().toLowerCase();
    if (q) {
      list = list.filter(function (it) {
        return safe(it.brand_name).toLowerCase().indexOf(q) !== -1 ||
          safe(it.vaccinates_for).toLowerCase().indexOf(q) !== -1 ||
          safe(it.dosing_schedule).toLowerCase().indexOf(q) !== -1;
      });
    }

    btnPrint.addEventListener("click", function () {
      var rows = list.map(function (it) {
        return [it.brand_name, it.vaccinates_for || "", it.dosing_schedule || "", it.routine_in_malta || ""];
      });
      var html = buildTablePrintHtml("Routine & Other vaccines", ["Vaccine", "Vaccinates for", "Dosing schedule", "Routine in Malta"], rows);
      askPrintSizeAndPrint("Routine table", html);
    });

    card.appendChild(tools);

    var tbl = el("table", { class: "tbl" });
    var thead = el("thead", {});
    thead.innerHTML = "<tr><th>Vaccine</th><th>Vaccinates for</th><th>Dosing schedule</th><th>Routine in Malta</th></tr>";
    tbl.appendChild(thead);

    var tbody = el("tbody", {});
    list.forEach(function (it) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><b>" + safe(it.brand_name) + "</b></td>" +
        "<td>" + safe(it.vaccinates_for || "") + "</td>" +
        "<td>" + safe(it.dosing_schedule || "") + "</td>" +
        "<td>" + safe(it.routine_in_malta || "") + "</td>";
      tbody.appendChild(tr);
    });
    tbl.appendChild(tbody);
    card.appendChild(tbl);

    // Order section (reuse same UI as Travel, but no map)
    var grid2 = el("div", { class: "grid2" });

    var recCard = el("div", { class: "vax-card recCard" });
    recCard.appendChild(el("div", { class: "recHead", html: "<div><h3>Pick vaccines</h3><div class='vax-sub'>Select vaccines & quantities</div></div>" }));

    var cols = el("div", { class: "recCols" });
    var colAll = el("div", { class: "recCol" });
    colAll.appendChild(el("h4", { text: "All vaccines" }));

    list.slice(0, 200).forEach(function (it) {
      var key = "c:" + it.id;
      var wrap = el("div", { class: "vaxItem" });

      var left = el("div", {});
      left.appendChild(el("div", { class: "nm", text: it.brand_name }));
      left.appendChild(el("div", { class: "sub", text: it.vaccinates_for || "" }));
      if (it.dosing_schedule) left.appendChild(el("div", { class: "sub", text: it.dosing_schedule }));

      var right = el("div", { class: "qty" });
      var chk = el("input", { type: "checkbox" });
      chk.checked = !!S.selected[key];
      chk.addEventListener("change", function () {
        if (chk.checked) S.selected[key] = { qty: 1, item: it };
        else delete S.selected[key];
        paint();
      });

      var qty = el("input", { type: "number", class: "vaxQty", value: (S.selected[key] ? S.selected[key].qty : 1) });
      qty.min = "1";
      qty.addEventListener("change", function () {
        var n = clamp(toInt(qty.value, 1), 1, 999);
        qty.value = n;
        if (!S.selected[key]) S.selected[key] = { qty: n, item: it };
        else S.selected[key].qty = n;
        paint();
      });

      right.appendChild(chk);
      right.appendChild(qty);

      wrap.appendChild(left);
      wrap.appendChild(right);
      colAll.appendChild(wrap);
    });

    cols.appendChild(colAll);
    recCard.appendChild(cols);

    var orderCard = el("div", { class: "vax-card orderCard" });
    orderCard.appendChild(el("div", { html: "<h3>Create order</h3><div class='vax-sub'>Same order flow as Travel</div>" }));

    // Extra + client + actions (reuse from travel)
    // To avoid code duplication, we just render the Travel order panel by reusing selected state.
    // (Simple approach: call travel panel builder with no recs)
    // Here we provide a minimal subset for actions.
    var bClient = el("div", { class: "orderBlock" });
    bClient.appendChild(el("h4", { text: "Client details" }));
    var inFirst = el("input", { class: "vax-input", placeholder: "Name", value: S.client.first });
    var inLast = el("input", { class: "vax-input", placeholder: "Surname", value: S.client.last });
    var inPhone = el("input", { class: "vax-input", placeholder: "Phone number", value: S.client.phone });
    var inEmail = el("input", { class: "vax-input", placeholder: "Email (optional)", value: S.client.email });

    inFirst.addEventListener("input", function () { S.client.first = inFirst.value; });
    inLast.addEventListener("input", function () { S.client.last = inLast.value; });
    inPhone.addEventListener("input", function () { S.client.phone = inPhone.value; });
    inEmail.addEventListener("input", function () { S.client.email = inEmail.value; });

    var rowC1 = el("div", { class: "row2" });
    rowC1.appendChild(inFirst);
    rowC1.appendChild(inLast);
    var rowC2 = el("div", { class: "row2" });
    rowC2.appendChild(inPhone);
    rowC2.appendChild(inEmail);

    bClient.appendChild(rowC1);
    bClient.appendChild(el("div", { style: "height:10px" }));
    bClient.appendChild(rowC2);
    orderCard.appendChild(bClient);

    var bAct = el("div", { class: "orderBlock" });
    bAct.appendChild(el("h4", { text: "Actions" }));
    var btnP = el("button", { class: "vax-btn", text: "Print order" });
    var btnS = el("button", { class: "vax-btn primary", text: "Save order" });

    function validateOrder() {
      var items = selectedItemsList(S);
      if (!items.length) { toast("Select at least one vaccine"); return null; }
      if (!safe(S.client.first).trim() || !safe(S.client.last).trim()) { toast("Client name + surname required"); return null; }
      if (!safe(S.client.phone).trim()) { toast("Phone number required"); return null; }
      return items;
    }

    btnP.addEventListener("click", function () {
      var items = validateOrder();
      if (!items) return;
      var html = buildOrderPrintHtml(S, null);
      askPrintSizeAndPrint("Vaccine Order", html);
    });

    btnS.addEventListener("click", async function () {
      var items = validateOrder();
      if (!items) return;

      var payload = {
        type: "routine",
        country_code: "",
        country_name: "",
        client_first: safe(S.client.first).trim(),
        client_last: safe(S.client.last).trim(),
        client_phone: safe(S.client.phone).trim(),
        client_email: safe(S.client.email).trim(),
        items: items.map(function (x) { return { name: x.name, qty: x.qty, catalog_id: x.catalog_id }; })
      };

      try {
        btnS.disabled = true;
        var r = await apiPost("/vaccines/orders", payload);
        if (!r || !r.ok) throw new Error((r && r.error) ? r.error : "Failed to save order");
        toast("Order saved");
        await loadOrders(S);
        await loadStock(S);
        clearSelection(S);
        paint();
      } catch (e) {
        toast("Save failed: " + safe(e && e.message ? e.message : e));
      } finally {
        btnS.disabled = false;
      }
    });

    var actRow = el("div", { class: "vax-row" });
    actRow.appendChild(btnP);
    actRow.appendChild(btnS);
    bAct.appendChild(actRow);
    orderCard.appendChild(bAct);

    grid2.appendChild(recCard);
    grid2.appendChild(orderCard);
    root.appendChild(grid2);
  }

  // ------------------------------------------------------------
  // UI: Stock Tab
  // ------------------------------------------------------------
  function renderStockTab(S, root, paint) {
    var card = el("div", { class: "vax-card" });
    card.appendChild(el("div", { html: "<h3 style='margin:0;font-size:16px'>Stock</h3><div class='vax-sub'>Maintain optional stock quantities, batches & expiry. Orders subtract stock (can go negative).</div>" }));
    root.appendChild(card);

    var tools = el("div", { class: "tblTools" });
    var search = el("input", { class: "vax-input", placeholder: "Search stock…", value: S.stockSearch || "" });
    var btnReload = el("button", { class: "vax-btn", text: "Reload" });
    tools.appendChild(search);
    tools.appendChild(btnReload);

    search.addEventListener("input", debounce(function () {
      S.stockSearch = search.value;
      paint();
    }, 80));

    btnReload.addEventListener("click", async function () {
      await loadStock(S);
      paint();
    });

    card.appendChild(tools);

    var idx = indexStock(S);

    // Build combined view: catalog items (for easy entry) + existing stock rows
    var rows = (S.catalog || []).map(function (it) {
      var key = "c:" + it.id;
      var r = idx[key] || { id: null, catalog_id: it.id, name: it.brand_name, qty: 0, batch: "", expiry: "" };
      return {
        row_id: r.id,
        catalog_id: it.id,
        name: it.brand_name,
        qty: toInt(r.qty, 0),
        batch: safe(r.batch || ""),
        expiry: safe(r.expiry || "")
      };
    });

    // Also include stock rows that are free-typed (no catalog id)
    (S.stock || []).forEach(function (r) {
      if (r && !r.catalog_id && safe(r.name)) {
        rows.push({
          row_id: r.id,
          catalog_id: null,
          name: r.name,
          qty: toInt(r.qty, 0),
          batch: safe(r.batch || ""),
          expiry: safe(r.expiry || "")
        });
      }
    });

    var q = safe(S.stockSearch).trim().toLowerCase();
    if (q) {
      rows = rows.filter(function (r) {
        return safe(r.name).toLowerCase().indexOf(q) !== -1 ||
          safe(r.batch).toLowerCase().indexOf(q) !== -1 ||
          safe(r.expiry).toLowerCase().indexOf(q) !== -1;
      });
    }

    var tbl = el("table", { class: "tbl" });
    tbl.innerHTML = "<thead><tr><th>Vaccine</th><th style='width:110px'>Qty</th><th style='width:160px'>Batch (optional)</th><th style='width:160px'>Expiry (optional)</th><th style='width:110px'>Save</th></tr></thead>";
    var tb = el("tbody", {});
    tbl.appendChild(tb);

    rows.forEach(function (r) {
      var tr = document.createElement("tr");

      var tdNm = document.createElement("td");
      tdNm.innerHTML = "<b>" + safe(r.name) + "</b>";
      tr.appendChild(tdNm);

      var tdQty = document.createElement("td");
      var inQty = el("input", { type: "number", class: "vaxQty", value: r.qty });
      tdQty.appendChild(inQty);
      tr.appendChild(tdQty);

      var tdB = document.createElement("td");
      var inB = el("input", { class: "vax-input", value: r.batch, placeholder: "Batch" });
      inB.style.padding = "8px 10px";
      tdB.appendChild(inB);
      tr.appendChild(tdB);

      var tdE = document.createElement("td");
      var inE = el("input", { class: "vax-input", value: r.expiry, placeholder: "YYYY-MM-DD" });
      inE.style.padding = "8px 10px";
      tdE.appendChild(inE);
      tr.appendChild(tdE);

      var tdS = document.createElement("td");
      var btn = el("button", { class: "vax-btn primary", text: "Save" });
      tdS.appendChild(btn);
      tr.appendChild(tdS);

      btn.addEventListener("click", async function () {
        var payload = {
          id: r.row_id,
          catalog_id: r.catalog_id,
          name: r.name,
          qty: toInt(inQty.value, 0),
          batch: safe(inB.value).trim(),
          expiry: safe(inE.value).trim()
        };
        try {
          btn.disabled = true;
          var res = await apiPost("/vaccines/stock", payload);
          if (!res || !res.ok) throw new Error((res && res.error) ? res.error : "Save failed");
          toast("Saved");
          await loadStock(S);
          paint();
        } catch (e) {
          toast("Save failed: " + safe(e && e.message ? e.message : e));
        } finally {
          btn.disabled = false;
        }
      });

      tb.appendChild(tr);
    });

    card.appendChild(tbl);
  }

  // ------------------------------------------------------------
  // UI: Database Tab (catalog view + add-only)
  // ------------------------------------------------------------
  function renderDatabaseTab(S, root, paint) {
    var card = el("div", { class: "vax-card" });
    card.appendChild(el("div", { html: "<h3 style='margin:0;font-size:16px'>Database</h3><div class='vax-sub'>Catalog table. You can only add new vaccine names (other columns are locked).</div>" }));
    root.appendChild(card);

    var tools = el("div", { class: "tblTools" });
    var search = el("input", { class: "vax-input", placeholder: "Search catalog…", value: S.dbSearch || "" });
    var nameIn = el("input", { class: "vax-input", placeholder: "Add new vaccine name…" });
    var btnAdd = el("button", { class: "vax-btn primary", text: "Add vaccine" });
    tools.appendChild(search);
    tools.appendChild(nameIn);
    tools.appendChild(btnAdd);

    search.addEventListener("input", debounce(function () {
      S.dbSearch = search.value;
      paint();
    }, 80));

    btnAdd.addEventListener("click", async function () {
      var nm = safe(nameIn.value).trim();
      if (!nm) return toast("Enter a vaccine name");
      try {
        btnAdd.disabled = true;
        var r = await apiPost("/vaccines/catalog/add", { brand_name: nm });
        if (!r || !r.ok) throw new Error((r && r.error) ? r.error : "Add failed");
        toast("Added");
        nameIn.value = "";
        await loadCatalog(S);
        paint();
      } catch (e) {
        toast("Add failed: " + safe(e && e.message ? e.message : e));
      } finally {
        btnAdd.disabled = false;
      }
    });

    card.appendChild(tools);

    var list = (S.catalog || []).slice();
    var q = safe(S.dbSearch).trim().toLowerCase();
    if (q) {
      list = list.filter(function (it) {
        return safe(it.brand_name).toLowerCase().indexOf(q) !== -1 ||
          safe(it.vaccinates_for).toLowerCase().indexOf(q) !== -1 ||
          safe(it.dosing_schedule).toLowerCase().indexOf(q) !== -1;
      });
    }

    var tbl = el("table", { class: "tbl" });
    tbl.innerHTML = "<thead><tr><th>Vaccine name</th><th>Vaccinates for</th><th>Dosing schedule</th><th>Routine in Malta</th><th>Travel always</th><th>Travel high-risk</th></tr></thead>";
    var tb = el("tbody", {});
    tbl.appendChild(tb);

    list.forEach(function (it) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        "<td><b>" + safe(it.brand_name) + "</b></td>" +
        "<td>" + safe(it.vaccinates_for || "") + "</td>" +
        "<td>" + safe(it.dosing_schedule || "") + "</td>" +
        "<td>" + safe(it.routine_in_malta || "") + "</td>" +
        "<td><span class='muted'>" + safe(it.travel_always || "") + "</span></td>" +
        "<td><span class='muted'>" + safe(it.travel_highrisk || "") + "</span></td>";
      tb.appendChild(tr);
    });

    card.appendChild(tbl);
  }

  // ------------------------------------------------------------
  // Main render
  // ------------------------------------------------------------
  function render(ctx) {
    ensureStyles();

    var S = makeState();
    S.countryIndex = buildCountryIndex();

    var root = el("div", { class: "vax-root" });

    function paint() {
      root.innerHTML = "";

      // Title bar
      var titleRow = el("div", { class: "vax-titleRow" });
      var left = el("div", {});
      left.appendChild(el("h2", { text: "Vaccines" }));
      left.appendChild(el("div", { class: "vax-sub", text: "Travel • Routine & Other • Stock • Database" }));
      titleRow.appendChild(left);

      var tabs = el("div", { class: "vax-tabs" });
      function tabBtn(id, label, ico) {
        var b = el("div", { class: "vax-tabBtn" + (S.tab === id ? " active" : ""), html: "<span class='ico'>" + ico + "</span><span>" + label + "</span>" });
        b.addEventListener("click", function () {
          S.tab = id;
          paint();
        });
        return b;
      }

      tabs.appendChild(tabBtn("travel", "Travel", "🌐"));
      tabs.appendChild(tabBtn("routine", "Routine & Other", "💉"));
      tabs.appendChild(tabBtn("stock", "Stock", "📦"));
      tabs.appendChild(tabBtn("db", "Database", "🗄️"));
      titleRow.appendChild(tabs);
      root.appendChild(titleRow);

      // Loaders hints
      if (!S.catalogLoaded) {
        root.appendChild(el("div", { class: "vax-card", html: "<b>Loading catalog…</b>" }));
      }
      if (!S.stockLoaded) {
        root.appendChild(el("div", { class: "vax-card", html: "<b>Loading stock…</b>" }));
      }

      if (S.catalogErr) root.appendChild(el("div", { class: "vax-card", html: "<b style='color:#ff9bb8'>Catalog error:</b> " + safe(S.catalogErr) }));
      if (S.stockErr) root.appendChild(el("div", { class: "vax-card", html: "<b style='color:#ff9bb8'>Stock error:</b> " + safe(S.stockErr) }));

      // Tabs
      if (S.tab === "travel") renderTravelTab(S, root, paint);
      else if (S.tab === "routine") renderRoutineTab(S, root, paint);
      else if (S.tab === "stock") renderStockTab(S, root, paint);
      else if (S.tab === "db") renderDatabaseTab(S, root, paint);

      // If a country is already selected, reflect it on map without recreating
      if (S.tab === "travel" && S.mapWidget && S.selectedCountryCode) {
        try { S.mapWidget.select(S.selectedCountryCode, true); } catch (e) {}
      }
    }

    (async function init() {
      try {
        await loadCatalog(S);
        await loadStock(S);
        await loadOrders(S);
      } catch (e) {}
      paint();
    })();

    ctx.body.appendChild(root);
  }

  // ------------------------------------------------------------
  // Register module
  // ------------------------------------------------------------
  if (E && E.registerModule) {
    E.registerModule({
      id: "vaccines",
      title: "Vaccines",
      icon: "💉",
      route: "#vaccines",
      render: render
    });
  }
})();
