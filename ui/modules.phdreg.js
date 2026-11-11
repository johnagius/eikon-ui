/* Pharmacy details (Settings › This pharmacy), new layout. FIN-dayzero (W10).
   The pharmacy's name as printed, its address, phone and registration no.: what every label and print shows at the top.
   One read when the screen opens (GET /pharmacy/details: one row), one save (PUT /pharmacy/details, admin only). They are
   stored where the label screens already keep them (label_settings.pharmacyDetails: name, address, phone, licence), so the
   classic Smart Labels, the new Labels and any print read the same values. Staff see them and are told who changes them.
   E.pharmacyDetails() gives the saved details to any screen that prints (one read per page, kept in memory, refreshed
   after a save here): { name, address, phone, licence }. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var ID = "phdreg";
  var FIELDS = [
    { k: "name", label: "Name", hint: "As it should read on a label.", max: 120, auto: "organization" },
    { k: "address", label: "Address", hint: "Street, town and post code.", max: 300, auto: "street-address", area: true },
    { k: "phone", label: "Phone", hint: "", max: 60, auto: "tel", mode: "tel" },
    { k: "licence", label: "Registration no.", hint: "The pharmacy's licence or registration number.", max: 60, auto: "off" }
  ];
  var S = { mount: null, d: null, loaded: false, loading: false, error: "", saving: false, fe: {}, msg: "", typed: null };

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function isAdmin() { var u = E.state.user; return !!(u && u.role === "admin"); }
  function here() { return E.state.activeModuleId === ID; }
  function locName() { return String((E.state.user && E.state.user.location_name) || "").trim(); }

  // ---- the saved details for any screen that prints (labels, prints): one read per page ----
  var cache = { loc: "", at: 0, d: null, job: null };
  function locId() { return String((E.state.user && E.state.user.location_id) || ""); }
  E.pharmacyDetails = function (force) {
    if (!force && cache.d && cache.loc === locId()) return Promise.resolve(cache.d);
    if (cache.job) return cache.job;
    var loc = locId();
    cache.job = E.apiFetch("/pharmacy/details", { method: "GET", timeoutMs: 12000 }).then(function (r) {
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the pharmacy's details");
      if (E.noteStart && r.since) E.noteStart(r.since);
      cache.d = r.details || {}; cache.loc = loc; cache.at = Date.now(); return cache.d;
    }).finally(function () { cache.job = null; });
    return cache.job;
  };
  // One line for the top of a print: "12, Triq il-Kbira, Ħamrun · Tel 2123 4567"
  E.pharmacyLine = function (d) {
    d = d || {}; var bits = [];
    if (d.address) bits.push(String(d.address).trim());
    if (d.phone) bits.push("Tel " + String(d.phone).trim());
    return bits.join(" · ");
  };

  function css() {
    if (document.getElementById("eikon-phd-css")) return;
    var st = document.createElement("style"); st.id = "eikon-phd-css";
    st.textContent =
      ".phd{max-width:720px;margin:0 auto}" +
      ".phd-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;min-height:44px;padding:0 12px 0 0;margin:-8px 0 -6px;cursor:pointer}" +
      ".phd h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.phd-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;line-height:1.45}" +
      ".phd-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;margin-top:18px;overflow:hidden}" +
      ".phd-f{display:grid;grid-template-columns:150px 1fr;gap:4px 14px;align-items:start;padding:12px 16px;border-top:.5px solid var(--border)}.phd-f:first-child{border-top:0}" +
      ".phd-f label{font-size:15px;font-weight:600;padding-top:10px}.phd-f small{display:block;font-size:12.5px;color:var(--muted);margin-top:4px;line-height:1.4}" +
      ".phd-f input,.phd-f textarea{width:100%;box-sizing:border-box;font:inherit;font-size:16px;color:var(--text);background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:10px 12px;min-height:44px}" +
      ".phd-f textarea{min-height:68px;resize:vertical;line-height:1.4}.phd-f [aria-invalid=true]{border-color:var(--danger)}" +
      ".phd-f input:focus-visible,.phd-f textarea:focus-visible{outline:2px solid var(--accent);outline-offset:1px}" +
      ".phd-ferr{display:block;color:var(--danger);font-size:13px;font-weight:600;margin-top:4px}" +
      ".phd-acts{display:flex;align-items:center;justify-content:flex-end;gap:12px;padding:12px 16px;border-top:.5px solid var(--border);flex-wrap:wrap}" +
      ".phd-msg{flex:1 1 200px;font-size:14px;color:var(--muted)}.phd-msg.bad{color:var(--danger);font-weight:600}.phd-msg:empty{display:none}" +
      ".phd-btn{font:inherit;font-size:15px;font-weight:600;min-height:44px;padding:0 20px;border-radius:22px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer}" +
      ".phd-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.phd-btn:disabled{opacity:.6;cursor:default}.phd-btn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".phd-prev{margin-top:22px}.phd-prev h2{font-size:13px;font-weight:600;color:var(--muted);margin:0 2px 8px}" +
      ".phd-label{background:#fff;color:#111;border:1px solid #c9c9cf;border-radius:8px;padding:12px 14px;max-width:360px;font-family:Arial,Helvetica,sans-serif;box-shadow:0 1px 2px rgba(0,0,0,.06)}" +
      ".phd-label b{display:block;font-size:15px}.phd-label span{display:block;font-size:12px;color:#333;margin-top:2px;overflow-wrap:anywhere}.phd-label i{display:block;font-style:normal;font-size:12px;color:#555;border-top:1px dashed #bbb;margin-top:8px;padding-top:6px}" +
      ".phd-ro{background:var(--panel2);border:1px solid var(--border);border-radius:14px;margin-top:18px}.phd-ro div{display:grid;grid-template-columns:150px 1fr;gap:14px;padding:12px 16px;border-top:.5px solid var(--border);font-size:15px}.phd-ro div:first-child{border-top:0}.phd-ro dt{font-weight:600}.phd-ro dd{margin:0;overflow-wrap:anywhere}" +
      ".phd-quiet{color:var(--muted);font-size:14px;margin:12px 2px 0;line-height:1.5}" +
      ".phd-sk{height:56px;border-top:.5px solid var(--border)}.phd-sk:first-child{border-top:0}.phd-sk i{display:block;height:12px;border-radius:6px;background:rgba(118,118,128,.14);margin:22px 16px 0;width:45%}" +
      "@media (max-width:600px){.phd{padding:4px 16px 0}.phd h1{font-size:28px}.phd-f,.phd-ro div{grid-template-columns:1fr;gap:2px}.phd-f label{padding-top:2px}.phd-acts .phd-btn{flex:1 1 auto}}";
    document.head.appendChild(st);
  }

  function val(k) { return S.typed && S.typed[k] != null ? S.typed[k] : (S.d && S.d[k] != null ? S.d[k] : ""); }
  function field(f) {
    var v = val(f.k), bad = S.fe[f.k], desc = (f.hint ? "phd-h-" + f.k : "") + (bad ? " phd-e-" + f.k : "");
    var attrs = ' id="phd-' + f.k + '" name="' + f.k + '" maxlength="' + f.max + '" autocomplete="' + f.auto + '"' + (f.mode ? ' inputmode="' + f.mode + '"' : "") + (desc.trim() ? ' aria-describedby="' + desc.trim() + '"' : "") + (bad ? ' aria-invalid="true"' : "") + (f.k === "name" ? " required" : "");
    return '<div class="phd-f"><label for="phd-' + f.k + '">' + esc(f.label) + "</label><div>" +
      (f.area ? "<textarea" + attrs + ' rows="2">' + esc(v) + "</textarea>" : '<input type="text"' + attrs + ' value="' + esc(v) + '">') +
      (f.hint ? '<small id="phd-h-' + f.k + '">' + esc(f.hint) + "</small>" : "") + (bad ? '<span class="phd-ferr" id="phd-e-' + f.k + '" role="alert">' + esc(bad) + "</span>" : "") + "</div></div>";
  }
  function preview(d) {
    var line = E.pharmacyLine(d);
    return '<section class="phd-prev" aria-labelledby="phd-prev-h"><h2 id="phd-prev-h">How the top of a label reads</h2><div class="phd-label" aria-hidden="true"><b>' + esc(d.name || locName() || "Pharmacy") + "</b>" +
      (line ? "<span>" + esc(line) + "</span>" : "<span>Add the address and phone above.</span>") + (d.licence ? "<span>Reg. no. " + esc(d.licence) + "</span>" : "") +
      "<i>Amoxicillin 500 mg capsules · 1 three times a day</i></div></section>";
  }
  function typedNow() { var m = S.mount, o = {}; if (!m || !m.querySelector("#phd-form")) return null; FIELDS.forEach(function (f) { var el = m.querySelector('[name="' + f.k + '"]'); if (el) o[f.k] = el.value; }); return o; }

  function paint() {
    var m = S.mount; if (!m || !here()) return;
    if (S.loaded && isAdmin()) S.typed = typedNow() || S.typed;
    var focusId = document.activeElement && m.contains(document.activeElement) ? document.activeElement.id : "";
    var h = '<div class="phd"><button class="phd-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel(ID) : "‹ Settings") + "</button><h1>Pharmacy details</h1>" +
      '<p class="phd-sub">Printed at the top of every label and print. Only this pharmacy uses them.</p>';
    if (!S.loaded && S.error) {
      h += '<div class="phd-ro" role="alert" style="padding:14px 16px;display:flex;gap:12px;align-items:center;justify-content:space-between;flex-wrap:wrap"><span>' + esc(S.error) + '</span><button class="phd-btn" data-act="retry">Try again</button></div>';
    } else if (!S.loaded) {
      h += '<div class="phd-form" aria-busy="true" aria-label="Loading the pharmacy\'s details"><div class="phd-sk"><i></i></div><div class="phd-sk"><i></i></div><div class="phd-sk"><i></i></div></div>';
    } else if (!isAdmin()) {
      var d0 = S.d || {};
      h += '<dl class="phd-ro">' + FIELDS.map(function (f) { return "<div><dt>" + esc(f.label) + "</dt><dd>" + (d0[f.k] ? esc(d0[f.k]) : '<span style="color:var(--muted)">Not given yet</span>') + "</dd></div>"; }).join("") + "</dl>" +
        '<p class="phd-quiet">The pharmacy\'s admin changes these.</p>' + preview(d0);
    } else {
      h += '<form class="phd-form" id="phd-form" novalidate autocomplete="on">' + FIELDS.map(field).join("") +
        '<div class="phd-acts"><p class="phd-msg' + (S.msgBad ? " bad" : "") + '" id="phd-msg" role="status" aria-live="polite">' + esc(S.msg) + '</p><button type="submit" class="phd-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save") + "</button></div></form>" +
        preview(S.typed || S.d || {});
    }
    m.innerHTML = h + "</div>";
    bind();
    if (focusId) { var f = m.querySelector("#" + focusId); if (f) f.focus({ preventScroll: true }); }
  }
  function bind() {
    var m = S.mount; if (!m) return;
    var b = m.querySelector('[data-act="back"]'); if (b) b.addEventListener("click", function () { window.location.hash = E.ui2BackHash ? E.ui2BackHash(ID) : "#settings"; });
    var rt = m.querySelector('[data-act="retry"]'); if (rt) rt.addEventListener("click", function () { rt.disabled = true; load(); });
    var f = m.querySelector("#phd-form"); if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); save(); });
    f.addEventListener("input", function () { // the preview follows the typing; nothing else redraws
      S.typed = typedNow(); var p = m.querySelector(".phd-prev"); if (p) p.outerHTML = preview(S.typed);
      if (S.msg && !S.saving) { S.msg = ""; S.msgBad = false; var mg = m.querySelector("#phd-msg"); if (mg) { mg.textContent = ""; mg.className = "phd-msg"; } }
    });
  }

  async function load() {
    S.loading = true; S.error = ""; paint();
    try {
      var d = await E.pharmacyDetails(true);
      S.d = Object.assign({}, d); if (!S.d.name) S.d.name = locName(); // the name the pharmacy was set up with, until one is saved
      S.loaded = true; S.typed = null;
    } catch (e) { S.error = e && e.network ? "No connection, so the details could not be read." : e && e.status === 404 ? "This needs the next Eikon server update." : "The details could not be read."; }
    S.loading = false; paint();
    if (S.loaded && isAdmin() && E.focusSoon) E.focusSoon(function () { var n = S.mount && S.mount.querySelector(S.d && S.d.address ? "#phd-name" : "#phd-address"); return n; });
  }

  async function save() {
    if (S.saving) return;
    var v = typedNow() || {}, body = {}, fe = {};
    FIELDS.forEach(function (f) { body[f.k] = String(v[f.k] || "").replace(/\s+/g, " ").trim(); if (body[f.k].length > f.max) fe[f.k] = "At most " + f.max + " characters."; });
    if (!body.name) fe.name = "Write the pharmacy's name, as it should read on a label.";
    S.fe = fe; S.typed = v;
    if (Object.keys(fe).length) { S.msg = ""; paint(); var first = S.mount.querySelector('[aria-invalid="true"]'); if (first) first.focus(); return; }
    S.saving = true; S.msg = ""; S.msgBad = false; paint();
    try {
      var r = await E.apiFetch("/pharmacy/details", { method: "PUT", body: JSON.stringify(body) });
      if (!r || !r.ok) { var er = new Error((r && r.error) || "Not saved"); er.fields = r && r.fields; throw er; }
      S.d = Object.assign({}, r.details); S.typed = null; cache.d = Object.assign({}, r.details); cache.loc = locId();
      E.lastWriteAt = Date.now();
      S.saving = false; S.msg = "Saved. Labels and prints use these from now on."; paint();
      if (E.toast) E.toast("Pharmacy details saved", "success");
    } catch (x) {
      S.saving = false;
      if (x && Array.isArray(x.fields)) x.fields.forEach(function (k) { S.fe[k] = x.message; });
      S.msg = E.saveFailText ? E.saveFailText(x) : "Not saved: " + String((x && x.message) || x); S.msgBad = true; paint();
    }
  }

  async function render(ctx) {
    S.mount = ctx && ctx.mount; S.fe = {}; S.msg = ""; S.msgBad = false; S.saving = false; S.loaded = false; S.typed = null;
    css(); paint(); await load();
  }
  function destroy() { S.typed = null; }

  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf(ID) < 0) E.UI2_DESTINATIONS.push(ID);
  E.registerModule({ id: ID, title: "Pharmacy details", order: 3, icon: "⌂", ui2Only: true, render: render, destroy: destroy });
})();
