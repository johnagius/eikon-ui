/* ui/modules.vaccines.js
   Eikon - Vaccines module (UI)

   Version: 2026-02-21-12

   Fix:
   - Show selected/added vaccines in Create order panel (editable qty + remove).
   - Travel + Routine/Other tables now use checkbox + qty (uniform selection).
   - Selection synced across recommendations, table and order panel (no full rerender on each change).
   - Receipt print height auto-fits content to avoid long trailing paper.

   Notes:
   - Country search uses country NAME (from local puzzle map HTML).
   - Enter selects top match; map click fills name + selects country.

   Keeps:
   - Travel first with puzzle map pop-out (.is-active)
   - Recommended vaccines full width
   - Routine & Other, Stock, Database
   - Printing A4/Receipt
   - D1 endpoints:
       GET    /vaccines/catalog
       POST   /vaccines/catalog
       POST   /vaccines/orders
       GET    /vaccines/stock/rows
       POST   /vaccines/stock/rows
       PUT    /vaccines/stock/rows/:id
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  var VERSION = "2026-02-21-12";
  try { if (E && E.dbg) E.dbg("[vaccines] loaded v", VERSION); } catch (e) {}

  // ------------------------------------------------------------
  // Helpers
  // ------------------------------------------------------------
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

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

  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function normName(s) {
    // normalize name for partial matching (remove punctuation-ish)
    return String(s || "")
      .toLowerCase()
      .replace(/[\u2019']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }

  function toInt(v, def) {
    var n = parseInt(String(v == null ? "" : v), 10);
    return Number.isFinite(n) ? n : (def == null ? 0 : def);
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  async function apiJson(method, path, bodyObj) {
    var opts = { method: method, headers: {} };
    if (bodyObj !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(bodyObj || {});
    }
    return await E.apiFetch(path, opts); // returns parsed JSON; throws on non-2xx
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

  function modalError(title, err) {
    var msg = String((err && (err.stack || err.message || err)) || "Error");
    E.modal.show(title || "Error",
      "<div style='white-space:pre-wrap;word-break:break-word'>" + esc(msg) + "</div>",
      [{ label: "Close", primary: true, onClick: function () { E.modal.hide(); } }]
    );
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

      ".vax-root .hero{position:relative;overflow:hidden;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(90,168,255,.14),rgba(255,92,165,.10),rgba(44,210,152,.08));box-shadow:0 10px 30px rgba(0,0,0,.28)}" +
      ".vax-root .heroInner{display:grid;grid-template-columns:1fr 520px;gap:14px;padding:14px;align-items:stretch}" +
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
      ".vax-root .btn.sm{padding:6px 8px;border-radius:10px;font-size:12px;line-height:1}" +

      ".vax-root .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.22);font-size:12px;color:rgba(233,238,247,.86)}" +
      ".vax-root .pill b{color:var(--text)}" +

      ".vax-root .split{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "@media(max-width:980px){.vax-root .split{grid-template-columns:1fr}}" +
      ".vax-root .box{border:1px solid rgba(255,255,255,.10);border-radius:16px;background:rgba(0,0,0,.14);padding:12px}" +
      ".vax-root .box h3{margin:0 0 8px 0;font-size:13px;letter-spacing:.2px}" +

      ".vax-root .list{display:flex;flex-direction:column;gap:8px}" +
      ".vax-root .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".vax-root .item{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;padding:10px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(10,14,20,.22)}" +
      ".vax-root .item:hover{border-color:rgba(255,255,255,.18);background:rgba(10,14,20,.30)}" +
      ".vax-root .item .nm{font-weight:800}" +
      ".vax-root .item .sub{font-size:12px;color:rgba(233,238,247,.72);margin-top:2px}" +

      ".vax-root .orderList{display:flex;flex-direction:column;gap:8px;margin-top:8px}.vax-root .orderLine{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 10px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(10,14,20,.22)}.vax-root .orderLine .nm{font-weight:800}" +

      ".vax-root .qty{width:72px;max-width:92px;background:rgba(10,14,20,.35);border:1px solid rgba(255,255,255,.14);color:var(--text);padding:8px 10px;border-radius:12px;outline:none;text-align:center}" +

      ".vax-root .tag{display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;font-size:11px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);color:rgba(233,238,247,.86)}" +
      ".vax-root .tag.yes{border-color:rgba(44,210,152,.55);background:rgba(44,210,152,.10)}" +
      ".vax-root .tag.no{border-color:rgba(255,92,165,.50);background:rgba(255,92,165,.08)}" +

      ".vax-root .grid2{display:grid;grid-template-columns:1.15fr .85fr;gap:12px;align-items:start;margin-top:12px}" +
      "@media(max-width:980px){.vax-root .grid2{grid-template-columns:1fr}}" +

      ".vax-root table{width:100%;border-collapse:collapse;font-size:13px}" +
      ".vax-root th,.vax-root td{padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top}" +
      ".vax-root th{position:sticky;top:0;background:rgba(0,0,0,.20);backdrop-filter:blur(8px);text-align:left;font-size:12px;color:rgba(233,238,247,.78)}" +
      ".vax-root .muted{color:var(--muted)}" +

      ".vax-root .mapShell{position:relative;border-radius:18px;border:1px solid rgba(255,255,255,.14);background:radial-gradient(circle at 25% 25%,rgba(255,255,255,.10),rgba(90,168,255,.06) 35%,rgba(0,0,0,.20) 72%,rgba(0,0,0,.28));overflow:hidden;box-shadow:inset -18px -18px 60px rgba(0,0,0,.28), 0 12px 40px rgba(0,0,0,.35)}" +
      ".vax-root .mapPad{padding:10px}" +
      ".vax-root .mapInner{position:relative;overflow:hidden;border-radius:14px;background:linear-gradient(180deg,rgba(255,255,255,.05),rgba(0,0,0,.14));min-height:260px;display:flex;align-items:center;justify-content:center}" +
      ".vax-root .mapInner svg{display:block;width:100%;height:auto;max-height:360px;margin:auto;filter:drop-shadow(0 14px 22px rgba(0,0,0,.35))}" +
      ".vax-root .mapHud{position:absolute;left:12px;right:12px;bottom:12px;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.28);backdrop-filter:blur(8px);font-size:12px;color:rgba(233,238,247,.9);text-align:center}" +
      ".vax-root .mapLoading{padding:18px;color:rgba(233,238,247,.78);font-size:12px;text-align:center}" +

      ".vax-root .vaxPuzzle .country{cursor:pointer;transform-box:fill-box;transform-origin:center;filter:drop-shadow(0 10px 12px rgba(0,0,0,0.22));transition:transform 220ms ease, filter 220ms ease;outline:none}" +
      ".vax-root .vaxPuzzle .country .fill{fill:var(--base,#6aa7ff)}" +
      ".vax-root .vaxPuzzle .country .grid{fill:url(#tilePattern);opacity:.65}" +
      ".vax-root .vaxPuzzle .country .border{fill:none;stroke:rgba(0,0,0,0.24);stroke-width:.78;vector-effect:non-scaling-stroke;opacity:.26}" +
      ".vax-root .vaxPuzzle .country:hover{filter:drop-shadow(0 14px 16px rgba(0,0,0,0.26)) brightness(1.05)}" +
      ".vax-root .vaxPuzzle .country.is-active{transform:translate(-10px,-10px) scale(1.06);filter:drop-shadow(0 20px 26px rgba(0,0,0,0.30))}" +
      ".vax-root .vaxPuzzle .country.is-active .fill{fill:#f2c94c !important}" +
      ".vax-root .vaxPuzzle .country.is-active .border{opacity:.28}" +
      ".vax-root .vaxPuzzle .country.is-dim{opacity:.22;filter:saturate(.7) brightness(.92)}" +

      ".vax-root .suggest{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}" +
      ".vax-root .grp{align-items:center}.vax-root .grp .nm{font-weight:900}.vax-root .grp .sub{font-size:11px;color:rgba(233,238,247,.68);margin-top:2px}.vax-root .optWrap{display:flex;flex-wrap:wrap;gap:8px;justify-content:flex-end;align-items:center}.vax-root .opt{display:inline-flex;align-items:center;gap:8px;border:1px solid rgba(255,255,255,.12);background:rgba(0,0,0,.16);padding:6px 10px;border-radius:999px}.vax-root .opt:hover{border-color:rgba(255,255,255,.20);background:rgba(0,0,0,.22)}.vax-root .opt .optName{font-weight:800;font-size:12px;white-space:nowrap}.vax-root .opt .optQty{width:60px;max-width:70px;background:rgba(10,14,20,.35);border:1px solid rgba(255,255,255,.14);color:var(--text);padding:6px 8px;border-radius:12px;outline:none;text-align:center}.vax-root .ordersTools{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:10px}.vax-root .ordersTools .input{max-width:360px}" +

      ".vax-toast{position:fixed;left:50%;bottom:18px;transform:translate(-50%,12px);opacity:0;z-index:99999;padding:10px 12px;border-radius:14px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.78);backdrop-filter:blur(10px);color:rgba(233,238,247,.92);font-size:13px;box-shadow:0 12px 40px rgba(0,0,0,.45);transition:opacity .25s ease,transform .25s ease}" +
      ".vax-toast.show{opacity:1;transform:translate(-50%,0)}";

    var st = document.createElement("style");
    st.setAttribute("data-vax-styles", "1");
    st.textContent = css;
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Vaccine data helpers
  // ------------------------------------------------------------
  function isRoutine(r) {
    var v = String((r && r.routine_in_malta) || "").trim().toLowerCase();
    return v === "yes" || v === "y" || v === "1" || v === "true";
  }

  function isTravel(r) {
    return !!(String(r.travel_always || "").trim() || String(r.travel_highrisk || "").trim());
  }

  function inList(cc, csv) {
    cc = String(cc || "").trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(cc)) return false;
    var s = String(csv || "");
    if (!s) return false;
    var parts = s.split(",");
    for (var i = 0; i < parts.length; i++) {
      var p = String(parts[i] || "").trim().toUpperCase();
      if (p === cc) return true;
    }
    return false;
  }

  function computeTravelRecommendations(countryCode, catalog) {
    countryCode = String(countryCode || "").trim().toUpperCase();
    var c = Array.isArray(catalog) ? catalog : [];
    var always = [];
    var high = [];
    c.forEach(function (v) {
      if (inList(countryCode, v.travel_always)) always.push(v);
      else if (inList(countryCode, v.travel_highrisk)) high.push(v);
    });
    always.sort(function (a, b) { return String(a.brand_name || "").localeCompare(String(b.brand_name || "")); });
    high.sort(function (a, b) { return String(a.brand_name || "").localeCompare(String(b.brand_name || "")); });
    return { always: always, high: high };
  }

  function buildOrderItems(selectedMap, extraArr) {
    selectedMap = selectedMap || {};
    extraArr = extraArr || [];
    var items = [];

    Object.keys(selectedMap).forEach(function (k) {
      var qty = toInt(selectedMap[k], 0);
      if (qty > 0) items.push({ name: k, qty: qty });
    });

    extraArr.forEach(function (x) {
      var nm = String(x.name || "").trim();
      var q = toInt(x.qty, 0);
      if (nm && q > 0) items.push({ name: nm, qty: q });
    });

    // merge duplicates
    var merged = {};
    items.forEach(function (it) {
      var key = String(it.name || "").trim().toLowerCase();
      if (!key) return;
      merged[key] = merged[key] || { name: it.name, qty: 0 };
      merged[key].qty += toInt(it.qty, 1);
    });

    return Object.keys(merged).map(function (k) { return merged[k]; })
      .sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });

  }

  function syncVaxControls(rootEl, selectedMap, onlyName) {
    if (!rootEl) return;
    selectedMap = selectedMap || {};
    var nodes = rootEl.querySelectorAll("[data-vax-name]");
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i];
      if (!n || !n.dataset) continue;
      var nm = String(n.dataset.vaxName || "");
      if (onlyName && nm !== onlyName) continue;
      if (!nm) continue;
      var has = selectedMap[nm] != null;
      var role = String(n.dataset.vaxRole || "");
      if (role === "cb") {
        try { n.checked = !!has; } catch (e) {}
      } else if (role === "qty") {
        var v = has ? Math.max(1, toInt(selectedMap[nm], 1)) : 1;
        try { if (String(n.value) !== String(v)) n.value = String(v); } catch (e2) {}
        if (String(n.dataset.vaxDisable || "") === "1") {
          try { n.disabled = !has; } catch (e3) {}
        }
      }
    }
  }

  function renderOrderSelectionEditor(container, selectedMap, extraArr, opts) {
    if (!container) return;
    opts = opts || {};
    selectedMap = selectedMap || {};
    extraArr = extraArr || [];

    container.innerHTML = "";

    var keys = Object.keys(selectedMap).filter(function (k) { return toInt(selectedMap[k], 0) > 0; })
      .sort(function (a, b) { return String(a).localeCompare(String(b)); });

    var hasAny = keys.length || extraArr.length;
    if (!hasAny) {
      container.appendChild(el("div", { class: "muted", text: "No vaccines selected yet." }));
      return;
    }

    if (keys.length) {
      container.appendChild(el("div", { class: "muted", style: "font-size:12px;margin-bottom:4px", text: "Selected" }));
      keys.forEach(function (nm) {
        var line = el("div", { class: "orderLine" });
        var left = el("div", { class: "nm", text: nm });

        var right = el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap;justify-content:flex-end" });
        var q = input("number", "", String(Math.max(1, toInt(selectedMap[nm], 1))));
        q.className = "qty";
        q.min = "1";
        q.dataset.vaxName = nm;
        q.dataset.vaxRole = "qty";

        q.addEventListener("change", function () {
          var v = Math.max(1, toInt(q.value, 1));
          q.value = String(v);
          selectedMap[nm] = v;
          if (opts.onChange) opts.onChange(nm, "qty");
        });

        var rm = btn("✕", "btn sm", function () {
          delete selectedMap[nm];
          if (opts.onChange) opts.onChange(nm, "toggle");
        });
        rm.title = "Remove";

        right.appendChild(q);
        right.appendChild(rm);
        line.appendChild(left);
        line.appendChild(right);
        container.appendChild(line);
      });
    }

    if (extraArr.length) {
      container.appendChild(el("div", { class: "muted", style: "font-size:12px;margin:10px 0 4px", text: "Extra" }));
      extraArr.forEach(function (x, idx) {
        var nm = String(x.name || "").trim();
        if (!nm) return;

        var line = el("div", { class: "orderLine" });
        var left = el("div", { class: "nm", text: nm });

        var right = el("div", { class: "row", style: "gap:6px;flex-wrap:nowrap;justify-content:flex-end" });
        var q = input("number", "", String(Math.max(1, toInt(x.qty, 1))));
        q.className = "qty";
        q.min = "1";

        q.addEventListener("change", function () {
          var v = Math.max(1, toInt(q.value, 1));
          q.value = String(v);
          x.qty = v;
          if (opts.onExtraChange) opts.onExtraChange();
        });

        var rm = btn("✕", "btn sm", function () {
          extraArr.splice(idx, 1);
          if (opts.onExtraChange) opts.onExtraChange();
        });
        rm.title = "Remove";

        right.appendChild(q);
        right.appendChild(rm);
        line.appendChild(left);
        line.appendChild(right);
        container.appendChild(line);
      });
    }
  }


  // ------------------------------------------------------------
  // Printing
  // ------------------------------------------------------------
  function choosePrintSize(title, onPick) {
    var body = "<div style='color:rgba(233,238,247,.85);font-size:13px;line-height:1.45'>Choose paper size:</div>";
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
  }

  function buildPrintShell(title, bodyHtml, size) {
    var isReceipt = (size === "RECEIPT");

    // Receipt printers are "continuous", but browser @page auto height is unreliable.
    // We render into #paper, measure its height, then set an explicit @page height.
    var pageCss = isReceipt ? "@page{size:75mm 40mm;margin:0}" : "@page{size:A4;margin:12mm}";

    var base =
      "*,*::before,*::after{box-sizing:border-box;}" +
      "html,body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;padding:0;}" +
      (isReceipt ? "body{width:75mm;}" : "") +
      (isReceipt ? "#paper{padding:6mm;}" : "") +
      (isReceipt ? "#content{display:inline-block;width:100%;}" : "") +
      "h1{margin:0 0 10px 0;font-size:" + (isReceipt ? "16px" : "18px") + "}" +
      "table{width:100%;border-collapse:collapse;font-size:" + (isReceipt ? "11px" : "12px") + "}" +
      "th,td{border-bottom:1px solid #ddd;padding:" + (isReceipt ? "4px 4px" : "6px 6px") + ";vertical-align:top}" +
      "th{text-align:left;background:#f6f6f6}" +
      ".muted{color:#666}" +
      ".row{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}" +
      ".pill{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:3px 8px;font-size:11px;background:#fafafa}";

    var script =
      "<script>(function(){" +
      "function pxToMm(px){return px*25.4/96;}" +
      "function applyReceiptPageSize(){" +
      " try{" +
      "  var c=document.getElementById('content');" +
      "  if(!c) return;" +
      "  var h=Math.max(c.scrollHeight||0, c.getBoundingClientRect().height||0);" +
      "  var mm=Math.ceil(pxToMm(h)+2);" +
      "  if(mm<60) mm=60;" +
      "  if(mm>1200) mm=1200;" +
      "  var st=document.getElementById('pageSizeStyle');" +
      "  if(st) st.textContent='@page{size:75mm '+mm+'mm;margin:0}';" +
      " }catch(e){}" +
      "}" +
      "window.addEventListener('load', function(){" +
      (isReceipt ? "applyReceiptPageSize();setTimeout(applyReceiptPageSize,80);setTimeout(applyReceiptPageSize,220);" : "") +
      " setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e2){}}, 120);" +
      "});" +
      "})();<\/script>";

    return (
      "<!doctype html><html><head><meta charset='utf-8'/>" +
      "<title>" + esc(title || "Print") + "</title>" +
      "<style id='pageSizeStyle'>" + pageCss + "</style>" +
      "<style>" + base + "</style>" +
      "</head><body>" + (isReceipt ? "<div id='paper'><div id='content'>" + bodyHtml + "</div></div>" : bodyHtml) + script + "</body></html>"
    );
  }

  function buildOrderPrintHtml(order, size) {
    var title = "Vaccine order";
    var items = (order && order.items) ? order.items : [];
    var rows = items.map(function (it) {
      return "<tr><td><b>" + esc(it.name || "") + "</b></td><td style='text-align:right'>" + esc(it.qty || 1) + "</td></tr>";
    }).join("");

    var meta =
      "<div class='row'>" +
      "<span class='pill'><b>Created</b> " + esc(order.created_at || "") + "</span>" +
      "<span class='pill'><b>Section</b> " + esc(order.section || "") + "</span>" +
      (order.country_name ? "<span class='pill'><b>Country</b> " + esc(order.country_name) + " (" + esc(order.country_code || "") + ")</span>" : "") +
      "</div>";

    var client =
      "<div style='margin:10px 0'>" +
      "<div><b>Client:</b> " + esc((order.client_first || "") + " " + (order.client_last || "")) + "</div>" +
      "<div><b>Phone:</b> " + esc(order.phone || "") + "</div>" +
      (order.email ? "<div><b>Email:</b> " + esc(order.email) + "</div>" : "") +
      "</div>";

    var body =
      "<h1>" + esc(title) + "</h1>" +
      meta +
      client +
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
      "<table><thead><tr><th>Vaccine</th><th>Vaccinates for</th><th>Schedule</th><th>Routine</th></tr></thead><tbody>" +
      (rows.length ? rows.map(function (r) {
        return "<tr><td><b>" + esc(r.brand_name || "") + "</b></td><td>" + esc(r.vaccinates_for || "") +
          "</td><td>" + esc(r.dosing_schedule || "") + "</td><td>" + esc(isRoutine(r) ? "Yes" : "No") + "</td></tr>";
      }).join("") : "<tr><td colspan='4' class='muted'>No rows</td></tr>") +
      "</tbody></table>";

    return buildPrintShell(title, body, size);
  }

  // ------------------------------------------------------------
  // Puzzle map loader (local HTML -> SVG) + COUNTRY LIST extraction
  // ------------------------------------------------------------
  var PUZZLE_PATHS = [
    "./world_hi_res_v4_palette.html?v=" + encodeURIComponent((E && (E.VERSION || E.build || E.BUILD || "")) || Date.now()),
    "./world_hi_res_v4_palette.html"
  ];
  var puzzleTemplateSvg = null;
  var puzzleLoading = null;
  var mapCountryIndex = []; // [{code,name,normName}]

  function sanitizeDoc(doc) {
    try {
      Array.prototype.slice.call(doc.querySelectorAll("script, foreignObject")).forEach(function (n) { n.remove(); });
      Array.prototype.slice.call(doc.querySelectorAll("*")).forEach(function (n) {
        Array.prototype.slice.call(n.attributes || []).forEach(function (a) {
          if (!a || !a.name) return;
          if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        });
      });
    } catch (e) {}
  }

  function fnv1a(str) {
    var h = 0x811c9dc5;
    for (var i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h >>> 0;
  }

  function rgbToHex(r, g, b) {
    function h(v) { var s = v.toString(16); return s.length === 1 ? ("0" + s) : s; }
    return "#" + h(r) + h(g) + h(b);
  }

  function hslToHex(h, s, l) {
    h = ((h % 360) + 360) % 360;
    s = Math.max(0, Math.min(100, s)) / 100;
    l = Math.max(0, Math.min(100, l)) / 100;
    var c = (1 - Math.abs(2 * l - 1)) * s;
    var hp = h / 60;
    var x = c * (1 - Math.abs((hp % 2) - 1));
    var r1 = 0, g1 = 0, b1 = 0;
    if (hp >= 0 && hp < 1) { r1 = c; g1 = x; }
    else if (hp >= 1 && hp < 2) { r1 = x; g1 = c; }
    else if (hp >= 2 && hp < 3) { g1 = c; b1 = x; }
    else if (hp >= 3 && hp < 4) { g1 = x; b1 = c; }
    else if (hp >= 4 && hp < 5) { r1 = x; b1 = c; }
    else { r1 = c; b1 = x; }
    var m = l - c / 2;
    var r = Math.round((r1 + m) * 255);
    var g = Math.round((g1 + m) * 255);
    var b = Math.round((b1 + m) * 255);
    return rgbToHex(r, g, b);
  }

  function continentFromPoint(cx, cy, iso) {
    if (iso === "AQ") return "AN";
    if (cy >= 415) return "AN";
    if (cx <= 455) return (cy <= 285) ? "NA" : "SA";
    if (cx <= 720) return (cy <= 225) ? "EU" : "AF";
    if (cy >= 330 && cx >= 860) return "OC";
    return "AS";
  }

  function baseHueFor(cont) {
    if (cont === "NA") return 250;
    if (cont === "SA") return 352;
    if (cont === "EU") return 220;
    if (cont === "AF") return 305;
    if (cont === "AS") return 195;
    if (cont === "OC") return 165;
    return 210;
  }

  function lightenHex(hex, amt) {
    var s = String(hex || "");
    if (s[0] === "#") s = s.slice(1);
    if (s.length !== 6) return hex;
    var n = parseInt(s, 16);
    if (!Number.isFinite(n)) return hex;
    var r = (n >> 16) & 255;
    var g = (n >> 8) & 255;
    var b = n & 255;
    r = Math.round(r + (255 - r) * amt);
    g = Math.round(g + (255 - g) * amt);
    b = Math.round(b + (255 - b) * amt);
    return rgbToHex(r, g, b);
  }

  function colorFor(iso, cont) {
    var h = fnv1a(iso);
    var H0 = baseHueFor(cont);
    var jitterMax = (cont === "SA") ? 7 : 10;
    var jitter = (((h % 1000) / 1000) - 0.5) * (jitterMax * 2);
    var hue = H0 + jitter;
    var alt = (h & 1) ? 10 : -6;
    var l = 54 + alt + (((h >>> 6) & 7) - 3) * 1.2;
    var s = 62 + (((h >>> 11) & 7) - 3) * 2.5;
    return hslToHex(hue, s, l);
  }

  function applyPuzzlePaletteAndIndex(svgEl) {
    // Build country index from map (data-name + data-iso) and apply palette.
    var idx = [];
    try {
      var nodes = svgEl.querySelectorAll('#countries .country');
      for (var i = 0; i < nodes.length; i++) {
        var g = nodes[i];
        var iso = String(g.getAttribute("data-iso") || "").toUpperCase().trim();
        var nm = String(g.getAttribute("data-name") || "").trim();
        if (!iso || !/^[A-Z]{2}$/.test(iso) || !nm) continue;

        // palette
        if (iso === "AQ" || nm === "Antarctica") {
          g.style.setProperty("--base", "#ffffff");
          g.style.setProperty("--selected-fill", "#ffffff");
        } else {
          var bbox = null;
          try { bbox = g.getBBox(); } catch (e) { bbox = null; }
          var cx = bbox ? (bbox.x + bbox.width / 2) : 550;
          var cy = bbox ? (bbox.y + bbox.height / 2) : 260;
          var cont = continentFromPoint(cx, cy, iso);
          var base = colorFor(iso, cont);
          g.style.setProperty("--base", base);
          g.style.setProperty("--selected-fill", lightenHex(base, 0.20));
        }

        idx.push({ code: iso, name: nm, nn: normName(nm) });
      }
    } catch (e2) {}

    // dedupe by code
    var seen = {};
    var out = [];
    for (var j = 0; j < idx.length; j++) {
      var c = idx[j];
      if (seen[c.code]) continue;
      seen[c.code] = 1;
      out.push(c);
    }
    out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    mapCountryIndex = out;
  }

  async function ensurePuzzleTemplate() {
    if (puzzleTemplateSvg) return puzzleTemplateSvg;
    if (puzzleLoading) return await puzzleLoading;

    puzzleLoading = (async function () {
      var res = null;
      var lastErr = "";
      for (var pi = 0; pi < PUZZLE_PATHS.length; pi++) {
        var pth = PUZZLE_PATHS[pi];
        try {
          res = await fetch(pth, { method: "GET", cache: "force-cache" });
          if (res && res.ok) break;
          lastErr = "HTTP " + (res ? res.status : "0") + " for " + pth;
        } catch (e) {
          lastErr = String(e && (e.message || e) || "fetch failed") + " for " + pth;
          res = null;
        }
      }
      if (!res || !res.ok) {
        throw new Error("Map not found. Your worker serves /ui/* by proxying GitHub raw; ensure ui/world_hi_res_v4_palette.html exists in the repo. (" + lastErr + ")");
      }
      var html = await res.text();
      if (!html || html.length < 1000) throw new Error("Map HTML looks empty");

      var dp = new DOMParser();
      var doc = dp.parseFromString(html, "text/html");
      sanitizeDoc(doc);

      var svg = doc.querySelector("svg");
      if (!svg) throw new Error("No <svg> found in map HTML");

      puzzleTemplateSvg = document.importNode(svg, true);
      puzzleTemplateSvg.removeAttribute("width");
      puzzleTemplateSvg.removeAttribute("height");
      puzzleTemplateSvg.setAttribute("preserveAspectRatio", "xMidYMid meet");
      return puzzleTemplateSvg;
    })();

    return await puzzleLoading;
  }

  function createPuzzleMapWidget(onPick, onReady) {
    ensureStyles();

    var shell = el("div", { class: "mapShell vaxPuzzle" });
    var pad = el("div", { class: "mapPad" });
    var inner = el("div", { class: "mapInner" });
    var hud = el("div", { class: "mapHud", text: "Loading map…" });

    inner.appendChild(el("div", {
      class: "mapLoading",
      html: "<b>Loading map…</b><div style='opacity:.75;margin-top:6px'>Using local world_hi_res_v4_palette.html</div>"
    }));

    pad.appendChild(inner);
    shell.appendChild(pad);
    shell.appendChild(hud);

    var state = { svg: null };

    function setHud(text) { hud.textContent = text || ""; }

    function clear() {
      if (!state.svg) return;
      var prev = state.svg.querySelectorAll(".country.is-active, .country.is-dim");
      Array.prototype.forEach.call(prev, function (n) {
        n.classList.remove("is-active");
        n.classList.remove("is-dim");
      });
    }

    function select(cc, dimOthers) {
      cc = String(cc || "").toUpperCase();
      if (!state.svg) return;

      clear();
      if (!cc) return;

      var target = state.svg.querySelector('.country[data-iso="' + cc.replace(/"/g, "") + '"]');
      if (!target) {
        setHud("Selected: " + cc + " (not found)");
        return;
      }

      if (dimOthers) {
        var all = state.svg.querySelectorAll(".country");
        Array.prototype.forEach.call(all, function (n) { n.classList.add("is-dim"); });
        target.classList.remove("is-dim");
      }

      target.classList.add("is-active");
      try { target.parentNode.appendChild(target); } catch (e) {}

      var nm = String(target.getAttribute("data-name") || "") || cc;
      setHud(nm + " (" + cc + ")");
    }

    function bind(svgEl) {
      svgEl.addEventListener("click", function (ev) {
        var t = ev.target;
        while (t && t !== svgEl) {
          if (t.classList && t.classList.contains("country")) break;
          t = t.parentNode;
        }
        if (!t || t === svgEl) return;
        var iso = String(t.getAttribute("data-iso") || "").toUpperCase();
        var nm = String(t.getAttribute("data-name") || "");
        if (!iso) return;
        if (onPick) onPick(iso, nm);
      });
    }

    (async function boot() {
      try {
        var tpl = await ensurePuzzleTemplate();
        var svg = tpl.cloneNode(true);
        inner.innerHTML = "";
        inner.appendChild(svg);
        state.svg = svg;

        // palette + index requires bbox -> do it next frame
        requestAnimationFrame(function () {
          try {
            applyPuzzlePaletteAndIndex(svg);
            if (onReady) onReady(mapCountryIndex);
          } catch (e) {}
        });

        bind(svg);
        setHud("Click a country or search by name");
      } catch (e) {
        inner.innerHTML = "";
        inner.appendChild(el("div", { class: "mapLoading", html: "<b>Map failed</b><div style='opacity:.75;margin-top:6px'>" + esc(e.message || String(e)) + "</div>" }));
        setHud("Map failed");
      }
    })();

    return { el: shell, select: select, clear: clear, setHud: setHud };
  }

  // ------------------------------------------------------------
  // Country search (NAME-based)
  // ------------------------------------------------------------
  function countryMatches(query, list) {
    var q = normName(query);
    if (!q) return [];
    list = Array.isArray(list) ? list : [];
    // score: startswith better than contains; shorter name slightly better
    var hits = [];
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      var nn = c.nn || normName(c.name);
      if (!nn) continue;
      var idx = nn.indexOf(q);
      if (idx === -1) continue;
      var score = (idx === 0 ? 0 : 50) + Math.min(idx, 40) + Math.min(nn.length, 60) / 10;
      hits.push({ c: c, score: score });
    }
    hits.sort(function (a, b) {
      if (a.score !== b.score) return a.score - b.score;
      return String(a.c.name).localeCompare(String(b.c.name));
    });
    return hits.slice(0, 10).map(function (x) { return x.c; });
  }

  function pickBestCountry(query, list) {
    var hits = countryMatches(query, list);
    return hits.length ? hits[0] : null;
  }

  // ------------------------------------------------------------
  // UI blocks
  // ------------------------------------------------------------
  function buildVaxTable(rows, selectedMap, onChange) {
    rows = rows || [];
    selectedMap = selectedMap || {};
    var wrapper = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px" });
    var table = el("table", {});
    table.appendChild(el("thead", {}, [el("tr", {}, [
      el("th", { text: "Vaccine" }),
      el("th", { text: "Vaccinates for" }),
      el("th", { text: "Schedule" }),
      el("th", { text: "Routine" }),
      el("th", { text: "Select" })
    ])]));
    var tbody = el("tbody", {});
    if (!rows.length) {
      tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", class: "muted", text: "No rows." })]));
    } else {
      rows.forEach(function (r) {
        var nm = String(r.brand_name || "").trim();
        var tr = el("tr", {});
        tr.appendChild(el("td", { html: "<b>" + esc(nm) + "</b>" }));
        tr.appendChild(el("td", { text: String(r.vaccinates_for || "") }));
        tr.appendChild(el("td", { text: String(r.dosing_schedule || "") }));
        tr.appendChild(el("td", { html: "<span class='tag " + (isRoutine(r) ? "yes" : "no") + "'>" + (isRoutine(r) ? "Yes" : "No") + "</span>" }));

        var selTd = el("td", {});
        if (nm) {
          var right = el("div", { class: "row", style: "justify-content:flex-end;gap:6px;flex-wrap:nowrap" });

          var cb = input("checkbox", "", "");
          cb.checked = selectedMap[nm] != null;
          cb.dataset.vaxName = nm;
          cb.dataset.vaxRole = "cb";

          var q = input("number", "", cb.checked ? selectedMap[nm] : 1);
          q.className = "qty";
          q.min = "1";
          q.disabled = !cb.checked;
          q.dataset.vaxName = nm;
          q.dataset.vaxRole = "qty";
          q.dataset.vaxDisable = "1";

          cb.addEventListener("change", function () {
            if (cb.checked) {
              var v = Math.max(1, toInt(q.value, 1));
              q.value = String(v);
              q.disabled = false;
              selectedMap[nm] = v;
            } else {
              delete selectedMap[nm];
              q.disabled = true;
              q.value = "1";
            }
            if (onChange) onChange(nm, "toggle");
          });

          q.addEventListener("change", function () {
            var v = Math.max(1, toInt(q.value, 1));
            q.value = String(v);
            if (cb.checked) {
              selectedMap[nm] = v;
              if (onChange) onChange(nm, "qty");
            }
          });

          right.appendChild(cb);
          right.appendChild(q);
          selTd.appendChild(right);
        }
        tr.appendChild(selTd);
        tbody.appendChild(tr);
      });
    }
    table.appendChild(tbody);
    wrapper.appendChild(table);
    return wrapper;
  }

  function renderSelectableList(container, rows, selectedMap) {
    selectedMap = selectedMap || {};
    rows = rows || [];
    container.innerHTML = "";

    if (!rows.length) {
      container.appendChild(el("div", { class: "muted", text: "No rows." }));
      return;
    }

    rows.forEach(function (r) {
      var nm = String(r.brand_name || "");
      var it = el("div", { class: "item" });

      var left = el("div", {});
      left.appendChild(el("div", { class: "nm", text: nm }));
      if (r.vaccinates_for) left.appendChild(el("div", { class: "sub", text: r.vaccinates_for }));
      if (r.dosing_schedule) left.appendChild(el("div", { class: "sub", text: r.dosing_schedule }));

      left.appendChild(el("div", { style: "margin-top:6px" }, [
        el("span", { class: "tag " + (isRoutine(r) ? "yes" : "no"), text: (isRoutine(r) ? "Routine in Malta" : "Not routine") })
      ]));

      var right = el("div", { class: "row", style: "gap:6px;align-items:center" });

      var cb = input("checkbox", "", "");
      cb.checked = selectedMap[nm] != null;
      cb.addEventListener("change", function () {
        if (cb.checked) selectedMap[nm] = selectedMap[nm] || 1;
        else delete selectedMap[nm];
      });

      var q = input("number", "", selectedMap[nm] ? selectedMap[nm] : 1);
      q.className = "qty";
      q.min = "1";
      q.addEventListener("change", function () {
        var v = Math.max(1, toInt(q.value, 1));
        q.value = String(v);
        if (cb.checked) selectedMap[nm] = v;
      });

      right.appendChild(cb);
      right.appendChild(q);
      it.appendChild(left);
      it.appendChild(right);
      container.appendChild(it);
    });
  }

  

  function groupVaccinesByVaccinatesFor(rows) {
    rows = rows || [];
    var map = {};
    rows.forEach(function (r) {
      if (!r) return;
      var key = String(r.vaccinates_for || "").trim();
      if (!key) key = String(r.brand_name || "").trim() || "Other";
      if (!map[key]) map[key] = [];
      map[key].push(r);
    });
    var keys = Object.keys(map);
    keys.sort(function (a, b) { return String(a).localeCompare(String(b)); });
    return keys.map(function (k) {
      var opts = map[k] || [];
      opts.sort(function (a, b) { return String(a.brand_name || "").localeCompare(String(b.brand_name || "")); });
      return { key: k, options: opts };
    });
  }

  function renderGroupedRecommendations(container, rows, selectedMap, onChange) {
    selectedMap = selectedMap || {};
    rows = rows || [];
    container.innerHTML = "";

    if (!rows.length) {
      container.appendChild(el("div", { class: "muted", text: "No recommendations." }));
      return;
    }

    var groups = groupVaccinesByVaccinatesFor(rows);
    groups.forEach(function (g) {
      var wrap = el("div", { class: "item grp" });

      var left = el("div", {});
      left.appendChild(el("div", { class: "nm", text: g.key }));
      left.appendChild(el("div", { class: "sub", text: "Select brand option(s)" }));

      var optWrap = el("div", { class: "optWrap" });

      (g.options || []).forEach(function (v) {
        var brand = String(v.brand_name || "").trim();
        if (!brand) return;
        var opt = el("div", { class: "opt" });
        var tip = [];
        if (v.vaccinates_for) tip.push(String(v.vaccinates_for));
        if (v.dosing_schedule) tip.push(String(v.dosing_schedule));
        if (tip.length) opt.title = tip.join(" • ");

        var cb = input("checkbox", "", "");
        cb.checked = selectedMap[brand] != null;
        cb.dataset.vaxName = brand;
        cb.dataset.vaxRole = "cb";

        var qty = input("number", "", cb.checked ? selectedMap[brand] : 1);
        qty.className = "optQty";
        qty.min = "1";
        qty.disabled = !cb.checked;
        qty.dataset.vaxName = brand;
        qty.dataset.vaxRole = "qty";
        qty.dataset.vaxDisable = "1";

        cb.addEventListener("change", function () {
          if (cb.checked) {
            var qv = Math.max(1, toInt(qty.value, 1));
            qty.value = String(qv);
            qty.disabled = false;
            selectedMap[brand] = qv;
          } else {
            delete selectedMap[brand];
            qty.disabled = true;
            qty.value = "1";
          }
       
          if (onChange) onChange(brand, "toggle");
        });

        qty.addEventListener("change", function () {
          var qv = Math.max(1, toInt(qty.value, 1));
          qty.value = String(qv);
          if (cb.checked) {
            selectedMap[brand] = qv;
            if (onChange) onChange(brand, "qty");
          }
        });

        opt.appendChild(cb);
        opt.appendChild(el("span", { class: "optName", text: brand }));
        opt.appendChild(qty);
        optWrap.appendChild(opt);
      });

      wrap.appendChild(left);
      wrap.appendChild(optWrap);
      container.appendChild(wrap);
    });
  }
// ------------------------------------------------------------
  // Module render
  // ------------------------------------------------------------
  async function render(ctx) {
    ensureStyles();

    var mount = ctx.mount;
    mount.innerHTML = "";

    var S = {
      active: "travel",
      catalog: [],
      stockRows: [],
      selectedCountryCode: "",
      selectedCountryName: "",
      selectedTravel: {},
      selectedOther: {},
      extraTravel: [],
      extraOther: [],
      travelSearch: "",
      otherSearch: "",
      dbSearch: "",
      stockSearch: "",
      orders: [],
      ordersSearch: "",
      mapWidget: null,
      countries: [], // name-based list from map (preferred)
      clientTravel: { first: "", last: "", phone: "", email: "" }
    };

    var root = el("div", { class: "vax-root" });

    // Header
    var headerCard = el("div", { class: "eikon-card" });
    var hdr = el("div", { class: "hdr" });

    var leftHdr = el("div", {});
    leftHdr.appendChild(el("h2", { text: "Vaccines" }));
    leftHdr.appendChild(el("div", { class: "meta", text: "Travel • Routine & Other • Stock • Database" }));

    var tabs = el("div", { class: "tabs" });
    function mkTab(id, label, emoji) {
      var b = el("div", { class: "tab", "data-tab": id, html: "<span>" + esc(emoji) + "</span><span>" + esc(label) + "</span>" });
      b.addEventListener("click", function () { S.active = id; paint(); });
      return b;
    }
    tabs.appendChild(mkTab("travel", "Travel", "🌍"));
    tabs.appendChild(mkTab("other", "Routine & Other", "💉"));
    tabs.appendChild(mkTab("stock", "Stock", "📦"));
    tabs.appendChild(mkTab("db", "Database", "🗄️"));

    hdr.appendChild(leftHdr);
    hdr.appendChild(tabs);
    headerCard.appendChild(hdr);
    root.appendChild(headerCard);

    var body = el("div", {});
    root.appendChild(body);
    mount.appendChild(root);

    function setActiveTabStyles() {
      var btns = root.querySelectorAll(".tab");
      Array.prototype.forEach.call(btns, function (b) {
        b.classList.toggle("active", b.getAttribute("data-tab") === S.active);
      });
    }

    async function refreshCatalog() {
      var data = await apiJson("GET", "/vaccines/catalog");
      S.catalog = (data && data.items) ? data.items : [];
    }

    async function refreshStock() {
      var data = await apiJson("GET", "/vaccines/stock/rows");
      S.stockRows = (data && data.rows) ? data.rows : [];
    }


    async function refreshOrders() {
      var data = await apiJson("GET", "/vaccines/orders");
      S.orders = (data && data.orders) ? data.orders : ((data && data.items) ? data.items : []);
    }


    function paint() {
      setActiveTabStyles();
      body.innerHTML = "";

      if (S.active === "travel") body.appendChild(renderTravelTab());
      else if (S.active === "other") body.appendChild(renderOtherTab());
      else if (S.active === "stock") body.appendChild(renderStockTab());
      else body.appendChild(renderDbTab());
    }

    

    function renderOrdersCard() {
      var card = el("div", { class: "eikon-card", style: "margin-top:12px" });

      card.appendChild(el("div", {
        class: "row",
        style: "justify-content:space-between;align-items:center;margin-bottom:10px"
      }, [
        el("div", { html: "<b>Client orders</b><div class='muted' style='font-size:12px;margin-top:2px'>Saved vaccine orders • Search • Print</div>" }),
        btn("Refresh", "btn", function () {
          (async function () {
            try { await refreshOrders(); paint(); toast("Orders refreshed"); }
            catch (e) { modalError("Refresh failed", e); }
          })();
        })
      ]));

      var tools = el("div", { class: "ordersTools" });
      var s = input("text", "Search orders (name, phone, country, vaccine)…", S.ordersSearch || "");
      s.className = "input";
      s.addEventListener("input", function () { S.ordersSearch = s.value; paint(); });
      tools.appendChild(s);
      card.appendChild(tools);

      var q = norm(S.ordersSearch);
      var rows = Array.isArray(S.orders) ? S.orders.slice() : [];
      if (q) {
        rows = rows.filter(function (o) {
          var t = "";
          t += String(o.created_at || "").toLowerCase() + " ";
          t += String(o.section || "").toLowerCase() + " ";
          t += String(o.country_name || "").toLowerCase() + " ";
          t += String(o.country_code || "").toLowerCase() + " ";
          t += String(o.client_first || "").toLowerCase() + " ";
          t += String(o.client_last || "").toLowerCase() + " ";
          t += String(o.phone || "").toLowerCase() + " ";
          t += String(o.email || "").toLowerCase() + " ";
          var its = (o.items || []);
          for (var i = 0; i < its.length; i++) {
            t += String(its[i].name || "").toLowerCase() + " ";
          }
          return t.indexOf(q) >= 0;
        });
      }

      var wrapper = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px" });
      var table = el("table", {});
      table.appendChild(el("thead", {}, [el("tr", {}, [
        el("th", { text: "Date" }),
        el("th", { text: "Client" }),
        el("th", { text: "Phone" }),
        el("th", { text: "Section" }),
        el("th", { text: "Country" }),
        el("th", { text: "Items" }),
        el("th", { text: "" })
      ])]));

      var tbody = el("tbody", {});

      if (!rows.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "7", class: "muted", text: "No orders found." })]));
      } else {
        rows.forEach(function (o) {
          var tr = el("tr", {});
          var dt = String(o.created_at || "").replace("T", " ").slice(0, 19);
          var client = (String(o.client_first || "").trim() + " " + String(o.client_last || "").trim()).trim();
          var country = (o.country_name ? (String(o.country_name) + " (" + String(o.country_code || "") + ")") : "");
          var items = (o.items || []);
          var itemsCount = items.reduce(function (acc, it) { return acc + Math.max(1, toInt(it.qty, 1)); }, 0);
          var itemsTip = items.map(function (it) { return String(it.name || "") + " × " + String(it.qty || 1); }).join(", ");

          tr.appendChild(el("td", { text: dt || "" }));
          tr.appendChild(el("td", { html: "<b>" + esc(client || "") + "</b>" }));
          tr.appendChild(el("td", { text: String(o.phone || "") }));
          tr.appendChild(el("td", { text: String(o.section || "") }));
          tr.appendChild(el("td", { text: country }));
          var tdItems = el("td", { text: String(itemsCount || 0) });
          if (itemsTip) tdItems.title = itemsTip;
          tr.appendChild(tdItems);

          var tdAct = el("td", {});
          tdAct.appendChild(btn("Print…", "btn", function () {
            choosePrintSize("Print order", function (size) {
              openPrintHtml(buildOrderPrintHtml({
                created_at: o.created_at,
                section: o.section,
                country_code: o.country_code,
                country_name: o.country_name,
                client_first: o.client_first,
                client_last: o.client_last,
                phone: o.phone,
                email: o.email,
                items: (o.items || [])
              }, size));
            });
          }));
          tr.appendChild(tdAct);

          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      wrapper.appendChild(table);
      card.appendChild(wrapper);

      return card;
    }
// -------------------------
    // TRAVEL TAB
    // -------------------------
    function renderTravelTab() {
      var wrap = el("div", {});
      var travelSelList = null;

      function renderTravelOrderList() {
        if (!travelSelList) return;
        renderOrderSelectionEditor(travelSelList, S.selectedTravel, S.extraTravel, {
          onChange: travelSelChanged,
          onExtraChange: function () { renderTravelOrderList(); }
        });
      }

      function travelSelChanged(name, reason) {
        syncVaxControls(wrap, S.selectedTravel, name);
        if (reason !== "qty") renderTravelOrderList();
      }

      var hero = el("div", { class: "hero" });
      var inner = el("div", { class: "heroInner" });

      var info = el("div", {});
      info.appendChild(el("div", { class: "heroTitle", text: "Travel vaccines" }));
      info.appendChild(el("div", { class: "heroSub", text: "Search by country name (partial OK), or click a country on the map." }));

      var cInp = input("text", "Search country (e.g. Italy, United, South)…", "");
      cInp.className = "input";

      var suggestionRow = el("div", { class: "suggest" });
      var lastMatches = [];

      function selectCountry(code, name) {
        S.selectedCountryCode = String(code || "").toUpperCase();
        S.selectedCountryName = String(name || "").trim() || S.selectedCountryCode;

        cInp.value = S.selectedCountryName;
        suggestionRow.innerHTML = "";
        lastMatches = [];

        if (S.mapWidget) {
          S.mapWidget.select(S.selectedCountryCode, true);
          S.mapWidget.setHud(S.selectedCountryName + " (" + S.selectedCountryCode + ")");
        }
        paint();
      }

      function updateSuggestions() {
        suggestionRow.innerHTML = "";
        lastMatches = [];

        var list = (S.countries && S.countries.length) ? S.countries : mapCountryIndex;
        var q = cInp.value;
        if (!q || !String(q).trim()) return;

        var matches = countryMatches(q, list);
        lastMatches = matches;

        if (!matches.length) {
          suggestionRow.appendChild(el("div", { class: "muted", text: "No matches" }));
          return;
        }
        matches.forEach(function (c) {
          suggestionRow.appendChild(btn(c.name + " (" + c.code + ")", "btn", function () {
            selectCountry(c.code, c.name);
          }));
        });
      }

      cInp.addEventListener("input", updateSuggestions);

      // ENTER = pick best match automatically
      cInp.addEventListener("keydown", function (ev) {
        if (ev.key !== "Enter") return;
        ev.preventDefault();

        var list = (S.countries && S.countries.length) ? S.countries : mapCountryIndex;
        var best = pickBestCountry(cInp.value, list);
        if (!best) { toast("No matching country"); return; }
        selectCountry(best.code, best.name);
      });

      var clearBtn = btn("Clear", "btn", function () {
        S.selectedCountryCode = "";
        S.selectedCountryName = "";
        cInp.value = "";
        suggestionRow.innerHTML = "";
        lastMatches = [];
        if (S.mapWidget) {
          S.mapWidget.clear();
          S.mapWidget.setHud("Click a country or search by name");
        }
        renderTravelOrderList();
      });

      info.appendChild(el("div", { class: "searchRow" }, [cInp, clearBtn]));
      info.appendChild(suggestionRow);

      var pills = el("div", { class: "row", style: "margin-top:10px;gap:8px" });
      pills.appendChild(el("span", { class: "pill", html: "<b>Catalog</b> " + esc(S.catalog.length) + " vaccines" }));
      pills.appendChild(el("span", { class: "pill", html: "<b>Stock rows</b> " + esc(S.stockRows.length) }));
      pills.appendChild(el("span", { class: "pill", html: "<b>Selected</b> " + esc(S.selectedCountryCode ? (S.selectedCountryName + " (" + S.selectedCountryCode + ")") : "None") }));
      info.appendChild(pills);

      // Map (right)
      var mapWrap = el("div", {});
      if (!S.mapWidget) {
        S.mapWidget = createPuzzleMapWidget(
          function (cc, nm) { selectCountry(cc, nm); },
          function (countryList) {
            // Map is ready -> use its country list for name searches
            if (Array.isArray(countryList) && countryList.length) {
              S.countries = countryList;
              // refresh suggestions if user is typing
              if (String(cInp.value || "").trim()) updateSuggestions();
            }
          }
        );
      }
      mapWrap.appendChild(S.mapWidget.el);

      // reflect already selected
      if (S.selectedCountryCode) {
        setTimeout(function () {
          try {
            S.mapWidget.select(S.selectedCountryCode, true);
            S.mapWidget.setHud(S.selectedCountryName + " (" + S.selectedCountryCode + ")");
          } catch (e) {}
        }, 50);
      }

      inner.appendChild(info);
      inner.appendChild(mapWrap);
      hero.appendChild(inner);
      wrap.appendChild(hero);

      // Recommended FULL WIDTH
      var recCard = el("div", { class: "eikon-card", style: "margin-top:12px" });
      recCard.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Recommended vaccines</b><div class='muted' style='font-size:12px;margin-top:2px'>Filtered by country • Select vaccines & quantities</div>" }),
        btn("Clear selection", "btn", function () { S.selectedTravel = {}; S.extraTravel = []; paint(); })
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
        var rec = computeTravelRecommendations(S.selectedCountryCode, S.catalog);
        renderGroupedRecommendations(alwaysList, rec.always, S.selectedTravel, travelSelChanged);
        renderGroupedRecommendations(highList, rec.high, S.selectedTravel, travelSelChanged);
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

      // Below: table + order
      var grid = el("div", { class: "grid2" });

      // Table
      var tableCard = el("div", { class: "eikon-card" });
      tableCard.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Travel vaccines table</b><div class='muted' style='font-size:12px;margin-top:2px'>Search filters as you type • Add from here too</div>" }),
        btn("Print…", "btn", function () {
          choosePrintSize("Print table", function (size) {
            openPrintHtml(buildTablePrintHtml("Travel vaccines", getTravelRows(), size));
          });
        })
      ]));

      var tSearch = input("text", "Search travel table…", S.travelSearch || "");
      tSearch.className = "input";
      tSearch.style.maxWidth = "360px";
      tSearch.addEventListener("input", function () { S.travelSearch = tSearch.value; paint(); });
      tableCard.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [tSearch]));
      tableCard.appendChild(buildVaxTable(getTravelRows(), S.selectedTravel, travelSelChanged));

      // Order
      var orderCard = el("div", { class: "eikon-card" });
      orderCard.appendChild(el("div", { html: "<b>Create order</b><div class='muted' style='font-size:12px;margin-top:2px'>Client details • Extra vaccines • Print A4 or Receipt</div>" }));

      var orderBox = el("div", { class: "box", style: "margin-top:10px" });

      var fn = input("text", "Client name", S.clientTravel.first || "");
      var ln = input("text", "Client surname", S.clientTravel.last || "");
      var ph = input("text", "Phone number", S.clientTravel.phone || "");
      var em = input("email", "Email (optional)", S.clientTravel.email || "");
      fn.addEventListener("input", function () { S.clientTravel.first = fn.value; });
      ln.addEventListener("input", function () { S.clientTravel.last = ln.value; });
      ph.addEventListener("input", function () { S.clientTravel.phone = ph.value; });
      em.addEventListener("input", function () { S.clientTravel.email = em.value; });
      [fn, ln, ph, em].forEach(function (i) { i.className = "input"; i.style.maxWidth = "420px"; });

      orderBox.appendChild(el("div", { class: "row" }, [fn]));
      orderBox.appendChild(el("div", { class: "row" }, [ln]));
      orderBox.appendChild(el("div", { class: "row" }, [ph]));
      orderBox.appendChild(el("div", { class: "row" }, [em]));

      // Selected
      orderBox.appendChild(el("div", { style: "margin-top:10px;font-weight:800", text: "Selected vaccines" }));
      travelSelList = el("div", { class: "orderList" });
      orderBox.appendChild(travelSelList);
      renderTravelOrderList();

      // Extras
      orderBox.appendChild(el("div", { style: "margin-top:10px;font-weight:800", text: "Extra vaccines" }));
      var exName = input("text", "Type vaccine name (suggestions)…", "");
      exName.className = "input";
      exName.style.maxWidth = "420px";
      var exQty = input("number", "Qty", "1");
      exQty.className = "qty";
      exQty.min = "1";

      var dl = el("datalist", { id: "vax-extra-dl" + Math.random().toString(16).slice(2) });
      exName.setAttribute("list", dl.id);
      (S.catalog || []).forEach(function (v) {
        var o = document.createElement("option");
        o.value = v.brand_name || "";
        dl.appendChild(o);
      });

      var addEx = btn("Add", "btn primary", function () {
        var n = String(exName.value || "").trim();
        if (!n) { toast("Type a vaccine"); return; }
        var q = Math.max(1, toInt(exQty.value, 1));
        S.extraTravel.push({ name: n, qty: q });
        exName.value = "";
        exQty.value = "1";
        renderTravelOrderList();
      });

      orderBox.appendChild(el("div", { class: "row" }, [exName, exQty, addEx]));
      orderBox.appendChild(dl);

      var saveBtn = btn("Save & Print…", "btn primary", function () {
        (async function () {
          try {
            var items = buildOrderItems(S.selectedTravel, S.extraTravel);
            if (!items.length) { toast("Select at least 1 vaccine"); return; }

            var first = String(fn.value || "").trim();
            var last = String(ln.value || "").trim();
            var phone = String(ph.value || "").trim();
            var email = String(em.value || "").trim();

            if (!first || !last) { toast("Enter client name & surname"); return; }
            if (!phone) { toast("Enter phone number"); return; }

            var payload = {
              section: "travel",
              country_code: S.selectedCountryCode || "",
              country_name: S.selectedCountryName || "",
              client_first: first,
              client_last: last,
              phone: phone,
              email: email,
              items: items
            };

            var saved = await apiJson("POST", "/vaccines/orders", payload);
            toast("Saved order");
            try { await refreshOrders(); } catch (e) {}

            choosePrintSize("Print order", function (size) {
              var order = {
                created_at: (saved && saved.created_at) ? saved.created_at : nowIso(),
                section: "travel",
                country_code: payload.country_code,
                country_name: payload.country_name,
                client_first: payload.client_first,
                client_last: payload.client_last,
                phone: payload.phone,
                email: payload.email,
                items: items
              };
              openPrintHtml(buildOrderPrintHtml(order, size));
            });

            S.selectedTravel = {};
            S.extraTravel = [];
            paint();
          } catch (e) { modalError("Save failed", e); }
        })();
      });

      orderBox.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [
        saveBtn,
        btn("Clear", "btn", function () { S.selectedTravel = {}; S.extraTravel = []; paint(); })
      ]));

      orderCard.appendChild(orderBox);

      grid.appendChild(tableCard);
      grid.appendChild(orderCard);
      wrap.appendChild(grid);

      // Orders table
      wrap.appendChild(renderOrdersCard());

      return wrap;

      function getTravelRows() {
        var q = norm(S.travelSearch);
        var rows = (S.catalog || []).filter(isTravel);
        if (!q) return rows;
        return rows.filter(function (r) {
          var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
          return s.indexOf(q) >= 0;
        });
      }
    }

    // -------------------------
    // ROUTINE & OTHER TAB
    // -------------------------
    function renderOtherTab() {
      var wrap = el("div", {});
      var otherSelList = null;

      function renderOtherOrderList() {
        if (!otherSelList) return;
        renderOrderSelectionEditor(otherSelList, S.selectedOther, S.extraOther, {
          onChange: otherSelChanged,
          onExtraChange: function () { renderOtherOrderList(); }
        });
      }

      function otherSelChanged(name, reason) {
        syncVaxControls(wrap, S.selectedOther, name);
        if (reason !== "qty") renderOtherOrderList();
      }


      var card = el("div", { class: "eikon-card" });
      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Routine & Other vaccines</b><div class='muted' style='font-size:12px;margin-top:2px'>Search filters as you type • Create orders • Print</div>" }),
        btn("Clear selection", "btn", function () { S.selectedOther = {}; S.extraOther = []; paint(); })
      ]));

      var search = input("text", "Search routine/other…", S.otherSearch || "");
      search.className = "input";
      search.style.maxWidth = "360px";
      search.addEventListener("input", function () { S.otherSearch = search.value; paint(); });

      card.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [
        search,
        btn("Print…", "btn", function () {
          choosePrintSize("Print table", function (size) {
            openPrintHtml(buildTablePrintHtml("Routine & Other vaccines", getRows(), size));
          });
        })
      ]));

      card.appendChild(buildVaxTable(getRows(), S.selectedOther, otherSelChanged));

      // order box
      var orderCard = el("div", { class: "eikon-card", style: "margin-top:12px" });
      orderCard.appendChild(el("div", { html: "<b>Create order</b><div class='muted' style='font-size:12px;margin-top:2px'>Same workflow as Travel</div>" }));

      var box = el("div", { class: "box", style: "margin-top:10px" });

      var fn = input("text", "Client name", S.clientTravel.first || "");
      var ln = input("text", "Client surname", S.clientTravel.last || "");
      var ph = input("text", "Phone number", S.clientTravel.phone || "");
      var em = input("email", "Email (optional)", S.clientTravel.email || "");
      fn.addEventListener("input", function () { S.clientTravel.first = fn.value; });
      ln.addEventListener("input", function () { S.clientTravel.last = ln.value; });
      ph.addEventListener("input", function () { S.clientTravel.phone = ph.value; });
      em.addEventListener("input", function () { S.clientTravel.email = em.value; });
      [fn, ln, ph, em].forEach(function (i) { i.className = "input"; i.style.maxWidth = "420px"; });

      box.appendChild(el("div", { class: "row" }, [fn]));
      box.appendChild(el("div", { class: "row" }, [ln]));
      box.appendChild(el("div", { class: "row" }, [ph]));
      box.appendChild(el("div", { class: "row" }, [em]));

      // Selected
      box.appendChild(el("div", { style: "margin-top:10px;font-weight:800", text: "Selected vaccines" }));
      otherSelList = el("div", { class: "orderList" });
      box.appendChild(otherSelList);
      renderOtherOrderList();

      // extra
      box.appendChild(el("div", { style: "margin-top:10px;font-weight:800", text: "Extra vaccines" }));
      var exName = input("text", "Type vaccine name…", "");
      exName.className = "input";
      exName.style.maxWidth = "420px";
      var exQty = input("number", "Qty", "1");
      exQty.className = "qty";
      exQty.min = "1";
      var addEx = btn("Add", "btn primary", function () {
        var n = String(exName.value || "").trim();
        if (!n) { toast("Type a vaccine"); return; }
        var q = Math.max(1, toInt(exQty.value, 1));
        S.extraOther.push({ name: n, qty: q });
        exName.value = "";
        exQty.value = "1";
        renderOtherOrderList();
      });
      box.appendChild(el("div", { class: "row" }, [exName, exQty, addEx]));

      var saveBtn = btn("Save & Print…", "btn primary", function () {
        (async function () {
          try {
            var items = buildOrderItems(S.selectedOther, S.extraOther);
            if (!items.length) { toast("Select at least 1 vaccine"); return; }

            var first = String(fn.value || "").trim();
            var last = String(ln.value || "").trim();
            var phone = String(ph.value || "").trim();
            var email = String(em.value || "").trim();

            if (!first || !last) { toast("Enter client name & surname"); return; }
            if (!phone) { toast("Enter phone number"); return; }

            var payload = {
              section: "other",
              country_code: "",
              country_name: "",
              client_first: first,
              client_last: last,
              phone: phone,
              email: email,
              items: items
            };

            var saved = await apiJson("POST", "/vaccines/orders", payload);
            toast("Saved order");
            try { await refreshOrders(); } catch (e) {}

            choosePrintSize("Print order", function (size) {
              var order = {
                created_at: (saved && saved.created_at) ? saved.created_at : nowIso(),
                section: "other",
                country_code: "",
                country_name: "",
                client_first: payload.client_first,
                client_last: payload.client_last,
                phone: payload.phone,
                email: payload.email,
                items: items
              };
              openPrintHtml(buildOrderPrintHtml(order, size));
            });

            S.selectedOther = {};
            S.extraOther = [];
            paint();
          } catch (e) { modalError("Save failed", e); }
        })();
      });

      box.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [
        saveBtn,
        btn("Clear", "btn", function () { S.selectedOther = {}; S.extraOther = []; paint(); })
      ]));

      orderCard.appendChild(box);

      wrap.appendChild(card);
      wrap.appendChild(orderCard);

      // Orders table
      wrap.appendChild(renderOrdersCard());

      return wrap;

      function getRows() {
        var q = norm(S.otherSearch);
        var rows = (S.catalog || []).filter(function (r) { return !isTravel(r) || isRoutine(r); });
        if (!q) return rows;
        return rows.filter(function (r) {
          var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
          return s.indexOf(q) >= 0;
        });
      }
    }

    // -------------------------
    // STOCK TAB
    // -------------------------
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
      var exp = input("text", "Expiry (YYYY-MM-DD optional)", "");
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
      addBox.appendChild(el("div", { class: "muted", text: "Leave batch/expiry empty if you don’t track them." }));
      card.appendChild(addBox);

      card.appendChild(buildStockTable(filterStockRows()));
      wrap.appendChild(card);
      return wrap;

      function filterStockRows() {
        var qq = norm(S.stockSearch);
        var rows = Array.isArray(S.stockRows) ? S.stockRows.slice() : [];
        if (!qq) return rows;
        return rows.filter(function (r) {
          var s = (String(r.vaccine_name || "") + " " + String(r.batch || "") + " " + String(r.expiry_date || "")).toLowerCase();
          return s.indexOf(qq) >= 0;
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
    }

    // -------------------------
    // DATABASE TAB
    // -------------------------
    function renderDbTab() {
      var wrap = el("div", {});
      var card = el("div", { class: "eikon-card" });

      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Database</b><div class='muted' style='font-size:12px;margin-top:2px'>Add vaccine name only. No edit/delete.</div>" }),
        btn("Refresh", "btn", function () {
          (async function () {
            try { await refreshCatalog(); paint(); toast("Catalog refreshed"); }
            catch (e) { modalError("Refresh failed", e); }
          })();
        })
      ]));

      var addBox = el("div", { class: "box" });
      addBox.appendChild(el("h3", { text: "Add vaccine to database" }));
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
      addBox.appendChild(el("div", { class: "row" }, [nm, addBtn]));
      addBox.appendChild(el("div", { class: "muted", text: "Users can only enter Vaccine name." }));
      card.appendChild(addBox);

      var q = input("text", "Search database…", S.dbSearch || "");
      q.className = "input";
      q.style.maxWidth = "360px";
      q.addEventListener("input", function () { S.dbSearch = q.value; paint(); });

      card.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [
        q,
        btn("Print…", "btn", function () {
          choosePrintSize("Print table", function (size) {
            openPrintHtml(buildTablePrintHtml("Vaccine database", filterRows(), size));
          });
        })
      ]));

      card.appendChild(buildDbTable(filterRows()));
      wrap.appendChild(card);
      return wrap;

      function filterRows() {
        var qq = norm(S.dbSearch);
        var rows = Array.isArray(S.catalog) ? S.catalog.slice() : [];
        if (!qq) return rows;
        return rows.filter(function (r) {
          var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
          return s.indexOf(qq) >= 0;
        });
      }

      function buildDbTable(rows) {
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

    // initial load
    try {
      await refreshCatalog();
      await refreshStock();
      await refreshOrders();
    } catch (e) {
      modalError("Vaccines load failed", e);
    }

    paint();
  }

  E.registerModule({
    id: "vaccines",
    title: "Vaccines",
    order: 24,
    icon: "💉",
    render: render
  });

})();
