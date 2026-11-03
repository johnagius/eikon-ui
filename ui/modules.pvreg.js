/* Adverse reactions (pharmacovigilance), new layout: recent reports with a search, one report opened in full, and one
   form to record or correct a report with exactly the classic fields (patient, each suspected medicine, the reaction,
   the report and the reporter). Same endpoints as the classic screen: GET /pharmacovigilance/state and
   PUT /pharmacovigilance/state. The server upserts each report it is sent by its id and replaces that report whole, and
   removes only ids listed in deleted_ids, so a save sends just this one report, complete, and an empty deleted_ids.
   The id is made when the form opens and kept through retries, so a save whose answer is lost can never make two.
   An edit starts from the whole record as read and checks the report is still there, unchanged, before saving.
   Deleting, printing and the PDF form stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, reports: [], loading: false, error: "", q: "", view: "list", openId: "", adding: null, base: null, saving: false, err: "", force: "" };
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // The classic screen's lists, word for word (stored as these strings).
  var SERIOUSNESS = ["Non-serious", "Serious – Hospitalisation", "Serious – Life-threatening", "Serious – Disability", "Serious – Congenital anomaly", "Serious – Other medically important", "Fatal"];
  var OUTCOMES = ["Recovered", "Recovering", "Not recovered", "Recovered with sequelae", "Fatal", "Unknown"];
  var CAUSALITY = ["Certain", "Probable/Likely", "Possible", "Unlikely", "Conditional/Unclassified", "Unassessable"];
  var REPORT_TYPES = ["Initial", "Follow-up", "Final"];
  var STATUS_LIST = ["Draft", "Submitted to MPA", "Submitted to EMA (EudraVigilance)", "Closed"];
  var QUALS = ["Pharmacist", "Physician", "Nurse", "Patient/Consumer", "Other Healthcare Professional"];
  var ROUTES = ["Oral", "IV", "IM", "SC", "Topical", "Inhaled", "Rectal", "Other"];
  var SEXES = [["", "Not given"], ["Male", "Male"], ["Female", "Female"], ["Other", "Other"]];
  var MEDDRA = ["Abdominal pain", "Abdominal pain upper", "Acne", "Acute kidney injury", "Agranulocytosis", "Alopecia", "Anaemia", "Anaphylactic reaction", "Anaphylactic shock", "Angioedema",
    "Anxiety", "Appetite decreased", "Arrhythmia", "Arthralgia", "Asthenia", "Asthma", "Atrial fibrillation", "Back pain", "Blood glucose increased", "Blood pressure increased",
    "Bradycardia", "Bronchospasm", "Cardiac arrest", "Chest pain", "Chills", "Cholestasis", "Confusional state", "Constipation", "Convulsion", "Cough",
    "Cytolytic hepatitis", "Death", "Deep vein thrombosis", "Depression", "Dermatitis", "Diarrhoea", "Dizziness", "Drug eruption", "Drug hypersensitivity", "Drug interaction",
    "Dry mouth", "Dry skin", "Dyspepsia", "Dyspnoea", "Dysuria", "Eczema", "Eosinophilia", "Epistaxis", "Erythema", "Erythema multiforme",
    "Fatigue", "Feeling abnormal", "Flatulence", "Flushing", "Gastrointestinal haemorrhage", "Haemorrhage", "Hallucination", "Headache", "Hepatic failure", "Hepatitis",
    "Hepatotoxicity", "Hyperglycaemia", "Hyperkalaemia", "Hypersensitivity", "Hypertension", "Hypoglycaemia", "Hypokalaemia", "Hyponatraemia", "Hypotension", "Hypothyroidism",
    "Infection", "Infusion related reaction", "Injection site reaction", "Insomnia", "Interstitial lung disease", "Jaundice", "Lactic acidosis", "Leukocytosis", "Leukopenia", "Liver injury",
    "Malaise", "Medication error", "Methaemoglobinaemia", "Muscle spasms", "Myalgia", "Myocardial infarction", "Nausea", "Nephritis", "Nephrotoxicity", "Neutropenia",
    "Oedema", "Oedema peripheral", "Overdose", "Pain", "Pain in extremity", "Palpitations", "Pancytopenia", "Pancreatitis", "Paraesthesia", "Photosensitivity reaction",
    "Pneumonia", "Pruritus", "Pulmonary embolism", "Pyrexia", "QT prolongation", "Rash", "Rash maculopapular", "Renal failure", "Respiratory failure", "Rhabdomyolysis",
    "Rhinitis", "Seizure", "Sepsis", "Skin ulcer", "Somnolence", "Stevens-Johnson syndrome", "Stomatitis", "Stroke", "Syncope", "Tachycardia",
    "Tendinitis", "Thrombocytopenia", "Thrombosis", "Tinnitus", "Toxic epidermal necrolysis", "Tremor", "Urticaria", "Ventricular tachycardia", "Vertigo", "Vision blurred",
    "Vomiting", "Weight decreased", "Weight increased"];
  // Every top-level field the classic form writes (the record also carries id, created_at, updated_at and drugs).
  var FIELDS = ["status", "report_type", "pt_initials", "pt_age", "pt_sex", "pt_weight", "pt_height", "pt_dob_day", "pt_dob_month", "pt_id", "pt_medical_history",
    "reaction_description", "reaction_start", "reaction_stop", "reaction_seriousness", "reaction_outcome", "reaction_causality", "reaction_meddra",
    "reporter_name", "reporter_qualification", "reporter_email", "reporter_phone", "reporter_institution", "reporter_address", "report_date", "notes"];
  var DRUG = ["name", "dose", "route", "frequency", "start_date", "stop_date", "indication", "batch_no", "mah"];

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function today() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()); }
  function uid() { return "pv_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); } // same shape as the classic ids
  function low(s) { return String(s == null ? "" : s).toLowerCase(); }
  function str(v) { return v == null ? "" : String(v); }
  function dm(s) { // 3 Nov (this year) or 3 Nov 2025; a stored ISO time is read by its date
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || "")); if (!m) return String(s || "");
    return Number(m[3]) + " " + MON[Number(m[2]) - 1] + (Number(m[1]) === new Date().getFullYear() ? "" : " " + m[1]);
  }
  function fmtDob(day, month, age) { // as the classic report prints it: the year worked out from the age
    day = str(day).trim(); month = str(month).trim(); age = str(age).trim();
    if (!day && !month) return "";
    if (!age) return (day || "??") + "/" + (month || "??") + "/????";
    var now = new Date(), y = now.getFullYear() - parseInt(age, 10), m = parseInt(month, 10), d = parseInt(day, 10);
    if (m && d && (m > now.getMonth() + 1 || (m === now.getMonth() + 1 && d > now.getDate()))) y--;
    return (day || "??") + "/" + (month || "??") + "/" + y;
  }
  function blankDrug() { return { name: "", dose: "", route: "Oral", frequency: "", start_date: "", stop_date: "", indication: "", batch_no: "", mah: "" }; }
  function copy(o) { return JSON.parse(JSON.stringify(o)); }
  function when(r) { return str(r.report_date || r.created_at); }
  function serious(r) { var s = str(r.reaction_seriousness); return s.indexOf("Serious") === 0 || s === "Fatal"; }
  function drugsOf(r) { return (Array.isArray(r.drugs) ? r.drugs : []).filter(function (d) { return d && str(d.name).trim(); }); }

  function css() {
    if (document.getElementById("eikon-pvreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-pvreg-css";
    st.textContent =
      ".pvr{max-width:880px;margin:0 auto}" +
      ".pvr-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".pvr-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".pvr h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.pvr-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".pvr-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".pvr-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.pvr-btn:disabled{opacity:.55;cursor:default}.pvr-btn.t{border:0;background:none;color:var(--accent);padding:0 4px}" +
      ".pvr-q{width:100%;box-sizing:border-box;height:40px;border-radius:12px;border:1px solid var(--border);background:var(--panel2);color:var(--text);font:inherit;font-size:16px;padding:0 12px;outline:0;margin-top:16px}" +
      ".pvr-q:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:2px}" +
      ".pvr-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px;justify-content:space-between}.pvr-lab b{color:var(--text)}" +
      ".pvr-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".pvr-row{display:flex;gap:12px;align-items:center;width:100%;box-sizing:border-box;text-align:left;font:inherit;color:var(--text);background:none;border:0;border-top:.5px solid var(--border);padding:11px 16px;cursor:pointer}.pvr-row:first-child{border-top:0}" +
      ".pvr-row:hover{background:rgba(118,118,128,.06)}.pvr-row:focus-visible{outline:3px solid rgba(10,143,106,.5);outline-offset:-3px}" +
      ".pvr-row .t{flex:1;min-width:0}.pvr-row b{display:block;font-size:15px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pvr-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".pvr-row .a{display:flex;flex-direction:column;align-items:flex-end;gap:5px;flex:0 0 auto;max-width:44%}" +
      ".pvr-pill{font-size:12px;font-weight:600;padding:3px 9px;border-radius:999px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:100%;background:rgba(118,118,128,.14);color:var(--muted)}" +
      ".pvr-pill.s{background:rgba(215,38,28,.12);color:var(--danger)}.pvr-pill.w{background:rgba(201,138,18,.16);color:var(--warn,#8A5A08)}.pvr-pill.ok{background:rgba(10,143,106,.12);color:var(--accent)}" +
      ".pvr-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:4px 0;margin-top:10px}" +
      ".pvr-form label,.pvr-form .two{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}.pvr-form>label:first-child,.pvr-form>.two:first-child{border-top:0}" +
      ".pvr-form label>span{flex:0 0 112px;font-size:15px}.pvr-form input,.pvr-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".pvr-form label:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      ".pvr-form label.tx{display:block;padding:10px 14px}.pvr-form label.tx>span{display:block;margin-bottom:4px}" +
      ".pvr-form textarea{display:block;width:100%;box-sizing:border-box;min-height:72px;resize:vertical;border:1px solid var(--border);border-radius:10px;background:transparent;font:inherit;font-size:16px;color:inherit;padding:8px 10px;outline:0}" +
      ".pvr-form .two{gap:8px}.pvr-form .two>span{flex:0 0 112px;font-size:15px}.pvr-form .two:focus-within{box-shadow:inset 3px 0 0 var(--accent)}" +
      ".pvr-form small{display:block;color:var(--muted);font-size:12.5px;padding:0 14px 8px}" +
      ".pvr-hd{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 0;display:flex;justify-content:space-between;align-items:center;gap:8px}" +
      ".pvr-acts{display:flex;gap:8px;justify-content:space-between;align-items:center;flex-wrap:wrap;margin-top:14px}.pvr-acts span{display:flex;gap:8px;margin-left:auto}" +
      ".pvr-err{color:var(--danger);font-size:13.5px;margin-top:12px}" +
      ".pvr-one{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:8px}" +
      ".pvr-one div{display:flex;gap:12px;padding:9px 16px;border-top:.5px solid var(--border);font-size:14.5px}.pvr-one div:first-child{border-top:0}" +
      ".pvr-one dt{flex:0 0 120px;color:var(--muted);margin:0}.pvr-one dd{flex:1;min-width:0;margin:0;overflow-wrap:anywhere;white-space:pre-wrap}" +
      ".pvr-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".pvr-note{font-size:12.5px;color:var(--muted);margin-top:14px}" +
      "@media (max-width:600px){.pvr{padding:4px 16px 0}.pvr h1{font-size:32px}.pvr-form label>span,.pvr-form .two>span{flex-basis:96px}.pvr-one dt{flex-basis:96px}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .pvr-pill.s,html[data-ui2]:not([data-ui2-visit]) .pvr-err{color:#FF7A72}html[data-ui2]:not([data-ui2-visit]) .pvr-pill.w{color:#F2B84B}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/pharmacovigilance/state", { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not load the reports");
      S.reports = (Array.isArray(r.reports) ? r.reports : (r.state && Array.isArray(r.state.reports) ? r.state.reports : []))
        .filter(function (x) { return x && x.id; })
        .sort(function (a, b) { return when(b).localeCompare(when(a)); });
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. Try again in a moment." : String((e && (e.message || e)) || "Could not load the reports"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  // ── pieces ─────────────────────────────────────────────────────────────
  function opts(list, val) { // a stored value the lists no longer have is kept as an option, so saving never changes it
    var h = "", seen = false;
    list.forEach(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; if (v === val) seen = true; h += '<option value="' + esc(v) + '"' + (v === val ? " selected" : "") + ">" + esc(t) + "</option>"; });
    if (!seen && val) h = '<option value="' + esc(val) + '" selected>' + esc(val) + "</option>" + h;
    return h;
  }
  function rowHtml(r) {
    var d = drugsOf(r).map(function (x) { return x.name; }).join(", ");
    var who = [str(r.pt_initials).trim(), [str(r.pt_sex), r.pt_age ? r.pt_age + "y" : ""].filter(Boolean).join(" ")].filter(Boolean).join(" ");
    var st = str(r.status || "Draft"), stc = st === "Draft" ? "w" : st === "Closed" ? "" : "ok";
    return '<button class="pvr-row" data-act="open" data-id="' + esc(r.id) + '"><div class="t"><b>' + esc(r.reaction_meddra || r.reaction_description || "Reaction not described") + "</b><span>" +
      esc([dm(when(r)), who, d].filter(Boolean).join(" · ")) + '</span></div><div class="a">' +
      (serious(r) ? '<span class="pvr-pill s">' + esc(r.reaction_seriousness) + "</span>" : "") + '<span class="pvr-pill ' + stc + '">' + esc(st) + "</span></div></button>";
  }
  function dl(pairs) {
    return '<dl class="pvr-one">' + pairs.filter(function (p) { return str(p[1]).trim(); }).map(function (p) { return "<div><dt>" + esc(p[0]) + "</dt><dd>" + esc(p[1]) + "</dd></div>"; }).join("") + "</dl>";
  }
  function oneHtml(r) {
    var h = '<div class="pvr-hd">Patient</div>' + dl([["Initials", r.pt_initials], ["Age", r.pt_age ? r.pt_age + " years" : ""], ["Sex", r.pt_sex], ["Date of birth", fmtDob(r.pt_dob_day, r.pt_dob_month, r.pt_age)],
      ["Weight", r.pt_weight ? r.pt_weight + " kg" : ""], ["Height", r.pt_height ? r.pt_height + " cm" : ""], ["Patient ID", r.pt_id], ["Medical history", r.pt_medical_history]]);
    var ds = drugsOf(r);
    h += ds.length ? ds.map(function (d, i) {
      return '<div class="pvr-hd">Suspected medicine' + (ds.length > 1 ? " " + (i + 1) : "") + "</div>" + dl([["Medicine", d.name], ["Dose", d.dose], ["Route", d.route], ["Frequency", d.frequency], ["Started", dm(d.start_date)], ["Stopped", dm(d.stop_date)], ["Indication", d.indication], ["Batch no.", d.batch_no], ["MAH", d.mah]]);
    }).join("") : '<div class="pvr-hd">Suspected medicine</div><div class="pvr-quiet">No medicine recorded.</div>';
    h += '<div class="pvr-hd">Reaction</div>' + dl([["MedDRA term", r.reaction_meddra], ["Description", r.reaction_description], ["Started", dm(r.reaction_start)], ["Stopped", dm(r.reaction_stop)],
      ["Seriousness", r.reaction_seriousness], ["Outcome", r.reaction_outcome], ["Causality", r.reaction_causality]]);
    h += '<div class="pvr-hd">Report</div>' + dl([["Date", dm(r.report_date)], ["Type", r.report_type], ["Status", r.status], ["Reporter", r.reporter_name], ["Qualification", r.reporter_qualification],
      ["Institution", r.reporter_institution], ["Phone", r.reporter_phone], ["Email", r.reporter_email], ["Address", r.reporter_address], ["Notes", r.notes]]);
    return h;
  }
  function formHtml() {
    var a = S.adding, editing = !!S.base;
    var fld = function (k, label, extra) { return "<label><span>" + label + '</span><input name="' + k + '" value="' + esc(a[k]) + '"' + (extra || "") + "></label>"; };
    var sel = function (k, label, list) { return "<label><span>" + label + '</span><select name="' + k + '">' + opts(list, str(a[k])) + "</select></label>"; };
    var txt = function (k, label, ph) { return '<label class="tx"><span>' + label + '</span><textarea name="' + k + '" placeholder="' + esc(ph || "") + '">' + esc(a[k]) + "</textarea></label>"; };
    var days = [["", "Day"]]; for (var i = 1; i <= 31; i++) days.push([String(i), String(i)]);
    var mons = [["", "Month"]].concat(MON.map(function (m, j) { return [String(j + 1), m]; }));
    var h = '<form id="pvr-add" autocomplete="off" novalidate>' +
      '<div class="pvr-hd">Patient</div><div class="pvr-form">' +
      fld("pt_initials", "Initials", ' placeholder="e.g. J.D." autocapitalize="characters"') + "<small>Initials only, no full names.</small>" +
      fld("pt_age", "Age (years)", ' inputmode="numeric" placeholder="e.g. 65"') + sel("pt_sex", "Sex", SEXES) +
      fld("pt_weight", "Weight (kg)", ' inputmode="decimal" placeholder="Optional"') + fld("pt_height", "Height (cm)", ' inputmode="decimal" placeholder="Optional"') +
      '<div class="two" role="group" aria-label="Birthday"><span>Birthday</span><select name="pt_dob_day" aria-label="Birthday day">' + opts(days, str(a.pt_dob_day)) + '</select><select name="pt_dob_month" aria-label="Birthday month">' + opts(mons, str(a.pt_dob_month)) + "</select></div>" +
      "<small>Day and month; the year is worked out from the age.</small>" +
      fld("pt_id", "Patient ID", ' placeholder="ID card or passport"') + txt("pt_medical_history", "Relevant medical history", "Allergies, conditions, past reactions") + "</div>";
    h += a.drugs.map(function (d, i) {
      var df = function (k, label, extra) { return "<label><span>" + label + '</span><input data-i="' + i + '" data-k="' + k + '" value="' + esc(d[k]) + '"' + (extra || "") + "></label>"; };
      return '<div class="pvr-hd"><span>Suspected medicine' + (a.drugs.length > 1 ? " " + (i + 1) : "") + "</span>" + (a.drugs.length > 1 ? '<button type="button" class="pvr-btn t" data-act="drug-rm" data-i="' + i + '" aria-label="Remove medicine ' + (i + 1) + '">Remove</button>' : "") + '</div><div class="pvr-form">' +
        df("name", "Medicine", ' placeholder="e.g. Amoxicillin 500mg"') + df("dose", "Dose", ' placeholder="e.g. 500mg"') +
        '<label><span>Route</span><select data-i="' + i + '" data-k="route">' + opts(ROUTES, str(d.route)) + "</select></label>" +
        df("frequency", "Frequency", ' placeholder="e.g. TDS, BD"') + df("start_date", "Started", ' type="date"') + df("stop_date", "Stopped", ' type="date"') +
        df("indication", "Indication", ' placeholder="e.g. URTI"') + df("batch_no", "Batch no.", ' placeholder="Batch or lot"') + df("mah", "MAH", ' placeholder="Marketing auth. holder"') + "</div>";
    }).join("");
    h += '<div style="margin-top:8px"><button type="button" class="pvr-btn t" data-act="drug-add">Add another medicine</button></div>';
    h += '<div class="pvr-hd">Reaction</div><div class="pvr-form">' +
      fld("reaction_meddra", "MedDRA term", ' list="pvr-meddra" placeholder="e.g. Rash, Nausea"') + txt("reaction_description", "What happened", "Onset, symptoms, course, any lab results") +
      fld("reaction_start", "Started", ' type="date"') + fld("reaction_stop", "Stopped", ' type="date"') +
      sel("reaction_seriousness", "Seriousness", SERIOUSNESS) + sel("reaction_outcome", "Outcome", OUTCOMES) + sel("reaction_causality", "Causality", CAUSALITY) + "<small>Causality by the WHO-UMC scale.</small></div>";
    h += '<div class="pvr-hd">Report</div><div class="pvr-form">' +
      fld("report_date", "Report date", ' type="date"') + sel("report_type", "Type", REPORT_TYPES) + sel("status", "Status", STATUS_LIST) + "</div>";
    h += '<div class="pvr-hd">Reporter</div><div class="pvr-form">' +
      fld("reporter_name", "Name", ' placeholder="Full name"') + sel("reporter_qualification", "Qualification", QUALS) +
      fld("reporter_email", "Email", ' type="email" placeholder="Optional"') + fld("reporter_phone", "Phone", ' type="tel" placeholder="+356 …"') +
      fld("reporter_institution", "Pharmacy", ' placeholder="Pharmacy or institution"') + fld("reporter_address", "Address", ' placeholder="Business address"') +
      txt("notes", "Additional notes", "Anything else") + "</div>";
    h += (S.err ? '<div class="pvr-err" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="pvr-acts"><span><button type="button" class="pvr-btn" data-act="form-cancel">Cancel</button><button type="submit" class="pvr-btn p"' + (S.saving ? " disabled" : "") + ">" +
      (S.saving ? "Saving…" : S.force ? "Save mine over it" : editing ? "Save changes" : "Record") + "</button></span></div>" +
      '<datalist id="pvr-meddra">' + MEDDRA.map(function (t) { return '<option value="' + esc(t) + '">'; }).join("") + "</datalist></form>";
    return h;
  }

  // The reports of any month (from the reports already read), and on paper with the classic list's columns
  // (the classic screen prints one report at a time).
  var HIST = { local: true, title: "By month", label: "Reports made", nowText: "No reaction reported this month yet.", dep: function () { return S.loading ? undefined : S.reports; },
    active: function () { return E.state.activeModuleId === "pvreg" && S.view === "list"; }, paint: function () { paint(); },
    fetch: function (ym) { return Promise.resolve(S.reports.filter(function (r) { return when(r).slice(0, 7) === ym; }).sort(function (a, b) { return when(b).localeCompare(when(a)); })); },
    row: function (r) { return { t: r.reaction_meddra || r.reaction_description || "Reaction not described", s: [dm(when(r)), r.pt_initials, drugsOf(r).map(function (d) { return d.name; }).join(", ")].filter(Boolean).join(" · "), r: str(r.status || "Draft") }; },
    print: function (ym, list) { printMonth(ym, list); } };
  function printMonth(ym, list) {
    var rows = list.slice().sort(function (a, b) { return when(a).localeCompare(when(b)); });
    E.months.print({ register: "Adverse reactions", month: ym, landscape: true, sections: [{ cols: ["Date", "Patient", "Drug(s)", "Reaction", "Seriousness", "Status"],
      rows: rows.map(function (r) { return [E.months.dmy(when(r)), [r.pt_initials, r.pt_id].filter(Boolean).join(" · "), drugsOf(r).map(function (d) { return d.name; }).join(", "), r.reaction_meddra || r.reaction_description || "", r.reaction_seriousness || "", r.status || "Draft"]; }) }] });
  }
  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "pvreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var qi = m.querySelector("#pvr-q"); if (qi) S.q = qi.value;
    var h = '<div class="pvr"><button class="pvr-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("pvreg")) + '</button>';
    var one = S.view === "one" ? S.reports.filter(function (r) { return String(r.id) === S.openId; })[0] : null;
    if (S.view === "form" && S.adding) {
      h += '<div class="pvr-top"><div><h1>' + (S.base ? "Correct the report" : "Record a reaction") + '</h1><p class="pvr-sub">Fill in what you know; the rest can be added later.</p></div></div>' + formHtml();
    } else if (S.view === "one" && one) {
      h += '<div class="pvr-top"><div><h1 style="overflow-wrap:anywhere">' + esc(one.reaction_meddra || one.reaction_description || "Reaction") + '</h1><p class="pvr-sub">' + esc([dm(when(one)), one.report_type, one.status].filter(Boolean).join(" · ")) + "</p></div>" +
        '<span style="display:flex;gap:8px"><button class="pvr-btn" data-act="list">All reports</button><button class="pvr-btn p" data-act="edit" data-id="' + esc(one.id) + '">Correct</button></span></div>' + oneHtml(one);
    } else {
      h += '<div class="pvr-top"><div><h1>Adverse reactions</h1><p class="pvr-sub">Reactions to medicines reported here, and where each report stands.</p></div><button class="pvr-btn p" data-act="add">Record a reaction</button></div>';
      if (S.loading && !S.reports.length) h += '<div class="pvr-quiet">Opening the reports…</div>';
      else if (S.error) h += '<div class="pvr-quiet">' + esc(S.error) + "</div>";
      else if (!S.reports.length) h += '<div class="pvr-quiet">No reaction reported yet. When a patient has a reaction to a medicine, record it here.</div>';
      else {
        h += '<input class="pvr-q" id="pvr-q" type="search" aria-label="Search reports" placeholder="Search initials, medicine, reaction" value="' + esc(S.q) + '">';
        var q = low(S.q).trim(), list = S.reports.filter(function (r) {
          return !q || [r.pt_initials, r.pt_id, r.reaction_description, r.reaction_meddra, r.status, r.reporter_name, r.reaction_seriousness].concat(drugsOf(r).map(function (d) { return d.name; })).some(function (v) { return low(v).indexOf(q) >= 0; });
        });
        var drafts = S.reports.filter(function (r) { return str(r.status || "Draft") === "Draft"; }).length, shown = list.slice(0, 60);
        h += '<div class="pvr-lab"><span>' + (q ? "Matching" : "Recent") + " <b>" + list.length + "</b></span>" + (drafts && !q ? "<span>Drafts <b>" + drafts + "</b></span>" : "") + "</div>";
        h += shown.length ? '<div class="pvr-list">' + shown.map(rowHtml).join("") + "</div>" : '<div class="pvr-quiet">No report matches.</div>';
        if (list.length > shown.length) h += '<p class="pvr-note">Showing the newest 60. Search to find an older one, or go by month below.</p>';
        if (!q) h += E.months.history("pvreg", HIST); // every report of a month, any month, and its printout
      }
    }
    h += '<p class="pvr-note">Deleting a report, printing it and the PDF form are in the <a href="#" data-act="classic" style="color:var(--accent)">classic screen</a>.</p></div>';
    var ae = document.activeElement, back = "";
    if (ae && m.contains(ae)) back = ae.id === "pvr-q" ? "#pvr-q" : ae.name ? "[name=" + ae.name + "]" : ae.getAttribute("data-k") ? '[data-i="' + ae.getAttribute("data-i") + '"][data-k="' + ae.getAttribute("data-k") + '"]' : "";
    m.innerHTML = h;
    if (back) { var again = m.querySelector(back); if (again) { again.focus(); try { if (again.type === "text" || again.type === "search" || again.tagName === "TEXTAREA") { var L = again.value.length; again.setSelectionRange(L, L); } } catch (x) {} } } // typing keeps its place
    E.months.wireHistory(m, "pvreg");
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("pvreg");
        else if (act === "add") { S.adding = fresh(); S.base = null; S.err = ""; S.force = ""; S.view = "form"; paint(true); window.scrollTo(0, 0); focus("pt_initials"); }
        else if (act === "open") { S.openId = b.getAttribute("data-id"); S.view = "one"; paint(true); window.scrollTo(0, 0); focusSel("[data-act=list]"); }
        else if (act === "list") { var id = S.openId; S.view = "list"; paint(true); focusSel('.pvr-row[data-id="' + (window.CSS && CSS.escape ? CSS.escape(id) : id) + '"]'); }
        else if (act === "edit") { startEdit(b.getAttribute("data-id")); }
        else if (act === "form-cancel") { S.err = ""; S.force = ""; S.view = S.base ? "one" : "list"; S.adding = null; S.base = null; paint(true); }
        else if (act === "drug-add") { keep(); S.adding.drugs.push(blankDrug()); paint(true); focusSel('[data-i="' + (S.adding.drugs.length - 1) + '"][data-k=name]'); }
        else if (act === "drug-rm") { keep(); S.adding.drugs.splice(Number(b.getAttribute("data-i")), 1); paint(true); }
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "pvreg"); } catch (x) {} E.openClassic("pharmacovigilance"); }
      });
    });
    var qn = m.querySelector("#pvr-q"); if (qn) qn.addEventListener("input", function () { paint(); });
    var f = m.querySelector("#pvr-add"); if (f) f.addEventListener("submit", function (ev) { ev.preventDefault(); save(); });
  }
  function focusSel(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) x.focus(); }, 30); }
  function focus(n) { focusSel("[name=" + n + "]"); }
  function showErr() { var x = S.mount && S.mount.querySelector(".pvr-err"); if (x && x.scrollIntoView) try { x.scrollIntoView({ block: "center" }); } catch (e) {} } // the message sits under a long form

  function keep() {
    var f = S.mount && S.mount.querySelector("#pvr-add"); if (!f || !S.adding) return;
    FIELDS.forEach(function (k) { var el = f.querySelector("[name=" + k + "]"); if (el) S.adding[k] = String(el.value == null ? "" : el.value); });
    f.querySelectorAll("[data-i][data-k]").forEach(function (el) { var d = S.adding.drugs[Number(el.getAttribute("data-i"))]; if (d) d[el.getAttribute("data-k")] = String(el.value == null ? "" : el.value); });
  }

  // A new report, shaped like the classic one. The reporter is filled from the signed-in person and, when they have
  // reported before, from their last report (only contact details; everything stays editable).
  function fresh() {
    var u = E.state.user || {}, now = new Date().toISOString(), name = str(u.full_name).trim();
    var prev = name ? S.reports.filter(function (r) { return low(r.reporter_name).trim() === low(name); })[0] : null;
    return { id: uid(), created_at: now, updated_at: now, status: "Draft", report_type: "Initial",
      pt_initials: "", pt_age: "", pt_sex: "", pt_weight: "", pt_height: "", pt_dob_day: "", pt_dob_month: "", pt_id: "", pt_medical_history: "",
      drugs: [blankDrug()],
      reaction_description: "", reaction_start: "", reaction_stop: "", reaction_seriousness: "Non-serious", reaction_outcome: "Unknown", reaction_causality: "Possible", reaction_meddra: "",
      reporter_name: name, reporter_qualification: prev ? str(prev.reporter_qualification || "Pharmacist") : "Pharmacist", reporter_email: prev ? str(prev.reporter_email) : "",
      reporter_phone: prev ? str(prev.reporter_phone) : "", reporter_institution: str(u.location_name), reporter_address: prev ? str(prev.reporter_address) : "",
      report_date: today(), notes: "" };
  }
  function startEdit(id) {
    var r = S.reports.filter(function (x) { return String(x.id) === String(id); })[0]; if (!r) return;
    S.base = copy(r); S.adding = copy(r); S.err = ""; S.force = ""; S.openId = String(r.id);
    FIELDS.forEach(function (k) { S.adding[k] = str(S.adding[k]); });
    if (!Array.isArray(S.adding.drugs) || !S.adding.drugs.length) S.adding.drugs = [blankDrug()];
    S.adding.drugs = S.adding.drugs.map(function (d) { var o = Object.assign({}, d || {}); DRUG.forEach(function (k) { o[k] = str(o[k]); }); return o; });
    S.view = "form"; paint(true); window.scrollTo(0, 0); focus("pt_initials");
  }

  // The whole report: for an edit, the record as read with the form laid over it (fields the form does not show are
  // kept); for a new one, the classic shape. Medicine rows left completely empty are dropped.
  function build() {
    var a = S.adding, rec = S.base ? copy(S.base) : { id: a.id, created_at: a.created_at };
    FIELDS.forEach(function (k) { rec[k] = str(a[k]); });
    rec.drugs = a.drugs.filter(function (d) { return DRUG.some(function (k) { return k !== "route" && str(d[k]).trim(); }); })
      .map(function (d) { var o = {}; DRUG.forEach(function (k) { o[k] = str(d[k]); }); Object.keys(d).forEach(function (k) { if (DRUG.indexOf(k) < 0) o[k] = d[k]; }); return o; });
    rec.id = S.base ? S.base.id : a.id; if (!rec.created_at) rec.created_at = a.created_at || new Date().toISOString();
    rec.updated_at = new Date().toISOString();
    return rec;
  }
  async function readAll() { var r = await E.apiFetch("/pharmacovigilance/state", { method: "GET" }); if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the reports"); return (Array.isArray(r.reports) ? r.reports : (r.state && r.state.reports) || []); }

  async function save() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    // the classic screen's three checks
    if (!str(a.pt_initials).trim() && !str(a.pt_age).trim()) S.err = "Write the patient's initials or age. Nothing was saved.";
    else if (!a.drugs.some(function (d) { return str(d.name).trim(); })) S.err = "Write at least one suspected medicine. Nothing was saved.";
    else if (!str(a.reaction_description).trim() && !str(a.reaction_meddra).trim()) S.err = "Describe the reaction or choose a MedDRA term. Nothing was saved.";
    if (S.err) { paint(true); return showErr(); }
    var rec = build(), editing = !!S.base;
    S.saving = true; paint(true);
    try {
      if (editing) { // still there, and nobody changed it since it was opened? (a deleted report must not come back)
        var now = (await readAll()).filter(function (x) { return String(x.id) === String(rec.id); })[0];
        if (!now) { S.saving = false; S.err = "This report was deleted on another screen. Nothing was saved."; S.reports = S.reports.filter(function (x) { return String(x.id) !== String(rec.id); }); paint(true); return showErr(); }
        if (JSON.stringify(now) !== JSON.stringify(S.base) && S.force !== String(now.updated_at || "?")) {
          S.saving = false; S.force = String(now.updated_at || "?");
          S.err = "Someone changed this report on another screen since you opened it. Press Save mine over it to keep your version, or Cancel to see theirs."; paint(true); return showErr();
        }
      }
      var r = await E.apiFetch("/pharmacovigilance/state", { method: "PUT", body: JSON.stringify({ state: { reports: [rec], deleted_ids: [] } }) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      done(rec, editing);
    } catch (x) {
      var got = false;
      if (x && x.network) { // the answer was lost: look before anything is sent again (the same id is kept, so a retry can never add a second report)
        try { got = (await readAll()).some(function (y) { return String(y.id) === String(rec.id) && String(y.updated_at) === String(rec.updated_at); }); } catch (e1) { got = false; }
      }
      if (got) done(rec, editing);
      else { S.err = E.saveFailText(x); S.saving = false; return load(); }
    }
    S.saving = false; return load();
  }
  function done(rec, editing) {
    S.adding = null; S.base = null; S.force = ""; S.err = "";
    S.openId = String(rec.id); S.view = "one";
    var i = -1; S.reports.forEach(function (x, j) { if (String(x.id) === String(rec.id)) i = j; });
    if (i >= 0) S.reports[i] = rec; else S.reports.unshift(rec);
    E.toast(editing ? "Report corrected" : "Reaction recorded", "success");
  }

  E.registerModule({
    id: "pvreg", title: "Adverse reactions", order: 3, icon: "!", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; E.months.historyReset("pvreg"); S.view = "list"; S.openId = ""; S.adding = null; S.base = null; S.err = ""; S.force = ""; S.q = ""; css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("pvreg") < 0) E.UI2_DESTINATIONS.push("pvreg");
  if (E.UI2_PARENT) E.UI2_PARENT.pvreg = "services";
})();
