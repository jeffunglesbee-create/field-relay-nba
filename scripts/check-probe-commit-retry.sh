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

# ── 3b. THE .txt HALF OF THE REGENERATED LIST ──────────────────────────────
# is_regenerated matches outbox/*-latest.txt as well as .json, and until now
# only .json had ever been exercised. An untested branch of a list that decides
# what gets overwritten is the same class of gap as an untested retry loop.
setup
(cd "$WORK/a"; echo 'A' > outbox/seed-coverage-latest.txt
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo 'B' > outbox/seed-coverage-latest.txt
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
eq "a -latest.txt conflict resolves too" "$?" "0"
final="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/seed-coverage-latest.txt)"
eq "and the later run's text wins" "$final" "B"

# ── 3c. ONE REBASE, TWO CONFLICTS, ONE OF THEM THE LEDGER ──────────────────
# The loop walks the conflicted paths in git's order. If the regenerated file
# comes first it is staged BEFORE the ledger is reached, so the abort has to
# undo a partially-staged rebase. Nothing had tested that it does.
setup
(cd "$WORK/a"; echo '{"run":"A"}' > outbox/provenance-runtime-probe-latest.json
 echo 'from-A.md' >> outbox/.drive-uploaded
 git add -A; git commit -qm A; git push -q origin HEAD:main)
out="$(cd "$WORK/b"; echo '{"run":"B"}' > outbox/provenance-runtime-probe-latest.json
      echo 'from-B.md' >> outbox/.drive-uploaded
      PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
eq "a mixed conflict refuses rather than half-resolving" "$?" "1"
branch="$(cd "$WORK/b"; git rev-parse --abbrev-ref HEAD)"
eq "and unwinds the staged half back to a branch" "$branch" "main"
top="$(cd "$WORK/b" && git rev-parse --show-toplevel)"
if [ -d "$top/.git/rebase-merge" ] || [ -d "$top/.git/rebase-apply" ]; then
  bad "and leaves no half-rebased tree after the partial stage"
else ok "and leaves no half-rebased tree after the partial stage"; fi
ledger="$(cd "$WORK/seed"; git fetch -q origin; git show origin/main:outbox/.drive-uploaded)"
case "$ledger" in *from-A.md*) ok "and the ledger on main still holds the other run's entry";; *) bad "and the ledger on main still holds the other run's entry";; esac

# ── 3d. ATTEMPTS EXHAUSTED ─────────────────────────────────────────────────
# The exit at the bottom of the loop had never run. A remote that rejects every
# push with a race-shaped message drives it: the rebase keeps succeeding and the
# push keeps being refused.
setup
cat > "$WORK/remote.git/hooks/pre-receive" <<'HOOK'
#!/bin/sh
echo "Updates were rejected because the remote contains work that you do not have locally"
exit 1
HOOK
chmod +x "$WORK/remote.git/hooks/pre-receive"
out="$(cd "$WORK/b"; echo '{"run":"B"}' > outbox/provenance-runtime-probe-latest.json
      PROBE_ATTEMPTS=2 PROBE_SLEEP_UNIT=0 bash "$SCRIPT" "chore: B" 2>&1)"
eq "a push refused forever exhausts the attempts and fails" "$?" "1"
case "$out" in *"exhausted 2 attempts"*) ok "and says how many it tried";; *) bad "and says how many it tried — $out";; esac
rm -f "$WORK/remote.git/hooks/pre-receive"

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
