# CC-CMD: Fix Field's Pick — source mismatch stuck at score 1.0 for 6+ consecutive days

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Source:** verified live, directly, before writing this doc — not assumed.
`/analytics/newspaper/{date}` returned byte-identical
`{type:'pass', score:1, reason:"top game scored 1.0 — under the 3.0
watch-bar"}` for 6 consecutive real dates (2026-07-01 through 07-06),
spanning real WC26 knockout games and MLB nights with confirmed genuine
drama. Root cause fully traced, not guessed.

**Target time:** ~35 min

## PROBE BLOCK
```bash
sed -n '482,513p' src/analytics-engine.js   # scoreCandidatePick
sed -n '514,545p' src/analytics-engine.js   # runPhase9FieldPick, candidate source
grep -n "const PHASE9_SPORTS" src/analytics-engine.js
sed -n '5920,5955p' src/index.js            # gameMeta construction, comp.broadcasts already in scope
sed -n '6001,6030p' src/index.js            # pre-game slate seed POST body
grep -n "PRAGMA\|closing_odds\|opening_odds\|streams\|round\b" src/index.js | grep -i archive
```
Confirm all citations match before editing.

## REAL ROOT CAUSE (verified against a live `/v2/games` object, not theorized)

`scoreCandidatePick` reads `game.note`, `game.round`/`game.series_round`,
`game.closing_odds`/`game.opening_odds`, and `game.streams` — but
`runPhase9FieldPick` sources its candidates from `/v2/games`, whose real
schema (confirmed live) is:
```
away, clock, espnEventId, home, id, league, linescores, periodLabel,
periodNum, situation, sport, start, state, venue
```
**None of the four checked fields exist there.** Only the prime-time
check (`game.commence || game.start || ...`, using `start`) can ever
fire. That's why score is always exactly `0` or `1` — never anything
else, never zero variance across 6 real, different nights by accident.

The four missing fields **do** exist as real columns on
`regular_season_games` / `postseason_games` (confirmed via schema) —
`runPhase9FieldPick` is reading from the wrong source entirely.

**This is not a one-line source swap — verify actual field population
before assuming the swap alone fixes everything (checked already, stated
here so CC doesn't have to re-derive it, only confirm it still holds):**
- `postseason_games.round`: **100%** populated for real July games — the
  postseason/elimination signal (+3) will work correctly once sourced
  from here.
- `closing_odds`/`opening_odds`: **~23%** populated in
  `regular_season_games`, **0%** in `postseason_games` — the tight-line
  signal (+2) will work for roughly a quarter of regular-season games,
  genuinely absent for the rest (not a bug, odds simply aren't fetched
  for every game).
- `note` (rivalry, +1): **~1.3%** populated, and appears to be a
  **manually-entered** field (client-side comments reference "daily
  update curation," not automation) — no automated writer found anywhere
  in this file. **Do not build a rivalry-detector as part of this fix** —
  that's a separate, larger feature decision. State plainly in the
  outbox that this signal will still rarely fire, and that this is a
  data-completeness gap, not something this CC-CMD resolves.
- `streams` (national broadcast, +0.5): **0%** populated — but this one
  **is** a real, closeable gap, not just sparse data (see Task 2).

## TASK 1 — Source candidates from the archive, not `/v2/games`

Change `runPhase9FieldPick` (line ~514) to query
`regular_season_games`/`postseason_games` for `date = today` instead of
fetching `/v2/games` per sport. Keep `PHASE9_SPORTS` scope unchanged
(nba, nhl, mlb, wnba, wc26) — expanding sport coverage is a separate
decision, not part of this fix. Map each archive row's `round`,
`closing_odds`/`opening_odds`, `note`, `streams`, and `start_time` onto
the shape `scoreCandidatePick` already expects — do not change
`scoreCandidatePick`'s scoring logic or weights, only what feeds it.

If a game for today hasn't been seeded yet (pre-game seed runs on the
same cron cycle — check ordering), fall back to the live `/v2/games`
entry for that `espnEventId` so a real candidate is never silently
dropped just because the seed hasn't run yet this tick.

## TASK 2 — Real, closeable gap: wire `comp.broadcasts` into the seed

At the `gameMeta.push({...})` site (line ~5935), `comp` (the full ESPN
competition object) is already in scope and already known to carry
`comp.broadcasts` — this exact extraction pattern is already used
elsewhere in this same file (`comp.broadcasts || []).map(b => b.names ||
[]).flat()`, e.g. line ~1279, ~2580–2605, ~3088). Add:
```javascript
broadcasts: (comp?.broadcasts || []).map(b => b.names || []).flat(),
```
to the `gameMeta.push` object. Then, in the pre-game slate seed's POST
body (line ~6001), add:
```javascript
streams: (gm.broadcasts && gm.broadcasts.length) ? gm.broadcasts.join(', ') : null,
```
This is a real fix — the data already flows through this exact cron
tick, it's just never captured. Not a guess; confirmed by reading the
existing extraction pattern used three other places in this file.

## TASK 3 — Verification

- `node --check src/index.js && node --check src/analytics-engine.js`
- Force a real run (`POST /journalism/run?force=true` doesn't cover this
  phase — find and use whatever manually triggers phase9 specifically,
  or wait for the next natural analytics cron tick) and confirm today's
  `/analytics/newspaper/{today}` pick score is no longer suspiciously
  flat — report the actual score and reasons array for a real game,
  don't just confirm the code runs without erroring.
- Confirm `streams` is now populated on at least one newly-seeded game
  today (direct D1 check), proving Task 2 actually closes the gap it
  claims to close.
- Explicitly confirm in the outbox whether today's top-scoring candidate
  crossed the 3.0 watch-bar or not — either outcome is fine, but report
  the real number, not just "it changed."

## DONE CONDITIONS
- [ ] Probe block confirms all citations before editing
- [ ] Task 1: candidates sourced from archive tables, `scoreCandidatePick` itself untouched
- [ ] Live-candidate fallback present for not-yet-seeded games
- [ ] Task 2: `comp.broadcasts` wired through to `streams`, verified populated on a real new row
- [ ] Task 3: real forced/next-tick run shows a non-flat score with real reasons, reported honestly either way
- [ ] Outbox states plainly that the rivalry (`note`) signal remains largely unpopulated by design of this fix, not silently papered over
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+30  Task 1 — correct source swap, scoreCandidatePick logic itself untouched, live-fallback present
+25  Task 2 — broadcasts wired through correctly, verified populated on real data, not just code-reviewed
+25  Task 3 — real run verified, actual score/reasons reported, not just "no errors"
+10  Outbox honestly states the rivalry-signal limitation rather than implying full fix
+10  PHASE9_SPORTS scope left unchanged as specified

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-06-fields-pick-fix.md. Execute all
three tasks: (1) source runPhase9FieldPick's candidates from the archive
tables instead of /v2/games so round/odds/streams are actually available
to scoreCandidatePick, with a live-fallback for not-yet-seeded games,
(2) wire comp.broadcasts through to the streams column at the pre-game
seed site -- a real, closeable gap, not guesswork, (3) verify with a
real forced or next-tick run and report the actual resulting score, not
just that it compiles. State honestly in the outbox that the rivalry
signal stays largely unpopulated -- that's a separate data-completeness
issue, not something this fix resolves. Do not commit unless confidence
>= 95. If score < 95, report verbatim and stop.
