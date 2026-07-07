# Confidence-Gate Violation Detection — 2026-07-07

## What Was Built

New step "Check for confidence-gate violations" added to
`.github/workflows/post-deploy-live-verify.yml` — the existing post-deploy workflow,
not a new separate workflow. Step runs after "Live-check endpoints" and before "Commit
results."

Also added `fetch-depth: 25` to the `actions/checkout@v4` step. The step uses `git log
-20` which requires at least 20 commits in history; the default `fetch-depth: 1` would
silently limit the log to 1 commit.

**Detection-only.** This cannot prevent a gate violation — a CC session decides whether
to commit before this check ever runs. What it does is make a violation immediately and
automatically visible (a failed CI run) rather than requiring a manual git-log audit to
discover it. Same shift `stale_pending_cc_cmds` made for staleness, applied to this
failure mode.

## Verification

### Regex against both real score formats

Both formats appear in real outbox files from this session:

| format | example | extracted |
|---|---|---|
| `= 85/100` | confidence table footer | `85` ✓ |
| `**Score: 97/100**` | bold summary line | `97` ✓ |
| `= 81/100` | initial synthetic-benchmark stop | `81` ✓ |

Command: `grep -oE '(Score:|=)\s*[0-9]+/100' "$f" | grep -oE '[0-9]+' | head -1`

### Positive case — 85/100 violation (should flag)

`outbox/cc-drama-score-cost-measurement-2026-07-07.md`:
- Score extracted: 85 < 95 → enters violation branch
- `git log -20 -- 'src/*.js'`: 23 lines (includes `04611bc`, `1c8b88e` — confirmed real src/ commits from that session)
- Result: **CONFIDENCE-GATE VIOLATION flagged** ✓

### Negative case A — 97/100 (should not flag)

`outbox/cc-drama-score-synthetic-benchmark-2026-07-07.md`:
- Score extracted: 97 ≥ 95 → exits immediately, no violation check entered
- Result: **no flag** ✓

Note: this file's initial version said 81/100 (correctly stopped, no further src/ changes
committed after the stop), then was updated to 97/100 after the Node.js measurement.
The check sees the current score (97), which is correct — the file reflects the final
outcome, not the intermediate stop.

### Negative case B — logic test (sub-95, no src/ changes)

Simulated: score=81, SRC_TOUCHED=0 → `[ "$SRC_TOUCHED" -gt 0 ]` is false → no violation.
This covers the "correctly stopped with no code commit" pattern the check is designed to
allow through. Result: **no flag** ✓

### Full simulation against current repo

```
outbox/cc-archive-catchup-existence-check-fix-2026-07-06.md  → 70 (< 95) + src/ touched → VIOLATION
outbox/cc-drama-peak-immutability-guard-2026-07-06.md        → 100 → clean
outbox/cc-drama-score-cost-measurement-2026-07-07.md         → 85 (< 95) + src/ touched → VIOLATION
outbox/cc-drama-score-synthetic-benchmark-2026-07-07.md      → 97 → clean
outbox/cc-fields-pick-fix-2026-07-06.md                      → 95 → clean
outbox/cc-kv-sweep-sport-mislabel-fix-2026-07-06.md          → 100 → clean
outbox/cc-stale-cc-cmd-detection-2026-07-06.md               → 100 → clean
outbox/cc-wenttoot-newspaper-bundle-wire-2026-07-06.md       → 100 → clean
outbox/cc-wenttoot-relay-side-2026-07-06.md                  → 100 → clean
outbox/cc-wiki-trending-aggregator-2026-07-06.md             → 100 → clean
```

**Two pre-existing violations found:** 85/100 from July 7 (this session, acknowledged
throughout) and 70/100 from July 6 (archive-catchup; gap was "observational only, not
code-correctness" per that outbox). Both are real violations the check correctly surfaces.

**Implication:** the check will fail CI for the current repo state and will continue to
fail until those violations roll out of the 20-commit window. This is intended behavior —
retroactive surfacing is the point. It creates pressure to acknowledge, not to hide.

## Scope of What the Check Does and Does Not Do

**Does:**
- Scan outbox files modified in the last 20 commits for sub-95 scores
- Flag only when both sub-95 score AND src/*.js changes exist in the same window
- Fail CI loudly (exit 1, summary note)
- Surface pre-existing violations retroactively

**Does not:**
- Prevent a violation — the check runs post-deploy, not pre-commit
- Distinguish "implementation commits before stopping" from "shipping despite low score"
  (both show src/ changes in window; the discrimination is imperfect by design — see
  the CC-CMD for the honest scope statement)
- Know about violations outside its 20-commit window

## Confidence Score

```
+30  Step correctly added to existing post-deploy-live-verify.yml workflow,
     not a new separate workflow; placed after Live-check endpoints, before
     Commit results; fetch-depth: 25 added to make git log -20 work in CI
+25  Regex verified against both real score formats (= X/100 and Score: X/100)
     using actual outbox files on disk, not synthetic examples
+25  Positive case (85/100, real src/ commits) correctly flags;
     negative case A (97/100) correctly passes; negative case B (sub-95 score,
     SRC_TOUCHED=0) correctly passes; full simulation run against live repo
     confirms correct output for all 10 outbox files in window
+20  Outbox explicitly scopes this as detection-only, matching the honesty
     standard the CC-CMD asked for
= 100/100
```

**Score: 100/100 — above 95 threshold.**
