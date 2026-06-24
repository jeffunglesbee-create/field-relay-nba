# Phase 8b Cleanup + Session-Health Quality Threshold Align — 2026-06-24

## Tasks

- [x] Task 1a — `phase8b_quality_alert` not in PHASE_NAMES (was pushed at runtime; no-op verified)
- [x] Task 1b — Phase 8b try/catch block deleted from `src/analytics-engine.js`
- [x] Task 2 — `session_health` `quality.degraded` aligned: 1-day → 7-day window, threshold 170 → 240, ENRICHMENT + golf excluded, group by (brief_type, sport)
- [x] Task 3 — smoke (`node --check` both files) + commit + push
- [x] Task 4 — outbox manifest

## Done-condition verification

```
$ grep -c "phase8b" src/analytics-engine.js
0                                ✓ (target: 0)

$ grep -c "avg_score < 170" src/index.js
0                                ✓ (target: 0)

$ grep -c "avg_score < 240" src/index.js
3                                ✓ (target: ≥1 — found at /quality/report alert filter L7849+7853 and session_health L10239)
```

## Smoke

No `npm test` script in this repo (`package.json` has only `name`, `version`, `private`, `type`, `dependencies`). `node --check` is the available syntax smoke:

```
$ node --check src/analytics-engine.js  → OK
$ node --check src/index.js             → OK
```

## Commit

- `5793fa4` fix: Phase 8b cleanup + session_health quality threshold aligned to 240/300
  (2 files, +10/−45)

## Observable behavior change

**session_health `out.quality.degraded`:**

| Aspect          | Before                             | After                                                    |
|-----------------|------------------------------------|----------------------------------------------------------|
| Window          | 1 day                              | 7 days                                                   |
| Threshold       | `avg_score < 170`                  | `avg_score < 240` (excellence bar)                       |
| Group by        | `brief_type` only                  | `(brief_type, sport)` — same shape as `/quality/report`  |
| Exclusions      | none                               | ENRICHMENT_TYPES + golf                                   |
| Expected effect | misses regressions; old scale noise | fires only on genuine quality regressions against the 80% bar |

**analytics_engine `phase8b_quality_alert`:** removed. The `quality_alert`
row written into `analytics_output` is now sourced exclusively from Phase
12 (added in the prior session), which carries the richer payload
(alerts[], types_above_240, total_types, etc.) and respects the 240/300
threshold. Newspaper `bundle.quality_alert` consumer path unchanged —
still reads `analytics_output WHERE feature='quality_alert' AND date=?`.

Phase8b had been silently overwritten by Phase 12 on every run anyway
(both wrote to id `quality_alert_<date>` via INSERT OR REPLACE, Phase 12
later in the run); this commit removes the dead write.

## Verify commands

```
probe_relay_route /session/health    # quality.degraded now empty or 240-failures
probe_relay_route /analytics/status  # phases_completed: no longer includes phase8b_quality_alert
probe_relay_route /analytics/quality_alert/<yesterday>  # still populated, by Phase 12
```
