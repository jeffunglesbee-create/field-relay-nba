# CC session — 2026-08-23 — ask 6b, scoring weights (era 4)

Rule 67 session doc. Scope: ask 6b of `CC-CMD-2026-08-20-brief-data-quality` —
recalibrate `quality_score` so a recap of an unfinished game scores materially
below a real one.

## HEAD progression

| commit | what |
|--------|------|
| `09aada2` | measure ask 6b's baseline before moving any weight |
| `91626aa` | evaluate candidate weightings on the rows already scored |
| `74dc759` | 245 is the ceiling for a slate brief, not for every brief |
| `95bf3c0` | weight the dimensions that tell a finished game from an unfinished one |

Deploy 847 (`74dc759`) and 848 (`95bf3c0`) both green. Laboratory: rev 7 of the
parent CC-CMD, plus two new commands.

## The measurement came first, and it changed the ask twice

**The ask asked for a reweighting, and a reweighting is what shipped** — but
three of the things this document was going to be built on turned out to be
wrong, and each was wrong in a way that would have produced a different build.

### 1. `fresh` is not game freshness

The ask says *"freshness — a recap of an unfinished game scores low, not high."*
`Dim 5` is `_datamuseFreshness`: word-rarity lookups against
`api.datamuse.com`. Nothing in `scoreProse` reads game state at all. So there
was never a freshness weight pointed at finality to turn up. Whatever gap exists
between the two brief classes is produced by dimensions that only correlate with
finality.

### 2. The first re-score reversed the answer, and was wrong

Run 1 took the most recent 160 `game_recap` rows and reported finals scoring
**5.4 points below** in-progress briefs — an apparent confirmation of the ask's
original rev-1 premise that the metric is inverted, and a contradiction of rev
4's correction.

That sample was 144 finals to 16 in-progress: the table's natural 9:1 ratio.
Stratified to n=95 per class, the answer is the opposite and holds:

| class | n | mean | sd |
|---|---|---|---|
| in-progress language | 95 | 175.2 | 18.1 |
| reads as final | 95 | 181.7 | 13.9 |

Gap **+6.5**, at **2.8× the standard error of the difference**. Rev 4's
correction stands. The reversal was the small class.

Recorded rather than quietly overwritten, because the run-1 artifact is
committed and a reader who finds it should not have to work out which one to
believe. This session had already flagged an `n=2` "CONFIRMED" in this repo five
days earlier; run 1 was the same error at `n=16`, and the fix was a spread
beside every mean and an UNDERPOWERED verdict below 8 rows in a class.

The era-mixing concern that motivated re-scoring in the first place came to
nothing here: re-scored 6.5 against 5.8 stored. Worth saying plainly, so nobody
re-investigates it.

### 3. Only three dimensions could do the work, and two ran backwards

Separation between the classes, normalised, final minus in-progress:

| dimension | separation | in points |
|---|---|---|
| arcScore | **+0.146** | +6.6 |
| contextAnchoring | **+0.144** | +3.6 |
| temporalScore | **+0.111** | +2.2 |
| voiceScore | −0.134 | −4.0 |
| density | −0.120 | −1.9 |
| variety, freshness, specificity, statDepth, matchupDepth | ~0 | ~0 |

Weight on voice and density was **narrowing** the gap the ask exists to widen.
Five of ten dimensions are inert on the question entirely — spreading the change
across the table would have moved every score without moving the answer.

## What shipped — era 4

```
arc      45 -> 55      ctx     25 -> 32      temporal 20 -> 25
voice    30 -> 20      density 16 -> 10      matchup  30 -> 24
```

Nominal total held at 300: the 240, 196 and 110 thresholds all read against it,
and moving the total would shift all three at once under this change's name.

**Measured effect, on the same 190 rows before and after.** `scoreProse`'s total
is linear in the per-dimension fractions the breakdown returns, so both
weightings were evaluated from **one** scoring pass — identical prose, and ~950
fewer Datamuse lookups per candidate.

| weighting | in-progress | final | gap | × noise | × current |
|---|---|---|---|---|---|
| current (era 3) | 175.3 | 181.7 | 6.4 | 2.8 | 1.0 |
| **shift_moderate (shipped)** | **175.5** | **187.0** | **11.5** | **4.2** | **1.8** |
| shift_aggressive | 171.8 | 187.7 | 15.9 | 4.9 | 2.5 |
| forward_only_bound | 150.6 | 192.1 | 41.6 | 6.1 | 6.5 |

`forward_only_bound` was never a proposal. It puts the entire scale on the three
forward dimensions to establish what reweighting can **ever** buy, so the
decision about whether a real finality dimension is needed gets made against a
number. Era 4 takes ~13% of that bound and leaves the rest of the rubric intact.

`shift_aggressive` was measured and not chosen: it cuts voice from 30 to 16, and
FIELD's voice register is a thing this project has spent real work on. Buying 4.4
more points of separation by halving the dimension that encodes the house voice
is a trade worth naming rather than making silently.

## A false constant, and a conclusion built on it

`UNREACHABLE_DIMS` listed `ctx` and `matchup`, and its comment said both "have no
game object in the Worker runtime" — 55 of 300 points gone **by construction**.
That claim sat in `SCALE`'s comment, in `/quality/report`'s payload, in the
2026-08-16 session doc and in the 2026-08-22 analysis of the 240 bar.

Measured on 190 real rows: **Dim 7 scored above zero on 181 of them.** Eight of
the ten `runQualityChain` call sites in `src/index.js` pass `game`, and
`scoreProse` receives it. 245 is the right ceiling for a **slate** brief, which
covers many games and legitimately has no single one. It is wrong for a game
brief.

This changes the meaning of a finding that was already reported. Against the
game-shape ceiling of 270, the 240 bar is **88.89%** of what a game brief can
earn — not 97.96%. (Those are the `74dc759` figures. Era 4 then moved the
weights, so the deployed numbers today are ceiling **276** and **86.96%** — both
derived from `SCALE`, both confirmed live below. The verdict does not change; the
arithmetic follows the weights, which is the point of deriving it.) "No brief has ever cleared 240 across 523" then reads as a
demanding editorial bar that is never met, rather than a near-perfect-score
requirement that is arithmetically unmeetable. Those call for different
responses.

Corrected additively in `74dc759`: `UNREACHABLE_DIMS`, `REACHABLE_CEILING` and
`FOUR_FIFTHS_REACHABLE` keep their values and meaning, and the game shape is new
alongside them, so no consumer of `/quality/report` moved.

## Guards

**`scripts/check-scoring-era-recorded.mjs`** — blocking at the deploy gate.
`SCORING_ERAS`' header has always said to add an entry *before* deploying a
`scoreProse` change that moves scores, and nothing enforced it. The one time it
was skipped (`6aed3bb`, 2026-07-16), the `mlb_game` mean fell 203.2 → 135.4, two
calibration rechecks burned themselves out asking whether the quality trend was
real, and rescoring under one rubric later put the true difference at 0.9
points. The entire 68-point collapse was the instrument.

The guard fingerprints `SCALE`. Change it without recording an era and the
deploy stops, printing the new fingerprint to paste in. Negative-tested: a
one-point edit to two weights fails it and names both values. It also rejects an
era entry whose `measuredEffect` contains no number — "recorded" without a
measurement is a note, and a note is what the 68-point incident already had.

**`scripts/verify-quality-scale-2026-08-16.mjs`** now derives its expectations
from the imported constants rather than freezing 245 / 270 / 88.89. Those numbers
moved because `SCALE` moved, which is what a derived ceiling is for; what that
probe should catch is the **deployed endpoint disagreeing with the code**, and
that is now what it checks. 11 assertions, up from 4.

## Verified vs staged

- **VERIFIED:** every number above, from CI against the deployed relay.
  Artifacts: `outbox/rescore-quality-6b-2026-08-23T1440*.json` (run 1, the
  underpowered one, kept), `…T1445*.json` (stratified), `…T1447*.json`
  (candidates).
- **VERIFIED:** `check-scoring-era-recorded.mjs` green at deploy 848, and
  negative-tested locally.
- **VERIFIED:** deploys 847 and 848 green on all gate steps.
- **NOT ASSERTED:** that era-4 scores are *better* in any editorial sense. The
  probe reports separation between two classes and declines that judgement.

**Live confirmation of era 4, 11/11 assertions against the deployed relay**
(`outbox/quality-scale-verify-20260823T145535Z.json`):

```
PASS reachable_ceiling === 244 (derived from SCALE)
PASS four_fifths_of_reachable === 195
PASS nominal_total === 300
PASS game_shape reported
PASS game reachable_ceiling === 276
PASS game shape drops only matchup
PASS game four_fifths === 221
PASS 240 is 86.96% of the game-shape ceiling
PASS summary rows returned | 48 rows
PASS every row carries numeric cleared_196 | all 48 rows
```

The deployed worker agrees with the source on every derived constant, which is
the invariant that probe now exists to hold.

Re-runnable any time: dispatch `rescore-quality-6b.yml` or
`verify-quality-scale.yml`.

## Carry-forwards — both filed as commands, neither carried here

Per Rule 87, deferred work is a second CC-CMD, not a sentence.

1. **`CC-CMD-2026-08-23-finality-dimension`** — no dimension reads game state;
   `arc` and `ctx` are proxies. Reweighting's ceiling is 41.6 and costs the rest
   of the rubric. A dimension reading `finalized_at` is not bounded that way. Its
   done condition demands the new dimension score non-zero on **both** sides,
   because a dimension that is zero everywhere passes every aggregate test while
   doing nothing.
2. **`CC-CMD-2026-08-23-matchup-note-starvation`** — Dim 10 is 24 points and
   scored zero on 190 of 190 rows. `regular_season_games.note` is populated on 36
   of 1284 finalized games (2.8%). A producer exists and writes elsewhere:
   `src/index.js` writes matchup notes to KV under `wc:matchup:*`, World Cup
   scoped, 24h TTL, while every consumer reads the D1 column. Its separation is
   exactly 0.000 — the only dimension of ten with no signal, because it has no
   input on either side.

Still open from earlier sessions, unchanged by this one: `scoreThreshold` 110 →
196 (needs a retry-cost estimate), and `n: null` in `/quality/report` rows.
