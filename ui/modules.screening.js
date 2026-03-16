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
      ".sc{--ac:#5aa2ff;--ac2:#7c6cff;--gd:#2ee59d;--pk:#ff6b9d;--wn:#ffcc66;--bg:#0b1220;--pnl:rgba(255,255,255,.03);--bd:rgba(255,255,255,.10);--r:16px;--r2:12px;--txt:#e8eefc;--mut:rgba(170,183,214,.78);font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:var(--txt);margin:-14px}",
      ".sc *{box-sizing:border-box}",
      /* hero */
      ".sc .hero{position:relative;border-radius:20px;border:1px solid var(--bd);overflow:hidden;padding:20px 22px 16px;margin-bottom:16px;background:linear-gradient(135deg,rgba(90,162,255,.16),rgba(124,108,255,.10),rgba(46,229,157,.06));box-shadow:0 14px 40px rgba(0,0,0,.3)}",
      ".sc .hero h2{margin:0 0 2px;font-size:20px;font-weight:900;letter-spacing:.3px}",
      ".sc .hero .sub{color:var(--mut);font-size:12.5px;margin-bottom:14px}",
      /* kpi */
      ".sc .kpi-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;margin-bottom:16px}",
      ".sc .kpi{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);padding:14px;text-align:center}",
      ".sc .kpi .n{font-size:28px;font-weight:900;letter-spacing:.3px}",
      ".sc .kpi .l{font-size:11.5px;color:var(--mut);margin-top:3px}",
      /* tabs */
      ".sc .tabs{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}",
      ".sc .tab{padding:9px 14px;border-radius:var(--r2);border:1px solid var(--bd);background:var(--pnl);color:var(--txt);cursor:pointer;font-size:13px;font-weight:700;transition:transform .08s,background .15s,border-color .15s}",
      ".sc .tab:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}",
      ".sc .tab:active{transform:translateY(1px)}",
      ".sc .tab.on{background:rgba(90,162,255,.16);border-color:rgba(90,162,255,.55)}",
      /* card */
      ".sc .card{border:1px solid var(--bd);border-radius:var(--r);background:var(--pnl);box-shadow:0 10px 28px rgba(0,0,0,.25);overflow:hidden;margin-bottom:14px}",
      ".sc .card .hd{padding:12px 16px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between;gap:10px}",
      ".sc .card .hd h3{margin:0;font-size:14px;font-weight:800}",
      ".sc .card .bd{padding:16px}",
      /* form */
      ".sc .row{display:grid;grid-template-columns:repeat(12,1fr);gap:12px}",
      ".sc .fld{display:flex;flex-direction:column;gap:5px}",
      ".sc .fld label{color:var(--mut);font-size:12px;font-weight:600}",
      ".sc .fld input,.sc .fld select,.sc .fld textarea{width:100%;border:1px solid var(--bd);background:rgba(0,0,0,.18);color:var(--txt);padding:9px 10px;border-radius:var(--r2);outline:none;font-size:13px;transition:border-color .15s,box-shadow .15s}",
      ".sc .fld input:focus,.sc .fld select:focus,.sc .fld textarea:focus{border-color:rgba(90,162,255,.6);box-shadow:0 0 0 3px rgba(90,162,255,.12)}",
      ".sc .fld textarea{min-height:64px;resize:vertical;line-height:1.35}",
      /* btn */
      ".sc .btn{border:1px solid var(--bd);background:var(--pnl);color:var(--txt);padding:9px 14px;border-radius:var(--r2);cursor:pointer;font-size:13px;font-weight:700;display:inline-flex;align-items:center;gap:8px;transition:transform .08s,background .15s,border-color .15s}",
      ".sc .btn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.18)}",
      ".sc .btn:active{transform:translateY(1px)}",
      ".sc .btn.pri{background:rgba(90,162,255,.18);border-color:rgba(90,162,255,.5);color:#8ac4ff}",
      ".sc .btn.ok{background:rgba(46,229,157,.15);border-color:rgba(46,229,157,.45);color:#6af0be}",
      ".sc .btn.dn{background:rgba(255,107,157,.15);border-color:rgba(255,107,157,.45);color:#ff9ebe}",
      ".sc .btn.sm{padding:6px 10px;font-size:12px}",
      /* table */
      ".sc table{width:100%;border-collapse:collapse;font-size:13px}",
      ".sc th{text-align:left;padding:10px 12px;border-bottom:2px solid var(--bd);color:var(--mut);font-size:11.5px;font-weight:700;text-transform:uppercase;letter-spacing:.3px}",
      ".sc td{padding:9px 12px;border-bottom:1px solid var(--bd)}",
      ".sc tr:hover td{background:rgba(255,255,255,.02)}",
      /* badges */
      ".sc .badge{display:inline-block;padding:3px 9px;border-radius:20px;font-size:11px;font-weight:700}",
      ".sc .badge.normal{background:rgba(46,229,157,.15);color:#6af0be}",
      ".sc .badge.borderline{background:rgba(255,204,102,.15);color:#ffcc66}",
      ".sc .badge.abnormal{background:rgba(255,107,157,.15);color:#ff9ebe}",
      ".sc .badge.urgent{background:rgba(255,80,80,.2);color:#ff6b6b}",
      ".sc .badge.active{background:rgba(90,162,255,.15);color:#8ac4ff}",
      ".sc .badge.completed{background:rgba(46,229,157,.15);color:#6af0be}",
      ".sc .badge.planned{background:rgba(255,204,102,.15);color:#ffcc66}",
      ".sc .badge.cancelled{background:rgba(255,255,255,.08);color:var(--mut)}",
      /* search */
      ".sc .search-bar{display:flex;gap:10px;align-items:center;margin-bottom:14px;flex-wrap:wrap}",
      ".sc .search-bar input{flex:1;min-width:180px;border:1px solid var(--bd);background:rgba(0,0,0,.18);color:var(--txt);padding:9px 12px;border-radius:var(--r2);outline:none;font-size:13px}",
      ".sc .search-bar input:focus{border-color:rgba(90,162,255,.6)}",
      /* modal */
      ".sc .modal-bg{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.6);z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px}",
      ".sc .modal{background:#111b2a;border:1px solid var(--bd);border-radius:var(--r);max-width:700px;width:100%;max-height:90vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.5)}",
      ".sc .modal .m-hd{padding:16px 20px;border-bottom:1px solid var(--bd);display:flex;align-items:center;justify-content:space-between}",
      ".sc .modal .m-hd h3{margin:0;font-size:16px;font-weight:800}",
      ".sc .modal .m-bd{padding:20px}",
      ".sc .modal .m-ft{padding:14px 20px;border-top:1px solid var(--bd);display:flex;justify-content:flex-end;gap:8px}",
      /* summary */
      ".sc .summary-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:16px}",
      ".sc .summary-item{border:1px solid var(--bd);border-radius:var(--r2);background:var(--pnl);padding:14px}",
      ".sc .summary-item .s-label{font-size:11.5px;color:var(--mut);font-weight:600;margin-bottom:4px}",
      ".sc .summary-item .s-value{font-size:22px;font-weight:900}",
      /* empty */
      ".sc .empty{text-align:center;padding:40px 20px;color:var(--mut);font-size:14px}",
      ".sc .empty .icon{font-size:40px;margin-bottom:10px}",
      /* responsive */
      "@media(max-width:700px){.sc .row{grid-template-columns:1fr !important}.sc .kpi-row{grid-template-columns:repeat(2,1fr)}.sc .summary-grid{grid-template-columns:1fr}}"
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
      hero.innerHTML = '<h2>\uD83E\uDE7A Clinical Screening Campaigns</h2><div class="sub">Plan and run health screening events &mdash; track participants, results &amp; referrals</div>';
      root.appendChild(hero);

      // KPI
      var activeCampaigns = campaigns.filter(function (c) { return getCampaignStatus(c) === "Active"; }).length;
      var kpiRow = document.createElement("div");
      kpiRow.className = "kpi-row";
      kpiRow.innerHTML =
        '<div class="kpi"><div class="n" style="color:#5aa2ff">' + campaigns.length + '</div><div class="l">Total Campaigns</div></div>' +
        '<div class="kpi"><div class="n" style="color:#2ee59d">' + activeCampaigns + '</div><div class="l">Active Now</div></div>' +
        '<div class="kpi"><div class="n" style="color:#7c6cff">' + totalParticipants + '</div><div class="l">Participants</div></div>' +
        '<div class="kpi"><div class="n" style="color:#ffcc66">' + totalAbnormal + '</div><div class="l">Abnormal Results</div></div>' +
        '<div class="kpi"><div class="n" style="color:#ff6b9d">' + totalReferrals + '</div><div class="l">Referrals Made</div></div>';
      root.appendChild(kpiRow);

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
      root.appendChild(tabs);

      if (activeTab === "campaigns" && activeCampaignId) {
        renderCampaignDetail(root, redraw);
      } else if (activeTab === "campaigns") {
        renderCampaignsList(root, redraw);
      } else if (activeTab === "participants") {
        renderAllParticipants(root, redraw);
      } else if (activeTab === "followups") {
        renderFollowUps(root, redraw);
      } else if (activeTab === "summary") {
        renderSummary(root, redraw);
      }
    }

    redraw();
  }

  // ── campaigns list ───────────────────────────────────────────────────────
  function renderCampaignsList(root, redraw) {
    var card = document.createElement("div");
    card.className = "card";

    var hd = document.createElement("div");
    hd.className = "hd";
    hd.innerHTML = '<h3>Campaigns</h3>';
    var addBtn = document.createElement("button");
    addBtn.className = "btn pri sm";
    addBtn.textContent = "+ New Campaign";
    addBtn.addEventListener("click", function () { showCampaignModal(null, redraw); });
    hd.appendChild(addBtn);
    card.appendChild(hd);

    var bd = document.createElement("div");
    bd.className = "bd";

    // search
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search campaigns...";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchBar.appendChild(searchInput);
    var searchBtn = document.createElement("button");
    searchBtn.className = "btn sm";
    searchBtn.textContent = "Search";
    searchBtn.addEventListener("click", function () { redraw(); });
    searchBar.appendChild(searchBtn);
    bd.appendChild(searchBar);

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
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDCCB</div>No campaigns yet. Create your first screening campaign to get started.</div>';
    } else {
      var table = document.createElement("table");
      table.innerHTML = '<thead><tr><th>Campaign</th><th>Type</th><th>Start</th><th>End</th><th>Participants</th><th>Status</th><th></th></tr></thead>';
      var tbody = document.createElement("tbody");
      filtered.forEach(function (c) {
        var status = getCampaignStatus(c);
        var pCount = (c.participants || []).length;
        var tr = document.createElement("tr");
        tr.style.cursor = "pointer";
        tr.innerHTML =
          '<td><strong>' + esc(c.name) + '</strong></td>' +
          '<td>' + esc(c.type) + '</td>' +
          '<td>' + fmtDate(c.startDate) + '</td>' +
          '<td>' + fmtDate(c.endDate) + '</td>' +
          '<td>' + pCount + '</td>' +
          '<td><span class="badge ' + norm(status) + '">' + esc(status) + '</span></td>' +
          '<td></td>';
        tr.addEventListener("click", function () { activeCampaignId = c.id; redraw(); });
        // action buttons
        var actionTd = tr.querySelector("td:last-child");
        var editBtn = document.createElement("button");
        editBtn.className = "btn sm";
        editBtn.textContent = "Edit";
        editBtn.addEventListener("click", function (e) { e.stopPropagation(); showCampaignModal(c, redraw); });
        actionTd.appendChild(editBtn);

        var delBtn = document.createElement("button");
        delBtn.className = "btn sm dn";
        delBtn.textContent = "Delete";
        delBtn.style.marginLeft = "4px";
        delBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          if (!confirm("Delete campaign \"" + c.name + "\"? This cannot be undone.")) return;
          campaigns = campaigns.filter(function (x) { return x.id !== c.id; });
          save();
          redraw();
        });
        actionTd.appendChild(delBtn);

        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── campaign detail ──────────────────────────────────────────────────────
  function renderCampaignDetail(root, redraw) {
    var c = campaigns.find(function (x) { return x.id === activeCampaignId; });
    if (!c) { activeCampaignId = null; redraw(); return; }

    // back button
    var backBtn = document.createElement("button");
    backBtn.className = "btn sm";
    backBtn.innerHTML = "&larr; Back to Campaigns";
    backBtn.style.marginBottom = "14px";
    backBtn.addEventListener("click", function () { activeCampaignId = null; redraw(); });
    root.appendChild(backBtn);

    var status = getCampaignStatus(c);
    var participants = c.participants || [];
    var abnormal = participants.filter(function (p) { return p.resultCategory === "Abnormal" || p.resultCategory === "Requires urgent attention"; }).length;
    var referrals = participants.filter(function (p) { return p.referral && p.referral !== "No referral needed"; }).length;

    // campaign header card
    var headerCard = document.createElement("div");
    headerCard.className = "card";
    headerCard.innerHTML =
      '<div class="hd"><h3>' + esc(c.name) + ' &mdash; <span class="badge ' + norm(status) + '">' + esc(status) + '</span></h3></div>' +
      '<div class="bd">' +
        '<div class="summary-grid">' +
          '<div class="summary-item"><div class="s-label">Type</div><div class="s-value" style="font-size:16px">' + esc(c.type) + '</div></div>' +
          '<div class="summary-item"><div class="s-label">Dates</div><div class="s-value" style="font-size:16px">' + fmtDate(c.startDate) + ' &mdash; ' + fmtDate(c.endDate) + '</div></div>' +
          '<div class="summary-item"><div class="s-label">Participants</div><div class="s-value">' + participants.length + '</div></div>' +
          '<div class="summary-item"><div class="s-label">Abnormal Results</div><div class="s-value" style="color:#ffcc66">' + abnormal + '</div></div>' +
          '<div class="summary-item"><div class="s-label">Referrals</div><div class="s-value" style="color:#ff6b9d">' + referrals + '</div></div>' +
        '</div>' +
        (c.notes ? '<div style="margin-top:8px;color:var(--mut);font-size:13px"><strong>Notes:</strong> ' + esc(c.notes) + '</div>' : '') +
      '</div>';
    root.appendChild(headerCard);

    // participants card
    var pCard = document.createElement("div");
    pCard.className = "card";
    var pHd = document.createElement("div");
    pHd.className = "hd";
    pHd.innerHTML = '<h3>Participants (' + participants.length + ')</h3>';
    var addPBtn = document.createElement("button");
    addPBtn.className = "btn pri sm";
    addPBtn.textContent = "+ Add Participant";
    addPBtn.addEventListener("click", function () { showParticipantModal(c, null, redraw); });
    pHd.appendChild(addPBtn);
    pCard.appendChild(pHd);

    var pBd = document.createElement("div");
    pBd.className = "bd";

    if (participants.length === 0) {
      pBd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDC65</div>No participants yet. Add sign-ups or walk-ins.</div>';
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
          '<td>' + esc(p.resultNotes || "-") + '</td>' +
          '<td>' + (p.resultCategory ? '<span class="badge ' + catClass + '">' + esc(p.resultCategory) + '</span>' : '-') + '</td>' +
          '<td>' + esc(p.referral || "-") + '</td>' +
          '<td>' + fuCount + '</td>' +
          '<td></td>';

        var actionTd = tr.querySelector("td:last-child");
        var eBtn = document.createElement("button");
        eBtn.className = "btn sm";
        eBtn.textContent = "Edit";
        eBtn.addEventListener("click", function () { showParticipantModal(c, p, redraw); });
        actionTd.appendChild(eBtn);

        var fuBtn = document.createElement("button");
        fuBtn.className = "btn sm pri";
        fuBtn.textContent = "Follow-up";
        fuBtn.style.marginLeft = "4px";
        fuBtn.addEventListener("click", function () { showFollowUpModal(c, p, null, redraw); });
        actionTd.appendChild(fuBtn);

        var dBtn = document.createElement("button");
        dBtn.className = "btn sm dn";
        dBtn.textContent = "Del";
        dBtn.style.marginLeft = "4px";
        dBtn.addEventListener("click", function () {
          if (!confirm("Remove participant \"" + p.name + "\"?")) return;
          c.participants = c.participants.filter(function (x) { return x.id !== p.id; });
          save();
          redraw();
        });
        actionTd.appendChild(dBtn);

        pTbody.appendChild(tr);
      });
      pTable.appendChild(pTbody);
      pBd.appendChild(pTable);
    }

    pCard.appendChild(pBd);
    root.appendChild(pCard);

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
      fuCard.innerHTML = '<div class="hd"><h3>Follow-ups (' + fuList.length + ')</h3></div>';
      var fuBd = document.createElement("div");
      fuBd.className = "bd";
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
      root.appendChild(fuCard);
    }
  }

  // ── all participants tab ─────────────────────────────────────────────────
  function renderAllParticipants(root, redraw) {
    var all = getAllParticipants();
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>All Participants (' + all.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

    // search
    var searchBar = document.createElement("div");
    searchBar.className = "search-bar";
    var searchInput = document.createElement("input");
    searchInput.type = "text";
    searchInput.placeholder = "Search by name, campaign, or referral...";
    searchInput.value = searchQ;
    searchInput.addEventListener("input", function () { searchQ = searchInput.value; });
    searchBar.appendChild(searchInput);
    var searchBtn = document.createElement("button");
    searchBtn.className = "btn sm";
    searchBtn.textContent = "Search";
    searchBtn.addEventListener("click", function () { redraw(); });
    searchBar.appendChild(searchBtn);
    bd.appendChild(searchBar);

    var filtered = all;
    if (searchQ) {
      var q = norm(searchQ);
      filtered = all.filter(function (p) {
        return norm(p.name).indexOf(q) !== -1 || norm(p.campaignName).indexOf(q) !== -1 || norm(p.referral).indexOf(q) !== -1;
      });
    }

    if (filtered.length === 0) {
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDC65</div>No participants found.</div>';
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
        tr.style.cursor = "pointer";
        tr.addEventListener("click", function () { activeTab = "campaigns"; activeCampaignId = p.campaignId; redraw(); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── follow-ups tab ───────────────────────────────────────────────────────
  function renderFollowUps(root, redraw) {
    var all = getAllFollowUps();
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>Follow-up Tracker (' + all.length + ')</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

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
      bd.innerHTML += '<div class="empty"><div class="icon">\uD83D\uDDD3\uFE0F</div>No follow-ups found.</div>';
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
        tr.style.cursor = "pointer";
        tr.addEventListener("click", function () { activeTab = "campaigns"; activeCampaignId = f.campaignId; redraw(); });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      bd.appendChild(table);
    }

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── summary tab ──────────────────────────────────────────────────────────
  function renderSummary(root, redraw) {
    var card = document.createElement("div");
    card.className = "card";
    card.innerHTML = '<div class="hd"><h3>Campaign Summary Report</h3></div>';
    var bd = document.createElement("div");
    bd.className = "bd";

    if (campaigns.length === 0) {
      bd.innerHTML = '<div class="empty"><div class="icon">\uD83D\uDCCA</div>No campaigns to summarize.</div>';
      card.appendChild(bd);
      root.appendChild(card);
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
    overallGrid.innerHTML =
      '<div class="summary-item"><div class="s-label">Total Campaigns</div><div class="s-value" style="color:#5aa2ff">' + campaigns.length + '</div></div>' +
      '<div class="summary-item"><div class="s-label">Total Screened</div><div class="s-value" style="color:#7c6cff">' + totalP + '</div></div>' +
      '<div class="summary-item"><div class="s-label">Abnormal Results</div><div class="s-value" style="color:#ffcc66">' + totalAbn + '</div></div>' +
      '<div class="summary-item"><div class="s-label">Referrals Made</div><div class="s-value" style="color:#ff6b9d">' + totalRef + '</div></div>' +
      '<div class="summary-item"><div class="s-label">Follow-ups Scheduled</div><div class="s-value" style="color:#2ee59d">' + totalFU + '</div></div>' +
      '<div class="summary-item"><div class="s-label">Abnormal Rate</div><div class="s-value">' + (totalP ? Math.round(totalAbn / totalP * 100) : 0) + '%</div></div>';
    bd.appendChild(overallGrid);

    // per-campaign breakdown
    var breakdownTitle = document.createElement("h4");
    breakdownTitle.style.cssText = "margin:18px 0 10px;font-size:14px;font-weight:800";
    breakdownTitle.textContent = "Per-Campaign Breakdown";
    bd.appendChild(breakdownTitle);

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
    bd.appendChild(table);

    // referral breakdown
    var refTitle = document.createElement("h4");
    refTitle.style.cssText = "margin:18px 0 10px;font-size:14px;font-weight:800";
    refTitle.textContent = "Referral Breakdown";
    bd.appendChild(refTitle);

    var refCounts = {};
    campaigns.forEach(function (c) {
      (c.participants || []).forEach(function (p) {
        var r = p.referral || "No referral needed";
        refCounts[r] = (refCounts[r] || 0) + 1;
      });
    });

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
    bd.appendChild(refTable);

    card.appendChild(bd);
    root.appendChild(card);
  }

  // ── campaign modal ───────────────────────────────────────────────────────
  function showCampaignModal(existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), name: "", type: CAMPAIGN_TYPES[0], startDate: todayStr(), endDate: "", notes: "", status: "Active", participants: [] };

    var bg = document.createElement("div");
    bg.className = "sc modal-bg";
    var modal = document.createElement("div");
    modal.className = "modal";

    modal.innerHTML =
      '<div class="m-hd"><h3>' + (isEdit ? "Edit Campaign" : "New Campaign") + '</h3><button class="btn sm close-m">&times;</button></div>' +
      '<div class="m-bd">' +
        '<div class="fld" style="margin-bottom:12px"><label>Campaign Name</label><input type="text" id="sc-m-name" placeholder="e.g. Diabetes Awareness Week" value="' + esc(data.name) + '"></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="fld"><label>Type</label><select id="sc-m-type">' + CAMPAIGN_TYPES.map(function (t) { return '<option' + (t === data.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join("") + '</select></div>' +
          '<div class="fld"><label>Status</label><select id="sc-m-status"><option' + (data.status === "Active" ? ' selected' : '') + '>Active</option><option' + (data.status === "Cancelled" ? ' selected' : '') + '>Cancelled</option></select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="fld"><label>Start Date</label><input type="date" id="sc-m-start" value="' + esc(data.startDate) + '"></div>' +
          '<div class="fld"><label>End Date</label><input type="date" id="sc-m-end" value="' + esc(data.endDate) + '"></div>' +
        '</div>' +
        '<div class="fld"><label>Notes</label><textarea id="sc-m-notes" placeholder="Campaign description, location, goals...">' + esc(data.notes) + '</textarea></div>' +
      '</div>' +
      '<div class="m-ft"><button class="btn close-m">Cancel</button><button class="btn pri" id="sc-m-save">Save</button></div>';

    bg.appendChild(modal);
    document.body.appendChild(bg);

    bg.querySelectorAll(".close-m").forEach(function (b) { b.addEventListener("click", function () { bg.remove(); }); });
    bg.addEventListener("click", function (e) { if (e.target === bg) bg.remove(); });

    modal.querySelector("#sc-m-save").addEventListener("click", function () {
      var name = modal.querySelector("#sc-m-name").value.trim();
      if (!name) { modal.querySelector("#sc-m-name").style.borderColor = "#ff5a7a"; return; }

      data.name = name;
      data.type = modal.querySelector("#sc-m-type").value;
      data.status = modal.querySelector("#sc-m-status").value;
      data.startDate = modal.querySelector("#sc-m-start").value;
      data.endDate = modal.querySelector("#sc-m-end").value;
      data.notes = modal.querySelector("#sc-m-notes").value.trim();

      if (isEdit) {
        var idx = campaigns.findIndex(function (c) { return c.id === data.id; });
        if (idx !== -1) { data.participants = campaigns[idx].participants; campaigns[idx] = data; }
      } else {
        campaigns.push(data);
      }

      save();
      bg.remove();
      redraw();
    });
  }

  // ── participant modal ────────────────────────────────────────────────────
  function showParticipantModal(campaign, existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), name: "", phone: "", email: "", dob: "", type: "Walk-in", date: todayStr(), resultNotes: "", resultCategory: "", referral: "No referral needed", referralNotes: "", followUps: [] };

    var bg = document.createElement("div");
    bg.className = "sc modal-bg";
    var modal = document.createElement("div");
    modal.className = "modal";

    modal.innerHTML =
      '<div class="m-hd"><h3>' + (isEdit ? "Edit Participant" : "Add Participant") + '</h3><button class="btn sm close-m">&times;</button></div>' +
      '<div class="m-bd">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="fld"><label>Full Name *</label><input type="text" id="sc-p-name" placeholder="Participant name" value="' + esc(data.name) + '"></div>' +
          '<div class="fld"><label>Phone</label><input type="text" id="sc-p-phone" placeholder="+356..." value="' + esc(data.phone) + '"></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="fld"><label>Date of Birth</label><input type="date" id="sc-p-dob" value="' + esc(data.dob) + '"></div>' +
          '<div class="fld"><label>Type</label><select id="sc-p-type">' + PARTICIPANT_TYPES.map(function (t) { return '<option' + (t === data.type ? ' selected' : '') + '>' + esc(t) + '</option>'; }).join("") + '</select></div>' +
          '<div class="fld"><label>Screening Date</label><input type="date" id="sc-p-date" value="' + esc(data.date) + '"></div>' +
        '</div>' +
        '<div style="border-top:1px solid var(--bd);padding-top:12px;margin-top:4px;margin-bottom:12px"><strong style="font-size:13px">Screening Results</strong> <span style="color:var(--mut);font-size:11px">(links to POCT for actual test recording)</span></div>' +
        '<div class="fld" style="margin-bottom:12px"><label>Result Notes</label><textarea id="sc-p-result" placeholder="Describe screening results...">' + esc(data.resultNotes) + '</textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="fld"><label>Result Category</label><select id="sc-p-cat"><option value="">-- Select --</option>' + RESULT_CATEGORIES.map(function (c) { return '<option' + (c === data.resultCategory ? ' selected' : '') + '>' + esc(c) + '</option>'; }).join("") + '</select></div>' +
          '<div class="fld"><label>Referral</label><select id="sc-p-ref">' + REFERRAL_OPTIONS.map(function (r) { return '<option' + (r === data.referral ? ' selected' : '') + '>' + esc(r) + '</option>'; }).join("") + '</select></div>' +
        '</div>' +
        '<div class="fld"><label>Referral Notes</label><textarea id="sc-p-refnotes" placeholder="Additional referral details...">' + esc(data.referralNotes) + '</textarea></div>' +
      '</div>' +
      '<div class="m-ft"><button class="btn close-m">Cancel</button><button class="btn pri" id="sc-p-save">Save</button></div>';

    bg.appendChild(modal);
    document.body.appendChild(bg);

    bg.querySelectorAll(".close-m").forEach(function (b) { b.addEventListener("click", function () { bg.remove(); }); });
    bg.addEventListener("click", function (e) { if (e.target === bg) bg.remove(); });

    modal.querySelector("#sc-p-save").addEventListener("click", function () {
      var name = modal.querySelector("#sc-p-name").value.trim();
      if (!name) { modal.querySelector("#sc-p-name").style.borderColor = "#ff5a7a"; return; }

      data.name = name;
      data.phone = modal.querySelector("#sc-p-phone").value.trim();
      data.dob = modal.querySelector("#sc-p-dob").value;
      data.type = modal.querySelector("#sc-p-type").value;
      data.date = modal.querySelector("#sc-p-date").value;
      data.resultNotes = modal.querySelector("#sc-p-result").value.trim();
      data.resultCategory = modal.querySelector("#sc-p-cat").value;
      data.referral = modal.querySelector("#sc-p-ref").value;
      data.referralNotes = modal.querySelector("#sc-p-refnotes").value.trim();

      if (!campaign.participants) campaign.participants = [];

      if (isEdit) {
        var idx = campaign.participants.findIndex(function (p) { return p.id === data.id; });
        if (idx !== -1) { data.followUps = campaign.participants[idx].followUps; campaign.participants[idx] = data; }
      } else {
        data.followUps = [];
        campaign.participants.push(data);
      }

      save();
      bg.remove();
      redraw();
    });
  }

  // ── follow-up modal ──────────────────────────────────────────────────────
  function showFollowUpModal(campaign, participant, existing, redraw) {
    var isEdit = !!existing;
    var data = existing ? Object.assign({}, existing) : { id: uid(), scheduledDate: "", reason: "", status: "Pending", notes: "" };

    var bg = document.createElement("div");
    bg.className = "sc modal-bg";
    var modal = document.createElement("div");
    modal.className = "modal";

    modal.innerHTML =
      '<div class="m-hd"><h3>' + (isEdit ? "Edit Follow-up" : "Schedule Follow-up") + ' &mdash; ' + esc(participant.name) + '</h3><button class="btn sm close-m">&times;</button></div>' +
      '<div class="m-bd">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div class="fld"><label>Scheduled Date *</label><input type="date" id="sc-f-date" value="' + esc(data.scheduledDate) + '"></div>' +
          '<div class="fld"><label>Status</label><select id="sc-f-status">' + FOLLOW_UP_STATUS.map(function (s) { return '<option' + (s === data.status ? ' selected' : '') + '>' + esc(s) + '</option>'; }).join("") + '</select></div>' +
        '</div>' +
        '<div class="fld" style="margin-bottom:12px"><label>Reason</label><input type="text" id="sc-f-reason" placeholder="e.g. Re-test blood pressure, GP referral follow-up" value="' + esc(data.reason) + '"></div>' +
        '<div class="fld"><label>Notes</label><textarea id="sc-f-notes" placeholder="Additional notes...">' + esc(data.notes) + '</textarea></div>' +
      '</div>' +
      '<div class="m-ft"><button class="btn close-m">Cancel</button>' +
        (isEdit ? '<button class="btn dn" id="sc-f-del">Delete</button>' : '') +
        '<button class="btn pri" id="sc-f-save">Save</button></div>';

    bg.appendChild(modal);
    document.body.appendChild(bg);

    bg.querySelectorAll(".close-m").forEach(function (b) { b.addEventListener("click", function () { bg.remove(); }); });
    bg.addEventListener("click", function (e) { if (e.target === bg) bg.remove(); });

    if (isEdit) {
      modal.querySelector("#sc-f-del").addEventListener("click", function () {
        if (!confirm("Delete this follow-up?")) return;
        participant.followUps = (participant.followUps || []).filter(function (f) { return f.id !== data.id; });
        save();
        bg.remove();
        redraw();
      });
    }

    modal.querySelector("#sc-f-save").addEventListener("click", function () {
      var scheduledDate = modal.querySelector("#sc-f-date").value;
      if (!scheduledDate) { modal.querySelector("#sc-f-date").style.borderColor = "#ff5a7a"; return; }

      data.scheduledDate = scheduledDate;
      data.status = modal.querySelector("#sc-f-status").value;
      data.reason = modal.querySelector("#sc-f-reason").value.trim();
      data.notes = modal.querySelector("#sc-f-notes").value.trim();

      if (!participant.followUps) participant.followUps = [];

      if (isEdit) {
        var idx = participant.followUps.findIndex(function (f) { return f.id === data.id; });
        if (idx !== -1) participant.followUps[idx] = data;
      } else {
        participant.followUps.push(data);
      }

      save();
      bg.remove();
      redraw();
    });
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
