#!/usr/bin/env bash
# Rotate RELAY_SHARED_SECRET everywhere it lives, on a runner, with no human ever
# holding the new value. docs/CC-CMD-2026-08-25-rotate-relay-secret.md step 3.
#
# The document gave this step to a person because it needs Cloudflare and GitHub
# credentials. A runner has both, and a person adds only risk: the value would
# pass through a clipboard, a dashboard and a memory, and the rule is that it
# must never be typed into a chat or a file. Here it exists only in this
# process's memory, masked in the log before its first use.
#
# ORDER, and why:
#   1. both Workers (relay, then proxy). The relay's gates and its self-call
#      headers read the same binding, so the relay is consistent with itself
#      the moment it changes; the proxy follows a second later.
#   2. this repo's Actions secret, through the Courier.
#   3. the siblings' Actions secrets (field-laboratory, jubilant-bassoon).
#   4. a live probe: the NEW value passes both gates, the OLD one is refused by
#      both. The refusal is the half that proves a rotation rather than a
#      second valid value added beside the first.
# ANY failure from step 1 on writes the OLD value back to every place already
# changed and exits non-zero. A half-rotated state, where the Workers and the
# callers disagree, is the one outcome this must never leave behind.
#
# Prints only status lines and the SHA-256 of the new value, which goes into
# docs/exposed-secrets.sha256 at a count of 0 so the value can never be
# committed. Never the value.
#
# --self-test runs every path against a fake transport: success, and a failure
# at each step, asserting what was rolled back.
set -u
WORKERS=(field-relay-nba field-claude-proxy)
SIBLINGS=(field-laboratory jubilant-bassoon)
CURL=${CURL:-curl}                 # injectable, for --self-test
PROBE=${PROBE:-scripts/probe-relay-secret-gates.sh}
SETTLE=${SETTLE:-15}

put_worker() {  # worker value -> 0 on HTTP 200/201
  local code
  code=$($CURL -s -o /dev/null -w '%{http_code}' -X PUT \
    "https://api.cloudflare.com/client/v4/accounts/${CLOUDFLARE_ACCOUNT_ID}/workers/scripts/$1/secrets" \
    -H "Authorization: Bearer ${CLOUDFLARE_API_TOKEN}" -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg v "$2" '{name:"RELAY_SHARED_SECRET",text:$v,type:"secret_text"}')")
  [ "$code" = 200 ] || [ "$code" = 201 ]
}
put_repo() {  # repo value -> 0 when the Courier says ok
  local out
  out=$($CURL -s -X POST https://field-deploy.jeffunglesbee.workers.dev/secret \
    -H "Authorization: Bearer ${OIDC_TOKEN}" -H 'Content-Type: application/json' \
    -d "$(jq -cn --arg r "$1" --arg v "$2" '{repo:$r,name:"RELAY_SHARED_SECRET",value:$v}')")
  printf '%s' "$out" | grep -q '"ok":true'
}

CHANGED=()   # every place already holding the NEW value, in write order
rollback() {
  echo "ROLLBACK: writing the OLD value back to ${#CHANGED[@]} place(s)"
  local bad=0
  for place in "${CHANGED[@]}"; do
    case "$place" in
      worker:*) put_worker "${place#worker:}" "$OLD" && echo "  restored ${place}" || { echo "  FAILED to restore ${place}"; bad=1; } ;;
      repo:*)   put_repo   "${place#repo:}"   "$OLD" && echo "  restored ${place}" || { echo "  FAILED to restore ${place}"; bad=1; } ;;
    esac
  done
  [ "$bad" = 0 ] && echo "ROLLBACK complete: every place holds the old value again" \
                 || echo "ROLLBACK INCOMPLETE — the places above that failed to restore need a human"
  exit 1
}

rotate() {
  : "${OLD:?the current value is required (secrets.RELAY_SHARED_SECRET)}"
  : "${CLOUDFLARE_API_TOKEN:?}" "${CLOUDFLARE_ACCOUNT_ID:?}" "${OIDC_TOKEN:?}"
  NEW=${NEW_OVERRIDE:-$(openssl rand -hex 24)}
  [ -n "${GITHUB_ACTIONS:-}" ] && echo "::add-mask::$NEW"
  [ ${#NEW} -ge 32 ] || { echo "the new value is too short; nothing changed"; exit 1; }
  [ "$NEW" != "$OLD" ] || { echo "the new value equals the old; nothing changed"; exit 1; }

  for w in "${WORKERS[@]}"; do
    if put_worker "$w" "$NEW"; then CHANGED+=("worker:$w"); echo "  worker $w: new value written"
    else echo "  worker $w: write FAILED"; CHANGED+=("worker:$w"); rollback; fi
  done
  for r in field-relay-nba "${SIBLINGS[@]}"; do
    if put_repo "$r" "$NEW"; then CHANGED+=("repo:$r"); echo "  repo $r: new value written"
    else echo "  repo $r: write FAILED"; CHANGED+=("repo:$r"); rollback; fi
  done

  echo "  settling ${SETTLE}s before the live probe"
  sleep "$SETTLE"
  if ! RELAY_SHARED_SECRET="$NEW" OLD_SECRET="$OLD" bash "$PROBE"; then
    echo "  the live probe FAILED with the new value"
    rollback
  fi
  echo "ROTATED: the new value is live in ${#CHANGED[@]} places and the old one is refused"
  echo "new value sha256: $(printf '%s' "$NEW" | sha256sum | cut -d' ' -f1)"
}

if [ "${1:-}" = "--self-test" ]; then
  T=$(mktemp -d)
  cat > "$T/fake-curl" <<'FAKE'
#!/usr/bin/env bash
# Records each call as "<kind> <target> <value>" and fails the call named in FAIL_AT.
args="$*"; kind=""; target=""
case "$args" in
  *workers/scripts/*) kind=worker; target=$(printf '%s' "$args" | sed -E 's#.*workers/scripts/([^/]+)/secrets.*#\1#') ;;
  *field-deploy*)     kind=repo;   target=$(printf '%s' "$args" | sed -E 's#.*"repo":"([^"]+)".*#\1#') ;;
esac
value=$(printf '%s' "$args" | sed -E 's#.*"(text|value)":"([^"]+)".*#\2#')
n=$(( $(wc -l < "$CALLS" 2>/dev/null || echo 0) + 1 ))
echo "$kind $target $value" >> "$CALLS"
if [ "${FAIL_AT:-}" = "$kind:$target" ] && [ "$value" != "$OLD" ]; then
  [ "$kind" = worker ] && printf 500 || printf '{"ok":false}'; exit 0
fi
[ "$kind" = worker ] && printf 200 || printf '{"ok":true}'
FAKE
  chmod +x "$T/fake-curl"
  printf '#!/usr/bin/env bash\n[ "${PROBE_FAIL:-}" = 1 ] && exit 1; exit 0\n' > "$T/fake-probe"; chmod +x "$T/fake-probe"
  fails=0; n=0
  run() {  # label, FAIL_AT, PROBE_FAIL, want_exit, want_final_values_all
    n=$((n + 1)); : > "$T/calls"
    out=$(CURL="$T/fake-curl" PROBE="$T/fake-probe" SETTLE=0 CALLS="$T/calls" FAIL_AT="$2" PROBE_FAIL="$3" \
      OLD=old-value-0123456789abcdef0123 NEW_OVERRIDE=new-value-fedcba9876543210fedcba98 \
      CLOUDFLARE_API_TOKEN=t CLOUDFLARE_ACCOUNT_ID=a OIDC_TOKEN=o bash "$0" --rotate 2>&1); rc=$?
    # The LAST value written to each place is what that place holds now.
    final=$(awk '{last[$1" "$2]=$3} END {for (k in last) print k, last[k]}' "$T/calls" | sort)
    held=$(printf '%s\n' "$final" | awk '{print $3}' | sort -u | tr '\n' ' ')
    places=$(printf '%s\n' "$final" | grep -c .)
    ok=1
    [ "$rc" = "$4" ] || ok=0
    # Success must reach all five places; a failure must not leave any place it
    # touched on the new value, whichever places those were.
    [ "$4" != 0 ] || [ "$places" = 5 ] || ok=0
    [ "$held" = "$5 " ] || ok=0
    printf '%s' "$out" | grep -q 'new-value-fedcba' && ok=0   # the value is never printed
    if [ "$ok" = 1 ]; then echo "  ok   $1 (exit $rc; every place holds $5)"
    else echo "  FAIL $1: exit $rc want $4; places hold [$held] want [$5]"; fails=$((fails + 1)); fi
  }
  run 'success writes the new value everywhere'          ''                    0 0 'new-value-fedcba9876543210fedcba98'
  run 'the relay Worker write fails'                     'worker:field-relay-nba'    0 1 'old-value-0123456789abcdef0123'
  run 'the proxy Worker write fails'                     'worker:field-claude-proxy' 0 1 'old-value-0123456789abcdef0123'
  run 'this repo secret write fails'                     'repo:field-relay-nba'      0 1 'old-value-0123456789abcdef0123'
  run 'a sibling write fails'                            'repo:jubilant-bassoon'     0 1 'old-value-0123456789abcdef0123'
  run 'the live probe fails after every write'           ''                    1 1 'old-value-0123456789abcdef0123'
  rm -rf "$T"
  echo "self-test: $((n - fails))/$n"
  [ "$fails" = 0 ]; exit $?
fi

if [ "${1:-}" = "--rotate" ]; then rotate; exit 0; fi
echo "usage: rotate-relay-secret.sh --rotate | --self-test"; exit 2
