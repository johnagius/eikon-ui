# B2 — Customers / People modules audit

Scope: `ui/modules.appointments.js` (3,661 lines), `ui/modules.loyalty.js` (1,601), `ui/modules.repeatprescriptions.js` (679), `ui/modules.contacts.js` (1,233). Worker handlers were consulted only to state what each endpoint does (file `cloudflare-worker/code`, line refs prefixed `W:`).

Shared facts for all four modules (from `ui/core.js`):
- Sidebar shows them only in the **pharmacy** section (location_id 0–399, or superuser) via `E.SIDEBAR_CATEGORIES` (core.js:319-344). Nothing stops a supplier/company-admin user opening them by URL hash: the router only checks `E.modules[id]` exists (core.js:1225). Module gating is **client-side only**; the worker scopes every query by `org_id` + `location_id` from the session, so the worst case is an empty, correctly-scoped view.
- Server roles are a different axis (`user.role` = `admin` | `staff`, W:1020). The UI never reads `user.role`; every admin-only button is rendered for everyone and fails with a 403 toast.
- No module exposes functions on `window.EIKON` for other modules, and none calls another module. The only cross-module data flow is the Contacts "Client Contacts" aggregated feed (see Contacts).

---

## Appointments  (`modules.appointments.js`, id `appointments`, order 215, visible to: pharmacy sidebar + superuser; server: read/book/edit = admin+staff, doctors/clinics/schedules CRUD = admin only)
**Purpose.** Book, view and manage doctor appointments across doctor × clinic schedules, with a waiting list, patient tokens, fees and manual WhatsApp/email outreach.

**Functions.**
1. Month view (default) — where: tab "📅 Month"; API: GET /appointments/entries (all, no params); extras: none. 6×7 grid, Mon-first, doctor colour chips (max 4 + "+N more"), cancelled hidden, schedule days marked.
2. Month prev / next / Today — where: ◀ ▶ Today buttons (3473-3483); API: none (client cache).
3. Month cell click → jump to Day view for that date; chip click → Day view with that appointment selected (2749-2772).
4. Print Month — where: "🖨 Print Month" (3484); API: none; extras: print popup, table with Dr fee / Clinic fee / Total and TOTALS footer. Ignores doctor/clinic filter.
5. Week view — where: tab "🗓 Week"; API: same cache; 7 day columns, schedule bands, free-slot blocks, appointment blocks, detail panel.
6. Week prev / next / Today (3497-3514); Print Week (3515-3528, honours global filter); extras: print popup.
7. Week free-slot click → New Appointment modal pre-seeded with date/doctor/clinic/time (3204-3206).
8. Week appointment block click → detail panel + actions (3237-3250).
9. Day Timeline view — where: tab "🕐 Day Timeline"; API: GET /appointments/entries?date=YYYY-MM-DD on each refresh; one column per schedule (doctor×clinic) that day, schedule info bar, FULL badge when no slots left.
10. Day prev / next / Today / date picker (3537-3551); Print Day (3552-3558, honours filter); extras: print popup.
11. Day free-slot click → New Appointment modal pre-seeded (2961-2964).
12. Day "⏳ Add to Waiting List" on a FULL column → Waiting List modal locked to that doctor/clinic/date, priority Urgent (3025-3033).
13. Day appointment block click → detail panel + actions (3000-3015).
14. All Appointments list view — where: tab "📋 All Appointments"; client-side search (id, name, ID card, phone, date, status, doctor, clinic, medicines, notes), Status filter, From/To date filter, Clear, sortable headers (Date, Time, Patient, ID Card, Phone, Doctor, Clinic, Total), row click → detail panel (3279-3335, 3563-3586).
15. Print List — where: "🖨 Print List" (3576); prints filtered set with fee totals.
16. Waiting List view — where: tab "⏳ Waiting List" with live count badge of `Waiting` entries; search; sortable headers; row click → detail (3340-3447).
17. Print Waiting List — where: "🖨 Print" (3594); extras: print popup.
18. Global filter bar: Doctor and Clinic dropdowns applied to Month/Week/Day/List/print (3452-3464).
19. New Appointment — where: "+ New Appointment" header button or slot click; modal cascade Doctor → Clinic (only clinics with a schedule for that doctor) → Session Date (next 90 scheduled days, today only if slots remain) → Time slot (live check); API: GET /appointments/entries?date=… (live), GET /appointments/schedules if cache empty, POST /appointments/entries; extras: toast shows patient token. Duration = schedule slot duration; status forced `Scheduled`; fees not editable at creation.
20. Auto-add to Waiting List on create when the session is fully booked at submit time — automatic, no confirmation (1821-1835); API: POST /appointments/waitlist with flexibility `Urgent` and an auto note.
21. Edit Appointment — where: "✏ Edit" in any detail panel; modal with free date input, duration, doctor, clinic, time slot (refetched live, original slot re-added), status, Doctor/Clinic/Medicines fees with live total, medicines text, notes, cancellation reason (shown only when status = Cancelled); API: PUT /appointments/entries/:id (full record).
22. Status quick actions in detail panel: ✓ Confirm (hidden if Confirmed/Completed/Cancelled), ✓ Complete (hidden if Completed), ✕ Cancel (confirm modal, no reason), No Show (hidden if No Show); API: PUT /appointments/entries/:id partial `{status}` (2289-2306).
23. Booking Confirmed checkbox in detail panel — independent flag from status; API: PUT `{bookingConfirmed}` (2318-2342); shows "✓ Confirmed" badge in list.
24. Delete appointment — where: "🗑 Delete" in detail panel, confirm modal; API: DELETE /appointments/entries/:id (hard delete, server audit row).
25. Print single appointment — where: "🖨 Print" in detail panel (1162-1200); extras: print popup with patient token box, fees, medicines.
26. WhatsApp — where: green "WhatsApp" button next to every phone (detail panels, list rows, waitlist rows/detail); opens `https://wa.me/<number>` via `window.top.open`, then `whatsapp://send?phone=`, then a copy-link dialog (360-429). No message text is pre-filled. Trigger: user click only.
27. Email (blank) — where: "Email" button next to email in detail, and "📧 Email" action; opens `mailto:`.
28. Send Booking email — where: "📧 Send Booking"; `mailto:` with subject "Appointment Confirmation – d/m/y at hh:mm" and body (name, ID card, date, time, doctor, clinic, duration, token) (479-485).
29. Send Reminder email — where: "📧 Send Reminder"; `mailto:` with subject "Appointment Reminder – …" (487-513).
30. Add to Waiting List (manual) — where: "+ Waiting List" header button; modal: name, ID card, phone, doctor (Any), clinic (Any), preferred dates free text, priority Urgent/Flexible/Fixed, notes; API: POST /appointments/waitlist.
31. Edit waiting-list entry — where: "✏ Edit" in WL detail; adds Status select (Waiting/Promoted/Cancelled); API: PUT /appointments/waitlist/:id.
32. Book Appointment from waiting list — where: "📅 Book Appointment" (Waiting only); opens New Appointment modal with name/phone/notes pre-filled; on save marks entry `Promoted` (API: PUT /appointments/waitlist/:id) (3419-3427).
33. Cancel waiting-list entry — where: "✕ Cancel" (Waiting only), confirm; PUT `{status:"Cancelled"}`.
34. Delete waiting-list entry — where: "🗑 Delete", confirm; DELETE /appointments/waitlist/:id.
35. Manage Doctors — where: ⚙ Settings ▾ → "👨‍⚕️ Manage Doctors"; list, Add, Edit (name, specialty, phone, default patient fee, notes), Delete (confirm "and their schedules"); API: GET/POST/PUT/DELETE /appointments/doctors[/:id]. Server admin-only.
36. Manage Clinics — where: ⚙ → "🏨 Manage Clinics"; Add/Edit (name, locality, address, phone, standard clinic fee, notes), Delete; API: /appointments/clinics[/:id]. Server admin-only.
37. Manage Schedules — where: ⚙ → "📆 Schedules"; grouped list (doctor→clinic, times, slot, validity, Mon–Sun badges / one-off date); Add (recurring with day-of-week checkboxes, valid from/until; or one-off date; start/end time; slot 5–120 min); Edit = delete every record in the group then recreate; Delete group (confirm); API: GET/POST/DELETE /appointments/schedules[/:id] (PUT never used). Server admin-only.
38. Auto-refresh — automatic: `refreshAll` on first render and on every re-render, then every 30 s (850-857): 5 sequential GETs (doctors, clinics, schedules, entries [all or by date], waitlist) and a full re-render of the current view. "Last refreshed Ns ago" label updated every 5 s (2587).
39. Setup toast — automatic: "Setup needed" toast 1.2 s after render if no doctors and no clinics (3643-3647).
40. Global error catchers — automatic at script load: `window.addEventListener("unhandledrejection")` toasts "Appointments error" and calls `preventDefault()` (17-29); document-level capture click listeners for `.ap-wa-trigger` / `.ap-email-trigger` (525-555).
41. Patient token — generated server-side (4 chars, no 0/O/1/I), shown in detail/print/toast; consumed by the unauthenticated endpoint GET /appointments/public/lookup?id_card&token (W:15421, W:14668). The UI has an unused `generateToken()` (81).
Keyboard shortcuts: none.

**Data & state.**
- Endpoints: `/appointments/doctors`, `/appointments/clinics`, `/appointments/schedules`, `/appointments/entries[?date=]`, `/appointments/waitlist` (+ `/:id` PUT/DELETE). Tables: `appt_doctors`, `appt_clinics`, `appt_schedules`, `appt_appointments`, `appt_waitlist` (all org_id + location_id scoped). Every write audited server-side (`writeAudit`).
- In-memory only (`APPT_MEM`, 179): doctors, clinics, schedules, apptsAll + apptByDate index, waitlist. No localStorage, no offline queue. Cloud is source of truth.
- Polling: 30 s (`setInterval`, never cleared on leaving the module). 5 s label timer (never cleared, one per render).
- Person identity: free-text `patientName` (required), `patientIdCard`, `patientPhone`, `patientEmail` on each appointment and each waitlist row. No normalisation, no uniqueness, no link to Contacts or Loyalty. Public lookup matches `UPPER(patient_id_card)` + token (W:14688).
- Statuses: appointment `Scheduled → Confirmed → Completed | Cancelled | No Show` (any → any via Edit; quick buttons as in fn 22; server `normApptStatus` coerces unknown to Scheduled). Separate boolean `bookingConfirmed`. Waitlist `Waiting → Promoted | Cancelled` (any → any via Edit). Flexibility `Urgent | Flexible | Fixed`.
- Notifications: none automatic. All outreach is a user click opening WhatsApp (no text) or a `mailto:` draft (booking / reminder / blank). Nothing records that a message was sent.
- Double-booking: client computes free slots from a fresh `GET /entries?date=` at submit (1816-1845) and the worker re-checks overlap for same org/location/date/doctor/clinic before INSERT/UPDATE and returns 409 "Slot already booked" (W:14359-14373, W:14451-14466). The server check is SELECT-then-INSERT with no unique index, so two PCs submitting within the same few ms can both succeed. Second PC otherwise sees the modal error "This slot was just taken by another booking" (1843) or the raw 409 message.
- Waiting list logic: manual add; auto-add when fully booked at submit; "FULL" badge + add button per column in Day view; promotion is manual (fn 32) and sets only `status=Promoted` (no `promotedTo` link). No automatic offer when a slot frees up.
- Prints: month list, week list, day list, filtered list, single appointment, waiting list (all `window.open` + `document.write` + auto `window.print()`). No CSV/xlsx export.

**Permissions & scoping.**
- All data is per org **and per location** (W:14283). Doctors/clinics/schedules are therefore per pharmacy, not shared.
- Client-side-only: ⚙ Settings (doctors/clinics/schedules) and Delete buttons are shown to everyone; the worker returns 403 for `staff` (W:13925, W:13984, W:14155…). The failure surfaces only as the global "Appointments error: Forbidden – admin only" toast and the modal stays open with no state change.
- Module itself gated only by sidebar membership (see shared facts).

**Edge cases & risks (found in code, cite line numbers).**
- **Silent truncation at 500 appointments.** Month/week/list refresh calls `apiLoadAppts()` with no params (838, 841); the worker applies `LIMIT 500 ORDER BY date ASC` (W:14282, W:14305). Once a location has >500 appointments in total, the newest (future) bookings are silently absent from Month/Week/List and from the double-booking cache used by Week/Day slot drawing. Day view still fetches by date so booking remains safe, but the calendar lies.
- **Appointments disappear from Day/Week when their schedule is edited or deleted.** Day/Week only draw columns for schedules present that day (2895, 3163) and skip blocks outside the schedule window (2977, 3218). Schedule "Edit" deletes and recreates records (1541-1571); schedule/doctor delete (1627-1629, W:13994) and clinic delete (no cascade, W:14092-14108) leave bookings with no column → invisible in calendar views (still in List). Patients can be double-handled or missed.
- **Server/UI disagreement on cancelled slots.** UI frees a slot when `status.toLowerCase()==="cancelled"` (304, 2943, 3191). Worker excludes only `status!='cancelled'` lower-case (W:14363, W:14455) while it stores `Cancelled` (W:13864-13867); SQLite text compare is case-sensitive, so a cancelled booking still blocks the slot server-side → the UI offers the slot, the POST returns 409 and the user sees "Slot already booked". Rebooking a cancelled slot is impossible without deleting the record.
- **Non-atomic schedule edit** (1539-1571): N sequential DELETEs then M sequential POSTs with no transaction; a network failure mid-way leaves a partial week and the modal's `onClick` has no try/catch, so the error surfaces only via the global unhandled-rejection toast (18-25).
- **Global unhandled-rejection hijack** (17-25): installed at script load for the whole app, labels every other module's rejected promise as "Appointments error" and `preventDefault()`s it, hiding real failures elsewhere.
- **Polling never stops** (852-856): the 30 s `setInterval` and the 5 s label interval (2587) are never cleared when the user navigates to another module; each re-entry adds another 5 s timer. 5 requests/30 s per open tab, forever. `refreshAll` awaits the 5 GETs sequentially (829-845).
- **Last-write-wins edits.** Edit modal PUTs the full record (1847-1868) with no `updatedAt`/version check; two PCs editing the same booking overwrite each other, including patient contact fields. Quick status buttons send partial bodies (safer, server merges, W:14423-14429).
- **Cancel without reason** (2296-2301): quick "✕ Cancel" sets Cancelled with empty reason; help text claims a reason is required; the Edit form shows the field only after choosing Cancelled and does not enforce it (1864).
- **Fees never defaulted.** Doctor `defaultFee` and clinic `fee` are collected (1252, 1315) but never applied to a booking (no other reference to `defaultFee`/`.fee` in the file); fees must be typed manually in Edit mode only; new bookings always save €0.00. Money reports (prints with TOTALS) are therefore only as good as manual entry.
- **Waitlist → booking loses identity** (1652-1670): pre-fill copies name/phone/notes but drops `patientIdCard`, `patientEmail`, doctor and clinic from the waitlist entry; promotion (3422) does not store `promotedTo`, so there is no link between the WL row and the created appointment.
- **Auto-add to waitlist without consent** (1821-1835): if the session filled up (or the schedule was deleted) between opening and submitting, the patient is added to the waiting list as `Urgent` and the modal closes; staff may not notice the red toast.
- **Sorting bugs**: List header "Total" sorts by `a.total` which does not exist (2501 vs 2204) → no-op; Doctor/Clinic sort by numeric id string, not name.
- **Two divergent schedule matchers**: `schedulesForDate` (231) handles snake_case `day_of_week`, `getSchedulesForDate` (250) does not (262) and ignores doctor/clinic args; Month/Day/Week use the latter, booking uses the former.
- **Date/time**: all "today"/past-slot logic uses the PC clock (`todayYmd` 46, `nowMins` 286 + 5 min buffer); server has no past-date guard, so Edit mode (free date input, 1744) can move a booking into the past. Waitlist `added_date` defaults to UTC `date('now')` on the server (W:14580) vs local day in the UI. Month arithmetic uses `new Date(y, m-1, 1).setMonth(±1)` (3474, 3478) — safe. `ymdAddDays` uses `T12:00:00` (63) — DST-safe.
- **WhatsApp fallback never reached**: method 2 sets `opened = true` unconditionally (384), so when `window.top.open` is blocked and WhatsApp Desktop is absent nothing happens and the copy dialog (389-391) is dead code. `waPhone` (343-354) only knows Maltese 8-digit formats; other local formats are sent without a country code.
- **Doctor colours by array index** (117-123): adding/deleting a doctor recolours everyone.
- **Print Month ignores the global doctor/clinic filter** (3486) while Print Day/Week honour it (3523, 3555) — a "my clinic" print can leak other doctors' patient lists.
- Silent catches: `ensureSchedulesLoaded`/`ensureAppointmentsLoaded` swallow errors (322, 333); `refreshAll` logs and continues per resource (829-845) so a failed appointments fetch leaves stale data with a green "Auto-refresh active" dot.
- Destructive without confirm: Confirm/Complete/No Show status flips (one click, no undo); Booking-Confirmed toggle.
- Delete appointment/doctor/clinic/schedule/waitlist all have confirm modals; all are hard deletes (audited server-side, not recoverable in UI).
- `apiLoadAppts({date})` already saves, then callers save again (1816-1817, 1906-1907, 2039-2040) — harmless duplicate work.

**Speed notes.**
- Initial load: 5 sequential requests; `/appointments/entries` can be up to 500 rows × ~25 fields (~150–250 KB JSON). Repeated every 30 s with a full DOM rebuild of the active view (Month: 42 cells × schedule scan; Day: per-schedule slot loop; List: all rows).
- Booking modal: 1–2 extra GETs per cascade step and again at submit (good for safety, slow on poor links).
- `upcomingScheduledDates` scans 91 days × schedules on every clinic change (575-594); `computeAvailableStartTimes` is O(slots × appts) per column.
- The five `refreshAll` awaits could run in parallel; schedules/doctors/clinics rarely change and need not be polled.

**Must not be lost.**
- Server-verified double-booking per doctor × clinic × date with 409 feedback, plus the live slot recheck at submit.
- Patient token + ID-card public lookup (unauthenticated) and token shown on print/toast/email.
- Full status set incl. No Show and Cancelled-with-reason, and the separate "booking confirmed" flag.
- Fee breakdown (doctor / clinic / medicines) and medicines dispensed text with printable totals per day/week/month/list.
- Waiting list with priority, FULL-session detection and manual promotion.
- Doctor schedules: recurring by weekday with validity window, one-off sessions, slot duration.
- Manual outreach hooks: WhatsApp open, booking-confirmation and reminder email drafts.
- Server audit trail on every create/update/delete.

---

## Loyalty & Campaigns  (`modules.loyalty.js`, id `loyalty`, order 290, visible to: pharmacy sidebar + superuser; server: all admin+staff except client delete = admin only)
**Purpose.** Run multiple loyalty campaign types per pharmacy and record customer transactions (stamps, points, discounts, events, buy-X-get-Y, spend tiers) against a Maltese ID-card key.

**Functions.**
1. Dashboard tab — where: tab "📊 Dashboard" (default); stat cards (active campaigns, loyalty clients, total transactions, today's activities), active campaign cards, last 10 transactions table (463-485). API: none beyond initial sync.
2. Campaigns tab — where: tab "🎯 Campaigns"; card grid with search (name/brand/description), status badge (Active / Open-ended / Inactive / Ended / Upcoming) (519-554).
3. New Campaign — where: "＋ New Campaign" → custom overlay modal: type picker (6 cards), name, brand, items, description, open-ended toggle, start/end dates, type-specific fields (stamps target+reward; points per €1 + threshold + reward; discount % + scope; event name + offer; buy qty + get qty + reward; up to 4 spend tiers with add/remove), Active toggle; API: POST /loyalty/campaigns (upsert by id) fire-and-forget (670-708).
4. Edit Campaign — where: "Edit" on card; same modal; API: POST /loyalty/campaigns (same upsert).
5. Activate / Deactivate campaign — where: toggle button on card; API: PUT /loyalty/campaigns/:id (full object) fire-and-forget (568-585).
6. Delete campaign — where: "✕" on card, `window.confirm`; API: DELETE /loyalty/campaigns/:id fire-and-forget (586-598).
7. Record Transaction tab — where: tab "✍ Record Transaction"; ID-card input with autocomplete (min 2 chars, matches id or name, arrow/Enter/Esc keys), auto-pads ID on blur (normMtId), client name, receipt no, campaign select (active/open only) with preview, item description autocomplete (remembered items), qty, "+ Add" (Enter in item field also adds), remove item, total spend €, notes, "✓ Record Transaction", "↺ Reset" (899-1061).
8. Client loyalty snapshot — automatic on ID blur/select/campaign change: per-campaign progress (stamp grid with "next stamp completes the card", points bar + "Redeemed N times", discount %, BxGy progress + "earns free item", event purchases, tier ladder with current tier) and "Other Campaigns" summary (1093-1217).
9. Submit transaction — computes award: stamps = Σ item qty; points = round(points_per_unit × total); other types label only; saves to localStorage then POST /loyalty/transactions fire-and-forget; remembers client and items locally; shows receipt modal (1221-1279).
10. Receipt modal + Print receipt — where: after submit; "🖨 Print" opens print popup (monospace receipt) (1282-1356).
11. Clients tab — where: tab "👥 Clients"; card grid, search by name/ID, campaign badges, transaction count (1400-1468).
12. Client detail — where: click client card → overlay with full history table; "🖨 Print History" (print popup table) (1470-1507, 1358-1397).
13. Remove Client — where: "🗑 Remove Client" in client detail, `window.confirm`; deletes client and all their transactions locally then DELETE /loyalty/clients/:id fire-and-forget (1508-1521). Server: admin only, also deletes transactions (W:17247-17268).
14. Initial sync — automatic on render: render dashboard from localStorage, then `Promise.all` GET /loyalty/campaigns, /clients, /items, /transactions and re-render the active tab (1574-1589). No polling.
15. Item dictionary — automatic: every added item description is remembered locally (max 300) (151-160); server also bumps `use_count` per item on transaction create (W:17409+).
Keyboard: autocomplete ArrowUp/Down/Enter/Escape; Enter in item input = Add. No other shortcuts. Exports: none (prints only).

**Data & state.**
- Endpoints: `/loyalty/campaigns` (GET, POST upsert, PUT /:id, DELETE /:id), `/loyalty/clients` (GET, DELETE /:id_card), `/loyalty/items` (GET), `/loyalty/transactions` (GET LIMIT 500 newest, POST). Tables `loyalty_campaigns`, `loyalty_clients` (UNIQUE org,location,id_card), `loyalty_items`, `loyalty_transactions`; all org + location scoped.
- localStorage (write-through cache and offline fallback): `eikon_loyalty_campaigns`, `eikon_loyalty_clients`, `eikon_loyalty_items`, `eikon_loyalty_txns` (76-93). Every read in the UI is from localStorage; cloud responses overwrite it.
- Person identity: `id_card` normalised by `normMtId` (upper-case, numeric part zero-padded to 7, trailing letter kept) (59-70) is the primary key; name is free text and updated on each transaction. Clients are created implicitly by the first transaction. No link to Contacts/Appointments/Repeat Rx.
- Campaign status derived client-side: inactive → open (open_ended) → ended (end_date < today) → upcoming (start_date > today) → active (453-460).
- Points/stamp rules: stamps = total item quantity regardless of brand/items filter (1241); points = `Math.round(points_per_unit × total)` (1242); stamp progress = `Σstamps % target` (1144); points balance = Σpoints, "redeemed" = `floor(Σ/threshold)` (1159-1163); BxGy progress = transaction count % buy_qty (1170); tiers = Σ`total` for that campaign (1180). There is **no redemption transaction**: rewards are never recorded as given, nothing is deducted.
- Notifications: none of any kind. Prints: receipt, client history.
- Cross-module: none.

**Permissions & scoping.**
- Per org + per location (campaigns are not shared across branches).
- Client-side-only: "Remove Client" is offered to everyone and applied locally immediately; the server requires `admin` (W:17248) so for `staff` the client reappears on the next sync while the toast said "Client removed".
- Campaign create/edit/delete/toggle allowed to staff server-side (W:17040).

**Edge cases & risks (found in code, cite line numbers).**
- **Write-local-then-fire-and-forget on every mutation** (702-706, 578-582, 595-596, 1270-1274, 1519-1520): the user is told "recorded/created/deleted" before the request is sent; a failure is only `err()`-logged. The next successful GET overwrites localStorage with the server copy, so an unsynced transaction, campaign or deletion **silently vanishes** (apiLoad* at 100-139 replace the cache wholesale). Stamps/points awarded offline are lost without trace.
- **Balances computed from a 500-row window.** `/loyalty/transactions` returns the newest 500 for the location (W:17349-17353); the UI sums stamps/points over whatever is cached (1097-1121). Once a branch exceeds 500 transactions, long-standing clients' older stamps/points drop out and their cards reset silently — a money/goodwill error that is invisible in the UI.
- **No redemption model**: completing a card or threshold is only inferred; staff cannot mark "reward given", cannot prevent double redemption, and a client can keep being told "next stamp completes the card" after already collecting (1154).
- **Stamps ignore campaign scope** (1241): items/brand fields on a campaign are informational; any item earns a stamp per unit.
- **Snapshot and campaigns read stale localStorage** when the API fails (100-139 return the local copy with only a `warn`), with no banner that data is offline.
- Delete uses `window.confirm` (589, 1509) — fine for intent, but client delete cascades to **all transactions** with no export first; server does the same (W:17260).
- Transaction `id` from `uid()` (1249) is ignored by the server (autoincrement), so local and server rows can never be reconciled; a retry POST would create a duplicate.
- Campaign `created_at` is overwritten on every edit (879).
- Concurrency: two PCs editing the same campaign overwrite each other (full-object POST/PUT); two PCs recording for the same client are fine (append-only) but each PC's cached balance is stale until re-open (no polling).
- Date: `todayYmd()` local (39-42) for campaign status and `date` field; server `created_at` UTC. `campaignStatus` treats `end_date < today` as ended — an event ending today is still active until midnight local, correct.
- Overlay click handler added on every modal open (689) — listener accumulation; `campModal` reused.
- `renderCampList` toggle calls `renderCampaigns(parentPanel)` then reads `all[idx]` for the toast (574-575) — harmless; `attachCampListeners` (601) duplicates logic.
- Client "Remove" deletes by raw `idCard` key; worker normalises again (W:17254) — consistent.

**Speed notes.**
- 4 parallel GETs on open; transactions payload up to 500 rows with embedded item arrays (~100–200 KB). All tab renders are synchronous string builds from localStorage — fast. No polling. Snapshot re-renders on every blur/campaign change (cheap). Client list builds a txn-by-client map on each search keystroke (1434-1438) — O(n) per keystroke, fine at 500.

**Must not be lost.**
- Six campaign types with their parameters (stamp target/reward, points per € + threshold, discount %, event window, buy X get Y, spend tiers) and active/open-ended/date-window semantics.
- Transaction ledger per client per campaign with receipt number, items, total, award, notes, timestamp; receipt print and client history print.
- Maltese ID-card normalisation as the customer key, and ID/name autocomplete at the till.
- Live "progress to reward" view while recording (stamp grid, points bar, tier ladder).
- Item-description dictionary for fast entry.

---

## Repeat Prescriptions  (`modules.repeatprescriptions.js`, id `repeatprescriptions`, order 80, visible to: pharmacy sidebar + superuser (Inspections category); server: admin+staff)
**Purpose.** Legal register of repeat-prescription entries (client, medicine, posology, prescriber, entry and expiry dates) for the previous and current calendar year, with expired rows highlighted.

**Functions.**
1. Entries table — automatic on render: GET /repeat-prescriptions/entries?from=<prevYear>-01-01&to=<thisYear>-12-31; columns Date, Expires, Client (+ID), Medicine & Dose, Posology, Prescriber, Reg No, Actions; sorted entry_date desc then id desc; expired rows (expires < today) red (492-529, 609-640).
2. Period display — read-only "Period" field showing the fixed two-year window (549-551); not changeable.
3. Search (any column) — client-side substring over all fields incl. dates (644-647, 86-104).
4. New entry — where: "New"; modal: Date (today), Expires (auto = date + 6 months, clamped to month end; re-derived when Date changes until Expires is touched), Client Name & Surname, Client ID, Medicine Name & Dose, Posology, Prescriber Name, Prescriber Reg No — all required, length-capped; API: POST /repeat-prescriptions/entries (242-317, 649-655).
5. Edit entry — where: row "Edit"; same modal; API: PUT /repeat-prescriptions/entries/:id.
6. Delete entry — where: row "Delete"; confirm modal showing date/expiry/client/medicine; API: DELETE /repeat-prescriptions/entries/:id (hard delete, server audited) (319-347).
7. Print — where: "Print"; opens popup with the **currently filtered** rows, header block with row count, range, search text and print timestamp; no auto-print call (349-416, 657-664).
8. Refresh — where: "Refresh" button; re-runs the GET (666).
Keyboard: none. Exports: none. Polling: none.

**Data & state.**
- Endpoint `/repeat-prescriptions/entries` (GET range or legacy month, POST, PUT /:id, DELETE /:id); table `repeat_prescription_entries` (org + location scoped; W:6371-6390). Server defaults `expires_date` to +6 months when missing (W:6504) and audits create/update/delete.
- In-memory `state` (entries, filtered, query); no localStorage, no cache, no offline.
- Person identity: `client_name` + `client_id` free text (required, ≤200/≤100 chars); **not normalised** (unlike Loyalty's `normMtId`), so "123456M" and "0123456M" are different people. No link to Contacts.
- Statuses: none stored; "expired" is derived (`expires_date < today`, strict) at render (68-73).
- Notifications/prints: print only.

**Permissions & scoping.**
- Per org + location. No admin-only parts; delete is open to `staff` (W:6619).

**Edge cases & risks (found in code, cite line numbers).**
- **Window boundary (regulatory):** `twoYearWindow()` is `[Jan 1 of last year, Dec 31 of this year]` from the PC's local year (75-80). On 1 January the oldest year drops out of view with no way to look further back, and entries dated in a future year (typo in Date) are silently excluded from the list after save. Inspectors needing a 2-year look-back on 2 Jan see ~1 year.
- **Expiry silently recomputed on edit** (298-316): when editing an existing record, changing Date re-derives Expires unless the user has typed in Expires during this modal session — a legally recorded expiry can move without the user noticing.
- **Hard delete of a legal register row** with a confirm modal (319-347); no soft delete, no reason, no UI view of the server audit log.
- Date arithmetic is UTC-based and clamps to month end (48-66) — correct for 31 Aug → 28/29 Feb; "today" is local clock (32-35); entries typed as a date that is tomorrow in UTC are accepted.
- Whole-table reload after every save/delete (289, 339) and no optimistic update — fine for correctness, but a slow link freezes the count at "Loading…" (611) and a failed reload shows a modal error and "Failed to load" while the old rows stay on screen (635-639).
- Concurrency: last-write-wins on PUT (full record); no version check; PC B does not see PC A's additions until it presses Refresh or saves.
- Payload: two full calendar years unpaginated (613); large pharmacies will carry thousands of rows per load; search is in-memory substring per keystroke over all rows (492-503).
- Silent catch: wiring of the date→expires listener is in a bare try/catch (315); failure means no auto-expiry but the manual field still works.
- No validation that Expires ≥ Date, and no prescriber reg-no format check.
- The module throws if its own DOM is incomplete (606) — hard failure visible to the user.

**Speed notes.**
- One GET per render/refresh; payload = all entries in the two-year window (×8 text fields). Render rebuilds the whole tbody on each keystroke; acceptable to a few thousand rows.

**Must not be lost.**
- Mandatory fields exactly as the register requires: entry date, expiry, client name + ID, medicine & dose, posology, prescriber name, prescriber registration number.
- Default 6-month expiry with end-of-month clamping, and expired rows kept visible and highlighted (never auto-hidden).
- Two-year look-back (previous + current year) as the minimum, printable with range, filter and print timestamp.
- Search across every column; delete requires confirmation and is audited server-side.

---

## Contacts  (`modules.contacts.js`, id `contacts`, order 2, visible to: pharmacy sidebar + superuser (Reference category); server: admin+staff)
**Purpose.** Reference directory: static emergency numbers and 24/7 clinics, plus editable contact tables (suppliers, med reps, head office, organisation pharmacies, POYC, locums, doctors, specialists) shared across the organisation, and a location-specific Client Contacts table that also aggregates client names from other modules.

**Functions.**
1. Shared-data banner — automatic: warning that editable tables are organisation-wide (515-522).
2. Global search — where: top search box (≥2 chars, 200 ms debounce); searches emergency numbers, clinics and every loaded table; highlights matches; caps 15 hits per table (546-641).
3. Emergency & Important Numbers — static cards (112, 196, Police HQ, CPD, 1400, Mater Dei, Gozo General) (284-292, 646-661).
4. 24/7 Public Health Clinics — static cards (Floriana, Mosta, Paola, Primary HealthCare Call Centre) (294-315, 666-678).
5. Nine editable tables in this order: Client Contacts (location-specific; name, ID, address, phone, alt phone), Suppliers (name, phone, email), Medical Reps (name, phone, email), Doctors (name, personal number [flagged "DO NOT GIVE TO PATIENTS"], patient-safe number), Specialists (name, specialty from a 65-item list, personal, patient-safe; + specialty filter dropdown), Locums, Head Office (hideable), Organisation Pharmacies (hideable), POYC (320-426, 683-690).
6. Per-table search (120 ms debounce) with "n of m" / "m total" counter (773-780, 846).
7. Specialty filter — where: dropdown above Specialists (741-750, 783-788).
8. Hide section toggle — where: checkbox on Head Office / Org Pharmacies; persisted per browser in localStorage `contacts_hide_headoffice`, `contacts_hide_orgpharmacies` (699-703, 763-770).
9. Add contact — where: "+ Add" per table → modal with one input per column (specialty = select); at least one field required; shared tables ask a second "Shared Data" confirm; API: POST /contacts/<table> (939-978).
10. Edit contact — where: row "Edit" → modal; shared confirm; API: POST /contacts/<table> with `id` (server updates) (981-1013).
11. Delete contact — where: row "Del"; shared tables confirm, **Client Contacts delete has no confirmation**; API: DELETE /contacts/<table>/:id (1016-1031).
12. Export — where: "📤 Export" per table → modal with Google-Contacts-format CSV in a textarea, "Copy to clipboard", "Download CSV" (`<table>_contacts_export.csv`) (1034-1124).
13. Import — where: "📥 Import" per table → paste CSV (header row skipped, columns positional); shared confirm with row count; API: POST /contacts/<table>/bulk (append only, server max 500) (1127-1174).
14. Email links — automatic: email cells rendered as `mailto:` (883-884).
15. Initial load — automatic: 9 parallel GET /contacts/<table>; Client Contacts additionally GET /contacts/clients/aggregated (names pulled server-side from client orders, tickets, deliveries, DDA sales, POCT patients for this location, de-duped by name|id_card) merged after manual rows (1177-1217).
Keyboard: none. Polling: none. Prints: none (CSV export only).

**Data & state.**
- Endpoints: `/contacts/{suppliers|medreps|headoffice|orgpharmacies|poyc|locums|doctors|specialists|clients}` GET/POST, `/:id` DELETE, `/bulk` POST; `/contacts/clients/aggregated` GET. Tables `contacts_<key>`; all org-scoped, `contacts_clients` also location-scoped (W:18517-18527, W:18585-18591). Writes audited server-side.
- Per-table in-memory `rows` array; no cache; localStorage only for the two hide flags.
- Person identity (Client Contacts): name, id_card (free text, not normalised), address, phone, alt_phone; aggregated rows carry `_aggregated=true` and no `id`. The aggregated feed does **not** include Appointments, Loyalty or Repeat Prescriptions people.
- Statuses: none. Notifications: none (mailto links only).
- Cross-module: read-only pull via the aggregated endpoint (W:16683-16725) from `client_orders_entries`, `client_tickets_entries`, `client_deliveries`, `dda_sales_entries`, `poct_patients`.

**Permissions & scoping.**
- Shared tables are organisation-wide for every location's admin and staff; the only guard is the "Shared Data — are you sure" modal (80-87) — a client-side speed bump, not a permission.
- Client Contacts is per location. `user` is passed to `render` but never used for gating (504, 687).
- No admin-only parts server-side (W:18575, W:18596, W:18646, W:18669).

**Edge cases & risks (found in code, cite line numbers).**
- **Client Contacts delete has no confirmation** (1016-1020: confirm only when `!def.locationSpecific`) — one click removes a client record.
- **Edit mutates the row before the save succeeds** (997-1000) and Add closes the modal before awaiting (964-968): on failure the table shows values the server does not have (edit) or the typed data is gone (add); only a toast reports it.
- **Ghost rows**: when a save returns no id the row gets `tmp-…` (968, 1161-1163) and Delete then skips the API (1022) — the row exists on the server but can only be removed after reload.
- **Aggregated rows look editable** (877-911): they have no `id`, so "Edit → Save" INSERTs a new manual row (W:18629-18641) and "Del" only hides it locally until reload; no visual distinction from manual rows.
- **Import duplicates**: bulk import is append-only with no de-duplication (1134, W:18668-18697) and inserts row-by-row without a transaction — a re-paste doubles the table; a mid-way failure leaves a partial import with the UI showing none of it. >500 rows is rejected only after the shared-data confirm.
- **CSV parsing**: header row is skipped without validating it; columns are positional (136-150); quoted fields containing newlines break because lines are split first (137). Export of personal numbers labelled "DO NOT GIVE TO PATIENTS" in the UI (886-887) goes out as plain "Mobile" with no flag (1060) — a privacy leak if the CSV is shared.
- **Two-PC concurrency on shared tables**: last write wins, no version check, and the table is never re-fetched after a save (1004-1005), so PC B keeps showing stale rows until a full reload; a delete on PC A and an edit on PC B produce a 404 toast on B.
- Index capture: `realIdx` is captured per render (878, 903-906) and `rows.splice(idx,1)` (1025) relies on no concurrent mutation; a failed delete followed by a successful one on another row could splice the wrong index only if renders were skipped — currently every path re-renders, so low risk.
- Aggregated endpoint runs five unbounded table scans on every Contacts open (W:16703-16722) with errors swallowed (`catch(e){}`) — silent partial lists and growing latency.
- Silent catches: localStorage reads/writes (702, 767); aggregated fetch failure returns `{rows:[]}` without telling the user (1182); per-table load failure only `E.warn`s and shows "No contacts yet" (1211-1216) — indistinguishable from an empty table.
- `highlightMatch` builds HTML with `esc` on the pieces (538-544) — safe; `noMsg` uses `esc(searchQuery)` (850) — safe.
- Hide flags are per browser, not per user/location — a shared till PC hides Head Office for everyone using it.

**Speed notes.**
- 10 parallel requests on open (9 tables + aggregated). Shared tables are small; Client Contacts = manual rows + every distinct client name across five modules for the location (can be thousands) rendered into a 5-row-high scroll box. Global search iterates every table on each debounced keystroke; per-table search re-renders that table's DOM. No pagination anywhere.

**Must not be lost.**
- Static emergency and 24/7 clinic numbers (112, 196, 1400, Mater Dei, Gozo General, Floriana/Mosta/Paola health centres, Primary HealthCare 2123 1231).
- The personal-vs-patient-safe number split for doctors and specialists with the "DO NOT GIVE TO PATIENTS" flag.
- Specialist specialty taxonomy and filter.
- Organisation-wide sharing of supplier/rep/head-office/pharmacy/POYC/locum/doctor/specialist contacts, with a warning before edits.
- Location-specific client directory that surfaces clients already known from orders, tickets, deliveries, DDA sales and POCT.
- CSV import/export (Google Contacts format) and global cross-table search.

---

## Cross-module notes for the merged "Customers" area

**How a person is identified today (no shared key, no linking).**
| Module | Fields | Normalised? | Required | Links to Contacts |
|---|---|---|---|---|
| Appointments (appt + waitlist) | patientName, patientIdCard, patientPhone, patientEmail | No (server upper-cases ID only for public lookup) | name | No |
| Loyalty | id_card (PK per org+location), name | Yes: upper + 7-digit zero-pad (`normMtId`, loyalty.js:59) | id_card | No |
| Repeat Rx | client_name, client_id | No | both | No |
| Contacts › Client Contacts | name, id_card, address, phone, alt_phone (+ aggregated from 5 other modules, not these three) | No | any one field | n/a |

A single customer therefore exists as up to four unrelated free-text records; only Loyalty has a stable key and only Contacts has an address. The Contacts aggregated feed should be extended (or replaced by a real `customers` table) to include appointments, waitlist, loyalty clients and repeat-prescription clients, keyed on a normalised ID card with name/phone fallback.

**Statuses and transitions to preserve.** Appointment: Scheduled / Confirmed / Completed / Cancelled(+reason) / No Show, plus independent Booking-Confirmed flag. Waitlist: Waiting / Promoted / Cancelled with priority Urgent / Flexible / Fixed. Loyalty campaign: active / open-ended / upcoming / ended / inactive (derived). Repeat Rx: expired (derived, strict `<` today). Contacts: none.

**Notifications.** There are **no automatic notifications** (no SMS, no WhatsApp API, no email sending) in any of the four modules. All outreach is a user-initiated `wa.me` / `whatsapp://` open (phone only, no text) or a `mailto:` draft (appointment booking confirmation, appointment reminder, blank). Nothing is logged as sent.

**Double-booking with two PCs.** Client recheck at submit + server overlap check (409). Gaps: no DB uniqueness so simultaneous POSTs can both pass; server ignores `Cancelled` rows because of a case mismatch (cannot rebook a cancelled slot); Month/Week/List rely on a 500-row cap so PC B's calendar can omit PC A's bookings in large datasets.

**Auto-refresh intervals.** Appointments 30 s full re-sync (never stopped) + 5 s label timer (leaks); Loyalty, Repeat Rx, Contacts: none (manual Refresh in Repeat Rx only).

**Waiting-list logic.** Manual add; auto-add when a session fills between opening and submitting; FULL badge per column; manual promote (status only, no back-reference); no auto-notify on cancellation.

**Campaign/points rules.** See Loyalty › Data & state; key gaps: stamps ignore campaign item scope, no redemption record, balances computed from the newest 500 transactions only.

**Prints/exports.** Appointments: month/week/day/list/single/waitlist prints (with € totals). Loyalty: receipt and client-history prints. Repeat Rx: filtered register print with range + search + timestamp. Contacts: Google-Contacts CSV export (download/copy) and CSV import. No xlsx/PDF anywhere.
