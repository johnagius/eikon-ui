# Tests

Two harnesses, no dependencies beyond Node 22 and the Playwright that is
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

- `d1shim.mjs`: the D1 look-alike (`prepare().bind().first()/all()/run()`, `exec`, `batch`).
- `harness.mjs`: loads the worker, creates the eleven core tables the worker
  expects to pre-exist, and provides `api()`, `bootstrap()` and `addUser()`.
- `*.test.mjs`: the tests. `fixes.test.mjs` holds the regressions for the live
  defects listed in `design/eikon-reimagined/RELIABILITY-AND-SPEED.md` §1.

## UI (`tests/ui/`)

Serves `ui/` with a mock API and drives it with Chromium. Checks that every
module renders without a page or console error, then runs targeted
regressions (toast exists, bearer token redacted from debug logs, blank fridge
readings refused, POYC defaults to today, DDA purchase delete confirms in-app,
DDA report escaping).

```bash
node --no-warnings tests/ui/run.mjs
```

## Safety

Nothing here touches a real database or the deployed worker. The UI harness
intercepts every network call; the worker harness uses `:memory:` SQLite.
