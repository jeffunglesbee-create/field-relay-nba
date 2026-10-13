#!/usr/bin/env bash
# Which Workers hold a given secret binding? Names and types only, never values.
#
# WHY THIS EXISTS, 2026-10-13
#
# docs/CC-CMD-2026-08-25-rotate-relay-secret.md step 1 turns every relay gate
# and self-call from a compiled-in literal into env.RELAY_SHARED_SECRET, and
# makes the gates fail CLOSED when the binding is unset. Both are right, and
# together they mean that deploying step 1 against a Worker WITHOUT the binding
# would reject every CI probe, every cron self-call and every journalism call to
# field-claude-proxy at once. Nothing in this repo could say whether the binding
# existed: src/index.js:10040 reads `env.RELAY_SHARED_SECRET || <literal>`, which
# works either way and so proves nothing.
#
# GET .../workers/scripts/<worker>/secrets lists secret_text bindings by name. A
# plain_text variable does not appear there, and no value ever does.
#
# THE CONTROL. FIELD_MCP_SECRET is put onto field-relay-nba by deploy.yml's
# wrangler-action on every deploy. If the relay's list lacks it, the list is not
# what this thinks it is and the answer is UNREADABLE, never ABSENT.
#
# usage: worker-secret-names.sh <SECRET_NAME> <worker> [<worker>...]
#        worker-secret-names.sh --self-test
# exit 0 only when the secret is PRESENT on every worker named.

set -u
CONTROL_WORKER=field-relay-nba
CONTROL=FIELD_MCP_SECRET

verdict_of() {  # $1 body, $2 secret name, $3 worker
  local body="$1" name="$2" worker="$3"
  if ! printf '%s' "$body" | jq -e '.success == true and (.result | type == "array")' >/dev/null 2>&1; then
    echo UNREADABLE; return
  fi
  if [ "$worker" = "$CONTROL_WORKER" ] && \
     [ "$(printf '%s' "$body" | jq --arg n "$CONTROL" '[.result[] | select(.name == $n)] | length')" = 0 ]; then
    echo UNREADABLE; return
  fi
  if [ "$(printf '%s' "$body" | jq --arg n "$name" '[.result[] | select(.name == $n and .type == "secret_text")] | length')" = 0 ]; then
    echo ABSENT
  else
    echo PRESENT
  fi
}

if [ "${1:-}" = "--self-test" ]; then
  fails=0; n=0
  t() { n=$((n + 1)); local got; got=$(verdict_of "$2" "$3" "$4")
        if [ "$got" = "$1" ]; then echo "  ok   $5 -> $got"; else echo "  FAIL $5: want $1, got $got"; fails=$((fails + 1)); fi; }
  C='{"name":"FIELD_MCP_SECRET","type":"secret_text"}'
  R='{"name":"RELAY_SHARED_SECRET","type":"secret_text"}'
  t PRESENT    "{\"success\":true,\"result\":[$C,$R]}" RELAY_SHARED_SECRET field-relay-nba 'relay: listed beside the control'
  t ABSENT     "{\"success\":true,\"result\":[$C]}"    RELAY_SHARED_SECRET field-relay-nba 'relay: control only'
  t UNREADABLE "{\"success\":true,\"result\":[$R]}"    RELAY_SHARED_SECRET field-relay-nba 'relay: control missing, list untrusted'
  t PRESENT    "{\"success\":true,\"result\":[$R]}"    RELAY_SHARED_SECRET field-claude-proxy 'proxy: no control there by construction'
  t ABSENT     '{"success":true,"result":[]}'          RELAY_SHARED_SECRET field-claude-proxy 'proxy: empty list'
  t ABSENT     "{\"success\":true,\"result\":[$C,{\"name\":\"RELAY_SHARED_SECRET\",\"type\":\"plain_text\"}]}" RELAY_SHARED_SECRET field-relay-nba 'plain_text is not a secret'
  t UNREADABLE "{\"success\":false,\"result\":[$C,$R]}" RELAY_SHARED_SECRET field-relay-nba 'success false beside a full list'
  t UNREADABLE '<html>502</html>'                        RELAY_SHARED_SECRET field-relay-nba 'not JSON'
  echo "self-test: $((n - fails))/$n"
  [ "$fails" = 0 ]; exit $?
fi

: "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}"
NAME="$1"; shift
all=0
for W in "$@"; do
  BODY=$(curl -sS -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/workers/scripts/$W/secrets")
  V=$(verdict_of "$BODY" "$NAME" "$W")
  N=$(printf '%s' "$BODY" | jq -r 'if (.result|type)=="array" then (.result|length|tostring) else "?" end' 2>/dev/null || echo '?')
  printf '  %-20s %-22s %s   (%s secret(s) listed)\n' "$W" "$NAME" "$V" "$N"
  [ "$V" = UNREADABLE ] && printf '  %-20s api errors: %s\n' "" "$(printf '%s' "$BODY" | jq -c '.errors' 2>/dev/null || echo '(not JSON)')"
  [ "$V" = PRESENT ] || all=1
done
exit $all
