# CC-CMD: Fix confidence-gate check false positive — anchor to the real Confidence Score section

**Date:** 2026-07-07
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

**Source — a real bug, found by the check's own first live run, not
theorized.** Triggering a real deploy today gave the confidence-gate
check its first actual CI execution. It correctly re-flagged two known
historical violations, and found one previously-unknown one — but it
also flagged its own outbox (`cc-confidence-gate-detection-2026-07-07.md`)
at "85/100," which is not a real self-assessment — it's an example
string inside a table that outbox uses to *document* what the regex
should extract from sample inputs. The real score, at the file's actual
`## Confidence Score` heading, is `100/100`.

**Root cause:** the current extraction —
```bash
SCORE=$(grep -oE '(Score:|=)\s*[0-9]+/100' "$f" | grep -oE '[0-9]+' | head -1)
```
— takes the *first* `NN/100`-shaped match anywhere in the file. Every
real outbox this session puts its actual final tally at or near the end,
under a `## Confidence Score` heading — but nothing stops an earlier
match (documentation, an example, a quoted score from a different
CC-CMD) from being picked up first.

## PROBE BLOCK
```bash
grep -n "SCORE=" .github/workflows/post-deploy-live-verify.yml
grep -n "^## Confidence Score" outbox/cc-*.md | wc -l
```
Confirm the current extraction line matches the citation above, and
confirm the heading convention (`## Confidence Score`) is genuinely
present across real outbox files before relying on it as the anchor.

## TASK — Anchor extraction to the real heading, take the last match within it

Replace the extraction line with:
```bash
SCORE=$(sed -n '/^## Confidence Score/,$p' "$f" | grep -oE '[0-9]+/100' | grep -oE '^[0-9]+' | tail -1)
```
This slices the file starting from the real `## Confidence Score`
heading onward (discarding anything before it, including example
tables elsewhere in the document), then takes the *last* match within
that slice — the final tally line, not an intermediate `+NN` breakdown
entry that happens to also match the shape.

If a real outbox has no `## Confidence Score` heading at all (an older,
different-format doc), `SCORE` will come back empty — the existing
`[ -z "$SCORE" ] && continue` line already handles this correctly; do
not change that behavior.

## VERIFICATION

- Re-run the check's logic (locally, not just described) against the
  exact real file that caused today's false positive —
  `outbox/cc-confidence-gate-detection-2026-07-07.md` — and confirm it
  now extracts `100`, not `85`.
- Re-run against the two real, confirmed violations from today
  (`cc-archive-catchup-existence-check-fix-2026-07-06.md`,
  `cc-drama-score-cost-measurement-2026-07-07.md`) and confirm it still
  correctly extracts `70` and `85` respectively — the fix must not
  break real detection while fixing the false positive.
- Re-run against `cc-drama-score-synthetic-benchmark-2026-07-07.md`
  (which contains both an early `81/100` and a later `97/100` in the
  same file, from the same-day update) and confirm it extracts `97`,
  not `81` — this is the sharpest real test of "last match wins," since
  this file's own history is the same shape as the bug being fixed.
- After confirming locally, trigger a real deploy (`workflow_dispatch`
  on `deploy.yml`, same mechanism used earlier today) to prove the fix
  live in actual CI, not just in local reasoning — report the real,
  observed outcome of that run.

## DONE CONDITIONS
- [ ] Probe block confirms citations before editing
- [ ] Extraction anchored to `## Confidence Score`, takes last match
- [ ] False positive case verified fixed (100, not 85)
- [ ] Both real violation cases still correctly detected (70, 85)
- [ ] The four-case synthetic-benchmark test (81 vs 97) verified correct
- [ ] A real, live CI run triggered and its actual outcome reported
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+30  Extraction logic correctly anchored and using last-match
+25  False positive confirmed fixed against the real file that caused it
+25  Both real violations still correctly detected, not broken by the fix
+10  The 81-vs-97 same-file case specifically verified
+10  Real live CI run triggered and reported, not just local reasoning

## ONE-LINER
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO -- this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-07-confidence-gate-regex-fix.md. Fix
the SCORE extraction in post-deploy-live-verify.yml to anchor on the
real "## Confidence Score" heading and take the last match, not the
first match anywhere in the file. Verify against the real false-positive
case, both real violation cases, and the sharpest same-file test
(synthetic-benchmark's 81-then-97). Then trigger a real deploy via
workflow_dispatch to prove it live in actual CI and report the real
outcome. Do not commit unless confidence >= 95. If score < 95, report
verbatim and stop.
