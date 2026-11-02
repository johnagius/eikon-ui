# Eikon data-loading audit (speed and D1 rows read)

Local only: no request went to eikon-api.labrint.workers.dev or any Cloudflare API, nothing was pushed, and no file under `scratchpad/live` was changed (`git status` is clean). Line numbers point at the live-branch checkout (`live/`, commit 4366181): `code:` means `cloudflare-worker/code`, and `ui/...` means the front end.

## 1. Method

* **Stack.** `app.mjs` is a copy of `tests/worker/harness.mjs` `makeApp` with a file-backed SQLite D1 shim. It wraps every `prepare/bind/first/all/run/batch/exec` and tags each statement with the request it belongs to (AsyncLocalStorage). `server.mjs` serves `live/ui` and passes API calls to the real worker in-process. `audit.mjs` drives Chromium through Playwright: it blocks every non-localhost request and stubs `xlsx.full.min.js`. It logs in as maria@demo.mt, picks the **Pharmacy** portal (classic UI, which is the default because ui2 is opt-in through localStorage), then sets `location.hash` to each id in `window.EIKON.modules`. A screen counts as settled once no API request has been in flight for 1.2 s.
* **Data (`seed-base.mjs`, `seed_bulk.py`).** One org with 20 locations (Pharmacy 01 to 20). Maria's default location is **7**. Every module's GET was called once on an empty DB first, so the worker created its own tables. After that, about 1.9 M rows were bulk-inserted with SQL into the worker's real schemas (`big.db`, 412 MB). Org-wide totals, spread evenly over the 20 locations unless noted:
  temperature_entries 73,040 (2 devices × 20 locations × 1,826 days) · cleaning 35k · dda_sales 40k · dda_poyc 8k · dda_purchases 6k · daily_register 35k · repeat_rx 12k · paid_out 20k · returns 8k · alerts 3k · near_expiry 5k · client_orders 40k (2% open) · tickets 10k (3% open) · end_of_day 35k (realistic JSON blobs) · instructions_daily 30k · **audit_log 600k** · sync_jobs 40k · sessions 3k · login_attempts 20k · **pos_products 60k** (3k per location) · pos_sales 8k · supplier_products 2k (5 supplier locations) · quotations 25k · order_diary 20k · appointments 30k (+60 doctors, 40 clinics, 400 schedules, 2k waitlist) · shift_staff 160 · shift_assignments 114,724 (3 years) · leaves 3k · **poct_records 20,000 at location 7** (its "state blob") plus 19k elsewhere · poct_patients 3k · loyalty: 200 campaigns, 15k clients, 60k transactions · deliveries 15k · people 50k · contacts_clients 20k · stock_transfer_items 3k · scarce offers/needs 2k each · labels 30k · pv 600 · screening 200 · credit notes 5k · locum 8k · DDA stocktakes 400/8k.
* **Rows read (estimate).** `analyze.py` runs `EXPLAIN QUERY PLAN` on every SQL statement the worker actually executed, with its real parameters. Each step is costed as follows. `SCAN t` costs the size of t. `SEARCH` on an index that only constrains org_id/location_id costs the rows that location has in t. `SEARCH` with tighter constraints, or by primary key, costs the rows returned. `LIMIT 0` schema probes cost 0. This is an estimate of what D1 bills, not D1's own counter: it is accurate for scans and roughly a lower bound otherwise. "Rows returned" is measured exactly.
* **Timings** come from Node and in-process SQLite. They show *relative* cost and are not D1 latency, because real D1 adds a network round trip to every statement.

## 2. Measured: every pharmacy screen at future scale

The sorting is by response bytes. "Dup calls" counts the same URL fetched twice in one screen open. Settled ms is wall time from the hash change to the last API response.

| Screen | API req | Response KB | Slowest req ms | Settled ms | Rows read (est.) | Rows returned | Dup calls |
|---|---:|---:|---:|---:|---:|---:|---:|
| poct | 1 | 12,809.5 | 544 | 572 | 23,004 | 23,003 | 0 |
| dashboard (home, on boot) | 34 | 2,588.7 | 125 | 364 | 98,043 | 6,388 | 0 |
| order-diary | 3 | 1,819.9 | 39 | 93 | 7,763 | 3,260 | 0 |
| quotations | 2 | 1,819.6 | 23 | 59 | 7,758 | 3,256 | 0 |
| scarcestock | 2 | 1,474.3 | 99 | 163 | 17,018 | 4,012 | 0 |
| stocktransfers | 1 | 1,420.6 | 45 | 54 | 12,153 | 3,003 | 0 |
| loyalty | 4 | 1,141.9 | 40 | 54 | 3,870 | 3,866 | 0 |
| supplier-inventory | 3 | 1,073.5 | 22 | 65 | 4,012 | 2,009 | 0 |
| appointments | 5 | 844.7 | 29 | 142 | 1,645 | 1,640 | 0 |
| contacts | 10 | 832.7 | 58 | 94 | 9,290 | 9,280 | 0 |
| deliveries | 1 | 737.1 | 18 | 35 | 754 | 753 | 0 |
| clientorders | 37 | 559.5 | 12 | 123 | 872 | 822 | 1 |
| emergency-pos | 2 | 509.2 | 11 | 45 | 6,010 | 3,008 | 0 |
| tickets | 1 | 232.2 | 8 | 24 | 504 | 503 | 0 |
| labels | 1 | 146.9 | 8 | 19 | 1,505 | 1,504 | 0 |
| alerts | 1 | 97.1 | 3 | 11 | 154 | 153 | 0 |
| creditnotes | 1 | 83.6 | 10 | 22 | 432 | 430 | 0 |
| repeatprescriptions | 1 | 69.0 | 5 | 14 | 216 | 215 | 0 |
| shifts | 5 | 26.6 | 3 | 23 | 333 | 194 | 0 |
| screening | 1 | 21.7 | 3 | 15 | 14 | 13 | 0 |
| temperature | 3 | 18.3 | 2 | 37 | 7,462 | 79 | 0 |
| nearexpiry | 1 | 18.3 | 2 | 14 | 306 | 54 | 0 |
| messageboard | 3 | 17.8 | 35 | 57 | 114 | 59 | 0 |
| today | 1 | 14.6 | 29 | 66 | 35,859 | 115 | 0 |
| audit | 1 | 14.4 | 134 | 147 | 1,200,080 | 54 | 0 |
| customers | 1 | 12.4 | 7 | 16 | 2,504 | 33 | 0 |
| pharmacovigilance | 1 | 11.7 | 2 | 14 | 34 | 33 | 0 |
| dda-sales | 2 | 11.6 | 3 | 28 | 47 | 45 | 0 |
| dda_stocktakes | 2 | 2.9 | 2 | 21 | 50 | 28 | 0 |
| vaccines | 3 | 2.9 | 2 | 36 | 32 | 19 | 0 |
| certificates | 1 | 2.6 | 2 | 13 | 20 | 12 | 0 |
| dda-poyc | 2 | 2.1 | 4 | 45 | 16 | 13 | 0 |
| dailyregister | 1 | 0.6 | 2 | 12 | 6 | 5 | 0 |
| cleaning | 1 | 0.6 | 5 | 15 | 35,004 | 5 | 0 |
| returns | 1 | 0.5 | 2 | 17 | 404 | 4 | 0 |
| endofday | 4 | 0.2 | 2 | 177 | 22 | 12 | 1 |
| instructions | 2 | 0.0 | 1 | 20 | 9 | 6 | 0 |
| locumreceipts | 1 | 0.0 | 2 | 16 | 5 | 3 | 0 |
| pharmacycalc | 1 | 0.0 | 2 | 13 | 4 | 3 | 0 |
| dda-purchases | 1 | 0.0 | 3 | 22 | 5 | 3 | 0 |
| locumregister | 1 | 0.0 | 2 | 10 | 5 | 3 | 0 |
| paidout | 1 | 0.0 | 1 | 12 | 5 | 3 | 0 |
| ocps, otcmindmap, stock, registers, team, settings (hubs/static) | 0 | 0 | - | - | 0 | 0 | 0 |

Other measured facts:
* **Re-opening the dashboard costs the full fan-out again.** After visiting other modules, going back to `#dashboard` fired the same 34 calls (2.59 MB, about 98k rows est.). There is no client cache or ETag.
* `endofday` fetches `/endofday/record?date=today` twice. `clientorders` fetches the current month twice (a probe, then the same month again inside its 36-month window).
* `quotations` and `order-diary` each download the same `/supplier-products/inventory` (1.07 MB) and `/quotations/entries` (746 KB). `supplier-inventory` downloads the inventory again. Nothing is shared between modules.
* **POCT save.** I measured this separately with `poctput.mjs`: GET the 20k-record state, add one record, PUT. The request body was **6.6 MB**, the worker executed **20,005 statements (20,002 writes, one sequential `await` per record)**, and it took **65 s locally**. Each new reading rewrites the whole location history.
* **Login** (`POST /auth/login`, 6 statements) includes `DELETE FROM login_attempts WHERE attempted_at < …`, which is a full scan (no index on attempted_at alone). That cost 404 ms locally with 20k old attempts.
* **Cold isolate.** The first request to each module per isolate runs its CREATE TABLE/INDEX/ALTER statements. Boot alone ran **115 DDL statements out of 264 SQL statements** across its 34 calls. Contacts adds 28 `SELECT col FROM t LIMIT 0` probes (`code:19265`). Warm requests run 0 DDL, so the once-per-isolate rule holds, but every new isolate pays 100+ extra D1 round trips during the first dashboard load.
* **Every authenticated request costs 3 point lookups** (session⨝user, location, org: `code:1048, 1062, 1065`). That is 102 statements on boot just for auth.

## 3. Measured: boot-time calls (before any module is opened)

1. Login page: **0 API calls**.
2. Login: `POST /auth/login` (1 call, 224 B). Then the portal chooser, which makes no calls.
3. Clicking **Pharmacy** lands on `#dashboard` (classic, the production default) and fires **34 calls, 2.59 MB, settled in 364 ms locally, about 98k rows est.**:
   `/temperature/devices`, `/temperature/entries?month=11`, `/daily-register/entries?month`, `/paid-out/entries?month`, `/instructions/daily?month`, `/cleaning/entries?month=11` **and** `=10`, `/certificates/items`, `/alerts/entries` (all history, 97 KB), `/near-expiry/entries`, `/returns/entries` × **6 months**, `/client-orders/entries` × **6 months**, `/client-tickets/entries` (all history, 232 KB, used only to count open tickets), `/scarce-stock/needs` (620 KB, every org), `/stock-transfers/items` (**1.42 MB**, whole org, used only to count pending requests), `/board/dashboard`, `/supplier-products/changes`, `/supplier-orders/sent`, `/shifts/staff`, `/shifts/opening-hours`, `/shifts/settings`, `/shifts/leaves?year`, `/shifts/assignments` × 2 months.
   Rows-read breakdown: the two cleaning months account for 70k (full scans), stock-transfers 12k, scarce needs 8k, temperature 3.7k, returns 6 × 404.
4. With ui2 (`?ui=2`, Today as home), the same boot makes **1 call** (`/today`, 14.6 KB, 25 statements). A page reload with a stored token adds `GET /auth/me`.

## 4. Measured: polling (65–70 s idle on each screen)

| Screen | Interval | Calls per tick | Bytes per minute | Rows est. per tick | Stops when you leave? | Pauses when tab hidden? |
|---|---|---|---:|---:|---|---|
| today (`ui/modules.today.js:326`) | 60 s | 1 (`/today`) | 14.6 KB | 35.9k (cleaning scan) | yes (checks activeModuleId) | **no** |
| appointments (`ui/modules.appointments.js:853`) | 30 s | **5** (doctors, clinics, schedules, entries 794 KB, waitlist) | **1.69 MB** | 1.6k | yes (measured) | **no** |
| scarcestock (`ui/modules.scarcestock.js:279`) | 30 s | 2 (offers 854 KB + needs 620 KB) | **2.95 MB** | 17k, and the GETs also run expiry **writes** | yes | **no** |
| stocktransfers (`ui/modules.stocktransfers.js:169,1109`) | 30 s | 1 (1.42 MB) | **2.84 MB** | 12.1k, GET also writes | yes | **no** |
| messageboard (`ui/modules.messageboard.js:580`) | 30 s | 2 | 35 KB | ~110 | yes | **no** |
| supplier portal only (`ui/core.js:1403`) | 30 s | 2 | – | – | – | no |
| cherubino-* (org 12 only) | 5 min | 1 | – | – | yes | no |

The dashboard has no timer: 0 calls in 70 s idle. After every module had been visited, idling on Today produced only Today's own poll, so no timers leaked.

**Estimates per open tab per hour:** Today 2.15 M rows. Over an 8 h day across 20 pharmacies that is about 344 M rows/day, or about 10 B/month, from one Today tab per pharmacy, all of it from the unindexed cleaning scan. scarcestock 2.0 M rows and 177 MB. stocktransfers 1.46 M rows and 170 MB. appointments 0.2 M rows and 101 MB. Pricing as I know it (please verify): Workers Paid includes 25 B rows read and 50 M rows written per month, then $0.001 per M rows read and $1 per M rows written. The Free plan allows 5 M rows read per day. Bandwidth and latency matter more than read dollars here. Writes (POCT) and per-invocation query limits matter more than either.

## 5. Why: root causes on the heaviest routes

| # | Route / screen | Cause (from EXPLAIN on the executed SQL) | Where |
|---|---|---|---|
| A | `GET /poct/state` (12.8 MB, 23k rows, 544–779 ms) | Returns the location's **entire** history as `record_json` blobs with no LIMIT or date window. The UI keeps it all in memory | `code:10396`, `ui/modules.poct.js:122` |
| A′ | `PUT /poct/state` | UI sends every record on every save. Worker upserts each record with its own sequential `await …run()` and an unconditional `DO UPDATE` = 20k writes per save. This probably exceeds D1's per-invocation query limit (1,000 on Paid, as I recall; please verify), so saves at this scale would fail in production | `ui/modules.poct.js:170-181`, `code:10617-10632` |
| B | `GET /audit/log` (1.2 M rows est., 134 ms) | `audit_log` has **no index** (core table created outside the repo; harness reconstruction). Both the page query and the COUNT do `SCAN a` + temp B-tree sort over 600k rows | `code:14841`, `code:14867` |
| C | `/cleaning/entries`, `/today` | `cleaning_entries` has **no index at all**. The month query and Today's "last clean … LIMIT 1" both `SCAN cleaning_entries` (35k), and Today runs it every 60 s. Prototype index `(org_id,location_id,entry_date)` took the month query from 2.88 to 0.14 ms | `code:5312`, `code:15432` |
| D | dashboard boot (34 calls, 2.59 MB) | Downloads full lists to compute counts the server already computes in `/today`: tickets (all history), stock-transfers (whole org, `SELECT i.*`), scarce needs (all orgs), alerts (all), 6 × returns, 6 × client-orders | `ui/modules.dashboard.js:1297,1312,1324-1326,1336-1338,1355,1367,1395`; `/today` handler `code:15388` |
| E | `/stock-transfers/items` (1.42 MB) | `SELECT i.*` for the **whole org**, ordered, no LIMIT, closed history included (95% closed). Every GET also runs expiry UPDATEs | `code:11999`, `code:11976` |
| F | `/scarce-stock/offers`, `/needs` (854 + 620 KB) | `FROM scarce_stock_offers o … GROUP BY o.id` with **no WHERE**: every org, closed history, `SCAN`, temp B-tree. Each GET also does expiry writes and audit inserts | `code:11150`, `code:11503`, `code:11083` |
| G | clientorders (37 calls) | UI fans out one request per month for **previous, current and next year (36 months)** plus a probe. The worker only accepts `?month=` | `ui/modules.clientorders.js:429-436, 467-490`; `code:3403` |
| H | `/supplier-products/inventory` (1.07 MB, loaded 3×) | `SELECT sp.*` across **all orgs** (`WHERE 1=1`), no LIMIT, sorted with a temp B-tree. Quotations, order-diary and supplier-inventory each fetch it | `code:2868`; `ui/modules.quotations.js:1768`, `ui/modules.orderdiary.js:181` |
| I | `/quotations/entries` (746 KB, 2×) | `SELECT e.*` with all location history, no LIMIT | `code:2125-2137`; `ui/modules.quotations.js:429`, `ui/modules.orderdiary.js:168` |
| J | `/appointments/entries` (794 KB, every 30 s) | `SELECT *`, no date window, default `LIMIT 5000` with `ORDER BY date ASC`. Once a location passes 5,000 appointments, the **newest are silently dropped** (correctness bug) | `code:14340`, `code:14361`; `ui/modules.appointments.js:717, 853` |
| K | `/loyalty/transactions` (1.04 MB) | `SELECT *` with all history, `LIMIT 5000`, `ORDER BY created_at` (not indexed, so temp B-tree over all location rows). `?month=` exists but the UI does not send it | `code:18027`; `ui/modules.loyalty.js:134` |
| L | `/client-deliveries/entries` (737 KB), `/client-tickets/entries` (232 KB) | All history, no LIMIT, CASE-based ORDER BY so a temp B-tree is needed | `code:7346`, `code:3867`; `ui/modules.deliveries.js:259` |
| M | `/contacts/clients/aggregated` (570 KB, 8.3k rows) | Five unbounded selects over orders, tickets, deliveries, DDA sales and POCT patients, merged in JS on every open | `code:17363-17400`; `ui/modules.contacts.js:1182` |
| N | `/temperature/entries?month` | Only index is UNIQUE(org,loc,**device**,date), so the date range cannot be used and each month call reads all ~3.7k rows for the location | `code:1700` |
| O | `/returns/entries?month` (×6 on boot) | `entry_date LIKE '2026-10-%'` is not sargable, so it reads every row for the location (404) per call | `code:7020-7022` |
| P | `/emergency-pos/catalog` (509 KB) | Pages through the whole 3k catalog (`OFFSET`) on every open. `pos_catalog_meta.last_upload_at` exists but is not used as a cache key | `code:18730-18734`; `ui/modules.emergencypos.js:366` |
| Q | `/labels/state` (147 KB), `/alerts/entries` (97 KB) | All history as JSON blobs / `SELECT *`, no LIMIT | `code:19142`, `code:6808` |
| R | per request | 3 auth lookups. `sessions.token_hash_b64` is indexed only in the harness, so its production index is unknown | `code:1048-1065` |
| S | cold isolate | 115 DDL statements on the first dashboard load (`ensure*Schema` per module, contacts LIMIT 0 probes) | e.g. `code:1517`, `code:19265` |

No N+1 loops on reads: offers, requests and needs use `IN (...)` batches. The N+1 is on the POCT write path (A′).

## 6. Ranked fixes (not implemented)

The gains below are estimates derived from the measurements above, per screen open unless stated. "Safe" means small, local and easy to revert. "Risky" means it changes an API contract, behaviour or data.

| Rank | Fix | Estimated gain | Where | Risk |
|---|---|---|---|---|
| 1 | Add indexes: `cleaning_entries(org_id,location_id,entry_date,time_in)`, `audit_log(org_id,created_at)`, `temperature_entries(org_id,location_id,entry_date)`. As a one-off D1 migration, or inside an existing once-per-isolate ensure. First check what production actually has (`SELECT sql FROM sqlite_master WHERE type='index'`; not run here) | Today −35k rows/tick (≈ −2.1 M rows/h/tab), boot −70k, audit −1.2 M → ~10k, temperature −3.6k per month call. Audit 134 ms → <1 ms locally | `code:5312, 15432, 14841, 14867, 1700` | **Safe/small** |
| 2 | Point the classic dashboard at `/today` (or a `/dashboard/summary` with the same counts) instead of 34 list fetches | 34 → 1–3 calls, 2.59 MB → ~15 KB, ~98k → <1k rows. Same again on every return to home | `ui/modules.dashboard.js:1240-1470` | Medium (UI only; check that every tile's number matches) |
| 3 | POCT: return a window (e.g. last 90 days + `?before=` paging, or summary columns instead of `record_json`). Save only changed records (`PUT /poct/records` delta) and batch the upserts with `DB.batch` | GET 12.8 MB → <0.5 MB, 23k → ~1k rows. Save 20k writes → 1, 65 s → ms. Removes the per-invocation query-limit failure | `code:10396, 10617-10632`; `ui/modules.poct.js:122,170-181` | **Risky** (data-loss sensitive; the merge/delete semantics were recently fixed) |
| 4 | Stock transfers / scarce stock: filter `is_closed=0` (closed history on demand), scope scarce stock to the org (or confirm cross-org is intended), select only needed columns, move expiry writes out of GET (cron) | 1.42 MB → ~70 KB and 12k → ~600 rows; 1.47 MB → ~80 KB and 17k → ~200 rows. Multiply by 120/h while polling. Removes writes on GET | `code:11999, 11976, 11150, 11503, 11083` | Medium |
| 5 | Pause polling on `document.hidden`, and on appointments refresh only `/entries` for the visible week (doctors, clinics and schedules rarely change) | Hidden tabs → 0. Appointments 1.69 MB/min → <50 KB/min | `ui/modules.today.js:326`, `appointments.js:853`, `scarcestock.js:279`, `stocktransfers.js:1109`, `messageboard.js:580` | **Safe/small** |
| 6 | Client orders: one request (`?from=&to=` or `?fulfilled=0` + recent months) instead of 37 | 37 → 1–2 calls, 37 × 3 auth lookups saved, settle 123 ms → ~15 ms | `ui/modules.clientorders.js:429-490`, `code:3403` | Small (worker accepts a range; UI change) |
| 7 | Appointments: default to a date window (e.g. today−30 to +90) and fix `ORDER BY date ASC LIMIT 5000` | 794 KB → ~100 KB per tick; prevents dropping new appointments | `code:14340-14361`, `ui/modules.appointments.js:717` | Small; **correctness bug** |
| 8 | Supplier inventory: scope it, page it, explicit columns, and cache it once per session (shared by quotations, order-diary and supplier-inventory) | Up to 3 × 1.07 MB → 1 × (paged) ~100 KB | `code:2868`; `quotations.js:1768`, `orderdiary.js:181` | Medium (cross-org visibility is deliberate) |
| 9 | Window the history lists: quotations, loyalty transactions (`?month=`, index `txn_date`), deliveries, tickets, labels, alerts (open + recent, with "load more") | ~3.8 MB → ~0.3 MB across 6 screens, ~8k → ~1k rows | `code:2125, 18027, 7346, 3867, 19142, 6808` | Medium (UI expects the full list for client-side search) |
| 10 | Returns: replace `LIKE 'YYYY-MM-%'` with a range (and alerts `substr()` likewise) | 404 → ~5 rows per call (×6 on boot) | `code:7020-7022`, `code:6804` | **Safe/small** |
| 11 | Emergency POS: cache the catalog in IndexedDB keyed by `pos_catalog_meta.last_upload_at`, and skip the download when unchanged | 509 KB / 6k rows → ~0.2 KB per open | `ui/modules.emergencypos.js:366`, `code:18718-18734` | Small |
| 12 | Contacts aggregated: build it on write (people table already exists) or page it | 570 KB / 8.3k rows → small | `code:17363-17400` | Medium |
| 13 | Drop duplicate calls (endofday record ×2, clientorders probe, quotations/inventory shared cache) | 3–4 calls per open | `ui/modules.endofday.js:623/664`, `clientorders.js:473` | Safe/small |
| 14 | Auth: fold location and org lookups into the session JOIN, and confirm the `sessions(token_hash_b64)` index exists in production | 3 → 1 statement per request (−68 on boot) | `code:1048-1065` | Small |
| 15 | Schema: gate all `ensure*Schema` behind one `schema_version` row so a cold isolate does 1 read instead of 115 DDL statements | −115 round trips per cold isolate | `ensure*Schema` functions (e.g. `code:1517`, `19265`) | **Risky** (migrations then need discipline) |
| 16 | Index `login_attempts(attempted_at)`, or prune less often | Login −20k-row scan | `code:1381` | Safe/small |

## 7. Measured vs estimated, and caveats

* **Measured locally:** request counts, response bytes, rows returned, statement counts, DDL counts, per-request and settle times, poll intervals and payloads, and the POCT PUT statement count and time.
* **Estimated:** rows read (EXPLAIN-based model), per-hour and per-month totals, all "gain" figures, and the D1 limit and pricing numbers (from memory; please verify).
* **Production indexes on the 11 core tables are unknown.** The harness reconstructs them and only creates `idx_sessions_token` plus the UNIQUE constraints. If production already has cleaning, audit_log or sessions indexes, fixes 1 and 14 shrink. Check with a read-only `sqlite_master` query, which I did not run.
* Data is spread evenly across 20 locations, apart from POCT (20k at the user's location). A bigger-than-average pharmacy scales the location-scoped numbers linearly. Org-wide routes (stock transfers, audit, scarce stock, supplier inventory) scale with the whole org.
* Seeded column values are synthetic. Byte counts per row are realistic for the shape, not the content.

## 8. Files

All in this folder: `app.mjs`, `server.mjs` (instrumented stack), `seed-base.mjs`, `seed_bulk.py` (seeding), `audit.mjs` (Chromium driver; `IDLE_ON`, `UIQ` env), `analyze.py`, `showroute.py` (EXPLAIN and rows model), `poctput.mjs`. Results: `big.json` / `big.records.json` (full run with every SQL statement), `analysis.json`, `analysis_records.json`, `analysis.txt`, `poll.json` (polling), `ui2.json` (Today-home boot), `empty.json` (empty-DB baseline). Databases: `base.db`, `schema.db`, `big.db` (seeded), `run.db` (copy used by the main run; plans were taken against it).
