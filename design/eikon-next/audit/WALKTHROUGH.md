# Eikon — fresh-eyes walkthrough (UI .178, live main, local only)

Tester: a first-time owner, a low-skill assistant, a distributor and a head-office user. I worked through the UI with Playwright (Chromium, desktop 1440×900, phone 390×844 with touch, light theme, Europe/Malta). Nothing contacted live servers. All data is made up.

Setup:
- `serve-fresh.mjs` is the busy demo pharmacy plus an **empty pharmacy**: org 3 "Fresh Org", location 60 "Ħamrun Pharmacy", owner Joseph Camilleri, owner@fresh.mt.
- `serve-portals.mjs` adds a **distributor**, Island Pharma Distributors (location 450, supplier@demo.mt), and a **head office**, Demo Group Head Office (location 650, ops@demo.mt), both to the busy org. It also adds a second pharmacy, "Demo Pharmacy Sliema", 12 supplier products and 2 pharmacy orders.
- Screenshots are in `shots/`. `-dk` means desktop and `-ph` means phone. Both servers were stopped at the end.

Caveat: the server clock is real time (Wed 11 Nov, about 17:00–18:00), so I could not move through calendar days. "Days 1–5" are a series of sessions on the same day, with the owner, the assistant (Rita Grech) and the pharmacist (Daniel Saliba) taking turns.

---

## 1. Narrative of the week

### Day 0 — the owner sets up an empty pharmacy

**First sign-in.** It took 1.3 s and landed on Today (`d0-01-first-login-dk.png`). The page is calm and modern, with a "Getting this pharmacy ready" card that has 3 steps: fridges, people, opening hours. On day 0 several things already contradict each other:
- The header says "3 checks still to do today" but the list shows 4 rows.
- Money says "€0.00 paid out today".
- The sidebar calls the owner "Pharmacist", while People-who-sign-in calls him "Admin".
- Elsewhere the empty pharmacy is already being told off. Team shows two red "Needs you now" alarms ("No pharmacist signed in", "No pharmacist 07:30–19:30"). Registers says "Sign-off for October 0 of 5", although the pharmacy did not exist in October, and "8 certificates have no date". Money says "Yesterday not closed" (`d0-nav-*`).

**Settings** (`d0-nav-settings-dk.png`):
- There is no pharmacy details page: no address, phone, licence no. or logo.
- There is no opening hours, services or bookings-page setting.
- A brand-new account is greeted with "What's new: How we're doing **and 37 more**".
- Every page title gets a heavy green focus box after navigation. It looks like a selected text field.

**Opening hours.**
- Today's "Set hours" button opens *Plan shifts* and not the hours editor (`d0-setup-set-hours-dk.png`).
- Clicking a day's "07:30–19:30" opens a per-date dialog that says "Open 07:30–19:30" while the radio button underneath is set to **Closed**. It has no time fields (`d0-hours-editor-dk.png`).
- The real editor is under "⋯ › Opening hours" (`d0-opening-hours-dk.png`). It works: "Monday's hours for Tue–Fri" is a nice touch, and saving took 6 s.
- Each day takes **one range only**, so a split day such as 08:00–13:00 / 16:00–19:00, which is common in Malta, cannot be entered.
- Times showed as "07:30 AM" and dates as mm/dd/yyyy. That is the browser locale, but nothing forces 24-hour time.
- The holiday list says "Worker's Day". It should be "Workers' Day".
- A bug: the per-day dialog **stayed on screen after I navigated to another page** and blocked every click on the next screen (Playwright: "`.rps-ov` intercepts pointer events").

**Fridges and rooms** (`d0-setup-name-them-dk.png`):
- It is easy to use.
- The default room is called "Pharmacy" in its settings but "Room" on Today and in the temperature register.
- I renamed it Dispensary and added a Vaccine fridge in about 6 s.

**People who sign in** (`d0-addperson-dk.png`, `d0-person-added-Rita-dk.png`):
- Name, e-mail and role, then a temporary password shown once. This is good.
- The **Role list contains only "Staff"**. The help text below explains what an Admin can do, but you cannot create a second Admin. There is also no "Pharmacist" role, even though the app constantly says "the pharmacist corrects / signs off / unlocks".

**Rota.**
- "Who works here?" is a **second, separate list of people**. Typing a name offers no suggestions from the sign-in accounts, so every name must be typed again and spelt the same.
- Fill… › "Same days every week" has 7 ways to fill, which is too many. Each fill took about 10 clicks and showed a clear preview ("Adds 250 shifts · skips 11 public holidays").
- The result is good (`d0-rota-filled-dk.png`). Past days from before the pharmacy existed are still flagged "No pharmacist Mon 9 Nov".

**Contacts.**
- Adding a supplier is simple: type, name, phone, e-mail.
- The built-in emergency list has Maltese place names **without their letters**: "Frangisk Saver Fenech" (Franġisk), "Birzebbuga", "Zejtun", "Ghaxaq", "Xghajra", "Zabbar", "Kuncizzjoni", "Marsascala" (`d0-contacts-dk.png`).
- "Import and export … are in the classic screen."

**Bookings.**
- The one-screen "Set up bookings" form works (`d0-bookings-started-dk.png`).
- Provider hours default to 09:00–13:00 Mon–Fri, which ignores the opening hours I had just saved.
- At 17:20 the day column reads "Nothing booked · **full**" while the empty morning is drawn as open. "Full" is the wrong word for a day that is over.
- I found no public booking page or link to share with customers.

**Labels** (`d0-label-form-dk.png`, `d0-label-print-dk.png`):
- Typing and printing is quick.
- The printed label has only the pharmacy name, drug, dose/frequency, route and date. It has **no pharmacy address or phone and no patient** unless you tick the box. It reads "Rx:" and "Dose/Freq: … | …", which is crude.
- Services says labels come "in English or Maltese", but the new screen has no language switch.
- "Templates, pharmacy details … are in the classic screen." The classic screen is a dark, emoji-icon "Smart Label Generator" that looks like a different product (`d0-labels-classic-dk.png`).

**Customers.**
- "+ New" works. Maltese letters are kept, the ID card is zero-padded (77788M → 0077788M), and searching "Guzeppi" finds Ġużeppi. All good.
- **There is no customer import** (CSV or Excel) anywhere.

### Day 1 — assistant opens the day

**First sign-in with the temporary password** (`d1-choose-password-dk.png`).
- She is asked to type the **temporary password again**, after typing it 2 seconds earlier.
- The "Logging in…" text stays visible.
- The mismatch error is clear.

**Today, as Rita** (`d1-rita-today-dk.png`):
- Temperatures are 3 rows with min, max and Log, about 2 s each.
- Out-of-range (9.1 °C) asks for a note, with good one-tap reasons (`d1-temp-Vaccine-dk.png`).
- Cleaning takes one tap.
- At the end it says "A quiet evening. Everything is done." This is lovely.
- The subtitles still say "No reading yesterday" on day 1.

**Daily register** (`d1-drr-saved-dk.png`):
- The customer picker fills ID and name. One line took about 6 s.
- The prescriber's reg no. is never suggested.
- "October 2026 is not signed off yet" nags on every register page, although the pharmacy did not exist in October.

**Controlled drugs.**
- Received: invoice with 2 lines in about 6 s. Drug-name suggestions appear, but the supplier is **not suggested from Contacts**.
- Supplied: I supplied **40 Oxycodone when only 28 had been received**. It saved with **no warning** (`d1-cds-saved-dk.png`). The mismatch only shows later on "Controlled drugs by medicine" ("12 more supplied than received — count it now", `d1-cdreg-dk.png`).
- An assistant (Staff) can record CD supplies without the pharmacist being signed in the locum register.

### Day 2 — services and bookings

**Pharmacist first sign-in.** Same flow as Rita's. Daniel is "Staff", because no other role can be chosen.

**POCT blood pressure** (`d2-poct-saved-dk.png`):
- About 7 s with the picker. Shows "High" with a guide range, then Referred to GP, Print for the patient and Book a re-check.
- Good, apart from the odd footer "The marks are a guide … and are not saved with the test".

**Vaccination** (`d2-vax-saved-dk.png`):
- About 7 s.
- The form uses **Name + Surname with no ID card**, while POCT uses one Name field plus ID. The forms are inconsistent.
- There are no vaccine-name suggestions. The vaccine database and stock are "in the classic screen".
- "Recording a vaccination does not change stock. Stock is taken off when you record the order" is confusing.

**Book and move an appointment** (`d2-booked-dk.png`, `d2-booking-move-dk.png`):
- Booking took 4 clicks and about 7 s. Moving was 3 clicks.
- The reminder only knows e-mail: "Paul has no e-mail, so call them". Yet the order "Tell" dialog (Day 3) offers WhatsApp and SMS. The two screens disagree.

### Day 3 — counter: orders, supplier diary, Tell

**Client order from the customer card**:
- About 7 s (`d3-order-saved-dk.png`). It offers "Put it in the order diary?", which is a good link.
- The order screen shows "Opening orders" as stray text.

**Stock.**
- The page shows "To order 1" and, directly under it, "**Nothing left to order.**" (`d3-stock-toorder-dk.png`).
- Items render as "x14× 1".
- "Add to today's order" works.
- The supplier field again ignores Contacts.
- There is **no way to send the order to the supplier** (e-mail, WhatsApp or portal), only "Copy list". Printing the day's list is in classic.

**Order diary "Received"** does **not** move the customer's order to Ready or prompt "Tell Ġużeppi". Today still lists him as waiting, "Needed tomorrow".

**Ready › Tell Ġużeppi** (`d3-tell-dk.png`):
- WhatsApp, SMS or E-mail, an English/Malti message, and a note that it is saved in his timeline.
- This is the best screen I saw.

### Day 4 — stock, money, end of day

All four forms worked first time in about 5 s each:
- Return
- Recall alert, with a 7-step checklist (`d4-recall-dk.png`)
- Near-expiry ("In 34 days · Offer · Send back")
- Paid out (`d4-paidout-dk.png`)

Problems with them:
- Paid out has **no cash/cheque choice** in the new form; it silently writes "cash".
- The **first credit note in the new pharmacy is "No. 41"** (`d4-creditnote-dk.png`). The number is the database row ID shared by every pharmacy (`modules.cnreg.js:265` prints `cn.id`). It leaks other clients' volume and is not a per-pharmacy sequence.
- Deleting a credit note, alert or return is "in the classic screen".

**End of day** (`d4-eod-dk.png`):
- The structure is clear: readings, till count, difference, bank bag. "Use them" pulls in paid-outs, and "Exact" appears live.
- The **default float is €1000.00**.
- The bank is hard-coded "(BOV)", and the bank contact list is in classic.
- Days before the pharmacy existed show as "8 not closed".

**Data loss and a €0 lock (major)**:
1. I filled the day and pressed Save and lock. The first press only opens a confirm bar at the bottom of a long page. The top status still read "Saved · Not locked yet" while the list read "Not saved" (`d4-eod-locked-dk.png`).
2. Earlier, "Change › Done" on the float had already saved a **€0 record**.
3. The session ended. Drafts survive moving between pages inside the app, but **not a reload or a closed tab**, and there is no "unsaved changes" warning.
4. When the next user opened End of day, it showed the empty record. **Save and lock locked a €0.00 day without any warning** (`d4-eod-locked-view-dk.png`, confirmed by `/endofday/record`).
5. The locked day still shows editable-looking fields and a "Change" button (`ph-eodreg-ph.png`).

### Day 5 — team, phone, records, security

**Team on the phone** (`d5-phone-team-ph.png`):
- The assistant sees "**No pharmacist signed in — Needs you now**" while Daniel *is* signed in to Eikon. "Signed in" means two different things: the app and the locum register.

**My shifts.**
- There is **no "my shifts" view**. Rita gets the full Plan shifts week with Fill…, Add shift, Remove and Swap for everyone (`d5-phone-shifts-ph.png`).

**Leave request.**
- "Who" is not set to her by default.
- After saving, **Rita could approve her own leave** ("Approve and remove" deleted 3 shifts, `d5-phone-own-approved-ph.png`).

**Swap.**
- This is an edit, not a request: there is no consent or notification for the other person. It offers swapping the assistant into a pharmacist's shift with no role warning (`d5-phone-swap-ph.png`).

**Handover** (`d5-handover-added-dk.png`):
- Points are added at once, but "Today's notes" need a separate "Save notes" and showed "Not saved yet". Two save models on one screen.

**Chat board.**
- "@" mentions **only pharmacies, not people**, so I could not mention Daniel.
- The audience switch includes "Every pharmacy", meaning all Eikon clients, one tap from the default.
- It shows the org name "Fresh Org", which was set at creation and cannot be renamed.

**Download our records** (`d5-download-dk.png`):
- The spreadsheet came back in 0.7 s with 16 sheets.
- The **file name drops the Ħ**: `Eikon-records-amrun-Pharmacy-…xlsx`.

**Inspection pack** (`d5-inspack-dk.png`):
- Opens in about 7 s and reads well.
- But it says "**Locum register: In order**" with no pharmacist recorded all day while controlled drugs were supplied.
- It says "Temperature: In order — every day logged" right above a table of "01/11 Not logged" rows.
- It **does not mention that supplied CDs exceed receipts**.

**Lock when idle**:
- The modal needs an explicit Save; I missed it the first time.
- The lock screen and unlock are good (`d5-idle-locked-dk.png`).

**Sign out and sign in**:
- Sign out is one click, with no confirm and no unsent-draft warning. Sign-in is 1.3 s.

**Phone sweep.**
- No horizontal scroll on the 11 pharmacy screens.
- Customers on the phone has **no page title** (only a "?") and 15 px-tall link targets (`ph-customers-ph.png`).
- The download screen's checkboxes are 18 px.

**Console.**
- No uncaught page errors during the week.
- The only HTTP error was my own wrong password-change attempt (400).

---

## 1b. Distributor (supplier portal, location 450) — a day as Ramona Ellul, Island Pharma Distributors

- **Sign-in lands in the classic dark UI**, with emoji icons, "Supplier Dashboard" and 3 stat tiles. None of the new design reaches this portal (`s-supplier-home-dk.png`).
- **The phone is unusable.** The 240 px sidebar is permanently open, the content is squeezed to about 150 px and cut off on the right (`s-supplier-home-ph.png`).

**Product list** (`s-products-dk.png`):
- A dense 14-column table. It shows **the pharmacy's retail price, profit and margin** to the supplier.
- Items expiring in 15 days (Brufen) show a plain "In Stock". The supplier gets no short-expiry flag.
- The red ✕ on each row is a delete with no label.
- **Add Product** (`s-add-product-filled-dk.png`):
  - The inputs have no accessible labels.
  - Expiry is free text: I typed "31/01/2027" and it was stored like that, next to ISO "2026-11-26" rows.
  - VAT defaults to 18% even for prescription medicines.
  - The success toast "**Added:** Zyrtec" is unstyled and lands at the very bottom-left, below the page (`s-products-dk.png`).

**Received orders** (`s-order-view-dk.png`, `s-oos-modal-dk.png`, `s-shipped-dk.png`):
- View, then per-line Available/Unavailable. Marking a line unavailable offers "also mark Out of Stock?", which is good.
- It **cannot ship a partial quantity** or offer a substitute.
- "Delivery date:" has no visible picker. The pharmacy then saw "Expected delivery: **2026-11-11**", the raw ISO date and the same day.
- "Profit Margin" is again the pharmacy's margin.

**Order feedback** (`s-feedback-view-dk.png`):
- The pharmacy's "Damaged" report arrived.
- The response is a dropdown (Acknowledged, Replacement Sent, Credit Issued…) plus Submit. Simple, but there is no free-text reply and no link to a credit note.

**Short-expiry and OOS lists**:
- `#cherubino-shortexpiry` and `#cherubino-oos` exist and open by URL ("Warehouse Short Expiry", "OOS List"). They are **not in the supplier's menu** and are **named after another client ("Cherubino")**.
- The supplier's own out-of-stock marking does not feed the "OOS List" (it shows 0 items).

**Reach.**
- A supplier only reaches pharmacies **in its own org**. A real Maltese wholesaler serving many independent pharmacies cannot use one account for all of them.

**The pharmacy side of the same flow** (Maria, new UI, `s-pharm-supplier-stock-dk.png`, `s-pharm-order1-dk.png`):
- Supplier stock and sent orders are clean. "Mark as received" is one tap.
- **Reporting a problem with a delivery needs the classic screen.** The link lands on the Inventory tab, not the order, and you have to find My Orders › View › per-line dropdown › Submit Report. It then offers "Add to Returns?", which is good (`s-pharm-classic-myorders-dk.png`).

## 1c. Head office / operations (location 650) — a day as Kurt Muscat

- **Classic dark UI.** The landing page "Company Dashboard" is an empty placeholder: "Welcome to company admin. Use the Pharmacy Overview module…" (`o-ops-home-dk.png`). On the phone it is cut off like the supplier's (`o-ops-home-ph.png`).
- **Pharmacy Overview** (`o-admin-overview-dk.png`):
  - A traffic-light grid per pharmacy and register. Useful, but it shows "**10/9 days**" for temperature (an impossible ratio).
  - Every "last:" stamp is the seed time.
  - Column names are abbreviations (DDA ST, DDA PURCH).
  - The cells cannot be opened, so you see "4/9 days" cleaning but cannot see which days.
- **How we're doing** (`o-ownreg-dk.png`):
  - The strongest head-office screen: takings, paid out, over/under, credit notes held, "Needs you" list, by pharmacy, chart with October average, and figures that open the records behind them.
  - It is new-style content inside the classic frame, so it looks pasted in.
- **Hidden modules open by URL**: "Cherubino Orders", "Price Changes", "Orders" (`o-cherubino-*.png`). "Orders" calls head office "(Your pharmacy)". Another client's brand name appears in the product.
- **Missing for head office**:
  - No group-wide user management (add or switch off staff at any pharmacy).
  - No rota or cover view across pharmacies.
  - No settings for the group or its pharmacies (names, addresses, hours).
  - No cross-pharmacy CD or recall view.
  - No way to open a pharmacy's screens read-only.
  - No export of the group figures (I found only Print).

---

## 2. Ranked issue list

Severity: **B** = blocker (the client cannot finish the task or gets wrong records), **M** = major (looks unfinished or is confusing), **m** = minor.

| # | Sev | Screen | What happens (steps) | Shot | Suggested fix |
|---|---|---|---|---|---|
| 1 | B | End of day | Filled figures are lost on reload or closed tab with no warning. The float "Done" saved a €0 record. Reopening shows €0 and **Save and lock locks a €0 day** without a check. | d4-eod-locked-view | Autosave the draft to the server. Warn on unload. Refuse or confirm a lock when X readings are €0. Make "Saved" mean the figures, not the float. |
| 2 | B | Distributor and head-office portals on phone | Fixed sidebar, content cut off; cannot be used. | s-supplier-home-ph, o-ops-home-ph | Move both portals to the new shell (bottom bar on the phone). |
| 3 | B | People who sign in | The Role list has only "Staff". You cannot add a second admin or a pharmacist role, yet every screen says "the pharmacist corrects / signs / unlocks". | d0-addperson | Add the Admin and Pharmacist roles and say who "the pharmacist" is. |
| 4 | B | Plan shifts (staff) | Staff can approve their own leave and edit, swap or remove anyone's shifts. | d5-phone-own-approved | Leave approval and others' shifts should be admin-only. Staff get "My shifts" plus requests. |
| 5 | B | CD supplied | Supplying more than was received saves silently; the problem only shows on another page. The inspection pack also ignores it. | d1-cds-saved, d1-cdreg | Warn at entry with the running balance. Flag it in Needs attention and in the inspection check. |
| 6 | M | Credit notes | The first note in a new pharmacy is "No. 41", a global row ID. | d4-creditnote | Per-pharmacy sequential numbering. |
| 7 | M | Whole app | Many tasks end in "…is in the classic screen" (pharmacy details, label templates, contacts import, deleting entries, delivery problem reports, vaccine stock, printing the order list, bank contacts, another day's handover). Classic is a different dark, emoji product. | d0-labels-classic | Bring the remaining tasks into the new UI. Never send a client to classic for routine work. |
| 8 | M | Supplier and head-office portals | The whole experience is the classic UI. The head-office home is a placeholder. | s-supplier-home, o-ops-home | Redesign: supplier "Today" (orders to ship, feedback, short expiry); head office starts on "How we're doing". |
| 9 | M | Day-0 empty pharmacy | It is accused before it has done anything: "No pharmacist — Needs you now", "Sign-off for October", "Yesterday not closed", "8 not closed", temperature "Not logged 1–10 Nov", "No pharmacist Mon 9 Nov". | d0-nav-team, d0-nav-registers, d0-nav-money | Start every check from the pharmacy's start date. |
| 10 | M | Settings / onboarding | No pharmacy details (address, phone, licence, logo), so labels lack the address. The checklist skips services, labels, contacts and bookings. "37 new things" on day 0. | d0-nav-settings | A "This pharmacy" page; a fuller first-run checklist; hide What's new on new accounts. |
| 11 | M | Opening hours | "Set hours" opens the rota, not the hours. The per-day dialog says Open but is set to Closed. Only one time range per day (no split hours). | d0-setup-set-hours, d0-hours-editor | Open the hours editor directly; fix the radio default; allow two ranges. |
| 12 | M | Overlay | The rota day dialog stays over the next page after navigation and blocks all clicks. | (Playwright log, d0d) | Close overlays on route change. |
| 13 | M | Team / Today | "No pharmacist signed in" means the locum register, not the app. A pharmacist using the app is told no pharmacist is signed in. | d5-phone-team | "Pharmacist in charge not recorded — record it", with one tap. |
| 14 | M | Inspection pack | "Locum register: In order" with nobody in charge; "Temperature: In order" over a list of not-logged days. | d5-inspack | Same day-range logic for the summary and the detail; flag days with CD activity but no pharmacist. |
| 15 | M | Rota | "Who works here?" is a second list of people with no link to sign-in accounts or the people already added. | d0-rota-name-typing | Pick people from People who sign in. |
| 16 | M | Stock / order diary | Cannot send an order to a supplier (only Copy). The supplier field ignores Contacts. Marking an item received does not move the waiting customer's order to Ready / Tell. | d3-order-diary | Send by e-mail or WhatsApp or the supplier portal; supplier picker from Contacts; "Received → tell Ġużeppi?". |
| 17 | M | Bookings reminders | E-mail only, "so call them", while Tell offers WhatsApp and SMS. No public booking link. | d2-booking-move | Reuse the Tell dialog; show the booking page link in bookings settings. |
| 18 | M | Labels | No pharmacy address or phone on the label. No Maltese switch, although Services promises one. "Rx:" and "Dose/Freq: … \|" wording. | d0-label-print | Proper label layout, language toggle, patient picked from customers. |
| 19 | M | Contacts | Maltese places without Maltese letters (Birzebbuga, Zejtun, Ghaxaq, Frangisk…). | d0-contacts | Correct the spellings. |
| 20 | M | Download | File name drops Ħ ("amrun-Pharmacy"). | — | Transliterate (Ħ→H) or keep Unicode. |
| 21 | M | Supplier product list and orders | Shows the pharmacy's retail, profit and margin to the supplier. Free-text expiry stored in mixed formats. Unlabelled inputs. Toast unstyled at the page bottom. | s-products, s-add-product-filled | Supplier-relevant columns, date picker, labels, shared toast. |
| 22 | M | Supplier portal | Short-expiry and OOS lists are hidden from the menu, named "Cherubino", and not fed by the supplier's own out-of-stock marks. No partial shipping or substitutes. Supplier limited to its own org. | s-cherubino-* | Rename; add to the menu; derive from products; allow qty shipped; link to multiple pharmacy orgs. |
| 23 | M | Pharmacy: report a delivery problem | Only in classic, and the link lands on the wrong tab. | s-pharm-classic-myorders | Per-line "Report a problem" in Sent orders. |
| 24 | M | Head office | No group user, rota or settings management. Overview cells cannot be opened. "10/9 days". "(Your pharmacy)". Cherubino modules visible. | o-admin-overview | See the missing list. |
| 25 | M | Chat board | Can only @mention pharmacies, not colleagues. "Every pharmacy" (all clients) one tap from the default. | d5-chat-sent | Person mentions with a notification; confirm before posting to every pharmacy. |
| 26 | M | Handover | Points save at once; notes need "Save notes" ("Not saved yet"). | d5-handover-added | Autosave the notes. |
| 27 | M | Vaccines vs POCT vs credit notes | Three different patient blocks (Name+Surname without ID; Name+ID; Name/Surname/Phone). | d2-vaxreg-new, d2-pocreg-new | One shared person picker with ID card. |
| 28 | M | Stock | "To order 1" plus "Nothing left to order." on the same page; "x14× 1". | d3-stock-toorder | Fix the empty-state text and quantity formatting. |
| 29 | m | Page titles | A heavy green focus box around every H1 after navigation, desktop and phone. | d0-nav-settings, ph-eodreg | Use `:focus-visible` only for keyboard, or `outline:none` on programmatic focus. |
| 30 | m | Sidebar | Owner shown as "Pharmacist" here, "Admin" in People. | d0-01 | One role name. |
| 31 | m | Today | "3 checks still to do" with 4 rows; "No reading yesterday" on day 1; "Money today €0.00 paid out today". | d0-01 | Count consistently; better empty-state copy. |
| 32 | m | Fridges | Default room is "Pharmacy" in settings, "Room" on Today. | d0-tempreg | One name. |
| 33 | m | Bookings | "Nothing booked · full" for a finished day. Provider hours ignore opening hours. | d0-bookings-started | "Closed for today"; default to opening hours. |
| 34 | m | First sign-in | Asks for the temporary password again; "Logging in…" left on screen. | d1-choose-password | Carry the temporary password over. |
| 35 | m | End of day | Default float €1000. Bank hard-coded "(BOV)". Locked day still looks editable with a "Change" button. "Saved" at the top vs "Not saved" in the list. | d4-eod, ph-eodreg | Ask for the float on first use; bank from settings; real read-only state. |
| 36 | m | Paid out | No cash/cheque choice; "cash" is silent. | d4-paidout | Method toggle. |
| 37 | m | Holidays | "Worker's Day". | d0-opening-hours | "Workers' Day". |
| 38 | m | Customers (phone) | No page title; 15 px links (Orders, Questions…); "Loyalty (classic look)". | ph-customers | Title, 44 px targets, no "(classic look)" labels. |
| 39 | m | Lock when idle | The choice needs an extra Save in a modal; easy to miss. | d5-idle-open | Save on select. |
| 40 | m | Supplier order (pharmacy side) | "Expected delivery: 2026-11-11" raw ISO; "3 items" when 2 are unavailable. | s-pharm-order1 | Format the date; "1 of 3 coming". |
| 41 | m | Vaccines | No vaccine-name suggestions; confusing stock note. | d2-vaxreg-new | Vaccine list; plain wording. |
| 42 | m | Phone nav | "Today" and "More" icons are both sun/cog-like. | d5-phone-today | Distinct icon for More. |
| 43 | m | Org name | "Fresh Org" is shown in Chat and cannot be renamed. | d5-chat | Editable group name. |

**Counts: 5 blockers, 23 major, 15 minor (43 in total).**

---

## 3. Missing for a finished product

- **Pharmacy profile**: name, address, phone, licence no., VAT no., logo. Used on labels, receipts, credit notes and the inspection pack.
- **Roles**: Admin, Pharmacist, Assistant (and Locum), with permissions: who approves leave, unlocks EOD, corrects registers, edits the rota.
- **Customer import** (CSV or Excel from the old system) and export.
- **My shifts** for staff (phone first), with a **shift-swap request** that needs the other person's consent and the manager's approval, and notifications.
- **Split opening hours** (morning and afternoon) and half-days.
- **Sending orders to suppliers** (e-mail, WhatsApp or the Eikon supplier portal) straight from the order diary.
- **Public booking page link and QR code**, plus SMS/WhatsApp reminders for bookings.
- **Bilingual dispensing labels** with the pharmacy address, patient picked from customers, and template editing in the new UI.
- **CD running balance shown on entry**, with negative-balance blocking, and the CD issue in Needs attention and the inspection pack.
- **EOD draft autosave** and protection against locking an empty day.
- **Per-pharmacy document numbering** (credit notes, receipts).
- **Person @mentions** and notifications in chat and handover.
- **Distributor portal in the new UI**: today's orders, partial shipping and substitutes, delivery dates, short-expiry list, serving pharmacies across orgs.
- **Head-office tools**: group users and pharmacies, cross-pharmacy rota and cover, drill-down from the overview, group exports, read-only "view as pharmacy".
- **No classic dependency** for routine work: deletes, imports, templates, reports, problem reports.

---

## 4. Top 10 that would most change a client's impression

1. **End of day can lose a day's figures and lock €0** (#1). Money trust is everything.
2. **Real roles**: a second admin, a pharmacist, and staff who cannot approve their own leave or rewrite the rota (#3, #4).
3. **Controlled-drug over-supply warned at entry and in the inspection pack** (#5, #14).
4. **Retire "in the classic screen"** for everyday tasks (#7). Every hop into the dark emoji UI says "unfinished".
5. **Distributor and head-office portals in the new design and usable on a phone** (#2, #8).
6. **A day-0 that does not accuse an empty pharmacy** (#9), plus a complete "This pharmacy" setup with details and hours (#10, #11).
7. **One people list**: rota names picked from sign-in accounts, and one shared patient picker across all forms (#15, #27).
8. **Close the order loop**: send the order to the supplier, then received, then "Tell the customer" automatically (#16), and give bookings the same WhatsApp/SMS reminders (#17).
9. **Proper labels**: address, Maltese option, clean wording (#18).
10. **Polish that reads as care**:
    - Maltese spellings in Contacts and the "amrun" file name (#19, #20)
    - "Credit note No. 41" (#6)
    - The green focus boxes on every title (#29)
    - The "Cherubino" name leaking into another client's product (#22, #24)
