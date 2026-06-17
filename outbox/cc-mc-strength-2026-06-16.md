# Monte Carlo Strength Model Improvements — 2026-06-16

Implements changes 1-8 from the CC prompt, single-concern commits in priority order. See the drive spec for full rationale. Rule 59 audit: all changes are server-side editorial strength modeling. No drama scoring, no Rule 47 violation, no ADR-002 impact.

## Change 1 — Rank-derived lambda priors (commit `d797cc4`)

New `rankBasedStrengths()` builds {attack, defense} for all 48 WC_TEAM_CONTEXT teams from `fifaRank`. Tuning knob `RANK_SPREAD = 0.35`. `deriveTeamStrengths` now uses this map both as the empty-odds fallback and as the per-team unmeasured fill, replacing the previous flat-`BASE_LAMBDA` default that compressed all 48 teams to identical strength.

## Change 2 — Confederation strength multipliers (commit `7739b48`)

`CODE_TO_CONFED` (48 teams) + `CONFED_MULTIPLIER` (UEFA 1.06, CONMEBOL 1.04, CONCACAF 1.00, CAF 0.97, AFC 0.96, OFC 0.92). Applied to attack lambda only inside `rankBasedStrengths()` before the `[0.4, 2.0]` clamp.

## Change 3 — Host nation home advantage (commit `ca90883`)

`HOST_CODES = {USA, MEX, CAN}`, `HOST_BOOST = 0.18`. `h2hLambdas` adds the boost to each host's attack lambda when present, before the `Math.max(0.2)` floor.

## Changes 4+5 — Result quality + dynamic prior decay (commit `dcb4388`)

In `applyBayesianUpdate`:
- Per-result `qualityWeight = 1 + 0.15 * |hScore - aScore|` scales the observation's contribution to (attSum, defSum, games).
- Per-batch `dynamicPrior = max(0.5, 3.0 - d1Results.length * 0.03)` replaces the static `PRIOR_WEIGHT = 3`. Decays smoothly across the group stage: ~3.0 pre-tournament → ~2.28 after MD1 → ~1.56 after MD2 → ~0.84 after MD3 (floor 0.5).

## Change 6 — Cross-match triangulation (commit `13df439`)

Second pass in `deriveTeamStrengths`, active only when `oddsProbs.length > 0`. For each team with `count < 2`, find bridge teams that share an opponent; infer `att = bridge.observedAtt × (BASE_LAMBDA / bridge.defense)` (mirror for defense) and blend at 0.5 weight per spec.

## Change 7 — Totals-line priority **(no code change — already correct)**

Verified against `src/index.js:1666-1677` in `handleWCOddsProbs`:

```js
if (tot.n > 0) {
    const lambdaTotal = tot.line / tot.n;
    const lams = lambdaFromTotalsAndH2H(lambdaTotal, pH, pD);
    lh = lams.lh; la = lams.la;
    lambdaSource = 'totals';
} else {
    const lams = oddsToLambda(pH, pD, pA);
    lh = lams.lh; la = lams.la;
    lambdaSource = 'h2h-inversion';
}
```

The endpoint already prefers `lambdaFromTotalsAndH2H` when totals market data is present. No change needed; the `lambdaSource` field on each prob row records which path produced the lambdas (`'totals'` vs `'h2h-inversion'`) so callers can audit if needed.

## Change 8 — Temporal freshness weighting (commit `05ea86b`)

In the per-fixture accumulator inside `deriveTeamStrengths`, freshness weight scales the COUNT contribution (not the lambda values themselves): kickoff < 24 h → 1.00; 24-72 h → 0.85; > 72 h → 0.70. Recent odds carry more influence in the per-team weighted average without distorting magnitude.

## Validation plan (after deploy)

`GET /wc/projections` cron will refresh at next 15-min tick.

Expected effects:
- 48 teams present, pChamp sums to ~1.0
- Top team pChamp above 5% (vs ~3.6% pre-change), bottom team below 0.5% (vs ~0.3%)
- France, Argentina, Spain, Germany, England all in top 8
- USA, Mexico, Canada show host-boost uplift
- No rank-85 team above rank-10 without actual result justification

Probe via `/wc/match-wp?home=…&away=…` to spot-check individual fixtures without waiting for the cron.
