# F1 — Supplier portal, Company-admin portal, Help system, GoDaddy embed, boot

Scope: `ui/modules.supplier-dashboard.js`, `ui/modules.supplier-products.js`, `ui/modules.supplier-received-orders.js`, `ui/modules.supplier-order-feedback.js`, `ui/modules.company-dashboard.js`, `ui/modules.admin-overview.js`, `ui/help-content.js`, `godaddy/godaddy-loader-htmlcode`, `ui/index.html`, plus the role/poll/router parts of `ui/core.js` and the worker handlers these modules call (`cloudflare-worker/code`, cited as `worker:<line>`).

Role model (client side, `core.js:346-366`): `location_id` 0-399 = pharmacy, 400-599 = supplier, 600-900 = company admin; the hard-coded e-mail `labrint@gmail.com` (`core.js:350`) gets all three. The chosen role is persisted in `localStorage.eikon_active_role` (`core.js:772`). The role only changes which sidebar categories are shown (`core.js:370-378`, `core.js:789-808`); `E.renderActiveModule` (`core.js:1218-1265`) will render **any** registered module whose id is typed into the URL hash, and `registerModule` ignores the `section` property entirely (no reference to `.section` anywhere in core). On the server only `/admin/pharmacy-overview` checks the 600-900 range (`worker:18709`); none of the `/supplier-products/*` or `/supplier-orders/*` handlers check that the caller is a supplier — they scope by `authUser.location_id`.

---

## Supplier Dashboard  (`modules.supplier-dashboard.js`, id `supplier-dashboard`, order 1, visible to: supplier portal (section "supplier"); reachable by hash from any role)
**Purpose.** Three KPI cards (products, pending orders, unresolved feedback) that deep-link into the other supplier modules.

**Functions.**
1. View product count (unique descriptions), in-stock / out-of-stock split — where: card 1; API: GET /supplier-products/entries (L27); extras: none
2. View pending-order count and shipped-order count — where: card 2; API: GET /supplier-orders/received (L40)
3. View unresolved-feedback count; card flashes red when > 0 — where: card 3 (L52, keyframes L17-18); API: GET /supplier-orders/feedback (L45)
4. Navigate to Product List / Received Orders / Order Feedback — where: click on each card (L81-83); API: none (hash change)
5. Auto-refresh all three cards every 30 s while the module is active — where: timer L108-112; API: the three GETs above
6. Automatic: timer torn down on hashchange away from the module (L114-121)

**Data & state.** Endpoints: the three GETs. Tables: supplier_products, supplier_orders, supplier_order_item_feedback (read-only). No localStorage. Module-local `_autoInterval`. Reads `E.state.activeModuleId`, `E.getHashModuleId`. In parallel, core runs its own supplier poll (`core.js:1167-1197`) hitting /supplier-orders/received and /supplier-orders/feedback every 30 s, so while on the dashboard the same two endpoints are fetched twice per 30 s.

**Permissions & scoping.** Client-only role gating. Server scopes products by org+location (`worker:2526`), received orders by `supplier_location_id` only (`worker:3062`), feedback by `supplier_location_id` only (`worker:2958`).

**Edge cases & risks.**
- L26-86: single `try/catch` around three sequential awaits; any failure shows "Failed to load dashboard data" with the error discarded (not logged) — silent catch.
- L27, L40, L45: three sequential awaits that are independent; should be `Promise.all`.
- L27 + L109: the full product table (up to 5000 rows, `worker:2705`) is downloaded every 30 s just to count it.
- L31-38: "Total Products" counts unique lower-cased descriptions, while Product List footer (`supplier-products.js:768`) counts rows; the two numbers disagree whenever deal variants share a name (which the Product List explicitly encourages, L571-574 of that file).
- L42-43: counts statuses "pending"/"shipped"; "confirmed" (allowed by `worker:3100-3104` and the status badge) is invisible.
- L100: fixed 3-column CSS grid, not responsive at phone width.
- L108: if `render` is called twice without a hashchange (e.g. core re-render), the old interval is cleared, fine; but `onHashChange` listeners accumulate if hash changes to the same module id (they only remove themselves when leaving).

**Speed notes.** 3 sequential requests per load and per 30 s tick; payload dominated by products (tens to hundreds of KB for a large catalogue). Re-render is a full innerHTML replace of three small cards.

**Must not be lost.**
- Unresolved-feedback count with red flash (the supplier's only "something is wrong" cue).
- Pending-order count as the supplier's work queue indicator.
- Deep-links into the three work modules.

---

## Product List  (`modules.supplier-products.js`, id `supplier-products`, order 10, visible to: supplier portal; reachable by hash from any role)
**Purpose.** The supplier's catalogue: file import (CSV/XLS/XLSX via SheetJS) with an editable preview, manual add, inline edit, delete, out-of-stock toggle, margin analysis.

**Functions.**
1. List products in a sortable table — where: default view (L699-770); API: GET /supplier-products/entries (L129-131)
2. Keyword search across description, barcode, stock code, batch (200 ms debounce) — where: toolbar input `#sp-search` (L588, L983-994); API: none (client filter L362-372)
3. Sort by any visible column, asc/desc toggle — where: column headers (L724-729, L1022-1035); API: none
4. Show/hide columns, persisted per browser — where: ⚙ button → "Column Settings" modal (L420-449); storage: `localStorage.eikon_sp_hidden_cols` (L409-415); description and status always visible (L407)
5. Template help: step list, column guide (required/recommended/optional), "Copy Headers" to clipboard (tab-separated) — where: "Template" button → modal (L511-583); extras: clipboard (L483-509, with execCommand fallback)
6. Add product manually — where: "+ Add Product" → modal with 13 fields, VAT select 0/5/18 (L1117-1187); API: POST /supplier-products/entries (L132-134); validation: description, cost excl > 0, retail > 0 (L1175-1177)
7. (Dead path) Edit product via the same modal — `showAddEditModal(existingRow)` supports edit (L1118, L1179) but nothing calls it with a row; no "Edit" button exists.
8. Import file: drag-and-drop or click-to-browse, accepts .csv/.xls/.xlsx — where: "Import File" → upload view (L600-612, L795-823); parsing L217-346 (first sheet only, header row 1, header aliases L166-204)
9. Import preview: editable grid per parsed row with live recalculation of cost incl/excl, discounts, profit, margin (L614-697, L851-912); per-row delete (L668, L920-924); "+ Add Row" (L690, L926-935); skipped-row error list (L625-629); traceability advisory when barcode/batch/expiry missing (L313, L619-623)
10. Confirm & Upload — where: preview footer (L691, L937-968); API: POST /supplier-products/bulk-import {rows} (L141-146) — **server performs a full replace** (`worker:2712` deletes all of the supplier's products before inserting)
11. Cancel import / Back — where: L609, L633, L692 (L817-822, L970-976)
12. Toggle In Stock / Out of Stock per product — where: status button in row (L744-747, L1038-1050); API: PUT /supplier-products/entries/:id/stock-status (L147-151); server side-effects: writes supplier_stock_changes row (`worker:2649`) and propagates the flag to every other product of this supplier with the same description/barcode/stock code (`worker:2660-2690`)
13. Delete product — where: ✕ per row → confirm modal (L763, L1053-1069); API: DELETE /supplier-products/entries/:id (L138-140)
14. Inline edit any text/number/int cell — where: double-click cell (L1072-1113); save on blur or Enter, cancel on Escape; API: PUT /supplier-products/entries/:id with a single field (L1102)
15. Deal-duplicate advisory banner when the same description appears with different qty/free combinations (L452-472, L714-721)
16. Profit / margin colour coding: ≥35 % Good, 20-35 % OK, ≤20 % Poor (L100-110)
17. Automatic: on every render the view resets to the table (L1269) — an in-progress preview is abandoned if the module re-renders (e.g. hash re-entry)

**Data & state.** Endpoints: GET/POST /supplier-products/entries, PUT/DELETE /supplier-products/entries/:id, PUT …/stock-status, POST /supplier-products/bulk-import. Tables: supplier_products, supplier_stock_changes (via stock toggle and bulk import), audit (SUPPLIER_BULK_IMPORT `worker:2783`). localStorage: `eikon_sp_hidden_cols`. External dependency: `window.XLSX` (SheetJS 0.20.3 from cdn.sheetjs.com, loaded by `index.html:123`). Cross-module: products feed the pharmacy-side inventory (`worker:2795`, visible to **all orgs**), stock changes feed the pharmacy Dashboard "Supplier Updates" (`modules.dashboard.js:1425`). Uses `E.modal`, `E.escapeHtml`, `E.apiFetch`. Toasts use class `od-toast od-toast-<kind>` (L154-163) whose CSS only exists after the Order Diary module injects it (`modules.orderdiary.js:378-384`) — never in the supplier portal, so toasts are unstyled divs appended to the end of `<body>`.

**Permissions & scoping.** No role check server-side: any authenticated user (a pharmacy account included) can POST products under their own location and they become visible to every pharmacy in every organisation through /supplier-products/inventory (`worker:2795-2820`). Supplier name on each row is the caller's `location_name` (`worker:2560`, `worker:2698`), not user-editable.

**Edge cases & risks.**
- **Full-replace import with no warning (data loss).** UI button says "Confirm & Upload (N rows)" (L691) and the file header comment is the only place the word "replace" appears (L9). Server deletes everything (`worker:2712`) and re-inserts row by row without a transaction (`worker:2720-2755`): a failure or Worker CPU/time limit mid-loop leaves a partially imported catalogue with no rollback. Every import also resets `out_of_stock` to 0 (`worker:2731-2738` VALUES …,0,…) and assigns **new ids**, so pharmacies' saved cart drafts and order items' `product_id` references go stale (the "mark Out of Stock" prompt in Received Orders then 404s). "removed"/"added"/"back_in_stock" notifications are generated for every pharmacy from a description diff (`worker:2760-2780`), so a renamed product spams every org with "removed" + "added".
- L219-223: if SheetJS failed to load the import is impossible ("Please reload the page"); nothing else degrades.
- L52, L280: any VAT rate that is not 0/5/18 is silently coerced to 18 % — a mis-typed 1.8 or 7 becomes 18 % without an error.
- L36-47, L309, L758: expiry date is free text. Excel serials are converted to dd/MM/yyyy, but ISO strings or "12/2026" pass unchanged; a purely numeric string such as "2026" typed into the preview is later displayed as a 1905 date by `excelDateToStr`. No expiry validation, no "already expired" warning.
- L277-282: rows with cost 0 or retail 0 are silently dropped from the import (listed under "Skipped rows", but the upload still proceeds without them).
- L1090-1105: inline edit saves on `blur`; after Escape (L1110) `renderAll` removes the input, and browsers that fire blur on removal will issue a PUT with the original value. Each successful inline edit triggers a full re-fetch of all products (L1103) — N edits = N PUT + N full GETs.
- L1038-1050: stock toggle success toast never mentions the server-side propagation count (`propagated`), so the supplier does not know that sibling rows were flipped too.
- L1053-1069: delete has a confirm modal but no undo and no audit entry server-side (`worker:2624-2629` writes none).
- L986-993: every keystroke (after 200 ms) rebuilds the entire table as one innerHTML string; with 5000 rows this is a visible stall.
- L469: `g[0]._desc` is never set (harmless, falls back to key).
- L1142: `r.vat_rate === 0` strict compare against a possibly-string value from the server; for existing rows with "0" the select would default to 18 (only matters for the dead edit path).
- No pagination; the whole catalogue is held in memory and rendered at once (`.sp-table-wrap` max-height 70vh, L1211).
- Toast CSS missing in this portal (see Data & state) — feedback to the supplier after save/delete is barely visible.

**Speed notes.** One GET per load (entire catalogue). Import = one POST carrying all rows (≤5000) as JSON, typically 0.5-2 MB. Every mutation is followed by a full-list GET. Table render is O(rows × visible columns) string concatenation.

**Must not be lost.**
- Spreadsheet import with header-alias mapping, required-column check and an editable preview before commit.
- Out-of-stock toggle that (a) hides the item from pharmacy ordering and (b) notifies pharmacies via the stock-change log.
- Deal variants (qty purchased + qty free) as separate rows, with the duplicate advisory.
- VAT 0/5/18 handling and cost-incl/excl/discount/retail/margin auto-calculation identical to Quotations (L49-98).
- Batch and expiry per product row (traceability advisory L621).
- Template / column guide so suppliers can self-serve.

---

## Received Orders  (`modules.supplier-received-orders.js`, id `supplier-received-orders`, order 20, visible to: supplier portal; reachable by hash from any role)
**Purpose.** Supplier work queue of pharmacy orders: inspect items, mark lines unavailable, ship with notes and a delivery date.

**Functions.**
1. List orders (Order #, Pharmacy, Date, Items, Status) — where: table (L131-166); API: GET /supplier-orders/received (L49-51)
2. Sort by any column, default created_at desc — where: headers (L140-144, L263-275)
3. Filter by status: All / Pending / Shipped / Received — where: select `#sro-status-filter` (L111-117, L278-284); note "confirmed" is missing from the list although the badge supports it (L72-83)
4. Expand an order to see items (description, barcode, stock code, qty, free, disc %, cost excl, line total, availability) and order notes from the pharmacy — where: "View"/"Collapse" button (L156, L287-307); API: GET /supplier-orders/:id (L52-54)
5. See order totals: total items (+free), cost excl, cost incl VAT, profit margin (colour: ≥25 % green, ≥15 % yellow, else red) — where: expanded footer (L184-203, L233-242)
6. Mark an item Unavailable / Available (pending orders only) — where: per-item button (L219-226, L310-351); API: PUT /supplier-orders/items/:id/unavailable {unavailable, notes:""} (L60-64, L318) then GET /supplier-orders/:id
7. Follow-up prompt "Mark as Out of Stock?" after marking unavailable when the line has a product_id — where: modal (L327-347); API: PUT /supplier-products/entries/:productId/stock-status {out_of_stock:1} (L65-69)
8. Enter notes for the pharmacy and a scheduled delivery date (defaults to today) — where: textarea + date input in expanded pending order (L246-252)
9. Ship order — where: "Order Shipped" button → confirm modal (L253, L354-392); API: PUT /supplier-orders/:id/confirm {status:"shipped", items:[{id, unavailable, qty_confirmed, notes}], supplier_notes, scheduled_delivery_date} (L55-59, L376-381); server writes audit SUPPLIER_ORDER_CONFIRM (`worker:3136`)
10. Auto-refresh the list every 30 s, **paused while any order is expanded** (L452-463); teardown on hashchange (L465-472)
11. Automatic: after shipping, list reloads and the expanded order collapses (L395-402)

**Data & state.** Endpoints above. Tables: supplier_orders, supplier_order_items, supplier_products (OOS), supplier_stock_changes (via OOS), audit. No localStorage. Module state: orders, sort, statusFilter, expandedOrderId, expandedItems, `_autoInterval` (added to `state` ad hoc at L452). Toasts: same undefined `od-toast` CSS problem as Product List (L27-36).

**Permissions & scoping.** Server: list by `supplier_location_id` (`worker:3062`); detail allowed to either side (`worker:3079`); confirm requires `supplier_location_id = caller` (`worker:3096`); item-unavailable requires same (`worker:3144-3149`). No org filter: a supplier location sees orders from every organisation (by design, since inventory is global). Client role check only.

**Edge cases & risks.**
- **Pharmacy per-item notes are destroyed** when the supplier toggles availability: L318 sends `notes: ""` and `worker:3151` writes it unconditionally. Ship then re-sends `item.notes || ""` (L373), so the wipe is permanent.
- **No state precondition on ship**: `worker:3093-3137` updates status to "shipped" regardless of current status. If the pharmacy has already pressed "Mark Received" (allowed at any time, `worker:3160-3179`), a late ship flips it back to "shipped"; conversely the pharmacy can mark "received" an order that was never shipped. Two supplier PCs can both ship the same order; the second silently overwrites notes/date.
- L368-375: `itemUpdates` is built from `state.expandedItems`; if the detail fetch failed (L301-304) the array is empty and the order ships with no item updates, and `qty_confirmed` is simply `qty_requested` — there is no partial-quantity confirmation (a "Short Quantity" can only be expressed as fully unavailable or via free-text notes).
- L358-361: ship reads `.sro-supplier-notes`/`.sro-delivery-date` with `mount.querySelector` — fine while only one order is expandable, fragile if that changes.
- L250: default delivery date uses `toISOString().slice(0,10)` (UTC) — after 22:00/23:00 Malta time it defaults to yesterday.
- L20-25 `fmtDate(new Date("YYYY-MM-DD HH:MM:SS"))`: SQLite's `datetime('now')` string is parsed as **local** time in Chrome and as Invalid Date in Safari (falls back to the raw string). Dates near midnight shift by the UTC offset.
- L456: auto-refresh is suppressed while an order is expanded; a supplier who leaves one order open sees no new orders (the sidebar badge from core still updates, creating a mismatch).
- L462: polling errors swallowed (`.catch(function(){})`).
- L364: modal text promises "notify the pharmacy" — no notification of any kind is sent; the pharmacy only sees the change when its own poll runs.
- L327-347: the OOS prompt uses `product_id` captured at order time; after any bulk re-import the id no longer exists and the PUT returns 404 "Not found".
- L235 margin thresholds (25/15) differ from Product List (35/20, `supplier-products.js:100-110`) and from Quotations help (35/20).
- No reject/cancel/split action; no picking-list print, no CSV/PDF, no search by pharmacy or product.
- L119-126: empty state keyed on `state.filtered`, not on the status-filtered list, so a filter with zero matches shows the header row only.

**Speed notes.** List GET per load/tick (one row per order, light). Expand = one detail GET. Each availability toggle = PUT + detail GET. Whole table re-rendered on every sort/filter/expand.

**Must not be lost.**
- Line-level availability marking before shipping (the only way the pharmacy learns about shorts before delivery).
- Supplier notes + scheduled delivery date on ship.
- Unavailable → Out-of-stock propagation prompt (keeps catalogue honest and warns all pharmacies).
- Pending/shipped/received lifecycle visible to both sides, with audit rows on create and confirm.
- Order totals incl. VAT and margin so the supplier can sanity-check pricing.

---

## Order Feedback  (`modules.supplier-order-feedback.js`, id `supplier-order-feedback`, order 25, visible to: supplier portal; reachable by hash from any role)
**Purpose.** Problem reports filed by pharmacies against delivered order lines, grouped per order, with a one-shot resolution per report.

**Functions.**
1. List feedback grouped by order (Order #, Pharmacy, Order Date, Reported, N issues) — where: table (L122-155); API: GET /supplier-orders/feedback (L28-30)
2. Filter: Unresolved (default) / Resolved / All — where: select (L82-87, L90-99, L229-235)
3. Sort by order #, pharmacy, order date, reported date (default dir desc on first click) — where: headers (L131-136, L238-250)
4. Expand an order to see each report: item, barcode, qty, batch, expiry, problem type (colour-coded: Not Received, Wrong Pick, Damaged, Short Quantity, Other), pharmacy notes, reported date, resolution — where: "View" (L147, L253-259; detail L160-224)
5. Resolve a report: pick Acknowledged / Replacement Sent / Credit Issued / Disputed / Resolved, optional note, Submit — where: inline select + input + button per unresolved report (L194-205, L262-283); API: PUT /supplier-orders/feedback/:id/resolve {resolution_status, supplier_notes} (L34-38); server stamps resolved_at/resolved_by (`worker:3207`)
6. Auto-refresh every 30 s, paused while an order is expanded (L338-349); teardown on hashchange (L351-358)
7. Automatic: core sidebar badge + flash for unresolved count (`core.js:1180-1186`), independent of this module

**Data & state.** Endpoint GET /supplier-orders/feedback (joined with order status), PUT …/resolve. Tables: supplier_order_item_feedback, supplier_orders. No localStorage. `apiOrderDetail` (L31-33) is defined but never used. `RESOLUTION_OPTIONS` L40.

**Permissions & scoping.** Server: list and resolve by `supplier_location_id` (`worker:2958`, `worker:3200`). Client role check only.

**Edge cases & risks.**
- **All toasts are silent.** L14 `toast()` calls `E.toast` only if it exists; `E.toast` is never defined anywhere in `ui/` (only guarded references in clientorders.js). So "Please select a resolution" (L269), "Resolved" (L274) and every error (L278) are invisible; on error the button simply reverts to "Submit".
- L20 default sort key `created_at` is not a property of the grouped objects (keys are order_id, pharmacy_name, order_created_at, latest_feedback_at) → initial sort is a no-op and the order shown is `Object.values` insertion order, i.e. ascending numeric order_id — **oldest orders first**, the opposite of the intent.
- Resolution is one-way in the UI: once set, the row shows a badge with no edit/reopen; the server allows re-resolving (`worker:3195-3210`) but no UI path exists. A wrong click on "Resolved" cannot be undone.
- L8-13 `fmtDate` has the same SQLite-string timezone/Safari problem as Received Orders.
- L348 silent polling catch.
- No link from a report to the order itself (no "open order" button), no print/export, no filter by pharmacy or problem type, no counts per problem type.
- The pharmacy is not notified of a resolution; it is only visible inside the expanded order in Supplier Inventory → My Orders (`modules.supplier-inventory.js:668-679`).

**Speed notes.** One light GET per load/tick. Rendering trivial.

**Must not be lost.**
- Problem taxonomy (Not Received / Wrong Pick / Damaged / Short Quantity / Other) and resolution taxonomy (Acknowledged / Replacement Sent / Credit Issued / Disputed / Resolved).
- Batch and expiry captured with each report (traceability for recalls/credit notes).
- Resolved-by / resolved-at stamping on the server.
- Unresolved badge/flash in the sidebar.

---

## Company Dashboard  (`modules.company-dashboard.js`, id `company-dashboard`, order 1, visible to: company-admin portal; reachable by hash from any role)
**Purpose.** Static welcome card pointing the admin to "Pharmacy Overview".

**Functions.**
1. Display static text (L13-18 of the file); no API, no buttons, no timers.

**Data & state.** None.

**Permissions & scoping.** None (static).

**Edge cases & risks.** None in code; it is a placeholder. Note that for org 12 the admin sidebar also gets a "Cherubino" category (`core.js:796-798`) — out of scope here.

**Speed notes.** Zero requests.

**Must not be lost.** Nothing functional; keep the pointer to the overview or make the overview the landing page.

---

## Pharmacy Overview  (`modules.admin-overview.js`, id `admin-overview`, order 5, visible to: company-admin portal; server-enforced for location_id 600-900)
**Purpose.** One-screen monthly compliance grid: every pharmacy in the admin's organisation × ten inspection registers, colour-coded, with a summary line and print.

**Functions.**
1. Load the grid for a month — where: on render (L326-333) and Refresh (L280, L314); API: GET /admin/pharmacy-overview?month=YYYY-MM (L65-74)
2. Navigate months: « Prev (L275, L302-305), Next » disabled at the current month (L269, L277, L306-309), "This Month" (L278, L310-313)
3. Print the grid (sidebar/topbar/buttons hidden, light palette) — where: "Print" (L279, L315); extras: window.print with @media print rules L104-118
4. Summary line: number of pharmacies, working days (Mon-Sat), count of pharmacies with Temp issues / Cleaning issues / Cert issues — where: L193-219
5. Grid rows per pharmacy; columns: Temp, Cleaning, Daily Reg, DDA Sales, DDA POYC, DDA Purch, DDA ST, Certs, Locum, Repeat Rx (L228-240, L242-257)
6. Cell semantics (client side, L124-190):
   - Temp / Cleaning: `days_with_entries / working_days`; ≥90 % green, ≥70 % amber, else red; sub-line "last: d Mon, HH:MM" (UTC)
   - Daily Reg / DDA Sales / DDA POYC / DDA Purch / Locum: "N entries"; amber if the last entry is older than 7 days; grey "No data" if zero
   - DDA ST: "Last: d Mon" + Closed (green) / Open (amber)
   - Certs: red "N expired[, M missing]", amber "N missing file(s)", green "All OK (total)", grey if none
   - Repeat Rx: red "T total, E expired", else green "T total"
7. Automatic: none (no polling). `destroy` (L342) is declared but core never calls module `destroy`.

**How the server computes it** (`worker:18706-18960`): guard 600-900 (L18709); `today` and "current month" in **UTC** (L18715-18718); working days = count of non-Sunday days from the 1st to today (current month) or to month end (past month) (L18736-18742) — no public holidays, no per-pharmacy opening days; pharmacies = `locations WHERE org_id = admin.org AND id < 400` (L18745); temperature = `COUNT(DISTINCT entry_date)` of temperature_entries in month (any device counts as the day covered; `device_count` is returned but unused by the UI); cleaning likewise; daily_register/dda_sales/dda_poyc/dda_purchases/locum_register = `COUNT(*)`, `MAX(entry_date)`, `MAX(created_at)` in month; dda_stocktakes = latest stocktake per pharmacy and whether it has `closed_at` (not month-filtered, N+1 `dbFirst` per pharmacy); certificates = expired if `date(last_date, '+interval_months months') < today` and missing-file if neither R2 key nor base64 (not month-filtered); repeat prescriptions = total and `expires_date < today`. Each block is wrapped in `try/catch` that logs and returns `{}`.

**Data & state.** Single endpoint; read-only across ten tables. No localStorage. Module state S (month, data, mount, user). `S.user` unused.

**Permissions & scoping.** The only module in this scope with a real server-side role guard. Scoped to the admin's `org_id`; a superuser whose own location is not 600-900 gets 403 and the UI shows "No data loaded." (see below). Client menu gating as elsewhere.

**Edge cases & risks.**
- L69-73: all load errors (403 Forbidden, network, 500) collapse into `S.data = null` → "No data loaded." (L284) with the real reason only in the console. An admin cannot distinguish "no permission" from "server down".
- Worker try/catch per block: if one table/query fails (schema drift, missing table in a fresh org) the whole column renders grey "No data" for every pharmacy — looks like universal non-compliance and nobody is alerted.
- L10-13 `currentYm()` is **local** time; the worker decides "current month" in **UTC** (L18718-18736). Between 00:00 and 01:00/02:00 Malta time on the 1st, the UI shows the new month (Next disabled) while the worker treats it as a past month and divides by the full month's working days, or vice versa at month end. Working-day counts also differ by one around midnight UTC.
- L141-146: "last entry > 7 days ago" is evaluated against **now**, so for any past month every transaction cell is amber. Meaningful only for the current month.
- L130 vs L203-205: grid uses 90 %/70 % bands but the summary counts only < 70 % as an "issue"; a pharmacy that is amber in the grid is not counted in the header.
- Working days exclude only Sundays; a pharmacy closed on Saturdays can reach at most 5/6 ≈ 83 % and is permanently amber. Public holidays are not excluded either (Shifts help states public holidays default to CLOSED — the two modules disagree on what a working day is).
- Temperature: a day counts if **any** device has an entry; a pharmacy with three fridges logging one is "compliant". `device_count` is available in the payload and ignored.
- Cleaning: the pharmacy Dashboard considers cleaning fine if there is an entry in the last 14 days (help-content.js L222-223), while this grid expects ≥90 % of working days — the two portals define cleaning compliance differently, so a pharmacy can be green on its own dashboard and red here.
- DDA stocktake: "Closed" is treated as good, but DDA stock takes "remain editable after closing" (help L339-340, L346), so closure is not a lock.
- Certificates: the file test counts base64 or R2 key; the expiry uses `interval_months`; certificates with no `last_date` are never "expired" and so look fine.
- No drill-down (no link into a pharmacy's register), no export (CSV/xlsx/PDF), no e-mail/scheduled report, no trend over months, no per-pharmacy thresholds.
- L39-53 dates are formatted with UTC getters without a timezone label; a 23:30 UTC entry made at 00:30 Malta time shows the previous day.
- L88-90 sticky first column with `background:var(--panel)` — fine; `min-width:900px` table scrolls horizontally on phones.

**Speed notes.** One request per month view; the worker runs ~10 aggregate queries plus one extra query per pharmacy for stocktakes (N+1), typically 200-600 ms. Payload a few KB. Render is one innerHTML.

**Must not be lost.**
- Org-wide monthly compliance grid for the inspection registers (Temp, Cleaning, Daily Register, DDA ×4, Certificates, Locum, Repeat Rx) — this is the head-office evidence trail for MMA/inspection readiness.
- Month navigation with historic months and a print layout.
- Certificate expiry + missing-document detection.
- Server-side admin role guard (the only real one).
- Working-day denominator concept (even if the rule needs fixing).

---

## Help & Guides  (`help-content.js` + `core.js:482-597`, no module id; the "?" button is appended to every portal's sidebar at `core.js:1133-1144`)
**Purpose.** Static, in-app user manual rendered in an overlay with a category sidebar.

**Functions.**
1. Open the overlay from the sidebar "Help & Guides" button (`core.js:1143`); API: none
2. Browse chapters grouped by `E.HELP_CATEGORIES` (`core.js:495-503`: General, Inspections, Operations, Sales & Clients, Inventory, Communication, Clinical, Reference) (`core.js:534-558`)
3. Read a chapter: title, subtitle, H3 sections with raw HTML bodies (`core.js:568-597`)
4. Close via × or backdrop click (`core.js:527-532`)
5. `E.showHelpGuide(moduleId)` accepts a module id for contextual help but no module ever passes one (only the generic button calls it) — contextual help is unimplemented.

**Chapters (39) and the rules/behaviours they document that are not visible in the portal modules audited here** (line numbers in help-content.js):
1. Dashboard (L16) — three cards Today/Attention/Operations; quick-entry for Temperature (only devices missing today's entry), Cleaning, Daily Register, Prescription Label (prints immediately); status pill colours; flashing cards = urgent; Supplier Updates are de-duplicated to the latest change per product; "Supplier Orders" row counts pending/shipped.
2. Temperature (L118) — min/max per device per day; out-of-range readings are recorded as-is and flagged; devices are deactivated never deleted ("preserves history for audits"); explicit limits required for vaccine fridges; back-dating allowed; offline queue with "Sync queued".
3. Cleaning (L185) — time-in on arrival, time-out added by editing; Dashboard considers last 14 days.
4. DDA Purchases (L230) — quantity ≥1, agent (supplier) + invoice number mandatory; date-range report independent of month filter.
5. DDA Sales (L273) — red highlight if same client got the same medicine within 30 days (early-supply detection); ID card normalised to 8 chars ("789M" → "0000789M"); curated DDA list; doctor name ↔ registration number auto-fill.
6. DDA Stock Takes (L316) — one stock take per audit event; "Save & Close" finalises but stock takes remain editable after closing.
7. DDA POYC (L352) — same structure as DDA Sales for POYC supply.
8. Daily Register (L380) — all fields except notes mandatory; prescriber name + registration number.
9. Certificates (L416) — renewal interval 1-120 months, next-due auto-calculated; upload overwrites previous file; "Print All" includes documents inline.
10. Emergency POS (L459) — offline-first; GS1/FMD DataMatrix, QR, EAN-13, Code128; fractional quantities ("1/6"); discount 0-10 %; cash/card/cheque; voids require a reason; queued sales sync automatically.
11. End Of Day (L516) — AM/PM, staff name required, float default €1,000; formulas: Expected Deposit = X − EPOS − Cheques − Paid Outs; Cash(E) = Till − Float; Over/Under = Cash(E) − Expected; Coins = Cash(E) − rounded deposit; BOV deposit auto-fills largest notes first until manually edited; bag number required when depositing; Lock/Unlock with audit log of Save/Lock/Unlock/Print; local save + cloud sync; comma or dot decimals.
12. Shifts (L604) — Malta Employment Law defaults; leave types Annual/Sick/Urgent Family with pro-rata entitlements; locums are self-employed with no leave; public holidays default CLOSED; pharmacist-coverage indicator; iCal export; Month Apply pattern fill.
13. Credit Notes (L669) — partial redemptions; balance €0.00 → auto-closed; expired → red and closed; printed statement has a signature line.
14. Paid Out (L716) — payee autosuggest from Contacts; cheque number required for cheques; totals feed End of Day.
15. Locum Receipts (L762) — Sunday/public-holiday day type auto-detected; total = hours × rate + extras; monthly/yearly reports are **password protected**.
16. Smart Labels (L808) — pharmacy name/address/phone/licence number on every label; English/Maltese; direct print, no popup; reprint from history.
17. Client Orders (L858) — 6-character auto code; follow-up statuses Called / Not Wanted / Not Available / Called (No Answer, appends date) / Wrong Number; multi-line items become separate Order Diary entries; 80 mm sticker with QR; deleting offers to remove diary items.
18. Quotations (L900) — VAT 0/5/18; cost incl ↔ excl sync; discount % ↔ € sync; margin colours <20 red, 20-35 yellow, ≥35 green; profit uses pre-VAT cost "since VAT is reclaimed"; bulk import via Invoice Extractor GPT TSV; duplicates finder; My Location toggle.
19. Order Diary (L953) — statuses Pending/Received/Not Received/Wrong Pick; wrong pick asks for return reason; "Copy for Email" per supplier; "Carry Over" moves unfinished lines to tomorrow.
20. Deliveries (L1000) — DEL-00001 ids; map pin with reverse geocoding; In-house/Courier/Collection; 3 failed attempts → Returned automatically; controlled-drug flag; per-status log entries.
21. Appointments (L1049) — doctors, clinics, schedules (5-120 min slots) must exist first; double-booking blocked; Scheduled → Confirmed → Completed / Cancelled (reason required) / No Show; waiting list Waiting → Offered → Booked; WhatsApp/Email from context menu.
22. Tickets (L1110) — TKT-00001 ids; Open → In Progress → Pending → Resolved → Closed; timestamped notes.
23. Loyalty (L1148) — campaign types Stamp/Points/Discount/Event/Buy X Get Y/Tiered; Maltese ID card registration; append-only ledger; statuses Active/Open-ended/Inactive/Ended/Upcoming.
24. Supplier Inventory (L1208) — **the pharmacy half of the supplier flow**: cart grouped per supplier, deal multiples respected, Commit Order per supplier with notes → Pending; My Orders → Mark Received; Report Problem reasons; supplier resolutions appear in the order; cart drafts auto-save; out-of-stock items visible but not orderable; after receipt items can be added to Order Diary.
25. Alerts (L1261) — quarantine/recall with a 7-step checklist (inform team, contact supplier, notify authorities, arrange return); Open → In Progress → Closed; checklist auto-saves with timestamps.
26. Stock Transfers (L1297) — Open → Requested → Accepted → Dispatched → Delivered; expired items cannot be transferred; hand-offs to Returns / Scarce Stock.
27. Returns (L1350) — checklist Return arranged → Handed over → Collection note → Credit note; "Mark as Refused" disables all checklist items except Damaged; "From Near Expiry" badge.
28. Near Expiry (L1392) — bands Expired / 1-30 / 31-90 / 90+ days; inline Return and Add to Scarce Stock; Bulk Return; "Supplier refused" pill.
29. Scarce Stock (L1472) — two-sided (offers and needs) across the organisation; **privacy: only the two involved parties see each other's details**; private note field; Pending → Accepted → Dispatched → Delivered / Rejected.
30. Message Board (L1544) — @mentions, #hashtag → Suggestions; scope Organisation vs All (confirmation); max 2000 chars; **auto-delete after 6 months unless pinned**; max 30 pins.
31. Instructions (L1580) — five tabs; handover bullets with Low/Medium/Critical severity auto-carry to next day; HIV and Concerta sections toggle; Print (A4).
32. Point of Care Testing (L1628) — six test types with built-in reference ranges; patient history; one-time migration modal from previous system.
33. Vaccines (L1665) — travel recommendations by country (map); "Routine in Malta" tag; order print A4 or 75 mm.
34. OCP Finder (L1701) — hormone/dose search; ±1 % dose tolerance; mg/mcg; multiphasic flag; print for counselling.
35. Pharmacy Calc (L1737) — Levothyroxine, Prednisolone, Warfarin, Insulin, Methotrexate schedules; Save & Print A4 patient sheet.
36. Pharmacovigilance (L1773) — ICSR wizard compliant with EMA / Malta MPA; patient initials only; MedDRA terms; seriousness/outcome/causality; batch number; Preliminary → Follow-up → Final.
37. Screening (L1813) — campaign types tied to POCT fields; result categories Normal/Borderline/Abnormal/Urgent; referral; overdue follow-ups auto-flagged.
38. OTC Mindmap (L1854) — relationship graph; guardrails must be checked before recommending.
39. Contacts (L1912) — most tables **shared across the organisation** with a confirmation modal; Google-Contacts CSV export; import appends; doctors/specialists have Personal vs Patient-Safe phone fields.

**Data & state.** `E.HELP_CONTENT` array populated by help-content.js (loaded second, `index.html:81`); `E._helpContentById` cache; overlay DOM built once and reused (`core.js:518-558`). No API, no storage.

**Permissions & scoping.** None. The button and all pharmacy chapters are visible to supplier and company-admin users; there is **no chapter for any supplier or admin module** (no supplier-dashboard, supplier-products, supplier-received-orders, supplier-order-feedback, company-dashboard, admin-overview entries), and `HELP_CATEGORIES` (core) also omits repeatprescriptions, locumregister, audit and the Cherubino modules even though they are pharmacy modules.

**Edge cases & risks.**
- `core.js:495-503` and help-content.js must be kept in sync by hand: a chapter whose id is not in a category is silently unreachable; a category id without a chapter is skipped.
- Bodies are raw HTML strings injected with innerHTML (`core.js:594`) — safe only because content is static.
- Several documented rules are **not enforced** by the compliance grid or conflict with it (cleaning 14-day rule, closed stock takes still editable, public holidays closed) — a rebuild should choose one definition and document it.
- Documentation is English only although labels/instructions are bilingual.

**Speed notes.** ~1950 lines of JS string literals (≈120 KB) parsed on every boot for every role, with cache-busting that defeats the browser cache (see index.html).

**Must not be lost.**
- The business rules above are the only written SOPs in the product; the rebuild must carry them as acceptance criteria (especially DDA 30-day early supply, ID-card normalisation, End of Day formulas, pharmacovigilance privacy rules, message retention, scarce-stock privacy).
- Category-grouped in-app help reachable from every screen.
- Add supplier/admin chapters (currently none).

---

## GoDaddy embed  (`godaddy/godaddy-loader-htmlcode`, pasted as a GoDaddy "custom HTML" block on https://swiftdataautomation.com/eikon)
**Purpose.** Hosts the Worker-served UI inside an iframe on the marketing site, works around GoDaddy's sandboxed HTML block, forwards debug logs.

**Functions.**
1. Render a "Loading…" placeholder (L1-6), replaced when the iframe loads (L100-103)
2. Sandbox fix: if the host frame (`window.frameElement`, L19) has a `sandbox` attribute, add `allow-downloads`, `allow-popups`, `allow-popups-to-escape-sandbox`, `allow-forms`, `allow-modals`, `allow-top-navigation-by-user-activation` (L21-30); failures only logged (L34-36)
3. Idempotency guard `window.__EIKON_EMBEDDED__` (L38-42)
4. Listen for `EIKON_LOG` postMessages from the iframe and re-log them in the parent console (L52-65) — any origin accepted (only logging, so no action is taken on them)
5. Build the iframe URL: `https://eikon-api.labrint.workers.dev/ui/index.html?v=<Date.now()>&dbg=2<hash>` (L67-77); default hash `#temperature` when the parent has none (L70-75)
6. Create the iframe without a `sandbox` attribute (deliberate, L84-87), `allow="clipboard-read; clipboard-write"` (L89), `loading="lazy"` (L90), `referrerPolicy="no-referrer"` (L91), 85 vh / min 720 px (L94-95), dark background (L98)
7. On iframe error, show "Eikon failed to load" (L105-112) — `iframe.onerror` practically never fires for HTTP errors, so a dead Worker leaves a blank dark box

**What breaks if GoDaddy or the iframe changes.**
- The sandbox hack depends on GoDaddy wrapping the block in an iframe with **both** `allow-scripts` and `allow-same-origin`. If GoDaddy drops `allow-same-origin`, `frameElement` becomes inaccessible (caught at L34) and the inner app loses downloads (certificate files, CSV/xlsx exports), popups (Fullscreen opens a new tab, `core.js:922`), `window.print` dialogs (`allow-modals`) and form submission. Browsers also only apply changed sandbox flags on the next navigation; the fix relies on the inner iframe being created after the attribute change, which is browser-specific behaviour, not a guarantee.
- `dbg=2` is forced for every production visitor (L77). core.js persists it to `localStorage.eikon_dbg` (`core.js:165-167`) so it survives even when opened directly on the Worker URL. At DEBUG ≥ 2 `apiFetch` logs every request including the **Authorization header** (`core.js:264-268`) and request bodies, and `logBase` forwards every log line to `window.parent.postMessage(payload, "*")` (`core.js:186-191`). Any page that embeds the Worker UI (GoDaddy today, anything else tomorrow) receives the bearer token and patient-bearing payloads. This is the most serious finding in this scope.
- The hash never flows back to the parent: deep links and browser refresh in GoDaddy always restart at the role's dashboard; "Fullscreen" (`core.js:893-937`) is the escape hatch to the bare Worker URL and "Exit Fullscreen" hard-codes `https://swiftdataautomation.com/eikon`.
- `loading="lazy"` can delay the iframe until it scrolls into view; combined with the 4.9 s intro overlay (`core.js:19`) first paint is slow.
- Fixed 85 vh height: no resize messaging; long modules scroll inside the iframe, and on phones two nested scrollbars appear.
- Date.now() cache-busting on the iframe URL plus on every asset (index.html) means GoDaddy visitors download the whole bundle on every visit.
- Nothing authenticates the parent; if the GoDaddy page were ever compromised, it can read nothing cross-origin but receives all debug logs.

**Must not be lost.** Downloads, popups and print must work inside whatever host is chosen; clipboard permission for "Copy Headers"/"Copy for Email"; a non-blank failure state; the Fullscreen/exit pair between the hosted page and the Worker URL (users rely on it to escape the iframe).

---

## Boot / `ui/index.html`
**Purpose.** Minimal shell that loads CSS, core, help, all 46 module files, SheetJS and main.js strictly in sequence, then `E.start()`.

**Functions / behaviour.**
1. Immediate "Loading UI…" placeholder (L69-76) and `<noscript>` (L13-15)
2. `withParams()` appends `?v=<Date.now()>` to every local asset (L28-31) → **no browser caching ever** for ~50 files
3. `loadScript` sets `async=false` but also chains promises, so loading is fully serial: ~52 sequential round-trips before the app can start (L50-66, L79-137)
4. Order: app.css → core.js → help-content.js → 40 pharmacy modules → **SheetJS from cdn.sheetjs.com (L123, no cache-bust, no SRI, no crossorigin)** → supplier-dashboard / supplier-products / supplier-received-orders / supplier-order-feedback / supplier-inventory → company-dashboard → admin-overview → 5 Cherubino modules → main.js (L137) → `E.start()` (main.js)
5. Any single failure anywhere in the chain aborts boot with "Eikon failed to load" and the error text (L141-150). A cdn.sheetjs.com outage, a corporate proxy blocking it, or an ad-blocker therefore takes down the app for **every** role, although only Product List (and Emergency POS/Quotations imports) use XLSX.
6. Every role downloads every module (a supplier downloads 40 pharmacy modules and the Cherubino files it can never use); module `order` and sidebar categories, not load order, determine the menu.
7. Sidebar nav is built from `E.modules` + categories at `core.js:1011-1146`; modules not in any category (e.g. admin-overview for a pharmacy user) are hidden from the menu but remain routable by hash.

**Risks.** CDN single point of failure (L123); zero caching (L28-31); serial load; external script without integrity attribute; the Worker must serve index.html with permissive framing headers for GoDaddy (not visible here — worker reviewer to confirm CSP/X-Frame-Options).

**Must not be lost.** Deterministic load order (core before modules, help before shell), a visible failure state instead of a blank page, and SheetJS-level import capability — but as a lazy dependency of the modules that need it.

---

## End-to-end supplier order flow (pharmacy → supplier → pharmacy)

1. **Catalogue**: supplier maintains products (Product List) → `supplier_products` rows with `location_id` = supplier location and `supplier_name` = that location's name. Pharmacies browse them through GET /supplier-products/inventory (`modules.supplier-inventory.js:153`; `worker:2795`, **all suppliers across all orgs**, out-of-stock rows included but not orderable).
2. **Cart & commit (pharmacy)**: `modules.supplier-inventory.js` groups the cart by `supplier_name` and takes `supplier_location_id` from the first product in the group (L282-296) — two supplier locations sharing a name are merged into one order addressed to whichever appeared first. Drafts are persisted via PUT /supplier-orders/cart-draft (L172-180). "Commit Order to <supplier>" → confirm modal → POST /supplier-orders {supplier_location_id, supplier_name, items, notes} (L1085-1090). Worker (`worker:2975-3022`) inserts `supplier_orders` (status "pending", org_id = pharmacy's org, pharmacy_name from `locations`) and one `supplier_order_items` row per line (qty_requested, cost, VAT, retail, per-item notes, batch, expiry, free qty, discounts), then audit `SUPPLIER_ORDER_CREATE`.
3. **Supplier notices it**: core's 30-second poll (`core.js:1187-1193`) GET /supplier-orders/received → red badge + flashing "Received Orders" nav button (`core.js:1168-1177`); Supplier Dashboard shows the pending count; Received Orders lists it (`worker:3062`, filtered only by `supplier_location_id`).
4. **Supplier processes**: expand → GET /supplier-orders/:id (`worker:3072-3091`, returns order, items, feedbacks); per line PUT /supplier-orders/items/:id/unavailable (`worker:3141-3154`, overwrites item notes) with optional PUT /supplier-products/entries/:pid/stock-status (OOS → `supplier_stock_changes` row that every pharmacy's dashboard shows under "Supplier Updates" via GET /supplier-products/changes, `modules.dashboard.js:1425`); then "Order Shipped" → PUT /supplier-orders/:id/confirm (`worker:3093-3137`) sets status "shipped", qty_confirmed per line, supplier_notes, scheduled_delivery_date, audit `SUPPLIER_ORDER_CONFIRM`.
5. **Pharmacy sees shipment**: Dashboard "Supplier Orders" row polls GET /supplier-orders/sent?status=pending,shipped (`modules.dashboard.js:1429-1432`) and shows "N pending / N shipped"; Supplier Inventory → My Orders polls every 30 s (`modules.supplier-inventory.js:1514-1527`) and shows supplier notes, delivery date and unavailable lines. **No push notification of any kind** (no e-mail/SMS/WhatsApp) despite the ship modal text.
6. **Receipt**: pharmacy clicks "Mark Received" → PUT /supplier-orders/:id {status:"received"} (`modules.supplier-inventory.js:1277`; `worker:3156-3193`, any of the four statuses accepted from either party, no quantities recorded at receipt).
7. **Feedback**: per item the pharmacy picks a problem type → POST /supplier-orders/items/:id/feedback {problem_type, notes} (`modules.supplier-inventory.js:1311-1314`; `worker:2908-2950`, only the ordering pharmacy may post; snapshot of description/barcode/qty/batch/expiry copied into the feedback row); the UI then offers "Add to Returns".
8. **Supplier sees feedback**: core poll GET /supplier-orders/feedback (`core.js:1180-1186`) → badge + flash on "Order Feedback"; Supplier Dashboard card flashes; Order Feedback module → PUT /supplier-orders/feedback/:id/resolve (`worker:3195-3210`).
9. **Pharmacy sees the resolution**: only inside the expanded order in My Orders, where GET /supplier-orders/:id returns `feedbacks` with `resolution_status`/`supplier_notes` (`modules.supplier-inventory.js:615-679`). There is no pharmacy-side badge or poll for resolutions; the pharmacy must open the order to find out.

Gaps across the flow: no cancel/reject by either side; no enforced state machine (any status can be set at any time by either party, `worker:3160-3179`); no partial-quantity confirmation or goods-received quantities; no documents (picking list, delivery note, invoice); no org boundary on the supplier side; product ids referenced by orders and cart drafts are invalidated by every bulk re-import; supplier identity is a free-text location name.

---

## What the company admin sees per pharmacy and how it is computed
See "Pharmacy Overview" above: for each location with `id < 400` in the admin's `org_id`, one row with Temp and Cleaning as *days with ≥1 entry ÷ Mon-Sat working days elapsed this month* (≥90 % green / ≥70 % amber / red), five transaction registers as *entries this month* (amber if the last entry is >7 days old), latest DDA stock take date + closed/open, certificates (expired by `last_date + interval_months < today`, missing file), locum register entries, repeat prescriptions total/expired. Summary counts pharmacies with Temp or Cleaning below 70 % and any certificate issue. All thresholds are client-side constants (`admin-overview.js:130, 145, 203-207`); the denominators and expiry rules are server-side (`worker:18736-18742`, `worker:18880-18900`).

---

## Cross-cutting findings for this scope (ranked)

1. **Token and payload leakage via forced debug mode** — `godaddy-loader-htmlcode:77` sets `dbg=2`; `core.js:165-167` persists it; `core.js:264-268` logs the Authorization header; `core.js:186-191` posts every log line to `window.parent` with target origin `"*"`.
2. **Role is cosmetic** — `core.js:346-366` decides the portal in the browser; `core.js:1218-1265` routes any module by hash; no `/supplier-*` handler checks the 400-599 range; a pharmacy account can publish "supplier products" visible to every organisation (`worker:2795`). Only `/admin/pharmacy-overview` is guarded (`worker:18709`).
3. **Catalogue full-replace without warning or transaction** — `supplier-products.js:937-968` + `worker:2712-2755`; also resets out-of-stock flags and invalidates every product id referenced by carts and orders.
4. **Pharmacy item notes overwritten by supplier availability toggle** — `supplier-received-orders.js:318` + `worker:3151`.
5. **No order state machine** — `worker:3093-3137` ships regardless of status; `worker:3160-3179` lets either side set any status; concurrent supplier PCs overwrite each other silently.
6. **Boot single points of failure** — `index.html:123` external SheetJS in the mandatory serial chain; `index.html:28-31` disables caching entirely.
7. **Silent feedback UI** — `supplier-order-feedback.js:14` toasts no-op (`E.toast` undefined); `supplier-order-feedback.js:20` default sort is a no-op (oldest first); toast CSS for Product List / Received Orders exists only when Order Diary has rendered (`modules.orderdiary.js:378`).
8. **Compliance grid definitions** — UTC vs local month (`admin-overview.js:10-13` vs `worker:18715-18736`), ">7 days" against now for past months (`admin-overview.js:141-146`), Sundays-only working days (`worker:18736-18742`), summary/grid threshold mismatch (`admin-overview.js:130` vs `203-205`), silent per-column failure to "No data" (worker try/catch blocks), and definitions that contradict the pharmacy Dashboard and Help (cleaning 14-day rule, editable closed stock takes).
9. **Polling cost / duplication** — supplier dashboard and core both poll received+feedback every 30 s (`supplier-dashboard.js:108`, `core.js:1196`); dashboard re-downloads the whole catalogue every tick (`supplier-dashboard.js:27`); the supplier poll is not stopped on "Switch Portal" (`core.js:871-884`).
10. **Timezone handling** — SQLite UTC strings parsed as local/Invalid in `supplier-received-orders.js:20-25` and `supplier-order-feedback.js:8-13`; delivery date default in UTC (`supplier-received-orders.js:250`).

## Could not determine from the files in scope
- Whether the Worker sends CSP/X-Frame-Options allowing GoDaddy framing, and whether CORS restricts the parent origin (worker reviewer).
- Whether GoDaddy still wraps HTML blocks with `allow-same-origin`; this cannot be verified from source.
- Whether browsers in use (Chrome vs Safari on pharmacy PCs) fire `blur` on element removal (affects double-save on Escape in inline edit).
- The real volume of supplier products/orders (sizes the polling and import risks).
