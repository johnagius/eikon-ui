# Update-endpoint audit: which PUT/PATCH handlers blank fields they were not sent

Source audited (read-only): `scratchpad/live/cloudflare-worker/code` (21,221 lines). Line numbers below refer to that file.

**The rule.** Many update handlers in this Worker build every column from the request body
(`String(body.x || "").trim()`, `to01(body.flag)`, `body.y || "default"`) and write them all in one
`UPDATE ... SET`. They never look at the stored value. A client that sends only the fields it changed
will blank, zero or reset everything else. Some handlers reject a missing field with a 400, which is
safe; many fill it with `""`, `NULL`, `0` or a default without any error. **A new screen calling a
FULL-REPLACE endpoint must send the whole record as read, changing only what the user changed.** This
also applies to columns the screen does not show: flags, notes, JSON blobs. PARTIAL endpoints keep the
stored value for any field that is left out, so a minimal body is safe there. For MIXED endpoints, only
the listed columns need to be sent back.

Classes used:

- **FULL-REPLACE**: at least one column is written from the body with no fallback to the stored value, so it is silently blanked or reset when the field is missing. The risky columns are listed, and the default each one falls back to is in brackets. Whole-JSON-document PUTs are in this class too.
- **FULL (all required)**: every written column is validated as required, so a partial body gets a 400 and nothing is blanked. The whole record must still be sent.
- **PARTIAL**: fields that are left out keep their stored values.
- **MIXED**: partial for some columns, full-replace for others. The risky ones are listed.
- **ACTION**: a state change with no field data from the body, or a toggle or fixed value.

"Loads existing" means the handler reads the stored row before it writes. `id only` means it reads the row
only to check that it exists, and never uses the stored values as fallbacks.

## Summary

| Class | Count |
|---|---|
| FULL-REPLACE | 36 (5 of them whole-JSON-document PUTs) |
| FULL (all required) | 4 |
| PARTIAL | 19 |
| MIXED | 6 |
| ACTION | 6 |
| **Total routes** | **71** |

## Table

| Route | Handler (line) | Class | Risky columns (default written when absent) | Notes |
|---|---|---|---|---|
| PUT /su/api/orgs/:id | handleSuUpdateOrg (695) | FULL (all required) | none | Only column is `name`, required (698). Loads id only. |
| PUT /su/api/users/:id | handleSuUpdateUser (835) | PARTIAL | none | `body.x !== undefined ? ... : existing.x` (840-845). Loads `SELECT *`. |
| PUT /su/api/locations/:id | handleSuUpdateLocation (908) | PARTIAL | none | 913-914. Loads row. Side effect: moves users whose default location is this one to the new org (928). |
| PUT /appointments/doctors/:id | handleApptDoctorUpdate (14028) | FULL-REPLACE | specialty, phone, notes (""), default_fee (0) | 14043-14053. `name` required. Loads id only. |
| PUT /appointments/clinics/:id | handleApptClinicUpdate (14137) | FULL-REPLACE | locality, address, phone, notes (""), fee (0) | 14152-14163. `name` required. Loads id only. |
| PUT /appointments/schedules/:id | handleApptScheduleUpdate (14283) | PARTIAL | none | `has(k) ? ... : existing.*` (14298-14311). Loads `SELECT *`. day_of_week/date are nulled by design depending on is_one_off (14318-14319). |
| PUT /appointments/entries/:id | handleApptUpdate (14490) | PARTIAL | none | `pick(keys, existing.*)` (14506-14529). Loads `SELECT *`. |
| PUT /appointments/waitlist/:id | handleApptWaitlistUpdate (14674) | PARTIAL | none | `pick` (14690-14705). Loads `SELECT *`. |
| POST/PUT /eod, /eod/upsert, /eod/record, /endofday, /endofday/record | handleEodUpsert (4195) | FULL-REPLACE | time_of_day ("AM"), float_amount (500), x_json, epos_json, cheques_json, paid_outs_json ([]), cash_json, bov_deposit_json ({}), bov_bag_number (""), bov_contact_id (NULL), notes ("") | 4282-4305, UPDATE 4330-4349. `staff_name` required. Keyed by date. Loads `id, locked_at` only (4226). locked_at is handled partially through CASE (4346). |
| PUT /eod/contacts, /endofday/contacts | handleEodContactsBulkPut (4475) → handleEodContactsBulkSave (4446) | FULL-REPLACE (whole list) | is_active (every contact missing from the list is deactivated, 4451); phone, email ("") for listed contacts | 4455-4463. Rows are matched by display_name. |
| PUT /eod/contacts/:id | handleEodContactsUpdate (4485) | FULL-REPLACE | phone, email ("") | 4493-4498. `display_name` required. Loads id only. With `X-Eikon-Debug: 1` the handler throws a ReferenceError after the write because `entryId` is undefined (4502). |
| PUT /paid-out/entries/:id | handlePaidOutEntryUpdate (4764) | FULL-REPLACE | invoice_no, reason (""), payment_method ("cash"), cheque_no ("", and always cleared when method is not cheque) | 4784-4830. entry_date, entry_time, payee_name and fee are required. Loads 6 columns but does not use them. |
| PUT /instructions/global | handleInstructionsGlobalPut (10790) | FULL-REPLACE (document) | data_json (whole object replaced) | 10796-10812. No load. |
| PUT /instructions/daily | handleInstructionsDailyPut (10900) | FULL-REPLACE | notes (""), handover_json ([]) | 10910-10934. **If both are empty, the day row is DELETED** (10917-10923). No load. |
| PUT /scarce-stock/offer-requests/:id | handleScarceOfferRequestUpdate (11463) | FULL-REPLACE | note ("") | 11478-11487. quantity_requested required. Loads ownership columns only. |
| PUT /scarce-stock/offers/:id | handleScarceOfferUpdate (11322) | FULL-REPLACE | description, batch (""), expiry_date (NULL), is_closed (0, which reopens a closed offer) | 11337-11358. entry_date, item_name and quantity_available required. Loads ownership only. |
| PUT /scarce-stock/need-offers/:id | handleScarceNeedOfferUpdate (11744) | FULL-REPLACE | note ("") | 11759-11768. quantity_offered required. |
| PUT /scarce-stock/needs/:id | handleScarceNeedUpdate (11647) | FULL-REPLACE | description (""), needed_by (NULL), is_closed (0) | 11662-11684. entry_date, item_name and quantity_needed required. |
| PUT /stock-transfers/items/:id | handleStockTransferItemUpdate (12146) | PARTIAL | none | `!== undefined ? ... : existing.*` (12157-12162). Loads `SELECT *`. |
| PUT /temperature/devices/:id | handleTempDevicesUpdate (1623) | PARTIAL | none | 1629-1653. Loads row. Debug-header ReferenceError (`entryId`) at 1645 and 1675. |
| PUT /vaccines/stock/rows/:id | handleVaccinesStockRowUpdate (12833) | FULL-REPLACE | qty (0), batch, expiry_date ("") | 12844-12855. **No required field, so an empty body zeroes the row.** Loads id and vaccine_name only. |
| PUT /client-orders/entries/:id | handleClientOrdersEntryUpdate (3566) | PARTIAL | none | `has(k) ? body : existing` (3598-3643). Loads `SELECT *`. |
| PUT /quotations/entries/:id | handleQuotationsEntryUpdate (2207) | PARTIAL | none | 2214-2244. Loads `SELECT *`. Caveat: `String(existing.x).trim()` writes the text "null" if the stored supplier/barcode/stock_code/notes is NULL (2237-2244). |
| PUT /order-diary/entries/:id | handleOrderDiaryEntryUpdate (2353) | PARTIAL | none | 2362-2367. Loads `SELECT *`. Same "null"-string caveat for item_name/supplier/notes. |
| PUT /supplier-products/inventory-settings | handleSupplierInventorySettingsPut (2951) | FULL-REPLACE (document) | settings_json (whole body) | 2955-2958. No load. |
| PUT /supplier-products/changes/:id/seen | handleSupplierStockChangeSeen (2925) | ACTION | none | Appends location to seen_by (2931-2936). Body ignored. |
| PUT /supplier-products/entries/:id/stock-status | handleSupplierProductStockStatus (2711) | FULL-REPLACE (single column) | out_of_stock (absent means 0, "back in stock") | 2718-2722. The change also propagates to matching products (2732-2761). |
| PUT /supplier-products/entries/:id | handleSupplierProductUpdate (2656) | PARTIAL | none from body | 2663-2692. Loads `SELECT *`. supplier_name is always reset to `authUser.location_name` (2683). Same "null"-string caveat (2684-2690). |
| PUT /supplier-orders/items/:id/unavailable | handleSupplierOrderItemUnavailable (3224) | FULL-REPLACE | unavailable (0), notes ("") | 3234-3235. Loads row for ownership. |
| PUT /supplier-orders/:id/confirm | handleSupplierOrderConfirm (3175) | MIXED | status ("shipped"); for each `items[]` entry: unavailable (0), qty_confirmed (0), notes ("") | 3184, 3190-3203. supplier_notes and scheduled_delivery_date are partial (3208-3215). |
| PUT /supplier-orders/cart-draft | handleSupplierCartDraftPut (2974) | FULL-REPLACE (document) | cart_json ({}) | 2977-2982. |
| PUT /supplier-orders/feedback/:id/resolve | handleFeedbackResolve (3279) | FULL-REPLACE | supplier_notes ("") | 3286-3291. resolution_status required. |
| PUT /supplier-orders/:id | handleSupplierOrderUpdate (3240) | PARTIAL | none | One UPDATE per field that is present (3259-3274). Loads `SELECT *`. |
| PUT /client-tickets/entries/:id | handleClientTicketsEntryUpdate (3982) | PARTIAL | none | `has(k)` merge (4008-4033). Loads `SELECT *`. |
| PUT /near-expiry/entries/:id | handleNearExpiryEntryUpdate (5050) | FULL-REPLACE | location, notes ("") | 5066-5080. product_name and expiry_date required. These two cascade to the linked returns entry and scarce offer (5083-5098). Loads link ids only. |
| PUT /cleaning/entries/:id | handleCleaningEntryUpdate (5383) | FULL-REPLACE | time_out, notes ("") | 5399-5418. Other columns required. Loads id only. |
| PUT /locumregister/entries/:id | handleLocumRegisterEntryUpdate (5659) | FULL-REPLACE | time_out ("") | 5677-5695. Other columns required. Loads id only. |
| PUT /locumreceipts/receipts/:id | handleLocumReceiptUpdate (5914) | FULL-REPLACE | day_type ("normal") | 5941. Other columns required. total_fee is recomputed. Needs `X-Eikon-Edit-Pass`. Loads id only. |
| PUT /poct/state | handlePoctStatePut (10458) | MIXED | each record or patient that is sent: every column is replaced through `excluded.*` (10525-10536, 10591-10637), except created_at_iso | At the collection level it is partial: rows not sent are kept, and deletes are explicit (10714-10746). `wipe_all: true` deletes everything (10721-10728). |
| PUT /daily-register/entries/:id | handleDailyRegisterEntryUpdate (6274) | FULL (all required) | none | All 7 columns required (6300-6306). Loads id only. |
| PUT /alerts/entries/:id | handleAlertsEntryUpdate (6896) | FULL-REPLACE | batch, expiry, quantity, reason, supplier, notes (NULL); team_informed, supplier_informed, authorities_informed, return_arranged, handed_over, collection_note_received, credit_note_received (0) | 6909-6950. entry_date, alert_type, status, item_name and storage_location required. Loads id only. Debug ReferenceError at 6954. |
| PUT /returns/entries/:id | handleReturnsEntryUpdate (7124) | FULL-REPLACE (confirmed) | expiry, batch, quantity, supplier, invoice_number, remarks, location_stored (NULL); return_arranged, handed_over, collection_note_received, credit_note_received, supplier_refused, damaged (0) | 7139-7199. entry_date and description required. Loads `id, entry_date, description` only (7130). Side effects use the new flags: the linked near-expiry return_status is recomputed (7210), and handed_over closes stock-transfer items (7219-7237). |
| PUT /dda-sales/entries/:id | handleDdaSalesEntryUpdate (8220) | FULL-REPLACE | urgent (0) | 8263. Other columns required. Before validation it rewrites client_id_card on this client's other rows (8246-8256). Loads id only. |
| PUT /repeat-prescriptions/entries/:id | handleRepeatPrescriptionsEntryUpdate (6652) | FULL-REPLACE | expires_date (reset to entry_date + 6 months, 6681) | Other columns required. Loads id only. |
| PUT /dda-poyc/entries/:id | handleDdaPoycEntryUpdate (8677) | FULL (all required) | none | 8695-8713. Loads id only. |
| PUT /dda-purchases/entries/:id | handleDdaPurchasesEntryUpdate (9026) | FULL (all required) | none | 9044-9054. Loads id only. |
| PUT /dda-stocktakes/stocktakes/:id | handleDdaStockTakeUpdate (9274) | ACTION | none | `closed` true/false closes or reopens it; absent does nothing (9282-9303). Debug ReferenceError at 9306. |
| PUT /dda-stocktakes/items/:id | handleDdaStockTakeItemUpdate (9338) | FULL-REPLACE | dosage ("") | 9351-9362. item_name and qty_tablets required. |
| PUT /certificates/items/:idOrKey | handleCertificatesItemUpdate (9717) | PARTIAL (confirmed) | none | 9734-9764. Loads row. Caveat: `last_date: null` is treated as absent (9734), so to clear it send `""`. |
| PUT /creditnotes/entries/:id | handleCreditNoteUpdate (7686) | FULL-REPLACE | email, receipt_number, expiry_date (NULL), no_expiry (0) | 7693-7713. issue_date, client_name, client_surname, telephone and amount required. Loads id only. |
| PUT /client-deliveries/entries/:id | handleDeliveriesEntryUpdate (7465) | FULL-REPLACE | delivery_id, scheduled_date, scheduled_time_slot, actual_delivery_date, actual_delivery_time, phone, email, address_notes, id_doc_ref, assigned_driver, tracking_number, recipient_name, proof_of_delivery, failure_reason, ticket_ref, internal_notes (""); delivery_method ("In-house Driver"); priority (2); status ("Scheduled"); delivery_attempts (0); items, delivery_log ("[]"); signature_required, signature_obtained, contains_controlled, cold_chain_required (0) | 7481-7539. Only client_name, delivery_address and order_date are required. Loads 4 columns but does not use them. |
| PUT /loyalty/campaigns/:id | handleLoyaltyCampaignUpdate (17839) | FULL-REPLACE | type ("stamp_card"), brand, items, description, reward, discount_scope, event_name, event_offer (""), active (0, **which deactivates the campaign**), open_ended (0), start_date, end_date (NULL), stamp_target (10), points_per_unit (1), redeem_threshold (100), discount_pct (10), buy_qty (3), get_qty (1), tiers_json ([]) | 17851-17895. name required. Loads id only. |
| PUT /shifts/staff/:id | handleShiftStaffUpdate (13139) | FULL-REPLACE | designation ("other"), employment_type ("fulltime"), contracted_hours (40), email, phone, registration_number (""), patterns_json ([]), is_active (1 unless exactly 0) | 13153-13163. full_name required. Loads id only. |
| PUT /shifts/assignments/:id | handleShiftAssignmentUpdate (13224) | FULL-REPLACE | start_time ("09:00"), end_time ("18:00"), role_override, notes ("") | 13229-13234. No required field. Loads id only. |
| PUT /shifts/opening-hours | handleShiftOpeningHoursPut (13413) | FULL-REPLACE (document) | hours_json (whole body) | 13416-13420. |
| PUT /shifts/settings | handleShiftSettingsPut (13431) | FULL-REPLACE (document) | settings_json (whole body) | 13435-13438. Also re-syncs the calendar token (13441-13460). |
| PUT /board/messages/:id/pin | handleBoardMessagePin (15107) | ACTION (toggle) | none | Flips is_pinned (15112). The body is ignored, and the call is not idempotent: a retry unpins. |
| PUT /board/mentions/read | handleBoardMentionsMarkRead (15160) | ACTION | none | 15163-15169. |
| PUT /board/suggestions/:id | handleBoardSuggestionUpdate (15206) | PARTIAL | none | A SET clause is built only for fields that are present (15220-15237). |
| PUT /pharmacovigilance/state | handlePvStatePut (19032) | MIXED | each report that is sent: report_json replaced whole | Partial at the collection level: deletes are explicit (19063-19069). |
| PUT /screening/state | handleScreeningStatePut (19110) | MIXED | each campaign that is sent: campaign_json replaced whole | Same pattern (19141-19147). |
| PUT /labels/state | handleLabelsStatePut (19216) | MIXED | label_settings is **always** overwritten: templates ([]), pharmacyDetails ({}) (19256-19264); each history item's label_json replaced whole | History rows that are not sent are kept (19248-19253). |
| PUT /cherubino/orders/:id | handleCherubinoOrderUpdate (18247) | PARTIAL | none | 18269-18274. Loads `SELECT *`. |
| PUT /cherubino/oos/:id | handleOosUpdate (18600) | ACTION | none | `action` switch (18606-18652). |
| PATCH /bookings/senders/:id | handleBookings → `clean()` (19924, 19986) | PARTIAL | none | Only fields that are present go into `f` (19928-19941). smtp_host and smtp_port fall back to cur. Loads row (`mine`). |
| PATCH /bookings/waitlist/:id | handleBookings (20029) | ACTION | none | Only `status: "removed"` is accepted (20031). |
| PUT /bookings/services/:id | handleBookings (20068) | FULL-REPLACE | buffer_min (0), price_cents (0), color (""), provider_ids_json ([]), online (0), active (1), sort (0) | 20050-20070. name and durationMin required. **Does not load existing.** |
| PUT /bookings/rooms/:id | handleBookings (20121) | FULL-REPLACE | active (1, so it reactivates an inactive room) | 20114, 20122. name required. Does not load existing. |
| PUT /bookings/providers/:id | handleBookings (20159) | MIXED | kind ("pharmacist"), hours_json ({} from `bkCleanHours(undefined)`, 19780), active (1) | title and speciality are kept through `CASE WHEN ? THEN ? ELSE col END` (20161-20163), as was already known. But the comment at 20160 says "the hours screen sends only name and hours", and that call resets `kind` to pharmacist and reactivates an inactive provider. Leaving out `hours` wipes the weekly hours. Loads existing only for the room-clash check. |
| PATCH /bookings/:id | handleBookings (20251) | PARTIAL | none | Loads `SELECT *`. Requires a matching `version` (optimistic lock, 20256, 20272). notes and cancel_reason fall back to cur (20273). |
| PUT /bookings/settings | handleBookingsSettings (20636) | PARTIAL | none | Every field uses `!== undefined` or `??` against `cur` (20640-20669). Loads current settings. |

## Other findings

- **CORS does not allow PATCH.** Both preflight responses send `Access-Control-Allow-Methods: GET,POST,PUT,DELETE,OPTIONS,HEAD` (lines 100 and 121). The three PATCH routes (`/bookings/:id`, `/bookings/senders/:id`, `/bookings/waitlist/:id`) therefore fail from a cross-origin page. Only same-origin calls can use them.
- **Debug-header ReferenceError.** These handlers end with `payload.debug = { entryId: entryId }`, but `entryId` is not in scope: handleEodContactsUpdate (4502), handleTempDevicesUpdate (1645, 1675), handleAlertsEntryUpdate (6954), handleDdaStockTakeUpdate (9306), handleDdaStockTakeItemUpdate (9368) and handleCertificatesItemUpdate (9792). It throws only when `X-Eikon-Debug: 1` is sent, and only after the write has been made.
- **"null" written as text.** The PARTIAL handlers that use `String(cond ? body.x : existing.x).trim()` (quotations, order diary, supplier products) write the 4-character string `"null"` when the stored column is NULL and the field is absent.
