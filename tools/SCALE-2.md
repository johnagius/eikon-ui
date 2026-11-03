# SCALE-2: a big pharmacy, re-measured on the new layout and the waiting server batch

> Copied from the b2-10 work copy (design/eikon-next/SCALE-2.md). The `scale2/` measurement scripts it names were not merged into this tree.

Local only. No live server, no Cloudflare, no wrangler, nothing pushed. Tree: `git archive 7735d40` (worker
`2026-11-03-urls-1` string, carrying the undeployed batch: isolation, full audit, names on save, `/client-log`, ID-card
consistency), UI .139 → .140. The "live" column is the worker of 31d1e71 (urls-1, what pharmacies run today).

## 1. Method

- **Data** (`scale2/seed-base.mjs`, `scale2/seed_bulk.py`): the round-3 seed (DATA-AUDIT.md) re-run on HEAD's own
  schema (every module GET called once on an empty DB, 108 tables), ~2.0M rows, 20 pharmacies in one group, 5 years.
  Three changes: **location 7 (maria) is the big pharmacy**, about 27% of every register (5x an average branch:
  10,767 DDA sales, 10,767 orders, 13,461 people, 8,074 appointments, 20,000 POCT tests); 30% of names typed in lower
  case; `audit_log` 600k rows = 400k old-style (location_id NULL) + 200k of the last year with full before/after rows
  (avg 1.36 KB, every tenth EOD-sized). Plus one person whose name and card appear nowhere else (worst case for scans).
- **Calls** (`scale2/measure.mjs`, `scale2/writes.mjs`): in-process, the real worker on a file-backed SQLite D1 shim
  (`scale2/app.mjs`). One warm-up per call (cold-isolate DDL excluded), then 20 runs (screens of more than 6 calls:
  5 runs of the whole set); median and p95. Writes run on their own DB copy, sequentially.
- **Rows read** (`scale2/rows.mjs`): round-3 model, EXPLAIN QUERY PLAN with the real parameters. A `SCAN` or a
  `SEARCH` pinned only by org/location counts every row of that table/location; it is exact for those, and an upper
  bound when the query stops at a LIMIT in index order (common names). A range `SEARCH` counts rows returned, which
  undercounts a COUNT over the range; exact range sizes are given in the text where it matters.
- **Screens** (`scale2/screens.mjs`): Chromium, new layout, real stack on port 8900 (localhost only, every other host
  blocked): sign-in to Today, Possible duplicates, Download our records (this year, every register).
- **D1 latency** is not in the local times. `RTT_MS=15` makes the shim wait 15 ms per statement (an assumed
  Worker-to-D1 round trip) so sequential and parallel statements can be compared.
- Local times on one machine are noisy (±30% between runs on unchanged lines). Statements, rows and bytes are not.

## 2. Reads, before → after (big pharmacy)

Only the people, person, audit and POCT lines changed code; other differences are run-to-run noise.

| Call (big pharmacy, loc 7) | calls | median ms | p95 ms | statements | rows returned | rows read (est.) | KB | max params |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| GET /people?q=za&limit=30 | 1 | 77.9 → 29.1 | 119.2 → 47.6 | 17 | 311 | 89,676 → 62,780 | 18.5 | 92 |
| GET /people?q=zam&limit=30 | 1 | 81.3 → 27.2 | 123.8 → 37.6 | 17 | 311 | 89,676 → 62,780 | 18.5 | 92 |
| GET /people?q=zammit&limit=30 | 1 | 93.3 → 29.1 | 151.6 → 34.3 | 17 | 311 | 89,676 → 62,780 | 18.5 | 92 |
| GET /people?q=xuereb&limit=30 | 1 | 124.7 → 84.1 | 186.5 → 107.7 | 15 | 4 | 62,752 | 0.3 | 6 |
| GET /people?q=502948M&limit=30 | 1 | 122.4 → 101.2 | 217.6 → 128.2 | 15 | 4 | 62,752 | 0.3 | 7 |
| GET /people?q=502&limit=30 | 1 | 95.6 → 53.7 | 191.5 → 72.4 | 17 | 186 | 89,676 → 62,759 | 18.9 | 92 |
| GET /people (recent) | 1 | 23.8 → 17.6 | 34.1 → 19.7 | 4 | 53 | 13,466 | 20.4 | 3 |
| GET /dda-sales/clients?q=zam&limit=8 (picker) | 1 | 21 → 25.1 | 27.2 → 26.6 | 4 | 11 | 10,771 | 0.9 | 6 |
| GET /dda-sales/clients?limit=12&q=zam | 1 | 19.6 → 18.4 | 26.1 → 25.9 | 4 | 15 | 10,771 | 1.3 | 6 |
| GET /dda-sales/doctors | 1 | 23.5 → 25.5 | 51.4 → 30.6 | 4 | 15 | 10,771 | 0.8 | 3 |
| GET /paid-out/names?q=co | 1 | 1.5 → 1 | 8.9 → 1.2 | 4 | 3 | 5,387 | 0 | 3 |
| GET /order-diary/items?q=pan | 1 | 0.8 → 0.5 | 1.5 → 3.2 | 4 | 3 | 4 | 0 | 2 |
| GET /board/users/search?q=ma | 1 | 0.9 → 0.8 | 3.5 → 1.2 | 4 | 3 | 7 | 0 | 3 |
| GET /people/:id (timeline) | 1 | 59.9 → 50.7 | 102.7 → 56.6 | 18 | 577 | 78,904 → 65,444 | 10.4 | 6 |
| GET /people/:id (timeline, rare name) | 1 | 106.4 → 115.9 | 186.5 → 192.4 | 18 | 6 | 78,904 → 65,444 | 0.5 | 6 |
| GET /people/:id/id-card-changes | 1 | 0.6 | 0.8 → 1.4 | 4 | 3 | 6 | 0 | 3 |
| GET /today | 1 | 10.2 → 10.1 | 11.5 → 13.7 | 23 | 297 | 38,913 | 18.1 | 4 |
| search: open orders (12+2 months, fulfilled=0) | 1 | 1.3 → 1.5 | 3.2 → 1.8 | 4 | 41 | 42 | 29.9 | 5 |
| search: orders fallback (3 months) | 3 | 11.2 → 8.4 | 17.8 → 10.4 | 12 | 372 | 375 | 285.4 | 4 |
| search: today's bookings | 1 | 1.5 → 0.9 | 13.4 → 3.1 | 6 | 3 | 5 | 0.1 | 4 |
| GET /audit/log first page (100) | 1 | 390.2 → 54.6 | 457 → 72 | 5 | 104 | 1,200,120 → 1,200,128 | 74.8 | 4 |
| GET /audit/log module+action filter | 1 | 310 → 114.4 | 347.5 → 162.7 | 5 | 4 | 1,200,021 → 1,200,029 | 0.1 | 6 |
| GET /audit/log a week | 1 | 309.9 → 2.3 | 362.3 → 4.5 | 5 | 104 | 1,200,120 → 205 | 74.8 | 6 |
| dupes: people | 1 | 19.1 → 17.3 | 23.7 → 21.8 | 4 | 53 | 13,466 | 20.4 | 3 |
| dupes: orders | 12 | 119 → 49.6 | 181.2 → 58 | 48 | 1,954 | 1,966 | 1507.3 | 4 |
| dupes: questions | 1 | 32.7 → 32.8 | 86.7 → 44.7 | 4 | 2,692 | 2,693 | 1245.9 | 2 |
| dupes: deliveries | 1 | 62.9 → 40.6 | 85.1 → 55.8 | 4 | 2,003 | 4,041 | 1965.1 | 2 |
| dupes: dda sales | 12 | 28.3 → 24.6 | 38.2 → 27.6 | 48 | 2,008 | 2,020 | 734.5 | 4 |
| dupes: poyc | 12 | 9.5 → 11.3 | 11.3 → 19.9 | 48 | 419 | 431 | 138.4 | 4 |
| dupes: repeat rx | 12 | 10.9 → 12.5 | 14.4 → 17.4 | 48 | 649 | 661 | 199.8 | 4 |
| dupes: appointments | 1 | 81.7 → 83.4 | 125.3 → 108.3 | 4 | 5,003 | 8,078 | 2649.9 | 3 |
| dupes: waitlist | 1 | 5.7 → 7 | 11.3 → 11 | 4 | 540 | 541 | 232.2 | 2 |
| dupes: bookings | 2 | 1.8 → 2 | 15.5 → 2.3 | 12 | 6 | 10 | 0.2 | 4 |
| dupes: loyalty | 1 | 12.4 → 12.1 | 20.3 → 25.4 | 4 | 4,040 | 4,041 | 493.1 | 2 |
| dupes: poct | 1 | 305.8 → 293.5 | 443.7 → 399.2 | 5 | 23,003 | 23,004 | 12808.1 | 2 |
| dupes: screening | 1 | 2.2 → 2.3 | 7.2 → 3.9 | 4 | 53 | 54 | 108.5 | 2 |
| dupes: calculator | 1 | 0.4 → 0.5 | 0.6 → 0.7 | 4 | 3 | 4 | 0 | 2 |
| dupes: vaccines | 1 | 0.4 → 0.5 | 0.6 → 0.7 | 4 | 3 | 4 | 0 | 2 |
| dupes: contacts | 1 | 32.6 → 34.5 | 45.8 → 50.7 | 4 | 5,386 | 5,387 | 1391.7 | 2 |
| export year: temperature | 13 | 18.2 → 21.2 | 21.7 → 23.7 | 53 | 719 | 44,632 | 183.8 | 4 |
| export year: cleaning | 12 | 58.2 → 54 | 65.3 → 58.6 | 48 | 1,775 | 420,048 | 487.8 | 4 |
| export year: dailyregister | 12 | 17.4 → 20.5 | 19.5 → 22.2 | 48 | 1,742 | 1,754 | 509.8 | 4 |
| export year: locumregister | 12 | 9.7 → 10.4 | 14.2 → 11.4 | 48 | 296 | 308 | 56.8 | 4 |
| export year: ddapurchases | 12 | 9.8 → 10.4 | 11.4 → 11.8 | 48 | 327 | 339 | 64.6 | 4 |
| export year: ddasales | 12 | 37.4 → 31.7 | 70.1 → 33.9 | 48 | 2,008 | 2,020 | 734.5 | 4 |
| export year: ddapoyc | 12 | 9.6 → 11.1 | 12.1 → 12 | 48 | 419 | 431 | 138.4 | 4 |
| export year: repeatprescriptions | 12 | 15.4 → 10.8 | 30.6 → 13.7 | 48 | 649 | 661 | 199.8 | 4 |
| export year: paidout | 12 | 16.1 → 15.7 | 17.1 → 22.7 | 48 | 1,021 | 1,033 | 313.1 | 4 |
| export year: locumreceipts | 12 | 7.4 → 8.6 | 9.1 | 48 | 195 | 207 | 40.2 | 4 |
| export year: clientorders | 12 | 85.7 → 56.3 | 98.3 → 71.3 | 48 | 1,954 | 1,966 | 1507.3 | 4 |
| export year: creditnotes | 1 | 15.3 → 15.2 | 78.1 → 20.2 | 28 | 1,580 | 1,938 | 321.6 | 91 |
| export year: tickets | 1 | 36.7 → 35.2 | 65.5 → 45.9 | 4 | 2,692 | 2,693 | 1245.9 | 2 |
| export year: deliveries | 1 | 70.2 → 51.7 | 155.2 → 62 | 4 | 2,003 | 4,041 | 1965.1 | 2 |
| export year: endofday (dates x12) | 12 | 6.7 → 6.3 | 8.2 → 11.8 | 48 | 298 | 313 | 10.5 | 4 |
| list /temperature/entries (this month) | 1 | 0.8 | 1.1 → 2.6 | 4 | 9 | 3,662 | 1.6 | 4 |
| list /cleaning/entries (this month) | 1 | 3.9 → 4.9 | 4.9 → 6.8 | 4 | 19 | 35,004 | 4.4 | 4 |
| list /daily-register/entries (this month) | 1 | 0.6 → 0.8 | 1 → 1.6 | 4 | 15 | 16 | 3.6 | 4 |
| list /dda-sales/entries (this month) | 1 | 0.6 → 0.8 | 0.9 → 1 | 4 | 20 | 21 | 6.4 | 4 |
| list /dda-poyc/entries (this month) | 1 | 0.5 → 0.6 | 1 → 0.7 | 4 | 6 | 7 | 1.1 | 4 |
| list /client-orders/entries (this month) | 1 | 1 → 1.4 | 1.4 → 1.5 | 4 | 27 | 28 | 18.7 | 4 |
| list /paid-out/entries (this month) | 1 | 0.6 → 0.7 | 0.8 | 4 | 12 | 13 | 2.9 | 4 |
| list /repeat-prescriptions/entries (this month) | 1 | 0.5 → 0.7 | 0.5 → 0.8 | 4 | 11 | 12 | 2.6 | 4 |
| list /returns/entries (this month) | 1 | 0.6 → 1 | 1 → 1.2 | 4 | 8 | 2,154 | 2.2 | 3 |
| list /locumregister/entries (this month) | 1 | 0.4 → 0.5 | 0.5 → 0.6 | 4 | 4 | 5 | 0.2 | 4 |
| list /near-expiry/entries | 1 | 3.7 → 2.7 | 7 → 3.9 | 4 | 271 | 1,617 | 95.9 | 2 |
| list /client-tickets/entries | 1 | 32.3 → 28.3 | 74.4 → 52.5 | 4 | 2,692 | 2,693 | 1245.9 | 2 |
| GET /audit/log 30 days (new screen default) | 1 | 5.5 | 8.7 | 5 | 104 | 205 | 74.8 | 6 |
| dupes: poct (patients only, after) | 1 | 10.4 | 15.1 | 4 | 3,003 | 3,004 | 377.6 | 2 |

Exact numbers the model cannot give:
- Audit trail, new screen (30 days by default): the page and its total now read the index range: **23,831 entries
  (30 days) / 5,313 (a week), against 600k table rows twice before.** The classic screen (no dates) still counts the
  whole group: ~600k index entries for the total, but no table rows, 390 → 55 ms.
- People search with the 15-name seed stops early on common names; the `xuereb` and card lines are the true worst
  case (every source read in full): **62,752 rows per keystroke**, before and after.

With 15 ms per D1 statement (`RTT_MS=15`, 10 runs):

| Call | before median (p95) | after median (p95) |
|---|---:|---:|
| GET /people?q=zam | 344 (424) ms | 139 (166) ms |
| GET /people?q=xuereb (nothing found) | 323 (367) ms | 165 (201) ms |
| GET /people?q=card | 338 (374) ms | 185 (213) ms |
| GET /people/:id timeline | 347 (386) ms | 188 (227) ms |

## 3. Screens (Chromium, real stack, big pharmacy)

| Screen | calls | before KB | after KB | statements | server ms before → after | wall ms before → after |
|---|---:|---:|---:|---:|---:|---:|
| Sign in to Today | 2 | 18.3 | 18.3 | 33 → 37 | 153 → 1,890 * | 207 → 1,940 * |
| Possible duplicates | 61 | 23,495 | 11,065 | 249 → 254 | 2,166 → 681 | 1,641 → 742 |
| Download our records, this year, all 15 registers | 367 | 8,131 | 8,131 | 1,493 | 1,294 → 948 | 5,460 → 3,548 (noise) |

\* One time only: the first request after the upgrade builds the two new indexes (0.9 s for 600k audit rows here;
live has ~6k audit rows, so milliseconds). Later sign-ins are as before.

## 4. Writes: what the waiting batch adds per save (big pharmacy)

| Write (big pharmacy) | live urls-1: statements / rows read / audit bytes | HEAD 7735d40 (the waiting batch) | after SCALE-2 | median ms (p95) live → HEAD → after |
|---|---|---|---|---|
| POST /dda-sales/entries | 6 (3 w) / 10,772 / 114 B | 7 (3 w) / 21,539 / 114 B | 7 (3 w) / 21,539 / 114 B | 8.3 (25.7) → 10.3 (23.1) → 13.6 (21.7) |
| PUT /dda-sales/entries/:id | 7 (3 w) / 10,773 / 114 B | 10 (3 w) / 21,542 / 937 B | 10 (3 w) / 21,542 / 937 B | 7 (9.7) → 13.1 (18.6) → 12.8 (18.7) |
| POST /client-orders/entries | 5 (2 w) / 5 / 83 B | 5 (2 w) / 5 / 83 B | 5 (2 w) / 5 / 83 B | 4.1 (5) → 4.5 (5.9) → 4.8 (5.4) |
| PUT /client-orders/entries/:id | 6 (1 w) / 7 / 0 B | 9 (2 w) / 9 / 902 B | 9 (2 w) / 9 / 902 B | 3.2 (5.3) → 5.3 (7.5) → 4.5 (5.8) |
| POST /cleaning/entries | 5 (2 w) / 5 / 107 B | 5 (2 w) / 5 / 107 B | 5 (2 w) / 5 / 107 B | 3.6 (8.3) → 3.9 (5.4) → 4.3 (8.5) |
| POST /temperature/entries | 8 (3 w) / 46 / 69 B | 10 (3 w) / 48 / 495 B | 10 (3 w) / 48 / 495 B | 5.7 (8.7) → 5.6 (6.5) → 5.2 (6.8) |
| POST /people | 7 (2 w) / 13,468 / 303 B | 7 (2 w) / 13,468 / 303 B | 7 (2 w) / 7 / 303 B | 20.6 (26.3) → 22.5 (27.6) → 4.7 (6.9) |
| PUT /poct/state (one test, new screen) | 6 (3 w) / 4 / 85 B | 8 (3 w) / 6 / 85 B | 8 (3 w) / 6 / 85 B | 6.6 (9.3) → 6.6 (11.4) → 7.8 (10.2) |
| POST /client-log | HTTP 404 | HTTP 429 | HTTP 429 | 0.7 (1.5) → 3.4 (6.2) → 3.5 (6.4) |
| PUT /labels/state (classic, whole history) | 8080 (8077 w) / 4 / 21 B | 8108 (8077 w) / 2,449 / 21 B | — | 20754.6 (21171.8) → 19720.1 (21190.3) → — |

`POST /client-log` accepted (first reports of a minute): 7 statements, 2 writes (a `login_attempts` row as the
rate-limit bucket, the `client_errors` upsert) and a `DELETE ... WHERE day < ?` (indexed). After 5 a minute it is 429
at 4 statements. Live answers 404 (3 statements).

What this says:
- **Full audit**: +1 to +3 primary-key reads per save (before/after snapshots), cheap. The audit row grows from
  ~70–115 B to ~500–940 B (EOD up to the 10 KB cap). At 1,000 audited saves a day that is ~0.9 MB/day, ~330 MB a
  year in the one shared D1 database (10 GB limit); worth a retention rule before it matters.
- **DDA saves read twice**: the batch's `ddaIdCardRewriteAudit` (code:8174, commit 2cc0c4d) reads the location's
  DDA lines by `upper(replace(client_id_card…))` before the old in-place rewrite does the same scan: 10.7k → 21.5k
  rows per DDA save at a big pharmacy (same pattern at POYC 8378 and daily register 8470). Not changed here: it is
  backlog item 2 (being merged with the ID-card work). Proposal there: one SELECT, then `UPDATE … WHERE id IN (found)`
  only when something was found: back to 10.7k and no write in the normal case.
- **Names on save**: a regex test of 34 rules per request; on a matching request one body parse. Not measurable on
  the simple saves. On the whole-state saves it reads the stored names of the items whose name would change (classic
  Smart labels, 8,077 labels: +28 statements, 2,449 rows).
- **Pre-existing, not the batch, but the biggest write found**: the classic Smart labels save rewrites the whole
  history one statement at a time: 8,077 writes, ~20 s locally for a big pharmacy. Cloudflare documents a cap on D1
  queries per Worker invocation (1,000 on paid plans, to verify), so beyond ~1,000 labels this save would fail on
  live. The new-layout labels screen sends only new labels and is fine.

## 5. Changes made (separate commits, all additive or same-answer)

| # | Commit | What | Evidence |
|---|---|---|---|
| 1 | People: ID-card lookups use the partial unique index | `AND id_card <> ''` on three people queries (search's "already a person" check, save's clash and find-by-card) so SQLite can use `idx_people_org_loc_idcard` | POST /people 13,468 → 7 rows, 22.5 → 4.7 ms; search −26.9k rows (the two chunked checks) |
| 2 | People search and timeline: the eleven history reads sent together | `Promise.all` over `PEOPLE_SOURCES`, results in the same order | identical response hashes on 10 searches/timelines; 15 ms RTT: 323–375 → 139–185 ms |
| 3 | Audit: index `audit_log (org_id, created_at, location_id, entity_type, action)` | in `ensureAuditSchema__impl` (schema marks re-run it once) | 30-day page 1.2M rows → ~24k index entries, 348 → 4 ms; no-date page 390 → 55 ms; no-date filter 310 → 114 ms. Variants (org_id, created_at) alone and (org_id, location_id, created_at) were tried and were slower on no-date or filtered pages (up to 1.6 s) |
| 4 | People: partial index on `merged_into` + alias reads as two indexed halves | `idx_people_merged_into … WHERE merged_into IS NOT NULL` (holds merged records only); `(id = ? OR merged_into = ?)` → `UNION ALL` | timeline −13,461 rows; merge then timeline identical before/after (hashes) |
| 5 | Possible duplicates reads POCT patients only | `GET /poct/state?part=patients` (records empty, same shape); dupreg asks for it; an older worker ignores the parameter and answers as today; UI .140 | that call 12,808 → 378 KB, 290 → 10 ms; the screen 23.5 → 11.1 MB |

Tests: worker 140 → 142 (two new in `tests/worker/scale2.test.mjs`; the POCT one fails on the old code as it should,
the merge one passes on both), UI suite 223/223. D1 parameter limit: the largest bound list in every measured call is
92 (the 90-chunk helper), so all under 100.

**Index rehearsal** (`scale2/rehearse.mjs`, scale DB, HEAD-batch worker → this tree, same session): 107/108 tables
byte-identical (only `eikon_schema`, the marks, changed), no new tables, nothing removed, exactly the two new
indexes added, 20/20 list reads return identical bodies. **Before deploying, run read-only on live**
`SELECT name, sql FROM sqlite_master WHERE tbl_name IN ('audit_log','people') AND type='index'`: round 3 said
production already has some audit index; if one already covers (org_id, created_at), drop change 3 rather than
keep two.

## 6. Still over 200 ms or 50k rows after this, proposed (not done)

| What | Now | Proposal | Why not done |
|---|---|---|---|
| People search per keystroke (picker in nine registers, Customers, search) | 62,752 rows worst case, 11 full location reads | Search the people table first and history only from 3 letters, or a window (2 years: about −60%), or item 12's link table (people_links) so history is joined, not searched | Changes who is found: John's call |
| Person timeline | 65,444 rows | Same as above; loyalty sum by `upper(replace(card))` cannot use its index (16,150 rows): store a normalised card | Behaviour/data change |
| DDA, POYC, daily-register save | 21.5k rows | Item 2 (see 4.) | Item 2 owns it |
| Audit trail, classic screen without dates | ~600k index entries for the total | Cap the total (`COUNT` over `LIMIT 10001`, "10,000+") or give the classic screen the new 30-day default | Visible change |
| Download our records, End of day | 1 call per day (~300 a year of the 367) | `GET /endofday/records?month=` | New endpoint + UI; small, next |
| Possible duplicates, rest | 11 MB: appointments `limit=5000` 2.6 MB, deliveries 2.0, orders 1.5, contacts 1.4, questions 1.2 | Names/cards/phones-only reads, or one server-side candidates endpoint | Larger |
| Today, cleaning list and cleaning export | 35k rows per call (SCAN) | Harness only: production has a cleaning index (round 3). Confirm with the read-only query above | Not needed if confirmed |
| Classic Smart labels save | 8,077 writes per save | Send only changed labels, as the new screen does | Pre-existing, classic |
| Timeline with many merged names | `IN` of all names; ~95+ names would pass 100 parameters and that source would silently be empty | Chunk or cap names | Unlikely today |

## 7. Files

`design/eikon-next/scale2/`: `app.mjs` (instrumented shim, `EIKON_TREE`, `RTT_MS`), `seed-base.mjs`, `seed_bulk.py`,
`rows.mjs`, `measure.mjs`, `writes.mjs`, `show.mjs` (one call's statements and plans), `same.mjs` (response hashes),
`merge.mjs`, `rehearse.mjs`, `screens.mjs`, `table.py`, `analyze.py` (round 3). Databases and raw JSON are in the
copy's `.scale/` (git-ignored, 8.8G of copies; safe to delete).
