# CC-CMD: Surgical night_stars recompute — targeted, not a full analytics force-run

**Date:** 2026-07-08
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR

## CONTEXT

Diagnosed this session: `computeNightStars` (`src/analytics-engine.js`)
runs once daily via the `0 9 * * *` cron, computing the star rating from
`drama_peak` on that day's games. `drama_peak` itself is filled in by a
**separate** cron (`drama-backfill.yml`, every ~2 hours). If backfill
hasn't caught up to a full day's games by 09:00 UTC, `night_stars`
correctly sees incomplete data at that moment and flags `degraded:
true` — but the stored snapshot never gets recomputed once backfill
catches up hours later. Confirmed live: 2026-07-07's stored row shows
`degraded:true, dramaGames:0` from computation time, but
`regular_season_games` right now shows all 19 games have `drama_peak`
filled. Same pattern on 2026-07-03.

**Do not force a full analyticsEngine re-run for these dates.** Real,
directly-applicable precedent (chat history, 2026-07-03, a near-identical
situation with `morning_report`): explicitly rejected a full
`analyticsEngine` re-run because it would redundantly recompute
`morning_report`/`truth_is`/`field_pick`/etc. — all already correct for
that date — at real AI-call cost. Confirmed via current source:
`analyticsEngine`'s `planDates()` has no `force` bypass at all (only a
`last_run` watermark check), and `processDate()` is monolithic — it
fetches the Context Graph once and runs all ~9 phases together in one
pass, with no per-feature targeting. There is currently no way to force
just one feature through the existing orchestrator; building one is
this CC-CMD's actual job.

**Scope, explicitly bounded:** this fixes the *symptom* (stale
snapshots) for `night_stars` specifically, reusably, since this is a
recurring pattern (twice in 5 days shown) — not a one-off patch. It
does **not** fix the underlying cron-timing race between
`drama-backfill.yml` and the 09:00 UTC analytics cron — that's a
separate, real, still-open problem. State this explicitly in the
outbox; do not silently expand scope to "fix" it here.

## PROBE BLOCK

```bash
git log --oneline -5

grep -n "computeNightStars" -A5 src/analytics-engine.js | head -20
# Re-confirm current signature/behavior — this doc's citation may be stale.

grep -n "analytics_output.*night_stars\|night_stars.*analytics_output" src/analytics-engine.js
# Find the EXACT write pattern for night_stars' analytics_output row —
# specifically how `id` (the table's PRIMARY KEY) is constructed for
# this feature, so the recompute writes to the SAME id and correctly
# replaces the stale row rather than creating a duplicate or orphan.

grep -n "async function processDate" -A80 src/analytics-engine.js | grep -n "night_stars\|computeNightStars"
# Locate exactly where in processDate's sequence night_stars gets
# computed and written, to replicate the same write shape precisely.

grep -n "'/analytics/" src/index.js
# Enumerate existing /analytics/* routes to pick a consistent,
# non-colliding path and auth pattern for the new endpoint.
```

## TASK 1 — Add a standalone, reusable recompute function

In `src/analytics-engine.js`, add `recomputeNightStars(env, date)`:
1. Call `fetchContextGraph(env, date)` fresh (already exists, already
   proven — do not duplicate its logic).
2. Call `computeNightStars(games)` (already exists, pure function, no
   AI calls — confirm this via the probe, don't assume) against the
   fresh result.
3. Write the result to `analytics_output` using the **exact same `id`
   construction** the probe found in `processDate`'s existing
   night_stars write (critical — a mismatched id creates a duplicate
   row instead of replacing the stale one) via `INSERT OR REPLACE` (or
   whatever the existing write already uses — match it, don't assume
   `INSERT OR REPLACE` is correct without checking).
4. Return `{ before, after }` — read the existing row before
   overwriting it, so the caller/verification step can see the actual
   delta, not just trust that something changed.

Do not touch `processDate`, `analyticsEngine`, or any other phase's
compute/write logic. This is additive only.

## TASK 2 — Expose it narrowly

Add `POST /analytics/night-stars/recompute?date=YYYY-MM-DD` in
`src/index.js`, following the existing `X-FIELD-Relay:
field-relay-cron-2026` auth header convention used by other admin/cron
routes (confirm via probe which existing route to mirror). Returns the
`{ before, after }` shape from Task 1. Deliberately scoped to
`night_stars` only, not a generic `?feature=` parameter — if another
feature needs the same treatment later, that's a real, separate
decision, not something to speculatively generalize now.

## TASK 3 — Run it for both known-stale dates, verify with real evidence

Call the new endpoint for `2026-07-07` and `2026-07-03`. For each,
confirm via the returned `{before, after}`:
- `before.degraded` was `true`, `after.degraded` is `false` (or
  document precisely why not, if the real current data doesn't
  actually support a clean flip — do not force a result)
- `after.dramaGames`/`starScore`/`stars` reflect real, current
  `drama_peak` values — spot-check at least one specific game's
  `drama_peak` against the new `dramaGames` count by direct D1 query,
  not just trusting the function's own output

Then independently confirm via direct D1 query that **only** the
`night_stars` rows for these two dates changed — `morning_report`,
`truth_is`, `field_pick`, and the rest for both dates are byte-identical
to before this CC-CMD ran (query `created_at`/`value` before and after;
if `created_at` is unchanged for every other feature/date, that's
sufficient proof nothing else was touched).

## TASK 4 — State the unaddressed root cause explicitly

One paragraph in the outbox: the `drama-backfill.yml` (~2hr cron) vs.
`0 9 * * *` analytics cron race is not fixed by this CC-CMD. This adds
a way to *clean up after* the race when it happens; it doesn't prevent
the race itself. That's a separate, real follow-up (options include
moving the analytics cron later, adding a backfill-completeness check
before computing night_stars, or triggering a recompute automatically
when backfill closes a gap for an already-processed date) — not
attempted here.

## DONE CONDITIONS

- [x] `recomputeNightStars` added, uses the exact existing id/write
      pattern (verified via probe, not assumed)
- [x] New endpoint added, narrowly scoped, consistent auth pattern
- [x] Both known-stale dates recomputed, before/after shown with real
      D1 evidence, at least one spot-checked game's drama_peak verified
      independently
- [x] Confirmed via direct query that no other feature/date was touched
- [x] Outbox explicitly names the unaddressed cron-race root cause as a
      separate follow-up

## CONFIDENCE SCORING

- +20 — recomputeNightStars correct, matches existing id/write pattern exactly
- +15 — endpoint correctly scoped and wired, consistent auth
- +30 — both dates recomputed with real before/after D1 evidence, one
  game's drama_peak independently spot-checked
- +20 — confirmed via direct query that nothing else was touched
- +15 — outbox explicitly and clearly states the unaddressed root cause

**Do not commit unless confidence >= 95. If score < 95, report verbatim
and stop.**

## ONE-LINER

```
git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO"; exit 1; }
git pull. Read docs/CC-CMD-2026-07-08-night-stars-recompute.md. Execute all tasks. Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.
```
