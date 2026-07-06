# CC-CMD: Compute and persist wentToOT (relay side)

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Source:** closes the June 22 open incident "wentToOT hardcoded false in
newspaper (needs GameDO/AmbientDO write)." This CC-CMD covers the relay
side only (schema + computation + archive write) — the client's
notability filter (`getWhatYouMissed`, `jubilant-bassoon/index.html:21879`)
currently has a comment explaining exactly why it excludes OT
("wentToOT is not stored in D1 archive so it never qualifies") and
needs a separate, client-repo CC-CMD once this data actually exists to
read. Do not attempt that half here — different repo, different data
shape to trace.

**Real, sourced design — not guessed:** GameDO's `facts.period`
(`_fetchFacts`, line ~447) is `match.periodNum` — the same normalized
field every `/v2/games` adapter already produces. Confirmed per-sport
meaning by reading each adapter's own normalization:
- Basketball (NBA/WNBA): quarters, regulation = 4 (confirmed at
  `src/index.js:~1164`: `period > 4 ? OT... : Q${period}`)
- Hockey (NHL): periods, regulation = 3
- Baseball (MLB): innings, regulation = 9
- Soccer (EPL/MLS/UCL/WC26): `periodNum` is NOT a literal period count —
  confirmed at `src/index.js:~1418`: `situation.elapsed <= 90 ? 2 : 3`
  (extra time), `isShootout ? 5`. So `periodNum >= 3` means extra
  time/shootout occurred, using the exact scheme already in production.
- **AFL: explicitly excluded.** No existing regulation-period
  convention for AFL was found anywhere in this file, and AFL's overtime
  rules (draw/replay conventions differ from other sports covered here)
  aren't something to guess at. Leave `went_to_ot` null for AFL games
  rather than compute a possibly-wrong value.
- **NFL/CFL: not applicable to this CC-CMD.** `SPORT_TO_V2` (line ~61)
  does not include `nfl` or `cfl` — those sports don't flow through
  GameDO's real-time hook at all (they're archived via the cron
  catch-up loops fixed in a separate CC-CMD today, which don't carry
  period data). Out of scope here; would need its own investigation of
  where NFL/CFL completion actually gets detected.

**Target time:** ~30 min

## PROBE BLOCK
```bash
sed -n '447,505p' src/game-do.js       # _fetchFacts, confirm periodNum source unchanged
sed -n '395,445p' src/game-do.js       # completed-state archive hook + payload construction
sed -n '8523,8600p' src/index.js       # /archive/game handler + both INSERT statements
grep -n "went_to_ot\|wentToOT" src/*.js  # confirm zero existing references (net-new column)
```
Confirm the citations above still match before editing.

## TASK 1 — Add `went_to_ot` column to both archive tables

```sql
ALTER TABLE regular_season_games ADD COLUMN went_to_ot INTEGER DEFAULT NULL;
ALTER TABLE postseason_games     ADD COLUMN went_to_ot INTEGER DEFAULT NULL;
```
`NULL` (not `0`) is the correct default — it must mean "unknown / not
computed," distinct from `0` = "confirmed did not go to OT." A CFL/NFL
row or a pre-this-fix row should read as unknown, not false.

## TASK 2 — Compute `wentToOT` in GameDO, include in the archive payload

Inside the completed-state archive hook (after `const payload = {`,
line ~406), add a computed field before building `payload`:

```javascript
const REGULATION_PERIODS = { nba: 4, wnba: 4, nhl: 3, mlb: 9 };
const SOCCER_SPORTS = new Set(['epl', 'mls', 'ucl', 'wc26']);
let wentToOT = null; // null = unknown/not-applicable, not false
if (facts.period != null) {
    if (SOCCER_SPORTS.has(this.sport)) {
        wentToOT = facts.period >= 3;
    } else if (REGULATION_PERIODS[this.sport]) {
        wentToOT = facts.period > REGULATION_PERIODS[this.sport];
    }
    // afl and any unlisted sport: wentToOT stays null, not guessed.
}
```
Add `went_to_ot: wentToOT,` to the existing `payload` object (same
object that already carries `home_score`, `away_score`, etc.).

## TASK 3 — Accept and store `went_to_ot` in `/archive/game`

In the POST handler (line ~8523), destructure `went_to_ot` from the
body alongside the existing fields, and add it to both INSERT
statements (`regular_season_games` and `postseason_games`) and their
`ON CONFLICT DO UPDATE SET` clauses:

```javascript
went_to_ot = COALESCE(excluded.went_to_ot, went_to_ot)
```
Same `COALESCE` pattern already used for every other optional field —
a later write with `null` must never erase an earlier confirmed value.

## TASK 4 — Verification

- `node --check src/game-do.js && node --check src/index.js`
- Query D1 directly for a real completed NBA/MLB/soccer game from
  today or yesterday that you can independently confirm went to
  overtime/extra time (cross-check against ESPN) and one that
  definitely did NOT — confirm `went_to_ot` computes correctly for
  both once a new completion flows through (this may require watching
  for a real new game to complete, or manually POSTing a synthetic
  `/archive/game` test payload with a known `period` value and sport
  to confirm the stored result — state clearly which method was used).
- Confirm AFL and NFL/CFL rows remain `NULL`, not `0` or a guessed
  value.

## DONE CONDITIONS
- [ ] Probe block confirms all citations before editing
- [ ] Both tables have the new `went_to_ot` column, default NULL
- [ ] GameDO computes `wentToOT` correctly per the sourced per-sport rules above, `null` for AFL/unlisted sports
- [ ] `/archive/game` stores it with the same COALESCE-preserving pattern as every other optional field
- [ ] Verified against at least one real OT/extra-time game and one real regulation-only game (or a clearly-described synthetic test if no real one was available)
- [ ] Outbox manifest written, explicitly stating a client-repo CC-CMD is still needed to wire `getWhatYouMissed` to this new data

## CONFIDENCE SCORING TABLE
+25  Schema change correct, NULL default preserved
+30  GameDO computation matches the sourced per-sport rules exactly, AFL/NFL/CFL correctly excluded rather than guessed
+20  /archive/game correctly stores and COALESCE-preserves the value
+15  Verified against real or clearly-described synthetic test data
+10  Outbox explicitly flags the required client-side follow-up

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-06-wenttoot-relay-side.md. Execute all
four tasks: add the went_to_ot column to both archive tables (NULL
default), compute it in GameDO from facts.period using the sourced
per-sport regulation rules (NBA/WNBA=4, NHL=3, MLB=9, soccer via
periodNum>=3, AFL and NFL/CFL explicitly left null rather than guessed),
store it in /archive/game with the same COALESCE pattern as other
optional fields, and verify against real or synthetic test data. State
clearly in the outbox that a separate client-repo CC-CMD is still needed
to wire getWhatYouMissed to this data. Do not commit unless confidence
>= 95. If score < 95, report verbatim and stop.
