/* ui/modules.screening.js
   Eikon – Clinical Screening Campaigns module

   Plan and run health screening events and campaigns
   (e.g. Diabetes Awareness Week, Blood Pressure Month, Cholesterol Check Day).

   Endpoints:
     GET  /screening/state
     PUT  /screening/state
*/

(function () {
  "use strict";

  var E = window.EIKON;
  if (!E) return;

  // ── helpers ──────────────────────────────────────────────────────────────
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function uid() { return "sc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8); }
  function todayStr() { var d = new Date(), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()); }
  function fmtDate(v) {
    if (!v) return "-";
    var s = String(v);
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { var p = s.split("-"); return p[2] + "/" + p[1] + "/" + p[0]; }
    return s;
  }
  function norm(s) { return String(s || "").trim().toLowerCase(); }
  async function api(method, path, body) {
    var o = { method: method };
    if (body !== undefined) { o.headers = { "Content-Type": "application/json" }; o.body = JSON.stringify(body); }
    return E.apiFetch(path, o);
  }

  // ── toast ────────────────────────────────────────────────────────────────
  var toastWrap = null;
  function toast(msg, kind) {
    if (!toastWrap) {
      toastWrap = document.createElement("div");
      toastWrap.className = "sc-toast-wrap";
      document.body.appendChild(toastWrap);
    }
    var t = document.createElement("div");
    t.className = "sc-toast " + (kind || "good");
    t.innerHTML = '<span class="sc-toast-dot"></span>' + esc(msg);
    toastWrap.appendChild(t);
    requestAnimationFrame(function () { t.classList.add("show"); });
    setTimeout(function () {
      t.classList.remove("show");
      setTimeout(function () { t.remove(); }, 250);
    }, 2400);
  }

  // ── cloud store ──────────────────────────────────────────────────────────
  var campaigns = [];
  var dirty = false;
  var syncing = false;
  var currentUser = null;

  async function cloudLoad() {
    try {
      var r = await api("GET", "/screening/state");
      campaigns = Array.isArray(r.campaigns) ? r.campaigns : (r.state && Array.isArray(r.state.campaigns) ? r.state.campaigns : []);
    } catch (e) { E.warn("[screening] cloudLoad error", e); }
  }

  async function cloudSave() {
    if (syncing) return;
    syncing = true;
    try { await api("PUT", "/screening/state", { state: { campaigns: campaigns } }); dirty = false; }
    catch (e) { E.warn("[screening] cloudSave error", e); }
    finally { syncing = false; }
  }

  function save() { dirty = true; cloudSave(); }

  // ── reference data ───────────────────────────────────────────────────────
  var CAMPAIGN_TYPES = [
    "Blood Pressure Check", "Diabetes Screening", "Cholesterol Check",
    "Blood Glucose Monitoring", "BMI Assessment", "Cardiovascular Risk",
    "Respiratory Function", "Bone Density", "Mental Health Awareness",
    "Smoking Cessation", "Flu Vaccination", "COVID Booster",
    "Skin Cancer Awareness", "General Health Check", "Other"
  ];

  var CAMPAIGN_TYPE_ICONS = {
    "Blood Pressure Check": "\uD83E\uDEC0", "Diabetes Screening": "\uD83E\uDE78",
    "Cholesterol Check": "\uD83E\uDDEA", "Blood Glucose Monitoring": "\uD83D\uDCC8",
    "BMI Assessment": "\u2696\uFE0F", "Cardiovascular Risk": "\u2764\uFE0F",
    "Respiratory Function": "\uD83E\uDEC1", "Bone Density": "\uD83E\uDDB4",
    "Mental Health Awareness": "\uD83E\uDDE0", "Smoking Cessation": "\uD83D\uDEAD",
    "Flu Vaccination": "\uD83D\uDC89", "COVID Booster": "\uD83E\uDDA0",
    "Skin Cancer Awareness": "\u2600\uFE0F", "General Health Check": "\uD83E\uDE7A",
    "Other": "\uD83D\uDCCB"
  };

  var REFERRAL_OPTIONS = [
    "No referral needed", "Referred to GP", "Referred to specialist",
    "Referred to hospital", "Referred to dietitian", "Referred to pharmacist follow-up",
    "Self-monitoring advised", "Other"
  ];

  var RESULT_CATEGORIES = ["Normal", "Borderline", "Abnormal", "Requires urgent attention"];

  var PARTICIPANT_TYPES = ["Pre-registered", "Walk-in"];

  var FOLLOW_UP_STATUS = ["Pending", "Scheduled", "Completed", "No-show", "Cancelled"];

  // ── styles ───────────────────────────────────────────────────────────────
  var stylesDone = false;
  function ensureStyles() {
    if (stylesDone) return; stylesDone = true;
    var s = document.createElement("style"); s.id = "eikon-screening-style";
    s.textContent = [
      /* root + ambient background */
      ".sc{--ac:#4ea1ff;--ac2:#7c6cff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.035);--pnl2:rgba(255,255,255,.055);--bd:rgba(255,255,255,.09);--bd2:rgba(255,255,255,.14);--r:18px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.72);--shadow:0 12px 36px rgba(0,0,0,.35);font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;color:var(--txt);margin:-14px;min-height:calc(100vh - 56px);background:radial-gradient(1200px 600px at 10% 8%,rgba(78,161,255,.13),transparent 60%),radial-gradient(900px 500px at 88% 15%,rgba(124,108,255,.10),transparent 55%),radial-gradient(800px 600px at 50% 100%,rgba(46,229,157,.07),transparent 50%)}",
      ".sc *{box-sizing:border-box}",
      ".sc .container{max-width:1200px;margin:0 auto;padding:22px 20px 40px}",

      /* ── hero ── */
      ".sc .hero{position:relative;border-radius:22px;border:1px solid var(--bd2);overflow:hidden;padding:28px 28px 22px;margin-bottom:20px;background:linear-gradient(135deg,rgba(78,161,255,.14),rgba(124,108,255,.10),rgba(46,229,157,.06));box-shadow:var(--shadow);backdrop-filter:blur(8px)}",
      ".sc .hero::before{content:'';position:absolute;inset:0;background:radial-gradient(600px circle at 80% 20%,rgba(124,108,255,.12),transparent 60%);pointer-events:none}",
      ".sc .hero h2{margin:0 0 4px;font-size:22px;font-weight:900;letter-spacing:.3px;position:relative}",
      ".sc .hero .sub{color:var(--mut);font-size:13px;position:relative}",

      /* ── KPI row ── */
      ".sc .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px}",
      ".sc .kpi{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);padding:18px 14px;text-align:center;backdrop-filter:blur(6px);transition:transform .15s,border-color .2s,box-shadow .2s}",
      ".sc .kpi:hover{transform:translateY(-2px);border-color:var(--bd2);box-shadow:0 8px 24px rgba(0,0,0,.25)}",
      ".sc .kpi .n{font-size:30px;font-weight:900;letter-spacing:.5px;line-height:1.1}",
      ".sc .kpi .l{font-size:11px;color:var(--mut);margin-top:5px;text-transform:uppercase;letter-spacing:.5px;font-weight:600}",

      /* ── tabs ── */
      ".sc .tabs{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:18px;padding:4px;background:var(--pnl);border-radius:14px;border:1px solid var(--bd)}",
      ".sc .tab{padding:10px 18px;border-radius:10px;border:none;background:transparent;color:var(--mut);cursor:pointer;font-size:13px;font-weight:700;transition:all .18s;position:relative}",
      ".sc .tab:hover{color:var(--txt);background:rgba(255,255,255,.05)}",
      ".sc .tab.on{color:var(--txt);background:rgba(78,161,255,.15);box-shadow:0 2px 12px rgba(78,161,255,.15)}",

      /* ── card ── */
      ".sc .card{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);box-shadow:var(--shadow);overflow:hidden;margin-bottom:16px;backdrop-filter:blur(6px);transition:border-color .2s}",
      ".sc .card:hover{border-color:var(--bd2)}",
      ".sc .card .hd{padding:14px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--pnl)}",
      ".sc .card .hd h3{margin:0;font-size:15px;font-weight:800}",
      ".sc .card .bd{padding:20px}",

      /* ── form fields ── */
      ".sc .fld{display:flex;flex-direction:column;gap:5px}",
      ".sc .fld label{color:var(--mut);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.4px}",
      ".sc .fld input,.sc .fld select,.sc .fld textarea{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.22);color:var(--txt);padding:10px 12px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s,box-shadow .2s}",
      ".sc .fld input:focus,.sc .fld select:focus,.sc .fld textarea:focus{border-color:rgba(78,161,255,.55);box-shadow:0 0 0 3px rgba(78,161,255,.12)}",
      ".sc .fld textarea{min-height:68px;resize:vertical;line-height:1.4}",
      ".sc .fld input::placeholder,.sc .fld textarea::placeholder{color:rgba(170,183,214,.4)}",

      /* ── buttons ── */
      ".sc .btn{border:1px solid var(--bd);background:var(--pnl2);color:var(--txt);padding:9px 16px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:all .15s;position:relative;overflow:hidden}",
      ".sc .btn:hover{background:rgba(255,255,255,.08);border-color:var(--bd2);transform:translateY(-1px)}",
      ".sc .btn:active{transform:translateY(0)}",
      ".sc .btn.pri{background:linear-gradient(135deg,rgba(78,161,255,.22),rgba(124,108,255,.18));border-color:rgba(78,161,255,.4);color:#8ac4ff}",
      ".sc .btn.pri:hover{background:linear-gradient(135deg,rgba(78,161,255,.3),rgba(124,108,255,.24));border-color:rgba(78,161,255,.55);box-shadow:0 4px 16px rgba(78,161,255,.15)}",
      ".sc .btn.ok{background:linear-gradient(135deg,rgba(46,229,157,.18),rgba(46,229,157,.12));border-color:rgba(46,229,157,.4);color:#6af0be}",
      ".sc .btn.dn{background:linear-gradient(135deg,rgba(255,107,157,.18),rgba(255,107,157,.12));border-color:rgba(255,107,157,.35);color:#ff9ebe}",
      ".sc .btn.dn:hover{background:linear-gradient(135deg,rgba(255,107,157,.28),rgba(255,107,157,.2));border-color:rgba(255,107,157,.5);box-shadow:0 4px 16px rgba(255,107,157,.12)}",
      ".sc .btn.sm{padding:7px 12px;font-size:12px;border-radius:10px}",

      /* ── table ── */
      ".sc table{width:100%;border-collapse:collapse;font-size:13px}",
      ".sc th{text-align:left;padding:11px 14px;border-bottom:2px solid var(--bd2);color:var(--mut);font-size:10.5px;font-weight:700;text-transform:uppercase;letter-spacing:.6px;position:sticky;top:0;background:rgba(11,18,32,.92);backdrop-filter:blur(6px);z-index:2}",
      ".sc td{padding:10px 14px;border-bottom:1px solid var(--bd);transition:background .12s}",
      ".sc tbody tr{transition:background .12s}",
      ".sc tbody tr:hover td{background:rgba(78,161,255,.04)}",
      ".sc tbody tr:hover{cursor:pointer}",

      /* ── badges ── */
      ".sc .badge{display:inline-flex;align-items:center;gap:5px;padding:4px 11px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.2px}",
      ".sc .badge::before{content:'';width:6px;height:6px;border-radius:50%}",
      ".sc .badge.normal{background:rgba(46,229,157,.12);color:#6af0be}.sc .badge.normal::before{background:#2ee59d}",
      ".sc .badge.borderline{background:rgba(255,204,102,.12);color:#ffcc66}.sc .badge.borderline::before{background:#ffcc66}",
      ".sc .badge.abnormal{background:rgba(255,107,157,.12);color:#ff9ebe}.sc .badge.abnormal::before{background:#ff6b9d}",
      ".sc .badge.urgent{background:rgba(255,80,80,.15);color:#ff6b6b}.sc .badge.urgent::before{background:#ff5050}",
      ".sc .badge.active{background:rgba(78,161,255,.12);color:#8ac4ff}.sc .badge.active::before{background:#4ea1ff}",
      ".sc .badge.completed{background:rgba(46,229,157,.12);color:#6af0be}.sc .badge.completed::before{background:#2ee59d}",
      ".sc .badge.planned{background:rgba(255,204,102,.12);color:#ffcc66}.sc .badge.planned::before{background:#ffcc66}",
      ".sc .badge.cancelled{background:rgba(255,255,255,.06);color:var(--mut)}.sc .badge.cancelled::before{background:rgba(170,183,214,.4)}",

      /* ── search ── */
      ".sc .search-bar{display:flex;gap:10px;align-items:center;margin-bottom:16px;flex-wrap:wrap}",
      ".sc .search-bar input{flex:1;min-width:200px;border:1px solid var(--bd);background:rgba(0,0,0,.22);color:var(--txt);padding:10px 14px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .2s}",
      ".sc .search-bar input:focus{border-color:rgba(78,161,255,.55);box-shadow:0 0 0 3px rgba(78,161,255,.1)}",

      /* ── modal ── (note: NO space between .sc and .modal-bg — element has both classes) */
      ".sc-modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.55);backdrop-filter:blur(6px);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;opacity:0;transition:opacity .2s}",
      ".sc-modal-bg.show{opacity:1}",
      ".sc-modal{background:linear-gradient(165deg,#141e30,#111b2a 40%,#0f1824);border:1px solid var(--bd2);border-radius:20px;max-width:680px;width:100%;max-height:85vh;overflow-y:auto;box-shadow:0 24px 80px rgba(0,0,0,.55),0 0 0 1px rgba(255,255,255,.04) inset;transform:translateY(12px) scale(.97);transition:transform .25s cubic-bezier(.16,1,.3,1),opacity .2s;opacity:0}",
      ".sc-modal-bg.show .sc-modal{transform:translateY(0) scale(1);opacity:1}",
      ".sc-modal .m-hd{padding:20px 24px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;background:linear-gradient(135deg,rgba(78,161,255,.06),rgba(124,108,255,.04))}",
      ".sc-modal .m-hd h3{margin:0;font-size:17px;font-weight:800}",
      ".sc-modal .m-bd{padding:22px 24px}",
      ".sc-modal .m-ft{padding:16px 24px;border-top:1px solid var(--bd);display:flex;justify-content:flex-end;gap:8px;background:rgba(0,0,0,.1)}",
      ".sc-modal .close-x{width:32px;height:32px;border-radius:10px;border:1px solid var(--bd);background:rgba(255,255,255,.04);color:var(--mut);font-size:18px;cursor:pointer;display:flex;align-items:center;justify-content:center;transition:all .15s}",
      ".sc-modal .close-x:hover{background:rgba(255,107,157,.12);border-color:rgba(255,107,157,.3);color:#ff9ebe}",

      /* ── toast ── */
      ".sc-toast-wrap{position:fixed;right:16px;bottom:16px;z-index:99999;display:flex;flex-direction:column;gap:8px;pointer-events:none}",
      ".sc-toast{display:flex;align-items:center;gap:10px;padding:12px 18px;border-radius:14px;font-size:13px;font-weight:600;background:rgba(11,18,32,.88);backdrop-filter:blur(10px);border:1px solid var(--bd);box-shadow:0 10px 30px rgba(0,0,0,.4);opacity:0;transform:translateY(8px);transition:all .22s}",
      ".sc-toast.show{opacity:1;transform:translateY(0)}",
      ".sc-toast-dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}",
      ".sc-toast.good .sc-toast-dot{background:#2ee59d}",
      ".sc-toast.bad .sc-toast-dot{background:#ff6b9d}",
      ".sc-toast.warn .sc-toast-dot{background:#ffcc66}",

      /* ── campaign cards (grid) ── */
      ".sc .camp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px}",
      ".sc .camp-card{border:1px solid var(--bd);border-radius:16px;background:var(--pnl);padding:18px;cursor:pointer;transition:all .18s;position:relative;overflow:hidden}",
      ".sc .camp-card::before{content:'';position:absolute;top:0;left:0;right:0;height:3px;border-radius:3px 3px 0 0;background:linear-gradient(90deg,var(--ac),var(--ac2));opacity:.6;transition:opacity .2s}",
      ".sc .camp-card:hover{border-color:var(--bd2);transform:translateY(-2px);box-shadow:0 8px 28px rgba(0,0,0,.3)}",
      ".sc .camp-card:hover::before{opacity:1}",
      ".sc .camp-card .cc-top{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;margin-bottom:10px}",
      ".sc .camp-card .cc-icon{font-size:26px;line-height:1}",
      ".sc .camp-card .cc-name{font-size:15px;font-weight:800;margin-bottom:2px}",
      ".sc .camp-card .cc-type{font-size:12px;color:var(--mut)}",
      ".sc .camp-card .cc-meta{display:flex;gap:16px;font-size:12px;color:var(--mut);margin-top:10px;padding-top:10px;border-top:1px solid var(--bd)}",
      ".sc .camp-card .cc-meta span{display:flex;align-items:center;gap:4px}",
      ".sc .camp-card .cc-stat{font-weight:800;color:var(--txt)}",
      ".sc .camp-card .cc-actions{display:flex;gap:6px;margin-top:12px}",

      /* ── summary grid ── */
      ".sc .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px}",
      ".sc .summary-item{border:1px solid var(--bd);border-radius:14px;background:var(--pnl);padding:18px;backdrop-filter:blur(4px);transition:border-color .2s}",
      ".sc .summary-item:hover{border-color:var(--bd2)}",
      ".sc .summary-item .s-label{font-size:10.5px;color:var(--mut);font-weight:700;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}",
      ".sc .summary-item .s-value{font-size:26px;font-weight:900}",

      /* ── empty state ── */
      ".sc .empty{text-align:center;padding:50px 20px;color:var(--mut)}",
      ".sc .empty .icon{font-size:48px;margin-bottom:12px;opacity:.7}",
      ".sc .empty .msg{font-size:14px;margin-bottom:16px}",

      /* ── detail header ── */
      ".sc .detail-hero{border:1px solid var(--bd2);border-radius:var(--r);background:linear-gradient(135deg,rgba(78,161,255,.08),rgba(124,108,255,.06));padding:22px 24px;margin-bottom:16px;backdrop-filter:blur(6px)}",
      ".sc .detail-hero h3{font-size:18px;font-weight:900;margin:0 0 12px;display:flex;align-items:center;gap:10px}",

      /* ── scrollbar ── */
      ".sc ::-webkit-scrollbar{width:6px}",
      ".sc ::-webkit-scrollbar-track{background:transparent}",
      ".sc ::-webkit-scrollbar-thumb{background:rgba(255,255,255,.12);border-radius:3px}",
      ".sc ::-webkit-scrollbar-thumb:hover{background:rgba(255,255,255,.2)}",

      /* ── responsive ── */
      "@media(max-width:700px){.sc .container{padding:14px 12px}.sc .kpi-row{grid-template-columns:repeat(2,1fr)}.sc .camp-grid{grid-template-columns:1fr}.sc .summary-grid{grid-template-columns:1fr}.sc-modal{max-width:100%;border-radius:16px}}"
    ].join("\n");
    document.head.appendChild(s);
  }

  // ── campaign helpers ─────────────────────────────────────────────────────
  function getCampaignStatus(c) {
    var today = todayStr();
    if (c.status === "Cancelled") return "Cancelled";
    if (c.endDate && c.endDate < today) return "Completed";
    if (c.startDate && c.startDate <= today && (!c.endDate || c.endDate >= today)) return "Active";
    return "Planned";
  }

  function getAllParticipants() {
    var all = [];
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        all.push(Object.assign({}, p, { campaignId: c.id, campaignName: c.name }));
      });
    });
    return all;
  }

  function getAllFollowUps() {
    var all = [];
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        (p.followUps || []).forEach(function (f) {
          all.push(Object.assign({}, f, { participantId: p.id, participantName: p.name, campaignId: c.id, campaignName: c.name }));
        });
      });
    });
    return all;
  }

  // ── modal helper ─────────────────────────────────────────────────────────
  function openModal(title, bodyHtml, footerHtml) {
    var bg = document.createElement("div");
    bg.className = "sc-modal-bg";
    var modal = document.createElement("div");
    modal.className = "sc-modal";
    modal.innerHTML =
      '<div class="m-hd"><h3>' + title + '</h3><button class="close-x">&times;</button></div>' +
      '<div class="m-bd">' + bodyHtml + '</div>' +
      '<div class="m-ft">' + footerHtml + '</div>';
    bg.appendChild(modal);
    document.body.appendChild(bg);
    // animate in
    requestAnimationFrame(function () { requestAnimationFrame(function () { bg.classList.add("show"); }); });
    // close handlers
    function close() {
      bg.classList.remove("show");
      setTimeout(function () { bg.remove(); }, 220);
    }
    modal.querySelector(".close-x").addEventListener("click", close);
    bg.addEventListener("click", function (e) { if (e.target === bg) close(); });
    return { bg: bg, modal: modal, close: close };
  }

  // ── render ───────────────────────────────────────────────────────────────
  var activeTab = "campaigns";
  var activeCampaignId = null;
  var searchQ = "";

  async function render(ctx) {
    var mount = ctx.mount;
    currentUser = ctx.user;
    ensureStyles();

    await cloudLoad();

    mount.innerHTML = "";
    var root = document.createElement("div");
    root.className = "sc";
    mount.appendChild(root);

    function redraw() {
      root.innerHTML = "";
      var container = document.createElement("div");
      container.className = "container";
      root.appendChild(container);

      // hero
      var hero = document.createElement("div");
      hero.className = "hero";
      var totalParticipants = 0, totalAbnormal = 0, totalReferrals = 0;
      campaigns.forEach(function (c) {
        (c.participants || []).forEach(function (p) {
          totalParticipants++;
          if (p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention") totalAbnormal++;
          if (p.referral && p.referral !== "No referral needed") totalReferrals++;
        });
      });
      hero.innerHTML = '<h2>\uD83E\uDE7A Clinical Screening Campaigns</h2><div class="sub">Plan and run health screening events \u2014 track participants, results &amp; referrals</div>';
      container.appendChild(hero);

      // KPI
      var activeCampaigns = campaigns.filter(function (c) { return getCampaignStatus(c) === "Active"; }).length;
      var kpiRow = document.createElement("div");
      kpiRow.className = "kpi-row";
      var kpis = [
        { n: campaigns.length, l: "Campaigns", color: "#4ea1ff" },
        { n: activeCampaigns, l: "Active Now", color: "#2ee59d" },
        { n: totalParticipants, l: "Screened", color: "#7c6cff" },
        { n: totalAbnormal, l: "Abnormal", color: "#ffcc66" },
        { n: totalReferrals, l: "Referrals", color: "#ff6b9d" }
      ];
      kpis.forEach(function (k) {
        kpiRow.innerHTML += '<div class="kpi"><div class="n" style="color:' + k.color + '">' + k.n + '</div><div class="l">' + k.l + '</div></div>';
      });
      container.appendChild(kpiRow);

      // tabs
      var tabs = document.createElement("div");
      tabs.className = "tabs";
      var tabDefs = [
        { id: "campaigns", label: "Campaigns" },
        { id: "participants", label: "All Participants" },
        { id: "followups", label: "Follow-ups" },
        { id: "summary", label: "Summary" }
      ];
      tabDefs.forEach(function (t) {
        var b = document.createElement("button");
        b.className = "tab" + (activeTab === t.id ? " on" : "");
        b.textContent = t.label;
        b.addEventListener("click", function () { activeTab = t.id; activeCampaignId = null; searchQ = ""; redraw(); });
        tabs.appendChild(b);
      });
      container.appendChild(tabs);

      if (activeTab === "campaigns" && activeCampaignId) {
        renderCampaignDetail(container, redraw);
      } else if (activeTab === "campaigns") {
        renderCampaignsList(container, redraw);
      } else if (activeTab === "participants") {
        renderAllParticipants(container, redraw);
      } else if (activeTab === "followups") {
        renderFollowUps(container, redraw);
      } else if (activeTab === "summary") {
        renderSummary(container, redraw);
      }
    }

    redraw();
  }

  // ── campaigns list (card grid) ───────────────────────────────────────────
  function renderCampaignsList(container, redraw) {
    // header row
    var hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:14px;flex-wrap:wrap;gap:10px";
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    searchBar.style.marginBottom = "0";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search campaigns\u2026";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") redraw(); });
    searchBar.appendChild(searchInput);
    hdr.appendChild(searchBar);

    var addBtn = document.createElement("button");
    addBtn.className = "btn pri";
    addBtn.innerHTML = "<span style='font-size:16px'>+</span> New Campaign";
    addBtn.addEventListener("click", function () { showCampaignModal(null, redraw); });
    hdr.appendChild(addBtn);
    container.appendChild(hdr);

    var filtered = campaigns;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = campaigns.filter(function (c) {
        return norm(c.name).indexOf(q) !== -1 || norm(c.type).indexOf(q) !== -1;
      });
    }

    // sort by start date desc
    filtered = filtered.slice().sort(function (a, b) { return (b.startDate || "").localeCompare(a.startDate || ""); });

    if (filtered.length === 0) {
      container.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDCCB</div><div class="msg">No campaigns yet. Create your first screening campaign to get started.</div></div>';
      return;
    }

    var grid = document.createElement("div");
    grid.className = "camp-grid";

    filtered.forEach(function (c) {
      var status = getCampaignStatus(c);
      var pCount = (c.participants || []).length;
      var abn = (c.participants || []).filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
      var refs = (c.participants || []).filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
      var icon = CAMPAIGN_TYPE_ICONS[c.type] || "\uD83D\uDCCB";

      var card = document.createElement("div");
      card.className = "camp-card";
      card.innerHTML =
        '<div class="cc-top">' +
          '<div><div class="cc-name">' + esc(c.name) + '</div><div class="cc-type">' + esc(c.type) + '</div></div>' +
          '<div style="display:flex;align-items:center;gap:8px"><span class="badge ' + norm(status) + '">' + esc(status) + '</span><span class="cc-icon">' + icon + '</span></div>' +
        '</div>' +
        '<div class="cc-meta">' +
          '<span>\uD83D\uDCC5 ' + fmtDate(c.startDate) + (c.endDate ? ' \u2013 ' + fmtDate(c.endDate) : '') + '</span>' +
        '</div>' +
        '<div class="cc-meta">' +
          '<span>\uD83D\uDC65 <span class="cc-stat">' + pCount + '</span> screened</span>' +
          '<span>\u26A0\uFE0F <span class="cc-stat" style="color:#ffcc66">' + abn + '</span> abnormal</span>' +
          '<span>\uD83D\uDCE4 <span class="cc-stat" style="color:#ff6b9d">' + refs + '</span> referrals</span>' +
        '</div>' +
        '<div class="cc-actions"></div>';

      var actions = card.querySelector(".cc-actions");
      var viewBtn = document.createElement("button");
      viewBtn.className = "btn sm pri";
      viewBtn.textContent = "View Details";
      viewBtn.addEventListener("click", function (e) { e.stopPropagation(); activeCampaignId = c.id; redraw(); });
      actions.appendChild(viewBtn);

      var editBtn = document.createElement("button");
      editBtn.className = "btn sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", function (e) { e.stopPropagation(); showCampaignModal(c, redraw); });
      actions.appendChild(editBtn);

      var delBtn = document.createElement("button");
      delBtn.className = "btn sm dn";
      delBtn.textContent = "Delete";
      delBtn.addEventListener("click", function (e) {
        e.stopPropagation();
        if (!confirm("Delete campaign \"" + c.name + "\"? This cannot be undone.")) return;
        campaigns = campaigns.filter(function (x) { return x.id !== c.id; });
        save();
        toast("Campaign deleted", "warn");
        redraw();
      });
      actions.appendChild(delBtn);

      card.addEventListener("click", function () { activeCampaignId = c.id; redraw(); });
      grid.appendChild(card);
    });

    container.appendChild(grid);
  }

  // ── campaign detail ──────────────────────────────────────────────────────
  function renderCampaignDetail(container, redraw) {
    var c = campaigns.find(function (x) { return x.id === activeCampaignId; });
    if (!c) { activeCampaignId = null; redraw(); return; }

    // back button
    var backBtn = document.createElement("button");
    backBtn.className = "btn sm";
    backBtn.innerHTML = "\u2190 Back to Campaigns";
    backBtn.style.marginBottom = "14px";
    backBtn.addEventListener("click", function () { activeCampaignId = null; redraw(); });
    container.appendChild(backBtn);

    var status = getCampaignStatus(c);
    var participants = c.participants || [];
    var abnormal = participants.filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
    var referrals = participants.filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
    var icon = CAMPAIGN_TYPE_ICONS[c.type] || "\uD83D\uDCCB";

    // detail hero
    var dh = document.createElement("div");
    dh.className = "detail-hero";
    dh.innerHTML =
      '<h3><span style="font-size:24px">' + icon + '</span> ' + esc(c.name) + ' <span class="badge ' + norm(status) + '">' + esc(status) + '</span></h3>' +
      '<div class="summary-grid" style="margin-bottom:0">' +
        '<div class="summary-item"><div class="s-label">Type</div><div class="s-value" style="font-size:16px">' + esc(c.type) + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Period</div><div class="s-value" style="font-size:16px">' + fmtDate(c.startDate) + ' \u2014 ' + fmtDate(c.endDate) + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Participants</div><div class="s-value" style="color:#7c6cff">' + participants.length + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Abnormal</div><div class="s-value" style="color:#ffcc66">' + abnormal + '</div></div>' +
        '<div class="summary-item"><div class="s-label">Referrals</div><div class="s-value" style="color:#ff6b9d">' + referrals + '</div></div>' +
      '</div>' +
      (c.notes ? '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--bd);color:var(--mut);font-size:13px"><strong style="color:var(--txt)">Notes:</strong> ' + esc(c.notes) + '</div>' : '');
    container.appendChild(dh);

    // participants card
    var pCard = document.createElement("div");
    pCard.className = "card";
    var pHd = document.createElement("div");
    pHd.className = "hd";
    pHd.innerHTML = '<h3>\uD83D\uDC65 Participants (' + participants.length + ')</h3>';
    var addPBtn = document.createElement("button");
    addPBtn.className = "btn pri sm";
    addPBtn.textContent = "+ Add Participant";
    addPBtn.addEventListener("click", function () { showParticipantModal(c, null, redraw); });
    pHd.appendChild(addPBtn);
    pCard.appendChild(pHd);

    var pBd = document.createElement("div");
    pBd.className = "bd";
    pBd.style.overflowX = "auto";

    if (participants.length === 0) {
      pBd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDC65</div><div class="msg">No participants yet. Add sign-ups or walk-ins.</div></div>';
    } else {
      var pTable = document.createElement("table");
      pTable.innerHTML = '<thead><tr><th>Name</th><th>Type</th><th>Date</th><th>Result</th><th>Category</th><th>Referral</th><th>Follow-ups</th><th></th></tr></thead>';
      var pTbody = document.createElement("tbody");
      participants.forEach(function (p) {
        var fuCount = (p.followUps || []).length;
        var catClass = norm(p.resultCategory || "").replace(/\s+/g, "");
        if (catClass === "requiresurgentattention") catClass = "urgent";
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><strong>' + esc(p.name) + '</strong>' + (p.phone ? '<br><span style="color:var(--mut);font-size:11px">' + esc(p.phone) + '</span>' : '') + '</td>' +
          '<td>' + esc(p.type || "Walk-in") + '</td>' +
          '<td>' + fmtDate(p.date) + '</td>' +
          '<td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + esc(p.resultNotes || "-") + '</td>' +
          '<td>' + (p.resultCategory ? '<span class="badge ' + catClass + '">' + esc(p.resultCategory) + '</span>' : '-') + '</td>' +
          '<td>' + esc(p.referral || "-") + '</td>' +
          '<td style="text-align:center">' + fuCount + '</td>' +
          '<td style="white-space:nowrap"></td>';

        var actionTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function (ev) { ev.stopPropagation(); showParticipantModal(c, p, redraw); });
        actionTd.appendChild(eBtn);

        var fuBtn = document.createElement("button");
        fuBtn.className = "btn sm pri";
        fuBtn.textContent = "Follow-up";
        fuBtn.style.marginLeft = "4px";
        fuBtn.addEventListener("click", function (ev) { ev.stopPropagation(); showFollowUpModal(c, p, null, redraw); });
        actionTd.appendChild(fuBtn);

        var dBtn = document.createElement("button");
        dBtn.className = "btn sm dn";
        dBtn.textContent = "Del";
        dBtn.style.marginLeft = "4px";
        dBtn.addEventListener("click", function (ev) {
          ev.stopPropagation();
          if (!confirm("Remove participant \"" + p.name + "\"?")) return;
          c.participants = c.participants.filter(function (x) { return x.id !== p.id; });
          save();
          toast("Participant removed", "warn");
          redraw();
        });
        actionTd.appendChild(dBtn);

        pTbody.appendChild(tr);
      });
      pTable.appendChild(pTbody);
      pBd.appendChild(pTable);
    }

    pCard.appendChild(pBd);
    container.appendChild(pCard);

    // follow-ups for this campaign
    var fuList = [];
    participants.forEach(function (p) {
      (p.followUps || []).forEach(function (f) {
        fuList.push(Object.assign({}, f, { participantName: p.name, participantId: p.id }));
      });
    });

    if (fuList.length > 0) {
      var fuCard = document.createElement("div");
      fuCard.className = "card";
      fuCard.innerHTML = '<div class="hd"><h3>\uD83D\uDDD3\uFE0F Follow-ups (' + fuList.length + ')</h3></div>';
      var fuBd = document.createElement("div");
      fuBd.className = "bd";
      fuBd.style.overflowX = "auto";
      var fuTable = document.createElement("table");
      fuTable.innerHTML = '<thead><tr><th>Participant</th><th>Scheduled</th><th>Reason</th><th>Status</th><th>Notes</th><th></th></tr></thead>';
      var fuTbody = document.createElement("tbody");
      fuList.forEach(function (f) {
        var tr = document.createElement("tr");
        var statusClass = norm(f.status || "pending");
        tr.innerHTML =
          '<td>' + esc(f.participantName) + '</td>' +
          '<td>' + fmtDate(f.scheduledDate) + '</td>' +
          '<td>' + esc(f.reason || "-") + '</td>' +
          '<td><span class="badge ' + (statusClass === "completed" ? "completed" : statusClass === "scheduled" ? "active" : statusClass === "no-show" ? "abnormal" : "planned") + '">' + esc(f.status || "Pending") + '</span></td>' +
          '<td>' + esc(f.notes || "-") + '</td>' +
          '<td></td>';
        var aTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function () {
          var participant = participants.find(function (p) { return p.id === f.participantId; });
          if (participant) showFollowUpModal(c, participant, f, redraw);
        });
        aTd.appendChild(eBtn);
        fuTbody.appendChild(tr);
      });
      fuTable.appendChild(fuTbody);
      fuBd.appendChild(fuTable);
      fuCard.appendChild(fuBd);
      container.appendChild(fuCard);
    }
  }

  // ── all participants tab ─────────────────────────────────────────────────
  function renderAllParticipants(container, redraw) {
    var all = getAllParticipants();
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDC65 All Participants (' + all.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";

    // search
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by name, campaign, or referral\u2026";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchInput.addEventListener("keydown", function (e) { if (e.key === "Enter") redraw(); });
    searchBar.appendChild(searchInput);
    bd.appendChild(searchBar);

    var filtered = all;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = all.filter(function (p) {
        return norm(p.name).indexOf(q) !== -1 || norm(p.campaignName).indexOf(q) !== -1 || norm(p.referral).indexOf(q) !== -1;
      });
    }

    if (filtered.length === 0) {
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDC65</div><div class="msg">No participants found.</div></div>';
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>Name</th><th>Campaign</th><th>Date</th><th>Category</th><th>Referral</th></tr></thead>';
      var tbody = document.createElement("tbody");
      filtered.forEach(function (p) {
        var catClass = norm(p.resultCategory || "").replace(/\s+/g, "");
        if (catClass === "requiresurgentattention") catClass = "urgent";
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><strong>' + esc(p.name) + '</strong></td>' +
          '<td>' + esc(p.campaignName) + '</td>' +
          '<td>' + fmtDate(p.date) + '</td>' +
          '<td>' + (p.resultCategory ? '<span class="badge ' + catClass + '">' + esc(p.resultCategory) + '</span>' : '-') + '</td>' +
          '<td>' + esc(p.referral || "-") + '</td>';
        tr.addEventListener("click", function () { activeTab = "campaigns"; activeCampaignId = p.campaignId; redraw(); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── follow-ups tab ───────────────────────────────────────────────────────
  function renderFollowUps(container, redraw) {
    var all = getAllFollowUps();
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDDD3\uFE0F Follow-up Tracker (' + all.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";
    bd.style.overflowX = "auto";

    // filter buttons
    var filterBar = document.createElement("div");
    filterBar.style.cssText = "display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap";
    var filterStatuses = ["All"].concat(FOLLOW_UP_STATUS);
    var activeFilter = searchQ || "All";
    filterStatuses.forEach(function (st) {
      var b = document.createElement("button");
      b.className = "btn sm" + (activeFilter === st ? " pri" : "");
      b.textContent = st;
      b.addEventListener("click", function () { searchQ = st === "All" ? "" : st; redraw(); });
      filterBar.appendChild(b);
    });
    bd.appendChild(filterBar);

    var filtered = all;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = all.filter(function (f) { return norm(f.status) === q; });
    }

    // sort by scheduled date
    filtered.sort(function (a, b) { return (a.scheduledDate || "").localeCompare(b.scheduledDate || ""); });

    if (filtered.length === 0) {
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDDD3\uFE0F</div><div class="msg">No follow-ups found.</div></div>';
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>Participant</th><th>Campaign</th><th>Scheduled</th><th>Reason</th><th>Status</th><th>Notes</th></tr></thead>';
      var tbody = document.createElement("tbody");
      filtered.forEach(function (f) {
        var statusClass = norm(f.status || "pending");
        var tr = document.createElement("tr");
        tr.innerHTML =
          '<td><strong>' + esc(f.participantName) + '</strong></td>' +
          '<td>' + esc(f.campaignName) + '</td>' +
          '<td>' + fmtDate(f.scheduledDate) + '</td>' +
          '<td>' + esc(f.reason || "-") + '</td>' +
          '<td><span class="badge ' + (statusClass === "completed" ? "completed" : statusClass === "scheduled" ? "active" : statusClass === "no-show" ? "abnormal" : "planned") + '">' + esc(f.status || "Pending") + '</span></td>' +
          '<td>' + esc(f.notes || "-") + '</td>';
        tr.addEventListener("click", function () { activeTab = "campaigns"; activeCampaignId = f.campaignId; redraw(); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── summary tab ──────────────────────────────────────────────────────────
  function renderSummary(container, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>\uD83D\uDCCA Campaign Summary Report</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

    if (campaigns.length === 0) {
      bd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDCCA</div><div class="msg">No campaigns to summarize.</div></div>';
      card.appendChild(bd);
      container.appendChild(card);
      return;
    }

    // overall summary
    var totalP = 0, totalAbn = 0, totalRef = 0, totalFU = 0;
    var byCampaign = [];

    campaigns.forEach(function (c) {
      var participants = c.participants || [];
      var pCount = participants.length;
      var abn = participants.filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
      var refs = participants.filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;
      var fus = 0;
      participants.forEach(function (p) { fus += (p.followUps || []).length; });

      totalP += pCount;
      totalAbn += abn;
      totalRef += refs;
      totalFU += fus;

      byCampaign.push({ name: c.name, type: c.type, status: getCampaignStatus(c), participants: pCount, abnormal: abn, referrals: refs, followUps: fus });
    });

    // overall KPIs
    var overallGrid = document.createElement("div");
    overallGrid.className = "summary-grid";
    var summaryKpis = [
      { l: "Total Campaigns", v: campaigns.length, color: "#4ea1ff" },
      { l: "Total Screened", v: totalP, color: "#7c6cff" },
      { l: "Abnormal Results", v: totalAbn, color: "#ffcc66" },
      { l: "Referrals Made", v: totalRef, color: "#ff6b9d" },
      { l: "Follow-ups", v: totalFU, color: "#2ee59d" },
      { l: "Abnormal Rate", v: (totalP ? Math.round(totalAbn / totalP * 100) : 0) + "%", color: "#a78bfa" }
    ];
    summaryKpis.forEach(function (k) {
      overallGrid.innerHTML += '<div class="summary-item"><div class="s-label">' + k.l + '</div><div class="s-value" style="color:' + k.color + '">' + k.v + '</div></div>';
    });
    bd.appendChild(overallGrid);

    // per-campaign breakdown
    var breakdownTitle = document.createElement("h4");
    breakdownTitle.style.cssText = "margin:20px 0 12px;font-size:14px;font-weight:800";
    breakdownTitle.textContent = "Per-Campaign Breakdown";
    bd.appendChild(breakdownTitle);

    var tableWrap = document.createElement("div");
    tableWrap.style.overflowX = "auto";
    var table = document.createElement("table");
    table.innerHTML = '<thead><tr><th>Campaign</th><th>Type</th><th>Status</th><th>Screened</th><th>Abnormal</th><th>Referrals</th><th>Follow-ups</th></tr></thead>';
    var tbody = document.createElement("tbody");
    byCampaign.forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td><strong>' + esc(r.name) + '</strong></td>' +
        '<td>' + esc(r.type) + '</td>' +
        '<td><span class="badge ' + norm(r.status) + '">' + esc(r.status) + '</span></td>' +
        '<td>' + r.participants + '</td>' +
        '<td>' + r.abnormal + '</td>' +
        '<td>' + r.referrals + '</td>' +
        '<td>' + r.followUps + '</td>';
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    tableWrap.appendChild(table);
    bd.appendChild(tableWrap);

    // referral breakdown
    var refTitle = document.createElement("h4");
    refTitle.style.cssText = "margin:20px 0 12px;font-size:14px;font-weight:800";
    refTitle.textContent = "Referral Breakdown";
    bd.appendChild(refTitle);

    var refCounts = {};
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        var r = p.referral || "No referral needed";
        refCounts[r] = (refCounts[r] || 0) + 1;
      });
    });

    var refTableWrap = document.createElement("div");
    refTableWrap.style.overflowX = "auto";
    var refTable = document.createElement("table");
    refTable.innerHTML = '<thead><tr><th>Referral Type</th><th>Count</th><th>%</th></tr></thead>';
    var refTbody = document.createElement("tbody");
    Object.keys(refCounts).sort(function (a, b) { return refCounts[b] - refCounts[a]; }).forEach(function (r) {
      var tr = document.createElement("tr");
      tr.innerHTML =
        '<td>' + esc(r) + '</td>' +
        '<td>' + refCounts[r] + '</td>' +
        '<td>' + (totalP ? Math.round(refCounts[r] / totalP * 100) : 0) + '%</td>';
      refTbody.appendChild(tr);
    });
    refTable.appendChild(refTbody);
    refTableWrap.appendChild(refTable);
    bd.appendChild(refTableWrap);

    card.appendChild(bd);
    container.appendChild(card);
  }

  // ── campaign modal ───────────────────────────────────────────────────────
  function showCampaignModal(existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), name: "", type: CAMPAIGN_TYPES[0], startDate: todayStr(), endDate: "", notes: "", status: "Active", participants: [] };

    var bodyHtml =
      '<div class="sc"><div class="fld" style="margin-bottom:14px"><label>Campaign Name</label><input type="text" id="sc-m-name" placeholder="e.g. Diabetes Awareness Week" value="' + esc(data.name) + '"></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Type</label><select id="sc-m-type">' + CAMPAIGN_TYPES.map(function (t) { return '<option' + (t === data.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Status</label><select id="sc-m-status"><option' + (data.status === "Active" ? ' selected' : '') + '>Active</option><option' + (data.status === "Cancelled" ? ' selected' : '') + '>Cancelled</option></select></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Start Date</label><input type="date" id="sc-m-start" value="' + esc(data.startDate) + '"></div>' +
        '<div class="fld"><label>End Date</label><input type="date" id="sc-m-end" value="' + esc(data.endDate) + '"></div>' +
      '</div>' +
      '<div class="fld"><label>Notes</label><textarea id="sc-m-notes" placeholder="Campaign description, location, goals\u2026">' + esc(data.notes) + '</textarea></div></div>';

    var footerHtml = '<button class="sc btn close-cancel">Cancel</button><button class="sc btn pri" id="sc-m-save">Save Campaign</button>';

    var m = openModal(isEdit ? "Edit Campaign" : "New Campaign", bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    m.modal.querySelector("#sc-m-save").addEventListener("click", function () {
      var name = m.modal.querySelector("#sc-m-name").value.trim();
      if (!name) { m.modal.querySelector("#sc-m-name").style.borderColor = "#ff5a7a"; return; }

      data.name = name;
      data.type = m.modal.querySelector("#sc-m-type").value;
      data.status = m.modal.querySelector("#sc-m-status").value;
      data.startDate = m.modal.querySelector("#sc-m-start").value;
      data.endDate = m.modal.querySelector("#sc-m-end").value;
      data.notes = m.modal.querySelector("#sc-m-notes").value.trim();

      if (isEdit) {
        var idx = campaigns.findIndex(function (c) { return c.id === data.id; });
        if (idx !== -1) { data.participants = campaigns[idx].participants; campaigns[idx] = data; }
      } else {
        campaigns.push(data);
      }

      save();
      m.close();
      toast(isEdit ? "Campaign updated" : "Campaign created", "good");
      redraw();
    });

    // focus first field
    setTimeout(function () { var f = m.modal.querySelector("#sc-m-name"); if (f) f.focus(); }, 80);
  }

  // ── participant modal ────────────────────────────────────────────────────
  function showParticipantModal(campaign, existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), name: "", phone: "", email: "", dob: "", type: "Walk-in", date: todayStr(), resultNotes: "", resultCategory: "", referral: "No referral needed", referralNotes: "", followUps: [] };

    var bodyHtml =
      '<div class="sc"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Full Name *</label><input type="text" id="sc-p-name" placeholder="Participant name" value="' + esc(data.name) + '"></div>' +
        '<div class="fld"><label>Phone</label><input type="text" id="sc-p-phone" placeholder="+356\u2026" value="' + esc(data.phone) + '"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Date of Birth</label><input type="date" id="sc-p-dob" value="' + esc(data.dob) + '"></div>' +
        '<div class="fld"><label>Type</label><select id="sc-p-type">' + PARTICIPANT_TYPES.map(function (t) { return '<option' + (t === data.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Screening Date</label><input type="date" id="sc-p-date" value="' + esc(data.date) + '"></div>' +
      '</div>' +
      '<div style="border-top:1px solid var(--bd);padding-top:14px;margin-bottom:14px"><strong style="font-size:13px;color:var(--txt)">Screening Results</strong> <span style="color:var(--mut);font-size:11px">(links to POCT for actual test recording)</span></div>' +
      '<div class="fld" style="margin-bottom:14px"><label>Result Notes</label><textarea id="sc-p-result" placeholder="Describe screening results\u2026">' + esc(data.resultNotes) + '</textarea></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Result Category</label><select id="sc-p-cat"><option value="">-- Select --</option>' + RESULT_CATEGORIES.map(function (c) { return '<option' + (c === data.resultCategory ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join("") + '</select></div>' +
        '<div class="fld"><label>Referral</label><select id="sc-p-ref">' + REFERRAL_OPTIONS.map(function (r) { return '<option' + (r === data.referral ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="fld"><label>Referral Notes</label><textarea id="sc-p-refnotes" placeholder="Additional referral details\u2026">' + esc(data.referralNotes) + '</textarea></div></div>';

    var footerHtml = '<button class="sc btn close-cancel">Cancel</button><button class="sc btn pri" id="sc-p-save">Save Participant</button>';

    var m = openModal(isEdit ? "Edit Participant" : "Add Participant", bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    m.modal.querySelector("#sc-p-save").addEventListener("click", function () {
      var name = m.modal.querySelector("#sc-p-name").value.trim();
      if (!name) { m.modal.querySelector("#sc-p-name").style.borderColor = "#ff5a7a"; return; }

      data.name = name;
      data.phone = m.modal.querySelector("#sc-p-phone").value.trim();
      data.dob = m.modal.querySelector("#sc-p-dob").value;
      data.type = m.modal.querySelector("#sc-p-type").value;
      data.date = m.modal.querySelector("#sc-p-date").value;
      data.resultNotes = m.modal.querySelector("#sc-p-result").value.trim();
      data.resultCategory = m.modal.querySelector("#sc-p-cat").value;
      data.referral = m.modal.querySelector("#sc-p-ref").value;
      data.referralNotes = m.modal.querySelector("#sc-p-refnotes").value.trim();

      if (!campaign.participants) campaign.participants = [];

      if (isEdit) {
        var idx = campaign.participants.findIndex(function (p) { return p.id === data.id; });
        if (idx !== -1) { data.followUps = campaign.participants[idx].followUps; campaign.participants[idx] = data; }
      } else {
        data.followUps = [];
        campaign.participants.push(data);
      }

      save();
      m.close();
      toast(isEdit ? "Participant updated" : "Participant added", "good");
      redraw();
    });

    setTimeout(function () { var f = m.modal.querySelector("#sc-p-name"); if (f) f.focus(); }, 80);
  }

  // ── follow-up modal ──────────────────────────────────────────────────────
  function showFollowUpModal(campaign, participant, existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), scheduledDate: "", reason: "", status: "Pending", notes: "" };

    var bodyHtml =
      '<div class="sc"><div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">' +
        '<div class="fld"><label>Scheduled Date *</label><input type="date" id="sc-f-date" value="' + esc(data.scheduledDate) + '"></div>' +
        '<div class="fld"><label>Status</label><select id="sc-f-status">' + FOLLOW_UP_STATUS.map(function (s) { return '<option' + (s === data.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join("") + '</select></div>' +
      '</div>' +
      '<div class="fld" style="margin-bottom:14px"><label>Reason</label><input type="text" id="sc-f-reason" placeholder="e.g. Re-test blood pressure, GP referral follow-up" value="' + esc(data.reason) + '"></div>' +
      '<div class="fld"><label>Notes</label><textarea id="sc-f-notes" placeholder="Additional notes\u2026">' + esc(data.notes) + '</textarea></div></div>';

    var footerHtml = '<button class="sc btn close-cancel">Cancel</button>' +
      (isEdit ? '<button class="sc btn dn" id="sc-f-del">Delete</button>' : '') +
      '<button class="sc btn pri" id="sc-f-save">Save Follow-up</button>';

    var m = openModal((isEdit ? "Edit" : "Schedule") + " Follow-up \u2014 " + esc(participant.name), bodyHtml, footerHtml);
    m.modal.querySelector(".close-cancel").addEventListener("click", m.close);

    if (isEdit) {
      m.modal.querySelector("#sc-f-del").addEventListener("click", function () {
        if (!confirm("Delete this follow-up?")) return;
        participant.followUps = (participant.followUps || []).filter(function (f) { return f.id !== data.id; });
        save();
        m.close();
        toast("Follow-up deleted", "warn");
        redraw();
      });
    }

    m.modal.querySelector("#sc-f-save").addEventListener("click", function () {
      var scheduledDate = m.modal.querySelector("#sc-f-date").value;
      if (!scheduledDate) { m.modal.querySelector("#sc-f-date").style.borderColor = "#ff5a7a"; return; }

      data.scheduledDate = scheduledDate;
      data.status = m.modal.querySelector("#sc-f-status").value;
      data.reason = m.modal.querySelector("#sc-f-reason").value.trim();
      data.notes = m.modal.querySelector("#sc-f-notes").value.trim();

      if (!participant.followUps) participant.followUps = [];

      if (isEdit) {
        var idx = participant.followUps.findIndex(function (f) { return f.id === data.id; });
        if (idx !== -1) participant.followUps[idx] = data;
      } else {
        participant.followUps.push(data);
      }

      save();
      m.close();
      toast(isEdit ? "Follow-up updated" : "Follow-up scheduled", "good");
      redraw();
    });

    setTimeout(function () { var f = m.modal.querySelector("#sc-f-date"); if (f) f.focus(); }, 80);
  }

  // ── register ─────────────────────────────────────────────────────────────
  E.registerModule({
    id: "screening",
    title: "Screening Campaigns",
    icon: "\uD83E\uDE7A",
    order: 70,
    render: render
  });

})();
