/* ui/modules.vaccines.js
   Eikon - Vaccines module (UI)

   Fixes in this version:
   - Real interactive world map (countries) with pop-out selection + color shift
   - Recommended vaccines section spans full width (no more squashed)
*/

(function () {
  "use strict";

  var E = window.EIKON;
  var VAX_MODULE_VERSION = "2026-02-21-3";

  try {
    if (E && E.dbg) E.dbg("[vaccines] loaded v", VAX_MODULE_VERSION);
  } catch (e) {}

  if (!E) throw new Error("EIKON core missing (modules.vaccines.js)");

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function esc(s) {
    return E.escapeHtml(String(s == null ? "" : s));
  }

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
    if (kids && kids.length) kids.forEach(function (c) { if (c) n.appendChild(c); });
    return n;
  }

  function btn(label, cls, onClick) {
    var b = el("button", { type: "button", class: cls || "btn", text: label });
    if (onClick) b.addEventListener("click", onClick);
    return b;
  }

  function input(type, placeholder, value) {
    var i = el("input", { type: type || "text", placeholder: placeholder || "" });
    if (value != null) i.value = String(value);
    return i;
  }

  function toInt(v, def) {
    var n = parseInt(String(v == null ? "" : v), 10);
    return Number.isFinite(n) ? n : (def == null ? 0 : def);
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  function norm(s) {
    return String(s || "").trim().toLowerCase();
  }

  async function apiJson(method, path, bodyObj) {
    var opts = { method: method, headers: {} };
    if (bodyObj !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(bodyObj || {});
    }
    var data = await E.apiFetch(path, opts); // core.js returns parsed JSON
    if (data && data.ok === false) {
      var msg = (data && (data.error || data.message)) ? (data.error || data.message) : "Request failed";
      var err = new Error(msg);
      err._data = data;
      err._status = 200;
      throw err;
    }
    return data;
  }

  function modalError(title, err) {
    var msg = String((err && (err.message || err)) || "Error");
    var extra = "";
    try {
      if (err && err._data && err._data.error && err._data.error !== msg) extra = "\n" + String(err._data.error);
    } catch (e) {}
    E.modal.show(title || "Error",
      "<div style='white-space:pre-wrap'>" + esc(msg + extra) + "</div>",
      [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
    );
  }

  function toast(text) {
    ensureStyles();
    var t = el("div", { class: "vax-toast", text: text || "" });
    document.body.appendChild(t);
    setTimeout(function () { t.classList.add("show"); }, 20);
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { try { t.remove(); } catch (e) {} }, 280);
    }, 2200);
  }

  // ------------------------------------------------------------
  // Styles
  // ------------------------------------------------------------
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return;
    stylesDone = true;

    var css =
      ".vax-root{--vax-accent:rgba(90,168,255,.85);--vax-pink:rgba(255,92,165,.85);--vax-green:rgba(44,210,152,.8)}" +
      ".vax-root .hdr{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:12px}" +
      ".vax-root h2{margin:0;font-size:18px;letter-spacing:.2px}" +
      ".vax-root .meta{margin-top:3px;color:var(--muted);font-size:12px}" +
      ".vax-root .tabs{display:flex;gap:8px;flex-wrap:wrap}" +
      ".vax-root .tab{border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);padding:8px 10px;border-radius:12px;cursor:pointer;font-size:13px;display:inline-flex;align-items:center;gap:8px;user-select:none;transition:transform .08s ease,background .12s ease,border-color .12s ease}" +
      ".vax-root .tab:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}" +
      ".vax-root .tab:active{transform:translateY(1px)}" +
      ".vax-root .tab.active{background:rgba(90,168,255,.12);border-color:rgba(90,168,255,.6)}" +

      // Layout: hero full width; recommended full width; then table+order grid
      ".vax-root .grid2{display:grid;grid-template-columns:1.2fr .8fr;gap:12px;align-items:start}" +
      "@media(max-width:980px){.vax-root .grid2{grid-template-columns:1fr}}" +

      ".vax-root .hero{position:relative;overflow:hidden;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(90,168,255,.14),rgba(255,92,165,.10),rgba(44,210,152,.08));box-shadow:0 10px 30px rgba(0,0,0,.28)}" +
      ".vax-root .heroInner{display:grid;grid-template-columns:1fr 460px;gap:14px;padding:14px;align-items:center}" +
      "@media(max-width:980px){.vax-root .heroInner{grid-template-columns:1fr}}" +
      ".vax-root .heroTitle{font-size:18px;font-weight:900;letter-spacing:.2px;margin:0 0 2px 0}" +
      ".vax-root .heroSub{color:rgba(233,238,247,.78);font-size:12px;margin:0 0 10px 0}" +
      ".vax-root .searchRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".vax-root .input{width:100%;min-width:220px;max-width:520px;background:rgba(10,14,20,.35);border:1px solid rgba(255,255,255,.14);color:var(--text);padding:10px 12px;border-radius:12px;outline:none}" +
      ".vax-root .input:focus{border-color:rgba(90,168,255,.6);box-shadow:0 0 0 3px rgba(90,168,255,.12)}" +
      ".vax-root .btn{border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);padding:10px 12px;border-radius:12px;cursor:pointer;transition:transform .08s ease,background .12s ease,border-color .12s ease;user-select:none;display:inline-flex;align-items:center;gap:8px;font-size:13px}" +
      ".vax-root .btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}" +
      ".vax-root .btn:active{transform:translateY(1px)}" +
      ".vax-root .btn.primary{background:rgba(90,168,255,.14);border-color:rgba(90,168,255,.6)}" +
      ".vax-root .btn.pink{background:rgba(255,92,165,.12);border-color:rgba(255,92,165,.55)}" +
      ".vax-root .btn.green{background:rgba(44,210,152,.12);border-color:rgba(44,210,152,.55)}" +

      ".vax-root .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.22);font-size:12px;color:rgba(233,238,247,.86)}" +
      ".vax-root .pill b{color:var(--text)}" +

      ".vax-root .box{border:1px solid rgba(255,255,255,.10);border-radius:16px;background:rgba(0,0,0,.14);padding:12px}" +
      ".vax-root .box h3{margin:0 0 8px 0;font-size:13px;letter-spacing:.2px}" +
      ".vax-root .split{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "@media(max-width:980px){.vax-root .split{grid-template-columns:1fr}}" +

      ".vax-root .list{display:flex;flex-direction:column;gap:8px}" +
      ".vax-root .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".vax-root .item{display:flex;gap:10px;align-items:center;justify-content:space-between;padding:10px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(10,14,20,.22)}" +
      ".vax-root .item:hover{border-color:rgba(255,255,255,.18);background:rgba(10,14,20,.30)}" +
      ".vax-root .item .nm{font-weight:800}" +
      ".vax-root .item .sub{font-size:12px;color:rgba(233,238,247,.72);margin-top:2px}" +
      ".vax-root .qty{width:72px;max-width:92px;background:rgba(10,14,20,.35);border:1px solid rgba(255,255,255,.14);color:var(--text);padding:8px 10px;border-radius:12px;outline:none;text-align:center}" +
      ".vax-root .tag{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:11px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:rgba(233,238,247,.86)}" +
      ".vax-root .tag.yes{border-color:rgba(44,210,152,.55);background:rgba(44,210,152,.10)}" +
      ".vax-root .tag.no{border-color:rgba(255,92,165,.50);background:rgba(255,92,165,.08)}" +

      ".vax-root table{width:100%;border-collapse:collapse;font-size:13px}" +
      ".vax-root th,.vax-root td{padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}" +
      ".vax-root th{position:sticky;top:0;background:rgba(0,0,0,.20);backdrop-filter:blur(8px);text-align:left;font-size:12px;color:rgba(233,238,247,.78)}" +
      ".vax-root .muted{color:var(--muted)}" +

      // Map shell
      ".vax-root .mapShell{position:relative;border-radius:18px;border:1px solid rgba(255,255,255,.14);background:radial-gradient(circle at 25% 25%,rgba(255,255,255,.10),rgba(90,168,255,.06) 35%,rgba(0,0,0,.20) 72%,rgba(0,0,0,.28));overflow:hidden;box-shadow:inset -18px -18px 60px rgba(0,0,0,.28), 0 12px 40px rgba(0,0,0,.35)}" +
      ".vax-root .mapPad{padding:10px}" +
      ".vax-root .mapInner{position:relative;overflow:hidden;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(0,0,0,.14))}" +
      ".vax-root .mapInner svg{display:block;width:100%;height:auto;max-height:320px;margin:auto;filter:drop-shadow(0 14px 22px rgba(0,0,0,.35))}" +
      ".vax-root .mapHud{position:absolute;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.28);backdrop-filter:blur(8px);font-size:12px;color:rgba(233,238,247,.9);text-align:center}" +
      ".vax-root .mapLoading{padding:22px 14px;color:rgba(233,238,247,.78);font-size:12px}" +
      ".vax-root .mapHint{margin-top:8px;color:rgba(233,238,247,.62);font-size:11px}" +

      // Country styling (applied to SVG elements after load)
      ".vax-root .vax-country{stroke:rgba(0,0,0,.22);stroke-width:.6;vector-effect:non-scaling-stroke;cursor:pointer;transition:transform .18s ease, filter .18s ease, opacity .18s ease}" +
      ".vax-root .vax-country:hover{filter:brightness(1.10) saturate(1.15)}" +
      ".vax-root .vax-country.dim{opacity:.28}" +
      ".vax-root .vax-country.selected{filter:drop-shadow(0 10px 12px rgba(0,0,0,.35)) brightness(1.15) saturate(1.22);transform-box:fill-box;transform-origin:center;transform:translateY(-3px) scale(1.06)}" +
      ".vax-root .vax-country.selected{stroke:rgba(255,255,255,.65);stroke-width:1.1}" +

      // Toast
      ".vax-toast{position:fixed;left:50%;bottom:18px;transform:translate(-50%,12px);opacity:0;z-index:99999;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.78);backdrop-filter:blur(10px);color:rgba(233,238,247,.92);font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.45);transition:opacity .25s ease,transform .25s ease}" +
      ".vax-toast.show{opacity:1;transform:translate(-50%,0)}";

    var st = document.createElement("style");
    st.setAttribute("data-vax-styles", "1");
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Country index
  // ------------------------------------------------------------
  function buildCountryIndexFromIntl() {
    try {
      if (!window.Intl || typeof Intl.DisplayNames !== "function") return null;
      if (typeof Intl.supportedValuesOf !== "function") return null;
      var dn = new Intl.DisplayNames(["en"], { type: "region" });
      var codes = Intl.supportedValuesOf("region") || [];
      var out = [];
      var seen = {};
      codes.forEach(function (cc) {
        if (!cc || !/^[A-Z]{2}$/.test(cc)) return;
        if (seen[cc]) return;
        seen[cc] = 1;
        out.push({ code: cc, name: dn.of(cc) || cc });
      });
      out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      return out;
    } catch (e) {
      return null;
    }
  }

  function buildCountryIndexFromCatalog(catalog) {
    try {
      if (!window.Intl || typeof Intl.DisplayNames !== "function") return [];
      var dn = new Intl.DisplayNames(["en"], { type: "region" });
      var codes = {};
      (catalog || []).forEach(function (v) {
        [v.travel_always, v.travel_highrisk].forEach(function (s) {
          String(s || "").split(",").forEach(function (cc) {
            cc = (cc || "").trim().toUpperCase();
            if (/^[A-Z]{2}$/.test(cc)) codes[cc] = 1;
          });
        });
      });
      var arr = Object.keys(codes).map(function (cc) {
        return { code: cc, name: dn.of(cc) || cc };
      });
      arr.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      return arr;
    } catch (e) {
      return [];
    }
  }

  // ------------------------------------------------------------
  // Vaccine logic
  // ------------------------------------------------------------
  function isRoutine(v) {
    return String(v && v.routine_in_malta || "").toLowerCase().indexOf("yes") >= 0;
  }

  function isTravelVax(v) {
    var a = String(v && v.travel_always || "").trim();
    var h = String(v && v.travel_highrisk || "").trim();
    return !!(a || h);
  }

  function csvHasCountry(csv, code) {
    var cc = String(code || "").trim().toUpperCase();
    if (!cc) return false;
    var s = String(csv || "").toUpperCase();
    return ("," + s.replace(/\s+/g, "") + ",").indexOf("," + cc + ",") >= 0;
  }

  function getVaxByName(catalog, name) {
    var n = String(name || "").trim().toLowerCase();
    if (!n) return null;
    for (var i = 0; i < catalog.length; i++) {
      var b = String(catalog[i].brand_name || "").trim().toLowerCase();
      if (b === n) return catalog[i];
    }
    return null;
  }

  // ------------------------------------------------------------
  // Printing (kept same style as your other modules)
  // ------------------------------------------------------------
  function choosePrintSize(title, onPick) {
    var body =
      "<div style='color:rgba(233,238,247,.85);font-size:13px;line-height:1.45'>" +
      "Choose paper size:</div>";
    E.modal.show(title || "Print", body, [
      { label: "A4", primary: true, onClick: function () { E.modal.hide(); onPick("A4"); } },
      { label: "Receipt (75mm)", onClick: function () { E.modal.hide(); onPick("RECEIPT"); } },
      { label: "Cancel", onClick: function () { E.modal.hide(); } }
    ]);
  }

  function openPrintHtml(html) {
    var w = window.open("", "_blank");
    if (!w) { toast("Popup blocked"); return; }
    try { w.document.open(); w.document.write(html); w.document.close(); } catch (e) {}
    try { w.focus(); } catch (e2) {}
    setTimeout(function () { try { w.print(); } catch (e3) {} }, 120);
  }

  function buildPrintShell(title, bodyHtml, size) {
    var isReceipt = (size === "RECEIPT");
    var pageCss = isReceipt
      ? "@page{size:75mm auto;margin:6mm}"
      : "@page{size:A4;margin:12mm}";
    var base =
      "html,body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;}" +
      "h1{margin:0 0 10px 0;font-size:18px}" +
      "table{width:100%;border-collapse:collapse;font-size:12px}" +
      "th,td{border-bottom:1px solid #ddd;padding:6px 6px;vertical-align:top}" +
      "th{text-align:left;background:#f6f6f6}" +
      ".muted{color:#666}" +
      ".row{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}" +
      ".pill{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:3px 8px;font-size:11px;background:#fafafa}";
    return (
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<title>" + esc(title || "Print") + "</title>" +
      "<style>" + pageCss + base + "</style>" +
      "</head><body>" + bodyHtml + "</body></html>"
    );
  }

  function buildOrderPrintHtml(order, size) {
    var title = "Vaccine order";
    var items = (order && order.items) ? order.items : [];
    var rows = items.map(function (it) {
      return "<tr><td><b>" + esc(it.name || "") + "</b><div class='muted'>" + esc(it.info || "") + "</div></td><td style='text-align:right'>" + esc(it.qty || 1) + "</td></tr>";
    }).join("");

    var countryLine = order.country_name ? "<span class='pill'><b>Country</b> " + esc(order.country_name) + " (" + esc(order.country_code || "") + ")</span>" : "";
    var secLine = "<span class='pill'><b>Section</b> " + esc(order.section || "") + "</span>";

    var body =
      "<h1>" + esc(title) + "</h1>" +
      "<div class='row'>" +
      "<span class='pill'><b>Created</b> " + esc(order.created_at || "") + "</span>" +
      secLine + countryLine +
      "</div>" +
      "<div style='margin:10px 0'>" +
      "<div><b>Client:</b> " + esc((order.client_first || "") + " " + (order.client_last || "")).trim() + "</div>" +
      "<div><b>Phone:</b> " + esc(order.phone || "") + "</div>" +
      (order.email ? "<div><b>Email:</b> " + esc(order.email) + "</div>" : "") +
      (order.location_name ? "<div><b>Location:</b> " + esc(order.location_name) + "</div>" : "") +
      "</div>" +
      "<table><thead><tr><th>Vaccine</th><th style='text-align:right'>Qty</th></tr></thead><tbody>" +
      (rows || "<tr><td colspan='2' class='muted'>No items</td></tr>") +
      "</tbody></table>";

    return buildPrintShell(title, body, size);
  }

  function buildTablePrintHtml(title, rows, size) {
    rows = rows || [];
    var body =
      "<h1>" + esc(title) + "</h1>" +
      "<div class='muted' style='margin-bottom:8px'>Generated " + esc(nowIso()) + "</div>" +
      "<table><thead><tr>" +
      "<th>Vaccine</th><th>Vaccinates for</th><th>Schedule</th><th>Routine</th>" +
      "</tr></thead><tbody>" +
      (rows.length ? rows.map(function (r) {
        return "<tr>" +
          "<td><b>" + esc(r.brand_name || "") + "</b></td>" +
          "<td>" + esc(r.vaccinates_for || "") + "</td>" +
          "<td>" + esc(r.dosing_schedule || "") + "</td>" +
          "<td>" + esc(isRoutine(r) ? "Yes" : "No") + "</td>" +
          "</tr>";
      }).join("") : "<tr><td colspan='4' class='muted'>No rows</td></tr>") +
      "</tbody></table>";

    return buildPrintShell(title, body, size);
  }

  // ------------------------------------------------------------
  // World map (real countries) – fetched + cached
  // ------------------------------------------------------------
  var MAP_CACHE_KEY = "eikon_vax_worldsvg_v1";
  var MAP_CACHE_TS_KEY = "eikon_vax_worldsvg_v1_ts";
  var MAP_CACHE_TTL_MS = 1000 * 60 * 60 * 24 * 21; // 21 days
  var MAP_URLS = [
    // Nice, small, ISO-2 ids
    "https://simplemaps.com/static/demos/resources/svg-library/svgs/world.svg"
  ];

  function sanitizeSvg(doc) {
    try {
      // remove scripts + foreignObject
      Array.prototype.slice.call(doc.querySelectorAll("script, foreignObject")).forEach(function (n) { n.remove(); });
      // remove inline event handlers
      Array.prototype.slice.call(doc.querySelectorAll("*")).forEach(function (n) {
        Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
          if (!a || !a.name) return;
          if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        });
      });
    } catch (e) {}
    return doc;
  }

  async function loadWorldSvgText() {
    try {
      var ts = toInt(localStorage.getItem(MAP_CACHE_TS_KEY), 0);
      var cached = localStorage.getItem(MAP_CACHE_KEY);
      if (cached && ts && (Date.now() - ts) < MAP_CACHE_TTL_MS) return cached;
    } catch (e) {}

    // Fetch
    for (var i = 0; i < MAP_URLS.length; i++) {
      try {
        var r = await fetch(MAP_URLS[i], { method: "GET", mode: "cors", cache: "force-cache" });
        if (!r || !r.ok) continue;
        var txt = await r.text();
        if (!txt || txt.length < 500) continue;
        try {
          localStorage.setItem(MAP_CACHE_KEY, txt);
          localStorage.setItem(MAP_CACHE_TS_KEY, String(Date.now()));
        } catch (e2) {}
        return txt;
      } catch (e3) {}
    }
    return null;
  }

  function paletteColor(code) {
    // deterministic palette
    var pal = [
      "#ff7aa2", "#ffb86b", "#ffd36b", "#b9f27c", "#7cf2d3",
      "#6bbcff", "#9b8bff", "#ff6be7", "#ff8f6b", "#6bffa3",
      "#6be7ff", "#b86bff"
    ];
    var s = String(code || "");
    var h = 0;
    for (var i = 0; i < s.length; i++) h = ((h << 5) - h) + s.charCodeAt(i);
    h = Math.abs(h);
    return pal[h % pal.length];
  }

  function buildFallbackGlobe() {
    // decorative fallback (the old one)
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

  function createWorldMapWidget(onPickCountry) {
    ensureStyles();

    var shell = el("div", { class: "mapShell" });
    var pad = el("div", { class: "mapPad" });
    var inner = el("div", { class: "mapInner" });

    var hud = el("div", { class: "mapHud", text: "Loading world map…" });
    var loading = el("div", { class: "mapLoading", html: "<b>Loading map…</b><div class='mapHint'>First load may take a second. After that it’s cached.</div>" });

    inner.appendChild(loading);
    pad.appendChild(inner);
    shell.appendChild(pad);
    shell.appendChild(hud);

    var state = {
      svgEl: null,
      selected: ""
    };

    function setHud(text) {
      hud.textContent = text || "";
    }

    function applyCountryClasses(svgEl) {
      // Identify country nodes by id (ISO2) – handle uppercase/lowercase
      var nodes = Array.prototype.slice.call(svgEl.querySelectorAll("[id]"));
      nodes.forEach(function (n) {
        var id = String(n.getAttribute("id") || "").trim();
        if (!/^[A-Za-z]{2}$/.test(id)) return;
        n.classList.add("vax-country");
        // store normalized code
        n.setAttribute("data-cc", id.toUpperCase());
        // color
        n.style.fill = paletteColor(id.toUpperCase());
      });
    }

    function clearSelected() {
      if (!state.svgEl) return;
      var prev = state.svgEl.querySelectorAll(".vax-country.selected");
      Array.prototype.forEach.call(prev, function (n) { n.classList.remove("selected"); });
      var dim = state.svgEl.querySelectorAll(".vax-country.dim");
      Array.prototype.forEach.call(dim, function (n) { n.classList.remove("dim"); });
    }

    function selectCountry(code, dimOthers) {
      code = String(code || "").toUpperCase();
      state.selected = code;
      if (!state.svgEl) return;

      clearSelected();

      if (!code) {
        return;
      }

      // dim others for focus (optional)
      if (dimOthers) {
        var all = state.svgEl.querySelectorAll(".vax-country");
        Array.prototype.forEach.call(all, function (n) { n.classList.add("dim"); });
      }

      var targets = state.svgEl.querySelectorAll('.vax-country[data-cc="' + code + '"]');
      if (!targets || !targets.length) return;

      Array.prototype.forEach.call(targets, function (n) {
        n.classList.remove("dim");
        n.classList.add("selected");
        // bring to front
        try { n.parentNode.appendChild(n); } catch (e) {}
      });
    }

    function bindClick(svgEl) {
      svgEl.addEventListener("click", function (ev) {
        var t = ev.target;
        if (!t) return;
        var node = t.closest ? t.closest(".vax-country") : t;
        if (!node || !node.classList || !node.classList.contains("vax-country")) return;
        var cc = String(node.getAttribute("data-cc") || "").toUpperCase();
        if (!cc) return;
        onPickCountry && onPickCountry(cc);
      });
    }

    (async function boot() {
      try {
        var txt = await loadWorldSvgText();
        if (!txt) throw new Error("Map unavailable");

        var dp = new DOMParser();
        var doc = dp.parseFromString(txt, "image/svg+xml");
        doc = sanitizeSvg(doc);

        var svgEl = doc.documentElement;
        if (!svgEl || svgEl.nodeName.toLowerCase() !== "svg") throw new Error("Bad SVG");

        // Ensure viewBox exists (some SVGs rely on width/height)
        if (!svgEl.getAttribute("viewBox")) {
          var w = svgEl.getAttribute("width");
          var h = svgEl.getAttribute("height");
          if (w && h) svgEl.setAttribute("viewBox", "0 0 " + parseFloat(w) + " " + parseFloat(h));
        }

        inner.innerHTML = "";
        inner.appendChild(svgEl);
        state.svgEl = svgEl;

        applyCountryClasses(svgEl);
        bindClick(svgEl);

        setHud("Click a country on the map, or search by name above.");
      } catch (e) {
        // fallback
        inner.innerHTML = "";
        inner.appendChild(buildFallbackGlobe());
        setHud("Map failed to load. Using fallback globe.");
      }
    })();

    return {
      el: shell,
      setHud: setHud,
      select: selectCountry,
      clear: clearSelected
    };
  }

  // ------------------------------------------------------------
  // Module state
  // ------------------------------------------------------------
  function makeState(user) {
    return {
      user: user || null,
      active: "travel",
      catalog: [],
      stockRows: [],
      catalogLoadedAt: "",
      stockLoadedAt: "",
      countryIndex: null,

      selectedCountryCode: "",
      selectedCountryName: "",

      selectedTravel: {},
      selectedOther: {},
      extra: [],

      client_first: "",
      client_last: "",
      phone: "",
      email: "",

      travelSearch: "",
      otherSearch: "",
      stockSearch: "",
      dbSearch: "",

      // map widget handle
      mapWidget: null
    };
  }

  // ------------------------------------------------------------
  // UI Rendering
  // ------------------------------------------------------------
  function render(ctx) {
    ensureStyles();

    var mount = ctx.mount;
    mount.innerHTML = "";

    var S = makeState(ctx.user);

    var root = el("div", { class: "vax-root" });

    // Header
    var headerCard = el("div", { class: "eikon-card" });
    var hdr = el("div", { class: "hdr" });

    var left = el("div", {});
    left.appendChild(el("h2", { text: "Vaccines" }));
    left.appendChild(el("div", { class: "meta", text: "Travel • Routine & Other • Stock • Database" }));

    var tabs = el("div", { class: "tabs" });
    function mkTab(id, label, icon) {
      var b = el("div", { class: "tab", "data-tab": id, html: "<span>" + esc(icon) + "</span><span>" + esc(label) + "</span>" });
      b.addEventListener("click", function () { S.active = id; paint(); });
      return b;
    }
    tabs.appendChild(mkTab("travel", "Travel", "🌍"));
    tabs.appendChild(mkTab("other", "Routine & Other", "💉"));
    tabs.appendChild(mkTab("stock", "Stock", "📦"));
    tabs.appendChild(mkTab("db", "Database", "🗄️"));

    hdr.appendChild(left);
    hdr.appendChild(tabs);
    headerCard.appendChild(hdr);
    root.appendChild(headerCard);

    var body = el("div", {});
    root.appendChild(body);
    mount.appendChild(root);

    // Bootstrap load
    (async function bootstrap() {
      try {
        await refreshCatalog();
        await refreshStock();
        paint();
      } catch (e) {
        try { E.error && E.error("[vaccines] bootstrap failed:", e); } catch (_e) {}
        paint();
      }
    })();

    async function refreshCatalog() {
      var data = await apiJson("GET", "/vaccines/catalog", undefined);
      S.catalog = (data && data.items) ? data.items : [];
      S.catalogLoadedAt = nowIso();
      S.countryIndex = buildCountryIndexFromIntl() || buildCountryIndexFromCatalog(S.catalog);
    }

    async function refreshStock() {
      var data = await apiJson("GET", "/vaccines/stock/rows", undefined);
      S.stockRows = (data && data.rows) ? data.rows : [];
      S.stockLoadedAt = nowIso();
    }

    function setActiveTabStyles() {
      var btns = root.querySelectorAll(".tab");
      Array.prototype.forEach.call(btns, function (b) {
        var id = b.getAttribute("data-tab");
        b.classList.toggle("active", id === S.active);
      });
    }

    function paint() {
      setActiveTabStyles();
      body.innerHTML = "";
      if (S.active === "travel") body.appendChild(renderTravelTab());
      else if (S.active === "other") body.appendChild(renderOtherTab());
      else if (S.active === "stock") body.appendChild(renderStockTab());
      else body.appendChild(renderDbTab());
    }

    // ----------------------------------------------------------
    // Travel tab (UPDATED LAYOUT + REAL MAP)
    // ----------------------------------------------------------
    function renderTravelTab() {
      var wrap = el("div", {});

      // HERO
      var hero = el("div", { class: "hero" });
      var inner = el("div", { class: "heroInner" });

      var info = el("div", {});
      info.appendChild(el("div", { class: "heroTitle", text: "Travel vaccines" }));
      info.appendChild(el("div", { class: "heroSub", text: "Search or click a country to see recommended vaccines. The selected country pops out." }));

      var countryInput = input("text", "Search country (e.g. Italy, Kenya, Japan)…", "");
      countryInput.className = "input";
      countryInput.style.maxWidth = "520px";

      var suggestBox = el("div", { class: "row", style: "gap:6px" });

      function renderSuggestions(q) {
        suggestBox.innerHTML = "";
        q = norm(q);
        if (!q) return;
        var list = (S.countryIndex || []).filter(function (c) {
          return norm(c.name).indexOf(q) >= 0 || norm(c.code).indexOf(q) >= 0;
        }).slice(0, 10);

        if (!list.length) {
          suggestBox.appendChild(el("div", { class: "muted", text: "No matches" }));
          return;
        }

        list.forEach(function (c) {
          suggestBox.appendChild(btn(c.name + " (" + c.code + ")", "btn", function () {
            selectCountry(c.code, c.name);
          }));
        });
      }

      countryInput.addEventListener("input", function () {
        renderSuggestions(countryInput.value);
      });

      countryInput.addEventListener("keydown", function (ev) {
        if (ev.key === "Enter") {
          ev.preventDefault();
          // try exact parse
          var t = String(countryInput.value || "").trim();
          if (!t) return;
          var m = t.match(/\(([A-Za-z]{2})\)\s*$/);
          var code = m ? m[1].toUpperCase() : "";
          if (!code) {
            // try exact name match
            var hit = null;
            var lc = t.toLowerCase();
            (S.countryIndex || []).some(function (c) {
              if (String(c.name || "").toLowerCase() === lc) { hit = c; return true; }
              return false;
            });
            if (hit) selectCountry(hit.code, hit.name);
            else toast("Pick a country from suggestions");
          } else {
            // find name
            var found = null;
            (S.countryIndex || []).some(function (c) { if (c.code === code) { found = c; return true; } return false; });
            selectCountry(code, found ? found.name : code);
          }
        }
      });

      function selectCountry(code, name) {
        S.selectedCountryCode = String(code || "").toUpperCase();
        S.selectedCountryName = String(name || "").trim() || S.selectedCountryCode;
        countryInput.value = S.selectedCountryName + " (" + S.selectedCountryCode + ")";
        suggestBox.innerHTML = "";
        // pop-out on map
        if (S.mapWidget) {
          S.mapWidget.select(S.selectedCountryCode, true);
          S.mapWidget.setHud(S.selectedCountryName + " (" + S.selectedCountryCode + ") — click another country to change");
        }
        paint();
      }

      var controls = el("div", { class: "searchRow" }, [
        countryInput,
        btn("Clear", "btn", function () {
          S.selectedCountryCode = "";
          S.selectedCountryName = "";
          countryInput.value = "";
          suggestBox.innerHTML = "";
          if (S.mapWidget) {
            S.mapWidget.clear();
            S.mapWidget.setHud("Click a country on the map, or search by name above.");
          }
          paint();
        })
      ]);

      info.appendChild(controls);
      info.appendChild(suggestBox);

      var pills = el("div", { class: "row", style: "margin-top:10px;gap:8px" });
      pills.appendChild(el("span", { class: "pill", html: "<b>Catalog</b> " + esc(S.catalog.length) + " vaccines" }));
      pills.appendChild(el("span", { class: "pill", html: "<b>Stock rows</b> " + esc(S.stockRows.length) }));
      pills.appendChild(el("span", { class: "pill", html: "<b>Selected</b> " + esc(S.selectedCountryCode ? (S.selectedCountryName + " (" + S.selectedCountryCode + ")") : "None") }));
      info.appendChild(pills);

      // MAP
      var mapWrap = el("div", {});
      var mapWidget = createWorldMapWidget(function (cc) {
        // click on map selects
        var name = cc;
        try {
          if (window.Intl && typeof Intl.DisplayNames === "function") {
            var dn = new Intl.DisplayNames(["en"], { type: "region" });
            name = dn.of(cc) || cc;
          } else {
            // try from index
            var found = null;
            (S.countryIndex || []).some(function (c) { if (c.code === cc) { found = c; return true; } return false; });
            if (found) name = found.name;
          }
        } catch (e) {}
        selectCountry(cc, name);
      });
      S.mapWidget = mapWidget;
      mapWrap.appendChild(mapWidget.el);

      // if already selected, apply selection (e.g. returning to tab)
      if (S.selectedCountryCode) {
        setTimeout(function () {
          try {
            if (S.mapWidget) {
              S.mapWidget.select(S.selectedCountryCode, true);
              S.mapWidget.setHud(S.selectedCountryName + " (" + S.selectedCountryCode + ")");
            }
          } catch (e) {}
        }, 50);
      }

      inner.appendChild(info);
      inner.appendChild(mapWrap);
      hero.appendChild(inner);
      wrap.appendChild(hero);

      // --------------------------------------------------------
      // RECOMMENDED (NOW FULL WIDTH)
      // --------------------------------------------------------
      var recCard = el("div", { class: "eikon-card", style: "margin-top:12px" });
      recCard.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Recommended vaccines</b><div class='muted' style='font-size:12px;margin-top:2px'>Filtered by country • Select vaccines & quantities</div>" }),
        btn("Clear selection", "btn", function () { S.selectedTravel = {}; S.extra = []; paint(); })
      ]));

      var split = el("div", { class: "split" });

      var alwaysBox = el("div", { class: "box" });
      alwaysBox.appendChild(el("h3", { text: "Always recommended" }));
      var alwaysList = el("div", { class: "list" });

      var highBox = el("div", { class: "box" });
      highBox.appendChild(el("h3", { text: "High-risk areas" }));
      var highList = el("div", { class: "list" });

      if (!S.selectedCountryCode) {
        alwaysList.appendChild(el("div", { class: "muted", text: "Choose a country above to see recommendations." }));
        highList.appendChild(el("div", { class: "muted", text: "Choose a country above to see recommendations." }));
      } else {
        var rec = computeTravelRecommendations(S.selectedCountryCode);
        renderSelectableList(alwaysList, rec.always, S.selectedTravel);
        renderSelectableList(highList, rec.high, S.selectedTravel);
        if (!rec.always.length && !rec.high.length) {
          alwaysList.appendChild(el("div", { class: "muted", text: "No travel recommendations in database for this country code." }));
        }
      }

      alwaysBox.appendChild(alwaysList);
      highBox.appendChild(highList);
      split.appendChild(alwaysBox);
      split.appendChild(highBox);
      recCard.appendChild(split);
      wrap.appendChild(recCard);

      // --------------------------------------------------------
      // BELOW: Travel table + Order (GRID)
      // --------------------------------------------------------
      var grid2 = el("div", { class: "grid2", style: "margin-top:12px" });

      // Travel table card
      var tableCard = el("div", { class: "eikon-card" });
      tableCard.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Travel vaccines table</b><div class='muted' style='font-size:12px;margin-top:2px'>Search filters as you type</div>" }),
        btn("Print…", "btn", function () {
          choosePrintSize("Print table", function (size) {
            var rows = getTravelTableRowsFiltered();
            openPrintHtml(buildTablePrintHtml("Travel vaccines", rows, size));
          });
        })
      ]));

      var tSearch = input("text", "Search travel table…", S.travelSearch || "");
      tSearch.className = "input";
      tSearch.style.maxWidth = "360px";
      tSearch.addEventListener("input", function () { S.travelSearch = tSearch.value; paint(); });
      tableCard.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [tSearch]));
      tableCard.appendChild(buildVaxTable(getTravelTableRowsFiltered(), function (r) {
        var nm = r.brand_name || "";
        if (!nm) return;
        S.selectedTravel[nm] = S.selectedTravel[nm] ? (S.selectedTravel[nm] + 1) : 1;
        toast("Added: " + nm);
        paint();
      }));

      // Order card (unchanged logic)
      var rightCard = el("div", { class: "eikon-card" });
      rightCard.appendChild(el("div", { html: "<b>Create order</b><div class='muted' style='font-size:12px;margin-top:2px'>Enter client details, add extra vaccines, print & save</div>" }));

      // Extra vaccines
      var extraBox = el("div", { class: "box", style: "margin-top:10px" });
      extraBox.appendChild(el("h3", { text: "Extra vaccines" }));

      var extraRow = el("div", { class: "row" });
      var extraInput = input("text", "Type vaccine name (suggestions)…", "");
      extraInput.className = "input";
      extraInput.setAttribute("list", "vax-vaccine-datalist");
      extraInput.style.maxWidth = "360px";

      var vdl = el("datalist", { id: "vax-vaccine-datalist" });
      (S.catalog || []).forEach(function (v) {
        var nm = String(v.brand_name || "").trim();
        if (!nm) return;
        vdl.appendChild(el("option", { value: nm }));
      });

      var extraQty = input("number", "Qty", "1");
      extraQty.className = "qty";
      extraQty.min = "1";
      extraQty.step = "1";

      var addExtra = btn("Add", "btn green", function () {
        var nm = String(extraInput.value || "").trim();
        if (!nm) { toast("Type a vaccine name"); return; }
        var q = toInt(extraQty.value, 1);
        if (q <= 0) q = 1;
        S.extra.push({ name: nm, qty: q });
        extraInput.value = "";
        extraQty.value = "1";
        paint();
      });

      extraRow.appendChild(extraInput);
      extraRow.appendChild(extraQty);
      extraRow.appendChild(addExtra);
      extraBox.appendChild(extraRow);
      extraBox.appendChild(vdl);

      if (S.extra.length) {
        var exList = el("div", { class: "list", style: "max-height:180px;margin-top:10px;overflow:auto" });
        S.extra.forEach(function (it, idx) {
          var line = el("div", { class: "item" });
          line.appendChild(el("div", { html: "<div class='nm'>" + esc(it.name) + "</div><div class='sub'>Extra item</div>" }));
          var qx = input("number", "", it.qty);
          qx.className = "qty";
          qx.min = "1";
          qx.step = "1";
          qx.addEventListener("change", function () { it.qty = Math.max(1, toInt(qx.value, 1)); });
          var rm = btn("✕", "btn pink", function () { S.extra.splice(idx, 1); paint(); });
          rm.title = "Remove";
          line.appendChild(el("div", { style: "margin-left:auto;display:flex;gap:8px;align-items:center" }, [qx, rm]));
          exList.appendChild(line);
        });
        extraBox.appendChild(exList);
      } else {
        extraBox.appendChild(el("div", { class: "muted", text: "Optional: add extra vaccines not listed above." }));
      }

      rightCard.appendChild(extraBox);

      // Client details
      var form = el("div", { class: "box", style: "margin-top:10px" });
      form.appendChild(el("h3", { text: "Client details" }));

      var f1 = input("text", "Name", S.client_first || "");
      var f2 = input("text", "Surname", S.client_last || "");
      var f3 = input("text", "Phone number", S.phone || "");
      var f4 = input("email", "Email (optional)", S.email || "");
      [f1, f2, f3, f4].forEach(function (i) { i.className = "input"; i.style.maxWidth = "100%"; });

      f1.addEventListener("input", function () { S.client_first = f1.value; });
      f2.addEventListener("input", function () { S.client_last = f2.value; });
      f3.addEventListener("input", function () { S.phone = f3.value; });
      f4.addEventListener("input", function () { S.email = f4.value; });

      form.appendChild(el("div", { class: "row" }, [el("div", { class: "grow" }, [f1]), el("div", { class: "grow" }, [f2])]));
      form.appendChild(el("div", { class: "row" }, [el("div", { class: "grow" }, [f3]), el("div", { class: "grow" }, [f4])]));

      var actions = el("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" });
      var savePrint = btn("Print & Save order…", "btn primary", function () { choosePrintSize("Print order", function (size) { doCreateOrder("travel", size); }); });
      var quickSave = btn("Save only", "btn", function () { doCreateOrder("travel", null); });
      actions.appendChild(quickSave);
      actions.appendChild(savePrint);
      form.appendChild(actions);

      rightCard.appendChild(form);

      // Selected summary
      var summary = el("div", { class: "box", style: "margin-top:10px" });
      summary.appendChild(el("h3", { text: "Order items" }));

      var items = collectOrderItems(S.selectedTravel, S.extra);
      if (!items.length) {
        summary.appendChild(el("div", { class: "muted", text: "No items selected yet." }));
      } else {
        var list = el("div", { class: "list", style: "max-height:260px;overflow:auto" });
        items.forEach(function (it) {
          var v = getVaxByName(S.catalog, it.name);
          var sub = v ? (String(v.vaccinates_for || "") + (v.dosing_schedule ? (" • " + v.dosing_schedule) : "")) : "";
          var row = el("div", { class: "item" });
          row.appendChild(el("div", { html: "<div class='nm'>" + esc(it.name) + "</div><div class='sub'>" + esc(sub) + "</div>" }));
          var q = input("number", "", it.qty);
          q.className = "qty";
          q.min = "1";
          q.step = "1";
          q.addEventListener("change", function () {
            var nn = Math.max(1, toInt(q.value, 1));
            if (S.selectedTravel[it.name] != null) { S.selectedTravel[it.name] = nn; paint(); }
            else {
              for (var j = 0; j < S.extra.length; j++) if (S.extra[j].name === it.name) S.extra[j].qty = nn;
            }
          });
          row.appendChild(el("div", { style: "margin-left:auto" }, [q]));
          list.appendChild(row);
        });
        summary.appendChild(list);
      }
      rightCard.appendChild(summary);

      grid2.appendChild(tableCard);
      grid2.appendChild(rightCard);

      wrap.appendChild(grid2);
      return wrap;
    }

    function computeTravelRecommendations(countryCode) {
      var always = [];
      var high = [];
      (S.catalog || []).forEach(function (v) {
        if (!isTravelVax(v)) return;
        if (csvHasCountry(v.travel_always, countryCode)) always.push(v);
        else if (csvHasCountry(v.travel_highrisk, countryCode)) high.push(v);
      });
      function byName(a, b) { return String(a.brand_name || "").localeCompare(String(b.brand_name || "")); }
      always.sort(byName);
      high.sort(byName);
      return { always: always, high: high };
    }

    function renderSelectableList(container, rows, selectedMap) {
      container.innerHTML = "";
      (rows || []).forEach(function (v) {
        var nm = String(v.brand_name || "").trim();
        if (!nm) return;

        var it = el("div", { class: "item" });

        var cb = input("checkbox", "", "");
        cb.checked = selectedMap[nm] != null;
        cb.addEventListener("change", function () {
          if (cb.checked) selectedMap[nm] = selectedMap[nm] || 1;
          else delete selectedMap[nm];
          paint();
        });

        var desc = el("div", {});
        var sub = String(v.vaccinates_for || "");
        if (v.dosing_schedule) sub += (sub ? " • " : "") + String(v.dosing_schedule || "");
        desc.appendChild(el("div", { class: "nm", text: nm }));
        desc.appendChild(el("div", { class: "sub", text: sub }));
        desc.appendChild(el("div", { style: "margin-top:6px;display:flex;gap:8px;flex-wrap:wrap" }, [
          el("span", { class: "tag " + (isRoutine(v) ? "yes" : "no"), html: (isRoutine(v) ? "✅ Routine in Malta" : "• Not routine") })
        ]));

        var qty = input("number", "Qty", selectedMap[nm] != null ? selectedMap[nm] : 1);
        qty.className = "qty";
        qty.min = "1";
        qty.step = "1";
        qty.addEventListener("change", function () {
          var q = Math.max(1, toInt(qty.value, 1));
          if (cb.checked) { selectedMap[nm] = q; paint(); }
        });

        it.appendChild(cb);
        it.appendChild(desc);
        it.appendChild(el("div", { style: "margin-left:auto" }, [qty]));

        container.appendChild(it);
      });
    }

    function collectOrderItems(selectedMap, extraArr) {
      var out = [];
      var keys = Object.keys(selectedMap || {});
      keys.sort(function (a, b) { return String(a).localeCompare(String(b)); });
      keys.forEach(function (nm) {
        var q = Math.max(1, toInt(selectedMap[nm], 1));
        out.push({ name: nm, qty: q });
      });
      (extraArr || []).forEach(function (it) {
        var nm = String(it.name || "").trim();
        if (!nm) return;
        var q = Math.max(1, toInt(it.qty, 1));
        // merge duplicates (stock/order)
        var found = null;
        for (var i = 0; i < out.length; i++) if (out[i].name === nm) { found = out[i]; break; }
        if (found) found.qty += q;
        else out.push({ name: nm, qty: q });
      });
      return out;
    }

    async function doCreateOrder(section, printSizeOrNull) {
      try {
        var items = collectOrderItems(section === "travel" ? S.selectedTravel : S.selectedOther, S.extra);
        if (!items.length) { toast("Select at least one vaccine"); return; }

        var cf = String(S.client_first || "").trim();
        var cl = String(S.client_last || "").trim();
        var ph = String(S.phone || "").trim();
        var em = String(S.email || "").trim();

        if (!cf || !cl) { toast("Enter client name and surname"); return; }
        if (!ph) { toast("Enter phone number"); return; }

        var payload = {
          section: section,
          country_code: section === "travel" ? (S.selectedCountryCode || "") : "",
          country_name: section === "travel" ? (S.selectedCountryName || "") : "",
          client_first: cf,
          client_last: cl,
          phone: ph,
          email: em,
          items: items
        };

        var data = await apiJson("POST", "/vaccines/orders", payload);
        toast("Saved order #" + String(data.order && data.order.id || data.order_id || ""));

        await refreshStock();

        if (section === "travel") S.selectedTravel = {};
        else S.selectedOther = {};
        S.extra = [];

        if (printSizeOrNull) {
          var order = data.order || {};
          var enriched = (order.items || items).map(function (it) {
            var v = getVaxByName(S.catalog, it.name);
            var info = v ? (String(v.vaccinates_for || "") + (v.dosing_schedule ? (" • " + v.dosing_schedule) : "")) : "";
            return { name: it.name, qty: it.qty, info: info };
          });
          order.items = enriched;
          order.location_name = (S.user && S.user.location_name) ? S.user.location_name : "";
          openPrintHtml(buildOrderPrintHtml(order, printSizeOrNull));
        }

        paint();
      } catch (e) {
        modalError("Order failed", e);
      }
    }

    function buildVaxTable(rows, onPickRow) {
      rows = rows || [];
      var wrapper = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px" });
      var table = el("table", {});
      table.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Vaccine" }),
        el("th", { text: "Vaccinates for" }),
        el("th", { text: "Schedule" }),
        el("th", { text: "Routine" }),
        el("th", { text: "" })
      ])]));
      var tbody = el("tbody", {});
      if (!rows.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", class: "muted", text: "No rows." })]));
      } else {
        rows.forEach(function (r) {
          var tr = el("tr", {});
          tr.appendChild(el("td", { html: "<b>" + esc(r.brand_name || "") + "</b>" }));
          tr.appendChild(el("td", { text: String(r.vaccinates_for || "") }));
          tr.appendChild(el("td", { text: String(r.dosing_schedule || "") }));
          tr.appendChild(el("td", { html: "<span class='tag " + (isRoutine(r) ? "yes" : "no") + "'>" + (isRoutine(r) ? "Yes" : "No") + "</span>" }));
          var act = el("td", {});
          if (onPickRow) act.appendChild(btn("Add", "btn", function () { onPickRow(r); }));
          tr.appendChild(act);
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    }

    function getTravelTableRowsFiltered() {
      var q = String(S.travelSearch || "").trim().toLowerCase();
      var rows = (S.catalog || []).filter(isTravelVax);
      if (!q) return rows;
      return rows.filter(function (r) {
        var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
        return s.indexOf(q) >= 0;
      });
    }

    // ----------------------------------------------------------
    // Routine & Other (unchanged)
    // ----------------------------------------------------------
    function renderOtherTab() {
      var wrap = el("div", {});
      var card = el("div", { class: "eikon-card" });

      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Routine & other (non-travel) vaccines</b><div class='muted' style='font-size:12px;margin-top:2px'>Search • Select vaccines & quantities • Create an order</div>" }),
        btn("Clear selection", "btn", function () { S.selectedOther = {}; S.extra = []; paint(); })
      ]));

      var row = el("div", { class: "row", style: "margin-bottom:10px" });
      var q = input("text", "Search non-travel table…", S.otherSearch || "");
      q.className = "input";
      q.style.maxWidth = "360px";
      q.addEventListener("input", function () { S.otherSearch = q.value; paint(); });

      row.appendChild(q);
      row.appendChild(btn("Print…", "btn", function () {
        choosePrintSize("Print table", function (size) {
          var rows = getOtherTableRowsFiltered();
          openPrintHtml(buildTablePrintHtml("Routine & other vaccines", rows, size));
        });
      }));
      card.appendChild(row);

      card.appendChild(buildVaxTable(getOtherTableRowsFiltered(), function (r) {
        var nm = r.brand_name || "";
        if (!nm) return;
        if (!S.selectedOther[nm]) S.selectedOther[nm] = 1;
        paint();
        toast("Added: " + nm);
      }));

      var orderCard = el("div", { class: "eikon-card", style: "margin-top:12px" });
      orderCard.appendChild(el("div", { html: "<b>Create order</b><div class='muted' style='font-size:12px;margin-top:2px'>Same workflow as Travel</div>" }));

      var box = el("div", { class: "box", style: "margin-top:10px" });

      var f1 = input("text", "Name", S.client_first || "");
      var f2 = input("text", "Surname", S.client_last || "");
      var f3 = input("text", "Phone number", S.phone || "");
      var f4 = input("email", "Email (optional)", S.email || "");
      [f1, f2, f3, f4].forEach(function (i) { i.className = "input"; i.style.maxWidth = "100%"; });

      f1.addEventListener("input", function () { S.client_first = f1.value; });
      f2.addEventListener("input", function () { S.client_last = f2.value; });
      f3.addEventListener("input", function () { S.phone = f3.value; });
      f4.addEventListener("input", function () { S.email = f4.value; });

      box.appendChild(el("div", { class: "row" }, [el("div", { class: "grow" }, [f1]), el("div", { class: "grow" }, [f2])]));
      box.appendChild(el("div", { class: "row" }, [el("div", { class: "grow" }, [f3]), el("div", { class: "grow" }, [f4])]));

      var actions = el("div", { class: "row", style: "justify-content:flex-end;margin-top:10px" });
      actions.appendChild(btn("Save only", "btn", function () { doCreateOrder("other", null); }));
      actions.appendChild(btn("Print & Save order…", "btn primary", function () {
        choosePrintSize("Print order", function (size) { doCreateOrder("other", size); });
      }));
      box.appendChild(actions);

      orderCard.appendChild(box);

      wrap.appendChild(card);
      wrap.appendChild(orderCard);
      return wrap;
    }

    function getOtherTableRowsFiltered() {
      var q = String(S.otherSearch || "").trim().toLowerCase();
      var rows = (S.catalog || []).filter(function (r) {
        var travel = isTravelVax(r);
        return !travel || isRoutine(r);
      });
      if (!q) return rows;
      return rows.filter(function (r) {
        var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
        return s.indexOf(q) >= 0;
      });
    }

    // ----------------------------------------------------------
    // Stock (same behavior as before)
    // ----------------------------------------------------------
    function renderStockTab() {
      var wrap = el("div", {});
      var card = el("div", { class: "eikon-card" });

      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Stock</b><div class='muted' style='font-size:12px;margin-top:2px'>Optional stock levels, batches, expiry • Negative allowed</div>" }),
        btn("Refresh", "btn", function () {
          (async function () {
            try { await refreshStock(); paint(); toast("Stock refreshed"); }
            catch (e) { modalError("Refresh failed", e); }
          })();
        })
      ]));

      var q = input("text", "Search stock…", S.stockSearch || "");
      q.className = "input";
      q.style.maxWidth = "360px";
      q.addEventListener("input", function () { S.stockSearch = q.value; paint(); });
      card.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [q]));

      // Add stock row
      var addBox = el("div", { class: "box" });
      addBox.appendChild(el("h3", { text: "Add / adjust stock" }));

      var nm = input("text", "Vaccine name", "");
      nm.className = "input";
      nm.style.maxWidth = "420px";
      var qty = input("number", "Qty", "0");
      qty.className = "qty";
      var batch = input("text", "Batch (optional)", "");
      batch.className = "input";
      batch.style.maxWidth = "200px";
      var exp = input("date", "", "");
      exp.className = "input";
      exp.style.maxWidth = "200px";

      var addBtn = btn("Save stock row", "btn primary", function () {
        (async function () {
          try {
            var name = String(nm.value || "").trim();
            if (!name) { toast("Enter vaccine name"); return; }
            await apiJson("POST", "/vaccines/stock/rows", {
              vaccine_name: name,
              qty: toInt(qty.value, 0),
              batch: String(batch.value || "").trim(),
              expiry_date: String(exp.value || "").trim()
            });
            toast("Saved");
            nm.value = ""; qty.value = "0"; batch.value = ""; exp.value = "";
            await refreshStock();
            paint();
          } catch (e) { modalError("Save failed", e); }
        })();
      });

      addBox.appendChild(el("div", { class: "row" }, [nm]));
      addBox.appendChild(el("div", { class: "row" }, [qty, batch, exp, addBtn]));
      addBox.appendChild(el("div", { class: "muted", text: "Tip: Leave batch/expiry empty if you don’t track them." }));

      card.appendChild(addBox);
      card.appendChild(buildStockTable(filterStockRows()));

      wrap.appendChild(card);
      return wrap;
    }

    function filterStockRows() {
      var q = norm(S.stockSearch);
      var rows = Array.isArray(S.stockRows) ? S.stockRows.slice() : [];
      if (!q) return rows;
      return rows.filter(function (r) {
        var s = (String(r.vaccine_name || "") + " " + String(r.batch || "") + " " + String(r.expiry_date || "")).toLowerCase();
        return s.indexOf(q) >= 0;
      });
    }

    function buildStockTable(rows) {
      rows = rows || [];
      var wrapper = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px;margin-top:10px" });
      var table = el("table", {});
      table.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Vaccine" }),
        el("th", { text: "Qty" }),
        el("th", { text: "Batch" }),
        el("th", { text: "Expiry" }),
        el("th", { text: "" })
      ])]));
      var tbody = el("tbody", {});
      if (!rows.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", class: "muted", text: "No stock rows." })]));
      } else {
        rows.forEach(function (r) {
          var tr = el("tr", {});
          tr.appendChild(el("td", { html: "<b>" + esc(r.vaccine_name || "") + "</b>" }));

          var q = input("number", "", r.qty);
          q.className = "qty";
          q.style.maxWidth = "90px";

          var b = input("text", "", r.batch || "");
          b.className = "input";
          b.style.maxWidth = "160px";

          var e = input("text", "", r.expiry_date || "");
          e.className = "input";
          e.style.maxWidth = "140px";
          e.placeholder = "YYYY-MM-DD";

          tr.appendChild(el("td", {}, [q]));
          tr.appendChild(el("td", {}, [b]));
          tr.appendChild(el("td", {}, [e]));

          var save = btn("Update", "btn primary", function () {
            (async function () {
              try {
                await apiJson("PUT", "/vaccines/stock/rows/" + encodeURIComponent(r.id), {
                  qty: toInt(q.value, 0),
                  batch: String(b.value || "").trim(),
                  expiry_date: String(e.value || "").trim()
                });
                toast("Updated");
                await refreshStock();
                paint();
              } catch (err) { modalError("Update failed", err); }
            })();
          });

          tr.appendChild(el("td", {}, [save]));
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    }

    // ----------------------------------------------------------
    // Database (same behavior as before: add name only)
    // ----------------------------------------------------------
    function renderDbTab() {
      var wrap = el("div", {});
      var card = el("div", { class: "eikon-card" });

      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Database</b><div class='muted' style='font-size:12px;margin-top:2px'>Add vaccine name only. Existing rows are read-only.</div>" }),
        btn("Refresh", "btn", function () {
          (async function () {
            try { await refreshCatalog(); paint(); toast("Catalog refreshed"); }
            catch (e) { modalError("Refresh failed", e); }
          })();
        })
      ]));

      var addBox = el("div", { class: "box" });
      addBox.appendChild(el("h3", { text: "Add vaccine to database" }));

      var r = el("div", { class: "row" });
      var nm = input("text", "Vaccine name", "");
      nm.className = "input";
      nm.style.maxWidth = "420px";
      var addBtn = btn("Add", "btn primary", function () {
        (async function () {
          try {
            var name = String(nm.value || "").trim();
            if (!name) { toast("Enter vaccine name"); return; }
            await apiJson("POST", "/vaccines/catalog", { brand_name: name });
            nm.value = "";
            toast("Added");
            await refreshCatalog();
            paint();
          } catch (e) { modalError("Add failed", e); }
        })();
      });

      r.appendChild(nm);
      r.appendChild(addBtn);
      addBox.appendChild(r);
      addBox.appendChild(el("div", { class: "muted", text: "Only the vaccine name is editable for users." }));

      card.appendChild(addBox);

      var q = input("text", "Search database…", S.dbSearch || "");
      q.className = "input";
      q.style.maxWidth = "360px";
      q.addEventListener("input", function () { S.dbSearch = q.value; paint(); });

      card.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [
        q,
        btn("Print…", "btn", function () {
          choosePrintSize("Print table", function (size) {
            var rows = filterDbRows();
            openPrintHtml(buildTablePrintHtml("Vaccine database", rows, size));
          });
        })
      ]));

      card.appendChild(buildVaxDbTable(filterDbRows()));

      wrap.appendChild(card);
      return wrap;
    }

    function filterDbRows() {
      var q = String(S.dbSearch || "").trim().toLowerCase();
      var rows = Array.isArray(S.catalog) ? S.catalog.slice() : [];
      if (!q) return rows;
      return rows.filter(function (r) {
        var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
        return s.indexOf(q) >= 0;
      });
    }

    function buildVaxDbTable(rows) {
      var wrapper = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px;margin-top:10px" });
      var table = el("table", {});
      table.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Vaccine name" }),
        el("th", { text: "Vaccinates for" }),
        el("th", { text: "Schedule" }),
        el("th", { text: "Routine" }),
        el("th", { text: "Travel always" }),
        el("th", { text: "Travel high-risk" })
      ])]));
      var tbody = el("tbody", {});
      if (!rows.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "6", class: "muted", text: "No rows." })]));
      } else {
        rows.forEach(function (r) {
          tbody.appendChild(el("tr", {}, [
            el("td", { html: "<b>" + esc(r.brand_name || "") + "</b>" }),
            el("td", { text: String(r.vaccinates_for || "") }),
            el("td", { text: String(r.dosing_schedule || "") }),
            el("td", { html: "<span class='tag " + (isRoutine(r) ? "yes" : "no") + "'>" + (isRoutine(r) ? "Yes" : "No") + "</span>" }),
            el("td", { class: "muted", text: String(r.travel_always || "") }),
            el("td", { class: "muted", text: String(r.travel_highrisk || "") })
          ]));
        });
      }
      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    }
  }

  // Register module
  E.registerModule({
    id: "vaccines",
    title: "Vaccines",
    order: 24,
    icon: "💉",
    render: render
  });

})();
