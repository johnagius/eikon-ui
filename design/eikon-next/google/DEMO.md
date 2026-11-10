# Demo video script: "Eikon: Connect Google Calendar"

Google wants a video that "fully demonstrates how a user initiates and grants access to the requested scopes" and shows
how each scope is used in the app. Upload it to YouTube Studio as **Unlisted** and paste the link into the verification form.
(Source: https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)

**Length:** 2–4 minutes. **Narration is optional.** Captions or on-screen text are enough, and are easier to redo.
**Language:** English. **Record:** the whole browser window, including the **address bar**, at 1080p.
Desktop Chrome is easiest. Windows: `Win+Alt+R` (Xbox Game Bar) or OBS.

## Before you record

- Use a **demo staff account** with fake names and fake shifts. Show no real staff, patient or pharmacy data.
- Use a **test Google account** that has no personal events, for example a fresh Gmail.
- Set the Google account language to English, so the consent screen appears in English.
- Sign out of Google in the recording browser beforehand, so the consent screen appears in full. Alternatively, remove Eikon at
  https://myaccount.google.com/permissions first.
- The app must be on the real domain, `https://eikonhq.com`, with the OAuth client the form refers to. Don't use localhost or a staging site.

## Shots

| # | On screen | Caption / say | Why reviewers need it |
|---|---|---|---|
| 1 | `https://eikonhq.com/` home page, address bar visible. Scroll to the privacy link and click it. `https://eikonhq.com/privacy` opens. Scroll to the "Google Calendar" section. | "Eikon is a staff rota app for a pharmacy team. This is our privacy policy, with a section on Google data." | Proves the domain, the app identity and the policy match the consent screen. |
| 2 | Sign in to Eikon as the demo staff member. Open **My rota** and show a few shifts plus one approved leave day. | "A staff member signs in and sees their own shifts and approved leave." | Shows the data that will be written. |
| 3 | Go to the profile page and point the cursor at the explanation text, then at the **Connect Google Calendar** button. | "Before connecting, Eikon explains it will create one calendar, 'Eikon rota', and can't see their other calendars." | Shows the in-app disclosure. |
| 4 | Click **Connect Google Calendar**. The Google sign-in opens. **Pause on the address bar** long enough to read `accounts.google.com/...client_id=...` (zoom in if needed). Choose the test Google account. | "The user is sent to Google to sign in." | Reviewers match the client ID in the URL to the project. |
| 5 | **Consent screen:** hold for 3–5 seconds on "Eikon wants access to your Google Account" and the scope line *"Make secondary Google calendars, and see, create, change, and delete events on them"*. Click **Continue** / **Allow**. | "Eikon asks for one permission: to manage calendars it creates." | **The most important shot.** The requested scope and the app name must be readable. |
| 6 | Back on Eikon, the page shows **"Connected as test@gmail.com"**. The address bar shows the return through `https://eikonhq.com/oauth/google/callback`, or show it in shot 4/5 as it passes. | "Back in Eikon, the account is connected." | Shows the redirect URI and the outcome. |
| 7 | Open https://calendar.google.com in a new tab, same test account. Open the left panel to show the new **"Eikon rota"** calendar ticked, then the week with shift events. Open one event to show title, time and pharmacy name. | "Eikon has created the 'Eikon rota' calendar and added this person's shifts and leave." | Shows exactly how the scope's data is used. |
| 8 | Show any other existing calendar or event (create a dummy "Dentist" event on the primary calendar beforehand). | "Eikon cannot see or change the user's other calendars, like this one." | Supports the narrow-scope justification. |
| 9 | Switch to Eikon as a **manager** (second window or quick re-login). Move one of the demo staff member's shifts to another time and approve a leave request. Save. | "When a manager changes the rota or approves leave…" | Shows the update trigger. |
| 10 | Back in Google Calendar, refresh. The moved shift and the new leave appear within seconds. | "…the staff member's Google Calendar updates within seconds." | Shows ongoing use of the scope. |
| 11 | As the staff member in Eikon, click **Disconnect**. The confirmation dialog appears, optionally with "also delete the calendar" ticked. Confirm. The page shows "Not connected". | "Disconnecting revokes Eikon's access and deletes the stored token." | Shows user control and deletion. |
| 12 | Open https://myaccount.google.com/permissions (third-party connections) and show that **Eikon is no longer listed**. If the delete box was ticked, show Google Calendar without "Eikon rota". | "Access is revoked on Google's side too." | Proves the revoke works. |
| 13 | End card: "Eikon · eikonhq.com · Privacy: eikonhq.com/privacy". | — | Optional. |

## Common reasons a video is sent back

- The address bar is cropped, or the consent screen goes past too fast to read. Hold it.
- The video shows a different app name or domain from the consent-screen settings.
- The consent screen appears in a language other than English.
- The video never shows **where** in the app the data is used (shots 7 and 10).
- The video is uploaded as **Private**. It must be **Unlisted**.
- The scopes in the video don't match the requested ones. If you request `openid`/`email` as well, they will appear on the
  consent screen. That is fine, as long as the form lists them.
