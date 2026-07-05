# CC-CMD: Add a schedule trigger to drama-backfill.yml — no more manual re-checks

**Date:** 2026-07-04
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main
**Scope:** One `on:` block addition. No logic changes.

**Why:** `drama-backfill.yml` is currently `workflow_dispatch` only —
confirmed via direct read. Given FIELD tracks multiple concurrent sports
(MLB, WC26, MLS, European competitions, etc.), there is never a moment
when "everything" has finished — waiting for a global quiet period before
re-checking is not a real stopping condition, it's an unbounded wait. The
underlying query this workflow calls (`/archive/drama-missing`, filtered
on `home_score IS NOT NULL`) already only surfaces genuinely-completed
games regardless of what else is still live — it is already safe to run
at any time. The only missing piece is a recurring trigger so it runs on
its own instead of requiring a manual `workflow_dispatch` each time
someone happens to check in.

**Target time:** ~10 min

## PROBE BLOCK
```bash
cat .github/workflows/drama-backfill.yml
```
Confirm the current `on:` block still matches (`workflow_dispatch` only)
before editing — this doc's snapshot may have drifted.

## TASK 1 — Add a schedule trigger

```yaml
on:
  workflow_dispatch:
  schedule:
    - cron: '0 */2 * * *'   # every 2 hours
```
Every 2 hours is a starting point, not a fixed requirement — if the probe
reveals a reason a different interval fits better (e.g., matching an
existing cron's cadence elsewhere in this repo for consistency), use that
instead and state why. `workflow_dispatch` stays alongside it — manual
triggering should still work for on-demand checks.

## TASK 2 — Verify it's real, not just declared

GitHub Actions schedule triggers can have a real startup delay and are
sometimes silently skipped on repos with low recent activity — don't just
confirm the YAML parses. Either wait for one real scheduled run to fire
and confirm it appears in the Actions run history, or state clearly that
this couldn't be confirmed within this session's timeframe and needs a
follow-up check later rather than being marked done on cron syntax alone.

## SCOPE BOUNDARY

DO:
- Add exactly the schedule trigger, keep workflow_dispatch
- Verify a real scheduled run fires, or honestly report that verification needs more time than this session has

DO NOT:
- Change anything about what the workflow does once triggered — this is purely about when it runs
- Touch any other workflow

## DONE CONDITIONS
- [ ] Probe block confirms current on: block
- [ ] Schedule trigger added, workflow_dispatch preserved
- [ ] Real scheduled run confirmed firing, or the verification gap honestly reported
- [ ] Outbox manifest written

## CONFIDENCE SCORING TABLE
+40  Schedule trigger added correctly, workflow_dispatch preserved
+40  Real scheduled run confirmed (not just YAML validity)
+20  If verification couldn't complete in-session, that's reported honestly rather than assumed

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-04-drama-backfill-schedule.md. Add a
schedule cron trigger to drama-backfill.yml alongside the existing
workflow_dispatch — every 2 hours as a starting point unless you find a
better-justified interval. Try to confirm a real scheduled run actually
fires; if that can't be verified in this session's timeframe, report that
honestly rather than marking it done on YAML syntax alone. Do not commit
unless confidence ≥ 95. If score < 95 report verbatim and stop.
