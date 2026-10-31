# Audit template (one section per module, in this exact shape)

## <Module title>  (`modules.<file>.js`, id `<id>`, order <n>, visible to: <roles / org restriction / admin-only parts>)
**Purpose.** One sentence.

**Functions.** A numbered, exhaustive list. One line each, in the form:
`n. <What the user can do> — where: <tab / button / modal / context menu / keyboard>; API: <METHOD /path>; extras: <print / CSV / xlsx / email / SMS / WhatsApp / PDF / label>`
Include: every view/tab, filter, sort, search, create/edit/delete, status change, lock/unlock, bulk action, import, export, print, settings, admin-only action, keyboard shortcut, auto-refresh/polling, quick-entry entry points from other modules, and anything triggered automatically (timers, on-load side effects).

**Data & state.** Endpoints and tables touched; localStorage keys; offline queues; polling intervals; cross-module calls (functions on window.EIKON used by or exposed to other modules).

**Permissions & scoping.** Admin-only, superuser-only, org/location scoping, role checks done client-side only (flag these).

**Edge cases & risks (found in code, cite line numbers).** Concurrency (two PCs editing the same record), date/timezone, month boundaries, offline/network failure, validation gaps, destructive actions without confirm, silent catch blocks that hide errors, client-side-only permission checks, N+1 fetches, large payloads, polling cost, anything that could lose or duplicate data.

**Speed notes.** Approximate payload per load, number of requests, sequential awaits that could run in parallel, re-render cost.

**Must not be lost.** 3 to 8 bullets: the functions a pharmacist or inspector would miss if the module were rebuilt and these were dropped (legal, money, safety).
