(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ------------------------------------------------------------
  // Heavy module logging helper
  // ------------------------------------------------------------
  function log() { E.log.apply(E, ["[temp]"].concat([].slice.call(arguments))); }
  function dbg() { E.dbg.apply(E, ["[temp]"].concat([].slice.call(arguments))); }
  function warn() { E.warn.apply(E, ["[temp]"].concat([].slice.call(arguments))); }
  function err() { E.error.apply(E, ["[temp]"].concat([].slice.call(arguments))); }

  // ------------------------------------------------------------
  // Minimal UI helpers (no dependency on old E.util)
  // ------------------------------------------------------------
  function escHtml(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  function el(tag, attrs, children) {
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

  // ------------------------------------------------------------
  // Toasts + modal confirm (GoDaddy-safe, no browser confirm())
  // ------------------------------------------------------------
  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return;
    toastInstalled = true;
    var st = document.createElement("style");
    st.type = "text/css";
    st.textContent =
      ".eikon-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".eikon-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);}"+
      ".eikon-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}"+
      ".eikon-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}"+
      ".eikon-toast.good{border-color:rgba(67,209,122,.35);}"+
      ".eikon-toast.bad{border-color:rgba(255,90,122,.35);}"+
      ".eikon-toast.warn{border-color:rgba(255,200,90,.35);}"+
      ".eikon-dot{width:10px;height:10px;border-radius:999px;display:inline-block;vertical-align:middle;background:#7a869a;border:1px solid rgba(255,255,255,.14);}"+
      ".eikon-dot.ok{background:rgba(67,209,122,.95);}"+
      ".eikon-dot.bad{background:rgba(255,90,122,.95);}"+
      ".eikon-mini{font-size:12px;opacity:.85;}" +
      ".eikon-slim-input{min-width:120px;}" +
      ".eikon-chart-wrap{width:100%;overflow:auto;}" +
      ".eikon-chart{width:100%;min-width:680px;}" +
      ".eikon-legend{display:flex;flex-wrap:wrap;gap:10px;margin-top:10px;}" +
      ".eikon-legend-item{display:flex;align-items:center;gap:8px;padding:4px 10px;border-radius:999px;border:1px solid var(--border);background:rgba(255,255,255,.02);}" +
      ".eikon-legend-item .nm{font-size:12px;opacity:.9;white-space:nowrap;}" +
      ".eikon-kv{display:flex;gap:10px;flex-wrap:wrap;margin-top:8px;}" +
      ".eikon-kv .k{font-size:12px;opacity:.8;}" +
      ".eikon-kv .v{font-weight:900;}" +
      "";
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

    var t = el("div", { class: "eikon-toast " + (kind || "") });
    t.appendChild(el("div", { class: "t-title", text: title || "Info" }));
    t.appendChild(el("div", { class: "t-msg", text: message || "" }));
    wrap.appendChild(t);

    var ttl = (typeof ms === "number" ? ms : 2600);
    setTimeout(function () {
      try { t.remove(); } catch (e) {}
    }, ttl);
  }

  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function (resolve) {
      try {
        E.modal.show(title || "Confirm", "<div class='eikon-mini'>" + escHtml(bodyText || "") + "</div>", [
          { label: cancelLabel || "Cancel", onClick: function () { E.modal.hide(); resolve(false); } },
          { label: okLabel || "OK", danger: true, onClick: function () { E.modal.hide(); resolve(true); } }
        ]);
      } catch (e) {
        // fallback if modal fails
        resolve(window.confirm(bodyText || "Are you sure?"));
      }
    });
  }

  // ------------------------------------------------------------
  // Offline queue (localStorage) for "Sync queued"
  // ------------------------------------------------------------
  var QKEY = "eikon_temp_queue_v1";

  function qLoad() {
    try {
      var raw = window.localStorage.getItem(QKEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr;
    } catch (e) {
      return [];
    }
  }

  function qSave(arr) {
    try { window.localStorage.setItem(QKEY, JSON.stringify(arr || [])); } catch (e) {}
  }

  function qAdd(job) {
    var arr = qLoad();
    arr.push(job);
    qSave(arr);
    dbg("queued job:", job);
  }

  async function qFlush() {
    var arr = qLoad();
    if (!arr.length) return { sent: 0, remaining: 0 };

    dbg("qFlush start, jobs=", arr.length);

    var sent = 0;
    var keep = [];

    for (var i = 0; i < arr.length; i++) {
      var j = arr[i];
      try {
        await E.apiFetch(j.path, {
          method: j.method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(j.body)
        });
        sent++;
      } catch (e) {
        keep.push(j);
        warn("qFlush job failed, keeping:", e && (e.message || e));
      }
    }

    qSave(keep);
    dbg("qFlush done, sent=", sent, "remaining=", keep.length);
    return { sent: sent, remaining: keep.length };
  }

  // ------------------------------------------------------------
  // Core math + date helpers (from your old module, adapted)
  // ------------------------------------------------------------
  function fmt1(n) {
    if (n === null || n === undefined) return "";
    var v = Number(n);
    if (!Number.isFinite(v)) return "";
    return (Math.round(v * 10) / 10).toFixed(1);
  }

  function parseNum(n) {
    var s = String(n || "").trim();
    if (!s) return null;
    var v = Number(s);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 10) / 10;
  }

  // Default safety floor for room temperature (used when device has no explicit min_limit)
  var ROOM_DEFAULT_MIN_LIMIT = 8.1;

  function effectiveMinLimit(dev) {
    try {
      if (dev && Number.isFinite(Number(dev.min_limit))) return Number(dev.min_limit);
      if (dev && String(dev.device_type || "") === "room") return ROOM_DEFAULT_MIN_LIMIT;
    } catch (e) {}
    return null;
  }

  function exampleTempsForDevice(dev) {
    var t = String((dev && dev.device_type) || "").toLowerCase();
    if (t === "room") return { min: "16.5", max: "23.3" };
    if (t === "fridge") return { min: "3.2", max: "7.8" };
    return { min: "10.0", max: "20.0" };
  }


  function todayYmd() {
    var d = new Date();
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var dd = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + dd;
  }

  function ymdToMonth(ymd) {
    var s = String(ymd || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return "";
    return s.slice(0, 7);
  }

  function groupEntriesByDate(entries) {
    var map = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var k = String(e.entry_date || "");
      if (!map[k]) map[k] = [];
      map[k].push(e);
    }
    return map;
  }

  function statusDot(minTemp, maxTemp, minLimit, maxLimit) {
    var minT = (minTemp === null || minTemp === undefined) ? null : Number(minTemp);
    var maxT = (maxTemp === null || maxTemp === undefined) ? null : Number(maxTemp);
    var minL = (minLimit === null || minLimit === undefined) ? null : Number(minLimit);
    var maxL = (maxLimit === null || maxLimit === undefined) ? null : Number(maxLimit);

    if (!Number.isFinite(minT) || !Number.isFinite(maxT)) return { cls: "", label: "Missing" };

    var out = false;
    if (Number.isFinite(minL) && minT < minL) out = true;
    if (Number.isFinite(maxL) && maxT > maxL) out = true;

    if (out) return { cls: "bad", label: "Out of limit" };
    return { cls: "ok", label: "OK" };
  }

  function monthKeyFromDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    return y + "-" + m;
  }

  function parseYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ""))) return null;
    var parts = s.split("-").map(function (n) { return parseInt(n, 10); });
    var y = parts[0], m = parts[1], d = parts[2];
    var dt = new Date(y, m - 1, d);
    if (dt.getFullYear() !== y || dt.getMonth() !== (m - 1) || dt.getDate() !== d) return null;
    return dt;
  }

  // ------------------------------------------------------------
  // Dashboard chart helpers (SVG, print-safe)
  // ------------------------------------------------------------
  function monthKeyAdd(monthKey, delta) {
    var mk = String(monthKey || "");
    if (!/^\d{4}-\d{2}$/.test(mk)) return "";
    var y = parseInt(mk.slice(0, 4), 10);
    var m = parseInt(mk.slice(5, 7), 10) - 1;
    var d = new Date(y, m, 1);
    d.setMonth(d.getMonth() + (delta || 0));
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
  }

  function monthKeyNice(monthKey) {
    var mk = String(monthKey || "");
    if (!/^\d{4}-\d{2}$/.test(mk)) return mk;
    var y = parseInt(mk.slice(0, 4), 10);
    var m = parseInt(mk.slice(5, 7), 10);
    var names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
    return (names[m - 1] || mk) + " " + y;
  }

  function monthDaysFromKey(monthKey) {
    var mk = String(monthKey || "");
    if (!/^\d{4}-\d{2}$/.test(mk)) return [];
    var y = parseInt(mk.slice(0, 4), 10);
    var m = parseInt(mk.slice(5, 7), 10);
    var last = new Date(y, m, 0).getDate();
    var out = [];
    for (var d = 1; d <= last; d++) {
      out.push(y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0"));
    }
    return out;
  }

  function dashPatternForIndex(i) {
    var pats = ["", "7 4", "2 3", "10 4 2 4", "1 4", "12 4 2 4 2 4"];
    return pats[(i || 0) % pats.length];
  }

  function svgEscape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function buildLegendHtml(devices, mode) {
    var devs = Array.isArray(devices) ? devices : [];
    var dark = mode !== "print";
    var stroke = dark ? "rgba(233,238,247,.95)" : "#000";
    var html = "<div class='eikon-legend'>";
    for (var i = 0; i < devs.length; i++) {
      var d = devs[i];
      var dash = dashPatternForIndex(i);
      html += "<div class='eikon-legend-item'>" +
        "<svg width='44' height='10' viewBox='0 0 44 10' xmlns='http://www.w3.org/2000/svg'>" +
        "<line x1='2' y1='5' x2='42' y2='5' stroke='" + stroke + "' stroke-width='2' stroke-dasharray='" + dash + "' />" +
        "</svg>" +
        "<span class='nm'>" + svgEscape(d && d.name ? d.name : "") + "</span>" +
        "</div>";
    }
    html += "</div>";
    return html;
  }

  function buildMonthChartSvg(opts) {
    opts = opts || {};
    var mk = String(opts.monthKey || "");
    var days = monthDaysFromKey(mk);
    var n = days.length;

    var W = Number(opts.width || 1000);
    var H = Number(opts.height || 260);

    var padL = 54, padR = 14, padT = 22, padB = 34;
    var plotW = Math.max(10, W - padL - padR);
    var plotH = Math.max(10, H - padT - padB);

    var mode = String(opts.mode || "dark");
    var dark = mode !== "print";
    var bg = dark ? "rgba(255,255,255,.02)" : "#fff";
    var grid = dark ? "rgba(255,255,255,.10)" : "#d0d0d0";
    var axis = dark ? "rgba(233,238,247,.85)" : "#000";
    var series = dark ? "rgba(233,238,247,.95)" : "#000";
    var muted = dark ? "rgba(233,238,247,.55)" : "#444";
    var hi = dark ? "rgba(255,255,255,.16)" : "#999";

    var devs = Array.isArray(opts.devices) ? opts.devices : [];
    var entries = Array.isArray(opts.entries) ? opts.entries : [];

    var dayIndex = {};
    for (var i = 0; i < n; i++) dayIndex[days[i]] = i;

    var seriesByDid = {};
    for (var di = 0; di < devs.length; di++) {
      var did = String(devs[di].id);
      seriesByDid[did] = { min: new Array(n), max: new Array(n) };
      for (var ii = 0; ii < n; ii++) { seriesByDid[did].min[ii] = null; seriesByDid[did].max[ii] = null; }
    }

    var minV = Infinity;
    var maxV = -Infinity;

    for (var ei = 0; ei < entries.length; ei++) {
      var e = entries[ei];
      var idx = dayIndex[String(e.entry_date || "")];
      if (idx === undefined) continue;
      var did2 = String(e.device_id);
      if (!seriesByDid[did2]) continue;
      var mn = Number(e.min_temp);
      var mx = Number(e.max_temp);
      if (!Number.isFinite(mn) || !Number.isFinite(mx)) continue;
      seriesByDid[did2].min[idx] = mn;
      seriesByDid[did2].max[idx] = mx;
      if (mn < minV) minV = mn;
      if (mx < minV) minV = mx;
      if (mn > maxV) maxV = mn;
      if (mx > maxV) maxV = mx;
    }

    var noData = !(Number.isFinite(minV) && Number.isFinite(maxV));
    if (noData) { minV = 0; maxV = 10; }

    var span = maxV - minV;
    if (!Number.isFinite(span) || span < 1) span = 1;
    minV = minV - span * 0.08;
    maxV = maxV + span * 0.08;

    function xFor(i) {
      if (n <= 1) return padL;
      return padL + (i / (n - 1)) * plotW;
    }
    function yFor(v) {
      return padT + (maxV - v) * (plotH / (maxV - minV));
    }

    function pathFor(arr) {
      var d = "";
      var started = false;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!Number.isFinite(v)) { started = false; continue; }
        var x = xFor(i);
        var y = yFor(v);
        if (!started) { d += "M" + x.toFixed(2) + "," + y.toFixed(2); started = true; }
        else { d += " L" + x.toFixed(2) + "," + y.toFixed(2); }
      }
      return d;
    }

    // Ticks
    var ticks = 5;
    var yTicks = [];
    for (var t = 0; t < ticks; t++) {
      var v = minV + (t / (ticks - 1)) * (maxV - minV);
      yTicks.push(v);
    }

    // X label positions: 1, 8, 15, 22, last
    var xLabs = [];
    if (n > 0) {
      var cand = [0, 7, 14, 21, n - 1];
      var seen = {};
      for (var ci = 0; ci < cand.length; ci++) {
        var idx = cand[ci];
        if (idx < 0 || idx >= n) continue;
        if (seen[idx]) continue;
        seen[idx] = 1;
        xLabs.push(idx);
      }
    }

    var highlightIdx = null;
    var hy = String(opts.highlightYmd || "");
    if (hy && dayIndex[hy] !== undefined) highlightIdx = dayIndex[hy];

    var out = "";
    out += "<svg class='eikon-chart' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + " " + H + "' width='100%' height='" + H + "' role='img' aria-label='Temperature chart'>";
    out += "<rect x='0' y='0' width='" + W + "' height='" + H + "' fill='" + bg + "' rx='14' ry='14'/>";

    // Grid + Y labels
    for (var yi = 0; yi < yTicks.length; yi++) {
      var v2 = yTicks[yi];
      var y = yFor(v2);
      out += "<line x1='" + padL + "' y1='" + y.toFixed(2) + "' x2='" + (W - padR) + "' y2='" + y.toFixed(2) + "' stroke='" + grid + "' stroke-width='1'/>";
      out += "<text x='" + (padL - 8) + "' y='" + (y + 4).toFixed(2) + "' text-anchor='end' font-size='11' fill='" + axis + "'>" + svgEscape(fmt1(v2)) + "</text>";
    }

    // X axis line
    out += "<line x1='" + padL + "' y1='" + (padT + plotH) + "' x2='" + (W - padR) + "' y2='" + (padT + plotH) + "' stroke='" + grid + "' stroke-width='1'/>";

    // X labels
    for (var xl = 0; xl < xLabs.length; xl++) {
      var idx2 = xLabs[xl];
      var x2 = xFor(idx2);
      out += "<text x='" + x2.toFixed(2) + "' y='" + (H - 12) + "' text-anchor='middle' font-size='11' fill='" + axis + "'>" + svgEscape(String(idx2 + 1)) + "</text>";
    }

    // Highlight day
    if (highlightIdx !== null) {
      var hx = xFor(highlightIdx);
      out += "<line x1='" + hx.toFixed(2) + "' y1='" + padT + "' x2='" + hx.toFixed(2) + "' y2='" + (padT + plotH) + "' stroke='" + hi + "' stroke-width='2'/>";
    }

    // Series
    for (var si = 0; si < devs.length; si++) {
      var dv = devs[si];
      var did3 = String(dv.id);
      var ser = seriesByDid[did3];
      if (!ser) continue;
      var dash = dashPatternForIndex(si);
      var dMax = pathFor(ser.max);
      var dMin = pathFor(ser.min);

      if (dMin) out += "<path d='" + dMin + "' fill='none' stroke='" + series + "' stroke-opacity='" + (dark ? "0.35" : "0.30") + "' stroke-width='1' stroke-linejoin='round' stroke-linecap='round' stroke-dasharray='" + dash + "'/>";
      if (dMax) out += "<path d='" + dMax + "' fill='none' stroke='" + series + "' stroke-opacity='" + (dark ? "0.90" : "0.85") + "' stroke-width='2' stroke-linejoin='round' stroke-linecap='round' stroke-dasharray='" + dash + "'/>";
    }

    // Caption
    out += "<text x='" + padL + "' y='16' text-anchor='start' font-size='12' fill='" + muted + "'>Thin=min • Thick=max</text>";

    if (noData) {
      out += "<text x='" + (padL + plotW / 2) + "' y='" + (padT + plotH / 2) + "' text-anchor='middle' font-size='14' fill='" + muted + "'>No data</text>";
    }

    out += "</svg>";
    return out;
  }

  function buildDashboardPrintHtml(opts) {
    opts = opts || {};
    var title = String(opts.title || "Temperature Dashboard");
    var mk = String(opts.monthKey || "");
    var pk = String(opts.prevMonthKey || "");

    var devices = Array.isArray(opts.devices) ? opts.devices : [];
    var monthDevices = Array.isArray(opts.monthDevices) ? opts.monthDevices : devices;
    var prevDevices = Array.isArray(opts.prevDevices) ? opts.prevDevices : devices;

    var svg1 = buildMonthChartSvg({
      monthKey: mk,
      devices: monthDevices,
      entries: (opts.monthEntries || []),
      highlightYmd: (opts.highlightYmd || ""),
      mode: "print",
      width: 1000,
      height: 280
    });

    var svg2 = buildMonthChartSvg({
      monthKey: pk,
      devices: prevDevices,
      entries: (opts.prevEntries || []),
      highlightYmd: "",
      mode: "print",
      width: 1000,
      height: 280
    });

    var legend1 = buildLegendHtml(monthDevices, "print");
    var legend2 = buildLegendHtml(prevDevices, "print");

    function esc(s) {
      return String(s).replace(/[&<>'"]/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    return "<!doctype html>\n" +
      "<html><head><meta charset='utf-8'/>" +
      "<meta name='viewport' content='width=device-width, initial-scale=1'/>" +
      "<title>" + esc(title) + "</title>" +
      "<style>" +
      "@page{size:A4; margin:12mm;}" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;margin:0;color:#000;}" +
      ".page{padding:12mm;}" +
      "h1{margin:0 0 6px 0;font-size:20px;}" +
      ".sub{margin:0 0 14px 0;font-size:12px;color:#111;}" +
      "h2{margin:16px 0 8px 0;font-size:14px;}" +
      ".box{border:1px solid #000;border-radius:10px;padding:10px;margin:0 0 12px 0;}" +
      ".eikon-legend{display:flex;flex-wrap:wrap;gap:8px;margin-top:10px;}" +
      ".eikon-legend-item{display:flex;align-items:center;gap:8px;border:1px solid #000;border-radius:999px;padding:4px 10px;}" +
      ".eikon-legend-item .nm{font-size:11px;white-space:nowrap;}" +
      "svg{max-width:100%;height:auto;display:block;}" +
      "@media print{h2{page-break-after:avoid;} .box{page-break-inside:avoid;}}" +
      "</style></head><body>" +
      "<div class='page'>" +
      "<h1>" + esc(title) + "</h1>" +
      "<p class='sub'>Printed: " + esc(new Date().toISOString().slice(0, 10)) + " • Thin=min, Thick=max</p>" +
      "<div class='box'>" +
      "<h2>" + esc(monthKeyNice(mk)) + "</h2>" +
      svg1 +
      legend1 +
      "</div>" +
      "<div class='box'>" +
      "<h2>" + esc(monthKeyNice(pk)) + "</h2>" +
      svg2 +
      legend2 +
      "</div>" +
      "</div>" +
      "<script>" +
      "window.addEventListener('load', function(){setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e){}}, 80);});" +
      "window.addEventListener('afterprint', function(){setTimeout(function(){try{window.close();}catch(e){}}, 250);});" +
      "</script>" +
      "</body></html>";
  }

  // ------------------------------------------------------------
  // Print report helpers (kept from your old logic)
  // ------------------------------------------------------------
  function buildPrintHtml(data) {
    var org = String(data.org_name || "");
    var loc = String(data.location_name || "");
    var from = String(data.from || "");
    var to = String(data.to || "");
    var devices = Array.isArray(data.devices) ? data.devices : [];
    var entries = Array.isArray(data.entries) ? data.entries : [];

    var mapByDate = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      var ed = String(e.entry_date || "");
      var did = String(e.device_id || "");
      if (!mapByDate[ed]) mapByDate[ed] = {};
      mapByDate[ed][did] = e;
    }

    var fromDt = parseYmd(from);
    var toDt = parseYmd(to);
    var days = [];

    if (fromDt && toDt) {
      var cur = new Date(fromDt.getFullYear(), fromDt.getMonth(), fromDt.getDate());
      var end = new Date(toDt.getFullYear(), toDt.getMonth(), toDt.getDate());
      while (cur <= end) {
        var ymd = cur.getFullYear() + "-" +
          String(cur.getMonth() + 1).padStart(2, "0") + "-" +
          String(cur.getDate()).padStart(2, "0");
        days.push(ymd);
        cur.setDate(cur.getDate() + 1);
      }
    }

    var byMonth = {};
    for (var j = 0; j < days.length; j++) {
      var ymd2 = days[j];
      var dt = parseYmd(ymd2);
      var mk = dt ? monthKeyFromDate(dt) : ymd2.slice(0, 7);
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(ymd2);
    }

    var months = Object.keys(byMonth);

    function esc(s) {
      return String(s).replace(/[&<>"']/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    function cellFor(ymd, devId) {
      var e = (mapByDate[ymd] && mapByDate[ymd][String(devId)]) ? mapByDate[ymd][String(devId)] : null;
      if (!e) return "";
      return fmt1(e.min_temp) + " / " + fmt1(e.max_temp);
    }

    var tables = "";

    for (var mi = 0; mi < months.length; mi++) {
      var mk2 = months[mi];

      var thead = "<tr><th style='text-align:left;'>" + esc(mk2) + "</th>";
      for (var di = 0; di < devices.length; di++) {
        var dvc = devices[di];
        thead += "<th style='text-align:left;'>" + esc(dvc.name || "") + "</th>";
      }
      thead += "</tr>";

      var tbody = "";
      for (var k = 0; k < byMonth[mk2].length; k++) {
        var day = byMonth[mk2][k];
        var tr = "<tr><td style='white-space:nowrap;'>" + esc(day) + "</td>";
        for (var di2 = 0; di2 < devices.length; di2++) {
          var d2 = devices[di2];
          tr += "<td>" + esc(cellFor(day, d2.id)) + "</td>";
        }
        tr += "</tr>";
        tbody += tr;
      }

      tables +=
        "<h2>" + esc(mk2) + "</h2>" +
        "<table><thead>" + thead + "</thead><tbody>" + tbody + "</tbody></table>";
    }

    var title = loc ? (org + " - " + loc) : org;

    return "<!doctype html>\n" +
      "<html>\n<head>\n<meta charset='utf-8'/>" +
      "<meta name='viewport' content='width=device-width, initial-scale=1'/>" +
      "<title>" + esc(title) + " - Temperature Report</title>\n" +
      "<style>\n" +
      "body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif; margin:24px; color:#000;}\n" +
      "h1{margin:0 0 6px 0; font-size:22px;}\n" +
      ".sub{margin:0 0 18px 0; color:#333; font-size:13px;}\n" +
      "h2{margin:20px 0 8px 0; font-size:16px;}\n" +
      "table{width:100%; border-collapse:collapse; margin:0 0 14px 0; table-layout:fixed;}\n" +
      "th,td{border:1px solid #000; padding:8px 8px; vertical-align:top; font-size:12px; word-wrap:break-word;}\n" +
      "th{background:#f2f2f2; font-size:11px; text-transform:uppercase; letter-spacing:0.6px;}\n" +
      "@media print{body{margin:12mm;} h1{font-size:18px;} .sub{font-size:12px;} h2{page-break-after:avoid;} table{page-break-inside:avoid;}}\n" +
      "</style>\n</head>\n<body>\n" +
      "<h1>" + esc(title) + "</h1>\n" +
      "<p class='sub'>Temperature Report • " + esc(from) + " to " + esc(to) + "</p>\n" +
      tables +
      "<script>\n" +
      "window.addEventListener('load', function(){\n" +
      "  setTimeout(function(){ try{window.focus();}catch(e){} try{window.print();}catch(e){} }, 80);\n" +
      "});\n" +
      "window.addEventListener('afterprint', function(){\n" +
      "  setTimeout(function(){ try{window.close();}catch(e){} }, 250);\n" +
      "});\n" +
      "</script>\n" +
      "</body>\n</html>";
  }

function openPrintTabWithHtml(html) {
  // Open the printable report in a new tab/window (requires allow-popups on the embedding iframe).
  // This avoids calling print() from inside the sandboxed frame.

  var blob = new Blob([html], { type: "text/html" });
  var url = URL.createObjectURL(blob);

  // Try window.open first (best for preserving user-gesture context).
  var w = null;
  try {
    w = window.open(url, "_blank", "noopener");
  } catch (e) {
    w = null;
  }

  // Fallback to anchor-click method
  if (!w) {
    try {
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e2) {}
  }

  // Revoke blob later (don’t revoke immediately or the new tab may not finish loading).
  setTimeout(function () {
    try { URL.revokeObjectURL(url); } catch (e3) {}
  }, 60000);
}



  function renderReportPreviewDom(data) {
    var org = data.org_name || "";
    var loc = data.location_name || "";
    var from = data.from;
    var to = data.to;

    var devices = data.devices || [];
    var entries = data.entries || [];

    var mapByDate = {};
    for (var i = 0; i < entries.length; i++) {
      var e = entries[i];
      if (!mapByDate[e.entry_date]) mapByDate[e.entry_date] = {};
      mapByDate[e.entry_date][String(e.device_id)] = e;
    }

    var fromDt = parseYmd(from);
    var toDt = parseYmd(to);
    var days = [];

    if (fromDt && toDt) {
      var cur = new Date(fromDt.getFullYear(), fromDt.getMonth(), fromDt.getDate());
      var end = new Date(toDt.getFullYear(), toDt.getMonth(), toDt.getDate());
      while (cur <= end) {
        var ymd = cur.getFullYear() + "-" +
          String(cur.getMonth() + 1).padStart(2, "0") + "-" +
          String(cur.getDate()).padStart(2, "0");
        days.push(ymd);
        cur.setDate(cur.getDate() + 1);
      }
    }

    var byMonth = {};
    for (var j = 0; j < days.length; j++) {
      var y = days[j];
      var dt = parseYmd(y);
      var mk = dt ? monthKeyFromDate(dt) : y.slice(0, 7);
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(y);
    }

    var months = Object.keys(byMonth);

    var wrap = el("div", { class: "eikon-card" }, [
      el("div", { style: "font-weight:900;margin-bottom:6px;", text: "Temperature Report Preview" }),
      el("div", { class: "eikon-help", text: (org + (loc ? " • " + loc : "") + " • " + from + " to " + to) }),
      el("div", { style: "height:10px;" })
    ]);

    for (var mi = 0; mi < months.length; mi++) {
      var mk2 = months[mi];

      wrap.appendChild(el("div", { style: "height:10px;" }));
      wrap.appendChild(el("div", { class: "eikon-help", text: mk2 }));

      var tw = el("div", { class: "eikon-table-wrap" });
      var table = el("table", { class: "eikon-table" });

      var thead = el("thead");
      var trh = el("tr");
      trh.appendChild(el("th", { text: mk2 }));
      for (var di = 0; di < devices.length; di++) {
        trh.appendChild(el("th", { text: devices[di].name || "" }));
      }
      thead.appendChild(trh);
      table.appendChild(thead);

      var tbody = el("tbody");
      for (var d = 0; d < byMonth[mk2].length; d++) {
        var ymd2 = byMonth[mk2][d];
        var tr = el("tr");
        tr.appendChild(el("td", { text: ymd2 }));
        for (var di2 = 0; di2 < devices.length; di2++) {
          var dev = devices[di2];
          var ee = (mapByDate[ymd2] && mapByDate[ymd2][String(dev.id)]) ? mapByDate[ymd2][String(dev.id)] : null;
          var cell = ee ? (fmt1(ee.min_temp) + " / " + fmt1(ee.max_temp)) : "";
          tr.appendChild(el("td", { text: cell }));
        }
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);

      tw.appendChild(table);
      wrap.appendChild(tw);
    }

    return wrap;
  }

  // ------------------------------------------------------------
  // Module state (persists while UI stays loaded)
  // ------------------------------------------------------------
  var state = {
    tab: "entries",
    devices: [],
    entriesMonthCache: {},
    selectedDate: todayYmd(),
    lastReportData: null
  };

  // ------------------------------------------------------------
  // API helpers
  // ------------------------------------------------------------
  async function loadDevices(includeInactive) {
    var q = includeInactive ? "?include_inactive=1" : "";
    dbg("loadDevices includeInactive=", !!includeInactive);
    var r = await E.apiFetch("/temperature/devices" + q, { method: "GET" });
    state.devices = (r && r.devices) ? r.devices : [];
    dbg("devices loaded:", state.devices.length);
  }

  async function loadMonthEntries(month) {
    if (state.entriesMonthCache[month]) return state.entriesMonthCache[month];
    dbg("loadMonthEntries month=", month);
    var r = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(month), { method: "GET" });
    var entries = (r && r.entries) ? r.entries : [];
    state.entriesMonthCache[month] = entries;
    dbg("entries loaded:", entries.length);
    return entries;
  }

  function clearMonthCache(month) {
    delete state.entriesMonthCache[month];
  }

  // ------------------------------------------------------------
  // Render: Entries
  // ------------------------------------------------------------
  async function renderEntries(content) {
    content.innerHTML = "";
    await loadDevices(true);

    var activeDevices = state.devices.filter(function (d) { return d.active === 1; });

    var dateInput = el("input", { class: "eikon-input eikon-slim-input", type: "date", value: state.selectedDate });
    var reloadBtn = el("button", { class: "eikon-btn", text: "Load" });
    var syncBtn = el("button", { class: "eikon-btn", text: "Sync queued" });
    var printDashBtn = el("button", { class: "eikon-btn", text: "Print dashboard" });
    var saveBtn = el("button", { class: "eikon-btn primary", text: "Save" });

    var header = el("div", { class: "eikon-card" }, [
      el("div", { class: "eikon-row" }, [
        el("div", { class: "eikon-field" }, [
          el("div", { class: "eikon-label", text: "Date" }),
          dateInput
        ]),
        el("div", { class: "eikon-field", style: "margin-left:auto;" }, [
          el("div", { class: "eikon-label", text: "Actions" }),
          el("div", { class: "eikon-row", style: "gap:10px;" }, [reloadBtn, syncBtn, printDashBtn, saveBtn])
        ])
      ]),
      el("div", { style: "height:8px;" }),
      el("div", {
        class: "eikon-help",
        text:
          "Enter Min/Max for each active device. You can back-date any day. Deletes and confirms use Eikon modal (GoDaddy-safe)."
      })
    ]);

    var tableCard = el("div", { class: "eikon-card" });
    var tableWrap = el("div", { class: "eikon-table-wrap" });
    var table = el("table", { class: "eikon-table" });

    var thead = el("thead");
    var trh = el("tr");
    ["Device", "Type", "Min", "Max", "Status", "Notes", ""].forEach(function (h) {
      trh.appendChild(el("th", { text: h }));
    });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = el("tbody");
    table.appendChild(tbody);

    tableWrap.appendChild(table);
    tableCard.appendChild(tableWrap);

    // ------------------------------------------------------------
    // Monthly dashboard (this month + previous month)
    // ------------------------------------------------------------
    var dashCard = el("div", { class: "eikon-card" }, [
      el("div", { style: "font-weight:900;margin-bottom:6px;", text: "Monthly Dashboard" }),
      el("div", { class: "eikon-help", text: "Live trend lines for all devices in the selected month (and the month before). Thin line = Min, thick line = Max." }),
      el("div", { style: "height:10px;" })
    ]);

    var dashNow = el("div");
    var dashPrev = el("div");
    dashCard.appendChild(dashNow);
    dashCard.appendChild(el("div", { style: "height:12px;" }));
    dashCard.appendChild(dashPrev);

    content.appendChild(header);
    content.appendChild(el("div", { style: "height:12px;" }));
    content.appendChild(dashCard);
    content.appendChild(el("div", { style: "height:12px;" }));
    content.appendChild(tableCard);

    function currentMonth() {
      return ymdToMonth(state.selectedDate);
    }

    function devicesForMonthChart(monthEntries) {
      var ids = {};
      for (var i = 0; i < monthEntries.length; i++) {
        ids[String(monthEntries[i].device_id)] = 1;
      }

      var out = [];
      // Prefer devices that actually have data in the month.
      for (var di = 0; di < state.devices.length; di++) {
        var d = state.devices[di];
        if (ids[String(d.id)]) out.push(d);
      }

      // If nothing recorded yet, show active devices so the legend still matches the daily table.
      if (!out.length) {
        for (var dj = 0; dj < state.devices.length; dj++) {
          if (state.devices[dj].active === 1) out.push(state.devices[dj]);
        }
      }
      return out;
    }

    function renderChartSection(target, monthKey, monthEntries, highlightYmd) {
      target.innerHTML = "";

      var devs = devicesForMonthChart(monthEntries);

      var head = el("div", { class: "eikon-row", style: "align-items:flex-end;gap:10px;flex-wrap:wrap;" }, [
        el("div", { style: "font-weight:900;", text: monthKeyNice(monthKey) }),
        el("div", { class: "eikon-help", style: "margin-left:auto;", text: (monthEntries.length ? (monthEntries.length + " entries") : "No entries yet") })
      ]);

      var svg = buildMonthChartSvg({
        monthKey: monthKey,
        devices: devs,
        entries: monthEntries,
        highlightYmd: highlightYmd || "",
        mode: "dark",
        width: 1000,
        height: 260
      });

      var chartWrap = el("div", { class: "eikon-chart-wrap" }, [
        el("div", { html: svg })
      ]);

      var legend = el("div", { html: buildLegendHtml(devs, "dark") });

      target.appendChild(head);
      target.appendChild(el("div", { style: "height:8px;" }));
      target.appendChild(chartWrap);
      target.appendChild(legend);
    }

    async function refreshDashboard() {
      try {
        var mk = currentMonth();
        if (!mk) return;
        var pk = monthKeyAdd(mk, -1);

        dashNow.innerHTML = "<div class=\"eikon-help\">Loading chart…</div>";
        dashPrev.innerHTML = "<div class=\"eikon-help\">Loading chart…</div>";

        var nowEntries = await loadMonthEntries(mk);
        var prevEntries = pk ? await loadMonthEntries(pk) : [];

        renderChartSection(dashNow, mk, nowEntries, state.selectedDate);
        renderChartSection(dashPrev, pk, prevEntries, "");
      } catch (e) {
        dashNow.innerHTML = "<div class=\"eikon-help\">Dashboard failed to load.</div>";
        dashPrev.innerHTML = "";
      }
    }


    function buildRow(dev, existingEntry) {
      var ex = exampleTempsForDevice(dev);
      var minIn = el("input", { class: "eikon-input eikon-slim-input", type: "number", step: "0.1", placeholder: "e.g. " + ex.min });
      var maxIn = el("input", { class: "eikon-input eikon-slim-input", type: "number", step: "0.1", placeholder: "e.g. " + ex.max });
      var notesIn = el("input", { class: "eikon-input", type: "text", placeholder: "Optional notes" });

      if (existingEntry) {
        minIn.value = fmt1(existingEntry.min_temp);
        maxIn.value = fmt1(existingEntry.max_temp);
        notesIn.value = existingEntry.notes || "";
      }

      var dot = el("span", { class: "eikon-dot" });
      var statusLabel = el("span", { class: "eikon-mini", text: "" });
      var statusWrap = el("span", { class: "eikon-pill" }, [dot, el("span", { style: "width:6px;display:inline-block;" }), statusLabel]);

      function refreshStatus() {
        var minT = parseNum(minIn.value);
        var maxT = parseNum(maxIn.value);
        var st = statusDot(minT, maxT, effectiveMinLimit(dev), dev.max_limit);
        dot.className = "eikon-dot " + (st.cls || "");
        statusLabel.textContent = st.label;
      }

      minIn.addEventListener("input", refreshStatus);
      maxIn.addEventListener("input", refreshStatus);
      refreshStatus();

      var delBtn = el("button", { class: "eikon-btn danger", text: "Delete", disabled: !existingEntry });

      delBtn.addEventListener("click", async function () {
        if (!existingEntry) return;
        var ok = await modalConfirm(
          "Delete entry",
          "Delete temperature entry for " + (dev.name || "") + " on " + state.selectedDate + "?",
          "Delete",
          "Cancel"
        );
        if (!ok) return;

        try {
          await E.apiFetch("/temperature/entries/" + encodeURIComponent(String(existingEntry.id)), { method: "DELETE" });
          toast("Deleted", "Entry removed.", "good");
          clearMonthCache(currentMonth());
          await fillRows();
          await refreshDashboard();
        } catch (e) {
          toast("Delete failed", (e && (e.message || e.bodyText)) ? (e.message || e.bodyText) : "Error", "bad", 3200);
        }
      });

      var tr = el("tr");
      tr.appendChild(el("td", { text: dev.name || "" }));
      tr.appendChild(el("td", { text: dev.device_type || "" }));
      tr.appendChild(el("td", null, [minIn]));
      tr.appendChild(el("td", null, [maxIn]));
      tr.appendChild(el("td", null, [statusWrap]));
      tr.appendChild(el("td", null, [notesIn]));
      tr.appendChild(el("td", null, [delBtn]));

      return { tr: tr, dev: dev, minIn: minIn, maxIn: maxIn, notesIn: notesIn, existingEntry: existingEntry };
    }

    var rowObjs = [];

    async function fillRows() {
      tbody.innerHTML = "";

      var m = currentMonth();
      var monthEntries = await loadMonthEntries(m);
      var map = groupEntriesByDate(monthEntries);
      var dayEntries = map[state.selectedDate] || [];

      var byDeviceId = {};
      for (var i = 0; i < dayEntries.length; i++) {
        byDeviceId[String(dayEntries[i].device_id)] = dayEntries[i];
      }

      rowObjs = [];

      for (var di = 0; di < activeDevices.length; di++) {
        var dev = activeDevices[di];
        var ex = byDeviceId[String(dev.id)] || null;
        var r = buildRow(dev, ex);
        rowObjs.push(r);
      }

      if (rowObjs.length === 0) {
        var tr0 = el("tr");
        var td0 = el("td", { text: "No active devices. Go to Devices tab and add devices first." });
        td0.colSpan = 7;
        tr0.appendChild(td0);
        tbody.appendChild(tr0);
        saveBtn.disabled = true;
      } else {
        saveBtn.disabled = false;
        for (var ri = 0; ri < rowObjs.length; ri++) tbody.appendChild(rowObjs[ri].tr);
      }

      return rowObjs;
    }

    async function reloadForDate(newDate) {
      state.selectedDate = newDate;
      await fillRows();
      await refreshDashboard();
    }

    reloadBtn.addEventListener("click", async function () {
      try {
        var d = String(dateInput.value || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
          toast("Invalid date", "Pick a valid date.", "warn");
          return;
        }
        await reloadForDate(d);
      } catch (e) {
        toast("Load failed", e && e.message ? e.message : "Error", "bad");
      }
    });

    dateInput.addEventListener("change", async function () {
      try {
        var d = String(dateInput.value || "").trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return;
        await reloadForDate(d);
      } catch (e) {
        toast("Load failed", e && e.message ? e.message : "Error", "bad");
      }
    });

    syncBtn.addEventListener("click", async function () {
      try {
        syncBtn.disabled = true;
        syncBtn.textContent = "Syncing...";
        var r = await qFlush();
        toast("Sync", "Sent " + r.sent + ". Remaining " + r.remaining + ".", "good", 3200);
      } catch (e) {
        toast("Sync failed", e && e.message ? e.message : "Error", "bad", 3200);
      } finally {
        syncBtn.disabled = false;
        syncBtn.textContent = "Sync queued";
      }
    });

    printDashBtn.addEventListener("click", async function () {
      try {
        printDashBtn.disabled = true;
        printDashBtn.textContent = "Preparing...";

        var mk = currentMonth();
        if (!mk) {
          toast("Cannot print", "Invalid month.", "warn");
          return;
        }
        var pk = monthKeyAdd(mk, -1);

        var nowEntries = await loadMonthEntries(mk);
        var prevEntries = pk ? await loadMonthEntries(pk) : [];

        var nowDevs = devicesForMonthChart(nowEntries);
        var prevDevs = devicesForMonthChart(prevEntries);

        var html = buildDashboardPrintHtml({
          title: "Temperature Dashboard",
          monthKey: mk,
          prevMonthKey: pk,
          devices: state.devices,
          monthDevices: nowDevs,
          prevDevices: prevDevs,
          monthEntries: nowEntries,
          prevEntries: prevEntries,
          highlightYmd: state.selectedDate
        });

        openPrintTabWithHtml(html);
      } catch (e) {
        toast("Print failed", e && e.message ? e.message : "Error", "bad", 4200);
      } finally {
        printDashBtn.disabled = false;
        printDashBtn.textContent = "Print dashboard";
      }
    });

    saveBtn.addEventListener("click", async function () {
      var d = String(dateInput.value || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) {
        toast("Invalid date", "Pick a valid date.", "warn");
        return;
      }

      if (!rowObjs.length) {
        toast("Nothing to save", "No active devices found.", "warn");
        return;
      }

      // Validate + build jobs
      var jobs = [];
      for (var i = 0; i < rowObjs.length; i++) {
        var r = rowObjs[i];
        var minT = parseNum(r.minIn.value);
        var maxT = parseNum(r.maxIn.value);
        var notes = String(r.notesIn.value || "").trim();

        if (minT === null || maxT === null) {
          toast("Missing values", "Each active device needs Min and Max.", "warn", 3200);
          return;
        }

        jobs.push({
          device_id: r.dev.id,
          entry_date: d,
          min_temp: minT,
          max_temp: maxT,
          notes: notes
        });
      }

      saveBtn.disabled = true;
      saveBtn.textContent = "Saving...";

      var queued = 0;
      var saved = 0;

      try {
        for (var j = 0; j < jobs.length; j++) {
          var body = jobs[j];
          try {
            await E.apiFetch("/temperature/entries", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body)
            });
            saved++;
          } catch (e) {
            // queue on failure (offline / transient)
            qAdd({ path: "/temperature/entries", method: "POST", body: body });
            queued++;
          }
        }

        clearMonthCache(ymdToMonth(d));
        await fillRows();
        await refreshDashboard();

        if (queued > 0) {
          toast("Saved / Queued", "Saved: " + saved + ". Queued: " + queued + " (use Sync queued).", "warn", 4200);
        } else {
          toast("Saved", "Entries saved.", "good");
        }
      } catch (e) {
        toast("Save failed", e && e.message ? e.message : "Error", "bad", 4200);
      } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = "Save";
      }
    });

    // initial fill
    await fillRows();
    await refreshDashboard();
  }

  // ------------------------------------------------------------
  // Render: Devices
  // ------------------------------------------------------------
  async function renderDevices(content) {
    content.innerHTML = "";
    await loadDevices(true);

    var card = el("div", { class: "eikon-card" }, [
      el("div", { style: "font-weight:900;margin-bottom:6px;", text: "Devices (Rooms / Fridges)" }),
      el("div", {
        class: "eikon-help",
        text: "Create, rename, set limits, deactivate/reactivate. Active devices are required for a complete daily record. Rooms default to a minimum safety floor of 8.1°C when Min limit is left blank."
      }),
      el("div", { style: "height:12px;" })
    ]);

    var addName = el("input", { class: "eikon-input", placeholder: "Device name (e.g. Back Room / Vaccine Fridge)" });
    var addType = el("select", { class: "eikon-select" }, [
      el("option", { value: "room", text: "room" }),
      el("option", { value: "fridge", text: "fridge" }),
      el("option", { value: "other", text: "other" })
    ]);
    var addMin = el("input", { class: "eikon-input eikon-slim-input", type: "number", step: "0.1", placeholder: "Min limit (optional)" });
    var addMax = el("input", { class: "eikon-input eikon-slim-input", type: "number", step: "0.1", placeholder: "Max limit (optional)" });
    var addBtn = el("button", { class: "eikon-btn primary", text: "Add device" });

    card.appendChild(el("div", { class: "eikon-row" }, [
      el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Name" }), addName]),
      el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Type" }), addType]),
      el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Min limit" }), addMin]),
      el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "Max limit" }), addMax]),
      el("div", { class: "eikon-field", style: "margin-left:auto;" }, [el("div", { class: "eikon-label", text: " " }), addBtn])
    ]));

    var tableCard = el("div", { class: "eikon-card" });
    var tw = el("div", { class: "eikon-table-wrap" });
    var table = el("table", { class: "eikon-table" });

    var thead = el("thead");
    var trh = el("tr");
    ["Name", "Type", "Min", "Max", "Active", ""].forEach(function (h) { trh.appendChild(el("th", { text: h })); });
    thead.appendChild(trh);
    table.appendChild(thead);

    var tbody = el("tbody");
    table.appendChild(tbody);

    tw.appendChild(table);
    tableCard.appendChild(tw);

    content.appendChild(card);
    content.appendChild(el("div", { style: "height:12px;" }));
    content.appendChild(tableCard);

    function rowForDevice(d) {
      var name = el("input", { class: "eikon-input", value: d.name || "" });
      var type = el("select", { class: "eikon-select" }, [
        el("option", { value: "room", text: "room" }),
        el("option", { value: "fridge", text: "fridge" }),
        el("option", { value: "other", text: "other" })
      ]);
      type.value = d.device_type || "room";

      var min = el("input", { class: "eikon-input eikon-slim-input", type: "number", step: "0.1", value: (d.min_limit == null ? "" : fmt1(d.min_limit)) });
      var max = el("input", { class: "eikon-input eikon-slim-input", type: "number", step: "0.1", value: (d.max_limit == null ? "" : fmt1(d.max_limit)) });

      var activeText = el("span", { class: "eikon-help", text: (d.active === 1 ? "Yes" : "No") });

      var save = el("button", { class: "eikon-btn primary", text: "Save" });
      var toggle = el("button", {
        class: (d.active === 1 ? "eikon-btn danger" : "eikon-btn"),
        text: (d.active === 1 ? "Deactivate" : "Reactivate")
      });

      save.addEventListener("click", async function () {
        try {
          save.disabled = true;
          save.textContent = "Saving...";

          await E.apiFetch("/temperature/devices/" + encodeURIComponent(String(d.id)), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              name: String(name.value || "").trim(),
              device_type: String(type.value || "").trim(),
              min_limit: (String(min.value || "").trim() ? parseNum(min.value) : null),
              max_limit: (String(max.value || "").trim() ? parseNum(max.value) : null)
            })
          });

          toast("Saved", "Device updated.", "good");
          state.entriesMonthCache = {}; // safe reset: device changes affect entry UI assumptions
          await renderDevices(content);
        } catch (e) {
          toast("Save failed", e && e.message ? e.message : "Error", "bad", 4200);
        } finally {
          save.disabled = false;
          save.textContent = "Save";
        }
      });

      toggle.addEventListener("click", async function () {
        var wantActive = d.active !== 1;
        var ok = await modalConfirm(
          wantActive ? "Reactivate device" : "Deactivate device",
          wantActive ? "Reactivate this device?" : "Deactivate this device? (history kept)",
          wantActive ? "Reactivate" : "Deactivate",
          "Cancel"
        );
        if (!ok) return;

        try {
          toggle.disabled = true;
          toggle.textContent = "Updating...";

          await E.apiFetch("/temperature/devices/" + encodeURIComponent(String(d.id)), {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ active: wantActive })
          });

          toast("Updated", wantActive ? "Device reactivated." : "Device deactivated.", "good");
          state.entriesMonthCache = {};
          await renderDevices(content);
        } catch (e) {
          toast("Update failed", e && e.message ? e.message : "Error", "bad", 4200);
        } finally {
          toggle.disabled = false;
          toggle.textContent = (wantActive ? "Deactivate" : "Reactivate");
        }
      });

      var tr = el("tr");
      tr.appendChild(el("td", null, [name]));
      tr.appendChild(el("td", null, [type]));
      tr.appendChild(el("td", null, [min]));
      tr.appendChild(el("td", null, [max]));
      tr.appendChild(el("td", null, [activeText]));

      var btns = el("div", { style: "display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;" }, [save, toggle]);
      tr.appendChild(el("td", null, [btns]));

      return tr;
    }

    function refreshTable() {
      tbody.innerHTML = "";
      for (var i = 0; i < state.devices.length; i++) {
        tbody.appendChild(rowForDevice(state.devices[i]));
      }
    }

    refreshTable();

    addBtn.addEventListener("click", async function () {
      var name = String(addName.value || "").trim();
      if (!name) {
        toast("Missing", "Enter device name.", "warn");
        return;
      }

      addBtn.disabled = true;
      addBtn.textContent = "Adding...";

      try {
        await E.apiFetch("/temperature/devices", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name,
            device_type: String(addType.value || "room"),
            min_limit: (String(addMin.value || "").trim() ? parseNum(addMin.value) : null),
            max_limit: (String(addMax.value || "").trim() ? parseNum(addMax.value) : null)
          })
        });

        addName.value = "";
        addMin.value = "";
        addMax.value = "";

        toast("Added", "Device created.", "good");
        state.entriesMonthCache = {};
        await renderDevices(content);
      } catch (e) {
        toast("Add failed", e && e.message ? e.message : "Error", "bad", 4200);
      } finally {
        addBtn.disabled = false;
        addBtn.textContent = "Add device";
      }
    });
  }

  // ------------------------------------------------------------
  // Render: Report
  // ------------------------------------------------------------
  async function renderReport(content) {
    content.innerHTML = "";

    var card = el("div", { class: "eikon-card" }, [
      el("div", { style: "font-weight:900;margin-bottom:6px;", text: "Print Temperature Report" }),
      el("div", {
        class: "eikon-help",
        text: "Pick a date range. Months are separated into different tables. Print opens in a new tab and triggers print automatically."
      }),
      el("div", { style: "height:12px;" })
    ]);

    var from = el("input", { class: "eikon-input eikon-slim-input", type: "date", value: todayYmd() });
    var to = el("input", { class: "eikon-input eikon-slim-input", type: "date", value: todayYmd() });
    var gen = el("button", { class: "eikon-btn primary", text: "Generate" });
    var print = el("button", { class: "eikon-btn", text: "Print" });

    card.appendChild(el("div", { class: "eikon-row" }, [
      el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "From" }), from]),
      el("div", { class: "eikon-field" }, [el("div", { class: "eikon-label", text: "To" }), to]),
      el("div", { class: "eikon-field", style: "margin-left:auto;" }, [
        el("div", { class: "eikon-label", text: "Actions" }),
        el("div", { class: "eikon-row", style: "gap:10px;" }, [gen, print])
      ])
    ]));

    content.appendChild(card);
    content.appendChild(el("div", { style: "height:12px;" }));

    var reportWrap = el("div");
    content.appendChild(reportWrap);

    gen.addEventListener("click", async function () {
      var f = String(from.value || "").trim();
      var t = String(to.value || "").trim();
      if (!/^\d{4}-\d{2}-\d{2}$/.test(f) || !/^\d{4}-\d{2}-\d{2}$/.test(t)) {
        toast("Invalid", "Pick a valid date range.", "warn");
        return;
      }
      if (t < f) {
        toast("Invalid", "To must be >= From.", "warn");
        return;
      }

      gen.disabled = true;
      gen.textContent = "Loading...";
      reportWrap.innerHTML = "";

      try {
        var r = await E.apiFetch("/temperature/report?from=" + encodeURIComponent(f) + "&to=" + encodeURIComponent(t), { method: "GET" });
        if (!r || !r.ok) throw new Error("Report failed");
        state.lastReportData = r;
        reportWrap.appendChild(renderReportPreviewDom(r));
        toast("Report ready", "Preview generated.", "good");
      } catch (e) {
        toast("Report failed", e && e.message ? e.message : "Error", "bad", 4200);
      } finally {
        gen.disabled = false;
        gen.textContent = "Generate";
      }
    });

    print.addEventListener("click", function () {
      if (!state.lastReportData) {
        toast("Nothing to print", "Generate the report first.", "warn");
        return;
      }
      try {
        var html = buildPrintHtml(state.lastReportData);
        openPrintTabWithHtml(html);
      } catch (e) {
        toast("Print failed", e && e.message ? e.message : "Error", "bad", 4200);
      }
    });
  }

  // ------------------------------------------------------------
  // Main render (Tabs)
  // ------------------------------------------------------------
  async function render(ctx) {
    var mount = ctx.mount;
    mount.innerHTML = "";

    ensureToastStyles();

    // Tabs as buttons (uses existing CSS)
    var bar = el("div", { class: "eikon-card" });
    var row = el("div", { class: "eikon-row", style: "align-items:center;" });

    var btnEntries = el("button", { class: "eikon-btn", text: "Entries" });
    var btnDevices = el("button", { class: "eikon-btn", text: "Devices" });
    var btnReport = el("button", { class: "eikon-btn", text: "Print Report" });

    var right = el("div", { style: "margin-left:auto;display:flex;gap:10px;align-items:center;flex-wrap:wrap;" }, [
      el("span", { class: "eikon-help", text: "dbg=" + String(E.DEBUG || 0) })
    ]);

    row.appendChild(el("span", { class: "eikon-pill", style: "font-weight:900;", text: "🌡 Temperature" }));
    row.appendChild(btnEntries);
    row.appendChild(btnDevices);
    row.appendChild(btnReport);
    row.appendChild(right);

    bar.appendChild(row);

    var content = el("div");
    mount.appendChild(bar);
    mount.appendChild(el("div", { style: "height:12px;" }));
    mount.appendChild(content);

    function setActiveTab(name) {
      state.tab = name;
      btnEntries.classList.toggle("primary", name === "entries");
      btnDevices.classList.toggle("primary", name === "devices");
      btnReport.classList.toggle("primary", name === "report");
    }

    async function showTab(name) {
      setActiveTab(name);
      content.innerHTML = "<div class='eikon-help'>Loading…</div>";
      try {
        if (name === "entries") await renderEntries(content);
        else if (name === "devices") await renderDevices(content);
        else await renderReport(content);
      } catch (e) {
        err("tab render failed:", e);
        content.innerHTML =
          "<div class='eikon-card'>" +
          "<div style='font-weight:900;color:var(--danger);margin-bottom:8px;'>Temperature tab crashed</div>" +
          "<pre style='white-space:pre-wrap;margin:0;background:rgba(0,0,0,.25);padding:12px;border-radius:14px;border:1px solid var(--border);'>" +
          escHtml(String(e && (e.stack || e.message || e))) +
          "</pre></div>";
      }
    }

    btnEntries.addEventListener("click", function () { showTab("entries"); });
    btnDevices.addEventListener("click", function () { showTab("devices"); });
    btnReport.addEventListener("click", function () { showTab("report"); });

    // Start on last state.tab
    await showTab(state.tab || "entries");
  }

  // ------------------------------------------------------------
  // Register module into the new core
  // ------------------------------------------------------------
  E.registerModule({
    id: "temperature",
    title: "Temperature",
    order: 10,
    icon: "🌡",
    render: render
  });

})();
