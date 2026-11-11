/* ============================================================
   EIKON — Module registry  (registry.js)
   What every module file registers (id, title, icon, order, ui2Only), written down so the new layout can list
   the classic screens without downloading them. Loaded by the new layout only; the classic layout loads every
   module file as before and never reads this.

   load: "new"     loaded by the new layout (first, or in the background after Today)
         "classic" loaded only when needed: a ?ui=classic visit loads everything as always, and in the new layout
                   E.loadClassic() fetches them (supplier and company-admin portals, or a stub asked to draw).
   portals: informational (where the classic sidebar lists it; org12 = Cherubino only).

   Keep it in step with the modules: tests/ui/run.mjs loads every file and fails if a file registers anything
   different from its rows here. Regenerate the rows rather than editing them by hand when a title changes.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // [file, id, title, icon, order, ui2Only, load, portals]
  var ROWS = [
    ["modules.dashboard.js", "dashboard", "Dashboard", "📊", 1, false, "classic", ["pharmacy"]],
    ["modules.today.js", "today", "Today", "☀", 0, false, "new", ["pharmacy"]],
    ["modules.customers.js", "customers", "Customers", "◯", 1, true, "new", ["pharmacy"]],
    ["modules.bookings.js", "bookings", "Bookings", "📅", 3, true, "new", ["pharmacy"]],
    ["modules.hubs.js", "stock", "Stock", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.hubs.js", "registers", "Registers", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.hubs.js", "services", "Services", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.hubs.js", "money", "Money", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.hubs.js", "team", "Team", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.hubs.js", "settings", "Settings", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.tempreg.js", "tempreg", "Temperature", "🌡", 3, true, "new", ["pharmacy"]],
    ["modules.cleanreg.js", "cleanreg", "Cleaning", "✓", 3, true, "new", ["pharmacy"]],
    ["modules.drreg.js", "drreg", "Daily register", "Rx", 3, true, "new", ["pharmacy"]],
    ["modules.locreg.js", "locreg", "Locum register", "◷", 3, true, "new", ["pharmacy"]],
    ["modules.certreg.js", "certreg", "Certificates", "✓", 3, true, "new", ["pharmacy"]],
    ["modules.nexreg.js", "nexreg", "Near expiry", "⏳", 3, true, "new", ["pharmacy"]],
    ["modules.retreg.js", "retreg", "Returns", "↩", 3, true, "new", ["pharmacy"]],
    ["modules.trfreg.js", "trfreg", "Transfers", "⇄", 3, true, "new", ["pharmacy"]],
    ["modules.alertreg.js", "alertreg", "Alerts", "!", 3, true, "new", ["pharmacy"]],
    ["modules.ordreg.js", "ordreg", "Orders", "◎", 3, true, "new", ["pharmacy"]],
    ["modules.tktreg.js", "tktreg", "Questions", "?", 3, true, "new", ["pharmacy"]],
    ["modules.dlvreg.js", "dlvreg", "Deliveries", "→", 3, true, "new", ["pharmacy"]],
    ["modules.cdpreg.js", "cdpreg", "Controlled drugs received", "℞", 3, true, "new", ["pharmacy"]],
    ["modules.cdsreg.js", "cdsreg", "Controlled drugs supplied", "℞", 3, true, "new", ["pharmacy"]],
    ["modules.cdsreg.js", "poyreg", "POYC controlled drugs", "℞", 3, true, "new", ["pharmacy"]],
    ["modules.ddstreg.js", "ddstreg", "Controlled drug stock takes", "℞", 6, true, "new", ["pharmacy"]],
    ["modules.cdreg.js", "cdreg", "Controlled drugs by medicine", "℞", 3, true, "new", ["pharmacy"]],
    ["modules.poreg.js", "poreg", "Paid out", "€", 3, true, "new", ["pharmacy"]],
    ["modules.hndreg.js", "hndreg", "Handover", "↻", 3, true, "new", ["pharmacy"]],
    ["modules.rotreg.js", "rotreg", "Who's in", "◷", 3, true, "new", ["pharmacy"]],
    ["modules.shfreg.js", "shfreg", "Plan shifts", "◷", 3, true, "new", ["pharmacy"]],
    ["modules.teamreg.js", "teamreg", "People who sign in", "◉", 3, true, "new", ["pharmacy"]],
    ["modules.phdreg.js", "phdreg", "Pharmacy details", "⌂", 3, true, "new", ["pharmacy"]],
    ["modules.repreg.js", "repreg", "Repeat prescriptions", "℞", 3, true, "new", ["pharmacy"]],
    ["modules.cnreg.js", "cnreg", "Credit notes", "€", 3, true, "new", ["pharmacy"]],
    ["modules.lrcreg.js", "lrcreg", "Locum receipts", "€", 3, true, "new", ["pharmacy"]],
    ["modules.odreg.js", "odreg", "Order diary", "✎", 3, true, "new", ["pharmacy"]],
    ["modules.qtreg.js", "qtreg", "Price check", "€", 3, true, "new", ["pharmacy"]],
    ["modules.ssreg.js", "ssreg", "Shortages", "⇄", 3, true, "new", ["pharmacy"]],
    ["modules.brdreg.js", "brdreg", "Chat board", "✉", 3, true, "new", ["pharmacy"]],
    ["modules.conreg.js", "conreg", "Contacts", "☎", 3, true, "new", ["pharmacy"]],
    ["modules.vaxreg.js", "vaxreg", "Vaccines", "✚", 3, true, "new", ["pharmacy"]],
    ["modules.eodreg.js", "eodreg", "End of day", "€", 3, true, "new", ["pharmacy"]],
    ["modules.pocreg.js", "pocreg", "Point-of-care tests", "🩺", 3, true, "new", ["pharmacy"]],
    ["modules.scsreg.js", "scsreg", "Scarce stock", "🔎", 3, true, "new", ["pharmacy"]],
    ["modules.audreg.js", "audreg", "Audit trail", "🔒", 101, true, "new", ["pharmacy"]],
    ["modules.expreg.js", "expreg", "Download our records", "⇩", 102, true, "new", ["pharmacy"]],
    ["modules.insreg.js", "insreg", "Inspection check", "☑", 3, true, "new", ["pharmacy"]],
    ["modules.ownreg.js", "ownreg", "How we're doing", "◔", 3, true, "new", ["pharmacy", "company_admin"]],
    ["modules.pvreg.js", "pvreg", "Adverse reactions", "!", 3, true, "new", ["pharmacy"]],
    ["modules.scrreg.js", "scrreg", "Screening campaigns", "🩺", 3, true, "new", ["pharmacy"]],
    ["modules.ocpreg.js", "ocpreg", "Contraceptive pills", "💊", 3, true, "new", ["pharmacy"]],
    ["modules.lblreg.js", "lblreg", "Dispensing labels", "🏷️", 3, true, "new", ["pharmacy"]],
    ["modules.sinreg.js", "sinreg", "Supplier stock", "▦", 3, true, "new", ["pharmacy"]],
    ["modules.otcreg.js", "otcreg", "Over the counter", "✚", 3, true, "new", ["pharmacy"]],
    ["modules.eposreg.js", "eposreg", "Emergency POS", "€", 3, true, "new", ["pharmacy"]],
    ["modules.calreg.js", "calreg", "Pharmacy calculators", "🧮", 3, true, "new", ["pharmacy"]],
    ["modules.dupreg.js", "dupreg", "Possible duplicates", "◯", 2, true, "new", ["pharmacy"]],
    ["modules.loyreg.js", "loyreg", "Loyalty", "✦", 3, true, "new", ["pharmacy"]],
    ["modules.alerts.js", "alerts", "Alerts", "⚠️", 110, false, "classic", ["pharmacy"]],
    ["modules.shifts.js", "shifts", "Shifts", "🕐", 190, false, "classic", ["pharmacy"]],
    ["modules.ocps.js", "ocps", "OCP Finder", "💊", 390, false, "classic", ["pharmacy"]],
    ["modules.loyalty.js", "loyalty", "Loyalty & Campaigns", "✦", 290, false, "classic", ["pharmacy"]],
    ["modules.pharmacycalc.js", "pharmacycalc", "Pharmacy Calculators", "🧮", 400, false, "classic", ["pharmacy"]],
    ["modules.returns.js", "returns", "Returns", "↩️", 240, false, "classic", ["pharmacy"]],
    ["modules.paidout.js", "paidout", "Paid Out", "💸", 250, false, "classic", ["pharmacy"]],
    ["modules.stocktransfers.js", "stocktransfers", "Stock Transfers", "🔄", 245, false, "classic", ["pharmacy"]],
    ["modules.scarcestock.js", "scarcestock", "Scarce Stock", "🔎", 280, false, "classic", ["pharmacy"]],
    ["modules.nearexpiry.js", "nearexpiry", "Near Expiry", "⏳", 270, false, "classic", ["pharmacy"]],
    ["modules.locumreceipts.js", "locumreceipts", "Locum Receipts", "💶", 260, false, "classic", ["pharmacy"]],
    ["modules.instructions.js", "instructions", "Instructions", "📝", 300, false, "classic", ["pharmacy"]],
    ["modules.clientorders.js", "clientorders", "Client Orders", "🛍️", 200, false, "classic", ["pharmacy"]],
    ["modules.poct.js", "poct", "POCT", "🧪", 370, false, "classic", ["pharmacy"]],
    ["modules.endofday.js", "endofday", "End Of Day", "🌙", 180, false, "classic", ["pharmacy"]],
    ["modules.temperature.js", "temperature", "Temperature", "🌡", 10, false, "classic", ["pharmacy"]],
    ["modules.cleaning.js", "cleaning", "Cleaning", "🧼", 20, false, "classic", ["pharmacy"]],
    ["modules.certificates.js", "certificates", "Certificates", "📄", 100, false, "classic", ["pharmacy"]],
    ["modules.dailyregister.js", "dailyregister", "Daily Register", "🗓️", 70, false, "classic", ["pharmacy"]],
    ["modules.repeatprescriptions.js", "repeatprescriptions", "Repeat Prescriptions", "🔁", 80, false, "classic", ["pharmacy"]],
    ["modules.ddasales.js", "dda-sales", "DDA Sales", "📤", 40, false, "classic", ["pharmacy"]],
    ["modules.ddapoyc.js", "dda-poyc", "DDA POYC", "🏥", 60, false, "classic", ["pharmacy"]],
    ["modules.ddapurchases.js", "dda-purchases", "DDA Purchases", "📥", 30, false, "classic", ["pharmacy"]],
    ["modules.ddastocktakes.js", "dda_stocktakes", "DDA Stock Takes", "📊", 50, false, "classic", ["pharmacy"]],
    ["modules.locumregister.js", "locumregister", "Locum Register", "👨‍⚕️", 90, false, "classic", ["pharmacy"]],
    ["modules.vaccines.js", "vaccines", "Vaccines", "💉", 380, false, "classic", ["pharmacy"]],
    ["modules.creditnotes.js", "creditnotes", "Credit Notes", "🗒️", 230, false, "classic", ["pharmacy"]],
    ["modules.tickets.js", "tickets", "Client Tickets", "🎟", 220, false, "classic", ["pharmacy"]],
    ["modules.deliveries.js", "deliveries", "Client Deliveries", "🚚", 210, false, "classic", ["pharmacy"]],
    ["modules.appointments.js", "appointments", "Appointments", "📅", 215, false, "classic", ["pharmacy"]],
    ["modules.quotations.js", "quotations", "Quotations", "💰", 205, false, "classic", ["pharmacy"]],
    ["modules.orderdiary.js", "order-diary", "Order Diary", "📖", 208, false, "classic", ["pharmacy"]],
    ["modules.emergencypos.js", "emergency-pos", "Emergency POS", "💳", 109, false, "classic", ["pharmacy"]],
    ["modules.audit.js", "audit", "Audit Trail", "🔒", 101, false, "classic", ["pharmacy"]],
    ["modules.messageboard.js", "messageboard", "Chat Board", "💬", 105, false, "classic", ["pharmacy"]],
    ["modules.pharmacovigilance.js", "pharmacovigilance", "Pharmacovigilance", "🛡️", 410, false, "classic", ["pharmacy"]],
    ["modules.screening.js", "screening", "Screening Campaigns", "🩺", 70, false, "classic", ["pharmacy"]],
    ["modules.otcmindmap.js", "otcmindmap", "OTC Mindmap", "🧠", 71, false, "classic", ["pharmacy"]],
    ["modules.labels.js", "labels", "Smart Labels", "🏷️", 71, false, "classic", ["pharmacy"]],
    ["modules.contacts.js", "contacts", "Contacts", "📇", 2, false, "classic", ["pharmacy"]],
    ["modules.portals.js", "suphome", "Today", "◯", 3, true, "new", ["supplier"]],
    ["modules.portals.js", "suporders", "Orders", "◯", 3, true, "new", ["supplier"]],
    ["modules.portals.js", "supproblems", "Problems", "◯", 3, true, "new", ["supplier"]],
    ["modules.portals.js", "supproducts", "Products", "◯", 3, true, "new", ["supplier"]],
    ["modules.portals.js", "hqhome", "Today", "◯", 3, true, "new", ["company_admin"]],
    ["modules.portals.js", "hqregs", "Registers", "◯", 3, true, "new", ["company_admin"]],
    ["modules.portals.js", "hqclient", "Cherubino", "◯", 3, true, "new", ["company_admin:org12"]],
    ["modules.portals.js", "ptlacct", "Account", "◯", 3, true, "new", ["supplier", "company_admin"]],
    ["modules.supplier-dashboard.js", "supplier-dashboard", "Supplier Dashboard", "🚚", 1, false, "classic", ["supplier"]],
    ["modules.supplier-products.js", "supplier-products", "Product List", "📦", 10, false, "classic", ["supplier"]],
    ["modules.supplier-received-orders.js", "supplier-received-orders", "Received Orders", "📋", 20, false, "classic", ["supplier"]],
    ["modules.supplier-order-feedback.js", "supplier-order-feedback", "Order Feedback", "⚠️", 25, false, "classic", ["supplier"]],
    ["modules.supplier-inventory.js", "supplier-inventory", "Supplier Inventory", "🏭", 35, false, "classic", ["pharmacy"]],
    ["modules.company-dashboard.js", "company-dashboard", "Company Dashboard", "🏢", 1, false, "classic", ["company_admin"]],
    ["modules.admin-overview.js", "admin-overview", "Pharmacy Overview", "📊", 5, false, "classic", ["company_admin"]],
    ["modules.cherubino-orders.js", "cherubino-orders", "Orders", "🏥", 900, false, "classic", ["pharmacy:org12"]],
    ["modules.cherubino-admin.js", "cherubino-admin", "Cherubino Orders", "🏥", 10, false, "classic", ["company_admin:org12"]],
    ["modules.cherubino-prices.js", "cherubino-prices", "Price Changes", "🏥", 901, false, "classic", ["pharmacy:org12", "company_admin:org12"]],
    ["modules.cherubino-shortexpiry.js", "cherubino-shortexpiry", "Warehouse Short Expiry", "🏥", 902, false, "classic", ["pharmacy:org12", "company_admin:org12"]],
    ["modules.cherubino-oos.js", "cherubino-oos", "OOS List", "🏥", 903, false, "classic", ["pharmacy:org12", "company_admin:org12"]]
  ];
  E.REGISTRY = ROWS.map(function (r) { return { file: r[0], id: r[1], title: r[2], icon: r[3], order: r[4], ui2Only: r[5], load: r[6], portals: r[7] }; });

  // A classic screen not downloaded yet: listed with its own title and icon. If something asks it to draw
  // (a portal, or the new layout with the classic look for this visit), the classic files load first.
  function stub(r) {
    return { id: r.id, title: r.title, icon: r.icon, order: r.order, registryStub: true,
      render: function (ctx) {
        return E.loadClassic().then(function () {
          var real = E.modules[r.id];
          if (!real || real.registryStub) throw new Error("This screen did not load. Check the connection and reload the page.");
          return real.render(ctx);
        });
      } };
  }

  // Called once the new layout's background files are in. Adds the classic screens that are not loaded and
  // puts E.modules in the order it had when every file was loaded (first files, then the rest in index.html
  // order), so the hubs, Today search and the classic sidebar see the same list as before.
  E.applyRegistry = function (fileOrder) {
    var mods = E.modules;
    E.REGISTRY.forEach(function (r) { if (r.load === "classic" && !mods[r.id]) mods[r.id] = stub(r); });
    var byFile = {};
    E.REGISTRY.forEach(function (r) { (byFile[r.file] = byFile[r.file] || []).push(r.id); });
    var order = [], seen = {};
    (fileOrder || []).forEach(function (f) { (byFile[String(f).replace(/^\.\//, "")] || []).forEach(function (id) { if (mods[id] && !seen[id]) { seen[id] = 1; order.push(id); } }); });
    Object.keys(mods).forEach(function (id) { if (!seen[id]) { seen[id] = 1; order.push(id); } });
    var keep = {};
    order.forEach(function (id) { keep[id] = mods[id]; delete mods[id]; });
    order.forEach(function (id) { mods[id] = keep[id]; });
  };
})();
