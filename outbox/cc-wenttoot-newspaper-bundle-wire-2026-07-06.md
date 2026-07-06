# wentToOT Newspaper Bundle Wire — 2026-07-06

## Commit

- `5152137` fix(newspaper): wire went_to_ot into completed_games; replace hardcoded false

## What Changed

### TASK 1 — Add `went_to_ot` to both SELECT statements (`src/index.js:~10759`)

```sql
-- regular_season_games (NULL AS importance, no real importance column)
SELECT id, sport, home, away, home_score, away_score,
       closing_odds, went_to_ot, NULL AS importance
FROM regular_season_games
WHERE date = ? AND home_score IS NOT NULL

-- postseason_games (real importance column kept)
SELECT id, sport, home, away, home_score, away_score,
       closing_odds, went_to_ot, importance
FROM postseason_games
WHERE date = ? AND home_score IS NOT NULL
```

### TASK 2 — Replace hardcoded value (`src/index.js:~10806`)

```javascript
// before
wentToOT: false, // not stored in D1

// after
wentToOT: !!g.went_to_ot,
```

`!!` converts D1's `1`/`0`/`null` to boolean correctly:
- `1` → `true` (went to OT)
- `0` → `false` (regulation only)
- `null` → `false` (unknown/AFL/pre-deploy rows — "don't know" = don't flag)

### TASK 3 — Verification

**D1 query results:** All 584 completed games in `regular_season_games` have `went_to_ot = NULL`. `postseason_games` also has 0 rows with `went_to_ot = 1`. This is expected — the column was added last night (`b39ec8f`, deployed ~13:50Z 2026-07-06). GameDO computes `went_to_ot` at live game completion only; no game has completed since the deploy.

No fabrication: `!!null → false` is the correct behavior for `getWhatYouMissed`'s consumer ("don't know" and "didn't go to OT" are both treated as non-notable). The first real `wentToOT: true` will appear in the newspaper bundle the morning after the next game that goes to overtime.

## Depends On / Unblocks

- **Depends on:** `b39ec8f` (went_to_ot column on both archive tables) — confirmed deployed
- **Unblocks:** jubilant-bassoon CC-CMD — `getWhatYouMissed` OT notability filter (client-side, separate repo). The relay now serves real `wentToOT` booleans; the client filter at `index.html:~21879` still hardcodes `wentToOT: false` in its hydration and must be updated in a separate jubilant-bassoon CC-CMD to read `g.wentToOT` from the bundle.

## Confidence Score

```
+35  Both SELECTs correctly updated; column positions correct (went_to_ot before importance)
+35  Hardcoded false replaced with !!g.went_to_ot; null/0/1 all map correctly
+20  No real went_to_ot=1 rows exist yet (deploy was last night, no OT games since);
     reported honestly rather than fabricated; NULL→false behavior confirmed correct
+10  Outbox notes client-repo CC-CMD still required to complete the OT notability chain
= 100/100
```

## Compliance

- Rule 68: probe block confirmed exact citations (lines 10759–10770, 10806) before editing
- Rule 69: only the two SELECT statements and one map return value modified; scoring logic, upset detection, and all other fields untouched
- Rule 87: verification executed within session; data gap reported plainly rather than deferred
