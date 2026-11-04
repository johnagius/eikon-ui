/* ============================================================
   EIKON — Help for the new layout  (help-next.js)
   Loaded on first use only (the "?" beside a screen's name, Settings › Help & guides, Settings › What's new):
   nothing here is downloaded when the app opens. The classic layout keeps help-content.js and E.showHelpGuide.

   One guide per new-layout screen (every "new" row in registry.js; tests/ui/run.mjs fails if one is missing):
   what the screen is for, the three things done there most, step by step in the screen's own button words,
   and what is still in the classic screen. Plain words, sentence case, no technical terms.
   ============================================================ */
(function () {
  "use strict";
  var E = window.EIKON;
  if (!E) return;

  // Tabs, in the order of the menu. A guide's tab is where its screen lives.
  var TABS = [
    ["today", "Today"], ["customers", "Customers"], ["stock", "Stock"], ["registers", "Registers"],
    ["services", "Services"], ["money", "Money"], ["team", "Team"], ["settings", "Settings"]
  ];

  // [id, tab, title, what it is for, [task title, step, step…] for the jobs done there most, still in the classic screen, words used]
  // Button names are the screen's own words; "still in the classic screen" is the screen's own footer sentence (tests/ui/run.mjs checks both).
  var G = [
    ["today", "today", "Today", "What needs doing today: checks before opening, customers waiting, and closing the day.", [
      ["Log a fridge or room reading", "On the device's line, type the lowest and the highest reading.", "Press Log.", "A reading outside the limits shows in red and asks what was done: pick a quick choice or type it, then press Save the note."],
      ["Record a cleaning", "On the Cleaning line, check the name under Cleaned by. It remembers the last one.", "Press Done now."],
      ["Find anything", "Type in the search box at the top, or press / anywhere.", "A customer, an order or a register: press Enter to open it.", "A scanned ID card opens the person."],
      ["When the connection drops", "A bar says No connection — what you type is kept.", "Nothing is saved twice. When Back online shows, save again what was not saved."]
    ], "", [["Before opening", "the checks an inspector expects every day: readings, cleaning and the daily register."]]],

    ["customers", "customers", "Customers", "Everyone the pharmacy serves, and everything done with each of them, in one place.", [
      ["Find a customer", "Type a name, an ID card or a phone number in the search box.", "Two letters or more find them. Tap the person to open them."],
      ["Add a new customer", "Press + New, or Add them as a new customer › when no one is found.", "Fill in the name and what you know.", "Press Add customer."],
      ["Act for a customer", "Open the person.", "Press New order, Question, Delivery or Booking. Their name and phone are filled in for you."]
    ], "", [["From history", "people found in the registers who have no customer card yet. Press Add to give them one."]]],

    ["bookings", "customers", "Bookings", "Appointments for clinics and services, by day or by week, and the waiting list.", [
      ["Set up bookings", "Press Start taking bookings. The pharmacist does this once.", "Add a practitioner, their hours and a service. Change them later in Bookings settings."],
      ["Book someone in", "Press New booking.", "Choose the service, the day and a free time.", "Press Book. If no time suits, press No time suits? Add to the waiting list."],
      ["On the day", "Open the booking.", "Press Arrived, Done or No-show. Cancel booking asks for a reason."]
    ], "", []],

    ["stock", "stock", "Stock", "What is coming in, what is going out, what is running out. Each card opens one screen.", [
      ["Watch", "Alerts, Near expiry, Shortages and Scarce stock."],
      ["Order", "Order diary and Supplier stock."],
      ["Send back or move", "Returns and Transfers."],
      ["Price", "Price check and Credit notes."]
    ], "", []],

    ["registers", "registers", "Registers", "The books an inspector asks for: fill them in, see what is missing, and print any month.", [
      ["Every day", "Temperature, Cleaning, Daily register and Locum register."],
      ["Controlled drugs", "Controlled drugs received, Controlled drugs supplied, POYC controlled drugs and Controlled drug stock takes."],
      ["Prescriptions", "Repeat prescriptions."],
      ["Proof", "Inspection check, Certificates and the Audit trail."]
    ], "", []],

    ["services", "services", "Services", "Care given at the counter or by appointment, and the tools for it.", [
      ["Clinical", "Point-of-care tests, Vaccines, Screening campaigns and Adverse reactions."],
      ["Look up and print", "Contraceptive pills, Pharmacy calculators, Over the counter and Dispensing labels."]
    ], "", []],

    ["money", "money", "Money", "The till and what the pharmacy owes or holds for others.", [
      ["Till", "End of day, Paid out and Emergency POS."],
      ["Customers and locums", "Credit notes and Locum receipts."]
    ], "", []],

    ["team", "team", "Team", "Who is in, what they need to know, and what they are owed.", [
      ["Today", "Who's in, Plan shifts, Handover and Chat board."],
      ["Locums", "Locum register and Locum receipts."],
      ["People we call", "Contacts."],
      ["Sign-ins", "People who sign in (the pharmacist only)."]
    ], "", []],

    ["settings", "settings", "Settings", "Your account, this pharmacy, help, and the classic layout.", [
      ["Change your password", "Press Password.", "Type the current password, then the new one twice."],
      ["Get help", "Press Help & guides for these guides, or What's new to see what changed.", "On any screen, the ? beside its name opens the guide for that screen."],
      ["Use the classic layout", "Press Classic layout. This browser remembers the choice.", "In the classic layout, Use the new layout brings you back."]
    ], "", []],

    ["tempreg", "registers", "Temperature", "Fridges and rooms, every day, against their limits.", [
      ["Log today's reading", "Readings are logged on Today: type the lowest and highest, then press Log.", "Or press Log today’s readings on this screen."],
      ["Say what was done about a reading outside the limits", "On Today, the reading asks what was done: pick a quick choice or type it, then press Save the note.", "Or tap the day here and press Add a note."],
      ["Log a missed day", "Tap the day that was not logged and press Log this day.", "Type the lowest and highest and say why it is logged late, then press Log this day again."],
      ["Correct a reading (the pharmacist)", "Tap the day and press Correct.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Each day shows the lowest above the highest; a dashed day was not logged.", "Use ‹ and › or the month name to change month.", "Press Print."],
      ["Set up fridges and rooms", "Press Fridges and rooms.", "Add a fridge or a room with its limits, or change a name or a limit."]
    ], "", [["Limits", "the lowest and highest a fridge or room may be, for example 2 to 8 °C for a fridge."]]],

    ["cleanreg", "registers", "Cleaning", "When the dispensary and fridge were cleaned, and by whom. At least once a week.", [
      ["Record a cleaning", "Press New cleaning.", "Fill in the date, time in, time out and the cleaner.", "Press Save cleaning."],
      ["Quick record", "On Today, press Done now on the Cleaning line."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a line is in the classic screen.", []],

    ["drreg", "registers", "Daily register", "Prescription medicines supplied, one line each.", [
      ["Add a line", "Press New entry.", "Type the ID card: a known patient is filled in for you.", "Fill in the medicine, posology, prescriber and reg no., then press Save entry."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a line is in the classic screen.", [["Posology", "how the medicine is to be taken."], ["Reg no.", "the prescriber's registration number."]]],

    ["locreg", "registers", "Locum register", "Which pharmacist was in charge, and when.", [
      ["Add a line", "Press New locum.", "Fill in the date, time in, time out, pharmacist and reg no.", "Press Save locum."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."],
      ["Pay a locum", "Use Locum receipts, under Money."]
    ], "Deleting a line is in the classic screen.", []],

    ["insreg", "registers", "Inspection check", "Is every register in order for the days you choose? Days not logged, notes missing, certificates due.", [
      ["Check the registers", "Choose the days: This month, Last month, Last 3 months or Choose days.", "Each register says In order, Look at this or Missing, with what was found."],
      ["Go to what needs a look", "Press Open › beside a finding: the register opens on that month or day."],
      ["Print it for an inspector", "Press Print with sign-off lines. It prints on one page with lines to sign.", "Download our records puts the same page first in the inspection pack."]
    ], "", []],

    ["certreg", "registers", "Certificates", "Calibrations, services and licences, with what is due.", [
      ["Record a service", "Press Update on the certificate (Record the first time).", "Fill in the last date and how many months until the next.", "Press Save. The next due date is worked out for you."],
      ["See what is due", "Each certificate shows when it is next due."],
      ["Print the list", "Press Print."]
    ], "To upload or download a certificate file, use the classic screen.", []],

    ["nexreg", "stock", "Near expiry", "What expires soon, nearest first.", [
      ["Add an item", "Press Add an item.", "Fill in the product, when it expires and where it is.", "Press Save item."],
      ["Send an item back", "Press Send back on the item, then Add to returns. It goes to Returns, ready for the supplier."],
      ["Offer it to other pharmacies", "Press Offer on the item and say how many.", "Press Offer in Scarce stock. Other pharmacies see it there and can ask for it."],
      ["Check the list", "The nearest dates are at the top."]
    ], "Supplier refused and damaged stock are in the classic screen.", []],

    ["retreg", "stock", "Returns", "Stock going back to suppliers, step by step until the credit note.", [
      ["Send something back", "Press New return.", "Fill in the item, how many, the supplier and why.", "Press Save return. From Near expiry, Send back does the same."],
      ["Follow a return", "Each return shows its next step: Mark arranged, Mark handed over, Got the collection note, then Got the credit note."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Changes, deleting and refused or damaged stock are in the classic screen.", []],

    ["trfreg", "stock", "Transfers", "Stock moving between your pharmacies.", [
      ["Offer an item", "Press Offer an item.", "Fill in the item, quantity, batch and expiry.", "Press Offer to the group."],
      ["Ask for an offer", "Press Ask for it on another pharmacy's offer. Requests sent to you show at the top, with Accept."],
      ["Follow a transfer", "Each one shows where it stands: waiting for an answer, accepted, on its way or delivered."]
    ], "Removing an offer, sending it to Returns or to Scarce stock, and older transfers are in the classic screen.", []],

    ["alertreg", "stock", "Alerts", "Recalls and quarantines, with each step ticked off.", [
      ["Record an alert", "Press New alert.", "Choose Recall or Quarantine, then fill in the item, batch, expiry, quantity and why.", "Press Save alert."],
      ["Tick off the steps", "Tap each step as it is done: Team told, Supplier told, Handed over, Credit note and the rest.", "Press Close alert when every step is done."],
      ["Change an alert", "Press Change on the alert.", "Change the details, the status or the notes.", "Press Save changes."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting an alert is in the classic screen.", [["Quarantine", "stock set aside and not sold until it is cleared."]]],

    ["ordreg", "customers", "Orders", "What customers are waiting for, by when they need it.", [
      ["Take an order", "Press New order.", "Fill in the customer, phone, items and needed by.", "Press Save order. Eikon then offers to put the items in the order diary."],
      ["When it comes in", "Press Ready on the order. Call the customer on the number shown."],
      ["Change or delete an order", "Tap the customer's name to open the order. Change what is needed and press Save changes.", "The pharmacist can press Delete… to delete it, saying why."],
      ["See what is waiting", "Waiting shows the open orders, Done the finished ones."]
    ], "Taking a deleted order's items off the order diary is in the classic screen.", [["Pick up", "the day the customer will collect. Empty means the same day."]]],

    ["tktreg", "customers", "Questions", "Customers waiting for an answer, most pressing first.", [
      ["Record a question", "Press New question.", "Fill in the customer, phone and question, and what it is about.", "Press Save question."],
      ["Answer it", "Press Add a note to write what was done.", "Press Resolved when the customer has their answer."],
      ["Change, print or delete a question", "Tap the customer's name to open it. Change what is needed and press Save changes.", "Press Print to print the question on its own. The pharmacist can press Delete… to delete it, saying why."],
      ["See what is open", "Waiting shows questions still open, Done the answered ones."]
    ], "New categories and staff names are in the classic screen.", []],

    ["dlvreg", "customers", "Deliveries", "What goes out today, and what is still on the road.", [
      ["Plan a delivery", "Press New delivery.", "Fill in the customer, phone, address, items, the day and time. Tick Fridge item, Controlled drug or Needs signature if they apply.", "Press Save delivery."],
      ["Follow it", "Press On its way when it leaves, then Delivered or Not delivered."],
      ["Change or delete a delivery", "Tap the customer's name to open it. Change what is needed and press Save changes.", "The pharmacist can press Delete… to delete it, saying why."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Drivers and item batches are in the classic screen.", []],

    ["cdpreg", "registers", "Controlled drugs received", "Every delivery of a controlled drug, by invoice.", [
      ["Record a delivery", "Press New invoice.", "Fill in the date received, supplier and invoice no.", "Add each medicine with Add a line, then press Save invoice."],
      ["Find a medicine", "Type part of the name or the brand: suggestions appear as you type."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a line is in the classic screen.", [["DDA", "the controlled drugs register."]]],

    ["cdsreg", "registers", "Controlled drugs supplied", "Every controlled drug handed over against a prescription.", [
      ["Record a prescription", "Press New prescription.", "Type the ID card: a known patient and address are filled in.", "Fill in the medicine and quantity, prescriber, reg no. and serial no., then press Save prescription."],
      ["More than one medicine", "Press Add a medicine for each extra line on the same prescription."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a line is in the classic screen.", [["Serial no.", "the number printed on the prescription."], ["Reg no.", "the prescriber's registration number."]]],

    ["poyreg", "registers", "POYC controlled drugs", "Controlled drugs given under the Pharmacy of Your Choice scheme.", [
      ["Record a prescription", "Press New prescription.", "Type the ID card: a known patient is filled in.", "Fill in the medicine and quantity, prescriber, reg no. and serial no., then press Save prescription."],
      ["More than one medicine", "Press Add a medicine for each extra line."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a line is in the classic screen.", [["POYC", "Pharmacy of Your Choice, the government scheme."]]],

    ["ddstreg", "registers", "Controlled drug stock takes", "Count each controlled drug and keep the count on file, ready to print.", [
      ["Start a stock take", "Press Start a stock take.", "For each medicine, fill in the name, dosage and tablets counted. Press Add item for the next one."],
      ["Finish", "Press Save and close."],
      ["Print a stock take", "Open it and press Print."]
    ], "Deleting a line is in the classic screen.", []],

    ["poreg", "money", "Paid out", "Money paid from the till: couriers, cleaners, small suppliers.", [
      ["Record a payment", "Press New payment.", "Fill in who it was paid to, the amount, cash or cheque, and what for.", "Press Save payment."],
      ["Correct a payment (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."],
      ["At closing", "Paid out is counted in End of day."]
    ], "Deleting a payment is in the classic screen.", []],

    ["hndreg", "team", "Handover", "What the last shift left you, and what you leave the next one.", [
      ["Leave a point for the next shift", "Under For tomorrow, type it and mark it Low, Medium or Critical.", "Press Add point."],
      ["Write today's notes", "Type in the notes box.", "Press Save notes."],
      ["Change the standing instructions", "Press Change beside Always, or + Standing instructions for every shift when there are none.", "Type what every shift should see, every day, and press Save standing instructions."],
      ["Read what was left", "From yesterday is at the top, most critical first."]
    ], "Another day's handover, and the opening, closing and how-to instructions, are in the classic screen.", []],

    ["rotreg", "team", "Who's in", "The week's rota: who works, when, and who is away.", [
      ["See the week", "Use ‹ and › to change week."],
      ["Change the rota", "Press Plan shifts."],
      ["Ask for leave", "Press ask for leave. The request is made in Plan shifts."],
      ["See who is away", "Leave shows on each person's day."]
    ], "Patterns and the calendar link are in the classic screen.", []],

    ["shfreg", "team", "Plan shifts", "Who works when: add, change or remove a shift, and answer leave requests.", [
      ["Add a shift", "Press + Add shift on the day.", "Choose the person and set the times.", "Press Add shift."],
      ["Change or remove a shift", "Tap the shift and change the times, then press Save, or press Remove shift."],
      ["Ask for leave", "Press + New leave request.", "Fill in who, the type, from and until, and the reason.", "Press Save leave request."],
      ["Answer a leave request", "Press Approve or Refuse on the request. You are warned if no one would cover."]
    ], "Patterns, opening hours, changing a person's details, leave balances and history, and the calendar link are in the classic screen.", []],

    ["teamreg", "team", "People who sign in", "Everyone at the pharmacy signs in as themselves, so the registers show who did what. For the pharmacist only.", [
      ["Add a person", "Press Add a person.", "Fill in the name and e-mail, and choose the role.", "Press Add. Give them the password shown."],
      ["Give a new password", "Press New password on the person. They choose their own at the next sign-in."],
      ["Switch someone off", "Press Switch off on the person. They are signed out everywhere; their name stays on what they recorded."]
    ], "", []],

    ["repreg", "registers", "Repeat prescriptions", "Prescriptions on file, and when each one runs out.", [
      ["Record a prescription", "Press New prescription.", "Fill in the date written, ID card, patient, medicine, dose, prescriber and reg no.", "Press Save prescription. It is valid for six months from the day it was written."],
      ["Renew a prescription", "Press Renew on a prescription that has run out."],
      ["See who is due", "Fill in Collected every, for example 28 days, when you record it.", "Each line shows when it is next due; Due lists the ones coming up.", "Press Collected today when the patient collects. Undo puts it back."],
      ["Correct a prescription (the pharmacist)", "Under Written by month, press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a prescription is in the classic screen.", []],

    ["cnreg", "money", "Credit notes", "Money customers have with you, and what is left of it.", [
      ["Give a credit note", "Press New credit note.", "Fill in the name, surname, phone, amount and receipt no.", "Press Save credit note."],
      ["Use a credit note", "Press Use on the customer's note and type what they spend, or press Use all."],
      ["Put back a use made by mistake (the pharmacist)", "Find the note: a search also finds notes used up.", "Press Undo on the use, then Undo the use."],
      ["Correct a note (the pharmacist)", "Press Correct on the note.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a credit note, notes and printing a note are in the classic screen.", []],

    ["lrcreg", "money", "Locum receipts", "What each locum was paid, ready to print and sign.", [
      ["Write a receipt", "Press New receipt.", "Fill in the locum, reg no., day, hours and € per hour.", "Press Save receipt."],
      ["Print the month", "Press Print the month for every receipt, ready to sign."],
      ["Correct a receipt (the pharmacist)", "Press Correct on the receipt. Correcting a receipt asks for the edit password, as the classic screen does.", "Change what was wrong and say why, then press Save correction."],
      ["Change month", "Use ‹ and ›."]
    ], "Deleting a receipt is in the classic screen.", []],

    ["odreg", "stock", "Order diary", "What to order, by supplier, and what came in.", [
      ["Add an item to order", "Press Add an item.", "Fill in the item, how many and the supplier.", "Press Add to today."],
      ["Mark what came in", "Press Received, Not received or Wrong pick on each item."],
      ["Change or delete an item", "Tap the item. Change what is needed and press Save changes.", "The pharmacist can press Delete…, then Delete item."],
      ["Another day", "Use ‹ and › to change day. Press Carry to tomorrow for what did not come."]
    ], "Printing the day's list is in the classic screen.", []],

    ["qtreg", "stock", "Price check", "Supplier quotes, cheapest first, with your margin.", [
      ["Record a quote", "Press New quote.", "Fill in the item, supplier, VAT, cost and any discount or free stock.", "Press Save quote."],
      ["Compare", "Quotes for the same item are listed cheapest first, with your margin at the retail price."],
      ["Change or delete a quote", "Tap the supplier. Change what is needed and press Save changes.", "The pharmacist can press Delete…, then Delete quote."],
      ["Share with the group", "Tick All our pharmacies so your other pharmacies see the quote."]
    ], "Importing a price list, merging duplicates and printing are in the classic screen.", []],

    ["ssreg", "stock", "Shortages", "What other pharmacies are looking for, and what you asked for.", [
      ["Ask for something", "Press Ask for something.", "Fill in the item, how many and when it is needed.", "Press Ask the network. When an offer comes in, press Accept."],
      ["Help another pharmacy", "Press I can help on what they need, say how many and press Offer.", "When they accept, press It is sent."],
      ["Have spare stock?", "Share it in Scarce stock."]
    ], "Offering your own spare stock, changing or closing a request are in the classic screen.", []],

    ["brdreg", "team", "Chat board", "Messages between pharmacies. Kept for six months unless pinned.", [
      ["Send a message", "Choose Our group or Every pharmacy.", "Type the message and press Send to our group, or Send to every pharmacy."],
      ["Make a suggestion", "Add #suggestion to the message to save it to the suggestions list."],
      ["Filter", "Everything shows all messages; Our group only hides the rest."]
    ], "The suggestions list (priority, status, comments, export) is in the classic screen.", []],

    ["conreg", "team", "Contacts", "Suppliers, reps, doctors and everyone else the pharmacy calls.", [
      ["Find a number", "Choose a group, such as Suppliers or Doctors, or search."],
      ["Add a contact", "Press Add a contact.", "Choose the type and fill in the name, phone and email.", "Press Add contact. Every pharmacy in your group sees it."],
      ["Change or delete a contact", "Open the contact and press Edit. Change what is needed and press Save.", "The pharmacist can press Delete…, then Delete contact. A shared contact goes for every pharmacy in your group."],
      ["Emergency numbers", "Choose Emergency for 112, police, hospitals and health centres."]
    ], "Import and export, hiding sections and the specialty filter are in the classic screen.", []],

    ["vaxreg", "services", "Vaccines", "Vaccines ordered for clients, for travel or routine.", [
      ["Order vaccines for a client", "Press New order.", "Choose Travel or Routine and other, fill in the client, and press Add a vaccine for each one.", "Press Save order. Saving takes these vaccines off stock.", "To print it, choose A4 or Receipt."],
      ["Find an order", "Search covers the latest 200 orders."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Stock, batches and expiry, the vaccine database and printed tables are in the classic screen.", []],

    ["eodreg", "money", "End of day", "Close the till: X readings, cash, cheques and the bank bag.", [
      ["Close the day", "Check the day, staff, shift and float at the top; press Change to change them.", "Add an X reading for each till, then count the cash.", "Add any cheques, EPOS lines and paid outs.", "Press Save and lock when it balances, or Save to finish later."],
      ["Print the day", "Press Print on A4."],
      ["Print the month", "Press Print with the month's name. Choose a day in another month to print that one."],
      ["Correct a locked day (the pharmacist)", "Open the locked day. Press Correct this day to write what was wrong.", "Press Unlock to correct.", "Change what was wrong, then press Save and lock."],
      ["From Today", "Press Close the day on Today at closing time."]
    ], "A date-range report across months, the audit log, copying the deposit to an email and managing bank contacts are in the classic screen.", [["X reading", "the till's total for the day so far, printed by the till."]]],

    ["pocreg", "services", "Point-of-care tests", "Blood pressure, glucose, cholesterol and other tests, per patient.", [
      ["Record a test", "Press New test, then choose the test, such as Blood pressure.", "Find the patient or fill in their details, then the results.", "Press Save test."],
      ["Print a test for the patient", "Open the patient, then press Print beside the test."],
      ["Change a test", "Open the patient, then press Change beside the test.", "Correct the results or the details, then press Save changes."],
      ["Read the marks", "High and low marks are a guide for adults and are not saved with the test."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a test, the patients list with its flags, and exporting or importing a spreadsheet are in the classic screen.", []],

    ["scsreg", "stock", "Scarce stock", "Hard-to-get lines pharmacies have spare, and who asked for them.", [
      ["Share spare stock", "Press Share stock.", "Fill in the item, how many, expiry and batch.", "Press Share it. Change it later, or press None left."],
      ["Find something", "Search the list of what pharmacies have spare.", "Press Ask for some, say how many, then press Ask for it."],
      ["Can't find it?", "Press Ask in Shortages."]
    ], "Deleting a line, placing it on Transfers or Returns, closed lines and printing are in the classic screen.", []],

    ["audreg", "settings", "Audit trail", "Who changed what, across the whole system. Times are Malta time.", [
      ["See recent changes", "Choose Today, 7 days, 30 days or 90 days."],
      ["Look at one change", "Open a line to see what it was before and after."],
      ["Print", "Press Print."]
    ], "The same list, with a filter for any action code, is in the classic screen.", []],

    ["expreg", "settings", "Download our records", "Your registers for the days you choose, as a spreadsheet to keep, or printed for an inspector. For the pharmacist only.", [
      ["Download a month", "Choose This month, Last month, A year or Choose days.", "Tick the registers, or press Legal registers only.", "Press Download spreadsheet."],
      ["Print for an inspector", "Choose the days, then press Print inspection pack."],
      ["Keep it safe", "The file holds patients' names and ID cards."]
    ], "", []],

    ["pvreg", "services", "Adverse reactions", "Reactions to medicines reported here, and where each report stands.", [
      ["Record a reaction", "Press New report.", "Fill in the patient's initials and age, the medicine and what happened.", "Press Add another medicine if more than one was taken, then press Save report."],
      ["Follow a report", "Open it and press Correct to change its status when it is sent to the medicines authority, then press Save changes."],
      ["Initials only", "Never write a patient's full name here."]
    ], "Deleting a report, printing it and the PDF form are in the classic screen.", [["Causality", "how likely the medicine caused the reaction, by the WHO scale."]]],

    ["scrreg", "services", "Screening campaigns", "Health checks run as events, and the people screened at each.", [
      ["Start a campaign", "Press New campaign.", "Fill in the name, type, place and dates. The type sets which results are written.", "Press Create campaign."],
      ["Screen a person", "Open the campaign and press New screening.", "Fill in the person and their results, then press Save screening. Record the next person starts the next one."],
      ["Back to the list", "Press All campaigns."]
    ], "Editing or removing a person, scheduling follow-ups, editing, duplicating or deleting a campaign, and the summary are in the classic screen.", []],

    ["ocpreg", "services", "Contraceptive pills", "Find a pill by its hormones and doses.", [
      ["Find a pill", "Choose the hormones and type the doses.", "Matching pills appear as you type."],
      ["Find the same pill", "Tap a pill to see others with the same hormones and doses. Clear starts again."],
      ["Change units", "Use mg or mcg."]
    ], "To print the results, use the classic screen.", []],

    ["lblreg", "services", "Dispensing labels", "Fill in the label, check it, print it.", [
      ["Print a label", "Fill in the patient, medicine and how to take it.", "Tap the warnings that apply.", "Check the preview and press Print label."],
      ["Read it in Maltese", "Choose English + Maltese to see the words to read to the patient. The printed label is in English, as on the classic screen; Maltese prints only from a Maltese template."],
      ["Start again", "Press Clear."]
    ], "Templates, pharmacy details, the full print history and the warnings table are in the classic screen.", []],

    ["sinreg", "stock", "Supplier stock", "What suppliers have right now, at what price, and your orders to them.", [
      ["Find a product", "Under Stock, search a supplier's list."],
      ["Order from a supplier", "Press Add to order on each line.", "Press Send order."],
      ["Check your orders", "Press Sent orders to see what each supplier did. Press Mark as received when it arrives."]
    ], "Columns, sorting, expiry warning months and reporting a problem with a delivery are in the classic screen.", []],

    ["otcreg", "services", "Over the counter", "What to recommend, by symptom.", [
      ["Find by symptom", "Search, or pick a symptom from the list."],
      ["Choose a product", "Open a product to see its cautions and alternatives."],
      ["Go back", "Use the ‹ link at the top to return to where you were."]
    ], "The map view, its score and limit filters and the complementary-items filter are in the classic screen.", []],

    ["eposreg", "money", "Emergency POS", "Sell when the main till is down. A sale with no connection waits on this device and is sent when it is back.", [
      ["Make a sale", "Find each product and add it to the basket.", "Choose Cash, Card or Other.", "Press Take with the amount."],
      ["Cash given", "Press Exact, or type what the customer gave to see the change."],
      ["Cancel a sale", "Open the sale in the day's list, press Void, then Void sale."],
      ["No connection", "Keep selling. The sales are sent when the connection is back."],
      ["No products yet", "Press Import the product list."]
    ], "Scanning with the camera, photo search, setting a barcode per line, importing a new product list or clearing it, and printing the day’s receipts are in the classic screen.", []],

    ["calreg", "services", "Pharmacy calculators", "Dosing plans and the tablets or insulin to dispense, for one patient. The calculations, the saved plan and the printout are the same as on the classic screen.", [
      ["Make a plan", "Choose Levothyroxine, Steroid taper, Warfarin, Insulin supply or Methotrexate.", "Fill in the doses and dates."],
      ["Save and print", "Press Save and print. The full plan is on the printout."],
      ["Start over", "Press Start again. Print again prints a saved plan once more."]
    ], "Deleting a saved plan is in the classic screen.", []],

    ["dupreg", "customers", "Possible duplicates", "People who look like the same person but were written down differently in different sections. Nothing here changes a record.", [
      ["Look for duplicates", "Open the screen. People are grouped by the same ID card, phone number, or name and date of birth."],
      ["Check again", "Press Check again after changes."],
      ["Not the same person", "Press Not the same person on a group. This device remembers it; Show again brings it back."]
    ], "", []]
  ];

  var BY = {};
  G.forEach(function (g) { BY[g[0]] = { id: g[0], tab: g[1], title: g[2], purpose: g[3], tasks: g[4], classic: g[5], words: g[6] || [] }; });

  function esc(s) { return E.escapeHtml(String(s == null ? "" : s)); }
  function tabTitle(t) { for (var i = 0; i < TABS.length; i++) if (TABS[i][0] === t) return TABS[i][1]; return ""; }
  function fold(s) { return String(s || "").toLowerCase().normalize ? String(s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "") : String(s || "").toLowerCase(); }
  function haystack(g) {
    var t = [g.title, g.purpose, g.classic, tabTitle(g.tab)];
    g.tasks.forEach(function (k) { t = t.concat(k); });
    g.words.forEach(function (w) { t = t.concat(w); });
    return fold(t.join(" "));
  }

  function injectCss() {
    if (document.getElementById("eikon-help-next-css")) return;
    var st = document.createElement("style");
    st.id = "eikon-help-next-css";
    st.textContent =
      ".nxh-ov{position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;padding:24px}" +
      ".nxh-pn{background:var(--panel2,#fff);color:var(--text,#000);border-radius:16px;width:100%;max-width:720px;max-height:min(86vh,820px);display:flex;flex-direction:column;box-shadow:0 20px 60px rgba(0,0,0,.25);overflow:hidden}" +
      ".nxh-hd{display:flex;align-items:center;gap:8px;padding:12px 14px;border-bottom:1px solid var(--border)}" +
      ".nxh-hd h2{flex:1;margin:0;padding-left:6px;font-size:17px;font-weight:700;letter-spacing:-.01em;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".nxh-b{font:inherit;font-size:15px;background:transparent;border:0;color:var(--accent);padding:8px 10px;border-radius:10px;cursor:pointer;min-height:40px;font-weight:600}" +
      ".nxh-b:hover{background:rgba(118,118,128,.1)}" +
      ".nxh-bd{overflow:auto;padding:16px 20px 22px;-webkit-overflow-scrolling:touch}" +
      ".nxh-bd :focus-visible,.nxh-hd :focus-visible{outline:3px solid var(--accent);outline-offset:2px}" +
      ".nxh-s{display:block;margin:0 0 14px}.nxh-s span{display:block;font-size:13px;color:var(--muted);margin-bottom:4px}" +
      ".nxh-s input{width:100%;box-sizing:border-box;font:inherit;font-size:16px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--panel,#fff);color:var(--text)}" +
      ".nxh-lab{font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--muted);margin:16px 2px 6px}" +
      ".nxh-list{display:flex;flex-direction:column;border:1px solid var(--border);border-radius:12px;overflow:hidden}" +
      ".nxh-it{display:block;width:100%;text-align:left;font:inherit;background:transparent;color:var(--text);border:0;border-top:1px solid var(--border);padding:10px 14px;cursor:pointer}" +
      ".nxh-it:first-child{border-top:0}.nxh-it:hover{background:rgba(118,118,128,.08)}" +
      ".nxh-it b{display:block;font-size:15px;font-weight:600}.nxh-it span{display:block;font-size:13px;color:var(--muted);line-height:1.4}" +
      ".nxh-new{display:flex;align-items:center;gap:10px;width:100%;text-align:left;font:inherit;background:transparent;color:var(--text);border:1px solid var(--border);border-radius:12px;padding:12px 14px;cursor:pointer}" +
      ".nxh-new .w{flex:1;min-width:0}.nxh-new b{display:block;font-size:15px;color:var(--text)}.nxh-new .d{display:block;color:var(--muted);font-size:13px}" +
      ".nxh-g p{margin:0 0 10px;line-height:1.5;font-size:15px}" +
      ".nxh-g h3{font-size:15px;font-weight:700;margin:18px 0 6px}" +
      ".nxh-g ol,.nxh-g ul{margin:0;padding-left:22px;line-height:1.5;font-size:15px}.nxh-g li{margin:2px 0}" +
      ".nxh-g dl{margin:0;font-size:14.5px;line-height:1.45}.nxh-g dt{font-weight:600;margin-top:6px}.nxh-g dd{margin:0;color:var(--muted)}" +
      ".nxh-cl{margin-top:18px;padding:10px 12px;border-radius:10px;background:rgba(118,118,128,.1);font-size:14px;line-height:1.45}" +
      ".nxh-foot{margin-top:18px;display:flex;flex-wrap:wrap;gap:8px}" +
      ".nxh-wn h3{font-size:13px;font-weight:700;color:var(--muted);margin:18px 0 6px}.nxh-wn h3:first-child{margin-top:0}" +
      ".nxh-wn li{margin:0 0 10px}.nxh-wn li b{display:block;font-size:15px}.nxh-wn li span{display:block;font-size:14px;color:var(--muted);line-height:1.45}" +
      ".nxh-wn ul{list-style:none;padding:0;margin:0}" +
      ".nxh-wn li.unread b::before{content:'';display:inline-block;width:8px;height:8px;border-radius:50%;background:var(--danger,#C4221A);margin-right:7px;vertical-align:middle}" +
      ".nxh-none{color:var(--muted);font-size:14.5px;padding:8px 2px}" +
      "@media (max-width:600px){.nxh-ov{padding:0;align-items:stretch}.nxh-pn{max-width:none;max-height:none;height:100%;border-radius:0}.nxh-bd{padding:14px 16px 28px}}" +
      "@media (prefers-color-scheme: dark){html[data-ui2]:not([data-ui2-visit]) .nxh-ov{background:rgba(0,0,0,.6)}}";
    document.head.appendChild(st);
  }

  var S = { ov: null, opener: null, q: "", view: "list", id: null, from: null, keyHandler: null };

  function close() {
    if (!S.ov) return;
    document.removeEventListener("keydown", S.keyHandler, true);
    S.ov.remove(); S.ov = null;
    var o = S.opener; S.opener = null;
    try { if (o && document.body.contains(o) && o.focus) o.focus(); } catch (e) {}
  }

  function focusables() {
    return Array.prototype.slice.call(S.ov.querySelectorAll("button,input,a[href],[tabindex]:not([tabindex='-1'])")).filter(function (el) { return !el.disabled && el.offsetParent !== null; });
  }

  function onKey(ev) {
    if (!S.ov) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); close(); return; }
    if (ev.key === "Tab") {
      var f = focusables(); if (!f.length) return;
      var first = f[0], last = f[f.length - 1], a = document.activeElement;
      if (!S.ov.contains(a)) { ev.preventDefault(); first.focus(); return; }
      if (ev.shiftKey && a === first) { ev.preventDefault(); last.focus(); }
      else if (!ev.shiftKey && a === last) { ev.preventDefault(); first.focus(); }
    }
  }

  function listHtml() {
    var q = fold(S.q).trim(), words = q ? q.split(/\s+/) : [];
    var html = '<label class="nxh-s"><span>Search the guides</span><input type="search" id="nxh-q" autocomplete="off" spellcheck="false" placeholder="A screen, or what you want to do" value="' + esc(S.q) + '"></label>';
    if (!q) {
      var n = E.whatsNew ? E.whatsNew.unread() : 0;
      html += '<button type="button" class="nxh-new" data-go="whatsnew"><span class="w"><b>What\'s new</b><span class="d">What changed in Eikon, newest first.</span></span>' + (n ? '<span class="nxh-dot" role="img" aria-label="Unread"></span>' : "") + "</button>";
    }
    var any = false;
    TABS.forEach(function (t) {
      var items = G.filter(function (g) { return g[1] === t[0]; }).map(function (g) { return BY[g[0]]; }).filter(function (g) {
        if (!E.modules[g.id] && E._lateIn) return false; // not in this build or for this person
        if (E.modules[g.id] && E.modules[g.id].adminOnly && E.state.user && E.state.user.role && E.state.user.role !== "admin") return false;
        if (!words.length) return true;
        var h = haystack(g); return words.every(function (w) { return h.indexOf(w) >= 0; });
      });
      if (!items.length) return;
      any = true;
      html += '<h3 class="nxh-lab">' + esc(t[1]) + '</h3><div class="nxh-list">' + items.map(function (g) {
        return '<button type="button" class="nxh-it" data-guide="' + esc(g.id) + '"><b>' + esc(g.title) + "</b><span>" + esc(g.purpose) + "</span></button>";
      }).join("") + "</div>";
    });
    if (!any) html += '<p class="nxh-none" role="status">No guide matches “' + esc(S.q) + '”. Try another word, such as fridge, order or print.</p>';
    if (!q && E.showHelpGuide && E.HELP_CONTENT) html += '<div class="nxh-foot"><button type="button" class="nxh-b" data-go="classic">Guides for the classic layout</button></div>';
    return html;
  }

  function guideHtml(g) {
    var html = '<div class="nxh-g"><p>' + esc(g.purpose) + "</p>";
    var hub = ["stock", "registers", "services", "money", "team"].indexOf(g.id) >= 0;
    g.tasks.forEach(function (k) {
      html += "<h3>" + esc(k[0]) + "</h3>";
      var steps = k.slice(1);
      html += steps.length > 1 && !hub ? "<ol>" + steps.map(function (s) { return "<li>" + esc(s) + "</li>"; }).join("") + "</ol>" : "<p>" + esc(steps.join(" ")) + "</p>";
    });
    if (g.words.length) html += "<h3>Words used</h3><dl>" + g.words.map(function (w) { return "<dt>" + esc(w[0]) + "</dt><dd>" + esc(w[1]) + "</dd>"; }).join("") + "</dl>";
    if (g.classic) html += '<p class="nxh-cl"><b>Still in the classic screen.</b> ' + esc(g.classic) + "</p>";
    var here = E.state.activeModuleId === g.id;
    if (!here && E.modules[g.id]) html += '<div class="nxh-foot"><button type="button" class="nxh-b" data-open="' + esc(g.id) + '">Open ' + esc(g.title) + " ›</button></div>";
    return html + "</div>";
  }

  function longDate(ymd) {
    var p = String(ymd).split("-"), M = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return Number(p[2]) + " " + (M[Number(p[1]) - 1] || "") + " " + p[0];
  }

  function whatsNewHtml(list, unreadIds) {
    if (!list) return '<p class="nxh-none" role="status">Loading…</p>';
    if (!list.length) return '<p class="nxh-none">Nothing to show yet.</p>';
    var html = '<div class="nxh-wn">', day = null;
    list.forEach(function (it) {
      if (it.date !== day) { if (day) html += "</ul>"; day = it.date; html += "<h3>" + esc(longDate(it.date)) + "</h3><ul>"; }
      var un = unreadIds.indexOf(it.id) >= 0;
      html += '<li' + (un ? ' class="unread"' : "") + "><b>" + (un ? '<span class="nxh-sr">New: </span>' : "") + esc(it.title) + "</b><span>" + esc(it.text) + "</span></li>";
    });
    return html + "</ul></div>";
  }

  function paint(focusSel) {
    if (!S.ov) return;
    var title = "Help", back = "", body = "";
    if (S.view === "guide" && BY[S.id]) { title = BY[S.id].title; body = guideHtml(BY[S.id]); back = "‹ All guides"; }
    else if (S.view === "whatsnew") {
      title = "What's new"; back = "‹ All guides";
      var wn = E.whatsNew, list = wn ? wn.list() : [];
      if (!list && !S.wnTried) {
        S.wnTried = true;
        wn.load().then(function () { if (S.ov && S.view === "whatsnew") { S.unreadAtOpen = wn.unreadIds(); wn.markRead(); paint(); var c = S.ov.querySelector("[data-go]"); if (c) c.focus(); } });
      }
      body = !list && S.wnTried && wn.failed() ? '<p class="nxh-none" role="status">What\'s new could not be loaded. Check the connection and try again.</p>' : whatsNewHtml(list, S.unreadAtOpen || []);
    } else { S.view = "list"; body = listHtml(); }
    var pn = S.ov.querySelector(".nxh-pn");
    pn.innerHTML = '<div class="nxh-hd">' + (back ? '<button type="button" class="nxh-b" data-go="list">' + back + "</button>" : "") +
      '<h2 id="nxh-title">' + esc(title) + '</h2><button type="button" class="nxh-b" data-go="close">Close</button></div>' +
      '<div class="nxh-bd" id="nxh-body"' + (S.view === "list" ? "" : ' tabindex="0" role="region" aria-labelledby="nxh-title"') + ">" + body + "</div>"; // a long text with no buttons still scrolls from the keyboard
    bind();
    var f = focusSel && pn.querySelector(focusSel);
    if (f) { f.focus(); if (f.setSelectionRange && typeof f.value === "string") try { f.setSelectionRange(f.value.length, f.value.length); } catch (e) {} }
  }

  function bind() {
    var pn = S.ov.querySelector(".nxh-pn");
    pn.querySelectorAll("[data-go]").forEach(function (b) {
      b.addEventListener("click", function () {
        var go = b.getAttribute("data-go");
        if (go === "close") return close();
        if (go === "classic") { close(); E.showHelpGuide(); return; }
        if (go === "whatsnew") return show("whatsnew");
        show("list");
      });
    });
    pn.querySelectorAll("[data-guide]").forEach(function (b) { b.addEventListener("click", function () { S.id = b.getAttribute("data-guide"); show("guide"); }); });
    pn.querySelectorAll("[data-open]").forEach(function (b) { b.addEventListener("click", function () { var id = b.getAttribute("data-open"); close(); window.location.hash = "#" + id; }); });
    var q = pn.querySelector("#nxh-q");
    if (q) q.addEventListener("input", function () { S.q = q.value; paint("#nxh-q"); });
  }

  function show(view) {
    var was = S.view;
    S.view = view;
    if (view === "whatsnew" && E.whatsNew) { S.unreadAtOpen = E.whatsNew.unreadIds(); E.whatsNew.markRead(); }
    if (view === "list") {
      paint(was === "list" ? "#nxh-q" : null);
      var back = was === "guide" && S.id && S.ov.querySelector('[data-guide="' + S.id + '"]'); // back where they were in the list
      (back || S.ov.querySelector("#nxh-q")).focus();
    } else {
      paint(null);
      var c = S.ov.querySelector("[data-go]"); if (c) c.focus();
    }
  }

  // opts: { id } a screen's guide, { view: "whatsnew" }, or nothing for the list. opts.opener gets focus back on close.
  function open(opts) {
    opts = opts || {};
    injectCss();
    if (S.ov) close();
    S.opener = opts.opener || document.activeElement;
    S.q = ""; S.wnTried = false; S.id = BY[opts.id] ? opts.id : null;
    S.view = opts.view === "whatsnew" ? "whatsnew" : (S.id ? "guide" : "list");
    var ov = document.createElement("div");
    ov.className = "nxh-ov";
    ov.innerHTML = '<div class="nxh-pn" role="dialog" aria-modal="true" aria-labelledby="nxh-title"></div>';
    ov.addEventListener("mousedown", function (ev) { if (ev.target === ov) close(); });
    document.body.appendChild(ov);
    S.ov = ov;
    S.keyHandler = onKey;
    document.addEventListener("keydown", S.keyHandler, true);
    if (S.view === "whatsnew" && E.whatsNew) { S.unreadAtOpen = E.whatsNew.unreadIds(); E.whatsNew.markRead(); }
    paint(S.view === "list" ? "#nxh-q" : null);
    if (S.view !== "list") { var c = ov.querySelector("[data-go]"); if (c) c.focus(); }
  }

  E.helpNext = { open: open, close: close, guides: function () { return G.map(function (g) { return g[0]; }); }, guide: function (id) { return BY[id] || null; } };
})();
