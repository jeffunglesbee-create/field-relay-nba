#!/usr/bin/env bash
# Rule 90 for scripts/probe-commit-retry.sh.
#
# DRIVES THE REAL FILE THROUGH A REAL RACE. Two clones of one bare repo each
# rewrite outbox/provenance-runtime-probe-latest.json, the first pushes, the
# second runs the retry loop. Inline in YAML this could only have been exercised
# by dispatching runs and hoping they collided — which is how the broken loop
# shipped and stayed shipped.
set -uo pipefail

SCRIPT="$(cd "$(dirname "$0")" && pwd)/probe-commit-retry.sh"
checked=0; failed=0
ok()   { checked=$((checked+1)); echo "ok    $1"; }
bad()  { checked=$((checked+1)); failed=$((failed+1)); echo "FAIL  $1"; }
eq()   { if [ "$2" = "$3" ]; then ok "$1"; else bad "$1 — got '$2', want '$3'"; fi; }

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

setup() {
  rm -rf "$WORK"/*
  git init -q --bare "$WORK/remote.git"
  git clone -q "$WORK/remote.git" "$WORK/seed"
  (cd "$WORK/seed"
   git config user.email t@t; git config user.name t
   mkdir -p outbox
   echo '{"run":"seed"}' > outbox/provenance-runtime-probe-latest.json
   echo 'seeded.md' > outbox/.drive-uploaded
   git add -A; git commit -qm seed; git push -q origin HEAD:main) 
  git clone -q "$WORK/remote.git" "$WORK/a"
  git clone -q "$WORK/remote.git" "$WORK/b"
  for d in a b; do (cd "$WORK/$d"; git config user.email t@t; git config user.name t; git checkout -q main 2>/dev/null || git checkout -q -b main origin/main); done
}

# ── 1. the race this exists for ────────────────────────────────────────────
setup
(cd "$WORK/a"; echo '{"run":"A"}' > outbox/provenance-runtime-probe-latest.json
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo '{"run":"B"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
rc=$?
eq "a losing run still pushes" "$rc" "0"
final="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/provenance-runtime-probe-latest.json)"
# THE ASSERTION THAT CATCHES AN OURS/THEIRS INVERSION. During a rebase the
# replayed commit is "theirs"; picking "ours" silently keeps A and looks like a
# clean pass.
eq "the later run's content wins" "$final" '{"run":"B"}'
case "$out" in *"resolved outbox/provenance-runtime-probe-latest.json"*) ok "and it says which file it resolved";; *) bad "and it says which file it resolved";; esac

# ── 2. no race, nothing clever ─────────────────────────────────────────────
setup
out="$(cd "$WORK/b"; echo '{"run":"solo"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: solo" 2>&1)"
eq "an unconflicted push succeeds first time" "$?" "0"
case "$out" in *"pushed on attempt 1"*) ok "on the first attempt";; *) bad "on the first attempt — $out";; esac

# ── 3. THE APPENDED LEDGER MUST NOT BE AUTO-RESOLVED ───────────────────────
# outbox/.drive-uploaded accumulates Drive deliveries and lives in the same
# directory this step stages wholesale. Picking either side discards a real run's
# work, so the loop must refuse and leave a clean branch behind.
setup
(cd "$WORK/a"; echo 'from-A.md' >> outbox/.drive-uploaded
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo 'from-B.md' >> outbox/.drive-uploaded
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
rc=$?
eq "a conflict in the appended ledger fails rather than picking a side" "$rc" "1"
case "$out" in *"not a regenerated artifact"*) ok "and names why it refused";; *) bad "and names why it refused — $out";; esac
inrebase="$(cd "$WORK/b"; git rev-parse --git-path rebase-merge)"
if [ -d "$(cd "$WORK/b" && git rev-parse --show-toplevel)/.git/rebase-merge" ] || [ -d "$(cd "$WORK/b" && git rev-parse --show-toplevel)/.git/rebase-apply" ]; then
  bad "and leaves no half-rebased tree behind"
else ok "and leaves no half-rebased tree behind"; fi
branch="$(cd "$WORK/b"; git rev-parse --abbrev-ref HEAD)"
eq "and is back on a branch, not detached" "$branch" "main"

# ── 4. a non-race push failure is loud and immediate ───────────────────────
setup
out="$(cd "$WORK/b"; echo '{"run":"x"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_REMOTE="$WORK/nope.git" PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: x" 2>&1)"
rc=$?
eq "a push failure that is not a race exits non-zero" "$rc" "1"
case "$out" in *"not a race"*) ok "and says so instead of retrying into silence";; *) bad "and says so instead of retrying into silence — $out";; esac

# ── 5. nothing staged is not a failure ─────────────────────────────────────
setup
out="$(cd "$WORK/b"; PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: none" 2>&1)"
eq "no change to commit exits clean" "$?" "0"

echo
if [ "$failed" -eq 0 ]; then echo "PASS: $((checked-failed))/$checked assertions — real clones, real conflicts, real pushes"; exit 0
else echo "FAILED: $((checked-failed))/$checked assertions"; exit 1; fi
