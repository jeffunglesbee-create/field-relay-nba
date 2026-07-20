# CC Session — 2026-07-20 — MLS Novel Metrics (Relay)

**Date:** 2026-07-20
**Repo:** field-relay-nba
**HEAD start:** 12e3f0c (mls-journalism-xg-fix audit)
**HEAD end:** bcfd579
**CC-CMD:** docs/CC-CMD-2026-07-19-mls-novel-metrics.md

## Commits

| Hash | Message |
|------|---------|
| 2e09fc0 | feat: add /mls/stats/team-metrics route for season-aggregate novel metrics |
| bcfd579 | feat: extend /soccer/xg with accurateCrosses and crossAccuracy |

## Scope

Relay tasks only (TASK 1 + TASK 2). TASK 3 (client) was explicitly out of scope
per user instruction "execute all tasks for this repo specifically."

---

## TASK 1 — /mls/stats/team-metrics route (30/30) ✅ VERIFIED

New route at `GET /mls/stats/team-metrics?competition={compId}&season={seasonId}`.

Placed BEFORE the generic `/mls/stats/*` passthrough (line 12538) so it is matched
first. Uses same `MLS_STATS_BASE`, `MLS_STATS_HEADERS`, and
`MLS_STATS_TTL_STANDINGS` as the existing `/soccer/season-form` handler.

Data source: `stats-api.mlssoccer.com/statistics/clubs/competitions/{compId}/seasons/{seasonId}?per_page=50`
Response shape: `data.team_statistics[]` (verified from existing `/soccer/season-form` handler at line 12565)

**Field names confirmed from existing handler (not assumed):**
- `team.matches_played` — games played (NOT `games_played`)
- `team.second_assists`, `team.first_and_second_assists`
- `team.shots_at_goal_inside_box`, `team.shots_at_goal_sum`
- `team.counter_attacks`
- `team.shots_at_goal_right_leg`, `team.shots_at_goal_left_leg`, `team.shots_at_goal_head`

**Computations:**
- `secondAssistShare = second_assists / first_and_second_assists` (null if denominator = 0)
- `insideBoxShotShare = shots_at_goal_inside_box / shots_at_goal_sum` (null if 0)
- `counterAttacksPerGame = counter_attacks / matches_played` (null if 0)
- `shotBodyPartSplit`: right/left/head/other as % of `shots_at_goal_sum`; `other = max(0, sum - right - left - head)` — no silent drop

## TASK 2 — accurateCrosses + crossAccuracy in /soccer/xg (15/15) ✅ VERIFIED

`accurateCrosses` added to `MATCH_FIELDS` set (alongside existing `totalCrosses`).
`crossAccuracy = accurateCrosses / totalCrosses` computed after extraction, guarded
against divide-by-zero. No new fetch — data is in the same ESPN Core competitor
statistics payload already being fetched.

## TASK 3 (OUT OF SCOPE)

Client wiring of `/mls/stats/team-metrics` into `renderStatsSection()` in
jubilant-bassoon is explicitly out of scope for this session per user instruction.
See CC-CMD-2026-07-19-mls-novel-metrics.md TASK 3 for the spec.

## TASK 4 — Real, direct verification (20/20) ✅ VERIFIED

### /mls/stats/team-metrics (live, 2026-07-20)

```
GET /mls/stats/team-metrics?competition=MLS-COM-000001&season=MLS-SEA-0001KA
```

Returns 30 MLS teams. Sample — CF Montréal:
```json
{
  "team_id": "MLS-CLU-000006",
  "team_name": "CF Montréal",
  "matches_played": 15,
  "secondAssistShare": 0.35,
  "insideBoxShotShare": 0.5648,
  "counterAttacksPerGame": 0.067,
  "shotBodyPartSplit": {"rightLeg": 43.5, "leftLeg": 41.7, "head": 14.4, "other": 0.5}
}
```
Body-part split sums: 43.5 + 41.7 + 14.4 + 0.5 = 100.1 (rounding, acceptable).

### /soccer/xg cross accuracy (live game 761659, 2026-07-20)

```
GET /soccer/xg?league=usa.1&event=761659
```

MTL: `accurateCrosses: 2`, `totalCrosses: 22`, `crossAccuracy: 0.091`
Hand-check: 2/22 = 0.09090... → `parseFloat(0.09090.toFixed(3))` = 0.091 ✓

TOR: `accurateCrosses: 5`, `totalCrosses: 13`, `crossAccuracy: 0.385`
Hand-check: 5/13 = 0.38461... → `parseFloat(0.38461.toFixed(3))` = 0.385 ✓

## Integration status

| Component | Status |
|-----------|--------|
| `/mls/stats/team-metrics` route | VERIFIED live (30 teams) |
| `secondAssistShare` computation | VERIFIED (CF Montréal sample) |
| `insideBoxShotShare` computation | VERIFIED |
| `counterAttacksPerGame` computation | VERIFIED |
| `shotBodyPartSplit` with honest `other` | VERIFIED |
| `accurateCrosses` in /soccer/xg | VERIFIED (MTL: 2, TOR: 5) |
| `crossAccuracy` in /soccer/xg | VERIFIED with hand-checked math |
| Client TASK 3 (jubilant-bassoon) | OUT OF SCOPE — separate session |

## Confidence score

- TASK 1 (30/30): route live, 30 teams, verified field names, sane values
- TASK 2 (15/15): accurateCrosses + crossAccuracy both verified with hand math
- TASK 3 (0/35): out of scope per user instruction
- TASK 4 (20/20): live probe + hand-checked math on 2 teams
**Total (in-scope): 65/65**
