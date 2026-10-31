# Audit D — Stock area

Scope: the eleven UI modules that will merge into one "Stock" area, read in full, with the Cloudflare Worker handlers behind each API call checked only where needed to establish what a button actually does. Line numbers are `ui/<file>:<line>` unless prefixed `worker:` (which means `cloudflare-worker/code:<line>`).

Two facts apply to every module below and are not repeated in each section:

- `E.apiFetch` (core.js:250-310) returns parsed JSON on 2xx and **throws** on non-2xx with `err.status`, `err.bodyText`, `err.bodyJson`. Modules that test `res.ok === false` after an await (stocktransfers, returns, emergencypos upload) are testing a path that can never be reached; all failures arrive through `catch`.
- `E.toast`, `E.showToast` and `E.esc` are **never defined anywhere in the UI** (grep of `ui/*.js`, `core.js`, `main.js`, `index.html`). The five Cherubino modules route all success/warning feedback through `if (E.toast) E.toast(...)`, so pharmacists see **no confirmation, no warning and no error text** for any action in those modules; near-expiry's `E.showToast && …` guards are likewise silent. This matters most for the "click again to confirm delete" pattern, see Cherubino Orders and OOS.

Module access: the hash router (core.js:1219-1226) only checks that a module id is registered. Sidebar categories (core.js:775-798) hide modules; they do not block `#cherubino-oos` typed by a user in another organisation. Every org-12 restriction is therefore enforced by the Worker, or not at all (see each Permissions block).

---

## Stock Transfers  (`modules.stocktransfers.js`, id `stocktransfers`, order 245, visible to: pharmacy role, "Inventory" sidebar group; worker requires role admin|staff; items visible to all locations of the same organisation)
**Purpose.** Let one pharmacy list surplus stock so sister pharmacies in the same organisation can request it, and track the request through accept → dispatch → delivery.

**Functions.**
1. View "Available for Transfer" tab (all org items, open or including closed) — where: tab `st-tab[data-tab=available]` (1038); API: GET /stock-transfers/items (226-249); extras: —
2. View "Transfer Requests" tab (items I own that have requests, or items where I have a request; Outgoing/Incoming badge) — where: tab (1039, 644-733); API: same payload, client-side filter; extras: —
3. Search as you type across description, batch, expiry, quantity, org, location, close reason (client-side) — where: input `st-search` (1014, 1063-1069, 209-218); API: none; extras: —
4. "Open only" filter checkbox (default on; ignored on the Requests tab) — where: `st-filter-open` (1020, 1071-1077, 202-206); API: none; extras: —
5. Refresh — where: button `st-refresh` (1079); API: GET /stock-transfers/items?ts=; extras: —
6. Auto-refresh every 30 s when not busy — where: timer set in render (1108-1111), cleared in destroy (1114-1119); API: GET /stock-transfers/items; extras: —
7. Print current list — where: button `st-print` (1080, 905-956); API: none; extras: popup window, auto `window.print()`, columns Date/Description/Batch/Expiry/Qty rem-total/Status
8. Place item for transfer (description*, batch, expiry, quantity*) — where: modal from `st-new` (851-900, 260-289); API: POST /stock-transfers/items; extras: client blocks expired expiry (886) and server does too (worker:12039)
9. Expand item detail row (item info, source module, "Placed on Returns/Scarce Stock" flags, requests table) — where: click any row (627-630, 735-846); API: none; extras: —
10. Request transfer of a quantity with private note (non-owner, open, not expired, remaining > 0) — where: button `st-request` in detail (789, 342-391); API: POST /stock-transfers/items/:id/requests; extras: quantity max = remaining (352)
11. Accept a pending request (owner) — where: button `st-accept-req` (815, 393-407); API: POST /stock-transfers/requests/:id/accept; extras: no confirmation dialog
12. Reject a pending request (owner) — where: button `st-reject-req` → confirm modal (816, 409-440); API: POST …/reject; extras: —
13. Confirm dispatch (owner, accepted request) — where: `st-dispatch` (818, 442-456); API: POST …/confirm-dispatch; extras: no confirmation dialog
14. Confirm received (requester, dispatched request) — where: `st-confirm-delivery` (829, 458-472); API: POST …/confirm-delivery; extras: server closes the item when delivered ≥ quantity and deletes a linked scarce-stock offer (worker:12245-12262); no confirmation dialog; irreversible (worker:12280)
15. Cancel own pending request — where: `st-cancel-req` → confirm (827, 474-505); API: DELETE /stock-transfers/requests/:id; extras: server also lets the owner delete any non-delivered request (worker:12274-12280) but the UI never exposes that
16. Place on Returns (owner; allowed for expired items too) — where: `st-place-returns` (768/780, 508-524); API: POST …/place-on-returns → creates `returns_entries` row with remarks "From Stock Transfer" (worker:12302-12306); extras: no confirmation
17. Place on Scarce Stock (owner; not expired) — where: `st-place-scarce` (771, 526-546); API: POST …/place-on-scarce-stock → creates `scarce_stock_offers` row (worker:12332-12336); extras: no confirmation
18. Remove from transfer (owner) — where: `st-delete-item` → confirm modal (773/782, 307-339); API: DELETE /stock-transfers/items/:id; extras: cascades: deletes the linked Returns row, the linked Scarce Stock offer **and every other pharmacy's requests on it**, and all transfer requests (worker:12094-12127)
19. Flashing row highlight for the owner when any request is pending/accepted/dispatched (Available tab) and for "pending for me"/"dispatched to me" (Requests tab) — where: CSS `st-flash-row` (108-109, 598, 693); API: none
20. Expired detection and strike-through (client, local date) — where: 63-66, 234-239, 583; server additionally **auto-closes** expired items owned by the caller on every list GET and deletes their linked scarce offer (worker:11911-11931)
21. Status badges Open/Pending/Accepted/Dispatched/Delivered/Rejected/Closed/Expired — where: 174-188
22. Tab switch resets selection and heading — where: 1086-1097
23. `doUpdate` (PUT /stock-transfers/items/:id) exists (291-305) but **no UI calls it**; there is no edit function for a listed item.

**Data & state.** Endpoints: GET/POST /stock-transfers/items, DELETE /stock-transfers/items/:id, POST /stock-transfers/items/:id/{requests,place-on-returns,place-on-scarce-stock}, POST /stock-transfers/requests/:id/{accept,reject,confirm-dispatch,confirm-delivery}, DELETE /stock-transfers/requests/:id. Tables: `stock_transfer_items`, `stock_transfer_requests`, side-effects on `returns_entries`, `scarce_stock_offers`, `scarce_stock_offer_requests`, `audit`. No localStorage, no offline queue. Polling 30 s. Cross-module: Returns posts here with `source_module:"returns"` (modules.returns.js:791-799); Scarce Stock posts via its own `/place-on-transfer` endpoint; Returns PUT with `handed_over=1` auto-closes transfer items created from that return (worker:7100-7130). Nothing exposed on `window.EIKON`.

**Permissions & scoping.** Worker: `requireRole(["admin","staff"])` on every handler; owner-only actions check `org_id` + `location_id` of the item (worker:12067-12069, 12100-12102, 12183-12185 …); requester-only on delivery (worker:12237-12239); same-org visibility (worker:11934-11942, 12141-12143). UI hides buttons with server-supplied `mine_owner` / `mine` flags; nothing is client-side-only.

**Edge cases & risks (found in code, cite line numbers).**
- Print on the "Transfer Requests" tab prints the wrong data: `openPrintWindow` calls `applyFilter()` which is the Available-tab filter (906-907) while the title says "Incoming Requests" (938); the requests table itself is never printed.
- Quantity is not reserved until delivery: remaining = quantity − delivered only (worker:11981-11987, 12159-12162). Two pharmacies can each request the full quantity, the owner can accept and dispatch both, and `confirm-delivery` never re-checks (worker:12231-12262) — delivered total can exceed stock; UI clamps the display with `Math.max(0, …)` (worker:11987) so the over-delivery is hidden.
- Three irreversible state changes have no confirmation: Accept (393), Confirm Dispatch (442), Confirm Received (458) — the last one closes the item and deletes a linked scarce-stock offer server-side.
- Place on Returns / Place on Scarce Stock create records in other modules with one click and no confirmation (508, 526).
- "Remove from Transfer" cascade deletes other pharmacies' scarce-stock requests (worker:12111) and the Returns row including any checklist progress on it (worker:12105) — the confirm text (310) says so, but there is no undo.
- Read-with-write side effects: every 30 s poll from every PC runs UPDATE/DELETE statements for expired items (worker:11907-11931). Harmless when idempotent, but it makes GET non-cacheable and generates audit rows from background polling.
- Timezone: client "expired" uses local date (52-55, 65); server uses `todayYmdSt()`; around midnight a client may block ("Expired items cannot be placed", 886) what the server would accept, or show "EXPIRED" on an item the server still treats as open.
- Failed auto-refresh shows a blocking error modal every 30 s while offline (243-244, 1109-1111).
- `filterOpen` is not applied on the Requests tab (651-659): closed items keep appearing there; inconsistent with the checkbox label.
- No pagination and closed items are never archived: the GET returns the whole org history forever (worker:11934-11942, no LIMIT).
- No edit of a mistyped item (23 above) — the only fix is remove (cascade) and recreate.
- No keyboard shortcuts; Enter inside modals does not submit.

**Speed notes.** One GET per load/refresh (~1 KB per item incl. nested requests); 30 s polling per open tab. Every keystroke re-renders the whole `tbody` via innerHTML (1065-1068 → 566-642); fine up to a few hundred rows. Server does up to 2 + N×(1–4) writes per GET when expired items exist.

**Must not be lost.**
- Same-organisation cross-pharmacy visibility of surplus stock with owner/requester role split.
- Five-step workflow with the receiving pharmacy confirming receipt (chain of custody) and server-side audit rows for every step.
- Partial-quantity transfers with automatic close when fully transferred.
- Expired stock blocked from transfer/scarce stock but still routable to Returns.
- Links to Returns and Scarce Stock that close/delete each other (needs to become explicit and reversible in the rebuild).
- Private note visible only to the two parties.
- Printable list of what is on offer.

---

## Returns  (`modules.returns.js`, id `returns`, order 240, visible to: pharmacy role, "Inventory" group; worker requires admin|staff; data scoped to own org + location)
**Purpose.** Monthly log of items being returned to suppliers with a four-step checklist (arranged / handed over / collection note / credit note) and a supplier-refused state.

**Functions.**
1. Month selector (type=month, default current local month) — where: `re-month` (545, 667-673); API: GET /returns/entries?month=YYYY-MM (server filters `entry_date LIKE 'YYYY-MM-%'`, LIMIT 800, worker:6933-6953); extras: —
2. Search as you type across all text fields (client-side) — where: `re-search` (550, 675-682, 132-145); API: none
3. Refresh — where: `re-refresh` (556, 684-685); API: GET as above
4. Print the filtered month — where: `re-print` (557, 687-691, 372-449); extras: popup, auto-print, columns Date/Description(+qty, supplier, ID)/Expiry/Batch/Invoice/Remarks/Location/Checklist
5. New entry (clears form, date = today) — where: `re-new` (558, 693-698)
6. Details form: date, description, expiry, batch, quantity (free text), supplier, invoice number, remarks, location stored — where: 571-623; API: via Save
7. Remarks suggestion chips: Wrong Pick, Expiring soon, Damaged, Wrong quantity, Received late, Duplicate order — where: 100-107, 504-532
8. Checklist checkboxes: Return arranged, Handed over, Collection note received, Credit note received, Damaged item (+ hidden `supplier_refused`) — where: 627-633; disabled when refused (222-236)
9. Save (create or update whole record) — where: `re-save` (638, 294-330); API: POST /returns/entries or PUT /returns/entries/:id; validation: date YMD, description required, expiry YMD or empty (297-308)
10. Delete selected entry — where: `re-delete` → confirm modal (639, 332-370); API: DELETE /returns/entries/:id; server unlinks near-expiry (worker:7150-7158)
11. Mark as Refused (saved, not yet refused) — where: `re-refuse-btn` → confirm (640, 706-742); API: PUT with current form + `supplier_refused=1`; server sets linked near-expiry `return_status='refused'` (worker:7085-7097)
12. Copy for Email (plain-text summary to clipboard) — where: `re-copy-email` (644, 744-765); extras: clipboard
13. Place on Transfer (selected, not handed over) — where: `re-place-transfer` → confirm (645, 767-810); API: POST /stock-transfers/items {source_module:"returns", source_id}; server rejects duplicates with 409 (worker:12043-12049)
14. Row click selects & fills form; selection preserved across refresh — where: 481-484, 266-273
15. Row meta badges: From Near Expiry, Supplier refused, Damaged, Qty, Supplier, Inv — where: 486-497
16. Selected-ID/flags line above the form — where: 238-253
17. Automatic server side effects on Save: near-expiry status sync (`pending`/`handed_over`/`refused`, worker:7085-7097); `handed_over=1` closes transfer items created from or linked to this return (worker:7100-7130)
18. Entries also arrive from other modules: Near Expiry "Return"/"Bulk Return" (remarks "Expiring soon"), Stock Transfers and Scarce Stock "Place on Returns", Supplier Inventory "Report Problem → Add to Returns" (modules.supplier-inventory.js:1344-1355, sets `damaged`)

No auto-refresh; no destroy hook; no keyboard shortcuts.

**Data & state.** Endpoints: GET/POST /returns/entries, PUT/DELETE /returns/entries/:id, POST /stock-transfers/items. Tables: `returns_entries`; side effects on `near_expiry_entries`, `stock_transfer_items`, `audit`. No localStorage.

**Permissions & scoping.** Worker `requireRole(["admin","staff"])` and `org_id`+`location_id` on every query. No admin-only UI; any staff member can delete.

**Edge cases & risks (found in code, cite line numbers).**
- Month-boundary blindness: the list is filtered by `entry_date` month (261, worker:6933-6936). A return opened in October whose credit note arrives in November is only visible after changing the month; there is no "open returns" view, so checklist completion across months is easy to miss.
- UTC vs local date on auto-created rows: returns created from Near Expiry use `new Date().toISOString().slice(0,10)` on the server (worker:5105, 5174) while the UI's default month and date are local (91, 184). Between 00:00 and 02:00 Malta time on the 1st of a month the new return lands in the previous month and the user "cannot find" it.
- Whole-record overwrite on every PUT (worker:7044-7067) with no version check: two PCs ticking different checklist boxes on the same return overwrite each other (last writer wins); `Mark as Refused` also sends the full form (725-727).
- Deleting a return does **not** close a transfer item created from it (worker:7135-7160 only unlinks near expiry), contradicting the modal text at 781 ("it will be automatically removed from the transfer list") — leaves an orphaned transfer offer.
- Quantity is free text (595); `Place on Transfer` does `parseInt(sel.quantity,10) || 1` (796) so "box of 10" becomes 1 and "2 boxes" becomes 2 silently.
- Server LIMIT 800 (worker:6953) truncates silently; no indication in UI.
- `Place on Transfer` uses `state.selected` (773), i.e. the last saved row, not unsaved edits in the form.
- `doRefresh` re-fills the form from the server row (273-275) — an in-progress edit is lost on manual Refresh or after Save of another row.
- No concurrency signal between PCs (no polling) — a return marked handed over on PC A still shows pending on PC B until reload.
- Copy for Email requires a secure context; failure is a toast only (762-764).

**Speed notes.** One GET per month change (≤800 rows); client-side filter; render is O(n) with per-row closures. Negligible.

**Must not be lost.**
- Four-step checklist, especially *Credit note received* (money owed by supplier) and *Collection note received* (proof of hand-over).
- Supplier-refused state that closes the return but keeps it on record.
- Invoice number + supplier + batch + expiry for reconciliation with the credit note.
- Link to the Near Expiry item and status sync back to it.
- Monthly printable register and Copy-for-Email text for supplier reps.
- Damaged flag and "location stored" (where the quarantined stock physically is).

---

## Near Expiry  (`modules.nearexpiry.js`, id `nearexpiry`, order 270, visible to: pharmacy role, "Inventory" group; worker requires admin|staff; own location only)
**Purpose.** Shelf list of short-dated products with days-to-expire traffic light and one-click hand-off to Returns or Scarce Stock.

**Functions.**
1. Add entry form (product name*, expiry*, location, notes) — where: top card + `ne-add` (815-838, 885-896); API: POST /near-expiry/entries; extras: optimistic insert (333-336)
2. Enter key in any of the four add inputs triggers Add — where: 898-908 (keyboard)
3. Search as you type (client; product, expiry, location, notes) — where: `ne-search` (845, 935-941, 111-121)
4. Sort by Product / Expiry / Days to expire / Location / Notes, click toggles asc/desc — where: headers `th[data-key]` (858-862, 183-196, 123-159)
5. Days pill & row colouring: Expired (n d) / Expires today / ≤30 / ≤90 / >90 — where: 220-235, 255-271
6. Refresh — where: `ne-refresh` (849, 910-921); API: GET /near-expiry/entries (server hides `return_status='handed_over'` rows unless `include_returned=1`, which the UI never sends: worker:4877, 4903)
7. Print (as-of date, filter, sort shown; auto-print; auto-close after print) — where: `ne-print` (850, 923-927, 708-780)
8. Bulk Return to Supplier: modal listing all entries without a return, all pre-checked, Select All / Deselect All, one supplier + one quantity applied to every item — where: `ne-bulk-return` (851, 534-627); API: POST /near-expiry/entries/create-returns-bulk (server max 100, skips already-returned: worker:5156-5230)
9. Per-row Return (supplier, quantity) → status pill "Return pending" / "Supplier refused return" / "Returned" — where: 201-207, 470-532; API: POST /near-expiry/entries/create-return (server 409 if a return already exists: worker:5102)
10. Per-row Add to Scarce Stock (hidden when expired, damaged or already linked) → quantity + batch — where: 209-215, 632-703; API: POST /scarce-stock/offers {near_expiry_id}
11. Edit (name, expiry, location, notes) — where: `data-act=edit` modal (362-433); API: PUT /near-expiry/entries/:id
12. Delete with confirm — where: `data-act=del` (435-465); API: DELETE /near-expiry/entries/:id; server clears forward links (worker:5033-5060)
13. Item count pill — where: 277-282
14. Automatic: server creates near-expiry entries from expired Scarce Stock offers (worker:11066-11090) and **deletes** a near-expiry entry when its linked scarce offer is fully requested (worker:10964-10977) — both happen without any user action in this module.

No auto-refresh; no destroy.

**Data & state.** Endpoints: GET/POST /near-expiry/entries, PUT/DELETE /near-expiry/entries/:id, POST /near-expiry/entries/create-return, POST /near-expiry/entries/create-returns-bulk, POST /scarce-stock/offers. Tables: `near_expiry_entries` (+`return_id`, `return_status`, `scarce_stock_offer_id`), `returns_entries`, `scarce_stock_offers`. No localStorage.

**Permissions & scoping.** Worker `requireRole(["admin","staff"])`, own org+location. No client-only checks.

**Edge cases & risks (found in code, cite line numbers).**
- Silent feedback: every success message goes through `E.showToast && …` (288, 351, 423, 454, 522, 589, 603, 693); `E.showToast` does not exist, so "Saved", "Deleted", "Return created", and critically "No items selected" in bulk return (589) are never shown.
- Double submissions: the Add button and Enter key are not disabled while the POST is in flight (885-908) and the server has no duplicate check (worker:4917-4962) → two identical entries. Same for "Add to Stock" (656-700): the button stays live, and the server does not reject a second offer for the same `near_expiry_id`; the UI only marks the link if the response carries `id` (681).
- Returned items vanish: once a linked return is `handed_over` the entry is excluded server-side (worker:4903) and the UI never requests `include_returned=1` (289); the "Returned" pill (205) is unreachable and there is no history view.
- Bulk Return applies a single quantity and supplier to every selected item (593-598) — quantities will be wrong for most rows and must be fixed one by one in Returns.
- Cross-module auto-delete: when another pharmacy's requests on the linked scarce-stock offer reach the offered quantity, the near-expiry entry is deleted (worker:10964-10977) even though the stock may never have been collected; deleting the request later does not restore it.
- Timezone: days-to-expire uses local midnight (68-83) while the server's expiry logic uses UTC (`toISOString`, worker:11028); near midnight an item can be "Expires today" here and already auto-closed/moved elsewhere.
- Event delegation reads `ev.target` (946-951); works only because buttons have no child elements — fragile if icons are added.
- Edit modal has no busy guard; Save can be clicked twice (390-430).
- No pagination (entire location list every load).

**Speed notes.** One GET; sort/filter client-side; table rebuilt by innerHTML string — fast. Bulk return does N sequential INSERTs server-side (worker:5168-5222) but is bounded at 100.

**Must not be lost.**
- Days-to-expire traffic light (30/90 day thresholds) and expired highlighting — inspectors look for this list.
- Return / Bulk Return hand-off with status fed back from Returns (pending / refused / returned).
- Add to Scarce Stock so sister pharmacies can use the stock before it expires.
- Shelf location and notes.
- Printable as-of-date list.
- A history of what was returned (currently lost once handed over — rebuild should keep it).

---

## Scarce Stock  (`modules.scarcestock.js`, id `scarcestock`, order 280, visible to: pharmacy role, "Inventory" group; worker requires admin|staff; **offers and needs are visible to every organisation on the platform**)
**Purpose.** Platform-wide notice board where pharmacies offer hard-to-find stock or request it, with private notes between the two parties involved.

**Functions.**
1. Tabs "Available stock" (offers) / "Request stock" (needs); the New button relabels — where: 1160-1163, 1250-1260
2. Search as you type (date, item, description, batch, expiry, org, location) — where: `ss-q` (1171, 1262-1266, 221-266)
3. View: Open only / Include closed — where: `ss-show-closed` (1175-1178, 1268-1272)
4. New offer / Edit offer (date, item, public description, batch, expiry, quantity ≥0, Open/Closed) — where: 322-415; API: POST /scarce-stock/offers, PUT /scarce-stock/offers/:id
5. New request (need) / Edit (date, item, description, needed by, quantity, Open/Closed) — where: 417-505; API: POST /scarce-stock/needs, PUT /scarce-stock/needs/:id
6. Offers table: Requests (n) expand toggle; **Request** (shown on every row including my own, 671-678); owner: Edit, Delete (confirm), Place on Transfer (not expired/closed/already), Place on Returns (even if expired) — where: 639-751; API: POST /scarce-stock/offers/:id/requests, DELETE /scarce-stock/offers/:id, POST …/place-on-transfer, POST …/place-on-returns
7. Offer-request sub-panel: Qty / Pharmacy / Note (shown as "Private" to third parties); Edit/Delete my request (confirm) — where: 753-816; API: PUT/DELETE /scarce-stock/offer-requests/:id
8. Needs table: Offers (n) toggle; Offer stock (non-owner); owner: Edit, Delete (confirm; cascades offers); flashing row when my need has unaccepted offers — where: 836-902
9. Need-offer sub-panel: status Pending/Accepted/Confirmed; **Accept** (need owner), **Confirm given** (offerer, after accept, confirm dialog; server closes the need when confirmed ≥ needed, worker:11732-11768); Edit/Delete my offer until confirmed — where: 904-1026; API: POST /scarce-stock/need-offers/:id/accept, POST …/confirm, PUT/DELETE /scarce-stock/need-offers/:id
10. Print current tab (nested requests/offers, honouring privacy) — where: `ss-print` (1183, 1280-1283, 1042-1136, 175-206); extras: popup with a Print button (no auto-print)
11. Refresh (button) and silent auto-refresh every 30 s — where: 1184, 1285-1292, 271-301; destroy stops the timer (1301)
12. Expired badge (client, local date) — where: 637-653
13. Automatic server work on every offers GET: expired own offers are closed, linked transfer items deleted/closed, a Near Expiry entry created or linked (worker:11022-11095).

**Data & state.** Endpoints as listed in the file header (5-21) plus `/place-on-returns`, `/place-on-transfer`, `/need-offers/:id/accept|confirm`. Tables: `scarce_stock_offers`, `scarce_stock_offer_requests`, `scarce_stock_needs`, `scarce_stock_need_offers`; side effects on `near_expiry_entries`, `stock_transfer_items/requests`, `returns_entries`. No localStorage. Polling: two sequential GETs every 30 s.

**Permissions & scoping.** Worker `requireRole(["admin","staff"])`. **No org filter** on either list (worker:11097-11110, 11437-11450): every pharmacy of every organisation sees every post; only the note and requester/offerer identity are restricted to the two parties (`ssCanSeeSensitive`, worker:10943-10948). Owner-only edit/delete, need-owner accept, offerer confirm are enforced server-side. The UI relies on server `mine_owner` / `mine` flags. The server does **not** stop a pharmacy requesting its own offer (worker:11343-11378 has no own-location check).

**Edge cases & risks (found in code, cite line numbers).**
- Depletion cascade on mere requests: `remaining_quantity = quantity_available − SUM(all requests)` (worker:11170) and `checkScarceStockDepletion` runs after every request create/update (worker:11374, 11408). One pharmacy requesting the full quantity immediately **deletes** the linked Near Expiry entry, the linked Returns entry and the linked Stock Transfer item (worker:10964-11005). There is no accept step on offers, no quantity cap on requests (worker:11355-11358 only checks ≥1), and deleting the request afterwards does not recreate anything. Negative remaining is displayed as-is (656).
- Delete offer confirm text (690) mentions requests but not that the linked Returns row and Stock Transfer item (and its requests from other pharmacies) are also deleted (worker:11305-11336).
- "Confirm given" rewrites `quantity_needed` to the confirmed total when fulfilled (worker:11755) — the original requested quantity is lost.
- Stale invisible filters: `state.q` and `state.showClosed` survive module switches (213-214) but `render` recreates the input empty (1171) and the select at "Open only" (1175-1178); coming back shows a filtered table with an empty search box.
- Timezone: client expired test uses local `todayYmd()` (41-44, 642, 702) while the server uses UTC `toISOString` (worker:11028, 11813); around midnight the UI offers "Place on Transfer" that the server rejects, or hides it a day early.
- Auto-refresh swallows errors (`silent`, 297) — a dead connection leaves stale data with no indication; manual refresh errors show a modal.
- Two sequential awaits (289, 292) that could be one `Promise.all`.
- Whole-platform payload: closed offers are returned too and filtered client-side (249, 261); grows without bound, downloaded by every pharmacy every 30 s.
- Edit allows quantity 0 and "Closed" without notifying pharmacies with open requests (351-359).
- `confirmYesNo` (313-320) never resolves if another modal replaces it — the awaiting handler hangs harmlessly but leaks.
- No pagination; no keyboard shortcuts.

**Speed notes.** 2 GETs per refresh with nested arrays (platform-wide); DOM built node-by-node (`el()`), heavier than innerHTML but acceptable for a few hundred rows. 30 s polling × every open tab on the platform is the main server cost of this module together with Stock Transfers.

**Must not be lost.**
- Platform-wide (all organisations) sharing of scarce items and requests.
- Privacy rule: only the two parties see notes and identities; everyone else sees quantities.
- Need → offer → accept → confirm-given workflow with automatic close.
- Expiry handling: expired offers closed and moved to Near Expiry automatically.
- Hand-offs to Stock Transfers and Returns.
- Printable board for both tabs.

---

## Supplier Inventory  (`modules.supplier-inventory.js`, id `supplier-inventory`, order 35, section "pharmacy", visible to: pharmacy role, "Sales & Clients" sidebar group; worker handlers have **no** role check)
**Purpose.** Browse every supplier's price list, build per-supplier carts with deal/margin visibility, send orders, track them to receipt, and report problems back to the supplier.

**Functions.**
1. Inventory tab: product table of all suppliers — where: 306-431; API: GET /supplier-products/inventory (global, worker:2790-2820)
2. Search (200 ms debounce; client on description/barcode/stock code/supplier) — where: `si-search` (308, 796-807, 246-258)
3. Supplier dropdown filter — where: `si-supplier-filter` (309-314, 810-817)
4. Column settings modal (hide/show; description, status, supplier always on) persisted in localStorage `eikon_si_hidden_cols` — where: ⚙ `si-btn-colsettings` (315, 88-117, 77-86)
5. Expiry warning thresholds (red / yellow months) saved to cloud per location, drive row shading — where: 317-325, 819-834, 361-374; API: GET/PUT /supplier-products/inventory-settings
6. Sortable columns (all except Deal) — where: 336-345, 837-849, 239-244
7. Margin % badge Good ≥35 / OK ≥20 / Poor with colour ramp — where: 31-41, 403-405
8. Deal display "Buy X + Y Free · Z% off"; quantity inputs snap to multiples of X — where: 353-359, 391-400, 862-866, 920-941
9. Add to cart / remove (toggle button), with Expiry Warning modal ("Add Anyway") when inside thresholds — where: 852-917
10. "+ Diary" quick-add to Order Diary (today, qty 1, pending) — where: 418, 944-953, 200-207; API: POST /order-diary/entries
11. Cart panel grouped by supplier: per-line qty edit, free qty, disc %, line cost, remove; totals cost / profit / margin; order notes; **Commit Order to <supplier>** with confirmation table; Clear Cart — where: 433-504, 955-1104; API: POST /supplier-orders
12. Cart draft auto-saved to the cloud per location (1 s debounce; DELETE when empty) and re-hydrated on load — where: 171-198, 1429-1443; API: GET/PUT/DELETE /supplier-orders/cart-draft
13. My Orders tab: status filter (All/Pending/Shipped/Received), server-side search (350 ms), sortable columns, Draft rows from the cart (Continue / Delete), View/Collapse order detail (items, barcode, qty+free, confirmed qty diff, unavailable strike-through, supplier notes, expected delivery, totals) — where: 514-727, 1185-1270, 1400-1413; API: GET /supplier-orders/sent?status&q, GET /supplier-orders/:id
14. Mark as Received (shipped orders) — where: 719-723, 1273-1284; API: PUT /supplier-orders/:id {status:"received"}; no confirm, no undo
15. Report Problem per item (Not Received / Wrong Pick / Damaged / Short Quantity / Other + notes) → then "Add to Returns?" modal — where: 609, 666-699, 1287-1373; API: POST /supplier-orders/items/:id/feedback, then POST /returns/entries (sets `damaged` for Damaged)
16. 30 s auto-refresh: orders tab (keeps expansion) or inventory table (skipped while the cart is non-empty; swaps table innerHTML and re-wires) — where: 1512-1558
17. Interval cleanup on hashchange — where: 1561-1568
18. Focus/selection preservation across full re-render — where: 734-767
19. Expiry date parsing (ISO, DD/MM/YYYY, Excel serial) for shading and warnings — where: 210-237
20. Tab switching — where: 298-304, 772-781

**Data & state.** Endpoints above. Tables: `supplier_products`, `supplier_orders`, `supplier_order_items`, `supplier_order_item_feedback`, `supplier_cart_drafts` (one row per org+location), inventory settings, `order_diary`, `returns_entries`. localStorage: `eikon_si_hidden_cols`. Polling 30 s. Toasts use `.od-toast*` CSS classes owned by the Order Diary module (50-59) — unstyled if that module's styles were never injected.

**Permissions & scoping.** Worker: no `requireRole` on inventory (worker:2790), order create (2969), cart draft (2882-2911); product list is intentionally cross-org ("visible to ALL users", worker:2795). Order update restricted to the pharmacy or supplier location of the order (worker:3165); feedback to the ordering pharmacy (worker:2929). Settings and cart draft are per location (shared by all PCs of the pharmacy).

**Edge cases & risks (found in code, cite line numbers).**
- Shared cart draft, last-writer-wins: every PC of the location saves the whole cart 1 s after any change (184-198) and `render` resets `state.cart = {}` then hydrates from the server (1498, 1429-1443). Two PCs shopping at once overwrite each other's lines; a PC that loads while the draft GET fails (swallowed, 1443) starts empty and its first click **replaces** the server draft.
- Duplicate orders: `apiCreateOrder` has no idempotency key; if the POST succeeds but the response is lost, the cart stays, the button is re-enabled (1097-1101) and a retry sends the same order again (worker:2969-3022 inserts unconditionally).
- Client-supplied prices are trusted: cost, VAT, retail, discounts are posted from the browser (1016-1037) and stored as-is (worker:2994-3010).
- Clear Cart (985-992) and Draft Delete (1221-1232) wipe a cart with no confirmation.
- Inconsistent behaviour after a background refresh: `wireInventoryTable` (1109-1183) re-binds Add-to-cart **without** the expiry-warning modal that `wireInventory` shows (873-909).
- `apiSaveExpirySettings` is fire-and-forget (829): failures become unhandled rejections; `loadOrders` failure only warns to console (1410-1412) leaving an empty table that looks like "no orders".
- Mark as Received is one click, irreversible in the UI (1273-1284).
- Feedback can be submitted twice before the detail re-fetch completes (1307-1369; server has no uniqueness, worker:2913-2960).
- `supplier_location_id` for the whole group is taken from the first item's `location_id` (290) — wrong if one supplier name spans two supplier locations.
- Hard-coded default VAT 18 (1030) when the product has none.
- Heavy inventory refresh: the entire `supplier_products` table is downloaded every 30 s per pharmacy with in-memory filtering server-side (worker:2790-2820) and the whole table re-rendered on each debounced keystroke (804).
- `querySelector` built with `supName.replace(/'/g,"\\'")` (1040) breaks on supplier names containing `]` or `"`.

**Speed notes.** Initial load = 3 sequential requests (inventory, settings, draft: 1417-1443) that could run in parallel; inventory payload is the full catalogue of all suppliers (potentially thousands of rows, no pagination); 30 s polling; full-table innerHTML rebuild per filter/sort change (~2k rows is noticeable).

**Must not be lost.**
- Per-supplier cart with deal (buy X get Y) arithmetic, margin and profit before committing — this is the buyer's control over money.
- Confirmation screen listing lines and total before an order is sent; audit row on create.
- My Orders tracking: pending → confirmed/shipped → received, confirmed-qty differences and unavailable lines.
- Report Problem → supplier feedback plus the Returns hand-off.
- Expiry warnings before buying short-dated stock (thresholds per pharmacy).
- Shared cloud cart draft across PCs (needs merge semantics in the rebuild).
- Quick add to Order Diary.

---

## Emergency POS  (`modules.emergencypos.js`, id `emergency-pos`, order 109, visible to: pharmacy role, "Operations" group; worker handlers have **no** role check — any authenticated user of the location can import/wipe the catalogue and void sales)
**Purpose.** Offline-capable fallback till: build a basket from a locally cached catalogue by search/scan/photo, take cash/card, queue the sale locally and sync to the server; import the catalogue from a spreadsheet; print a day's receipts.

**Functions.**
POS tab
1. Product grid (first 6 desktop / 8 mobile of the filtered catalogue), tap adds qty 1 — where: 2161-2170, 2303-2313
2. Search input filters the grid live; **Enter** treats the text as a barcode/GS1 string and adds the product (keyboard) — where: 2209-2239
3. Scan (camera): native `BarcodeDetector` with three pre-processed canvases (normal, inverted, inverted+B/W) at ~12 fps, falls back to ZXing from CDN; Cancel Scan — where: 972-1002, 847-947, 950-970, 2075-2088
4. GS1/FMD DataMatrix parsing: AI 01 GTIN, 17 expiry, 10 batch, 21 serial; strips symbology prefix; accepts parenthesised form — where: 93-167
5. "Product not in catalog" FMD banner — where: 2062-2072, 1211-1215
6. Photo Search: capture frame → Tesseract OCR (CDN) → token fuzzy match → top 10 with Add — where: 1046-1190
7. Cart line: − / + (±1), tap qty for fraction modal (`1/6` or decimal, live preview), × remove, **Scan/Re-scan Barcode** for this line (overrides barcode and FMD data) — where: 1981-2038, 239-313, 1218-1244
8. Lines with the same barcode merge unless FMD data is present — where: 209-231
9. Totals: subtotal, VAT extracted from VAT-inclusive prices per line, discount % (0–10), total — where: 170-185, 2017-2022
10. Payment method Cash / Card / Other; Tendered amount; Change display (red when short) — where: 2131-2141, 2040-2052, 2243-2260
11. Discount % input clamped 0–10 — where: 2142-2145, 2262-2273
12. Clear cart (confirm) — where: 2275-2289
13. Complete Sale: confirmation modal → sale object with client-generated receipt no `R-<UTC timestamp>` → **queued in localStorage first**, cart cleared → POST; on success dequeued, on failure "Offline — sale queued" — where: 432-521; API: POST /emergency-pos/sales (server dedupes on `offline_id`, worker:18151-18155)
14. Cart, payment method, tendered and discount persist in localStorage `eikon_epos_cart` across reloads — where: 322-333
15. Mobile bottom-sheet cart with badge flash and auto-expand on add — where: 2176-2191, 222-230, 2107-2110
Catalog tab
16. Import XLSX/XLS/CSV: SheetJS (0.18.5 lazy-loaded only if `window.XLSX` is absent; index.html:123 already loads 0.20.3 globally), first sheet, header auto-detection by substring (barcode/ean/gtin/code/sku/ref; name/description/product/item/desc; retail/price/sell/sale; vat/tax; category…; unit/pack/size/uom), numeric barcodes normalised, rows without a barcode get a deterministic `NOBAR-<hash>-<row>` pseudo-barcode, rows without a name dropped; chunked upload (start 250, halve to ≥50 on 503/1102, 6 retries with backoff, `wipe:true` on the first chunk) — where: 523-779, 2346-2347; API: POST /emergency-pos/catalog (server upserts by name, worker:18063-18113)
17. Catalogue search and table (first 500) — where: 2318-2344, 2370-2374
18. Clear Catalog (confirm) — where: 2349-2368; API: DELETE /emergency-pos/catalog
19. Catalogue load on open: paginated GET 2000/page → localStorage `eikon_epos_catalog`; falls back to the cache when offline — where: 356-395
Receipts tab
20. Date picker + Today — where: 2384-2385, 2411-2421; API: GET /emergency-pos/sales?date
21. Sales table (time, receipt, items, total, pay) with **Void** (reason modal) — where: 2390-2409, 2428-2458; API: DELETE /emergency-pos/sales/:id (soft void with reason, worker:18171-18182)
22. Print Receipts: builds a receipt document for all non-voided sales with Code128 SVG per item barcode, DataMatrix via bwip-js (CDN) for FMD items, day summary; renders to PNG through html2canvas (CDN) in a hidden iframe → Web Share sheet → else PNG download → else popup window with Print/Save-PDF — where: 1256-1641; extras: PNG share/download/print
Global
23. Pending-sales badge and background sync of the queue on module open — where: 408-430, 2505-2512, 1654-1660; API: POST /emergency-pos/sales/sync
24. Own toast — where: 1644-1652
25. Injects a global `<meta name=viewport … user-scalable=no>` into the whole app the first time the module renders — where: 1666-1671
26. Tab switching — where: 2490-2496, 2515-2533

**Data & state.** localStorage: `eikon_epos_cart`, `eikon_epos_pending` (offline sales queue), `eikon_epos_catalog`. Tables: `pos_products` (UNIQUE org+location+name), `pos_catalog_meta`, `pos_sales`. External CDN code: xlsx 0.18.5 (jsdelivr; superseded by the 0.20.3 global), `@zxing/library@0.19.2`, `tesseract.js@5` (floating major), `bwip-js@4` (floating major), html2canvas 1.4.1 (cdnjs). The catalogue is also read by the four Cherubino modules via `GET /emergency-pos/catalog?all_org=1&fallback_org=3&fallback_location=3` into localStorage `eikon_cherubino_catalog`.

**Permissions & scoping.** Server scopes catalogue and sales to org+location. No role check on any POS handler (worker:18008-18230); no admin gating in the UI for import, wipe or void.

**Cash handling (as requested).** Tendered and change are computed client-side (456-457, 2040-2052) and stored on the sale; a sale **can be completed with tendered < total** (no check; 452-521) — the change field is simply negative on the server. No cash-drawer total, float, Z-report or end-of-day reconciliation exists in this module (the Receipts PNG shows receipts count and grand total only, 1476-1479). Discount cap 10 % is client-only (181, 2266); the server stores whatever subtotal/VAT/total the client sends (worker:18134-18168). Receipt numbers are `R-` + UTC timestamp to the second (460): not sequential, not gap-free, and two tills can collide in the same second. Void needs no permission and the reason is optional (2432-2444).

**Edge cases & risks (found in code, cite line numbers).**
- Import never completes from the user's point of view: `uploadProducts(products, file)` is called without `await`/`.catch` (561); `state.importing` is never reset after success (644-779) so the Import button stays disabled (2324) until the module is re-rendered; the catalogue is **not reloaded** after upload (no `apiLoadCatalog()` call) so the POS keeps selling from the old list; an upload failure after retries becomes an unhandled rejection with no toast.
- Upload progress is invisible: `setProgress` targets `#eposUploadProgress` (665) but the rendered element is `#epos-import-progress` (2092-2097).
- Non-transactional wipe: the first chunk deletes the whole location catalogue (699, worker:18071-18074); a later chunk failing after six retries leaves a partial catalogue with no rollback.
- The `resp.ok === false` branch (722-758), including adaptive batch shrinking, is dead code because `apiFetch` throws on non-2xx; real failures go through `catch` (760-769) which never inspects status or shrinks the batch.
- Header auto-detection has no preview/confirm: `vat` can match a "VAT inclusive price" column (594) making `vat_rate` equal the price; `code` matches any "…code" column (591). The catalogue is wiped before the user can see the mapping result.
- VAT on discounted sales is overstated: `vatTotal` is computed from undiscounted lines and the discount is applied afterwards (170-185); `vat_total` stored on the sale is therefore wrong whenever a discount is given.
- Offline queue only syncs when the module is opened (2505-2512) — not on `online` events or a timer. Sales stay in one browser's localStorage; clearing site data loses them. Queued (unsynced) sales are **excluded** from the Receipts tab and the day print (2390, 1395 use server data only).
- `apiLoadSales` failure silently sets `state.sales = []` (397-406) so "No sales on <date>" is shown when the request failed.
- `lsSet` swallows `QuotaExceededError` (66); a large catalogue silently is not cached and the "offline" POS has nothing to sell offline.
- Catalogue search for Cherubino falls back to **organisation 3, location 3** when the caller's org has no catalogue (worker:18020-18028, requested at modules.cherubino-*.js) — cross-organisation price data exposure and a hard-coded dependency.
- Complete Sale is allowed with tendered < total (see cash handling).
- Receipt timestamps: `receipt_no` uses UTC (460) while `sale_date` and the history filter use local date (458, 2381); after 23:00 local the receipt number's date differs from the sale date.
- Void sends a body with DELETE (2437-2439); intermediaries may drop it, losing the reason silently.
- `isMobile()` treats any touch-capable PC as mobile (2109) — desktop touch screens get the phone layout.
- Global viewport injection disables pinch zoom for the entire application (1666-1671) — accessibility regression outside this module.
- Floating CDN majors (`tesseract.js@5`, `bwip-js@4`: 1005, 1342) can change under the app; every "emergency" feature except the cached catalogue and queue needs internet for its library.

**Speed notes.** Catalogue GET is paginated at 2000 but all pages are fetched on every module open and then JSON-stringified into localStorage (large catalogues: seconds). Product grid is capped at 6–8 cards so POS rendering is cheap; catalogue tab renders 500 rows. Receipt PNG generation loads two libraries and renders at scale 2 (slow on phones).

**Must not be lost.**
- Offline-first sale queue with server-side idempotency on `offline_id` — the only reason this module exists.
- FMD DataMatrix capture (GTIN, batch, expiry, serial) per line and per-line barcode override — needed for medicine traceability.
- Fractional quantities (split packs).
- Cash tendered / change, payment method, capped discount, and void-with-reason audit.
- Daily receipts export with per-item barcodes for later re-keying into the main till.
- Catalogue import from a supplier/till price list, and the cached catalogue for offline use.

---

## Cherubino Orders  (`modules.cherubino-orders.js`, id `cherubino-orders`, order 900, visible to: pharmacy role **only when `user.org_id === 12`** (core.js:775-777); worker has no org or role check)
**Purpose.** Daily per-branch order list for the Cherubino group: each branch posts what it needs for a date, sees sister branches' lists read-only, and sees warehouse status flags set by the company admin.

**Functions.**
1. Date navigation Prev / Next / Today limited to today−14 … today (client 21, 466-477, 495-505; server rejects older: worker:17463-17470, 17476, 17504) — API: GET /cherubino/orders?date&all_org=1 (233-240)
2. Refresh; auto-refresh every 5 min while this module is active — where: 478, 507-508, 728-740
3. Left panel, my pharmacy section: items with quantity, four read-only status boxes (OOS / Ordered / Avail. WSL / Pending WSL), delete ✕ — where: 374-423
4. Left panel, other locations' sections (read-only) — where: 410-421
5. Right panel "Grouped View": items ordered by ≥2 locations, grouped by name similarity ≥ 0.7 (Jaccard, fuzzy token DL, normalised DL), total and per-location quantities, any-set flags — where: 50-85, 297-321, 425-461
6. "+ Add Item" modal: description with catalogue autosuggest (typo-tolerant prefix/substring/barcode scoring, 146-221), quantity with −/+ buttons and mouse-wheel, Add — where: 538-623; catalogue from GET /emergency-pos/catalog?all_org=1&fallback_org=3&fallback_location=3 cached in localStorage `eikon_cherubino_catalog` (253-275)
7. On Add: similarity check against other locations' items → "Similar Item Found: use their name?" modal; then similarity against own items → "Possible Duplicate" modal (Yes = prevented); then save — where: 625-726; API: POST /cherubino/orders
8. Delete own item: first click arms a 4 s window, second click deletes — where: 510-524; API: DELETE /cherubino/orders/:id (server: own location only, worker:17554-17568)
9. Jaro-Winkler and bigram helpers defined (23-46, 87-122) but unused.

No print, no search, no edit of quantity/description (server PUT supports it for own location, worker:17533-17537, but no UI).

**Data & state.** Table `cherubino_orders` (org 12 rows, per date). localStorage `eikon_cherubino_catalog` (shared with Prices and OOS). Polling 5 min. Catalogue falls back to org 3 / location 3's POS catalogue.

**Permissions & scoping.** UI gate is the sidebar only (core.js:776-777); the router does not block direct navigation (core.js:1219-1226). Worker scopes by the caller's `org_id`, so a non-Cherubino user who navigates here gets a working private copy for their own org. Checkbox flags are server-restricted to `location_id` 600–900 (worker:17528-17531); delete restricted to own location (worker:17561).

**Edge cases & risks (found in code, cite line numbers).**
- Silent destructive delete: the "Click again to confirm delete" warning is `toast(...,"warn")` (517) which calls the non-existent `E.toast` (528-531). The first click appears dead, the second deletes with **no visible confirmation at all**.
- All success/failure messages (520-522, 632, 711, 720, 724) are silent for the same reason; a failed add shows nothing and the modal stays open.
- Fuzzy grouping conflates strengths: `nameSimilarity("paracetamol 500mg","paracetamol 1g")` ≈ 0.76 via the normalised-DL signal (79-84) ≥ 0.7, so the Grouped View totals and the "use this name" suggestion (655-673) can merge different products.
- Date window: client uses local dates (9-21) and the server UTC midnight (worker:17463-17470); between 00:00 and 02:00 Malta time the oldest allowed day differs and the server replies "Cannot add orders more than 2 weeks back" to a date the UI offered.
- `loadOrders` swallows errors and renders "No items ordered for this date" (236-239, 403-404) — a network failure looks like an empty day.
- A `document` click listener is added on every modal open and never removed (617-621); the closure keeps detached DOM alive.
- Catalogue cache has no expiry; the `length !== 2000` heuristic (259) forces a refetch for a legitimately 2000-item catalogue and otherwise serves stale names/prices indefinitely.
- Quantity cannot be edited after posting; only delete + re-add.
- Grouping is O(n²) DL on every render (298-321) — fine for tens of rows, visible lag at hundreds.

**Speed notes.** One GET per date change (small). First Add opens a multi-page catalogue fetch (2000/page) stored in localStorage; subsequent searches are in-memory. Full re-render per refresh.

**Must not be lost.**
- Per-branch daily list visible to every branch (read-only) for the 14-day window.
- Grouped view so the warehouse can consolidate the same item across branches.
- Warehouse status flags shown to branches.
- Catalogue-assisted entry with similar-name adoption and duplicate prevention.
- Audit rows on create/delete (worker:17512, 17566).

---

## Cherubino Price Changes  (`modules.cherubino-prices.js`, id `cherubino-prices`, order 901, visible to: org 12 pharmacy role and org 12 company-admin section; admin behaviour keyed on `location_id ≥ 600`; worker has no org or role check)
**Purpose.** Group-wide log of retail price changes with a per-branch "shelf labels checked" acknowledgement.

**Functions.**
1. List of the latest 200 price changes grouped by day — where: 287-339; API: GET /cherubino/price-changes?limit=200 and GET /cherubino/locations (pharmacy locations = id < 600) in parallel (115-133)
2. Text filter (200 ms debounce, client-side, focus restored) — where: 301-303, 357-369, 276-285
3. Per-change pills for every branch: ✓ checked (title shows who/when) or ✗; my branch's pill is clickable to mark/unmark (not for admins) — where: 230-274, 425-437; API: POST / DELETE /cherubino/price-changes/:id/check
4. "+ New Price Change": catalogue search with a "Use: <typed text> (custom item)" row, current price auto-filled read-only from the catalogue, new price → save; pharmacies then get "Have you checked the shelves?" (Yes → check) — where: 449-577; API: POST /cherubino/price-changes
5. Print Report with From/To date range: replaces the list with the filtered subset, `window.print()`, re-renders after 500 ms; print CSS hides chrome — where: 371-423, 207-218
6. Refresh; auto-refresh every 5 min — where: 297, 354, 579-590

**Data & state.** Tables `cherubino_price_changes`, `cherubino_price_checks` (unique per change+location, upsert on re-check: worker:17650-17664), `locations`. localStorage `eikon_cherubino_catalog`. No paging beyond the first 200 rows.

**Permissions & scoping.** Org-scoped on the server; any authenticated user may create a change or check. "Admin cannot check" is client-side only (232, 247-254); the server accepts a check from any location (worker:17650). Uncheck deletes only the caller's location row (worker:17668-17671).

**Edge cases & risks (found in code, cite line numbers).**
- "Current price" comes from the POS catalogue (506, 528), which this module never updates; the next change for the same product shows the stale catalogue price as "old", and custom items always show €0.00 (491) — the recorded old→new history is unreliable.
- Only the latest 200 changes are ever loaded (128); the Print date range filters that subset (389-394), so a report for an older month is silently empty or partial.
- Timezone/day grouping: `created_at` is SQLite `datetime('now')` (UTC, no `Z`); `new Date("YYYY-MM-DD HH:MM:SS")` is parsed as **local** by browsers (10-23) so displayed times are shifted by 1–2 h in Malta, while `dateKey` groups by the UTC date string (24-27, 322, 390). A change at 00:30 local on the 1st is listed and printed under the previous day.
- All toasts are silent (440-442): "Price change recorded.", validation errors (543-545) and failures never appear; the user only sees the modal close.
- No edit or delete of a change (no UI, no endpoint) — a typo is permanent.
- `loadChanges` swallows errors (132) → "No price changes recorded yet." on failure.
- Print mutates the live list DOM and restores it on a timer (420-421); if `window.print()` throws, the list is still re-rendered, but the check pills in the printout are the live clickable ones (hidden by CSS only).
- Check pill click triggers a full reload and re-render (432).

**Speed notes.** Two parallel GETs (good); renders 200 cards × number of branches pills; trivial.

**Must not be lost.**
- Per-branch acknowledgement (who, when) that shelf labels were updated — a compliance trail.
- Day-grouped history with old → new price and direction.
- Printable report by date range.
- Catalogue-assisted product naming (consistent names across branches).
- Post-save "did you check the shelves?" prompt.

---

## Cherubino Warehouse Short Expiry  (`modules.cherubino-shortexpiry.js`, id `cherubino-shortexpiry`, order 902, visible to: org 12 pharmacy and company-admin sections; upload/print UI only when `location_id ≥ 600` (client-side); worker has **no** admin/role/org check on any endpoint)
**Purpose.** The warehouse (company admin) uploads its short-dated stock list; branches claim quantities against the limited stock.

**Functions.**
1. List with server-side search (300 ms debounce) — where: 19-25, 311-320; API: GET /cherubino/short-expiry?q
2. Columns Code / Description / Batch / Expiry (red when ≤ 3 months, parsed from `YYYY/MM` assuming day 28) / WSL Stock / Ordered / Available / Your Order — where: 190-261
3. Admin: Upload File toggle → file input `.csv,.xls,.xlsx` → SheetJS (global `XLSX` from index.html:123) → keep rows whose `loc_code` contains "WSL" → map `stk_code`, `stk_desc`, `ref`, `qty` (three casings accepted) → split `ref` into batch | expiry (`SN0131|2026/06`, `25/05/2026`, `06/2026`…) → confirmation modal warning that all data **and N existing branch orders** will be wiped → upload in 500-row chunks with `wipe:true` on the first — where: 38-133, 280-288, 330-373; API: POST /cherubino/short-expiry/upload
4. Admin: Print Report (`window.print`, print CSS) — where: 272, 308, 158-167
5. Admin: per-item list of which branch ordered how many — where: 249-256
6. Branch: Order (qty 1) → quantity input (min 1, max = available + my current order, clamped client-side with a toast that never shows) debounced 300 ms → upsert; ✕ removes my order — where: 235-246, 375-417; API: POST /cherubino/short-expiry/order (server re-checks availability, worker:17772-17802), DELETE /cherubino/short-expiry/order/:itemId
7. Refresh; auto-refresh every 5 min — where: 276, 307, 428-439

**Data & state.** Tables `cherubino_short_expiry`, `cherubino_short_expiry_orders` (unique item+location, upsert). No localStorage. Expiry stored as free text in whatever format the parser produced.

**Permissions & scoping.** `S.isAdmin = location_id >= 600` decides whether the Upload/Print buttons and the "Your Order" column render (445, 270-273, 211). **The Worker does not check anything** on `/short-expiry/upload` (worker:17740-17770): any branch user who calls the endpoint can wipe the whole warehouse list and every branch's orders. Client-side-only permission — flag.

**Edge cases & risks (found in code, cite line numbers).**
- Client-side-only admin gate on a wipe-everything endpoint (445 vs worker:17740-17750).
- Non-transactional replace: `wipe` on the first chunk, then sequential chunks; on error `doUpload` stops and leaves a partial list after having deleted all orders (112-133, worker:17748-17751).
- Oversubscription race: the server computes "others' orders" then upserts without a transaction or constraint (worker:17783-17799); two branches claiming the last units at the same moment both succeed.
- Column names must be exactly `loc_code/stk_code/stk_desc/ref/qty` in one of three casings (58-65); any other header yields "No valid rows found" with no hint.
- Expiry is stored in mixed formats (`2026/06`, `2026-06`, converted `YYYY/MM`) and sorted as text server-side (81, worker:17720) — ordering by expiry is unreliable; `expiryClass` assumes `YYYY[-/]MM` (190-202).
- Typing in the search box triggers a server fetch and a full re-render that **does not restore focus** (313-319 → 294); multi-character searches lose the cursor after every 300 ms pause.
- Every order change re-renders the whole table (385, 404, 413) — the qty input the user is in is destroyed mid-edit on the next keystroke's `change`.
- All toasts silent (420-422): "Ordered.", "Limited to N", "No stock available." never appear.
- No audit on branch orders (worker:17772-17809 writes none); only the upload is audited.
- `loadItems` swallows errors → "No items uploaded yet." (24, 206).

**Speed notes.** One GET per keystroke pause (server search); upload ≤500 rows per request; trivial rendering.

**Must not be lost.**
- WSL-only import filter and the batch | expiry split from `ref`.
- Allocation of limited stock across branches with "available = stock − all orders" and a per-branch maximum.
- Admin view of who claimed what; branch edit/remove of its own claim.
- Explicit warning that a re-upload wipes existing branch orders (make it non-destructive in the rebuild).
- Expiry highlighting and print.

---

## Cherubino OOS List  (`modules.cherubino-oos.js`, id `cherubino-oos`, order 903, visible to: org 12 pharmacy and company-admin sections; admin = `location_id ≥ 600` on both client and server; worker has no org or role check)
**Purpose.** Group-wide out-of-stock list owned by the company admin, to which branches can propose additions and report items back in stock, each requiring admin approval.

**Functions.**
1. List (org-wide) with client-side text filter (200 ms, focus restored) and sort by Description / Date Added (toggle, default date desc) — where: 130-134, 214-235, 285-311, 345-367; API: GET /cherubino/oos
2. Status pills: OOS (active) / Pending Approval / Back in Stock? / Removal Requested — where: 238-242
3. "+ Add OOS Item": catalogue autosuggest with "Use: <typed>" row; on submit: exact-duplicate block → similar-item warning ("No, it's the same" / "Yes, add anyway") → catalogue-name suggestion ("use catalog name?") → save — where: 409-540; API: POST /cherubino/oos (admin → `source=admin,status=active`; branch → `source=pharmacy,status=pending`, worker:17848-17865)
4. Admin actions by status: pending → **Approve** (item becomes admin-owned, provenance cleared, worker:17878) / **Reject** (deletes); back_in_stock → **Confirm & Remove** (deletes) / **Keep OOS**; removal_requested → **Approve Removal** (deletes) / **Deny** (back to active); ✕ delete anything with the two-click pattern — where: 249-262, 370-401; API: PUT /cherubino/oos/:id {action}, DELETE /cherubino/oos/:id
5. Branch actions: active item → **Back in Stock** (status back_in_stock, awaits admin); own pending item → ✕ delete (two-click); other branches' pending → label only — where: 263-279
6. Print (`window.print`, print CSS hides toolbar and delete icons) — where: 320, 342, 201-209
7. Refresh; auto-refresh every 5 min — where: 323, 343, 542-553
8. `request_removal` action and its success message exist in the UI map and on the server (381, worker:17900-17905) but no button sends it — dead path.

**Data & state.** Table `cherubino_oos` (`source`, `source_location_id/name`, `status`). localStorage `eikon_cherubino_catalog`. Polling 5 min.

**Permissions & scoping.** Server enforces admin for approve/reject/approve_back_in_stock and branch-only for mark_back_in_stock/request_removal (worker:17874-17906); delete: admin any, branch only own pending (worker:17914-17937). UI mirrors this with `S.isAdmin` (559). No org-12 check server-side.

**Ownership / approval workflow (as requested).** Branch adds → `pharmacy/pending` → admin Approve → row rewritten to `admin/active` (reporting branch forgotten) or Reject → row deleted. Any branch may press "Back in Stock" on an active item → `back_in_stock` → admin Confirm & Remove (delete) or Keep OOS. Removal-requested state is reachable only via API. Admin can delete anything at any time; branches can delete only their own still-pending proposals.

**Edge cases & risks (found in code, cite line numbers).**
- **"Keep OOS" deletes the item.** For `back_in_stock` rows the button sends `action="reject"` (256) and the server's `reject` branch is `DELETE FROM cherubino_oos` (worker:17882-17886). The admin pressing "Keep OOS" removes the item from the list — the opposite of the label. (The `removal_requested` case correctly uses `approve`, 374-378.)
- Silent two-click delete: admins can delete any item; the "Click again to confirm removal" warning (394) never shows (`E.toast` undefined, 404), so the second click deletes without any visible confirmation.
- Approve erases provenance (`source_location_id=NULL`, worker:17878) — no record of which branch reported it except the audit table.
- `submitOos` runs `nameSimilarity` (full Damerau-Levenshtein on whole strings, 88-113) against **every catalogue product** (495-503) on the main thread — for a multi-thousand-item catalogue this freezes the modal for seconds.
- Exact duplicate check is client-side only (473); two branches adding concurrently create duplicates (server has no uniqueness, worker:17848).
- Document click listener leak per modal open (460-462).
- `created_at` UTC string parsed as local for display (9-16) — same shift as Prices.
- `loadItems` swallows errors → "No out of stock items listed." (133, 287).
- All toasts silent (404): "Added", "Approved", "Duplicate prevented" etc.

**Speed notes.** One small GET; sort/filter in memory; the catalogue similarity scan on submit is the only heavy step.

**Must not be lost.**
- Admin-owned master OOS list visible to every branch.
- Branch proposal → admin approve/reject, and back-in-stock report → admin confirmation.
- Who proposed/reported (keep provenance in the rebuild).
- Catalogue name normalisation and duplicate warnings.
- Printable list.

---

## Cherubino Admin (Cherubino Orders, warehouse side)  (`modules.cherubino-admin.js`, id `cherubino-admin`, order 10, visible to: company-admin section **when `org_id === 12`** (core.js:795-798); worker restricts flag updates to `location_id` 600–900)
**Purpose.** Warehouse view of all branches' daily orders with per-item and per-group status flags (OOS / Ordered / Available in WSL / Pending arrival in WSL).

**Functions.**
1. Date navigation Prev / Next / Today (today−14 … today), Refresh; auto-refresh every 5 min — where: 277-284, 323-338, 408-420; API: GET /cherubino/orders?date&all_org=1
2. Print Report (`window.print`; print CSS keeps checkbox glyphs) — where: 287-289, 334-336, 196-210
3. Summary card: item count, total qty, locations, counts per flag; refreshed in place after any change — where: 239-264, 394-402
4. Grouped View (items from ≥2 branches, similarity ≥ 0.7): group-level checkbox per flag (checked when all members are) → PUT for **every** member in parallel, then sync per-item boxes; revert on any failure — where: 108-172, 362-391; API: PUT /cherubino/orders/:id {field}
5. Per-branch sections with per-item checkboxes → PUT one field; optimistic, reverted on error with an error toast (silent) — where: 215-237, 297-310, 340-360

No add/edit/delete of items from this view (server allows admin PUT of description/qty but no UI; delete is own-location only, worker:17561).

**Data & state.** Table `cherubino_orders`. No localStorage. Polling 5 min.

**Permissions & scoping.** Flag updates: server allows only `location_id` 600–900 (worker:17528-17531). Reachable by direct hash from any section; a branch user would see the page but every tick reverts with a (silent) 403.

**Edge cases & risks (found in code, cite line numbers).**
- Group tick = N parallel PUTs (372); partial failure reverts only the group checkbox (387) while items that already succeeded stay changed — UI and data diverge until the next refresh.
- Fuzzy grouping can merge different products (same `nameSimilarity` as the orders module, 79-104) so one group tick flags the wrong item.
- Audit payload for flag updates is empty `{}` (worker:17548) — which flag changed, to what, is not recorded.
- 5-minute auto-refresh replaces the whole page (405 → 266-314) and loses scroll position while the admin is working down the list.
- Error toasts are silent (357, 388) — a reverted checkbox is the only sign of failure.
- `loadOrders` swallows errors → "No orders from any location" (35-38, 301).
- Same local-vs-UTC 14-day cutoff mismatch as Cherubino Orders (10-21 vs worker:17463-17470).

**Speed notes.** One GET per date; O(n²) grouping per render; one PUT per checkbox (N per group tick).

**Must not be lost.**
- Warehouse-side flags per item that branches see in their own lists.
- Consolidated multi-branch grouped view with bulk ticking.
- Daily summary counts and printable report.
- 14-day navigation.

---

# Cross-cutting notes for the Stock merge

## How a product is identified today
| Module | Identifier stored | Code / barcode? | Linked by |
|---|---|---|---|
| Stock Transfers | `item_description` free text + batch + expiry | none | row ids: `source_module`/`source_id`, `placed_on_returns_id`, `placed_on_scarce_stock_id` |
| Returns | `description` free text + batch + expiry + supplier + invoice | none | `near_expiry_id` |
| Near Expiry | `product_name` free text + expiry | none | `return_id`, `scarce_stock_offer_id` |
| Scarce Stock | `item_name` free text + batch + expiry | none | `near_expiry_id`, `transfer_item_id`, `placed_on_returns_id` |
| Supplier Inventory | `supplier_products.id` (`product_id` on order items) | barcode + supplier `stock_code` | order items keep product_id, barcode, stock_code |
| Emergency POS | `pos_products.id`, unique (org, location, **name**) | barcode EAN/GTIN or synthetic `NOBAR-…`; FMD GTIN at sale time | sales store barcode/GTIN + name, no product id |
| Cherubino Orders / Prices / OOS | free-text `description` / `product_name`, optionally copied from a POS catalogue **name** | none stored | fuzzy name similarity ≥ 0.7 at runtime |
| Cherubino Short Expiry | warehouse `stk_code` + `stk_desc` + batch + expiry text | warehouse code only | none |

Can the same product be matched across modules today? **No.** Hand-offs copy text (description, batch, expiry) and keep a row-id back-link; there is no shared product key. The only barcode-bearing data are the POS catalogue and supplier products, and nothing else references them. The server's one automatic match (expired scarce offer → existing near-expiry row) is string equality on `(product_name, expiry_date)` (worker:11069). A rebuild needs a product master (GTIN/barcode + local code + name) that every Stock record can optionally point to; the FMD parser in Emergency POS (93-167) is the only place GTIN/batch/expiry/serial are captured together.

## Cross-location flows and who approves
- **Stock Transfers** (same organisation, any location): lister = owner. Requester asks (qty + private note) → owner Accept/Reject → owner Confirm Dispatch → requester Confirm Received (closes item when fully delivered). Requester may cancel while pending; server also allows owner to delete any non-delivered request. Expired items cannot be listed or requested.
- **Scarce Stock** (every organisation): *Offers*: anyone requests any quantity, no acceptance step, remaining drops immediately and can go negative; owner edits/closes/deletes. *Needs*: any other location offers → need owner Accepts → offerer Confirms given → need auto-closes when confirmed ≥ needed. Notes and identities visible only to the two parties.
- **Cherubino**: branches post daily orders (14-day window); company admin (location 600–900) sets flags; branches claim short-expiry stock against a shared pool; OOS proposals and back-in-stock reports need admin approval; price-change acknowledgements are per branch.

## Cherubino (org 12) restrictions
- Sidebar entries exist only when `user.org_id === 12` (core.js:776-777 pharmacy; 797-798 company admin). Nothing else in the UI or the Worker checks org 12; all Cherubino endpoints scope by the caller's `org_id` and would work for any org that navigates by hash.
- "Admin" = `location_id ≥ 600` in the UI; the Worker uses `≥ 600` for OOS, `600–900` for order flags, and nothing for short-expiry upload or price checks.
- Catalogue for autosuggest is the POS catalogue with a hard-coded fallback to org 3 / location 3 (worker:18020-18028).

## XLSX / XLS import paths
1. **Emergency POS catalogue** (modules.emergencypos.js:523-779): SheetJS lazily loaded (0.18.5) only if absent — index.html:123 already loads 0.20.3 globally, so the global wins. First sheet only; header auto-detection by substring with no preview or confirmation; numeric barcodes de-scientific-notated; missing barcodes replaced by `NOBAR-<hash>-<row>`; price/VAT `parseFloat` with 0 fallback; rows without a name dropped. Validation is minimal; wipe-then-chunk upload; progress UI broken and completion state never reset (see module risks).
2. **Cherubino Warehouse Short Expiry** (modules.cherubino-shortexpiry.js:46-133): relies on the global `XLSX`; fixed header names (`loc_code`, `stk_code`, `stk_desc`, `ref`, `qty`, three casings); WSL filter; `ref` split into batch/expiry with several date shapes; confirmation modal that counts the branch orders to be wiped; 500-row chunks; stops on first error leaving partial data; no admin check on the server.
3. Supplier Inventory does **not** import; it only parses Excel serial dates that arrived through the supplier-side import (210-226).

## Emergency POS cash handling
Client-side tendered/change, no "tendered ≥ total" rule, discount cap enforced only in the browser, client-trusted totals, VAT not reduced by the discount, non-sequential timestamp receipt numbers, voids by any user with optional reason, no cash-up/Z report, offline queue synced only on module open and excluded from receipt printing. See the module section for line numbers.

## Every print / export
| Module | Trigger | Output |
|---|---|---|
| Stock Transfers | Print (1080) | popup, auto-print; current Available filter (bug on Requests tab) |
| Returns | Print (557) | popup, auto-print; month + search, checklist column |
| Near Expiry | Print (850) | popup, auto-print then auto-close; as-of date, filter, sort |
| Scarce Stock | Print (1183) | popup with Print button; offers **or** needs with nested requests/offers, privacy preserved |
| Supplier Inventory | none | — (no CSV/print of inventory, cart or orders) |
| Emergency POS | Print Receipts (2386) | PNG of all non-voided sales for the day via html2canvas → Web Share → download → popup print; Code128 per item, DataMatrix for FMD |
| Cherubino Orders | none | — |
| Cherubino Prices | Print Report (296, 371-423) | in-page `window.print()` with From/To range, limited to the loaded 200 rows |
| Cherubino Short Expiry | Print Report, admin only (272) | in-page `window.print()` |
| Cherubino OOS | Print (320) | in-page `window.print()` |
| Cherubino Admin | Print Report (288) | in-page `window.print()` with summary + grouped view + per-branch tables |
| Returns | Copy for Email (644) | clipboard text |

No module exports CSV or XLSX.
