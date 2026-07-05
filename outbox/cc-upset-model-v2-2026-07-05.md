# Upset-Bonus Model v2 — 2026-07-05

## Commits

- `3534251` feat(model): replace rankGap upset heuristic with fitted model (WC26 data)
- `a7c6766` ci: remove one-shot WC26 rank-fetch scaffold (model fitting complete)

## What Changed

**Target**: `scripts/drama-backfill.mjs` lines 68-71 (soccer `upsetBonus` calculation)

**Old heuristic**:
```js
if (rankGap >= 30 && diff <= 1) upsetBonus = Math.min(15, Math.floor(rankGap / 10));
```

**New fitted model**:
```js
if (diff <= 1) upsetBonus = Math.max(0, Math.min(15, Math.round(-3.49 + 0.123 * rankGap)));
```

## Data Source

- FIFA rankings fetched via `/fifa-rankings/{team}` endpoint (run 28745551795, 2026-07-05)
- 45/48 WC26 teams resolved; 3 teams returned 404 (Bosnia-Herzegovina, Iran, United States)
  - aliases tried: exact D1 names — no alias found in relay at time of fitting
  - 10 games excluded from fitting (of 89 populated WC26 games)
- **Current rankings used as stated proxy for at-kickoff rankings**: all 89 WC26 games played
  within ~5 weeks of 2026-07-05; explicitly documented, not silently presented as historical fact

## Model Fitting (Python/OLS on 79 games)

**Full OLS**: drama = 62.20 − 3.33·score_diff + 0.121·rank_gap, R²=0.405

**Correlation analysis**:
- rank_gap alone: r=0.173, p=0.128 (not significant marginal)
- score_diff alone: r=−0.553, p<0.0001 (dominant predictor)
- rank_gap partial (controlling score_diff): r=0.370, p<0.001 (significant)

**Close-game subset** (score_diff ≤ 1, n=44):

| rank_gap tier | n | drama mean |
|---|---|---|
| [0,20) | 19 | 63.0 |
| [20,40) | 14 | 61.2 |
| [40,60) | 6 | 68.7 |
| [60,100) | 5 | 71.0 |

**Close-game upset signal**: drama_delta = −3.49 + 0.123·rank_gap (r=0.335, p=0.026, n=44)

Effective threshold from intercept/slope: rank_gap ≈ 28.4 (nearly identical to hand-picked 30).
Slope 0.123/pt vs old 0.1/pt (slightly steeper, statistically grounded).

## Bonus Comparison (old vs new, at diff ≤ 1)

| rank_gap | old | new |
|---|---|---|
| 0 | 0 | 0 |
| 30 | 3 | 0 |
| 40 | 4 | 1 |
| 50 | 5 | 3 |
| 60 | 6 | 4 |
| 70 | 7 | 5 |
| 80 | 8 | 6 |

## Verification Against Real Games (D1 before/after, backfill run 28745760869)

| Game | gap | score | drama (before) | drama (after) | bonus change |
|---|---|---|---|---|---|
| Argentina vs Cape Verde | 66 | 3-2 | 82 | **81** | 6→5 |
| England vs Ghana | 69 | 0-0 | 76 | **75** | 6→5 |
| Spain vs Cape Verde | 65 | 0-0 | 76 | **75** | 6→5 |
| Germany vs Paraguay | 31 | 1-1 | 65 | **62** | 3→0 |
| Portugal vs Croatia | 6 | 2-1 | 78 | 78 | 0→0 (unchanged) |

Germany vs Paraguay (-3): rank gap of 31 barely exceeded old threshold of 30; fitted model
correctly assigns ~0 at that level (−3.49 + 0.123·31 ≈ 0.3 → rounds to 0).

## Compliance

- Rule 47: drama-backfill computes scores locally, writes facts via relay POST
- Rule 68: probe block run (grep confirmed target lines; relay endpoint confirmed via CI)
- Rule 87: self-completing — model fitted, code replaced, backfill re-run, D1 verified in session
- Approximation documented: current rankings as proxy for at-kickoff rank (5-week window, stated)
