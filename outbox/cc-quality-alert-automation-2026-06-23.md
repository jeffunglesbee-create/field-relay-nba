# Phase 12 Quality Alert Automation — 2026-06-23

## Probes (Rule 68)

| # | Probe                                  | Result                                                                  |
|---|----------------------------------------|--------------------------------------------------------------------------|
| 1 | `PHASE_NAMES`                          | L12: `['phase0',…,'phase11']` — added `'phase12'`                        |
| 2 | `writeAnalyticsOutput` signature       | L155: `({date, feature, sport, value, briefText})` → INSERT OR REPLACE   |
| 3 | `addDays` helper                       | L67                                                                       |
| 4 | phase6d dispatch                       | L1469–1473 (Sunday-only block); finally at L1480                          |
| 5 | finally block                          | L1480–1510 (Phase 11 writeRunStatus)                                      |
| 6 | **existing phase12/quality_alert**     | **FOUND** — Phase 8b at L1407–1444 already writes `feature='quality_alert'` with a 170-threshold check. The CC-CMD's "nothing writes to it" claim was false. |

Phase 8b uses the old 170 (245-scale) threshold and only writes when alerts
exist. Phase 12 supersedes it (richer payload, always writes, 240/300
excellence bar). Phase 8b's write is overshadowed by Phase 12's later
INSERT OR REPLACE on the same `quality_alert_<date>` id — flagged for
follow-up cleanup per Rule 69 (this CC-CMD scopes to adding Phase 12).

## What shipped

`src/analytics-engine.js`:
- `runPhase12QualityAlert(env, date)` — scans 7-day briefs window,
  excludes ENRICHMENT_TYPES + golf, flags any (brief_type, sport) with
  `scored >= 3` and either `avg_score < 240` OR `below_240/scored > 0.2`.
  Writes `feature='quality_alert'` even on no-alert days so the
  newspaper always sees fresh state.
- `PHASE_NAMES` gains `'phase12'`.
- Dispatch wired after the Sunday-only Phase 6 block, before the
  `void odds…` line and the finally — runs every day.

Spec wording ("BEFORE the `} else {`") contradicted "runs every day" —
chose the "every day" interpretation per Rule 88 (correct route over
literal-but-wrong route).

## Commit & deploy

- `a75f3c4` feat: Phase 12 quality alert — daily 240/300 snapshot to analytics_output (1 file, +95/−1)
- Deploy: workflow 28066510304 — completed/success.

## Task 4 verification

**1. Trigger analytics for 2026-06-23:**
```
/analytics/run?date=2026-06-23 → 200
{ triggered: 'analytics-engine', result: { ok:true, processed:[{ features:10, ms:5818 }] } }
```

**2. `/analytics/status` confirms `phase12` in `phases_completed`:**
```json
"phases_completed":["phase0","phase1","phase2","phase3","phase4","phase5",
  "phase9","phase10a","phase10b","phase7","phase8",
  "phase8b_quality_alert","phase12","phase11"]
```
Both phase8b_quality_alert and phase12 ran — Phase 12's row write overwrote
Phase 8b's, as designed.

**3. `/analytics/quality_alert/2026-06-23` returns rich row:**
```
alert_count: 14
types_above_240: 8 / 16
total_scored: 458
brief_text: "14 quality alerts: night_owl/Baseball (MLB) avg 150,
             game_brief/FIFA World Cup 2026 avg 151 +12 more"
```
Top alerts (sorted by avg ASC): night_owl Baseball/MLB at 150, game_brief
FIFA at 151, game_brief WNBA at 152.3, night_owl FIFA at 154.7, night_owl
MLB at 155.9, wnba_game WNBA at 158, game_brief MLB at 168.4, etc.

**4. `/analytics/newspaper/2026-06-24` `bundle.quality_alert` non-null:**
```
quality_alert: {
  alert_count: 14, alerts: [...14 entries...],
  since: "2026-06-17", through: "2026-06-23",
  types_above_240: 8, total_types: 16, total_scored: 458,
  generated_at: "2026-06-24T00:31:28.012Z",
  brief: "14 quality alerts: …"
}
```
Surfaced verbatim from analytics_output into the newspaper bundle.

## Done conditions

- [x] Deploy success (workflow 28066510304)
- [x] `quality_alert` row exists in `analytics_output` for yesterday's date
- [x] `bundle.quality_alert` non-null in newspaper endpoint
- [x] `brief_text` accurately describes current state (14 alerts at 150–168 avg)

## Carry-forwards

1. **Phase 8b is now overshadowed.** The legacy Phase 8b at
   `src/analytics-engine.js:1407` still runs and writes
   `feature='quality_alert'` with a 170-threshold check; Phase 12 writes
   the same row later in the run and `INSERT OR REPLACE` overwrites it.
   Phase 8b is effectively dead code; observe one cron cycle to confirm
   no edge case (e.g. error in Phase 12 leaving Phase 8b's write
   visible), then remove Phase 8b in a follow-up commit.
2. **Cron timing.** Phase 12 runs as part of the daily analytics cron
   (9 AM UTC). The first automated run lands tomorrow morning — manual
   trigger above proves the path; daily cadence proves itself overnight.
3. **`brief_text` length cap.** Top-2 alert format + "+N more" suffix
   keeps text under ~120 chars even with double-digit alert counts.
   No hard cap; trusts the count.
4. **Newspaper bundle assembly is unchanged.** Bundle reads
   `analytics_output WHERE feature='quality_alert' AND date=recap_date`
   (index.js:8844). Existing path — no client-side change needed.

## Verify commands

```
probe_relay_route /analytics/run?date=YYYY-MM-DD
probe_relay_route /analytics/status
probe_relay_route /analytics/quality_alert/YYYY-MM-DD
probe_relay_route /analytics/newspaper/<today>
# Expect: phase12 in phases_completed; quality_alert row populated;
# bundle.quality_alert surfaces it.
```
