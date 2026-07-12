# Claude Code Command — Push-based invalidation: drama_peak backfill → jinx recompute (Jinx's parallel gap)

**Date:** 2026-07-12
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR.
**Scope:** `scripts/drama-backfill.mjs` (extend the existing recompute-trigger block) + one small new route in `src/index.js` mirroring `/analytics/night-stars/recompute`'s exact shape.

git remote get-url origin | grep -q field-relay-nba || { echo "WRONG REPO — this CC-CMD targets field-relay-nba"; exit 1; }
git pull. Read CLAUDE.md and `docs/CC-CMD-2026-07-12-drama-peak-nightstars-invalidation.md` (the CC-CMD this one is a direct follow-up to — same root cause, same fix shape, different feature) before touching this file.

Write findings to outbox/cc-jinx-drama-peak-invalidation-2026-07-12.md.

## CONTEXT — flagged as an explicit follow-up by the night_stars invalidation CC-CMD, verified fresh this session (not copied forward)

`docs/CC-CMD-2026-07-12-drama-peak-nightstars-invalidation.md` shipped
(`49b2ad1`, outbox `cc-drama-nightstars-invalidation-2026-07-12.md`,
100/100, live-verified). Its own outbox names this gap explicitly:
"Jinx (Phase 4) has the same underlying pull-vs-push gap for its per-pick
`drama_peak` read, but a different call shape — explicitly out of scope
here, left for a separate CC-CMD."

Re-confirmed the mechanism directly from current HEAD this session, not
assumed from that outbox's summary:

`runPhase4Jinx` (`src/analytics-engine.js:1197-1292`) grades the day's
single `field_pick` game. It reads `game.drama_peak` at
`src/analytics-engine.js:1225` from `ctx.games` (the Phase 1 context
graph, fetched fresh via `fetchContextGraph(env, date)` on every call —
**not** a cached/frozen value like `computeNightStars`' slate-wide
snapshot). `pickCorrect` is `(drama != null && drama >= 65) ||
(finalMargin <= 3) || hasExtras` — if `drama_peak` is still `NULL` at the
moment Jinx runs (because `drama-backfill.yml`'s ~2hr cron hasn't caught
up yet for that game), `drama` stays `null` and `pickCorrect` falls back
to `finalMargin`/`hasExtras` alone. A genuinely high-drama, close-margin
game with `drama_peak` not yet backfilled can be graded `pickCorrect:
false` at compute time and never re-graded — because, unlike night_stars,
**Jinx's `value` object never writes a `degraded` key at all** (confirmed
this session, `outbox/cc-analytics-degraded-sweep-2026-07-12.md`'s TASK 0
audit: `runPhase4Jinx`'s value is `{game_id, sport, pick_correct,
market_agreed, final_margin, drama_peak, had_extras, jinx, validation,
running_accuracy}` — no `degraded` field, and some "nothing to report"
states don't even write a row). This means `getDegradedPhases()` can
never detect a stale Jinx row — the only real fix is the same push-based
trigger night_stars just got, not a detection improvement.

**The recompute mechanism already exists and needs zero new phase logic**:
`jinx` is already a `PURE_PHASE_DISPATCH` entry
(`src/analytics-engine.js:1825-1832`, added by this session's
`analytics-degraded-sweep` CC-CMD) — `recomputePhase(env, 'jinx', date)`
already re-fetches `ctx` fresh and re-runs `runPhase4Jinx`, which reads
`game.drama_peak` fresh from D1 via `fetchContextGraph` every time. The
only missing piece is a trigger, exactly matching night_stars' situation
before its own CC-CMD.

## PRE-BUILD PROBE (Rule 68/87 — re-run before editing, report drift if found)

```bash
grep -n "touchedDates\|Recompute trigger\|night-stars/recompute" scripts/drama-backfill.mjs
grep -n "jinx: async" src/analytics-engine.js
grep -n "night-stars/recompute" src/index.js
node --check scripts/drama-backfill.mjs
node --check src/index.js
```
Expected: the `touchedDates` tracking + post-loop recompute block already
present from the prior CC-CMD (this doc extends it, does not re-add it);
`jinx` present in `PURE_PHASE_DISPATCH`; the existing
`/analytics/night-stars/recompute` route as the shape to mirror. If any
of these are missing or differ from what's described above, STOP and
report before proceeding — this doc's design assumes the prior CC-CMD's
fix is live and unmodified.

## TASK 1 — Add `POST /analytics/jinx/recompute?date=YYYY-MM-DD`

Mirror `/analytics/night-stars/recompute` (`src/index.js:11104-11123`)
exactly: same `X-FIELD-Relay: field-relay-cron-2026` auth header check,
same `date` query param validation, same response shape
(`{ok:true, date, ...result}`). Only difference: call
`recomputePhase(env, 'jinx', date)` instead of `recomputeNightStars(env,
date)`. Place it immediately adjacent to the night-stars route (same
top-level indentation — not nested inside any `/prefix/`-style wrapper,
the bug class this session hit twice already).

Do not build a generic `/analytics/recompute?feature=` route unless a
second consumer beyond night_stars/jinx materializes — two nearly-identical
small routes is simpler and safer here than a parameterized one that
would need its own validation against `PURE_FEATURES` (Rule 69 — don't
build for a hypothetical future need this CC-CMD doesn't require).

## TASK 2 — Extend the existing recompute-trigger block in `drama-backfill.mjs`

In the `=== Recompute trigger: N date(s) touched ===` block added by the
prior CC-CMD, add a second `fetch` call per touched date, alongside the
existing night-stars one, targeting the new jinx endpoint. Same
best-effort try/catch semantics — a failed jinx recompute must never
fail the backfill run itself, and must never block the night-stars
recompute call for the same date (each call independently wrapped, not a
single try/catch around both).

## TASK 3 — Verification (synthetic, reversible — mirror the night_stars CC-CMD's own method exactly)

The live discovery queue may not be empty at test time (it wasn't for
the night_stars test either) — use the same synthetic approach:

1. Find a real date with both an existing `jinx_{date}` row in
   `analytics_output` and a `field_pick` for that date whose `game_id`
   has a real, non-NULL `drama_peak` in `regular_season_games` /
   `postseason_games`.
2. Record that game's current `drama_peak`/`drama_arc`, and the
   `jinx_{date}` row's current `pick_correct`/`drama_peak`/`created_at`.
3. `UPDATE ... SET drama_peak = NULL, drama_arc = NULL WHERE id = ?` for
   that one game row only.
4. Manually dispatch `drama-backfill.yml`.
5. Confirm via workflow logs: both `[recompute]` lines fire for that
   date (night-stars AND jinx).
6. Confirm via D1: the game's `drama_peak`/`drama_arc` restored to the
   exact recorded values, AND `jinx_{date}`'s `created_at` is newer than
   before, AND its `value.drama_peak` field matches the restored
   `drama_peak` (proving the recompute genuinely re-read the fresh value,
   not just re-wrote stale data).
7. If `pick_correct` or `jinx`/`validation` flip as a side effect of the
   restored `drama_peak`, that's expected and fine — it proves the fix
   works, not a problem to fix.

If no real row satisfies step 1's criteria (a plausible, honest outcome —
this repo's actual data may not currently have a jinx row with a
drama_peak-bearing pick game), report that plainly and fall back to
verifying `recomputePhase(env, 'jinx', date)` end-to-end via a direct
`POST /analytics/jinx/recompute` call against any real past date instead,
stating clearly that this is a weaker verification than the full
null-then-restore cycle and why.

## DONE CONDITION

`POST /analytics/jinx/recompute` exists, matches the night-stars route's
shape exactly. `drama-backfill.mjs`'s existing recompute-trigger block
fires both recompute calls per touched date, each independently
best-effort. Live-verified via a real dispatched workflow run and direct
D1 queries before/after — not code-reviewed alone.

**Confidence scoring:**
- Probe block re-run, confirms the prior CC-CMD's fix is live and
  unmodified before extending it (15 pts)
- New route exactly mirrors `/analytics/night-stars/recompute`'s auth,
  validation, and response shape (20 pts)
- `drama-backfill.mjs` extension correctly fires both recompute calls
  independently (one failing must not block the other) (20 pts)
- `node --check` clean on both files (10 pts)
- Real synthetic test (or the honest fallback if no qualifying row
  exists) proves the jinx recompute genuinely re-reads fresh
  `drama_peak`, not just re-writes stale data (25 pts)
- Route placed at correct non-nested indentation, confirmed via read of
  surrounding lines, not assumed (10 pts)

Do not commit unless confidence >= 95. If score < 95, report verbatim and stop.

## ONE-LINER
```
git pull. Read docs/CC-CMD-2026-07-12-jinx-drama-peak-invalidation.md. Execute all tasks. Do not commit below 95 confidence.
```
