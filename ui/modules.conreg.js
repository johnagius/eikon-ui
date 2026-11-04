/* Contacts, new layout: everyone the pharmacy calls in one list (suppliers, reps, doctors, specialists, locums, head
   office, our pharmacies, POYC, clients) plus the emergency numbers and 24/7 health centres. Search as you type (a
   name, a number with or without spaces, an email), call or email with one tap, add a contact, change one.
   Same endpoints and the same visibility as the classic screen: every list is the group's (org), clients are this
   pharmacy's only, and clients found in the registers are shown but not changed here. A change sends the whole record
   (the server replaces every field), after reading it again so another person's change is never overwritten blindly.
   Deleting, import, export, hiding sections and the specialty filter stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // One entry per server table, in the order the classic screen shows them. Labels are the new screen's words.
  var TYPES = [
    { key: "suppliers", one: "Supplier", many: "Suppliers", cols: ["name", "phone", "email"] },
    { key: "medreps", one: "Medical rep", many: "Medical reps", cols: ["name", "phone", "email"] },
    { key: "doctors", one: "Doctor", many: "Doctors", cols: ["name", "phone_personal", "phone_patient"] },
    { key: "specialists", one: "Specialist", many: "Specialists", cols: ["name", "specialty", "phone_personal", "phone_patient"] },
    { key: "locums", one: "Locum", many: "Locums", cols: ["name", "phone"] },
    { key: "headoffice", one: "Head office", many: "Head office", cols: ["name", "phone"], nameLabel: "Office" },
    { key: "orgpharmacies", one: "Our pharmacy", many: "Our pharmacies", cols: ["name", "phone"], nameLabel: "Pharmacy" },
    { key: "poyc", one: "POYC", many: "POYC", cols: ["name", "phone"], nameLabel: "Person or office" },
    { key: "clients", one: "Client", many: "Clients", cols: ["name", "id_card", "address", "phone", "alt_phone"], local: true }
  ];
  var TYPE = {}; TYPES.forEach(function (t) { TYPE[t.key] = t; });
  var LABEL = { name: "Name", phone: "Phone", email: "Email", phone_personal: "Personal no.", phone_patient: "For patients", specialty: "Specialty", id_card: "ID card", address: "Address", alt_phone: "Other phone" };
  var HINT = { phone: "e.g. 2123 4567", email: "name@example.com", phone_personal: "Not for patients", phone_patient: "Safe to give out", id_card: "e.g. 123456M" };
  var INPUT = { phone: ' type="tel" inputmode="tel"', alt_phone: ' type="tel" inputmode="tel"', phone_personal: ' type="tel" inputmode="tel"', phone_patient: ' type="tel" inputmode="tel"', email: ' type="email" inputmode="email" autocapitalize="off"', id_card: ' autocapitalize="characters"' };

  // The same fixed numbers the classic screen shows; read only.
  var EMERGENCY = [
    { name: "All emergencies", phone: "112", note: "Police, ambulance, fire" },
    { name: "Police (General HQ)", phone: "2122 4001", note: "Lines 2122 4001 – 4007" },
    { name: "Civil Protection (CPD)", phone: "2393 0000", note: "Fire and rescue" },
    { name: "Urgent non-emergency care", phone: "1400", note: "Helpline" },
    { name: "Mater Dei Hospital", phone: "2545 0000", note: "Malta" },
    { name: "Gozo General Hospital", phone: "2156 1600", note: "Gozo" },
    { name: "Floriana Health Centre", phone: "2124 3314", note: "24/7. Frangisk Saver Fenech Road, Floriana. Covers Cospicua, Vittoriosa, Senglea, Kalkara." },
    { name: "Mosta Health Centre", phone: "2143 3256 / 2143 2062", note: "24/7. Rotunda Square, Mosta. Covers Rabat, Mdina, Dingli, Attard, Bidnija, Kuncizzjoni." },
    { name: "Paola Health Centre", phone: "2169 1314 / 2169 1315", note: "24/7. Antoine De Paule Square, Paola. Covers Paola, Tarxien, Santa Lucia, Birzebbuga, Zejtun, Marsaxlokk, Zabbar, Marsascala, Xghajra, Fgura, Gudja, Ghaxaq." },
    { name: "Primary HealthCare call centre", phone: "2123 1231", note: "Appointments and information for all health centres." }
  ];

  // The classic screen's specialty list (the short names it stores).
  var SPECIALTIES = ["Allergy & Immunology", "Anaesthesiology", "Andrology", "Cardiology", "Cardiac Surgery", "Clinical Genetics", "Clinical Pharmacology", "Colorectal Surgery", "Dentistry", "Dermatology", "Diabetology", "Emergency Medicine", "Endocrinology", "ENT", "Forensic Medicine", "Gastroenterology", "General Practice", "General Surgery", "Geriatrics", "Gynaecology", "Haematology", "Hand Surgery", "Hepatology", "Infectious Disease", "Internal Medicine", "Intensive Care", "Maxillofacial Surgery", "Microbiology", "Neonatology", "Nephrology", "Neurology", "Neurosurgery", "Nuclear Medicine", "Obstetrics", "Obs & Gynae", "Occupational Medicine", "Oncology", "Ophthalmology", "Oral Surgery", "Orthodontics", "Orthopaedics", "Paediatrics", "Paediatric Surgery", "Pain Medicine", "Palliative Care", "Pathology", "Plastic Surgery", "Podiatry", "Psychiatry", "Public Health", "Pulmonology", "Radiology", "Radiotherapy", "Rehabilitation Medicine", "Renal Medicine", "Rheumatology", "Sexual Health", "Sleep Medicine", "Spinal Surgery", "Sports Medicine", "Thoracic Surgery", "Transplant Surgery", "Trauma Surgery", "Urology", "Vascular Surgery"];


  var S = { mount: null, rows: {}, agg: [], failed: [], loading: false, error: "", q: "", filter: "all", sel: null, form: null, saving: false, err: "" };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function low(s) { return String(s || "").toLowerCase(); }
  function digits(s) { return String(s || "").replace(/[^\d]/g, ""); }
  function telHref(n) { return "tel:" + String(n || "").replace(/[^\d+]/g, ""); }
  function tel(n) { // "2143 3256 / 2143 2062" is two numbers
    return String(n || "").split(/\s*\/\s*/).filter(Boolean).map(function (x) { return digits(x) ? '<a href="' + esc(telHref(x)) + '">' + esc(x) + "</a>" : esc(x); }).join(" / ");
  }
  function callNo(t, r) { return r.phone || r.phone_patient || ""; } // a doctor's personal number is not offered from the list

  function css() {
    if (document.getElementById("eikon-conreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-conreg-css";
    st.textContent =
      ".con{max-width:1180px;margin:0 auto}" +
      ".con-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".con-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".con h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.con-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".con-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap;display:inline-flex;align-items:center;text-decoration:none}" +
      ".con-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.con-btn:disabled{opacity:.55;cursor:default}" +
      ".con :focus-visible{outline:2px solid var(--accent);outline-offset:2px}" +
      ".con-grid{display:grid;grid-template-columns:380px minmax(0,1fr);gap:18px;align-items:start;margin-top:16px}.con-side,.con-detail{min-width:0}" +
      ".con-q{width:100%;box-sizing:border-box;height:42px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0}" +
      ".con-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}" +
      ".con-chips button{font:inherit;font-size:13px;font-weight:600;height:30px;padding:0 11px;border-radius:15px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer}" +
      ".con-chips button[aria-pressed=true]{background:var(--text);border-color:var(--text);color:var(--bg,#fff)}" +
      ".con-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:18px 2px 7px;display:flex;gap:8px}.con-lab b{color:var(--text)}" +
      ".con-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".con-row{display:flex;align-items:center;gap:8px;border-top:.5px solid var(--border);padding-right:10px}.con-row:first-child{border-top:0}" +
      ".con-row.on{background:rgba(10,143,106,.08)}" +
      ".con-open{flex:1;min-width:0;display:block;text-align:left;border:0;background:none;font:inherit;color:var(--text);padding:10px 4px 10px 14px;cursor:pointer}" +
      ".con-open b{display:block;font-size:15px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".con-open span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
      ".con-call{flex:none;font-size:13px;font-weight:600;height:30px;padding:0 12px;border-radius:15px;border:1px solid var(--border);color:var(--accent);text-decoration:none;display:inline-flex;align-items:center;background:var(--panel)}" +
      ".con-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:20px;color:var(--muted);font-size:14px;line-height:1.5}" +
      ".con-warn{background:rgba(201,138,18,.14);border:1px solid rgba(201,138,18,.35);color:var(--text);border-radius:10px;padding:8px 12px;font-size:13px;margin-top:12px}" +
      ".con-card{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:18px 20px}" +
      ".con-card h2{font-size:24px;letter-spacing:-.02em;margin:0;line-height:1.15;font-weight:800;overflow-wrap:anywhere}.con-card h2:focus{outline:0}" +
      ".con-meta{display:flex;flex-wrap:wrap;gap:6px 10px;align-items:center;margin-top:6px;font-size:13px;color:var(--muted)}" +
      ".con-pill{font-size:12px;font-weight:600;padding:3px 10px;border-radius:999px;background:rgba(127,127,127,.14);color:var(--text)}" +
      ".con-facts{margin:14px 0 0;padding-top:6px;border-top:1px solid var(--border)}" +
      ".con-facts div{display:grid;grid-template-columns:120px minmax(0,1fr);gap:12px;padding:9px 0;border-top:.5px solid var(--border)}.con-facts div:first-child{border-top:0}" +
      ".con-facts dt{font-size:13px;color:var(--muted)}.con-facts dd{margin:0;font-size:16px;font-weight:600;overflow-wrap:anywhere}" +
      ".con-facts dd a{color:var(--accent)}.con-facts dd a[href^=mailto]{text-decoration:underline;text-underline-offset:2px}" +
      ".con-facts dd small{display:block;font-size:12.5px;font-weight:600;color:var(--danger);margin-top:2px}" +
      ".con-facts dd.note{font-size:14px;font-weight:400;color:var(--text)}" +
      ".con-acts{display:flex;gap:8px;flex-wrap:wrap;margin-top:16px}" +
      ".con-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0}" +
      ".con-form h2{font-size:20px;margin:10px 14px 6px;font-weight:700;letter-spacing:-.01em}" +
      ".con-form label{display:flex;align-items:center;gap:12px;min-height:46px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".con-form label>span{flex:0 0 112px;font-size:15px}.con-form input,.con-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".con-form select option{background:var(--panel);color:var(--text)}" +
      ".con-form .note{font-size:13px;color:var(--muted);padding:8px 14px 0;line-height:1.45}.con-form .acts{display:flex;gap:8px;padding:10px 14px;justify-content:flex-end;flex-wrap:wrap}" +
      ".con-err{color:var(--danger);font-size:13.5px;padding:6px 14px 0;line-height:1.45}" +
      ".con-pick{display:block}.con-dback{display:none}" +
      ".con-foot{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}" +
      "@media (max-width:900px){.con-grid{grid-template-columns:minmax(0,1fr)}.con-pick{display:none}.con.has-sel .con-side,.con.has-sel .con-head{display:none}.con.has-sel .con-grid{margin-top:0}" +
      ".con-dback{display:inline-block;border:0;background:none;color:var(--accent);font:inherit;font-size:16px;font-weight:500;padding:4px 0 12px;cursor:pointer}}" +
      "@media (max-width:600px){.con{padding:4px 16px 0}.con h1{font-size:32px}.con-card{padding:16px}.con-form label>span{flex-basis:96px}.con-facts div{grid-template-columns:104px minmax(0,1fr)}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .con-row.on{background:rgba(43,196,138,.14)}}" +
      // Quality pass (2026-11-03): sentence-case headings, errors beside their fields, a skeleton while loading, 44 px targets
      // on a phone (the type chips become one row that slides sideways, inside the screen).
      ".con-lab{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}.con-lab b,.con-open span,.con-facts dd{font-variant-numeric:tabular-nums}" +
      ".con-form label{flex-wrap:wrap}.con-ferr{flex-basis:100%;margin:-6px 0 8px 124px;color:var(--danger);font-size:13px;font-weight:500}" +
      ".con-skel{display:block;height:56px;border-top:.5px solid var(--border);background:linear-gradient(90deg,rgba(118,118,128,.06),rgba(118,118,128,.14),rgba(118,118,128,.06));background-size:200% 100%;animation:consk 1.2s linear infinite}.con-skel:first-of-type{border-top:0}" +
      "@keyframes consk{to{background-position:-200% 0}}@media (prefers-reduced-motion:reduce){.con-skel{animation:none}}" +
      "@media (prefers-color-scheme:dark){html[data-ui2]:not([data-ui2-visit]) .con-ferr{color:#FF7A72}}" + // 5:1 on the tinted row being typed in
      ".con-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      "@media (max-width:600px){.con-btn{height:44px;border-radius:22px}.con-call{height:44px;border-radius:22px;padding:0 16px}.con-q{height:44px}.con-ferr{margin-left:0}" +
      ".con-chips{flex-wrap:nowrap;overflow-x:auto;-webkit-overflow-scrolling:touch;scrollbar-width:none;margin-left:-16px;margin-right:-16px;padding:0 16px 2px}.con-chips::-webkit-scrollbar{display:none}.con-chips button{height:44px;border-radius:22px;padding:0 14px;flex:none}}" +
      ".con-back{min-height:44px;padding:0 12px 0 0;margin:-8px 0 2px}.con-open{min-height:44px}"; // q5-8: the way back and every row at least 44 px tall
    document.head.appendChild(st);
  }

  /* ---------- data ---------- */
  async function list(key) {
    var r = await E.apiFetch("/contacts/" + key, { method: "GET" });
    if (!r || r.ok === false || !Array.isArray(r.rows)) throw new Error((r && r.error) || "Could not load contacts");
    return r.rows;
  }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var got = await Promise.all(TYPES.map(function (t) { return list(t.key).then(function (rows) { return { ok: true, rows: rows }; }, function (e) { return { ok: false, e: e }; }); })
        .concat([E.apiFetch("/contacts/clients/aggregated", { method: "GET" }).then(function (r) { return { ok: true, rows: (r && Array.isArray(r.rows)) ? r.rows : [] }; }, function () { return { ok: true, rows: [] }; })]));
      var failed = [], firstErr = null;
      TYPES.forEach(function (t, i) { if (got[i].ok) S.rows[t.key] = got[i].rows; else { failed.push(t.many); firstErr = firstErr || got[i].e; if (!S.rows[t.key]) S.rows[t.key] = []; } });
      if (failed.length === TYPES.length) throw firstErr || new Error("Could not load contacts");
      S.failed = failed;
      // Clients found in the registers, minus the ones already saved as contacts (same rule as the classic screen).
      var seen = {}; (S.rows.clients || []).forEach(function (r) { seen[low(r.name) + "|" + low(r.id_card)] = 1; });
      S.agg = got[TYPES.length].rows.filter(function (r) { var k = low(r.name) + "|" + low(r.id_card); if (seen[k] || !String(r.name || "").trim()) return false; seen[k] = 1; return true; });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load contacts"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  /* ---------- the one list ---------- */
  // Every contact as { t: type key, k: unique key, r: row }. Clients from the registers are k "agg:n", fixed numbers "em:n".
  function all() {
    var out = [];
    TYPES.forEach(function (t) { (S.rows[t.key] || []).forEach(function (r) { out.push({ t: t.key, k: t.key + ":" + r.id, r: r }); }); });
    S.agg.forEach(function (r, i) { out.push({ t: "clients", k: "agg:" + i, r: r, agg: true }); });
    EMERGENCY.forEach(function (r, i) { out.push({ t: "emergency", k: "em:" + i, r: r, fixed: true }); });
    return out;
  }
  function find(k) { return all().filter(function (c) { return c.k === k; })[0] || null; }
  function matches(c, q) {
    if (!q) return true;
    var r = c.r, vals = Object.keys(r).filter(function (f) { return f !== "id" && !/_(at|by)$/.test(f) && f !== "org_id" && f !== "location_id"; }).map(function (f) { return r[f]; });
    if (vals.some(function (v) { return low(v).indexOf(q) >= 0; })) return true;
    var dq = digits(q); // "21234567" finds "2123 4567"
    return dq.length >= 3 && /^[\d\s+\-()]+$/.test(q) && vals.some(function (v) { return digits(v).indexOf(dq) >= 0; });
  }
  function sub(c) {
    var r = c.r, bits = [];
    if (c.t === "specialists" && r.specialty) bits.push(r.specialty);
    if (c.t === "clients" && r.id_card) bits.push(r.id_card);
    var n = c.fixed ? r.phone : callNo(c.t, r); if (n) bits.push(n);
    if (r.email) bits.push(r.email);
    if (c.fixed && r.note) bits.push(r.note);
    if (c.agg) bits.push("from the registers");
    if (!bits.length && (r.phone_personal)) bits.push("Personal number only");
    return bits.join(" · ") || "No number yet";
  }
  function rowHtml(c) {
    var n = c.fixed ? String(c.r.phone).split("/")[0].trim() : callNo(c.t, c.r);
    var name = String(c.r.name || "").trim() || "(no name)";
    return '<div class="con-row' + (S.sel === c.k ? " on" : "") + '"><button type="button" class="con-open" data-open="' + esc(c.k) + '"' + (S.sel === c.k ? ' aria-current="true"' : "") + "><b>" + esc(name) + "</b><span>" + esc(sub(c)) + "</span></button>" +
      (n && digits(n) ? '<a class="con-call" href="' + esc(telHref(n)) + '" aria-label="Call ' + esc(name) + '">Call</a>' : "") + "</div>";
  }
  function listHtml() {
    if (S.loading && !Object.keys(S.rows).length) return '<div class="con-list" aria-busy="true" style="margin-top:14px"><span class="con-sr" role="status">Opening contacts</span><i class="con-skel"></i><i class="con-skel"></i><i class="con-skel"></i><i class="con-skel"></i></div>';
    if (S.error) return '<div class="con-quiet" role="alert" style="margin-top:14px">' + esc(S.error) + ' <button type="button" class="con-btn" data-act="retry" style="margin-top:8px">Try again</button></div>';
    var q = low(S.q).trim(), f = S.filter, h = "";
    var items = all().filter(function (c) {
      if (f !== "all" && c.t !== f) return false;
      if (c.agg && f !== "clients" && q.length < 2) return false; // register clients join the list when searched for, or under Clients
      return matches(c, q);
    });
    if (S.failed.length) h += '<div class="con-warn">Could not open ' + esc(S.failed.join(", ")) + '. <button type="button" class="con-btn" data-act="retry" style="height:28px;margin-left:4px">Try again</button></div>';
    if (!items.length) {
      return h + '<div class="con-quiet" style="margin-top:14px">' + (q ? "No contact matches “" + esc(S.q.trim()) + "”." + (f !== "all" ? " Try All." : "") : f === "all" ? "No contacts yet." : "No " + esc((TYPE[f] || {}).many || "contacts").toLowerCase() + " yet.") +
        (f !== "emergency" ? '<br><button type="button" class="con-btn" data-act="add" style="margin-top:10px">Add a contact</button>' : "") + "</div>";
    }
    var groups = TYPES.map(function (t) { return { key: t.key, label: t.many }; }).concat([{ key: "emergency", label: "Emergency and health centres" }]);
    // q5-8: the first 30 contacts (in group order), then "Show 30 more (N left)", instead of 200 at once and "Search to find the rest".
    // The search and the group counts still cover every contact; the one open on the right stays in the list.
    var byG = groups.map(function (g) { return items.filter(function (c) { return c.t === g.key; }); }), pk = "con:" + f;
    var pg = E.listPage.take(pk, [].concat.apply([], byG), { q: q, keep: [S.sel], idOf: function (c) { return c.k; } }), on = {};
    pg.rows.forEach(function (c) { on[c.k] = 1; });
    groups.forEach(function (g, i) {
      var mine = byG[i], take = mine.filter(function (c) { return on[c.k]; }); if (!take.length) return;
      h += '<div class="con-lab">' + esc(g.label) + " <b>" + mine.length + '</b></div><div class="con-list">' + take.map(rowHtml).join("") + "</div>";
    });
    h += E.listPage.moreHtml(pk, pg, "con-btn");
    return h;
  }

  /* ---------- one contact ---------- */
  function fact(label, html, cls) { return "<div><dt>" + esc(label) + "</dt><dd" + (cls ? ' class="' + cls + '"' : "") + ">" + html + "</dd></div>"; }
  function detailHtml() {
    if (S.form) return formHtml();
    var c = S.sel && find(S.sel);
    if (!c) return '<div class="con-quiet con-pick" style="padding:34px;text-align:center">Pick a contact to see their numbers, or search for one.</div>';
    var r = c.r, t = TYPE[c.t], h = '<button type="button" class="con-dback" data-act="close">‹ Contacts</button><div class="con-card">';
    h += '<h2 tabindex="-1" id="con-title">' + esc(String(r.name || "").trim() || "(no name)") + '</h2><div class="con-meta"><span class="con-pill">' + esc(c.fixed ? "Emergency" : t.one) + "</span>" +
      (c.fixed ? "" : c.agg ? "<span>Found in this pharmacy's registers</span>" : t.local ? "<span>This pharmacy only</span>" : "<span>Shared with every pharmacy in your group</span>") + "</div><dl class=\"con-facts\">";
    var none = '<span style="color:var(--muted);font-weight:400">–</span>';
    if (c.fixed) { h += fact("Phone", tel(r.phone)); if (r.note) h += fact("About", esc(r.note), "note"); }
    else {
      t.cols.forEach(function (k) {
        if (k === "name") return;
        var v = String(r[k] || "").trim(), html;
        if (!v) html = none;
        else if (k === "email") html = '<a href="mailto:' + esc(v) + '">' + esc(v) + "</a>";
        else if (/phone/.test(k)) html = tel(v) + (k === "phone_personal" ? "<small>Do not give to patients</small>" : "");
        else html = esc(v);
        h += fact(LABEL[k], html);
      });
    }
    h += "</dl>";
    if (!c.fixed && !c.agg) h += '<div class="con-acts"><button type="button" class="con-btn" data-act="edit">Edit</button></div>';
    if (c.agg) h += '<p class="con-foot">Taken from orders, questions, deliveries and other registers. Saving it as a contact is in the <a href="#" data-act="classic">classic screen</a>.</p>';
    return h + "</div>";
  }
  function formHtml() {
    var F = S.form, t = TYPE[F.type], v = F.vals;
    var h = '<button type="button" class="con-dback" data-act="form-cancel">‹ Contacts</button><form class="con-form" id="con-form" autocomplete="off" novalidate aria-labelledby="con-form-h"><h2 id="con-form-h">' + (F.id ? "Change contact" : "New contact") + "</h2>";
    if (!F.id) h += '<label><span>Type</span><select name="type">' + TYPES.map(function (x) { return '<option value="' + x.key + '"' + (x.key === F.type ? " selected" : "") + ">" + esc(x.one) + "</option>"; }).join("") + "</select></label>";
    t.cols.forEach(function (k) {
      var label = k === "name" ? (t.nameLabel || "Name") : LABEL[k];
      if (k === "specialty") {
        var opts = SPECIALTIES.slice(); if (v.specialty && opts.indexOf(v.specialty) < 0) opts.unshift(v.specialty); // keep a value the list does not have
        h += '<label><span>' + label + '</span><select name="specialty"><option value="">Choose…</option>' + opts.map(function (s) { return '<option value="' + esc(s) + '"' + (s === v.specialty ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select></label>";
      } else { var fe = S.fe || {}; h += '<label><span>' + esc(label) + '</span><input name="' + k + '" value="' + esc(v[k] || "") + '"' + (INPUT[k] || "") + (HINT[k] ? ' placeholder="' + esc(HINT[k]) + '"' : "") + (fe[k] ? ' aria-invalid="true" aria-describedby="con-e-' + k + '"' : "") + ">" + (fe[k] ? '<small class="con-ferr" id="con-e-' + k + '">' + esc(fe[k]) + "</small>" : "") + "</label>"; }
    });
    h += '<div class="note">' + (t.local ? "Seen by this pharmacy only." : "Shared: every pharmacy in your group sees this contact and any change to it.") + "</div>";
    if (S.err) h += '<div class="con-err" role="alert">' + esc(S.err) + "</div>";
    h += '<div class="acts"><button type="button" class="con-btn" data-act="form-cancel">Cancel</button><button type="submit" class="con-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : F.id ? "Save" : "Add contact") + "</button></div></form>";
    return h;
  }

  /* ---------- drawing ---------- */
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "conreg") return; // left before a reply came back: do not draw over the next screen
    if (S.form && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var qi = m.querySelector("#con-q"); if (qi) S.q = qi.value;
    var open = !!(S.sel || S.form);
    var chips = [["all", "All"]].concat(TYPES.map(function (t) { return [t.key, t.many]; })).concat([["emergency", "Emergency"]]);
    var h = '<div class="con' + (open ? " has-sel" : "") + '"><div class="con-head"><button type="button" class="con-back" data-act="back">' + esc(E.ui2BackLabel ? E.ui2BackLabel("conreg") : "‹ Team") + "</button>" +
      '<div class="con-top"><div><h1>Contacts</h1><p class="con-sub">Suppliers, reps, doctors and everyone else the pharmacy calls.</p></div>' + (S.form && !S.form.id ? "" : '<button type="button" class="con-btn p" data-act="add">Add a contact</button>') + "</div></div>" +
      '<div class="con-grid"><div class="con-side">' +
      '<input class="con-q" id="con-q" type="search" autocomplete="off" aria-label="Search contacts" placeholder="Name, number or email" value="' + esc(S.q) + '">' +
      '<div class="con-chips" role="group" aria-label="Show">' + chips.map(function (c) { return '<button type="button" data-filter="' + c[0] + '" aria-pressed="' + (S.filter === c[0]) + '">' + esc(c[1]) + "</button>"; }).join("") + "</div>" +
      '<div id="con-list">' + listHtml() + "</div>" +
      '<p class="con-foot">Deleting a contact, import and export, hiding sections and the specialty filter are in the <a href="#" data-act="classic">classic screen</a>.</p>' +
      '</div><div class="con-detail">' + detailHtml() + "</div></div></div>";
    var ae = document.activeElement, keepSel = ae && m.contains(ae) ? (ae.id === "con-q" ? "#con-q" : ae.name ? "#con-form [name=" + ae.name + "]" : "") : "";
    m.innerHTML = h;
    if (keepSel) { var again = m.querySelector(keepSel); if (again) { again.focus(); try { if (again.setSelectionRange && again.type !== "email") { var L = again.value.length; again.setSelectionRange(L, L); } } catch (x) {} } } // typing keeps its place
    bind(m);
  }
  // A search changes only the list: the search box is never rebuilt under the fingers.
  function paintList() { var box = S.mount && S.mount.querySelector("#con-list"); if (!box) return paint(); box.innerHTML = listHtml(); bind(box); }
  function bind(root) {
    var m = S.mount;
    root.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash ? E.ui2BackHash("conreg") : "#team";
        else if (act === "retry") load();
        else if (act === "q58-more") { var nx = E.listPage.more(b.getAttribute("data-key")); paintList(); if (nx != null) E.focusSoon(function () { return S.mount && S.mount.querySelector('[data-open="' + nx + '"]'); }); } // q5-8: the first new contact
        else if (act === "add") { var ty = TYPE[S.filter] ? S.filter : "suppliers"; S.form = { type: ty, id: null, vals: prefill(ty) }; S.err = ""; S.fe = {}; S.sel = null; paint(true); top(); focus(); }
        else if (act === "edit") { var c = find(S.sel); if (!c || c.fixed || c.agg) return; var vals = {}; TYPE[c.t].cols.forEach(function (k) { vals[k] = String(c.r[k] == null ? "" : c.r[k]); }); S.form = { type: c.t, id: c.r.id, vals: vals, snap: Object.assign({}, vals), key: c.k }; S.err = ""; S.fe = {}; paint(true); top(); focus(); }
        else if (act === "form-cancel") cancelForm();
        else if (act === "close") { var was = S.sel; S.sel = null; paint(true); var row = was && m.querySelector('[data-open="' + was + '"]'); if (row) row.focus(); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "conreg"); } catch (x) {} E.openClassic("contacts"); }
      });
    });
    root.querySelectorAll("[data-filter]").forEach(function (b) { b.addEventListener("click", function () { S.filter = b.getAttribute("data-filter"); paint(); var again = S.mount.querySelector('[data-filter="' + S.filter + '"]'); if (again) again.focus(); }); });
    root.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { if (S.form && !confirmLeave()) return; S.form = null; S.err = ""; S.sel = b.getAttribute("data-open"); paint(true); top(); focusTitle(); }); });
    var qn = root.querySelector("#con-q");
    if (qn) {
      qn.addEventListener("input", function () { S.q = qn.value; paintList(); });
      qn.addEventListener("keydown", function (e) { if (e.key === "Escape" && qn.value) { e.preventDefault(); qn.value = ""; S.q = ""; paintList(); } });
    }
    var card = root.querySelector(".con-card");
    if (card) card.addEventListener("keydown", function (ev) { if (ev.key === "Escape") { var c = card.parentNode && card.parentNode.querySelector("[data-act=close]"); if (c) { ev.preventDefault(); c.click(); } } }); // Escape goes back to the list, on the row it came from
    var f = root.querySelector("#con-form");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); save(); });
      f.addEventListener("keydown", function (ev) { if (ev.key === "Escape" && !S.saving) { keep(); var F0 = S.form; var dirty = F0 && Object.keys(F0.vals).some(function (k) { return String(F0.vals[k] || "") !== String((F0.snap || prefill(F0.type))[k] || ""); }); if (!dirty) { ev.preventDefault(); cancelForm(); } } }); // Escape closes an untouched form; typing is never thrown away
      f.addEventListener("input", function (ev) { var el = ev.target; if (el && el.getAttribute && el.getAttribute("aria-invalid") === "true") { el.removeAttribute("aria-invalid"); if (S.fe) delete S.fe[el.name]; var s0 = el.parentNode && el.parentNode.querySelector(".con-ferr"); if (s0) s0.remove(); } });
      var ts = f.querySelector("[name=type]"); if (ts) ts.addEventListener("change", function () { keep(); var nv = prefill(ts.value); Object.keys(S.form.vals).forEach(function (k) { if (TYPE[ts.value].cols.indexOf(k) >= 0 && S.form.vals[k]) nv[k] = S.form.vals[k]; }); S.form.type = ts.value; S.form.vals = nv; S.err = ""; S.fe = {}; E.repaintKeepingFocus(m, function () { paint(true); }); }); // the fields change with the type; focus stays where it was going
    }
  }
  function cancelForm() { var back = S.form && S.form.key, wasNew = S.form && !S.form.id; S.form = null; S.err = ""; S.fe = {}; S.sel = back || null; paint(true); if (back) focusTitle(); else if (wasNew) setTimeout(function () { var b = S.mount && S.mount.querySelector(".con-head [data-act=add]"); if (b) b.focus(); }, 0); }
  function prefill(type) { // what was searched for starts the new contact: a name, or a number
    var v = {}, q = String(S.q || "").trim(); TYPE[type].cols.forEach(function (k) { v[k] = ""; });
    if (q) { if (/^[\d\s+\-()]+$/.test(q)) { var pk = TYPE[type].cols.filter(function (k) { return k === "phone" || k === "phone_patient"; })[0]; if (pk) v[pk] = q; } else if (q.indexOf("@") > 0 && "email" in v) v.email = q; else v.name = q; }
    return v;
  }
  // Opening another contact while a form has typed changes would lose them: say so instead (no dialog).
  function confirmLeave() { keep(); var F = S.form; if (!F) return true; var dirty = Object.keys(F.vals).some(function (k) { return String(F.vals[k] || "") !== String((F.snap || {})[k] || ""); }); if (!dirty) return true; S.err = "Save or cancel this contact first. What you typed is still here."; paint(true); return false; }
  function top() { if (window.matchMedia && window.matchMedia("(max-width:900px)").matches) try { window.scrollTo(0, 0); } catch (e) {} }
  function focus() { E.focusSoon(function () { return S.mount && S.mount.querySelector('#con-form [name="name"]'); }, 30); }
  function focusTitle() { setTimeout(function () { var x = S.mount && S.mount.querySelector("#con-title"); var a = document.activeElement; if (x && !(a && a.closest && a.closest("form")) && !(a && a.id === "con-q")) x.focus(); }, 30); }

  function keep() {
    var f = S.mount && S.mount.querySelector("#con-form"); if (!f || !S.form) return;
    TYPE[S.form.type].cols.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.form.vals[k] = String(el.value || "").trim(); });
  }

  /* ---------- saving ---------- */
  function sameRow(cols, a, b) { return cols.every(function (k) { return String(a[k] == null ? "" : a[k]).trim() === String(b[k] == null ? "" : b[k]).trim(); }); }
  async function save() {
    if (S.saving || !S.form) return;
    keep();
    var F = S.form, t = TYPE[F.type], body = {}; S.err = "";
    t.cols.forEach(function (k) { body[k] = String(F.vals[k] || "").trim(); });
    var fe = {};
    if (!F.id && !body.name) fe.name = "Write a name.";
    else if (F.id && !t.cols.some(function (k) { return body[k]; })) fe.name = "Write at least a name or a number.";
    if (body.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(body.email)) fe.email = "Check the email: it should look like name@example.com.";
    S.fe = fe; S.err = Object.keys(fe).length ? Object.keys(fe).map(function (k) { return fe[k]; }).join(" ") + " Nothing was saved." : "";
    if (S.err) { paint(true); var fx = S.mount.querySelector('#con-form [name="' + Object.keys(fe)[0] + '"]'); if (fx) fx.focus(); return; }
    // a client's ID card and the person (E.people.confirmPerson): asked before anything is saved; Go back keeps the form
    var asked = null;
    if (F.type === "clients" && body.id_card && E.people && E.people.confirmPerson) {
      S.saving = true; paint(true);
      asked = await E.people.confirmPerson({ name: body.name, id_card: body.id_card, address: body.address, phone: body.phone }, { key: "conreg", record: "contact" });
      S.saving = false;
      if (asked.action !== "save") {
        if (asked.action === "fill") S.form.vals[asked.field === "name" ? "name" : "id_card"] = asked.value;
        paint(true); var back = S.mount && S.mount.querySelector("[name=" + (asked.field === "name" ? "name" : "id_card") + "]"); if (back) back.focus();
        return;
      }
    }
    S.saving = true; paint(true);
    var newKey = null;
    try {
      if (F.id) {
        // The server replaces every field. Read the contact again first: if someone changed it meanwhile, show theirs.
        var now = (await list(F.type)).filter(function (r) { return String(r.id) === String(F.id); })[0];
        if (!now) throw new Error("this contact is no longer there (someone may have deleted it)");
        if (!sameRow(t.cols, now, F.snap)) {
          var mine = t.cols.filter(function (k) { return body[k] !== String(F.snap[k] || "").trim() && body[k] !== String(now[k] || "").trim(); }).map(function (k) { return (k === "name" ? (t.nameLabel || "Name") : LABEL[k]) + " “" + body[k] + "”"; });
          var vals = {}; t.cols.forEach(function (k) { vals[k] = String(now[k] == null ? "" : now[k]); });
          S.form.vals = vals; S.form.snap = Object.assign({}, vals); S.rows[F.type] = (S.rows[F.type] || []).map(function (r) { return String(r.id) === String(F.id) ? now : r; });
          S.err = "Someone else changed this contact while you were editing. Their version is shown; make your change again." + (mine.length ? " Yours was: " + mine.join(", ") + "." : "");
          S.saving = false; return paint(true);
        }
        body.id = F.id;
        var r = await E.apiFetch("/contacts/" + F.type, { method: "POST", body: JSON.stringify(body) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
        newKey = F.key; E.toast("Saved " + (body.name || "the contact"), "success");
      } else {
        var r2 = await E.postOnce("/contacts/" + F.type, body, { list: function () { return list(F.type); }, same: function (row) { return sameRow(t.cols, row, body); } });
        if (r2 && r2.id) newKey = F.type + ":" + r2.id;
        else if (r2 && r2.recovered) S.pick = { type: F.type, body: body };
        E.toast(body.name + " added to " + t.many.toLowerCase(), "success");
        if (F.type === "clients" && E.linkPerson) E.linkPerson({ name: body.name, id_card: body.id_card, address: body.address, phone: body.phone, alt_phone: body.alt_phone }, "contacts:clients", asked); // one person in Customers, found or added
      }
      S.form = null; S.sel = newKey;
      if (!newKey && !S.pick) S.sel = null;
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false;
    await load();
    if (S.pick) { var p = S.pick; S.pick = null; var hit = (S.rows[p.type] || []).filter(function (row) { return sameRow(TYPE[p.type].cols, row, p.body); }).pop(); if (hit) { S.sel = p.type + ":" + hit.id; paint(true); } }
    if (!S.form && S.sel) focusTitle();
  }

  E.registerModule({
    id: "conreg", title: "Contacts", order: 3, icon: "☎", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; E.listPage.reset("con"); S.form = null; S.sel = null; S.err = ""; S.fe = {}; S.q = ""; S.filter = "all"; S.saving = false; css(); paint(); return E.takeOpenForm("conreg", S.mount, load(), { btn: ".con-top [data-act=add]", form: "#con-form", isNew: function () { return !!(S.form && !S.form.id); } }); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("conreg") < 0) E.UI2_DESTINATIONS.push("conreg");
  if (E.UI2_PARENT) E.UI2_PARENT.conreg = "team";
})();
