# CC-CMD: Confidence-gate acknowledgment list — stop re-flagging reviewed violations

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

`post-deploy-live-verify.yml`'s confidence-gate step
(`.github/workflows/post-deploy-live-verify.yml`, re-confirmed current
via probe below) has no way to distinguish "already reviewed, not
actionable" from "needs attention." It currently re-flags on every
deploy: `cc-archive-catchup-existence-check-fix-2026-07-06.md` (70/100),
`cc-drama-score-cost-measurement-2026-07-07.md` (85/100), and — as of
today — `cc-afl-kali-cache-audit-2026-07-08.md` (70/100), which
correctly, honestly reported "could not conclusively demonstrate X" per
its own gate and stopped, exactly as designed. All three have been
independently reviewed this session; none represent an actual problem.

**Root cause of the false-positive class, precisely:** the `SRC_TOUCHED`
check counts *any* `src/*.js` change in the last 20 outbox-touching
commits, not specifically whether the flagged outbox's own commits
touched `src/`. A diagnostic CC-CMD that touched `src/` temporarily and
reverted it (confirmed byte-identical via `git diff`) still trips this,
because unrelated other commits in the same window touched `src/` too.
This CC-CMD does not fix that correlation logic — it's a separate,
harder problem (would need per-outbox commit-range tracking, not a
blanket 20-commit window). This CC-CMD adds acknowledgment instead:
explicit, reviewed, git-committed suppression — durable, auditable, and
does not require getting the correlation logic perfectly precise to be
useful.

**Scope, deliberately minimal:** a flat text allowlist, not a database,
not a new Codex category, not the broader Decision/Suppression Memory
system discussed earlier this session (that remains real but
appropriately deferred — this fixes the one concrete, currently-firing
problem with the smallest correct mechanism, per this repo's own
correct-route-fast-execution principle).

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "Check for confidence-gate" -A30 .github/workflows/post-deploy-live-verify.yml
# Re-confirm the exact current script — this doc's citation may already
# be stale if anything changed since it was written.

grep -n "^on:" -A5 .github/workflows/post-deploy-live-verify.yml
# Confirm whether workflow_dispatch exists as a trigger (for live
# re-verification) or only workflow_run — determines TASK 3's method.

ls outbox/cc-archive-catchup-existence-check-fix-2026-07-06.md \
   outbox/cc-drama-score-cost-measurement-2026-07-07.md \
   outbox/cc-afl-kali-cache-audit-2026-07-08.md
# Confirm all three still exist at these exact paths before referencing
# them in the allowlist.
```

## TASK 1 — Add the acknowledgment file

Create `docs/confidence-gate-acknowledged.txt`:

```
# Confidence-gate acknowledgment list.
# One outbox filename (relative to repo root) per line. A `#` comment
# above each entry states who/when/why it was reviewed and judged
# non-actionable — required, not optional, so this file stays auditable
# rather than becoming an opaque bypass list. Do NOT add an entry here
# without a real reason; this suppresses a CI check, not decorates one.

# Reviewed 2026-07-08 (chat session): PARTIALLY COMPLETE at 75/100 due
# to an upstream 403 that self-resolved between 2026-07-04 and review;
# endpoint confirmed working live. Process violation stands as a
# historical record but no further action needed.
outbox/cc-archive-catchup-existence-check-fix-2026-07-06.md

# Reviewed 2026-07-08 (chat session): cost-measurement work, 85/100,
# independently reviewed, no actionable defect found.
outbox/cc-drama-score-cost-measurement-2026-07-07.md

# Reviewed 2026-07-08 (chat session): 70/100 was an honest "could not
# conclusively demonstrate cache-hit behavior" result per the CC-CMD's
# own gate, not a quality defect -- superseded by
# cc-afl-kali-kv-cache-2026-07-08 (100/100), which resolved the
# underlying question this one correctly left open.
outbox/cc-afl-kali-cache-audit-2026-07-08.md
```

## TASK 2 — Check the allowlist before flagging

Modify the confidence-gate step's loop to skip any `$f` present in
`docs/confidence-gate-acknowledged.txt` (matching on the exact path
string, ignoring comment/blank lines):

```bash
ACKNOWLEDGED=$(grep -v '^#' docs/confidence-gate-acknowledged.txt | grep -v '^\s*$' || true)
...
for f in $RECENT_OUTBOX; do
  [ -f "$f" ] || continue
  if echo "$ACKNOWLEDGED" | grep -qxF "$f"; then
    echo "SKIPPED (acknowledged): $f — see docs/confidence-gate-acknowledged.txt for reason"
    continue
  fi
  # ... existing SCORE/SRC_TOUCHED logic unchanged below this point
done
```

Do not change the `SCORE`/`SRC_TOUCHED` correlation logic itself — out
of scope per CONTEXT above. This task only adds the skip check.

## TASK 3 — Live verification

If `workflow_dispatch` exists as a trigger (per the probe): dispatch the
workflow directly and confirm the confidence-gate step passes cleanly
with `SKIPPED (acknowledged): ...` lines for all three, and would still
correctly flag a genuine new violation — construct a real, temporary
test case to prove this (e.g., a scratch outbox file scoring 80/100 not
on the allowlist, confirm it DOES get flagged, then remove the scratch
file) rather than asserting the negative case works without testing it.

If no `workflow_dispatch` trigger exists: do not add one just to enable
this test (scope creep). Instead, replicate the exact bash logic in a
local dry run against the real current repo state (`git log -20
--name-only --pretty=format: -- 'outbox/cc-*.md'` really run, real
output), proving both the positive case (all three acknowledged items
skip) and the negative case (a real historical violation not on the
list, if the repo has one from before today, would still fire) from
actual command output — not asserted from reading the script.

## DONE CONDITIONS

- [x] `docs/confidence-gate-acknowledged.txt` created with all three
      entries, each with a real, specific reason comment
- [x] Confidence-gate step correctly skips acknowledged entries,
      correlation logic for everything else unchanged
- [x] Both the positive (skips acknowledged) and negative (still catches
      unacknowledged) cases proven with real command output, not asserted
- [x] Outbox states which verification method was used (live dispatch vs.
      local dry run) and why, based on the probe's actual finding

## CONFIDENCE SCORING

- +25 — acknowledgment file correct, real reasons stated, not placeholder text
- +30 — skip logic correctly implemented, existing correlation logic untouched
- +30 — both positive and negative cases proven via real command output
- +15 — outbox states verification method and reasoning clearly

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-confidence-gate-acknowledgment.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
