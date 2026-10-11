# Claude Code Command — measure the one baseline that shipped unmeasured

**Date:** 2026-10-11
**Repo:** field-relay-nba
**Branch:** main — commit directly, do not create a feature branch or PR
**Type:** A (measurement) — **this document ships no model and changes no coefficient**
**Status:** STOPPED AT TASK 1, 2026-10-11, by this document's own stop
condition: *"If `homeWinProbability` in 2020 is sparse, unit-ambiguous, or on a
different row grain, STOP and report rather than aligning by assumption."*
Tasks 2-6 were not executed. Artifact:
`outbox/hockey-wp-resplit-moneypuck-latest.json` (run 38119987123).

**THE CENTRAL PREMISE IS REFUTED. 2020's `homeWinProbability` IS EMPTY ON
78,611 OF 78,611 ROWS.**

```
homeWinProbability   absent_from_header 0   empty 78611   na_literal 0
                     unparseable 0          usable 0
                     "present in the header and carrying NO usable value"
```

This document reads `optional_columns_absent_by_season: { "2020": [] }` as
"present only in 2020". That list records which columns are **absent from the
header**, and an empty list means none were. It says nothing about whether any
row carries a value — which is exactly the presence-versus-population
distinction the predecessor's own four-state census was built for, applied to
2024 and never run on 2020.

**So there is no MoneyPuck baseline in ANY season file**, and
`beats_moneypuck: null` on the shipped artifact is not a gap to be filled. It is
the correct value. The thing this document set out to measure does not exist in
the data it planned to measure it from.

Task 1 is explicit about what that means: *"a baseline measured on a biased
subset of 2020 is worse than `null`, because `null` cannot be quoted."* A
100% null rate is the limit of that case.

### What the run established anyway

The re-split ran to completion before the column was read, so it carries one
real result: **a model fit on 2021-2023 and tested on 2020 scores Brier
0.17404**, against the shipped model's 0.172669 on 2023 and constant-0.5 at
0.25. Two different models on two different test seasons land within 0.0014 of
each other. That is weak evidence and it points the same way: the approach, not
one lucky split, is what produced the number.

Task 6 asked for a tension report if the two disagreed. They do not.

### Done condition 6 held, and it needed enforcing

`src/hockey-wp.js`, `src/hockey-wp-model.js` and
`outbox/hockey-wp-calibration-latest.json` are **unchanged** — all still at
commit `a062e1f`. That was not automatic. Taken literally, *"same code path,
only the split changes"* would have replaced them: the trainer writes
`hockey-wp-calibration-latest.json` unconditionally and the workflow git-adds
and pushes it along with the coefficient file. A re-split run would have pushed
a model fit on a different split over the deployed one, and overwritten the
evidence its gate rests on. `--out` and `--no-model-write` were added first, and
the workflow now stages only the artifact a run was told to write.

**What would unblock this document:** a MoneyPuck source that actually carries
the column — their shots files do not, in any season checked (2020, 2021, 2022,
2023, 2024). That is a different source, and it needs its own document rather
than a quiet substitution here.

**Rule F:** comparing our own probability against a published one. Commodity.
**Rule A:** pull only. No cron.
Follows `docs/CC-CMD-2026-10-10-nhl-win-probability-from-xg.md` (DONE).

## Why this exists

The WP model cleared its gate on three baselines and left the fourth blank:

```
beats_constant_half:  true    (0.172669 vs 0.25)
beats_market_overall: true    (0.171551 vs 0.228414 on market games)
beats_market_pregame: false   (0.247177 vs 0.232640)
beats_moneypuck:      null    ← this
```

`null` is the honest value — Rule 99, absence as a sibling of the value — and it
is also the only baseline that matters competitively. Constant-0.5 is a floor.
The market is a different kind of estimate. **MoneyPuck is the published hockey
win-probability model, and we do not know whether ours is better than it.**

It is unmeasured for a specific, fixable reason. `homeWinProbability` is absent
from the 2021, 2022 and 2023 season files and present only in 2020:

```
optional_columns_absent_by_season:
  "2020": []
  "2021": [homeTeamScore, roadTeamScore, homeWinProbability, wentToOT, wentToShootout, timeLeft, gameOver]
  "2022": [ … same … ]
  "2023": [ … same … ]
```

The holdout is a whole season, and the holdout chosen was not 2020. So the only
season carrying the baseline was in the training set, where comparing against it
would measure memorisation. The fix is a second split, not a second source.

## The honesty constraint that defines this task

A model fit on 2021–2023 and tested on 2020 is **a different model** from the
one that shipped. Its coefficients differ. Its Brier against MoneyPuck is
evidence about **the approach**, not about the deployed numbers.

So this is the single easiest place in the entire WP effort to publish a true
sentence that misleads: *"FIELD's model beats MoneyPuck at 0.1x vs 0.1y."*
Every digit could be correct and the claim still false, because the model that
beat MoneyPuck is not the model serving `/nhl/wp`.

**Do not resolve `beats_moneypuck` on the shipped artifact from a re-split run.**
It gets its own field, its own artifact, and a name that says what it is.

## Tasks

**Task 1 — probe the column before trusting it.** `optional_columns_absent_by_season`
records that the **column exists** in 2020. It does not record that it is
**non-null on every row**. Before any fitting, report for 2020: total rows,
rows where `homeWinProbability` is non-null, and the null rate as a fraction
with its denominator. Also report its range and whether it is `[0,1]` or
`[0,100]` — a percentage read as a probability would produce a Brier near 0.25
that looks like a plausible bad model instead of a unit error.

If the null rate is material, **report it and stop**; a baseline measured on a
biased subset of 2020 is worse than `null`, because `null` cannot be quoted.

**Task 2 — the re-split, as a parallel run.** Fit on 2021, 2022, 2023; test on
2020. Same 9 features, same xG model, same pipeline, same code path — **only the
split changes.** Emit
`outbox/hockey-wp-resplit-moneypuck-<ts>.json` containing:

- Brier and log loss for the re-split model on 2020
- Brier and log loss for MoneyPuck's `homeWinProbability` on **the identical
  rows** — same filter, same exclusions, same n. Report the n once and assert
  both baselines used it.
- `constant_half` on those same rows, as the sanity floor
- The re-split model's own coefficients and intercept, so the run is reproducible
- The same split breakdowns the shipped artifact carries: `power_play`,
  `even_5v5`, `final_two_minutes`, `empty_net`
- `beats_moneypuck_resplit: true | false` — **this name, not `beats_moneypuck`**

**Task 3 — the pre-game split, which is where we already know we lose.**
`beats_market_pregame: false` is the shipped model's one open failure (0.247177
vs 0.232640). MoneyPuck's number exists pre-game too. Report the re-split
model's Brier against MoneyPuck's **restricted to states before the first shot**,
separately from the overall figure. If we lose pre-game to MoneyPuck as well,
that is two independent sources agreeing that the pre-game prior is the weak
component, which is a finding worth more than the headline.

**Task 4 — state what cannot be controlled.** MoneyPuck's own model was very
likely fit on seasons including 2020, so its 2020 numbers may be partly
in-sample while ours are strictly out-of-sample. That asymmetry **favours
MoneyPuck** and cannot be removed. Record it in the artifact as a named premise,
not a footnote. If we win anyway, the asymmetry makes the result stronger; if we
lose narrowly, it is the first thing a reader must know.

**Task 5 — the shipped artifact gains one line and loses none.**
`hockey-wp-calibration-latest.json` keeps `beats_moneypuck: null`, because that
remains true of the shipped coefficients. Add a reference to the re-split
artifact beside it so a future reader finds the measurement instead of
re-deriving that it is missing. The model's premise block gains the re-split
result as context.

**Task 6 — the one condition that re-opens the ship decision.** If the re-split
model loses to MoneyPuck by a wide margin on 2020 while the shipped model beats
the market on 2021–2023, the two results are in tension and the approach needs a
look before more features are added on top. **Report that tension; do not
resolve it in this document and do not revert anything.** A model that ships at
0.171551 against a measured market baseline keeps shipping on that evidence.

## Stop conditions

- Do not change `hockey-wp.js`, its coefficients, or `beats_moneypuck` on the
  shipped artifact.
- Do not re-split the shipped model. The deployed coefficients come from the
  original split and stay there.
- Do not report a combined or averaged Brier across the two splits. They are
  different models on different test sets; an average of them means nothing.
- If `homeWinProbability` in 2020 is sparse, unit-ambiguous, or on a different
  row grain, STOP and report rather than aligning by assumption.

## Done conditions

1. 2020's `homeWinProbability` null rate, range and unit are reported with
   denominators, before any fitting.
2. A re-split artifact exists carrying both Brier scores on an identical,
   stated n, plus `constant_half`, the coefficients, and the four splits.
3. `beats_moneypuck_resplit` is `true` or `false` — never `null` once the
   column probe has cleared.
4. A separate pre-game figure is reported against MoneyPuck.
5. The in-sample asymmetry is a named premise in the artifact.
6. `hockey-wp.js` and `hockey-wp-calibration-latest.json`'s
   `beats_moneypuck: null` are unchanged; only a cross-reference is added.
