# One-click public demo

John, 2026-11-11: "clean the demo account and allow the clients to login to the demo account with a simple click (no
user and password) so they can test and enjoy the system". Then: "dont forget the distributor and operations
sections". Decided: the demo is the LIVE location 2 "Demo Pharmacy" (org 2, its own group); visitors can try
everything; it goes back to the start every night.

## How it works

- **Switch.** `cloudflare-worker/wrangler.toml` `[vars]`: `DEMO_ORG_ID = "2"`, `DEMO_LOCATION_ID = "2"`, and three
  optional doors' places: `DEMO_PHARMACY2_LOCATION_ID = "399"` (a second pharmacy, so head office has two to compare),
  `DEMO_SUPPLIER_LOCATION_ID = "599"` (distributor, 400-599) and `DEMO_HQ_LOCATION_ID = "899"` (head office, 600-900).
  Without `DEMO_ORG_ID` or `DEMO_LOCATION_ID` the feature is off: `/auth/demo` is 404, `/health` has no `demo`, the
  sign-in screen shows nothing and makes no extra request, no guard runs, and every SQL statement is the one it was.
- **Sign-in screen** (`ui/core.js` `E.demoDoors` / `E.demoEnter`, CSS at the end of `ui/app.css`): a calm card under
  the form, "New to Eikon? Try it now, no sign-in needed.", with **Try the demo pharmacy** (first, largest), **Try as a
  distributor**, **Try as head office**, and "Sample data only: it goes back to the start every night. Please do not
  type real patients' details." It appears only when `/health` says `demo: true`; then `GET /auth/demo` lists the open
  doors. A door is `POST /auth/demo {door}`; the app then starts exactly as after a password sign-in.
- **Doors** (`handleDemoDoor`). Each door is one dedicated account in group 2 (`visitor.pharmacy@`, `visitor.supplier@`,
  `visitor.hq@`, and `visitor.branch@` for the second pharmacy, all `@demo.eikon.invalid`), role admin so every screen
  shows, with a random password that is thrown away (nobody can sign in with a password). The session lasts **2 hours**
  and `/auth/me` carries `demo: true`. Rate limit: 12 a hour per address, 400 a hour in all (`demo_signins`). The real
  sign-ins of location 2 are untouched and keep working (with their password, as before). No door is offered before
  the first reset has finished (until then location 2 still holds its old rows) or after a wipe.
- **Places.** The first reset (or the first door) creates 399 "Demo Pharmacy Sliema", 599 "Demo Distributor" and 899
  "Demo Head Office" inside group 2 when those ids are free. An id that belongs to another group is never touched: that
  door stays shut and the reset reports it. If group 2 has any other location, the reset refuses to wipe anything.
  SU's "next location number" ignores the demo's made-up places (so 599/899 do not move it).
- **Every session of group 2 is guarded** (`demoGuard`, `demoCrossCheck`), the visitors' and any real sign-in of it.

## What a demo session cannot do

| Refused or made harmless | How |
|---|---|
| Add, change, delete sign-ins; roles; passwords | `/team/users*` writes 403; the list shows the demo's own visitors only (never John's e-mail); `/auth/change-password` 403 |
| Superuser, group, location changes, delete the pharmacy | `/su/*` (superuser only anyway), `/admin/names/*` 403 |
| E-mail, SMS, WhatsApp to customers | `/messages` answers 403 "Not sent — this is the demo"; `bkSendEmail` and `bkCanSend` never send for group 2 (booking confirmations, reminders, codes) |
| Sender keys, test e-mails | `/bookings/senders*` writes 403; test sends "Not sent — this is the demo"; `/bookings/settings` keeps everything except provider, keys, SMTP, from address and the public booking address |
| Push to phones | `/rota/push/subscribe` answers push: false; `rpnNotify` never pushes for group 2 |
| Calendar feed secret | `/shifts/settings` saves without the calendar token |
| Bulk imports | more than 50 lines refused (supplier products, short-expiry upload, POS catalogue, sales sync, legacy import, people backfill) |
| Big bodies / uploads | over 256 KB refused (413) |
| Idle lock | opens without a password (the visitor has none) |
| Board "everyone" | a demo post is stored for its group only; demo sessions never see the live groups' messages, pins, mentions or names |
| Lists that read across groups | supplier products and stock changes, scarce-stock needs, board suggestions: demo sees only group 2, live never sees group 2 |
| Rows named by id across the line | a demo session acting on a live row (or a live session on a demo row) by id gets 404: scarce stock, transfers, board messages and suggestions, supplier orders and lines, supplier stock changes; a demo pharmacy cannot order from a live supplier and no live pharmacy from the demo distributor |
| Other pharmacies' reports | already isolated; tests prove owner figures, records, overview, audit, registers, people, Today |

Everything else works normally inside group 2.

## The reset (`resetDemo`)

- **Wipe.** Tables are discovered at run time (`sqlite_master`). A row is the demo's when one of its owner columns
  (`org_id`, `location_id`, `*_org_id`, `*_location_id`) names group 2 or a demo place and none names anything else (0
  and empty count as none). A row shared with a live group is never deleted. Tables with no owner column are deleted
  through their parent (`supplier_order_items`, `board_mentions`, `board_suggestion_comments`, the demo users'
  `board_user_state`). Never wiped: orgs, locations, users, sessions, login throttles, schema marks, the demo's state,
  name-fix undo records. Visitors' sessions end at the start of a reset; real sign-ins of group 2 keep theirs.
  Note: the **first** reset removes everything now stored for location 2 on live (that is the "clean").
- **Seed** (`demoSeedSteps`): through the worker's own routes, signed in as the door accounts, so screens read the
  rows exactly as real data. Dates are relative to the Malta day the reset started. Names follow `agents/demo/NAMES.md`
  (no Maltese letters in surnames or English first names). Phones are 7900 11xx, e-mails `@example.com`.
- **Bounded.** D1 answers at most 1,000 queries per invocation (Workers Paid). Every query of a reset is counted; a run
  stops between steps past 450 (`DEMO_QUERY_BUDGET`), the largest step is about 160. A full reset is about 1,400
  queries: three or four runs. State lives in `demo_state`; the next run carries on.
- **Nightly**, no new cron: the existing 10-minute `scheduled()` starts a reset once per Malta day between 03:00 and
  06:00 and carries it on run by run (about 30-40 minutes). A deploy in the afternoon never wipes the visitors' work.
- **Superuser routes**: `POST /su/api/demo/reset` (reset now; call until `done: true`), `POST /su/api/demo/wipe` (empty
  the group, seed nothing: before switching off), `GET /su/api/demo/status`.

### The seed (2-3 items per section)

| Section | What |
|---|---|
| Customers | 8 people (Camilleri Joseph, Vella Rita, Farrugia Carmel, Zammit Claire, Galea Ġużeppi, Micallef Daniela, Grech Paul, Attard Ċensina) with ID cards, addresses, doctors |
| Today's checks | room, Pharmacy Fridge, Vaccine Fridge: last 3 days logged; today the vaccine fridge still to do; cleaning due |
| Temperatures | 3 devices x 4 days (11 readings), one note |
| Cleaning | 3 entries (Doris, Karl) |
| Daily register | 3 prescriptions (Augmentin, Prednisolone, Ramipril) |
| Controlled drugs | 2 received (Island Pharma, Alliance), 2 supplied, 2 POYC, 1 stock take with 2 lines |
| Locums | 2 register lines, 2 receipts |
| Certificates | 3 dated (one expired, so Needs attention shows it) |
| Counter | 3 client orders (one handed over), 2 questions, 2 deliveries, 2 repeat prescriptions |
| Stock | 3 near expiry, 2 returns, 1 recall alert (Valsartan), 3 order diary lines, scarce stock: 1 offer + 1 need, 2 transfers |
| Bookings | provider Maria Borg Mon-Sat, 2 services (blood pressure check, flu vaccine), 4 bookings today/tomorrow |
| Services | 3 POCT tests (BP, glucose, cholesterol), 1 screening campaign with 3 people, 2 vaccine stock rows, 3 vaccinations, 2 PV reports, 3 labels printed |
| Money | 3 end of day (2 locked, yesterday saved; tills balance within 40c), 3 paid outs, 2 emergency till sales, 2 credit notes (one partly used) |
| Team | 4 staff on the rota (Maria Borg, Kurt Zahra pharmacists; Sarah Vella, Ryan Mifsud assistants), usual-week patterns for 3, this week's shifts from them, 2 Saturdays for Ryan, 1 leave request pending + 1 approved, opening hours, yesterday's handover (red/yellow/green), 2 board messages, last inspection 90 days ago |
| Second pharmacy (399) | 3 days of temperatures, cleaning, 2 prescriptions, 3 end of day, a paid out, a board message |
| Distributor (599) | 4 products (one out of stock), 3 orders received from the two demo pharmacies (one shipped with a delivery date), 1 feedback (short dated) |
| Head office (899) | reads both pharmacies (How we're doing, Pharmacy overview, Company dashboard); one board message |

Not seeded: OTC favourites (kept in the browser, not on the server); Cherubino screens (price checks, short-expiry and
out-of-stock lists) show only for group 12, so the demo group does not have them; appointments (classic) — Bookings is
the booking screen.

## Tests (all run on this copy)

- Worker: `tests/worker/demo.test.mjs` (10 tests): off when unset; no door before the first reset or after a wipe; three doors, 2-hour sessions, real sign-in kept, SU
  next id; rate limit; guard (each forbidden action, normal writes allowed, other pharmacies' reports); isolation both
  ways (board, supplier marketplace and orders, scarce needs, suggestions, head office, no e-mail); reset keeps every
  live row byte-for-byte, real session kept, visitors out, every section seeded with exact counts, twice = same;
  refuses with an unknown location in group 2, a configured id of another group is never touched; nightly once per day
  from 03:00, carried across runs, under 800 queries per run.
- Full worker suite with `BOARD_OLD_WORKER=agents/RP/old-c2e0a40.js`.
- Real stack: `tests/real/cases/solo-demo.mjs` (own stack and port): reset, then a fresh browser presses Try the demo
  pharmacy and opens all 9 tabs and 45 screens of the hubs, then the distributor's 4 and head office's 3 screens; zero
  page errors, console errors and CSP violations; seeded people, fridges, rota, scarce stock, recall, products, orders
  and both pharmacies appear; doors fit a phone.
- UI suite: the sign-in block "demo" (classic and new layout): no door and no request without a demo; three doors under
  the form, pharmacy first, fits a phone, one tap starts the app.
- Rehearsal: `tests/rehearsal/demo-upgrade.mjs`: live worker fills live groups, a supplier, a head office and group 2;
  this worker with the demo on resets, a visitor writes, the nightly runs; then wipe, rollback to the live worker, then
  this worker switched off. Every live row unchanged throughout, every live list the same, the real sign-in of the demo
  pharmacy works on both, nothing of the demo visible after the wipe.

Results on this copy: worker suite 317/317 (with `BOARD_OLD_WORKER`); UI suite 537/537 (one earlier run had a timing
failure in "customers' registers, quality pass", passed on the re-run); rehearsal 19/19; real stack `solo-demo` 70/70
checks. The full real suite ran 90/97: focus, tempreg, vaxgiven, typerace, solo-dailytoday and solo-q61keep failed
under machine load. The same cases fail on the base (`agents/SEC-base-real.out`), and each one passes when run alone.
Screenshots of the sign-in doors, the pharmacy hubs and both portals: `agents/DEMO-shots/`.

## Live steps (integrator, with John's yes)

1. **Restore point.** `npx wrangler d1 time-travel info eikon_db` and keep the bookmark it prints.
2. **Check the ids are free** (expect one row: `2 | 2 | Demo Pharmacy`, and no demo e-mails):
   `npx wrangler d1 execute eikon_db --remote --command "SELECT id, org_id, name FROM locations WHERE id IN (2,399,599,899) OR org_id = 2"`
   `npx wrangler d1 execute eikon_db --remote --command "SELECT id, org_id, email FROM users WHERE email LIKE '%@demo.eikon.invalid' OR org_id = 2"`
   If 399, 599 or 899 is taken, change that variable in `wrangler.toml` to a free id in its range first. Tell John the
   first reset deletes everything now stored for location 2 (the sign-ins stay).
3. **Before counts** (to compare after): `SELECT (SELECT COUNT(*) FROM people WHERE location_id != 2), (SELECT COUNT(*) FROM daily_register_entries WHERE location_id != 2), (SELECT COUNT(*) FROM end_of_day WHERE location_id != 2), (SELECT COUNT(*) FROM supplier_products WHERE org_id != 2)`.
4. **Deploy** from `cloudflare-worker/`: `npx wrangler deploy` (the five `DEMO_*` vars are in `wrangler.toml`).
5. **Reset now, once**, signed in as John (superuser) on eikonhq.com, in the browser console:
   `for (let r; !(r && r.done);) { r = await (await fetch('/su/api/demo/reset', { method: 'POST', headers: { Authorization: 'Bearer ' + localStorage.eikon_token } })).json(); console.log(r); if (!r.ok) break; }`
   Expect 3-4 lines and `done: true, problems: []`. `GET /su/api/demo/status` shows the state.
6. **Check:** signed out, eikonhq.com shows the three doors; each opens (pharmacy: Today with 1 check to do and 4
   customers waiting; distributor: 3 received orders; head office: both demo pharmacies). Re-run step 3: same numbers.
   A live pharmacy's board, supplier list and scarce stock show nothing of the demo.

## Rollback

1. Empty the demo group first (otherwise, once the filters are gone, its distributor's products and its needs would
   show in live lists): same console loop with `/su/api/demo/wipe` until `done: true` (`phase: "wiped"`).
2. Remove the five `DEMO_*` lines from `wrangler.toml` and deploy, or `npx wrangler rollback` to the previous version
   (the old worker ignores `demo_state` / `demo_signins` and the made-up locations and accounts; the rehearsal proves it).
3. Only if live data outside group 2 were harmed (the tests say they cannot be): `npx wrangler d1 time-travel restore
   eikon_db --bookmark=<step 1>` — this also loses every live write since, so it is the last resort.
4. Leftovers that may stay: locations 399/599/899 and the four `@demo.eikon.invalid` accounts (inactive in effect: no
   password). To remove: `DELETE FROM sessions WHERE user_id IN (SELECT id FROM users WHERE email LIKE '%@demo.eikon.invalid'); DELETE FROM users WHERE email LIKE '%@demo.eikon.invalid'; DELETE FROM locations WHERE id IN (399,599,899) AND org_id = 2;`

## Known limits

- Every visitor shares one sandbox (one account per door): they see each other's changes until the night.
- Today's "Getting this pharmacy ready: Add people" opens Sign-ins, which the demo refuses to change ("Not now" hides it).
- The distributor and head-office portals are the classic (older) look; they work and show the seed, the finish round
  rebuilds them.
- Needs Workers Paid (the reset's runs use up to ~600 D1 queries; the free plan allows 50).
