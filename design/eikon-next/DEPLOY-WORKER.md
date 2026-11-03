# Deploying the Eikon server (worker) — what is waiting, and how

**Since 2026-11-03 17:20 UTC the website is served from `main`** (John's decision). Push UI changes to `main` (fast-forward only); the old `claude/eloquent-newton-7ib4gb` is kept equal to main for now.

Written 2026-11-03 (loop round 91). The website files go live by themselves from the
`claude/eloquent-newton-7ib4gb` branch. The **server** (Cloudflare worker `eikon-api`)
does not: it changes only when someone runs `wrangler deploy`.

## Where things stand

**Deployed 2026-11-03 08:23 UTC** from this session (wrangler 4.48.0, from commit 3ec681c of
`claude/eloquent-newton-7ib4gb`, worker tests 99/99 first, dry run checked).

| | Version | Cloudflare version id |
|---|---|---|
| Live now (17:20 UTC) | `2026-11-03-batch-3`, website now served from **main** (UI_GITHUB_BRANCH = main; same code) | `0c89cc74-a552-473d-8e74-a4e807edc828` |
| Before that (16:15) | `2026-11-03-batch-3`: old address → eikonhq.com, install offer, months/print, Orders/Questions, staff accounts + idle lock, CSP report-only, DDA rewrites stopped, scale indexes, labels save | `b58f4ddc-f464-43b7-a1eb-9849a83253cd` |
| Before that (14:26) | `2026-11-03-batch-2`: per-pharmacy isolation in groups, full audit (before/after), names Title Case on save + fix endpoint (not run), error reports, ID-card change with undo | `23481a98-c741-4359-99e1-c09345369ba2` |
| Before that (11:55) | `2026-11-03-urls-1`: clean addresses; API answers unchanged | `8d472b00-a4b2-4eb2-9b80-a18c69e5ba61` |
| Before that (10:30) | `2026-11-03-bookings-19`: the bare address, /ui and /ui/ open the app | `20465171-65d0-4b00-b00e-20299be41760` |
| Before that (09:45) | `2026-11-03-bookings-18`: reminders run (cron every 10 min, senders included) | `b611aed2-dd6c-4126-9fb8-54ef66589fbe` |
| Before that (09:40) | `2026-11-03-bookings-17`: schema marks + /today reads together (Today ~2.9 s → ~1 s) | `6d6e781e-6f37-408f-8016-e6ac610729c4` |
| Before that (09:22) | `2026-11-03-bookings-16`: test emails to a typed address (5 a day) | `e684b2f4-763f-424e-bafb-76eee1125bc1` |
| Before that | `2026-11-03-bookings-15` + `BOOKINGS_KEY` set (08:27 UTC) | `712c756e-f4e8-4554-bf6d-2a0b019df65f` |
| Same code, before the key | `2026-11-03-bookings-15` | `c586a98f-4a79-499c-a5db-9057522b6bdb` |
| Before (roll back to this) | `2026-11-02-fixes-1` | `4b2cf8da-5410-46b1-93b7-103606d7a7f8` |

Checked after: `/health` reports bookings-15; all 10 bindings and vars unchanged (keep_vars);
signed-out calls still answer 401; `/bookings/setup` exists (401, was 404); a made-up
`/book/...` page and a bad `/b/...` link show their "not available" pages; UI .108 serves.

**Do not change `BOOKINGS_KEY`.** Sender keys that pharmacies save are encrypted with it; a
new key would make them unreadable (they would have to be entered again).

## What the deploy brings

- **Bookings** (all of it, never deployed so far): services, people, rooms, opening hours,
  waiting list, Today's bookings, the customer booking page with email code, customers
  changing their own time from a private link, practitioner "away" with customers told,
  emails over Resend/Brevo/your own mail server with automatic fallback, importing the old
  Appointments (read-only on the old tables).
- **Message board privacy fix**: a group's private messages, pins and @mentions no longer
  reach other groups (worker test `board.test.mjs` proves the old leak and the fix).
- **Today** lists deliveries due today or overdue.
- **Fixes from the update audit** (UPDATE-AUDIT.md), batched ID lookups under D1's
  100-parameter limit, faster first load, order diary null-text fix.
- **Customer booking page accessibility** (rounds 88–90): contrast, keyboard, shorter page.

## Is existing data safe?

- No existing table is altered or dropped. Bookings uses **new** tables only (`bk_services`,
  `bk_providers`, `bk_rooms`, `bk_exceptions`, `bk_bookings`, `bk_holds`, `bk_waitlist`,
  `bk_settings`, `bk_senders`, `bk_messages`, `bk_optout`, `bk_legacy_map`), created by the
  worker itself with `CREATE TABLE IF NOT EXISTS` the first time they are needed (its only
  `ALTER TABLE` statements add columns to those new tables). No `d1 execute` step is required.
- The old Appointments tables are only **read** (Check, then Import, by the pharmacy).
- Logins, roles and chain groups are not touched.
- Worker tests: 99/99 on the branch (`node --no-warnings tests/worker/run.mjs`).
- **Upgrade rehearsal** (round 92, `upgrade-rehearsal.mjs` next to this file): the live
  server code (fixes-1) creates an account and 20 records across 15 registers; then the
  waiting code (bookings-15) takes over the same database. Result, 10/10: sessions and
  passwords keep working; all 16 lists the screens read return the same records; Bookings
  sets itself up; the old appointments check and import; every existing table is
  byte-for-byte unchanged afterwards; only bk_ tables are added; and after a rollback to
  the old code, the session and all 16 lists are still the same.

## One optional secret

`BOOKINGS_KEY` (at least 16 characters, random). Without it Bookings works, but customer
emails, sender keys and private booking links stay off (the settings screen says so).
Set it once, any time:

```bash
cd cloudflare-worker && openssl rand -base64 32 | npx wrangler secret put BOOKINGS_KEY
```

Optional too: `BOOKINGS_TIMEZONE` (default `Europe/Malta`).

## Deploy

From a checkout of `claude/eloquent-newton-7ib4gb`:

```bash
cd cloudflare-worker && npx wrangler deploy
```

Then check `/health` shows `2026-11-03-bookings-15`, hard-refresh Eikon (Ctrl+Shift+R),
open Bookings and press "Set up bookings".

## Restore points

- Before batch-3 (16:14 UTC): `00000b2b-00000000-00005118-a70517b43d851ec0ae40841274e7dbc7`.
- Before batch-2 (14:25 UTC): D1 Time Travel bookmark `00000b19-00000000-00005118-09a92e471007090dbaeb92cbef7e982d`.

## Custom domain

eikonhq.com and www.eikonhq.com are attached to eikon-api as Workers custom domains (2026-11-03, John's yes); a `wrangler deploy` keeps them (checked after urls-1). Before each deploy, also record `npx wrangler d1 time-travel info eikon_db` (the restore point) here.

## If something looks wrong

```bash
cd cloudflare-worker && npx wrangler rollback 4b2cf8da-5410-46b1-93b7-103606d7a7f8
```

puts the previous version back (the new booking tables stay, unused, and harm nothing).
