# CC-CMD: Replace the hand-picked upset-bonus threshold with a real fitted model

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** One scoring component (`upsetBonus` in `dramaScoreLive`), replacing a
hardcoded threshold with a model fitted on real archived data via Container.

**HARD DEPENDENCY — check before doing anything else:** this CC-CMD requires
`CC-CMD-2026-07-04-container-drama-backfill.md` to have completed successfully
first — not just as a capability proof, but because this task needs real
populated `drama_peak` data across many games to fit against. Probe D1
directly (same query as that CC-CMD's Task 4) before proceeding. If
`drama_peak` is still 0/587 (or close to it) for games since 2026-06-01, STOP
— report that the dependency hasn't been satisfied yet, and do not attempt
this task with insufficient data. Do not fabricate a model from a handful of
rows to force progress.

**Why — real, exact, current heuristic, not a vague target:** confirmed via
direct read, index.html ~23784: `if (rankGap >= 30 && diff <= 1) { upsetBonus
= Math.min(15, Math.floor(rankGap / 10)); }`. This is a hand-picked threshold
and a hand-picked linear scaling — reasonable when it was written (no
historical upset data existed to fit against), but arbitrary now that real
FIFA rank data (Parse.bot, shipped and verified this session) and, once the
backfill dependency completes, real historical drama outcomes both exist.

**Target time:** ~40 min, AFTER the dependency is satisfied — do not start the clock until then

## ENVIRONMENT CONSTRAINTS (copy verbatim)
- *.workers.dev:443 blocked from CC egress — CI-as-proxy for any live relay check
- Playwright tests must run via GitHub Actions CI — never localhost
- api.github.com is reachable from CC bash
- No branch switching — work on main only
- 2 attempts max on any push — declare failure and stop if both fail

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95. A well-reasoned "insufficient real data
to fit a reliable model yet, recommend waiting for more games" is an
acceptable, honest outcome — do not force a fit on a small or skewed sample
to hit a completion target.

## PROBE BLOCK (run before any modeling)
```bash
# Dependency check — do this FIRST
```
Query D1: `SELECT COUNT(*), SUM(CASE WHEN drama_peak IS NOT NULL THEN 1 ELSE 0 END)
FROM regular_season_games WHERE date >= '2026-06-01' AND sport LIKE '%soccer%'`
(confirm real column/sport-string match via schema check first — do not
assume 'soccer' is the exact stored value without checking, per this
session's own established WC26 sport-string bug precedent).
Then:
```bash
docker --version 2>&1 || echo "NO DOCKER"
grep -n "upsetBonus\|rankGap" index.html
```

## TASK 1 — Fit a real model, don't assume a shape

Using the Container (same capability proven by the backfill CC-CMD), pull the
real, now-populated `drama_peak`/`drama_arc` rows for soccer games with known
FIFA rank gaps at kickoff. Fit an actual model (logistic regression relating
rank gap + score differential to observed drama outcome is a reasonable
starting point — but do not assume this is the right model shape without
checking the data's actual distribution first; report what you tried and
why you chose the final approach). This is real statistical work, not a
mechanical port — take the time the data actually requires.

## TASK 2 — Replace the heuristic, preserve the interface

Replace the `rankGap >= 30 && diff <= 1` / `Math.min(15, Math.floor(rankGap /
10))` block with a call to the fitted model's output, keeping the same
integration point in `dramaScoreLive` (same variable name, same downstream
usage) so nothing else in the scoring pipeline needs to change. If the model
needs to be evaluated at request time rather than precomputed, decide and
justify whether that happens in the Container (called via binding) or as a
precomputed lookup table shipped with the relay — state which and why.

## TASK 3 — Verify against real games, not just unit logic

Confirm the new model-based bonus produces sensible, real values for at least
the two real games already used to verify the original heuristic this session
(Argentina/Cape Verde and any other genuine rank-mismatch game found in the
backfilled data). Report actual before/after bonus values for real games, not
synthetic test cases.

## SCOPE BOUNDARY

DO:
- Confirm the dependency (real populated backfill data) before starting
- Fit a real model against real data, reporting the actual approach taken
- Preserve the existing integration point/interface
- Verify against real games with actual before/after numbers

DO NOT:
- Force a model fit on insufficient or barely-more data than before
- Touch any other component of `dramaScoreLive` (base, timeBonus, sitBonus)
- Assume 'soccer' as an exact stored sport-string value without checking

## DONE CONDITIONS
- [ ] Dependency confirmed satisfied via real D1 query before starting
- [ ] Model fitted against real data, approach and reasoning reported honestly
- [ ] Heuristic replaced, same integration point preserved
- [ ] Verified against real games with actual before/after values reported
- [ ] Outbox manifest written to `docs/outbox/cc-container-upset-model-{date}.md`

## COMPLIANCE
- Rule 68: probe block first, including the hard dependency check
- Rule 87: self-completing, OR a clean, honest stop if the dependency isn't met

## CONFIDENCE SCORING TABLE
+20  Dependency genuinely confirmed satisfied, not assumed
+35  Real model fitted with reasoning reported, not a forced/synthetic fit
+25  Heuristic replaced cleanly at the same integration point
+20  Verified against real games with real before/after numbers

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-container-upset-model.md. FIRST confirm
the hard dependency — query D1 directly to check drama_peak is genuinely
populated for soccer games since 2026-06-01. If not satisfied, stop and
report that plainly, do not proceed. If satisfied, fit a real model against
the real data (report your actual approach, don't assume a shape), replace
the rankGap heuristic at the same integration point, and verify against real
games with actual before/after values. Do not commit unless confidence ≥ 95.
If score < 95 report verbatim and stop.
