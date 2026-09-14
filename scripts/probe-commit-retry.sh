#!/usr/bin/env bash
# The commit-with-retry used by .github/workflows/_reusable-probe.yml.
#
# EXTRACTED FROM THE WORKFLOW SO IT CAN BE TESTED AGAINST ITSELF. Inline in YAML
# it could only ever be exercised by dispatching a real run and hoping two of
# them collided; scripts/check-probe-commit-retry.sh drives this exact file
# through a real local race.
#
# WHAT WENT WRONG (runs 34737627491 and its NFL EPA sibling, 2026-09-13T04:20Z):
# both probes SUCCEEDED and both runs concluded failure. The old loop was
#
#     git pull --rebase --autostash origin main || true
#
# and `|| true` swallows the rebase's exit code but not its STATE. A content
# conflict leaves a detached HEAD with unmerged files, so every later `git push`
# fails with "You are not currently on a branch" and every later `git pull` with
# "Exiting because of an unresolved conflict". The remaining attempts cannot
# succeed; they are guaranteed-failing retries with real sleeps between them.
#
# `|| true` ON A COMMAND THAT MUTATES REPOSITORY STATE IS THE GENERAL SHAPE. It
# turns a failure into a silently corrupted tree, and the loop then reports the
# symptom of its own damage instead of the original race.
#
# THREE RULES THIS FILE KEEPS:
#
#   1. A push rejected for anything OTHER than a race fails immediately and
#      loudly. The old loop retried a permission error five times and then
#      reported the same exit code as a lost race — indistinguishable.
#   2. A failed rebase is always returned to a clean branch before the next
#      attempt. No path leaves a half-rebased tree behind.
#   3. Conflicts are auto-resolved ONLY for files that are regenerated whole by
#      every run. outbox/.drive-uploaded is an APPENDED ledger living in the same
#      directory this step stages; taking one side of it would discard another
#      run's deliveries. Anything not on the regenerated list aborts.
set -uo pipefail

REMOTE="${PROBE_REMOTE:-origin}"
BRANCH="${PROBE_BRANCH:-main}"
ATTEMPTS="${PROBE_ATTEMPTS:-5}"
SLEEP_UNIT="${PROBE_SLEEP_UNIT:-3}"
MESSAGE="${1:?usage: probe-commit-retry.sh <commit message>}"
# WHAT TO STAGE, and it is a parameter because widening is not safe. Three
# callers stage a SINGLE NAMED FILE on purpose; replacing that with `outbox/`
# would sweep outbox/.drive-uploaded — the appended Drive ledger — into their
# commits, which is the exact file this loop refuses to auto-resolve. One caller
# also stages a path outside outbox/ entirely.
#
# Deliberately word-split: callers pass several paths.
# shellcheck disable=SC2206
PATHS=(${PROBE_PATHS:-outbox/})

# Regenerated whole by every run, so the newer copy supersedes and a textual
# merge of two complete JSON documents is meaningless — which is why git raises
# a conflict rather than resolving it. Extend only with files that are REWRITTEN,
# never with files that accumulate.
is_regenerated() {
  case "$1" in
    outbox/*-latest.json|outbox/*-latest.txt) return 0 ;;
    *) return 1 ;;
  esac
}

# The committing identity is the caller's, not this script's. A shared loop that
# stamped every commit "reusable-probe-bot" would erase which workflow wrote a
# row — provenance this repo spent a whole CC-CMD recovering once already.
git config user.name "${PROBE_AUTHOR_NAME:-reusable-probe-bot}"
git config user.email "${PROBE_AUTHOR_EMAIL:-actions@github.com}"
git add -- "${PATHS[@]}"
if git diff --cached --quiet; then
  echo "nothing to commit"
  exit 0
fi
git commit -m "$MESSAGE"

err="$(mktemp)"
trap 'rm -f "$err"' EXIT

for ((i = 1; i <= ATTEMPTS; i++)); do
  if git push "$REMOTE" "HEAD:$BRANCH" 2>"$err"; then
    echo "pushed on attempt $i"
    exit 0
  fi
  cat "$err"

  # A race looks like a rejected non-fast-forward. Everything else — a bad
  # token, a protected branch, a missing remote — is a real failure and must
  # not be retried into silence.
  if ! grep -qE 'non-fast-forward|fetch first|Updates were rejected|behind its remote' "$err"; then
    echo "push failed for a reason that is not a race; not retrying"
    exit 1
  fi

  if ! git pull --rebase --autostash "$REMOTE" "$BRANCH"; then
    unresolved="$(git diff --name-only --diff-filter=U)"
    if [ -z "$unresolved" ]; then
      echo "rebase failed with no conflicted paths; aborting"
      git rebase --abort || true
      exit 1
    fi
    for f in $unresolved; do
      if is_regenerated "$f"; then
        # DURING A REBASE, --theirs IS THIS RUN'S COMMIT. The replayed commit is
        # "theirs" and the branch being replayed onto is "ours" — the reverse of
        # a merge, and the single easiest thing to get backwards here. The check
        # asserts the LATER run's content survives, so an inversion goes red.
        git checkout --theirs -- "$f"
        git add -- "$f"
        echo "resolved $f by keeping this run's regenerated copy"
      else
        echo "conflict in $f is not a regenerated artifact; refusing to pick a side"
        git rebase --abort || true
        exit 1
      fi
    done
    if ! git -c core.editor=true rebase --continue; then
      echo "rebase --continue failed; aborting to a clean branch"
      git rebase --abort || true
      exit 1
    fi
  fi
  sleep $((i * SLEEP_UNIT))
done

echo "exhausted $ATTEMPTS attempts"
exit 1
