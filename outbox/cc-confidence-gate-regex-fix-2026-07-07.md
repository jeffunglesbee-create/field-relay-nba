# Confidence-Gate Regex Fix — 2026-07-07

## What Was Fixed

One-line change in `.github/workflows/post-deploy-live-verify.yml`, step "Check for
confidence-gate violations," SCORE extraction:

```bash
# Old (first match anywhere in file):
SCORE=$(grep -oE '(Score:|=)\s*[0-9]+/100' "$f" | grep -oE '[0-9]+' | head -1)

# New (anchored to real heading, last match within it):
SCORE=$(sed -n '/^## Confidence Score/,$p' "$f" | grep -oE '[0-9]+/100' | grep -oE '^[0-9]+' | tail -1)
```

**Root cause:** `head -1` took the first `NN/100` match anywhere in the file. Every outbox
this session with a documentation table of example inputs contains earlier `NN/100` strings
before the real `## Confidence Score` heading. The first-match strategy made those examples
invisible to the fix — until `cc-confidence-gate-detection-2026-07-07.md` appeared in the
window and its "85/100" example table entry was picked up instead of the real score of 100.

**Fix strategy:** `sed -n '/^## Confidence Score/,$p'` slices from the heading onward,
discarding everything before it. Within that slice, `tail -1` takes the last numeric match
— the final tally line, not any intermediate `+NN` breakdown entry.

## Probe Block Results

Probe confirmed before editing:
- SCORE= at line 57 of `.github/workflows/post-deploy-live-verify.yml` matched citation.
- `## Confidence Score` heading present in 16 outbox files (confirmed via grep count).

## Verification (local, pre-commit)

All four required test cases:

| test | file | old extraction | new extraction | expected | result |
|---|---|---|---|---|---|
| False positive | cc-confidence-gate-detection-2026-07-07.md | 85 | **100** | 100 | ✓ fixed |
| Real violation | cc-archive-catchup-existence-check-fix-2026-07-06.md | 70 | 70 | 70 | ✓ preserved |
| Real violation | cc-drama-score-cost-measurement-2026-07-07.md | 85 | 85 | 85 | ✓ preserved |
| 81-vs-97 same-file | cc-drama-score-synthetic-benchmark-2026-07-07.md | 97 | 97 | 97 | ✓ (tail-1 wins) |

Note on the synthetic-benchmark case: `## Confidence Score` section contains `81/100` at
the `+10` breakdown line ("initial score 81/100 was correctly stopped") before the final
`97/100` tally. `tail -1` correctly returns 97. This is the sharpest test of "last match
wins" since both scores appear within the same heading section.

Full simulation (new extraction against all files in 20-commit window):
```
VIOLATION: cc-archive-catchup-existence-check-fix-2026-07-06.md → 70/100
clean:     cc-confidence-gate-detection-2026-07-07.md         → 100/100  ← false positive GONE
VIOLATION: cc-drama-score-cost-measurement-2026-07-07.md       → 85/100
clean:     cc-drama-score-synthetic-benchmark-2026-07-07.md   → 97/100
[12 other files] → clean
EXIT 1 (two real violations; no false positives)
```

## Live CI Verification

- Commit: `12b348e` pushed to main at 2026-07-07 17:36:19Z
- Deploy run: `28886236732` — triggered via `workflow_dispatch` — completed `success` at ~17:37:57Z
- Post-deploy verify run: `28886322723` — triggered automatically by deploy success
- Verify run conclusion: `failure` (expected — two real violations remain in window)

**Actual CI log output from "Check for confidence-gate violations" step:**
```
CONFIDENCE-GATE VIOLATION: outbox/cc-archive-catchup-existence-check-fix-2026-07-06.md reports 70/100 (below 95) alongside real src/ changes in recent history.
CONFIDENCE-GATE VIOLATION: outbox/cc-drama-score-cost-measurement-2026-07-07.md reports 85/100 (below 95) alongside real src/ changes in recent history.
```

`cc-confidence-gate-detection-2026-07-07.md` does **not** appear in the violation list.
False positive confirmed gone in real CI. Two real violations correctly detected. Behavior
matches local simulation exactly.

## Confidence Score

```
+30  Extraction correctly anchored to ## Confidence Score, using tail-1 (last match)
+25  False positive confirmed fixed in real CI: cc-confidence-gate-detection no longer flagged
+25  Both real violations (70, 85) still correctly detected in same CI run, not broken by fix
+10  81-vs-97 same-file case verified locally: sed+tail-1 returns 97, not 81
+10  Real live CI run triggered and reported — actual observed log output above, not local reasoning
= 100/100
```

**Score: 100/100 — above 95 threshold.**
