# A1 — Core shell + "Today" modules (Dashboard, Alerts, Instructions, Chat Board)

Scope: `ui/core.js`, `ui/modules.dashboard.js`, `ui/modules.alerts.js`, `ui/modules.instructions.js`, `ui/modules.messageboard.js`. Worker handlers (`cloudflare-worker/code`) were consulted only to confirm what each API call does; line numbers prefixed `W:` refer to that file, all other line numbers refer to the UI file of the section.

Conventions used below: "client-only" = a check that exists in the browser but is not enforced by the worker for that call; "LWW" = last-writer-wins overwrite with no version check.

---

## Core shell  (`core.js`, id `core` (not a module), order n/a, visible to: everyone; Switch Portal only for multi-role users; Cherubino category only org_id 12)
**Purpose.** Boots the single-page app: splash, login, role/portal selection, sidebar + router, modal and help overlays, the shared `apiFetch`, and the supplier-portal badge poll.

**Functions.**
1. Intro splash (GIF then static logo, min 4.93 s, hidden only after min time AND first screen rendered) — where: automatic at script load and in `E.start()`; API: none; extras: disabled with `?intro=0|false|off|no` (L23-150).
2. Debug level from `?dbg=N` (persisted to localStorage `eikon_dbg`) or from that key; dbg≥2 posts every log line (incl. request headers) to `window.parent` via `postMessage("*")` — where: URL/localStorage; API: none (L153-209).
3. Global crash overlay for `window.error` / `unhandledrejection` (full-screen, no dismiss button, must reload) — where: automatic (L212-228, 394-419).
4. `E.apiFetch(path, opts)` — adds `Authorization: Bearer <token>`, JSON content-type for string bodies, parses JSON regardless of content-type, throws `Error(json.error || "HTTP n")` with `.status/.bodyText/.bodyJson` on non-2xx; no timeout, no retry, no 401 handling (L250-308).
5. Token storage in localStorage key `eikon_token` (`getToken/setToken/clearToken`) (L241-244).
6. Module registry `E.registerModule({id,title,order,icon,render})` (L312-316).
7. Login screen: email (lowercased, trimmed) + password (trimmed); Enter in either field submits; button disabled while in flight; error re-renders the form (losing typed values) — where: login screen; API: `POST /auth/login` (L605-683).
8. Session restore on load: if token present, `GET /auth/me`; on any failure clears token and shows login with "Session invalid" — where: automatic in `E.start()` (L1299-1331).
9. Role/portal selection screen (Pharmacy / Supplier / Company Administrator tiles; inaccessible tiles greyed; Logout) — where: after login or when no saved role; roles derived client-side from `location_id` ranges 0-399 / 400-599 / 600-900, superuser email gets all three (L352-367, 686-767).
10. Saved portal auto-restore via localStorage `eikon_active_role` (L772, 1314-1325).
11. Portal boot: Pharmacy → `SIDEBAR_CATEGORIES` (+ "Cherubino" category when `org_id === 12`), dashboard `dashboard`; Supplier → `SUPPLIER_CATEGORIES`, dashboard `supplier-dashboard`, starts supplier poll; Company admin → `COMPANY_ADMIN_CATEGORIES` (+ Cherubino for org 12), dashboard `company-dashboard` (L770-811).
12. Shell: sidebar (brand, collapse button persisted in `eikon_sidebar_collapsed`), topbar (logo, module title, "Name • Location", Switch Portal, Logout, Fullscreen), content mount `#eikon-content` (L814-935).
13. Sidebar categories as an accordion (one expanded at a time, persisted in `eikon_sidebar_cat`), dashboard pinned on top, modules sorted by `order` (L973-1091).
14. Sidebar module search (150 ms debounce, substring on title, matches across ALL registered modules, not only the active portal's) (L1092-1131).
15. Help & Guides overlay: category list from `HELP_CATEGORIES`, content from `help-content.js` injected as raw HTML; close by × or backdrop click — where: last sidebar item; API: none (L491-602, 1133-1144).
16. Switch Portal (clears `eikon_active_role`, returns to role selection; does NOT stop the supplier poll) (L871-885).
17. Logout (clears token, role, poll interval, state; shows login) — where: topbar + role screen; API: none (server session is NOT revoked) (L1199-1210).
18. Fullscreen / Exit Fullscreen: opens `https://eikon-api.labrint.workers.dev/ui/index.html` + query + hash in a new tab, or navigates back to `https://swiftdataautomation.com/eikon` (hard-coded hosts) (L891-931).
19. Hash router: `#<moduleId>` → `renderActiveModule`; unknown id falls back to the section dashboard; module `render()` exceptions shown as a "Module crashed" card; `hashchange` listener ignored while logged out (L1212-1266, 1292-1296).
20. Shared modal `E.modal.show(title, html, actions)` / `hide()` with a nesting stack (nested modal restores previous DOM incl. input values); backdrop click = hide (L422-489).
21. Supplier badge poll: every 30 s `GET /supplier-orders/feedback` and `GET /supplier-orders/received`; counts unresolved feedback and pending orders into nav badges + `nav-flash`; failures swallowed (L1166-1197).
22. Topbar title/user label refresh on every route change (L1234-1247).

**Data & state.** Endpoints: `/auth/login`, `/auth/me`, `/supplier-orders/feedback`, `/supplier-orders/received`. localStorage keys: `eikon_token`, `eikon_dbg`, `eikon_active_role`, `eikon_sidebar_collapsed`, `eikon_sidebar_cat`. Globals exposed to modules: `E.apiFetch, E.modal, E.escapeHtml, E.q/qa, E.log/warn/error/dbg, E.state.{user,activeModuleId,activeRole}, E.getToken, E.showHelpGuide, E.registerModule, E.HELP_CONTENT`. `E.state._unresolvedFeedbackCount/_pendingOrdersCount` are set by the poll but no other module reads them. `E.showToast` / `E.toast` are referenced by dashboard, nearexpiry, clientorders and cherubino modules but are never defined anywhere, so those toasts silently never show. No offline queue. No unmount lifecycle: `renderActiveModule` just wipes `innerHTML` (L1250), so module timers/listeners survive navigation.

**Permissions & scoping.** All role/portal logic is client-only: `getRolesForUser` (L352-367) is a location-id range convention and `SUPERUSER_EMAIL` is hard-coded (L350). The router (L1225) renders any registered module whose id is typed in the hash, regardless of portal or org (e.g. a supplier user can open `#temperature`, any org can open `#cherubino-orders`); protection relies entirely on per-endpoint worker checks (`requireRole(admin|staff)` and org/location scoping). The worker's superuser notion (`SUPERUSER_EMAILS` env + `role === 'admin'`, W:195-202) differs from the UI constant.

**Edge cases & risks (found in code, cite line numbers).**
- Session expiry is never handled: `apiFetch` throws a generic error on 401 (L300-306) and nothing redirects to login; after the 30-day server TTL (W:1404) every module shows "Unauthorized"/"HTTP 401" until the page is reloaded.
- Browser Back on the role-selection screen (or any hash change before the shell exists) → `renderActiveModule` throws "Missing #eikon-content mount" (L1221) from an un-awaited call (L1295) → `unhandledrejection` → full-screen crash overlay with no close button (L220-226, 394-419).
- `apiFetch` has no timeout (L276): if `/auth/me` hangs the intro overlay never clears (L1308, 141-147).
- dbg≥2 posts request headers including the Bearer token to `window.parent` with target origin `*` (L185-192, 264-268) — token leak to any embedding page.
- Switch Portal does not clear `_supplierPollInterval` (L877-883 vs L1201); after switching Supplier→Pharmacy the two supplier GETs keep firing every 30 s for the session.
- Modal backdrop click closes any form without confirmation (L437-439) — half-filled Add Alert / quick-entry forms are lost.
- Users whose `location_id` is >900 or outside the three ranges get a role screen with every tile disabled and can only log out (L362-366).
- Login trims the password (L638); passwords with leading/trailing spaces cannot log in.
- Logout does not revoke the server session (L1199-1210); token stays valid server-side for the rest of its TTL.
- Help content is injected unescaped (L560, 592-597); acceptable only while `help-content.js` is trusted static code.
- Sidebar search exposes modules outside the active portal (L1108-1110).
- Cherubino visibility hard-coded to `org_id === 12` (L776, 797).

**Speed notes.** `index.html` loads ~55 scripts sequentially with `?v=Date.now()` cache-busting on every load (no caching at all) plus SheetJS from a CDN; the splash enforces ≥4.9 s. Boot = 1 request (`/auth/me`). Supplier portal adds 2 requests / 30 s. Shell re-render is cheap; `renderNav` rebuilds the whole nav on each portal boot.

**Must not be lost.**
- Persistent login across reloads with saved portal, plus explicit portal switching for multi-role (superuser) accounts.
- Hash-addressable modules (`#alerts`, `#instructions`…) — every dashboard "Open" button, help link and bookmark depends on it.
- Nested-modal stack that preserves form input when an error dialog pops over a form.
- "Module crashed" isolation: one broken module must not take the shell down.
- Supplier portal badges/flash for pending orders and unresolved feedback.
- Help & Guides overlay per module.
- Fullscreen escape from the embedding site (`swiftdataautomation.com/eikon` ↔ workers.dev).

---

## Dashboard  (`modules.dashboard.js`, id `dashboard`, order 1, visible to: Pharmacy portal (all roles); "Diag" button only when dbg≥1)
**Purpose.** One-screen status board of 17 checks across modules, with quick-entry modals (temperature, cleaning, daily register, prescription label), drill-down detail modals and an OTC cross-sell lookup.

**Functions.**
1. Auto-refresh of all checks on every render (parallel tasks, 5–9 s per-request timeouts, incremental rendering) — where: on load; API: see 5–21 (L1151-1502, 3154).
2. Refresh button (disabled while loading) + "Updated HH:MM" stamp — where: header; API: all below (L3096, 722-723).
3. Diag modal (per-task status/ms/last error) — where: header, dbg≥1 only (L2137-2173).
4. OTC Cross Sell search (static JSON index, 120 ms debounce, ↑/↓/Enter/Esc keys) → selected chip → modal with symptom-chip filter, complementary products grouped by brand, sibling products for the same symptoms; clicking a row re-centres — where: Today card; API: static `productmap-data/search-index.json` + `productmap-data/neighbours/<type>/<id>.json` (L2497-3027).
5. Temperature (today): devices with no entry today; "Quick enter" + "Open" — API: `GET /temperature/devices?include_inactive=1`, `GET /temperature/entries?month=` (L1228-1234, 725-745).
6. Temperature quick-entry modal: min/max/notes per missing device, one `POST /temperature/entries` per device, sequential — where: Today row (L1513-1594).
7. Daily register (today): count of today's rows; "Quick enter" + "Open" — API: `GET /daily-register/entries?month=` (L1236-1240, 747-765).
8. Daily register quick-entry modal → `POST /daily-register/entries` (L1650-1710).
9. Paid out (today) total € — API: `GET /paid-out/entries?month=&_ts=` (L1242-1254, 767-774).
10. Instructions & handover: today's notes + yesterday's handover bullets, "View" modal + "Open" — API: `GET /instructions/daily?month=` (current and, around month start, previous month) (L1256-1286, 776-799, 2095-2135).
11. Prescription Label row: "Create" opens quick label modal; "Open" → `#labels` (L1128).
12. Prescription label modal: optional patient (autocomplete from history), drug (autocomplete + autofill of dose/route/freq/instructions/warnings from last label), dose, route, frequency, custom instructions, 20 toggleable warning pills; "Print Label" saves to history then opens a print window — API: `GET /labels/state` (twice), `PUT /labels/state`; extras: print (blob URL popup, auto `window.print`, auto-close) (L2242-2492).
13. Chat Board row: unread mentions / unread messages / latest message preview, flashes when mentions>0 — API: `GET /board/dashboard` (L1417-1421, 1021-1058).
14. Cleaning (14 days): last record, overdue flag; "Quick enter" + "Open" — API: `GET /cleaning/entries?month=` (1–2 months) (L1289-1303, 801-819).
15. Cleaning quick-entry modal → `POST /cleaning/entries` (L1596-1648).
16. Certificates (expired / due ≤30 d) + Details modal — API: `GET /certificates/items` (L1305-1309, 821-844, 1712-1738).
17. Alerts needing attention (any of 7 checkboxes unticked, all years, status ignored) + Details modal (max 25) — API: `GET /alerts/entries?ts=` (L1311-1315, 846-864, 1801-1843).
18. Returns incomplete over last 6 months + Details modal (max 25) — API: 6× `GET /returns/entries?month=` (L1323-1332, 866-884, 1845-1881).
19. Near expiry (expired / ≤30 d, excluding handed_over) + Details modal (15+15) with per-row "Return" (→ Create Return modal → `POST /near-expiry/entries/create-return`) and "Add to Scarce Stock" (→ modal → `POST /scarce-stock/offers`) — API: `GET /near-expiry/entries` (L1317-1321, 886-909, 1883-2067).
20. Scarce stock: open requests from other locations + my offers awaiting acceptance (row flashes) — API: `GET /scarce-stock/needs?ts=` (L1366-1392, 958-987).
21. Stock transfers: pending requests on my items + dispatched items awaiting my confirmation (flashes) — API: `GET /stock-transfers/items?ts=` (L1394-1415, 989-1019).
22. Supplier Updates: unseen stock changes in last 7 days (deduped per product+supplier, "added" ignored), Details modal, plus one toast per supplier — API: `GET /supplier-products/changes?since=` (L1423-1427, 1060-1104, 1740-1799).
23. Shifts coverage: scans every day of this and next month for pharmacist gaps vs opening hours/leaves/public-holiday table; Details modal (max 31 days) — API: `/shifts/staff?include_inactive=1`, `/shifts/opening-hours`, `/shifts/settings`, `/shifts/leaves?year=` (×1–2), `/shifts/assignments?year=&month=` (×2) (L443-647, 1434-1483, 2069-2093).
24. Client orders active (unfulfilled) over last 6 months — API: 6× `GET /client-orders/entries?month=` (L1335-1352).
25. Client tickets open — API: `GET /client-tickets/entries?_ts=` (L1354-1364).
26. Supplier Orders pending/shipped — API: `GET /supplier-orders/sent?status=pending,shipped` (L1429-1432, 1106-1126).
27. "Open" navigation buttons for every row (hash change) (L3060-3076).

**Data & state.** ~35 GET requests per refresh (see Speed). Module-level `state.data` cache; `refreshToken` discards stale results. No localStorage. Static cross-sell JSON fetched with `cache: "force-cache"` from `window.EIKON_PRODUCTMAP_BASE` (never set in this repo → relative path). Cross-module: writes to temperature, cleaning, daily register, labels, returns, scarce stock tables through their own endpoints; navigates to 17 other modules; relies on undefined `E.showToast` (L1586, 1640, 1702, 1991, 2054) so success toasts never appear (only `dashToast` ones do).

**Permissions & scoping.** Everything location-scoped by the worker. No client gating except `dbg` for Diag. Supplier-change "seen" state is filtered client-side by `location_id` (L1068-1071) but the dashboard never marks changes seen, so they stay "unseen" for 7 days.

**Edge cases & risks (found in code, cite line numbers).**
- Temperature quick entry: `Number("")` is `0`, so a blank Min/Max field passes `isFinite` and is saved as 0 °C (L1566-1570) — silent false readings in a legally required fridge log; no min≤max or range check either.
- Temperature quick entry validates inside the save loop: device 1 is POSTed before device 2 fails validation (L1559-1583) — partial saves with an error shown; survivable only because the worker upserts (W:1670-1680).
- Save buttons are not disabled while awaiting: double-click on Cleaning (L1618-1646) or Daily Register (L1674-1708) creates duplicate rows; on Rx label (L2273-2377) two history entries and two print windows.
- Rx label persists the entire `labelHistory` read-modify-write (L2311-2323); the worker deletes any history id not in the submitted set (W:18478-18487), so two PCs printing within seconds lose one label record (LWW with deletion).
- Rx label history is written before printing and marks `printedAt` even if the print dialog is cancelled or the popup is blocked (L2304, 2362-2372).
- Supplier-change toasts are emitted inside `renderAll()` (L1083-1099), which runs after every task completes (L1148) → the same toasts repeat up to ~16 times per refresh once that task has resolved.
- Mention counter never clears: nothing in the UI calls `PUT /board/mentions/read`, so once mentioned the Chat Board row flashes forever (L1038-1052).
- `showDashAddToStockModal` uses `toISOString().slice(0,10)` (UTC) for `entry_date` (L2036) while every other date on the page is local (L52) — wrong day between midnight and 01:00/02:00 Malta time.
- Alerts check ignores `status` (L419-441): closed/quarantine alerts with any N/A checkbox are flagged "need attention" forever, across all years.
- Public-holiday table is hard-coded for 2025/2026 only (L466-473); from 2027 holidays are treated as normal open days and will produce false coverage gaps (or hide real ones when overrides exist).
- Daily-register quick entry does not require `client_id` client-side but the worker rejects it (L1689-1693 vs W:6134) — user sees a server error after filling the form.
- `withTimeout` never aborts the fetch and never clears its timer (L80-92); timed-out responses still consume bandwidth and may 'win' only to be discarded.
- `bindXsellSearch` adds a `document` click listener on every render (L3019) — listener leak per dashboard visit; the dashboard `handleClick` stays attached to the shared mount forever (L3140-3143).
- Cross-sell modal/dropdown build HTML with `c.score`/`sib.score` unescaped (L2761, 2914) — numeric today, trusted static data.
- Scanning 6 months of returns/client orders assumes "active" items are at most 6 months old (L1179-1189, 1324, 1336); older unfulfilled orders silently drop off the board.

**Speed notes.** Per refresh: temperature 2 (sequential, could be parallel L1229-1230), daily register 1, paid out 1, instructions 1–2 (sequential), cleaning 1–2, certificates 1, alerts 1 (all years), near expiry 1, returns 6, client orders 6, tickets 1, scarce stock 1, stock transfers 1, board 1, supplier changes 1, supplier orders 1, shifts 7 → ~34–36 requests, each a full month/list payload (alerts and near-expiry are unbounded). Rx label modal adds 2 GETs + 1 PUT of the whole label history. `renderAll` rebuilds three lists' innerHTML ~18 times per refresh. A server-side `/dashboard/summary` endpoint would replace all of this with one call.

**Must not be lost.**
- Missing-temperature-today detection per active device with one-screen quick entry (inspection-critical).
- Daily register "no record today" nudge + quick entry (legal register).
- Cleaning overdue (14-day) nudge; certificate expiry (≤30 d) warnings.
- Previous-day handover + today's notes surfaced at shift start.
- Alerts/returns incomplete-paperwork counters (credit notes = money; authorities informed = recall compliance).
- Near-expiry → create return / list on scarce stock in two clicks.
- Pharmacist coverage gap detection for this and next month.
- Quick prescription label with warning pills and history-based autofill.
- Unread chat mentions, scarce-stock offers to accept, stock transfers to confirm.

---

## Alerts  (`modules.alerts.js`, id `alerts`, order 110, visible to: Pharmacy portal; worker requires role admin|staff)
**Purpose.** Recall / quarantine register per location with a 7-step compliance checklist (team, supplier, authorities informed; return arranged, handed over, collection note, credit note).

**Functions.**
1. List alerts for previous/current/next calendar year, newest first (client-side year filter of the full list) — where: table; API: `GET /alerts/entries?ts=` (L554-577).
2. Refresh button (L599, 839).
3. Print (popup with all listed rows, year label, checklist text, auto `window.print`) — where: header; extras: print (L127-218, 841-844).
4. Add Alert modal: date, type (recall/quarantine), status (open/in progress/closed), item, batch, expiry, quantity, room/fridge, supplier, reason, notes + 7 checkboxes — API: `POST /alerts/entries` (L272-450, 846-848).
5. Edit Alert (row button or "Edit Selected") — API: `PUT /alerts/entries/:id` (full replace) (L508-512, 794-797).
6. Delete Alert with confirm modal, optimistic row removal then reconcile — API: `DELETE /alerts/entries/:id` (L514-543).
7. Select a row (click) → checklist panel shows its 7 checkboxes (L673-720).
8. Checklist autosave: ticking a box debounces 350 ms then `PUT` the whole entry; "Saving…/Saved HH:MM:SS/Save failed" indicator (L735-792).
9. Clear Selection (L798).
10. Years label updates if the year rolls over during the session (L806-807).
11. Toasts for save/delete/load errors (L95-109).
12. Automatic on load: full list fetch (L850).

**Data & state.** Endpoint set above; table `alerts_entries` (org+location scoped, audit-logged on create/update/delete W:6785, 6846, 6867). No localStorage. Module state `entries/selectedId/selectedEntry` persists across navigation (selection survives). No polling. Cross-module: dashboard reads the same list.

**Permissions & scoping.** Worker enforces `requireRole(admin|staff)` and `org_id + location_id` on every call (W:6708, 6797, 6861). No client-side role gating (none needed). Anyone with the role can delete.

**Edge cases & risks (found in code, cite line numbers).**
- Lost update in checklist autosave: if a PUT is in flight (`_checkSaving`), the next debounced save returns early (L737, 744) and is never rescheduled; a box ticked within ~300–800 ms of the previous one is not persisted although the panel ends up saying "Saved" (L758). Only a later change or Edit re-sends it.
- Checklist save PUTs the whole snapshot taken at selection time (L674, 748) — overwrites item/batch/notes edits made meanwhile on another PC (LWW, no `updated_at` check); the Edit modal has the same full-replace semantics (L438).
- Alerts older than last year are hidden with no way to view them (L51-60, 471) — an inspector asking for a 3-year-old recall record cannot see it in the UI even though it is stored.
- Full list is fetched every time with no month/year parameter (L249) although the worker supports `?month=` (W:6713) — payload grows forever.
- Add/Edit Save button is not disabled during the await (L405-447): double-click creates duplicate alerts.
- Row click selects, but Edit/Delete buttons sit in the row; Delete is confirmed (good), yet the confirm text does not state type/status.
- Delete does optimistic removal before the server reconciles (L528-534); if the subsequent `doRefresh` fails the toast says "Load failed" but the row stays gone until reload.
- No search/filter/sort controls; no distinction of closed alerts in the list other than a text column.
- Print window uses `document.write` of the current client list (L215-217); if the list is stale (another PC edited) the printout is stale.
- Alert date uses a free `type=date` with no future/past bounds (L306); `entry_date` is used for the year bucket, so a typo year hides the row.
- `modalConfirm` resolves only via buttons; closing via backdrop leaves the promise pending (L111-122) — harmless but the click handler never completes.

**Speed notes.** 1 request per load/refresh, unbounded payload (all alerts ever for the location). Table rebuilt with DOM nodes per row; fine up to a few thousand rows. Checklist tick = 1 PUT.

**Must not be lost.**
- The 7-point recall/quarantine checklist with timestamps of who/when (audit trail exists server-side only).
- Recall vs quarantine type, room/fridge storage location, batch/expiry/quantity.
- Printable register for inspectors.
- Open/in-progress/closed status and the ability to see historic alerts beyond 3 years.
- Credit-note-received tracking (money) and authorities-informed (legal).

---

## Instructions  (`modules.instructions.js`, id `instructions`, order 300, visible to: Pharmacy portal; worker requires role admin|staff)
**Purpose.** Per-location standing operating instructions (13 global sections) plus per-day notes and a colour-coded handover list that appears as "incoming" on the next day.

**Functions.**
1. Tabs: Daily & Handover / Opening-Closing / Systems / Clinical / Settings (L1159-1196).
2. Daily tab date controls: date chip, ◀ Prev / Today / Next ▶, native date picker (L800-822).
3. Month calendar (Mon-first, UTC) with markers: notes (blue), handover out (amber), incoming handover (green); click a day to select; ◀ ▶ month navigation loads that month — API: `GET /instructions/daily?month=` (L714-771, 844-861).
4. Refresh (forces reload of current + previous month) (L825-832).
5. Print (A4): all global sections + selected day notes + incoming + outgoing bullets in a popup — extras: print (L447-571, 824, 1137).
6. Permanent Handover Instructions editor (global section, always visible on Daily tab) — API: `PUT /instructions/global` (L874-880).
7. Day Specific Instructions: Edit → textarea → Save/Cancel; "Last updated" stamp — API: `PUT /instructions/daily` (L882-932).
8. Handover From Previous Day: read-only bullets from `ymd-1`; "Append to Day Notes" copies them into today's notes and saves (L934-968).
9. Handover Bullets (outgoing): severity picker (Low/Medium/Critical), textarea, Add Bullet (prepends, saves whole day) (L973-1013).
10. Edit a bullet (severity + text) / Delete a bullet (no confirm) / Clear All (window.confirm) — each saves the whole day record (L1015-1111).
11. Opening / Closing / End of Day editors (ops tab) with jump pills (L655-671).
12. POS / POYC / Ordering / Loyalty editors (systems tab) (L673-691).
13. HIV and Concerta dispensing editors with Enabled/Disabled toggle (toggle saves immediately), Doctors/Appointments, Doctors Fees, Clinic Fees (clinical tab) (L693-712, 590-606).
14. Settings tab: storage status/last error, Print, Reload (clears month cache) and a literal endpoint list (L1127-1154).
15. Flash banner ok/err auto-hides after ~4 s (re-renders the module) (L423-435).
16. Automatic on load: `GET /instructions/global`, current month and, if yesterday is in another month, previous month (L773-789, 1201-1212).

**Data & state.** Endpoints: `GET/PUT /instructions/global` (one JSON blob per location, upsert W:10694-10702), `GET/PUT /instructions/daily` (row per `ymd`, deleted when empty W:10805-10811). Module-level `state` and `net.loadedMonths` cache persist for the whole browser session; nothing is re-fetched on re-entering the module unless Refresh/Reload is clicked. No localStorage, no polling. Cross-module: dashboard reads the same daily endpoint (it handles the `records` array form via its back-compat branch, L1259-1273 of dashboard).

**Permissions & scoping.** Worker `requireRole(admin|staff)` + org/location on all four handlers (W:10648, 10680, 10725, 10790). No client gating. Any staff member can rewrite or clear every SOP.

**Edge cases & risks (found in code, cite line numbers).**
- Whole-document LWW on globals: every Save/toggle PUTs all 13 sections from this PC's cached copy (L268-282, 615-621); two PCs editing different sections overwrite each other, and because months/global are cached for the session (L211-213, 231-235, 1205-1212) PC B's copy may be hours stale.
- Whole-day LWW on handover: Add/Edit/Delete/Clear bullet and notes Save each PUT the full day record (L284-312, 987-1000, 1033-1041); concurrent bullet adds from two PCs lose one; a stale PC that clicks "Clear All" wipes bullets added elsewhere.
- Delete bullet has no confirmation (L1033-1041); Clear All uses `window.confirm` (L1096).
- All dates are UTC (L51-74, 740, 795): between 00:00 and 01:00/02:00 Malta local time "Today" is yesterday's date, the calendar highlights the wrong day, and a handover typed after midnight lands on the previous UTC day. The dashboard uses local dates, so the two modules disagree about "today" in that window.
- "Append to Day Notes" has no idempotency guard (L942-955): clicking twice appends the block twice and saves.
- `flash()` re-renders the whole module (L425, 431) — focus/caret in an open textarea is lost every time a save completes; drafts survive only because they are mirrored into `ui.drafts`.
- Incoming marker for the 1st of a month is only correct if the previous month happens to be loaded (L202-206 vs L849, 857).
- Failures are reported only as a generic "Save failed." flash (L279, 309); the local state has already been mutated (e.g. `g.text` assigned at L616 before the PUT), so the screen shows unsaved text as if saved until Refresh.
- `handover_out` arrays are accepted as-is by the worker (W:10797) — no server validation of `sev`/`id`; normalisation happens only client-side (L159-168).
- Settings tab leaks developer endpoint list to end users (L1144-1151).

**Speed notes.** Initial load 2–3 small requests; every save 1 PUT of the full blob (global blob can reach tens of KB of free text). Every state change re-renders the whole module DOM (L1167-1199) — acceptable at current size.

**Must not be lost.**
- Per-day handover bullets with Low/Medium/Critical severity that automatically become "incoming" for the next day.
- Day-specific notes per date with calendar markers.
- Permanent handover instructions always visible on the daily screen.
- The 13 standing SOP sections (opening, closing, EOD, POS, POYC, ordering, loyalty, HIV, Concerta, doctors, fees) with "last updated" stamps and the HIV/Concerta enable toggle.
- A4 print of everything for inspection/locum packs.

---

## Chat Board  (`modules.messageboard.js`, id `messageboard`, order 105, visible to: Pharmacy portal; superadmin-only parts: status cycling, comments, "View", Export CSV)
**Purpose.** Cross-pharmacy chat (organisation or all-organisations scope) with @location mentions, pinned messages, and a `#suggestion` tracker with priority/status and superadmin comments.

**Functions.**
1. Scope toggle Organisation / All (reloads feed) — API: `GET /board/messages?scope=&limit=50` (L1030-1043, 489-524).
2. Feed of last 50 messages, own messages right-aligned, location avatar/initials, ORG/ALL badge, relative time (L295-317, 384-398).
3. Load older messages (cursor `before=`) (L1049-1055).
4. Compose textarea (auto-grow, 2000 chars, Enter sends, Shift+Enter newline, Esc closes mention list) + Send button (L1136-1177).
5. Send with confirm when scope is All ("Send to All" / "Send to Organisation Only" / Cancel) — API: `POST /board/messages` (L595-656).
6. `@` mention autocomplete (300 ms debounce, location names, Enter picks first, click picks) — API: `GET /board/users/search?q=&scope=` (L929-1016).
7. `#suggestion` in a message auto-creates a suggestion (server side) and the list refreshes (L618-620; W:14996-15004).
8. Pin / Unpin any message (max 30 pinned, enforced by worker) — API: `PUT /board/messages/:id/pin` (L658-671).
9. Pinned panel with count and Show/Hide collapse (L364-382, 1044-1048).
10. Delete own message (confirm modal) — API: `DELETE /board/messages/:id` (L673-692).
11. Suggestions table (#, text, by, priority pill, status pill, date, actions) (L327-352, 400-408).
12. New Suggestion modal (text + priority) — API: `POST /board/suggestions` (L861-897).
13. Edit suggestion text (owner or superadmin) — API: `PUT /board/suggestions/:id` (L745-771).
14. Delete suggestion (owner or superadmin, confirm) — API: `DELETE /board/suggestions/:id` (L726-743).
15. Click priority pill to cycle low→medium→high (shown to everyone) — API: `PUT /board/suggestions/:id` (L694-707).
16. Click status pill to cycle open→in progress→resolved (superadmin) (L709-724).
17. View suggestion modal with comments; superadmin can Add Comment, Mark In Progress, Mark Resolved — API: `GET/POST /board/suggestions/:id/comments`, `PUT /board/suggestions/:id` (L773-859).
18. Export CSV (superadmin): fetched with raw `fetch`, shown in a textarea with "Copy to clipboard" (`execCommand`) — API: `GET /board/suggestions/export`; extras: CSV (L899-924).
19. Polling every 30 s for new messages (`after=`) and pinned list; stops when another module is active (L559-590).
20. Toasts for success/error (L49-64).
21. Automatic on load: messages + pinned + suggestions in parallel, scroll to bottom (L544-557).

**Data & state.** Endpoints above; tables `board_messages`, `board_mentions`, `board_suggestions`, `board_suggestion_comments`, `board_user_state`. Server auto-deletes unpinned messages older than 6 months (W:14882-14891). No localStorage. Module-level state; `document` click listener bound once per mount. Cross-module: dashboard uses `GET /board/dashboard`; nothing ever calls `PUT /board/mentions/read`.

**Permissions & scoping.** Client gating by hard-coded `SUPERADMIN_EMAIL = "labrint@gmail.com"` (L107, 329, 362, 711, 778) — UI hints only; the worker enforces superuser for status/comments/export (W:15126-15138, 15175, 15193) and owner-or-super for edit/delete. Priority pill is clickable for everyone (L347) but the worker rejects non-owners (W:15126) → "Failed to update priority". Message delete is own-only server-side (W:15044). Suggestions list and comments are global across all organisations (W:15086-15096). Pin/unpin is allowed for anyone on any message, including other organisations' org-scoped messages, and the pinned list has no org filter (L528; W:14909-14911) — org-private messages leak to all organisations once pinned (server issue, visible through this module).

**Edge cases & risks (found in code, cite line numbers).**
- Ordering mismatch with the worker: the initial page and `before=` pages come back newest-first (W:14940-14946) but the client renders the array top-to-bottom, scrolls to the bottom and uses `messages[length-1]` as the `after` cursor and `messages[0]` as the `before` cursor (L516-520, 564-567, 1051). Consequences: the first 50 appear reversed, polling uses the oldest id as cursor (first poll returns up to 49 duplicates which are deduped, at most one genuinely new message), and "Load older" with the newest id re-fetches the same page and prepends duplicates (no dedupe on the `before` path, L501-504). Verify in a browser; this is as the repo stands.
- Unread mentions are never marked read (no call to `/board/mentions/read`), so dashboard mention counts and flashing never clear.
- `last_read_id` is only advanced on a fresh page load (W:14949-14956); messages that arrive via polling while the user is watching still count as unread on the dashboard.
- Silent failures: `loadMessages/loadPinned/loadSuggestions` and mention search swallow errors to `console.warn` (L521-523, 530-532, 539-541, 948) — a 401/500 shows an empty "No messages yet" feed.
- `fmtDate` parses `created_at` without the `Z` that `timeAgo` adds (L70 vs L86) → suggestion dates shift by a day near midnight.
- Enter sends immediately in Organisation scope with no confirm (L1157-1171); only All scope confirms.
- Pin/unpin has no confirmation and no ownership check; anyone can unpin another pharmacy's pinned notice (L658-671).
- Mention highlight regex includes `&#39;` characters so `&`, `#`, `;`, digits extend highlights (L287); cosmetic.
- `renderUI` replaces the whole feed innerHTML every poll (L460-465); long feeds re-render every 30 s and in-progress text selection in the feed is lost.
- Export relies on deprecated `document.execCommand("copy")` (L917); no file download.
- `isOwn`/`isOwner` compare `user.user_id || user.id` (L395, 330) because `/auth/login` returns `id` while `/auth/me` returns `user_id` (W:1420, 1067) — works, but a rebuild must keep one canonical field.
- 2000-char limit is enforced by `maxlength` and the worker; `​` markers from mention insertion are stripped before send (L598) but remain in the textarea until then.

**Speed notes.** Initial load 3 parallel requests (50 messages + 30 pinned + up to 200 suggestions). Polling 2 requests / 30 s while the module is active. Mention search 1 request per keystroke burst. Full innerHTML rebuild of feed/pinned/suggestions on each render.

**Must not be lost.**
- Organisation vs all-pharmacies scope with an explicit confirmation before broadcasting to everyone.
- @location mentions that notify every user at that pharmacy, surfaced on the dashboard.
- Pinned notices (max 30) that survive the 6-month purge.
- `#suggestion` capture into a tracked list with priority, status, superadmin comments and CSV export.
- Own-message delete; 6-month retention rule communicated in the banner.
