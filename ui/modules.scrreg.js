/* Screening campaigns, new layout: the campaigns with how many were screened, one campaign with the people screened in
   it, one person's screening in full (results, assessment, referral and follow-ups), a form to record a screening with
   exactly the classic fields (and the classic result fields for the campaign's type), and a form to start a campaign.
   Same endpoint as the classic screen: GET and PUT /screening/state. The server upserts each campaign it is sent by its
   id and replaces that campaign whole (the people screened live inside it), and removes only ids listed in deleted_ids.
   So a save re-reads the campaign from the server, adds the one new person to it as stored, and sends that campaign
   alone with an empty deleted_ids: no other campaign is touched and nothing is ever deleted from here. The new person's
   id is made when the form opens and kept through retries, so a save whose answer was lost never adds them twice, and
   a campaign deleted on another screen is never brought back.
   Editing or removing a person, follow-ups, editing, duplicating or deleting a campaign, and the summary tab stay in the
   classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, campaigns: [], loading: false, error: "", q: "", pq: "", view: "list", campId: "", partId: "", adding: null, kind: "", saving: false, err: "", miss: [] };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // ---- the classic screen's lists, word for word (stored as these strings) ----
  var CAMPAIGN_TYPES = ["Blood Pressure Check", "Diabetes Screening", "Cholesterol Check", "Blood Glucose Monitoring", "BMI Assessment", "Urine Screening",
    "Cardiovascular Risk", "Flu Vaccination", "Smoking Cessation", "General Health Check", "Other"];
  var CAMPAIGN_LOCATIONS = ["Pharmacy Floor", "Community Centre", "GP Surgery", "Hospital Outpatient", "Mobile Unit", "Workplace", "School/University", "Care Home",
    "Health Fair", "Online/Remote", "Other"];
  var REFERRAL_OPTIONS = ["No referral needed", "Referred to GP", "Referred to specialist", "Referred to hospital", "Referred to dietitian", "Referred to pharmacist follow-up",
    "Self-monitoring advised", "Other"];
  var RESULT_CATEGORIES = ["Normal", "Borderline", "Abnormal", "Requires urgent attention"];
  var PARTICIPANT_TYPES = ["Pre-registered", "Walk-in"];
  var POCT_MAP = { "Blood Pressure Check": "bp", "Diabetes Screening": "hba1c", "Cholesterol Check": "chol", "Blood Glucose Monitoring": "bg", "BMI Assessment": "bmi", "Urine Screening": "urine" };
  var SEMI = ["Negative", "Trace", "+", "++", "+++"];
  // The classic result fields per test: key, label, unit, number or a list of options, required, placeholder
  var FIELDS = {
    bp: { label: "Blood pressure", f: [["sys", "Systolic", "mmHg", null, true, "e.g. 120"], ["dia", "Diastolic", "mmHg", null, true, "e.g. 80"], ["pulse", "Pulse", "bpm", null, false, "e.g. 72"],
      ["arm", "Arm", "", ["Left", "Right"]], ["position", "Position", "", ["Sitting", "Standing", "Lying"]]] },
    hba1c: { label: "HbA1c", f: [["pct", "HbA1c", "%", null, true, "e.g. 5.7"], ["mmol", "HbA1c", "mmol/mol", null, false, "e.g. 39"]] },
    bg: { label: "Blood glucose", f: [["glucose", "Glucose", "mmol/L", null, true, "e.g. 5.5"], ["timing", "Timing", "", ["Fasting", "Random", "Post-meal (1h)", "Post-meal (2h)"]]] },
    chol: { label: "Cholesterol", f: [["tc", "Total cholesterol", "mmol/L", null, false, "e.g. 5.2"], ["hdl", "HDL", "mmol/L", null, false, "e.g. 1.3"], ["ldl", "LDL", "mmol/L", null, false, "e.g. 3.1"],
      ["tg", "Triglycerides", "mmol/L", null, false, "e.g. 1.7"], ["ratio", "TC/HDL ratio", "", null, false, "e.g. 4.2"], ["fasting", "Fasting", "", ["Yes", "No"]]] },
    bmi: { label: "Weight and BMI", f: [["weight", "Weight", "kg", null, false, "e.g. 75"], ["height", "Height", "cm", null, false, "e.g. 170"], ["bmi", "BMI", "", null, false, "Worked out"],
      ["category", "Category", "", ["Underweight", "Normal", "Overweight", "Obese I", "Obese II", "Obese III"]], ["waist", "Waist", "cm", null, false, "e.g. 85"]] },
    urine: { label: "Urine (Combur)", f: [["leu", "Leukocytes", "", SEMI], ["nit", "Nitrite", "", ["Negative", "Positive"]], ["uro", "Urobilinogen", "", ["Normal", "1+", "2+", "3+", "4+"]],
      ["pro", "Protein", "", SEMI], ["ph", "pH", "", null, false, "e.g. 6.0"], ["bld", "Blood", "", SEMI], ["ket", "Ketones", "", SEMI], ["glu", "Glucose", "", SEMI.concat(["++++"])],
      ["appearance", "Appearance", "", ["Clear", "Slightly cloudy", "Cloudy", "Turbid"]]] }
  };
  var PERSON = ["idCard", "name", "phone", "dob", "type", "date", "resultNotes", "resultCategory", "referral", "referralNotes"];
  var CAMP = ["name", "type", "status", "location", "targetScreenings", "startDate", "endDate", "notes"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid() { return "sc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); } // same shape as the classic ids
  function str(v) { return v == null ? "" : String(v); }
  function low(s) { return str(s).toLowerCase(); }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function has(v) { return v !== null && v !== undefined && String(v).trim() !== ""; }
  // Same rule as the classic screen: 123M -> 0000123M; anything else stays as typed (upper case, no spaces)
  function pid(raw) { var s = str(raw).trim().toUpperCase().replace(/\s+/g, ""), m = /^(\d{1,7})([A-Z])$/.exec(s); return m ? ("0000000" + m[1]).slice(-7) + m[2] : s; }
  function dm(s) { var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(str(s)); if (!m) return str(s); return Number(m[3]) + " " + MON[Number(m[2]) - 1] + (Number(m[1]) === new Date().getFullYear() ? "" : " " + m[1]); }
  function numOk(v) { return /^-?\d+(\.\d+)?$/.test(str(v).trim().replace(",", ".")) || /^-?\.\d+$/.test(str(v).trim().replace(",", ".")); }
  function parts(c) { return Array.isArray(c && c.participants) ? c.participants.filter(function (p) { return p && typeof p === "object"; }) : []; }
  function campOf(id) { return S.campaigns.filter(function (c) { return String(c.id) === String(id); })[0] || null; }
  function testOf(c) { return Object.prototype.hasOwnProperty.call(POCT_MAP, c && c.type) ? POCT_MAP[c.type] : null; }

  // ---- the classic screen's readings, unchanged ----
  function statusOf(c) {
    var t = today();
    if (c.status === "Cancelled") return "Cancelled";
    if (c.endDate && c.endDate < t) return "Completed";
    if (c.startDate && c.startDate <= t && (!c.endDate || c.endDate >= t)) return "Active";
    return "Planned";
  }
  function isAbn(p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }
  function isRef(p) { return !!p.referral && p.referral !== "No referral needed"; }
  function overdue(f) { return !!f && !!f.scheduledDate && f.status !== "Completed" && f.status !== "Cancelled" && f.scheduledDate < today(); }
  function bmiCat(v) { return v < 18.5 ? "Underweight" : v < 25 ? "Normal" : v < 30 ? "Overweight" : v < 35 ? "Obese I" : v < 40 ? "Obese II" : "Obese III"; }
  function summary(t, r) {
    r = r || {};
    if (t === "bp" && has(r.sys) && has(r.dia)) return r.sys + "/" + r.dia + " mmHg" + (has(r.pulse) ? " · pulse " + r.pulse : "");
    if (t === "hba1c" && has(r.pct)) return r.pct + "%" + (has(r.mmol) ? " · " + r.mmol + " mmol/mol" : "");
    if (t === "bg" && has(r.glucose)) return r.glucose + " mmol/L" + (r.timing ? " · " + low(r.timing) : "");
    if (t === "chol" && has(r.tc)) return "Total " + r.tc + (has(r.hdl) ? ", HDL " + r.hdl : "") + (has(r.ldl) ? ", LDL " + r.ldl : "") + " mmol/L";
    if (t === "bmi" && has(r.bmi)) return "BMI " + r.bmi + (has(r.weight) ? " · " + r.weight + " kg" : "");
    if (t === "urine") {
      var o = [];
      [["glu", "Glucose"], ["pro", "Protein"], ["bld", "Blood"], ["leu", "Leukocytes"]].forEach(function (k) { if (r[k[0]] && r[k[0]] !== "Negative") o.push(k[1] + " " + r[k[0]]); });
      return o.length ? o.join(", ") : (Object.keys(r).some(function (k) { return has(r[k]); }) ? "All negative" : "");
    }
    return "";
  }

  function css() {
    if (document.getElementById("eikon-scrreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-scrreg-css";
    st.textContent =
      ".scr{max-width:880px;margin:0 auto}" +
      ".scr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".scr-back:focus-visible,.scr-btn:focus-visible,.scr a:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:2px;border-radius:8px}" +
      ".scr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}.scr-top>div:first-child{min-width:0;flex:1 1 240px}" +
      ".scr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800;overflow-wrap:anywhere}.scr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0;overflow-wrap:anywhere}" +
      ".scr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".scr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.scr-btn:disabled{opacity:.55;cursor:default}" +
      ".scr-acts-top{display:flex;gap:8px;flex-wrap:wrap}" +
      ".scr-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".scr-q:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:2px}" +
      ".scr-lab{font-size:13px;font-weight:600;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px;justify-content:space-between}.scr-lab b{color:var(--text)}" +
      ".scr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".scr-row{display:flex;gap:12px;align-items:center;width:100%;box-sizing:border-box;text-align:left;font:inherit;color:var(--text);background:none;border:0;border-top:.5px solid var(--border);padding:11px 16px;min-height:52px}.scr-list>.scr-row:first-child{border-top:0}" +
      "button.scr-row{cursor:pointer}button.scr-row:hover{background:rgba(118,118,128,.06)}.scr-row:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:-3px}" +
      ".scr-row .t{flex:1;min-width:0}.scr-row b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".scr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".scr-row .a{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex:0 0 auto;max-width:44%}" +
      ".scr-pill{display:inline-block;font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;box-sizing:border-box;background:rgba(118,118,128,.14);color:var(--muted)}" +
      ".scr-pill.s{background:rgba(215,38,28,.12);color:var(--danger)}.scr-pill.w{background:rgba(201,138,18,.16);color:var(--warn,#8A5A08)}.scr-pill.ok{background:rgba(10,143,106,.12);color:var(--accent)}" +
      ".scr-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-top:14px}" +
      ".scr-stats div{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:10px 12px;min-width:0}" +
      ".scr-stats b{display:block;font-size:22px;font-weight:700;letter-spacing:-.01em;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.scr-stats span{display:block;font-size:12.5px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".scr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:4px 0;margin-top:8px}" +
      ".scr-form label{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.scr-form>label:first-child{border-top:0}" +
      ".scr-form label>span{flex:0 0 120px;font-size:15px;min-width:0}.scr-form label>i{font-style:normal;color:var(--muted);font-size:13px;white-space:nowrap}" +
      ".scr-form label small{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}" +
      ".scr-form input,.scr-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".scr-form label:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      ".scr-form label.tx{display:block;padding:10px 14px}.scr-form label.tx>span{display:block;margin-bottom:4px}" +
      ".scr-form textarea{display:block;width:100%;box-sizing:border-box;min-height:72px;resize:vertical;border:1px solid var(--border);border-radius:10px;background:transparent;font:inherit;font-size:16px;color:inherit;padding:8px 10px;outline:0}" +
      ".scr-form .hint{display:block;color:var(--muted);font-size:12.5px;padding:0 14px 8px}" +
      ".scr-hd{font-size:13px;font-weight:600;color:var(--muted);margin:22px 2px 0}" +
      ".scr-acts{display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;margin-top:14px}" +
      ".scr-err{color:var(--danger);font-size:13.5px;margin-top:12px;line-height:1.45}" +
      ".scr-form label.miss>span{color:var(--danger);font-weight:600}.scr-form label.miss{box-shadow:inset 3px 0 0 var(--danger)}" +
      ".scr-skel i{height:64px}" + // the rest is .eikon-skel in app.css (E.skeleton)
      ".scr-info{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12);font-size:13.5px}" +
      ".scr-one{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin:8px 0 0}" +
      ".scr-one div{display:flex;gap:12px;padding:9px 16px;border-top:.5px solid var(--border);font-size:14.5px}.scr-one div:first-child{border-top:0}" +
      ".scr-one dt{flex:0 0 130px;color:var(--muted);margin:0}.scr-one dd{flex:1;min-width:0;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}" +
      ".scr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".scr-note{font-size:12.5px;color:var(--muted);margin-top:14px;line-height:1.5}.scr-note a{color:var(--accent)}" +
      "@media (max-width:600px){.scr-btn{height:44px;border-radius:22px;padding:0 18px;font-size:15px}.scr-back{display:inline-flex;align-items:center;min-height:44px;padding:0}.scr-q{height:44px}.scr{padding:4px 16px 0}.scr h1{font-size:32px}.scr-form label>span{flex-basis:100px}.scr-one dt{flex-basis:100px}.scr-row{padding:10px 14px}.scr-stats{grid-template-columns:repeat(2,minmax(0,1fr))}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .scr-pill.s,html[data-ui2]:not([data-ui2-visit]) .scr-err,html[data-ui2]:not([data-ui2-visit]) .scr-form label.miss>span{color:#FF7A72}html[data-ui2]:not([data-ui2-visit]) .scr-pill.w{color:#F2B84B}}";
    document.head.appendChild(st);
  }

  async function readAll() {
    var r = await E.apiFetch("/screening/state", { method: "GET" });
    if (!r || r.ok === false) throw new Error((r && r.error) || "Could not read the campaigns");
    var list = Array.isArray(r.campaigns) ? r.campaigns : (r.state && Array.isArray(r.state.campaigns) ? r.state.campaigns : []); // the same reading as the classic screen
    return list.filter(function (c) { return c && c.id; });
  }
  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try { S.campaigns = (await readAll()).sort(function (a, b) { return str(b.startDate).localeCompare(str(a.startDate)); }); } // newest start first, as the classic list
    catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. The campaigns are safe; try again in a moment." : String((e && (e.message || e)) || "Could not load the campaigns"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  // ---- pieces ----
  function opts(list, val, blankLabel) {
    var h = blankLabel != null ? '<option value=""' + (val ? "" : " selected") + ">" + esc(blankLabel) + "</option>" : "", seen = !val && blankLabel != null;
    list.forEach(function (o) { if (o === val) seen = true; h += '<option value="' + esc(o) + '"' + (o === val ? " selected" : "") + ">" + esc(o) + "</option>"; });
    if (!seen && val) h += '<option value="' + esc(val) + '" selected>' + esc(val) + "</option>";
    return h;
  }
  function dl(pairs) {
    var rows = pairs.filter(function (p) { return has(p[1]); });
    return rows.length ? '<dl class="scr-one">' + rows.map(function (p) { return "<div><dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd></div>"; }).join("") + "</dl>" : "";
  }
  function statusPill(s) { return '<span class="scr-pill' + (s === "Active" ? " ok" : s === "Cancelled" ? " w" : "") + '">' + esc(s) + "</span>"; }
  function catPill(c) { return c ? '<span class="scr-pill' + (c === "Normal" ? " ok" : c === "Borderline" ? " w" : " s") + '">' + esc(c) + "</span>" : ""; }
  function counts(c) {
    var ps = parts(c), fu = 0, od = 0;
    ps.forEach(function (p) { (Array.isArray(p.followUps) ? p.followUps : []).forEach(function (f) { fu++; if (overdue(f)) od++; }); });
    return { n: ps.length, abn: ps.filter(isAbn).length, ref: ps.filter(isRef).length, fu: fu, od: od, goal: parseInt(c.targetScreenings, 10) || 0 };
  }
  function period(c) { return c.startDate || c.endDate ? (dm(c.startDate) || "?") + (c.endDate ? " – " + dm(c.endDate) : "") : ""; }

  function campRow(c) {
    var k = counts(c), st = statusOf(c);
    var line = [k.n + " screened" + (k.goal ? " of " + k.goal : ""), k.abn ? k.abn + " abnormal" : "", k.ref ? k.ref + (k.ref === 1 ? " referral" : " referrals") : "", k.od ? k.od + " follow-up" + (k.od === 1 ? "" : "s") + " overdue" : ""].filter(Boolean).join(" · ");
    return '<button type="button" class="scr-row" data-act="camp" data-id="' + esc(c.id) + '"><div class="t"><b>' + esc(c.name || "Untitled campaign") + "</b><span>" +
      esc([c.type, period(c), c.location].filter(Boolean).join(" · ")) + "</span><span>" + esc(line) + '</span></div><div class="a">' + statusPill(st) + "</div></button>";
  }
  function partRow(c, p) {
    var t = testOf(c), sm = summary(t, p.poctResults);
    return '<button type="button" class="scr-row" data-act="part" data-id="' + esc(p.id) + '"><div class="t"><b>' + esc(p.name || p.idCard || "No name") + "</b><span>" +
      esc([p.idCard && p.name ? p.idCard : "", dm(p.date), p.type].filter(Boolean).join(" · ")) + "</span>" + (sm || p.resultNotes ? "<span>" + esc(sm || p.resultNotes) + "</span>" : "") +
      '</div><div class="a">' + catPill(p.resultCategory) + (isRef(p) ? '<span class="scr-pill w">' + esc(p.referral) + "</span>" : "") + "</div></button>";
  }

  function listHtml() {
    var h = '<div class="scr-top"><div><h1>Screening campaigns</h1><p class="scr-sub">Health checks run as events, and the people screened at each.</p></div><button class="scr-btn p" data-act="newcamp">New campaign</button></div>';
    if (S.loading && !S.campaigns.length) return h + E.skeleton(3, "Opening the campaigns", "scr-skel");
    if (S.error) return h + '<div class="scr-quiet" role="alert">' + esc(S.error) + ' <button type="button" class="scr-btn" data-act="retry" style="margin-left:6px">Try again</button></div>';
    if (!S.campaigns.length) return h + '<div class="scr-quiet">No campaign yet. Press New campaign to plan the first one, for example a blood pressure check day.</div>';
    h += '<input class="scr-q" id="scr-q" type="search" aria-label="Search campaigns" placeholder="Search campaigns by name or type" value="' + esc(S.q) + '">';
    var q = low(S.q).trim(), list = S.campaigns.filter(function (c) { return !q || low(c.name).indexOf(q) >= 0 || low(c.type).indexOf(q) >= 0; });
    var now = list.filter(function (c) { return statusOf(c) === "Active"; }), rest = list.filter(function (c) { return statusOf(c) !== "Active"; });
    if (!list.length) return h + '<div class="scr-quiet">No campaign matches “' + esc(S.q) + "”.</div>";
    if (now.length) h += '<div class="scr-lab"><span>Running now <b>' + now.length + '</b></span></div><div class="scr-list">' + now.map(campRow).join("") + "</div>";
    if (rest.length) h += '<div class="scr-lab"><span>' + (now.length ? "Other campaigns" : "Campaigns") + " <b>" + rest.length + '</b></span></div><div class="scr-list">' + rest.map(campRow).join("") + "</div>";
    return h;
  }

  function campHtml(c) {
    var k = counts(c), st = statusOf(c), ps = parts(c);
    var h = '<div class="scr-top"><div><h1>' + esc(c.name || "Untitled campaign") + '</h1><p class="scr-sub">' + esc([c.type, period(c), c.location].filter(Boolean).join(" · ")) + " " + "</p></div>" +
      '<span class="scr-acts-top"><button class="scr-btn" data-act="list">All campaigns</button><button class="scr-btn p" data-act="add">New screening</button></span></div>';
    h += '<div class="scr-stats" role="group" aria-label="Campaign totals">' +
      "<div><b>" + k.n + (k.goal ? ' <span style="display:inline;font-size:14px">/ ' + k.goal + "</span>" : "") + "</b><span>Screened" + (k.goal ? " of the goal" : "") + "</span></div>" +
      "<div><b>" + k.abn + "</b><span>Abnormal</span></div><div><b>" + k.ref + "</b><span>Referrals</span></div><div><b>" + k.od + "</b><span>Follow-ups overdue</span></div></div>";
    h += '<div style="margin-top:10px">' + statusPill(st) + "</div>";
    if (has(c.notes)) h += '<div class="scr-hd">Notes</div>' + dl([["Notes", c.notes]]);
    if (!ps.length) return h + '<div class="scr-quiet">Nobody screened yet. Press New screening for each person you check.</div>';
    if (ps.length > 6) h += '<input class="scr-q" id="scr-pq" type="search" aria-label="Search people in this campaign" placeholder="Search by name, ID card or phone" value="' + esc(S.pq) + '">';
    var q = low(S.pq).replace(/\s+/g, ""), list = ps.slice().reverse().filter(function (p) { // the latest screened first
      return !q || low(p.name).replace(/\s+/g, "").indexOf(q) >= 0 || low(p.idCard).indexOf(q) >= 0 || low(p.phone).replace(/\s+/g, "").indexOf(q) >= 0;
    });
    h += '<div class="scr-lab"><span>' + (q ? "Matching" : "Screened") + " <b>" + list.length + "</b></span></div>";
    h += list.length ? '<div class="scr-list">' + list.map(function (p) { return partRow(c, p); }).join("") + "</div>" : '<div class="scr-quiet">Nobody in this campaign matches.</div>';
    return h;
  }

  function partHtml(c, p) {
    var t = testOf(c), def = t ? FIELDS[t] : null, r = p.poctResults || {};
    var h = '<div class="scr-top"><div><h1>' + esc(p.name || p.idCard || "No name") + '</h1><p class="scr-sub">' + esc([c.name, dm(p.date)].filter(Boolean).join(" · ")) + "</p></div>" +
      '<span class="scr-acts-top"><button class="scr-btn" data-act="camp" data-id="' + esc(c.id) + '">Back to the campaign</button><button class="scr-btn p" data-act="add">Record the next person</button></span></div>';
    h += '<div class="scr-hd">Person</div>' + dl([["ID card", p.idCard], ["Name", p.name], ["Phone", p.phone], ["Email", p.email], ["Date of birth", dm(p.dob)], ["Type", p.type], ["Screened on", dm(p.date)]]);
    if (def) {
      var rows = def.f.map(function (f) { return [f[1], has(r[f[0]]) ? r[f[0]] + (f[2] === "%" ? "%" : f[2] ? " " + f[2] : "") : ""]; });
      var shown = dl(rows);
      h += '<div class="scr-hd">' + esc(def.label) + "</div>" + (shown || '<div class="scr-quiet">No results written.</div>');
    }
    h += '<div class="scr-hd">Assessment</div>' + (dl([["Result", p.resultNotes], ["Category", p.resultCategory], ["Referral", p.referral], ["Referral notes", p.referralNotes]]) || '<div class="scr-quiet">No assessment written.</div>');
    var fus = Array.isArray(p.followUps) ? p.followUps.filter(Boolean) : [];
    h += '<div class="scr-hd">Follow-ups</div>';
    h += fus.length ? '<div class="scr-list" style="margin-top:8px">' + fus.map(function (f) {
      return '<div class="scr-row"><div class="t"><b>' + esc(f.reason || "Follow-up") + "</b><span>" + esc([dm(f.scheduledDate), f.notes].filter(Boolean).join(" · ")) + '</span></div><div class="a">' +
        (overdue(f) ? '<span class="scr-pill s">Overdue</span>' : "") + '<span class="scr-pill' + (f.status === "Completed" ? " ok" : "") + '">' + esc(f.status || "Pending") + "</span></div></div>";
    }).join("") + "</div>" : '<div class="scr-quiet">No follow-up scheduled. Follow-ups are scheduled in the classic screen.</div>';
    return h;
  }

  function fld(k, label, extra, unit) {
    var a = S.adding;
    var bad = S.miss.indexOf(k) >= 0;
    return "<label" + (bad ? ' class="miss"' : "") + "><span>" + esc(label) + '</span><input name="' + k + '" value="' + esc(a[k]) + '"' + (bad ? ' aria-invalid="true" aria-describedby="scr-errmsg"' : "") + (extra || "") + ">" + (unit || "") + "</label>";
  }
  function sel(k, label, list, blank) { return "<label><span>" + esc(label) + '</span><select name="' + k + '">' + opts(list, str(S.adding[k]), blank) + "</select></label>"; }
  function txt(k, label, ph) { return '<label class="tx"><span>' + esc(label) + '</span><textarea name="' + k + '" placeholder="' + esc(ph || "") + '">' + esc(S.adding[k]) + "</textarea></label>"; }

  function addHtml(c) {
    var a = S.adding, t = testOf(c), def = t ? FIELDS[t] : null;
    var h = '<div class="scr-top"><div><h1>New screening</h1><p class="scr-sub">' + esc([c.name, c.type].filter(Boolean).join(" · ")) + "</p></div></div>" +
      '<form id="scr-add" autocomplete="off" novalidate aria-label="New screening">';
    h += '<div class="scr-hd">Person</div><div class="scr-form">' +
      fld("idCard", "ID card", ' placeholder="e.g. 123456M" autocapitalize="characters"', a.found ? "<small>Known</small>" : "") +
      fld("name", "Name", ' placeholder="Name and surname"') + fld("phone", "Phone", ' type="tel" inputmode="tel" placeholder="+356 …"') +
      fld("dob", "Date of birth", ' type="date"') + sel("type", "Type", PARTICIPANT_TYPES) + fld("date", "Screened on", ' type="date"') +
      '<span class="hint">An ID card or a name is needed.</span></div>';
    if (a.before) h += '<div class="scr-info" role="status">' + esc(a.before) + "</div>";
    if (def) {
      h += '<div class="scr-hd">' + esc(def.label) + '</div><div class="scr-form">' + def.f.map(function (f) {
        var lab = f[1] + (f[4] ? " *" : "");
        if (f[3]) return sel("r_" + f[0], lab, f[3], "Not recorded");
        return fld("r_" + f[0], lab, ' inputmode="decimal" placeholder="' + esc(f[5] || "") + '"' + (f[4] ? ' aria-required="true"' : ""), f[2] ? "<i>" + esc(f[2]) + "</i>" : "");
      }).join("") + (def.f.some(function (f) { return f[4]; }) ? '<span class="hint">* needed for this test.</span>' : "") + (t === "bmi" ? '<span class="hint">BMI and its category are worked out from the weight and height, as in the classic screen; both can be changed.</span>' : "") + "</div>";
    }
    h += '<div class="scr-hd">Assessment</div><div class="scr-form">' + txt("resultNotes", "Result notes", "Describe the screening results") +
      sel("resultCategory", "Category", RESULT_CATEGORIES, "Not chosen") + sel("referral", "Referral", REFERRAL_OPTIONS) + txt("referralNotes", "Referral notes", "Optional") + "</div>";
    h += (S.err ? '<div class="scr-err" id="scr-errmsg" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="scr-acts"><button type="button" class="scr-btn" data-act="cancel">Cancel</button><button type="submit" class="scr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save screening") + "</button></div></form>";
    return h;
  }

  function newCampHtml() {
    var h = '<div class="scr-top"><div><h1>New campaign</h1><p class="scr-sub">A screening event or a run of days, such as a diabetes awareness week.</p></div></div>' +
      '<form id="scr-camp" autocomplete="off" novalidate aria-label="New campaign"><div class="scr-form" style="margin-top:16px">' +
      fld("name", "Name", ' placeholder="e.g. Diabetes Awareness Week"') + sel("type", "Type", CAMPAIGN_TYPES) + sel("status", "Status", ["Active", "Cancelled"]) +
      sel("location", "Location", CAMPAIGN_LOCATIONS, "Not chosen") + fld("targetScreenings", "Goal", ' inputmode="numeric" placeholder="People to screen, optional"') +
      fld("startDate", "Starts", ' type="date"') + fld("endDate", "Ends", ' type="date"') + txt("notes", "Notes", "What the campaign is for, its goals") + "</div>" +
      '<p class="scr-note" style="margin-top:8px">The type sets which results are written for each person: blood pressure, HbA1c, cholesterol, glucose, BMI or urine.</p>' +
      (S.err ? '<div class="scr-err" id="scr-errmsg" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="scr-acts"><button type="button" class="scr-btn" data-act="cancel">Cancel</button><button type="submit" class="scr-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Create campaign") + "</button></div></form>";
    return h;
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "scrreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var c = S.campId ? campOf(S.campId) : null, p = c && S.partId ? parts(c).filter(function (x) { return String(x.id) === S.partId; })[0] : null;
    if (S.view === "add" && S.adding && S.adding.camp) c = S.adding.camp; // the campaign as it was when the form opened: its result fields stay put
    var h = '<div class="scr"><button class="scr-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("scrreg")) + '</button>';
    if (S.view === "newcamp" && S.adding) h += newCampHtml();
    else if (S.view === "add" && S.adding && c) h += addHtml(c);
    else if (S.view === "part" && p) h += partHtml(c, p);
    else if ((S.view === "camp" || S.view === "part") && c) h += campHtml(c);
    else h += listHtml();
    h += '<p class="scr-note">Editing or removing a person, scheduling follow-ups, editing, duplicating or deleting a campaign, and the summary are in the <a href="#" data-act="classic">classic screen</a>.</p></div>';
    var ae = document.activeElement, back = "";
    if (ae && m.contains(ae)) back = ae.id ? "#" + ae.id : ae.name ? "[name=" + ae.name + "]" : "";
    var caret = null; if (back) try { caret = typeof ae.selectionStart === "number" ? ae.selectionStart : null; } catch (e) { caret = null; }
    m.innerHTML = h;
    if (back) { var again = m.querySelector(back); if (again) { again.focus(); if (caret != null) try { again.setSelectionRange(caret, caret); } catch (x) {} } } // typing keeps its place
    wire(m);
  }

  function focusSel(sel) { E.focusSoon(function () { return S.mount && S.mount.querySelector(sel); }, 30); }
  function cssId(v) { return window.CSS && CSS.escape ? CSS.escape(v) : String(v).replace(/"/g, ""); }

  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("scrreg");
        else if (act === "list") { var was = S.campId; S.view = "list"; S.campId = ""; S.partId = ""; S.pq = ""; paint(true); focusSel('.scr-row[data-id="' + cssId(was) + '"]'); }
        else if (act === "camp") { var from = S.view === "part" ? S.partId : ""; S.campId = b.getAttribute("data-id"); S.partId = ""; S.view = "camp"; if (!from) S.pq = ""; paint(true); window.scrollTo(0, 0); focusSel(from ? '.scr-row[data-id="' + cssId(from) + '"]' : "[data-act=add]"); }
        else if (act === "part") { S.partId = b.getAttribute("data-id"); S.view = "part"; paint(true); window.scrollTo(0, 0); focusSel(".scr-acts-top [data-act=camp]"); }
        else if (act === "add") { var c = campOf(S.campId); if (!c) return; S.adding = fresh(c); S.err = ""; S.miss = []; S.view = "add"; paint(true); window.scrollTo(0, 0); focusSel("[name=idCard]"); }
        else if (act === "newcamp") { S.adding = freshCamp(); S.err = ""; S.miss = []; S.view = "newcamp"; paint(true); window.scrollTo(0, 0); focusSel("[name=name]"); }
        else if (act === "cancel") { var nc = S.view === "newcamp"; S.adding = null; S.err = ""; S.miss = []; S.view = nc ? "list" : "camp"; paint(true); focusSel(nc ? "[data-act=newcamp]" : "[data-act=add]"); }
        else if (act === "retry") load();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "scrreg"); } catch (x) {} E.openClassic("screening"); }
      });
    });
    var q = m.querySelector("#scr-q"); if (q) q.addEventListener("input", function () { S.q = q.value; clearTimeout(S.qT); S.qT = setTimeout(function () { paint(); }, 120); });
    var pq = m.querySelector("#scr-pq"); if (pq) pq.addEventListener("input", function () { S.pq = pq.value; clearTimeout(S.qT); S.qT = setTimeout(function () { paint(); }, 120); });
    var f = m.querySelector("#scr-add");
    if (f) {
      f.addEventListener("submit", function (ev) { ev.preventDefault(); saveScreening(); });
      f.addEventListener("input", function (ev) { unmark(ev.target); });
      var idIn = f.querySelector("[name=idCard]");
      if (idIn) idIn.addEventListener("blur", function () { var v = idIn.value; setTimeout(function () { lookup(v); }, 0); }); // after the blur: focus has moved on, and the redraw puts it back there
      if (E.personPick) E.personPick.attach({ key: "scrreg", form: f, fields: { id: "idCard", name: "name", phone: "phone", dob: "dob" }, idValue: pid, onFill: function () { keep(); },
        local: function () {
          var out = []; S.campaigns.forEach(function (c) { parts(c).forEach(function (p) { out.push({ name: str(p.name), id_card: str(p.idCard), phone: str(p.phone), dob: str(p.dob), date: str(p.date).slice(0, 10), from: "screening" }); }); });
          var cl = window.__POCT_CLOUD; (cl && Array.isArray(cl.patients) ? cl.patients : []).forEach(function (p) { if (p) out.push({ name: str(p.name), id_card: str(p.patientId), phone: str(p.phone), date: str(p.lastSeenIso).slice(0, 10), from: "test" }); });
          return out;
        } });
      var w = f.querySelector("[name=r_weight]"), ht = f.querySelector("[name=r_height]");
      if (w && ht) { // the classic BMI auto-calculation, unchanged
        var auto = function () {
          var wv = parseFloat(str(w.value).replace(",", ".")), hv = parseFloat(str(ht.value).replace(",", "."));
          if (wv > 0 && hv > 0) {
            var b = (wv / ((hv / 100) * (hv / 100))).toFixed(1), be = f.querySelector("[name=r_bmi]"), ce = f.querySelector("[name=r_category]");
            if (be) be.value = b; if (ce) ce.value = bmiCat(parseFloat(b));
          }
        };
        w.addEventListener("input", auto); ht.addEventListener("input", auto);
      }
    }
    var fc = m.querySelector("#scr-camp"); if (fc) { fc.addEventListener("submit", function (ev) { ev.preventDefault(); saveCampaign(); }); fc.addEventListener("input", function (ev) { unmark(ev.target); }); }
  }

  function unmark(el) { // a field being corrected loses its red mark at once; the message stays until the next save
    var i = el && el.name ? S.miss.indexOf(el.name) : -1; if (i < 0) return;
    S.miss.splice(i, 1); el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); var l = el.closest("label"); if (l) l.classList.remove("miss");
  }
  // Every problem at once: the message lists them all, the fields are marked, the first one is focused.
  function stop(errs, miss) {
    S.miss = miss; S.err = errs.join(" ") + " Nothing was saved."; paint(true);
    var first = S.mount && S.mount.querySelector("form [aria-invalid=true]"); if (first) first.focus(); else showErr();
  }
  function keep() {
    var f = S.mount && (S.mount.querySelector("#scr-add") || S.mount.querySelector("#scr-camp")); if (!f || !S.adding) return;
    f.querySelectorAll("input[name],select[name],textarea[name]").forEach(function (el) { S.adding[el.name] = String(el.value == null ? "" : el.value); });
  }

  // ---- people already known: anyone screened in any campaign here, and the POCT patients when the POCT screen has them ----
  function known(id) {
    var hit = null;
    S.campaigns.forEach(function (c) { parts(c).forEach(function (p) { if (!hit && pid(p.idCard) === id) hit = { name: str(p.name), phone: str(p.phone), dob: str(p.dob) }; }); });
    if (hit) return hit;
    var cl = window.__POCT_CLOUD, pats = cl && Array.isArray(cl.patients) ? cl.patients : [];
    pats.forEach(function (p) { if (!hit && p && p.patientId === id) hit = { name: str(p.name), phone: str(p.phone), dob: "" }; });
    return hit;
  }
  function lookup(raw) {
    var id = pid(raw); if (!S.adding || S.view !== "add" || S.adding.looked === id) return;
    S.adding.looked = id; keep();
    if (id) S.adding.idCard = id;
    var k = id ? known(id) : null, c = S.adding.camp, again = id ? parts(campOf(c.id) || c).filter(function (p) { return pid(p.idCard) === id; }) : [];
    if (k) { // fill only what is still empty: never overwrite what was typed
      if (!str(S.adding.name).trim()) S.adding.name = k.name;
      if (!str(S.adding.phone).trim()) S.adding.phone = k.phone;
      if (!str(S.adding.dob).trim()) S.adding.dob = k.dob;
    }
    S.adding.found = !!k;
    S.adding.before = again.length ? "This ID card was already screened in this campaign on " + dm(again[again.length - 1].date) + ". Recording again adds a second entry." : "";
    paint(true);
  }

  // A new person, shaped like the classic one (same keys, same defaults). The campaign is kept as it was read, to show
  // the right result fields even if the list refreshes.
  function fresh(c) {
    var a = { id: uid(), camp: copy(c), idCard: "", name: "", phone: "", email: "", dob: "", type: "Walk-in", date: today(), resultNotes: "", resultCategory: "", referral: "No referral needed", referralNotes: "" };
    var t = testOf(c); if (t) FIELDS[t].f.forEach(function (f) { a["r_" + f[0]] = ""; });
    return a;
  }
  function freshCamp() { return { id: uid(), name: "", type: CAMPAIGN_TYPES[0], startDate: today(), endDate: "", notes: "", status: "Active", location: "", targetScreenings: "" }; }

  // The person exactly as the classic form saves them: ID card normalised, text trimmed, results as numbers where the
  // field is a number (an empty one stays ""), every result field of the test present, and no follow-ups yet.
  function build() {
    var a = S.adding, t = testOf(a.camp), res = {};
    if (t) FIELDS[t].f.forEach(function (f) { var v = str(a["r_" + f[0]]).trim(); res[f[0]] = !f[3] && v ? parseFloat(v.replace(",", ".")) : v; });
    var raw = str(a.idCard).trim(), id = pid(raw);
    return { id: a.id, idCard: id || raw, name: str(a.name).trim(), phone: str(a.phone).trim(), email: str(a.email), dob: str(a.dob), type: str(a.type), date: str(a.date),
      resultNotes: str(a.resultNotes).trim(), resultCategory: str(a.resultCategory), referral: str(a.referral), referralNotes: str(a.referralNotes).trim(), poctResults: res, followUps: [] };
  }
  function showErr() { var x = S.mount && S.mount.querySelector(".scr-err"); if (x && x.scrollIntoView) try { x.scrollIntoView({ block: "center" }); } catch (e) {} }
  async function putOne(camp) {
    var r = await E.apiFetch("/screening/state", { method: "PUT", body: JSON.stringify({ state: { campaigns: [camp], deleted_ids: [] } }) });
    if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
  }

  async function saveScreening() {
    if (S.saving) return;
    keep();
    var a = S.adding, t = testOf(a.camp), errs = [], mk = []; S.err = ""; S.miss = [];
    if (!pid(a.idCard) && !str(a.name).trim()) { errs.push("Write the ID card or the name."); mk.push("idCard", "name"); }
    if (t) FIELDS[t].f.forEach(function (f) {
      var v = str(a["r_" + f[0]]).trim();
      if (f[4] && !v) { errs.push("Write the " + low(f[1]) + (f[2] ? " (" + f[2] + ")" : "") + "."); mk.push("r_" + f[0]); }
      else if (!f[3] && v && !numOk(v)) { errs.push("The " + low(f[1]) + " is not a number. Check it."); mk.push("r_" + f[0]); }
    });
    if (errs.length) return stop(errs, mk);
    // the ID card and the person (E.people.confirmPerson): asked before anything is saved; Go back keeps the form
    if (E.people && E.people.confirmPerson && pid(a.idCard)) {
      S.saving = true; paint(true);
      var asked = await E.people.confirmPerson({ name: a.name, id_card: pid(a.idCard), phone: a.phone, email: a.email }, { key: "scrreg", record: "screening" });
      S.saving = false;
      if (asked.action !== "save") {
        if (asked.action === "fill") { if (asked.field === "name") a.name = asked.value; else a.idCard = pid(asked.value); }
        paint(true); var back = S.mount && S.mount.querySelector("[name=" + (asked.field === "name" ? "name" : "idCard") + "]"); if (back) back.focus();
        return;
      }
      S.asked = asked;
    }
    var rec = build(), cid = a.camp.id;
    S.saving = true; paint(true);
    var has1 = function (list) { var c = list.filter(function (x) { return String(x.id) === String(cid); })[0]; return !!c && parts(c).some(function (p) { return String(p.id) === String(rec.id); }); };
    try {
      var all = await readAll(), now = all.filter(function (x) { return String(x.id) === String(cid); })[0]; // the campaign as stored right now, with everyone added since
      if (!now) { S.saving = false; S.err = "This campaign was deleted on another screen. Nothing was saved."; S.campaigns = S.campaigns.filter(function (x) { return String(x.id) !== String(cid); }); paint(true); return showErr(); }
      if (!has1(all)) { var out = copy(now); out.participants = parts(now).concat([rec]); await putOne(out); } // already there: an earlier press was saved
      doneScreening(rec, cid);
    } catch (x) {
      var got = false;
      if (x && x.network) { try { got = has1(await readAll()); } catch (e1) { got = false; } } // the answer was lost: look before saying it failed
      if (got) doneScreening(rec, cid);
      else { S.err = E.saveFailText(x); S.saving = false; return load(); }
    }
    S.saving = false; return load();
  }
  function doneScreening(rec, cid) {
    S.miss = [];
    if (E.linkPerson) E.linkPerson({ name: rec.name, id_card: rec.idCard, phone: rec.phone, email: rec.email, date_of_birth: rec.dob }, "register:screening", S.asked); S.asked = null; // one person in Customers, found or added
    S.adding = null; S.err = ""; S.view = "part"; S.campId = String(cid); S.partId = String(rec.id);
    var c = campOf(cid); if (c && !parts(c).some(function (p) { return String(p.id) === String(rec.id); })) c.participants = parts(c).concat([rec]);
    E.toast("Saved · screening for " + (rec.name || rec.idCard), "success");
    focusSel(".scr-acts-top [data-act=camp]");
  }

  async function saveCampaign() {
    if (S.saving) return;
    keep();
    var a = S.adding, errs = [], mk = []; S.err = ""; S.miss = [];
    if (!str(a.name).trim()) { errs.push("Write the campaign's name."); mk.push("name"); }
    if (has(a.targetScreenings) && !/^\d+$/.test(str(a.targetScreenings).trim())) { errs.push("Write the goal as a number of people, or leave it empty."); mk.push("targetScreenings"); }
    if (a.startDate && a.endDate && a.endDate < a.startDate) { errs.push("The end date is before the start date."); mk.push("endDate"); }
    if (errs.length) return stop(errs, mk);
    var rec = { id: a.id, name: str(a.name).trim(), type: str(a.type), startDate: str(a.startDate), endDate: str(a.endDate), notes: str(a.notes).trim(), status: str(a.status), location: str(a.location), targetScreenings: str(a.targetScreenings).trim(), participants: [] };
    S.saving = true; paint(true);
    var there = function (list) { return list.some(function (x) { return String(x.id) === String(rec.id); }); };
    try {
      if (!there(await readAll())) await putOne(rec); // already there: an earlier press was saved, and it is never sent over again
      doneCampaign(rec);
    } catch (x) {
      var got = false;
      if (x && x.network) { try { got = there(await readAll()); } catch (e1) { got = false; } }
      if (got) doneCampaign(rec);
      else { S.err = E.saveFailText(x); S.saving = false; return load(); }
    }
    S.saving = false; return load();
  }
  function doneCampaign(rec) {
    S.miss = [];
    S.adding = null; S.err = ""; S.view = "camp"; S.campId = String(rec.id); S.partId = ""; S.pq = "";
    if (!campOf(rec.id)) S.campaigns.unshift(rec);
    E.toast("Campaign created", "success");
    focusSel("[data-act=add]");
  }

  E.registerModule({
    id: "scrreg", title: "Screening campaigns", order: 3, icon: "🩺", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.view = "list"; S.campId = ""; S.partId = ""; S.adding = null; S.err = ""; S.miss = []; S.q = ""; S.pq = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("scrreg") < 0) E.UI2_DESTINATIONS.push("scrreg");
  if (E.UI2_PARENT) E.UI2_PARENT.scrreg = "services";
})();
