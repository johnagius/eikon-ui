/* ============================================================
   EIKON — Today  (modules.today.js)
   The first screen of the reimagined UI, built on ONE request: GET /today.
   - Opens on what needs the pharmacy now, in the order it needs it
   - One button per row; the fridge is logged inline, nothing opens
   - Never says "Saved" before the server says so; says plainly when offline
   - The old dashboard stays in Settings › Help (#dashboard)
   Enabled as the opening screen with ?ui=2 (remembered) or #today any time.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  var state = { data: null, loadedAt: null, error: "", errorKind: "", timer: null, mount: null, busy: {}, search: "",
    tn: null, noteDraft: {}, noteMsg: {} }; // tn: temperature entries (by "day|device") behind a reading outside its limits, null when not read

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function hm(d) { d = d || new Date(); return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); } // device clock: only for the time written into a cleaning line, as before
  function mt(d) { return E.maltaHm ? E.maltaHm(d || new Date()) : hm(d); } // every clock SHOWN on Today is Malta time, like the header
  function todayYmd() { return (state.data && state.data.date) || (E.maltaYmd ? E.maltaYmd() : ""); }
  function initials(name) {
    var p = String(name || "").trim().split(/\s+/).filter(Boolean);
    return ((p[0] || "?")[0] + (p[1] ? p[1][0] : "")).toUpperCase();
  }
  function hue(name) { var h = 0; for (var i = 0; i < String(name).length; i++) h = (h * 31 + String(name).charCodeAt(i)) % 360; return h; }
  function dayWord(ymd) {
    if (!ymd) return "";
    var today = todayYmd();
    if (!today) { var t = new Date(); today = t.getFullYear() + "-" + String(t.getMonth() + 1).padStart(2, "0") + "-" + String(t.getDate()).padStart(2, "0"); }
    if (ymd === today) return "today";
    var d = new Date(ymd + "T12:00:00"); if (!isFinite(d.getTime())) return ymd;
    var diff = Math.round((d - new Date(today + "T12:00:00")) / 86400000);
    if (diff === 1) return "tomorrow"; if (diff === -1) return "yesterday";
    if (diff > 1 && diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
    if (diff < 0) return Math.abs(diff) + " days ago";
    return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  }
  function longDate(ymd) {
    ymd = ymd || todayYmd();
    var d = ymd ? new Date(ymd + "T12:00:00") : new Date();
    return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
  }
  function sentence(t) { t = String(t || "").trim(); if (!t) return ""; if (/^HTTP \d+$/.test(t)) t = "The server answered " + t.slice(5); return /[.!?]$/.test(t) ? t : t + "."; }
  // The full question fits a desktop box; on a phone it was cut ("…A customer, an orde").
  var NARROW = "(max-width:420px)";
  function placeholder() {
    var narrow = false; try { narrow = window.matchMedia(NARROW).matches; } catch (e) {}
    return narrow ? "Customer, order or register…" : "What do you need? A customer, an order, a register…";
  }
  function plural(n, one, many) { return n + " " + (n === 1 ? one : (many || one + "s")); }

  // ---------- temperature notes: shared by Today and the Temperature register (modules.tempreg.js) ----------
  // Lives here because Today loads first; Temperature uses E.tempNote at run time.
  //
  // ===== WORDING FOR THE PHARMACIST TO APPROVE (the only place it is written; change it here) =====
  // ask/picks: an out-of-limits reading's "what was done" note. late*: a past day logged late; the note is stored as
  // latePrefix + the reason, so an inspector reading the register sees it was written afterwards.
  var TEMP_WORDS = {
    ask: "Say what was done",
    picks: ["Stock moved to the other fridge", "Door left open, closed, re-checked", "Engineer called", "Re-checked within the hour, back in range"],
    lateAsk: "Why is it logged late?",
    latePicks: ["Reading was on paper, entered now", "Read from the data logger"],
    latePrefix: "Logged late: "
  };
  // ===== END OF WORDING FOR SIGN-OFF =====
  E.tempNote = (function () {
    var N = { words: TEMP_WORDS, seq: 0 };
    function ymOf(d) { return String(d || "").slice(0, 7); }
    N.css = function () {
      if (document.getElementById("eikon-tempnote-css")) return;
      var st = document.createElement("style"); st.id = "eikon-tempnote-css";
      st.textContent =
        ".tnote{display:flex;flex-direction:column;gap:8px;margin:8px 0 2px}.tnote label{font-size:13px;font-weight:700;color:var(--text)}" +
        ".tnote-picks{display:flex;flex-wrap:wrap;gap:6px}.tnote-picks button{font:inherit;font-size:12.5px;font-weight:600;min-height:32px;padding:4px 11px;border-radius:16px;border:1px solid var(--border);background:var(--panel);color:var(--text);cursor:pointer;text-align:left}" +
        ".tnote textarea,.tnote input{font:inherit;font-size:14px;border:1px solid var(--border);border-radius:9px;background:var(--bg);color:var(--text);padding:8px 10px;box-sizing:border-box;width:100%}" +
        ".tnote textarea{min-height:56px;resize:vertical}.tnote textarea:focus,.tnote input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px rgba(10,143,106,.18)}" +
        ".tnote-mm{display:flex;gap:10px}.tnote-mm>div{flex:1 1 0;min-width:0;display:flex;flex-direction:column;gap:4px}" +
        ".tnote-msg{font-size:13px;color:var(--danger);font-weight:600}.tnote-msg:empty{display:none}" +
        ".tnote-go{display:flex;gap:8px;flex-wrap:wrap}.tnote-go .tnote-btn{font:inherit;font-size:13.5px;font-weight:600;min-height:36px;padding:0 16px;border-radius:9px;border:1px solid var(--accent);background:var(--accent);color:#fff;cursor:pointer}" +
        ".tnote-go .tnote-btn.sec{background:var(--panel);color:var(--text);border-color:var(--border)}.tnote-go .tnote-btn:disabled{opacity:.55;cursor:default}"; // "-btn" + .p: dark mode gives it dark text (app.css)
      document.head.appendChild(st);
    };
    function pickButtons(list, label) {
      return '<div class="tnote-picks" role="group" aria-label="' + esc(label) + '">' + list.map(function (p) { return '<button type="button" data-pick="' + esc(p) + '">' + esc(p) + "</button>"; }).join("") + "</div>";
    }
    // A note form. o: { key, draft, msg, existing (the saved note, to change it), cancel (show a Cancel button) }
    N.noteForm = function (o) {
      var id = "tnote-" + (++N.seq), had = String(o.existing || "").trim();
      return '<form class="tnote" data-tnote="' + esc(o.key) + '" novalidate><label for="' + id + '">' + esc(had ? "Change the note" : TEMP_WORDS.ask) + "</label>" +
        pickButtons(TEMP_WORDS.picks, "Quick picks for the note") +
        '<textarea id="' + id + '" name="note" data-note rows="2" aria-describedby="' + id + '-m">' + esc(o.draft != null ? o.draft : had) + "</textarea>" +
        '<div class="tnote-msg" id="' + id + '-m" role="alert">' + esc(o.msg || "") + "</div>" +
        '<div class="tnote-go"><button type="submit" class="tnote-btn p">Save the note</button>' + (o.cancel ? '<button type="button" class="tnote-btn sec" data-cancel>Cancel</button>' : "") + "</div></form>";
    };
    // A past day that was never logged. o: { key, draft: { min, max, reason }, msg }
    N.lateForm = function (o) {
      var id = "tlate-" + (++N.seq), d = o.draft || {};
      return '<form class="tnote" data-tlate="' + esc(o.key) + '" novalidate>' +
        '<div class="tnote-mm"><div><label for="' + id + '-a">Min °C</label><input id="' + id + '-a" name="min" inputmode="decimal" autocomplete="off" value="' + esc(d.min || "") + '"></div>' +
        '<div><label for="' + id + '-b">Max °C</label><input id="' + id + '-b" name="max" inputmode="decimal" autocomplete="off" value="' + esc(d.max || "") + '"></div></div>' +
        '<label for="' + id + '">' + esc(TEMP_WORDS.lateAsk) + " (required)</label>" + pickButtons(TEMP_WORDS.latePicks, "Quick picks for the reason") +
        '<textarea id="' + id + '" name="reason" data-note rows="2" aria-required="true" aria-describedby="' + id + '-m">' + esc(d.reason || "") + "</textarea>" +
        '<div class="tnote-msg" id="' + id + '-m" role="alert">' + esc(o.msg || "") + "</div>" +
        '<div class="tnote-go"><button type="submit" class="tnote-btn p">Log this day</button><button type="button" class="tnote-btn sec" data-cancel>Cancel</button></div></form>';
    };
    // Quick picks fill the box (added after what is there, so two can be combined; the text stays editable).
    // h: { onDraft(values) on every change, onSubmit(form, values) on Save, onCancel() }
    N.wire = function (form, h) {
      var ta = form.querySelector("textarea");
      var vals = function () { var o = {}; form.querySelectorAll("textarea,input").forEach(function (el) { o[el.name] = el.value; }); return o; };
      form.querySelectorAll("[data-pick]").forEach(function (b) {
        b.addEventListener("click", function () {
          var p = b.getAttribute("data-pick"), cur = String(ta.value || "").trim();
          ta.value = cur ? (/[.;,:]$/.test(cur) ? cur + " " : cur + "; ") + p : p;
          if (h.onDraft) h.onDraft(vals());
          ta.focus(); try { ta.setSelectionRange(ta.value.length, ta.value.length); } catch (e) {}
        });
      });
      form.querySelectorAll("textarea,input").forEach(function (el) { el.addEventListener("input", function () { if (h.onDraft) h.onDraft(vals()); }); });
      form.addEventListener("submit", function (ev) { ev.preventDefault(); if (h.onSubmit) h.onSubmit(form, vals()); });
      var c = form.querySelector("[data-cancel]"); if (c) c.addEventListener("click", function () { if (h.onCancel) h.onCancel(); });
    };
    N.setMsg = function (form, msg) { var m = form && form.querySelector(".tnote-msg"); if (m) m.textContent = msg || ""; };
    N.busy = function (form, on) { if (form) form.querySelectorAll("button,textarea,input").forEach(function (el) { el.disabled = !!on; }); };
    // The entry for one device and day as the server has it now (null when there is none).
    N.read = async function (deviceId, day) {
      var r = await E.apiFetch("/temperature/entries?month=" + encodeURIComponent(ymOf(day)), { method: "GET" });
      if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the register");
      return ((r.entries || []).find(function (e) { return Number(e.device_id) === Number(deviceId) && e.entry_date === day; })) || null;
    };
    // Every entry of these months, by "day|device".
    N.readMonths = async function (months) {
      var uniq = months.filter(function (m, i) { return m && months.indexOf(m) === i; }), out = {};
      var all = await Promise.all(uniq.map(function (m) { return E.apiFetch("/temperature/entries?month=" + encodeURIComponent(m), { method: "GET" }); }));
      all.forEach(function (r) { if (!r || !r.ok) throw new Error((r && r.error) || "Could not read the register"); (r.entries || []).forEach(function (e) { out[e.entry_date + "|" + e.device_id] = e; }); });
      return out;
    };
    function fmtT(v) { return String(Math.round(Number(v) * 10) / 10); }
    function nowText(cur) {
      return "now " + fmtT(cur.min_temp) + " to " + fmtT(cur.max_temp) + " °C" + (String(cur.notes || "").trim() ? ', note "' + String(cur.notes).trim() + '"' : ", no note");
    }
    // Save the note on a reading. The entry is read again and sent back WHOLE, exactly as the classic Temperature
    // screen sends it (device_id, entry_date, min_temp, max_temp, notes), with only the note changed: the readings are
    // never touched. If the reading changed since it was shown (another device, the classic screen), nothing is sent.
    // shown: the entry as it was on screen. Returns { ok, entry }, { error }, or { stale, current, message }. Throws
    // when the server cannot be reached (the caller shows E.saveFailText).
    N.saveNote = async function (shown, text) {
      text = String(text || "").trim();
      if (!text) return { error: "Write what was done. Nothing was saved." };
      var cur = await N.read(shown.device_id, shown.entry_date);
      if (!cur) return { stale: true, current: null, message: "This reading is no longer in the register (it may have been deleted). Nothing was saved." };
      var same = Number(cur.min_temp) === Number(shown.min_temp) && Number(cur.max_temp) === Number(shown.max_temp) &&
        String(cur.notes || "").trim() === String(shown.notes || "").trim() && (shown.updated_at == null || cur.updated_at == null || cur.updated_at === shown.updated_at);
      if (!same) return { stale: true, current: cur, message: "Someone changed this reading while you were writing: " + nowText(cur) + '. Yours was: "' + text + '". Nothing was saved; check it and save again.' };
      var body = { device_id: Number(cur.device_id), entry_date: cur.entry_date, min_temp: Number(cur.min_temp), max_temp: Number(cur.max_temp), notes: text };
      var r = await E.apiFetch("/temperature/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      return { ok: true, entry: Object.assign({}, cur, { notes: text }) };
    };
    // Minimum and maximum as typed (a decimal comma is read as a point), checked as Today checks a reading.
    N.parseReading = function (minS, maxS) {
      minS = String(minS || "").trim().replace(",", "."); maxS = String(maxS || "").trim().replace(",", ".");
      if (!minS || !maxS) return { error: "Enter both min and max. Nothing was saved." };
      var a = Number(minS), b = Number(maxS);
      if (!isFinite(a) || !isFinite(b)) return { error: "Min and max must be numbers. Nothing was saved." };
      a = Math.round(a * 10) / 10; b = Math.round(b * 10) / 10;
      if (a > b) return { error: "Min is greater than max. Nothing was saved." };
      if (a < -40 || b > 60) return { error: "That reading is outside -40 to 60 °C. Nothing was saved." };
      return { min: a, max: b };
    };
    // Log a past day that has no reading, with the reason in the note. Never today or a future day (today is logged
    // on Today), and never over a reading that arrived meanwhile.
    N.logLate = async function (deviceId, day, v) {
      var today = E.maltaYmd ? E.maltaYmd() : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !today || day >= today) return { error: "Only a past day can be logged late. Today's reading is logged on Today." };
      var p = N.parseReading(v.min, v.max); if (p.error) return p;
      var reason = String(v.reason || "").trim();
      if (!reason) return { error: "Say why it is logged late. Nothing was saved." };
      var cur = await N.read(deviceId, day);
      if (cur) return { stale: true, current: cur, message: "This day was logged while you were writing: " + nowText(cur) + ". Nothing was saved." };
      var body = { device_id: Number(deviceId), entry_date: day, min_temp: p.min, max_temp: p.max, notes: TEMP_WORDS.latePrefix + reason };
      var r = await E.apiFetch("/temperature/entries", { method: "POST", body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      return { ok: true, min: p.min, max: p.max };
    };
    return N;
  })();

  // ---------- styles (scoped) ----------
  function injectCss() {
    if (document.getElementById("eikon-today-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-today-css";
    st.textContent =
      ".tdy{max-width:1180px;margin:0 auto;display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:0 22px;align-content:start}" +
      ".tdy-find{grid-column:1;position:relative;min-width:0}.tdy-find .tdy-results{position:absolute;left:0;right:0;top:100%;z-index:40;box-shadow:0 10px 30px rgba(0,0,0,.14)}" +
      ".tdy-search{grid-column:1;display:flex;align-items:center;gap:12px;background:var(--panel2);border:1px solid var(--border);border-radius:14px;padding:0 14px;height:50px}" +
      ".tdy-search input{flex:1;border:0;outline:0;background:transparent;color:var(--text);font-size:16px;min-width:0}" +
      ".tdy-search input::placeholder{color:var(--muted)}.tdy-search:focus-within{border-color:var(--accent);box-shadow:0 0 0 3px rgba(7,122,91,.16)}" +
      ".tdy-search .hint{font-size:11px;color:var(--muted);background:rgba(127,127,127,.12);padding:3px 8px;border-radius:6px;white-space:nowrap}" +
      ".tdy-date{grid-column:2;text-align:right;align-self:center}.tdy-date b{display:block;font-size:17px;font-weight:700;letter-spacing:-.01em}.tdy-date span{font-size:13px;color:var(--muted)}" +
      "@media (max-width:980px){.tdy-date{grid-column:1;text-align:left;margin-top:8px}}" +
      ".tdy-head{grid-column:1;margin:18px 0 4px}.tdy-head h1{font-size:26px;letter-spacing:-.025em;margin:0 0 6px;line-height:1.1;font-weight:800}.tdy-head h1 span{color:var(--muted);font-weight:500}" +
      ".tdy-legend{display:flex;gap:16px;font-size:12.5px;color:var(--muted);flex-wrap:wrap}.tdy-legend i{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;vertical-align:1px}" +
      ".tdy-col{grid-column:1;min-width:0}.tdy-side{grid-column:2;grid-row:2/4;display:flex;flex-direction:column;gap:12px;margin-top:18px}" +
      ".tdy-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:14px 0 7px;display:flex;align-items:center;gap:8px}.tdy-lab b{color:var(--text);font-size:11px}.tdy-lab a{margin-left:auto;color:var(--accent);font-weight:600;text-transform:none;letter-spacing:0;font-size:12.5px;cursor:pointer}" +
      ".tdy-list{background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".tdy-row{display:flex;align-items:center;gap:12px;padding:11px 14px 11px 0;border-top:1px solid var(--border);border-left:3px solid transparent}.tdy-row:first-child{border-top:0}html[data-ui2] .tdy .tdy-row[tabindex]:focus-visible{outline-offset:-3px}" + // the next check, focused after Log or Done, shows inside the card
      ".tdy-row.red{border-left-color:var(--danger)}.tdy-row.amb{border-left-color:#C98A12}.tdy-row.grn{border-left-color:var(--ok)}.tdy-row.blu{border-left-color:var(--accent)}" +
      ".tdy-av{width:36px;height:36px;border-radius:50%;flex:none;margin-left:12px;display:grid;place-items:center;font-weight:700;font-size:12.5px;color:#fff}.tdy-av.sq{border-radius:9px}.tdy-av.nt{background:rgba(120,120,128,.12);color:#3A3A3C;font-size:14px}.tdy-av.tm{background:rgba(10,143,106,.10);color:#0A7A5B}" +
      ".tdy-t{flex:1;min-width:0}.tdy-t b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tdy-t span{display:block;font-size:12.5px;color:var(--muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.tdy-t span.u{color:var(--danger)}.tdy-t span.w{color:var(--warn,#A06A0E);font-weight:600;white-space:normal}" +
      ".tdy-warn{background:rgba(201,138,18,.12);border:1px solid rgba(201,138,18,.45);border-left:4px solid #C98A12;border-radius:12px;padding:10px 14px;margin:0 0 10px;font-size:13.5px;line-height:1.45;color:var(--text)}.tdy-warn p{margin:0}.tdy-warn p+p{margin-top:6px}.tdy-warn b{color:var(--warn,#A06A0E)}.tdy-warn a{color:var(--accent);font-weight:600;white-space:nowrap}" +
      ".tdy-pill{font-size:12px;font-weight:600;padding:4px 10px;border-radius:999px;white-space:nowrap}.tdy-pill.red{background:rgba(191,59,46,.14);color:var(--danger)}.tdy-pill.amb{background:rgba(201,138,18,.16);color:var(--warn,#A06A0E)}.tdy-pill.grn{background:rgba(28,138,91,.16);color:var(--ok)}.tdy-pill.blu{background:rgba(10,143,106,.14);color:var(--accent)}.tdy-pill.gry{background:rgba(127,127,127,.14);color:var(--muted)}" +
      ".tdy-btn{font-size:13px;font-weight:600;padding:8px 14px;border-radius:9px;border:1px solid var(--border);background:var(--panel);white-space:nowrap;color:var(--text);cursor:pointer}.tdy-btn:disabled{opacity:.55;cursor:default}" +
      ".tdy-btn.p{background:var(--accent);border-color:var(--accent);color:#fff}.tdy-btn.g{background:var(--ok);border-color:var(--ok);color:#fff}" +
      ".tdy-inl{display:flex;align-items:center;gap:6px}.tdy-inl input{width:62px;height:32px;border:1px solid var(--border);border-radius:8px;background:var(--bg);padding:0 8px;color:var(--text);font-size:13px;font-variant-numeric:tabular-nums}.tdy-inl input:focus{outline:0;border-color:var(--accent);box-shadow:0 0 0 3px var(--shadow,rgba(10,143,106,.18))}.tdy-inl small{font-size:11px;color:var(--muted)}" +
      ".tdy-tile{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 16px}.tdy-tile .tdy-lab{margin:0 0 8px}.tdy-tile .big{font-size:24px;font-weight:800;letter-spacing:-.02em;line-height:1.1;font-variant-numeric:tabular-nums}.tdy-tile .big span{font-size:14px;font-weight:600;color:var(--muted);letter-spacing:0;margin-left:6px}.tdy-tile p{margin:6px 0 0;font-size:12.5px;color:var(--muted);line-height:1.45}.tdy-tile p b{color:var(--text);font-weight:600}.tdy-tile .tdy-btn{margin-top:10px}" +
      ".tdy-chips{display:flex;gap:6px;flex-wrap:wrap;margin-top:8px}.tdy-chips i{font-style:normal;height:26px;padding:0 10px;border-radius:6px;background:rgba(127,127,127,.12);display:inline-flex;align-items:center;font-size:11.5px;font-weight:600;color:var(--muted)}.tdy-chips i.on{background:rgba(28,138,91,.16);color:var(--ok)}" +
      ".tdy-foot{grid-column:1/-1;display:flex;gap:16px;align-items:center;font-size:12.5px;color:var(--muted);margin-top:18px;padding-top:10px;border-top:1px solid var(--border)}.tdy-foot a{color:var(--accent);cursor:pointer;font-weight:600}.tdy-foot .right{margin-left:auto}" +
      ".tdy-setup{background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:12px 16px;margin:14px 0 0}.tdy-setup h2{font-size:15px;font-weight:700;margin:0 0 2px}.tdy-setup p{margin:0 0 6px;font-size:13px;color:var(--muted)}" +
      ".tdy-setup ul{list-style:none;margin:0;padding:0}.tdy-setup li{display:flex;align-items:center;justify-content:space-between;gap:12px;min-height:44px;border-top:.5px solid var(--border);font-size:14.5px}.tdy-setup li:first-child{border-top:0}" +
      ".tdy-quiet{background:var(--panel2);border:1px dashed var(--border);border-radius:12px;padding:22px;color:var(--muted);font-size:14px}" +
      ".tdy-off{max-width:1180px;margin:0 auto 10px;box-sizing:border-box;display:flex;align-items:center;gap:12px;flex-wrap:wrap;background:rgba(201,138,18,.14);border:1px solid rgba(201,138,18,.35);color:var(--warn,#A06A0E);border-radius:10px;padding:8px 12px;font-size:13px}.tdy-off span{flex:1 1 220px}.tdy-off .tdy-btn{padding:6px 12px}" +
      ".tdy-sr{position:absolute;left:-9999px}" +
      ".tdy-err{display:block;font-size:12.5px;font-weight:600;color:var(--danger);white-space:normal;margin-top:2px}.tdy-err:empty{display:none}.tdy-inl input[aria-invalid=true]{border-color:var(--danger);box-shadow:0 0 0 3px rgba(191,59,46,.16)}" +
      ".tdy-note{padding:2px 14px 12px 63px;border-left:3px solid var(--danger)}.tdy-warn .tnote{margin-top:6px}.tdy-row:focus{outline:2px solid var(--accent);outline-offset:-2px}" +
      "@media (max-width:980px){.tdy{grid-template-columns:minmax(0,1fr)}.tdy-side{grid-column:1;grid-row:auto}.tdy-date{grid-column:1;grid-row:auto}}" +
      "@media (max-width:600px){.tdy-note{padding:2px 12px 12px}.tdy-off{margin:0 16px 10px}.tdy{padding:0 16px}.tdy-date{order:-1;margin:0 0 10px}.tdy-head h1{font-size:28px}.tdy-search .hint{display:none}.tdy-row{flex-wrap:wrap;row-gap:8px}.tdy-t{flex:1 1 calc(100% - 90px)}.tdy-t+*{margin-left:60px}.tdy-row>.tdy-btn{margin-left:auto}.tdy-inl{flex:1 1 0;min-width:0}.tdy-inl:empty{display:none}.tdy-inl input{flex:1 1 0;width:0;min-width:0;height:44px;font-size:16px}.tdy-row>.tdy-btn{min-height:44px}}";
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
      state.data = r; state.loadedAt = new Date(); state.error = ""; state.errorKind = "";
      await loadNotes(r);
    } catch (e) {
      // One sentence, ending in a full stop, whatever the server said ("Unauthorized" → "Not signed in.").
      state.errorKind = (e && e.status === 401) ? "auth" : (e && e.network) ? "network" : "other";
      state.error = state.errorKind === "auth" ? "Not signed in." : state.errorKind === "network" ? "Can't reach the server." : sentence(String(e && (e.message || e) || "Could not load Today"));
      // 401: core has put sign-in on screen (apiFetch → handleSessionExpired); do not draw over it.
      if (state.errorKind === "auth" && !(state.mount && document.body.contains(state.mount))) return;
    }
    if (opts.background && busyTyping()) return; // the minute refresh never wipes a reading or a name being typed; the next one shows it
    render();
  }
  // A reading outside its limits needs a note saying what was done. GET /today does not send notes, so the month(s) of
  // those readings are read too, only on a day that has one (no extra request on a normal day). When the read fails the
  // rows show as before, with the way to the register, and are not counted.
  function excursions(d) {
    var out = [], t = (d && d.date) || todayYmd(), y = yesterdayYmd();
    ((d && d.before_opening) || []).forEach(function (r) {
      if (r.kind !== "temperature") return;
      if (r.status === "done" && r.out_of_range && t) out.push({ key: t + "|" + r.device_id, day: t, row: r, when: "today" });
      if (yesterdayOut(r) && y) out.push({ key: y + "|" + r.device_id, day: y, row: r, when: "yesterday" });
    });
    return out;
  }
  async function loadNotes(d) {
    var ex = excursions(d);
    if (!ex.length || !E.tempNote) { state.tn = ex.length ? null : {}; return; }
    try { state.tn = await E.tempNote.readMonths(ex.map(function (x) { return x.day.slice(0, 7); })); }
    catch (e) { state.tn = null; }
  }
  // The excursions with no note yet (only those whose entry was read: each counts as a check still to do).
  function missingNotes(d) {
    if (!state.tn) return [];
    return excursions(d).filter(function (x) { var e = state.tn[x.key]; return e && !String(e.notes || "").trim(); });
  }
  function noteOf(key) { var e = state.tn && state.tn[key]; return e ? String(e.notes || "").trim() : ""; }
  E.__todayRefresh = function () { return load({ silent: true, background: true }); }; // the minute refresh, callable by the tests
  function busyTyping() {
    var m = state.mount; if (!m) return false;
    var ae = document.activeElement;
    if (ae && m.contains(ae) && /^(INPUT|TEXTAREA|SELECT)$/.test(ae.tagName)) return true;
    return Array.prototype.some.call(m.querySelectorAll("input[data-min],input[data-max],input[data-cleaner],[data-tnote] textarea"), function (i) { return String(i.value || "").trim() !== "" && i.value !== i.defaultValue; });
  }

  // Repeats coming due (backlog 3 item 7): what "due" means is decided in eikon.repeatdue.js (RULES, awaiting the
  // pharmacist); /today sends the lines (servers before 2026-11-03-batch-3-repeatdue send none: no card).
  var REP_MAX = 6;
  function repeatsCard(d) {
    var RD = E.repeatDue; if (!RD || !d.repeats || !Array.isArray(d.repeats.entries)) return "";
    var b = RD.buckets(d.repeats.entries, todayYmd() || undefined);
    var items = b.due.concat(b.runout), n = items.length;
    if (!n) return "";
    var tell = typeof E.tellCustomer === "function";
    var h = '<div class="tdy-lab" id="tdy-rep">Repeats <b>' + n + '</b><a data-open="#repreg">All repeats ›</a></div><div class="tdy-list" aria-labelledby="tdy-rep">';
    h += items.slice(0, REP_MAX).map(function (x, i) {
      var e = x.e, s = x.s, cls = s.kind === "overdue" ? "red" : s.kind === "due" ? "amb" : "blu";
      var pill = '<span class="tdy-pill ' + (s.kind === "overdue" ? "red" : s.kind === "due" ? "amb" : "gry") + '">' + esc(RD.words(s)) + "</span>";
      return '<div class="tdy-row ' + cls + '" data-kind="repeat">' +
        '<div class="tdy-av" style="background:hsl(' + hue(e.client_name) + ',45%,32%)">' + esc(initials(e.client_name)) + '</div>' +
        '<div class="tdy-t"><b>' + esc(e.client_name) + '</b><span>' + esc(e.medicine_name_dose || "") + (s.kind === "runout" ? " · ask the doctor for a new one" : " · every " + esc(RD.every(e)) + " days") + '</span></div>' +
        pill + (tell ? '<button class="tdy-btn" data-rep-tell="' + i + '">Tell</button>' : "") + '<button class="tdy-btn" data-rep-open="' + esc(e.client_id || "") + '" aria-label="Open ' + esc(e.client_name) + "'s prescriptions\">Open</button></div>";
    }).join("");
    if (n > REP_MAX) h += '<div class="tdy-row"><div class="tdy-t" style="margin-left:14px"><span>and ' + (n - REP_MAX) + ' more</span></div><button class="tdy-btn" data-open="#repreg">See all</button></div>';
    state.repItems = items.slice(0, REP_MAX);
    return h + "</div>";
  }

  // ---------- actions ----------
  // A mistake is said under the row it belongs to (and read out), the field is marked and focused, and what was typed stays.
  function rowError(rowEl, msg, bad) {
    var t = rowEl.querySelector(".tdy-t"), e = rowEl.querySelector(".tdy-err");
    if (!e && t) { e = document.createElement("span"); e.className = "tdy-err"; e.setAttribute("role", "alert"); e.id = "tdy-err-" + (rowEl.getAttribute("data-device") || rowEl.getAttribute("data-kind") || "x"); t.appendChild(e); }
    rowEl.querySelectorAll("input").forEach(function (i) { i.removeAttribute("aria-invalid"); if (e && i.getAttribute("aria-describedby") === e.id) i.removeAttribute("aria-describedby"); });
    if (e) e.textContent = msg || "";
    (bad || []).forEach(function (i) { if (!i) return; i.setAttribute("aria-invalid", "true"); if (e) i.setAttribute("aria-describedby", e.id); });
    if (bad && bad[0]) try { bad[0].focus(); bad[0].select(); } catch (x) {}
  }
  // The cleaner's name is remembered on this device for this pharmacy: next week it is one tap (it is usually the same person).
  function cleanerKey() { var u = E.state.user || {}; return "eikon_tdy_cleaner:" + (u.location_id || ""); }
  function lastCleaner() { try { return localStorage.getItem(cleanerKey()) || ""; } catch (e) { return ""; } }
  async function logTemperature(row, rowEl) {
    var minEl = rowEl.querySelector("[data-min]"), maxEl = rowEl.querySelector("[data-max]");
    // Some keyboards type a decimal comma ("3,4"): read it as 3.4.
    var minS = (minEl.value || "").trim().replace(",", "."), maxS = (maxEl.value || "").trim().replace(",", ".");
    var name = devName(row);
    if (!minS || !maxS) return rowError(rowEl, "Write both the lowest and the highest reading, then press Log.", [!minS ? minEl : null, !maxS ? maxEl : null].filter(Boolean));
    var minV = Number(minS), maxV = Number(maxS);
    if (!isFinite(minV) || !isFinite(maxV)) return rowError(rowEl, "Write the readings as numbers, like 3.4.", [!isFinite(minV) ? minEl : null, !isFinite(maxV) ? maxEl : null].filter(Boolean));
    minV = Math.round(minV * 10) / 10; maxV = Math.round(maxV * 10) / 10; // one decimal, as the Temperature register stores it
    if (minV > maxV) return rowError(rowEl, "The lowest reading is higher than the highest. Check which is which.", [minEl, maxEl]);
    if (minV < -40 || maxV > 60) return rowError(rowEl, "Check the reading: it is outside -40 to 60 °C.", [minV < -40 ? minEl : maxEl]);
    rowError(rowEl, "");
    var key = "temp" + row.device_id;
    if (state.busy[key]) return;
    state.busy[key] = true; setRowBusy(rowEl, true);
    try {
      var body = Object.assign({}, row.action.body, { min_temp: minV, max_temp: maxV, notes: "" });
      var r = await E.apiFetch(row.action.path, { method: row.action.method, body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      var out = (row.limits && ((row.limits.min != null && minV < row.limits.min) || (row.limits.max != null && maxV > row.limits.max)));
      E.toast(name + " logged " + minV + " to " + maxV + " °C · " + mt() + (out ? " · outside the limits: say what was done below" : ""), out ? "warn" : "success");
      await load({ silent: true });
      // Outside the limits: the note box is next, so the cursor goes there (not lost to the page); otherwise the next check.
      var nf = out && state.mount && state.mount.querySelector('[data-tnote="' + todayYmd() + "|" + row.device_id + '"] textarea');
      if (nf) nf.focus(); else if (E.focusAfter) E.focusAfter(nextCheck);
    } catch (e) {
      setRowBusy(rowEl, false); rowError(rowEl, E.saveFailText ? E.saveFailText(e) : "Not saved: " + String(e && (e.message || e) || "error")); // the readings stay typed
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
        inl.innerHTML = '<small>cleaned by</small><input data-cleaner placeholder="Name" style="width:120px" aria-label="Cleaned by" autocomplete="off" enterkeyhint="done">';
        var ci = inl.querySelector("[data-cleaner]");
        ci.defaultValue = lastCleaner(); // last time's cleaner (a default, so the minute refresh still runs while it sits there untouched): Enter (or Done now) records it; typing replaces it
        ci.addEventListener("keydown", function (ev) { if (ev.key === "Enter") { ev.preventDefault(); markCleaning(row, rowEl); } });
        ci.focus(); try { ci.select(); } catch (x) {}
        return;
      }
      return rowError(rowEl, "Write who did the cleaning, then press Done now.", [rowEl.querySelector("[data-cleaner]")]);
    }
    rowError(rowEl, "");
    state.busy[key] = true; setRowBusy(rowEl, true);
    try {
      var d = new Date();
      var body = Object.assign({}, row.action.body, { time_in: hm(d), time_out: "", cleaner_name: who, staff_name: user.full_name || "", notes: "" });
      var r = await E.apiFetch(row.action.path, { method: row.action.method, body: JSON.stringify(body) });
      if (!r || !r.ok) throw new Error((r && r.error) || "Save failed");
      try { localStorage.setItem(cleanerKey(), who); } catch (e0) {}
      E.toast("Cleaning recorded · " + mt() + " · " + who, "success");
      await load({ silent: true });
      if (E.focusAfter) E.focusAfter(nextCheck);
    } catch (e) {
      setRowBusy(rowEl, false); rowError(rowEl, E.saveFailText ? E.saveFailText(e) : "Not saved: " + String(e && (e.message || e) || "error"));
    } finally { state.busy[key] = false; }
  }

  // After a reading or a cleaning is saved, focus goes to the next check still to do (the row: Tab is then its first
  // field, and the minute refresh still runs), or to the heading when none is left.
  function nextCheck(m) { var x = m.querySelector(".tdy-row[data-kind=temperature] input[data-min], .tdy-row[data-kind=daily_register].amb [data-open], .tdy-row[data-kind=cleaning] [data-act=clean]"); return x ? x.closest(".tdy-row") : m.querySelector("h1"); }
  function setRowBusy(rowEl, busy) {
    rowEl.querySelectorAll("button,input").forEach(function (el) { el.disabled = !!busy; });
  }
  function openPath(path) { if (path && path[0] === "#") window.location.hash = path; }

  // First-run list (backlog 2 item 4), for the pharmacy's admin only, and only while something is missing: no fridge or
  // room to log, nobody else signs in, opening hours never set. Each line goes when it is done; the list goes with the last.
  // Counted by GET /today itself (still one request); an older server sends no "setup" and nothing is shown.
  function setupItems(before) {
    var s = (state.data && state.data.setup) || {}, out = []; // from GET /today (an older server sends none: no list)
    if (!before.some(function (r) { return r.kind === "temperature"; })) out.push({ k: "fridge", t: "Add the fridge and room you log", go: "#temperature", b: "Add" });
    if (s.sign_ins === 1) out.push({ k: "people", t: "Add the people who work here, so each signs in as themselves", go: "#teamreg", b: "Add people" });
    if (s.opening_hours_saved === false) out.push({ k: "hours", t: "Set your opening hours", go: "#shifts", b: "Set hours" });
    return out;
  }
  function setupCard(before) {
    var u = E.state.user || {};
    if (u.role !== "admin" || !(state.data && state.data.setup)) return "";
    var items = setupItems(before);
    if (!items.length) return "";
    return '<section class="tdy-setup" aria-labelledby="tdy-setup-t"><h2 id="tdy-setup-t">Getting this pharmacy ready</h2><p>' + plural(items.length, "thing") + ' left. Each goes from this list once it is done.</p><ul>' +
      items.map(function (i) { return '<li data-setup="' + i.k + '"><span>' + esc(i.t) + '</span><button class="tdy-btn" data-open="' + esc(i.go) + '">' + esc(i.b) + '</button></li>'; }).join("") + '</ul></section>';
  }

  // ---------- render ----------
  // Line icons in the rail's style (stroke, round caps), not characters: a lone "°" read as a stray mark.
  function ico(d) { return '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + "</svg>"; }
  var ICO = {
    room: ico('<path d="M14 14.8V5a2 2 0 0 0-4 0v9.8a4 4 0 1 0 4 0z"/><path d="M12 9v7"/>'),
    fridge: ico('<path d="M12 2.5v19M3.8 7.2l16.4 9.6M3.8 16.8l16.4-9.6"/><path d="m9.5 4 2.5 2 2.5-2M9.5 20l2.5-2 2.5 2"/>'),
    register: ico('<path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v15H5.5A1.5 1.5 0 0 0 4 19.5z"/><path d="M4 19.5A1.5 1.5 0 0 0 5.5 21H19M8 7.5h7M8 11h5"/>'),
    clean: ico('<path d="M10 3.5 11.7 8.3 16.5 10 11.7 11.7 10 16.5 8.3 11.7 3.5 10 8.3 8.3z"/><path d="M17.5 14.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z"/>')
  };
  function num(v) { return v == null || v === "" ? NaN : Number(v); }
  // b4-9: what a fridge or room is called on screen (display only; the stored name is unchanged). The server titles each
  // device "<name> · reading", and the room sensor is seeded with the pharmacy's own name, so "Pharmacy · reading" sat next
  // to "Pharmacy Fridge · reading" and did not say it was the room. A device named just "Pharmacy" or the pharmacy's name
  // reads "Room"; every other name is shown as it was typed.
  function devName(r) {
    var n = String((r && r.title) || "").replace(/ · reading$/, "").trim(), k = n.toLowerCase();
    var here = String(((state.data && state.data.pharmacy) || {}).name || (E.state.user || {}).location_name || "").trim().toLowerCase();
    return k === "pharmacy" || (here && k === here) ? "Room" : n;
  }
  // b4-9: the time of day decides the words, never the data. The heading reads "Before opening" in the morning and
  // "Today's checks" from noon (/today does not send the opening hours, so noon stands in for them, as the headline
  // already does). The Daily register is a to-do only once the day is closing (decision D3: End of day started, or
  // from 19:30, the app's default closing time): before that, on a day with no prescription-only sale, it is not owed.
  function hourOf(d) { var hr = parseInt(String((d && d.time) || mt()).split(":")[0], 10); return isNaN(hr) ? new Date().getHours() : hr; }
  function regOwed(d) { var t = String((d && d.time) || mt()); return !!(d && d.takings && d.takings.end_of_day_saved) || t >= "19:30"; }
  function owed(r, d) { return (r.status === "todo" || r.status === "overdue") && !(r.kind === "daily_register" && r.status === "todo" && !regOwed(d)); }
  // Yesterday's reading against the limits: the server sends both; only today's was ever judged.
  function yesterdayOut(r) {
    var y = r && r.yesterday, l = (r && r.limits) || {};
    if (!y) return null;
    var lo = num(l.min), hi = num(l.max), mn = num(y.min), mx = num(y.max);
    var low = isFinite(lo) && isFinite(mn) && mn < lo, high = isFinite(hi) && isFinite(mx) && mx > hi;
    if (!low && !high) return null;
    return { low: low, high: high, min: mn, max: mx, lo: lo, hi: hi,
      reading: low && high ? mn + " to " + mx + " °C" : (low ? mn : mx) + " °C",
      limits: (isFinite(lo) ? lo : "–") + " to " + (isFinite(hi) ? hi : "–") + " °C" };
  }
  function yesterdayYmd() { var t = todayYmd(); if (!t) return ""; var d = new Date(t + "T12:00:00"); d.setDate(d.getDate() - 1); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function rowTemp(r) {
    var done = r.status === "done", yo = yesterdayOut(r);
    var cls = done ? (r.out_of_range ? "red" : (yo ? "amb" : "grn")) : "amb";
    var tk = todayYmd() + "|" + r.device_id, needNote = done && r.out_of_range && state.tn && state.tn[tk] && !noteOf(tk), had = done && r.out_of_range && noteOf(tk);
    var pill = done ? (r.out_of_range ? '<span class="tdy-pill red">' + (needNote ? "Outside limits · note needed" : "Outside limits") + '</span>' : '<span class="tdy-pill grn">Logged ' + esc(r.today.min) + " to " + esc(r.today.max) + "</span>") : "";
    var inl = done ? "" :
      '<div class="tdy-inl"><small>min</small><input data-min inputmode="decimal" enterkeyhint="next" autocomplete="off" aria-label="Lowest temperature, °C"><small>max</small><input data-max inputmode="decimal" enterkeyhint="done" autocomplete="off" aria-label="Highest temperature, °C"><small>°C</small></div>' +
      '<button class="tdy-btn p" data-act="temp">Log</button>';
    return '<div class="tdy-row ' + cls + '" data-kind="temperature" data-device="' + esc(r.device_id) + '">' +
      '<div class="tdy-av sq nt">' + (r.limits && r.limits.max != null && r.limits.max <= 10 ? ICO.fridge : ICO.room) + '</div>' +
      '<div class="tdy-t"><b>' + esc(devName(r)) + '</b>' +
      (had ? '<span>Note: ' + esc(had) + '</span>' : yo ? '<span class="w">Outside limits yesterday: ' + esc(yo.reading) + ' · limits ' + esc(yo.limits) + '</span>' : '<span>' + esc(r.sub) + '</span>') + '</div>' + pill + inl + '</div>' +
      (needNote ? '<div class="tdy-note" data-note-for="' + esc(tk) + '">' + E.tempNote.noteForm({ key: tk, draft: state.noteDraft[tk], msg: state.noteMsg[tk] }) + '</div>' : "");
  }
  function rowDaily(r) {
    var done = r.status === "done", due = !done && owed(r, state.data); // b4-9: one line says it ("No entry yet today"); amber only once it is owed (D3), never red
    return '<div class="tdy-row' + (done ? " grn" : due ? " amb" : "") + '" data-kind="daily_register">' +
      '<div class="tdy-av sq nt">' + ICO.register + '</div>' +
      '<div class="tdy-t"><b>Daily register</b><span>' + esc(r.sub) + '</span></div>' +
      (done ? '<span class="tdy-pill grn">Done</span>' : "") +
      '<button class="tdy-btn" data-open="' + esc(r.action.path) + '">Open</button></div>';
  }
  function rowClean(r) {
    var cls = r.status === "done" ? "grn" : r.status === "overdue" ? "red" : "amb";
    var pill = r.status === "done" ? '<span class="tdy-pill grn">Done today</span>' : r.status === "overdue" ? '<span class="tdy-pill red">Overdue</span>' : '<span class="tdy-pill gry">Due weekly</span>';
    var sub = r.status === "overdue" ? '<span class="u">' + esc(r.sub) + " · due weekly</span>" : "<span>" + esc(r.sub) + "</span>";
    return '<div class="tdy-row ' + cls + '" data-kind="cleaning">' +
      '<div class="tdy-av sq nt">' + ICO.clean + '</div>' +
      '<div class="tdy-t"><b>Cleaning · dispensary and fridge</b>' + sub + '</div>' + pill +
      (r.status === "done" ? "" : '<div class="tdy-inl"></div><button class="tdy-btn" data-act="clean">Done now</button>') + '</div>';
  }
  function rowCustomer(c) {
    if (c.kind === "order") {
      var due = c.due_today ? '<span class="tdy-pill amb">Needed ' + esc(dayWord(c.needed_by)) + '</span>' : (c.needed_by ? '<span class="tdy-pill gry">Needed ' + esc(dayWord(c.needed_by)) + '</span>' : "");
      return '<div class="tdy-row ' + (c.due_today ? "amb" : "blu") + '">' +
        '<div class="tdy-av" style="background:hsl(' + hue(c.name) + ',45%,32%)">' + esc(initials(c.name)) + '</div>' +
        '<div class="tdy-t"><b>' + esc(c.name) + '</b><span>Order · ' + esc(c.detail || "") + (c.code ? " · " + esc(c.code) : "") + (c.waiting_days > 0 ? " · " + plural(c.waiting_days, "day") + " ago" : " · today") + '</span></div>' +
        due + '<button class="tdy-btn" data-open="' + esc(c.action.path) + '">Open</button></div>';
    }
    if (c.kind === "delivery") { // sent by servers from 2026-11-02-bookings-12; older ones simply do not list deliveries
      var dp = c.late_days > 0 ? '<span class="tdy-pill red">Was due ' + esc(dayWord(c.due_date)) + '</span>' : c.status === "Out for Delivery" ? '<span class="tdy-pill grn">On its way</span>' : '<span class="tdy-pill amb">Goes out today</span>';
      return '<div class="tdy-row ' + (c.late_days > 0 ? "red" : "amb") + '">' +
        '<div class="tdy-av" style="background:hsl(' + hue(c.name) + ',45%,32%)">' + esc(initials(c.name)) + '</div>' +
        '<div class="tdy-t"><b>' + esc(c.name) + '</b><span>Delivery · ' + esc(c.detail || "") + (c.slot ? " · " + esc(c.slot) : "") + (c.cold ? " · Fridge" : "") + (c.controlled ? " · Controlled drug" : "") + '</span></div>' +
        dp + '<button class="tdy-btn" data-open="' + esc(c.action.path) + '">Open</button></div>';
    }
    return '<div class="tdy-row blu">' +
      '<div class="tdy-av" style="background:hsl(' + hue(c.name) + ',45%,32%)">' + esc(initials(c.name)) + '</div>' +
      '<div class="tdy-t"><b>' + esc(c.name) + '</b><span>Asked ' + (c.waiting_days > 0 ? plural(c.waiting_days, "day") + " ago" : "today") + ' · "' + esc(c.detail || "") + '"</span></div>' +
      '<span class="tdy-pill blu">' + (c.waiting_days > 0 ? "Waiting " + plural(c.waiting_days, "day") : "New") + '</span>' +
      '<button class="tdy-btn" data-open="' + esc(c.action.path) + '">Reply</button></div>';
  }

  function render() {
    if (E.state.activeModuleId !== "today") return; // left before a reply came back: do not draw over the next screen
    var m = state.mount; if (!m) return;
    injectCss(); if (E.tempNote) E.tempNote.css();
    var d = state.data;
    var user = E.state.user || {};
    // The notice sits above the grid, not in it: inside, it took the first row and pushed the worklist below the side tiles.
    var html = "";
    if (state.error) html += '<div class="tdy-off" role="alert"><span>' + esc(state.error) + (d && state.loadedAt ? " Showing what we had at " + mt(state.loadedAt) + "." : " Nothing to show yet.") + '</span>' +
      (state.errorKind === "auth" ? '<button class="tdy-btn p" data-signin>Sign in again</button>' : '<button class="tdy-btn" data-retry>Try again</button>') + '</div>';
    html += '<div class="tdy">';
    html += '<div class="tdy-find"><label class="tdy-search"><span aria-hidden="true"><svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" style="color:rgba(60,60,67,.55);flex:none;display:block"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg></span><input id="tdy-q" type="search" placeholder="' + esc(placeholder()) + '" aria-label="Search: a customer, an order, a register" autocomplete="off" value="' + esc(state.search) + '"><span class="hint">' + (E.searchAttachToday ? "Enter opens it · / anywhere" : "Enter opens it") + '</span></label><div class="tdy-results" id="tdy-results" hidden></div></div>';
    html += '<div class="tdy-date"><b>' + esc(longDate(d && d.date)) + '</b><span>' + esc(d && d.time ? d.time : mt()) + (user.location_name ? " · " + esc(user.location_name) : "") + '</span></div>';

    if (!d) {
      html += '<div class="tdy-head"><h1>' + (state.error ? "Today could not be loaded." : "Loading…") + '</h1></div></div>';
      m.innerHTML = html; bind(); return;
    }

    var before = d.before_opening || [], waiting = d.customers_waiting || [], attention = d.attention || [];
    var miss = missingNotes(d);
    var nBefore = before.filter(function (x) { return owed(x, d); }).length + miss.length, nWait = waiting.length; // b4-9: counted here, so the Daily register is owed only at closing (D3); a note still to write is a check still to do
    var h1;
    var hr = hourOf(d);
    var part = hr < 12 ? "morning" : hr < 17 ? "afternoon" : "evening";
    if (nBefore === 0 && nWait === 0) h1 = "A quiet " + part + ". <span>" + (hr < 12 ? "Nothing needs you yet." : "Everything is done.") + "</span>";
    else if (nBefore === 0) h1 = plural(nWait, "customer") + " waiting. <span>The registers are done.</span>";
    else h1 = (hr < 12 ? plural(nBefore, "thing") + " before the doors open" : plural(nBefore, "check") + " still to do today") + (nWait ? "<span>, " + plural(nWait, "customer") + " waiting.</span>" : "<span>.</span>");
    var leg = [];
    var overdue = before.filter(function (x) { return x.status === "overdue"; }).length;
    var todo = before.filter(function (x) { return x.status === "todo" && owed(x, d); }).length;
    if (overdue) leg.push('<span><i style="background:var(--danger)"></i>' + plural(overdue, "register") + " overdue</span>");
    if (todo) leg.push('<span><i style="background:#C98A12"></i>' + todo + " to fill</span>");
    if (miss.length) leg.push('<span><i style="background:var(--danger)"></i>' + plural(miss.length, "note") + " to write</span>");
    var ready = waiting.filter(function (x) { return x.kind === "order"; }).length, qs = waiting.filter(function (x) { return x.kind === "question"; }).length;
    if (ready) leg.push('<span><i style="background:var(--ok)"></i>' + plural(ready, "order") + " to hand over</span>");
    if (qs) leg.push('<span><i style="background:var(--accent)"></i>' + plural(qs, "question") + "</span>");
    var dl = waiting.filter(function (x) { return x.kind === "delivery"; }).length;
    if (dl) leg.push('<span><i style="background:var(--warn,#C98A12)"></i>' + plural(dl, "delivery", "deliveries") + " to go out</span>");
    html += '<div class="tdy-head"><h1>' + h1 + '</h1><div class="tdy-legend">' + leg.join("") + '</div></div>';

    html += '<div class="tdy-col">';
    html += setupCard(before);
    html += '<div class="tdy-lab">' + (hr < 12 ? "Before opening" : "Today's checks") + ' <b>' + nBefore + '</b></div>';
    // A fridge or room outside its limits yesterday is the first thing to see in the morning, in words and colour.
    var yOut = before.filter(function (r) { return r.kind === "temperature" && yesterdayOut(r); });
    // With its note box right there; once the note is saved it says what was done instead.
    var yKey = function (r) { return yesterdayYmd() + "|" + r.device_id; };
    var yNeed = function (r) { var k = yKey(r); return !!(state.tn && state.tn[k] && !noteOf(k)); };
    if (yOut.length) html += '<div class="tdy-warn" role="' + (yOut.some(function (r) { return !noteOf(yKey(r)); }) ? "alert" : "status") + '">' + yOut.map(function (r) {
      var yo = yesterdayOut(r), name = devName(r), k = yKey(r), nt = noteOf(k);
      return '<p><b>' + esc(name) + ' was ' + esc(yo.reading) + ' yesterday</b>, outside its limits of ' + esc(yo.limits) + '.' +
        (nt ? ' Note: ' + esc(nt) + '.' : yNeed(r) ? '' : ' Add a note saying what was done.') +
        ' <a href="#tempreg" data-yday="' + esc(r.device_id) + '">See yesterday ›</a></p>' +
        (yNeed(r) ? E.tempNote.noteForm({ key: k, draft: state.noteDraft[k], msg: state.noteMsg[k] }) : "");
    }).join("") + '</div>';
    var orderKind = { temperature: 0, daily_register: 1, cleaning: 2 };
    var noteDue = function (r) { return r.kind === "temperature" && miss.some(function (x) { return x.when === "today" && x.row === r; }); };
    var sorted = before.slice().sort(function (a, b) {
      var sa = a.status === "overdue" ? 0 : (a.status === "todo" && owed(a, d)) || noteDue(a) ? 1 : a.status === "ok" || a.status === "todo" ? 2 : 3;
      var sb = b.status === "overdue" ? 0 : (b.status === "todo" && owed(b, d)) || noteDue(b) ? 1 : b.status === "ok" || b.status === "todo" ? 2 : 3;
      var ya = a.kind === "temperature" && yesterdayOut(a) ? 0 : 1, yb = b.kind === "temperature" && yesterdayOut(b) ? 0 : 1;
      return sa - sb || ya - yb || (orderKind[a.kind] - orderKind[b.kind]);
    });
    html += '<div class="tdy-list">' + sorted.map(function (r) {
      if (r.kind === "temperature") return rowTemp(r);
      if (r.kind === "daily_register") return rowDaily(r);
      if (r.kind === "cleaning") return rowClean(r);
      return "";
    }).join("") + '</div>';

    html += '<div class="tdy-lab">Customers waiting <b>' + nWait + '</b><a data-open="#clientorders">All orders ›</a></div>';
    html += waiting.length ? '<div class="tdy-list">' + waiting.map(rowCustomer).join("") + '</div>' : '<div class="tdy-quiet">No one is waiting. New orders and questions appear here the moment they are recorded.</div>';
    html += repeatsCard(d);
    // Bookings today (only when the pharmacy uses Bookings): the next few, one tap to the day.
    var bk = d.bookings;
    if (bk && bk.total_today > 0) E.state.todayBookings = true; // the search asks Bookings only where it is used
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
    html += '<div class="tdy-tile"><div class="tdy-lab">Money today</div><div class="big">€' + esc((t.paid_out_today || 0).toFixed(2)) + '<span>paid out today</span></div>' +
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
      ((tm.handover_incoming || []).length ? '<p>Handover from yesterday:<br>' + tm.handover_incoming.slice().sort(function (a, b) { var o = { r: 0, y: 1 }; return (o[a && a.sev] != null ? o[a.sev] : 2) - (o[b && b.sev] != null ? o[b.sev] : 2); }).slice(0, 3)
        .map(function (h) { return "<b" + (h && h.sev === "r" ? ' style="color:var(--danger)"' : "") + ">" + esc(h.text || h.msg || h) + "</b>"; }).join("<br>") + '</p>' : "") + // most critical first, as in Handover
      (tm.notes_today ? '<p>Today: <b>' + esc(tm.notes_today) + '</b></p>' : "") +
      '<button class="tdy-btn" data-open="#instructions">Handover</button>' + (E.modules.rotreg ? ' <button class="tdy-btn" data-open="#rotreg">Who\'s in</button>' : "") + '</div>';
    html += '</div>';

    if (E.setRailBadge) { try { E.setRailBadge("today", nBefore); E.setRailBadge("customers", nWait); E.setRailBadge("stock", attention.filter(function (a) { return a.kind === "near_expiry" || a.kind === "returns" || a.kind === "alert"; }).length); } catch (eB) {} }
    html += '<div class="tdy-foot"><span>Updated ' + esc(state.loadedAt ? mt(state.loadedAt) : "–") + ' · refreshes every minute</span></div>'; // b4-9: the old dashboard is in Settings › Help, not one tap from Today
    html += '</div>';
    m.innerHTML = html;
    bind();
  }

  function bind() {
    var m = state.mount; if (!m) return;
    var rt = m.querySelector("[data-retry]");
    if (rt) rt.addEventListener("click", function () { rt.disabled = true; rt.textContent = "Trying…"; load(); });
    var si = m.querySelector("[data-signin]");
    if (si) si.addEventListener("click", function () {
      if (E.handleSessionExpired && !E._sessionExpiredShown) E.handleSessionExpired("Sign in again to continue where you were.");
      else { try { E.clearToken(); E.state.user = null; E.renderLogin(); } catch (e) {} }
    });
    m.querySelectorAll("[data-rep-open]").forEach(function (el) {
      el.addEventListener("click", function () { E.state.repregOpen = { q: el.getAttribute("data-rep-open") || "", view: "due" }; openPath("#repreg"); });
    });
    m.querySelectorAll("[data-rep-tell]").forEach(function (el) {
      el.addEventListener("click", function () { var x = (state.repItems || [])[Number(el.getAttribute("data-rep-tell"))]; if (x && typeof E.tellCustomer === "function") E.tellCustomer({ kind: x.s.kind === "runout" ? "repeat_running_out" : "repeat_due", name: x.e.client_name, id_card: x.e.client_id, detail: x.e.medicine_name_dose, date: x.s.kind === "runout" ? x.e.expires_date : x.s.next }); });
    });
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
        if (e.key === "Enter") { e.preventDefault(); var b = inp.closest(".tdy-row").querySelector('[data-act="temp"]'); if (b) b.click(); }
      });
      inp.addEventListener("input", function () { inp.removeAttribute("aria-invalid"); });
    });
    m.querySelectorAll('[data-act="clean"]').forEach(function (btn) {
      btn.addEventListener("click", function () {
        var rowEl = btn.closest(".tdy-row");
        var row = (state.data.before_opening || []).find(function (r) { return r.kind === "cleaning"; });
        if (row) markCleaning(row, rowEl);
      });
    });
    m.querySelectorAll("[data-yday]").forEach(function (a) {
      a.addEventListener("click", function (ev) {
        ev.preventDefault();
        try { sessionStorage.setItem("eikon_tempreg_day", JSON.stringify({ day: yesterdayYmd(), device: a.getAttribute("data-yday") })); } catch (e) {}
        window.location.hash = "#tempreg";
      });
    });
    m.querySelectorAll("form[data-tnote]").forEach(function (f) { wireNote(f); });
    var q = m.querySelector("#tdy-q");
    if (q) q.addEventListener("input", function () { state.search = q.value; });
    // The search that acts (eikon.search.js): screens, people, open orders and today's bookings, under the box.
    if (q && E.searchAttachToday) { E.searchAttachToday(q, m.querySelector("#tdy-results")); return; }
    if (q) {
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

  // The note on a reading outside its limits, saved where it is shown. The draft survives every redraw.
  function wireNote(form) {
    var key = form.getAttribute("data-tnote");
    E.tempNote.wire(form, {
      onDraft: function (v) { state.noteDraft[key] = v.note; },
      onSubmit: async function (f, v) {
        var k = "note" + key; if (state.busy[k]) return;
        var shown = state.tn && state.tn[key]; if (!shown) return;
        state.busy[k] = true; E.tempNote.busy(f, true); E.tempNote.setMsg(f, "");
        try {
          var r = await E.tempNote.saveNote(shown, v.note);
          if (r.ok) {
            delete state.noteDraft[key]; delete state.noteMsg[key]; state.tn[key] = r.entry;
            E.toast("Note saved · " + mt(), "success");
            await load({ silent: true });
            var row = state.mount && state.mount.querySelector('.tdy-row[data-kind=temperature][data-device="' + key.split("|")[1] + '"]');
            if (row) { row.setAttribute("tabindex", "-1"); row.focus(); }
            return;
          }
          if (r.stale && r.current) state.tn[key] = r.current; // shown again as it is now; what was typed stays
          state.noteMsg[key] = r.message || r.error || "";
          E.tempNote.busy(f, false); E.tempNote.setMsg(f, state.noteMsg[key]);
          var ta = f.querySelector("textarea"); if (ta) ta.focus();
        } catch (x) {
          state.noteMsg[key] = E.saveFailText(x);
          E.tempNote.busy(f, false); E.tempNote.setMsg(f, state.noteMsg[key]);
        } finally { state.busy[k] = false; }
      }
    });
  }

  async function render0(ctx) {
    state.mount = ctx && ctx.mount;
    state.search = "";
    injectCss();
    render();
    await load();
    if (state.timer) clearInterval(state.timer);
    state.timer = setInterval(function () { if (document.hidden) return; // no polling while the tab is hidden
      if (E.state.activeModuleId === "today") load({ silent: true, background: true }); }, 60000);
    // Back on the tab after a while (lunch, another screen): bring Today up to date at once, not at the next tick.
    if (state.onVis) document.removeEventListener("visibilitychange", state.onVis);
    state.onVis = function () { if (!document.hidden && E.state.activeModuleId === "today" && state.loadedAt && Date.now() - state.loadedAt.getTime() > 60000) load({ silent: true, background: true }); };
    document.addEventListener("visibilitychange", state.onVis);
    // A phone turned sideways (or a window resized) gets the placeholder that fits, without waiting for the next refresh.
    if (!state.mq) { try { state.mq = window.matchMedia(NARROW); var upd = function () { var q = state.mount && state.mount.querySelector("#tdy-q"); if (q) q.placeholder = placeholder(); };
      if (state.mq.addEventListener) state.mq.addEventListener("change", upd); else if (state.mq.addListener) state.mq.addListener(upd); } catch (e) {} }
  }
  function destroy() { if (state.timer) { clearInterval(state.timer); state.timer = null; } if (state.onVis) { document.removeEventListener("visibilitychange", state.onVis); state.onVis = null; } }

  E.registerModule({ id: "today", title: "Today", order: 0, icon: "☀", render: render0, destroy: destroy });
})();
