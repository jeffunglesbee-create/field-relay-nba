# CC Session — 2026-08-16 — execute CC-CMD-2026-08-15-quality-bar-scale

## Scope
Execute all three asks of `docs/CC-CMD-2026-08-15-quality-bar-scale.md` (filed by
field-laboratory). Reporting/measurement only — **no scoring behaviour changes**.

## HEAD
`be8b38f` → `665c68f`. Both files syntax-checked; exports verified to resolve.

## The finding being served
55 of the 300 rubric points are unreachable BY CONSTRUCTION in the Worker runtime:
Dims 7 (context) and 10 (matchup) have no game object and return N/A→0. So a flat
240 bar is 80.00% of the nominal rubric but **97.96%** of what a brief here can
actually earn, and `below_240` sitting near 100% is an arithmetic certainty, not an
editorial verdict. The CC-CMD ran its own falsifying test before filing (0 of 25
rows reach 240; 7 of 25 reach 196) and survived it.

## What was executed

### Ask 3 — derive the ceiling (done first; it supplies asks 1 and 2)
The breakdown existed only as a header comment, so `245` was a number a reader had
to trust and a maintainer had to remember to update. Added to
`src/journalism-quality.js`:

```js
export const SCALE = { spec:30, statDepth:38, variety:30, density:16, fresh:36,
                       arc:45, ctx:25, temporal:20, voice:30, matchup:30 };
export const UNREACHABLE_DIMS = ['ctx', 'matchup'];   // no game object in this runtime
export const NOMINAL_TOTAL       = <sum of SCALE>                 // 300
export const REACHABLE_CEILING   = <sum minus unreachable>        // 245
export const FOUR_FIFTHS_REACHABLE = round(REACHABLE_CEILING*0.8) // 196
```

**Single-sourced, not duplicated.** `scoreProse`'s local `W` now derives from
`SCALE` rather than holding a second copy of the same five numbers. Two parallel
copies would drift — which is precisely the failure this ask exists to prevent (a
ceiling that no longer matches the weights in play). Same values, so scoring is
byte-identical in behaviour.

VERIFIED — the derivation reproduces every documented figure, asserted in-session:
```
base(dims1-5)      = 150   (header comment says 150)
NOMINAL_TOTAL      = 300   (rubric says 300)
REACHABLE_CEILING  = 245   (header comment says 245)
FOUR_FIFTHS        = 196   (CC-CMD says 196)
240 as % of nominal   = 80.00%   (CC-CMD: 80.00%)
240 as % of reachable = 97.96%   (CC-CMD: 97.96%)
unreachable          = ctx, matchup = 55 points
ALL ASSERTIONS PASSED
```

### Ask 1 — name the scale wherever the flat bar is reported
`/quality/report` now emits, alongside the existing counts:
```
quality_scale: {
  nominal_total, reachable_ceiling, unreachable_dims, unreachable_points,
  flat_bar: 240, flat_bar_pct_of_nominal, flat_bar_pct_of_reachable,
  four_fifths_of_reachable
}
```
**Emitted alongside rather than renaming** `below_240`/`above_240`. The CC-CMD
offered either option; renaming is a breaking contract change for every current
consumer of the endpoint (Rule 60 — the relay owns the contract, which also means
it must not silently rewrite it). Values are read from the derived constants, not
hardcoded, so they move with ask 3.

### Ask 2 — cleared_196
The CC-CMD called this count "the one thing worth running D1 for" and left it as
the single open item. **It does not need a separate D1 session.**
`/quality/report`'s existing query is already a `GROUP BY brief_type, sport` over
`ARCHIVE_DB` that computes `below_240`/`above_240` with the identical
`SUM(CASE WHEN …)` shape. Added one line to that same query:

```sql
SUM(CASE WHEN quality_score >= 196 THEN 1 ELSE 0 END) as cleared_196
```

So the adoption question the CC-CMD deferred — is 196 genuinely discriminating, or
practically another unreachable bar — is now answerable from the endpoint on every
call, permanently, instead of a one-off run that goes stale the next day. This is
what makes the CC-CMD self-completing (Rule 87) rather than leaving a carry-forward.

## Correction to an earlier claim in this session
I stated the CC-CMD sat on a `claude/*` branch and flagged it as a branch-policy
violation. **That was wrong** — `14ac236`/`55a3a34` are on `main`. I misread a
coincidental "[new branch]" line printed by an unrelated `git fetch`. No violation.

## Integration status
- Code: **VERIFIED** statically — `node --check` on both files; all four imported
  names resolve (`NOMINAL_TOTAL`, `REACHABLE_CEILING`, `UNREACHABLE_DIMS`,
  `FOUR_FIFTHS_REACHABLE`); derivation assertions above all pass.
- Live response: **UNVERIFIED from this sandbox** (it 403s `*.workers.dev`).
  Deploy is push-triggered, so this lands on the next deploy.
  DONE CONDITION (Rule 90 artifact): `GET /quality/report` must return
  `quality_scale.reachable_ceiling === 245` and every `summary` row must carry a
  numeric `cleared_196`. Verify with:
  `curl -s "$RELAY/quality/report?days=7" | node -e 'const d=JSON.parse(require("fs").readFileSync(0,"utf8")); console.assert(d.quality_scale?.reachable_ceiling===245,"ceiling"); console.assert(d.summary.every(r=>typeof r.cleared_196==="number"),"cleared_196"); console.log("PASS", d.quality_scale, d.summary.length+" rows");'`

## Scope boundary honoured
Did NOT touch: the alert predicate (already correct — per-brief_type calibrated
percentiles, `threshold_source: brief_type_p25`), any scoring function's output,
or any existing response field name.

## Related, NOT executed here
`docs/CC-CMD-2026-08-16-quality-coverage-route.md` (filed `be8b38f`, hours later)
asks to expose `scripts/jq-scoring-coverage.mjs` on a GET — per-day coverage
series, `era3ByType`, and `scoring_version` on `/archive/query` rows. Separate
CC-CMD, separate concern, untouched by this session. Worth noting the two are
complementary: this one names the scale, that one exposes coverage over time.
