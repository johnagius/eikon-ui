# A2 — Money & Rota modules audit

Scope: `ui/modules.shifts.js`, `ui/modules.endofday.js`, `ui/modules.paidout.js`, `ui/modules.creditnotes.js`, `ui/modules.locumreceipts.js`, `ui/modules.locumregister.js`. Worker (`cloudflare-worker/code`, one file) consulted only for the handlers these modules call; line numbers prefixed `W:` refer to it. All other line numbers refer to the module file of the section.

Cross-cutting facts that apply to every section below (so they are not repeated six times):

- **Sidebar/visibility.** `core.js` registers every module and lists all six under "Inspections" (`locumregister`) or "Operations" (`endofday`, `shifts`, `creditnotes`, `paidout`, `locumreceipts`) for any login in "pharmacy" UI mode (core.js 319–327, 774–780). None of the six modules checks `user.role` on the client. The worker enforces `user.role` per handler: End Of Day, Credit Notes, Locum Receipts, Locum Register = `admin`/`staff` only (W:4095, 4106, 5496, 5706, 7512); Paid Out = `admin`/`staff`/`user` (W:4519); **Shifts has no `requireRole` at all** (W:13015–13381) so any authenticated user of the location can edit the rota. A `user`-role login therefore sees End Of Day in the sidebar but every call 403s (see EOD risk 1 for what the UI then does).
- **Scoping.** Every handler scopes by `authUser.org_id` + `authUser.location_id`; `location_id` comes only from `users.default_location_id` (W:1059–1076). There is no location switcher; the `location_name`/`location` query params the EOD module appends are ignored by the worker.
- **Auth transport.** `E.apiFetch` adds `Authorization: Bearer <localStorage eikon_token>` (core.js 254–259). No CSRF/ETag/If-Match anywhere: every PUT is a full-row overwrite, last write wins.
- **Server audit.** The worker writes `audit_log` rows for most writes (`EOD_*`, `PAID_OUT_*`, `LOCUM_*`, `CREDITNOTE_*`, `SHIFT_*`) but none of these six modules ever reads them; the only audit UI is EOD's, and it reads localStorage (see EOD).

---

## Shifts  (`modules.shifts.js`, id `shifts`, order 190, visible to: all pharmacy-mode logins; worker enforces no role at all)
**Purpose.** Staff roster, monthly rota (calendar + grid), weekly shift patterns, leave requests/approvals with Malta entitlement maths, opening hours/coverage rules, printable rota and iCal feeds.

**Functions.**
1. Open module → loads staff (incl. inactive), current-month assignments, current-year leaves, opening hours, settings in parallel — where: on render; API: GET /shifts/staff?include_inactive=1, GET /shifts/assignments?year&month, GET /shifts/leaves?year, GET /shifts/opening-hours, GET /shifts/settings (124–132); extras: on any failure, whole state falls back to localStorage `eikon_shifts_v2` (140–150).
2. Today's pharmacist-coverage banner — where: top of every tab, auto on render (3397–3400); API: none (computed from loaded data).
3. Switch tab Calendar / Schedule / Staff / Leave / Integration / Settings — where: tab bar buttons (3385–3408); API: none.
4. Calendar: previous / next month, Today — where: ◀ ▶ Today buttons (1709–1711); API: GET /shifts/assignments?year&month (loadMonth 201–206). Leaves are NOT reloaded for the new year.
5. Calendar: per-day cell shows opening hours, PH badge, coverage warning ("No pharm." / "Pharm gap"), shift pills, on-leave pills — where: calendar grid (1644–1685); API: none.
6. Calendar: click a day → Day modal listing shifts with Edit / ✕ (delete), coverage banner with gap suggestion, "Add Shift" form (employee, start, end, notes), pharmacist-overlap warning with "Add anyway" checkbox — where: day modal (1999–2197); API: POST /shifts/assignments (2100), DELETE /shifts/assignments/:id (2183).
7. Day modal: "+ Locum Shift" → Locum shift modal: use existing locum (search, show-inactive toggle) or create new locum (name, role, email, phone, reg no), time in/out, notes, overlap warning — where: button in day modal (2133–2177) → modal (1730–1996); API: POST /shifts/staff (1868), GET /shifts/staff?include_inactive=1 (1877), POST /shifts/assignments (1934).
8. Day modal: Edit a shift → Single shift modal (start, end, notes, Remove, Update) — where: Edit button (2186–2195) → 2543–2615; API: PUT /shifts/assignments/:id (2607), DELETE /shifts/assignments/:id (2577).
9. Calendar: per-week "↻ Pattern" → Week apply modal: pick employee, start-from pattern (or blank), overwrite/fill mode with overwrite confirm checkbox, edit each of 7 days, Apply (also saves the week as a new named pattern on the employee) — where: week column button (1719–1726) → 2198–2384; API: POST /shifts/apply-pattern (2253), PUT /shifts/staff/:id (via saveEmp 2280).
10. Calendar: "↻ Month Pattern" → Month apply modal: employee, saved pattern, overwrite/fill with confirm, per-day preview of created/skipped days, Apply to Month — where: toolbar button (1713) → 2386–2541; API: POST /shifts/apply-pattern (2447).
11. Calendar: "Print" → Print modal (scope Day / Month / Year / Range, staff filter) → opens print window with per-day tables, leave clashes struck through — where: toolbar (1712) → 3071–3183, 2948–3069; API: GET /shifts/assignments-range?from&to[&staff_id] (2913–2928); extras: print (window.open + document.write).
12. Schedule tab: employee × day grid for the month, prev/next month, click cell → Single shift modal (assign/edit/remove) — where: tab (2620–2675); API: GET /shifts/assignments (loadMonth), POST/PUT/DELETE /shifts/assignments.
13. Staff tab: roster table (name, role, type, hrs/wk or locum YTD hours, contact, annual leave left/ent, sick left, status) — where: tab (701–768); API: for locums, GET /shifts/assignments?year&month for every month Jan→current (319–368).
14. Staff: "+ Add Employee" / Edit → Employee modal (name, designation, employment type, contracted h/wk, email, phone, registration no, Malta reference box, Weekly Patterns manager) — where: 770–1000; API: POST /shifts/staff, PUT /shifts/staff/:id (1290–1304), then GET /shifts/staff?include_inactive=1 for new employees.
15. Employee modal: Weekly Patterns — "+ New Pattern", Edit, Delete (two-click confirm), Apply, pick Provisional (radio). Pattern edits auto-persist 450 ms later via a full staff PUT — where: 870–999, 1099–1181; API: PUT /shifts/staff/:id (917).
16. Employee modal: Apply pattern → range (from today → year end / full year / custom), overwrite/fill with confirm, expands pattern client-side skipping closed days — where: 1183–1289; API: POST /shifts/apply-pattern (1245).
17. Staff: Activate / Deactivate toggle — where: roster row button (749–751); API: PUT /shifts/staff/:id (1306–1309).
18. Staff: Delete (hard delete, with confirm modal) — where: roster row button (753–755) → 607–637 → 564–604; API: DELETE /shifts/staff/:id, then GET /shifts/staff?include_inactive=1. Worker cascades: deletes all that staff's assignments and leaves (W:13097–13100).
19. Leave tab: Submit Leave Request (employee, type ×8, start/end date, optional partial start/end time, reason); live balance box per employee; locums disabled — where: 2680–2763, 2807–2825; API: POST /shifts/leaves (2824).
20. Leave tab: Pending list with ✓ Approve / ✗ Reject; coverage hint column; Approve shows "Coverage Gap" / "Locum Required" confirm when the pharmacist has no alternates — where: 2765–2772, 2827–2853; API: POST /shifts/leaves/:id/approve, POST /shifts/leaves/:id/reject.
21. Leave tab: Leave History (last 50, newest first) — where: 2723–2729; API: none (from loaded leaves).
22. Automatic side effect on approve: `adjustShifts` trims or removes the employee's shifts in the leave window **in memory/localStorage only** — where: 2835, 2855–2866; API: none.
23. Integration tab: Live calendar feed — employee filter, past/future days, read-only URL, Generate/Regenerate Token (saves token into settings and test-fetches the feed) — where: 3185–3311; API: PUT /shifts/settings (3293), GET <origin>/shifts/ical?token=… (public, unauthenticated, 3273).
24. Integration tab: "Open Print" (same as 11) — where: 3313–3314.
25. Integration tab: Static .ics download for a month / employee (built client-side from loaded shifts + approved leaves) — where: 3317–3332, 3335–3373; extras: .ics download.
26. Settings tab: Weekly opening hours per weekday (closed checkbox, open, close), "Copy Monday → Tue–Fri", "Copy Monday → Tue–Sun", Save Hours — where: 1321–1471; API: PUT /shifts/opening-hours (1466).
27. Settings: Exceptional day overrides — add (date, custom hours / fully closed, note), Remove — where: 1473–1480, 1491–1496; API: PUT /shifts/opening-hours (whole blob).
28. Settings: Coverage rules (require pharmacist yes/no, min pharmacists) Save Rules — where: 1482–1486; API: PUT /shifts/settings (whole blob).
29. Settings: Malta Employment Law Reference cards + Edit modal (per-year annual leave hours, PH count, COLA, min wage, miscarriage days; core sick/urgent/FT/max hours) — where: 1499–1605; API: PUT /shifts/settings (1597).
30. Copy-to-clipboard helper with manual fallback modal — where: 643–696 (defined; no current caller wires it, kept for the integration URL).
31. Toasts (3.5 s), console debugging groups on every API call — where: 551–560, 208–246; API: adds `X-Eikon-Debug: 1` header to every non-GET /shifts/ call (215–217).

**Data & state.** Tables: `shift_staff`, `shift_assignments`, `shift_leaves`, `shift_opening_hours`, `shift_settings` (settings_json holds `pharmacistRequired`, `minPharmacists`, `maltaLaw`, `calendarToken`), `shift_calendar_tokens`. localStorage: `eikon_shifts_v2` (full mirror of staff/shifts/leaves/hours/settings plus an `_id` counter used for optimistic ids; not scoped by org/location/user). No offline queue: writes that fail are not retried, but the local mirror keeps the optimistic row. No polling. Cross-module: none exposed on `window.EIKON`; uses `E.apiFetch`, `E.modal`, `E.q`, `E.registerModule`. Public endpoint: `/shifts/ical?token=` (W:15412–15415) serves staff names + shifts without auth.

**Permissions & scoping.** No client-side role checks at all. Worker: **no `requireRole` on any /shifts/* handler** — any authenticated user of the location (including `user` role) can add/delete staff, rewrite the rota, approve leave, regenerate the public calendar token. Scoped to org+location server-side. Public iCal feed: token is the only credential; token is shown in clear in the UI (3225) and the worker also resolves it by `LIKE '%token%'` substring scan of all settings (W:13448).

**Edge cases & risks (found in code, cite line numbers).**
1. **Every write reports success even when the API fails.** `apiOp` calls `onOk({ok:false})` in the catch path (242–244) and all callers toast "Shift added." / "Employee updated." / "Staff deleted." / "Leave approved." etc. regardless (2100–2105, 832–836, 595, 2836). The failure toast (240) is immediately replaced by the success toast (552). Optimistic rows with fake ids from `lsNextId` (2099, 2610, 1930, 2823) stay in `S.shifts`/localStorage.
2. **Leave approval does not change the server rota.** `adjustShifts` (2855–2866) removes/trims the employee's shifts locally only; the worker approve handler just flips status (W:13302–13310). After reload the shifts reappear and the person is shown both on leave and on duty; the printed rota marks them "(on leave)" (3007–3010) but coverage maths (471–481) already excludes them, so the two views disagree.
3. **Overwrite-mode pattern application deletes historical shifts.** Worker `apply-pattern` with `mode=overwrite` deletes every assignment for the staff member in [start,end] before inserting (W:13247–13248). Employee modal default range "From today" is safe, but "Full year" starts 1 Jan (1187–1196, 1220) and Week/Month apply cover past weeks/months; the only guard is the "I understand" checkbox (1225–1228). Payroll/inspection history for that period is destroyed with no undo.
4. **Hard staff delete cascades.** DELETE /shifts/staff/:id removes all assignments and leaves for that person (W:13097–13100). The confirm text says so (616), but there is no soft-delete/export first; use Deactivate instead. Nothing stops deleting someone with past-year records.
5. **localStorage fallback is cross-tenant.** `eikon_shifts_v2` (106) is not keyed by org/location/user. If any one of the five initial GETs fails (Promise.all, 126–150), the whole roster/rota/settings is taken from whatever the last login on that PC cached, possibly a different location; subsequent writes from that stale state go to the current location's API.
6. **Public holidays hard-coded for 2025/2026 only** (268–275). From 2027 nothing is a PH: coverage warnings fire on holidays, pattern application schedules staff on holidays (1237–1240, 2440–2441), and "Malta reference" year data has no 2027 row either (29–32). Also disagrees with `modules.locumreceipts.js` which computes Good Friday algorithmically.
7. **Leaves loaded for the initial year only** (`/shifts/leaves?year=S.year`, 129). Navigating calendar/schedule into another year (1709–1710, 2664–2665) only reloads assignments (201–206), so leave pills, strike-throughs, and coverage checks are wrong across the year boundary; `bal()` counts a leave by its start-date year only (537–538), so a 30 Dec–5 Jan leave is charged entirely to the first year.
8. **Leave hours computed client-side crudely**: `wdCount(sd,ed)*8` ignores contracted hours, part-time days, public holidays and opening hours (2818–2819); server stores whatever it receives (W:13296). Entitlement uses `new Date().getFullYear()` not the leave year (82, 533).
9. **Locum shift modal creates the staff record before the overlap confirmation** (1902 vs 1906–1926). Cancelling at "Add anyway" leaves an orphan locum; pressing Save again creates a duplicate. If the POST response carries no id it resolves by name match (1887–1896) and may attach the shift to a different same-named locum.
10. **Whole-blob settings overwrites.** Save Rules / Malta modal / token generation all PUT the entire `S.settings` (1485, 1597, 3293); Save Hours / override add / override remove PUT the entire opening-hours blob (1466, 1479, 1494). Two PCs editing settings race; a stale PC re-saving Rules re-sends the *old* `calendarToken`, and the worker re-syncs it into `shift_calendar_tokens` (W:13366–13374), re-enabling a token someone had rotated.
11. **No duplicate/overlap enforcement server-side.** Assignment create has no uniqueness check (W:13124–13140); the Day-modal "Add Shift" has no in-flight guard (2066–2106) so a double-click creates two identical shifts. Pharmacist-overlap warning is advisory and only client-side.
12. **Unescaped values in HTML attributes**: `singleShiftModal` injects `existing.notes`, `start_time`, `end_time` raw into `value="…"` (2565–2568); a note containing `"` breaks the form and allows attribute injection.
13. **Pattern persistence races.** Pattern edits auto-save with a 450 ms debounce sending a full staff PUT built from current form fields (892–927); if the user edits name/designation at the same time, partially typed values are persisted. Week apply always appends a new pattern named "Week YYYY-MM-DD" (2260–2284), so pattern lists grow without bound.
14. **Staff-tab locum YTD hours** issue up to 12 parallel month GETs on first open (336–346) and exclude future-dated shifts only by string compare; hours use `end-start` with no break deduction (297–304).
15. **Print range leave-clash marking** uses `S.leaves` for the initially loaded year only (2960), so printing another year never strikes through leave.
16. **iCal static download** uses only the shifts currently in memory for `S.year/S.month` (3344–3347) — a different month in the picker yields 0 events unless that month was navigated to first.
17. Silent catches: 205 (`loadMonth` swallows failure and shows stale month), 364–367 (locum hours), 402, 1926, 2096, 2604 (overlap checks), 1298 (staff refetch).
18. Coverage sweep (490–513) treats `start_time`/`end_time` as strings `HH:MM`; a shift crossing midnight (`end <= start`) is silently ignored (478, 301).

**Speed notes.** Initial load: 5 parallel GETs (staff ≈ KBs, month shifts ≈ 100–600 rows, year leaves, hours, settings). Month navigation: 1 GET. Staff tab: +N GETs (one per elapsed month) when locums exist. Calendar render recomputes `checkCov` for every day (1652) and filters the full `S.shifts` array per day/pill (1653–1654, 2638–2639), O(days × shifts) but fine at these sizes. Every tab click re-renders the whole mount via `innerHTML` string building. Pattern apply expands dates client-side and posts them (up to 366 rows) in one request; worker then issues one INSERT per row (W:13252–13259).

**Must not be lost.**
- Pharmacist coverage check against opening hours with gap list (legal requirement for a pharmacist on premises), including PH-closed default and per-day overrides.
- Leave request → approve/reject with Malta entitlement (annual pro-rata, sick, urgent family) and balance display; leave history.
- Weekly patterns with overwrite/fill application across week/month/range, and the explicit overwrite confirmation.
- Staff register with designation, registration number, contracted hours, active/inactive (needed for inspection of who was the responsible pharmacist on a date).
- Printable rota by day/month/year/range with leave clashes marked; .ics/live calendar feed for staff.
- Locum worked-hours YTD on the staff list (feeds locum invoicing and WTD compliance).

---

## End Of Day  (`modules.endofday.js`, id `endofday`, order 180, visible to: all pharmacy-mode logins; worker allows `admin`/`staff` only)
**Purpose.** Daily till reconciliation per location: X readings, EPOS, cheques, paid outs, cash count, float, rounded BOV bank deposit with bag number, over/under, with save/lock/unlock, A4 print, range report and monthly summary.

**Functions.**
1. Open module → probe API availability for today's record (up to 12 path variants), then load selected date's record (cloud + local shadow, newest wins) — where: render (1879–1961); API: GET /endofday/record?date[&location_name|&location] (and /endofday, /eod/record, /eod variants) (618–713).
2. Change Date → force reload that date (sequence-guarded) — where: Date input (2713–2734); API: GET record as above.
3. Time of Day AM/PM, Staff (required), Location (read-only from login), Float (money input) — where: header fields (2736–2766); API: none until Save.
4. X Readings / EPOS / Cheques / Paid Outs tables: Add Entry, per-row amount (money input, comma→dot), remark, Remove (when >1 row), live row total — where: four payment cards (2588–2672, 2773–2778); API: none until Save.
5. Cash Count: note counts €500…€5 (int inputs) + coins total (money), live per-denomination totals and Total Cash (Till) — where: 2781–2861; API: none.
6. BOV Cash Deposit: auto-filled from counted notes to match F (rounded) until the user edits a deposit count (`deposit_edited`); per-denomination count inputs; Total BOV Deposit — where: 2863–2955, autofill 1222–1251, 1953–1955, 2501–2503; API: none.
7. Bag Number, Contact select, "Manage Contacts" (add/edit/delete contacts modal with sandbox-safe delete confirm) — where: 2868–2897, 1396–1521; API: GET /endofday/contacts, PUT /endofday/contacts (bulk replace), POST fallback (773–801).
8. "Copy Deposit to Email (Outlook)" → copies HTML + plain BOV table with greeting/date/location to clipboard (requires bag no.) — where: 2887–2891, 1727–1794; extras: clipboard (HTML+text), execCommand fallback.
9. Summary card: Expected deposit (A−B−C−D), E total cash (till−float, floored at 0), F rounded deposit, Over/Under, Coins (E−F) — live updated while typing — where: 2964–3014, calculations 1116–1167, live 2385–2455; API: none.
10. Rounding unit radio 10s / 5s for F — where: inside summary (2988–3005); stored in localStorage `eikon_eod_rounding` (811–816), per browser.
11. Monthly Summary: Total Cash, Over/Under, Coin Box for the month, live-adjusted while typing — where: 3016–3063, 1169–1217; API: GET /endofday/dates?month (+5 variants) then GET record for each date (N+1), merged with local shadows.
12. Save — validates staff/location/float/bag; writes local shadow then cloud; writes audit — where: Save button (2680, 1984–2020); API: PUT /endofday/record `{record}` (POST fallback) (715–731); audit POST /endofday/audit (does not exist on worker).
13. Lock — same validation, sets `locked_at`, upserts, audit — where: 2682, 2022–2055; API: PUT /endofday/record with `locked_at` set, `action:"LOCK"`.
14. Unlock — confirm modal, clears `locked_at`, upserts with `unlock:true`/`action:"UNLOCK"`, audit — where: 2683, 2058–2099; API: PUT /endofday/record (worker W:4142–4183 clears lock for any admin/staff).
15. Audit Log modal for the selected day — where: 2684, 2101–2132; API: GET /endofday/audit?location_name&date (404 → falls back to localStorage `eikon_eod_audit_v1`).
16. "Print End of Day on A4" — validates, opens blob tab with fixed A4 sheet (A1–A4, B1–B4, C1–C4, D1–D8, totals, E, F, Over/Under, Coins), audit `PRINT_A4` — where: 2681, 2134–2148, 1526–1634; extras: print.
17. "Report (Date Range)" → From/To modal → landscape A4 table of one row per day with 15 columns and a totals footer, audit `PRINT_RANGE` — where: 2692–2706, 2149–2361; API: GET record for every calendar day in range (N+1); extras: print.
18. Lock behaviour: when locked, all body inputs/buttons disabled except Copy Deposit, Print, Report, Audit, Date, Unlock — where: 3076–3093, 1369–1376.
19. Status pills Locked/Unlocked, Saved/Not Saved, Cloud ON/OFF — where: 2708–2711.
20. Automatic: focus/scroll preservation across re-renders, deferred re-render while a field is focused (250 ms poll), 30 s caches for contacts/month dates/month summary — where: 110–350, 79–105; API: none.

**Data & state.** Table `end_of_day` (one row per org+location+date; JSON columns `x_json`, `epos_json`, `cheques_json`, `paid_outs_json`, `cash_json`, `bov_deposit_json`; `locked_at`, `saved_at`, `updated_by`) and `end_of_day_contacts`. localStorage: `eikon_eod_records_v2` (full shadow copy of every record ever loaded or saved on this PC, keyed by date+location_name), `eikon_eod_contacts_v2`, `eikon_eod_audit_v1` (the only place UI audit entries live), `eikon_eod_rounding`. Offline behaviour: local shadow always written first (856, 969); cloud failure = "Saved locally" toast; no retry queue. No polling. Module state `_state` persists across re-renders for the session. Cross-module: none on `window.EIKON`; the Paid Out module's 404 fallback writes into this table's `paid_outs_json` (see Paid Out).

**Permissions & scoping.** No client-side role check; worker allows `admin` and `staff` only (W:4095, 4106). Unlock is available to the same roles as Save — any staff member can unlock a locked day (W:4152–4183); the UI confirm (2061–2066) is the only friction and no reason is captured. Location is the login's default location; the UI's `location_name` param is ignored server-side.

**Edge cases & risks (found in code, cite line numbers).**
1. **Silent permanent offline mode.** `apiCheckAvailable` runs once (1894–1896). Any non-404 error on that first probe — a 403 for a `user`-role login, a 5xx, a network blip — sets `_apiMode.ok=false` (646–657) and it is never re-checked for the rest of the session. All subsequent Saves/Locks go to localStorage only (858–875), the "Saved" pill turns green, A4 prints work, and the record never reaches the server. Only a red "Cloud: OFF" pill (2711) indicates this.
2. **Local shadow can mask the cloud's locked state and figures.** `upsertEod` writes the shadow *before* the cloud call (856/969). If the cloud rejects (e.g. 409 "Locked - cannot update" because another PC locked the day, W:4191), the shadow still holds this PC's rejected figures with `locked_at:""` and a newer `saved_at`; `pickNewestRecord` (452–470) then prefers it on every reload, so this PC shows the day as Unlocked with the wrong numbers, and prints them on A4.
3. **Two PCs, same day: last write wins, no version check.** The worker overwrites every JSON column (W:4243–4282). A PC keeps its in-memory `_state` and only reloads when the date changes (`_lastLoadedKey`, 1915–1916), so edits made elsewhere are silently overwritten on the next Save.
4. **Rounding unit is per browser, not per record** (811–816). F (rounded deposit), Coins and the Monthly Coin Box differ between PCs for the same stored day; the printed A4 and range report (2202–2214) recompute with the local setting, so two inspectors' printouts disagree. The chosen unit is not stored in the record.
5. **BOV auto-fill silently under-fills.** `autoFillDeposit` (1235–1251) greedily allocates available notes and drops any remainder; no warning that deposit ≠ F. `validateBeforeSave` (1966–1982) never checks deposit total vs F.
6. **Audit trail is per-browser only.** `/endofday/audit` does not exist on the worker (routes W:15525–15552); the POST fails and is swallowed (1045–1048), GET falls back to localStorage (1073–1077). The "Audit Log" shows only actions performed on this PC; a different PC shows "No audit entries yet." The worker's real `audit_log` rows are not surfaced here.
7. **Float default mismatch**: UI default `"1000.00"` (1806, 1834), worker fills `"500"` for a null DB value (W:4071); `ensureStateShape` also resets an explicit `"0"` float to 1000 because `!state.float_amount` is true for `"0"`? No — `"0"` is truthy as a string, but a numeric `0` from older rows is falsy and becomes 1000 (1834).
8. **N+1 fetches.** Monthly summary issues one GET per EOD date in the month, sequentially (1183–1208), on every render after the 30 s cache expires and on every date change (2726 invalidates). Range report issues one GET per calendar day in the range (2155–2163) — a year = 365 sequential requests plus a localStorage scan each.
9. **Unlock has no authorisation distinction** (UI 2058–2099; worker W:4142–4183). The upsert path also accepts `locked_at:""` as an unlock (W:4145), so a stale client that loaded the day before it was locked and then presses Save sends `locked_at:""` → worker treats it as **unlock** and returns 200 (W:4153–4182) — the day is unlocked by an ordinary Save from another PC, and that PC's figures are then saved on the next click. Serious.
10. **Local shadows never expire and are shared by all logins on the PC** (`eikon_eod_records_v2`, 806). `listDatesForMonth` merges shadow dates into the month (1098–1104), so a day that exists only locally (e.g. saved while offline, or by a different user) appears in monthly totals.
11. `moneyNormalizeInput`/`moneyToNumber` (531–558) accept up to 2 dp but `float_amount` and amounts are stored as strings; worker coerces `float_amount` to Number and stores JSON arrays verbatim — no server-side totals, so Expected/E/F/Over-Under are never computed or validated server-side; the range report totals are purely client-side.
12. Duplicate `upsertEod` definition (854–875 and 967–988); second wins — harmless now but a maintenance trap.
13. `paid_outs` inside EOD (section D) and the Paid Out module's `paid_out_entries` are separate stores with no reconciliation; D must be retyped by hand.
14. `tsToMs` treats SQLite timestamps as UTC (432–435) and ISO as given — correct for D1 `datetime('now')`, but `saved_at` sent by the client is ignored server-side (W:4258), so the cloud `updated_at` and local `saved_at` can be seconds apart in either direction, which decides which copy wins (457–459).
15. Silent catches: 952–954 (cloud GET failure → treats as no cloud record and may show a stale shadow), 1012–1014 (contacts), 1093–1095 (dates), 1045–1048 (audit), 2454.
16. Print A4 shows only the first 4 X/EPOS/cheque rows and first 8 paid-outs (1535–1556) while totals include all rows — a day with 5 cheques prints 4 lines whose sum ≠ printed total.

**Speed notes.** First render: 1 probe GET (may try up to 12 URLs on 404s) + 1 record GET + 1 contacts GET + 1 dates GET + N record GETs (one per EOD day in month) — typically 25–35 requests, sequential for the month part. Date change repeats the month part. Record payload is small (a few KB). Full DOM rebuild on every re-render (3098–3100) mitigated by in-place live updates while typing.

**Must not be lost.**
- Daily record of X readings, EPOS, cheques, paid outs, cash count by denomination, float, BOV deposit by denomination with bag number — the accountant's and VAT inspector's primary cash document.
- Expected deposit / E / F / Over-Under / Coins formulas exactly as printed on the A4 sheet, and the A4 layout itself (staff sign it).
- Lock after close of day, with an audited unlock path restricted to a supervisor.
- Monthly and date-range totals (cash, over/under, coin box) and the landscape range report.
- BOV deposit email table (HTML + plain) with contact list.
- One record per location per date; location fixed by login.

---

## Paid Out  (`modules.paidout.js`, id `paidout`, order 250, visible to: all pharmacy-mode logins; worker allows `admin`/`staff`/`user`)
**Purpose.** Register of cash/cheque payments out of the till to suppliers or clients, with printable signed receipt, monthly list and date-range report.

**Functions.**
1. Open module → load current month's entries — where: render (1097–1408); API: GET /paid-out/entries?month&q&_ts (94–117).
2. Month picker (onchange reloads), Search box (Enter reloads; server-side LIKE over date/time/payee/invoice/cheque/reason), Refresh — where: 1369–1384; API: GET /paid-out/entries.
3. Entries table sorted newest first with Cash/Cheque badge, Items count + Total summary — where: 1208–1319; API: none.
4. "New Paid Out" → modal (date, time default now, Paid To with autocomplete suggestions, fee, invoice no, method cash/cheque, cheque no shown only for cheque, reason) with Save and Save & Print — where: 1371–1378, 941–1095; API: GET /paid-out/names?q (autocomplete, 141–159), POST /paid-out/entries (161–177).
5. Row Edit → same modal in edit mode — where: 1256–1268; API: PUT /paid-out/entries/:id (179–195).
6. Row Receipt → opens print tab with "Paid Out Receipt" (org, location, date/time, paid to, amount, method, invoice, cheque, reason, client signature block) that auto-prints — where: 1270–1274, 788–843; extras: print.
7. Row Delete → confirm modal (Cancel is the primary button) → delete — where: 1276–1298; API: DELETE /paid-out/entries/:id (197–213).
8. "Print Month" → report grouped by payee with subtotals and grand total, auto-print — where: 1386–1390, 674–768, 845–849; extras: print.
9. Report card: From/To (defaults to current month), Generate (shows items + total), Print — where: 1343–1367, 1401–1405; API: GET /paid-out/report?from&to&_ts (119–139); extras: print.
10. Automatic fallback: on any 404 the module permanently switches to storing entries inside End Of Day records for the session — where: 96–116, 161–213, 215–580; API: GET/PUT/POST /endofday/record, GET /endofday/dates (and /eod variants).
11. Payee name memory in localStorage for the fallback autocomplete — where: 582–646; localStorage `eikon_paidout_names_v1`.

**Data & state.** Table `paid_out_entries` (org, location, entry_date, entry_time, payee_name, fee REAL 2 dp, payment_method, invoice_no, cheque_no, reason, created_by/updated_by). localStorage: `eikon_paidout_names_v1` (fallback only). Module-level flags `_poUseEodBackend`, `_poIdToDate`, `_poNamesCache` survive module switches for the page session. No offline queue, no polling. Cross-module: fallback path reads/writes the EOD table's `paid_outs_json` via the EOD endpoints.

**Permissions & scoping.** No client role checks. Worker allows `admin`, `staff`, `user` for every operation including delete (W:4769) — the broadest of the six modules. Scoped to org+location.

**Edge cases & risks (found in code, cite line numbers).**
1. **Any 404 flips the whole module to the EOD-record backend for the rest of the session** (`isHttp404` 224–232 also matches any error *message* containing "404"; flip at 108–110, 130–132, 150–152, 168–170, 186–188, 204–206). A 404 occurs naturally when two PCs act on the same entry (PC B deletes, PC A then Edits or Deletes → W:4693/4780 return 404). After the flip, `apiList` reads only EOD `paid_outs` (403–421) so the real entries vanish from PC A's table ("No paid out entries"), the user re-enters them into a different table, and creates go to `eodCreateEntry` (427–462), which builds a record without `staff_name` and is rejected by the worker with 400 "Missing staff/staff_name" (W:4198) if no EOD exists, or 409 if the day is locked, or **overwrites the whole EOD row** (full upsert, W:4243) if it does exist — including bumping `saved_at`/`updated_at` and clobbering concurrent EOD edits. The fallback should be removed; the live endpoints exist (W:15557–15572).
2. **No lock, no period close.** Entries for any past or future date can be created, edited or deleted at any time by any role (906–938; worker validates format only). Nothing ties a paid out to the EOD day it was taken from, so the EOD "D Paid Outs" section is typed separately and can disagree.
3. **"Print Month" prints whatever is loaded**, i.e. the current search-filtered subset (1386–1390 uses `state.entries`), under the heading "Paid Out — Month Report"; a filtered print is indistinguishable from a full one.
4. **Receipt/report numbers are not stable identifiers**: the receipt shows no entry id or sequence number (788–837); a reprint after an edit shows different figures with no "amended" marker.
5. Fee input is `type=number step=0.01` (883); client sends raw Number, worker rounds to 2 dp (W:4441–4446) — fine, but totals are summed client-side with floating point (45–53) and formatted with `toFixed(2)`; no server totals.
6. Date default `ymd(new Date())` and time `hm(new Date())` from the PC clock (865–866); `monthRange` uses `Date.UTC` then formats in local time (851–861) — correct for Malta but the worker month filter is UTC-string based (W:1461–1471); consistent.
7. Delete confirm has Cancel as the primary (Enter) button (1282) — safe default, but the Delete button runs `apiDelete` with no in-flight guard; double click → second call 404 → triggers risk 1.
8. The entry modal reads form fields via `document.querySelector(".eikon-modal-overlay")` (950–951); if another overlay is open the wrong DOM is read and Save silently validates empty values ("Invalid date").
9. Suggest dropdown issues one GET per keystroke with no debounce (1052, 1023–1046) — sequence-guarded, but still N requests.
10. Silent catches: 459, 522, 643 (fallback name cache), 1399.

**Speed notes.** 1 GET per load (month list, up to a few hundred rows, ~tens of KB). Autocomplete: 1 GET per keystroke. Report: 1 GET. Fallback mode: 1 GET for dates + 1 GET per EOD day (N+1), sequential (403–421), and the report multiplies that per month (564–580).

**Must not be lost.**
- Paid-out receipt with payee, amount, method, invoice/cheque number, reason and a client signature line (proof of cash leaving the till).
- Monthly register and date-range report grouped by payee with subtotals (accountant reconciliation against EOD "D").
- Payee autocomplete from previous entries.
- Cash vs cheque distinction with cheque number.
- Edit/delete with a confirmation (ideally restricted and audited; today audit exists only server-side).

---

## Credit Notes  (`modules.creditnotes.js`, id `creditnotes`, order 230, visible to: all pharmacy-mode logins; worker allows `admin`/`staff` only)
**Purpose.** Register of customer credit notes with amount, expiry, purchase draw-downs, notes, open/closed status, printable note and list.

**Functions.**
1. Open module → load all credit notes (max 1000) with purchases and notes embedded — where: render (840–926); API: GET /creditnotes/list (197–224).
2. Stats bar: Open Notes count, Total Outstanding (sum of remaining on open notes) — where: 489–503; API: none.
3. Search (name, surname, phone, email, receipt no, id) filters both tables live — where: 914–919, 173–186.
4. Refresh — where: 907; API: GET /creditnotes/list.
5. "+ New" → inline new-note form (issue date, first name, surname, telephone, email, receipt no, amount, expiry date, "Does not expire") → Create — where: 908–912, 791–838, 251–276; API: POST /creditnotes/entries.
6. Open Credit Notes table (date, client, phone, balance) → click row selects and shows detail panel — where: 505–541.
7. Closed Credit Notes table (hidden when empty) with reason "Fully used" / "Expired dd/mm/yyyy" → click selects and scrolls to detail — where: 543–593.
8. Detail panel: header with status badge, stats (issued, amount, remaining, expiry), edit form, Save Changes, Delete — where: 619–789; API: PUT /creditnotes/entries/:id (264), DELETE /creditnotes/entries/:id (291).
9. Detail: Purchase Entries list with ✕ delete per entry; Add Entry (amount, receipt no; Enter key submits) — where: 637–657, 734–738, 303–336, 783–788; API: POST /creditnotes/entries/:id/purchases, DELETE /creditnotes/entries/:id/purchases/:pid.
10. Detail: Notes list with ✕ delete; Add Note (Enter submits) — where: 659–676, 740–745, 338–365, 774–780; API: POST /creditnotes/entries/:id/notes, DELETE /creditnotes/entries/:id/notes/:nid.
11. Detail: "🖨 Print" → print window with credit note (#id, issued, printed-at, client, phone, email, receipt, expiry, amount, purchase history, remaining balance, notes, OPEN/CLOSED badge), auto-prints — where: 376–451; extras: print.
12. "🖨 Print List" → prints the currently filtered **open** notes (date, client, phone, balance/total, status) — where: 453–484, 913; extras: print.
13. "Does not expire" checkbox dims/disables expiry input — where: 764–772, 823–831.
14. Busy state disables all action buttons during API calls — where: 226–233.
15. Toasts (3.6 s) for validation and results — where: 77–93.

**Data & state.** Tables `credit_notes`, `credit_note_purchases`, `credit_note_notes`. No localStorage, no offline queue, no polling. Global side effects: `window._cnDelPurchase` and `window._cnDelNote` are installed on the page (845–846) and persist after leaving the module. Module `state` (rows, selection, query) persists for the page session.

**Permissions & scoping.** No client role check; worker `admin`/`staff` for all operations. Notes list/create/update/delete are scoped to org+location, but **purchase delete and note delete check `org_id` only** (W:7648–7650, 7676–7678) — any staff of another location in the same org can delete a purchase if they know the ids.

**Edge cases & risks (found in code, cite line numbers).**
1. **Open/closed status and remaining balance are computed only on the client** (119–150, 168–169) from the browser clock; the server stores no status and never checks that a purchase ≤ remaining (W:7625–7643). A credit note can be drawn down past zero (negative remaining is displayed in red, 686, and the note just becomes "closed"); two PCs adding purchases simultaneously both succeed.
2. **Purchase and note deletes have no confirmation** — the ✕ buttons call `window._cnDelPurchase(id)`/`_cnDelNote(id)` directly (650, 670, 326–336, 355–365). Deleting a purchase silently re-opens a used credit note and increases "Total Outstanding".
3. **Unsaved edits are lost on any other action.** Add Entry / Add Note / delete all call `doRefresh()` (321, 333, 350, 362) which rebuilds the detail form from the server (619–789); edits typed into name/phone/amount but not yet saved disappear.
4. **Amount can be edited after purchases exist** with no guard (251–276; W:7579–7610); lowering it below purchases flips the note to closed and skews stats; no audit of the previous amount in the UI (server logs only names).
5. **List limit 1000 with no pagination** (W:7521) — once a location exceeds 1000 notes the oldest open notes silently disappear from the UI and from "Total Outstanding".
6. `normalizeRow` calls `JSON.parse(r.notes)` / `JSON.parse(r.purchase_entries)` when they arrive as strings (165–166) without try/catch; one malformed row breaks the entire list load (`modalError("Refresh failed")`, 219).
7. Expiry comparison parses `YYYY-MM-DD` with `new Date()` (UTC midnight) then `setHours(23,59,59,999)` local (134–137, 580) — fine in Malta; but "expired" is evaluated at render time only, so a note open at 23:00 is still printed OPEN at 23:59 and closed on next refresh; no server timestamp of expiry.
8. Print List prints only open notes (454) even if the user is looking at the closed table; there is no closed-notes print.
9. `doSave` for a new note sets `state.selectedId = crt.id` then `doRefresh()` (270–273); if the worker returns no `id` (W:7574 relies on `meta.last_row_id`), the new note is created but nothing is selected and the form stays as if unsaved.
10. Duplicate detection: none (same client/receipt can be entered twice; W:7569).
11. `setBusyUI` only disables known ids (229); the ✕ inline delete buttons are not disabled while busy — rapid clicks fire parallel deletes.
12. Silent catch: 90–91 (toast DOM), 32.

**Speed notes.** One GET returning every credit note with all purchases/notes embedded (3 queries server-side, W:7515–7531); payload grows with history (1000 notes × entries). Every action re-fetches the whole list and re-renders three tables + the detail panel via `innerHTML`.

**Must not be lost.**
- Credit note record: client name/surname/telephone, issue date, amount, expiry or "does not expire", original receipt number.
- Purchase draw-downs with timestamp and receipt number, remaining balance, automatic open/closed (fully used or expired) with the closed reason.
- Printable credit note (status, history, remaining) and printable open list.
- Free-text notes with timestamps.
- Total outstanding liability figure (accounts need it at year end).

---

## Locum Receipts  (`modules.locumreceipts.js`, id `locumreceipts`, order 260, visible to: all pharmacy-mode logins; worker allows `admin`/`staff`; edit/delete/report additionally require a shared password)
**Purpose.** Issue and print signed payment receipts to locum pharmacists (hours × fee, Sunday/PH rate), with password-protected edit/delete and a password-protected monthly/yearly report per locum.

**Functions.**
1. Open module → load receipts for the month — where: render (616–1154); API: GET /locumreceipts/receipts?month (201–207).
2. Month picker (onchange) and Refresh — where: 860–865; API: as 1.
3. Create Receipt form: date (default today), hours (step 0.25), name & surname, registration number, Day Type auto (Normal / Sunday-PH computed from date), fee per hour (auto-prefilled from remembered rate for that day type), live Total Fee KPI — where: 650–702, 781–837; API: none until save.
4. Save Receipt / Save & Print — validates, posts, clears hours, remembers fee, refreshes; Save & Print opens the receipt tab which auto-prints and auto-closes — where: 867–925, 234–299; API: POST /locumreceipts/receipts; extras: print.
5. Receipts table — **shows only the single latest receipt of the month** — with View / Print, Edit, Delete — where: 439–517, 704–728; API: none for print.
6. View / Print a receipt (name, reg no, day type, hours, fee/hr, total, signature line) — where: 847–854; extras: print.
7. Edit → password prompt (client compares to `"!4321"`), then modal (date, hours, name, reg, day type auto, fee; live total), Save — where: 927–1053; API: PUT /locumreceipts/receipts/:id with header `X-Eikon-Edit-Pass`.
8. Delete → password prompt, then confirm modal → delete — where: 1055–1090; API: DELETE /locumreceipts/receipts/:id with `X-Eikon-Edit-Pass`.
9. Report: month or year, "Generate Month" / "Generate Year" → password prompt (client compares to `"Report1234!"`) → per-locum sections (date, day type, hours, fee/hr, total) with totals and an all-locums summary — where: 1092–1134, 519–614; API: GET /locumreceipts/report?month|year with header `X-Eikon-Report-Pass`.
10. Print Report (auto-print, auto-close) — where: 1136–1149, 301–399; extras: print.
11. Automatic: fee memory per day type saved to localStorage on every fee keystroke and on date-type change — where: 781–789, 818–834, 166–192; localStorage `eikon:locumreceipts:feeMem`.
12. Automatic: Malta Sunday/PH detection (fixed list + computed Good Friday) — where: 54–136.

**Data & state.** Table `locum_receipts` (receipt_date, hours, locum_full_name, registration_number, day_type, fee_per_hour, total_fee computed server-side W:5781, created_by). localStorage: `eikon:locumreceipts:feeMem` (per browser, not per locum). Module `state.receiptsByMonth` cache for the session. No offline queue, no polling. Cross-module: none; locum names/registration numbers are free text, not linked to `shift_staff` or `locum_register_entries`.

**Permissions & scoping.** No client role check; worker `admin`/`staff`. Edit/delete/report are gated by **hard-coded shared passwords present in client source** (929, 1057, 1094) and in the worker (W:5662–5663), identical for every organisation. The client compares first; the worker also checks the header (W:5814, 5884, 5918), so the server check is real but the secret is public. Scoped to org+location.

**Edge cases & risks (found in code, cite line numbers).**
1. **Passwords in source.** `"!4321"` and `"Report1234!"` are literal strings in the shipped JS (929, 1057, 1094) and are global constants on the worker; anyone with devtools has them for every pharmacy. No per-user authorisation, no audit of who supplied the password (server audit records `authUser` only).
2. **Only the latest receipt is visible/actionable** (444–458 keeps `rows[0]`). To reprint, edit or delete any earlier receipt of the month staff need the report password; there is no per-receipt lookup. An inspector asking for "all receipts for locum X in March" must go through the password-protected report.
3. **Fee memory is per browser and per day type, not per locum** (781–789, 804–812). After paying locum A at €35/h, the form for locum B is pre-filled with €35/h; a Save & Print without re-checking issues a receipt at the wrong rate. Fee changes are also saved to memory on every keystroke (831–834), so a half-typed "3" becomes the remembered rate.
4. **Day type is computed client-side and trusted by the server** (873, 984; W:5770–5778 validates only `normal|holiday`). The holiday table (56–70) is Malta's fixed list plus Good Friday; any legislative change requires a redeploy and the Shifts module keeps a separate, differently-sourced list (shifts 268–275).
5. **Hours up to 24 accepted** with no cross-check against the Locum Register or Shifts for that day (878–879); total = round2(hours × fee) server-side — good — but the UI preview uses the same formula client-side and `Save & Print` falls back to the client payload if the server omits `receipt` (900–902).
6. Receipt number is the DB autoincrement id (243), shared across all orgs/locations in D1, so numbers are not sequential per pharmacy and gaps appear after deletes; no "void" status — deletes are hard deletes (W:5899–5903).
7. `openEdit` dispatches a synthetic change on the date input on open (1050) which, if the stored `day_type` disagrees with the computed one, silently overwrites the fee with the remembered rate when the fee field is empty (1036–1045) — stored `day_type` is never shown or respected; the printed receipt recomputes day type from the date (242, 320), so a receipt saved as "holiday" on a non-listed date prints as "Normal Day".
8. Print tabs auto-close after `afterprint` (296, 396); a cancelled print dialog still closes the tab, so "Save as PDF" is fiddly and nothing is retained on screen.
9. `loadReceipts` throws on `!resp.ok` but `refresh()` errors are only `E.error`-logged (861, 864, 896) — on a failed load the table keeps the previous month's single row with no message.
10. Report `generated_at` is the worker's UTC time string (W:6009) printed without zone.
11. Silent catches: 174–182, 185–191, 800–801, 1021, 1046, 1051.

**Speed notes.** 1 GET per load/month change (month of receipts, small). Report: 1 GET with server-side grouping and rounding (W:5961–6013). Print tabs are blob URLs revoked after 60 s.

**Must not be lost.**
- Locum receipt with name, registration number, date, day type (Sunday/PH vs normal), hours, fee/hr, total and signature line — the pharmacy's proof of payment and the locum's income record.
- Different rate for Sunday/public holiday with automatic day-type detection.
- Per-locum monthly/yearly report with hours and fee totals, and an all-locums summary (accounts/tax).
- Restricted edit/delete/report access (today a shared password; must become role-based and audited).
- Server-side total calculation and rounding.

---

## Locum Register  (`modules.locumregister.js`, id `locumregister`, order 90, visible to: all pharmacy-mode logins; worker allows `admin`/`staff`)
**Purpose.** Statutory attendance register of locum pharmacists on the premises (date, time in, time out, name, registration number) with a printable monthly register.

**Functions.**
1. Open module → load month's entries — where: render (260–432); API: GET /locumregister/entries?month (26–33).
2. Month picker (onchange) and Refresh — where: 371–377; API: as 1.
3. Add Entry: date (default today, past dates allowed), time in, time out (optional), name & surname, registration number → Save (clears time out only) — where: 290–321, 400–428; API: POST /locumregister/entries.
4. Register table (date, in, out, name, reg no) newest first — where: 35–72; API: none.
5. Row Edit → modal (all five fields) → Save — where: 74–143; API: PUT /locumregister/entries/:id.
6. Row Delete → confirm modal → delete — where: 145–172; API: DELETE /locumregister/entries/:id.
7. Print → monthly register table sorted ascending by date/time-in, auto-prints — where: 380–398, 178–233; API: GET entries only if the month is not cached; extras: print.

**Data & state.** Table `locum_register_entries`. No localStorage, no offline queue, no polling. Module `state.entriesByMonth` cache for the page session. Cross-module: none (names are free text; not linked to Shifts staff or Locum Receipts).

**Permissions & scoping.** No client role check; worker `admin`/`staff`; scoped to org+location.

**Edge cases & risks (found in code, cite line numbers).**
1. **Edit and delete of a legal register are unrestricted and unconfirmed-by-password**; delete has a confirm (145–172) but edit has none, and both are hard operations (W:5602–5608, 5640–5645). A statutory register normally needs append-only behaviour or a visible amendment trail; the UI shows none (no created_at/updated_at columns although the API returns them, 47–51).
2. **No "clock out" path.** Time out is optional (305, W:5547) and can only be filled later via Edit of the row; there is no validation that time out ≥ time in on client or server (112–118, 402–408; W:5545–5549), and an overnight shift cannot be expressed.
3. **Print uses the cached month** (385–388): entries added from another PC after this PC loaded the month are missing from the printed register until Refresh; the print carries no location name, no "printed at", and no page totals/signature line.
4. Save does not clear date/in/name/reg (419) — convenient for repeat entries but makes accidental duplicate submission (double-click; no in-flight guard, 400–428) likely; no duplicate check server-side.
5. Errors on load are only `E.error`-logged (372, 376, 430 rethrows into render) — a failed month load leaves the previous table on screen with no message.
6. Date is a free `type=date` with no upper bound: future-dated attendance can be recorded (298, W:5545).
7. `renderTable` recreates `openEdit`/`openDelete` closures per render (74, 145) capturing `tbody`; harmless, but after an edit the table is re-rendered from a fresh month load even if the edited entry's date moved to another month (130–132), so the row simply disappears with no feedback.

**Speed notes.** 1 small GET per load/month; print reuses it. Negligible render cost.

**Must not be lost.**
- Append-only register of locum presence: date, time in, time out, full name, registration number (inspectors ask for it).
- Ability to back-date an entry and to complete time out later, with time-out ≥ time-in validation.
- Printable monthly register sorted chronologically, ideally with location, printed-at and signature line.
- Month filter and retrieval of past months.

---

## Could not be determined from code

- Whether `modules.audit.js` surfaces the worker's `audit_log` rows for EOD/Paid Out/Locum/Credit Notes (out of scope here); within these six modules nothing reads it.
- Whether the worker's `ensure*Schema` migrations have run on production D1 (e.g. `paid_out_entries` columns) — affects whether the Paid Out 404 fallback has ever triggered in practice.
- Actual user-role distribution (how many `user`-role logins exist); it determines how often EOD silently runs in local-only mode.
- Browser/popup policy of the pharmacy PCs: several print paths depend on `window.open` of blob URLs and `document.write`, and locum receipt/report tabs self-close after printing.
- Whether `E.modal.show` honours the `danger` flag used by Shifts/Locum modals (core.js not fully reviewed); cosmetic only.
