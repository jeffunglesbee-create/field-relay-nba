# CC-CMD: Wire real went_to_ot into /analytics/newspaper's completed_games

**Date:** 2026-07-06
**Repo:** jeffunglesbee-create/field-relay-nba (sole)
**Branch:** main — commit directly, do not create a feature branch or PR
**Depends on:** CC-CMD-2026-07-06-wenttoot-relay-side.md — DONE, deployed
(`b39ec8f`). `regular_season_games`/`postseason_games` both have a real
`went_to_ot` column now.

**Source — verified directly, not assumed.** The client's
`getWhatYouMissed()` was traced fully: it receives `bundle.completed_games`
from `fetchNewspaper()` → `/analytics/newspaper/{date}`. That endpoint's
`completed_games` builder (`src/index.js:~10774`) queries
`regular_season_games`/`postseason_games` directly by `date` — the exact
tables that now have `went_to_ot` — but the returned object hardcodes
`wentToOT: false, // not stored in D1` (line ~10805). That comment is
stale as of last night's deploy; this is the one place that needs fixing,
not the client.

**Target time:** ~15 min

## PROBE BLOCK
```bash
sed -n '10756,10768p' src/index.js   # the two SELECT statements
sed -n '10774,10810p' src/index.js   # the .map() building completed_games, incl. the hardcoded line
```
Confirm both citations still match before editing.

## TASK 1 — Add `went_to_ot` to both SELECT statements

```sql
SELECT id, sport, home, away, home_score, away_score,
       closing_odds, went_to_ot, NULL AS importance
FROM regular_season_games
WHERE date = ? AND home_score IS NOT NULL
```
and the equivalent addition to the `postseason_games` query (insert
`went_to_ot` in the same relative position, keep `importance` as its
real column there, not `NULL AS`).

## TASK 2 — Replace the hardcoded value

Change:
```javascript
wentToOT: false, // not stored in D1
```
to:
```javascript
wentToOT: !!g.went_to_ot,
```
`!!` converts D1's `1`/`0`/`null` cleanly to a real boolean — `null`
(unknown/AFL/unlisted sport) correctly becomes `false` here, which is
the right behavior for this specific consumer: "don't know" and "didn't
happen" both mean "don't flag it as a went-to-OT notable moment."

## TASK 3 — Verification

- `node --check src/index.js`
- Query D1 directly for a real game with `went_to_ot = 1` from the last
  few days (if none exist yet since last night's deploy is recent,
  state that plainly rather than fabricating a test case) and confirm
  `/analytics/newspaper/{that date}` now returns `wentToOT: true` for it
  in `completed_games`, not `false`.
- Confirm a real `went_to_ot IS NULL` game still returns `wentToOT: false`
  (not `null`, not `undefined`) — the client filter expects a boolean.

## DONE CONDITIONS
- [ ] Probe block confirms citations before editing
- [ ] Both SELECT statements include `went_to_ot`
- [ ] Hardcoded `false` replaced with `!!g.went_to_ot`
- [ ] Verified against at least one real row with `went_to_ot = 1` if one exists, or honestly reported if none exist yet
- [ ] Outbox written

## CONFIDENCE SCORING TABLE
+35  Both SELECTs correctly updated
+35  Hardcoded value replaced correctly, null/0/1 all map to sane booleans
+20  Verified against real data or honestly reported as unavailable yet
+10  Outbox notes this unblocks the separate client-repo CC-CMD (getWhatYouMissed filter itself still needs `g.wentToOT` added to its OR-chain — not part of this doc)

## ONE-LINER
git pull. Read docs/CC-CMD-2026-07-06-wenttoot-newspaper-bundle-wire.md.
Add went_to_ot to both SELECT statements in the /analytics/newspaper
completed_games builder and replace the hardcoded `wentToOT: false` with
`!!g.went_to_ot`. Verify against real data if any exists since last
night's deploy, report honestly if not. Do not commit unless confidence
>= 95. If score < 95, report verbatim and stop.
