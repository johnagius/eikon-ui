/* ============================================================
   EIKON — Hubs  (modules.hubs.js)
   The reimagined rail: Today, Customers, Bookings, Stock, Registers, Services,
   Money, Team, Settings. Stock, Registers, Services, Money, Team and Settings are doors: one calm page each,
   every existing function one tap behind it, described in a sentence a new
   locum understands. Nothing is removed; it is put where it belongs.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // Card names in sentence case like the rebuilt screens ("End of day", "Stock transfers"); acronyms stay (DDA, POYC, POS, OTC).
  // Only here: the classic sidebar keeps the module titles as they are.
  function sentence(t) {
    return String(t).split(" ").map(function (w, i) {
      if (!i || w.length < 2 || w === w.toUpperCase() || /\d/.test(w)) return w;
      return w.charAt(0).toLowerCase() + w.slice(1);
    }).join(" ");
  }
  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  // One sentence per function. Titles come from the modules themselves.
  var DESC = {
    temperature: "Log fridge and room readings each day, against their limits.",
    cleaning: "Record when the dispensary and fridge were cleaned, and by whom.",
    dailyregister: "Prescription medicines supplied, one line each.",
    locumregister: "Which pharmacist was in charge, and when.",
    "dda-purchases": "Every delivery of a controlled drug, by invoice.",
    "dda-sales": "Every controlled drug handed over against a prescription.",
    "dda-poyc": "Controlled drugs given under the POYC scheme.",
    dda_stocktakes: "Count each controlled drug and keep the count on file, ready to print.",
    repeatprescriptions: "Prescriptions kept on file, and when each one runs out.",
    rotreg: "This week at a glance: who works, when, and who is away.",
    ssreg: "What other pharmacies are looking for, and what you asked for.",
    certificates: "Calibrations, services and licences, with what is due.",
    audit: "Every change, who made it and when.",
    cdreg: "Each controlled drug's running balance, and any difference from the count.",
    expreg: "Your registers as a spreadsheet, or printed for an inspector, for any month or year.",
    insreg: "Is every register in order? Days not logged, notes missing, certificates due; printed with sign-off lines.",
    ownreg: "Takings this week and month against the last, what needs you, hours, controlled-drug totals and month-end reports.",
    endofday: "Close the till: X readings, cash, cheques and the bank bag.",
    paidout: "Money paid from the till, such as couriers and cleaners.",
    "emergency-pos": "Sell when the main till is down; sales are sent when the connection is back.",
    creditnotes: "Money customers have with you, and what is left of it.",
    locumreceipts: "What each locum was paid, ready to print and sign.",
    poct: "Blood pressure, glucose, cholesterol and other tests, per patient.",
    vaccines: "Order vaccines for clients, for travel or routine jabs.",
    screening: "Health-check events and the people screened at each.",
    pharmacovigilance: "Report a reaction to a medicine and follow the report.",
    ocps: "Find a contraceptive pill by its hormones and doses.",
    pharmacycalc: "Dosing plans and supply for levothyroxine, steroid tapers, warfarin, insulin and methotrexate.",
    otcmindmap: "What to recommend over the counter, by symptom.",
    labels: "Print dispensing labels in English or Maltese.",
    alerts: "Recalls and quarantines, with each step ticked off.",
    nearexpiry: "What expires soon, nearest first.",
    scarcestock: "Hard-to-get lines other pharmacies have spare.",
    "order-diary": "What to order, by supplier, and what came in.",
    "supplier-inventory": "Browse a supplier's stock and send them an order.",
    quotations: "Compare supplier quotes, cheapest first, with your margin.",
    returns: "Stock going back to suppliers, until the credit note.",
    stocktransfers: "Stock moving between your pharmacies.",
    clientorders: "Items ordered in for a customer.",
    tickets: "Questions customers are waiting on.",
    deliveries: "Home deliveries, routes and proof of delivery.",
    appointments: "Clinic bookings and the waiting list.",
    loyalty: "Loyalty cards, points and campaigns.",
    shifts: "Plan the rota: add or change shifts, answer leave requests.",
    instructions: "What the last shift left you, and what you leave the next one.",
    messageboard: "Messages between pharmacies, kept for six months.",
    contacts: "Suppliers, reps, doctors, head office, one list.",
    teamreg: "Add a person, give a new password, switch off someone who has left."
  };

  // Each screen has one home tab (E.UI2_PARENT in core.js): the rail lights it and the back button returns to it.
  // Second doors kept where staff already look: Team › Locums, Settings › Contacts, Registers › Proof, Stock › Price (credit notes).
  var HUBS = {
    stock: {
      title: "Stock", lead: "What to order, what is on its way, and what is short or at risk.",
      groups: [
        { label: "Watch", ids: ["alerts", "nearexpiry", "ssreg", "scarcestock"] },
        { label: "Order", ids: ["order-diary", "supplier-inventory"] },
        { label: "Send back or move", ids: ["returns", "stocktransfers"] },
        { label: "Price", ids: ["quotations", "creditnotes"] } // credit notes live in Money; this second door stays where staff know it
      ]
    },
    registers: {
      title: "Registers", lead: "The books an inspector asks for: fill them in, see what is missing, and print any month.",
      groups: [
        { label: "Every day", ids: ["temperature", "cleaning", "dailyregister", "locumregister"] },
        { label: "Controlled drugs", ids: ["cdreg", "dda-purchases", "dda-sales", "dda-poyc", "dda_stocktakes"] }, // cdreg: the cd builder's screen, shown once it is in the build
        { label: "Prescriptions", ids: ["repeatprescriptions"] },
        { label: "Inspection and certificates", ids: ["insreg", "certificates", "audit"] } // was "Proof" (not a pharmacist's word). Certificates live here; the audit trail's home is Settings
      ]
    },
    services: {
      title: "Services", lead: "Care given at the counter or by appointment, and the tools for it.",
      groups: [
        { label: "Clinical", ids: ["poct", "vaccines", "screening", "pharmacovigilance"] },
        { label: "Look up and print", ids: ["ocps", "pharmacycalc", "otcmindmap", "labels"] }
      ]
    },
    money: {
      title: "Money", lead: "How the pharmacy is doing, the till, and what it owes or holds for others.",
      groups: [
        { label: "How we're doing", ids: ["ownreg"] }, // the pharmacist in charge only (adminOnly)
        { label: "Till", ids: ["endofday", "paidout", "emergency-pos"] },
        { label: "Customers and locums", ids: ["creditnotes", "locumreceipts"] } // was "Owed": a locum receipt is money paid, not owed
      ]
    },
    team: {
      title: "Team", lead: "Who is in, what they need to know, and what they are owed.",
      groups: [
        { label: "Today", ids: ["rotreg", "shifts", "instructions", "messageboard"] },
        { label: "Locums", ids: ["locumregister", "locumreceipts"] },
        { label: "People we call", ids: ["contacts"] },
        { label: "Sign-ins", ids: ["teamreg"] } // admin only (the module says adminOnly)
      ]
    },
    settings: {
      title: "Settings", lead: "Your account, this pharmacy, help, and the classic layout.",
      groups: [
        // Phones: the bottom bar has room for six words, so Team, Services and Money are reached from here ("More").
        { label: "More", phoneOnly: true, actions: [
          { title: "Team", desc: "Who is in, handover, shifts and contacts.", run: function () { window.location.hash = "#team"; } },
          { title: "Services", desc: "Tests, vaccines, screening and counter tools.", run: function () { window.location.hash = "#services"; } },
          { title: "Money", desc: "How we're doing, end of day, paid out, the emergency till, credit notes and locum receipts.", run: function () { window.location.hash = "#money"; } }
        ] },
        { label: "You", actions: [
          { title: "Password", desc: "Change the password you sign in with.", run: function () { E.showChangePassword(); } },
          { title: "Add to desktop or home screen", desc: "Open Eikon with one tap, in its own window, like an app.", run: function () { if (E.install) E.install.open(); } },
          { title: "Sign out", desc: "Sign out on this device.", run: function () { E.logout(); } }
        ] },
        { label: "This pharmacy", ids: ["audit", "expreg", "contacts", "teamreg"], actions: [
          { title: "Lock when idle", desc: "Cover this computer's screen after a few quiet minutes; off unless you turn it on.", run: function () { E.showIdleLockSettings(); } }
        ] },
        { label: "Help", actions: [
          { title: "Help & guides", desc: "A short guide to every screen, with a search. The ? beside a screen's name opens its guide.", run: function () { if (E.openHelpNext) E.openHelpNext(); else E.showHelpGuide(); } },
          { title: "What's new", desc: "What changed in Eikon, newest first.", dot: true, run: function () { if (E.openHelpNext) E.openHelpNext({ view: "whatsnew" }); } },
          { title: "Classic layout", desc: "The previous look, with the old sidebar. The link you were given brings you back here.", run: function () { try { localStorage.setItem("eikon_ui2", "0"); } catch (e) {} var u = new URL(window.location.href); u.searchParams.set("ui", "1"); u.hash = "#dashboard"; window.location.href = u.toString(); } },
          { title: "Old dashboard", desc: "The previous home screen, unchanged.", run: function () { window.location.hash = "#dashboard"; } }
        ] }
      ]
    }
  };

  function injectCss() {
    if (document.getElementById("eikon-hubs-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-hubs-css";
    st.textContent =
      ".hub{max-width:1180px;margin:0 auto}.hub h1{font-size:26px;letter-spacing:-.025em;margin:4px 0 6px;line-height:1.1;font-weight:800}.hub .lead{color:var(--muted);font-size:14.5px;margin:0 0 6px;max-width:640px;line-height:1.5}" +
      ".hub-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:22px 2px 8px}" +
      ".hub-phone{display:none}@media (max-width:760px){.hub-phone{display:block}}" +
      ".hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}" +
      ".hub-card{display:block;position:relative;width:100%;text-align:left;font:inherit;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 34px 14px 16px;color:var(--text);cursor:pointer;min-height:76px;-webkit-tap-highlight-color:transparent}" +
      ".hub-card::after{content:'';position:absolute;right:16px;top:50%;width:7px;height:7px;border-right:2px solid rgba(60,60,67,.3);border-top:2px solid rgba(60,60,67,.3);transform:translateY(-50%) rotate(45deg)}" +
      ".hub-card:hover{background:rgba(118,118,128,.06)}.hub-card:active{background:rgba(118,118,128,.12)}" +
      ".hub-card b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;margin-bottom:3px}.hub-card span{display:block;font-size:12.5px;color:var(--muted);line-height:1.45}" +
      ".hub-card.missing{opacity:.5;cursor:default}" +
      "@media (max-width:600px){.hub{padding:4px 16px 0}.hub h1{font-size:32px;margin-top:8px}.hub-grid{display:block;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".hub-card{border:0;border-radius:0;min-height:0;padding:12px 40px 12px 16px;border-top:.5px solid var(--border)}.hub-card:first-child{border-top:0}.hub-card b{font-size:16px;font-weight:600}.hub-card span{font-size:13px}}" +
      ".hub-note{font-size:13px;color:var(--muted2,#8A94A3)}" +
      // Services: group names in sentence case like its screens (the other hubs keep theirs until their owners move them)
      ".hub[data-hub=services] .hub-lab{font-size:13px;font-weight:600;letter-spacing:0;text-transform:none}";
    document.head.appendChild(st);
  }

  // Registers rebuilt in the new layout open there; the rest still open in classic (and come back to hubId).
  function openCard(mid, hubId) {
    var nat = (E.UI2_NATIVE || {})[mid];
    if (nat && E.modules[nat]) { window.location.hash = "#" + nat; return; }
    if (E.modules[mid] && E.modules[mid].ui2Only) { window.location.hash = "#" + mid; return; } // a screen that only exists in the new layout opens here
    try { sessionStorage.setItem("eikon_ui2_return", hubId); } catch (e) {}
    E.openClassic(mid);
  }

  function makeHub(id, cfg) {
    function render(ctx) {
      var m = ctx && ctx.mount; if (!m) return;
      injectCss();
      var html = '<div class="hub" data-hub="' + esc(id) + '"><h1>' + esc(cfg.title) + '</h1><p class="lead">' + esc(cfg.lead) + '</p>' +
        (id === "settings" ? '<div id="hub-wn-slot"></div>' : "") +
        (id === "stock" ? '<div id="stk-slot" class="stk"></div><h2 class="hub-lab stk-all">Every stock screen</h2>' : ""); // d-stock: the day's ordering first (modules.stkflow.js), every screen under it
      if (id === "registers") html += '<div id="rgt-slot"></div><h2 class="rgt-all">Every register</h2>'; // regs-hub: what is due today first (eikon.regtoday.js), every register under it; a heading like "Today" above it, not a section label
      cfg.groups.forEach(function (g, gi) {
        var cards = "";
        (g.ids || []).forEach(function (mid) {
          var mod = E.modules[mid];
          if (!mod) return; // not in this build or this portal
          if (mod.adminOnly && E.state.user && E.state.user.role && E.state.user.role !== "admin") return; // the pharmacist's own tools
          var nat = (E.UI2_NATIVE || {})[mid], shown = (nat && E.modules[nat] && E.modules[nat].title) || mod.title || mid; // the name the screen itself shows
          cards += '<button class="hub-card" data-open="' + esc(mid) + '"><b>' + esc(sentence(shown)) + '</b><span>' + esc(DESC[mid] || "") + '</span></button>';
        });
        (g.actions || []).forEach(function (a, ai) {
          cards += '<button class="hub-card" data-action="' + gi + ":" + ai + '"><b>' + esc(a.title) + (a.dot ? '<span class="nxh-dot nxh-card-dot" data-wn-dot hidden><span class="nxh-sr">, something new</span></span>' : "") + '</b><span>' + esc(a.desc) + '</span></button>';
        });
        if (!cards) return;
        html += '<div class="hub-sec' + (g.phoneOnly ? " hub-phone" : "") + '"><h2 class="hub-lab">' + esc(g.label) + '</h2><div class="hub-grid">' + cards + '</div></div>';
      });
      html += '</div>';
      m.innerHTML = html;
      m.querySelectorAll("[data-open]").forEach(function (b) {
        b.addEventListener("click", function () { openCard(b.getAttribute("data-open"), id); });
      });
      if (id === "stock") { var slot = m.querySelector("#stk-slot"); if (slot && E.stockFlow) E.stockFlow.render(slot); } // drawn by modules.stkflow.js when it arrives otherwise
      if (id === "registers") { var rs = m.querySelector("#rgt-slot"); if (rs && E.regToday) E.regToday.render(rs); } // drawn by eikon.regtoday.js when it arrives otherwise
      if (id === "settings" && E.helpSettings) E.helpSettings(m); // What's new (eikon.help.js, loaded just after the first screen)
      m.querySelectorAll("[data-action]").forEach(function (b) {
        b.addEventListener("click", function () {
          var p = b.getAttribute("data-action").split(":");
          var a = cfg.groups[Number(p[0])].actions[Number(p[1])];
          if (a && a.run) a.run();
        });
      });
    }
    E.registerModule({ id: id, title: cfg.title, order: 2, icon: "◯", ui2Only: true, render: render });
  }

  Object.keys(HUBS).forEach(function (id) { makeHub(id, HUBS[id]); });
  // Hub cards list modules that may still be loading in the background: redraw once they are in.
  window.addEventListener("eikon:modules", function () {
    try { var a = document.activeElement, typing = a && a.closest && a.closest(".hub form"); if (HUBS[E.state.activeModuleId] && document.querySelector(".hub") && !typing) E.renderActiveModule(); } catch (e) {} // never under someone typing in Stock's forms
  });

  // Every card behind every hub, once each (its first hub), for the search (eikon.search.js): the name the screen shows,
  // its sentence, and the same way in as the card. Read when asked, so screens that load late are there too.
  E.ui2Screens = function () {
    var out = [], seen = {};
    Object.keys(HUBS).forEach(function (hid) {
      HUBS[hid].groups.forEach(function (g) {
        (g.ids || []).forEach(function (mid) {
          var mod = E.modules[mid]; if (!mod || seen[mid]) return;
          if (mod.adminOnly && E.state.user && E.state.user.role && E.state.user.role !== "admin") return; // not offered to staff
          seen[mid] = 1;
          var nat = (E.UI2_NATIVE || {})[mid], shown = (nat && E.modules[nat] && E.modules[nat].title) || mod.title || mid;
          out.push({ key: mid, title: sentence(shown), old: mod.title || "", desc: DESC[mid] || "", hub: HUBS[hid].title, open: function () { openCard(mid, hid); } });
        });
      });
    });
    return out;
  };

  // Which hub an old module belongs to, for the back link.
  E.ui2HubFor = function (modId) {
    if (["clientorders", "tickets", "deliveries", "appointments", "loyalty"].indexOf(modId) >= 0) return { id: "customers", title: "Customers" };
    var found = null;
    Object.keys(HUBS).forEach(function (hid) {
      if (found) return;
      HUBS[hid].groups.forEach(function (g) { if (!found && (g.ids || []).indexOf(modId) >= 0) found = { id: hid, title: HUBS[hid].title }; });
    });
    return found || { id: "today", title: "Today" };
  };

})();
