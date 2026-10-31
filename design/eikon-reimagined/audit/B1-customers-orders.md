# B1 — Customers & Orders audit (Client Orders, Quotations, Order Diary, Client Deliveries, Client Tickets)

Scope: `ui/modules.clientorders.js` (1949 lines), `ui/modules.quotations.js` (2070), `ui/modules.orderdiary.js` (1469), `ui/modules.deliveries.js` (2264), `ui/modules.tickets.js` (1436). Worker handlers were read only where needed to confirm what an endpoint does (`cloudflare-worker/code`, line refs prefixed `worker:`). All five modules sit in the pharmacy-role sidebar group "Sales & Clients" (`core.js:328-331`); no module has its own client-side role gate, and the only org-specific sidebar logic in core is the Cherubino add-on for org 12 (`core.js:776-778`), which does not touch these modules.

Two of the five are **not customer modules at all**: Quotations is supplier-invoice costing (no client fields) and Order Diary is the daily supplier order book (no client fields). They are audited in full below, but the "Customers" merge should treat them as the *supply side* that a customer order hands off to, not as customer records. The cross-module summary the brief asked for (customer identity, linkage, states, notifications, print formats) is in the final section.

---

## Client Orders  (`modules.clientorders.js`, id `clientorders`, order 200, visible to: pharmacy role; worker requires `role in (admin, staff)` on all four endpoints; list/create/update scoped org+location, delete org-wide)
**Purpose.** Log special-order requests from named customers (items to order in, needed-by / pick-up dates, deposit, follow-up calls) and track them from Active to Fulfilled, with an 80 mm QR sticker and an optional hand-off of item lines into the Order Diary.

**Functions.**
1. View Active orders table (unfulfilled) — where: card "Active Orders", rendered on load; API: GET `/client-orders/entries?month=YYYY-MM` × 37 (one probe for the current month then 36 months, prev/current/next year, in parallel, `430-517`); extras: none.
2. View Fulfilled orders table — where: card "Fulfilled Orders"; API: same load; split client-side on `fulfilled` (`1306-1328`).
3. Search Active — where: input `#co-search-active`, live on every keystroke, no debounce; client-side substring over a blob of 15 fields including follow-up value and order code (`157-175`, `1903-1912`); API: none.
4. Search Fulfilled — where: input `#co-search-done` (`1914-1923`); API: none.
5. Sort either table by any of 8 columns (Code, Date, Client, Contact, Items, Priority, Follow-up, Needed by) — where: click `th`, toggles asc/desc, independent sort state per table (`1397-1426`); defaults Active = priority asc, Fulfilled = order_date desc (`1284-1285`).
6. Select a row — where: click, or keyboard Enter/Space on the focusable `tr` (`1261-1269`); fills "Selected Order" panel with 14 key/value tiles and enables the action buttons (`1591-1662`).
7. New Order — where: button `#co-new` → modal (`814-948`); fields: Date (default today), Client (required), Address, Contact, Alternate, Email (regex-validated if present), Item/s (multiline, required), Priority 1/2/3, Needed by (default +2 d, required), Pick Up Date (default +2 d, required), Deposit (2 dp, ≥0), Follow-up Status (None/Called/Not Wanted/Not Available/Called (No Answer)/Wrong Number), Additional Notes, "Mark as fulfilled" checkbox; generates a 6-char order code client-side (`148-155`); API: POST `/client-orders/entries` with both UI-shaped and DB-shaped keys (`620-651`).
8. Edit Order — where: "Edit" in the Selected panel (`1838-1847`) → same modal; API: PUT `/client-orders/entries/:id` (full record).
9. Delete Order — where: "Delete" in Selected panel → confirm modal showing date/client/items (`950-981`); API: DELETE `/client-orders/entries/:id`; then step 17.
10. Mark Fulfilled / Mark Unfulfilled — where: toggle button in Selected panel, no confirmation (`1812-1836`); API: PUT full record rebuilt from the in-memory row with `fulfilled` flipped and `fulfilled_at = now ISO` or "" (`1778-1810`).
11. Print Sticker — where: "Print Sticker" in Selected panel (`1069-1138`); extras: 80 mm chit in a popup: order code (large mono), QR of the code via `bwip-js@4` loaded from jsDelivr at print time, Client, Contact, Items, Needed By, Pick Up, Follow-up (if any), Priority; auto `window.print()` after 400 ms.
12. Re-order — where: "Re-order" button, shown only when the selected order is fulfilled (`1660`, `1873-1901`); opens New Order modal pre-filled with client/address/contact/alternate/email/items/priority, today's date, +2 d dates, deposit/notes/follow-up cleared; API: POST on save (new code generated).
13. Print Active list — where: `#co-print-active` (`986-1064`, `1925-1928`); extras: popup A4 table of the *currently filtered* rows, 15 columns (Code, Date, Client, Address, Contact, Alternate, Email, Item/s, Priority, Needed by, Pick Up Date, Deposit, Follow-up, Notes, Fulfilled), header with row count, search text and printed timestamp, auto-print.
14. Print Fulfilled list — where: `#co-print-done` (`1930-1933`); same format.
15. Refresh — where: `#co-refresh` (`1776`); API: repeats the 37-request load.
16. Automatic note stamping for "Called (No Answer)" — on Save, appends " — Called dd/mm/yyyy no answer" to Notes if not already present (`886-894`).
17. Automatic "Add to Order Diary?" prompt after every successful create — modal lists each non-empty line of Item/s and an optional Supplier; "Yes, add" POSTs `/order-diary/entries` once per line, sequentially, qty 1, for the order date (`680-730`).
18. Automatic "Remove from Order Diary?" prompt after delete — GET `/order-diary/entries?date=<order_date>`, matches diary `item_name` to item lines case-insensitively (each line matched once), offers DELETE `/order-diary/entries/:id` per match, sequential (`737-809`).
19. Local fallback mode — on 404 or network failure every CRUD call silently switches to `localStorage` (`eikon_clientorders_v1`); HTTP 5xx falls back only when `?co_allow500=1` or `localStorage eikon_clientorders_pref_allow500=1` (`298-386`, `465-564`). Badge shows "Local mode (no API yet)".
20. Mode badge — Online / Local / "Online (API error: …)" (`1664-1678`).
21. Debug panel — enabled by `?co_debug=1` or `E.DEBUG>=2` (`1432-1440`, `1530`) but permanently hidden by `.co-debug{display:none!important}` (`257`); ring buffer of last 80 log lines.
22. Automatic data normalisation on load — invalid/missing `order_date` → today, invalid `needed_by`/`pick_up_date` → today+2, priority → 2, deposit reformatted (`1724-1731`).
23. Row selection memory — `state.selectedId` survives refresh/search so the panel re-binds after reload (`1591-1600`).

**Data & state.** Endpoints: GET/POST `/client-orders/entries`, PUT/DELETE `/client-orders/entries/:id` (worker `3331-3679`, table `client_orders_entries`); cross-module writes: POST/GET/DELETE `/order-diary/entries` (table `order_diary_entries`). localStorage: `eikon_clientorders_v1` (fallback DB with its own `seq`), `eikon_clientorders_pref_allow500`. No polling, no timers other than print auto-print. Exposes nothing on `window.EIKON`; consumed by Dashboard (`modules.dashboard.js:1335-1352` loads 6 months of `/client-orders/entries` to count active) and by the worker's `/contacts/clients/aggregated` which harvests `client_name/client_address/client_phone/client_alt_phone` from this table (`worker:16702`).

**Permissions & scoping.** No client-side role checks. Worker: `requireRole(["admin","staff"])` on list/create/update/delete (`worker:3332, 3403, 3477, 3648`). List, create and update are org+location scoped (`worker:3374-3375, 3492-3494`), but **delete is org-wide by id** (`worker:3659-3672`, comment claims the list is org-wide, which it is not) — any staff member can delete another location's order by id. The only "admin-only" behaviour anywhere is the worker's role gate.

**Edge cases & risks (found in code, cite line numbers).**
- **Orders created without a Contact can never be edited or fulfilled.** UI does not require Contact (`569-593`), worker create accepts empty `client_phone` (`worker:3413, 3428-3429`), but worker update rejects empty `client_phone` with "client_phone is required" (`worker:3577-3579`). Every Edit/Mark Fulfilled on such an order fails with a modal error.
- **Fabricated dates are written back to the database.** Load-time normalisation invents `order_date=today`, `needed_by`/`pick_up_date=today+2` for blank values (`1724-1726`); `buildTogglePayload` then PUTs those invented values as if real (`1793-1802`, `1826`). An old order with no pick-up date acquires one the first time anyone clicks Mark Fulfilled.
- **Lost updates between two PCs.** Edit (`919-920`) and the fulfilled toggle (`1812-1836`) send the whole record from in-memory state; there is no `updated_at` check. PC B's save silently overwrites PC A's notes/follow-up.
- **Local fallback is a one-way trap.** Rows created while offline/404 live only in that browser's localStorage (`321-329`, `529-533`) and are never replayed to the API; when the API returns, Online mode hides them (`465-517`). Same for edits/deletes done in local mode. Data loss without warning.
- **Order code uniqueness is not enforced anywhere.** Generated with `Math.random` (`148-155`), stored as plain text (`worker:3425`), no unique index. Collisions are rare (32^6) but nothing prevents two identical codes, and the sticker/QR identifies the order by this code only (`1129`).
- **37 HTTP requests per load, every refresh** (`473`, `486-490`): one probe plus 36 month queries. No caching, no abort on re-entry; double-clicking Refresh fires 74 requests. Orders outside the fixed window (previous year .. next year, `430-437`) are invisible: a fulfilled order from two years ago cannot be found or re-ordered, and an order with a far-future date vanishes.
- **Month-boundary / timezone.** UI builds month keys from local time (`99-102`) and the worker's `monthRange` from UTC midnight date strings (worker `monthRange`); both are plain `YYYY-MM-DD` comparisons so no row is lost at month edges. `fulfilled_at` is UTC ISO (`614`, `1790`) while all dates shown are local; a fulfilment at 00:30 local on the 1st records the previous UTC day, which is cosmetic here because `fulfilled_at` is never displayed.
- **Order Diary hand-off is best-effort and not transactional.** Sequential POSTs (`707-719`): a failure after line 2 of 5 leaves two diary rows and an error modal, no retry. Removal (`795-797`) has the same shape. The delete-side match is by `item_name` equality for the whole location on that date (`755-771`), so it can offer to delete a diary line that belongs to a *different* customer's order of the same product.
- **Silent catch blocks:** `49`, `705`, `749-753` (diary fetch failure logged at debug level only; user never told), `1258`, `1370-1371`, `1417-1423`, `1661` (the whole Selected panel renderer swallows all exceptions), `1753-1754`.
- **Destructive without confirm:** Mark Fulfilled / Unfulfilled (`1860`) flips status and timestamp immediately. Delete is confirmed (`961`).
- **Deposit money handling.** Deposit is a free number with no payment method, receipt number, refund or "forfeited" state; "Not Wanted" follow-up leaves the deposit in place. `parseMoney2` strips commas (`121`), so "1,5" becomes 15.00.
- **Validation gaps.** Contact/Alternate are free text with no digit check; `pick_up_date` may precede `needed_by` or `order_date`; `needed_by` may be in the past. `validEmail` only when non-empty.
- **Sorting tiebreak compares ids as strings** (`1169-1173`): "10" < "9".
- **Print windows** use `document.write` and auto-print; the sticker needs internet to fetch bwip-js (`1108`) — offline the QR silently fails (`1130`).
- **Search re-renders both tables on each keystroke** (`1903-1923`) by rebuilding every `tr` with DOM calls; fine at hundreds of rows, sluggish at thousands.
- The per-month `q` and `fulfilled` server filters exist (`421-427`, `worker:3342-3349`) but are never used; everything is filtered client-side.
- `promptAddToOrderDiary` is shown after `state.refresh()` is kicked off (`925-927`); if the refresh errors, its error modal is replaced by the diary prompt.

**Speed notes.** Load = 1 sequential probe + 36 parallel GETs, each a full row dump for the month (≈ 0.5-1 KB/row); a pharmacy doing 30 orders/month ships ≈ 1,000 rows ≈ 0.7 MB per load, repeated on every Refresh and after every create/edit/delete. All filtering/sorting is in memory. Two tables are rebuilt with `createElement` per cell on each refresh, search keystroke and sort click. The Selected panel is rebuilt on every rerender.

**Must not be lost.**
- Order code + QR sticker (the physical link between the bag on the shelf and the record).
- Deposit amount per order (money owed back or to be collected).
- Follow-up status history, including the auto-stamped "Called dd/mm/yyyy no answer" trail (evidence the customer was contacted).
- Needed-by / pick-up dates and 1-2-3 priority driving the Active list order.
- Fulfilled timestamp and the Active/Fulfilled split with search in both.
- Re-order from a past (fulfilled) order.
- Hand-off of item lines into the day's supplier Order Diary (and removal on cancel).
- Printable Active list for the dispensary and printable Fulfilled list for audit.

---

## Quotations  (`modules.quotations.js`, id `quotations`, order 205, visible to: pharmacy role; **no role check in the worker** for any quotations endpoint; list/create location-scoped, update/delete org-wide by id)
**Purpose.** Flat ledger of supplier quotation / invoice lines (cost excl/incl VAT, discount, free goods, retail price) with computed profit and margin, bulk-imported from a ChatGPT "Invoice Extractor" paste. No customer data.

**Functions.**
1. View table for my location — where: `#qt-table-container`, on load; API: GET `/quotations/entries[?q=…]`; 17 columns + checkbox + actions.
2. Toggle "My Location" / "All Org Locations" — where: `#qt-org-toggle` (`1917-1922`); API: GET `/quotations/entries?all_org=1`; shows a `(location name)` badge next to supplier (`1622-1623`).
3. Keyword search — where: `#qt-search`, debounced 200 ms, client-side over supplier/description/barcode/stock code/date/notes (`1541-1549`); the keyword is also sent as `q` on the next server refresh (`427`, `1860`).
4. Date filter — where: `#qt-search-date`, substring on `YYYY-MM-DD` or `dd/mm/yyyy` (`1551-1554`).
5. Supplier filter — where: `#qt-search-supplier` (`1555-1557`). 6. Description filter — where: `#qt-search-desc` (`1558-1560`). All four filters AND together.
7. Column visibility panel — where: `#qt-col-btn` → checkbox strip for all 17 columns (`457-473`); not persisted; defaults hide Barcode, Stock Code, Cost Incl, Disc€.
8. Sort by any column — where: click header, asc/desc toggle (`1660-1674`).
9. Select rows / select all visible — where: row checkboxes and `#qt-sel-all` (`1676-1695`); selection persists in `state.selectedIds` across refreshes.
10. Delete Selected (mass delete) — where: `#qt-del-selected` (appears when ≥1 selected) → confirm listing up to 8 rows → sequential DELETE per id (`1870-1914`); API: DELETE `/quotations/entries/:id`.
11. Add Entry — where: `#qt-add-btn` → modal (`478-655`): Supplier, Date (required), Barcode, Stock Code, Item Description (required), Qty Purchased (≥1), Qty Free, VAT 0/5/18 %, Cost Excl, Cost Incl, Discount %, Discount €, Total Incl (reverse-calculates unit cost), Retail, Profit (auto, read-only), Margin % (auto, colour-coded Good/OK/Poor), Notes; API: POST `/quotations/entries`.
12. Live cross-calculation in the modal — on input of any money field: VAT ↔ excl/incl, %, €, total, profit, margin (`657-737`, `recalcItem` `44-100`), never overwriting the focused field.
13. Similar-description suggestions — while typing the description (≥2 chars, debounced 300 ms): trigram + Jaccard + Levenshtein ≥ 0.60 against all loaded descriptions, up to 5, "Use this" button (`184-204`, `742-797`).
14. Supplier-inventory lookup in the modal — matches typed text against `window._qtSupplierProducts` (prefetched GET `/supplier-products/inventory`, `1767-1771`), "Use" pre-fills supplier, barcode, stock code, VAT, costs, discounts, retail, qty (`765-821`); shows "(Out of Stock)".
15. Edit entry — where: ✎ per row (`1698-1704`); API: PUT `/quotations/entries/:id` (full payload).
16. Delete entry — where: ✕ per row → confirm → DELETE (`1706-1736`).
17. Find & Merge Duplicates — where: `#qt-dup-btn` → clusters all descriptions by union-find on similarity ≥ 0.60 (O(n²), `206-234`); per-group canonical name input, "Merge this group" or "Merge All" → PUT `{item_description}` per affected row, sequential (`828-917`).
18. Print — where: `#qt-print-btn` → modal with Date From (default 3 years ago), Date To (today), Supplier dropdown, live match count (`920-992`) → popup table (Date, Supplier, Description, Qty, VAT, Cost Excl, Total Incl, Retail, Margin %, Notes) with "Total Invested (Incl VAT)" and "Total Retail Value", auto-print and auto-close after print (`994-1090`).
19. Refresh — where: `#qt-refresh-btn` (`1963`).
20. Copy Invoice Extractor GPT link — where: `#qt-gpt-link`, clipboard copy with `execCommand` fallback, 6 s "Copied" hint (`1969-1995`); the URL is also shown read-only (`1812-1813`).
21. Bulk import parse — where: paste TSV in `#qt-bulk-input`, `#qt-bulk-submit` (`2008-2057`): header auto-detect, 14 fixed columns (`1094-1098`), per-row validation (date `YYYY-MM-DD`, description), discount heuristics (`1402-1416`), error list; valid rows go to the preview.
22. Sanity-check preview — where: `#qt-bulk-preview` (`1101-1351`): editable inputs per cell with live recalculation, VAT select, delete row (✕), "+ Add Row", "Confirm & Upload (n rows)" (validates again, sequential POST per row with per-row ✓/✗ log, `1455-1491`), Cancel.
23. Clear — where: `#qt-bulk-clear` (`2002-2006`).
24. Automatic prefetch of supplier inventory once per page lifetime (global `window._qtSupplierProducts`, never invalidated).

**Data & state.** Endpoints: GET/POST `/quotations/entries`, PUT/DELETE `/quotations/entries/:id` (worker `2051-2184`, table `quotation_entries`), GET `/supplier-products/inventory`. No localStorage. No polling. Global: `window._qtSupplierProducts`. Consumed by Order Diary (prefetches the whole `/quotations/entries` list for hints, `orderdiary.js:165-172`).

**Permissions & scoping.** None client-side. **Worker has no `requireRole` on any quotations handler** (`worker:2051, 2089, 2129, 2174`): any authenticated role (including supplier / company-admin logins if they have a session) can read, write and delete. Update and delete look rows up by `org_id + id` only (`worker:2132, 2177`), so a user at location A can modify/delete location B's rows (by design for All Org, but also by id guessing).

**Edge cases & risks (found in code, cite line numbers).**
- **Duplicate uploads and multi-row deletes in the bulk preview.** `renderBulkPreview` replaces `wrap.innerHTML` but registers *new* `input`, `change` and `click` listeners on the same `wrap` element every time it runs (`1274-1278`, `1278-1350`). Deleting a row or adding a row re-renders, so after k re-renders each click is handled k+1 times: a delete removes k+1 rows (`1282-1289`, same index spliced repeatedly), and **Confirm & Upload runs `runBulkImport` k+1 times** (`1310-1341`; `btn.disabled=true` is set but the later handlers do not check it) → every row is POSTed multiple times. Likely root cause of duplicated quotation lines.
- **Merge All / Merge group are destructive renames with no confirmation** and swallow per-row failures (`902-916`, `warn` only); the modal reports "Updated n" even when some rows failed.
- **Stale subset after a server-side keyword search.** `state.queries.keyword` is sent as `q` on the next refresh (`427`); if the user types a keyword, hits Refresh (or toggles location), then clears the keyword, the table still shows only the server-filtered subset until the next refresh.
- **Selection survives refresh and filters** (`selectedIds` never cleared except on successful delete, `1901`): "Delete Selected (3)" can include rows hidden by the current filter or already deleted elsewhere (`1873-1876`).
- **Discount € heuristic silently changes money.** If `discount_euro > cost_excl` and qty > 1 it is divided by qty (`1410-1412`); otherwise treated as per-unit. Wrong guess = wrong cost/profit on every imported line with no flag to the user.
- **Any VAT other than 0/5/18 becomes 18** (`46`, `1395`) without warning.
- **Which cost field is "truth" is guessed** by presence order excl → incl → total (`597`); the server recomputes everything again via `computeItemProfitFields` (`worker:2102, 2147`) — UI and server formulas were not compared line-by-line (see "could not determine").
- **`apiList` ignores `resp.ok`** (`1947-1951`); an `{ok:false}` body renders an empty table with "No entries found".
- **O(n²) duplicate clustering with Levenshtein** (`216-220`, `155-168`) blocks the UI; at 3,000 distinct descriptions that is ≈4.5 M similarity calls on the main thread.
- **Mass delete and bulk upload are sequential awaits** (`1897-1906`, `1460-1477`) with no abort, no retry, no transaction; closing the tab midway leaves a partial result.
- **Table wrapper is capped at 220 px high** (`316`) — the main data table shows roughly five rows at a time.
- Supplier inventory suggestions depend on a global populated once (`1767`); after a page refresh in another tab the data may be stale for the session.
- `escape` is applied consistently (`esc`), but the print `safe` relies on `esc` too; fine. `document.write` popups auto-close after print (`1069-1070`) — users who cancel the print dialog lose the window.
- Silent catches: `18-19` (loggers), `1770`, `1340`.

**Speed notes.** One GET for the whole location's history (unbounded, no `LIMIT`, worker `2057-2070`) plus one GET of the whole supplier inventory; with All Org the whole org. Every keystroke in any of four filters re-renders the entire table as one HTML string and re-wires every button (`1574-1739`). Bulk import of 100 lines = 100 sequential POSTs (≈ 100 × RTT).

**Must not be lost.**
- Cost excl/incl VAT, discount %, discount €, free goods and the derived profit / margin % per supplier line (purchasing decisions and the margin colour code).
- Supplier + date + barcode/stock code as the lookup key used by Order Diary and Supplier Inventory suggestions.
- Bulk paste import from the invoice extractor with the editable sanity-check step.
- Print by date range / supplier with invested-vs-retail totals.
- All-org visibility toggle (price comparison across branches).
- Duplicate-description detection/merge (keeps the history searchable).

---

## Order Diary  (`modules.orderdiary.js`, id `order-diary`, order 208, visible to: pharmacy role; **no role check in the worker**; list/create/carry-over location-scoped, update/delete org-wide by id)
**Purpose.** A per-day book of items to order from suppliers (item, qty, supplier), ticked off as Received / Not Received / Wrong Pick, with carry-over of outstanding lines to the next day. No customer data; receives lines from Client Orders and Supplier Inventory.

**Functions.**
1. View a day's diary — where: on mount (today) and after every navigation; API: GET `/order-diary/entries?date=YYYY-MM-DD` (`188`, `404-416`); grouped by supplier with a colour per supplier hash (`442-457`).
2. Date navigation ◀ / ▶ / Today — where: header buttons `data-nav` (`647-656`); resets supplier filter and search.
3. Stats bar — Total / Received / Pending / Not Received / Wrong Pick (`509-516`).
4. Print day sheet — where: `#od-print-btn` (`1180-1248`); extras: popup grouped by supplier (Item, Qty, Notes blank column, Status badge), header with long date and location name, stats row, auto-print after 400 ms.
5. Carry Over — where: `#od-carry-btn "↩ Carry Over N"` (only when outstanding > 0) → confirm → POST `/order-diary/carry-over {from_date,to_date=+1 day}` (`1158-1177`); server copies pending/not_received/wrong_pick lines to the target date as new `pending` rows with `carried_from_id`, skipping exact (item, supplier) duplicates (`worker:2340-2378`); UI then jumps to the target day.
6. Search items — where: `#od-search`, client-side on `item_name`, re-renders the whole module per keystroke and restores focus (`667-678`).
7. Quick-add bar — where: always-visible row (`529-541`, `812-904`): item name input with merged autocomplete, qty (mouse wheel ±1, Enter submits), supplier input with autocomplete, "＋ Add"; Enter in name or supplier submits; ↑/↓ move through suggestions, Enter picks, Esc closes; API: POST `/order-diary/entries` then optimistic push (`1080-1108`).
8. Item autocomplete sources — "Your History" GET `/order-diary/items?q=` (org-wide usage counts + preferred supplier), "From Quotations" (cached GET `/quotations/entries`, similarity ≥ 0.55 with substring/token-recall boosts, `90-148`), "From Supplier Inventory" (cached GET `/supplier-products/inventory`, substring on description/barcode/stock code) (`932-1058`); picking fills name and, if empty, supplier.
9. Supplier autocomplete — from suppliers already present on the current day only (`1060-1078`).
10. Supplier filter tabs — All / each supplier / Unassigned (`543-554`, `681-687`).
11. "✓ All Received (n)" per supplier group — parallel PUT `{status:"received"}` for every non-received line in the group (`690-707`).
12. "📋 Copy for Email" per supplier group — clipboard text "From: <location>\nOrder for <supplier> — dd/mm/yyyy:\n• item × qty (notes)" (`1131-1155`); nothing is sent.
13. Row status ✓ Received / ✗ Not Received — where: icon buttons per row (`720-726`, `1119-1128`); API: PUT `{status}`; row flashes green/red.
14. Row ⚠ Wrong Pick — where: icon button → modal (Description, Quantity, Supplier, Batch, Invoice No., Remarks pre-filled "Wrong pick received — ordered dd/mm/yyyy") → POST `/returns/entries` (creates a Returns record with all four checkboxes 0) then PUT `{status:"wrong_pick"}` (`1381-1434`).
15. Row ✏ Edit — modal (Item Name, Quantity, Supplier, Notes) with the same autocomplete plus a "Quotation Hints" table (Description, Supplier, Cost Excl, Margin, Extras, Date; clicking a hint fills the supplier if empty) (`1253-1378`); API: PUT.
16. Row 🗑 Delete — confirm modal "Cannot be undone" → DELETE (`785-805`).
17. Inline qty edit — click the qty cell → number input; Enter/blur saves (PUT `{qty}`), Esc re-renders, wheel ±1 (`749-782`).
18. Row flash animations on status/qty change (`1111-1117`).
19. Background prefetch on mount of the whole quotations list and the whole supplier inventory (`1454-1455`), cache reset on each mount (`1439`).
20. Entry points from other modules — Client Orders "Add to Order Diary" / "Remove from Order Diary" (POST/GET/DELETE), Supplier Inventory `apiAddToOrderDiary` (POST with today's date, `supplier-inventory.js:200-207`).
21. "↩ Carried" badge on rows with `carried_from_id` (`616`).
22. Own toast system (`374-398`) and empty-state keyboard tips (`557-574`).

**Data & state.** Endpoints: GET/POST `/order-diary/entries`, PUT/DELETE `/order-diary/entries/:id`, GET `/order-diary/items`, POST `/order-diary/carry-over`, POST `/returns/entries`, GET `/quotations/entries`, GET `/supplier-products/inventory`. Tables: `order_diary_entries`, `order_diary_items` (org-wide usage memory, upserted on create and on supplier change, `worker:2221-2232, 2270, 2298-2300`), `returns_entries`. No localStorage. No polling. Module-level caches `_quotations`, `_supplierProducts`.

**Permissions & scoping.** None client-side. **No `requireRole` on any order-diary handler** (`worker:2234-2378`). List and carry-over are org+location scoped; update and delete are `org_id + id` only (`worker:2277-2279, 2308-2310`). Status values validated server-side (`worker:2288-2289`).

**Edge cases & risks (found in code, cite line numbers).**
- **Carry-over leaves the source line outstanding forever.** The server inserts a copy and never touches the original (`worker:2359-2374`), so yesterday's stats keep showing "Pending", and carrying over the same day twice (or from day N and again from day N+1) is only deduplicated by exact `item_name + supplier` on the target date (`worker:2360-2365`); a qty change or supplier edit on either side produces a duplicate.
- **Wrong Pick is two non-atomic writes** (`1415-1420`): if the status PUT fails after the Returns POST, a return exists but the diary line is unmarked; retrying creates a second return. No link stored from the diary line to the return id.
- **Inline qty Esc does not cancel.** Esc only calls `renderMain()` (`773`); the `blur` listener on the removed input (`775`) may still fire `saveQty` in some browsers and persist the edited value.
- **"All Received" is a fan-out of parallel PUTs** (`697-699`) with a single catch; partial success leaves the in-memory statuses inconsistent until the next load.
- **Quick-add ignores `res.ok`** and pushes an entry with `id: res.id` (`1088-1092`); a `{ok:false}` body yields a ghost row with `id undefined` that cannot be edited.
- **Whole-module re-render per search keystroke** (`669-677`) re-attaches every listener; with a long day this is visibly slow and resets scroll in the table (`od-table-scroll`).
- **Autocomplete payload cost:** every mount downloads the entire quotation ledger and the entire supplier inventory just for hints (`165-185`).
- **Dates:** `addDays` parses `ymd + "T00:00:00"` as local time (`33-37`) — correct across DST; `fmtDateLong` uses the `en-IE` locale regardless of user (`41`). Carry-over always targets calendar +1 day including Sundays/public holidays.
- **Item history is org-wide, not per location** (`worker:2217`, `2325`), and `preferred_supplier` is overwritten by the last use (`worker:2227`); use counts never decrement on delete.
- **Copy for Email** uses the `location_name || org_name` from `ctx.user` (`1132`); there is no supplier e-mail address, no send, no record that an order was placed.
- Silent catches: `19`, `171`, `184`, `397`, `935`, `1057`.
- Delete confirms; status changes and carry-over's effect on the next day are immediate. Carry-over has a confirm.
- Print and copy rely on `window.open`/clipboard without feedback when blocked except a toast (`1244`).

**Speed notes.** Mount = 3 GETs (day entries + quotations + inventory; the latter two can be MBs). Each navigation = 1 GET. Each status/qty click = 1 PUT + full re-render of the day. Autocomplete = 1 GET per keystroke burst (220 ms debounce) plus in-memory similarity over all quotation rows.

**Must not be lost.**
- Per-day supplier order book with Received / Not Received / Wrong Pick ticks (the only record that a supplier shortage occurred).
- Carry-over of outstanding lines with the "carried" marker (keeps the chase list alive).
- Wrong Pick → Returns record creation (starts the credit-note trail).
- Item history / preferred supplier autocomplete and quotation cost hints (fast, consistent ordering).
- Grouped print and copy-for-email per supplier.
- Inbound hand-offs from Client Orders and Supplier Inventory.

---

## Client Deliveries  (`modules.deliveries.js`, id `deliveries`, order 210, visible to: pharmacy role; worker requires `admin|staff`; all four endpoints org+location scoped; list capped at 2000 rows)
**Purpose.** Track home deliveries / courier shipments / collections for named customers from Scheduled to Delivered (with recipient, signature, proof) or Failed/Returned (attempt counter), including an items list with legal schedule and a free-text delivery log.

**Functions.**
1. Load all deliveries — where: on render and Refresh; API: GET `/client-deliveries/entries` (server `LIMIT 2000`, `worker:7265`).
2. Stats tiles — Active, Urgent (P1 active), Delivered, Failed/Returned, Total (`925-948`).
3. Tabs Active / Completed / Failed-Returned — where: `.dv-tab` (`953-966`); split client-side: Active = Scheduled, Dispatched, Out for Delivery; Completed = Delivered; Failed = Failed, Returned, Cancelled (`46-53`).
4. Search per tab — where: `#dv-search-active|completed|failed`, live, client-side over id/date/client/phone/address/method/driver/tracking/status/ticket ref and the text of every log entry (`69-83`, `2212-2237`).
5. Sort per tab — where: click headers (11 / 9 / 7 columns); defaults priority asc / actual_delivery_date desc / order_date desc (`648-650`, `862-873`).
6. Select row — click / Enter / Space (`821-830`) → Selected Delivery panel: KV grid (ID, dates, client, phone, email, ticket ref, method, priority, status, attempts, driver, tracking, signature, recipient, flags, address + notes, proof, failure reason, internal notes), Items list (qty, name, schedule colour, batch, expiry), Delivery Log newest first (`971-1160`).
7. New Delivery — where: `#dv-btn-new` → two-pane modal, form left / map right (`1604-1783`): Order Date, Client Name (required), Phone (required), Email, Delivery Address (required), Address Notes, Method (In-house Driver / Courier / Collection), Priority 1 Urgent / 2 Standard / 3 Flexible, **Status dropdown with all seven statuses**, Scheduled Date, Time Slot (free text), Driver / Carrier select (localStorage list + "✚ Add new driver…" inline input), Tracking Number, Ticket Reference (free text), Flags ❄️ Cold Chain / ✍ Signature Required, Items editor, Internal Notes; delivery id `DEL-00001…` from a localStorage counter (`115-126`); auto-sets `contains_controlled` when any item has schedule CD (`352-353`); API: POST `/client-deliveries/entries`.
8. Items editor — where: inside the modal (`1262-1324`): rows of Name, Qty, Schedule OTC/P/POM/CD, Batch Ref, Expiry (month input), ✕; "+ Add Item"; blank-name rows dropped on save (`1722`).
9. Address map — Leaflet 1.9.4 + OSM tiles loaded from cdnjs at modal open (`1344-1363`); click on map drops a draggable pin and reverse-geocodes (ArcGIS first, Nominatim fallback) into the address textarea (`1391-1396`, `1477-1529`); typing ≥5 chars forward-geocodes after 800 ms with "Malta" appended, score-based match note, pin placed (`1398-1409`, `1532-1598`); pin drag reverse-geocodes (`1459-1462`).
10. Edit Delivery — where: "Edit" in Selected panel → same modal; API: PUT full record (`1755`).
11. Delete — where: "Delete" → confirm modal → DELETE (`1933-1950`).
12. Add Log Entry — where: "+ Add Log Entry" → textarea modal → appends `{ts, author, text}` to `delivery_log` and PUTs the full record (`1788-1824`).
13. Mark Delivered — where: "✅ Mark Delivered" (disabled when Completed/Failed bucket) → modal: Actual Delivery Date (default today), Delivery Time, Recipient Name (default client), ✍ Signature Obtained (only if required), Proof of Delivery text → status Delivered, attempts = max(1, n), log line "Marked as Delivered. <proof>" (`1829-1879`).
14. Mark Failed — where: "✗ Mark Failed" (same disable rule) → modal: Failure Reason (required), shows "Attempt number after this"; attempts+1; **attempt ≥ 3 → status Returned**, else Failed; log line "Attempt n — Failed: reason" (`1884-1928`).
15. Print single delivery — where: "🖨 Print" in Selected panel (`1205-1255`); extras: A4 sheet with header (DEL id, client, scheduled, status), KV grid, address + notes, proof, failure reason, Items table (Qty, Name, Schedule, Batch Ref, Expiry), Delivery Log; auto-print.
16. Print tab table — where: `#dv-print-active|completed|failed` (`1165-1203`, `2240-2248`); extras: popup table Del #, Order Date, Scheduled, Client, Phone, Method, Driver, Status, Address, Items (qty× name list); auto-print.
17. Refresh — `#dv-btn-refresh`.
18. Driver list persistence — localStorage `eikon_deliveries_drivers_v1`, default `["Kevin Mifsud"]`, add-new on save (`88-110`, `1714-1720`).
19. Local fallback mode — `eikon_deliveries_v1`, `?dv_allow500=1` / `eikon_deliveries_pref_allow500` (`174-234`, `256-296`); mode badge Online / Local / API error (`2085-2090`).
20. Automatic normalisation on load — invalid order_date → today, priority → 2, unknown status → Scheduled (`2121-2127`); items/log parsed from JSON strings (`58-66`, `331-332`).
21. Flags shown as 🔐 / ❄️ next to the client name in the Active table (`761-762`) and as chips in the panel (`1057-1069`).
22. Attempt badge colour (1 green, 2 orange, ≥3 red) (`601-608`).
23. Keyboard: Enter/Space on rows only.
24. `id_doc_ref` exists in the data model (`316`, `366`) but **no input is rendered**; the save reads a non-existent `#dv-id-doc` (`1749`).

**Data & state.** Endpoints: GET/POST `/client-deliveries/entries`, PUT/DELETE `/client-deliveries/entries/:id` (worker `7241-7455`, table `client_deliveries`, `items` and `delivery_log` stored as JSON text). Third-party calls from the browser: `geocode.arcgis.com` (forward + reverse), `nominatim.openstreetmap.org` (forward + reverse), `tile.openstreetmap.org`, `cdnjs.cloudflare.com` (Leaflet). localStorage: `eikon_deliveries_drivers_v1`, `eikon_deliveries_seq_v1`, `eikon_deliveries_v1`, `eikon_deliveries_pref_allow500`. No polling. `ticket_ref` is a free-text pointer to Tickets; nothing resolves it. Worker `/contacts/clients/aggregated` harvests `client_name/phone/delivery_address` from this table (`worker:16710`).

**Permissions & scoping.** None client-side. Worker `requireRole(["admin","staff"])` on create/update/delete (`worker:7272, 7358, 7438`); list has no role gate (`worker:7241`). All queries org+location scoped. Server does **not** validate `status`, `delivery_method`, `items`/`delivery_log` JSON, or `delivery_id` uniqueness (`worker:7279-7312`).

**Edge cases & risks (found in code, cite line numbers).**
- **Delivery numbers are generated per browser** from `localStorage eikon_deliveries_seq_v1` (`115-126`): two PCs both issue `DEL-00001`; clearing site data restarts the sequence; no unique index on `delivery_id` (`worker:7195`). The printed sheet and the customer-facing reference are therefore not unique.
- **Every action is a full-record PUT built from the in-memory row** — edit (`1724-1756`), add log (`1804-1808`), delivered (`1853-1864`), failed (`1907-1914`). Two PCs: a log entry or "Delivered" saved on PC A is erased when PC B saves an Edit modal it opened earlier. No `updated_at` guard anywhere.
- **`id_doc_ref` is wiped on every edit** because the field is read from a non-existent input (`1749`) and `validateAndBuild` sends "" (`366`).
- **Log author is always empty.** `E.state.user.display_name` does not exist; the session user carries `full_name` (`worker:1073`, `core.js:1246`), so `author` is "" in every log line (`1803`, `1850`, `1903`). The delivery log cannot show who delivered or who recorded the failure.
- **Customer addresses are sent to ArcGIS and OpenStreetMap/Nominatim** on every address edit (after 800 ms) and on every map click/drag (`1447-1450`, `1483-1488`, `1504-1507`, `1540-1544`, `1578-1581`) — identifiable patient data to third parties with no consent switch, no org setting, and no `User-Agent`/referrer identification as Nominatim's policy requires. Also fails silently offline (map just never loads, `1358-1361`).
- **Status can be set to Delivered/Returned/Cancelled from the Edit dropdown** (`1675`, `1738`) bypassing recipient/signature/proof capture and the attempt counter; conversely once a delivery is `Failed` (attempt 1 or 2) the Mark Delivered / Mark Failed buttons are disabled (`1001-1002`) because `Failed` sits in the failed bucket, so a retry must be done by editing the status back to Scheduled by hand. The three-strikes-then-Returned rule is thus easy to bypass and awkward to follow.
- **Signature is optional even when required**: Mark Delivered accepts an unchecked "Signature Obtained" for CD / signature-required deliveries (`1836`, `1847`) and still records Delivered. No prompt, no warning.
- **Server `LIMIT 2000`** (`worker:7265`) silently drops the oldest rows; the stats tiles and the Completed tab then under-report with no indication.
- **Create result is not checked** (`1756`): an `{ok:false}` POST response closes the modal and refreshes as if saved.
- **Driver list is per browser** (`88-110`): the same driver appears under slightly different spellings across PCs, breaking search/sort by driver.
- **Local fallback** has the same one-way data-loss trap as Client Orders (`192-200`, `270-278`).
- **Dates/time:** `scheduled_time_slot` and `actual_delivery_time` are free text; `fmtTs` renders UTC log timestamps in browser local time (`36-44`) — consistent for Malta, but a log written at 00:10 local is stored as the previous UTC date.
- Items `expiry` is a `YYYY-MM` string with no comparison against today; CD items are flagged but there is no link to the DDA register.
- **Silent catches:** `1341`, `1420`, `1776`, `1779`, `1782`, `917-919`, `916`.
- **Destructive without confirm:** Mark Delivered / Mark Failed (status changes) are immediate on button click inside their modals (that is the confirm); Edit status changes have none; Delete is confirmed.
- Map instance leak if the modal is closed by any path other than Cancel/Save (`1708`, `1758`); next open calls `dvMapCleanup` (`1376`) so it self-heals.
- Phone required on the client, not on the server (`worker:7310-7312`); email not validated at all.

**Speed notes.** One GET of up to 2,000 full rows (each with embedded items + log JSON; ≈ 1-3 KB/row → up to several MB) on every load/refresh/save. Modal open loads Leaflet (≈ 150 KB) and tiles. Each keystroke in a search rebuilds that tab's table (`renderTable` with DOM calls) and the Selected panel. Every save triggers a full reload.

**Must not be lost.**
- Proof of delivery: actual date/time, recipient name, signature obtained flag, free-text proof, and the timestamped delivery log (legal evidence of supply, especially for CD / POM items).
- Attempt counter with failure reasons and the automatic Returned state at the third failed attempt.
- Controlled-drug and cold-chain flags (and the CD auto-flag from items) visible in the list and on the printed sheet.
- Items with batch reference and expiry per delivery.
- Driver / courier assignment, tracking number and scheduled slot.
- Printable single-delivery sheet (driver's run sheet) and per-tab lists.
- Address capture with map-assisted geocoding (the driver relies on it), subject to a privacy decision on third-party geocoders.

---

## Client Tickets  (`modules.tickets.js`, id `tickets`, order 220, visible to: pharmacy role; worker requires `admin|staff` on all endpoints; list/create/update org+location scoped, delete org-wide)
**Purpose.** Log customer issues/complaints/enquiries against a named customer with category, priority, assignee, follow-up date and a timestamped notes log, tracked Open → In Progress → Awaiting Client → Resolved/Closed.

**Functions.**
1. Load all tickets — where: on render and Refresh; API: GET `/client-tickets/entries` (no server limit).
2. Open Tickets table / Resolved & Closed table — split client-side on `resolved || status in (Resolved, Closed)` (`615-630`); 9 columns each (Ticket #, Date, Client, Phone, Category, Priority, Status, Assigned To, Follow-up).
3. Search per table — `#tk-search-open|resolved`, live, client-side over id/date/client/phone/email/category/issue/assignee/status/follow-up and all notes text (`54-68`, `1395-1408`).
4. Sort per table — click headers; defaults Open = priority asc, Resolved = open_date desc (`590-591`, `722-739`).
5. Select row — click / Enter / Space (`663-672`) → Selected Ticket panel: KV grid (ID, date opened, phone, email, category, priority, status, assigned, follow-up, resolved-at, issue) and Notes Log newest first (`1198-1295`).
6. New Ticket — where: `#tk-new` → modal (`868-1001`): Date Opened, Client Name (required), Phone, Email (regex), Category select (localStorage list + "➕ Add new category…" inline input; required), Priority 1/2/3, Status (Open / In Progress / Awaiting Client / Resolved / Closed), Issue Description (required), Assigned To select (localStorage staff list + add new), Follow-up Date; ticket id `TKT-00001…` from a localStorage counter (`124-135`); API: POST `/client-tickets/entries`.
7. Edit Ticket — "Edit" → same modal → PUT full record (`972`); `resolved_at` set when status becomes Resolved/Closed and cleared otherwise (`948-953`).
8. Delete — "Delete" → confirm modal → DELETE (`1058-1077`).
9. Add Note — "Add Note" → textarea modal → appends `{ts, author, text}` to `notes_log`, PUT full record (`1006-1053`).
10. Print Ticket — single sheet: header (TKT id, opened, status, priority), KV grid, Issue box, Notes Log; auto-print (`815-863`).
11. Mark Resolved / Reopen Ticket — toggle button in panel, no confirm: Open-ish → Resolved with `resolved_at` (kept if already set), Resolved/Closed → Open with `resolved_at` cleared (`1375-1393`); PUT full record.
12. Print Open list / Print Resolved list — `#tk-print-open|resolved` (`745-812`); extras: popup table with 12 columns including the full Issue and the whole Notes Log (`[ts] author: text` per line), row count, search text, printed timestamp; auto-print.
13. Refresh — `#tk-refresh`.
14. Category and staff lists — localStorage `eikon_tickets_cats_v1` (defaults Billing, Prescription, Product Complaint, Delivery, General Enquiry) and `eikon_tickets_staff_v1` (default "John Agius") (`73-119`).
15. Local fallback mode — `eikon_tickets_v1`, `?tk_allow500=1` / `eikon_tickets_pref_allow500` (`192-252`, `274-317`); badge Online / Local / API error (`1190-1195`).
16. Automatic normalisation on load — invalid open_date → today, priority → 2, unknown status → Open (`1306-1313`).
17. Priority badge (1 red High, 2 orange Medium, 3 green Low) and status chips (`511-530`).

**Data & state.** Endpoints: GET/POST `/client-tickets/entries`, PUT/DELETE `/client-tickets/entries/:id` (worker `3780-4021`, table `client_tickets_entries`, `notes_log` JSON text validated as an array server-side `worker:3859-3865, 3952-3957`). localStorage: `eikon_tickets_cats_v1`, `eikon_tickets_staff_v1`, `eikon_tickets_seq_v1`, `eikon_tickets_v1`, `eikon_tickets_pref_allow500`. No polling. Consumed by Dashboard (`modules.dashboard.js:1354-1364`, counts open) and by the worker's `/contacts/clients/aggregated` (`client_name, phone`, `worker:16706`). Referenced (by free text only) from Deliveries `ticket_ref`.

**Permissions & scoping.** None client-side. Worker `requireRole(["admin","staff"])` on list/create/update/delete (`worker:3774-3776, 3825-3827, 3893-3895, 3997-3999`). List/create/update scoped org+location; **delete is org-wide by id** by explicit design (`worker:4008-4019`).

**Edge cases & risks (found in code, cite line numbers).**
- **Ticket numbers are per browser** (`124-135`): duplicate `TKT-0000n` across PCs, restart after cache clear; the server index on `ticket_id` is not unique (`worker:3724`). The number printed and quoted to the customer is not reliable.
- **Lost updates between PCs** — Add Note (`1025-1034`), Edit (`955-972`) and Resolve toggle (`1382-1385`) each PUT the full in-memory record. Notes added on one PC are deleted by a later Edit save from another.
- **Note author is always empty** (`1023`, `display_name` does not exist on the session user) — the notes log cannot show who spoke to the customer.
- **Follow-up date has no consequence**: nothing surfaces overdue follow-ups (no dashboard count, no sort default, no highlight, no notification). "Awaiting Client" tickets have no reminder.
- **Categories and staff are browser-local** (`79-119`): each PC has its own list and its own spellings; the DB stores free text, so reporting by category is unreliable.
- **No server limit and no pagination** (`worker:3789-3816`): every load returns every ticket ever written, and each search keystroke rebuilds both tables.
- **Resolve toggle has no confirm** (`1375`) and reopens Closed tickets as Open (losing the Closed/Resolved distinction).
- **Delete is org-wide** on the server while the list is location-scoped; the UI confirm shows ticket id + client.
- Create result not checked (`973`); an `{ok:false}` closes the modal.
- Local fallback has the same one-way data-loss trap (`210-218`, `288-297`).
- `modalConfirm` is defined and unused (`178-187`); silent catches `1000`, `1052`, `1294`, `1330`.
- Dashboard's "open" count treats `status==="resolved"` (lower-case compare) or the `resolved` flag as resolved (`dashboard.js:1360`); consistent with the server-derived flag, but "Closed" tickets without the flag (legacy rows) would count as open.
- Email validated on the client (`360`) but not on the server; phone not required anywhere.

**Speed notes.** One unbounded GET per load/refresh/save (≈ 1 KB/row + notes). Two tables rebuilt on each keystroke/sort. Print of the Open list embeds all notes for all open tickets.

**Must not be lost.**
- Ticket number, open date, category, priority, status and assignee per customer issue (complaint handling evidence).
- Timestamped notes log (needs a real author).
- Follow-up date and "Awaiting Client" state (the promise made to the customer).
- Resolved/closed timestamp and the Open vs Resolved split with search in both.
- Printable single ticket and printable open list for handover.
- Cross-reference from a delivery to a ticket (currently free text).

---

## Cross-module findings for the "Customers" merge

**How a customer is identified today.**
| Module | Customer fields | Required | Identifier |
|---|---|---|---|
| Client Orders | `client_name`, `client_phone` ("Contact"), `client_alt_phone`, `client_email`, `client_address` | name (UI+server); phone only on server *update* | none; 6-char `order_code` identifies the order, not the person |
| Client Deliveries | `client_name`, `phone`, `email`, `delivery_address`, `address_notes`, `id_doc_ref` (schema only, never captured) | name, phone, address (UI); name, address (server) | none; `DEL-nnnnn` per browser |
| Client Tickets | `client_name`, `phone`, `email` | name (UI+server) | none; `TKT-nnnnn` per browser |
| Quotations | none (supplier side) | — | — |
| Order Diary | none (supplier side) | — | — |

Everything is free text; no contact id, no phone normalisation, no ID-card capture (except the unused `id_doc_ref` column). The same person is typed three times.

**Can the same customer be linked across these modules today?** No. There is no shared key. The only cross-references are: (a) Deliveries `ticket_ref` → Tickets, a free-text string nobody validates or resolves (`deliveries.js:1682`); (b) Client Orders → Order Diary by `item_name` text equality on the same date, not by customer (`clientorders.js:755-771`); (c) the worker endpoint `/contacts/clients/aggregated` (`worker:16683-16724`) which, for the Contacts module, unions distinct `lower(name)|id_card` across client_orders, client_tickets, client_deliveries, dda_sales and poct_patients — the closest thing to a customer list that exists, and it is read-only, location-scoped, de-duplicated by name only for these three tables, and keeps the first address/phone seen. "Re-order" copies a past order's customer fields by value (`clientorders.js:1873-1901`); no history view per customer exists anywhere.

**Every status a record can be in, and the transitions.**
- Client Order: `Active` (fulfilled=0) ⇄ `Fulfilled` (fulfilled=1, `fulfilled_at`) via the toggle button or the modal checkbox; no other states. Orthogonal `follow_up_status`: `""`, `called`, `not_wanted`, `not_available`, `called_no_answer`, `wrong_number` — any → any from the Edit modal; `called_no_answer` stamps a dated note. Orthogonal `priority` 1/2/3.
- Order Diary line: `pending` → `received` | `not_received` | `wrong_pick` (buttons); `received` ⇄ `not_received` (buttons); `wrong_pick` reachable from any state (button) and always creates a Returns record; no UI path back to `pending` (server allows all four). Carry-over copies pending/not_received/wrong_pick lines to the next day as new `pending` lines; the source stays as is.
- Delivery: `Scheduled` → `Dispatched` → `Out for Delivery` only via the Edit dropdown (no quick actions); active → `Delivered` via Mark Delivered (requires nothing but a click; signature optional); active → `Failed` via Mark Failed (attempt 1, 2) and → `Returned` when the recorded attempt reaches 3; `Cancelled` only via Edit; **any → any via the Edit status dropdown** with no guard; buttons are disabled once in Completed or Failed bucket, so `Failed` → retry requires an Edit back to an active status.
- Ticket: `Open` / `In Progress` / `Awaiting Client` (open bucket) / `Resolved` / `Closed` (resolved bucket); any → any via Edit; toggle button: open bucket → `Resolved`, resolved bucket (incl. `Closed`) → `Open`. `resolved` flag and `resolved_at` derived server-side from status (`worker:3933-3943`).
- Quotation line: no status.

**Every notification sent.** None. There is no SMS, WhatsApp or e-mail anywhere in these five modules or their worker handlers (grep of the worker for sms/whatsapp/twilio/mail returns nothing relevant). Customer phone/e-mail is captured in three modules and used for nothing. The only "send-like" features are clipboard copies: Order Diary "Copy for Email" per supplier (`orderdiary.js:1131-1155`) and the Quotations GPT-link copy (`quotations.js:1969-1995`). Toasts are in-app only.

**Every print / label / PDF format.** All are `window.open` + `document.write` HTML with an auto `window.print()`; no PDF generation, no server-side rendering.
1. Client Orders list (Active or Fulfilled, filtered) — 15-column table, row count / search / printed stamp (`clientorders.js:986-1064`).
2. Client Order sticker — 80 mm chit, order code + QR (bwip-js CDN), client, contact, items, needed by, pick up, follow-up, priority (`clientorders.js:1069-1138`). The only label.
3. Quotations report — date range + supplier filter, 10 columns, invested vs retail totals, auto-close after print (`quotations.js:994-1090`).
4. Order Diary day sheet — grouped by supplier, stats row, status badges, location name (`orderdiary.js:1180-1248`).
5. Deliveries tab list — 10 columns incl. address and item summary (`deliveries.js:1165-1203`).
6. Delivery run sheet (single) — header, KV grid, address, proof/failure, items with batch & expiry, full log (`deliveries.js:1205-1255`).
7. Tickets list (Open or Resolved) — 12 columns incl. full issue and full notes log (`tickets.js:745-812`).
8. Ticket sheet (single) — header, KV grid, issue box, notes log (`tickets.js:815-863`).

**Shared defects to fix once in the rebuild.**
- Client-generated sequential ids from `localStorage` (DEL, TKT) and random codes (orders) with no server uniqueness.
- Full-record PUT with no optimistic-concurrency token in all three customer modules.
- `author` resolved from a non-existent `display_name` → empty audit trail in delivery logs and ticket notes.
- Identical localStorage "fallback DB" pattern in three modules that silently strands data.
- Per-browser reference lists (drivers, categories, staff) that should be org data.
- Worker scoping asymmetry: lists are location-scoped, deletes (orders, tickets) and updates (quotations, order diary) are org-wide by id; quotations and order diary have no role gate at all.

**Could not determine from the code read.**
- Whether `E.modal` can be dismissed by Escape/overlay (affects the Leaflet cleanup path and the "Cancel" assumptions above).
- Whether the worker's `computeItemProfitFields` matches the UI `recalcItem` formula exactly (the server recomputes and overwrites what the UI sends).
- Which `user.role` values exist besides `admin`/`staff`; any other role would be 403'd on orders/tickets/deliveries but allowed on quotations/order diary.
- Real data volumes (rows per location) behind the unbounded quotations/tickets lists and the 2,000-row deliveries cap.
- Whether any org actually uses the Collection delivery method or the `id_doc_ref` column via other tooling.
