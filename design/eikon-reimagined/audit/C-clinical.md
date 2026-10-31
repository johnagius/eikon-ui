# Audit C — Clinical & safety modules

Scope: `ui/modules.poct.js`, `ui/modules.vaccines.js`, `ui/modules.screening.js`, `ui/modules.pharmacovigilance.js`, `ui/modules.ocps.js`, `ui/modules.pharmacycalc.js`, `ui/modules.otcmindmap.js`, `ui/modules.labels.js`. Worker (`cloudflare-worker/code`) was consulted only to learn what each endpoint does; line numbers quoted as `worker:NNNN`. All line numbers below are from the files as read on 2026-10-31.

Shared facts that apply to every section:

- Module registration (`core.js:312`) takes no role or permission metadata. Visibility is purely which sidebar category lists the id: the "Clinical" category (`core.js:342-344`) holds poct, vaccines, ocps, pharmacycalc, pharmacovigilance, screening, otcmindmap; "Operations" (`core.js:328`) holds labels. These categories are only mounted for the pharmacy role (`core.js:773-779`). Nothing in any of the eight modules checks `user.role`.
- Worker enforcement: every `/poct/state`, `/pharmacovigilance/state`, `/screening/state`, `/labels/state` and `/vaccines/*` handler calls `requireRole(authUser, ["admin","staff"])`. The `/pharmacy-calc/*` handlers (`worker:12813-12899`) have **no role check at all**, only the global bearer-token gate (`worker:15425-15426`); scoping is by `org_id + location_id` from the session.
- Five of the eight modules (POCT, screening, pharmacovigilance, labels; vaccines excepted) persist with a **whole-state GET/PUT**. The worker treats each PUT as an authoritative replace: it upserts every id in the payload and **deletes every row not in the payload** (`worker:10595-10612` POCT, `worker:18296-18307` PV, `worker:18378-18389` screening, `worker:18483-18494` labels). There is no version/etag. Two PCs at the same location with the module open will overwrite and silently delete each other's work. This is the single most important architectural fact for a rebuild.

---

## POCT  (`modules.poct.js`, id `poct`, order 370, visible to: pharmacy role via "Clinical" sidebar; worker requires admin|staff; no admin-only parts)
**Purpose.** Record point-of-care test results (BP, urine dipstick, HbA1c, blood glucose, cholesterol, weight/BMI) against a patient master keyed on Maltese ID card, with sparkline trends, print-outs and CSV/JSON export.

**Functions.**
1. Dashboard tab (totals, unique-patient count, quick search across all tests, 12 latest matches) — where: tab "Dashboard"; API: none (in-memory); extras: none. (`renderDashboard` 1242-1297)
2. Dashboard row actions Print / Edit / Delete — where: buttons in dashboard table; API: PUT /poct/state on delete; extras: print window. (1290-1292, 1298-1333)
3. Patients tab: list master patients with last-seen, per-patient sparklines (HbA1c, BG, TC, BMI, BP sys/dia dual) and duplicate-ID flag badge — where: tab "Patients"; API: none. (1514-1605)
4. Patients tab search + from/to date filter (filters records used for sparklines and matches record text) — where: inputs `pt_search`, `pt_from`, `pt_to`. (1517-1540)
5. Patient detail card: open, edit name/phone/age/address, Save Patient, Close — where: "View" button then card; API: PUT /poct/state. (1606-1712, 2766-2793)
6. Patient detail timeline table with Edit / Print / Delete per record and duplicate-warning list — where: detail card. (1645-1711)
7. Blood Pressure entry form (date/time, name, ID, phone, age, address, notes, intervention, sys, dia, pulse, arm, position); Save; Clear — where: tab "Blood Pressure"; API: PUT /poct/state (debounced). (2058-2139)
8. Urine (Combur 9) entry form with fixed semi-quantitative scales (LEU/PRO/BLD/KET/GLU: Negative/Trace/+/++/+++; NIT: Negative/Positive; URO: Normal/+/++/+++; pH 5.0–9.0 steps of 0.5) + free-text appearance; Save; Clear — where: tab "Urine"; API: PUT /poct/state. (845-856, 2140-2237)
9. HbA1c entry with live two-way % ↔ mmol/mol conversion; Save; Clear — where: tab "HbA1c"; API: PUT /poct/state. (857-894, 2238-2314)
10. Blood Glucose entry (mmol/L + timing Random/Fasting/Post-prandial); Save; Clear — where: tab "Blood Glucose". (2315-2382)
11. Cholesterol entry (TC/HDL/LDL/TG, auto TC/HDL ratio, fasting status); Save; Clear — where: tab "Cholesterol". (895-907, 2383-2474)
12. Weight/BMI entry (kg, cm, auto BMI + WHO adult category, waist); Save; Clear — where: tab "Weight / BMI". (910-936, 2475-2557)
13. Per-test saved-results table with search + date range and Print / Edit / Delete row actions (one per test type) — where: bottom of each test tab. (1713-1969, 2558-2600)
14. Edit existing record: loads into the form of its test type, keeps original id, overwrites on Save — where: "Edit" in any table; API: PUT /poct/state. (2049-2057, `loadXxxIntoForm`)
15. Delete record with modal confirm — where: "Delete" in any table; API: PUT /poct/state. (365-400)
16. All Records tab: search, test-type filter, sort (newest/oldest/name A–Z/Z–A), date range — where: tab "All Records". (1970-2037)
17. Print current filtered list (landscape table of all filtered rows) — where: "Print current list"; extras: print window. (1113-1181, 2794-2797)
18. Export CSV of current filtered list — where: "Export CSV (current list)"; extras: CSV download. (2798-2844)
19. Print single result sheet (patient block + parameter table + intervention + notes) — where: "Print" buttons; extras: print window auto-print. (1037-1112)
20. Patient-ID auto-normalisation while typing (uppercase, pad to 7 digits + letter) and auto-fill of name/phone/age/address from patient master on blur — where: every `*_pid` input. (459-469, 485-529)
21. Patient master upsert on every record save, with duplicate-ID conflict detection (same ID, different name/phone → conflict entry, master not renamed) — automatic. (237-301, 326-346)
22. Rebuild patient master from records when master is empty — automatic on render / migration. (302-325, 814-823)
23. Legacy localStorage → cloud migration prompt (keys `poct_records_v1`, `poct_patients_v1`) — automatic on load when cloud empty and local data exists; API: PUT /poct/state. (693-788)
24. One-time patient-ID normalisation migration of all records — automatic on load. (790-826)
25. Export JSON backup (records + patients) — where: `#btnExport` (button exists in code, no matching markup in POCT_HTML; dead unless markup restored); extras: JSON download. (2661-2675)
26. Import JSON backup, **replaces** all cloud data for the location — where: `#importFile` (no markup, dead); API: PUT /poct/state. (2676-2750)
27. Wipe all POCT data for location — where: `#btnWipe` (no markup, dead); API: PUT /poct/state. (2751-2765)
28. Keyboard: Ctrl/Cmd+F focuses the active section's search box — global `document` listener installed once. (2854-2866)
29. Auto side effect: on window focus, re-fill any empty date/time inputs with "now" — global `window` focus listener. (2867)
30. Auto side effect: debounced cloud save 350 ms after any change; serialises concurrent saves with a `pending` flag — automatic. (148-179)
31. Cross-module API: `window.POCT = {storageKey, loadRecords, saveRecords, printRecord}`, `window.__POCT_CLOUD` shared state, `window.POCT_nav(sectionId)` — exposed for screening. (643-655, 2869-2874)
32. Hash-based initial section (`#sec-xxx`) — automatic on render. (2845-2853)

**Data & state.** `GET /poct/state` → `{state:{records,patients}}` (all rows for org+location, no paging; `worker:10283-10331`); `PUT /poct/state` → authoritative replace into `poct_records` + `poct_patients` with per-column extraction and `record_json` (`worker:10333-10640`). In-memory singleton `window.__POCT_CLOUD` survives module switches; `cloudLoad` runs once per page life (`loaded` flag, 115). localStorage: only legacy read/remove of `poct_records_v1`, `poct_patients_v1`; `MIGRATION_KEY_V2` (47) is declared but unused. No polling. Cross-module: screening writes into `__POCT_CLOUD` and calls `window.POCT.saveRecords`.

**Permissions & scoping.** Worker: admin|staff, org+location. Client: none. Delete / wipe / import are available to any staff user. No per-record author captured in the record JSON (only `updated_by` server-side).

**Edge cases & risks (found in code, cite line numbers).**
- **Concurrency / data loss.** `cloudLoad` loads once (115) and `cloudSaveNow` PUTs the whole in-memory state (155-160); the worker deletes every record id not present (`worker:10595-10612`). PC A opens POCT at 09:00, PC B records 20 tests at 10:00, PC A saves one BP at 11:00 → B's 20 records are deleted server-side. No etag, no merge, no warning.
- **Failed save = silent in-memory divergence.** On PUT failure only a 2.4 s toast appears (167); the state stays "saved" in memory, no retry, no dirty indicator; a reload loses everything entered since the failure.
- **Conflict handling still overwrites.** When the same ID is entered with a different name/phone the master is flagged but lines 285-290 still overwrite the master's address and age with the new (possibly wrong patient's) values.
- **Delete without confirmation fallback.** If `E.modal` is unavailable the record is deleted immediately (394-399). Import (2717) and Wipe (2753) use `window.confirm`, which the code elsewhere says to avoid in sandboxed iframes.
- **Age stored as a number, not DOB** (958, 249). Ages never advance; the patient master and every historical record carry whatever was typed on the day.
- **No clinical thresholds or alerts.** No flagging for e.g. BP ≥180/120, glucose <4 or >20 mmol/L, HbA1c ≥48, TC/HDL >6; the only derived category is BMI (914-922), adult-only, with no paediatric/centile handling. Intervention is free text.
- **No input range validation.** Numeric fields accept any value ≥0 (`min="0"`); systolic < diastolic, height 1.75 (m instead of cm → BMI 24,000), pulse 0 all save silently (2116-2122, 2532-2537).
- **HbA1c conversion** (857-867) uses the correct IFCC/NGSP master equation, but mmol/mol is rounded to an integer and % to 1 dp, so the two stored values are not always mutually consistent on round-trip; which one was *measured* is not recorded.
- **Time zone.** `performedAtIso` is produced by `new Date(datetimeLocalString).toISOString()` (949-951) → UTC; display re-localises (64-83). Correct on one machine; a record entered in Malta and viewed on a UK-locale PC shows a shifted hour, and screening-injected records use a non-UTC pseudo-ISO (`"YYYY-MM-DDT00:00:00"`, screening 110) so sort order is mixed on the server (`ORDER BY performed_at_iso`).
- **Dead UI.** Export/Import/Wipe handlers are bound to ids absent from `POCT_HTML` (2661, 2676, 2751) — the markup was stripped by `removeUiAnnotations`-era edits; backup/restore is therefore unreachable in the current build.
- **Global id namespace.** The module uses `document.getElementById` with generic ids (`nav`, `toast`, `topbar`) rather than root-scoped queries; any other module leaving a `#nav` in the DOM breaks it.
- **Silent catches**: 11, 17, 136, 1046-1053, 1614, 2847; toast suppression flag `__POCT_SUPPRESS_TOASTS` (316-322) hides conflict warnings during rebuild.
- **Printed sheet** has no pharmacy name/address, no operator, no signature line, no device/lot of the test strip (1057-1106).

**Speed notes.** Initial load = 1 GET returning every record and patient for the location (unbounded; thousands of records → multi-MB). `loadRecords()`/`loadPatients()` deep-clone the whole array via JSON (111-113, 185-200) and are called many times per render (`getAllSorted` in 9 render functions, `getById` per action). `renderAll()` re-renders all 9 tables on *every keystroke* of *any* filter box (2631-2649) and on every tab switch (639). `renderPatients` recomputes 6 series per patient per render. No virtualisation; the All Records table renders every row.

**Must not be lost.**
- Patient master keyed on normalised Maltese ID with duplicate-ID conflict log (inspector will ask how you know two "0001234M" entries are the same person).
- Six test schemas exactly as stored (`results` keys `sys/dia/pulse/arm/position`, `leu/nit/uro/pro/ph/bld/ket/glu/appearance`, `pct/mmol`, `glucose/timing`, `tc/hdl/ldl/tg/ratio/fasting`, `weight/height/bmi/category/waist`) — screening and the worker column extraction depend on them.
- HbA1c % ↔ mmol/mol two-way conversion and TC/HDL auto-ratio, BMI auto-category.
- "Intervention / medication started" field on every test (the pharmacist's clinical-service evidence).
- Per-patient trend sparklines and full timeline with edit/print.
- Single-result printout and filtered-list print/CSV export.
- Patient-ID auto-fill of demographics on blur.

---

## Vaccines  (`modules.vaccines.js`, id `vaccines`, order 380, visible to: pharmacy role via "Clinical"; worker requires admin|staff; no admin-only parts)
**Purpose.** Look up travel vaccine recommendations by destination country, build and print client vaccine orders (travel and routine), and keep a simple stock list with optional batch/expiry.

**Functions.**
1. Travel tab: country search by name with scored suggestions, Enter picks best match, Clear — where: hero search box; API: none (country list extracted from map SVG). (1285-1352)
2. Interactive world puzzle map: click to select country, selected country highlighted/popped, others dimmed, HUD text — where: hero right; API: `GET ./world_hi_res_v4_palette.html` (3.5 MB static, cache-busted by `E.VERSION`). (514-796)
3. Recommended vaccines for selected country, grouped by "vaccinates for", split into "Always recommended" and "High-risk areas", each brand a checkbox + qty — where: card under hero; API: none (from catalog `travel_always` / `travel_highrisk` CSV of ISO codes). (238-250, 978-1054, 1395-1429)
4. Travel vaccines table (catalog rows with any travel flag) with live search, checkbox + qty per row, Print… (A4 / 75 mm receipt) — where: left grid card. (831-906, 1434-1450, 1576-1584)
5. Selection sync across recommendations, table and order panel without full repaint; "Clear selection" — where: all three. (282-304, 1273-1276)
6. Create order panel: client name, surname, phone, email; selected list with editable qty and remove; extra free-text vaccine with datalist suggestions + qty; Save & Print… ; Clear — where: right grid card; API: `POST /vaccines/orders` then `GET /vaccines/orders`; extras: print A4 or receipt. (1453-1565)
7. Client orders table (date, client, phone, section, country, item count with tooltip) with search and Refresh, Print… per order — where: bottom of Travel and Routine tabs; API: `GET /vaccines/orders` (server LIMIT 200). (1151-1257)
8. Routine & Other tab: catalog rows that are non-travel or routine, live search, Print…, same order workflow with `section:"other"` — where: tab; API: `POST /vaccines/orders`. (1590-1751)
9. Stock tab: list rows (vaccine, qty, batch, expiry) with search; Add/adjust row (name, qty, batch, expiry free text); per-row inline Update (qty/batch/expiry); Refresh — where: tab; API: `GET/POST /vaccines/stock/rows`, `PUT /vaccines/stock/rows/:id`. (1756-1888)
10. Database tab: catalog table (name, vaccinates for, schedule, routine, travel-always codes, travel-highrisk codes), search, Print…, Add vaccine (name only), Refresh — where: tab; API: `GET/POST /vaccines/catalog`. (1893-1987)
11. Print size chooser modal (A4 vs Receipt 75 mm) with receipt page height auto-measured and injected as `@page size` — where: every Print…; extras: print window. (397-462)
12. Automatic side effect: server decrements stock for each ordered item from the earliest-expiry row, creating a row with negative qty if none exists — automatic on order save; UI does not surface it. (`worker:12536-12583`, `12652-12660`)
13. Initial load of catalog, stock and orders (sequential) — automatic on render. (1989-1996)

**Data & state.** D1 tables `vaccines_catalog` (global org 0 rows + org/location rows), `vaccines_orders`, `vaccines_order_items`, `vaccines_stock` (`worker:12350-12424`). No localStorage. No polling. Module-local state `S` is recreated on every render (no cross-render persistence of selections). Country list comes from `data-iso`/`data-name` attributes of the SVG, not from the catalog; the clinical mapping country→vaccine lives in catalog CSV columns which the UI cannot edit.

**Permissions & scoping.** Worker admin|staff on every route; orders and stock scoped org+location; catalog read includes global rows. Client: none. Anyone who can order can also set any stock quantity.

**Edge cases & risks (found in code, cite line numbers).**
- **No per-patient vaccination record.** The module records *orders* (client + items) but never the administration: no batch/lot against the client, no expiry, no site/route, no administering pharmacist, no consent, no adverse-event link, no next-dose date. Stock batch/expiry (1784-1787, 1852-1859) are optional free text, so even indirectly the batch a client received cannot be traced. For a vaccination service this is the primary legal record and it does not exist.
- **Expiry is unvalidated text** ("YYYY-MM-DD optional", 1787) with no expiry alert, no FEFO display, no block on expired stock; the server picks the lexicographically earliest `expiry_date` for decrement, so "12/2026" sorts before "2025-01-01".
- **Negative stock allowed by design** (1761, `worker:12567`) and the automatic decrement on order (`worker:12652-12660`) is swallowed on error ("Ignore stock errors") — stock can drift without anyone seeing it; the Stock tab is not refreshed after an order (1536 refreshes orders only).
- **Client details leak between orders.** `S.clientTravel` is shared by the Travel and Routine panels (1458-1465, 1636-1643) and is **not cleared after Save** (1553-1555, 1720-1722) → the next order can be saved under the previous client's name/phone if staff only re-tick vaccines.
- **Blank qty = 0.** `toInt(q.value, 0)` on Update (1869) and on Save stock row (1798): an accidentally emptied field writes 0 to stock, no confirm.
- **Orders cannot be edited or deleted; catalog cannot be edited or deleted** (1898: "No edit/delete"). A mistaken order remains forever and has already decremented stock; an added catalog name with a typo is permanent and shows under Routine & Other as "Not routine".
- **Reference data currency unknown.** Travel recommendations are CSV ISO-code lists in `travel_always` / `travel_highrisk` (225-250); there is no source, version, review date or UI to maintain them; "No travel recommendations in database for this country code" (1420) is the only hint of gaps. A country that is in the SVG but absent from every CSV silently shows nothing.
- **Orders list is capped at 200 server-side** (`worker:12526`) and the UI ignores the `month` parameter → older orders are invisible and the client-side search (1174-1193) only searches those 200.
- **Print after save**: `saved.created_at` is undefined (worker returns `order.created_at`), so the printed receipt shows client-side `nowIso()` (1540) — UTC ISO string, not local, not formatted.
- **Name matching is case-insensitive client-side (271) but case-sensitive server-side (`worker:12618`)**: "Typhim" and "typhim" merge in the UI, but create two stock rows on the server.
- **Map dependency**: if `world_hi_res_v4_palette.html` fails to load, country search has no list at all (`mapCountryIndex` empty, 1310) — the fallback error text is developer-facing (677).
- **Repaint on every keystroke** of five different search boxes rebuilds the whole tab (1170, 1448, 1617, 1773, 1932) including re-attaching the map element.
- Silent catches: 409, 531, 643, 783, 1386, 1536, 1703.

**Speed notes.** First render: 3.5 MB map HTML (once per page life) + 3 sequential JSON fetches (1991-1993; could be parallel) + DOMParser + `getBBox` for every country in a rAF. Catalog is likely a few hundred rows; each keystroke re-renders the whole table and the datalist of all brands (1488-1494). Orders payload ≤ 200 orders with items.

**Must not be lost.**
- Country → "always" / "high-risk" recommendation lists keyed by ISO-2 code, grouped by disease with brand options.
- Client order with items/qty, section (travel/other), country, printed as A4 or 75 mm receipt; order history searchable.
- Catalog columns `brand_name, vaccinates_for, dosing_schedule, routine_in_malta, travel_always, travel_highrisk` (the only vaccine reference data in the system).
- Stock rows with batch and expiry (the only place batch numbers exist today).
- Server-side audit entries `VAX_ORDER_CREATE`, `VAX_STOCK_*`, `VAX_CATALOG_ADD`.

---

## Screening Campaigns  (`modules.screening.js`, id `screening`, order 70, visible to: pharmacy role via "Clinical"; worker requires admin|staff; no admin-only parts)
**Purpose.** Plan health-screening campaigns, register participants with POCT-style results, categorise results, record referrals and track follow-ups, pushing each participant into the POCT patient master and record list.

**Functions.**
1. Hero KPIs (campaigns, active now, screened, abnormal, referrals, overdue follow-ups) — automatic on redraw. (700-730)
2. Campaigns tab: card grid sorted by start date desc, search on Enter, status badge derived from dates, goal progress bar — where: tab. (767-901)
3. New Campaign / Edit Campaign modal (name, type from 11 fixed types, status Active/Cancelled, location from 11 fixed venues, target screenings, start/end date, notes) — where: "+ New Campaign", "Edit"; API: PUT /screening/state. (1408-1461)
4. Duplicate campaign (copy without participants) — where: card and detail action bar. (866-880, 953-967)
5. Delete campaign with custom confirm modal — where: card "Delete"; API: PUT /screening/state. (882-894, 582-591)
6. Campaign detail: hero stats, notes, participants table (ID card, name/phone, type, date, POCT summary column when campaign type maps to a POCT test, result notes, category badge, referral, follow-up count), Edit / Follow-up / Del per row — where: "View Details" or card click. (904-1068)
7. Add / Edit Participant modal: ID card (auto-uppercase, auto-pad, autosuggest from POCT patient master with name, auto-fill name/phone on blur or pick), name, phone, DOB, type (Pre-registered/Walk-in), screening date, **POCT result fields per campaign type** (BP, HbA1c, BG, cholesterol, BMI with auto-BMI/category, urine), result notes, result category (Normal/Borderline/Abnormal/Requires urgent attention), referral (8 options), referral notes — where: "+ Add Participant" / "Edit"; API: PUT /screening/state and indirectly PUT /poct/state. (1464-1672)
8. Automatic push of participant into POCT (`window.__POCT_CLOUD`): upsert patient master, insert/replace a POCT record tagged `source:"screening"`, trigger `window.POCT.saveRecords` after 400 ms — automatic on participant save. (64-152)
9. Remove participant (confirm) — where: "Del". (1046-1059)
10. Schedule / Edit Follow-up modal (scheduled date required, status Pending/Scheduled/Completed/No-show/Cancelled, reason, notes), Delete follow-up — where: "Follow-up" button, follow-up table "Edit"; API: PUT /screening/state. (1675-1731)
11. Campaign follow-ups table with overdue badge (scheduled date < today and not completed/cancelled) — where: detail page. (1070-1116)
12. All Participants tab: cross-campaign table, search on Enter (ID, name, campaign, referral), row click opens campaign — where: tab. (1120-1178)
13. Follow-ups tab: filter chips All / Overdue(n) / each status, sorted by scheduled date, row click opens campaign — where: tab. (1181-1247)
14. Summary tab: overall KPIs incl. abnormal and referral rates, per-campaign breakdown, referral breakdown with bars, result-category breakdown with bars — where: tab; extras: none (no print/export). (1250-1405)
15. Cross-module patient-name memory `E._eikon_patients` (name → name) built from participants — automatic. (165-175, 1608-1610)
16. Autocomplete widget with keyboard navigation (↑ ↓ Enter Esc) — where: ID card field. (594-644)

**Data & state.** `GET/PUT /screening/state` → D1 `screening_campaigns` one JSON row per campaign; authoritative replace with delete of missing ids (`worker:18343-18391`). Module-level `campaigns` array reloaded on every render. Writes into `window.__POCT_CLOUD.patients/records` and schedules `window.POCT.saveRecords` (147-150). No localStorage. No polling.

**Permissions & scoping.** Worker admin|staff, org+location. Client: none. Anyone can delete campaigns with all participants.

**Edge cases & risks (found in code, cite line numbers).**
- **Dropped saves.** `cloudSave` returns immediately if a previous PUT is in flight (228) and `save()` never retries (235). Two quick edits (e.g. add participant, then immediately schedule follow-up) → the second change is not persisted until some later unrelated save; a reload loses it. Combined with whole-state replace this is a data-loss path on every busy screening day.
- **Whole-state replace across PCs** (see shared note): a second laptop at a health fair deletes the first laptop's participants on its next save.
- **POCT sync is conditional and one-way.** `pushToPoctCloud` silently does nothing if POCT has not been opened in this browser session (`cloud.loaded` false, 66) — the "(syncs to POCT records)" label (1478) is then untrue. When it does run it mutates POCT's in-memory state directly and relies on `window.POCT.saveRecords` existing (147). Deleting or editing a participant never removes/updates the POCT record except by the `campaignId+patientId` dedupe (130-141); participants **without an ID card get a new POCT record on every edit** because the dedupe requires `pid` (133).
- **Schema drift between screening and POCT.** Option lists differ: position "Lying" vs POCT "Supine" (282 / poct 39), BG timing "Post-meal (1h)/(2h)" vs "Post-prandial" (296), urobilinogen "1+…4+" vs "+…+++" (325), glucose has "++++" (330), appearance is a select vs free text (331), BMI categories "Obese I" vs "Obesity Class I (30–34.9)" (1538 / poct 919), cholesterol fasting "Yes/No" vs "Fasting/Non-fasting/Unknown" (307), pH is a free number vs POCT's fixed list (327). POCT trend/summary code and the worker's typed columns receive inconsistent values.
- **HbA1c mmol/mol not derived** here (288-289): % is required, mmol optional and free — the same patient gets different stored pairs depending on which module recorded the test.
- **Age frozen** at push time (`calculateAge`, 83/116) and DOB itself is not sent to POCT.
- **No automatic result categorisation**: `resultCategory` is a manual dropdown (1513) independent of the numeric results; a 220/130 BP can be saved as "Normal". No consent capture field for a screening event (GDPR/clinical governance).
- **ID optional**: a participant may be saved with name only (1553); POCT patient master then gets nothing, and PII (name, phone, DOB, results) lives only in the campaign JSON blob.
- **Deletes are unaudited client-side**; server writes one `SCREENING_STATE_PUT` audit row with a count only (`worker:18393`).
- **Date logic**: `getCampaignStatus` compares `YYYY-MM-DD` strings with local `todayStr()` (551-557) — fine; `isOverdue` same (671-675). Follow-up dates have no past-date validation.
- **Unreachable style branch**: `pct > 100 ? "over"` can never be true after `Math.min(...,100)` (830-831).
- Silent catches: 1606 (`/* POCT not loaded yet, ok */`), 224, 231 (warn only).

**Speed notes.** 1 GET of all campaigns (each with embedded participants and follow-ups) per render; the whole payload is re-PUT on every edit. `redraw()` rebuilds the entire page (hero, KPIs, tabs, content) and recomputes `getAllFollowUps()` twice per draw (716, 1287). Search boxes only apply on Enter, so no keystroke cost. Fine up to a few thousand participants; the single-blob PUT grows with every participant.

**Must not be lost.**
- Campaign → participant → follow-up hierarchy with referral outcome and overdue tracking (the clinical-governance trail for a screening service).
- Per-campaign-type structured POCT results and the push into the POCT patient record (one patient history across modules).
- Result category + referral breakdown summary (what the health authority / sponsor asks for after a campaign).
- Walk-in vs pre-registered participant type and target-vs-actual progress.
- ID-card autosuggest from the POCT master (prevents duplicate patients).

---

## Pharmacovigilance  (`modules.pharmacovigilance.js`, id `pharmacovigilance`, order 410, visible to: pharmacy role via "Clinical"; worker requires admin|staff; no admin-only parts)
**Purpose.** Capture suspected adverse drug reaction reports in a five-step wizard (patient, drugs, reaction, reporter, review), list them with status, and print/"PDF" an ICSR-style sheet.

**Functions.**
1. Hero KPIs: total, drafts, submitted, serious — automatic. (252-266)
2. All Reports tab: table (date, patient initials/sex/age, drugs, MedDRA or description, seriousness tag, status tag), live search, "+ New Report" — where: tab. (289-360)
3. Edit report (loads JSON copy into wizard) — where: row "Edit". (362-371)
4. Delete report (`window.confirm`) — where: row "Del"; API: PUT /pharmacovigilance/state. (373-379)
5. Print report (new window, auto `print()` after 400 ms) — where: row "Print"; extras: print. (449-459)
6. "PDF" export (same HTML with a "Save as PDF" button; browser print dialog) — where: row "PDF". (461-472)
7. Wizard step bar, clickable steps, Back / Next / Cancel / Save Report; field values collected from DOM on every step change — where: "New Report" tab. (475-518, 749-754)
8. Step 1 Patient: initials, age, sex, weight, height, DOB day + month (year derived from age), patient ID, medical history — where: wizard. (526-546)
9. Step 2 Suspected drugs: repeatable drug cards (name, dose, route, frequency, start, stop, indication, batch no., MAH), Add Drug, Remove — where: wizard. (547-551, 686-746)
10. Step 3 Reaction: MedDRA PT autocomplete over an embedded list of ~140 terms (starts-with then contains, keyboard nav), seriousness (7 options), outcome (6), description, start/stop dates, WHO-UMC causality (6), report type (Initial/Follow-up/Final), status (Draft / Submitted to MPA / Submitted to EMA / Closed) — where: wizard. (552-568, 601-664)
11. Step 4 Reporter: name, qualification, email, phone, institution (prefilled with `location_name`), address, report date (today), notes — where: wizard. (569-580, 214-237)
12. Step 5 Review: read-only blocks + drug table — where: wizard. (757-808)
13. Save with minimal validation (initials or age; ≥1 drug name; description or MedDRA term) — where: "Save Report"; API: PUT /pharmacovigilance/state. (811-833)

**Data & state.** `GET/PUT /pharmacovigilance/state` → D1 `pv_reports`, one JSON row per report, authoritative replace with delete of missing ids (`worker:18261-18309`). Module-level `reports` reloaded on render; `formData` module-level. No localStorage, no polling, no cross-module calls.

**Permissions & scoping.** Worker admin|staff, org+location. Client: none. Any staff can delete a report already marked "Submitted to EMA".

**Edge cases & risks (found in code, cite line numbers).**
- **Nothing is submitted anywhere.** Status "Submitted to MPA / EMA (EudraVigilance)" (82) is a manually chosen label; there is no E2B(R3) XML, no e-mail, no MPA form mapping, no submission timestamp, no acknowledgement number. The hero text "EU/Malta MPA Compliant" (260) is not backed by code. Must be clearly re-specified in a rebuild.
- **Direct identifier stored against privacy guidance.** The patient step asks for "Patient ID – ID / passport" (544) alongside the hint "Use initials only – no full names for privacy" (529); the ID is stored in the report JSON and in D1 for the whole org location and is not printed. ICSR practice is no direct identifiers.
- **DOB year drifts.** `fmtDob` derives birth year from *current* date minus stored age (30-46); the same report printed next year shows a different DOB year. Age at reaction onset should be stored with a reference date, or DOB captured.
- **"Fatal" not counted as serious.** KPI and tag colouring test `indexOf("Serious") === 0` (255, 335); the "Fatal" seriousness value (78) is excluded from the serious count and tagged with the "warn" style, not the serious style.
- **Seriousness is single-select** (78, 560); regulatory forms allow multiple criteria (e.g. hospitalisation + life-threatening). No dechallenge/rechallenge, no "action taken with drug", no suspect-vs-concomitant flag per drug, no reporter consent to be contacted, no patient age unit (months for infants).
- **MedDRA list is a hard-coded, unversioned subset** (85-113); free text is accepted when no match; no MedDRA version, no LLT/PT codes, so coded submission is impossible later.
- **No lock after submission**; editing a "Submitted" report overwrites it in place with no version history and `report_type: Follow-up` is a dropdown with no link to the initial report id.
- **Dropped saves** as in screening: in-flight PUT causes the next `save()` to be skipped (67-73).
- **Whole-state replace across PCs** deletes reports (shared note).
- **`window.confirm` for delete** (374) — permanent, and inconsistent with the sandbox-safe modal used by the sibling modules.
- **No author captured**: `reporter_name` is free text; the logged-in user id is not stored in the JSON (only server `updated_by`); `created_at` is set at form open, not at save (217).
- Print opens with `document.write` and auto-prints; popup block → toast only (453).
- Silent catches: 64, 71 (warn).

**Speed notes.** 1 GET of all reports (each a full JSON blob) per render; whole set re-PUT per save. `renderApp` rebuilds the hero and the active view on every tab click; `fillTable` re-sorts and re-renders the whole table on every search keystroke. Small data volume in practice.

**Must not be lost.**
- The complete ICSR field set already captured: patient (initials, age, sex, weight, height, DOB d/m, history), multiple suspected drugs with batch number and MAH, reaction with MedDRA term, seriousness, outcome, WHO-UMC causality, dates, reporter block, report type/status/date.
- Printable report in regulator-style A–E sections (used as the covering document when reporting to MPA).
- Draft / submitted / closed lifecycle and the serious-case KPI.
- MedDRA-term assisted entry (even if the list must be replaced by a licensed, versioned source).

---

## OCP Finder  (`modules.ocps.js`, id `ocps`, order 390, visible to: pharmacy role via "Clinical"; no API; no admin-only parts)
**Purpose.** Filter a hard-coded list of 21 oral contraceptives by oestrogen/progestogen type and dose (mg or mcg) and print the matching list.

**Functions.**
1. Oestrogen type select (Any / Estetrol / Estradiol / Estradiol valerate / Ethinylestradiol) — where: filter card. (449)
2. Oestrogen dose number input with mg/mcg toggle — where: filter card. (456-463, 318-330)
3. Progestogen type select (9 types) — where: filter card. (480)
4. Progestogen dose input with mg/mcg toggle — where: filter card. (487-494)
5. Search: exact type match (case-insensitive) and dose match within ±1.5 % after unit conversion; multiphasic product (Qlaira) bypasses dose filters — where: "Search" button only (no live filtering); API: none. (111-154)
6. Reset all filters and results — where: "Reset". (504-521)
7. Results grid of pill cards (trade name, multiphasic badge, oestrogen name/dose, progestogen name/dose; progestogen-only shown as "None") with auto mg/mcg display — where: results area. (157-238)
8. Print results (table with criteria chips, generated timestamp, "For professional use only" footer; blob URL in new tab, auto `print()`; 900 ms debounce) — where: "Print Results"; extras: print. (242-305)
9. Empty-state and no-match messages — automatic. (162-176)

**Data & state.** `OCP_DATA` constant (19-41), all doses in mg; `ESTROGENS`/`PROGESTOGENS` derived (44-45). Module-level `state` persists across renders within the page life. No API, no storage, no cross-module calls.

**Permissions & scoping.** None needed (reference only). Not org-specific although the list is Malta-market specific.

**Edge cases & risks (found in code, cite line numbers).**
- **Reference data is code.** 21 products, no source, no "last reviewed" date, no way to add/retire a product without a deploy (19-41). Brand availability in Malta changes; discontinued products will keep being suggested and new ones (e.g. drospirenone-only POP, norethisterone POP, estradiol/dienogest generics, newer EE/levonorgestrel brands) are absent.
- **Regimen is not represented.** Yaz (24/4) and Yasminelle (21/7) are stored as identical hormone content (38-39); Qlaira's four-phase schedule is a string "1–3"/"2–3" (34). A pharmacist substituting by "same hormones" from this list could change the regimen. Pack regimen/phasing is a clinical attribute that must be added.
- **Unit default invites a 1000× error.** Both unit toggles default to **mg** (101, 104) while the oestrogen placeholder says "e.g. 30" (456); typing 30 with mg selected searches for 30 mg EE and returns nothing — not dangerous on its own, but the printed criteria will say "Estrogen dose: 30 mg" (263) and the tool trains users that the oestrogen field is in mg. Default should be mcg for EE.
- **Tolerance mismatch**: comment says ±1 % (74), code uses 1.5 % (78). At 1.5 % 0.02 mg and 0.0203 mg match (irrelevant today, but 0.015 vs 0.02 do not). Document the rule.
- **Multiphasic bypass** (131-137, 144-148): any dose entry for "Estradiol valerate" or "Dienogest" returns Qlaira regardless of value.
- Drovelis estetrol is listed as 14.2 mg (26) — correct for estetrol base (15 mg monohydrate); worth a data note because labels say 15 mg and a dose search for 15 fails.
- `dosageLabel` (82-88) is dead code; `autoDisplayDose` (91-95) prints e.g. "35.0 mcg".
- Print uses `a.click()` on a blob URL; if blocked, silent (299-303).

**Speed notes.** Trivial: 21 rows, no network. Styles injected once.

**Must not be lost.**
- Type + dose filtering in both mg and mcg with tolerance (the actual pharmacist use case: "which pill has 20 mcg EE and 150 mcg desogestrel?").
- Progestogen-only pills shown explicitly as oestrogen-free.
- Multiphasic flag and visible warning badge.
- Printable result list with the search criteria stated.
- The 21-item dataset itself as a seed, but moved to editable, versioned data with regimen/pack size fields.

---

## Pharmacy Calculators  (`modules.pharmacycalc.js`, id `pharmacycalc`, order 400, visible to: pharmacy role via "Clinical"; worker has **no role check**, auth only; no admin-only parts)
**Purpose.** Produce patient-specific dosing/dispensing plans for levothyroxine alternate-day dosing, prednisolone/prednisone tapers, warfarin variable dosing, insulin supply and weekly methotrexate, print them with pharmacy/patient headers and save them as records.

**Functions.**
1. Patient header card: pharmacy name from `E.state.user.location_name`, start date (today), patient name with autosuggest from saved patients, ID card with autosuggest and Maltese-ID padding on blur, printout note — where: top of Calculators view; API: `GET /pharmacy-calc/patients`. (340-461, 137-145)
2. Calculator tab bar: Levothyroxine / Prednisolone / Warfarin / Insulin / Methotrexate (panels built lazily, state kept while switching) — where: tab bar. (1898-1953)
3. Levothyroxine: weeks, pattern mode (single / alternating 2 / alternating 3), doses 1–3 (mcg), splitting (none/halves/quarters), per-weekday dose assignment grid with mode defaults, pack sizes per strength (defaults 25/50/100 → 28, 75 → 90) + default box, Calculate, Save & Print, Clear — where: tab; API: `POST /pharmacy-calc/records`; extras: A4 print with full daily plan. (522-825)
4. Prednisolone/Prednisone taper: drug name, max tabs/day (1–50), editable step rows (dose mg/day, days, note) with Add Step / Reset to Example / remove, strengths list, splitting (default halves), stock policy (optimise / 5 mg only / 20+5 only), tabs per box, round to boxes, Calculate, Save & Print, Clear — where: tab; extras: print. (828-1012)
5. Warfarin variable dosing: weeks, weekly Mon–Sun mg grid or repeating cycle list, splitting, strengths (default 1,3,5), max tabs/dose (1–30), per-strength blister packaging table (tabs/sheet, sheets/box) with Refresh Pack Table, on-screen safety banner, Calculate, Save & Print, Clear — where: tab; extras: print with safety note and patient-sentence instructions. (1015-1241)
6. Insulin supply: weeks, four daily doses (units), pen/vial with units per container and containers per box, round to boxes, priming units per injection, discard-after-days rule simulated day by day, Calculate, Save & Print, Clear — where: tab; extras: print. (1244-1423)
7. Methotrexate weekly: weeks, weekly dose mg, day of week, tablet strength, halves/quarters (default **no**), tabs per box, rounding, prominent "ONCE WEEKLY ONLY – NOT DAILY" banner on screen and on print, Calculate, Save & Print, Clear — where: tab; extras: print. (1426-1563)
8. Exact tablet-combination solver (DFS over whole/half/quarter pieces, scored by fewest physical tablets → fewest strengths → fewest splits) shared by lev/pred/war — automatic. (236-328)
9. Save & Print: validates patient name + ID, `POST /pharmacy-calc/records` with `calc_data_json` (full model), then prints; prints even if save fails — where: each tab. (482-511)
10. Saved Records view: table (saved at, patient, ID, calculator, start date, Delete), row click → detail panel with calculator-specific summary tables and Reprint — where: "Saved Records" button; API: `GET /pharmacy-calc/records?include_json=1` (param ignored server-side, LIMIT 200), `GET /pharmacy-calc/records/:id` per detail, `DELETE /pharmacy-calc/records/:id`. (1682-1873)
11. Reprint from saved JSON for all five types — where: detail "Reprint"; extras: print. (1567-1680)
12. Delete record with modal confirm — where: records table; API: DELETE. (1841-1854)
13. Print tab (blob URL, auto-print on load, auto-close after print, 900 ms debounce) — automatic. (91-106, 331-337)

**Data & state.** D1 `pharmacy_calc_patients` (unique org+loc+id_card; name overwritten on each save, `worker:12850-12858`) and `pharmacy_calc_records` (`calc_data_json` blob, `created_by`). Module-level `state.lastModels` per calculator and `state.patients`. No localStorage, no polling, no cross-module calls. Dates in the saved model are serialised as UTC ISO strings by `JSON.stringify`.

**Permissions & scoping.** Worker: **no `requireRole`** on any `/pharmacy-calc/*` route (`worker:16392-16410`, handlers `12813-12899`); any authenticated session can list, read, create and delete records of its own org+location. No audit entries written for create/delete (no `writeAudit` in these handlers). Client: none.

**Edge cases & risks (found in code, cite line numbers).**
- **Save & Print can print a stale plan.** `doSaveAndPrint` uses `state.lastModels[type]` if present and only recalculates when none exists (482-484). Change the dose after Calculate, click Save & Print → the *previous* model is saved and printed while the screen shows new inputs. On a warfarin or methotrexate plan this is a direct dosing-error path.
- **Warfarin Clear button throws.** `preferSel` is referenced but never defined (1232) → `ReferenceError` after resetting only some fields; the day grid, result box and `state.lastModels.war` are left as they were (1233-1237), compounding the stale-model issue above.
- **Solver can hang the tab.** `findBestComboExact` is an exhaustive DFS (277-301) bounded only by `maxPieces` (up to 50 for prednisolone, 921) and `sum > target` pruning. A long strengths list with quarters and a large daily dose explores millions of combinations synchronously — no time cap, no worker thread.
- **No clinical plausibility limits.** Levothyroxine accepts any mcg (667), warfarin any mg per day (1035), methotrexate any weekly dose and any day (1430), insulin any units; there are no warnings for e.g. methotrexate >25 mg/week, warfarin >15 mg/day, or a prednisolone step that *increases*. The methotrexate banner is the only hard safety feature.
- **Market strengths are hard-coded**: levothyroxine 25/50/75/100 only (520) and pack sizes (615); other strengths on the Maltese market (12.5, 88, 112, 125, 137…) cannot be entered; a prescribed 112 mcg returns "Cannot represent".
- **Warfarin printout omits tablet colour** (1216-1224); colour is the standard patient safety cue for 1/3/5 mg.
- **Time zone on reprint.** Schedule dates are stored as UTC ISO (local midnight → e.g. `T23:00:00Z`); reprinting on a device in a different zone shifts every date by a day (1580, 1612).
- **Patient master overwritten silently**: a typo in the name on a later save replaces the stored name for that ID (`worker:12855-12857`).
- **Print failure is silent** when the blob tab is blocked (97-104); save succeeds, so the record exists without the patient ever receiving the sheet.
- **Dev message left in production UI** telling the user to add a router line (1730).
- ID regex accepts zero digits (`\d{0,7}`, 116): "M" → "0000000M".
- `loadPatients` failure is swallowed (141-144) → autosuggest silently empty.
- Records list is LIMIT 200 with no paging or search (`worker:12831`).
- Prednisolone "Reset to Example" replaces all steps without confirmation (866, 872); taper example 30/20/10/5 × 5 days is a demo, not guidance.

**Speed notes.** Render: 1 GET of patients (non-blocking). Records view: 1 GET list + 1 GET per clicked row. Solver cost is exponential in pieces × strengths; typical inputs resolve in milliseconds. Printouts for 12-week levothyroxine include 84 rows; fine.

**Must not be lost.**
- Exact combination solver with whole/half/quarter pieces and the scoring order (fewest physical tablets first) — the printed "tablets to take" instruction depends on it.
- Per-weekday dose grids (levothyroxine, warfarin) and warfarin cycle mode; per-strength dispensing totals with pack/blister rounding.
- Methotrexate once-weekly banners on screen and print; warfarin INR-clinic safety note.
- Insulin discard-rule and priming simulation (containers actually needed, not just units ÷ 300).
- Saved record with full model, reprint identical to original, patient header with pharmacy name, ID and note.
- Maltese ID padding and patient autosuggest shared across calculators.

---

## OTC Mindmap  (`modules.otcmindmap.js`, id `otcmindmap`, order 71, visible to: pharmacy role via "Clinical"; no API; static JSON; no admin-only parts)
**Purpose.** Explore an over-the-counter product knowledge graph (products, symptoms, use cases, bundles, with similar/complement/guardrail links) on a force-directed canvas, loading one neighbourhood JSON per node.

**Functions.**
1. Load `productmap-data/manifest.json` and `search-index.json` on render — automatic; API: static GET (force-cache). (162-177, 931-932)
2. Search box with 100 ms debounce, scored matching (exact / prefix / contains / word overlap + priority), dropdown with type badges, ↑ ↓ Enter Esc, click-outside close — where: top bar. (636-679, 964-1002)
3. Open a node's neighbourhood (fetch `neighbours/{type}/{id}.json`, cached in a Map), collapse link groups — where: search pick, Enter, double-click node, item-list row, complement modal row. (179-188, 239-248)
4. Score threshold slider (default 50) and item limit (checkbox + number, default on, 20) applied to links before layout — where: right panel "Links" controls. (190-231, 939-962)
5. Canvas: force layout with repulsion/springs/centre pull until settled, pan (drag background), drag node (pins while dragging), wheel zoom 0.15–4×, zoom +/- buttons, Fit to screen, hover tooltip with connection count — where: canvas. (250-452, 1008-1022)
6. Right panel link groups per relation type (Similar, Complements, Symptoms, Use cases, Bundles, Guardrails) with count, expand/collapse, group toggle checkbox and per-edge checkboxes controlling visibility — where: panel body. (454-543)
7. Panel actions Collapse All / Expand All / Select All / Unselect All; panel collapse button — where: panel header / top bar. (602-616, 1003-1007, 1023-1026)
8. "Similar Items" and "Complementary Items" scored lists with reason text; click navigates — where: panel body. (545-600)
9. "Complementary Items" floating button (flashes when the node has complement links) opening a modal: filter by symptom chips, list of complements with score/reason, click navigates — where: canvas overlay. (714-848, 1028-1031)
10. Stats bar (counts per node type, visible/total links) — automatic. (618-634)
11. Legend overlay — static. (875-880)
12. Window resize handling and panel-collapse re-measure — automatic. (681-687, 935)

**Data & state.** Static files under `ui/productmap-data/`: manifest (version `2026-03-17-gh-split-v1`, 522 products, 88 symptoms, 22 use cases, 5 bundles, 16,346 relationships, 1,829 guardrails), `search-index.json` (298 KB), per-node neighbourhood JSON (products 47 MB total, largest ~218 KB), plus `core/*.json` sources that the UI never loads. Base path overridable via `window.EIKON_PRODUCTMAP_BASE` (20). All module state is in closure-level variables that persist across renders. No API, no storage, no PII.

**Permissions & scoping.** None. Content is org-independent.

**Edge cases & risks (found in code, cite line numbers).**
- **Safety guardrails can be filtered out by default.** `filterGraphData` applies the score threshold and then the top-N item limit to **all** link types together (194-206). On a product with 143 complement links (e.g. P0022) the default limit of 20 keeps only the highest-scored links of any type; guardrails scored 88 are dropped when enough other links score higher. The guardrail's `meta.posAction` ("Do not cross-sell together…") is never rendered anywhere; only its short label appears in the panel list (518). The complement modal (784-829) shows complements without the guardrails that argue against them.
- **Data provenance**: relationships are marked `"Review_Status":"Seeded"` (machine-generated from symptom matches) in the core files; the UI shows no review status, version or date to the pharmacist. The manifest `defaultGraphOptions` (max 120 relationships) is ignored by the UI.
- **Stale data forever.** Every fetch uses `cache:"force-cache"` with no version in the URL (163), unlike the vaccines map; after the data folder is updated, browsers keep serving the old neighbourhoods until the HTTP cache is evicted.
- **Listener leak.** `bindCanvas` adds `pointermove`/`pointerup` on `window` (430, 439), `document` click (1000) and `window` resize (935) on **every render**; switching modules back and forth accumulates handlers that reference detached canvases.
- **No keyboard access to the canvas**: navigation is double-click only (448-451); tooltip advises it (414).
- `renderEmptyState` monkey-patches `buildGraph` (698-703) — works because callers resolve the name late, but fragile.
- Silent failure: fetch errors propagate as unhandled promise rejections from `buildGraph` (no catch in callers 450, 593, 671, 824, 994) — the user sees nothing happen.

**Speed notes.** First open: manifest + 298 KB index. Each node open: one JSON of up to ~218 KB; cached per session. Physics loop is O(n²) per frame (275-294) and runs via rAF continuously, even when settled (render still draws every frame, 388). With the default limit of 20 links n ≤ ~21 nodes; with the limit off on a product node n ≈ 160 → 12,800 pair checks per frame.

**Must not be lost.**
- Guardrail relationships with `why` and `posAction` (duplicate-therapy / do-not-cross-sell rules) — the only safety content in the graph; must become always-visible, never filtered.
- Symptom → product and complement → product links with scores and reasons (the counter-prescribing aid).
- Search index semantics (brand, actives, strength, category, symptom text).
- Bundles and use cases as curated groupings.
- The split-file loading model (small module, per-node JSON) and a data version visible in the UI.

---

## Smart Labels  (`modules.labels.js`, id `labels`, order 71, visible to: pharmacy role via "Operations" sidebar; worker requires admin|staff; no admin-only parts)
**Purpose.** Compose, preview and print medication dispensing labels (EN with optional Maltese) from templates, with warning phrases, autosuggest from history, pharmacy details and a print history that doubles as the audit log.

**Functions.**
1. Hero KPIs: total printed, today, known drugs, templates — automatic. (575-589)
2. Create Label tab: template select, language select (English only / English + Maltese), include-patient-name toggle, patient name with autosuggest (`E._eikon_patients`), drug name with autosuggest from history, dose, route (11), frequency (13 fixed EN phrases with MT translations), custom instructions — where: tab form. (621-656)
3. Medicine autofill: picking a known drug fills dose/frequency/route/instructions/warnings from the most recent matching history entry; multiple distinct variants → variant picker; autofilled fields flash until edited — where: drug field. (759-835, 282-288)
4. Warning/advisory chips (20 fixed EN/MT phrases) toggle — where: form. (101-122, 658-683)
5. Live print preview (white label card, standard or large size, Maltese shown inline when selected) — where: right card. (849-902)
6. Print Label: appends history entry (id, printedAt local string, printedBy name/email), saves state, opens print tab, auto-prints, closes after print — where: "Print Label"; API: PUT /labels/state; extras: label print. (703-721, 290-363)
7. Clear Form — where: button. (723-730)
8. Print History tab: table (patient, drug, dose, frequency, printed, by), search on Enter (patient/drug/date), Reprint (loads into Create form) — where: tab. (906-973)
9. Templates tab: list, New/Edit Template modal (name, size standard/large, fields chips, set default), Delete non-default template (`window.confirm`) — where: tab; API: PUT /labels/state. (976-1096)
10. Warning Labels tab: reference table EN/MT — where: tab. (1099-1118)
11. Pharmacy Details tab: name, address, phone, licence; Save — where: tab; API: PUT /labels/state. (1121-1150)
12. Auto side effect: on first render with empty pharmacy name, copy `user.location_name` and save state — automatic. (552-556)
13. Cross-module: contributes patient names to `E._eikon_patients` — automatic. (150-158)

**Data & state.** `GET/PUT /labels/state` → D1 `label_history` (one row per label id, authoritative replace with delete) + `label_settings` (templates + pharmacy details JSON, one row per location) (`worker:18419-18497`). Module-level `labelHistory`, `templates`, `pharmacyDetails`, `currentLabel`, `showMaltese`, `includePatientName` persist in closure. No localStorage, no polling.

**Permissions & scoping.** Worker admin|staff, org+location. Client: none. History (the audit log) is deleted by whichever PC saves next if it never loaded that row (shared note); nothing prevents a staff user from deleting templates or editing pharmacy licence number.

**Edge cases & risks (found in code, cite line numbers).**
- **Maltese is never printed.** The preview honours the `showMaltese` select (863, 873), but `buildPrintHtml` decides from `tpl.language === "mt"` (297), a property no template editor ever sets (1041-1083). The pharmacist sees a bilingual preview and the patient receives an English-only label. Preview ≠ print on a safety-relevant field.
- **Preview and print differ in other content too**: preview shows pharmacy address and "Patient:" (855-859); print omits the address entirely and prints "Pat:", "Rx:", "Dose/Freq:" abbreviations (303-318). Template `fields` selection (1043-1049) is ignored by both preview and print — only `size` is used (296, 852).
- **Label legal minimum not enforced.** Patient name is **off by default** (541) and optional; quantity dispensed, prescriber, dispensing pharmacist, "Keep out of reach of children" (only an optional chip, w16), pharmacy address and date of dispensing are not mandatory fields; drug strength/form are free text inside "Drug Name". A rebuild needs a locked mandatory set per label type.
- **Autofill copies another patient's regimen.** `applyMedicineEntry` fills dose, frequency, route, instructions and warnings from whatever was last printed for that drug name (773-811); the only defence is a flashing border. Dose autofill from history is a known mis-dispensing vector.
- **Label geometry is hopeful.** Fixed 2.2 mm / 2.8 mm fonts, `@page{margin:0}` with no `size` (354-355), no line-budget check; a label with several warnings and Maltese overflows a 38×24 mm label silently; no barcode/QR, no printer profile, no test print.
- **Date on the label is "today", not the dispensing record date** (328): reprinting an old label prints today's date; no reprint marker is added.
- **Print history grows unbounded and is re-PUT in full on every print** (85, 711); server upserts every row and diff-deletes each time (`worker:18476-18494`) — O(n) writes per label, and a lost race deletes audit rows.
- **Dropped saves** when a PUT is in flight (83) — the just-printed label may never reach the history (audit gap). Note the toast says "saved to history" regardless (718).
- `printedAt` is a local string without zone (30); `todayLabels` KPI compares string prefixes (576).
- `window.confirm` for template delete (1021).
- Reprint path lets the user alter fields before printing with no indication on the label that it is a reprint/altered.
- Silent catches: 78, 86 (warn), 340, 346, 348.

**Speed notes.** Render: 1 GET with full history (grows per label), followed immediately by a PUT of the same payload if pharmacy name was empty. `redraw()` rebuilds the whole page on every tab click and after every print. Preview re-renders on every keystroke (896-900); cheap. `buildMedicineDb` scans the entire history on load and after each print.

**Must not be lost.**
- Printed label content set: pharmacy name/phone/licence, patient, drug, dose, frequency (+MT), route, note, selected warnings (+MT), date.
- 20 bilingual warning phrases and 13 bilingual frequency phrases (reviewed Maltese text — keep verbatim).
- Print history with who/when per label and reprint from history (the dispensing audit trail an inspector will ask for).
- Standard vs large-print templates and the per-location pharmacy details block.
- Drug/patient autosuggest (speed) — but with autofill of dose made explicit and confirmable.

---

## Cross-cutting findings for the rebuild (clinical set)

1. **Whole-state replace** in POCT, screening, PV and labels must become row-level writes with server ids, optimistic concurrency and server-side soft delete; otherwise multi-PC pharmacies lose and silently delete clinical records.
2. **Reference data in code** (OCP list, levothyroxine strengths/pack sizes, MedDRA subset, warning phrases, vaccine country lists in CSV columns, OTC graph JSON) needs a single versioned, dated, reviewable store with "last reviewed by" shown in the UI.
3. **No patient identity model**: POCT uses ID-card master, screening copies into it, labels and PV use free-text names/initials, pharmacy-calc has its own `pharmacy_calc_patients`, vaccines has none. Age is stored instead of DOB in POCT, screening and PV.
4. **No consent capture** anywhere (POCT, screening, vaccines, PV all process health data).
5. **No result thresholds/alerts** in POCT or screening; the only hard safety banners are methotrexate and warfarin in the calculators.
6. **Print pipeline** differs per module (window.open + document.write; blob URL + a.click; new tab with auto-close); popup blocking is sometimes silent (pharmacy-calc, OCP, labels fallback) — and in labels the print differs from the preview.
7. **Audit**: client-side deletes everywhere are unaudited beyond a count; pharmacy-calc has no server role check and no audit rows.
