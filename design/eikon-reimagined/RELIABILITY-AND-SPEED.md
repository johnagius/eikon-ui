# Eikon: reliability, speed and edge cases

The rebuild brief has three promises: keep every function, make it faster, make it
more reliable. This document is the engineering half of that promise. It is built
from the nine audit reports in `audit/` (eight module groups and the worker), each
of which cites file and line. Where a number appears here it comes from one of
those reports or from the measured first screen (see the Design review).

Short version. The product has 53 modules, 333 worker routes and about 100 tables,
and it works. But it was built as 53 separate apps sharing a token. There is no
shared idea of a customer, a drug, a date, a print, a save, a role or a version.
That is why the same bug appears in ten places and why two PCs in one pharmacy
cannot trust each other. The rebuild fixes the ten shared things once, in the
worker, before any new screen is drawn. Then the screens become simple because
the hard parts are no longer their job.

---

## 1. Fix before anything else (security and data loss, live today)

These are not design questions. Each is live in production and each is a few
hours of work. Do them on the current code base this week, independent of the
rebuild. Status is kept current here; the regression tests live in `tests/worker/` and `tests/ui/`.

| # | What | Where | Why it cannot wait | Status |
|---|---|---|---|---|
| 1 | Unauthenticated calendar endpoint leaks every pharmacy's valid tokens and rosters when given an unknown token with `debug=1` | worker 13498–13529 | Anyone on the internet can read staff names and shift times for all pharmacies  Fixed, tested |
| 2 | Debug mode forced on for every production visitor; at that level the Authorization header is logged and every log line is posted to the embedding page with target origin `*` | `godaddy-loader-htmlcode:77`, `core.js:165–191, 264–268` | Bearer token and patient-bearing payloads handed to whatever page embeds the app  Fixed (loader no longer forces debug; token redacted; logs only to the known parent origin) |
| 3 | End Of Day lock undone by a plain Save from another PC (every payload carries `locked_at:""`, which the worker reads as an unlock) | `endofday.js:1824, 1871`; worker 4142–4182 | The one money record that is supposed to be final is not  Fixed, tested (unlock must be explicit; client never sends an empty locked_at) |
| 4 | Whole-state replace on POCT, screening, pharmacovigilance and labels: the last PC to save deletes every record it had not loaded | worker 10595–10612, 18296–18307, 18378–18389, 18483–18494 | Clinical results silently deleted in any pharmacy with two PCs  Open (next) |
| 5 | Hard-coded shared passwords for locum receipt edit and report, in shipped JavaScript and in the worker, same for every pharmacy | `locumreceipts.js:929, 1057, 1094`; worker 5662–5663 | Not a control at all  Open (next) |
| 6 | No logout on the server; 30-day tokens in localStorage stay valid after "Logout"; expired sessions never purged | worker 1401; `core.js:1199–1211` | Shared counter PCs  Fixed, tested (`POST /auth/logout`, expired sessions purged) |
| 7 | Printed DDA reports do not escape names (escape function is a no-op) | `ddasales.js:157–161`, `ddapoyc.js:38–42` | Broken inspector print and stored script execution in a same-origin page that can read the token  Fixed, tested |
| 8 | Cross-month early-resupply check in DDA Sales never runs (references an out-of-scope variable, error swallowed) | `ddasales.js:132–154` | A controlled drug supplied on the 28th and again on the 3rd is not flagged  Fixed |
| 9 | DDA POYC "New Entry" defaults the date to the 1st of the month | `ddapoyc.js:1810–1812` | Systematic mis-dating of a controlled-drug register  Fixed, tested |
| 10 | Blank fridge reading saved as 0 °C from the dashboard quick entry | `dashboard.js:1566–1570` | False readings in a legal log  Fixed, tested |
| 11 | DDA purchase delete skips confirmation inside the sandboxed iframe (confirm throws, catch sets ok) | `ddapurchases.js:841` | One click deletes a controlled-drug receipt  Fixed, tested |
| 12 | Login has no brute-force limit; recovery limiter is keyed by target email; recovery page confirms account existence | worker 1160–1198, 1367–1433 |  Open |
| 13 | Appointments silently truncated at 500 rows; loyalty balances summed over the newest 500 transactions | worker 14282, 17349; `loyalty.js:1097–1121` | Future bookings vanish from the calendar; loyalty cards reset  Open |
| 14 | Supplier catalogue import is delete-all then insert with no transaction, resets out-of-stock flags and reissues every product id | worker 2712–2755 | A failed import wipes the catalogue; carts and orders point at dead ids  Open |
| 15 | Cherubino OOS "Keep OOS" sends the `reject` action, which the worker implements as delete | `cherubino-oos.js:256`; worker 17882–17886 | The button does the opposite of its label  Fixed, tested |
| 16 | Warehouse short-expiry upload has no server-side role check and wipes the whole list plus every branch's orders, non-transactionally | `cherubino-shortexpiry.js:445`; worker 17740–17770 | Any branch login can erase the group's data  Fixed, tested |
| 17 | `E.toast` is never defined, so every Cherubino module and Near Expiry show no confirmation, warning or error, and the two-click delete pattern deletes on the second click with no visible warning | `cherubino-orders.js:513–531`, `cherubino-oos.js:390–404`, `nearexpiry.js:288–693` | Silent destructive actions  Fixed, tested (one toast in core) |
| 18 | Scarce stock: a mere request (no accept step, no quantity cap) runs a depletion cascade that deletes the linked near-expiry entry, returns entry and transfer item; nothing is restored if the request is deleted | worker 10951–11018, 11170, 11355–11374 | One click from another pharmacy destroys three of your records  Open |
| 19 | Emergency POS catalogue import is fire-and-forget: wipes on the first chunk, never resets, never reloads, progress element id mismatch, retry branch dead | `emergencypos.js:561–779` | The till keeps selling from the old list after a "successful" import  Open |
| 21 | Saving a new End Of Day binds `null` into two NOT NULL columns (bag number, notes), so the worker throws a 500 whenever the bag number is empty | worker 4232–4272 | Found by the test harness on the first run | Fixed, tested |
| 20 | Emergency POS completes a sale with tendered below total and stores VAT computed before the discount | `emergencypos.js:170–185, 452–521` | Wrong money and wrong VAT on the record  Open |

---

## 2. The ten shared things, built once

Every module today solves these ten problems its own way, which is why 53 modules
contain 735 inputs and 211 modals and still disagree with each other. The rebuild
puts each one in exactly one place, server-side where it matters.

### 2.1 One save model: optimistic concurrency, never "Saved" before the server says so

Today: every PUT is a full-row overwrite with no version (worker §6). Shifts
reports success on failure (`shifts.js:242–244`). Loyalty writes localStorage
first and fires the POST without waiting (`loyalty.js:1270–1274`). End Of Day and
Paid Out switch to browser-only storage after one error and keep showing "Saved"
(`endofday.js:646–657`, `paidout.js:224–232`). Three customer modules strand
offline writes in localStorage forever (`clientorders.js:298–386`).

Rule: every row carries `version`. Every PUT sends `If-Match: version`. The worker
returns 409 with the current row on mismatch and the UI shows the two side by
side. The UI never says "Saved" until the 2xx arrives. Offline is one shared queue
(not nine), keyed by user and device, visible in the rail as "Working alone since
09:12 · 3 entries waiting", replayed automatically when the network returns, with
server-side idempotency keys so a replay can never duplicate. The emergency POS
already does idempotency correctly with `offline_id` (worker 17995, 18184); copy
that pattern, delete the other eight.

### 2.2 One identity for a person

Today a customer exists as free text in at least nine tables (orders, tickets,
deliveries, appointments, waitlist, loyalty, repeat prescriptions, POCT, DDA sales,
pharmacy calculators, contacts). Only loyalty and POCT normalise the Maltese ID
card. The same person is typed three times a week.

Rule: one `people` table per org+location keyed on the normalised ID card, with
name, phone, email, address, doctor and consent flags, and an alias list for
merges. Every record that names a person stores `person_id`. The Customers screen
is a view over this table. Master Universal patients join it through the shared
book (§5). The existing read-only aggregated contacts endpoint (worker 16683) is
the seed.

### 2.3 One identity for a product and a controlled drug

Today Purchases, Sales, POYC and Stock Takes use three different free-text drug
vocabularies and no balance can exist (`audit/E-registers.md` C4). Stock modules
match products by description text.

Rule: one `products` table with a per-location DDA flag, strength and form. DDA
registers store `product_id`. The worker computes the running balance per
controlled drug after every receipt, supply and count, and the stock take shows
expected against counted with the discrepancy. This is the single largest legal
gap in the product and it cannot be fixed in the UI.

### 2.4 One register model: append-only with visible corrections

Today every legal register row is edited in place and hard-deleted by any staff
member for any date, audit rows store a subset of fields with no before-image,
and nothing is locked (`audit/E-registers.md` C2). "Closed" stock takes stay
editable (worker 9204–9285).

Rule: registers are append-only. A correction is a new row that supersedes the
old one, with a reason, and the print shows the old line struck through. Entries
carry `entered_at` as well as `entry_date`, so a late entry is visible. A closed
stock take and a locked End Of Day refuse writes with 409. Unlock is a
supervisor action with a reason and its own audit row. This is what the inspector
expects of a paper book and it is what the screen mockups show.

### 2.5 One audit log with before and after

Today `audit_log` has no location, no before-image, no device, and is not written
for POCT, supplier products, client order updates, ticket updates, instructions,
calculators, shifts assignment updates or any board write (worker §6).

Rule: every write goes through one function that records org, location, user,
device, action, entity, before, after and the request id, in the same batch as
the write. The Audit register in the UI is a view over it, filterable by person
and by register.

### 2.6 One role model

Today `requireRole(["admin","staff"])` is checked in about 150 handlers but the
only roles that exist are `admin` and `user`, so every working pharmacy login is
an admin and the admin-only guards separate nobody (worker 779, 848, 1020).
Portal type is inferred from `location_id` ranges in both browser and worker.
The superuser email is a constant in the client.

Rule: roles are `pharmacist`, `staff`, `locum`, `supplier`, `owner`, `superuser`,
stored on the user, enforced in one middleware, and the UI receives the list of
permitted actions with the session so it never shows a button that will 403.
Locum receipt passwords become a permission. Portal type is a property of the
account, not a number range.

### 2.7 One clock

Today "today" is local in the dashboard, UTC in instructions, UTC in the admin
overview's worker half and local in its browser half; SQLite UTC strings are
displayed as local in audit, stock takes and supplier screens; the delivery
default date is UTC; public holidays are hard-coded for 2025 and 2026 in three
different lists (`dashboard.js:466`, `shifts.js:268`, `locumreceipts.js:56`).

Rule: the pharmacy has one timezone (`Europe/Malta`) stored on the location. The
worker stores UTC instants plus the local business date it was told. Every date
shown is formatted through one helper. Public holidays are a table with Good
Friday and Easter computed, reviewed once a year in Settings.

### 2.8 One print pipeline

Today prints are `window.open` plus `document.write` in some modules, blob URLs
in others, auto-close on `afterprint` (which also fires on cancel) in some,
popup-blocked silently in others, and the Smart Labels preview differs from what
prints (Maltese never prints, `labels.js:297`). Only DDA stock takes render on
the server.

Rule: every printable thing is rendered by the worker as HTML with its own
`@page` size, identical on every PC, opened in one way, never auto-closed, and
stamped with who printed it and when. Labels print exactly what the preview shows.

### 2.9 One reference-data store with a review date

Today the OCP list (21 products), levothyroxine strengths, the MedDRA subset, 20
warning phrases, 13 frequency phrases, vaccine country lists, the OTC graph,
holiday tables, POYC and DDA drug lists, specialist taxonomy and emergency numbers
all live in code (`audit/C-clinical.md` cross-cutting 2).

Rule: one versioned table per list, editable by the superuser, with "last reviewed
by, on" shown wherever the list is used. The UI loads lists from the worker, with
a version in the URL so caches work.

### 2.10 One way to talk to the server

Today three copies of `apiJson` hunt for the token in five localStorage keys
(`audit/E-registers.md` C8); `E.showToast` is referenced in six modules and defined
in none; one module's global `unhandledrejection` handler relabels every other
module's errors as "Appointments error" (`appointments.js:17–25`); polling timers
are never cleared on navigation.

Rule: one client, one toast, one error path, one lifecycle (mount, unmount), and
no module-level global listeners.

---

## 3. Speed

### 3.1 What a page load costs today

| Step | Today | Rebuild |
|---|---|---|
| Intro overlay | 4,930 ms minimum before anything renders | none |
| Script loading | 52 files, strictly sequential, each with `?v=Date.now()` so neither the browser nor the Worker cache ever hits; about 3.4 MB fetched from raw.githubusercontent.com on every load; SheetJS from a third-party CDN inside the mandatory chain | one versioned bundle per destination, long-cache headers, loaded in parallel, SheetJS only when an import starts |
| Auth | 3 D1 queries per request | 1 query, session row carries org and location |
| Schema | every handler re-runs its DDL per request; about 200 DDL statements and 35 deliberately failing ALTERs per dashboard load | migrations run once at deploy |
| First screen | 35 requests, several unbounded, two with write side effects | one `GET /today` |

### 3.2 The Today endpoint

The dashboard recomputes "what needs you" in the browser from month dumps. The
rebuild moves that to one worker call that returns the ordered list for the
screen: registers not yet filled today per device, cleaning overdue, certificates
due in 30 days, customers waiting (ready orders, open questions, bookings),
stock short, team on shift, handover, takings so far. One request, a few
kilobytes, cached for ten seconds, invalidated by writes. Every row carries its
action endpoint so the button needs no module code.

**Status:** `GET /today` exists on the branch (worker, read-only, tested). It returns
`before_opening` (one row per active fridge or room with yesterday's reading, limits,
today's reading and an inline `action`; the daily register; cleaning with days since),
`customers_waiting` (open orders by priority and need-by date, then open questions with
days waiting), `attention` (certificates expired or due within 30 days, open recalls with
steps left, returns awaiting paperwork, expired and expiring stock), `takings`, `stock`,
`team` (who is on today, yesterday's handover, today's notes) and `counts`. Every section
is guarded, dates are the pharmacy's local date, and the response carries a ten-second
private cache. The Today screen can now be built as a list over this one call.

### 3.3 Reads

- Lists are paginated with cursors and a server-side search parameter. The
  present caps (500 appointments, 200 vaccine orders, 1,000 credit notes, 2,000
  deliveries, 500 loyalty transactions) silently hide data and go away.
- Month-scoped registers stay month-scoped. The POCT, labels, screening and
  pharmacovigilance "whole state" blobs become normal paginated rows.
- Autocomplete gets dedicated endpoints (people, doctors, products). POYC
  today fans out up to 18 month queries per typed prefix (`ddapoyc.js:1066`).
- Client Orders loads 37 requests per refresh (`clientorders.js:430–517`); the
  server already supports the filter it needs.

### 3.4 Writes

- A day's fridge readings is one request, not one per device.
- Bulk imports (quotations, supplier catalogue, contacts) are one batched write
  in a transaction, with a preview that cannot fire twice (the quotations preview
  re-binds its click handlers on every re-render and uploads k+1 times,
  `quotations.js:1274–1341`).
- Every multi-row write uses `env.DB.batch()`.

### 3.5 Polling to push

Today appointments, scarce stock, message board, supplier screens and core each
poll every 30 seconds, often twice, and never stop when the user leaves. The
rebuild uses one delta endpoint (`GET /changes?since=seq`) that the shell polls
every ten seconds, which also drives the Master Universal book (§5). Each write
bumps a per-location sequence; the response says which screens are stale.

### 3.5a Done so far on the current code (measured with the test harness)

| Change | Before | After |
|---|---|---|
| Schema DDL per request | every handler re-ran its CREATE/ALTER statements | once per isolate per database (`schemaOnce`); a failed run is retried on the next request |
| D1 statements for a 23-request dashboard-equivalent load | 230 (118 of them DDL) | 100 on a warm isolate (0 DDL) |
| Script loading | 52 files one after another, `?v=Date.now()` on each | all files requested at once, executed in order, one `BUILD` stamp in `index.html` so browser and edge caches work; bump `BUILD` on deploy |
| SheetJS | inside the mandatory boot chain, from a third-party CDN | loaded in the background; a failure disables imports until reload instead of taking the app down |
| API client | no timeout, no retry, 401 shown as an error on every screen | 20 s timeout, one retry for reads on network errors and 502/503/504, a 401 shows sign-in once, keeps the place and returns to it after sign-in |
| Module lifecycle | timers and listeners survived navigation | the router calls a module's `destroy()` when leaving it (modules that define one) |

### 3.6 Expected outcome

Measured locally on an empty pharmacy the current first screen takes 35
requests after a 4.9-second overlay. The target is one request and a first paint
under one second on a pharmacy PC, with the whole shell cached after the first
visit.

---

## 4. Edge cases the rebuild must design for

These came up repeatedly across the reports. Each one needs a decision, not a
patch.

**Two PCs, one pharmacy.** Every scenario below happens today in a two-PC shop.
- PC A opens a record, PC B edits it, PC A saves: B's edit is gone (every
  module). Answer: versions and 409 (§2.1).
- PC A locks End Of Day, PC B had the day open and presses Save: unlocked
  (§1 item 3). Answer: lock is a server state; stale saves are refused.
- PC A deletes a paid-out, PC B edits it, gets 404, and the whole module flips
  into writing paid-outs inside End Of Day records (`paidout.js:224–232`).
  Answer: no fallback modes, ever; show the 404 as "deleted on another PC".
- Two PCs issue `DEL-00001` and `TKT-00001` because sequences live in
  localStorage (`deliveries.js:115`, `tickets.js:124`). Answer: the server issues
  every reference.
- Two PCs book the same slot inside the same 50 ms: both succeed (SELECT then
  INSERT, worker 14350). Answer: unique index on (doctor, clinic, date, time).
- Supplier A ships, supplier B on another PC ships again and overwrites the
  notes and date (worker 3093). Answer: state machine; shipped is final.
- Two branches claim the last units of a short-expiry item at the same moment:
  both succeed (worker 17783–17799). Two pharmacies each request a transfer's
  full quantity and both get dispatched because quantity is reserved only on
  delivery (worker 11981–11987, 12231–12262). Answer: reserve on accept, inside
  a batch.
- The supplier-inventory cart draft is shared per location and saved whole one
  second after any change; two PCs shopping at once overwrite each other
  (`supplier-inventory.js:184–198, 1429–1443`). Answer: line-level merge.

**Offline and flaky networks.**
- Temperature queues every failure including 400 and 403, replays under
  whichever user is logged in later, and never flushes on its own
  (`temperature.js:152–186`). Answer: one queue, user-scoped, only for network
  failures, auto-replay, visible count.
- `apiFetch` has no timeout and no retry, and no code handles a 401, so after 30
  days every screen shows "HTTP 401" until reload (`core.js:300–306`). Answer:
  timeout, one retry for idempotent GETs, 401 goes to the sign-in screen with the
  draft kept.
- The whole app fails to boot if the SheetJS CDN is unreachable (`index.html:123`).
  Answer: lazy load, bundled.

**Dates.**
- Between midnight and 01:00 or 02:00 Malta time, "today" differs between the
  dashboard (local) and instructions (UTC), the admin overview flips month on
  the client before the server, a handover typed after midnight lands on
  yesterday, and the supplier delivery date defaults to yesterday. Answer: §2.7.
- Repeat prescriptions drop a year of history on 1 January and hide
  future-dated typos (`repeatprescriptions.js:75–80`). Answer: a real date range,
  never a computed window.
- Public holidays stop existing in 2027 (three hard-coded lists). Answer: §2.7.
- Expiry dates are free text in vaccines stock and supplier products, so
  "12/2026" sorts before "2025-01-01" and first-expiry-first picks the wrong
  batch (`vaccines.js:1787`; worker 12652). Answer: typed dates everywhere.

**Identity and merging.**
- "789M" and "0000789M" are two people in POYC, repeat prescriptions and
  appointments, one person in loyalty and POCT. Answer: §2.2.
- DDA Sales rewrites historical ID cards on every lookup to coalesce them,
  without audit (worker 7884). Answer: aliases on the person, never history edits.
- Two fridges renamed to the same name merge their histories in the temperature
  chart (`temperature.js:374–413`). Answer: match by id, never by name.

**Money.**
- End Of Day rounding unit (5s or 10s) is a per-browser setting, so two PCs
  print different deposit figures for the same day (`endofday.js:811–816`).
  Answer: stored on the record.
- Float defaults to €1,000 in the client and €500 in the worker, and a stored 0
  becomes 1,000 on load (`endofday.js:1806, 1834`; worker 4071). Answer: one
  default, in Settings, and 0 is a value.
- A credit note can be drawn below zero because the balance is computed only in
  the browser (`creditnotes.js:119–150`; worker 7625). Answer: server computes
  and refuses.
- Appointment fees are collected per doctor and clinic but never applied, so
  every booking saves €0.00 (`appointments.js:1252, 1315`).
- Loyalty has no redemption transaction: a completed card can be claimed twice.
- Supplier order prices, VAT and retail are posted from the browser and stored
  as sent (`supplier-inventory.js:1016–1037`; worker 2994–3010). Answer: the
  server prices the order from the catalogue.
- POS receipt numbers are UTC timestamps to the second, so two tills collide
  and the number's date differs from the sale date after 23:00 (`emergencypos.js:458–460`).

**Clinical safety.**
- Save & Print in the calculators prints the previous model if inputs changed
  after Calculate (`pharmacycalc.js:482–484`), and the warfarin Clear button
  throws, leaving the stale plan (`:1232`). Answer: recalculate on save, always.
- Label autofill copies the last dose printed for that drug name, for any
  patient (`labels.js:773–811`). Answer: autofill the drug, never the dose,
  without an explicit confirm.
- Vaccines has no administration record: no batch against the patient, no
  administering pharmacist, no consent (`audit/C-clinical.md`). Answer: a
  vaccination is a record on the person, not an order line.
- OTC guardrails ("do not cross-sell together") are filtered out by the default
  top-20 limit and their text is never rendered (`otcmindmap.js:194–206`).
  Answer: guardrails are never filtered and always shown first.
- POCT has no thresholds: 220/130 saves as "Normal" if the user says so.
  Answer: the server flags out-of-range values and the Today list shows them.

**The host.**
- The app lives in a GoDaddy iframe whose sandbox is patched at runtime
  (`godaddy-loader-htmlcode:19–30`). In that frame `window.confirm` throws, so
  DDA purchase delete skips its confirm and stock-take delete becomes impossible;
  `window.open` is unreliable so prints fail silently; `loading="lazy"` delays
  the frame; the hash never flows back so refresh loses the screen. Answer: Eikon
  gets its own address. The marketing page links to it.

**Scale.**
- Several lists download everything for the location on every open (quotations,
  POCT, labels history, tickets, near expiry, alerts) and filter in the browser.
  Answer: §3.3.
- The pharmacy overview runs one query per pharmacy per month (worker
  18866–18874) and defines "working day" as any day but Sunday, so a pharmacy
  closed on Saturdays can never be green. Answer: opening days from Settings.

---

## 5. The shared patient book (Master Universal bridge)

The worker reviewer's verdict (`audit/F2-worker.md` §10): the worker is a CRUD
façade with manual tenancy, not a sync substrate. The primitives a shared book
needs are missing: an ordered event log per location, idempotent writes as a
rule, atomic batches, version checks, application-level encryption, a canonical
patient table, a real session lifecycle and background jobs. The parts that
exist (POCT, appointments) show the failure mode, not the solution.

What that means for the plan. The bridge is additive and should be built as a
separate router module with its own middleware (auth, tenancy, idempotency,
batch), not another branch in the 1,500-line if-chain:

- `patient_events (org, licence, seq, device_id, client_event_id UNIQUE,
  entity, entity_id, op, payload_cipher, created_at)` written with
  `env.DB.batch()`.
- `GET /book/changes?since=seq` for delta reads; the Patient Manager already
  posts fire-and-forget events to Cloudflare on every opened and posted patient,
  so the write side is a payload change, not a new mechanism.
- A canonical `patients` row per licence, joined to `people` (§2.2) so the
  Customers screen shows one person whichever system met them first.
- Dispensing records as opaque ciphertext encrypted with the pharmacy's records
  key, decrypted in the browser behind the same password and 2FA as the PC.
- The same ten-second delta poll drives both the Eikon shell and the PCs (§3.5).

Everything in §2 is a prerequisite for this. Build the shared things first and
the bridge is a module; build the bridge first and it inherits every defect above.

---

## 6. What this changes in the design

The audit confirms the design direction and sharpens four points.

1. **Honesty is a feature.** The single most damaging habit in the current code is
   telling the user something is saved when it is not. The new shell has one
   status line in the rail, and it is always true.
2. **Customers absorbs more than planned, Stock absorbs Quotations and Order
   Diary.** Quotations is supplier-invoice costing and Order Diary is the supplier
   order book; neither has a customer field. Both move to Stock. Repeat
   prescriptions, POCT, screening participants, vaccinations, labels history and
   pharmacovigilance reports are all lines on a person.
3. **Registers need a correction model and balances,** which the screens already
   imply (today's cell is the only editable one, "add with a note" on a missing
   day). The DDA register gets a balance column. That is new, and it is the
   reason the inspector will prefer Eikon to the paper book.
4. **The Today endpoint is the product.** Once the worker can answer "what needs
   this pharmacy now" in one call, the first screen is a list and three tiles, and
   the other 52 modules become places you go to look back.

---

## 7. Order of work

1. Week 1: the fourteen fixes in §1 on the current code. No UI change.
2. Weeks 2 to 5: the shared things in §2 as a new worker module alongside the
   old routes (people, products, versions, audit, roles, clock, print, reference
   data, one client). Migrations run once. Old routes keep working.
3. Week 6: the Today endpoint and the Today screen behind a flag, two pharmacies,
   two weeks, with the old UI one click away.
4. Then Customers, Registers, Stock, one at a time, each moving its modules onto
   the shared things as it goes. The function inventory
   (`FUNCTION-INVENTORY.md`) is the acceptance checklist for each.
5. The shared patient book after Customers exists, as its own module.
