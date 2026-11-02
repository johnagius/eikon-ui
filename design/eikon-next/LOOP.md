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
