# Google OAuth verification for "Connect Google Calendar": what John clicks

Prepared 2026-11-10. These are documents only. Nothing here has been set up, and no code has been written.
Google renames console menus often. The names below are the current "Google Auth Platform" ones
(Branding / Audience / Clients / Data Access / Verification Center). If a label differs, look for the nearest match.

**What you end up with:** a free Google Cloud project with no billing account. In it: the Calendar API turned on,
an OAuth client for `https://eikonhq.com/oauth/google/callback`, and an app called "Eikon" sent to Google for review.
It asks for one scope, `calendar.app.created` (see SCOPES.md).

---

## Before you start (about 30 minutes)

1. **Choose the Google account that will own this for good.** Ideally it is a shared account for the business,
   not a personal one. That same account must:
   - own the Cloud project (Owner role), and
   - be a verified owner of `eikonhq.com` in Google Search Console (step 3).
   If the two accounts differ, Google rejects the verification request.
2. **Get the support email ready.** Google shows it to every user on the consent screen.
   Placeholder: `<<SUPPORT EMAIL — John to fill in>>`. A role address works well, for example a
   support@ inbox on eikonhq.com. It must be a Gmail or Google Group address that the owner account controls,
   because the console only offers addresses that account owns or manages.
3. **Put the privacy page live first.** Use privacy.html in this folder (draft, needs your review) at
   `https://eikonhq.com/privacy`. Google's reviewers open it.
   You also need a home page at `https://eikonhq.com/` that is reachable without a login and that says
   what Eikon is. A bare login form gets apps rejected. One or two sentences above the login are enough.
   Optional: a terms page at `https://eikonhq.com/terms`.

---

## Step 1: Create the project (free, no billing)

1. Go to https://console.cloud.google.com/ and sign in as the owner account.
2. Click the project picker at the top left, then **New project**.
   - Project name: `Eikon`
   - Organization / Location: leave as offered ("No organization" is fine).
   - Click **Create**.
3. **Do not add a billing account.** If a page later offers "Enable billing" or "Start free trial",
   close it. Neither the Calendar API nor OAuth verification needs billing (see COST.md).

## Step 2: Turn on the Google Calendar API

1. With the `Eikon` project selected, go to **APIs & Services → Library**.
2. Search for **Google Calendar API**, open it and click **Enable**.

## Step 3: Prove you own eikonhq.com (Search Console, DNS TXT in Cloudflare)

1. Open https://search.google.com/search-console as the **same owner account**.
2. Click **Add property** and choose **Domain**, the left-hand box, not "URL prefix". Enter `eikonhq.com` and click **Continue**.
3. Google shows a TXT record like `google-site-verification=XXXXXXXX`. Copy it.
4. In another tab, open the Cloudflare dashboard, then **eikonhq.com → DNS → Records → Add record**:
   - Type: `TXT`
   - Name: `@` (the bare domain)
   - Content: paste the whole `google-site-verification=...` string
   - TTL: Auto
   - Click **Save**. This does not touch the Worker or any existing record.
5. Go back to Search Console and click **Verify**. It usually works within minutes. If it doesn't, wait an hour and try again.
6. **Leave the TXT record in place for good.** If you remove it, Google drops the ownership.

## Step 4: Branding (the OAuth consent screen)

1. In Cloud Console, open **Google Auth Platform**. If you have never used it, click **Get started**.
   - App name: `Eikon`
   - User support email: `<<SUPPORT EMAIL — John to fill in>>`
   - Audience: **External**, because staff sign in with ordinary Google accounts.
   - Contact information (developer email): `<<DEVELOPER CONTACT EMAIL — John to fill in>>`. Google sends review emails here, so it must be an inbox you read.
   - Agree to the Google API Services User Data Policy and click **Create**.
2. Go to **Branding** and fill in:
   - App logo: optional. Adding one starts a separate logo check, so you can add it later. **If you include it, it must be 120x120 px and must not use Google's logo or colours.**
   - Application home page: `https://eikonhq.com/`
   - Application privacy policy link: `https://eikonhq.com/privacy`
   - Application terms of service link: `https://eikonhq.com/terms` (optional)
   - **Authorised domains → Add domain:** `eikonhq.com`. It turns green once step 3 is done.
   - Click **Save**.

## Step 5: Scopes (Data Access)

1. Go to **Data Access → Add or remove scopes**.
2. Paste this into **Manually add scopes** at the bottom of the panel:
   `https://www.googleapis.com/auth/calendar.app.created`
   Click **Add to table**, tick it, then click **Update**.
   (It may not appear in the list above, which is why you add it by hand.)
3. Also tick the basic sign-in scopes: `openid` and `.../auth/userinfo.email`.
   They are non-sensitive, and Eikon uses them only to show "Connected as name@gmail.com" and to stop one person from linking the same account twice.
   If you'd rather not show which account is connected, you can leave them out.
4. **Note which section the console puts `calendar.app.created` in:** "Your non-sensitive scopes" or
   "Your sensitive scopes". Google marks the category automatically. I could not confirm it from Google's own pages,
   because developers.google.com was unreachable from here (see SCOPES.md):
   - **Sensitive:** do the full verification (step 8). It is still free, with no security assessment.
   - **Non-sensitive:** verifying scopes is not required. Still do **brand verification**, which shows the name and logo and avoids the warning screen. It is quicker.
   Either way it is **not restricted**. Calendar scopes are not on Google's restricted list, so there is
   **no CASA security assessment and no fee.**
5. Paste the justification text from SCOPES.md where the form asks "How will the scopes be used?".
6. Click **Save**.

## Step 6: Create the OAuth client

1. Go to **Clients → Create client**.
   - Application type: **Web application**
   - Name: `Eikon web`
   - Authorised JavaScript origins: `https://eikonhq.com`
   - **Authorised redirect URIs:** `https://eikonhq.com/oauth/google/callback`
     It must match exactly: https, no trailing slash, no `www`.
   - Click **Create**.
2. Google shows a **Client ID** (ends in `.apps.googleusercontent.com`) and a **Client secret**.
   **Download the JSON or copy both into your password manager right away.** In the current console the secret is shown in full only once.
3. **Where the two values go, later and only when the feature is built:** they are stored as Worker secrets, never in the repo, a chat, an email or a screenshot.
   From the Eikon Worker folder:
   ```cmd
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_ID
   npx wrangler secret put GOOGLE_OAUTH_CLIENT_SECRET
   npx wrangler secret put GOOGLE_TOKEN_KEY
   ```
   Each command asks for the value. Type or paste it at the prompt.
   `GOOGLE_TOKEN_KEY` is a random 32-byte key that encrypts stored refresh tokens. Generate it when the feature is built.
   The secret names are suggestions. The code will set the final ones.
   Until the code exists there is nothing to paste, so keep the values in the password manager.
4. Add a second redirect URI only if you need a staging site. Every redirect URI you add **after**
   verification can trigger a new review.

## Step 7: Audience, test users, then publish

1. Go to **Audience**. The status starts as **Testing**.
2. Under **Test users → Add users**, add your own Google account and one or two staff accounts
   to try the feature before review.
   - In Testing, only listed test users can connect, up to 100.
   - **In Testing, Google lets refresh tokens expire after 7 days**, so connected calendars stop updating after a week. That is expected. It is one reason not to stay in Testing.
3. When the feature is live on eikonhq.com, the privacy page is up and the demo video is recorded,
   click **Publish app** and confirm. The status becomes **In production**.
   - Until verification passes, users see a "Google hasn't verified this app" warning, and the app is capped at
     **100 new users** in total (Google's figure, which it can adjust per app). Staff can click through the warning ("Advanced → Go to Eikon") while you wait.

## Step 8: Submit for verification

1. Go to **Verification Center**. If the scope is sensitive, it shows "Verification required". Click **Prepare for verification**.
2. Check each page. The form pulls in Branding and Data Access and adds:
   - **Scope justification:** paste from SCOPES.md.
   - **Demo video:** a YouTube link. Record it from DEMO.md, upload to YouTube Studio with **Visibility: Unlisted**
     (not Private, because the reviewers can't open private videos) and paste the link.
   - **Additional info:** paste the "Notes for the reviewer" paragraph from SCOPES.md.
3. Click **Submit**.
4. **Afterwards:**
   - Google's Trust & Safety team emails the developer contact address. **Reply in the same email thread**, quickly. Most delays come from questions that sat unanswered.
   - They often ask for one of three changes: put a link to the privacy policy on the home page, make the app name match on
     the home page and the consent screen, or show the redirect URI or consent screen more clearly in the video.
   - Track progress in **Verification Center**.

## Timeline you can plan around

| Stage | Typical |
|---|---|
| Steps 1–7 (setup) | One evening |
| Search Console TXT verification | Minutes to an hour |
| Brand verification only (non-sensitive) | 2–3 business days |
| Sensitive scope verification | **3–5 business days** per Google. In practice, allow 1–3 weeks if Google asks questions. Forum threads in 2026 report waits of several weeks for a first reply. |
| Restricted scope + CASA | **Does not apply to Eikon** |

Sources: Google "Sensitive scope verification" (3–5 business days, unlisted YouTube video, Search Console ownership):
https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification ·
Google "Unverified apps" (100 new-user cap, privacy policy required, re-verification on changes):
https://support.google.com/cloud/answer/7454865 ·
Google restricted scope list (no Calendar scopes): https://support.google.com/cloud/answer/13464325 ·
Restricted scope verification / CASA (applies to restricted scopes only):
https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification

## Things that restart a review (avoid after approval)

- Changing the app name or logo
- Adding a redirect URI or JavaScript origin
- Adding a scope, for example moving up to `calendar.events`
- Moving the privacy policy to a new URL
