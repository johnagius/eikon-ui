(function () {
  "use strict";

  // ============================================================
  //  DEBUG LOGGING (always on)
  // ============================================================
  var APPT_DBG_ALWAYS = true;
  function apptNow() { try { return new Date().toISOString(); } catch (e) { return ""; } }
  function apptLog()  { if (!APPT_DBG_ALWAYS) return; try { console.log.apply(console,  ["[APPT]", apptNow()].concat([].slice.call(arguments))); } catch (e) {} }
  function apptWarn() { if (!APPT_DBG_ALWAYS) return; try { console.warn.apply(console, ["[APPT]", apptNow()].concat([].slice.call(arguments))); } catch (e) {} }
  function apptErr()  { try { console.error.apply(console, ["[APPT]", apptNow()].concat([].slice.call(arguments))); } catch (e) {} }

  var E = window.EIKON;
  if (!E) { console.error("[APPT] window.EIKON not found – module aborted."); return; }

  // Global error catchers
  try {
    window.addEventListener("unhandledrejection", function (ev) {
      try {
        var reason = ev && ev.reason;
        apptErr("unhandledrejection", reason);
        toast("Appointments error", (reason && reason.message) ? reason.message : String(reason || "Unhandled rejection"), "bad", 5000);
      } catch (e) {}
      try { if (ev && ev.preventDefault) ev.preventDefault(); } catch (e2) {}
    });
    window.addEventListener("error", function (ev) {
      try { apptErr("window.error", ev && (ev.error || ev.message || ev)); } catch (e) {}
    });
  } catch (e) {}

  function log()  { try { if (APPT_DBG_ALWAYS) { console.log.apply(console,  ["[appt]"].concat([].slice.call(arguments))); } } catch (e) {} }
  function warn() { try { console.warn.apply(console,  ["[appt]"].concat([].slice.call(arguments))); } catch (e) {} }
  function err()  { try { E.error.apply(E, ["[appt]"].concat([].slice.call(arguments))); } catch (e) {} }

  // ============================================================
  //  UTILITIES
  // ============================================================
  function esc(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }
  function norm(s) { return String(s == null ? "" : s).toLowerCase().trim(); }
  function pad2(n) { return String(n).padStart(2, "0"); }

  function todayYmd() {
    var d = new Date();
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function isYmd(s) { return /^\d{4}-\d{2}-\d{2}$/.test(String(s || "")); }
  function fmtDmy(s) {
    if (!isYmd(s)) return s || "";
    var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0];
  }
  function fmtTs(iso) {
    if (!iso) return "";
    try {
      var d = new Date(iso); if (isNaN(d.getTime())) return iso;
      return pad2(d.getDate()) + "/" + pad2(d.getMonth() + 1) + "/" + d.getFullYear() + " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
    } catch (e) { return iso; }
  }
  function ymdAddDays(ymd, n) {
    var d = new Date(ymd + "T12:00:00"); d.setDate(d.getDate() + n);
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate());
  }
  function dayOfWeek(ymd) { return new Date(ymd + "T12:00:00").getDay(); } // 0=Sun..6=Sat
  function dayName(ymd) {
    return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][dayOfWeek(ymd)] || "";
  }
  function dayNameShort(ymd) {
    return ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][dayOfWeek(ymd)] || "";
  }
  function fmtMoney(v) { return "EUR " + (parseFloat(v) || 0).toFixed(2); }
  function generateToken() {
    var chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; var t = "";
    for (var i = 0; i < 4; i++) t += chars[Math.floor(Math.random() * chars.length)];
    return t;
  }
  function timeToMins(t) {
    try {
      t = String(t || "");
      var h = parseInt(t.slice(0, 2), 10) || 0;
      var m = parseInt(t.slice(3, 5), 10) || 0;
      return h * 60 + m;
    } catch (e) { return 0; }
  }
  function minsToTime(m) {
    m = Math.max(0, Math.min(24 * 60 - 1, parseInt(m, 10) || 0));
    var h = Math.floor(m / 60); var mn = m % 60;
    return pad2(h) + ":" + pad2(mn);
  }
  function monthLabel(ym) { // "YYYY-MM" → "March 2026"
    var months = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    var parts = String(ym || "").split("-");
    return (months[parseInt(parts[1], 10) - 1] || "") + " " + (parts[0] || "");
  }
  function ymToFirstDay(ym) { return ym + "-01"; } // "YYYY-MM" → "YYYY-MM-01"
  function daysInMonth(ym) {
    var p = String(ym || "").split("-");
    return new Date(parseInt(p[0]), parseInt(p[1]), 0).getDate();
  }

  // ============================================================
  //  DOCTOR COLORS (assigned by index in doctors array)
  // ============================================================
  var DR_COLOR_LIST = [
    "#3aa0ff","#43d17a","#cc94ff","#ff9d43","#ff5a7a",
    "#5ac8fa","#ffd60a","#30d158","#ff6b6b","#bf5af2"
  ];
  function drColor(doctorId) {
    var docs = loadDoctors();
    var idx = -1;
    for (var i = 0; i < docs.length; i++) { if (String(docs[i].id) === String(doctorId)) { idx = i; break; } }
    if (idx < 0) idx = 0;
    return DR_COLOR_LIST[idx % DR_COLOR_LIST.length];
  }
  function hexToRgba(hex, alpha) {
    try {
      hex = hex.replace("#","");
      var r = parseInt(hex.slice(0,2),16), g = parseInt(hex.slice(2,4),16), b = parseInt(hex.slice(4,6),16);
      return "rgba("+r+","+g+","+b+","+(alpha||1)+")";
    } catch(e) { return "rgba(58,160,255,"+alpha+")"; }
  }

  // ============================================================
  //  TOAST & MODAL HELPERS
  // ============================================================
  var toastInstalled = false;
  function ensureToastStyles() {
    if (toastInstalled) return; toastInstalled = true;
    var st = document.createElement("style"); st.textContent =
      ".ap-toast-wrap{position:fixed;right:14px;bottom:14px;z-index:999999;display:flex;flex-direction:column;gap:10px;max-width:min(420px,calc(100vw - 28px));}" +
      ".ap-toast{border:1px solid rgba(255,255,255,.10);background:rgba(15,22,34,.96);color:#e9eef7;border-radius:14px;padding:10px 12px;" +
      "font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;box-shadow:0 14px 40px rgba(0,0,0,.35);animation:apToastIn 200ms ease;}" +
      "@keyframes apToastIn{from{opacity:0;transform:translateY(10px);}to{opacity:1;transform:translateY(0);}}" +
      ".ap-toast .t-title{font-weight:900;margin:0 0 4px 0;font-size:13px;}" +
      ".ap-toast .t-msg{margin:0;font-size:12px;opacity:.9;white-space:pre-wrap;}" +
      ".ap-toast.good{border-color:rgba(67,209,122,.35);}" +
      ".ap-toast.bad{border-color:rgba(255,90,122,.35);}";
    document.head.appendChild(st);
  }
  function toast(title, message, kind, ms) {
    ensureToastStyles();
    var wrap = document.getElementById("ap-toast-wrap");
    if (!wrap) { wrap = document.createElement("div"); wrap.id = "ap-toast-wrap"; wrap.className = "ap-toast-wrap"; document.body.appendChild(wrap); }
    var t = document.createElement("div"); t.className = "ap-toast " + (kind || "");
    var ti = document.createElement("div"); ti.className = "t-title"; ti.textContent = title || "Info";
    var tm = document.createElement("div"); tm.className = "t-msg";   tm.textContent = message || "";
    t.appendChild(ti); t.appendChild(tm); wrap.appendChild(t);
    setTimeout(function () { try { t.remove(); } catch (e) {} }, typeof ms === "number" ? ms : 2600);
  }
  function modalError(title, e) {
    var msg = (e && e.message) ? e.message : String(e || "Unknown error");
    try { E.modal.show(title || "Error", "<div style='white-space:pre-wrap;font-size:13px;color:rgba(255,90,122,.9);'>" + esc(msg) + "</div>",
      [{ label: "Close", primary: true, onClick: async function () { E.modal.hide(); } }]); }
    catch (e2) { toast(title || "Error", msg, "bad"); }
  }
  function modalConfirm(title, bodyText, okLabel, cancelLabel) {
    return new Promise(function (resolve) {
      try {
        E.modal.show(title || "Confirm", "<div class='eikon-mini'>" + esc(bodyText || "") + "</div>", [
          { label: cancelLabel || "Cancel", onClick: async function () { E.modal.hide(); resolve(false); } },
          { label: okLabel || "OK", danger: true, onClick: async function () { E.modal.hide(); resolve(true); } }
        ]);
      } catch (e) { resolve(window.confirm(bodyText || "Are you sure?")); }
    });
  }

  // ============================================================
  //  IN-MEMORY DATA STORE (cloud is source of truth)
  // ============================================================
  var APPT_MEM = { doctors: [], clinics: [], schedules: [], apptsAll: [], apptByDate: {}, waitlist: [] };

  function loadDoctors()    { return Array.isArray(APPT_MEM.doctors)   ? APPT_MEM.doctors   : []; }
  function saveDoctors(a)   { APPT_MEM.doctors   = Array.isArray(a) ? a : []; }
  function loadClinics()    { return Array.isArray(APPT_MEM.clinics)   ? APPT_MEM.clinics   : []; }
  function saveClinics(a)   { APPT_MEM.clinics   = Array.isArray(a) ? a : []; }
  function loadSchedules()  { return Array.isArray(APPT_MEM.schedules) ? APPT_MEM.schedules : []; }
  function saveSchedules(a) { APPT_MEM.schedules = Array.isArray(a) ? a : []; }
  function loadAppts()      { return Array.isArray(APPT_MEM.apptsAll)  ? APPT_MEM.apptsAll  : []; }
  function saveAppts(arr) {
    APPT_MEM.apptsAll = Array.isArray(arr) ? arr : [];
    APPT_MEM.apptByDate = {};
    (APPT_MEM.apptsAll || []).forEach(function (a) {
      var d = a && (a.date || a.apptDate || a.appt_date);
      if (!d) return;
      d = String(d).slice(0, 10);
      if (!APPT_MEM.apptByDate[d]) APPT_MEM.apptByDate[d] = [];
      APPT_MEM.apptByDate[d].push(a);
    });
    apptLog("saveAppts: total="+APPT_MEM.apptsAll.length+" dates="+Object.keys(APPT_MEM.apptByDate).length);
  }
  function loadAppointments(dateKey) {
    if (!dateKey) return [];
    var a = APPT_MEM.apptByDate[String(dateKey)];
    return Array.isArray(a) ? a : [];
  }
  function saveAppointments(dateKey, arr) {
    if (!dateKey) return;
    var k = String(dateKey);
    APPT_MEM.apptByDate[k] = Array.isArray(arr) ? arr : [];
    // also update apptsAll
    var others = (APPT_MEM.apptsAll || []).filter(function(a){
      var d = a && (a.date || a.apptDate || a.appt_date);
      return String(d||"").slice(0,10) !== k;
    });
    APPT_MEM.apptsAll = others.concat(APPT_MEM.apptByDate[k]);
  }
  function apptsForDate(dateKey) { return loadAppointments(dateKey); }
  function apptById(id) {
    return loadAppts().filter(function (a) { return String(a.id) === String(id); })[0] || null;
  }
  function loadWaitlist()    { return Array.isArray(APPT_MEM.waitlist) ? APPT_MEM.waitlist : []; }
  function saveWaitlist(a)   { APPT_MEM.waitlist = Array.isArray(a) ? a : []; }
  function doctorById(id)    { return loadDoctors().filter(function (d) { return String(d.id) === String(id); })[0] || null; }
  function clinicById(id)    { return loadClinics().filter(function (c) { return String(c.id) === String(id); })[0] || null; }

  // ============================================================
  //  SCHEDULE HELPERS
  // ============================================================
  function apptDuration(a)   { return parseInt(a.durationMins || a.duration_mins || a.duration || 30, 10) || 30; }
  function apptStartMins(a)  { return timeToMins(a.time || a.startTime || "00:00"); }

  function schedulesForDate(dateKey, doctorId, clinicId) {
    var d = String(dateKey || "");
    var dow = dayOfWeek(d);
    return loadSchedules().filter(function (s) {
      if (s.cancelled) return false;
      if (doctorId && String(s.doctorId || s.doctor_id || "") !== String(doctorId)) return false;
      if (clinicId && String(s.clinicId || s.clinic_id || "") !== String(clinicId)) return false;
      if (s.isOneOff || s.is_one_off) return String(s.date || "") === d;
      var sdow = s.dayOfWeek != null ? s.dayOfWeek : s.day_of_week;
      if (sdow == null) return false;
      if (Number(sdow) !== Number(dow)) return false;
      if (s.validFrom  && String(s.validFrom)  > d) return false;
      if (s.validUntil && String(s.validUntil) < d) return false;
      if (s.valid_from  && String(s.valid_from)  > d) return false;
      if (s.valid_until && String(s.valid_until) < d) return false;
      return true;
    });
  }

  function getSchedulesForDate(ymd) {
    var dt = null;
    try { dt = new Date(String(ymd).slice(0, 10) + "T00:00:00"); } catch (e) { dt = null; }
    var jsDow = dt ? dt.getDay() : null;
    return loadSchedules().filter(function (s) {
      if (!s || s.cancelled) return false;
      var isOneOff = !!(s.isOneOff || s.is_one_off || s.oneOff || s.one_off);
      if (isOneOff) {
        var sd = s.date || s.oneOffDate || s.one_off_date;
        return String(sd || "").slice(0, 10) === String(ymd).slice(0, 10);
      }
      if (jsDow == null) return true;
      if (s.dayOfWeek != null && Number(s.dayOfWeek) !== Number(jsDow)) return false;
      var vf = s.validFrom || s.valid_from;
      var vu = s.validUntil || s.valid_until;
      var y = String(ymd).slice(0, 10);
      if (vf && String(vf).slice(0, 10) > y) return false;
      if (vu && String(vu).slice(0, 10) < y) return false;
      return true;
    });
  }

  function computeAvailableStartTimes(dateKey, doctorId, clinicId, durationMins) {
    var d = String(dateKey || "");
    var dur = parseInt(durationMins, 10) || 10;
    var appts = loadAppointments(d) || [];
    var scheds = schedulesForDate(d, doctorId, clinicId);
    apptLog("computeAvailableStartTimes", {date:d, doctorId:doctorId, clinicId:clinicId, dur:dur, schedCount:scheds.length, apptCount:appts.length});
    if (!scheds.length) return [];
    var slots = [];
    scheds.forEach(function (s) {
      var st = String(s.startTime || s.start_time || "09:00");
      var et = String(s.endTime   || s.end_time   || "17:00");
      var slotDur = parseInt(s.slotDuration || s.slot_duration || 10, 10) || 10;
      var startM = timeToMins(st);
      var endM   = timeToMins(et);
      for (var m = startM; m + dur <= endM; m += slotDur) {
        var ok = true;
        for (var i = 0; i < appts.length; i++) {
          var a = appts[i];
          if (String(a.doctorId || a.doctor_id || "") !== String(doctorId)) continue;
          if (String(a.clinicId || a.clinic_id || "") !== String(clinicId)) continue;
          if (String(a.status || "").toLowerCase() === "cancelled") continue;
          var aStart = apptStartMins(a);
          var aEnd   = aStart + apptDuration(a);
          if (aStart < m + dur && aEnd > m) { ok = false; break; }
        }
        if (ok) slots.push(minsToTime(m));
      }
    });
    slots = slots.filter(function (v, i, a) { return a.indexOf(v) === i; }).sort();
    apptLog("computeAvailableStartTimes result", slots.length, "slots");
    return slots;
  }

  async function ensureSchedulesLoaded() {
    try {
      if (loadSchedules().length) return;
      apptLog("ensureSchedulesLoaded:fetch");
      await apiLoadSchedules();
    } catch (e) { apptWarn("ensureSchedulesLoaded:error", e); }
  }

  async function ensureAppointmentsLoaded(dateKey) {
    try {
      if (!dateKey) return;
      var k = String(dateKey);
      if (Array.isArray(APPT_MEM.apptByDate[k])) return;
      apptLog("ensureAppointmentsLoaded:fetch", k);
      var arr = await apiLoadAppts({ date: k });
      saveAppointments(k, arr);
    } catch (e) { apptWarn("ensureAppointmentsLoaded:error", e); }
  }

  function computeTotal(a) {
    return (parseFloat(a.doctorFee) || 0) + (parseFloat(a.clinicFee) || 0) + (parseFloat(a.medicinesCost) || 0);
  }

  // ============================================================
  //  WHATSAPP HELPERS
  // ============================================================
  function waPhone(raw) {
    // Normalise phone to international digits only
    var p = String(raw || "").replace(/[\s\-\(\)\.]/g, "");
    if (!p) return "";
    if (p.startsWith("+"))  return p.slice(1).replace(/\D/g, "");
    if (p.startsWith("00")) return p.slice(2).replace(/\D/g, "");
    // Malta local numbers (7xxxxxxx or 9xxxxxxx = 8 digits)
    if (/^[79]\d{7}$/.test(p)) return "356" + p;
    // European numbers starting 2x (Malta land)
    if (/^2\d{7}$/.test(p)) return "356" + p;
    return p.replace(/\D/g, "");
  }
  // ============================================================
  //  WHATSAPP OPEN — uses whatsapp:// OS protocol (bypasses all CSP/COOP)
  // ============================================================
  function openWhatsAppLink(phone) {
    var p = waPhone(phone);
    if (!p) { toast("WhatsApp", "No phone number available.", "bad"); return; }

    // whatsapp:// is a custom URI scheme registered by WhatsApp Desktop at the OS level.
    // The browser hands it to the OS directly — no HTTP request is made, so CSP,
    // COOP, X-Frame-Options and ERR_BLOCKED_BY_RESPONSE headers never apply.
    var url = "whatsapp://send?phone=" + p;
    apptLog("openWhatsAppLink via whatsapp:// protocol", url);

    // Create a hidden <a> in THIS document and click it.
    // Custom protocol anchors always work from inside iframes — browsers exempt
    // mailto:, tel:, whatsapp:// etc. from frame navigation restrictions.
    try {
      var a = document.createElement("a");
      a.href = url;
      // No target="_blank" for protocol links — let the OS handle it
      a.style.cssText = "position:fixed;left:-9999px;top:-9999px;opacity:0;pointer-events:none;";
      document.body.appendChild(a);
      a.click();
      setTimeout(function () { try { document.body.removeChild(a); } catch (e) {} }, 1000);
    } catch (ex) {
      apptErr("openWhatsAppLink error", ex);
      toast("WhatsApp", "Could not open WhatsApp. Is WhatsApp Desktop installed?", "bad", 5000);
    }
  }

  function waUrl(phone) {
    var p = waPhone(phone); if (!p) return null;
    return "https://wa.me/" + p;
  }
  function whatsappBtnHtml(phone, extraStyle) {
    var p = waPhone(phone);
    if (!p || !phone) return "";
    // Store the normalised phone on a data attribute; JS listener reads it
    return "<button type='button' class='ap-wa-btn ap-wa-trigger' data-waphone='" + esc(p) + "' " +
      "style='" + (extraStyle || "") + "' title='Open WhatsApp for " + esc(phone) + "'>" +
      "<svg width='13' height='13' viewBox='0 0 24 24' fill='currentColor' style='vertical-align:middle;margin-right:3px;flex-shrink:0;'>" +
      "<path d='M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413z'/>" +
      "</svg>WhatsApp</button>";
  }

  // Global delegated listener for WhatsApp buttons (avoids inline onclick CSP issues)
  document.addEventListener("click", function (ev) {
    var btn = ev.target.closest ? ev.target.closest(".ap-wa-trigger") : null;
    if (!btn) {
      // Polyfill for browsers without closest
      var el = ev.target;
      while (el && el !== document) {
        if (el.classList && el.classList.contains("ap-wa-trigger")) { btn = el; break; }
        el = el.parentNode;
      }
    }
    if (!btn) return;
    ev.preventDefault();
    ev.stopPropagation();
    var phone = btn.getAttribute("data-waphone") || "";
    if (phone) openWhatsAppLink(phone);
  }, true);

  // ============================================================
  //  SCHEDULE-DRIVEN BOOKING HELPERS
  // ============================================================
  // Returns clinics that a specific doctor has any schedule at
  function clinicsForDoctor(doctorId) {
    if (!doctorId) return loadClinics();
    var scheds = loadSchedules().filter(function (s) {
      return !s.cancelled && String(s.doctorId || s.doctor_id || "") === String(doctorId);
    });
    var clinicIds = {};
    scheds.forEach(function (s) { clinicIds[String(s.clinicId || s.clinic_id || "")] = true; });
    var result = loadClinics().filter(function (c) { return clinicIds[String(c.id)]; });
    apptLog("clinicsForDoctor", doctorId, "→", result.length, "clinics");
    return result;
  }

  // Returns upcoming dates (next daysAhead days from today) where doctor+clinic has a schedule
  function upcomingScheduledDates(doctorId, clinicId, daysAhead) {
    daysAhead = daysAhead || 90;
    var result = [];
    var today = todayYmd();
    for (var i = 0; i <= daysAhead; i++) {
      var d = ymdAddDays(today, i);
      var scheds = schedulesForDate(d, doctorId, clinicId);
      if (scheds.length) result.push({ ymd: d, scheds: scheds });
    }
    apptLog("upcomingScheduledDates", doctorId, clinicId, "→", result.length, "dates");
    return result;
  }

  // Check if a specific shift (doctor+clinic+date) is fully booked (no slots at all)
  function isShiftFullyBooked(dateKey, doctorId, clinicId) {
    // Use smallest possible duration (5 min) to check if ANY slot remains
    var slots = computeAvailableStartTimes(dateKey, doctorId, clinicId, 5);
    return slots.length === 0;
  }

  // Build dropdown options for upcoming schedule dates
  function buildScheduleDateOptions(doctorId, clinicId, selected) {
    var dates = upcomingScheduledDates(doctorId, clinicId, 90);
    if (!dates.length) return "<option value=''>No scheduled sessions found</option>";
    return dates.map(function (item) {
      var d = item.ymd;
      var sched = item.scheds[0];
      var timeRange = sched ? (sched.startTime + " – " + sched.endTime) : "";
      var label = dayName(d) + " " + fmtDmy(d) + (timeRange ? "  (" + timeRange + ")" : "");
      return "<option value='" + d + "'" + (d === selected ? " selected" : "") + ">" + label + "</option>";
    }).join("");
  }

  // ============================================================
  //  API LAYER
  // ============================================================
  async function apiFetch(path, options) { return E.apiFetch(path, options || {}); }

  // Doctors
  async function apiLoadDoctors() {
    try {
      var resp = await apiFetch("/appointments/doctors", { method: "GET" });
      var arr  = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.doctors) ? resp.doctors : null);
      if (arr) { saveDoctors(arr); return arr; }
      return loadDoctors();
    } catch (e) { throw e; }
  }
  async function apiCreateDoctor(payload) {
    var resp = await apiFetch("/appointments/doctors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await apiLoadDoctors(); return resp;
  }
  async function apiUpdateDoctor(id, payload) {
    var resp = await apiFetch("/appointments/doctors/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await apiLoadDoctors(); return resp;
  }
  async function apiDeleteDoctor(id) {
    var resp = await apiFetch("/appointments/doctors/" + encodeURIComponent(id), { method: "DELETE" });
    await apiLoadDoctors(); return resp;
  }

  // Clinics
  async function apiLoadClinics() {
    try {
      var resp = await apiFetch("/appointments/clinics", { method: "GET" });
      var arr  = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.clinics) ? resp.clinics : null);
      if (arr) { saveClinics(arr); return arr; }
      return loadClinics();
    } catch (e) { throw e; }
  }
  async function apiCreateClinic(payload) {
    var resp = await apiFetch("/appointments/clinics", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await apiLoadClinics(); return resp;
  }
  async function apiUpdateClinic(id, payload) {
    var resp = await apiFetch("/appointments/clinics/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await apiLoadClinics(); return resp;
  }
  async function apiDeleteClinic(id) {
    var resp = await apiFetch("/appointments/clinics/" + encodeURIComponent(id), { method: "DELETE" });
    await apiLoadClinics(); return resp;
  }

  // Schedules
  async function apiLoadSchedules() {
    try {
      var resp = await apiFetch("/appointments/schedules", { method: "GET" });
      var arr  = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.schedules) ? resp.schedules : null);
      if (arr) { saveSchedules(arr); return arr; }
      return loadSchedules();
    } catch (e) { throw e; }
  }
  async function apiCreateSchedule(payload) {
    var resp = await apiFetch("/appointments/schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await apiLoadSchedules(); return resp;
  }
  async function apiUpdateSchedule(id, payload) {
    var resp = await apiFetch("/appointments/schedules/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    await apiLoadSchedules(); return resp;
  }
  async function apiDeleteSchedule(id) {
    var resp = await apiFetch("/appointments/schedules/" + encodeURIComponent(id), { method: "DELETE" });
    await apiLoadSchedules(); return resp;
  }

  // Appointments
  function apiApptToLocal(a) {
    return {
      id:                 String(a.id || ""),
      apptRef:            a.apptRef            || a.appt_ref            || "",
      token:              a.token              || "",
      patientName:        a.patientName        || a.patient_name        || "",
      patientIdCard:      a.patientIdCard      || a.patient_id_card     || "",
      patientPhone:       a.patientPhone       || a.patient_phone       || "",
      doctorId:           String(a.doctorId    || a.doctor_id           || ""),
      clinicId:           String(a.clinicId    || a.clinic_id           || ""),
      date:               String(a.date        || a.apptDate            || a.appt_date || "").slice(0, 10),
      time:               a.time              || a.startTime            || "",
      durationMins:       parseInt(a.durationMins || a.duration_mins    || a.duration || 30, 10) || 30,
      status:             a.status            || "Scheduled",
      doctorFee:          parseFloat(a.doctorFee   || a.doctor_fee      || 0) || 0,
      clinicFee:          parseFloat(a.clinicFee   || a.clinic_fee      || 0) || 0,
      medicinesCost:      parseFloat(a.medicinesCost || a.medicines_cost || 0) || 0,
      medicines:          a.medicines         || "",
      notes:              a.notes             || "",
      cancellationReason: a.cancellationReason || a.cancellation_reason || "",
      createdAt:          a.createdAt         || a.created_at           || "",
      updatedAt:          a.updatedAt         || a.updated_at           || ""
    };
  }
  async function apiLoadAppts(params) {
    try {
      var qs = params ? ("?" + new URLSearchParams(params).toString()) : "";
      var resp = await apiFetch("/appointments/entries" + qs, { method: "GET" });
      var arr  = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.appointments) ? resp.appointments : null);
      if (arr) {
        var mapped = arr.map(apiApptToLocal);
        if (params && params.date) {
          saveAppointments(params.date, mapped);
        } else {
          saveAppts(mapped);
        }
        return mapped;
      }
      return loadAppts();
    } catch (e) { throw e; }
  }
  async function apiCreateAppt(payload) {
    var resp = await apiFetch("/appointments/entries", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (resp && resp.appointment) {
      var arr = loadAppts(); arr.push(apiApptToLocal(resp.appointment)); saveAppts(arr);
    }
    return resp;
  }
  async function apiUpdateAppt(id, payload) {
    var resp = await apiFetch("/appointments/entries/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (resp && resp.appointment) {
      var arr = loadAppts();
      for (var i = 0; i < arr.length; i++) { if (String(arr[i].id) === String(id)) { arr[i] = apiApptToLocal(resp.appointment); break; } }
      saveAppts(arr);
    }
    return resp;
  }
  async function apiDeleteAppt(id) {
    var resp = await apiFetch("/appointments/entries/" + encodeURIComponent(id), { method: "DELETE" });
    saveAppts(loadAppts().filter(function (a) { return String(a.id) !== String(id); }));
    return resp;
  }

  // Waitlist
  function apiWlToLocal(w) {
    return {
      id:             w.id,
      wlRef:          w.wlRef          || w.wl_ref          || "",
      patientName:    w.patientName    || w.patient_name     || "",
      patientIdCard:  w.patientIdCard  || w.patient_id_card  || "",
      patientPhone:   w.patientPhone   || w.patient_phone    || "",
      doctorId:       String(w.doctorId || w.doctor_id        || ""),
      clinicId:       String(w.clinicId || w.clinic_id        || ""),
      preferredDates: w.preferredDates || w.preferred_dates  || "",
      flexibility:    w.flexibility    || "Flexible",
      status:         w.status         || "Waiting",
      promotedTo:     w.promotedTo     || w.promoted_to      || "",
      notes:          w.notes          || "",
      addedDate:      w.addedDate      || w.added_date        || "",
      createdAt:      w.createdAt      || w.created_at        || ""
    };
  }
  async function apiLoadWaitlist(params) {
    try {
      var qs = params ? ("?" + new URLSearchParams(params).toString()) : "";
      var resp = await apiFetch("/appointments/waitlist" + qs, { method: "GET" });
      var arr  = Array.isArray(resp) ? resp : (resp && Array.isArray(resp.waitlist) ? resp.waitlist : null);
      if (arr) { saveWaitlist(arr.map(apiWlToLocal)); return arr; }
      return loadWaitlist();
    } catch (e) { throw e; }
  }
  async function apiCreateWaitlist(payload) {
    var resp = await apiFetch("/appointments/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (resp && resp.entry) { var arr = loadWaitlist(); arr.unshift(apiWlToLocal(resp.entry)); saveWaitlist(arr); }
    return resp;
  }
  // Aliases used in modals
  var apiCreateWaitlistEntry = apiCreateWaitlist;
  async function apiUpdateWaitlistEntry(id, payload) {
    var resp = await apiFetch("/appointments/waitlist/" + encodeURIComponent(id), { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    if (resp && resp.entry) {
      var arr = loadWaitlist();
      for (var i = 0; i < arr.length; i++) { if (String(arr[i].id) === String(id)) { arr[i] = apiWlToLocal(resp.entry); break; } }
      saveWaitlist(arr);
    }
    return resp;
  }
  async function apiDeleteWaitlist(id) {
    var resp = await apiFetch("/appointments/waitlist/" + encodeURIComponent(id), { method: "DELETE" });
    saveWaitlist(loadWaitlist().filter(function (w) { return String(w.id) !== String(id); }));
    return resp;
  }
  var apiUpdateWaitlist = apiUpdateWaitlistEntry;

  // ============================================================
  //  STATUS HELPERS
  // ============================================================
  var APPT_STATUSES = ["Scheduled", "Confirmed", "Completed", "Cancelled", "No Show"];
  var WL_STATUSES   = ["Waiting", "Promoted", "Cancelled"];

  function statusClass(s) {
    var map = { Scheduled:"ap-s-scheduled", Confirmed:"ap-s-confirmed", Completed:"ap-s-completed", Cancelled:"ap-s-cancelled", "No Show":"ap-s-noshow", Waiting:"ap-s-waiting", Promoted:"ap-s-promoted" };
    return map[s] || "ap-s-scheduled";
  }
  function statusBadge(s) {
    var span = document.createElement("span"); span.className = "ap-status " + statusClass(s); span.textContent = s || "Scheduled"; return span;
  }

  // ============================================================
  //  CLOUD SYNC & REFRESH
  // ============================================================
  var _autoRefreshTimer = null;
  var _lastRefreshTime  = 0;

  async function refreshAll(reason) {
    reason = reason || "unknown";
    var now = Date.now();
    apptLog("refreshAll:start reason="+reason, "sinceLastRefresh="+(now-_lastRefreshTime)+"ms");
    _lastRefreshTime = now;
    try { await apiLoadDoctors();   apptLog("refreshAll: doctors="+loadDoctors().length); }   catch (e) { apptWarn("refreshAll: doctors failed", e && e.message); }
    try { await apiLoadClinics();   apptLog("refreshAll: clinics="+loadClinics().length); }   catch (e) { apptWarn("refreshAll: clinics failed", e && e.message); }
    try { await apiLoadSchedules(); apptLog("refreshAll: schedules="+loadSchedules().length); } catch (e) { apptWarn("refreshAll: schedules failed", e && e.message); }
    try {
      if (state && (state.view === "day" || state.view === "month")) {
        if (state.view === "day") {
          await apiLoadAppts({ date: state.currentDate });
        } else {
          // For month view, load all appointments (or just this month range)
          await apiLoadAppts();
        }
      } else {
        await apiLoadAppts();
      }
      apptLog("refreshAll: appts="+loadAppts().length);
    } catch (e) { apptWarn("refreshAll: appts failed", e && e.message); }
    try { await apiLoadWaitlist(); apptLog("refreshAll: waitlist="+loadWaitlist().length); } catch (e) { apptWarn("refreshAll: waitlist failed", e && e.message); }
    apptLog("refreshAll:done reason="+reason);
    try { if (state && typeof state.refresh === "function") state.refresh(); } catch (e) { apptWarn("refreshAll: state.refresh failed", e); }
  }

  function startAutoRefresh() {
    if (_autoRefreshTimer) { clearInterval(_autoRefreshTimer); _autoRefreshTimer = null; }
    _autoRefreshTimer = setInterval(function () {
      apptLog("auto-refresh tick");
      refreshAll("auto-poll").catch(function (e) { apptWarn("auto-poll failed", e && e.message); });
    }, 30000); // every 30 seconds
    apptLog("auto-refresh started (30s interval)");
  }

  // ============================================================
  //  CSS STYLES
  // ============================================================
  var apStyleInstalled = false;
  function ensureStyles() {
    if (apStyleInstalled) return; apStyleInstalled = true;
    var st = document.createElement("style"); st.id = "eikon-appt-style";
    st.textContent =
      // ---- Layout ----
      ".ap-wrap{max-width:1500px;margin:0 auto;padding:16px;font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;}" +
      ".ap-head{display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;justify-content:space-between;margin-bottom:14px;}" +
      ".ap-title{margin:0;font-size:20px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-sub{margin:4px 0 0 0;font-size:12px;color:var(--muted,rgba(233,238,247,.6));}" +
      ".ap-controls{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}" +

      // ---- Cards ----
      ".ap-card{border:1px solid var(--line,rgba(255,255,255,.10));border-radius:16px;padding:14px;" +
      "background:var(--panel,rgba(16,24,36,.66));box-shadow:0 18px 50px rgba(0,0,0,.38);" +
      "backdrop-filter:blur(10px);margin-bottom:14px;}" +
      ".ap-card-head{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin-bottom:12px;}" +
      ".ap-card-head h3{margin:0;font-size:15px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-card-head .meta{font-size:12px;color:var(--muted,rgba(233,238,247,.68));font-weight:800;}" +
      ".ap-card-head .right{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}" +

      // ---- Tabs ----
      ".ap-tabs{display:flex;gap:3px;background:rgba(10,16,24,.5);border-radius:12px;padding:4px;border:1px solid rgba(255,255,255,.08);}" +
      ".ap-tab{font-size:12px;font-weight:900;padding:6px 14px;border-radius:9px;cursor:pointer;border:none;background:transparent;color:rgba(233,238,247,.55);transition:all 140ms;white-space:nowrap;}" +
      ".ap-tab:hover{background:rgba(255,255,255,.07);color:rgba(233,238,247,.9);}" +
      ".ap-tab.active{background:rgba(58,160,255,.22);color:#7dc8ff;border:1px solid rgba(58,160,255,.35);}" +

      // ---- Waiting list badge ----
      ".ap-wl-badge{display:inline-block;font-size:10px;font-weight:900;padding:1px 7px;border-radius:999px;" +
      "background:rgba(204,148,255,.18);border:1px solid rgba(204,148,255,.32);color:#d4a0ff;margin-left:4px;}" +

      // ---- Global filter bar ----
      ".ap-filter-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:10px 12px;" +
      "background:rgba(10,16,24,.35);border:1px solid rgba(255,255,255,.07);border-radius:12px;margin-bottom:12px;}" +
      ".ap-filter-bar label{font-size:11px;font-weight:900;color:var(--muted,rgba(233,238,247,.55));text-transform:uppercase;letter-spacing:.5px;}" +
      ".ap-filter-group{display:flex;align-items:center;gap:6px;}" +
      ".ap-refresh-info{font-size:11px;color:rgba(233,238,247,.35);margin-left:auto;}" +
      ".ap-refresh-dot{display:inline-block;width:6px;height:6px;border-radius:50%;background:#43d17a;margin-right:4px;animation:apRefreshPulse 2s infinite;}" +
      "@keyframes apRefreshPulse{0%,100%{opacity:1;}50%{opacity:.3;}}" +

      // ---- Day navigator ----
      ".ap-nav{display:flex;align-items:center;gap:8px;}" +
      ".ap-nav-btn{font-size:15px;font-weight:900;padding:6px 12px;border-radius:9px;cursor:pointer;border:1px solid rgba(255,255,255,.10);background:rgba(10,16,24,.5);color:var(--text,#e9eef7);transition:all 100ms;}" +
      ".ap-nav-btn:hover{background:rgba(255,255,255,.07);}" +
      ".ap-nav-date{font-size:15px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-nav-sub{font-size:11px;color:#43d17a;margin-top:1px;font-weight:700;}" +
      ".ap-date-input{color-scheme:dark;padding:7px 10px;border:1px solid rgba(255,255,255,.10);border-radius:10px;background:rgba(10,16,24,.6);color:var(--text,#e9eef7);font-size:12px;outline:none;}" +
      ".ap-date-input:focus{border-color:rgba(58,160,255,.55);}" +

      // ---- MONTH CALENDAR GRID ----
      ".ap-month-outer{overflow:auto;}" +
      ".ap-month-grid{display:grid;grid-template-columns:repeat(7,1fr);border:1px solid rgba(255,255,255,.08);border-radius:12px;overflow:hidden;}" +
      ".ap-month-header{background:rgba(12,20,32,.8);padding:10px 6px;text-align:center;font-size:11px;font-weight:900;color:rgba(233,238,247,.5);text-transform:uppercase;letter-spacing:.8px;border-bottom:1px solid rgba(255,255,255,.08);}" +
      ".ap-month-header.weekend{color:rgba(255,157,67,.6);}" +
      ".ap-month-day{min-height:90px;padding:6px;border-right:1px solid rgba(255,255,255,.06);border-bottom:1px solid rgba(255,255,255,.06);background:rgba(10,16,24,.15);position:relative;cursor:pointer;transition:background 120ms;}" +
      ".ap-month-day:hover{background:rgba(255,255,255,.04);}" +
      ".ap-month-day.today{background:rgba(58,160,255,.08);}" +
      ".ap-month-day.today .ap-mday-num{color:#7dc8ff;background:rgba(58,160,255,.25);border-radius:50%;width:24px;height:24px;display:flex;align-items:center;justify-content:center;}" +
      ".ap-month-day.other-month{background:rgba(10,16,24,.05);opacity:.45;}" +
      ".ap-month-day.has-schedule{border-top:2px solid rgba(58,160,255,.35);}" +
      ".ap-month-day.weekend{background:rgba(10,16,24,.08);}" +
      ".ap-mday-num{font-size:13px;font-weight:900;color:var(--text,#e9eef7);margin-bottom:4px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;}" +
      ".ap-mday-appts{display:flex;flex-direction:column;gap:2px;}" +
      ".ap-mday-chip{font-size:10px;font-weight:800;padding:1px 6px;border-radius:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#fff;cursor:pointer;transition:filter 100ms;}" +
      ".ap-mday-chip:hover{filter:brightness(1.15);}" +
      ".ap-mday-more{font-size:10px;color:rgba(233,238,247,.45);padding:1px 4px;cursor:pointer;}" +
      ".ap-month-legend{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:10px;align-items:center;}" +
      ".ap-legend-item{display:flex;align-items:center;gap:5px;font-size:11px;font-weight:700;color:rgba(233,238,247,.7);}" +
      ".ap-legend-dot{width:10px;height:10px;border-radius:3px;flex-shrink:0;}" +

      // ---- DAY TIMELINE ----
      ".ap-timeline-outer{overflow-x:auto;}" +
      ".ap-timeline-wrap{display:flex;min-width:600px;position:relative;}" +
      ".ap-time-axis{width:62px;flex-shrink:0;position:relative;}" +
      ".ap-time-label{position:absolute;right:10px;font-size:10px;font-weight:700;color:rgba(233,238,247,.38);transform:translateY(-50%);white-space:nowrap;}" +
      ".ap-hour-line{position:absolute;left:62px;right:0;border-top:1px solid rgba(255,255,255,.07);}" +
      ".ap-half-line{position:absolute;left:62px;right:0;border-top:1px dashed rgba(255,255,255,.04);}" +
      ".ap-timeline-cols{display:flex;flex:1;gap:0;position:relative;overflow:hidden;}" +
      ".ap-timeline-col{flex:1;min-width:160px;border-right:1px solid rgba(255,255,255,.06);position:relative;}" +
      ".ap-timeline-col:last-child{border-right:none;}" +
      ".ap-col-header{position:sticky;top:0;z-index:10;background:rgba(12,20,32,.95);border-bottom:1px solid rgba(255,255,255,.1);padding:8px 10px;text-align:center;}" +
      ".ap-col-header .col-dr{font-size:12px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-col-header .col-cl{font-size:10px;color:rgba(233,238,247,.55);margin-top:1px;}" +
      ".ap-col-body{position:relative;}" +
      ".ap-slot-available{position:absolute;left:3px;right:3px;border-radius:5px;border:1px dashed rgba(255,255,255,.13);background:rgba(255,255,255,.02);" +
      "display:flex;align-items:center;justify-content:space-between;padding:0 7px;" +
      "cursor:pointer;transition:background 120ms,border-color 120ms;overflow:hidden;}" +
      ".ap-slot-available:hover{background:rgba(58,160,255,.12);border-color:rgba(58,160,255,.5);}" +
      ".ap-slot-time{font-size:10px;font-weight:800;color:rgba(233,238,247,.35);letter-spacing:.3px;transition:color 120ms;pointer-events:none;}" +
      ".ap-slot-plus{font-size:14px;font-weight:900;color:rgba(233,238,247,.2);transition:color 120ms;pointer-events:none;}" +
      ".ap-slot-available:hover .ap-slot-time{color:rgba(58,160,255,.9);}" +
      ".ap-slot-available:hover .ap-slot-plus{color:rgba(58,160,255,.7);}" +
      ".ap-appt-block{position:absolute;left:3px;right:3px;border-radius:8px;overflow:hidden;cursor:pointer;transition:filter 120ms,box-shadow 120ms;}" +
      ".ap-appt-block:hover{filter:brightness(1.1);box-shadow:0 4px 16px rgba(0,0,0,.35);}" +
      ".ap-appt-block.selected{box-shadow:0 0 0 2px #fff;}" +
      ".ap-appt-inner{padding:4px 7px;height:100%;display:flex;flex-direction:column;justify-content:center;overflow:hidden;}" +
      ".ap-appt-name{font-size:11px;font-weight:900;color:#fff;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".ap-appt-meta{font-size:10px;color:rgba(255,255,255,.7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}" +
      ".ap-appt-cancelled{opacity:.45;text-decoration:line-through;}" +
      ".ap-timeline-empty{padding:32px;text-align:center;font-size:13px;color:rgba(233,238,247,.35);font-style:italic;}" +
      ".ap-day-detail-panel{margin-top:12px;}" +

      // ---- Schedule info bar ----
      ".ap-sched-bar{border:1px solid rgba(58,160,255,.2);background:rgba(58,160,255,.06);border-radius:10px;padding:7px 12px;margin-bottom:10px;font-size:11px;color:rgba(90,162,255,.85);display:flex;align-items:center;gap:8px;flex-wrap:wrap;}" +
      ".ap-repeat-tag{font-size:10px;font-weight:900;padding:2px 7px;border-radius:999px;background:rgba(58,160,255,.15);border:1px solid rgba(58,160,255,.3);color:#7dc8ff;}" +

      // ---- Table ----
      ".ap-table-wrap{overflow:auto;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:12px;background:rgba(10,16,24,.18);}" +
      ".ap-table{width:max-content;min-width:100%;border-collapse:collapse;color:var(--text,#e9eef7);}" +
      ".ap-table th,.ap-table td{border-bottom:1px solid var(--line,rgba(255,255,255,.10));padding:8px 10px;font-size:12px;vertical-align:middle;}" +
      ".ap-table th{background:rgba(12,19,29,.92);position:sticky;top:0;z-index:1;color:var(--muted,rgba(233,238,247,.68));text-transform:uppercase;letter-spacing:.8px;font-weight:900;text-align:left;cursor:pointer;user-select:none;white-space:nowrap;}" +
      ".ap-table th.noclick{cursor:default;}" +
      ".ap-table tbody tr:hover{background:rgba(255,255,255,.04);cursor:pointer;}" +
      ".ap-row-sel{background:rgba(58,160,255,.10)!important;outline:1px solid rgba(58,160,255,.25);}" +

      // ---- Status chips ----
      ".ap-status{display:inline-block;font-size:11px;font-weight:900;padding:3px 9px;border-radius:999px;letter-spacing:.3px;white-space:nowrap;}" +
      ".ap-s-scheduled{background:rgba(58,160,255,.18);border:1px solid rgba(58,160,255,.38);color:#7dc8ff;}" +
      ".ap-s-confirmed{background:rgba(67,209,122,.16);border:1px solid rgba(67,209,122,.35);color:#6de0a0;}" +
      ".ap-s-completed{background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.15);color:rgba(233,238,247,.55);}" +
      ".ap-s-cancelled{background:rgba(255,90,122,.14);border:1px solid rgba(255,90,122,.32);color:#ff8ca4;}" +
      ".ap-s-noshow{background:rgba(255,157,67,.14);border:1px solid rgba(255,157,67,.32);color:#ffbe7d;}" +
      ".ap-s-waiting{background:rgba(204,148,255,.14);border:1px solid rgba(204,148,255,.32);color:#d4a0ff;}" +
      ".ap-s-promoted{background:rgba(67,209,122,.16);border:1px solid rgba(67,209,122,.35);color:#6de0a0;}" +

      // ---- Detail panel ----
      ".ap-detail-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px;margin-bottom:10px;}" +
      ".ap-kv{border:1px solid rgba(255,255,255,.08);border-radius:12px;background:rgba(10,16,24,.22);padding:9px 11px;}" +
      ".ap-kv .k{font-size:10px;font-weight:900;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.8px;margin-bottom:4px;}" +
      ".ap-kv .v{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;word-break:break-word;}" +
      ".ap-kv.wide{grid-column:1/-1;}" +
      ".ap-kv.half{grid-column:span 2;}" +
      ".ap-kv.fee{border-color:rgba(67,209,122,.2);}" +
      ".ap-kv.total{border-color:rgba(67,209,122,.4);background:rgba(67,209,122,.05);}" +
      ".ap-kv.total .v{font-size:15px;font-weight:900;color:rgba(67,209,122,.95);}" +
      ".ap-token-box{font-family:monospace;font-size:18px;font-weight:900;letter-spacing:4px;color:#7dc8ff;background:rgba(58,160,255,.1);border-radius:8px;padding:3px 10px;display:inline-block;}" +
      ".ap-sel-actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:flex-end;margin-top:10px;}" +
      ".ap-meds{border:1px solid rgba(255,200,90,.15);border-radius:12px;background:rgba(255,200,90,.04);padding:10px;}" +
      ".ap-meds .meds-txt{font-size:12px;color:var(--text,#e9eef7);white-space:pre-wrap;}" +

      // ---- Inputs/selects ----
      ".ap-input,.ap-select,.ap-textarea{padding:8px 10px;border:1px solid var(--line,rgba(255,255,255,.10));border-radius:10px;" +
      "background:rgba(10,16,24,.64);color:var(--text,#e9eef7);outline:none;font-size:13px;" +
      "transition:border-color 120ms,box-shadow 120ms;}" +
      ".ap-input:focus,.ap-select:focus,.ap-textarea:focus{border-color:rgba(58,160,255,.55);box-shadow:0 0 0 3px rgba(58,160,255,.18);}" +
      ".ap-select{color-scheme:dark;}" +
      ".ap-textarea{min-height:70px;resize:vertical;width:100%;}" +
      ".ap-input[type=date]{color-scheme:dark;}" +
      ".ap-total-preview{font-size:13px;font-weight:900;color:rgba(67,209,122,.9);padding:8px 12px;border:1px solid rgba(67,209,122,.25);border-radius:10px;background:rgba(67,209,122,.06);}" +

      // ---- Filters ----
      ".ap-filters{display:flex;flex-wrap:wrap;gap:8px;align-items:flex-end;margin-bottom:10px;}" +
      ".ap-filter-field{display:flex;flex-direction:column;gap:3px;}" +
      ".ap-filter-field label{font-size:11px;font-weight:900;color:var(--muted,rgba(233,238,247,.6));text-transform:uppercase;letter-spacing:.5px;}" +

      // ---- Mgmt modals ----
      ".ap-mgmt-grid{display:grid;gap:6px;}" +
      ".ap-mgmt-row{display:flex;align-items:center;gap:8px;padding:8px 10px;border:1px solid rgba(255,255,255,.07);border-radius:10px;background:rgba(10,16,24,.2);}" +
      ".ap-mgmt-row .mgmt-name{flex:1;font-size:13px;font-weight:900;color:var(--text,#e9eef7);}" +
      ".ap-mgmt-row .mgmt-sub{font-size:11px;color:var(--muted,rgba(233,238,247,.55));}" +
      ".ap-mgmt-row .mgmt-actions{display:flex;gap:6px;}" +
      ".ap-add-btn{font-size:12px;font-weight:900;padding:6px 14px;border-radius:9px;cursor:pointer;border:1px dashed rgba(255,255,255,.2);background:transparent;color:rgba(233,238,247,.6);transition:all 100ms;}" +
      ".ap-add-btn:hover{border-color:rgba(58,160,255,.4);color:#7dc8ff;background:rgba(58,160,255,.08);}" +
      ".ap-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;}" +
      ".ap-form-grid .eikon-field{margin:0;}" +
      ".ap-form-full{grid-column:1/-1;}" +
      ".ap-form-section{font-size:11px;font-weight:900;text-transform:uppercase;letter-spacing:.8px;color:var(--muted,rgba(233,238,247,.55));border-top:1px solid rgba(255,255,255,.08);padding-top:10px;margin-top:4px;}" +
      ".ap-form-fee-grid{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;}" +

      // ---- Sort indicator ----
      ".ap-sort{display:inline-flex;gap:5px;align-items:center;}" +
      ".ap-sort .car{opacity:.45;font-size:10px;}" +
      ".ap-sort.on .car{opacity:1;}" +

      // ---- WhatsApp Button ----
      ".ap-wa-btn{display:inline-flex;align-items:center;gap:3px;padding:3px 10px;border-radius:999px;background:#25d366;color:#fff;" +
      "font-size:11px;font-weight:900;text-decoration:none;cursor:pointer;transition:filter 120ms;white-space:nowrap;vertical-align:middle;border:none;}" +
      ".ap-wa-btn:hover{filter:brightness(1.12);}" +

      // ---- Schedule cascade hint ----
      ".ap-cascade-hint{font-size:11px;color:rgba(255,157,67,.8);background:rgba(255,157,67,.08);border:1px solid rgba(255,157,67,.2);border-radius:8px;padding:6px 10px;margin-top:4px;}" +
      ".ap-booked-badge{display:inline-block;background:rgba(255,90,122,.18);border:1px solid rgba(255,90,122,.4);color:#ff8ca4;border-radius:999px;font-size:10px;font-weight:900;padding:2px 8px;margin-left:6px;}" +

      // ---- Responsive ----
      "@media(max-width:980px){.ap-detail-grid{grid-template-columns:repeat(2,minmax(0,1fr));}.ap-kv.wide{grid-column:1/-1;}.ap-kv.half{grid-column:1/-1;}}" +
      "@media(max-width:600px){.ap-detail-grid{grid-template-columns:1fr;}.ap-form-grid{grid-template-columns:1fr;}.ap-form-fee-grid{grid-template-columns:1fr;}.ap-month-day{min-height:60px;}}" +
      "@media(max-width:920px){.ap-wrap{padding:10px;}}";

    document.head.appendChild(st);
  }

  // ============================================================
  //  DROPDOWN BUILDERS
  // ============================================================
  function buildDoctorOptions(selected, allowEmpty) {
    var docs = loadDoctors();
    var html = allowEmpty ? "<option value=''>- Any Doctor -</option>" : "<option value=''>- Select Doctor -</option>";
    docs.forEach(function (d) {
      html += "<option value='" + esc(d.id) + "'" + (String(d.id) === String(selected) ? " selected" : "") + ">" + esc(d.name) + (d.specialty ? " (" + esc(d.specialty) + ")" : "") + "</option>";
    });
    return html;
  }
  function buildClinicOptions(selected, allowEmpty) {
    var clinics = loadClinics();
    var html = allowEmpty ? "<option value=''>- Any Clinic -</option>" : "<option value=''>- Select Clinic -</option>";
    clinics.forEach(function (c) {
      html += "<option value='" + esc(c.id) + "'" + (String(c.id) === String(selected) ? " selected" : "") + ">" + esc(c.name) + (c.locality ? " - " + esc(c.locality) : "") + "</option>";
    });
    return html;
  }
  function buildStatusOptions(selected, statuses) {
    return statuses.map(function (s) { return "<option value='" + esc(s) + "'" + (s === selected ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("");
  }
  function buildDowOptions(selected) {
    var days = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];
    return days.map(function (d, i) { return "<option value='" + i + "'" + (String(i) === String(selected) ? " selected" : "") + ">" + d + "</option>"; }).join("");
  }
  function buildDowCheckboxes(selectedArr) {
    var sel = {};
    try { (selectedArr || []).forEach(function (v) { sel[String(v)] = true; }); } catch (e) {}
    var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    return days.map(function (lbl, i) {
      var chk = sel[String(i)] ? " checked" : "";
      return "<label style='display:inline-flex;align-items:center;gap:6px;font-size:12px;padding:4px 6px;border:1px solid rgba(255,255,255,.12);border-radius:8px;cursor:pointer;'>" +
             "<input class='ap-dowchk' type='checkbox' value='" + i + "'" + chk + ">" + lbl + "</label>";
    }).join("");
  }

  // ============================================================
  //  PRINT FUNCTIONS
  // ============================================================
  function printApptList(list, title, filterDesc) {
    var w = window.open("", "_blank");
    if (!w) { toast("Print", "Popup blocked.", "bad"); return; }
    function safe(s) { return esc(s); }
    var rowsHtml = "";
    list.forEach(function (a) {
      var dr = doctorById(a.doctorId); var cl = clinicById(a.clinicId);
      rowsHtml += "<tr><td>" + safe(a.id) + "</td><td>" + safe(fmtDmy(a.date)) + "</td><td>" + safe(a.time || "") + "</td>" +
        "<td>" + safe(a.patientName) + "</td><td>" + safe(a.patientIdCard || "") + "</td><td>" + safe(a.patientPhone || "") + "</td>" +
        "<td>" + safe(dr ? dr.name : "") + "</td><td>" + safe(cl ? cl.name : "") + "</td><td>" + safe(a.status || "Scheduled") + "</td>" +
        "<td style='text-align:right;'>EUR" + safe((parseFloat(a.doctorFee) || 0).toFixed(2)) + "</td>" +
        "<td style='text-align:right;'>EUR" + safe((parseFloat(a.clinicFee) || 0).toFixed(2)) + "</td>" +
        "<td style='text-align:right;font-weight:bold;'>EUR" + safe(computeTotal(a).toFixed(2)) + "</td></tr>";
    });
    var totals = list.reduce(function (acc, a) { acc.doc += parseFloat(a.doctorFee) || 0; acc.cl += parseFloat(a.clinicFee) || 0; acc.tot += computeTotal(a); return acc; }, { doc: 0, cl: 0, tot: 0 });
    var html = "<!doctype html><html><head><meta charset='utf-8'><title>" + safe(title) + "</title>" +
      "<style>body{font-family:system-ui;margin:18px;color:#111;font-size:12px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      "h1{margin:0 0 4px 0;font-size:18px;}.meta{font-size:11px;color:#555;margin-bottom:12px;}" +
      "table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;}" +
      "th{background:#f0f2f5;font-weight:800;text-align:left;}tr:nth-child(even){background:#fafbfc;}tfoot td{font-weight:800;background:#e8edf3;}" +
      "@media print{button{display:none!important;}}</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<h1>" + safe(title) + "</h1><div class='meta'>Records: " + list.length + (filterDesc ? "  " + safe(filterDesc) : "") + "  Printed: " + new Date().toLocaleString() + "</div>" +
      "<table><thead><tr><th>ID</th><th>Date</th><th>Time</th><th>Patient</th><th>ID Card</th><th>Phone</th><th>Doctor</th><th>Clinic</th><th>Status</th><th>Dr Fee</th><th>Clinic Fee</th><th>Total</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody><tfoot><tr><td colspan='9' style='text-align:right;'>TOTALS</td>" +
      "<td style='text-align:right;'>EUR" + totals.doc.toFixed(2) + "</td><td style='text-align:right;'>EUR" + totals.cl.toFixed(2) + "</td>" +
      "<td style='text-align:right;'>EUR" + totals.tot.toFixed(2) + "</td></tr></tfoot></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script></body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  function printSingleAppt(a) {
    if (!a) return;
    var w = window.open("", "_blank"); if (!w) { toast("Print", "Popup blocked.", "bad"); return; }
    function safe(s) { return esc(s); }
    var dr = doctorById(a.doctorId); var cl = clinicById(a.clinicId); var meds = a.medicines || "";
    var html = "<!doctype html><html><head><meta charset='utf-8'><title>Appointment " + safe(a.id) + "</title>" +
      "<style>body{font-family:system-ui;margin:18px;color:#111;font-size:13px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      ".hdr{display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #e0e0e0;padding-bottom:12px;margin-bottom:14px;}" +
      ".aid{font-size:20px;font-weight:900;}.asub{font-size:13px;color:#555;margin-top:3px;}" +
      ".token-box{font-family:monospace;font-size:22px;font-weight:900;letter-spacing:5px;background:#e8f4ff;border:2px solid #2a8;border-radius:8px;padding:4px 12px;color:#005a8e;}" +
      ".grid{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:14px;}" +
      ".kv{border:1px solid #e8e8e8;border-radius:8px;padding:9px;}.k{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".kv.wide{grid-column:1/-1;}.kv.half{grid-column:span 2;}" +
      ".fee-row{display:flex;gap:10px;margin-bottom:14px;}.fee-box{flex:1;border:1px solid #e2e4e8;border-radius:8px;padding:10px;}" +
      ".fee-box.total{border-color:#2a8;background:#f0fff4;}.fk{font-size:10px;font-weight:800;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:4px;}" +
      ".fv{font-size:14px;font-weight:900;}.fee-box.total .fv{color:#1a7a50;font-size:17px;}" +
      "@media print{button{display:none!important;}}</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button>" +
      "<div class='hdr'><div><div class='aid'>" + safe(a.id || "-") + "</div>" +
      "<div class='asub'>" + safe(fmtDmy(a.date)) + " at " + safe(a.time || "-") + "  " + safe(a.status || "Scheduled") + "</div></div>" +
      "<div><div style='font-size:10px;color:#888;margin-bottom:3px;'>PATIENT TOKEN</div><div class='token-box'>" + safe(a.token || "-") + "</div></div></div>" +
      "<div class='grid'>" +
      "<div class='kv half'><div class='k'>Patient</div><div class='v'>" + safe(a.patientName || "-") + "</div></div>" +
      "<div class='kv'><div class='k'>ID Card</div><div class='v'>" + safe(a.patientIdCard || "-") + "</div></div>" +
      "<div class='kv'><div class='k'>Phone</div><div class='v'>" + safe(a.patientPhone || "-") + "</div></div>" +
      "<div class='kv'><div class='k'>Doctor</div><div class='v'>" + safe(dr ? dr.name : "-") + "</div></div>" +
      "<div class='kv'><div class='k'>Clinic</div><div class='v'>" + safe(cl ? cl.name : "-") + (cl && cl.locality ? "  " + safe(cl.locality) : "") + "</div></div>" +
      "<div class='kv'><div class='k'>Duration</div><div class='v'>" + safe(a.durationMins || "-") + " min</div></div>" +
      (a.notes ? "<div class='kv wide'><div class='k'>Notes</div><div class='v'>" + safe(a.notes) + "</div></div>" : "") + "</div>" +
      "<div class='fee-row'>" +
      "<div class='fee-box'><div class='fk'>Doctor Fee</div><div class='fv'>EUR" + safe((parseFloat(a.doctorFee) || 0).toFixed(2)) + "</div></div>" +
      "<div class='fee-box'><div class='fk'>Clinic Fee</div><div class='fv'>EUR" + safe((parseFloat(a.clinicFee) || 0).toFixed(2)) + "</div></div>" +
      "<div class='fee-box'><div class='fk'>Medicines</div><div class='fv'>EUR" + safe((parseFloat(a.medicinesCost) || 0).toFixed(2)) + "</div></div>" +
      "<div class='fee-box total'><div class='fk'>Total Due</div><div class='fv'>EUR" + safe(computeTotal(a).toFixed(2)) + "</div></div></div>" +
      (meds ? "<div style='border:1px solid #f0c060;border-radius:8px;padding:12px;'><div style='font-size:10px;font-weight:800;color:#a07000;text-transform:uppercase;margin-bottom:6px;'>Medicines</div><div style='font-size:12px;white-space:pre-wrap;'>" + safe(meds) + "</div></div>" : "") +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script></body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  function printWaitlist(list) {
    var w = window.open("", "_blank"); if (!w) { toast("Print", "Popup blocked.", "bad"); return; }
    function safe(s) { return esc(s); }
    var rowsHtml = "";
    list.forEach(function (wl) {
      var dr = doctorById(wl.doctorId); var cl = clinicById(wl.clinicId);
      rowsHtml += "<tr><td>" + safe(wl.id) + "</td><td>" + safe(wl.patientName || "") + "</td><td>" + safe(wl.patientIdCard || "") + "</td>" +
        "<td>" + safe(wl.patientPhone || "") + "</td><td>" + safe(dr ? dr.name : "Any") + "</td><td>" + safe(cl ? cl.name : "Any") + "</td>" +
        "<td>" + safe(wl.preferredDates || "") + "</td><td>" + safe(wl.flexibility || "") + "</td>" +
        "<td>" + safe(fmtDmy(wl.addedDate || "")) + "</td><td>" + safe(wl.status || "Waiting") + "</td><td>" + safe(wl.notes || "") + "</td></tr>";
    });
    var html = "<!doctype html><html><head><meta charset='utf-8'><title>Waiting List</title>" +
      "<style>body{font-family:system-ui;margin:18px;color:#111;font-size:12px;}" +
      "button{position:fixed;right:14px;top:14px;padding:8px 12px;font-weight:800;cursor:pointer;border-radius:8px;border:1px solid #ccc;background:#f5f5f5;}" +
      "h1{margin:0 0 4px 0;font-size:18px;}.meta{font-size:11px;color:#555;margin-bottom:12px;}" +
      "table{width:100%;border-collapse:collapse;}th,td{border:1px solid #ddd;padding:5px 7px;font-size:11px;}" +
      "th{background:#f0f2f5;font-weight:800;text-align:left;}tr:nth-child(even){background:#fafbfc;}" +
      "@media print{button{display:none!important;}}</style></head><body>" +
      "<button onclick='window.print()'>🖨 Print</button><h1>Waiting List</h1>" +
      "<div class='meta'>Records: " + list.length + "  Printed: " + new Date().toLocaleString() + "</div>" +
      "<table><thead><tr><th>ID</th><th>Patient</th><th>ID Card</th><th>Phone</th><th>Doctor Pref.</th><th>Clinic Pref.</th><th>Preferred Dates</th><th>Flexibility</th><th>Added</th><th>Status</th><th>Notes</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody></table>" +
      "<script>setTimeout(function(){try{window.print()}catch(e){}},250);<\/script></body></html>";
    w.document.open(); w.document.write(html); w.document.close();
  }

  // ============================================================
  //  MODALS: DOCTOR MANAGEMENT
  // ============================================================
  function openDoctorsModal(onDone) {
    function renderBody() {
      var docs = loadDoctors();
      var rows = docs.length ? docs.map(function (d) {
        return "<div class='ap-mgmt-row' data-id='" + esc(d.id) + "'>" +
          "<div><div class='mgmt-name'>" + esc(d.name) + "</div>" +
          "<div class='mgmt-sub'>" + esc(d.specialty || "General") + "  Fee: " + esc(fmtMoney(d.defaultFee || 0)) + "</div></div>" +
          "<div class='mgmt-actions'>" +
          "<button class='eikon-btn ap-dr-edit' data-id='" + esc(d.id) + "' type='button'>Edit</button>" +
          "<button class='eikon-btn ap-dr-del'  data-id='" + esc(d.id) + "' type='button' style='color:rgba(255,90,122,.85);'>Delete</button>" +
          "</div></div>";
      }).join("") : "<div style='font-size:12px;color:rgba(233,238,247,.45);padding:8px 0;'>No doctors yet.</div>";
      return "<div class='ap-mgmt-grid' id='ap-dr-list'>" + rows + "</div>" +
        "<button class='ap-add-btn' id='ap-dr-add' type='button' style='margin-top:10px;width:100%;'>+ Add New Doctor</button>";
    }
    function showDrForm(existing) {
      var isEdit = !!existing; var d = existing || {};
      var body =
        "<div class='eikon-field'><div class='eikon-label'>Full Name (with title)</div><input class='ap-input' id='ap-drmod-name' type='text' value='" + esc(d.name || "") + "' placeholder='e.g. Dr. Joseph Borg'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Specialty</div><input class='ap-input' id='ap-drmod-spec' type='text' value='" + esc(d.specialty || "") + "' placeholder='e.g. Cardiology'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Phone</div><input class='ap-input' id='ap-drmod-phone' type='tel' value='" + esc(d.phone || "") + "'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Default Patient Fee (EUR)</div><input class='ap-input' id='ap-drmod-fee' type='number' step='0.01' min='0' value='" + esc(d.defaultFee != null ? d.defaultFee : "") + "' placeholder='e.g. 25.00'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Notes</div><textarea class='ap-textarea' id='ap-drmod-notes'>" + esc(d.notes || "") + "</textarea></div>";
      E.modal.show(isEdit ? "Edit Doctor" : "Add Doctor", body, [
        { label: "Cancel", onClick: async function () { openDoctorsModal(onDone); } },
        { label: isEdit ? "Save Changes" : "Add Doctor", primary: true, onClick: async function () {
          var name = ((E.q("#ap-drmod-name") || {}).value || "").trim();
          if (!name) { toast("Error", "Doctor name is required.", "bad"); return; }
          var payload = { name: name, specialty: ((E.q("#ap-drmod-spec") || {}).value || "").trim(), phone: ((E.q("#ap-drmod-phone") || {}).value || "").trim(), defaultFee: parseFloat((E.q("#ap-drmod-fee") || {}).value || "0") || 0, notes: ((E.q("#ap-drmod-notes") || {}).value || "").trim() };
          if (isEdit) await apiUpdateDoctor(d.id, payload); else await apiCreateDoctor(payload);
          await refreshAll("doctor-save");
          if (typeof onDone === "function") onDone();
          openDoctorsModal(onDone);
        }}
      ]);
    }
    E.modal.show("Manage Doctors", renderBody(), [
      { label: "Close", onClick: async function () { E.modal.hide(); if (typeof onDone === "function") onDone(); } }
    ]);
    setTimeout(function () {
      var list = E.q("#ap-dr-list"); var addBtn = E.q("#ap-dr-add");
      if (addBtn) addBtn.addEventListener("click", function () { showDrForm(null); });
      if (list) {
        list.addEventListener("click", function (ev) {
          var btn = ev.target; var id = btn.getAttribute("data-id"); if (!id) return;
          if (btn.classList.contains("ap-dr-edit")) { var d = doctorById(id); if (d) showDrForm(d); }
          if (btn.classList.contains("ap-dr-del")) {
            modalConfirm("Delete Doctor", "Delete this doctor and their schedules?", "Delete", "Cancel").then(async function (ok) {
              if (!ok) { openDoctorsModal(onDone); return; }
              await apiDeleteDoctor(id); await refreshAll("doctor-delete");
              if (typeof onDone === "function") onDone();
              openDoctorsModal(onDone);
            });
          }
        });
      }
    }, 60);
  }

  // ============================================================
  //  MODALS: CLINIC MANAGEMENT
  // ============================================================
  function openClinicsModal(onDone) {
    function renderBody() {
      var clinics = loadClinics();
      var rows = clinics.length ? clinics.map(function (c) {
        return "<div class='ap-mgmt-row'>" +
          "<div><div class='mgmt-name'>" + esc(c.name) + "</div>" +
          "<div class='mgmt-sub'>" + esc(c.locality || "") + "  Fee: " + esc(fmtMoney(c.fee || 0)) + "</div></div>" +
          "<div class='mgmt-actions'>" +
          "<button class='eikon-btn ap-cl-edit' data-id='" + esc(c.id) + "' type='button'>Edit</button>" +
          "<button class='eikon-btn ap-cl-del'  data-id='" + esc(c.id) + "' type='button' style='color:rgba(255,90,122,.85);'>Delete</button>" +
          "</div></div>";
      }).join("") : "<div style='font-size:12px;color:rgba(233,238,247,.45);padding:8px 0;'>No clinics yet.</div>";
      return "<div class='ap-mgmt-grid' id='ap-cl-list'>" + rows + "</div>" +
        "<button class='ap-add-btn' id='ap-cl-add' type='button' style='margin-top:10px;width:100%;'>+ Add New Clinic</button>";
    }
    function showClForm(existing) {
      var isEdit = !!existing; var c = existing || {};
      var body =
        "<div class='eikon-field'><div class='eikon-label'>Clinic Name</div><input class='ap-input' id='ap-clmod-name' type='text' value='" + esc(c.name || "") + "' placeholder='e.g. Sliema Medical Centre'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Locality</div><input class='ap-input' id='ap-clmod-loc' type='text' value='" + esc(c.locality || "") + "'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Address</div><input class='ap-input' id='ap-clmod-addr' type='text' value='" + esc(c.address || "") + "'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Phone</div><input class='ap-input' id='ap-clmod-phone' type='tel' value='" + esc(c.phone || "") + "'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Standard Clinic Fee (EUR)</div><input class='ap-input' id='ap-clmod-fee' type='number' step='0.01' min='0' value='" + esc(c.fee != null ? c.fee : "") + "'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Notes</div><textarea class='ap-textarea' id='ap-clmod-notes'>" + esc(c.notes || "") + "</textarea></div>";
      E.modal.show(isEdit ? "Edit Clinic" : "Add Clinic", body, [
        { label: "Cancel", onClick: async function () { openClinicsModal(onDone); } },
        { label: isEdit ? "Save Changes" : "Add Clinic", primary: true, onClick: async function () {
          var name = ((E.q("#ap-clmod-name") || {}).value || "").trim();
          if (!name) { toast("Error", "Clinic name is required.", "bad"); return; }
          var payload = { name: name, locality: ((E.q("#ap-clmod-loc") || {}).value || "").trim(), address: ((E.q("#ap-clmod-addr") || {}).value || "").trim(), phone: ((E.q("#ap-clmod-phone") || {}).value || "").trim(), fee: parseFloat((E.q("#ap-clmod-fee") || {}).value || "0") || 0, notes: ((E.q("#ap-clmod-notes") || {}).value || "").trim() };
          if (isEdit) await apiUpdateClinic(c.id, payload); else await apiCreateClinic(payload);
          await refreshAll("clinic-save");
          if (typeof onDone === "function") onDone();
          openClinicsModal(onDone);
        }}
      ]);
    }
    E.modal.show("Manage Clinics", renderBody(), [
      { label: "Close", onClick: async function () { E.modal.hide(); if (typeof onDone === "function") onDone(); } }
    ]);
    setTimeout(function () {
      var addBtn = E.q("#ap-cl-add"); var list = E.q("#ap-cl-list");
      if (addBtn) addBtn.addEventListener("click", function () { showClForm(null); });
      if (list) {
        list.addEventListener("click", async function (ev) {
          var btn = ev.target; var id = btn.getAttribute("data-id"); if (!id) return;
          if (btn.classList.contains("ap-cl-edit")) { var c = clinicById(id); if (c) showClForm(c); }
          if (btn.classList.contains("ap-cl-del")) {
            modalConfirm("Delete Clinic", "Delete this clinic?", "Delete", "Cancel").then(async function (ok) {
              if (!ok) { openClinicsModal(onDone); return; }
              await apiDeleteClinic(id); await refreshAll("clinic-delete");
              if (typeof onDone === "function") onDone();
              openClinicsModal(onDone);
            });
          }
        });
      }
    }, 60);
  }

  // ============================================================
  //  MODALS: SCHEDULE MANAGEMENT
  // ============================================================
  function openSchedulesModal(onDone) {
    function renderBody() {
      var scheds = loadSchedules();
      var days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      var rows = scheds.length ? scheds.map(function (s) {
        var dr = doctorById(s.doctorId); var cl = clinicById(s.clinicId);
        var desc = s.isOneOff ? "One-off: " + fmtDmy(s.date) : days[Number(s.dayOfWeek)] + "s" + (s.validFrom ? " from " + fmtDmy(s.validFrom) : "") + (s.validUntil ? " until " + fmtDmy(s.validUntil) : "");
        return "<div class='ap-mgmt-row'>" +
          "<div style='flex:1'>" +
          "<div class='mgmt-name'>" + esc(dr ? dr.name : "Unknown Dr") + " at " + esc(cl ? cl.name : "Unknown Clinic") + "</div>" +
          "<div class='mgmt-sub'>" + esc(desc) + "  " + esc(s.startTime || "") + "-" + esc(s.endTime || "") + "  Slot: " + esc(s.slotDuration || 10) + "min</div></div>" +
          "<div class='mgmt-actions'>" +
          "<button class='eikon-btn ap-sc-edit' data-id='" + esc(s.id) + "' type='button'>Edit</button>" +
          "<button class='eikon-btn ap-sc-del'  data-id='" + esc(s.id) + "' type='button' style='color:rgba(255,90,122,.85);'>Delete</button>" +
          "</div></div>";
      }).join("") : "<div style='font-size:12px;color:rgba(233,238,247,.45);padding:8px 0;'>No schedules yet.</div>";
      return "<div class='ap-mgmt-grid' id='ap-sc-list'>" + rows + "</div>" +
        "<button class='ap-add-btn' id='ap-sc-add' type='button' style='margin-top:10px;width:100%;'>+ Add Schedule</button>";
    }
    function showScForm(existing) {
      var isEdit = !!existing; var s = existing || {};
      var isOneOff = !!(s.isOneOff || s.is_one_off);
      var body =
        "<div class='ap-form-grid'>" +
        "<div class='eikon-field'><div class='eikon-label'>Doctor</div><select class='ap-select' id='ap-scmod-dr' style='width:100%;'>" + buildDoctorOptions(s.doctorId) + "</select></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Clinic</div><select class='ap-select' id='ap-scmod-cl' style='width:100%;'>" + buildClinicOptions(s.clinicId) + "</select></div>" +
        "</div>" +
        "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Schedule Type</div>" +
        "<select class='ap-select' id='ap-scmod-type' style='width:100%;'>" +
        "<option value='recurring'" + (!isOneOff ? " selected" : "") + ">Recurring (weekly)</option>" +
        "<option value='oneoff'" + (isOneOff ? " selected" : "") + ">One-off (specific date)</option>" +
        "</select></div>" +
        "<div id='ap-scmod-rec' style='margin-top:8px;" + (isOneOff ? "display:none;" : "") + "'>" +
        "<div class='eikon-field'><div class='eikon-label'>Day of Week</div><select class='ap-select' id='ap-scmod-dow' style='width:100%;'>" + buildDowOptions(s.dayOfWeek != null ? s.dayOfWeek : "") + "</select></div>" +
        "<div class='ap-form-grid' style='margin-top:8px;'>" +
        "<div class='eikon-field'><div class='eikon-label'>Valid From (optional)</div><input class='ap-input' id='ap-scmod-vf' type='date' value='" + esc(s.validFrom || "") + "' style='width:100%;'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>Valid Until (optional)</div><input class='ap-input' id='ap-scmod-vu' type='date' value='" + esc(s.validUntil || "") + "' style='width:100%;'></div>" +
        "</div></div>" +
        "<div id='ap-scmod-oo' style='margin-top:8px;" + (!isOneOff ? "display:none;" : "") + "'>" +
        "<div class='eikon-field'><div class='eikon-label'>Date</div><input class='ap-input' id='ap-scmod-date' type='date' value='" + esc(s.date || "") + "' style='width:100%;'></div></div>" +
        "<div class='ap-form-grid' style='margin-top:8px;'>" +
        "<div class='eikon-field'><div class='eikon-label'>Start Time</div><input class='ap-input' id='ap-scmod-start' type='time' value='" + esc(s.startTime || "09:00") + "' style='width:100%;'></div>" +
        "<div class='eikon-field'><div class='eikon-label'>End Time</div><input class='ap-input' id='ap-scmod-end' type='time' value='" + esc(s.endTime || "17:00") + "' style='width:100%;'></div>" +
        "</div>" +
        "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Slot Duration (minutes)</div>" +
        "<input class='ap-input' id='ap-scmod-slot' type='number' min='5' max='120' step='5' value='" + esc(s.slotDuration || 10) + "' style='width:100%;'></div>";

      E.modal.show(isEdit ? "Edit Schedule" : "Add Schedule", body, [
        { label: "Cancel", onClick: async function () { openSchedulesModal(onDone); } },
        { label: isEdit ? "Save Changes" : "Add Schedule", primary: true, onClick: async function () {
          var drId = ((E.q("#ap-scmod-dr") || {}).value || "").trim();
          var clId = ((E.q("#ap-scmod-cl") || {}).value || "").trim();
          if (!drId) { toast("Error", "Select a doctor.", "bad"); return; }
          if (!clId) { toast("Error", "Select a clinic.", "bad"); return; }
          var type = ((E.q("#ap-scmod-type") || {}).value || "recurring");
          var st = ((E.q("#ap-scmod-start") || {}).value || "09:00").trim();
          var et = ((E.q("#ap-scmod-end") || {}).value || "17:00").trim();
          var slotDur = parseInt((E.q("#ap-scmod-slot") || {}).value || "10", 10) || 10;
          var payload = { doctorId: drId, clinicId: clId, startTime: st, endTime: et, slotDuration: slotDur };
          if (type === "oneoff") {
            var oDate = ((E.q("#ap-scmod-date") || {}).value || "").trim();
            if (!isYmd(oDate)) { toast("Error", "Enter a valid date.", "bad"); return; }
            payload.isOneOff = true; payload.date = oDate;
          } else {
            var dow = (E.q("#ap-scmod-dow") || {}).value;
            if (dow === "" || dow == null) { toast("Error", "Select a day of week.", "bad"); return; }
            payload.dayOfWeek = parseInt(dow, 10);
            payload.validFrom  = ((E.q("#ap-scmod-vf") || {}).value || "").trim() || null;
            payload.validUntil = ((E.q("#ap-scmod-vu") || {}).value || "").trim() || null;
          }
          if (isEdit) await apiUpdateSchedule(s.id, payload); else await apiCreateSchedule(payload);
          await refreshAll("schedule-save");
          if (typeof onDone === "function") onDone();
          openSchedulesModal(onDone);
        }}
      ]);
      setTimeout(function () {
        var typeSel = E.q("#ap-scmod-type");
        var recDiv  = E.q("#ap-scmod-rec");
        var ooDiv   = E.q("#ap-scmod-oo");
        if (typeSel) {
          typeSel.addEventListener("change", function () {
            var v = typeSel.value;
            if (recDiv) recDiv.style.display = v === "recurring" ? "" : "none";
            if (ooDiv)  ooDiv.style.display  = v === "oneoff"   ? "" : "none";
          });
        }
      }, 60);
    }
    E.modal.show("Manage Schedules", renderBody(), [
      { label: "Close", onClick: async function () { E.modal.hide(); if (typeof onDone === "function") onDone(); } }
    ]);
    setTimeout(function () {
      var addBtn = E.q("#ap-sc-add"); var list = E.q("#ap-sc-list");
      if (addBtn) addBtn.addEventListener("click", function () { showScForm(null); });
      if (list) {
        list.addEventListener("click", function (ev) {
          var btn = ev.target; var id = btn.getAttribute("data-id"); if (!id) return;
          if (btn.classList.contains("ap-sc-edit")) { var s = loadSchedules().filter(function (x) { return String(x.id) === String(id); })[0]; if (s) showScForm(s); }
          if (btn.classList.contains("ap-sc-del")) {
            modalConfirm("Delete Schedule", "Delete this schedule?", "Delete", "Cancel").then(async function (ok) {
              if (!ok) { openSchedulesModal(onDone); return; }
              await apiDeleteSchedule(id); await refreshAll("schedule-delete");
              if (typeof onDone === "function") onDone();
              openSchedulesModal(onDone);
            });
          }
        });
      }
    }, 60);
  }

  // ============================================================
  //  MODAL: APPOINTMENT
  // ============================================================
  function openApptModal(opts, onSaved) {
    var isEdit = !!(opts && opts.appt);
    var a = (opts && opts.appt) || {};
    var wl = (opts && opts.fromWaitlist) || null;
    var preDate = (opts && opts.date) || state.currentDate;
    var preDr   = (opts && opts.doctorId) || state.filterDoctorId || "";
    var preCl   = (opts && opts.clinicId) || state.filterClinicId || "";

    var init = {
      patientName:        a.patientName        || (wl ? wl.patientName : ""),
      patientIdCard:      a.patientIdCard       || "",
      patientPhone:       a.patientPhone        || (wl ? wl.patientPhone : ""),
      doctorId:           a.doctorId            || preDr,
      clinicId:           a.clinicId            || preCl,
      date:               a.date               || preDate,
      time:               a.time               || (opts && opts.time) || "",
      durationMins:       a.durationMins        || 30,
      status:             a.status             || "Scheduled",
      doctorFee:          a.doctorFee           || "",
      clinicFee:          a.clinicFee           || "",
      medicinesCost:      a.medicinesCost       || "",
      medicines:          a.medicines           || "",
      notes:              a.notes              || (wl ? wl.notes : ""),
      cancellationReason: a.cancellationReason  || ""
    };

    // Pre-seed doctor/clinic from opts (e.g. clicked slot on timeline)
    if (opts && opts.doctorId) init.doctorId = opts.doctorId;
    if (opts && opts.clinicId) init.clinicId = opts.clinicId;
    if (opts && opts.date)     init.date     = opts.date;

    // ---- Build form body ----
    // NEW appointment: cascade doctor → clinic → date (from schedule) → time
    // EDIT appointment: show all fields including fees/medicines

    var bodyNew =
      "<div class='ap-form-section'>Patient Details</div>" +
      "<div class='ap-form-grid'>" +
      "<div class='eikon-field ap-form-full'><div class='eikon-label'>Patient Name &amp; Surname</div>" +
      "<input class='ap-input' id='ap-mod-patient' type='text' value='" + esc(init.patientName) + "' placeholder='e.g. Maria Camilleri' style='width:100%;' autocomplete='off'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>ID Card No.</div>" +
      "<input class='ap-input' id='ap-mod-idcard' type='text' value='" + esc(init.patientIdCard) + "' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div>" +
      "<input class='ap-input' id='ap-mod-phone' type='tel' value='" + esc(init.patientPhone) + "' style='width:100%;'></div>" +
      "</div>" +

      "<div class='ap-form-section' style='margin-top:10px;'>Schedule</div>" +
      "<div style='font-size:11px;color:rgba(233,238,247,.5);margin-bottom:8px;'>Select a doctor first — the system will show only the clinics, dates and times from that doctor&rsquo;s schedule.</div>" +

      // Step 1: Doctor
      "<div class='eikon-field'><div class='eikon-label'>1. Doctor</div>" +
      "<select class='ap-select' id='ap-mod-dr' style='width:100%;'>" +
        "<option value=''>— Select a doctor —</option>" +
        loadDoctors().map(function(d){ return "<option value='" + esc(d.id) + "'" + (String(d.id) === String(init.doctorId) ? " selected" : "") + ">" + esc(d.name) + (d.specialty ? " · " + esc(d.specialty) : "") + "</option>"; }).join("") +
      "</select></div>" +

      // Step 2: Clinic (populated by JS cascade)
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>2. Clinic</div>" +
      "<select class='ap-select' id='ap-mod-cl' style='width:100%;' disabled>" +
      "<option value=''>— Select a doctor first —</option></select></div>" +

      // Step 3: Date (populated by JS cascade - only scheduled dates)
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>3. Session Date</div>" +
      "<select class='ap-select' id='ap-mod-date-sel' style='width:100%;' disabled>" +
      "<option value=''>— Select a clinic first —</option></select>" +
      "<div id='ap-mod-date-hint' style='font-size:10px;color:rgba(233,238,247,.4);margin-top:3px;'>Only dates with scheduled sessions are shown.</div></div>" +

      // Step 4: Time (available slots)
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>4. Available Time Slot</div>" +
      "<select class='ap-select' id='ap-mod-time' style='width:100%;' disabled>" +
      "<option value=''>— Select a date first —</option></select>" +
      "<div id='ap-mod-time-hint' style='font-size:10px;color:rgba(233,238,247,.4);margin-top:3px;'>Only unbooked slots shown. Checked live from server.</div></div>" +

      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Internal Notes (optional)</div>" +
      "<textarea class='ap-textarea' id='ap-mod-notes' style='min-height:50px;'>" + esc(init.notes) + "</textarea></div>";

    var bodyEdit =
      "<div class='ap-form-section'>Patient Details</div>" +
      "<div class='ap-form-grid'>" +
      "<div class='eikon-field ap-form-full'><div class='eikon-label'>Patient Name &amp; Surname</div>" +
      "<input class='ap-input' id='ap-mod-patient' type='text' value='" + esc(init.patientName) + "' style='width:100%;' autocomplete='off'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>ID Card No.</div>" +
      "<input class='ap-input' id='ap-mod-idcard' type='text' value='" + esc(init.patientIdCard) + "' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div>" +
      "<input class='ap-input' id='ap-mod-phone' type='tel' value='" + esc(init.patientPhone) + "' style='width:100%;'></div>" +
      "</div>" +

      "<div class='ap-form-section' style='margin-top:10px;'>Appointment Details</div>" +
      "<div class='ap-form-grid'>" +
      "<div class='eikon-field'><div class='eikon-label'>Doctor</div>" +
      "<select class='ap-select' id='ap-mod-dr' style='width:100%;'>" + buildDoctorOptions(init.doctorId) + "</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Clinic</div>" +
      "<select class='ap-select' id='ap-mod-cl' style='width:100%;'>" + buildClinicOptions(init.clinicId) + "</select></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Date</div>" +
      "<input class='ap-input' id='ap-mod-date' type='date' value='" + esc(init.date) + "' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Duration (min)</div>" +
      "<input class='ap-input' id='ap-mod-dur' type='number' min='5' max='180' step='5' value='" + esc(init.durationMins) + "' style='width:100%;'></div>" +
      "</div>" +
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Time Slot</div>" +
      "<select class='ap-select' id='ap-mod-time' style='width:100%;'><option value=''>Loading slots...</option></select>" +
      "<div id='ap-mod-time-hint' style='font-size:10px;color:rgba(233,238,247,.45);margin-top:3px;'></div></div>" +
      "<div class='ap-form-grid' style='margin-top:8px;'>" +
      "<div class='eikon-field'><div class='eikon-label'>Status</div>" +
      "<select class='ap-select' id='ap-mod-status' style='width:100%;'>" + buildStatusOptions(init.status, APPT_STATUSES) + "</select></div>" +
      "<div></div></div>" +

      "<div class='ap-form-section' style='margin-top:10px;'>Fees &amp; Medicines</div>" +
      "<div class='ap-form-fee-grid'>" +
      "<div class='eikon-field'><div class='eikon-label'>Doctor Fee (EUR)</div>" +
      "<input class='ap-input' id='ap-mod-drfee' type='number' step='0.01' min='0' value='" + esc(init.doctorFee) + "' placeholder='0.00' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Clinic Fee (EUR)</div>" +
      "<input class='ap-input' id='ap-mod-clfee' type='number' step='0.01' min='0' value='" + esc(init.clinicFee) + "' placeholder='0.00' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Medicines Cost (EUR)</div>" +
      "<input class='ap-input' id='ap-mod-medfee' type='number' step='0.01' min='0' value='" + esc(init.medicinesCost) + "' placeholder='0.00' style='width:100%;'></div>" +
      "</div>" +
      "<div style='margin-top:6px;'><span class='ap-total-preview' id='ap-mod-total'>Total: EUR 0.00</span></div>" +
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Medicines / Items Dispensed</div>" +
      "<textarea class='ap-textarea' id='ap-mod-meds' placeholder='e.g. Amoxicillin 250mg x14'>" + esc(init.medicines) + "</textarea></div>" +
      "<div class='eikon-field' style='margin-top:8px;'><div class='eikon-label'>Internal Notes</div>" +
      "<textarea class='ap-textarea' id='ap-mod-notes' style='min-height:55px;'>" + esc(init.notes) + "</textarea></div>" +
      "<div class='eikon-field' id='ap-cancel-reason-wrap' style='margin-top:8px;display:" + (init.status === "Cancelled" ? "block" : "none") + ";'>" +
      "<div class='eikon-label'>Cancellation Reason</div>" +
      "<input class='ap-input' id='ap-mod-cancelreason' type='text' value='" + esc(init.cancellationReason) + "' style='width:100%;'></div>";

    var body = isEdit ? bodyEdit : bodyNew;

    E.modal.show(isEdit ? "Edit Appointment" : "New Appointment", body, [
      { label: "Cancel", onClick: async function () { E.modal.hide(); } },
      { label: isEdit ? "Save Changes" : "Create Appointment", primary: true, onClick: async function () {
        try {
          var patient = ((E.q("#ap-mod-patient") || {}).value || "").trim();
          if (!patient) throw new Error("Patient name is required.");

          var drId, clId, date, time, durM, status;

          if (isEdit) {
            date = ((E.q("#ap-mod-date") || {}).value || "").trim();
            if (!isYmd(date)) throw new Error("Please enter a valid date.");
            drId = ((E.q("#ap-mod-dr") || {}).value || "").trim();
            if (!drId) throw new Error("Please select a doctor.");
            clId = ((E.q("#ap-mod-cl") || {}).value || "").trim();
            if (!clId) throw new Error("Please select a clinic.");
            time = ((E.q("#ap-mod-time") || {}).value || "").trim();
            if (!time) throw new Error("Please select a time slot.");
            durM = parseInt(((E.q("#ap-mod-dur") || {}).value || "30"), 10) || 30;
            if (durM < 5) durM = 5;
            status = ((E.q("#ap-mod-status") || {}).value || "Scheduled").trim();
          } else {
            drId = ((E.q("#ap-mod-dr") || {}).value || "").trim();
            if (!drId) throw new Error("Please select a doctor.");
            clId = ((E.q("#ap-mod-cl") || {}).value || "").trim();
            if (!clId) throw new Error("Please select a clinic.");
            var dateSel = E.q("#ap-mod-date-sel");
            date = dateSel ? (dateSel.value || "").trim() : "";
            if (!isYmd(date)) throw new Error("Please select a session date.");
            time = ((E.q("#ap-mod-time") || {}).value || "").trim();
            if (!time) throw new Error("Please select an available time slot.");
            // Derive duration from schedule slot duration
            var sched = schedulesForDate(date, drId, clId)[0];
            durM = sched ? (parseInt(sched.slotDuration || 10, 10) || 10) : 10;
            status = "Scheduled";
          }

          // CRITICAL: Fetch latest from server to prevent double-booking
          apptLog("appt-modal:submit - fetching fresh appointments to check for double-booking", {date: date, drId: drId, clId: clId, time: time});
          await ensureSchedulesLoaded();
          var latestAppts = await apiLoadAppts({ date: date });
          saveAppointments(date, latestAppts);
          var slotsNow = computeAvailableStartTimes(date, drId, clId, durM);
          apptLog("appt-modal:submit - available slots after fresh check", slotsNow.length, "slots for time:", time);

          if (!isEdit && !slotsNow.length) {
            toast("Fully Booked", "This session is now fully booked. Patient added to waiting list.", "bad", 5000);
            await apiCreateWaitlistEntry({
              patientName: patient,
              patientIdCard: ((E.q("#ap-mod-idcard") || {}).value || "").trim(),
              patientPhone: ((E.q("#ap-mod-phone") || {}).value || "").trim(),
              doctorId: drId, clinicId: clId,
              preferredDates: date, flexibility: "Urgent",
              notes: "Auto-added: session " + date + " was fully booked at time of booking."
            });
            await refreshAll("waitlist-auto");
            E.modal.hide();
            return;
          }

          if (isEdit) {
            if (time !== String(init.time || "") && slotsNow.indexOf(time) < 0) {
              throw new Error("Selected time slot is no longer available. Please choose another.");
            }
          } else {
            if (slotsNow.indexOf(time) < 0) {
              throw new Error("This slot was just taken by another booking. Please choose another.");
            }
          }

          var payload = {
            patientName: patient,
            patientIdCard: ((E.q("#ap-mod-idcard") || {}).value || "").trim(),
            patientPhone:  ((E.q("#ap-mod-phone")  || {}).value || "").trim(),
            doctorId: drId, clinicId: clId, date: date, time: time, durationMins: durM, status: status,
            notes: ((E.q("#ap-mod-notes") || {}).value || "").trim()
          };

          if (isEdit) {
            var df = parseFloat((E.q("#ap-mod-drfee")  || {}).value || "") || 0;
            var cf = parseFloat((E.q("#ap-mod-clfee")  || {}).value || "") || 0;
            var mf = parseFloat((E.q("#ap-mod-medfee") || {}).value || "") || 0;
            payload.doctorFee      = df;
            payload.clinicFee      = cf;
            payload.medicinesCost  = mf;
            payload.medicines      = ((E.q("#ap-mod-meds") || {}).value || "").trim();
            payload.cancellationReason = status === "Cancelled" ? ((E.q("#ap-mod-cancelreason") || {}).value || "").trim() : "";
          }

          if (isEdit) {
            await apiUpdateAppt(a.id, payload);
            toast("Saved", "Appointment updated.", "good");
          } else {
            var res = await apiCreateAppt(payload);
            toast("Created", "Appointment booked! Token: " + (res && res.token ? res.token : ""), "good", 4000);
          }
          E.modal.hide();
          await refreshAll("appt-save");
          if (typeof onSaved === "function") onSaved();
        } catch (ex) {
          apptErr("appt-modal:submit error", ex);
          modalError("Validation Error", ex);
        }
      }}
    ]);

    // Wire up cascade (new appt) or slot refresher (edit)
    setTimeout(function () {
      var _slotRefreshPending = false;

      // ---- EDIT MODE: standard slot refresher ----
      if (isEdit) {
        async function refreshTimeOptions() {
          try {
            var date = ((E.q("#ap-mod-date") || {}).value || "").trim();
            var drId = ((E.q("#ap-mod-dr")   || {}).value || "").trim();
            var clId = ((E.q("#ap-mod-cl")   || {}).value || "").trim();
            var dur  = parseInt(((E.q("#ap-mod-dur") || {}).value || "30"), 10) || 30;
            var sel  = E.q("#ap-mod-time");
            var hint = E.q("#ap-mod-time-hint");
            if (!sel) return;
            if (!date || !drId || !clId) { sel.innerHTML = "<option value=''>Select doctor, clinic and date first</option>"; sel.disabled = true; return; }
            if (_slotRefreshPending) return;
            _slotRefreshPending = true;
            sel.disabled = true;
            sel.innerHTML = "<option value=''>⟳ Loading slots...</option>";
            try {
              await ensureSchedulesLoaded();
              var liveAppts = await apiLoadAppts({ date: date });
              saveAppointments(date, liveAppts);
              // Add back the ORIGINAL time so it appears as an option when editing
              var slots = computeAvailableStartTimes(date, drId, clId, dur);
              if (init.time && slots.indexOf(init.time) < 0) slots.unshift(init.time);
              slots = slots.filter(function (v, i, arr) { return arr.indexOf(v) === i; }).sort();
              apptLog("edit:refreshTimeOptions", { date: date, drId: drId, clId: clId, dur: dur, slots: slots.length });
              if (!slots.length) {
                sel.innerHTML = "<option value=''>No schedule defined for this doctor/clinic/date</option>";
                if (hint) hint.textContent = "⚠ No schedule found for this combination and date.";
                sel.disabled = true;
              } else {
                sel.innerHTML = slots.map(function (t) { return "<option value='" + t + "'" + (t === init.time ? " selected" : "") + ">" + t + (t === init.time ? " (current)" : "") + "</option>"; }).join("");
                if (!sel.value) sel.value = init.time || slots[0];
                sel.disabled = false;
                if (hint) hint.textContent = slots.length + " slot" + (slots.length === 1 ? "" : "s") + " available (current slot shown).";
              }
            } finally { _slotRefreshPending = false; }
          } catch (ex) {
            apptWarn("edit:refreshTimeOptions error", ex);
            _slotRefreshPending = false;
            var sel2 = E.q("#ap-mod-time"); if (sel2) { sel2.innerHTML = "<option value=''>Error loading – retry</option>"; sel2.disabled = true; }
          }
        }

        function updateTotal() {
          var df = parseFloat((E.q("#ap-mod-drfee")  || {}).value || "") || 0;
          var cf = parseFloat((E.q("#ap-mod-clfee")  || {}).value || "") || 0;
          var mf = parseFloat((E.q("#ap-mod-medfee") || {}).value || "") || 0;
          var el = E.q("#ap-mod-total"); if (el) el.textContent = "Total: EUR " + (df + cf + mf).toFixed(2);
        }

        var drSel = E.q("#ap-mod-dr"); var clSel = E.q("#ap-mod-cl");
        var dtEl  = E.q("#ap-mod-date"); var durEl = E.q("#ap-mod-dur");
        var statusSel = E.q("#ap-mod-status"); var cancelWrap = E.q("#ap-cancel-reason-wrap");
        if (drSel) drSel.addEventListener("change", refreshTimeOptions);
        if (clSel) clSel.addEventListener("change", refreshTimeOptions);
        if (dtEl)  dtEl.addEventListener("change",  refreshTimeOptions);
        if (durEl) durEl.addEventListener("change",  refreshTimeOptions);
        ["#ap-mod-drfee","#ap-mod-clfee","#ap-mod-medfee"].forEach(function (id) { var el = E.q(id); if (el) el.addEventListener("input", updateTotal); });
        if (statusSel && cancelWrap) statusSel.addEventListener("change", function () { cancelWrap.style.display = statusSel.value === "Cancelled" ? "block" : "none"; });
        updateTotal();
        refreshTimeOptions();
        return;
      }

      // ---- NEW MODE: cascade doctor → clinic → date → time ----
      var drSel    = E.q("#ap-mod-dr");
      var clSel    = E.q("#ap-mod-cl");
      var dateSel  = E.q("#ap-mod-date-sel");
      var dateHint = E.q("#ap-mod-date-hint");
      var timeSel  = E.q("#ap-mod-time");
      var timeHint = E.q("#ap-mod-time-hint");

      function cascadeClinic() {
        var drId = drSel ? drSel.value : "";
        if (!clSel) return;
        if (!drId) {
          clSel.innerHTML = "<option value=''>— Select a doctor first —</option>";
          clSel.disabled = true;
          cascadeDate();
          return;
        }
        var clinics = clinicsForDoctor(drId);
        if (!clinics.length) {
          clSel.innerHTML = "<option value=''>No clinics scheduled for this doctor</option>";
          clSel.disabled = true;
        } else {
          clSel.innerHTML = (clinics.length > 1 ? "<option value=''>— Select clinic —</option>" : "") +
            clinics.map(function (c) {
              var label = esc(c.name) + (c.locality ? " · " + esc(c.locality) : "");
              return "<option value='" + esc(c.id) + "'" + (String(c.id) === String(init.clinicId) ? " selected" : "") + ">" + label + "</option>";
            }).join("");
          clSel.disabled = false;
          // If only one clinic or pre-selected, auto-select
          if (clinics.length === 1) clSel.value = String(clinics[0].id);
        }
        cascadeDate();
      }

      function cascadeDate() {
        var drId = drSel ? drSel.value : "";
        var clId = clSel ? clSel.value : "";
        if (!dateSel) return;
        if (!drId || !clId) {
          dateSel.innerHTML = "<option value=''>— Select a clinic first —</option>";
          dateSel.disabled = true;
          if (dateHint) dateHint.textContent = "Only dates with scheduled sessions are shown.";
          cascadeTime();
          return;
        }
        var dates = upcomingScheduledDates(drId, clId, 90);
        if (!dates.length) {
          dateSel.innerHTML = "<option value=''>No upcoming sessions for this doctor/clinic</option>";
          dateSel.disabled = true;
          if (dateHint) dateHint.textContent = "⚠ No scheduled sessions found in the next 90 days.";
        } else {
          dateSel.innerHTML = "<option value=''>— Pick a session date —</option>" +
            dates.map(function (item) {
              var d = item.ymd;
              var sched = item.scheds[0];
              var timeRange = sched ? sched.startTime + " – " + sched.endTime : "";
              var label = dayName(d) + ", " + fmtDmy(d) + (timeRange ? "   " + timeRange : "");
              return "<option value='" + d + "'" + (d === init.date ? " selected" : "") + ">" + label + "</option>";
            }).join("");
          dateSel.disabled = false;
          if (init.date) dateSel.value = init.date;
          if (dates.length === 1) dateSel.value = dates[0].ymd;
          if (dateHint) dateHint.textContent = dates.length + " upcoming session" + (dates.length === 1 ? "" : "s") + " found.";
        }
        cascadeTime();
      }

      async function cascadeTime() {
        var drId = drSel ? drSel.value : "";
        var clId = clSel ? clSel.value : "";
        var date = dateSel ? dateSel.value : "";
        if (!timeSel) return;
        if (!drId || !clId || !isYmd(date)) {
          timeSel.innerHTML = "<option value=''>— Select a date first —</option>";
          timeSel.disabled = true;
          if (timeHint) timeHint.textContent = "Only unbooked slots shown. Checked live from server.";
          return;
        }
        if (_slotRefreshPending) return;
        _slotRefreshPending = true;
        timeSel.disabled = true;
        timeSel.innerHTML = "<option value=''>⟳ Checking availability...</option>";
        if (timeHint) timeHint.textContent = "Fetching live schedule to prevent double-booking...";
        try {
          await ensureSchedulesLoaded();
          var sched = schedulesForDate(date, drId, clId)[0];
          var slotDur = sched ? (parseInt(sched.slotDuration || 10, 10) || 10) : 10;
          var liveAppts = await apiLoadAppts({ date: date });
          saveAppointments(date, liveAppts);
          var slots = computeAvailableStartTimes(date, drId, clId, slotDur);
          apptLog("cascadeTime", { date: date, drId: drId, clId: clId, slots: slots.length });
          if (!slots.length) {
            var scheds = schedulesForDate(date, drId, clId);
            if (!scheds.length) {
              timeSel.innerHTML = "<option value=''>No schedule on this date</option>";
              if (timeHint) timeHint.textContent = "⚠ No schedule defined for this combination on this date.";
            } else {
              timeSel.innerHTML = "<option value=''>All slots fully booked</option>";
              if (timeHint) timeHint.innerHTML = "⚠ This session is fully booked. Proceeding will add the patient to the <strong>waiting list</strong> instead.";
            }
            timeSel.disabled = true;
          } else {
            timeSel.innerHTML = slots.map(function (t) { return "<option value='" + t + "'" + (t === init.time ? " selected" : "") + ">" + t + "</option>"; }).join("");
            if (!timeSel.value || slots.indexOf(timeSel.value) < 0) timeSel.value = slots[0];
            timeSel.disabled = false;
            if (timeHint) timeHint.textContent = slots.length + " slot" + (slots.length === 1 ? "" : "s") + " available · " + slotDur + " min each.";
          }
        } finally { _slotRefreshPending = false; }
      }

      if (drSel)   drSel.addEventListener("change",   function () { cascadeClinic(); });
      if (clSel)   clSel.addEventListener("change",   function () { cascadeDate(); });
      if (dateSel) dateSel.addEventListener("change", function () { cascadeTime(); });

      // Initial cascade using pre-seeded values
      cascadeClinic();
    }, 60);
  }

  // ============================================================
  //  MODAL: WAITLIST
  // ============================================================
  function openWaitlistModal(opts, onSaved) {
    var isEdit = !!(opts && opts.entry);
    var fromShift = (opts && opts.shift) || null; // { doctorId, clinicId, date }
    var w = (opts && opts.entry) || {};

    // Pre-fill from shift context if provided
    var prefillDr   = (fromShift && fromShift.doctorId) || w.doctorId || "";
    var prefillCl   = (fromShift && fromShift.clinicId) || w.clinicId || "";
    var prefillDate = (fromShift && fromShift.date)     || w.preferredDates || "";

    var shiftBannerHtml = "";
    if (fromShift) {
      var shiftDr = doctorById(fromShift.doctorId); var shiftCl = clinicById(fromShift.clinicId);
      shiftBannerHtml =
        "<div style='background:rgba(255,157,67,.08);border:1px solid rgba(255,157,67,.25);border-radius:10px;padding:8px 12px;margin-bottom:10px;font-size:12px;color:rgba(255,180,80,.9);'>" +
        "⏳ Adding to waiting list for <strong>" + esc(shiftDr ? shiftDr.name : "Doctor") + "</strong> at " +
        "<strong>" + esc(shiftCl ? shiftCl.name : "Clinic") + "</strong>" +
        (fromShift.date ? " on <strong>" + dayName(fromShift.date) + " " + fmtDmy(fromShift.date) + "</strong>" : "") +
        " — session fully booked.</div>";
    }

    var body = shiftBannerHtml +
      "<div class='eikon-field'><div class='eikon-label'>Patient Name &amp; Surname</div>" +
      "<input class='ap-input' id='ap-wlmod-name' type='text' value='" + esc(w.patientName || "") + "' style='width:100%;'></div>" +
      "<div class='ap-form-grid' style='margin-top:6px;'>" +
      "<div class='eikon-field'><div class='eikon-label'>ID Card No.</div><input class='ap-input' id='ap-wlmod-id' type='text' value='" + esc(w.patientIdCard || "") + "' style='width:100%;'></div>" +
      "<div class='eikon-field'><div class='eikon-label'>Phone</div><input class='ap-input' id='ap-wlmod-phone' type='tel' value='" + esc(w.patientPhone || "") + "' style='width:100%;'></div>" +
      "</div>" +

      "<div class='ap-form-section' style='margin-top:10px;'>Doctor &amp; Clinic</div>" +

      // Doctor – locked if coming from a shift
      "<div class='ap-form-grid' style='margin-top:6px;'>" +
      "<div class='eikon-field'><div class='eikon-label'>Doctor</div>" +
      (fromShift && fromShift.doctorId
        ? "<input class='ap-input' id='ap-wlmod-dr-display' type='text' value='" + esc(doctorById(fromShift.doctorId) ? doctorById(fromShift.doctorId).name : "") + "' disabled style='width:100%;'>" +
          "<input type='hidden' id='ap-wlmod-dr' value='" + esc(fromShift.doctorId) + "'>"
        : "<select class='ap-select' id='ap-wlmod-dr' style='width:100%;'>" + buildDoctorOptions(prefillDr, "any") + "</select>") +
      "</div>" +
      "<div class='eikon-field'><div class='eikon-label'>Clinic</div>" +
      (fromShift && fromShift.clinicId
        ? "<input class='ap-input' id='ap-wlmod-cl-display' type='text' value='" + esc(clinicById(fromShift.clinicId) ? clinicById(fromShift.clinicId).name : "") + "' disabled style='width:100%;'>" +
          "<input type='hidden' id='ap-wlmod-cl' value='" + esc(fromShift.clinicId) + "'>"
        : "<select class='ap-select' id='ap-wlmod-cl' style='width:100%;'>" + buildClinicOptions(prefillCl, "any") + "</select>") +
      "</div></div>" +

      // Date of the session they're waiting for
      "<div class='eikon-field' style='margin-top:6px;'><div class='eikon-label'>Session Date They're Waiting For</div>" +
      (fromShift && fromShift.date
        ? "<input class='ap-input' type='text' value='" + esc(dayName(fromShift.date) + " " + fmtDmy(fromShift.date)) + "' disabled style='width:100%;'>" +
          "<input type='hidden' id='ap-wlmod-dates' value='" + esc(fromShift.date) + "'>"
        : "<input class='ap-input' id='ap-wlmod-dates' type='text' value='" + esc(w.preferredDates || "") + "' placeholder='e.g. 2026-03-12, Mondays, ASAP' style='width:100%;'>") +
      "</div>" +

      "<div class='eikon-field' style='margin-top:6px;'><div class='eikon-label'>Priority</div>" +
      "<select class='ap-select' id='ap-wlmod-flex' style='width:100%;'>" +
      "<option value='Urgent'" + ((w.flexibility || (fromShift ? "Urgent" : "")) === "Urgent" ? " selected" : "") + ">Urgent – first available</option>" +
      "<option value='Flexible'" + ((w.flexibility === "Flexible" && !fromShift) ? " selected" : "") + ">Flexible</option>" +
      "<option value='Fixed'" + (w.flexibility === "Fixed" ? " selected" : "") + ">Fixed dates only</option>" +
      "</select></div>" +

      (isEdit ? "<div class='eikon-field' style='margin-top:6px;'><div class='eikon-label'>Status</div><select class='ap-select' id='ap-wlmod-status' style='width:100%;'>" + buildStatusOptions(w.status || "Waiting", WL_STATUSES) + "</select></div>" : "") +

      "<div class='eikon-field' style='margin-top:6px;'><div class='eikon-label'>Notes</div>" +
      "<textarea class='ap-textarea' id='ap-wlmod-notes' style='min-height:50px;'>" + esc(w.notes || "") + "</textarea></div>";

    E.modal.show(isEdit ? "Edit Waiting List Entry" : "Add to Waiting List", body, [
      { label: "Cancel", onClick: async function () { E.modal.hide(); } },
      { label: isEdit ? "Save Changes" : "Add to Waiting List", primary: true, onClick: async function () {
        var name = ((E.q("#ap-wlmod-name") || {}).value || "").trim();
        if (!name) { toast("Error", "Patient name is required.", "bad"); return; }
        var drInput = E.q("#ap-wlmod-dr") || E.q("[id='ap-wlmod-dr']");
        var clInput = E.q("#ap-wlmod-cl") || E.q("[id='ap-wlmod-cl']");
        var payload = {
          patientName:    name,
          patientIdCard:  ((E.q("#ap-wlmod-id")    || {}).value || "").trim(),
          patientPhone:   ((E.q("#ap-wlmod-phone")  || {}).value || "").trim(),
          doctorId:       (drInput ? drInput.value : "").trim(),
          clinicId:       (clInput ? clInput.value : "").trim(),
          preferredDates: ((E.q("#ap-wlmod-dates")  || {}).value || "").trim(),
          flexibility:    ((E.q("#ap-wlmod-flex")   || {}).value || "Urgent").trim(),
          notes:          ((E.q("#ap-wlmod-notes")  || {}).value || "").trim()
        };
        if (isEdit) {
          payload.status = ((E.q("#ap-wlmod-status") || {}).value || w.status || "Waiting").trim();
          await apiUpdateWaitlistEntry(w.id, payload);
          toast("Saved", "Waiting list entry updated.", "good");
        } else {
          await apiCreateWaitlistEntry(payload);
          toast("Added", "Patient added to waiting list.", "good");
        }
        E.modal.hide();
        await refreshAll("waitlist-save");
        if (typeof onSaved === "function") onSaved();
      }}
    ]);
  }

  // ============================================================
  //  STATE
  // ============================================================
  var state = {
    view:           "month",    // "month" | "day" | "list" | "waitlist"
    currentDate:    todayYmd(),
    currentMonth:   todayYmd().slice(0, 7),   // "YYYY-MM"
    filterDoctorId: "",
    filterClinicId: "",
    filterStatus:   "",
    filterDateFrom: "",
    filterDateTo:   "",
    listQuery:      "",
    listSort:       { key: "date", dir: "asc" },
    wlQuery:        "",
    wlSort:         { key: "addedDate", dir: "desc" },
    selectedApptId: null,
    selectedWlId:   null,
    refresh:        null,
    __didInitialSync: false
  };

  // ============================================================
  //  SORT
  // ============================================================
  function cmp(a, b) { if (a < b) return -1; if (a > b) return 1; return 0; }
  function sortList(list, sortSt, keyFn) {
    var key = sortSt.key; var dir = sortSt.dir; var mul = dir === "desc" ? -1 : 1;
    return list.slice().sort(function (a, b) {
      var va = keyFn ? keyFn(a, key) : norm(a[key]);
      var vb = keyFn ? keyFn(b, key) : norm(b[key]);
      return cmp(String(va), String(vb)) * mul;
    });
  }

  function getFilteredAppts() {
    var all = loadAppts();
    var q = norm(state.listQuery);
    if (state.filterDoctorId) all = all.filter(function (a) { return a.doctorId === state.filterDoctorId; });
    if (state.filterClinicId) all = all.filter(function (a) { return a.clinicId === state.filterClinicId; });
    if (state.filterStatus)   all = all.filter(function (a) { return a.status   === state.filterStatus; });
    if (state.filterDateFrom) all = all.filter(function (a) { return a.date >= state.filterDateFrom; });
    if (state.filterDateTo)   all = all.filter(function (a) { return a.date <= state.filterDateTo; });
    if (q) all = all.filter(function (a) {
      var dr = doctorById(a.doctorId); var cl = clinicById(a.clinicId);
      return (norm(a.id) + " " + norm(a.patientName) + " " + norm(a.patientIdCard) + " " + norm(a.patientPhone) + " " + norm(a.date) + " " + norm(a.status) + " " + norm(dr ? dr.name : "") + " " + norm(cl ? cl.name : "") + " " + norm(a.medicines) + " " + norm(a.notes)).indexOf(q) >= 0;
    });
    return sortList(all, state.listSort);
  }

  function getFilteredWaitlist() {
    var all = loadWaitlist();
    var q = norm(state.wlQuery);
    if (q) all = all.filter(function (w) {
      var dr = doctorById(w.doctorId); var cl = clinicById(w.clinicId);
      return (norm(w.id) + " " + norm(w.patientName) + " " + norm(w.patientIdCard) + " " + norm(w.patientPhone) + " " + norm(dr ? dr.name : "") + " " + norm(cl ? cl.name : "") + " " + norm(w.status) + " " + norm(w.preferredDates) + " " + norm(w.notes)).indexOf(q) >= 0;
    });
    return sortList(all, state.wlSort);
  }

  // ============================================================
  //  DETAIL PANEL BUILDER (shared)
  // ============================================================
  function buildDetailHtml(a) {
    var dr = doctorById(a.doctorId); var cl = clinicById(a.clinicId);
    var total = computeTotal(a);
    var waBtn = a.patientPhone ? whatsappBtnHtml(a.patientPhone) : "";
    return "<div class='ap-detail-grid'>" +
      "<div class='ap-kv half'><div class='k'>Patient</div><div class='v'>" + esc(a.patientName || "-") + "</div></div>" +
      "<div class='ap-kv'><div class='k'>ID Card</div><div class='v'>" + esc(a.patientIdCard || "-") + "</div></div>" +
      "<div class='ap-kv'><div class='k'>Phone</div><div class='v' style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;'>" + esc(a.patientPhone || "-") + (waBtn ? "&ensp;" + waBtn : "") + "</div></div>" +
      "<div class='ap-kv'><div class='k'>Date</div><div class='v'>" + esc(fmtDmy(a.date)) + "</div></div>" +
      "<div class='ap-kv'><div class='k'>Time</div><div class='v'>" + esc(a.time || "-") + "</div></div>" +
      "<div class='ap-kv'><div class='k'>Duration</div><div class='v'>" + esc(a.durationMins || "-") + " min</div></div>" +
      "<div class='ap-kv'><div class='k'>Doctor</div><div class='v'>" + esc(dr ? dr.name : "-") + "</div></div>" +
      "<div class='ap-kv'><div class='k'>Clinic</div><div class='v'>" + esc(cl ? cl.name : "-") + (cl && cl.locality ? "  " + esc(cl.locality) : "") + "</div></div>" +
      "<div class='ap-kv fee'><div class='k'>Doctor Fee</div><div class='v'>" + esc(fmtMoney(a.doctorFee || 0)) + "</div></div>" +
      "<div class='ap-kv fee'><div class='k'>Clinic Fee</div><div class='v'>" + esc(fmtMoney(a.clinicFee || 0)) + "</div></div>" +
      "<div class='ap-kv fee'><div class='k'>Medicines</div><div class='v'>" + esc(fmtMoney(a.medicinesCost || 0)) + "</div></div>" +
      "<div class='ap-kv total'><div class='k'>Total Due</div><div class='v'>" + esc(fmtMoney(total)) + "</div></div>" +
      (a.medicines ? "<div class='ap-kv wide'><div class='k'>Medicines / Items</div><div class='v'><div class='ap-meds'><div class='meds-txt'>" + esc(a.medicines) + "</div></div></div></div>" : "") +
      (a.notes ? "<div class='ap-kv wide'><div class='k'>Notes</div><div class='v'>" + esc(a.notes) + "</div></div>" : "") +
      (a.cancellationReason ? "<div class='ap-kv wide'><div class='k'>Cancellation Reason</div><div class='v' style='color:rgba(255,140,160,.9);'>" + esc(a.cancellationReason) + "</div></div>" : "") +
      "<div class='ap-kv'><div class='k'>Patient Token</div><div class='v'><span class='ap-token-box'>" + esc(a.token || "-") + "</span></div></div>" +
      "<div class='ap-kv'><div class='k'>Appointment ID</div><div class='v'>" + esc(a.id || "-") + "</div></div>" +
      "<div class='ap-kv'><div class='k'>Created</div><div class='v'>" + esc(fmtTs(a.createdAt || "")) + "</div></div>" +
      "</div>";
  }

  function buildDetailActions(a, detailCardEl, detailBodyEl, detailActionsEl, onActionDone) {
    if (!detailActionsEl) return;
    detailActionsEl.innerHTML = "";
    function mkBtn(label, cls, onClick) {
      var b = document.createElement("button"); b.className = "eikon-btn" + (cls ? " " + cls : "");
      b.type = "button"; b.textContent = label; b.addEventListener("click", onClick); return b;
    }
    detailActionsEl.appendChild(mkBtn("✏ Edit", "", function () { var fresh = apptById(a.id); openApptModal({ appt: fresh || a }, function () { if (typeof onActionDone === "function") onActionDone(); }); }));
    detailActionsEl.appendChild(mkBtn("🖨 Print", "", function () { var fresh = apptById(a.id); printSingleAppt(fresh || a); }));
    if (a.status !== "Confirmed" && a.status !== "Completed" && a.status !== "Cancelled") {
      detailActionsEl.appendChild(mkBtn("✓ Confirm", "", async function () { await apiUpdateAppt(a.id, { status: "Confirmed" }); toast("Updated", "Confirmed.", "good"); await refreshAll("status-change"); if (typeof onActionDone === "function") onActionDone(); }));
    }
    if (a.status !== "Completed") {
      detailActionsEl.appendChild(mkBtn("✓ Complete", "", async function () { await apiUpdateAppt(a.id, { status: "Completed" }); toast("Updated", "Marked complete.", "good"); await refreshAll("status-change"); if (typeof onActionDone === "function") onActionDone(); }));
    }
    if (a.status !== "Cancelled") {
      detailActionsEl.appendChild(mkBtn("✕ Cancel", "", async function () {
        modalConfirm("Cancel Appointment", "Mark this appointment as cancelled?", "Yes, Cancel", "Keep").then(async function (ok) {
          if (!ok) return;
          await apiUpdateAppt(a.id, { status: "Cancelled" }); toast("Cancelled", "Appointment cancelled.", "good");
          await refreshAll("status-change"); if (typeof onActionDone === "function") onActionDone();
        });
      }));
    }
    if (a.status !== "No Show") {
      detailActionsEl.appendChild(mkBtn("No Show", "", async function () { await apiUpdateAppt(a.id, { status: "No Show" }); toast("Updated", "Marked as no show.", "good"); await refreshAll("status-change"); if (typeof onActionDone === "function") onActionDone(); }));
    }
    detailActionsEl.appendChild(mkBtn("🗑 Delete", "", async function () {
      modalConfirm("Delete Appointment", "Permanently delete this appointment?", "Delete", "Cancel").then(async function (ok) {
        if (!ok) return;
        await apiDeleteAppt(a.id); state.selectedApptId = null;
        if (detailCardEl) detailCardEl.style.display = "none";
        toast("Deleted", "Appointment deleted.", "good");
        await refreshAll("appt-delete"); if (typeof onActionDone === "function") onActionDone();
      });
    }));
  }

  // ============================================================
  //  MAIN RENDER
  // ============================================================
  function render(ctx) {
    ensureStyles();
    var mount = ctx.mount;

    // Kick off auto-refresh on first render
    if (!state.__didInitialSync) {
      state.__didInitialSync = true;
      refreshAll("initial-sync").catch(function (e) { apptWarn("initial-sync failed", e && e.message); });
    } else {
      refreshAll("re-render").catch(function (e) { apptWarn("re-render refresh failed", e && e.message); });
    }
    startAutoRefresh();

    function thHtml(label, key, sortSt) {
      var on = sortSt.key === key;
      var arrow = on ? (sortSt.dir === "asc" ? " ▲" : " ▼") : "";
      return "<span class='ap-sort" + (on ? " on" : "") + "' data-key='" + esc(key) + "'>" + esc(label) + "<span class='car'>" + arrow + "</span></span>";
    }

    // ---- Build markup ----
    mount.innerHTML =
      "<div class='ap-wrap'>" +

      // -- Header --
      "<div class='ap-head'>" +
      "  <div><h2 class='ap-title'>🏥 Doctors Appointments</h2>" +
      "    <div class='ap-sub'>Visual calendar • Doctor &amp; clinic schedules • Double-booking protected • Auto-refreshes every 30s</div>" +
      "  </div>" +
      "  <div class='ap-controls'>" +
      "    <div class='ap-tabs'>" +
      "      <button class='ap-tab" + (state.view === "month"    ? " active" : "") + "' data-view='month'    type='button'>📅 Month</button>" +
      "      <button class='ap-tab" + (state.view === "day"      ? " active" : "") + "' data-view='day'      type='button'>🕐 Day Timeline</button>" +
      "      <button class='ap-tab" + (state.view === "list"     ? " active" : "") + "' data-view='list'     type='button'>📋 All Appointments</button>" +
      "      <button class='ap-tab" + (state.view === "waitlist" ? " active" : "") + "' data-view='waitlist' type='button'>⏳ Waiting List <span class='ap-wl-badge' id='ap-wl-badge'>0</span></button>" +
      "    </div>" +
      "    <button class='eikon-btn' id='ap-new-appt'    type='button'>+ New Appointment</button>" +
      "    <button class='eikon-btn' id='ap-btn-waitlist' type='button'>+ Waiting List</button>" +
      "    <div style='position:relative;display:inline-block;'>" +
      "      <button class='eikon-btn' id='ap-settings-btn' type='button'>⚙ Settings ▾</button>" +
      "      <div id='ap-settings-menu' style='display:none;position:absolute;right:0;top:36px;background:rgba(12,20,32,.98);border:1px solid rgba(255,255,255,.12);border-radius:12px;padding:6px;z-index:9999;min-width:180px;box-shadow:0 12px 40px rgba(0,0,0,.6);'>" +
      "        <button class='eikon-btn' id='ap-manage-doctors' type='button' style='display:block;width:100%;text-align:left;margin:0 0 4px 0;'>👨‍⚕️ Manage Doctors</button>" +
      "        <button class='eikon-btn' id='ap-manage-clinics' type='button' style='display:block;width:100%;text-align:left;margin:0 0 4px 0;'>🏨 Manage Clinics</button>" +
      "        <button class='eikon-btn' id='ap-manage-scheds'  type='button' style='display:block;width:100%;text-align:left;'>📆 Schedules</button>" +
      "      </div>" +
      "    </div>" +
      "  </div>" +
      "</div>" +

      // -- Global Filter Bar --
      "<div class='ap-filter-bar' id='ap-global-filters'>" +
      "  <span style='font-size:12px;font-weight:900;color:rgba(233,238,247,.6);'>Filter:</span>" +
      "  <div class='ap-filter-group'><label>Doctor</label><select class='ap-select' id='ap-gf-dr' style='min-width:155px;'>" + buildDoctorOptions(state.filterDoctorId, "any") + "</select></div>" +
      "  <div class='ap-filter-group'><label>Clinic</label><select class='ap-select' id='ap-gf-cl' style='min-width:155px;'>" + buildClinicOptions(state.filterClinicId, "any") + "</select></div>" +
      "  <div class='ap-refresh-info'><span class='ap-refresh-dot'></span><span id='ap-last-refresh'>Auto-refresh active</span></div>" +
      "</div>" +

      // ================================================================
      //  MONTH VIEW
      // ================================================================
      "<div id='ap-view-month' style='display:" + (state.view === "month" ? "block" : "none") + ";'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'>" +
      "      <div class='ap-nav'>" +
      "        <button class='ap-nav-btn' id='ap-month-prev' type='button'>◀</button>" +
      "        <div><div class='ap-nav-date' id='ap-month-label'></div></div>" +
      "        <button class='ap-nav-btn' id='ap-month-next' type='button'>▶</button>" +
      "        <button class='ap-nav-btn' id='ap-month-today' type='button' style='font-size:11px;padding:5px 8px;'>Today</button>" +
      "      </div>" +
      "      <div class='right'>" +
      "        <button class='eikon-btn' id='ap-month-print' type='button'>🖨 Print Month</button>" +
      "      </div>" +
      "    </div>" +
      "    <div id='ap-month-legend' class='ap-month-legend'></div>" +
      "    <div class='ap-month-outer'><div id='ap-month-grid' class='ap-month-grid'></div></div>" +
      "  </div>" +
      "</div>" +

      // ================================================================
      //  DAY TIMELINE VIEW
      // ================================================================
      "<div id='ap-view-day' style='display:" + (state.view === "day" ? "block" : "none") + ";'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'>" +
      "      <div class='ap-nav'>" +
      "        <button class='ap-nav-btn' id='ap-day-prev'  type='button'>◀</button>" +
      "        <div><div class='ap-nav-date' id='ap-day-label'></div><div class='ap-nav-sub' id='ap-day-sub'></div></div>" +
      "        <button class='ap-nav-btn' id='ap-day-next'  type='button'>▶</button>" +
      "        <button class='ap-nav-btn' id='ap-day-today' type='button' style='font-size:11px;padding:5px 8px;'>Today</button>" +
      "      </div>" +
      "      <div class='right'>" +
      "        <input class='ap-date-input' id='ap-day-picker' type='date' value='" + esc(state.currentDate) + "' title='Jump to date'>" +
      "        <button class='eikon-btn' id='ap-day-print' type='button'>🖨 Print Day</button>" +
      "      </div>" +
      "    </div>" +
      "    <div id='ap-day-schedinfo'></div>" +
      "    <div id='ap-day-timeline'></div>" +
      "  </div>" +
      "  <div class='ap-card ap-day-detail-panel' id='ap-day-detail' style='display:none;'>" +
      "    <div class='ap-card-head'><h3 id='ap-day-detail-title'>Appointment Details</h3><div class='right' id='ap-day-detail-actions'></div></div>" +
      "    <div id='ap-day-detail-body'></div>" +
      "  </div>" +
      "</div>" +

      // ================================================================
      //  LIST VIEW
      // ================================================================
      "<div id='ap-view-list' style='display:" + (state.view === "list" ? "block" : "none") + ";'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'><div><h3>All Appointments</h3><div class='meta' id='ap-list-count'>Loading...</div></div>" +
      "      <div class='right'><button class='eikon-btn' id='ap-list-print' type='button'>🖨 Print List</button></div></div>" +
      "    <div class='ap-filters'>" +
      "      <div class='ap-filter-field'><label>Search</label><input class='ap-input' id='ap-list-search' type='text' placeholder='Patient, doctor, clinic...' value='" + esc(state.listQuery) + "' style='min-width:200px;'></div>" +
      "      <div class='ap-filter-field'><label>Status</label><select class='ap-select' id='ap-list-status'><option value=''>- All Statuses -</option>" +
      APPT_STATUSES.map(function (s) { return "<option value='" + esc(s) + "'" + (s === state.filterStatus ? " selected" : "") + ">" + esc(s) + "</option>"; }).join("") + "</select></div>" +
      "      <div class='ap-filter-field'><label>From</label><input class='ap-input' id='ap-list-from' type='date' value='" + esc(state.filterDateFrom) + "'></div>" +
      "      <div class='ap-filter-field'><label>To</label><input class='ap-input' id='ap-list-to' type='date' value='" + esc(state.filterDateTo) + "'></div>" +
      "      <button class='eikon-btn' id='ap-list-clear' type='button' style='align-self:flex-end;'>Clear</button>" +
      "    </div>" +
      "    <div class='ap-table-wrap'><table class='ap-table' id='ap-list-table'>" +
      "      <thead><tr>" +
      "        <th>" + thHtml("Date", "date", state.listSort) + "</th>" +
      "        <th>" + thHtml("Time", "time", state.listSort) + "</th>" +
      "        <th>" + thHtml("Patient", "patientName", state.listSort) + "</th>" +
      "        <th>" + thHtml("ID Card", "patientIdCard", state.listSort) + "</th>" +
      "        <th>" + thHtml("Phone", "patientPhone", state.listSort) + "</th>" +
      "        <th>" + thHtml("Doctor", "doctorId", state.listSort) + "</th>" +
      "        <th>" + thHtml("Clinic", "clinicId", state.listSort) + "</th>" +
      "        <th class='noclick'>Status</th>" +
      "        <th>" + thHtml("Total", "total", state.listSort) + "</th>" +
      "      </tr></thead>" +
      "      <tbody id='ap-list-tbody'></tbody></table></div>" +
      "  </div>" +
      "  <div class='ap-card' id='ap-list-detail' style='display:none;'>" +
      "    <div class='ap-card-head'><h3 id='ap-list-detail-title'>Appointment Details</h3><div class='right' id='ap-list-detail-actions'></div></div>" +
      "    <div id='ap-list-detail-body'></div>" +
      "  </div>" +
      "</div>" +

      // ================================================================
      //  WAITLIST VIEW
      // ================================================================
      "<div id='ap-view-waitlist' style='display:" + (state.view === "waitlist" ? "block" : "none") + ";'>" +
      "  <div class='ap-card'>" +
      "    <div class='ap-card-head'><div><h3>⏳ Waiting List</h3><div class='meta' id='ap-wl-count'>Loading...</div></div>" +
      "      <div class='right'><input class='ap-input' id='ap-wl-search' type='text' placeholder='Search...' value='" + esc(state.wlQuery) + "' style='min-width:180px;'>" +
      "        <button class='eikon-btn' id='ap-wl-print' type='button'>🖨 Print</button></div></div>" +
      "    <div class='ap-table-wrap'><table class='ap-table' id='ap-wl-table'>" +
      "      <thead><tr>" +
      "        <th>" + thHtml("Patient", "patientName", state.wlSort) + "</th>" +
      "        <th>" + thHtml("ID Card", "patientIdCard", state.wlSort) + "</th>" +
      "        <th>" + thHtml("Phone", "patientPhone", state.wlSort) + "</th>" +
      "        <th>" + thHtml("Doctor Pref.", "doctorId", state.wlSort) + "</th>" +
      "        <th>" + thHtml("Clinic Pref.", "clinicId", state.wlSort) + "</th>" +
      "        <th>" + thHtml("Preferred Dates", "preferredDates", state.wlSort) + "</th>" +
      "        <th>" + thHtml("Flexibility", "flexibility", state.wlSort) + "</th>" +
      "        <th>" + thHtml("Added", "addedDate", state.wlSort) + "</th>" +
      "        <th class='noclick'>Status</th>" +
      "      </tr></thead>" +
      "      <tbody id='ap-wl-tbody'></tbody></table></div>" +
      "  </div>" +
      "  <div class='ap-card' id='ap-wl-detail' style='display:none;'>" +
      "    <div class='ap-card-head'><h3 id='ap-wl-detail-title'>Waiting List Entry</h3><div class='right' id='ap-wl-detail-actions'></div></div>" +
      "    <div id='ap-wl-detail-body'></div>" +
      "  </div>" +
      "</div>" +

      "</div>"; // .ap-wrap

    // ---- DOM refs ----
    var viewMonthEl   = E.q("#ap-view-month",    mount);
    var viewDayEl     = E.q("#ap-view-day",      mount);
    var viewListEl    = E.q("#ap-view-list",     mount);
    var viewWlEl      = E.q("#ap-view-waitlist", mount);
    var wlBadge       = E.q("#ap-wl-badge",      mount);
    var lastRefreshEl = E.q("#ap-last-refresh",  mount);

    var dayLabel        = E.q("#ap-day-label",         mount);
    var daySub          = E.q("#ap-day-sub",           mount);
    var dayPicker       = E.q("#ap-day-picker",        mount);
    var dayTimeline     = E.q("#ap-day-timeline",      mount);
    var daySchedInfo    = E.q("#ap-day-schedinfo",     mount);
    var dayDetailCard   = E.q("#ap-day-detail",        mount);
    var dayDetailTitle  = E.q("#ap-day-detail-title",  mount);
    var dayDetailBody   = E.q("#ap-day-detail-body",   mount);
    var dayDetailActions= E.q("#ap-day-detail-actions",mount);

    var listTbody       = E.q("#ap-list-tbody",         mount);
    var listCount       = E.q("#ap-list-count",         mount);
    var listDetailCard  = E.q("#ap-list-detail",        mount);
    var listDetailTitle = E.q("#ap-list-detail-title",  mount);
    var listDetailBody  = E.q("#ap-list-detail-body",   mount);
    var listDetailActs  = E.q("#ap-list-detail-actions",mount);
    var listTable       = E.q("#ap-list-table",         mount);

    var wlTbody         = E.q("#ap-wl-tbody",           mount);
    var wlCount         = E.q("#ap-wl-count",           mount);
    var wlDetailCard    = E.q("#ap-wl-detail",          mount);
    var wlDetailBody    = E.q("#ap-wl-detail-body",     mount);
    var wlDetailActs    = E.q("#ap-wl-detail-actions",  mount);

    // ---- Update "last refreshed" indicator ----
    function updateRefreshInfo() {
      if (lastRefreshEl && _lastRefreshTime) {
        var secs = Math.round((Date.now() - _lastRefreshTime) / 1000);
        lastRefreshEl.textContent = "Last refreshed " + (secs < 5 ? "just now" : secs + "s ago") + " • Auto every 30s";
      }
    }
    setInterval(updateRefreshInfo, 5000);

    // ================================================================
    //  VIEW SWITCHING
    // ================================================================
    function switchView(v) {
      apptLog("switchView", v);
      state.view = v;
      viewMonthEl.style.display   = v === "month"    ? "block" : "none";
      viewDayEl.style.display     = v === "day"      ? "block" : "none";
      viewListEl.style.display    = v === "list"     ? "block" : "none";
      viewWlEl.style.display      = v === "waitlist" ? "block" : "none";
      mount.querySelectorAll(".ap-tab").forEach(function (t) { t.classList.toggle("active", t.getAttribute("data-view") === v); });
      if (v === "month")    renderMonth();
      if (v === "day")      renderDay();
      if (v === "list")     renderListTable();
      if (v === "waitlist") renderWlTable();
    }
    mount.querySelectorAll(".ap-tab").forEach(function (tab) {
      tab.addEventListener("click", function () { switchView(tab.getAttribute("data-view")); });
    });

    // ================================================================
    //  WL BADGE
    // ================================================================
    function updateWlBadge() {
      var active = loadWaitlist().filter(function (w) { return w.status === "Waiting"; }).length;
      if (wlBadge) wlBadge.textContent = active;
    }

    // ================================================================
    //  GLOBAL REFRESH (renders current view)
    // ================================================================
    function refresh() {
      apptLog("refresh called, view="+state.view);
      try {
        updateWlBadge();
        updateRefreshInfo();
        // Rebuild global filter dropdowns
        var gfDr = E.q("#ap-gf-dr", mount); var gfCl = E.q("#ap-gf-cl", mount);
        if (gfDr) { var prevDr = gfDr.value; gfDr.innerHTML = buildDoctorOptions("", "any"); gfDr.value = prevDr || state.filterDoctorId; }
        if (gfCl) { var prevCl = gfCl.value; gfCl.innerHTML = buildClinicOptions("", "any"); gfCl.value = prevCl || state.filterClinicId; }
        if (state.view === "month")    renderMonth();
        if (state.view === "day")      renderDay();
        if (state.view === "list")     renderListTable();
        if (state.view === "waitlist") renderWlTable();
      } catch(e) { apptErr("refresh error", e); }
    }
    state.refresh = refresh;

    // ================================================================
    //  RENDER: MONTH VIEW
    // ================================================================
    function renderMonth() {
      try {
        var ym  = state.currentMonth;
        var lbl = E.q("#ap-month-label", mount);
        if (lbl) lbl.textContent = monthLabel(ym);

        var grid   = E.q("#ap-month-grid",   mount);
        var legend = E.q("#ap-month-legend", mount);
        if (!grid) return;

        grid.innerHTML = "";

        // Headers: Mon..Sun
        var dayHeaders = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];
        dayHeaders.forEach(function (d, i) {
          var h = document.createElement("div");
          h.className = "ap-month-header" + (i >= 5 ? " weekend" : "");
          h.textContent = d;
          grid.appendChild(h);
        });

        // Figure out first day of month
        var firstDayYmd = ymToFirstDay(ym);
        // JS dow: 0=Sun..6=Sat, grid Mon=0..Sun=6
        var jsDow = new Date(firstDayYmd + "T12:00:00").getDay();
        var gridStartDow = jsDow === 0 ? 6 : jsDow - 1; // Mon=0..Sun=6
        var totalDays = daysInMonth(ym);
        var today = todayYmd();

        // Get all schedules (for "has-schedule" indicator)
        var allScheds = loadSchedules();

        // Get appointments in this month
        var allAppts = loadAppts().filter(function (a) { return String(a.date || "").slice(0, 7) === ym; });
        apptLog("renderMonth", ym, "appts="+allAppts.length);

        // Filter by global doctor/clinic
        var fDr = state.filterDoctorId; var fCl = state.filterClinicId;
        if (fDr) allAppts = allAppts.filter(function (a) { return a.doctorId === fDr; });
        if (fCl) allAppts = allAppts.filter(function (a) { return a.clinicId === fCl; });

        // Build legend for doctors present this month
        var doctorSet = {};
        allAppts.forEach(function (a) { if (a.doctorId) doctorSet[a.doctorId] = true; });
        if (legend) {
          legend.innerHTML = "";
          Object.keys(doctorSet).forEach(function (drId) {
            var dr = doctorById(drId); if (!dr) return;
            var item = document.createElement("div"); item.className = "ap-legend-item";
            var dot = document.createElement("div"); dot.className = "ap-legend-dot"; dot.style.background = drColor(drId);
            var lbl2 = document.createElement("span"); lbl2.textContent = dr.name;
            item.appendChild(dot); item.appendChild(lbl2); legend.appendChild(item);
          });
          if (!Object.keys(doctorSet).length) {
            legend.innerHTML = "<span style='font-size:11px;color:rgba(233,238,247,.35);'>No appointments this month</span>";
          }
        }

        // Build grid: 6 rows × 7 cols
        // Start from first Mon before/on the 1st
        var parts = ym.split("-");
        var year = parseInt(parts[0]); var month = parseInt(parts[1]);
        var firstDate = new Date(year, month - 1, 1);
        var gridStart = new Date(firstDate);
        gridStart.setDate(gridStart.getDate() - gridStartDow);

        for (var week = 0; week < 6; week++) {
          for (var dow2 = 0; dow2 < 7; dow2++) {
            var cellDate = new Date(gridStart);
            cellDate.setDate(gridStart.getDate() + week * 7 + dow2);
            var cellYmd = cellDate.getFullYear() + "-" + pad2(cellDate.getMonth() + 1) + "-" + pad2(cellDate.getDate());
            var isThisMonth = cellDate.getMonth() + 1 === month && cellDate.getFullYear() === year;
            var isToday = cellYmd === today;
            var isWeekend = dow2 >= 5;

            // Check if any schedule runs on this day
            var dayScheds = getSchedulesForDate(cellYmd);
            if (fDr) dayScheds = dayScheds.filter(function (s) { return String(s.doctorId || "") === fDr; });
            if (fCl) dayScheds = dayScheds.filter(function (s) { return String(s.clinicId || "") === fCl; });
            var hasSchedule = dayScheds.length > 0;

            // Get appointments for this cell
            var cellAppts = loadAppointments(cellYmd).filter(function (a) {
              if (fDr && a.doctorId !== fDr) return false;
              if (fCl && a.clinicId !== fCl) return false;
              return true;
            });

            var cell = document.createElement("div");
            cell.className = "ap-month-day" + (isToday ? " today" : "") + (!isThisMonth ? " other-month" : "") + (isWeekend ? " weekend" : "") + (hasSchedule && isThisMonth ? " has-schedule" : "");

            // Day number
            var numEl = document.createElement("div"); numEl.className = "ap-mday-num"; numEl.textContent = cellDate.getDate();
            cell.appendChild(numEl);

            // Appointment chips
            var apptList = document.createElement("div"); apptList.className = "ap-mday-appts";
            var maxChips = 4;
            var notCancelled = cellAppts.filter(function (a) { return a.status !== "Cancelled"; });
            notCancelled.slice(0, maxChips).forEach(function (a) {
              var chip = document.createElement("div"); chip.className = "ap-mday-chip";
              var dr = doctorById(a.doctorId);
              chip.style.background = hexToRgba(drColor(a.doctorId), 0.82);
              chip.title = (a.time || "") + " " + (a.patientName || "") + (dr ? " — " + dr.name : "") + " [" + a.status + "]";
              chip.textContent = (a.time ? a.time + " " : "") + (a.patientName || "-").split(" ")[0];
              // Click chip → go to day view for that date
              (function (apptId, apptDate) {
                chip.addEventListener("click", function (ev) {
                  ev.stopPropagation();
                  state.currentDate = apptDate;
                  state.selectedApptId = String(apptId);
                  switchView("day");
                });
              })(a.id, cellYmd);
              apptList.appendChild(chip);
            });
            if (notCancelled.length > maxChips) {
              var more = document.createElement("div"); more.className = "ap-mday-more";
              more.textContent = "+" + (notCancelled.length - maxChips) + " more";
              apptList.appendChild(more);
            }
            cell.appendChild(apptList);

            // Click cell body → go to day view
            (function (ymd2) {
              cell.addEventListener("click", function () {
                state.currentDate = ymd2;
                switchView("day");
              });
            })(cellYmd);

            grid.appendChild(cell);
          }
        }
      } catch (e) {
        apptErr("renderMonth crash", e);
        toast("Calendar", "Month render error: " + (e && e.message), "bad");
      }
    }

    // ================================================================
    //  RENDER: DAY TIMELINE VIEW
    // ================================================================
    function renderDay() {
      try {
        var ymd = state.currentDate;
        if (dayLabel) dayLabel.textContent = dayNameShort(ymd) + " " + fmtDmy(ymd);
        if (daySub)   daySub.textContent   = ymd === todayYmd() ? "Today" : "";
        if (dayPicker) dayPicker.value = ymd;

        var fDr = state.filterDoctorId;
        var fCl = state.filterClinicId;

        // Get schedules for this day, applying filters
        var scheds = getSchedulesForDate(ymd);
        if (fDr) scheds = scheds.filter(function (s) { return String(s.doctorId || "") === fDr; });
        if (fCl) scheds = scheds.filter(function (s) { return String(s.clinicId || "") === fCl; });

        apptLog("renderDay", ymd, "schedules="+scheds.length, "filterDr="+fDr, "filterCl="+fCl);

        // Schedule info bar
        if (daySchedInfo) {
          if (scheds.length) {
            daySchedInfo.innerHTML = scheds.map(function (s) {
              var dr = doctorById(s.doctorId); var cl = clinicById(s.clinicId);
              var label = s.isOneOff ? "One-off" : "Recurring " + ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"][s.dayOfWeek] + "s";
              var color = drColor(s.doctorId);
              return "<div class='ap-sched-bar' style='border-color:" + hexToRgba(color, 0.35) + ";background:" + hexToRgba(color, 0.07) + ";'>" +
                "<span style='width:8px;height:8px;border-radius:50%;background:" + color + ";display:inline-block;flex-shrink:0;'></span>" +
                "<strong style='color:" + color + ";'>" + esc(dr ? dr.name : "Unknown") + "</strong>" +
                " at " + esc(cl ? cl.name : "Unknown") +
                "  " + esc(s.startTime || "") + " – " + esc(s.endTime || "") +
                "  Slot: " + esc(s.slotDuration || 10) + "min" +
                "  <span class='ap-repeat-tag'>" + esc(label) + "</span></div>";
            }).join("");
          } else {
            daySchedInfo.innerHTML = "<div style='font-size:12px;color:rgba(233,238,247,.35);margin-bottom:8px;font-style:italic;'>No scheduled sessions for this day" + (fDr || fCl ? " with current filter" : "") + ". Set up schedules in ⚙ Settings → Schedules.</div>";
          }
        }

        if (!dayTimeline) return;
        dayTimeline.innerHTML = "";

        if (!scheds.length) {
          var emp = document.createElement("div"); emp.className = "ap-timeline-empty";
          emp.textContent = "No schedules for this day. Navigate to another day or add schedules in Settings.";
          dayTimeline.appendChild(emp);
          updateWlBadge(); return;
        }

        // Determine time range
        var PX_PER_MIN = 3.2;  // Increased from 1.6 – gives 32px per 10min slot, much more readable
        var MIN_SLOT_PX = 28;  // Minimum visible height for available slots
        var rangeStartMin = 24 * 60; var rangeEndMin = 0;
        scheds.forEach(function (s) {
          var sm = timeToMins(s.startTime || "09:00");
          var em = timeToMins(s.endTime   || "17:00");
          rangeStartMin = Math.min(rangeStartMin, sm);
          rangeEndMin   = Math.max(rangeEndMin,   em);
        });
        // Pad slightly and round to hour
        rangeStartMin = Math.max(0, Math.floor(rangeStartMin / 60) * 60);
        rangeEndMin   = Math.min(24 * 60, Math.ceil(rangeEndMin / 60) * 60);
        if (rangeEndMin <= rangeStartMin) { rangeStartMin = 8 * 60; rangeEndMin = 18 * 60; }
        var totalMins   = rangeEndMin - rangeStartMin;
        var totalHeight = Math.max(totalMins * PX_PER_MIN, 200);

        // Get appointments for this day
        var appts = apptsForDate(ymd);
        apptLog("renderDay appts="+appts.length+" for "+ymd);

        // Build timeline wrapper: time axis + columns
        var wrap = document.createElement("div"); wrap.className = "ap-timeline-outer";
        var inner = document.createElement("div"); inner.className = "ap-timeline-wrap";
        wrap.appendChild(inner);

        // Time axis
        var axis = document.createElement("div"); axis.className = "ap-time-axis";
        axis.style.height = (totalHeight + 40) + "px"; // +40 for col header
        inner.appendChild(axis);

        // Column container
        var colsWrap = document.createElement("div"); colsWrap.className = "ap-timeline-cols";
        inner.appendChild(colsWrap);

        // Hour + half-hour lines (positioned relative to colsWrap)
        var linesDiv = document.createElement("div");
        linesDiv.style.cssText = "position:absolute;left:0;right:0;top:40px;pointer-events:none;height:" + totalHeight + "px;";
        colsWrap.style.position = "relative";
        colsWrap.appendChild(linesDiv);

        for (var hm = rangeStartMin; hm <= rangeEndMin; hm += 30) {
          var topPx = (hm - rangeStartMin) * PX_PER_MIN;
          // Hour label on axis
          if (hm % 60 === 0) {
            var lbl3 = document.createElement("div"); lbl3.className = "ap-time-label";
            lbl3.style.top = (40 + topPx) + "px";
            lbl3.textContent = minsToTime(hm);
            axis.appendChild(lbl3);
            // Hour line across columns
            var hline = document.createElement("div"); hline.className = "ap-hour-line";
            hline.style.top = topPx + "px";
            linesDiv.appendChild(hline);
          } else {
            // Half-hour dashed line
            var hdash = document.createElement("div"); hdash.className = "ap-half-line";
            hdash.style.top = topPx + "px";
            linesDiv.appendChild(hdash);
          }
        }

        // Build columns (one per schedule)
        scheds.forEach(function (sched) {
          var drId = String(sched.doctorId || sched.doctor_id || "");
          var clId = String(sched.clinicId || sched.clinic_id || "");
          var dr = doctorById(drId); var cl = clinicById(clId);
          var color = drColor(drId);

          var col = document.createElement("div"); col.className = "ap-timeline-col";

          // Column header
          var colHdr = document.createElement("div"); colHdr.className = "ap-col-header";
          colHdr.style.borderTop = "3px solid " + color;

          // Check if this shift is fully booked
          var shiftSlots = computeAvailableStartTimes(ymd, drId, clId, parseInt(sched.slotDuration || 10, 10) || 10);
          var isFullyBooked = shiftSlots.length === 0;
          var bookedBadge = isFullyBooked ? "<span class='ap-booked-badge'>FULL</span>" : "";
          var wlBtnHtml = isFullyBooked
            ? "<button class='ap-col-wl-btn' data-dr='" + esc(drId) + "' data-cl='" + esc(clId) + "' data-date='" + esc(ymd) + "' type='button' " +
              "style='margin-top:4px;font-size:10px;padding:2px 8px;border-radius:6px;border:1px solid rgba(204,148,255,.4);background:rgba(204,148,255,.1);color:#d4a0ff;cursor:pointer;width:100%;display:block;'>⏳ Add to Waiting List</button>"
            : "";

          colHdr.innerHTML =
            "<div class='col-dr' style='color:" + color + ";'>" + esc(dr ? dr.name : "Unknown") + bookedBadge + "</div>" +
            "<div class='col-cl'>" + esc(cl ? cl.name : "Unknown") + (cl && cl.locality ? " · " + esc(cl.locality) : "") + "</div>" +
            wlBtnHtml;
          col.appendChild(colHdr);

          // Column body
          var colBody = document.createElement("div"); colBody.className = "ap-col-body";
          colBody.style.cssText = "position:relative;height:" + totalHeight + "px;";
          col.appendChild(colBody);

          // Compute available slots for this schedule
          var schedStartM = timeToMins(sched.startTime || "09:00");
          var schedEndM   = timeToMins(sched.endTime   || "17:00");
          var slotDur     = parseInt(sched.slotDuration || 10, 10) || 10;

          // Get appointments for THIS doctor+clinic
          var colAppts = appts.filter(function (a) {
            return String(a.doctorId || "") === drId && String(a.clinicId || "") === clId;
          });

          // Draw available slot blocks
          for (var sm2 = schedStartM; sm2 < schedEndM; sm2 += slotDur) {
            // Check if this slot is free
            var slotFree = true;
            for (var ai = 0; ai < colAppts.length; ai++) {
              var a2 = colAppts[ai];
              if (String(a2.status || "").toLowerCase() === "cancelled") continue;
              var aS = apptStartMins(a2); var aE = aS + apptDuration(a2);
              if (aS < sm2 + slotDur && aE > sm2) { slotFree = false; break; }
            }
            if (!slotFree) continue;

            var slotTop  = (sm2 - rangeStartMin) * PX_PER_MIN;
            var slotH    = Math.max(slotDur * PX_PER_MIN - 2, MIN_SLOT_PX);

            var slotEl = document.createElement("div");
            slotEl.className = "ap-slot-available";
            slotEl.style.top    = slotTop + "px";
            slotEl.style.height = slotH + "px";
            slotEl.title = "Book " + minsToTime(sm2) + " (" + slotDur + " min slot)";
            // Always show the time in the slot for clarity
            slotEl.innerHTML = "<span class='ap-slot-time'>" + minsToTime(sm2) + "</span><span class='ap-slot-plus'>+</span>";

            (function (slotTime, slotDrId, slotClId) {
              slotEl.addEventListener("click", function () {
                apptLog("slot click: time="+slotTime+" dr="+slotDrId+" cl="+slotClId+" date="+ymd);
                openApptModal({ date: ymd, doctorId: slotDrId, clinicId: slotClId, time: slotTime }, function () { refresh(); });
              });
            })(minsToTime(sm2), drId, clId);

            colBody.appendChild(slotEl);
          }

          // Draw appointment blocks
          colAppts.forEach(function (a) {
            var aStartM = apptStartMins(a);
            var aDurM   = apptDuration(a);
            var aEndM   = aStartM + aDurM;

            // Only show if overlaps with schedule time range
            if (aEndM <= schedStartM || aStartM >= schedEndM) return;

            var blockTop = (aStartM - rangeStartMin) * PX_PER_MIN;
            var blockH   = Math.max(aDurM * PX_PER_MIN - 2, MIN_SLOT_PX);
            var isCancelled = String(a.status || "").toLowerCase() === "cancelled";
            var isSelected  = state.selectedApptId && String(a.id) === String(state.selectedApptId);

            var block = document.createElement("div");
            block.className = "ap-appt-block" + (isCancelled ? " ap-appt-cancelled" : "") + (isSelected ? " selected" : "");
            block.style.top        = blockTop + "px";
            block.style.height     = blockH + "px";
            block.style.background = isCancelled ? "rgba(255,90,122,.15)" : hexToRgba(color, 0.82);
            block.style.border     = "1px solid " + (isCancelled ? "rgba(255,90,122,.3)" : hexToRgba(color, 1));
            block.setAttribute("data-id", String(a.id));

            var inner2 = document.createElement("div"); inner2.className = "ap-appt-inner";
            inner2.innerHTML =
              "<div class='ap-appt-name'>" + esc(a.patientName || "-") + "</div>" +
              (blockH > 42 ? "<div class='ap-appt-meta'>" + esc(a.time || "") + "  " + esc(a.durationMins || "") + "min  " + esc(a.status || "") + "</div>" : "");
            block.appendChild(inner2);
            block.title = a.patientName + " | " + a.time + " (" + a.durationMins + " min) | " + a.status + (a.patientPhone ? " | " + a.patientPhone : "");

            (function (apptObj) {
              block.addEventListener("click", function (ev) {
                ev.stopPropagation();
                state.selectedApptId = String(apptObj.id);
                // Highlight selected
                colBody.querySelectorAll(".ap-appt-block").forEach(function (b) { b.classList.remove("selected"); });
                block.classList.add("selected");
                // Show detail panel
                var fresh = apptById(apptObj.id) || apptObj;
                if (dayDetailCard) {
                  dayDetailCard.style.display = "block";
                  if (dayDetailTitle) dayDetailTitle.textContent = "Appointment — " + fmtDmy(fresh.date) + " " + (fresh.time || "") + " — " + (fresh.patientName || "");
                  if (dayDetailBody) dayDetailBody.innerHTML = buildDetailHtml(fresh);
                  buildDetailActions(fresh, dayDetailCard, dayDetailBody, dayDetailActions, function () { refresh(); });
                  dayDetailCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
                }
              });
            })(a);

            colBody.appendChild(block);
          });

          colsWrap.appendChild(col);
        });

        // Wire "Add to Waiting List" buttons on fully-booked columns
        dayTimeline.querySelectorAll(".ap-col-wl-btn").forEach(function (btn) {
          btn.addEventListener("click", function (ev) {
            ev.stopPropagation();
            var shiftDrId = btn.getAttribute("data-dr");
            var shiftClId = btn.getAttribute("data-cl");
            var shiftDate = btn.getAttribute("data-date");
            openWaitlistModal({ shift: { doctorId: shiftDrId, clinicId: shiftClId, date: shiftDate } }, function () { refresh(); });
          });
        });

        dayTimeline.appendChild(wrap);
        updateWlBadge();
      } catch (e) {
        apptErr("renderDay crash", e);
        try { toast("Calendar", "Day timeline error: " + (e && e.message), "bad"); } catch (e2) {}
      }
    }

    // ================================================================
    //  RENDER: LIST TABLE
    // ================================================================
    function renderListTable() {
      var filtered = getFilteredAppts();
      if (listCount) listCount.textContent = "Showing " + filtered.length + " record" + (filtered.length === 1 ? "" : "s");
      if (!listTbody) return;
      listTbody.innerHTML = "";
      if (!filtered.length) {
        var tr0 = document.createElement("tr"); var td0 = document.createElement("td");
        td0.colSpan = 9; td0.style.textAlign = "center"; td0.style.padding = "28px";
        td0.style.color = "rgba(233,238,247,.4)"; td0.style.fontStyle = "italic";
        td0.textContent = "No appointments match the current filters.";
        tr0.appendChild(td0); listTbody.appendChild(tr0);
      } else {
        filtered.forEach(function (a) {
          var dr = doctorById(a.doctorId); var cl = clinicById(a.clinicId);
          var tr = document.createElement("tr");
          tr.setAttribute("data-id", String(a.id));
          if (state.selectedApptId && String(a.id) === String(state.selectedApptId)) tr.classList.add("ap-row-sel");
          function mkTd(txt, cls) { var c = document.createElement("td"); if (cls) c.className = cls; c.textContent = txt; return c; }
          tr.appendChild(mkTd(fmtDmy(a.date)));
          tr.appendChild(mkTd(a.time || ""));
          tr.appendChild(mkTd(a.patientName || ""));
          tr.appendChild(mkTd(a.patientIdCard || ""));
          // Phone column with WhatsApp button
          var phoneTd = document.createElement("td");
          phoneTd.style.cssText = "white-space:nowrap;";
          phoneTd.innerHTML = esc(a.patientPhone || "") + (a.patientPhone ? "&ensp;" + whatsappBtnHtml(a.patientPhone, "font-size:10px;padding:2px 7px;") : "");
          tr.appendChild(phoneTd);
          tr.appendChild(mkTd(dr ? dr.name : ""));
          tr.appendChild(mkTd(cl ? cl.name : ""));
          var stTd = document.createElement("td"); stTd.appendChild(statusBadge(a.status)); tr.appendChild(stTd);
          tr.appendChild(mkTd(fmtMoney(computeTotal(a))));
          tr.addEventListener("click", function () {
            state.selectedApptId = String(a.id);
            var fresh = apptById(a.id) || a;
            if (listDetailCard) {
              listDetailCard.style.display = "block";
              if (listDetailTitle) listDetailTitle.textContent = "Appointment — " + fmtDmy(fresh.date) + " — " + (fresh.patientName || "");
              if (listDetailBody) listDetailBody.innerHTML = buildDetailHtml(fresh);
              buildDetailActions(fresh, listDetailCard, listDetailBody, listDetailActs, function () { refresh(); });
              listTbody.querySelectorAll("tr").forEach(function (r) { r.classList.remove("ap-row-sel"); });
              tr.classList.add("ap-row-sel");
              listDetailCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
            }
          });
          listTbody.appendChild(tr);
        });
      }
      updateWlBadge();
    }

    // ================================================================
    //  RENDER: WAITLIST TABLE
    // ================================================================
    function renderWlTable() {
      var waiting = getFilteredWaitlist();
      if (wlCount) wlCount.textContent = "Showing " + waiting.length + " entr" + (waiting.length === 1 ? "y" : "ies");
      if (!wlTbody) return;
      wlTbody.innerHTML = "";
      if (!waiting.length) {
        var tr0 = document.createElement("tr"); var td0 = document.createElement("td");
        td0.colSpan = 9; td0.style.textAlign = "center"; td0.style.padding = "28px";
        td0.style.color = "rgba(233,238,247,.4)"; td0.style.fontStyle = "italic";
        td0.textContent = "No entries in the waiting list.";
        tr0.appendChild(td0); wlTbody.appendChild(tr0);
      } else {
        waiting.forEach(function (w) {
          var dr = doctorById(w.doctorId); var cl = clinicById(w.clinicId);
          var tr = document.createElement("tr");
          tr.setAttribute("data-id", String(w.id));
          if (state.selectedWlId && String(w.id) === String(state.selectedWlId)) tr.classList.add("ap-row-sel");
          function mkTd(txt) { var c = document.createElement("td"); c.textContent = txt; return c; }
          tr.appendChild(mkTd(w.patientName || ""));
          tr.appendChild(mkTd(w.patientIdCard || ""));
          // Phone with WhatsApp button
          var wlPhoneTd = document.createElement("td");
          wlPhoneTd.style.cssText = "white-space:nowrap;";
          wlPhoneTd.innerHTML = esc(w.patientPhone || "") + (w.patientPhone ? "&ensp;" + whatsappBtnHtml(w.patientPhone, "font-size:10px;padding:2px 7px;") : "");
          tr.appendChild(wlPhoneTd);
          tr.appendChild(mkTd(dr ? dr.name : "Any"));
          tr.appendChild(mkTd(cl ? cl.name : "Any"));
          tr.appendChild(mkTd(w.preferredDates || ""));
          tr.appendChild(mkTd(w.flexibility || ""));
          tr.appendChild(mkTd(fmtDmy(w.addedDate || "")));
          var stTd = document.createElement("td"); stTd.appendChild(statusBadge(w.status || "Waiting")); tr.appendChild(stTd);
          tr.addEventListener("click", function () {
            state.selectedWlId = String(w.id);
            showWlDetail(w);
            wlTbody.querySelectorAll("tr").forEach(function (r) { r.classList.remove("ap-row-sel"); });
            tr.classList.add("ap-row-sel");
            if (wlDetailCard) wlDetailCard.scrollIntoView({ behavior: "smooth", block: "nearest" });
          });
          wlTbody.appendChild(tr);
        });
      }
      updateWlBadge();
    }

    function showWlDetail(w) {
      if (!wlDetailCard) return;
      var dr = doctorById(w.doctorId); var cl = clinicById(w.clinicId);
      wlDetailCard.style.display = "block";
      var titleEl = E.q("#ap-wl-detail-title", mount);
      if (titleEl) titleEl.textContent = "Waiting List — " + w.id + "  " + w.patientName;
      if (wlDetailBody) {
        var wDr = doctorById(w.doctorId); var wCl = clinicById(w.clinicId);
        var wWaBtn = w.patientPhone ? whatsappBtnHtml(w.patientPhone) : "";
        wlDetailBody.innerHTML =
          "<div class='ap-detail-grid'>" +
          "<div class='ap-kv half'><div class='k'>Patient</div><div class='v'>" + esc(w.patientName || "-") + "</div></div>" +
          "<div class='ap-kv'><div class='k'>ID Card</div><div class='v'>" + esc(w.patientIdCard || "-") + "</div></div>" +
          "<div class='ap-kv'><div class='k'>Phone</div><div class='v' style='display:flex;align-items:center;gap:8px;flex-wrap:wrap;'>" + esc(w.patientPhone || "-") + (wWaBtn ? "&ensp;" + wWaBtn : "") + "</div></div>" +
          "<div class='ap-kv'><div class='k'>Doctor</div><div class='v'>" + esc(wDr ? wDr.name : "Any") + "</div></div>" +
          "<div class='ap-kv'><div class='k'>Clinic</div><div class='v'>" + esc(wCl ? wCl.name : "Any") + "</div></div>" +
          "<div class='ap-kv'><div class='k'>Priority</div><div class='v'>" + esc(w.flexibility || "-") + "</div></div>" +
          "<div class='ap-kv wide'><div class='k'>Session / Preferred Date</div><div class='v'>" + esc(w.preferredDates || "-") + "</div></div>" +
          (w.notes ? "<div class='ap-kv wide'><div class='k'>Notes</div><div class='v'>" + esc(w.notes) + "</div></div>" : "") +
          "<div class='ap-kv'><div class='k'>Added</div><div class='v'>" + esc(fmtDmy(w.addedDate || "")) + "</div></div>" +
          "<div class='ap-kv'><div class='k'>Status</div><div class='v'>" + esc(w.status || "Waiting") + "</div></div>" +
          (w.promotedTo ? "<div class='ap-kv'><div class='k'>Promoted to</div><div class='v'>" + esc(w.promotedTo) + "</div></div>" : "") +
          "</div>";
      }
      if (wlDetailActs) {
        wlDetailActs.innerHTML = "";
        function mkBtn2(label, onClick) {
          var b = document.createElement("button"); b.className = "eikon-btn"; b.type = "button"; b.textContent = label;
          b.addEventListener("click", onClick); return b;
        }
        wlDetailActs.appendChild(mkBtn2("✏ Edit", function () {
          var fresh = loadWaitlist().filter(function (x) { return String(x.id) === String(w.id); })[0];
          openWaitlistModal({ entry: fresh || w }, function () { refresh(); });
        }));
        if (w.status === "Waiting") {
          wlDetailActs.appendChild(mkBtn2("📅 Book Appointment", async function () {
            E.modal.hide();
            openApptModal({ date: todayYmd(), fromWaitlist: w }, async function () {
              await apiUpdateWaitlistEntry(w.id, { status: "Promoted" });
              toast("Promoted", "Patient moved from waiting list to appointments.", "good");
              await refreshAll("wl-promote");
              refresh();
            });
          }));
          wlDetailActs.appendChild(mkBtn2("✕ Cancel", async function () {
            modalConfirm("Cancel Entry", "Remove from waiting list?", "Yes", "Keep").then(async function (ok) {
              if (!ok) return;
              await apiUpdateWaitlistEntry(w.id, { status: "Cancelled" });
              toast("Cancelled", "Entry cancelled.", "good");
              await refreshAll("wl-cancel"); refresh();
            });
          }));
        }
        wlDetailActs.appendChild(mkBtn2("🗑 Delete", async function () {
          modalConfirm("Delete Entry", "Permanently delete?", "Delete", "Cancel").then(async function (ok) {
            if (!ok) return;
            await apiDeleteWaitlist(w.id); state.selectedWlId = null;
            if (wlDetailCard) wlDetailCard.style.display = "none";
            toast("Deleted", "Entry deleted.", "good");
            await refreshAll("wl-delete"); refresh();
          });
        }));
      }
    }

    // ================================================================
    //  WIRE: GLOBAL FILTERS
    // ================================================================
    var gfDrEl = E.q("#ap-gf-dr", mount); var gfClEl = E.q("#ap-gf-cl", mount);
    if (gfDrEl) gfDrEl.addEventListener("change", function () {
      state.filterDoctorId = gfDrEl.value;
      state.selectedApptId = null;
      if (dayDetailCard) dayDetailCard.style.display = "none";
      refresh();
    });
    if (gfClEl) gfClEl.addEventListener("change", function () {
      state.filterClinicId = gfClEl.value;
      state.selectedApptId = null;
      if (dayDetailCard) dayDetailCard.style.display = "none";
      refresh();
    });

    // ================================================================
    //  WIRE: MONTH NAV
    // ================================================================
    var monthPrev  = E.q("#ap-month-prev",  mount);
    var monthNext  = E.q("#ap-month-next",  mount);
    var monthToday = E.q("#ap-month-today", mount);
    var monthPrint = E.q("#ap-month-print", mount);
    if (monthPrev) monthPrev.addEventListener("click", function () {
      var p = state.currentMonth.split("-"); var d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, 1); d.setMonth(d.getMonth() - 1);
      state.currentMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1); renderMonth();
    });
    if (monthNext) monthNext.addEventListener("click", function () {
      var p = state.currentMonth.split("-"); var d = new Date(parseInt(p[0]), parseInt(p[1]) - 1, 1); d.setMonth(d.getMonth() + 1);
      state.currentMonth = d.getFullYear() + "-" + pad2(d.getMonth() + 1); renderMonth();
    });
    if (monthToday) monthToday.addEventListener("click", function () {
      state.currentMonth = todayYmd().slice(0, 7); renderMonth();
    });
    if (monthPrint) monthPrint.addEventListener("click", function () {
      var ym = state.currentMonth;
      var monthAppts = loadAppts().filter(function (a) { return String(a.date || "").slice(0, 7) === ym; });
      printApptList(monthAppts, "Appointments — " + monthLabel(ym));
    });

    // ================================================================
    //  WIRE: DAY NAV
    // ================================================================
    var dayPrev  = E.q("#ap-day-prev",  mount);
    var dayNext  = E.q("#ap-day-next",  mount);
    var dayToday = E.q("#ap-day-today", mount);
    var dayPrint = E.q("#ap-day-print", mount);
    if (dayPrev) dayPrev.addEventListener("click", function () {
      state.currentDate = ymdAddDays(state.currentDate, -1); state.selectedApptId = null;
      if (dayDetailCard) dayDetailCard.style.display = "none"; renderDay();
    });
    if (dayNext) dayNext.addEventListener("click", function () {
      state.currentDate = ymdAddDays(state.currentDate, 1); state.selectedApptId = null;
      if (dayDetailCard) dayDetailCard.style.display = "none"; renderDay();
    });
    if (dayToday) dayToday.addEventListener("click", function () {
      state.currentDate = todayYmd(); state.selectedApptId = null;
      if (dayDetailCard) dayDetailCard.style.display = "none"; renderDay();
    });
    if (dayPicker) dayPicker.addEventListener("change", function () {
      if (isYmd(dayPicker.value)) { state.currentDate = dayPicker.value; state.selectedApptId = null; if (dayDetailCard) dayDetailCard.style.display = "none"; renderDay(); }
    });
    if (dayPrint) dayPrint.addEventListener("click", function () {
      var appts = apptsForDate(state.currentDate);
      var fDr = state.filterDoctorId; var fCl = state.filterClinicId;
      if (fDr) appts = appts.filter(function (a) { return a.doctorId === fDr; });
      if (fCl) appts = appts.filter(function (a) { return a.clinicId === fCl; });
      printApptList(appts, "Appointments — " + dayName(state.currentDate) + " " + fmtDmy(state.currentDate));
    });

    // ================================================================
    //  WIRE: LIST FILTERS
    // ================================================================
    var lSearch = E.q("#ap-list-search", mount); var lStatus = E.q("#ap-list-status", mount);
    var lFrom   = E.q("#ap-list-from",   mount); var lTo     = E.q("#ap-list-to",     mount);
    var lClear  = E.q("#ap-list-clear",  mount); var lPrint  = E.q("#ap-list-print",  mount);
    if (lSearch) lSearch.addEventListener("input",  function () { state.listQuery     = lSearch.value; state.selectedApptId = null; if (listDetailCard) listDetailCard.style.display = "none"; renderListTable(); });
    if (lStatus) lStatus.addEventListener("change", function () { state.filterStatus  = lStatus.value; renderListTable(); });
    if (lFrom)   lFrom.addEventListener("change",   function () { state.filterDateFrom = lFrom.value;  renderListTable(); });
    if (lTo)     lTo.addEventListener("change",     function () { state.filterDateTo   = lTo.value;   renderListTable(); });
    if (lClear)  lClear.addEventListener("click",   function () {
      state.listQuery = ""; state.filterStatus = ""; state.filterDateFrom = ""; state.filterDateTo = ""; state.selectedApptId = null;
      if (listDetailCard) listDetailCard.style.display = "none";
      if (lSearch) lSearch.value = ""; if (lStatus) lStatus.value = ""; if (lFrom) lFrom.value = ""; if (lTo) lTo.value = "";
      renderListTable();
    });
    if (lPrint) lPrint.addEventListener("click", function () { printApptList(getFilteredAppts(), "Appointments List"); });
    if (listTable) {
      listTable.querySelector("thead").addEventListener("click", function (ev) {
        var el = ev.target.closest("[data-key]"); if (!el) return;
        var key = el.getAttribute("data-key");
        if (state.listSort.key === key) state.listSort.dir = (state.listSort.dir === "asc" ? "desc" : "asc");
        else { state.listSort.key = key; state.listSort.dir = "asc"; }
        state.selectedApptId = null; if (listDetailCard) listDetailCard.style.display = "none";
        renderListTable();
      });
    }

    // ================================================================
    //  WIRE: WAITLIST
    // ================================================================
    var wlSearch = E.q("#ap-wl-search", mount); var wlPrint = E.q("#ap-wl-print", mount);
    var wlTable  = E.q("#ap-wl-table",  mount);
    if (wlSearch) wlSearch.addEventListener("input",  function () { state.wlQuery = wlSearch.value; state.selectedWlId = null; if (wlDetailCard) wlDetailCard.style.display = "none"; renderWlTable(); });
    if (wlPrint)  wlPrint.addEventListener("click",   function () { printWaitlist(getFilteredWaitlist()); });
    if (wlTable) {
      wlTable.querySelector("thead").addEventListener("click", function (ev) {
        var el = ev.target.closest("[data-key]"); if (!el) return;
        var key = el.getAttribute("data-key");
        if (state.wlSort.key === key) state.wlSort.dir = (state.wlSort.dir === "asc" ? "desc" : "asc");
        else { state.wlSort.key = key; state.wlSort.dir = "asc"; }
        state.selectedWlId = null; if (wlDetailCard) wlDetailCard.style.display = "none"; renderWlTable();
      });
    }

    // ================================================================
    //  WIRE: HEADER BUTTONS
    // ================================================================
    var btnNewAppt  = E.q("#ap-new-appt",    mount);
    var btnNewWl    = E.q("#ap-btn-waitlist", mount);
    var settingsBtn = E.q("#ap-settings-btn", mount);
    var settingsMenu= E.q("#ap-settings-menu",mount);

    if (btnNewAppt) btnNewAppt.addEventListener("click", function () {
      openApptModal({ date: state.currentDate }, function () { refresh(); });
    });
    if (btnNewWl) btnNewWl.addEventListener("click", function () {
      openWaitlistModal({}, function () { refresh(); });
    });
    if (settingsBtn && settingsMenu) {
      settingsBtn.addEventListener("click", function (ev) { ev.stopPropagation(); settingsMenu.style.display = (settingsMenu.style.display === "none" ? "block" : "none"); });
      document.addEventListener("click", function (ev) { if (settingsMenu && !settingsMenu.contains(ev.target) && ev.target !== settingsBtn) settingsMenu.style.display = "none"; });
    }
    var btnDrs = E.q("#ap-manage-doctors", mount);
    var btnCls = E.q("#ap-manage-clinics", mount);
    var btnSch = E.q("#ap-manage-scheds",  mount);
    if (btnDrs) btnDrs.addEventListener("click", function () { if (settingsMenu) settingsMenu.style.display = "none"; openDoctorsModal(function () { refresh(); }); });
    if (btnCls) btnCls.addEventListener("click", function () { if (settingsMenu) settingsMenu.style.display = "none"; openClinicsModal(function () { refresh(); }); });
    if (btnSch) btnSch.addEventListener("click", function () { if (settingsMenu) settingsMenu.style.display = "none"; openSchedulesModal(function () { refresh(); }); });

    // ================================================================
    //  INITIAL RENDER
    // ================================================================
    apptLog("render: initial view="+state.view);
    if (state.view === "month")    renderMonth();
    else if (state.view === "day") renderDay();
    else if (state.view === "list") renderListTable();
    else if (state.view === "waitlist") renderWlTable();
    else renderMonth();

    updateWlBadge();

    if (!loadDoctors().length && !loadClinics().length) {
      setTimeout(function () {
        toast("Setup needed", "Add doctors and clinics via ⚙ Settings to get started.", "", 6000);
      }, 1200);
    }
  }

  // ============================================================
  //  REGISTER MODULE
  // ============================================================
  E.registerModule({
    id:    "appointments",
    title: "Appointments",
    order: 215,
    icon:  "📅",
    render: render
  });

})();
