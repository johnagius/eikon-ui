# Scopes: which one, why, and the text to paste

## The choice: `https://www.googleapis.com/auth/calendar.app.created`

Google describes it as: *"Make secondary Google calendars, and see, create, change, and delete events on them."*
That covers everything the feature does:

| Feature step | API call | Covered by `calendar.app.created`? |
|---|---|---|
| Create the "Eikon rota" calendar on first connect | `calendars.insert` | Yes. The app creates it, so the app can manage it |
| Add, change or remove shifts and approved leave | `events.insert` / `events.patch` / `events.delete` on that calendar | Yes |
| Disconnect, and optionally remove the calendar | `calendars.delete` on that calendar | Yes |
| Revoke access on disconnect | `https://oauth2.googleapis.com/revoke` | Needs no scope |
| Read the user's other calendars or events | none | **Cannot**, which is the point |

**Fallback, which should not be needed:** `https://www.googleapis.com/auth/calendar.events` would let Eikon see and edit events on **all** of the user's calendars.
It is broader than Eikon needs, so ask for it only if a test shows `calendar.app.created` failing. If that happens, the
justification below still applies, with the sentence about "only calendars the app created" taken out.

Build notes for the future feature, not for the form:
- Store the `calendarId` returned by `calendars.insert`. With this scope the app cannot search for the calendar later.
- If a user deletes "Eikon rota" in Google, the next write gets 404/410. Create the calendar again and save the new ID.
- Request `access_type=offline` and `prompt=consent` so a refresh token comes back. Use `include_granted_scopes=false`.

## Sensitive or restricted?

- **Not restricted.** Google's published restricted list (https://support.google.com/cloud/answer/13464325) covers Gmail, Drive and similar scopes, with **no Calendar scopes**.
  The CASA security assessment and its fees apply only to restricted scopes
  (https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), so **Eikon needs no CASA.**
- **`calendar.events`** is **sensitive**, according to the Nylas Google OAuth scopes guide
  (https://developer.nylas.com/docs/cookbook/use-cases/build/google-oauth-scopes/) and a 2026 Google forum post in which the
  console lists it under sensitive scopes. One other Nylas page calls it "restricted", but that contradicts Google's restricted list, so ignore it.
  Google's own scope table (https://developers.google.com/workspace/calendar/api/auth) is the reference. I could not open it from here.
- **`calendar.app.created`**: I could not confirm its tier. Google's scope table was unreachable from this
  sandbox, and no secondary source states it. A 2026 Google developer forum thread notes that it doesn't appear in the console's scope picker.
  **The Cloud Console labels it the moment you add it (STEPS.md, step 5).** Plan for sensitive. That means the free verification, 3–5 business days, with no assessment.
  If the console shows non-sensitive, only brand verification is needed.

---

## Paste into the form: "How will the scopes be used?" (justification)

> Eikon is a staff rota and leave management web app used by a pharmacy team at https://eikonhq.com.
> The calendar.app.created scope lets a staff member who chooses "Connect Google Calendar" receive their own
> work shifts and approved leave in their Google Calendar. When they connect, Eikon creates one secondary calendar
> named "Eikon rota" in their account and writes their shifts and approved leave into it as events. When a manager
> changes the rota or approves leave, Eikon updates or deletes the matching events in that calendar within seconds.
>
> We chose calendar.app.created because it is the narrowest scope that does this. Eikon can only see and change the calendar it
> created. It cannot read, list or modify any of the user's other calendars or events. Eikon never reads event data
> back from Google for any other purpose. The only data Eikon stores from Google is the encrypted refresh token and the ID of the
> "Eikon rota" calendar. When the user clicks "Disconnect", Eikon revokes the token with Google and deletes both values.
> Google user data is not used for advertising, is not sold, and is not shared with any third party.

(About 1,000 characters. If the form has a limit, cut the last paragraph first.)

If you also request `openid` / `userinfo.email` (non-sensitive, no justification required), add:

> openid and userinfo.email are used only to show the staff member which Google account is connected
> ("Connected as name@example.com") and to stop the same Google account being linked to two Eikon staff profiles.

## Paste into "Additional info / Notes for the reviewer"

> The Connect Google Calendar button is on the staff member's own profile page after signing in to Eikon.
> Eikon accounts are created by the pharmacy manager, so to review the flow please use this test login:
> `<<REVIEWER TEST USERNAME/PASSWORD — John to create a demo staff account with sample shifts>>`.
> The demo video shows the full flow: sign-in, the consent screen with the requested scope, the "Eikon rota"
> calendar appearing in Google Calendar, a rota change being reflected, and Disconnect.

(Create a demo staff account with fake shifts for the reviewers. Never give them a real employee's login.)

---

## Consent and in-app copy

Google writes the consent screen itself. You control only the app name ("Eikon"), the logo, the support email and the links.
Under `calendar.app.created`, Google will show roughly: *"Make secondary Google calendars, and see, create, change, and
delete events on them."*

Show this text **in Eikon, just before the button** (Google asks for disclosures that are "prominent and timely"):

**Button:** `Connect Google Calendar`

**Text next to it:**
> Add your shifts and approved leave to your own Google Calendar.
> Eikon will create a calendar called "Eikon rota" in your Google account and keep it up to date when the rota changes.
> Eikon can only see and change that one calendar, never your other calendars or events.
> You can disconnect at any time. Disconnecting deletes the access Eikon holds.
> [How we use Google data](https://eikonhq.com/privacy#google)

**When connected:**
> Connected to Google Calendar as name@example.com. Your shifts appear in the "Eikon rota" calendar.
> [Disconnect]

**Disconnect confirmation:**
> Disconnect Google Calendar?
> Eikon will stop updating your "Eikon rota" calendar and delete the access it holds.
> ☐ Also delete the "Eikon rota" calendar from my Google account
> [Cancel] [Disconnect]

**If they untick or cancel consent:**
> Google Calendar was not connected. Nothing was changed in your Google account.
