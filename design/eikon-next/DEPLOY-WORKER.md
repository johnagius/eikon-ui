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
| Live now (2026-11-11) | `2026-11-11-batch-18`: one-click demo (DEMO_* vars: org 2, locations 2, 399, 599, 899), guard, nightly reset; UI .180 | `ddd0ac82-2d29-417e-9234-dc1e00c84bf2` |
| Before that (2026-11-11) | `2026-11-11-batch-17` HOTFIX: End of day zero-overwrite guard (409 would_clear_figures unless confirm_zero); UI .179 | `cef7eeef-5b55-4178-b2c8-b08af4f8019f` |
| Before that (2026-11-11) | `2026-11-11-batch-16`: safety (gpt-extractor 404, CSP report-uri, CSP_ENFORCE flag off, UI_GITHUB_REF), labels English only; UI .178 | `a88db514-f356-4d43-98db-7a2dedc55be3` |
| Before that (2026-11-11) | `2026-11-10-batch-15`: Roster planner — POST /shifts/apply-plan (one-step), leave in ICS feed + feed caching (ETag/304), web push (/sw.js, push_subscriptions, VAPID_PRIVATE_KEY secret set); UI .177 | `ad99610c-654f-412a-8e1c-6aa507ae6441` |
| Before that (2026-11-10) | `2026-11-10-batch-14`: Team round 2 — board queries rewritten (same answers, 2 indexes), unread 99+, pins per group; UI .176 | `5434019e-d750-4cfb-a03b-2318547c3d95` |
| Before that (2026-11-10 12:01 UTC) | `2026-11-10-batch-13`: Team & shifts — GET /team/today (read-only), handover_seen table + /instructions/daily/seen, @mention matching for names followed by more words (group isolation unchanged); UI .175 | `fa9f09aa-c0f8-4861-9376-754ee47b32b0` |
| Before that (2026-11-10 07:06 UTC) | `2026-11-09-batch-12`: Services — GET /services/today (read-only), vaccinations table + /vaccines/given; UI .174 | `b8ba8bc3-2582-4e10-8c46-a80faf3a998f` |
| Before that (2026-11-09 16:17 UTC) | `2026-11-09-batch-11`: Money & end of day — GET /money/today, /endofday/overview, /emergency-pos/days (read-only), Malta holidays; UI .173 | `33a6d92a-b587-4785-b9b4-de170b06d1f4` |
| Before that (2026-11-09 10:31 UTC) | `2026-11-09-batch-10`: Registers round 2 — GET/PUT /registers/last-inspection (new table), sign-off table ensured before the hub reads it; UI .171, then .172 | `82ad3d84-c3f8-4f9b-b676-223e5ebe937a` |
| Before that (2026-11-09 09:59 UTC) | `2026-11-09-batch-9`: Registers & inspection — GET /registers/today, GET+POST /registers/signoffs (new table), GET /dda-register/medicines + /ledger (read-only); UI .169 | `037b5f34-9311-49e5-9f80-7827cfb9c24d` |
| Before that (2026-11-04 10:36 UTC) | `2026-11-04-batch-8`: Stock & ordering flow (stock_flow_* tables), Bookings full system (4 additive bk_bookings columns); UI .168 | `1c2dfcb9-efa9-487e-854d-a24e3a699717` |
| Before that (09:18 UTC) | `2026-11-04-batch-7`: owner's view (/owner/*, read-only) and customers & messaging (cust_* tables); UI .167 | `89570a1b-a3bb-4061-946b-78bda836239c` |
| Before that (07:51 UTC) | `2026-11-04-batch-6`: Maltese letters in name searches, server-issued TKT/DEL numbers (+2 indexes), Malta dates for server-filled dates, scarce stock within the org; UI .165 | `fdc7ef6b-26db-4d3a-a263-157d2cc41523` |
| Before that (2026-11-03 21:39 UTC) | `2026-11-03-batch-5`: temperature notes and late logging, repeats coming due (two added columns on repeat_prescription_entries), Correct with an audit reason, Inspection check; UI .149 on main | `550951a7-b084-4c80-8612-11ccd9822a36` |
| Before that (17:35 UTC) | `2026-11-03-batch-4`: whole-state saves write only changes, bulk imports safe, people links server side (UI flag off), CSP-safe print tabs | `f368bd4b-85dd-4a57-b9ad-c5f31ee5c1bd` |
| Before that (17:20) | `2026-11-03-batch-3`, website now served from **main** (UI_GITHUB_BRANCH = main; same code) | `0c89cc74-a552-473d-8e74-a4e807edc828` |
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

**Do not change `BOOKINGS_KEY`.** `VAPID_PRIVATE_KEY` (set 2026-11-11) signs shift notifications; changing it means staff re-enable notifications. Sender keys that pharmacies save are encrypted with it; a
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

- Before batch-18 (2026-11-11): `0000100b-00000000-00005120-500e7df51411eb86b2442922b1a0f71b`. Before counts outside the demo: people 1, daily register 67, end of day 37, supplier products 200.
- Before batch-17 (2026-11-11): `00001006-00000000-00005120-3cc4319bdd91503a2b1d539e11626c07`.
- Before batch-16 (2026-11-11): `00000fcd-00000000-00005120-46dc74f64336adaf306b0b22361b46d7`.
- Before batch-15 (2026-11-11): `00000fbc-00000000-00005120-86ff85b5db9a3ff3efb6685c1412d685`.
- Before batch-14 (2026-11-10): `00000f64-00000000-0000511f-4bfe2dbc3d68c239b3c8f9f0879891b0`.
- Before batch-13 (2026-11-10 12:01 UTC): `00000f49-00000000-0000511f-f5b141dc54fc3665823d9e66fa887a3c`.
- Before batch-12 (2026-11-10 07:05 UTC): `00000f2b-00000000-0000511f-77c6248ca6894da0c7726b1881f3dac8`.
- Before batch-11 (2026-11-09 16:17 UTC): `00000ecf-00000000-0000511e-658b63318ba9adc7749da4cc54556698`.
- Before batch-10 (2026-11-09 10:31 UTC): `00000eaa-00000000-0000511e-e30c6050ffd55f56b3ed189c5e65c319`.
- Before batch-9 (2026-11-09 09:58 UTC): `00000ea6-00000000-0000511e-5c31fd442efef3937c9eee106bc5fc2a`.
- Before batch-8 (2026-11-04 10:35 UTC): `00000bb2-00000000-00005119-68bdf9813a05ae612d0c1d05d46cadac`.
- Before batch-7 (2026-11-04 09:17 UTC): `00000ba8-00000000-00005119-8c54f9937fa18ee469a7a28723518781`.
- Before batch-6 (2026-11-04 07:50 UTC): `00000b9f-00000000-00005119-a2be1b2819fdfa28760e7ae22cb56e14`.
- Before batch-5 (21:38 UTC): `00000b5f-00000000-00005118-85ddf560ea98efb3b482472eb0cfc11d`.
- Before batch-4 (17:34 UTC): `00000b3d-00000000-00005118-b2156fabccf982d1974cd87086fdfc5f`.
- Before batch-3 (16:14 UTC): `00000b2b-00000000-00005118-a70517b43d851ec0ae40841274e7dbc7`.
- Before batch-2 (14:25 UTC): D1 Time Travel bookmark `00000b19-00000000-00005118-09a92e471007090dbaeb92cbef7e982d`.

## Custom domain

eikonhq.com and www.eikonhq.com are attached to eikon-api as Workers custom domains (2026-11-03, John's yes); a `wrangler deploy` keeps them (checked after urls-1). Before each deploy, also record `npx wrangler d1 time-travel info eikon_db` (the restore point) here.

## If something looks wrong

```bash
cd cloudflare-worker && npx wrangler rollback 4b2cf8da-5410-46b1-93b7-103606d7a7f8
```

puts the previous version back (the new booking tables stay, unused, and harm nothing).
