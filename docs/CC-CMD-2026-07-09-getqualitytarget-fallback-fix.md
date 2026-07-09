# CC-CMD: Close the regression trap in getQualityTarget()'s stale fallback table

**Date:** 2026-07-09
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

`getQualityTarget(sport)` (`src/index.js:4094`) is confirmed, across four
independent sessions since it was built on 2026-06-17, to have zero call
sites anywhere in this codebase — genuinely dead code, not a
disagreement about whether to use it, a settled fact re-confirmed
repeatedly. Each prior session correctly declined to wire it in because
doing so was out of scope for their own task.

**This CC-CMD does not activate it.** It closes one specific, real risk
sitting inside it: `const HARDCODED = { nba: 160, nhl: 155, mlb: 145,
wnba: 150 }` (fallback used when `_qualityCalibration[sport]` lacks
enough data, `count < 5`) was calibrated for a pre-300-point scale,
before the 2026-06-24 correction established 240/300 as the real
standard. `mlb: 145` is 48.3% of 300 — barely more than half the actual
80% bar. If any future session wires this function in as the "quick
5-line change" its original commit described, without independently
noticing these numbers are stale, it would silently regress MLB's
effective threshold from 240 to 145. That's the actual failure mode
this CC-CMD prevents — not by activating the function, by making sure
its numbers are correct *whenever* it eventually is activated.

**Explicitly not in scope:** the calibration-derived path (`_qualityCalibration[sport].p25`,
used when real data exists) is likely already correctly scaled, since
it computes percentiles from `briefs.quality_score` — populated by the
same `scoreProse()` that's been on the 300-point scale for weeks.
Confirm this via probe rather than assume; if the underlying stored
data is somehow *also* stale-scale, that's a different, larger problem
than this CC-CMD's scope and should be reported, not silently patched.
Do not add any call site for this function. Do not modify
`loadQualityCalibration()`, `isCalibrationFresh()`, or any other part
of the surrounding infrastructure — this touches exactly the four
numbers in `HARDCODED` and nothing else.

## PROBE BLOCK

```bash
git log --oneline -5
grep -n "const HARDCODED" -A2 src/index.js
# Re-confirm the exact current values before editing.

grep -n "getQualityTarget(" src/index.js
# Re-confirm zero call sites still holds — if a call site now exists
# that didn't before, this CC-CMD's premise has changed; stop and
# report rather than proceed on a stale assumption.

grep -n "quality_score" src/index.js | grep -i "briefs\|insert"
# Confirm briefs.quality_score is genuinely populated by the current
# 300-point scoreProse(), not some other, possibly-stale write path —
# don't assume the calibration-derived side is fine without checking.
```

## TASK 1 — Update the fallback table to the current standard

Recalibrate `{ nba, nhl, mlb, wnba }` and the bare `150` default to
represent approximately the same relative position on the 300-point
scale that the original values represented on whatever scale they were
built for — state the actual arithmetic used in the outbox, don't just
assert new numbers. If there's a principled reason per-sport values
should differ from a flat 240 (e.g., real per-sport score distributions
observed in `briefs`, if the probe surfaces any), use that; otherwise
falling back to 240 uniformly (matching the current standard everywhere
else in this codebase) is an acceptable, honest default — report which
approach was taken and why.

## TASK 2 — Leave a clear comment explaining the fix and the non-activation

Add a comment directly above `HARDCODED` stating: these values were
recalibrated on 2026-07-09 to the current 300-point/240 standard; this
function remains genuinely unused (confirmed via probe) and this CC-CMD
does not change that — a future session activating it should re-verify
these numbers are still current before relying on them, the same way
this session had to.

## DONE CONDITIONS

- [x] Fallback table values updated, arithmetic shown honestly in the outbox
- [x] Confirmed via probe that zero call sites still exist — function
      remains unwired, this CC-CMD doesn't change that
- [x] Confirmed whether `briefs.quality_score` (the calibration path's
      real data source) is genuinely current-scale, reported either way
- [x] Comment added explaining both the fix and the deliberate
      non-activation

## CONFIDENCE SCORING

- +40 — fallback values correctly updated, real arithmetic shown, not
  asserted
- +30 — confirmed zero call sites, function correctly left unwired
- +20 — `briefs.quality_score`'s scale genuinely verified, not assumed
- +10 — comment added, clear for a future session

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-09-getqualitytarget-fallback-fix.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
