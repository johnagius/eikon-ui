# Audit E — Legal registers (Temperature, Cleaning, Daily Register, Certificates, Audit Trail, DDA Sales / POYC / Purchases / Stock Takes)

Scope: `ui/modules.temperature.js`, `ui/modules.cleaning.js`, `ui/modules.dailyregister.js`, `ui/modules.certificates.js`, `ui/modules.audit.js`, `ui/modules.ddasales.js`, `ui/modules.ddapoyc.js`, `ui/modules.ddapurchases.js`, `ui/modules.ddastocktakes.js`. Line references `ui/...:N` are UI files; `worker:N` is `/home/user/eikon-ui/cloudflare-worker/code` (consulted only for the handlers these modules call).

**Cross-cutting facts that apply to every module below** (stated once, referenced as "C1..C9"):

- **C1 No client-side role gating anywhere.** `core.js` `E.renderNav` (core.js:990-1010) lists every registered module for the pharmacy role (`location_id` 0-399, core.js:347-366). Server authorisation is `requireRole(user, [...])` = `roles.includes(user.role)` (worker:1020-1022). Every register endpoint accepts `admin` and `staff`; only temperature device create/update (worker:1519, 1546) and the audit log (worker:14723) are admin-only. The UI shows those controls to everyone and the user only learns via an error toast.
- **C2 Nothing is immutable.** Every register row can be edited in place (`UPDATE ... SET`) and hard-deleted (`DELETE FROM`) by any `staff` user at any time, for any date. There is no lock, no "closed month", no cancellation/strike-through convention, no "reason for correction" field. The only trail is `audit_log` (`writeAudit`, worker:1010-1018), which stores a *subset* of fields, never before/after values, and for several deletes stores `{}` (cleaning, worker:5368) or omits the quantity (purchases, worker:9002). An inspector cannot reconstruct what a deleted or edited DDA line used to say.
- **C3 Audit write is not transactional.** Each handler mutates the row, then `await writeAudit(...)`, then responds. If the audit insert fails, the client receives an error after the data has already changed; a retry creates a duplicate register line (no idempotency key on any POST).
- **C4 No running balance anywhere.** `grep -i balance` over the whole worker returns nothing. Purchases, Sales and POYC are three independent flat tables with free-text drug names (three different suggestion vocabularies: sales 21 items `ui/modules.ddasales.js:20-42`, POYC 49 items `ui/modules.ddapoyc.js:140-189`, purchases none). Stock takes are a bare counted list. Nothing computes expected stock, discrepancy, or balance-after-transaction, and nothing can because the drug identifiers are not shared.
- **C5 Back-dating and future-dating are unlimited.** All create/update handlers accept any `YYYY-MM-DD` (`isValidYmd`) with no lower or upper bound and no "backdated" marker; the UI advertises it ("You can back-date any day", `ui/modules.temperature.js:1126`; "You can enter past dates", `ui/modules.cleaning.js:292`).
- **C6 Two PCs, same day = last writer wins, silently.** No row has a version/etag; `PUT` overwrites unconditionally; the temperature `POST` is an upsert on `(org, location, device, entry_date)` (worker:1673).
- **C7 Timestamps.** The worker stores `datetime('now')` = UTC `YYYY-MM-DD HH:MM:SS`. The UI renders these as if local (`fmtTs` `ui/modules.ddastocktakes.js:84-89`; `new Date("YYYY-MM-DD HH:MM:SS")` is parsed as *local* by browsers, `ui/modules.audit.js:46`), so displayed/printed times are 1-2 h off Malta time. `entry_date` strings are generated client-side with local `new Date()` and stored verbatim, which is correct.
- **C8 Three different HTTP stacks.** Temperature/Cleaning/Daily Register/Certificates/Audit/Stock Takes use `E.apiFetch` (token from `localStorage.eikon_token`, core.js:242-250). DDA Sales/POYC/Purchases ship their own `apiJson` that hunts for a token in `EIKON.getToken`, `EIKON.state.token`, then `localStorage`/`sessionStorage` keys `eikon_token, EIKON_TOKEN, token, auth_token, session_token` (`ui/modules.ddasales.js:391-411`, `ui/modules.ddapoyc.js:406-452`, `ui/modules.ddapurchases.js:271-291`). Certificates has a third copy (`ui/modules.certificates.js:89-112`). Any rebuild must keep exactly one.
- **C9 The sandboxed-iframe (GoDaddy) host.** Comments throughout say the app runs in an iframe without `allow-modals`, where `window.confirm`/`alert` throw and `window.open` is unreliable (`ui/modules.temperature.js:890-895`, `ui/modules.ddasales.js:536`, `ui/modules.ddapoyc.js:1882`). Modules disagree on how to handle it; two destructive paths behave badly there (see Purchases risk 1 and Stock Takes risk 4).

---

## Temperature  (`modules.temperature.js`, id `temperature`, order 10, visible to: all pharmacy users; Devices tab is server-side admin-only for create/update)
**Purpose.** Daily min/max temperature log per room/fridge with limits, monthly charts and a printable date-range report for inspection.

**Functions.**
1. Switch tab Entries / Devices / Print Report — where: top bar buttons (`:1944-1994`), remembered in module memory only; API: none.
2. Pick a date (defaults to today) and load that day's grid — where: date input `change` and "Load" button (`:1488-1509`); API: `GET /temperature/devices?include_inactive=1`, `GET /temperature/entries?month=YYYY-MM` (cached per `<org>_<loc>|YYYY-MM`, `:1079-1094`).
3. Enter Min / Max / Notes per *active* device with a live status pill OK / Out of limit / Missing — where: Entries table rows (`buildRow :1380-1441`, `statusDot :232-246`); room devices without `min_limit` get an implicit 8.1 °C floor client-side only (`:264-272`).
4. Save the whole day — where: "Save" (`:1581-1651`); validation: every active device must have both Min and Max (`:1600-1603`); API: one `POST /temperature/entries` per device, sequential (`:1621-1634`), server upsert on `(org,loc,device,date)` (worker:1647-1698).
5. Offline queue: any failed POST is appended to `localStorage` and the toast says "Saved: n. Queued: m (use Sync queued)" — where: `qAdd :152-157`, key `eikon_temp_queue_v1_<org>_<loc>` (`:123-134`).
6. Sync queued — where: button (`:1511-1523`), replays queued jobs sequentially (`qFlush :159-186`); failures are kept for next time.
7. Delete a single device/day entry — where: row "Delete" (enabled only when an entry exists) with in-app modal confirm (`:1408-1429`); API: `DELETE /temperature/entries/:id`.
8. Monthly Dashboard: per-device SVG chart for the selected month and the previous month, thin=min / thick=max / dashed=limits, vertical highlight on the selected day — where: below the grid (`refreshDashboard :1352-1378`, `buildDeviceMonthChartSvg :417-666`); API: second `GET /temperature/entries?month=` for the previous month; charts re-measured in `requestAnimationFrame` (`:1314-1349`).
9. Print dashboard — where: button (`:1529-1579`); extras: print — opens a blob HTML tab with both months' charts (A4, `@page` 12 mm), auto `window.print()` then auto-close (`buildDashboardPrintHtml :668-765`); double-fire guarded by `localStorage eikon_temp_print_lock_v1` (1.4 s) and an in-memory lock (`:896-914`).
10. Devices tab: add device (name, type room/fridge/other, min/max limit) — where: form (`:1811-1846`); API: `POST /temperature/devices` (server admin-only).
11. Devices tab: inline rename / retype / change limits — where: per-row "Save" (`:1731-1756`); API: `PUT /temperature/devices/:id` (admin-only); clears the entries cache.
12. Devices tab: Deactivate / Reactivate with modal confirm — where: per-row button (`:1758-1787`); API: `PUT /temperature/devices/:id {active}`; history kept.
13. Print Report tab: pick From/To (default today/today), Generate — where: (`:1884-1912`); API: `GET /temperature/report?from&to`; renders a preview table per month with one column per device and "min / max" cells (`renderReportPreviewDom :941-1028`).
14. Print Report tab: Print — where: button (`:1914-1925`); extras: print — blob tab, per-month tables, title "<org> - <location>", subtitle "Temperature Report • from to to", auto-print/auto-close (`buildPrintHtml :770-883`). No limits, no out-of-range marking, no signature column.
15. Automatic: on first visit the server seeds default devices if the location has none (`handleTempDevicesList` → `ensureDefaultTempDevicesIfMissing`, worker:1501). Automatic: `ensureUserScope` wipes caches when org/location changes (`:1053-1065`). Debug console logging toggled by `localStorage eikon_temp_dash_debug=1` (`:284-300`).

**Data & state.** Endpoints: `GET/POST /temperature/devices`, `PUT /temperature/devices/:id`, `GET/POST /temperature/entries`, `DELETE /temperature/entries/:id`, `GET /temperature/report` (worker also exposes `/temperature/report/html`, unused). Tables: `temperature_devices`, `temperature_entries`, `audit_log`, and `sync_jobs` (worker:1683-1688, 1722-1727) which is **write-only: nothing in the worker ever reads it**. localStorage: `eikon_temp_queue_v1_<org>_<loc>`, `eikon_temp_print_lock_v1`, `eikon_temp_dash_debug`. No polling, no cross-module exports.

**Permissions & scoping.** Org+location scoped server-side on every query. Device create/update admin-only on the server (worker:1519, 1546) but the Devices tab and its buttons are shown to all (C1). Entry upsert/delete: admin or staff. No client-side checks at all.

**Edge cases & risks (found in code, cite line numbers).**
1. **Stale overwrite across PCs.** Save re-POSTs *every* active device with the values currently in the form (`:1593-1612`). PC A loads 09:00, PC B saves fridge values at 09:05, PC A saves the room at 09:10 → the server upsert (worker:1673-1678) overwrites B's fridge values with A's stale ones. No etag, no "changed since load" check (C6).
2. **Partial day cannot be saved.** `:1600-1603` refuses the whole save if any active device lacks Min or Max; a user who only read one fridge must invent values or save nothing.
3. **Offline queue queues everything, forever.** `qAdd` is called on *any* exception (`:1630-1633`), including 400/403/401. A validation or auth failure becomes a poison job that fails on every "Sync queued" and is never surfaced individually. The queue key is org+loc, not user (`:125-134`), so a job queued under an expired token is replayed later under whichever user is logged in on that PC (`created_by` misattributed, worker:1680). Replayed jobs carry old values and overwrite newer ones (risk 1). Nothing flushes automatically (no `online` listener, no flush on load) — the day's reading is silently absent from the register until someone presses the button.
4. **Silent data loss on storage failure.** `qSave` swallows `QuotaExceeded`/private-mode errors (`:149`); the toast still says "Queued".
5. **Unlimited back/future dating with no marker** (C5, `:1126`); the printed report shows no created/edited time, so a value entered a month late is indistinguishable from one entered on the day.
6. **Out-of-range is cosmetic.** Out-of-limit readings require no note and no corrective-action record; the inspection print (`:820-824`) prints bare "min / max" without the limits or any flag. The client-only 8.1 °C room floor (`:264-272`) is not stored, so the server-side HTML report and any other consumer disagree with the UI.
7. **Chart remapping by name.** `mapEntriesToActiveDevices :374-413` assigns entries whose device is no longer active to any active device with the same normalised `name|type`; two fridges renamed to the same name would merge; entries of deactivated devices are "ignored" in the dashboard but present in the report.
8. **Delete is hard** (worker:1715-1720); audit stores only date and device id (worker:1729-1732).
9. **Race on date change.** `dateInput change` and "Load" both call `reloadForDate` without cancellation (`:1482-1509`); two quick changes can leave `rowObjs` from the older response.
10. **Silent catches:** dashboard failure shows "Dashboard failed to load." with the error only in debug mode (`:1373-1377`); `openPrintTabWithHtml` swallows both open attempts (`:928-931`); `modalConfirm` falls back to `window.confirm` which throws in the sandbox (`:112-114`, C9) and the promise then rejects.
11. **Print auto-close** (`:762, :878-880`): `afterprint` fires on cancel too, so cancelling the dialog closes the tab and a "Save as PDF" retry needs a regenerate.
12. **Print lock** (`:899-907`) silently suppresses a legitimate second print inside 1.4 s with only a debug log.
13. Schema: the `ON CONFLICT(org_id, location_id, device_id, entry_date)` upsert needs a unique index; **no `CREATE TABLE temperature_entries` exists anywhere in the repo** (see "could not determine").

**Speed notes.** Entries tab = 3 sequential GETs (devices → month → previous month, `:1101, :1361-1362`) that could run in parallel; month payload ≈ devices × days (≈150 rows) × 2. Save = N sequential POSTs (one per device) where one batch call would do. Devices tab reloads the whole device list after every save/toggle (`:1749, :1780, :1839`). Chart SVG strings are rebuilt per device per render; negligible.

**Must not be lost.**
- One row per active device per day with Min / Max / Notes and an immediate OK / Out-of-limit indication against per-device limits (and a sensible default for rooms).
- Ability to view/enter any past day (with, in the rebuild, a visible "entered late" marker).
- Device lifecycle: add, rename, change limits, deactivate without losing history; inactive devices still appear in reports for the period they had readings.
- Date-range report split per month, devices as columns, printable in one click — this is what the inspector is handed.
- Two-month per-device chart print with limit lines.
- Some form of resilience to a dropped connection (but not the current queue semantics).

---

## Cleaning  (`modules.cleaning.js`, id `cleaning`, order 20, visible to: all pharmacy users)
**Purpose.** Monthly cleaning register: who cleaned, when (in/out), supervising staff, notes, printable per month.

**Functions.**
1. Choose month (defaults to current) and load — where: `#cl-month` `change` and "Refresh" (`:377-383`); API: `GET /cleaning/entries?month=`.
2. Add entry: Date (default today), Time In (default 08:00), Time Out (optional), Cleaner Name, Staff Name, Notes — where: "Save" in Add Entry card (`:407-436`); API: `POST /cleaning/entries`; after save only Time Out and Notes are cleared (`:427`) so date/times/names persist for rapid repeat entry.
3. View register table Date / Time In / Time Out / Cleaner / Staff / Notes / Actions — where: `renderTable :38-75`; server order date desc, time_in desc (worker:5248).
4. Edit any entry (all six fields) — where: row "Edit" → `E.modal` (`openEdit :77-147`); API: `PUT /cleaning/entries/:id`.
5. Delete any entry — where: row "Delete" → modal confirm naming date + cleaner (`openDelete :149-171`); API: `DELETE /cleaning/entries/:id`.
6. Print the month — where: "Print" (`:386-405`); extras: print — blob tab, "Cleaning Register / Month • YYYY-MM", table sorted ascending by date then time_in (`buildCleaningPrintHtml :177-238`), auto print + close. No org/location, no signature column, no page header on continuation pages.
7. Automatic: initial `refresh()` on render (`:439`).

**Data & state.** Endpoints: `GET/POST /cleaning/entries`, `PUT/DELETE /cleaning/entries/:id` (worker also has `/cleaning/report` and `/cleaning/report/html`, unused by the UI). Table `cleaning_entries`. In-memory cache `state.entriesByMonth[month]` (`:24-27`) refreshed only on load. No localStorage, no polling.

**Permissions & scoping.** Server: admin or staff for all writes (worker:5256, 5297, 5348); org+location scoped. No client checks (C1). Anyone can rewrite or erase any month (C2).

**Edge cases & risks (found in code, cite line numbers).**
1. **Print can be stale.** Print uses the cached month if present (`:392-395`); entries added from another PC since the last refresh are omitted from the printed register with no indication.
2. **Identity not bound.** "Staff Name" is free text; the authenticated user (`created_by`, worker:5282) is never displayed or printed, so the register's attestation is whatever was typed.
3. **No temporal validation:** `time_out` may precede `time_in` (server checks only format, worker:5270-5271); future dates accepted (C5); duplicates (same date/time) accepted.
4. **Silent failures:** month change and Refresh errors go only to `E.error` (`:378, :382`) — the table simply does not change.
5. Edit/Delete modals query inputs by global id without a root (`:116-121`), fine today but fragile if two modals coexist.
6. Audit on delete stores `{}` (worker:5368) — the deleted cleaning line is unrecoverable (C2).
7. Hard-coded default Time In 08:00 (`:306`) is silently saved if the user forgets to change it.

**Speed notes.** One GET per month (≈30-90 rows). Full `tbody` rebuild per refresh; fine.

**Must not be lost.**
- Month register with Date, Time In, optional Time Out, Cleaner, Supervising staff, Notes.
- Quick repeated entry (sticky date/time/names).
- Back-dated entry for days the paper sheet was filled.
- One-click month print in chronological order.

---

## Daily Register  (`modules.dailyregister.js`, id `dailyregister`, order 70, visible to: all pharmacy users)
**Purpose.** Prescription-supply register (client, ID, medicine & dose, posology, prescriber & registration number) per month with live search and print.

**Functions.**
1. Choose month and load — where: `#dr-month` `change`, "Refresh" (`:586, :605`); API: `GET /daily-register/entries?month=` (server supports `q` but the UI never sends it).
2. Live search over all columns, client-side on the loaded month — where: `#dr-search` `input` (`:587-590`, `rowSearchBlob :60-76`); count label "Showing x / y" (`:483`).
3. New entry — where: "New" → `E.modal` with 7 fields, date default today (`openEntryModal :227-283`); client validation: all required, length caps 200/100/300/400/200/100 (`validatePayload :185-212`); API: `POST /daily-register/entries`.
4. Edit entry — where: row "Edit" → same modal (`:476`); API: `PUT /daily-register/entries/:id`.
5. Delete entry — where: row "Delete" → confirm modal summarising date/client/medicine (`openConfirmDelete :285-314`); API: `DELETE /daily-register/entries/:id`.
6. Print — where: "Print" (`:596-603`); extras: print — `window.open("")` + `document.write` (`openPrintWindow :316-381`) of the *currently filtered* rows, columns Date (dd/mm/yyyy) / Client (+ID) / Medicine / Posology / Prescriber / Reg No, meta "Rows / Month / Search / Printed", floating Print button, auto-print after 250 ms; tab is not auto-closed.
7. Sort: date desc, id desc (`:459-467`) in both table and print.
8. Automatic: style injection once (`:81-149`), initial refresh (`:607`).

**Data & state.** Endpoints: `GET/POST /daily-register/entries`, `PUT/DELETE /daily-register/entries/:id` (worker also has `/daily-register/report(/html)`, unused). Table `daily_register_entries`. Module-level `state` (`:444`) with `refresh` callback; no localStorage, no polling.

**Permissions & scoping.** Server admin|staff for list and writes (worker:6059, 6114, 6169, 6234); org+location scoped. No client checks (C1). Edit/delete unrestricted (C2).

**Edge cases & risks (found in code, cite line numbers).**
1. **Print of a filtered subset looks like a register.** Print uses `state.filtered` (`:598`); the only hint is the "Search:" meta line (`:369`). Reverse-chronological order (`:459-467`) is also the opposite of what an inspector expects for a daily register.
2. **Accidental delete.** The row Delete button is an ordinary `eikon-btn` (`:425`) and the confirm dialog's "Delete" is styled `primary` not `danger` (`:300`).
3. **Popup-first print** (`:321`) opens the window before building HTML; if blocked, a modal says so, but on success the page is `document.write`-n (no blob, no `noopener`), unlike every other module.
4. **Cross-month search impossible** from the UI although the server supports `q` (worker:6069-6099): a client's history across months cannot be found.
5. **Unawaited concurrent refreshes** (`:586, :605`) can leave `state.entries` from an older month if the user switches quickly.
6. `modalError` falls back to `alert()` (`:223`) which throws in the sandbox (C9).
7. Audit records only `client_id` and medicine on create/update (worker:6159-6163, 6221-6225) and date+client_id on delete; posology/prescriber changes leave no trace (C2).
8. Future dates accepted (C5).

**Speed notes.** One GET per month; full `tbody` rebuild on every keystroke (`applyFilterAndRender`), acceptable below ~1k rows.

**Must not be lost.**
- The seven statutory columns (date, client name & surname, client ID, medicine & dose, posology, prescriber name, prescriber registration number).
- Month view with instant filter across all columns and a visible count.
- dd/mm/yyyy presentation.
- Printable month register (chronological, full month, with pharmacy identification in the rebuild).

---

## Certificates  (`modules.certificates.js`, id `certificates`, order 100, visible to: all pharmacy users)
**Purpose.** Track statutory certificates/inspections per location (fixed catalogue): last date, interval, computed next due, certified person, one attached document each, with expiry flag and a "Print All" pack.

**Functions.**
1. List certificate cards — where: on render / "Refresh" (`:869-898`); API: `GET /certificates/items`; server seeds the default catalogue for the location on first call (worker:9552) and computes `next_due = last_date + interval_months` with month-end clamping (worker:9582-9584, `addMonthsToYmd` worker:9332-9350).
2. EXPIRED badge and red next-due when `next_due < today` (local) — where: `isCertificateExpired :55-66`, badge `:483-490`, colour `:564-566`.
3. Edit: last date (nullable), interval months 1-120 (server allows 1-240, worker:9639), certified person when `requires_person` — where: "Edit" → `E.modal` (`openEditModal :612-679`); API: `PUT /certificates/items/:id`.
4. Upload a PDF/image, replacing the previous file — where: "Upload" → hidden `<input type=file>` (`openUploadPicker :681-709`); API: `POST /certificates/items/:id/upload` multipart; on *any* failure retries as base64 JSON (`uploadFile :428-460`); server stores in R2 or, without R2, base64 in D1 up to `CERT_UPLOAD_MAX_BYTES` (800 kB) (worker:9751-9780).
5. Download the attached file — where: "Download" (only when `file_name`) (`triggerDownloadForItem :261-376`); opens a popup shell synchronously, fetches with `Authorization` header (`fetchBlobWithAuth :135-158`), offers "CLICK TO DOWNLOAD" / "Open PDF" / Close; auto-clicks only when not embedded (`:329-333`); revokes the blob after 10 min.
6. Print All — where: button (`:900-906`, `openPrintAllWindow :711-837`); extras: print — popup reads `window.opener.__EIKON_CERT_PRINT_DATA`, renders summary table (Certificate / Last / Next Due / Interval / Person / File), then fetches every file with `?inline=1` and embeds images / PDF `<embed>`, auto-prints after `Promise.allSettled`.
7. Automatic: CSS injection for the badge (`:384-399`).
8. Not available: creating or deleting certificate types, deleting/restoring a file, viewing previous versions.

**Data & state.** Endpoints: `GET /certificates/items`, `PUT /certificates/items/:idOrKey`, `POST /certificates/items/:idOrKey/upload`, `GET /certificates/items/:id/download[?inline=1]` (also `HEAD`). Table `certificates_items` (columns incl. `file_r2_key`, `file_b64`, `updated_by`). Reads localStorage token keys `eikon_token, EIKON_TOKEN, token, auth_token, eikon.auth.token` (`:104`) in both the module and the generated print page (`:755`). Global `window.__EIKON_CERT_PRINT_DATA` (`:713`). No polling.

**Permissions & scoping.** Server admin|staff for everything (worker:9548, 9613, 9693, 9844); org+location scoped. No client checks (C1).

**Edge cases & risks (found in code, cite line numbers).**
1. **Previous certificate is destroyed on upload** ("New uploads overwrite the old file", `:850`; worker:9782-9798 replaces `file_*` columns; the old R2 object is never deleted → orphaned storage, but unreachable). Calibration/fire/pest certificates are normally retained for several years; there is no history and no confirm before overwrite.
2. **Upload retry doubles traffic and masks the real error** (`:445-459`): a 413/403/network failure on multipart is followed by a base64 JSON upload ~33 % larger; the user sees the *second* error.
3. **Print All depends on `window.opener`** (`:757`) and on `<embed type=application/pdf>` (`:817`), which Chrome prints blank; the inspector pack therefore usually contains the summary table only. Each file is fetched again in the popup (N+1, `:797-825`), and the popup page re-implements token discovery from localStorage (`:755`).
4. **Expiry logic is binary.** Only `next_due < today` flags (`:62`); due-today and "due within 30 days" are not surfaced; no dashboard/alert integration found in this module.
5. **Validation gaps:** no client-side file size/type check beyond `accept` (`:686`); `last_date` can be cleared to null silently (`:659`); interval client max 120 vs server 240 (`:654`, worker:9639).
6. **Silent catch:** "Refresh" errors are only logged (`:897`); the grid keeps old cards.
7. Hard-coded light-theme colours (`#666 :494`, `#444 :541`, `#1a57c6 :561`) on the dark shell.
8. Audit covers update and upload (worker:9675, 9801) but not download/view.

**Speed notes.** One GET (≈10-20 items, each carrying `file_r2_key`/sizes). Print All = 1 popup + N parallel file downloads (full PDFs, possibly MBs each).

**Must not be lost.**
- Per-location fixed catalogue of statutory certificates with last date, interval, computed next-due (month-end-safe) and certified person where applicable.
- Clear EXPIRED state (and, in the rebuild, "due soon").
- Attach, view and download the current document per certificate; keep prior versions.
- One-click summary print for the inspector.

---

## Audit Trail  (`modules.audit.js`, id `audit`, order 101, visible to: shown to all pharmacy users; server returns 403 to non-admins)
**Purpose.** Read-only viewer of `audit_log` for the org with filters by module, action, date, paging and print.

**Functions.**
1. Filter by Module (10 fixed options mapped server-side to entity types, `:67-78`, worker:14735-14745), Action contains, From / To (default last 30 days, `:240-246`) — where: filter card, "Search" button, Enter in the action field (`:343-348`); API: `GET /audit/log?limit=50&offset&module&action&from&to`.
2. Table Date/Time (en-GB) / User / Module / Action (verb + raw code) / Record ID / Details (flattened `details_json`) — where: `renderTable :105-146`.
3. Paginate 50 per page with Previous / Next and "Showing a–b of N (Page x of y)" — where: `:148-156, :354-364`.
4. Print the current page — where: "Print" (`:350-352`); extras: print — blob tab "Audit Trail" with subtitle (module, date range), 6 columns, auto print + close (`buildPrintHtml :159-211`).
5. Automatic: initial search on render (`:367`).

**Data & state.** Endpoint `GET /audit/log` (admin-only, worker:14722-14809). Table `audit_log` joined to `users`. Module-level `state` (filters persist across navigations, `:80-89`). No localStorage, no polling.

**Permissions & scoping.** Server: `requireRole(['admin'])` (worker:14723). Scope is **org only, not location** (worker:14747-14748): an admin of a multi-location org sees all locations' rows and the table has no location column. UI exposes the module to everyone (C1); non-admins get "Forbidden – admin only" rendered as a table row (`:338-339`).

**Edge cases & risks (found in code, cite line numbers).**
1. **Displayed times are wrong by the UTC offset.** `formatDateTime` does `new Date("YYYY-MM-DD HH:MM:SS")` (`:46`); the string is UTC from SQLite but browsers parse that form as local → Malta display is 1-2 h early (C7).
2. **Print = current 50 rows only** (`:160`) with no page marker; no CSV/export of the full trail.
3. **The trail cannot reconstruct changes.** Details are whatever each handler chose to log (C2); e.g. cleaning delete `{}`; no before/after; the viewer shows only what exists.
4. **No location filter/column** although all registers are per location (worker:14747).
5. **Date filter** appends `T23:59:59` to `to` (worker:14770); works only because `'T' > ' '` in ASCII; `from` compares against `YYYY-MM-DD HH:MM:SS` correctly.
6. Module list hard-codes entity names; registers audited under other entity types (e.g. `location` for `TEMP_DEFAULT_DEVICES_CREATE`, worker:1497) are reachable only via "All Modules".
7. `details` values are rendered with `esc()` but keys with `.replace` then `esc` — fine; the raw action code is shown (`:139`), useful.

**Speed notes.** Two queries per page (rows + COUNT) server-side; 50 rows per request; print has no extra request.

**Must not be lost.**
- Who / when / what-module / which-record / what-changed browsing, filtered by module, action and date.
- Pagination that scales to years of entries.
- A printable (and in the rebuild, exportable) extract for an inspector.
- Admin-only access, enforced server-side.

---

## DDA Sales  (`modules.ddasales.js`, id `dda-sales`, order 40, visible to: all pharmacy users)
**Purpose.** Register of private (non-POYC) controlled-drug supplies against prescriptions: client identity, drug, quantity, prescriber, prescription serial, urgency, with duplicate-serial and early-supply checks and a printable per-month report.

**Functions.**
1. Choose month (default current) — where: month input `onchange` (`:1802-1809`); also resets report From/To to that month; API: `GET /dda-sales/entries?month=&q=&_ts=`.
2. Live server-side search (8 columns, worker:7835-7844), debounced 250 ms, Enter to force — where: search input (`:1818-1826`).
3. Refresh — where: button (`:1830-1831`).
4. Entries table (Date, Client, ID Card, Address, Medicine, Qty, Doctor, Reg No, Prescription Serial No, Urgent pill, Actions) — where: `renderRows :988-1033`; rows flagged red with tooltip when the same ID card + medicine was supplied < 30 days earlier (`:1012-1020`, `computeEarlyById :95-130`).
5. New entry modal (built once per document, `buildModalOnceForDoc :1308-1497`): Entry Date (default today), Quantity (int ≥ 1, default 1), Urgent checkbox, Client Name, Client ID Card, Client Address, Medicine Name & Dose, Doctor Name, Doctor Reg No, Prescription Serial No — where: "New Entry" (`openModalForCreate :1502-1529`).
6. Client ID Card auto-uppercase and Maltese-ID zero-padding on input/blur (`789M → 0000789M`, `normalizeMtIdCard :48-58`, handlers `:1355-1378`).
7. Client prefill by ID card (create mode only, full 7-digit+letter format, debounce 250 ms) — API: `GET /dda-sales/client?client_id_card=` (`:860-891`); fills name and address silently.
8. Client name autosuggest (≥ 2 chars, debounce 260 ms, 12 results) — API: `GET /dda-sales/clients?limit=12&q=` (`:893-969`); picking fills name/ID/address and focuses Medicine.
9. Medicine suggestions: fixed 21-item list via native `<datalist>` (`:1443-1451`), a custom dropdown on focus/click (`:702-748`), an inline "Suggestion: … (Tab to accept)" hint and Tab completion (`:1388-1404`).
10. Doctor name / reg-no suggestions from past entries with usage count — API: `GET /dda-sales/doctors?limit=12&q=` (`:813-856`); auto-fills the other field when exactly one match (`:829-853`); Escape hides.
11. Save — where: modal "Save" (`doSave :1632-1663`); client validation all fields required, quantity ≥ 1 (`validateFormPayload :1557-1596`); duplicate-serial check — API: `GET /dda-sales/check-serial?serial&exclude_id` → in-app confirm listing up to 5 prior lines and total quantity, "Continue (Partial Dispense)" / "Cancel (Duplicate)" (`:1598-1630`); then `POST /dda-sales/entries` or `PUT /dda-sales/entries/:id`.
12. Edit — where: row "Edit" (`openModalForEdit :1531-1555`), modal shows a Delete button too (`:1480-1484`).
13. Delete — where: row "Delete" or modal "Delete" → in-app confirm (`uiConfirm :539-620`) → tries `POST /dda-sales/entries/delete {id}`, then `DELETE /dda-sales/entries/:id`, then `POST /dda-sales/entries/:id/delete` (`doDelete :1666-1775`), sends `X-Eikon-Debug: 1`, treats `debug.changes === 0` as failure (`:1751-1759`).
14. Report: From / To (default = selected month) + Generate — API: `GET /dda-sales/report?from&to` → preview grouped per month, 10 columns, early-supply highlight (`renderReportPreview :1083-1154`).
15. Print report — where: "Print" (`printReport :1263-1306`); reuses the generated report if the range matches, otherwise fetches; extras: print — blob tab "<org> — DDA Sales Report", location, range, per-month tables, floating Print button, auto-print after 250 ms (`buildPrintableHtml :1198-1261`).
16. Automatic: on render → `refresh()` which also calls `computeEarlyByIdForMonth` (`:1049`, see risk 1); module registration retried at 0/200/1000 ms (`:1992-1996`); clicking the backdrop closes the modal (`:1493`).

**Data & state.** Endpoints: `GET/POST /dda-sales/entries`, `PUT/DELETE /dda-sales/entries/:id`, `POST /dda-sales/entries/delete`, `POST /dda-sales/entries/:id/delete`, `GET /dda-sales/client`, `/clients`, `/doctors`, `/check-serial`, `/report` (worker also serves `/report/html`, unused). Table `dda_sales_entries` (`urgent` column added by migration, worker:7689-7712). Own `apiJson` (C8) with `cache: no-store` and `_ts` cache-buster. No localStorage writes, no polling.

**Permissions & scoping.** Server admin|staff for all (worker:7800, 8033, 8114, 8224, 8267); org+location scoped. No client gating; any staff can edit or hard-delete any DDA line of any date (C2). Duplicate prescription serials are allowed after a confirm.

**Edge cases & risks (found in code, cite line numbers).**
1. **Cross-month early-supply detection is dead code.** `computeEarlyByIdForMonth` (`:132-154`) is defined at file top level but references `ctx` (`:142`), a variable declared only inside `buildModule` (`:476`). In strict mode that is a `ReferenceError`, caught at `:151`, which silently falls back to month-only detection. A supply on 28 Oct followed by one on 3 Nov is **not** flagged. The POYC module has the same feature written correctly (`ui/modules.ddapoyc.js:1356-1378`).
2. **HTML escaping is a no-op in the print report.** `escapeHtml` (`:157-161`) maps `&<>"'` to themselves. `buildPrintableHtml` (`:1225-1251`) interpolates client names, addresses, doctors, medicines and serials into the document; a `<` breaks the table and a `<script>` in any field executes in the blob page, which shares the app origin and can read the token in localStorage (stored XSS via register data). Same defect in POYC (`ui/modules.ddapoyc.js:38-42`).
3. **Retroactive bulk rewrite of history.** Every create/update/lookup runs `UPDATE dda_sales_entries SET client_id_card = ? WHERE … IN (keys)` (worker:8049-8059, 8139-8149, 7888-7898), silently changing the ID card on all historical lines of that client with no audit entry per row.
4. **No running balance / stock position** (C4); the printed "report" is a transaction list, not a register with balance.
5. **Hard delete after one confirm; audit keeps date, ID card, serial only** (worker:8254-8258) — medicine and quantity of a deleted supply are gone (C2). Edit overwrites in place with the same partial audit (worker:8190-8196).
6. **Delete fallback chain** (`:1712-1748`): if the first call deletes the row but the response is lost, the next two attempts 404 and the user is told "Delete failed" with a debug string, then refreshes and sees it gone.
7. **Search input loses focus mid-typing:** `setLoading` disables `qInput` during each debounced refresh (`:627`), and the debounced callback is skipped if a load is in flight (`:1822`) with no trailing re-run → last keystrokes can be ignored until Enter.
8. `uiConfirm` resolves `true` when `ctx` is missing (`:541`) → delete proceeds without a dialog in that edge.
9. Unlimited back/future dating (C5); no mandatory reason for late entry.
10. Autosuggest requests on every keystroke in three fields (`:1407-1424`) — sequenced with `seq` guards but not cancelled.
11. `renderInto` relies on `resolveRenderContext` finding `ctx.mount` via the generic `maybeElProps` scan (`:242-254`) because core passes `{E, mount, user}` (core.js:1254) — works, but any change of the ctx shape silently renders nothing (`:1779` returns).
12. Modal DOM is appended to `document.body` once and never removed (`:1496`); re-renders reuse it (fine) but a second instance of the module in the same page would share it.

**Speed notes.** Initial load = 2 sequential requests (`entries` then `report` lookback, `:1046-1049`) — the second one always fails today (risk 1) but still costs a round trip of up to 61 days of rows. Each keystroke in client/doctor fields = 1 request after debounce; each Save = `check-serial` + write + `entries` + `report`. Month payload: tens to a few hundred rows.

**Must not be lost.**
- All ten columns including Urgent and prescription serial; Maltese ID normalisation and client prefill; doctor suggestions.
- Duplicate-serial detection with the explicit "partial dispense vs duplicate" decision and total already dispensed.
- Early-supply (< 30 days, same client + drug) highlighting — across month boundaries, as intended.
- Month list with full-text search; date-range report grouped per month with org/location header, printable.
- A correction model that keeps the original line visible (to add in the rebuild; currently missing but legally expected).

---

## DDA POYC  (`modules.ddapoyc.js`, id `dda-poyc`, order 60, visible to: all pharmacy users)
**Purpose.** Same register as DDA Sales for POYC (government-scheme) controlled-drug supplies, with a fixed POYC medicine vocabulary and client/doctor type-ahead built from history.

**Functions.**
1. Choose month — where: month input `onchange` (`:2113-2117`), also resets report range; API: `GET /dda-poyc/entries?month=&q=`.
2. Live search 220 ms debounce, Enter to force (`:2125-2129`, `scheduleLiveSearch :2059-2069`); focus and caret are preserved across the disable/enable cycle (`setLoading :1228-1266`).
3. Refresh (`:2133-2136`).
4. Entries table (Date, Client, ID Card, Address, Medicine, Qty, Doctor, Reg No, Prescription Serial No, Actions) with early-supply red rows (`renderRows :1284-1336`).
5. New entry modal (built once, `openModal :1606-1764`): Date (**defaults to the 1st of the selected month**, `:1810-1812`), Qty, Client, ID Card, Address, Medicine, Doctor, Reg No, Serial. Save handler is re-bound per open (`:1736-1749`). No client-side validation — the raw payload is posted and the server rejects (`:1739-1748`).
6. Client / ID Card autosuggest (1 char, 80 ms, 12 results) from a local index of all entries seen plus a backward month scan: up to 3 batches × 6 parallel `GET /dda-poyc/entries?month=&q=` covering 18 months (`suggestPoycClients :1032-1116`), cached 10 min (`:578`); picking fills name/ID/address (`:1652-1674`).
7. Doctor / Reg No autosuggest, same engine and month scan (`suggestPoycDoctors :1120-1204`, `:1676-1696`).
8. Medicine autosuggest from the fixed 49-item POYC list, contains-match (`suggestPoycMedicines :1207-1219`, `:1698-1706`).
9. Floating suggestion panel positioned under the input, closed on outside click/scroll/resize/Escape/blur (`ensureSuggestUi :851-976`, `attachSuggest :978-1029`).
10. Save (create) — duplicate-serial check `GET /dda-poyc/check-serial` + confirm (`:1775-1807`) → `POST /dda-poyc/entries` (`openModalForNew :1809-1843`).
11. Edit — row "Edit" → same modal pre-filled → check-serial with `exclude_id` → `PUT /dda-poyc/entries/:id` (`openModalForEdit :1845-1879`).
12. Delete — row "Delete" → `uiConfirm` (`:1884-1961`) → `POST /entries/delete`, then `DELETE /entries/:id`, then `POST /entries/:id/delete` (`doDelete :1963-2055`).
13. Early-supply flags with 30-day lookback — API: `GET /dda-poyc/report?from=(month start − 30 d)&to=(month end)` on every refresh (`:1356-1378`), falling back to month-only on failure.
14. Report From / To + Generate → preview grouped per month, 9 columns (`generateReport :1484-1522`, `renderReportPreview :1412-1482`).
15. Print — only after Generate (`:2168-2175`); extras: print — blob tab "<org> — DDA POYC Report" per-month tables; **no auto-print and no Print button in the page** (`buildPrintableHtml :1524-1604`).
16. Automatic: initial refresh (`:2237`); `destroy()` removes modal and suggestion panel (`:2241-2272`) — the only register module with a destroy hook.

**Data & state.** Endpoints: `GET/POST /dda-poyc/entries`, `PUT/DELETE /dda-poyc/entries/:id`, `POST /dda-poyc/entries/delete`, `POST /dda-poyc/entries/:id/delete`, `GET /dda-poyc/check-serial`, `GET /dda-poyc/report`. Table `dda_poyc_entries`. In-memory indexes `_clientIndex`, `_doctorIndex`, search caches with 10-min TTL and in-flight de-duplication (`:574-585`). Own `apiJson` (C8). No localStorage, no polling.

**Permissions & scoping.** Server admin|staff (worker:8421, 8509, 8571, 8643, 8678); org+location scoped. No client gating (C1, C2).

**Edge cases & risks (found in code, cite line numbers).**
1. **Default entry date is the 1st of the selected month, not today** (`:1810-1812`). A pharmacist working in the current month who clicks "New Entry" gets e.g. `2026-10-01`; unless noticed, every POYC supply is dated to the first of the month — systematic mis-dating of a controlled-drug register. Sales uses today (`ui/modules.ddasales.js:1505-1509`).
2. **No-op `escapeHtml`** (`:38-42`) → print-report HTML injection / stored XSS, as in Sales risk 2 (`:1555-1594`).
3. **Autosuggest fan-out.** Typing 2+ characters in Client, ID Card, Doctor or Reg No fires up to 6 parallel month queries per batch, up to 18 per distinct query (`:1066-1102`, `:1154-1191`), each a `LIKE` over 8 columns in D1 (worker:8455-8464). Sales has dedicated `/clients` and `/doctors` endpoints; POYC has none. This is an N+1 against the busiest table in the app.
4. **No Maltese-ID normalisation** on input or save (contrast Sales `:1355-1378`); only the early-supply key strips spaces/uppercases (`:87-89`). `789M` and `0000789M` are different clients for suggestions, duplicate detection and (if the server ever normalises) history.
5. **No client-side validation** (`:1739-1748`): errors arrive from the server one at a time ("Missing client_id_card"), and `quantity` is silently dropped when blank (`:1747`).
6. **Print has no auto-print and no button** (`:1602`); the user must find the browser's print command; the report also lacks the "Urgent" concept entirely (not in schema) — fine for POYC but worth confirming.
7. Delete chain and audit as in Sales (worker:8665-8669: date, ID card, serial only) (C2).
8. `monthInput.onchange` stores an invalid/blank month (`:2114`) and `refresh` silently falls back to today's month while the input shows blank.
9. Row Edit/Delete are `<span>`s (`:1322-1329`): not keyboard-accessible, no `button` semantics.
10. `setLoading` focus restore (`:1251-1262`) refocuses the search box after a save-triggered refresh even if the user had moved on; minor.
11. Unlimited back/future dating (C5); hard delete (C2); no balance (C4).

**Speed notes.** Initial load = 2 sequential requests (entries, 61-day report). Each Save = check-serial + write + 2 reloads. Autosuggest worst case 18 requests per distinct query term (cached 10 min per exact normalised term, so each new prefix is a new fan-out).

**Must not be lost.**
- Nine-column POYC register with the POYC medicine vocabulary.
- Duplicate-serial decision dialog with quantities already dispensed.
- Working cross-month early-supply highlighting.
- Client and doctor type-ahead (but served by proper endpoints).
- Month list + search; per-month printable report with org/location.

---

## DDA Purchases  (`modules.ddapurchases.js`, id `dda-purchases`, order 30, visible to: all pharmacy users)
**Purpose.** Register of controlled-drug receipts from suppliers: date, drug & dose, quantity, agent (supplier), invoice number; monthly list, search and printable report.

**Functions.**
1. Choose month — where: month input (`:884-891`), resets report range; API: `GET /dda-purchases/entries?month=&q=`.
2. Live search 250 ms over date / name / agent / invoice (server, worker:8853-8858), Enter to force (`:899-907`).
3. Refresh (`:910-911`).
4. Entries table (Date, DDA Name & Dose, Qty, Agent, Invoice Number, Actions) (`renderRows :410-441`).
5. New entry modal (built once, `buildModalOnceForDoc :689-750`): Entry Date (default today), Quantity (int ≥ 1), DDA Name & Dose (free text, no suggestions), Agent, Invoice Number — where: "New Entry" (`openModalForCreate :755-769`); client validation all required (`validateFormPayload :785-808`); API: `POST /dda-purchases/entries`.
6. Edit — row "Edit" → same modal with Delete button → `PUT /dda-purchases/entries/:id` (`openModalForEdit :771-783`, `doSave :810-833`).
7. Delete — row "Delete" or modal "Delete" → **native `confirm`** → `DELETE /dda-purchases/entries/:id` (`doDelete :835-859`).
8. Report From / To + Generate → preview grouped per month, 5 columns (`generateReport :543-583`, `renderReportPreview :488-541`).
9. Print — fetches the report if the range changed, then blob tab "<org> — DDA Purchases Report", per-month tables, floating Print button, auto-print (`printReport :644-687`, `buildPrintableHtml :585-642`).
10. Automatic: initial refresh (`:996`); registration retried 0/200/1000 ms (`:1056-1059`).

**Data & state.** Endpoints: `GET/POST /dda-purchases/entries`, `PUT/DELETE /dda-purchases/entries/:id`, `GET /dda-purchases/report` (worker also `/report/html`, unused). Table `dda_purchases_entries` (worker:8789-8805). Own `apiJson` (C8). No localStorage, no polling.

**Permissions & scoping.** Server admin|staff (worker:8823, 8870, 8920, 8980, 9015); org+location scoped. No client gating (C1, C2).

**Edge cases & risks (found in code, cite line numbers).**
1. **Delete without confirmation in the sandboxed host.** `doDelete` does `try { ok = ctx.win.confirm(...) } catch (e) { ok = true; }` (`:841`). Where `confirm` throws (C9), a single click on the row's "Delete" span hard-deletes a controlled-drug receipt with no dialog. Every other DDA module uses an in-app confirm.
2. **No receipt evidence or supplier identity fields** (licence number, batch, expiry, delivery note) and no attachment; drug name is free text with no vocabulary → cannot be matched to Sales/POYC/stock-take lines (C4).
3. **No duplicate-invoice check** (contrast `check-serial` in Sales/POYC); the same invoice can be entered twice.
4. **Hard delete / in-place edit; audit on delete omits quantity** (worker:9002-9006) (C2).
5. **Search box loses focus** on every debounced refresh (`setLoading` disables `qInput`, `:387`) and refreshes are skipped while loading with no trailing run (`:903`).
6. Row actions are `<span>`s (`:431-434`), not buttons.
7. Unlimited back/future dating (C5).
8. Duplicated 400-line boilerplate (`resolveRenderContext`, `apiJson`, CSS) copied from Sales — three copies to keep in sync.

**Speed notes.** One GET per month; Save = write + 1 reload; report = 1 GET. Light.

**Must not be lost.**
- Five-column receipts register (date, drug & dose, quantity, supplier/agent, invoice number).
- Month list + search; per-month printable report with org/location header.
- In the rebuild: link each receipt line to the same drug identity as Sales/POYC so a balance can exist.

---

## DDA Stock Takes  (`modules.ddastocktakes.js`, id `dda_stocktakes`, order 50, visible to: all pharmacy users)
**Purpose.** Physical count of controlled drugs: create a timestamped stock take, list counted items (name, dosage, quantity of tablets), mark it closed, print it.

**Functions.**
1. Select a stock take from a dropdown labelled with its creation timestamp and "(closed)" (`loadList :378-410`); newest selected by default (`:402`); API: `GET /dda-stocktakes/stocktakes` (includes `item_count`, worker:9119-9126).
2. New Stock Take — creates an empty header with server time and selects it (`:445-454`); API: `POST /dda-stocktakes/stocktakes {}`.
3. Refresh list (`:441-443`).
4. Save & Close — sets `closed_at` (first close time is kept, worker:9181) and toasts "you can still edit later" (`:456-466`); API: `PUT /dda-stocktakes/stocktakes/:id {closed:1}`. There is no Reopen control (server supports `{closed:0}`, worker:9187-9196).
5. Print Selected — fetches server-rendered HTML `GET /dda-stocktakes/stocktakes/:id/report/html` and opens it in a blob tab (`printReportHtml :124-134`); layout: "<org> — DDA Stock Take", Location, Stock Take ID, Created, Closed, table Name / Dosage / Quantity of Tablets, "Generated" timestamp, Print button, no auto-print (worker:9288-9325, `htmlReportPage` worker:1800-1830).
6. Add item: Name (required), Dosage, Quantity (integer ≥ 0, floored) — where: add row + "Add Item" (`validateAdd :191-199`, `:475-496`); API: `POST /dda-stocktakes/stocktakes/:id/items`; focus returns to Name.
7. Inline edit an item — where: row "Edit" turns the row into inputs; Enter saves, Escape cancels (`:337-344`); Save / Cancel / Delete buttons (`startEdit :201-209`, `saveEdit :228-240`); API: `PUT /dda-stocktakes/items/:itemId`.
8. Delete an item — where: row "Delete" → **native `window.confirm`** (`:245`) → `DELETE /dda-stocktakes/items/:itemId` (`deleteItem :242-257`).
9. Meta line "Created: … • Closed: … / Not closed" (`:275-278`).
10. Automatic: initial `loadList(null)` (`:499`); toast CSS injection (`:48-66`).

**Data & state.** Endpoints as listed (worker:16316-16354). Tables `dda_stocktakes` (`created_at, created_by, closed_at, updated_at`, worker:9109) and `dda_stocktake_items` (`item_name, dosage, qty_tablets`, worker:9110). Uses `E.apiFetch`; the HTML report arrives as `{ok:true,text}` (core.js:306, `:126-128`). Per-render local `state` (`:139-145`); no localStorage, no polling.

**Permissions & scoping.** Server admin|staff for everything (worker:9116-9289); org+location scoped. No client gating (C1).

**Edge cases & risks (found in code, cite line numbers).**
1. **"Closed" is cosmetic.** Neither the UI nor the server stops adding/editing/deleting items after close (`handleDdaStockTakeItemAdd/Update/Delete` worker:9204-9285 never read `closed_at`; UI toast `:460` says so). A closed, printed, inspector-signed stock take can be altered afterwards; only `audit_log` records it.
2. **No reconciliation.** The stock take is a list of counts with no expected quantity, no discrepancy column, no link to the previous stock take, and no carry-forward of the item list — every stock take starts empty and every drug is retyped (`:289-291`), guaranteeing name/dosage drift between takes and against Purchases/Sales (C4).
3. **Timestamps shown and printed in UTC as if local** (`fmtTs :84-89`; worker report prints `created_at` raw, worker:9311) — a stock take at 00:30 Malta time on the 1st is dated the previous day (C7). The stock-take date cannot be set or back-dated at all (header has no editable date), so a count done on paper yesterday cannot be recorded with its true date.
4. **Delete item is impossible in the sandboxed host:** `window.confirm` (`:245`) throws, the outer `try` catches it and toasts "Delete failed" (`:254-256`) — the opposite failure mode to Purchases (there it deletes without asking).
5. **No "counted by / checked by" or signature fields**; `created_by` exists in the DB (worker:9136) but is neither shown nor printed.
6. **No way to delete or reopen a stock take** from the UI; accidental empty headers accumulate in the dropdown forever (list is unpaginated, worker:9119-9126).
7. Quantity floors fractions silently (`:198, :225`, worker:9223) — 10.5 ml of a solution becomes 10 with no warning; the column is labelled "tablets" although POYC/sales vocabularies include solutions, patches and injections.
8. Fast dropdown switching races: `loadSelected` has no sequence guard (`:412-433`); a slow earlier response can replace the newer selection.
9. Each item add/edit/delete refetches the whole stock take (`:236, :253, :492`).

**Speed notes.** Load = 2 sequential GETs (list, then selected). Item operations = 1 write + 1 full reload. Payloads are small (tens of items).

**Must not be lost.**
- Historical stock takes with creation and close timestamps, each with its own item list (name, dosage, quantity).
- Fast keyboard entry (Enter to save, Escape to cancel, focus back to Name).
- Close marker and a printed sheet with org/location/ID/dates (plus, in the rebuild, counted-by/witness and discrepancy vs expected).
- Server-rendered print so the format is identical on every PC.

---

## What I could not determine

1. **`temperature_entries` schema.** No `CREATE TABLE temperature_entries` or unique index exists anywhere in the repo (worker or `.sql`); the upsert's `ON CONFLICT(org_id, location_id, device_id, entry_date)` (worker:1673) requires one, so the live D1 database was evidently created out-of-band. Column list and constraints are therefore unverified.
2. **`sync_jobs`.** The worker inserts rows on every temperature upsert/delete (worker:1683-1688, 1722-1727) but nothing reads or updates the table; whether an external process consumes it is unknown. If not, it grows unbounded.
3. **Role assignment.** Which users hold `admin` vs `staff` (`user.role`) is decided by code outside these modules; I did not audit it. The UI never knows the role.
4. **Hosting mode.** Whether production actually runs inside the GoDaddy sandboxed iframe (C9) decides whether Purchases deletes without confirmation and Stock Takes cannot delete items; the comments assert it, the deployment config was not reviewed.
5. **Legal format.** Statements that a DDA register needs a balance column, correction (strike-through) convention, and counted-by/witness on stock takes come from the Maltese Dangerous Drugs record-keeping practice, not from anything in the code; the code contains no such logic, and nothing in `design/` was found specifying the required inspector format.
6. **`/…/report/html` server endpoints** exist for temperature, cleaning, daily register, sales, POYC and purchases but are unused by these modules; whether another consumer (e.g. a dashboard or email) depends on them was out of scope.
