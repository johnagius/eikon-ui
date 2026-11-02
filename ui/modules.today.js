/* ============================================================
   EIKON — Today  (modules.today.js)
   The first screen of the reimagined UI, built on ONE request: GET /today.
   - Opens on what needs the pharmacy now, in the order it needs it
   - One button per row; the fridge is logged inline, nothing opens
   - Never says "Saved" before the server says so; says plainly when offline
   - The old dashboard stays one click away (#dashboard)
   Enabled as the opening screen with ?ui=2 (remembered) or #today any time.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var state = { data: null, loadedAt: null, error: "", timer: null, mount: null, busy: {}, search: "" };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function hm(d) { d = d || new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
  }
  function hue(name) { var h = 0; for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360; return h; }
  function dayWord(ymd) {
    if (!ymd) return "";
    var t = new Date(); var today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0");
    if (ymd === today) return "today";
    var d = new Date(ymd + "T12:00:00"); if (!isFinite(d.getTime())) return ymd;
    var diff = Math.round((d - new Date(today + "T12:00:00")) / 86400000);
    if (diff === 1) return "tomorrow"; if (diff === -1) return "yesterday";
    if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
    if (diff < 0) return Math.abs(diff) + " days ago";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function longDate(ymd) {
    var d = ymd ? new Date(ymd + "T12:00:00") : new Date();
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  // ---------- styles (scoped) ----------
  function injectCss() {
    if (document.getElementById("eikon-today-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-today-css";
    st.textContent =
      ".tdy{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:0 22px;align-content:start}" +
      ".tdy-search{grid-column:1;display:flex;align-items:center;gap:12px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:0 14px;height:50px}" +
      ".tdy-search input{flex:1;border:0;outline:0;background:transparent;color:var(--text);font-size:16px;min-width:0}" +
      ".tdy-search input::placeholder{color:var(--muted)}" +
      ".tdy-search .hint{font-size:11px;color:var(--muted);background:rgba(127,127,127,.12);padding:3px 8px;border-radius:6px;white-space:nowrap}" +
      ".tdy-date{grid-column:2;text-align:right;align-self:center}.tdy-date b{display:block;font-size:17px;font-weight:700;letter-spacing:-.01em}.tdy-date span{font-size:13px;color:var(--muted)}" +
      "@media (max-width:980px){.tdy-date{grid-column:1;text-align:left;margin-top:8px}}" +
      ".tdy-head{grid-column:1;margin:18px 0 4px}.tdy-head h1{font-size:26px;letter-spacing:-.025em;margin:0 0 6px;line-height:1.1;font-weight:800}.tdy-head h1 span{color:var(--muted);font-weight:500}" +
      ".tdy-legend{display:flex;gap:16px;font-size:12.5px;color:var(--muted);flex-wrap:wrap}.tdy-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}" +
      ".tdy-col{grid-column:1;min-width:0}.tdy-side{grid-column:2;grid-row:2/4;display:flex;flex-direction:column;gap:12px;margin-top:18px}" +
      ".tdy-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 0 7px;display:flex;align-items:center;gap:8px}.tdy-lab b{color:var(--text);font-size:11px}.tdy-lab a{margin-left:auto;color:var(--accent);font-weight:600;text-transform:none;letter-spacing:0;font-size:12.5px;cursor:pointer}" +
      ".tdy-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".tdy-row{display:flex;align-items:center;gap:12px;padding:11px 14px 11px 0;border-top:1px solid var(--border);border-left:3px solid transparent}.tdy-row:first-child{border-top:0}" +
      ".tdy-row.red{border-left-color:var(--danger)}.tdy-row.amb{border-left-color:#C98A12}.tdy-row.grn{border-left-color:var(--ok)}.tdy-row.blu{border-left-color:var(--accent)}" +
      ".tdy-av{width:36px;height:36px;border-radius:50%;flex:none;margin-left:12px;display:grid;place-items:center;font-weight:700;font-size:12.5px;color:#fff}.tdy-av.sq{border-radius:9px}.tdy-av.nt{background:rgba(120,120,128,.12);color:#3A3A3C;font-size:14px}.tdy-av.tm{background:rgba(10,143,106,.10);color:#0A7A5B}" +
      ".tdy-t{flex:1;min-width:0}.tdy-t b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tdy-t span{display:block;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tdy-t span.u{color:var(--danger)}" +
      ".tdy-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap}.tdy-pill.red{background:rgba(191,59,46,.14);color:var(--danger)}.tdy-pill.amb{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.tdy-pill.grn{background:rgba(28,138,91,.16);color:var(--ok)}.tdy-pill.blu{background:rgba(10,143,106,.14);color:var(--accent)}.tdy-pill.gry{background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".tdy-btn{font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--panel);white-space:nowrap;color:var(--text);cursor:pointer}.tdy-btn:disabled{opacity:.55;cursor:default}" +
      ".tdy-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.tdy-btn.g{background:var(--ok);border-color:var(--ok);color:#fff}" +
      ".tdy-inl{display:flex;align-items:center;gap:6px}.tdy-inl input{width:62px;height:32px;border:1px solid var(--border);border-radius:8px;background:var(--bg);padding:0 8px;color:var(--text);font-size:13px;font-variant-numeric:tabular-nums}.tdy-inl input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--shadow,rgba(10,143,106,.18))}.tdy-inl small{font-size:11px;color:var(--muted)}" +
      ".tdy-tile{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 16px}.tdy-tile .tdy-lab{margin:0 0 8px}.tdy-tile .big{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}.tdy-tile .big span{font-size:14px;font-weight:600;color:var(--muted);letter-spacing:0;margin-left:6px}.tdy-tile p{margin:6px 0 0;font-size:12.5px;color:var(--muted);line-height:1.45}.tdy-tile p b{color:var(--text);font-weight:600}.tdy-tile .tdy-btn{margin-top:10px}" +
      ".tdy-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.tdy-chips i{font-style:normal;height:26px;padding:0 10px;border-radius:6px;background:rgba(127,127,127,.12);display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;color:var(--muted)}.tdy-chips i.on{background:rgba(28,138,91,.16);color:var(--ok)}" +
      ".tdy-foot{grid-column:1/-1;display:flex;gap:16px;align-items:center;font-size:12.5px;color:var(--muted);margin-top:18px;padding-top:10px;border-top:1px solid var(--border)}.tdy-foot a{color:var(--accent);cursor:pointer;font-weight:600}.tdy-foot .right{margin-left:auto}" +
      ".tdy-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:22px;color:var(--muted);font-size:14px}" +
      ".tdy-off{background:rgba(201,138,18,.14);border:1px solid rgba(201,138,18,.35);color:var(--warn,#A06A0E);border-radius:10px;padding:8px 12px;font-size:13px;margin-bottom:10px;grid-column:1/-1}" +
      ".tdy-sr{position:absolute;left:-9999px}" +
      "@media (max-width:980px){.tdy{grid-template-columns:minmax(0,1fr)}.tdy-side{grid-column:1;grid-row:auto}.tdy-date{grid-column:1;grid-row:auto}}" +
      "@media (max-width:600px){.tdy{padding:0 16px}.tdy-date{order:-1;margin:0 0 10px}.tdy-head h1{font-size:28px}.tdy-search .hint{display:none}.tdy-row{flex-wrap:wrap;row-gap:8px}.tdy-t{flex:1 1 calc(100% - 90px)}.tdy-t+*{margin-left:60px}.tdy-row>.tdy-btn{margin-left:auto}.tdy-inl{flex:1 1 0;min-width:0}.tdy-inl:empty{display:none}.tdy-inl input{flex:1 1 0;width:0;min-width:0}}";
    document.head.appendChild(st);
  }

  // ---------- data ----------
  async function load(opts) {
    opts = opts || {};
    try {
      var pre = E._todayPrefetch; E._todayPrefetch = null; // started by core during sign-in, used once
      var r = (pre && Date.now() - pre.at < 20000) ? await pre.p : null;
      if (!r || !r.ok) r = await E.apiFetch("/today", { method: "GET", timeoutMs: 12000 });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load Today");
      state.data = r; state.loadedAt = new Date(); state.error = "";
    } catch (e) {
      state.error = (e && e.network) ? "Can't reach the server." : String(e && (e.message || e) || "Could not load Today");
      if (!state.data && e && e.status === 401) return; // core shows sign-in
    }
    if (!opts.silent || true) render();
  }

  // ---------- actions ----------
  async function logTemperature(row, rowEl) {
    var minEl = rowEl.querySelector("[data-min]"), maxEl = rowEl.querySelector("[data-max]");
    // Some keyboards type a decimal comma ("3,4"): read it as 3.4.
    var minS = (minEl.value || "").trim().replace(",", "."), maxS = (maxEl.value || "").trim().replace(",", ".");
    var name = row.title.replace(/ · reading$/, "");
    if (!minS || !maxS) return E.toast("Enter both min and max for " + name + ". Nothing was saved.", "warn");
    var minV = Number(minS), maxV = Number(maxS);
    if (!isFinite(minV) || !isFinite(maxV)) return E.toast("Min and max must be numbers. Nothing was saved.", "warn");
    minV = Math.round(minV * 10) / 10; maxV = Math.round(maxV * 10) / 10; // one decimal, as the Temperature register stores it
    if (minV > maxV) return E.toast("Min is greater than max for " + name + ". Nothing was saved.", "warn");
    if (minV < -40 || maxV > 60) return E.toast("That reading is outside -40 to 60 °C. Nothing was saved.", "warn");
    var key = "temp" + row.device_id;
    if (state.busy[key]) return;
    state.busy[key] = true; setRowBusy(rowEl, true);
    try {
      var body = Object.assign({}, row.action.body, { min_temp: minV, max_temp: maxV, notes: "" });
      var r = await E.apiFetch(row.action.path, { method: row.action.method, body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      var out = (row.limits && ((row.limits.min != null && minV < row.limits.min) || (row.limits.max != null && maxV > row.limits.max)));
      E.toast(name + " logged " + minV + " to " + maxV + " °C · " + hm() + (out ? " · outside the limits, add a note in the register" : ""), out ? "warn" : "success");
      await load({ silent: true });
    } catch (e) {
      E.toast("Not saved: " + String(e && (e.message || e) || "error"), "error");
    } finally { state.busy[key] = false; }
  }

  async function markCleaning(row, rowEl) {
    var key = "clean";
    if (state.busy[key]) return;
    var user = E.state.user || {};
    var who = rowEl.querySelector("[data-cleaner]") ? (rowEl.querySelector("[data-cleaner]").value || "").trim() : "";
    if (!who) { // first click reveals the one field we need
      var inl = rowEl.querySelector(".tdy-inl");
      if (inl && !inl.querySelector("[data-cleaner]")) {
        inl.innerHTML = '<small>cleaned by</small><input data-cleaner placeholder="Name" style="width:120px" aria-label="Cleaned by">';
        inl.querySelector("[data-cleaner]").focus();
        return;
      }
      return E.toast("Who did the cleaning? Type the name, then press Done.", "warn");
    }
    state.busy[key] = true; setRowBusy(rowEl, true);
    try {
      var d = new Date();
      var body = Object.assign({}, row.action.body, { time_in: hm(d), time_out: "", cleaner_name: who, staff_name: user.full_name || "", notes: "" });
      var r = await E.apiFetch(row.action.path, { method: row.action.method, body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      E.toast("Cleaning recorded · " + hm() + " · " + who, "success");
      await load({ silent: true });
    } catch (e) {
      E.toast("Not saved: " + String(e && (e.message || e) || "error"), "error");
    } finally { state.busy[key] = false; }
  }

  function setRowBusy(rowEl, busy) {
    rowEl.querySelectorAll("button,input").forEach(function (el) { el.disabled = !!busy; });
  }
  function openPath(path) { if (path && path[0] === "#") window.location.hash = path; }

  // ---------- render ----------
  function rowTemp(r) {
    var done = r.status === "done";
    var cls = done ? (r.out_of_range ? "red" : "grn") : "amb";
    var pill = done ? (r.out_of_range ? '<span class="tdy-pill red">Outside limits</span>' : '<span class="tdy-pill grn">Logged ' + esc(r.today.min) + " to " + esc(r.today.max) + "</span>") : "";
    var inl = done ? "" :
      '<div class="tdy-inl"><small>min</small><input data-min inputmode="decimal" aria-label="Minimum temperature"><small>max</small><input data-max inputmode="decimal" aria-label="Maximum temperature"></div>' +
      '<button class="tdy-btn p" data-act="temp">Log</button>';
    return '<div class="tdy-row ' + cls + '" data-kind="temperature" data-device="' + esc(r.device_id) + '">' +
      '<div class="tdy-av sq nt">' + (r.limits && r.limits.max != null && r.limits.max <= 10 ? "❄" : "°") + '</div>' +
      '<div class="tdy-t"><b>' + esc(r.title) + '</b><span>' + esc(r.sub) + '</span></div>' + pill + inl + '</div>';
  }
  function rowDaily(r) {
    var done = r.status === "done";
    return '<div class="tdy-row ' + (done ? "grn" : "amb") + '" data-kind="daily_register">' +
      '<div class="tdy-av sq nt" style="font-size:12.5px">Rx</div>' +
      '<div class="tdy-t"><b>Daily register</b><span>' + esc(r.sub) + '</span></div>' +
      (done ? '<span class="tdy-pill grn">Done</span>' : '<span class="tdy-pill amb">No entry yet</span>') +
      '<button class="tdy-btn" data-open="' + esc(r.action.path) + '">Open</button></div>';
  }
  function rowClean(r) {
    var cls = r.status === "done" ? "grn" : r.status === "overdue" ? "red" : "amb";
    var pill = r.status === "done" ? '<span class="tdy-pill grn">Done today</span>' : r.status === "overdue" ? '<span class="tdy-pill red">Overdue</span>' : '<span class="tdy-pill gry">Due weekly</span>';
    var sub = r.status === "overdue" ? '<span class="u">' + esc(r.sub) + " · due weekly</span>" : "<span>" + esc(r.sub) + "</span>";
    return '<div class="tdy-row ' + cls + '" data-kind="cleaning">' +
      '<div class="tdy-av sq nt">✓</div>' +
      '<div class="tdy-t"><b>Cleaning · dispensary and fridge</b>' + sub + '</div>' + pill +
      (r.status === "done" ? "" : '<div class="tdy-inl"></div><button class="tdy-btn" data-act="clean">Done now</button>') + '</div>';
  }
  function rowCustomer(c) {
    if (c.kind === "order") {
      var due = c.due_today ? '<span class="tdy-pill amb">Needed ' + esc(dayWord(c.needed_by)) + '</span>' : (c.needed_by ? '<span class="tdy-pill gry">Needed ' + esc(dayWord(c.needed_by)) + '</span>' : "");
      return '<div class="tdy-row ' + (c.due_today ? "amb" : "blu") + '">' +
        '<div class="tdy-av" style="background:hsl(' + hue(c.name) + ',45%,42%)">' + esc(initials(c.name)) + '</div>' +
        '<div class="tdy-t"><b>' + esc(c.name) + '</b><span>Order · ' + esc(c.detail || "") + (c.code ? " · " + esc(c.code) : "") + (c.waiting_days > 0 ? " · " + plural(c.waiting_days, "day") + " ago" : " · today") + '</span></div>' +
        due + '<button class="tdy-btn" data-open="' + esc(c.action.path) + '">Open</button></div>';
    }
    if (c.kind === "delivery") { // sent by servers from 2026-11-02-bookings-12; older ones simply do not list deliveries
      var dp = c.late_days > 0 ? '<span class="tdy-pill red">Was due ' + esc(dayWord(c.due_date)) + '</span>' : c.status === "Out for Delivery" ? '<span class="tdy-pill grn">On its way</span>' : '<span class="tdy-pill amb">Goes out today</span>';
      return '<div class="tdy-row ' + (c.late_days > 0 ? "red" : "amb") + '">' +
        '<div class="tdy-av" style="background:hsl(' + hue(c.name) + ',45%,42%)">' + esc(initials(c.name)) + '</div>' +
        '<div class="tdy-t"><b>' + esc(c.name) + '</b><span>Delivery · ' + esc(c.detail || "") + (c.slot ? " · " + esc(c.slot) : "") + (c.cold ? " · Fridge" : "") + (c.controlled ? " · Controlled drug" : "") + '</span></div>' +
        dp + '<button class="tdy-btn" data-open="' + esc(c.action.path) + '">Open</button></div>';
    }
    return '<div class="tdy-row blu">' +
      '<div class="tdy-av" style="background:hsl(' + hue(c.name) + ',45%,42%)">' + esc(initials(c.name)) + '</div>' +
      '<div class="tdy-t"><b>' + esc(c.name) + '</b><span>Asked ' + (c.waiting_days > 0 ? plural(c.waiting_days, "day") + " ago" : "today") + ' · "' + esc(c.detail || "") + '"</span></div>' +
      '<span class="tdy-pill blu">' + (c.waiting_days > 0 ? "Waiting " + plural(c.waiting_days, "day") : "New") + '</span>' +
      '<button class="tdy-btn" data-open="' + esc(c.action.path) + '">Reply</button></div>';
  }

  function render() {
    if (E.state.activeModuleId !== "today") return; // left before a reply came back: do not draw over the next screen
    var m = state.mount; if (!m) return;
    injectCss();
    var d = state.data;
    var user = E.state.user || {};
    var html = '<div class="tdy">';
    if (state.error) html += '<div class="tdy-off">' + esc(state.error) + (state.loadedAt ? " Showing what we had at " + hm(state.loadedAt) + "." : " Nothing to show yet.") + '</div>';
    html += '<label class="tdy-search"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="color:rgba(60,60,67,.55);flex:none;display:block"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span><input id="tdy-q" type="search" placeholder="What do you need? A customer, a product, a register…" autocomplete="off" value="' + esc(state.search) + '"><span class="hint">Enter opens it</span></label>';
    html += '<div class="tdy-date"><b>' + esc(longDate(d && d.date)) + '</b><span>' + esc(d && d.time ? d.time : hm()) + (user.location_name ? " · " + esc(user.location_name) : "") + '</span></div>';

    if (!d) {
      html += '<div class="tdy-head"><h1>Loading…</h1></div></div>';
      m.innerHTML = html; bind(); return;
    }

    var before = d.before_opening || [], waiting = d.customers_waiting || [], attention = d.attention || [];
    var nBefore = d.counts.before_opening, nWait = waiting.length;
    var h1;
    var hr = parseInt(String(d.time || hm()).split(":")[0], 10); if (isNaN(hr)) hr = new Date().getHours();
    var part = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
    if (nBefore === 0 && nWait === 0) h1 = "A quiet " + part + ". <span>" + (hr < 12 ? "Nothing needs you yet." : "Everything is done.") + "</span>";
    else if (nBefore === 0) h1 = plural(nWait, "customer") + " waiting. <span>The registers are done.</span>";
    else h1 = (hr < 12 ? plural(nBefore, "thing") + " before the doors open" : plural(nBefore, "check") + " still to do today") + (nWait ? "<span>, " + plural(nWait, "customer") + " waiting.</span>" : "<span>.</span>");
    var leg = [];
    var overdue = before.filter(function (x) { return x.status === "overdue"; }).length;
    var todo = before.filter(function (x) { return x.status === "todo"; }).length;
    if (overdue) leg.push('<span><i style="background:var(--danger)"></i>' + plural(overdue, "register") + " overdue</span>");
    if (todo) leg.push('<span><i style="background:#C98A12"></i>' + todo + " to fill</span>");
    var ready = waiting.filter(function (x) { return x.kind === "order"; }).length, qs = waiting.filter(function (x) { return x.kind === "question"; }).length;
    if (ready) leg.push('<span><i style="background:var(--ok)"></i>' + plural(ready, "order") + " to hand over</span>");
    if (qs) leg.push('<span><i style="background:var(--accent)"></i>' + plural(qs, "question") + "</span>");
    var dl = waiting.filter(function (x) { return x.kind === "delivery"; }).length;
    if (dl) leg.push('<span><i style="background:var(--warn,#C98A12)"></i>' + plural(dl, "delivery", "deliveries") + " to go out</span>");
    html += '<div class="tdy-head"><h1>' + h1 + '</h1><div class="tdy-legend">' + leg.join("") + '</div></div>';

    html += '<div class="tdy-col">';
    html += '<div class="tdy-lab">Before opening <b>' + nBefore + '</b></div>';
    var orderKind = { temperature: 0, daily_register: 1, cleaning: 2 };
    var sorted = before.slice().sort(function (a, b) {
      var sa = a.status === "overdue" ? 0 : a.status === "todo" ? 1 : a.status === "ok" ? 2 : 3;
      var sb = b.status === "overdue" ? 0 : b.status === "todo" ? 1 : b.status === "ok" ? 2 : 3;
      return sa - sb || (orderKind[a.kind] - orderKind[b.kind]);
    });
    html += '<div class="tdy-list">' + sorted.map(function (r) {
      if (r.kind === "temperature") return rowTemp(r);
      if (r.kind === "daily_register") return rowDaily(r);
      if (r.kind === "cleaning") return rowClean(r);
      return "";
    }).join("") + '</div>';

    html += '<div class="tdy-lab">Customers waiting <b>' + nWait + '</b><a data-open="#clientorders">All orders ›</a></div>';
    html += waiting.length ? '<div class="tdy-list">' + waiting.map(rowCustomer).join("") + '</div>' : '<div class="tdy-quiet">No one is waiting. New orders and questions appear here the moment they are recorded.</div>';
    // Bookings today (only when the pharmacy uses Bookings): the next few, one tap to the day.
    var bk = d.bookings;
    if (bk && bk.total_today > 0) {
      html += '<div class="tdy-lab">Bookings today <b>' + bk.total_today + '</b><a data-open="#bookings">All bookings ›</a></div>';
      html += bk.next.length ? '<div class="tdy-list">' + bk.next.map(function (b) {
        var here = b.status === "arrived";
        return '<div class="tdy-row ' + (here ? "grn" : "blu") + '">' +
          '<div class="tdy-av sq tm" style="width:50px;font-size:12px;font-variant-numeric:tabular-nums">' + esc(b.start) + '</div>' +
          '<div class="tdy-t"><b>' + esc(b.name) + '</b><span>' + esc(b.service) + (b.provider ? " · " + esc(b.provider) : "") + " · until " + esc(b.end) + '</span></div>' +
          (here ? '<span class="tdy-pill grn">Here</span>' : "") + '<button class="tdy-btn" data-open="#bookings">Open</button></div>';
      }).join("") + '</div>' : '<div class="tdy-quiet">All of today\'s bookings are done.</div>';
    }
    html += '</div>';

    // side tiles
    var t = d.takings || {}, st = d.stock || {}, tm = d.team || {};
    html += '<div class="tdy-side">';
    html += '<div class="tdy-tile"><div class="tdy-lab">Takings</div><div class="big">€' + esc((t.paid_out_today || 0).toFixed(2)) + '<span>paid out today</span></div>' +
      '<p>' + (t.end_of_day_locked ? "<b>Day closed.</b>" : t.end_of_day_saved ? "<b>End of day started</b>, not yet closed." : "One button closes the day at closing time.") + '</p>' +
      '<button class="tdy-btn ' + (t.end_of_day_locked ? "" : "p") + '" data-open="' + esc(t.action ? t.action.path : "#endofday") + '">' + esc(t.action ? t.action.label : "Close the day") + '</button></div>';

    var att = attention.map(function (a) {
      if (a.kind === "certificate") return "<b>" + esc(a.title) + "</b> " + (a.status === "expired" ? "expired " + plural(a.days, "day") + " ago" : "due in " + plural(a.days, "day"));
      if (a.kind === "alert") return "<b>" + esc(a.title) + "</b> " + esc(a.alert_type) + ", " + plural(a.steps_left, "step") + " left";
      if (a.kind === "returns") return "<b>" + esc(a.title) + "</b>";
      if (a.kind === "near_expiry") return "<b>" + esc(a.first) + "</b> " + (a.expired_count ? "expired" : "expires " + esc(dayWord(a.first_expiry))) + (a.expired_count + a.due30_count > 1 ? " and " + (a.expired_count + a.due30_count - 1) + " more" : "");
      return "";
    }).filter(Boolean);
    html += '<div class="tdy-tile"><div class="tdy-lab">Needs attention</div><div class="big">' + attention.length + '<span>' + (attention.length === 1 ? "item" : "items") + '</span></div>' +
      (att.length ? '<p>' + att.slice(0, 3).join("<br>") + '</p>' : '<p>Certificates, recalls, returns and expiry dates are all in order.</p>') +
      (st.supplier_orders_pending || st.supplier_orders_shipped ? '<p>' + (st.supplier_orders_shipped ? "<b>" + plural(st.supplier_orders_shipped, "supplier order") + "</b> on the way. " : "") + (st.supplier_orders_pending ? plural(st.supplier_orders_pending, "order") + " waiting for the supplier." : "") + '</p>' : "") +
      (attention.length ? '<button class="tdy-btn" data-open="' + esc(attention[0].action.path) + '">Open</button>' : "") + '</div>';

    var on = (tm.on_today || []);
    html += '<div class="tdy-tile"><div class="tdy-lab">Team today</div>' +
      (on.length ? '<div class="tdy-chips">' + on.map(function (p) { return '<i class="on" title="' + esc(p.role || "") + '">' + esc(p.name) + " " + esc(p.from) + "–" + esc(p.to) + "</i>"; }).join("") + '</div>' : '<p>No shifts recorded for today.</p>') +
      ((tm.handover_incoming || []).length ? '<p>Handover from yesterday:<br>' + tm.handover_incoming.slice(0, 3).map(function (h) { return "<b>" + esc(h.text || h.msg || h) + "</b>"; }).join("<br>") + '</p>' : "") +
      (tm.notes_today ? '<p>Today: <b>' + esc(tm.notes_today) + '</b></p>' : "") +
      '<button class="tdy-btn" data-open="#instructions">Handover</button></div>';
    html += '</div>';

    if (E.setRailBadge) { try { E.setRailBadge("today", before.filter(function (r) { return r.status === "todo" || r.status === "overdue"; }).length); E.setRailBadge("customers", nWait); E.setRailBadge("stock", attention.filter(function (a) { return a.kind === "near_expiry" || a.kind === "returns" || a.kind === "alert"; }).length); } catch (eB) {} }
    html += '<div class="tdy-foot"><span>Updated ' + esc(state.loadedAt ? hm(state.loadedAt) : "–") + ' · refreshes every minute</span><a class="right" data-open="#dashboard">Old dashboard ›</a></div>';
    html += '</div>';
    m.innerHTML = html;
    bind();
  }

  function bind() {
    var m = state.mount; if (!m) return;
    m.querySelectorAll("[data-open]").forEach(function (el) {
      el.addEventListener("click", function () { openPath(el.getAttribute("data-open")); });
    });
    m.querySelectorAll('[data-act="temp"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rowEl = btn.closest(".tdy-row");
        var id = String(rowEl.getAttribute("data-device"));
        var row = (state.data.before_opening || []).find(function (r) { return r.kind === "temperature" && String(r.device_id) === id; });
        if (row) logTemperature(row, rowEl);
      });
    });
    m.querySelectorAll(".tdy-row[data-kind=temperature] input").forEach(function (inp) {
      inp.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { var b = inp.closest(".tdy-row").querySelector('[data-act="temp"]'); if (b) b.click(); }
      });
    });
    m.querySelectorAll('[data-act="clean"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rowEl = btn.closest(".tdy-row");
        var row = (state.data.before_opening || []).find(function (r) { return r.kind === "cleaning"; });
        if (row) markCleaning(row, rowEl);
      });
    });
    var q = m.querySelector("#tdy-q");
    if (q) {
      q.addEventListener("input", function () { state.search = q.value; });
      q.addEventListener("keydown", function (e) {
        if (e.key !== "Enter") return;
        var term = (q.value || "").trim().toLowerCase();
        if (!term) return;
        var mods = Object.keys(E.modules).map(function (k) { return E.modules[k]; }).filter(function (mm) { return (mm.title || mm.id).toLowerCase().indexOf(term) >= 0; });
        var cust = ((state.data && state.data.customers_waiting) || []).filter(function (c) { return String(c.name || "").toLowerCase().indexOf(term) >= 0; });
        if (cust.length) { openPath(cust[0].action.path); return; }
        if (mods.length) { window.location.hash = "#" + mods[0].id; return; }
        // Anything else is a person: Customers searches every register for the name, ID card or phone.
        if (E.modules.customers) { try { sessionStorage.setItem("eikon_customers_q", q.value.trim()); } catch (err) {} window.location.hash = "#customers"; return; }
        E.toast("Nothing called “" + q.value + "” yet. Try a register, a customer or a product name.", "warn");
      });
    }
  }

  async function render0(ctx) {
    state.mount = ctx && ctx.mount;
    state.search = "";
    injectCss();
    render();
    await load();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { if (document.hidden) return; // no polling while the tab is hidden
      if (E.state.activeModuleId === "today") load({ silent: true }); }, 60000);
  }
  function destroy() { if (state.timer) { clearInterval(state.timer); state.timer = null; } }

  E.registerModule({ id: "today", title: "Today", order: 0, icon: "☀", render: render0, destroy: destroy });
})();
