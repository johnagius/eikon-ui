#!/usr/bin/env bash
# Deploy the Eikon API worker safely: code only, never bindings, variables or secrets.
#
#   bash tools/deploy-worker.sh [branch]        (default branch: claude/eloquent-newton-7ib4gb)
#   bash tools/deploy-worker.sh --dry-run [branch]
#
# Needs CLOUDFLARE_API_TOKEN and CLOUDFLARE_ACCOUNT_ID in the environment.
# Steps, and it stops at the first failure:
#   1. takes cloudflare-worker/code from the branch and runs the worker test suite on it
#   2. saves the live worker's settings (bindings) and the current deployment id, for rollback
#   3. uploads ONLY the code (Cloudflare "update content" API; bindings untouched)
#   4. checks /health reports the new WORKER_VERSION and the bindings are byte-identical
#   5. on any check failure, rolls back to the saved deployment
# Optional, idempotent extras (only when asked):
#   --ensure-bookings-key   create the BOOKINGS_KEY secret if it does not exist yet (random, never printed)
#   --ensure-cron           add a */10 cron trigger for booking reminders if there is none
set -euo pipefail

SCRIPT=eikon-api
HEALTH=https://eikon-api.labrint.workers.dev/health
BRANCH=claude/eloquent-newton-7ib4gb
DRY=0; KEY=0; CRON=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --ensure-bookings-key) KEY=1 ;; --ensure-cron) CRON=1 ;;
    -*) echo "unknown option $a" >&2; exit 2 ;; *) BRANCH="$a" ;;
  esac
done
: "${CLOUDFLARE_API_TOKEN:?set CLOUDFLARE_API_TOKEN in the environment}"
: "${CLOUDFLARE_ACCOUNT_ID:?set CLOUDFLARE_ACCOUNT_ID in the environment}"
CF="https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$SCRIPT"
AUTH="Authorization: Bearer $CLOUDFLARE_API_TOKEN"
WORK=$(mktemp -d); trap 'rm -rf "$WORK"' EXIT
say() { printf '%s\n' "$*"; }

say "1/5 Fetching $BRANCH and running the worker tests"
git fetch -q origin "$BRANCH"
git archive FETCH_HEAD cloudflare-worker tests | tar -x -C "$WORK"
( cd "$WORK" && node --no-warnings tests/worker/run.mjs > "$WORK/tests.log" 2>&1 ) || { tail -20 "$WORK/tests.log"; say "Tests failed. Nothing deployed."; exit 1; }
say "   $(grep -E 'passed, [0-9]+ failed' "$WORK/tests.log")"
VERSION=$(sed -n 's/^const WORKER_VERSION = "\(.*\)";/\1/p' "$WORK/cloudflare-worker/code" | head -1)
[ -n "$VERSION" ] || { say "No WORKER_VERSION in the code."; exit 1; }
say "   version to deploy: $VERSION"

say "2/5 Saving the live settings and deployment for rollback"
curl -fsS "$CF/settings" -H "$AUTH" > "$WORK/settings-before.json"
curl -fsS "$CF/deployments" -H "$AUTH" > "$WORK/deployments.json"
PREV=$(python3 -c "import json;d=json.load(open('$WORK/deployments.json'))['result']['deployments'];print(d[0]['versions'][0]['version_id'])")
say "   live version id: $PREV; live /health: $(curl -fsS "$HEALTH" || echo unreachable)"

if [ "$DRY" = 1 ]; then say "Dry run: stopping before any change."; exit 0; fi

say "3/5 Uploading the code only"
cp "$WORK/cloudflare-worker/code" "$WORK/index.js"
curl -fsS -X PUT "$CF/content" -H "$AUTH" \
  -F 'metadata={"main_module":"index.js"};type=application/json' \
  -F "index.js=@$WORK/index.js;filename=index.js;type=application/javascript+module" > "$WORK/upload.json"
python3 -c "import json,sys;d=json.load(open('$WORK/upload.json'));sys.exit(0 if d.get('success') else 1)" || { cat "$WORK/upload.json"; exit 1; }

rollback() {
  say "!! $1 — rolling back to $PREV"
  curl -fsS -X POST "$CF/deployments" -H "$AUTH" -H "Content-Type: application/json" \
    --data "{\"strategy\":\"percentage\",\"versions\":[{\"version_id\":\"$PREV\",\"percentage\":100}]}" > /dev/null && say "   rolled back"
  exit 1
}

say "4/5 Verifying"
ok=0; for i in 1 2 3 4 5 6; do
  if curl -fsS "$HEALTH" | grep -q "\"version\":\"$VERSION\""; then ok=1; break; fi; sleep 3
done
[ "$ok" = 1 ] || rollback "/health does not report $VERSION"
curl -fsS "$CF/settings" -H "$AUTH" > "$WORK/settings-after.json"
python3 - "$WORK" <<'PY' || rollback "bindings changed"
import json,sys
w=sys.argv[1]; a=json.load(open(w+'/settings-before.json'))['result']['bindings']; b=json.load(open(w+'/settings-after.json'))['result']['bindings']
key=lambda x:(x.get('type'),x.get('name'))
sys.exit(0 if sorted(a,key=key)==sorted(b,key=key) else 1)
PY
code=$(curl -s -o /dev/null -w '%{http_code}' https://eikon-api.labrint.workers.dev/ui/index.html)
[ "$code" = 200 ] || rollback "the UI does not load ($code)"
say "   /health reports $VERSION, bindings unchanged, UI loads"

say "5/5 Extras"
if [ "$KEY" = 1 ]; then
  if curl -fsS "$CF/secrets" -H "$AUTH" | grep -q '"BOOKINGS_KEY"'; then say "   BOOKINGS_KEY already set"; else
    K=$(python3 -c "import secrets;print(secrets.token_urlsafe(32))")
    printf '{"name":"BOOKINGS_KEY","text":"%s","type":"secret_text"}' "$K" | curl -fsS -X PUT "$CF/secrets" -H "$AUTH" -H "Content-Type: application/json" --data @- > /dev/null
    unset K; say "   BOOKINGS_KEY created (random, not printed)"; fi
fi
if [ "$CRON" = 1 ]; then
  cur=$(curl -fsS "$CF/schedules" -H "$AUTH")
  if printf '%s' "$cur" | grep -q '"cron"'; then say "   cron already set: $(printf '%s' "$cur" | python3 -c 'import json,sys;print([s["cron"] for s in json.load(sys.stdin)["result"]["schedules"]])')"; else
    curl -fsS -X PUT "$CF/schedules" -H "$AUTH" -H "Content-Type: application/json" --data '[{"cron":"*/10 * * * *"}]' > /dev/null && say "   cron */10 added for booking reminders"; fi
fi
say "Done: $VERSION is live. Rollback, if ever needed: version $PREV"
