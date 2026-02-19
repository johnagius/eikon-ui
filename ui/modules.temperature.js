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
      ".eikon-chart-wrap{width:100%;overflow:hidden;}" +
      ".eikon-chart{width:100%;min-width:0;display:block;}" +
      ".eikon-dash-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(360px,1fr));gap:12px;}" +
      ".eikon-dash-device{border:1px solid var(--border);background:rgba(255,255,255,.02);border-radius:16px;padding:12px;}" +
      ".eikon-dash-head{display:flex;gap:10px;align-items:flex-end;flex-wrap:wrap;margin-bottom:8px;}" +
      ".eikon-dash-name{font-weight:900;}" +
      ".eikon-dash-meta{font-size:12px;opacity:.8;}" +
      ".eikon-dash-sub{font-size:12px;opacity:.8;margin-top:2px;}" +
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
  // Core math + date helpers
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
    s = s.replace(/,/g, ".");
    var v = Number(s);
    if (!Number.isFinite(v)) return null;
    return Math.round(v * 10) / 10;
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

  // Default safety floor for room temperature (used when device has no explicit min_limit)
  var ROOM_DEFAULT_MIN_LIMIT = 8.1;

  function effectiveMinLimit(dev) {
    try {
      if (dev && Number.isFinite(Number(dev.min_limit))) return Number(dev.min_limit);
      if (dev && String(dev.device_type || "").toLowerCase() === "room") return ROOM_DEFAULT_MIN_LIMIT;
    } catch (e) {}
    return null;
  }

  function exampleTempsForDevice(dev) {
    var t = String((dev && dev.device_type) || "").toLowerCase();
    if (t === "room") return { min: "16.5", max: "23.3" };
    if (t === "fridge") return { min: "3.2", max: "7.8" };
    return { min: "10.0", max: "20.0" };
  }

  // ------------------------------------------------------------
  // Dashboard debug (console)
  // ------------------------------------------------------------
  var DASH_DBG_KEY = "eikon_temp_dash_debug";
  function dashDebugEnabled() {
    try {
      return !!E.DEBUG || window.localStorage.getItem(DASH_DBG_KEY) === "1";
    } catch (e) {
      return !!E.DEBUG;
    }
  }

  function dashDbg() {
    if (!dashDebugEnabled()) return;
    try {
      var args = ["[temp][dash]"].concat([].slice.call(arguments));
      // eslint-disable-next-line no-console
      console.log.apply(console, args);
    } catch (e) {}
  }

  // ------------------------------------------------------------
  // Dashboard chart helpers (SVG, per-device, print-safe)
  // ------------------------------------------------------------
  function numFromAny(v) {
    if (v === null || v === undefined) return null;
    if (typeof v === "number") return Number.isFinite(v) ? v : null;
    var s = String(v).trim();
    if (!s) return null;
    s = s.replace(/,/g, ".");
    var n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

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

  function svgEscape(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
    });
  }

  function limitsTextForDevice(dev) {
    var mn = numFromAny(effectiveMinLimit(dev));
    var mx = numFromAny(dev && dev.max_limit);
    if (mn === null && mx === null) return "No limits";
    if (mn !== null && mx !== null) return "Limits: " + fmt1(mn) + "–" + fmt1(mx) + "°C";
    if (mn !== null) return "Min limit: " + fmt1(mn) + "°C";
    return "Max limit: " + fmt1(mx) + "°C";
  }
  function normDeviceKey(s) {
    return String(s == null ? "" : s).trim().toLowerCase().replace(/\s+/g, " ");
  }

  function deviceKeyFromDevice(d) {
    return normDeviceKey(d && d.name) + "|" + String((d && d.device_type) || "").toLowerCase();
  }

  function deviceKeyFromEntry(e) {
    // entries returned by API include device_name/device_type; fall back to name/type if present
    return normDeviceKey(e && (e.device_name || e.name)) + "|" + String((e && (e.device_type || e.type)) || "").toLowerCase();
  }

  function mapEntriesToActiveDevices(activeDevices, entries) {
    var devs = Array.isArray(activeDevices) ? activeDevices : [];
    var arr = Array.isArray(entries) ? entries : [];

    var activeIdSet = {};
    var keyToId = {};
    for (var i = 0; i < devs.length; i++) {
      var d = devs[i];
      var id = String(d && d.id);
      activeIdSet[id] = 1;
      var k = deviceKeyFromDevice(d);
      // if two active devices share the same key, keep the first (rare)
      if (k && !keyToId[k]) keyToId[k] = id;
    }

    var byId = {};
    var remapped = 0;
    var ignored = 0;

    for (var j = 0; j < arr.length; j++) {
      var e = arr[j];
      var did = String(e && e.device_id);
      if (activeIdSet[did]) {
        if (!byId[did]) byId[did] = [];
        byId[did].push(e);
        continue;
      }
      var ek = deviceKeyFromEntry(e);
      var aid = ek ? keyToId[ek] : null;
      if (aid) {
        remapped++;
        if (!byId[aid]) byId[aid] = [];
        byId[aid].push(e);
      } else {
        ignored++;
      }
    }

    return { byId: byId, remapped: remapped, ignored: ignored, activeIdSet: activeIdSet, keyToId: keyToId };
  }



  function buildDeviceMonthChartSvg(opts) {
    opts = opts || {};
    var mk = String(opts.monthKey || "");
    var days = monthDaysFromKey(mk);
    var n = days.length;

    var W = Number(opts.width || 1000);
    var H = Number(opts.height || 220);

    var padL = 54, padR = 14, padT = 18, padB = 30;
    var plotW = Math.max(10, W - padL - padR);
    var plotH = Math.max(10, H - padT - padB);

    var mode = String(opts.mode || "dark");
    var dark = mode !== "print";
    var bg = dark ? "rgba(255,255,255,.02)" : "#fff";
    var grid = dark ? "rgba(255,255,255,.10)" : "#d0d0d0";
    var axis = dark ? "rgba(233,238,247,.85)" : "#000";
    var series = dark ? "rgba(233,238,247,.98)" : "#000";
    var muted = dark ? "rgba(233,238,247,.55)" : "#444";
    var hi = dark ? "rgba(255,255,255,.18)" : "#999";
    var lim = dark ? "rgba(233,238,247,.55)" : "#000";

    var dev = opts.device || {};
    var entries = Array.isArray(opts.entries) ? opts.entries : [];

    var dayIndex = {};
    for (var i = 0; i < n; i++) dayIndex[days[i]] = i;

    var mins = new Array(n);
    var maxs = new Array(n);
    for (var ii = 0; ii < n; ii++) { mins[ii] = null; maxs[ii] = null; }

    var minV = Infinity;
    var maxV = -Infinity;

    var mapped = 0;
    var skippedDate = 0;
    var minNumeric = 0;
    var maxNumeric = 0;

    for (var ei = 0; ei < entries.length; ei++) {
      var e = entries[ei];
      var ds = String(e.entry_date || "");
      if (ds.length >= 10) ds = ds.slice(0, 10);
      var idx = dayIndex[ds];
      if (idx === undefined) { skippedDate++; continue; }
      mapped++;

      var mn = numFromAny(e.min_temp);
      var mx = numFromAny(e.max_temp);

      if (mn !== null) {
        minNumeric++;
        mins[idx] = mn;
        if (mn < minV) minV = mn;
        if (mn > maxV) maxV = mn;
      }
      if (mx !== null) {
        maxNumeric++;
        maxs[idx] = mx;
        if (mx < minV) minV = mx;
        if (mx > maxV) maxV = mx;
      }
    }

    var minLimit = numFromAny(effectiveMinLimit(dev));
    var maxLimit = numFromAny(dev && dev.max_limit);

    if (minLimit !== null) {
      if (minLimit < minV) minV = minLimit;
      if (minLimit > maxV) maxV = minLimit;
    }
    if (maxLimit !== null) {
      if (maxLimit < minV) minV = maxLimit;
      if (maxLimit > maxV) maxV = maxLimit;
    }

    var noData = !(Number.isFinite(minV) && Number.isFinite(maxV));
    if (noData) {
      if (minLimit !== null || maxLimit !== null) {
        minV = (minLimit !== null ? minLimit : (maxLimit !== null ? maxLimit - 2 : 0));
        maxV = (maxLimit !== null ? maxLimit : (minLimit !== null ? minLimit + 2 : 10));
      } else {
        minV = 0; maxV = 10;
      }
    }

    var span = maxV - minV;
    if (!Number.isFinite(span) || span < 1) span = 1;
    minV = minV - span * 0.10;
    maxV = maxV + span * 0.10;

    if (opts.debug && entries.length) {
      dashDbg(
        "chart",
        mk,
        "dev#", String(dev && dev.id),
        (dev && dev.name) || "",
        "type=", (dev && dev.device_type) || "",
        "entries=", entries.length,
        "mapped=", mapped,
        "skippedDate=", skippedDate,
        "minNumeric=", minNumeric,
        "maxNumeric=", maxNumeric,
        "noData=", noData,
        "sample=", entries.slice(0, 2)
      );
      if (mapped === 0 && entries.length) {
        dashDbg("WARNING: 0 mapped entries for device; check entry_date format. First entry_date=", String(entries[0] && entries[0].entry_date));
      }
      if ((minNumeric + maxNumeric) === 0 && entries.length) {
        dashDbg("WARNING: 0 numeric temps for device; check min_temp/max_temp types. First entry min/max=", entries[0] && entries[0].min_temp, entries[0] && entries[0].max_temp);
      }
    }

    function xFor(i) {
      if (n <= 1) return padL;
      return padL + (i / (n - 1)) * plotW;
    }
    function yFor(v) {
      return padT + (maxV - v) * (plotH / (maxV - minV));
    }

    function pathFor(arr) {
      // Connect gaps (skip missing days but keep the line continuous between readings)
      var d = "";
      var started = false;
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!Number.isFinite(v)) continue;
        var x = xFor(i);
        var y = yFor(v);
        if (!started) { d += "M" + x.toFixed(2) + "," + y.toFixed(2); started = true; }
        else { d += " L" + x.toFixed(2) + "," + y.toFixed(2); }
      }
      return d;
    }

    function dotsFor(arr, r, opacity) {
      var s = "";
      for (var i = 0; i < arr.length; i++) {
        var v = arr[i];
        if (!Number.isFinite(v)) continue;
        s += "<circle cx='" + xFor(i).toFixed(2) + "' cy='" + yFor(v).toFixed(2) + "' r='" + r + "' fill='" + series + "' fill-opacity='" + opacity + "'/>";
      }
      return s;
    }


    function rangeBars(minArr, maxArr) {
      // Draw a vertical bar between min and max for days where both exist (gives a "line" even for single-day data)
      var s = "";
      var a = minArr || [];
      var b = maxArr || [];
      var n = Math.min(a.length, b.length);
      for (var i = 0; i < n; i++) {
        var mn = a[i];
        var mx = b[i];
        if (!Number.isFinite(mn) || !Number.isFinite(mx)) continue;
        var x = xFor(i);
        var y1 = yFor(mn);
        var y2 = yFor(mx);
        var top = Math.min(y1, y2);
        var bot = Math.max(y1, y2);
        s += "<line x1='" + x.toFixed(2) + "' y1='" + top.toFixed(2) + "' x2='" + x.toFixed(2) + "' y2='" + bot.toFixed(2) + "' stroke='" + series + "' stroke-opacity='" + (dark ? "0.60" : "0.55") + "' stroke-width='" + (dark ? "2.0" : "1.6") + "' stroke-linecap='round'/>";
      }
      return s;
    }

    var ticks = 5;
    var yTicks = [];
    for (var t = 0; t < ticks; t++) {
      var v2 = minV + (t / (ticks - 1)) * (maxV - minV);
      yTicks.push(v2);
    }

    var xLabs = [];
    if (n > 0) {
      var cand = [0, 7, 14, 21, n - 1];
      var seen = {};
      for (var ci = 0; ci < cand.length; ci++) {
        var idx2 = cand[ci];
        if (idx2 < 0 || idx2 >= n) continue;
        if (seen[idx2]) continue;
        seen[idx2] = 1;
        xLabs.push(idx2);
      }
    }

    var highlightIdx = null;
    var hy = String(opts.highlightYmd || "");
    if (hy && dayIndex[hy] !== undefined) highlightIdx = dayIndex[hy];

    var dMin = pathFor(mins);
    var dMax = pathFor(maxs);

    var out = "";
    out += "<svg class='eikon-chart' xmlns='http://www.w3.org/2000/svg' viewBox='0 0 " + W + " " + H + "' width='100%' height='" + H + "' role='img' aria-label='Temperature chart'>";
    out += "<rect x='0' y='0' width='" + W + "' height='" + H + "' fill='" + bg + "' rx='14' ry='14'/>";

    for (var yi = 0; yi < yTicks.length; yi++) {
      var vv = yTicks[yi];
      var y = yFor(vv);
      out += "<line x1='" + padL + "' y1='" + y.toFixed(2) + "' x2='" + (W - padR) + "' y2='" + y.toFixed(2) + "' stroke='" + grid + "' stroke-width='1'/>";
      out += "<text x='" + (padL - 8) + "' y='" + (y + 4).toFixed(2) + "' text-anchor='end' font-size='11' fill='" + axis + "'>" + svgEscape(fmt1(vv)) + "</text>";
    }

    out += "<line x1='" + padL + "' y1='" + (padT + plotH) + "' x2='" + (W - padR) + "' y2='" + (padT + plotH) + "' stroke='" + grid + "' stroke-width='1'/>";

    for (var xl = 0; xl < xLabs.length; xl++) {
      var idxx = xLabs[xl];
      var xx = xFor(idxx);
      out += "<text x='" + xx.toFixed(2) + "' y='" + (H - 12) + "' text-anchor='middle' font-size='11' fill='" + axis + "'>" + svgEscape(String(idxx + 1)) + "</text>";
    }

    if (highlightIdx !== null) {
      var hx = xFor(highlightIdx);
      out += "<line x1='" + hx.toFixed(2) + "' y1='" + padT + "' x2='" + hx.toFixed(2) + "' y2='" + (padT + plotH) + "' stroke='" + hi + "' stroke-width='2'/>";
    }

    if (minLimit !== null) {
      var yMinL = yFor(minLimit);
      out += "<line x1='" + padL + "' y1='" + yMinL.toFixed(2) + "' x2='" + (W - padR) + "' y2='" + yMinL.toFixed(2) + "' stroke='" + lim + "' stroke-width='1.5' stroke-dasharray='6 5'/>";
    }
    if (maxLimit !== null) {
      var yMaxL = yFor(maxLimit);
      out += "<line x1='" + padL + "' y1='" + yMaxL.toFixed(2) + "' x2='" + (W - padR) + "' y2='" + yMaxL.toFixed(2) + "' stroke='" + lim + "' stroke-width='1.5' stroke-dasharray='6 5'/>";
    }

    // Series (thin=min, thick=max) + dots to show isolated readings
    var showRangeBars = (minNumeric <= 1 && maxNumeric <= 1); // only show min↕max bar when there is a single reading (prevents "ladder" look)
    if (showRangeBars) out += rangeBars(mins, maxs);
    if (dMin) out += "<path d='" + dMin + "' fill='none' stroke='" + series + "' stroke-opacity='" + (dark ? "0.60" : "0.40") + "' stroke-width='1.3' stroke-linejoin='round' stroke-linecap='round'/>";
    if (dMax) out += "<path d='" + dMax + "' fill='none' stroke='" + series + "' stroke-opacity='" + (dark ? "0.98" : "0.92") + "' stroke-width='2.4' stroke-linejoin='round' stroke-linecap='round'/>";

    out += dotsFor(mins, 2.8, (dark ? "0.65" : "0.55"));
    out += dotsFor(maxs, 3.4, (dark ? "0.98" : "0.92"));

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
    if (pk === mk) pk = ""; // safety

    var devices = Array.isArray(opts.devices) ? opts.devices : [];
    var monthEntries = Array.isArray(opts.monthEntries) ? opts.monthEntries : [];
    var prevEntries = Array.isArray(opts.prevEntries) ? opts.prevEntries : [];

    function esc(s) {
      return String(s).replace(/[&<>'"]/g, function (c) {
        return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c];
      });
    }

    function groupByDevice(entries) {
      var map = {};
      var arr = Array.isArray(entries) ? entries : [];
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        var did = String(e.device_id);
        if (!map[did]) map[did] = [];
        map[did].push(e);
      }
      return map;
    }

    function sectionHtml(monthKey, entries, highlightYmd) {
      var mapped = mapEntriesToActiveDevices(devices, entries);
      var byDid = mapped.byId;
      var out = "";
      out += "<h2>" + esc(monthKeyNice(monthKey)) + "</h2>";
      out += "<div class='section-sub'>Devices: " + esc(String(devices.length)) + " • Entries: " + esc(String(entries.length)) + "</div>";
      for (var i = 0; i < devices.length; i++) {
        var d = devices[i];
        var eList = byDid[String(d.id)] || [];
        out += "<div class='devbox'>";
        out += "<div class='devhead'>";
        out += "<div class='dn'>" + esc(d.name || "") + "</div>";
        out += "<div class='dt'>" + esc((d.device_type || "") + " • " + limitsTextForDevice(d) + " • " + (eList.length ? (eList.length + " readings") : "No readings")) + "</div>";
        out += "</div>";
        out += buildDeviceMonthChartSvg({
          monthKey: monthKey,
          device: d,
          entries: eList,
          highlightYmd: highlightYmd || "",
          mode: "print",
          width: 1000,
          height: 220
        });
        out += "</div>";
      }
      return out;
    }

    var now = new Date();
    var printed = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-" + String(now.getDate()).padStart(2, "0");

    var body = "";
    body += sectionHtml(mk, monthEntries, opts.highlightYmd || "");
    if (pk) {
      body += "<div class='pagebreak'></div>";
      body += sectionHtml(pk, prevEntries, "");
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
      ".sub{margin:0 0 12px 0;font-size:12px;color:#111;}" +
      "h2{margin:16px 0 4px 0;font-size:14px;}" +
      ".section-sub{margin:0 0 10px 0;font-size:11px;color:#111;}" +
      ".devbox{border:1px solid #000;border-radius:10px;padding:10px;margin:0 0 12px 0;page-break-inside:avoid;}" +
      ".devhead{display:flex;flex-direction:column;gap:2px;margin:0 0 6px 0;}" +
      ".devhead .dn{font-weight:900;font-size:13px;}" +
      ".devhead .dt{font-size:11px;color:#111;}" +
      "svg{max-width:100%;height:auto;display:block;}" +
      ".pagebreak{break-before:page; page-break-before:always; height:0;}" +
      "@media print{h2{page-break-after:avoid;} .devbox{page-break-inside:avoid;}}" +
      "</style></head><body>" +
      "<div class='page'>" +
      "<h1>" + esc(title) + "</h1>" +
      "<p class='sub'>Printed: " + esc(printed) + " • Thin=min, Thick=max • Dashed lines = limits</p>" +
      body +
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

  // ------------------------------------------------------------
  // Print: open tab/window (FIX: avoid double-open in some browsers)
  // ------------------------------------------------------------
  var _lastPrintOpenAt = 0;

    function openPrintTabWithHtml(html) {
    // In sandboxed iframe environments (e.g. GoDaddy), window.open() can be unreliable:
    // - it may return null even when a tab opens (leading to duplicate fallbacks)
    // - navigating a pre-opened about:blank popup can be blocked by the sandbox
    // The most reliable method is a single anchor-click in the user gesture.

    var now = Date.now();

    // Cross-iframe lock (prevents double-open if the host accidentally embeds two iframes)
    var lkKey = "eikon_temp_print_lock_v1";
    try {
      var last = Number(window.localStorage.getItem(lkKey) || "0");
      if (now - last < 1400) {
        dbg("print suppressed (lock)");
        return;
      }
      window.localStorage.setItem(lkKey, String(now));
    } catch (e0) {}

    // Same-frame lock
    if (now - _lastPrintOpenAt < 900) {
      dbg("print suppressed (double call)");
      return;
    }
    _lastPrintOpenAt = now;

    var blob = new Blob([html], { type: "text/html" });
    var url = URL.createObjectURL(blob);

    try {
      var a = document.createElement("a");
      a.href = url;
      a.target = "_blank";
      a.rel = "noopener";
      a.style.display = "none";
      document.body.appendChild(a);
      a.click();
      a.remove();
    } catch (e1) {
      // Last resort
      try { window.open(url, "_blank"); } catch (e2) {}
    }

    setTimeout(function () {
      try { URL.revokeObjectURL(url); } catch (e3) {}
    }, 60000);
  }

  // ------------------------------------------------------------
  // Report preview dom (unchanged)
  // ------------------------------------------------------------
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
  // Module state
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
    if (dashDebugEnabled()) dashDbg("month entries loaded", month, "count=", entries.length, "sample=", entries.slice(0, 3));
    return entries;
  }

  function clearMonthCache(month) {
    delete state.entriesMonthCache[month];
  }

  // ------------------------------------------------------------
  // Render: Entries + Dashboard
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

    // Dashboard below entries (as requested)
    var dashCard = el("div", { class: "eikon-card" }, [
      el("div", { style: "font-weight:900;margin-bottom:6px;", text: "Monthly Dashboard" }),
      el("div", { class: "eikon-help", text: "Per-device charts for the selected month (and the month before). Thin=min • Thick=max • Dashed=limits." }),
      el("div", { style: "height:10px;" })
    ]);

    var dashNow = el("div");
    var dashPrev = el("div");
    dashCard.appendChild(dashNow);
    dashCard.appendChild(el("div", { style: "height:12px;" }));
    dashCard.appendChild(dashPrev);

    content.appendChild(header);
    content.appendChild(el("div", { style: "height:12px;" }));
    content.appendChild(tableCard);
    content.appendChild(el("div", { style: "height:12px;" }));
    content.appendChild(dashCard);

    function currentMonth() {
      return ymdToMonth(state.selectedDate);
    }

    function activeDevicesForDashboard() {
      var out = [];
      for (var i = 0; i < state.devices.length; i++) {
        var d = state.devices[i];
        if (d && d.active === 1) out.push(d);
      }
      return out;
    }

    function groupEntriesByDevice(entries) {
      var map = {};
      var arr = Array.isArray(entries) ? entries : [];
      for (var i = 0; i < arr.length; i++) {
        var e = arr[i];
        var did = String(e.device_id);
        if (!map[did]) map[did] = [];
        map[did].push(e);
      }
      return map;
    }

    function dashDebugSummary(monthKey, monthEntries) {
      if (!dashDebugEnabled()) return;
      var devs = activeDevicesForDashboard();
      var mapped = mapEntriesToActiveDevices(devs, monthEntries);
      var byDid = mapped.byId;
      if (dashDebugEnabled()) dbg("[dash] mapEntries", monthKey, "remapped=", mapped.remapped, "ignored=", mapped.ignored);
      var dayIndex = {};
      var days = monthDaysFromKey(monthKey);
      for (var i = 0; i < days.length; i++) dayIndex[days[i]] = i;

      var idsInEntries = Object.keys(byDid);
      var idsInDevices = devs.map(function (d) { return String(d.id); });

      var missing = [];
      for (var mi = 0; mi < idsInDevices.length; mi++) {
        if (!byDid[idsInDevices[mi]]) missing.push(idsInDevices[mi]);
      }

      var extra = [];
      for (var ei = 0; ei < idsInEntries.length; ei++) {
        if (idsInDevices.indexOf(idsInEntries[ei]) === -1) extra.push(idsInEntries[ei]);
      }

      dashDbg("SUMMARY", monthKey, "days=", days.length, "entries=", monthEntries.length, "activeDevices=", devs.length);
      if (monthEntries.length) dashDbg("entries sample", monthEntries.slice(0, 3));
      if (missing.length) dashDbg("active devices with ZERO entries this month:", missing);
      if (extra.length) dashDbg("entries include device_ids not in active list:", extra);

      for (var di = 0; di < devs.length; di++) {
        var d = devs[di];
        var list = byDid[String(d.id)] || [];
        var mapped = 0;
        var skippedDate = 0;
        var minNumeric = 0;
        var maxNumeric = 0;

        for (var jj = 0; jj < list.length; jj++) {
          var e = list[jj];
          var ds = String(e.entry_date || "");
          if (ds.length >= 10) ds = ds.slice(0, 10);
          if (dayIndex[ds] === undefined) skippedDate++;
          else mapped++;

          if (numFromAny(e.min_temp) !== null) minNumeric++;
          if (numFromAny(e.max_temp) !== null) maxNumeric++;
        }

        dashDbg(
          "device",
          "#" + String(d.id),
          d.name,
          "type=" + (d.device_type || ""),
          "entries=" + list.length,
          "mapped=" + mapped,
          "skippedDate=" + skippedDate,
          "minNumeric=" + minNumeric,
          "maxNumeric=" + maxNumeric,
          "sampleDates=" + list.slice(0, 3).map(function (x) { return String(x && x.entry_date); }).join(", ")
        );
      }
    }

    function renderMonthDeviceCharts(target, monthKey, monthEntries, highlightYmd) {
      target.innerHTML = "";

      var devs = activeDevicesForDashboard();
      var mapped = mapEntriesToActiveDevices(devs, monthEntries);
      var byDid = mapped.byId;
      if (dashDebugEnabled()) dbg("[dash] mapEntries", monthKey, "remapped=", mapped.remapped, "ignored=", mapped.ignored);

      var head = el("div", { class: "eikon-row", style: "align-items:flex-end;gap:10px;flex-wrap:wrap;" }, [
        el("div", { style: "font-weight:900;", text: monthKeyNice(monthKey) }),
        el("div", { class: "eikon-help", style: "margin-left:auto;", text: (monthEntries.length ? (monthEntries.length + " entries") : "No entries yet") })
      ]);

      target.appendChild(head);
      target.appendChild(el("div", { style: "height:10px;" }));

      if (!devs.length) {
        target.appendChild(el("div", { class: "eikon-help", text: "No active devices." }));
        return;
      }

      var grid = el("div", { class: "eikon-dash-grid" });

      // Chart height: make it visually fill the device card (no horizontal scroll, comfortable vertical size)
      var chartH = 280;
      try {
        var w = window.innerWidth || 0;
        if (w && w < 520) chartH = 220;
        else if (w && w < 900) chartH = 250;
      } catch (e) {}

      for (var i = 0; i < devs.length; i++) {
        var d = devs[i];
        var eList = byDid[String(d.id)] || [];

        var meta = limitsTextForDevice(d) + " • " + (eList.length ? (eList.length + " readings") : "No readings");

        var svg = buildDeviceMonthChartSvg({
          monthKey: monthKey,
          device: d,
          entries: eList,
          highlightYmd: highlightYmd || "",
          mode: "dark",
          width: 1000,
          height: chartH,
          debug: dashDebugEnabled()
        });

        var box = el("div", { class: "eikon-dash-device" }, [
          el("div", { class: "eikon-dash-head" }, [
            el("div", { class: "eikon-dash-name", text: (d.name || "") }),
            el("div", { class: "eikon-dash-meta", style: "margin-left:auto;", text: (d.device_type || "") })
          ]),
          el("div", { class: "eikon-dash-sub", text: meta }),
          el("div", { style: "height:8px;" }),
          el("div", { class: "eikon-chart-wrap", html: svg })
        ]);

        grid.appendChild(box);
      }

      target.appendChild(grid);
    }

    async function refreshDashboard() {
      try {
        var mk = currentMonth();
        if (!mk) return;
        var pk = monthKeyAdd(mk, -1);

        dashNow.innerHTML = "<div class=\"eikon-help\">Loading charts…</div>";
        dashPrev.innerHTML = "<div class=\"eikon-help\">Loading charts…</div>";

        var nowEntries = await loadMonthEntries(mk);
        var prevEntries = (pk && pk !== mk) ? await loadMonthEntries(pk) : [];

        if (dashDebugEnabled()) {
          dashDbg("refreshDashboard", "selectedDate=", state.selectedDate, "mk=", mk, "pk=", pk);
          dashDebugSummary(mk, nowEntries);
          if (pk && pk !== mk) dashDebugSummary(pk, prevEntries);
        }

        renderMonthDeviceCharts(dashNow, mk, nowEntries, state.selectedDate);
        if (pk && pk !== mk) renderMonthDeviceCharts(dashPrev, pk, prevEntries, "");
        else dashPrev.innerHTML = "";
      } catch (e) {
        dashNow.innerHTML = "<div class=\"eikon-help\">Dashboard failed to load.</div>";
        dashPrev.innerHTML = "";
        if (dashDebugEnabled()) dashDbg("refreshDashboard error", e && (e.stack || e.message || e));
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

    // Guard against accidental double-fire (some hosts embed multiple iframes / rapid taps)
    var _dashPrintInFlight = false;
    var _dashPrintAt = 0;

    printDashBtn.addEventListener("click", async function (ev) {
      if (ev && ev.preventDefault) ev.preventDefault();
      if (ev && ev.stopPropagation) ev.stopPropagation();

      var now = Date.now();
      if (_dashPrintInFlight || (now - _dashPrintAt < 1400)) {
        dbg("[dash] print click suppressed");
        return;
      }
      _dashPrintInFlight = true;
      _dashPrintAt = now;

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
        var prevEntries = (pk && pk !== mk) ? await loadMonthEntries(pk) : [];

        var devs = activeDevicesForDashboard();

        if (dashDebugEnabled()) {
          dbg("[dash] PRINT DASHBOARD mk=", mk, "pk=", pk, "devs=", devs.length, "nowEntries=", nowEntries.length, "prevEntries=", prevEntries.length);
        }

        var html = buildDashboardPrintHtml({
          title: "Temperature Dashboard",
          monthKey: mk,
          prevMonthKey: pk,
          devices: devs,
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
        _dashPrintInFlight = false;
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
        text: "Create, rename, set limits, deactivate/reactivate. Active devices are required for a complete daily record."
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
          state.entriesMonthCache = {};
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
