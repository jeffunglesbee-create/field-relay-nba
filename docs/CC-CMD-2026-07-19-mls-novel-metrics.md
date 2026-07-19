# CC-CMD — MLS novel metrics: second-assist share, shot-location quality, counter-attack identity, cross efficiency

**Date:** 2026-07-19
**Repo:** BOTH — relay tasks in field-relay-nba, client tasks in jubilant-bassoon
**Branch:** main — commit directly on each repo. No PRs.

git remote get-url origin | grep -qE "field-relay-nba|jubilant-bassoon" || { echo "WRONG REPO"; exit 1; }; git log --oneline -5

---

## CONTEXT

Four real, directly-grounded MLS metrics, each confirmed buildable from
already-verified, already-live data sources tonight — not new sources, not
speculative fields. All four are genuinely simpler than the separate
defensive-substitution CC-CMD (`CC-CMD-2026-07-19-mls-sub-impact-metric.md`)
— no per-athlete lookups, no timeline reconstruction, single real API call
per metric.

**Real, confirmed data sources (re-verify fresh from HEAD, don't trust this
list blindly — payload shapes can drift):**

1. `stats-api.mlssoccer.com/statistics/clubs/competitions/{compId}/seasons/{seasonId}`
   (via relay's `/mls/stats/statistics/clubs/...` passthrough, already
   allowlisted) — real, season-aggregate team fields confirmed present:
   `second_assists`, `first_and_second_assists`, `assists`,
   `shots_at_goal_inside_box`, `shots_at_goal_outside_box`,
   `shots_at_goal_sum`, `counter_attacks`, `shots_at_goal_right_leg`,
   `shots_at_goal_left_leg`, `shots_at_goal_head`.

2. `site.api.espn.com/apis/site/v2/sports/soccer/usa.1/summary?event={id}`
   → `boxscore.teams[].statistics[]`, confirmed present: `accurateCrosses`,
   `totalCrosses`. Per-game, not season-aggregate — same source already
   used for xG in the sibling CC-CMD.

---

## PRE-BUILD PROBE BLOCK

```bash
# Relay repo
git log --oneline -5
grep -n "MLS_STATS_ALLOWED_PREFIXES" src/index.js
# Re-confirm real, current season/competition IDs are still accurate
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mls/stats/statistics/clubs/competitions/MLS-COM-000001/seasons/MLS-SEA-0001KA?per_page=5" | head -c 500
```

```bash
# Client repo
grep -n "function renderStatsSection" src/legacy/field.js
sed -n '/EPL/,/blocks.push/p' src/legacy/field.js | head -40
```

Confirm the real, current `renderStatsSection` EPL block's exact structure
before extending it — use it as the pattern to follow, don't invent a new
one.

---

## TASK 1 (relay) — New route: `/mls/stats/team-metrics`

`GET /mls/stats/team-metrics?competition={compId}&season={seasonId}`

Real algorithm:
1. Fetch the real, season-aggregate team statistics (source 1 above).
2. For each real team, compute:
   - `secondAssistShare` = `second_assists / first_and_second_assists`
     (real percentage of total creative output that's a second assist,
     not primary) — guard against divide-by-zero.
   - `insideBoxShotShare` = `shots_at_goal_inside_box / shots_at_goal_sum`
     — real shot-selection-quality ratio.
   - `counterAttacksPerGame` = `counter_attacks / {real games played —
     confirm the real field name for this, don't assume it's named
     exactly "games_played"}`.
   - `shotBodyPartSplit` = real percentages of
     right_leg/left_leg/head/other from the real, confirmed shot-body-part
     fields, summing to 100 (or close, given `shots_at_goal_body` and
     similar minor categories exist — handle the real remainder honestly,
     don't silently drop it).
3. Return a real, per-team array, sorted by team name (client can re-sort
   for its own leaderboard needs).

## TASK 2 (relay) — Extend the existing per-game endpoint with real cross data

**⚠️ SEQUENCING NOTE — real dependency, read before starting this task
specifically:** `docs/CC-CMD-2026-07-19-mls-journalism-xg-fix.md` also
modifies this exact same `/soccer/xg` handler, establishing baseline MLS
support on the route. That CC-CMD must land first — this task builds on
top of working MLS support, not a route that may not yet correctly serve
`usa.1`. Before starting: `git log --oneline -10` and check whether the
XG-fix CC-CMD's commit has already landed. If not, either wait or confirm
directly with whoever's coordinating execution — do not proceed on an
assumption that the route is already MLS-ready.

In the real, existing `/soccer/xg` handler (or a sibling route if cleaner
— confirm the real, current structure first), add real `accurateCrosses`/
`totalCrosses` extraction from the same summary payload already being
fetched for xG, computing `crossAccuracy = accurateCrosses/totalCrosses`.
No new fetch — this data is already in the same real response.

## TASK 3 (client) — Wire into the existing Stats tab

**⚠️ SEQUENCING NOTE — real, mechanical race with two sibling CC-CMDs,
read before starting this task:** `docs/CC-CMD-2026-07-19-mls-sub-impact-metric.md`
(its own Task 4) and `docs/CC-CMD-2026-07-19-bottom-sheet-stats-reconciliation.md`
(its own Task 1) both also add real, new content to this exact same
`renderStatsSection()` function. This is a mechanical overlap, not a
logical dependency — none of the three sub-sections depend on each
other's actual content — but all three editing the same function body in
parallel risks a real merge conflict or one session's changes silently
overwriting another's. **Execute these three sequentially, not in
parallel — re-pull and re-read the real, current state of
`renderStatsSection()` immediately before starting this task, even if
this doc's own probe block was run earlier the same session.** If either
sibling CC-CMD's commit has already landed, build on top of its real,
current diff rather than the version of the function this doc originally
investigated.

Add an **MLS** block to `renderStatsSection()`, following the real,
established pattern from the existing EPL block (same `row()` helper, same
graceful-empty-state handling if the data map is unpopulated). Real
sub-sections:
- Second-assist leaderboard (top 8, sorted by `secondAssistShare`)
- Shot-selection quality (top 8, sorted by `insideBoxShotShare`)
- Counter-attack identity (top 8, sorted by `counterAttacksPerGame`)
- Cross accuracy (top 8, sorted by `crossAccuracy`, per-game basis — clarify
  in the UI label that this is single-game, not season-aggregate, since
  it comes from a different real source/cadence than the other three)

Fetch the new relay endpoint via the same established pattern
`fetchV2AllScores`/similar functions already use for other relay calls —
confirm the real, current convention rather than inventing a new fetch
wrapper.

## TASK 4 — Real, direct verification

```bash
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/mls/stats/team-metrics?competition=MLS-COM-000001&season=MLS-SEA-0001KA" | head -c 800
```
Confirm real, computed values for at least 2 real teams, sanity-checked
against the raw source fields (e.g., manually verify one team's
`secondAssistShare` matches `second_assists/first_and_second_assists`
computed by hand from the raw response).

Confirm smoke (958/0 or current real count) unchanged in count unless new
structural assertions were genuinely added for the new UI block.

---

## DONE CONDITION

All four real metrics computed from already-confirmed, already-live data
sources, rendered in the Stats tab's new MLS block, verified via a real,
direct probe with hand-checked math on at least one real team — not just
"the route returns 200."

**Confidence scoring:**
- TASK 1 (30 pts): real, correct season-aggregate computation, verified against hand-checked math
- TASK 2 (15 pts): real cross-accuracy addition, no redundant fetch
- TASK 3 (35 pts): real MLS block wired into the existing Stats tab pattern
- TASK 4 (20 pts): real, direct verification with hand-checked values

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
