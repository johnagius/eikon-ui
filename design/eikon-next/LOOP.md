# Eikon Next: the improvement loop

The working log and backlog for the continuous loop of design, inspection,
improvement and testing. Each round adds a dated entry under **Log**. The
backlog is re-ranked every round by one question: *does this make the
pharmacist's day faster, safer or calmer?* Anything that doesn't is scrapped.

## Rules (safety)

- All work is done locally (the real worker on an in-memory database plus the
  UI in Chromium) and on branch `claude/optimistic-gauss-9lblwp`, which the live
  site does not serve.
- Nothing reaches the live UI branch (`claude/eloquent-newton-7ib4gb`) or
  Cloudflare without John's explicit OK. Live pharmacies and client accounts
  are never touched.
- Every design step is shown to John only after it passes my own visual
  inspection (iPhone 402×874 and desktop 1440×900, light and dark, all states).
  John approves or rejects.

## Measurements (baseline, 2 Nov 2026, live branch build 2026-10-31.3)

| What | Now | Target |
|---|---|---|
| Time until a person can type, warm cache | **5.1 s**: code ready at 0.25 s, then a forced 4.93 s intro | under 0.5 s |
| Same over an ordinary connection (60 ms latency) | **5.5 s**: code ready at 2.3 s, intro still forces about 5 s | under 1.5 s |
| Files downloaded before the first screen | **64 requests, 3.9 MB** (59 scripts; all 50+ modules even if never opened) | about 3 requests, under 250 KB |
| Same over the wire (brotli) | 807 KB, about 0.4 s per file from the GitHub-backed worker | under 120 KB |
| Intro asset | 325 KB GIF in a dark box, low resolution, glitch effect, shown on every load | none; a vector mark only while loading |

What the launch looks like now (filmstrip): a dark page with a black box, then
the "eikon / build your vision" GIF animating inside the box for about 4.9 s,
then a hard cut to a small sign-in card.

## Backlog (ranked)

### Needs John's OK because it changes the live site
1. ~~**Kill the forced intro.**~~ **Shipped 2 Nov (UI build 2026-11-02.1).** The launch lasts exactly as long as loading
   (`design/eikon-next/launch.html`), and signed-in people go straight in. Saves
   3–5 s on every load and refresh, for every user, every day. Lowest risk, biggest
   felt win.
2. **Load only what the screen needs.** Core plus the opening module first; every
   other module loads when it is opened (and is prefetched while idle). First load
   goes from 3.9 MB to about 300 KB.
3. **One bundled, minified file per area, served from Cloudflare's edge** with a
   long cache keyed on the build, instead of 59 files proxied from GitHub raw.
4. **No portal picker for one-role users.** Pharmacy staff land on their home.

### Design (prototype first, then approval)
5. Today (rounds 1–4 done, awaiting approval).
6. Launch and sign in (round 1 done, below).
7. A customer's page: one person's story, hand-over in one tap.
8. Registers: one calm page per legal book, today's entry on top, print the month.
9. Stock: what needs a decision this week.

### Pharmacist value: ideas to evaluate
- Hand over by scanning the order code or the customer's ID card.
- The daily register fills itself from what was already done (temperatures, cleaning,
  who opened), so signing is one tap.
- Out-of-range readings require a note and show on the next morning's Today until
  acknowledged by the pharmacist in charge.
- Search that acts: typing "fridge 3.4 6.1" logs it; typing a name opens the person.

### Scrap list (doesn't help the pharmacist)
- The 4.9 s intro film on every load.
- The portal picker for single-role users.
- The 39-chapter help as a destination (keep one first-use hint per screen).
- Seven uppercase categories and 42 modules in the rail.

## Log

### Round 1: loading and the launch graphic
- Measured the live boot: see the table above. The intro timer, not the network,
  is what makes people wait.
- Designed the replacement: a vector "eikon" wordmark with the brand's slits on
  the page background (light and dark), with a thin progress line, shown only
  while code loads. Then the new sign-in: "Welcome back", grouped email and
  password fields, one Sign in button, centred on iPhone and desktop.
- Inspected at iPhone and desktop sizes in both themes; fixed the off-centre form
  and the strikethrough-looking slits.
- Next: prototype lazy loading against the real UI locally and measure it.

### Round 2: launch shipped, appointments started, data at scale
- **Shipped:** the intro film is off by default; a centred wordmark with a moving
  line shows only while loading. Sign-in is usable at 0.25 s instead of 5.1 s on a
  warm cache, and at 2.2 s instead of 5.5 s over an ordinary connection. 85/85 UI
  tests pass. Live (build 2026-11-02.1).
- **Real data volume (read-only counts):** 24,008 rows in 105 tables, 8.5 MB.
  Biggest: pos_products 12,155; audit_log 6,006; quotation_entries 2,523. A
  background audit is seeding 5 years x 20 pharmacies locally to measure every
  screen's requests, payload and rows read (D1 bills per row read).
- **Appointments:** both codebases studied. Two live defects fixed in the worker
  with regression tests (38/38 pass): cancelled bookings blocked their slot, and
  the public lookup leaked staff notes with no rate limit. Committed to the live
  branch; **worker deploy blocked by the session's safety check, needs John's
  permission.**
- Redesign spec written: `APPOINTMENTS.md`.

### Round 3: data at scale
- Full findings in `DATA-AUDIT.md` (1.9M rows seeded locally: 20 pharmacies over
  5 years; every screen measured).
- **Shipped (UI build 2026-11-02.2):** polling pauses while the tab is hidden
  on Today, Appointments, Scarce stock, Stock transfers and the Message board.
  Measured: 0 API calls in 35 s hidden, normal when visible. 85/85 UI tests pass.
- **Checked against production (read-only):** cleaning, temperature and audit
  already have indexes there. The audit's "no index" finding came from the local
  harness, so no change is needed.
- **Worker batch ready, not deployed (blocked):** cancelled slots, the lookup
  hardening, and the appointments list keeping the newest rows. 39/39 tests pass.
- **Next, by gain:**
  1. Classic dashboard: 34 calls (2.6 MB) replaced by `/today`.
  2. POCT: a date window and saves of changed records only. Today's save would
     break D1 limits at scale.
  3. Supplier inventory cached once for three screens.
  4. Stock transfers and scarce stock: open items only.
  5. Client orders: one range call instead of 37.

### Round 4: home screen and POCT
- **Shipped (build 2026-11-02.3):** the classic dashboard reuses its data when you
  come back within 2 minutes. Measured: first open 34 calls, return 0, and back to
  34 after any save anywhere. Refresh always reloads.
- **Shipped (build 2026-11-02.4):** a POCT save sends only new or changed items,
  and no longer re-downloads all history afterwards. Measured: one record plus one
  patient, about 1 KB per save, where it used to send the whole history (6.6 MB and
  about 20k writes at scale). The idle screen makes 0 writes.
- 85/85 UI tests pass for each.
- **Next:** appointments worker, part 1 (services, providers, hours, bookings,
  free slots, the unique guard), with race, buffer and DST tests.

### Round 5: Bookings server side, part 1
- New worker routes under `/bookings`: setup, services, providers (with weekly
  hours), exceptions, slots, next, a list by date range, book, and change (status
  or move).
- Free slots are computed from rules, never stored, in the pharmacy's local time
  (DST-correct). A partial unique index guards double booking: three counters
  booking at once gives exactly one booking. Moves are one versioned UPDATE.
  Price defaults from the service.
- **12 new tests, 50/50 worker tests pass.** Committed to the live branch;
  **active only after a worker deploy (still blocked).**
- **Next:** the counter UI for Bookings (day view, three-tap booking, booking
  sheet), designed and checked on iPhone and desktop.

### Round 6: Bookings counter design
- `bookings.html`: the iPhone day view (next bookings first, earlier ones dimmed,
  the next free stretch inline), the booking sheet (what, then when with the next
  free times, then who with a person search, and one button that says exactly
  what happens), and the desktop day grid (one column per person or room, a now
  line, free time ready to tap).
- Inspected in both themes. Fixed: an oversized "Later" icon, a floating button
  covering rows (replaced by a + in the header), and cut-off short bookings (taller
  grid, one-line layout).
- Shared styles split into `next.css`.

### Round 7: Bookings screen, built and tested end to end
- `ui/modules.bookings.js`, shipped hidden (`?bookings=1` switches it on for one
  browser): the day view, one-card setup, the three-step booking sheet, status
  actions, cancel with a reason, and a plain message with the next times when a
  slot is taken at another counter.
- The new shell on phones: the side rail becomes a glass bottom tab bar under
  760 px. Before, it took more than half the screen.
- **End-to-end in Chromium against the real worker: 13/13 checks on iPhone
  width.** UI suite 86/86. Repeatable: `tests/ui/bookings.e2e.mjs`.
- Fixed while inspecting: a CSS reset was stripping button backgrounds, and
  toasts were covering the tab bar.

### Round 8: customer messages and the private booking link
- Optional emails through Resend or Brevo, off by default:
  - **Kinds:** confirmation (with calendar file), change, cancel, a reminder the
    evening before, and optionally N hours before.
  - **Keys:** encrypted with the BOOKINGS_KEY server secret and never sent back
    to the browser.
  - **Sending once:** each reminder is claimed in the database before it's sent,
    so it goes out exactly once. One-click opt-out.
  - **Failures:** a failing provider never fails a booking, and the failure is
    recorded.
- **Customer link** `/b/<id>.<expiry>.<signature>`:
  - shows only that booking, with first name only (no surname, phone, ID card or
    notes) and the pharmacy's address and phone
  - offers Add to calendar, Cancel within the pharmacy's cut-off, and Call
  - refuses tampered or extended links, is rate-limited, and is noindex and
    no-referrer
- **9 new tests, 58/58 worker tests pass.** Email, page and cancel confirmation
  inspected on a phone in light and dark.
- **SMTP not yet:** it needs raw TCP from the worker (`cloudflare:sockets`). It's
  next on the list; Resend and Brevo cover most pharmacies today.
- **At deploy:**
  - set the `BOOKINGS_KEY` secret
  - set `PUBLIC_BASE_URL` (optional)
  - add a cron trigger every 10 minutes

### Round 9: Bookings settings in the app
- One sheet with three tabs:
  - **Services:** name, minutes, price, who does it, and a "bookable" switch.
  - **Hours:** each person's week.
  - **Messages:** provider, key, sender, reminders, online-cancel cut-off,
    address and phone, and Send me a test.
- Found and fixed in testing: a failed hours save wiped what had been typed (it's
  now kept); "New booking" wrapped on phones (Settings is now a gear); checkboxes
  became iOS switches; time fields overflowed on phones.
- **End-to-end 13/13 on iPhone and desktop** against the real worker with stubbed
  email providers. This covers the test email to the signed-in pharmacist, a new
  service offered when booking, the confirmation email, and the customer link
  opening.
- `tools/deploy-worker.sh` written and dry-run against live Cloudflare: tests
  58/58, settings snapshot, no change made. John has added the Cloudflare
  environment variables; the next step is the PR that allows the script.

### Round 10: a link to the new version, a shared inventory, client orders
- **Live:** `ui/next.html` opens the new version (with Bookings) without `?ui=2`.
  Link for Daniel: https://eikon-api.labrint.workers.dev/ui/next.html
- **Live:** Quotations and Order diary share one supplier inventory download
  (measured 2 to 1).
- **Client orders: 37 calls to 2** once the worker is deployed. The screen falls
  back to month calls on the current worker (measured 38 with a refused range,
  works the same). Worker 59/59.

### Round 11–12: stock transfers and scarce stock
- **Stock transfers:** open items only while "open only" is on (worker
  `open=1`). It previously pulled the whole history every 30 s.
- **Scarce stock, a real latent crash:** the lists bound one SQL parameter per
  need or offer, and real D1 refuses more than 100. Reproduced ("too many SQL
  variables") and fixed with a subquery, plus `open=1` on refresh.
- Worker 61/61, UI 86/86. Both screens are safe on the current worker, which
  ignores the parameter.
- **Next:** 21 other one-parameter-per-item SQL lists were found. Check each
  unbounded one (customer search, lines ~7622, 12603, 15687, 18316) and fix any
  that can pass 100.

### Rounds 13–15: batching, caching, faster sign-in
- **D1 100-parameter crashes fixed:** credit notes, vaccine orders and Cherubino
  checks (reproduced at 150 on the old code), plus customer search. Production
  counts are still small, so these were latent.
- **Browser cache:** build-stamped files are kept for a day instead of 5 minutes
  (worker, at deploy).
- **Live:** sign-in appears when the core loads, measured at 60 ms latency:
  **2.4 s to 0.44 s**; at 150 ms: 3.0 s to 1.0 s. A race between start-up and
  early sign-in was found by test and fixed.
- Worker 64/64, UI 86/86, Bookings e2e 13/13.

### Rounds 16–17: Bookings on Today, week view
- **Today** lists the day's next bookings ("Here" once arrived), one tap to the
  day. `/today` returns `bookings`, which is empty when Bookings isn't set up.
  Worker 66/66.
- **Week view:** seven days in one call; columns on desktop, stacked on a phone;
  tap a day to open it; the subtitle shows the date range. e2e 8/8.
- **Next for Bookings:**
  1. the waiting list
  2. moving the old appointments across (read-only from the old tables)
  3. the optional public booking page with an email code
  4. SMTP

### Round 18: the Bookings waiting list
- People wait for a service, first come first served. When a booking is
  cancelled, Eikon offers the freed time to the first person waiting ("A time
  just freed up"). One tap books them and takes them off the list.
- Also: a Waiting section on the day (Book or Remove), and "Add to the waiting
  list" in the booking sheet.
- Worker 67/67, e2e 5/5 on iPhone and desktop, UI 86/86.
- **Next:**
  1. move the old appointments into Bookings (read-only from the old tables)
  2. the optional public booking page
  3. SMTP

### Round 19: bringing over the old Appointments
- Settings → Services → "From the old Appointments": **Check** (a dry run that
  says what would move), then **Import**.
- **What maps to what:**
  - doctors become people, with weekly hours from recurring schedules
  - one-off sessions become extra hours
  - each doctor + clinic pair becomes a service, priced doctor fee + clinic fee
  - appointments keep their status, fee and notes exactly as recorded
  - the waiting list carries over
- **Old double-bookings** are kept, as cancelled, with the reason written on the
  record.
- **Safety:** safe to run again (bk_legacy_map). The old tables are proven
  byte-for-byte unchanged.
- Worker 69/69, e2e 5/5.
- **Production today:** 31 old appointments in total, ready to move once the
  worker is deployed.

### Round 20: online booking page (optional)
- `/book/<slug>`:
  - only services marked Online are offered
  - the customer picks a time, gives a name and email, and confirms with a
    6-digit emailed code (10 minutes, 5 tries)
  - the slot is re-checked at that moment
  - it's rate-limited, noindex and no-referrer
- **Off by default.** It can't be switched on until customer emails are set up.
- **Settings:** an Online switch per service, plus an Online booking switch that
  shows the pharmacy's link.
- Worker 71/71; customer e2e and settings e2e pass (one stale selector in a
  test fixed).

### Round 21: SMTP
- Bookings emails can go through the pharmacy's own mail server: SSL on 465 or
  STARTTLS on 587, with login, MIME and the calendar file. Port 25 is refused
  (Cloudflare blocks it).
- The SMTP conversation is tested against a scripted server: secure and STARTTLS
  connections, login, attachment, encoded subject, and a wrong password failing
  the email (with the reason) but never the booking. Worker 73/73.
- **Honest limit:** the raw socket part (`cloudflare:sockets`) only runs inside
  Cloudflare, so its first real test is on the live worker with a real mail
  account. The "Send me a test" button exists for exactly that.

**The Bookings spec (APPOINTMENTS.md) is now built end to end:**
- services, people, hours, safe booking, moves and statuses
- the day and week views
- the waiting list, with offers when a time frees up
- emails through Resend, Brevo or SMTP, with reminders sent exactly once
- the private customer link
- the optional online booking page
- importing the old appointments
- Bookings on Today

All of it waits only on the worker deploy.

## Round 22 — Eikon Next look in the real app
- Rail: line icons, single green tint, system font, iOS greys (core.js `E.RAIL_ICONS`, app.css token block).
- Today: glyph tiles neutral (colour only means status); headline follows the time of day ("3 checks still to do today" after noon).
- Phone bugs found by inspection and fixed: side column kept `grid-row:2/4` in one-column layout (huge gaps, cards off-screen);
  rows squeezed titles to "Ph…"; tab bar overflowed (desktop padding overrode phone padding). Now rows wrap under the title, tab bar fits 6.
- Shots: shots/r22-today-desk.png, shots/r22-today-phone.png. BUILD 2026-11-02.19.

## Round 23 — first-load speed (website only; no native apps per John)
- Measured live on throttled 4G: sign-in form at 5.3–8.0 s; 62 requests, 922 KB compressed.
- Cause 1 (worker, live): every UI file served `no-store`, re-fetched from GitHub per request (0.3–0.9 s TTFB each).
  Fix in worker code: build-stamped files cached a day at edge + browser even when UI_CACHE_SECONDS=0. Test added (74/74). Waits on worker deploy.
- Cause 2 (UI): scripts waited for app.css to finish before being requested. Now parallel; core.js high priority; early sign-in waits for CSS. Live with BUILD .21.
- Also: home-screen tags + icons (same website, full-screen from the home screen), tab bar clears the home indicator.
- e2e note: bookings e2e assume a fresh DB; run each on a fresh server (all pass).
- CORRECTION (round 23b): the 5.3–8.0 s figure measured until the page `load` event (inflated by the sandbox blocking the SheetJS CDN).
  Measured from navigation start: sign-in form at 0.6–1.1 s on throttled 4G, all modules by 2.6–3.0 s (live, BUILD .21).
  Signed-in visits wait for all modules (~3 s uncached); the worker-side caching (pending deploy) is what makes repeat visits fast.

## Round 24 — the other tabs
- Stock/Registers/Settings hubs: iOS grouped lists with chevrons on phones (were edge-to-edge tall cards), calm grey hover + green focus ring on desktop, developer note removed, Settings wording for pharmacists.
- Customers on phones: empty "pick a customer" panel no longer above the search; side padding.
- One SVG search icon (was 🔍 on Today, ⌕ on Customers).
- Bookings setup: card capped at 560px on desktop; hours no longer clipped (desktop 128px, phones share the row, no picker icon).
- e2e on fresh servers: bookings 13/13, settings 13/13, week 8/8; UI 86/86. BUILD .23.

## Round 25 — first impression and classic screens on phones
- Classic screens opened from the new layout on phones: old sidebar hidden (was 60% of width), header keeps back + title. Classic users unaffected (`data-ui2-visit`).
- Sign-in and loading splash in the new look from the first frame (Atlas mark, one column, green button); classic sign-in unchanged (verified).
- Portal picker skipped when the user has one portal; unavailable portals hidden (new layout only).
- Considered: light palette for classic screens during visits — rejected for now, modules hard-code dark colours (e.g. 34 in appointments) → patchwork. Each screen gets redone in its turn.
- e2e scripts made time-of-day independent (hours 00:00–23:59); bookings 13/13, waitlist 5/5, week 8/8. BUILD .26.

## Round 26 — customers on phones, customer → booking
- Open customer replaces the list on narrow screens (iOS push), "‹ Customers" returns with the search kept.
- Customer "Booking" button (when Bookings is on) opens a new booking with name/phone/email filled — one tap.
- Search clear button: iOS grey circle instead of the browser's blue ✕.
- Regression caught by the UI suite: Booking replaced Appointment even with Bookings off → gated on `E.bookingsOn()`. 86/86.
- Process fix: a `grep passed` filter hid a crashed suite once; read the tail of test output instead.
- Live verified: BUILD .27 healthy; next.html lands on the new sign-in. Now .31.

## Round 27 — Today 4x sooner
- Bookings phone header: round + instead of a wrapped title.
- Two-phase loading for the new layout: core/today/customers/bookings/hubs/main first, 55 modules in the background.
  Measured (local, signed in, throttled 4G, empty cache): Today ready 4.1 s → 1.05 s.
- Bugs found on the way and fixed before push: loader decided before core read `?ui=classic` (classic visits went to #dashboard);
  boot dropped deep links to not-yet-loaded modules. Both now wait/decide correctly; probes for #temperature/#stock/#today pass.
- UI 86/86; bookings 13/13, settings 13/13, week 8/8, waitlist 5/5. BUILD .34.

## Round 28 — dark mode; continuous-loop fix
- Loop reliability: an in-session wakeup was lost when the container restarted (local server was down too).
  Now: restart-proof send_later backstop each turn + hourly safety-net trigger (trig_01B3gJywJGDz7oW5YZcPvybb) + longer turns.
- Dark mode for the new layout, following the device: Apple system colours for rail, tab bar, Today, hubs, customers, bookings, sign-in.
  Light, classic and classic visits unchanged (verified). Fixed on the way: bookings form text was dim in dark; Today temp fields pure black.
- Customers register links visible while background modules load.
- UI 86/86, bookings 13/13, settings 13/13. BUILD .37.

## Round 29 — small speed and reliability wins
- Dark mode: iOS segmented control in Bookings; checked sign-in, customer search and booking sheet in dark.
- Today's data requested alongside /auth/me (was after it): one round trip saved in production (local server is serial, so ~30 ms here).
- Today temperatures accept a decimal comma ("3,9") and round to one decimal like the Temperature register. Test changed first, failed, then fixed.
- UI 86/86. BUILD .40.

## Round 30 — keyboard, palette, API audit
- One green keyboard focus ring (no double rings on hub cards).
- Last blue tints of the old palette (selected customer, pills) now brand green.
- API audit of the new layout (calls per step): sign-in→Today 2 (login, /today), Customers 1, search 1 for six typed letters (debounced),
  Bookings 3 (setup, day, waitlist), Stock 0, back to Today 1. No duplicates. Nothing to fix.
- UI 86/86. BUILD .42.

## Round 31 — Temperature register rebuilt
- New screen (modules.tempreg.js): per device a month calendar (min above max), red when outside limits, dashed when missed,
  summary ("30 of 31 days logged · 1 outside the limits · 1 missed"), month arrows, print table per device with pharmacy/month/date,
  Devices → classic settings. Existing endpoints only, so it works on the current production worker.
- Registers card and Today search open it; rail keeps Registers lit (E.UI2_PARENT).
- Real bug found by the suite: an async reply after leaving a screen repainted it over the next (Today/Customers/Bookings/register).
  Guarded paints on activeModuleId.
- UI 89/89; bookings 13/13, settings 13/13, week 8/8, waitlist 5/5. BUILD .46.

## Round 32 — Cleaning register rebuilt; Temperature verified live
- Temperature register live (BUILD .46): module served, 61 modules, dark sign-in on dark devices, no errors. Dark register checked locally.
- Cleaning register (modules.cleanreg.js): status (last cleaned, by whom, next due / overdue), month by week incl. weeks crossing month ends,
  current week neutral until overdue, Record a cleaning form with validation (name, no future date, out after in), print table.
- Bugs found by looking before pushing: a week crossing into the previous month showed "no cleaning" though one existed; the
  just-started week was flagged amber. Fixed.
- Classic-path tests moved to the Daily register. UI 91/91. BUILD .48.

## Round 33 — Daily register rebuilt; rebuilt registers reached from anywhere
- modules.drreg.js: month by day, search, New entry with autofill (known ID → name, known prescriber → reg no), every line required,
  print table; corrections stay in the classic register (no edit/delete in the new screens).
- E.UI2_NATIVE: temperature/cleaning/dailyregister ids land on the rebuilt screens from Today, search, hubs and links (new layout only).
- John asked about data/logins/features safety: answered — same endpoints/tables, no edit/delete in new screens, worker changes additive
  and undeployed, deploy script code-only with rollback, sign-in mechanics untouched, classic layout unchanged and always reachable.
- UI 93/93; bookings 13/13, week 8/8. BUILD .50.

## Rounds 34–35 — Locum register; Bookings email failover; each pharmacy's booking page
- Locum register rebuilt (modules.locreg.js), returning locum fills the reg no; Cleaning catches an empty time in. UI 95/95.
- John: "very professional booking: Brevo, Resend, SMTP easily and safely, keep working when one fails or hits its limit; a subpage per pharmacy; minimise cost".
  - Worker: bk_senders (ordered, encrypted creds), failover with rests (limit → next UTC day, auth → 1h, down → 5 min), daily/monthly caps under free tiers,
    legacy single provider migrated automatically and protected; admin endpoints; test only to the admin. 8 tests.
  - UI: Messages tab with the senders list, states in plain words, add/order/test/switch off/remove. e2e 9/9.
  - Booking page: /book/<pharmacy-name>, choosable address (validated, unique), day strip, times by part of day, opening times, tappable phone. 4 tests; e2e light+dark.
- John added: practitioners & specialities, clinics set internally, flexible rescheduling/cancellation by pharmacy, clinic/doctor and client → task #10, next.
- Worker 86/86, WORKER_VERSION 2026-11-02-bookings-4 (not deployed). BUILD .53.

## Round 36 — flexible bookings (John: practitioners, specialities, clinics, reschedule/cancel by anyone)
- Customer moves their own booking from the private link (Change time: day strip, free times, within the cut-off; 'Moved' email).
- Practitioner/room away: dates or hours + reason → time closed, bookings cancelled, customers emailed with 'Book another time',
  the rest listed to call. Cancellation emails now say why.
- Practitioners: title + speciality; booking page 'With: Anyone / Dr Anna Borg · Sports physiotherapy'; days/times follow the choice.
- Clinic rooms: set up internally; sessions may name a room; no two people in one room at once (409 in words); room on day view, emails, customer page.
- Staff UI: People tab (title/name/speciality, several windows a day with rooms, Mark away, add practitioner), Rooms tab, several people per service.
- Data safety found and fixed before shipping: saving hours would have wiped title/speciality and rooms; the old Hours screen dropped
  every window but the first (split days) — now all kept.
- Worker 93/93, UI 95/95, e2e: people 9/9, settings 13/13, bookings 13/13, move 4/4, choose-practitioner 4/4. WORKER_VERSION bookings-9 (not deployed). BUILD .54.

## Round 37 — QR code, day-view filter; live check
- Live BUILD .54: 64 modules, all four rebuilt registers present, no errors (sign-in page only; no live login used).
- QR code for the booking page (vendored qrcode-generator 1.4.4, MIT, loaded on demand); decoded from a screenshot with jsQR → exact /book/<address>. Printable card.
- Staff day view: Everyone / each practitioner / each room chips when more than one; e2e 4/4.
- UI 95/95; bookings 13/13, week 8/8. BUILD .56.

## Round 38 — Certificates rebuilt
- modules.certreg.js: needs-attention first (overdue/due soon/not recorded), in date last; Update (last date, months, certified person) — server computes next due as before; print; files via classic.
- Bug found by the new test: validation error wiped typed values → draft kept. Other rebuilt registers checked: already keep drafts.
- Phone rows made consistent (status + Update on line 2).
- UI 97/97. BUILD .57.

## Round 39 — Today attention checked; Near expiry rebuilt
- Today's Needs attention already lists overdue/due-soon certificates and opens the new Certificates screen: nothing to fix.
- modules.nexreg.js: grouped by how soon, add item, send back (create-return), search; rarer flows via classic. Test added. UI 99/99. BUILD .58.
- Rebuilt so far: Temperature, Cleaning, Daily register, Locum register, Certificates, Near expiry.

## Round 40 — Returns rebuilt (data-safe)
- modules.retreg.js: four-step tracker per return, grouped by what it waits for, one tap for the next step.
- Found: the returns update replaces every field → the screen sends the full record back. Proven on the real local worker:
  after ticking, only handed_over differs. Mock test checks every field.
- Worker: returns ?open=1 (not credited + last 60 days); old servers ignore it. Test. Worker 94/94, UI 101/101. BUILD .59.
- Rebuilt so far: Temperature, Cleaning, Daily register, Locum register, Certificates, Near expiry, Returns.

## Rounds 41–42 — Transfers rebuilt; update audit and fixes
- modules.trfreg.js (Transfers): Needs you (accept/decline, mark sent, mark received), offers, others' offers (ask, qty checked), your requests. UI 103/103.
- Update audit (UPDATE-AUDIT.md, by a helper agent): 71 PUT/PATCH routes — 36 full-replace, 19 partial, 6 mixed, 4 all-required, 6 actions.
  Rule for every new screen: on a full-replace endpoint send the whole record as read. Rebuilt screens checked: all safe.
- Fixed: bookings practitioner/service/room updates keep unsent fields (service buffer/colour were reset by the settings screen);
  debug-header crash after save in 7 handlers; String(null) → "null" in 11 places; CORS PATCH; DST bug in a test's date maths.
- Worker 97/97. WORKER_VERSION bookings-11 (not deployed). BUILD .60.

## Round 43 — Alerts rebuilt (full-record saves)
- modules.alertreg.js: open recalls/quarantines with a seven-step chip checklist, Close alert, Record an alert; closed last 60 days.
- Full-replace endpoint → whole record sent; proven on the real local worker (only the ticked step changed). No implicit status change.
- UI 105/105. BUILD .61. Rebuilt: Temperature, Cleaning, Daily register, Locum, Certificates, Near expiry, Returns, Transfers, Alerts.

## Rounds 44–45 — phone toasts; Orders rebuilt
- Toasts sat on the tab bar on phones (rule targeted the toast, not its container) → centred above it.
- Transfers checked with real local data (offer an item).
- modules.ordreg.js (Orders): waiting by need date, late first, tap-to-call, Ready (partial update, sends only fulfilled), new order;
  range read with month fallback for today's live server. Customers 'Orders' link and Today/search open it. UI 107/107. BUILD .63.
- Rebuilt: Temperature, Cleaning, Daily register, Locum, Certificates, Near expiry, Returns, Transfers, Alerts, Orders.

## Round 46 — Questions rebuilt
- modules.tktreg.js (Questions): open customer questions, high priority and due follow-ups first, tap-to-call, latest note;
  Add a note (whole history kept, only notes_log sent), Resolved (only status sent), New question.
- Caught before shipping: the server refuses a question without a category; the form uses the classic screen's category list.
- Customer-card hand-over still opens the classic forms on purpose (address/email fields); not changed.
- Real local worker: note → only notes_log changed; resolve → only status/resolved/resolved_at. UI 109/109. BUILD .64.
- Rebuilt: Temperature, Cleaning, Daily register, Locum, Certificates, Near expiry, Returns, Transfers, Alerts, Orders, Questions.

## Round 47 — Deliveries rebuilt (full-record saves)
- modules.dlvreg.js: Today (incl. overdue) / Later, maps link, tap-to-call, Fridge / Controlled drug / Signature flags;
  On its way, Delivered (recipient, signed), Not delivered (reason; 3rd attempt → Returned, same rule as classic), New delivery.
- FULL-REPLACE endpoint → whole record sent. Real local worker: each action changed only its own fields
  (ID ref, driver, method, items with batch, notes, ticket ref all intact).
- Phone: three actions on one row. UI 111/111. BUILD .65.
- Customers group now fully rebuilt for daily work: Orders, Questions, Deliveries (Appointments → Bookings).

## Round 48 — Controlled drugs received (DDA purchases) rebuilt
- Live check: BUILD .65 serving with tktreg + dlvreg.
- modules.cdpreg.js: this month by invoice; one form per delivery note with many lines (one entry per line, like classic).
- All lines validated before any POST; sequential POSTs; a failure keeps unsaved lines, saved ones greyed and never re-sent
  (real local worker with a forced 500 on line 2: retry saved only the rest, no duplicates).
- Typeahead for drug names and suppliers from the last two months. UI 113/113. BUILD .66.

## Round 49 — Controlled drugs supplied (DDA sales) rebuilt
- Live check: BUILD .66 serving with cdpreg.
- modules.cdsreg.js: month list; one form per prescription, several medicines (one entry each, like classic).
- ID card (7 digits + letter, padded like the server) fills name/address into empty fields only; prescriber fills reg no
  only when the name maps to one reg no. Repeated serial → listed, button becomes "Yes, record" (classic's part-dispense warning).
- Validate-all-then-sequential-POST with failure retention (real worker + forced 500: no duplicates).
- Bug caught in testing: repaint's keep() overwrote lookup-filled values → paint(fromState) for lookup repaints;
  lookups on input/blur instead of change (a repaint can swallow change). UI 115/115. BUILD .67.

## Round 50 — POYC rebuilt (one builder for both prescription registers)
- Live check: BUILD .67 serving with cdsreg.
- modules.cdsreg.js now make(C) for DDA sales (cdsreg) and POYC (poyreg): urgent only for sales; ID padded only for
  sales (POYC server stores as typed); POYC lookups search its own last 6 months (no lookup routes on the server).
- Real local worker: both registers pass fill-in, repeated-serial confirm, forced-failure retry with no duplicates.
- UI 116/116. BUILD .68. Controlled-drug registers rebuilt: received, supplied, POYC (stock takes still classic).

## Round 51 — dark-mode pass on today's screens
- Live check: BUILD .68 serving.
- Dark screenshots of Deliveries / Questions / DDA sales form: amber (#A06A0E) and fridge blue unreadable on black;
  checkbox a white box (.eikon-content forced color-scheme:light). → --warn/--info tokens with dark values, all
  new-layout modules use them; dark .eikon-content color-scheme:dark.
- Bug (both modes): Questions header rule greyed its pills (specificity) → :not(.tkt-pill). UI 116/116. BUILD .69.

## Round 52 — desktop check; Today lists deliveries
- Live: BUILD .69. Desktop 1440 review of Deliveries / Questions / DDA sales: clean, nothing to fix.
- Considered next rebuilds: End of day (3k lines, FULL-REPLACE money record) too risky for one round; stock takes
  low value. The audit's stock-take ReferenceError was already fixed earlier (debug-header fix).
- /today: deliveries due today or overdue in customers_waiting (worker test, 98/98; WORKER_VERSION bookings-12,
  undeployed). Today UI draws them and opens Deliveries; harmless with today's server. UI 117/117. BUILD .70.

## Round 53 — Paid out rebuilt; a speed finding parked
- Live: BUILD .70.
- Finding: the new layout late-loads 54 classic modules (~750 KB gzipped) it never renders (classic screens open as
  ?ui=classic). Parked: hubs, Today search and role selection read E.modules, so dropping them needs a static
  registry designed with care (risk: hidden registers / role changes for live users). Cost is background only.
- modules.poreg.js (Paid out): totals today/month, by day, form (comma decimals, cheque no. required), payee typeahead.
  Real local worker checked. UI 119/119. BUILD .71.

## Round 54 — tour image; Handover rebuilt
- Live: BUILD .71. Tour image of all 16 rebuilt screens sent to John.
- modules.hndreg.js (Team > Handover): incoming (yesterday, critical first), standing instructions, today's notes,
  points for tomorrow. Day record is FULL-REPLACE and deleted when empty → every save re-reads and changes one thing;
  stale notes refused (theirs shown, yours quoted). Real worker with a second till writing in between: all kept.
- Bugs caught: first paint before load crashed (null record); add box not cleared (repaint read it back).
- UI 121/121. BUILD .72.

## Round 55 — SECURITY: message board leaked group-private messages across groups (fixed, needs deploy)
- Live: BUILD .72.
- /board/messages?pinned=1 had no org filter → every pharmacy saw every pinned message, incl. other groups'
  scope='org' ones. Pin/unpin accepted any id. @mentions in scope='org' messages notified other groups' users and
  /board/mentions + /board/dashboard returned the private body.
- Fixed in the worker (visibility = scope 'all' or own org everywhere; mentions in org messages stay in the org;
  mention reads filtered, which also hides already-recorded leaked mentions). board.test.mjs fails on the current
  code, passes on the fix. Worker 99/99. WORKER_VERSION bookings-13. **Deploy needed to close it on the live site.**
- Suggestions are global by design (product ideas); user search is org-scoped; delete is own-only. Left as is.

## Round 56 — cross-group sweep of the worker (no further leaks)
- Scripted scan 1: every SELECT/UPDATE/DELETE keyed only by id (59 hits). Each is preceded by an org/location-scoped
  lookup (or supplier-location / owner check), apart from the board ones fixed in round 55.
- Scan 2: SELECTs on the 84 tables that carry org_id with no org/location/id filter (11 hits): all build their WHERE
  from org_id/location_id earlier, or are shared by design — supplier stock changes ("visible to ALL users"),
  scarce-stock needs/offers (pharmacy-to-pharmacy network, shows group names), board suggestions (product ideas),
  public booking by slug, reminder sweep.
- Nothing else to fix. The board fix (bookings-13) is still the one that needs deploying.

## Round 57 — focus visible in forms
- Rebuilt forms set outline:0 on inputs (iOS grouped rows); buttons had a ring but text fields had no focus sign.
- app.css: form label/.row :focus-within tint (light .07, dark .14), bordered fields turn accent on focus. UI 121/121. BUILD .73.

## Round 58 — Who's in (read-only rota)
- Live: BUILD .73.
- modules.rotreg.js: week view of shifts + leave (approved = Away, pending = Asked for leave, rejected hidden;
  found while testing that every new leave starts pending, so approved-only hid real requests). Own Team card
  beside Shifts (planner not hijacked); hubs open ui2Only cards directly. No writes (verified). UI 123/123. BUILD .74.

## Round 59 — Today's team tile
- Live: BUILD .74. Team tile: handover points sorted critical first (red), Who's in button. UI 124/124. BUILD .75.

## Round 60 — Repeat prescriptions rebuilt
- Live: BUILD .75. modules.repreg.js: one range read (a year back), valid by expiry, ran out in 30 days, search,
  record (server sets expiry), Renew prefill; superseded prescriptions say "Renewed <date>" (caught in testing: the
  old one still offered Renew). Real worker checked. UI 126/126. BUILD .76.

## Round 61 — Credit notes; a lost-tap race fixed
- Live: BUILD .76. modules.cnreg.js (Stock > Credit notes): remaining = amount − uses; Use re-reads and refuses more
  than is left (server has no check; classic allowed overspend; server left unchanged); Use all; new note.
- A flaky UI failure (Paid out POST missing) traced to the payee-suggestions fetch repainting the whole form while
  the Record click landed. Paid out and DDA sales/POYC now update only the datalist. UI 128/128 twice. BUILD .78.

## Round 62 — Today's minute refresh vs typing
- Live: BUILD .78. Bug: load({silent}) every 60 s re-rendered Today unconditionally → typed fridge min/max or
  cleaner name lost (and focus). Now the timer passes background:true and skips the render while typing / boxes
  hold text; action reloads still render (first attempt broke that — caught by the suite). Test: value, element
  and focus kept on a background refresh; idle refresh redraws. UI 129/129. BUILD .79.

## Round 63 — Locum receipts rebuilt
- Live: BUILD .79. Only other timer (supplier badge poll) does not repaint forms → no other refresh-vs-typing issue.
- modules.lrcreg.js: month list + total + Print (same receipt HTML as classic), form with Malta holiday rule
  (fixed + Good Friday), shared rate memory key, known locum → reg no, live total. Holiday tag uses stored
  day_type (caught in screenshot: a Sunday paid at normal rate was tagged holiday). Real worker + print popup
  checked. UI 131/131. BUILD .80.

## Round 64 — tour 2; lost answers on saves
- Live: BUILD .80. Second tour image (Handover, Who's in, Repeat Rx, Credit notes, Locum receipts) sent to John.
- Saves that time out / lose the connection were reported "Not saved: Network error" though the server may have stored
  them (risk: duplicate register lines on retry). E.saveFailText in core; 16 rebuilt screens use it.
- CD registers: baseline count of matching entries before saving; on a lost answer, re-read and mark the line saved
  if it arrived. Real worker test: POST reaches the server, reply cut → found, retry sends only the rest; no
  duplicates. UI 131/131. BUILD .81.

## Round 65 — lost answers on the money screens
- Live: BUILD .81. Paid out, locum receipts, credit-note uses: baseline count before POST; on a network error,
  re-read; arrived → treated as saved (no double payment / double use); not arrived → form kept, "check the list".
  Real worker: reply cut after storing (3 screens) and request never arriving. UI 131/131. BUILD .82.

## Round 66 — postOnce for the remaining legal registers
- Live: BUILD .82. E.postOnce(path, body, {list, same}) in core; daily register, locum register, repeat
  prescriptions use it. Real worker with replies cut: each closes as saved, one record. UI 131/131. BUILD .83.
- Lost-answer protection now covers every create on a register or money screen in the new layout
  (CD received/supplied/POYC, daily, locum, repeat Rx, paid out, locum receipts, credit-note uses).

## Round 67 — new screens against the server that is live today
- Live: BUILD .83 (UI) on worker 2026-11-02-fixes-1 (commit 54b2ec3; /health). Built a local mix: today's ui/ +
  that worker, opened all 28 new-layout destinations on a phone: no crashes, no page errors. Only two error
  responses, both handled: /client-orders range (400 → month fallback, by design) and /bookings/setup (404 →
  "Bookings is not switched on for this pharmacy yet"). So the live site is consistent while bookings-13 waits.
- Repeatable: scratchpad/tools/prodmix.mjs (serve the mix on :8803 with serve.mjs).

## Round 68 — a test that could not see the bug it guards
- The worker source check for String(x !== undefined ? x : existing.x) used single spaces; three column-aligned
  lines in the order diary update slipped past. Pattern now \s+; lines fall back to "". Order diary columns are
  NOT NULL DEFAULT '' → no stored data affected (defensive). Worker 99/99. WORKER_VERSION bookings-14.

## Round 69 — Order diary rebuilt
- modules.odreg.js: day view by supplier; status-only PUTs (PARTIAL endpoint); add via postOnce; carry-over
  (server idempotent) with the banner switching to "on tomorrow's list" once carried (caught in screenshot).
  Real worker checked. UI 133/133. BUILD .84. 22 screens rebuilt.
