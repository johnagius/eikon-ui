# Eikon Bookings: the appointment system, redesigned

One generic system that any pharmacy can switch on in a minute and that fits
every kind of appointment a pharmacy runs: a visiting doctor's clinic, a flu jab,
a blood-pressure check, a weight-loss review, an ear-piercing slot. It is simple
for the counter, versatile underneath, and safe to expose to customers.

## What is wrong today (from reading the code, 2 Nov 2026)

- Booking is one modal with about 8 fields and 4 dependent dropdowns (doctor,
  then clinic, then session date, then time). It's built around one shape:
  visiting doctors in clinics.
- The screen re-downloads up to 5,000 bookings every 30 seconds.
- A cancelled booking kept blocking its slot on the server ('Cancelled' vs
  'cancelled'). **Fixed and tested, waiting to deploy.**
- Double-booking is guarded only by a check-then-insert, with no database guard.
- The unauthenticated lookup used a 4-character code, wasn't rate-limited and
  returned staff notes. **Hardened and tested, waiting to deploy.**
- Fees are never defaulted, so printed totals depend on manual entry.
- The waiting list loses details when promoted to a booking.
- Nothing is ever sent to the customer: no confirmation, no reminder, no
  calendar file.

Lessons kept from the `appt` repo:
- Compute slots from rules instead of storing them.
- Use a partial unique index as the final guard against double-booking.
- Claim a reminder in the database before sending it, so it's never sent twice.
- Try Resend, then fall back to Brevo.
- Send the server's time with responses, so tablets with drifting clocks still
  show the right slots.

Mistakes not repeated:
- Links that never expire.
- Public endpoints without rate limits.
- Reschedule as cancel-then-insert, which can leave a person with nothing.
- A hard-coded sender address.

## The model: three ideas only

1. **Services.** What can be booked: name, length, buffer after, price, colour,
   and who can do it. Examples: "Flu vaccine, 10 min, €0, any pharmacist" or
   "Dr Galea clinic, 15 min, €25, Dr Galea, Room 2".
2. **People and places.** Who provides the service and where: a pharmacist, a
   visiting doctor, a nurse, a consultation room. Each has weekly hours plus
   exceptions (holidays, a day off, an extra evening).
3. **Bookings.** A person and a service at a time, with one of six states:
   booked, confirmed, arrived, done, no-show or cancelled. History is never
   deleted; a reschedule moves the same booking in one transaction.

Free slots are computed: the provider's hours, minus existing bookings, minus
buffers and exceptions. The database enforces "one booking per provider per
start time while active" with a partial unique index, so a race returns a clean
"just taken, here are the next three" instead of a double booking.

## The counter: booking in three taps

1. **What:** pick a service. The most-booked ones come first.
2. **When:** the next free times show straight away ("Today 15:30 · 15:45 ·
   Tomorrow 09:00"), with a calendar for anything later.
3. **Who:** type a name, ID card or phone. It finds the person in Customers or
   creates them. Their phone and email fill in automatically.

The booking is confirmed on screen. If the pharmacy has messaging switched on,
the customer gets a confirmation with a calendar file.

The day view is a single column per provider, with no settings in sight. Tap a
booking for: Arrived, Done, No-show, Move, Cancel (with reason). Today's
bookings also appear on Today ("Next: Carmen Grech, flu vaccine, 15:30").

The waiting list is a person plus a service plus "any time this week". When a
slot frees up, Eikon suggests the first person waiting, and promoting them
carries every detail.

## Customers: optional messaging

Switched off by default. In Settings, the pharmacy chooses how to send:

| Option | What it needs | Notes |
|---|---|---|
| Off | nothing | Staff can still copy a WhatsApp message or print a card |
| Resend | an API key and a verified sender domain | Recommended: simplest and reliable |
| Brevo | an API key | Also offers SMS in many countries |
| SMTP | host, port, user and password | For pharmacies with their own mail server; sent from the worker over TCP sockets |

- **Keys:** each pharmacy's keys are stored encrypted in its own settings, never
  in the code. There's a "Send me a test" button.
- **Messages:**
  - confirmation (with an `.ics` calendar file)
  - reminder the evening before (18:00, local time) and optionally 2 hours before
  - change notice
  - cancellation notice
- **Message wording:** short and plain, with the pharmacy's name and address.
  English and Maltese templates, editable.
- **Reliability:** each reminder is claimed in the database before it's sent, so
  a retry never duplicates it. Failures show on Today ("2 reminders failed: check
  the email key").
- **Opt-out:** customers can opt out with one link. Messages are only sent with
  consent, which is recorded on the person.

## Customers: their own booking page, safely

Every message carries one link: `/b/<id>`.

- **Unguessable:** `<id>` is 128 random bits plus a versioned signature with an
  expiry (7 days after the appointment). It can't be guessed or enumerated, and
  it belongs to exactly one booking.
- **Shows the minimum:** first name, service, date and time, pharmacy name,
  address and phone, and a map link. Never staff notes, ID card, other bookings
  or prices beyond the service price.
- **Actions:** Add to calendar, Cancel, Move (within the pharmacy's rules, e.g.
  "up to 2 hours before"). Every change is shown to staff on Today, logged and
  confirmed by message.
- **Hardened:**
  - rate-limited per network
  - `noindex` and no referrer
  - no login, and no account to steal
  - expired or used links show "This link has expired, call us on …"
- **Optional public booking page** (off by default): `/book/<pharmacy>` with the
  services the pharmacy marks as bookable online. A person's details are
  confirmed by a 6-digit email code before the slot is held, so bots can't fill
  the diary.

## Speed and cost

- The day and week views fetch one date range (`?from&to`), about 30–200 rows,
  instead of 5,000.
- No 30-second full reload. Changes come as a small "since version N" call every
  60 seconds while the screen is open, and stop when it's hidden.
- Free slots for a service and date come from one indexed query.

## Migration

The existing data maps cleanly:
- each doctor becomes a provider
- each clinic becomes a place
- each recurring schedule becomes weekly hours
- each one-off session becomes an extra
- each appointment becomes a booking (status names normalised)
- waiting-list entries are kept

The old tables are read, never rewritten, until the new screens have been in use
for a month.

## Build order

1. Worker: services, providers, hours, bookings, the free-slot query and the
   unique guard, with tests (races, buffers, DST, cancelled slots).
2. Counter UI: day view, the three-tap booking and the booking sheet (Eikon Next
   design), checked on iPhone and desktop.
3. Messaging: providers, templates, reminders cron, test button, failure surfacing.
4. Customer link page, with security tests (guessing, expiry, rate limits, no
   leaks).
5. Optional public booking page.
6. Migration of existing appointments.
