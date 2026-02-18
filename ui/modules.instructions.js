(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) throw new Error("EIKON core missing (modules.instructions.js)");

  var MODULE_ID = "instructions";
  var STYLE_ID = "eikon-ins-styles";
  var STORAGE_PREFIX = "eikon_instructions_state_v1";

  var ctxRef = null;
  var mountRef = null;

  // UI state (not persisted)
  var ui = {
    tab: "daily",          // daily | ops | systems | clinical | settings
    ymd: null,             // selected day YYYY-MM-DD (UTC)
    monthYmd: null,        // calendar month anchor YYYY-MM-01 (UTC)
    flash: null,           // { kind: "ok"|"err", text, at }
    editing: {},           // globalKey -> true/false
    drafts: {},            // globalKey -> string
    dailyEditing: false,
    dailyDraft: "",
    addBullet: { sev: "g", text: "" },
    editingBulletId: null,
    editingBulletDraft: "",
    editingBulletSev: "g"
  };

  // Data state (persisted)
  var state = null;

  // ----------------------------
  // Utilities
  // ----------------------------
  function pad2(n) {
    n = parseInt(n, 10) || 0;
    return n < 10 ? "0" + n : String(n);
  }

  function dateToYmdUTC(d) {
    var y = d.getUTCFullYear();
    var m = pad2(d.getUTCMonth() + 1);
    var day = pad2(d.getUTCDate());
    return y + "-" + m + "-" + day;
  }

  function ymdToDateUTC(ymd) {
    var parts = String(ymd || "").split("-");
    var y = parseInt(parts[0], 10) || 1970;
    var m = (parseInt(parts[1], 10) || 1) - 1;
    var d = parseInt(parts[2], 10) || 1;
    return new Date(Date.UTC(y, m, d, 0, 0, 0));
  }

  function addDaysYmdUTC(ymd, deltaDays) {
    var d = ymdToDateUTC(ymd);
    d.setUTCDate(d.getUTCDate() + (parseInt(deltaDays, 10) || 0));
    return dateToYmdUTC(d);
  }

  function todayYmdUTC() {
    return dateToYmdUTC(new Date());
  }

  function monthLabelUTC(ymd) {
    var d = ymdToDateUTC(ymd);
    try {
      return d.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
    } catch (e) {
      return String(ymd || "").slice(0, 7);
    }
  }

  function safeJsonParse(s) {
    try { return JSON.parse(s); } catch (e) { return null; }
  }

  function nowIso() {
    try { return new Date().toISOString(); } catch (e) { return ""; }
  }

  // ----------------------------
  // Persisted data model
  // ----------------------------
  function makeDefaultState() {
    return {
      v: 1,
      global: {
        opening: { text: "", updated_at: "" },
        closing: { text: "", updated_at: "" },
        endofday: { text: "", updated_at: "" },

        pos: { text: "", updated_at: "" },
        poyc: { text: "", updated_at: "" },
        ordering: { text: "", updated_at: "" },
        loyalty: { text: "", updated_at: "" },

        hiv: { enabled: false, text: "", updated_at: "" },
        concerta: { enabled: false, text: "", updated_at: "" },

        doctors_process: { text: "", updated_at: "" },
        doctors_fees: { text: "", updated_at: "" },
        clinic_fees: { text: "", updated_at: "" },

        permanent_handover: { text: "", updated_at: "" }
      },
      daily: {
        // "YYYY-MM-DD": { notes: "", updated_at: "", handover_out: [ {id, sev, text, created_at} ] }
      }
    };
  }

  function normalizeState(s) {
    var d = makeDefaultState();
    if (!s || typeof s !== "object") return d;
    if (!s.global || typeof s.global !== "object") s.global = {};
    if (!s.daily || typeof s.daily !== "object") s.daily = {};

    Object.keys(d.global).forEach(function (k) {
      if (!s.global[k] || typeof s.global[k] !== "object") s.global[k] = {};
      if (k === "hiv" || k === "concerta") {
        if (typeof s.global[k].enabled !== "boolean") s.global[k].enabled = !!d.global[k].enabled;
      }
      if (typeof s.global[k].text !== "string") s.global[k].text = "";
      if (typeof s.global[k].updated_at !== "string") s.global[k].updated_at = "";
    });

    Object.keys(s.daily).forEach(function (ymd) {
      var rec = s.daily[ymd];
      if (!rec || typeof rec !== "object") { delete s.daily[ymd]; return; }
      if (typeof rec.notes !== "string") rec.notes = "";
      if (typeof rec.updated_at !== "string") rec.updated_at = "";
      if (!Array.isArray(rec.handover_out)) rec.handover_out = [];
      rec.handover_out = rec.handover_out
        .filter(function (b) { return b && typeof b === "object" && typeof b.text === "string" && b.text.trim() !== ""; })
        .map(function (b) {
          return {
            id: typeof b.id === "string" ? b.id : ("b_" + String(Date.now()) + "_" + String(Math.random()).slice(2)),
            sev: (b.sev === "g" || b.sev === "y" || b.sev === "r") ? b.sev : "g",
            text: String(b.text || ""),
            created_at: typeof b.created_at === "string" ? b.created_at : ""
          };
        });
    });

    if (typeof s.v !== "number") s.v = 1;
    return s;
  }

  function storageKey(user) {
    var org = user && (user.org_id || user.orgId || user.org) ? String(user.org_id || user.orgId || user.org) : "org";
    var loc = user && (user.location_id || user.locationId || user.location) ? String(user.location_id || user.locationId || user.location) : "loc";
    return STORAGE_PREFIX + "_" + org + "_" + loc;
  }

  function loadState() {
    var user = ctxRef && ctxRef.user ? ctxRef.user : null;
    var key = storageKey(user);
    try {
      var raw = window.localStorage.getItem(key);
      if (!raw) return normalizeState(makeDefaultState());
      var parsed = safeJsonParse(raw);
      return normalizeState(parsed);
    } catch (e) {
      return normalizeState(makeDefaultState());
    }
  }

  function saveState() {
    var user = ctxRef && ctxRef.user ? ctxRef.user : null;
    var key = storageKey(user);
    try {
      window.localStorage.setItem(key, JSON.stringify(state || makeDefaultState()));
      flash("ok", "Saved (local).");
      return true;
    } catch (e) {
      flash("err", "Save failed (storage blocked).");
      return false;
    }
  }

  function ensureDaily(ymd) {
    if (!state.daily[ymd]) state.daily[ymd] = { notes: "", updated_at: "", handover_out: [] };
    var rec = state.daily[ymd];
    if (typeof rec.notes !== "string") rec.notes = "";
    if (typeof rec.updated_at !== "string") rec.updated_at = "";
    if (!Array.isArray(rec.handover_out)) rec.handover_out = [];
    return rec;
  }

  function hasDailyNotes(ymd) {
    var rec = state.daily[ymd];
    return !!(rec && typeof rec.notes === "string" && rec.notes.trim() !== "");
  }
  function hasDailyOut(ymd) {
    var rec = state.daily[ymd];
    return !!(rec && Array.isArray(rec.handover_out) && rec.handover_out.length > 0);
  }
  function hasDailyIn(ymd) {
    var prev = addDaysYmdUTC(ymd, -1);
    var rec = state.daily[prev];
    return !!(rec && Array.isArray(rec.handover_out) && rec.handover_out.length > 0);
  }

  // ----------------------------
  // DOM helpers
  // ----------------------------
  function h(tag, attrs, children) {
    var el = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v === undefined || v === null) return;

      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k === "html") el.innerHTML = v;
      else if (k === "value") el.value = v;
      else if (k === "checked") el.checked = !!v;
      else if (k === "disabled") el.disabled = !!v;
      else if (k === "type") el.type = v;
      else if (k === "placeholder") el.setAttribute("placeholder", v);
      else if (k === "rows") el.setAttribute("rows", String(v));
      else if (k === "id") el.id = v;
      else if (typeof v === "function" && k.slice(0, 2) === "on") el[k] = v; // onclick, onchange, oninput, etc.
      else el.setAttribute(k, v);
    });
    (children || []).forEach(function (c) {
      if (c === null || c === undefined) return;
      if (typeof c === "string") el.appendChild(document.createTextNode(c));
      else el.appendChild(c);
    });
    return el;
  }

  function btn(label, cls, onClick) {
    return h("button", {
      class: cls || "eikon-btn",
      text: label,
      onclick: function (ev) {
        if (ev) { ev.preventDefault(); ev.stopPropagation(); }
        if (onClick) onClick();
      }
    }, []);
  }

  function ensureStyles() {
    if (document.getElementById(STYLE_ID)) return;
    var st = document.createElement("style");
    st.id = STYLE_ID;
    st.textContent =
      "" +
      ".eikon-ins-wrap{display:flex;flex-direction:column;gap:12px;}\n" +
      ".eikon-ins-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;}\n" +
      ".eikon-ins-tabs{display:flex;flex-wrap:wrap;gap:8px;align-items:center;}\n" +
      ".eikon-ins-tabbtn{border:1px solid var(--border);background:rgba(255,255,255,.04);padding:8px 10px;border-radius:999px;cursor:pointer;font-weight:800;}\n" +
      ".eikon-ins-tabbtn.active{background:rgba(255,255,255,.10);border-color:rgba(255,255,255,.22);}\n" +
      ".eikon-ins-actions{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}\n" +
      ".eikon-ins-flash{padding:8px 10px;border-radius:10px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);font-size:13px;}\n" +
      ".eikon-ins-flash.ok{border-color:rgba(25,195,125,.45);background:rgba(25,195,125,.10);}\n" +
      ".eikon-ins-flash.err{border-color:rgba(255,90,90,.45);background:rgba(255,90,90,.10);}\n" +
      ".eikon-ins-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:12px;}\n" +
      ".eikon-ins-col6{grid-column:span 6;}\n" +
      ".eikon-ins-col12{grid-column:span 12;}\n" +
      "@media(max-width:980px){.eikon-ins-col6{grid-column:span 12;}}\n" +
      ".eikon-ins-card{padding:12px;}\n" +
      ".eikon-ins-cardhead{display:flex;gap:10px;align-items:flex-start;justify-content:space-between;margin-bottom:10px;}\n" +
      ".eikon-ins-title{display:flex;flex-direction:column;gap:2px;}\n" +
      ".eikon-ins-title h3{margin:0;font-size:16px;}\n" +
      ".eikon-ins-sub{opacity:.75;font-size:12px;}\n" +
      ".eikon-ins-meta{opacity:.7;font-size:12px;}\n" +
      ".eikon-ins-btnrow{display:flex;gap:8px;flex-wrap:wrap;align-items:center;justify-content:flex-end;}\n" +
      ".eikon-ins-read{white-space:pre-wrap;line-height:1.45;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:12px;padding:10px;min-height:72px;}\n" +
      ".eikon-ins-ta{width:100%;min-height:140px;resize:vertical;}\n" +
      ".eikon-ins-ta.small{min-height:110px;}\n" +
      ".eikon-ins-divider{height:1px;background:rgba(255,255,255,.10);margin:10px 0;}\n" +
      ".eikon-ins-switch{display:inline-flex;gap:8px;align-items:center;cursor:pointer;user-select:none;font-weight:800;}\n" +
      ".eikon-ins-switch input{transform:scale(1.05);}\n" +
      ".eikon-ins-kbd{font-family:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,monospace;font-size:12px;opacity:.8;}\n" +
      ".eikon-ins-daily-top{display:flex;flex-wrap:wrap;gap:10px;align-items:center;justify-content:space-between;}\n" +
      ".eikon-ins-daily-left{display:flex;gap:8px;flex-wrap:wrap;align-items:center;}\n" +
      ".eikon-ins-datechip{padding:8px 10px;border-radius:999px;border:1px solid rgba(255,255,255,.14);background:rgba(255,255,255,.04);font-weight:900;}\n" +
      ".eikon-ins-cal{border:1px solid rgba(255,255,255,.10);border-radius:14px;overflow:hidden;}\n" +
      ".eikon-ins-calhead{display:flex;gap:8px;align-items:center;justify-content:space-between;padding:10px 12px;background:rgba(255,255,255,.03);border-bottom:1px solid rgba(255,255,255,.10);}\n" +
      ".eikon-ins-calgrid{display:grid;grid-template-columns:repeat(7,1fr);}\n" +
      ".eikon-ins-calcell{padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.08);border-right:1px solid rgba(255,255,255,.08);min-height:44px;display:flex;align-items:flex-start;justify-content:space-between;gap:6px;cursor:pointer;}\n" +
      ".eikon-ins-calcell:nth-child(7n){border-right:none;}\n" +
      ".eikon-ins-calcell.hdr{cursor:default;min-height:auto;background:rgba(255,255,255,.02);font-size:12px;opacity:.75;font-weight:900;}\n" +
      ".eikon-ins-calcell.empty{cursor:default;opacity:.2;}\n" +
      ".eikon-ins-daynum{font-weight:900;}\n" +
      ".eikon-ins-markers{display:flex;gap:4px;align-items:center;justify-content:flex-end;}\n" +
      ".eikon-ins-mark{width:7px;height:7px;border-radius:99px;background:rgba(255,255,255,.25);}\n" +
      ".eikon-ins-mark.note{background:rgba(90,170,255,.70);}\n" +
      ".eikon-ins-mark.out{background:rgba(255,190,90,.75);}\n" +
      ".eikon-ins-mark.in{background:rgba(25,195,125,.70);}\n" +
      ".eikon-ins-calcell.sel{background:rgba(255,255,255,.07);}\n" +
      ".eikon-ins-calcell.today{outline:2px solid rgba(90,170,255,.35);outline-offset:-2px;}\n" +
      ".eikon-ins-bullets{display:flex;flex-direction:column;gap:8px;}\n" +
      ".eikon-ins-bullet{display:flex;gap:10px;align-items:flex-start;border:1px solid rgba(255,255,255,.10);background:rgba(255,255,255,.03);border-radius:12px;padding:10px;}\n" +
      ".eikon-ins-dot{width:12px;height:12px;border-radius:99px;margin-top:4px;flex:0 0 auto;}\n" +
      ".eikon-ins-dot.g{background:rgba(25,195,125,.95);}\n" +
      ".eikon-ins-dot.y{background:rgba(255,200,90,.95);}\n" +
      ".eikon-ins-dot.r{background:rgba(255,90,90,.95);}\n" +
      ".eikon-ins-btxt{white-space:pre-wrap;line-height:1.35;flex:1;}\n" +
      ".eikon-ins-bact{display:flex;gap:6px;flex-wrap:wrap;align-items:center;justify-content:flex-end;}\n" +
      ".eikon-ins-mini{font-size:12px;opacity:.75;}\n" +
      ".eikon-ins-pillrow{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px;}\n" +
      ".eikon-ins-pill{border:1px solid rgba(255,255,255,.12);background:rgba(255,255,255,.03);padding:6px 10px;border-radius:999px;cursor:pointer;font-weight:900;font-size:12px;opacity:.95;}\n" +
      ".eikon-ins-pill:hover{background:rgba(255,255,255,.06);}\n";
    document.head.appendChild(st);
  }

  function flash(kind, text) {
    ui.flash = { kind: kind, text: text, at: Date.now() };
    if (mountRef) renderIntoMount();
    try {
      window.setTimeout(function () {
        if (!ui.flash) return;
        if (Date.now() - ui.flash.at >= 3900) {
          ui.flash = null;
          if (mountRef) renderIntoMount();
        }
      }, 4100);
    } catch (e) {}
  }

  function scrollToId(id) {
    try {
      var el = document.getElementById(id);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (e) {}
  }

  // ----------------------------
  // Global editor card (textareas)
  // ----------------------------
  function renderEditorCard(opts) {
    // opts: { key, title, subtitle, placeholder, cols, anchorId, toggleable }
    var g = state.global[opts.key];
    var isEditing = !!ui.editing[opts.key];

    var headLeft = h("div", { class: "eikon-ins-title" }, [
      h("h3", { text: opts.title }, []),
      opts.subtitle ? h("div", { class: "eikon-ins-sub", text: opts.subtitle }, []) : null,
      g.updated_at ? h("div", { class: "eikon-ins-meta", text: "Last updated: " + g.updated_at }, []) : h("div", { class: "eikon-ins-meta", text: "Not saved yet" }, [])
    ]);

    var controls = [];

    // Toggleable (HIV / Concerta)
    if (opts.toggleable) {
      var enabledNow = !!g.enabled;
      var sw = h("label", { class: "eikon-ins-switch" }, [
        h("input", {
          type: "checkbox",
          checked: enabledNow,
          onchange: function (ev) {
            g.enabled = !!ev.target.checked;
            g.updated_at = nowIso();
            saveState();
            renderIntoMount();
          }
        }, []),
        h("span", { text: enabledNow ? "Enabled" : "Disabled" }, [])
      ]);
      controls.push(sw);
    }

    if (!isEditing) {
      controls.push(btn("Edit", "eikon-btn", function () {
        ui.editing[opts.key] = true;
        ui.drafts[opts.key] = String(g.text || "");
        renderIntoMount();
      }));
    } else {
      controls.push(btn("Save", "eikon-btn primary", function () {
        g.text = String(ui.drafts[opts.key] || "");
        g.updated_at = nowIso();
        ui.editing[opts.key] = false;
        ui.drafts[opts.key] = "";
        saveState();
        renderIntoMount();
      }));
      controls.push(btn("Cancel", "eikon-btn", function () {
        ui.editing[opts.key] = false;
        ui.drafts[opts.key] = "";
        renderIntoMount();
      }));
    }

    var body;
    if (opts.toggleable && !g.enabled) {
      body = h("div", { class: "eikon-ins-read" }, [
        "This section is disabled. Toggle it on to show/edit the contents."
      ]);
    } else if (!isEditing) {
      body = h("div", { class: "eikon-ins-read" }, [
        (g.text && g.text.trim()) ? g.text : ("(" + (opts.placeholder || "No text") + ")")
      ]);
    } else {
      body = h("textarea", {
        class: "eikon-input eikon-ins-ta" + (opts.small ? " small" : ""),
        placeholder: opts.placeholder || "",
        oninput: function (ev) { ui.drafts[opts.key] = ev.target.value; }
      }, []);
      body.value = String(ui.drafts[opts.key] || "");
    }

    return h("div", { class: "eikon-card eikon-ins-card " + (opts.cols === 12 ? "eikon-ins-col12" : "eikon-ins-col6"), id: opts.anchorId || "" }, [
      h("div", { class: "eikon-ins-cardhead" }, [
        headLeft,
        h("div", { class: "eikon-ins-btnrow" }, controls)
      ]),
      body
    ]);
  }

  // ----------------------------
  // Tabs
  // ----------------------------
  function renderOpsTab() {
    var wrap = h("div", { class: "eikon-ins-grid" }, []);

    var pills = h("div", { class: "eikon-ins-pillrow" }, [
      h("button", { class: "eikon-ins-pill", text: "Opening", onclick: function () { scrollToId("ins_ops_opening"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "Closing", onclick: function () { scrollToId("ins_ops_closing"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "End of Day", onclick: function () { scrollToId("ins_ops_eod"); } }, [])
    ]);

    wrap.appendChild(h("div", { class: "eikon-ins-col12" }, [pills]));

    wrap.appendChild(renderEditorCard({
      key: "opening",
      title: "Opening Instructions",
      subtitle: "Checklist + anything that must happen before the first customer.",
      placeholder: "Write your opening checklist here…",
      cols: 6,
      anchorId: "ins_ops_opening"
    }));

    wrap.appendChild(renderEditorCard({
      key: "closing",
      title: "Closing Instructions",
      subtitle: "Closing routine, security checks, cash-up notes, next-day prep.",
      placeholder: "Write your closing checklist here…",
      cols: 6,
      anchorId: "ins_ops_closing"
    }));

    wrap.appendChild(renderEditorCard({
      key: "endofday",
      title: "End of Day Instructions",
      subtitle: "End-of-day process (reports, reconciliation, backups, etc.).",
      placeholder: "Write your end-of-day instructions here…",
      cols: 12,
      anchorId: "ins_ops_eod"
    }));

    return wrap;
  }

  function renderSystemsTab() {
    var wrap = h("div", { class: "eikon-ins-grid" }, []);

    var pills = h("div", { class: "eikon-ins-pillrow" }, [
      h("button", { class: "eikon-ins-pill", text: "POS", onclick: function () { scrollToId("ins_sys_pos"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "POYC", onclick: function () { scrollToId("ins_sys_poyc"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "Ordering", onclick: function () { scrollToId("ins_sys_order"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "Loyalty", onclick: function () { scrollToId("ins_sys_loyalty"); } }, [])
    ]);

    wrap.appendChild(h("div", { class: "eikon-ins-col12" }, [pills]));

    wrap.appendChild(renderEditorCard({
      key: "pos",
      title: "Point of Sale (POS) Instructions",
      subtitle: "How to use the POS system (common workflows + troubleshooting).",
      placeholder: "Write POS instructions here…",
      cols: 12,
      anchorId: "ins_sys_pos"
    }));

    wrap.appendChild(renderEditorCard({
      key: "poyc",
      title: "POYC System Instructions",
      subtitle: "POYC workflow, checks, common issues, and where things are stored.",
      placeholder: "Write POYC instructions here…",
      cols: 12,
      anchorId: "ins_sys_poyc"
    }));

    wrap.appendChild(renderEditorCard({
      key: "ordering",
      title: "How to Order Items",
      subtitle: "Supplier ordering process, cut-off times, urgent orders, returns/credits.",
      placeholder: "Write ordering instructions here…",
      cols: 6,
      anchorId: "ins_sys_order"
    }));

    wrap.appendChild(renderEditorCard({
      key: "loyalty",
      title: "Active Loyalty Schemes",
      subtitle: "Current loyalty offers, how to apply, and any restrictions.",
      placeholder: "List active loyalty schemes here…",
      cols: 6,
      anchorId: "ins_sys_loyalty"
    }));

    return wrap;
  }

  function renderClinicalTab() {
    var wrap = h("div", { class: "eikon-ins-grid" }, []);

    var pills = h("div", { class: "eikon-ins-pillrow" }, [
      h("button", { class: "eikon-ins-pill", text: "HIV", onclick: function () { scrollToId("ins_cli_hiv"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "Concerta", onclick: function () { scrollToId("ins_cli_concerta"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "Doctors", onclick: function () { scrollToId("ins_cli_doctors"); } }, []),
      h("button", { class: "eikon-ins-pill", text: "Fees", onclick: function () { scrollToId("ins_cli_fees"); } }, [])
    ]);
    wrap.appendChild(h("div", { class: "eikon-ins-col12" }, [pills]));

    wrap.appendChild(renderEditorCard({
      key: "hiv",
      title: "Dispensing Instructions — HIV",
      subtitle: "Toggle on/off. When disabled, the section is hidden for normal use.",
      placeholder: "Write HIV dispensing instructions here…",
      cols: 12,
      anchorId: "ins_cli_hiv",
      toggleable: true
    }));

    wrap.appendChild(renderEditorCard({
      key: "concerta",
      title: "Dispensing Instructions — Concerta",
      subtitle: "Toggle on/off. When disabled, the section is hidden for normal use.",
      placeholder: "Write Concerta dispensing instructions here…",
      cols: 12,
      anchorId: "ins_cli_concerta",
      toggleable: true
    }));

    wrap.appendChild(renderEditorCard({
      key: "doctors_process",
      title: "Doctors / Appointments Instructions",
      subtitle: "How bookings work, what staff must collect, what to prepare, etc.",
      placeholder: "Write doctors/appointments instructions here…",
      cols: 12,
      anchorId: "ins_cli_doctors"
    }));

    wrap.appendChild(renderEditorCard({
      key: "doctors_fees",
      title: "Doctors Fees",
      subtitle: "Fee list, payment method rules, refunds, special cases.",
      placeholder: "Write doctors fees here…",
      cols: 6,
      anchorId: "ins_cli_fees"
    }));

    wrap.appendChild(renderEditorCard({
      key: "clinic_fees",
      title: "Clinic Fees",
      subtitle: "Clinic fees and any notes (packages, follow-ups, etc.).",
      placeholder: "Write clinic fees here…",
      cols: 6
    }));

    return wrap;
  }

  function renderCalendar(monthYmd, selectedYmd) {
    var first = ymdToDateUTC(monthYmd);
    var year = first.getUTCFullYear();
    var month = first.getUTCMonth(); // 0-based
    var daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

    // Monday-first index (Mon=0..Sun=6)
    var firstDow = first.getUTCDay(); // Sun=0..Sat=6
    var offset = (firstDow + 6) % 7;

    var cal = h("div", { class: "eikon-ins-cal" }, []);
    cal.appendChild(h("div", { class: "eikon-ins-calhead" }, [
      h("div", { class: "eikon-ins-kbd", text: monthLabelUTC(monthYmd) }, []),
      h("div", { class: "eikon-ins-mini", text: "Click a day" }, [])
    ]));

    var grid = h("div", { class: "eikon-ins-calgrid" }, []);
    var wdays = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
    wdays.forEach(function (n) {
      grid.appendChild(h("div", { class: "eikon-ins-calcell hdr", text: n }, []));
    });

    for (var i = 0; i < offset; i++) {
      grid.appendChild(h("div", { class: "eikon-ins-calcell empty" }, [""]));
    }

    var today = todayYmdUTC();

    for (var d = 1; d <= daysInMonth; d++) {
      var ymd = year + "-" + pad2(month + 1) + "-" + pad2(d);

      var markers = [];
      if (hasDailyNotes(ymd)) markers.push(h("span", { class: "eikon-ins-mark note" }, []));
      if (hasDailyOut(ymd)) markers.push(h("span", { class: "eikon-ins-mark out" }, []));
      if (hasDailyIn(ymd)) markers.push(h("span", { class: "eikon-ins-mark in" }, []));

      var cell = h("div", {
        class: "eikon-ins-calcell" +
          (ymd === selectedYmd ? " sel" : "") +
          (ymd === today ? " today" : ""),
        onclick: (function (ymd2) {
          return function () {
            ui.ymd = ymd2;
            ui.monthYmd = ymd2.slice(0, 7) + "-01";
            renderIntoMount();
          };
        })(ymd)
      }, [
        h("span", { class: "eikon-ins-daynum", text: String(d) }, []),
        h("div", { class: "eikon-ins-markers" }, markers)
      ]);

      grid.appendChild(cell);
    }

    cal.appendChild(grid);
    return cal;
  }

  function renderDailyTab() {
    var ymd = ui.ymd;
    var prevYmd = addDaysYmdUTC(ymd, -1);
    var nextYmd = addDaysYmdUTC(ymd, 1);
    var today = todayYmdUTC();

    var dayRec = ensureDaily(ymd);
    var incoming = (state.daily[prevYmd] && Array.isArray(state.daily[prevYmd].handover_out)) ? state.daily[prevYmd].handover_out : [];

    var top = h("div", { class: "eikon-ins-daily-top" }, [
      h("div", { class: "eikon-ins-daily-left" }, [
        h("div", { class: "eikon-ins-datechip", text: ymd }, []),
        btn("◀ Prev", "eikon-btn", function () { ui.ymd = prevYmd; ui.monthYmd = ui.ymd.slice(0, 7) + "-01"; renderIntoMount(); }),
        btn("Today", "eikon-btn", function () { ui.ymd = today; ui.monthYmd = today.slice(0, 7) + "-01"; renderIntoMount(); }),
        btn("Next ▶", "eikon-btn", function () { ui.ymd = nextYmd; ui.monthYmd = ui.ymd.slice(0, 7) + "-01"; renderIntoMount(); }),
        (function () {
          var inp = h("input", {
            class: "eikon-input",
            type: "date",
            value: ymd,
            onchange: function (ev) {
              var v = String(ev.target.value || "").trim();
              if (!v) return;
              ui.ymd = v;
              ui.monthYmd = v.slice(0, 7) + "-01";
              renderIntoMount();
            }
          }, []);
          return inp;
        })(),
        h("span", { class: "eikon-ins-mini", text: (ymd === today ? "Today" : "") }, [])
      ]),
      h("div", { class: "eikon-ins-actions" }, [
        btn("Save all (local)", "eikon-btn primary", function () { saveState(); })
      ])
    ]);

    // Calendar card (left)
    var calCard = h("div", { class: "eikon-card eikon-ins-card eikon-ins-col6" }, [
      h("div", { class: "eikon-ins-cardhead" }, [
        h("div", { class: "eikon-ins-title" }, [
          h("h3", { text: "Calendar" }, []),
          h("div", { class: "eikon-ins-sub", text: "Pick a day to view/edit day-specific instructions + handover." }, [])
        ]),
        h("div", { class: "eikon-ins-btnrow" }, [
          btn("◀", "eikon-btn", function () {
            var m = ui.monthYmd || (ui.ymd.slice(0, 7) + "-01");
            var d = ymdToDateUTC(m);
            d.setUTCMonth(d.getUTCMonth() - 1);
            ui.monthYmd = dateToYmdUTC(d).slice(0, 7) + "-01";
            renderIntoMount();
          }),
          h("div", { class: "eikon-ins-kbd", text: monthLabelUTC(ui.monthYmd || (ui.ymd.slice(0, 7) + "-01")) }, []),
          btn("▶", "eikon-btn", function () {
            var m2 = ui.monthYmd || (ui.ymd.slice(0, 7) + "-01");
            var d2 = ymdToDateUTC(m2);
            d2.setUTCMonth(d2.getUTCMonth() + 1);
            ui.monthYmd = dateToYmdUTC(d2).slice(0, 7) + "-01";
            renderIntoMount();
          })
        ])
      ]),
      renderCalendar(ui.monthYmd || (ui.ymd.slice(0, 7) + "-01"), ui.ymd),
      h("div", { class: "eikon-ins-divider" }, []),
      h("div", { class: "eikon-ins-mini" }, [
        h("div", { text: "Legend:" }, []),
        h("div", { class: "eikon-ins-mini" }, [
          h("span", { class: "eikon-ins-mark note" }, []), " day notes • ",
          h("span", { class: "eikon-ins-mark out" }, []), " handover out • ",
          h("span", { class: "eikon-ins-mark in" }, []), " incoming handover"
        ])
      ])
    ]);

    // Permanent handover card (global)
    var permCard = renderEditorCard({
      key: "permanent_handover",
      title: "Permanent Handover Instructions",
      subtitle: "Always visible — core handover rules and permanent info that should never be forgotten.",
      placeholder: "Write permanent handover instructions here…",
      cols: 12
    });

    // Day notes
    var notesControls;
    if (!ui.dailyEditing) {
      notesControls = [btn("Edit", "eikon-btn", function () {
        ui.dailyEditing = true;
        ui.dailyDraft = String(dayRec.notes || "");
        renderIntoMount();
      })];
    } else {
      notesControls = [
        btn("Save", "eikon-btn primary", function () {
          dayRec.notes = String(ui.dailyDraft || "");
          dayRec.updated_at = nowIso();
          ui.dailyEditing = false;
          ui.dailyDraft = "";
          saveState();
          renderIntoMount();
        }),
        btn("Cancel", "eikon-btn", function () {
          ui.dailyEditing = false;
          ui.dailyDraft = "";
          renderIntoMount();
        })
      ];
    }

    var notesBody;
    if (!ui.dailyEditing) {
      notesBody = h("div", { class: "eikon-ins-read" }, [
        (dayRec.notes && dayRec.notes.trim()) ? dayRec.notes : "(No day-specific instructions yet)"
      ]);
    } else {
      notesBody = h("textarea", {
        class: "eikon-input eikon-ins-ta",
        placeholder: "Write day-specific instructions for " + ymd + "…",
        oninput: function (ev) { ui.dailyDraft = ev.target.value; }
      }, []);
      notesBody.value = String(ui.dailyDraft || "");
    }

    var notesCard = h("div", { class: "eikon-card eikon-ins-card eikon-ins-col6" }, [
      h("div", { class: "eikon-ins-cardhead" }, [
        h("div", { class: "eikon-ins-title" }, [
          h("h3", { text: "Day Specific Instructions" }, []),
          h("div", { class: "eikon-ins-sub", text: "Saved per day. Use for day-only notes (deliveries, staff notes, reminders, etc.)." }, []),
          dayRec.updated_at ? h("div", { class: "eikon-ins-meta", text: "Last updated: " + dayRec.updated_at }, []) : h("div", { class: "eikon-ins-meta", text: "Not saved yet" }, [])
        ]),
        h("div", { class: "eikon-ins-btnrow" }, notesControls)
      ]),
      notesBody
    ]);

    // Incoming handover (from previous day)
    var inCard = h("div", { class: "eikon-card eikon-ins-card eikon-ins-col6" }, [
      h("div", { class: "eikon-ins-cardhead" }, [
        h("div", { class: "eikon-ins-title" }, [
          h("h3", { text: "Handover From Previous Day" }, []),
          h("div", { class: "eikon-ins-sub", text: "This shows the handover bullets entered on " + prevYmd + "." }, [])
        ]),
        h("div", { class: "eikon-ins-btnrow" }, [
          btn("Append to Day Notes", "eikon-btn", function () {
            if (!incoming || incoming.length === 0) { flash("err", "No incoming handover to append."); return; }
            var lines = incoming.map(function (b) {
              return (b.sev === "r" ? "[CRITICAL] " : (b.sev === "y" ? "[MEDIUM] " : "[LOW] ")) + b.text;
            });
            var r = ensureDaily(ymd);
            var current = String(r.notes || "");
            var joined = (current.trim() ? (current.trim() + "\n\n") : "") +
              "Handover from " + prevYmd + ":\n" +
              lines.map(function (l) { return "• " + l; }).join("\n");
            r.notes = joined;
            r.updated_at = nowIso();
            saveState();
            renderIntoMount();
          })
        ])
      ]),
      (function () {
        if (!incoming || incoming.length === 0) return h("div", { class: "eikon-ins-read" }, ["(No handover bullets from " + prevYmd + ")"]);
        return h("div", { class: "eikon-ins-bullets" }, incoming.map(function (b) {
          return h("div", { class: "eikon-ins-bullet" }, [
            h("span", { class: "eikon-ins-dot " + b.sev }, []),
            h("div", { class: "eikon-ins-btxt" }, [b.text]),
            h("div", { class: "eikon-ins-bact" }, [
              b.created_at ? h("div", { class: "eikon-ins-mini", text: b.created_at }, []) : null
            ])
          ]);
        }));
      })()
    ]);

    // Outgoing handover (for next day)
    var outRec = ensureDaily(ymd);

    var addArea = (function () {
      var sevRow = h("div", { class: "eikon-ins-btnrow", style: "justify-content:flex-start;" }, [
        btn("🟢 Low", ui.addBullet.sev === "g" ? "eikon-btn primary" : "eikon-btn", function () { ui.addBullet.sev = "g"; renderIntoMount(); }),
        btn("🟡 Medium", ui.addBullet.sev === "y" ? "eikon-btn primary" : "eikon-btn", function () { ui.addBullet.sev = "y"; renderIntoMount(); }),
        btn("🔴 Critical", ui.addBullet.sev === "r" ? "eikon-btn primary" : "eikon-btn", function () { ui.addBullet.sev = "r"; renderIntoMount(); })
      ]);

      var ta = h("textarea", {
        class: "eikon-input eikon-ins-ta small",
        placeholder: "Write a handover bullet… (one item)",
        oninput: function (ev) { ui.addBullet.text = ev.target.value; }
      }, []);
      ta.value = String(ui.addBullet.text || "");

      var addBtn = btn("Add Bullet", "eikon-btn primary", function () {
        var t = String(ui.addBullet.text || "").trim();
        if (!t) { flash("err", "Bullet text is empty."); return; }
        var r = ensureDaily(ymd);
        r.handover_out.unshift({
          id: "b_" + String(Date.now()) + "_" + String(Math.random()).slice(2),
          sev: ui.addBullet.sev || "g",
          text: t,
          created_at: nowIso()
        });
        r.updated_at = nowIso();
        ui.addBullet.text = "";
        saveState();
        renderIntoMount();
      });

      return h("div", { class: "eikon-ins-grid" }, [
        h("div", { class: "eikon-ins-col6" }, [
          h("div", { class: "eikon-ins-mini", text: "Severity:" }, []),
          sevRow
        ]),
        h("div", { class: "eikon-ins-col6" }, [
          h("div", { class: "eikon-ins-mini", text: "Bullet:" }, []),
          ta,
          h("div", { class: "eikon-ins-btnrow", style: "justify-content:flex-start;margin-top:8px;" }, [addBtn])
        ])
      ]);
    })();

    var outList = (function () {
      var list = outRec.handover_out || [];
      if (!list.length) return h("div", { class: "eikon-ins-read" }, ["(No handover bullets yet)"]);

      return h("div", { class: "eikon-ins-bullets" }, list.map(function (b) {
        var isEditing = ui.editingBulletId === b.id;

        if (!isEditing) {
          return h("div", { class: "eikon-ins-bullet" }, [
            h("span", { class: "eikon-ins-dot " + b.sev }, []),
            h("div", { class: "eikon-ins-btxt" }, [b.text]),
            h("div", { class: "eikon-ins-bact" }, [
              btn("Edit", "eikon-btn", function () {
                ui.editingBulletId = b.id;
                ui.editingBulletDraft = b.text;
                ui.editingBulletSev = b.sev;
                renderIntoMount();
              }),
              btn("Delete", "eikon-btn danger", function () {
                var r = ensureDaily(ymd);
                r.handover_out = (r.handover_out || []).filter(function (x) { return x.id !== b.id; });
                r.updated_at = nowIso();
                saveState();
                renderIntoMount();
              })
            ])
          ]);
        }

        var sevRow2 = h("div", { class: "eikon-ins-btnrow", style: "justify-content:flex-start;" }, [
          btn("🟢", ui.editingBulletSev === "g" ? "eikon-btn primary" : "eikon-btn", function () { ui.editingBulletSev = "g"; renderIntoMount(); }),
          btn("🟡", ui.editingBulletSev === "y" ? "eikon-btn primary" : "eikon-btn", function () { ui.editingBulletSev = "y"; renderIntoMount(); }),
          btn("🔴", ui.editingBulletSev === "r" ? "eikon-btn primary" : "eikon-btn", function () { ui.editingBulletSev = "r"; renderIntoMount(); })
        ]);

        var ta2 = h("textarea", {
          class: "eikon-input eikon-ins-ta small",
          oninput: function (ev) { ui.editingBulletDraft = ev.target.value; }
        }, []);
        ta2.value = String(ui.editingBulletDraft || "");

        return h("div", { class: "eikon-ins-bullet" }, [
          h("span", { class: "eikon-ins-dot " + (ui.editingBulletSev || "g") }, []),
          h("div", { class: "eikon-ins-btxt" }, [sevRow2, ta2]),
          h("div", { class: "eikon-ins-bact" }, [
            btn("Save", "eikon-btn primary", function () {
              var t = String(ui.editingBulletDraft || "").trim();
              if (!t) { flash("err", "Bullet text is empty."); return; }
              var r2 = ensureDaily(ymd);
              var idx = (r2.handover_out || []).findIndex(function (x) { return x.id === b.id; });
              if (idx >= 0) {
                r2.handover_out[idx].text = t;
                r2.handover_out[idx].sev = (ui.editingBulletSev === "g" || ui.editingBulletSev === "y" || ui.editingBulletSev === "r") ? ui.editingBulletSev : "g";
                r2.updated_at = nowIso();
              }
              ui.editingBulletId = null;
              ui.editingBulletDraft = "";
              ui.editingBulletSev = "g";
              saveState();
              renderIntoMount();
            }),
            btn("Cancel", "eikon-btn", function () {
              ui.editingBulletId = null;
              ui.editingBulletDraft = "";
              ui.editingBulletSev = "g";
              renderIntoMount();
            })
          ])
        ]);
      }));
    })();

    var outCard = h("div", { class: "eikon-card eikon-ins-card eikon-ins-col12" }, [
      h("div", { class: "eikon-ins-cardhead" }, [
        h("div", { class: "eikon-ins-title" }, [
          h("h3", { text: "Handover Bullets (For Next Person / Next Day)" }, []),
          h("div", { class: "eikon-ins-sub", text: "These bullets will appear under “Handover From Previous Day” on " + nextYmd + "." }, [])
        ]),
        h("div", { class: "eikon-ins-btnrow" }, [
          btn("Clear All", "eikon-btn danger", function () {
            var ok = window.confirm("Clear ALL handover bullets for " + ymd + " ?");
            if (!ok) return;
            var r = ensureDaily(ymd);
            r.handover_out = [];
            r.updated_at = nowIso();
            saveState();
            renderIntoMount();
          })
        ])
      ]),
      addArea,
      h("div", { class: "eikon-ins-divider" }, []),
      outList
    ]);

    // Right column stack
    var rightCol = h("div", { class: "eikon-ins-col6" }, [
      permCard,
      h("div", { class: "eikon-ins-divider" }, []),
      notesCard,
      h("div", { class: "eikon-ins-divider" }, []),
      inCard
    ]);

    return h("div", { class: "eikon-ins-wrap" }, [
      top,
      h("div", { class: "eikon-ins-grid" }, [
        calCard,
        rightCol,
        outCard
      ]),
      h("div", { class: "eikon-ins-mini" }, [
        "Currently stored in ",
        h("span", { class: "eikon-ins-kbd", text: "local browser storage" }, []),
        ". Next: D1 + Cloudflare Worker endpoints so this syncs across devices."
      ])
    ]);
  }

  function renderSettingsTab() {
    var user = ctxRef && ctxRef.user ? ctxRef.user : null;
    var key = storageKey(user);

    var exportBtn = btn("Export JSON", "eikon-btn", function () {
      try {
        var blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = "eikon_instructions_export_" + (ui.ymd || todayYmdUTC()) + ".json";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        flash("ok", "Exported.");
      } catch (e) {
        flash("err", "Export failed.");
      }
    });

    var importInput = h("input", { type: "file", accept: "application/json", class: "eikon-input" }, []);
    importInput.onchange = function () {
      var f = importInput.files && importInput.files[0];
      if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        var txt = String(r.result || "");
        var parsed = safeJsonParse(txt);
        if (!parsed) { flash("err", "Invalid JSON file."); return; }
        state = normalizeState(parsed);
        saveState();
        renderIntoMount();
      };
      r.onerror = function () { flash("err", "Could not read file."); };
      r.readAsText(f);
    };

    var clearBtn = btn("Reset (local) — wipe instructions", "eikon-btn danger", function () {
      var ok = window.confirm("This will clear ALL instructions stored in this browser for this org/location.\n\nContinue?");
      if (!ok) return;
      state = normalizeState(makeDefaultState());
      saveState();
      renderIntoMount();
    });

    return h("div", { class: "eikon-ins-grid" }, [
      h("div", { class: "eikon-card eikon-ins-card eikon-ins-col12" }, [
        h("div", { class: "eikon-ins-cardhead" }, [
          h("div", { class: "eikon-ins-title" }, [
            h("h3", { text: "Settings (Temporary Local Storage)" }, []),
            h("div", { class: "eikon-ins-sub", text: "Until we wire D1 + Worker endpoints, everything here is stored per-browser." }, []),
            h("div", { class: "eikon-ins-meta", text: "Storage key: " + key }, [])
          ]),
          h("div", { class: "eikon-ins-btnrow" }, [exportBtn])
        ]),
        h("div", { class: "eikon-ins-divider" }, []),
        h("div", { class: "eikon-ins-wrap" }, [
          h("div", {}, [
            h("div", { class: "eikon-ins-mini", text: "Import JSON (overwrites current local data):" }, []),
            importInput
          ]),
          h("div", { class: "eikon-ins-divider" }, []),
          clearBtn
        ])
      ])
    ]);
  }

  // ----------------------------
  // Main render
  // ----------------------------
  function tabBtn(id, label) {
    return h("button", {
      class: "eikon-ins-tabbtn" + (ui.tab === id ? " active" : ""),
      text: label,
      onclick: function () { ui.tab = id; renderIntoMount(); }
    }, []);
  }

  function renderIntoMount() {
    if (!mountRef) return;
    ensureStyles();

    if (!ui.ymd) ui.ymd = todayYmdUTC();
    if (!ui.monthYmd) ui.monthYmd = ui.ymd.slice(0, 7) + "-01";

    mountRef.innerHTML = "";

    var topRow = h("div", { class: "eikon-ins-top" }, [
      h("div", { class: "eikon-ins-tabs" }, [
        tabBtn("daily", "📆 Daily & Handover"),
        tabBtn("ops", "🗝️ Opening/Closing"),
        tabBtn("systems", "🧾 Systems"),
        tabBtn("clinical", "🧑‍⚕️ Clinical"),
        tabBtn("settings", "⚙️ Settings")
      ]),
      h("div", { class: "eikon-ins-actions" }, [
        ui.flash ? h("div", { class: "eikon-ins-flash " + (ui.flash.kind || ""), text: ui.flash.text || "" }, []) : null
      ])
    ]);

    var content;
    if (ui.tab === "daily") content = renderDailyTab();
    else if (ui.tab === "ops") content = renderOpsTab();
    else if (ui.tab === "systems") content = renderSystemsTab();
    else if (ui.tab === "clinical") content = renderClinicalTab();
    else content = renderSettingsTab();

    mountRef.appendChild(h("div", { class: "eikon-ins-wrap" }, [topRow, content]));
  }

  function render(ctx) {
    ctxRef = ctx;
    mountRef = ctx.mount;

    if (!state) state = loadState();
    else state = normalizeState(state);

    if (!ui.ymd) ui.ymd = todayYmdUTC();
    if (!ui.monthYmd) ui.monthYmd = ui.ymd.slice(0, 7) + "-01";

    renderIntoMount();
  }

  // ----------------------------
  // Register module
  // ----------------------------
  E.registerModule({
    id: MODULE_ID,
    title: "Instructions",
    icon: "📋",
    order: 22,
    render: render
  });

})();
