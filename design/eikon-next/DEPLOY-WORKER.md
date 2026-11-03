# Deploying the Eikon server (worker) — what is waiting, and how

Written 2026-11-03 (loop round 91). The website files go live by themselves from the
`claude/eloquent-newton-7ib4gb` branch. The **server** (Cloudflare worker `eikon-api`)
does not: it changes only when someone runs `wrangler deploy`.

## Where things stand

| | Version | How to check |
|---|---|---|
| Live server | `2026-11-02-fixes-1` | https://eikon-api.labrint.workers.dev/health → `"version"` |
| Waiting to deploy | `2026-11-03-bookings-15` | `WORKER_VERSION` at the top of `cloudflare-worker/code` on the branch |

The website already copes with the older server: Bookings shows "not switched on" and
everything else works. Nothing breaks while the deploy waits.

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

## If something looks wrong

```bash
cd cloudflare-worker && npx wrangler rollback
```

puts the previous version back (the new booking tables stay, unused, and harm nothing).
