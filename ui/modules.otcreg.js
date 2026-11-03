/* Over the counter, new layout: what to recommend by symptom. Search a symptom, a product, a use case or a bundle (the
   classic screen's search, same index and the same ranking), or pick a symptom from the list; see the products linked to
   it, and for a product its cautions first (do not sell together), then its alternatives, what goes with it, its symptoms,
   use cases and bundles. Tap any of them to follow it, Back (or Escape) to return.
   Read only. The content is the classic OTC mindmap's own: the same static files (productmap-data/), read at run time, so
   the two screens can never differ. Nothing here is written by this screen: labels, scores and reasons are the data's.
   The map view, its score and limit filters and the complementary-items filter stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, idx: null, syms: null, loading: false, error: "", q: "", stack: [], data: {}, opening: "", more: {}, openErr: "" };
  // Same place the classic screen reads its data from (window.EIKON_PRODUCTMAP_BASE, or next to the page)
  var DATA_BASE = (window.EIKON_PRODUCTMAP_BASE || "").replace(/\/$/, "");
  function asset(p) { return (DATA_BASE ? DATA_BASE + "/" : "") + p.replace(/^\//, ""); }
  var TYPE = { product: "Product", symptom: "Symptom", usecase: "Use case", bundle: "Bundle" };
  var SHOW = 12; // rows per section before "Show all"

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function norm(s) { return String(s || "").trim().toLowerCase(); }

  function css() {
    if (document.getElementById("eikon-otcreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-otcreg-css";
    st.textContent =
      ".otc{max-width:1180px;margin:0 auto}" +
      ".otc-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".otc h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.otc-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".otc :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".otc-grid{display:grid;grid-template-columns:380px minmax(0,1fr);gap:18px;align-items:start;margin-top:16px}.otc-side,.otc-detail{min-width:0}" +
      ".otc-q{width:100%;box-sizing:border-box;height:42px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".otc-q:focus-visible{outline:2px solid var(--accent);outline-offset:1px}" +
      ".otc-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 2px 7px;display:flex;gap:8px;justify-content:space-between}.otc-lab b{color:var(--text);font-variant-numeric:tabular-nums}" +
      ".otc-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".otc-row{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;text-align:left;border:0;border-top:.5px solid var(--border);background:none;font:inherit;color:var(--text);padding:10px 14px;cursor:pointer}" +
      ".otc-list>.otc-row:first-child{border-top:0}.otc-row:hover{background:rgba(127,127,127,.07)}.otc-row.on{background:rgba(10,143,106,.08)}" +
      ".otc-row .t{flex:1;min-width:0}.otc-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}.otc-row span.s{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow-wrap:anywhere;line-height:1.4}" +
      ".otc-row i{font-style:normal;flex:none;color:var(--muted);font-size:18px}" +
      ".otc-pill{flex:none;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--text);white-space:nowrap}" +
      ".otc-more{display:block;width:100%;border:0;border-top:.5px solid var(--border);background:none;color:var(--accent);font:inherit;font-size:14px;font-weight:600;padding:10px 14px;text-align:left;cursor:pointer}" +
      ".otc-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:20px;color:var(--muted);font-size:14px;line-height:1.5}" +
      ".otc-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:18px 20px}" +
      ".otc-card h2{font-size:24px;letter-spacing:-.02em;margin:0;line-height:1.15;font-weight:800;overflow-wrap:anywhere}.otc-card h2:focus{outline:0}" +
      ".otc-meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:8px;font-size:13px;color:var(--muted)}" +
      ".otc-desc{font-size:14px;line-height:1.5;margin:10px 0 0;color:var(--text)}" +
      ".otc-caution{margin-top:16px;border:1px solid var(--border);border-left:4px solid var(--danger);border-radius:12px;background:var(--panel2);padding:12px 14px}" +
      ".otc-caution h3{margin:0 0 4px;font-size:15px;font-weight:700;color:var(--danger);display:flex;gap:6px;align-items:center}" +
      ".otc-caution p{margin:0 0 8px;font-size:14px;line-height:1.45}" +
      ".otc-caution .otc-list{margin-top:6px}" +
      ".otc-dback{display:inline-block;border:0;background:none;color:var(--accent);font:inherit;font-size:16px;font-weight:500;padding:4px 0 12px;cursor:pointer;text-align:left;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      "@media (min-width:901px){.otc-dback.root{display:none}}" +
      ".otc-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}.otc-foot a{color:var(--accent)}" +
      "@media (max-width:900px){.otc-grid{grid-template-columns:minmax(0,1fr)}.otc.has-sel .otc-side,.otc.has-sel .otc-head{display:none}.otc.has-sel .otc-grid{margin-top:0}.otc-pick{display:none}}" +
      "@media (max-width:600px){.otc{padding:4px 16px 0}.otc h1{font-size:32px}.otc-card{padding:16px}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .otc-row.on{background:rgba(43,196,138,.14)}html[data-ui2]:not([data-ui2-visit]) .otc-caution h3{color:#FF7A72}html[data-ui2]:not([data-ui2-visit]) .otc-caution{border-left-color:#FF7A72}}";
    document.head.appendChild(st);
  }

  function fetchJson(p) {
    return fetch(asset(p), { cache: "force-cache" }).then(function (r) {
      if (!r.ok) throw new Error("Failed to load " + p + " (" + r.status + ")");
      return r.json();
    });
  }

  async function load() {
    if (S.idx && S.syms) return paint();
    S.loading = true; S.error = ""; paint();
    try {
      var both = await Promise.all([fetchJson("productmap-data/search-index.json"), fetchJson("productmap-data/core/symptoms.json")]);
      S.idx = both[0] || []; S.syms = both[1] || [];
    } catch (e) { S.error = "Could not open the OTC guide. Try again in a moment."; }
    S.loading = false; paint();
  }

  // The classic screen's search, unchanged: same scores, same order, the first 20
  function doSearch(q) {
    q = norm(q);
    if (!q || !S.idx) return [];
    var words = q.split(/\s+/).filter(Boolean);
    var results = [];
    for (var i = 0; i < S.idx.length; i++) {
      var it = S.idx[i];
      var hay = norm(it.label + " " + (it.searchText || ""));
      var score = 0;
      if (norm(it.label) === q) score = 120;
      else if (norm(it.label).indexOf(q) === 0) score = 100;
      else if (hay.indexOf(q) >= 0) score = 80;
      else {
        var matched = 0;
        for (var w = 0; w < words.length; w++) if (hay.indexOf(words[w]) >= 0) matched++;
        if (matched > 0) score = 40 + (matched / words.length) * 30;
      }
      if (score > 0) results.push({ item: it, score: score + (it.priority || 0) * 0.01 });
    }
    results.sort(function (a, b) { return b.score - a.score; });
    return results.slice(0, 20);
  }

  async function open(id, push) {
    S.openErr = "";
    if (!S.data[id]) {
      S.opening = id; paint();
      var parts = String(id).split(":"), type = parts[0], ref = parts[1];
      var dir = type === "product" ? "product" : (type === "symptom" ? "symptom" : (type === "usecase" ? "usecase" : "bundle"));
      try { S.data[id] = await fetchJson("productmap-data/neighbours/" + dir + "/" + ref + ".json"); }
      catch (e) { S.opening = ""; S.openErr = "Could not open that one. Try again in a moment."; paint(); return; }
      S.opening = "";
    }
    if (push) S.stack.push(id); else S.stack = [id];
    S.more = {}; paint(); top(); focusTitle();
  }

  function back() {
    var was = S.stack.pop(); S.more = {}; paint();
    if (S.stack.length) { focusTitle(); var r = S.mount && S.mount.querySelector('.otc-detail [data-open="' + was + '"]'); if (r) setTimeout(function () { r.focus(); }, 40); }
    else { var row = S.mount && S.mount.querySelector('.otc-side [data-open="' + was + '"]'); if (row) row.focus(); else { var q = S.mount && S.mount.querySelector("#otc-q"); if (q) q.focus(); } }
  }

  // The links of one item, by kind, highest score first (ties keep the file's order, as the classic lists do)
  function sections(d) {
    var c = d.centerId, nodes = {}, by = {};
    (d.nodes || []).forEach(function (n) { nodes[n.id] = n; });
    (d.links || []).forEach(function (l) {
      var other = l.source === c ? l.target : l.source, n = nodes[other];
      if (!n) return;
      (by[l.rel] = by[l.rel] || []).push({ node: n, link: l });
    });
    Object.keys(by).forEach(function (k) { by[k].sort(function (a, b) { return (b.link.score || 0) - (a.link.score || 0); }); });
    return { center: nodes[c] || { id: c, label: c, nodeType: d.centerType }, by: by };
  }

  function row(n, sub, pill) {
    return '<button type="button" class="otc-row" data-open="' + esc(n.id) + '"><span class="t"><b>' + esc(n.label) + "</b>" + (sub ? '<span class="s">' + esc(sub) + "</span>" : "") + "</span>" +
      (pill ? '<span class="otc-pill">' + esc(pill) + "</span>" : "") + '<i aria-hidden="true">›</i></button>';
  }
  function linkSub(l) { return [l.label, l.why, l.score != null ? "Score " + l.score : ""].filter(Boolean).join(" · "); }

  function section(key, title, list) {
    if (!list || !list.length) return "";
    var all = S.more[key], shown = all ? list : list.slice(0, SHOW);
    return '<div class="otc-lab"><span>' + esc(title) + "</span><b>" + list.length + '</b></div><div class="otc-list" data-sec="' + key + '">' +
      shown.map(function (x) { return row(x.node, linkSub(x.link), ""); }).join("") +
      (list.length > shown.length ? '<button type="button" class="otc-more" data-more="' + key + '">Show all ' + list.length + "</button>" : "") + "</div>";
  }

  function detail() {
    var id = S.stack[S.stack.length - 1], d = S.data[id], x = sections(d), c = x.center, by = x.by, h = "";
    var prev = S.stack.length > 1 ? (sections(S.data[S.stack[S.stack.length - 2]]).center.label) : "Over the counter";
    var meta = (c.meta || {}), desc = c.nodeType === "usecase" ? [meta.Description, meta.Trigger_Symptoms ? "Symptoms: " + meta.Trigger_Symptoms : ""] : c.nodeType === "bundle" ? [meta.Description] : [];
    h += '<button type="button" class="otc-dback' + (S.stack.length > 1 ? "" : " root") + '" data-act="close">‹ ' + esc(prev) + "</button>";
    h += '<div class="otc-card"><h2 id="otc-title" tabindex="-1">' + esc(c.label) + '</h2><div class="otc-meta"><span class="otc-pill">' + esc(TYPE[c.nodeType] || c.nodeType) + "</span>" + (c.subtext ? "<span>" + esc(c.subtext) + "</span>" : "") + "</div>" +
      desc.filter(Boolean).map(function (t) { return '<p class="otc-desc">' + esc(t) + "</p>"; }).join("") + "</div>";
    if (by.guardrail && by.guardrail.length) {
      var acts = []; by.guardrail.forEach(function (g) { var a = g.link.meta && g.link.meta.posAction; if (a && acts.indexOf(a) < 0) acts.push(a); });
      var gl = S.more.guardrail ? by.guardrail : by.guardrail.slice(0, SHOW);
      h += '<section class="otc-caution" aria-labelledby="otc-caut"><h3 id="otc-caut"><span aria-hidden="true">⚠</span> Caution: ' + by.guardrail.length + " guardrail" + (by.guardrail.length === 1 ? "" : "s") + "</h3>" +
        acts.map(function (a) { return "<p>" + esc(a) + "</p>"; }).join("") +
        '<div class="otc-list" data-sec="guardrail">' + gl.map(function (g) { return row(g.node, linkSub(g.link), ""); }).join("") +
        (by.guardrail.length > gl.length ? '<button type="button" class="otc-more" data-more="guardrail">Show all ' + by.guardrail.length + "</button>" : "") + "</div></section>";
    }
    if (c.nodeType === "product") {
      h += section("similar", "Alternatives (similar)", by.similar) + section("complement", "Goes well with (complements)", by.complement) +
        section("symptom", "Symptoms", by.symptom) + section("usecase", "Use cases", by.usecase) + section("bundle", "Bundles", by.bundle);
    } else {
      var prodTitle = c.nodeType === "symptom" ? "Products for this symptom" : c.nodeType === "usecase" ? "Products for this use case" : "Products in this bundle";
      h += section(c.nodeType, prodTitle, by[c.nodeType]);
      ["usecase", "bundle", "symptom", "similar", "complement"].forEach(function (k) { if (k !== c.nodeType) h += section(k, k === "usecase" ? "Related use cases" : k === "bundle" ? "Bundles" : k === "symptom" ? "Symptoms" : k === "similar" ? "Alternatives (similar)" : "Goes well with (complements)", by[k]); });
    }
    if (!(d.links || []).length) h += '<div class="otc-quiet" style="margin-top:16px">Nothing linked to this yet.</div>';
    return h;
  }

  function side() {
    var h = '<label for="otc-q" class="otc-lab" style="margin-top:0"><span>Search a symptom or a product</span></label>' +
      '<input id="otc-q" class="otc-q" type="search" autocomplete="off" spellcheck="false" placeholder="e.g. cough, heartburn, ibuprofen" value="' + esc(S.q) + '">';
    var sel = S.stack.length ? S.stack[0] : "";
    if (S.q.trim().length >= 2) {
      var res = doSearch(S.q);
      h += '<div class="otc-lab"><span>Results</span><b>' + res.length + "</b></div>";
      h += res.length ? '<div class="otc-list" id="otc-res">' + res.map(function (r) { return row(r.item, "", TYPE[r.item.nodeType]).replace('class="otc-row"', 'class="otc-row' + (r.item.id === sel ? " on" : "") + '"'); }).join("") + "</div>"
        : '<div class="otc-quiet">Nothing matches “' + esc(S.q.trim()) + "”. Try another word, or fewer letters.</div>";
    } else {
      // Symptoms by group, in the order the data lists them; names in alphabetical order
      var groups = [], byG = {};
      (S.syms || []).forEach(function (s) { var g = s.Display_Group || s.Symptom_Category || "Other"; if (!byG[g]) { byG[g] = []; groups.push(g); } byG[g].push(s); });
      groups.sort(function (a, b) { return a === "General" ? 1 : b === "General" ? -1 : a.localeCompare(b); });
      h += '<p class="otc-sub" style="margin-top:14px">Or pick a symptom.</p>';
      groups.forEach(function (g) {
        var list = byG[g].slice().sort(function (a, b) { return String(a.Symptom_Name).localeCompare(String(b.Symptom_Name)); });
        h += '<div class="otc-lab"><span>' + esc(g) + "</span><b>" + list.length + '</b></div><div class="otc-list">' + list.map(function (s) {
          var id = "symptom:" + s.Symptom_ID;
          return row({ id: id, label: s.Symptom_Name }, s.Linked_Product_Count != null ? s.Linked_Product_Count + " product" + (Number(s.Linked_Product_Count) === 1 ? "" : "s") : "", "").replace('class="otc-row"', 'class="otc-row' + (id === sel ? " on" : "") + '"');
        }).join("") + "</div>";
      });
    }
    return h;
  }

  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "otcreg") return; // left before the data came back: do not draw over the next screen
    var sel = S.stack.length > 0;
    var h = '<div class="otc' + (sel ? " has-sel" : "") + '"><div class="otc-head"><button type="button" class="otc-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("otcreg")) + '</button>' +
      '<h1>Over the counter</h1><p class="otc-sub">What to recommend, by symptom. Search, or pick a symptom, then follow a product to its cautions and alternatives.</p></div>';
    if (S.loading && !S.idx) h += '<div class="otc-quiet" style="margin-top:16px">Opening the OTC guide…</div>';
    else if (S.error) h += '<div class="otc-quiet" style="margin-top:16px">' + esc(S.error) + "</div>";
    else {
      h += '<div class="otc-grid"><div class="otc-side">' + side() + '</div><div class="otc-detail" aria-live="polite">' +
        (S.openErr ? '<div class="otc-quiet">' + esc(S.openErr) + "</div>" : "") +
        (S.opening ? '<div class="otc-quiet">Opening…</div>' : sel ? detail() : '<div class="otc-quiet otc-pick">Pick a symptom to see the products for it. Open a product to see its cautions, alternatives and what goes with it.</div>') +
        "</div></div>";
    }
    h += '<p class="otc-foot">The map view, its score and limit filters and the complementary-items filter are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    var ae = document.activeElement, hadQ = ae && ae.id === "otc-q" && m.contains(ae), pos = hadQ ? ae.selectionStart : 0;
    m.innerHTML = h;
    if (hadQ) { var again = m.querySelector("#otc-q"); if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (x) {} } } // typing keeps its place
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("otcreg");
        else if (act === "close") back();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "otcreg"); } catch (x) {} E.openClassic("otcmindmap"); }
      });
    });
    m.querySelectorAll("[data-open]").forEach(function (b) {
      b.addEventListener("click", function () { open(b.getAttribute("data-open"), !!b.closest(".otc-detail")); });
    });
    m.querySelectorAll("[data-more]").forEach(function (b) {
      b.addEventListener("click", function () {
        var k = b.getAttribute("data-more"), n = b.parentNode.querySelectorAll(".otc-row").length; S.more[k] = true; paint();
        var rows = m.querySelectorAll('[data-sec="' + k + '"] .otc-row'); if (rows[n]) rows[n].focus(); // carry on from the first new row
      });
    });
    var qn = m.querySelector("#otc-q");
    if (qn) {
      qn.addEventListener("input", function () { keep(); paint(); });
      qn.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); var first = m.querySelector("#otc-res .otc-row"); if (first) first.click(); }
        else if (e.key === "ArrowDown") { var f = m.querySelector(".otc-side .otc-list .otc-row"); if (f) { e.preventDefault(); f.focus(); } }
      });
    }
  }

  function keep() { var qn = S.mount && S.mount.querySelector("#otc-q"); if (qn) S.q = String(qn.value || ""); }
  function top() { try { if (window.matchMedia("(max-width:900px)").matches) window.scrollTo(0, 0); } catch (e) {} }
  function focusTitle() { setTimeout(function () { var x = S.mount && S.mount.querySelector("#otc-title"); var a = document.activeElement; if (x && !(a && a.id === "otc-q")) x.focus(); }, 30); }

  // Escape: clear the search, else go back one step, else back to its tab
  document.addEventListener("keydown", function (e) {
    if (e.key !== "Escape" || e.defaultPrevented || !S.mount || E.state.activeModuleId !== "otcreg" || !document.body.contains(S.mount)) return;
    if (document.querySelector(".eikon-modal-backdrop, .eikon-modal-overlay, [role=dialog][aria-modal=true]")) return; // a dialog closes first
    var a = document.activeElement;
    if (a && a.id === "otc-q" && a.value) { e.preventDefault(); a.value = ""; S.q = ""; paint(); return; }
    e.preventDefault();
    if (S.stack.length) back(); else window.location.hash = E.ui2BackHash("otcreg");
  });

  E.registerModule({
    id: "otcreg", title: "Over the counter", order: 3, icon: "✚", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.stack = []; S.q = ""; S.more = {}; S.opening = ""; S.openErr = ""; css(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("otcreg") < 0) E.UI2_DESTINATIONS.push("otcreg");
  if (E.UI2_PARENT) E.UI2_PARENT.otcreg = "services";
})();
