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
`tests/ui/run.mjs`; screenshot `prototype/06 Customer to order.png`. The form that
opens is still the old dark modal: that is deliberate (no new form in this step) and
it changes when Registers restyles the shared form, not before.
