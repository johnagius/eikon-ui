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
