#!/usr/bin/env bash
# Write the relay's shared secret into the sibling repos' Actions secrets,
# through the Deploy Courier. The value is never printed.
#
# docs/CC-CMD-2026-08-25-rotate-relay-secret.md. Two siblings call the relay's
# gated routes from their own CI: field-laboratory (check:sport-vocabulary) and
# jubilant-bassoon (retry_telemetry_probe.js and the two MLS seed scripts). Both
# read process.env.RELAY_SHARED_SECRET with no default, so each needs its own
# copy, and after a rotation each needs the NEW one. One script, so deploy.yml's
# sync and the rotation write the same repos the same way.
#
# OIDC in, the Courier verifies the caller against GitHub's JWKS, and its own
# token writes the sealed secret into the target repo.
#
# usage: RELAY_SECRET=... OIDC_TOKEN=... distribute-relay-secret.sh <repo>...
# Empty is fatal, never skipped: an empty secret in a sibling would exist and
# authenticate nothing, and its probes would report a 401 as "the probe failed".
set -u
: "${OIDC_TOKEN:?an OIDC token for the field-deploy audience is required}"
if [ -z "${RELAY_SECRET:-}" ]; then
  echo "❌ RELAY_SECRET is empty — nothing is written anywhere."
  exit 1
fi
fail=0
for REPO in "$@"; do
  BODY=$(jq -cn --arg repo "$REPO" --arg value "$RELAY_SECRET" '{repo:$repo,name:"RELAY_SHARED_SECRET",value:$value}')
  RESULT=$(curl -s -X POST https://field-deploy.jeffunglesbee.workers.dev/secret \
    -H "Authorization: Bearer $OIDC_TOKEN" -H "Content-Type: application/json" -d "$BODY")
  if printf '%s' "$RESULT" | grep -q '"ok":true'; then
    echo "✅ RELAY_SHARED_SECRET written to $REPO"
  else
    echo "❌ $REPO: $(printf '%s' "$RESULT" | jq -r '.error // "no error field"' 2>/dev/null)"
    fail=1
  fi
done
exit $fail
