# Tests

Three harnesses, no dependencies beyond Node 22 and the Playwright that is
pre-installed in the cloud container.

## Worker (`tests/worker/`)

Runs the real `cloudflare-worker/code` under Node with an in-memory SQLite
standing in for D1. Every test gets a fresh database and a bootstrapped
pharmacy admin session, and talks to the worker through real `Request`
objects, so what passes here is what the deployed worker does.

```bash
node --no-warnings tests/worker/run.mjs
```

Pass a substring to run a subset: `node --no-warnings tests/worker/run.mjs "end of day"`.

The UI suite (`tests/ui/run.mjs`) also drives the Customers screen against a mock of
the people routes: hand-over from Today's search, adopt from history, versioned edit
refused with the other version shown, carry into a register.

`people.test.mjs` covers the shared people lookup (search across history, upsert by
ID card, optimistic versions, timeline, merge, backfill and location isolation).

- `d1shim.mjs`: the D1 look-alike (`prepare().bind().first()/all()/run()`, `exec`, `batch`).
- `harness.mjs`: loads the worker, creates the eleven core tables the worker
  expects to pre-exist, and provides `api()`, `bootstrap()` and `addUser()`.
- `*.test.mjs`: the tests. `fixes.test.mjs`, `state-merge.test.mjs`, `auth.test.mjs`
  and `stock.test.mjs` hold the regressions for the live defects listed in
  `design/eikon-reimagined/RELIABILITY-AND-SPEED.md` §1; `speed.test.mjs` guards
  the once-per-isolate schema rule.

## UI (`tests/ui/`)

Serves `ui/` with a mock API and drives it with Chromium. Checks that every
module renders without a page or console error, then runs targeted
regressions (toast exists, bearer token redacted from debug logs, blank fridge
readings refused, POYC defaults to today, DDA purchase delete confirms in-app,
DDA report escaping).

```bash
node --no-warnings tests/ui/run.mjs
```

## Real stack (`tests/real/`)

The regression gate for screens that write. One process starts the real worker on an in-memory SQLite
(`tests/worker/harness.mjs`) and serves `ui/` on one port (`REAL_PORT`, default 8895), seeds once, and drives
Chromium (every request that is not to localhost is aborted; email providers are stubbed). For each new-layout
screen that writes (`tests/real/cases/*.mjs`: Orders, Questions, Deliveries, Daily register, Locum, DDA sales,
purchases and POYC, Repeat Rx, Temperature via Today, Cleaning, Paid out, Locum receipts, End of day, Credit notes,
POCT, Vaccines, Emergency POS, Labels, DDA stock-takes, Customers + New) it types the same input into the classic
screen and the new one (Vaccines: the classic body through the API; Customers has no classic screen), reads both
stored rows from the database and compares every column. Only the row's id and clock columns, plus differences
listed in the case with the reason (a generated code, a sequence number), may differ; differences found and not yet
fixed are listed as `KNOWN` in the tail instead of failing. The `correct-*` cases (run after the others, as they add
lines to the same tables) correct a line on each register through the pharmacist's Correct: no reason sends nothing,
the stored row changes only in the corrected columns, the audit entry has the reason with the row before and after,
a twin line changed with the classic edit body is stored the same, a line changed elsewhere meanwhile is refused with
both versions shown, and staff see no Correct (End of day: a locked day unlocked, corrected and locked again). It prints one line per case and a tail ending
`real: N passed, M failed`, and exits non-zero on a failure. About 30 seconds with 4 parallel cases.

```bash
node --no-warnings tests/real/run.mjs              # all cases
node --no-warnings tests/real/run.mjs ordreg eod   # cases whose file name contains a word
REAL_JOBS=1 REAL_NOTES=1 REAL_VERBOSE=1 REAL_SHOTS=/some/dir node --no-warnings tests/real/run.mjs   # serial, notes, logs, screenshots on a stuck save
```

Run it before shipping any UI or worker change, with the worker and UI suites.

## Safety

Nothing here touches a real database or the deployed worker. The UI harness
intercepts every network call; the worker harness and `tests/real` use `:memory:` SQLite.
