# Eikon, Reimagined

A design review of the Eikon pharmacy UI, written to the same brief and in the
same form as the Master Universal review (`masteruniversal/Redesigned Patient
Manager/`). Nothing in `ui/` or the worker was changed to make this. This folder
is the brief for the coding team.

Open `Design review.html` in a browser. It holds the argument, the numbers, three
reimagined screens as live HTML mockups, the 3-action table, the kill list, the
bridge to Master Universal and the module map.

## What is in here

| Path | What it is |
|---|---|
| `Design review.html` | The full written review with the mockups embedded. |
| `prototype/` | The three reimagined screens as PNG, 1110×680 at 2×: Today, one Customer, a Register. |
| `img/` | Real renders of the current build (served locally against an empty demo pharmacy) and the Master Universal "Today" for comparison. |

## The thesis in one paragraph

A pharmacist opens Eikon for one of about five reasons: log the fridge, sign the
register, hand a customer their order, close the till, look something up. Today the
app answers with a 4.9-second intro, a portal picker, a rail of 50 items in seven
uppercase categories and a first screen with 77 buttons before a single record
exists. The interface is a map of the codebase: 53 modules, 53 doors. The
functionality is excellent. The design treats every feature as equally important,
so nothing is.

## The numbers (current `main`, a588e30)

| | Today | Reimagined |
|---|---|---|
| Places in the rail | 50 (1 + 7 categories + 42 modules, Inspections open) | 4 + Team + Settings |
| Buttons on the first screen, no data | 77 | 9 |
| Network requests on the first screen | 35 | one |
| Portals offered at sign-in | 3 (two greyed out) | none; you sign in, you are home |
| Intro before anything renders | 4,930 ms | 0 |
| Help | 1,953 lines, 39 chapters | one first-use hint per screen |
| Steps to log the fridge | 4 to 5 | 3 (min, max, Enter) |
| Steps to hand over a ready order | 5 to 6 | 1 |

## The four places

1. **Today** (opens first). Dashboard, the quick-entry modals, handover, alerts and
   the takings, merged into one list in the order of the morning. Registers are
   filled inline on their row. One button per row, and the button says what it
   does. The search box is the biggest thing on the screen and is how the 40
   modules that lost their rail slot are reached.
2. **Customers.** A narrow list and one person's story on the right, the same shape
   as the Master Universal patient page. Orders, deliveries, questions,
   appointments, vaccines and readings are lines in the story, not destinations.
   With a Master Universal licence the list grows a Patients chip.
3. **Stock.** One item's story: what is left, what is coming, what to send back.
   Cherubino, transfers, returns, near expiry and scarce stock are chips.
4. **Registers.** One month-as-a-book view for every legal record, chips per
   register, today's cell editable, entries save on Enter with who and when, one
   quiet "Print the month" link.

Team and Settings sit at the bottom of the rail. Supplier and company-admin users
get their own sign-in and never see a picker.

## Design tokens used in the mockups

| Token | Value |
|---|---|
| Surface / app background | `#FFFFFF` / `#F4F6F8` (dark follows the PC) |
| Ink / muted / faint | `#141B24` / `#5B6675` / `#93A0AE` |
| Accent (one) | `#1F5FD8`, soft `#E6EEFC` |
| Good / warn / bad | `#1C8A5B` / `#A06A0E` / `#BF3B2E`, each with a soft tint |
| Type | Figtree; 26px headline, 14.5px row title, 12.5px secondary, 11px uppercase labels with tracking |
| Spacing | 4px base, 24px page gutter, 12px card gap, 36px avatar, 46px search |
| Radii | 12px cards, 9px buttons and inputs, 999px pills |

## The one instruction

Build **Today** as a second entry point behind one flag, make it the opening
screen, keep the old UI one click away, and change nothing else until two
pharmacies have lived with it for two weeks. Measure seconds-to-fridge-logged,
clicks per pharmacist per day, and how often the old UI is opened. If the numbers
move, port Customers, then Registers, then Stock, one at a time. If they do not,
one screen was lost, not a product.

## Reproducing the images

The current-build renders come from serving `ui/` locally with a stub API that
returns an empty pharmacy, `?intro=0`, a pharmacy role saved in `localStorage`,
and a Playwright screenshot at 1440×900. The prototype PNGs are screenshots of the
`.winwrap` elements in `Design review.html` at device scale 2.
