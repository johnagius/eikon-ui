/* Point-of-care tests (POCT), new layout: record a test for a patient (blood pressure, glucose, HbA1c, cholesterol,
   weight/BMI, urine dipstick), see the latest tests, and open one patient's history with the latest result of each test.
   Same endpoint and the same record and patient shapes as the classic screen (GET/PUT /poct/state). The PUT is an upsert
   by id: a record and a patient are each sent whole (the server keeps exactly what is sent for that id), nothing else is
   touched, and nothing is ever deleted from here. A record keeps its id across retries, so a save whose answer was lost
   can be pressed again without making a second record. The patient's master card is merged by the classic rules
   (a different name or phone for a known ID card is noted as a conflict, not written over).
   High/low marks are a reading guide for adults and are only shown, never saved.
   Editing, deleting, printing, the patients list with its flags, CSV export and import stay in the classic screen. */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var S = { mount: null, records: [], patients: [], loading: false, error: "", q: "", view: null, adding: null, saving: false, err: "", miss: [], lastType: "" };
  try { S.lastType = localStorage.getItem("eikon_pocreg_type") || ""; } catch (e) { S.lastType = ""; } // the test this person records most opens first
  var MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var TYPES = [["bp", "Blood pressure"], ["bg", "Glucose"], ["hba1c", "HbA1c"], ["chol", "Cholesterol"], ["bmi", "Weight / BMI"], ["urine", "Urine"]];
  // The label each record carries, exactly as the classic screen writes it
  var LABEL = { bp: "Blood Pressure", urine: "Urine (Combur 9)", hba1c: "HbA1c", bg: "Blood Glucose", chol: "Cholesterol", bmi: "Weight / BMI" };
  var NICE = { bp: "Blood pressure", urine: "Urine dipstick", hba1c: "HbA1c", bg: "Blood glucose", chol: "Cholesterol", bmi: "Weight and BMI" };
  var SEMI = ["Negative", "Trace", "+", "++", "+++"];
  var URINE = [["leu", "Leukocytes", SEMI, "Negative"], ["nit", "Nitrite", ["Negative", "Positive"], "Negative"], ["uro", "Urobilinogen", ["Normal", "+", "++", "+++"], "Normal"],
    ["pro", "Protein", SEMI, "Negative"], ["ph", "pH", ["5.0", "5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"], "7.0"], ["bld", "Blood", SEMI, "Negative"],
    ["ket", "Ketone", SEMI, "Negative"], ["glu", "Glucose", SEMI, "Negative"]];
  var PAT = ["patientId", "name", "phone", "age", "address"];
  var RES = { bp: ["sys", "dia", "pulse", "arm", "position"], bg: ["glucose", "timing"], hba1c: ["pct", "mmol"], chol: ["tc", "hdl", "ldl", "tg", "fasting"], bmi: ["weight", "height", "waist"], urine: ["leu", "nit", "uro", "pro", "ph", "bld", "ket", "glu", "appearance"] };

  function esc(s) { return E.escapeHtml ? E.escapeHtml(String(s == null ? "" : s)) : String(s == null ? "" : s); }
  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function must(s) { return String(s == null ? "" : s).trim(); }
  function lower(s) { return String(s || "").toLowerCase(); }
  function num(v) { var s = must(v).replace(",", "."); if (!s) return null; var n = Number(s); return isNaN(n) ? null : n; } // a comma, as some keyboards type it
  function nowLocal() { var d = new Date(); return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes()); }
  function uid() { return "r_" + Date.now() + "_" + Math.random().toString(16).slice(2); } // same form as the classic ids
  function clone(v) { try { return JSON.parse(JSON.stringify(v)); } catch (e) { return v; } }
  // Same rule as the classic screen: 123M -> 0000123M; a passport stays as typed (upper case, no spaces)
  function pid(raw) { var s = must(raw).toUpperCase().replace(/\s+/g, ""), m = /^(\d{1,7})([A-Z])$/.exec(s); return m ? ("0000000" + m[1]).slice(-7) + m[2] : s; }
  function when(iso) {
    var d = new Date(iso); if (isNaN(d.getTime())) return "";
    var t = new Date(), hm = pad(d.getHours()) + ":" + pad(d.getMinutes());
    if (d.toDateString() === t.toDateString()) return "Today " + hm;
    return d.getDate() + " " + MON[d.getMonth()] + (d.getFullYear() !== t.getFullYear() ? " " + d.getFullYear() : "") + ", " + hm;
  }
  function newest(a, b) { var x = new Date(a.performedAtIso).getTime(), y = new Date(b.performedAtIso).getTime(); return (isNaN(y) ? 0 : y) - (isNaN(x) ? 0 : x); }
  function has(v) { return v !== null && v !== undefined && String(v).trim() !== ""; }

  // ---- the classic screen's calculations, unchanged ----
  function pctToMmol(p) { p = Number(p); return isNaN(p) ? null : Math.round((p - 2.15) * 10.929); }
  function mmolToPct(m) { m = Number(m); return isNaN(m) ? null : Math.round(((m / 10.929) + 2.15) * 10) / 10; }
  function bmiCategory(bmi) {
    if (bmi === null) return "";
    if (bmi < 18.5) return "Underweight (< 18.5)";
    if (bmi < 25) return "Normal (18.5–24.9)";
    if (bmi < 30) return "Overweight (25–29.9)";
    if (bmi < 35) return "Obesity Class I (30–34.9)";
    if (bmi < 40) return "Obesity Class II (35–39.9)";
    return "Obesity Class III (≥ 40)";
  }
  function bmiOf(w, hcm) { if (w === null || hcm === null || hcm <= 0) return null; var hm = hcm / 100; return Math.round((w / (hm * hm)) * 10) / 10; }

  // ---- reading guide (adult ranges; shown with words, never saved) ----
  function flags(type, res) {
    var f = [], r = res || {}, n;
    var add = function (t, k) { f.push({ t: t, k: k }); };
    if (type === "bp") {
      var s = num(r.sys), d = num(r.dia), p = num(r.pulse);
      if ((s !== null && s >= 180) || (d !== null && d >= 120)) add("Very high", "bad");
      else if ((s !== null && s >= 140) || (d !== null && d >= 90)) add("High", "bad");
      else if ((s !== null && s < 90) || (d !== null && d < 60)) add("Low", "warn");
      if (p !== null && p > 100) add("Fast pulse", "warn"); else if (p !== null && p > 0 && p < 50) add("Slow pulse", "warn");
    } else if (type === "bg") {
      n = num(r.glucose);
      if (n !== null) { if (n < 4) add("Low", "bad"); else if (r.timing === "Fasting" ? n >= 7 : n >= 11.1) add("High", "bad"); }
    } else if (type === "hba1c") {
      n = num(r.mmol); if (n === null && num(r.pct) !== null) n = pctToMmol(num(r.pct));
      if (n !== null) { if (n >= 48) add("High", "bad"); else if (n >= 42) add("Raised", "warn"); }
    } else if (type === "chol") {
      if (num(r.tc) !== null && num(r.tc) > 5) add("Total high", "bad");
      if (num(r.ldl) !== null && num(r.ldl) > 3) add("LDL high", "bad");
      if (num(r.hdl) !== null && num(r.hdl) > 0 && num(r.hdl) < 1) add("HDL low", "warn");
      if (num(r.tg) !== null && num(r.tg) > (r.fasting === "Non-fasting" ? 2.3 : 1.7)) add("TG high", "warn");
    } else if (type === "bmi") {
      n = num(r.bmi); if (n === null) n = bmiOf(num(r.weight), num(r.height));
      if (n !== null) { if (n < 18.5) add("Underweight", "warn"); else if (n >= 30) add("Obesity", "bad"); else if (n >= 25) add("Overweight", "warn"); }
    } else if (type === "urine") {
      if (positives(r).length) add("Positive", "bad");
    }
    return f;
  }
  function positives(r) {
    var out = [];
    URINE.forEach(function (u) { if (u[0] === "ph") return; var v = must(r[u[0]]); if (v && v !== "Negative" && v !== "Normal") out.push(u[1] + " " + v); });
    return out;
  }
  function pills(f) { return f.map(function (x) { return '<em class="poc-flag ' + x.k + '">' + esc(x.t) + "</em>"; }).join(""); }
  function summary(r) {
    var x = (r && r.results) || {}, t = r && r.testType, a = [];
    if (t === "bp") { if (has(x.sys) || has(x.dia)) a.push((has(x.sys) ? x.sys : "–") + "/" + (has(x.dia) ? x.dia : "–") + " mmHg"); if (has(x.pulse)) a.push("pulse " + x.pulse); return a.join(" · "); }
    if (t === "bg") return (has(x.glucose) ? x.glucose + " mmol/L" : "") + (x.timing ? " · " + lower(x.timing) : "");
    if (t === "hba1c") { if (has(x.pct)) a.push(x.pct + "%"); if (has(x.mmol)) a.push(x.mmol + " mmol/mol"); return a.join(" · "); }
    if (t === "chol") {
      [["tc", "Total"], ["hdl", "HDL"], ["ldl", "LDL"], ["tg", "TG"]].forEach(function (k) { if (has(x[k[0]])) a.push(k[1] + " " + x[k[0]]); });
      return (a.length ? a.join(", ") + " mmol/L" : "") + (has(x.ratio) ? " · ratio " + x.ratio : "");
    }
    if (t === "bmi") { if (has(x.bmi)) a.push("BMI " + x.bmi); if (has(x.weight)) a.push(x.weight + " kg"); if (has(x.height)) a.push(x.height + " cm"); if (has(x.waist)) a.push("waist " + x.waist + " cm"); return a.join(" · "); }
    if (t === "urine") { var p = positives(x); return (p.length ? p.join(", ") : "Negative throughout") + (has(x.ph) ? " · pH " + x.ph : ""); }
    var o = []; for (var k in x) if (Object.prototype.hasOwnProperty.call(x, k) && has(x[k])) o.push(k + " " + x[k]); return o.slice(0, 4).join(", ");
  }
  function label(r) { return NICE[r.testType] || r.testLabel || r.testType || "Test"; }

  // ---- people: the master cards, plus anyone who only appears on a record (as the classic list rebuilds them) ----
  function people() {
    var map = {};
    S.patients.forEach(function (p) { var id = pid(p && p.patientId); if (id) map[id] = { id: id, name: must(p.name), phone: must(p.phone), age: p.age, address: must(p.address), conflicts: Array.isArray(p.conflicts) ? p.conflicts.length : 0, count: 0, last: p.lastSeenIso || "" }; });
    S.records.forEach(function (r) {
      var p = r.patient || {}, id = pid(p.patientId); if (!id) return;
      var e = map[id] || (map[id] = { id: id, name: must(p.name), phone: must(p.phone), age: p.age, address: must(p.address), conflicts: 0, count: 0, last: "" });
      e.count++; if (!e.last || String(r.performedAtIso) > String(e.last)) e.last = r.performedAtIso;
    });
    return map;
  }
  function recordsOf(id) { return S.records.filter(function (r) { return pid((r.patient || {}).patientId) === id; }); }

  function css() {
    if (document.getElementById("eikon-pocreg-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-pocreg-css";
    st.textContent =
      ".poc{max-width:880px;margin:0 auto}" +
      ".poc-back{border:0;background:none;color:var(--accent);font:inherit;font-size:15px;font-weight:500;padding:0 0 10px;cursor:pointer}" +
      ".poc-top{display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap}" +
      ".poc h1{font-size:30px;letter-spacing:-.025em;margin:0;line-height:1.1;font-weight:800}.poc-sub{color:var(--muted);font-size:14.5px;margin:4px 0 0}" +
      ".poc-btn{font:inherit;font-size:14px;font-weight:600;height:34px;padding:0 14px;border-radius:17px;border:1px solid var(--border);background:var(--panel2);color:var(--text);cursor:pointer;white-space:nowrap}" +
      ".poc-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.poc-btn:disabled{opacity:.55;cursor:default}" +
      ".poc-find{display:flex;align-items:center;gap:8px;margin-top:16px;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:0 12px}" +
      ".poc-find input{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:11px 0}" +
      ".poc-find:focus-within{border-color:var(--accent)}" +
      ".poc-lab{font-size:13px;font-weight:600;color:var(--muted);margin:20px 2px 7px;display:flex;gap:8px}.poc-lab b{color:var(--text)}" +
      ".poc-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".poc-row{display:flex;gap:10px;align-items:center;width:100%;text-align:left;font:inherit;color:inherit;background:transparent;border:0;border-top:.5px solid var(--border);padding:10px 16px;min-height:52px}" +
      ".poc-list>.poc-row:first-child{border-top:0}button.poc-row{cursor:pointer}button.poc-row:hover{background:rgba(118,118,128,.06)}" +
      ".poc-row .t{flex:1;min-width:0}.poc-row b{display:block;font-size:15px;font-weight:600;overflow-wrap:anywhere}" +
      ".poc-row span{display:block;font-size:12.5px;color:var(--muted);margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.poc-row span.w{white-space:normal}" +
      ".poc-row .f{display:flex;flex-wrap:wrap;gap:4px;justify-content:flex-end;flex:0 1 auto;max-width:45%}" +
      ".poc-flag{font-style:normal;font-size:11.5px;font-weight:700;padding:2px 8px;border-radius:999px;white-space:nowrap}" +
      ".poc-flag.bad{background:rgba(215,38,28,.12);color:var(--danger)}.poc-flag.warn{background:rgba(201,138,18,.14);color:var(--warn,#8A5A08)}" +
      ".poc-who{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:14px 16px;margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap}" +
      ".poc-who .t{flex:1 1 200px;min-width:0}.poc-who h2{font-size:22px;margin:0;font-weight:700;letter-spacing:-.015em;overflow-wrap:anywhere}.poc-who p{margin:3px 0 0;color:var(--muted);font-size:13.5px;overflow-wrap:anywhere}" +
      ".poc-warnbox{margin-top:10px;padding:10px 12px;border-radius:10px;background:rgba(201,138,18,.12);font-size:13.5px}" +
      ".poc-form{background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:6px 0;margin-top:16px}" +
      ".poc-form label,.poc-form .row{display:flex;align-items:center;gap:12px;min-height:44px;padding:0 14px;border-top:.5px solid var(--border)}" +
      ".poc-form label>span{flex:0 0 108px;font-size:15px}.poc-form label>i{font-style:normal;color:var(--muted);font-size:13px;white-space:nowrap}" +
      ".poc-form input,.poc-form select{flex:1;min-width:0;border:0;outline:0;background:transparent;font:inherit;font-size:16px;color:inherit;padding:10px 0}" +
      ".poc-form label small{color:var(--accent);font-size:12px;font-weight:600;white-space:nowrap}" +
      ".poc-form .hd{font-size:13px;font-weight:600;color:var(--muted);padding:14px 14px 5px;border-top:.5px solid var(--border)}.poc-form .hd:first-child{border-top:0}" +
      ".poc-seg{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:6px;padding:4px 14px 10px}" +
      ".poc-seg button{font:inherit;font-size:13.5px;font-weight:600;min-height:36px;border-radius:9px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;padding:4px 6px;line-height:1.15;overflow-wrap:anywhere}" +
      ".poc-seg button.on{background:var(--accent);border-color:var(--accent);color:#fff}" +
      ".poc-live{padding:8px 14px;font-size:13.5px;color:var(--muted);border-top:.5px solid var(--border);display:flex;flex-wrap:wrap;gap:6px;align-items:center;min-height:20px}.poc-live b{color:var(--text);font-weight:600}" +
      ".poc-form .acts{display:flex;gap:8px;padding:8px 14px;justify-content:flex-end}" +
      ".poc-err{color:var(--danger);font-size:13.5px;padding:6px 14px;line-height:1.45}" +
      ".poc-form label.miss>span{color:var(--danger);font-weight:600}.poc-form label.miss{box-shadow:inset 3px 0 0 var(--danger)}" +
      ".poc-skel{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden;margin-top:20px}.poc-skel i{display:block;height:52px;border-top:.5px solid var(--border);background:linear-gradient(90deg,transparent 0,rgba(118,118,128,.10) 50%,transparent 100%) 0 0/200% 100%;animation:eikonSvcSkel 1.3s linear infinite}.poc-skel i:first-child{border-top:0}" +
      "@keyframes eikonSvcSkel{from{background-position:100% 0}to{background-position:-100% 0}}@media (prefers-reduced-motion:reduce){.poc-skel i{animation:none}}" +
      ".poc-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:14px;padding:22px;color:var(--muted);margin-top:14px}" +
      ".poc-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}" +
      ".poc-note{font-size:12.5px;color:var(--muted);margin-top:12px;line-height:1.5}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .poc-seg button.on{color:#00160E}html[data-ui2]:not([data-ui2-visit]) :is(.poc-err,.poc-form label.miss>span){color:#FF7A72}}" +
      "@media (max-width:600px){.poc-btn{height:44px;border-radius:22px;padding:0 18px;font-size:15px}.poc-back{display:inline-flex;align-items:center;min-height:44px;padding:0}.poc-seg button{min-height:44px}.poc{padding:4px 16px 0}.poc h1{font-size:32px}.poc-form label>span{flex-basis:92px}.poc-row{padding:10px 14px}}";
    document.head.appendChild(st);
  }

  async function load() {
    var keepView = E.takeSaveFailed && E.takeSaveFailed(); S.loading = true; S.error = ""; paint();
    try {
      var r = await E.apiFetch("/poct/state", { method: "GET" });
      if (!r || r.ok === false) throw new Error((r && r.error) || "Could not load the tests");
      var st = (r.state || r.data) ? (r.state || r.data) : r; // the same reading as the classic screen
      var recs = st && (st.records || st.entries) ? (st.records || st.entries) : (r.records || []);
      var pats = st && st.patients ? st.patients : (r.patients || []);
      S.records = (Array.isArray(recs) ? recs : []).filter(function (x) { return x && x.id; }).sort(newest);
      S.patients = Array.isArray(pats) ? pats : [];
    } catch (e) { if (!keepView) S.error = e && e.network ? "Can't reach the server. The tests are safe; try again in a moment." : String((e && (e.message || e)) || "Could not load the tests"); }
    S.loading = false; E.whenFormIdle(S.mount, paint);
  }

  function blank(p) {
    var a = { type: (S.adding && S.adding.type) || (TYPES.some(function (t) { return t[0] === S.lastType; }) ? S.lastType : "bp"), dt: nowLocal(), patientId: "", name: "", phone: "", age: "", address: "", intervention: "", notes: "", recId: "" };
    a.arm = "Left"; a.position = "Sitting"; a.timing = "Random"; a.fasting = ""; a.appearance = "";
    URINE.forEach(function (u) { a[u[0]] = u[3]; });
    if (p) { a.patientId = p.id; a.name = p.name; a.phone = p.phone; a.age = has(p.age) ? String(p.age) : ""; a.address = p.address; a.found = true; }
    return a;
  }

  function field(k, lab, extra, unit) {
    var a = S.adding;
    var bad = S.miss.indexOf(k) >= 0;
    return "<label" + (bad ? ' class="miss"' : "") + "><span>" + lab + '</span><input name="' + k + '" value="' + esc(a[k]) + '"' + (bad ? ' aria-invalid="true" aria-describedby="poc-errmsg"' : "") + (extra || "") + ">" + (unit ? "<i>" + unit + "</i>" : "") + "</label>";
  }
  function pick(k, lab, opts) {
    var a = S.adding;
    return "<label><span>" + lab + '</span><select name="' + k + '">' + opts.map(function (o) { var v = Array.isArray(o) ? o[0] : o, t = Array.isArray(o) ? o[1] : o; return '<option value="' + esc(v) + '"' + (String(a[k]) === v ? " selected" : "") + ">" + esc(t) + "</option>"; }).join("") + "</select></label>";
  }
  var DEC = ' inputmode="decimal" autocomplete="off"';
  function resultFields(t) {
    if (t === "bp") return field("sys", "Systolic", DEC + ' placeholder="e.g. 120"', "mmHg") + field("dia", "Diastolic", DEC + ' placeholder="e.g. 80"', "mmHg") + field("pulse", "Pulse", DEC + ' placeholder="Optional"', "bpm") +
      pick("arm", "Arm", ["Left", "Right"]) + pick("position", "Position", ["Sitting", "Standing", "Supine"]);
    if (t === "bg") return field("glucose", "Glucose", DEC + ' placeholder="e.g. 6.4"', "mmol/L") + pick("timing", "Timing", ["Random", "Fasting", "Post-prandial"]);
    if (t === "hba1c") return field("pct", "HbA1c", DEC + ' placeholder="e.g. 6.5"', "%") + field("mmol", "HbA1c", DEC + ' placeholder="e.g. 48"', "mmol/mol");
    if (t === "chol") return field("tc", "Total", DEC + ' placeholder="e.g. 5.2"', "mmol/L") + field("hdl", "HDL", DEC + ' placeholder="e.g. 1.3"', "mmol/L") + field("ldl", "LDL", DEC + ' placeholder="e.g. 3.1"', "mmol/L") +
      field("tg", "Triglycerides", DEC + ' placeholder="e.g. 1.7"', "mmol/L") + pick("fasting", "Fasting", [["", "Not said"], ["Fasting", "Fasting"], ["Non-fasting", "Non-fasting"], ["Unknown", "Unknown"]]);
    if (t === "bmi") return field("weight", "Weight", DEC + ' placeholder="e.g. 78.4"', "kg") + field("height", "Height", DEC + ' placeholder="e.g. 175"', "cm") + field("waist", "Waist", DEC + ' placeholder="Optional"', "cm");
    if (t === "urine") return URINE.map(function (u) { return pick(u[0], u[1], u[2]); }).join("") + field("appearance", "Appearance", ' placeholder="e.g. Yellow, clear"');
    return "";
  }
  // what the form would save, with the classic calculations (HbA1c both ways, ratio, BMI and its category)
  function results(a) {
    var t = a.type;
    if (t === "bp") { var pu = num(a.pulse); return { sys: num(a.sys), dia: num(a.dia), pulse: pu === null ? "" : pu, arm: must(a.arm), position: must(a.position) }; }
    if (t === "bg") return { glucose: num(a.glucose), timing: must(a.timing) };
    if (t === "hba1c") { var p = num(a.pct), m = num(a.mmol); if (p !== null && m === null) m = pctToMmol(p); if (m !== null && p === null) p = mmolToPct(m); return { pct: p === null ? "" : p, mmol: m === null ? "" : m }; }
    if (t === "chol") { var tc = num(a.tc), hdl = num(a.hdl), ldl = num(a.ldl), tg = num(a.tg); return { tc: tc === null ? "" : tc, hdl: hdl === null ? "" : hdl, ldl: ldl === null ? "" : ldl, tg: tg === null ? "" : tg, ratio: (tc !== null && hdl !== null && hdl !== 0) ? (tc / hdl).toFixed(2) : "", fasting: must(a.fasting) }; }
    if (t === "bmi") { var w = num(a.weight), h = num(a.height), b = bmiOf(w, h), wa = num(a.waist); return { weight: w, height: h, bmi: b === null ? "" : String(b), category: bmiCategory(b), waist: wa === null ? "" : wa }; }
    if (t === "urine") { var o = {}; URINE.forEach(function (u) { o[u[0]] = must(a[u[0]]); }); o.appearance = must(a.appearance); return o; }
    return {};
  }
  function liveHtml(a) {
    var r = results(a), bits = [];
    if (a.type === "chol" && r.ratio) bits.push("TC/HDL ratio <b>" + esc(r.ratio) + "</b>");
    if (a.type === "bmi" && r.bmi) bits.push("BMI <b>" + esc(r.bmi) + "</b> · " + esc(r.category));
    if (a.type === "urine") { var p = positives(r); bits.push(p.length ? esc(p.join(", ")) : "Negative throughout"); }
    var f = flags(a.type, r);
    return bits.join(" · ") + (bits.length && f.length ? " " : "") + pills(f);
  }

  function formHtml() {
    var a = S.adding;
    return '<form class="poc-form" id="poc-add" autocomplete="off" aria-label="New test">' +
      '<div class="hd" id="poc-type-lab">Test</div><div class="poc-seg" role="group" aria-labelledby="poc-type-lab">' + TYPES.map(function (t) { return '<button type="button" data-type="' + t[0] + '" aria-pressed="' + (a.type === t[0]) + '" class="' + (a.type === t[0] ? "on" : "") + '">' + esc(t[1]) + "</button>"; }).join("") + "</div>" +
      '<div class="hd">Patient</div>' +
      field("patientId", "ID card", ' placeholder="ID card or passport" autocapitalize="characters"', a.found ? "<small>Known</small>" : "") +
      field("name", "Name", ' placeholder="Name and surname"') +
      field("phone", "Phone", ' type="tel" inputmode="tel" placeholder="+356 ..."') +
      field("age", "Age", ' inputmode="numeric" placeholder="Years, optional"') +
      field("address", "Address", ' placeholder="Optional"') +
      '<div class="hd">' + esc(NICE[a.type]) + "</div>" + resultFields(a.type) +
      '<div class="poc-live" id="poc-live" aria-live="polite">' + liveHtml(a) + "</div>" +
      '<div class="hd">Details</div>' +
      field("dt", "Done at", ' type="datetime-local"') +
      field("intervention", "Intervention", ' placeholder="Optional, e.g. lifestyle advice, referred"') +
      field("notes", "Notes", ' placeholder="Optional"') +
      (S.err ? '<div class="poc-err" id="poc-errmsg" role="alert">' + esc(S.err) + "</div>" : "") +
      '<div class="acts"><button type="button" class="poc-btn" data-act="add-cancel">Cancel</button><button type="submit" class="poc-btn p"' + (S.saving ? " disabled" : "") + ">" + (S.saving ? "Saving…" : "Save test") + "</button></div></form>";
  }

  function row(r, showWho) {
    var p = r.patient || {}, f = flags(r.testType, r.results);
    var sub = showWho ? [p.name || p.patientId || "No name", when(r.performedAtIso)] : [when(r.performedAtIso)];
    if (!showWho && r.intervention) sub.push(r.intervention);
    if (!showWho && r.notes) sub.push(r.notes);
    var inner = '<div class="t"><b>' + esc(label(r)) + " · " + esc(summary(r)) + '</b><span' + (showWho ? "" : ' class="w"') + ">" + esc(sub.join(" · ")) + "</span></div>" + (f.length ? '<div class="f">' + pills(f) + "</div>" : "");
    var id = pid(p.patientId);
    return showWho && id ? '<button type="button" class="poc-row" data-act="open" data-pid="' + esc(id) + '">' + inner + "</button>" : '<div class="poc-row">' + inner + "</div>";
  }

  function ymOf(iso) { var d = new Date(iso); return isNaN(d) ? "" : d.getFullYear() + "-" + pad(d.getMonth() + 1); }
  // The tests of any month (from the records already read), and the classic POCT list printout for it:
  // Date/Time, Test, Patient, Patient ID, Phone, Age, Results, Intervention, Notes; oldest first.
  var HIST = { local: true, title: "By month", label: "Tests done", nowText: "No test recorded this month yet.", dep: function () { return S.loading ? undefined : S.records; },
    active: function () { return E.state.activeModuleId === "pocreg" && !S.view; }, paint: function () { paint(); },
    fetch: function (ym) { return Promise.resolve(S.records.filter(function (r) { return ymOf(r.performedAtIso) === ym; })); },
    row: function (r) { var p = r.patient || {}; return { t: label(r) + " · " + summary(r), s: [p.name || p.patientId || "No name", when(r.performedAtIso)].join(" · ") }; },
    print: function (ym, list) { printMonth(ym, list); } };
  function printMonth(ym, list) {
    E.months.print({ register: "POCT records", month: ym, landscape: true, sections: [{ cols: ["Date/Time", "Test", "Patient", "Patient ID", "Phone", "Age", "Results", "Intervention", "Notes"],
      rows: list.slice().reverse().map(function (r) { var p = r.patient || {}; var d = new Date(r.performedAtIso), dt = isNaN(d.getTime()) ? "" : pad(d.getDate()) + "/" + pad(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad(d.getHours()) + ":" + pad(d.getMinutes()); return [dt, r.testLabel || label(r), p.name || "", p.patientId || "", p.phone || "", p.age == null ? "" : String(p.age), summary(r), r.intervention || "", r.notes || ""]; }) }] });
  }
  function homeHtml() {
    var h = '<label class="poc-find"><span class="poc-sr">Find a patient</span><input type="search" id="poc-q" value="' + esc(S.q) + '" placeholder="Find a patient: name, ID card or phone" autocomplete="off"></label>';
    var q = lower(S.q).replace(/\s+/g, "");
    if (q) {
      var map = people(), hits = Object.keys(map).map(function (k) { return map[k]; }).filter(function (p) {
        return (lower(p.name).replace(/\s+/g, "").indexOf(q) >= 0) || lower(p.id).indexOf(q) >= 0 || lower(pid(S.q)) === lower(p.id) || lower(p.phone).replace(/\s+/g, "").indexOf(q) >= 0;
      }).sort(function (x, y) { return String(y.last).localeCompare(String(x.last)); }).slice(0, 12);
      h += '<div class="poc-lab">Patients <b>' + hits.length + "</b></div>";
      h += hits.length ? '<div class="poc-list">' + hits.map(function (p) {
        return '<button type="button" class="poc-row" data-act="open" data-pid="' + esc(p.id) + '"><div class="t"><b>' + esc(p.name || p.id) + "</b><span>" + esc([p.id, p.phone, p.count + (p.count === 1 ? " test" : " tests") + (p.last ? ", last " + when(p.last) : "")].filter(Boolean).join(" · ")) + "</span></div></button>";
      }).join("") + "</div>" : '<div class="poc-quiet">No patient matches “' + esc(S.q) + '”. <button type="button" class="poc-btn" data-act="add-q" style="margin-left:6px">New test for a new patient</button></div>';
      return h;
    }
    var recent = S.records.slice(0, 25);
    h += '<div class="poc-lab">Latest tests <b>' + S.records.length + "</b></div>";
    h += recent.length ? '<div class="poc-list">' + recent.map(function (r) { return row(r, true); }).join("") + "</div>" : '<div class="poc-quiet">No tests recorded yet. Press New test to add the first one.</div>';
    h += E.months.history("pocreg", HIST); // every test of a month, any month, and its printout
    return h;
  }

  function patientHtml(id) {
    var map = people(), p = map[id] || { id: id, name: "", phone: "", conflicts: 0 }, list = recordsOf(id);
    var h = '<button class="poc-back" data-act="home" style="padding-top:10px">‹ All tests</button>' +
      '<div class="poc-who"><div class="t"><h2>' + esc(p.name || p.id) + "</h2><p>" + esc([p.id, p.phone, has(p.age) ? p.age + " years" : "", p.address].filter(Boolean).join(" · ")) + "</p></div>" +
      (S.adding ? "" : '<button class="poc-btn p" data-act="add-for" data-pid="' + esc(id) + '">New test</button>') + "</div>";
    if (p.conflicts) h += '<div class="poc-warnbox">This ID card was also used with a different name or phone (' + p.conflicts + (p.conflicts === 1 ? " time" : " times") + "). The patient's details were kept; check them in the classic screen.</div>";
    // the latest result of each test, with the one before it
    var latest = TYPES.map(function (t) { return list.filter(function (r) { return r.testType === t[0]; }); }).filter(function (l) { return l.length; });
    if (latest.length) {
      h += '<div class="poc-lab">Latest of each test</div><div class="poc-list">' + latest.map(function (l) {
        var r = l[0], f = flags(r.testType, r.results), prev = l[1];
        return '<div class="poc-row"><div class="t"><b>' + esc(label(r)) + " · " + esc(summary(r)) + "</b><span class=\"w\">" + esc(when(r.performedAtIso) + (prev ? " · before: " + summary(prev) + " (" + when(prev.performedAtIso) + ")" : "") + (l.length > 1 ? " · " + l.length + " in all" : "")) + "</span></div>" + (f.length ? '<div class="f">' + pills(f) + "</div>" : "") + "</div>";
      }).join("") + "</div>";
    }
    h += '<div class="poc-lab">History <b>' + list.length + "</b></div>";
    h += list.length ? '<div class="poc-list">' + list.map(function (r) { return row(r, false); }).join("") + "</div>" : '<div class="poc-quiet">No tests for this patient yet.</div>';
    return h;
  }

  function paint(fromState) {
    var m = S.mount; if (!m) return;
    if (E.state.activeModuleId !== "pocreg") return; // left before a reply came back: do not draw over the next screen
    if (S.adding && !S.saving && !fromState) keep(); // a reply landing while someone types must not wipe the form
    var h = '<div class="poc"><button class="poc-back" data-act="back">' + E.escapeHtml(E.ui2BackLabel("pocreg")) + '</button>' +
      '<div class="poc-top"><div><h1>Point-of-care tests</h1><p class="poc-sub">Blood pressure, glucose, cholesterol and other tests, per patient.</p></div>' + (S.adding || S.view ? "" : '<button class="poc-btn p" data-act="add">New test</button>') + "</div>";
    if (S.adding) h += formHtml();
    if (S.loading && !S.records.length && !S.patients.length) h += '<div class="poc-skel" role="status" aria-busy="true"><span class="poc-sr">Opening the tests</span><i></i><i></i><i></i><i></i><i></i></div>';
    else if (S.error) h += '<div class="poc-quiet" role="alert">' + esc(S.error) + ' <button type="button" class="poc-btn" data-act="retry" style="margin-left:6px">Try again</button></div>';
    else h += S.view ? patientHtml(S.view) : homeHtml();
    h += '<p class="poc-note">High and low marks are a guide for adults (blood pressure 140/90, fasting glucose 7.0 and random 11.1 mmol/L, HbA1c 48 mmol/mol, total cholesterol 5.0, LDL 3.0, HDL 1.0, BMI 25) and are not saved with the test. ' +
      'Editing or deleting a test, printing one test, the patients list with its flags, CSV export and import are in the <a href="#" data-act="classic">classic POCT screen</a>.</p></div>';
    var ae = document.activeElement, back = ae && m.contains(ae) && ae.closest && ae.closest("#poc-add") && ae.name ? "[name=" + ae.name + "]" : (ae && ae.id === "poc-q" ? "#poc-q" : "");
    var caret = null; if (back) try { caret = typeof ae.selectionStart === "number" ? ae.selectionStart : null; } catch (e) { caret = null; }
    m.innerHTML = h;
    if (back) { var again = m.querySelector(back); if (again) { again.focus(); if (caret != null) try { again.setSelectionRange(caret, caret); } catch (e) {} } } // a lookup filling fields keeps your place
    wire(m);
    E.months.wireHistory(m, "pocreg");
  }

  function focus(sel) { setTimeout(function () { var x = S.mount && S.mount.querySelector(sel); if (x && !(document.activeElement && document.activeElement.closest && document.activeElement.closest("form"))) x.focus(); }, 30); }

  function wire(m) {
    m.querySelectorAll("[data-act]").forEach(function (b) {
      b.addEventListener("click", function (ev) {
        var act = b.getAttribute("data-act");
        if (act === "back") window.location.hash = E.ui2BackHash("pocreg");
        else if (act === "add") { S.adding = blank(null); S.err = ""; S.miss = []; paint(true); focus("[name=patientId]"); }
        else if (act === "add-q") { var q = S.q; S.adding = blank(null); S.miss = []; if (/\d/.test(q) && !/\s/.test(q.trim()) && !/^[+\d\s]{8,}$/.test(q.trim())) S.adding.patientId = pid(q); else if (/^[+\d\s]{8,}$/.test(q.trim())) S.adding.phone = q.trim(); else S.adding.name = q.trim(); S.err = ""; paint(true); focus("[name=patientId]"); }
        else if (act === "add-for") { var p = people()[b.getAttribute("data-pid")]; S.adding = blank(p); S.err = ""; S.miss = []; paint(true); focus("[name=sys],[name=glucose],[name=pct],[name=tc],[name=weight],[name=leu]"); }
        else if (act === "add-cancel") { S.adding = null; S.err = ""; S.miss = []; paint(true); }
        else if (act === "open") { S.view = b.getAttribute("data-pid"); paint(); window.scrollTo(0, 0); }
        else if (act === "home") { S.view = null; paint(); }
        else if (act === "retry") load();
        else if (act === "classic") { ev.preventDefault(); try { sessionStorage.setItem("eikon_ui2_return", "pocreg"); } catch (x) {} E.openClassic("poct"); }
      });
    });
    var q = m.querySelector("#poc-q");
    if (q) q.addEventListener("input", function () { S.q = q.value; clearTimeout(S.qT); S.qT = setTimeout(function () { paint(); }, 120); });
    var f = m.querySelector("#poc-add");
    if (!f) return;
    f.addEventListener("submit", function (ev) { ev.preventDefault(); add(); });
    f.querySelectorAll(".poc-seg [data-type]").forEach(function (b) { b.addEventListener("click", function () { keep(); S.adding.type = b.getAttribute("data-type"); S.err = ""; S.miss = []; paint(true); var x = S.mount.querySelector('.poc-seg [data-type="' + S.adding.type + '"]'); if (x) x.focus(); }); });
    var idIn = f.querySelector("[name=patientId]");
    if (idIn) { idIn.addEventListener("input", function () { clearTimeout(S.idT); S.idT = setTimeout(function () { lookup(idIn.value); }, 300); }); idIn.addEventListener("blur", function () { var v = idIn.value; setTimeout(function () { lookup(v); }, 0); }); } // after the blur: focus has moved on, and the redraw puts it back there
    if (E.personPick) E.personPick.attach({ key: "pocreg", form: f, fields: { id: "patientId", name: "name", phone: "phone", address: "address" }, idValue: pid, onFill: function () { keep(); },
      local: function () { var map = people(); return Object.keys(map).map(function (k) { var p = map[k]; return { name: p.name, id_card: p.id, phone: p.phone, address: p.address, date: String(p.last || "").slice(0, 10), from: "test" }; }); } });
    var pct = f.querySelector("[name=pct]"), mm = f.querySelector("[name=mmol]");
    if (pct && mm) { // the two HbA1c units fill each other, as in the classic screen
      pct.addEventListener("input", function () { var v = num(pct.value); mm.value = v === null ? "" : String(pctToMmol(v)); });
      mm.addEventListener("input", function () { var v = num(mm.value); pct.value = v === null ? "" : String(mmolToPct(v)); });
    }
    var live = f.querySelector("#poc-live"), upd = function () { keep(); if (live) live.innerHTML = liveHtml(S.adding); };
    f.addEventListener("input", function (ev) { unmark(ev.target); if (ev.target && RES[S.adding.type].indexOf(ev.target.name) >= 0) upd(); });
    f.addEventListener("change", function (ev) { if (ev.target && ev.target.tagName === "SELECT") upd(); });
  }

  function unmark(el) { // a field being corrected loses its red mark at once; the message stays until the next Save test
    var i = el && el.name ? S.miss.indexOf(el.name) : -1; if (i < 0) return;
    S.miss.splice(i, 1); el.removeAttribute("aria-invalid"); el.removeAttribute("aria-describedby"); var l = el.closest("label"); if (l) l.classList.remove("miss");
  }
  function keep() {
    var f = S.mount && S.mount.querySelector("#poc-add"); if (!f || !S.adding) return;
    f.querySelectorAll("input[name],select[name]").forEach(function (el) { S.adding[el.name] = el.tagName === "SELECT" ? el.value : String(el.value || "").trim(); });
  }

  function lookup(raw) {
    var id = pid(raw); if (!id || !S.adding || S.adding.looked === id) return;
    S.adding.looked = id;
    var p = people()[id], card = /^\d{1,7}[A-Z]$/.test(must(raw).toUpperCase().replace(/\s+/g, ""));
    var el = S.mount && S.mount.querySelector("#poc-add [name=patientId]");
    if (p) { // fill only what is still empty and not the field in use, in place: a redraw here lost the next field typed
      keep(); if (card && el && document.activeElement !== el) { el.value = id; S.adding.patientId = id; }
      var want = {}; [["name", p.name], ["phone", p.phone], ["age", has(p.age) ? String(p.age) : ""], ["address", p.address]].forEach(function (x) { if (x[1] && !S.adding[x[0]]) want[x[0]] = String(x[1]); });
      var f = S.mount && S.mount.querySelector("#poc-add");
      (f ? E.fillEmpty(f, want) : Object.keys(want)).forEach(function (k) { S.adding[k] = want[k]; });
      knownMark(true);
    } else if (S.adding.found) { keep(); knownMark(false); }
    else if (card && el && document.activeElement !== el) el.value = id; // a new ID card: only shown padded, nothing redrawn under the fingers
  }
  function knownMark(on) {
    S.adding.found = !!on;
    var el = S.mount && S.mount.querySelector("#poc-add [name=patientId]"), lab = el && el.closest("label"), sm = lab && lab.querySelector("small");
    if (on && lab && !sm) lab.insertAdjacentHTML("beforeend", "<i><small>Known</small></i>"); else if (!on && sm) (sm.parentNode.tagName === "I" ? sm.parentNode : sm).remove(); // as field() draws it
  }

  // The patient's master card after this test, by the classic rules, starting from the card as the server sent it
  // (every field kept, the whole card sent back: the server stores the card exactly as sent).
  function master(pt, rec) {
    var now = new Date().toISOString(), ex = null;
    S.patients.forEach(function (p) { if (!ex && p && pid(p.patientId) === pt.patientId) ex = clone(p); });
    if (!ex) return { card: { patientId: pt.patientId, name: pt.name, phone: pt.phone, age: pt.age, address: pt.address, createdAtIso: now, updatedAtIso: now, lastSeenIso: rec.performedAtIso || now, conflicts: [] }, conflict: false };
    var exName = must(ex.name), exPhone = must(ex.phone), conflict = (exName && pt.name && lower(exName) !== lower(pt.name)) || (exPhone && pt.phone && lower(exPhone) !== lower(pt.phone));
    if (conflict) {
      ex.conflicts = Array.isArray(ex.conflicts) ? ex.conflicts : [];
      ex.conflicts.unshift({ atIso: now, recordId: String(rec.id), testType: rec.testType, performedAtIso: rec.performedAtIso, existingName: exName, existingPhone: exPhone, enteredName: pt.name, enteredPhone: pt.phone });
    } else {
      if (pt.name) ex.name = pt.name;
      if (pt.phone) ex.phone = pt.phone;
    }
    if (pt.address) ex.address = pt.address;
    if (pt.age !== null && pt.age !== undefined) ex.age = pt.age;
    var dNew = new Date(rec.performedAtIso), dOld = ex.lastSeenIso ? new Date(ex.lastSeenIso) : null;
    if (!dOld || isNaN(dOld.getTime()) || (!isNaN(dNew.getTime()) && dNew.getTime() > dOld.getTime())) ex.lastSeenIso = rec.performedAtIso;
    ex.updatedAtIso = now;
    return { card: ex, conflict: !!conflict };
  }

  async function add() {
    if (S.saving) return;
    keep();
    var a = S.adding; S.err = "";
    var d = new Date(a.dt), res = results(a), t = a.type;
    // every problem at once, each field marked, the first one focused (the words as before, one sentence each)
    var errs = [], miss = [], say = function (keys, msg) { errs.push(msg); keys.forEach(function (k) { if (miss.indexOf(k) < 0) miss.push(k); }); };
    if (!a.dt || isNaN(d.getTime())) say(["dt"], "Choose when the test was done.");
    else if (d.getTime() > Date.now() + 10 * 60000) say(["dt"], "The time is in the future. Choose when the test was done.");
    if (!a.patientId) say(["patientId"], "Write the patient's ID card (or passport).");
    if (!a.name) say(["name"], "Write the patient's name.");
    if (!a.phone) say(["phone"], "Write a contact number.");
    if (has(a.age) && (num(a.age) === null || num(a.age) < 0)) say(["age"], "Write the age in years, or leave it empty.");
    var resBefore = errs.length;
    if (t === "bp" && (res.sys === null || res.dia === null)) say([res.sys === null ? "sys" : "", res.dia === null ? "dia" : ""].filter(Boolean), "Write the systolic and the diastolic.");
    else if (t === "bg" && res.glucose === null) say(["glucose"], "Write the glucose reading.");
    else if (t === "hba1c" && res.pct === "" && res.mmol === "") say(["pct", "mmol"], "Write the HbA1c in % or mmol/mol.");
    else if (t === "chol" && res.tc === "" && res.hdl === "" && res.ldl === "" && res.tg === "") say(["tc", "hdl", "ldl", "tg"], "Write at least one cholesterol value.");
    else if (t === "bmi" && (res.weight === null || res.height === null)) say([res.weight === null ? "weight" : "", res.height === null ? "height" : ""].filter(Boolean), "Write the weight and the height.");
    var bad = RES[t].filter(function (k) { return ["sys", "dia", "pulse", "glucose", "pct", "mmol", "tc", "hdl", "ldl", "tg", "weight", "height", "waist"].indexOf(k) >= 0 && has(a[k]) && (num(a[k]) === null || num(a[k]) < 0); });
    if (bad.length) { if (errs.length > resBefore) { errs.pop(); } say(bad, "One of the values is not a number. Check it and press Save test again."); }
    S.miss = miss;
    if (errs.length) { S.err = errs.join(" ") + " Nothing was saved."; paint(true); var first = S.mount && S.mount.querySelector("#poc-add [aria-invalid=true]"); if (first) first.focus(); return; }
    // the ID card and the person (E.people.confirmPerson): asked before anything is saved; Go back keeps the form
    var asked = null;
    if (E.people && E.people.confirmPerson) {
      S.saving = true; paint(true);
      asked = await E.people.confirmPerson({ name: a.name, id_card: pid(a.patientId), phone: a.phone, address: a.address }, { key: "pocreg", record: "test" });
      S.saving = false;
      if (asked.action !== "save") {
        if (asked.action === "fill") { if (asked.field === "name") a.name = asked.value; else a.patientId = pid(asked.value); }
        paint(true); var back = S.mount && S.mount.querySelector("#poc-add [name=" + (asked.field === "name" ? "name" : "patientId") + "]"); if (back) back.focus();
        return;
      }
      if (asked.change) { // the card was just changed on the patient list too: read it again so this test joins the changed patient
        try { var st0 = await E.apiFetch("/poct/state", { method: "GET" }); var s0 = (st0 && (st0.state || st0.data)) || st0 || {}; if (Array.isArray(s0.patients)) S.patients = s0.patients; } catch (e0) {}
      }
    }
    if (!a.recId) a.recId = uid(); // kept for retries: the server stores by this id, so pressing Save test again never adds a second test
    var pt = { name: a.name, patientId: pid(a.patientId), phone: a.phone, age: num(a.age), address: a.address };
    var rec = { id: a.recId, testType: t, testLabel: LABEL[t], performedAtIso: d.toISOString(), performedAtLocal: a.dt, patient: pt, feeDue: 0, notes: a.notes, intervention: a.intervention, results: res, updatedAtIso: new Date().toISOString() };
    var mc = master(pt, rec);
    S.saving = true; paint(true);
    try {
      try {
        var r = await E.apiFetch("/poct/state", { method: "PUT", body: JSON.stringify({ records: [rec], patients: [mc.card] }) });
        if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      } catch (x0) { // the answer was lost: look for the test before saying it failed
        if (!(x0 && x0.network)) throw x0;
        var st = null; try { st = await E.apiFetch("/poct/state", { method: "GET", retry: false }); } catch (e1) { throw x0; }
        var got = ((st && st.state && st.state.records) || (st && st.records) || []).some(function (x) { return x && x.id === rec.id; });
        if (!got) throw x0;
      }
      S.adding = null; S.miss = []; S.view = pt.patientId; S.q = ""; S.lastType = t; try { localStorage.setItem("eikon_pocreg_type", t); } catch (e2) {}
      if (E.linkPerson) E.linkPerson({ name: pt.name, id_card: pt.patientId, phone: pt.phone, address: pt.address }, "register:poct", asked); // one person in Customers, found or added
      E.toast(mc.conflict ? "Saved. This ID card was on file with a different name or phone; the patient's details were kept." : "Saved · " + NICE[t] + " for " + pt.name, mc.conflict ? "warning" : "success");
    } catch (x) { S.err = E.saveFailText(x); }
    S.saving = false; return load();
  }

  E.registerModule({
    id: "pocreg", title: "Point-of-care tests", order: 3, icon: "🩺", ui2Only: true,
    render: function (ctx) { S.mount = ctx && ctx.mount; S.adding = null; S.err = ""; S.miss = []; S.view = null; S.q = ""; E.months.historyReset("pocreg"); css(); paint(); return load(); }
  });
  if (Array.isArray(E.UI2_DESTINATIONS) && E.UI2_DESTINATIONS.indexOf("pocreg") < 0) E.UI2_DESTINATIONS.push("pocreg");
  if (E.UI2_PARENT) E.UI2_PARENT.pocreg = "services";
})();
