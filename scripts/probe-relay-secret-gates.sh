#!/usr/bin/env bash
# Does the deployed relay accept the shared secret, and refuse everything else?
# docs/CC-CMD-2026-08-25-rotate-relay-secret.md — the done condition, live.
#
# FREE. The relay half is the CC-CMD's own probe, POST /d1/execute "SELECT 1".
# The proxy half never reaches an AI backend: an EMPTY body is refused with
# 400 "Empty body" only AFTER the relay check passes, and a failed relay check
# with no Origin is 403 before that. So the status code alone says which side
# of the check a request landed on, at no cost.
#
#   relay  secret     -> 200, results[0].ok == 1
#   relay  wrong      -> 401
#   relay  no header  -> 401   (the `undefined === undefined` case, live)
#   proxy  secret     -> 400 Empty body   (isRelay was true)
#   proxy  wrong      -> 403             (isRelay was false)
#   OLD_SECRET set:  relay -> 401, proxy -> 403   (the rotation took, rather
#                    than a second valid value being added beside the first)
#
# Values are never printed. Only status codes and the SELECT 1 result are.
set -u
: "${RELAY_SHARED_SECRET:?}"
RELAY=${RELAY_BASE:-https://field-relay-nba.jeffunglesbee.workers.dev}
PROXY=${PROXY_BASE:-https://field-claude-proxy.jeffunglesbee.workers.dev}
fails=0; n=0

relay() {  # $1 header value or "" for none -> prints "status body"
  local hdr=()
  [ -n "$1" ] && hdr=(-H "X-FIELD-Relay: $1")
  curl -sS -o /tmp/rsg.body -w '%{http_code}' -X POST "$RELAY/d1/execute" \
    -H 'Content-Type: application/json' "${hdr[@]}" -d '{"sql":"SELECT 1 AS ok"}'
}
proxy() {  # $1 header value
  curl -sS -o /tmp/rsg.body -w '%{http_code}' -X POST "$PROXY" -H "X-FIELD-Relay: $1" --data-binary ''
}
expect() {  # label, got, want, extra-ok(0/1)
  n=$((n + 1))
  if [ "$2" = "$3" ] && [ "${4:-1}" = 1 ]; then echo "  PASS  $1 -> $2"
  else echo "  FAIL  $1 -> $2, want $3"; fails=$((fails + 1)); fi
}

s=$(relay "$RELAY_SHARED_SECRET"); ok1=$(jq -r '.results[0].ok // empty' /tmp/rsg.body 2>/dev/null)
expect 'relay, the secret'    "$s" 200 "$([ "$ok1" = 1 ] && echo 1 || echo 0)"
expect 'relay, a wrong value' "$(relay 'not-the-relay-secret')" 401
expect 'relay, no header'     "$(relay '')" 401
s=$(proxy "$RELAY_SHARED_SECRET"); eb=$(jq -r '.error // empty' /tmp/rsg.body 2>/dev/null)
expect 'proxy, the secret (empty body, no AI call)' "$s" 400 "$([ "$eb" = 'Empty body' ] && echo 1 || echo 0)"
expect 'proxy, a wrong value'                         "$(proxy 'not-the-relay-secret')" 403
if [ -n "${OLD_SECRET:-}" ]; then
  expect 'relay, the OLD value' "$(relay "$OLD_SECRET")" 401
  expect 'proxy, the OLD value' "$(proxy "$OLD_SECRET")" 403
fi
rm -f /tmp/rsg.body
echo
echo "COVERAGE: $n request(s): /d1/execute on the relay and the proxy's relay check."
echo "Other gated routes share relaySecretMatches; scripts/check-relay-secret-gates.mjs proves that statically."
[ "$fails" = 0 ] && echo "PASS" || echo "FAIL: $fails of $n"
exit $([ "$fails" = 0 ] && echo 0 || echo 1)
