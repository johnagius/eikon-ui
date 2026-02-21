/* ui/modules.vaccines.js
   Eikon - Vaccines module (UI)

   Worker endpoints:
     GET    /vaccines/catalog?q=
     POST   /vaccines/catalog                     { brand_name }
     GET    /vaccines/orders?month=YYYY-MM        (optional UI)
     POST   /vaccines/orders                      { section, country_code, country_name, client_first, client_last, phone, email, items:[{name,qty}] }

     GET    /vaccines/stock/rows?q=
     POST   /vaccines/stock/rows                  { vaccine_name, qty, batch, expiry_date }
     PUT    /vaccines/stock/rows/:id              { vaccine_name?, qty, batch, expiry_date }
*/

(function () {
  "use strict";

  var E = window.EIKON;
  var VAX_MODULE_VERSION = "2026-02-21-2";
  try { if (E && E.dbg) E.dbg("[vaccines] loaded v", VAX_MODULE_VERSION); } catch (e) {}

  if (!E) throw new Error("EIKON core missing (modules.vaccines.js)");

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

  function monthKey(d) {
    var dt = d instanceof Date ? d : new Date();
    var y = dt.getFullYear();
    var m = dt.getMonth() + 1;
    return y + "-" + (m < 10 ? "0" + m : "" + m);
  }

  async function apiJson(method, path, bodyObj) {
    // E.apiFetch() already returns parsed JSON (or throws on non-2xx).
    var opts = { method: method, headers: {} };
    if (bodyObj !== undefined) {
      opts.headers["Content-Type"] = "application/json";
      opts.body = JSON.stringify(bodyObj || {});
    }
    var data = await E.apiFetch(path, opts);

    // Some endpoints might return { ok:false, error:"..." } with 200; treat as error.
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
    E.modal.show(title || "Error", "<div style='white-space:pre-wrap'>" + esc(msg + extra) + "</div>", [
      { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
    ]);
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
  // Styles (scoped)
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
      ".vax-root .grid{display:grid;grid-template-columns:1.1fr .9fr;gap:12px;align-items:stretch}" +
      "@media(max-width:980px){.vax-root .grid{grid-template-columns:1fr}}" +
      ".vax-root .hero{position:relative;overflow:hidden;border-radius:16px;border:1px solid rgba(255,255,255,.12);background:linear-gradient(135deg,rgba(90,168,255,.14),rgba(255,92,165,.10),rgba(44,210,152,.08));box-shadow:0 10px 30px rgba(0,0,0,.28)}" +
      ".vax-root .heroInner{display:grid;grid-template-columns:1fr 340px;gap:14px;padding:14px;align-items:center}" +
      "@media(max-width:980px){.vax-root .heroInner{grid-template-columns:1fr}}" +
      ".vax-root .heroTitle{font-size:18px;font-weight:900;letter-spacing:.2px;margin:0 0 2px 0}" +
      ".vax-root .heroSub{color:rgba(233,238,247,.78);font-size:12px;margin:0 0 10px 0}" +
      ".vax-root .searchRow{display:flex;gap:8px;align-items:center;flex-wrap:wrap}" +
      ".vax-root .input{width:100%;min-width:220px;max-width:420px;background:rgba(10,14,20,.35);border:1px solid rgba(255,255,255,.14);color:var(--text);padding:10px 12px;border-radius:12px;outline:none}" +
      ".vax-root .input:focus{border-color:rgba(90,168,255,.6);box-shadow:0 0 0 3px rgba(90,168,255,.12)}" +
      ".vax-root .btn{border:1px solid var(--border);background:rgba(255,255,255,.03);color:var(--text);padding:10px 12px;border-radius:12px;cursor:pointer;transition:transform .08s ease,background .12s ease,border-color .12s ease;user-select:none;display:inline-flex;align-items:center;gap:8px;font-size:13px}" +
      ".vax-root .btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}" +
      ".vax-root .btn:active{transform:translateY(1px)}" +
      ".vax-root .btn.primary{background:rgba(90,168,255,.14);border-color:rgba(90,168,255,.6)}" +
      ".vax-root .btn.pink{background:rgba(255,92,165,.12);border-color:rgba(255,92,165,.55)}" +
      ".vax-root .btn.green{background:rgba(44,210,152,.12);border-color:rgba(44,210,152,.55)}" +
      ".vax-root .pill{display:inline-flex;align-items:center;gap:8px;padding:6px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(10,14,20,.22);font-size:12px;color:rgba(233,238,247,.86)}" +
      ".vax-root .pill b{color:var(--text)}" +
      ".vax-root .globeWrap{display:flex;justify-content:center;align-items:center}" +
      ".vax-root .globe{width:320px;height:320px;border-radius:50%;position:relative;overflow:hidden;border:1px solid rgba(255,255,255,.15);background:radial-gradient(circle at 30% 30%,rgba(255,255,255,.20),rgba(90,168,255,.08) 35%,rgba(0,0,0,.38) 72%,rgba(0,0,0,.52));box-shadow:inset -18px -18px 60px rgba(0,0,0,.35), 0 12px 40px rgba(0,0,0,.35)}" +
      ".vax-root .globe::before{content:'';position:absolute;inset:-40px;background:radial-gradient(circle at 20% 20%,rgba(255,255,255,.22),transparent 55%),radial-gradient(circle at 80% 60%,rgba(255,92,165,.18),transparent 50%),radial-gradient(circle at 30% 80%,rgba(44,210,152,.14),transparent 55%);filter:blur(0px);opacity:.95}" +
      ".vax-root .globe svg{position:absolute;inset:0;opacity:.95;filter:drop-shadow(0 10px 24px rgba(0,0,0,.35))}" +
      ".vax-root .pin{position:absolute;left:50%;top:50%;transform:translate(-50%,-50%) translateY(10px) scale(.9);width:14px;height:14px;border-radius:50%;background:radial-gradient(circle at 30% 30%,#fff,rgba(255,255,255,.2) 35%,rgba(255,92,165,.65));box-shadow:0 0 0 10px rgba(255,92,165,.10),0 0 0 22px rgba(90,168,255,.08),0 18px 40px rgba(0,0,0,.42);opacity:0;transition:opacity .18s ease,transform .24s ease}" +
      ".vax-root .pin::after{content:'';position:absolute;left:50%;top:12px;transform:translateX(-50%);width:0;height:0;border-left:6px solid transparent;border-right:6px solid transparent;border-top:14px solid rgba(255,92,165,.75);filter:drop-shadow(0 10px 18px rgba(0,0,0,.35))}" +
      ".vax-root .globe.active .pin{opacity:1;transform:translate(-50%,-50%) translateY(-10px) scale(1.05)}" +
      ".vax-root .countryLabel{position:absolute;left:50%;bottom:14px;transform:translateX(-50%);padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.16);background:rgba(10,14,20,.35);backdrop-filter:blur(10px);font-size:12px;color:rgba(233,238,247,.92);white-space:nowrap;max-width:90%;overflow:hidden;text-overflow:ellipsis}" +
      ".vax-root .split{display:grid;grid-template-columns:1fr 1fr;gap:10px}" +
      "@media(max-width:980px){.vax-root .split{grid-template-columns:1fr}}" +
      ".vax-root .box{border:1px solid rgba(255,255,255,.10);background:rgba(10,14,20,.22);border-radius:16px;padding:12px}" +
      ".vax-root .box h3{margin:0 0 10px 0;font-size:14px;letter-spacing:.2px}" +
      ".vax-root .list{display:flex;flex-direction:column;gap:8px;max-height:330px;overflow:auto;padding-right:4px}" +
      ".vax-root .item{display:flex;align-items:flex-start;gap:10px;padding:10px;border-radius:14px;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03)}" +
      ".vax-root .item:hover{border-color:rgba(255,255,255,.18);background:rgba(255,255,255,.04)}" +
      ".vax-root .item .nm{font-weight:900}" +
      ".vax-root .item .sub{color:rgba(233,238,247,.75);font-size:12px;margin-top:2px}" +
      ".vax-root .qty{width:88px;background:rgba(10,14,20,.28);border:1px solid rgba(255,255,255,.12);color:var(--text);border-radius:10px;padding:8px 10px;outline:none}" +
      ".vax-root .qty:focus{border-color:rgba(90,168,255,.6);box-shadow:0 0 0 3px rgba(90,168,255,.12)}" +
      ".vax-root table{width:100%;border-collapse:collapse}" +
      ".vax-root th,.vax-root td{padding:10px 10px;border-bottom:1px solid rgba(255,255,255,.08);vertical-align:top;text-align:left}" +
      ".vax-root th{font-size:12px;color:rgba(233,238,247,.75);letter-spacing:.35px;text-transform:uppercase}" +
      ".vax-root td{font-size:13px}" +
      ".vax-root .muted{color:rgba(233,238,247,.70)}" +
      ".vax-root .tag{display:inline-flex;align-items:center;gap:6px;padding:4px 8px;border-radius:999px;border:1px solid rgba(255,255,255,.12);font-size:12px;background:rgba(255,255,255,.03)}" +
      ".vax-root .tag.yes{border-color:rgba(44,210,152,.45);background:rgba(44,210,152,.10)}" +
      ".vax-root .tag.no{border-color:rgba(255,255,255,.10);background:rgba(255,255,255,.02)}" +
      ".vax-root .right{display:flex;justify-content:flex-end;gap:8px;flex-wrap:wrap}" +
      ".vax-root .row{display:flex;gap:10px;flex-wrap:wrap;align-items:center}" +
      ".vax-root .row > *{flex:0 0 auto}" +
      ".vax-root .row .grow{flex:1 1 auto;min-width:220px}" +
      ".vax-toast{position:fixed;left:50%;bottom:18px;transform:translateX(-50%) translateY(12px);opacity:0;background:rgba(10,14,20,.88);border:1px solid rgba(255,255,255,.14);color:rgba(233,238,247,.95);padding:10px 12px;border-radius:999px;box-shadow:0 12px 40px rgba(0,0,0,.45);transition:opacity .18s ease,transform .18s ease;z-index:9999;font-size:13px}" +
      ".vax-toast.show{opacity:1;transform:translateX(-50%) translateY(0)}";

    var st = document.createElement("style");
    st.type = "text/css";
    st.appendChild(document.createTextNode(css));
    document.head.appendChild(st);
  }

  // ------------------------------------------------------------
  // Country index (no hardcoded list)
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
        var nm = dn.of(cc) || cc;
        out.push({ code: cc, name: nm });
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
      var dn2 = new Intl.DisplayNames(["en"], { type: "region" });
      var codes = {};
      (catalog || []).forEach(function (v) {
        [v.travel_always, v.travel_highrisk].forEach(function (s) {
          String(s || "").split(",").forEach(function (cc) {
            cc = (cc || "").trim().toUpperCase();
            if (/^[A-Z]{2}$/.test(cc)) codes[cc] = 1;
          });
        });
      });
      codes["MT"] = 1;
      var arr = Object.keys(codes).map(function (cc) {
        return { code: cc, name: dn2.of(cc) || cc };
      });
      arr.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      return arr;
    } catch (e) {
      return [];
    }
  }

  // ------------------------------------------------------------
  // Printing
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
    if (!w) {
      E.modal.show("Print", "<div style='white-space:pre-wrap'>Popup blocked. Allow popups and try again.</div>", [
        { label: "Close", primary: true, onClick: function () { E.modal.hide(); } }
      ]);
      return;
    }
    try {
      w.document.open();
      w.document.write(html);
      w.document.close();
    } catch (e) {
      try { w.close(); } catch (e2) {}
      modalError("Print failed", e);
    }
  }

  function buildOrderPrintHtml(order, size) {
    var isReceipt = String(size || "A4").toUpperCase() !== "A4";
    var pageCss = isReceipt
      ? "@media print{@page{size:75mm auto;margin:4mm;} .printbar{display:none!important;}}"
      : "@media print{@page{size:A4;margin:12mm;} .printbar{display:none!important;}}";

    var w = isReceipt ? "75mm" : "auto";
    var max = isReceipt ? "75mm" : "900px";
    var pad = isReceipt ? "6px" : "16px";
    var title = "Vaccine Order";

    var itemsHtml = (order.items || []).map(function (it) {
      return "<tr>" +
        "<td style='padding:8px 6px;border-bottom:1px dashed #ddd'><b>" + esc(it.name) + "</b><div style='font-size:11px;color:#555'>" + esc(it.info || "") + "</div></td>" +
        "<td style='padding:8px 6px;border-bottom:1px dashed #ddd;text-align:right;white-space:nowrap'><b>x " + esc(it.qty) + "</b></td>" +
        "</tr>";
    }).join("");

    var countryLine = (order.country_name || order.country_code) ? ("<div style='margin-top:4px'><span style='color:#555'>Country:</span> <b>" + esc(order.country_name || "") + "</b> <span style='color:#777'>(" + esc(order.country_code || "") + ")</span></div>") : "";
    var secLine = order.section ? ("<div style='margin-top:4px'><span style='color:#555'>Section:</span> <b>" + esc(order.section) + "</b></div>") : "";

    var html =
      "<!doctype html><html><head><meta charset='utf-8' />" +
      "<title>" + esc(title) + "</title>" +
      "<style>" +
      pageCss +
      "html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}" +
      ".wrap{width:" + w + ";max-width:" + max + ";margin:0 auto;padding:" + pad + "}" +
      ".printbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;background:#fff;padding:10px;border-bottom:1px solid #eee}" +
      ".btn{border:1px solid #bbb;background:#fff;padding:8px 10px;border-radius:10px;cursor:pointer}" +
      "h1{margin:0;font-size:" + (isReceipt ? "16px" : "22px") + ";letter-spacing:.2px}" +
      ".meta{margin-top:6px;font-size:12px;color:#444}" +
      ".card{margin-top:12px;border:1px solid #000;border-radius:12px;padding:" + (isReceipt ? "10px" : "14px") + "}" +
      ".grid{display:grid;grid-template-columns:1fr 1fr;gap:10px 14px}" +
      ".k{font-size:11px;text-transform:uppercase;letter-spacing:.5px;color:#555}" +
      ".v{font-size:14px;font-weight:800;margin-top:2px}" +
      ".note{margin-top:10px;font-size:11px;color:#666}" +
      "table{width:100%;border-collapse:collapse;margin-top:10px}" +
      "</style></head><body>" +
      "<div class='printbar'>" +
      "  <button class='btn' onclick='window.print()'>Print</button>" +
      "  <button class='btn' onclick='window.close()'>Close</button>" +
      "</div>" +
      "<div class='wrap'>" +
      "  <h1>Vaccine Order</h1>" +
      "  <div class='meta'><div><span style='color:#555'>Order #</span> <b>" + esc(order.id || "") + "</b></div>" +
      "  <div style='margin-top:2px'><span style='color:#555'>Created:</span> <b>" + esc(order.created_at || "") + "</b></div>" +
      countryLine + secLine +
      "  </div>" +
      "  <div class='card'>" +
      "    <div class='grid'>" +
      "      <div><div class='k'>Client</div><div class='v'>" + esc((order.client_first || "") + " " + (order.client_last || "")).trim() + "</div></div>" +
      "      <div><div class='k'>Phone</div><div class='v'>" + esc(order.phone || "") + "</div></div>" +
      "      <div><div class='k'>Email</div><div class='v'>" + esc(order.email || "") + "</div></div>" +
      "      <div><div class='k'>Location</div><div class='v'>" + esc(order.location_name || "") + "</div></div>" +
      "    </div>" +
      "    <table>" +
      "      <thead><tr><th style='text-align:left;font-size:12px;color:#555;padding:6px'>Vaccine</th><th style='text-align:right;font-size:12px;color:#555;padding:6px'>Qty</th></tr></thead>" +
      "      <tbody>" + itemsHtml + "</tbody>" +
      "    </table>" +
      "    <div class='note'>Generated via the Eikon system.</div>" +
      "  </div>" +
      "</div>" +
      "<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e){}},80);});window.addEventListener('afterprint',function(){setTimeout(function(){try{window.close();}catch(e){}},250);});</script>" +
      "</body></html>";

    return html;
  }

  function buildTablePrintHtml(title, rows, size) {
    var isReceipt = String(size || "A4").toUpperCase() !== "A4";
    var pageCss = isReceipt
      ? "@media print{@page{size:75mm auto;margin:4mm;} .printbar{display:none!important;}}"
      : "@media print{@page{size:A4;margin:12mm;} .printbar{display:none!important;}}";

    var w = isReceipt ? "75mm" : "auto";
    var max = isReceipt ? "75mm" : "1100px";
    var pad = isReceipt ? "6px" : "14px";

    var head = isReceipt
      ? "<tr><th style='text-align:left;padding:6px;border-bottom:1px solid #ddd'>Vaccine</th><th style='text-align:right;padding:6px;border-bottom:1px solid #ddd'>Routine</th></tr>"
      : "<tr><th style='text-align:left;padding:8px;border-bottom:1px solid #ddd'>Vaccine</th><th style='text-align:left;padding:8px;border-bottom:1px solid #ddd'>Vaccinates for</th><th style='text-align:left;padding:8px;border-bottom:1px solid #ddd'>Schedule</th><th style='text-align:center;padding:8px;border-bottom:1px solid #ddd'>Routine</th></tr>";

    var body = (rows || []).map(function (r) {
      var routine = String(r.routine_in_malta || "").toLowerCase().indexOf("yes") >= 0 ? "Yes" : "No";
      if (isReceipt) {
        return "<tr>" +
          "<td style='padding:6px;border-bottom:1px dashed #ddd'><b>" + esc(r.brand_name || "") + "</b><div style='font-size:11px;color:#555'>" + esc(r.vaccinates_for || "") + "</div></td>" +
          "<td style='padding:6px;border-bottom:1px dashed #ddd;text-align:right'>" + esc(routine) + "</td>" +
          "</tr>";
      }
      return "<tr>" +
        "<td style='padding:8px;border-bottom:1px solid #eee'><b>" + esc(r.brand_name || "") + "</b></td>" +
        "<td style='padding:8px;border-bottom:1px solid #eee'>" + esc(r.vaccinates_for || "") + "</td>" +
        "<td style='padding:8px;border-bottom:1px solid #eee'>" + esc(r.dosing_schedule || "") + "</td>" +
        "<td style='padding:8px;border-bottom:1px solid #eee;text-align:center'>" + esc(routine) + "</td>" +
        "</tr>";
    }).join("");

    var html =
      "<!doctype html><html><head><meta charset='utf-8' />" +
      "<title>" + esc(title || "Vaccines") + "</title>" +
      "<style>" +
      pageCss +
      "html,body{margin:0;padding:0;background:#fff;color:#111;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif}" +
      ".wrap{width:" + w + ";max-width:" + max + ";margin:0 auto;padding:" + pad + "}" +
      ".printbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;background:#fff;padding:10px;border-bottom:1px solid #eee}" +
      ".btn{border:1px solid #bbb;background:#fff;padding:8px 10px;border-radius:10px;cursor:pointer}" +
      "h1{margin:0;font-size:" + (isReceipt ? "14px" : "20px") + "}" +
      ".meta{margin-top:6px;font-size:12px;color:#444}" +
      "table{width:100%;border-collapse:collapse;margin-top:10px}" +
      "th{font-size:12px;color:#333;text-transform:uppercase;letter-spacing:.35px}" +
      "</style></head><body>" +
      "<div class='printbar'><button class='btn' onclick='window.print()'>Print</button><button class='btn' onclick='window.close()'>Close</button></div>" +
      "<div class='wrap'>" +
      "<h1>" + esc(title || "Vaccines") + "</h1>" +
      "<div class='meta'>Generated: " + esc(nowIso()) + "</div>" +
      "<table><thead>" + head + "</thead><tbody>" + body + "</tbody></table>" +
      "</div>" +
      "<script>window.addEventListener('load',function(){setTimeout(function(){try{window.focus();}catch(e){}},50);});</script>" +
      "</body></html>";
    return html;
  }

  // ------------------------------------------------------------
  // State
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
      selectedTravel: {}, // name -> qty
      selectedOther: {},  // name -> qty
      extra: [],          // { name, qty }
      client_first: "",
      client_last: "",
      phone: "",
      email: "",
      travelSearch: "",
      otherSearch: "",
      stockSearch: "",
      dbSearch: ""
    };
  }

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
    // fast path: exact match on comma/edges
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
  // UI rendering
  // ------------------------------------------------------------
  function render(ctx) {
    ensureStyles();

    var mount = ctx.mount;
    mount.innerHTML = "";

    var S = makeState(ctx.user);

    var root = el("div", { class: "vax-root" });

    var headerCard = el("div", { class: "eikon-card" }, []);
    var hdr = el("div", { class: "hdr" });
    var left = el("div", {});
    left.appendChild(el("h2", { text: "Vaccines" }));
    left.appendChild(el("div", { class: "meta", text: "Travel • Routine & Other • Stock • Database" }));

    var tabs = el("div", { class: "tabs" });
    function mkTab(id, label, icon) {
      var b = el("button", { type: "button", class: "tab", "data-tab": id });
      b.appendChild(el("span", { text: icon || "•" }));
      b.appendChild(el("span", { text: label }));
      b.addEventListener("click", function () {
        S.active = id;
        paint();
      });
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

    // Load catalog + stock in the background (no "waiting" UX; we render skeletons)
    (async function bootstrap() {
      try {
        await refreshCatalog();
        await refreshStock();
        paint();
      } catch (e) {
        try { E.error && E.error('[vaccines] bootstrap failed:', e); } catch(_e) {}
        paint();
      }
    })();

    async function refreshCatalog() {
      var data = await apiJson("GET", "/vaccines/catalog", undefined);
      S.catalog = (data && data.items) ? data.items : [];
      S.catalogLoadedAt = nowIso();
      // Build country index (prefer Intl list; fall back to codes found in catalog)
      S.countryIndex = buildCountryIndexFromIntl() || buildCountryIndexFromCatalog(S.catalog);
    }

    async function refreshStock() {
      var data = await apiJson("GET", "/vaccines/stock/rows", undefined);
      S.stockRows = (data && data.rows) ? data.rows : [];
      S.stockLoadedAt = nowIso();
    }

    function setActiveTabStyles() {
      var btns = E.qa(".vax-root .tab", root);
      btns.forEach(function (b) {
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
    // Travel tab
    // ----------------------------------------------------------
    function renderTravelTab() {
      var wrap = el("div", {});
      // Hero
      var hero = el("div", { class: "hero" });
      var inner = el("div", { class: "heroInner" });

      var info = el("div", {});
      info.appendChild(el("div", { class: "heroTitle", text: "Travel vaccines" }));
      info.appendChild(el("div", { class: "heroSub", text: "Pick a country to instantly see recommended vaccines, build an order, print, and save." }));

      var searchRow = el("div", { class: "searchRow" });
      var countryInput = input("text", "Search country (e.g. Italy, Kenya, Japan)…", "");
      countryInput.className = "input";
      countryInput.setAttribute("autocomplete", "off");
      countryInput.setAttribute("list", "vax-country-datalist");
      var dl = el("datalist", { id: "vax-country-datalist" });
      (S.countryIndex || []).forEach(function (c) {
        dl.appendChild(el("option", { value: c.name + " (" + c.code + ")" }));
      });

      var pickBtn = btn("Use country", "btn primary", function () {
        var v = String(countryInput.value || "").trim();
        var parsed = parseCountryInput(v);
        if (!parsed) {
          toast("Type a country and select it from the list");
          return;
        }
        S.selectedCountryCode = parsed.code;
        S.selectedCountryName = parsed.name;
        paint();
      });

      searchRow.appendChild(countryInput);
      searchRow.appendChild(pickBtn);

      var pills = el("div", { class: "row", style: "margin-top:10px" });
      pills.appendChild(el("span", { class: "pill", html: "<b>Catalog</b> " + esc(S.catalog.length) + " vaccines" }));
      pills.appendChild(el("span", { class: "pill", html: "<b>Stock rows</b> " + esc(S.stockRows.length) }));
      if (S.selectedCountryCode) {
        pills.appendChild(el("span", { class: "pill", html: "<b>Selected</b> " + esc(S.selectedCountryName || "") + " (" + esc(S.selectedCountryCode) + ")" }));
      } else {
        pills.appendChild(el("span", { class: "pill", html: "<b>Tip</b> Start by choosing a country" }));
      }

      info.appendChild(searchRow);
      info.appendChild(dl);
      info.appendChild(pills);

      var globeWrap = el("div", { class: "globeWrap" });
      var globe = el("div", { class: "globe" });
      globe.appendChild(buildGlobeSvg());
      var pin = el("div", { class: "pin" });
      globe.appendChild(pin);
      var lab = el("div", { class: "countryLabel", text: S.selectedCountryCode ? ((S.selectedCountryName || "") + " (" + S.selectedCountryCode + ")") : "No country selected" });
      globe.appendChild(lab);
      if (S.selectedCountryCode) globe.classList.add("active");
      globeWrap.appendChild(globe);

      inner.appendChild(info);
      inner.appendChild(globeWrap);
      hero.appendChild(inner);
      wrap.appendChild(hero);

      // Recommendations + order builder
      var grid = el("div", { class: "grid", style: "margin-top:12px" });

      var leftCard = el("div", { class: "eikon-card" });
      leftCard.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
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

      leftCard.appendChild(split);

      // Travel table (browse & print)
      var travelTblCard = el("div", { class: "eikon-card", style: "margin-top:12px" });
      travelTblCard.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Travel vaccines table</b><div class='muted' style='font-size:12px;margin-top:2px'>Search filters as you type • Add items from here too</div>" }),
        el("div", { class: "right" }, [
          btn("Print…", "btn", function () {
            choosePrintSize("Print table", function (size) {
              var rows = getTravelTableRowsFiltered();
              openPrintHtml(buildTablePrintHtml("Travel vaccines", rows, size));
            });
          })
        ])
      ]));
      var tSearch = input("text", "Search travel table…", S.travelSearch || "");
      tSearch.className = "input";
      tSearch.style.maxWidth = "360px";
      tSearch.addEventListener("input", function () { S.travelSearch = tSearch.value; paint(); });
      travelTblCard.appendChild(el("div", { class: "row", style: "margin-bottom:8px" }, [tSearch]));
      travelTblCard.appendChild(buildVaxTable(getTravelTableRowsFiltered(), function (row) {
        // add to selection
        var nm = row.brand_name || "";
        if (!nm) return;
        if (!S.selectedTravel[nm]) S.selectedTravel[nm] = 1;
        paint();
        toast("Added: " + nm);
      }));
      leftCard.appendChild(travelTblCard);

      grid.appendChild(leftCard);

      var rightCard = el("div", { class: "eikon-card" });

      rightCard.appendChild(el("div", { html: "<b>Create order</b><div class='muted' style='font-size:12px;margin-top:2px'>Enter client details, add extra vaccines, print & save</div>" }));

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
        var q = toInt(extraQty.value, 1); if (q <= 0) q = 1;
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
        var exList = el("div", { class: "list", style: "max-height:180px;margin-top:10px" });
        S.extra.forEach(function (it, idx) {
          var line = el("div", { class: "item" });
          line.appendChild(el("div", { html: "<div class='nm'>" + esc(it.name) + "</div><div class='sub'>Extra item</div>" }));
          var qx = input("number", "", it.qty);
          qx.className = "qty";
          qx.min = "1";
          qx.step = "1";
          qx.addEventListener("change", function () { it.qty = Math.max(1, toInt(qx.value, 1)); });
          var rm = btn("✕", "btn", function () { S.extra.splice(idx, 1); paint(); });
          rm.title = "Remove";
          line.appendChild(el("div", { style: "margin-left:auto;display:flex;gap:8px;align-items:center" }, [qx, rm]));
          exList.appendChild(line);
        });
        extraBox.appendChild(exList);
      } else {
        extraBox.appendChild(el("div", { class: "muted", text: "Optional: add extra vaccines not listed above." }));
      }

      rightCard.appendChild(extraBox);

      // Client form
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
      var savePrint = btn("Print & Save order…", "btn primary", function () {
        choosePrintSize("Print order", function (size) { doCreateOrder("travel", size); });
      });
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
        var list = el("div", { class: "list", style: "max-height:260px" });
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
            // apply back to selectedTravel or extra
            if (S.selectedTravel[it.name] != null) { S.selectedTravel[it.name] = nn; paint(); }
            else {
              for (var j = 0; j < S.extra.length; j++) {
                if (S.extra[j].name === it.name) S.extra[j].qty = nn;
              }
            }
          });
          row.appendChild(el("div", { style: "margin-left:auto" }, [q]));
          list.appendChild(row);
        });
        summary.appendChild(list);
      }

      rightCard.appendChild(summary);

      grid.appendChild(rightCard);
      wrap.appendChild(grid);

      return wrap;
    }

    function buildGlobeSvg() {
      // Abstract, colorful continents (not country-accurate; decorative)
      var ns = "http://www.w3.org/2000/svg";
      var svg = document.createElementNS(ns, "svg");
      svg.setAttribute("viewBox", "0 0 320 320");
      svg.innerHTML =
        "<defs>" +
        "  <linearGradient id='g1' x1='0' y1='0' x2='1' y2='1'>" +
        "    <stop offset='0' stop-color='rgba(90,168,255,.55)'/>" +
        "    <stop offset='.55' stop-color='rgba(44,210,152,.38)'/>" +
        "    <stop offset='1' stop-color='rgba(255,92,165,.42)'/>" +
        "  </linearGradient>" +
        "  <radialGradient id='g2' cx='.35' cy='.3' r='.9'>" +
        "    <stop offset='0' stop-color='rgba(255,255,255,.22)'/>" +
        "    <stop offset='.55' stop-color='rgba(255,255,255,.05)'/>" +
        "    <stop offset='1' stop-color='rgba(0,0,0,0)'/>" +
        "  </radialGradient>" +
        "</defs>" +
        "<circle cx='160' cy='160' r='160' fill='rgba(0,0,0,0)'/>" +
        // graticule lines
        "<g opacity='.20' stroke='rgba(255,255,255,.75)' stroke-width='1'>" +
        "  <path d='M160 0 V320'/>" +
        "  <path d='M0 160 H320'/>" +
        "  <path d='M80 0 V320'/>" +
        "  <path d='M240 0 V320'/>" +
        "  <path d='M0 80 H320'/>" +
        "  <path d='M0 240 H320'/>" +
        "</g>" +
        // continents (blobs)
        "<g fill='url(#g1)' opacity='.78'>" +
        "  <path d='M64,112 C78,84 118,70 142,86 C160,98 158,126 136,140 C114,154 88,150 74,138 C64,130 58,124 64,112 Z'/>" + // N America
        "  <path d='M118,176 C132,160 154,160 170,178 C184,196 174,222 152,236 C130,250 110,236 108,214 C106,196 108,186 118,176 Z'/>" + // S America
        "  <path d='M186,98 C208,84 242,88 256,112 C270,136 252,166 224,166 C198,166 182,144 180,124 C178,110 176,104 186,98 Z'/>" + // Europe
        "  <path d='M188,170 C210,154 252,152 270,178 C288,204 270,246 232,250 C198,254 174,228 174,204 C174,186 176,178 188,170 Z'/>" + // Africa
        "  <path d='M234,190 C256,168 296,176 304,206 C312,236 292,266 260,268 C236,270 220,252 222,230 C224,212 224,202 234,190 Z'/>" + // Asia/Oceania
        "</g>" +
        "<circle cx='160' cy='160' r='160' fill='url(#g2)' opacity='.95'/>";

      return svg;
    }

    function parseCountryInput(text) {
      var t = String(text || "").trim();
      if (!t) return null;

      var m = t.match(/\(([A-Za-z]{2})\)\s*$/);
      var code = m ? m[1].toUpperCase() : "";
      var name = "";
      if (code) {
        var found = null;
        (S.countryIndex || []).some(function (c) {
          if (c.code === code) { found = c; return true; }
          return false;
        });
        name = found ? found.name : t.replace(/\([A-Za-z]{2}\)\s*$/, "").trim();
        return { code: code, name: name || code };
      }

      // Try exact name match
      var lc = t.toLowerCase();
      var hit = null;
      (S.countryIndex || []).some(function (c) {
        if (String(c.name || "").toLowerCase() === lc) { hit = c; return true; }
        return false;
      });
      return hit ? { code: hit.code, name: hit.name } : null;
    }

    function computeTravelRecommendations(countryCode) {
      var always = [];
      var high = [];
      (S.catalog || []).forEach(function (v) {
        if (!isTravelVax(v)) return;
        if (csvHasCountry(v.travel_always, countryCode)) always.push(v);
        else if (csvHasCountry(v.travel_highrisk, countryCode)) high.push(v);
      });
      // stable sort
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
        // allow duplicates, but we keep it merged for storage/stock
        var found = null;
        for (var i = 0; i < out.length; i++) {
          if (out[i].name === nm) { found = out[i]; break; }
        }
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

        // Reset selections
        if (section === "travel") S.selectedTravel = {};
        else S.selectedOther = {};
        S.extra = [];

        if (printSizeOrNull) {
          var order = data.order || {};
          // enrich items for print with info strings
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
    // Routine & Other tab
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

      // Order card
      var orderCard = el("div", { class: "eikon-card", style: "margin-top:12px" });
      orderCard.appendChild(el("div", { html: "<b>Create order</b><div class='muted' style='font-size:12px;margin-top:2px'>Same process as travel (no country)</div>" }));

      var extraBox = el("div", { class: "box", style: "margin-top:10px" });
      extraBox.appendChild(el("h3", { text: "Extra vaccines (optional)" }));
      var extraRow = el("div", { class: "row" });
      var extraInput = input("text", "Type vaccine name (suggestions)…", "");
      extraInput.className = "input";
      extraInput.setAttribute("list", "vax-vaccine-datalist2");
      extraInput.style.maxWidth = "360px";
      var vdl2 = el("datalist", { id: "vax-vaccine-datalist2" });
      (S.catalog || []).forEach(function (v) {
        var nm = String(v.brand_name || "").trim();
        if (!nm) return;
        vdl2.appendChild(el("option", { value: nm }));
      });
      var extraQty = input("number", "Qty", "1");
      extraQty.className = "qty";
      extraQty.min = "1";
      extraQty.step = "1";
      var addExtra = btn("Add", "btn green", function () {
        var nm = String(extraInput.value || "").trim();
        if (!nm) { toast("Type a vaccine name"); return; }
        var qq = toInt(extraQty.value, 1); if (qq <= 0) qq = 1;
        S.extra.push({ name: nm, qty: qq });
        extraInput.value = "";
        extraQty.value = "1";
        paint();
      });
      extraRow.appendChild(extraInput);
      extraRow.appendChild(extraQty);
      extraRow.appendChild(addExtra);
      extraBox.appendChild(extraRow);
      extraBox.appendChild(vdl2);

      if (S.extra.length) {
        var exList = el("div", { class: "list", style: "max-height:180px;margin-top:10px" });
        S.extra.forEach(function (it, idx) {
          var line = el("div", { class: "item" });
          line.appendChild(el("div", { html: "<div class='nm'>" + esc(it.name) + "</div><div class='sub'>Extra item</div>" }));
          var qx = input("number", "", it.qty);
          qx.className = "qty";
          qx.min = "1";
          qx.step = "1";
          qx.addEventListener("change", function () { it.qty = Math.max(1, toInt(qx.value, 1)); });
          var rm = btn("✕", "btn", function () { S.extra.splice(idx, 1); paint(); });
          rm.title = "Remove";
          line.appendChild(el("div", { style: "margin-left:auto;display:flex;gap:8px;align-items:center" }, [qx, rm]));
          exList.appendChild(line);
        });
        extraBox.appendChild(exList);
      }
      orderCard.appendChild(extraBox);

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
      actions.appendChild(btn("Save only", "btn", function () { doCreateOrder("other", null); }));
      actions.appendChild(btn("Print & Save order…", "btn primary", function () {
        choosePrintSize("Print order", function (size) { doCreateOrder("other", size); });
      }));
      form.appendChild(actions);

      orderCard.appendChild(form);

      var summary = el("div", { class: "box", style: "margin-top:10px" });
      summary.appendChild(el("h3", { text: "Order items" }));
      var items = collectOrderItems(S.selectedOther, S.extra);
      if (!items.length) summary.appendChild(el("div", { class: "muted", text: "No items selected yet." }));
      else {
        var list = el("div", { class: "list", style: "max-height:260px" });
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
            if (S.selectedOther[it.name] != null) { S.selectedOther[it.name] = nn; paint(); }
            else {
              for (var j = 0; j < S.extra.length; j++) if (S.extra[j].name === it.name) S.extra[j].qty = nn;
            }
          });
          row.appendChild(el("div", { style: "margin-left:auto" }, [q]));
          list.appendChild(row);
        });
        summary.appendChild(list);
      }
      orderCard.appendChild(summary);

      wrap.appendChild(card);
      wrap.appendChild(orderCard);
      return wrap;
    }

    function getOtherTableRowsFiltered() {
      var q = String(S.otherSearch || "").trim().toLowerCase();
      var rows = (S.catalog || []).filter(function (v) { return !isTravelVax(v); });
      if (!q) return rows;
      return rows.filter(function (r) {
        var s = (String(r.brand_name || "") + " " + String(r.vaccinates_for || "") + " " + String(r.dosing_schedule || "")).toLowerCase();
        return s.indexOf(q) >= 0;
      });
    }

    function buildVaxTable(rows, onAdd) {
      var wrapper = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px" });
      var table = el("table", {});
      var thead = el("thead", {});
      thead.appendChild(el("tr", {}, [
        el("th", { text: "Vaccine" }),
        el("th", { text: "Vaccinates for" }),
        el("th", { text: "Schedule" }),
        el("th", { text: "Routine" }),
        el("th", { text: "" })
      ]));
      table.appendChild(thead);

      var tbody = el("tbody", {});
      if (!rows || !rows.length) {
        tbody.appendChild(el("tr", {}, [el("td", { colspan: "5", class: "muted", text: "No rows." })]));
      } else {
        rows.forEach(function (r) {
          var routine = isRoutine(r);
          var tr = el("tr", {});
          tr.appendChild(el("td", { html: "<b>" + esc(r.brand_name || "") + "</b>" }));
          tr.appendChild(el("td", { text: String(r.vaccinates_for || "") }));
          tr.appendChild(el("td", { text: String(r.dosing_schedule || "") }));
          tr.appendChild(el("td", { html: "<span class='tag " + (routine ? "yes" : "no") + "'>" + (routine ? "Yes" : "No") + "</span>" }));
          var add = btn("Add", "btn", function () { if (onAdd) onAdd(r); });
          add.style.padding = "8px 10px";
          tr.appendChild(el("td", { style: "text-align:right" }, [add]));
          tbody.appendChild(tr);
        });
      }

      table.appendChild(tbody);
      wrapper.appendChild(table);
      return wrapper;
    }

    // ----------------------------------------------------------
    // Stock tab
    // ----------------------------------------------------------
    function renderStockTab() {
      var wrap = el("div", {});
      var card = el("div", { class: "eikon-card" });

      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Stock</b><div class='muted' style='font-size:12px;margin-top:2px'>Stock levels subtract on each order • Negative values allowed</div>" }),
        el("div", { class: "right" }, [
          btn("Refresh", "btn", function () { (async function(){ try{ await refreshStock(); paint(); toast("Stock refreshed"); } catch(e){ modalError("Refresh failed", e);} })(); })
        ])
      ]));

      var q = input("text", "Search stock…", S.stockSearch || "");
      q.className = "input";
      q.style.maxWidth = "360px";
      q.addEventListener("input", function () { S.stockSearch = q.value; paint(); });

      card.appendChild(el("div", { class: "row", style: "margin-bottom:10px" }, [q]));

      // Add new row
      var addBox = el("div", { class: "box" });
      addBox.appendChild(el("h3", { text: "Add / top-up stock" }));
      var r = el("div", { class: "row" });

      var vName = input("text", "Vaccine name (suggestions)…", "");
      vName.className = "input";
      vName.setAttribute("list", "vax-vaccine-datalist-stock");
      vName.style.maxWidth = "360px";

      var vdl = el("datalist", { id: "vax-vaccine-datalist-stock" });
      (S.catalog || []).forEach(function (v) {
        var nm = String(v.brand_name || "").trim();
        if (!nm) return;
        vdl.appendChild(el("option", { value: nm }));
      });

      var qty = input("number", "Qty", "0");
      qty.className = "qty";
      qty.step = "1";

      var batch = input("text", "Batch (optional)", "");
      batch.className = "input";
      batch.style.maxWidth = "220px";

      var exp = input("date", "", "");
      exp.className = "qty";
      exp.style.width = "180px";

      var addBtn = btn("Save stock row", "btn primary", function () {
        (async function () {
          try {
            var nm = String(vName.value || "").trim();
            if (!nm) { toast("Enter vaccine name"); return; }
            var qn = toInt(qty.value, 0);
            var b = String(batch.value || "").trim();
            var ex = String(exp.value || "").trim();
            await apiJson("POST", "/vaccines/stock/rows", { vaccine_name: nm, qty: qn, batch: b, expiry_date: ex });
            toast("Stock saved");
            vName.value = ""; qty.value = "0"; batch.value = ""; exp.value = "";
            await refreshStock();
            paint();
          } catch (e) { modalError("Save stock failed", e); }
        })();
      });

      r.appendChild(vName);
      r.appendChild(qty);
      r.appendChild(batch);
      r.appendChild(exp);
      r.appendChild(addBtn);
      addBox.appendChild(r);
      addBox.appendChild(vdl);

      card.appendChild(addBox);

      // Existing rows
      var listBox = el("div", { class: "box", style: "margin-top:10px" });
      listBox.appendChild(el("h3", { text: "Existing stock rows" }));

      var rows = filterStockRows();
      if (!rows.length) {
        listBox.appendChild(el("div", { class: "muted", text: "No stock rows yet. Add one above, or ignore stock tracking (orders will still be saved)." }));
      } else {
        var tblWrap = el("div", { style: "overflow:auto;border:1px solid rgba(255,255,255,.10);border-radius:16px" });
        var table = el("table", {});
        var thead = el("thead", {});
        thead.appendChild(el("tr", {}, [
          el("th", { text: "Vaccine" }),
          el("th", { text: "Qty" }),
          el("th", { text: "Batch" }),
          el("th", { text: "Expiry" }),
          el("th", { text: "Updated" }),
          el("th", { text: "" })
        ]));
        table.appendChild(thead);

        var tbody = el("tbody", {});
        rows.forEach(function (sr) {
          var tr = el("tr", {});
          tr.appendChild(el("td", { html: "<b>" + esc(sr.vaccine_name || "") + "</b>" }));

          var qn = input("number", "", sr.qty);
          qn.className = "qty";
          qn.step = "1";
          var bb = input("text", "", sr.batch || "");
          bb.className = "input";
          bb.style.maxWidth = "220px";
          var ex = input("date", "", sr.expiry_date || "");
          ex.className = "qty";
          ex.style.width = "180px";

          tr.appendChild(el("td", {}, [qn]));
          tr.appendChild(el("td", {}, [bb]));
          tr.appendChild(el("td", {}, [ex]));
          tr.appendChild(el("td", { class: "muted", text: String(sr.updated_at || "") }));

          var save = btn("Save", "btn", function () {
            (async function () {
              try {
                var newQty = toInt(qn.value, 0);
                var newBatch = String(bb.value || "").trim();
                var newExp = String(ex.value || "").trim();
                await apiJson("PUT", "/vaccines/stock/rows/" + encodeURIComponent(String(sr.id)), { qty: newQty, batch: newBatch, expiry_date: newExp });
                toast("Updated");
                await refreshStock();
                paint();
              } catch (e) { modalError("Update failed", e); }
            })();
          });
          save.style.padding = "8px 10px";
          tr.appendChild(el("td", { style: "text-align:right" }, [save]));
          tbody.appendChild(tr);
        });
        table.appendChild(tbody);
        tblWrap.appendChild(table);
        listBox.appendChild(tblWrap);
      }

      card.appendChild(listBox);
      wrap.appendChild(card);
      return wrap;
    }

    function filterStockRows() {
      var q = String(S.stockSearch || "").trim().toLowerCase();
      var rows = Array.isArray(S.stockRows) ? S.stockRows.slice() : [];
      if (!q) return rows;
      return rows.filter(function (r) {
        var s = (String(r.vaccine_name || "") + " " + String(r.batch || "") + " " + String(r.expiry_date || "")).toLowerCase();
        return s.indexOf(q) >= 0;
      });
    }

    // ----------------------------------------------------------
    // Database tab
    // ----------------------------------------------------------
    function renderDbTab() {
      var wrap = el("div", {});
      var card = el("div", { class: "eikon-card" });

      card.appendChild(el("div", { class: "row", style: "justify-content:space-between;align-items:center;margin-bottom:8px" }, [
        el("div", { html: "<b>Database</b><div class='muted' style='font-size:12px;margin-top:2px'>You can only add new vaccines (name only). Existing rows are read-only.</div>" }),
        btn("Refresh", "btn", function () { (async function(){ try{ await refreshCatalog(); paint(); toast("Catalog refreshed"); } catch(e){ modalError("Refresh failed", e);} })(); })
      ]));

      // Add row (only vaccine name)
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
      addBox.appendChild(el("div", { class: "muted", text: "Note: Only the vaccine name is editable. Other columns remain blank unless an admin seeds them." }));

      card.appendChild(addBox);

      // Search + table
      var q = input("text", "Search database…", S.dbSearch || "");
      q.className = "input";
      q.style.maxWidth = "360px";
      q.addEventListener("input", function () { S.dbSearch = q.value; paint(); });

      card.appendChild(el("div", { class: "row", style: "margin-top:10px" }, [q, btn("Print…", "btn", function () {
        choosePrintSize("Print table", function (size) {
          var rows = filterDbRows();
          openPrintHtml(buildTablePrintHtml("Vaccine database", rows, size));
        });
      })]));

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

  E.registerModule({
    id: "vaccines",
    title: "Vaccines",
    order: 24,
    icon: "💉",
    render: render
  });

})();
