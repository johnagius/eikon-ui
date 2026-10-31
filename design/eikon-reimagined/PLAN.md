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
| Customers | Done as a first cut: search across every register, adopt from history, versioned edit, story. Next: the registers read the carried person |
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
