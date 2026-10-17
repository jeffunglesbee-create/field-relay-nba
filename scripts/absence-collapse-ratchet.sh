#!/usr/bin/env bash
# The absence-collapse ratchet, on THIS repo, against THIS repo's baseline
# (docs/absence-collapse-baseline.json). docs/CC-CMD-2026-10-17-absence-
# ratchet-on-relay-pushes.md, option 2.
#
# The script is jubilant-bassoon's scripts/check-absence-collapse.mjs, cloned
# at main and run, NOT copied: two copies drift, and the one that drifts is the
# one nobody reads. jubilant-bassoon's own gate scans this repo too and reads
# this baseline out of its clone, so a bump here is the only bump.
#
# A new site fails with the site named. To accept a genuine one (a reviewable
# commit, which is the point):
#   node <jubilant-bassoon>/scripts/check-absence-collapse.mjs "$PWD" \
#     --require=field-relay-nba/src/index.js \
#     --write-baseline=docs/absence-collapse-baseline.json
#
# Rule 90, in the same run: a collapse added to src/ must turn it red BEFORE
# the real run may report green. The root is passed by absolute path so its
# label is field-relay-nba/..., which is what the require and the baseline
# keys name; `.` would label sites ./src/... and miss both.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
[ "$(basename "$ROOT")" = field-relay-nba ] || { echo "checkout dir must be named field-relay-nba, got $(basename "$ROOT")"; exit 1; }
JB="${JB_CHECKOUT:-${RUNNER_TEMP:-/tmp}/jubilant-bassoon}"
[ -f "$JB/scripts/check-absence-collapse.mjs" ] || git clone --depth 1 --quiet https://github.com/jeffunglesbee-create/jubilant-bassoon.git "$JB"
echo "check-absence-collapse.mjs from jubilant-bassoon $(git -C "$JB" rev-parse --short HEAD)"
run() { node "$JB/scripts/check-absence-collapse.mjs" "$ROOT" \
  --require=field-relay-nba/src/index.js --baseline="$ROOT/docs/absence-collapse-baseline.json"; }

MUT="$ROOT/src/__absence_mutation__.js"
[ ! -e "$MUT" ] || { echo "$MUT already exists"; exit 1; }
trap 'rm -f "$MUT"' EXIT
# Assembled ("|""|") so this file is not itself a finding.
printf '%s\n' "export async function f(r) { return await r.json() |""| []; }" > "$MUT"
if out=$(run 2>&1); then echo "MUTATION NOT CAUGHT: a new collapse in src/ passed the ratchet"; echo "$out" | tail -5; exit 1; fi
echo "$out" | grep -q 'RATCHET FAILED: field-relay-nba flagged \[|| \[\]\]' \
  || { echo "MUTATION failed for the wrong reason:"; echo "$out" | tail -8; exit 1; }
echo "mutation caught: $(echo "$out" | grep -m1 'RATCHET FAILED')"
rm -f "$MUT"

run
