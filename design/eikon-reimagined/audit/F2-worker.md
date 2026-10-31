# F2 — Worker (backend) audit

Source: `/home/user/eikon-ui/cloudflare-worker/code` (18,938 lines, single Cloudflare Worker module, `WORKER_VERSION = "2026-02-27-icalfix3"` at line 7). All line numbers below refer to that file unless prefixed with `ui/`.

Bindings actually used (grep of `env.*`): `env.DB` (D1), `env.CERTS_R2` (R2, optional), `env.ALLOWED_ORIGINS`, `env.BOOTSTRAP_TOKEN`, `env.SUPERUSER_EMAILS`, `env.SESSION_TTL_SECONDS`, `env.DEBUG_STACK`, `env.CERT_UPLOAD_MAX_BYTES`, `env.UI_CACHE_SECONDS`, `env.UI_GITHUB_OWNER/REPO/BRANCH/DIR`. No KV, no Queues, no Durable Objects, no `scheduled()` export, no email/SMS/WhatsApp provider, no outbound fetch except `raw.githubusercontent.com` (line 9987). No `wrangler.toml` is in the repo, so the real binding names/limits in production could not be verified.

---

## 1. Request pipeline

**Routing style.** One `export default { async fetch(request, env, ctx) }` (15299) containing a ~1,500-line if-chain of `url.pathname === "..."` / `startsWith` / regex matches (15305–16823). No router table, no middleware. Order matters and is fragile: generic `startsWith("/scarce-stock/offers/")` PUT/DELETE handlers must sit after the more specific `/requests`, `/place-on-returns` branches (comments at 15617, 15660 acknowledge this). Several handlers accept path aliases "the UI may try" (EOD has five aliases per verb, 15526–15552; appointments accept both `/appointments/*` and `/api/appointments/*` on collection routes but *only* `/appointments/*` on `/:id` routes, 15440, 15464, 15480, 15495). Everything is wrapped in one try/catch that converts any throw into JSON 500 with `message` (and the stack when `DEBUG_STACK=1`) (16824–16843).

**Pipeline order (important for security):**
1. `/ui/*` static proxy — no auth, no CORS gate (15305).
2. `/health`, `/bootstrap`, `/admin-recover`, `/su` (HTML), `/go/gpt-extractor` (302 to a ChatGPT GPT) — public (15309–15337).
3. CORS computed (15340); `OPTIONS` → 204.
4. `/auth/login` (CORS-gated) (15346).
5. `/su/api/*` (CORS-gated, superuser) (15352–15409).
6. Public token endpoints: `/shifts/ical*` (15413) and `/appointments/public/lookup` (15421).
7. `authFromRequest` → 401 if no valid session (15425).
8. **Appointments routes (15434–15518) run before the CORS `ok` check**; the `if (!cors.ok) return 403` is only at 15519, so a cross-origin page can call every authenticated appointments endpoint (and `/auth/me`? no, `/auth/me` is after). Only the *response* lacks `Access-Control-Allow-Origin`, so a browser cannot read it, but the write side effects (POST/PUT/DELETE appointments, doctors, clinics) still happen — a CSRF vector if a token could be attached; since auth is a Bearer header not a cookie, practical risk is low, but the ordering is wrong.
9. All remaining module routes (15521–16820), then 404.

**CORS** (`corsHeadersForRequest`, 84–127). Same-origin always allowed; otherwise exact match against comma-separated `ALLOWED_ORIGINS`; missing `Origin` header is allowed (87). Allowed headers include `X-Eikon-Debug`, `X-Eikon-Report-Pass`, `X-Eikon-Edit-Pass` (98). `/ui/*` responses and the CSV template return `Access-Control-Allow-Origin: *` (9964, 10021).

**Auth.**
- Token: 32 random bytes, base64url (1402–1404). Stored as SHA-256 base64 in `sessions.token_hash_b64` (1409). Client keeps it in `localStorage` (`ui/core.js:242–244`) and sends `Authorization: Bearer`.
- `authFromRequest` (1024–1078): 1 JOIN query sessions→users, then a second query for the location (1062) and a third for the org (1066) — **3 D1 round-trips on every authenticated request**. Expiry check `expires_at > now` (1057). Inactive users rejected (1053). Users without a default location are rejected (1060).
- Session TTL: `SESSION_TTL_SECONDS` default 2,592,000 s = 30 days, sliding not supported (1401). **No logout endpoint exists** (grep `logout` in worker: none); `E.logout` only clears localStorage (`ui/core.js:1199–1211`). Tokens are therefore valid for 30 days after "logout". Revocation only happens on SU password reset (890), SU user delete (897), admin-recover reset (1232) and org force-delete (741, 746). **Expired sessions are never purged** from the table.
- Password hashing: PBKDF2-SHA256, 16-byte salt, 100,000 iterations, 256-bit output (159–181, 804, 884, 1221, 1330). Constant-time compare (146–151). Login does **no rate limiting and no audit of failed attempts** (1367–1433); only successful `LOGIN` is audited (1415).
- Roles: `users.role` is only ever `admin` or `user` (SU validation 779, 848; bootstrap hard-codes `admin` 1335). `requireRole(user, roles)` (1020) is called with `["admin","staff"]` in ~150 handlers (e.g. 1648, 3332, 4095, 7799, 13898). A `user`-role account therefore gets **403 on almost every pharmacy module**; only paid-out (`["admin","staff","user"]`, 4519–4800), shifts, board, pharmacy-calc, cherubino, emergency POS, quotations, order diary, supplier products, cleaning list and instructions have no or a `user`-inclusive check. Practical consequence (could not verify against live data): every working pharmacy account must be `admin`, so the "admin-only" guards (temperature device create 1519, appointments doctors/clinics/schedules 13925, audit log 14723, loyalty delete 17171) do not separate pharmacist from counter staff.
- Superuser: `isSuperuser` = role admin **and** email in `SUPERUSER_EMAILS` allowlist (195–202). The UI hard-codes `E.SUPERUSER_EMAIL = "labrint@gmail.com"` (`ui/core.js:349`).
- Bootstrap: `GET/POST /bootstrap` (1256–1365) creates first org/location/admin; disabled once any user exists (1287); protected by `BOOTSTRAP_TOKEN` string compare (not constant-time, 1304).
- Recovery: `GET/POST /admin-recover` (1122–1254) verifies or resets **any** user's password given `BOOTSTRAP_TOKEN` + email. Rate limit: 5 attempts / 15 min **keyed by target email only** (1160–1172) — an attacker rotating emails is unlimited; 2 s delay on bad token (1178). Creates `recover_attempts` table lazily (1163). The page echoes whether the email exists (1198) despite the comment saying it should not. Writes audit rows with `org_id = 0` (1177, 1197).
- Second-factor "passwords" for locum receipts are **hard-coded in source and in the UI**: `LOCUM_RECEIPTS_REPORT_PASS = "Report1234!"`, `LOCUM_RECEIPTS_EDIT_PASS = "!4321"` (5662–5663), checked via `requireHeaderPass` (5689) at 5813, 5883, 5917; UI mirrors them at `ui/modules.locumreceipts.js:929, 1057, 1094`.

**org_id / location_id scoping.** Derived server-side from the session (`authUser.org_id`, `authUser.location_id`, 1069–1077); handlers never take them from the body (good). Enforcement is per-handler by hand-written `WHERE org_id = ? AND location_id = ?`. Exceptions (see inventory column "Scope"): org-only scoping on quotations (2133, 2178), order diary (2277, 2308), client-orders delete (3665), client-tickets delete (4024), cherubino orders/price/oos/short-expiry (17518–17930), contacts except `clients` (18574–18705); cross-org reads on scarce-stock offers/needs (11148, 11436), supplier inventory and stock changes (`WHERE 1=1`, 2795, 2829), board messages scope `all` (14926), board user search (15249); `all_org=1` switches on quotations (2057), cherubino orders (17480), POS catalog (18019, plus `fallback_org`/`fallback_location` query params that let any user read **another org's** POS catalog when their own is empty, 18017–18033). "Company admin" and "supplier" capabilities are inferred from the numeric `location_id` range (600–900 → company admin at 17528, 17857, 18712; `< 400` → pharmacy at 18740), mirroring `ui/core.js:347–366`.

**Endpoints that skip auth.** `/ui/*`, `/health`, `/bootstrap`, `/admin-recover`, `/su` (page), `/go/gpt-extractor`, `/auth/login`, `/shifts/ical*` (token in URL; see risk #2), `/appointments/public/lookup` (ID card + 4-char token, 14668), `OPTIONS *`.

---

## 2. Endpoint inventory

Auth levels: **public**; **user** = any active session (note the `staff` mismatch above); **admin** = `requireRole(["admin"])`; **SU** = superuser allowlist; **token** = secret in URL/header. Scope: Y = org+location in WHERE; O = org only; X = cross-org by design; P = partial/mixed. "UI" = module file(s) referencing the path (grep of `ui/`); **none** = no UI caller (dead, external or SU-page only). Aliases are collapsed to one row. Count: **333 routes**.

| # | Method | Path | Auth | Scope | Reads / writes | UI |
|---|---|---|---|---|---|---|
| 1 | GET | /ui/* | public | – | proxies GitHub raw, Cache API (9948–10031) | index.html loader |
| 2 | GET | /health | public | – | – | **none** (ops) |
| 3 | GET/POST | /bootstrap | public + BOOTSTRAP_TOKEN | – | W orgs, locations, users, audit_log | **none** |
| 4 | GET/POST | /admin-recover | public + BOOTSTRAP_TOKEN | – | R users; W users, sessions, recover_attempts, audit_log | **none** |
| 5 | GET | /su | public HTML | – | – | **none** (SU page) |
| 6 | GET | /go/gpt-extractor | public | – | 302 redirect | **none** |
| 7 | POST | /auth/login | public | – | R users, locations, orgs; W sessions, audit_log | core |
| 8 | GET | /su/api/overview | SU | all | R orgs, locations, users | SU page only |
| 9 | POST | /su/api/account | SU | all | W orgs, locations, users | SU page |
| 10–12 | GET/PUT/DELETE | /su/api/orgs/:id (`?force=1`) | SU | all | W orgs; force: DELETE from every table with `location_id` (707–755) | SU page |
| 13–15 | GET/PUT/DELETE | /su/api/users/:id | SU | all | R users **incl. pass_salt/pass_hash** (825–833); W users, sessions | SU page |
| 16 | POST | /su/api/users/:id/password | SU | all | W users, sessions | SU page |
| 17–19 | GET/PUT/DELETE | /su/api/locations/:id | SU | all | W locations, users | SU page |
| 20 | POST | /su/api/locations/:id/wipe | SU | all | DELETE from every table with `location_id` (950–960) | SU page |
| 21 | GET | /shifts/ical, /shifts/ical.ics, /shifts/ical/:token | token | Y via token | R shift_calendar_tokens, shift_settings (LIKE scan), shift_assignments, shift_staff | shifts (builds URL); external calendar clients |
| 22 | GET | /appointments/public/lookup (+/api) | token (id_card+4-char) | X (token global) | R appt_appointments, appt_doctors, appt_clinics | **none** (external patient page) |
| 23 | GET | /auth/me | user | – | – | core |
| 24–28 | GET,POST / GET,PUT,DELETE :id | /appointments/doctors | user (writes admin) | Y | appt_doctors, appt_schedules cascade | appointments |
| 29–33 | GET,POST / GET,PUT,DELETE :id | /appointments/clinics | user (writes admin) | Y | appt_clinics | appointments |
| 34–37 | GET,POST / PUT,DELETE :id | /appointments/schedules | user (writes admin) | Y | appt_schedules | appointments |
| 38–42 | GET,POST / GET,PUT,DELETE :id | /appointments/entries | user | Y | appt_appointments (+overlap check 14350) | appointments |
| 43–47 | GET,POST / GET,PUT,DELETE :id | /appointments/waitlist | user | Y | appt_waitlist | appointments |
| 48 | GET | /eod/get, /eod/record, /eod, /endofday/record, /endofday | user | Y | end_of_day | endofday, paidout |
| 49 | POST/PUT | /eod/upsert, /eod/record, /eod, /endofday/record, /endofday | user | Y | end_of_day (lock/unlock/update) | endofday, paidout |
| 50 | POST | /eod/lock | user | Y | end_of_day | **none** |
| 51 | GET | /eod/dates, /eod/month, /eod/list, /endofday/* | user | Y | end_of_day | endofday, paidout |
| 52 | GET | /eod/contacts, /endofday/contacts, /eod/contact, /endofday/contact | user | Y | end_of_day_contacts | endofday |
| 53 | PUT | /eod/contacts, /endofday/contacts (bulk) | user | Y | end_of_day_contacts | endofday |
| 54 | POST | /eod/contacts, /endofday/contacts | user | Y | end_of_day_contacts | endofday |
| 55–56 | PUT/DELETE | /(eod\|endofday)/contacts/:id | user | Y | end_of_day_contacts (soft deactivate) | endofday |
| 57–60 | GET,POST / PUT,DELETE :id | /paid-out/entries | user (incl. `user`) | Y | paid_out_entries | paidout, dashboard |
| 61 | GET | /paid-out/names | user | Y | paid_out_entries | paidout |
| 62 | GET | /paid-out/report | user | Y | paid_out_entries | paidout |
| 63–64 | GET/PUT | /instructions/global | user | Y | instructions_global | instructions |
| 65–66 | GET/PUT | /instructions/daily | user | Y | instructions_daily | instructions, dashboard |
| 67 | GET | /scarce-stock/offers | user | **X** (all orgs) + side-effect writes (11028–11099) | scarce_stock_offers, requests, near_expiry_entries, stock_transfer_* | scarcestock, nearexpiry, dashboard |
| 68 | POST | /scarce-stock/offers | user | Y | scarce_stock_offers, near_expiry_entries | scarcestock, nearexpiry |
| 69 | POST | /scarce-stock/offers/:id/requests | user | X (any org's offer) | scarce_stock_offer_requests + depletion cascade | scarcestock |
| 70–71 | PUT/DELETE | /scarce-stock/offer-requests/:id | user | requester-owned | scarce_stock_offer_requests | scarcestock |
| 72 | POST | /scarce-stock/offers/:id/place-on-returns | user | owner | returns_entries, scarce_stock_offers | scarcestock |
| 73 | POST | /scarce-stock/offers/:id/place-on-transfer | user | owner | stock_transfer_items | scarcestock |
| 74–75 | PUT/DELETE | /scarce-stock/offers/:id | user | owner | scarce_stock_offers (+cascades) | scarcestock |
| 76 | GET | /scarce-stock/needs | user | **X** | scarce_stock_needs, need_offers | scarcestock, dashboard |
| 77 | POST | /scarce-stock/needs | user | Y | scarce_stock_needs | scarcestock |
| 78 | POST | /scarce-stock/needs/:id/offers | user | X | scarce_stock_need_offers | scarcestock |
| 79 | POST | /scarce-stock/need-offers/:id/accept | user | need owner | need_offers | scarcestock |
| 80 | POST | /scarce-stock/need-offers/:id/confirm | user | offerer | need_offers, needs | scarcestock |
| 81–82 | PUT/DELETE | /scarce-stock/need-offers/:id | user | offerer | need_offers | scarcestock |
| 83–84 | PUT/DELETE | /scarce-stock/needs/:id | user | owner | needs (+offers) | scarcestock |
| 85 | GET | /stock-transfers/items | user | O (org-wide) + side-effect auto-close (11915–11935) | stock_transfer_items/requests, scarce_stock_* | stocktransfers, returns, dashboard |
| 86 | POST | /stock-transfers/items | user | Y | stock_transfer_items | stocktransfers |
| 87–90 | POST | /stock-transfers/requests/:id/accept\|reject\|confirm-dispatch\|confirm-delivery | user | owner/requester | stock_transfer_requests, items, scarce_stock_* | stocktransfers |
| 91 | DELETE | /stock-transfers/requests/:id | user | owner or requester | stock_transfer_requests | stocktransfers |
| 92 | POST | /stock-transfers/items/:id/requests | user | same org, other location | stock_transfer_requests | stocktransfers |
| 93–94 | POST | /stock-transfers/items/:id/place-on-returns\|place-on-scarce-stock | user | owner | returns_entries / scarce_stock_offers | stocktransfers |
| 95–96 | PUT/DELETE | /stock-transfers/items/:id | user | owner | items (+cascade deletes returns/scarce) | stocktransfers |
| 97 | GET | /temperature/devices | user | Y (auto-creates defaults, admin) | temperature_devices | temperature, dashboard |
| 98 | POST | /temperature/devices | admin | Y | temperature_devices | temperature |
| 99 | PUT | /temperature/devices/:id | admin | Y | temperature_devices | temperature |
| 100 | GET | /temperature/entries | user | Y | temperature_entries | temperature, dashboard |
| 101 | POST | /temperature/entries (upsert) | user | Y | temperature_entries, sync_jobs | temperature |
| 102 | DELETE | /temperature/entries/:id | user | Y | temperature_entries, sync_jobs | temperature |
| 103 | GET | /temperature/report | user | Y | devices, entries | temperature |
| 104 | GET | /temperature/report/html | user | Y | same | **none** |
| 105–106 | GET/POST | /vaccines/catalog | user | P (global org 0 + own) | vaccines_catalog | vaccines |
| 107–108 | GET/POST | /vaccines/orders | user | Y | vaccines_orders, order_items, vaccines_stock | vaccines |
| 109–111 | GET,POST / PUT :id | /vaccines/stock/rows | user | Y | vaccines_stock | vaccines |
| 112–115 | GET,POST / PUT,DELETE :id | /client-orders/entries | user | Y (delete **O**, 3665) | client_orders_entries | clientorders, dashboard |
| 116–119 | GET,POST / PUT,DELETE :id | /quotations/entries | user (no role check) | Y list (`all_org=1` → O); update/delete **O** (2133, 2178) | quotation_entries | quotations, orderdiary |
| 120–123 | GET,POST / PUT,DELETE :id | /order-diary/entries | user (no role check) | Y list; update/delete **O** (2277, 2308) | order_diary_entries, order_diary_items | orderdiary, clientorders, supplier-inventory |
| 124 | GET | /order-diary/items | user | O | order_diary_items | orderdiary |
| 125 | POST | /order-diary/carry-over | user | Y | order_diary_entries | orderdiary |
| 126–127 | GET/POST | /supplier-products/entries | user (no role check) | Y | supplier_products | supplier-products, supplier-dashboard, supplier-received-orders |
| 128 | POST | /supplier-products/bulk-import | user | Y | supplier_products (DELETE all + insert), supplier_stock_changes | supplier-products |
| 129 | GET | /supplier-products/inventory | user | **X** (`WHERE 1=1`, 2795) | supplier_products, locations | supplier-inventory, orderdiary, quotations |
| 130–131 | GET/PUT | /supplier-products/inventory-settings | user | Y | supplier_inventory_settings | supplier-inventory |
| 132 | GET | /supplier-products/changes | user | **X** | supplier_stock_changes | dashboard |
| 133 | PUT | /supplier-products/changes/:id/seen | user | X | supplier_stock_changes | **none** |
| 134 | PUT | /supplier-products/entries/:id/stock-status | user | Y | supplier_products, supplier_stock_changes | supplier-products, supplier-received-orders |
| 135–136 | PUT/DELETE | /supplier-products/entries/:id | user | Y | supplier_products | supplier-products, supplier-received-orders |
| 137 | POST | /supplier-orders | user | Y (pharmacy side) | supplier_orders, supplier_order_items | supplier-inventory |
| 138 | GET | /supplier-orders/sent | user | Y | supplier_orders (+subqueries) | supplier-inventory, dashboard |
| 139 | GET | /supplier-orders/received | user | location only (3064) | supplier_orders | supplier-received-orders, supplier-dashboard, core (poll) |
| 140 | PUT | /supplier-orders/items/:id/unavailable | user | supplier location | supplier_order_items | supplier-received-orders |
| 141 | PUT | /supplier-orders/:id/confirm | user | supplier location | supplier_orders, items | supplier-received-orders |
| 142–144 | GET/PUT/DELETE | /supplier-orders/cart-draft | user | Y | supplier_cart_drafts | supplier-inventory |
| 145 | GET | /supplier-orders/feedback | user | supplier location | supplier_order_item_feedback | supplier-order-feedback, supplier-dashboard, core (poll) |
| 146 | POST | /supplier-orders/items/:id/feedback | user | pharmacy location | supplier_order_item_feedback | supplier-inventory |
| 147 | PUT | /supplier-orders/feedback/:id/resolve | user | supplier location | feedback | supplier-order-feedback |
| 148–149 | GET/PUT | /supplier-orders/:id | user | either party location | supplier_orders, items, feedback | supplier-inventory, supplier-received-orders, dashboard |
| 150–153 | GET,POST / PUT,DELETE :id | /client-tickets/entries | user | Y (delete **O**, 4024) | client_tickets_entries | tickets, dashboard |
| 154–155 | GET/POST | /near-expiry/entries | user | Y | near_expiry_entries (+returns join) | nearexpiry, dashboard |
| 156 | POST | /near-expiry/entries/create-return | user | Y | returns_entries, near_expiry_entries | nearexpiry, dashboard |
| 157 | POST | /near-expiry/entries/create-returns-bulk | user | Y | same (≤100) | nearexpiry |
| 158–159 | PUT/DELETE | /near-expiry/entries/:id | user | Y | near_expiry, returns, scarce_stock_offers cascade | nearexpiry |
| 160 | GET | /cleaning/entries | user (**no role check**, 5225) | Y | cleaning_entries | cleaning, dashboard |
| 161–163 | POST / PUT,DELETE :id | /cleaning/entries | user | Y | cleaning_entries | cleaning |
| 164–165 | GET | /cleaning/report, /cleaning/report/html | user (no role check) | Y | cleaning_entries | **none** |
| 166–169 | GET,POST / PUT,DELETE :id | /locumregister/entries | user | Y | locum_register_entries | locumregister |
| 170–171 | GET/POST | /locumreceipts/receipts | user | Y | locum_receipts | locumreceipts |
| 172–173 | PUT/DELETE | /locumreceipts/receipts/:id | user + `X-Eikon-Edit-Pass` | Y | locum_receipts | locumreceipts |
| 174 | GET | /locumreceipts/report | user + `X-Eikon-Report-Pass` | Y | locum_receipts | locumreceipts |
| 175–176 | GET/PUT | /poct/state | user | Y | poct_patients, poct_records (authoritative replace) | poct |
| 177–180 | GET,POST / PUT,DELETE :id | /daily-register/entries | user | Y | daily_register_entries | dailyregister, dashboard |
| 181–182 | GET | /daily-register/report, /report/html | user | Y | daily_register_entries | **none** |
| 183–186 | GET,POST / PUT,DELETE :id | /alerts/entries | user | Y | alerts_entries | alerts, dashboard |
| 187–190 | GET,POST / PUT,DELETE :id | /returns/entries | user | Y | returns_entries (+near_expiry, stock_transfer cascades) | returns, dashboard, orderdiary, supplier-inventory |
| 191 | GET | /dda-sales/client | user | Y, **writes** (7884) | dda_sales_entries | ddasales |
| 192 | GET | /dda-sales/doctors | user | Y | dda_sales_entries | ddasales |
| 193 | GET | /dda-sales/clients | user | Y | dda_sales_entries | ddasales |
| 194 | GET | /dda-sales/entries | user | Y | dda_sales_entries | ddasales |
| 195 | GET | /dda-sales/check-serial | user | Y | dda_sales_entries | ddasales |
| 196 | POST | /dda-sales/entries | user | Y (+mass UPDATE of id cards 8043) | dda_sales_entries | ddasales |
| 197 | POST | /dda-sales/entries/delete | user | Y | dda_sales_entries | ddasales |
| 198–199 | PUT/DELETE | /dda-sales/entries/:id | user | Y | dda_sales_entries | ddasales |
| 200 | POST | /dda-sales/entries/:id/delete | user | Y | dda_sales_entries | ddasales |
| 201 | GET | /dda-sales/report | user | Y | dda_sales_entries | ddasales |
| 202 | GET | /dda-sales/report/html | user | Y | same | **none** |
| 203–206 | GET,POST / PUT,DELETE :id | /repeat-prescriptions/entries | user | Y | repeat_prescription_entries | repeatprescriptions |
| 207 | GET | /dda-poyc/entries | user | Y | dda_poyc_entries | ddapoyc |
| 208 | GET | /dda-poyc/check-serial | user | Y | dda_poyc_entries | ddapoyc |
| 209 | POST | /dda-poyc/entries | user | Y | dda_poyc_entries | ddapoyc |
| 210 | POST | /dda-poyc/entries/delete | user | Y | dda_poyc_entries | ddapoyc |
| 211 | POST | /dda-poyc/entries/:id/delete | user | Y | dda_poyc_entries | ddapoyc |
| 212–213 | PUT/DELETE | /dda-poyc/entries/:id | user | Y | dda_poyc_entries | ddapoyc |
| 214 | GET | /dda-poyc/report | user | Y | dda_poyc_entries | ddapoyc |
| 215 | GET | /dda-poyc/report/html | user | Y | same | **none** |
| 216–219 | GET,POST / PUT,DELETE :id | /dda-purchases/entries | user | Y | dda_purchases_entries | ddapurchases |
| 220 | GET | /dda-purchases/report | user | Y | dda_purchases_entries | ddapurchases |
| 221 | GET | /dda-purchases/report/html | user | Y | same | **none** |
| 222–223 | GET/POST | /dda-stocktakes/stocktakes | user | Y | dda_stocktakes | ddastocktakes |
| 224–225 | GET/PUT | /dda-stocktakes/stocktakes/:id | user | Y | dda_stocktakes (close/reopen) | ddastocktakes |
| 226 | POST | /dda-stocktakes/stocktakes/:id/items | user | Y | dda_stocktake_items | ddastocktakes |
| 227 | GET | /dda-stocktakes/stocktakes/:id/report/html | user | Y | same | ddastocktakes |
| 228–229 | PUT/DELETE | /dda-stocktakes/items/:id | user | Y | dda_stocktake_items | ddastocktakes |
| 230 | GET/HEAD | /certificates/items/:idOrKey/download\|file | user | Y | certificates_items, R2 | certificates |
| 231 | GET | /certificates/items | user | Y (auto-creates 8 defaults, admin) | certificates_items | certificates, dashboard |
| 232 | PUT | /certificates/items/:idOrKey | user | Y | certificates_items | certificates |
| 233 | POST | /certificates/items/:idOrKey/upload | user | Y | certificates_items (file_b64 or R2) | certificates |
| 234–235 | GET | /pharmacy-calc/patients, /pharmacy-calc/records | user (no role check) | Y | pharmacy_calc_* | pharmacycalc |
| 236 | POST | /pharmacy-calc/records | user | Y | pharmacy_calc_patients, records | pharmacycalc |
| 237–238 | GET/DELETE | /pharmacy-calc/records/:id | user | Y | pharmacy_calc_records | pharmacycalc |
| 239 | GET | /creditnotes/list | user | Y | credit_notes, purchases, notes | creditnotes |
| 240 | POST | /creditnotes/entries | user | Y | credit_notes | creditnotes |
| 241–242 | PUT/DELETE | /creditnotes/entries/:id | user | Y | credit_notes (+children) | creditnotes |
| 243–244 | POST / DELETE :pid | /creditnotes/entries/:id/purchases | user | Y / **O** (7649) | credit_note_purchases | creditnotes |
| 245–246 | POST / DELETE :nid | /creditnotes/entries/:id/notes | user | Y / **O** (7677) | credit_note_notes | creditnotes |
| 247–250 | GET,POST / PUT,DELETE :id | /client-deliveries/entries | user | Y | client_deliveries | deliveries |
| 251–252 | GET/POST | /loyalty/campaigns | user | Y | loyalty_campaigns | loyalty |
| 253–254 | PUT/DELETE | /loyalty/campaigns/:id | user / admin | Y | loyalty_campaigns | loyalty |
| 255–256 | GET/POST | /loyalty/clients | user | Y | loyalty_clients | loyalty |
| 257 | DELETE | /loyalty/clients/:idcard | admin | Y | loyalty_clients, loyalty_transactions | loyalty |
| 258–259 | GET/POST | /loyalty/items | user | Y | loyalty_items | loyalty |
| 260–261 | GET/POST | /loyalty/transactions | user | Y | loyalty_transactions, clients, items | loyalty |
| 262–265 | GET,POST / PUT,DELETE :id | /shifts/staff | user (**no role check**) | Y | shift_staff (+assignments, leaves cascade) | shifts, dashboard |
| 266–267 | GET/POST | /shifts/assignments | user | Y | shift_assignments | shifts, dashboard |
| 268 | GET | /shifts/assignments-range | user | Y | shift_assignments | shifts |
| 269 | POST | /shifts/apply-pattern | user | Y | shift_assignments (DELETE range + insert) | shifts |
| 270–271 | PUT/DELETE | /shifts/assignments/:id | user | Y | shift_assignments | shifts |
| 272–273 | GET/POST | /shifts/leaves | user | Y | shift_leaves | shifts, dashboard |
| 274–275 | POST | /shifts/leaves/:id/approve\|reject | user (**anyone**) | Y | shift_leaves | shifts |
| 276–277 | GET/PUT | /shifts/opening-hours | user | Y | shift_opening_hours | shifts, dashboard |
| 278–279 | GET/PUT | /shifts/settings | user | Y | shift_settings, shift_calendar_tokens | shifts, dashboard |
| 280–282 | GET/POST/DELETE | /emergency-pos/catalog | user (no role check) | Y (`all_org`, `fallback_org` → **X**, 18017) | pos_products, pos_catalog_meta | emergencypos, cherubino-* |
| 283 | POST | /emergency-pos/sales/sync | user | Y | pos_sales (idempotent by offline_id) | emergencypos |
| 284–285 | GET/POST | /emergency-pos/sales | user | Y | pos_sales | emergencypos |
| 286 | DELETE | /emergency-pos/sales/:id (void) | user | Y | pos_sales | emergencypos |
| 287 | GET | /audit/log | admin | O | audit_log, users | audit |
| 288–289 | GET/POST | /board/messages | user (no role check) | X (`all`) / O | board_messages, board_mentions, board_suggestions, board_user_state | messageboard |
| 290 | PUT | /board/messages/:id/pin | user | **X (any message)** 15021 | board_messages | messageboard |
| 291 | DELETE | /board/messages/:id | user | own only | board_messages, mentions | messageboard |
| 292 | GET | /board/mentions | user | user | board_mentions | **none** |
| 293 | PUT | /board/mentions/read | user | user | board_mentions | **none** |
| 294 | GET | /board/suggestions/export | SU | X | board_suggestions | messageboard |
| 295–296 | GET/POST | /board/suggestions | user | **X** (list is global, 15088) | board_suggestions | messageboard |
| 297–298 | PUT/DELETE | /board/suggestions/:id | owner or SU | X | board_suggestions | messageboard |
| 299–300 | GET/POST | /board/suggestions/:id/comments | user / SU | X | board_suggestion_comments | messageboard |
| 301 | GET | /board/users/search | user | **X** (all users' names and locations, 15249) | users, locations, orgs | messageboard |
| 302 | GET | /board/dashboard | user | user+org | board_* | dashboard |
| 303–304 | GET/PUT | /pharmacovigilance/state | user | Y | pv_reports (replace) | pharmacovigilance |
| 305–306 | GET/PUT | /screening/state | user | Y | screening_campaigns (replace) | screening |
| 307–308 | GET/PUT | /labels/state | user | Y | label_history (replace), label_settings | labels, dashboard |
| 309 | GET | /contacts/clients/aggregated | user | Y | client_orders, tickets, deliveries, dda_sales, poct_patients (5 unbounded SELECTs) | contacts |
| 310 | GET | /contacts/:table (9 tables) | user | O (clients: Y) | contacts_* | contacts |
| 311 | POST | /contacts/:table/bulk | user | O / Y | contacts_* | contacts |
| 312 | POST | /contacts/:table | user | O / Y | contacts_* | contacts |
| 313 | DELETE | /contacts/:table/:id | user | O / Y | contacts_* | contacts |
| 314–315 | GET/POST | /cherubino/orders | user (no role check) | Y (`all_org` → O) | cherubino_orders | cherubino-orders, cherubino-admin |
| 316–317 | PUT/DELETE | /cherubino/orders/:id | user; checkbox fields need loc 600–900 | O | cherubino_orders | cherubino-orders, cherubino-admin |
| 318–319 | GET/POST | /cherubino/price-changes | user | O | cherubino_price_changes, checks | cherubino-prices |
| 320–321 | POST/DELETE | /cherubino/price-changes/:id/check | user | O | cherubino_price_checks | cherubino-prices |
| 322 | GET | /cherubino/locations | user | O | locations | cherubino-prices |
| 323 | GET | /cherubino/short-expiry | user | O | cherubino_short_expiry, orders | cherubino-shortexpiry |
| 324 | POST | /cherubino/short-expiry/upload | user (**no admin check**) | O | wipes + inserts short_expiry, deletes all orders | cherubino-shortexpiry |
| 325 | POST | /cherubino/short-expiry/order | user | O | cherubino_short_expiry_orders | cherubino-shortexpiry |
| 326 | DELETE | /cherubino/short-expiry/order/:itemId | user | O | cherubino_short_expiry_orders | cherubino-shortexpiry |
| 327–328 | GET/POST | /cherubino/oos | user | O | cherubino_oos | cherubino-oos |
| 329–330 | PUT/DELETE | /cherubino/oos/:id | user; actions gated by loc ≥ 600 | O | cherubino_oos | cherubino-oos |
| 331 | GET | /admin/pharmacy-overview | loc 600–900 | O | 11 aggregate queries across registers | admin-overview |
| 332 | OPTIONS | * | public | – | – | browser |
| 333 | * | anything else | – | – | 404 JSON (16823) | – |

Dead / external routes (no UI caller): #2–6, #8–20 (SU page is served by the worker itself at 211–666), #21 external calendar clients, #22 external patient page, #50 `/eod/lock`, #104, #133, #164–165, #181–182, #202, #215, #221, #292–293, plus the `/api/appointments/*` aliases. No reference to "Master Universal" or "GoDaddy" exists anywhere in the worker.

---

## 3. Schema

Core tables **not created by the worker** (must pre-exist in D1; no migration source in repo): `orgs`, `locations`, `users` (cols used: id, org_id, email, full_name, role, pass_salt_b64, pass_hash_b64, pass_iters, is_active, default_location_id, created_at), `sessions` (id, user_id, token_hash_b64, expires_at, created_at), `audit_log` (org_id, user_id, action, entity_type, entity_id, details_json, created_at — **no location_id**), `temperature_devices`, `temperature_entries` (UNIQUE(org_id, location_id, device_id, entry_date) implied by the ON CONFLICT at 1670), `sync_jobs` (written at 1685, 1724, never read — dead queue), `cleaning_entries`, `instructions_global` (ON CONFLICT(org_id, location_id) 10700), `instructions_daily` (ON CONFLICT(org_id, location_id, ymd) 10832). Whether `users.email` is UNIQUE could not be determined (SU checks by query, 787).

**80 named tables created with `CREATE TABLE IF NOT EXISTS`** inside the worker (79 module tables plus the ad-hoc `recover_attempts`, 1163), plus 9 `contacts_*` tables generated from `CONTACTS_TABLES` (18519–18530) and the 11 pre-existing core tables above — roughly 100 tables in all. 127 `CREATE INDEX` statements, 47 `ALTER TABLE ADD COLUMN` migrations wrapped in try/catch. Only **19 UNIQUE constraints** exist (list at the end of this section).

| Table (line) | Key columns | UNIQUE / indexes | location_id | created_by / updated_by / updated_at |
|---|---|---|---|---|
| end_of_day (1451) | eod_date, time_of_day, staff_name, float_amount, x_json, epos_json, cheques_json, paid_outs_json, cash_json, bov_deposit_json, bov_bag_number, bov_contact_id, notes, saved_at, locked_at | UNIQUE(org,loc,eod_date); idx org,loc,date | Y | Y / Y / Y |
| end_of_day_contacts (1451) | display_name, phone, email, is_active | UNIQUE(org,loc,display_name) | Y | Y/Y/Y |
| client_orders_entries (1906) | order_date, client_*, items_text, priority, needed_by, pickup_date, deposit_amount, fulfilled(_at), follow_up_status, order_code | 4 idx; 9 ALTERs | Y | Y / **no** / Y |
| quotation_entries (1985) | supplier, barcode, stock_code, item_description, qty_*, vat_rate, cost_*, discount_*, total_incl_vat, retail_price, profit(_margin), quote_date | idx org,loc,date | Y | Y / no / Y |
| order_diary_entries (2193) | order_date, item_name, qty, supplier, status, carried_from_id | idx | Y | Y / no / Y |
| order_diary_items (2210) | item_name, preferred_supplier, last_used, use_count | UNIQUE(org,item_name) | **no** (org) | no/no/no |
| supplier_products (2387) | supplier_name, stock_code, barcode, description, cost/vat/discount/qty/batch/expiry/retail/profit, out_of_stock | 2 idx; **no UNIQUE on barcode/stock_code** | Y | Y / no / Y |
| supplier_stock_changes (2416) | supplier_location_id, change_type, seen_by (JSON array) | idx org,created | supplier_location_id | no |
| supplier_orders (2429) | pharmacy_location_id, supplier_location_id, status, notes, supplier_notes, scheduled_delivery_date | 2 idx | two loc cols | Y / no / Y |
| supplier_order_items (2445) | order_id, product_id, qty_requested/confirmed, cost, unavailable, batch, expiry_date, qty_free, discounts | idx order_id | **no org/loc** | no |
| supplier_inventory_settings (2462) | settings_json | PK(org,loc) | Y | – / Y / Y |
| supplier_cart_drafts (2471) | cart_json | PK(org,loc) | Y | – / Y / Y |
| supplier_order_item_feedback (2487) | order_item_id, problem_type, notes, resolution_status, supplier_notes, resolved_at/by | 2 idx | two loc cols, **no org_id** | Y / no / no |
| near_expiry_entries (3290) | product_name, expiry_date, location, notes, return_id, return_status, scarce_stock_offer_id | 2 idx; 3 ALTERs | Y | Y/Y/Y |
| client_tickets_entries (3687) | ticket_id (client-generated), open_date, client_name, phone, email, category, priority, status, issue, assigned_to, followup_date, notes_log (JSON), resolved(_at) | 5 idx; **ticket_id not UNIQUE** | Y | Y / no / Y |
| paid_out_entries (4458) | entry_date, entry_time, payee_name, fee, payment_method, invoice_no, cheque_no, reason | 2 idx; PRAGMA-based migration | Y | Y/Y/Y |
| locum_register_entries (5466) | entry_date, time_in/out, locum_full_name, registration_number | 2 idx | Y | Y / no / Y |
| locum_receipts (5699) | receipt_date, hours, locum_full_name, registration_number, day_type, fee_per_hour, total_fee | 3 idx | Y | Y / no / Y |
| daily_register_entries (6027) | entry_date, client_name, client_id, medicine_name_dose, posology, prescriber_name, prescriber_reg_no | 2 idx | Y | Y / no / Y |
| repeat_prescription_entries (6374) | + expires_date | 3 idx; PRAGMA + data backfill UPDATE **every request** (6404) | Y | Y / no / Y |
| alerts_entries (6657) | entry_date, alert_type, status, item_name, batch, expiry, quantity, reason, storage_location, supplier, 7 flags | 1 idx | Y | Y/Y/Y |
| returns_entries (6880) | entry_date, description, expiry, batch, quantity, supplier, invoice_number, remarks, location_stored, 4 flags, near_expiry_id, supplier_refused, damaged | 1 idx; 3 ALTERs | Y | Y/Y/Y |
| client_deliveries (7190) | delivery_id (client text), dates, client_*, delivery_method, priority, status, signature flags, items (JSON), delivery_log (JSON) | 3 idx | Y | Y/Y/Y |
| credit_notes (7462) / credit_note_purchases (7484) / credit_note_notes (7498) | amount, expiry_date, no_expiry / amount, receipt_number / text | idx | Y | Y/Y/Y ; children Y/no/no |
| dda_sales_entries (7689) | entry_date, client_name, client_id_card, client_address, medicine_name_dose, quantity, doctor_name, doctor_reg_no, prescription_serial_no, urgent | 3 idx; PRAGMA + UPDATE every request (7710–7718) | Y | Y / no / Y |
| dda_poyc_entries (8381) | same minus urgent | 3 idx | Y | Y / no / Y |
| dda_purchases_entries (8789) | entry_date, dda_name_dose, quantity, agent, invoice_number | 3 idx | Y | Y / no / Y |
| dda_stocktakes (9109) / dda_stocktake_items (9110) | closed_at / item_name, dosage, qty_tablets | 2 idx | Y | Y/no/Y ; no/no/Y |
| certificates_items (9359) | item_key, title, interval_months, last_date, certified_person, file_name/mime/size, file_r2_key, **file_b64 (whole file in D1 when no R2)** | UNIQUE(org,loc,item_key) | Y | Y/Y/Y |
| poct_patients (10045) / poct_records (10069) | patient_id, name, phone, age, address, patient_json / record_id, test_type, ~40 typed result cols, results_json, record_json | UNIQUE(org,loc,patient_id) / (org,loc,record_id); 7 idx | Y | Y/Y/Y |
| scarce_stock_offers (10848) / offer_requests (10865) / needs (10878) / need_offers (10894) | item_name, batch, expiry_date, quantity_available, is_closed, near_expiry_id, placed_on_returns(_id), transfer_item_id / requester_org/loc, quantity_requested / … / accepted, confirmed | 8 idx; 6 ALTERs | Y (requests: requester_* only) | Y/Y/Y |
| stock_transfer_items (11845) / stock_transfer_requests (11868) | item_description, batch, expiry_date, quantity_available, is_closed, close_reason, source_module/id, placed_on_* / item_id, requester_*, quantity_requested, status | 5 idx | Y / requester_* | Y/Y/Y |
| vaccines_catalog (12356) / vaccines_orders (12377) / vaccines_order_items (12397) / vaccines_stock (12412) | brand_name… / client_first/last, phone, email / vaccine_name, qty / vaccine_name, qty, batch, expiry_date | 6 idx; **no UNIQUE** | Y (catalog org 0 = global) | **none** of created_by/updated_by/updated_at except stock.updated_at |
| pharmacy_calc_patients (12785) / pharmacy_calc_records (12797) | patient_name, id_card / start_date, calc_type, calc_data_json | UNIQUE(org,loc,id_card) | Y | no / records created_by only |
| shift_staff (12905) / shift_assignments (12933) / shift_leaves (12949) / shift_opening_hours (12970) / shift_settings (12981) / shift_calendar_tokens (12993) | … patterns_json / staff_id, shift_date, start/end / leave_type, dates, status, reviewed_by / hours_json / settings_json / token | UNIQUE(org,loc) ×3, UNIQUE(token); 3 idx; **no UNIQUE(staff_id, shift_date)** | Y | created_by only (no updated_by) |
| appt_doctors (13612) / appt_clinics (13627) / appt_schedules (13643) / appt_appointments (13668) / appt_waitlist (13698) | … / appt_ref, patient_token (4 chars), patient_*, doctor_id, clinic_id, date, time, duration_mins, status, fees, medicines / wl_ref … | 14 idx; **patient_token not UNIQUE**, appt_ref not UNIQUE | Y | created_by only |
| board_messages (14820) / board_mentions (14840) / board_suggestions (14850) / board_user_state (14864) / board_suggestion_comments (14869) | body, scope, is_pinned / mentioned_user_id, is_read / title, priority, status / last_read_id / body | idx | messages Y; suggestions org only; others none | user_id only |
| loyalty_campaigns (16856, TEXT id) / loyalty_clients (16897) / loyalty_items (16914) / loyalty_transactions (16931) | type, stamp_target, points…, tiers_json / id_card, name / description, use_count / client_id_card, campaign_id, items_json, total, stamps/points_awarded | UNIQUE(org,loc,id_card), (org,loc,description); 5 idx | Y | campaigns: created_by/updated_at; txns created_by only |
| cherubino_orders (17443) / cherubino_price_changes (17575) / cherubino_price_checks (17588) / cherubino_short_expiry (17686) / cherubino_short_expiry_orders (17699) / cherubino_oos (17817) | … | UNIQUE idx (price_change_id, location_id), (item_id, location_id) | orders Y; price_changes loc; short_expiry **org only**; oos org only | created_by only, no updated_by |
| pos_products (17943) / pos_sales (17969) / pos_catalog_meta (17997) | barcode, name, price, vat_rate / sale_date, receipt_no, items_json, totals, payment_method, offline_id, voided* / last_upload_at | UNIQUE(org,loc,name); partial UNIQUE barcode; partial UNIQUE offline_id | Y | sales created_by, voided_by; products none |
| pv_reports (18232) / screening_campaigns (18314) / label_history (18396) / label_settings (18408) | report_json / campaign_json / label_json / settings_json | UNIQUE(org,loc,<id>) | Y | Y/Y/Y |
| contacts_* ×9 (18537) | name, phone… (clients: id_card, address, alt_phone) | idx org | only `contacts_clients` | Y/Y/Y |

UNIQUE constraints (all 19): 1451 ×2, 2217, 9382, 10063, 10122, 12793, 12977, 12988, 13001–13002, 16905, 16922, 17956, 18004, 18242, 18324, 18406, 18415, plus unique indexes at 17599, 17710, 17958, 17962, 17995.

**Where `ensure*Schema` runs and what it costs.** Every handler begins with `await ensureXSchema(env)` (e.g. 2052, 2235, 2523, 3336, 4098, 4522, 7803, 10289, 11024, 11909, 12444, 13016, 17027). Only three use an isolate-level memo flag: appointments (`apptSchemaEnsured`, 13605/13753), board (`_boardSchemaReady`, 14814) and contacts (`_contactsSchemaReady`, 18532). All others re-run their full DDL on **every request**, sequentially (each `await dbRun` is a D1 round-trip):

- `ensureSupplierProductsSchema` (2386–2519): 8 CREATE TABLE + 10 CREATE INDEX + 11 ALTER (each ALTER throws "duplicate column" and is caught) ≈ 29 round-trips before the real query. Called by all 23 supplier-products/orders routes.
- `ensureScarceStockSchema` (10847–10928): 4 + 8 + 6 ALTER ≈ 18.
- `ensureClientOrdersSchema` (1903–1981): 1 + 4 + 9 ALTER = 14.
- `ensureShiftsSchema` (12903–13013): 6 tables + PRAGMA + 3 idx ≈ 10; dashboard calls 7 shifts endpoints in parallel → ~70.
- `ensurePaidOutSchema` (4453–4498): CREATE + `PRAGMA table_info` + 2 idx.
- `ensureRepeatPrescriptionsSchema` (6371–6411): CREATE + PRAGMA + **data `UPDATE … SET expires_date` on every call (6404)** + 3 idx.
- `ensureDdaSalesSchema` (7686–7739): CREATE + PRAGMA + **`UPDATE dda_sales_entries SET urgent=0 WHERE urgent IS NULL` on every call (7718)** + 3 idx.
- `ensurePoctSchema` (10041–10134): 2 tables + 7 idx = 9.
- `ensureCertificatesSchema` + `ensureDefaultCertificatesIfMissing` (9354–9514): 2 DDL + COUNT on every list/update/upload/download.

Estimated for one dashboard load (26 requests, see §7): ~200 DDL statements and ~35 deliberately failing ALTERs, plus 78 auth queries, before any business data is read.

---

## 4. Static UI serving

`handleUiAsset` (9948–10031):
- Path `/ui/<rel>` → `https://raw.githubusercontent.com/{UI_GITHUB_OWNER|johnagius}/{UI_GITHUB_REPO|eikon-ui}/{branch|main}/{dir|ui}/<rel>` (9930–9938). Traversal is "sanitised" by collapsing `..` sequences to `.` (9937), not by normalising the path.
- `product-template.csv` is synthesised in-worker (9955–9972).
- Cache: `caches.default.match(request)` keyed on the **full request URL including query string** (9977–9982); on miss fetches GitHub with `Cache-Control: no-cache`, strips BOM/NUL/U+2028/U+2029 from `.js` (9940–9946, 9998–10008), sets `Cache-Control: public, max-age=${UI_CACHE_SECONDS|300}` and `Access-Control-Allow-Origin: *`, then `cache.put` (10027). No ETag, no `Last-Modified`, no compression handled in code (Cloudflare edge may gzip/brotli transparently; not verifiable from source). Any 4xx/5xx from GitHub → plain 404 (9995).
- **Cache-busting query:** `ui/index.html:27–30` appends `?v=<Date.now()>` to app.css, core.js, help-content.js and all ~50 module scripts (`ui/index.html:79–127`, loaded strictly sequentially with `async=false`). Because the timestamp changes on every page load: (a) the **browser can never reuse a cached module file**, (b) the **Worker's Cache API never hits either** (different URL each time), so every page load performs ~52 sequential origin fetches to raw.githubusercontent.com (≈3.4 MB of JS; `modules.appointments.js` 217 KB, `shifts` 173 KB, `poct` 169 KB, `dashboard` 148 KB, `pharmacycalc` 129 KB). `E.VERSION` (`ui/core.js:10`) is only used for the logo/GIF URLs. Cloud deploys of the UI are implicitly "live" (any push to `main` is served within seconds, uncacheable and unversioned); there is no rollback pin other than `UI_GITHUB_BRANCH`.
- SheetJS is loaded from `cdn.sheetjs.com` without SRI (`ui/index.html:121`).

---

## 5. Scheduled / background work

- **No `scheduled()` handler, no cron, no Queues, no `ctx.waitUntil`.** All "background" work is piggy-backed on user GETs:
  - Board: `boardCleanupOldMessages` deletes unpinned messages older than 6 months, throttled to once per 5 min **per isolate** (14882–14892) — runs inside `GET /board/messages`.
  - Scarce stock: `GET /scarce-stock/offers` closes the caller's expired offers, deletes/closes linked transfer items and inserts near-expiry rows (11028–11099) — a read that performs up to ~10 writes per expired offer, racing with other PCs.
  - Stock transfers: `GET /stock-transfers/items` auto-closes expired items and deletes linked scarce-stock offers (11915–11935).
  - DDA sales: `GET /dda-sales/client` rewrites historical `client_id_card` values (7884–7892).
  - Recovery rate-limit table is pruned on each recovery POST (1165).
- **Retention:** nothing else is ever purged — sessions, audit_log, sync_jobs, supplier_stock_changes (listed with LIMIT 200 but never deleted), recover_attempts grow forever.
- **Email / SMS / WhatsApp:** none in the worker. Any sending (e.g. appointment tokens, EOD deposit contacts with phone/email at 1451) must happen client-side or manually; `end_of_day_contacts.email` and `appt_appointments.patient_email` are stored but unused server-side.
- **Backups:** none in code; relies entirely on Cloudflare D1 point-in-time recovery (not configurable here) and R2 durability for certificate files. `sync_jobs` rows are written (1685, 1724) but no consumer exists.
- **External dependencies:** GitHub raw (UI delivery, single point of failure for the whole front end: GitHub outage = blank app after cache TTL), R2 (optional; absent → certificates stored as base64 in D1 up to `CERT_UPLOAD_MAX_BYTES` 800 kB, 9752–9781), ChatGPT redirect (15330).

---

## 6. Concurrency and data integrity

**No transactions anywhere.** `grep BEGIN|batch(` finds none (the only comment, 10383, says BEGIN/COMMIT was avoided). D1 `batch()` is never used. Every multi-statement write is a sequence of independent auto-commits; a failure (or isolate eviction) mid-way leaves partial state:
- Supplier bulk import: `DELETE FROM supplier_products` then N inserts (2712–2748) — a failure after the delete wipes the supplier's catalogue; concurrent importers interleave.
- POS catalog upload with `wipe` (18073) then chunked POSTs — same pattern; emergency POS catalog is empty between chunks.
- Cherubino short-expiry upload with `wipe` also deletes every location's orders (17749–17751).
- EOD contacts bulk save: deactivate all, then re-activate/insert (4364–4384).
- Shift `apply-pattern` overwrite: DELETE range then inserts (13245–13258).
- POCT/PV/screening/labels `PUT /state` are **authoritative replaces**: upsert every record then delete every record not in the payload (10333–10641, 18261–18311, 18343–18393, 18453–18528). Two PCs with different local state overwrite each other's additions; a client that loaded stale state and saves will **delete** the other PC's new patients/records. This is the single biggest multi-PC data-loss vector.
- Scarce-stock / transfer / returns / near-expiry cross-links are maintained by hand (e.g. 5049–5062, 7087–7126, 11336–11349) with no FK and no transaction.

**Last-write-wins everywhere.** No row carries a version/ETag and no UPDATE checks `updated_at` (e.g. end_of_day 4238–4284, client orders 3588–3630, appointments 14463–14478, deliveries 7398–7424). Full-row PUTs (most handlers rebuild every column from the body, e.g. 5318–5336, 7363–7396) mean PC-B's save erases PC-A's concurrent edit of a different field. EOD stores five JSON blobs per day (x_json, epos_json, cheques_json, paid_outs_json, cash_json) and replaces them wholesale (4256–4266).

**UNIQUE conflicts.** Handled via `ON CONFLICT` upserts: temperature entries (1670), order_diary_items (2224), settings/cart/opening-hours/calendar tokens, certificates defaults (9497), POCT/PV/screening/labels, loyalty clients/items, pos_products by name (18094), price checks (17660), short-expiry orders (17795). **Unhandled** (would surface as a 500 "Worker threw exception"): EOD create race — two PCs creating the same `eod_date` (SELECT at 4136 then INSERT at 4221 violates UNIQUE(org,loc,eod_date)); end_of_day_contacts create duplicate name (4350); SU account creation (806); pharmacy_calc patient upsert is fine but record insert is not atomic with it (12855–12868). Appointments: `patient_token` uniqueness is checked with SELECT-then-INSERT (14366–14370) and only one retry; `appt_ref` client-supplied is never checked (14346, 14378). Double-booking check (14350–14362) is SELECT-then-INSERT, so two PCs booking the same slot within the same ~50 ms both succeed; it also compares `status!='cancelled'` while statuses are stored capitalised (`Cancelled`, 13864), so cancelled appointments still block slots.

**Lock / unlock semantics.**
- EOD: `locked_at` set by upsert with `locked_at` present (4113–4121) or `/eod/lock` (4299). While locked, normal updates return 409 (4191). **Any user can unlock** by sending `locked_at: ""`/`null`, `unlock:true` or `action:"UNLOCK"` (4142–4150) — no admin requirement, though it is audited `EOD_UNLOCK` (4166). Lock is not enforced on `paid_out_entries` for that date, nor on the EOD contacts.
- DDA stocktake `closed_at` can be reopened by anyone (9180–9188); items can still be added/edited after close (9204–9286 never check `closed_at`).
- Locum receipts edit/delete require the hard-coded `!4321` header (5813, 5883).
- Supplier orders: status transitions are free-form (any of pending/confirmed/shipped/received, by either party, 3175–3181); no monotonic state machine.
- Stock transfer requests have a proper state machine (pending→accepted→dispatched→delivered, 12177–12265); scarce stock does not.

**Soft vs hard deletes.** Soft: end_of_day_contacts (`is_active`), temperature_devices (`active`), shift_staff (`is_active`), pos_sales (`voided`), pos_products (`is_active`), cherubino_oos (status). Everything else is a **hard DELETE** including legal registers: dda_sales (8235), dda_poyc (8657), dda_purchases (8994), daily_register (6250), repeat_prescriptions (6633), locum_register (5641), locum_receipts (5898), paid_out (4785), returns (7152), alerts (6868), appointments (14503), POCT records (10588–10597, by omission from the payload). SU "wipe location" and "force delete org" hard-delete every table with a `location_id` column, including audit-relevant registers, with no backup step (707–755, 950–960); `audit_log` has no location_id so it survives — but is also never written for these SU actions.

**Audit coverage.** `writeAudit` is called 188 times; `audit_log` records org_id, user_id, action, entity_type, entity_id, details_json — **no location_id, no before-image, no request/IP, no session id** (1010–1018). Written synchronously after the data write; a failure in `writeAudit` throws after the data has already changed (no compensation). Not audited at all (full list from a per-handler scan): quotations update (2129), **all supplier product CRUD and stock-status changes** (2542–2690), stock-change seen (2842), inventory settings, cart drafts, order-item feedback create/resolve, supplier order item unavailable, supplier order status update (3157), **client order update** (3476), **client ticket update** (3892), EOD contacts bulk PUT (audited inside helper), credit-note purchases/notes add/delete (7625–7684), **POCT state PUT** (10333 — the clinical records module), instructions global/daily PUT (10679, 10789), pharmacy-calc create/delete (12837, 12874), shift assignment update (13142), opening hours / settings PUT, every board write, loyalty client/item upsert, cherubino price check/uncheck, short-expiry orders, all SU endpoints (668–968), failed logins, logout (none exists). `GET /audit/log` (14722–14815) is org-wide, admin-only, filterable by a hard-coded 9-module map (14735–14745) so most entity types are reachable only by exact `entity_type` string.

---

## 7. Performance

- **Per-request fixed cost:** 3 auth queries (1034–1066) + the module's `ensure*Schema` DDL (see §3) + the business query + `writeAudit` insert. A simple `POST /paid-out/entries` is ≈ 3 + 4 + 1 + 1 + 1 (re-read) = 10 sequential D1 round-trips.
- **Dashboard load** (`ui/modules.dashboard.js:1229–1449`) fires ~26 API calls (temperature ×2, daily register, paid out, instructions ×2, cleaning, certificates, alerts, near-expiry, returns, client orders, tickets, scarce needs, stock transfers, board, supplier changes, supplier orders sent, shifts ×7, labels ×1–3). Most are month-scoped but several are unbounded: `/near-expiry/entries` (4866), `/certificates/items`, `/stock-transfers/items` org-wide with all requests (11938–11960), `/scarce-stock/needs` across **all orgs** (11436), `/labels/state` (full history JSON), `/supplier-products/changes` (LIMIT 200), `/shifts/staff?include_inactive=1`. Two of them perform writes as side effects (scarce offers, stock transfers). With the schema cost this is on the order of 300–350 D1 statements per dashboard open, repeated each time the user navigates back to the dashboard.
- **Polling:** core polls `/supplier-orders/feedback` and `/supplier-orders/received` every 30 s for supplier roles (`ui/core.js:1180–1196`), appointments refreshes doctors/clinics/schedules/appointments/waitlist every 30 s (`ui/modules.appointments.js:852`), message board every 30 s (`ui/modules.messageboard.js:580`), scarce stock every 30 s (`ui/modules.scarcestock.js:279` — which triggers the auto-expiry writes each tick), supplier dashboard every 30 s, cherubino modules on 1 s UI timers plus periodic fetches. No ETag/If-Modified-Since or delta endpoints exist except board `?after=`.
- **N+1 and unbounded SELECTs:** `handleSuTablesWithLocationId` runs `PRAGMA table_info` per table (934–948). Supplier orders list uses two correlated subqueries per row (3030–3032). `contacts/clients/aggregated` runs five full-table scans and dedups in JS (16702–16720). `handleAdminPharmacyOverview` runs a per-pharmacy `SELECT closed_at` loop (18866–18874). Quotations (2057–2087), supplier products list (2522–2540) and supplier inventory (2790–2821) `SELECT *` without LIMIT and filter `q` **in JavaScript**. POCT `GET /state` returns every record and patient JSON blob (10283–10331). Near expiry, alerts, deliveries (LIMIT 2000), credit notes (LIMIT 1000 + all children), appointments list default LIMIT 500 (14279). Audit log runs the query plus a COUNT (14790–14812).
- **Large JSON blobs in TEXT:** end_of_day (5 blobs), poct_records.record_json + results_json (duplicating ~40 typed columns), poct_patients.patient_json, pv_reports.report_json, screening_campaigns.campaign_json, label_history.label_json, label_settings, shift_staff.patterns_json, shift_settings/opening_hours, supplier_cart_drafts.cart_json, loyalty tiers_json/items_json, pos_sales.items_json, client_tickets.notes_log, client_deliveries.items/delivery_log, instructions_*.data_json/handover_json, supplier_stock_changes.seen_by (read-modify-write array, 2848–2855), and `certificates_items.file_b64` (entire PDF/image in a D1 row when R2 is unbound, 9777).
- **Missing indexes for common WHEREs:** `sessions.token_hash_b64` (looked up on every request, not created here — unknown), `audit_log(org_id, created_at)` / `(org_id, entity_type)` (unknown), `supplier_order_item_feedback(pharmacy_location_id)`, `supplier_stock_changes(created_at)` alone, `scarce_stock_offers(expiry_date, is_closed)`, `stock_transfer_items(expiry_date)`, `appt_appointments(org,loc,date,doctor_id,clinic_id,time)` for the overlap check (uses `idx_appt_appts_doctor_date` partially), `board_mentions(message_id)` exists but `board_messages(user_id)` does not, `vaccines_stock` by expiry, `pos_sales(created_by)`, `shift_assignments(staff_id, shift_date)` (apply-pattern deletes by it, 13251). Quotation/supplier text search uses `LIKE '%q%'` → full scans by design.
- **Response sizes:** each module GET returns full rows for the whole month/location; POCT and labels return the entire history. UI bundle ≈ 3.4 MB uncached JS on every load (see §4).

---

## 8. Reliability and security risks (ranked)

1. **Public token leak in the iCal endpoint** — `GET /shifts/ical?token=x&debug=1` (or `Accept: application/json`) with an unknown token returns `tokenTableSample`: the 20 most recent **valid calendar tokens with their org/location ids**, plus a sample of other locations' `shift_settings` JSON (13498–13505). Anyone on the internet can then pull every pharmacy's staff roster (names, designations, shift times) at 13520–13529. Unauthenticated, no rate limit.
2. **No logout / no server-side revocation of 30-day tokens** (1401; `ui/core.js:1199–1211`). Shared pharmacy PCs keep live Bearer tokens in `localStorage` (`ui/core.js:242`) that remain valid for 30 days after "Logout" or a browser close; nothing purges expired sessions.
3. **Authoritative-replace sync endpoints lose data across PCs** — POCT (10333–10641), pharmacovigilance (18261), screening (18343), labels (18453): the last PC to save deletes every record it did not know about. POCT holds patient clinical results and is not audited (§6).
4. **Hard-coded second-factor passwords in source and UI** — `"Report1234!"`, `"!4321"` (5662–5663; `ui/modules.locumreceipts.js:929, 1057, 1094`), transmitted as custom headers and allowed by CORS (98).
5. **Legal registers are hard-deleted and silently rewritten.** DDA sales/POYC/purchases, daily register, repeat prescriptions, locum register, paid-outs and returns are physically deleted (8235, 8657, 8994, 6250, 6633, 5641, 4785, 7152); `GET /dda-sales/client` and DDA create/update bulk-rewrite historical `client_id_card` values with no audit (7884–7892, 8043–8052, 8131–8140); SU wipe/force-delete erases every register for a location without an export (707–755, 950–960). Audit rows lack before-images, so nothing can be reconstructed.
6. **Role model is broken:** `requireRole(["admin","staff"])` vs. actual roles `admin|user` (779, 848, 1020) forces every pharmacy login to be `admin`, nullifying all admin-only guards; capability tiers (pharmacy / supplier / company admin) are inferred from `location_id` ranges on both server (17528, 17857, 18712) and client (`ui/core.js:347–366`); the superuser email is hard-coded in the client (`ui/core.js:349`).
7. **No transactions / no optimistic concurrency** anywhere (§6): delete-then-insert imports (2712, 18073, 17749, 13251), SELECT-then-INSERT uniqueness checks (4136→4221, 14350→14373), full-row last-write-wins PUTs, and GET endpoints that perform cascading writes (11028–11099, 11915–11935).
8. **Cross-tenant data exposure by design or accident:** `/supplier-products/inventory` and `/changes` with `WHERE 1=1` (2795, 2829); `/scarce-stock/offers|needs` list every org's items (11148, 11436); `/board/users/search` lists all users across orgs (15249); `/board/suggestions` global (15088); any user can pin any message (15021); POS catalog `fallback_org`/`fallback_location` lets a user read another org's catalogue (18017–18033); `/su/api/users/:id` returns password salt and hash to the SU page (825–833); error responses include `e.message` for every exception (16839) and the stack when `DEBUG_STACK=1`.
9. **Login has no brute-force protection** (1367–1433) and recovery's limiter is keyed only by the *target* email (1160–1172); recovery page confirms account existence (1198) and can reset **any** account, including superusers, with the static `BOOTSTRAP_TOKEN` (compared non-constant-time, 1304, 1176).
10. **Per-request DDL and data-mutating "migrations"** (§3): ~200 DDL round-trips per dashboard load; `UPDATE repeat_prescription_entries … SET expires_date` (6404) and `UPDATE dda_sales_entries SET urgent=0` (7718) run on every request; failing `ALTER TABLE` calls are swallowed by `catch {}` (e.g. 1968–1970, 2503–2517, 10921–10927), which also hides genuine schema errors.
11. **Single point of failure for UI delivery:** every page load fetches ~52 files from `raw.githubusercontent.com` with a timestamp cache-buster (`ui/index.html:27–30`), so GitHub rate-limits/outages break the app; no version pinning, no SRI, third-party SheetJS CDN.
12. **SQL built with string interpolation** (all with internal identifiers or validated numbers, so not injectable today but fragile): table names in SU wipe (`DELETE FROM ${t}`, 736, 957; `PRAGMA table_info(${name})`, 942), `queryRegister(${tableName})` (18832), contacts `${def.db}`/`${col}` (18537–18705), `addColIfMissing(${colDefSql})` (4486), `RATE_WINDOW_SECONDS` interpolated (1165), dynamic `IN (${placeholders})` lists. Client-controlled values do go through `.bind` everywhere I checked.
13. **Input validation gaps:** `readJson` accepts any content type and logs body previews (970–990); request bodies have no size limit (POCT/labels accept arbitrary arrays; bulk endpoints cap at 500–5000 rows but each row is unbounded text); `appt_ref`, `ticket_id`, `delivery_id`, `offline_id`, loyalty campaign `id` are client-generated identifiers stored verbatim (14346, 3842, 7278, 18147, 17045); dates in several modules are validated by regex only (no calendar validity); `status` on supplier orders and deliveries is free text (3175, 7290); `Number()`/`parseInt` coercions silently turn garbage into `0`/`1` (e.g. 2103–2106, 13039).
14. **Swallowed failures:** `try {} catch {}` around session deletes (890, 897, 1232), recovery rate-limit (1173), vaccine stock deduction (12660–12668 — order saved, stock not decremented, no signal), aggregated contacts (16702–16720), admin overview (18771 et seq.), `writeAudit` in recovery; dead `sync_jobs` writes (1685, 1724) give the false impression of an outbox. Several handlers reference an undefined `entryId` inside `if (isDebugEnabled(...))` (1567, 4415, 4431, 6848, 9199, 9685, 9812…) which throws a `ReferenceError` whenever `X-Eikon-Debug: 1` is sent.
15. **Operational:** no `wrangler.toml` in repo (bindings, D1 id, R2 bucket, secrets undocumented); `WORKER_VERSION` manual; `console.log` of request bodies, tokens prefixes and PII (e.g. 13033–13035, 13440, 13452); CORS `Origin` absent → allowed (87).

---

## 9. What the rebuild must keep server-side

**Rules enforced only in the browser today that must move to the worker:**
- Portal/capability selection by `location_id` range and superuser email (`ui/core.js:347–366, 349`); module visibility per role; "admin-only" UI actions in cherubino/supplier modules (grep shows 17 client-side `location_id` range checks in `ui/modules.cherubino-*.js`).
- Locum receipts edit/report passwords (`ui/modules.locumreceipts.js:929–1112`) — replace with a real per-user permission.
- Client-generated identifiers (ticket `TKT-xxxxx`, delivery ids, appointment refs/tokens, loyalty campaign ids, POS `offline_id`) and derived fields (EOD totals, profit/VAT maths in quotations/supplier products are computed server-side already at 2020–2049, but EOD cash reconciliation, paid-out totals, temperature out-of-range flags, certificate due dates, stock-take totals are client-side).
- POCT/PV/screening/labels merge logic (the client decides what the authoritative set is).
- Dashboard "what is overdue today" computations (temperature per device per day, cleaning per day, daily register per day) — currently recomputed in the browser from month dumps.
- Polling cadence and offline queues (emergency POS offline sales, `ui/modules.emergencypos.js`) — idempotency currently exists only for POS (`offline_id`).

**Rules the worker already enforces that the new UI must not bypass or re-implement differently:**
- org_id/location_id always come from the session (1069–1077); never send them in bodies.
- EOD lock → 409 on update (4191), unlock path and audit (4142–4166); one EOD row per (org, location, date) (1451).
- Temperature entry upsert key (org, loc, device, date) (1670) and device-belongs-and-active check (1601).
- Appointments: admin-only doctors/clinics/schedules (13925…), overlap check (14350), 4-char uppercase token format (14367), status whitelist (13860–13868).
- Stock-transfer request state machine and quantity checks (12129–12265); scarce-stock owner/requester checks (11257, 11360); need-offer accept (need owner) / confirm (offerer) (11709–11767).
- Supplier orders: pharmacy may create/feedback, supplier may confirm/resolve/unavailable; visibility limited to the two parties (3078–3082, 3094, 3196–3203).
- Cherubino: checkbox fields only by company-admin locations (17527–17531); OOS action matrix (17867–17912); 2-week date window (17463–17470).
- Locum receipts: hours ≤ 24, fee ≥ 0, total computed server-side (5770–5782).
- Quotation/supplier product profit maths and VAT whitelist {0, 5, 18} (2014–2049).
- Paid-out: fee > 0, HH:MM time, cheque number cleared for cash (4613–4625).
- DDA registers: all fields mandatory, quantity ≥ 1, Maltese ID normalisation (7769–7797, 8051–8060).
- Repeat prescriptions default expiry = entry + 6 months (6501).
- Credit notes: amount > 0, expiry XOR no_expiry (7563–7568).
- Board: 2000-char limit, 30 pinned max, delete own only, superuser-only comments/export (14964–14966, 15027–15031, 15045, 15175).
- Audit log admin-only and org-scoped (14723, 14748).
- Certificates: interval 1–240 months, default 8 items per location (9631–9636, 9410–9494).

---

## 10. Fit-for-purpose: a shared Master Universal patient book on this worker

**Could this worker host per-licence patient/booking/event data for several PCs in one pharmacy?** Not as it stands; the primitives it would need are mostly absent, and the parts that exist (POCT, appointments) demonstrate the failure mode rather than the solution.

**What exists and is reusable.**
- Tenancy: `orgs` → `locations` → `users`, with every request bound to one (org, location) from the session (1069–1077). A "licence" could map to a location.
- Bearer sessions with hashed tokens (1034–1049) and PBKDF2 passwords; a superuser allowlist and an SU admin API for provisioning (668–968).
- An append-only `audit_log` (1010–1018) that could be the seed of an event log if it gained `location_id`, a per-location sequence number, and payloads.
- Working examples of idempotent writes keyed on a client id: POS sales `offline_id` with a partial UNIQUE index and a `/sales/sync` batch (17995, 18184–18229); POCT/PV upserts keyed on (org, loc, client_id) (10063, 10122, 18242); board cursor pagination `?after=id` (14901–14925) as a delta-read pattern; appointments `patient_token` lookup as a patient-facing read (14668).
- Patient-identity helpers: Maltese ID normalisation (7769–7797, 16965–16972); patient tables already exist in three places (poct_patients, loyalty_clients, pharmacy_calc_patients, contacts_clients, plus denormalised names in dda_*, appt_*, client_orders, tickets, deliveries, credit_notes) — i.e. **there is no single patient entity**.

**What is missing for a shared patient book.**
1. **An event log with ordering.** No table stores per-location monotonically increasing sequence numbers or vector clocks; `audit_log` has no location_id and no sequence; `updated_at` is second-resolution `datetime('now')`. Delta sync (`GET /events?since=seq`) cannot be built on current tables.
2. **Idempotency as a rule, not an exception.** Only POS sales carry a client write id. Every other create is a plain INSERT, every update is last-write-wins without a version check; replaying a request from a flaky PC duplicates the row.
3. **Atomic multi-row writes.** No `env.DB.batch()` and no transactions; a booking that writes patient + appointment + event must be atomic.
4. **Conflict detection.** No `If-Match`/version columns; the only concurrency control is UNIQUE constraints (19 in 80 tables).
5. **Encrypted blobs.** Nothing is encrypted at the application layer; D1 is encrypted at rest by Cloudflare but PII (ID cards, addresses, clinical results in `poct_records`, `pv_reports.report_json`) is stored in clear and dumped in full by `GET /state`. A per-licence key, envelope encryption in the worker, and an opaque-blob column would all be new.
6. **Patient identity and merge.** A canonical `patients` table with (org, location, id_card) uniqueness, merge/alias handling and search exists nowhere; the DDA "lookup" currently mutates history to coalesce IDs (7884).
7. **Session hygiene.** Logout/revocation, device registration (which PC wrote this), short-lived tokens with refresh, and failed-login throttling are all absent.
8. **Background processing.** No cron for compaction/retention, no queue for outbound notifications, no backup/export job.
9. **Observability.** No request ids on persisted rows, no structured logs beyond `console.log`, no metrics.

**Verdict.** The worker is a fine-grained CRUD façade over D1 with manual tenancy, not a sync substrate. Hosting a multi-PC patient book would require, at minimum, a new `patient_events` table (org, location/licence, seq, device_id, client_event_id UNIQUE, entity, entity_id, op, payload_cipher, created_at), `env.DB.batch()` for every write, `?since=seq` delta reads, version/ETag checks on PUT, a canonical patients table, application-level encryption, and a real session lifecycle. Those are additive (the existing modules can stay), but they should be built as a separate router module with its own middleware (auth → tenancy → idempotency → batch) rather than extending the if-chain at 15299–16823.
