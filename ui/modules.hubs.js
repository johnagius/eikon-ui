/* ============================================================
   EIKON — Hubs  (modules.hubs.js)
   The reimagined rail has six words: Today, Customers, Stock, Registers, Team,
   Settings. Stock, Registers, Team and Settings are doors: one calm page each,
   every existing function one tap behind it, described in a sentence a new
   locum understands. Nothing is removed; it is put where it belongs.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }

  // One sentence per function. Titles come from the modules themselves.
  var DESC = {
    temperature: "Fridge and room readings, every day, with the limits.",
    cleaning: "Who cleaned what, and when.",
    dailyregister: "The day book: opening checks and sign-off.",
    "dda-purchases": "Controlled drugs received.",
    "dda-sales": "Controlled drugs supplied, by prescription.",
    "dda-poyc": "POYC controlled-drug supplies.",
    dda_stocktakes: "Controlled-drug counts and discrepancies.",
    repeatprescriptions: "Repeat prescriptions on file and when they expire.",
    locumregister: "Which locum was in charge, and when.",
    certificates: "Licences and certificates with expiry dates.",
    audit: "Who changed what, across the whole system.",
    endofday: "Close the till: X readings, cash, cheques, the bank bag.",
    paidout: "Cash paid out of the till, with a reason.",
    creditnotes: "Credit notes owed to and by suppliers.",
    locumreceipts: "Locum hours and fees, ready to pay.",
    "emergency-pos": "Sell when the main till is down; syncs later.",
    poct: "Blood pressure, glucose, cholesterol and other tests, per patient.",
    vaccines: "Vaccines given, batches and consent.",
    ocps: "Contraceptive supply records.",
    pharmacycalc: "Dose and renal calculators, per patient.",
    pharmacovigilance: "Adverse reactions reported.",
    screening: "Screening programmes and results.",
    labels: "Print dispensing labels in English or Maltese.",
    otcmindmap: "What to recommend over the counter, by symptom.",
    alerts: "Recalls and safety alerts, with the steps ticked off.",
    nearexpiry: "What expires soon, shelf by shelf.",
    returns: "Stock going back to the supplier.",
    stocktransfers: "Stock moved between pharmacies.",
    scarcestock: "Hard-to-get lines and who has them.",
    "supplier-inventory": "What the supplier has in stock right now.",
    "order-diary": "Orders placed with suppliers and what is still due.",
    quotations: "Quotes given to customers and companies.",
    clientorders: "Items ordered in for a customer.",
    tickets: "Questions customers are waiting on.",
    deliveries: "Home deliveries, routes and proof of delivery.",
    appointments: "Clinic bookings and the waiting list.",
    loyalty: "Loyalty cards, points and campaigns.",
    shifts: "The rota: who is on, and when.",
    instructions: "Handover notes from one shift to the next.",
    messageboard: "Notices for the whole team.",
    contacts: "Suppliers, reps, doctors, head office, one list."
  };

  var HUBS = {
    stock: {
      title: "Stock", lead: "What is coming in, what is going out, what is running out.",
      groups: [
        { label: "Watch", ids: ["alerts", "nearexpiry", "scarcestock"] },
        { label: "Move", ids: ["returns", "stocktransfers", "order-diary", "supplier-inventory"] },
        { label: "Price", ids: ["quotations", "creditnotes"] }
      ]
    },
    registers: {
      title: "Registers", lead: "The books an inspector asks for. Each one is filled in where the work happens; this is where you read them.",
      groups: [
        { label: "Every day", ids: ["temperature", "cleaning", "dailyregister", "locumregister"] },
        { label: "Controlled drugs", ids: ["dda-purchases", "dda-sales", "dda-poyc", "dda_stocktakes", "repeatprescriptions"] },
        { label: "Money", ids: ["endofday", "paidout", "locumreceipts", "emergency-pos"] },
        { label: "Clinical", ids: ["poct", "vaccines", "ocps", "pharmacycalc", "pharmacovigilance", "screening", "labels", "otcmindmap"] },
        { label: "Proof", ids: ["certificates", "audit"] }
      ]
    },
    team: {
      title: "Team", lead: "Who is in, what they need to know, and what they are owed.",
      groups: [
        { label: "Today", ids: ["shifts", "instructions", "messageboard"] },
        { label: "Locums", ids: ["locumregister", "locumreceipts"] },
        { label: "People we call", ids: ["contacts"] }
      ]
    },
    settings: {
      title: "Settings", lead: "Your account, this pharmacy, and the way back.",
      groups: [
        { label: "You", actions: [
          { title: "Password", desc: "Change the password you sign in with.", run: function () { E.showChangePassword(); } },
          { title: "Sign out", desc: "Sign out on this device.", run: function () { E.logout(); } }
        ] },
        { label: "This pharmacy", ids: ["certificates", "contacts", "audit"] },
        { label: "Help", actions: [
          { title: "Help & guides", desc: "Short guides for every register.", run: function () { E.showHelpGuide(); } },
          { title: "Classic layout", desc: "The previous look, with the old sidebar. The link you were given brings you back here.", run: function () { try { localStorage.removeItem("eikon_ui2"); } catch (e) {} var u = new URL(window.location.href); u.searchParams.set("ui", "1"); u.hash = "#dashboard"; window.location.href = u.toString(); } },
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
      ".hub-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px}" +
      ".hub-card{display:block;position:relative;width:100%;text-align:left;font:inherit;background:var(--panel2);border:1px solid var(--border);border-radius:12px;padding:14px 34px 14px 16px;color:var(--text);cursor:pointer;min-height:76px;-webkit-tap-highlight-color:transparent}" +
      ".hub-card::after{content:'';position:absolute;right:16px;top:50%;width:7px;height:7px;border-right:2px solid rgba(60,60,67,.3);border-top:2px solid rgba(60,60,67,.3);transform:translateY(-50%) rotate(45deg)}" +
      ".hub-card:hover{background:rgba(118,118,128,.06)}.hub-card:active{background:rgba(118,118,128,.12)}" +
      ".hub-card b{display:block;font-size:14.5px;font-weight:700;letter-spacing:-.01em;margin-bottom:3px}.hub-card span{display:block;font-size:12.5px;color:var(--muted);line-height:1.45}" +
      ".hub-card.missing{opacity:.5;cursor:default}" +
      "@media (max-width:600px){.hub{padding:4px 16px 0}.hub h1{font-size:32px;margin-top:8px}.hub-grid{display:block;background:var(--panel2);border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".hub-card{border:0;border-radius:0;min-height:0;padding:12px 40px 12px 16px;border-top:.5px solid var(--border)}.hub-card:first-child{border-top:0}.hub-card b{font-size:16px;font-weight:600}.hub-card span{font-size:13px}}" +
      ".hub-note{font-size:13px;color:var(--muted2,#8A94A3)}";
    document.head.appendChild(st);
  }

  function makeHub(id, cfg) {
    function render(ctx) {
      var m = ctx && ctx.mount; if (!m) return;
      injectCss();
      var html = '<div class="hub"><h1>' + esc(cfg.title) + '</h1><p class="lead">' + esc(cfg.lead) + '</p>' +
        '';
      cfg.groups.forEach(function (g, gi) {
        var cards = "";
        (g.ids || []).forEach(function (mid) {
          var mod = E.modules[mid];
          if (!mod) return; // not in this build or this portal
          cards += '<button class="hub-card" data-open="' + esc(mid) + '"><b>' + esc(mod.title || mid) + '</b><span>' + esc(DESC[mid] || "") + '</span></button>';
        });
        (g.actions || []).forEach(function (a, ai) {
          cards += '<button class="hub-card" data-action="' + gi + ":" + ai + '"><b>' + esc(a.title) + '</b><span>' + esc(a.desc) + '</span></button>';
        });
        if (!cards) return;
        html += '<div class="hub-lab">' + esc(g.label) + '</div><div class="hub-grid">' + cards + '</div>';
      });
      html += '</div>';
      m.innerHTML = html;
      m.querySelectorAll("[data-open]").forEach(function (b) {
        b.addEventListener("click", function () {
          // Registers rebuilt in the new layout open there; the rest still open in classic.
          var NATIVE = { temperature: "tempreg" }, nat = NATIVE[b.getAttribute("data-open")];
          if (nat && E.modules[nat]) { window.location.hash = "#" + nat; return; }
          try { sessionStorage.setItem("eikon_ui2_return", id); } catch (e) {}
          E.openClassic(b.getAttribute("data-open"));
        });
      });
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
    try { if (HUBS[E.state.activeModuleId] && document.querySelector(".hub")) E.renderActiveModule(); } catch (e) {}
  });

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
