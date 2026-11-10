# Eikon sellability scorecard (read-only audit, 2026-11-10)

The question: "How far off are we from a very polished sellable complete system?"

Scope: S/live at 64301fc (UI .176, worker batch-14 `5434019e`). The roster planner (S/agents/RP) is counted as in progress.
Method: I read LOOP.md (rounds 84–158), DEPLOY-WORKER.md, QUALITY-BAR.md, the R/R2/M/V/T/T2/RP boards and VISUAL files, the
worker (`cloudflare-worker/code`, 1.41 MB, one file) and `ui/`. I also ran a local walkthrough on the seeded real stack
(port 9091, now stopped), signed in as maria (admin, a busy pharmacy), staff (staff role) and other@demo.mt (an empty pharmacy).
I took 390 px and 1440 px shots with an axe run on each: `S/agents/AUDIT/shots/{a,b,e,s}-*.png` plus `*-report.json`.
Nothing was edited, pushed or deployed, and no live server was contacted.

Key: scores are 1–5. **C** = completeness for its job, **P** = polish against QUALITY-BAR, **K** = consistency with the rest.
Some items are marked "read, not seen". I found those by reading code and did not see them on screen.

---

## A. Product

### A1. Menu areas

| Area | C | P | K | Concrete gaps, rough edges |
|---|---|---|---|---|
| **Today** | 5 | 5 | 4 | The best screen. Checks inline, customers waiting, bookings, money and team cards (a-today-dk-light.png). On an empty pharmacy it shows a 3-step "Getting this pharmacy ready" list: fridges, people, hours (e-today-ph-light). On a phone it is long, 2,389 px with seed data. The first-run list has no "pharmacy details" step (address, licence or reg. no., logo for prints). |
| **Customers** | 4 | 4 | 4 | A customer record with the story, allergies, how they like to hear from us and Tell the customer. "Loyalty (classic look)" is a chip that drops into a dark classic screen. There is **no way to delete or anonymise a person, and no "everything we hold on this person" export** (the worker has no DELETE /people/:id; there is only merge, at code:17397). That is a GDPR gap, see B. Maltese name folding is done (batch-6). |
| **Bookings** (staff) | 5 | 4 | 4 | A full appointment system: services, people, rooms, hours, waiting list, move with "tell the customer", reminders by cron, senders with fallback. Setup on an empty pharmacy is one form (e-bookings-ph-light). The legacy Appointments screen is still reachable ("old-appts", modules.bookings.js:1161). No deposits or online payment, which is fine for Malta now. |
| **Public booking page** (/book/…, /b/…) | 4 | 4 | 4 | Accessible (rounds 88–90), email code, self-reschedule link, stop link in the emails. **No privacy notice or controller identity on the page** where a member of the public types name, email and phone (no "privacy" string anywhere in the worker). |
| **Stock** | 3 | 4 | 4 | Calm hub: To order / On order / Short or at risk. **There are no stock levels or product catalogue.** "Stock" is an order diary plus recalls, near expiry, shortages, returns and transfers. A buyer who expects stock control will be disappointed: say so in the pitch. **axe: 26 × `aria-expanded="null"`** on the order rows (button[data-k="order:115:0"], a-report.json, light, both widths). That contradicts "axe 0 everywhere". The UI test "Short or at risk" fails on base (rounds 157–158). The Price group puts supplier quotations next to credit notes. |
| **Registers** | 5 | 4 | 5 | The strongest department. Today's registers, CD by medicine with "count it now", inspection pack with sign-off, records download. Open from R/R2 VISUAL: D13 placeholders cut short on phone, empty-state buttons 34 px tall on POYC and stock take, "0 registers of 5 signed off" wording. Deleting a line and certificate scans still go to the classic screen. |
| **Services** | 4 | 3 | 3 | POCT, vaccinations given (new table), screening, PV, OCP, calculators, OTC, labels. **Visual QA blockers I1 and I2 still look open (read, not seen):** overdue vaccine doses are status "todo" (amber) on Today's services but red on Vaccines (eikon.svctoday.js:92–93), and "And 3 more doses due" is still there (I4 wording, :95). Vaccine stock, batches and expiry stay classic-only (vaxreg footnote). Recording a vaccination does not reduce stock (John's call). The MPA form, PV delete and print are classic-only. |
| **Money** | 4 | 4 | 4 | Today's money, End of day in steps, paid out, emergency till with an offline queue, credit notes, locum receipts. Classic-only: date-range report, bank contacts, EOD audit log. There is no customer-quotation screen (decided). |
| **Team** | 4 | 4 | 4 | Who's in, handover with Got it, chat board (cost fixed in batch-14), plan shifts with swaps, sign-ins. **The roster planner is mid-build:** Visual QA found 4 blockers on B2 (dark-mode contrast 2.24:1, phone month labels 8.3 px), and B5 web push is not merged. Until RP lands, shift patterns, opening hours, leave balances, details and the calendar link are classic-only (shfreg.js:278). |
| **Owner's view** (How we're doing) | 4 | 4 | 4 | Takings against last period, what needs you, CD totals, month-end. Staff get a clean "Only the pharmacist in charge…" message (s-ownreg). It covers one pharmacy only. The chain view is the classic Company Dashboard. |
| **Settings** | 2 | 3 | 3 | Thin for a product people pay for. There is **no pharmacy profile** (name, address, licence no., VAT, logo; label details live in the classic Labels screen). There is no plan or billing, no "export everything", no close-account option and no notification settings. Staff see an "Audit trail" card that returns 403 (the worker gates it to admin, code:15734). "Classic layout" and "Old dashboard" are still offered as Help items. |

### A2. Screens still sending users to "classic"

**Wholly classic: these 13 screens never got the new look.** Each opens in the old dark sidebar layout, with emoji, ALL CAPS stat labels and its own styles (a-loyalty-ph-light.png, a-dashboard-ph-light.png).

- **Loyalty & Campaigns** (customer-facing, 92 KB)
- **Old dashboard**
- **Legacy Appointments**
- **Supplier portal**: Supplier Dashboard, Product List, Received Orders, Order Feedback
- **Company admin / head office**: Company Dashboard, Pharmacy Overview
- **Five Cherubino-only modules**, hard-coded to org 12: Orders, Admin, Price Changes, Short Expiry, OOS

The Cherubino modules are bespoke code for one customer inside the product. They need to be productised or kept out of other tenants' bundles.

**Rebuilt screens with a "…is in the classic screen" footnote: 31 files.** Taken from the `data-act="classic"` links. The functions most likely to annoy a paying user:

- **Deleting a line or record:** alerts, credit notes, CD stock-take lines, returns, scarce stock, transfers, PV reports, saved calculator plans
- **Vaccine stock, batches and expiry** (vaxreg)
- **Emergency till:** camera scanning, photo search, product list, day's receipts (eposreg)
- **Shift work:** patterns, opening hours, leave balances (shfreg, until RP lands)
- **Label templates and pharmacy details** (lblreg)
- **Certificate scans** (certreg)
- **Delivery drivers and batches** (dlvreg)
- **Price-list import and merge** (qtreg)
- **MPA PDF form** (pvreg)
- **Contacts import/export** (conreg)
- **End of day date-range report and bank contacts** (eodreg)
- **POCT patient list, CSV import and export** (pocreg)
- **Another day's handover** (hndreg)

**Classic bleed-through, seen once.** After a classic screen, moving to a new screen by address kept the classic frame, and axe then flagged contrast 2.6:1 on `.shf-btn` (a-shfreg-*). Opened fresh, shfreg was clean (b-shfreg-*). This is an edge case, but it shows the two layouts share one page.

### A3. Cross-cutting

| Topic | Score | Evidence and gaps |
|---|---|---|
| Phone experience | 4 | No sideways scroll at 390 on any screen walked. There is a bottom bar with a "More" door in Settings, and 44 px targets were swept (round 146). Classic screens are not phone-grade. |
| Onboarding / first day | 3 | Today's "Getting this pharmacy ready" list (3 steps) and the Bookings one-form setup are good. **But the account itself has to be created by John** in the superuser page `/su` (code:205–700) or by `/bootstrap`. There is no self-signup, no welcome email, no import step, and no pharmacy details or prints setup. |
| Empty states | 4 | Helpful, each with one next step (e-* shots: Stock "Nothing to order. Items added … come here", Money, Team "Add today's shifts in Plan shifts"). |
| Error handling | 4 | E.saveFailText, typing kept through Reload and session end (round 150), error reports to /client-log. Raw D1 errors reaching staff were fixed in BACKLOG6. |
| Offline | 3 | An honest "offline" strip, saves that never left are kept, and the emergency till has its own queue. **There is no service worker** (no `serviceWorker` in ui/), so the app does not open at all without a connection. |
| Accessibility | 4 | axe WCAG A/AA was swept every round on new screens, light and dark. **This audit found the Stock hub's 26 violations live.** Classic screens are not swept. The app-wide h1 focus box and the 30 px "?" are still open (V Decisions 4). |
| Wording | 4 | Sentence case, plain words, the same terms across screens. Leftovers: "And 3 more doses due" (svctoday:95), "0 registers of 5 signed off", the mixed €1264.00 / €1,264.00 noted in M VISUAL. |
| **Malti** | 2 | The UI is English only. Maltese appears in dispensing-label phrases (lblreg/labels: "Darba kuljum", "Kull 12-il siegħa" …) and in Tell the customer messages. The code itself says the Maltese lines "want a native speaker's read before they go live" (eikon.tell.js:66). The classic Labels language dropdown never prints Maltese (LOOP round 109–110 note). CSV product import mangles Maltese letters (Ħelu → Ä¦elu, LOOP round 132). **A native speaker must review it.** |
| Performance | 4 | Live Today ~0.9–1.1 s (round 106). The chat board went from 15k rows read to 91 (batch-14). Lists draw 30 rows at a time. Isolate cold start plus schema marks give an occasional 2.6 s first Bookings call. The UI ships 10.2 MB in total, including a 3.5 MB world map HTML (vaccines) and the tesseract vendor files, but those load on demand. |
| Cost hot spots | 4 | The cron runs every 10 minutes across all pharmacies. One D1 holds all tenants (10 GB per-DB ceiling; SCALE-2 modelled 20 pharmacies × 5 years at ~2M rows, fine). Watch the audit_log growth and whole-state PUTs (POCT and PV state blobs). |
| Tests / flakiness | 4 | Worker 280/0, UI 498–499/499, real ~84 cases, rehearsals and predeploy 10/10. Known flakes: "focus: today after Log" (base), solo-q61keep timing, solo-dailytoday ordering, POCT scoped order, Stock "Short or at risk" failing on base. |
| Release process | 2 | **The UI is served live from `raw.githubusercontent.com/johnagius/eikon-ui/main/ui/*`** (code:10739, buildGithubRawUrl). A push to main is a production release with no staging tenant. A GitHub outage or rate limit breaks every uncached file, and the 300 s cache hides problems. The worker is one 24k-line file that is hand-deployed. |

### A4. Security and isolation (from reading)

- **Repo appears public.** Pharmacies fetch the UI from GitHub raw without a token, so the repo must be public. That makes the whole worker source and the design notes world-readable, which is bad for IP and makes an attacker's job easier. Move the UI to Workers static assets or R2 and make the repo private.
- **A cross-site script attack could take a 30-day session.** The session is a bearer token in localStorage (core.js:750) that lasts 30 days (code:1642). The CSP is still **report-only** (code:10894), and the UI writes 717 `innerHTML` assignments. Any XSS would steal a session that lasts a month. Enforce the CSP, shorten sessions or use an HttpOnly cookie, and lean on the idle lock.
- **Weak account security.** There is no two-factor sign-in and no self-service "forgot password"; the admin resets passwords. PBKDF2 runs at 100k iterations, the Workers cap but below OWASP's current 600k. Sign-in throttling exists: 10 tries per email and 50 per IP in 15 minutes (code:1541).
- **Leftover non-product route:** `/go/gpt-extractor` redirects to a ChatGPT GPT (code:18403). Remove it.
- **Tenant isolation is enforced in code only.** It relies on `org_id`/`location_id` in each query: 242 `requireRole` calls, and `isolation.test.mjs` plus the board leak fix are tested. That is fine for now, but it needs a pen test. There are only two pharmacy roles in practice (admin, staff), plus supplier and company_admin.
- **Open for John:** scarce-stock *needs* are visible to every pharmacy on Eikon (round 150).
- **Shared headers:** `X-Eikon-Report-Pass` / `X-Eikon-Edit-Pass` exist (CORS list, code:103), which suggests shared passwords for some actions. Review them.

---

## B. Commercial readiness

| Expectation | Status | Evidence |
|---|---|---|
| Terms of service | **Missing** | No ToS anywhere in the worker or UI. |
| Privacy policy (staff app + public booking page) | **Missing** | "privacy" occurs only in help text about PV initials. |
| GDPR DPA (Eikon as processor of health data, a special category) | **Missing** | Also needed: a sub-processor list (Cloudflare, Resend/Brevo, GitHub for UI delivery, Google if calendar links are used) and a DPIA. |
| Data location | **Unknown** | wrangler.toml sets no D1 jurisdiction. Confirm the database was created with EU jurisdiction or location, or migrate it. |
| Data export (whole pharmacy) | **Partial** | Settings › Download our records covers 15 registers as XLSX or CSV (UI .132). It leaves out customers, bookings, messages, money and team. |
| Data-subject access / erasure (one person) | **Missing** | There is no person delete, anonymise or export. Email opt-outs do exist (bk_optout, cust_msg_optout). |
| Retention schedule | **Missing** | Nothing is purged except sessions, login attempts and the 6-month board. Registers that must be kept for years and customer data that should expire need a written schedule (lawyer and MPA). |
| Controlled-drug / MPA records | **Good, needs sign-off** | DDA purchases, sales, POYC, stock takes, CD ledger, inspection pack with sign-off lines, corrections with an audit reason, months that can't silently change. These need **a review by a pharmacist or MPA inspector** that the prints match the legal register format. |
| Audit trail | **Exists** | Full before/after audit (batch-2), Settings › Audit trail (admin), superuser actions audited (suAudit). |
| Roles / rights clarity | **Partial** | Admin vs staff with an idle lock. There is no written rights matrix and no pharmacist / assistant / locum role distinction beyond the rota. Staff see cards that then refuse them (Audit trail). |
| Self-signup and onboarding | **Missing** | Accounts are created by hand in `/su` or `/bootstrap` (BOOTSTRAP_TOKEN). There is an in-app first-day checklist (Today). |
| Data import from other systems | **Weak** | Covered: supplier product CSV (Maltese bug), contacts import (classic), old Appointments → Bookings, POCT CSV (classic). Missing: no import for customers or patients, past DDA registers, or another vendor's export. |
| Billing / subscriptions | **Missing** | No Stripe and no plan concept. |
| Pricing page / marketing site | **Missing** | eikonhq.com opens the app. There is a GoDaddy embed loader (`godaddy/`) but no product site. |
| Support channel | **Missing** | No support email, chat or "report a problem" in the UI. Error reports go to /client-log silently. |
| Uptime / monitoring | **Missing** | There is /health, but no uptime monitor, status page or alerting is described. Depends on Cloudflare + GitHub raw. |
| Backups / restore | **Partial** | D1 Time Travel (30 days); restore points are recorded per deploy in DEPLOY-WORKER.md, and the upgrade and rollback rehearsals are good. There is no off-platform nightly export (R2 or another provider) and no tested restore of a single tenant. |
| Security review / pen test | **Missing** | Internal tests only. |
| Documentation / help | **Good** | In-app Help & guides per screen (help-next.js, help-content.js 107 KB), What's new feed. There are no admin, onboarding or setup documents for a buyer. |
| Multi-pharmacy chains | **Partial** | Groups with per-pharmacy isolation, stock transfers, a company-admin portal and supplier portal, but all classic. There is no group-level owner view in the new layout and no per-chain billing. |
| Single-customer code | **Risk** | Cherubino modules are hard-coded to org 12, and the 91 "cherubino" references in the worker ship to every tenant. |

---

## C. Ranked gap list

Impact: **B** = blocker for selling, **I** = important, **N** = nice. Effort is in agent-days: S ≤1, M 2–5, L 6–15.

| # | Gap | Impact | Effort | Who acts |
|---|---|---|---|---|
| 1 | ToS, privacy policy (app + public booking page), DPA, sub-processor list, DPIA, retention schedule | B | M (drafts) | **Lawyer** + John; agents wire the links and a consent line |
| 2 | Confirm the D1 data location is in the EU, and record Cloudflare's DPA | B | S | **John** (Cloudflare dashboard); migrate if not EU (M, agents) |
| 3 | Security hardening: private repo, UI served from Workers assets or R2 (not GitHub raw), CSP enforced, shorter or HttpOnly sessions, 2FA for admins, remove /go/gpt-extractor, review Report/Edit-Pass | B | M–L | Agents; John says yes to each worker change |
| 4 | Staging tenant and release gate (no direct push-to-prod), off-platform nightly backup and a tested restore of one pharmacy | B | M | Agents + John |
| 5 | Person-level erase / anonymise and access export; whole-pharmacy export (customers, bookings, money, team) | B | M | Agents (worker + UI), lawyer on rules |
| 6 | External pen test of tenant isolation, auth and public pages | B | — (1–2 wk calendar) | **Outside firm**, John pays |
| 7 | Self-signup or a sales-led "create pharmacy" flow, welcome email, first-day wizard (pharmacy details, people, fridges, hours, print header) | B | L | Agents; John decides self-serve vs. invite |
| 8 | Billing: Stripe subscriptions, plans, trial, invoices with VAT, lock on non-payment | B | M–L | Agents + **Stripe** account (John) |
| 9 | Marketing site with pricing, demo booking and contact; a support channel inside the app | B | M | Agents + John (prices, words) |
| 10 | MPA / controlled-drug print review by a pharmacist or inspector; Maltese text review | B | S (agents) | **Pharmacist / MPA contact**, **native Maltese speaker** |
| 11 | Finish the roster planner (4 Visual QA blockers, B5 push, classic footnote gone) | I | M | Agents (in progress) |
| 12 | Rebuild or retire the 13 wholly-classic screens: Loyalty, supplier portal, head-office portal, old dashboard, legacy Appointments; move Cherubino out of the shared bundle | I | L | Agents; John decides keep / retire |
| 13 | Close the "…in the classic screen" footnotes: delete actions first, then vaccine stock, label templates and pharmacy details, EPOS scanning, certificate scans | I | L | Agents |
| 14 | Settings › Pharmacy profile; hide cards that refuse the role (staff Audit trail) | I | S–M | Agents |
| 15 | Data import: customers and patients CSV, past DDA registers; fix the Maltese CSV encoding | I | M | Agents |
| 16 | Uptime monitor, status page and alerting on /client-log spikes | I | S | Agents + John (account) |
| 17 | Services I1 / I2 (overdue colour, dose counts) and the Stock hub's 26 axe violations | I | S | Agents |
| 18 | Group (chain) owner view in the new layout | I | M | Agents |
| 19 | Positioning: Eikon is not a POS or stock-control system; say what it replaces and what it sits beside | I | S | John |
| 20 | Service worker so the app opens offline (read-only today) | N | M | Agents |
| 21 | Flaky tests (focus, q61keep, dailytoday ordering, Stock base failure) | N | S | Agents |
| 22 | Malti user interface (beyond labels and messages) | N | L | Agents + native speaker |
| 23 | Split the 24k-line worker into modules (maintainability, review cost) | N | L | Agents |

---

## D. Honest overall estimate

**Product: about 75%** of "polished, complete" for what Eikon is: a compliance and operations companion for Maltese pharmacies.

- **The finished departments:** Today, Registers, Bookings, Customers, Money and Team are genuinely good, better than most SMB pharmacy tools on clarity. They are tested far beyond normal for a product this size.
- **The 25% left:** about 13 screens still in the old look (one of them customer-facing: Loyalty), and about 31 rebuilt screens that hand some functions back to classic. Add a thin Settings, the roster planner still being built, Services and Stock open items, and no offline start.
- **One scope warning:** there are no stock levels and no POS. A buyer expecting a full pharmacy management system will see Stock as incomplete.

**Commercial readiness: about 15%.**

- **What exists:** the audit trail, CD records with inspection prints, rollback and upgrade rehearsals with D1 restore points, in-app help, and per-pharmacy isolation with tests.
- **What is missing entirely:** legal documents, a DPA, signup, billing, a marketing or pricing site, a support channel, monitoring, off-platform backups, a pen test and per-person GDPR tools.
- **What is a risk:** the UI is served from a public GitHub repo, the CSP is report-only, and sessions are tokens in localStorage.

### The path to "polished, sellable"

The phases overlap where the owners differ.

1. **Weeks 0–2: protect and decide.** Agents and John.
   - Security hardening (#3), staging and backups (#4), EU data-location check (#2).
   - Finish the roster planner (#11).
   - John decides: positioning (#19), self-serve or invite (#7), which classic screens to retire (#12).
   - Brief a lawyer now, because legal has the longest lead time.
2. **Weeks 2–6: close the product gaps.** Agents.
   - GDPR tools and full export (#5), Settings › Pharmacy profile (#14), Services and Stock fixes (#17).
   - Delete actions out of classic (#13, first half), imports (#15).
   - Loyalty and portals rebuilt or hidden (#12).
   - In parallel, the lawyer drafts ToS, privacy policy, DPA and DPIA (#1), and the pharmacist / MPA and Maltese reviews run (#10).
3. **Weeks 4–8: the commercial layer.** Agents and John.
   - Onboarding wizard and account creation (#7), Stripe billing (#8), marketing site, pricing and support (#9), monitoring and status page (#16).
   - **First paid pilot possible here:** 2–3 pharmacies, onboarded by hand, legal documents signed.
4. **Weeks 8–12: prove it.** Outside parties.
   - Pen test and fixes (#6).
   - Restore drill.
   - Pilot feedback round, then the rest of the classic footnotes (#13).
5. **Weeks 12–20: polished and complete.**
   - Chain owner view (#18), offline start (#20), worker split (#23), Malti UI if wanted (#22).

**Realistic total: about 3–5 months to "polished, sellable" if decisions do not stall. A careful paid pilot is possible in 6–8 weeks.**

The critical path is the outside parties (lawyer, pen tester, MPA and Maltese reviewers) and John's decisions, not agent build time.
