#!/usr/bin/env bash
# Is ODDS_API_KEY_FALLBACK a Secret, or a Text variable the next deploy erases?
#
# WHY THIS EXISTS, 2026-10-12
#
# The owner set the binding in the dashboard and probe-odds-fallback-key.mjs read
# VALID (run 38288967181). That probe cannot tell the two dashboard types apart:
# a Secret and a Text variable both reach the worker as env.ODDS_API_KEY_FALLBACK.
# They differ at the next deploy. wrangler.toml has no `keep_vars`, so
# `wrangler deploy` replaces the worker's plain-text variables with the ones in
# wrangler.toml, which does not name this one. A Text value would vanish on the
# next push to src/, and the fallback would be the no-op it was this morning,
# with a green probe in the outbox saying otherwise.
#
# READS NAMES AND TYPES, NEVER VALUES. GET .../workers/scripts/<name>/secrets
# lists secret_text bindings only. A plain_text binding does not appear there at
# all, so its value is never in the response this reads.
#
# THE CONTROL. FIELD_MCP_SECRET is put by deploy.yml's wrangler-action `secrets:`
# block on every deploy, so it is a Secret by construction. If the list does not
# contain it, the list is not what this thinks it is, and that is UNREADABLE,
# never NOT-A-SECRET.
#
#   SECRET        listed beside the control. Survives deploys.        exit 0
#   NOT-A-SECRET  control listed, fallback not. Text, or unset.       exit 1
#   UNREADABLE    the API refused, or the control is missing.         exit 1
#
# --self-test runs the verdict against fixtures, including the two that must
# NOT read SECRET.

set -u
NAME=ODDS_API_KEY_FALLBACK
CONTROL=FIELD_MCP_SECRET
WORKER=field-relay-nba

verdict_of() {
  local body="$1"
  if ! printf '%s' "$body" | jq -e '.success == true and (.result | type == "array")' >/dev/null 2>&1; then
    echo UNREADABLE; return
  fi
  local ctrl has
  ctrl=$(printf '%s' "$body" | jq --arg n "$CONTROL" '[.result[] | select(.name == $n)] | length')
  has=$(printf '%s' "$body"  | jq --arg n "$NAME"    '[.result[] | select(.name == $n and .type == "secret_text")] | length')
  if [ "$ctrl" = "0" ]; then echo UNREADABLE; return; fi
  if [ "$has" = "0" ]; then echo NOT-A-SECRET; else echo SECRET; fi
}

if [ "${1:-}" = "--self-test" ]; then
  fails=0; n=0
  t() {  # want, body, label
    n=$((n + 1))
    local got; got=$(verdict_of "$2")
    if [ "$got" = "$1" ]; then echo "  ok   $3 -> $got"; else echo "  FAIL $3: want $1, got $got"; fails=$((fails + 1)); fi
  }
  C='{"name":"FIELD_MCP_SECRET","type":"secret_text"}'
  F='{"name":"ODDS_API_KEY_FALLBACK","type":"secret_text"}'
  t SECRET       "{\"success\":true,\"result\":[$C,$F]}"                      'both listed'
  t NOT-A-SECRET "{\"success\":true,\"result\":[$C]}"                         'control only: a Text var or unset'
  t NOT-A-SECRET "{\"success\":true,\"result\":[$C,{\"name\":\"ODDS_API_KEY_FALLBACK\",\"type\":\"plain_text\"}]}" 'listed as plain_text'
  t UNREADABLE   "{\"success\":true,\"result\":[$F]}"                         'control missing: the list is not trusted'
  t UNREADABLE   '{"success":false,"errors":[{"code":10000,"message":"Authentication error"}]}' 'API refused'
  t UNREADABLE   "{\"success\":false,\"result\":[$C,$F]}"                     'success false beside a full list'
  t UNREADABLE   '<html>502</html>'                                            'not JSON'
  t UNREADABLE   '{"success":true,"result":null}'                              'result not an array'
  echo "self-test: $((n - fails))/$n"
  [ "$fails" = 0 ] || exit 1
  exit 0
fi

: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
BODY=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$WORKER/secrets")
V=$(verdict_of "$BODY")

{
  echo
  echo "=== binding type  utc=$(date -u +%Y-%m-%dT%H:%M:%SZ) ==="
  echo
  echo "  secrets listed     : $(printf '%s' "$BODY" | jq -r 'if (.result|type)=="array" then (.result|length|tostring) else "(unreadable)" end' 2>/dev/null || echo '(unreadable)')"
  echo "  control $CONTROL : $(printf '%s' "$BODY" | jq -r --arg n "$CONTROL" 'if (.result|type)=="array" then ([.result[]|select(.name==$n)]|length|tostring) else "-" end' 2>/dev/null || echo -)"
  [ "$V" = UNREADABLE ] && echo "  api errors         : $(printf '%s' "$BODY" | jq -c '.errors' 2>/dev/null || echo '(not JSON)')"
  echo
  echo "  verdict: $V"
  case "$V" in
    SECRET)       echo "  $NAME is a secret_text binding. It survives wrangler deploy." ;;
    NOT-A-SECRET) echo "  $NAME is not a Secret. If the probe above read VALID it is a Text variable, and the next deploy erases it. Re-enter it with type Secret (Encrypt)." ;;
    UNREADABLE)   echo "  The list could not be trusted, so nothing is concluded about $NAME." ;;
  esac
} | tee -a "$(ls -t outbox/odds-fallback-key-*.log 2>/dev/null | head -1 || echo /dev/null)"

[ "$V" = SECRET ]
