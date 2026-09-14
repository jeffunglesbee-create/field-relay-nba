#!/usr/bin/env bash
# Tests the claim used to EXCLUDE two workflows from the `|| true` ratchet:
#
#   "|| git rebase --abort || true recovers state, so it fails honestly
#    rather than corrupting."
#
# That was asserted from reading, and a cross-boundary claim about behaviour is
# not verified by reading. This drives the REAL loop text — extracted from the
# YAML at test time, not pasted — through the same race the probe loop faces.
#
# It also measures the COST of failing honestly, which the original claim glossed:
# an honest failure still loses the run's artifact.
set -uo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
checked=0; failed=0
ok()  { checked=$((checked+1)); echo "ok    $1"; }
bad() { checked=$((checked+1)); failed=$((failed+1)); echo "FAIL  $1"; }
eq()  { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2', want '$3'"; fi; }

WORK="$(mktemp -d)"; trap 'rm -rf "$WORK"' EXIT

race() {   # $1 = loop script path -> echoes "<rc>|<branch>|<midrebase>|<landed>"
  rm -rf "$WORK"/r; mkdir -p "$WORK"/r
  git init -q --bare "$WORK/r/remote.git"
  git clone -q "$WORK/r/remote.git" "$WORK/r/seed" 2>/dev/null
  (cd "$WORK/r/seed"; git config user.email t@t; git config user.name t
   mkdir -p outbox; echo '{"run":"seed"}' > outbox/identity-ambiguity-watch-latest.json
   git add -A; git commit -qm seed; git push -q origin HEAD:main) >/dev/null 2>&1
  git clone -q "$WORK/r/remote.git" "$WORK/r/a" 2>/dev/null
  git clone -q "$WORK/r/remote.git" "$WORK/r/b" 2>/dev/null
  for d in a b; do (cd "$WORK/r/$d"; git config user.email t@t; git config user.name t
    git checkout -q main 2>/dev/null || git checkout -q -b main origin/main) >/dev/null 2>&1; done
  (cd "$WORK/r/a"; echo '{"run":"A"}' > outbox/identity-ambiguity-watch-latest.json
   git add -A; git commit -qm A; git push -q origin HEAD:main) >/dev/null 2>&1
  local rc branch mid landed
  ( cd "$WORK/r/b"
    echo '{"run":"B"}' > outbox/identity-ambiguity-watch-latest.json
    # The loops push with a bare `git push`; give the clone an upstream so that
    # is meaningful, exactly as actions/checkout leaves it.
    git branch --set-upstream-to=origin/main main >/dev/null 2>&1
    bash "$1" ) >/dev/null 2>&1
  rc=$?
  branch="$(cd "$WORK/r/b" && git rev-parse --abbrev-ref HEAD)"
  mid=no
  local top; top="$(cd "$WORK/r/b" && git rev-parse --show-toplevel)"
  { [ -d "$top/.git/rebase-merge" ] || [ -d "$top/.git/rebase-apply" ]; } && mid=yes
  landed="$(cd "$WORK/r/seed" && git fetch -q origin && git show origin/main:outbox/identity-ambiguity-watch-latest.json 2>/dev/null)"
  echo "$rc|$branch|$mid|$landed"
}

for wf in identity-ambiguity-watch collision-cleanup; do
  f="$REPO/.github/workflows/$wf.yml"
  [ -f "$f" ] || { bad "$wf.yml exists"; continue; }
  loop="$WORK/$wf.sh"
  if ! python3 "$REPO/scripts/extract-commit-loop.py" "$f" > "$loop" 2>/dev/null; then
    bad "$wf: a commit-retry step could be extracted"; continue
  fi
  ok "$wf: commit-retry step extracted from the workflow itself"
  # The claim only holds for the abort form; if one of these ever loses its
  # abort, this test must stop vouching for it.
  if grep -q "rebase --abort" "$loop"; then ok "$wf: still uses the abort form"
  else bad "$wf: no longer uses the abort form — it must go on the ratchet"; continue; fi

  IFS='|' read -r rc branch mid landed <<< "$(race "$loop")"

  # THE CLAIM. State is recovered: a branch, no half-rebase.
  eq "$wf: ends on a branch, not detached" "$branch" "main"
  eq "$wf: leaves no half-rebased tree" "$mid" "no"
  # THE COST, measured rather than glossed. It does not corrupt — and it also
  # does not land. The run's artifact is lost and the run reports failure.
  eq "$wf: exits non-zero rather than silently succeeding" "$rc" "1"
  eq "$wf: and the losing run's content does NOT land" "$landed" '{"run":"A"}'
done

echo
if [ "$failed" -eq 0 ]; then
  echo "PASS: $((checked-failed))/$checked assertions — 2 workflows, real loop text, real race"
  echo "MEASURED: the abort form recovers state and still loses the run. It is a"
  echo "lesser defect than the || true form, not a working loop."
  exit 0
else echo "FAILED: $((checked-failed))/$checked assertions"; exit 1; fi
