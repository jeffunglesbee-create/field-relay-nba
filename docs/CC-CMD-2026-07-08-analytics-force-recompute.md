# CC-CMD: Add force-recompute to analyticsEngine for already-processed dates

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Diagnosed live (chat session, direct D1 queries + real `/context/date` and
`/analytics/run` calls, not assumed from reading code alone):
`night_stars` has shown `degraded: true` for 2026-07-07 across this
entire multi-hour session. Root cause confirmed precisely — not a data
problem. `computeNightStars()` (`src/analytics-engine.js`) reads
`drama_peak` from the Context Graph (`GET /context/date/{date}`, a live
self-call); a direct live probe of that exact endpoint right now shows
`drama_peak` present and non-null on all 19 games for that date
(`missing: 0/19`). If `computeNightStars` ran against current data, it
would not be degraded.

The actual blocker: `planDates()` checks `analytics_runs`' most recent
recorded date and returns `[]` (skip everything) whenever `lastDate >=
targetDate` — a strict, one-directional "never revisit a processed date"
design. This makes sense for the normal forward-marching cron case
(process oldest unprocessed date, self-heal up to `SELF_HEAL_CAP` days)
but has no path for "this date's underlying source data changed after
it was processed" — which is exactly what happened here: the cron
likely ran before most of that day's games were final, correctly
recorded `degraded: true` for the data available at that moment, marked
the date done, and has had no way to reflect the since-completed data.

Confirmed via live call: `GET /analytics/run?date=2026-07-07` returns
`{"skipped":"up-to-date"}` — the existing endpoint has no override for
this case today.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "async function planDates" -A15 src/analytics-engine.js
grep -n "async function analyticsEngine" -A10 src/analytics-engine.js
# Re-confirm current exact logic — this doc's citation may be stale.

grep -n "'/analytics/run'" -A20 src/index.js
# Re-confirm the current route handler and its body-parsing shape
# (GET ?date= vs POST {date}) before adding a new option to it.

# Confirm current live state hasn't changed since diagnosis:
curl -s "https://field-relay-nba.jeffunglesbee.workers.dev/context/date/2026-07-07" \
  | node -e "const d=JSON.parse(require('fs').readFileSync(0)); const g=[...d.games.regular,...d.games.postseason]; console.log('missing drama_peak:', g.filter(x=>x.drama_peak==null).length, '/', g.length)"
```

## TASK 1 — Add an explicit `force` option to `analyticsEngine`

In `planDates(env, targetDate, force)`: when `force` is true, return
`[targetDate]` unconditionally, bypassing the `lastDate >= targetDate`
check. Do not change behavior for the non-force path — this is strictly
additive. Thread `force` through from `analyticsEngine(env, opts)`'s
`opts.force` (boolean, default `false`).

**Scope discipline:** this only affects a single explicitly-requested
date when `force:true` is passed — it must not affect the normal cron
invocation (which never passes `force`), and must not allow forcing a
range (`SELF_HEAL_CAP`-style multi-date backfill) — a forced run
processes exactly the one requested date, nothing else. State this
constraint explicitly in a code comment, not just in this doc.

## TASK 2 — Expose `force` on `/analytics/run`

`GET /analytics/run?date=...&force=true` and the POST JSON body's
`{date, force}` both thread through to `analyticsEngine`'s `opts.force`.
Default remains `false` if the param is absent — no behavior change for
any existing caller (the daily cron, any existing manual calls without
`force`).

## TASK 3 — Live verification, not just "it ran without error"

1. Confirm current state: `GET /analytics/status` or equivalent shows
   `night_stars` for 2026-07-07 as `degraded: true` (the stale value)
   before the fix.
2. After deploying: `GET /analytics/run?date=2026-07-07&force=true`.
3. Confirm the response shows `processed: ["2026-07-07"]`, not
   `skipped`.
4. Re-query the actual `night_stars` analytics_output row (D1 or the
   relevant read endpoint) and confirm `degraded` is now `false` (or
   whatever the genuinely-current data supports) — not just that the
   call returned 200.
5. Confirm the normal (non-force) path is unaffected: a second call to
   `GET /analytics/run` (no `force`, no explicit `date`, i.e. the
   default yesterday-ISO target) still correctly returns
   `skipped: "up-to-date"` if nothing new needs processing — proving
   the additive change didn't accidentally loosen the cron's own guard.

## DONE CONDITIONS

- [x] `planDates` accepts and correctly honors `force`, non-force path
      provably unchanged
- [x] `/analytics/run` exposes `force` on both GET and POST, default
      `false`
- [x] Live-verified: forced recompute for 2026-07-07 actually changes
      the stored `night_stars` value from `degraded:true` to reflect
      current real data — confirmed via a fresh read after the call,
      not inferred from the trigger call's own 200 response
- [x] Confirmed the normal, non-forced cron path still correctly skips
      when nothing needs processing

## CONFIDENCE SCORING

- +30 — `planDates`/`analyticsEngine` force option correct, scoped to
  exactly one date, non-force path provably unchanged
- +25 — `/analytics/run` correctly exposes `force` on both GET/POST
- +30 — live-verified the actual stored value changed, not just that
  the call succeeded
- +15 — confirmed the non-force path still works correctly (no
  regression to the daily cron's own guard)

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-analytics-force-recompute.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
