# CC-CMD: Upset-bonus model v2 — both v1 blockers resolved

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Supersedes:** the v1 attempt's honest 20/100 stop. Both blockers it
found are addressed below — one was a real gap, one was a
misidentification of scope.

## Blocker 2 resolved — this was never about jubilant-bassoon

The v1 report found the rankGap/upsetBonus heuristic in jubilant-
bassoon's `index.html` and correctly noted that repo isn't accessible
from here. **That's true but irrelevant — it was never the target.**
This doc's own header has always said "Repo: field-relay-nba (sole)."
The actual target is **this repo's own copy**, confirmed present right
now:

```javascript
// scripts/drama-backfill.mjs, lines 69-70
const rankGap = Math.abs(homeRank - awayRank);
if (rankGap >= 30 && diff <= 1) upsetBonus = Math.min(15, Math.floor(rankGap / 10));
```

Do not attempt to reach jubilant-bassoon. Do not treat its inaccessibility
as a blocker — it was never in scope.

## Blocker 1 resolved — real gap, principled fix using existing infrastructure

Confirmed directly: D1's `regular_season_games` schema genuinely has no
`home_rank`/`away_rank`/`rank_gap` columns — v1's finding here was
correct, not a misread. Reconstructing *historical* rankings at each
game's actual kickoff date, from nothing, would be fabrication — v1 was
right to refuse that.

**The resolution is not reconstruction — it's using real, current data
as an explicitly-stated proxy.** The relay's `/fifa-rankings/{team}`
endpoint is confirmed live right now (`Argentina → rank 1, 1877.27 pts,
real Parse.bot data`). All 89 WC26 games with populated `drama_peak`
are within the last ~5 weeks (since 2026-06-01) — recent enough that
*current* FIFA rankings are a reasonable, honestly-caveated proxy for
*at-kickoff* rankings, not a fabrication of history. This is a stated
approximation, not an invented fact — document it as such in the
model's own metadata/comments, not silently.

**Target time:** ~40 min

## CONFIDENCE GATE
Do not commit unless confidence ≥ 95.

## PROBE BLOCK
```bash
grep -n "rankGap\|upsetBonus" scripts/drama-backfill.mjs
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/fifa-rankings/Argentina"
```
Re-confirm both fresh — the FIFA endpoint's KV cache refreshes weekly,
values may have shifted since 2026-07-05.

## TASK 1 — Fetch current rankings for all 89 WC26 teams

Query D1 for the distinct home/away team names among the 89 populated
WC26 rows. Fetch each team's current rank via `/fifa-rankings/{team}` —
reuse the alias handling already proven this session (Cabo Verde, Korea
Republic, Côte d'Ivoire naming mismatches) rather than re-deriving it.

## TASK 2 — Fit a real model against real data

With `drama_peak` (Y, already populated) and current-rank-based
`rank_gap` (X, now available as a stated proxy) for all 89 games, fit
an actual model — same requirement as before: report the real approach
tried, don't assume logistic regression is right without checking the
data's actual shape first.

## TASK 3 — Replace the heuristic in this repo's file, preserve the interface

Replace lines 69-70 in `scripts/drama-backfill.mjs` with the fitted
model's output, same integration point, same variable name (`upsetBonus`),
so nothing downstream needs to change.

## TASK 4 — Verify against real games

Confirm real, sensible before/after `upsetBonus` values for actual games
already used to validate the original heuristic this session (Argentina/
Cape Verde and any other real rank-mismatch game in the 89).

## SCOPE BOUNDARY

DO:
- Target scripts/drama-backfill.mjs in this repo, nothing else
- Use current FIFA rankings as an explicitly-documented proxy for at-kickoff rank
- Fit a real model, report the actual approach
- Verify against real games

DO NOT:
- Attempt to reach jubilant-bassoon for any reason
- Reconstruct historical rankings from scratch — the current-rank proxy is the resolution, not a stopgap needing further fabrication
- Silently present the current-rank proxy as if it were true historical data — document the approximation explicitly

## DONE CONDITIONS
- [ ] Probe block re-run, both fixes re-confirmed fresh
- [ ] Current rankings fetched for all 89 teams, aliases reused correctly
- [ ] Model fitted, real approach reported and justified
- [ ] Heuristic replaced at the correct integration point (this repo, not jubilant-bassoon)
- [ ] Verified against real games with actual before/after values
- [ ] Outbox manifest written, explicitly noting the current-rank-as-proxy approximation

## CONFIDENCE SCORING TABLE
+15  Confirmed correct target (this repo, not jubilant-bassoon)
+25  Current rankings fetched correctly for all 89 teams
+30  Real model fitted, approach reported honestly
+20  Heuristic replaced at the correct integration point
+10  Verified against real games, approximation explicitly documented

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-upset-model-v2.md. The target has
always been THIS repo's scripts/drama-backfill.mjs (lines 69-70) -- do
not attempt to reach jubilant-bassoon, it was never in scope. For the
real rank_gap gap: fetch CURRENT FIFA rankings via the already-live
/fifa-rankings/{team} endpoint for all 89 WC26 teams with populated
drama_peak, use that as an explicitly-documented proxy for at-kickoff
rank (all games are within 5 weeks of today, this is a stated
approximation, not fabrication). Fit a real model, replace the
heuristic at the same integration point, verify against real games. Do
not commit unless confidence ≥ 95. If score < 95 report verbatim and stop.
