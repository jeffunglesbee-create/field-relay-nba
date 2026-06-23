# Quality Alert Recalibration — 2026-06-23

## Probes (Rule 68)

| # | Probe                                  | Result                                                            |
|---|----------------------------------------|--------------------------------------------------------------------|
| 1 | `/quality/report` handler              | `src/index.js:7752`                                                |
| 2 | alert filter block (was)               | Lines 7774–7781: flat `avg < 170 OR below_150/scored > 0.3`        |
| 3 | `ENRICHMENT_TYPES` already exists      | No                                                                 |
| 4 | per-type threshold logic exists        | No                                                                 |
| MCP allow-list | `/quality` prefix already covered | Yes — added in earlier `Automation Loop` session, no edit needed |

## What shipped

`src/index.js` — `/quality/report` alert filter block replaced with
per-type thresholds + enrichment exclusion:

- **`ENRICHMENT_TYPES` Set**: `wc_matchup`, `standings_snapshot`,
  `narrative_context`, `enrichment`, `kv_harvest`, `wc_tab`. These are
  static reference text seeded into D1 — scoring them produces noise.
  Still visible in `summary`; excluded from `alerts`.
- **`_alertThreshold(brief_type, sport)`**:
  - enrichment type → `null` (excluded)
  - golf → `null` (no context builder exists; structural gap)
  - `game_brief` → 130 (preview type)
  - `night_owl` → 140 (client-generated, lower ceiling)
  - everything else (`game_recap`, `mlb_game`, `wnba_game`, `slate`) → 170
- **Failure-rate trigger**: raised from `>0.3` → `>0.4` `below_150/scored`,
  aligned with the per-type ceilings.
- Each alert now carries the `threshold` it tripped so callers don't
  need to know the table.

## Commit & deploy

- `dc01e44` feat: /quality/report alerts — per-type thresholds +
  enrichment exclusion (1 file, +33/−7)
- Deploy: workflow 28055709613 — completed/success.

## Before → after

| Metric          | Before | After |
|-----------------|-------:|------:|
| `alert_count`   | 10     | **5** |
| `unscored_count`| 0      | 0     |

### Alerts that went away (correctly suppressed)

| brief_type            | sport               | was alerting because        | now            |
|-----------------------|---------------------|-----------------------------|----------------|
| `wc_matchup`          | FIFA World Cup 2026 | avg 126.7 below flat 170    | excluded (enrichment) |
| `standings_snapshot`  | FIFA World Cup 2026 | avg 146.1 below flat 170    | excluded (enrichment) |
| `game_brief`          | golf                | avg 91.4 below flat 170     | excluded (golf has no context builder) |
| `game_brief`          | MLB                 | avg 159.6 below flat 170    | gone — 159.6 above the new 130 threshold and failure_pct 15% < 40% |
| `night_owl`           | FIFA World Cup 2026 | avg 154.5 below flat 170    | gone — above the new 140 threshold and failure_pct 38% < 40% |

### Alerts that remain (real signal)

| brief_type    | sport                | avg   | threshold | failure_pct | rule tripped       |
|---------------|----------------------|------:|----------:|------------:|--------------------|
| `game_brief`  | FIFA World Cup 2026  | 136.7 | 130       | 83%         | high_failure_rate  |
| `game_brief`  | WNBA                 | 139.3 | 130       | 67%         | high_failure_rate  |
| `night_owl`   | Baseball (MLB)       | 150.0 | 140       | 40%         | high_failure_rate (21/52 = 0.404) |
| `night_owl`   | MLB                  | 156.0 | 140       | 41%         | high_failure_rate  |
| `wnba_game`   | WNBA                 | 158.0 | 170       | 0%          | avg_below_170      |

Enrichment types still appear in `summary` (wc_matchup 57 rows at 126.7
avg, standings_snapshot 8 rows at 146.1, narrative_context not shown in
this 7-day window) — observability preserved, just not alerted.

## Done condition

Spec target: `alert_count ≤ 4`. Actual: 5. The fifth alert (`wnba_game`
WNBA, avg 158 < 170 threshold, 3 rows) is genuine signal under the spec's
own threshold rules — full-prose types should clear 170. The spec's
"≤4" estimate didn't account for this row; the implementation matches
the spec's threshold table.

`wc_matchup`, `standings_snapshot`, `narrative_context` confirmed in
`summary` but absent from `alerts` ✓.

## Carry-forwards

1. **`wnba_game` 158 avg.** Three rows below the 170 ceiling. Could be a
   sample-size issue (only 3 scored), tuning issue (threshold could be
   160 for this brief_type), or genuine quality dip. Worth a glance
   over the next week as more rows accumulate.
2. **night_owl MLB 40% failure_pct.** 21/52 rows below 150. This is the
   client-generated MLB night_owl prose and the failure rate is real.
   Worth a future prompt-tuning session.
3. **`unscored_types: []`.** Backfill from the previous session is
   holding — every type/sport has 100% scored coverage.
4. **Alert shape changed.** Each alert now carries `threshold`.
   Consumers that read alert objects need to handle the new field.
   Forward-compatible (it's an additive field), but flagged here.

## Verify commands

```
probe_relay_route /quality/report
# expect alert_count: 5; alerts array contains threshold field per row;
# wc_matchup / standings_snapshot / narrative_context absent from alerts.
```
