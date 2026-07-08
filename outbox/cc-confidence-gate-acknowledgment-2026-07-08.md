# Confidence-Gate Acknowledgment List — 2026-07-08

## What Was Built

Per `docs/CC-CMD-2026-07-08-confidence-gate-acknowledgment.md`: the
post-deploy confidence-gate step (`.github/workflows/post-deploy-live-verify.yml`)
re-flags the same three already-reviewed, non-actionable outbox entries
on every deploy, because its `SRC_TOUCHED` correlation check counts any
`src/*.js` change in the last 20 outbox-touching commits, not
specifically whether the flagged outbox's own commits touched `src/`.
Fixing that correlation logic precisely is out of scope here (per the
CC-CMD's own CONTEXT) — this adds an explicit, git-committed
acknowledgment list instead.

## Probe Block — Findings

```
git log --oneline -5                       -- confirmed current HEAD
grep "Check for confidence-gate" -A30 ...  -- script matches this doc's
                                               citation exactly, no drift
grep "^on:" -A5 post-deploy-live-verify.yml -- workflow_run only, NO
                                               workflow_dispatch trigger
                                               -> TASK 3 must use the
                                               local-dry-run path, not
                                               live dispatch
ls outbox/cc-archive-catchup-...            -- all 3 files confirmed to
   outbox/cc-drama-score-cost-...              exist at exact stated
   outbox/cc-afl-kali-cache-audit-...           paths
```

## TASK 1 — `docs/confidence-gate-acknowledged.txt` created

Matches the CC-CMD's specified content for all three entries, with one
correction: the third entry's reason comment (as written in the CC-CMD
doc) referenced `cc-afl-kali-kv-cache-2026-07-08` as if it were a
separate outbox file. It isn't — `outbox/cc-afl-kali-kv-cache-2026-07-08.md`
does not exist (confirmed via `ls`); the 100/100 KV-cache finding it's
referring to lives inside `outbox/cc-afl-kali-relayfetch-fix-2026-07-08.md`'s
later "TASK 2 Follow-Up" section. Corrected the comment to point at the
real location, since this file's entire purpose is to be an accurate,
auditable record (per the CC-CMD's own stated intent) — an inaccurate
reference would undermine that.

Side finding during this correction: `cc-afl-kali-relayfetch-fix-2026-07-08.md`
now self-resolves the gate on its own merits — its file contains two
`## Confidence Score` headings (75/100 original, 100/100 from the later
KV-cache follow-up), and the gate script's `tail -1` picks the *last*
`N/100` match in the file, which is now 100/100. Confirmed via direct
`sed`/`grep` replication of the exact script logic against the real file
(see TASK 3 below) — this file was never at risk of being flagged
regardless of the acknowledgment list, but is not on the list either way
(correctly — it doesn't need acknowledgment, it resolved itself).

## TASK 2 — Skip logic added

Modified the confidence-gate step's loop in
`.github/workflows/post-deploy-live-verify.yml` to check
`docs/confidence-gate-acknowledged.txt` (comment/blank lines stripped)
before scoring each `$f`, exactly as the CC-CMD specified. The
`SCORE`/`SRC_TOUCHED` correlation logic below the skip check is
unmodified — confirmed via diff, only the new skip block was inserted.

## TASK 3 — Live verification: local dry run (no `workflow_dispatch` exists)

Per the probe finding above, `post-deploy-live-verify.yml` only triggers
on `workflow_run` (after `Deploy RELAY Worker` completes) — no
`workflow_dispatch` trigger to dispatch directly, and none was added
(scope creep, per the CC-CMD's own instruction). Replicated the exact
modified bash logic locally against real, current repo state instead.

**Positive case (real command output):**

```
$ RECENT_OUTBOX=$(git log -20 --name-only --pretty=format: -- 'outbox/cc-*.md' | ...)
$ [... exact script logic ...]
SKIPPED (acknowledged): outbox/cc-afl-kali-cache-audit-2026-07-08.md — see docs/confidence-gate-acknowledged.txt for reason
CHECKED: outbox/cc-afl-kali-relayfetch-fix-2026-07-08.md -> score=100
[... 12 more files, all score=100 or 97, none <95 ...]
RESULT: exit 0 (would pass CI)
```

Note: of the CC-CMD's three named entries, only
`cc-afl-kali-cache-audit-2026-07-08.md` is currently inside the real
20-commit lookback window (`cc-archive-catchup-existence-check-fix-2026-07-06.md`
and `cc-drama-score-cost-measurement-2026-07-07.md` have aged out of the
window as more commits have landed since they were written) — so it's
the only one of the three whose skip is observable in the *current*
window, but the skip check itself is unconditional on all three regardless
of window position, and will engage correctly whenever any of them
re-enters a future 20-commit window (e.g. after a revert or rebase).

**Negative case (real command output, no unacknowledged sub-95 outbox
existed in the current window to use as a genuine historical example, so
constructed a temporary scratch file per the CC-CMD's own fallback
approach):**

Created `outbox/cc-scratch-confidence-gate-negative-test-2026-07-08.md`
(80/100, not on the acknowledgment list), committed it (`690db2f`) so it
would appear in `git log --name-only`, re-ran the exact script logic:

```
SKIPPED (acknowledged): outbox/cc-afl-kali-cache-audit-2026-07-08.md
CONFIDENCE-GATE VIOLATION: outbox/cc-scratch-confidence-gate-negative-test-2026-07-08.md reports 80/100 (below 95) alongside real src/ changes in recent history.
RESULT: exit 1 (would fail CI) -- negative case CONFIRMED
```

Confirmed `SRC_TOUCHED` was genuinely nonzero in the same window (31
lines from real `src/*.js` changes in the last 20 commits) before
relying on this result, so the violation fired for the real reason the
script checks, not by accident. Scratch file then deleted (this
commit) — its one purpose (proving the negative case with real output)
is served.

## DONE CONDITIONS — Status

- [x] `docs/confidence-gate-acknowledged.txt` created, all three entries
      present, real reason comments (one corrected for accuracy)
- [x] Skip logic correctly implemented, `SCORE`/`SRC_TOUCHED`
      correlation logic unchanged
- [x] Both positive and negative cases proven via real command output
      (local dry run, not live dispatch — no `workflow_dispatch` trigger
      exists)
- [x] This outbox states the verification method used (local dry run)
      and why (probe confirmed no `workflow_dispatch` trigger)

## Confidence Score

```
+25  acknowledgment file correct, real reasons stated (one corrected
     for a factual inaccuracy found during verification -- not
     placeholder text, an actively-checked reference)
+30  skip logic correctly implemented; SCORE/SRC_TOUCHED correlation
     logic untouched (confirmed via diff)
+30  both positive and negative cases proven via real command output --
     positive case observed directly in current window; negative case
     required constructing a temporary scratch commit (per the CC-CMD's
     own fallback) since no real unacknowledged sub-95 violation
     currently exists in the 20-commit window, then cleanly reverted
+15  this outbox states the verification method (local dry run) and the
     specific probe finding that determined it (no workflow_dispatch
     trigger), plus the self-resolving relayfetch-fix finding and the
     acknowledgment-file correction, both surfaced by actually running
     the checks rather than assuming the CC-CMD's text was accurate
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- `690db2f` — scratch negative-test file added (temporary)
- (this commit) — TASK 1 acknowledgment file (with correction), TASK 2
  skip logic, scratch file reverted, this outbox
