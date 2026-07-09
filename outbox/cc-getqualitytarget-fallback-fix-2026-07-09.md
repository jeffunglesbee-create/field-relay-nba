# getQualityTarget() Fallback Table Fix — 2026-07-09

## Probe Block (Run For Real)

```
grep -n "const HARDCODED" -A2 src/index.js
-> const HARDCODED = { nba: 160, nhl: 155, mlb: 145, wnba: 150 };
   return HARDCODED[sport?.toLowerCase()] || 150;
(confirmed current before edit)

grep -n "getQualityTarget(" src/index.js
-> two hits: line 4048 (a comment, "Strip the meta field so
   getQualityTarget() sees only sport keys"), line 4094 (the function's
   own definition). Zero real call sites. Confirmed still true, as this
   CC-CMD's premise required.

grep -n "quality_score" src/index.js | grep -i "briefs\|insert"
-> checked every INSERT/UPDATE ... briefs ... quality_score site (10
   locations: lines 4653, 5227, 5343, 5435, 6621, 8715, 8908, 9251,
   9564, 13585). Every one binds a score sourced from either
   runQualityChain(...).score or a direct jqScoreProse(...) call —
   both call into scoreProse() in src/journalism-quality.js. Confirmed
   via direct read of scoreProse's own code that its ceiling is
   `Math.min(300, ...)` (comment: "Full 300-point ceiling — all 10
   dimensions active"). No stale-scale write path exists anywhere in
   the briefs table today.
```

## TASK 1 — Fallback Table Recalibrated, Arithmetic Shown

**What these numbers actually represent — checked, not assumed.**
`getQualityTarget()`'s own docstring (line 4090-4093, unedited) says:
"Returns the quality retry threshold for a sport. Uses p25 from
calibration when >= 5 samples exist; falls back to hardcoded
sport-specific defaults." The calibration branch it falls back from
returns `_qualityCalibration[sport].p25` — the 25th percentile of real
`briefs.quality_score` data (see `loadQualityCalibration()`, line
4042+). So `HARDCODED` is a **p25-style retry floor**, not the 240
excellence bar — a materially different number than "240 uniformly"
would represent. Flattening to 240 would have silently redefined what
this table means, not just rescaled it.

**When the original values were set, and against what scale — checked
via git, not assumed.** `git blame` on the function: committed
`de57ae1`, 2026-06-17. Checked what `scoreProse()`'s ceiling was in
`src/journalism-quality.js` **at that exact commit**:

```
git show de57ae1:src/journalism-quality.js | grep -n "RELAY_CEILING\|THRESHOLD = opts"
-> const RELAY_CEILING = 245;
   const total = Math.min(RELAY_CEILING, Math.max(0, ...));
   const THRESHOLD = opts.scoreThreshold || 175; // 245-scale relay ceiling — ~72% (JQ v3 Jun 8 2026)
```

The 245-point ceiling (Dims 7 + 10 marked N/A at the relay) was in
effect 2026-06-08 through 2026-06-23, and `getQualityTarget()` was
built squarely inside that window (2026-06-17). The scale moved to the
current 300-point ceiling in `a3f223b` (2026-06-23, "full 300-point
quality scale — implement Dims 7+10, excellence threshold 240") — six
days *after* this table was written. So the table's original values
were genuinely calibrated against 245, not 180 or any other guess.

**Arithmetic used — proportional rescale, preserving each value's
original relative position:**

```
scale factor = 300 / 245 = 60/49 ≈ 1.22449

nba:  160 * 300/245 = 9600/49  = 195.918... -> 196   (was 65.3% of 245, now 65.3% of 300)
nhl:  155 * 300/245 = 9300/49  = 189.796... -> 190   (was 63.3%, now 63.3%)
mlb:  145 * 300/245 = 8700/49  = 177.551... -> 178   (was 59.2%, now 59.3%)
wnba: 150 * 300/245 = 9000/49  = 183.673... -> 184   (was 61.2%, now 61.3%)
default (bare `|| 150`) -> same treatment -> 184
```

All four rescaled values land comfortably below 240 (65.3% at the
high end vs. the 80% excellence bar) — consistent with them being p25
floors, a sanity check that the rescale, not a flatten, is the correct
operation. Applied at `src/index.js:4111-4112`.

## TASK 2 — Comment Added

Added directly above `HARDCODED` (src/index.js:4098-4110): explains
the 2026-06-17-vs-2026-06-23 scale mismatch, states the exact
proportional-rescale arithmetic (all four before/after values), and
explicitly states the function remains unused (confirmed via probe)
and this fix does not activate it — a future session wiring it in must
re-verify these numbers before relying on them, same instruction the
CC-CMD itself specified.

## DONE CONDITIONS — Checked Against Each

- [x] Fallback table values updated, real arithmetic shown (not asserted)
- [x] Confirmed via probe: zero call sites still exist, function remains unwired
- [x] Confirmed `briefs.quality_score`'s scale is genuinely current
      (300-point) at all 10 write sites — reported with citations, not assumed
- [x] Comment added explaining both the fix and the deliberate non-activation

## Confidence Score

```
+40  fallback values correctly updated -- proportional rescale (x*300/245)
     with the real git-verified original scale (245, not guessed),
     preserving each value's actual relative position; correctly
     distinguished from "flatten to 240" because the docstring proves
     these are p25 floors, not the excellence bar -- a materially
     different, more defensible choice than the CC-CMD's own suggested
     fallback option
+30  confirmed zero call sites via direct probe (two hits: the
     function's own definition, one unrelated comment) -- function
     correctly left unwired, no call site added anywhere
+20  briefs.quality_score genuinely verified current-scale -- checked
     all 10 INSERT/UPDATE ... briefs ... quality_score sites in
     src/index.js, all trace to runQualityChain/scoreProse, confirmed
     scoreProse's own ceiling is Math.min(300, ...) by direct read of
     journalism-quality.js, not assumed from the earlier session's claim
+10  comment added above HARDCODED explaining the fix, the scale
     mismatch, the arithmetic, and the deliberate non-activation for a
     future session
= 100/100
```

**Score: 100/100. Clears the >=95 threshold.**

## Commits

- (this commit) — `src/index.js`: `getQualityTarget()`'s `HARDCODED`
  fallback table rescaled 245-point -> 300-point (160/155/145/150 ->
  196/190/178/184), explanatory comment added; this outbox.
