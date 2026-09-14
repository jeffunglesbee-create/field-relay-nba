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

# A race with NO content conflict: the other run wrote a DIFFERENT file, so the
# push is rejected non-fast-forward and the rebase replays cleanly. This is the
# shape these two workflows can actually produce — both write a filename unique
# per run — and it must be distinguished from the conflicting shape before the
# conflicting one is used to argue urgency.
race_clean() {   # $1 = loop script -> "<rc>|<landed>"
  rm -rf "$WORK"/c; mkdir -p "$WORK"/c
  git init -q --bare "$WORK/c/remote.git"
  git clone -q "$WORK/c/remote.git" "$WORK/c/seed" 2>/dev/null
  (cd "$WORK/c/seed"; git config user.email t@t; git config user.name t
   mkdir -p outbox; echo seed > outbox/seed.txt
   git add -A; git commit -qm seed; git push -q origin HEAD:main) >/dev/null 2>&1
  git clone -q "$WORK/c/remote.git" "$WORK/c/a" 2>/dev/null
  git clone -q "$WORK/c/remote.git" "$WORK/c/b" 2>/dev/null
  for d in a b; do (cd "$WORK/c/$d"; git config user.email t@t; git config user.name t
    git checkout -q main 2>/dev/null || git checkout -q -b main origin/main
    git branch --set-upstream-to=origin/main main) >/dev/null 2>&1; done
  (cd "$WORK/c/a"; echo A > outbox/run-A-20260914T000001Z.json
   git add -A; git commit -qm A; git push -q origin HEAD:main) >/dev/null 2>&1
  local rc
  ( cd "$WORK/c/b"; echo B > outbox/run-B-20260914T000002Z.json; bash "$1" ) >/dev/null 2>&1
  rc=$?
  local landed=no
  (cd "$WORK/c/seed" && git fetch -q origin && git cat-file -e origin/main:outbox/run-B-20260914T000002Z.json 2>/dev/null) && landed=yes
  echo "$rc|$landed"
}

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

# CONVERTED — must now call the shared loop. Named explicitly because these two
# were the argument for the exclusion, and an exclusion that quietly becomes a
# conversion that quietly becomes neither is how a gate rots.
for wf in identity-ambiguity-watch collision-cleanup; do
  f="$REPO/.github/workflows/$wf.yml"
  if grep -q 'scripts/probe-commit-retry.sh' "$f"; then
    ok "$wf: converted to the shared loop"
  else
    bad "$wf: no longer calls scripts/probe-commit-retry.sh"
  fi
  # And it must not have kept a second, private loop alongside it.
  if python3 "$REPO/scripts/extract-commit-loop.py" "$f" >/dev/null 2>&1; then
    bad "$wf: still carries its own retry loop"
  else
    ok "$wf: carries no retry loop of its own"
  fi
done

# ANY REMAINING ABORT-FORM LOOP, found by shape rather than by name, so a
# workflow that grows one is raced too instead of being trusted.
remaining=0
for f in "$REPO"/.github/workflows/*.yml; do
  loop="$WORK/$(basename "$f" .yml).sh"
  python3 "$REPO/scripts/extract-commit-loop.py" "$f" > "$loop" 2>/dev/null || continue
  grep -q 'rebase --abort' "$loop" || continue
  remaining=$((remaining+1))
  wf="$(basename "$f" .yml)"
  IFS='|' read -r crc clanded <<< "$(race_clean "$loop")"
  eq "$wf: a race with no content conflict succeeds" "$crc" "0"
  eq "$wf: and this run's artifact lands" "$clanded" "yes"
  IFS='|' read -r rc branch mid landed <<< "$(race "$loop")"
  eq "$wf: ends on a branch, not detached" "$branch" "main"
  eq "$wf: leaves no half-rebased tree" "$mid" "no"
done

echo
if [ "$failed" -eq 0 ]; then
  # Rule 91: zero remaining abort-form loops must read as "none left", never as
  # "nothing was looked at".
  echo "PASS: $((checked-failed))/$checked assertions — 2 converted, $remaining abort-form loop(s) still raced"
  exit 0
else echo "FAILED: $((checked-failed))/$checked assertions"; exit 1; fi
