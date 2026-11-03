/* Vaccines, new layout: the vaccine orders taken for clients (this month first, then earlier ones), a search, and one
   form to take an order. Travel: choose the country and the vaccines the database recommends for it (always / if at
   higher risk) are one tap each; routine ones are offered for other orders. Each vaccine shows what stock holds.
   The order is saved exactly as the classic screen saves it (same fields, same item merging; the server takes the
   vaccines off stock) and prints in the classic layout, A4 or receipt. Stock rows, batches and the vaccine database
   stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, orders: [], catalog: [], stock: [], loading: false, error: "", q: "", adding: null, saving: false, err: "", printFor: 0, justSaved: 0 };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var F = ["country", "client_first", "client_last", "phone", "email"];
  var COUNTRIES = null, countriesLoading = null; // [{ code, name, nn }] from the same map file the classic screen uses

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s || "").trim().toLowerCase(); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function toInt(v, def) { var n = parseInt(String(v == null ? "" : v), 10); return Number.isFinite(n) ? n : (def == null ? 0 : def); }
  function nowIso() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  function when(iso) { // 3 Nov, 10:22 (the year only when it is not this year)
    var d = new Date(iso); if (isNaN(d)) return String(iso || "");
    return d.getDate() + " " + MON[d.getMonth()] + (d.getFullYear() === new Date().getFullYear() ? "" : " " + d.getFullYear()) + ", " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function ym(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  function dmy(s) { var p = String(s || "").split("-"); return p.length === 3 ? Number(p[2]) + " " + MON[Number(p[1]) - 1] + " " + p[0] : String(s || ""); }
  function client(o) { return (String(o.client_first || "").trim() + " " + String(o.client_last || "").trim()).trim(); }
  function normName(s) { return String(s || "").toLowerCase().replace(/[’']/g, "").replace(/[^a-z0-9]+/g, " ").trim(); }

  // The same rules as the classic screen
  function isRoutine(r) { var v = low(r && r.routine_in_malta); return v === "yes" || v === "y" || v === "1" || v === "true"; }
  function inList(cc, csv) {
    cc = String(cc || "").trim().toUpperCase(); if (!/^[A-Z]{2}$/.test(cc)) return false;
    return String(csv || "").split(",").some(function (p) { return String(p || "").trim().toUpperCase() === cc; });
  }
  function recommend(cc) {
    var always = [], high = [];
    S.catalog.forEach(function (v) { if (inList(cc, v.travel_always)) always.push(v); else if (inList(cc, v.travel_highrisk)) high.push(v); });
    var by = function (a, b) { return String(a.brand_name || "").localeCompare(String(b.brand_name || "")); };
    return { always: always.sort(by), high: high.sort(by) };
  }
  function buildItems(lines) { // merge the same vaccine typed twice, sorted by name (as the classic order panel does)
    var merged = {};
    lines.forEach(function (l) {
      var nm = String(l.name || "").trim(), q = toInt(l.qty, 0), k = nm.toLowerCase();
      if (!nm || q <= 0) return;
      merged[k] = merged[k] || { name: nm, qty: 0 }; merged[k].qty += q;
    });
    return Object.keys(merged).map(function (k) { return merged[k]; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }
  function countryMatches(query) {
    var q = normName(query); if (!q || !COUNTRIES) return [];
    var hits = [];
    COUNTRIES.forEach(function (c) { var i = c.nn.indexOf(q); if (i >= 0) hits.push({ c: c, s: (i === 0 ? 0 : 50) + Math.min(i, 40) + Math.min(c.nn.length, 60) / 10 }); });
    hits.sort(function (a, b) { return a.s !== b.s ? a.s - b.s : String(a.c.name).localeCompare(String(b.c.name)); });
    return hits.map(function (x) { return x.c; });
  }
  function stockFor(name) { // the server takes stock from the row with this exact name and the earliest expiry
    var rows = S.stock.filter(function (r) { return String(r.vaccine_name || "").trim() === String(name || "").trim(); });
    if (!rows.length) return null;
    var qty = rows.reduce(function (a, r) { return a + toInt(r.qty, 0); }, 0);
    var exp = rows.map(function (r) { return String(r.expiry_date || ""); }).filter(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(x); }).sort()[0] || "";
    return { qty: qty, exp: exp };
  }

  function css() {
    if (document.getElementById("eikon-vaxreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-vaxreg-css";
    st.textContent =
      ".vxr{max-width:880px;margin:0 auto}" +
      ".vxr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".vxr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".vxr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.vxr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".vax-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".vax-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.vax-btn:disabled{opacity:.55;cursor:default}.vax-btn.t{border:0;background:none;color:var(--accent);padding:0 4px}" +
      ".vxr-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".vxr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.vxr-lab b{color:var(--text)}" +
      ".vxr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".vxr-row{display:flex;gap:12px;align-items:center;padding:11px 16px;border-top:.5px solid var(--border)}.vxr-row:first-child{border-top:0}.vxr-row.new{background:rgba(10,143,106,.08)}" +
      ".vxr-row .t{flex:1;min-width:0}.vxr-row b{font-size:15px;font-weight:600}.vxr-row .m{font-size:14px;margin-top:2px;overflow-wrap:anywhere}.vxr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere}" +
      ".vxr-row .a{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end;align-items:center}.vxr-row .a i{font-style:normal;font-size:12.5px;color:var(--muted);width:100%;text-align:right}" +
      ".vxr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".vxr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".vxr-form label>span{flex:0 0 104px;font-size:15px}.vxr-form input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}.vxr-form label small{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}" +
      ".vxr-seg{display:flex;gap:6px;padding:8px 14px}.vxr-seg .vax-btn{flex:1}" +
      ".vxr-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:12px 14px 4px;border-top:.5px solid var(--border);display:flex;justify-content:space-between;gap:8px}" +
      ".vxr-chips{display:flex;flex-wrap:wrap;gap:6px;padding:4px 14px 10px}.vxr-chips .vax-btn{height:auto;min-height:34px;padding:5px 12px;white-space:normal;text-align:left;line-height:1.25}" +
      ".vxr-chips .vax-btn em{display:block;font-style:normal;font-weight:400;font-size:12px;opacity:.85}" +
      ".vxr-form .ln{border-top:.5px solid var(--border);padding:0 14px}.vxr-form .ln .row{display:flex;align-items:center;gap:8px;min-height:44px}" +
      ".vxr-form .ln input.n{flex:1;min-width:0}.vxr-form .ln input.q{flex:0 0 48px;text-align:right}.vxr-form .ln .x{flex:0 0 32px;height:32px;padding:0;border-radius:16px}" +
      ".vxr-form .ln .hint{font-size:12.5px;color:var(--muted);padding:0 0 8px;margin-top:-4px}.vxr-form .ln .hint.lo{color:var(--danger)}" +
      ".vxr-form .note{font-size:13px;color:var(--muted);padding:8px 14px 0}.vxr-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:space-between;align-items:center;flex-wrap:wrap}" +
      ".vxr-err{color:var(--danger);font-size:13px;padding:4px 14px}" +
      ".vxr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.vxr{padding:4px 16px 0}.vxr h1{font-size:32px}.vxr-form label>span{flex-basis:92px}.vxr-row{flex-wrap:wrap}.vxr-row .a{width:100%;justify-content:flex-start}.vxr-row .a i{text-align:left}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    var side = Promise.all([ // suggestions and stock: the screen works without them
      E.apiFetch("/vaccines/catalog", { method: "GET" }).then(function (r) { S.catalog = (r && r.items) || []; }).catch(function () {}),
      E.apiFetch("/vaccines/stock/rows", { method: "GET" }).then(function (r) { S.stock = (r && r.rows) || []; }).catch(function () {})
    ]);
    try {
      var r = await E.apiFetch("/vaccines/orders", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load vaccine orders");
      S.orders = r.orders || r.items || [];
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load vaccine orders"); }
    await side;
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }
  function loadCountries() { // a 3.5 MB map file, fetched once and only when a travel order is being taken
    if (COUNTRIES || countriesLoading) return countriesLoading;
    countriesLoading = (async function () {
      try {
        var res = await fetch("./world_hi_res_v4_palette.html", { method: "GET", cache: "force-cache" });
        if (!res.ok) throw new Error("HTTP " + res.status);
        var html = await res.text(), seen = {}, out = [], ta = document.createElement("textarea");
        (html.match(/<g\b[^>]*\bclass="country"[^>]*>/g) || []).forEach(function (tag) {
          var iso = (/\bdata-iso="([A-Za-z]{2})"/.exec(tag) || [])[1], nm = (/\bdata-name="([^"]*)"/.exec(tag) || [])[1];
          if (!iso || !nm) return; iso = iso.toUpperCase(); ta.innerHTML = nm; nm = ta.value.trim();
          if (!nm || seen[iso]) return; seen[iso] = 1; out.push({ code: iso, name: nm, nn: normName(nm) });
        });
        if (!out.length) throw new Error("no countries");
        COUNTRIES = out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      } catch (e) { COUNTRIES = null; }
      countriesLoading = null;
      var dl = S.mount && S.mount.querySelector("#vxr-countries"); // only the suggestion list changes: no redraw under a tap
      if (dl && COUNTRIES) dl.innerHTML = COUNTRIES.map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("");
      if (S.adding && S.adding.country && !S.adding.cc) resolveCountry();
    })();
    return countriesLoading;
  }

  function chip(v, on) {
    return '<button type="button" class="vax-btn' + (on ? " p" : "") + '" data-act="pick" data-v="' + S.catalog.indexOf(v) + '" aria-pressed="' + (on ? "true" : "false") + '">' + esc(v.brand_name) + (v.vaccinates_for ? "<em>" + esc(v.vaccinates_for) + "</em>" : "") + "</button>";
  }
  function hasLine(name) { return S.adding.lines.some(function (l) { return low(l.name) === low(name); }); }

  function orderRow(o) {
    var its = o.items || [], sec = o.section === "travel" ? "Travel" + (o.country_name ? " to " + o.country_name : "") : o.section === "other" ? "Routine and other" : String(o.section || "");
    var acts = S.printFor === o.id
      ? '<i>' + (S.justSaved === o.id ? "Saved. Print it?" : "Print on") + '</i><button class="vax-btn" data-act="print-a4" data-id="' + o.id + '">A4</button><button class="vax-btn" data-act="print-rc" data-id="' + o.id + '">Receipt</button><button class="vax-btn t" data-act="print-no">Not now</button>'
      : '<button class="vax-btn" data-act="print" data-id="' + o.id + '" aria-label="Print the order for ' + esc(client(o)) + '">Print</button>';
    return '<div class="vxr-row' + (S.justSaved === o.id ? " new" : "") + '"><div class="t"><b>' + esc(client(o)) + '</b><div class="m">' + (its.length ? its.map(function (it) { return esc(it.name) + " × " + esc(it.qty || 1); }).join(", ") : "No vaccines") + "</div><span>" +
      esc(when(o.created_at)) + " · " + esc(sec) + (o.phone ? " · " + esc(o.phone) : "") + (o.email ? " · " + esc(o.email) : "") + '</span></div><div class="a">' + acts + "</div></div>";
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "vaxreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var qi = m.querySelector("#vxr-q"); if (qi) S.q = qi.value;
    var h = '<div class="vxr"><button class="vxr-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("vaxreg")) + '</button>' +
      '<div class="vxr-top"><div><h1>Vaccines</h1><p class="vxr-sub">Vaccines ordered for clients, for travel or routine.</p></div>' + (S.adding ? "" : '<button class="vax-btn p" data-act="add">New order</button>') + "</div>";
    if (S.adding) {
      var a = S.adding, travel = a.section === "travel";
      var fld = function (k, label, extra, hint) { return '<label><span>' + label + '</span><input name="' + k + '" value="' + esc(a[k] || "") + '"' + (extra || "") + ">" + (hint || "") + "</label>"; };
      h += '<form class="vxr-form" id="vxr-add" autocomplete="off">' +
        '<div class="vxr-seg" role="group" aria-label="Kind of order"><button type="button" class="vax-btn' + (travel ? " p" : "") + '" data-act="sec" data-sec="travel" aria-pressed="' + travel + '">Travel</button><button type="button" class="vax-btn' + (travel ? "" : " p") + '" data-act="sec" data-sec="other" aria-pressed="' + !travel + '">Routine and other</button></div>';
      if (travel) {
        h += fld("country", "Country", ' list="vxr-countries" placeholder="e.g. Kenya"', a.cc ? "<small>" + esc(a.cc) + "</small>" : "");
        if (a.cc) {
          var rec = recommend(a.cc);
          if (rec.always.length) h += '<div class="hd"><span>Recommended for ' + esc(a.country) + "</span></div>" + '<div class="vxr-chips">' + rec.always.map(function (v) { return chip(v, hasLine(v.brand_name)); }).join("") + "</div>";
          if (rec.high.length) h += '<div class="hd"><span>If at higher risk</span></div><div class="vxr-chips">' + rec.high.map(function (v) { return chip(v, hasLine(v.brand_name)); }).join("") + "</div>";
          if (!rec.always.length && !rec.high.length) h += '<div class="note" style="padding-bottom:8px">The vaccine database has no recommendation for ' + esc(a.country) + ". Add the vaccines below.</div>";
        }
      } else {
        var rt = S.catalog.filter(isRoutine).sort(function (x, y) { return String(x.brand_name).localeCompare(String(y.brand_name)); });
        if (rt.length) h += '<div class="hd"><span>Routine in Malta</span></div><div class="vxr-chips">' + rt.map(function (v) { return chip(v, hasLine(v.brand_name)); }).join("") + "</div>";
      }
      h += '<div class="hd"><span>Vaccines</span><span>Qty</span></div>' + a.lines.map(function (l, i) {
        var s = l.name ? stockFor(l.name) : null;
        return '<div class="ln"><div class="row"><input class="n" data-i="' + i + '" data-k="name" list="vxr-names" value="' + esc(l.name) + '" placeholder="Vaccine name" aria-label="Vaccine ' + (i + 1) + '">' +
          '<input class="q" data-i="' + i + '" data-k="qty" inputmode="numeric" value="' + esc(l.qty) + '" aria-label="Quantity of vaccine ' + (i + 1) + '">' +
          (a.lines.length > 1 ? '<button type="button" class="vax-btn x" data-act="rm" data-i="' + i + '" aria-label="Remove vaccine ' + (i + 1) + '">✕</button>' : "") + "</div>" +
          (s ? '<div class="hint' + (s.qty <= 0 ? " lo" : "") + '">' + (s.qty <= 0 ? "None in stock" : s.qty + " in stock") + (s.exp ? " · earliest expiry " + esc(dmy(s.exp)) : "") + "</div>" : "") + "</div>";
      }).join("") +
        '<div class="acts" style="padding-top:2px"><button type="button" class="vax-btn t" data-act="line">Add a vaccine</button></div>' +
        '<div class="hd"><span>Client</span></div>' +
        fld("client_first", "Name", ' autocapitalize="words" autocomplete="off"') + fld("client_last", "Surname", ' autocapitalize="words"') +
        fld("phone", "Phone", ' type="tel" inputmode="tel"') + fld("email", "Email", ' type="email" placeholder="Optional"') +
        '<div class="note">Saving takes these vaccines off stock.</div>' + (S.err ? '<div class="vxr-err" role="alert">' + esc(S.err) + "</div>" : "") +
        '<div class="acts" style="justify-content:flex-end"><button type="button" class="vax-btn" data-act="add-cancel">Cancel</button><button type="submit" class="vax-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save order") + "</button></div>" +
        '<datalist id="vxr-names">' + uniq(S.catalog.map(function (v) { return v.brand_name; }).concat(S.stock.map(function (r) { return r.vaccine_name; }))).map(function (n) { return '<option value="' + esc(n) + '">'; }).join("") + "</datalist>" +
        '<datalist id="vxr-countries">' + (COUNTRIES || []).map(function (c) { return '<option value="' + esc(c.name) + '">'; }).join("") + "</datalist></form>";
    }
    if (S.loading && !S.orders.length) h += '<div class="vxr-quiet">Opening vaccine orders…</div>';
    else if (S.error) h += '<div class="vxr-quiet">' + esc(S.error) + "</div>";
    else {
      h += '<input class="vxr-q" id="vxr-q" type="search" aria-label="Search orders" placeholder="Name, phone, country or vaccine" value="' + esc(S.q) + '">';
      var q = low(S.q);
      if (q) {
        var hit = S.orders.filter(function (o) {
          return [o.client_first, o.client_last, client(o), o.phone, o.email, o.country_name, o.country_code, o.section].concat((o.items || []).map(function (it) { return it.name; })).some(function (v) { return low(v).indexOf(q) >= 0; });
        });
        h += '<div class="vxr-lab">Found <b>' + hit.length + "</b></div>" + (hit.length ? '<div class="vxr-list">' + hit.map(orderRow).join("") + "</div>" : '<div class="vxr-quiet">No order matches.</div>');
      } else {
        var mon = ym(nowIso()), cur = S.orders.filter(function (o) { return ym(o.created_at) === mon; }), old = S.orders.filter(function (o) { return ym(o.created_at) !== mon; });
        h += '<div class="vxr-lab">This month <b>' + cur.length + "</b></div>" + (cur.length ? '<div class="vxr-list">' + cur.map(orderRow).join("") + "</div>" : '<div class="vxr-quiet">No vaccine order this month yet.</div>');
        if (old.length) h += '<div class="vxr-lab">Earlier <b>' + old.length + '</b></div><div class="vxr-list">' + old.slice(0, 30).map(orderRow).join("") + "</div>" +
          (old.length > 30 ? '<p style="font-size:12.5px;color:var(--muted);margin:8px 2px 0">Showing the latest 30. Search to find the others.</p>' : "");
      }
    }
    h += '<p style="font-size:12.5px;color:var(--muted);margin-top:12px">Search covers the latest 200 orders. Stock, batches and expiry, the vaccine database and printed tables are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, keepSel = "";
    if (ae && m.contains(ae)) keepSel = ae.id === "vxr-q" ? "#vxr-q" : ae.name ? "[name=" + ae.name + "]" : ae.getAttribute("data-k") ? '[data-i="' + ae.getAttribute("data-i") + '"][data-k="' + ae.getAttribute("data-k") + '"]' :
      ae.getAttribute("data-act") ? '[data-act="' + ae.getAttribute("data-act") + '"]' + ["data-sec", "data-v", "data-i", "data-id"].map(function (k) { return ae.hasAttribute(k) ? "[" + k + '="' + ae.getAttribute(k) + '"]' : ""; }).join("") : "";
    m.innerHTML = h;
    if (keepSel) { var again = m.querySelector(keepSel); if (again) { again.focus(); try { var L = again.value.length; again.setSelectionRange(L, L); } catch (x) {} } } // typing keeps its place
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act"), id = Number(b.getAttribute("data-id"));
        if (act === "back") window.location.hash = E.ui2BackHash("vaxreg");
        else if (act === "add") { S.adding = { section: "travel", country: "", cc: "", lines: [{ name: "", qty: "1" }] }; S.err = ""; S.printFor = 0; S.justSaved = 0; paint(true); loadCountries(); focus("[name=country]"); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; paint(true); }
        else if (act === "sec") { keep(); S.adding.section = b.getAttribute("data-sec"); if (S.adding.section === "travel") loadCountries(); paint(true); var sb = m.querySelector('[data-act=sec][data-sec="' + S.adding.section + '"]'); if (sb) sb.focus(); }
        else if (act === "pick") {
          keep(); var v = S.catalog[Number(b.getAttribute("data-v"))]; if (!v) return;
          var L2 = S.adding.lines, at = -1; L2.forEach(function (l, i) { if (low(l.name) === low(v.brand_name)) at = i; });
          if (at >= 0) { L2.splice(at, 1); if (!L2.length) L2.push({ name: "", qty: "1" }); }
          else { var empty = L2.filter(function (l) { return !l.name; })[0]; if (empty) { empty.name = v.brand_name; empty.qty = empty.qty || "1"; } else L2.push({ name: v.brand_name, qty: "1" }); }
          var vi = b.getAttribute("data-v"); paint(true); var nb = m.querySelector('[data-act=pick][data-v="' + vi + '"]'); if (nb) nb.focus();
        }
        else if (act === "line") { keep(); S.adding.lines.push({ name: "", qty: "1" }); paint(true); var ins = m.querySelectorAll(".vxr-form .ln input.n"); if (ins.length) ins[ins.length - 1].focus(); }
        else if (act === "rm") { keep(); S.adding.lines.splice(Number(b.getAttribute("data-i")), 1); paint(true); var add = m.querySelector("[data-act=line]"); if (add) add.focus(); }
        else if (act === "print") { S.printFor = id; S.justSaved = 0; paint(); var a4 = m.querySelector('[data-act=print-a4][data-id="' + id + '"]'); if (a4) a4.focus(); }
        else if (act === "print-a4" || act === "print-rc") { var o = S.orders.find(function (x) { return x.id === id; }); if (o) printOrder(o, act === "print-rc" ? "RECEIPT" : "A4"); S.printFor = 0; S.justSaved = 0; paint(); }
        else if (act === "print-no") { S.printFor = 0; S.justSaved = 0; paint(); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "vaxreg"); } catch (x) {} E.openClassic("vaccines"); }
      });
    });
    var qn = m.querySelector("#vxr-q"); if (qn) qn.addEventListener("input", function () { paint(); });
    var f = m.querySelector("#vxr-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
      var cn = f.querySelector("[name=country]");
      if (cn) {
        cn.addEventListener("focus", function () { loadCountries(); });
        cn.addEventListener("input", function () { if (S.adding.cc && low(cn.value) !== low(S.adding.country)) { S.adding.cc = ""; } clearTimeout(S.cT); S.cT = setTimeout(function () { if (COUNTRIES && countryMatches(cn.value).length && COUNTRIES.some(function (c) { return low(c.name) === low(cn.value); })) resolveCountry(); }, 250); });
        cn.addEventListener("change", function () { setTimeout(resolveCountry, 0); }); // after focus has moved on, so a Tab is not undone
        cn.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); resolveCountry(); } }); // Enter takes the top match, as in the classic screen
      }
      f.querySelectorAll(".ln input.n").forEach(function (el) { el.addEventListener("change", function () { hint(el); }); }); // shows what stock holds for it, in place
    }
  }
  function hint(el) {
    var ln = el.closest(".ln"), old = ln && ln.querySelector(".hint"), s = el.value.trim() ? stockFor(el.value) : null;
    if (old) old.remove(); if (!ln || !s) return;
    var d = document.createElement("div"); d.className = "hint" + (s.qty <= 0 ? " lo" : "");
    d.textContent = (s.qty <= 0 ? "None in stock" : s.qty + " in stock") + (s.exp ? " · earliest expiry " + dmy(s.exp) : ""); ln.appendChild(d);
  }
  function resolveCountry() { // the best match becomes the country, its recommendations appear
    keep(); var a = S.adding; if (!a || a.section !== "travel") return;
    if (!a.country) { if (a.cc) { a.cc = ""; paint(true); } return; }
    if (!COUNTRIES) return; // still loading: done when the list arrives
    var best = COUNTRIES.filter(function (c) { return low(c.name) === low(a.country); })[0] || countryMatches(a.country)[0];
    if (best && (best.code !== a.cc || best.name !== a.country)) { a.cc = best.code; a.country = best.name; paint(true); }
  }
  function focus(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); var ae = document.activeElement; if (x && !(ae && ae !== document.body && S.mount.contains(ae) && ae.closest && ae.closest("form"))) x.focus(); }, 30); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { var k = String(x || "").trim(); if (k && !seen[low(k)]) { seen[low(k)] = 1; out.push(k); } }); return out.sort(function (x, y) { return x.localeCompare(y); }); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#vxr-add"); if (!f || !S.adding) return;
    F.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value || "").trim(); });
    f.querySelectorAll("[data-k]").forEach(function (el) { var l = S.adding.lines[Number(el.getAttribute("data-i"))]; if (l) l[el.getAttribute("data-k")] = String(el.value || "").trim(); });
  }

  async function add() {
    if (S.saving) return;
    keep(); resolveCountry();
    var a = S.adding; S.err = "";
    var travel = a.section === "travel", items = buildItems(a.lines);
    var bad = a.lines.filter(function (l) { return l.name && (!/^\d+$/.test(l.qty) || Number(l.qty) < 1); })[0]; // a line with no vaccine is left out
    if (bad) S.err = "Write how many of " + bad.name + " (a whole number). Nothing was saved.";
    else if (!items.length) S.err = "Add at least one vaccine. Nothing was saved.";
    else if (travel && a.country && !a.cc) S.err = (COUNTRIES ? "Choose the country from the list" : "The country list is still loading. Wait a moment") + ", or leave it empty. Nothing was saved.";
    else if (!a.client_first || !a.client_last) S.err = "Write the client's name and surname. Nothing was saved.";
    else if (!a.phone) S.err = "Write the client's phone number. Nothing was saved.";
    if (S.err) return paint(true);
    // the same body the classic screen sends
    var body = { section: travel ? "travel" : "other", country_code: travel ? (a.cc || "") : "", country_name: travel ? (a.country || "") : "", client_first: a.client_first, client_last: a.client_last, phone: a.phone, email: a.email || "", items: items };
    S.saving = true; paint(true);
    var since = Date.now() - 10 * 60 * 1000, sig = JSON.stringify(items.map(function (it) { return [low(it.name), it.qty]; }));
    try {
      var r = await E.postOnce("/vaccines/orders", body, {
        list: async function () { var r0 = await E.apiFetch("/vaccines/orders", { method: "GET" }); return (r0 && r0.ok && (r0.orders || r0.items)) || []; },
        same: function (o) { return new Date(o.created_at).getTime() >= since && low(o.client_first) === low(body.client_first) && low(o.client_last) === low(body.client_last) && String(o.phone || "").trim() === body.phone && o.section === body.section &&
          JSON.stringify((o.items || []).map(function (it) { return [low(it.name), toInt(it.qty, 1)]; }).sort()) === JSON.stringify(JSON.parse(sig).sort()); }
      });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      S.adding = null; E.toast("Order saved for " + body.client_first + " " + body.client_last, "success");
      var oid = r.order && r.order.id; if (oid) { S.printFor = oid; S.justSaved = oid; } // like the classic screen, offer to print it straight away
      S.q = "";
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; await load();
    if (S.printFor) { var a4 = S.mount && S.mount.querySelector('[data-act=print-a4][data-id="' + S.printFor + '"]'); if (a4) a4.focus(); } // the form is gone: focus goes to the print offer
  }

  // Printing: the classic screen's layout, unchanged (A4, or a 75 mm receipt that fits its length)
  function printShell(title, bodyHtml, size) {
    var isReceipt = size === "RECEIPT";
    var pageCss = isReceipt ? "@page{size:75mm 40mm;margin:0}" : "@page{size:A4;margin:12mm}";
    var base = "*,*::before,*::after{box-sizing:border-box;}html,body{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial;margin:0;padding:0;}" +
      (isReceipt ? "body{width:75mm;}#paper{padding:6mm;}#content{display:inline-block;width:100%;}" : "") +
      "h1{margin:0 0 10px 0;font-size:" + (isReceipt ? "16px" : "18px") + "}" +
      "table{width:100%;border-collapse:collapse;font-size:" + (isReceipt ? "11px" : "12px") + "}" +
      "th,td{border-bottom:1px solid #ddd;padding:" + (isReceipt ? "4px 4px" : "6px 6px") + ";vertical-align:top}" +
      "th{text-align:left;background:#f6f6f6}.muted{color:#666}.row{display:flex;gap:12px;flex-wrap:wrap;margin:8px 0}" +
      ".pill{display:inline-block;border:1px solid #ddd;border-radius:999px;padding:3px 8px;font-size:11px;background:#fafafa}";
    var script = "<script>(function(){function pxToMm(px){return px*25.4/96;}function applyReceiptPageSize(){try{var c=document.getElementById('content');if(!c) return;" +
      "var h=Math.max(c.scrollHeight||0, c.getBoundingClientRect().height||0);var mm=Math.ceil(pxToMm(h)+2);if(mm<60) mm=60;if(mm>1200) mm=1200;" +
      "var st=document.getElementById('pageSizeStyle');if(st) st.textContent='@page{size:75mm '+mm+'mm;margin:0}';}catch(e){}}" +
      "window.addEventListener('load', function(){" + (isReceipt ? "applyReceiptPageSize();setTimeout(applyReceiptPageSize,80);setTimeout(applyReceiptPageSize,220);" : "") +
      " setTimeout(function(){try{window.focus();}catch(e){} try{window.print();}catch(e2){}}, 120);});})();<\/script>";
    return "<!doctype html><html><head><meta charset='utf-8'/><title>" + esc(title || "Print") + "</title><style id='pageSizeStyle'>" + pageCss + "</style><style>" + base + "</style></head><body>" +
      (isReceipt ? "<div id='paper'><div id='content'>" + bodyHtml + "</div></div>" : bodyHtml) + script + "</body></html>";
  }
  function printOrder(o, size) {
    var items = o.items || [];
    var rows = items.map(function (it) { return "<tr><td><b>" + esc(it.name || "") + "</b></td><td style='text-align:right'>" + esc(it.qty || 1) + "</td></tr>"; }).join("");
    var body = "<h1>Vaccine order</h1><div class='row'><span class='pill'><b>Created</b> " + esc(o.created_at || "") + "</span><span class='pill'><b>Section</b> " + esc(o.section || "") + "</span>" +
      (o.country_name ? "<span class='pill'><b>Country</b> " + esc(o.country_name) + " (" + esc(o.country_code || "") + ")</span>" : "") + "</div>" +
      "<div style='margin:10px 0'><div><b>Client:</b> " + esc((o.client_first || "") + " " + (o.client_last || "")) + "</div><div><b>Phone:</b> " + esc(o.phone || "") + "</div>" + (o.email ? "<div><b>Email:</b> " + esc(o.email) + "</div>" : "") + "</div>" +
      "<table><thead><tr><th>Vaccine</th><th style='text-align:right'>Qty</th></tr></thead><tbody>" + (rows || "<tr><td colspan='2' class='muted'>No items</td></tr>") + "</tbody></table>";
    var w = window.open("", "_blank");
    if (!w) { E.toast("The browser blocked the print window. Allow pop-ups for Eikon and press Print again.", "warn"); return; }
    try { w.document.open(); w.document.write(printShell("Vaccine order", body, size)); w.document.close(); } catch (e) {}
    try { w.focus(); } catch (e2) {}
  }

  E.registerModule({
    id: "vaxreg", title: "Vaccines", order: 3, icon: "✚", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.q = ""; S.printFor = 0; S.justSaved = 0; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("vaxreg") < 0) E.UI2_DESTINATIONS.push("vaxreg");
  if (E.UI2_PARENT) E.UI2_PARENT.vaxreg = "services";
})();
