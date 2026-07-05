# CC-CMD: Schedule score-fill.yml — the real, unscheduled gap upstream of drama-backfill

**Date:** 2026-07-05
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** One `on:` block addition. No logic changes.

**Why — real, confirmed gap, not theoretical:** `drama-backfill.yml`
already runs on a 2-hour schedule (confirmed firing, real runs verified
this session). But its own discovery query requires `home_score IS NOT
NULL` as a precondition — a game with no `home_score` is invisible to it
entirely, not just deprioritized. `home_score` is populated by two
paths: the live `saveEspnFinal` write (session-dependent — same
limitation drama scoring has), or `score-fill.yml`. Confirmed directly:
`score-fill.yml` has `workflow_dispatch` only, no schedule. A genuinely
session-less game (no live view, ever) has `home_score` permanently
NULL until someone manually re-triggers this workflow — the drama cron
running forever would never surface it, because it never even enters
the queue.

**Target time:** ~10 min

## PROBE BLOCK
```bash
cat .github/workflows/score-fill.yml
```
Confirm current `on:` block still matches before editing.

## TASK 1 — Add a schedule trigger

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 */4 * * *'   # every 4 hours -- less frequent than drama-backfill since this is further upstream and score data changes less often than drama needs recomputing
```
If a different interval is better-justified by what score-fill actually
checks (e.g. it already has its own internal recency logic worth
respecting), use that instead and state why.

## TASK 2 — Verify it's real, not just declared

Same discipline as the drama-backfill schedule fix: either wait for a
real scheduled run to fire and confirm it in Actions history, or report
honestly that this couldn't be confirmed within this session's timeframe.

## DONE CONDITIONS
- [ ] Probe block confirms current state
- [ ] Schedule trigger added, workflow_dispatch preserved
- [ ] Real scheduled run confirmed firing, or the verification gap honestly reported
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+40  Schedule trigger added correctly, workflow_dispatch preserved
+40  Real scheduled run confirmed (not just YAML validity)
+20  If verification couldn't complete in-session, reported honestly

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-05-score-fill-schedule.md. Add a
schedule cron trigger to score-fill.yml alongside the existing
workflow_dispatch -- every 4 hours as a starting point unless a better
interval is justified. This closes a real gap: drama-backfill's own
2-hour cron can never see a game whose home_score was never populated,
and score-fill (the thing that populates it for session-less games) has
had no schedule until now. Try to confirm a real scheduled run fires; if
not verifiable in this session, report that honestly. Do not commit
unless confidence ≥ 95. If score < 95 report verbatim and stop.
