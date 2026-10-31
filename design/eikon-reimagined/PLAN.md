# Eikon Reimagined — the plan, in one page

This is the sequence. It does not change without a line added here saying why.
Everything new lives behind `?ui=2`. Clients on the classic layout see fixes only.

## What is fixed (will not move again)

1. **The shell.** One rail: Today, Customers, Stock, Registers · Team, Settings.
   Master Universal mark, pharmacy name, your name. No top bar, no sidebar of
   fifty items, no help button glowing at the bottom. An old module opens inside
   the same shell with one way back.
2. **The screens come in this order:** Today → Customers → Registers → Stock →
   Team → Settings. Each one is finished (works, tested, screenshot in
   `prototype/`) before the next starts.
3. **Nothing is removed.** Every one of the 816 functions keeps a home
   (`FUNCTION-INVENTORY.md`). Until an area is rebuilt, its old modules are
   reached through the hub pages (Stock, Registers, Team, Settings) unchanged.
4. **Data first.** No write path changes without a test on the real worker
   against a real schema. Legacy tables are never rewritten by the new code.
5. **Master Universal is read-only** until you say otherwise. Eikon prepares the
   shared people book; the bridge is built last, on your word.

## Where we are

| Step | State |
|---|---|
| 21 live defects fixed, speed work, test harness | Done, deployed |
| Shell (rail, hubs, back link, badges) | Done, this commit |
| Today | Done. Reads one endpoint, logs fridge and cleaning inline |
| Customers | Done (step 1): search across every register, adopt from history, versioned edit, story, loyalty points, next appointment, one-tap hand-over into Orders, Questions, Deliveries, Appointments |
| Registers | Not started. Hub page lists every book today |
| Stock | Not started. Hub page lists every stock module today |
| Team, Settings | Hub pages only |
| Master Universal bridge | Not started, by design |

## The next three steps, in order

1. **Customers, finished.** Orders, Questions, Deliveries and Appointments
   pre-fill from the carried person. A New order from a customer's page is two
   taps. The customer's page shows loyalty points and the next appointment.
2. **Registers.** Temperature, Cleaning and the Daily register become one
   calm page each in the new shell: today's entry on top, the month below,
   print on the right. Append-only with visible corrections (§2.4), so an
   inspector sees a paper book. DDA registers follow, on one product list.
3. **Stock.** Near expiry, alerts, returns and supplier orders as one list of
   what needs a decision this week.

## What I will not do

- Accept a screenshot that shows the old dark styling inside the light shell.
  Every module, old or new, wears the shell it is in. (Added after I let one
  through on 31 Oct and called it deliberate. It was not acceptable.)

- Add a screen inside the old shell again.
- Change the rail, the colours, the type, or the names of the six words.
- Deploy the worker without the full suite green and a backup of the live script.
- Touch the Master Universal repository.

## How to read progress

`tests/worker/run.mjs` and `tests/ui/run.mjs` are the acceptance tests.
Screenshots of what is built live in `prototype/` numbered in build order.
`RELIABILITY-AND-SPEED.md` holds the defect list and the ten shared rules.

---

## Step briefs

Each step is written here before it is built. The brief is the acceptance test.

### Step 1 · Customers, finished

**Why.** The Customers page exists but the registers still ask for the name again.
The whole point of one identity is that nobody types "Carmen Grech" a fourth time.

**What the pharmacist sees.**
- On a customer's page: **New order**, **Question**, **Delivery**, **Appointment**.
  One tap opens that register's own form with the name, phone, address and e-mail
  already filled. The second tap is Save. The form is the existing one, unchanged,
  so nothing learnt is lost and every validation still applies.
- The customer's header shows their loyalty points when they have a card, and the
  facts row shows the next appointment when one is booked.
- Coming back from a register lands on Customers, not on the old dashboard.

**Data.** Read-only additions to `GET /people/:id`: loyalty points and stamps summed
from the loyalty transactions under the person's ID card; the next appointment that
is not cancelled, under their card or name. No write path changes. The hand-over
itself is a short-lived note in the browser (`sessionStorage`, five minutes), never
sent to the server, so a stale tab cannot pre-fill the wrong person tomorrow.

**Design rules kept.** No new form. No new modal. One accent. The four buttons are the
only actions on the page; everything else is reading.

**Done when.**
- Worker test: a person with a loyalty transaction and a future appointment gets
  `loyalty.points` and `next_appointment` in one call; a cancelled appointment is
  ignored; a stranger's appointment is not shown.
- UI test: New order from a customer opens the order form with the client name,
  phone and address filled, and nothing posted yet; the same for Question, Delivery
  and Appointment; the hand-over is cleared once used; an old hand-over (older than
  five minutes) is ignored.
- Screenshot `prototype/06 Customer to order.png`: the order form over the
  customer's page, filled.

**Built.** Worker test 6 of `people.test.mjs`; UI checks "step 1: …" in
`tests/ui/run.mjs`; screenshot `prototype/06 Customer to order.png`.

**Step 1b · the old modules wear the new shell.** The first screenshot showed the
old dark form inside the light shell. Fixed at the root rather than per screen:
about 1,400 hard-coded dark colour values across the 50 classic modules now read a
theme token with the old value as fallback (`var(--field, rgba(10,16,24,.64))`), so
the classic layout is byte-for-byte the same colour and the light shell gets light
values for surfaces, fields, lines, text, shadows, overlays and the accent, danger,
ok and warning families. Checked by screenshot in both themes for Client Orders,
Temperature, End of Day, Appointments, DDA Sales, Dashboard, Tickets, POCT, Loyalty,
Emergency POS, Chat Board and Shifts (`SHOTS=1 node tests/ui/run.mjs`). Known
leftovers: the OTC mind map keeps its own dark canvas (not touched, it draws on
canvas), and Appointments raises a "Setup needed" toast on every open when no
doctors exist; both go on the list for their own areas.

### Step 2 · Registers, part one: Temperature, Cleaning, Daily register

**Why.** These three are filled in every day and handed to an inspector. Today
they are three different screens with three different save models, prints that
differ from the screen, hard deletes by anyone, and no way to tell a reading
entered on the day from one typed a month later (`audit/E-registers.md` C2, C5).

**What the pharmacist sees.** One page per register in the new shell, laid out as
the mockup `prototype/03 Register, temperature.png`:
- Title, one chip per device (Fridge 1, Fridge 2, Room), a month switcher.
- The month as a calendar. Each day is a card: the reading, who, what time.
  A missing day is red and says "not logged · add with a note". Closed days are
  faded. Today has the two fields in the card; Enter saves that device, nothing
  else is touched.
- A footer line: limits, days logged, days missing, and **Print the month ›**.
- Cleaning uses the same calendar: a day card says "Karl 08:00–09:10 · Maria",
  today's card has Cleaner and Done now. Daily register is a list, not a calendar
  (several lines a day): month on the left, one line per supply with the seven
  statutory columns, search that also looks across months, Print the month.
- Below the calendar on Temperature: the two-month chart per device, as now.

**Data.** This step changes write rules, so it is the first one with a migration:
- `entered_at` (UTC instant) on all three tables, filled for new rows; old rows
  keep NULL and print as "entered: unknown". A reading whose `entered_at` is more
  than a day after `entry_date` shows and prints a small **late** mark.
- No more hard delete from the screen. A correction is a new row that supersedes
  the old (`superseded_by`, `correction_reason`); the old line prints struck
  through with the reason. The old `DELETE` routes keep working for the classic
  layout until it is retired, but they also write a full before-image to the audit.
- Out-of-limit readings require a note before they save. Not an extra form: the
  note field appears in the card.
- Print is rendered by the worker (`/temperature/report/html` and the two
  siblings exist already and are unused by the UI): identical on every PC,
  stamped with pharmacy, who printed, when, and never auto-closed.
- The temperature save sends only the device that was typed, never the whole day
  (fixes the cross-PC overwrite, risk 1). The offline queue is removed from these
  three screens; a failed save stays in the card, red, with Retry.

**Design rules kept.** No modal for entry. One place to type per day. The old
Devices tab becomes a small "Devices" link on the Temperature footer that opens
the existing admin form unchanged (admin only, as the server already enforces).

**What stays reachable through the hub.** The classic Temperature, Cleaning and
Daily register screens, untouched, until the new ones have run for two weeks in
one pharmacy.

**Done when.**
- Worker tests: save one device for one day without touching the others; late
  mark when entered after the day; out-of-limit without a note is 400; a
  correction supersedes and the original stays; printed HTML contains the
  struck-through line, the late mark and the print stamp; old DELETE audits the
  before-image.
- UI tests: the month renders from one request per device set; Enter in today's
  card posts one entry; a missing day opens its note; Print opens the server page;
  Cleaning and Daily register pages render and save.
- Screenshots `prototype/07 Temperature, built.png`, `08 Cleaning, built.png`,
  `09 Daily register, built.png`.

Not started. Starts on your word.
