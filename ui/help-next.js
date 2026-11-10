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

    ["bookings", "customers", "Bookings", "The day's appointments as a calendar, one column for each person (or room): who is booked, what is free, who still has to be reminded.", [
      ["Set up bookings", "Press Start taking bookings. The pharmacist does this once.", "Add a practitioner, their hours and a service. Change them later in Bookings settings.", "Used the old Appointments? Instead, press Bring them over: doctors, hours and appointments come across, and the old records stay exactly as they are."],
      ["Book someone in", "Tap a free time on the calendar, or press New booking.", "Choose the service and a free time. To book the same time every week, choose Repeat.", "Press Book. If no time suits, press No time suits? Add to the waiting list."],
      ["Someone walks in", "Press Walk-in.", "Choose the service and type the name.", "Press Start now. Whoever does it and is free takes them, and they are marked Here."],
      ["Reminders", "The line above the calendar says who confirmed, who was reminded by e-mail and who to call.", "Press it for the list, with each phone number.", "Called someone and they are coming? Press Confirmed beside their name."],
      ["On the day", "Open the booking.", "Press Arrived, Done or No-show. Cancel booking asks for a reason.", "Missed bookings show under the name, and on the customer's card. Tap the phone number to call. Tap the name to open the customer."],
      ["Lunch, training, a meeting", "Tap the free time and press Block this time instead.", "Choose why and the times, then press Block.", "Tap a blocked time to see it, or to unblock it."],
      ["Change a time", "Open the booking and press Change time.", "Choose the day and a free time.", "Press Move. A customer with an e-mail is told, unless you untick Tell the customer by e-mail; otherwise the number to call is shown. If someone is waiting for that service, Eikon offers them the time that freed up."],
      ["See another day", "Tap a day, or ‹ and › for a week earlier or later. Tap the date under Bookings to choose any day.", "Day shows the calendar; Week shows seven days with how much is booked and free. People and Rooms change the columns.", "Past days show what happened and cannot be changed. Press Today to come back."],
      ["Change the settings", "Open Bookings settings (the gear beside New booking).", "Each card has its own Save. If you press Done with a change not saved, Eikon asks: Save or Throw away."]
    ], "", [["To call", "a booking whose customer has not had a reminder: no e-mail, e-mails not set up, or the e-mail did not go."], ["Walk-in", "someone served now without a booking. It is kept like any booking, marked Here."]]],

    ["stock", "stock", "Stock", "What to order, what is on its way, and what is short or at risk. Every stock screen is under it.", [
      ["Order what is needed", "Open To order: everything still to order, by supplier, with the cheapest price from Price check.", "Customer orders, recalls to replace and what you are short of wait under Waiting to be put on an order: press Add to order.", "When you have phoned or e-mailed a supplier, press Mark ordered. Copy list copies the lines to paste."],
      ["Tick what arrives", "Open On order and press Arrived on each item, or All arrived. Not in puts it back under To order.", "Customers whose item came in are listed under In for customers: call them and press Ready."],
      ["See what is short or at risk", "Open Short or at risk: open recalls and quarantines, what expires within a month, returns waiting for a credit note and what you asked other pharmacies for. Each has its next step."],
      ["Watch", "Alerts, Near expiry, Shortages and Scarce stock."],
      ["Order", "Order diary and Supplier stock."],
      ["Send back or move", "Returns and Transfers."],
      ["Price", "Price check and Credit notes."]
    ], "", []],

    ["registers", "registers", "Registers", "The books an inspector asks for: fill them in, see what is missing, and print any month.", [
      ["What is due today", "Today's registers, at the top, lists what each register needs today: overdue first, then to do, then what is done.", "A fridge or room not logged yet has min and max boxes on its line: type the readings and press Log, as on Today.", "Every other line has its own button, such as Record, Sign in or Count: it opens that register, on today.", "When nothing is left it says All done for today. Under each register's card a short line says how it stands, such as Done today or Due in 12 days. On Today, All registers opens this page."],
      ["Every day", "Temperature, Cleaning, Daily register and Locum register."],
      ["Controlled drugs", "Controlled drugs received, Controlled drugs supplied, POYC controlled drugs and Controlled drug stock takes."],
      ["Prescriptions", "Repeat prescriptions."],
      ["Inspection and certificates", "Inspection check, Certificates and the Audit trail."]
    ], "", []],

    ["services", "services", "Services", "Who is waiting for care today, the clinical services, and the look-up tools for the counter. Appointments are in Bookings.", [
      ["Who is waiting today", "Today's services, at the top, says what is waiting first: a serious reaction report not sent yet, in red at the very top, then a booking that started and is not marked yet, screening follow-ups due today or overdue, vaccine doses due, other reaction reports not sent yet, and a vaccine batch past its expiry still in stock.", "Under them: today's bookings still to come, a screening campaign running, vaccine batches that expire within 30 days, and the tests and vaccine orders done today.", "Each line has one button, Open: it opens that screen, on the person, the booking, the dose due or the reports not sent yet where it can. When nothing is waiting it says Nothing waiting.", "Under a card a short line says how it stands, such as 4 tests today, 3 follow-ups due or 2 not sent yet."],
      ["Clinical", "Point-of-care tests, Vaccines, Screening campaigns and Adverse reactions."],
      ["Look up and print", "Contraceptive pills, Pharmacy calculators, Over the counter and Dispensing labels."]
    ], "", []],

    ["money", "money", "Money", "How the pharmacy is doing, the till, and what it owes or holds for others.", [
      ["What is left today", "Today's money, at the top, says what is left to do: today's end of day, and an earlier day never closed or never locked, first.", "It also shows the takings so far once the X readings are in, what was paid from the till, what the emergency till sold (and any sale still waiting on this device), and what customers hold on credit notes, with those that expire within 30 days.", "Each line has one button, Close the day or Open: it opens that screen, on the right day for an earlier end of day. Days saved but not locked are one line: open the first, lock it, then the next.", "Under a card a short line says when something needs a look, such as Closed today, Saturday 7 Nov not closed or 2 notes end within 30 days."],
      ["How we're doing", "Takings against the week or month before, what needs you, hours and the month-end reports (the pharmacist in charge)."],
      ["Till", "End of day, Paid out and Emergency POS."],
      ["Customers and locums", "Credit notes and Locum receipts."]
    ], "", []],

    ["team", "team", "Team", "Who is in, what they need to know, and what they are owed.", [
      ["Who is in and what to read", "Today's team, at the top, says in one line whether the pharmacy is open today, how many people are on, and which pharmacist is on until when.", "Under it, what needs you first: No pharmacist signed in in red when the pharmacy is open and nobody is in the locum register, then a gap in the pharmacist cover such as No pharmacist 13:00–16:00, the handover not read by you yet, messages on the chat board that mention you, and leave requests waiting for an answer (the pharmacist only).", "Each line has one button, such as Sign in, Fill the gap, Read or Answer: it opens that screen.", "Then who is on now and until when, who comes in later, who has finished and who is away today, with Call beside anyone whose phone number is on the rota.", "Under a card a short line says how it stands, such as 2 on now, 1 critical, not read or 3 new."],
      ["Today", "Who's in, Handover and Chat board."],
      ["Plan", "Plan shifts."],
      ["Locums", "Locum register and Locum receipts."],
      ["People", "Contacts, and People who sign in (the pharmacist only)."]
    ], "", []],

    ["settings", "settings", "Settings", "Your account, this pharmacy, help, and the classic layout.", [
      ["Change your password", "Press Password.", "Type the current password, then the new one twice."],
      ["Get help", "Press Help & guides for these guides, or What's new to see what changed.", "On any screen, the ? beside its name opens the guide for that screen."],
      ["Use the classic layout", "Press Classic layout. This browser remembers the choice.", "In the classic layout, Use the new layout brings you back."]
    ], "", []],

    ["tempreg", "registers", "Temperature", "Fridges and rooms, every day, against their limits.", [
      ["Log today's reading", "At the top, type the lowest and highest for each fridge or room, then press Log reading (or Enter).", "If the display shows the same as yesterday, press Same as yesterday: one tap logs yesterday's numbers again.", "Readings can also be logged on Today."],
      ["Say what was done about a reading outside the limits", "After logging, the day opens and asks what was done: pick a quick choice or type it, then press Save the note.", "Or press Add the note at the top, or tap the day and press Add a note."],
      ["Log a missed day", "Each fridge or room lists the days not logged. Tap that day and press Log this day.", "Type the lowest and highest and say why it is logged late, then press Log this day again."],
      ["Correct a reading (the pharmacist)", "Tap the day and press Correct.", "Change what was wrong and say why, then press Save correction."],
      ["Sign off a month (the pharmacist)", "Open last month with ‹. At the bottom, say why any days are missing, then press Sign off."],
      ["Read and print a month", "Each day shows the lowest and highest, for example 3.4–7.2°; a dashed day was not logged.", "Use ‹ and › or the month name to change month.", "Press Print."],
      ["Set up fridges and rooms", "Press Fridges and rooms, at the bottom.", "Add a fridge or a room with its limits, or change a name or a limit."]
    ], "", [["Limits", "the lowest and highest a fridge or room may be, for example 2 to 8 °C for a fridge."], ["Sign off", "the pharmacist's check that the month is complete, with who and when; it prints at the end of the month."]]],

    ["cleanreg", "registers", "Cleaning", "When the dispensary and fridge were cleaned, and by whom. At least once a week.", [
      ["Record today's cleaning", "At the top, check the cleaner's name (the last one is filled in), then press Record cleaning. Today, now and you as checker are filled in."],
      ["Record another day or time", "Press New cleaning.", "Fill in the date, time in, time out and the cleaner.", "Press Record cleaning."],
      ["See the weeks with no cleaning", "Under the month, a line lists the weeks nobody cleaned."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Sign off a month (the pharmacist)", "Open last month with ‹. At the bottom, say why any weeks are missing, then press Sign off."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "", []],

    ["drreg", "registers", "Daily register", "Prescription medicines supplied, one line each.", [
      ["Add a line", "Press New entry.", "Type the ID card: a known patient is filled in for you.", "Fill in the medicine, posology, prescriber and reg no., then press Save entry."],
      ["Another medicine for the same patient", "After saving, press Another for (the patient's name): the patient and prescriber are filled in."],
      ["See the month", "The calendar shows how many lines each day has."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Sign off a month (the pharmacist)", "Open last month with ‹. At the bottom, press Sign off."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "", [["Posology", "how the medicine is to be taken."], ["Reg no.", "the prescriber's registration number."]]],

    ["locreg", "registers", "Locum register", "Which pharmacist was in charge, and when.", [
      ["Sign in as the pharmacist in charge", "At the top, check the name and reg no. (the last pharmacist is filled in), then press Sign in now. Today and the time now are filled in."],
      ["Sign out", "At the top, press Sign out: the time out is now."],
      ["Fill a missed day", "The calendar marks the days with work but no pharmacist. Tap that day: the form opens on it.", "Fill in the time in, time out, pharmacist and reg no., then press Save locum."],
      ["Add another day or time", "Press New locum.", "Fill in the date, time in, time out, pharmacist and reg no.", "Press Save locum."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Sign off a month (the pharmacist)", "Open last month with ‹. At the bottom, say why any days are missing, then press Sign off."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."],
      ["Pay a locum", "Use Locum receipts, under Money."]
    ], "", []],

    ["insreg", "registers", "Inspection check", "Is every register in order for the days you choose? Days not logged, notes missing, certificates due.", [
      ["Check the registers", "Choose the days: This month, Last month, Last 3 months, Since last inspection or Choose days.", "Each register says In order, Look at this or Missing, with what was found."],
      ["Print the inspection pack", "Press Print inspection pack. It opens in a new tab: a cover page, contents with every gap, each register's own pages and a sign-off page. Anyone signed in can print it.", "After the inspector has been, keep today as the last inspection; next time choose Since last inspection."],
      ["Go to what needs a look", "Under a register, press Open: the register opens on that month or day."],
      ["Print only this page", "Press Print this summary. It prints on one page with lines to sign."]
    ], "", []],

    ["certreg", "registers", "Certificates", "Calibrations, services and licences, with what is due.", [
      ["See what is expiring", "The top says what is overdue or due in the next 30 days, by name and date."],
      ["Record a service", "Press Update on the certificate (Record the first time), or the button at the top for the most urgent one.", "Fill in the last date and how many months until the next.", "Press Save. The next due date is worked out for you."],
      ["Print the list", "Press Print."]
    ], "Certificate files (scans) are kept in the classic screen for now.", []],

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
      ["See a medicine's balance", "Tap it under the month, or press By medicine: every delivery, supply and count of it in one list."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "", [["DDA", "the controlled drugs register."]]],

    ["cdsreg", "registers", "Controlled drugs supplied", "Every controlled drug handed over against a prescription.", [
      ["Record a prescription", "Press New prescription.", "Type the ID card: a known patient and address are filled in.", "Fill in the medicine and quantity, prescriber, reg no. and serial no., then press Save prescription."],
      ["More than one medicine", "Press Add a medicine for each extra line on the same prescription."],
      ["See a medicine's balance", "Tap it under the month, or press By medicine. Under the quantity, the form says what the registers give before and after this line."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "", [["Serial no.", "the number printed on the prescription."], ["Reg no.", "the prescriber's registration number."]]],

    ["poyreg", "registers", "POYC controlled drugs", "Controlled drugs given under the Pharmacy of Your Choice scheme.", [
      ["Record a prescription", "Press New prescription.", "Type the ID card: a known patient is filled in.", "Fill in the medicine and quantity, prescriber, reg no. and serial no., then press Save prescription."],
      ["More than one medicine", "Press Add a medicine for each extra line."],
      ["Correct a line (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "", [["POYC", "Pharmacy of Your Choice, the government scheme."]]],

    ["cdreg", "registers", "Controlled drugs by medicine", "One running register for each medicine: what came in, what went out, and every count.", [
      ["Find a medicine", "Type part of its name or the brand, then tap it.", "It shows what the registers give now, from the last stock-take count, and every line since, oldest first."],
      ["Record a delivery or a supply", "Press Supply, Receive or POYC: that register's form opens with the medicine written in.", "Fill in the rest and save. You come back here with the new line counted."],
      ["When it says Check", "Count it again, then look for a delivery or a prescription not written in, as it says.", "If it still does not match, tell the pharmacist in charge."],
      ["Another spelling of the same medicine", "Under Also found, tick it. Its lines join this balance. Tick only the same medicine and strength."],
      ["Print its lines", "Press Print."]
    ], "", [["Check", "the count and the registers do not agree, or the registers go below zero. It assumes the invoices and the count use the same units (tablets)."]]],

    ["ddstreg", "registers", "Controlled drug stock takes", "Count each controlled drug and keep the count on file, ready to print.", [
      ["Start a stock take", "Press Start a stock take.", "For each medicine, fill in the name, dosage and tablets counted. Press Add item for the next one."],
      ["Not counted yet", "In a stock take not yet closed, the medicines received or supplied since the last one that have no line yet are listed. Tap one: its name and dosage are filled in; type the tablets and press Add item."],
      ["Finish", "Press Save and close."],
      ["Print a stock take", "Open it and press Print."]
    ], "Deleting a line is in the classic screen.", []],

    ["ownreg", "money", "How we're doing", "Takings, what customers are waiting for and whether the registers are in order, for a week or a month. The pharmacist in charge only.", [
      ["See a week or a month", "Press Week or Month, then change it with ‹ and ›. Each figure is compared with the same days of the week or month before."],
      ["See the records behind a figure", "Tap the figure: the lines behind it open in a list, with their total.", "Press Close (or Escape) to go back."],
      ["Fix what needs you", "Each line under Needs you opens the register it is about, on that month."],
      ["Reports", "Under Reports, press Print or Spreadsheet: Month end for the accountant, Controlled drugs totals for the inspector, Staff hours for payroll."],
      ["More than one pharmacy", "Head office chooses one pharmacy or all of them together. It sees the figures, never a patient's details."]
    ], "", []],

    ["poreg", "money", "Paid out", "Money paid from the till: couriers, cleaners, small suppliers.", [
      ["Record a payment", "Press New payment.", "Tap a name under Paid recently, or type who it was paid to.", "Fill in the amount, cash or cheque, and what for. Enter saves."],
      ["See the totals", "Today's total and the month's are at the top, with how many payments."],
      ["Correct a payment (the pharmacist)", "Press Correct on the line.", "Change what was wrong and say why, then press Save correction."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."],
      ["At closing", "Paid out is counted in End of day."]
    ], "Deleting a payment is in the classic screen.", []],

    ["hndreg", "team", "Handover", "What the last shift left you, and what you leave the next one.", [
      ["Read what was left", "From yesterday is at the top, most critical first.", "Press Got it when you have read it. It shows the time you read it, and the pharmacist sees who has read it.", "Still needs doing? Press Carry over to leave it for tomorrow too.", "What your group pinned on the chat board is shown under Always."],
      ["Look up how we do things", "Under How we do things, open Opening the pharmacy, Closing the pharmacy or any other to read it."],
      ["Leave a point for the next shift", "Under For tomorrow, type it and mark it Low, Medium or Critical.", "Press Add point.", "Removed one by mistake? Press Undo, straight away."],
      ["Write today's notes", "Type in the notes box.", "Press Save notes."],
      ["Change the standing instructions", "Press Change beside Always, or + Standing instructions for every shift when there are none.", "Type what every shift should see, every day, and press Save standing instructions."],
    ], "Another day's handover, and changing the opening, closing and how-to instructions, are in the classic screen.", []],

    ["rotreg", "team", "Who's in", "The week's rota: who works, when, and who is away.", [
      ["See the week", "Use ‹ and › to change week. Each day shows its opening hours; a public holiday is closed unless its opening hours were changed for that day."],
      ["Find a gap", "A day with no pharmacist for some hours says so in amber, for example No pharmacist 13:30–19:30.", "Press Fill the gap: Plan shifts opens with that shift ready to add."],
      ["See the hours this month", "Under the week, open the month's hours (for example Hours in November). Each person's planned hours, shifts and leave show."],
      ["Change the rota", "Press Plan shifts."],
      ["Ask for leave", "Press ask for leave. The request is made in Plan shifts."],
      ["See who is away", "Leave shows on each person's day."]
    ], "Patterns and the calendar link are in the classic screen.", []],

    ["shfreg", "team", "Plan shifts", "Who works when: add, change or remove a shift, and answer leave requests.", [
      ["Add a shift", "Press + Add shift on the day.", "Choose the person and set the times.", "Press Add shift."],
      ["Change or remove a shift", "Tap the shift and change the times, then press Save, or press Remove shift."],
      ["Fill a gap", "A day with no pharmacist for some hours says so in amber. Press Fill the gap.", "The hours are filled in and a free pharmacist is chosen. Press Add shift."],
      ["Swap two shifts", "Tap one of the shifts, then press Swap….", "Choose the other person's shift that day. The screen says who will work when.", "Press Swap shifts."],
      ["Ask for leave", "Press + New leave request.", "Fill in who, the type, from and until, and the reason.", "Press Save leave request."],
      ["Answer a leave request", "Press Approve or Refuse on the request. You are warned if no one would cover."]
    ], "Patterns, opening hours, changing a person's details, leave balances and history, and the calendar link are in the classic screen.", []],

    ["teamreg", "team", "People who sign in", "Everyone at the pharmacy signs in as themselves, so the registers show who did what. For the pharmacist only.", [
      ["Add a person", "Press Add a person.", "Fill in the name and e-mail, and choose the role.", "Press Add. Give them the password shown."],
      ["Give a new password", "Press New password on the person. They choose their own at the next sign-in."],
      ["Switch someone off", "Press Switch off on the person. They are signed out everywhere; their name stays on what they recorded."],
      ["See who signed in today", "Those who signed in today come first, with the time (Malta time). Everyone else shows the day they last signed in.", "Admin adds people and changes settings; Staff record and read everything else."]
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
      ["Find what a customer holds", "Type their name, phone, ID card, receipt or the note's number (it is on the printed page).", "The line above the notes says what they hold. Tap a note to open it."],
      ["Use a credit note", "Open the customer's note and press Use.", "Type what they spend, or press Use all.", "When the search found one note, Enter opens its Use."],
      ["See what is ending", "At the top: what you hold for customers, what ends within 30 days and what expired with money left.", "Notes ending within 30 days are listed first, soonest at the top."],
      ["Put back a use made by mistake (the pharmacist)", "Find the note: a search also finds notes used up. Tap it to open it.", "Press Undo this use, then press Undo the use."],
      ["Correct a note (the pharmacist)", "Open the note and press Correct.", "Change what was wrong and say why, then press Save correction."],
      ["Print a note, or write on it", "Open the customer's note and press Print for its page.", "Press Add a note, type it and press Save note. The pharmacist can press Remove on a note, then Remove the note."],
      ["Read and print a month", "Press Issued by month.", "Change month with ‹ and ›.", "Press Print."]
    ], "Deleting a credit note is in the classic screen.", []],

    ["lrcreg", "money", "Locum receipts", "What each locum was paid, ready to print and sign.", [
      ["Write a receipt", "Press New receipt. Today and the rate for today's kind of day are filled in.", "Fill in the locum, reg no., hours and € per hour.", "Press Save receipt."],
      ["The same locum again", "Press Again for (the locum's name): the name and reg no. are filled in."],
      ["Print the month", "Press Print the month for every receipt, ready to sign."],
      ["Correct a receipt (the pharmacist)", "Press Correct on the receipt. Correcting a receipt asks for the edit password.", "Change what was wrong and say why, then press Save correction."],
      ["Sign off a month (the pharmacist)", "Open last month with ‹. At the bottom, press Sign off."],
      ["Change month", "Use ‹ and ›."]
    ], "", []],

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
      ["See what is for you", "Messages that mention your pharmacy are at the top, under Mentions you. Opening the board marks them as seen."],
      ["See what is new", "Messages that came since you last looked are marked New."],
      ["Send a message", "Choose Our group or Every pharmacy.", "Type the message and press Send to our group, or Send to every pharmacy."],
      ["Mention a pharmacy", "Type @ and the first letters of its name, then pick it. Only pharmacies that can read the message are offered."],
      ["Make a suggestion", "Add #suggestion to the message to save it to the suggestions list."],
      ["Filter", "Everything shows all messages; Our group only hides the rest."]
    ], "The suggestions list (priority, status, comments, export) is in the classic screen.", []],

    ["conreg", "team", "Contacts", "Suppliers, reps, doctors and everyone else the pharmacy calls.", [
      ["Find a number", "Search by name, number or email; Maltese letters are optional (zebbug finds Żebbuġ).", "Or choose a group, such as Our team, Suppliers or Doctors.", "Call or Email beside each one rings or writes in one tap."],
      ["Keep the ones you call most at the top", "Open the contact and press Star. Starred and Called recently stay at the top on this device."],
      ["Our team", "The people on the rota, with their role. Their number and e-mail are changed in Plan shifts."],
      ["Add a contact", "Press Add a contact.", "Choose the type and fill in the name, phone and email.", "Press Add contact. Every pharmacy in your group sees it."],
      ["Change or delete a contact", "Open the contact and press Edit. Change what is needed and press Save.", "The pharmacist can press Delete…, then Delete contact. A shared contact goes for every pharmacy in your group."],
      ["Emergency numbers", "112, Mater Dei and urgent care are one tap under the search.", "Choose Emergency for police, hospitals and every health centre."]
    ], "Import and export, hiding sections and the specialty filter are in the classic screen.", []],

    ["vaxreg", "services", "Vaccines", "Vaccinations given, doses due, and vaccines ordered for clients.", [
      ["Record a vaccination", "Press Record a vaccination.", "Fill in the patient and the vaccine. The batch and expiry you used last for that vaccine come in by themselves; check them.", "Choose the dose, where it was given and who gave consent. Nothing is saved without consent.", "Set the next dose if one is due, then press Save vaccination.", "Recording a vaccination does not change stock. Stock is taken off when you record the order."],
      ["Doses due", "Doses due lists the overdue doses first, then those due in the next 14 days.", "When the patient comes, press Record beside the dose due; their reminder closes by itself.", "Press Not needed, then Yes, not needed, if the dose will not be given here."],
      ["A patient's vaccinations", "Choose the patient's name to see every vaccination recorded for them, and record the next one from there."],
      ["A reaction after a vaccine", "Press Reaction beside the vaccination. The reaction report opens filled from it; describe what happened and save it."],
      ["Order vaccines for a client", "Press New order.", "Choose Travel or Routine and other, fill in the client, and press Add a vaccine for each one.", "Press Save order. Saving takes these vaccines off stock.", "To print it, choose A4 or Receipt. Press Record given when you give the vaccine."],
      ["Find a vaccination or an order", "Search covers this month's vaccinations and the latest 200 orders."],
      ["Read and print a month", "Change month with ‹ and ›.", "Press Print."]
    ], "Stock, batches and expiry, the vaccine database and printed tables are in the classic screen.", []],

    ["eodreg", "money", "End of day", "Close the till: X readings, cash, cheques and the bank bag.", [
      ["Close the day", "Check the day, staff, shift and float at the top; press Change to change them.", "Step 1: add an X reading for each till, and any EPOS lines, cheques and paid outs. Press Use them to add the Paid out register's cash paid outs. The emergency till is not part of the end of day.", "Step 2: count the notes and the coins.", "Step 3 says if the cash is over or short, and what to check. Write what you found in Notes.", "Press Save and lock when it balances, or Save to finish later."],
      ["Yesterday not closed", "A note at the top says when the day before is not locked or nothing was saved. Press Close yesterday to open it."],
      ["See past days", "Past days lists each day of the month: locked, not locked or not closed, with its difference. Choose a day to open it. Change month with ‹ and ›."],
      ["Print the day", "Press Print on A4."],
      ["Send the bag to the bank", "Fill in the bag number and choose the contact.", "Press Copy for the bank email, then paste it into the email."],
      ["Print the month", "Under Past days, choose the month and press Print."],
      ["Correct a locked day (the pharmacist)", "Open the locked day. Press Correct this day to write what was wrong.", "Press Unlock to correct.", "Change what was wrong, then press Save and lock."],
      ["From Today", "Press Close the day on Today at closing time."]
    ], "A date-range report across months, the audit log and managing bank contacts are in the classic screen.", [["X reading", "the till's total for the day so far, printed by the till."]]],

    ["pocreg", "services", "Point-of-care tests", "Blood pressure, glucose, cholesterol and other tests, per patient.", [
      ["Record a test", "Press New test. Find the patient or fill in their details.", "Choose the test, such as Blood pressure, and write the readings. The result shows in words as you type, with the last one.", "Tap the advice you gave, then press Save test."],
      ["Print it or book a re-check", "After saving, press Print for the patient, or Book a re-check to open Bookings with the patient filled in."],
      ["See how a patient is doing", "Open the patient: each test shows its latest result, whether it went up or down, and a small line of the last ten."],
      ["Change a test", "Open the patient, then press Change beside the test.", "Correct the results or the details, then press Save changes."],
      ["Read the result", "In the guide range, High, Raised and Low are a guide for adults and are not saved with the test."],
      ["Read and print a month", "The list shows one month, the latest first. Change month with ‹ and ›.", "Press Print."],
      ["In the classic screen", "Deleting a test, the patients list with its flags, and exporting or importing a spreadsheet."]
    ], "More in the classic screen.", []],

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
      ["Not sent yet", "Reports not sent yet come first, the longest waiting at the top. Choose Not sent yet to see only those."],
      ["Send a report", "Make the MPA form in the classic screen and send it.", "Open the report and press Mark as sent to MPA."],
      ["Follow a report", "Open it and press Correct to change its status, such as when it is closed, then press Save changes."],
      ["After a vaccine", "In Vaccines, press Reaction beside the vaccination: the report opens filled from it."],
      ["Initials only", "Never write a patient's full name here."]
    ], "Deleting a report, printing it and the PDF form are in the classic screen.", [["Causality", "how likely the medicine caused the reaction, by the WHO scale."]]],

    ["scrreg", "services", "Screening campaigns", "Health checks run as events, and the people screened at each.", [
      ["Start a campaign", "Press New campaign.", "Fill in the name, type, place and dates. The type sets which results are written.", "Press Create campaign."],
      ["Screen a person", "Open the campaign and press New screening.", "Fill in the person and their results. The reading shows against the guide as you type.", "Choose a follow-up date if one is needed, then press Save screening. Record the next person starts the next one."],
      ["Follow-ups", "Press Follow-ups to see who is due. Press Mark done when you have seen or called them."],
      ["See a campaign at a glance", "Open it: how many were screened, each result with its count, and the follow-ups due. People needing urgent attention come first."],
      ["Back to the list", "Press ‹ Campaigns at the top."],
      ["In the classic screen", "Editing or removing a person, changing a follow-up or adding one later, editing, duplicating or deleting a campaign, and the summary."]
    ], "More in the classic screen.", []],

    ["ocpreg", "services", "Contraceptive pills", "Find a pill by its hormones and doses.", [
      ["Find a pill", "Type a brand or hormone in the search, or choose the hormones and type the doses.", "Matching pills appear as you type."],
      ["Find the same pill", "A pill says how many others are the same. Tap it to see them. Press Clear, or Escape, to start again."],
      ["Look up again", "Pills you looked up are under Looked up recently. Tap one to see it again."],
      ["Change units", "Use mg or mcg."],
      ["Print the list", "Press Print beside the count. The printout is the classic finder's, with the pills shown."]
    ], "", []],

    ["lblreg", "services", "Dispensing labels", "Type the medicine, check the label, print it. A recent label prints again in one tap.", [
      ["Print a label again", "Type the medicine or the patient under Print a recent label again.", "Press Print again on the label. Use again puts it in the form to change it first."],
      ["Print a new label", "Type the medicine; one given before fills in how it was taken.", "Add the patient's name if it goes on the label, and tap the warnings that apply.", "Check the label and press Print label."],
      ["Usual labels", "Press Usual label to keep a medicine and its directions on this device. Tap it at the top to fill the form; × takes it off."],
      ["Read it in Maltese", "Choose English + Maltese to see the words to read to the patient. The printed label is in English, as on the classic screen; Maltese prints only from a Maltese template."],
      ["Start again", "Press Clear."]
    ], "Templates, pharmacy details, the full print history and the warnings table are in the classic screen.", []],

    ["sinreg", "stock", "Supplier stock", "What suppliers have right now, at what price, and your orders to them.", [
      ["Find a product", "Under Stock, search a supplier's list."],
      ["Order from a supplier", "Press Add to order on each line.", "Press Send order."],
      ["Check your orders", "Press Sent orders to see what each supplier did. Press Mark as received when it arrives."]
    ], "Columns, sorting, expiry warning months and reporting a problem with a delivery are in the classic screen.", []],

    ["otcreg", "services", "Over the counter", "What to recommend, by symptom. Cautions always come first.", [
      ["Find by symptom", "Search, or tap a symptom."],
      ["Choose a product", "Open a product to see its cautions first, then its alternatives and what goes with it."],
      ["Keep it handy", "Press Star on a symptom or product. Starred and Opened recently are at the top, on this device."],
      ["Go back", "Use the ‹ link at the top, or Escape, to return to where you were."]
    ], "The map view, its score and limit filters and the complementary-items filter are in the classic screen.", []],

    ["eposreg", "money", "Emergency POS", "Sell when the main till is down. A sale with no connection waits on this device and is sent when it is back.", [
      ["Make a sale", "Find each product, or tap it under Sold most today, and it goes in the basket.", "Choose Cash, Card or Other.", "Press Take with the amount. Sale saved shows the change to hand back."],
      ["Cash given", "Tap the note the customer gave, press Exact, or type what they gave to see the change."],
      ["Today's total", "Today so far, at the top, is the day's total and how many sales."],
      ["Past days", "Under Sales by day, change month with ‹ and ›, then tap a day to see its sales and totals."],
      ["Cancel a sale", "Open the sale in the day's list, press Void, then Void sale."],
      ["No connection", "Keep selling. The sales are sent when the connection is back."],
      ["No products yet", "Press Import the product list."]
    ], "Camera scanning, photo search, a barcode per line, a new or cleared product list and the day’s receipts are in the classic screen.", []],

    ["calreg", "services", "Pharmacy calculators", "Dosing plans and the tablets or insulin to dispense, for one patient. The calculations, the saved plan and the printout are the same as on the classic screen.", [
      ["Make a plan", "Choose Levothyroxine, Steroid taper, Warfarin, Insulin supply or Methotrexate.", "Fill in the doses and dates."],
      ["Save and print", "Press Save and print. It stays at the bottom of the screen with the answer beside it. The full plan is on the printout."],
      ["Same as last time", "Each calculator opens with the values you used last on this device, never the patient."],
      ["Start over", "Press Start again for the usual values. Print again prints a saved plan once more."]
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
