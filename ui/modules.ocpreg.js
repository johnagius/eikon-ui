/* Contraceptive pills (OCP finder), new layout: a fast lookup, not a register. The classic screen stores nothing and
   calls no endpoint: it filters a fixed list of 21 pills by estrogen type and dose and progestogen type and dose (mg or
   mcg, a dose matching within 1.5%, a multiphasic pill passing any dose), and prints the results. This screen keeps
   that list word for word and the same matching, filters as you type, adds a name search and "progestogen only", and
   one tap on a pill shows the pills with the same hormones and doses. Printing stays in the classic finder.
   No request is made, so nothing here can change any data. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // The classic finder's list (modules.ocps.js OCP_DATA), copied exactly. Doses in mg; a multiphasic pill has text ranges.
  var OCP_DATA = [
    { trade: "Adele",        estrogen: "Ethinylestradiol",  estrogenDose: 0.03,    progestogen: "Desogestrel",          progestogenDose: 0.15  },
    { trade: "Cilest",       estrogen: "Ethinylestradiol",  estrogenDose: 0.035,   progestogen: "Norgestimate",          progestogenDose: 0.25  },
    { trade: "Clairette",    estrogen: "Ethinylestradiol",  estrogenDose: 0.035,   progestogen: "Cyproterone acetate",   progestogenDose: 2     },
    { trade: "Desogestrel (generic)",    estrogen: null,   estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Desogestrel Biogaran",     estrogen: null,   estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Desogestrel Rowex",        estrogen: null,   estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Drovelis",     estrogen: "Estetrol",          estrogenDose: 14.2,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Freedonel",    estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Katya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.03,    progestogen: "Gestodene",             progestogenDose: 0.075 },
    { trade: "Lamya",        estrogen: null,                estrogenDose: null,    progestogen: "Desogestrel",          progestogenDose: 0.075 },
    { trade: "Levonorgestrel/EE 0.10/0.02 mg",  estrogen: "Ethinylestradiol", estrogenDose: 0.02,  progestogen: "Levonorgestrel", progestogenDose: 0.1  },
    { trade: "Levonorgestrel/EE 0.15/0.03 mg",  estrogen: "Ethinylestradiol", estrogenDose: 0.03,  progestogen: "Levonorgestrel", progestogenDose: 0.15 },
    { trade: "Mercilon",     estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Desogestrel",          progestogenDose: 0.15  },
    { trade: "Nelya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.015,   progestogen: "Gestodene",             progestogenDose: 0.06  },
    { trade: "Qlaira",       estrogen: "Estradiol valerate",estrogenDose: "1–3",   progestogen: "Dienogest",             progestogenDose: "2–3", multiphasic: true },
    { trade: "Sunya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Gestodene",             progestogenDose: 0.075 },
    { trade: "Vreya",        estrogen: "Ethinylestradiol",  estrogenDose: 0.035,   progestogen: "Cyproterone acetate",   progestogenDose: 2     },
    { trade: "Yasmin",       estrogen: "Ethinylestradiol",  estrogenDose: 0.03,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Yasminelle",   estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Yaz",          estrogen: "Ethinylestradiol",  estrogenDose: 0.02,    progestogen: "Drospirenone",          progestogenDose: 3     },
    { trade: "Zoely",        estrogen: "Estradiol",         estrogenDose: 1.5,     progestogen: "Nomegestrol acetate",   progestogenDose: 2.5   }
  ];
  var ESTROGENS = uniq(OCP_DATA.map(function (d) { return d.estrogen; }));
  var PROGESTOGENS = uniq(OCP_DATA.map(function (d) { return d.progestogen; }));
  var NONE = "__none"; // estrogen "none": the progestogen-only pills

  var S = { mount: null, q: "", e: "", ed: "", eu: "mg", p: "", pd: "", pu: "mg", like: "" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s == null ? "" : s).toLowerCase(); }
  function uniq(a) { var seen = {}, out = []; a.forEach(function (x) { if (x && !seen[x]) { seen[x] = 1; out.push(x); } }); return out.sort(); }

  // The classic finder's rules, unchanged: a typed dose in the chosen unit, compared within 1.5%.
  function parseDoseMg(raw, unit) {
    var s = String(raw || "").trim().replace(",", ".");
    if (!s) return null;
    var n = parseFloat(s);
    if (!isFinite(n) || n <= 0) return null;
    return unit === "mcg" ? n / 1000 : n;
  }
  function approxEqual(a, b) {
    if (a == null || b == null || typeof a !== "number" || typeof b !== "number") return false;
    return Math.abs(a - b) <= Math.max(a, b) * 0.015;
  }
  // As the classic shows a dose (under 0.1 mg in mcg), without a trailing ".0": 30 mcg, 0.15 mg, 14.2 mg; ranges as typed.
  function dose(mg) {
    if (mg == null) return "";
    if (typeof mg === "string") return mg + " mg";
    if (mg < 0.1) return String(parseFloat((mg * 1000).toFixed(mg * 1000 < 10 ? 2 : 1))) + " mcg";
    return mg + " mg";
  }

  function matches(pill, f) {
    var eDose = parseDoseMg(f.ed, f.eu), pDose = parseDoseMg(f.pd, f.pu);
    if (f.e === NONE) { if (pill.estrogen) return false; }
    else if (f.e) { if (!pill.estrogen || low(pill.estrogen) !== low(f.e)) return false; }
    if (eDose != null && !pill.multiphasic && !approxEqual(pill.estrogenDose, eDose)) return false;
    if (f.p) { if (!pill.progestogen || low(pill.progestogen) !== low(f.p)) return false; }
    if (pDose != null && !pill.multiphasic && !approxEqual(pill.progestogenDose, pDose)) return false;
    var q = low(f.q).trim();
    if (q && [pill.trade, pill.estrogen || "progestogen only", pill.progestogen].join(" ").toLowerCase().indexOf(q) < 0) return false;
    return true;
  }
  function filtersOf(pill) { // this pill's own hormones and doses, as the filters
    var num = function (v) { return typeof v === "number" ? String(v) : ""; };
    return { q: "", e: pill.estrogen || NONE, ed: num(pill.estrogenDose), eu: "mg", p: pill.progestogen || "", pd: num(pill.progestogenDose), pu: "mg" };
  }
  function sameAs(pill) { var f = filtersOf(pill); return OCP_DATA.filter(function (x) { return x !== pill && matches(x, f); }); }
  function active() { return !!(S.q.trim() || S.e || S.ed.trim() || S.p || S.pd.trim()); }

  function css() {
    if (document.getElementById("eikon-ocpreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-ocpreg-css";
    st.textContent =
      ".ocp{max-width:880px;margin:0 auto}" +
      ".ocp-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".ocp-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".ocp h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.ocp-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".ocp-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".ocp-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".ocp-find{display:flex;align-items:center;gap:8px;margin-top:16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:0 12px}" +
      ".ocp-find input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:11px 0}" +
      ".ocp-find:focus-within{border-color:var(--accent);box-shadow:0 0 0 2px var(--accent)}" +
      ".ocp-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:12px}" +
      ".ocp-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:4px 0;min-width:0}" +
      ".ocp-form .hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);padding:10px 14px 4px}" +
      ".ocp-form label,.ocp-form .row{display:flex;align-items:center;gap:10px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border);min-width:0}" +
      ".ocp-form label:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      ".ocp-form label>span,.ocp-form .row>span{flex:0 0 52px;font-size:15px}" +
      ".ocp-form input,.ocp-form select{flex:1;min-width:0;width:100%;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0;text-overflow:ellipsis}" +
      ".ocp-form select option{color:#111;background:#fff}" +
      ".ocp-unit{display:flex;flex:0 0 auto;border:1px solid var(--border);border-radius:9px;overflow:hidden}" +
      ".ocp-unit button{font:inherit;font-size:13.5px;font-weight:600;min-width:44px;min-height:32px;border:0;background:transparent;color:var(--text);cursor:pointer;padding:0 8px}" +
      ".ocp-unit button.on{background:var(--accent);color:#fff}" +
      ".ocp-unit button:focus-visible{outline-offset:-3px}" +
      ".ocp-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px;align-items:center;flex-wrap:wrap}.ocp-lab b{color:var(--text)}" +
      ".ocp-lab .ocp-clear{margin-left:auto;text-transform:none;letter-spacing:0;font-size:14px;font-weight:600;border:0;background:none;color:var(--accent);cursor:pointer;padding:4px 2px}" +
      ".ocp-like{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 14px;margin-top:14px;font-size:14px;overflow-wrap:anywhere}.ocp-like b{font-weight:600}" +
      ".ocp-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".ocp-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-top:.5px solid var(--border);padding:10px 16px;min-height:52px;cursor:pointer}" +
      ".ocp-list>.ocp-row:first-child{border-top:0}.ocp-row:hover{background:rgba(118,118,128,.06)}.ocp-row:focus-visible{outline-offset:-3px}" +
      ".ocp-row .t{flex:1;min-width:0}.ocp-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}" +
      ".ocp-row span{display:block;font-size:13px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".ocp-row .f{display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex:0 1 auto;max-width:42%}" +
      ".ocp-flag{font-style:normal;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap;background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".ocp-flag.m{background:rgba(127,127,127,.14);color:var(--text)}" +
      ".ocp-row i{font-style:normal;font-size:12.5px;color:var(--accent);font-weight:600;white-space:nowrap}" +
      ".ocp-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted)}" +
      ".ocp-note{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}.ocp-note a{color:var(--accent)}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .ocp-unit button.on,html[data-ui2]:not([data-ui2-visit]) .ocp-btn.p{color:#00160E}}" +
      "@media (max-width:600px){.ocp{padding:4px 16px 0}.ocp h1{font-size:32px}.ocp-grid{grid-template-columns:minmax(0,1fr)}.ocp-row{padding:10px 14px}}";
    document.head.appendChild(st);
  }

  function rowHtml(pill) {
    var n = sameAs(pill).length;
    var eLine = pill.estrogen ? pill.estrogen + " " + dose(pill.estrogenDose) : "Progestogen only";
    return '<button type="button" class="ocp-row" data-trade="' + esc(pill.trade) + '"><div class="t"><b>' + esc(pill.trade) + "</b>" +
      "<span>" + esc(eLine) + "</span><span>" + esc(pill.progestogen + " " + dose(pill.progestogenDose)) + "</span></div>" +
      '<div class="f">' + (pill.multiphasic ? '<em class="ocp-flag m">Multiphasic</em>' : "") +
      (n ? "<i>Same as " + n + "</i>" : "") + "</div></button>";
  }

  function opts(list, cur, anyLabel, extra) {
    return '<option value="">' + esc(anyLabel) + "</option>" + (extra || "") + list.map(function (v) { return '<option value="' + esc(v) + '"' + (v === cur ? " selected" : "") + ">" + esc(v) + "</option>"; }).join("");
  }
  function unitHtml(k, cur, label) {
    return '<div class="ocp-unit" role="group" aria-label="' + esc(label) + '">' + ["mg", "mcg"].map(function (u) {
      return '<button type="button" data-unit="' + k + '" data-u="' + u + '" aria-pressed="' + (u === cur) + '"' + (u === cur ? ' class="on"' : "") + ">" + u + "</button>";
    }).join("") + "</div>";
  }

  // The page is drawn once; typing only redraws the results, so the field being typed in is never replaced.
  function paint() {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "ocpreg") return; // left already: do not draw over the next screen
    var h = '<div class="ocp"><button class="ocp-back" data-act="back">‹ Registers</button>' +
      '<div class="ocp-top"><div><h1>Contraceptive pills</h1><p class="ocp-sub">Find a pill by its hormones and doses. ' + OCP_DATA.length + " pills listed.</p></div></div>" +
      '<div class="ocp-find"><input id="ocp-q" type="search" placeholder="Search a brand or hormone" aria-label="Search a brand or hormone" autocomplete="off" value="' + esc(S.q) + '"></div>' +
      '<div class="ocp-grid">' +
      '<div class="ocp-form" role="group" aria-labelledby="ocp-hd-e"><div class="hd" id="ocp-hd-e">Estrogen</div>' +
      '<label><span>Type</span><select id="ocp-e" aria-label="Estrogen type">' + opts(ESTROGENS, S.e, "Any estrogen", '<option value="' + NONE + '"' + (S.e === NONE ? " selected" : "") + ">None (progestogen only)</option>") + "</select></label>" +
      '<label><span>Dose</span><input id="ocp-ed" inputmode="decimal" aria-label="Estrogen dose" placeholder="Any dose" autocomplete="off" value="' + esc(S.ed) + '">' + unitHtml("e", S.eu, "Estrogen dose unit") + "</label></div>" +
      '<div class="ocp-form" role="group" aria-labelledby="ocp-hd-p"><div class="hd" id="ocp-hd-p">Progestogen</div>' +
      '<label><span>Type</span><select id="ocp-p" aria-label="Progestogen type">' + opts(PROGESTOGENS, S.p, "Any progestogen") + "</select></label>" +
      '<label><span>Dose</span><input id="ocp-pd" inputmode="decimal" aria-label="Progestogen dose" placeholder="Any dose" autocomplete="off" value="' + esc(S.pd) + '">' + unitHtml("p", S.pu, "Progestogen dose unit") + "</label></div>" +
      "</div>" +
      '<div id="ocp-res" aria-live="polite"></div>' +
      '<p class="ocp-note">A dose matches within 1.5%; a multiphasic pill matches any dose of its hormones. To print the results, use the <a href="#" data-act="classic">classic finder</a>.</p></div>';
    m.innerHTML = h;
    m.querySelector("[data-act=back]").addEventListener("click", function () { window.location.hash = "#registers"; });
    m.querySelector("[data-act=classic]").addEventListener("click", function (ev) { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "ocpreg"); } catch (x) {} E.openClassic("ocps"); });
    var bind = function (sel, key, evn) { var el = m.querySelector(sel); el.addEventListener(evn, function () { S[key] = el.value; S.like = ""; results(); }); };
    bind("#ocp-q", "q", "input"); bind("#ocp-ed", "ed", "input"); bind("#ocp-pd", "pd", "input"); bind("#ocp-e", "e", "change"); bind("#ocp-p", "p", "change");
    m.querySelectorAll("[data-unit]").forEach(function (b) {
      b.addEventListener("click", function () {
        S[b.getAttribute("data-unit") + "u"] = b.getAttribute("data-u"); S.like = "";
        b.parentNode.querySelectorAll("button").forEach(function (x) { var on = x === b; x.classList.toggle("on", on); x.setAttribute("aria-pressed", String(on)); });
        results();
      });
    });
    var res = m.querySelector("#ocp-res");
    res.addEventListener("click", function (ev) {
      var r = ev.target.closest && ev.target.closest(".ocp-row"), c = ev.target.closest && ev.target.closest("[data-act=clear]");
      if (c) { setFilters({ q: "", e: "", ed: "", eu: "mg", p: "", pd: "", pu: "mg" }, ""); var q = m.querySelector("#ocp-q"); if (q) q.focus(); return; }
      if (!r) return;
      var pill = OCP_DATA.filter(function (x) { return x.trade === r.getAttribute("data-trade"); })[0]; if (!pill) return;
      setFilters(filtersOf(pill), pill.trade);
      var lk = m.querySelector(".ocp-like"); if (lk) { try { lk.scrollIntoView({ block: "nearest", behavior: "smooth" }); } catch (x) {} }
    });
    results();
  }
  function setFilters(f, like) {
    Object.keys(f).forEach(function (k) { S[k] = f[k]; }); S.like = like || "";
    var m = S.mount; if (!m) return;
    m.querySelector("#ocp-q").value = S.q; m.querySelector("#ocp-e").value = S.e; m.querySelector("#ocp-ed").value = S.ed;
    m.querySelector("#ocp-p").value = S.p; m.querySelector("#ocp-pd").value = S.pd;
    m.querySelectorAll("[data-unit]").forEach(function (b) { var on = S[b.getAttribute("data-unit") + "u"] === b.getAttribute("data-u"); b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
    results();
  }
  function results() {
    var m = S.mount, box = m && m.querySelector("#ocp-res"); if (!box) return;
    var f = { q: S.q, e: S.e, ed: S.ed, eu: S.eu, p: S.p, pd: S.pd, pu: S.pu };
    var list = OCP_DATA.filter(function (x) { return matches(x, f); }), h = "";
    if (S.like) {
      var others = list.filter(function (x) { return x.trade !== S.like; });
      h += '<div class="ocp-like">' + (others.length ? "Same hormones and doses as <b>" + esc(S.like) + "</b>: " + others.length + (others.length === 1 ? " other pill." : " other pills.") : "No other pill listed has the same hormones and doses as <b>" + esc(S.like) + "</b>.") + "</div>";
    }
    var badDose = (S.ed.trim() && parseDoseMg(S.ed, S.eu) == null) || (S.pd.trim() && parseDoseMg(S.pd, S.pu) == null);
    h += '<div class="ocp-lab">' + (active() ? "Matching" : "All pills") + " <b>" + list.length + "</b>" + (active() ? '<button type="button" class="ocp-clear" data-act="clear">Clear</button>' : "") + "</div>";
    if (badDose) h += '<div class="ocp-quiet" style="margin-bottom:10px">A dose is a number, such as 0.03 mg or 30 mcg. The dose typed is left out.</div>';
    h += list.length ? '<div class="ocp-list">' + list.map(rowHtml).join("") + "</div>" : '<div class="ocp-quiet">No pill listed matches. Try another dose or unit (30 mcg is 0.03 mg), or clear a filter.</div>';
    box.innerHTML = h;
  }

  E.registerModule({
    id: "ocpreg", title: "Contraceptive pills", order: 3, icon: "💊", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.q = ""; S.e = ""; S.ed = ""; S.eu = "mg"; S.p = ""; S.pd = ""; S.pu = "mg"; S.like = ""; css(); paint(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("ocpreg") < 0) E.UI2_DESTINATIONS.push("ocpreg");
  if (E.UI2_PARENT) E.UI2_PARENT.ocpreg = "registers";
})();
