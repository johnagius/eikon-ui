# Eikon function inventory: every function, its new home, what changes

This is the "nothing is lost" proof for the redesign. Nine reviewers read all 53
module files, the shell, the help manual, the embed loader and the 18,938-line
worker in full and listed every user-facing function with its API and line
numbers. Those reports are in `audit/`. This document is the map from each of
those functions to the reimagined design, and it is the acceptance checklist for
each area as it is rebuilt.

Counts. 816 user-facing functions and behaviours were found: 53 modules (729),
the shell (22), help (5), the embed and boot (14), with the breakdown below. The
worker has 333 routes and about 100 tables.

| Group | Modules | Functions |
|---|---|---|
| Shell and Today | core, dashboard, alerts, instructions, chat board | 98 |
| Money and rota | shifts, end of day, paid out, credit notes, locum receipts, locum register | 96 |
| Customers, orders | client orders, quotations, order diary, deliveries, tickets | 110 |
| Customers, people | appointments, loyalty, repeat prescriptions, contacts | 79 |
| Clinical | POCT, vaccines, screening, pharmacovigilance, OCP finder, calculators, OTC map, labels | 121 |
| Registers | temperature, cleaning, daily register, certificates, audit, DDA ×4 | 95 |
| Stock | transfers, returns, near expiry, scarce stock, supplier inventory, emergency POS, Cherubino ×5 | 149 |
| Portals, help, embed | supplier ×4, company admin ×2, help, GoDaddy loader, index | 68 |

How to read the tables. **Home** is the destination in the new shell (Today,
Customers, Stock, Registers, Team, Settings, Search, or a separate sign-in).
**Shape** says how the function appears there. **Keeps** are the items the
reviewers marked "must not be lost", condensed. Anything marked *new* is a gap
the audit found that the rebuild must add, not something the current product
does. Anything marked *drop* is removed on purpose, with the reason.

---

## 1. Today

The first screen. It is a view over other areas' data, so it owns few
functions of its own. Everything it shows must come from one worker call
(`GET /today`, see `RELIABILITY-AND-SPEED.md` §3.2).

| Module (functions) | Home | Shape | Keeps |
|---|---|---|---|
| Dashboard (27) | Today | The 17 status checks become ordered rows with one inline action each. Quick-entry modals for temperature, cleaning and daily register become the inline fields on their rows. Prescription label quick-print becomes "Label" in search. Near-expiry → return / scarce-stock become two actions on the Stock tile's item. *Drop:* Refresh, Diag, OTC cross-sell search box (moves to Search). | Missing-temperature-per-device detection; daily register nudge; cleaning 14-day rule; certificate ≤30 d; yesterday's handover at shift start; alerts and returns paperwork counters; coverage gap detection; unread mentions; offers to accept and transfers to confirm. *New:* blank reading can no longer be saved as 0 °C; the holiday table is data, not 2025/26 constants. |
| Instructions (16) | Today (handover) and Settings (SOPs) | Day notes and the severity-coded handover bullets live in the Team tile with "incoming from yesterday" at the top. The 13 standing SOP sections (opening, closing, EOD, POS, POYC, ordering, loyalty, HIV, Concerta, doctors, fees) move to Settings › Procedures with per-section save. A4 print stays. | Per-day handover with Low/Medium/Critical that becomes incoming next day; calendar markers; permanent handover text; HIV/Concerta enable toggles; last-updated stamps. *New:* per-section save instead of whole-document overwrite; local dates instead of UTC. |
| Chat Board (21) | Today (unread) and Team (board) | Unread mentions on Today; the board itself under Team with the same org/all scope, pins, suggestions tracker and CSV export. | Org vs all scope with confirm; @location mentions; 30 pins surviving the 6-month purge; #suggestion tracker with priority, status, superuser comments; own-message delete. *New:* mentions actually marked read; pinned list filtered by org. |
| Alerts (12) | Registers › Recalls, surfaced on Today while open | Recall/quarantine register with the 7-step checklist as the row's story; open ones appear on Today. | 7-point checklist with who/when; recall vs quarantine; batch, expiry, quantity, storage; printable register; history beyond three years. *New:* checklist ticks never dropped while a save is in flight. |

## 2. Customers

One person, one page. The audit found a person typed as free text in eleven
tables with no shared key; the new `people` table (see `RELIABILITY-AND-SPEED.md`
§2.2) is what makes this area possible. Quotations and Order Diary were listed
here in the first draft of the review and are supplier-side records; they move
to Stock.

| Module (functions) | Home | Shape | Keeps |
|---|---|---|---|
| Client Orders (23) | Customers › Orders | An order is a line on the person; "New order" is the primary action when nothing is waiting; Active/Fulfilled become a chip; the Today row shows ready orders with "Collected". | Order code and 80 mm QR sticker; deposit; follow-up trail including the auto-stamped "called, no answer"; needed-by, pick-up and priority; fulfilled timestamp; re-order from history; hand-off of lines to the supplier Order Diary and removal on cancel; printable active and fulfilled lists. *New:* contact no longer required only on update; dates never invented on load; order code issued by the server. |
| Client Deliveries (24) | Customers › Deliveries | A delivery is a line with its own status strip (Scheduled, Dispatched, Out, Delivered, Failed, Returned); Mark Delivered captures recipient, signature and proof; the driver's run sheet prints from the server. | Proof of delivery with recipient, signature flag and timestamped log; attempt counter with three-strikes-to-Returned; controlled-drug and cold-chain flags; items with batch and expiry; driver and tracking; run sheet and list prints; address capture with a map. *New:* server-issued DEL numbers; log author recorded; signature enforced when required; no silent status jumps from an edit dropdown; a privacy setting before addresses go to third-party geocoders. |
| Client Tickets (17) | Customers › Questions | A question is a line; "Reply" is the row's button on Today; "Awaiting client" and follow-up date drive a reminder on Today. | Ticket number, category, priority, status, assignee; timestamped notes; follow-up date; resolved timestamp; single-ticket and list prints; delivery-to-ticket cross-reference. *New:* server-issued TKT numbers; note author recorded; categories and staff lists become org data, not per-browser. |
| Appointments (41) | Customers › Appointments (per person) and Team › Day (the diary) | Booking from the person's page or from a free slot in the Team day view. Month, week, day, list, waiting list and the six prints stay. Doctors, clinics and schedules move to Settings. | Server-verified double-booking with live slot recheck; patient token and public lookup; full status set with cancel reason and the separate booking-confirmed flag; fee breakdown and printable totals; waiting list with priority, FULL detection and promotion; recurring and one-off schedules with slot duration; WhatsApp and email drafts; server audit on every write. *New:* no 500-row cap; cancelled slots free on the server; bookings stay visible after a schedule edit; fees default from doctor and clinic; waitlist promotion keeps identity and links back. |
| Loyalty & Campaigns (15) | Customers › Loyalty (per person) and Settings › Campaigns | Points, stamps and tier shown as facts on the person; "Record purchase" from the person; campaigns configured in Settings. | Six campaign types with their parameters and active/open-ended/date semantics; transaction ledger with receipt number, items, total, award; receipt and history prints; Maltese ID normalisation as the key; live progress view; item dictionary. *New:* a redemption transaction; balances computed by the server over all history, not the newest 500; no success message before the server confirms. |
| Repeat Prescriptions (8) | Customers › Prescriptions and Registers › Repeat prescriptions | A line on the person; the legal register view under Registers with print. | The seven statutory fields; default six-month expiry with month-end clamping; expired rows visible and highlighted; two-year look-back minimum; search; confirmed, audited delete. *New:* a real date range instead of a window that drops a year on 1 January; expiry not silently recomputed on edit. |
| Contacts (15) | Customers (clients, doctors, specialists) and Settings › Directory (suppliers, reps, head office, pharmacies, POYC, locums) | Client contacts become the people table itself. Doctors and specialists with the personal-vs-patient-safe number split become a chip. Static emergency numbers appear in Search ("112", "Mater Dei"). | Emergency and 24/7 clinic numbers; personal vs patient-safe numbers with the warning; specialist taxonomy and filter; org-wide sharing with a warning; CSV import and export; global search. *New:* client delete gets a confirm; aggregated rows distinguished from manual ones; import de-duplicates. |
| POCT (32) | Customers › Results (per person) and Services | Each test is a line on the person with the sparkline; the six entry forms open from "New result"; All Records and CSV export stay as a Services view. | Patient master on normalised ID with duplicate conflict log; the six test schemas as stored; HbA1c conversion, TC/HDL ratio, BMI category; intervention field; trends and timeline; single-result print and filtered CSV; demographics autofill. *New:* row-level saves (no whole-state replace); date of birth instead of age; out-of-range flags surfaced on Today; backup/restore reachable again. |
| Vaccines (13) | Customers › Vaccinations (per person) and Stock › Vaccines | Travel recommendations by country and the catalogue stay; an order becomes a vaccination record on the person with batch, expiry, site, pharmacist and consent. | Country → always/high-risk lists by ISO code; order with items and A4 or 75 mm print; catalogue columns; stock rows with batch and expiry; server audit. *New:* per-patient administration record; typed expiry dates with first-expiry-first; client details cleared after save; orders editable. |
| Screening Campaigns (16) | Customers (participants) and Services › Campaigns | A campaign is a Services view; a participant is a line on the person with the same result schema as POCT. | Campaign → participant → follow-up with referral and overdue tracking; per-type structured results pushed into the person's history; result and referral summaries; walk-in vs pre-registered; ID autosuggest. *New:* one result vocabulary shared with POCT; saves never dropped while another is in flight; consent field. |
| Pharmacovigilance (13) | Customers (reports on a person where consented) and Services › Adverse reactions | The five-step wizard, list, print and status lifecycle stay as a Services view. | The full ICSR field set; printable A–E report; draft/submitted/closed lifecycle and serious count; MedDRA-assisted entry. *New:* no direct identifiers stored against the initials-only rule; "Fatal" counted as serious; submitted reports locked with version history; follow-up linked to its initial. |
| Pharmacy Calculators (13) | Customers (saved plans on a person) and Search ("warfarin", "levothyroxine") | The five calculators open in a sheet over the current screen; saved plans are lines on the person with reprint. | The exact combination solver and its scoring; weekday grids and warfarin cycle mode; pack and blister rounding; methotrexate and warfarin safety banners; insulin discard and priming simulation; saved model with identical reprint; Maltese ID padding and autosuggest. *New:* Save & Print always recalculates; strengths come from reference data; plausibility limits; solver bounded. |
| Smart Labels (13) | Search ("label") and Customers (label history on a person) | Compose, preview, print and history; templates and pharmacy details move to Settings. | Printed content set; 20 bilingual warnings and 13 bilingual frequencies verbatim; history with who/when and reprint; standard vs large; per-location pharmacy details; autosuggest. *New:* print equals preview, Maltese included; mandatory fields locked per label type; dose never autofilled without confirmation; history never deleted by a stale save. |

## 3. Stock

One item's story: what is left, what is coming, what to send back. The audit
found no shared product identity across eight modules; a product master with
barcode is the prerequisite (see `RELIABILITY-AND-SPEED.md` §2.3).

| Module (functions) | Home | Shape | Keeps |
|---|---|---|---|
| Quotations (24) | Stock › Prices | Supplier invoice lines with cost, VAT, discount, profit and margin; bulk paste import with the editable preview; print by range and supplier; all-org toggle. | Cost excl/incl, discounts, free goods, profit and margin colour code; supplier + date + barcode as lookup key; bulk import with sanity check; range print with invested vs retail; all-org visibility; duplicate merge. *New:* preview cannot upload twice; destructive merges confirmed; role gate on the server. |
| Order Diary (22) | Stock › Order book | Per-day supplier order book grouped by supplier with Received / Not received / Wrong pick, carry-over, quick-add with history and quotation hints, copy-for-email per supplier, day print. | The day book and its three ticks; carry-over with the carried marker; wrong pick → Returns; item history and preferred supplier; grouped print and copy; inbound hand-offs from orders and supplier inventory. *New:* carry-over closes the source line; wrong pick is atomic; role gate on the server. |
| Supplier Inventory (20) | Stock › Buy | Every supplier's list with deals, margins and expiry warnings; per-supplier cart; commit with confirmation; My Orders with confirmed-quantity differences; report a problem and hand to Returns. | Per-supplier cart with deal arithmetic and margin; confirmation before send; order tracking and feedback; expiry warning thresholds; shared cart draft; quick add to Order Diary. *New:* cart merge instead of last-writer-wins; idempotent order creation; prices validated server-side; the expiry warning survives a background refresh. |
| Stock Transfers (23) | Stock › Share (same organisation) | Surplus listed for sister pharmacies; request → accept → dispatch → receive with private notes; hand-offs to Returns and Scarce Stock. | Same-org visibility with owner/requester split; the five-step chain of custody with audit; partial quantities and auto-close; expired stock blocked but routable to Returns; private note; printable list. *New:* quantity reserved on accept; irreversible steps confirmed; print on the Requests tab prints requests; cross-links explicit and reversible. |
| Scarce Stock (13) | Stock › Scarce (all organisations) | Offers and needs across the platform, privacy between the two parties, need → offer → accept → confirm. | Platform-wide board; the privacy rule; the need workflow with auto-close; expired offers moved to Near Expiry; hand-offs; print. *New:* requests capped at remaining and accepted before anything is depleted; no cascade deletes from a mere request; expiry computed with one clock. |
| Near Expiry (14) | Stock › Expiring | Days-to-expire traffic light; return, bulk return, add to scarce stock. | 30/90-day bands and expired highlight; return hand-off with status fed back; add to scarce stock; shelf location; as-of print. *New:* history of returned items kept; bulk return takes per-item quantities; double submissions blocked. |
| Returns (18) | Stock › Returns | Monthly returns log with the four-step checklist, refused state, copy-for-email and place-on-transfer. | Checklist, especially credit note and collection note; refused state; invoice, supplier, batch, expiry; link to Near Expiry; month print and email text; damaged flag and storage location. *New:* an "open returns" view across months; delete closes linked transfers as the dialog claims; quantity typed, not free text. |
| Emergency POS (26) | Stock › Emergency till (a full-screen tool reached from search and the Stock tile) | Offline basket, scan (camera, FMD DataMatrix), photo search, fractional quantities, cash and change, void with reason, day receipts export, catalogue import. | Offline sale queue with server idempotency; FMD capture per line and per-line barcode override; fractions; tendered, change, method, capped discount, void with reason; daily receipts with barcodes; catalogue import and cache. *New:* tendered must cover total; VAT after discount; import completes, reloads and reports progress; queue syncs on reconnect; queued sales included in the day print; role gate and sequential receipt numbers from the server. |
| Cherubino Orders (9), Admin (5), Price Changes (6), Warehouse Short Expiry (7), OOS List (8) | Stock › Group (visible only to the group's pharmacies and warehouse) | Daily branch lists and the warehouse flags; price-change log with per-branch shelf acknowledgement; short-expiry pool claimed by branches; admin-owned OOS list with proposals and back-in-stock reports. | 14-day branch lists visible to all branches; grouped warehouse view with bulk flags; per-branch "shelves checked" trail; WSL filter and batch/expiry split; allocation across branches; proposal and approval workflow; provenance; prints. *New:* "Keep OOS" keeps (today it deletes); every action confirmed and reported (today all feedback is silent); warehouse upload guarded on the server and non-destructive to branch orders; price history not read from a stale catalogue; group membership a property of the org, not a hard-coded id. |

## 4. Registers

One month-as-a-book view, chips per register, today editable. These are the
legal records; the correction model and the DDA balance in
`RELIABILITY-AND-SPEED.md` §2.3 and §2.4 apply to all of them.

| Module (functions) | Home | Shape | Keeps |
|---|---|---|---|
| Temperature (15) | Registers › Temperature; entry on Today | Month grid per device; today's cell live; devices and limits in Settings; range report and two-month chart print. | One row per active device per day with min, max, notes and the limit check; past-day entry with a visible late marker; device lifecycle without losing history; per-month report with devices as columns; chart print; resilience to a dropped connection. *New:* partial day saveable; one shared offline queue; stale values never overwrite newer ones. |
| Cleaning (7) | Registers › Cleaning; entry on Today | Month list; "Done now" on Today; month print. | Date, in, out, cleaner, supervising staff, notes; quick repeat entry; back-dating; chronological month print. *New:* print never stale; who signed is the logged-in user. |
| Daily Register (8) | Registers › Daily register; entry on Today | Month list with instant filter; "Confirm" on Today prefilled from the rota; chronological print. | The seven statutory columns; month view with filter and count; dd/mm/yyyy; printable month. *New:* cross-month search; full-month print clearly distinguished from a filtered one. |
| DDA Sales (16), DDA POYC (16), DDA Purchases (10), DDA Stock Takes (10) | Registers › DDA, four chips | One controlled-drug register with Purchases, Sales (private), POYC and Stock takes as chips, a balance column per drug, duplicate-serial decision, early-resupply flag across months, per-month print with org and location. | All columns of each register including Urgent and prescription serial; Maltese ID normalisation and client prefill; doctor suggestions; duplicate-serial dialog with quantities already dispensed; early-supply highlighting; month list with search; range report; stock takes with timestamps, item lists, keyboard entry, close marker and server-rendered print. *New:* running balance and stock-take discrepancy (the largest legal gap); append-only with corrections; closed stock takes refuse writes; POYC defaults to today; proper client and doctor endpoints instead of 18-query fan-out; one escape function that works. |
| Certificates (8) | Registers › Certificates; ≤30 d on Today | Catalogue of statutory certificates with last date, interval, next due, person and the attached document; print pack. | Fixed catalogue per location with month-end-safe next due; expired and due-soon states; attach, view, download; summary print. *New:* prior versions kept; one upload path with a clear error. |
| Locum Register (7) | Registers › Locum presence; "Clock in" on Today when a locum is rostered | Append-only presence register with time out completed later. | Date, in, out, name, registration number; back-dating; time-out ≥ time-in; chronological month print with location and signature line. |
| Locum Receipts (12) | Registers › Money › Locum receipts | Receipt per shift with Sunday/holiday rate, server-computed total, per-locum monthly and yearly report. | Receipt content and signature line; day-type detection; per-locum and all-locum reports; server-side total. *New:* edit, delete and report are permissions, not shared passwords; all receipts of the month visible; fee memory per locum. |
| Paid Out (11) | Registers › Money › Paid out; the day's total on the Takings tile | Register of cash out with receipt print, month and range reports. | Receipt with payee, amount, method, invoice or cheque, reason and signature; month and range reports by payee; payee autocomplete; cash vs cheque. *New:* no fallback into End Of Day records; paid-outs feed the day's End Of Day automatically. |
| Credit Notes (15) | Registers › Money › Credit notes (also a line on the customer) | Open and closed notes, draw-downs, notes, printable note and list. | Note record; draw-downs with remaining balance and automatic open/closed with reason; printable note and list; total outstanding. *New:* balance enforced by the server; deletes confirmed; edits not lost on refresh; pagination. |
| End Of Day (20) | Registers › Money › End of day; "Close the day" on the Takings tile | The A4 sheet as a form: X, EPOS, cheques, paid outs (prefilled), cash count, float, BOV deposit, bag number; Done locks with a ten-minute undo; supervisor unlock with reason; month and range reports. | Every field of the daily record; the E, F, Over/Under and Coins formulas exactly as printed; the A4 layout; lock with audited unlock; monthly and range totals; BOV email table and contacts; one record per location per day. *New:* a lock that a stale Save cannot undo; rounding unit stored on the record; one float default; no silent browser-only mode; all rows printed, not the first four. |
| Audit Trail (5) | Registers › Audit | Filter by register, action, person and date; paginated; export. | Who, when, which record, what changed; pagination; printable extract; admin-only. *New:* before and after values; location column; local times. |

## 5. Team

| Module (functions) | Home | Shape | Keeps |
|---|---|---|---|
| Shifts (31) | Team | Week view of who is in; rota, patterns, leave requests and approvals, opening hours and overrides, coverage rules, Malta reference, rota prints, calendar feeds. | Pharmacist coverage check against opening hours; leave with Malta entitlement and balances; weekly patterns with overwrite confirmation; staff register with registration numbers; rota prints and iCal feeds; locum hours year to date. *New:* no success message on failure; leave approval changes the rota on the server; public holidays from data; a role gate (today anyone can rewrite the rota); the calendar endpoint's debug leak closed. |
| Instructions, handover part; Chat Board; Appointments day view | Team | See §1 and §2. | |

## 6. Settings

Visited rarely. One column of plain forms.

Devices and limits (temperature), printers and label templates, pharmacy details
and licence, opening hours and public holidays, staff and roles, doctors,
clinics and schedules, loyalty campaigns, procedures (the 13 SOP sections),
directory (suppliers, reps, head office, pharmacies, POYC, locums), reference
data with review dates (OCP list, strengths, warning phrases, MedDRA subset,
vaccine country lists), the group (Cherubino) membership, and who may unlock a
register.

## 7. Search only

These open in a sheet over the current screen and close with Escape. They lose
their rail slot, not their function.

| Module (functions) | Keeps |
|---|---|
| OCP Finder (9) | Type and dose filtering in mg and mcg with tolerance; progestogen-only shown explicitly; multiphasic flag; printable results with criteria. *New:* data moved to reference data with regimen and pack size; EE defaults to mcg. |
| OTC Mindmap (12) | Symptom → product and complement links with scores and reasons; guardrails with their reasons; bundles and use cases; split-file loading. *New:* guardrails never filtered and always shown first; data version visible. |
| Pharmacy Calculators, Smart Labels | See §2. |
| Emergency numbers | From Contacts. |

## 8. Separate sign-ins

| Module (functions) | Home | Shape | Keeps |
|---|---|---|---|
| Supplier Dashboard (6), Product List (17), Received Orders (11), Order Feedback (7) | Supplier sign-in | A supplier signs in and sees orders to ship, the catalogue and problem reports. No picker. | Spreadsheet import with header mapping and editable preview; out-of-stock toggle that hides the item and notifies pharmacies; deal variants; VAT and margin maths identical to Quotations; batch and expiry; line-level availability before shipping; notes and delivery date; pending → shipped → received visible to both sides; problem and resolution taxonomies; unresolved badge. *New:* import replaces nothing until the new catalogue is complete and keeps product ids; pharmacy item notes never overwritten; a real order state machine; feedback resolutions visible to the pharmacy; feedback messages visible at all (today every toast is silent); supplier role enforced on the server. |
| Company Dashboard (1), Pharmacy Overview (7) | Owner sign-in | The compliance grid is the landing page. | Org-wide monthly grid across the ten registers; month navigation and print; certificate expiry and missing-document detection; server-side role guard; working-day denominator. *New:* working days from each pharmacy's opening hours; one definition of cleaning compliance shared with Today; past months not all amber; drill-down into a pharmacy's register; export. |

## 9. Shell, help and embed

| Item (functions) | Decision |
|---|---|
| Core shell (22) | Keep: persistent sign-in; hash-addressable screens; nested modal that preserves input; "one screen crashed" isolation; supplier badges. Change: one API client with timeout, retry and 401 handling; session revoked on sign-out; no portal picker for single-role users. Drop: intro overlay, module search, accordion categories, Fullscreen, Switch Portal as a button (it becomes the account menu), debug postMessage to the parent page. |
| Help & Guides (5, 39 chapters) | The 39 chapters are the only written SOPs in the product. They become acceptance criteria for each area (DDA 30-day rule, ID normalisation, End Of Day formulas, pharmacovigilance privacy, message retention, scarce-stock privacy) and a one-line first-use hint per screen. The manual as a destination is dropped. Add chapters for supplier and owner sign-ins if a manual is kept at all. |
| GoDaddy loader (7) and boot (7) | Eikon gets its own address. The marketing page links to it. The sandbox patch, the forced debug flag, the lazy iframe and the serial 52-file boot chain go. |

---

## 10. What is dropped, and why

Everything above is kept, merged or reshaped. This is the complete list of
things the redesign removes on purpose.

| Dropped | Why |
|---|---|
| 4.9-second intro overlay | Delay before work on every load |
| Portal picker for single-role users | Shows greyed choices to someone with one option |
| Sidebar module search and the seven accordion categories | The search box finds the thing, not the menu |
| Refresh, Load, Sync queued, Diag buttons; "Cloud: ON", "dbg=0" labels | Engineering state; the app keeps itself current or says plainly that it is not |
| Fullscreen and Exit Fullscreen | Only exist because of the iframe |
| Help & Guides as a destination | Replaced by first-use hints and the rules carried as acceptance criteria |
| Nine per-module localStorage fallback modes (orders, deliveries, tickets, shifts, loyalty, end of day, paid out, temperature queue, POS catalogue cache except the offline till) | They strand or lose data; one honest shared queue replaces them |
| Hard-coded locum receipt passwords | Replaced by a permission |
| Three different public holiday tables | Replaced by one table |
| Three copies of the API client and the per-module toast systems | One client, one toast |
| Dead paths: supplier product edit modal, stock transfer edit, POCT export/import/wipe markup, Cherubino `request_removal`, order diary `/eod/lock` and the six unused `/report/html` endpoints | Unreachable today; either revived deliberately (POCT backup is revived) or removed |

## 11. Using this as the acceptance checklist

When an area is rebuilt, the reviewer opens the matching audit report, walks the
numbered function list, and ticks each one against the new screen. A function
may change shape; it may not disappear unless it appears in §10. The "New"
items in each row are the audit's required fixes and are part of done.
