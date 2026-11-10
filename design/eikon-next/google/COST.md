# Cost: Google Calendar connection for Eikon

**Short answer: €0 to set up, €0 to verify, €0 to run at Eikon's size. No billing account is needed.**

| Item | Cost | Source |
|---|---|---|
| Google Cloud project | Free. A project can exist without a billing account. | Google Cloud console (no billing step in project creation) |
| Enabling the Google Calendar API | Free | https://developers.google.com/calendar/pricing |
| OAuth consent screen + client | Free | — |
| Sensitive-scope or brand verification | Free. Google charges nothing for its own review. | https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification |
| CASA security assessment (paid, by third-party assessors) | **Not applicable.** It is required only for **restricted** scopes, and no Calendar scope is restricted. | https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification · restricted list: https://support.google.com/cloud/answer/13464325 |
| Search Console domain verification | Free. One TXT record in Cloudflare DNS. | https://search.google.com/search-console |
| Cloudflare side (Worker + D1) | A few extra writes and one small table. Stays within the plan Eikon already has. | — |
| YouTube (unlisted demo video) | Free | — |

## Quotas (per Google Cloud project)

Google's usage limits page lists the following:
- **10,000 requests per minute per project**
- **600 requests per minute per user per project**

A daily "before charges apply" threshold also exists. A third-party guide puts it at **1,000,000 requests per day per project**,
but I could not confirm that number on Google's own page. Sources: https://developers.google.com/calendar/pricing ·
https://developers.google.com/calendar/quota · https://cli.nylas.com/guides/google-calendar-api-quotas

**Eikon's likely use:** a pharmacy team of, say, 20 staff. A busy rota day with 50 edits, each touching one or two events, comes to
about 100–200 API calls. A full re-sync of everyone, 20 people × 60 upcoming events, is about 1,200 calls.
That is **well under 0.1 %** of the daily threshold, and nowhere near the per-minute limits.

## What could ever cost money

1. **Google's planned charges for going over the free threshold.** Google's usage limits page now says
   *"all standard use … is available at no additional cost"* and that exceeding the quota request limits is
   *"planned to incur charges to your Google Cloud billing account later in 2026"*, with notice given in advance.
   Google's Workspace policy page says that, after 90 days' notice, **quota increase requests will require billing to be enabled**.
   - With **no billing account**, Google cannot charge anything. Going over a limit returns errors (HTTP 403/429), never a bill.
   - Eikon's volume is far below the threshold, so this is not expected to matter.
   Source: https://developers.google.com/calendar/pricing ·
   https://developers.google.com/workspace/tools-safety
2. **Adding a restricted scope later**, for example Gmail or full Drive access. That would bring in the paid CASA assessment, about 2–6 weeks plus an assessor's fee,
   renewed every year. **Don't add one.** Calendar does not need it.
3. **Enabling billing on the project** for any other Google Cloud product. Keep this project for Eikon's OAuth only.
4. **A bug that loops API calls.** Without billing, this can only cause errors, never charges. The future code should still
   batch updates and back off on 403/429.

## What to do if Google ever emails about billing

Read the email for the date and the threshold. Leave billing off. If Eikon is under the threshold, nothing changes.
